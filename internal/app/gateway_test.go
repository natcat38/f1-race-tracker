// Tests for the gateway role: snapshot-on-connect, frame fan-out, origin and session
// allowlists, health reporting.

package app

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/coder/websocket"
	"github.com/redis/go-redis/v9"

	"github.com/natcat38/f1-race-tracker/internal/bus"
	"github.com/natcat38/f1-race-tracker/internal/model"
	"github.com/natcat38/f1-race-tracker/internal/ws"
)

// S1: an unknown ?session= is rejected with 400 and never grows the registry.
func TestWsHandler_RejectsUnknownSession(t *testing.T) {
	b := testBus(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	g, err := NewGateway(ctx, b, "replay", slog.New(slog.NewTextHandler(io.Discard, nil)))
	if err != nil {
		t.Fatal(err)
	}
	mux := http.NewServeMux()
	g.Mount(mux, nil)
	srv := httptest.NewServer(mux)
	defer srv.Close()

	resp, err := http.Get(srv.URL + "/ws?session=bogus")
	if err != nil {
		t.Fatal(err)
	}
	_ = resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Errorf("unknown session status = %d, want 400", resp.StatusCode)
	}
	g.regMu.Lock()
	n := len(g.registry)
	g.regMu.Unlock()
	if n != 0 {
		t.Errorf("registry grew to %d for a rejected session", n)
	}
}

