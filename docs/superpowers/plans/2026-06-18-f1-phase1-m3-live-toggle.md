# F1 Race Tracker — Phase 1 / Milestone 3: Live Source + Manual Live/Replay Toggle

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the operator a **manual toggle** that switches the live board between two independently-published sources (a recorded **replay** lane and a **live** lane) with no freeze, no stale snapshot, and continuous monotonic `Rev` — then make the live lane a real **Python → Redis** ingester (`ingest/live.py`) that speaks the exact same Redis contract as the Go writer.

**Architecture:** Each source publishes to **its own Redis session key** (`snapshot:replay`/`frames:replay` and `snapshot:live`/`frames:live`) — they never collide. The **gateway becomes switchable**: a `POST /control/source` endpoint repoints it at a different session key, re-seeds every connected client with that session's snapshot (a wholesale, non-Rev-gated reset), and fans out the new session's frames. The writer/ingester each **continue `Rev` above whatever snapshot a previous run left in Redis**, so a restart or a swap never emits a `Rev` the board already passed (which `Apply` would silently drop — the M2 "stale snapshot" freeze). The Redis JSON shape is the polyglot seam: Python publishes byte-identical messages to Go.

**Tech Stack:** Go 1.26 (gateway/writer, unchanged libs: `coder/websocket`, `redis/go-redis/v9`, `alicebob/miniredis/v2`); React 19 + TS (Vite) toggle UI; Python 3.11 (`redis`, and `fastf1` for the true-live mode) for the ingester.

**Build order (risk-decoupled, mirrors M2a/M2b):**
- **M3a — Switching machinery (Tasks 1–6):** fully specifiable in Go + React. The live lane is a **second Go `replay` instance** pointed at a different clip, so the entire toggle + switch + Rev-continuity story is built and tested **without any Python**. Demoable on its own.
- **M3b — Python live ingester (Tasks 7–10):** swap the live lane's publisher from the Go replay instance to `ingest/live.py` (same Redis contract), then wire the exploratory true-live FastF1 SignalR mode.

---

## Conventions
- Repo `C:\Users\natal\Documents\Coding\f1-race-tracker`. **Branch off `main`:** `git checkout main && git pull && git checkout -b feat/p1-m3-live-toggle`. Commit per task (Conventional Commits + trailer `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`). Don't push unless asked.
- ⚠️ Go PATH in PowerShell: prepend `go` calls with `$env:Path = [System.Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [System.Environment]::GetEnvironmentVariable('Path','User'); `. Node + Python are on PATH (`python` = C:\Python311).
- The **JSON contract is fixed** by `internal/model/model.go`. Anything Python emits MUST match those tags byte-for-byte: `session, mode, label, track[].{x,y}, cars{} , timeMs, rev` (snapshot) and `session, rev, t, timeMs, cars[]` (frame); car = `driverNum, code, team, pos, p.{x,y}, status`. Go marshals `map[int]CarState` with **string keys** (`"1"`), so Python's snapshot `cars` is an object keyed by the stringified driver number.
- Source/session vocabulary for M3: there are exactly two source keys, **`replay`** and **`live`**, and they double as the Redis session keys.
- `web/dist/.gitkeep` MUST stay tracked (so `//go:embed dist` compiles on a fresh clone). `npm run build` empties `dist/` and deletes it locally — restore with `git checkout -- web/dist/.gitkeep`; never commit its deletion.
- Verify the stack with `docker compose up --build -d` → `http://localhost:8080`. Browser checks use Playwright `browser_evaluate` (DOM inspection) — the screenshot output dir is unreliable on this machine.

## File structure (what M3 creates / changes)
- `internal/app/writer.go` — **modify**: writer owns `Rev`, continuing above the stored snapshot.
- `internal/app/writer_test.go` — **modify**: add the restart/continuation test.
- `internal/ws/hub.go` — **modify**: add `Reset(snap)` (wholesale snapshot replace + broadcast).
- `internal/app/gateway.go` — **modify**: switchable subscription, `SwitchTo`, `POST/GET /control/source`.
- `internal/app/switch_test.go` — **create**: two-lane switch integration test (miniredis + real WS).
- `internal/config/config.go` — **modify**: nothing required; lanes are driven by `SESSION_KEY` env (compose). (Optional clarity only.)
- `ingest/record.py` — **modify**: argparse for `--year/--gp/--label/--out` so a second circuit can be baked.
- `data/replays/silverstone-2024-race.jsonl` — **create**: the live lane's demo clip (committed, downsampled).
- `docker-compose.yml` — **modify**: two publisher lanes + gateway initial source.
- `web/src/components/SourceToggle.tsx` — **create**: the operator toggle.
- `web/src/App.tsx` — **modify**: mount the toggle.
- `web/vite.config.ts` — **modify**: proxy `/control` to the gateway (dev only).
- `ingest/live.py` — **create**: Python → Redis ingester (clip-stream mode + live SignalR mode).
- `ingest/check_live_contract.py` — **create**: structural contract self-check.
- `ingest/requirements-live.txt`, `ingest/Dockerfile.live` — **create**: slim runtime for the ingester.
- `README.md` / `ingest/README.md` — **modify**: control endpoint + ingester usage + seam note.

---

# M3a — Switching machinery (Go + React, live lane = 2nd Go replay instance)

