# Verify: item 1 — throttle/brake/gear telemetry overlay over lap distance

Source: `reviews/plans/features-to-add.md` item 1.

## What the feature doc claims

- FastF1 `car_data` already exposes Throttle/Brake/nGear/RPM per sample.
- "The contract already carries per-tick telemetry (ADR-0002 flat fields on
  CarState)."
- Frontend should extend `TelemetryPanel.tsx` "existing pedal bars +
  sparklines" into distance-axis traces for reference car + rival.
- Effort: M.

## What the code actually has

**`ingest/record.py` (lines ~557-574, 740-752):** per-tick telemetry is
sampled from FastF1 `car_data` and written onto each frame's `car` dict:
`speed`, `gear`, `throttle`, `brake`, `drs`. Brake is normalised from FastF1's
boolean to 0/100. **RPM is not extracted at all** — not sampled, not on the
dict. nGear is sampled as `gear` (single current value, not a trace).

**`internal/model/model.go` (CarState, lines ~42-46):** flat `omitempty`
fields — `Speed int`, `Gear int`, `Throttle int`, `Brake int`, `DRS bool`.
Matches ADR-0002 exactly: these are **per-frame current values**, rebroadcast
every frame, not a history/trace. No RPM field exists on the contract.

**LapTrace (model.go line 94):** `LapTrace map[int][]int` — cumulative lap
time per driver per point around the track outline, baked once per ADR-0004
for the ghost overlay's delta bar. This is the only "trace over distance"
concept anywhere in the contract, and it carries exactly one channel (time),
not throttle/brake/gear. Confirmed via `docs/adr/0004-ghost-overlay-baked-...md`
and `CONTEXT.md`'s "Lap trace" glossary entry — it's explicitly "the data" for
the ghost overlay, not telemetry.

**`web/src/components/TelemetryPanel.tsx`:** already renders, per selected
car, live throttle/brake meter bars (`<Bar>`, current % value) and per-lap
sparklines for lap-time and gap trend (`<Sparkline>`, one point per completed
*lap*, not per distance sample). There is no distance axis anywhere in this
file — the x-axis of every visual here is "lap number," not "metres around
the lap." Gear is shown as a single number (`G{car.gear}`) next to speed, not
plotted at all.

## Gap between what's asked for and what exists

The feature wants: for a chosen lap, plot throttle/brake/gear (optionally RPM)
as continuous traces along lap distance (0–100%) for two cars side by side —
the Pitwall/f1-dash-style corner-by-corner comparison view. What exists is:
current-instant pedal/gear readout (correct data, wrong shape) plus
per-lap-granularity sparklines (right shape — distance-like axis reused
per lap — but wrong content, only lap-time/gap, not car inputs).

To build the actual feature requires a **new baked-at-record-time data
channel**: per-driver, per-lap (or per-reference-lap), arrays of
{distance, throttle, brake, gear} samples resampled onto a common distance
grid — the same pattern as `LapTrace`/`Stints` (session-constant, baked once,
rides the snapshot, per ADR-0004/0005's "extend existing patterns" rule) but
carrying 3 channels instead of 1, and needing FastF1's `car_data` merged with
`pos_data`/distance interpolation (FastF1 has `add_distance()` on lap
telemetry — straightforward, but is new ingest logic, not existing).

RPM would need a new field entirely (not sampled today); can be dropped or
deferred without weakening the feature (throttle/brake/gear alone matches
Pitwall/f1-dash parity as stated in the "why").

## Verdict: BUILD (but scope corrected — effort is M, not "mostly frontend")

The feature is real, valuable, and matches the stated differentiation
rationale. But the feature doc's framing that "the contract already carries
per-tick telemetry" and that this is close to a frontend-only extension of
"existing pedal bars + sparklines" **undersells the ingest-side work** — the
existing per-frame Speed/Gear/Throttle/Brake fields are current-value only
and cannot be reshaped into a distance trace without new baking logic and a
new contract field. Treat this as a new lap-trace-shaped feature, not a
frontend polish pass on existing plumbing.

## Minimal implementation sketch

**Ingest (Python), new logic — not present today:**
- In `ingest/record.py` (near the existing telemetry sampling ~line 557 and
  wherever `LapTrace`/reference-lap baking happens for ADR-0004), for each
  driver's reference lap (reuse the same "fastest accurate lap" selection
  used for `LapTrace`), pull `car_data` with FastF1's `add_distance()`,
  resample Throttle/Brake/nGear onto a fixed distance grid (e.g. same
  resolution as the track outline / LapTrace points, for a shared x-axis),
  and emit a new baked field, e.g. `PedalTrace map[int][]PedalSample` where
  `PedalSample{Distance float64; Throttle, Brake, Gear int}` — or three
  parallel int arrays per driver if matching `LapTrace`'s flat-array shape is
  preferred for contract consistency.
- Skip RPM (not currently sampled; adds a new FastF1 column and a new
  contract field for a "nice to have" per the doc itself).

**Contract (Go), `internal/model/model.go`:**
- Add the new field alongside `LapTrace`/`Stints` (session-constant,
  `omitempty`, rides snapshot whole like those two — no new frame-cadence
  concerns per ADR-0002/0005).
- Extend `internal/model/contract_test.go` and `testdata/contract/golden_snapshot.json`.
- `cmd/bake-static/main.go` needs to carry the new field into the static-demo
  bake path too (it already threads LapTrace/Stints there).

**Frontend (`web/src/components/TelemetryPanel.tsx` + likely a new
component, not an in-place extension):**
- The existing `<Bar>`/`<Sparkline>` components are the wrong shape for a
  distance-axis line trace (SVG bar sparklines, per-lap granularity) — this
  needs a new line-chart-style component (still hand-rolled SVG, consistent
  with the rest of the file's no-charting-library approach) taking the new
  per-driver pedal-trace arrays for `car` and `rivalCar` and rendering
  throttle/brake/gear as three stacked traces over a shared 0–100% distance
  x-axis.
- Reuse the existing reference-car/rival selection plumbing already in
  `TelemetryPanel` (`car`, `rivalCar`, `role`) — that part of the doc's
  framing is accurate.
- `web/src/state/race.ts` needs the new field added to the `Car`/state types
  parsed from the snapshot.

**Also touch:** `ingest/README.md` (document the new baked channel, like
LapTrace/gap are documented), `docs/adr/0004-...md` or a new short ADR if
this is judged a distinct-enough contract addition (team's own pattern per
ADR-0005 is to extend existing ADRs' reasoning rather than always writing a
new one — judgment call for whoever picks this up).

## Effort estimate

**M, leaning toward the top of M** — not because any single piece is hard,
but because it spans all three layers (Python baking + Go contract/tests +
new frontend chart component), unlike a pure frontend change. Comparable in
shape to the Pit-stop analysis item (#2) in the same doc, which the doc
itself already estimates at M for one new ingest aggregation; this adds a
frontend charting component on top.
