# UI/UX Heuristics Audit — F1 Race Tracker Frontend

Scope: `web/src/` (App shell, components, hooks, state, routing, styles). Evaluated
against Nielsen's 10 heuristics, Fitts's law, Hick's law, Jakob's law, Miller's law,
the Doherty threshold, and progressive disclosure, with attention to mid-race
glanceability, connection loss, stale/empty states, first run, overlay discoverability,
and small viewports.

**Context.** This codebase carries an unusually dense inline record of prior UX
review passes (tagged `ui-ux M8/M13/M14`, `frontend-design item 6`, `agent 5`,
`#22`, accessibility passes) that have already fixed a long list of textbook
issues: ambiguous toggle labels, colour-only signalling, live-region spam,
roving-tabindex tables, row order jumping under the pointer, empty panels that
describe a setting instead of showing data, reduced-motion handling, and more.
Findings below are what is left, not a first pass.

---

## High impact

### H1 — Overlay/compare feature is undiscoverable from first load (Jakob's law / discoverability)
`web/src/components/StatusRail.tsx:18-21` labels the second tab "OVERLAY / lap
delta" — accurate but not the mental model most visitors arrive with ("compare
two years", "ghost car"). ADR-0009 folded the old COMPARE tab into OVERLAY, but
nothing on the **board** route hints that the overlay exists or what it shows;
a first-time visitor who never scans the top-right tabs has no prompt to try
it. There is no onboarding tooltip, coach-mark, or first-visit affordance
anywhere in `App.tsx` or `StatusRail.tsx`. For a feature the product scope
calls out as a headline (Phase 4, "ghost overlay") and a portfolio
differentiator, its only entry point is a plain nav tab competing with BOARD,
F1TV Link, and GitHub — four peers, no hierarchy (Hick's law: nothing biases
the choice toward the thing worth trying).
**Impact:** a recruiter/reviewer skimming the live board for 10 seconds may
never see the feature the product doc treats as the star.

### H2 — Live-lane semantics require reading fine print (Match between system and the real world / Recognition over recall)
`web/src/components/StatusBadge.tsx:79-88` and `SourceToggle.tsx:9-14`: the
"Live" lane is actually a second recorded clip, not live data. This is now
disclosed honestly (Phase 5 fix, "Live (demo)" language), which is good —
but the label users click is still `● Live` (`SourceToggle.tsx:11`) with the
honest caveat living in `visually-hidden` text and a `title` attribute. A
first-time user who clicks "Live" expecting the real broadcast gets no
same-screen correction until the badge's parenthetical/tooltip is read. This
is a match-to-real-world tension baked into the product's constraints (ADR
around F1TV auth), but the control label itself (`● Live`) is the one place
that still overpromises before the caveat is visible.
**Impact:** sets an incorrect expectation at the exact moment of the highest-
attention interaction (choosing the data source).

### H3 — No visible way to discover deep-link / URL-driven features (Help & documentation, Discoverability)
`web/src/routing.ts` supports rich deep-linking (`?car=VER`, `?a=slug:CODE`,
`?b=slug:CODE` for the overlay) and `App.tsx:210-230` / `Ghost.tsx:152-163`
keep the URL in sync via `replaceState`. This is a well-built capability with
zero UI surface: there's no "copy link to this view" or "share this
comparison" button anywhere in `TimingTower.tsx`, `Ghost.tsx`, or
`StatusRail.tsx`. A shareable/bookmarkable state that can only be discovered
by manually editing the URL bar violates recognition-over-recall for the
overlay's most natural social use case (sharing a specific driver comparison).
**Impact:** medium-high — the feature exists and works, but nobody will find it.

---

## Medium impact

