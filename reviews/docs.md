# Docs refresh and cleanup — PR #73

https://github.com/natcat38/f1-race-tracker/pull/73 · branch `docs/refresh-and-cleanup` · base `main`

**11,201 lines deleted, 128 changed across 6 files. Docs only** — no application code,
tests, CI workflows, or `FILE-MAP.md`, to stay clear of open PRs #71 and #72.

## Deleted

| Path | Files | Lines |
|---|---|---|
| `docs/superpowers/plans/` (all) | 14 | 10,712 |
| `docs/superpowers/specs/` (5 of 7) | 5 | 489 |

Kept two specs, both verified load-bearing with `git grep`:

- `2026-08-20-f1auth-spike-findings.md` — cited from ADR-0007, the live-verification
  runbook §5.4, `ingest/requirements-live-nodeps.txt`, `ingest/test_dispatch.py`,
  `ingest/test_f1tv_auth.py`.
- `2026-06-19-f1-m4-loadtest-benchmark-design.md` — cited from ADR-0001 and the tech scope.

Three links into deleted files were repointed rather than left to dangle: the f1auth
spec's pointer to its plan → ADR-0007 + the runbook; the ux-evaluation's citation of the
Phase-3 radio spec → `CONTEXT.md`'s **Comms** entry.

## Claims fixed

1. **Tech scope named six files that never existed** (plus a seventh the audit missed,
   `web/src/components/Skeleton.tsx`). Corrected the task table and per-task file lines
   to the shipped layout instead of deleting the doc — §2 is the system-design story the
   README links to. The as-built delta section keeps the record of what diverged and why.
2. **`CONTEXT.md` event model** — `pos` is now a server-side reconciled dense rank
   (`reconcile_positions`, `ingest/resample.py`), not something that "falls out of the
   same data". Two sentences at glossary depth + a usage note. Same correction applied
   to the tech scope's §2.2 contract and its `Pos` field comment.
3. **README service table** was missing both `compare-*` lanes.
4. **README "every message shape is still `UNVERIFIED:`"** — the connect-time snapshot
   shape was verified 2026-08-20; only the incremental shapes remain unverified.
5. **README Further reading** pointed at `ingest/` not its README, and omitted `CONTEXT.md`.

Everything else in the README was verified claim by claim and was already accurate.
Nothing restyled.

## Bake windows recovered (`ingest/README.md`)

- Monza 2024 → `--start-lap 13 --end-lap 17`
- Monza 2023 → `--start-lap 19 --end-lap 23`
- Silverstone 2024 → `--start-lap 25 --end-lap 28`

Derived from each clip's leader-lap rollovers matched against `record.py`'s window
logic (`WINDOW_START_S = lap_starts[start_lap]`, `WINDOW_END_S = lap_starts[end_lap+1]`).
Two of three independently match lap ranges the README already stated. The section also
documents how to re-derive them, so this can't rot silently again.

## Verification

- `git grep` for every deleted path — zero dangling references.
- Relative-link check over README/CONTEXT/ingest README/BENCHMARKS/SECURITY/`docs/**` — 0 broken.
- Backticked-path existence sweep — only intentional "the plan said X" mentions remain.
- `python scripts/gen_file_map.py --check` → `FILE-MAP.md is current` (it tracks
  .go/.py/.ts/.tsx counts, so markdown deletions don't affect it).

## Follow-ups listed in the PR, not done

1. FILE-MAP generator + CI gate (code/CI decision, conflicts with #72).
2. Re-bake clips to narrower windows (~70 MB of committed data).
3. Slim the Dockerfile's clip copy.
4. `web/index.html` meta/OG tags.

## Flagged for the owner

Deleting `2026-07-23-phase5-pit-wall-completion.md` walks back closed issue #36, which
asked for a committed plan per milestone. ADR-0005 (issue #35) is the durable form that
survived. Easy to restore that one file if wanted.
