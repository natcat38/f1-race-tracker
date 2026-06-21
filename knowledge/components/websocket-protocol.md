---
type: Component
title: WebSocket protocol
description: The Go hub that sends a snapshot on join, streams frames, applies backpressure, and supports idempotent resume.
resource: ../../docs/F1_Race_Tracker_Tech_Scope.md
tags: [component, go, websocket]
timestamp: 2026-06-15T00:00:00Z
---

# Schema

Each gateway serves the React SPA and a WebSocket endpoint from the same origin.

- **Snapshot-on-join** — a new client receives the in-memory [snapshot](/domain/event-model.md)
  as its first WS message, then streams subsequent frames.
- **Backpressure** — per-client buffered send channel; ⚠️ if a slow client's buffer fills,
  drop/coalesce rather than blocking the broadcast — one slow consumer must never stall the hub.
- **Resume** — the client stores the latest `Rev` it applied; on reconnect the server sends a
  fresh snapshot first, the client replaces state if `Rev` ≥ its own, and frames with
  `Rev` ≤ current are ignored. Guarantees convergence after any disconnect.

The hub convergence integration test (late-joiner + slow-client) is the evidence for these
system-design claims; the load test measures a **single gateway's** fan-out latency as
concurrent viewers climb. Scaling out to multiple gateways over [Redis](/components/redis-pubsub.md)
is what the stateless design enables but is not yet built — see
[ADR-0001](../../docs/adr/0001-single-gateway-deferred-multigateway.md).

# Citations

[Tech Scope §2.5–2.6 and Tasks 5, 13, 14](../../docs/F1_Race_Tracker_Tech_Scope.md).