## Task 1 — Writer owns a monotonic `Rev` that continues above Redis

**Why:** Today the writer publishes the source's own `Rev` (clip frames restart at 1 each process start). If a gateway is already subscribed at `Rev 7000` and the writer restarts (or a different source takes over the session key), the new `Rev 1` frames are `<= 7000` and `Apply` drops every one → frozen board (the M2 "stale snapshot" bug). Fix: the writer reads the stored snapshot's `Rev` at startup and emits strictly above it.

**Files:**
- Modify: `internal/app/writer.go`
- Test: `internal/app/writer_test.go`

- [ ] **Step 1: Write the failing test.** Append to `internal/app/writer_test.go`:

```go
func TestWriter_RevContinuesAboveStoredSnapshot(t *testing.T) {
	b := testBus(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// A previous run left a snapshot at rev 1000 on this session key.
	seed := model.NewSnapshot("demo", "replay", "old")
	seed.Rev = 1000
	if err := b.Publish(ctx, seed, model.Frame{SessionKey: "demo", Rev: 1000}); err != nil {
		t.Fatal(err)
	}

	// The writer's source restarts at rev 1 — it must NOT publish rev <= 1000.
	src := &fakeSource{frames: []model.Frame{
		{Rev: 1, Cars: []model.CarState{{DriverNum: 1, Code: "VER"}}},
		{Rev: 2, Cars: []model.CarState{{DriverNum: 1, Code: "VER"}}},
	}}
	go NewWriter(b, src, slog.New(slog.NewTextHandler(io.Discard, nil))).Run(ctx, "demo")

	deadline := time.After(2 * time.Second)
	for {
		snap, _ := b.GetSnapshot(context.Background(), "demo")
		if snap != nil && snap.Rev >= 1002 { // 1000 (base) + 2 frames
			return
		}
		select {
		case <-deadline:
			t.Fatalf("rev did not continue above stored snapshot: %+v", snap)
		case <-time.After(20 * time.Millisecond):
		}
	}
}
```

- [ ] **Step 2: Run it; verify it fails.**
  Run: `$env:Path=...; go test ./internal/app/ -run RevContinues -v`
  Expected: FAIL (snapshot stalls at rev 1000 — the writer republishes the source's rev 1/2, which `Apply` drops as `<= 1000`).

- [ ] **Step 3: Implement.** Replace the body of `Run` in `internal/app/writer.go` with:

```go
func (wr *Writer) Run(ctx context.Context, session string) error {
	frames, err := wr.src.Events(ctx)
	if err != nil {
		return err
	}
	// Continue Rev above any snapshot a previous run (or a different source on this
	// session key) left in Redis, so a restart never emits a Rev the gateway/clients
	// already passed — which Apply would silently drop, freezing the board.
	var base int64
	if existing, err := wr.bus.GetSnapshot(ctx, session); err == nil && existing != nil {
		base = existing.Rev
	}
	snap := model.NewSnapshot(session, wr.src.Mode(), wr.src.Label())
	snap.Track = wr.src.Track()
	snap.Rev = base
	rev := base
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case fr, ok := <-frames:
			if !ok {
				return nil
			}
			rev++
			fr.Rev = rev // the writer owns Rev; the source's own Rev is ignored
			fr.SessionKey = session
			if _, applied := model.Apply(snap, fr); !applied {
				continue
			}
			if err := wr.bus.Publish(ctx, snap, fr); err != nil {
				wr.logger.Error("publish failed", "err", err)
			}
		}
	}
}
```

- [ ] **Step 4: Run the app package tests; verify pass.**
  Run: `$env:Path=...; go test ./internal/app/ -v`
  Expected: PASS — `TestWriter_RevContinuesAboveStoredSnapshot`, `TestWriter_PublishesSnapshotWithLatestRevAndTrack` (still reaches rev 2: empty Redis → base 0 → frames 1,2), and `TestEndToEnd_LateJoinerConverges` (reaches rev 50) all green.

- [ ] **Step 5: Commit.**
```bash
git add internal/app/writer.go internal/app/writer_test.go
git commit -m "feat(writer): own a monotonic Rev that continues above the stored snapshot"
```

## Task 2 — Switchable gateway + `Reset` + `/control/source`

**Why:** The toggle works by repointing the single gateway at a different Redis session key. On switch, every connected client must be re-seeded with the new session's full snapshot (a *wholesale replace*, not a Rev-gated fold — the new session's `Rev` may be lower), then fed the new session's frames.

**Files:**
- Modify: `internal/ws/hub.go`
- Modify: `internal/app/gateway.go`
- Test: `internal/app/switch_test.go` (create)

- [ ] **Step 1: Write the failing switch test.** Create `internal/app/switch_test.go`:

