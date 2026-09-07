# Visual direction critique — F1 Race Tracker

Reviewed 2026-08-21 against the running app at `http://localhost:8080` (board, `#compare`,
`#ghost`, `#settings`) and the public demo at `https://natcat38.github.io/f1-race-tracker/`.
Read-only pass — no code changed. Lens: the `frontend-design` skill, judged as a portfolio
piece opened cold by an engineering manager or a design-literate recruiter.

---

## Overall verdict

**The direction is real, and it is not templated.** Someone made specific, defensible choices
here. The palette carries documented WCAG contrast math in its comments. Colour roles are
constrained rather than decorative. The typefaces are a considered pair, not the default stack.
Motion is deliberately near-zero. The sector-delta rebasing is genuine domain literacy. Crucially,
it lands in none of the three AI-default looks — no cream-and-serif with a terracotta accent, no
acid-green-on-near-black, no broadsheet hairline grid. A reviewer will not mistake this for
generated output.

**What it doesn't yet do is _perform_.** It reads as a very well-engineered dashboard rather than
a broadcast graphic. The gap is almost entirely **scale and hierarchy**:

- The entire main board lives in an 11–14px type band. There is no display type anywhere on it.
  `--fs-hero` (28px) is used in exactly one place — the Telemetry panel, which is empty on cold
  open. `--fs-xl` (18px) appears once, in Ghost.
- Every panel is the same 1px `--edge` box with the same 4px radius, the same plate weight, and
  the same 24px gap. Six equal boxes means no primary.
- The track map and the timing tower — the two hero surfaces — share **no identity key**. The map
  colours every car by constructor; the tower does not.
- The two views a curious visitor is most likely to click (`#ghost`, `#compare`) open with the
  majority of the frame empty.

A pit wall is loud on purpose: the leader's gap and the session clock are the biggest objects on
the screen and everything else recedes. Here everything is the same size, so nothing is important.

**The good news: nothing needs redesigning.** Every refinement below is a change to values,
weights, and one shared colour key. The identity stays exactly as it is — it just gets louder.

As a portfolio piece it currently reads as *"strong engineer with better-than-average design
sense."* The top five refinements move it to *"engineer who can art-direct."* That difference is
visible in a five-second cold open, which is all it gets.

---

## What already works

Be clear that this is a genuinely above-average foundation. Specifically:

**Colour discipline is the standout.** `web/src/styles/tokens.css` doesn't just list hexes — it
states the measured contrast ratio for each and the rule for where it may be used. `--onair`
(#E10600) is marked **fills only** because it measures 3.6:1 as text on carbon; `--bad` carries red
text instead. `--amber` is annotated *"ATTENTION ONLY"*. `--dim` is documented as *"deliberately-off
states"* at 3.4:1 — an intentional sub-4.5:1 value with a stated reason. This is contrast reasoning
as fact rather than vibes, and it is rare.

**`--rain: #5AB0F0` is chosen "deliberately NOT Red Bull's #3671C6."** Avoiding a semantic collision
between a weather readout and a constructor colour is an expert-level call that most people never
think to make.

**Colour is never the sole carrier.** `sectorMark()` in `timingHelpers.ts` pairs every purple/green
sector with an `S`/`P` glyph, explicitly so a colour-blind reader loses nothing. Accessibility
treated as design, not bolted on.

**The typeface pairing is a choice, not a default.** Chakra Petch (squarish, motorsport-adjacent,
restricted to labels, plates and nav) against Martian Mono Variable for all data. Both self-hosted
and confirmed loading. `font-variant-numeric: tabular-nums` is set on `body`, so every numeric
column aligns globally rather than per-component — the right place to put it.

**Motion is correctly almost absent.** Everything sits inside
`@media (prefers-reduced-motion: no-preference)`, and it amounts to one orchestrated moment (a
240ms 60/120/180ms panel-mount stagger) plus a 200ms chip transition. Nothing else animates. For a
surface updating at 10 Hz that is exactly right — ambient motion would fight the data, and the
restraint reads as confidence.

**One source of truth for tyre colour.** `TYRE_COLOUR` matches the real Pirelli set and feeds the
strategy chart, the legend, and the tower's Tyre column identically.

**The row-selection interaction is the most domain-literate thing in the app.** Selecting a car
re-bases every other row's sector deltas against that car (`TimingTower.tsx:48–53`) — the
rival-relative question a race engineer actually asks, not a generic table sort. This is the detail
that will make a knowledgeable reviewer sit up.

**Platform details most people miss.** `color-scheme: dark` set explicitly, plus a fully restyled
`input[type="range"]` with a comment explaining that Windows renders light chrome regardless.

**The road-drawing technique is right.** `TrackPath.tsx` strokes a wide casing under a narrower
surface so the circuit reads as a road rather than a line — proper cartographic practice. (The
values are wrong for a dark theme; see #3. The instinct is correct.)

**Race Control messages** in all-caps mono read authentically like FIA bulletins.

**The a11y floor is met quietly.** Skip link as first focusable element on every route, a
visually-hidden `<h1>` per route feeding an unbroken heading chain, `role="button"` +
`aria-pressed` on tower rows with Enter/Space handling, `aria-live="polite"` on the status badge,
and a visible 2px focus ring. None of it announces itself.

---

## Refinements, ranked

### 1. Give the timing tower the team-colour key it already owns

**Files:** `web/src/components/TimingTower.tsx:109`, `web/src/components/teamColours.ts`,
`web/src/styles/components.css` (`.tt-table td`)

The map paints every car marker with its constructor colour. The tower renders the driver code as
`<td><b>{c.code}</b></td>` — bold white, nothing more. The result is that the board's two hero
surfaces share no visual system, and a reader cannot tie a dot on the map to a row in the tower.
This is the single highest-leverage change in the document: it costs about six lines and it makes
the board read as one instrument instead of two adjacent widgets.

Set a per-row custom property from `teamColour[c.team]` and paint a flush rule on the position cell:

```css
.tt-table td:first-child {
  border-left: 3px solid var(--team, transparent);
  padding-left: 9px;   /* was 8px — keeps the numeral optically aligned */
}
```

Do **not** colour the driver code text itself — several constructor colours (Haas `#B6BABD`,
AlphaTauri `#2B4562`) fail on carbon, and the existing contrast discipline shouldn't be broken to
gain this. A 3px rule carries the key without a text-contrast liability.

### 2. Build a real type scale — the board's largest type is 14px

**Files:** `web/src/styles/tokens.css:41–48`, `components.css` (`.rail-clock`, `.rail-session`,
`.rail-lap`, `.tt-table`)

Broadcast graphics are *defined* by extreme scale contrast: a 40px gap number over a 9px label.
This board has none. `--fs-hero` and `--fs-xl` exist in the token file but never appear on the
primary view.

Concrete moves:

- **`.rail-clock` → `--fs-hero` (28px), weight 600, `letter-spacing: -0.01em`.** The session clock
  is the one number that should dominate the chrome. It is currently 14px, one pixel larger than
  body text.
- **Demote the rail's supporting values to labels.** `.rail-session` and `.rail-lap` → `--fs-2xs`
  (10px), uppercase, `letter-spacing: 0.14em`, `color: var(--slate)`, stacked *above* their values
  rather than inline beside them.
- **Add `--fs-2xl: 22px`** and use it for the leader row's Gap cell and for the Ghost delta readout.
- **`.tt-table td:first-child` (position) → `--fs-lg` (14px), weight 700.** Position is the primary
  key of the table and currently renders identically to a millisecond fragment.

**Exploit the variable weight axis you are already shipping.** The loaded face reports as
`Martian Mono Variable 100 800` — a full 100–800 range — and the design only ever uses 400 and 600.
Two-thirds of the typographic range is paid for and unused. Use **300** for de-emphasised columns
(Last and Best when not notable), **400** as base, **700** for position and the leader row. Weight
is the cheapest hierarchy available here and it costs zero additional bytes.

### 3. Fix the track surface — the casing/surface trick is inverted for a dark theme

**Files:** `web/src/components/TrackPath.tsx`, `web/src/styles/tokens.css:28–29`

The casing is `--track-edge: #333333` at 10px, and the surface drawn on top is
`--track-fill: #1A1A1A` at 6px. But `#1A1A1A` is essentially the panel colour (`--carbon: #14171C`),
so the "road" has no body — you see two grey hairlines with nothing between them. On screen the
circuit reads as a thin wire, not a road. The technique is correct; the values are backwards.

```css
--track-fill:  #2B313A;  /* one step above --edge — the road now has a surface */
--track-edge:  #0B0D10;  /* --asphalt, so the casing reads as a dark seam/gutter */
```

and widen the strokes to `12` (casing) / `8` (surface) in `TrackPath.tsx`. The circuit then reads
as a ribbon of road with a shadow gutter — which is what the file's own comment says it intends.

### 4. Kill the dead space in the map panels — `#ghost` most of all

**Files:** `components.css:261–266` (`.track-svg`), `Map.tsx:13`, `Ghost.tsx:143`,
`geometry.ts:1`, `.compare-lanes` (`components.css:340`)

`.track-svg { width: min(600px, 100%) }` inside a full-bleed panel means the Ghost track is a
600px square anchored **left** in a ~1560px panel. Roughly 60% of that panel is empty black — and
inside the square, Monza's tall-narrow outline fills under half the available width again. The
`#ghost` route is currently the weakest cold open in the app: a visitor's first frame is a very
large empty rectangle with one dot in it.

- Minimum viable fix: `margin-inline: auto` on `.track-svg`.
- The real fix: compute a fitted `viewBox` from the actual path bounds with ~4% padding, instead of
  the fixed `0 0 600 600`. `SIZE` is a single constant in `geometry.ts`, so the normalisation is
  already centralised — this is a contained change.
- On the Ghost route specifically, let the map take `width: 100%; max-height: 70vh`.

The same fitted-bounds change fixes Compare, where the two maps are rendered tiny and vertically
stretched inside wide panels. Separately, `.compare-lanes` is `display: flex` with no `flex` on the
lanes, so at 1600px they occupy ~1170px and leave a ~400px dead right margin — add
`flex: 1 1 0; min-width: 0` to the lanes.

### 5. Restore meaning to green

**File:** `web/src/components/timingHelpers.ts:139–148`

The semantics are correct F1 (purple = session best, green = personal best, neutral otherwise), but
the *observed* state defeats them. In a short replay window most drivers' current sector is their
first recorded sample in that sector, so it trivially ties their personal best — and roughly 90% of
the tower renders green. An accent applied to nine cells in ten is not an accent; it is the table's
default colour, and it drowns the purple that should be the rarest, loudest signal on the board.

Best fix, because it makes the colour *honest* rather than just quieter: **only award personal-best
green once the driver has ≥2 prior samples in that sector.** The first observation renders neutral
`--chalk`. Purple then becomes genuinely rare and the tower gets a resting state.

If a second sample isn't cheaply available, the fallback is to split the token: personal-best green
drops to `#2E8C5B` while `--good` (`#3BB273`) stays reserved for improvement deltas. That restores
the tier separation but leaves the underlying "everything is a PB" oddity visible.

### 6. Two of six panels are empty at first paint

**Files:** `web/src/components/TelemetryPanel.tsx`, `web/src/components/Comms.tsx`, board
selection state in `App.tsx`

Telemetry shows *"Select a car to see telemetry"* and Comms shows *"Radio clips play automatically
when comms is on."* — confirmed on the public demo as well as locally. A design-literate reviewer's
first frame is one-third placeholder text, and both strings explain a *setting* rather than
inviting an *action*.

- **Auto-select the race leader on first data.** Telemetry then renders immediately, and it happens
  to be the one place `--fs-hero` is already wired up — so this single change also puts display
  type on the board for free. It reinforces refinement #2 at no cost.
- **Give Comms a resting state with substance** — the last three radio messages as static rows, or
  a flat waveform baseline. An empty screen should be an invitation to act, never an explanation of
  a toggle.

### 7. Tower row rhythm at 10 Hz

**File:** `web/src/styles/components.css:296–317`, `TimingTower.tsx:134–147`

`.tt-table td { padding: 2px var(--sp-2) }` produces ~23px rows with no separation between them.
Twenty rows of numbers mutating ten times a second, with no horizontal structure, shimmer.

```css
.tt-table td { padding: 4px var(--sp-2); }
.tt-row + .tt-row td { box-shadow: inset 0 1px 0 rgba(35, 42, 51, 0.6); }
```

A hairline via inset shadow rather than a real border, so it does not compete with the panel edge
or disturb `border-collapse`.

Also raise the superscript deltas from `--fs-3xs` (9px) to 10px with `color: var(--dim)`. **9px
Martian Mono is below the legibility floor for data that changes at 10 Hz** — it is a wide, low
x-height mono, and at that size the churn is texture rather than information. Consider throttling
those superscripts to ~2 Hz while the main cell stays at 10 Hz; the eye cannot read them faster
than that anyway, and the tower would visibly calm down.

### 8. The rail is declared the signature element but doesn't behave like one

**Files:** `web/src/components/StatusRail.tsx:14`, `components.css:42–138`

The component comment calls the rail *"the persistent instrument strip on every route — the
signature element."* That is the right instinct. But visually it is a single flat flex row in which
brand, session, clock, lap, temperatures, status chip and nav all sit at 12–14px. It reads as a
breadcrumb bar, not an instrument strip. The brief's advice applies directly: **spend your boldness
in one place** — this is the declared place, so spend it here.

- Group into three instrument clusters divided by 1px `--edge` vertical hairlines (`border-left` on
  cluster wrappers, `padding-inline: var(--sp-4)`): **[identity] | [clock · lap · weather] |
  [status]**.
- Stack each value over a 10px uppercase `--slate` label (pairs with refinement #2).
- Raise rail height to ~64px to give the clusters room.

**Bug worth fixing alongside:** at 1280px the rail wraps and the tabs drop to a *left-aligned*
second row, because `.rail-spacer` collapses on wrap. The nav loses its right-hand anchor and the
chrome visibly changes shape. Add `margin-left: auto` to `.rail-tabs` so they stay right-aligned on
either line.

### 9. Compare uses a different grammar for the same information

**Files:** `web/src/components/Compare.tsx`, `web/src/components/Standings.tsx`

The board renders standings as a table with column headers. Compare renders the same data as an
ordered list — `1. VER M19 1:26.273` with the gap on a second line beneath. Two visual grammars for
one data type, which is the clearest coherence break across the four views. On top of that:

- The two lanes are visually identical; only small plate text distinguishes 2023 from 2024.
- Rows do not align across lanes, so the reader cannot scan horizontally.
- **There is no delta between the lanes.** It is two lists side by side; the user does the
  comparing. The view's own premise isn't rendered.

Fix: reuse the tower's table markup at a reduced column set (#, driver, tyre, last, gap), lock both
lanes to an identical row height so horizontal scanning works, and add a narrow centre column
carrying the per-position delta. Give each lane a year-keyed accent hairline on its panel plate
(2023 `--slate`, 2024 `--chalk`) so the lanes are separable at a glance without adding a new hue.

### 10. Ghost buries its headline number

**File:** `web/src/components/Ghost.tsx:189`

The delta (`−0.56s`) is the entire point of the view, and it sits at `--fs-xl` (18px) inside the
controls bar, on the same line as a `<select>` and a scrubber — treated as a control accessory.

Promote it to its own readout directly above the delta bar: 44–56px, weight 700, existing sign
colouring retained, with a 10px uppercase `--slate` label — *"Delta to 2023"*. This is the natural
home for the display-scale moment the app currently lacks.

Also give the delta bar a **zero rule and an S1/S2/S3 axis**. On cold open the trace fills only the
left ~40% of its panel and reads as a broken chart rather than a lap in progress; a zero line and
sector ticks make the partial state legible as partial.

### 11. Settings is a README in a box

**File:** `web/src/components/Settings.tsx`, `components.css:209` (`.panel-body`)

Prose set in 13px Martian Mono running the full ~1560px panel width — roughly 200 characters per
line. Monospace at that measure is genuinely hard to read, and it is the app's worst typographic
moment. The *content* is excellent: honest, specific, tells the user exactly what will and won't
work and why. The setting undersells it.

```css
.panel-body .prose { max-width: 68ch; }
```

and set the prose face to `--display` at `--fs-lg`/1.6, keeping `--data` for inline commands, paths
and timestamps only. This actually *strengthens* the identity rather than diluting it: mono becomes
"machine value," display becomes "human copy," and the distinction is legible at a glance.

### 12. Copy

Small, cheap, and disproportionately visible on a cold read.

- **`#compare` header — "Fixed historical replay — Monza 2023 vs 2024."** Leads with an
  implementation constraint. → *"Monza 2023 vs 2024 · same corners, one year apart."*
- **`#ghost` header — "2024 solid vs 2023 ghost · fastest lap (approx)."** "Solid"/"ghost" is
  rendering vocabulary, not the reader's; "(approx)" hedges in a header, where hedges read as
  low confidence. → *"Fastest lap, 2024 against 2023."* Put the precision caveat in the panel
  footnote, where the tower already handles this well.
- **Local dev build only:** a `▶ REPLAY` status *chip* sits immediately beside a `▶ Replay` *button*
  and a `Live (demo)` button — two near-identical controls, one a state readout and one an actual
  control. Verified absent from the public build, so this is dev-only and low priority; still worth
  renaming to *"Replay data" / "Live data"* or moving out of the rail.
- **"Show seconds" / "Show laps" toggle** (`TimingTower.tsx:62`) labels the mode you'd switch *to* —
  the ambiguous form, and the one that violates the "an action keeps the same name through the flow"
  rule. Use a two-segment control with both states visible and the current one marked.

---

## Priority summary

| # | Refinement | Effort | Visible in a 5s cold open |
|---|---|---|---|
| 1 | Team colour into the tower | Low | Yes |
| 2 | Real type scale / use the weight axis | Low–Med | Yes |
| 3 | Fix track casing/surface values | Low | Yes |
| 4 | Fit map viewBox, kill dead space | Med | Yes |
| 5 | Restore meaning to green | Low–Med | Yes |
| 6 | No empty panels at first paint | Low | Yes |
| 7 | Tower row rhythm | Low | Partly |
| 8 | Rail as true instrument strip | Med | Yes |
| 9 | Compare grammar + real delta | Med–High | On click |
| 10 | Ghost headline delta | Low | On click |
| 11 | Settings prose measure | Low | On click |
| 12 | Copy | Low | Yes |

Items 1, 3, 5, 6 and 12 are together well under a day and land most of the perceived quality gain.
None of them touches the identity — they make the existing direction louder and more deliberate.
