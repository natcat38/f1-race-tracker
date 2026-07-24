# Static GitHub Pages Demo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a frontend-only replay demo on GitHub Pages that plays the committed Monza clip with no Python/Redis/Go behind it, as a third front door alongside the README/video and `docker-compose up`.

**Architecture:** A new Go command (`cmd/bake-static`) reuses the existing replay-load and WebSocket-envelope-encoding code to bake the clip into the exact wire-format messages the frontend already knows how to consume. A new frontend module (`staticReplay.ts`) fetches that baked file and feeds the same `applyMessage` reducer on a client-side clock, swapping in for `socket.ts`'s `connectRace`. A new CI workflow bakes the clip, builds the frontend with a Pages-specific base path, and deploys to GitHub Pages on push to `main`.

**Tech Stack:** Go 1.26 (bake command), TypeScript/Vite/React (static player), GitHub Actions (`actions/deploy-pages`).

**Decisions already locked (see `docs/adr/0006-static-gh-pages-demo-as-third-front-door.md`, `CONTEXT.md`'s "Static demo" entry) — do not re-derive these:**
- Additive third front door, not a replacement for README/video or `docker-compose`.
- v1 ships exactly one clip (`data/replays/monza-2024-race.jsonl`, the current `CLIP_FILE` default) with full feature parity except: no live source (toggle hidden entirely, not shown disabled), no compare/ghost overlay (deferred — those need two synced clips).
- No custom decimation/quantization. Gzip alone takes the 24 MB raw clip to ~927 KB (measured), under a 2 MB budget. GitHub Pages' Fastly CDN serves gzip automatically.
- The bake step reuses the existing Go wire-encoding (`internal/ws/frame.go`'s `encodeSnapshot`/`encodeFrame`), not a reimplementation in TypeScript or Python.
- The static player ports the Go replay player's real per-frame `timeMs` pacing and looping (`internal/feed/replay/play.go`'s `playFromStart`), not a flat interval.

---

### Task 1: `replay.Source.Frames()` — expose the clip's frames without real-time pacing

**Why:** `Source.Events()` streams frames paced in real time (the current clip takes ~7 minutes to play through) — fine for the actual replay writer, useless for a one-shot bake tool that needs the whole clip immediately. This is a small, pure getter alongside the existing `Events()`.

**Files:**
- Modify: `internal/feed/replay/play.go`
- Test: `internal/feed/replay/play_test.go`

- [ ] **Step 1: Write the failing test**

Add to `internal/feed/replay/play_test.go` (same file as `TestReplay_HeaderAndMonotonicRevAcrossLoop`, which already has the `writeTemp` helper — reuse it):

```go
func TestSource_Frames_ReturnsAllInFileOrder(t *testing.T) {
	body := `{"track":[{"x":0,"y":0}],"label":"Lbl","maxRev":3}
{"timeMs":100,"frame":{"rev":1,"timeMs":100,"cars":[{"driverNum":1}]}}
{"timeMs":200,"frame":{"rev":2,"timeMs":200,"cars":[{"driverNum":1}]}}
{"timeMs":300,"frame":{"rev":3,"timeMs":300,"cars":[{"driverNum":1}]}}
`
	src, err := Load(writeTemp(t, body), 1)
	if err != nil {
		t.Fatal(err)
	}
	frames := src.Frames()
	if len(frames) != 3 {
		t.Fatalf("got %d frames, want 3", len(frames))
	}
	for i, want := range []int64{100, 200, 300} {
		if frames[i].TimeMs != want {
			t.Errorf("frames[%d].TimeMs = %d, want %d", i, frames[i].TimeMs, want)
		}
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `go test ./internal/feed/replay/... -run TestSource_Frames_ReturnsAllInFileOrder -v`
Expected: FAIL with `src.Frames undefined (type *Source has no field or method Frames)`

- [ ] **Step 3: Write minimal implementation**

Add to `internal/feed/replay/play.go`, near the other exported accessor methods (`Track()`, `Radio()`, etc., around line 95-100):

```go
// Frames returns every frame in the clip, in file order, with each frame's Rev
// exactly as recorded in the file (advisory — a caller publishing to a fresh
// session should reassign a monotonic Rev, as Writer.Run and cmd/bake-static do).
// Unlike Events, this does not pace playback in real time: it's for tooling that
// needs the whole clip immediately, not a live-paced stream.
func (s *Source) Frames() []model.Frame {
	out := make([]model.Frame, len(s.lines))
	for i, ln := range s.lines {
		out[i] = ln.Frame
	}
	return out
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `go test ./internal/feed/replay/... -v`
Expected: PASS (all tests in the package, including the pre-existing ones)

- [ ] **Step 5: Commit**

```bash
git add internal/feed/replay/play.go internal/feed/replay/play_test.go
git commit -m "feat(replay): expose Source.Frames() for non-realtime tooling"
```

---

### Task 2: Export the wire-envelope encoders

**Why:** `internal/ws/frame.go`'s `encodeSnapshot`/`encodeFrame` are unexported — the new bake command lives in a different package and needs to call them directly (per the ADR decision: reuse this encoding, don't reimplement it, not even the small envelope-wrapping logic). This is a pure rename with no behavior change.

**Files:**
- Modify: `internal/ws/frame.go`
- Modify: `internal/ws/hub.go` (3 call sites)
- Modify: `internal/ws/frame_test.go` (3 call sites)

- [ ] **Step 1: Rename in `internal/ws/frame.go`**

```go
func EncodeSnapshot(s *model.Snapshot) ([]byte, error) {
	d, err := json.Marshal(s)
	if err != nil {
		return nil, err
	}
	return json.Marshal(envelope{Type: "snapshot", Data: d})
}

func EncodeFrame(f model.Frame) ([]byte, error) {
	// A zero-value frame (Rev 0, no cars) is never a real broadcast — Rev 0 is the
	// "no frame yet" sentinel the hub's stale check assumes. Refuse it rather than
	// silently fan out an empty frame.
	if f.Rev == 0 && len(f.Cars) == 0 {
		return nil, fmt.Errorf("ws: refusing to encode zero-value frame")
	}
	d, err := json.Marshal(f)
	if err != nil {
		return nil, err
	}
	return json.Marshal(envelope{Type: "frame", Data: d})
}
```

- [ ] **Step 2: Update call sites in `internal/ws/hub.go`**

Three call sites (lines 31, 70, 92 as of this plan — confirm with `grep -n encodeFrame\|encodeSnapshot internal/ws/hub.go` since line numbers shift):
- `encodeFrame(f)` → `EncodeFrame(f)`
- `encodeSnapshot(h.snapshot)` → `EncodeSnapshot(h.snapshot)`
- `encodeSnapshot(snap)` → `EncodeSnapshot(snap)`

- [ ] **Step 3: Update call sites in `internal/ws/frame_test.go`**

Three call sites (lines 13, 35, 59):
- `encodeSnapshot(s)` → `EncodeSnapshot(s)`
- `encodeFrame(f)` → `EncodeFrame(f)`
- `encodeFrame(model.Frame{})` → `EncodeFrame(model.Frame{})`

- [ ] **Step 4: Run the full Go test suite to verify nothing broke**

Run: `gofmt -l . && go vet ./... && go test ./...`
Expected: PASS, no gofmt diffs, no vet warnings

- [ ] **Step 5: Commit**

```bash
git add internal/ws/frame.go internal/ws/hub.go internal/ws/frame_test.go
git commit -m "refactor(ws): export EncodeSnapshot/EncodeFrame for reuse outside the package"
```

---

### Task 3: `cmd/bake-static` — bake a clip into wire-format NDJSON

**Why:** This is the crux of the whole bet — turn the internal clip format into the exact sequence of `{type,data}` envelopes the frontend's `parseMsg`/`applyMessage` already know how to consume, using only existing, already-tested encoding logic.

**Files:**
- Create: `cmd/bake-static/main.go`
- Test: `cmd/bake-static/main_test.go`

- [ ] **Step 1: Write the failing test**

Create `cmd/bake-static/main_test.go`:

```go
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `go test ./cmd/bake-static/... -v`
Expected: FAIL — `undefined: run` (package doesn't exist yet)

- [ ] **Step 3: Write minimal implementation**

Create `cmd/bake-static/main.go`:

```go
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
	snap.Radio = src.Radio()
	snap.LapTrace = src.LapTrace()
	snap.TotalLaps = src.TotalLaps()
	snap.Stints = src.Stints()

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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `go test ./cmd/bake-static/... -v`
Expected: PASS

- [ ] **Step 5: Manually bake the real clip and eyeball it**

```bash
go run ./cmd/bake-static --clip data/replays/monza-2024-race.jsonl --out /tmp/monza-2024-race.ndjson --session static-demo
wc -l /tmp/monza-2024-race.ndjson    # expect 4322 (1 snapshot + 4321 frames)
head -c 300 /tmp/monza-2024-race.ndjson
gzip -9 -c /tmp/monza-2024-race.ndjson | wc -c    # expect roughly ~900KB-1MB, confirming the earlier gzip measurement still holds for the wire-format shape
```

- [ ] **Step 6: Run the full Go test suite**

Run: `gofmt -l . && go vet ./... && go test ./...`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add cmd/bake-static/main.go cmd/bake-static/main_test.go
git commit -m "feat(bake-static): bake a replay clip into wire-format NDJSON for the static demo"
```

---

### Task 4: `staticReplay.ts` — the frontend static player

**Why:** This is the `socket.ts` swap the whole bet's frontend seam is built on: same `(onState, onStatus) => closeFn` interface as `connectRace`, but reads the baked file and paces playback on the frames' own `timeMs`, looping forever — porting `play.go`'s `playFromStart` logic into TypeScript.

**Files:**
- Create: `web/src/realtime/staticReplay.ts`
- Test: `web/src/realtime/staticReplay.test.ts`

- [ ] **Step 1: Write the failing test**

Create `web/src/realtime/staticReplay.test.ts` (mirrors `socket.test.ts`'s conventions — fake timers, a fake global):

```typescript
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { connectStaticReplay } from './staticReplay';
import type { RaceState } from '../state/race';

const CLIP_NDJSON = [
  JSON.stringify({ type: 'snapshot', data: { session: 'static-demo', mode: 'replay', label: 'Test', cars: {}, timeMs: 0, rev: 0 } }),
  JSON.stringify({ type: 'frame', data: { rev: 1, timeMs: 100, cars: [{ driverNum: 1, code: 'VER', team: 'Red Bull', pos: 1, p: { x: 0.1, y: 0.1 }, status: 'OnTrack' }] } }),
  JSON.stringify({ type: 'frame', data: { rev: 2, timeMs: 300, cars: [{ driverNum: 1, code: 'VER', team: 'Red Bull', pos: 1, p: { x: 0.2, y: 0.2 }, status: 'OnTrack' }] } }),
].join('\n') + '\n';

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, text: () => Promise.resolve(CLIP_NDJSON) })));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('connectStaticReplay', () => {
  test('applies the snapshot then the first frame immediately, later frames paced by their timeMs delta', async () => {
    const states: RaceState[] = [];
    connectStaticReplay((s) => states.push(s));

    // The first frame defines its own zero-point (offset = its own timeMs minus
    // itself = 0) — mirrors play.go's `base := lines[0].TimeMs`, where the first
    // emitted frame always has target=0. So the snapshot AND the first frame both
    // play at offset 0, back to back, with no artificial delay between them.
    await vi.waitFor(() => expect(states.length).toBeGreaterThanOrEqual(2), { interval: 1 });
    expect(states[0].rev).toBe(0); // snapshot
    expect(states[1].rev).toBe(1); // first frame, right behind it

    await vi.advanceTimersByTimeAsync(200); // second frame is 200ms after the first (300 - 100)
    expect(states.at(-1)?.rev).toBe(2);
  });

  test('loops back to the first frame after the last frame, without re-emitting the snapshot, and Rev keeps climbing', async () => {
    const states: RaceState[] = [];
    connectStaticReplay((s) => states.push(s));
    await vi.waitFor(() => expect(states.length).toBeGreaterThanOrEqual(2), { interval: 1 }); // snapshot + frame 1

    await vi.advanceTimersByTimeAsync(200); // frame 2, rev 2 (end of clip)
    await vi.advanceTimersByTimeAsync(50);  // past the end -> loop restarts at frame 1, not the snapshot

    // The restarted frame 1 is baked with rev 1, which is <= the rev 2 the state
    // already reached — applyMessage would silently drop it as stale (CONTEXT.md's
    // Rev invariant) unless its rev is bumped past the previous lap's max (2),
    // landing at 1 + 1*2 = 3. This is the whole point of the test: prove Rev keeps
    // climbing across a loop restart instead of freezing the map.
    expect(states.at(-1)?.rev).toBe(3);
  });

  test('the returned close function stops scheduling further frames', async () => {
    const states: RaceState[] = [];
    const close = connectStaticReplay((s) => states.push(s));
    await vi.waitFor(() => expect(states.length).toBeGreaterThanOrEqual(2), { interval: 1 });

    close();
    const countAtClose = states.length;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(states.length).toBe(countAtClose); // nothing scheduled after close
  });

  test('onStatus reports connecting then live', async () => {
    const statuses: string[] = [];
    connectStaticReplay(() => {}, (s) => statuses.push(s));
    expect(statuses[0]).toBe('connecting');
    await vi.waitFor(() => expect(statuses).toContain('live'), { interval: 1 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npm test -- staticReplay`
Expected: FAIL — cannot find module `./staticReplay`

- [ ] **Step 3: Write minimal implementation**

Create `web/src/realtime/staticReplay.ts`:

```typescript
import { applyMessage, emptyState, parseMsg, type RaceState } from '../state/race';
import type { ConnStatus } from './socket';

// race.ts's Msg union isn't exported (it's an internal detail of parseMsg's
// return type) — alias it here once so every use below refers to the same
// name instead of repeating the ReturnType<typeof parseMsg> gymnastics.
type Msg = NonNullable<ReturnType<typeof parseMsg>>;

const DEFAULT_CLIP_URL = `${import.meta.env.BASE_URL}static-demo/monza-2024-race.ndjson`;

// connectStaticReplay mirrors connectRace's interface (onState/onStatus/close-fn)
// but reads a baked NDJSON file (produced by cmd/bake-static) instead of opening
// a WebSocket, pacing playback on each frame's own relative timeMs offset and
// looping forever — the same algorithm as the Go replay player's playFromStart
// (internal/feed/replay/play.go), ported here since there's no Go process to
// pace it for us in a static build.
export function connectStaticReplay(
  onState: (s: RaceState) => void,
  onStatus?: (status: ConnStatus) => void,
  clipUrl: string = DEFAULT_CLIP_URL,
): () => void {
  let state = emptyState();
  let closed = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let live = false;

  onStatus?.('connecting');

  fetch(clipUrl)
    .then((res) => {
      if (!res.ok) throw new Error(`static demo: fetch failed (${res.status})`);
      return res.text();
    })
    .then((text) => {
      if (closed) return;
      const messages = text
        .split('\n')
        .filter((line) => line.length > 0)
        .map((line) => {
          try {
            return parseMsg(JSON.parse(line));
          } catch {
            return null;
          }
        })
        .filter((m): m is Msg => m !== null);
      if (messages.length === 0) {
        console.error('connectStaticReplay: baked clip had no valid messages');
        return;
      }
      schedulePlayback(messages);
    })
    .catch((err) => {
      console.error('connectStaticReplay: failed to load clip', err);
    });

  function schedulePlayback(messages: Msg[]) {
    // Every frame's timeMs, relative to the first frame's timeMs — mirrors
    // play.go's `base := s.lines[0].TimeMs`. The snapshot (if any) always plays
    // at offset 0, same as the Go player's first-message-is-current-state model.
    const frameStartIndex = messages.findIndex((m) => m.type === 'frame');
    const frameBase = frameStartIndex >= 0 ? messages[frameStartIndex].data.timeMs : 0;
    const offsets = messages.map((m) => (m.type === 'frame' ? m.data.timeMs - frameBase : 0));
    // Where a loop restart resumes: the first FRAME, not index 0. The synthetic
    // baked snapshot (empty cars, the pre-playback baseline) plays exactly once,
    // on the very first pass — re-emitting it every lap would flash the map back
    // to empty on every loop, and production never does this either: a real
    // replay loop restart is detected by TimeMs decreasing and only clears the
    // rolling message buffer (internal/model/apply.go), it never re-sends a
    // from-scratch empty snapshot.
    const loopRestartIndex = frameStartIndex >= 0 ? frameStartIndex : 0;
    // applyMessage drops any frame whose Rev isn't greater than the state's
    // current Rev (CONTEXT.md: "Rev ... must never reset — not across a replay
    // loop"). cmd/bake-static bakes Rev as 1..N for one pass, so replaying the
    // same baked messages verbatim on lap 2 would have every frame's Rev <= the
    // Rev the first lap already reached, silently dropped as stale — freezing
    // the map after one lap. Mirror play.go's `fr.Rev = ln.Frame.Rev + loop*s.max`:
    // bump every frame's Rev by (completed laps * the highest baked Rev) so Rev
    // keeps climbing forever, exactly like the real writer does across a loop.
    const maxRev = messages.reduce((max, m) => (m.type === 'frame' ? Math.max(max, m.data.rev) : max), 0);
    let lapsCompleted = 0;

    let loopStart = Date.now();

    const playFrom = (i: number) => {
      if (closed) return;
      if (i >= messages.length) {
        lapsCompleted++;
        loopStart = Date.now();
        timer = setTimeout(() => playFrom(loopRestartIndex), 0);
        return;
      }
      const wait = Math.max(0, offsets[i] - (Date.now() - loopStart));
      timer = setTimeout(() => {
        const msg = messages[i];
        const bumped: Msg = msg.type === 'frame' && lapsCompleted > 0
          ? { ...msg, data: { ...msg.data, rev: msg.data.rev + lapsCompleted * maxRev } }
          : msg;
        state = applyMessage(state, bumped);
        if (!live) { live = true; onStatus?.('live'); }
        onState(state);
        playFrom(i + 1);
      }, wait);
    };

    playFrom(0);
  }

  return () => {
    closed = true;
    if (timer) clearTimeout(timer);
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npm test -- staticReplay`
Expected: PASS

- [ ] **Step 5: Run the full web verification gate**

Run: `cd web && npm run lint -- --max-warnings 0 && npm run build && npm test`
Expected: PASS. If `npm run build` deletes `web/dist/.gitkeep`, that's expected until Task 7 — restore it manually for now: `git checkout web/dist/.gitkeep`

- [ ] **Step 6: Commit**

```bash
git add web/src/realtime/staticReplay.ts web/src/realtime/staticReplay.test.ts
git checkout web/dist/.gitkeep  # restore if npm run build wiped it
git commit -m "feat(web): add connectStaticReplay, the static-demo socket.ts swap"
```

---

### Task 5: Wire the static player into `App.tsx`

**Why:** Select `connectStaticReplay` vs `connectRace` at build time via a Vite env var, and hide the source toggle (per the locked design decision — a control that can't do anything shouldn't be shown, even disabled).

**Files:**
- Modify: `web/src/App.tsx`

- [ ] **Step 1: Make the change**

In `web/src/App.tsx`, update the imports and the two places that reference `connectRace`/`SourceToggle`:

```typescript
import { connectRace, type ConnStatus } from './realtime/socket';
import { connectStaticReplay } from './realtime/staticReplay';
```

```typescript
// Build-time flag: VITE_STATIC_DEMO=true selects the file-backed static player
// instead of the real WebSocket connection. Set only by the GitHub Pages build
// (see .github/workflows/pages.yml) — docker-compose and local dev never set it.
const STATIC_DEMO = import.meta.env.VITE_STATIC_DEMO === 'true';
```

Replace:
```typescript
  useEffect(() => connectRace(setState, setStatus), []);
```
with:
```typescript
  useEffect(() => (STATIC_DEMO ? connectStaticReplay : connectRace)(setState, setStatus), []);
```

Replace:
```typescript
      <StatusRail active="board" state={state} status={status} staleSec={staleSec}>
        <SourceToggle state={state} />
      </StatusRail>
```
with:
```typescript
      <StatusRail active="board" state={state} status={status} staleSec={staleSec}>
        {!STATIC_DEMO && <SourceToggle state={state} />}
      </StatusRail>
```

- [ ] **Step 2: Run the web verification gate**

Run: `cd web && npm run lint -- --max-warnings 0 && npm run build && npm test`
Expected: PASS (this doesn't add new automated coverage — `App.tsx`'s existing tests, if any, should still pass; the env-flag branch itself is exercised manually in Task 8 once the Pages build exists)

- [ ] **Step 3: Commit**

```bash
git add web/src/App.tsx
git checkout web/dist/.gitkeep  # restore if npm run build wiped it
git commit -m "feat(web): select connectStaticReplay and hide the source toggle in the static-demo build"
```

---

### Task 6: Conditional Vite `base` path

**Why:** GitHub Pages project sites serve under `/f1-race-tracker/`, not `/`. `docker-compose` must keep `/`. One env var (`VITE_STATIC_DEMO`, already introduced in Task 5) drives both the frontend's source-selection branch and this build-time base path — no second flag needed.

**Files:**
- Modify: `web/vite.config.ts`

- [ ] **Step 1: Make the change**

Replace the whole file:

```typescript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // GitHub Pages project sites serve under /<repo>/, not /. docker-compose and
  // local dev never set VITE_STATIC_DEMO, so they keep the default '/'.
  base: process.env.VITE_STATIC_DEMO === 'true' ? '/f1-race-tracker/' : '/',
  server: {
    proxy: {
      '/ws': { target: 'ws://localhost:8080', ws: true },
      '/control': 'http://localhost:8080',
    },
  },
})
```

- [ ] **Step 2: Verify both base paths build correctly**

```bash
cd web
npm run build && grep -o 'src="[^"]*main[^"]*"' dist/index.html   # expect /assets/... (base '/')
VITE_STATIC_DEMO=true npm run build && grep -o 'src="[^"]*main[^"]*"' dist/index.html   # expect /f1-race-tracker/assets/...
```
Expected: the asset path prefix changes between the two runs, confirming `base` takes effect.

- [ ] **Step 3: Run the full web verification gate**

Run: `cd web && npm run lint -- --max-warnings 0 && npm run build && npm test`
Expected: PASS (this last `npm run build` — without `VITE_STATIC_DEMO` — leaves `dist/` in the `docker-compose`-compatible state; don't leave a Pages-based `dist/` sitting in the working tree)

- [ ] **Step 4: Commit**

```bash
git add web/vite.config.ts
git checkout web/dist/.gitkeep  # restore if npm run build wiped it
git commit -m "feat(web): conditional Vite base path for the GitHub Pages build"
```

---

### Task 7: Fix #38 properly — stop `vite build` from wiping `web/dist/.gitkeep`, without breaking CI

**Why:** Issue #38 proposed untracking `web/dist/.gitkeep` entirely. That would break the `go` CI job: `web/embed.go` has `//go:embed all:dist`, and on a clean checkout (the `go` job never runs `npm ci`/`npm run build` — it's a separate job from `web`), an empty `dist/` directory makes `go vet ./...`/`go test ./...` fail to compile with "pattern all:dist: no matching files found". `.gitkeep` must stay tracked. The actual annoyance — manually restoring it after every local `npm run build` — is what to fix, with an npm lifecycle hook (native npm feature, no new dependency).

**Files:**
- Modify: `web/package.json`

- [ ] **Step 1: Make the change**

In `web/package.json`, add a `postbuild` script (npm runs this automatically after `build`, no extra wiring needed):

```json
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "postbuild": "node -e \"require('fs').closeSync(require('fs').openSync('dist/.gitkeep','a'))\"",
    "lint": "eslint .",
    "preview": "vite preview",
    "test": "vitest run"
  },
```

- [ ] **Step 2: Verify it actually fixes the annoyance**

```bash
cd web
npm run build
git status ../web/dist/.gitkeep   # expect: no changes (not deleted)
```
Expected: `git status` shows no modification to `web/dist/.gitkeep` — previously this would show `D web/dist/.gitkeep`.

- [ ] **Step 3: Run the full web verification gate**

Run: `cd web && npm run lint -- --max-warnings 0 && npm run build && npm test`
Expected: PASS

- [ ] **Step 4: Verify the Go CI job still works from a clean checkout perspective**

```bash
gofmt -l . && go vet ./... && go test ./...
```
Expected: PASS — confirms `web/dist/.gitkeep` being present (never removed from git) keeps `go vet`/`go test` compiling `web/embed.go` successfully.

- [ ] **Step 5: Commit**

```bash
git add web/package.json
git commit -m "fix(web): restore web/dist/.gitkeep via a postbuild hook instead of untracking it

Closes #38 with a different fix than originally proposed: untracking
.gitkeep would break the 'go' CI job, which never runs npm run build
before go vet/go test on a clean checkout, and web/embed.go's
'//go:embed all:dist' fails to compile against a truly empty dist/."
```

---

### Task 8: `.github/workflows/pages.yml` — bake, build, deploy

**Why:** Automate the whole pipeline: bake the clip with the Go tool from Task 3, build the frontend with the Pages base from Task 6, deploy via GitHub's official Pages actions. Additive — doesn't touch `ci.yml` or `okf.yml`.

**Files:**
- Create: `.github/workflows/pages.yml`

- [ ] **Step 1: Write the workflow**

```yaml
name: Deploy static demo

on:
  push:
    branches: [main]
    paths:
      - 'web/**'
      - 'cmd/bake-static/**'
      - 'internal/**'
      - 'data/replays/monza-2024-race.jsonl'
      - '.github/workflows/pages.yml'
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: true

jobs:
  deploy:
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - uses: actions/checkout@v7

      - uses: actions/setup-go@v7
        with:
          go-version-file: go.mod
          cache-dependency-path: go.sum

      - name: Bake the static-demo clip
        run: go run ./cmd/bake-static --clip data/replays/monza-2024-race.jsonl --out web/public/static-demo/monza-2024-race.ndjson --session static-demo

      - uses: actions/setup-node@v7
        with:
          node-version: '20'
          cache: npm
          cache-dependency-path: web/package-lock.json

      - run: npm ci
        working-directory: web

      - name: Build (static-demo base path + player)
        run: npm run build
        working-directory: web
        env:
          VITE_STATIC_DEMO: 'true'

      - uses: actions/configure-pages@v5

      - uses: actions/upload-pages-artifact@v4
        with:
          path: web/dist

      - uses: actions/deploy-pages@v4
        id: deployment
```

- [ ] **Step 2: One-time manual repo setting (cannot be done from a workflow file)**

In the GitHub repo settings, under **Settings → Pages → Source**, select **GitHub Actions**. This is a one-time manual step outside this plan's code changes — flag it to whoever merges this, it won't deploy without it.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/pages.yml
git commit -m "ci: add GitHub Pages deploy workflow for the static demo"
```

- [ ] **Step 4: Verify after pushing (post-merge, not local)**

Once this is on `main` and the repo setting from Step 2 is done, check the Actions tab for the "Deploy static demo" run, then visit `https://natcat38.github.io/f1-race-tracker/` and confirm: the map animates, the timing tower populates, no source toggle is visible, and the browser devtools Network tab shows the `.ndjson` fetch returned `content-encoding: gzip`.

---

### Task 9: README — three front doors

**Why:** The README currently only describes the README/video + `docker-compose` split. Add the static demo as the third, with the same "quick look, not the real system" framing locked in the ADR.

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Read the current README's relevant section**

Run: `grep -n "docker-compose\|docker compose\|hosting" README.md`
Find the section describing how to run/experience the project (likely near the top, a "Quick start" or "Demo" section).

- [ ] **Step 2: Add a "quick look" callout**

Add a short section (exact placement depends on the README's current structure — insert it before or alongside the `docker-compose up` instructions, whichever reads more naturally as "try this first, then this if you want the real thing"):

```markdown
## Quick look (no clone required)

**[Live static demo →](https://natcat38.github.io/f1-race-tracker/)** — a frontend-only build that plays back one recorded clip, client-side, with no backend running. This is the fastest way to see what the project does, but it's a simplified artifact, not the real system: no live source, no cross-year comparison, and nothing here proves the polyglot pipeline actually works.

For that, run it for real:
```

(followed by the existing `docker-compose up` instructions, unchanged)

- [ ] **Step 3: Verify links resolve**

The repo's `docs-links` CI job (`lycheeverse/lychee-action`) checks `README.md` — a broken link fails CI. Since the Pages URL won't exist until Task 8's workflow has run at least once, either add this README change in the same PR as Task 8 (so both merge together and the link is live by the time CI re-checks it) or verify manually after the first successful Pages deploy.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: add the static demo as a third front door in the README"
```

---

### Task 10: Full verification gate and final check

**Why:** Confirm the whole branch is clean and every language's checks pass together, matching what CI will run.

- [ ] **Step 1: Go**

```bash
gofmt -l . && go vet ./... && go test ./...
```
Expected: PASS, no output from gofmt

- [ ] **Step 2: Web**

```bash
cd web && npm ci && npm run lint -- --max-warnings 0 && npm run build && npm test
git checkout web/dist/.gitkeep  # only needed if postbuild hook (Task 7) isn't yet merged when running this manually; once merged this is a no-op
```
Expected: PASS

- [ ] **Step 3: Ingest/bench (unaffected by this bet, but part of the full gate)**

```bash
cd ingest && python -m pytest . && ruff check .
cd ../bench && python -m pytest .
```
Expected: PASS

- [ ] **Step 4: Confirm git status is clean**

```bash
git status
```
Expected: no unexpected modified/untracked files (in particular, no stray `web/dist/` contents beyond `.gitkeep`, no leftover `web/public/static-demo/` from local testing — that directory is `.gitignore`-able since it's only ever produced by CI; add `web/public/static-demo/` to `.gitignore` if a local bake run leaves it behind)

- [ ] **Step 5: Final commit if `.gitignore` needed updating**

```bash
git add .gitignore
git commit -m "chore: gitignore the locally-baked static-demo output"
```

---

## After this plan

Per the user's direction: once Bet 1 lands, sweep the remaining open issues on this same branch — [#34](https://github.com/natcat38/f1-race-tracker/issues/34), [#36](https://github.com/natcat38/f1-race-tracker/issues/36), [#37](https://github.com/natcat38/f1-race-tracker/issues/37) (not #38 — folded into Task 7 above). Bet 2 (verified live capture) is timing-gated to a real race weekend and is handed off separately as `f1-race-tracker-live-capture-hungaroring-2026-07-26.md`.
