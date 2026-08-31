<!-- Adversarial validation of reviews/uiux-ranked.md. Every claim was checked against the cited source; contrast ratios recomputed from hex via WCAG relative-luminance math. -->
# UI/UX fix list — adversarial validation

Method: each claim's file:line evidence was reopened, the factual assertion re-derived
from the code (contrast recomputed from the actual hex tokens, aria/role/CSS facts read
directly), and the cited principle checked against the actual normative text of
WCAG 2.2, Nielsen's ten heuristics, the named UX laws, and the Web Interface Guidelines.

Summary: **6 CONFIRMED · 6 CONFIRMED-WITH-CORRECTION · 2 UNVERIFIABLE-STATICALLY · 1 REFUTED**
(counted at ranked-item level; per-bullet verdicts inside items 5, 9, 13, 14 are given below).

---

## 1. Comms driver codes in raw team hex — **CONFIRMED**

**Evidence** — exact. `Comms.tsx:22-24` (`colourFor` → `teamColour[...]`), `:45`
(`background: 'var(--asphalt)'`), `:47` (now-playing code in `colourFor`), `:79`
(history row code in `colourFor`). `teamColours.ts:4,7` give `Red Bull #3671C6`,
`AlphaTauri #2B4562`. `tokens.css:6` `--asphalt: #0B0D10`.

**Recomputed contrast** (sRGB relative luminance, WCAG 2.x formula):

| pair | L(fg) | L(bg) | ratio | audit said |
|---|---|---|---|---|
| `#2B4562` on `#0B0D10` | 0.05648 | 0.003963 | **1.97:1** | 1.98 ✓ |
| `#3671C6` on `#0B0D10` | 0.16671 | 0.003963 | **4.02:1** | 4.02 ✓ |

Not large text: the banner is `--fs-md` = 13px (`tokens.css:150`) and the history row is
`--fs-sm` = 12px (`components.css:967`), both far below the 18.66px-bold large-text
threshold, so the 4.5:1 floor is the right one even at `fontWeight: 700`.

**Worse than stated:** the *history* rows (`:79`) sit on the panel, `--carbon #14171C`
(L = 0.008453), not on `--asphalt` — AlphaTauri there is **1.82:1** and Red Bull **3.71:1**.

**Principle** — correct as cited: **WCAG 2.2 SC 1.4.3 Contrast (Minimum), Level AA**.
Also **Nielsen #4 Consistency and standards** for the regression against
`TimingTower`'s own colour-as-border-accent pattern (`components.css:724-728`).

---

## 2. Ghost overlay is undiscoverable — **CONFIRMED-WITH-CORRECTION**

**Evidence** — `StatusRail.tsx:18-21` exists as cited. **Correction:** the tab is not
"a plain OVERLAY nav tab with no hierarchy, hint, or affordance" — it carries a
sub-label, `sub: 'lap delta'`, rendered at `StatusRail.tsx:197` as `.rail-tab-sub`. So it
has information scent; what it lacks is *weight* relative to BOARD and any pointer from
the board body. The claim survives in weakened form.

**Principle — both cited laws are misapplied.**
- **Jakob's law** (users expect your site to work like the ones they already know) is
  *satisfied*, not broken: a labelled top-rail tab is exactly the convention.
- **Hick's law** (decision time grows with the number of choices) does not apply to a
  two-item nav; the problem is the opposite of too many choices.

**Correct framing: no standard is broken.** The closest legitimate hook is
**Nielsen #6 Recognition rather than recall** — the feature must be recognisable from
the board rather than recalled from a tab name. Treat as a product/discoverability
judgement call, not a violation.

---

## 3. "● Live" toggle label overpromises — **CONFIRMED**

**Evidence** — `SourceToggle.tsx:9-14` exact: visible `label: '● Live'`, with the honest
`caveat` string carried separately. `SegmentedControl.tsx:66` puts it in `title=`, `:71`
puts it in a `.visually-hidden` span — so on the board the caveat reaches only hover and
assistive tech, as claimed.

**Stronger than stated:** `StatusBadge.tsx:79-88` renders the visible
`● LIVE LANE · RECORDED CLIP` chip, but `StatusRail`/`App.tsx:263` pass
`laneNamedElsewhere={!STATIC_DEMO}`, and `StatusBadge.tsx:73` returns `null` in the
healthy case when that is true. **On the non-static board the visible honest chip is not
rendered at all** — so the caveat is *only* in the tooltip and hidden text there.