```go
package app

import (
	"context"
	"encoding/json"
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

// loops a fakeSource forever so both lanes stay published.
func loopingSource(car model.CarState) *fakeSource {
	return &fakeSource{frames: []model.Frame{{Rev: 1, Cars: []model.CarState{car}}}}
}

func TestGateway_SwitchSourceReseedsClients(t *testing.T) {
	b := testBus(t)
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	// Two independent lanes on two session keys.
	go NewWriter(b, loopingSource(model.CarState{DriverNum: 1, Code: "VER"}), logger).Run(ctx, "replay")
	go NewWriter(b, loopingSource(model.CarState{DriverNum: 44, Code: "HAM"}), logger).Run(ctx, "live")
	for { // wait until both lanes have a snapshot
		r, _ := b.GetSnapshot(ctx, "replay")
		l, _ := b.GetSnapshot(ctx, "live")
		if r != nil && l != nil {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}

	gw, err := NewGateway(ctx, b, "replay", logger)
	if err != nil {
		t.Fatal(err)
	}
	mux := http.NewServeMux()
	gw.Mount(mux, nil)
	srv := httptest.NewServer(mux)
	defer srv.Close()

	conn, _, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(srv.URL, "http")+"/ws", nil)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close(websocket.StatusNormalClosure, "")

	// First message: the replay lane snapshot.
	if got := readSession(t, ctx, conn); got != "replay" {
		t.Fatalf("first snapshot session = %q, want replay", got)
	}

	// Operator switches to live.
	resp, err := http.Post(srv.URL+"/control/source", "application/json", strings.NewReader(`{"source":"live"}`))
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("control status = %d, want 200", resp.StatusCode)
	}

	// The client must be re-seeded with the live lane within a few messages.
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if readSession(t, ctx, conn) == "live" {
			return // switched
		}
	}
	t.Fatal("client never received the live lane snapshot after switch")
}

// readSession reads one WS message and returns the session key it carries
// (works for both snapshot and frame envelopes).
func readSession(t *testing.T, ctx context.Context, conn *websocket.Conn) string {
	t.Helper()
	_, data, err := conn.Read(ctx)
	if err != nil {
		t.Fatalf("ws read: %v", err)
	}
	var e struct {
		Type string          `json:"type"`
		Data json.RawMessage `json:"data"`
	}
	_ = json.Unmarshal(data, &e)
	var s struct {
		Session string `json:"session"`
	}
	_ = json.Unmarshal(e.Data, &s)
	return s.Session
}
```

- [ ] **Step 2: Run it; verify it fails to compile/pass.**
  Run: `$env:Path=...; go test ./internal/app/ -run SwitchSource -v`
  Expected: FAIL — `gw.SwitchTo`/`/control/source` don't exist yet (build error), or the client never sees the `live` session.

- [ ] **Step 3: Add `Hub.Reset`.** Append to `internal/ws/hub.go`:

```go
// Reset swaps the hub's authoritative snapshot wholesale (the operator switched the
// gateway to a different source/session) and broadcasts it to every client so they
// full-replace their state. Unlike ApplyFrame this is NOT Rev-gated: the new
// snapshot may carry a lower Rev than the one clients currently hold.
func (h *Hub) Reset(snap *model.Snapshot) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.snapshot = snap
	b, err := encodeSnapshot(snap)
	if err != nil {
		return
	}
	for c := range h.clients {
		c.send(b)
	}
}
```

- [ ] **Step 4: Rewrite the gateway to be switchable.** Replace the whole body of `internal/app/gateway.go` with:

```go
package app

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"sync"

	"github.com/redis/go-redis/v9"

	"github.com/natcat38/f1-race-tracker/internal/bus"
	"github.com/natcat38/f1-race-tracker/internal/model"
	"github.com/natcat38/f1-race-tracker/internal/ws"
)

var allowedSources = map[string]bool{"replay": true, "live": true}

// Gateway subscribes to a session's frame channel, seeds an in-memory hub from that
// session's snapshot, serves WebSocket clients, and can be repointed at a different
// session at runtime via SwitchTo (the operator toggle).
type Gateway struct {
	bus     *bus.Bus
	hub     *ws.Hub
	logger  *slog.Logger
	baseCtx context.Context

	mu      sync.Mutex
	session string
	cancel  context.CancelFunc // cancels the active consume goroutine
}

// NewGateway subscribes BEFORE reading the snapshot (Tech §2.5 ordering), seeds the
// hub, and starts forwarding frames for the initial session.
func NewGateway(ctx context.Context, b *bus.Bus, session string, logger *slog.Logger) (*Gateway, error) {
	g := &Gateway{bus: b, logger: logger, baseCtx: ctx}
	snap, pubsub, err := g.subscribeAndSnapshot(ctx, session)
	if err != nil {
		return nil, err
	}
	g.hub = ws.NewHub(snap)
	g.session = session
	cctx, cancel := context.WithCancel(ctx)
	g.cancel = cancel
	go g.consume(cctx, pubsub)
	return g, nil
}

// subscribeAndSnapshot preserves subscribe-before-snapshot ordering (Tech §2.5): any
// frame published after we subscribe is buffered and delivered to consume; the
// snapshot we read already reflects at least every Rev up to SUBSCRIBE time.
func (g *Gateway) subscribeAndSnapshot(ctx context.Context, session string) (*model.Snapshot, *redis.PubSub, error) {
	pubsub := g.bus.Subscribe(ctx, session)
	if _, err := pubsub.Receive(ctx); err != nil { // ensure SUBSCRIBE is live
		return nil, nil, err
	}
	snap, err := g.bus.GetSnapshot(ctx, session)
	if err != nil {
		_ = pubsub.Close()
		return nil, nil, err
	}
	if snap == nil {
		snap = model.NewSnapshot(session, "", "") // unknown until the lane publishes
	}
	return snap, pubsub, nil
}

// SwitchTo repoints the gateway at a different session key: subscribe to the new
// channel, load its snapshot, reset every connected client to it, then fan out the
// new session's frames. The old consume goroutine is cancelled first.
func (g *Gateway) SwitchTo(session string) error {
	g.mu.Lock()
	defer g.mu.Unlock()
	if session == g.session {
		return nil
	}
	snap, pubsub, err := g.subscribeAndSnapshot(g.baseCtx, session)
	if err != nil {
		return err
	}
	g.cancel() // stop the old consume goroutine (its defer closes the old pubsub)
	g.hub.Reset(snap)
	cctx, cancel := context.WithCancel(g.baseCtx)
	g.cancel = cancel
	g.session = session
	go g.consume(cctx, pubsub)
	return nil
}

func (g *Gateway) consume(ctx context.Context, pubsub *redis.PubSub) {
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
			g.hub.ApplyFrame(fr)
		}
	}
}

// Mount registers the gateway routes on mux. staticHandler serves the SPA (Task 9).
func (g *Gateway) Mount(mux *http.ServeMux, staticHandler http.Handler) {
	mux.Handle("/ws", g.hub.Handler())
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusOK) })
	mux.HandleFunc("/control/source", g.handleControl)
	if staticHandler != nil {
		mux.Handle("/", staticHandler)
	}
}

// handleControl: GET reports the active source; POST {"source":"replay"|"live"} switches.
func (g *Gateway) handleControl(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		g.mu.Lock()
		cur := g.session
		g.mu.Unlock()
		writeJSON(w, map[string]string{"source": cur})
	case http.MethodPost:
		var body struct {
			Source string `json:"source"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil || !allowedSources[body.Source] {
			http.Error(w, "source must be one of: replay, live", http.StatusBadRequest)
			return
		}
		if err := g.SwitchTo(body.Source); err != nil {
			g.logger.Error("switch failed", "source", body.Source, "err", err)
			http.Error(w, "switch failed", http.StatusBadGateway)
			return
		}
		writeJSON(w, map[string]string{"source": body.Source})
	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(v)
}
```

- [ ] **Step 5: Run the switch test + full package; verify pass.**
  Run: `$env:Path=...; go test ./internal/app/ ./internal/ws/ -v`
  Expected: PASS — `TestGateway_SwitchSourceReseedsClients` plus all pre-existing app/ws tests.

- [ ] **Step 6: Commit.**
```bash
git add internal/ws/hub.go internal/app/gateway.go internal/app/switch_test.go
git commit -m "feat(gateway): switchable source via /control/source + hub Reset"
```

## Task 3 — Bake a second-circuit clip for the live lane

**Why:** The toggle is only convincing if the two lanes look different. Bake a visually distinct circuit (**Silverstone 2024**) with the existing recorder for the `live` lane.

**Files:**
- Modify: `ingest/record.py`
- Create: `data/replays/silverstone-2024-race.jsonl`

- [ ] **Step 1: Parameterise the recorder.** In `ingest/record.py`, replace the positional-only `OUTPUT_PATH = sys.argv[1] ...` line and the two hardcoded `get_session(2024, 'Monza', 'R')` / `"Monza 2024 · Race"` usages with argparse. Add near the top (after imports), and use the values throughout:

```python
import argparse

_ap = argparse.ArgumentParser(description="Bake a FastF1 session into a JSONL clip.")
_ap.add_argument("out", nargs="?", default="data/replays/monza-2024-race.jsonl")
_ap.add_argument("--year", type=int, default=2024)
_ap.add_argument("--gp", default="Monza")
_ap.add_argument("--session", default="R")
_ap.add_argument("--label", default=None, help="defaults to '<gp> <year> · Race'")
_args = _ap.parse_args()

OUTPUT_PATH = _args.out
GP_LABEL = _args.label or f"{_args.gp} {_args.year} · Race"
```
Then change the load line to `session = fastf1.get_session(_args.year, _args.gp, _args.session)`, the load log to reference `_args.gp`, and the header `"label"` to `GP_LABEL`. (The `WINDOW_START_S=3600`/`WINDOW_END_S=3750` mid-race window is generic enough for a full race; leave as-is, note in the docstring it may need tuning per circuit.)

- [ ] **Step 2: Bake Silverstone.** Run with the ingest venv (created in M2b):
  `.\.venv\Scripts\python.exe ingest\record.py data\replays\silverstone-2024-race.jsonl --gp Silverstone`
  Expected: prints "Contract validation PASSED", a few-MB file, 20 drivers, label "Silverstone 2024 · Race". (First load is network-heavy; the `cache/` dir makes reruns fast.)

- [ ] **Step 3: Sanity-check size + shape.**
  Run: `$env:Path=...; go run ./cmd/genclip --help 2>$null; (Get-Item data\replays\silverstone-2024-race.jsonl).Length/1MB`
  Expected: under ~4 MB. If larger, re-run with a shorter window (edit `WINDOW_END_S`).

- [ ] **Step 4: Commit** (curated short clip — committed per the data strategy).
```bash
git add ingest/record.py data/replays/silverstone-2024-race.jsonl
git commit -m "feat(ingest): parameterise recorder + bake Silverstone 2024 live-lane clip"
```

## Task 4 — Two publisher lanes in docker-compose

**Why:** Run both lanes so the gateway can switch between them. In M3a the live lane is a second Go `replay` instance (no Python yet).

**Files:**
- Modify: `docker-compose.yml`

- [ ] **Step 1: Rewrite `docker-compose.yml`:**

```yaml
services:
  redis:
    image: redis:7-alpine
    ports: ["6379:6379"]

  replay:                      # REPLAY lane → session "replay" (Monza, the default clip)
    build: .
    environment:
      ROLE: replay
      REDIS_URL: redis://redis:6379
      SESSION_KEY: replay
    depends_on: [redis]

  replay-live:                 # LIVE lane (M3a stand-in) → session "live" (Silverstone)
    build: .
    environment:
      ROLE: replay
      REDIS_URL: redis://redis:6379
      SESSION_KEY: live
      CLIP_FILE: /data/replays/silverstone-2024-race.jsonl
    depends_on: [redis]

  gateway:
    build: .
    environment:
      ROLE: gateway
      REDIS_URL: redis://redis:6379
      SESSION_KEY: replay       # initial source the gateway fans out
    ports: ["8080:8080"]
    depends_on: [redis, replay, replay-live]
