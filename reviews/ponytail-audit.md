# ponytail-audit — f1-race-tracker

Whole-repo over-engineering scan. Report only; nothing applied.
Date: 2026-08-21 · Commit: `7af1f61`

**Local-only file — do NOT commit. `reviews/` is not in `.gitignore`; add it or delete this file before committing.**

Format: `<tag> <what to cut>. <replacement>. [path] (-N lines)`

Tags: `delete` (dead/speculative, replaced by nothing) · `stdlib` (hand-rolled thing the
standard library ships) · `native` (dep doing what the platform does) · `yagni`
(one-implementation abstraction, config nobody sets, layer with one caller) ·
`shrink` (same logic, fewer lines) · `stale` (docs that no longer match reality).

---

## Headline

The **code** is genuinely lean — 1,672 lines of non-test Go, 3,136 of Python, 2,515 of
frontend, with almost no reinvented stdlib, no single-implementation interface theatre, no
unused dependencies in any of the three ecosystems, and no dead CSS. Three separate deep
passes found under 900 lines of real code to cut.

The **repo around the code is not lean.** ~9,000 lines of AI-agent planning residue and
70 MB of committed replay data are what a recruiter or hiring manager actually sees first
when the file tree loads. That is where essentially all the payoff is.

---

## Ranked findings

### Tier 1 — repo-level clutter (the whole payoff)

1. `delete` — **`docs/superpowers/plans/` (14 files, 8,535 lines).** Agent session artifacts:
   step-by-step build plans with literal `git add` commands, `[ ]` checkboxes, and
   "For agentic workers:" preambles. Nothing in `README.md` links them. Nothing in the code
   imports them. They read as "an AI wrote this repo," which is the opposite of the signal a
   portfolio piece wants. Replacement: nothing — the shipped decisions already live in
   `docs/adr/` (8 ADRs, 384 lines) and the two scope docs.
   `[docs/superpowers/plans/]` **(-8,535)**

2. `delete` — **5 of 7 files in `docs/superpowers/specs/` (363 lines).** Same category.
   Exactly two are load-bearing and must stay or be folded into an ADR:
   `2026-08-20-f1auth-spike-findings.md` (cited by ADR-0007, `docs/runbooks/live-verification.md:164`,
   `ingest/requirements-live-nodeps.txt:2`, `ingest/test_dispatch.py:5`, `ingest/test_f1tv_auth.py:5`)
   and `2026-06-19-f1-m4-loadtest-benchmark-design.md` (cited by ADR-0001, Tech Scope). The other
   five — pit-wall-timing-design, team-radio-design, ghost-overlay-design,
   cross-year-comparison-design, readme-demo-polish-design — are superseded by ADRs 0002/0003/0004
   and by the shipped code. Replacement: the ADRs that already cover the same decisions.
   `[docs/superpowers/specs/]` **(-363)**

3. `shrink` — **70 MB of committed replay clips across 3 files** (`monza-2023-race.jsonl` 24 MB,
   `monza-2024-race.jsonl` 23 MB, `silverstone-2024-race.jsonl` 22 MB; 13,254 lines total).
   All three are genuinely used (compare lanes + live lane in `docker-compose.yml`), so do not
   delete them — but a fresh `git clone` is 39 MB of history for a demo that plays a 4-lap window.
   `ingest/record.py` already takes `--start-lap/--end-lap`; re-bake each clip to a shorter window
   or drop per-frame precision. Replacement: same three clips, narrower window. Not LOC, but the
   single most visible weight in the repo. `[data/replays/]` **(-~50 MB, 0 LOC)**

