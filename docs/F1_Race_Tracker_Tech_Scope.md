# F1 Race Tracker — Tech Scope

> **Audience:** engineers (you, building it). Code-level breakdown.
> **Stack:** **Python** (FastF1) for ingestion · **Redis** (pub/sub + snapshot, the language-agnostic seam) · **Go** for the real-time fan-out tier · **React + TypeScript** for the visualisation. Dockerised; runs in full via `docker-compose`. No required hosting. No relational DB. MIT.
> **Companion doc:** `F1_Race_Tracker_Product_Scope.md`.

---

## 1. Overview

> **Phase 1 — Animated Track Map + Comparison.** Dependency notes: **Task 2 (the event contract) comes first** — every other task depends on it. The **Go fan-out (Tasks 4–5)** can be built and tested against a **fake publisher** before the **Python recorder (Task 1)** is finished. Build **tracer-bullet**: plain dots end-to-end (Task 7) *before* polishing the map (Task 8). **Comparison (Task 11) is last** — it's the single-map view rendered twice; don't start it until one map works live + replay.

| # | Task | Layer | File(s) | Effort |
|---|------|-------|---------|--------|
| 1 | Recorder: FastF1 → normalised replay clip | Python | `ingest/record.py`, `ingest/normalise.py` | 2.5 d |
| 2 | Normalised event + snapshot model (the contract) | Shared | `internal/model/*.go`, `ingest/model.py` | 1 d |
| 3 | Replay player (read clip → publish to Redis) | Go | `internal/feed/replay/*` | 1 d |
| 4 | Redis fan-out + snapshot store | Go | `internal/bus/*` | 1.5 d |
| 5 | WebSocket hub (snapshot-on-join, backpressure) | Go | `internal/ws/*` | 2 d |
| 6 | Gateway: serve SPA + scaffold + config + Docker | Go | `cmd/gateway`, `Dockerfile`, `docker-compose.yml` | 1.5 d |
| 7 | **1a:** React WS client + moving dots + standings | Frontend | `web/src/realtime/*`, `web/src/components/Map.tsx` | 2.5 d |
| 8 | **1b:** Draw track from positions + smooth animation | Frontend | `web/src/track/*`, `web/src/components/Map.tsx` | 3 d |
| 9 | Loading / skeleton screen + connection states | Frontend | `web/src/components/*` | 0.5 d |
| 10 | **1c:** Live feed (FastF1 live → Redis) + manual toggle | Python/Go | `ingest/live.py`, `internal/api/control.go` | 2 d |
| 11 | **1d:** Cross-year comparison (two maps, lap-aligned) | Frontend | `web/src/components/Compare.tsx` | 2.5 d |
| 12 | Curated downsampled clips (incl. two-year pair) | Ops | `data/replays/*.jsonl` | 0.5 d |
| 13 | Hub convergence integration test | Go | `internal/ws/hub_integration_test.go` | 0.5 d |
| 14 | Load test + benchmark + README + demo recording | Ops | `cmd/loadtest/*`, `BENCHMARKS.md`, `README.md` | 1.5 d |
| | **Phase 1 total** | | | **~23–25 d** |

> **Phases 2–4 (deferred, reuse the pipeline).** Phase 2: pit-wall timing dashboard (richer model fields + UI). Phase 3: team-radio audio layer (OpenF1/FastF1 `team_radio` → a new event kind + audio playback). Phase 4: computed cross-year "ghost" delta (offline alignment from committed clips → overlay). Not detailed here.

---

## 2. Core Logic — the real-time pipeline

Referenced by all tasks. Define it once here. This section *is* the system-design story; mirror it in the README with a diagram.

### 2.1 Data flow — Python writes, Go fans out, Redis is the seam

