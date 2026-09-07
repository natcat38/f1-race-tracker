# Design Critique — #/board, #/ghost, #/settings

Method: live-rendered via `npm --prefix web run dev` (Vite dev server, port 5173) through the
Browser preview tool, screenshotted at desktop width and at 375px, plus `getComputedStyle`
checks with `pointer: coarse` emulated (mobile-width emulation turns this on automatically).
No gateway/Redis backend was running, so the board and ghost routes were inspected in their
"warming up / waiting for data" empty states — layout, chrome, and CSS rules are unaffected
by that, but live telemetry rendering (car markers, populated timing tower rows) was not
visually checked. Where a finding depends on populated data, that is called out.

All file paths are relative to the repo root. Line numbers are as of the current working tree.

---

## #/board

### First impression
The rail reads as an instrument cluster, not a nav bar — clock, lap counter, lane toggle and
transport controls all present before any data arrives. The three-tier empty state (warming
up / trackless / offline) in `App.tsx` (`SkeletonMap`, lines 49-69) means the reader is never
looking at a blank box with no explanation. This is good and above the bar for a portfolio
piece.

### Usability
- **Critical.** `web/src/styles/components.css:170-176` — the reconnecting/offline/stale chip
  in the rail's reserved state slot is `max-width: 22ch` with `text-overflow: ellipsis`. Live
  screenshot at desktop width shows `StatusBadge.tsx:51`'s `↺ Reconnecting…` rendered as
  `↺ Reconn…` — the one piece of text telling the user why the board is empty is cut off
  mid-word. `⚠ Connection lost — not retrying any more` (`StatusBadge.tsx:38`) and
  `⚠ Waiting for timing data — last frame Ns ago` (`StatusBadge.tsx:58-69`) are longer and will
  truncate worse. Fix: either widen the reserved slot for these specific non-terminal chips
  (the terminal `chip-action` case is already exempted at `components.css:170` via
  `:not(:has(.chip-action))`), or drop the `ellipsis`/`max-width` for `chip-reconnect` and
  `chip-warm` specifically and let `.rail-state`'s `flex-wrap: wrap` (line 152) take the
  overflow onto a second line instead of hiding it.

- **Moderate.** `App.tsx:412-436` — the Track panel's reconnecting/offline overlay chip
  (`chip-reconnect`) is absolutely positioned over the live map (`top: 12, left: 50%`,
  lines 416-418) with no scrim behind it. Over a bright track outline the amber-on-dark chip
  is legible, but there's no dedicated contrast pass documented for this specific overlay
  case (every other contrast note in `tokens.css` is against `--carbon`/`--asphalt`, not
  against arbitrary SVG track fill). Verify this specific case once live telemetry is
  available; if it's ever borderline, add `background: rgb(var(--chalk-rgb) / 0.06)` (the
  existing `--hover-wash` token) as a scrim behind the chip.

### Visual hierarchy
- Session clock (`--fs-hero`, 28px, `components.css:315-324`) correctly dominates the rail.
  Lap counter and session label sit one and two tiers below it. Good.
- **Minor.** `components.css:1287-1292` (`.telemetry-role`) and `components.css:1030`
  (`.empty`) are both `var(--fs-sm)` / `var(--slate)` — two different jobs (a card's own
  identity label vs. a generic "nothing here yet" caption) sharing one visual weight. Not
  wrong, but a reader scanning Telemetry can't tell "PRIMARY" from a footnote at a glance.
  Low priority: give `.telemetry-role` `font-weight: 600` to separate it from `.empty`.

### Consistency
- Board panel grid (`.board-top`, `.board-bottom`, `components.css:872-886`) uses `--sp-6`
  gaps consistently with the page shell (`.page`, `components.css:47-54`). Good.
- **Minor.** `App.tsx:416-418` uses inline `style={{ position: 'relative', ... }}` for the
  reconnect overlay instead of a class, while the project's own house rule
  (`components.css:1-16` header comment) says layout for a component that owns one
  arrangement can stay inline — this is defensible, not a violation, but the absolute
  positioning values (`top: 12`) are a raw pixel literal outside the `--sp-*` scale the rest
  of the file enforces. Fix: `top: 'var(--sp-3)'` for consistency, or accept as a documented
  one-off.

