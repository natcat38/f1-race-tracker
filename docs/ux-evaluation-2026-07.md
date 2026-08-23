<!-- Hands-on UX evaluation of all three routes (July 2026), with observed findings and root causes. -->

# UX Evaluation — pit-wall lens (July 2026)

> **Method:** hands-on, driven via `docker compose up --build -d` against `http://localhost:8080`, all three routes (main board, `#compare`, `#ghost`), plus source reads to confirm root cause. Screenshots weren't available in this environment (the headless renderer timed out on screenshot capture); findings below are verified via DOM/text extraction, JS state inspection, and network/console instrumentation instead — every finding marked "observed" was driven live, not inferred from code alone.
>
> **Superseded in part (August 2026):** `#compare` no longer exists — it was folded
> into `#ghost`, which now picks each side as a *(session, driver)* pair and so covers
> both the cross-season and the two-driver comparison. See
> [ADR-0009](adr/0009-overlay-absorbs-compare.md). The `#compare` findings below (P2
> "no pit-wall data", and the naming/cross-linking item) are recorded as history, not
> as open work.
>
> **Yardstick:** does this help me understand how the car is performing, and would a first-time user get there with zero instructions? Severity: **P1** blocks/misleads, **P2** pit-wall value missing or confusing (workaround exists), **P3** polish.

## TL;DR

1. **P2** — `#compare` shows position/code/team only, no lap-time or pace data, despite being named "Compare" and being the view most users will click looking for lap-time comparison.
2. **P2** — Nothing distinguishes "Compare years →" from "Ghost overlay →" by label alone; a user wanting to compare pace has a 50/50 shot of landing on the wrong one, and neither route links to the other (both only link back to the main board).
3. **P1** — The lane stalls silently: stopping the replay writer freezes the board (timing tower, telemetry) with **zero indicator** — the badge keeps reading "▶ REPLAY" as if nothing's wrong, and there's no way to tell "the race paused" from "the app broke." Documented as required behavior in the product scope but not built.
4. **P3** — "Comms" and "Race Control" headings render unconditionally even with zero content: Comms leaves a bare heading + toggle with no explanation, Race Control leaves a bare heading with nothing at all (it has no toggle).
5. **P3** — Timing tower rows are mouse-only: `<tr onClick>` with no `role`, `tabIndex`, or keyboard handler — the core interaction (select a car for telemetry) isn't reachable by keyboard.

## Radio verdict

**Requirement already met.** Radio/Comms is absent from both `#compare` and `#ghost` — verified by driving both routes live and confirming no Comms UI, no toggle, no history, nothing in the DOM tree. This matches the Phase 3 design intent — radio was scoped to the main board only, with the compare view explicitly out of scope — while ADR-0003 covers a different decision (streamed-vs-committed audio delivery) and doesn't address view placement. No change needed here; the doc reframe (see below) put the reasoning in `CONTEXT.md`'s **Comms** entry ("Shown only on the main board — the comparison views stay radio-free analytics surfaces"), which is now the durable home for it.

**Usefulness on the main board: works, with rough edges.** Hands-on:
- Selecting a car in the timing tower correctly attributes telemetry ("PIA McLaren") — clear.
- Turning Comms on surfaces a history of fired clips (driver code + play button); clicking a history entry actually fires a real cross-origin request to `livetiming.formula1.com/.../TeamRadio/....mp3` (confirmed via `performance.getEntriesByType('resource')`, `initiatorType: "audio"`) with no console errors — the streamed-not-committed design (ADR-0003) works as intended.
- The now-playing banner shows driver code + a replay (↻) button while a clip plays, and clears when it ends — good, legible feedback.
- Gap: the "Comms" heading and ON/OFF toggle always render, even before any clip has fired — a user on a radio-sparse stretch of the clip sees a bare heading with a toggle and no cue that anything will ever appear there (`web/src/components/Comms.tsx`, heading at `web/src/App.tsx:85`).
- Could not verify: actual audible playback (no audio output in this environment) — verified the request fires and `audio.play()` doesn't throw, which is the strongest signal available here.

## Findings

### P2 — `#compare` carries no pit-wall data
**What happens:** `#compare` (`web/src/components/Compare.tsx` → `Standings.tsx`) renders two side-by-side track maps, each with a driver list showing only position order, code, and team. Verified live: no gap, interval, lap time, tyre, or sector data anywhere on the page, and no radio (correctly absent).
**Why it matters:** For a pit-wall user, this view answers "who's ahead" and nothing else — the exact same information the main board's map already gives "for free." Since the route is literally named "Compare," a user expecting to compare *pace* between the two years gets a positional view instead.
**Where:** `web/src/components/Standings.tsx`, `web/src/components/Compare.tsx`.
**Suggested direction:** Either bring a slimmed timing readout (gap/interval at minimum) into `Standings.tsx`, or rename/relabel the entry point so "Compare" doesn't imply lap-time comparison — that job already belongs to `#ghost`.

