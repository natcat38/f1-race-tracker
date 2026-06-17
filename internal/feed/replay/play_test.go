package replay

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func writeTemp(t *testing.T, body string) string {
	t.Helper()
	p := filepath.Join(t.TempDir(), "c.jsonl")
	if err := os.WriteFile(p, []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
	return p
}

func TestReplay_HeaderAndMonotonicRevAcrossLoop(t *testing.T) {
	body := `{"track":[{"x":0,"y":0}],"label":"Lbl","maxRev":2}
{"timeMs":0,"frame":{"rev":1,"timeMs":0,"cars":[{"driverNum":1}]}}
{"timeMs":10,"frame":{"rev":2,"timeMs":10,"cars":[{"driverNum":1}]}}
`
	src, err := Load(writeTemp(t, body), 50) // 50x → fast
	if err != nil {
		t.Fatal(err)
	}
	if src.Label() != "Lbl" || src.Mode() != "replay" || len(src.Track()) != 1 {
		t.Fatalf("header wrong: label=%q mode=%q track=%d", src.Label(), src.Mode(), len(src.Track()))
	}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	ch, err := src.Events(ctx)
	if err != nil {
		t.Fatal(err)
	}
	var revs []int64
	for len(revs) < 4 { // 2 frames × 2 loops
		select {
		case fr := <-ch:
			revs = append(revs, fr.Rev)
		case <-ctx.Done():
			t.Fatalf("timed out; revs=%v", revs)
		}
	}
	for i := 1; i < len(revs); i++ {
		if revs[i] <= revs[i-1] {
			t.Errorf("rev not monotonic across loop: %v", revs)
		}
	}
}