```

- [ ] **Step 2: Bring it up clean** (wipe Redis so no stale M2 snapshot lingers — the Rev fix handles this, but a clean start removes doubt):
  Run: `docker compose down -v; docker compose up --build -d`
  Then wait for health: `docker compose ps`
  Expected: redis, replay, replay-live, gateway all up.

- [ ] **Step 3: Verify both lanes are publishing** (different cars/labels on the two session keys):
  Run: `docker compose exec redis redis-cli get snapshot:replay | python -c "import sys,json;d=json.load(sys.stdin);print('replay',d['label'],d['rev'])"`
  And: `docker compose exec redis redis-cli get snapshot:live | python -c "import sys,json;d=json.load(sys.stdin);print('live',d['label'],d['rev'])"`
  Expected: `replay Monza 2024 · Race <rev>` and `live Silverstone 2024 · Race <rev>`, both with rev climbing.

- [ ] **Step 4: Commit.**
```bash
git add docker-compose.yml
git commit -m "feat(compose): two publisher lanes (replay + live) behind the gateway"
```

## Task 5 — Operator source toggle (frontend)

**Why:** A visible control to switch lanes. The active lane is derived from the current snapshot's `mode` (`"replay"`/`"live"`), which the gateway broadcasts the instant it switches — no extra polling.

**Files:**
- Create: `web/src/components/SourceToggle.tsx`
- Modify: `web/src/App.tsx`
- Modify: `web/vite.config.ts`

- [ ] **Step 1: Create `web/src/components/SourceToggle.tsx`:**

```tsx
import { useState } from 'react';
import type { RaceState } from '../state/race';

const SOURCES = [
  { key: 'replay', label: '▶ Replay' },
  { key: 'live', label: '● Live' },
] as const;

