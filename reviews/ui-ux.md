# UI/UX Review — Interaction, Flows, IA, Mobile, Microcopy

**Scope:** running app at `http://localhost:8080` (Docker) + public static demo at
`https://natcat38.github.io/f1-race-tracker/`. Reviewed at 1440×900 desktop and 390×844 mobile.
**Method:** driven with Playwright — every finding below was reproduced in the live app, not read
off the source. Source references point at `web/src/` for whoever fixes it.
**Evidence:** screenshots in `reviews/ui-ux-shots/` (referenced as `[f1-NN]`).

**Deliberately out of scope** (covered by sibling reviews, not re-derived here): design tokens and
CSS architecture, visual direction and colour semantics, and accessibility. Where a flow problem
happens to touch one of those, it is framed by its *flow* consequence and the overlap is noted.

**Framing:** this is judged as a portfolio piece a recruiter or EM opens cold, on the assumption
that the pit-wall/broadcast identity is correct and stays. Nothing below asks for a redesign.

---

## Finding counts

| Severity | Count |
|---|---|
| Blocker | 2 |
| Major | 15 |
| Minor | 20 |
| Nit | 5 |
| **Total** | **42** |

---

## First impressions — the cold 60 seconds

**Seconds 0–5.** The board loads fast and looks the part. A dark carbon frame, a monospace
instrument rail, a live track map with twenty moving dots, a full timing tower with sector
splits and tyre ages. The identity lands immediately and it does not read as a template. This is
the app's biggest asset and it is genuinely earned.

**Seconds 5–20.** The eye goes to the tower and starts reading. Two things go wrong here. First,
the S3 column is cut off at the right edge behind a horizontal scrollbar — at 1440px, a
*large* desktop [f1-01]. Second, the Gap column is visibly wrong: P3 shows `+7.364` while P4 shows
`+3.965`, and P4's Int is `—`. A cold reader who knows F1 — which is exactly the reader this
project is courting — spots a non-monotonic gap column in about four seconds. The footnote
("estimates derived from track position") explains imprecision; it does not explain impossibility.
Look one column further and every gap value is a multiple of 0.566s, printed to three decimals.

**Seconds 20–40.** The bottom four panels are below the fold at 900px, so the recruiter has to
scroll to discover that the app does anything other than display. When they do, three of the four
panels are near-empty: Telemetry says "Select a car to see telemetry" into 400px of blank space,
Comms says "Radio clips play automatically when comms is on", Race Control has two entries in a
440px-tall box. The Strategy chart is the only dense one, and it has no lap axis and no legend.

**Seconds 40–60.** Suppose they guess and click a driver row — the app's central interaction. The
row highlights faintly. Telemetry fills in. **Nothing else responds**: the selected car is not
highlighted on the track map, not marked in the Strategy chart, not surfaced in Race Control. And
the tower gets *worse* — the sector cells grow delta superscripts, the table widens from 787px to
824px inside a 727px container, and the S3 column disappears entirely. Then, somewhere in this
window, the replay clip loops: the race clock jumps from 1:18:29 back to 1:13:03, the lap counter
counts backwards from 16 to 13, and the Race Control feed starts showing the same message twice
[compare f1-01 and f1-03]. Nothing on screen says a loop happened.

**Verdict.** The first impression is *strong presentation, shallow-feeling interaction*. A hiring
manager will believe you can build a real-time front end. What they will not yet believe is that
you finished it — because the two features that would prove the hardest engineering (the
reference-car sector deltas and the vs-comparison telemetry) are the two that visibly break, and
the one thing a reader checks for correctness (the gap column) visibly doesn't hold.

And if they open the **public demo** instead of your local Docker stack — which is what a link in a
CV gets you — then two of the four nav tabs are permanent dead ends that spin "Warming up the
timing feed…" forever, and the third is a page of `pip install` commands.

---

## Ranked top 10 fixes

Ordered by *damage to the cold visitor per hour of work*.

| # | Fix | Finding | Effort |
|---|---|---|---|
| 1 | On the static build, hide COMPARE/OVERLAY/LINK (or render an honest "needs the full stack" panel). Three of four tabs currently dead-end on the one public URL. | B1 | S |
| 2 | Give the Telemetry panel room for two cards — span it across two grid columns when a rival is picked, or stack the cards. Today the flagship comparison is clipped mid-word at every viewport. | B2 | S |
| 3 | Announce the replay loop and reset the Race Control buffer on restart. A clock that rewinds with no explanation reads as a bug, not a loop. | M1 | S |
| 4 | Make selection global: highlight the selected (and rival) car on the track map, in the Strategy chart, and in Race Control. One state, six panels. | M2 | M |
| 5 | Show the reference-car hint *before* it's used, not after, and make rows look tappable at rest. | M3 | S |
| 6 | Let the selection be cleared — re-click the selected row to deselect, plus a "clear" affordance. | M4 | S |
| 7 | Fix the Gap column's ordering and round it to its real resolution (0.1s, not 0.001s). Correctness is the one thing a timing board cannot fake. | M10 | M |
| 8 | Make the tower fit: drop or narrow columns before overflowing, and never let selection push a column off-screen. | M5, M8 | M |
| 9 | Make Compare actually compare — a shared lap reference and a synchronised position at minimum; on mobile, don't call it "side by side" when it stacks. | M6, M7 | M/L |
| 10 | Move LINK out of primary nav, and add a "what is this / source" affordance so a recruiter can get from the demo back to the repo. | M12, M15 | S |

