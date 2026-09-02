// Contract test: the checked-in golden snapshot must parse into this package's types,
// pinning the wire shape shared with the frontend.

package model

import (
	"encoding/json"
	"os"
	"testing"
)

// TestGoldenSnapshotContract guards the Go<->TS wire contract: both sides parse
// the SAME checked-in fixture (testdata/contract/golden_snapshot.json at the repo
// root) and must agree on every field. A silent field-name/shape drift between
// this package and web/src/state/race.ts's mirrored types fails here, in CI,
// rather than as a runtime "undefined" deep in the frontend.
func TestGoldenSnapshotContract(t *testing.T) {
	raw, err := os.ReadFile("../../testdata/contract/golden_snapshot.json")
	if err != nil {
		t.Fatal(err)
	}
	var s Snapshot
	if err := json.Unmarshal(raw, &s); err != nil {
		t.Fatalf("golden fixture does not decode as model.Snapshot: %v", err)
	}

	if s.SessionKey != "contract-test" || s.Mode != ModeReplay || s.Label != "Contract Fixture" {
		t.Fatalf("top-level identity fields mismatched: %+v", s)
	}
	if s.Rev != 42 || s.TimeMs != 3300000 {
		t.Fatalf("rev/timeMs mismatched: rev=%d timeMs=%d", s.Rev, s.TimeMs)
	}
	if s.TotalLaps != 53 {
		t.Fatalf("totalLaps mismatched: %d", s.TotalLaps)
	}
	if len(s.Track) != 2 || s.Track[1].X != 0.9 {
		t.Fatalf("track mismatched: %+v", s.Track)
	}

	if len(s.Cars) != 2 {
		t.Fatalf("want 2 cars, got %d: %+v", len(s.Cars), s.Cars)
	}
	c1 := s.Cars[1]
	if c1.DriverNum != 1 || c1.Code != "VER" || c1.Team != "Red Bull" || c1.Status != StatusOnTrack {
		t.Fatalf("car 1 identity/status mismatched: %+v", c1)
	}
	if c1.Lap != 12 {
		t.Fatalf("car 1 lap mismatched: %+v", c1)
	}
	if c1.Tyre != "SOFT" || c1.TyreAge != 5 || c1.LastLapMs != 81234 || c1.BestLapMs != 80950 {
		t.Fatalf("car 1 timing fields mismatched: %+v", c1)
	}
	if c1.Speed != 312 || c1.Gear != 7 || c1.Throttle != 100 || c1.DRS != true {
		t.Fatalf("car 1 telemetry fields mismatched: %+v", c1)
	}
	if s.Cars[44].Status != StatusPit {
		t.Fatalf("car 44 status mismatched: %+v", s.Cars[44])
	}

	if len(s.Messages) != 1 || s.Messages[0].Message != "GREEN FLAG" || s.Messages[0].Category != "Flag" {
		t.Fatalf("messages mismatched: %+v", s.Messages)
	}
	if len(s.Radio) != 1 || s.Radio[0].DriverNum != 1 || s.Radio[0].Clip == "" {
		t.Fatalf("radio mismatched: %+v", s.Radio)
	}
	if len(s.LapTrace[1]) != 4 {
		t.Fatalf("lapTrace mismatched: %+v", s.LapTrace)
	}

	if len(s.Stints[1]) != 2 || s.Stints[1][1].Compound != "HARD" || s.Stints[1][1].StartLap != 15 {
		t.Fatalf("stints mismatched: %+v", s.Stints)
	}
	if len(s.PitStops[1]) != 1 || s.PitStops[1][0].Lap != 14 || s.PitStops[1][0].DurationS != 23.4 {
		t.Fatalf("pitStops mismatched: %+v", s.PitStops)
	}
	if s.Weather == nil || s.Weather.TrackTempC != 41.2 || s.Weather.AirTempC != 28.5 || s.Weather.Rainfall {
		t.Fatalf("weather mismatched: %+v", s.Weather)
	}
}