// The active source is whatever the current snapshot's mode says — the gateway
// broadcasts a fresh snapshot (mode "live"|"replay") the instant it switches.
export function SourceToggle({ state }: { state: RaceState }) {
  const [busy, setBusy] = useState(false);
  const active = state.mode;

  async function pick(source: string) {
    if (busy || source === active) return;
    setBusy(true);
    try {
      await fetch('/control/source', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source }),
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: 'inline-flex', gap: 4, padding: 4, background: '#1a1a1a', borderRadius: 10 }}>
      {SOURCES.map((s) => (
        <button
          key={s.key}
          onClick={() => pick(s.key)}
          disabled={busy}
          style={{
            border: 'none', cursor: busy ? 'wait' : 'pointer',
            padding: '6px 14px', borderRadius: 8, fontFamily: 'monospace', fontSize: 13,
            background: active === s.key ? '#3671C6' : 'transparent',
            color: active === s.key ? '#fff' : '#888',
          }}
        >
          {s.label}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Mount it in `web/src/App.tsx`.** Add the import `import { SourceToggle } from './components/SourceToggle';` and place `<SourceToggle state={state} />` in the `<h2>` header row, after the `state.label` span:

```tsx
        <h2 style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '0 0 12px' }}>
          <StatusBadge status={status} state={state} />
          {state.label ? <span style={{ color: '#aaa', fontWeight: 400, fontSize: 16 }}>{state.label}</span> : null}
          <SourceToggle state={state} />
        </h2>
```

- [ ] **Step 3: Proxy `/control` in dev.** Open `web/vite.config.ts`; wherever `/ws` is proxied to the gateway, add `/control` with the same target (e.g. `'/control': 'http://localhost:8080'`). This only affects `npm run dev`; in prod the SPA is same-origin. If the file has no server.proxy block, add one mirroring the existing `/ws` rule.

- [ ] **Step 4: Build + verify it compiles/lints.**
  Run: `cd web; npm run build; cd ..`
  Then restore the embed marker: `git checkout -- web/dist/.gitkeep`
  Expected: build succeeds (TypeScript clean).

- [ ] **Step 5: Commit.**
```bash
git add web/src/components/SourceToggle.tsx web/src/App.tsx web/vite.config.ts
git commit -m "feat(web): operator live/replay source toggle"
```

## Task 6 — End-to-end verify (M3a, no freeze, Rev continuity)

**Files:** none (verification only).

- [ ] **Step 1: Rebuild + bring up the full stack.**
  Run: `docker compose down -v; docker compose up --build -d`; wait for `docker compose ps` to show all up.

- [ ] **Step 2: Confirm initial board = replay (Monza).** Open `http://localhost:8080`. Via Playwright `browser_navigate` then `browser_evaluate`, read `document.querySelector('h2')?.innerText` and the number of car dots (`document.querySelectorAll('svg circle').length`).
  Expected: label contains "Monza", ~20 dots, the **▶ Replay** toggle highlighted.

- [ ] **Step 3: Switch to live.** `browser_evaluate`:
  `await fetch('/control/source',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({source:'live'})}).then(r=>r.status)`
  Expected: `200`. Within ~1s the board re-seeds: re-read the `h2` text → now contains "Silverstone", the **● Live** toggle highlighted, badge shows `● LIVE`, dots keep moving (no freeze, no skeleton).

- [ ] **Step 4: Switch back to replay.** POST `{source:'replay'}` the same way.
  Expected: `200`; board returns to Monza, **▶ Replay** highlighted, cars moving. Switch a few times rapidly — it must never stick on the skeleton or freeze (this is the regression the Rev fix + `Reset` guard against).

- [ ] **Step 5: Confirm Rev continuity across a publisher restart.** `docker compose restart replay`; keep watching the Monza board.
  Expected: after the restart the board keeps updating (the restarted writer continues Rev above the stored snapshot — no freeze). Capture the observation in the commit/PR notes.

- [ ] **Step 6: Commit** (a marker commit; no code if all green):
```bash
git commit --allow-empty -m "test(m3a): verify live/replay toggle switches cleanly with Rev continuity"
```

> **M3a done:** a working operator toggle that swaps the board between two real lanes with no freeze — entirely in Go + React, no Python.

---

# M3b — Python live ingester (replaces the live lane; adds true-live mode)

> ⚠️ The true-live SignalR path (Task 8) depends on the **real FastF1 livetiming API and a live session**. Build the testable **clip-stream** path first (Task 7) — it exercises the full Python → Redis seam anytime. Acceptance for the seam is cross-language: the Go gateway unmarshals Python's messages and the toggle still works.

## Task 7 — `ingest/live.py`: Python → Redis ingester (clip-stream mode)

**Why:** Make the live lane a genuine polyglot component: Python writes byte-identical Redis messages to the Go contract. The clip-stream mode streams a baked clip in real time, so the live lane is demonstrable without a race.

**Files:**
- Create: `ingest/live.py`
- Create: `ingest/check_live_contract.py`
- Create: `ingest/requirements-live.txt`
- Create: `ingest/Dockerfile.live`

- [ ] **Step 1: `ingest/requirements-live.txt`:**
```
redis
```
(The slim ingester image needs only `redis`; `fastf1` is heavy and only used by the true-live mode, run from the full ingest venv — not baked into the image.)

- [ ] **Step 2: Create `ingest/live.py`:**

```python
"""
Live ingester — publishes normalized race frames to Redis using the SAME contract
the Go writer uses (internal/model/model.go), so the gateway fans it out with zero
Go changes. This is the polyglot seam: Python and Go speak one Redis JSON shape.

Modes:
  --replay-clip FILE   stream a baked .jsonl clip to Redis in real time (testable anytime)
  --live               connect to the F1 live-timing SignalR feed (real sessions only; Task 8)

Redis contract:
  SET     snapshot:<session> = {"session","mode","label","track":[{x,y}],
                                "cars":{"1":{...}},"timeMs","rev"}
  PUBLISH frames:<session>   = {"session","rev","t","timeMs","cars":[{...}]}
  Car = {"driverNum":int,"code":str,"team":str,"pos":int,"p":{"x":float,"y":float},"status":str}
  Go marshals map[int]CarState with STRING keys, so snapshot.cars is keyed by str(driverNum).
  SET before PUBLISH (a subscriber seeing a frame can trust the stored snapshot).
"""
import argparse
import json
import os
import sys
import time

import redis


def snap_key(s):
    return f"snapshot:{s}"


def frames_chan(s):
    return f"frames:{s}"


def starting_rev(r, session):
    """Continue Rev above whatever a previous run left in Redis, so a restart or a
    source swap never re-emits a Rev the gateway/clients already passed (Apply drops it)."""
    raw = r.get(snap_key(session))
    if not raw:
        return 0
    try:
        return int(json.loads(raw).get("rev", 0))
    except (ValueError, json.JSONDecodeError):
        return 0


def build_snapshot(session, label, track, rev):
    return {
        "session": session, "mode": "live", "label": label,
        "track": track, "cars": {}, "timeMs": 0, "rev": rev,
    }


def build_frame(session, rev, time_ms, cars):
    return {
        "session": session, "rev": rev,
        "t": int(time.time() * 1000), "timeMs": time_ms, "cars": cars,
    }


def publish_clip(r, session, clip_path, label_override):
    with open(clip_path, "r", encoding="utf-8") as f:
        header = json.loads(f.readline())
        lines = [json.loads(ln) for ln in f if ln.strip()]
    if not lines:
        print(f"clip {clip_path} has no frames", file=sys.stderr)
        sys.exit(1)

    track = header.get("track", [])
    label = label_override or header.get("label", "Live")
    snapshot = build_snapshot(session, label, track, starting_rev(r, session))
    rev = snapshot["rev"]
    base_ms = lines[0]["timeMs"]
    print(f"live: streaming {len(lines)} frames of '{label}' to session '{session}' (start rev {rev})")

    while True:  # loop the clip forever, like the Go replay player
        loop_start = time.monotonic()
        for ln in lines:
            target = (ln["timeMs"] - base_ms) / 1000.0
            wait = target - (time.monotonic() - loop_start)
            if wait > 0:
                time.sleep(wait)
            rev += 1
            fr = ln["frame"]
            cars = fr["cars"]
            for c in cars:  # fold into the running snapshot (string keys, per Go)
                snapshot["cars"][str(c["driverNum"])] = c
            snapshot["timeMs"] = fr["timeMs"]
            snapshot["rev"] = rev
            frame = build_frame(session, rev, fr["timeMs"], cars)
            r.set(snap_key(session), json.dumps(snapshot, separators=(",", ":")))
            r.publish(frames_chan(session), json.dumps(frame, separators=(",", ":")))


def parse_args():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--session", default=os.environ.get("SESSION_KEY", "live"))
    ap.add_argument("--redis-url", default=os.environ.get("REDIS_URL", "redis://localhost:6379"))
    ap.add_argument("--label", default=None, help="override the clip's label")
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--replay-clip", metavar="FILE", help="stream a baked .jsonl clip in real time")
    g.add_argument("--live", action="store_true", help="connect to the F1 live-timing feed (Task 8)")
    return ap.parse_args()


def main():
    args = parse_args()
    r = redis.from_url(args.redis_url, decode_responses=True)
    r.ping()
    if args.replay_clip:
        publish_clip(r, args.session, args.replay_clip, args.label)
    else:
        from live_signalr import run_live  # Task 8 (exploratory; same dir)
        run_live(r, args.session, args.label)


if __name__ == "__main__":
    main()
```

- [ ] **Step 3: Create `ingest/check_live_contract.py`** (structural self-check; no Redis):

```python
"""Assert live.py builds messages whose key sets exactly match the Go contract."""
import sys
from live import build_snapshot, build_frame

SNAP_KEYS = {"session", "mode", "label", "track", "cars", "timeMs", "rev"}
FRAME_KEYS = {"session", "rev", "t", "timeMs", "cars"}

snap = build_snapshot("live", "Test", [{"x": 0.1, "y": 0.2}], 5)
frame = build_frame("live", 6, 1234, [{"driverNum": 1, "code": "VER", "team": "Red Bull",
                                       "pos": 1, "p": {"x": 0.1, "y": 0.2}, "status": "OnTrack"}])

assert set(snap) == SNAP_KEYS, f"snapshot keys {set(snap)} != {SNAP_KEYS}"
assert set(frame) == FRAME_KEYS, f"frame keys {set(frame)} != {FRAME_KEYS}"
assert snap["mode"] == "live"
assert isinstance(frame["cars"], list) and isinstance(snap["cars"], dict)
print("live.py contract self-check PASSED")
sys.exit(0)
```

- [ ] **Step 4: Run the self-check.**
  Run: `cd ingest; ..\ingest\.venv\Scripts\python.exe check_live_contract.py; cd ..` (or `python ingest/check_live_contract.py` from `ingest/` so the `import live` resolves)
  Expected: `live.py contract self-check PASSED`.

- [ ] **Step 5: Create `ingest/Dockerfile.live`:**

```dockerfile
FROM python:3.11-slim
WORKDIR /app
COPY ingest/requirements-live.txt ./
RUN pip install --no-cache-dir -r requirements-live.txt
COPY ingest/live.py ./
ENTRYPOINT ["python", "live.py"]
```

- [ ] **Step 6: Commit.**
```bash
git add ingest/live.py ingest/check_live_contract.py ingest/requirements-live.txt ingest/Dockerfile.live
git commit -m "feat(ingest): python live ingester publishing the Redis contract (clip-stream mode)"
```

## Task 8 — True-live FastF1 SignalR mode (exploratory)

**Why:** The real "live" path during a Grand Prix. FastF1 exposes the F1 live-timing SignalR stream; normalize it to the same contract and publish. This only runs during a session, so acceptance is **structural** (it imports, connects, and would publish contract-shaped messages), not a full live run.

**Files:**
- Create: `ingest/live_signalr.py`

- [ ] **Step 1: Explore the API.** With the full ingest venv (`fastf1` installed), inspect `fastf1.livetiming` — the `SignalRClient` (records the stream) and how position/timing messages are shaped. Write a short throwaway script that connects (or loads a previously-saved `.txt` capture via `fastf1.livetiming.data.LiveTimingData`) and prints the message topics (`Position.z`, `TimingData`, etc.). Record findings as comments at the top of `live_signalr.py`. ⚠️ Do not write the transform blind — build it against the real message shapes, exactly as M2b did for the recorder.

- [ ] **Step 2: Implement `run_live(r, session, label)`** in `ingest/live_signalr.py`: subscribe to the live-timing stream, maintain per-driver X/Y (normalized to the unit box the same way `record.py` does), derive running order from the timing topic, and publish via the same `snap_key`/`frames_chan` + `build_snapshot`/`build_frame` helpers imported from `live.py` (continue Rev above stored). Keep the normalization helpers shared or duplicated-with-a-note. Mark clearly in a docstring: **runs only during a live F1 session.**

- [ ] **Step 3: Structural check.** With no live session, confirm `python -c "import live_signalr"` imports cleanly and `run_live` is callable (e.g. guarded so that, given a saved capture path via an env var, it replays that capture; otherwise it logs "no live session / no capture" and exits 0). Document how to record a capture during a real session in `ingest/README.md`.

- [ ] **Step 4: Commit.**
```bash
git add ingest/live_signalr.py
git commit -m "feat(ingest): true-live FastF1 SignalR mode (exploratory, session-only)"
```

## Task 9 — Swap the live lane to Python + verify the seam

**Why:** Replace the M3a Go stand-in (`replay-live`) with the Python ingester on the same `live` session key, proving Go fans out Python's messages unchanged.

**Files:**
- Modify: `docker-compose.yml`

- [ ] **Step 1: Replace the `replay-live` service** in `docker-compose.yml` with the Python ingester:

```yaml
  live:                        # LIVE lane → session "live", now published by Python
    build:
      context: .
      dockerfile: ingest/Dockerfile.live
    environment:
      REDIS_URL: redis://redis:6379
      SESSION_KEY: live
    command: ["--replay-clip", "/data/replays/silverstone-2024-race.jsonl", "--session", "live"]
    volumes:
      - ./data:/data:ro
    depends_on: [redis]
```
Update the `gateway` service's `depends_on` to `[redis, replay, live]`.

- [ ] **Step 2: Bring up clean.**
  Run: `docker compose down -v; docker compose up --build -d`; wait for `docker compose ps` (redis, replay, live, gateway up).

- [ ] **Step 3: Verify Python is publishing contract-valid messages that Go consumes.** Open `http://localhost:8080`, switch to live (POST `/control/source {source:'live'}` via `browser_evaluate`).
  Expected: board re-seeds to **Silverstone**, ~20 dots moving smoothly, badge `● LIVE`. This proves the Go gateway unmarshalled Python's `snapshot:live` + `frames:live` with no contract drift. Switch back to replay → Monza. (If the board freezes or shows no cars, the Python JSON shape drifted from the Go tags — diff `redis-cli get snapshot:live` against `snapshot:replay`.)

- [ ] **Step 4: Commit.**
```bash
git add docker-compose.yml
git commit -m "feat(compose): live lane published by the python ingester"
```

## Task 10 — Docs

**Files:**
- Modify: `README.md` (or root notes), `ingest/README.md`

- [ ] **Step 1:** Document in `README.md`: the two-lane topology, the `POST /control/source {"source":"replay"|"live"}` (and `GET`) control endpoint, and a one-line "Redis is the polyglot seam — Python (`ingest/live.py`) and Go publish the identical JSON shape" note.
- [ ] **Step 2:** In `ingest/README.md`: how to run `live.py --replay-clip <file>` locally, how to bake another circuit (`record.py --gp <name>`), and how to record a true-live SignalR capture during a session for `--live`.
- [ ] **Step 3: Commit.**
```bash
git add README.md ingest/README.md
git commit -m "docs(m3): control endpoint, live ingester usage, polyglot seam"
```

> **M3 done:** a manual live/replay toggle that cleanly swaps the board between a Go replay lane and a Python live lane, with monotonic Rev across restarts/switches and the M2 stale-snapshot freeze eliminated.

---

## Self-Review checklist (run after writing code)
- **Rev monotonicity:** the writer (Go) and `live.py` (Python) BOTH read the stored snapshot's `rev` at startup and emit strictly above it. The original `TestWriter_PublishesSnapshotWithLatestRevAndTrack` still reaches rev 2 (empty Redis → base 0) and `TestEndToEnd_LateJoinerConverges` still reaches rev 50.
- **Switch correctness:** `Hub.Reset` is the ONLY non-Rev-gated path; the client's `applyMessage` already replaces state wholesale on a `snapshot` (no rev check, `web/src/state/race.ts:20`), so a lower-Rev live snapshot after a switch is accepted.
- **Ordering preserved:** `subscribeAndSnapshot` keeps subscribe-before-snapshot in both `NewGateway` and `SwitchTo`; `SwitchTo` uses `g.baseCtx` (NOT the request context) so the new consume goroutine outlives the HTTP request.
- **Contract parity:** Python `build_snapshot`/`build_frame` key sets equal the Go JSON tags (`check_live_contract.py`); `cars` is an object keyed by `str(driverNum)` in the snapshot and a list in the frame, matching `map[int]CarState` vs `[]CarState`.
- **Embed marker:** `web/dist/.gitkeep` restored after every `npm run build`; never committed as deleted.
- **No collision:** `replay` and `live` use separate Redis keys end-to-end; nothing writes both.

## Roadmap after M3
- **M4:** cross-year side-by-side comparison (lap-aligned 2024 vs 2025), load test/benchmark (`cmd/loadtest` + `BENCHMARKS.md`), README/demo-video polish.
- **Follow-ups carried in:** tune the Monza demo window (cars bunched); formally code-review `ingest/record.py`; consider a Redis `INCR rev:<session>` allocator if multiple writers ever share one session key (not needed while each lane owns its key).
