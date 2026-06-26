// Package replay reads a .jsonl clip and replays it as a frame stream.
package replay

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"sort"
	"time"

	"github.com/natcat38/f1-race-tracker/internal/model"
)

type clipHeader struct {
	Track  []model.Point        `json:"track"`
	Label  string               `json:"label"`
	MaxRev int64                `json:"maxRev"`
	Radio  []model.RadioMessage `json:"radio"`
}

type clipLine struct {
	TimeMs int64       `json:"timeMs"`
	Frame  model.Frame `json:"frame"`
}

type Source struct {
	track []model.Point
	radio []model.RadioMessage
	label string
	lines []clipLine
	max   int64
	speed float64

	phaseWallclock bool // when true, loop position is derived from the wall clock (M4 compare)
}

// SetWallclockPhase makes Events derive playback position from the wall clock, so
// two lanes with identical-length clips stay phase-aligned with no coordinator.
func (s *Source) SetWallclockPhase(on bool) { s.phaseWallclock = on }

// Load reads a clip. speed > 1 plays faster; <= 0 defaults to 1.
func Load(path string, speed float64) (*Source, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, fmt.Errorf("replay: open %s: %w", path, err)
	}
	defer f.Close()
	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 0, 1<<20), 16<<20)

	if !sc.Scan() {
		return nil, fmt.Errorf("replay: %s is empty", path)
	}
	var hdr clipHeader
	if err := json.Unmarshal(sc.Bytes(), &hdr); err != nil {
		return nil, fmt.Errorf("replay: bad header: %w", err)
	}
	var lines []clipLine
	for sc.Scan() {
		if len(sc.Bytes()) == 0 {
			continue
		}
		var ln clipLine
		if err := json.Unmarshal(sc.Bytes(), &ln); err != nil {
			return nil, fmt.Errorf("replay: bad line: %w", err)
		}
		lines = append(lines, ln)
	}
	if err := sc.Err(); err != nil {
		return nil, fmt.Errorf("replay: read: %w", err)
	}
	if len(lines) == 0 {
		return nil, fmt.Errorf("replay: %s has no frames", path)
	}
	if speed <= 0 {
		speed = 1
	}
	if hdr.MaxRev == 0 {
		hdr.MaxRev = lines[len(lines)-1].Frame.Rev
	}
	return &Source{track: hdr.Track, radio: hdr.Radio, label: hdr.Label, lines: lines, max: hdr.MaxRev, speed: speed}, nil
}

func (s *Source) Track() []model.Point        { return s.track }
func (s *Source) Radio() []model.RadioMessage { return s.radio }
func (s *Source) Label() string               { return s.label }
func (s *Source) Mode() string                { return "replay" }

// Events streams frames forever, looping. T is stamped to emit-time (Tech §2.9).
// Rev on the emitted frame is advisory — the writer reassigns a monotonic Rev.
func (s *Source) Events(ctx context.Context) (<-chan model.Frame, error) {
	out := make(chan model.Frame)
	base := s.lines[0].TimeMs // clips may store absolute session time; play relative to the first frame
	go func() {
		defer close(out)
		if s.phaseWallclock {
			s.playWallclock(ctx, out, base)
			return
		}
		s.playFromStart(ctx, out, base)
	}()
	return out, nil
}

// playFromStart is the original behaviour: each loop starts when the previous ends.
func (s *Source) playFromStart(ctx context.Context, out chan<- model.Frame, base int64) {
	for loop := int64(0); ; loop++ {
		start := time.Now()
		for _, ln := range s.lines {
			target := time.Duration(float64(ln.TimeMs-base) * float64(time.Millisecond) / s.speed)
			if wait := target - time.Since(start); wait > 0 {
				select {
				case <-ctx.Done():
					return
				case <-time.After(wait):
				}
			}
			fr := ln.Frame
			fr.Rev = ln.Frame.Rev + loop*s.max
			fr.T = time.Now().UnixMilli()
			select {
			case <-ctx.Done():
				return
			case out <- fr:
			}
		}
	}
}

// playWallclock derives the loop position from the wall clock so independent lanes
// with identical-length clips stay phase-aligned.
func (s *Source) playWallclock(ctx context.Context, out chan<- model.Frame, base int64) {
	n := len(s.lines)
	rels := make([]int64, n)
	for i, ln := range s.lines {
		rels[i] = ln.TimeMs - base
	}
	gap := int64(0)
	if n > 1 {
		gap = rels[n-1] / int64(n-1) // average inter-frame gap
	}
	loopLen := rels[n-1] + gap
	if loopLen <= 0 {
		loopLen = 1
	}

	i, target := frameAtWallclock(rels, loopLen, time.Now().UnixMilli())
	loopBase := target - rels[i]
	for {
		if wait := target - time.Now().UnixMilli(); wait > 0 {
			select {
			case <-ctx.Done():
				return
			case <-time.After(time.Duration(wait) * time.Millisecond):
			}
		}
		fr := s.lines[i].Frame
		fr.T = time.Now().UnixMilli()
		select {
		case <-ctx.Done():
			return
		case out <- fr:
		}
		i++
		if i == n {
			i = 0
			loopBase += loopLen
		}
		target = loopBase + rels[i]
	}
}

// frameAtWallclock is pure: for a wall-clock instant nowMs it returns the index of
// the next frame to emit and the absolute wall-time (ms) at which to emit it.
// rels[i] is frame i's time relative to the first frame; loopLen is the loop period.
func frameAtWallclock(rels []int64, loopLen, nowMs int64) (i int, targetMs int64) {
	loopBase := (nowMs / loopLen) * loopLen
	phase := nowMs - loopBase
	i = sort.Search(len(rels), func(k int) bool { return rels[k] >= phase })
	if i == len(rels) { // past the last frame's phase -> first frame of the next loop
		i = 0
		loopBase += loopLen
	}
	return i, loopBase + rels[i]
}
