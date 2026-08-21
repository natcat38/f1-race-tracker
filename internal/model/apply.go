// Apply: folds a frame into a snapshot in place, idempotent on Rev and loop-aware for
// replaying clips.

package model

// maxMessages caps the rolling race-control buffer in a Snapshot.
const maxMessages = 30

// Apply folds frame f into snapshot s in place. Idempotent w.r.t. Rev: a frame
// whose Rev is not greater than s.Rev is ignored, returning (s,false).
func Apply(s *Snapshot, f Frame) (*Snapshot, bool) {
	if f.Rev <= s.Rev {
		return s, false
	}
	for _, c := range f.Cars {
		s.Cars[c.DriverNum] = c
	}
	if f.TimeMs < s.TimeMs {
		// A replaying clip loops back to its start (TimeMs decreases) rather
		// than ending — mirrors the frontend's useLapHistory/useGapHistory
		// loop-restart detection. Without this, the same finite set of baked
		// race-control messages would re-append every loop, filling the
		// rolling buffer with duplicates instead of reflecting the current
		// play-through.
		s.Messages = nil
	}
	if len(f.Messages) > 0 {
		s.Messages = append(s.Messages, f.Messages...)
		if len(s.Messages) > maxMessages {
			s.Messages = s.Messages[len(s.Messages)-maxMessages:]
		}
	}
	if len(f.Radio) > 0 {
		// ADR-0008: live radio refs accumulate, uncapped (~50-100 a session).
		// Deliberately NOT cleared by the loop-reset branch above: only replay
		// lanes loop, and replay frames never carry radio.
		s.Radio = append(s.Radio, f.Radio...)
	}
	if f.Weather != nil {
		s.Weather = f.Weather
	}
	s.TimeMs = f.TimeMs
	s.Rev = f.Rev
	return s, true
}
