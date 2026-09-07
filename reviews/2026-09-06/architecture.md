# Architecture review — PR #93 (2425b9d) + PR #94 (d39a9a1)

Scope: seam compliance of PR #94's additions (pit stops, pedal traces, corners,
sector dominance, static-replay playback controls), missing-ADR check,
deepening opportunities, and blockers for the next feature cycle (server-paced
live-lane scrub, WS2 remainder, WS4 analytics).

Method: read `CONTEXT.md`, ADR-0001/0002/0004/0005/0006/0009,
`docs/agents/domain.md`, `FILE-MAP.md`, then read PR #94's actual diff
(`git show d39a9a1`) file-by-file rather than trusting the commit messages, and
cross-checked against `reviews/tech-debt-scan.md`, `reviews/ponytail-audit.md`,
`reviews/backlog-still-open.md` so nothing already reported is repeated here.

Severity counts: **1 Bug**, **4 Strong** (deepening/consolidation), **1
Missing-ADR**, **2 Worth-exploring**, **2 Blockers-for-next-cycle** (one
overlaps a Strong finding).

---

## Answering the four questions

### 1. Does PR #94 respect the established seams?

Yes, cleanly, on the data-placement axis. `internal/model/model.go`'s four new
fields (`Corners`, `PitStops`, `PedalTraces`, `SectorDominance`) are exactly
ADR-0004/0005's pattern: `omitempty`, snapshot-only, `map[int][]T` or `[]T`,
populated once by the recorder, carried forward for free because
`model.Apply`'s snapshot branch is a wholesale replace (`internal/model/apply.go`
untouched by this PR — confirmed by `git show --stat`). No new message type, no
gateway logic, no `Frame` changes. The Redis seam is untouched (Python and Go
still only exchange JSON over Redis; `ingest/pit.py`/`ingest/ghost.py` build
plain dicts/lists that `record.py` writes into the same header JSON `internal/feed/replay/play.go`
already parses). ADR-0006 (static demo) is respected: `cmd/bake-static/main.go`
reads the new fields through the same `replay.Source` used by the writer and
re-encodes with the existing `ws.EncodeSnapshot`, no new bake path.

Where it does **not** cleanly repeat the pattern: `ingest/pit.py` breaks the
project's own "pure helper, no fastf1/numpy/pandas" convention that
`ingest/ghost.py`, `ingest/radio.py`, `ingest/race_control.py`, and
`ingest/resample.py` all follow specifically so they import in CI's
pandas-free contract job. `ingest/pit.py:8` does `import pandas as pd` and uses
`pd.isna`/`.total_seconds()` on `Timedelta` objects passed straight from the
FastF1 laps `DataFrame`. The PR's own fix commit ("skip test_pit.py in the
pandas-free contract job via importorskip", `ingest/test_pit.py:8`) is a
workaround for this, not a fix — it's the first helper in this family that
needed one. **Fix:** have `record.py` convert the FastF1 columns to plain
floats/None before calling `build_pit_data`, and rewrite `pit.py` to take
plain lists of `(lap_number, pit_in_s, pit_out_s, lap_start_s)` tuples, same
shape as `ghost.py`'s `sample_ts`/`sample_xy` inputs. Removes the
`importorskip` and the CI-job asymmetry. `ingest/pit.py:1-8`,
`ingest/test_pit.py:8`.

### 2. New decisions in #94 that deserve an ADR

**Missing-ADR.** PR #94 makes the same kind of contract-shape decision that
Phase 5 made (stints/weather) — and Phase 5 got a retroactive ADR-0005
specifically "so a future reader doesn't wonder whether a new data-placement
pattern was introduced" (`docs/adr/0005-phase5-stints-and-weather-extend-existing-patterns.md:1-14`).
PR #94 adds four more fields the same way and shipped with **no ADR at all** —
the only record of the decision is prose comments in
`internal/model/model.go:70-104` and `internal/model/model.go:136-140` that
cite `reviews/plans/verify/0X-*.md` (a planning doc, not a decision record) as
the source of the corner/pit-stop/RPM scope cuts. Those `reviews/plans/`
files are exactly the kind of "AI-agent planning residue" `ponytail-audit.md`
finding 1-2 already flagged for deletion — so the *only* citable source for
"why did we skip DRS zones / RPM / positions-gained" is a file this repo's own
audit says should not exist long-term.

