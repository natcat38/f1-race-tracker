package ws

import (
	"encoding/json"
	"testing"

	"github.com/coder/websocket"

	"github.com/natcat38/f1-race-tracker/internal/model"
)

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
	h := NewHub(s)
	c := newClient(&websocket.Conn{})
	if err := h.Register(c); err != nil {
		t.Fatal(err)
	}
	if e := drain(t, c); e.Type != "snapshot" {
		t.Errorf("first frame type = %q, want snapshot", e.Type)
	}
}

func TestHub_ApplyFrameBroadcastsAndDropsStale(t *testing.T) {
	h := NewHub(model.NewSnapshot("demo", "replay", "Synthetic"))
	c := newClient(&websocket.Conn{})
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

func TestHub_SlowClientIsDropped(t *testing.T) {
	h := NewHub(model.NewSnapshot("demo", "replay", "Synthetic"))
	c := newClient(&websocket.Conn{})
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
