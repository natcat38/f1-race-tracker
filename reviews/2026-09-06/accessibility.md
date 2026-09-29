# WCAG 2.1 AA accessibility audit — PR #94 (verified peer-comparison features)

Method: `design:accessibility-review` skill checklist, static read-through of the
diff plus the CSS/tokens it depends on; contrast ratios computed by hand from token
hex values using WCAG relative-luminance math (not measured in a live browser —
flagged where that matters, per the same caveat the prior audit used).

Scope: only what commit `d39a9a1` (#94) touched — `App.tsx` (static-demo
pause/scrub transport), `realtime/staticReplay.ts`, `components/TelemetryPanel.tsx`
(distance traces), `components/StintChart.tsx` (pit-stop ticks),
`components/Map.tsx` + `TrackPath.tsx` + `geometry.ts` (corner numbers,
start/finish line, sector-dominance heatmap), `hooks/useSmoothedCars.ts` (teleport
snap), `state/race.ts` (new contract fields). Everything else was audited and fixed
under PR #93 — see `reviews/uiux-wcag.md`, `uiux-validation.md`, `accessibility.md` —
and is not repeated here; closed items (e.g. `Comms.tsx`'s B1, the Timing Tower
target-size notes) are out of scope unless #94 touches the same class.

**Counts: 1 Blocker, 3 Serious, 2 Moderate, 2 Minor.**

---

## Blocker (fails AA)

### B1 — Corner-number text can render at ~1.2:1 contrast against the new heatmap
`web/src/components/Map.tsx:80-89` paints every corner number in a fixed colour,
`fill="var(--track-label)"` (`#EEEEEE`), positioned exactly on the track centreline —
the same line the new sector-dominance heatmap (`Map.tsx:41-49`, drawn by
`TrackPath.tsx:16-27`) now colours per minisector in whichever team's colour was
fastest through it (`teamColours.ts`). Several team colours are themselves light:

- Mercedes `#27F4D2` (teal): `#EEEEEE`-on-`#27F4D2` ≈ **1.2:1**
- Haas `#B6BABD` (grey): ≈ **1.3:1**
- Williams `#64C4FF` (light blue): ≈ **1.7:1**

All fail the 4.5:1 floor for normal text (**WCAG 1.4.3 Contrast (Minimum)**) by a
wide margin — this isn't a borderline case like the Comms B1 finding from PR #93, it
is close to invisible. It happens whenever the fastest driver through a corner's
minisector happens to be on one of these teams, which is exactly the kind of
session-dependent condition that a static read can flag but not exhaustively
enumerate — confirm live with a session where Mercedes/Haas/Williams lead a
corner's minisector.

**Fix**: don't hardcode the label fill. Either pick `--chalk`/`--asphalt` per corner
based on the underlying segment colour's own luminance (the segment colour is
already computed in `Map.tsx`'s `segments` memo and is available at the corner's
track position), or draw a small filled/stroked background chip (a `<rect>`/`<circle>`
in `--asphalt` or `--carbon`) behind each corner `<text>` so the number always sits on
a fixed, known-contrast backing rather than directly on the variable-colour road.

---

## Serious

