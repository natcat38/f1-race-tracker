# Design-system audit — F1 Race Tracker web client

Scope: `web/src/**` styling architecture — tokens, palette, spacing, type scale,
component consistency. Read-only audit; no code changed.

---

## Verdict

**There is a real token layer, and it is better than most portfolio frontends.**
`web/src/styles/tokens.css` is a hand-built, 49-line `:root` block with a full
palette, two font stacks, a 5-step spacing scale and an 8-step type scale — and,
unusually, it documents *why* each colour exists and carries measured WCAG
contrast ratios in the comments. There is zero dead CSS: all 39 declared classes
are referenced. Motion is opt-in behind `prefers-reduced-motion: no-preference`,
which is the correct polarity and something most codebases get backwards.

The problem is not the token layer. **The problem is that roughly a third of the
UI never reaches it.** 68 inline `style={{…}}` objects across 12 components
bypass the CSS files. Those inline styles are disciplined about *colour* (they
mostly say `var(--slate)`, not `#8A94A0`) but undisciplined about *everything
numeric* — spacing, radii and widths are raw pixel integers. A declared 5-step
spacing scale is competing with about eleven values actually in use.

Two findings are sharper than mere drift, and both are the kind a frontend-literate
reviewer spots in sixty seconds:

1. A **tyre-compound colour is being used as a status colour** in two unrelated
   places. Retune the medium-compound yellow and the yellow-flag label and the
   in-pit indicator silently move with it.
2. The token file **explicitly documents a colour decision that a sibling data
   file then violates**. `--rain` is annotated "deliberately NOT Red Bull's
   `#3671C6`" — and `TYRE_COLOUR.WET` is `#3671C6`, exactly Red Bull's blue.

Neither is a redesign issue. Both are ten-line fixes. That is the shape of this
whole report: the aesthetic is deliberate and working, the *plumbing* under it is
about 80% finished, and the missing 20% is cheap.

**Grade: B. A tight afternoon of consolidation moves it to A-.**

---

## 1. Current-state map

### Architecture

| Layer | Location | Status |
|---|---|---|
| Primitive + semantic tokens | `web/src/styles/tokens.css` (81 lines) | Present, single flat layer |
| Component styles | `web/src/styles/components.css` (437 lines) | Present, classic BEM-ish flat classes |
| Component-level tokens | — | **Absent** (see §2.7) |
| Inline styles | 68 `style={{…}}` across 12 `.tsx` | **The leak** |
| Colour data (teams, tyres) | `teamColours.ts`, `timingHelpers.ts:78` | Outside the token system |
| Utility framework | none | No Tailwind, no CSS modules, no CSS-in-JS |

Load order is `main.tsx:6-7` — `tokens.css` then `components.css`, both global.
Fonts are self-hosted via `@fontsource` (`main.tsx:3-6`), not a CDN link — no
render-blocking third-party request and no layout shift. Good call, and worth
keeping visible in the README.

### The palette

Thirteen colours, and the grouping is genuinely semantic rather than a swatch dump:

- **Surfaces** — `--asphalt` `#0B0D10` (page), `--carbon` `#14171C` (panel),
  `--edge` `#232A33` (1px borders)
- **Text** — `--chalk` `#E9EDF1` (primary), `--slate` `#8A94A0` (secondary),
  `--dim` `#646D79` (deliberately-off states, annotated 3.4:1)
- **Status** — `--amber` `#FFB000` (attention only), `--onair` `#E10600`
  (F1 brand red, annotated *fills only*), `--good` `#3BB273` / `--bad` `#FF4238`
  (the better/worse pair), `--best-session` `#B14AFF` (purple sector),
  `--rain` `#5AB0F0`
- **Map chrome** — `--track-edge`, `--track-fill`, `--track-label`

