<!-- Merged, ranked UI/UX fix list from the 2026-08-31 three-standard audit (WCAG 2.2 / Nielsen+laws-of-UX / Vercel Web Interface Guidelines). Source reports: uiux-wcag.md, uiux-heuristics.md, uiux-wig.md. -->
# UI/UX fix list — ranked, most important first

Merged from `uiux-wcag.md` (WCAG 2.2 AA), `uiux-heuristics.md` (Nielsen + laws of UX),
and `uiux-wig.md` (Vercel Web Interface Guidelines). Duplicates across reports collapsed.

> **Validated 2026-08-31** — every claim adversarially re-checked in `uiux-validation.md`,
> which is authoritative where they disagree. Key outcomes:
> - **Item 4 (map per-car alternatives) is REFUTED** — `Map.tsx` already has
>   `role="img"` + `aria-label`, which is the proposed fix. Drop it.
> - **Item 13's `.tt-select` bullet is a real WCAG 2.5.8 AA failure** (rows measured
>   23px; the row fallback isn't an accessible control) — promote to ~rank 5.
>   Its `.rail-repo-active`/24px-floor bullet is NOT a finding (24px conforms).
> - **9c ([object Object] aria-label) is refuted** — the prop is typed `string`.
> - Only items 1 (1.4.3), 5a (1.1.1), 13b (2.5.8) and 14e (1.4.10, pending live
>   check) are genuine WCAG failures; items 2, 5b, 7, 9a, 10, 11 stand but under
>   corrected principles (Nielsen/Gestalt/WIG, not the laws originally cited).
> - Item 1 is worse than stated: Comms history rows sit on `--carbon` → 1.82:1.

## 1. Comms panel paints driver codes in raw team hex — fails WCAG 1.4.3 contrast (BLOCKER)
`web/src/components/Comms.tsx:22-24,47,79`. AlphaTauri `#2B4562` on `--asphalt` is
1.98:1; Red Bull 4.02:1 — both under the 4.5:1 text floor. The Timing Tower already
solved this exact problem (team colour as a border accent, text in `--chalk`); Comms
regressed against the codebase's own standard. Fix: reuse the tower's pattern.

## 2. The ghost overlay — the headline feature — is undiscoverable
`StatusRail.tsx:18-21`. Its only entry point is a plain "OVERLAY" nav tab with no
hierarchy, hint, or affordance on the board route. A 10-second visitor never finds
the product's star feature (Jakob's law / Hick's law). Fix: a one-time hint or a
visually weighted entry point from the board.

## 3. The "● Live" toggle label overpromises
`SourceToggle.tsx:9-14`, `StatusBadge.tsx:79-88`. The lane is a second recorded
clip; the honest caveat lives only in visually-hidden text and a tooltip. The
visible label at the moment of choice should say "Live (demo)" itself.

## 4. Track map's 20 car markers have no per-car text alternative (WCAG 1.1.1, serious)
`Map.tsx:24,60-66`. One static sentence names the whole SVG; a screen-reader user
can never learn who is where. Pragmatic fix: `aria-hidden="true"` on the SVG, since
the Timing Tower already conveys the same information as text.

## 5. Telemetry readouts are visually rich but semantically empty (serious)
- Sparklines expose only "VER lap time trend", not the trend itself —
  `TelemetryPanel.tsx:46-49` (WCAG 1.1.1). Append values or a trend word to the label.
- Throttle/Brake bars have no `role="meter"`/`aria-valuenow`; label, bar, and number
  are three disconnected text pieces — `TelemetryPanel.tsx:13-26`.

## 6. Deep links exist with zero UI surface
`routing.ts`, `App.tsx:210-230`, `Ghost.tsx:152-163`. Rich shareable URLs
(`?car=`, `?a=`, `?b=`) discoverable only by editing the URL bar. Add a
"copy link to this view / comparison" button on the board and overlay.

## 7. Reconnect action is far from where the failure is noticed
`App.tsx:295-314`, `StatusBadge.tsx:35-45`. Offline shows a warning chip over the
frozen map, but the Reconnect button lives only in the top rail (Fitts's law).
Put a reconnect action in (or link from) the map overlay itself.

## 8. Race Control can't tell "no incidents" from "not connected yet"
`RaceControl.tsx:43`. `state.messages.length === 0` renders "No incidents." both
before the snapshot arrives and when the session truly has none. Every other panel
distinguishes these; gate on `state.rev === 0` like the board does.

## 9. Settings page is a wall of prose with no progressive disclosure
`Settings.tsx:196-271`. Subscription warning, status, 4-step flow, three commands,
privacy and beta notes in one undifferentiated column; an already-linked operator
still scrolls the full onboarding. Branch the layout on link status and elevate the
paid-subscription warning. Related: the copy button gives no failure feedback and no
live-region success announcement (`Settings.tsx:20-39`), and its
`aria-label={`Copy: ${children}`}` breaks to "[object Object]" if a JSX child is
ever passed (`Settings.tsx:34`).

## 10. Zone D reads as one five-option control under time pressure
`App.tsx:267-277`. SourceToggle (persistent choice) and Freeze/Resume (momentary
verb) share one continuous row with no divider — Replay/Live/Freeze reads as one
choice. Add a visual group separator.

## 11. Rival-picker `<select>` has a transparent background
`TelemetryPanel.tsx:177` uses `.btn` (`background: transparent`); the overlay's
`.overlay-select` already does this right with explicit colours. One theme/browser
change from a light popup on a dark row. Reuse `.overlay-select`.

## 12. Tyre legend is formatted differently in Tower vs StintChart
`TimingTower.tsx:373-374` ("S Soft") vs `StintChart.tsx:105-107` ("Soft"), each
hand-rolled separately — consistency break plus drift risk for the colour-blindness
mitigations. Extract one shared legend.

## 13. Target-size and disabled-focus checks to verify live (WCAG 2.5.8 / focus loss)
- `.tt-clear` / `.rail-repo-active` sit exactly at the 24px floor — verify computed
  box (`components.css:1256,1536`).
- `.tt-select` likely under 24px at pointer:fine; defensible via the row-level hit
  target but worth an explicit code note (`components.css:760-778`).
- Ghost scrubber: toggling `disabled` on a focused range input can silently drop
  focus to `<body>` (`Ghost.tsx:353-372`).

## 14. Minor polish
- `↻ CLIP LOOPED` chip: fixed 8s, non-dismissable (`App.tsx:29,82-86`).
- Rival selection silently cleared when primary changes to match, no feedback
  (`App.tsx:159`).
- Three stacked footnote rows under the tower compete with the standings on the
  glanceability-first view (`TimingTower.tsx:348-380`).
- `timingHelpers.ts` hand-formats times — deliberate (broadcast format), add a
  one-line comment saying so to preempt Intl churn.
- Live 400%-zoom / 320px reflow check never run (content-based `min-width` chains
  could overflow) — WCAG 1.4.10.

## What's already strong (all three auditors agreed)
Measured-and-documented contrast tokens, reduced-motion wired into both JS animation
loops, roving-tabindex radiogroups that survive 10 Hz re-sorting, colour never the
sole signal (hatching, S/P glyphs, solid-vs-dashed rings), disciplined live regions
tuned against announcement storms, tabular-nums globally, honest data-quality
caveats, and `replaceState` URL-as-state that doesn't pollute history.