**Principle** — **no WCAG SC is broken**. Note 2.5.3 Label in Name (A) explicitly
*passes*: the accessible name begins with the visible label. The correct citation is
**Nielsen #1 Visibility of system status** (and #2 Match between the system and the real
world — the label must not claim more than the system does).

---

## 4. Track map's 20 markers have no per-car text alternative — **REFUTED**

**Evidence** — `Map.tsx:24` is exact, and it is what kills the claim:

```
<svg viewBox={...} className="track-svg" role="img" aria-label={anySelection ? '…' : 'Track map with live car positions'}>
```

`role="img"` makes the element a leaf in the accessibility tree — descendants are pruned
— and `aria-label` supplies its text alternative. **This is already the "pragmatic fix"
the audit proposes**: `aria-hidden="true"` and `role="img"` + label are near-identical in
effect, except the existing code is *better* (it names the graphic instead of erasing it).

WCAG 2.2 SC 1.1.1 Non-text Content (A) requires "a text alternative that serves the
equivalent purpose", not one alternative per datum; for a complex graphic whose data is
also available as text, a short label plus the equivalent text elsewhere satisfies it.
That equivalent text exists — `TimingTower` renders every car's position, code and gap
as a real table, and the audit's own item 4 concedes this.

**Verdict: REFUTED. No standard broken.** The map's `aria-label` even conveys the
selection state (`:19,24`), which is more than the proposed fix would.

---

## 5. Telemetry readouts semantically empty — **split**

**5a. Sparklines expose only the label — CONFIRMED.**
`TelemetryPanel.tsx:46-49` exact: `role="img" aria-label={label}`, label built at `:124`
as `` `${car.code} lap time trend` `` / `:131` `` `${car.code} gap trend` ``. The trend
itself (direction, spread, which laps were slower) reaches no assistive tech; the only
adjacent text is the *latest* value (`:126`, `:134`), not the trend.
**Principle correct: WCAG 2.2 SC 1.1.1 Non-text Content, Level A.** (Unlike item 4 there
is no equivalent text elsewhere — the per-lap series exists nowhere else on the page.)

**5b. Throttle/Brake bars lack `role="meter"` — CONFIRMED-WITH-CORRECTION.**
`TelemetryPanel.tsx:13-26` exact: `.tele-label` span, an unlabelled div-in-div bar, and a
`.tele-value` span, with no `role`, `aria-valuenow`, or programmatic association.
**Correction to the principle: no WCAG SC is broken.** Label and value are both real
visible text in a sensible DOM order, so 1.3.1 Info and Relationships (A) passes and
4.1.2 Name, Role, Value (A) does not apply — the bar is a non-interactive graphic, and
the value is not conveyed by the graphic alone. The correct citation is the
**Web Interface Guidelines rule that a value indicator should expose `role="meter"`
with `aria-valuenow`/`aria-valuemin`/`aria-valuemax`** — a best-practice improvement,
not a conformance failure.

---

## 6. Deep links with zero UI surface — **CONFIRMED**

**Evidence** — all three sites exact. `routing.ts` implements `?car=`, `?a=`, `?b=`
(`:78-87`, `:98-107`); `App.tsx:210-230` writes the board's `?car=` back via
`history.replaceState` (`:229`); `Ghost.tsx:152-163` does the same for `?a=`/`?b=`
(`:162`). A repo-wide grep for `clipboard` / "copy link" / share affordances across
`web/src/components/` and `App.tsx` returns **only** `Settings.tsx:24`
(`navigator.clipboard.writeText` for shell commands) — there is no share control on the
board or the overlay.

**Principle** — **no standard broken; correctly framed as a missed opportunity.** The
nearest legitimate heuristic is **Nielsen #7 Flexibility and efficiency of use**
(accelerators for expert users, hidden from novices — here the accelerator is hidden from
*everyone*). Not a WCAG issue.

---

## 7. Reconnect is far from where the failure is noticed — **CONFIRMED**

**Evidence** — exact. `App.tsx:295-304` overlays `⚠ Connection lost` on the map with no
action; `StatusBadge.tsx:35-45` is the only place the `Reconnect` button renders, in the
rail. `App.tsx:41` even makes the separation explicit in the skeleton copy:
`'Connection lost. Use Reconnect in the status rail above to try again.'` — a
recall-the-other-control instruction. Confirmed.

