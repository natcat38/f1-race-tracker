# F1 Race Tracker — Product Scope

> **Audience:** product/portfolio readers (and the recruiter who lands on the repo). Plain language, no code.
> **Status:** scoped, pre-build. Reframed after design review (June 2026) into a **polyglot, track-map-first** project.
> **Companion doc:** `F1_Race_Tracker_Tech_Scope.md`.

---

## 1. Background & Problem Statement

During a Formula 1 session, the part fans care about — where the cars are on track, who's gaining on whom, the gaps, the tyres — is locked behind F1's paid app, and the free alternatives are cluttered. There's room for a **clean, real-time view of a race**: cars moving around the circuit, with a live order alongside.

For a portfolio, this is also a deliberate **system-design showpiece**. A live race view is a textbook real-time distributed-systems problem — take a streaming data source, normalise it, and fan it out to many browsers with low latency, surviving reconnects and late joiners. It's built as a **polyglot system** on purpose: **Python** for the data-heavy ingestion, **Go** for the high-performance real-time fan-out, **React** for the visualisation — a clear "I work across the stack and pick the right tool for each job" story that a recruiter can both *see running* and *read in the code*.

**Two design realities shape everything:**
1. **Real F1 sessions only happen on a few weekends a year.** So the system runs from **two interchangeable feeds** behind one pipeline — a **live** feed during real sessions, and a **replay** of a recorded session the rest of the time — so the view always looks alive. The source is a toggle, not a separate code path.
2. **It is built to run for free, with no always-on hosting.** The primary way people experience it is a polished README + a recorded demo; the way a hands-on reviewer experiences it is **`docker-compose up`**, which runs the *full, real, multi-server system* on their own machine. A hosted live link is an optional bonus, never a requirement.

---

## 2. Proposed Solution

A **real-time F1 race visualisation**: a Python ingestion layer feeds normalised events through Redis to a Go fan-out tier, which streams them to a React frontend that renders **cars moving around the circuit** plus a live order. Fed by **live or replay**, switchable on demand.

**Phase 1 — Animated Track Map + Comparison (the core):**
- An **animated track map**: cars moving around the circuit in real time, the **track outline drawn from the position data itself** (no per-circuit map files needed).
- A **minimal standings list** beside the map (running order), which comes "for free" from the same data.
- **Live or replay**, with a **manual toggle** to switch between them. The replay loops cleanly and is the default "always looks alive" mode.
- **Cross-year comparison:** the same circuit across two seasons (e.g. **2023 vs 2024**) shown as **two maps side by side, aligned**, so you can watch how the racing differed. Built *last* in Phase 1, on top of the working single map.
- New visitors **joining mid-session immediately see the current state** (a snapshot), then live updates. **Reconnects** re-sync automatically.

**Phase 2 — Pit-Wall Timing Dashboard (later):**
- The detailed timing screen — gaps, intervals, last/best laps, tyre stints, sector times, telemetry readouts — the "pit wall" view. Reuses the entire pipeline; adds richer data and UI.

**Phase 3 — Team-Radio Comms (later):**
- The driver ↔ race-engineer **team radio** played alongside the race (the audio is freely available), as a toggleable layer.

