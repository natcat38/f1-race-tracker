# Web Interface Guidelines audit — PR #94 (verified peer-comparison features)

Method: `web-design-guidelines` skill (Vercel Web Interface Guidelines, fetched fresh from
`vercel-labs/web-interface-guidelines`), static read-through only, no live browser.

Scope: only what commit `d39a9a1` (#94) touched — `App.tsx` (static-demo pause/scrub
transport), `realtime/staticReplay.ts` (pause/resume/scrub control surface),
`components/TelemetryPanel.tsx` (throttle/brake/gear distance traces),
`components/StintChart.tsx` (pit-stop duration ticks), `components/Map.tsx` +
`TrackPath.tsx` + `geometry.ts` (corner numbers, start/finish line, sector-dominance
heatmap), plus the `components.css` classes those files reach for. Everything else in
the board was audited and fixed under PR #93 (`reviews/uiux-wig.md`,
`uiux-validation.md`) and is not re-reviewed here except where #94's diff touches a
shared class those findings already cover.

**Counts: 3 High, 3 Medium, 1 Low.**

---

## High

### H1 — Replay-elapsed `<span>` reuses the hero session-clock class
`web/src/App.tsx:362` — `<span className="rail-clock">{fmtElapsed(replayTMs)}</span>`.
`.rail-clock` (`web/src/styles/components.css:315-324`, `--fs-hero`, reduced to
`--fs-2xl` under the two narrower rail breakpoints) is reserved for the one primary
session clock in the rail — the number the whole broadcast-style chrome is built
around (see the class's own comment: "the one number in the chrome that should
dominate"). Rendering the small scrub-position readout in that class means it prints
at the same oversized display size as the real session clock, immediately beside a
normal `.btn`-sized Play/Pause button and a 120px slider — a jarring, unintended
visual-hierarchy break, not a deliberate design choice (nothing else about this
control asks to dominate the rail). This is a straight class-reuse bug, not a design
decision.
**Fix**: give the elapsed-time readout its own small class (e.g. reuse `.rail-note`,
or add a one-line `.rail-scrub-clock { font-family: var(--data); font-variant-numeric:
tabular-nums; font-size: var(--fs-sm); color: var(--slate); }`) instead of
`.rail-clock`.

### H2 — New scrub `<input type="range">` skips the app's own dark-mode range styling
`web/src/App.tsx:351-361`. `components.css:1057-1059` documents, in its own words,
exactly the bug this reintroduces: *"the default Windows chrome is light even under
color-scheme: dark, so the ghost scrubber gets an explicit dark track and thumb"* —
and then supplies that styling only under `.ghost-controls input[type="range"]`
(`components.css:1060-1102`). The new replay-position slider is a bare, unclassed
`<input type="range">`, so on the exact platform/browser combination that CSS
comment calls out, it will render with the native light track/thumb sitting on the
dark rail — the visual regression the app already paid to fix once, now reintroduced
in a second range control that didn't reuse the pattern. Guideline: **Dark Mode &
Theming** — "native form control needs explicit background/foreground for
Windows dark mode" applies to range chrome the same way it applies to `<select>`.
**Fix**: wrap the input in (or move it under) `.ghost-controls`, or extract a shared
`.range-dark` class from the existing rules and apply it to both sliders.

### H3 — Same range input falls outside the app's touch-target rule
`web/src/App.tsx:351-361`. The coarse-pointer touch-target block
(`components.css:1157-1200`) explicitly raises `.ghost-controls input[type="range"]`
to a 44px hit height on touch (`components.css:1187-1189`) — but the selector is
scoped to that class, and the new replay-position input carries no class at all, so
it is excluded. On a phone this control stays at the browser's native range height
(effectively well under half of that). Guideline: **Touch & Interaction** / the
project's own established 44px-on-coarse-pointer convention (which this file is the
one place in #94 that needed to opt into it and didn't).
**Fix**: add the new input to the same selector list (or the shared class from H2
covers this automatically once applied).

---

## Medium

### M1 — Corner numbers vanish entirely below 700px, with no fallback
`web/src/components/Map.tsx:80-89` gives each corner-number `<text>` the class
`map-label` — the same class the driver-code labels use. `components.css:1443-1451`
(`@media (max-width: 700px) { .map-label { display: none } }`) exists specifically so
twenty overlapping driver-code labels don't turn into noise on a phone, with
`.map-label-marked` as the escape hatch for the selected/rival car's label. Corners
share the same class but have no `map-label-marked` equivalent, so every corner
number — a feature with no other on-screen representation — disappears completely on
any board narrower than 700px (which includes the 375px case in scope here).
Guideline: **Content Handling** — "handle empty states" / don't silently drop
content a wider viewport shows with no equivalent. This is a content-parity
regression specific to reusing an existing selector rather than a deliberate
trade-off.
**Fix**: give corner labels their own class (e.g. `map-corner-label`) not gated by
this rule, or explicitly re-show a reduced set (e.g. only corners at regular
intervals) under the same breakpoint.

### M2 — Hardcoded pixel width on the scrub slider
`web/src/App.tsx:360` — `style={{ width: 120 }}`. Guideline: **Safe Areas &
Layout** / prefer flex/grid sizing over a fixed magic number, especially inside a
rail that already reflows the controls zone at 1360/1220/700px
(`components.css:1592-1767`) and wraps individual children at ≤700px
(`.rail-controls { flex-wrap: wrap }`, referenced at `components.css:1752-1755`). A
fixed 120px doesn't itself overflow at 375px (children wrap individually), but it is
inconsistent with every other sized element in the rail, which is driven by
character/token units (`22ch`, `var(--sp-*)`) rather than raw pixels.
**Fix**: `min-width: 80px; flex: 1 1 120px` (or a `max-width` in `ch`/`rem`) so the
control can shrink gracefully at narrower widths instead of carrying a fixed px value.

### M3 — Distance-trace charts give assistive tech a label but no data
`web/src/components/TelemetryPanel.tsx:169-172` — each of the three new
`DistanceTraceRow` SVGs (Throttle/Brake/Gear) is `role="img"` with
`aria-label={`${label} over lap distance`}` — a static, generic name that carries no
information about the actual trace (peak values, braking points, gear-shift count).
This is the same gap the prior audit flagged for the existing lap-time sparkline
(`reviews/uiux-wcag.md` S1: *"a screen-reader user gets ... and nothing else"*), now
reproduced across three new, denser charts (up to 200 plotted points each) instead of
fixed. Guideline: **Accessibility** — "meaningful media needs captions, transcripts,
or descriptions as applicable." Full WCAG treatment in the companion accessibility
report (finding P4).
**Fix**: fold a one-line summary into the `aria-label` (e.g. min/max, or "full
throttle for N% of the lap"), matching the pattern `StintChart`'s pit/stint bars
already use correctly (title + descriptive `aria-label` carrying the real values).

---

## Low

### L1 — Pit-stop tick's inline fallback colour is dead code
`web/src/components/StintChart.tsx:83` — `background: 'var(--amber, orange)'`. Every
other colour reference added by #94 (and the rest of this file: `TYRE_COLOUR`,
`var(--chalk)` for the leader marker) trusts the CSS custom property to exist and
never supplies a CSS-level fallback; `--amber` is defined unconditionally in
`tokens.css:20` and has been since before this PR, so the `, orange` fallback can
never fire and is just inconsistent with the surrounding code's own convention.
Cosmetic, not a guideline violation on its own.
**Fix**: drop the fallback (`background: 'var(--amber)'`) to match the rest of the
file — or, if the defensive pattern is intentional going forward, apply it
consistently elsewhere too.

---

## Checked and clean

- **No icon-only buttons without `aria-label`** — the new Play/Pause button uses a
  visible text label (`▶ Play` / `⏸ Pause`), matching the existing Freeze/Resume
  pattern it sits beside (`App.tsx:348-350`).
- **No `<div onClick>` standing in for a control** — Play/Pause is a real `<button>`;
  the scrub is a real `<input type="range">`; the pit-stop ticks and corner numbers
  are non-interactive (`role="img"`, no click handler), so the "interactive element
  must be a real control" rule doesn't apply to them.
- **`aria-valuetext` correctly overrides the raw-ms value** on the scrub input
  (`App.tsx:359`, `fmtElapsed(replayTMs)`), so a screen reader announces "1:23.400"
  rather than a meaningless millisecond integer — same idiom `Ghost.tsx`'s existing
  scrubber already uses.
- **Empty/missing-field states are handled, not just possible** — `state.corners`,
  `pitStops`, `pedalTraces`, `sectorDominance` all default to `[]`/`{}` in
  `state/race.ts` (`emptyState()` and `applyMessage`'s snapshot branch), and every
  consumer (`Map.tsx:41-49,80`, `StintChart.tsx:72`, `TelemetryPanel.tsx`'s
  `state.pedalTraces[car.driverNum] &&` guard) no-ops cleanly on an older clip that
  carries none of these fields — no broken UI, no `undefined.map()` crash. Verified
  against `state/contract.test.ts`'s new assertions for the new fields.
- **Reduced motion is not broken by the new teleport-snap logic** —
  `hooks/useSmoothedCars.ts`'s new `TELEPORT_THRESHOLD` snap (lines 36-46) sits
  entirely inside the existing snapshot effect and does not touch the
  `reducedMotion || paused` gate on the interpolation `rAF` loop (lines 56-75); a
  reduced-motion user still gets direct frame-to-frame positions with no
  interpolation, scrub included.
- **Pause propagation is complete, not partial** — `replayPaused` correctly reaches
  `staleSec` (`App.tsx:329`), both `<Map>` render branches' `paused` prop
  (`App.tsx:...` — `frozen || replayPaused`), and a dedicated `PAUSED` chip inside the
  existing `role="status" aria-live="polite"` region (`App.tsx:384-386`) — exactly
  the propagation the commit message claims, and it holds up under reading.
- **`toPolyline`'s `n < 2` guard** (`TelemetryPanel.tsx:133-137`) avoids the classic
  divide-by-zero NaN-coordinate bug for a single-point trace — good defensive
  handling of a real edge case (a clip with a near-empty pedal trace).
- **No animated-GIF/hardcoded-date-format/paste-blocking/zoom-disabling anti-patterns**
  introduced anywhere in the #94 diff.
