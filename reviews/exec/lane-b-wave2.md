# Lane B execution report (wave 2)

Branch: `cleanup/verified-backlog` (pre-existing checkout, no commits made per
instructions). Source: `reviews/plans/verified-cleanup-backlog.md` items 5, 22.
Scope: `web/**` only — no other lane's files touched (confirmed via
`git status` before/after).

## #5 — jsdom render/interaction testing

Verified state matched the brief: no `jsdom` or `@testing-library/react` in
`web/package.json`; all 8 existing render tests used `renderToStaticMarkup`
(node environment), which never runs effects, `React.memo`, or interaction.
`Map.tsx` and `TelemetryPanel.tsx` had zero render tests.

- Added `jsdom@^30.0.1` and `@testing-library/react@^16.3.3` as devDependencies.
  Did not add `@testing-library/user-event` — `fireEvent` from
  `@testing-library/react` was sufficient for the one interaction (a `<select>`
  change event) and `jest-dom` was not added either — the tests use plain
  `expect(...).toBeNull()` / `.not.toBeNull()` instead of `toBeInTheDocument()`,
  since jest-dom's matchers aren't installed and weren't worth adding for two
  call sites.
- No vitest environment config needed: the existing suite has no `test.environment`
  set anywhere (default is `node`), so a per-file `// @vitest-environment jsdom`
  docblock on just the new files opts them into jsdom without touching the 20
  existing (fast, node-environment) SSR tests.
- New files:
  - `web/src/components/Map.interaction.test.tsx` — 3 tests. Covers: (1) a
    paused map never calls `requestAnimationFrame` (the interpolation loop in
    `useSmoothedCars` genuinely stops, not just visually settles), (2) an
    unpaused map does call it, (3) a new frame's car position reaches the
    rendered `<circle>` (state reactivity through the effect that snapshots
    `state.rev`).
  - `web/src/components/TelemetryPanel.interaction.test.tsx` — 2 tests.
    Covers picking a rival from the "Compare with" `<select>` via a small
    stateful harness (the component is controlled: `rival`/`onRivalChange` are
    props) and asserting the rival's own telemetry (a different speed value)
    actually renders — this exercises the `Number(e.target.value)` string→key
    coercion into `state.cars`, which a snapshot/SSR test can't reach because
    nothing fires the change event. A second test covers clearing the
    selection back out.
- Reused the existing fixtures rather than inventing new ones: `car()` from
  `state/testCar.ts` and `emptyState()` from `state/race.ts`, same as
  `Ghost.render.test.tsx`.
- Five tests total across the two files, all interaction/effect-focused per
  the brief (no prop-mirroring, no snapshots).
