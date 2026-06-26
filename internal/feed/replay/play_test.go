package replay

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestFrameAtWallclock_DeterministicAndAligned(t *testing.T) {
	rels := []int64{0, 100, 200} // 3 frames, 100ms apart
	loopLen := int64(300)

	cases := []struct {
		now     int64
		wantI   int
		wantTgt int64
	}{
		{now: 0, wantI: 0, wantTgt: 0},     // start of loop
		{now: 150, wantI: 2, wantTgt: 200}, // next frame at/after phase 150 is rel=200
		{now: 250, wantI: 0, wantTgt: 300}, // past last frame -> wrap to next loop's frame 0
		{now: 300, wantI: 0, wantTgt: 300}, // exact loop boundary
		{now: 305, wantI: 1, wantTgt: 400}, // loop 1, phase 5 -> rel=100 at 300+100
	}
	for _, c := range cases {
		i, tgt := frameAtWallclock(rels, loopLen, c.now)
		if i != c.wantI || tgt != c.wantTgt {
			t.Errorf("frameAtWallclock(now=%d) = (i=%d,tgt=%d), want (i=%d,tgt=%d)",
				c.now, i, tgt, c.wantI, c.wantTgt)
		}
	}

	// Alignment: two lanes asking at the same instant get the same answer.
	for _, now := range []int64{7, 123, 299, 1000, 1234567} {
		i1, t1 := frameAtWallclock(rels, loopLen, now)
		i2, t2 := frameAtWallclock(rels, loopLen, now)
		if i1 != i2 || t1 != t2 {
			t.Errorf("not deterministic at now=%d", now)
		}
	}
}

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

func TestLoadParsesRadioFromHeader(t *testing.T) {
	clip := `{"track":[{"x":0.1,"y":0.2}],"label":"T","maxRev":1,"radio":[{"timeMs":3300500,"driverNum":1,"clip":"https://x/VER.mp3"}]}
{"timeMs":3300000,"frame":{"rev":1,"timeMs":3300000,"cars":[{"driverNum":1,"code":"VER","team":"Red Bull","pos":1,"p":{"x":0.1,"y":0.2},"status":"OnTrack"}]}}
`
	path := filepath.Join(t.TempDir(), "clip.jsonl")
	if err := os.WriteFile(path, []byte(clip), 0o600); err != nil {
		t.Fatal(err)
	}
	src, err := Load(path, 1)
	if err != nil {
		t.Fatal(err)
	}
	radio := src.Radio()
	if len(radio) != 1 || radio[0].DriverNum != 1 || radio[0].TimeMs != 3300500 || radio[0].Clip == "" {
		t.Fatalf("radio not parsed: %+v", radio)
	}
}
