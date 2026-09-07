# Verified cleanup backlog — handoff doc (verified 2026-08-29, main @ 393d1e4)

Self-contained brief for a future session. Every item below was adversarially
re-verified against current code by dedicated agents (evidence transcripts:
scratchpad `verify-ingest.md`, `verify-web.md`, `verify-ci-sec.md`; summarised
here with the verdicts baked in). Claims that did NOT survive verification are
listed at the bottom so they don't get rediscovered.

Companion doc: `reviews/plans/features-to-add.md` (new features). This file is
the "everything else": correctness, tests, CI, security, hygiene, polish.

Before starting: read `CONTEXT.md` (vocabulary enforced), `FILE-MAP.md`, and
the ADRs touching your area. New files need a header comment + FILE-MAP regen
(`python scripts/gen_file_map.py`, in a fresh worktree right before the final
commit — local `--check` can pass while CI says stale).

## A. Correctness & tests (highest value)

1. **Direct unit tests for the live-feed parsers** — `ingest/live_signalr.py`'s
   seven pure parsers (`_parse_gap_str` ~:918, `_parse_laptime_str` ~:943,
   `_parse_timing_line` ~:958, `_parse_tyre_line` ~:998, `_map_status` ~:1027,
   `_safe_int` ~:1036, `_decode_position_payload` ~:874) have **no direct
   tests**. Nuance from verification: `test_capture_replay.py` exercises all
   seven *indirectly*, but that test is **skipped in CI's fastf1-free contract
   job**, and several branches are untested even indirectly (e.g.
   `_parse_gap_str`'s `'L'` lapped suffix, `_map_status`'s `'Out'` fallback).
   These parse untrusted live-timing strings; regressions land silently.
   Use the existing no-network pattern (`test_ghost.py`). Effort: S–M.

2. **Split the parsers out of `live_signalr.py`** (1119 lines, largest file in
   repo) into a `live_parsers.py`. Verified: parsers are stdlib-only, no import
   cycle, mirrors the existing `resample.py` pure-helper pattern. Do together
   with item 1. Effort: S.

3. **Deduplicate the four copy-pasted message-handling blocks** in
   `live_signalr.py` — DriverList, TimingData, TimingAppData, and Position.z
   handling are each duplicated between `_replay_capture` and `handle_message`
   (SessionInfo/TeamRadio are already shared correctly). Effort: M.

4. **`reconcile_positions` deferred limitations** (`ingest/resample.py`) —
   verified still comment-only: cold-start partial roster, and retired
   (`'Out'`) cars are not sunk to the tower's tail (sort key never reads
   `status`). Fix or consciously re-defer. Effort: M each.

5. **jsdom render testing** — verified: no `@testing-library/react`/jsdom in
   `web/package.json`; all 8 render tests use `renderToStaticMarkup`, which
   never exercises `React.memo`, effects, or interaction. `Map.tsx` and
   `TelemetryPanel.tsx` have zero render tests (Ghost.tsx has an SSR-only one).
   Adding jsdom + a few interaction tests closes a whole class of blind spots.
   Effort: M.

## B. CI

6. **Add Go `staticcheck`** — CI runs only gofmt + `go vet`. Verified
   proportionate for this repo. Effort: S.
   **Do NOT add mypy** — verified disproportionate: the Python code has zero
   type annotations, so it would demand annotating ~2000 lines first.
7. **Add a ruff config** — verified: no ruff configuration exists at all, so
   only default rules run. Even a small `[tool.ruff]` with a chosen rule set
   is an upgrade. Effort: S.
8. **Coverage measurement** — no coverage is measured or gated in any of the
   three suites (Go/`pytest`/vitest). Start by *measuring* (upload/report
   only); gate later if wanted. Effort: S–M.

## C. Security (low tier — deployment-mitigated, defense-in-depth)

9. **Host-header / DNS-rebinding guard on the gateway** — verified nuance: the
   `Sec-Fetch-Site` guard on `POST /control/source`
   (`internal/app/gateway.go:~243`) deliberately allows requests with the
   header missing (its own comment admits it), and the Go config default is
   `ADDR=:8080` (all interfaces) — loopback protection comes only from
   `docker-compose.yml`'s `127.0.0.1:8080:8080` port mapping. Not an active
   vuln under the documented deployment; a Host-allowlist check is cheap
   hardening for anyone who runs the bare binary. Effort: S.

## D. Hygiene (portfolio-facing)

