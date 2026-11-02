<!-- ADR-0011: the demo clip opens from lap 2, the phone timing tower uses compact cards with sectors behind a switch, and the static demo's gear opens a "How this runs" page. -->

# 0011 — The demo opens at lap 2, the phone tower uses compact cards, and the static demo explains how it runs

**Status:** Accepted (owner decisions R1, R2 and R3 of the 2026-10 UX polish pass, 2026-10-24)

## Context

A UX audit on 2026-10-23 measured what a first-time visitor sees on the default Monza 2024
replay and on the static GitHub Pages demo (ADR-0006):

- **Opening moment.** The clip started on lap 1, so 19 of the 20 timing-tower rows read NO DATA
  for about the first 2 min 20 s. A visitor who leaves within that window never sees the tower
  working.
- **Phone tower.** Each car was a 127px card with every field showing, so the tower alone was
  about 3.5 screens tall at 390px.
- **Static demo gear.** On the Pages build the gear in the header opened the F1TV account-link
  page (ADR-0007), which can only say "Not available". It was a dead end in the header of every
  route, for the reader least able to use it.

## Decision

**R1, option 3: re-bake the default clip from lap 2.** `data/replays/monza-2024-race.jsonl` is
re-baked to start at lap 2 and replaces the old clip in place, so the repo gains one new version
of the asset in history, not a second clip. The README's "laps 2–6" note explains why the window
starts there. This touches #123 (clip size), which stays open.

**R2, option 2: compact phone cards, sectors behind a switch.** On a phone each timing card shows
two lines (position, driver, tyre / gap, interval, last lap). Best lap and the sector line sit
behind a "Detail" switch, off by default. Desktop is unchanged.

**R3, option 3: a "How this runs" page in the static demo.** On the static build the header link
opens a page that describes the full system in four stages, the three-command run and the
benchmark headline. Every statement restates `README.md` or `BENCHMARKS.md`; the figures are
quoted, not re-measured. The link carries a visible text label on a phone. The full build keeps
the gear and the F1TV page.

## Alternatives considered

- **R1 option 1, seek to about 2:40 on load and on each loop:** no new asset, but the scrubber
  starts mid-clip and the loop point jumps.
- **R1 option 2, a "Jump to race action" button:** no new asset, but the visitor must find and
  press it first.
- **R2 option 1, two-line rows with detail on tap:** the shortest tower (about 1.3 screens), but
  sectors are one tap per car away.
- **R2 option 3, keep the cards and add a sticky "Timing" chip:** the smallest change; the tower
  stays 3 screens tall.
- **R3 option 1, remove the gear from the static build:** honest, but leaves no route to "what
  is this and how do I run it".
- **R3 option 2, relabel it "F1TV link (needs full stack)":** still a dead end.

## Consequences

- No timing row reads NO DATA after 25 s (19 rows for about 150 s before). The clip grew 10.6%,
  inside the 20% limit.
- Phone card height 127px -> 82px; tower 3.5 -> 2.4 screens at 390px; phone page 5.74 -> 4.66
  screens.
- The visible "How this runs" label pushes the Track panel top on a phone to 210px against a
  180px target. The alternative, an icon with a tooltip only, is an open owner call.
- The "How this runs" copy must be kept in step with `README.md` and `BENCHMARKS.md`; it adds no
  claim of its own.
