// Package replay reads a .jsonl clip and replays it as a frame stream.
package replay

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"time"

	"github.com/natcat38/f1-race-tracker/internal/model"
)

type clipHeader struct {
	Track  []model.Point `json:"track"`
	Label  string        `json:"label"`
	MaxRev int64         `json:"maxRev"`
}

type clipLine struct {
	TimeMs int64       `json:"timeMs"`
	Frame  model.Frame `json:"frame"`
}

type Source struct {
	track []model.Point
	label string
	lines []clipLine
	max   int64
	speed float64
}

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
	return &Source{track: hdr.Track, label: hdr.Label, lines: lines, max: hdr.MaxRev, speed: speed}, nil
}

func (s *Source) Track() []model.Point { return s.track }
func (s *Source) Label() string        { return s.label }
func (s *Source) Mode() string         { return "replay" }

// Events streams frames forever, looping. Rev stays monotonic across loops
// (offset by loop*maxRev); T is stamped to emit-time (Tech §2.9).
func (s *Source) Events(ctx context.Context) (<-chan model.Frame, error) {
	out := make(chan model.Frame)
	base := s.lines[0].TimeMs // clips may store absolute session time; play relative to the first frame
	go func() {
		defer close(out)
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
	}()
	return out, nil
}
