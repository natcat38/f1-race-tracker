# F1 Race Tracker — M4 (part 1): Cross-Year Comparison — Design

**Status:** Approved (brainstorming) · **Date:** 2026-06-19 · **Milestone:** Phase 1 / M4 (first of three M4 pieces)

## Context

M1–M3 delivered the real-time pipeline: Python/Go publishers → Redis (snapshot + pub/sub seam) → a switchable Go gateway → React track map, with a live/replay toggle. M4 is the last of Phase 1 and splits into **three independent deliverables**, each its own spec → plan → build cycle:

1. **Cross-year comparison** (this doc) — the headline user-facing feature.
2. Load test + benchmark (`cmd/loadtest` + `BENCHMARKS.md`) — separate, later. ⚠️ Needs re-scoping: the original scope assumed a `/metrics` endpoint and multi-gateway setup that M1–M3 never built.
3. README / demo-video polish — last.

This spec covers **only cross-year comparison.**

## Goal

A separate **Compare view** that shows the **same circuit across two seasons** as **two maps side by side, playing the same race phase in sync**, so a viewer can watch how the racing differed year to year. The concrete demo pair is **Monza 2023 vs Monza 2024**. It is "the single-map view rendered twice — no new data type."

## Scope

**In scope**
- A distinct Compare view (own route), separate from and leaving untouched the M3 live/replay board.
- One committed same-circuit pair: Monza 2023 + Monza 2024 (both already supported by FastF1).
- Two maps side by side, each the existing `Map` + standings, looping continuously **in phase-sync**.
- Comparison data flows **through the real pipeline** (Redis → gateway → WebSocket), reusing the streaming path — consistent with the system-design showpiece framing.

**Out of scope (explicitly deferred)**
- Lap-for-lap or same-track-position alignment (Phase 4 "ghost" overlay). Alignment here is **same-window, same-clock** (loose but meaningful).
- User-selectable circuits/years (a dropdown over several committed pairs) — trivial to add later if more pairs are baked; not in v1.
- A manual restart/scrub control — v1 auto-loops both in sync; not needed.
- Any change to the live/replay board, the operator toggle, or the M3 `/control/source` behavior.

## Design decisions (from brainstorming)

1. **Alignment = same-window, same-clock** (not lap-aligned). Rationale: delivers the visual "two years side by side" payoff with no contract change and no lap data (our clips carry `timeMs`/`rev`, no lap field). Lap/position alignment is a Phase 4 concern.
2. **Through the pipeline** (not client-side replay). Rationale: keeps the comparison consistent with the showpiece architecture and reuses the WS path; the multi-session capability it requires is a genuine, reusable gateway improvement.
3. **Separate view, one committed pair.** Smallest clean surface; the demo GIF needs only one good pair.

## Architecture

```
 monza-2023 clip ─► [ replay lane, PHASE_WALLCLOCK ] ─► SET snapshot:compare-monza-2023
                                                         PUBLISH frames:compare-monza-2023
 monza-2024 clip ─► [ replay lane, PHASE_WALLCLOCK ] ─► SET snapshot:compare-monza-2024
                                                         PUBLISH frames:compare-monza-2024
                                                                   │
                                                              [ REDIS ]
                                                                   │
                                                          [ GATEWAY ]
                              default /ws ──► active hub (M3 toggle, UNCHANGED)
                              /ws?session=K ─► hub-registry[K] (lazy, read-only)   ← NEW
                                                                   │
                            Compare view: two WS, one per compare session ─► two Maps
```

### Gateway: multi-session WebSocket (additive)
- The WS handler reads an optional `?session=<key>` query param.
  - **Absent** → the existing M3 path: served from the single active hub controlled by `/control/source`. **Unchanged.**
  - **Present** → served from a **hub registry**: `getOrCreateHub(session)` lazily subscribes to `frames:<key>`, seeds from `snapshot:<key>` (preserving subscribe-before-snapshot ordering), starts a consume goroutine, and caches the hub keyed by session for the gateway's lifetime (`baseCtx`). Subsequent connections to the same session share that hub's fan-out.
- The registry is **orthogonal** to the toggle: registry hubs are read-only, pinned to one session, never Reset/switched. The M3 active hub and `/control/source` are not modified. This guarantees no regression of M3 behavior.
- Lifecycle: registry hubs are created on first request and live for the process lifetime. No idle eviction (bounded session set in a demo — YAGNI).
- Validation: the `?session=` value is used directly as a Redis key suffix; it is read-only (SUBSCRIBE/GET only, never writes), so an unknown session simply yields an empty snapshot until/unless a lane publishes it. (Acceptable for a local demo; no auth.)

### Compare lanes (data source)
- Two ordinary Go `replay` services, one per year, each pointed at its clip and publishing to its own session key:
  - `compare-2023`: `CLIP_FILE=…/monza-2023-race.jsonl`, `SESSION_KEY=compare-monza-2023`.
  - `compare-2024`: `CLIP_FILE=…/monza-2024-race.jsonl`, `SESSION_KEY=compare-monza-2024`.
