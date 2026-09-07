# Accessibility & Web Interface Guidelines Audit

**Scope:** React SPA in `web/src/` — routes `/`, `/#compare`, `/#ghost`, `/#settings`
**Audited:** local full app at `http://localhost:8080` + public static demo at `https://natcat38.github.io/f1-race-tracker/`
**Standard:** [Web Interface Guidelines](https://github.com/vercel-labs/web-interface-guidelines) + WCAG 2.2 AA
**Method:** source review of all 2,901 lines under `web/src/`, plus live DOM inspection, computed-contrast measurement (WCAG relative-luminance math against actual rendered composites), real keyboard tabbing, and viewport testing at 1280 / 640 / 375 px.
**Date:** 2026-08-21 — read-only audit, no code changed.

---

## Summary

| Severity | Count |
|---|---|
| Critical | 2 |
| High | 5 |
| Medium | 9 |
| Low | 6 |
| **Total** | **22** |

### What is already good

This codebase has clearly had an accessibility pass, and several things are done better than most production dashboards. Calling them out so they don't get regressed:

- **Reduced motion is handled properly and completely.** CSS is opt-*in* via `@media (prefers-reduced-motion: no-preference)` (`components.css:364`) rather than the usual opt-out, and both JS-driven motion sources honour it too — the map's rAF interpolation (`useSmoothedCars.ts:41`) and the ghost playback loop (`Ghost.tsx:74`). `useReducedMotion.ts` subscribes to the media query so a mid-session OS change takes effect without a reload. This is a genuinely exemplary implementation.
- **The timing tower is a real `<table>`**, not div soup — `<thead>`/`<tbody>` with `<th scope="col">` on all ten columns (`TimingTower.tsx:65-79`). (The `role="button"` override on rows undoes most of the benefit — see C-1 — but the underlying markup is right.)
- **Colour is never the only signal.** Sector bests carry an `S`/`P` glyph alongside the purple/green (`timingHelpers.ts:153`), and slower sparkline bars get a hatch pattern overlay (`TelemetryPanel.tsx:41-49`). Deliberate, and correct.
- **Skip link on every route**, as the first focusable element, targeting a real `<main>` landmark (`Route.tsx:15-18`).
- **Unbroken heading chain** — one `<h1>` per route (visually hidden), `<h2>` per panel, `<h3>` inside Settings. Verified live: no skipped levels.
- **`color-scheme: dark`** is set (`tokens.css:4`), and the native `<select>` and `range` input get explicit dark styling for Windows (`components.css:392-437`).
- **`font-variant-numeric: tabular-nums`** globally on `body` (`tokens.css:62`) — correct for a timing board.
- **No anti-patterns from the guidelines' flag list**: no `transition: all`, no `outline: none`, no `user-scalable=no`, no `<div onClick>`, no `onPaste` blocking, no images without dimensions, no icon buttons without `aria-label`. Verified by stylesheet scan and DOM query.
- **Navigation uses real `<a href="#…">`** (`StatusRail.tsx:64-71`), so Cmd/Ctrl+click and middle-click work.
- **Loading copy correctly ends in `…`** (the real character, not three dots) throughout.

---

## GitHub Pages demo — first impressions

This is the URL a recruiter opens first, so it gets its own section.

### What works

The board route (`/`) is genuinely solid on Pages: **loads cleanly, zero console messages, data streaming** (20 driver rows, lap 13/53, weather readout populated). `<html lang="en">` is set, `<title>` renders, `theme-color` matches the page background, and the favicon returns `200 image/svg+xml` at the correct base-path-rewritten URL. The static-demo build (`VITE_STATIC_DEMO=true`, `App.tsx:41,53`) does its job on the board.

### D-1 — Two of the four nav tabs are permanently broken on the public demo — **Critical**

*Guideline: Handle empty states — don't render broken UI. Error messages include fix/next step.*

`App.tsx:53` correctly swaps `connectStaticReplay` for `connectRace` when `STATIC_DEMO` is set — but **only for the board route**. `Compare` and `Ghost` call `connectRace` unconditionally:

- `web/src/components/Compare.tsx:20` — `useEffect(() => connectRace(setState, setStatus, session), [session])`
- `web/src/components/Ghost.tsx:23-24` — two unconditional `connectRace` calls

`socket.ts:25` builds the socket URL from `location.host`, so on Pages it dials `wss://natcat38.github.io/ws?session=…`, which does not and cannot exist — GitHub Pages serves static files only.

Observed live on `https://natcat38.github.io/f1-race-tracker/#compare`, after 4 s:

```
2023 — …   ↺ RECONNECTING…   Warming up the timing feed…
2024 — …   ↺ RECONNECTING…   Warming up the timing feed…
```

And on `#ghost`: `Connection lost — retrying automatically…`, with the driver dropdown stuck on `Waiting for driver data…`.

Both stay that way forever. A visitor who clicks **COMPARE** or **OVERLAY** — half the navigation — gets a dead loading state with no explanation, and no indication that these features work fine in the real deployment. Worse, the "OVERLAY / lap delta" route is the app's most distinctive feature.

**Fix:** either (a) bake static clips for the compare and ghost sessions and route them through `connectStaticReplay` the same way the board does, or (b) if that's more work than it's worth right now, gate on `STATIC_DEMO` and render an honest explanatory panel — "Side-by-side compare needs the live gateway; run `docker compose up` to see it, or watch the 20-second clip below" — plus a screenshot or GIF. Option (b) is a one-hour change and turns a broken link into a portfolio talking point. Consider also hiding or visibly disabling the two tabs in `StatusRail.tsx:7-12` under `STATIC_DEMO`, so nobody is invited into a dead end.

### D-2 — Infinite WebSocket retry loop floods the console with errors — **Critical**

*Guideline: no console errors on load.*

`socket.ts:69-74` retries forever with exponential backoff capped at 8 s, and `socket.ts:76` logs to `console.error` on every failure. On Pages, where the socket can never succeed, this is an unbounded error stream. Captured from `#compare`:

```
[error] WebSocket connection to 'wss://natcat38.github.io/ws?session=compare-monza-2023' failed:
[error] connectRace: socket error error
[error] WebSocket connection to 'wss://natcat38.github.io/ws?session=compare-monza-2024' failed:
[error] connectRace: socket error error
… repeating indefinitely, every 8 s, two per cycle
```

Any technical visitor who opens devtools — and on a portfolio piece, some will — sees a console scrolling with errors. The message text is also unhelpful: `'connectRace: socket error', ev.type` prints the literal string `error`, so the log line reads `connectRace: socket error error`.

**Fix:** fixing D-1 removes the cause. Independently, `socket.ts:73` should cap total retry *attempts* (not just the backoff interval) and transition to the terminal `'failed'` status — which already exists in the `ConnStatus` union (`socket.ts:9`) and is already rendered by `StatusBadge.tsx:15-17` — after, say, 6 attempts. That turns an infinite error loop into one actionable message. Also fix the doubled word at `socket.ts:76`.

### D-3 — No social preview, no meta description — **High**

*Guideline: sensible meta/title/social tags.*

`web/index.html:3-9` — the entire `<head>` is `charset`, `viewport`, `theme-color`, `title`, favicon. Verified against the deployed page; nothing is injected at build time.

Missing:

| Tag | Effect of absence |
|---|---|
| `<meta name="description">` | Google invents a snippet from page text — which here is `"Skip to content Race board — Monza 2024 · Race F1 RACE TRACKER…"` |
| `og:title` / `og:description` / `og:image` / `og:url` / `og:type` | **Pasting the link into LinkedIn, Slack, or a DM produces a bare grey URL with no preview card.** For a link whose whole job is to be shared with recruiters, this is the highest-leverage item in this report. |
| `twitter:card` (`summary_large_image`) | Same, on X. |
| `<link rel="canonical">` | Minor SEO. |

The title `F1 Race Tracker` is also doing no work — it's the project name with no indication of what the thing is.

**Fix:** add to `web/index.html`. An `og:image` needs to be a real absolute URL (Pages will serve it from `web/public/`); a 1200×630 screenshot of the board is ideal, and the board screenshots well.

```html
<title>F1 Race Tracker — Live Timing Tower &amp; Telemetry</title>
<meta name="description" content="A broadcast-style Formula 1 timing board: live timing tower, track map, tyre strategy, and a lap-delta ghost overlay. Built with React, Go, and Python." />
<link rel="canonical" href="https://natcat38.github.io/f1-race-tracker/" />
<meta property="og:type" content="website" />
<meta property="og:url" content="https://natcat38.github.io/f1-race-tracker/" />
<meta property="og:title" content="F1 Race Tracker — Live Timing Tower &amp; Telemetry" />
<meta property="og:description" content="A broadcast-style Formula 1 timing board: live timing tower, track map, tyre strategy, and a lap-delta ghost overlay." />
<meta property="og:image" content="https://natcat38.github.io/f1-race-tracker/og-preview.png" />
<meta property="og:image:width" content="1200" />
<meta property="og:image:height" content="630" />
<meta name="twitter:card" content="summary_large_image" />
```

One caveat: the demo streams a **2024 Monza replay** but the board labels it `▶ REPLAY` fairly subtly. A first-time visitor may not register that this is recorded data. Worth a line in the meta description and, ideally, a visible one-line strapline on the board.

---

## Critical

### C-1 — `role="button"` on `<tr>` destroys the timing tower's table semantics — **Critical**

**Where:** `web/src/components/TimingTower.tsx:90-107` (board route, Timing panel)
*Guideline: Use semantic HTML (`<button>`, `<a>`, `<label>`, `<table>`) before ARIA.*

The tower is built as a proper `<table>` with `<th scope="col">` headers — and then every body row overrides itself to `role="button"`:

```jsx
<tr
  className={isSel ? 'tt-row tt-row-selected' : 'tt-row'}
  role="button"
  tabIndex={0}
  aria-pressed={isSel}
```

The in-code comment reasons about why `aria-selected` was avoided, which is correct as far as it goes — but `role="button"` is a much more damaging substitute, for two reasons.

**1. It discards the column-header association for the entire table body.** `role="button"` replaces the row's implicit `row` role. A `button` has a *presentational children* content model, so every `<td>` inside it is stripped of its `cell` role in the accessibility tree. The `scope="col"` headers at `TimingTower.tsx:68-77` are therefore associated with nothing. All ten columns of carefully-built table semantics — `#`, `Driver`, `Gap`, `Int`, `Last`, `Best`, `Tyre`, `S1`, `S2`, `S3` — are inert. Screen-reader table navigation (NVDA/JAWS `Ctrl+Alt+arrows`) cannot enter the body at all; only the header row remains a real row.

**2. The accessible name becomes an unreadable run-on string.** Because the children collapse into the button's name, each row is announced as one continuous blob. Measured live from the running app, row 1:

```
"1PIALEADER—1:24.7481:24.077M1327.848+0.24828.860+0.13428.040S+0.119"
```

That is what a screen-reader user hears for a single driver — 66 characters of unseparated digits, with no indication which number is the gap, which is the last lap, or which are sector times. Twenty rows of this. The panel is effectively unusable non-visually, which is a shame given how much correct structure is already underneath.

**Fix — pick one:**

**(a) Keep the table, move the control into a cell.** Most faithful to the data, and preserves everything:

```jsx
<tr className={isSel ? 'tt-row tt-row-selected' : 'tt-row'}>
  <td>{idx + 1}</td>
  <td>
    <button
      className="tt-select"
      aria-pressed={isSel}
      onClick={() => onSelect(c.driverNum)}
    >
      <b>{c.code}</b>
      <span className="visually-hidden">
        {isSel ? ' — reference car' : ` — set ${c.code} as reference car`}
      </span>
    </button>
  </td>
  {/* remaining cells unchanged, still real cells under their headers */}
</tr>
```

Row-wide click can be kept as a convenience via `onClick` on the `<tr>` *without* `role`/`tabIndex` — a mouse affordance layered on top of a keyboard-accessible button, which is legitimate. This also fixes H-3 (tab-stop flooding) for free, since the twenty stops become twenty *named* stops.

**(b) Convert to a real grid.** `role="grid"` on the table, `role="row"` on rows, `role="gridcell"` on cells, `aria-selected` on the row (now valid, unlike in a plain table), and a roving `tabIndex` so the whole tower is one tab stop with arrow-key navigation. More work, but this is the pattern broadcast timing towers actually want, and it makes `aria-selected` correct rather than something to work around.

Either way, delete `role="button"` from the `<tr>`.

---

## High

### H-1 — Dimmed and pit-lane states fail contrast, some severely — **High**

*Guideline / WCAG 1.4.3: text needs 4.5:1 (3:1 for large text).*

The base palette is well-built and mostly comfortable — `--slate` on `--carbon` measures **5.84:1**, chips 4.7:1, amber 9.8:1, and the tokens file documents its own ratios. The failures are all in states produced by **`opacity` applied on top of that palette**, which the token-level contrast comments do not account for.

Measured with WCAG relative-luminance math against the actual rendered composite:

| State | Where | Ratio | Verdict |
|---|---|---|---|
| Retired-car `Gap`/`Int` cells + sector-delta superscripts (`--slate` @ 0.5) | `TimingTower.tsx:106` | **2.40:1** | ✗ fail (needs 4.5) |
| Pit-lane car code on the track map (`--track-label` @ 0.35) | `Map.tsx:16,18` | **2.95:1** | ✗ fail |
| Sector personal-best marks in a retired row (`--good` @ 0.5) | `TimingTower.tsx:106,144` | **2.59:1** | ✗ fail |
| DRS-inactive readout (`--dim` @ 1.0) | `TelemetryPanel.tsx:84`, `tokens.css:11` | **3.43:1** | ✗ fail |
| DRS-inactive inside a dimmed context (`--dim` @ 0.5) | as above | **1.77:1** | ✗ fail badly |
| Retired-car driver code / lap times (`--chalk` @ 0.5) | `TimingTower.tsx:106` | 4.65:1 | ✓ marginal pass |
| Ghost-car marker fill @ 0.4 | `Ghost.tsx:146` | 1.59:1 | ✗ fail (non-text, needs 3:1) |

The pattern is consistent: `opacity` is being used to express "de-emphasised", but it multiplies against a palette that was already tuned near the 4.5:1 floor, so the secondary-text colours drop straight through it. `--dim` is a separate case — `tokens.css:11` documents it as "3.4:1 on carbon" and `TelemetryPanel.tsx:82-83` explains it was *raised* from `--edge` (1.2:1). That was a real improvement, but it stopped short of the threshold.

**Fix:** stop expressing de-emphasis with `opacity` on text, and use a dedicated colour token instead. Replace `style={{ opacity: 0.5 }}` at `TimingTower.tsx:106` with a class:

```css
.tt-row-out td { color: #7C8590; }        /* ≈4.6:1 on --carbon, reads as dimmed */
.tt-row-out .tt-sup { color: #7C8590; }
```

The row will still read as clearly de-emphasised against the full-strength `--chalk` rows around it — relative contrast against neighbours is what communicates "retired", and that survives fine at 4.6:1. Note the row already carries the text label `OUT` in the Gap cell (`timingHelpers.ts:94`), so the dimming is reinforcement, not the sole signal — which is why it can safely be made *less* aggressive.

For the map (`Map.tsx:16`), 0.35 on a car marker is non-text UI and only needs 3:1, but the driver *code* beside it is text. Raise pit opacity to ~0.6 and keep the `<text>` label at full opacity, or move the pit indication into the label itself (`ALO (PIT)`).

For `--dim`, lift to about `#7C8590` (≈4.6:1). And since DRS on/off is currently signalled by colour alone, add a non-colour cue — the guidelines' own colour-independence rule and the same principle already applied to sectors and sparklines elsewhere in this codebase:

```jsx
<span style={{ color: car.drs ? 'var(--good)' : 'var(--dim)' }}>
  DRS<span className="visually-hidden">{car.drs ? ' active' : ' inactive'}</span>
</span>
```

Minor, same family: `TYRE_COLOUR.WET` (`#3671C6`, `timingHelpers.ts:79`) measures **4.37:1** as text on `--carbon` — just under the line. Nudge to `#4A8AD8` (≈5.2:1).

### H-2 — Live region re-announces once per second during any stall — **High**

**Where:** `StatusRail.tsx:54-56` + `StatusBadge.tsx:24-30` + `useStale.ts:34-40`
*Guideline: async updates need `aria-live="polite"` — but sanely.*

The board's 10 Hz frame stream is correctly kept *out* of live regions (verified: the tower contains no `aria-live`, which is the right call — 10 announcements per second would be catastrophic). But the status badge has the inverse problem.

`StatusRail.tsx:54` wraps the badge in `<span role="status" aria-live="polite">`. When the feed stalls, `StatusBadge.tsx:24-30` renders:

```jsx
⚠ Waiting for timing data — last frame {staleSec}s ago
```

and `useStale.ts:37` increments `staleSec` on a **1000 ms interval**. So the live region's text content changes every second, and a polite live region announces every change. During an outage a screen-reader user gets *"Warning, waiting for timing data, last frame 5 seconds ago… last frame 6 seconds ago… last frame 7 seconds ago…"* indefinitely, with each announcement queued behind the last. Because polite announcements queue rather than interrupt, the user progressively falls further behind real time and cannot hear anything else on the page.

This is precisely the failure mode a stall is worst for — the user most needs to interact with the page when it's broken.

**Fix:** announce the *state transition*, not the counter. Keep the ticking number visible, exclude it from the announcement:

```jsx
<span className="chip chip-stall">
  <span role="status" aria-live="polite">
    {staleSec >= STALE_THRESHOLD_SEC ? '⚠ Waiting for timing data' : ''}
  </span>
  <span aria-hidden="true"> — last frame {staleSec}s ago</span>
</span>
```

The announcement now fires once when the stall begins and once when it clears. Alternatively coarsen the counter (`useStale` at 1 s is right for the visual, but the announced copy could bucket to 15 s / 30 s / 1 min).

### H-3 — Twenty tab stops to cross the timing tower — **High**

**Where:** `TimingTower.tsx:97` (`tabIndex={0}` on every row)

Verified live: the board has **29 focusable elements, 20 of which are timing-tower rows**. A keyboard user reaching the Comms panel must press Tab 20 times through the tower, and — because of C-1 — each stop announces one of those 66-character run-on strings. Reverse-tabbing out of the bottom of the page is equally slow.

This is the standard argument for a **roving tabindex**: the composite widget is one tab stop, and arrow keys move within it.

**Fix:** if taking C-1 option (b), the roving tabindex comes as part of the grid pattern. If taking option (a), track a focused row index and set `tabIndex={idx === focusedIdx ? 0 : -1}`, handling `ArrowUp`/`ArrowDown`/`Home`/`End` on the `<tbody>`. Either way the tower becomes one stop instead of twenty.

Note the existing `onKeyDown` handler (`TimingTower.tsx:100-105`) is otherwise correct — it handles both `Enter` and `Space` and calls `preventDefault()` on Space to stop page scroll. Keep that logic.

### H-4 — Touch targets below the WCAG 2.2 minimum — **High**

*Guideline: touch targets; WCAG 2.2 AA §2.5.8 requires 24×24 CSS px minimum.*

Measured at the 375 px mobile viewport — **25 of 29 interactive targets are under 44 px tall**, and these fall under the hard 24 px floor:

| Target | Size | File |
|---|---|---|
| "Show seconds" / "Show laps" toggle | **110 × 19** | `TimingTower.tsx:57-63` (inline `padding: '2px 8px'`) |
| Timing tower rows (×20) | 809 × **23** | `components.css:303-305` (`.tt-table td { padding: 2px }`) |

The rows at 23 px miss by 1 px, which is marginal — but they are the app's primary interaction, and on a phone a 23 px row in a 20-row stack is a genuine mis-tap hazard. The "Show seconds" button at 19 px is a clear failure.

Others sit between 24 and 44 px — acceptable under WCAG but below the guidelines' preferred 44 px: source-toggle buttons (27 px, `components.css:215-226`), Comms toggle (26 px). The nav tabs are fine at 57 px, and `.btn-icon` (`components.css:235-240`) already reaches for a larger target with `min-width/min-height: 36px` — the right instinct, just not applied to the text buttons.

**Fix:** raise `.btn` to `min-height: 32px` (44 px under a coarse-pointer query), drop the inline `padding: '2px 8px'` override at `TimingTower.tsx:60` so the button uses the class, and lift row padding under coarse pointers:

```css
@media (pointer: coarse) {
  .btn { min-height: 44px; }
  .tt-table td { padding-block: 8px; }
}
```

### H-5 — Race Control feed is the one thing that should be announced, and isn't — **High**

**Where:** `web/src/components/RaceControl.tsx:22-41`

The Race Control panel streams flags, safety-car deployments, and incident investigations — the highest-urgency information on the board, and the only content where a *change* is inherently newsworthy rather than continuous. It has no live region, so new incidents arrive silently for a screen-reader user; they would have to poll the panel manually.

Meanwhile three live regions do exist (`StatusRail.tsx:54`, `SourceToggle.tsx:54`, `Comms.tsx:72`), so the pattern is clearly understood elsewhere — this panel just missed it.

Unlike the 10 Hz timing stream, this feed is genuinely low-frequency (`MAX_SHOWN = 8`, newest-first), so a polite region is safe here.

**Fix:** wrap the list, and announce only the newest entry so re-renders of the existing eight don't re-announce:

```jsx
<div style={{ display: 'grid', gap: 4 }} role="log" aria-live="polite" aria-relevant="additions">
```

`role="log"` is the correct role for a chronological feed of newest-first messages. Because `RaceControl.tsx:20` does `.slice(-MAX_SHOWN).reverse()`, prepending a new message re-orders the DOM; if that proves to announce too much in testing, render the newest message into a separate one-line `role="status"` region and mark the visible list `aria-hidden="true"`.

---

## Medium

### M-1 — Timing tower overflows horizontally, even on a 1280 px desktop — **Medium**

**Where:** `components.css:285-294` (`.tt-scroll`), `components.css:321-338` (grid), `TimingTower.tsx:64`

Measured live at a **1280 px desktop** viewport: the tower's container is **567 px wide, the table is 795 px**. The board's ten columns already don't fit on a standard laptop — `S1`/`S2`/`S3`, arguably the most interesting columns, are off-screen behind a horizontal scrollbar by default.

At **375 px mobile** it's 809 px in a ~327 px container — a 2.5× overflow. The `.tt-scroll` wrapper does correctly contain it (the page body does *not* overflow horizontally, verified — good), but "correctly contained" still means a phone user sees `#`, `Driver`, and a sliver of `Gap`.

The `@media (max-width: 1100px)` rule (`components.css:333-338`) collapses the grid to one column, which helps the *panels* but does nothing for the table's intrinsic width.

Compounding: because `.panel` sets `overflow: hidden` (`components.css:184`) and `.tt-scroll` sets `overflow: auto`, the 2 px focus outline with `outline-offset: 2px` on a focused row is **clipped at the horizontal edges** — so the keyboard focus indicator on the tower's primary control is partially cut off. (The ring does otherwise paint correctly: verified by real Tab presses, `outline: rgb(233,237,241) solid 2px`, and `:focus-visible` matches. It's the clipping that's the issue.)

**Fix:** drop columns by breakpoint rather than scrolling them off. Sector columns and `Best` are the natural casualties on narrow screens:

```css
@media (max-width: 900px) {
  .tt-table th:nth-child(n+8), .tt-table td:nth-child(n+8) { display: none; } /* S1–S3 */
}
@media (max-width: 520px) {
  .tt-table th:nth-child(6), .tt-table td:nth-child(6) { display: none; }     /* Best */
}
```

Sector detail is already available per-driver in the Telemetry panel, so nothing is truly lost. For the focus clipping, add `scroll-margin` and let the row ring sit inside: reducing `outline-offset` to `-2px` for `.tt-row:focus-visible` draws the ring *inside* the row bounds, immune to the clip.

### M-2 — Continuously moving content with no pause control — **Medium**

**Where:** `Map.tsx:15-20` via `useSmoothedCars.ts:38-57`; the tower at `App.tsx:98-100`
*Guideline: autoplay motion >5 s alongside other content needs pause, stop, or hide controls. WCAG 2.2.2.*

The board's car markers animate continuously via `requestAnimationFrame` from page load, indefinitely, alongside other content — and there is no pause, stop, or hide control. The timing tower likewise repaints at 10 Hz forever. WCAG 2.2.2 requires a mechanism to pause any automatically-starting motion that runs beyond 5 seconds.

`prefers-reduced-motion` is honoured (`useSmoothedCars.ts:41`) and removes the *interpolation glide*, but the underlying 10 Hz positional jumps remain — so even reduced-motion users get continuous movement, and users who want to pause without changing an OS-level setting have no option at all. This matters for readers with vestibular sensitivity, and for anyone who simply wants to read a row without it moving.

The `#ghost` route gets this right — it has an explicit Play/Pause button (`Ghost.tsx:193-197`). The board just needs the same affordance.

**Fix:** add a Freeze/Resume toggle to the board that stops applying incoming frames to the rendered state (keep buffering; on resume, snap to latest). One button in the status rail, next to `SourceToggle`. This is also a genuinely useful *feature* — pausing a timing board to read it is something race engineers want — so it's not purely a compliance tax.

### M-3 — All type is hard-coded px; smallest text is 9 px — **Medium**

**Where:** `tokens.css:41-48`
*Guideline: text scaling.*

Every size token is an absolute px value, and a repo-wide search confirms **no `rem` or `em` font sizing anywhere** in `web/src`. Consequences:

- A user who raises their browser's **default font size** (a common low-vision accommodation, and the one users reach for before zoom) sees **no change at all**. Only full-page zoom responds.
- The floor is very low: `--fs-3xs: 9px` and `--fs-2xs: 10px`. Verified in the running app, 9 px is used for the sector-best `S`/`P` marks and the sector delta superscripts (`TimingTower.tsx:135,143`) — small, dense, numeric text that carries real meaning (`+0.108`, `+0.096`). 10 px carries the tyre legend, the "Gap / Int are estimates" disclaimer, and Race Control timestamps and category labels (`RaceControl.tsx:30-31`).

Contrast at these sizes is fine (5.84:1 measured), so this is a legibility and scalability issue rather than a contrast one — but 9 px numerals are hard for many sighted users too, not only those with low vision.

**Fix:** convert the scale to `rem` (with `:root { font-size: 100% }` left alone so the user's preference is the base), and raise the floor. `--fs-3xs` → `0.6875rem` (11 px at default) and `--fs-2xs` → `0.75rem` (12 px). Because the whole scale is already tokenised in one place, this is a contained change — edit `tokens.css:41-48` and the components inherit it.

### M-4 — Toggle buttons don't expose their pressed state — **Medium**

*Guideline: form controls and toggles need accessible state, not just colour.*

Three toggles communicate "on" purely by the `.btn-active` class (white fill, `components.css:247-251`) with no `aria-pressed`:

- `SourceToggle.tsx:43-52` — Replay vs Live (demo). This is the more serious one: it's a two-option **choice**, and non-visually there is no way to tell which source is active. It should be a radio group.
- `Comms.tsx:19-25` — the label text does change (`Comms ON`/`Comms OFF`), which partially mitigates it, but that phrasing is ambiguous about whether it *describes* state or *performs* an action.
- `TimingTower.tsx:57-63` — "Show seconds"/"Show laps"; label-swap makes intent clear, lowest priority.

**Fix** for `SourceToggle`, which is a single-select set rather than independent toggles:

```jsx
<div role="radiogroup" aria-label="Data source" style={{ display: 'inline-flex', gap: 4 }}>
  {SOURCES.map((s) => (
    <button
      key={s.key}
      role="radio"
      aria-checked={active === s.key}
      onClick={() => pick(s.key)}
      disabled={pending !== null}
      className={active === s.key ? 'btn btn-active' : 'btn'}
      title={s.title}
    >
```

For `Comms.tsx:19`, add `aria-pressed={enabled}` and change the label to the stable noun `Comms` so the pressed state (not the text) carries the meaning.

Related, `SourceToggle.tsx:48` and `StatusBadge.tsx:35`: `title` is the *only* place the important caveat "Demo lane streaming a second replay clip — real live ingestion not yet verified" appears. `title` is unavailable to touch users and to keyboard users who never hover. Given this caveat is about honesty in a portfolio piece, it deserves visible copy or at least an `aria-describedby` reference.

### M-5 — Ghost scrubber announces raw milliseconds — **Medium**

**Where:** `Ghost.tsx:198-208`

The range input is well-formed — it has `aria-label="Lap position"`, correct `min`/`max`/`step`, and a `disabled` state. But its `value` is raw milliseconds (`Math.floor(tMs)`, up to ~90000), so a screen reader announces *"43700"*. There is no `aria-valuetext`, and the human-readable time exists right beside it (`Ghost.tsx:209` renders `fmtElapsed(tMs)`).

**Fix:**

```jsx
aria-valuetext={fmtElapsed(tMs)}
```

One line, and `fmtElapsed` is already imported at `Ghost.tsx:6`.

### M-6 — Compare lanes' status changes are silent — **Medium**

**Where:** `Compare.tsx:26`

`StatusRail.tsx:54` wraps `StatusBadge` in `role="status" aria-live="polite"`, but `Compare.tsx:26` passes the same component into `Panel`'s `actions` slot bare. So on `/#compare` — the exact route where connection status matters most, since both lanes can independently stall — status transitions are announced on the board but not here.

Note this is the *inverse* of H-2: the board over-announces, Compare under-announces. Fixing H-2 by moving the live region inside `StatusBadge` itself (rather than around it at the call site) resolves both at once and removes the inconsistency.

### M-7 — Selection state is not deep-linkable — **Medium**

**Where:** `App.tsx:47-48`, `TimingTower.tsx:17`, `Ghost.tsx:30`
*Guideline: URL reflects state; deep-link all stateful UI.*

The app routes by `location.hash` (`App.tsx:46,64-66`), so the four views are linkable. But the selected driver (`App.tsx:47`), the rival comparison (`App.tsx:48`), the seconds/laps mode (`TimingTower.tsx:17`), and the ghost's driver choice (`Ghost.tsx:30`) are all `useState` only.

Consequences: a reload loses the selection; "look at VER vs LEC sector deltas" cannot be shared as a link; and the back button doesn't undo a selection. For a portfolio piece, shareable deep links are a visible quality signal — *"here's the exact comparison I'm describing"* is a much stronger thing to put in a README than *"click COMPARE then pick two drivers"*.

There is partial plumbing already: `App.tsx:65` passes `selected` into `Ghost` as `initialSelected`, so cross-view continuity was clearly wanted.

**Fix:** promote these to hash query params (`#/board?sel=1&rival=16&mode=sec`), or adopt a small hash-router. Given the app already parses `location.hash` by hand at `App.tsx:46,64-66`, extending that to a `URLSearchParams` over the hash's query portion is a contained change.

### M-8 — Tooltip-only information in the strategy and sector views — **Medium**

**Where:** `StintChart.tsx:42`, `TimingTower.tsx:117-118,136`

Several places put content in a `title` attribute where it's the only presentation of that information. `title` is unreachable by touch, unreliable for keyboard users, and inconsistently exposed by screen readers.

- `StintChart.tsx:42` — `title={`${s.compound} · laps ${s.startLap}-${s.endLap}`}` on a non-focusable `<div>`. This one is partly mitigated: `StintChart.tsx:44` supplies a good `aria-label` on the same element with `role="img"`, so assistive tech does get it. But a **sighted touch user** cannot discover which laps a stint segment covers — there is no hover on a phone, and the segments are the whole point of the panel.
- `TimingTower.tsx:117-118` — `title="best-effort, derived"` on the Gap and Int cells. Duplicated by visible copy at `TimingTower.tsx:159`, so this is fine.
- `TimingTower.tsx:136` — `title={mark === 'S' ? 'Session best' : 'Personal best'}` on a 9 px `<sup>`. The `S`/`P` glyph is the colour-blind-safe signal (good), but its meaning is hover-only and there's no visible legend for it, unlike the tyre legend at `TimingTower.tsx:162-167`.

**Fix:** for `StintChart`, make segments focusable (`tabIndex={0}`) with a visible tooltip or an expandable text summary beneath the chart. For the sector marks, add `S = session best · P = personal best` to the existing legend row at `TimingTower.tsx:162`, alongside the tyre compounds.

### M-9 — Empty live-region wrappers and inconsistent error announcement — **Medium**

**Where:** `SourceToggle.tsx:54-56`, `Comms.tsx:72-74`

Both render a permanently-present live region containing a conditionally-rendered child:

```jsx
<span role="status" aria-live="polite">
  {error && <span className="src-error">{error}</span>}
</span>
```

This is actually the **correct** pattern — the region must exist in the DOM before content is inserted, or the insertion isn't announced — and the `Comms.tsx:70-71` comment shows it was a deliberate choice. Flagging it only because the same care isn't applied consistently: `Settings.tsx:28-43` polls `/api/f1auth` every 5 s and swaps the status chip (`Settings.tsx:88`) and the entire `NextStep` paragraph (`Settings.tsx:46-70`) with no live region at all. A user who runs `python ingest/f1tv_link.py` in a terminal and switches back to the page gets no notification that the link succeeded.

**Fix:** wrap the chip and `NextStep` in `Settings.tsx:86-105` in a `role="status" aria-live="polite"` container. Because it polls on a 5 s interval but the *content* only changes on an actual state transition, this won't spam.

---

## Low

### L-1 — No `env(safe-area-inset-*)` handling — **Low**

**Where:** `components.css:26-31` (`.page`)

Confirmed absent from all stylesheets. The page uses symmetric padding (`var(--sp-4) var(--sp-6)`), so it's not full-bleed and content won't vanish into a notch in portrait. But in **landscape on a notched phone** — a plausible orientation for a wide timing board — the left inset can intrude on the tower. Add `padding-left: max(var(--sp-6), env(safe-area-inset-left))` and the mirror for right.

### L-2 — No visible page title on any route — **Low**

**Where:** `Route.tsx:16`, `StatusRail.tsx:40`

Every route's `<h1>` is `.visually-hidden`, and the rail's brand is a `<span className="rail-brand">`. The heading structure is correct for assistive tech (verified: clean `h1` → `h2` chain), and the reasoning in `Route.tsx:3-7` is sound. But it means `/#compare` and `/#ghost` show no visible statement of what you're looking at beyond a small note in the rail. The `title` prop already contains good copy (`"Compare — Monza 2023 vs 2024"`) that's being thrown away visually. Consider rendering it visibly on the sub-routes.

### L-3 — Sparkline SVGs have no explicit dimensions in CSS terms — **Low**

**Where:** `TelemetryPanel.tsx:32`

`width={values.length * 15}` varies with data length (up to 8 laps → 120 px), inside a flex row. Not a CLS risk in practice since it's below the fold and small, but a `min-width` would stop the row reflowing as history accumulates.

### L-4 — Typography: straight apostrophes in prose — **Low**

**Where:** `Settings.tsx:51,59,99,143,164`
*Guideline: curly quotes `'` `"` not straight.*

Prose uses `&apos;` / `&quot;` (rendering as straight `'` and `"`) — e.g. *"can't reach"*, *"you're linked"*. The guidelines call for typographic quotes: `'` and `"` `"`. Note the codebase already gets `…` and `—` right throughout, so this is the last gap in otherwise careful typography. Using the literal characters also removes the need for the HTML entities.

### L-5 — No `text-wrap: balance` on headings — **Low**

*Guideline: use `text-wrap: balance` on headings to prevent widows.*

Panel headings (`components.css:202-207`) are short and unlikely to wrap, but the `.track-skeleton` copy (`components.css:268-281`) is a centred multi-line sentence where `text-wrap: balance` or `pretty` would visibly help — that block holds the longest wrapped text in the app, and it's what visitors see first while the feed warms up.

### L-6 — `console.error` on malformed frames is user-invisible and unbounded — **Low**

**Where:** `socket.ts:54,59`

Malformed or invalid-shape messages are logged and dropped silently from the user's perspective. A systematically bad feed would fill the console while the UI shows a normal-looking board with missing cars. Consider surfacing a count via the existing status-chip mechanism after a threshold. (Related to D-2's log noise but a distinct path.)

---

## Findings index by file

| File | Findings |
|---|---|
| `web/index.html` | D-3 |
| `web/src/components/TimingTower.tsx` | C-1, H-1, H-3, H-4, M-1, M-3, M-4, M-7, M-8 |
| `web/src/components/Compare.tsx` | D-1, M-6 |
| `web/src/components/Ghost.tsx` | D-1, H-1, M-5, M-7 |
| `web/src/realtime/socket.ts` | D-1, D-2, L-6 |
| `web/src/components/StatusRail.tsx` | H-2, M-6, L-2 |
| `web/src/components/StatusBadge.tsx` | H-2, M-4 |
| `web/src/hooks/useStale.ts` | H-2 |
| `web/src/components/RaceControl.tsx` | H-5, M-3 |
| `web/src/components/Map.tsx` | H-1, M-2 |
| `web/src/components/TelemetryPanel.tsx` | H-1, L-3 |
| `web/src/components/SourceToggle.tsx` | M-4, M-9 |
| `web/src/components/Comms.tsx` | M-4, M-9 |
| `web/src/components/Settings.tsx` | M-9, L-4 |
| `web/src/components/StintChart.tsx` | M-8 |
| `web/src/styles/tokens.css` | H-1, M-3 |
| `web/src/styles/components.css` | H-1, H-4, M-1, L-1, L-5 |
| `web/src/App.tsx` | M-2, M-7 |
| `web/src/components/Route.tsx` | L-2 |

---

## Suggested order of work

1. **D-1 + D-2** — the public demo has two dead routes and an infinite console error loop. Highest visibility, and the fix is contained.
2. **D-3** — social preview meta. One file, ~15 lines, and it changes what every shared link looks like.
3. **C-1** — remove `role="button"` from `<tr>`. Fixes the worst a11y defect and, done as option (a) or (b), takes H-3 with it.
4. **H-1** — replace `opacity`-based dimming with dedicated colour tokens.
5. **H-2 + M-6** — move the live region inside `StatusBadge` and exclude the ticking counter.
6. **H-4, H-5, M-1** — touch targets, the Race Control log role, responsive column drops.
7. The remaining Medium and Low items as convenient.
