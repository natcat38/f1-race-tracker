# Lane D execution report — CI/tooling/docs/knowledge

Branch: `cleanup/verified-backlog` (no commits made, per instructions — main session
commits). Scope owned: `.github/workflows/*`, `pyproject.toml`, `docs/`, `knowledge/`.
Did not touch `ingest/*.py`, `web/src/*`, or Go files (other lanes were concurrently
editing all three — confirmed via `git status` throughout).

## Item 6 — Go staticcheck in CI

`.github/workflows/ci.yml`, `go` job: added a `staticcheck` step between `go vet` and
`go test`, same job (there's no matrix — single `ubuntu-latest` job), same
fail-the-build behavior (no `continue-on-error`):

```yaml
- name: staticcheck
  run: go run honnef.co/go/tools/cmd/staticcheck@v0.8.1 ./...
```

Followed the repo's existing "`go run <module>@version ./...`" convention (used for
`govulncheck` in the `security` job) rather than introducing the `dominikh/staticcheck-action`
GitHub Action, since the repo already has a working pattern for exactly this shape of
tool. Pinned to `v0.8.1` (unlike `govulncheck`'s deliberate `@latest`, which has a
documented toolchain-compat reason) — no such reason exists for staticcheck, so pinning
for reproducibility is the lazier long-term choice.

Renamed the job's `name:` from `Go (fmt + vet + test)` to `Go (fmt + vet + staticcheck + test)`.

Did NOT add mypy, per the explicit instruction (zero type annotations in ~2000 lines of
Python; disproportionate).

**Verified locally**: `go run honnef.co/go/tools/cmd/staticcheck@v0.8.1 ./...` from repo
root — exit 0, zero findings, only module-download output. Safe to add without any
existing-code fallout.

## Item 7 — ruff configuration

No `pyproject.toml` existed anywhere in the repo. Created one at repo root (the
conventional spot — it's also where `ruff check ingest bench` in CI's `contract` job
runs from, so ruff discovers it automatically without any CI change).

```toml
[tool.ruff]
target-version = "py311"  # matches ci.yml's actions/setup-python version

[tool.ruff.lint]
extend-select = ["E", "W", "B"]
ignore = ["E501", "W292", "B007", "B011", "B023", "B905"]
```

Chosen set: pyflakes (default) + full pycodestyle (E/W) + flake8-bugbear (B) for
real-bug classes (mutable defaults, useless comparisons, etc.). **isort (`I`) was left
out entirely** — not narrowed via ignores, dropped outright — because its one rule,
I001, fired on every one of ~11 test files that do `sys.path.insert(...)` before a
local import (the repo's documented no-network test pattern, see `ingest/pytest.ini`).
Reordering those imports would mean editing files this lane doesn't own, for a pattern
that's intentional, not disorder.

**Narrowed further** (task explicitly sanctions this over mass-editing other lanes'
files):
- `E501` (line-too-long) — codebase has ~100 pre-existing lines past the 88-char
  default (max observed: 195 chars), scattered across ingest/bench/scripts. A
  reformat, not a lint-config change.
- `W292`, `B007`, `B011`, `B023`, `B905` — each has a handful of pre-existing hits
  confined to `ingest/*.py` test files (off-limits for this lane). Verified each
  narrowed rule's *complement* is clean (e.g. `B` minus those four codes = 0
  violations) so the narrowing is scalpel, not a blanket rule-family drop.

