# F1 Race Tracker — M4 (part 2): Load Test + Benchmark — Design

**Status:** Approved (brainstorming) · **Date:** 2026-06-19 · **Milestone:** Phase 1 / M4 (second of three M4 pieces)

## Context

M1–M3 built the real-time pipeline (Python/Go publishers → Redis → switchable Go gateway → React), and M4 part 1 added cross-year comparison. This is the **second** of three M4 deliverables; the third (README / demo-video polish) follows separately.

This piece was always flagged as needing **re-scoping against the as-built reality** before planning, because the original Phase-1 plan assumed observability that M1–M3 never built. The re-scope below reflects what actually exists:

- **No `/metrics` endpoint, no `clients:total` counter, no on-page health strip.** The gateway exposes only `/ws`, `/control/source`, `/healthz`, and `/` (static SPA). All server-side instrumentation from the original plan is absent.
- **Single gateway only.** No multi-gateway tier, no load balancer. The `/ws?session=<key>` hub registry (M4 part 1) is the reusable seam that *would* make horizontal scaling real, but only one gateway process exists.
- **`model.Frame` already carries `T int64` — publish wall-time in unix ms** (`internal/feed/replay/play.go:119,157` stamps `fr.T = time.Now().UnixMilli()` at emit; the writer publishes immediately after). This is the load-bearing fact: a client can compute true end-to-end fan-out latency as `now − T` per frame received, with **no server-side instrumentation**. The load harness itself is the measurement instrument.

## Goal

Produce a **load curve** that turns "horizontally scalable" from a claim into a measured engineering result: how a single gateway's fan-out latency and dropped-connection rate behave as concurrent WebSocket viewers climb from ~100 to a few thousand, alongside the gateway container's CPU/memory at each level. The deliverable is a committed `BENCHMARKS.md` containing a results table, a chart image, and one quotable headline sentence.

The load curve is chosen (over a single fixed-load number or a bare concurrency ceiling) because it is the most portfolio-credible: a chart that is "flat and fast until ~X clients, then climbs" demonstrates understanding of *where* the system degrades, and it naturally contains the other two framings (the flat region is the comfortable fixed-load number; the end of the curve is the ceiling).

## Scope

**In scope**
- A Go WebSocket load harness (`cmd/loadtest`) that hammers one load level and reports client-measured metrics as a single JSON row.
- A Python orchestrator (`bench/run.py`) that sweeps load levels, samples the gateway container's CPU/memory via `docker stats`, collects results into a CSV, and renders a chart PNG.
- `BENCHMARKS.md`: headline, methodology with honest caveats, results table, embedded chart, short interpretation.
- Committed artifacts: `bench/results.csv`, `bench/results.png`.
- Go unit tests for the pure pieces (histogram percentile math; envelope-frame → latency parse).
- A README pointer to the benchmark headline.

**Out of scope (explicitly deferred)**
- Any new server-side instrumentation: `/metrics`, Prometheus, a `clients:total` counter, or an on-page health strip. The whole point of the re-scope is to measure from the client side without touching the gateway.
- A multi-gateway / load-balancer tier. Noted as future work in the write-up; not built.
- Running the benchmark in CI. The sweep needs the full Docker stack and a quiet machine; it is run by hand and its CSV/PNG committed. Only the pure unit tests are CI-gated.
- Distributed/multi-machine load generation (e.g. k6 across hosts). Single-machine is the honest no-hosting reality.

## Design decisions (from brainstorming)

1. **Load curve**, not a single number — richest, most credible story; contains the other framings.
2. **Capture gateway CPU/mem** at each level (via `docker stats`), not client-side metrics only — shows how hard the server was actually working.
3. **Table + committed chart image** in `BENCHMARKS.md`, not table-only — a reader sees the knee of the curve at a glance.
4. **Polyglot split:** Go does the high-concurrency hammering (goroutine-per-connection — the language's core pitch); Python does orchestration + plotting (matplotlib, already in the stack via the ingester). Reinforces the polyglot-seam framing.
5. **Single machine, same-host clock.** Clients and gateway share the box. This is stated as a caveat, and it cuts the honest way: the server's *true* ceiling is higher than measured because the harness competes for CPU, and `now − T` latency is exact because there is no clock skew.

## Architecture

```
 bench/run.py  ──spawns──►  cmd/loadtest (Go)  ──N WS conns──►  gateway (docker)
 (orchestrator)              one load level,                      replay lane @ 10 Hz
   • sweeps levels           goroutine-per-client,
   • samples docker stats    measures (now − frame.T),
   • writes results.csv      prints one JSON row
   • renders results.png
```

The harness runs **one level per invocation** (single responsibility: hammer at N clients, report a row). The sweep, resource sampling, and plotting live in the orchestrator. This keeps the Go tool small and focused, and puts orchestration where Python is strongest.

### Component 1 — `cmd/loadtest` (Go): one load level

- **Flags (with defaults):**
  - `-url` (default `ws://localhost:8080/ws?session=replay`) — the replay lane runs continuously at 10 Hz.
  - `-clients N` (default 100) — number of concurrent WS connections.
  - `-duration 30s` — total run length.
  - `-ramp 5s` — connection dials are staggered evenly across this window to avoid a thundering-herd connect storm skewing results.
  - `-warmup 3s` — latency samples before this point (relative to run start, after ramp) are discarded so only steady-state is measured.
- Spawns N goroutines; each dials a WS connection (reuses `github.com/coder/websocket`, already in `go.mod`), then loops reading messages.
- For each message it unmarshals a minimal local envelope `{type, data}`. It **skips `snapshot`** (no `T` field) and, for each `frame`, unmarshals `data` into `model.Frame` and records `now − fr.T` (ms) into a histogram — but only once the steady-state window has begun.
- **Histogram:** fixed-bucket (1 ms buckets up to a few seconds, plus an overflow bucket), O(1) memory regardless of sample count — avoids storing 1M+ raw samples at high client counts. Yields p50/p95/p99/max.
- **Drop accounting:** a connection the server closes before the run's scheduled end counts as a drop (this is the gateway's backpressure valve in `internal/ws/client.go` firing — a real, intended signal, distinct from a dial failure, which is counted separately as a connect error).
- **Output:** one JSON object to stdout, e.g.
  `{"clients":2000,"connected":2000,"framesPerSec":19980,"p50":4,"p95":11,"p99":23,"max":140,"drops":0,"connectErrors":0}`