### S1 — Sector-dominance heatmap encodes its entire meaning in colour alone
`web/src/components/Map.tsx:41-49` (segments) / `TrackPath.tsx:16-27` (render) /
`teamColours.ts` (palette). The heatmap's whole purpose — "which driver was fastest
through this minisector" — is conveyed exclusively through which of 12 team hues a
given stretch of track is painted. There is no legend on the map or panel, no
pattern/hatch differentiator, and no text fallback (unlike the rest of this
codebase's own established discipline: sector-best marks get an S/P glyph in
addition to colour, sparkline "slower" bars get a hatch pattern in addition to red —
`reviews/uiux-wcag.md`'s "done well" list). **WCAG 1.4.1 Use of Color.** Several team
hues are also close enough to be hard to tell apart even for typical colour vision
under a track's mixed lighting/screen conditions (Red Bull `#3671C6` vs Williams
`#64C4FF` vs RB `#6692FF` vs Alpine `#0093CC` are four blues on one 12-colour
palette), which compounds the problem for anyone with a colour-vision deficiency —
this is a genuinely hard case to solve with colour alone even before considering
colour-blindness.
**Fix**: at minimum, add a colour→team legend near the map (the same idea
`StintChart.tsx:128-132`'s tyre legend already uses for its own colour-coded bars).
Better: expose the dominant driver's code as the `aria-label` reachable per-segment,
or make each segment's colour secondary to a click/tap-reveal of driver code —
consistent with the map's existing pattern of putting real text (driver codes) beside
every car marker rather than relying on the marker colour alone.

### S2 — Pit-stop duration tick can render at ~1.1–1.5:1 against the tyre bar under it
`web/src/components/StintChart.tsx:72-86` draws a 2px-wide amber
(`var(--amber)`, `#FFB000`) tick directly on top of the stint-compound bar
(`StintChart.tsx:50-64`) it belongs to. Computed contrast against the lighter tyre
compounds:

- HARD `#e8e8e8` (14.7:1 on carbon — genuinely near-white): amber-on-HARD ≈ **1.5:1**
- MEDIUM `#e8c84a` (10.9:1 on carbon — pale yellow): amber-on-MEDIUM ≈ **1.1:1**

Both fail the 3:1 floor for a meaningful graphical object (**WCAG 1.4.11 Non-text
Contrast** — the tick is not decorative; it is the entire visual representation of a
pit stop, backed by its own `role="img"`/`aria-label`, meaning sighted and
non-sighted users are meant to get equivalent information, and the sighted path can
silently fail). A stop during a HARD or MEDIUM stint (i.e. most stops, since SOFT is
comparatively rare for a long stint) risks being effectively invisible next to a
fully legible-to-a-screen-reader `aria-label`.
**Fix**: outline the tick (e.g. a 1px `--asphalt`/`--carbon` stroke on both sides, or
draw it as a small filled triangle/notch above the bar in `--chalk` instead of
inline) so it holds contrast regardless of which compound sits underneath —
mirroring how the leader-lap marker (`StintChart.tsx:89-101`, `--chalk` on `--edge`)
gets its contrast from a fixed, known background rather than a variable one.

### S3 — Distance-trace SVGs give assistive tech a name but no data
`web/src/components/TelemetryPanel.tsx:169-172` — the three new `DistanceTraceRow`
charts (Throttle/Brake/Gear) are each `role="img"` with a generic, unvarying
`aria-label={`${label} over lap distance`}` (e.g. literally "Throttle over lap
distance"). None of the underlying values — the actual shape of the trace, up to 200
plotted points per channel — reach a screen-reader user. This is the exact gap the
prior audit already flagged for the pre-existing lap-time sparkline
(`reviews/uiux-wcag.md` S1), now reproduced identically across three new, denser
charts instead of fixed. **WCAG 1.1.1 Non-text Content** (the label names the
picture but does not serve as a text alternative for its content, which is the whole
point of the chart).
**Fix**: minimum viable fix is the same one S1 in the prior audit already prescribed
— fold a summary into the `aria-label` (e.g. "Throttle over lap distance: full
throttle 62% of the lap, off throttle at 8 points" or similar derived stats) rather
than the bare channel name.

---

## Moderate

### M1 — Replay scrub `<input type="range">` misses the app's touch-target convention
`web/src/App.tsx:351-361`. The project's own `@media (pointer: coarse)` rule
(`components.css:1157-1200`) raises `.ghost-controls input[type="range"]` to a 44px
hit height on touch specifically because, per that block's own comment, *"the
overlay's primary control was a 20px-tall target for a precision drag"* — the exact
same shape of control as this new one. The new input carries no class, so it is
excluded from that rule and stays at native touch-target height on a phone.
**WCAG 2.5.8 Target Size (Minimum, AA)** sets a 24px floor; a bare native range thumb
commonly renders well under that. Not flagged as Serious because the same 24px floor
carries a spacing/essential-control mitigation elsewhere in this codebase
(`reviews/uiux-wcag.md` M2/M3 treat similarly-sized native controls as borderline
rather than outright failing), but this is a clean regression against a rule the app
already enforces for the visually-identical Ghost scrubber.
**Fix**: apply the same class (or extend the selector) so this input gets the 44px
touch height too.

### M2 — Same range control's visible track may render with too little contrast
`web/src/App.tsx:351-361`, cross-referenced with `components.css:1057-1102`. The
Ghost overlay's scrubber gets an explicit dark track/thumb specifically because,
per the CSS's own comment, *"the default Windows chrome is light even under
color-scheme: dark."* The new replay-position input opts out of that styling by not
carrying the `.ghost-controls` scope, so on the platform/browser combination that
comment describes, the control's own track/thumb may render light-on-dark with
insufficient boundary contrast against `--carbon`/`--asphalt`
(**WCAG 1.4.11 Non-text Contrast** for the UI-component boundary). Marked Moderate
rather than Serious because it is platform/browser-contingent and not reproducible
by static token math alone — verify live on Windows/Chromium.
**Fix**: same as WIG H2 — share the existing dark-track/thumb rule with this input.

---

## Minor

### m1 — Corner `<text>` nodes have no explicit `aria-hidden`
`web/src/components/Map.tsx:80-89`. The whole `<svg>` is already `role="img"` with
one summary `aria-label` (`Map.tsx:68`), which is the same open item the prior audit
flagged for the driver-code labels (`reviews/uiux-wcag.md` S2 — AT exposure of child
text nodes inside a `role="img"` SVG is browser/AT-dependent, not reliably
suppressed). The new corner-number text doubles the amount of ambiguous child text
inside that image without adding its own `aria-hidden="true"`. Not a new class of
problem, just more of an existing one, and cheap to close for the pieces #94 added
even if the full S2 fix (from PR #93's audit) is still open.
**Fix**: add `aria-hidden="true"` to the corner `<text>` elements specifically,
independent of whether/when the broader S2 recommendation (`aria-hidden` on the
whole `<svg>`, or per-car labelling) is taken up.

### m2 — Oversized replay-clock span could mislead a low-vision user about hierarchy
`web/src/App.tsx:362` — cross-referenced with WIG finding H1. Not a screen-reader
issue (it is one `<span>` with text, correctly read either way), but reusing the
`--fs-hero`-scale `.rail-clock` class for the scrub position means a low-vision user
relying on relative type size to infer which readout is primary is misdirected —
the replay-elapsed time visually outranks the actual session clock it sits beside.
Borderline **WCAG 1.3.1** (information conveyed through presentation should be
consistent with structure/importance) rather than a clean violation, since no
information is technically lost.
**Fix**: same as WIG H1 — a differently-scaled class for this readout.

---

## Checked and clean

- **Keyboard operability of the new transport controls**: the Play/Pause button is a
  native `<button>`; the scrub is a native `<input type="range">` — both are
  Tab-reachable in DOM order and the range responds to arrow keys by default with no
  custom key handling needed. **WCAG 2.1.1 Keyboard**: satisfied.
- **Focus visibility**: both new controls inherit the app-wide
  `:focus-visible { outline: 2px solid var(--chalk); outline-offset: 2px }`
  (`tokens.css:175-178`) — no `outline: none` was introduced anywhere in the #94
  diff. **WCAG 2.4.7**: satisfied.
- **`aria-valuetext` correctly overrides the raw millisecond value** on the scrub
  input (`App.tsx:359`, `fmtElapsed(replayTMs)`), so a screen reader announces
  "1:23.400" rather than a meaningless integer — reuses the exact idiom the existing
  `Ghost.tsx` scrubber already established. **WCAG 4.1.2**: satisfied.
- **No focus-loss trap from a disabling control**: the whole Play/Pause + scrub block
  only renders once `replayDuration > 0` (`App.tsx:346`) rather than rendering
  disabled and later becoming enabled — avoiding the exact fragility the prior audit
  flagged as a risk for `Ghost.tsx` (`reviews/uiux-wcag.md` S3, disabling a focused
  native input can silently drop focus to `<body>`).
- **Pause is honoured as a real stop, not just a render-only freeze**: `replayPaused`
  correctly gates the `useSmoothedCars` interpolation loop (via the existing
  `reducedMotion || paused` check, `hooks/useSmoothedCars.ts:56-59,75,80` — unchanged
  by #94, and #94's new teleport-snap logic sits entirely inside the snapshot effect,
  not the animation gate), reaches the staleness badge (`App.tsx:329`), and surfaces
  as its own `PAUSED` chip inside the pre-existing `role="status" aria-live="polite"`
  region (`App.tsx:384-386`) rather than a second, competing live region.
  **WCAG 2.2.2 Pause, Stop, Hide**: satisfied, and done correctly (one region, not two
  double-announcing).
- **Reduced motion is unaffected by the new teleport-snap logic**:
  `useSmoothedCars.ts`'s `TELEPORT_THRESHOLD` snap only changes what `from.current`
  is seeded with; it does not touch the `reducedMotion` early-return on the rAF loop,
  so a reduced-motion user continues to get direct, non-interpolated frame updates
  through a scrub or loop restart exactly as before.
- **Empty/missing-field states never produce broken UI**: `state.corners`,
  `pitStops`, `pedalTraces`, and `sectorDominance` all default to empty
  (`state/race.ts` `emptyState()` and the snapshot branch of `applyMessage`), and
  every new consumer guards accordingly — `Map.tsx`'s `segments` memo returns
  `undefined` when `sectorDominance` is empty (falling back to `TrackPath`'s plain
  single-colour path, `TrackPath.tsx:28-34`), `state.corners.map()` over `[]` renders
  nothing, `StintChart.tsx:72`'s `(state.pitStops[c.driverNum] ?? [])` and
  `TelemetryPanel.tsx`'s `state.pedalTraces[car.driverNum] &&` guard both no-op
  cleanly. An older baked clip with none of these fields renders identically to how
  it did before #94 — confirmed against `state/contract.test.ts`'s new assertions.
  No `undefined`-crash risk, no partially-rendered "half a feature" state.
- **`toPolyline`'s `n < 2` guard** (`TelemetryPanel.tsx:133-137`) prevents a
  divide-by-zero NaN-coordinate SVG point for a near-empty pedal trace — a real edge
  case handled correctly rather than left to crash or silently misrender.
- **Colour is not the sole cue for reference-vs-rival within a single trace**:
  `DistanceTraceRow` (`TelemetryPanel.tsx:174-177`) differentiates the reference car
  from the rival by solid-vs-dashed stroke (`strokeDasharray="3 2"`) in addition to
  colour (`--good` vs `--slate`) — matches the same solid/dashed grammar the map's
  own selection ring and the Ghost overlay already use, so this specific pairing does
  not repeat the S1/B1-style colour-only mistake found elsewhere in #94.