### P2 — Compare vs Ghost naming and cross-navigation
**What happens:** Main board shows two adjacent links, "Compare years →" and "Ghost overlay →" (`web/src/App.tsx`), with no differentiation beyond the label. Once on either `#compare` or `#ghost`, the only link is "← live board" — verified live on both routes, no link from one comparison view to the other.
**Why it matters:** "Ghost overlay" doesn't read as "the lap-time comparison" to a first-time user; "Compare years" reads more like what they want but delivers less. A user has to bounce back through the main board to find the other view once they've picked wrong.
**Where:** `web/src/App.tsx` (link labels), `web/src/components/Compare.tsx` / `Ghost.tsx` (no cross-link).
**Suggested direction:** Relabel to make the pace-comparison one unambiguous (e.g. "Ghost overlay — compare lap pace"), and add a direct link between the two comparison routes.

### P1 — Lane stall has no indicator (confirmed live)
**What happens:** Stopped the `replay` container while the board was open. The timing tower, telemetry panel, and car positions all froze (confirmed via two successive reads returning byte-identical data) while the status badge continued to read "▶ REPLAY" with no staleness cue. Restarting the writer and the gateway recovered the lane with a fresh snapshot.
**Why it matters:** A stalled lane looks identical to a healthy, momentarily-quiet one, and there's no workaround short of noticing the clock has stopped. The product scope explicitly specifies a "Waiting for timing data…" state for this case; a pit-wall user has no way to tell "the race paused" from "the app broke."
**Where:** `web/src/components/StatusBadge.tsx` (only handles `reconnecting` / cold-start / `live` / `replay`).
**Suggested direction:** Track time-since-last-frame client-side and surface the documented staleness state once it exceeds a threshold.

### P3 — Bare "Comms" / "Race Control" headings with no content
**What happens:** Observed live: on the Monza 2024 replay window watched (~5+ min), Race Control never showed a message, and Comms showed no now-playing/history until a clip was manually triggered. Both headings render unconditionally (`web/src/App.tsx:85,89`); `RaceControl.tsx` returns `null` for its body when `state.messages` is empty, leaving just the heading; `Comms.tsx`'s toggle button always renders regardless of `state.radio`.
**Why it matters:** A heading with nothing under it (or just an ON/OFF button and no explanation) reads as broken rather than "nothing to show right now."
**Where:** `web/src/App.tsx:85-89`, `web/src/components/RaceControl.tsx`, `web/src/components/Comms.tsx`.
**Suggested direction:** A short empty-state line ("No radio yet" / "No incidents") when the respective array is empty.

### P3 — Timing tower rows aren't keyboard accessible
**What happens:** Confirmed via source (`web/src/components/TimingTower.tsx:70-72`) and the accessibility tree (rows expose as `generic`, not `button`): row selection is `<tr onClick={...}>` with no `role`, `tabIndex`, or key handler.
**Why it matters:** Selecting a car for telemetry — a core pit-wall interaction — is mouse-only.
**Where:** `web/src/components/TimingTower.tsx:70-72`.
**Suggested direction:** Add `role="button"`, `tabIndex={0}`, and an Enter/Space key handler to each row.

### P3 — Ghost overlay: no scrub/pause, and the "no data yet" state is a silent blank box
**What happens:** `#ghost` runs as a continuous, non-interactive `requestAnimationFrame` loop (`web/src/components/Ghost.tsx:36-45`) — no pause or scrub control. Correction to an earlier static-analysis hypothesis: the driver `<select>` is pre-filtered to `commonDrivers(...)` only (`Ghost.tsx:18,89`), so a user can never *select* a driver with no counterpart — the "blank grey box" (`Ghost.tsx:101-102`) is reachable only before both lanes' data has loaded, or in the (currently unhit) case of zero driver overlap. Confirmed live: with data loaded, the SVG renders correctly (real track path, 150-point delta bar, playback cursor — verified structurally via the DOM, not visually; the red/green fill logic itself was only checked in source, see "Could not verify").
**Why it matters:** As the closest existing feature to "where is the car losing time," it's the one most worth polishing: no way to pause on an interesting corner or scrub back to compare a specific point undermines it as an analysis tool, not just a viewer.
**Where:** `web/src/components/Ghost.tsx`.
**Suggested direction:** Add a pause/scrub control tied to the existing `tMs` clock; add a short "loading reference laps…" label for the pre-`ready` state instead of a bare box.