### Accessibness (contrast, touch targets)
- Text/background pairs in `tokens.css` are annotated with measured ratios and mostly clear
  the 4.5:1 floor — this is unusually well-documented for a solo project and I did not find
  a token that contradicts its own comment.
- Touch targets: `components.css:1173-1218` raises `.btn`, `.btn-icon`, `.overlay-select`,
  `.tt-clear` to 44px under `(pointer: coarse)`. Verified live (`getComputedStyle` at 375px
  width, which auto-enables coarse-pointer emulation): `.btn` → 44px, `.overlay-select` →
  44px. Confirmed correct.

---

## #/ghost

### First impression
Two labelled source pickers, a headline delta number, and a track map above the fold — the
route commits to being data-dense rather than decorative, matching the board's idiom. The
in-page copy explaining cross-season approximation (`Ghost.tsx:312-321`) answers the question
a reader would otherwise have to guess at ("why does the ghost car look slightly off-track?").

### Usability
- **Minor.** `Ghost.tsx:110` — each `SourcePicker`'s hint span (`laneA.state.label || '…'`)
  renders a bare `…` character before any data loads. Live screenshot at 375px shows a
  floating, unlabelled ellipsis sitting to the right of the driver `<select>`, with no visual
  relationship to anything (see mobile screenshot: `Waiting for driver data… ⌄ …`). It reads
  as a rendering glitch rather than a "loading" indicator. Fix: only render the hint span once
  `laneA.state.label` is non-empty (`{laneA.state.label && <span className="empty">{laneA.state.label}</span>}`),
  or replace the bare `'…'` fallback with something explicit like `'connecting…'`.

- **Moderate.** `Ghost.tsx:359-372` — the lap-position scrubber is `disabled={!ready}` with no
  visual "disabled" affordance beyond the browser default `opacity` on `<input type=range>
  disabled>` (handled generically by `.range-dark:disabled { opacity: 0.5 }` at
  `components.css:1079-1083`). That's fine, but the Play button right next to it
  (`Ghost.tsx:354-358`) is also disabled with no distinguishing treatment beyond `.btn:disabled`
  (`opacity: 0.6`, `cursor: wait`). `cursor: wait` on a button that isn't loading anything (it's
  just "nothing to play yet") is a mismatched affordance — a wait cursor promises something is
  in progress. Fix: either add a `cursor: not-allowed` variant scoped to genuinely-inert
  buttons, or drop the generic `.btn:disabled` cursor rule and let each disabled state set its
  own cursor via a modifier class.

### Visual hierarchy
- The delta readout (`Ghost.tsx:342-352`) correctly takes `--fs-2xl` and color-codes
  ahead/behind via `--good`/`--bad` — this is the one number the whole route exists to show,
  and it's sized and colored like it. Good.
- **Minor.** `Ghost.tsx:388-391` — the "solid vs ghost" key sits below the Controls panel but
  above the actual track SVG it explains (`Ghost.tsx:392` onward), inside the same `Panel`.
  That's the right order for reading, but the key and the SVG share no visual grouping (no
  shared background/border beyond the outer `.panel`) — on a page this dense, a first-time
  reader has to actively connect "solid" text with the "colourA, no dash" circle rendered 40px
  below it. Not severe since the key is directly adjacent, but worth a `margin-bottom` tighter
  than the current `var(--sp-2)` (`components.css:1556-1564`, `.delta-key`) to visually bind
  it to the SVG rather than floating with equal spacing above and below.

### Consistency
- `Ghost.tsx:373` reuses `.rail-clock` for the scrubber's elapsed-time readout, then
  `components.css:1000-1004` demotes its size specifically for this context
  (`.ghost-controls .rail-clock { font-size: var(--fs-lg); ... }`). This is a considered,
  documented override (see the comment at `components.css:997-999`) — good cross-file
  discipline, not drift.
- **Minor.** Button styling: the overlay's preset buttons (`Ghost.tsx:292-309`, "Same driver,
  two years" / "Two drivers, one race") use plain `.btn`, same as the board's Freeze/Resume
  and Settings' copy buttons — consistent class reuse. No drift found here.

