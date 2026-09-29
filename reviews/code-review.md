# Code review — fix stage report

Branch `review/code-review-max-fixes` · PR https://github.com/natcat38/f1-race-tracker/pull/72
Commit `18adbca` · 16 files changed, 442 insertions, 133 deletions

**10 findings fixed · 3 deferred (comment only) · 0 rejected**

Every finding was re-verified against the code before being fixed. Every new test
was confirmed to fail against the pre-fix code (by temporarily reverting the fix
and re-running) before being kept.

---

## Fixed

### F1 — trailing radio frame skipped reconciliation *(bug)*

`ingest/live_signalr.py:298` `_publish_trailing_radio_frame` was the only publish
path that never called `reconcile_positions`. Reached from `_replay_capture`'s
end-of-capture flush and `_shutdown_flush_radio`, it could ship duplicate,
gapped, or `UNKNOWN_POS=99` positions when a stream ended before the rate limiter
ever let a regular frame out.

Fixed structurally, as recommended: `build_frame` (`ingest/live.py:60`) now calls
`reconcile_positions` itself. That is the single choke point every publish path in
the package goes through — `publish_clip`, `_publish_frame`, and the trailing
frame — so no caller can forget. It is idempotent, so an already-reconciled baked
clip passes through unchanged. The now-redundant call-site calls were removed.

Test: `ingest/test_live_publish.py::test_trailing_radio_frame_reconciles_positions`
drives the trailing frame with **four** cars carrying a duplicate pos, a gap, and
the 99 sentinel, and asserts unique contiguous `1..N` with no 99. (The existing
`test_replay_capture_flushes_trailing_radio_at_capture_end` uses one car, where
reconciliation is a no-op.)

### F2 — Standings computed the leader as `pos === 1` *(bug)*

`web/src/components/Standings.tsx:20` still used the literal-`pos:1` test that #66
removed from StatusRail and StintChart. On a frame with no exact `pos:1` (the
Monza-2024 shape: two cars tied at 19, no 20) nobody was labelled LEADER and the
actual front-runner showed a nonsense gap. `order = orderCars(state.cars)` was
already in scope, so the map now carries an index and tests `idx === 0`.

Test: new `web/src/components/Standings.render.test.tsx`, mirroring the StatusRail
one — asserts LEADER appears, and that it lands on the front-runner's row.

### F3 — falsy-zero hid the LAP badge and leader marker *(bug)*

`StatusRail.tsx:45` (`!!leaderLap`) and `StintChart.tsx:55` both treated lap `0`
as absent. Lap 0 is a real value on the wire (`internal/model/model.go:23`) — the
opening lap, before anyone has crossed the line — so the badge and the marker
disappeared for exactly the moment they are most interesting. Both now guard with
`!= null`.

One subtlety: `StatusRail`'s `state && leaderLapOf(...)` would have yielded
`false` for an absent `state`, which passes `!= null`. It is now a ternary
returning `undefined`.

Tests: lap-0 render tests added to both existing render-test files, plus an
"omits the badge when the leader has no lap at all" case so the guard isn't
loosened into always-on.

### F4 — StintChart memo left the row order stale, and did the sort it exists to avoid *(bug + perf)*

`StintChart.tsx:78`'s comparator checked `stints`, `totalLaps`, and the leader's
lap. `stints`/`totalLaps` are referentially stable across 10 Hz frames, so a
position swap that didn't change the leader's lap left the chart's row order stale
**indefinitely** — until the leader next completed a lap. Separately, `leaderLapOf`
called `orderCars` (a full sort) twice per tick inside the comparator, so the memo
was performing the very sort it exists to avoid.

Both fixed together with a new `sameRunningOrder(a, b)` in `timingHelpers.ts`: an
O(n) per-car `pos`/`lap` field walk with no sort on either side. It detects any
position change (fixing the staleness) and any lap change (still covering the
marker), and is cheaper than the two sorts it replaces. A one-line comment above
the memo records the choice.

Test: `sameRunningOrder` unit tests in `TimingTower.test.ts`, including explicitly
"a position swap that leaves the leader lap unchanged" — the exact stale case.

### F5 — record.py gap/interval pass cleanup

`ingest/record.py`:
- `by_pos = sorted(cars, key=pos)` re-sorted a list `reconcile_positions` had just
  left in exactly that order — deleted, `cars` used directly.
- The `lapn` dict duplicated `car['lap']` — deleted; `car['lap']` /
  `leader_car['lap']` read directly, and `leader_car`/`leader_dist`/`leader_lap`
  now derive from one `cars[0] if cars else None` guard instead of three.
- `frac` existed only to build `dist` — folded into a single dict comprehension.
- The separate `car['lap'] = _lap_number(...)` pass folded into the build loop,
  where the car dict is constructed.
- Stale comment fixed: "matches the FE pos===1 leader test" — the frontend no
  longer does that anywhere, since F2 removed the last one.

### F6 — reconciled ranks fed back in as raw data *(bug — verified, real)*

