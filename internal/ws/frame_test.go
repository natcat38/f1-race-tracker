package ws

import (
	"encoding/json"
	"testing"

	"github.com/natcat38/f1-race-tracker/internal/model"
)

func TestEncodeSnapshot_WrapsTypeAndData(t *testing.T) {
	s := model.NewSnapshot("demo", "replay", "Synthetic")
	s.Rev = 3
	b, err := encodeSnapshot(s)
	if err != nil {
		t.Fatal(err)
	}
	var e envelope
	if err := json.Unmarshal(b, &e); err != nil {
		t.Fatal(err)
	}
	if e.Type != "snapshot" {
		t.Errorf("Type = %q, want snapshot", e.Type)
	}
	var got model.Snapshot
	if err := json.Unmarshal(e.Data, &got); err != nil {
		t.Fatal(err)
	}
	if got.Rev != 3 || got.SessionKey != "demo" {
		t.Errorf("round-tripped snapshot = %+v", got)
	}
}

func TestEncodeFrame_WrapsTypeAndData(t *testing.T) {
	f := model.Frame{Rev: 9, TimeMs: 1234, Cars: []model.CarState{{DriverNum: 44}}}
	b, err := encodeFrame(f)
	if err != nil {
		t.Fatal(err)
	}
	var e envelope
	if err := json.Unmarshal(b, &e); err != nil {
		t.Fatal(err)
	}
	if e.Type != "frame" {
		t.Errorf("Type = %q, want frame", e.Type)
	}
	var got model.Frame
	if err := json.Unmarshal(e.Data, &got); err != nil {
		t.Fatal(err)
	}
	if got.Rev != 9 || len(got.Cars) != 1 || got.Cars[0].DriverNum != 44 {
		t.Errorf("round-tripped frame = %+v", got)
	}
}

// A zero-value Frame (Rev 0, no cars) should never be silently encoded and
// broadcast — Rev 0 collides with the "no frame yet" sentinel the hub's stale
// check relies on. encodeFrame must reject it.
func TestEncodeFrame_RejectsZeroValueFrame(t *testing.T) {
	if _, err := encodeFrame(model.Frame{}); err == nil {
		t.Fatal("expected error encoding a zero-value Frame (Rev 0, no cars), got nil")
	}
}
