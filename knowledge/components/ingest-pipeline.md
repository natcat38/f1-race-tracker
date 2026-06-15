---
type: Component
title: Ingest pipeline
description: The Python tier that records FastF1 sessions to replay clips and (in live mode) acts as the active writer.
resource: ../../docs/F1_Race_Tracker_Tech_Scope.md
tags: [component, python, ingest]
timestamp: 2026-06-15T00:00:00Z
---

# Schema

Python owns ingestion against the [FastF1 source](/data/fastf1-source.md):

- **Recorder** (`ingest/record.py`) — loads a finished session, normalises positions/timing
  to the [event model](/domain/event-model.md), downsamples to ~5–10 Hz, and writes a
  committed `.jsonl` replay clip with the computed track outline as the header line.
- **Live client** (`ingest/live.py`) — in live mode, normalises the live feed and publishes
  to [Redis](/components/redis-pubsub.md) as the active writer. Best-effort; replay is the demo.

⚠️ Exactly one writer publishes per channel at a time — the manual toggle starts one and
stops the other, never both.

# Citations

[Tech Scope §2.1 and Tasks 1, 10](../../docs/F1_Race_Tracker_Tech_Scope.md).
