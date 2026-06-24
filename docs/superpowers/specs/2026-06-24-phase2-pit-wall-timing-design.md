# F1 Race Tracker — Phase 2: Pit-Wall Timing Dashboard — Design

**Status:** Approved (brainstorming) · **Date:** 2026-06-24 · **Milestone:** Phase 2 (first of three remaining phases)

## Context

Phase 1 shipped the full pipeline: Python (FastF1 ingest) → Redis (the seam) → Go gateway (WS fan-out) → React track map, with live/replay toggle and a cross-year compare view. Phase 2 adds a **Pit-Wall Timing Dashboard** — the detailed timing read (gaps, laps, tyres, sectors, telemetry) — as a data + UI layer on the **same pipeline**. No new architecture; ADR-0001 (single gateway) is unaffected.

This is **the first change to the event model / contract** since it was frozen. The new fields ride the existing `Snapshot`/`Frame`/`CarState` shapes, shared byte-identically by Python and Go (`internal/model/model.go` is canonical). `CarState.Tyre` and `CarState.Speed` are already reserved for this phase.

## Goal

A **timing tower docked beside the existing track map** on the main board: one row per car (position, gap, interval, last lap, tyre, sectors), with a per-car telemetry readout on selection. Keeps the track map primary (the project's signature), adds pit-wall data density alongside it. The committed **replay** clips are the demo target.

## Scope

**In scope**
- Extend `CarState` with timing/telemetry fields (flat, `omitempty`) — Option A below.
- Recorder (`ingest/record.py`) emits the new fields; **re-bake the 3 committed clips** (Monza 2023, Monza 2024, Silverstone 2024).
- Update the Python↔Go contract-parity check for the new fields.
- Frontend: timing tower beside the map + click-to-expand telemetry panel; sector best colouring computed client-side.
- One benchmark run to validate the Option A frame-size tradeoff.

**Out of scope (explicitly deferred)**
- **Full timing on the live lane.** Live is best-effort; its omitted fields render blank. Phase 2 targets the committed replay demo. (Live can be enriched later without a contract change — the fields already exist.)
- **Lower-cadence / split timing message (Option B).** Deferred unless the benchmark proves Option A blows the p99 budget. The `ponytail:` comment names this upgrade path.
- Pit-stop history, weather, fuel, lap-by-lap charts, driver standings deltas over time — not pit-wall-essential for the demo.
- Any change to the gateway, replay player streaming logic, the operator toggle, or the compare view beyond the new fields flowing through.

## Design decisions (from brainstorming)

1. **Option A — flat fields on `CarState`, rebroadcast every frame.** Rationale: zero new types, byte-identical Python↔Go extension, consistent with CONTEXT.md's "a frame is not a sparse diff — it carries almost all cars." Nothing about parity, heal-by-snapshot, or Rev changes. The slow fields (laps/sectors/tyre/gap) are redundant per-tick but the simplicity wins until measured otherwise.
   - **Known ceiling (ponytail):** frame size roughly doubles (~2 KB → ~4 KB for 20 cars). If the existing `BENCHMARKS.md` harness (1000 viewers @ 10 Hz) shows the p99 budget blown, *that measurement* justifies upgrading to Option B (split slow data to a lower-cadence sub-message). Not a guess up front.
2. **Gap/interval is the one best-effort field.** FastF1 gives no per-tick gap; it's derived at record time from per-car race distance (lap count + lap fraction) ÷ leader pace, baked into the clips. Labeled approximate in the UI so it doesn't read as broadcast-grade.
3. **Sector best-colouring computed in the frontend.** Send raw sector times (3 plain ints); the UI tracks personal-best (green) / session-best (purple) from values seen so far. Keeps the contract minimal — no baked flags, no per-frame bloat for presentation state.
4. **Replay demo is the target, live degrades gracefully.** All four field groups are populated in the baked clips; the live lane omits what it lacks and the UI renders blanks.

## The contract extension

New fields on `CarState` (all `omitempty`; `Tyre`/`Speed` already present):

| Field (Go) | json | Type | Source (FastF1) | Cadence |
|---|---|---|---|---|
| `Tyre` *(exists)* | `tyre` | string | `laps.Compound` | slow |
| `TyreAge` | `tyreAge` | int | `laps.TyreLife` (stint laps) | slow |
| `LastLapMs` | `lastLapMs` | int | `laps.LapTime` | slow |
| `BestLapMs` | `bestLapMs` | int | `laps.LapTime` (min) | slow |
| `S1Ms` / `S2Ms` / `S3Ms` | `s1Ms`/`s2Ms`/`s3Ms` | int | `laps.Sector{1,2,3}Time` | slow |
| `GapMs` | `gapMs` | int | **derived (best-effort)** | slow |
| `IntMs` | `intMs` | int | **derived (best-effort)** | slow |
| `Speed` *(exists)* | `speed` | int | `car_data.Speed` | fast |
| `Gear` | `gear` | int | `car_data.nGear` | fast |
| `Throttle` | `throttle` | int (0–100) | `car_data.Throttle` | fast |
| `Brake` | `brake` | int (0–100) | `car_data.Brake` | fast |
| `DRS` | `drs` | bool | `car_data.DRS` (open?) | fast |

**`omitempty` note:** a zero value is dropped from the JSON. Absence = 0 = "off"/"none" (brake 0, gap 0 → "Leader", no last lap yet → blank). Acceptable for the demo; the UI treats missing as empty, not as an error.

## Architecture

No pipeline topology change. The new fields flow through the **existing** path:

```
record.py  ──(bakes timing fields into clip JSONL)──►  data/replays/*.jsonl
                                                              │
                       replay lane (Go) reads clip ──► SET snapshot:<key> / PUBLISH frames:<key>
                                                              │
                                                         [ REDIS / seam ]
                                                              │
                                                         [ GATEWAY ]  (unchanged — same struct + JSON)
                                                              │
                                                         /ws  ──► React board
                                                                   ├─ Map (unchanged)
                                                                   └─ TimingTower (NEW, beside the map)
                                                                        └─ TelemetryPanel (NEW, per selected car)
```

- **Go:** essentially free. Adding fields to `model.CarState` flows through the replay player, snapshot store, and gateway fan-out with no logic change (they (de)serialise the whole struct).
- **Python recorder:** the real work on the ingest side — populate the new fields per frame via a session-time step-lookup against `session.laps` (same pattern already used to derive `pos`) plus `car_data` for telemetry, and compute gap/interval.
- **Frontend:** the bulk of new code — parse the fields in `race.ts`, render the tower + telemetry panel, manage selected-car state, compute sector colouring.

## Components / files

| File | Change |
|------|--------|
| `internal/model/model.go` | Add the timing/telemetry fields to `CarState` (canonical contract). |
| `web/src/state/race.ts` | Parse the new fields into the client car state. (`race.test.ts` exists — extend it.) |
| `ingest/record.py` | Emit new fields: step-lookups from `laps`, telemetry from `car_data`, derived gap/interval. Update the in-file CONTRACT docstring + validation sets (keep new fields optional). |
| `data/replays/monza-2024-race.jsonl` | Re-bake with timing fields. |
| `data/replays/monza-2023-race.jsonl` | Re-bake (keep equal-length with 2024 for compare). |
| `data/replays/silverstone-2024-race.jsonl` | Re-bake with timing fields. |
| `ingest/check_live_contract.py` | Extend the parity check to cover the new optional fields. |
| `web/src/components/Standings.tsx` | The existing per-car table — decide in planning whether to enrich it into the tower or keep it and add `TimingTower.tsx` alongside. |
| `web/src/components/TimingTower.tsx` | New (or enriched `Standings`): one row per car, sorted by `pos`; gap/interval/lastLap/tyre/sectors. |
| `web/src/components/TelemetryPanel.tsx` | New: per selected-car readout (speed/gear/throttle/brake/DRS). |
| `web/src/App.tsx` | Dock the tower beside the `Map`; hold selected-car state. |
| `README.md` | Note the timing dashboard on the main board. |

## Gap / interval derivation (best-effort)

Computed once at record time, baked into the clips:

1. For each frame, each car's **race distance** ≈ `(completed laps × track length) + (lap fraction)`, where lap fraction comes from progress along the baked track outline / cumulative position distance.
2. **Gap to leader** = `(leader race distance − car race distance) / leader average speed`, in ms.
3. **Interval** = same formula between a car and the one directly ahead (by `pos`).

This is an approximation (no tyre/traffic/DRS effects, leader-pace assumption). `# ponytail:` comment names the ceiling: *good enough for a labeled-approximate demo tower; swap for FastF1 timing-feed gaps if real-data accuracy is ever needed.* If derivation proves noisy in a baked window, fall back to lap-level gap deltas (coarser but stable) — decided during implementation against real clip data.

## Testing

- **Contract parity:** the Python↔Go parity check passes with the new fields present (round-trips a sample frame through both serialisers).
- **Recorder self-check:** `record.py`'s existing contract validation extended — sampled frames carry the new fields with sane ranges (lap times > 0, throttle 0–100, tyre in the known compound set, gap monotonic-ish by position).
- **Frontend:** tower renders one row per car sorted by position; selecting a car shows its telemetry; sector cells colour green/purple correctly from a known input; missing fields render blank, not `NaN`/`undefined`.
- **Benchmark (the Option A gate):** one `BENCHMARKS.md` harness run against a re-baked clip → confirm p99 stays within budget with the larger frames, or record the number that triggers the Option B upgrade.
- **E2E (Docker):** `docker compose up --build -d` → `http://localhost:8080` → map + timing tower beside it, ~20 rows updating, click a car → telemetry. Verified via DOM inspection + screenshot.

## Risks / notes

- **Frame-size regression** is the headline risk and is explicitly measured, not assumed (Option A gate). The upgrade path (Option B) is pre-decided.
- **Gap/interval accuracy:** best-effort by design and labeled as such. Worst case it looks slightly off vs. broadcast; it never blocks the demo. Fallback derivation noted above.
- **Clip size growth:** re-baked clips grow with the extra per-frame fields (the recorder already warns > 5 MB). If a clip crosses the limit, trim the window — but Monza 2023/2024 must stay **equal-length** for the compare view (existing constraint).
- **Compare view:** inherits the new fields for free (same clips, same `Map`), but the tower is a main-board feature; the compare view is unchanged beyond the data flowing through. No tower in compare unless a later phase asks for it.
- **`omitempty` zero-drop:** a genuine value of 0 (e.g. brake fully off) is indistinguishable from absent. Fine here — both mean "off/none" to the UI.

## Phase boundary reminder

Phase 3 (team-radio) and Phase 4 (ghost overlay) remain, each its own spec → plan → build. Phase 2's timing fields are reused, not replaced, by those — Phase 4's "ghost" delta in particular can lean on the per-car race-distance computation introduced here for gap/interval.