- Both run with `PHASE_WALLCLOCK=1` (see alignment).
- The existing `replay` (Monza 2024 → session `replay`) and `live` (Silverstone → session `live`) lanes are unchanged; the 2024 compare side uses a **dedicated** `compare-monza-2024` session (not the operator board's `replay` session) so the Compare feature is self-contained and unaffected by the operator toggle or any future change to the `replay` lane's clip.

### Alignment: equal-length clips + wall-clock-phased loop
- **Equal-length clips:** both Monza clips are baked with the **same window** (the recorder's fixed `WINDOW_START_S=3600`, `WINDOW_END_S=3750` → 150s / 1500 frames at 10 Hz), so both loops have the same period.
- **Wall-clock phasing:** the replay player gains an opt-in mode where each loop's playback position derives from the wall clock — the emit schedule is anchored so that playback position ≈ `now mod loopLength` — instead of from process-start. Two lanes keyed off the same wall clock therefore emit the **same phase** of their (equal-length) clips at the same moment, with no drift and no cross-process coordinator. A late-connecting client receives the current (mid-clip) snapshot + subsequent frames, already at the right phase.
- The main `replay`/`live` lanes keep their existing process-start phasing (`PHASE_WALLCLOCK` unset) — unchanged.

### Frontend: Compare view
- New `web/src/components/Compare.tsx`: opens two WebSocket connections via the existing `connectRace`, parameterised by session (`/ws?session=…`); holds two `RaceState`s; renders the existing `Map` (+ `Standings`) twice, each under a year heading (2023 | 2024). Reuses `race.ts`, `useSmoothedCars`, team colours verbatim.
- Routing: a minimal hash route (`#compare`) toggles between the main board and the Compare view, with a link/back-link. No router dependency — a tiny `location.hash` check in `App.tsx`.
- `socket.ts`: `connectRace` accepts an optional `session` argument; when set, the WS URL becomes `/ws?session=<key>`. Default (unset) → `/ws` exactly as today.
- Dev proxy: `/ws?session=…` is the same `/ws` path, so the existing Vite proxy already covers it.

## Components / files

| File | Change |
|------|--------|
| `internal/feed/replay/play.go` | Add opt-in wall-clock-phased loop (env-gated via config). |
| `internal/config/config.go` | Add `PhaseWallclock bool` from `PHASE_WALLCLOCK`. |
| `cmd/server/main.go` | Pass the phasing option into `replay.Load`/the source. |
| `internal/app/gateway.go` | Add hub registry + `getOrCreateHub`; WS handler honours `?session=`. M3 active-hub/toggle path untouched. |
| `internal/ws/handler.go` | Read `?session=` and route to the registry hub vs the active hub. |
| `ingest/record.py` | (No code change — reuse Task-3 argparse.) Run to bake Monza 2023. |
| `data/replays/monza-2023-race.jsonl` | New committed clip (same window as 2024, ~3 MB). |
| `web/src/components/Compare.tsx` | New: two streams, two `Map`s side by side. |
| `web/src/App.tsx` | Hash-route between board and Compare; link. |
| `web/src/realtime/socket.ts` | Optional `session` param → `/ws?session=`. |
| `docker-compose.yml` | Two `compare-*` lanes with `PHASE_WALLCLOCK=1`. |
| `README.md` | Note the Compare view + how to reach it. |

## Testing

- **Go unit/integration:**
  - Wall-clock phasing: two `replay.Source`s loaded from the same clip with phasing on, sampled at the same wall-clock instant, report the same frame index (deterministic by injecting/holding the clock or asserting phase math).
  - Gateway registry: a client connecting with `?session=X` receives session `X`'s snapshot then frames, while a default client still receives the active session (miniredis + real WS, mirroring the M3 switch test). Two `?session=` clients on different keys each get their own stream.
- **E2E (Docker):** `docker compose up --build -d` → open `http://localhost:8080/#compare` → two Monza maps (2023 + 2024), both with ~20 cars moving, visibly in the same race phase (phase-sync), no freeze. Verified via DOM inspection + screenshot.

## Risks / notes

- **Phase-sync tightness:** wall-clock phasing keeps the two lanes aligned in *clip time*; small rendering jitter is smoothed by `useSmoothedCars`. Equal-length clips are required — if the two bakes differ in frame count, re-bake to match.
- **Monza 2023 data:** assumed available + complete in FastF1 (2018+ is well-supported). If the 60–62.5 min window for 2023 lands under a safety car or sparse running, shift the window (recorder constants) and re-bake **both** years to keep them equal-length.
- **Container count:** the demo `docker compose` grows to redis + replay + live + gateway + 2 compare lanes. Fine for a dev machine; it visibly demonstrates the multi-lane architecture.

## Decomposition reminder

After this ships, the remaining M4 pieces (load test/benchmark, README/demo polish) are brainstormed + planned separately. The benchmark in particular must be re-scoped against the as-built single-gateway, no-`/metrics` reality before planning.
