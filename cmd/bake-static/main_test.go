// Tests for the static-demo bake: clip reading, envelope shape, and the NDJSON output
// contract the GitHub Pages player depends on.

package main

import (
	"bufio"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func writeTempClip(t *testing.T, body string) string {
	t.Helper()
	p := filepath.Join(t.TempDir(), "clip.jsonl")
	if err := os.WriteFile(p, []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
	return p
}

func TestRun_BakesSnapshotThenFramesWithMonotonicRev(t *testing.T) {
	body := `{"track":[{"x":0,"y":0}],"label":"Test Clip"}
{"timeMs":100,"frame":{"rev":9,"timeMs":100,"cars":[{"driverNum":1,"code":"VER","team":"Red Bull","pos":1,"p":{"x":0.1,"y":0.1},"status":"OnTrack"}]}}
{"timeMs":200,"frame":{"rev":9,"timeMs":200,"cars":[{"driverNum":1,"code":"VER","team":"Red Bull","pos":1,"p":{"x":0.2,"y":0.2},"status":"OnTrack"}]}}
`
	clipPath := writeTempClip(t, body)
	outPath := filepath.Join(t.TempDir(), "out.ndjson")

	if err := run(clipPath, outPath, "static-demo"); err != nil {
		t.Fatal(err)
	}

	f, err := os.Open(outPath)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()

	var lines []string
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		if sc.Text() != "" {
			lines = append(lines, sc.Text())
		}
	}
	if len(lines) != 3 {
		t.Fatalf("got %d lines, want 3 (1 snapshot + 2 frames)", len(lines))
	}

	var env struct {
		Type string          `json:"type"`
		Data json.RawMessage `json:"data"`
	}

	if err := json.Unmarshal([]byte(lines[0]), &env); err != nil {
		t.Fatal(err)
	}
	if env.Type != "snapshot" {
		t.Errorf("line 0 type = %q, want snapshot", env.Type)
	}
	if !strings.Contains(string(env.Data), `"session":"static-demo"`) {
		t.Errorf("snapshot data missing session key: %s", env.Data)
	}

	wantRevs := []int64{1, 2}
	for i, wantRev := range wantRevs {
		if err := json.Unmarshal([]byte(lines[i+1]), &env); err != nil {
			t.Fatal(err)
		}
		if env.Type != "frame" {
			t.Errorf("line %d type = %q, want frame", i+1, env.Type)
		}
		var fd struct {
			Rev int64 `json:"rev"`
		}
		if err := json.Unmarshal(env.Data, &fd); err != nil {
			t.Fatal(err)
		}
		if fd.Rev != wantRev {
			// The source file's own rev (9, 9) must be reassigned monotonically —
			// matching what Writer.Run does against a fresh Redis session.
			t.Errorf("frame %d rev = %d, want %d (reassigned, not the file's own rev)", i, fd.Rev, wantRev)
		}
	}
}
