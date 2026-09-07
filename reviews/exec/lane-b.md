# Lane B execution report (wave 1)

Branch: `cleanup/verified-backlog` (pre-existing checkout, no commits made per
instructions). Source: `reviews/plans/verified-cleanup-backlog.md` items 14,
15, 16, 20, 21.

## #14 — Delete the dead `--onair` token

Grepped `web/` for `var(--onair)` (zero hits) and `--onair\b` (definition +
`--onair-rgb` + one comment). Confirmed only `--onair-rgb` is actually
referenced (`components.css` `.chip-live` background).

- Deleted the `--onair` definition (2 lines) from `web/src/styles/tokens.css`.
- Fixed the one stale comment in `web/src/styles/components.css` (`.chip-live`)
  that named `--onair` by hex-value description — reworded to `--onair-rgb`,
  the token actually in use, so the comment doesn't reference a token that no
  longer exists.

## #15 — Inline `useLapHistory`/`useGapHistory`

Confirmed one call site each, both in `web/src/App.tsx`, both literal
one-line wrappers around `useRollingHistory`.

- `App.tsx`: replaced the two hook imports with a direct
  `useRollingHistory` import plus `updateLapHistory`/`updateGapHistory` from
  `components/timingHelpers`; call sites now read
  `useRollingHistory(state, {}, updateLapHistory)` /
  `useRollingHistory(state, {}, updateGapHistory)`.
- Deleted `web/src/hooks/useLapHistory.ts` and `web/src/hooks/useGapHistory.ts`.
- Updated the stale doc comment in `useRollingHistory.ts` that referenced the
  two hooks by name (they no longer exist as separate files).
- Grepped afterward: no remaining references to either hook name outside this
  report and git history.

## #16 — Export `Msg` from `race.ts`

- `web/src/state/race.ts`: `type Msg = ...` to `export type Msg = ...`
  (~line 76).
- `web/src/realtime/staticReplay.ts`: dropped the local
  `type Msg = NonNullable<ReturnType<typeof parseMsg>>` alias and its
  explanatory comment; imports `type Msg` from `../state/race` directly instead.

## #21 — Ghost overlay copy (vocabulary fix, CONTEXT.md-enforced)

`web/src/components/Ghost.tsx` ~line 265: the `StatusRail` note read
`` `${labelA} solid vs ${labelB} ghost · each driver's fastest lap` ``, i.e.
renderer-vocabulary ("solid"/"ghost") baked into user-facing copy. Reworded to
`` `${labelA} vs ${labelB} · each driver's fastest lap` `` — the two session/
driver labels already identify side A and side B, the solid/translucent
distinction is visible on the map itself, and the copy no longer needs
renderer words to say what's being compared. Grepped for any test/string
dependency on the old exact copy — none found.

Left alone: the `SourcePicker` labels `"A (solid)"` / `"B (ghost)"` a few
lines below (~272, ~281) — not in scope (item 21 named line ~265 only), and
those are compact picker labels rather than the flagged prose note.

## #20 — Timing tower row rhythm

`web/src/styles/components.css`, `.tt-table th, .tt-table td` (~658):

- Padding: `var(--sp-0) var(--sp-1)` (2px/4px) → `var(--sp-1) var(--sp-1)`
  (4px/4px) — one step up the existing spacing scale, vertical only in
  effect since horizontal was already `--sp-1`.
- Added `border-bottom: 1px solid var(--edge)` — the same token and value the
  mobile card layout already uses for its own inter-row hairline
  (`.tt-row` in the `@container` mobile block, ~line 1311), so desktop rows
  now get the equivalent treatment. No new color token introduced.
- Did NOT build a re-render throttle — per the plan, that half of the
  original claim was never traced and is out of scope for this item.
- Kept it a rhythm tweak: no column/layout changes, table stays as dense as
  before modulo the 2px of extra vertical breathing room.

## Verification

Run from `web/`:

```
npm run test    # vitest run
npm run build   # tsc -b && vite build
npm run lint    # eslint .
```

Results:

- `npm run test` → **20 test files passed, 261 tests passed** (8.02s).
- `npm run build` → `tsc -b` clean (no type errors), `vite build` succeeded
  (57 modules transformed, output written to `dist/`).
- `npm run lint` → clean, no errors/warnings.

No dev server started and no browser/visual checks performed, per instructions
— a later wave handles visual verification (this matters most for #20's CSS
change and #21's copy change).

## Left alone / out of scope

- Items 1–13, 17–19, 22 (Lane A / other lanes' scope, other files already
  showed as modified in the working tree from prior lane work — not touched
  here).
- `SourcePicker` "(solid)"/"(ghost)" labels in `Ghost.tsx` (see #21 above).
- No new dependencies added; no commits made; no branch created (used the
  existing `cleanup/verified-backlog` checkout as instructed).
