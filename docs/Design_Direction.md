<!-- The design direction for the web app: palette, type, layout, components and states, written from the app as it ships. -->

# Design Direction — F1 Race Tracker

This document records the design as it ships today. It was written after the build, from
`web/src/styles/tokens.css`, `web/src/styles/components.css` and the decisions in ADR-0011. The
code is the source of truth for every value. When the two disagree, fix this file.

## The world it borrows from

A team's pit wall during a race: dark screens, dense timing columns, a circuit outline, and
colour used only where it means something. The reader is an engineer watching a race, not a fan
browsing a results page. Every choice below follows from that.

**The generic default would be:** a light dashboard, rounded cards with drop shadows, a sans-serif
body font, a sidebar, and a red accent on every button. **Where it deviates:** a near-black page,
flat 1px-bordered panels, monospaced tabular numbers for all data, no sidebar, and red reserved for
the brand chip and "worse" readouts.

## Palette

Six named colours carry the interface. All are in `tokens.css`.

| Token | Value | Role |
|---|---|---|
| `--asphalt` | `#0B0D10` | Page background |
| `--carbon` | `#14171C` | Panel background |
| `--edge` | `#232A33` | 1px borders and dividers |
| `--chalk` | `#E9EDF1` | Primary text |
| `--slate` | `#8A94A0` | Secondary text and labels (5.8:1 on carbon) |
| `--amber` | `#FFB000` | Attention only: stall, reconnect, flags, safety car, a car in the pit (9.8:1) |

Semantic colours, used for meaning and never for decoration:

- `--good` `#3BB273` and `--bad` `#FF4238`: the better/worse pair (DRS on, throttle vs brake,
  faster/slower bars, ghost delta sign, error text).
- `--best-session` `#B14AFF`: the purple sector, as on F1's own timing screens.
- `--rain` `#5AB0F0`: water on the circuit. Deliberately not Red Bull's blue, so a weather readout
  never reads as a car.
- `--dim` `#7C8590`: the one de-emphasis colour (retired rows, DRS off). It replaces `opacity`,
  which dropped text below the contrast floor.
- The F1 red (`--onair-rgb`, `225 6 0`) appears only as a 15% wash behind the LIVE chip. Its label
  uses `--bad`, because the brand red is 3.4:1 over its own wash.

Brand data, not theme: team colours (`teamColours.ts`) and tyre compounds (`--tyre-*`). The tyre
colours double as text, so all five meet 4.5:1 on `--carbon`.

## Type

Two typefaces, both self-hosted through `@fontsource` (no runtime font CDN).

| Face | Token | Role |
|---|---|---|
| Chakra Petch 400/600/700 | `--display` | Headings, panel titles, tabs, uppercase chrome labels |
| Martian Mono (variable) | `--data` | Body and every number. `tabular-nums` on `body`, so columns never jitter as values change |

The scale has six rungs plus a hero, in `rem` so a raised browser font size scales the board:
11, 12, 13 (body), 14, 18, 22 and 28 px. `--fs-xs` labels something else; `--fs-sm` is a readout
read on its own. Uppercase labels use `--fs-xs`, weight 600, 0.14em tracking, `--slate`.

## Layout

One board, track map first.

- **Desktop (over 1100px):** a three-column grid. The left column sizes to the map (capped at
  30rem) and carries the strategy chart under it. The timing tower takes the right two columns.
  Telemetry sits beside a Comms-over-Race-Control stack. When a rival is picked, telemetry spans
  both lower columns and the stack drops to its own row. (UX polish batch 3: the page went from
  1.68 to 1.49 screens at 1440px.)
- **701 to 1100px:** two columns. Map, then tower, each full width, then panels in pairs.
- **Phone (700px and under):** one column, with a sticky strip holding Pause and the section
  chips, first in tab order. The map panel starts at 178px. Timing cards are two lines (position,
  driver, tyre / gap, interval, last lap), with Best and the sectors behind a "Detail" switch, off
  by default (ADR-0011 R2).
- Spacing steps: 2, 4, 8, 12, 16, 24 px (`--sp-*`). One corner radius, `--radius` 4px. Flat panels,
  no shadows.

The second view, **OVERLAY** (`#ghost`), is one map with two laps on it, side A solid and side B a
translucent ghost, over a red/green delta bar. BOARD and OVERLAY are tabs in the status rail.

## Signature element

**The track map.** The circuit is drawn the way a cartographer draws a road: a dark casing stroke
(`--track-edge`) under a lighter surface stroke (`--track-fill`), so the outline reads as tarmac cut
into the panel. Corner numbers and the start/finish line are fixed track furniture. The
sector-dominance heatmap colours each minisector by its fastest driver. Car markers carry the team
colour with a black outline and a driver code beside them.

Restraint everywhere else: panels are flat boxes, and colour outside the map means something.

## Components

- **Status rail:** title, BOARD / OVERLAY tabs, lane toggle, weather, the lane chip and, on the
  static demo, a "How this runs" link with a visible text label (ADR-0011 R3).
- **Chips:** pill labels in `--data` 13px/600. `chip-replay` on `--edge`, `chip-live` on the red
  wash, `chip-stall`/`chip-reconnect` in amber.
- **Timing tower:** gap/interval, last lap, tyre, sector shading (purple session best, green
  personal best). Clicking a row makes it the reference car for sector deltas. A car in the pit
  reads `IN PIT` in `--pit`.
- **Telemetry panel:** speed, gear, throttle, brake, DRS, lap-time and gap sparklines. The "vs"
  picker adds a second car and pedal-trace charts over lap distance.
- **Strategy chart:** one stint bar per driver in compound colours, with each stop's duration on
  the timeline.
- **Comms and Race Control:** rolling logs with timestamps. Comms has a now-playing banner.
- **Playback bar (static demo only):** Pause and a scrubber. The live and replay lanes have no
  pause or scrub.
- **Motion:** only the first page paints with a short staggered panel arrival (240ms + 180ms),
  inside `prefers-reduced-motion: no-preference`. Nothing else animates except chip transitions.

## States and their copy

Each exceptional state takes the lane chip's slot, so only one shows at a time.

| State | Copy |
|---|---|
| Warming up | ⏳ Warming up the timing feed… |
| Stale feed | ⚠ Waiting for timing data — last frame Ns ago |
| Reconnecting | ↺ Reconnecting… |
| Offline | ⚠ Connection lost — not retrying any more, with a Reconnect button |
| Static demo failed | ⚠ Demo data failed to load — refresh the page to retry. |
| Timing row with no data | NO DATA |
| Comms empty | No radio yet — clips play as the replay reaches them. |
| Overlay with no drivers | Waiting for driver data… |
| Panel crash | This panel hit an error — reload the page to restore it. |

The demo clip opens at lap 2, so the tower is full within about 8 seconds instead of reading
NO DATA for 2:30 (ADR-0011 R1).

## Quality floor

- Focus is visible everywhere: a 2px `--chalk` outline with a 2px offset.
- All text meets WCAG AA 4.5:1 on its real background, measured with relative-luminance math. The
  ratio is recorded next to each token in `tokens.css`.
- Touch targets are 44px on coarse pointers; the scrubber is 24px on desktop.
- Motion respects `prefers-reduced-motion`.
- Responsive down to 340px, with breakpoints at 1360, 1220, 1100, 700, 500, 420, 380 and 340px.
- A skip link, and live regions that announce a stall once rather than every second.
