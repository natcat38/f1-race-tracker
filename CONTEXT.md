<!-- The project glossary: the shared vocabulary every layer, issue and ADR is expected to use. -->

# Context — F1 Race Tracker glossary

The shared vocabulary of this project. Use these terms exactly; avoid the listed
synonyms. This file is a glossary, not a spec — no implementation details. See
`docs/F1_Race_Tracker_Product_Scope.md` §1 for the product's stated vision.

## Lane

One independent stream of race state, identified by a **session key**, with its own
snapshot and frame channel. A lane is fed by exactly one **writer** at a time. The
running lanes are **replay** (the default Monza clip), **live** (the Python-fed
lane), and the two `compare-*` lanes (same circuit, two seasons, played in phase),
which are the **ghost overlay**'s cross-season sources.

- _Use_ "lane", not "channel", "feed", or "stream" when you mean this whole unit.
- Lanes never touch each other's state.

## Writer

The single process publishing state to a given lane. In the **replay** lane the Go
replay player is the writer; in the **live** lane the Python ingester is the writer.

- Exactly one writer per lane at any moment — never two.
- _Use_ "writer", not "producer" or "publisher" for the role.

## The seam

Redis — the one piece of shared state and the only thing Python and Go agree on.
They never call each other; they exchange the **event model** as JSON over Redis.

- _Use_ "the seam" for this decoupling point. It is language-agnostic by design.

## Gateway

The Go process that reads a lane from the seam, holds the current **snapshot** in
memory, serves the React app, and fans **frames** out over WebSocket. It only reads
and serves — it is never a writer.

- The system runs **one** gateway today; the design allows more (see
  `docs/adr/0001-single-gateway-deferred-multigateway.md`).

## Event model

The normalised contract — **CarState**, **Snapshot**, **Frame** — shared identically
by Python and Go. Positions come first; the running order is derived from the same
data, but not for free: a car's `pos` on the wire is a **reconciled** rank, computed
once per **frame** by the **writer** so that every frame carries a unique, contiguous
`1..N` order over the cars in it — no duplicates, no missing rank, no unknown
sentinel.

- _Use_ "event model" or "the contract"; the canonical definition is the Go types.
- _Use_ "running order" for the sequence and "reconciled" for the guarantee; a raw,
  per-driver position lookup is not the running order until it has been reconciled.

## Snapshot

The full current state of a lane, served to a newly-connected or reconnecting client
as its first message. The **source of truth** — any missed frame is healed by the
next snapshot.

## Frame

A per-tick update published to clients. For a track map nearly every car moves every
frame, so a frame in practice carries (almost) all cars — it is not a sparse diff.

## Rev

One global, monotonic revision number owned by the active **writer**. It must never
reset — not across a replay loop, not across a live↔replay switch. Clients ignore any
**Rev** at or below the one they already applied (idempotent resume).

- _Use_ "Rev"; do not call it "version", "sequence", or "tick".

## Session key

The string identifying a **lane** (e.g. `replay`, `live`, `compare-monza-2024`).
Names the Redis keys for that lane and selects it in `/ws?session=<key>`.

## Live / Replay

The two interchangeable **sources** behind one pipeline. **Replay** loops a committed
clip and is the always-on default. **Live** is the real-session source — best-effort,
and in the default demo it streams a clip through Python to exercise **the seam**
rather than connecting to a real session. The UI labels this state honestly
(`Live (demo)`, with a tooltip) rather than leaving the caveat only in the docs.

- _Use_ "source" for the live-vs-replay choice; the operator switches it via a toggle.
- Neither term describes the **static demo** (below) — that has no pipeline at all.

## Static demo

The frontend-only build hosted on GitHub Pages: a baked snapshot+frames JSON per
clip, played back by the frontend alone on a client-side clock, with no **writer**,
no **seam**, and no **gateway** behind it. It visually resembles the **replay**
source (same clip content) but shares none of its machinery — nothing here proves
anything about the real pipeline. A third front door alongside the README/video and
`docker-compose`, not a replacement for either.

- _Use_ "static demo" (or "the Pages demo"); never call it "replay" — that term is
  reserved for the pipeline-backed source above.

## Gap

A car's time behind the race **leader**. Best-effort — derived when a clip is recorded
(the source has no per-tick gap): arc-length progress along the circuit centreline,
converted to time through the leader's own distance-time curve. Good to about a tenth
of a second (measured — see ingest/README.md), so the UI marks it approximate and
prints one decimal.

- _Use_ "gap"; not "delta" or "distance".