// S3: a cross-site POST to the control endpoint is rejected; a same-origin one switches.
func TestHandleControl_RejectsCrossSitePost(t *testing.T) {
	b := testBus(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	for _, s := range []string{"replay", "live"} {
		seed := model.NewSnapshot(s, "replay", s)
		if err := b.Publish(ctx, seed, model.Frame{SessionKey: s, Rev: 0}); err != nil {
			t.Fatal(err)
		}
	}
	g, err := NewGateway(ctx, b, "replay", slog.New(slog.NewTextHandler(io.Discard, nil)))
	if err != nil {
		t.Fatal(err)
	}
	mux := http.NewServeMux()
	g.Mount(mux, nil)
	srv := httptest.NewServer(mux)
	defer srv.Close()

	post := func(site string) int {
		req, _ := http.NewRequest(http.MethodPost, srv.URL+"/control/source", strings.NewReader(`{"source":"live"}`))
		if site != "" {
			req.Header.Set("Sec-Fetch-Site", site)
		}
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		_ = resp.Body.Close()
		return resp.StatusCode
	}

	if code := post("cross-site"); code != http.StatusForbidden {
		t.Errorf("cross-site POST status = %d, want 403", code)
	}
	if code := post("same-origin"); code != http.StatusOK {
		t.Errorf("same-origin POST status = %d, want 200", code)
	}
}

// L-1: hostAllowed accepts loopback (with or without a port) unconditionally, rejects an
// arbitrary foreign host by default, and honors the extra allowlist once set.
func TestHostAllowed(t *testing.T) {
	cases := []struct {
		host  string
		extra map[string]bool
		want  bool
	}{
		{"localhost:8080", nil, true},
		{"127.0.0.1:8080", nil, true},
		{"127.0.0.1", nil, true},
		{"[::1]:8080", nil, true},
		{"evil.com", nil, false},
		{"evil.com:8080", nil, false},
		{"evil.com", map[string]bool{"evil.com": true}, true},
		{"EVIL.com:443", map[string]bool{"evil.com": true}, true}, // case-insensitive
	}
	for _, c := range cases {
		if got := hostAllowed(c.host, c.extra); got != c.want {
			t.Errorf("hostAllowed(%q, %v) = %v, want %v", c.host, c.extra, got, c.want)
		}
	}
}

// L-1: a same-origin POST from a foreign Host is rejected even though Sec-Fetch-Site
// says same-origin — the scenario DNS rebinding produces — while the documented
// deployments (loopback Host) still switch the source.
func TestHandleControl_RejectsForeignHost(t *testing.T) {
	b := testBus(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	for _, s := range []string{"replay", "live"} {
		seed := model.NewSnapshot(s, "replay", s)
		if err := b.Publish(ctx, seed, model.Frame{SessionKey: s, Rev: 0}); err != nil {
			t.Fatal(err)
		}
	}
	g, err := NewGateway(ctx, b, "replay", slog.New(slog.NewTextHandler(io.Discard, nil)))
	if err != nil {
		t.Fatal(err)
	}
	mux := http.NewServeMux()
	g.Mount(mux, nil)
	srv := httptest.NewServer(mux)
	defer srv.Close()

	post := func(host string) int {
		req, _ := http.NewRequest(http.MethodPost, srv.URL+"/control/source", strings.NewReader(`{"source":"live"}`))
		req.Header.Set("Sec-Fetch-Site", "same-origin")
		req.Host = host
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		_ = resp.Body.Close()
		return resp.StatusCode
	}

	if code := post("evil.com"); code != http.StatusForbidden {
		t.Errorf("rebound-host POST status = %d, want 403", code)
	}
	// httptest.NewServer listens on 127.0.0.1; a request with no overridden Host still
	// carries it, so the documented deployment (loopback) keeps working.
	if code := post("127.0.0.1"); code != http.StatusOK {
		t.Errorf("loopback-host POST status = %d, want 200", code)
	}
}

// C2: toggling the source under concurrent publishing to both sessions must not panic
// or leave a torn state. Run under -race to catch a stale-frame data race.
func TestSwitchTo_ConcurrentSwitchAndPublish(t *testing.T) {
	b := testBus(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))

	for _, s := range []string{"replay", "live"} {
		seed := model.NewSnapshot(s, "replay", s)
		if err := b.Publish(ctx, seed, model.Frame{SessionKey: s, Rev: 0}); err != nil {
			t.Fatal(err)
		}
	}
	g, err := NewGateway(ctx, b, "replay", logger)
	if err != nil {
		t.Fatal(err)
	}

	var wg sync.WaitGroup
	stop := make(chan struct{})
	for _, s := range []string{"replay", "live"} {
		wg.Add(1)
		go func(s string) {
			defer wg.Done()
			snap := model.NewSnapshot(s, "replay", s)
			var rev int64
			for {
				select {
				case <-stop:
					return
				default:
				}
				rev++
				fr := model.Frame{SessionKey: s, Rev: rev, Cars: []model.CarState{{DriverNum: 1}}}
				model.Apply(snap, fr)
				_ = b.Publish(ctx, snap, fr)
				time.Sleep(time.Millisecond)
			}
		}(s)
	}

	for i := 0; i < 20; i++ {
		src := "live"
		if i%2 == 0 {
			src = "replay"
		}
		_ = g.SwitchTo(src)
		time.Sleep(2 * time.Millisecond)
	}
	close(stop)
	wg.Wait()

	if err := g.SwitchTo("live"); err != nil {
		t.Fatal(err)
	}
	g.mu.Lock()
	final := g.session
	g.mu.Unlock()
	if final != "live" {
		t.Errorf("final session = %q, want live", final)
	}
}

// C2 (deterministic): a frame delivered to a STALE generation's consume goroutine
// after SwitchTo has already bumped g.gen must never reach the hub. Unlike
// TestSwitchTo_ConcurrentSwitchAndPublish (a stress loop that only proves "no
// panic/race under -race"), this pins down the actual regression: the frame is
// dropped, not merely delivered without crashing.
func TestConsume_DropsFrameFromStaleGeneration(t *testing.T) {
	b := testBus(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))

	for _, s := range []string{"replay", "live"} {
		seed := model.NewSnapshot(s, "replay", s)
		if err := b.Publish(ctx, seed, model.Frame{SessionKey: s, Rev: 0}); err != nil {
			t.Fatal(err)
		}
	}
	g, err := NewGateway(ctx, b, "replay", logger)
	if err != nil {
		t.Fatal(err)
	}
	staleGen := g.gen // 0, captured before the switch

	// Switch away from "replay": bumps g.gen to 1 and resets the (shared) hub to
	// the "live" snapshot — the moment a still-in-flight stale-generation frame
	// must no longer be able to land.
	if err := g.SwitchTo("live"); err != nil {
		t.Fatal(err)
	}

	// Fresh subscription to the OLD session's channel, standing in for whatever
	// the stale generation's own consume goroutine already held. Publish one
	// frame carrying a marker car that must never reach the hub.
	snap, pubsub, err := g.subscribeAndSnapshot(ctx, "replay")
	if err != nil {
		t.Fatal(err)
	}
	poisoned := model.Frame{SessionKey: "replay", Rev: snap.Rev + 1, Cars: []model.CarState{{DriverNum: 999, Code: "XXX"}}}
	if err := b.Publish(ctx, snap, poisoned); err != nil {
		t.Fatal(err)
	}

	// Drive consume directly with the STALE gen captured pre-switch — exactly
	// what a goroutine spawned before SwitchTo would still be running with. It
	// must detect the mismatch against the now-current g.gen and return without
	// ever calling hub.ApplyFrame.
	done := make(chan struct{})
	go func() { g.consume(ctx, g.hub, pubsub, staleGen); close(done) }()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("consume did not return after a stale-generation frame")
	}

	// The only externally-observable surface from this package is a real WS
	// client: connect fresh and confirm the seeded snapshot has no trace of the
	// poisoned car (and is still "live"'s, not corrupted by "replay" data).
	mux := http.NewServeMux()
	g.Mount(mux, nil)
	srv := httptest.NewServer(mux)
	defer srv.Close()
	conn, _, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(srv.URL, "http")+"/ws", nil)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close(websocket.StatusNormalClosure, "")

	_, data, err := conn.Read(ctx)
	if err != nil {
		t.Fatal(err)
	}
	var env struct {
		Type string          `json:"type"`
		Data json.RawMessage `json:"data"`
	}
	if err := json.Unmarshal(data, &env); err != nil {
		t.Fatal(err)
	}
	var got model.Snapshot
	if err := json.Unmarshal(env.Data, &got); err != nil {
		t.Fatal(err)
	}
	if got.SessionKey != "live" {
		t.Fatalf("hub snapshot session = %q, want live (stale frame corrupted the switch)", got.SessionKey)
	}
	if _, ok := got.Cars[999]; ok {
		t.Fatalf("stale-generation frame reached the hub: cars=%+v", got.Cars)
	}
}

