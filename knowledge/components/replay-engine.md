---
type: Component
title: Replay engine
description: The Go player that reads a committed clip and publishes frames on the session clock, looping forever.
resource: ../../docs/F1_Race_Tracker_Tech_Scope.md
tags: [component, go, replay]
timestamp: 2026-06-15T00:00:00Z
---

# Schema

In replay mode the Go replay player is the active writer. It reads a `.jsonl` clip, emits
[frames](/domain/event-model.md) honouring `timeMs` gaps × a speed factor, and loops at the
end. The replay engine can be built and tested against a fake publisher before the Python
[ingest pipeline](/components/ingest-pipeline.md) exists.

⚠️ `Rev` stays monotonic across the loop (offset by `loop × maxRev`) and `T` is re-stamped to
emit-time, so clients never reject a looped snapshot. It publishes via
[Redis](/components/redis-pubsub.md).

# Citations

[Tech Scope §2.1 and Task 3](../../docs/F1_Race_Tracker_Tech_Scope.md).