---

## A. Interaction design and feedback

### B2 — `blocker` — The vs-comparison renders clipped and unusable at every viewport
**Where:** `web/src/components/TelemetryPanel.tsx` (`CarTelemetry` `minWidth: 200`, flex row,
`gap: 16`) inside `.board-bottom { grid-template-columns: repeat(4, minmax(220px, 1fr)) }`
(`web/src/styles/components.css:329`).
**What's wrong:** picking a rival in the "vs" dropdown adds a second telemetry card that the
panel cannot hold. Measured at 1440×900: panel body `324px`, content `442px`. The second card is
cut mid-word — the screenshots show `VER Red Bul`, a truncated `G6 D`, and Throttle/Brake bars
sliced by the panel border [f1-06]. On mobile the second card is roughly 40% off-screen with no
scroll affordance [f1-13]. `overflow-x` on `.panel-body` is `visible`, so there is not even a
scrollbar to recover the hidden half. This is the app's most technically interesting feature —
two live telemetry traces side by side — and it has never once rendered whole.
**Recommendation:** when `rival != null`, make the Telemetry panel span two grid columns
(`grid-column: span 2`) at ≥1100px and stack the two cards vertically below that. Alternatively
promote the vs-comparison out of the four-up strip entirely — it deserves its own row. Either
way, add `min-width: 0` to the flex children so they can shrink rather than overflow.

### M2 — `major` — Selecting a driver only reaches two of six panels
**Where:** `web/src/App.tsx:95` (`<Map state={state} />`), `Map.tsx`, `StintChart.tsx`,
`RaceControl.tsx` — none of them receive `selected`.
**What's wrong:** the click-a-row interaction is the spine of the whole board, and it changes the
tower row background and the Telemetry panel. It does not highlight the car on the track map,
does not mark the driver's row in the Strategy chart, does not surface that driver's Race Control
messages. The two hero panels — Track and Timing — sit side by side and do not talk to each
other. A user who clicks SAI and then looks at the map has no way to find SAI among twenty
identical dots.
**Recommendation:** thread `selected` and `rival` into `Map`, `StintChart` and `RaceControl`.
On the map: a larger radius and a chalk ring on the selected car, dim the rest to ~55% opacity.
In the Strategy chart: keep the selected driver's row pinned and outlined. In Race Control:
badge or brighten messages whose `driver` matches. This is the single highest-value change in
the review — it converts four decorative panels into one instrument.

### M3 — `major` — The reference-car feature explains itself only to people who already found it
**Where:** `web/src/components/TimingTower.tsx:160`.
**What's wrong:** the instruction is
`{refCar && \` Click a row to set the reference car — sector deltas compare against ${refCar.code}.\`}`
— it is gated on `refCar` being set, i.e. it renders *only after the user has already clicked a
row*. Before the first click there is no hint anywhere that rows are interactive. Rows have
`cursor: pointer` and a 4%-alpha hover tint (`components.css:311`), which is invisible on a dark
ground and does not exist at all on touch. The one hint that does render on first paint is
"Select a car to see telemetry" — and it's below the fold at 900px.
**Recommendation:** split the copy. Always show `Click a driver row to compare sector times.` and
swap it for `Sector deltas compare against SAI · clear` once a row is selected. Give rows a
resting affordance — a left edge tick in team colour, or a chevron in a leading column — so the
tower reads as a list of buttons rather than a printout.

### M4 — `major` — Selection is a one-way door
**Where:** `web/src/components/TimingTower.tsx:99` — `onClick={() => onSelect(c.driverNum)}`.
**What's wrong:** there is no toggle-off and no clear control. Once you click any row, the S1/S2/S3
superscripts permanently switch from "delta vs this driver's own personal best" to "delta vs the
reference car", for the rest of the session. The only way back to personal-best mode is a page
reload — which also loses the lane, the comms toggle and the seconds mode. Users experiment by
undoing; an interaction with no undo teaches them not to experiment.
**Recommendation:** re-clicking the selected row clears it (`onSelect(c.driverNum === selected ? null : c.driverNum)`),
plus an explicit `clear` link in the footnote, plus `Esc` to deselect.

### M5 — `major` — Selecting a driver pushes the S3 column off-screen
**Where:** `TimingTower.tsx:141-148` (delta superscripts), `.tt-scroll` (`components.css:285`).
**What's wrong:** measured at 1440×900 — `.tt-scroll` client width `727px`; table width `787px`
with no selection, `824px` with a selection. Selecting a driver adds ~37px of superscript deltas
and grows the hidden overflow from 60px to 97px, taking the whole S3 column with it. The
interaction that is supposed to *add* sector insight is the one that removes a sector column.
The only cue that S3 exists is a thin horizontal scrollbar inside an already-scrolling page.
**Recommendation:** the delta superscript should not change the column's intrinsic width —
reserve the space with a fixed-width inline-block (`min-width: 4ch`) so the table is the same
width selected or not. Then get the table under 727px: at <1500px drop `Best` (it's derivable
and rarely watched live) or move S1/S2/S3 into a single "Sectors" cell.

