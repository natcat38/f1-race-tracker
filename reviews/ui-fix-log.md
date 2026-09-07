# UI fix log — branch `review/ui-polish`

## Agent 1 — demo blockers + platform basics

Scope: the public-demo dead ends and the platform basics (social/meta tags, repo
link-back). Reports consumed: `reviews/ui-ux.md` (B1, M15) and
`reviews/accessibility.md` (D-1, D-2, D-3).

### Fixed

**ui-ux B1 / accessibility D-1 — three of four nav tabs dead-ended on the static demo.**
`#compare` and `#ghost` called `connectRace` unconditionally, so on GitHub Pages
they dialled `wss://natcat38.github.io/ws?session=…` forever and sat on
optimistic, false copy ("Warming up the timing feed…", "Connection lost —
retrying automatically…"). `#settings` had one honest but bare line.

- New `web/src/staticDemo.ts` — single home for the `STATIC_DEMO` build flag
  (previously re-derived in `App.tsx` and `Settings.tsx`), the repo URL, the
  `docker compose up` one-liner, and the one-sentence stack description, so the
  copy cannot drift between the views that quote it.
- New `web/src/components/StaticDemoNotice.tsx` — the honest static-demo state:
  what the view does, why it needs the real backend, the clone + `docker compose up`
  one-liner, the stack in one line, and a link to the repo. Carries a
  `NEEDS THE FULL STACK` chip in the panel plate.
- `Compare.tsx` guards before any `Lane` mounts; `Ghost.tsx` is split into a
  `Ghost` wrapper and `GhostLive`, so the static build never mounts the two
  `connectRace` effects at all (a hook-order-safe split, not a conditional hook).
- `Settings.tsx` returns the same notice on the static build instead of showing
  an `UNAVAILABLE` chip that really meant "there is no gateway to ask".
- The four tabs stay visible on purpose — the features are real, and a truthful
  signpost advertises them better than a hidden tab does.

**accessibility D-2 — console error flood on the public demo.** The root cause was
D-1; with no sockets opened, the demo is now silent. Verified: cycling
`#compare → #ghost → #settings` on a fresh tab of the static build produces
**zero console messages** (previously 20–48+ errors per route, growing forever).
Also fixed the log line itself — `console.error('connectRace: socket error', ev.type)`
printed the literal "socket error error" and named no socket; it now logs the
socket URL, which on a multi-lane route is the only distinguishing detail.

**accessibility D-3 — no social preview, no meta description.** `web/index.html` now
carries a description, canonical, full Open Graph set (type, site_name, url,
title, description, image + width/height/alt) and a `summary_large_image` Twitter
card. Title changed from the bare project name to
"F1 Race Tracker — live timing tower & telemetry".
`web/public/og.png` is a 1200×630 card cut from `docs/assets/live-lane.png`
(the board screenshot — rail, track map and full timing tower; the four-up bottom
strip is cropped out because it does not read at card size). OG URLs are absolute
and hard-coded to the Pages deployment, which is correct on both builds: Vite's
base rewrite only touches relative asset paths, and Pages is the only origin a
scraper ever unfurls.

**ui-ux M15 — no path from the app back to the project.** A small `GITHUB ↗` link now
sits at the right end of the status rail on every route — deliberately outside
`<nav>` and quieter than a tab, because it is an exit from the app, not a fifth
view. It carries a visually-hidden "(opens in a new tab)". The settings route also
gains an `ABOUT THIS PROJECT` panel with the one-sentence stack description
(Python ingest → Redis → Go gateway → WebSocket → React) and the same repo link.
The static-demo notice carries both too, so a visitor who lands on a gated tab
still gets the story.

### Added

- `web/src/components/staticDemoGating.render.test.tsx` — 7 tests: each of the
  three gated views renders the honest copy with the flag set (and none of the
  old optimistic strings), renders the real view with the flag unset, and the rail
  carries the repo link. Env is stubbed and the module graph re-imported per case,
  since `STATIC_DEMO` is captured at import time.
- `.demo-notice` / `.demo-notice-cmd` / `.demo-notice-link` / `.rail-repo` styles.
  The prose blocks get a 68ch measure (every other view is instrument-dense and
  earns edge-to-edge width; these are documents), and the command block wraps
  rather than scrolling, so a phone shows the whole one-liner.

### Skipped, with reason

- **accessibility D-2's retry cap** (`socket.ts`: cap total attempts and go to the
  terminal `'failed'` status after ~6). Not needed for the demo any more — nothing
  dials a socket there — and it changes live-app behaviour: a real gateway restart
  or a laptop waking from sleep currently recovers on its own, and a cap would
  strand the board on a terminal error. Wants its own decision, not a drive-by.
