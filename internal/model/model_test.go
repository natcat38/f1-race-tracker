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