### M13 — `major` — Three toggles, three different labelling conventions
**Where:** `TimingTower.tsx:62` ("Show seconds"/"Show laps"), `Comms.tsx:24` ("Comms ON"/"Comms
OFF"), `SourceToggle.tsx` (segmented "▶ Replay" / "● Live (demo)").
**What's wrong:** on one screen the app uses all three of the possible toggle idioms and gives no
way to tell them apart. "Show seconds" is the *action* (it becomes "Show laps" once pressed).
"Comms OFF" is the *current state* (it becomes "Comms ON" once pressed) — so pressing "Show
seconds" and pressing "Comms OFF" do semantically opposite things while looking identical. The
source toggle is a third pattern again. A user cannot know whether "Comms OFF" means "comms is
off" or "click to turn comms off" without clicking and observing.
**Recommendation:** pick one. The segmented control already used by `SourceToggle` is the right
idiom for the pit-wall aesthetic and is unambiguous — apply it to comms (`RADIO ON | OFF`) and
to the gap units (`GAPS: TIME | LAPS`). Whatever you choose, add `aria-pressed` and a persistent
active style rather than relying on the label swap alone.
*(Overlaps the accessibility review on `aria-pressed`; the finding here is the labelling model.)*

### M14 — `major` — "Show seconds" appears to do nothing, then produces an unusable unit
**Where:** `TimingTower.tsx:57-63`, `timingHelpers.ts` `gapLabel`/`intLabel`.
**What's wrong:** the toggle only affects cars whose gap is expressed in laps. On a normal frame
that is one row out of twenty, at the bottom of a scrolling list. Nineteen of twenty rows do not
change, the button's only state signal is its own label, and the label is above the fold of the
tower's internal scroll — so pressing it reads as "nothing happened". When it *does* apply, the
output is `+643.581` and later `+731.961` — raw seconds to three decimals, a number no human
converts to "about eleven minutes".
**Recommendation:** format lapped gaps as `+10:43.6`, not `+643.581`. Move the control into the
`Gap` column header (`Gap ⇅`) so its scope is obvious, and flash the affected cells briefly on
change so the toggle has visible consequence. If it only ever affects lapped traffic, consider
dropping it — it is a control that spends most of its life inert.

### M10 — `major` — The Gap column is visibly non-monotonic and has false precision
**Where:** `TimingTower.tsx:117-118`, `timingHelpers.ts` `gapLabel`/`intLabel`; upstream in the
gap estimator.
**What's wrong:** reproduced across many frames and both lanes. Monza replay: P3 SAI `+7.364`,
P4 NOR `+3.965` with Int `—`. Silverstone lane: P2 HAM `+2.485`, P3 PIA `+0.621` with Int `—`.
A gap column where the fourth-placed car is closer to the leader than the third-placed car is
self-evidently impossible, and the disclaimer ("estimates derived from track position, not
official timing") covers *imprecision*, not *contradiction*. Separately, every observed gap is an
integer multiple of ~0.566s — `0.566, 1.133, 1.699, 2.266, 2.832, 3.399, 3.965, 4.532, 5.098,
5.665, 6.231, 6.798, 7.364, 7.931…` — so the true resolution is roughly half a second while the
UI prints three decimals and jitters ±0.6s between frames. Printing `+3.399` for a quantity you
know to ±0.57s is the most damaging kind of polish: it advertises precision you don't have.
**Recommendation:** two separate fixes. (a) Clamp gaps to be monotonic with running order, or when
a car's estimate can't be reconciled show a status word (`PIT`, `OUT`, `—`) instead of a number
that contradicts its own row. (b) Round displayed gaps to the estimator's real resolution — one
decimal — and damp frame-to-frame jitter with a short rolling median. Keep three decimals for
`Last`/`Best`/sector times, which *are* exact.

### M1 — `major` — The replay loop rewinds the whole board with no indication
**Where:** `web/src/realtime/staticReplay.ts:93-115` (static build) and the Go replay player
(Docker); `RaceControl.tsx:20`.
**What's wrong:** when the clip reaches the end it restarts silently. Observed across screenshots
taken minutes apart: race clock `1:18:29` → `1:13:03`, lap counter `LAP 16/53` → `LAP 13/53`
[f1-01 vs f1-03]. A race clock that runs backwards and a lap counter that counts down are, to
anyone who knows the domain, an unambiguous "this is broken" signal. Two secondary effects
compound it: the Race Control buffer is never cleared across loops, so it accumulates duplicates
and goes out of chronological order — `1:14:24`, `1:19:37`, `1:18:37`, `1:14:24`, newest-first
notwithstanding [f1-07]; and personal-best sector colouring carries a previous pass's bests into
the new one.
**Recommendation:** detect the restart (time going backwards is already the production signal)
and (a) clear `state.messages` and the personal-best cache, (b) show a transient rail chip —
`↻ CLIP LOOPED · 4m recording` — for a few seconds. Ideally the rail should say up front that
this is a fixed-length recording on repeat, e.g. `▶ REPLAY · 4-min clip, looping`.

### M9 — `major` — OVERLAY lands on a page that looks static and non-interactive
**Where:** `web/src/components/Ghost.tsx:137-211`; `.track-svg { width: min(600px, 100%) }`
(`components.css:262`).
**What's wrong:** the first viewport of `#ghost` is one Track panel, 660px tall, containing a
600px-wide outline in a 1375px panel — 56% of it empty — with two small dots that overlap so
closely they read as one [f1-10]. The Delta bar is half-cut at the fold. The Controls panel —
driver picker, play/pause, scrubber, live delta readout — is entirely below the fold. A visitor
who lands here sees a still image and has no reason to scroll. The most computationally
interesting view in the app hides its own interactivity.
**Recommendation:** put Controls directly under the rail, above the track, so the scrubber and
Play button are the first thing seen. Constrain the Track panel's height (or let the SVG grow
past 600px) so track + delta bar + controls fit one 900px viewport. Add a one-line legend on the
map itself: `● 2024 (solid) · ◌ 2023 (ghost)`.

### m1 — `minor` — Comms history rows carry no information scent
**Where:** `Comms.tsx:45-62`.
**What's wrong:** with comms on, the history renders six identical rows — `NOR ▶`, `LEC ▶`,
`SAI ▶`, `PER ▶`, `LEC ▶`, `NOR ▶` [f1-07]. No timestamp, no lap number, no clip duration, no
sort direction stated, no indication of which one is currently playing (the now-playing banner is
a separate element that only exists while audio is actually running). There is no reason to click
any particular ▶ over any other.
**Recommendation:** each row gets the race clock and lap (`1:17:04 · L15  NOR  ▶ 0:06`), a
persistent "playing" state on the active row, and a header saying `newest first`. If a transcript
or category is available upstream, one line of it is worth more than everything else combined.

### m9 — `minor` — Sparklines render at one or two bars with no scale
**Where:** `TelemetryPanel.tsx:26-54`.
**What's wrong:** the guard is `history.length >= 2`, so the Laps sparkline routinely draws two
bars and the Gap sparkline one, next to a value of `—` [f1-04]. Two bars with no axis convey
nothing, and a single green bar beside an em-dash reads as a rendering fault.
**Recommendation:** require ≥4 points before drawing, and until then show
`Trend builds after 4 laps`. Add a faint min/max label so the bars have a scale.

### m11 — `minor` — Rows reorder under the pointer, so you select the wrong driver
**What's wrong:** the running order re-sorts every frame. During this review a click aimed at the
row displaying PIA landed on SAI, because the order changed between aim and click. On a
10Hz-updating table with 24px rows this is unavoidable without mitigation, and it costs the user
their previous selection (see M4 — which they then cannot undo).
**Recommendation:** damp the reorder — animate row position changes over ~200ms (respecting
`prefers-reduced-motion`) rather than teleporting, and suppress reordering for ~400ms after a
pointer enters the tower. A confirmation of *which* driver was selected (a chip in the Telemetry
header) also makes a mis-click recoverable rather than silent.

### m8 — `minor` — The rail badge duplicates the control right beside it
**Where:** `StatusRail.tsx:54-56` + `SourceToggle.tsx`.
**What's wrong:** the status chip `▶ REPLAY` sits immediately left of a button labelled
`▶ Replay` [f1-01]. Same glyph, same word, ~40px apart, one a readout and one a control. In the
live lane it is `● LIVE (DEMO)` next to `● Live (demo)`. A user cannot tell at a glance which one
they are supposed to press.
**Recommendation:** since the segmented toggle already shows the active lane, drop the redundant
chip in the healthy case and reserve the chip slot for exceptional states only (warming,
stale, reconnecting, failed) — which is where it earns its place.

### n2 — `nit` — Twenty timing rows sit in the tab order ahead of every other control
**Where:** `TimingTower.tsx:97` (`tabIndex={0}` on every row).
**What's wrong:** measured 30 focusable elements on the board; 20 of them are timing rows, in one
uninterrupted run. A keyboard user reaching the Comms toggle or the rival picker tabs through the
entire field first — and the rows reorder live underneath, so focus stays on the right driver but
jumps around the screen. This is a flow cost on top of the ARIA concern the accessibility review
raised about `role="button"` rows.
**Recommendation:** roving tabindex — one tab stop for the tower, arrow keys to move between
rows, Enter/Space to select. That also gives the tower a keyboard idiom matching what it already
claims to be.

### n3 — `nit` — Toggle buttons have no pressed state beyond the label swap
`Show seconds` (`TimingTower.tsx:57`) has neither `aria-pressed` nor a distinct active style;
`Comms` uses `.btn-active` but the label already flips, doubling the signal in one place and
leaving none in the other.

---

## B. Information architecture across the four views

### B1 — `blocker` — On the public demo, three of four nav tabs dead-end
**Where:** `StatusRail.tsx:7-12` (TABS is unconditional), `Compare.tsx`, `Ghost.tsx`,
`Settings.tsx:90`, `realtime/socket.ts` (reconnect loop).
**What's wrong:** the GitHub Pages build is the only URL a recruiter will actually open, and it is
a static file player with no gateway. But the nav still offers all four tabs.
- `#compare` → `↺ RECONNECTING… / Warming up the timing feed…` in both lanes, **forever**, with 20+
  console errors and no terminal failure state. Verified live.
- `#ghost` → `Connection lost — retrying automatically…` with all controls disabled, forever, 48+
  console errors. Verified live.
- `#settings` → "Not available in the static demo — run the full system (`docker compose up`)".

Two of these are worse than an error page, because the copy is *optimistic and false*: "Warming
up the timing feed" and "Connection lost — retrying" both promise recovery that cannot happen (a
static build has no source to reconnect to, which `staticReplay.ts:54` already knows and says
correctly on the board route). "Connection lost" is also factually wrong — nothing was ever
connected.
**Recommendation:** gate the tabs on `VITE_STATIC_DEMO`. Either hide COMPARE/OVERLAY/LINK on the
static build, or keep them visible-but-disabled with a tooltip and a panel that says plainly:
*"Compare needs the live gateway. This public demo plays a single recorded clip — run
`docker compose up` from the repo for the full system."* Turning three dead ends into three
honest signposts costs one build flag and converts the demo's biggest liability into a
statement about scope.
*(The accessibility review flagged these tabs as broken; the fix proposed here is the flow/copy
one and complements it.)*

