# Web Interface Guidelines Audit — F1 Race Tracker frontend

Scope: every `web/src/**/*.tsx` component (excluding `*.test.tsx`), every `web/src/styles/**/*.css` file, and `web/index.html`. Read in full: `App.tsx`, `ErrorBoundary.tsx`, `main.tsx`, and all of `components/*.tsx` (Map, TimingTower, TelemetryPanel, StintChart, Comms, RaceControl, Ghost, StatusRail, StatusBadge, SegmentedControl, SourceToggle, Settings, Panel, Route, StaticDemoNotice, TrackPath), plus `components/timingHelpers.ts`, `hooks/useReducedMotion.ts`, and `hooks/useSmoothedCars.ts` for the animation/formatting logic they back. `web/index.html`, `styles/tokens.css` and `styles/components.css` (1766 lines) were read in full/by targeted section.

**Overall**: this is an unusually accessibility- and interface-guideline-conscious codebase — most items on the checklist are already handled, and many inline comments show the team explicitly reasoning through WCAG/interface-guideline tradeoffs (roving tabindex, `prefers-reduced-motion`, contrast ratios computed by relative luminance, etc.). Findings below are the residual gaps, not a wholesale critique.

---

## High severity

None found. No icon-only buttons lack `aria-label`, no `<div onClick>` standing in for a button/link, no unlabelled form controls, no `outline: none` without a focus-visible replacement, no `transition: all`, no blocked paste, no zoom-disabling viewport meta, and no unvirtualized large lists (the ~20-row driver field is explicitly exempted, see Notes below).

---

## Medium severity

1. **Native `<select>` in the rival picker has no explicit `background-color`** — `web/src/components/TelemetryPanel.tsx:177` (`className="btn"`) resolves to `.btn` in `web/src/styles/components.css:521-536`, which sets `background: transparent`. The Ghost overlay's own pickers use `.overlay-select` (`components.css:903-912`), which sets an explicit `background: var(--asphalt); color: var(--chalk);` — the pattern the Windows-dark-mode guideline calls for. The rival `<select>` relies on `:root`'s `color-scheme: dark` (tokens.css:4) plus a transparent background, so on Windows/Chromium the closed control paints correctly, but this is inconsistent with the other `<select>` in the app and is one theme/browser change away from a light popup on a dark row. Reuse `.overlay-select` (or give `.btn` an explicit background) for `TelemetryPanel`'s select.

2. **Progress-style `<Bar>` readouts (Throttle/Brake) carry no ARIA role or value** — `web/src/components/TelemetryPanel.tsx:13-26`. The numeric value is exposed as adjacent text (`<span className="tele-value">{value}</span>`), so it is not undiscoverable, but a screen-reader user gets three disconnected pieces of text (`Throttle`, a decorative div, `73`) instead of one readable "Throttle 73%" unit. Adding `role="meter"`/`aria-valuenow`/`aria-valuemin`/`aria-valuemax` (or grouping label+bar+value under one `aria-label`) would make this an actual accessible readout rather than an incidental one.

3. **Hardcoded time/number formatting instead of `Intl.*`** — `web/src/components/timingHelpers.ts` (`fmtLap`, `fmtSec`, `fmtGap`, `fmtGapEstimate`, `fmtClock`, `fmtSigned`, `fmtLongGap`, all ~lines 7-105) hand-format every time value with manual `padStart`/division rather than `Intl.NumberFormat`/`Intl.DurationFormat`. This is very likely deliberate — motorsport timing has one universal broadcast format (`m:ss.SSS`) that is not meant to localize — but it is a literal violation of the "use `Intl.*`, not hardcoded formats" rule as written, and worth a one-line note in the file if the maintainers want to preempt future churn. Not flagging the tyre/gap labels (`+N LAPS`, `LEADER`) since those are domain vocabulary, not locale-sensitive numbers.

---

## Low severity

4. **`StintChart` stint segments rely on `title` for the compound/lap-range detail, duplicated into `aria-label`** — `web/src/components/StintChart.tsx:51-56`. This is already correctly mirrored into `aria-label` for assistive tech, so it's compliant; flagging only that the `title` half is still mouse/hover-only for sighted users (no on-screen text equivalent for a sighted keyboard/touch user who can't hover a 10px-tall bar). Given the segment's color plus the shared legend below it, this is a minor/optional enhancement, not a defect.

5. **`RaceControl`'s "(CODE)" driver tag and wall-clock suffix are inline `<span>` with only color for the category label** — `web/src/components/RaceControl.tsx:62-64`. `cat.colour` (amber/good/chalk/slate) is the only visual distinguisher between category kinds (FLAG vs DRS vs CAR vs NOTE) since the `cat.label` text itself already differs, so this is not a color-only-conveys-meaning violation — noting it only because it sits close to the line and is worth a glance if a future category label collision is introduced (e.g. two categories both rendering "NOTE").