### Accessibility
- `Ghost.tsx:367-370` — `aria-valuetext={fmtElapsed(tMs)}` on the range input is a genuinely
  good touch (screen readers get "0:14.320" instead of a raw millisecond integer). Verified
  present in the rendered DOM.
- Track SVG markers: `Ghost.tsx:399-407` — side B (ghost) is drawn with `fillOpacity={0.45}`
  plus a dashed ring; the code comment at `Ghost.tsx:394-398` documents that flat opacity alone
  measured 1.59:1 and the dashed ring compensates. This is exactly the right instinct
  (don't rely on opacity/color alone for a meaningful graphic) — no further action needed.

---

## #/settings

### First impression
The page states, in the first sentence, exactly what a reader needs before doing anything
else ("You need a paid F1 TV Access subscription for this to show live data") — that's a good
call given the beta caveat this feature carries. The four-step onboarding reads like a runbook,
not marketing copy, which is correct for this audience (a developer/operator, not an end user).

### Usability
- **Critical.** `web/src/components/Settings.tsx:27-39` (`Cmd`) renders each copyable shell
  command with a `CopyButton` given `className="btn cmd-copy"`
  (`Settings.tsx:34`). `components.css:1586-1591` defines `.cmd-copy { min-height: 24px; ... }`
  *after* the `@media (pointer: coarse)` block (`components.css:1173-1218`) that raises `.btn`
  to 44px on touch. Because both selectors are single-class (equal specificity), the later
  rule in the file wins regardless of media query — verified live: with 375px width (which
  auto-enables `pointer: coarse` — confirmed `window.matchMedia('(pointer: coarse)').matches
  === true`), `getComputedStyle()` on every `.cmd-copy` button in the DOM returned
  `min-height: 24px`, not 44px. This is the one page in the app that is pure "copy this
  command and run it on your machine" workflow, on a page that will very plausibly be read on
  a phone while someone is at a terminal — and its primary interactive control fails the
  WCAG 2.5.8 target-size floor the rest of the app already enforces. Fix: add `.cmd-copy` to
  the selector list inside the `(pointer: coarse)` block at `components.css:1174-1179`
  (`.btn, .btn-icon, .overlay-select, .tt-clear, .cmd-copy { min-height: 44px; }`), or move the
  `.cmd-copy` rule above that media block so the cascade order no longer works against it.

- **Minor.** `Settings.tsx:141-160` — the three inline `<Url>` links
  (`https://account.formula1.com`, `https://f1login.fastf1.dev`) render their full raw URL as
  link text, including the `https://` scheme. On the 375px screenshot this wraps across two
  lines mid-domain. Since the destination is also stated in prose right next to it ("Have a
  free F1 account —"), the link text itself could be shortened to the bare domain
  (`account.formula1.com`) without losing information, saving roughly half the wrapped width
  on mobile.

### Visual hierarchy
- The `UNAVAILABLE`/`LINKED`/`NOT LINKED` chip (`Settings.tsx:217-226`) sits top-right of the
  panel, which is the correct "status at a glance" position, and it's the first colored thing
  on an otherwise monochrome page — good use of the one saturated element on the page to carry
  the one piece of state that matters most.
- **Minor.** The `<details>`/`<summary>` collapse for "already linked" (`Settings.tsx:268-278`)
  is a real usability win (per the code's own comment, it replaced always-expanded steps for a
  linked operator) — but the collapsed `<summary>` text ("Signing in (already linked)") uses
  the browser's default disclosure triangle with no additional visual weight, so on the dense
  `.prose` column it can be missed as just another line of text rather than an interactive
  affordance. Low priority: bump it to `font-weight: 600` or reuse `.rail-tab`'s treatment to
  make it read as clickable at a glance.

### Consistency
- `.prose` (`components.css:1128-1130`) and `.demo-notice` (`components.css:1132-1138`) both
  cap at `68ch` for exactly the reason stated in the code comment — one reading measure across
  the app instead of two. Verified consistent; no drift.
- **Minor.** Settings is the only one of the three routes with no `Panel` `label` doubling as
  an `<h2>` for its main content block beyond "F1TV Link — beta" (`Settings.tsx:211`) — the
  `<About>` panel below it (`Settings.tsx:116-132`) is a second, separate `Panel` with its own
  plate, which is consistent with how Board and Ghost each use multiple `Panel`s. No issue
  found; noted only because it was checked.

### Accessibility
- `Settings.tsx:217-226` and `:242-244` both wrap their dynamic status text in
  `role="status" aria-live="polite"` — consistent with the pattern used in `StatusBadge.tsx`
  and `App.tsx`'s loop-notice chip. Good cross-component consistency on live-region usage.
- Copy-button touch target — see Critical finding above (Usability section); this is also,
  independently, an Accessibility (WCAG 2.5.8) finding, not just a UX one.

---

## Cross-page consistency

**Spacing scale:** All three pages consume the `--sp-0`…`--sp-6` scale from `tokens.css:106-111`
with no raw pixel literals found in the reviewed component files, except the one inline
`top: 12` in `App.tsx:417` (noted above, Board/Consistency) and the historical `2px`/`1px`
literals the codebase's own comment (`tokens.css:113-119`) says are deliberately exempt (chart
geometry). No new drift introduced.

**Color tokens:** All three pages read colors through CSS custom properties — no raw hex
literals found in `Ghost.tsx`, `Settings.tsx`, `StatusRail.tsx`, or `App.tsx`. This is enforced
by the project's own stated rule (`components.css:1-16`) and it holds up under inspection.

**Button/control styling:** `.btn` is the single shared control class across Board (Freeze,
SourceToggle), Ghost (Play/Pause, presets, Copy link), and Settings (copy commands) — good,
this is a real shared design-system primitive, not three near-identical hand-rolled buttons.
The one place this system is *undermined* rather than extended is `.cmd-copy`
(Settings-only), which starts from `.btn` and then knocks its touch-target override back down
— see the Critical finding above. That is drift the codebase's own touch-target system
promises not to have, in the one file it doesn't hold.

**Typography:** `--display` (Chakra Petch) is used for chrome/labels and `--data` (Martian
Mono) for data-bearing text consistently across all three routes — Board's rail labels, Ghost's
`.overlay-side-label`, and Settings' `<code>` blocks all follow the same split. No drift found.

**Touch targets:** Board and Ghost both correctly inherit the `(pointer: coarse)` 44px floor
for every interactive control checked live. Settings' `.cmd-copy` is the sole confirmed
regression against that system.

---

## What works well

1. The `(pointer: coarse)` touch-target system (`components.css:1169-1218`) is a real,
   centrally-defined floor that two of the three routes (Board, Ghost) actually hit when
   tested live — most projects at this stage don't have a documented, verified 44px policy at
   all, let alone one that's correct in two of three places.
2. Every color token in `tokens.css` carries its own measured contrast ratio in a comment,
   and spot-checking a handful against WCAG math held up. That is unusually rigorous
   self-documentation for a portfolio project and worth calling out explicitly to a reviewer.
3. Empty/loading/error states are treated as first-class UI on all three routes (Board's
   `SkeletonMap`, Ghost's `overlaySkeletonCopy`, Settings' `NextStep`) rather than left as
   blank panels — this is the single biggest thing that makes the app feel finished rather
   than half-built when there's no backend to talk to, which is exactly the scenario a
   recruiter clicking around a GitHub Pages demo will hit most often.

## Priority recommendations (ranked)

1. **Fix `.cmd-copy`'s touch target** (`web/src/styles/components.css:1586-1591` +
   `:1174-1179`) — Settings' copy buttons measure 24px on touch devices against the app's own
   44px policy, verified live. One-line fix: add `.cmd-copy` to the coarse-pointer selector
   list. This is the most concrete, fastest, highest-confidence fix in this report.
2. **Stop truncating the rail's exception chips** (`web/src/styles/components.css:170-176`) —
   `Reconnecting…`, `Connection lost — not retrying any more`, and `Waiting for timing data`
   all get cut to a few characters in the one UI slot whose entire job is telling the user why
   the board looks empty. Verified live on `#board`. Widen the slot or let it wrap instead of
   ellipsizing for these specific non-terminal states.
3. **Remove the bare `…` placeholder in Ghost's source-picker hint** (`Ghost.tsx:110`) —
   small, but it's the first thing a reader sees on `#ghost` before data loads, and it reads as
   a bug rather than a loading state. Gate the render on `laneA.state.label` being non-empty.
