// Package main is the bake-static command, which bakes a replay clip into newline-delimited WebSocket envelopes for the GitHub Pages static demo.
//
// Command bake-static reads a replay clip and writes it as a sequence of
// WebSocket wire envelopes — the same {type,data} shape internal/ws/frame.go
// encodes for real clients — to a newline-delimited JSON file. The GitHub
// Pages static demo fetches this file and feeds the frontend's existing
// applyMessage reducer directly, with no Go/Python/Redis behind it.
package main

import (
	"bufio"
	"flag"
	"fmt"
	"log"
	"os"
	"path/filepath"

	"github.com/natcat38/f1-race-tracker/internal/feed/replay"
	"github.com/natcat38/f1-race-tracker/internal/model"
	"github.com/natcat38/f1-race-tracker/internal/ws"
)

func main() {
	clip := flag.String("clip", "data/replays/monza-2024-race.jsonl", "source replay clip (.jsonl)")
	out := flag.String("out", "web/public/static-demo/monza-2024-race.ndjson", "output path (.ndjson)")
	session := flag.String("session", "static-demo", "session key baked into the snapshot")
	flag.Parse()

	if err := run(*clip, *out, *session); err != nil {
		log.Fatal(err)
	}
}

func run(clipPath, outPath, session string) error {
	src, err := replay.Load(clipPath, 1)
	if err != nil {
		return fmt.Errorf("bake-static: load clip: %w", err)
	}

	if err := os.MkdirAll(filepath.Dir(outPath), 0o755); err != nil {
		return fmt.Errorf("bake-static: mkdir: %w", err)
	}
	f, err := os.Create(outPath)
	if err != nil {
		return fmt.Errorf("bake-static: create %s: %w", outPath, err)
	}
	defer f.Close()

	w := bufio.NewWriter(f)
	if err := bake(src, session, w); err != nil {
		return err
	}
	return w.Flush()
}

// bake writes one snapshot envelope (the clip's header fields, no cars yet)
// followed by one frame envelope per clip line, in order. Each frame's Rev is
// reassigned 1..N — mirroring what Writer.Run does when publishing this same
// clip to a fresh Redis session — rather than trusting the file's own
// (advisory, possibly-repeating) Rev values.
func bake(src *replay.Source, session string, w *bufio.Writer) error {
	snap := model.NewSnapshot(session, src.Mode(), src.Label())
	snap.Track = src.Track()
	snap.Corners = src.Corners()
	snap.Radio = src.Radio()
	snap.LapTrace = src.LapTrace()
	snap.TotalLaps = src.TotalLaps()
	snap.Stints = src.Stints()
	snap.PitStops = src.PitStops()
	snap.PedalTraces = src.PedalTraces()
	snap.SectorDominance = src.SectorDominance()

	sb, err := ws.EncodeSnapshot(snap)
	if err != nil {
		return fmt.Errorf("bake-static: encode snapshot: %w", err)
	}
	if _, err := w.Write(append(sb, '\n')); err != nil {
		return fmt.Errorf("bake-static: write snapshot: %w", err)
	}

	for i, fr := range src.Frames() {
		fr.Rev = int64(i + 1)
		fr.SessionKey = session
		fb, err := ws.EncodeFrame(fr)
		if err != nil {
			return fmt.Errorf("bake-static: encode frame %d: %w", i, err)
		}
		if _, err := w.Write(append(fb, '\n')); err != nil {
			return fmt.Errorf("bake-static: write frame %d: %w", i, err)
		}
	}
	return nil
}