The `--onair` comment (`tokens.css:13-14`) is the standout: it records that the
brand red measures 3.6:1 as text on carbon, so it is restricted to fills and
`--bad` is used for red *text*. That is a real design-system decision, written
down, with the number attached. Same for the `--good`/`--bad` pair at
`tokens.css:16-20`. This is the strongest thing in the repo and it should be
pointed at in any portfolio walkthrough.

The pit-wall/broadcast aesthetic is executed **systematically at the token level**
— near-black surfaces, a single high-contrast chalk, restricted accent use, mono
type with `font-variant-numeric: tabular-nums` on `body` (`tokens.css:62`). It is
executed **ad hoc at the component level**, which is where §2 lives.

### Scales

```
Spacing   --sp-1..--sp-6   4 / 8 / 12 / 16 / 24        (no --sp-5 = 20)
Type      --fs-3xs..hero   9 / 10 / 11 / 12 / 13 / 14 / 18 / 28
Radius    (undeclared)     1 / 2 / 4 / 50% in practice
```

### Credit where due

- `color-scheme: dark` (`tokens.css:4`) with the Windows-chrome rationale — a
  detail that only shows up if you actually tested on Windows.
- Global `:focus-visible` (`tokens.css:65`) and a `.visually-hidden` utility.
- Motion is **opt-in**, gated behind `no-preference` (`components.css:364`) —
  the accessible default, not the retrofit.
- `TrackPath.tsx` exists specifically to kill two duplicate hardcoded track
  drawings, and the comment says so. `tyreLabel()` exists to fix a "S 5" vs "S5"
  inconsistency, and the comment says so. Someone has already been doing this
  consolidation work by hand — this report is a continuation of it, not a
  correction.

---

## 2. Inconsistencies found

### 2.1 Semantic leak: a tyre colour doing status duty (highest severity)

```
web/src/components/RaceControl.tsx:9    Flag: { label: 'FLAG', colour: TYRE_COLOUR.MEDIUM }
web/src/components/TimingTower.tsx:112  color: c.status === 'Pit' ? TYRE_COLOUR.MEDIUM : 'var(--slate)'
```

`TYRE_COLOUR.MEDIUM` (`#e8c84a`, a tyre-compound yellow) is being borrowed as the
colour for **yellow flags** and for the **in-pit indicator**. These are three
unrelated meanings sharing one literal. Change the medium-compound swatch for
legibility and you silently restyle race control and the timing tower.

There is already a correct token for this: `--amber`, whose comment reads
"ATTENTION ONLY: stall, reconnect, flags, safety car" (`tokens.css:12`) —
flags are *literally named in the token's own docstring*. The `SafetyCar`
entry one line below (`RaceControl.tsx:10`) uses `var(--amber)` correctly.
So the file disagrees with itself within two lines.

### 2.2 A documented decision, contradicted by a sibling file

```
web/src/styles/tokens.css:25            --rain: #5AB0F0;  /* deliberately NOT Red Bull's #3671C6 */
web/src/components/timingHelpers.ts:79  INTERMEDIATE: '#3bb273', WET: '#3671C6',
web/src/components/teamColours.ts:2     'Red Bull': '#3671C6', ...
```

The token file goes out of its way to record that the weather readout avoids Red
Bull's blue, presumably so a rain indicator is never confused with a car. The
tyre table then assigns that exact hex to the WET compound. In a wet race the WET
swatch in the tyre legend and the Red Bull car markers are the same colour — the
precise collision the token comment was written to prevent.

### 2.3 Token values re-typed as literals in TypeScript

```
web/src/components/timingHelpers.ts:78-79
  SOFT: '#e1342e', MEDIUM: '#e8c84a', HARD: '#e8e8e8',
  INTERMEDIATE: '#3bb273', WET: '#3671C6',
```

- `INTERMEDIATE: '#3bb273'` is **exactly** `--good: #3BB273` (`tokens.css:21`),
  re-typed in lowercase. A find-and-replace on the token will miss it.
- `SOFT: '#e1342e'` is a *third* red, close to but equal to neither
  `--bad: #FF4238` nor `--onair: #E10600`. The palette now carries three reds
  that no reader can tell apart from the code.
