# Verify: features-to-add items 4 & 5 (track furniture, sector-dominance heatmap)

Checked against: `FILE-MAP.md`, ADR-0004, `web/src/components/Map.tsx`,
`web/src/components/TrackPath.tsx`, `ingest/record.py`, `internal/model/model.go`.

## Baseline facts established

- `ingest/record.py` bakes the track outline once, from one clean mid-race lap of
  the session leader, downsampled to `TRACK_POINTS = 150` points (line 72, 233-272).
  Coordinates are raw FastF1 pos-data metres (`X`/`Y`), normalised into a `[0,1]`
  unit box via `normalise(x, y)` (line 227), which centres/scales using the
  leader's `OnTrack` bounding box (`x_min/x_max/y_min/y_max`, `max_range`,
  `x_offset/y_offset`). This bakes into `hdr["track"]` → `Snapshot.Track
  []Point` (`internal/model/model.go` line 90) → `TrackPath.tsx` draws it as one
  `<path d>` on the frontend (`geometry.ts` builds the `d` string; `Map.tsx`
  renders `<TrackPath d={trackPath} />`).
- ADR-0004's pattern (also used for `Stints` per ADR-0005): bake a new
  **session-constant, additive, `omitempty` snapshot field** at record time,
  keyed by driver number where per-driver, consumed read-only by the frontend.
  No new gateway logic, no `Frame` changes. This is the template item 4/5 should
  follow — confirmed still the live pattern (`Snapshot` struct has
  `Track`, `LapTrace`, `Stints`, all `omitempty`, all baked once).
- `ghost.py` already solves "map an arbitrary XY stream onto the baked outline
  index" (nearest-point projection, used for `LapTrace`) — this is the exact
  primitive item 5 needs for minisector binning, and item 4 needs for corner
  placement if corners are given in the same X/Y space as the outline (they
  are — FastF1 `session.get_circuit_info()` returns `.corners` as a DataFrame
  with `X`, `Y`, `Number`, `Angle` in the **same pos-data coordinate frame** as
  `session.pos_data`, so `normalise(x, y)` applies unchanged; no reprojection
  needed).
- FastF1 circuit info does **not** include DRS zones or a safety-car flag —
  only corners, marshal lights, marshal sectors, and rotation. DRS zones would
  need a hand-maintained static per-circuit dataset (not derivable from
  session data), which is the expensive, low-confidence part of item 4.
- No safety-car/track-status field currently rides the contract at all
  (checked `internal/model/model.go`'s `Snapshot`/`CarState`; race-control
  messages exist as a log via `race_control.py`/`RaceControl.tsx`, not as a
  structured flag state) — a live SC marker on the map is a separate, unbuilt
  feature, not a baking exercise.

## Item 4 — track furniture (DRS zones, corner numbers, start/finish line, SC marker)

**Verdict: BUILD (cheapest slice only) — corner numbers + start/finish line.
DROP DRS zones and the SC marker from this PR.**

Reasons:
- Corner numbers and start/finish are both one-shot, session-constant bakes
  using data FastF1 already exposes (`get_circuit_info().corners`, and the
  outline's own index-0 point as start/finish since the outline is built from
  one full lap starting at `lap_start_t`). This is a direct application of the
  existing bake-once/additive-field/nearest-point-projection pattern — low
  risk, fits a single PR.
- DRS zones require a static dataset with no session-derived source of truth
  (one entry per circuit, hand-curated, needs upkeep as calendars/circuits
  change) — this is the part of item 4 that makes it "M–L" in the doc, and it's
  the wrong shape for this pattern (not bakeable from FastF1 data). Cut it.
- A safety-car marker needs a structured track-status/flag field that doesn't
  exist on the contract today (race control is currently a message log, not a
  state machine) — that's a contract change touching Go, Python and frontend,
  disproportionate to "track furniture" and better scoped as its own item if
  wanted later.