Confirmed. `reconcile_positions` mutates `'pos'` in place, and in
`live_signalr.py` the car dicts persist in `latest_cars` across publishes (a dict
is only rebuilt when a fresh `Position.z` entry arrives for that driver). A driver
with no fresh sample therefore entered the next cycle carrying its previous
*reconciled rank* where a raw feed position belongs, so its rank stuck or drifted
away from what the feed actually said.

Chose the re-stamp fix over publishing a copy: the "same dict references land in
both the frame and the snapshot" property is load-bearing here and a copy would
silently break it. `_publish_frame` now re-stamps every car from
`running_positions` (falling back to `UNKNOWN_POS`) immediately before
reconciling. `reconcile_positions`' docstring gained a "callers must pass RAW feed
positions" note so the contract is stated where the function lives.

Test: `test_quiet_car_does_not_inherit_its_own_rank_as_input` — two publishes with
a position swap reported between them and no fresh car dicts, asserting the swap
reaches the wire. Verified to fail without the re-stamp
(`{1:1, 44:2, 16:3, 63:4}` instead of `{1:1, 44:2, 63:3, 16:4}`).

### F7 — duplicated reconcile-then-publish sequence

Extracted into `_publish_frame(r, session, snapshot, rev, time_ms, latest_cars,
running_positions, radio)`, used by both `_replay_capture`'s loop and
`_run_live_signalr`'s `Position.z` handler. Net effect on those two call sites:
~18 lines each collapse to 3.

### F8 — record.py contract validation didn't assert the invariant

The sampled per-frame checks only asserted `isinstance(car['pos'], int)`, which a
duplicate/gapped/99 frame passes — exactly the bug that shipped. The existing
every-frame scan (weather/pit) now also checks
`sorted(positions) == list(range(1, len(cars) + 1))` per frame, reporting the
first offending line. `sorted(...)` rather than `sorted(set(...))` is used
deliberately: it catches duplicates as well as gaps.

### F9 — duplicated `car()` test fixture

The byte-identical factory in `TimingTower.test.ts`,
`StatusRail.render.test.tsx`, and `StintChart.render.test.tsx` now lives in
`web/src/state/testCar.ts`, next to the `Car` type it mirrors, so a new required
contract field breaks in one place.

### F10 — comments restating the docstring

`ingest/record.py` (~714) and `ingest/live_signalr.py` (~577) each restated
`reconcile_positions`' 17-line docstring. Both shrunk to a line or two pointing at
it, keeping only what is local to the call site.

---

## Deferred (comment only, as instructed — no speculative code)

All three are documented at the relevant site rather than fixed.

1. **Cold-start partial roster.** `reconcile_positions` renumbers over whoever is
   in `cars` right now, so a partial roster at session start gets a dense `1..N`
   over that subset — a plausible-looking but wrong running order until the whole
   field reports. Noted under `KNOWN LIMITATIONS` in the docstring
   (`ingest/resample.py`).
2. **Retired / `'Out'` cars aren't sunk to the tail** — a retirement holds its
   last position ahead of cars still racing. Same docstring block.
3. **Live `NumberOfLaps` unverified against a real feed.** No new comment added:
   `_parse_timing_line` (`ingest/live_signalr.py`) already carries a precise
   `UNVERIFIED` note explaining the possible off-by-one and pointing at
   `docs/runbooks/live-verification.md`'s NumberOfLaps checklist item. Adding a
   second one would have been noise.

---

## Verification

All run on the branch, after the final edit. Nothing was reverted.

| Check | Result |
| --- | --- |
| `go vet ./...` | clean |
| `go test ./...` | ok (all packages; no `-race`, no cgo locally) |
| `pytest ingest` (repo venv, from `ingest/`) | **48 passed** (was 45; +3 new) |
| `pytest bench` | 3 passed |
| `ruff check ingest bench` | All checks passed |
| `npm test` | **126 passed**, 13 files (was 121) |
| `npm run lint -- --max-warnings 0` | clean |
| `npx tsc --noEmit` | clean |
| `npm run build` | built; `web/dist/.gitkeep` restored by the existing `postbuild` script — `git status` clean |
| `python scripts/gen_file_map.py --check` | was stale after the 3 new files; regenerated and committed |

Note on invocation: `pytest ingest bench` from the repo root fails at collection
(`ingest/pytest.ini` sets `testpaths = .` and `check_live_contract.py` imports
`live` from the ingest directory). CI runs pytest per directory with
`working-directory:` set; this report followed CI.

### Negative verification of the new tests

Each fix was temporarily reverted and the suite re-run, to confirm the tests
actually catch the bug rather than merely passing alongside it:

- F6 re-stamp removed → `test_quiet_car_does_not_inherit_its_own_rank_as_input` fails.
- `idx === 0` → `c.pos === 1` → Standings' `#66` test fails.
- `!= null` → `!!` in both components → both lap-0 render tests fail.
- `sameRunningOrder` → `leaderLapOf` comparator → not caught by a render test
  (`renderToStaticMarkup` doesn't exercise `React.memo`, and there is no jsdom
  renderer in this project). Covered instead by the direct `sameRunningOrder` unit
  test, which pins the position-swap case explicitly.
