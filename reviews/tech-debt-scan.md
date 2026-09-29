# Tech-debt scan - f1-race-tracker (2026-08-28)

Scope: Go gateway (internal/, cmd/), Python ingest (ingest/), React/TS web (web/src/). UI/UX excluded (reviewed elsewhere).

## 1. ponytail: marker comments (deliberate shortcuts, named ceilings)

Only three in the codebase - all narrowly scoped, self-documenting, low risk.

- internal/app/gateway.go:270 - writeJSON swallows the json.Encoder.Encode error silently.
  Ceiling: named as fine because v is always a small static map[string]string; upgrade path is "add logging if v ever becomes a larger/variable payload where encode failure is plausible."
- ingest/ghost.py:26-31 (build_lap_trace) - O(len(sample_ts) x len(track_xy)) brute-force nearest-point search, run once per driver per clip bake.
  Ceiling: named as fine at ~150 track points / one lap of samples; upgrade path is "switch to a spatial index (k-d tree) or bisection against a precomputed cumulative-arc-length parameterization" if TRACK_POINTS or sample density grows.
- web/src/hooks/useComms.ts:48 - audio.src = next.clip has no crossOrigin attribute, so clips play cross-origin without CORS.
  No explicit upgrade trigger named in the comment - worth adding one (e.g. "revisit if we ever need to read audio buffer data / apply Web Audio effects, which requires CORS").

## 2. TODO/FIXME/HACK/XXX comments

None found. The three raw "XXX" hits (internal/app/gateway_test.go:199, internal/model/apply_test.go:24, web/src/state/race.test.ts:24) are all test fixture data (Code: "XXX" as a placeholder driver code), not markers - false positives, no action needed.

## 3. Test-coverage gaps

Real gap - ingest/live_signalr.py (1119 lines, the largest file in the repo):
Only _publish_frame, _publish_trailing_radio_frame (ingest/test_live_publish.py), _decode_payload, _dispatch_message, _flush_deferred_radio, _radio_from_payload, _radio_or_defer, _session_path_from_payload (ingest/test_dispatch.py), and _replay_capture/_shutdown_flush_radio (ingest/test_capture_replay.py) have direct tests. The following pure, easily-unit-testable parser functions have ZERO test coverage:
  - _parse_gap_str (ingest/live_signalr.py:918)
  - _parse_laptime_str (ingest/live_signalr.py:943)
  - _parse_timing_line (ingest/live_signalr.py:958)
  - _parse_tyre_line (ingest/live_signalr.py:998)
  - _map_status (ingest/live_signalr.py:1027)
  - _safe_int (ingest/live_signalr.py:1036)
  - _decode_position_payload (ingest/live_signalr.py:874)
  Why it matters: these parse untrusted live-timing strings from the F1 SignalR feed; malformed input (e.g. a gap string format change, missing tyre field) would silently propagate bad data or throw inside _run_live_signalr's main loop with no unit test catching a regression. Cheap to fix - no fastf1/network/redis needed (same pattern as test_ghost.py).
  - _run_live_signalr (ingest/live_signalr.py:631-818, ~188 lines) and run_live (ingest/live_signalr.py:1048) are the orchestration loop and are only exercised indirectly through the shutdown-flush test - the reconnect/error-handling branches inside the loop are untested.

Minor gaps:
  - ingest/explore.py (72 lines) - no test file; likely a manual exploration script, low priority.
  - ingest/f1tv_link.py (131 lines) - no dedicated test file (contrast with f1tv_auth.py, which has test_f1tv_auth.py).
  - Go: cmd/genclip/main.go (85 lines) has no main_test.go, unlike cmd/bake-static and cmd/loadtest which both have tests for their non-trivial logic.
  - Web hooks with no dedicated unit test: useGapHistory, useLane, useLapHistory, useReducedMotion, useRollingHistory, useSmoothedCars, useStale (web/src/hooks/) - only useComms has coverage (via Comms.render.test.tsx). These are exercised indirectly through component render tests but have no isolated hook tests for edge cases (e.g. empty history, rapid rev jumps).
  - web/src/state/sessions.ts and web/src/state/testCar.ts have no matching .test.ts.
  - web/src/components/timingHelpers.ts (531 lines, 38 exports) has no dedicated test file, but is exercised transitively by gapDisplay.test.ts and TimingTower.test.ts - not a true gap, just indirect.