```
   ┌──────────── PYTHON (ingest) ───────────┐
   │  record.py  FastF1 → bake clip  ──────► data/replays/*.jsonl  (committed, downsampled)
   │  live.py    FastF1 live client ──┐      │
   └──────────────────────────────────┼──────┘
                                       │ (live mode: publish normalised events)
   ┌──────────── GO (gateway) ─────────┼──────────────────────────────────────┐
   │  replay player  read clip ────────┤  (replay mode: publish normalised events)
   │                                   ▼
   │                              ┌─────────┐  SET snapshot:{s}
   │                              │  REDIS  │  PUBLISH frames:{s}
   │                              └────┬────┘  (the only shared state + the seam)
   │   SUBSCRIBE frames:{s} · GET snapshot:{s}  │  (every gateway instance)
   │                                   ▼
   │   browser ◄─ WS ─ ┌───────────────────────────────────┐
   │   browser ◄─ WS ─ │ WS hub: on connect → send snapshot │  + serves the React SPA
   │   browser ◄─ WS ─ │ then stream published frames        │    (same origin)
   │                   └───────────────────────────────────┘
   └────────────────────────────────────────────────────────────────────────┘
```

- **Exactly one writer publishes at a time.** In **replay** mode the Go replay player is the writer; in **live** mode the Python live client is the writer. The manual toggle (Task 10) starts one and stops the other — never both on the `featured` channel at once.
- **Redis is the language-agnostic seam.** Python and Go never call each other; they agree only on the JSON event contract (§2.2) over Redis. ⚠️ This decoupling is the headline — say it in the README.
- **Gateways only read + serve.** Subscribe to `frames:{s}`, keep an in-memory snapshot, serve the React app + WebSockets. Stateless, so you scale them horizontally (the benchmark, Task 14).
- ⚠️ **One global, monotonic `Rev`, owned by whichever writer is active.** It must **never reset** — not across a replay loop, not across a live↔replay switch. If a fresh source restarted at `Rev=1`, clients holding a higher rev would reject its snapshot and the map would freeze. On every source switch, publish a full fresh snapshot at the next rev.

### 2.2 The normalised model — positions first

The contract is defined identically in Go and Python. Positions drive the map; the same data gives the running order for free. Telemetry fields are present but lightly used until Phase 2.

```go
// internal/model — the contract every layer shares (Python writes the same JSON shape)
type Point struct {
    X float64 `json:"x"`
    Y float64 `json:"y"`
}

type CarState struct {
    DriverNum int     `json:"driverNum"`
    Code      string  `json:"code"`            // "VER"
    Team      string  `json:"team"`
    Pos       int     `json:"pos"`             // running order (derived from positions)
    P         Point   `json:"p"`               // track-space coordinate (drives the map)
    Status    string  `json:"status"`          // "OnTrack" | "Pit" | "Out"
    Tyre      string  `json:"tyre,omitempty"`
    Speed     int     `json:"speed,omitempty"` // telemetry; Phase 2 makes rich use of it
}

type RaceControlMessage struct {               // flags / SC / DRS / penalties; Phase 3 uses team radio
    Rev      int64  `json:"rev"`
    T        int64  `json:"t"`
    Category string `json:"category"`
    Message  string `json:"message"`
    Driver   *int   `json:"driver,omitempty"`
}

type Snapshot struct {                 // full current state — served to new/reconnecting clients
    SessionKey string               `json:"session"`
    Mode       string               `json:"mode"`   // "live" | "replay"
    Label      string               `json:"label"`  // "Monza 2025 · Race"
    Track      []Point              `json:"track,omitempty"` // circuit outline, sent once (§2.4)
    Cars       map[int]CarState     `json:"cars"`
    Messages   []RaceControlMessage `json:"messages,omitempty"`
    TimeMs     int64                `json:"timeMs"` // session/replay clock (for lap-aligned compare)
    Rev        int64                `json:"rev"`    // monotonic, owned by the active writer
}

type Frame struct {                    // a delta published to clients (positions move every frame)
    SessionKey string               `json:"session"`
    Rev        int64                `json:"rev"`
    T          int64                `json:"t"`      // publish wall-time, unix ms → fan-out latency
    TimeMs     int64                `json:"timeMs"` // session clock
    Cars       []CarState           `json:"cars"`   // moved cars (in practice ~all, every frame)
    Messages   []RaceControlMessage `json:"messages,omitempty"`
}
```
> ⚠️ For a track map, **every car moves every frame**, so a position `Frame` carries (nearly) all cars — there's little point diffing positions. Diffing matters more for the Phase 2 timing fields. `Track` (the circuit outline) is sent **once** in the snapshot, not per frame.

