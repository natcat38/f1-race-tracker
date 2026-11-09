# UX audit: f1-race-tracker (web/) (moved into the repo 2026-11-09)

The UX audit of the web UI, its owner decisions and fix log, moved here from a local working
folder so the record lives with the code. Screenshot names in the findings refer to the original
audit folder, which is not kept; key before/after shots are in `ux-audit-2026-10/` beside this file.

Audited 2026-10-23 against origin/main `273698a` and the live demo (https://natcat38.github.io/f1-race-tracker/). Read-only: no edits, no issues, no PRs. Roadmap stage at audit time: Review. This audit is secondary to the job search; it only matters if a recruiter opens the demo.

Already tracked, not re-reported: #115 (live-lane scrub channel), #123 (70 MB clips), #124 (screenshot reshoot, Design_Direction doc), #103 (gap-estimator gate). Ignored `.claude/worktrees/`.

## Verdict

On desktop the board is dense and clear, but the first thing a visitor sees is a timing tower full of "NO DATA" and dashes, because the replay opens on the starting grid and takes about 2 minutes 30 seconds of real time to fill in. On a phone the page runs 5.4 screens when the replay is fresh and 6.5 once the data is in, the replay controls scroll out of reach after the first screen, and the gear and arrow icons are bare glyphs, one of which leads to a dead-end page. The biggest single win is to seek the demo to a moment where the tower is full (about 2:40 into the clip); the second is to keep Pause and the scrubber in the sticky phone strip.

Measurements (Playwright, live site): desktop 1.7 screens (1515 px), phone 5.4 screens at load (4971 px) and 6.5 (5462 px) once rows carry data. No horizontal scroll at 320 px. Focus ring is a visible 2 px outline on every control I tabbed. Slate text on carbon computes to about 6:1, so it passes. The initial render completes in 0.4 s (desktop) to 1.4 s (phone).

One correction to the brief's baseline: on a phone the tower starts at about 850 px, just under one screen, not "far below" the map. The real problem is that the tower is 2540 px tall (3 screens), rows are 127 to 147 px each, and every panel after it starts at 3720 px or lower.

## Findings

| ID | Sev | Rule | What the user experiences | Evidence | Fix | Skill | Effort |
|---|---|---|---|---|---|---|---|
| F1-UX-1 | P0 | S-LAY-1, S-FB-2 | Landing on the board, 19 of 20 rows read "NO DATA" with dashes in Int, Last, Best, Tyre and S1-S3 (gap data first appears at about 2:20 of the clip, full at 2:40; clip is 7:30 and loops back to 0:00 each time). The hero view looks broken for the first 2.5 minutes of every loop. | `shots/f1-desktop.png`, `shots/f1-desktop-full.png`; measured: 90 to 120 s = 19 rows empty, 140 s = 14, 160 s = 0. `web/src/App.tsx:198` (replayTMs starts at 0), `web/src/realtime/staticReplay.ts:98` (`loopRestartIndex` is the first frame), `:183` (scrub seeks by offset) | Seek to about 160 s on first load and make that the loop-restart offset (or bake the clip to start at lap 2). Keep the scrubber range 0 to end so earlier time stays reachable. Blocked by D1. | impeccable `layout.md`, `operate.md` (empty and loading states) | S |
| F1-UX-2 | P1 | S-NAV-1 | On a phone, the sticky strip (48 px) holds only the clock, the replay chip and the BOARD/OVERLAY tabs. Pause, the scrubber and the time readout sit in the non-sticky block and scroll away (measured bottom at -1084 px after scrolling 1300 px). To pause while reading a row, the user scrolls back about 3 screens. On desktop the rail also scrolls off at 1.7 screens, but the cost is small there. | `shots/f1-phone-mid-scrolled.png` (strip shows no transport), `web/src/components/StatusRail.tsx:95` (controls in `.rail-block`), `:181` (`.rail-strip` is the only pinned part), `web/src/App.tsx:346-364` (controls passed in), `web/src/styles/components.css:1744-1760` (sticky strip) | Phone: add an icon-only Pause/Play (44x44, `aria-label` that swaps "Pause replay" / "Play replay") and a 2 px progress line with a tap-to-expand scrubber inside `.rail-strip`; the full scrubber stays in the block. Keep strip height at 48 px plus the safe-area inset. | impeccable `adapt.md`, `layout.md`; antislop-layoutmobile | M |
| F1-UX-3 | P1 | S-NAV-4, S-LAY-2 | Phone timing tower is 20 cards of 127 to 147 px each (about 3 screens). Each card carries 10 fields in 4 lines, and 7 of them (Last, Best, S1-S3, deltas) matter only for the selected car. A user comparing positions scrolls 3 screens to see 20 driver codes. | `shots/f1-phone-mid-scrolled.png` (about 2 cards per screen), `shots/f1-phone-full.png`; `web/src/styles/components.css:1340-1440` (`@container tt (max-width: 560px)` card layout, comment at 1325-1338 records the earlier 162 px version) | Two-line rows (pos, code, gap, int, tyre) of about 56 px, so 20 drivers fit in about 1.3 screens; full sector detail only on the selected row (the tower already has `selected`). Blocked by D2. | impeccable `layout.md`, `adapt.md` | M |
| F1-UX-4 | P1 | S-NAV-4 | Past the tower, Telemetry, Strategy, Comms and Race Control follow in one column (starts at 3720, 4138, 4698, 4877 px). Nothing tells the user they exist, and Race Control ("No incidents.") is the last thing on a 6.5-screen page. There is no in-page nav. | `shots/f1-phone-full.png`, measured panel tops above, `web/src/App.tsx:411-466` | Add a section chip row (Track, Timing, Strategy, Comms, Race control) to the sticky strip or just under it, with `scroll-margin-top: 56px` on each panel (S-NAV-2). Make Comms and Race Control collapsed `<details>` on phone, with the Race Control incident count in the summary. | impeccable `adapt.md`; antislop-layoutmobile | M |
| F1-UX-5 | P1 | S-LAY-1 | The first phone screen spends its top 307 px on chrome: a sticky strip, then a block with brand, session, weather, the Pause row and a separate row holding two 28 px icons, before the map begins. The map is only fully in view after scrolling. | `shots/f1-phone.png`, `shots/f1-phone-mid-top.png`; measured: `.panel` Track top = 307 px; `web/src/components/StatusRail.tsx:95-148`; `web/src/styles/components.css:1762-1778` | Move the gear and arrow out of their own row (beside the brand line, or into the footer); move weather into the session line; with F1-UX-2 done, the transport row leaves the block. Target: map top at or under 180 px. | impeccable `layout.md` | S |
| F1-UX-6 | P1 | S-A11Y-1, S-A11Y-4, S-ID-1 | The two icons under 1360 px wide: a gear and a diagonal arrow, with no visible text. The gear's accessible name is "F1TV Link" (a mismatch with what a gear signals, so a voice user saying "click settings" fails, WCAG 2.5.3) and it has no tooltip; only the arrow has a `title`. The arrow reads as "share" but opens the GitHub repo. On the phone they measure 28.6x44 and 27.1x44 px, with a glyph of about 14 to 18 px, below the 44 px target the stylesheet itself intends. The only real share action, "Copy link", is a 24 px text button at 3596 px, under the tower. | `shots/f1-phone-mid-top.png`; measured widths above; `web/src/components/StatusRail.tsx:126-148`; `web/src/styles/components.css:1675-1692` (glyph only below 1360 px), `:409-429` | Rename the gear target (see D3), add `title` and a visible tooltip, and give each icon `min-width: 44px`. Replace the arrow with an explicit GitHub mark and keep "(opens in a new tab)". If the board needs a share action, put an icon-only Copy link in the sticky strip with `aria-label="Copy link to this board"` and the existing live-region feedback from `CopyButton`. | impeccable `layout.md`; web-design-guidelines | S |
| F1-UX-7 | P1 | S-FB-2 | In the public demo, the gear opens a page that says "Not available in the static demo" and "NEEDS THE FULL STACK". For a recruiter on the live site, the settings icon is a dead end that sits in the header on every route. | `shots/f1-settings-phone.png`, `shots/f1-settings-desktop.png`; `web/src/components/StatusRail.tsx:126-137`; `web/src/components/Settings.tsx` (static-demo notice) | Hide the F1TV link in the static build, or turn the page into a short "How this runs" page. Blocked by D3. | impeccable `operate.md` | S |
| F1-UX-8 | P1 | S-A11Y-1 | On touch screens, "Clear reference car" and "Copy link" measure 24 px high (design target 44 px), and "Compare laps in the overlay →" is a 14 px-tall standalone link. Cause: the `.tt-clear` base rule (`min-height: 24px`) sits after the `@media (pointer: coarse)` block, so it wins at equal specificity. | measured on the phone emulation: `tt-clear` 159.6x24, `btn tt-clear` 75.6x24, `demo-notice-link` 241.8x14; `web/src/styles/components.css:1302-1313` overrides `:1173-1181` | Move the coarse-pointer `.tt-clear` and `.cmd-copy` rule after `:1302`, or raise its specificity (`.tt-note .tt-clear`). Give `.demo-notice-link` a 44 px block on touch (`display: inline-block; padding-block`). Measure again with `hasTouch`. | impeccable `adapt.md` | S |
| F1-UX-9 | P2 | S-A11Y-3 | On a phone the strip is visually first (`order: -1`) but last in the DOM, so Tab goes Pause, scrubber, gear, arrow, then BOARD and OVERLAY. Focus order does not match the visual order (WCAG 1.3.2 and 2.4.3). | tab sequence from the keyboard run: skip link, Pause, scrubber, F1TV, GitHub, BOARD, OVERLAY; `web/src/styles/components.css:1749` (`order: -1`), `web/src/components/StatusRail.tsx:95` vs `:181` | Reorder the DOM (strip first, then block) and drop the `order` trick, or add a skip link target per region. Fixing F1-UX-2 first makes this smaller. | impeccable `adapt.md` | S |
| F1-UX-10 | P2 | S-LAY-5 | In the sticky strip the status chip is cut to `max-width: 8ch`, so the user sees "REPLAY" while LOOPING is lost, and the "Replay" chip looks like a button next to the real tabs. On Overlay and Settings the strip holds only the two tabs on the right, with a 48 px empty box beside them. | `shots/f1-phone-mid-scrolled.png`, `shots/f1-overlay-phone.png`, `shots/f1-settings-phone.png`; `web/src/styles/components.css:1833-1840` | Show a status dot plus an icon on phone and keep the full text in the block; on Overlay and Settings put the page title in the strip. | impeccable `layout.md` | S |
| F1-UX-11 | P2 | S-LAY-3 | Desktop: the Track panel is 803 px tall with the map in its top 480 px (about 200 px of dead space under the legend), and the four bottom panels are stretched to 536 px, so Comms and Race Control show three lines inside 536 px boxes. The page is 1.7 screens where about 1.3 would carry the same content. | `shots/f1-desktop-full.png`; measured panels: Track 803, Telemetry 536, Comms 536, Race Control 536; `web/src/styles/components.css:872-891` | `align-items: start` on `.board-bottom`, and put Comms above Race Control in one column so the strip needs only 3 columns. Let the map panel end at the legend (`align-self: start`) or place the strategy chart under it. | impeccable `layout.md` | S |
| F1-UX-12 | P2 | S-A11Y-1 | Desktop scrubber hit box is 20 px tall (`.range-dark` height 20) and the Pause button 32 px. The scrubber is under the 24 px AA floor; the thumb is 14 px. | measured (desktop: `range-dark` 129x20); `web/src/styles/components.css:1071-1077` | Height 24 px minimum on fine pointers (the coarse block already makes it 44). | impeccable `operate.md` | S |

Checked and fine: skip link present, visible focus ring (2 px chalk), no horizontal scroll at 320 px (scrollWidth 320), `lang="en"`, viewport-fit cover with safe-area inset on the strip, touch rows 44 px, reduced-motion hook exists (`web/src/hooks/useReducedMotion.ts`). Not checked: the error and offline states (the static demo has no gateway to break), and screen-reader output.

## Decisions for Natalie

**D1. Which moment the demo opens on.** Protects: the recruiter's first impression (the tower is the product). Blocks F1-UX-1.
1. Seek to about 2:40 on first load and every loop restart. Trade-off: the visitor never sees the formation lap or the opening seconds; the scrubber can still reach them.
2. Keep the clip as is and add a "Jump to race action" button next to the scrubber. Trade-off: honest and complete, but the first view stays empty unless the visitor clicks.
3. Rebake the clip to start at lap 2 (needs the ingest pipeline and a new 70 MB-class asset; touches #123). Trade-off: cleanest result, most work, and it grows the repo.

**D2. Phone timing tower shape.** Protects: how the product feels on a phone and the time to see all 20 drivers. Blocks F1-UX-3 (and shapes F1-UX-4).
1. Two-line rows, detail only on the selected row. Trade-off: shortest page (about 1.3 screens for the tower); sector times need a tap.
2. Keep the card layout but cut each card to 3 lines (gap, int, tyre and last lap), with Sectors behind a toggle. Trade-off: closer to what exists, still about 2 screens.
3. Keep today's card, add a sticky "Timing" section chip and a Back-to-top control. Trade-off: no layout change, but the 3-screen scroll remains.

**D3. What the gear is for in the public demo.** Protects: whether the header icons tell the truth. Blocks F1-UX-7 and the naming part of F1-UX-6.
1. Remove the F1TV link in the static build (it appears only with the full stack). Trade-off: the demo hides a feature the README sells; the README still explains it.
2. Keep it, relabel it "F1TV link (needs full stack)" with a text label, drop the gear glyph. Trade-off: honest, but a dead-end page remains.
3. Replace it with a "How this runs" page (architecture and the three-command run). Trade-off: more useful to a recruiter, but it adds new copy and a page that makes claims.

## Branding status

| Item | Status |
|---|---|
| Name in header | Present: "F1 Race Tracker" as text in the `<h1>`; no logo mark |
| Logo | Missing (decision for Natalie, not an agent job) |
| Favicon | Present: `web/public/favicon.svg` |
| `<title>` | Present: "F1 Race Tracker — live timing tower & telemetry"; per-route titles set in `web/src/components/Route.tsx` |
| OG image and meta | Present: `web/public/og.png` 1200x630, absolute URLs, alt text |
| Palette and type | Present: tokens in `web/src/styles/tokens.css` (Chakra Petch display, Martian Mono data, six-rung type scale). The written Design_Direction doc is open under #124 |

## Fix batches (non-blocked findings)

1. **Touch and cascade fixes (S, one PR):** F1-UX-8, F1-UX-12, the `min-width: 44px` part of F1-UX-6, F1-UX-10. Goal: every touch target hits 44 px and the strip chip stops losing its words.
2. **Phone header and navigation (M, one PR):** F1-UX-2, F1-UX-5, F1-UX-9, F1-UX-4. Goal: Pause and the section jumps stay reachable on a phone, and the map sits within the first 180 px.
3. **Desktop density (S, one PR):** F1-UX-11. Goal: take the desktop page from 1.7 toward 1.3 screens.

Held for decisions: F1-UX-1 (D1), F1-UX-3 (D2), F1-UX-7 and part of F1-UX-6 (D3).

Scratch scripts (outside the repo): `C:/Users/natal/AppData/Local/Temp/claude/C--Users-natal-Documents-Coding/8e0bd04f-a0a9-4b3b-8823-01eed51111ca/scratchpad/f1m.mjs`, `f1s.mjs`, `f1t.mjs`, `f1u.mjs`. Screenshots: `shots/f1-*.png`, `shots/f1-overlay-*.png`, `shots/f1-settings-*.png`, `shots/f1-phone-mid-*.png`, `shots/f1-320.png`.

## Fix log

Batch "Touch and cascade fixes", PR https://github.com/natcat38/f1-race-tracker/pull/165, merged yes, mergedAt 2026-10-23T11:52:23Z (squash; CI all green).
- Fixed: F1-UX-8 (Clear reference car, Copy link, Settings copy, overlay link now 44 px on touch), F1-UX-12 (desktop scrubber 20 to 24 px), F1-UX-10 (phone strip keeps the glyph, full "REPLAY · LOOPING CLIP" moves to the block; route title fills the empty strip on Overlay/Settings), F1-UX-6 `min-width: 44px` only (exits 28.6/27.1 to 44 px wide).
- Skipped: F1-UX-1, 3, 7 and the naming/label part of F1-UX-6 (held for D1/D2/D3), as instructed.
- Page length: phone 5.4 screens at load before and after (5.89 to 5.97 with data); desktop 1.7 before and after.
- Left open, noticed: desktop rail chip still ends "LOOPING..." at 1440 px (`max-width: 22ch`), and at 320 px the strip is overfull before and after (clock itself clipped, chip glyph under the tabs). ROADMAP.md Review section records the batch.

Batch "Phone header", PR https://github.com/natcat38/f1-race-tracker/pull/166, merged yes, mergedAt 2026-10-23T17:58:02Z (squash).
- Fixed: F1-UX-2 (Pause in the sticky phone strip), 4 (five section chips, `scroll-margin-top` 96 px), 5 (Track panel top 307 to 178 px), 9 (strip first in DOM), plus the 320 px overfull strip.
- Page length: phone 5.4 to 5.1 screens; desktop 1.7 unchanged. Desktop rail chip truncation left open.

Batch "Desktop density", PR https://github.com/natcat38/f1-race-tracker/pull/167, merged yes, mergedAt 2026-10-23T18:10:42Z (squash).
- Fixed: F1-UX-11 (one board grid). Desktop 1.68 to 1.49 screens at 1440x900 (target was about 1.3; the tower and strategy chart set the floor).

Batch "Phone tower and gear", PR https://github.com/natcat38/f1-race-tracker/pull/168, merged yes, mergedAt 2026-10-23T18:26:13Z (squash).
- Fixed: F1-UX-3 (R2: cards 127 to 82 px, sectors behind a Detail switch), 7 and the naming part of 6 (R3: "How this runs" page, copy only from README and BENCHMARKS).
- Page length: phone 5.74 to 4.66 screens. Trade-off: the visible "How this runs" label moves the Track panel top to 210 px.

Batch "Demo clip from lap 2", PR https://github.com/natcat38/f1-race-tracker/pull/169, merged yes, mergedAt 2026-10-23T18:41:07Z (squash).
- Fixed: F1-UX-1 (R1: clip re-baked from lap 2, replaced in place). Size +10.6% (under the 20% limit). NO DATA rows: 19 for about 150 s, now 0 by 25 s. #123 stays open.
- Also fixed a stale `sectorDominance` length check in `ingest/record.py`. Gap-estimator still inside its gates.

### 2026-11-09 owner decisions on #168 and #167 (ADR-0015)
- #168: the phone settings exit is icon-only; its words are the last item of the section strip.
  Track panel top at 390 px: 210 to 177 px.
- #167: the tower opens on the top ten with "Show all 20"; the reference car always stays visible.
  Phone page 4.13 to 3.74 screens; desktop 1.50 to 1.33 screens.
- Shots: `ux-audit-2026-10/2026-11-{before,after}-{phone,desktop}.png`.
