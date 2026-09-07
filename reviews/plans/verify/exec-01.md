# Exec: item 1 — Throttle/brake/gear telemetry overlay over lap distance

Implemented per `reviews/plans/verify/01-telemetry-overlay.md`'s sketch: a new
baked `PedalTrace` field, indexed by the same track-outline position `LapTrace`
already uses (no separate distance field needed), extended through the whole
`Stints`/`PitStops`-style plumbing, plus a new distance-axis chart in
`TelemetryPanel`. RPM skipped (`ponytail:` comment) — not sampled by ingest at
all today.

## What changed

- `ingest/ghost.py`: new pure `build_pedal_trace()` (mirrors `build_lap_trace`'s
  nearest-outline-index bucketing/carry-forward, but records throttle/brake/gear
  instead of elapsed time).
- `ingest/record.py`: inside the existing lap-trace bake loop, also pulls
  `session.car_data` for each driver's fastest-accurate reference lap, aligns it
  to the lap-trace's own sample timestamps, and calls `build_pedal_trace()`.
  Emits `header["pedalTraces"]`; extended the header docstring contract comment
  and the self-check assertions/log line.
- `internal/model/model.go`: new `PedalTrace{Throttle,Brake,Gear []int}` struct
  and `Snapshot.PedalTraces map[int]PedalTrace` (`omitempty`, session-constant
  like `LapTrace`).
- Wired through `internal/feed/replay/play.go` (`clipHeader`/`Source` +
  `PedalTraces()` accessor), `internal/app/writer.go` (`Source` interface +
  `Writer.Run`), `cmd/bake-static/main.go` (`bake`), and the
  `fakeSource`/`closingSource` test doubles in `internal/app/writer_test.go`.
- `internal/model/contract_test.go` + `testdata/contract/golden_snapshot.json`
  + `web/src/state/contract.test.ts`: added a `pedalTraces` fixture entry and
  assertions on both sides.
- `web/src/state/race.ts`: `PedalTrace` interface, `RaceState.pedalTraces`,
  `SnapshotData.pedalTraces`, `parseMsg` shape validation, `emptyState`, and
  `applyMessage`'s snapshot branch (frame branch needs no change — it spreads
  `...s`, so pedalTraces carries through untouched).
- `web/src/components/TelemetryPanel.tsx`: new `DistanceTrace`/
  `DistanceTraceRow` components — three stacked hand-rolled SVG polylines
  (throttle 0-100, brake 0-100, gear 0-8) over a 0-100% distance axis, solid for
  the reference car and dashed for the rival when one is selected. Rendered
  under each `CarTelemetry` card when `state.pedalTraces[car.driverNum]`
  exists. `// ponytail:` comments mark the fixed `MAX_GEAR = 8` ceiling and the
  `MAX_TRACE_POINTS` downsample cap.
- `ingest/test_ghost.py`: three new unit tests for `build_pedal_trace`.

## Checks run

- `go build ./...` and `go test ./internal/... ./cmd/...` — all pass.
- `python -m pytest` (ingest, from `ingest/`) — 86 passed (was 83; +3 new).
- `npx tsc --noEmit` (web) — clean.
- `npx vitest run src/state/contract.test.ts src/components/TelemetryPanel.interaction.test.tsx` — 3 passed.

No `-race` run (CI-only, no cgo locally, per `memory/f1-build-gotchas.md`). Did
not run a full `record.py` bake against live FastF1 data (network/slow) —
verified the baking logic by code review against the existing `lap_traces` loop
it extends and by the new `build_pedal_trace` unit tests.
