---
type: Domain Entity
title: Event model
description: The normalised JSON contract (CarState, Snapshot, Frame) shared identically by Python and Go.
resource: ../../docs/F1_Race_Tracker_Tech_Scope.md
tags: [domain, contract, seam]
timestamp: 2026-06-15T00:00:00Z
---

# Schema

The contract is defined identically in Go and Python — positions first; the same data gives
the running order for free (see [leaderboard](/domain/leaderboard.md)).

- **CarState** — `driverNum`, `code` (e.g. "VER"), `team`, `pos` (running order), `p`
  (track-space X/Y, drives the map), `status` (`OnTrack | Pit | Out`), optional `tyre`, `speed`.
- **Snapshot** — full current state served to new/reconnecting clients: session, mode
  (`live | replay`), label, one-time `track` outline, `cars`, messages, `timeMs`, and `rev`.
- **Frame** — a delta published to clients each tick; in practice nearly all cars move every frame.
- **Rev** — one global, monotonic revision owned by the active writer; it must **never reset**,
  not across a replay loop nor a live↔replay switch.

⚠️ Field names/tags must match exactly across languages — this contract is the seam; a
mismatch breaks fan-out silently.

# Citations

[Tech Scope §2.2](../../docs/F1_Race_Tracker_Tech_Scope.md).