- `HARD: '#e8e8e8'` is a fourth near-white alongside `--chalk: #E9EDF1` and
  `--track-label: #EEEEEE`.

Tyre colours are legitimately *brand data* (like `teamColours.ts`) and arguably
belong outside the theme. But they should then be declared as `--tyre-*` tokens
so their relationship to the palette is visible and deliberate, not accidental.

### 2.4 `rgba()` washes hardcode token channels — this is the theme-change blocker

```
web/src/styles/components.css:117  background: rgba(233, 237, 241, 0.06);   /* = --chalk */
web/src/styles/components.css:158  background: rgba(225, 6, 0, 0.15);      /* = --onair */
web/src/styles/components.css:174  background: rgba(255, 176, 0, 0.15);    /* = --amber */
web/src/styles/components.css:229  background: rgba(233, 237, 241, 0.06);  /* = --chalk */
web/src/styles/components.css:312  background: rgba(233, 237, 241, 0.04);  /* = --chalk */
```

Every hover state and every chip wash decomposes a token into raw RGB channels.
Change `--chalk` and all three hover states keep the old hue. This is the single
biggest reason a theme swap is not a one-file edit. `components.css:117` and
`:229` are also byte-identical duplicates.

### 2.5 SVG chrome: two standards in one component family

`TrackPath.tsx:8-9` does it right — `stroke="var(--track-edge)"`,
`stroke="var(--track-fill)"`. Its callers do not:

```
web/src/components/Map.tsx:17     fill={teamColour[c.team] ?? '#bbb'} stroke="#000"
web/src/components/Ghost.tsx:119  const colour = car ? teamColour[car.team] ?? '#bbb' : '#bbb';
web/src/components/Ghost.tsx:146  stroke="#000"
web/src/components/Ghost.tsx:148  stroke="#fff"
web/src/components/Ghost.tsx:158  stroke="#444"
```

Six hardcoded greys for marker outlines, the ghost halo and the unknown-team
fallback. `#bbb` appears three times as the same concept ("team unknown") with no
name. These sit directly next to correct `var(--track-*)` usage, which makes the
inconsistency more visible, not less.

### 2.6 The spacing scale is declared but routinely bypassed

Scale is `4 / 8 / 12 / 16 / 24`. Actual values in use across the app: **1, 2, 3,
4, 6, 8, 10, 12, 16, 24** — roughly eleven values against a five-step scale.

**On-scale but written as raw integers** (mechanical fix, no visual change):

```
gap: 8       Comms.tsx:18,29,49 · RaceControl.tsx:28 · SourceToggle.tsx:40
             TelemetryPanel.tsx:9,75,91,98,129
gap: 4       Comms.tsx:46 · RaceControl.tsx:23 · SourceToggle.tsx:41
gap: 16      Compare.tsx:31 · TelemetryPanel.tsx:147
marginLeft: 16   TelemetryPanel.tsx:81,84
padding: 24      ErrorBoundary.tsx:26
padding: '8px 12px'  Comms.tsx:29
padding: '4px 8px'   Ghost.tsx:179
```

**Off-scale entirely** (needs a decision: snap to scale, or admit a `--sp-0` /
`--sp-5` and a micro-step):

```
gap: 3           StintChart.tsx:34
gap: 6           StintChart.tsx:36 · TelemetryPanel.tsx:132
gap: 10          TimingTower.tsx:162
marginBottom: 6  TimingTower.tsx:60
marginTop: 2     StintChart.tsx:71 · TimingTower.tsx:162
marginTop: 4     TimingTower.tsx:158
marginLeft: 2    TimingTower.tsx:135
marginLeft: 3    TimingTower.tsx:143
```

The CSS file is not innocent either — `components.css:104` (`gap: 2px`),
`:146` (`padding: 2px 10px`), `:299` and `:304` (`padding: 2px var(--sp-2)`)
mix a raw `2px` micro-step with scale tokens in the same declaration.

