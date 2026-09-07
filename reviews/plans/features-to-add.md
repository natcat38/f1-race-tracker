# Features worth adding — handoff doc (written 2026-08-29)

Self-contained brief for a future session. Sourced from a peer comparison against
f1-dash, Monaco, Pitwall, f1-race-replay, and open-pit-wall (full research:
`reviews/peer-comparison.md`), cross-checked against the roadmap at
`docs/superpowers/plans/2026-08-19-polish-and-immersion-roadmap.md`.

Before starting any item: read `CONTEXT.md` (vocabulary is enforced), the ADRs
touching your area (`docs/adr/`), and `FILE-MAP.md` for layout. Honour the
roadmap's §3 constraints (ADR-0002/3/4). Process: brainstorm → spec → plan per
feature, one PR-sized scope per agent.

Ranked by value-per-effort:

## 1. Throttle/brake/gear telemetry overlay over lap distance

**What:** extend the two-car telemetry compare from speed-only to full
throttle/brake/gear (optionally RPM) traces plotted over lap distance, like
Pitwall and f1-dash.

**Why:** the single most "race-engineer-real" feature in this genre — it is what
actual engineers look at, and the strongest recruiter-facing addition available.

**How:** FastF1 `car_data`/`pos_data` already expose Throttle, Brake, nGear, RPM
per sample. The contract already carries per-tick telemetry (ADR-0002 flat
fields on CarState — check which channels are already baked by
`ingest/record.py` vs need adding). Frontend: extend
`web/src/components/TelemetryPanel.tsx` (existing pedal bars + sparklines) into
distance-axis traces for the reference car and rival. Effort: M.

## 2. Pit-stop analysis

**What:** per-stop duration (pit-lane time and stationary time where derivable),
and net track positions gained/lost across each stop; surface on or beside the
stint/strategy timeline (`web/src/components/StintChart.tsx`).

**Why:** "who won the race in the pits" is strong strategy storytelling, and no
peer fork does it well — differentiated, not just parity.

**How:** FastF1 laps data has PitInTime/PitOutTime; positions around the stop
come from the existing frames. New bake-time aggregation in `ingest/record.py`
(snapshot-carried like stints, per ADR-0005's extend-existing-patterns rule).
Effort: M.

## 3. WS3 — replay playback controls on the main board

**What:** pause/scrub/speed for the replay source, plus a race timeline strip
(flags/SC/pit windows as markers). The ghost overlay can already pause/scrub;
the main board cannot.

**Why:** biggest UX gap left on the roadmap; f1-race-replay does 0.5×–4×
keyboard playback. Turns the demo from "watch what plays" into "explore a race".

**Caveat:** the roadmap itself flags this as needing its own design pass first —
scrubbing interacts with the writer/lane model (the replay writer paces the
lane server-side; client-side scrub of the *static demo* is a separate, easier
case). Do the brainstorm/spec pass before committing to an approach. Effort: L.

## 4. WS2 — track furniture

**What:** DRS zones, corner numbers, start/finish line, safety-car marker on the
track map (`web/src/components/Map.tsx`, `TrackPath.tsx`).

**Why:** makes the map read as a circuit rather than an outline; cheap visual
payoff for README screenshots. Roadmap workstream, not started.

**How:** bake furniture geometry into the clip header at record time (like the
track outline and lap traces, ADR-0004 pattern). FastF1 has circuit info
(corners, marshal sectors); DRS zones may need a small static dataset per
circuit. Effort: M–L.

## 5. Sector-dominance track map (minisector heatmap)

**What:** colour the track outline by which driver is fastest through each
(mini)sector, f1-dash style.

**Why:** visually striking, well-known broadcast feature; great screenshot.
Lower priority than 1–4.

**How:** distance-bin telemetry per driver at bake time, colour segments of
`TrackPath.tsx` by winner. Effort: M.

## 6. Free: market the replay-as-simulated-live architecture

**What:** a README paragraph stating explicitly that the replay writer feeds the
same contract, seam, and gateway as live — i.e. this repo already ships the
pattern open-pit-wall exists to provide (a simulated live feed for testing
dashboard clients).

**Why:** zero-code portfolio signal; system-design thinking recruiters notice.
Effort: S (docs only).

## Deliberate non-goals (name them, don't build them)

- Native desktop app / F1TV-in-app streaming (Nitrous's direction) — out of
  scope for a self-hosted web dashboard.
- Weather radar — no data source in FastF1; a temp/rain time-series chart is
  the feasible version if wanted later.

## Where the project already beats peers (context, for confidence)

Cross-season scrubbable ghost overlay with delta bar; production-shaped
FastF1 → Redis → Go gateway → React pipeline; radio + race control + strategy
in one dashboard; zero-setup static Pages demo.