## Interval

A car's time behind the car **directly ahead** in running order. Same best-effort
derivation as **Gap**.

- _Use_ "interval"; not "gap-ahead".

## Lap deficit

How many whole laps a car trails the **leader** — floored from the metres between
them, never from a lap-NUMBER difference (which reads 1 for the whole field between
the leader's line crossing and each car's own). A car a lap or more down ("lapped")
is shown as "+1 LAP", not a time. The time gap and the lap deficit are carried
separately so the UI never has to guess which to show.

- _Use_ "lap deficit" for the count, "lapped" for the ≥1 state.

## Timing tower

The per-car table beside the track map: position, **gap**, **interval**, last lap,
tyre, sector times — one row per car, sorted by running order. Clicking a row selects
that car for the **telemetry** readout.

- _Use_ "timing tower" or "the tower"; not "standings", "order", or "leaderboard".

## Telemetry

The per-car live readout — speed, gear, throttle, brake, DRS — shown for the one car
selected in the **timing tower**. Per-tick data; updates every frame.

- _Use_ "telemetry" for this readout.

## Reference car

The car selected in the **timing tower** (by clicking its row) whose sector times
every other row's sector delta compares against, instead of that driver's own
personal best — "how much am I losing to *them*, right now" rather than a
self-relative reading. The same selection also drives the primary **telemetry**
readout; a second, independently-picked car (the "vs" rival) can sit alongside it
for a two-car telemetry compare.

- _Use_ "reference car" for the tower's sector-delta anchor; "rival" only for the
  telemetry panel's second, independently-chosen car — the two selections are
  related but distinct.

## Stint

One baked, whole-race tyre-stint entry for a driver — a compound and the lap range
it covers. The full **stint** plan for a driver (all their stints, covering the
entire race) is baked once at record time, like the **lap trace**, not windowed to
the replay clip — so the strategy timeline can show the whole plan even though the
replay window only plays part of it.

- _Use_ "stint" for one compound/lap-range entry; "stint plan" or "strategy
  timeline" for the full per-driver set shown on the board.

## Weather

A session weather sample — air temp, track temp, rainfall — baked at record time
from the session's real weather data, best-effort like **gap**, and shown as a
status-rail chip. Attached to a **frame** only when the sample changes from the
last one emitted, then carried forward on the **snapshot** like any other
frame-delivered field.

## Team radio

A driver↔race-engineer audio clip tied to a moment in the race (a session-time).
Best-effort, like **gap** — placed by mapping the clip's wall-clock to session time
when a clip is recorded. The audio is streamed from a public URL at play time, never
stored; only the reference (driver, session-time, clip URL) rides the **snapshot**.

In **replay** a team-radio reference is a sparse, fixed timeline: the recorder knows
every clip up front, so the whole list rides the **snapshot**. In **live** the clips
only exist once they are spoken, so refs arrive on **frames** and accumulate onto the
snapshot — the **race control** pattern (ADR-0008).

- _Use_ "team radio" (or just "radio" as the short form for the clip/data); not
  "audio" or bare "message".

## Comms

The toggleable **layer** that surfaces **team radio** during replay: a now-playing
banner (driver attribution) and a short replayable history, switched by the comms
toggle. It auto-plays each clip as the replay clock reaches its moment. Shown only
on the main board — the **ghost overlay** stays a radio-free analytics surface.

- _Use_ "comms" / "comms layer"; never "overlay" (that is the ghost overlay, below)
  and not "lane" (a lane is a whole stream of state, not a UI toggle).

## Race control

The rolling per-lane log of session messages — flags, safety car, investigations —
shown alongside the **timing tower** on the main board. Baked from the session's
actual race-control feed at record time, attached to whichever **frame** covers each
message's moment, and accumulated on the **snapshot** incrementally as those frames
play — a genuine rolling buffer (cap 30), unlike **team radio**'s reference list,
which rides the snapshot whole and fixed from the very first frame.

- _Use_ "race control" or "the race-control feed"; not "incidents" or "flags" alone
  (those are one **category** of message, not the whole feed).

## Ghost overlay

The app's comparison view — the only one (ADR-0009). One track map replays two
**reference laps** in sync, side A solid and side B a translucent **ghost**, paired
with a **delta bar**. A **side** is a `(session, driver)` pair, so the same view spans
both comparison axes:

- **same driver, two seasons** — VER at Monza 2024 vs 2023, one lane each;
- **two drivers, one race** — VER vs LEC at Monza 2024, both sides sharing one lane,
  because every **snapshot** already carries every driver's **lap trace** (ADR-0004).

