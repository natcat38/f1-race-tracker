# Context — F1 Race Tracker glossary

The shared vocabulary of this project. Use these terms exactly; avoid the listed
synonyms. This file is a glossary, not a spec — no implementation details.

## Lane

One independent stream of race state, identified by a **session key**, with its own
snapshot and frame channel. A lane is fed by exactly one **writer** at a time. The
running lanes are **replay** (the default Monza clip), **live** (the Python-fed
lane), and the two **compare** lanes (same circuit, two seasons, played in phase).

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
by Python and Go. Positions come first; the running order falls out of the same data.

- _Use_ "event model" or "the contract"; the canonical definition is the Go types.

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
rather than connecting to a real session.

- _Use_ "source" for the live-vs-replay choice; the operator switches it via a toggle.

## Compare

The cross-year view: the same circuit across two seasons shown as two maps side by
side, kept in phase. It is the single-map view rendered twice over two **compare
lanes** — no new data type.

- _Use_ "compare" / "comparison", not "diff" or "overlay" — **overlay** is the
  separate computed-delta view (below), **compare** is the uncomputed side-by-side one.

## Gap

A car's time behind the race **leader**. Best-effort — derived when a clip is recorded
(the source has no per-tick gap), so the UI marks it approximate.

- _Use_ "gap"; not "delta" or "distance".

## Interval

A car's time behind the car **directly ahead** in running order. Same best-effort
derivation as **Gap**.

- _Use_ "interval"; not "gap-ahead".

## Lap deficit

How many whole laps a car trails the **leader**. A car a lap or more down ("lapped")
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

## Team radio

A driver↔race-engineer audio clip tied to a moment in the race (a session-time).
Best-effort, like **gap** — placed by mapping the clip's wall-clock to session time
when a clip is recorded. The audio is streamed from a public URL at play time, never
stored; only the reference (driver, session-time, clip URL) rides the **snapshot**.

- _Use_ "team radio" (or just "radio" as the short form for the clip/data); not
  "audio" or bare "message". A team-radio reference is a sparse, fixed timeline — it
  rides the **snapshot**, not every **frame**.

## Comms

The toggleable **layer** that surfaces **team radio** during replay: a now-playing
banner (driver attribution) and a short replayable history, switched by the comms
toggle. It auto-plays each clip as the replay clock reaches its moment.

- _Use_ "comms" / "comms layer"; never "overlay" (that is the cross-year ghost view,
  below) and not "lane" (a lane is a whole stream of state, not a UI toggle).

## Ghost overlay

The cross-year analytics view: one track map replaying a driver's **reference lap**
from two seasons in sync — this year solid, last year a translucent **ghost** — paired
with a **delta bar**. Computation is what sets it apart from **compare** (side-by-side,
no computation). It is a self-contained looping player, not the live race.

- _Use_ "overlay" / "ghost overlay"; not "compare" (the uncomputed side-by-side view).

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
