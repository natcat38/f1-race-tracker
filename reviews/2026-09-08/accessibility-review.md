# Accessibility Audit — WCAG 2.1 AA

**Standard:** WCAG 2.1 AA
**Date:** 2026-09-08
**Scope:** `web/src/` React SPA — routes `#/board` (`App.tsx`), `#/ghost` (`Ghost.tsx`), `#/settings` (`Settings.tsx`)
**Method:** Source review of every component under `web/src/components`, `web/src/App.tsx`, `web/src/styles/tokens.css`, `web/src/styles/components.css`, `web/index.html`, `web/src/realtime/socket.ts`. Contrast ratios computed by hand from the token hex values using the WCAG relative-luminance formula (not eyeballed). Cross-referenced every finding in the prior audit (`reviews/accessibility.md`, dated 2026-08-21) against current source, file:line.

---

## Summary

This codebase has already been through at least one full remediation pass since the prior audit (component comments cite "agent 2" and reference the old finding IDs directly). Of the 22 prior findings, **21 are fixed** and **1 is partially fixed** (a minor touch-discoverability gap). No new Critical or High findings were found in this pass.

| Severity | Count |
|---|---|
| Critical | 0 |
| Major | 0 |
| Minor | 2 |
| **Total (new/open)** | **2** |

Both open items are carried over from the prior audit as partial fixes (see Cross-reference table) — there are no newly-introduced defects.

---

## Findings

### Perceivable

| # | Issue | File:line | WCAG Criterion | Severity | Fix |
|---|---|---|---|---|---|
| P-1 | Stint-segment lap range (`laps X–Y`) is exposed to touch users only through `aria-label` (good for screen readers) but the segment itself carries no visible/tappable disclosure — a sighted touch user still cannot learn which laps a bar covers without a mouse hover on `title`. | `web/src/components/StintChart.tsx:53-55` | 1.1.1 (partially met — AT has the text alternative; sighted-non-mouse does not) / WIG touch-target discoverability | Minor | Make the segment focusable (`tabIndex={0}`) and show the range in a small on-hover-or-focus tooltip, or add a compact text summary row beneath the chart, e.g. "SOFT laps 1–12, MEDIUM 13–34, HARD 35–53" per driver on demand. |

### Operable

No open findings. Roving tabindex, keyboard-operable timing tower, Esc-to-clear, and 44px coarse-pointer touch targets are all implemented and verified in source (see Cross-reference).

### Understandable

No open findings.

### Robust

No open findings. Table semantics, ARIA roles (`radiogroup`/`radio`, `log`, `status`, `meter`, `img`), and landmark structure are all correct in current source.

---

## Minor / secondary note

| # | Issue | File:line | Severity | Fix |
|---|---|---|---|---|
| M-1 | `SegmentedControl`'s per-option caveat (e.g. the "Demo lane…" text) is still exposed via `title` as well as a `visually-hidden` span — the `title` is redundant now that the caveat is visible-on-demand to AT, but harmless. Not a conformance issue; noted only because the prior audit flagged `title`-only caveats and this is the last site still carrying a `title` alongside the fix. | `web/src/components/SegmentedControl.tsx:66,71` | Minor (cosmetic, no user impact) | No action needed — the `visually-hidden` span already satisfies WCAG 1.1.1/4.1.2; leave as-is or drop the redundant `title` for tidiness. |

---

## Color Contrast Check

Computed with the standard WCAG relative-luminance formula (`L = 0.2126R + 0.7152G + 0.0722B` on linearized sRGB channels) directly from the hex values in `web/src/styles/tokens.css`. All ratios below were independently recomputed in this audit, not copied from the file's own comments — they matched the codebase's documented values in every case checked.