**Principle — Fitts's law is a stretch.** Fitts's law predicts *pointing time* as a
function of distance and target size; it says the trip is slower, not that the user
cannot find the control. The real defects are **Nielsen #6 Recognition rather than
recall** (the fix is literally written as an instruction to go look elsewhere) and the
**Gestalt law of proximity** (the notice and its remedy are not grouped). Cite those;
keep Fitts's as a secondary, quantitative note. **No WCAG SC broken.**

---

## 8. Race Control can't tell "no incidents" from "not connected" — **CONFIRMED**

**Evidence** — `RaceControl.tsx:43` exact, character for character:
`if (state.messages.length === 0) return <div className="empty">No incidents.</div>;`
The `state.rev === 0` discriminator the audit points to is real and used elsewhere:
`App.tsx:244-245` (`showSkeleton = state.rev === 0 || trackless`) and
`StatusBadge.tsx:53` (`⏳ Warming up the timing feed…`). So this panel genuinely asserts
a fact about the session before any snapshot has arrived.

**Principle** — **Nielsen #1 Visibility of system status**, correctly. No WCAG SC broken
(the `role="log"` region at `:52` is well-formed).

---

## 9. Settings is a wall of prose — **CONFIRMED-WITH-CORRECTION** (one sub-claim REFUTED)

**9a. Wall of prose / no progressive disclosure — CONFIRMED-WITH-CORRECTION.**
`Settings.tsx:196-271` exact. **Correction:** the page is not wholly undifferentiated —
`:205-207` renders a `NextStep` in a polite live region, and `:209-216` / `:218-224`
already branch on `auth.state === 'linked'` and `noSubscription`. What is unconditional
is the four-step `<h3>Signing in</h3><ol>` (`:226-249`), the three commands (`:239-253`),
and the privacy/beta paragraphs (`:256-270`) — so a linked operator does still scroll the
full onboarding. The audit's second recommendation is already satisfied: the paid-
subscription warning is *already* the first paragraph and *already* in `<strong>` (`:198`).
**Principle: no standard broken.** **Nielsen #8 Aesthetic and minimalist design** is the
right heuristic. (Progressive disclosure is a technique, not a heuristic — do not cite it
as one.)

**9b. Copy button gives no failure feedback and no live-region success — CONFIRMED.**
`Settings.tsx:22-30` exact: `catch { setCopied(false); }` swallows the failure silently,
and the `✓ copied` label change at `:35` sits in no live region. **Principle:
Nielsen #1 Visibility of system status** and **#9 Help users recognise, diagnose and
recover from errors**. Note WCAG 4.1.3 Status Messages (AA) is *arguably* engaged for the
success case, since the change is a status message not tied to a focus change — but the
label change is on the button the user just activated, so this is weak; do not lead with it.

**9c. `aria-label={`Copy: ${children}`}` breaks to "[object Object]" — REFUTED.**
`Settings.tsx:20` types the prop as `{ children: string }`. TypeScript rejects a JSX
child that is not a string at every call site (`:239`, `:241`, `:244` all pass string
literals). The failure mode described cannot occur without first breaking the build.
Latent only if someone widens the type to `ReactNode` — worth a comment, not a fix.

---

## 10. Zone D reads as one five-option control — **CONFIRMED-WITH-CORRECTION**

**Evidence** — `App.tsx:267-277` exact. **Two corrections:**

1. **The count is wrong.** Zone D holds three controls, not five: `▶ Replay`, `● Live`
   (`SourceToggle.tsx:8-14`) and one `⏸ Freeze`/`▶ Resume` button (`App.tsx:274-276`).
   Comms' `Off`/`On` pair lives in a board *panel* (`Comms.tsx:33-39`), not the rail.
2. **"No divider" is wrong.** `SegmentedControl.tsx:52` renders a visible
   `.rail-scope` label — the word **LANE** — before the segments, styled as an uppercase
   letterspaced display-font tag (`components.css:212-220`), and the two segments *abut*
   into one unit (`.rail-segments`, `components.css:224-237`: shared radii killed,
   `margin-left: -1px`) while Freeze is a detached standalone `.btn` separated by
   `.rail-controls`' gap. The grouping signal exists; it is subtle, not absent.

**Principle** — the audit cites nothing explicit. The correct one is the
**Gestalt law of common region / proximity** (the segmented pair is one region, the verb
is another). Given the scope label and the abutted segments already encode this,
**verdict: real but minor — a strengthening of an existing separator, not a missing one.**
No WCAG SC broken; keep it below item 12 in priority.

---

## 11. Rival-picker `<select>` has a transparent background — **CONFIRMED-WITH-CORRECTION**

