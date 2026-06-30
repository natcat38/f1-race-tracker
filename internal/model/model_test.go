package model

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestCarStateRoundTripWithTimingFields(t *testing.T) {
	in := CarState{
		DriverNum: 1, Code: "VER", Team: "Red Bull", Pos: 1,
		P: Point{X: 0.5, Y: 0.5}, Status: "OnTrack",
		Tyre: "SOFT", TyreAge: 12,
		LastLapMs: 81234, BestLapMs: 80950,
		S1Ms: 26100, S2Ms: 28200, S3Ms: 26900,
		GapMs: 0, GapLaps: 0, IntMs: 0,
		Speed: 312, Gear: 7, Throttle: 100, Brake: 0, DRS: true,
	}
	b, err := json.Marshal(in)
	if err != nil {
		t.Fatal(err)
	}
	var out CarState
	if err := json.Unmarshal(b, &out); err != nil {
		t.Fatal(err)
	}
	if out != in {
		t.Fatalf("round trip mismatch:\n got %+v\nwant %+v", out, in)
	}
}

func TestCarStateOmitsZeroTimingFields(t *testing.T) {
	b, err := json.Marshal(CarState{DriverNum: 1, Code: "VER", Team: "x", Pos: 1, Status: "OnTrack"})
	if err != nil {
		t.Fatal(err)
	}
	s := string(b)
	for _, k := range []string{"tyreAge", "lastLapMs", "gapMs", "gear", "drs"} {
		if strings.Contains(s, k) {
			t.Errorf("expected %q omitted from %s", k, s)
		}
	}
}

func TestSnapshotRoundTripWithRadio(t *testing.T) {
	in := NewSnapshot("replay", "replay", "Monza 2024 · Race")
	in.Radio = []RadioMessage{
		{TimeMs: 3300500, DriverNum: 1, Clip: "https://livetiming.formula1.com/x/VER_1.mp3"},
		{TimeMs: 3301000, DriverNum: 16, Clip: "https://livetiming.formula1.com/x/LEC_16.mp3"},
	}
	b, err := json.Marshal(in)
	if err != nil {
		t.Fatal(err)
	}
	var out Snapshot
	if err := json.Unmarshal(b, &out); err != nil {
		t.Fatal(err)
	}
	if len(out.Radio) != 2 || out.Radio[1].DriverNum != 16 || out.Radio[0].Clip == "" {
		t.Fatalf("radio round-trip wrong: %+v", out.Radio)
	}
}

func TestSnapshotOmitsEmptyRadio(t *testing.T) {
	b, err := json.Marshal(NewSnapshot("replay", "replay", "x"))
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(b), "radio") {
		t.Fatalf("empty radio should be omitted, got %s", b)
	}
}