- **ui-ux M6 (COMPARE doesn't compare), M7, M12 (demote LINK out of primary nav),
  B2** — out of this agent's scope; they are information-architecture and layout
  work for the later agents on this branch. Note for whoever takes M12: the rail's
  repo link is deliberately *not* a tab, so it does not add pressure to the nav slots.
- **Baking static clips for compare/ghost** (option (a) in accessibility D-1). The
  honest-signpost option was the brief; baking two more multi-megabyte clips would
  also roughly triple the Pages payload for two views that are better demonstrated
  by running the real thing.

### Noticed, not fixed

- On the static build, `App` still fetches the 24 MB `monza-2024-race.ndjson` clip
  even when the hash routes straight to a gated view — the static-replay effect
  runs before the hash check returns. Pre-existing (the board connection was always
  unconditional), and gating it on the hash would tear down and rebuild the live
  app's connection every time a user visits another tab and comes back. Worth a
  separate look.

### Verification

In `web/`, all on the final tree:

| Check | Result |
|---|---|
| `npm test` | 14 files, **133 passed** (126 before, +7 new) |
| `npm run lint` | clean |
| `tsc -b` (via `npm run build`) | clean |
| `npm run build` (normal) | ✓ built |
| `VITE_STATIC_DEMO=true npm run build` | ✓ built, `dist/og.png` emitted, favicon and assets base-rewritten to `/f1-race-tracker/` |

Browser checks against `vite preview` of the static-demo `dist`
(`http://localhost:4173/f1-race-tracker/`):

- `#compare`, `#ghost`, `#settings` all render the honest state; no
  "reconnecting", no disabled-forever controls.
- Fresh tab, all three routes cycled over ~8 s: **no console logs at all**, and no
  WebSocket requests in the network log.
- Board route still streams: 20 timing rows, `LAP 13/53`, weather readout, `▶ REPLAY`.
- All meta tags present and correct in the built page; `og.png` serves 200 at the
  base-rewritten path.
- No horizontal page overflow at 1280 px or at 375 px (mobile); the command block
  wraps instead of scrolling.

Non-static sanity check via `npm run dev` (port 5173, proxying to the running
docker gateway on 8080): board streams 20 rows with the source toggle present,
`#compare` shows the real two-lane view, `#ghost` renders Track / Delta bar /
Controls, `#settings` shows the F1TV panel plus the new About panel.

`web/dist/.gitkeep` survived both builds (`postbuild` recreates it); `VITE_STATIC_DEMO`
was cleared from the shell afterwards.

---

## Agent 2 — accessibility

Scope: `reviews/accessibility.md` in full (22 findings). D-1/D-2/D-3 were already
landed by agent 1 — verified, not redone. Everything else in this section is mine.
Ratios below are WCAG relative-luminance math against the actual rendered
composite, re-measured in the running app after each change, not estimated.

### Fixed

**C-1 — `role="button"` on `<tr>` destroyed the table.** Taken as the report's
option (a): the row keeps its real `<tr>`/`<td>` semantics and the control moves
into the Driver cell as a `<button class="tt-select">`.

- `role="button"` on a `<tr>` has a presentational-children content model, so
  every `<td>` lost its cell role and all ten `<th scope="col">` headers
  associated with nothing. Row 1 was announced as one 66-character run-on
  (`1PIALEADER—1:24.7481:24.077M1327.848+0.24828.860+0.13428.040S+0.119`).
- The button's accessible name is now "PIA — set as reference car", and
  "PIA — reference car" once it is the reference, carried by a `.visually-hidden`
  suffix beside the visible code. `aria-pressed` carries the state.
- Row-wide click survives as a mouse convenience: `onClick` on the `<tr>` with no
  role and no `tabIndex`, skipping events that came from the button so one
  activation is not applied twice.
- Verified live: `role="button"` gone, `scope="col"` intact, no `tabindex` on any
  `<tr>`.

**H-3 — twenty tab stops across the tower, now one.** Roving tabindex over the row
buttons, keyed by **driver number rather than row index**, because the running
order re-sorts every 10 Hz frame and an index-keyed stop would wander between
drivers mid-read. Arrow/Home/End move within; Enter and Space are left to the
native button (which also swallows Space's page scroll for free — the old
hand-rolled `preventDefault` is no longer needed). The entry point prefers
last-focused, then the reference car, then the leader.

Measured with real key events in the browser: board tab stops **29 → 11**; Tab
from a row goes straight to the rival picker; three ArrowDowns walk three rows
with `:focus-visible` true and `scrollY` unchanged. The focus ring is drawn
*inside* the row (`outline-offset: -2px`) because `.panel` is `overflow: hidden`
and `.tt-scroll` is `overflow: auto`, which clipped an outward ring at the edges.

**H-1 — contrast.** The pattern was `opacity` stacked on a palette already tuned
near 4.5:1. De-emphasis is now a colour, not a multiplier.

| What | Before | After |
|---|---|---|
| Retired-car Gap/Int + sector deltas | 2.40:1 (`--slate` @ .5) | **4.80:1** (`.tt-row-out` uses `--dim`) |
| Retired-car personal-best marks | 2.59:1 (`--good` @ .5) | **4.80:1** |
| DRS-inactive readout | 3.43:1 | **4.80:1** (`--dim` #646D79 → #7C8590) |
| Pit-lane car code on the map | 2.95:1 (@ .35) | **6.22:1** (@ .6) |
| Ghost-car marker (non-text, needs 3:1) | 1.59:1 fill @ .4 | full-strength dashed `--track-label` ring, 14.7:1 |
| `TYRE_COLOUR.WET` as text | 3.71:1 | **5.06:1** (#3671C6 → #4A8AD8) |
| `TYRE_COLOUR.SOFT` as text | 4.05:1 | **5.45:1** (#e1342e → #F25A54) |

Two things the report did not catch, found by re-measuring:

- **`SOFT` failed too**, at 4.05:1 — the report flagged only `WET`. Both are text
  in the tower's compound readout, not just fills in the strategy bars, so both
  are held to the 4.5:1 text floor.
- **The selected row was its own contrast failure.** `.tt-row-selected` filled
  with `--edge` (#232A33), which lifted the background enough to push the purple
  session-best mark to 3.65:1, SOFT to 3.26:1 and any dimmed text under the line —
  on exactly one row, the one the user just chose. Fixed by recessing instead of
  lifting: the row fills with `--asphalt` and takes a chalk left edge. Everything
  on it now measures 7.2–16.5:1, verified on the running board.

DRS also gained a non-colour cue (a `visually-hidden` "active"/"inactive"), since
on/off was signalled by colour alone — the rule this codebase already follows for
sector marks and the sparkline hatch.

**H-2 + M-6 — the stall counter announced once a second, and Compare announced
nothing.** One bug from opposite ends, so both were fixed at the source: the
polite region moved *inside* `StatusBadge` instead of being wrapped around it at
one call site. `StatusRail` had one and `Compare` did not, so the route where two
lanes can stall independently was the silent one. The ticking counter now sits in
an `aria-hidden` span — still on screen, out of the announcement — so the region
speaks once when a stall begins and once when it clears, rather than queueing
"…6s ago… 7s ago…" indefinitely. Verified: exactly one polite region in the rail,
zero nested live regions anywhere, one per Compare lane.

**H-4 — touch targets.** `.btn` gains `min-height: 32px` (44px under
`pointer: coarse`), the seconds toggle drops its inline padding override, and rows
lift under coarse pointers. Critically, the *button* takes the row's height rather
than the cell being padded around a 17px sliver — padding the `<td>` grows the row
without growing the target, which is what I tried first and it did not work.
Measured at 375px: **zero interactive targets under 24px** (was 25 of 29), row and
driver button both 44px. Also covers ui-ux m13: the ghost scrubber was a 20px-tall
precision drag; the visual track stays 4px, only the hit box grows.

**H-5 — Race Control was the one feed worth announcing and wasn't.** Now
`role="log" aria-live="polite" aria-relevant="additions"`. This needed a second
fix to be safe: the list key was `rev-index` over a **reversed** slice, so every
existing row's key shifted the moment a new message arrived — under a live region
that would have re-announced the whole backlog on every incident. Keys are now a
stable per-message identity (a `WeakMap` over the message objects, which
`applyMessage` preserves by reference when it appends).

**M-1 — the tower overflowed at 1280px.** Measured before: a 795px table in a
567px container, S1–S3 permanently behind a scrollbar on the most common desktop
size there is. Four changes, tuned against live measurements:

1. `white-space: nowrap` on cells. Timing values should never wrap, and the
   reserved delta width made them: rows went 25px → 47px while *still* not fitting.
2. Sector-delta superscripts are always rendered, with a reserved `min-width`, so
   picking a reference car no longer adds ~40px per sector column and takes S3 with
   it. (This is ui-ux M5's twin — the interaction that adds sector insight was the
   one that removed a sector.)
3. Cell padding trimmed to `var(--sp-1)` horizontally.
4. `.board-top`'s map column capped at 460px instead of 600px, and **container
   queries** rather than viewport media queries drop columns on the tower's own
   width — the tower shares a grid row with the map, so the viewport says very
   little about how much room the table actually has. Thresholds are the table's
   measured widths: 753px for all ten columns, 678 without Best, 611 without Int
   too, 269 with the sectors gone.

Result, measured live, with no horizontal page overflow at any of them:

| Viewport | Container | Columns | Table overflow |
|---|---|---|---|
| 1440 | 867px | all ten | 0 |
| 1280 | 707px | nine (Best drops) | 0 |
| 768 | 679px | nine | 0 |
| 375 | 319px | five (`# Driver Gap Last Tyre`) | 0 |

`.tt-scroll` also becomes a focusable, named `role="group"` — but **only when it
actually overflows**, so there is no dead tab stop the rest of the time. The case
that still hits it is a user who has raised their browser's default font size,
which is exactly the user who can least afford a silently clipped column. Verified
by driving the root font-size to 24px: `tabindex` flips to 0 and back, with the
label "Timing tower — scroll sideways for the remaining columns".

**M-2 — no pause control for continuously moving content (WCAG 2.2.2).** A
Freeze/Resume button in the status rail. Frames keep arriving into a ref while
frozen; resuming snaps to the latest, so nothing is replayed or queued. The rAF
interpolation loop is genuinely stopped (`useSmoothedCars(state, paused)`) rather
than left spinning on a static picture, and `staleSec` is suppressed while frozen
so pausing to read a row does not make the badge claim an outage. The state is
announced through an always-present `role="status"` holding a `⏸ FROZEN` chip; the
button itself uses a swapping transport label, matching the overlay's existing
Play/Pause. I used it to take stable measurements during this pass, which is the
argument for it being a feature rather than a compliance tax.

**M-3 — hard px type with a 9px floor.** The whole scale is `rem` now, with
`:root` left without a `font-size` so 1rem stays the user's own default. Verified
live: raising the browser default to 24px scales the tower 12px → 18px, where
before it did nothing at all. The bottom two rungs are retired — `--fs-3xs` 9px →
11px and `--fs-2xs` 10px → 12px, aliasing `--fs-xs`/`--fs-sm`. They carried the
sector S/P marks, the sector deltas, the tyre legend and Race Control timestamps
at a size plenty of sighted readers cannot parse either.

**M-4 — toggles with no exposed state.**

- `SourceToggle` is a real `role="radiogroup"` — with roving tabindex and arrow
  keys, because a radiogroup you can only Tab through is a radiogroup in name
  only. `aria-checked` replaces "the white one is on".
- `Comms` gets `aria-pressed` and a stable noun label ("Comms" rather than
  "Comms ON"/"Comms OFF", which was ambiguous about whether it described state or
  named an action).
- The tower's seconds toggle likewise: stable label ("Gaps in seconds") plus
  `aria-pressed` and `.btn-active`, replacing a label swap with no state at all.
- The "the live lane is really a replay clip" caveat was `title`-only in two
  places (`StatusBadge`, `SourceToggle`) — unreachable on touch and to anyone who
  never hovers. It is now part of each control's accessible text.

**M-5 — the ghost scrubber announced raw milliseconds.** `aria-valuetext={fmtElapsed(tMs)}`;
verified live reading `0:00.000` instead of `0`.

**M-8 (sector half) — the S/P glyph's meaning was hover-only.** It now has a
visible legend beside the tyre compounds: `S = session best · P = personal best`.

**M-9 — the polled F1TV status changed silently.** The chip and the `NextStep`
paragraph are each wrapped in `role="status" aria-live="polite"`. The poll is 5s
but the *content* only changes on a real transition, so it does not spam.

**L-1** — `padding-inline: max(var(--sp-6), env(safe-area-inset-*))` on `.page`.

**L-3** — the sparkline reserves its full 8-bar width so the row stops reflowing
one bar at a time; deliberately not flex-pinned, because the Telemetry panel is
already tight with a rival card open (ui-ux B2).

**L-4** — the five straight apostrophes/quotes in `Settings` are now typographic.

**L-5** — `text-wrap: balance` on `.track-skeleton`, the longest wrapped sentence
in the app and the first thing a visitor sees.

**L-6** — malformed-frame logging is capped at 5 lines plus one "further frames
will not be logged" note. A systematically bad feed used to write ten
`console.error`s a second, forever, behind a normal-looking board.

**Console errors on load (the brief's catch-all).** `connectRace` logged an error
for sockets *we* closed — every unmount, and twice per mount under StrictMode in
dev — so every page load carried a `connectRace: socket error` line. Guarded on
the existing `closed` flag. A fresh load now produces **zero console errors**; the
one remaining `[warn]` is emitted by Chrome itself about StrictMode's dev
double-mount and does not exist in a production build.

**Not in either report, fixed because I caused it:** raising `--fs-2xs` made the
nav tab sub-labels wrap mid-phrase more aggressively ("COMPARE / side by /
side"). `white-space: nowrap` on `.rail-tab-sub` fixes it and takes the mobile
rail from 383px to 254px — which also closes ui-ux m21.

### Skipped, with reason

- **D-1 / D-2 / D-3** — already fixed by agent 1. Verified on this tree, not
  redone. (D-2's retry cap stays deliberately unfixed, per agent 1's reasoning.)
- **M-7 (selection is not deep-linkable).** Real and fixable, but it is routing
  and state design rather than an access barrier — the report files it under the
  "URL reflects state" guideline, not under WCAG — and it sits directly on top of
  ui-ux M4 ("selection is a one-way door") and M12 (nav restructuring), which
  agents 4–5 own. Doing it here would mean fixing push-vs-replace history
  semantics for a selection another agent may be about to make toggleable.
- **M-8 (StintChart half).** The stint segments already carry a correct
  `role="img"` plus `aria-label`, so assistive tech is served; what is missing is
  discovery for a *sighted touch* user, which needs tap-to-reveal or a text
  summary under the chart. That is the Strategy panel's layout, which ui-ux m3
  ("no axis and no legend") already owns.
- **L-2 (no visible page title on sub-routes).** The heading chain is correct and
  verified (`h1` → `h2` → `h3`, no skips); making the `h1` visible is a layout and
  copy decision on every route, not an accessibility fix.
- **H-2's alternative of coarsening the stall counter** (bucketing to 15s/30s/1m).
  Took the `aria-hidden` route instead: it keeps the per-second number visible,
  which is genuinely useful, while removing it from the announcement entirely.

### Overlaps with `reviews/ui-ux.md` — noted, not double-fixed

- **n2** (twenty rows ahead of every other control in the tab order) = H-3, fixed
  here; the roving tabindex is the idiom n2 asked for.
- **n3** (toggles have no pressed state) = M-4, fixed here for all three toggles.
- **m13** (ghost scrubber below touch size) = H-4, fixed here.
- **m21** (nav sub-labels wrap mid-phrase) — fixed here as fallout from the rem
  conversion, as above.
- **M5 / M8** (selection pushes S3 off-screen; the tower hides 62% of its
  columns) — the *clipping* half is fixed here via container queries and the
  reserved delta width. The half left alone is M8's real recommendation: a
  per-driver **card layout** below ~700px instead of five columns. Below ~600px
  the table now shows `# Driver Gap Last Tyre` with room to spare, which is honest
  but wasteful — a card is the better answer, and it is a layout change rather
  than an accessibility one.
- **B2** (the vs-comparison renders clipped at every viewport) — untouched; it is
  a grid fix for the Telemetry panel. I did make sure the sparkline `min-width` I
  added for L-3 does not make it worse (no `flex-shrink: 0`).
- **m20** (the rival picker's visible label is two characters, "vs") — the control
  *is* correctly labelled for assistive tech by its wrapping `<label>`, so this is
  a copy problem, not an a11y one. Left for the UX pass.
- **m8 / n1** (the rail chip duplicates the control beside it; "LIVE (DEMO)" is
  honest only in its tooltip) — I moved the tooltip's caveat into accessible text,
  which is the a11y half. Putting it on screen is n1's call.
- **m11** (rows reorder under the pointer, so you click the wrong driver) — not
  addressed, but note the roving tabindex is keyed by driver precisely so the
  *keyboard* equivalent of this bug cannot happen.

### Not regressed — checked deliberately

Reduced motion was called "genuinely exemplary" in the report, so: the CSS is
still opt-**in** via `@media (prefers-reduced-motion: no-preference)`, untouched;
`useReducedMotion` is untouched; `useSmoothedCars`' reduced-motion early return is
intact and the new `paused` flag is OR'd alongside it, never in place of it;
`Ghost`'s playback gate is untouched. The colour-independence work (sector S/P
glyphs, sparkline hatch) is intact and was extended to DRS.

### Verification

In `web/`, on the final tree:

| Check | Result |
|---|---|
| `npm test` | 15 files, **146 passed** (133 before, +13 new) |
| `npm run lint` | clean |
| `tsc -b` | clean |
| `npm run build` | ✓ built, `dist/.gitkeep` intact |
| `VITE_STATIC_DEMO=true npm run build` | ✓ built, `dist/og.png` emitted |

Tests added, all following the repo's existing `renderToStaticMarkup` pattern:

- `TimingTower.render.test.tsx` +6 — no `role="button"` and no `<tr tabindex>`
  while `scope="col"` survives; per-row accessible names; exactly one row button
  reachable by Tab with the other two at `-1`; the roving stop follows the
  reference car; a retired row is dimmed by class with no `opacity:0.5`; the S/P
  legend is present.
- `StatusBadge.render.test.tsx` +4 — the badge carries its own polite region; the
  stall chip keeps its seconds counter behind `aria-hidden` while still showing
  it; the live-lane caveat is readable without a hover.
- `announce.render.test.tsx` (new) +5 — Race Control is a `role="log"`; the rail
  has **exactly one** polite region (pinning the no-double-announce fix); the
  source picker is a radiogroup with `aria-checked` and a single tab stop, on the
  checked option.

Browser checks against `npm run dev` (5173) proxying the running docker gateway,
board streaming 20 rows at `LAP 16/53`:

- Keyboard: real Tab / Shift+Tab / ArrowDown / Space events. 11 tab stops, down
  from 29. The tower is one stop. Arrows walk rows with a visible 2px chalk ring
  (`:focus-visible` true, `outline-offset: -2px`), Space selects without scrolling
  the page, `aria-pressed` flips.
- Contrast: measured on the live computed colours, with alpha composited through
  inherited opacity — retired/dimmed text 4.80:1, DRS-off 4.80:1, selected-row
  contents 7.23–16.54:1, tyre readouts 5.45–14.66:1.
- Layout: 1440 / 1280 / 768 / 375 all with zero table overflow and zero horizontal
  page overflow; 375 has zero targets under 24px.
- Text scaling: root 16px → 24px scales the board and flips the tower's scroll
  region focusable, then back again.
- Routes: `#compare` (both lanes now announce), `#ghost` (`aria-valuetext`
  `0:00.000`, dashed ghost ring), `#settings` (two status regions, clean
  `h1`→`h2`→`h3`, no straight quotes).
- Console: **zero errors** on a fresh load.

---

## Agent 3 — design-system consolidation

Scope: `reviews/design-system.md`, recommendations 1–6. The report's grade was
**B, "a tight afternoon of consolidation moves it to A-"**, and its thesis was
that the token layer is good but "roughly a third of the UI never reaches it".
This pass closes that gap. Everything here is plumbing except three deliberate
colour changes, listed under *Visible to the eye* below.

Agent 2 had already moved two of the tyre hexes for contrast (`WET` #3671C6 →
#4A8AD8, `SOFT` #e1342e → #F25A54). Those retunes are kept — `SOFT` verbatim,
`WET` superseded for the reason in §3 — and every ratio comment in `tokens.css`
was re-measured in the running app, not carried over on trust.

### Fixed

**1. A tyre colour was doing status duty in two unrelated places.**
`TYRE_COLOUR.MEDIUM` (`#e8c84a`) coloured the **yellow-flag** label
(`RaceControl.tsx`) and the **in-pit** indicator (`TimingTower.tsx`). Three
meanings on one literal: retune the medium-compound swatch for legibility and
race control and the timing tower silently restyle with it.

- Flags → `var(--amber)`, whose own docstring reads "ATTENTION ONLY: stall,
  reconnect, **flags**, safety car". The `SafetyCar` entry one line below was
  already correct, so the file had been disagreeing with itself within two lines.
- In-pit → a new `--pit`, aliased to `--amber`. Not given its own hex (that would
  be the same duplication in a new place) and not left pointing straight at
  `--amber` in the component either, because "car is in the pit lane" is its own
  state and the two should be able to diverge later without a hunt.
- `RaceControl.tsx` no longer imports `TYRE_COLOUR` at all.

Contrast: `--amber` measures **9.80:1** on `--carbon` (the medium yellow was
10.94:1) — both far above the floor, so this is a hue change, not a legibility one.

**2. The `rgba()` washes hardcoded token channels — the theme-change blocker.**
Five sites decomposed a token into raw RGB (`rgba(233, 237, 241, 0.06)` = `--chalk`,
etc.), so changing `--chalk` left three hover states on the old hue. Added channel
triplets beside the hexes and composed from them:

```css
--chalk-rgb: 233 237 241;  --onair-rgb: 225 6 0;  --amber-rgb: 255 176 0;
--hover-wash:       rgb(var(--chalk-rgb) / 0.06);
--hover-wash-faint: rgb(var(--chalk-rgb) / 0.04);
```

`.rail-tab:hover` and `.btn:hover` were byte-identical duplicates; both now say
`var(--hover-wash)`, so the wash is named once. `.chip-live` and
`.chip-stall/.chip-reconnect` compose from their own triplets. Verified in the
browser that every one computes to **exactly** the old `rgba(...)` value, and that
**zero** rules containing a raw `rgba(` literal remain in the loaded stylesheet.

**3. `TYRE_COLOUR` moved into `tokens.css`, and the Red Bull collision is gone.**
`timingHelpers.ts` is now a name→token lookup with no hex in it; the values,
ratios and reasoning live beside the rest of the palette.

| Compound | Was | Now | On `--carbon` |
|---|---|---|---|
| SOFT | `#F25A54` | `--tyre-soft: #F25A54` | 5.45:1 (unchanged) |
| MEDIUM | `#e8c84a` | `--tyre-medium: #e8c84a` | 10.94:1 (unchanged) |
| HARD | `#e8e8e8` | `--tyre-hard: #e8e8e8` | 14.66:1 (unchanged) |
| INTERMEDIATE | `#3bb273` | `--tyre-inter: var(--good)` | 6.67:1 (unchanged) |
| WET | `#4A8AD8` | `--tyre-wet: var(--rain)` (#5AB0F0) | 5.06 → **7.62:1** |

- **INTERMEDIATE** was a lowercase re-type of `--good`'s exact value (`#3bb273`
  vs `#3BB273`) — the report's "canonical no-design-system smell". Aliased, not
  duplicated; identical pixels, and a find-and-replace on `--good` can no longer
  miss it.
- **WET** is the finding the report called the worst of the lot, because it proved
  the author knew the rule and the code broke it anyway: `--rain` is annotated
  "deliberately NOT Red Bull's `#3671C6`" and `WET` *was* `#3671C6`, exactly. Agent
  2's contrast pass moved it to `#4A8AD8`, which clears the text floor but is still
  the same blue to the eye — a Red Bull marker on the map and a `W` in the tower
  would not have read as different colours. It now points at `--rain` itself: water
  on the circuit already has a token, and the wet compound is the same idea. Two
  wins for one edit — the collision is unambiguous rather than nearly-resolved, and
  the ratio goes **5.06 → 7.62:1**. Re-measured against Red Bull's live marker fill
  (`rgb(54, 113, 198)`) on the running map: plainly distinct.
- **SOFT** deliberately left as its own value rather than pointed at `--bad`, and
  the reason is now written down in the token file: a soft tyre is not a "worse"
  readout, and borrowing the error/slower red for it would be the same semantic
  leak `--pit` was just created to stop.

**4. The six hardcoded SVG greys are tokenized.** `TrackPath.tsx` was already
correct (`var(--track-edge)` / `var(--track-fill)`) and its two callers were not,
which made the inconsistency more visible, not less. Added `--marker-stroke`
(#000), `--marker-halo` (#FFF), `--ghost-rule` (#444) and `--team-unknown` (#BBB),
applied at `Map.tsx` and `Ghost.tsx`. `'#bbb'` appeared three times in `Ghost.tsx`
as the same concept and is now one named constant. **Values are unchanged** — the
point was to get them into one file, because `reviews/frontend-design.md` §3 wants
the track surface colours themselves changed (`--track-fill` reads as a hairline
wire rather than a road) and that is agent 4's call. It is now a `tokens.css` edit.

**5. Spacing swept to the scale, and the micro-step named.** Added `--sp-0: 2px` —
the app clearly needed a step below 4px and had it all along as eight separate raw
integers. Every on-scale inline integer across `Comms`, `RaceControl`,
`SourceToggle`, `TelemetryPanel`, `Compare`, `Ghost`, `StintChart`, `TimingTower`
and `ErrorBoundary` now says `var(--sp-*)`, and the raw `2px`/`3px`/`8px` spacing
in `components.css` with it. Verified in the browser that the computed values are
byte-identical (`.rail-tab` gap 2px, `.chip` padding `2px 10px`, cell padding
`2px 4px`, ghost select `4px 8px`).

Off-scale values snapped where the change is imperceptible: `gap: 6` → `--sp-2`
(StintChart row, TelemetryPanel "vs" picker — a 2px horizontal shift),
`marginBottom: 6` → `--sp-2` (one button), `.tt-delta` `margin-left: 3px` →
`--sp-0` (a 1px superscript offset).

After the sweep, **the only spacing integer left in any `.tsx` is one**, and it
carries a comment explaining itself (see *Left alone* below).

**6. Bonus items.**

- `ErrorBoundary.tsx` — the top-level boundary (`main.tsx`), so the app's most
  consequential failure state, explicitly overrode the font stack to `sans-serif`,
  set no colour, and used a raw `padding: 24`. It now uses `var(--data)`,
  `var(--chalk)` and `var(--sp-6)`, and the `<h1>` gets `var(--display)` /
  `var(--fs-hero)` instead of rendering at the UA-default 2em — which happened to
  land near 28px by coincidence rather than intent. Verified the whole block
  resolves: Martian Mono, chalk, 24px, Chakra Petch h1 at 28px.
- `components.css` opens with a comment documenting the intentional split. The
  report's line was that 68 inline `style={{…}}` objects are "the first thing a
  reviewer will see, and it will frame everything after it", and that the honest
  defence — colours go through tokens, only layout is inline — *is true here* but
  nobody will infer it. Now it is stated where it will be read first, with the rule
  it implies: an inline style may hold an arrangement and a token, never a colour
  literal and (since `--sp-0`) never a bare spacing integer.

### Visible to the eye

Three, all intended:

1. **Yellow flags in Race Control are amber**, not lemon (`#e8c84a` → `#FFB000`).
   This is the point of fix 1 — the colour now comes from the flag token rather
   than from the medium-compound swatch.
2. **The in-pit indicator moves with it**, same two hexes. Confirmed live on the
   board: `IN PIT` computes to `rgb(255, 176, 0)`.
3. **The WET tyre swatch is a lighter sky blue** (`#4A8AD8` → `#5AB0F0`). The
   five compounds remain plainly distinguishable in the legend — checked at zoom:
   red / yellow / white / green / blue.

Nothing else moved. Every other computed colour, padding, gap and radius on the
board, compare and ghost routes measures identical to before the pass.

### Left alone, with reason

- **`StintChart`'s outer `gap: 3`** — the one off-scale spacing value left in the
  app, and now annotated rather than anonymous. It repeats between twenty rows, so
  either neighbouring step moves the panel's height by ~19px, which re-flows the
  four-up bottom strip that every other board panel shares a grid row with. A named
  half-step for a single call site would be worse than an annotated `3`.
- **Two `10px` values in `components.css`** (`.chip` horizontal padding,
  `.tt-legend` column gap). Both snap targets change a chip's width by 4px on a rail
  that already wraps at phone widths, and cost the legend a wrapped line at the
  tower widths that matter. Annotated in place as measured values.
- **`--ghost-rule` #444 at 1.84:1.** Tokenized but not lifted: it is the delta
  bar's decorative midline, not a readout, so no contrast floor applies. Noted in
  the token comment so the low number reads as a decision.
- **Report §2.7 and §2.8 (recommendation 7)** — extracting `.tele-row`/`.tele-label`
  from the three verbatim copies in `TelemetryPanel`, `--tele-label-w`, and a
  `--radius` token for the 13 `4px` corner sites. Out of this agent's brief, and
  `--radius` in particular is a value another agent may want to change rather than
  merely name. The remaining unnamed widths (`width: 64/36/28`, `minWidth: 200/160`)
  belong with it.
- **§2.10 (collapsing `--fs-3xs`/`--fs-2xs`)** — agent 2 already retired both rungs
  to aliases of `--fs-xs`/`--fs-sm` for the rem conversion, which resolves the
  legibility half. Which name to use for which job is a copy/typography decision.
- **§2.11 (`index.html` `theme-color` duplicates `--asphalt`)** — genuinely
  unavoidable; HTML cannot read a CSS variable. Named explicitly in the new
  `components.css` header so the one-file-edit claim stays honest.

### What this changes about a theme swap

The report's headline number was "one file plus a twenty-site tail, and the tail
is invisible until it renders wrong". The tail is now: **`index.html`'s
`theme-color`, and nothing else.** The five `rgba()` washes, the six SVG greys and
the five `TYRE_COLOUR` literals all resolve through `tokens.css`. Verified by
grep: no `#rrggbb` literal survives anywhere under `web/src/` outside `tokens.css`
and `teamColours.ts` (which is brand data for twenty real teams, not theme).

### Verification

In `web/`, on the final tree:

| Check | Result |
|---|---|
| `npm test` | 15 files, **146 passed** (no change — this pass adds no behaviour) |
| `npm run lint` | clean |
| `tsc -b --force` | clean |
| `npm run build` | ✓ built, `dist/.gitkeep` intact |
| `VITE_STATIC_DEMO=true npm run build` | ✓ built, `dist/og.png` emitted; env var cleared afterwards |

Browser checks against `npm run dev` proxying the running docker gateway, board
streaming 20 rows:

- **Token resolution:** all 18 new/changed custom properties resolve; `--pit`
  → `#FFB000`, `--tyre-wet` → `#5AB0F0`, `--tyre-inter` → `#3BB273`.
- **Washes:** `rgb(var(--onair-rgb) / 0.15)` computes to `rgba(225, 6, 0, 0.15)`
  and `rgb(var(--amber-rgb) / 0.15)` to `rgba(255, 176, 0, 0.15)` — identical to
  the literals they replaced. Zero rules with a raw `rgba(` remain.
- **Contrast, re-measured live** (WCAG relative-luminance against the rendered
  composite, not estimated): `--amber`/`--pit` 9.80:1; tyre legend S 5.45 · M 10.94
  · H 14.66 · I 6.67 · W 7.62. Every ratio comment in `tokens.css` matches its
  measured value; none was carried over unverified.
- **Layout:** zero horizontal page overflow and zero tower-table overflow on
  board, compare and ghost. Agent 2's container-query column drops, roving
  tabindex, dashed ghost ring and recessed selected row all intact.
- **Routes:** board (selection → telemetry + sector deltas), `#compare` (both
  lanes streaming), `#ghost` (solid + dashed ghost markers, delta bar, scrubber).
- **Console: zero errors** across all three routes.

---

## Agent 4 — visual refinements

Scope: `reviews/frontend-design.md`, refinements 1–7 of the ranked list (the
report's own "items 1, 3, 5, 6 land most of the perceived quality gain"). The
report's verdict was that the direction is real but *"doesn't yet perform"* — a
well-engineered dashboard rather than a broadcast graphic — and that the gap is
almost entirely **scale and hierarchy**. Nothing here redesigns anything; every
change is values, weights, and one shared colour key.

Built on agents 1–3 without regressing them: every contrast floor, the table
semantics, the roving tabindex, the container-query column drops and the
token-only-colour rule are intact and were re-checked, not assumed.

### Fixed

**1. The tower has the constructor key the map always had.** `TimingTower.tsx`
sets `--team` per row from `teamColours.ts`; `.tt-table td:first-child` paints it
as a 3px `border-left`. The board's two hero surfaces finally share one identity
system — a dot on the map and a row in the tower are tied by colour.

- **The driver code is deliberately NOT coloured.** Haas `#B6BABD` and
  AlphaTauri `#2B4562` are among the constructor hexes that miss the 4.5:1 text
  floor on carbon; a rule carries the key without spending any contrast. Pinned
  by a render test.
- **Agent 2's recessed selected row keeps both signals.** The obvious
  implementation — overriding `border-left-color` to `--chalk` on selection —
  would have made the one row the user just chose the one row with no team on it.
  The chalk marker moved to `box-shadow: inset 2px 0 0`, drawn *inboard* of the
  team rule. Verified live on a selected Ferrari row: `border-left 3px
  rgb(232,0,45)` **and** `box-shadow rgb(233,237,241) 2px 0 0 inset`.
- Unknown constructor falls back to `transparent` at the same width, so nothing
  shifts.

**2. A real type scale, and the weight axis finally used.**

| What | Before | After |
|---|---|---|
| `.rail-clock` (session clock) | 14px/400 | **28px `--fs-hero`/600**, `letter-spacing: -0.01em` |
| `.rail-session`, `.rail-lap` | 12px sentence case | 12px **uppercase, `letter-spacing: 0.14em`**, `--slate` |
| Position column | 12px/400 | **14px `--fs-lg`/700** |
| Best column | 12px/400 chalk | **300 weight, `--slate`** (`.tt-quiet`) |
| Ghost delta readout | 18px `--fs-xl` | **22px `--fs-2xl`/700** |

- New rung `--fs-2xl: 1.375rem` (22px) — the token file had a hole exactly where
  the secondary headline numbers live.
- **The report asked for 10px on the rail labels; that is not what landed.**
  `--fs-2xs` is the token it named, and agent 2 retired the 9/10px rungs as below
  the legibility floor. The demotion is carried by case, tracking and colour
  instead of by size, which honours both documents. Same for the sector-delta
  superscripts (report §7 wanted 9px → 10px; they are already 11px).
- `.ghost-controls .rail-clock` is scoped back to `--fs-lg`: Ghost reuses the
  clock face for its scrubber position, and the display rung belongs to the
  session clock, not to a readout sitting next to a `<select>`.
- Skipped from the report's item 2: `--fs-2xl` on the **leader row's Gap cell**.
  The report's premise was "the leader's gap number", but this tower renders the
  literal word `LEADER` there — and a 22px nowrap cell would widen the Gap column
  for all twenty rows and blow the container-query budget to buy nothing.

**3. The track surface, which was inverted for a dark theme.** The casing/surface
technique was right and the values were backwards: the surface `#1A1A1A` was
within a hair of the panel it sat on (`--carbon #14171C`), so the road had no
body and the circuit read as two grey hairlines.

- `--track-fill: #2B313A` (a step above `--edge` — the road now has a surface),
  `--track-edge: var(--asphalt)` (aliased, not re-typed, per agent 3's rule — the
  casing reads as a seam cut into the panel).
- `TrackPath.tsx` strokes widened 10/6 → **12/8**.
- Measured live: road-vs-panel **1.37:1** (was ~1.15, i.e. invisible),
  road-vs-casing 1.49:1. Both decorative, no floor applies. The one piece of text
  on them, the driver code, measures **11.29:1** on the new road.

**4. The map viewBox is fitted to the path, not to a fixed `0 0 600 600`.** This
was the risky one and it is the biggest visual win.

`ingest/record.py`'s `normalise()` scales both axes by the *larger* range to
preserve aspect ratio, so the narrow axis is letterboxed inside the unit box.
Measured on the running board: Monza's outline occupies **372 × 599** of the 600
square — the fixed viewBox spent ~38% of every map panel drawing nothing.

- `geometry.ts` gains `fitViewBox()` and `trackPathD()` (the latter deduped from
  byte-identical copies in `Map.tsx` and `Ghost.tsx`). Padding is 4% of the
  longer side with a 14-unit floor, **plus a 34-unit allowance on the right
  only** — a driver code is drawn 10 units right of its marker and runs ~3 glyphs,
  and a symmetric box was clipping labels by ~6 units on the compare lanes.
- **Car dots are not re-projected.** They are plotted in the same SIZE-space, so
  narrowing the window moves the frame, not the dots. This is the invariant the
  whole change rests on and it is both unit-tested and browser-verified.
- `.track-svg` is now sized from its **height** with `width: auto`. This is the
  half that actually removes the dead space: once the box is cropped to the
  circuit's bounds a portrait outline has a ratio well under 1, so keeping
  `width: min(600px, 100%)` would have made the map 1.6× *taller* than it was
  wide. `--track-h` is 420px by default and 640px on `.ghost-track`.
- `.board-top` map column: `minmax(0, 460px)` → **`auto`**. The column now sizes
  to the map and hands the difference straight to the tower.
- Ghost's delta bar moved to its own `.delta-svg` (it is a 600×90 strip and would
  have been rendered 420px tall by the new height-driven rule).
- `.compare-lanes > .panel` gets `flex: 1 1 460px; min-width: 0` — the lanes had
  no flex at all and left a ~400px dead margin at 1440px.

Measured, board at 1440×900:

| | Before | After |
|---|---|---|
| Map svg box | 434 × 434 | **279 × 420** (no letterbox inside it) |
| Map panel width | 458px | **281px** |
| Tower container | 867px | **1044px** |
| Ghost map | 600 × 600 | **418 × 630** |
| Compare lanes | content-sized, ~400px dead right margin | **682px each, filling the row** |

**5. Green means something again.** `sectorColour`/`sectorMark` were correct F1
semantics defeated by the observed state: in a replay window most drivers' current
sector is their first sample there, so it trivially ties their own record. Measured
on the running board before the fix: **54 of 60 sector cells green (90%)**, with
purple drowning in it.

- `Bests` is now `Record<number, [SectorPb, SectorPb, SectorPb]>` where
  `SectorPb = { best, last, samples }`, and `personalBestOf(pb, dn, i)` returns
  `Infinity` until `samples >= PB_MIN_SAMPLES` (2). Infinity is *already* what
  "no personal best yet" means to `sectorColour`, `sectorMark` and `sectorDelta`,
  so the threshold lands in one accessor without touching any of those three —
  they stay pure functions of the numbers handed to them.
- **`last` is the load-bearing detail.** The wire re-broadcasts the same sector
  time at 10 Hz between completions (ADR-0002), so a *frame* is not a sample — a
  changed value is. Counting frames would have cleared the threshold in 100 ms and
  meant nothing. There is a test that hammers 20 identical frames and asserts
  `samples === 1`.
- Purple is untouched and still outranks the threshold — a session best on a
  driver's first lap is real.
- Measured after: **6/60 green (10%) on a cold open, 15/60 (25%) after a long
  replay window**, purple 3 throughout. Green now means "improved on a time you
  had already set here".

**6. The board auto-selects the race leader on the first frame with cars.**
Telemetry and Comms opened as placeholder boxes explaining a *setting*; Telemetry
is also the one place `--fs-hero` was already wired up, so this puts display type
on the board for free — the report's "reinforces refinement #2 at no cost".

- New `leaderOf()` in `timingHelpers.ts`; `leaderLapOf()` now delegates to it, so
  there is still one definition of "who is in front".
- Implemented as an **adjusting-state-during-render seed**, not an effect: this
  repo's lint config rejects both `setState` inside an effect body
  (`react-hooks/set-state-in-effect`) *and* reading a ref during render
  (`react-hooks/refs`), so the once-only guard is a `leaderSeeded` state flag.
  `useState`'s initialiser cannot do this job — it runs before any frame arrives.
- **Guarded by the flag, not by `selected == null`**, precisely so it does not
  fight agent 5: a user who clears the selection (ui-ux M4) must not get the
  leader pushed back at them on the next frame. Only the auto-select-on-first-frame
  half is implemented here; toggling-off, `Esc` and the clear affordance are M4's
  and stay untouched.
- Does not disturb agent 2's roving tabindex: the entry point already preferred
  the reference car and fell back to the leader, so the tab stop is unchanged.

**7. Settings prose has a measure.** `.panel-body .prose { max-width: 68ch }`, and
the fragment in `Settings.tsx` became a `<div className="prose">`. 68ch rather
than the brief's ~70ch so it matches `.demo-notice` — one reading width in the
app, not two. Measured: **68 characters per line, down from ~200** in a 1375px
panel.

### Also fixed, because I was in the file

- **`.rail-tabs` had no `flex-wrap`**, so its 464px min-content floor forced a
  **147px horizontal page overflow at 375px**. Confirmed pre-existing (reproduced
  with all of my typography changes neutralised in the browser). Now wraps, with
  `justify-content: flex-end`, and 375px measures **zero page overflow**.
- **`margin-left: auto` on `.rail-tabs`** — the report's item-8 bug: `.rail-spacer`
  collapses when the rail wraps, so the nav dropped to a *left-aligned* second row
  and the chrome visibly changed shape. Verified right-anchored on both lines.
  (The rest of item 8 — the instrument-cluster restructure — is untouched.)
- **Container-query thresholds re-measured**, because the position column's real
  type costs ~18px per state. Table widths went 753/678/611/269 → **771/694/629/278**,
  and the thresholds are now rounded *up* (775/700/635) so each step fires just
  before the table clips rather than just after. Agent 2's originals sat a few px
  below the measured widths, which left a 3–7px clip in a narrow band.

### Skipped, with reason

- **Report items 8 (rail as instrument strip), 9 (Compare's grammar + a real
  delta), 10 (Ghost's headline delta promoted to 44–56px), 12 (copy)** — outside
  this agent's brief. 9 and 12 in particular are information-architecture and copy
  work that ui-ux M6/M12 already own. I took only the one-line bug from item 8 and
  the `--fs-2xl` bump from item 10, both of which are pure value changes.
- **Report item 7's tower row rhythm** (`padding: 4px`, inset hairline between
  rows) — not in the brief, and it is the one item that trades directly against
  agent 2's density and container-query budget: +2px per row over twenty rows
  re-flows the four-up bottom strip. Wants to be measured as its own change.
- **Item 7's superscript throttling to ~2 Hz** — a real idea, but it is a
  rendering-cadence change to live data, not a visual refinement, and it would
  need to be reasoned about alongside the Freeze control agent 2 added.
- **Item 5's fallback** (splitting personal-best green to `#2E8C5B`) — explicitly
  the report's second choice, and unnecessary once the honest fix landed.
- **Item 6's "give Comms a resting state with substance"** — that is content
  design for the Comms panel, not a value change; the auto-select half is what the
  brief asked for.
- **A per-driver card layout below ~700px** — still the right answer at phone
  widths and still ui-ux M8's, unchanged by this pass.

### Regression checks — done deliberately

- **Contrast floors**: nothing agent 2 or 3 tuned was touched. `--dim`, `--slate`,
  the tyre tokens, `--amber`/`--pit` and the recessed selected row are all as they
  left them. The two new colours are decorative track chrome with no text on them
  except the driver code, re-measured at 11.29:1.
- **The `.tt-quiet` Best column is a class, not `td:nth-child(6)`**, specifically
  so `.tt-row-out`'s `--dim` still outranks it on retired rows. `--slate` (5.8:1)
  is above the floor either way.
- **Token-only colour rule** holds: the only new literal is `--track-fill` in
  `tokens.css`; `--track-edge` aliases `--asphalt`. `--team` is set from
  `teamColours.ts`, which agent 3 already classed as brand data rather than theme,
  and is used the same way `Map.tsx` already used it.
- **Table semantics, roving tabindex, live regions, touch targets** all unchanged;
  375px still measures **zero interactive targets under 24px**.

### Verification

In `web/`, on the final tree:

| Check | Result |
|---|---|
| `npm test` | 16 files, **162 passed** (146 before, +16 new) |
| `npm run lint` | clean |
| `tsc -b --force` | clean |
| `npm run build` | ✓ built, `dist/.gitkeep` intact |
| `VITE_STATIC_DEMO=true npm run build` | ✓ built, `dist/og.png` emitted; env var cleared afterwards, normal build re-run last |

Tests added:

- `geometry.test.ts` (new) +8 — `trackPathD` scaling and its empty-outline bail;
  `fitViewBox` crops the letterboxing, keeps padding on every side, keeps **every
  outline point inside the box** (the invariant the car dots ride on), leaves the
  extra right-hand room for labels, falls back to the full square before data, and
  gives a degenerate one-point outline a real box.
- `TimingTower.test.ts` +5 — a changed sector counts as a sample and 20 identical
  frames do not; `personalBestOf` withholds green until the second time and then
  awards it; purple outranks the threshold; `leaderOf` agrees with `orderCars[0]`.
- `TimingTower.render.test.tsx` +3 — every row carries `--team`, an unknown
  constructor falls back to `transparent`, and the driver code is never painted
  with a team hex.

Browser checks against `npm run dev` (port 5184) proxying the running docker
gateway, board streaming 20 rows:

- **Dots on the track, all three views.** 600 marker samples over 30 frames on the
  board: **zero outside the fitted viewBox**, zero content clipped, and the
  distance from each marker to the road centreline is **median 0.3 / max 5.1
  units** against an 8-unit-wide surface and a 7-unit marker radius — every dot
  visibly sits on the road. `#compare` both lanes and `#ghost` re-checked: 20/20,
  20/20 and 2/2 markers inside, nothing clipped. (One car, TSU, sits 36 units off
  the centreline in the 2023 lane while in the pit lane — the outline is the
  leader's racing line, so that is the data, and it is unchanged by this pass.)
- **Zero horizontal page overflow and zero table overflow** at 1440 / 1280 / 768 /
  375, with 375 also at zero sub-24px targets.

| Viewport | Tower container | Columns | Table overflow |
|---|---|---|---|
| 1440 | 1044px | all ten | 0 |
| 1280 | 884px | **all ten** (was nine — Best returns) | 0 |
| 768 | 679px | eight (was nine) | 0 |
| 375 | 301px | five | 0 |

  The 768 trade is deliberate and worth naming: the position column's real type
  costs ~18px, which pushes Int out one step earlier there — in exchange for Best
  returning at 1280px, which is the far more common desktop.

- **Console: zero errors** on a fresh load and across a full `#compare → #ghost →
  #settings → board` cycle. The remaining `[warn]` lines are Chrome's own
  StrictMode dev double-mount socket notices, exactly as agent 2 documented.
- Settings prose measures 68 characters per line; the panel is 1375px wide.

**One caveat on method:** screenshots were unavailable in this session — the
browser pane never composited frames, so `computer{action:"screenshot"}` timed out
every time. Everything above is measured from the live DOM and computed styles
(geometry, contrast ratios, `getBBox`/`isPointInStroke`/`getPointAtLength` against
the real rendered paths) rather than eyeballed. That is stricter than a screenshot
for the numbers, but it means **the before/after look has not been visually
compared by eye** — worth a human glance at the board, compare and ghost routes,
particularly at the new track surface and the 28px rail clock.

## Agent 5 — interaction and UX

Scope: `reviews/ui-ux.md` (42 findings) — interaction design, flows, information
architecture, mobile and microcopy. Built on agents 1–4 without regressing them:
the table semantics, roving tabindex, contrast floors, token-only-colour rule,
fitted viewBox and `leaderSeeded` auto-selection are all intact and were
re-checked rather than assumed.

The report's verdict was **"strong presentation, shallow-feeling interaction"** —
the board looks like a broadcast graphic and then answers a click in one panel out
of six, prints impossible numbers in the one column a reader checks for
correctness, and rewinds its own clock every few minutes without saying so. This
pass is about the second half of that sentence.

### Fixed

**B2 (blocker) — the vs-comparison had never once rendered whole.** Two
`CarTelemetry` cards, each with `min-width: 200px`, in a `repeat(4, …)` grid cell
that measured 324px, with `overflow-x: visible` — so the second card was cut off
mid-word by the panel border at every viewport, with not even a scrollbar to
recover it. Three changes, in the order of who does the work:

- `.board-bottom` is no longer four equal columns for four panels with wildly
  unequal content (m2 as well): `1.3fr 1.2fr 0.75fr 0.75fr`. Strategy and
  Telemetry are the dense ones; Comms and Race Control were rendering three lines
  into 440px of emptiness.
- `Panel` gained a `className` prop, and App passes `panel-wide`
  (`grid-column: span 2`) whenever a rival is picked. The comparison gets a half
  of the strip rather than a quarter, and only while it needs it.
- `.telemetry-cards` wraps and `.telemetry-card` is `flex: 1 1 240px;
  min-width: 0` — the cards narrow first and stack second. The 200px floor is
  gone; a flex child's default `min-width: auto` was what made the overflow
  inevitable. `.telemetry-card svg { max-width: 100% }` keeps agent 2's reserved
  sparkline width from becoming the next overflow on a phone.

Measured at 1440×900 with a rival selected: panel 840px, both cards 399px,
**0px overflow** (was 442px of content in a 324px body). At 1280: 349px each,
0px. At 390: stacked, 0px page overflow. Each card now says which it is
(`Reference car` / `Rival`) — with two live traces and no labels, the only thing
telling them apart was the driver code.

**M1 — the replay loop rewound the whole board in silence.** `state.loopSeq` is
bumped in `applyMessage` the moment a frame's `timeMs` goes backwards by more
than 5s (frames are 100ms apart, clips are minutes — the threshold separates a
wrap from a reordered frame). That is the same signal `internal/model/apply.go`
already uses server-side; the client had no equivalent, which is why the
race-control buffer accumulated duplicates the server had already dropped.

- **The buffer is cleared on the wrap.** Verified live through a real wrap: Race
  Control held **1 message, no duplicates, in order** afterwards (the report
  measured `1:14:24, 1:19:37, 1:18:37, 1:14:24` — four entries, two of them
  repeats, newest-first notwithstanding).
- **A transient notice**, `↻ CLIP LOOPED — the recording restarted`, in the rail's
  existing polite status region for 8 seconds. Caught live: the chip was present
  across nine consecutive 500ms samples at the exact moment the clock rewound.
- **And it is said up front too**: the replay chip reads `▶ REPLAY · LOOPING CLIP`
  rather than `▶ REPLAY`. A clock that runs backwards reads as a bug unless the
  reader was told to expect a fixed-length recording on repeat.
- **Personal bests reset across the loop.** `TimingTower`'s bests effect already
  reset on a session change; a wrap is the same problem inside one session and
  was missed — every driver drives the same sectors again, and their bests from a
  pass the viewer never saw are still standing, so nothing can go green. Same
  reset, same reason, keyed on `state.loopSeq`. Agent 4's `Bests {best, last,
  samples}` structure is extended, not forked.
- Radio is deliberately NOT cleared on a wrap, mirroring the Go side: only replay
  lanes loop, and replay frames never carry radio (ADR-0008).

**M10 — the Gap column was non-monotonic and printed three decimals it did not
have.** Two separate display problems, fixed in the display; the estimate itself
is untouched.

- **Precision.** Every observed gap is a multiple of ~0.566s, so `fmtGapEstimate`
  renders one decimal (`+7.4`, not `+7.364`). `fmtGap`'s three decimals stay
  exactly where they are honest — the sector deltas, `Last`, `Best`.
  `GAP_RESOLUTION_MS` is named with the evidence in its docstring.
- **Stability.** A window of nine readings per driver (`updateGapSmoothing`), a
  **median** to reject a hopped sample without smearing it the way a mean would,
  and then `settle()` — the printed number only follows the median once it has
  moved by more than one resolution step (`GAP_HYSTERESIS_MS = 750`). Measured on
  the running board: the top-eight Gap column rendered **6 distinct states over
  112 samples (~11s)**; before, the same measure was **10 distinct states in 2s**.
- **Contradiction.** `displayGaps` clamps each car's gap up to the car in front's,
  and derives the **Interval as the difference between neighbouring clamped
  gaps** — so `Int` is non-negative by construction and the two columns cannot
  disagree with each other or with the running order. Live at 1440: `LEADER /
  +7.4 / +10.8 / +12.5 / +22.7`, intervals `+7.4 / +3.4 / +1.7 / +10.2` — they
  add up, which they never did before.
- **The disclaimer now matches the display**: "Gap / Int are estimated from track
  position and shown to 0.1s — not official timing", and both cells carry the same
  sentence as a title (they used to say "best-effort, derived", which is the first
  half only).
- **The Interval was left as the second column, not promoted.** The brief floated
  making it primary; once the two are reconciled the ordering problem is gone, and
  Gap-then-Int is what every timing screen in the sport shows.

**M14 (half) — "Gaps in seconds" produced a unit nobody can read.** A lapped car's
deficit rendered as `+643.581`. `fmtLongGap` renders `+10:43.6`. The control's
placement (the report wanted it in the Gap column header) is not changed — see
skipped.

**M2 — selection reached two panels of six; it now reaches five.**

- **Track map**: the selected car gets a chalk ring, the rival a dashed one —
  the same solid-vs-ghost grammar the overlay route already uses, so the two views
  teach one vocabulary. The rest of the field is **not** dimmed further: `--dim`,
  the pit 0.6 and retired 0.5 steps are already sitting on their contrast floors,
  and stacking another multiplier on them would spend the whole budget agent 2
  just bought. The ring is a shape difference, which costs nothing.
- **Strategy chart**: the selected driver's row is outlined and its code brought
  to full strength; the rival gets a dashed outline. `selected`/`rival` joined the
  memo comparator, or the highlight would lag a selection behind.
- **Race Control**: messages about the selected driver carry a chalk edge.
- Telemetry and the tower already responded. The sixth panel is Comms, whose
  clips are not selectable by driver — noted rather than forced.

**M4 — selection was a one-way door.** Re-clicking the selected row clears it
(`onSelect` now takes `number | null`), `Esc` clears it from anywhere on the
board, and the tower footnote carries a visible `Clear reference car` button.
The Esc handler steps aside while focus is in a `<select>`/`<input>` so it cannot
steal the key from a native picker. Verified live: click → `aria-pressed=true`,
ring on the map, hint becomes the status line; click again → 0 pressed, 0 rings,
hint back to the invitation — **and the leader is not re-seeded**, because agent 4
guarded that with `leaderSeeded` rather than `selected == null` precisely so this
change would not fight it.

**M3 — the reference-car hint explained itself only to people who had already
found it.** It was gated on `refCar`, i.e. it rendered *after* the first click.
Split in two: `Choose a driver row to set the reference car — sector deltas then
compare against it.` before, and `Sector deltas compare against VER. Clear
reference car (or press Esc)` after. The rows' resting affordance is agent 4's
per-row constructor rule, which arrived after this report was written.

**M5 — verified rather than re-fixed.** Agent 2 reserved the delta superscript's
width (`.tt-delta { min-width: 3.4ch }`) and agent 4 re-measured the container
thresholds. Re-checked on this tree *with a reference car selected*: 1440 → table
1021px in a 1022px container, **0 overflow, all ten columns**; 1280 → 861px in
862px, **0 overflow, all ten columns**. Selecting a driver no longer changes the
table's width at all.

**M8 — the phone tower is one card per driver.** Below a 560px *container* width
(a container query on `.tt-scroll`, so it tracks the tower rather than the
viewport) the table becomes one card per row: position and driver code as the
headline, then the eight remaining readouts in a 4-column grid, each labelled from
its own `data-label`. Measured at 390×844: **all ten columns present, 0px
horizontal overflow anywhere**, where the report measured an 811px table in a
311px window with six columns behind a nested horizontal scroll.

- Labels and values share a line rather than stacking. Stacked, a card was 162px
  tall — 3,200px of scroll over twenty drivers, which trades a bad horizontal
  gesture for an unreadable vertical one. On one line a card is 108px and the page
  is 4,795px (against 2,893px before, when it was hiding 62% of the data).
- **The table semantics survive the layout change**: every `tr`/`td`/`th` carries
  an explicit `role`, because changing `display` on a table element is exactly
  what makes a browser drop the implicit ones. Agent 2's work is the reason this
  needed care; the roles are redundant on desktop and load-bearing on a phone.

**M11 — the map was noise on a phone.** Below 700px only the reference car's and
rival's labels are drawn; twenty three-letter codes at a fixed size in a ~330px
square print over each other. This is the first time the map has had a reason to
know about the selection, which is M2 paying for itself. Verified at 390px: **2
visible labels of 20.**

**M9 — the overlay opened on what looked like a still image.** The Controls panel
(driver picker, Play, scrubber, live delta) is now the first panel on the route
rather than the third, and `.ghost-track` is 520px rather than 640 so the delta
chart is not pushed off a 900px screen on its own. Measured at 1440×900: Controls
111–211, Track 235–841, **Lap time delta's plate at 865** — inside the fold,
which is what invites the scroll. Plus a legend on the map itself
(`● 2024 (solid) · ◌ 2023 (ghost)`) — the two dots overlap for most of a lap and
nothing said which year was which.

**M12 — LINK was an operator runbook in a primary navigation slot.** The nav is
three views; the F1TV link page keeps a permanent affordance beside the repo link,
quieter than a tab, still one click, with `aria-current="page"` and an underline
when it is the current route. Agent 1's note that the repo link is deliberately
not a tab is why there was room for this treatment.

**M7 (mobile half) — Compare no longer shrinks its map to a thumbnail.** Below
700px the lane stacks the map above the standings instead of beside them:
measured at 390px, the map is **279px wide (was ~110px with twenty dots
overlapping)**, and the standings entries are single-line. The tab's sub-label
also stops claiming "side by side" — see m21. The full A/B lane switch is skipped;
see below.

**M13 / n3 — noted as closed by agent 2.** All three toggles now carry
`aria-pressed` with stable noun labels, which is the substance of the finding.
The remaining half — making every toggle the same segmented control — is skipped.

**Minors and nits**

- **m1** — Comms history rows had no information scent: six identical `CODE ▶`
  rows. They now carry the race clock, a `Newest first` header, and a `PLAYING`
  chip on the active row, and the play button's accessible name includes the time.
- **m2** — the four-up strip is weighted by content, not by count (with B2).
- **m3** — the Strategy chart has a lap axis (`1 · 10 · 20 · 30 · 40 · 53`, from
  `axisTicks`, which steps by ten for a grand prix and five for a sprint), a
  labelled leader marker (`▲L14`), and the tyre legend repeated inside the panel
  rather than several hundred pixels away in a different container. Its footnote
  now says what the marker is.
- **m4** — Race Control stops appending a driver code the message already carries.
  `needsDriverTag` splits into words rather than substring-matching, so `CAR 311`
  does not count as naming car 31. Verified live: `CAR 55 (SAI) TIME … DELETED`
  with no trailing `(SAI)`.
- **m5** — `Delta bar` is `Lap time delta`; the code comment that explained the
  chart (`red above the midline = this year slower`) is on screen as an axis key,
  with the auto-fitted scale printed beside it (`full height = 2.68s`) so a 0.05s
  spread and a 5s spread no longer look identical.
- **m9** — sparklines need four points, not two, and say `Lap and gap trends build
  after 4 laps` until then. A single green bar beside an em-dash read as a fault.
- **m11** — rows no longer reorder under the pointer. While a **mouse** is over
  the table the running order is held (`holdOrder`) and only the values update;
  the footnote says so while it is happening. Mouse only: on a touch screen
  `pointerenter` fires on the tap itself, so a touch user would pin the order by
  reading and never release it. A car that appears mid-hold is appended, never
  hidden.
- **m12** — a two-column tier for `.board-bottom` between 700 and 1100px; the
  single breakpoint took every tablet straight to the full phone stack.
- **m13** — agent 2 raised the scrubber's hit area to 44px; it also gets its own
  full-width row below 700px instead of sharing a wrapped flex line.
- **m14** — the overlay's bare `−1.66s` reads `2024 ahead by 1.66s here` (and
  `2024 level here` at zero); the Telemetry Gap row is suppressed until there is
  a trend rather than showing `—` beside a bar.
- **m15** — a car the feed carries but has said nothing about renders `NO DATA` in
  the Gap cell, using the same treatment as `IN PIT`/`OUT`, instead of six
  em-dashes that read as a rendering fault.
- **m16** — the settings chip says `LINKED · NO SUB` when the body says there is
  no active subscription. The chip and the body used to tell opposite stories.
- **m17** — the three commands have copy buttons, and the two URLs are links
  rather than inert `<code>`. On a page whose whole job is "go here, run this",
  that was the missing control.
- **m18** — "F1TV" appeared three times on one screen; the rail note is gone (and
  the tab with it, via M12).
- **m19** — Compare's standings are a fixed grid with `white-space: nowrap`, so
  `+1 LAP` stops splitting across lines and twenty numbers align. Measured: every
  row 17px, one line.
- **m20** — the rival picker's visible label is `Compare with`, and the empty
  option is `— pick a rival —` (an invitation) rather than `— none —` (a state).
- **m21** — agent 4 stopped the sub-labels wrapping; below 500px they are dropped
  entirely. The four primary words say the same thing, and it is also what stops
  COMPARE claiming "side by side" on the one viewport where it is false.
- **n1** — the live badge reads `● LIVE LANE · RECORDED CLIP` on screen; the
  qualifier was honest only in a `title` attribute.
- **n5** — the panel entrance stagger runs on the first page this app paints and
  never again. It is keyed off `.page-intro`, set by `Route` from a module-level
  flag cleared in an effect — the question is "has this app ever painted", not
  "has this component mounted", and a hash change remounts the whole route.

**Not in the report, fixed because this pass provoked it:** the tower's unkeyed
scroll measurement got a **deadband** (4px to turn on, 0 to turn off). It runs
after every render, the table's content width moves a pixel or two between frames,
and a table sitting exactly on the boundary flipped the flag on alternate renders
— each flip a setState from an effect that then runs again, which during a burst
(a clip wrap changes every sector cell at once) can chain far enough to trip
React's nested-update guard. One "Maximum update depth exceeded" was observed in
the console during a wrap before this; none after.

### Skipped, with reason

- **M6 (COMPARE doesn't compare).** The four sub-parts are a shared lap cursor,
  a shared bounding box for the two outlines, standings rows that link into
  OVERLAY, and possibly a rename. Each is a real change to what the view *is* —
  and `CONTEXT.md` draws an explicit product line ("compare is uncomputed
  side-by-side; ghost is where computation lives") that a shared lap cursor starts
  to cross. It wants a decision, not a drive-by. The mobile half (M7) is fixed;
  the tab's sub-label is now `two replays`, which at least stops the label writing
  a cheque the view does not cash.
- **M7's A/B lane switch on mobile.** Stacking the map above the standings is the
  cheap half and it is done. One-lane-at-a-time with a `2023 | 2024` segmented
  switch is a state and routing change to a view M6 may be about to restructure.
- **M14's control placement** (moving "Gaps in seconds" into the Gap column
  header, flashing the affected cells). The unreadable-unit half is fixed. Moving
  a control into a `<th>` fights the container-query column budget agent 2 and
  agent 4 both tuned, and "flash the affected cells" is a motion decision on a
  10 Hz table with a Freeze control sitting next to it.
- **M13's segmented unification.** Every toggle now exposes its state
  (`aria-pressed` + `.btn-active`), which is the finding's substance. Converting
  Comms and the gap units into segmented radio groups like `SourceToggle` is a
  component change that would want the same roving-tabindex treatment agent 2 gave
  the original, for two controls that are genuinely binary.
- **m8 (the rail chip duplicates the control beside it).** Half-addressed: the
  chip and the button no longer read as the same word (`▶ REPLAY · LOOPING CLIP`
  vs `▶ Replay`), and the chip is now carrying information the button does not.
  Dropping the chip entirely in the healthy case is the report's actual
  recommendation and would leave the rail with no lane readout at all on the
  routes that have no toggle — worth its own look.
- **m22 (sticky nav on mobile).** The rail is 200px tall on a phone even with the
  sub-labels dropped — brand, session, clock, lap, weather, chips, controls and
  three tabs. Making *that* sticky costs a quarter of the screen. The finding
  wants a compact 32px tab strip, which is a second rail component rather than a
  CSS rule, and it interacts with the instrument-cluster restructure agent 4 left
  open (frontend-design item 8).
- **m14's third bullet** (Race Control shows a race clock beside a wall clock
  embedded in the message text). Stripping a timestamp out of upstream FastF1 copy
  by pattern-matching is the kind of "clean up the data in the view" that goes
  wrong on the one message shaped differently.
- **M11's marker-radius scaling.** The labels were the illegible half and they are
  fixed. The markers themselves are drawn in the fitted viewBox's own units, so
  they scale with the map rather than staying 7 CSS pixels — agent 4's change
  already took the sting out of this one.

### Not regressed — checked deliberately

- **Table semantics**: no `role="button"`, no `<tr tabindex>`, `scope="col"`
  intact, and the new explicit roles match the implicit ones exactly. The phone
  card layout is the reason they are written down.
- **Roving tabindex**: still one tab stop for the tower, still keyed by driver
  number; the held order does not change which driver holds the stop.
- **Contrast floors**: no colour was retuned. The two new painted things are a
  chalk ring on the map (decorative, over the track surface) and a chalk edge on a
  Race Control row. `--dim`/`--slate`/the tyre tokens are untouched, and the
  unselected map field is deliberately *not* dimmed further.
- **Token discipline**: no new colour literal anywhere; every new rule resolves
  through `tokens.css`. The only new numeric constants are the gap window, the
  hysteresis and the loop threshold, all named and annotated in `timingHelpers.ts`
  / `race.ts`.
- **Touch targets**: 390px measures **zero** interactive targets under 24px — the
  new `Clear reference car` button was the one exception and it now has a 24px
  floor (44px under a coarse pointer).
- **Agent 4's leader seeding** fires exactly once and does not fight the new
  clear; **agent 4's fitted viewBox** is untouched and the ring is drawn in the
  same SIZE-space as the markers.

### Verification

In `web/`, on the final tree:

| Check | Result |
|---|---|
| `npm test` | 18 files, **191 passed** (162 before, +29 new) |
| `npm run lint` | clean |
| `tsc -b --force` | clean |
| `npm run build` | ✓ built, `dist/.gitkeep` intact |
| `VITE_STATIC_DEMO=true npm run build` | ✓ built, `dist/og.png` emitted; env var cleared and the normal build re-run last |

Tests added:

- `gapDisplay.test.ts` (new) +25 — one-decimal and `m:ss.s` gap formatting; the
  median's outlier rejection; `settle`'s hysteresis (holds through a one-step
  wobble, follows a two-step move, keeps the last value when the window empties);
  `displayGaps` leaving the leader blank, never showing a car behind as closer
  than the car in front, and deriving the interval from the reconciled gaps;
  `holdOrder` replaying a captured sequence and never dropping a car; `hasNoData`;
  `needsDriverTag` (including `CAR 311` ≠ car 31); `axisTicks`.
- `race.test.ts` +4 — a wrap bumps `loopSeq` and drops the previous pass's
  messages, clears the buffer even when the restarting frame carries none, does
  **not** fire on a frame arriving 100ms out of order, and does **not** fire on a
  fresh snapshot (a reconnect rebases the clock downwards and that is a new
  baseline, not a wrap).
- Existing expectations updated where the display change is the point: four gap
  assertions in `TimingTower.test.ts` and one in `Standings.render.test.tsx`.

Browser checks against `npm run dev` (port 5207) proxying the running docker
gateway, board streaming 20 rows at `LAP 14/53`:

| Viewport | Page overflow | Tower | Telemetry with a rival |
|---|---|---|---|
| 1440 | 0 | 1021px table in 1022px, ten columns, 0 clip | panel 840px, cards 399 + 399, 0 clip |
| 1280 | 0 | 861px in 862px, ten columns, 0 clip | cards 349 + 349, 0 clip |
| 390 | 0 | card layout, ten readouts, 0 clip | stacked, 0 clip |

- **A real clip wrap was caught live** on the docker replay: the clock rewound,
  the `↻ CLIP LOOPED` chip appeared for the whole notice window, and Race Control
  came out the other side with one message and no duplicates.
- **Gap stability**: 6 distinct renderings of the top-eight Gap column across 112
  samples over ~11s, against 10 distinct in 2s before.
- **Selection**: ring on the map, outline in the Strategy rows, edge in Race
  Control; click-again and Esc both clear it; the hint swaps both ways.
- **Routes**: `#compare` (three tabs, lanes stack on mobile with a 279px map),
  `#ghost` (Controls first, both keys present, delta plate inside the fold),
  `#settings` (no rail note, three copy buttons, two real links, prose at 619px).
- **Console: zero errors** on a fresh load and across selection, resize and route
  churn at 390 and 1440.

**Same caveat on method as agent 4:** the browser pane never composited frames, so
`computer{action:"screenshot"}` timed out every time. Every number above is
measured from the live DOM and computed styles rather than eyeballed — stricter
for geometry, but it means the *look* of the new phone cards, the map ring and the
overlay's re-ordered panels has still not been compared by eye. Worth a human
glance at `#ghost` at 900px tall and at the board at 390px.

---

## Remaining after all five agents

Open items from the four UI reports, with who left them and why. Nothing here is a
blocker; every one is a decision rather than an oversight.

**Information architecture and product lines**

- **ui-ux M6 — COMPARE computes nothing.** The tab's name, the missing shared lap
  reference, the two independently-normalised outlines, and the absent path into
  OVERLAY. Touches the `CONTEXT.md` compare/ghost line, so it is a product
  decision. (Agents 1 and 5.)
- **ui-ux M7's A/B lane switch on mobile** — sits on top of M6.
- **frontend-design item 8 — the rail as an instrument cluster**, and **item 9 —
  Compare's grammar and a real delta**, and **item 12 — the copy pass**. (Agent 4;
  9 and 12 overlap M6 and M12.)
- **ui-ux m22 — a compact sticky tab strip on mobile.** Wants the rail
  restructure above. (Agent 5.)
- **accessibility M-7 — selection is not deep-linkable.** Now that selection is
  clearable and reaches five panels, the URL question is worth revisiting: it is
  push-vs-replace history semantics for a state that changes on every click.
  (Agents 2 and 5.)

**Behaviour and rendering**

- **accessibility D-2's reconnect cap** — `socket.ts` retries forever. Capping it
  changes live-app recovery behaviour (a gateway restart or a laptop waking from
  sleep currently heals on its own). (Agent 1.)
- **The static build fetches the 24 MB clip even on a gated route**, because the
  replay effect runs before the hash check. Gating it would tear down and rebuild
  the live app's connection on every tab visit. (Agent 1.)
- **frontend-design item 7's row rhythm** (`padding: 4px` plus an inset hairline
  between tower rows) and **the superscript throttle to ~2 Hz**. Both trade
  against the container-query budget and the Freeze control. (Agent 4.)
- **ui-ux m8 — dropping the lane chip in the healthy case.** Half done; removing
  it entirely leaves the routes without a toggle with no lane readout. (Agent 5.)
- **ui-ux M13's segmented unification** and **M14's control placement**. (Agent 5.)
- **ui-ux m14's wall-clock timestamp inside Race Control message text.** (Agent 5.)

**Design system and copy**

- **design-system §2.7/2.8** — `.tele-row`/`.tele-label` extraction, a `--radius`
  token for the thirteen `4px` sites, and the remaining unnamed widths. (Agent 3.
  Note: `CarTelemetry`'s `minWidth: 200` from that list is gone — it was the cause
  of B2.)
- **design-system §2.10** — which of `--fs-3xs`/`--fs-2xs` names which job, now
  that both are aliases. (Agent 3.)
- **design-system §2.11** — `index.html`'s `theme-color` duplicating `--asphalt`.
  Unavoidable; HTML cannot read a CSS variable. (Agent 3.)
- **accessibility L-2 — no visible page title on sub-routes.** The heading chain is
  correct and `h1` is visually hidden; making it visible is a layout and copy
  decision on every route. (Agent 2.)
- **frontend-design item 6 — give Comms a resting state with substance.** The
  history rows now carry times and a playing state (ui-ux m1), but the
  comms-is-off state is still one line explaining a setting. (Agents 4 and 5.)

**Not a UI report item, but the loudest thing left:** none of the four reports
covers the ingest side of the Gap estimate. This pass makes the *display* honest —
one decimal, damped, and consistent with the running order — but the underlying
estimator still resolves to about half a second. A real fix lives in
`ingest/resample.py`, not in `web/`.