### 2.3 The replay clip format
Each `.jsonl` line is `{"timeMs": <session clock>, "frame": <Frame>}`, ordered by `timeMs`, **downsampled** (e.g. 5–10 Hz, not the raw 3.7 Hz × interpolation). The recorder (Task 1) also computes the `Track` outline and writes it as the first line: `{"track": [...points...], "label": "...", "maxRev": N}`.

### 2.4 Drawing the track from position data
No per-circuit map files. The recorder takes one clean lap of the leader's positions, and that ordered set of points **is** the track outline (closed loop). Committed in the clip header; the frontend renders it as an SVG/Canvas path and maps car coordinates into the same space. ⚠️ Normalise/scale coordinates to a unit box at record time so the frontend doesn't have to know circuit dimensions.

### 2.5 Snapshot + fan-out (Redis)
- On each applied frame the active writer: `SET snapshot:{session}` (full JSON) **then** `PUBLISH frames:{session}` (the frame). ⚠️ **SET before PUBLISH**, always.
- New client connects → gateway sends its in-memory snapshot as the **first** WS frame → then streams subsequent frames.
- ⚠️ **Subscribe-before-snapshot:** a gateway must `SUBSCRIBE` **before** its initial `GET snapshot`, then drop any buffered frame whose `Rev` ≤ the snapshot's `Rev`.
- **The snapshot is the source of truth; frames are an optimisation.** This is why lossy Redis pub/sub is safe — any missed frame is healed by the next snapshot. If a gateway's subscription blips, it re-`GET`s the snapshot and resumes.

### 2.6 Client resume protocol
WS client stores the latest `Rev` it applied. On reconnect, the server sends a fresh snapshot first; the client replaces its state if the snapshot `Rev` ≥ its own; frames with `Rev` ≤ current are ignored (idempotent). Guarantees convergence after any disconnect.

### 2.7 Cross-year comparison (Task 11)
Two independent snapshots/streams (e.g. `monza-2025-race`, `monza-2026-race`), each its own Redis channel, each rendered by the **same `Map` component**, side by side. **Lap-aligned playback:** the frontend (or a small coordinator) advances both by matching `timeMs`/lap so both maps show the same phase of the race. ⚠️ Two seasons run at different paces — align by **lap number** for Phase 1 (simplest, meaningful); "same track position" alignment is a Phase 4 concern.

---

# Phase 1 — Animated Track Map + Comparison

## Task 1 — Recorder (Python / FastF1)
**File:** `ingest/record.py`, `ingest/normalise.py` · **Effort:** 2.5 d

### Task 1.1 — Pull a session with FastF1  `# NEW`
Load a finished session (`fastf1.get_session(year, gp, 'R')`), enable the cache, fetch position data + timing. ⚠️ FastF1's first load of a session is slow and network-heavy — cache locally; this is an offline batch step, run a handful of times ever.

### Task 1.2 — Normalise to the contract + downsample
Convert FastF1 position/timing into `Frame`s matching §2.2, resampled to ~5–10 Hz, coordinates scaled to a unit box (§2.4). Derive the running order from positions. Write `.jsonl` per §2.3, with the computed `Track` outline as the header line.

### Task 1.3 — CLI
`python -m ingest.record --year 2025 --gp monza --out data/replays/monza-2025-race.jsonl`. Document it in the README so anyone can bake more clips.

## Task 2 — Normalised event + snapshot model
**File:** `internal/model/model.go`, `ingest/model.py` · **Effort:** 1 d

### Task 2.1 — Define the types in Go and Python  `# NEW`
Per §2.2, identical JSON shapes both sides. ⚠️ Field names/tags must match exactly across languages — this contract is the seam; a mismatch breaks fan-out silently.

### Task 2.2 — `Apply(snapshot, frame)` (Go)
Pure function folding a frame into a snapshot: replace moved cars, append/cap messages, advance `Rev`. Idempotent — applying `Rev ≤ current` is a no-op. Unit-test ordering/idempotency.

## Task 3 — Replay player (Go)
**File:** `internal/feed/replay/play.go` · **Effort:** 1 d