### P3 — Reconnect surfaces raw console errors
**What happens:** Restarting the gateway container logged `connectRace: socket error [object Event]` to the console (uncaught object, not a message). The reconnect itself worked (badge and data recovered) — this is a diagnostics-quality issue, not a functional one.
**Where:** `web/src/realtime/socket.ts` (or wherever `connectRace`'s error handler logs).
**Suggested direction:** Log a short string instead of the raw `Event` object.

### P2 — Nonsensical interval value observed during cold start
**What happens:** Immediately after a fresh replay restart (lap 1, most cars with no completed lap yet), one row showed `Int: +81.014` — an implausible 81-second interval — while every other cell in that state correctly showed `—`.
**Why it matters:** Fabricated-looking data is shown with the same visual confidence as real data — a user can't tell this reading apart from a genuine interval, unlike the neighboring `—` cells that correctly signal "no data yet."
**Where:** The gap/interval computation is entirely in Python, in the "gap / interval pass (best-effort)" block of `ingest/record.py` (~lines 565-592) — it's baked into the clip at record time, not computed by the Go replay writer or gateway.
**Suggested direction:** Suppress interval/gap display until both the car and the one ahead have a valid reference lap, consistent with how other cells already show `—` in that state.

## Gap analysis vs the race-engineer vision

The existing pipeline (gap, interval, tyre, sectors, telemetry, ghost overlay's per-point delta) already covers the raw ingredients of "where is the car underperforming." What's missing to make that *legible* to a fan playing race engineer:

- **Sector-best colouring already exists** (`web/src/components/timingHelpers.ts:84-96`'s `sectorColour()`, wired up in `TimingTower.tsx:37` — purple for session-best, green for personal-best) — correction to an earlier draft of this report, which proposed building it. Not visually verified live (this evaluation's method was DOM/text-based, see "Could not verify"), but confirmed present in source. What's still missing: it's a binary tied/not-tied signal, not a magnitude — a driver 0.3s off their best sector looks identical to one 1.5s off. A small delta chip (vs. own best) would close that gap, still UI-only over existing per-frame `CarState` fields.
- **Stint/tyre pace trend** — a small per-driver sparkline of lap time across a stint would show degradation, the single clearest "is this car underperforming" signal a race engineer watches. This likely needs a short rolling history kept client-side from frames already received (no new wire field), or a modest new baked field if longer history is wanted — the latter would need to be weighed against ADR-0002's frame-size gate.
- **Give `#compare` a link to `#ghost` for the same driver pair**, rather than trying to fold computed data into `#compare` itself — CONTEXT.md's glossary draws a deliberate, binary line between compare ("uncomputed side-by-side") and ghost overlay ("computation is what sets it apart"), so a computed strip doesn't belong inside compare. Closing the P2 "compare has no pit-wall data" gap above should mean either a real (uncomputed) timing readout in `Standings.tsx`, or a clear handoff to `#ghost` for anyone who wants the computed comparison.
- **Ghost overlay pause/scrub** (noted above) turns it from a demo loop into an actual analysis tool — the highest-leverage single change for the "race engineer" framing, since it's already the one feature that computes a real performance delta.

None of these require reopening an ADR: the sector/stint ideas stay within ADR-0002's per-frame-field gate (no new wire shape), and the ghost-overlay one stays within ADR-0004's frontend-only-computation rule (no new gateway correlation).

## Update — 2026-07-23 (Phase 5, "pit-wall completion")

Re-checked against this session's changes. Most findings above were already
resolved before this pass (the timing-tower keyboard accessibility, Comms/Race
Control empty-state copy, and the Gap/Int disclaimer footnote all predate this
work) or remain open (compare/ghost naming and cross-linking, lane-stall
staleness detection, ghost-overlay pause/scrub, and the raw console error on
reconnect are all still as described above — out of scope for this pass).

What this pass *did* close, from the "Gap analysis vs the race-engineer
vision" section:
- **"Stint/tyre pace trend"** — resolved. A full-race stint timeline panel
  (compound + stint length per driver, baked once per session) now shows
  degradation/strategy at a glance, and a per-lap gap-trend sparkline sits
  alongside the existing lap-time sparkline in the telemetry panel.

Beyond that specific gap-analysis item, this pass also addressed a
structural problem the July evaluation didn't surface (out of its scope,
which was UI/UX rather than the underlying data): all three committed replay
clips were laps-1–5 slices with zero pit stops in any of them, making the
stint/strategy story impossible to show regardless of UI work. Clips are now
windowed around real pit-stop phases (see the [README](../README.md)), which
is what makes the stint timeline and the new pit-lane visibility
(`IN PIT`/`OUT` in the tower, dimming on the map) meaningful rather than
theoretical.

## Could not verify

- **Screenshots / visual rendering** — the Browser pane's screenshot action timed out consistently in this environment; all findings above come from DOM text extraction, the accessibility tree, JS state inspection (`performance` entries, `document.querySelectorAll`), network/console logs, and source reads, not visual inspection. Anything purely visual (colour contrast, layout crowding, animation smoothness) is not assessed here.
- **Audible radio playback** — confirmed the correct cross-origin request fires and `audio.play()` doesn't reject, but could not confirm actual audio output in this environment.
- **Live lane (Silverstone) behaviour** — the live/replay toggle was exercised on the replay lane's own restart, but the live (Python-fed) lane's steady-state behaviour over a longer window wasn't separately soaked.
