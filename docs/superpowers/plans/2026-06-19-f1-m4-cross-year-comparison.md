# Cross-Year Comparison Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A separate **Compare view** that plays **Monza 2023 vs Monza 2024** as two maps side-by-side, in phase-sync, fed through the real Redis→gateway→WebSocket pipeline.

**Architecture:** Two ordinary Go `replay` lanes publish the two years to their own Redis sessions, looping with an opt-in **wall-clock-phased** clock so they stay aligned with no coordinator. The gateway gains an **additive** `/ws?session=<key>` path backed by a lazy, read-only **hub registry** — the M3 default `/ws` + `/control/source` toggle path is unchanged. The frontend opens two WebSockets and renders the existing `Map` twice.

**Tech Stack:** Go 1.26 (gateway/replay), React 19 + TS (Vite) for the Compare view, Redis seam, FastF1 recorder for the new clip. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-06-19-f1-m4-cross-year-comparison-design.md`.

---

## Conventions
- Repo `C:\Users\natal\Documents\Coding\f1-race-tracker`, branch `feat/p1-m4-compare` (already created off `main`). Commit per task (Conventional Commits + trailer `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`). Don't push unless asked.
- ⚠️ Go PATH in PowerShell: prefix every `go` call with `$env:Path = [System.Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [System.Environment]::GetEnvironmentVariable('Path','User'); `. Node + Python on PATH (`python` = C:\Python311; Python venv at repo-root `.venv`).
- The JSON contract is fixed by `internal/model/model.go` — do not change it. Comparison is "the single-map view rendered twice — no new data type."
- ⚠️ `web/dist/.gitkeep` MUST stay tracked (`//go:embed dist`). `npm run build` deletes it locally — restore with `git checkout -- web/dist/.gitkeep`; never commit its deletion.
- The writer (`internal/app/writer.go`) **owns Rev** (assigns a monotonic rev per published frame, ignoring the source's rev). So the replay Source does NOT need to compute monotonic rev — it only needs to emit frames in the right order/timing.

## File structure (what M4-compare touches)
- `internal/feed/replay/play.go` — **modify**: add opt-in wall-clock-phased loop + a pure phase helper.
- `internal/feed/replay/play_test.go` — **create/modify**: unit-test the phase helper.
- `internal/config/config.go` — **modify**: add `PhaseWallclock` from `PHASE_WALLCLOCK`.
- `cmd/server/main.go` — **modify**: set the phasing on the replay source.
- `internal/ws/handler.go` — **modify**: rename `Handler()` → `ServeWS(w,r)` (same body).
- `internal/app/gateway.go` — **modify**: hub registry + `getOrCreateHub`, `?session=` WS dispatch, `consume` takes a hub arg.
- `internal/app/compare_test.go` — **create**: registry/`?session=` integration test.
- `data/replays/monza-2023-race.jsonl` — **create**: baked clip (same window as 2024).
- `docker-compose.yml` — **modify**: two `compare-*` lanes.
- `web/src/realtime/socket.ts` — **modify**: optional `session` param.
- `web/src/components/Compare.tsx` — **create**: two streams, two `Map`s.
- `web/src/App.tsx` — **modify**: hash-route between board and Compare.
- `README.md` — **modify**: note the Compare view.

---

## Task 1 — Wall-clock-phased replay loop

**Why:** Two independently-looping lanes drift out of phase. If each lane derives its playback position from the wall clock (instead of process-start), two lanes with identical-length clips emit the same frame at the same instant — aligned, no coordinator. The two Monza clips are baked with the same recorder window, so their `timeMs` sequences (hence loop length) are identical.

**Files:**
- Modify: `internal/feed/replay/play.go`
- Modify: `internal/config/config.go`
- Modify: `cmd/server/main.go`
- Test: `internal/feed/replay/play_test.go`

- [ ] **Step 1: Write the failing test.** Create/append `internal/feed/replay/play_test.go`:

```go
package replay

import "testing"

func TestFrameAtWallclock_DeterministicAndAligned(t *testing.T) {
	rels := []int64{0, 100, 200} // 3 frames, 100ms apart
	loopLen := int64(300)

	cases := []struct {
		now      int64
		wantI    int
		wantTgt  int64
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
```

- [ ] **Step 2: Run it; verify it fails.**
  Run: `$env:Path=...; go test ./internal/feed/replay/ -run FrameAtWallclock -v`
  Expected: FAIL — `frameAtWallclock` undefined (build error).

- [ ] **Step 3: Implement the phase helper + wall-clock loop.** In `internal/feed/replay/play.go`, add the import `"sort"` to the import block, add an exported field to `Source`, and add the helper + loop. First, add the field to the `Source` struct (it currently has `track, label, lines, max, speed`):

```go
type Source struct {
	track []model.Point
	label string
	lines []clipLine
	max   int64
	speed float64

	phaseWallclock bool // when true, loop position is derived from the wall clock (M4 compare)
}

// SetWallclockPhase makes Events derive playback position from the wall clock, so
// two lanes with identical-length clips stay phase-aligned with no coordinator.
func (s *Source) SetWallclockPhase(on bool) { s.phaseWallclock = on }

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
```

Then replace the `Events` method body so it branches on `phaseWallclock`:

```go
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
```

- [ ] **Step 4: Add the config flag.** In `internal/config/config.go`, add the field + load (the `env` helper already exists):

```go
type Config struct {
	Role           string
	RedisURL       string
	Session        string
	ClipFile       string
	Speed          float64
	Addr           string
	PhaseWallclock bool
}

func Load() Config {
	return Config{
		Role:           env("ROLE", "gateway"),
		RedisURL:       env("REDIS_URL", "redis://localhost:6379"),
		Session:        env("SESSION_KEY", "demo"),
		ClipFile:       env("CLIP_FILE", "data/replays/monza-2024-race.jsonl"),
		Speed:          1,
		Addr:           env("ADDR", ":8080"),
		PhaseWallclock: env("PHASE_WALLCLOCK", "") != "",
	}
}
```

- [ ] **Step 5: Wire it in `cmd/server/main.go`.** In the `case "replay":` block, after `src, err := replay.Load(...)` and its error check, set the phase before constructing the writer:

```go
	case "replay":
		src, err := replay.Load(cfg.ClipFile, cfg.Speed)
		if err != nil {
			logger.Error("load clip", "err", err)
			os.Exit(1)
		}
		src.SetWallclockPhase(cfg.PhaseWallclock)
		logger.Info("replay writer starting", "session", cfg.Session, "label", src.Label(), "wallclock", cfg.PhaseWallclock)
		if err := app.NewWriter(b, src, logger).Run(ctx, cfg.Session); err != nil && ctx.Err() == nil {
			logger.Error("writer stopped", "err", err)
			os.Exit(1)
		}
```

- [ ] **Step 6: Run tests + build; verify pass.**
  Run: `$env:Path=...; go test ./internal/feed/replay/ -v; go build ./...`
  Expected: PASS (incl. `TestFrameAtWallclock_DeterministicAndAligned`) and a clean build. Existing replay tests still pass (default phasing unchanged).

- [ ] **Step 7: Commit.**
```bash
git add internal/feed/replay/play.go internal/feed/replay/play_test.go internal/config/config.go cmd/server/main.go
git commit -m "feat(replay): opt-in wall-clock-phased loop for aligned comparison lanes"
```

---

## Task 2 — Gateway multi-session WebSocket (`?session=`) + hub registry

**Why:** The Compare view needs two simultaneous streams. Teach the gateway's `/ws` to serve any published session via `?session=<key>`, backed by a lazy read-only hub registry — additive and orthogonal to the M3 toggle, which keeps using the default `/ws`.

**Files:**
- Modify: `internal/ws/handler.go`
- Modify: `internal/app/gateway.go`
- Test: `internal/app/compare_test.go`

- [ ] **Step 1: Write the failing test.** Create `internal/app/compare_test.go`:

```go
package app

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"

	"github.com/natcat38/f1-race-tracker/internal/model"
)

func TestGateway_SessionParamServesRequestedSession(t *testing.T) {
	b := testBus(t)
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	// Two lanes on two session keys (loopingSource is defined in switch_test.go).
	go NewWriter(b, loopingSource(model.CarState{DriverNum: 1, Code: "VER"}), logger).Run(ctx, "alpha")
	go NewWriter(b, loopingSource(model.CarState{DriverNum: 44, Code: "HAM"}), logger).Run(ctx, "beta")
	for {
		a, _ := b.GetSnapshot(ctx, "alpha")
		bb, _ := b.GetSnapshot(ctx, "beta")
		if a != nil && bb != nil {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}

	gw, err := NewGateway(ctx, b, "alpha", logger) // default/active session = alpha
	if err != nil {
		t.Fatal(err)
	}
	mux := http.NewServeMux()
	gw.Mount(mux, nil)
	srv := httptest.NewServer(mux)
	defer srv.Close()
	wsBase := "ws" + strings.TrimPrefix(srv.URL, "http")

	// A ?session=beta client must receive the beta lane...
	connB, _, err := websocket.Dial(ctx, wsBase+"/ws?session=beta", nil)
	if err != nil {
		t.Fatal(err)
	}
	defer connB.Close(websocket.StatusNormalClosure, "")
	if got := readSession(t, ctx, connB); got != "beta" { // readSession is in switch_test.go
		t.Fatalf("?session=beta first snapshot = %q, want beta", got)
	}

	// ...while the default (no param) client still gets the active session (alpha).
	connDef, _, err := websocket.Dial(ctx, wsBase+"/ws", nil)
	if err != nil {
		t.Fatal(err)
	}
	defer connDef.Close(websocket.StatusNormalClosure, "")
	if got := readSession(t, ctx, connDef); got != "alpha" {
		t.Fatalf("default /ws first snapshot = %q, want alpha", got)
	}
}
```

- [ ] **Step 2: Run it; verify it fails.**
  Run: `$env:Path=...; go test ./internal/app/ -run SessionParam -v`
  Expected: FAIL — `?session=beta` is ignored today, so the first client receives the active session `alpha`, not `beta`.

- [ ] **Step 3: Expose the hub's serve logic.** In `internal/ws/handler.go`, rename the method from `Handler()` to `ServeWS` (same body, now a plain handler func). ⚠️ `Handler()` was previously called only in `gateway.go`'s `Mount` (updated in Step 4f) — but grep the repo for any remaining `.Handler()` references (e.g. a `ws` package test) and update them to `.ServeWS`; the Step 5 test run will catch any you miss as a compile error.

```go
package ws

import (
	"net/http"

	"github.com/coder/websocket"
)

// ServeWS upgrades to WebSocket, sends the snapshot, then streams frames.
func (h *Hub) ServeWS(w http.ResponseWriter, r *http.Request) {
	conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{
		OriginPatterns: []string{"*"}, // same-origin in prod; permissive for dev
	})
	if err != nil {
		return
	}
	defer conn.CloseNow()

	client := newClient(conn)
	if err := h.Register(client); err != nil {
		return
	}
	defer h.Unregister(client)

	ctx := r.Context()
	go client.writeLoop(ctx)
	for { // read loop exists only to detect close
		if _, _, err := conn.Read(ctx); err != nil {
			client.close()
			return
		}
	}
}
```

- [ ] **Step 4: Add the registry + `?session=` dispatch + hub-arg consume to `internal/app/gateway.go`.** Make these changes:

(a) Add registry fields to the `Gateway` struct (it currently has `bus, hub, logger, baseCtx, mu, session, cancel`):

```go
type Gateway struct {
	bus     *bus.Bus
	hub     *ws.Hub
	logger  *slog.Logger
	baseCtx context.Context

	mu      sync.Mutex
	session string
	cancel  context.CancelFunc // cancels the active consume goroutine

	regMu    sync.Mutex            // guards registry
	registry map[string]*ws.Hub    // read-only per-session hubs for /ws?session=<key>
}
```

(b) Initialise `registry` in `NewGateway` and make its `consume` call pass the hub. The current `NewGateway` ends with `go g.consume(cctx, pubsub)` — change `consume` to take a hub and pass `g.hub`:

```go
func NewGateway(ctx context.Context, b *bus.Bus, session string, logger *slog.Logger) (*Gateway, error) {
	g := &Gateway{bus: b, logger: logger, baseCtx: ctx, registry: make(map[string]*ws.Hub)}
	snap, pubsub, err := g.subscribeAndSnapshot(ctx, session)
	if err != nil {
		return nil, err
	}
	g.hub = ws.NewHub(snap)
	g.session = session
	cctx, cancel := context.WithCancel(ctx)
	g.cancel = cancel
	go g.consume(cctx, g.hub, pubsub)
	return g, nil
}
```

(c) In `SwitchTo`, the line `go g.consume(cctx, pubsub)` becomes `go g.consume(cctx, g.hub, pubsub)` (g.hub is the active hub; unchanged behaviour).

(d) Change `consume` to apply to the passed hub:

```go
func (g *Gateway) consume(ctx context.Context, hub *ws.Hub, pubsub *redis.PubSub) {
	defer pubsub.Close()
	ch := pubsub.Channel()
	for {
		select {
		case <-ctx.Done():
			return
		case msg, ok := <-ch:
			if !ok {
				return
			}
			var fr model.Frame
			if err := json.Unmarshal([]byte(msg.Payload), &fr); err != nil {
				g.logger.Warn("bad frame", "err", err)
				continue
			}
			hub.ApplyFrame(fr)
		}
	}
}
```

(e) Add `getOrCreateHub` + a gateway-level WS handler. Add these methods:

```go
// getOrCreateHub returns a lazily-created read-only hub fanning out one session.
// Registry hubs live for the gateway's lifetime (baseCtx); they are never switched.
func (g *Gateway) getOrCreateHub(session string) (*ws.Hub, error) {
	g.regMu.Lock()
	defer g.regMu.Unlock()
	if h, ok := g.registry[session]; ok {
		return h, nil
	}
	snap, pubsub, err := g.subscribeAndSnapshot(g.baseCtx, session)
	if err != nil {
		return nil, err
	}
	hub := ws.NewHub(snap)
	g.registry[session] = hub
	go g.consume(g.baseCtx, hub, pubsub)
	return hub, nil
}

// wsHandler routes /ws to the active hub (M3 toggle path) or, when ?session=<key>
// is present, to that session's registry hub.
func (g *Gateway) wsHandler(w http.ResponseWriter, r *http.Request) {
	session := r.URL.Query().Get("session")
	if session == "" {
		g.mu.Lock()
		hub := g.hub
		g.mu.Unlock()
		hub.ServeWS(w, r)
		return
	}
	hub, err := g.getOrCreateHub(session)
	if err != nil {
		g.logger.Error("session subscribe failed", "session", session, "err", err)
		http.Error(w, "session unavailable", http.StatusBadGateway)
		return
	}
	hub.ServeWS(w, r)
}
```

(f) In `Mount`, change the `/ws` registration from the old `g.hub.Handler()` to the gateway handler:

```go
func (g *Gateway) Mount(mux *http.ServeMux, staticHandler http.Handler) {
	mux.HandleFunc("/ws", g.wsHandler)
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusOK) })
	mux.HandleFunc("/control/source", g.handleControl)
	if staticHandler != nil {
		mux.Handle("/", staticHandler)
	}
}
```

- [ ] **Step 5: Run the app + ws tests; verify pass.**
  Run: `$env:Path=...; go test ./internal/app/ ./internal/ws/ -v; go build ./...`
  Expected: PASS — the new `TestGateway_SessionParamServesRequestedSession`, plus all M3 tests (`TestGateway_SwitchSourceReseedsClients`, late-joiner, writer, hub) still green. Clean build (main.go uses `Mount`, unaffected).

- [ ] **Step 6: Commit.**
```bash
git add internal/ws/handler.go internal/app/gateway.go internal/app/compare_test.go
git commit -m "feat(gateway): additive /ws?session= multi-session fan-out via hub registry"
```

---

## Task 3 — Bake the Monza 2023 clip (equal-length pair)

**Why:** The 2024 side reuses the existing `data/replays/monza-2024-race.jsonl`; the 2023 side needs its own clip baked with the **same recorder window** so both loops have identical length (the precondition for wall-clock alignment).

**Files:**
- Create: `data/replays/monza-2023-race.jsonl`

- [ ] **Step 1: Bake it** with the repo-root venv (the recorder already takes `--gp/--year` from M3 Task 3):
  Run: `.\.venv\Scripts\python.exe ingest\record.py data\replays\monza-2023-race.jsonl --gp Monza --year 2023`
  Expected: prints "Contract validation PASSED", label "Monza 2023 · Race", 20 drivers, ~1500 frames.

- [ ] **Step 2: Verify it equals the 2024 clip in length** (same loop period → aligned):
  Run (PowerShell): `"2023: $((Get-Content data\replays\monza-2023-race.jsonl | Measure-Object -Line).Lines) lines; 2024: $((Get-Content data\replays\monza-2024-race.jsonl | Measure-Object -Line).Lines) lines"`
  Expected: both report the **same** line count (1 header + 1500 frames = 1501). If they differ (e.g. a few missing frames at the window edge for 2023), re-bake **both** years with a window guaranteed clean for both — edit `WINDOW_START_S`/`WINDOW_END_S` in `ingest/record.py`, bake 2023 and 2024 to the same window, and verify equal line counts. ⚠️ Keeping line counts equal is the acceptance gate.

- [ ] **Step 3: Verify size + header** (committed clip, under ~4 MB):
  Run (PowerShell): `"size: $([math]::Round((Get-Item data\replays\monza-2023-race.jsonl).Length/1MB,2)) MB"; (Get-Content data\replays\monza-2023-race.jsonl -TotalCount 1 | ConvertFrom-Json).label`
  Expected: under ~4 MB; label `Monza 2023 · Race`.

- [ ] **Step 4: Commit.**
```bash
git add data/replays/monza-2023-race.jsonl
git commit -m "feat(ingest): bake Monza 2023 clip for the cross-year comparison pair"
```
(If Step 2 forced a re-bake of the 2024 clip too, `git add data/replays/monza-2024-race.jsonl` as well and say so in the commit body.)

---

## Task 4 — Compare lanes in docker-compose

**Why:** Publish both years continuously, each to its own session, with wall-clock phasing on so they stay aligned.

**Files:**
- Modify: `docker-compose.yml`

- [ ] **Step 1: Add two compare lanes.** Append these two services to `docker-compose.yml` (keep `redis`, `replay`, `live`, `gateway` exactly as they are; the gateway's `depends_on` does not need the compare lanes — clients lazily subscribe):

```yaml
  compare-2023:                # COMPARE left  → session "compare-monza-2023"
    build: .
    environment:
      ROLE: replay
      REDIS_URL: redis://redis:6379
      SESSION_KEY: compare-monza-2023
      CLIP_FILE: /data/replays/monza-2023-race.jsonl
      PHASE_WALLCLOCK: "1"
    depends_on: [redis]

  compare-2024:                # COMPARE right → session "compare-monza-2024"
    build: .
    environment:
      ROLE: replay
      REDIS_URL: redis://redis:6379
      SESSION_KEY: compare-monza-2024
      CLIP_FILE: /data/replays/monza-2024-race.jsonl
      PHASE_WALLCLOCK: "1"
    depends_on: [redis]
```

- [ ] **Step 2: Validate the compose file parses.**
  Run: `docker compose config`
  Expected: resolves with no error; shows `compare-2023` and `compare-2024` with `PHASE_WALLCLOCK: "1"` and the two clip paths. (Does not require building/starting.)

- [ ] **Step 3: Commit.**
```bash
git add docker-compose.yml
git commit -m "feat(compose): wall-clock-phased compare lanes for Monza 2023 vs 2024"
```

---

## Task 5 — Frontend Compare view

**Why:** Render the two streams side-by-side, reusing the existing `Map` + `Standings`. A minimal hash route switches between the live board and Compare.

**Files:**
- Modify: `web/src/realtime/socket.ts`
- Create: `web/src/components/Compare.tsx`
- Modify: `web/src/App.tsx`
- Modify: `README.md`

- [ ] **Step 1: Add an optional `session` arg to `connectRace`.** In `web/src/realtime/socket.ts`, change the signature and the URL construction (everything else stays the same):

```ts
export function connectRace(
  onState: (s: RaceState) => void,
  onStatus?: (status: ConnStatus) => void,
  session?: string,
): () => void {
  let state = emptyState();
  let ws: WebSocket | null = null;
  let closed = false;
  let backoff = 500;

  const base = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
  const url = session ? `${base}?session=${encodeURIComponent(session)}` : base;
```
(Leave the rest of the function — `open()`, handlers, return — unchanged. The existing `App.tsx` call `connectRace(setState, setStatus)` keeps working with `session` undefined → default `/ws`.)

- [ ] **Step 2: Create `web/src/components/Compare.tsx`:**

```tsx
import { useEffect, useState } from 'react';
import { connectRace } from '../realtime/socket';
import { emptyState, type RaceState } from '../state/race';
import { Map } from './Map';
import { Standings } from './Standings';

const PAIR = [
  { session: 'compare-monza-2023', year: '2023' },
  { session: 'compare-monza-2024', year: '2024' },
] as const;

function Lane({ session, year }: { session: string; year: string }) {
  const [state, setState] = useState<RaceState>(emptyState());
  useEffect(() => connectRace(setState, undefined, session), [session]);

  return (
    <div>
      <h3 style={{ margin: '0 0 8px', fontFamily: 'monospace', display: 'flex', gap: 10, alignItems: 'baseline' }}>
        <span>{year}</span>
        <span style={{ color: '#888', fontWeight: 400, fontSize: 14 }}>{state.label}</span>
      </h3>
      {state.rev === 0 ? (
        <div style={{ width: 600, height: 600, background: '#111', borderRadius: 12 }} />
      ) : (
        <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
          <Map state={state} />
          <Standings state={state} />
        </div>
      )}
    </div>
  );
}

export function Compare() {
  return (
    <div style={{ padding: 24, color: '#eee', background: '#0a0a0a', minHeight: '100vh' }}>
      <h2 style={{ margin: '0 0 16px', display: 'flex', gap: 16, alignItems: 'baseline' }}>
        <span>Cross-year comparison · Monza</span>
        <a href="#" style={{ color: '#3671C6', fontSize: 14, fontWeight: 400 }}>← live board</a>
      </h2>
      <div style={{ display: 'flex', gap: 32, flexWrap: 'wrap' }}>
        {PAIR.map((p) => (
          <Lane key={p.session} session={p.session} year={p.year} />
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Hash-route in `web/src/App.tsx`.** Add the import and a hash check at the top of the component. Add near the other imports:

```tsx
import { Compare } from './components/Compare';
```

Inside `App()`, before the existing `return`, add hash state and an early return; and add a "Compare years" link into the existing header row. The component becomes:

```tsx
export default function App() {
  const [state, setState] = useState<RaceState>(emptyState());
  const [status, setStatus] = useState<ConnStatus>('connecting');
  const [hash, setHash] = useState<string>(typeof location !== 'undefined' ? location.hash : '');

  useEffect(() => connectRace(setState, setStatus), []);
  useEffect(() => {
    const onHash = () => setHash(location.hash);
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  if (hash === '#compare') return <Compare />;

  const showSkeleton = state.rev === 0;

  return (
    <div style={{ display: 'flex', gap: 24, padding: 24, color: '#eee', background: '#0a0a0a', minHeight: '100vh' }}>
      <div>
        <h2 style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '0 0 12px' }}>
          <StatusBadge status={status} state={state} />
          {state.label ? <span style={{ color: '#aaa', fontWeight: 400, fontSize: 16 }}>{state.label}</span> : null}
          <SourceToggle state={state} />
          <a href="#compare" style={{ color: '#3671C6', fontSize: 13, fontWeight: 400 }}>Compare years →</a>
        </h2>
        {status === 'reconnecting' && !showSkeleton && (
          <div style={{ position: 'relative', display: 'inline-block' }}>
            <Map state={state} />
            <div style={{
              position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)',
              background: '#7c3f00cc', color: '#ffb347', padding: '4px 14px',
              borderRadius: 8, fontFamily: 'monospace', fontSize: 13, fontWeight: 600,
            }}>
              ↺ Reconnecting…
            </div>
          </div>
        )}
        {!showSkeleton && status !== 'reconnecting' && <Map state={state} />}
        {showSkeleton && <SkeletonMap />}
      </div>
      <div><h3>Order</h3><Standings state={state} /></div>
    </div>
  );
}
```
(The `SkeletonMap` function and the imports of `Map`, `Standings`, `StatusBadge`, `SourceToggle`, `connectRace`, `emptyState`, types stay as they are in the current file.)

- [ ] **Step 4: Note it in `README.md`.** Under the run/usage section, add a short line:

```markdown
### Cross-year comparison

Open <http://localhost:8080/#compare> for the side-by-side **Monza 2023 vs 2024** view — two maps fed by two `compare-*` lanes through the same gateway via `/ws?session=<key>`, kept in phase by the replay lanes' wall-clock-phased loop. Use the "Compare years →" link on the main board.
```

- [ ] **Step 5: Build the SPA; verify it compiles; restore the embed marker.**
  Run: `cd web; npm run build; cd ..`
  Then: `git checkout -- web/dist/.gitkeep`
  Expected: TypeScript build succeeds (no type errors).

- [ ] **Step 6: Commit.**
```bash
git add web/src/realtime/socket.ts web/src/components/Compare.tsx web/src/App.tsx README.md
git commit -m "feat(web): cross-year Compare view (two synced maps via /ws?session=)"
```

---

## Task 6 — End-to-end verification

**Files:** none (verification only).

- [ ] **Step 1: Bring up the full stack clean** (wipes Redis so no stale keys):
  Run: `docker compose down -v; docker compose up --build -d`
  Then wait for `docker compose ps` to show redis, replay, live, gateway, compare-2023, compare-2024 all up.

- [ ] **Step 2: Confirm both compare lanes publish, aligned.** In PowerShell:
```powershell
$a = (docker compose exec -T redis redis-cli get snapshot:compare-monza-2023 | Out-String).Trim() | ConvertFrom-Json
$b = (docker compose exec -T redis redis-cli get snapshot:compare-monza-2024 | Out-String).Trim() | ConvertFrom-Json
"2023: label=$($a.label) cars=$(($a.cars.PSObject.Properties|Measure-Object).Count) timeMs=$($a.timeMs)"
"2024: label=$($b.label) cars=$(($b.cars.PSObject.Properties|Measure-Object).Count) timeMs=$($b.timeMs)"
"timeMs delta (should be small / within a few hundred ms): $([math]::Abs($a.timeMs - $b.timeMs))"
```
  Expected: both labels correct, ~20 cars each, and the **timeMs values close together** (both lanes at the same phase of the window — the alignment proof). A small delta (a few inter-frame gaps) is fine.

- [ ] **Step 3: Browser-verify the Compare view.** Navigate to `http://localhost:8080/#compare`. Via the browser tool's evaluate, read both lane headings and dot counts:
```js
() => {
  const cols = [...document.querySelectorAll('h3')].map(h => h.innerText);
  const svgs = document.querySelectorAll('svg');
  const dots = [...svgs].map(s => s.querySelectorAll('circle').length);
  return { headings: cols, mapCount: svgs.length, dotsPerMap: dots };
}
```
  Expected: two headings containing "2023 … Monza 2023 · Race" and "2024 … Monza 2024 · Race", at least two maps, ~20 dots each. Sample a car position, wait ~1s, sample again → positions changed (both maps moving). Screenshot for the record.

- [ ] **Step 4: Confirm the main board is unaffected.** Navigate to `http://localhost:8080/` (no hash). Expected: the M3 live/replay board still works — badge, label, toggle, "Compare years →" link present; switching replay/live still works.

- [ ] **Step 5: Commit a marker** (no code if all green):
```bash
git commit --allow-empty -m "test(m4-compare): verify two-year synced comparison end-to-end"
```

---

## Self-Review checklist (run after writing code)
- **Alignment chain intact:** both clips equal length (Task 3 Step 2) → identical `rels`/`loopLen` → `frameAtWallclock` returns the same frame at the same instant for both lanes (Task 1) → the two snapshots' `timeMs` track closely (Task 6 Step 2).
- **M3 untouched:** default `/ws` still serves the active/toggle hub; `/control/source` unchanged; `consume` only gained a hub argument (active calls pass `g.hub`). The `TestGateway_SwitchSourceReseedsClients` test must still pass.
- **Rev ownership:** the wall-clock loop does not compute monotonic rev — the writer (`writer.go`) reassigns it. Mid-clip start is fine because every clip frame carries all 20 cars, so the first published snapshot is complete.
- **Contract unchanged:** no edits to `internal/model/model.go`; Compare reuses `Map`/`Standings`/`race.ts` verbatim.
- **Embed marker:** `web/dist/.gitkeep` restored after `npm run build`.

## Roadmap after this
- **M4 (2/3): Load test + benchmark** — re-scope first against the as-built single-gateway, no-`/metrics` reality, then its own spec → plan.
- **M4 (3/3): README + demo-video polish.**
