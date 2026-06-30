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

A new `#ghost` route: a **self-contained looping player** that replays a selected driver's **reference lap** (fastest accurate lap) from two seasons **in sync** on one Monza track map — **2024 solid**, **2023 a translucent ghost** — both animated along the shared track outline at their own pace. A **delta bar** plots, round the lap, the signed time the driver gains or loses vs their 2023 self (red slower, green faster), with a cursor following playback. Everything on screen derives from the same two reference laps, so the ghost's spatial gap and the bar always agree. This is **not** the live race with a ghost on top — it is a like-for-like flying-lap comparison.

## Scope

**In scope**
- New baked artifact **lap trace** — a per-driver pace curve. Additive `LapTrace map[int][]int` on **`Snapshot` only** (`internal/model/model.go`); Python↔Go contract parity updated.
- Recorder (`ingest/record.py` + new pure helper `ingest/ghost.py`, templated on `ingest/radio.py`): for each driver, pick the **fastest accurate lap of the whole session** (`pick_accurate()` then fastest — the same clean-lap call that already builds the track outline, [record.py:196](../../ingest/record.py)); whole-session position data is available (unaffected by the replay window). Map each lap sample to the nearest track-outline index and record cumulative ms from lap-start. Force the per-index series monotonic. Bake into the **clip header** (`lapTrace: {driverNum: [ms_at_i ...]}`). Length = `len(Track)`; index `i` ↔ `Track[i]` ↔ fraction `i/N`; value at `i=0` (start/finish) = 0.
- Thread `LapTrace` header → snapshot on **both** lane paths (Go replay path in `internal/feed/replay/play.go` → `internal/app/writer.go`, beside `snap.Track`/`snap.Radio`; Python live path in `ingest/live.py` `build_snapshot`, mirroring `header.get("track")`). Mirrors exactly how `Radio` was threaded in Phase 3. (All clips get a trace; only `#ghost` consumes it — parity over special-casing.)
- Frontend `#ghost` route — new `web/src/components/Ghost.tsx`, dual-subscribes both compare lanes (reuses `connectRace`, like `Compare.tsx`) **only to receive each lane's snapshot** (`Track` + `LapTrace`); the live frame stream is **not** used for animation:
  - **Map** = the shared `Track` outline + exactly **two cars** for the selected driver — 2024 solid, 2023 translucent ghost. The field is not drawn (the other cars are not on reference laps).
  - **Animation** = a local looping clock `τ`. Each car sits at `Track[i]` where `i` is found by inverting that year's `LapTrace[d]` against `τ` (`LapTrace[d][i] ≈ τ`). Loop length = `max(lapTime_2024, lapTime_2023)` + a short gap; both restart together at the start/finish line.
  - **Delta bar** = a strip under the map, x = lap fraction `i/N`, y = signed Δ seconds, red/green fill, with a cursor at the current `τ`. `Δ_i = LapTrace_2024[d][i] − LapTrace_2023[d][i]`; `Δ_0 = 0`, `Δ_last` = lap-time difference.
  - **Selection** = a **driver picker** (simple list/dropdown) of drivers that have a trace in **both** years; default to the first such driver (no hardcoded code). Not the live timing tower — this route has no live order.
- Pure FE helper (e.g. `web/src/state/ghost.ts`) for the delta subtraction + trace-inversion (`τ → index`), with unit tests, mirroring the `comms.ts` pure-logic pattern.

**Terminology** (CONTEXT.md, finalised by grill-with-docs): **ghost** = the translucent last-year car marker; **overlay** = the whole one-map mode (this-year + ghost + delta); **delta bar** = the computed signed time difference round the lap; **lap trace** = the baked per-driver pace curve. All distinct from **compare** (side-by-side, no computation).

**Out of scope (explicitly deferred / not built — ponytail)**
- **3-sector delta from `S1/S2/S3`.** The cheaper FE-only path was offered and declined in favour of the continuous bar; not built.
- **Live-phased ghost / live race under the overlay.** The ghost is the *reference lap* replayed, not last year's live position at the same wall-clock — that decoupled the ghost from the bar. The route is a self-contained player, not the live race with a ghost on top.
- **Cross-clip delta baking.** Each recorder run is single-year; it bakes only its own per-driver traces. The cross-year subtraction happens FE-side. No new pipeline stage that reads both clips.
- **`Frame.LapTrace`.** A lap trace is a fixed per-driver dataset → snapshot-only, like `Track`/`Radio`. No per-frame plumbing.
- **Ghost on the main board or as a toggle on `#compare`.** A dedicated `#ghost` route was chosen; the main board and `#compare` are unchanged.
- **The live field on the ghost map.** Only the two reference cars are drawn; the other 18 cars are not (they are not on reference laps).
- **Lap number on the wire.** Not needed — the delta normalises each trace to lap-start = 0 and compares shape vs outline index.
- **Sector dividers on the bar.** The continuous red/green fill already shows where time is won/lost; explicit sector lines need boundary fractions not on the wire — deferred.
- **Multi-driver / all-driver ghosting at once.** One selected driver at a time.

