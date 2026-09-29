# Exec: item 2 — Pit-stop duration (duration-only slice)

Implemented the duration-only slice per `reviews/plans/verify/02-pit-stops.md`,
extending ADR-0005's existing pattern (like `Stints`) rather than adding a new
message type. Out of scope, marked with `# ponytail:` comments: positions
gained/lost (needs a running-order-at-time derivation) and stationary time
(needs sub-lap car telemetry).

## What changed

- `ingest/record.py`: alongside the existing `pit_windows` computation, now
  also builds `pit_stops[driver_num] -> [{"lap", "durationS"}]` from the same
  loop (tracks the lap number at pit-in), emits it as `header["pitStops"]`,
  and extends the header self-check assertions + docstring contract comment.
- `internal/model/model.go`: new `PitStop{Lap, DurationS}` struct and
  `Snapshot.PitStops map[int][]PitStop` field (`omitempty`, session-constant
  like `Stints`).
- Wired `PitStops` through the whole existing `Stints` plumbing so it's
  actually populated, not just declared: `internal/feed/replay/play.go`
  (`clipHeader`/`Source` + `PitStops()` accessor), `internal/app/writer.go`
  (`Source` interface + `Writer.Run`), `cmd/bake-static/main.go` (`bake`), and
  the `fakeSource`/`closingSource` test doubles in
  `internal/app/writer_test.go`.
- `internal/model/contract_test.go` + `testdata/contract/golden_snapshot.json`
  + `web/src/state/contract.test.ts`: added a `pitStops` fixture entry and
  assertions on both the Go and TS sides of the golden-snapshot contract.
- `web/src/state/race.ts`: `PitStop` interface, `RaceState.pitStops`,
  `SnapshotData.pitStops`, `parseMsg` shape validation, `emptyState`, and
  `applyMessage`'s snapshot branch.
- `web/src/components/StintChart.tsx`: renders a short amber tick per pit
  stop at its lap position, with `title`/`aria-label` carrying the duration
  (e.g. "Pit stop: 23.4s (lap 14)").

## Checks run

- `go test ./internal/... ./cmd/...` — all pass.
- `python -m pytest` (ingest, from `ingest/`) — 83 passed.
- `npx tsc --noEmit` (web) — clean.
- `npx vitest run src/state/contract.test.ts src/components/StintChart.render.test.tsx` — 4 passed.

No `-race` run (CI-only, no cgo locally, per `memory/f1-build-gotchas.md`).
