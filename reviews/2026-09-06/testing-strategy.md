# Testing strategy review — 2026-09-06

Scope: coverage map, ranked gaps, jsdom decision, CI gaps. Grounded in
`CONTEXT.md`, `FILE-MAP.md`, `docs/F1_Race_Tracker_Tech_Scope.md`,
`.github/workflows/ci.yml`, `scripts/test.sh`, `memory/f1-build-gotchas.md`,
`reviews/backlog-still-open.md` (WS6), `reviews/code-review.md`, and PR #94
(`d39a9a1`). No files changed except this report.

## 1. Coverage map per layer

### Go (`go test ./... -cover`)

**Total: 51.9% of statements** (per-package, `go test ./... -cover`, no `-race` — this
box has no cgo, per `memory/f1-build-gotchas.md` gotcha 4; CI runs `-race` on
`ubuntu-latest`).

| Package | Coverage | Notes |
|---|---|---|
| `internal/config` | 95.2% | env loading, defaults, validation |
| `internal/model` | 94.4% | wire types, `Apply` fold, contract golden fixture |
| `internal/ws` | 83–86.4% | hub fan-out, envelope encoding, handler upgrade path |
| `internal/app` | 78.4% | gateway/writer roles, compare lanes, switch, integration |
| `internal/bus` | 76.7% | Redis seam against miniredis |
| `cmd/bake-static` | 67.4% | |
| `internal/feed/replay` | 62.2% | clip playback pacing/looping |
| `cmd/loadtest` | 57.1% | load-test harness itself (not app logic) |
| `cmd/genclip`, `cmd/server` | 0% | thin `main()` entry points — expected, not gaps |

Well-covered where it matters most: the seam contract (`internal/model`), the
hub/WS fan-out, and the gateway roles. Nothing alarming here — this is a
mature suite (`hub_test.go`, `integration_test.go`, `switch_test.go`,
`compare_test.go`, `writer_test.go` all present per `FILE-MAP.md`).

### Python ingest (`cd ingest; python -m pytest -q`)

**93 passed, 1 failed** (`check_gap_estimator.py::test_baked_gaps_match_official_line_crossings`
— a numeric self-check against baked clip data, not a unit test; likely drifted
against a re-baked clip, see gap list below). No coverage flag was requested by
the brief for ingest standalone, but CI's `contract` job runs
`pytest . --cov=. --cov-report=term-missing` from `ingest/` — see CI gaps below
for why that number isn't surfaced as a threshold.

Well covered: `geometry.py`, `resample.py`, `ghost.py` (including the new
`compute_sector_dominance`), `pit.py` (new in PR #94, has `test_pit.py`),
`race_control.py`, `radio.py`, `f1tv_auth.py`, `live_parsers.py`,
`live_publish.py`/`live.py`'s two publish paths, `capture_replay`/`dispatch`
self-checks.

**Not covered:** `record.py`'s orchestration itself (`ingest/test_record.py`
does not exist — confirmed via `ls`) — the pure helpers it calls (`pit.py`,
`ghost.py`, `resample.py`, `race_control.py`, `radio.py`) are all unit-tested
in isolation, but the recorder's own wiring (which helper gets called when,
how the per-frame contract-validation scan is assembled, corner/heatmap
integration) has no direct test. And ~190 lines of `live_signalr.py`'s field
parsers (`_parse_gap_str`, `_parse_laptime_str`, `_parse_timing_line`,
`_parse_tyre_line`, lines 917–1023 per the backlog citation, still marked
`UNVERIFIED` at lines 519/581/603/699/753/814/831) have no unit tests — they
were extracted in spirit to `live_parsers.py` (which *is* tested), but this
older code path in `live_signalr.py` itself was not migrated/covered.

### Web (`cd web; npx vitest run --coverage`)

**269 tests passed, 23 files.** Coverage-v8 report:

```
All files          |   71.23 |    66.69 (branch) |   65.82 (funcs) |   73.54 (lines)
```

Strong: `src/state` (92.9%), `src/realtime` (80.4% — `socket.ts` 92.75%,
`lanes.ts` 96.4%, `staticReplay.ts` 68.2%), `timingHelpers.ts` (98%),
`StatusRail.tsx`/`StintChart.tsx` (85–100%, render-tested per PR #72's
`renderToStaticMarkup` fixes).

Weak, by file: `Comms.tsx` 25%, `useComms.ts` 29.4%, `TelemetryPanel.tsx`
38%, `TimingTower.tsx` 60.2%, `App.tsx` 54.2%, `SourceToggle.tsx` 33%,
`Settings.tsx` 48.7%, `ErrorBoundary.tsx` 37.5%. These are exactly the
components the WS6 backlog item names (Map/Comms/Ghost/TelemetryPanel/
TimingTower) as lacking real render tests — `Map.tsx` is actually decent at
81% because `renderToStaticMarkup` exercises its static SVG path, but
interaction-driven code (hover, click-to-select, `React.memo` bail-outs,
effect cleanup) is exactly what's dark in `Comms`/`TelemetryPanel`/
`TimingTower`.

