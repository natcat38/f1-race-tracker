# Ghost overlay: per-clip baked lap traces, delta subtracted in the frontend

**Status:** accepted

## Context

Phase 4 (the cross-year ghost overlay) shows a driver's **reference lap** from two
seasons replayed in sync, with a continuous **delta bar** of time gained/lost round the
lap. The delta is a function of two aligned position-vs-time streams. Three places could
compute it: record time (bake a precomputed delta), the gateway (compute as frames flow),
or the frontend (compute from what it already receives).

A wrinkle: each recorder run records exactly **one** season. No single clip has both
years' data, so a cross-year delta cannot be baked by the per-clip recorder without adding
a new pipeline stage that loads both clips.

## Decision

The recorder bakes, **per clip, per driver**, a **lap trace** — cumulative lap time at
each track-outline index for that driver's fastest accurate lap (`pick_accurate`, then
fastest, over the whole session). It rides the **snapshot** as an additive
`LapTrace map[int][]int` field, exactly like `Track` and `Radio`. `Frame` is untouched.

The `#ghost` route dual-subscribes both compare lanes, reads each lane's snapshot
`LapTrace`, and **subtracts the two years on the frontend**:
`Δ(i) = LapTrace_thisYear[d][i] − LapTrace_lastYear[d][i]`, both normalised to
lap-start = 0. The ghost and the solid car animate along the **shared** track outline,
positioned by inverting each trace against a local looping clock; the delta bar plots
`Δ(i)` with a cursor following playback. No live frame stream is used for the animation.

## Consequences

- The recorder stays **single-year** — no stage that loads both clips. The cross-year
  step is a cheap frontend subtraction over data both lanes already deliver.
- The contract grows by one additive snapshot field, consistent with the `Track`/`Radio`
  precedent; the gateway and `Frame` are unchanged.
- The trace is **best-effort/approximate** (mirrors ADR-0002): the reference lap is the
  fastest accurate lap, each driver's real lap is mapped onto the shared outline by nearest
  point, and traces are forced monotonic. A driver with no accurate lap gets no trace and
  no ghost.

## Considered and rejected

- **Record-time baked delta** — impossible per-clip (one year per clip); would need a new
  both-clips stage for no gain over frontend subtraction.
- **Gateway-side delta** — the gateway is read-only by design (ADR-0001); it would have to
  correlate two lanes, which it never does.
- **Frontend-only with no baking** (accumulate the curve live from positions) — can only
  show the part of the lap already watched, and noisily; the bar must show the whole lap
  on connect.
- **3-sector delta from `S1/S2/S3`** (frontend-only, no baking) — cheaper, but coarser
  than the continuous bar that was wanted; declined during brainstorming.
