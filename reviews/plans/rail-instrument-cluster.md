# Status rail → instrument cluster + mobile sticky tab strip

Plan for owner approval. Research only — no code changed. Sources: `reviews/frontend-design.md`
items 8/9/10, `reviews/ui-ux.md` M12/M13/M14/m8/m22, `reviews/accessibility.md` H-2/H-4/M-6/L-2,
`reviews/design-system.md`, `reviews/ui-fix-log.md`. Live measurements taken against
`http://127.0.0.1:8080` at 1440/1280/768/390 (numbers below are measured, not estimated).

---

## 1. Current rail inventory

Component: `web/src/components/StatusRail.tsx:41-100`. Styles: `web/src/styles/components.css:63-207`
(rail), `:210-255` (chips), `:297-345` (buttons), `:831-866` (coarse pointer), `:1221-1228` (phone).
Rendered on every route via `Route` (`web/src/components/Route.tsx:28`): board (`App.tsx:164-187`),
Compare (`Compare.tsx:49,64`), Ghost (`Ghost.tsx:31,156`), Settings (`Settings.tsx:147,168`).

| # | Element | File:line | Job | Type | Size (measured) |
|---|---|---|---|---|---|
| 1 | `.rail-brand` "F1 Race Tracker" | `StatusRail.tsx:43` | identity | readout | 124×17, `--fs-sm` 12px display, 0.12em |
| 2 | `.rail-session` "Monza 2024 · Race" | `:46` | session identity | readout | 171×17, `--fs-2xs` 12px, 0.14em, `--slate` |
| 3 | `.rail-clock` | `:47` | race clock | readout | 135×28, `--fs-hero` 28px/600 tabular |
| 4 | `.rail-lap` "LAP 16/53" | `:50-52` | race progress | readout | 91×17, 12px `--slate` |
| 5 | `.rail-lap` weather "TRK 48° · AIR 33°" (+ RAIN) | `:53-58` | conditions | readout | 171×17, same rung as #4 |
| 6 | `StatusBadge` chip | `:62`, `StatusBadge.tsx:101-161` | connection/lane health; own `role=status aria-live=polite` | readout | 237×23, `--fs-md` 13px |
| 7 | `.rail-note` | `:65` | route caption (Compare/Ghost/static-demo) | readout | `--fs-sm`, `--slate` |
| 8 | `children` — `SourceToggle` radiogroup | `App.tsx:172`, `SourceToggle.tsx:57-85` | lane switch | **control** | 255×32 (two `.btn`, 44px on coarse) |
| 9 | `children` — Freeze/Resume `.btn` | `App.tsx:177-179` | transport | **control** | 103×32 |
| 10 | `children` — FROZEN chip + CLIP-LOOPED chip in a live region | `App.tsx:180-186` | transport state / loop notice | readout | 0×0 idle, ~23px when present |
| 11 | `.rail-spacer` | `:67` | flex filler | — | collapses on wrap |
| 12 | `.rail-tabs` `<nav>` — BOARD / COMPARE / OVERLAY + sub-labels | `:68-79` | primary nav | **control** | 346×45 (2-line tabs), 44px min-height on coarse |
| 13 | `.rail-repo` "F1TV Link" | `:80-86` | demoted Settings route (M12 landing) | **control** | 74×32 |
| 14 | `.rail-repo` "GitHub ↗" | `:90-99` | exit to repo (M15 landing) | **control** | 69×32 |

Already-landed rail work (`ui-fix-log.md`): 28px clock, uppercase/tracked labels, `nowrap` +
`display:none` on `.rail-tab-sub` under 500px, `margin-left:auto` on `.rail-tabs`, `flex-wrap`,
GitHub link, F1TV demotion out of nav, the loop chip, and the live region moved into `StatusBadge`.

### Where it sits, by width (measured, board route, replay lane)

| Width | Rail height | Rows | What happens |
|---|---|---|---|
| 1440 | **119px** | 2 | Row 1: brand · session · clock · lap · weather · chip · **SourceToggle right-aligned at x=1067**. Row 2: **Freeze left-aligned at x=41**, then a 671px gap, then tabs · F1TV · GitHub. The two board controls are 1000px apart on different lines. |
| 1280 | **115px** | 2 | Row 1 ends at the chip (x=814–1051). Row 2: SourceToggle, Freeze, tabs, links. Coherent-ish, but the readout row and control row are only separated by wrap luck. |
| 768 | **202px** | 3 | Row 1 readouts, row 2 weather + chip, row 3 controls; tabs 45px tall wrap-anchored right. |
| 390 | **379px** | **7** | Every element on its own line; tabs at y=308, links at y=350. Page is 4877px tall — the rail is 7.8% of the document and ~44% of a 390×844 first screen, and once you scroll there is no nav at all (m22). |