10. **Re-bake the replay clips shorter** — verified: three full-race clips
    total ~70 MB (`data/replays/`), `record.py --start-lap/--end-lap` supports
    windowing, and **no Go test depends on clip length**. BUT all three clips
    are loaded by default (docker-compose lanes + the Pages static bake), so
    shorter clips change what the demo shows — this is a product call on
    window choice, not pure cleanup. Effort: M.
11. **Delete `ingest/explore.py`** — verified: zero imports, zero CI refs.
    Effort: S.
12. **Deduplicate `TEAM_MAP`** — verified byte-identical in
    `ingest/record.py:~76` and `ingest/live_signalr.py:~175`; move to
    `resample.py` (or the new `live_parsers.py`). Effort: S.
13. **Extract the shared normalise formula** (record.py:~237 batch vs
    live_signalr.py:~229 incremental) into `resample.py` — verified the
    *formula* is duplicated and extractable, but the surrounding
    bounds-accumulation strategies are legitimately different: extract the
    formula only, don't merge the strategies. Effort: S.
14. **Delete the dead `--onair` token** — verified unused
    (`web/src/styles/tokens.css:21`; only `--onair-rgb` is referenced).
    Effort: S (2 lines).
15. **Inline `useLapHistory`/`useGapHistory`** — verified literal one-line
    wrappers around `useRollingHistory`, one call site each in `App.tsx`.
    Effort: S.
16. **Export `Msg` from `race.ts`** (line ~76) and drop the
    `NonNullable<ReturnType<typeof parseMsg>>` alias in
    `staticReplay.ts:~10`. Effort: S (2 lines).
17. **Use Go builtins in `cmd/loadtest/hist.go`** — verified 4 hand-rolled
    max/min/clamp spots (~:27-32, :48-50, :61-63); Go 1.26 builtins available.
    Effort: S.
18. **Delete `docs/ux-evaluation-2026-07.md`** — verified superseded and
    unreferenced (only auto-generated FILE-MAP + untracked reviews/ mention
    it). Regenerate FILE-MAP after. Effort: S.
19. **`knowledge/` directory** — verified: content duplicates
    CONTEXT.md/ADRs and `knowledge/index.md` has broken root-absolute links,
    BUT `.github/workflows/okf.yml` explicitly validates the knowledge bundle,
    so deletion needs the external okf-portfolio-standard action checked (or
    updated) first. Minimum do-now: fix the broken links. Effort: S (links) /
    owner decision (deletion).

## E. UI polish (small, still open)

20. **Timing tower row rhythm** — verified: `.tt-table td` padding is tight
    (`components.css:~658`), no inter-row hairline. (The "superscripts
    re-render at 10 Hz" half of the original claim was not fully traced —
    re-check before building a throttle.) Effort: S.
21. **Ghost overlay copy** — verified `Ghost.tsx:265` still uses
    renderer-vocabulary "solid vs … ghost" phrasing; reword in plain race
    terms. Effort: S.
22. **Static demo fetches the full replay clip on routes that don't need it**
    — verified the `App.tsx` mount effect calls `connectStaticReplay`
    unconditionally regardless of route (clip is ~24 MB on disk; over-the-wire
    size unmeasured — likely less with compression, measure first). The naive
    fix (gate on route) re-fetches on every nav back to `#board`, so the right
    shape is probably lazy-connect-once + keep-alive. Needs a small design
    pass, not a one-liner. Effort: M.

## Verified NOT worth doing (don't rediscover these)

- **Deleting `web/.gitignore`** — REFUTED: it has real entries (logs,
  `.vscode/*`, VS-project extensions) not covered by the root `.gitignore`.
- **aria-labels on the bare `<select>`s** — REFUTED: all three already have
  accessible names via `<label htmlFor>`.
- **Deleting `scripts/test.ps1`** — unused by CI but it's the owner's local
  Windows convenience script; keep it.
- **Adding mypy** — see item 6.
- **Moving `timingHelpers.ts` out of components/** — real misplacement, pure
  churn; do only opportunistically inside another PR touching its imports.
- **#89's failing dependency scan** — resolved: main is green post-merge
  (OKF + CI both passed on 393d1e4).

## Suggested batching

- PR 1 (correctness): items 1+2+12 (+3 if appetite).
- PR 2 (hygiene sweep): items 11, 14, 15, 16, 17, 18, 13.
- PR 3 (CI): items 6, 7, 8.
- Separate design-first efforts: items 5, 10, 22; owner calls: 4, 9, 19.
