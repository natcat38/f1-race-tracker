# Open-items sweep, 2026-11-02

Moved into this repo on 2026-11-09 from a local working folder. Most items concern f1; the rpg and
ember items are also recorded in those repos (rpg ADR-0023, ember ADR-0011).

Scope: every public repo owned by `natcat38`, from `gh repo list natcat38 --visibility public`. That covers rpg-build-optimizer, task-router, event-registration-app, ember, trip-planner, f1-race-tracker, invoicely, natcat38 and okf-portfolio-standard.

Open items exist in only three of them: f1-race-tracker, rpg-build-optimizer and ember. The other six have no open issues and no open PRs.

The Status column was written before acting. The Outcome section at the end records what actually happened.

## Root cause: why every f1 PR was red

The required "Dependency vulnerability scan" job runs govulncheck, then `npm audit --audit-level=high`, then `pip-audit`. It stops at the first failure. Two new advisories sat one behind the other:

1. **npm (`web/`)**: undici 8.0.0 to 8.12.1 (GHSA-4qv8-2p9j-2685 plus three more) and zod below 4.6.6 (GHSA-mrhx-c7xc-m3w5). Both are **high**.
2. **pip**: GHSA-j586-36cw-2gc2 on msgpack below 1.2.3. It hit the real floor (`msgpack>=1.2.1` allowed 1.2.1 and 1.2.2). It also hit the declared-but-never-installed `msgpack==1.1.2` that signalrcore carries (ADR-0007). It only surfaced once step 1 passed.

Correction to the UX-polish FINAL-REPORT: that report blamed vitest and minimatch. Both are **moderate**, below the `high` gate, and did not cause the failure.

## Triage list

| Repo | # | What it is | Proposed action | Status |
|---|---|---|---|---|
| f1 | 174 (new) | Fix PR: `npm audit fix` in `web/`, msgpack floor raised to 1.2.3, ghost-pin ignore extended, ADR-0007 update | Get green, squash-merge | planned |
| f1 | 173 | Docs: ADR-0011 (UX polish decisions) | Rebase after #174, merge | planned |
| f1 | 172 | Dependabot: golang 1.27.3 image digest refresh | Rebase after #174, merge if green | planned |
| f1 | 171 | Dependabot: Python 3.14 to 3.15 in `ingest/Dockerfile.live` only | **Close.** `ingest/requirements.txt` says ci.yml, Dockerfile.live and pyproject.toml move together. This PR moves one of three, so the container would run a Python that CI never tests. | planned |
| f1 | 170 | Dependabot: fastf1 3.8.3 to 3.9.0, numpy 2.5.4, pytest 9.2.0 | **Close.** fastf1 3.9.0 removes `fastf1.internals.f1auth` (imported at `ingest/f1tv_link.py:89`). It also changes the token from a raw JWT in `f1auth.json` to JSON in `f1auth_token.json` (read at `ingest/f1tv_auth.py:40-45`). CI is green only because that import is lazy. The fastf1 path forward goes to Natalie as decision D5. | planned |
| f1 | 164 | Dependabot: npm minor/patch group (10 updates, vitest 5.0.5, eslint 10.13.0) | Rebase after #174, merge if green | planned |
| f1 | 161 | Dependabot: go minor/patch (miniredis 2.40.0, go-redis 9.23.0) | Rebase after #174, merge if green | planned |
| f1 | 156 | Dependabot: msgpack `>=1.2.3` | **Close as superseded** by #174, which carries the same line, once #174's mergedAt is set | planned |
| f1 | 124 (issue) | Stale screenshots + missing `docs/Design_Direction.md` | Decision D1 | planned |
| f1 | 123 (issue) | 70 MB committed replay clips policy | Decision D2. **Never close.** | planned |
| f1 | 115 (issue) | Live-lane scrub control channel before WS3 | Decision D3 | planned |
| f1 | 103 (issue) | Gap-estimator gate failed on the Monza 2024 clip | **Close.** Re-ran it on current main with the local FastF1 cache. `python ingest/check_gap_estimator.py` printed PASSED, and `pytest -q check_gap_estimator.py` gave 1 passed. Monza 2024 `intMs` p95 is now 127 ms against the 600 ms gate, down from 87,450 ms when filed. Fixed by #169's lap-2 re-bake, merged 2026-10-23T18:41:07Z. | planned |
| rpg | 142 | Dependabot: minor/patch group, 17 updates | Rebase (requested), merge if green | planned |
| rpg | 134 | Dependabot: `@vercel/node` 12.0.3 to 24.0.3 (major) | Rebase after #142, merge if green. The package is a type-only import (`api/explain.ts:1`, `api/explain.test.ts:2`) and a devDependency, so typecheck plus the Vercel preview cover it. | planned |
| rpg | 100 (issue) | Re-express palette as OKLCH triplets | Decision D4 | planned |
| ember | 75 | Dependabot: vitest + @vitest/mocker 4.1.11 to 4.1.12 (security backport for the mocker advisories) | Rebase, merge if green. Every green push to ember main auto-deploys, which is expected here. | planned |
| ember | 76 | Dependabot: vite 8.3.2 to 8.3.5 | Rebase after #75, merge if green | planned |

