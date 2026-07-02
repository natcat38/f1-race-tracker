package model

import "testing"

func TestApply_ReplacesCarsAndAdvancesRev(t *testing.T) {
	s := NewSnapshot("demo", "replay", "Synthetic")
	_, ok := Apply(s, Frame{Rev: 1, TimeMs: 100, Cars: []CarState{
		{DriverNum: 1, Code: "VER", Pos: 1, P: Point{X: 0.5, Y: 0.5}, Status: "OnTrack"},
	}})
	if !ok || s.Rev != 1 || s.TimeMs != 100 {
		t.Fatalf("apply failed: ok=%v rev=%d timeMs=%d", ok, s.Rev, s.TimeMs)
	}
	if s.Cars[1].Code != "VER" || s.Cars[1].P.X != 0.5 {
		t.Errorf("car not stored: %+v", s.Cars[1])
	}
}

func TestApply_StaleRevIsNoOp(t *testing.T) {
	s := NewSnapshot("demo", "replay", "Synthetic")
	Apply(s, Frame{Rev: 5, Cars: []CarState{{DriverNum: 1, Code: "VER"}}})
	_, ok := Apply(s, Frame{Rev: 5, Cars: []CarState{{DriverNum: 1, Code: "XXX"}}})
	if ok {
		t.Error("stale frame (Rev<=current) should be ignored")
	}
	if s.Cars[1].Code != "VER" {
		t.Errorf("stale frame mutated state: %+v", s.Cars[1])
	}
}

func TestApply_OutOfOrderRevIsIgnored(t *testing.T) {
	s := NewSnapshot("demo", "replay", "Synthetic")
	Apply(s, Frame{Rev: 7, TimeMs: 700, Cars: []CarState{{DriverNum: 1, Code: "VER"}}})

	// A lower Rev arriving after a higher one is dropped — the gate is against the
	// current s.Rev, not "the last frame we saw".
	if _, ok := Apply(s, Frame{Rev: 5, Cars: []CarState{{DriverNum: 1, Code: "OLD"}}}); ok {
		t.Error("out-of-order Rev 5 (after 7) should be ignored")
	}
	// An in-between Rev (6) is likewise ignored once we're at 7.
	if _, ok := Apply(s, Frame{Rev: 6, Cars: []CarState{{DriverNum: 1, Code: "MID"}}}); ok {
		t.Error("Rev 6 (after 7) should be ignored")
	}
	if s.Cars[1].Code != "VER" || s.Rev != 7 {
		t.Errorf("state moved backwards: car=%+v rev=%d", s.Cars[1], s.Rev)
	}
}

func TestApply_AppendsAndCapsMessages(t *testing.T) {
	s := NewSnapshot("demo", "replay", "Synthetic")
	for i := int64(1); i <= maxMessages+10; i++ {
		Apply(s, Frame{Rev: i, Messages: []RaceControlMessage{{Message: "x"}}})
	}
	if len(s.Messages) != maxMessages {
		t.Errorf("messages = %d, want capped at %d", len(s.Messages), maxMessages)
	}
}