A dense timing UI legitimately needs a 2px micro-step. It should be
`--sp-0: 2px`, used deliberately — not eight separate raw integers.

### 2.7 No component-token layer, and one place that visibly wants one

`TelemetryPanel.tsx` repeats an identical row primitive three times verbatim:

```
web/src/components/TelemetryPanel.tsx:9   { display: 'flex', alignItems: 'center', gap: 8, fontSize: 'var(--fs-sm)' }
web/src/components/TelemetryPanel.tsx:91  { display: 'flex', alignItems: 'center', gap: 8, fontSize: 'var(--fs-sm)' }
web/src/components/TelemetryPanel.tsx:98  { display: 'flex', alignItems: 'center', gap: 8, fontSize: 'var(--fs-sm)' }
```

…paired with an identical label cell three times:

```
web/src/components/TelemetryPanel.tsx:10  <span style={{ width: 64, color: 'var(--slate)' }}>
web/src/components/TelemetryPanel.tsx:92  <span style={{ width: 64, color: 'var(--slate)' }}>
web/src/components/TelemetryPanel.tsx:99  <span style={{ width: 64, color: 'var(--slate)' }}>
```

That is a `.tele-row` / `.tele-label` pair asking to be extracted, and `width: 64`
is a component token (`--tele-label-w`) asking to be named. Related unnamed
magic widths: `TelemetryPanel.tsx:17` (`width: 36`), `:75` (`minWidth: 200`),
`StintChart.tsx:37` (`width: 28`), `Ghost.tsx:207` (`minWidth: 160`).

### 2.8 Border radius has no token

`4px` is the house radius — nine occurrences in `components.css` (`:13, :49, :106,
:147, :183, :218, :250, :272` and the skip link) plus four inline
(`Comms.tsx:30`, `Ghost.tsx:179`, `TelemetryPanel.tsx:11,14`). Alongside it:
`2` (`StintChart.tsx:38`, `components.css:411,417`), `1` (`StintChart.tsx:51`),
`50%` (the range thumb). Thirteen-plus sites, no `--radius`. Softening the corners
is currently a find-and-replace across two file types.

### 2.9 The error boundary drops out of the design system entirely

```
web/src/ErrorBoundary.tsx:26
  <div role="alert" style={{ padding: 24, fontFamily: 'sans-serif' }}>
```

This is the **top-level** boundary (`main.tsx:14`), so it is the most consequential
failure state in the app — and it explicitly overrides the font stack to
`sans-serif`, sets no colours, and uses an untokenized `padding: 24`. Because
`body` sets `background: var(--asphalt)` the page stays dark, but the content
renders in system sans at browser-default sizing: an unstyled-looking page
wearing the pit-wall background. If it ever fires during a demo it reads as
"the app broke" twice over.

`<h1>` inside it also inherits no type token, so it renders at the UA default
2em — roughly 26px against a 28px `--fs-hero`, by coincidence rather than intent.

### 2.10 Type scale is very fine-grained

`9 / 10 / 11 / 12 / 13 / 14 / 18 / 28` — six steps inside a 5px band, then a jump
to 18 and 28. For a dense broadcast timing UI a tight low end is defensible, but
`--fs-3xs` (9), `--fs-2xs` (10) and `--fs-xs` (11) are near-interchangeable in
practice and are chosen inconsistently for the same job: footnote text is
`--fs-2xs` at `StintChart.tsx:71` and `TimingTower.tsx:158,162`, but `--fs-xs` at
`TimingTower.tsx:60` and `TelemetryPanel.tsx:132`. Worth either collapsing 3xs/2xs
or documenting which tier each is for.

### 2.11 Minor: `theme-color` duplicates `--asphalt`

`web/index.html:7` — `<meta name="theme-color" content="#0B0D10">` restates
`--asphalt`. HTML cannot read CSS variables so the duplication is unavoidable,
but it is an undocumented fourth place the background colour lives.