**Evidence** — exact. `TelemetryPanel.tsx:177` is `className="btn"` on the `<select>`
(element spans `:174-184`); `.btn` sets `background: transparent` (`components.css:527`).
`.overlay-select` (`components.css:903-912`) does set `background: var(--asphalt)` and
`color: var(--chalk)` explicitly. Two idioms for one job — confirmed.

**Correction to the stated failure mode:** "one theme/browser change from a light popup
on a dark row" overstates the risk. `tokens.css:4` sets `color-scheme: dark` at `:root`
with the comment "Native form controls, scrollbars and select popups follow this. Without
it Windows renders light chrome inside a dark page." The UA-rendered popup is already
pinned dark; the transparent background inherits the dark page. The live defect is the
**inconsistency**, not an imminent light-on-dark break.

**Principle** — **Nielsen #4 Consistency and standards**. **No WCAG SC broken**
(1.4.3 cannot be evaluated on a transparent background, and the effective rendering is
the dark page). Priority should drop accordingly.

---

## 12. Tyre legend formatted differently in Tower vs StintChart — **CONFIRMED**

**Evidence** — exact, both sites.
`TimingTower.tsx:373-374` hard-codes glyph-prefixed labels:
`[['SOFT', 'S Soft'], ['MEDIUM', 'M Medium'], …]`.
`StintChart.tsx:105-107` derives them differently: `{t[0]}{t.slice(1).toLowerCase()}`
→ `Soft`, `Medium`, `Hard`, `Intermediate`, `Wet` — **no compound glyph**.
Same five compounds, same `TYRE_COLOUR` table, two independent renderings.

**Additional finding the audit missed:** the tower's legend also carries
`S = session best · P = personal best` (`TimingTower.tsx:380`) — the colour-blindness
mitigation — and `StintChart` carries no equivalent. The drift risk is already realised,
not merely prospective.

**Principle** — **Nielsen #4 Consistency and standards**, correctly. No WCAG SC broken
directly, but the diverging legends put **1.4.1 Use of Colour (A)** compliance at risk
in `StintChart`, since the glyph is the non-colour signal.

---

## 13. Target size and disabled-focus — **split**

**13a. `.tt-clear` / `.rail-repo-active` at the 24px floor — CONFIRMED-WITH-CORRECTION,
and it is a PASS, not a finding.**
- `.tt-clear` — cited line correct: `components.css:1248` opens the rule,
  `min-height: 24px` is at **:1256** exactly as stated, and it is `display: inline-flex`
  with the label "Clear reference car", so width is far over 24px.
- **`.rail-repo-active` is wrong.** That rule is at `components.css:1544` and sets only
  `color` / `text-decoration` / `text-underline-offset` — **it has no `min-height` at
  all**. The 24px rule near the cited `:1536` is **`.cmd-copy`** (`:1534-1538`).
- **Principle correction:** WCAG 2.2 SC 2.5.8 Target Size (Minimum), Level AA requires
  targets to be **at least** 24×24 CSS px. Sitting *exactly* at 24px **conforms**. There
  is nothing to verify and nothing to fix. `@media (pointer: coarse)` already lifts
  `.btn`, `.btn-icon`, `.overlay-select`, `.tt-clear` to 44px (`:1122-1128`).
  **Reclassify: not a finding.**

**13b. `.tt-select` under 24px at `pointer: fine` — CONFIRMED, and the audit
UNDER-states it.**
`components.css:760-778` exact: `.tt-select` sets `padding: 0`, `border: 0`,
`font: inherit` and no `min-height`, so its box is the 13px text's line box (~16–19px).
The row-level fallback is real (`TimingTower.tsx:266-267` handles the click on `.tt-row`)
but is **not an accessible control** — the `<tr>` has no `role`, no `tabIndex`, and is not
in the accessibility tree as a target, so 2.5.8's *equivalent-control* exception does not
apply to it. Nor does the *inline* exception (this is a table cell, not a target inside a
sentence). The *spacing* exception fails too: the codebase's own comment at
`components.css:1130` records "**Rows measured 23px** — one pixel under the floor", and
adjacent rows' 24px spacing circles necessarily overlap in a stacked table.
**Principle: WCAG 2.2 SC 2.5.8 Target Size (Minimum), Level AA — a live AA failure at
`pointer: fine`, not "defensible … worth a code note".** Promote this bullet.