### M6 — `major` — COMPARE doesn't compare
**Where:** `web/src/components/Compare.tsx`, `Standings.tsx`.
**What's wrong:** the view renders two independent `Lane` components, each with its own socket,
its own clock and its own playback position, and asks the user to do the comparison in their
head. There is:
- **no shared time or lap reference** — the rail deliberately drops the clock and lap counter on
  this route (`StatusRail.tsx:19-24` comment), so you cannot tell what point of either race you
  are looking at, which makes the positions and gaps it *does* show uninterpretable;
- **no delta of any kind** — this is a documented product decision (`CONTEXT.md`: compare is
  "uncomputed side-by-side", ghost is where computation lives), and it is a defensible
  architectural line, but the *label* doesn't hold it: a tab called COMPARE that computes nothing
  reads as unfinished, not as principled;
- **no driver selection, no year selection, no link into OVERLAY** for the driver you're looking
  at — the view is a leaf with no onward path;
- **two visibly different track outlines for the same circuit** — the 2023 and 2024 Monza maps are
  normalised independently and render at noticeably different proportions side by side [f1-09],
  which sabotages the one comparison the eye *can* make unaided.
**Recommendation:** the cheapest meaningful fix is a shared lap cursor: one control that sets both
lanes to "lap N" and a rail readout saying so. Then normalise both outlines against a shared
bounding box so the maps are geometrically comparable. Then make each standings row a link into
`#ghost` for that driver — which turns COMPARE from a leaf into the natural entry point for
OVERLAY, and gives the two views a relationship. If the uncomputed line is to stay, rename the
tab to something honest about it (`REPLAYS`, `2023 vs 2024`) so the name stops writing a cheque
the view doesn't cash.