**Fix:** write `docs/adr/0010-track-furniture-and-pit-pedal-data-extend-existing-patterns.md`,
mirroring ADR-0005's structure: record that `Corners`/`PitStops`/`PedalTraces`/
`SectorDominance` are all instances of the existing session-constant-snapshot
pattern (no new placement decision), and fold in the three scope cuts now
living only in `reviews/plans/verify/*.md` comments (DRS zones/SC marker
dropped — no data source / no track-status field; RPM dropped — not sampled
elsewhere; positions-gained/stationary-time dropped from `PitStop` — needs a
running-order-at-time helper that doesn't exist). Once written, the
`model.go`/`record.py` comments can point at the ADR instead of the planning
doc, unblocking that doc's eventual deletion per the ponytail audit.

### 3. Deepening / consolidation opportunities (ranked by value/effort)

**[Strong] Collapse the Source interface's session-constant getters into one call.**
Every session-constant field baked into a clip (`Track`, `Corners`, `Radio`,
`LapTrace`, `TotalLaps`, `Stints`, `PitStops`, `PedalTraces`,
`SectorDominance` — 9 fields as of this PR) requires, in lockstep: a
`clipHeader` field (`internal/feed/replay/play.go:19-30`), a `Source` struct
field + getter (`play.go:37-53`, `106-115`), an interface method
(`internal/app/writer.go:16-29`), and one `snap.X = wr.src.X()` line
duplicated **byte-for-byte** between `internal/app/writer.go:62-70` and
`cmd/bake-static/main.go:63-71`. PR #94 added 4 of the 9 fields and touched
all four of those files to do it. The `Source` interface is shallow relative
to its footprint: 11 methods, 9 of which are "give me back the thing you
already parsed from the header," and the two call sites that consume them are
identical lists that must be kept in sync by hand — a classic shotgun-surgery
smell, and exactly the kind of friction that will recur every time WS4 adds
another baked field (speed-trap widget, tyre-health chip, etc.).
**Solution:** replace the 9 getters with one `Baked() model.Snapshot` (or a
narrower `SessionConstant` struct) that `replay.Source` populates once at
`Load()` time; `writer.go:62-70` and `cmd/bake-static/main.go:63-71` each
collapse to a single `snap := src.Baked(session, src.Mode(), src.Label())`-style
call (session/mode/label still passed explicitly since they're per-invocation,
not per-clip). **Benefit (locality):** a new baked field becomes a one-file
change (`play.go`'s `clipHeader`/`Baked()`) instead of a four-file change;
**benefit (leverage):** `Writer.Run` and `bake`'s tests stop needing updates
for fields they don't otherwise touch. Files: `internal/feed/replay/play.go:18-115`,
`internal/app/writer.go:16-29,61-70`, `cmd/bake-static/main.go:62-71`.

**[Strong] The same shotgun-surgery shape exists on the frontend's snapshot parsing.**
`web/src/state/race.ts` requires a new field to touch: `RaceState` (`race.ts:37-42`),
`emptyState()` (`race.ts:50-53`), `SnapshotData` (`race.ts:61-70`), a
`parseMsg` validation branch (`race.ts:135-138` — repeats the identical
"is this a non-array object" check three times for `stints`/`pitStops`/
`pedalTraces`), and an `applyMessage` assignment line (`race.ts:492-496`).
This mirrors the Go-side interface problem above and will keep growing at the
same rate WS4 adds fields. **Solution:** factor the three
"`typeof x !== 'object' || x === null || Array.isArray(x)`" checks
(`race.ts:480-482`) into one `isRecord(v: unknown): v is Record<string, unknown>`
helper; lower-effort than the Go-side fix (it doesn't remove a field-per-file
requirement, just deduplicates the repeated validation predicate), so do it
opportunistically alongside the next field addition rather than as its own PR.
File: `web/src/state/race.ts:476-484`.

**[Speculative] `StaticReplayHandle`'s callable-object shape is a workaround, not a seam.**
`web/src/realtime/staticReplay.ts:270-275` defines `pause`/`resume`/`scrub` as
properties bolted onto a callable close function specifically so
`disconnectRef.current()` call sites don't need to change
(`staticReplay.ts:265-269`'s own comment). This is a reasonable short-term
call given ADR-0006 scopes playback controls to the static demo only, but it
means `connectRace` (`socket.ts`) and `connectStaticReplay` no longer share a
return-type interface even though `App.tsx:162-168` branches on `STATIC_DEMO`
to pick between them — the two data sources' contracts have quietly diverged.
Not worth fixing now (no second caller needs the symmetry), but the moment
live-lane pause/scrub (see Blocker below) is built, this is the seam to
revisit: give both sources a `{ close, transport? }` shape instead of
overloading the close function. File: `web/src/realtime/staticReplay.ts:270-298,396-408`.

**[Worth exploring] `ingest/pit.py` and `ingest/ghost.py`'s nearest-index search live in three flavors now.**
`ghost.py:32-37` (lap trace) and `ghost.py:79-83` (pedal trace) run the
identical O(track_points) brute-force nearest-point loop per sample — already
flagged as fine at current scale by the pre-existing ponytail comment
(`ghost.py:26-31`) — but `record.py:361` now also calls `resample.py`'s
`nearest_index` for the pedal-trace time alignment, a *third*, differently-shaped
nearest-neighbour helper in the same file family. Not urgent (different
inputs — spatial vs. temporal nearest), but if a fourth baked-trace type shows
up in WS4, worth consolidating "nearest index by scalar key" into one
`resample.py` helper (already exists) and having `ghost.py` reuse it for time
alignment too, rather than hand-rolling the spatial search separately.
Files: `ingest/ghost.py:32-37,79-83`, `ingest/record.py:355-365`.

### 4. What would block the next feature cycle

- **[Bug — blocks WS3/server-paced live-lane scrub credibility]**
  `web/src/hooks/useSmoothedCars.ts:36-44`'s "snap on teleport" fix (added in
  this PR specifically to stop scrubbing from gliding cars across the map,
  per the commit message) **cannot fire**. `TELEPORT_THRESHOLD = 50`
  (`useSmoothedCars.ts:39`) is compared against `Math.hypot(...)` of `c.p.x/y`
  (`useSmoothedCars.ts:35,43`), and `CarState.P` is documented as
  "track-space coordinate, scaled to `[0,1]`" (`internal/model/model.go:26`) —
  confirmed by `web/src/components/Map.tsx:105,116,126` and
  `geometry.ts:8,16` only multiplying by `SIZE` (600) at render time, never
  before. The maximum possible distance between two points in `[0,1]²` space
  is `√2 ≈ 1.41`, so `dist <= 50` is true for every jump, real or teleported —
  the `snapped[...] = p` branch (line 44) is dead code, and scrubbing the
  static-demo slider (the very feature this PR ships alongside the fix) still
  glides. **Fix:** lower `TELEPORT_THRESHOLD` to a value in `[0,1]`-space,
  e.g. `0.05`–`0.1` (5–10% of the track diagonal), or compare in `SIZE`-space
  consistently. This is worth fixing *before* WS3 (server-paced live-lane
  scrub) reuses this hook's glide logic for the live lane too — the same
  false assumption would ship twice. File: `web/src/hooks/useSmoothedCars.ts:39,43-44`.

- **[Blocker — WS3 server-paced live-lane scrub]** Confirmed still true after
  this PR: `App.tsx:74-78`'s own comment states pause/resume/scrub is
  "only meaningful on the static demo… the live/replay-lane WebSocket path…
  has no such control surface," and `internal/app/writer.go`'s `Writer.Run`
  (`writer.go:42-92`) has no pause/seek concept — it is a pure fold-and-publish
  loop with no way to receive a control message. Building WS3's server-paced
  live-lane scrub means either (a) adding a control channel to `Writer`
  (new Redis key or pub/sub topic the writer subscribes to alongside
  `Events()`) or (b) keeping scrub client-only and accepting it can never work
  on the live/replay lanes — that product decision should be made explicit
  (and ADR'd) before WS3 work starts, since the static-demo implementation
  chosen here (full O(n) client-side replay-to-offset,
  `staticReplay.ts:379-393`) is not a pattern that generalizes to a
  server-authoritative lane. Files: `internal/app/writer.go:42-92`,
  `web/src/App.tsx:74-78`.

- **[Note, not a blocker] WS4 analytics will hit the shotgun-surgery pattern
  immediately.** Any of WS4's remaining items (sector-delta chip,
  position-change chart, speed-trap widget, tyre-health chip) that bake a new
  session-constant field will need the same 4-file Go change and 4-spot
  TypeScript change documented in the Strong findings above. Doing the
  `Baked()` consolidation first would make WS4 measurably cheaper per item;
  doing it after WS4 ships 2-3 more fields makes the refactor larger but not
  harder. Recommend doing it now, before WS4 starts — see Top recommendation.

---

## Top recommendation

**Do the `Source.Baked()` consolidation (Strong finding #1) before starting
WS4.** It's the one finding that compounds: every WS4 analytics item is
"bake one more field," and today that costs four file edits with two
byte-identical duplicated lines; after the refactor it costs one. It's also
low-risk — `writer.go` and `cmd/bake-static/main.go`'s existing tests
(`writer_test.go`, `main_test.go`) already assert the resulting `Snapshot`
shape, not the intermediate getters, so the refactor is verifiable without
rewriting tests. Do the `useSmoothedCars` teleport-threshold bug fix
alongside it (five-minute fix, same file family, and it's an actual behavior
bug shipping today) before either WS3 or a demo recording surfaces the
gliding-scrub symptom publicly.

Second priority: write ADR-0010 (Missing-ADR finding) — cheap, and it's the
same debt-repayment pattern the project already did once for Phase 5; leaving
it for a second retroactive pass just means a longer diff to write later.
