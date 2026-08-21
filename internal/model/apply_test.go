// Tests for Apply's fold: car replacement, Rev monotonicity, and the rolling
// race-control buffer.

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

// A replaying clip loops back to its start (Rev keeps climbing — the writer
// owns it — but the frame's own baked TimeMs drops back to the first frame's
// value). The rolling race-control buffer must reset on that loop restart,
// not accumulate duplicate copies of the same finite message set forever.
func TestApply_MessagesResetOnReplayLoopRestart(t *testing.T) {
	s := NewSnapshot("demo", "replay", "Synthetic")
	Apply(s, Frame{Rev: 1, TimeMs: 1000, Messages: []RaceControlMessage{{Message: "green flag"}}})
	Apply(s, Frame{Rev: 2, TimeMs: 2000, Messages: []RaceControlMessage{{Message: "yellow flag"}}})
	if len(s.Messages) != 2 {
		t.Fatalf("messages before loop restart = %d, want 2", len(s.Messages))
	}

	// Loop restarts: TimeMs drops back to (near) the clip's start even though
	// Rev keeps climbing.
	Apply(s, Frame{Rev: 3, TimeMs: 100, Messages: []RaceControlMessage{{Message: "green flag"}}})
	if len(s.Messages) != 1 || s.Messages[0].Message != "green flag" {
		t.Errorf("messages after loop restart = %+v, want reset to just the new frame's message", s.Messages)
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

func TestApplyAccumulatesRadio(t *testing.T) {
	s := NewSnapshot("live", "live", "Live F1")
	s.Rev = 1
	s.Radio = []RadioMessage{{TimeMs: 100, DriverNum: 1, Clip: "https://livetiming.formula1.com/a.mp3"}}

	_, ok := Apply(s, Frame{Rev: 2, TimeMs: 200, Radio: []RadioMessage{
		{TimeMs: 150, DriverNum: 16, Clip: "https://livetiming.formula1.com/b.mp3"},
	}})
	if !ok {
		t.Fatal("frame with a higher rev should apply")
	}
	if len(s.Radio) != 2 || s.Radio[1].DriverNum != 16 {
		t.Fatalf("radio not accumulated: %+v", s.Radio)
	}
}

// Only replay lanes loop, and replay frames never carry radio — so the loop reset
// must leave accumulated live radio alone (ADR-0008).
func TestApplyLoopResetKeepsRadio(t *testing.T) {
	s := NewSnapshot("replay", "replay", "Monza")
	s.Rev, s.TimeMs = 5, 5000
	s.Radio = []RadioMessage{{TimeMs: 100, DriverNum: 1, Clip: "https://livetiming.formula1.com/a.mp3"}}
	s.Messages = []RaceControlMessage{{Rev: 5, T: 4000, Category: "Flag", Message: "GREEN"}}

	Apply(s, Frame{Rev: 6, TimeMs: 100}) // clip loops back: TimeMs decreases
	if len(s.Messages) != 0 {
		t.Fatalf("loop reset must clear messages, got %+v", s.Messages)
	}
	if len(s.Radio) != 1 {
		t.Fatalf("loop reset must NOT clear radio, got %+v", s.Radio)
	}
}