Across seasons the ghost is drawn on side A's outline: the two clips are normalised
independently, so the placement is approximate and the view says so. Within one
session both sides share an outline and the placement is exact. Either way the delta
itself is exact. It is a self-contained looping player, not the live race.

- _Use_ "overlay" / "ghost overlay" and "side A / side B"; not "compare" — the
  side-by-side COMPARE view is deleted, and `compare-monza-*` survives only as a
  historical **session key**.

## Ghost

The translucent marker for the prior-year **reference lap**, animated along the shared
track outline at its own pace beside this year's solid car. The spatial gap between the
two _is_ the time delta made visible.

- _Use_ "ghost"; not "shadow". The **lap trace** is the data; the ghost is the marker.

## Delta bar

The readout of signed time difference round the lap between the two **reference laps**
(this year minus last year): red where this year is slower, green where faster.

- _Use_ "delta bar" (or "delta"); not "gap" or "interval" — those are a car's deficit to
  a rival within one race, not a cross-year difference.

## Lap trace

The baked per-driver pace curve: cumulative lap time at each point round the track
outline, for that driver's **reference lap**. Best-effort, like **gap** — derived when a
clip is recorded. It rides the **snapshot** like the track outline; the **overlay**
subtracts two years' traces to get the **delta bar**.

- _Use_ "lap trace" (or "trace"); it is data, not a visual.

## Reference lap

A driver's fastest accurate lap of the session (FastF1 `pick_accurate`, then fastest),
used as the canonical lap for the **ghost overlay**. Best-effort, like **gap**.

- _Use_ "reference lap"; not "best lap" (which could mean the in-race personal best shown
  in the timing tower).

## Linked

The operator-level auth state of the beta live source: `unlinked`, `linked`, or
`expired` (the frontend adds `unavailable` when the gateway cannot be reached). One
operator's own F1TV subscription, linked on the host (ADR-0007) — never a user
account. The **writer** publishes the state over the **seam**; the **gateway** serves
it read-only; the settings page polls it.

- _Use_ "linked" / "the link" for the account state; not "logged in" or "signed in"
  (there is no user session here) and never "account" alone.

## Pit stop

One baked, dated entry for a driver's real visit to the pits — the lap it started on
and its stationary/pit-lane duration. Derived from FastF1's `PitInTime`/`PitOutTime`
lap columns, like the pit window below, but only when a real `PitInTime` exists —
a car that starts the race from the pit lane backdates a synthetic pit-in edge purely
to flag the pit window correctly, and that backdated edge must never produce a pit
stop entry (a pit-lane start is not a stop).

This is distinct from the pit window: the pit window is the `(pit_in, pit_out)` time
range used only to flag a car's Pit/Out status on track (position data's own status
field is not reliable for this — verified empty), and it can include the pit-lane-start
window with no corresponding stop. A pit stop is the strategy-facing record shown on
the timeline.

- _Use_ "pit stop" for the strategy-timeline entry (lap + duration); "pit window" for
  the on-track Pit/Out flagging range; never conflate the two — a car can have a pit
  window with no pit stop.

## Pedal trace

The baked per-driver throttle/brake/gear samples, indexed by the same track-outline
position as the **lap trace**, for the telemetry overlay. Best-effort, like **gap**,
and baked once at record time — not windowed to the replay clip.

- _Use_ "pedal trace"; not "telemetry" alone (too broad) or "car data" (the raw
  FastF1 source, not the baked/indexed form).

## Corner / track furniture

A labelled circuit corner — number and normalised `[0,1]` position, with an optional
letter distinguishing sub-corners that share a number (e.g. "10A"/"10B"). Baked once
from FastF1's circuit info, session-constant like the track outline. "Track furniture"
is the umbrella term for baked, non-car map annotations; corners are the only kind
baked today (DRS zones and a safety-car marker are deliberately out of scope — see the
ponytail note beside the corner-baking code).

- _Use_ "corner" for one labelled point; "track furniture" only when speaking of the
  category as a whole.

## Sector dominance / minisector

A per-driver-color coding of which driver was fastest through each fixed-size chunk
("minisector") of the track outline, shown on the map. Baked once per session,
independent of the replay window, at a fixed minisector size (points of track
outline per bin).

- _Use_ "sector dominance" for the feature/overlay; "minisector" for one fixed-size
  chunk of track outline it's computed over — not "sector" alone, which in F1 usually
  means one of the three timing sectors, a much coarser division.