- Gotcha hit and fixed: `@testing-library/react`'s automatic `afterEach`
  cleanup only registers itself when a global `afterEach` exists (this repo
  imports test globals explicitly rather than using vitest's `globals: true`),
  so every new jsdom file calls `afterEach(cleanup)` itself. Without it,
  components from a previous test stayed mounted into the next one — first
  seen as a `getByLabelText` "found multiple elements" failure, and in the Map
  file it also meant a real `requestAnimationFrame` loop kept rescheduling
  itself past the end of its test.

## #22 — static demo (and live) connect on routes that don't need it

### Step A — measured

Baked clip: `web/public/static-demo/monza-2024-race.ndjson`.

| | bytes | ~size |
|---|---|---|
| raw | 24,249,001 | 23.1 MiB |
| gzip -9 | 918,561 | 897 KiB |
| brotli -q11 | 509,480 | 497 KiB |

NDJSON compresses hard (repeated keys, similar numeric shapes), so the
over-the-wire cost is roughly **1/25th to 1/48th** of the on-disk figure quoted
in the plan. GitHub Pages (Fastly) serves pre-compressed static assets, so a
real visitor pays close to the gzip number, not the raw one.

**Judgement: still worth doing.** ~0.5–0.9 MB is not the "24 MB" scare number,
but it's also not nothing — a `#ghost` or `#settings` deep link on mobile still
silently pulls the entire clip today, every single time, for zero benefit. The
fix (Step B) turned out to be a genuinely small diff (two refs, restructure one
effect, one extra one-line effect) — cheaper than the download it avoids, which
is the test the brief asked to apply. Implemented.

### Step B — lazy-connect-once + keep-alive

`web/src/App.tsx`: the mount effect (previously `useEffect(..., [])`, unconditional)
now:

- reads `routeName = parseHash(hash).route` before the effect (parseHash is a
  pure, cheap function — already imported — so this is a second call per
  render rather than reordering the larger `route`/`carParam`/`overlayA`/
  `overlayB` destructure that a lot of code below depends on);
- only connects the first time `routeName === 'board'`, guarded by a
  `connectedRef` so it can never fire twice;
- stores the disposer in a `disconnectRef` instead of returning it as the
  effect's own cleanup;
- a second `useEffect(() => () => disconnectRef.current(), [])` (empty deps)
  is the only thing that ever calls the disposer, and only on real unmount.

This applies identically to `connectRace` (live/docker build) and
`connectStaticReplay` (static demo) — both are selected by the same
`STATIC_DEMO ? ... : ...` line, untouched. A user who deep-links to `#ghost` or
`#settings` and never visits the board never opens a socket or fetches the
clip, in both builds. Marked the two-ref/two-effect shape with a `// ponytail:`
comment naming the ceiling (this solves the one lazy-connect-once case, not a
general connection-lifecycle manager) since a naive read might expect a single
effect to do this.

New test: `web/src/App.test.tsx`, jsdom, 2 tests. `connectRace` is mocked at
the module level; `Ghost` is stubbed out (it owns independent per-session lane
connections via `useLane`/`subscribeLane`, which also call `connectRace` with a
session argument — irrelevant to the App-level bug, so the assertions filter
to calls where the third `session` argument is `undefined`, which is the
board's own connection signature). Covers:
- `board -> ghost -> board` connects exactly once (the actual regression: the
  naive per-route-gate fix would reconnect/re-fetch on every nav back).
- deep-linking straight to `#ghost` never opens the board connection at all,
  until the board is actually shown.

## Gotcha: an unwanted `@vitest/coverage-v8` devDependency

`npm install -D jsdom @testing-library/react` also auto-added
`@vitest/coverage-v8@^4.1.11` to `package.json`/`package-lock.json` — npm
auto-installing one of vitest's optional peer dependencies during the
re-resolution, not something I asked for. Coverage measurement is plan item 8
(a different, unassigned lane/PR), so this was out of scope here; removed it
with `npm uninstall @vitest/coverage-v8` before finishing. `vitest` itself
stayed pinned by range (`^4.1.10`) but its *resolved* lockfile version moved
4.1.10 → 4.1.11 (a patch bump) as a side effect of the same re-resolution —
left as-is since it's within the existing declared range and not a new
`package.json` entry.

One transient failure worth recording so it isn't rediscovered as a real bug:
the very first two `npm run test` runs (with `@vitest/coverage-v8` still
present) failed to even start worker processes for the three new jsdom files
("Timeout waiting for worker to respond") and one unrelated existing SSR test
(`staticDemoGating.render.test.tsx`) timed out — both symptoms disappeared
immediately after removing the stray `@vitest/coverage-v8` dependency and
never reappeared across several subsequent full runs, so it reads as
resource/worker-pool contention from that unwanted extra package rather than
anything in the new test files or the App.tsx change.

## Verification

Run from `web/`:

```
npm run test    # vitest run
npm run build   # tsc -b && vite build
npm run lint    # eslint .
```

Results:

- `npm run test` → **23 test files passed, 268 tests passed** (~7–20s
  depending on cold/warm transform cache). The 5 new interaction tests + 2 new
  App-level tests are additive to wave 1's 20 files / 261 tests.
- `npm run build` → `tsc -b` clean, `vite build` succeeded (57 modules
  transformed).
- `npm run lint` → clean, no errors/warnings.

No dev server started, no browser/visual checks performed, per instructions —
the main session handles browser verification for anything visual (this wave
has no visual changes; #22 is a data-fetch-timing fix only).

## CI note

`web`'s `npm run test` already runs whatever CI already calls (per the task
brief's own guidance to check this first) — the new test files match the
existing `*.test.ts(x)` glob vitest already picks up, and no `environmentMatchGlobs`
or global config change was needed. **No CI workflow edit is needed** for
these new tests to run.

## Left alone / out of scope

- `@vitest/coverage-v8` — removed after npm added it unprompted (see gotcha
  above); item 8 (coverage measurement) is a different, unassigned lane.
- `@testing-library/user-event` and `@testing-library/jest-dom` — not added;
  not needed for the tests written.
- Items 1–4, 6–21 — other lanes'/waves' scope.