## Design decisions (from brainstorming)

1. **Deliverable = ghost marker + continuous delta bar, both.** The translucent moving ghost (spatial, intuitive) plus the round-the-lap delta bar (analytical "where time is won/lost"). The user chose the fuller version at each fork (both deliverables, user-selected driver, continuous bar over 3-sector, dedicated route).

2. **Reference car = user-selected driver, like-for-like across years** (e.g. VER 2024 solid vs VER 2023 ghost). Cross-year "the leader" would compare different people; selecting a driver keeps it like-for-like. (Selection is a driver picker, not the live tower — see decision 6.)

3. **Delta = baked per-clip pace traces, subtracted FE-side.** Each clip bakes a per-driver lap trace (cumulative ms vs outline index, for the driver's fastest clean lap). The FE holds both lanes (dual-subscribe) and subtracts: `Δ(f) = (t_2024(f) − t_2024(0)) − (t_2023(f) − t_2023(0))`. This is the real F1 "cumulative time gained/lost round the lap."
   - **Why baked, not pure-FE:** the continuous bar must show the **whole lap** immediately and accurately, not just the portion watched so far. A baked full-lap curve gives that on connect; accumulating it live from positions would be partial and noisy.
   - **Why per-clip + FE subtraction, not a cross-clip baking step:** keeps the recorder single-year (no new stage that loads both clips), and the contract addition is a clean per-clip per-driver field — same shape as `Track`/`Radio`.
   - **Known ceiling (ponytail):** reference = *fastest accurate lap of the session* (`pick_accurate()` then fastest), best-effort, labelled approximate (consistent with gap/interval/radio). Each driver's real lap is mapped onto the shared outline by nearest point and forced monotonic. A driver with no accurate lap gets no trace. Recorded as **ADR-0004**.

4. **Self-contained reference-lap player, not a live overlay (grill decision).** The ghost and the delta bar are both the *reference lap*, so the route replays both years' reference laps in sync on a local looping clock — `2024-best` solid, `2023-best` ghost — and ignores the live frame stream for animation. This makes ghost position and bar always agree (same two laps), and removes all live-correlation complexity. The price: it shows a flying-lap comparison, not the live race with a ghost on top.

5. **Both cars animate along the shared `Track` outline (grill decision).** Each car sits at `Track[i]` where `i` is found by inverting that year's `LapTrace[d]` against the clock — so positions come from the shared outline and per-driver *timing* comes from the trace. The spatial separation between the two on the common racing line is the time delta made visible. No per-driver positions need baking — only the timing trace.

6. **Selection is a driver picker, not the live tower (grill decision).** The route has no live running order, so the selected driver comes from a simple picker listing drivers with a trace in both years; default = the first such driver.

7. **Trace resolution = track-outline index count.** `LapTrace[d]` has length `len(Track)`, so buckets map 1:1 to outline points and to the rendered map — no separate fraction grid to reconcile.

## Edge cases & approximations

- Driver missing a trace in either year → not offered in the picker; if somehow selected, show "No reference lap for X in 2023."
- No accurate lap for a driver → no trace baked for them (graceful; the picker omits them).
- Trace monotonicity: a real lap mapped onto the shared outline can briefly go backwards at the chicane/overtaking line; the recorder forces the per-index series monotonic non-decreasing so inversion (`τ → index`) is well-defined.
- The delta is a straight element-wise subtraction of two lap-start-normalised traces — no start/finish wrap math (normalisation removes it).
- Everything labelled **approximate**, consistent with the existing best-effort precedent (ADR-0002).

## Testing

- **Recorder helper** (`ingest/test_ghost.py`, stdlib-only, runs in CI like `test_radio.py`): trace starts at 0, is monotonic non-decreasing, length = N; fastest-accurate-lap selection; no-accurate-lap → no trace.
- **FE helper** (`web/src/state/ghost.test.ts`): delta subtraction + sign, `Δ_0 = 0`; trace inversion (`τ → index`) monotonic and clamped at lap ends; missing-trace handling.
- **Contract parity**: extend the existing Python↔Go self-check for the new `LapTrace` field, as was done for `Radio`.

## ADR

**ADR-0004** (`docs/adr/0004-ghost-overlay-baked-traces-frontend-delta.md`, accepted) — per-clip baked lap traces, cross-year delta subtracted FE-side; reference = fastest accurate lap; best-effort/approximate; `Frame` unchanged. Records why record-time cross-clip baking, gateway computation, pure-FE accumulation, and the 3-sector shortcut were each rejected.

## Architecture impact

No change to ADR-0001 (single gateway). ADR-0002 (timing fields every frame) and ADR-0003 (radio streamed) unaffected. The only structural change is the additive `LapTrace` snapshot field and one new FE route; the pipeline shape is untouched.