**Verification commands + results:**
```
$ python -m ruff check ingest bench          # CI's actual current scope
F401 ingest\live_signalr.py:150,151 (2 errors)
$ python -m ruff check .                     # whole repo, for thoroughness
Same 2 errors, nothing else anywhere else in the repo.
```
Those 2 `F401` (unused import of `_parse_gap_str`/`_parse_laptime_str` from the new
`live_parsers` module) are **pre-existing and unrelated to this lane's config** —
confirmed by running ruff with *no config file present at all* (same 2 errors,
identical default-rule behavior). `ingest/live_signalr.py` is mid-edit by a concurrent
lane doing the parser-extraction refactor (plan item #2); out of this lane's scope to
touch. Everything else — all of `ingest`, `bench`, and `scripts` — passes clean with
the new rule set.

## Item 8 — coverage measurement (report-only, all three suites)

**Go** (`ci.yml`, `go` job):
```yaml
- name: go test
  run: go test -race -coverprofile=coverage.out ./...
- name: coverage summary
  run: go tool cover -func=coverage.out | tail -1
```
`coverage.out` is already covered by the repo's existing `*.out` gitignore rule.
Verified locally (without `-race`, since this Windows box has no cgo toolchain —
`-race` itself is pre-existing and untouched, and CI's ubuntu-latest runner has gcc by
default): `go test -coverprofile=coverage.out ./...` → all packages pass, `go tool
cover -func=coverage.out | tail -1` → `total: (statements) 51.3%`. No `-cover-fail-under`
equivalent set — report only, never fails the build on a coverage number.

**Python** (`ci.yml`, `contract` job): added `--cov=. --cov-report=term-missing` to all
three `pytest` invocations (scripts, ingest, bench), and added `pytest-cov==7.1.0` to
`ingest/requirements-dev.txt` (the one `pip install -r` the `contract` job already runs
before all three pytest steps, so one add covers all three suites).
Verified locally, each working directory:
- `scripts`: 92% total coverage printed; one pre-existing failure
  (`test_build_is_stable_across_runs_and_matches_the_committed_map`) — confirmed
  unrelated to `--cov` (reproduces identically without it) and caused by a concurrent
  lane's in-flight deletion of `ingest/explore.py` (plan item #11) ahead of a FILE-MAP
  regen, which the parent session handles at the end. Not this lane's file to touch.
- `ingest`: 80 passed, 61% total coverage printed.
- `bench`: 3 passed, 43% total coverage printed.

Added `.coverage` (coverage.py's default data-file name, no extension) to the
Python section of the root `.gitignore` — running any of the three suites locally now
leaves a stray `.coverage` file in that directory otherwise.

**Web** (`ci.yml`, `web` job): changed `npm test` → `npm test -- --coverage`. Needed
`@vitest/coverage-v8` (not previously a devDependency); added `"@vitest/coverage-v8":
"^4.1.11"` to `web/package.json` (matching vitest's own `^4.1.10`) and ran `npm install`
to refresh `web/package-lock.json` so `npm ci` in CI stays valid. No `vite.config.ts`
change needed — vitest's `--coverage` flag works standalone with just the provider
package installed; default text reporter prints straight to the CI log, which is
exactly "print the summary, don't gate."
Verified locally: `npm test -- --coverage` → 20 test files / 261 tests passed, full
per-file v8 coverage table printed, overall 75.43% statements / 72.96% branches. (Two
worker-pool timeout errors appeared on `Map.interaction.test.tsx` — a new test file
from a concurrent lane's `web/src` work, unrelated to the coverage flag itself since
the suite still reported all tests passed; not investigated further, out of this
lane's scope.)
Note: `web/package.json` picked up a second, independent addition
(`@testing-library/react`, `jsdom`) from a concurrent lane mid-edit while this lane was
working — both sets of changes coexist correctly in the file and in the regenerated
lockfile; no conflict.

## Item 18 — delete docs/ux-evaluation-2026-07.md

Deleted. Verified zero remaining references anywhere in the repo except the
auto-generated `FILE-MAP.md` (regenerated by the parent session at the end, per
instructions — not touched here) and the untracked `reviews/` directory (working
notes, not shipped content):
```
$ grep -rn "ux-evaluation-2026-07" .
FILE-MAP.md, reviews/plans/verified-cleanup-backlog.md, reviews/backlog-still-open.md,
reviews/ponytail-audit.md   (only)
```

## Item 19 — fix knowledge/index.md broken links

All 8 links in `knowledge/index.md` were root-absolute (e.g. `/domain/event-model.md`),
which don't resolve as repo-relative markdown links. Changed each to a path relative to
`knowledge/index.md` itself (dropped the leading `/`) — `domain/event-model.md`,
`domain/leaderboard.md`, `components/ingest-pipeline.md`,
`components/replay-engine.md`, `components/redis-pubsub.md`,
`components/websocket-protocol.md`, `data/fastf1-source.md`. Did not touch the
`../docs/...` links in the same file — those were already correctly relative.
Did NOT delete `knowledge/` (per instruction — `.github/workflows/okf.yml` validates it).

**Verified every link resolves:**
```
$ find knowledge -type f
knowledge/components/{ingest-pipeline,redis-pubsub,replay-engine,websocket-protocol}.md
knowledge/data/fastf1-source.md
knowledge/domain/{event-model,leaderboard}.md
knowledge/index.md
```
All 7 relative targets referenced from `index.md` exist at those exact paths; the 2
`../docs/*.md` targets also exist.

**Follow-up flagged, not fixed here (out of this task's explicit scope — it named only
`index.md`):** the identical root-absolute pattern exists in 7 more places across
`knowledge/components/*.md` and `knowledge/domain/*.md` themselves (e.g.
`knowledge/domain/event-model.md:13` links to `/domain/leaderboard.md`). Spawned a
background task chip for this (task_599b6672) rather than doing it inline, since the
instruction scoped item 19 to `index.md` specifically.

## Verification summary

```
$ python -m ruff check .                                        # 2 pre-existing errors (see item 7), unrelated to this lane
$ go run honnef.co/go/tools/cmd/staticcheck@v0.8.1 ./...         # exit 0, clean
$ go test -coverprofile=coverage.out ./... && go tool cover -func=coverage.out | tail -1   # all pass, 51.3%
$ (cd scripts && python -m pytest . --cov=. --cov-report=term-missing)   # 21 passed, 1 pre-existing failure (unrelated, see item 8), 92% cov
$ (cd ingest && python -m pytest . --cov=. --cov-report=term-missing)    # 80 passed, 61% cov
$ (cd bench  && python -m pytest . --cov=. --cov-report=term-missing)   # 3 passed, 43% cov
$ (cd web && npm test -- --coverage)                             # 261 passed, 75.43% stmts
$ python -c "import yaml,sys; yaml.safe_load(open('.github/workflows/ci.yml'))"    # OK
$ python -c "import yaml,sys; yaml.safe_load(open('.github/workflows/okf.yml'))"   # OK (untouched, sanity check)
$ python -c "import yaml,sys; yaml.safe_load(open('.github/workflows/pages.yml'))" # OK (untouched, sanity check)
$ grep -rn "ux-evaluation-2026-07" .    # only FILE-MAP.md + untracked reviews/
```

All local coverage artifacts generated during verification (`bench/.coverage`,
`ingest/.coverage`, `scripts/.coverage`, `web/coverage/`) were deleted before finishing;
`.coverage` added to `.gitignore` so this doesn't recur for anyone else running the
suites locally.

## Files touched by this lane

- `.github/workflows/ci.yml` (modified)
- `pyproject.toml` (new)
- `.gitignore` (modified — added `.coverage`)
- `ingest/requirements-dev.txt` (modified — added `pytest-cov==7.1.0`)
- `web/package.json` (modified — added `@vitest/coverage-v8`)
- `web/package-lock.json` (modified — regenerated by `npm install`)
- `docs/ux-evaluation-2026-07.md` (deleted)
- `knowledge/index.md` (modified — 7 links fixed)