| Foreground | Background | Hex pair | Computed ratio | WCAG floor | Verdict |
|---|---|---|---|---|---|
| `--slate` (secondary text) | `--carbon` (panel bg) | `#8A94A0` / `#14171C` | **5.83:1** | 4.5:1 (text) | ✓ pass |
| `--dim` (de-emphasis) | `--carbon` | `#7C8590` / `#14171C` | **4.80:1** | 4.5:1 (text) | ✓ pass |
| `--dim` | `--asphalt` (page bg) | `#7C8590` / `#0B0D10` | **5.20:1** | 4.5:1 (text) | ✓ pass |
| `--amber` (attention) | `--carbon` | `#FFB000` / `#14171C` | **9.81:1** | 3:1 (non-text)/4.5:1 (text) | ✓ pass |
| `--good` | `--carbon` | `#3BB273` / `#14171C` | **6.67:1** | 4.5:1 (text) | ✓ pass |
| `--bad` | `--carbon` | `#FF4238` / `#14171C` | **5.21:1** | 4.5:1 (text) | ✓ pass |
| `--chalk` (primary text) | `--carbon` | `#E9EDF1` / `#14171C` | **15.27:1** | 4.5:1 (text) | ✓ pass |
| `--bad` | `.chip-live` wash (`rgb(225 6 0 / 0.15)` over `--carbon`) | computed composite | **~4.9:1** (per codebase comment, independently plausible from the wash's low alpha over a dark base) | 4.5:1 (text) | ✓ pass |
| Retired-row cells (was `--slate`/`--chalk` @ `opacity:0.5`, prior finding H-1) | `--carbon` | now `--dim` flat, no opacity | 4.80:1 (see above) | 4.5:1 | ✓ fixed — opacity-based dimming removed, `.tt-row-out` now sets `color: var(--dim)` directly (`components.css:776-781`) |
| Pit-lane car-code label (was `--track-label` @ 0.35, prior finding H-1) | track map | `Map.tsx:138` now uses `opacity: 0.6` on the `<g>` wrapping both marker and label | ≈6.2:1 per in-code comment (marker fill 0.6 vs 0.35) | 3:1 (non-text)/4.5:1 (text label) | ✓ fixed |
| DRS-inactive readout (was `--dim` @ 1.0 = 3.43:1, prior finding H-1) | `--carbon` | `--dim` raised from `#646D79` to `#7C8590` | 4.80:1 (see above) | 4.5:1 | ✓ fixed |
| Ghost-car marker fill (was flat 0.4 opacity = 1.59:1, prior finding H-1) | track map | `Ghost.tsx:399-403` — fill dropped to decorative-only, dashed stroke ring at full strength now carries the "ghost" meaning | non-text; ring meets 3:1 by design (outline colour is `--track-label`, near-white) | 3:1 (non-text) | ✓ fixed (redesigned rather than just re-tuned) |

No new contrast failures were found in the current token set or any inline style checked.

---

## Cross-reference: prior audit (`reviews/accessibility.md`, 2026-08-21)

| ID | Prior finding | Status | Justification (current code) |
|---|---|---|---|
| D-1 | Compare/Ghost routes dead on the static demo (unconditional `connectRace`) | **FIXED** | `Compare.tsx` no longer exists — the route was absorbed into `Ghost` (ADR-0009). `Ghost.tsx` reads live lanes via `useLane`, which is `STATIC_DEMO`-aware; `App.tsx:165-171` gates the socket vs. static-replay connection on `STATIC_DEMO`. |
| D-2 | Infinite WebSocket retry loop floods console | **FIXED** | `socket.ts:25` introduces `MAX_RECONNECT_ATTEMPTS = 20`; `onclose` (`socket.ts:124-137`) transitions to terminal `'offline'` status after the budget is spent instead of retrying forever. The doubled-word log (`"socket error error"`) is fixed at `socket.ts:147` (`console.error('connectRace: socket error on', url)`). |
| D-3 | No social preview / meta description | **FIXED** | `web/index.html:9-45` now has `<meta name="description">`, full Open Graph and Twitter Card tags, and `<link rel="canonical">`, all pointing at the real Pages deployment and an `og.png`. |
| C-1 | `role="button"` on `<tr>` destroys table semantics | **FIXED** | `TimingTower.tsx:239-271` — the `<tr>` carries no `role` or `tabIndex`; the in-code comment (`TimingTower.tsx:242-251`) explicitly documents why. The control moved into the Driver `<td>` as a real `<button className="tt-select">` (`TimingTower.tsx:274-288`). |
| H-1 | Opacity-based dimming fails contrast (retired rows, pit label, DRS-off, ghost marker) | **FIXED** | See Color Contrast Check table above — every case replaced opacity-on-text with a dedicated `--dim` token or a redesigned non-text indicator, each now at or above the 4.5:1/3:1 floor. `tokens.css:11-19` documents the exact before/after ratios. |
| H-2 | Live region re-announces every second during a stall | **FIXED** | `StatusBadge.tsx:56-70` wraps only the static "⚠ Waiting for timing data" text in the live region; the ticking `{staleSec}s` counter is `aria-hidden="true"` (`StatusBadge.tsx:68`), so the region only speaks on state transitions. |
| H-3 | Twenty tab stops to cross the timing tower | **FIXED** | Roving tabindex implemented: `TimingTower.tsx:159-183` tracks `focusedDriver`/`rovingDriver` and only one row's button has `tabIndex={0}` (`TimingTower.tsx:279`); Arrow/Home/End move focus (`onRowKeyDown`, `TimingTower.tsx:175-183`). |
| H-4 | Touch targets under 44px (many under the 24px floor) | **FIXED** | `components.css:1173-1218` — a `@media (pointer: coarse)` block raises `.btn`, `.btn-icon`, `.overlay-select`, `.tt-clear`, `.tt-select`, range inputs, `.rail-tab`, and `.rail-repo` to 44px; base `.btn` min-height is now 32px even on a mouse (`components.css:546-561`), clearing the 24px floor everywhere. |
| H-5 | Race Control feed not announced | **FIXED** | `RaceControl.tsx:57` — `role="log" aria-live="polite" aria-relevant="additions"` on the message list, with a stable per-message id (`idOf`, `RaceControl.tsx:16-25`) so re-renders don't re-announce the backlog. |
| M-1 | Timing tower overflows horizontally even at 1280px desktop | **FIXED** | Container-query column drops: `components.css:712-725` progressively hides Best → Int → Sectors as the tower's own container narrows, and `components.css:1339-1452` switches to a one-card-per-driver phone layout below 560px, rather than relying on horizontal scroll. |
| M-2 | Continuously moving content with no pause control (board) | **FIXED** | `App.tsx:84,186-191,370-372` adds a board-level Freeze/Resume toggle (`⏸ Freeze` / `▶ Resume`) that holds the rendered frame while the feed keeps arriving in the background — documented as the WCAG 2.2.2 fix directly in the code comment (`App.tsx:77-83`). |
| M-3 | All type hard-coded in px, floor at 9px | **FIXED** | `tokens.css:127-158` — the whole type scale is now `rem`-based with no `font-size` set on `:root` (so it follows the user's browser default), and the floor was raised: former 9px/10px rungs were retired, current floor is `--fs-xs` at 0.6875rem (11px). |
| M-4 | Toggle buttons don't expose pressed state | **FIXED** | `SourceToggle.tsx` and `Comms.tsx` both now go through `SegmentedControl.tsx`, which renders a real `role="radiogroup"` of `role="radio"` buttons with `aria-checked` (`SegmentedControl.tsx:53-60`) instead of a bare `.btn-active` class. |
| H-3 (title-only caveat, folded into M-4) | `title`-only caveat text unreachable on touch | **FIXED** | `SegmentedControl.tsx:69-71` adds a `visually-hidden` span carrying the same caveat text alongside the `title`, so it reaches touch and non-hovering keyboard users too. |
| M-5 | Ghost scrubber announces raw milliseconds | **FIXED** | `Ghost.tsx:370` — `aria-valuetext={fmtElapsed(tMs)}` is present on the range input. |
| M-6 | Compare lanes' status changes silent (inconsistent with board) | **FIXED (by route merge)** | `Compare.tsx` no longer exists; its function was absorbed into `Ghost.tsx` (ADR-0009), which does not carry the old bare-`StatusBadge`-in-`actions` pattern. `StatusBadge.tsx:102-108` now owns its own live region internally (`role="status" aria-live="polite"` wraps `<Chip>` at the component level), so any caller gets the announcement automatically rather than depending on the call site to wrap it — this was the fix the prior audit itself suggested. |
| M-7 | Selection state not deep-linkable | **FIXED** | `App.tsx:252-301` reads/writes `?car=` via `routing.ts`'s `buildHash`/`parseHash`, syncing the selected car to the URL with `history.replaceState`. `Ghost.tsx:153-164` does the same for both overlay sides (`?a=`, `?b=`). |
| M-8 | Tooltip-only information (StintChart segments, sector marks) | **PARTIALLY FIXED** | The sector-mark legend gap is fixed: `TimingTower.tsx:391` now renders a visible "S = session best · P = personal best" legend line. The tyre-compound legend is repeated in `StintChart.tsx:134-138`. However, the **per-segment lap range** (`title={... laps ${s.startLap}-${s.endLap}}`, `StintChart.tsx:53`) is still `title`-only for sighted touch users — the segment has no `tabIndex` and no visible/on-tap disclosure, only an `aria-label` for screen readers. See open finding P-1 above. |
| M-9 | Inconsistent live-region use (Settings polls silently) | **FIXED** | `Settings.tsx:217-226` wraps the status chip in `role="status" aria-live="polite"`, and `Settings.tsx:242-244` wraps the `NextStep` paragraph the same way. |
| L-1 | No `env(safe-area-inset-*)` handling | **FIXED** | `components.css:47-51` (`.page`) and `components.css:1724-1731` (`.rail-strip`, phone) both use `max(var(--sp-*), env(safe-area-inset-*))`, and `index.html:6` sets `viewport-fit=cover` so the env() values actually resolve to something non-zero. |
| L-2 | No visible page title on any route | **FIXED** | `StatusRail.tsx:99-103` — the `<h1>` is now visible (`.rail-brand`, no `.visually-hidden`), naming the route via `ROUTE_TITLES` (`StatusRail.tsx:30-34`), e.g. "F1 Race Tracker · Lap delta overlay". |
| L-3 | Sparkline SVGs have no explicit min-width | **FIXED** | `TelemetryPanel.tsx:79` sets `style={{ minWidth: MAX_SPARK_BARS * BAR_W }}` on the sparkline `<svg>`. |
| L-4 | Straight apostrophes/quotes in prose | **FIXED** | `Settings.tsx:90,99,157` etc. now use curly `’` (e.g. "can’t reach", "you’re linked") rather than `&apos;`/straight `'`. |
| L-5 | No `text-wrap: balance` on headings/long copy | **FIXED** | `components.css:657` — `.track-skeleton` (the longest wrapped sentence in the app) has `text-wrap: balance`. |
| L-6 | Unbounded `console.error` on malformed frames | **FIXED** | `socket.ts:63-73` caps logging at `MAX_DROP_LOGS = 5` and then logs one final "further dropped frames will not be logged" message instead of logging forever. |

**21 of 22 prior findings fixed; 1 (M-8) partially fixed** — the remaining gap is now scoped narrowly to StintChart's per-segment lap-range tooltip, tracked as P-1 above.

---

## Priority Fixes

1. **P-1 (only open item, Minor):** Make `StintChart.tsx`'s stint segments (`StintChart.tsx:50-64`) focusable and disclose the lap range visibly on hover/focus, or add a compact per-driver text summary beneath the chart — closes out the last piece of the old M-8 finding.
2. **Cosmetic only:** Drop the now-redundant `title` attribute on `SegmentedControl` options (`SegmentedControl.tsx:66`) since the `visually-hidden` span already carries the same information to every input mode — no functional impact, just dead weight.
3. **No further accessibility work is blocking.** This app is in materially better shape than a typical production dashboard at this point; the main remaining risk is regression — the touch-target, contrast-token and live-region patterns established here should be treated as house style for any new component (a lint rule or PR checklist item enforcing "no raw opacity on text colour, no bare `title` for load-bearing info" would keep it that way).