- Logs (progress, errors) go to stderr so stdout stays a clean single JSON line for the orchestrator to parse.

### Component 2 — `bench/run.py` (Python): the sweep + chart

- **Default levels:** `100, 500, 1000, 2000, 4000` (CLI-overridable). We find the knee and trim the top end to what the machine actually holds.
- **Per level:**
  1. Start a background `docker stats` sampler for the gateway container (`docker stats --no-stream --format '{{.CPUPerc}} {{.MemUsage}}'` polled a few times across the steady window).
  2. Run `cmd/loadtest` with the level's `-clients` (via `go run ./cmd/loadtest` or a prebuilt binary), capturing its stdout JSON row.
  3. Average the CPU%/mem samples; merge into the row.
  4. Append the row to `bench/results.csv`.
- **After the sweep:** render `bench/results.png` with matplotlib — latency percentiles (p50/p95/p99) and drop-rate vs client count on a shared x-axis (the knee-of-the-curve chart) — and print the markdown results table for pasting/embedding into `BENCHMARKS.md`.
- The gateway container name is discovered from `docker compose ps` (or passed as a flag) so the script is not pinned to a hardcoded name.

### `BENCHMARKS.md` structure

1. **Headline** — one sentence, e.g. "A single gateway sustained N concurrent WebSocket viewers at 10 Hz with p99 fan-out latency under X ms and zero dropped clients, on one developer laptop."
2. **Methodology** — what was run (replay lane @ 10 Hz, the sweep levels, duration/ramp/warmup), and the honest caveats (single machine; same-host clock; one gateway).
3. **Results table** — clients, connected, frames/s, p50/p95/p99/max latency (ms), drops, gateway CPU%, gateway mem.
4. **Chart** — embedded `results.png`.
5. **Interpretation** — a short "what the curve shows": where it stays flat, where the knee is, what dropped first (latency creep vs backpressure drops), and what the next scaling step would be (the multi-gateway tier the registry seam enables).

## Components / files

| File | Change |
|------|--------|
| `cmd/loadtest/main.go` | New: WS load harness — flags, goroutine-per-client, steady-state latency capture, JSON row out. |
| `cmd/loadtest/hist.go` | New: fixed-bucket latency histogram with percentile queries. |
| `cmd/loadtest/hist_test.go` | New: percentile math + envelope-frame → latency parse unit tests. |
| `bench/run.py` | New: sweep orchestrator, `docker stats` sampling, CSV writer, matplotlib chart. |
| `bench/requirements.txt` | New: `matplotlib`. |
| `bench/results.csv` | New (committed artifact): the measured rows. |
| `bench/results.png` | New (committed artifact): the load-curve chart. |
| `BENCHMARKS.md` | New: the write-up. |
| `README.md` | Add a one-line pointer to the benchmark headline / `BENCHMARKS.md`. |

No changes to any existing Go package, the gateway, the model, or the frontend — the harness is purely a new reader of the existing public contract.

## Testing

- **Go unit tests (pure, CI-friendly):**
  - Histogram: feed known latency values, assert p50/p95/p99/max land in the right buckets, including the overflow bucket and empty-histogram edge cases.
  - Latency parse: given an envelope JSON of `type:"frame"` with a known `T`, and an injected "now", assert the computed latency; assert a `type:"snapshot"` envelope is skipped (contributes no sample).
- **Manual benchmark run (not CI):** `docker compose up --build -d`, then `python bench/run.py`. Verify it produces `results.csv` with one row per level, a readable `results.png`, and a printed markdown table. Sanity-check that low levels show low, flat latency and that the curve degrades (latency climb and/or drops) at the top end. Trim the top level if the machine can't reach it.
- **Smoke (optional, local):** `go run ./cmd/loadtest -clients 5 -duration 3s` against a running stack prints a plausible JSON row (low latency, 5 connected, 0 drops).

## Risks / notes

- **Self-competition for CPU:** clients and gateway share one machine, so the harness steals CPU from the server. Consequence (stated in the write-up): the measured ceiling is a *lower bound* on the real one. Acceptable and honest for a no-hosting portfolio piece.
- **Clock:** `now − T` is only meaningful because harness and writer share a clock. True here (same host). If the harness were ever moved to another machine, this metric would need a clock-sync caveat — noted so the number is never misread.
- **High-N file descriptors on Windows:** thousands of WS connections from one process may hit OS handle limits. If the top level fails to fully connect, the harness reports `connected < clients` (visible, not silent), and the level is trimmed. No special tuning assumed.
- **`docker stats` format portability:** parsed defensively (split on whitespace, strip `%` and units); if a field is missing the row records CPU/mem as null rather than failing the whole sweep.
- **Benchmark numbers are machine- and run-specific.** The committed CSV/PNG are a snapshot of one run on the dev machine, clearly dated and captioned — not a claim of universal performance.

## Decomposition reminder

After this ships, the remaining M4 piece — README / demo-video polish — is brainstormed + planned separately. That piece can fold this benchmark's headline number into the README's scale story.