### Task 3.1 — Read clip, emit on the clock  `# NEW`
Read `.jsonl`, emit frames honouring `timeMs` gaps × a speed factor, loop at end. ⚠️ Keep `Rev` **monotonic across the loop** (offset by `loop × maxRev`); re-stamp `T` to emit-time. Publish via the bus (Task 4).

## Task 4 — Redis fan-out + snapshot store (Go)
**File:** `internal/bus/redis.go` · **Effort:** 1.5 d

### Task 4.1 — Publisher (writer side)
`SET snapshot:{s}` then `PUBLISH frames:{s}` (§2.5).

### Task 4.2 — Subscriber + snapshot read (gateway side)
`SUBSCRIBE` then `GET snapshot` (order per §2.5 ⚠️). Expose `LatestSnapshot()` + a frame channel.

## Task 5 — WebSocket hub (Go)
**File:** `internal/ws/hub.go`, `client.go`, `handler.go` · **Effort:** 2 d

### Task 5.1 — Connection lifecycle
Upgrade; **send snapshot first**, then stream frames; deregister on close. Ping/pong keepalive.

### Task 5.2 — Broadcast + backpressure
Per-client buffered send channel; ⚠️ if a slow client's buffer fills, **drop/coalesce** rather than blocking the broadcast — one slow consumer must never stall the hub.

## Task 6 — Gateway: serve SPA + scaffold + Docker
**File:** `cmd/gateway/main.go`, `internal/config/*`, `Dockerfile`, `docker-compose.yml` · **Effort:** 1.5 d

### Task 6.1 — Serve the built React app (same origin)  `# NEW`
Embed `web/dist` with `embed.FS`; serve it from the gateway mux alongside `/ws`. Same-origin → no CORS, trivial WS origin check.

### Task 6.2 — `docker-compose` runs the full system
Services: `redis`, `ingest` (Python, plays/records), `gateway` (Go, scalable). ⚠️ `docker compose up` must work on a clean clone using the committed clips (Task 12) — this is the primary reviewer experience.

## Task 7 — 1a: React WS client + dots + standings
**File:** `web/src/realtime/socket.ts`, `web/src/state/race.ts`, `web/src/components/Map.tsx` · **Effort:** 2.5 d

### Task 7.1 — WS client (reconnect + resume)
Connect, apply snapshot then frames, track applied `Rev`, ignore stale (§2.6); exponential-backoff reconnect; surface connection states (Product §4.5).

### Task 7.2 — Plain dots + standings (prove the pipeline)
Render cars as plain markers at their `P` coordinates and a simple ordered standings list. ⚠️ No pretty track yet — this step exists to prove Python→Redis→Go→React with *position* data before any polish.

## Task 8 — 1b: Polished track + smooth animation
**File:** `web/src/track/draw.ts`, `web/src/track/interpolate.ts`, `web/src/components/Map.tsx` · **Effort:** 3 d

### Task 8.1 — Draw the circuit from the `Track` points
Render the closed path (SVG or Canvas), team colours, start/finish marker.

### Task 8.2 — Smooth car motion
Interpolate car positions between frames (the data is downsampled, §2.3) so motion is fluid; tween on each new frame. ⚠️ Handle cars that go `Pit`/`Out` (stop animating, dim marker).

## Task 9 — Loading / skeleton + connection states
**File:** `web/src/components/Skeleton.tsx`, `web/src/components/StatusBadge.tsx` · **Effort:** 0.5 d

### Task 9.1 — Cold-start skeleton  `# NEW`
While no snapshot exists yet, show a skeleton map + `Warming up the timing feed…`; render the live/replay badge and `Reconnecting…` / `Waiting for timing data…` per Product §4.5.

## Task 10 — 1c: Live feed + manual toggle
**File:** `ingest/live.py`, `internal/api/control.go` · **Effort:** 2 d

### Task 10.1 — Python live source  `# NEW`
FastF1 live client → normalise to the §2.2 contract → publish to Redis as the active writer. ⚠️ **Best-effort:** FastF1 live leans toward "capture during session" — verify how real-time it is early, and don't over-harden; if it glitches, the operator flips back to replay.