### M12 — `major` — LINK is an operator page occupying a primary-navigation slot
**Where:** `StatusRail.tsx:11`, `web/src/components/Settings.tsx`.
**What's wrong:** LINK is the fourth of four top-level tabs, peer to BOARD/COMPARE/OVERLAY. It is
a developer runbook: `pip install -r ingest/requirements.txt`, browser-extension setup,
`--unlink` flags, a reference to `docs/runbooks/live-verification.md §5` and ADR-0007 [f1-15].
For the audience this project is built for, the fourth click lands on shell commands. Two
compounding problems on the same page:
- **Line length.** The prose runs the full 1375px panel width — measured ~180 characters per line
  in a monospace face, roughly double the readable maximum. Every other view is instrument-dense
  and justifies edge-to-edge; this one is a document and needs a measure.
- **The status chip contradicts the body.** The chip reads `LINKED` while the body says "Your
  account has **no active F1 TV subscription**, so expect the live stream to stay empty". At a
  glance the page says success; read, it says the opposite.
**Recommendation:** demote LINK out of primary nav — a small gear/link affordance at the right end
of the rail, or a footer link. Wrap the body in `max-width: 68ch`. Make the chip report the
*useful* state, not just the auth state (`LINKED · NO SUB`). Add copy-to-clipboard buttons on the
three commands — the single most useful control on a setup page, currently absent.

### M15 — `major` — There is no path from the app back to the project
**What's wrong:** nowhere in any of the four views is there a link to the repository, an author,
a one-line description of what was built, or a "how this works". For a portfolio piece this is
the load-bearing omission: the recruiter watches dots move for ninety seconds, and there is no
affordance that says *this streams a real F1 telemetry feed over WebSocket through a Go gateway*.
The entire engineering story is invisible from the artefact that is supposed to advertise it.
**Recommendation:** an `ABOUT` affordance in the rail (or a persistent footer strip) with three
things: one sentence on what the system does, the architecture in one line (ingest → gateway →
WebSocket → React), and a link to the repo. On the static demo it should also say plainly that
this is one recorded clip and what the full stack adds. This is perhaps two hours of work and
it is the difference between "nice animation" and "this person ships systems".