## 4. CI weaknesses (.github/workflows/ci.yml)

- No Go linter beyond gofmt + go vet (.github/workflows/ci.yml:25-30). No staticcheck or golangci-lint - misses a class of bugs (unused code paths, ineffectual assignments, more thorough vet-style checks) that plain go vet doesn't catch.
- No Python type-checking (.github/workflows/ci.yml:59-72). ruff check runs (lint only), but there is no mypy/pyright step. ingest/live_signalr.py and ingest/record.py are large, untyped, and parse loosely-structured JSON - a type checker would catch a meaningful class of bugs here.
- No line-coverage gate anywhere - Go (go test -race ./..., line 30), Python (pytest, lines 64/68/71), and web (vitest run, line 48) all run tests but nothing measures or enforces coverage percentage, so coverage gaps like section 3 above can silently grow.
- npm run lint -- --max-warnings 0 (line 46) is strict, which is good - but there is no equivalent "warnings-as-errors" strictness verified for ruff (default exit code only fails on error-level rules present).
- govulncheck pinned to @latest (.github/workflows/ci.yml:82-86), explicitly not pinned to a release, "because older pinned releases fail to build under go.mod's 1.26 toolchain." This is a documented, deliberate tradeoff (float-vs-repro risk), not an oversight - flagged for awareness, not necessarily a fix.

## 5. Dependency risks

- signalrcore pin is already fixed - the task brief's premise (signalrcore==0.8.8 as a "known blocker") is STALE: current ingest/requirements-live-nodeps.txt:23 pins signalrcore==1.0.2, installed with --no-deps specifically because 1.0.2's declared msgpack==1.1.2 is vulnerable (GHSA-6v7p-g79w-8964) and conflicts with the patched msgpack>=1.2.1 in ingest/requirements.txt:9. This is well-documented (ADR-0007) and audited in CI (--ignore-vuln PYSEC-2026-3625, scoped narrowly to the declared-but-never-installed pin). No action needed - already resolved.
- fastf1==3.8.3 (ingest/requirements.txt:3) - hard pin; worth checking periodically for upstream API changes given how much of ingest/record.py / live_signalr.py depends on its data shapes.
- Go module versions look current (go.mod): go 1.26.6 toolchain, github.com/redis/go-redis/v9 v9.22.0, github.com/coder/websocket v1.8.15 - no obviously stale majors. dependabot.yml covers gomod/npm/pip/github-actions weekly with minor/patch grouping, so patch drift should stay low. Worth double-checking whether golang.org/x/sys v0.30.0 (indirect, go.mod:18) is being kept current since indirect-only bumps are less consistently surfaced by dependabot.

## 6. Structural smells

- ingest/live_signalr.py is 1119 lines - the largest file in the repo by a wide margin (next largest Python file, record.py, is 973 lines). It mixes connection/reconnect orchestration (_run_live_signalr), payload decoding/dispatch, and ~7 independent parsing functions (timing, gap, laptime, tyre, status, position) in one module. Splitting the pure parsers (_parse_gap_str, _parse_laptime_str, _parse_timing_line, _parse_tyre_line, _map_status, _safe_int, _decode_position_payload) into a separate live_parsers.py would both shrink the file and make the untested-parser gap (section 3) more visible/fixable in isolation.
- web/src/components/timingHelpers.ts (531 lines, 38 exports) is the largest TS file and lives under components/ despite being pure logic with no JSX - a lib/ or state/-adjacent location would better separate presentation from computation, consistent with the existing state/ and realtime/ directories.
- No dead-code or "no longer used" markers found beyond one incidental grep hit in web/src/components/Ghost.tsx for the word "unused" (part of ordinary variable-naming/comment text, not a marker - not actionable).
- No duplicated business logic found beyond the deliberate, ADR-documented Python/Go contract mirror (event model, timing fields) - the two implementations intentionally shadow each other per docs/adr/0002-timing-fields-rebroadcast-flat.md and are guarded by internal/model/contract_test.go / testdata/contract/golden_snapshot.json, so this is not tech debt.

## Notable false starts / non-issues worth confirming with the user

- The task brief's assumption that signalrcore==0.8.8 is a current blocker is outdated - it was already fixed to 1.0.2 (see section 5). If there is a different signalrcore concern in mind, worth re-confirming which file/version was meant.