### Task 10.2 — Toggle control
A control endpoint to select the active source (start live writer / stop replay writer, or vice-versa). ⚠️ Exactly one writer per channel; switching publishes a fresh snapshot at the next `Rev` so clients converge.

## Task 11 — 1d: Cross-year comparison
**File:** `web/src/components/Compare.tsx` · **Effort:** 2.5 d

### Task 11.1 — Two maps, two sessions, lap-aligned  `# NEW`
Open two streams (e.g. `monza-2025-race`, `monza-2026-race`), render the **same `Map` component** twice side by side, advance both aligned by lap (§2.7). ⚠️ Don't start this until Task 8 (a single map) works on live + replay.

## Task 12 — Curated clips
**File:** `data/replays/*.jsonl` · **Effort:** 0.5 d

### Task 12.1 — Bake + commit a handful of short clips
2–4 min exciting segments, downsampled, a few MB each — **including a same-track two-year pair** for the comparison demo. Committed so `docker compose up` works on clone.

## Task 13 — Hub convergence integration test
**File:** `internal/ws/hub_integration_test.go` · **Effort:** 0.5 d

### Task 13.1 — Late-joiner + slow-client convergence
Spin the hub against in-memory Redis (`miniredis`) + a fake writer. Assert: a late joiner gets the snapshot then converges; a slow client is dropped without stalling the broadcast; a frame published between subscribe and snapshot-read is not lost (§2.5). This test *is* the evidence for the system-design claims.

## Task 14 — Load test + benchmark + README
**File:** `cmd/loadtest/*`, `BENCHMARKS.md`, `README.md` · **Effort:** 1.5 d

### Task 14.1 — Go WS load harness + numbers
Open thousands of concurrent connections against a multi-gateway setup while watching `/metrics`; record sustained connections + p50/p99 + setup in `BENCHMARKS.md`. This proves the horizontal-scale claim.

### Task 14.2 — README + demo recording
Architecture diagram (§2.1), GIF of the map + the two-year comparison, `docker compose up` instructions, the benchmark headline.

---

## Implementation Notes

- ⚠️ **One monotonic `Rev`, owned by the active writer, never reset** — across replay loops *and* live↔replay switches (§2.1). The most likely correctness bug.
- ⚠️ **The JSON contract is the seam between Python and Go** (§2.2) — field names/tags must match exactly both sides, or fan-out breaks silently. Consider a shared fixture both sides test against.
- ⚠️ **Subscribe-before-snapshot** on the gateway, and **SET-before-PUBLISH** on the writer (§2.5).
- ⚠️ **Backpressure:** a slow WS client must be dropped/coalesced, never allowed to block the broadcast loop (Task 5.2).
- **Positions move every frame** — don't over-engineer position diffing; carry all cars per frame. Diffing pays off for Phase 2 timing fields.
- **Draw the track from data, not files** (§2.4) — scale coordinates to a unit box at record time.
- **Build order is load-bearing:** plain dots end-to-end (Task 7) before the polished map (Task 8); comparison (Task 11) only after a single map works live + replay. Cut order if schedule slips: comparison first, then the live toggle (keep replay-only core + benchmark).
- **Live is best-effort and Python-side** (Task 10) — verify FastF1's live behaviour early; never let live-hardening eat the schedule, since replay is the demo.
- **No required hosting / no cost:** `docker compose up` runs the full real system locally (Python + Redis + N gateways); the multi-gateway + Redis benchmark is where scale is proven. Deploy is an optional ~20-min bonus.
- **Free data only:** FastF1 (historical + free live client); OpenF1 historical as a fallback. ⚠️ OpenF1 *live* now needs a paid tier and is rate-limited — prefer FastF1 for live.
- **Presentable repo:** `main` branch, README with the §2.1 diagram + GIF + `BENCHMARKS.md` headline, MIT `LICENSE`, green CI, Conventional Commits.
- **Out-of-scope guardrails:** Phase 1 is the map + standings + comparison only. Pit-wall timing (Phase 2), team radio (Phase 3), and the computed ghost-overlay (Phase 4) are deferred and reuse this pipeline.