### M1 — Settings/F1TV link page is a wall of prose with no visual hierarchy for its one critical warning (Minimalist design / progressive disclosure)
`web/src/components/Settings.tsx:196-271`: the `.prose` block runs a
subscription-tier warning, a live status readout, a 4-step signup flow, three
copy-able shell commands, a privacy note, and a beta-status disclaimer as one
undifferentiated column. The single most important fact — "you need a paid F1
TV subscription for this to do anything" — is bolded inline (`Settings.tsx:198`)
but sits at the same visual weight as everything else below it once scrolled
past. No collapsing/progressive disclosure of the "already linked" vs
"not yet linked" paths (both render, differentiated only by which `NextStep`
branch fires) means a returning, already-linked operator still scrolls past
the full onboarding instructions.

### M2 — Hick's law: SourceToggle and Freeze board controls are visually adjacent but semantically different classes of control
`App.tsx:267-277`: the rail's Zone D packs `SourceToggle` (a persistent-state
radiogroup: Replay | Live) directly beside a `Freeze/Resume` momentary-verb
button. `SegmentedControl.tsx`'s own header comment explicitly calls out this
exact distinction as something the codebase has previously gotten wrong and
fixed ("a segmented control is a pick between states that persist... a plain
.btn is a momentary verb"). The fix correctly gives them different visual
treatments, but they still occupy one continuous row with no grouping
divider — at a glance during a fast-moving race, the two controls read as one
five-option choice (Replay / Live / Freeze) rather than two independent
binary decisions, which is exactly the kind of grouping ambiguity Hick's law
penalizes under time pressure.

### M3 — Reconnect flow surfaces only in the rail's status chip, not near the frozen map (Visibility of system status / user control)
`App.tsx:295-314` and `StatusBadge.tsx:35-45`: when the socket goes fully
`offline`, the map itself shows a `⚠ Connection lost` overlay chip
(`App.tsx:298-303`) but the actual **Reconnect button** lives only in the
`StatusBadge` inside the rail (`StatusBadge.tsx:39-44`), which can be a
different visual region of the screen (top of page) from where the user's
attention is (the frozen map, mid-page) — especially once the layout wraps on
narrower viewports. Fitts's law favors putting the recovery action where the
failure is noticed; right now there are two separate visual signals for one
failure state (map overlay text, rail button) with no link between them.

### M4 — Mid-race glanceability: gap/interval "estimated, not official" caveat repeats as text on every render (minimalist design tension, but deliberate)
`TimingTower.tsx:28` (`GAP_TITLE`) plus the persistent `tt-note` footer
(`TimingTower.tsx:348-352`) both explain the same estimation caveat via a
`title` tooltip AND a permanently-visible footnote. This is a reasonable
trust/accuracy tradeoff, but for the primary glanceable view (Gap/Int columns
read many times a second during a race) it adds a permanent block of
secondary text under the tower that competes for space with the reference-car
hint (`TimingTower.tsx:359-370`) and the tyre legend (`TimingTower.tsx:372-380`)
— three stacked footnote rows below the primary data on every load, which for
a screen whose value proposition is glanceability is a lot of always-on
chrome relative to the standings.

### M5 — StintChart color legend abbreviates compound names inconsistently with TimingTower's legend (Consistency and standards)
`TimingTower.tsx:373-374` legend renders `'S Soft'`, `'M Medium'`, etc.
(letter + word), while `StintChart.tsx:105-107` renders the compound's first
letter capitalized plus the rest lowercased as a full word only (`Soft`,
`Medium`, no leading single-letter glyph pairing). Two panels on the same
board, both keying color to tyre compound, present the legend in two
different formats — a small but real consistency break for a feature (tyre
strategy) users are expected to correlate across panels.

### M6 — No empty/loading state differentiation for "genuinely no incidents yet" vs "race-control feed hasn't connected" (Visibility of system status)
`RaceControl.tsx:43`: `if (state.messages.length === 0) return <div
className="empty">No incidents.</div>;` — this renders identically whether
the session has produced zero flags/safety cars (a true, good-news empty
state) or whether the snapshot simply hasn't arrived yet (`state.rev === 0`,
same as the board's "warming up" case elsewhere). Every other panel on the
board (Map, tower, telemetry) distinguishes "no data yet" from "confirmed
nothing here," but RaceControl collapses both into one string.

---

## Low impact

### L1 — GitHub link and Settings gear are both styled as "rail-repo" exits with the same visual weight as primary nav (Match to real world / Fitts's law)
`StatusRail.tsx:126-149`: the F1TV Settings link and the external GitHub link
share a class (`rail-repo`) and sit directly adjacent to the `rail-tabs` nav.
Visually there are effectively four equally-weighted top-level destinations
(Board, Overlay, Settings, GitHub) even though GitHub is "a way out of the
app" per the code's own comment (`StatusRail.tsx:135-137`) — the comment
acknowledges the intent but the visual treatment doesn't fully separate exit
affordances from in-app navigation.

### L2 — TelemetryPanel's "Compare with" rival picker has no persistence across selection changes (Consistency, minor)
`TelemetryPanel.tsx:174-184`: switching the primary reference car
(`selected`) in the timing tower does not carry the previously chosen rival
forward or explain that it was cleared — `App.tsx:159` derives
`effectiveRival` as `null` whenever `rival === selected`, silently dropping a
chosen comparison the moment the primary changes to match it, with no
transient confirmation of why the "Compare with" dropdown reset.

### L3 — Loop-restart notice duration is fixed and non-dismissable (User control and freedom, minor)
`App.tsx:29,82-86`: the `↻ CLIP LOOPED` chip is shown for a hardcoded 8
seconds (`LOOP_NOTICE_MS`) with no way to dismiss it early; for a user who
already understands the demo loops (a returning visitor), this is a small,
repeated, un-skippable interruption in the state-chip zone every clip cycle.

### L4 — Copy-command affordance on Settings has no visible focus/keyboard-only success signal beyond text swap (Accessibility/consistency, minor)
`Settings.tsx:20-38`: `Cmd`'s copy button swaps its own label to "✓ copied"
for 2 seconds but doesn't announce via a live region, unlike almost every
other transient-state change in this codebase (Comms errors, F1TV chip
changes, RaceControl messages all use `aria-live`). This is inconsistent with
the app's otherwise very deliberate live-region discipline seen elsewhere
(e.g. `Comms.tsx:116-118`, `Settings.tsx:180-189`).

---

## Notable strengths (brief)

- **Doherty threshold / perceived performance:** `useSmoothedCars` interpolates
  10 Hz frames to animation-frame rate so the map never looks laggy; snapshot-
  on-connect (`App.tsx` + gateway docs) means new/reconnecting viewers see
  state instantly rather than a blank board.
- **Error prevention / recovery:** four distinct, worded skeleton/failure
  states (`App.tsx:35-46`) instead of one generic spinner; decision matrix in
  the product scope is faithfully implemented in code (`SkeletonMap`,
  `StatusBadge`).
- **Recognition over recall:** SegmentedControl's scope label pattern
  (`SegmentedControl.tsx`) fixed a documented earlier failure (ambiguous
  toggle labels) and is now consistently reused for Lane, Radio, and Gap
  units — genuine cross-component consistency.
- **Accessibility as a first-class heuristic driver:** roving tabindex,
  colour-blind-safe hatching on sparklines (`TelemetryPanel.tsx:56-66`),
  live-region discipline tuned to avoid over-announcing a 10 Hz feed
  (`RaceControl.tsx`, `StatusBadge.tsx`), and reduced-motion handling in the
  overlay (`Ghost.tsx:169-172`) are all handled with more care than is typical.
- **Honesty over polish:** the "Live (demo)" caveat, the estimated-gap
  disclosure, and the cross-season "approximate positions" note in the overlay
  (`Ghost.tsx:314-320`) all choose to tell the user the truth about data
  quality rather than hide it — a real trust-building pattern, even though H2
  above notes the initial control label still slightly overpromises.

---

## Summary counts

- High impact: 3
- Medium impact: 6
- Low impact: 4
