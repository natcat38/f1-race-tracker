# Section A (WCAG conformance) fixes

Implements items 1, 5a, 5b, 13b from `reviews/uiux-validation.md`.

## 1. Comms driver codes in raw team hex (1.4.3 AA)

`web/src/components/Comms.tsx` — `colourFor` result is no longer used as the
driver-code text colour (AlphaTauri measured 1.97:1 on `--asphalt`, 1.82:1 on
`--carbon`, both under 4.5:1). Codes now render in `--chalk` with the team
colour moved to a 3px `border-left` accent, matching the constructor-rule
pattern already used in `TimingTower.tsx` / `components.css:724-728`. Applied
to both the now-playing banner (`:47`) and the history rows (`:79`).
`Comms.render.test.tsx` made no colour assertions, so it needed no changes.

## 2. Sparkline aria-label omits the trend (1.1.1 A)

`web/src/components/TelemetryPanel.tsx` — added a `trendSummary` helper that
reduces the known series to a direction (rising/falling/flat), lap count, and
min-max range, appended to the existing `"CODE lap/gap trend"` label. A
screen-reader user now gets the same shape of information the bars convey
visually, not just the final value that was already in adjacent text.

## 3. Throttle/Brake bars lack `role="meter"` (WIG best practice)

`TelemetryPanel.tsx` `Bar` component — the track div now carries
`role="meter"`, `aria-valuenow`/`aria-valuemin={0}`/`aria-valuemax={100}`, and
an `aria-label` combining the label and value (e.g. "Throttle 73%"), so
label + bar + value read as one unit. No WCAG SC applies here (label/value are
already real text), per the validation's correction — this is a best-practice
improvement only.

## 4. `.tt-select` under 24x24 at pointer:fine (2.5.8 AA)

`web/src/styles/components.css` — `.tt-select` gains `min-width`/`min-height:
24px` plus `margin-block: -3px` and `display: inline-flex` so the enlarged hit
area is absorbed inward (same idea as the existing inward focus-ring
technique) instead of growing the row height or column width. Comment cites
2.5.8 Target Size (Minimum), AA, and that the row itself is not an accessible
fallback target.

## Verification

- `npm test -- --run`: 23 files / 269 tests passed (pre-existing jsdom
  `HTMLMediaElement.pause` "not implemented" warnings in `useComms` teardown
  are unrelated console noise, not failures).
- `npm run lint`: clean, no errors.

No commits made per instructions.