Minimal implementation sketch (corners + start/finish only):
1. `ingest/record.py`: after building `track_points`/`normalise` (around line
   272), call `session.get_circuit_info()` and build
   `corners = [{"number": int(row.Number), "x": normalise(row.X, row.Y)[0], "y": normalise(row.X, row.Y)[1]} for _, row in circuit_info.corners.iterrows()]`.
   Add `hdr["corners"] = corners`. Start/finish is just `track_points[0]` — no
   new bake needed, expose it as `hdr["startFinishIndex"] = 0` (or let the
   frontend assume index 0 by convention, documented in a comment) since the
   outline's first point is already the lap-start position.
2. `internal/model/model.go`: add `Corners []Corner \`json:"corners,omitempty"\``
   (new small `Corner{Number int; Point}` type or reuse `Point` plus a
   parallel number array) to `Snapshot`, following the `Track`/`Stints` field
   style exactly.
3. `web/src/components/TrackPath.tsx` or a new small sibling component: draw
   corner number labels at each baked corner point (small text, low-contrast,
   similar treatment to existing `map-label`), and mark the start/finish point
   distinctly (e.g. a short perpendicular tick or checkered dash) using
   `state.track[0]` — no new geometry math needed beyond what `fitViewBox`/
   `trackPathD` already provide.
4. Contract/golden fixture update (`testdata/contract`) plus a
   `record.py` self-check assertion for the new header keys, mirroring the
   existing `track`/`stints` assertions.

Effort: S–M (much cheaper than the doc's original M–L, because DRS/SC are cut).

## Item 5 — sector-dominance track map (minisector heatmap)

**Verdict: BUILD.**

Reasons:
- This is materially the same shape as `LapTrace`: bin the outline into N
  minisectors (e.g. reuse `TRACK_POINTS` resolution or a coarser fixed count),
  and for each bin compute, per driver, the time/speed through that bin over
  their fastest lap — then take the argmin (fastest) driver per bin. All of
  the hard geometry (projecting a driver's raw XY samples onto the shared
  baked outline) is already solved by `ghost.py`'s nearest-point machinery
  used for `LapTrace`; item 5 is "the same projection, aggregated across all
  drivers and reduced to a winner per bin" rather than per-driver curves.
- It's genuinely session-constant and bakeable once, matching ADR-0004/0005's
  extend-existing-patterns rule — no new live/gateway logic.

Minimal implementation sketch:
1. `ingest/record.py`: for each driver (not just the leader), reuse the
   existing per-driver sample loop that already builds `lap_traces` (around
   line 279-299) to also record cumulative distance-bin → time deltas; bin the
   150-point outline into fixed minisectors (e.g. every 10 outline points =
   15 minisectors, or FastF1's own marshal-sector boundaries via
   `circuit_info.marshal_sectors` if finer granularity isn't needed).
2. For each minisector, compare each driver's time-through-bin (derived from
   their projected `lap_trace`-style curve) and pick the fastest driver's
   number.
3. Bake `hdr["sectorDominance"] = [driverNum, ...]` (one entry per minisector,
   or per outline point if not bucketing) — additive, `omitempty`, snapshot-
   level, following `Stints`/`LapTrace` precedent.
4. `internal/model/model.go`: add `SectorDominance []int \`json:"sectorDominance,omitempty"\`` to `Snapshot`.
5. `web/src/components/TrackPath.tsx`: instead of one `<path d>`, split the
   outline into per-minisector `<path>` segments (small change to
   `geometry.ts`'s `trackPathD` to emit N sub-paths instead of one), each
   stroked with `teamColour[car for that dominant driver]`.

Effort: M (new bake-time aggregation + a `TrackPath`/`geometry.ts` change to
support segmented strokes instead of one path) — consistent with the doc's
original estimate.

## Bottom line

| Item | Verdict | Effort |
| --- | --- | --- |
| 4. Track furniture | BUILD (slice: corners + start/finish only; DROP DRS zones + SC marker) | S–M |
| 5. Sector-dominance heatmap | BUILD | M |

Neither is ALREADY-DONE or too big to DEFER once scoped to the slices above —
both fit the existing bake-additive-field pattern with no gateway/Frame
changes required.
