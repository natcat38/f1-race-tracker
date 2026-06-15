---
type: Data Source
title: FastF1 source
description: The free F1 timing data source — FastF1 for historical and live, with OpenF1 historical as a fallback.
resource: https://docs.fastf1.dev/
tags: [data, fastf1]
timestamp: 2026-06-15T00:00:00Z
---

# Schema

All data is free. The [ingest pipeline](/components/ingest-pipeline.md) uses:

- **FastF1** (primary) — historical sessions for baking replay clips, and its free live client.
  ⚠️ First load of a session is slow and network-heavy; cache locally — recording is an offline
  batch step run a handful of times ever.
- **OpenF1** (fallback) — historical data only. ⚠️ OpenF1 *live* now needs a paid, rate-limited
  tier, so live ingestion prefers FastF1.

Curated, downsampled clips (including a same-track two-year pair for the comparison view) are
committed so `docker compose up` works on a clean clone with no credentials.

# Citations

[Tech Scope Implementation Notes](../../docs/F1_Race_Tracker_Tech_Scope.md).