### m2 — `minor` — The four-up bottom strip allocates space by count, not by content
**Where:** `.board-bottom { grid-template-columns: repeat(4, minmax(220px, 1fr)) }`
(`components.css:329`).
**What's wrong:** four equal columns for four panels with wildly unequal content. Strategy needs
twenty rows and gets 324px; Telemetry needs ~440px for its main feature and gets 324px (see B2);
Comms and Race Control routinely render two or three lines into 440px of vertical emptiness
[f1-02]. The grid is symmetric; the information is not.
**Recommendation:** weight the columns — e.g. `minmax(0,1.4fr) minmax(0,1.2fr) minmax(0,0.7fr)
minmax(0,0.7fr)` — and let Telemetry span two when a rival is selected. Cap panel height to
content so the empty panels stop advertising their emptiness.

### m3 — `minor` — The Strategy chart has no axis and no legend
**Where:** `web/src/components/StintChart.tsx`.
**What's wrong:** twenty stint bars on an unlabelled 0..53 axis. No lap numbers anywhere, no
tick marks, no label on the thin chalk line that marks the leader's current lap (it has an
`aria-label` but nothing visible), and no tyre legend inside the panel — the legend lives in the
Timing panel, several hundred pixels away and in a different visual container [f1-02]. The
compound is only recoverable by hovering for a `title` tooltip, which doesn't exist on touch.
**Recommendation:** add an axis strip under the last row (`1 · 10 · 20 · 30 · 40 · 53`), label
the leader marker (`L14 ▾`) above the chart, and repeat the compact tyre legend inside this
panel. One line of copy would also help: *"Full-race strategy. The marker is where the replay
currently sits."*

### m5 — `minor` — "DELTA BAR" is an implementation name, and the chart is unexplained
**Where:** `Ghost.tsx:155-168`.
**What's wrong:** the panel is titled with its own component name. The chart itself has no zero-line
label, no y-axis, no magnitude scale (it auto-scales to `maxAbs`, so a 0.05s spread and a 5s
spread look identical), and no faster/slower annotation. The explanation exists — as a code
comment at `Ghost.tsx:156`, *"red above the midline = this year slower, green below = faster"* —
which is precisely the sentence the user needs and never sees.
**Recommendation:** rename to `Lap time delta`. Promote that comment into the UI as an axis label
pair (`2024 slower ▲` / `2024 faster ▼`) and print the scale (`± 1.8s`) at the axis end. Also
label the live readout — `−1.66s` alone is uninterpretable; `2024 ahead by 1.66s` is not.

### m7 — `minor` — `.track-svg` is hard-capped at 600px in full-width panels
**Where:** `components.css:262`.
**What's wrong:** the cap is correct on the board, where the grid column is exactly 600px. On
`#ghost` both the track and the delta bar sit in a 1375px full-width panel and render at 600px,
leaving 56% of each panel empty [f1-10, f1-11]. The delta bar is the densest chart in the app and
it is drawn at 44% of the space available to it.
**Recommendation:** cap per-context, not globally — keep 600px inside `.board-top`, let the ghost
route's SVGs take their container.

### m4 — `minor` — Race Control repeats the driver code the message already contains
**Where:** `RaceControl.tsx:35-37`.
**What's wrong:** the driver code is appended unconditionally, producing
`WAVED BLUE FLAG FOR CAR 31 (OCO)  (OCO)` [f1-08]. FastF1's message text usually already names
the car.
**Recommendation:** only append when the message doesn't already contain the code or car number.

### m15 — `minor` — Rows with no data render as all-dashes with no explanation
**What's wrong:** in the Silverstone lane, P20 GAS rendered `— — — — — —` across every column
[f1-08]. No status word, no dimming, no reason. The tower already has a `statusLabel` path for
`Pit`/`Out`; a car with no data falls through it.
**Recommendation:** give the no-data case its own label (`NO DATA`, or `NOT STARTED`) using the
same treatment as `IN PIT`/`OUT`, so an absence reads as a known state rather than a rendering
failure.

### m18 — `minor` — "F1TV" appears three times in one screen
Tab sub-label `F1TV beta`, rail note `F1TV link — beta`, panel plate `F1TV LINK — BETA` — all
visible simultaneously on `#settings` [f1-15]. Drop the rail note on this route; the tab and the
panel plate already say it.

---

## C. Mobile usability (390×844)

### M8 — `major` — The timing tower hides 62% of its columns behind a nested scroll
**Where:** `.tt-scroll` (`components.css:285`), `TimingTower.tsx`.
**What's wrong:** measured at 390px — visible width `311px`, table width `811px`. Only `#`,
`Driver`, `Gap` and part of `Int` fit [f1-12]. `Last`, `Best`, `Tyre`, `S1`, `S2`, `S3` — six of
ten columns, including every column the sector-delta feature exists to serve — are behind a
horizontal scroll nested inside a 2893px-tall vertical page. Horizontal-in-vertical scroll is a
known mobile failure mode: the gesture is ambiguous and users routinely scroll the page by
accident. The skill's own responsive guidance calls for "horizontal scroll **or card layout**";
at this ratio (2.6× overflow) the card layout is the correct half of that choice.
**Recommendation:** below ~700px, drop the table for a per-driver card: position + code + tyre on
line one, gap/interval on line two, last/best on line three, sectors revealed on tap. If the table
must stay, cut to four columns (`# · Driver · Gap · Last`) and put the rest in an expand-on-tap
row.