The vitest run itself also throws `HTMLMediaElement.prototype.pause` /
`Not implemented` jsdom errors from `useComms.ts:69` (audio playback) — tests
still pass (jsdom logs but doesn't fail), but it signals `useComms.ts`'s
audio branch runs unexercised in any assertion.

### PR #94 (`d39a9a1`) coverage check, item by item

| Feature | File | Test? |
|---|---|---|
| Pit-stop durations | `ingest/pit.py` | Yes — `ingest/test_pit.py` |
| Sector-dominance heatmap math | `ingest/ghost.py::compute_sector_dominance` | Yes — `ingest/test_ghost.py` (3 cases: fastest-per-bin, no-data, skips non-positive deltas) |
| Pedal/gear traces | `ingest/ghost.py::build_pedal_trace` | Yes — `ingest/test_ghost.py` |
| Pedal/gear traces (frontend) | `web/src/components/TelemetryPanel.tsx` (`DistanceTrace`, `pickThrottle/Brake/Gear`) | Partial — `TelemetryPanel.interaction.test.tsx` covers rival selection only; the distance-trace rendering/downsampling path is untested (consistent with the file's 38% line coverage) |
| Client-side scrub (`staticReplay.ts`) | `web/src/realtime/staticReplay.ts` (`pause`/`resume`/`scrub`) | **No** — `staticReplay.test.ts` has 7 tests, all about pacing/looping/stall-resync/status; none calls `.pause()`, `.resume()`, or `.scrub()` (grepped directly, zero hits) |
| Corner numbers / start-finish / map furniture | baked into clip header, rendered in `Map.tsx`/`TrackPath.tsx` | No dedicated test; `Map.tsx` 81%/`TrackPath.tsx` 42.9% suggests the furniture-rendering branches are thin |

## 2. Highest-value gaps, ranked by risk-per-effort

1. **`staticReplay.ts` scrub/pause/resume — untested control-plane for the
   public GH-Pages demo.** This is the *first thing a recruiter clicks* (per
   `CONTEXT.md`'s "static demo" being a front door) and it currently has zero
   assertions on the exact code PR #94 added. A scrub-across-loop-boundary or
   pause/resume-then-scrub bug would ship silently.
   - **Test:** `web/src/realtime/staticReplay.test.ts` — add: (a)
     `pause()` then advancing fake timers produces no further `onFrame`
     calls; (b) `resume()` after `pause()` continues from the paused wall
     position, not from clip start; (c) `scrub(ms)` while paused jumps state
     to the nearest frame ≤ `ms` without emitting intermediate frames; (d)
     `scrub()` across the loop boundary (per the file's own "ponytail" comment
     at `staticReplay.ts:178-181`) lands on the correct frame, not the
     pre-loop one.
   - **Size:** S–M (harness already exists in the file; reuse its fake-clip/fake-timer setup).

2. **`ingest/test_record.py` — the recorder's orchestration seam.** All the
   pure math (`pit.py`, `resample.py`, `ghost.py`) is unit-tested, but nothing
   asserts `record.py` wires them together correctly: that pit windows suppress
   the right frames, that `sectorDominance`/`pedalTraces`/`corners` actually
   land in the written header, that the per-frame contract scan (F8 in
   `code-review.md`) fires on a real synthetic session. This is the seam most
   likely to silently drop a field when a new feature is bolted on (exactly
   what F1/F6/F8 in `code-review.md` were catching).
   - **Test:** `ingest/test_record.py` — build a minimal synthetic FastF1-shaped
     session (small `laps`/`pos_data` DataFrames, 2 cars, 2 laps, one pit stop)
     and assert the written clip header contains non-empty `pitStops`,
     `pedalTraces`, `sectorDominance`, `corners`, and that every frame's
     `pos` values are a contiguous `1..N` permutation (mirrors the code-review
     F8 invariant, but exercised end-to-end instead of only in the recorder's
     own self-check).
   - **Size:** M (needs a small synthetic-session fixture; no network/fastf1 download).

3. **`TelemetryPanel.tsx`'s `DistanceTrace` (throttle/brake/gear rendering).**
   38% line coverage, and it's the one visibly "new" feature in PR #94 with no
   direct render test — only the rival-selection interaction is tested.
   - **Test:** a `TelemetryPanel.trace.test.tsx` using `renderToStaticMarkup`
     (matches the existing pattern in this repo, no jsdom needed) asserting:
     the SVG paths for throttle/brake/gear are present when `pedalTraces` has
     data for the selected car, and absent/no-crash when it doesn't (guards
     the `state.pedalTraces[car.driverNum] &&` branch at line 328).
   - **Size:** S.

4. **`live_signalr.py`'s ~190 UNVERIFIED parser lines.** Real risk (a live
   session could crash or silently mis-parse), but explicitly blocked on WS5
   (F1TV auth) for *verification* — you can't confirm correctness without a
   real feed. However, the parsers can still get **unit tests against
   captured wire samples** (the repo already does this for `live_parsers.py`
   and has `ingest/tests/` fixtures) without needing a live session — that
   derisks "does this raise on realistic-shaped input" even before real-feed
   verification is possible.
   - **Test:** `ingest/test_live_signalr_parsers.py` (or extend
     `test_dispatch.py`) — feed each of `_parse_gap_str`, `_parse_laptime_str`,
     `_parse_timing_line`, `_parse_tyre_line` a handful of representative
     strings/dicts (some malformed) captured from the existing `ingest/tests/`
     fixtures, and assert no exception + a plausible-typed result. This
     doesn't close the UNVERIFIED note (only a real session does) but it
     converts silent-hang risk into a fast-failing unit test.
   - **Size:** M (mechanical but has to read 190 lines carefully; keep it to
     "doesn't crash / roughly-right shape", not full semantic verification).

Not worth doing right now: chasing `Comms.tsx`/`useComms.ts` to high coverage
— the WebAudio/`HTMLMediaElement` branch is exactly what jsdom can't exercise
faithfully anyway (see §3), and it's not something PR #94 touched.

## 3. The jsdom question

**Recommendation: no, don't add `@testing-library/react` + jsdom.**

One-line reason: the repo's existing `renderToStaticMarkup` + `react-test-renderer`-free
pattern already catches every real bug found so far (all 4 bugs in PR #72's
code-review were caught by either a `renderToStaticMarkup` render test or a
pure-function unit test), and the one documented case it can't catch —
`React.memo`'s bail-out comparator — was already handled correctly by writing
a *direct unit test of the comparator function* (`sameRunningOrder` in
`TimingTower.test.ts`) instead, which is cheaper, faster, and doesn't need a
DOM. The gaps this review found (staticReplay control plane, record.py
orchestration, DistanceTrace rendering) are all either pure-logic gaps or
already-renderable-with-`renderToStaticMarkup` gaps — none of them need real
DOM events, `act()`, or user-event simulation to close. Adding jsdom + RTL
would mean a new dependency, a slower test runner, and a second testing idiom
to maintain in a portfolio repo that's explicitly trying to stay lean — pay
that cost only if a future feature genuinely needs interaction testing
(keyboard nav, focus management, drag) that a static render can't fake.

## 4. CI gaps

- **staticcheck, ruff, govulncheck, npm audit, pip-audit are already gated** —
  this is a solid CI setup for a portfolio repo; no need to add mypy (per the
  already-verified backlog note "no mypy" — this repo's Python is small,
  untyped-by-design pure functions, and mypy would be pure overhead here).
- **No coverage threshold anywhere.** `go test -coverprofile` prints a summary
  but nothing fails the build below a floor; the web job runs `npm test --
  --coverage` but nothing reads the output; the `contract` job runs
  `pytest --cov=. --cov-report=term-missing` for ingest/scripts/bench but
  again doesn't gate on it. **Recommendation: don't add a hard threshold.**
  A blanket percentage gate on a repo with legitimate 0%-coverage files
  (`cmd/server`, `cmd/genclip` — thin mains) and DOM-unreachable branches
  (`useComms.ts`'s audio path) would either need per-package carve-outs or
  get gamed with trivial tests. Better/cheaper: keep coverage as an
  *informational* artifact (already true) and instead land the 4 targeted
  tests in §2, which cover the parts of PR #94 that actually shipped without
  tests.
- **`check_gap_estimator.py` is currently failing** (`test_baked_gaps_match_official_line_crossings`,
  1 failed / 93 passed just now) but it isn't wired into CI (the `contract`
  job runs `pytest .` in `ingest/`, which does execute `check_gap_estimator.py`
  since it matches pytest's default `test_*.py`/`test_*` collection — worth
  confirming this is actually red on `main` right now rather than a local
  data/cache artifact of this box's fastf1 cache, since if it's genuinely
  failing on `main` that's a live CI-red bug outside this report's scope, not
  a "future test to write."

## Summary

Go 51.9% / Python ingest 93 passed 1 failed / Web 71.2% (269 passed, 23 files).
jsdom: not worth it — keep `renderToStaticMarkup` + pure-function unit tests.
Top gaps: `staticReplay.ts` pause/resume/scrub (PR #94, zero test coverage,
first-click demo code) and `ingest/test_record.py` (recorder orchestration,
the seam most likely to silently drop a new field).
