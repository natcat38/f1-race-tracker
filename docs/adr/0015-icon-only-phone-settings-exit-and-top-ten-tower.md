<!-- ADR-0015: on a phone the settings exit is icon-only with its words in the section strip, and the timing tower opens on the top ten with a "Show all" switch. -->

# 0015 — Icon-only phone settings exit, and a top-ten timing tower

**Status:** Accepted (owner decisions on #168 and #167, 2026-11-09)

## Context

- **#168.** ADR-0011 kept the "How this runs" label visible in the phone masthead, where every other
  exit is a glyph. The label is 131 px wide, so the identity lines beside it wrapped and the Track
  panel started at 210 px on a 390 px screen. The icon alone puts it at 177 px.
- **#167.** The timing tower always rendered all 20 rows, which made the desktop board about
  1.5 screens tall and the phone board about 4.1 screens.

## Decision

- **#168, option 3: icon plus strip item.** Under 1360 px the settings exit is glyph-only like the
  GitHub exit. It keeps its accessible name and `title`. The phone's "Jump to section" strip gains a
  last item, a link with the exit's words ("How this runs" on the static demo, "F1TV Link" on the
  full build). A tooltip alone was rejected because touch screens do not show `title`.
- **#167, option 3: top ten plus a toggle, on every width.** The tower shows positions 1 to 10 and a
  "Show all 20" button (`aria-expanded`). The reference car always stays in view: selecting P14
  shows rows 1 to 10 plus P14. Arrow-key focus moves through the visible rows only. With ten or
  fewer cars there is no switch.

## Consequences

Measured on the static demo build (Monza 2024, lap 2):

| | Before | After |
|---|---|---|
| Phone Track panel top (390 px) | 210 px | 177 px |
| Phone page height | 4.13 screens | 3.74 screens |
| Desktop page height (1440x900) | 1.50 screens | 1.33 screens |

Positions 11 to 20 are one click away rather than visible by default. A reader following a
midfield battle selects one of the cars, and the tower keeps it on screen.