**Phase 4 — Cross-Year "Ghost" Overlay (later):**
- A computed **delta** between two seasons — a "ghost" of last year's car overlaid on this year's, showing where time is won or lost. A deliberate, toggleable analytics layer (the richer cousin of Phase 1's side-by-side).

### Core principle: one pipeline, swappable feeds, two languages either side of Redis
> Live and replay produce the **same normalised event stream** onto Redis, so everything downstream (Go fan-out → WebSocket → React) is **identical** whether it's a real race or a replay. Redis is the language-agnostic seam: **Python writes** events on one side, **Go reads and fans out** on the other. They agree only on a JSON event contract.

---

## 3. Scope of Work

> **Phase 1 — Animated Track Map + Comparison.** Goal: cars moving on a circuit, drawn from real F1 position data, fed by live or replay, fanned out to many browsers, plus a side-by-side two-year comparison. Built tracer-bullet first: prove the whole pipeline with plain moving dots before polishing.

| Layer | Task | Effort | Component |
|-------|------|--------|-----------|
| Python | Recorder: FastF1 → normalised replay clip (positions + order) | 2.5 d | Ingest |
| Shared | Normalised event + snapshot model (the contract) | 1 d | Contract |
| Go | Replay player (read clip → publish to Redis) | 1 d | Playback |
| Go | Redis fan-out + latest-state snapshot | 1.5 d | Fan-out |
| Go | WebSocket hub (snapshot-on-join, reconnect, backpressure) | 2 d | Realtime |
| Go | Gateway serves the React app (same origin) + scaffold/config | 1.5 d | Shell/Ops |
| Frontend | WebSocket client (reconnect + resume) | 1 d | Realtime |
| Frontend | **1a:** plain moving dots + standings list (prove the pipeline) | 1.5 d | UI |
| Frontend | **1b:** draw track from positions, smooth car animation, colours | 3 d | Track map |
| Frontend | Loading / skeleton screen | 0.5 d | UI |
| Python | **1c:** Live feed (FastF1 live → Redis) + manual live/replay toggle | 2 d | Ingest |
| Both | **1d:** Cross-year comparison (two maps side by side, lap-aligned) | 2.5 d | Comparison |
| Ops | Curated downsampled clips (incl. same-track two-year pair) | 0.5 d | Data |
| Both | `docker-compose` (Python + Redis + Go gateway) | 1 d | Shell/Ops |
| Go | Hub convergence integration test | 0.5 d | Realtime |
| Ops | Load test + benchmark + README + demo recording | 1.5 d | Ops |
| | **Phase 1 total** | **~23–25 d** | |

> **Phases 2–4 (post-Phase-1).** Effort TBD — each reuses the Phase 1 pipeline.

| Layer | Task | Phase | Component |
|-------|------|-------|-----------|
| Both | Pit-wall timing dashboard (gaps, laps, tyres, sectors, telemetry) | 2 | Timing |
| Both | Team-radio audio layer (toggleable) | 3 | Comms |
| Both | Cross-year computed "ghost" delta overlay (toggleable) | 4 | Comparison |

**Total estimated effort (Phase 1): ~23–25 developer-days.** Cut order if it runs long: cross-year comparison (1d) is the deferrable tail; the live toggle (1c) can follow the replay-only core.

---

## 4. User-Facing Behaviour

### 4.1 The track map (Phase 1)
- A **circuit drawn from real position data**, with one **marker per car** moving around it in real time, coloured by team.
- Animation is **smooth** even though the underlying data is sampled a few times a second — the frontend interpolates between points.
- A **badge** states what's playing and how: `● LIVE — {Grand Prix} {Session}` or `▶ REPLAY — {Grand Prix} {Year} {Session}`.

### 4.2 The standings list (Phase 1)
- A compact list beside the map showing the **running order** (position, driver code, team colour). The detailed timing screen (gaps, tyres, sectors) is **Phase 2**, not here.

### 4.3 Live / replay toggle (Phase 1)
- A control to **switch the source**: play a recorded replay, or switch to the **live** lane. The switch is server-side (the active *writer* changes); all connected viewers converge to the new source. The live lane is best-effort: a real F1 session is only available on race weekends, so **out of the box the live lane streams a clip through the Python writer** — this exercises the polyglot seam (Python publishing the identical contract the Go writer uses) rather than literal live data. The real live-timing client exists and is used during actual sessions.
- Because the deployment is local and single-operator, the toggle is **open** — no login. (There is no anonymous public site to protect.)
- The replay **loops cleanly** — a brief `↻ replay restarting` beat covers the reset so it never snaps jarringly from finish back to lap 1.

### 4.4 Cross-year comparison (Phase 1, built last)
- Pick the **same circuit across two seasons** (e.g. Monza 2023 and Monza 2024). The view shows **two maps side by side**, playback **aligned** so you can watch the same phase of the race in both years at once. It is literally the single-map view **rendered twice** — no new data type.

### 4.5 Joining mid-session & connection states
A visitor who connects after playback started **immediately sees the current car positions** (from the latest snapshot), then live updates. Connection rules:

| Trigger | What the user sees | Copy |
|--------|--------------------|------|
| Connected, receiving updates | Live map + green dot | `● LIVE` / `▶ REPLAY` |
| Still starting up (cold) | Skeleton map + spinner | `Warming up the timing feed…` |
| WebSocket drops | Map freezes, auto-retry with backoff | `Reconnecting…` |
| Reconnected | Re-syncs to current snapshot | *(silent)* |
| Feed stalls (no events) | Last frame kept, staleness shown | `Waiting for timing data…` |

> **Two independent resilience layers:** the WebSocket client auto-reconnects with backoff, and on every (re)connect the server replays the latest snapshot first. A client can drop, sleep, or join late and always converge — there is no path that leaves the map permanently wrong.

---

## 5. Decision Matrix

✅ shows correct state · ⚠️ degraded but safe · ❌ only on hard failure

| Scenario | Source | WS connected? | Snapshot available? | Outcome |
|----------|:---:|:---:|:---:|---------|
| Replay running (default) | replay | ✅ | ✅ | ✅ Map animating, `▶ REPLAY` |
| Operator toggles to live during a real session | live | ✅ | ✅ | ✅ Map follows live session, `● LIVE` |
| Visitor joins mid-playback | either | ✅ | ✅ | ✅ Sees current car positions instantly, then updates |
| Connection drops | either | ❌→✅ | ✅ | ⚠️ `Reconnecting…` → silent re-sync |
| Live feed glitches (best-effort) | live | ✅ | ✅ (stale) | ⚠️ Operator flips back to replay; nothing public breaks |
| Feed stalls (no new events) | either | ✅ | ✅ | ⚠️ Last frame kept, `Waiting for timing data…` |
| Fresh start, nothing baked yet | replay | ✅ | ❌ | ⚠️ Skeleton + `Warming up the timing feed…` |

---

## 6. How It's Run & Demoed

> This replaces the original "always-on hosted site." There is **no required hosting** and **no cost**.

- **Primary artifact (what most people see):** a polished **README** with the architecture diagram, a recorded **GIF/video** of the map animating and the two-year comparison, and the **benchmark numbers**.
- **Hands-on reviewer:** **`docker-compose up`** runs the *full real system* locally — Python ingestion + Redis + the Go gateway — so a serious reviewer sees the actual polyglot architecture, not a simplified version. The gateway is stateless by design (so it *could* run as multiple replicas), but the system currently runs and is benchmarked as a single gateway — see `docs/adr/0001-single-gateway-deferred-multigateway.md`.
- **Hosted live link:** *optional and deferred.* Deploy instructions are included so it can go live in ~20 minutes, but running it 24/7 is never a requirement or a maintenance burden.
- **The benchmark** (concurrent WebSocket connections, p50/p99 fan-out latency) is run on demand and published in `BENCHMARKS.md` — it measures how a **single gateway** holds up as concurrent viewers climb (a lower bound, since the load generator shares the host). The stateless-gateway + Redis seam is what *would* make a multi-gateway tier a config change; building and benchmarking that tier is future work (see ADR-0001).

---

## 7. Out of Scope

- **Always-on public hosting** — deliberately retired; demo is README + video + local `docker-compose`. Deploy is an optional bonus.
- **Paid data tiers** — uses **free** F1 data only (FastF1; OpenF1 historical). Live uses FastF1's free client, best-effort.
- **Full-race data files in the repo** — only short, curated, downsampled clips are committed; the recorder bakes more on demand.
- **The detailed pit-wall timing screen** — Phase 2.
- **Team-radio audio** — Phase 3. **Computed cross-year "ghost" delta** — Phase 4.
- **User accounts / auth** — none; runs locally, single-operator.
- **Native mobile app** — responsive web only.
- **Automatic live-vs-replay switching** — the toggle is manual, operator-driven.

---

## 8. Rollout Plan

- **Phase 1 — Animated Track Map + Comparison:** ~23–25 dev-days. Built tracer-bullet first (plain dots end-to-end → polished map → live toggle → comparison last). Deliverables: working local system via `docker-compose up`, README with architecture diagram + demo GIF, `BENCHMARKS.md`, a few committed curated clips (including a same-track two-year pair), MIT-licensed.
- **Phase 2 — Pit-Wall Timing Dashboard:** effort TBD.
- **Phase 3 — Team-Radio Comms:** effort TBD.
- **Phase 4 — Cross-Year Ghost Overlay:** effort TBD.
- **Default behaviour:** out of the box, `docker-compose up` plays a curated replay — the map animates immediately with real F1 data, no live race or external setup required.