6. **`Settings.tsx`'s `Cmd` copy-to-clipboard control gives no `aria-live` failure feedback** — `web/src/components/Settings.tsx:20-39`. Success is announced by the button's own label changing to "✓ copied" (readable on focus/re-query, fine), but a `catch` block that fails (e.g. clipboard permission denied in an insecure context) silently resets `copied` to `false` with no error surfaced to the user at all, sighted or otherwise. A one-line inline error (mirroring the `Comms`/`SourceToggle` `role="status"` pattern already used elsewhere in this codebase, e.g. `Comms.tsx:116-118`) would close the gap.

7. **`Ghost.tsx`'s scrub `<input type="range">` has no visible tick marks or step labels beyond the numeric `aria-valuetext`** — `web/src/components/Ghost.tsx:358-371`. Functionally fine (labelled, keyboard-operable, `aria-valuetext` correctly overrides the raw ms value), just noting there's no way to jump to a specific sector/point without dragging — a nice-to-have, not a defect.

8. **No `<link rel="preconnect">` for the WebSocket/gateway origin** — `web/index.html`. The socket connection (`realtime/socket.ts`) and static-replay clip fetch are same-origin/relative in the deployed setups reviewed, so this is unlikely to matter in practice, but if the gateway ever moves to a distinct origin, a `preconnect` hint would shave connection setup time off the first frame.

---

## Compliant / notable good patterns

- **`prefers-reduced-motion` is genuinely wired through, not just declared.** `hooks/useReducedMotion.ts` uses `useSyncExternalStore` against a live media-query subscription (not a one-time read), and both places motion is driven from JS — `useSmoothedCars.ts` (map marker interpolation) and `Ghost.tsx`'s rAF playback loop — check it and fall back to static/scrub-only rendering. CSS-driven entrance animation is separately gated behind `@media (prefers-reduced-motion: no-preference)` (`components.css:994`).
- **Roving-tabindex radiogroups done correctly** in `SegmentedControl.tsx` and the 20-row `TimingTower` (`components/TimingTower.tsx:154-182`): one tab stop, Arrow/Home/End move focus, and the focused driver is tracked by driver number (not row index) so it survives the table's live re-sorting at 10 Hz — a subtlety most timing UIs get wrong.
- **Every icon-only button carries `aria-label`** (`Comms.tsx:55,90`, `Settings.tsx:34`), decorative glyphs are `aria-hidden="true"` throughout (e.g. `StatusRail.tsx:101,132,145`), and live regions are scoped deliberately — `RaceControl` is `aria-live="polite"` because it's genuinely low-frequency, while the 10 Hz timing tower is explicitly kept out of any live region (commented rationale at `TimingTower.tsx` and `StatusRail.tsx:166-170`) to avoid a screen-reader announcement storm.
- **Color is never the sole signal.** Sector bests get an `S`/`P` glyph in addition to purple/green (`TimingTower.tsx:322-326`), sparkline "slower" bars get a hatch pattern in addition to red (`TelemetryPanel.tsx:58-66`), and the Ghost overlay tells its two cars apart by solid-vs-dashed ring rather than opacity alone (`Ghost.tsx:390-402`, with an explicit comment about the contrast-ratio failure of the old opacity-only approach).
- **`font-variant-numeric: tabular-nums`** is set globally on `body` (`tokens.css:172`), so every timing/lap-time column in `TimingTower`, `TelemetryPanel`, `RaceControl`, and `StintChart` gets it for free without per-component overrides.
- **Contrast ratios are computed and documented, not eyeballed** — nearly every color token in `tokens.css` carries a measured WCAG ratio in its comment (e.g. `--dim` raised from 2.40:1 to 4.8:1, `--tyre-soft` at 5.45:1), and several components document a specific prior failure that was fixed (Map.tsx's pit-lane opacity, TelemetryPanel's DRS-off color).
- **URL-as-state is deep and correct**, not just present: `App.tsx` syncs the selected car via `replaceState` (never `pushState`, so clicking through 20 tower rows doesn't pollute history), `Ghost.tsx` syncs both overlay sides the same way, and both guard against clobbering the other route's hash.
- **`React.memo` used with a real, narrow comparator** in `StintChart.tsx:122-128` (`sameRunningOrder`, not a shallow `state` compare) so the full per-driver stint layout isn't recomputed on every 10 Hz frame — an actual perf-motivated memoization rather than a reflexive one.
- **Touch targets are handled via a scoped `@media (pointer: coarse)` block** (`components.css:1122-1160+`) that raises buttons/rows/range-input hit areas to 44px only on coarse pointers, explicitly to avoid bloating the dense desktop table — a correct reading of the guideline's intent rather than a blanket `min-height: 44px` everywhere.
- **`<title>`/`document.title` and social-preview meta are all present and correct** in `index.html` and set per-route via `Route.tsx:32`.