4. `delete` — **`docs/ux-evaluation-2026-07.md` (91 lines) and
   `docs/superpowers/plans/2026-08-20-ux-walkthrough-findings.md` (75 lines, inside item 1's count).**
   Point-in-time QA session transcripts with harness caveats ("the browser pane in this session could
   not composite frames"). The P1/P2 items in them are either shipped or belong in GitHub Issues,
   which `CLAUDE.md` already declares as the issue tracker. Replacement: GitHub Issues.
   `[docs/ux-evaluation-2026-07.md]` **(-91)**

5. `yagni` — **the entire FILE-MAP apparatus: `scripts/gen_file_map.py` (193), `scripts/test_gen_file_map.py` (80),
   `FILE-MAP.md` (32), and the `--check` CI gate (`.github/workflows/ci.yml:59-60`).** 305 lines of
   generator, tests, regex-based Go-doc/TSDoc/Python-docstring extraction, and a build-breaking
   staleness gate — to emit a 20-row table of directory names. Its stated purpose ("the directory
   index agents jump to instead of crawling") is speculative; nothing consumes it. It also
   silently omits `scripts/` and `web/embed.go` (`ROOTS` at `gen_file_map.py:22`), so it isn't
   even a complete map. Replacement: the "Layout" bullets already in `web/README.md` and
   `README.md` §Further reading, or `tree -d -L 2` in a README fence.
   `[scripts/gen_file_map.py, FILE-MAP.md]` **(-305)**

6. `stale` — **`docs/F1_Race_Tracker_Tech_Scope.md:14-27` names six files that have never existed:**
   `ingest/normalise.py` (real: `resample.py`), `ingest/model.py` (never built), `web/src/track/*`
   (real: `components/geometry.ts`), `internal/api/control.go` (real: `internal/app/gateway.go`),
   `cmd/gateway` (real: `cmd/server`), `internal/ws/hub_integration_test.go` (real:
   `internal/app/integration_test.go`). Verified all six absent. A reader who greps for them
   concludes the docs are fiction. Replacement: cut the Phase-1 task table entirely (it is a
   pre-build estimate sheet with effort-in-days columns, not architecture) or repoint the paths.
   `[docs/F1_Race_Tracker_Tech_Scope.md:14-27]` **(-25)**

7. `delete` — **`knowledge/` (9 files, 172 lines) + `.github/workflows/okf.yml` (18 lines).**
   Duplicates `CONTEXT.md` + `docs/adr/` + `FILE-MAP.md` + the Tech Scope, and its own index uses
   root-absolute links (`/domain/event-model.md`) that are broken on GitHub. It also directly
   contradicts the repo's declared layout — `docs/agents/domain.md:14` says "Single-context repo:
   `CONTEXT.md` + `docs/adr/`". **Caveat:** gated by an external CI action
   (`natcat38/okf-portfolio-standard@v1`), so this is a deliberate portfolio convention. If that
   standard still matters, at minimum fix the broken links; otherwise drop both.
   `[knowledge/, .github/workflows/okf.yml]` **(-190)**

8. `delete` — **`ingest/explore.py` (72 lines).** A committed FastF1 scratch script
   ("Run BEFORE record.py to understand data shapes"). Zero imports, zero CI references, not
   mentioned in `ingest/README.md`. A debugging session someone forgot to remove. Replacement:
   nothing — that is a REPL, not a module. `[ingest/explore.py]` **(-72)**

9. `native` — **`Dockerfile:19` does `COPY --from=build /src/data /data`**, baking all 70 MB of
   replay clips into every one of the four Go service images — including `gateway`, which never
   reads a clip (it reads Redis). Replacement: keep the `./data:/data:ro` bind mount that
   `docker-compose.yml:24` already uses for the Python `live` service and drop the COPY, or
   copy only the one clip a given role needs. `[Dockerfile:19]` **(-1 line, -210 MB of image layers)**

10. `delete` — **`scripts/test.ps1` (28 lines).** Line-for-line the same five suites as
    `scripts/test.sh`, which already probes `.venv/Scripts/python.exe` before `.venv/bin/python`
    and therefore already works on Windows (the Bash tool is available in this environment).
    Neither is used by CI, which invokes the suites directly. Replacement: `scripts/test.sh`.
    `[scripts/test.ps1]` **(-28)**

11. `delete` — **`web/.gitignore` (24 lines), the untouched Vite scaffold default.** Contains
    yarn/pnpm/lerna logs, `*.suo`, `*.ntvs*`, `*.njsproj`, `*.sln`, `*.sw?` — none of which this
    repo can produce. The only lines that matter (`node_modules`, `dist`) are already covered by
    the root `.gitignore:15,21`. **Caveat:** its bare `dist` has no `!dist/.gitkeep` negation, so
    deleting it is the safe direction, not editing it. Replacement: the root `.gitignore`.
    `[web/.gitignore]` **(-24)**

11b. `delete` — **four untracked screenshot PNGs sitting in the repo root**: `board-full.png`,
    `compare.png`, `ghost.png`, `settings.png` (found by `git status`, pre-existing, not created by
    this audit). `.gitignore:36-38` already ignores three *other* one-off screenshots by exact
    filename (`m3a-live-lane-silverstone.png`, etc.) — these four missed that list, so a stray
    `git add .` commits them. Replacement: delete them, and replace the three brittle
    filename-by-filename ignores with one `/*.png` root-level rule (`docs/assets/*.png` and
    `bench/results.png` are in subdirectories and stay tracked). `[repo root]` **(-3 ignore lines)**

### Tier 2 — code

12. `yagni` — **speculative live-timing field parsing in `ingest/live_signalr.py:917-1023`**
    (`_parse_gap_str`, `_parse_laptime_str`, `_parse_timing_line`, `_parse_tyre_line`) plus its
    `timing_extra`/`tyre_extra` bookkeeping at `:484-499`, `:512-521`, `:687-712`. The module's own
    docstring (`:71-74`) and three function docstrings mark every field name it parses
    (`GapToLeader`, `IntervalToPositionAhead`, `LastLapTime`, `NumberOfLaps`, `Stints`) as
    **UNVERIFIED against a real session**. ~190 lines exist to extract fields from a wire shape
    nobody has watched fire. Replacement: position-only live path (which *is* contract-verified);
    re-add per field as `docs/runbooks/live-verification.md` closes each one out.
    **Trade-off:** `README.md:85` currently advertises this coverage — cutting it means editing that
    claim too, which is arguably the more honest outcome. `[ingest/live_signalr.py:917-1023]` **(-190)**

13. `shrink` — **four near-identical message-handling blocks copy-pasted between
    `_replay_capture` and `handle_message`** in `ingest/live_signalr.py`: DriverList update
    (`:400-413` vs `:673-685`), TimingData (`:487-499` vs `:687-701`), TimingAppData
    (`:513-521` vs `:703-712`), car-dict construction (`:554-565` vs `:744-755`). Replacement:
    four module-level helpers — `_update_driver_info`, `_update_timing`, `_update_tyre`,
    `_build_car` — called from both paths. `[ingest/live_signalr.py]` **(-70)**

14. `yagni` — **`useLapHistory.ts` (9 lines) and `useGapHistory.ts` (11 lines), each a one-line
    pass-through to `useRollingHistory` with exactly one call site** (`web/src/App.tsx:50-51`).
    Textbook generic-hook-plus-N-wrappers-each-used-once. Replacement: call
    `useRollingHistory(state, {}, updateLapHistory)` / `useRollingHistory(state, {}, updateGapHistory)`
    directly in `App.tsx`, importing the updaters from `components/timingHelpers`.
    `[web/src/hooks/useLapHistory.ts, useGapHistory.ts]` **(-18)**

15. `shrink` — **`TEAM_MAP` defined byte-identically twice**, at `ingest/record.py:76-87` and
    `ingest/live_signalr.py:175-186`. The repo already has the pattern for this (fastf1-free pure
    helpers in `resample.py`/`ghost.py`/`radio.py` imported by both paths). Replacement: move it to
    `ingest/resample.py` and import. `[ingest/record.py:76-87]` **(-11)**

16. `stdlib` — **hand-rolled max/min/clamp** at `cmd/loadtest/hist.go:23-29`, `:45-47`, `:58-63`.
    `go.mod` is on Go 1.26; the builtin `max`/`min` (1.21+) cover all three sites. Replacement:
    `ms = max(ms, 0)`, `h.max = max(h.max, ms)`, `h.max = max(h.max, o.max)`,
    `rank = min(max(rank, 1), h.count)`. `[cmd/loadtest/hist.go]` **(-10)**

17. `shrink` — **normalisation math written twice**: batch in `ingest/record.py:237-243`
    (`normalise()`) and incremental in `ingest/live_signalr.py:229-240` (`BoundBox.normalise()`).
    Same transform (offset, Y-flip, round to 4 dp), different bounds source. Replacement: one
    `normalise_xy(x, y, x_min, x_max, y_min, y_max)` in `resample.py`; both callers pass their own
    bounds. `[ingest/record.py:237-243]` **(-8)**

18. `delete` — **`--onair` in `web/src/styles/tokens.css:13-14`.** No `var(--onair)` anywhere; the
    one place it would apply (`components.css:158`) hardcodes `rgba(225, 6, 0, 0.15)` instead.
    Replacement: nothing. `[web/src/styles/tokens.css:13-14]` **(-2)**

19. `yagni` — **`type Msg = NonNullable<ReturnType<typeof parseMsg>>`** at
    `web/src/realtime/staticReplay.ts:7`, with a comment conceding it is "gymnastics." Caused only
    by `web/src/state/race.ts:64` not exporting its `Msg` union. Replacement: `export type Msg`
    in `race.ts`, plain `import type` in `staticReplay.ts`. `[web/src/realtime/staticReplay.ts:7]` **(-0, clarity)**

20. `delete` — **`latencyHist.Count()` (`cmd/loadtest/hist.go:75`)** has no production caller
    (`main.go` uses `ctr.frames.Load()`); only `hist_test.go` calls it, and the test is in
    `package main` so it can read `h.count` directly. Replacement: nothing.
    `[cmd/loadtest/hist.go:75]` **(-1)**

21. `yagni` — **`timeNowMs()` (`cmd/loadtest/main.go:55`)**, a one-line delegation to
    `time.Now().UnixMilli()` with one production call site (`:151`). Replacement: inline it.
    Marginal — listed for completeness. `[cmd/loadtest/main.go:55]` **(-1)**

---

## Considered and rejected

- **`native:` swap the WebSocket for `EventSource`** (`web/src/realtime/socket.ts:1-83`). The client
  never calls `.send()`, so on paper ~38 lines of hand-rolled exponential backoff duplicate what
  `EventSource` gives free. **Rejected:** the gateway's backpressure valve — "sheds milliseconds
  rather than dropping clients" — is the headline claim of `BENCHMARKS.md` and `README.md:23`, and
  SSE has no equivalent. It would also force a Go-side rewrite of `internal/ws/`. The 38 lines buy
  the project's central engineering story.
- **`internal/app/writer.go`'s `Source` interface** — one production implementation, but two real
  test doubles. Standard Go DI-for-testability, not speculation.
- **The four `ingest/requirements*.txt` files** — each has a documented, narrow reason
  (fastf1-free dev deps for CI; `--no-deps` for `signalrcore`'s vulnerable+conflicting `msgpack`
  pin, with the pip-audit ignore documented at `ci.yml:102-108`). Not copy-paste.
- **`ingest/check_live_contract.py`** — collected by `pytest.ini`'s `check_*.py` pattern, run in CI,
  pins Python's key sets against `internal/model/model.go`'s struct tags. Closes a real drift path.
- **`cmd/loadtest/hist.go`'s custom histogram** — no stdlib streaming-percentile equivalent, 75 lines.
- **The triple opt-in live gate** (`--live` + `LIVE=1` + `LIVE_TIMING_MODE=beta`) — deliberate per
  ADR-0007, guards against an agent dialling a live feed by accident.
- **`web/` dependencies** — all 4 deps and 13 devDeps verified imported. No dead CSS selectors in
  `components.css` (all 37 checked, including the dynamic `Record<AuthState, string>` lookup in
  `Settings.tsx:14-19`). No `createContext`, no barrel files.
- **Go direct deps** — `coder/websocket`, `redis/go-redis`, `alicebob/miniredis` (test-only fake
  Redis). All three earn their place; net/http has no WebSocket.

---

## FILE-MAP accuracy

`FILE-MAP.md` is **currently accurate** — spot-checked `web/src/components` (24), `ingest` (19),
`internal/model` (5), `bench` (2); the totals line (17 dirs / 100 files / 0 undeclared) matches, and
CI gates it. Its gaps are by design (`ROOTS` at `gen_file_map.py:22` excludes `scripts/`, `testdata/`,
and `web/embed.go`). Accuracy is not the problem — see finding 5 for why the machinery still doesn't
pay for itself.

---

## Net

```
net: -9,918 lines, -0 deps.
     ~9,300 of that is docs/process residue (findings 1-8, 10, 11)
     ~620    is code and tooling  (findings 9, 12-21)
     plus  ~50 MB off a fresh clone and ~210 MB off the Docker images.
```

Excludes the rejected `EventSource` rewrite (-38) and counts finding 4's walkthrough file once.

If only three things get done: **delete `docs/superpowers/`, re-bake the replay clips smaller,
delete the FILE-MAP generator.** That is ~9,200 lines and ~50 MB, and it is all the clutter a
browsing reviewer would ever see. The code itself is already lean — leave it alone.
