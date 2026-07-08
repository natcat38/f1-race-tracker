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

// A frame's Cars is a partial update (only changed cars), not the full field —
// a car absent from the incoming frame must survive untouched in the snapshot.
func TestApply_UnmentionedCarsSurviveFrame(t *testing.T) {
	s := NewSnapshot("demo", "replay", "Synthetic")
	Apply(s, Frame{Rev: 1, Cars: []CarState{
		{DriverNum: 1, Code: "VER"},
		{DriverNum: 44, Code: "HAM"},
	}})

	// Frame 2 updates only driver 1; driver 44 isn't mentioned.
	_, ok := Apply(s, Frame{Rev: 2, Cars: []CarState{{DriverNum: 1, Code: "VER", Pos: 1}}})
	if !ok {
		t.Fatal("expected rev 2 to apply")
	}
	if s.Cars[44].Code != "HAM" {
		t.Errorf("unmentioned car 44 was lost: %+v", s.Cars[44])
	}
	if s.Cars[1].Pos != 1 {
		t.Errorf("mentioned car 1 was not updated: %+v", s.Cars[1])
	}
}

// A frame can carry a higher Rev/TimeMs with no car updates at all (e.g. a
// clock tick with no position change) — Rev/TimeMs must still advance.
func TestApply_EmptyCarsFrameStillAdvancesRevAndTime(t *testing.T) {
	s := NewSnapshot("demo", "replay", "Synthetic")
	Apply(s, Frame{Rev: 1, TimeMs: 100, Cars: []CarState{{DriverNum: 1, Code: "VER"}}})

	_, ok := Apply(s, Frame{Rev: 2, TimeMs: 200, Cars: nil})
	if !ok {
		t.Fatal("expected rev 2 (empty Cars) to apply")
	}
	if s.Rev != 2 || s.TimeMs != 200 {
		t.Errorf("rev/timeMs did not advance on empty-Cars frame: rev=%d timeMs=%d", s.Rev, s.TimeMs)
	}
	if s.Cars[1].Code != "VER" {
		t.Errorf("existing car lost on empty-Cars frame: %+v", s.Cars[1])
	}
}