## Decisions for Natalie

Each one is your call. The options are neutral and listed in no order of preference.

### D1. f1 #124: stale screenshots and `docs/Design_Direction.md`

1. **Reshoot the screenshots and write the design doc now.** The README then shows corner numbers, the heatmap, pedal traces and pit labels it already describes, and the last Plan-stage box gets checked. Cost: about an hour of your time for screenshots, since agents cannot take them for you here, plus a writing pass on the doc.
2. **Reshoot the screenshots only, and record the design doc as deferred** in ROADMAP.md. You fix the visible problem recruiters see first at the lowest cost. The Plan-stage box stays open with a written reason.
3. **Defer both, and add one README line saying the screenshots predate PR #94.** This costs nothing now. The README still under-shows the features, which is the problem the issue was raised for.

### D2. f1 #123: 70 MB of committed replay clips

1. **Keep the full clips and say so in `ingest/README.md`.** The demo stays fully offline with no extra step. The repo stays 70 MB, and one sentence turns "oversight" into "choice".
2. **Re-bake shorter lap windows** using `ingest/record.py --start-lap/--end-lap`, which already exists. The repo shrinks without new tooling. The replays get shorter, and every re-bake has to pass the gap-estimator gate again.
3. **Move the clips to Git LFS or a release-asset fetch script.** Clones become small and the full clips are kept. Anyone cloning needs an extra step, and the GitHub Pages demo build has to fetch the clips.

### D3. f1 #115: live-lane scrub before WS3

1. **Add a control channel to the Writer** (a Redis key or pub/sub topic next to `Events()`). Scrub then works on live and replay lanes. This is the most work, and it adds a second input path to `internal/app/writer.go`.
2. **Keep scrub client-only on the static demo, permanently**, and write that down as an accepted ADR. No new server code. Live and replay lanes never get pause or scrub.
3. **Write a "Proposed" ADR framing both, and decide when WS3 starts.** This is the step the repo's own grill pass recommended. Nothing gets built now, and WS3 opens with a ready document. The decision itself is only postponed.

### D4. rpg #100: palette as OKLCH triplets

1. **Do it as specified**: accent and seven element hues as OKLCH with one lightness formula, documented in `tailwind.config.js`. A future hue then needs no freehand picking. Each rendered color must be checked against the current one for drift.
2. **Document the formula only**, and convert a token the next time a color is added. No visual risk now. The tokens stay as hex until then.
3. **Close as won't-do**, with the reason recorded in an ADR. Nothing to maintain. The audit finding stays unaddressed, and the next hue is picked by hand.

### D5. f1: fastf1 3.9.0 breaks the F1TV operator link (found while triaging #170)

Context: ADR-0007 built the F1TV link on fastf1's `internals.f1auth`. Version 3.9.0 replaced it with `internals.f1account` and a new token file. The replay demo does not use auth and is unaffected. Only the beta live path breaks.

