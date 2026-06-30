# F1 Race Tracker — Phase 4: Cross-Year Ghost Overlay — Design

**Status:** Approved (brainstorming) · **Date:** 2026-06-30 · **Milestone:** Phase 4 (the final phase)

## Context

Phases 1–3 shipped the full pipeline (Python FastF1 ingest → Redis seam → Go gateway WS fan-out → React track map), the pit-wall timing tower + telemetry, and the team-radio comms layer. Phase 4 is the last phase: the **cross-year ghost overlay** — a computed **delta** between two seasons, the richer cousin of the existing Phase-1 **compare** view (which just shows two maps side by side, in phase, with no computation).

This is the **third change to the event model / contract**, and the first feature that **relates two independent lanes** to each other rather than rendering each in isolation. The two compare lanes (`compare-monza-2023`, `compare-monza-2024`) are already played **in phase** by wall-clock (`replay.SetWallclockPhase`), both 4500 frames, same circuit. Phase 4 builds the overlay on top of them.

**Data foundation is already on the wire or trivially derivable:**
- Each lane's `Snapshot` carries the baked `Track` outline and every car's `P` (track-space x/y in `[0,1]`) per frame.
- The recorder already derives lap-fraction as *nearest baked-outline index ÷ N* (`_lap_fraction`, `ingest/record.py:336`) and lap number from FastF1 `LapNumber` (`_lap_number`, `:351`). Both are recorder-internal today (underscore-prefixed), not on the wire.
- `CarState` already carries per-lap sector times `S1Ms/S2Ms/S3Ms` — but the chosen design is the **continuous** delta, not 3-sector, so these are not the delta source.

## Goal

A new `#ghost` route showing **one** Monza track map: **this year (2024) solid**, plus a **user-selected driver's last-year (2023) car as a translucent "ghost."** A **delta bar** beneath/around the map plots, round the lap, how much time that driver is **gaining or losing** vs their own 2023 lap — red where slower this year, green where faster. The track map stays primary; the overlay is the analytics layer on top.

## Scope

**In scope**
- New baked artifact **lap trace** — a per-driver pace curve. Additive `LapTrace map[int][]int` on **`Snapshot` only** (`internal/model/model.go`); Python↔Go contract parity updated.
- Recorder (`ingest/record.py` + new pure helper `ingest/ghost.py`, templated on `ingest/radio.py`): for each driver, pick the **fastest clean complete lap** in the window as reference; record cumulative ms from lap-start at each track-outline index. Bake into the **clip header** (`lapTrace: {driverNum: [ms_at_i ...]}`). Length = `len(Track)`; index `i` ↔ `Track[i]` ↔ fraction `i/N`; value at `i=0` (start/finish) = 0.
- Thread `LapTrace` header → snapshot on **both** lane paths (Go replay path in `internal/feed/replay/play.go` → `internal/app/writer.go`, beside `snap.Track`/`snap.Radio`; Python live path in `ingest/live.py` `build_snapshot`, mirroring `header.get("track")`). Mirrors exactly how `Radio` was threaded in Phase 3.
- Frontend `#ghost` route — new `web/src/components/Ghost.tsx`, dual-subscribes both compare lanes (reuses `connectRace`, like `Compare.tsx`):
  - **Base map** = 2024 lane.
  - **Ghost marker** = selected driver's 2023 `P`, drawn translucent (time-phased — lanes are already in phase, so it's the live position at the same elapsed moment). FE-only, no baked data.
  - **Delta bar** = a strip under the map, x = lap fraction (sector-divided), y = signed Δ seconds, red/green fill. `Δ_i = trace_2024[d][i] − trace_2023[d][i]`; `Δ_0 = 0`, `Δ_last` = lap-time difference.
  - **Selection** = reuse the existing tower row-click / car-click → `selectedDriver`; default to a driver present in both years (VER) so the page is non-empty on load.
- Pure FE delta helper (e.g. `web/src/state/ghost.ts`) with unit tests, mirroring the `comms.ts` pure-logic pattern.

**Terminology** (CONTEXT.md, finalised by grill-with-docs): **ghost** = the translucent last-year car marker; **overlay** = the whole one-map mode (this-year + ghost + delta); **delta bar** = the computed signed time difference round the lap; **lap trace** = the baked per-driver pace curve. All distinct from **compare** (side-by-side, no computation).