// getOrCreateHub must return the SAME hub for a repeated session key, and creating
// a never-seen session concurrently must yield exactly one hub (regMu guards it).
// Run under -race to catch a duplicate-subscribe race.
func TestGetOrCreateHub_ReusesAndIsConcurrencySafe(t *testing.T) {
	b := testBus(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	g, err := NewGateway(ctx, b, "demo", slog.New(slog.NewTextHandler(io.Discard, nil)))
	if err != nil {
		t.Fatal(err)
	}

	h1, err := g.getOrCreateHub("replay")
	if err != nil {
		t.Fatal(err)
	}
	h2, err := g.getOrCreateHub("replay")
	if err != nil {
		t.Fatal(err)
	}
	if h1 != h2 {
		t.Error("getOrCreateHub returned different hubs for the same session")
	}

	const n = 20
	var wg sync.WaitGroup
	hubs := make([]*ws.Hub, n)
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			h, err := g.getOrCreateHub("live")
			if err != nil {
				t.Error(err)
				return
			}
			hubs[i] = h
		}(i)
	}
	wg.Wait()
	for i := 1; i < n; i++ {
		if hubs[i] != hubs[0] {
			t.Fatalf("concurrent getOrCreateHub created multiple hubs: %p vs %p", hubs[0], hubs[i])
		}
	}
}

// /api/f1auth serves the seam's status verbatim, defaults to unlinked, and stays
// read-only — the gateway is never a writer (ADR-0001/0007).
func TestAuthStatusRoute(t *testing.T) {
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatal(err)
	}
	defer mr.Close()
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	defer func() { _ = rdb.Close() }()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	g, err := NewGateway(ctx, bus.New(rdb), "replay", slog.New(slog.NewTextHandler(io.Discard, nil)))
	if err != nil {
		t.Fatal(err)
	}
	mux := http.NewServeMux()
	g.Mount(mux, nil)
	srv := httptest.NewServer(mux)
	defer srv.Close()

	get := func() (int, string, string) {
		resp, err := http.Get(srv.URL + "/api/f1auth")
		if err != nil {
			t.Fatal(err)
		}
		defer func() { _ = resp.Body.Close() }()
		body, _ := io.ReadAll(resp.Body)
		return resp.StatusCode, resp.Header.Get("Content-Type"), string(body)
	}

	// Nothing published yet: the gateway answers for the seam rather than 404ing.
	code, ctype, body := get()
	if code != http.StatusOK || body != `{"state":"unlinked"}` {
		t.Fatalf("absent key = %d %q, want 200 unlinked", code, body)
	}
	if ctype != "application/json" {
		t.Errorf("content-type = %q, want application/json", ctype)
	}

	want := `{"state":"linked","expiresUtc":"2026-09-01T00:00:00+00:00","tier":"active"}`
	mr.Set("f1auth:status", want)
	if code, _, body = get(); code != http.StatusOK || body != want {
		t.Fatalf("published status = %d %q, want 200 %q", code, body, want)
	}

	resp, err := http.Post(srv.URL+"/api/f1auth", "application/json", strings.NewReader("{}"))
	if err != nil {
		t.Fatal(err)
	}
	_ = resp.Body.Close()
	if resp.StatusCode != http.StatusMethodNotAllowed {
		t.Errorf("POST status = %d, want 405", resp.StatusCode)
	}
}
