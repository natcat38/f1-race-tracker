---
type: Domain Entity
title: Event model
description: The normalised JSON contract (CarState, Snapshot, Frame) shared identically by Python and Go.
resource: ../../docs/F1_Race_Tracker_Tech_Scope.md
tags: [domain, contract, seam]
timestamp: 2026-07-25T00:00:00Z
---

# Schema

The contract is defined identically in Go and Python — positions first; the same data gives
the running order for free (see [leaderboard](leaderboard.md)). Source of truth:
`internal/model/model.go`.

- **CarState** — `driverNum`, `code` (e.g. "VER"), `team`, `pos` (running order), `lap`, `p`
  (track-space X/Y, drives the map), `status` (`OnTrack | Pit | Out`). Phase 2+, all optional
  (absent renders blank): tyre/stint (`tyre`, `tyreAge`), timing (`lastLapMs`, `bestLapMs`,
  `s1Ms`/`s2Ms`/`s3Ms`, `gapMs`, `gapLaps`, `intMs` — best-effort, derived at record time), and
  telemetry (`speed`, `gear`, `throttle`, `brake`, `drs`).
- **Snapshot** — full current state served to new/reconnecting clients: `session`, `mode`
  (`live | replay`), `label`, `cars`, `timeMs`, `rev`, plus these additive fields, all
  optional and **session-constant** (baked once, not windowed to the replay clip) unless
  noted: one-time `track` outline, `radio` (team-radio references), `lapTrace` (per-driver
  cumulative lap-time curve, for the ghost overlay), `totalLaps`, `stints` (per-driver tyre
  plan), `weather` (carried forward from the last frame that changed it), and `messages`
  (the rolling race-control buffer, cap 30 — accumulates as frames play, unlike the other
  session-constant fields).
- **Frame** — a delta published to clients each tick; in practice nearly all cars move every
  frame. Carries `session`, `rev`, `t` (publish wall-time), `timeMs` (session clock), `cars`,
  and optionally `messages` (new race-control entries this tick) and `weather` (only present
  when the sample changes from the last one emitted).
- **Rev** — one global, monotonic revision owned by the active writer; it must **never reset**,
  not across a replay loop nor a live↔replay switch.

⚠️ Field names/tags must match exactly across languages — this contract is the seam; a
mismatch breaks fan-out silently.

# Citations

[Tech Scope §2.2](../../docs/F1_Race_Tracker_Tech_Scope.md).
