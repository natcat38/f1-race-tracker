---
type: Domain Entity
title: Leaderboard
description: The running order, derived directly from car positions rather than stored separately.
resource: ../../docs/F1_Race_Tracker_Tech_Scope.md
tags: [domain]
timestamp: 2026-06-15T00:00:00Z
---

# Schema

The standings are not a separate data source: each car's `pos` in the
[event model](/domain/event-model.md) is derived from its position, so the map and the
ordered leaderboard are rendered from the same [frame](/domain/event-model.md). The
track outline itself is one clean lap of the leader's positions, normalised to a unit box
at record time — there are no per-circuit map files.

# Citations

[Tech Scope §2.2 and §2.4](../../docs/F1_Race_Tracker_Tech_Scope.md).