**13c. Ghost scrubber loses focus when `disabled` is toggled — UNVERIFIABLE-STATICALLY.**
`Ghost.tsx:353-372` exact: `disabled={!ready}` on the `<input type="range">` at `:364`
and on the Play button at `:353`. The dangerous direction is `ready` going **true → false**
while the scrubber holds focus, which requires a lane/driver change mid-session (the
render-time reset at `:177-179`). Whether the browser then drops focus to `<body>`
genuinely needs a live render to confirm.
**Principle: no WCAG SC is cleanly broken** — 2.4.3 Focus Order (A) is a stretch, and
3.2.1 On Focus does not cover focus *loss*. Cite the **Web Interface Guidelines rule that
a focused element must not be disabled out from under the user** (the standard remedy is
to move focus deliberately before disabling). Keep as a live-check item.

---

## 14. Minor polish — **mostly CONFIRMED, one correction**

**14a. `↻ CLIP LOOPED` chip: fixed 8s, non-dismissable — CONFIRMED.**
`App.tsx:29` `LOOP_NOTICE_MS = 8000`, `:82-86` the `setTimeout` that clears it, `:286`
the chip itself. No dismiss control. **Principle: Nielsen #3 User control and freedom.**
Note **WCAG 2.2.1 Timing Adjustable (A)** has an explicit exception for a *non-essential*
transient notice under 20 seconds — this does **not** fail 2.2.1.

**14b. Rival silently cleared when primary changes to match — CONFIRMED-WITH-CORRECTION.**
`App.tsx:159` exact:
`const effectiveRival = selected != null && rival !== selected ? rival : null;`
**Correction: nothing is cleared.** The `rival` state is untouched; only the *derived*
`effectiveRival` collapses to `null`, and it reappears the moment the primary moves off
that car. The user-visible symptom (the rival card vanishes with no explanation, and the
`<select>` at `TelemetryPanel.tsx:175` still shows the rival as chosen — a control
disagreeing with the view) is real and arguably worse than "cleared".
**Principle: Nielsen #1 Visibility of system status.**

**14c. Three stacked footnote rows under the tower — CONFIRMED.**
Exactly three consecutive `div.empty.tt-note` blocks at `TimingTower.tsx:348`, `:359`,
`:372`. **Principle: Nielsen #8 Aesthetic and minimalist design.** No SC broken.

**14d. `timingHelpers.ts` hand-formats times — CONFIRMED.**
`fmtLap:7-12`, `fmtElapsed:18-25`, `fmtSec:29-31`, `fmtGap:35-37`,
`fmtGapEstimate:49-53`, `fmtLongGap:59-64`, `fmtClock:68-73`, `fmtSigned:310-312` all use
`padStart`/`toFixed`; no `Intl` anywhere in the file. **No standard broken — this is a
documentation nicety.** Broadcast timing format is genuinely locale-invariant, so `Intl`
would be the wrong tool; a one-line comment is the right fix.

**14e. 400% zoom / 320px reflow never checked — UNVERIFIABLE-STATICALLY, correctly flagged.**
**WCAG 2.2 SC 1.4.10 Reflow, Level AA** is the right citation. Static reading is
reassuring but not conclusive: `Sparkline` sets `minWidth: MAX_SPARK_BARS * BAR_W` = 120px
(`TelemetryPanel.tsx:48`), the Ghost scrubber sets `minWidth: 160` (`Ghost.tsx:370`), and
`.tt-table` uses `white-space: nowrap` on every cell (`components.css:664`) — three
content-based floors that could chain. Against that, the tower drops columns via
`@container tt` queries at 771/700/635px (`components.css:686-700`). Needs a live check.

---

## Cross-cutting note on principle citation

Six of the fourteen items cite a principle that does not survive inspection: items 2
(Jakob's/Hick's), 5b (1.1.1 → WIG best practice), 7 (Fitts's), 9a ("progressive
disclosure" is not a heuristic), 11 (implied 1.4.3), and 13a (2.5.8 read as a ceiling
rather than a floor). Only items **1 (1.4.3 AA)**, **5a (1.1.1 A)**, **13b (2.5.8 AA)**
and **14e (1.4.10 AA, pending)** are genuine WCAG conformance failures. The rest are
Nielsen/Gestalt/WIG improvements or style preferences, and the ranked list should say so
rather than borrowing WCAG's authority for them.

The "what's already strong" section checks out: the contrast comments in `tokens.css`
were spot-checked against recomputed ratios (`--slate` on `--carbon`, `--dim`, the tyre
compounds) and the documented figures are accurate.
