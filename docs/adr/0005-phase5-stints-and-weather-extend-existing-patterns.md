# 0005 — Phase 5's `stints` and `weather` extend existing contract patterns, not new ones

**Status:** accepted

## Context

Phase 5 (pit-wall completion, `32957a1` / PR #39) added `stints` and `weather` to
the event model (`internal/model/model.go`), but neither shipped with its own
ADR, unlike every prior contract change (ADR-0002 timing/telemetry, ADR-0003
team radio, ADR-0004 ghost-overlay lap traces). Recorded here for the same
reason those exist: so a future reader doesn't wonder whether a new
data-placement pattern was introduced.

## Decision

Neither field introduces anything new — each is a straightforward instance of
an already-decided pattern:

- **`Stints map[int][]Stint`** rides the **snapshot** only, `omitempty`,
  session-constant (baked once at record time, not windowed to the replay
  clip — a driver's full-race stint plan even though the clip only plays part
  of the race). This is the exact same shape as `LapTrace` (ADR-0004): an
  additive snapshot field, populated once by the recorder, carried forward
  automatically because `Apply`'s snapshot branch is a wholesale replace.
- **`Weather *Weather`** rides **both** the snapshot and `Frame`, following
  ADR-0002's flat-rebroadcast pattern: attached to a frame only when the
  sample changes from the last one emitted (rare — session weather is
  ~1-minute cadence at bake time), then folded into the snapshot by `Apply`
  (`internal/model/apply.go`) so a reconnecting client always has the current
  reading without waiting for the next change.

## Consequences

- No gateway change, no new message type, no new accumulation logic — both
  fields fit the two data-placement patterns the contract already had
  (session-constant-on-snapshot per ADR-0004; flat-field-on-frame-when-changed
  per ADR-0002's spirit, though weather only rebroadcasts on actual change
  rather than every tick).
- **ADR-0002's frame-size estimate is now mildly understated.** It cited
  "~2 KB → ~4 KB for 20 cars" for the Phase 2 fields. Measuring a real frame
  from the current default clip (`data/replays/monza-2024-race.jsonl`, ~20
  cars, Phase 5's `lap` and telemetry fields included) gives ~5.7 KB — larger
  again once Phase 5's fields are counted, though `weather` itself only adds
  ~60 bytes on the rare frame it rides. Still gated by the same load-test
  benchmark (`BENCHMARKS.md`); no regression has been observed, so the
  "Option B" split ADR-0002 describes remains unbuilt.

## Considered and rejected

- **A new lower-cadence message type for `weather`.** Rejected for the same
  reason ADR-0002 rejected it for timing fields: the benchmark hasn't shown a
  problem, and `weather` is far rarer than the timing fields already flowing
  on the flat contract — building a second message type for an even smaller
  cost than the one already accepted would be solving a problem that doesn't
  exist yet.
