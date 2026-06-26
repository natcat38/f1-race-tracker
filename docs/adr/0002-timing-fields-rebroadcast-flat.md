# 0002 — Timing fields rebroadcast every frame (flat contract)

Phase 2 adds timing and telemetry as flat `omitempty` fields on `CarState`
(`internal/model/model.go`), populated on **every** frame, rather than as a
separate lower-cadence message.

The slow fields — last/best lap, sectors, tyre, gap/interval — change roughly
once a lap, so rebroadcasting them at 10 Hz is redundant. We accept that
redundancy because it keeps the Python↔Go contract byte-identical (just more
fields on the existing struct), needs zero gateway changes, and heals via the
snapshot for free: `model.Apply` already does a wholesale per-car replace, so a
reconnecting client's snapshot carries the latest timing with no extra code.

The cost is frame size — roughly doubled (~2 KB → ~4 KB for 20 cars). This is
gated by the existing load-test benchmark (`BENCHMARKS.md`, 1000 viewers @ 10 Hz).
If p99 frame latency regresses or drops appear, the upgrade path is to split the
slow fields into a separate lower-cadence message ("Option B") — telemetry stays
per-frame, lap/tyre/sector/gap publish only on change. We did not build that up
front because the benchmark, not a guess, should justify the added complexity.
