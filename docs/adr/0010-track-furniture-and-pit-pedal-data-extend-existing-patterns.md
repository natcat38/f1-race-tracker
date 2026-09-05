<!-- ADR-0010: corners, pit stops, pedal traces, and sector dominance extend the existing contract patterns rather than introducing new ones. -->

# 0010 — PR #94's baked fields extend existing contract patterns, not new ones

**Status:** Proposed

## Context

PR #94 (`d39a9a1`) added four fields to the event model
(`internal/model/model.go`) — `Corners`, `PitStops`, `PedalTraces`, and
`SectorDominance` — but shipped with no ADR of its own, the same gap
ADR-0005 was written to close for Phase 5's `stints`/`weather`: "so a future
reader doesn't wonder whether a new data-placement pattern was introduced"
(`docs/adr/0005-phase5-stints-and-weather-extend-existing-patterns.md:1-14`).
The only record of *why* each field stops short of its natural full scope is
prose comments in `internal/model/model.go:70-104,136-140` that cite
`reviews/plans/verify/0X-*.md` — a planning doc, not a decision record, and
one `reviews/2026-09-06/ponytail-audit.md` already flags as residue that
should eventually be deleted.

## Decision

All four fields are instances of the pattern ADR-0004/0005 already
established — no new data-placement decision:

- **`Corners []Corner`**, **`PitStops map[int][]PitStop`**,
  **`PedalTraces map[int]PedalTrace`**, and **`SectorDominance []int`** all
  ride the **snapshot** only, `omitempty`, session-constant — baked once by
  the recorder (`ingest/record.py`), never windowed to the replay clip, and
  carried forward for free because `Apply`'s snapshot branch is a wholesale
  replace (`internal/model/apply.go` untouched by PR #94). This is exactly
  `LapTrace`/`Stints`' shape (ADR-0004/0005).
- **A clip without these fields degrades by omission, not by error.** Every
  field is `omitempty` and every consumer treats an empty/missing value as
  "nothing baked" rather than a malformed clip: `web/src/components/Map.tsx`
  renders no corner labels, no start/finish tick's sibling furniture, and no
  minisector strokes when `corners`/`sectorDominance` are absent;
  `StintChart.tsx` renders no pit-stop tick marks when `pitStops` is absent;
  the telemetry compare shows no pedal trace when `pedalTraces` is absent.
  Older baked clips (recorded before PR #94) simply lack the keys and play
  back exactly as they did before — no migration, no version field, no
  fallback computation.
- **Three scope cuts are folded in from the planning docs**, so they have a
  citable home once the docs above are deleted:
  - DRS zones and a safety-car marker are dropped from "track furniture" —
    DRS zones have no session-derived source, and a safety-car marker needs a
    track-status field the contract does not have.
  - RPM is dropped from `PedalTrace` — not sampled by `ingest` today.
  - Positions-gained/lost and stationary time (garage-box time, distinct from
    total pit-lane time) are dropped from `PitStop` — both need a
    running-order-at-time helper that does not exist yet. `PitStop.DurationS`
    is the full `PitInTime`→`PitOutTime` span (pit-lane time), not stationary
    time.

## Consequences

- No gateway change, no new message type, no new accumulation logic — all
  four fields fit the session-constant-on-snapshot pattern ADR-0004/0005
  already established.
- `internal/model/model.go`'s `ponytail:` comments and `ingest/pit.py`'s
  module docstring can point at this ADR instead of `reviews/plans/verify/*.md`,
  unblocking that directory's eventual deletion per the ponytail audit.
- A fast-follow adding RPM, positions-gained, DRS zones, an SC marker, or
  stationary time is additive under this same pattern — no new ADR needed for
  those additions themselves, only if one changes the data-placement shape
  (e.g. moving a field onto `Frame` instead of the snapshot).

## Considered and rejected

- **Windowing these fields to the replay clip instead of the full session.**
  Rejected for the same reason `LapTrace`/`Stints` reject it: the strategy
  timeline and telemetry compare are more useful showing the whole session's
  plan even when the clip only plays part of the race.
- **A new message type for one or more of these fields.** Rejected — each
  field is session-constant (baked once, never changes mid-clip), so there is
  no cadence problem a dedicated message type would solve; the existing
  snapshot-replace path already delivers it for free.