### M7 — `major` — Compare stacks vertically, so "side by side" is literally false
**Where:** `.compare-lanes { display: flex; flex-wrap: wrap }` (`components.css:340`).
**What's wrong:** at 390px the two lanes wrap, so the 2023 lane's twenty standings entries run to
completion before the 2024 lane begins. Page height 3132px. You cannot see both lanes at once at
any scroll position — the one thing the view exists to do [f1-14]. Inside each lane the map keeps
its flex row next to the standings and shrinks to a ~110px thumbnail with all twenty dots
overlapping. Each standings entry wraps to three lines with `+1 LAP` split across a line break.
The nav tab still promises "side by side".
**Recommendation:** on mobile, don't stack — switch to one lane at a time with a `2023 | 2024`
segmented switch, so the comparison becomes a fast A/B toggle rather than a scroll. Stack the map
above the standings within a lane rather than beside it. And change the tab sub-label
responsively, or to something viewport-independent.

### M11 — `major` — The track map is illegible on mobile
**Where:** `Map.tsx:15-20`, fixed `r={7}` and `fontSize: var(--fs-xs)`.
**What's wrong:** twenty cars at a fixed 7px radius with fixed-size three-letter labels, scaled
down into a ~330px square. Mid-pack cars collapse into unreadable clusters — `VER`/`SAI`/`ALO`/
`HUL` overprint each other [f1-12]. The map is the app's signature element and on a phone it
degrades to noise.
**Recommendation:** scale marker radius and label size with the rendered viewport, hide labels
below a threshold and show them only for the selected/rival car (which also gives M2 a reason to
exist on mobile), and de-overlap the labels with a simple leader-line or alternating offset.

### m12 — `minor` — The layout jumps from four columns to one with nothing between
**Where:** `@media (max-width: 1100px)` (`components.css:333-338`).
**What's wrong:** a single breakpoint takes `.board-top` and `.board-bottom` from 2/4 columns
straight to 1. Every tablet and small laptop between 700px and 1100px gets the full mobile
single-column stack — Track, then a 20-row tower, then four full-width panels — which is a very
long scroll for a device with plenty of horizontal room.
**Recommendation:** add a two-column tier for `.board-bottom` (Telemetry+Strategy / Comms+Race
Control) between roughly 700px and 1100px.

### m13 — `minor` — The ghost scrubber is below touch-target size
**Where:** `.ghost-controls input[type="range"]` (`components.css:395`).
**What's wrong:** measured 201×20px on mobile [f1-17]. The thumb is smaller still. This is the
primary control of the OVERLAY view and it is a 20px-tall target for a precision drag.
**Recommendation:** raise the track hit area to ≥44px (a taller transparent padding box around a
thin visual track), enlarge the thumb, and give the control a full-width row of its own on mobile
rather than sharing a wrapped flex line.

### m21 — `minor` — Nav tab sub-labels wrap mid-phrase on mobile
**Where:** `StatusRail.tsx:70`, `.rail-tab-sub`.
**What's wrong:** at 390px the four tabs compress and the sub-labels break inside the phrase —
`COMPARE / side by / side`, `BOARD / live / board`, `OVERLAY / lap / delta` [f1-12]. A compact
label wrapping to a second line is a specific, avoidable failure. It also pushes the rail to
~290px — 34% of the first screen consumed before any content.
**Recommendation:** `white-space: nowrap` on `.rail-tab-sub` and drop the sub-labels entirely
below ~500px (the four primary words are self-explanatory), or switch to a horizontally
scrollable single-row tab strip. Also consider collapsing the rail's session/clock/lap/weather
block into two lines on mobile.

### m22 — `minor` — No way back to navigation without scrolling to the top
**What's wrong:** the nav lives only in the rail at the top of a 2893px page. Switching views on
mobile is: scroll up 2500px, tap. There is no sticky rail and no bottom nav.
**Recommendation:** make the tab strip `position: sticky; top: 0` on small viewports (a compact
32px-tall version, without the session block), which costs nothing and fixes the loop.

---

## D. Microcopy

### m14 — `minor` — Unlabelled numbers
- Ghost's live delta renders as bare `−1.66s` (`Ghost.tsx:189-191`) — no indication of what is
  ahead of what.
- Telemetry's `Gap` row shows `—` beside a green sparkline bar (`TelemetryPanel.tsx:97-103`).
- Race Control shows a race clock (`1:14:24`) immediately beside a wall clock embedded in the
  message text (`15:20:51`) with nothing distinguishing them.

**Recommendation:** `2024 ahead by 1.66s`; suppress the Gap row until there is a gap; label or
strip the redundant wall-clock timestamp.

### m16 — `minor` — Status copy contradicts itself on `#settings`
Chip `LINKED` vs body "no active F1 TV subscription … expect the live stream to stay empty". See
M12.

### m17 — `minor` — Commands and URLs are `<code>`, not links or copyable
**Where:** `Settings.tsx:127-151`.
`https://account.formula1.com` and `https://f1login.fastf1.dev` are rendered as inert code spans.
The three `pip`/`python` commands have no copy affordance. On a page whose entire job is "run
these commands", this is the missing control.

