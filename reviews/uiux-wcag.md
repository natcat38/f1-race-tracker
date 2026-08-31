# WCAG 2.2 AA accessibility audit — F1 Race Tracker web frontend

Scope: `web/src/**/*.tsx`, `web/src/**/*.ts`, `web/src/styles/*.css`. Method: static
read-through of every dashboard component, hook, and the global stylesheet;
contrast ratios computed by hand from token hex values using WCAG relative-
luminance math (not measured in a live browser — flagged where that matters).

Counts: **1 blocker, 3 serious, 6 moderate, 5 minor.**

---

## Blocker (fails AA)

### B1 — Team-colour driver code text fails 1.4.3 Contrast (Minimum) in Comms
`web/src/components/Comms.tsx:22-24,47,79` (`colourFor`) paints the driver code
directly in the raw constructor hex (`teamColour[...]`) on `var(--asphalt)` /
`var(--carbon)`. This is the exact anti-pattern `tokens.css:254-262` (team-key
comment) and `TimingTower.tsx:254-262` explicitly avoid — the tower deliberately
moved the team colour to a 3px border rule on the Pos cell *because* several
constructor hexes miss the text-contrast floor, and Comms re-adopts the failing
pattern for its "CODE radio" line and history rows.

Computed contrast against `--asphalt` (#0B0D10):
- AlphaTauri `#2B4562` → **1.98:1** (fails both 4.5:1 and 3:1)
- Red Bull `#3671C6` → **4.02:1** (fails 4.5:1, the applicable floor for text)
- Aston Martin `#229971`, Alfa Romeo `#C92D4B` are also worth re-checking; several
  sit close to the 4.5:1 line the same way Haas/AlphaTauri did on the tower.

Fix: reuse the tower's pattern — keep the code in `--chalk`, carry the team
colour as a border/dot accent instead of the text fill.

---

## Serious

### S1 — Sparkline SVGs have no accessible data, only a label (1.1.1 / 4.1.2, borderline)
`TelemetryPanel.tsx:46-49` gives the `<svg role="img" aria-label="...lap time
trend">` a name, but the actual per-lap values (the substance of the chart) are
never exposed to assistive tech — a screen-reader user gets "VER lap time
trend" and nothing else, whereas a sighted user reads relative bar heights.
Same for `StintChart.tsx:54-55` (per-stint `role="img"` bars do carry compound
+ lap range text, which is good) but `TelemetryPanel`'s sparkline gives no
equivalent for the shape of the trend (getting faster/slower over the window).
Minimum fix: append the underlying values or an explicit trend word ("improving
over last 4 laps") to the `aria-label`, matching what `StintChart` already does
right.

### S2 — Track map SVGs have no per-car text alternative (1.1.1)
`Map.tsx:24` labels the whole map `"Track map with live car positions"` (or
"...; the reference car is ringed") but the 20 car markers inside carry no
accessible names of their own — a screen-reader user gets one static sentence
for a moving field of 20 cars and can never learn who is where. The `<text>`
driver-code labels (`Map.tsx:60-66`) are real SVG text nodes, which is better
than nothing, but they're unlabelled/unstructured (no `role="img"`/group name
per car, and hidden entirely under ~330px per the CSS comment at line 56-58) so
they don't reliably substitute for the missing structure. Given the map is
decorative-plus-informational (position is also fully available from the
Timing Tower), the pragmatic fix is `aria-hidden="true"` on the `<svg>` (make it
purely decorative, since the Tower already gives the same info as text) rather
than trying to build a live per-car text table inside SVG.

### S3 — Ghost overlay's `<input type="range">` has an unlabelled default value announcement gap combined with autoplay motion (2.2.2 / 2.3.3 partially mitigated, but see detail)
`Ghost.tsx:171-172,353-372`: reduced-motion is handled well — `paused` seeds to
`true` when `useReducedMotion()` is true, and the scrubber remains usable
(genuinely good coverage, better than most audits find). However `OverlayLive`
computes `loopMs` and the animation drives `tMs` via `requestAnimationFrame`
with no user-facing global "stop" once the user has pressed Play again after
a reduced-motion default — there is a Play/Pause button, so 2.2.2 (Pause, Stop,
Hide) is technically satisfied, but note it as fragile: confirm in a live
render that focus/labelling of the range persists correctly when `disabled`
toggles (`!ready`), since disabling a focused native `<input>` can silently
drop focus to `<body>` with no announcement.

---

## Moderate

### M1 — `useReducedMotion` covers both JS-driven loops but CSS entrance-stagger scope not fully verified
`hooks/useReducedMotion.ts` is correctly wired into `useSmoothedCars.ts:48,64`
(map interpolation) and `Ghost.tsx:171-172` (overlay playback) — this is the
"two places motion is driven from JS" the file's own comment promises, and both
are in fact covered. `styles/components.css:994` gates the page-intro stagger
under `@media (prefers-reduced-motion: no-preference)`, which is the correct
polarity. No violation found here, but flagging for a manual check: the
`.chip-loop`/`.chip-stall` chips and any `transition`/`animation` rules outside
that guarded block (there may be hover-transition rules elsewhere in the
1766-line stylesheet not fully enumerated by this pass) should be spot-checked
for un-gated `transition` on repeatedly-updating elements (the tower re-renders
~10 Hz).

### M2 — Timing Tower row/segment control target size at pointer:fine (2.5.8, AA)
`components.css:760-778` (`.tt-select`) has no explicit min-height/width at the
default (mouse) breakpoint — it inherits from `<b>{code}</b>` content plus the
`<td>` padding (`--sp-1` = 4px, `components.css:663`), likely rendering well
under the 24×24 CSS px target-size minimum for a fine pointer. The `@media
(pointer: coarse)` block (`components.css:1122-1163`) correctly raises touch
targets to 44px, but 2.5.8's 24px floor also nominally applies at mouse
resolution. Likely defensible under the 2.5.8 "essential"/spacing exception
(the whole `<tr>` is also clickable, `TimingTower.tsx:266-269`, so the
functional hit target is larger than the visible button) — worth an explicit
note in code rather than leaving it implicit.

### M3 — `.tt-clear` and `.rail-repo-active` sit exactly at the 24px floor
`components.css:1256` (`.tt-clear`, `min-height: 24px`) and `:1536`
(`.rail-repo-active`, `min-height: 24px`) meet 2.5.8's minimum only if their
CSS box, not just line-height, is actually 24px including padding — verify
computed box size in a live render; a few px of border/margin subtracted from
a nominal 24px value is a common way this silently fails.

### M4 — Race Control `role="log"` politeness is right, but `aria-relevant="additions"` combined with a sliding 8-item window could re-announce removed/reordered content unpredictably
`RaceControl.tsx:52`: `MAX_SHOWN = 8` means old messages silently drop off the
rendered list every time a 9th arrives. `aria-relevant="additions"` is the
correct choice to avoid announcing removals, and the WeakMap-keyed stable
identity (`idOf`, lines 16-25) is a genuinely good fix for the "re-announces
the whole backlog" bug it documents having fixed. No violation, but note this
list is unbounded upstream (`state.messages`) and only windowed in the render —
confirm `state.messages` itself doesn't grow forever in a very long session
(perf, not a11y, but noting since it's adjacent).

### M5 — StatusBadge's live region wraps *only* the badge, not sibling FROZEN/CLIP-LOOPED chips consistently
`StatusBadge.tsx:97-108` documents (correctly) that the region must live with
the chip because "the region has to be in the DOM before the text changes for
the change to be announced." `StatusRail.tsx:166-184` then separately notes the
reserved `.rail-state` slot is "deliberately NOT a live region itself" to avoid
double-announcing, and `App.tsx:282-289` supplies its own `role="status"
aria-live="polite"` wrapper around FROZEN/CLIP-LOOPED. This is *correct*, but
fragile: any future call site that renders `stateChips` without its own live
region (StatusRail's prop is optional, untyped as requiring one) will silently
lose the announcement with no compile-time or lint signal. Worth a comment or
a runtime dev-mode warning.

### M6 — Settings/link-copy `<button>` announces "Copy: {children}" where `children` may include markup-derived text that reads oddly
`Settings.tsx:34`: `aria-label={\`Copy: ${children}\`}` — if `children` is not
a plain string (e.g. contains a `<code>` wrapped command with nested spans),
`${children}` string-interpolates a React element into `"[object Object]"`
rather than its text content. Verify the call sites only ever pass a string
child; if any pass JSX, the accessible name silently breaks.

---

## Minor

### m1 — `--dim` (#7C8590) is documented as retuned to 4.8:1/5.2:1 but only checked against `--carbon`/`--asphalt`; DRS-inactive readout in TelemetryPanel also sits on those, consistent — no issue found, noting as verified-good rather than a defect (positive finding, listed here for completeness of the pass).

### m2 — Zoom-to-400%/reflow (1.4.10) not verified live
The grid layouts (`board-top`, `board-bottom` in `components.css:827-838`) and
the cascade of `@media` breakpoints (1360/1220/1100/700/500px) strongly suggest
reflow was designed for, but this was a static read — a live check at 400%
zoom / 320px CSS width (per 1.4.10) is recommended before signing off, since
several `min-width` values (`22ch`, `9ch`, `4ch`, etc.) are content-based rather
than viewport-based and could combine to exceed 320px on certain locales/longer
driver codes or category labels.

### m3 — Sector-best superscript legend duplicated across two panels with copy drift risk
`TimingTower.tsx:372-381` and `StintChart.tsx:101-108` each hand-roll the tyre
legend independently (not shared via `teamColours.ts`-style single source).
Not a WCAG violation, but a consistency risk: if compound colours are retuned
in one place and not the other, the AAA-adjacent "don't rely on colour alone"
mitigations (hatch pattern, S/P legend text) could drift out of sync between
panels.

### m4 — `RaceControl.tsx:68` driver-tag `<span style={{ color: 'var(--slate)' }}>` — `--slate` (5.8:1 documented) is fine for text, no issue; flagged only because it's supplementary parenthetical text and not load-bearing — included for completeness, not a defect.

### m5 — `Comms.tsx:116-118`'s error region is `role="status" aria-live="polite"` but always rendered as an empty wrapper (`{error && ...}`) — correct pattern (matches `StatusBadge`'s own always-mounted-region rule) but note the *inner* conditional means an error that fires twice in a row with identical text may not re-announce in some screen readers (a known live-region quirk with identical successive text nodes). Low likelihood given errors here are rare and distinct causes.

---

## What's already done well

- **Sector-mark colour-blindness mitigation**: `TimingTower.tsx:315-338` and
  `TelemetryPanel.tsx`'s sparkline hatch (`SparkHatch`, lines 55-66, 74-86) both
  pair colour with a shape/pattern or text glyph (S/P superscript, diagonal
  hatch) — genuinely satisfies 1.4.1 Use of Color, and the code comments show
  this was a deliberate, tracked fix.
- **`SegmentedControl.tsx`** is a well-built roving-tabindex radiogroup:
  correct `role="radiogroup"`/`role="radio"`/`aria-checked`, arrow-key
  navigation, visible scope label plus `aria-label`, and honest caveat text
  exposed via `visually-hidden` rather than title-only.
- **Focus visibility**: global `:focus-visible { outline: 2px solid
  var(--chalk); outline-offset: 2px }` (`tokens.css:175-178`) plus a tower-
  specific inward ring (`TimingTower`/`components.css:774-778`) that accounts
  for `overflow: hidden` clipping outward rings — shows real attention to 2.4.7.
- **Contrast engineering discipline**: `tokens.css`'s inline comments show
  measured ratios for nearly every semantic colour (`--dim` 4.8:1, `--good`
  6.7:1, `--bad` 5.2:1, tyre compounds all re-verified against the 4.5:1 text
  floor rather than the weaker 3:1 non-text floor) — this is unusually rigorous
  for a project this size, and is exactly why the one miss (Comms' raw team
  colour, B1) stands out as a regression against the codebase's own standard.
- **Reduced motion**: both JS-driven animation loops (map interpolation, ghost
  overlay playback) correctly subscribe to `useReducedMotion` and degrade to a
  fully-usable, still-interactive state rather than just turning motion off.
- **Live region hygiene**: `RaceControl`'s WeakMap-keyed stable identity to
  avoid re-announcing history, and the explicit `aria-hidden` on the ticking
  "Xs ago" stall counter (`StatusBadge.tsx:56-70`) to avoid live-region spam,
  both show a correct, non-naive understanding of `aria-live="polite"`
  behaviour that a lot of teams get wrong.
- **Keyboard operability**: Timing Tower rows use one shared roving tab stop
  keyed by driver number (survives re-sorts at 10 Hz), Esc clears the reference
  car globally (`App.tsx:92-102`, correctly skipped while focus is in a form
  control), and the horizontally-scrollable tower region is made focusable
  only when actually overflowing (avoids a dead, empty tab stop).
- **Audio control (1.4.2)**: team radio never autoplays until a user gesture
  toggles Comms on, and the same toggle immediately pauses/clears any playing
  clip — a real, always-available stop mechanism independent of system volume.
