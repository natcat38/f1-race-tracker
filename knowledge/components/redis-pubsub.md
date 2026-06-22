---
type: Component
title: Redis pub/sub
description: The language-agnostic seam — snapshot store plus lossy fan-out — between the writer and the gateways.
resource: ../../docs/F1_Race_Tracker_Tech_Scope.md
tags: [component, redis, seam]
timestamp: 2026-06-15T00:00:00Z
---

# Schema

Redis is the only shared state and the seam: Python and Go never call each other, they agree
only on the [event model](/domain/event-model.md) JSON over Redis.

- On each applied frame the active writer does `SET snapshot:{session}` **then**
  `PUBLISH frames:{session}` — ⚠️ **SET before PUBLISH**, always.
- Each gateway must `SUBSCRIBE` **before** its initial `GET snapshot`, then drop any buffered
  frame whose `Rev` ≤ the snapshot's `Rev` (subscribe-before-snapshot).
- **The snapshot is the source of truth; frames are an optimisation** — any missed frame is
  healed by the next snapshot, which is why lossy pub/sub is safe.

Gateways are stateless (subscribe + serve only), so the design *can* scale horizontally to
multiple gateways behind a load balancer. The system currently runs and is benchmarked as a
**single** gateway; the multi-gateway tier is deferred — see
[ADR-0001](../../docs/adr/0001-single-gateway-deferred-multigateway.md).

# Citations

[Tech Scope §2.1 and §2.5](../../docs/F1_Race_Tracker_Tech_Scope.md).
