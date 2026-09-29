# Verify: item 2 — Pit-stop analysis

Source: `reviews/plans/features-to-add.md` item 2. "Per-stop duration (pit-lane
time and stationary time where derivable), and net track positions gained/lost
across each stop; surface on or beside `web/src/components/StintChart.tsx`."

## What's actually there today

- `ingest/record.py` (~lines 415-466) already computes `pit_windows[driver_num]
  -> [(pit_in_s, pit_out_s), ...]` from FastF1's `PitInTime`/`PitOutTime`
  per-lap columns — exactly the field the feature needs. **But it's
  discarded**: it's used only to build `_in_pit(driver_num, t_s)` for two
  purposes — (1) freezing/suppressing a car's frame position while in the pit
  lane (~line 631-660), and (2) setting per-frame `status: "Pit"` (~line 715).
  The (pit_in, pit_out) tuples themselves never reach the JSONL header/frames.
  So **pit-lane duration is fully derivable already** (`pit_out_s - pit_in_s`
  per window) but isn't baked or emitted.
- `stints[driver_num]` (compound/startLap/endLap) IS emitted, in the header,
  matching `internal/model/model.go`'s `Stint` struct (`Compound`, `StartLap`,
  `EndLap` — no duration or pit-time field, confirmed by grep of model.go
  line 63-96 and ADR-0005's description of the shape).
- **Stationary time** (time stopped in the pit box, as opposed to pit-lane
  transit time) is not derivable from FastF1's lap-level `PitInTime`/
  `PitOutTime` at all — that needs sub-lap car telemetry (speed trace) to find
  the zero-speed window inside the pit lane. Not impossible (car_data has
  Speed at high frequency) but a materially bigger lift than the lap-level
  in/out timestamps, and record.py doesn't currently touch car_data per-driver
  at pit-lane resolution.
- **Positions gained/lost across a stop**: no existing aggregation. The
  building blocks exist — `lapnum_lookup[driver_num]` gives (time, lap
  number) pairs, and the frame stream has per-car track position each
  tick — but nothing today computes "running order at pit-in" vs "running
  order at pit-out" per driver. This would be new bake-time logic: for each
  pit window, find running order (by track position/lap progress, excluding
  cars currently in their own pit windows) just before pit_in and just after
  pit_out, diff the ranks.
- `StintChart.tsx` currently renders only compound-coloured segments + a
  leader-lap marker; it has no per-stop annotation of duration or position
  delta, and no title/aria-label slot wired for it beyond
  `${compound} · laps X-Y`.

## ADR-0005 fit

ADR-0005's rule (extend existing patterns, no new message type) applies
cleanly: pit-stop data is exactly session-constant like `Stint`/`LapTrace` —
baked once, rides the snapshot only, no new gateway/message-type work needed.
The natural shape is either (a) extra fields on the existing `Stint` struct
(e.g. `PitDurationS *float64` on the stint that follows the stop, since a
stint boundary already coincides with a pit stop) or (b) a parallel
`PitStops map[int][]PitStop{lap, durationS, positionsGained}` snapshot field,
mirroring `Stints`. (b) is cleaner since not every stint boundary is a pit
stop (red flag, start-from-pit) and a `PitStop` needs a lap number of its own.

## Verdict: BUILD (duration only) — position-delta is a DEFER-sized stretch within the same feature

**Reason:** the hard input (pit_in/pit_out per driver) is already computed and
sitting in a local variable in `record.py` — it's currently thrown away. Wiring
pit-lane duration through to the contract and rendering it is a small,
well-scoped, PR-sized change that follows an already-accepted ADR pattern
exactly. Positions gained/lost is real new aggregation logic (needs a
race-order derivation that doesn't exist yet) and stationary time needs
telemetry not currently loaded per-driver — both are legitimate scope but
roughly double the effort and introduce a new algorithm (running-order-at-time)
rather than just re-exporting an existing computation. Recommend shipping
duration-only first; position-delta can be a fast-follow PR using the same
`PitStop` struct (add a field once the running-order helper exists).

**Effort estimate:** S–M for pit-lane duration only (backend: emit
`pit_windows` as a new snapshot field + Stint/PitStop struct field, one Go
struct change, no gateway change; frontend: StintChart tooltip/marker for stop
duration). M–L additional if positions-gained/lost is included in the same PR
— matches the original "Effort: M" estimate for the full feature only if
duration-only; the full scope (as originally described) is more accurately M–L.

## Minimal implementation sketch (duration-only slice)

Backend (`ingest/record.py`):
1. After the existing `pit_windows` loop (~line 466), build
   `pit_stops[inum] = [{"lap": <lap number of the stop, from lapnum_lookup or
   the lap whose PitInTime matches>, "durationS": round(pit_out - pit_in, 1)}
   for pit_in, pit_out in windows]`.
2. Add `"pitStops": pit_stops` to the header dict alongside `"stints": stints`
   (~line 693).
3. Extend the header-shape assertions (~line 873-878) with a `pitStops`
   sanity check mirroring the existing `stints` one.

Backend (`internal/model/model.go`):
4. Add `type PitStop struct { Lap int; DurationS float64 }` next to `Stint`
   (~line 63), and `PitStops map[int][]PitStop \`json:"pitStops,omitempty"\`
   // session-constant, like Stints` next to the `Stints` field (~line 96).
   No changes to `apply.go` needed — same wholesale-replace-on-snapshot path
   `Stints` already uses (ADR-0005's existing pattern, not a new one).

Frontend:
5. `web/src/state/race.ts` (or wherever `RaceState.stints`/`totalLaps` are
   typed and parsed from the snapshot) — add `pitStops` alongside `stints`.
6. `web/src/components/StintChart.tsx` — render a small marker/tick at the
   boundary between two stints for a driver with a pit stop (e.g. a short
   vertical tick with `title="Pit stop: 23.4s"` and an aria-label), reusing
   the existing per-stint `<div>` loop (~lines 50-65). No new panel needed;
   this stays inside the existing chart per the feature brief ("surface on or
   beside StintChart").

Files touched: `ingest/record.py`, `internal/model/model.go`,
`web/src/state/race.ts` (state typing — verify exact path before starting),
`web/src/components/StintChart.tsx`, plus the corresponding CONTEXT.md
vocabulary entry (a "pit stop" term next to the existing "stint" entry at
CONTEXT.md line ~161) and a new ADR is *not* required (extends ADR-0005's
already-decided pattern, same as ADR-0005 itself argued for `weather`).

## Not verified / left for the implementing agent

- Exact path/name of the frontend state file that types `RaceState.stints`
  (not opened in this pass — `web/src/state/race.ts` is a guess based on the
  import in StintChart.tsx; confirm before editing).
- Whether `lap` number for a pit stop should come from `lapnum_lookup` nearest
  timestamp or directly from the lap row that set `PitInTime` (likely the
  latter, cheaper — the loop already iterates `drv.sort_values('LapNumber')`
  and has `lap['LapNumber']` in scope right where `pit_in` is set).