Focusable count on the board: 33 at every width; 8 of them are in the rail.

---

## 2. Information hierarchy — what an instrument cluster prioritises

A pit-wall cluster answers, in order: *is the feed alive → what session → where in the race → what
are the conditions → what am I allowed to touch*. The current rail answers all of those at the same
visual weight except the clock, and interleaves controls with readouts.

**Proposed three-zone grammar** (frontend-design item 8, unchanged in spirit):

- **Zone A — IDENTITY (fixed left).** Brand + session label. Brand is the wordmark; session is its
  sub-label. One vertical `--edge` hairline closes the zone.
- **Zone B — INSTRUMENTS (the boldness).** Clock (28px `--fs-hero`, kept) · LAP · TRK/AIR. Each is a
  value stacked over a `--fs-xs` 11px uppercase `--slate` label ("SESSION TIME", "LAP", "TRACK /
  AIR"). Labels are what turn a row of numbers into a cluster; no new type rungs needed — 11px
  uppercase `--slate` already exists as `.rail-tab-sub`'s idiom. Hairline-separated sub-cells.
- **Zone C — STATE.** The `StatusBadge` chip, plus the transient FROZEN / CLIP-LOOPED chips, in one
  slot that is *reserved* (fixed min-width) so chips appearing and vanishing never reflow the rail.
- **Zone D — CONTROLS (fixed right).** One segmented-control cluster, then nav, then exits.

Secondary, and explicitly demoted: nav tabs (they are chrome, not instruments), F1TV Link, GitHub.
They keep their current quiet treatment; nothing about M12's demotion is reopened.

### Control grammar unification (M13 / M14 / m8)

One idiom for every rail-adjacent control: **a segmented control — a `role="radiogroup"` of
`.btn` children with `aria-checked`, the pattern `SourceToggle.tsx:59-79` already implements
correctly, including roving tabindex.** Rules:

- **Segmented control = a choice between persistent states.** `LANE: REPLAY | LIVE`,
  `GAPS: TIME | LAPS` (M14's tower toggle), `RADIO: ON | OFF` (M13's Comms toggle). Label prefix
  in 11px uppercase `--slate` so the group names its own scope — which is precisely what M14 says
  is missing from "Show seconds".
- **Plain `.btn` = a momentary action that names what it will do.** Freeze/Resume stays a single
  button (it is a transport verb, not a two-state pick), but it moves *inside* the control cluster
  next to the lane segmented control so the two are never split across rows as they are at 1440
  today.
- **Never both.** m8 is resolved by making the healthy-lane readout structural rather than a chip:
  the active segment of `LANE: REPLAY | LIVE` *is* the readout. `StatusBadge` renders only
  exceptional states (warming, stale, reconnecting, failed) plus the honest "recorded clip" caveat,
  which is where it earns its slot. On routes with no `SourceToggle` (Compare/Ghost/Settings, and
  the static demo where `SourceToggle` is gated off at `App.tsx:172`) the chip keeps rendering the
  lane so those routes are not left with no lane readout — the duplication only existed on the
  board.
- **M12/M15 stay as they are:** F1TV Link and GitHub remain link-weight `.rail-repo`, outside `nav`
  for GitHub, `aria-current` for F1TV. They sit last in Zone D behind a hairline.

No new fonts, no new colour tokens, no new type rungs, and nothing below the rail changes. The only
new CSS primitives are `.rail-cluster` (flex + `border-left: 1px solid var(--edge)` +
`padding-inline: var(--sp-4)`) and `.rail-metric` (a two-row grid: value over label).

Target desktop height: **~64px, one row, no wrap at ≥1100px** — down from today's 115–119px.

---

## 3. Mobile

**Sticky tab strip (m22).** Below 700px the rail splits into two components in one sticky container:

```
position: sticky; top: 0; z-index: above panels, below the skip link
┌─ strip (48px content + env(safe-area-inset-top)) ──────────────┐
│ 1:17:58   LAP 16/53   ▶ REPLAY      BOARD · COMPARE · OVERLAY  │
└────────────────────────────────────────────────────────────────┘
```

- **In the strip:** clock (dropped to `--fs-2xl` 22px on the strip only), LAP, the state chip when
  it is non-healthy, and the three tabs. Tabs are `min-height: 44px` already at coarse pointer
  (`components.css:864`) — the strip is 48px so the targets are not clipped; text-only, sub-labels
  already hidden under 500px.
- **Where the readouts go:** brand, session label, weather, F1TV and GitHub move into a
  non-sticky "cluster block" that scrolls away above the strip. Controls (lane segmented control,
  Freeze) go into a `.panel-plate`-weight strip directly under it, also non-sticky — they are used
  once, not watched.
- **Safe area:** `padding-top: env(safe-area-inset-top)` on the sticky container and
  `padding-inline: max(var(--sp-3), env(safe-area-inset-left))`; `viewport-fit=cover` must be added
  to the meta viewport or the insets resolve to 0.
- **Scroll behaviour:** plain `position: sticky` — no hide-on-scroll-down. It is 48px and the page
  is 4877px; the cost of hiding it is a jitter bug, the benefit is 48px.
- **Reduced motion:** nothing animates. If a shadow/`--edge` border is added on scroll, apply it
  via an `IntersectionObserver` class toggle with a 120ms `background-color`/`border-color`
  transition only, wrapped in the existing `@media (prefers-reduced-motion: no-preference)` block
  (`components.css:703`).
- **375px collapse:** the strip is the only thing that must fit. Clock + LAP + 3 tabs at 11px
  measures ~330px; the chip slot drops to icon-only (`⚠`/`↺`) below 400px with the full text kept in
  `.visually-hidden`, so the announcement is unchanged. Weather never enters the strip. Expected
  first-screen chrome: **48px sticky + ~110px scroll-away block, vs 379px today.**

---

## 4. Layout options

### Option A — "Three clusters, one row" (desktop) + sticky strip (mobile) — **RECOMMENDED**

```
1440 / 1280 (64px, one row)
┌──────────────────────┬───────────────────────────────────────┬──────────────┬──────────────────────────────┐
│ F1 RACE TRACKER      │  1:17:58    16/53     48° / 33°       │ ▶ RECORDED   │ LANE[REPLAY|LIVE] ⏸FREEZE    │
│ MONZA 2024 · RACE    │  SESSION    LAP       TRACK / AIR      │   CLIP       │ BOARD COMPARE OVERLAY  ⚙  ↗  │
└──────────────────────┴───────────────────────────────────────┴──────────────┴──────────────────────────────┘
   identity              instruments (hairline-split cells)       state slot     controls (right-anchored)

768 (two rows, controls drop whole)
┌ identity │ instruments │ state ─────────────────────────────────────────────┐
├ LANE[REPLAY|LIVE]  ⏸FREEZE            BOARD COMPARE OVERLAY   F1TV  GITHUB ─┤

390
[ sticky 48px:  1:17:58  16/53  ⚠   BOARD COMPARE OVERLAY ]
[ scroll-away:  F1 RACE TRACKER / MONZA 2024 · RACE / 48°/33° / F1TV · GITHUB ]
[ controls:     LANE[REPLAY|LIVE]   ⏸ FREEZE                                  ]
```

Zones are `display: flex` children with `flex-wrap: wrap` at the *zone* level, not the element
level — so the rail can only ever wrap at cluster seams, never mid-instrument. Zone D keeps
`margin-left: auto`.

### Option B — "Two-tier rail"

Row 1 is a 44px readout tier (identity + instruments + state, hairlines, no controls, sticky on all
widths). Row 2 is a 40px control tier (segmented controls + nav + exits) that scrolls away on
desktop too. Clean separation of readout vs control, and gives sticky behaviour everywhere for free.
Costs 84px of permanent desktop chrome (vs 64px) and makes the instrument cluster less of a single
sculpted object — it reads as two toolbars. Also more disruptive to Compare/Ghost/Settings, which
have almost nothing to put in the control tier.

### Option C — "Cluster card"

Lift the instruments out of the rail into a distinct bordered card that overlaps the top of the
board (like a broadcast lower-third), leaving a thin 36px nav rail above. Highest visual payoff and
the strongest "instrument" read; but it is a board-only element, so the rail loses its
every-route identity, and it competes with the Track panel for the top of the page. Rejected as
larger than the brief, though worth keeping in mind if Ghost's promoted delta readout (item 10)
ends up wanting the same treatment.

**Recommendation: Option A.**

### Accessibility notes

- **Landmarks.** The rail becomes `<header class="rail">` inside `Route`, containing the existing
  `<nav>` (add `aria-label="Views"`; there is currently exactly one nav, but the sticky strip makes
  two on mobile if the DOM is duplicated — **do not duplicate the DOM**, re-flow the same nodes with
  CSS, or the tab order and the `aria-current` become ambiguous).
- **Heading chain.** `Route.tsx:27` renders the visually-hidden `<h1>`; a parallel PR is deciding
  whether sub-routes show it visibly (accessibility L-2). **Intent to coordinate on:** this plan
  assumes the `<h1>` stays the route title and does *not* move into the rail; if the parallel PR
  makes it visible, its natural home is Zone A under the session label, replacing `.rail-note` on
  Compare/Ghost. Neither PR should introduce a second `h1`.
- **Live regions.** Unchanged and non-negotiable: exactly one polite region per chip, inside
  `StatusBadge` (`StatusBadge.tsx:155-160`), stall seconds stay `aria-hidden` (H-2). The reserved
  state slot must not be a live region itself, or the FROZEN/loop region (`App.tsx:180`) nests.
- **Focus order** after restructure: skip link → brand/session (non-focusable) → lane segmented
  control (one tab stop, arrows within) → Freeze → BOARD → COMPARE → OVERLAY → F1TV → GitHub →
  `<main>`. Same 8 stops as today, but in a stable order that no longer depends on wrap position.
  A sticky strip must not trap focus: `scroll-margin-top: 64px` on `#main` and on tower rows so
  keyboard focus never lands under the strip.
- **Touch targets.** 44px floor already applies to `.btn`/`.rail-tab` at coarse pointer; the strip's
  48px height and the two `.rail-repo` links (currently 32px tall, **below the 44px target** even on
  coarse) should be brought up — this is an existing H-4 leftover, cheap to fix here.

### Test plan

- **Render tests** (`StatusRail.render.test.tsx` exists): cluster presence and order; each metric
  renders value + label; the state slot renders the chip only for exceptional statuses on the board
  and always on Compare/Ghost; `nav` has one `aria-current` at a time; exactly one `role="status"`
  in the rail subtree per chip; lap 0 still renders (the `!= null` guard at `StatusRail.tsx:50`).
- **SourceToggle/segmented-control tests:** `aria-checked` follows `state.session`, roving tabindex
  and arrow keys still work after the wrapper changes, and the new `GAPS`/`RADIO` groups (if M13/M14
  are folded in) expose the same contract.
- **Breakpoint tests:** the rail is not inside a container-query context today (`@container tt` is
  the tower's, `components.css:459`). Give `.rail` `container-type: inline-size` and express the
  collapse as `@container rail (max-width: …)` so Compare's narrower lanes collapse correctly too;
  assert via a Playwright pass at 1440/1280/1100/768/390 that (a) rail height ≤64px at ≥1100,
  (b) no horizontal document scroll at 320px, (c) the strip stays pinned after a 2000px scroll.
- **Keyboard order:** a Playwright tab-walk asserting the 8-stop sequence above at 1440 and 390.
- **Visual:** re-shoot `reviews/ui-ux-shots/` board at 1440/390 for the before/after in the PR.

---

## 5. Phases, estimate, risks

| Phase | Work | Size |
|---|---|---|
| 1 | `.rail-cluster` / `.rail-metric` CSS primitives + restructure `StatusRail.tsx` into zones; `<header>` + `aria-label` on nav; reserved state slot. No behaviour change. | M (~3h) |
| 2 | Control grammar: move Freeze into the control cluster, add the `LANE:` label to `SourceToggle`, drop the healthy-lane chip on the board only (m8). | S (~1.5h) |
| 3 | Mobile: container queries, sticky 48px strip, safe-area, scroll-away block, 375px chip collapse (m22). | M (~3h) |
| 4 | Optional fold-in of M13/M14 (Comms + gap-units as segmented controls) — separate PR, different files. | M |
| 5 | Tests + screenshots + `ui-fix-log.md` entry. | S (~1.5h) |

Phases 1–3 + 5 ≈ one day. Phase 4 is genuinely separable and should not block.

**Top risks**

1. **The rail is on every route and four call sites pass different prop combinations**
   (`App.tsx:164`, `Compare.tsx:49,64`, `Ghost.tsx:31,156`, `Settings.tsx:147,168`). A zone
   structure with empty clusters will render stray hairlines on Compare/Ghost/Settings and in the
   static demo, where `state`, `SourceToggle` and children are all absent. Mitigation: clusters
   render `null` when empty, and every route gets a render test.
2. **Chip timing vs a reserved slot.** The stall chip, FROZEN and CLIP-LOOPED (~8s) all share Zone
   C. Getting the reserved width wrong reintroduces the reflow the current `.chip` padding comment
   (`components.css:214-217`) was measured to avoid, and stacking two chips in a fixed slot can clip
   the loop notice at the exact moment it must be read. Mitigation: `min-width` not fixed width,
   chips stack vertically in the slot at ≥768, and the loop notice keeps priority over FROZEN.
3. **Regressing the accessibility work already banked.** H-2's single-live-region fix, the roving
   tabindex in `SourceToggle`, and the 44px coarse-pointer targets are all easy to break while
   re-parenting DOM — and dropping the healthy chip (m8) removes a lane readout that Compare/Ghost
   and the static demo still depend on. Mitigation: the m8 drop is board-scoped and test-asserted;
   no DOM duplication for the mobile strip.

Lower-order: the sticky strip needs `viewport-fit=cover` in `index.html` or safe-area insets are
inert; and `.ghost-controls .rail-clock` (`components.css:683`) borrows rail classes, so any
`.rail-clock` change must be re-checked on `#ghost`.
