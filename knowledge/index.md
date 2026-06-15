# F1 Race Tracker — Knowledge

A real-time F1 race visualiser: an animated track map + standings, fed by either a
live timing source or a committed replay clip. **Python writes, Go fans out, Redis is
the language-agnostic seam, React renders.** No relational DB; the whole system runs
via `docker compose up`.

This bundle is the agent- and reviewer-readable knowledge map. The code-level breakdown
lives in [`docs/F1_Race_Tracker_Tech_Scope.md`](../docs/F1_Race_Tracker_Tech_Scope.md);
product scope in [`docs/F1_Race_Tracker_Product_Scope.md`](../docs/F1_Race_Tracker_Product_Scope.md).

## Domain

- [Event model](/domain/event-model.md) — the JSON contract shared by Python and Go (the seam).
- [Leaderboard](/domain/leaderboard.md) — running order derived from car positions.

## Components

- [Ingest pipeline](/components/ingest-pipeline.md) — Python recorder + live client (the writer).
- [Replay engine](/components/replay-engine.md) — Go player streaming a clip on the clock.
- [Redis pub/sub](/components/redis-pubsub.md) — snapshot store + fan-out, the cross-language seam.
- [WebSocket protocol](/components/websocket-protocol.md) — snapshot-on-join, backpressure, resume.

## Data

- [FastF1 source](/data/fastf1-source.md) — historical + live timing data (OpenF1 fallback).