1. **Stay on fastf1 3.8.3**: add a dependabot ignore for `fastf1 >= 3.9`, and note it in ADR-0007. Nothing breaks. You miss fastf1 fixes, and the pin grows stale over time.
2. **Port `ingest/f1tv_auth.py` and `ingest/f1tv_link.py` to the 3.9 `f1account` API.** You stay current. It is real work, and like the rest of ADR-0007's last mile it cannot be fully verified without an F1TV subscription.
3. **Drop the F1TV live link** and keep the replay lanes only. This removes the internals dependency for good. You lose a feature the README and UI already describe as beta.

Until you pick one: the next weekly dependabot pip group will propose fastf1 3.9 again, along with the safe numpy and pytest bumps. Closing that group PR is right each time until D5 is settled.

## Your answers

- 2026-11-02, **D1 (f1 #124):** write `docs/Design_Direction.md` first. Once it is merged, reshoot the README screenshots and videos against it. Claude takes the screenshots and videos itself in the working session (as earlier f1 sessions did), not Natalie. The triage line "agents cannot take them for you here" was wrong.
- 2026-11-02, **D2 (f1 #123):** option 1. Keep the full committed clips, and state in `ingest/README.md` (plus an ADR) that this is a deliberate choice so the demo stays fully offline with no extra step. #123 can then be closed by the PR that records it, once its mergedAt is set (closing it is now Natalie's decision, not an agent's).
- 2026-11-02, **D3 (f1 #115):** option 2. Scrub stays client-only on the static demo, permanently; live and replay lanes get no pause or scrub. Record it as an accepted ADR; #115 closes with that PR once its mergedAt is set.
- 2026-11-02, **D4 (rpg #100):** option 1. Re-express the accent and seven element hues as OKLCH with one lightness formula, documented in `tailwind.config.js`. Check every rendered colour against the current one for drift (before/after screenshots, contrast kept at or above AA 4.5:1 where it applies). #100 closes with that PR once its mergedAt is set.
- 2026-11-02, **D5 (f1 fastf1 3.9):** option 2. Port `ingest/f1tv_auth.py` and `ingest/f1tv_link.py` to the fastf1 3.9 `internals.f1account` API and the new token file, then take the fastf1 3.9 bump (plus the safe numpy/pytest bumps from closed #170). Update ADR-0007. Known limit: the live F1TV path cannot be fully verified without a subscription, so unit-test the token parsing and state plainly in the PR what was not verified.

## Outcome

Every merge below was checked with `gh pr view <n> --json state,mergedAt` after it landed. All merges were squash merges. No `--admin` and no bypass.

### Merged

| Repo | # | What | mergedAt (UTC) |
|---|---|---|---|
| f1 | 174 | Scan fix: npm lockfile, msgpack `>=1.2.3`, ghost-pin ignore, ADR-0007 update | 2026-11-02T07:49:41Z |
| f1 | 173 | ADR-0011 (UX polish decisions) | 2026-11-02T07:52:54Z |
| f1 | 176 | ADR-0012 (this sweep's record) + ROADMAP Next up + FILE-MAP | 2026-11-02T07:57:32Z |
| f1 | 172 | golang image digest | 2026-11-02T08:00:54Z |
| f1 | 161 | go minor/patch group | 2026-11-02T08:04:30Z |
| f1 | 175 | npm minor/patch group (dependabot's replacement for #164, see below) | 2026-11-02T08:09:11Z |
| rpg | 142 | minor/patch group, 17 updates | 2026-11-02T07:53:28Z |
| rpg | 134 | `@vercel/node` 12.0.3 to **29.0.0** (the rebase moved it past the 24.0.3 in the title) | 2026-11-02T08:04:14Z |
| rpg | 144 | ADR-0022 + knowledge index + ROADMAP note + `.claude/worktrees/` in `.gitignore` | 2026-11-02T08:11:56Z |
| ember | 75 | vitest/@vitest/mocker 4.1.12 security backport | 2026-11-02T07:56:32Z |
| ember | 76 | vite 8.3.5 | 2026-11-02T08:03:45Z |
| ember | 82 | ADR-0011 (this sweep's record) | 2026-11-02T08:12:00Z |

f1 `main` CI was green after the last merge (run on `8b2d6a9`). ember's auto-deploy after #75 succeeded (`check` and `deploy` both green).

### Closed

| Repo | # | Reason (also posted as a comment) |
|---|---|---|
| f1 | 171 | Python 3.15 in one of three places that must move together |
| f1 | 170 | fastf1 3.9.0 breaks the F1TV link. This is decision D5. |
| f1 | 156 | Superseded by #174 (closed after #174's mergedAt was set) |
| f1 | 164 | Closed by dependabot itself ("updatable in another way") and replaced by #175, which merged |
| f1 | 103 (issue) | Gate passes on today's clip. Fixed by #169, mergedAt 2026-10-23T18:41:07Z. Evidence is in the closing comment. |

### Still open, on purpose

f1 #115, #123 and #124, and rpg #100. These are decisions D1 to D4 above. (Update 2026-11-09: all four are now closed by their PRs; see "Decisions D1 to D5: Outcome" below.) #123 must never be closed by an agent. D5 has no issue. It lives in ADR-0012 and in f1 `ROADMAP.md` Next up.

### Where each decision is recorded in the repo

- f1: `docs/adr/0007-…` (dated update: the msgpack floor and the second ignore ID) and `docs/adr/0012-open-items-sweep-2026-11-02.md` (scan root cause, why #156/#170/#171/#103 were closed, the fastf1 3.9 break). `ROADMAP.md` Next up drops #103 and adds the fastf1 3.9 decision.
- rpg: `docs/adr/0022-vercel-node-major-bump-type-only.md`, `knowledge/index.md`, plus a dated note in `ROADMAP.md`.
- ember: `docs/adr/0011-dependency-patches-2026-11-02.md`. The ROADMAP is unchanged because no roadmap item or stage moved.

### Things worth knowing that were not asked for

- **Moderate npm findings remain in f1 `web/`**: minimatch through eslint/typescript-eslint. `npm audit fix --force` would downgrade typescript-eslint, which is a breaking change. These sit below the `high` gate, so they do not block CI.
- **Your local f1 venv still has msgpack 1.2.1**, the vulnerable one. Run `pip install -r ingest/requirements.txt` from the f1 repo with the venv active to pick up 1.2.3. The F1TV live socket has not been re-run against 1.2.3 yet.
- **task-router `ui/src/components/RunInspector.tsx`** says the inspector is sticky "from `lg`", but the class is `xl:sticky`. The UX-polish report already flagged this. It has no issue or PR, so it was out of this sweep's scope.

## Cleanup

Done, one step per command:

- Worktrees removed: f1 `.claude/worktrees/npm-audit-fix`, rpg `.claude/worktrees/sweep-adr`, ember `.claude/worktrees/sweep-adr`. Each repo's `git worktree list` now shows only the main checkout.
- Local branches deleted: f1 `fix/npm-audit-high` and `docs/open-items-sweep-2026-11-02`, plus rpg and ember `docs/open-items-sweep-2026-11-02`.
- Remote branches: rpg and ember auto-deleted on merge. In f1 both were deleted with `git push origin --delete`, since f1 does not auto-delete.
- Scratch: all 11 logs in the session scratchpad deleted. No scripts, containers or volumes were created. The f1 main checkout is clean after the gap-gate run. The ember main checkout and your Docker volumes were not touched.

Nothing was denied, so there are no manual commands to run.

## Decisions D1 to D5: Outcome (implemented 2026-11-03 to 2026-11-09)

Each PR was rebased onto `main`, passed CI, and squash-merged. Each merge was checked with `gh pr view <n> --json state,mergedAt` before it was reported. No `--admin`, no bypass. Each issue was closed by its own PR's merge, after mergedAt was set.

| Decision | Repo | PR | What landed | mergedAt (UTC) | Issue |
|---|---|---|---|---|---|
| D1 (part 1) | f1 | 177 | `docs/Design_Direction.md`, written from the shipped app; last Plan-stage box ticked | 2026-11-02T20:06:24Z | — |
| D2 | f1 | 178 | ADR-0013: the three replay clips (about 70.6 MB) stay committed in full; `ingest/README.md` says why | 2026-11-02T20:13:50Z | #123 closed |
| D3 | f1 | 179 | ADR-0014: scrub stays client-only on the static demo, permanently; WS3's server-paced scrub dropped | 2026-11-09T06:49:02Z | #115 closed |
| D1 (part 2) | f1 | 180 | README reshoot against the design doc: new board hero and overlay, plus a track-map GIF, the telemetry compare and the strategy timeline. Shot by Claude from the live Pages demo; every image checked by eye | 2026-11-09T06:52:04Z | #124 closed |
| D5 | f1 | 187 | F1TV link ported to fastf1 3.9 `internals.f1account` and `f1auth_token.json`; fastf1 3.9.0, numpy 2.5.4, pytest 9.2.0; 23 token-parsing tests; ADR-0007 update. `main` CI green on `347b31d` | 2026-11-09T06:56:35Z | — (no issue) |
| D4 | rpg | 150 | ADR-0023: accent and seven element hues authored as OKLCH on four shared lightness rungs in `tailwind.config.js`; max drift deltaE 1.25; no text pair below 4.5:1 | 2026-11-09T07:00:10Z | #100 closed |

### Where each decision is recorded in the repo

- f1: `docs/Design_Direction.md`, `docs/adr/0013-replay-clips-stay-committed.md`, `docs/adr/0014-scrub-stays-client-only-on-the-static-demo.md`, `docs/adr/0007-…` (dated 2026-11-03 update). `ROADMAP.md` Next up now reads: ADR-0010 accept/reject, then `/simplify`, then `/repo-review`.
- rpg: `docs/adr/0023-palette-as-oklch-triplets.md`, `knowledge/index.md`, `docs/design-system.md`, and a dated note in `ROADMAP.md` (still Define; no stage change).

### What was not verified

- **D5:** no live F1 call was made, and no credentials were entered or invented. Whether the 3.9 browser sign-in completes, and whether the live socket accepts a 3.9 token, need a real F1TV subscription. fastf1 3.9 refuses a login with no subscription token, so a free account may no longer link. After pulling, an operator must run `python ingest/f1tv_link.py` once to create the new token file.
- **D1:** the shots come from the static Pages demo, not the full Docker stack (Docker Desktop was not running). The board shows the static demo's "How this runs" link instead of the gear.
- **D4:** `public/favicon.svg` and `docs/brand/og-card.html` (and the `og.png` and PNG icons rendered from them) keep the old accent `#f2b64c`, a 1.13 deltaE difference. ADR-0023 records this.

### Things worth knowing that were not asked for

- Six new dependabot PRs opened on f1 while this ran (#181 to #186). They are untouched. #182 (pip minor/patch group) was opened against the pre-D5 requirements, so it needs a rebase and a recheck now that fastf1 3.9 is in.
- One README claim was wrong: each pit stop's duration is in the tick's tooltip, not printed on the timeline. The README and the design doc now say so (#180).
- The commit/push security-review hook hit HTTP 429 twice during this work. Details: `C:\Users\natal\.claude\security\log.txt`.

## Follow-up, 2026-11-09: new f1 dependabot PRs and stale folders

Merged (squash, each verified with `gh pr view --json state,mergedAt`):

| # | What | mergedAt (UTC) |
|---|---|---|
| 183 | msgpack floor `>=1.2.4` | 2026-11-09T07:09:05Z |
| 188 | fastf1 3.9.0 → 3.9.2, signalrcore 1.0.2 → 1.0.4 (replaced #182) | 2026-11-09T07:11:56Z |
| 186 | golang image digest | 2026-11-09T07:14:47Z |
| 181 | okf-portfolio-standard action pin | 2026-11-09T07:17:37Z |
| 184 | npm minor/patch group (5 dev deps) | 2026-11-09T07:20:28Z |
| 185 | jsdom 30 → 31 (dev only). Its first "Docs link check" failed while downloading the lychee binary (exit 22, infra), so it was rerun once and passed | 2026-11-09T07:26:23Z |

f1 now has no open PRs.

Stale folders: ten `agent-*` folders in `f1-race-tracker\.claude\worktrees\` (Aug–Sep 2026, about 560 MB, no `.git`, not registered worktrees). The tool blocked deleting them, so Natalie runs:

```powershell
Get-ChildItem C:\Users\natal\Documents\Coding\f1-race-tracker\.claude\worktrees -Directory -Filter 'agent-*' | Remove-Item -Recurse -Force
```
