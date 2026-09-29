# Code review — PR #94 (d39a9a1) — correctness pass

Scope: correctness only, for the logic the existing lanes did not cover —
`reviews/2026-09-06/architecture.md` (Source-interface duplication, the
`useSmoothedCars.ts` teleport-threshold bug), `reviews/2026-09-06/security.md`,
`reviews/2026-09-06/ui-guidelines.md`, `reviews/2026-09-06/accessibility.md`.
Not repeated here. Method: read every file in the diff directly
(`git show d39a9a1`), traced each function against a concrete failing input,
and where a suspicious result showed up, reproduced it against the real FastF1
cache and the actual committed clip rather than guessing.

## Test / lint results

- `cd web && npx eslint src --max-warnings 0` — **clean, exit 0, no output.**
- `cd web && npx vitest run` — **269/269 passed, 23 files.** (Console noise:
  repeated `Error: Not implemented: HTMLMediaElement.prototype.pause` from
  jsdom during `useComms.ts` teardown — pre-existing test-environment
  limitation, not a failure.)
- `go test ./...` (repo root, no `-race`) — **all packages pass**
  (`cmd/bake-static`, `cmd/loadtest`, `internal/app`, `internal/bus`,
  `internal/config`, `internal/feed/replay`, `internal/model`, `internal/ws`).
- `cd ingest && python -m pytest -q` — **1 failed, 93 passed.**
  ```
  FAILED check_gap_estimator.py::test_baked_gaps_match_official_line_crossings
  AssertionError: monza-2024-race.jsonl intMs p95|err| 87450 ms > 600 ms
  assert not ['monza-2024-race.jsonl intMs p95|err| 87450 ms > 600 ms']
    gapMs: n=40  bias=-39 ms  median|err|=46 ms  p95|err|=129 ms  max|err|=170 ms
    intMs: n=29  bias=+7520 ms  median|err|=35 ms  p95|err|=87450 ms  max|err|=130522 ms
  ```
  See **Finding 5** below — this is real and reproducible, but I traced it to
  a lap-window choice in a post-merge data commit, not to code in this diff.

---

## Findings

### 1. [High] `ingest/pit.py:32-48` — back-to-back stops corrupt each other because `PitInTime` is checked before `PitOutTime` in the same row

**Failing input:** a driver whose out-lap from stop 1 is the *same lap row* as
the in-lap for stop 2 (double-stack, a stop-go penalty taken right after
leaving the pits, or any case where FastF1 attributes both events to one
`LapNumber`) — lap N: `PitOutTime=Y1` (closes stop 1) **and** `PitInTime=X2`
(opens stop 2) on the same row; lap N+1: `PitOutTime=Y2` (closes stop 2).

Tracing `build_pit_data`: on lap N's row, the `PitInTime` branch (line 32-35)
runs *first* and unconditionally overwrites `pit_in`/`pit_in_lap` with stop
2's values — destroying stop 1's `pit_in` before the `PitOutTime` branch
(line 36-48) ever reads it. The `PitOutTime` branch then closes what it thinks
is a window using `pit_in = X2` (stop 2's start) and `pit_out = Y1` (stop 1's
end): if `Y1 < X2` (very plausible — the car exited, then re-entered) this
appends a **negative-duration** window/stop, mis-attributed to lap N+1 (wrong
lap) instead of lap N. Worse, `pit_in` is reset to `None` after that, so when
lap N+1's real `PitOutTime=Y2` arrives, `pit_in` is `None` and the
`if pit_in is not None:` guard at line 41 is false — **stop 2's real window is
silently dropped entirely**, along with its pit-lane flagging.

I confirmed no driver in the actual Monza 2024 / 2023 / Silverstone 2024
sessions currently hits this shape (checked via a script that runs
`build_pit_data` against every driver's real laps and flags any negative-
duration window or suspect stop — none found), so this hasn't shipped bad
data yet. But it is a real ordering bug the existing tests
(`ingest/test_pit.py`) never exercise — none of the five tests puts a
`PitInTime` and `PitOutTime` on the same row, or two stops on consecutive
laps.

**Fix:** process `PitOutTime` (closing the pending window) before
`PitInTime` (opening a new one) within each row, or explicitly detect the
same-row-both-set case and close the pending window with the row's
`PitOutTime` before opening the new one from `PitInTime`. Add a test with a
same-row `PitOutTime`+`PitInTime` pair to lock in the fix.

### 2. [Medium] `ingest/pit.py:49-53` and `ingest/test_pit.py:73-82` — a car that retires mid-stop gets a fabricated 30 s pit-stop entry