**Out of scope (explicitly deferred / not built — ponytail)**
- **3-sector delta from `S1/S2/S3`.** The cheaper FE-only path was offered and declined in favour of the continuous bar; not built.
- **Cross-clip delta baking.** Each recorder run is single-year; it bakes only its own per-driver traces. The cross-year subtraction happens FE-side. No new pipeline stage that reads both clips.
- **`Frame.LapTrace`.** A lap trace is a fixed per-driver dataset → snapshot-only, like `Track`/`Radio`. No per-frame plumbing.
- **Ghost on the main board or as a toggle on `#compare`.** A dedicated `#ghost` route was chosen; the main board and `#compare` are unchanged.
- **Lap number on the wire.** Not needed — the delta normalises each trace to lap-start = 0 and compares shape vs fraction.
- **Multi-driver / all-driver ghosting at once.** One selected driver at a time.

## Design decisions (from brainstorming)

1. **Deliverable = ghost marker + continuous delta bar, both.** The translucent moving ghost (spatial, intuitive) plus the round-the-lap delta bar (analytical "where time is won/lost"). The user chose the fuller version at each fork (both deliverables, user-selected driver, continuous bar over 3-sector, dedicated route).

2. **Reference car = user-selected driver, like-for-like across years** (e.g. VER 2024 solid vs VER 2023 ghost). Reuses the tower's existing row-click selection. Cross-year "the leader" would compare different people; selecting a driver keeps it like-for-like.

3. **Delta = baked per-clip pace traces, subtracted FE-side.** Each clip bakes a per-driver lap trace (cumulative ms vs outline index, for the driver's fastest clean lap). The FE holds both lanes (dual-subscribe) and subtracts: `Δ(f) = (t_2024(f) − t_2024(0)) − (t_2023(f) − t_2023(0))`. This is the real F1 "cumulative time gained/lost round the lap."
   - **Why baked, not pure-FE:** the continuous bar must show the **whole lap** immediately and accurately, not just the portion watched so far. A baked full-lap curve gives that on connect; accumulating it live from positions would be partial and noisy.
   - **Why per-clip + FE subtraction, not a cross-clip baking step:** keeps the recorder single-year (no new stage that loads both clips), and the contract addition is a clean per-clip per-driver field — same shape as `Track`/`Radio`.
   - **Known ceiling (ponytail):** reference = *fastest clean lap*, best-effort, labelled approximate (consistent with gap/interval/radio). If a driver has no clean lap in the window, no trace for them. Recorded as **ADR-0004**.

4. **Ghost marker is time-phased and FE-only.** Lanes are already in phase, so the selected driver's 2023 `P` at the current render tick *is* "where last year's car was at the same elapsed moment." Draw it translucent on the 2024 map. No baked data, no contract change for this part.

5. **Trace resolution = track-outline index count.** `LapTrace[d]` has length `len(Track)`, so fraction buckets map 1:1 to outline points and to the rendered map — no separate fraction grid to reconcile.

## Edge cases & approximations

- Driver absent in the other year's window → no ghost, no delta bar; show "No 2023 data for X."
- No clean lap for a driver → no trace baked for them (graceful; FE shows the same "no data" state).
- Start/finish wrap: traces are cumulative from lap-start = 0, monotonic increasing to the lap end at `i = N`; the FE delta is a straight element-wise subtraction with no wrap math (the normalisation removes it).
- Everything labelled **approximate**, consistent with the existing best-effort precedent (ADR-0002).

## Testing

- **Recorder helper** (`ingest/test_ghost.py`, stdlib-only, runs in CI like `test_radio.py`): trace starts at 0, is monotonic non-decreasing, length = N; fastest-clean-lap selection; missing-lap → no trace.
- **FE delta math** (`web/src/state/ghost.test.ts`): subtraction + sign, `Δ_0 = 0`, missing-driver / missing-trace handling.
- **Contract parity**: extend the existing Python↔Go self-check for the new `LapTrace` field, as was done for `Radio`.

## ADR

**ADR-0004** — cross-year delta computed from baked per-clip pace traces, subtracted FE-side; reference = fastest clean lap; best-effort/approximate; `Frame` unchanged; ghost marker is FE-only/time-phased. A real where-to-compute + new-baked-field decision (mirrors ADR-0002's best-effort, derived-at-record-time precedent). Drafted in the grill-with-docs pass.

## Architecture impact

No change to ADR-0001 (single gateway). ADR-0002 (timing fields every frame) and ADR-0003 (radio streamed) unaffected. The only structural change is the additive `LapTrace` snapshot field and one new FE route; the pipeline shape is untouched.
