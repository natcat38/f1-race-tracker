package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/natcat38/f1-race-tracker/internal/model"
)

func TestHist_PercentileAndMax(t *testing.T) {
	h := newHist()
	for i := int64(1); i <= 100; i++ {
		h.Add(i)
	}
	if got := h.Percentile(0.50); got != 50 {
		t.Errorf("p50 = %d, want 50", got)
	}
	if got := h.Percentile(0.99); got != 99 {
		t.Errorf("p99 = %d, want 99", got)
	}
	if got := h.Max(); got != 100 {
		t.Errorf("max = %d, want 100", got)
	}
	if got := h.Count(); got != 100 {
		t.Errorf("count = %d, want 100", got)
	}
}

func TestHist_EmptyIsZero(t *testing.T) {
	h := newHist()
	if got := h.Percentile(0.5); got != 0 {
		t.Errorf("empty p50 = %d, want 0", got)
	}
}

func TestHist_OverflowUsesCeilingButMaxIsTrue(t *testing.T) {
	h := newHist()
	h.Add(6000) // beyond histMaxMs
	if got := h.Percentile(0.99); got != histMaxMs {
		t.Errorf("overflow p99 = %d, want %d", got, histMaxMs)
	}
	if got := h.Max(); got != 6000 {
		t.Errorf("max = %d, want 6000 (true value preserved)", got)
	}
}

func TestHist_Merge(t *testing.T) {
	a, b := newHist(), newHist()
	a.Add(10)
	a.Add(20)
	b.Add(30)
	a.Merge(b)
	if got := a.Count(); got != 3 {
		t.Errorf("merged count = %d, want 3", got)
	}
	if got := a.Max(); got != 30 {
		t.Errorf("merged max = %d, want 30", got)
	}
}

func envFrame(t *testing.T, tMs int64) []byte {
	t.Helper()
	d, _ := json.Marshal(model.Frame{T: tMs})
	b, _ := json.Marshal(wsEnvelope{Type: "frame", Data: d})
	return b
}

func TestParseFrameLatency_FrameYieldsLatency(t *testing.T) {
	raw := envFrame(t, 1000)
	lat, ok := parseFrameLatency(raw, 1050)
	if !ok || lat != 50 {
		t.Errorf("got (%d,%v), want (50,true)", lat, ok)
	}
}

func TestParseFrameLatency_SnapshotSkipped(t *testing.T) {
	b, _ := json.Marshal(wsEnvelope{Type: "snapshot", Data: json.RawMessage(`{}`)})
	if _, ok := parseFrameLatency(b, 1050); ok {
		t.Error("snapshot envelope should not yield a latency sample")
	}
}

func TestParseFrameLatency_GarbageSkipped(t *testing.T) {
	if _, ok := parseFrameLatency([]byte("not json"), 1050); ok {
		t.Error("malformed input should not yield a sample")
	}
}

func TestParseFrameLatency_MissingTSkipped(t *testing.T) {
	if _, ok := parseFrameLatency(envFrame(t, 0), 1050); ok {
		t.Error("a frame with T==0 should not yield a sample")
	}
}

func wsURL(s string) string { return "ws" + strings.TrimPrefix(s, "http") }

// fakeServer sends one snapshot then `n` frames stamped with the current time,
// then blocks until the client disconnects.
func fakeServer(n int) *httptest.Server {
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		c, err := websocket.Accept(w, r, &websocket.AcceptOptions{InsecureSkipVerify: true})
		if err != nil {
			return
		}
		defer c.CloseNow()
		ctx := r.Context()
		snap, _ := json.Marshal(wsEnvelope{Type: "snapshot", Data: json.RawMessage(`{}`)})
		_ = c.Write(ctx, websocket.MessageText, snap)
		for i := 0; i < n; i++ {
			d, _ := json.Marshal(model.Frame{T: timeNowMs()})
			env, _ := json.Marshal(wsEnvelope{Type: "frame", Data: d})
			if err := c.Write(ctx, websocket.MessageText, env); err != nil {
				return
			}
			time.Sleep(5 * time.Millisecond)
		}
		<-ctx.Done()
	}))
}

func TestRunClient_RecordsFramesAfterSteadyStart(t *testing.T) {
	srv := fakeServer(5)
	defer srv.Close()
	h := newHist()
	ctr := &counters{}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	runClient(ctx, wsURL(srv.URL), time.Now().Add(-time.Second), h, ctr) // steadyStart in the past
	if ctr.connected.Load() != 1 {
		t.Errorf("connected = %d, want 1", ctr.connected.Load())
	}
	if h.Count() < 1 {
		t.Error("expected at least one latency sample recorded")
	}
}

// A server that closes immediately should be counted as a drop, not a clean exit.
func TestRunClient_ServerCloseCountsAsDrop(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		c, err := websocket.Accept(w, r, &websocket.AcceptOptions{InsecureSkipVerify: true})
		if err != nil {
			return
		}
		c.CloseNow() // drop the client right away
	}))
	defer srv.Close()
	h := newHist()
	ctr := &counters{}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	runClient(ctx, wsURL(srv.URL), time.Now(), h, ctr)
	if ctr.drops.Load() != 1 {
		t.Errorf("drops = %d, want 1", ctr.drops.Load())
	}
}
