package app

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

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
