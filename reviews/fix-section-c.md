# Section C (discoverability & consistency) — fixes applied

Branch: `uiux-audit-fixes`. Builds on Sections A and B. Not committed.

## 1. Ghost overlay undiscoverable from the board (item 2, Nielsen #6)

Added a one-line link, `Compare laps in the overlay →`, to `TimingTower.tsx` as a
new `tt-note` row after the tyre legend, using the existing `.demo-notice-link`
text-link idiom and pointing at `#ghost` (the overlay's real route name).
No coach marks, always visible, costs one row.

- `web/src/components/TimingTower.tsx`

## 2. Deep links have no UI (item 6, Nielsen #7)

Extracted the copy-button + success/failure live-region pattern that used to be
private to `Settings.tsx`'s `Cmd` into a new shared component, `CopyButton`
(`web/src/components/CopyButton.tsx`). `Settings.tsx` now uses it internally
(behaviour unchanged). Added:

- **Board**: a "Copy link" button next to "Clear reference car" in
  `TimingTower.tsx`'s reference-car hint — visible only when a car is selected,
  copying `location.href` (already kept in sync with `?car=` by `App.tsx`'s
  existing `replaceState` effect).
- **Overlay**: a "Copy link" button in `Ghost.tsx`'s Controls panel, copying
  `location.href` (kept in sync with `?a=`/`?b=` by the existing effect there).

Both reuse the same catch/live-region feedback path, so failure is reported the
same way everywhere instead of failing silently.

- `web/src/components/CopyButton.tsx` (new)
- `web/src/components/Settings.tsx`
- `web/src/components/TimingTower.tsx`
- `web/src/components/Ghost.tsx`

## 3. Zone D separation between Lane and Freeze/Resume (item 10, Gestalt common region)

CSS-only. Added a hairline + extra left padding on the bare `.btn` that follows
the segmented-control wrapper inside `.rail-controls`, so the transport verb
reads as a separate object from the abutted Lane segments instead of one
five-part control. No JSX changes.

- `web/src/styles/components.css` (`.rail-controls > .rail-segmented ~ .btn`)

## 4. Rival `<select>` used `.btn` (transparent background) (item 11, Nielsen #4)

Switched `TelemetryPanel.tsx`'s rival `<select>` from `className="btn"` to
`className="overlay-select"` — the same idiom the overlay's pickers already use,
with an explicit `background`/`color` instead of inheriting through
transparency.

- `web/src/components/TelemetryPanel.tsx`

## 5. Tyre legend formatted differently in Tower vs StintChart (item 12, Nielsen #4 / 1.4.1 risk)

Extracted the glyph-prefixed compound list (`S Soft`, `M Medium`, …) into one
shared constant, `TYRE_LEGEND`, in `timingHelpers.ts`. Both `TimingTower.tsx`
and `StintChart.tsx` now render their legend from it, so `StintChart`'s legend
gained the leading glyph it previously lacked (the non-colour signal 1.4.1
needs). Did not add the S/P session/personal-best note to `StintChart` — that
mark comes from sector-best data the stint chart doesn't have, so it isn't a
drift case, just a different signal that doesn't apply there.

- `web/src/components/timingHelpers.ts`
- `web/src/components/TimingTower.tsx`
- `web/src/components/StintChart.tsx`

## 6. `timingHelpers.ts` and `Intl` (item 14d)

Added a one-line file-header comment noting broadcast timing is a fixed,
locale-invariant wire format, so `Intl.*` is intentionally not used.

- `web/src/components/timingHelpers.ts`

## Verification

- `npm test -- --run`: 269/269 passed (23 files). Pre-existing jsdom
  `HTMLMediaElement.prototype.pause` warnings in `useComms` tests are unrelated
  and unchanged by this work.
- `npm run lint`: clean, no errors or warnings.