### 2.12 No dead CSS

Checked all 39 classes in `components.css` against `.tsx` usage: **every one is
referenced at least once.** No orphans, no commented-out blocks, no vendor
leftovers. Notably clean.

---

## 3. How hard is a theme change?

Swapping the dark palette for a *different* dark palette today means editing
`tokens.css` (about 13 hex values, the easy part) **plus a tail of roughly 20
sites outside it**:

| Site | Count | Why it doesn't follow |
|---|---|---|
| `rgba()` washes in `components.css` | 5 | Token decomposed into raw channels |
| SVG greys in `Map.tsx` / `Ghost.tsx` | 6 | Never tokenized |
| `TYRE_COLOUR` literals | 5 | Live in TS, one duplicates `--good` |
| `index.html` `theme-color` | 1 | HTML can't read CSS vars |
| `ErrorBoundary` font override | 1 | Escapes the system entirely |

So: **one file plus a twenty-site tail, and the tail is invisible until it
renders wrong.** Fixing §2.4 and §2.5 alone (11 sites, maybe 30 minutes) reduces
this to "edit tokens.css, update one meta tag" — which is the honest claim you
want to be able to make.

A *light* theme is a bigger job and out of scope for minimal work: the contrast
annotations at `tokens.css:11-24` are all computed against `--carbon`, and the
`.chip` washes at `components.css:157-176` assume a dark composite. That is fine
— the app has a deliberate single identity and does not need a light mode. Worth
saying so in a comment so its absence reads as a decision.

---

## 4. Recommendations — ranked, minimal

Ordered by (reviewer-visible severity) ÷ (effort). Nothing here changes the
rendered design; every item is plumbing.