### m19 — `minor` — Compare's standings wrap mid-phrase
**Where:** `Standings.tsx:11` (`<ol>` with inline spans, `line-height: 1.8`).
Entries break as `14. ZHO H14 / 1:27.170 +1 / LAP` — the unit splits from its number [f1-14].
Even at desktop the list wraps inconsistently, entry to entry, producing a ragged column that is
much harder to scan than the board's aligned table [f1-09]. Use a fixed grid
(`display: grid; grid-template-columns: 2.5ch 4ch 5ch 1fr`) and `white-space: nowrap` on the
gap cell.

### m20 — `minor` — The rival picker's visible label is two characters
**Where:** `TelemetryPanel.tsx:132-145`. The control is labelled `vs`, in `--fs-xs`, in
`--slate`, at the bottom of the page, and it only exists after a driver is selected. Nothing
says what it does or that it will add a second telemetry trace.
**Recommendation:** `Compare with` as the visible label, and default the option text to
`— pick a rival —` rather than `— none —` (which describes a state, not an invitation).

### n1 — `nit` — "Live (demo)" is honest in its tooltip but not in its badge
`SourceToggle.tsx:8` carries the correct explanation ("Demo lane streaming a second replay clip —
real live ingestion not yet verified") in a `title` attribute — invisible on touch and to anyone
who doesn't hover. The rail badge just pulses `● LIVE (DEMO)` in red. Put the qualifier on screen:
`● LIVE LANE · recorded clip`.

### n4 — `nit` — "Warming up the timing feed…" persists after the feed is warm
On `#compare`, both lanes show this indefinitely on the static build even while the chip beside it
says `RECONNECTING`. Two different stories in the same panel. Covered under B1.

### n5 — `nit` — The panel entrance stagger replays on every route change
`components.css:364-380`. Charming once; every hash change re-runs it, which makes tab switching
feel slower than it is. Consider running it only on first mount.

---

## E. What is working (keep it)

Worth stating, because these are the parts that make the rest worth fixing:

- **The identity.** The pit-wall aesthetic is coherent, committed, and unlike anything a template
  produces. Panel plates, the instrument rail, the monospace data face, the chip vocabulary — this
  reads as designed, not assembled.
- **Skeleton and failure copy on the board route.** `App.tsx:29-36` distinguishes three genuinely
  different reasons the map might be missing and writes different copy for each, including the
  observation that "warming up" is a lie once frames are arriving. That is the exact quality of
  thinking the rest of the flows need.
- **`ghostSkeletonCopy`** (`state/ghost.ts`) similarly separates "no overlapping drivers" from
  "still loading" — same discipline.
- **Per-panel `ErrorBoundary`** (`Panel.tsx:23-27`) with honest fallback copy, so one bad panel
  can't take the board down.
- **Reduced-motion handling in OVERLAY** (`Ghost.tsx:49-50`): playback doesn't auto-run, but the
  scrubber still works, so the feature stays fully usable rather than being disabled. That is the
  right call and rarer than it should be.
- **Focus visibility.** `:focus-visible` gives a 2px chalk outline on interactive rows — verified
  in-browser.
- **The sparkline hatch overlay** (`TelemetryPanel.tsx:41-49`) — encoding "slower" with both
  colour and texture, so the signal survives a colour-blind reader.
- **Deliberate, documented product lines.** The compare/ghost split, the ADR-0007 explanation of
  why linking is a host command rather than a button that can't work — the reasoning is sound.
  Several findings above are about the *labels* not carrying that reasoning to the user, not
  about the reasoning itself.

---

## Evidence index

All in `reviews/ui-ux-shots/`.

| File | Shows |
|---|---|
| `f1-01-board-desktop.png` | Board, 1440×900, no selection — S3 clipped, LAP 16/53 |
| `f1-02-board-bottom.png` | Bottom strip — empty Telemetry/Comms, unlabelled Strategy axis |
| `f1-03-selected.png` | After row click — LAP 13/53 (clock rewound), hint appears late |
| `f1-04-telemetry.png` | Single-car telemetry, 2-bar sparklines, `Gap —` |
| `f1-05-vs.png` | Rival selected — tower unchanged, map unchanged |
| `f1-06-vs-bottom.png` | **Telemetry vs-card clipped mid-word (B2)** |
| `f1-07-comms-on.png` | Comms history with no timestamps; RC duplicates + out of order |
| `f1-08-live-lane.png` | Silverstone lane — non-monotonic gaps, all-dash row, `(OCO) (OCO)` |
| `f1-09-compare.png` | Compare desktop — mismatched outlines, ragged standings |
| `f1-10-ghost.png` | Overlay first paint — controls below the fold, 56% dead width |
| `f1-11-ghost-controls.png` | Overlay controls + unlabelled delta bar |
| `f1-12-mobile-top.png` | Mobile board — rail height, wrapped tab labels, illegible map |
| `f1-13-mobile-mid.png` | **Mobile telemetry vs-card clipped (B2)** |
| `f1-14-mobile-compare.png` | Mobile compare stacked — "side by side" is false |
| `f1-15-settings.png` | LINK page — 180-char lines, LINKED chip vs "no subscription" |
| `f1-16-cold.png` | Board with no selection — tower fits (contrast with f1-01/f1-03) |
| `f1-17-mobile-ghost.png` | Mobile overlay — best-behaved view; small scrubber target |
| `f1-18-pages-demo.png` | Public demo — "No incidents.", three dead tabs in nav |
