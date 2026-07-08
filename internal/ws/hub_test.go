package ws

import (
	"encoding/json"
	"io"
	"log/slog"
	"testing"

	"github.com/natcat38/f1-race-tracker/internal/model"
)

func testLogger() *slog.Logger { return slog.New(slog.NewTextHandler(io.Discard, nil)) }

func drain(t *testing.T, c *Client) envelope {
	t.Helper()
	select {
	case b := <-c.out:
		var e envelope
		if err := json.Unmarshal(b, &e); err != nil {
			t.Fatal(err)
		}
		return e
	default:
		t.Fatal("expected a queued frame")
		return envelope{}
	}
}

func TestHub_RegisterQueuesSnapshotFirst(t *testing.T) {
	s := model.NewSnapshot("demo", "replay", "Synthetic")
	s.Rev = 7
	logger := testLogger()
	h := NewHub(s, logger)
	c := newClient(nil, logger)
	if err := h.Register(c); err != nil {
		t.Fatal(err)
	}
	if e := drain(t, c); e.Type != "snapshot" {
		t.Errorf("first frame type = %q, want snapshot", e.Type)
	}
}

func TestHub_ApplyFrameBroadcastsAndDropsStale(t *testing.T) {
	logger := testLogger()
	h := NewHub(model.NewSnapshot("demo", "replay", "Synthetic"), logger)
	c := newClient(nil, logger)
	_ = h.Register(c)
	_ = drain(t, c) // discard snapshot

	if !h.ApplyFrame(model.Frame{Rev: 1, Cars: []model.CarState{{DriverNum: 1}}}) {
		t.Fatal("expected rev 1 to apply")
	}
	if e := drain(t, c); e.Type != "frame" {
		t.Errorf("type = %q, want frame", e.Type)
	}
	if h.ApplyFrame(model.Frame{Rev: 1}) {
		t.Error("expected stale rev 1 to be ignored")
	}
}

func TestHub_ResetDropsSlowClient(t *testing.T) {
	logger := testLogger()
	h := NewHub(model.NewSnapshot("demo", "replay", "Synthetic"), logger)
	c := newClient(nil, logger)
	_ = h.Register(c) // 1 snapshot queued
	// Reset is not Rev-gated but still fans out via send(); a switch-storm overflows
	// the same bounded buffer and must drop the client the same way ApplyFrame does.
	for i := 0; i < sendBuffer+5; i++ {
		h.Reset(model.NewSnapshot("demo", "replay", "Synthetic"))
	}
	select {
	case <-c.closed:
	default:
		t.Error("slow client not dropped after Reset buffer overflow")
	}
}

func TestHub_SlowClientIsDropped(t *testing.T) {
	logger := testLogger()
	h := NewHub(model.NewSnapshot("demo", "replay", "Synthetic"), logger)
	c := newClient(nil, logger)
	_ = h.Register(c) // 1 snapshot frame queued
	for i := int64(1); i <= sendBuffer+5; i++ {
		h.ApplyFrame(model.Frame{Rev: i, Cars: []model.CarState{{DriverNum: 1}}})
	}
	select {
	case <-c.closed:
	default:
		t.Error("slow client was not dropped after buffer overflow")
	}
}

// Dropping a slow client (send buffer full -> close) must not prevent OTHER
// clients on the same hub from receiving the frame that triggered the drop —
// closing one client's socket is not allowed to short-circuit the broadcast
// loop for the rest. Guards the ApplyFrame/Reset restructuring that moves
// close() calls to run after h.mu is released (C3).
func TestHub_SlowClientDropDoesNotBlockOtherClients(t *testing.T) {
	logger := testLogger()
	h := NewHub(model.NewSnapshot("demo", "replay", "Synthetic"), logger)
	slow := newClient(nil, logger)
	healthy := newClient(nil, logger)
	_ = h.Register(slow)
	_ = h.Register(healthy)
	_ = drain(t, slow)    // discard snapshot
	_ = drain(t, healthy) // discard snapshot

	// Fill the slow client's buffer without draining it; drain the healthy
	// client's buffer every time so it never itself overflows.
	for i := int64(1); i <= sendBuffer+5; i++ {
		if !h.ApplyFrame(model.Frame{Rev: i, Cars: []model.CarState{{DriverNum: 1}}}) {
			t.Fatalf("rev %d should have applied", i)
		}
		if e := drain(t, healthy); e.Type != "frame" {
			t.Fatalf("healthy client missed rev %d (type=%q)", i, e.Type)
		}
	}

	select {
	case <-slow.closed:
	default:
		t.Error("slow client was not dropped")
	}
	select {
	case <-healthy.closed:
		t.Error("healthy client was dropped too — it should be unaffected by slow's drop")
	default:
	}
}