**Failing input:** a driver retires (crash, mechanical failure) while in the
pits — `PitInTime` is set on their last lap, `PitOutTime` never arrives
because the car never leaves. This hits the tail fallback (line 49-53):
`pit_out = pit_in + 30`, and because `pit_in_lap` is set and not synthetic, a
`{"lap": N, "durationS": 30.0}` entry is appended to `pit_stops` — a real
stint-timeline entry claiming a normal ~30 s stop happened, when the driver
in fact never rejoined the race. `ingest/test_pit.py:73` documents this as
intentional ("assumes a typical stop") but the contract
(`internal/model/model.go:70-77`'s `PitStop`) carries no flag distinguishing
an estimated/incomplete stop from a real, completed one, and nothing
downstream (`web/src/components/StintChart.tsx`, which renders `pitStops`)
signals that this entry is fabricated.

**Fix:** either omit a `pit_stops` entry when no `PitOutTime` is ever seen
(a DNF has no meaningful "stop duration" to show), or carry a
`{"lap":N,"durationS":null}`/`"incomplete":true` shape through the contract so
the UI can render "retired in the pits" instead of a plausible-looking
30.0 s.

### 3. [Medium] `ingest/record.py:359-361` — missing telemetry samples produce garbage throttle/gear values, not NaN-safe

**Failing input:** a reference lap whose `car_data` (FastF1 telemetry) has a
gap — a dropped sensor sample within the lap window, which FastF1 does not
backfill. `cd_lap['Throttle']`/`cd_lap['nGear']` can contain `NaN` for that
row.

```python
throttle_vals = cd_lap['Throttle'].values[idx].astype(int)   # line 359
brake_vals = (cd_lap['Brake'].values[idx].astype(float) > 0).astype(int) * 100
gear_vals = cd_lap['nGear'].values[idx].astype(int)           # line 361
```

Unlike every other per-driver derivation in this file (e.g. line 510's
`.dropna()` on lap times), these three lines never drop or fill NaN before
`.astype(int)`. NumPy's `float→int` cast on `NaN` does not raise — it silently
produces an implementation-defined garbage integer (typically the platform's
`INT_MIN`) with only a `RuntimeWarning`, which this script doesn't even
surface (no warnings filter is set here). That garbage int is baked verbatim
into `PedalTrace.Throttle`/`.Gear` on the contract. `Brake`'s
`> 0` comparison happens to fail safe (`NaN > 0` is `False` in NumPy, so a
NaN brake sample reads as "brake off" — silently wrong but not corrupted), and
the frontend's `toPolyline` (`web/src/components/TelemetryPanel.tsx:142`)
clamps values into `[0, max]` before plotting, so a garbage large-negative
value is visually clamped to 0 — but the value on the wire (and any other
consumer of the contract) is corrupted, not just "clamped for display."

**Fix:** before casting, drop or forward-fill NaN rows in `cd_lap` for
`Throttle`/`Brake`/`nGear` (mirroring the `.dropna()` convention used
elsewhere in this file), or `np.nan_to_num` after Copy before `.astype(int)`.

### 4. [Medium] `web/src/components/geometry.ts:28-40` / `TrackPath.tsx` — sector-dominance heatmap never draws the start/finish wraparound segment

**Concrete scenario:** any clip that carries `sectorDominance` (i.e. every
clip built by the updated `record.py`) renders the map via `TrackPath`'s
`segments` branch (`Map.tsx:44` passes `segments` whenever
`state.sectorDominance.length` is truthy). `trackPathD` (the *plain*-path
renderer, used when there is no heatmap) explicitly closes the loop with
`' Z'` (`geometry.ts:16`) — the outline path goes from `track[n-1]` back to
`track[0]`. `trackSegmentPaths` (the *heatmap* renderer) only emits bins over
`[0, n-1]` (`geometry.ts:32-38`) and has no equivalent closing bin from
`track[n-1]` back to `track[0]`. The backend's `compute_sector_dominance`
(`ingest/ghost.py:96-111`) has the exact same shape — bins only cover
`range(0, n_points, bin_size)`, no wraparound bin.

Net effect: whenever the heatmap is showing (which is "always" per the code
comment at `Map.tsx:37`, "Always on rather than a toggle"), the short stretch
of track between the last outline point and the start/finish line
(`track[0]`) is **never drawn by any stroke** — a visible gap in the track
casing exactly at the start/finish line, right where this same PR just added
the start/finish tick mark (`Map.tsx:58-68`). This is a real rendering defect,
not a data-shape mismatch (`sectorDominance.length` and
`trackSegmentPaths(...).length` do agree, so nothing crashes or misaligns —
the two arrays are just both missing the wraparound entry).

**Fix:** add one more segment/bin representing `[n-1, 0]` (closing the loop)
on both sides — `trackSegmentPaths` appending a final `'M ... L ...'` from
`track[n-1]` to `track[0]`, and `compute_sector_dominance` computing one more
bin the same way (`trace[0] - trace[n-1]`, handling the wrap in cumulative
time), or simplest: keep drawing the closed plain-path stroke underneath the
segments as a permanently-visible casing so a missing segment never shows
bare canvas.

### 5. [High, but not attributed to this diff] `check_gap_estimator.py::test_baked_gaps_match_official_line_crossings` fails against the current committed clip

Verbatim failure is in the Test results section above. I bisected this to
find out whether it was introduced by PR #94's code:

- `data/replays/monza-2024-race.jsonl` was rebaked in `6f892bd` ("re-bake the
  Monza 2024 clip with the new contract fields"), a commit **after** the PR
  #94 squash merge, specifically to backfill `corners`/`pitStops`/
  `pedalTraces`/`sectorDominance` into the already-shipped clip.
- Running the same test against the **pre-rebake** blob
  (`git show 6f892bd~1:data/replays/monza-2024-race.jsonl`) passes cleanly:
  `intMs p95|err|=98 ms` (well under the 600 ms gate).
- The rebake changed the recording window: old clip `t_first=4,369,000 ms`
  (~72.8 min into the session), new clip `t_first=3,300,000 ms` (~55 min) —
  the new window starts much earlier in the race, capturing laps 2-3 right
  after the standing start, which the old window never included.
- The 87,450 ms / 130,522 ms outliers are both driver 27 vs. the car ahead of
  it (driver 22) on laps 2 and 3 — i.e. exactly the newly-included
  opening-lap frames, not anywhere near a pit stop.
- I independently re-ran `ingest/pit.py`'s `build_pit_data` against every
  driver in the real 2024 session laps and found **no anomalous window** for
  either driver 27 or 22 (driver 22's only pit event is a `PitInTime` on lap 7
  with no matching `PitOutTime` — i.e. a pit retirement, see Finding 2 — but
  that's laps away from the lap-2/3 frames that actually fail).

So this is a real, currently-failing correctness gate on the clip that ships
today, but the root cause looks like a pre-existing instability in the
arc-length gap/interval estimator (`ingest/geometry.py`, from PR #81, not
touched by #94) specifically for the opening laps right after a standing
start — laps where the field is bunched and `LapNumber`/position data may not
yet be well-separated — exposed only because the post-merge rebake happened
to choose an earlier lap window than any previously-committed clip did. It
is **not** attributable to the `pit.py`/`record.py` changes reviewed above.

**Recommendation:** before shipping this clip, either pick a lap window that
avoids the opening laps (as every previously-committed clip did — see
`ingest/README.md`'s "content-chosen lap windows"), or investigate
`geometry.py`'s projection/`wrap_counts` stability during laps 1-3 and gate
the rebake on this test passing.

---

## Checked and clean

- **Zero pit stops / no pit activity** (`ingest/pit.py`): `record.py:531-532`
  only sets `pit_stops[inum]` when `stops` is non-empty, so a driver with no
  stops correctly has no map entry — matches `PitStops map[int][]PitStop`'s
  `omitempty` on the Go side; no phantom empty-array entries.
- **Pit stops/windows keyed consistently**: `pit_stops`/`pit_windows` are
  keyed by `inum` (int driver number) throughout `record.py`, matching
  `internal/model/model.go:134`'s `map[int][]PitStop` — no
  abbreviation/number mismatch.
- **`durationS` unit**: seconds, rounded to 1 decimal
  (`pit.py:45,53` `round(pit_out - pit_in, 1)`), consistent with the
  `DurationS float64 "json:\"durationS\""` field name and comment.
- **Out-of-bounds corners**: `record.py:299-309` explicitly skips (does not
  clamp or abort) a corner whose normalised coordinate falls outside
  `[0,1]±1e-6`, with a warning count printed — verified this doesn't abort
  the bake and doesn't silently mis-place a corner.
- **Sector-dominance tie-break determinism**: `compute_sector_dominance`
  (`ingest/ghost.py:96-111`) iterates `lap_traces.items()` and only replaces
  `best_driver` on a *strict* `<` (line 108), so ties keep the
  first-encountered driver; `lap_traces`' insertion order comes from a
  deterministic `for num in session.drivers` loop
  (`record.py:333`), so results are reproducible across bakes of the same
  session.
- **Minisector bin count / off-by-one**: both
  `ingest/ghost.py:96-111` and `web/src/components/geometry.ts:28-40` use the
  identical `[start, min(start+bin, n-1)]` windowing and both produce
  `ceil(n/bin)` bins — verified against the real Monza clip
  (`track.length=150`, `sectorDominance.length=15`, matches
  `ceil(150/10)`); the two sides' array lengths always agree, so no
  index-misalignment. (A degenerate zero-width final bin is theoretically
  possible when `(n_points-1) % bin_size == 0` — not triggered by the current
  150-point track — but since both backend and frontend handle it identically
  it's cosmetic at worst, not a crash or misalignment; not filed as a
  separate finding.)
- **Contract backward compatibility**: `internal/feed/replay/play.go`'s
  `clipHeader`/`Source` struct fields for `Corners`/`PitStops`/
  `PedalTraces`/`SectorDominance` are plain Go zero-valued fields with no
  `required`/custom unmarshaling — an old baked clip missing these JSON keys
  parses into nil slices/maps with no error, confirmed by reading `Load()`
  (`play.go:60-104`) and by `writer_test.go`'s `fakeSource`/`closingSource`
  both returning `nil` for all four new getters, exercised by
  `TestWriterRun`-style tests that still pass. `contract_test.go` only
  round-trips the golden fixture *with* the new fields present, though — it
  doesn't separately assert that an old fixture *lacking* them still decodes
  cleanly; given Go's zero-value semantics this isn't a bug, just an
  untested-but-safe path.
- **`internal/feed/replay/play.go` pacing**: `playFromStart`/`playWallclock`/
  `frameAtWallclock` are byte-for-byte unchanged by this diff (confirmed via
  `git show d39a9a1 -- internal/feed/replay/play.go`, which only touches the
  `clipHeader`/`Source` struct and getters) — no live-lane behavior change,
  no new goroutine/timer, nothing to leak.
- **`staticReplay.ts` scrub while paused, then resume**: traced the state —
  `scrub()` sets `state`, `lastOffset`, `nextIndex`, and re-anchors
  `loopStart = Date.now() - lastOffset` even while paused (it just skips
  calling `playFrom` if still paused); `resume()` re-anchors the same way and
  calls `playFrom(nextIndex)` — the pacer correctly resumes from the
  scrubbed-to position, it does not jump back to wherever it was paused.
- **`staticReplay.ts` seek before first / after last frame**: seeking to
  `ms <= 0` resolves to `loopRestartIndex` (the first frame); seeking past
  the last frame's offset falls back to `messages.length - 1` (clamped, not a
  crash or an out-of-bounds index).
- **`staticReplay.ts` timer cleanup**: `close()` sets `closed = true` and
  clears the pending `timer`; the in-flight `fetch(...).then(...)`/`.catch(...)`
  callbacks both guard on `closed` before touching state, so an unmount mid-load
  cannot resurrect a superseded connection.
- **`race.ts` missing-field defaults**: `applyMessage`'s snapshot branch uses
  `d.stints ?? {}`, `d.pitStops ?? {}`, `d.pedalTraces ?? {}`,
  `d.sectorDominance ?? []`, `d.corners ?? []` — a snapshot from an old clip
  lacking these keys resolves to the same empty defaults `emptyState()` uses,
  and `parseMsg` validates each field's *type* before trusting it (rejecting
  an array where an object is expected and vice versa) rather than crashing
  downstream.
- **`TelemetryPanel.tsx` divide-by-zero / single-sample traces**:
  `toPolyline` (`TelemetryPanel.tsx:133-146`) explicitly bails to `''` for
  `n < 2`, avoiding the `x = i/(n-1)` division by zero a single-point trace
  would otherwise hit.
- **`Map.tsx` start/finish tick, zero-length segment**: `startFinishTick`
  (`Map.tsx:58-68`) guards `len = Math.hypot(dx,dy) || 1`, so two identical
  adjacent track points can't produce a NaN direction vector; a track with
  `length <= 1` is skipped entirely before this runs.
- **`App.tsx` hook ordering / lint**: `npx eslint src --max-warnings 0`
  (which includes `eslint-plugin-react-hooks`) is clean; all hooks in `App`
  are called unconditionally before the `route === 'ghost'`/`'settings'`
  early returns, so hook order never varies by route.