### 1. Stop using a tyre colour as a status colour — **2 lines**
`RaceControl.tsx:9` and `TimingTower.tsx:112` → `var(--amber)` (flags are already
named in that token's docstring) and a new `--pit` alias, or `var(--amber)` for
both. Highest-severity semantic bug, smallest diff in the report.

### 2. Make the `rgba()` washes derive from tokens — **~8 lines, unblocks theming**
Add channel triplets beside the hexes and compose them:

```css
--chalk-rgb: 233 237 241;   --onair-rgb: 225 6 0;   --amber-rgb: 255 176 0;
/* then */
background: rgb(var(--chalk-rgb) / 0.06);
```

Fixes `components.css:117, 158, 174, 229, 312` and collapses the `:117`/`:229`
duplicate into one `--hover-wash` token. (`color-mix()` is the modern
alternative; the explicit triplet is the safer floor.)

### 3. Move `TYRE_COLOUR` into the token file and resolve the Red Bull collision — **~6 lines**
Declare `--tyre-soft/medium/hard/inter/wet` in `tokens.css` next to the palette,
have `timingHelpers.ts:78-79` read them, then:
- change `WET` off `#3671C6` so it stops colliding with Red Bull and honours the
  `--rain` comment at `tokens.css:25`;
- point `INTERMEDIATE` at `--good` (it is already that exact value);
- decide whether `SOFT` should be `--bad` or stay a distinct fourth red — and
  write the reason down, the way the existing comments do.

### 4. Tokenize the six SVG greys — **~4 new tokens**
`--marker-stroke` (`#000`), `--marker-halo` (`#fff`), `--ghost-rule` (`#444`),
`--team-unknown` (`#bbb`) → applied at `Map.tsx:17`, `Ghost.tsx:119,146,148,158`.
Brings those two files up to the standard `TrackPath.tsx` already meets.

### 5. Sweep on-scale raw integers to `var(--sp-*)`, and name the micro-step — **mechanical**
Add `--sp-0: 2px` (the app clearly needs it — it appears at `components.css:104,
146, 299, 304` and four inline sites) and optionally `--sp-5: 20px` to close the
scale gap. Then replace the on-scale integers listed in §2.6. Decide once whether
`3`, `6` and `10` snap to `4`, `8` and `8` or earn tokens — do not leave them as
anonymous integers. Zero or near-zero visual change; large legibility win.

### 6. Give the error boundary the house style — **~5 lines**
`ErrorBoundary.tsx:26`: drop `fontFamily: 'sans-serif'`, use `padding: var(--sp-6)`,
set `color: var(--chalk)`, and give the `<h1>` `font-family: var(--display)` /
`font-size: var(--fs-hero)`. Cheapest possible fix to the app's most visible
failure state.

### 7. Extract the repeated telemetry row + add `--radius` — **~15 lines**
`.tele-row` / `.tele-label` in `components.css` replacing the three verbatim
copies at `TelemetryPanel.tsx:9/91/98` and `:10/92/99`, with `--tele-label-w: 64px`
as the first genuine component token. Add `--radius: 4px` and sweep the 13 sites
from §2.8.

**Explicitly not recommended:** any change to the palette's character, the
type pairing (Chakra Petch + Martian Mono is a strong, non-default choice), the
panel/rail layout, or the motion design. The identity is working. Do not touch it.

---

## 5. What a frontend-literate hiring manager would notice

**Would impress them:**

- WCAG contrast ratios computed and written into the token comments, with the
  explicit note "verified with WCAG relative-luminance math, not by eye"
  (`tokens.css:18-20`). Almost nobody does this. It is the single strongest
  signal in the CSS.
- The `--onair` fills-only rule (`tokens.css:13-14`) — recognising that the F1
  brand red fails as text and constraining it rather than shipping it anyway.
- `prefers-reduced-motion` as an **opt-in gate**, not an afterthought override
  (`components.css:364`).
- Comments that record *why a thing exists*: `TrackPath.tsx:1-3` ("previously
  carried identical hardcoded copies"), `timingHelpers.ts:84-85` ("previously
  formatted inconsistently... 'S 5' vs 'S5'"), the Windows range-input fix
  (`components.css:392-393`). This reads as someone who refactors and documents
  the refactor.
- Self-hosted fonts, no CDN, no CLS.
- Zero dead CSS in a 437-line stylesheet.

**Would make them wince:**

- **68 inline `style={{…}}` objects.** This is the first thing they will see, and
  it will frame everything after it. The honest defence — "colours go through
  tokens, only layout is inline" — is *true here* and worth making explicit in a
  comment at the top of `components.css`, because nobody will infer it.
- `TYRE_COLOUR.MEDIUM` as the yellow-flag colour (`RaceControl.tsx:9`). A
  reviewer who knows F1 will spot this instantly, and it sits one line above the
  correctly-tokenized `SafetyCar` entry.
- `--rain` documented as "deliberately NOT `#3671C6`" while `WET` is `#3671C6`.
  This is worse than an ordinary inconsistency because it proves the author knew
  the rule and the codebase broke it anyway. It reads as a comment that has gone
  stale — the exact thing the rest of these comments are so good at avoiding.
- `INTERMEDIATE: '#3bb273'` as a lowercase copy of `--good: #3BB273`. Two
  identical colours with different names and different casing is the canonical
  "no design system" smell, sitting inside a repo that otherwise has one.
- `fontFamily: 'sans-serif'` in the top-level error boundary
  (`ErrorBoundary.tsx:26`) — a deliberate override that throws away the whole
  type system at the one moment a user is already unhappy.
- Eleven spacing values against a declared five-step scale. Less damning than the
  colour issues (it is drift, not contradiction) but it undercuts the claim that
  the scale is real.

**The framing that serves this repo best:** the token layer, the contrast maths
and the reduced-motion handling are genuinely above the bar for a portfolio
project. Items 1–4 above are under an hour of work and remove every finding that
actively *contradicts* the codebase's own documented intent. That is the highest
return available here — after it, the remaining inline-style drift reads as a
known, bounded trade-off rather than as absence of a system.
