# M4 (part 2): Load Test + Benchmark — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Go WebSocket load harness plus a Python sweep/plot orchestrator that measure how one gateway's fan-out latency, drop-rate, and CPU/memory behave as concurrent viewers climb, and publish the result as a committed `BENCHMARKS.md` with a load-curve chart.

**Architecture:** A new `cmd/loadtest` Go binary opens N concurrent WS connections (goroutine-per-client), measures end-to-end latency from each received frame's publish timestamp (`now − frame.T`), and prints one JSON row per load level. A Python orchestrator (`bench/run.py`) sweeps levels, samples `docker stats` for the gateway container, collects rows into `bench/results.csv`, and renders `bench/results.png` with matplotlib. No server-side code changes — the harness is a pure new reader of the existing WS contract.

**Tech Stack:** Go 1.26 (`github.com/coder/websocket` client, stdlib `sync/atomic`, `encoding/json`, `net/http/httptest` for tests); Python 3.11 (matplotlib, stdlib `subprocess`/`csv`/`re`); Docker Compose.

**Spec:** `docs/superpowers/specs/2026-06-19-f1-m4-loadtest-benchmark-design.md`

**Key facts the plan relies on:**
- Module path: `github.com/natcat38/f1-race-tracker`.
- The WS contract: every message is an envelope `{"type":"snapshot"|"frame","data":{...}}`. Only `frame` envelopes carry `model.Frame`, whose `T` field is publish wall-time in unix ms (`internal/feed/replay/play.go:119,157`). Latency = `now − T`.
- `model.Frame` is defined in `internal/model/model.go` and is importable.
- The replay lane publishes session `replay` at 10 Hz continuously, served at `ws://localhost:8080/ws?session=replay`.
- The server snapshot (first message) includes the full track polyline and can exceed `coder/websocket`'s default 32 KB read limit, so the client MUST raise the read limit.

---

## File Structure

| File | Responsibility |
|------|----------------|
| `cmd/loadtest/hist.go` | Fixed-bucket latency histogram (`latencyHist`): `Add`, `Merge`, `Percentile`, `Max`, `Count`. Pure, no I/O. |
| `cmd/loadtest/main.go` | Flags, the WS envelope + `parseFrameLatency`, `runClient`, `counters`, `result`, and `main()` orchestration (ramp, warmup/steady window, aggregate, emit JSON row). |
| `cmd/loadtest/hist_test.go` | Unit tests for the histogram, for `parseFrameLatency`, and an integration test for `runClient` against an `httptest` WS server. |
| `bench/run.py` | Sweep orchestrator: build the binary, loop levels, sample `docker stats`, write CSV, render the chart. Plus pure parsers `parse_cpu_perc` / `parse_mem_mb`. |
| `bench/run_test.py` | Pytest for the pure `docker stats` parsers. |
| `bench/requirements.txt` | `matplotlib`. |
| `bench/results.csv` | Committed artifact: one row per load level. |
| `bench/results.png` | Committed artifact: the load-curve chart. |
| `BENCHMARKS.md` | The write-up: headline, methodology, table, chart, interpretation. |
| `README.md` | Add a one-line pointer to `BENCHMARKS.md`. |

---

### Task 1: Latency histogram

**Files:**
- Create: `cmd/loadtest/hist.go`
- Test: `cmd/loadtest/hist_test.go`

- [ ] **Step 1: Write the failing test**

Create `cmd/loadtest/hist_test.go`:

```go
package main

import "testing"

func TestHist_PercentileAndMax(t *testing.T) {
	h := newHist()
	for i := int64(1); i <= 100; i++ {
		h.Add(i)
	}
	if got := h.Percentile(0.50); got != 50 {
		t.Errorf("p50 = %d, want 50", got)
	}
	if got := h.Percentile(0.99); got != 99 {
		t.Errorf("p99 = %d, want 99", got)
	}
	if got := h.Max(); got != 100 {
		t.Errorf("max = %d, want 100", got)
	}
	if got := h.Count(); got != 100 {
		t.Errorf("count = %d, want 100", got)
	}
}

func TestHist_EmptyIsZero(t *testing.T) {
	h := newHist()
	if got := h.Percentile(0.5); got != 0 {
		t.Errorf("empty p50 = %d, want 0", got)
	}
}

func TestHist_OverflowUsesCeilingButMaxIsTrue(t *testing.T) {
	h := newHist()
	h.Add(6000) // beyond histMaxMs
	if got := h.Percentile(0.99); got != histMaxMs {
		t.Errorf("overflow p99 = %d, want %d", got, histMaxMs)
	}
	if got := h.Max(); got != 6000 {
		t.Errorf("max = %d, want 6000 (true value preserved)", got)
	}
}

func TestHist_Merge(t *testing.T) {
	a, b := newHist(), newHist()
	a.Add(10)
	a.Add(20)
	b.Add(30)
	a.Merge(b)
	if got := a.Count(); got != 3 {
		t.Errorf("merged count = %d, want 3", got)
	}
	if got := a.Max(); got != 30 {
		t.Errorf("merged max = %d, want 30", got)
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `go test ./cmd/loadtest/ -run TestHist -v`
Expected: FAIL — `undefined: newHist` (package doesn't compile yet).

- [ ] **Step 3: Write minimal implementation**

Create `cmd/loadtest/hist.go`:

```go
package main

import "math"

// histMaxMs is the upper bound (exclusive) of the 1ms-wide buckets. Latencies at
// or above it land in an overflow bucket; the true maximum is still tracked.
const histMaxMs = 5000

// latencyHist is a fixed-bucket histogram of latency in milliseconds. Memory is
// O(histMaxMs) regardless of sample count, so it scales to millions of frames.
type latencyHist struct {
	buckets []int64 // buckets[i] = number of samples with latency == i ms
	over    int64   // samples >= histMaxMs
	count   int64
	max     int64
}

func newHist() *latencyHist {
	return &latencyHist{buckets: make([]int64, histMaxMs)}
}

// Add records one latency sample (negative values are clamped to 0).
func (h *latencyHist) Add(ms int64) {
	if ms < 0 {
		ms = 0
	}
	if ms > h.max {
		h.max = ms
	}
	h.count++
	if ms >= histMaxMs {
		h.over++
		return
	}
	h.buckets[ms]++
}

// Merge folds another histogram into this one (used to combine per-client hists).
func (h *latencyHist) Merge(o *latencyHist) {
	for i, c := range o.buckets {
		h.buckets[i] += c
	}
	h.over += o.over
	h.count += o.count
	if o.max > h.max {
		h.max = o.max
	}
}

// Percentile returns the smallest latency (ms) at or below which fraction q of
// samples fall. Returns 0 for an empty histogram; returns histMaxMs when the
// rank falls in the overflow bucket (a floor — see Max for the true peak).
func (h *latencyHist) Percentile(q float64) int64 {
	if h.count == 0 {
		return 0
	}
	rank := int64(math.Ceil(q * float64(h.count)))
	if rank < 1 {
		rank = 1
	}
	if rank > h.count {
		rank = h.count
	}
	var cum int64
	for ms, c := range h.buckets {
		cum += c
		if cum >= rank {
			return int64(ms)
		}
	}
	return histMaxMs
}

func (h *latencyHist) Max() int64   { return h.max }
func (h *latencyHist) Count() int64 { return h.count }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `go test ./cmd/loadtest/ -run TestHist -v`
Expected: PASS (all four tests).

- [ ] **Step 5: Commit**

```bash
git add cmd/loadtest/hist.go cmd/loadtest/hist_test.go
git commit -m "feat(loadtest): fixed-bucket latency histogram"
```

---

### Task 2: Parse frame latency from the WS envelope

**Files:**
- Modify: `cmd/loadtest/main.go` (create the file with the envelope + parser; `main()` comes in Task 4)
- Test: `cmd/loadtest/hist_test.go` (append)

- [ ] **Step 1: Write the failing test**

Append to `cmd/loadtest/hist_test.go`:

```go
import (
	"encoding/json"
	"github.com/natcat38/f1-race-tracker/internal/model"
)

func envFrame(t *testing.T, tMs int64) []byte {
	t.Helper()
	d, _ := json.Marshal(model.Frame{T: tMs})
	b, _ := json.Marshal(wsEnvelope{Type: "frame", Data: d})
	return b
}

func TestParseFrameLatency_FrameYieldsLatency(t *testing.T) {
	raw := envFrame(t, 1000)
	lat, ok := parseFrameLatency(raw, 1050)
	if !ok || lat != 50 {
		t.Errorf("got (%d,%v), want (50,true)", lat, ok)
	}
}

func TestParseFrameLatency_SnapshotSkipped(t *testing.T) {
	b, _ := json.Marshal(wsEnvelope{Type: "snapshot", Data: json.RawMessage(`{}`)})
	if _, ok := parseFrameLatency(b, 1050); ok {
		t.Error("snapshot envelope should not yield a latency sample")
	}
}

func TestParseFrameLatency_GarbageSkipped(t *testing.T) {
	if _, ok := parseFrameLatency([]byte("not json"), 1050); ok {
		t.Error("malformed input should not yield a sample")
	}
}

func TestParseFrameLatency_MissingTSkipped(t *testing.T) {
	if _, ok := parseFrameLatency(envFrame(t, 0), 1050); ok {
		t.Error("a frame with T==0 should not yield a sample")
	}
}
```

Note: the existing `import "testing"` at the top of `hist_test.go` must be merged into this import block (Go allows only one import per file — fold `testing` in with the two above).

- [ ] **Step 2: Run test to verify it fails**

Run: `go test ./cmd/loadtest/ -run TestParseFrameLatency -v`
Expected: FAIL — `undefined: wsEnvelope` / `undefined: parseFrameLatency`.

- [ ] **Step 3: Write minimal implementation**

Create `cmd/loadtest/main.go`:

```go
// Command loadtest opens many concurrent WebSocket connections to the gateway and
// measures end-to-end fan-out latency (now - frame.T) per received frame.
package main

import (
	"encoding/json"

	"github.com/natcat38/f1-race-tracker/internal/model"
)

// wsEnvelope mirrors the gateway's outbound message shape: {"type","data"}.
type wsEnvelope struct {
	Type string          `json:"type"`
	Data json.RawMessage `json:"data"`
}

// parseFrameLatency returns nowMs - frame.T for a "frame" envelope. ok is false
// for snapshots, malformed input, or a frame missing its publish timestamp (T==0).
func parseFrameLatency(raw []byte, nowMs int64) (int64, bool) {
	var env wsEnvelope
	if err := json.Unmarshal(raw, &env); err != nil {
		return 0, false
	}
	if env.Type != "frame" {
		return 0, false
	}
	var fr model.Frame
	if err := json.Unmarshal(env.Data, &fr); err != nil {
		return 0, false
	}
	if fr.T == 0 {
		return 0, false
	}
	return nowMs - fr.T, true
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `go test ./cmd/loadtest/ -run TestParseFrameLatency -v`
Expected: PASS (all four tests).

- [ ] **Step 5: Commit**

```bash
git add cmd/loadtest/main.go cmd/loadtest/hist_test.go
git commit -m "feat(loadtest): parse fan-out latency from frame envelopes"
```

---

### Task 3: `runClient` — one connection that records latency

**Files:**
- Modify: `cmd/loadtest/main.go` (add `counters` + `runClient`)
- Test: `cmd/loadtest/hist_test.go` (append integration tests against a fake WS server)

- [ ] **Step 1: Write the failing test**

Append to `cmd/loadtest/hist_test.go` (add `net/http`, `net/http/httptest`, `strings`, `time`, `context`, and `github.com/coder/websocket` to the import block):

```go
func wsURL(s string) string { return "ws" + strings.TrimPrefix(s, "http") }

// fakeServer sends one snapshot then `n` frames stamped with the current time,
// then blocks until the client disconnects.
func fakeServer(n int) *httptest.Server {
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		c, err := websocket.Accept(w, r, &websocket.AcceptOptions{InsecureSkipVerify: true})
		if err != nil {
			return
		}
		defer c.CloseNow()
		ctx := r.Context()
		snap, _ := json.Marshal(wsEnvelope{Type: "snapshot", Data: json.RawMessage(`{}`)})
		_ = c.Write(ctx, websocket.MessageText, snap)
		for i := 0; i < n; i++ {
			d, _ := json.Marshal(model.Frame{T: timeNowMs()})
			env, _ := json.Marshal(wsEnvelope{Type: "frame", Data: d})
			if err := c.Write(ctx, websocket.MessageText, env); err != nil {
				return
			}
			time.Sleep(5 * time.Millisecond)
		}
		<-ctx.Done()
	}))
}

func TestRunClient_RecordsFramesAfterSteadyStart(t *testing.T) {
	srv := fakeServer(5)
	defer srv.Close()
	h := newHist()
	ctr := &counters{}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	runClient(ctx, wsURL(srv.URL), time.Now().Add(-time.Second), h, ctr) // steadyStart in the past
	if ctr.connected.Load() != 1 {
		t.Errorf("connected = %d, want 1", ctr.connected.Load())
	}
	if h.Count() < 1 {
		t.Error("expected at least one latency sample recorded")
	}
}

// A server that closes immediately should be counted as a drop, not a clean exit.
func TestRunClient_ServerCloseCountsAsDrop(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		c, err := websocket.Accept(w, r, &websocket.AcceptOptions{InsecureSkipVerify: true})
		if err != nil {
			return
		}
		c.CloseNow() // drop the client right away
	}))
	defer srv.Close()
	h := newHist()
	ctr := &counters{}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	runClient(ctx, wsURL(srv.URL), time.Now(), h, ctr)
	if ctr.drops.Load() != 1 {
		t.Errorf("drops = %d, want 1", ctr.drops.Load())
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `go test ./cmd/loadtest/ -run TestRunClient -v`
Expected: FAIL — `undefined: counters` / `undefined: runClient` / `undefined: timeNowMs`.

- [ ] **Step 3: Write minimal implementation**

Add to `cmd/loadtest/main.go` (extend the import block to include `context`, `sync/atomic`, `time`, and `github.com/coder/websocket`):

```go
// counters are the run-wide tallies shared across all client goroutines.
type counters struct {
	connected     atomic.Int64
	drops         atomic.Int64
	connectErrors atomic.Int64
	frames        atomic.Int64
}

func timeNowMs() int64 { return time.Now().UnixMilli() }

// runClient dials url and reads messages until ctx ends or the server closes.
// Frame latencies are recorded into hist only once steadyStart has passed. A
// server-side close before ctx ends counts as a drop (the gateway's backpressure
// valve); a dial failure counts as a connect error.
func runClient(ctx context.Context, url string, steadyStart time.Time, hist *latencyHist, ctr *counters) {
	c, _, err := websocket.Dial(ctx, url, nil)
	if err != nil {
		ctr.connectErrors.Add(1)
		return
	}
	defer c.CloseNow()
	c.SetReadLimit(1 << 20) // the snapshot (full track polyline) exceeds the 32KB default
	ctr.connected.Add(1)
	for {
		_, data, err := c.Read(ctx)
		if err != nil {
			if ctx.Err() == nil {
				ctr.drops.Add(1) // server closed us before the run's deadline
			}
			return
		}
		if time.Now().Before(steadyStart) {
			continue // still warming up; don't pollute the measurement window
		}
		if lat, ok := parseFrameLatency(data, timeNowMs()); ok {
			hist.Add(lat)
			ctr.frames.Add(1)
		}
	}
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `go test ./cmd/loadtest/ -run TestRunClient -v`
Expected: PASS (both tests).

- [ ] **Step 5: Commit**

```bash
git add cmd/loadtest/main.go cmd/loadtest/hist_test.go
git commit -m "feat(loadtest): per-connection client with latency + drop accounting"
```

---

### Task 4: `main()` — flags, ramp, steady window, aggregate, emit JSON row

**Files:**
- Modify: `cmd/loadtest/main.go` (add `result` + `main()`)

- [ ] **Step 1: Add the result type and main()**

Append to `cmd/loadtest/main.go` (extend the import block to include `flag`, `fmt`, `os`, `sync`):

```go
// result is the single JSON row the harness prints for one load level.
type result struct {
	Clients       int   `json:"clients"`
	Connected     int64 `json:"connected"`
	FramesPerSec  int64 `json:"framesPerSec"`
	P50           int64 `json:"p50"`
	P95           int64 `json:"p95"`
	P99           int64 `json:"p99"`
	Max           int64 `json:"max"`
	Drops         int64 `json:"drops"`
	ConnectErrors int64 `json:"connectErrors"`
}

func main() {
	url := flag.String("url", "ws://localhost:8080/ws?session=replay", "gateway WebSocket URL")
	clients := flag.Int("clients", 100, "number of concurrent connections")
	duration := flag.Duration("duration", 30*time.Second, "total run length")
	ramp := flag.Duration("ramp", 5*time.Second, "window over which dials are staggered")
	warmup := flag.Duration("warmup", 3*time.Second, "post-ramp warmup excluded from measurement")
	flag.Parse()

	start := time.Now()
	end := start.Add(*duration)
	steadyStart := start.Add(*ramp + *warmup)
	ctx, cancel := context.WithDeadline(context.Background(), end)
	defer cancel()

	ctr := &counters{}
	hists := make([]*latencyHist, *clients)
	var wg sync.WaitGroup
	var stagger time.Duration
	if *clients > 0 {
		stagger = *ramp / time.Duration(*clients)
	}
	for i := 0; i < *clients; i++ {
		hists[i] = newHist()
		wg.Add(1)
		go func(h *latencyHist) {
			defer wg.Done()
			runClient(ctx, *url, steadyStart, h, ctr)
		}(hists[i])
		time.Sleep(stagger)
	}
	wg.Wait()

	merged := newHist()
	for _, h := range hists {
		merged.Merge(h)
	}
	steadySecs := end.Sub(steadyStart).Seconds()
	if steadySecs <= 0 {
		steadySecs = 1
	}
	res := result{
		Clients:       *clients,
		Connected:     ctr.connected.Load(),
		FramesPerSec:  int64(float64(ctr.frames.Load()) / steadySecs),
		P50:           merged.Percentile(0.50),
		P95:           merged.Percentile(0.95),
		P99:           merged.Percentile(0.99),
		Max:           merged.Max(),
		Drops:         ctr.drops.Load(),
		ConnectErrors: ctr.connectErrors.Load(),
	}
	b, _ := json.Marshal(res)
	fmt.Println(string(b)) // stdout: one clean JSON row for the orchestrator
	fmt.Fprintf(os.Stderr, "loadtest: %d/%d connected, %d frames, p50=%d p99=%d max=%dms, %d drops, %d connErr\n",
		res.Connected, res.Clients, ctr.frames.Load(), res.P50, res.P99, res.Max, res.Drops, res.ConnectErrors)
}
```

- [ ] **Step 2: Verify the whole package builds and unit tests still pass**

Run: `go build ./cmd/loadtest/ && go test ./cmd/loadtest/ -v`
Expected: build succeeds; all Task 1–3 tests PASS.

- [ ] **Step 3: Run `go vet`**

Run: `go vet ./cmd/loadtest/`
Expected: no output (clean).

- [ ] **Step 4: Manual smoke against a running stack (optional but recommended)**

```bash
docker compose up --build -d
go run ./cmd/loadtest -clients 5 -duration 6s -ramp 1s -warmup 1s
```
Expected: a JSON line like `{"clients":5,"connected":5,"framesPerSec":50,"p50":..,"p95":..,"p99":..,"max":..,"drops":0,"connectErrors":0}` with low single/double-digit latency and 0 drops. (Leave the stack up for Task 6, or `docker compose down -v` to stop.)

- [ ] **Step 5: Commit**

```bash
git add cmd/loadtest/main.go
git commit -m "feat(loadtest): main() — ramp, steady window, aggregate, JSON row"
```

---

### Task 5: Python sweep orchestrator + chart

**Files:**
- Create: `bench/run.py`
- Create: `bench/run_test.py`
- Create: `bench/requirements.txt`

- [ ] **Step 1: Write the failing test for the pure parsers**

Create `bench/run_test.py`:

```python
from run import parse_cpu_perc, parse_mem_mb


def test_parse_cpu_perc():
    assert parse_cpu_perc("35.20%") == 35.2
    assert parse_cpu_perc("0.00%") == 0.0
    assert parse_cpu_perc("n/a") is None


def test_parse_mem_mb():
    assert parse_mem_mb("180MiB / 7.6GiB") == 180.0
    assert parse_mem_mb("1.5GiB / 7.6GiB") == 1536.0
    assert parse_mem_mb("512KiB / 7.6GiB") == 0.5
    assert parse_mem_mb("garbage") is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd bench && python -m pytest run_test.py -v`
Expected: FAIL — `ModuleNotFoundError`/`ImportError` (run.py not created yet).

- [ ] **Step 3: Write the implementation**

Create `bench/requirements.txt`:

```
matplotlib
pytest
```

Create `bench/run.py`:

```python
#!/usr/bin/env python3
"""Sweep WebSocket load levels against the gateway, sample docker stats for the
gateway container, write bench/results.csv, and render bench/results.png.

Usage:
    python bench/run.py --levels 100,500,1000,2000 --duration 30s
Assumes `docker compose up -d` is already running (redis + replay + gateway).
"""
import argparse
import csv
import json
import re
import subprocess
import sys
import threading
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent

_MEM_FACTORS = {
    "B": 1 / 1024 / 1024, "KiB": 1 / 1024, "MiB": 1.0, "GiB": 1024.0,
    "KB": 1 / 1024, "MB": 1.0, "GB": 1024.0,
}


def parse_cpu_perc(s: str):
    """'35.20%' -> 35.2; returns None if no percentage is present."""
    m = re.search(r"([\d.]+)\s*%", s)
    return float(m.group(1)) if m else None


def parse_mem_mb(s: str):
    """'180MiB / 7.6GiB' -> 180.0 (used side, in MiB). None if unparseable."""
    used = s.split("/")[0].strip()
    m = re.match(r"([\d.]+)\s*([KMG]?i?B)", used)
    if not m:
        return None
    val, unit = float(m.group(1)), m.group(2)
    factor = _MEM_FACTORS.get(unit)
    return val * factor if factor is not None else None


def discover_container(service: str) -> str:
    out = subprocess.run(
        ["docker", "compose", "ps", "-q", service],
        cwd=REPO, capture_output=True, text=True,
    ).stdout.strip()
    if not out:
        sys.exit(f"could not find a running container for compose service '{service}'. "
                 f"Run `docker compose up -d` first.")
    return out.splitlines()[0]


class StatsSampler(threading.Thread):
    """Polls `docker stats --no-stream` for one container until stopped."""

    def __init__(self, container: str):
        super().__init__(daemon=True)
        self.container = container
        self._stop = threading.Event()
        self.cpu = []
        self.mem = []

    def run(self):
        while not self._stop.is_set():
            out = subprocess.run(
                ["docker", "stats", "--no-stream", "--format",
                 "{{.CPUPerc}};{{.MemUsage}}", self.container],
                capture_output=True, text=True,
            ).stdout.strip()
            if ";" in out:
                cpu_s, mem_s = out.split(";", 1)
                c, m = parse_cpu_perc(cpu_s), parse_mem_mb(mem_s)
                if c is not None:
                    self.cpu.append(c)
                if m is not None:
                    self.mem.append(m)
            self._stop.wait(2.0)

    def stop(self):
        self._stop.set()
        self.join(timeout=5)

    def avg(self):
        cpu = round(sum(self.cpu) / len(self.cpu), 1) if self.cpu else None
        mem = round(sum(self.mem) / len(self.mem), 1) if self.mem else None
        return cpu, mem


def build_loadtest() -> Path:
    exe = HERE / ("loadtest.exe" if sys.platform == "win32" else "loadtest")
    print(f"building {exe.name} ...")
    subprocess.run(["go", "build", "-o", str(exe), "./cmd/loadtest"],
                   cwd=REPO, check=True)
    return exe


def run_level(exe: Path, url: str, clients: int, duration: str,
              ramp: str, warmup: str, container: str) -> dict:
    sampler = StatsSampler(container)
    sampler.start()
    proc = subprocess.run(
        [str(exe), "-url", url, "-clients", str(clients),
         "-duration", duration, "-ramp", ramp, "-warmup", warmup],
        cwd=REPO, capture_output=True, text=True,
    )
    sampler.stop()
    if proc.stderr:
        print(proc.stderr.strip(), file=sys.stderr)
    row = json.loads(proc.stdout.strip().splitlines()[-1])
    cpu, mem = sampler.avg()
    row["cpuPerc"] = cpu
    row["memMB"] = mem
    return row


FIELDS = ["clients", "connected", "framesPerSec", "p50", "p95", "p99", "max",
          "drops", "connectErrors", "cpuPerc", "memMB"]


def write_csv(rows, path: Path):
    with path.open("w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=FIELDS)
        w.writeheader()
        for r in rows:
            w.writerow({k: r.get(k) for k in FIELDS})
    print(f"wrote {path}")


def render_chart(rows, path: Path):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    xs = [r["clients"] for r in rows]
    fig, ax1 = plt.subplots(figsize=(8, 5))
    ax1.set_xlabel("concurrent WebSocket clients")
    ax1.set_ylabel("fan-out latency (ms)")
    ax1.plot(xs, [r["p50"] for r in rows], "-o", label="p50")
    ax1.plot(xs, [r["p95"] for r in rows], "-o", label="p95")
    ax1.plot(xs, [r["p99"] for r in rows], "-o", label="p99")
    ax1.legend(loc="upper left")
    ax1.grid(True, alpha=0.3)

    ax2 = ax1.twinx()
    ax2.set_ylabel("dropped connections")
    ax2.bar(xs, [r["drops"] for r in rows], width=max(xs) * 0.03,
            alpha=0.25, color="red", label="drops")

    plt.title("F1 Race Tracker — gateway fan-out latency vs concurrent clients")
    fig.tight_layout()
    fig.savefig(path, dpi=120)
    print(f"wrote {path}")


def print_markdown_table(rows):
    print("\n| clients | connected | frames/s | p50 | p95 | p99 | max | drops | CPU% | mem MB |")
    print("|--------:|----------:|---------:|----:|----:|----:|----:|------:|-----:|-------:|")
    for r in rows:
        print(f"| {r['clients']} | {r['connected']} | {r['framesPerSec']} | "
              f"{r['p50']} | {r['p95']} | {r['p99']} | {r['max']} | {r['drops']} | "
              f"{r.get('cpuPerc')} | {r.get('memMB')} |")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--levels", default="100,500,1000,2000,4000")
    ap.add_argument("--url", default="ws://localhost:8080/ws?session=replay")
    ap.add_argument("--duration", default="30s")
    ap.add_argument("--ramp", default="5s")
    ap.add_argument("--warmup", default="3s")
    ap.add_argument("--service", default="gateway", help="compose service name of the gateway")
    args = ap.parse_args()

    levels = [int(x) for x in args.levels.split(",") if x.strip()]
    container = discover_container(args.service)
    exe = build_loadtest()

    rows = []
    for n in levels:
        print(f"\n=== load level: {n} clients ===")
        row = run_level(exe, args.url, n, args.duration, args.ramp, args.warmup, container)
        print(f"  -> p50={row['p50']} p99={row['p99']} max={row['max']} "
              f"drops={row['drops']} cpu={row.get('cpuPerc')}% mem={row.get('memMB')}MB")
        rows.append(row)

    write_csv(rows, HERE / "results.csv")
    render_chart(rows, HERE / "results.png")
    print_markdown_table(rows)


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd bench && python -m pytest run_test.py -v`
Expected: PASS (both parser tests). Install deps first if needed: `pip install -r requirements.txt`.

- [ ] **Step 5: Commit**

```bash
git add bench/run.py bench/run_test.py bench/requirements.txt
git commit -m "feat(bench): python sweep orchestrator + docker-stats sampling + chart"
```

---

### Task 6: Run the sweep, write BENCHMARKS.md, commit artifacts

**Files:**
- Create: `BENCHMARKS.md`
- Create: `bench/results.csv` (generated)
- Create: `bench/results.png` (generated)
- Modify: `README.md`

- [ ] **Step 1: Bring the stack up and run the sweep**

```bash
docker compose up --build -d
pip install -r bench/requirements.txt
python bench/run.py --levels 100,500,1000,2000,4000 --duration 30s
```
Expected: one `=== load level ===` block per level, then `wrote bench/results.csv`, `wrote bench/results.png`, and a printed markdown table.

If the top level shows `connected` far below `clients` or the machine thrashes, re-run with a trimmed ceiling (e.g. `--levels 100,500,1000,2000`). Record the levels that actually completed. Capture the printed markdown table for Step 2.

- [ ] **Step 2: Write BENCHMARKS.md using the real numbers**

Create `BENCHMARKS.md`. Replace every `<...>` with the actual figures from the sweep (the headline uses the highest level that held with zero drops; the methodology states the real levels run):

```markdown
# F1 Race Tracker — Benchmark

**Headline:** A single gateway sustained **<N>** concurrent WebSocket viewers at 10 Hz with **p99 fan-out latency of <X> ms** and **<D> dropped clients**, on one developer laptop.

Fan-out latency is the full journey of one frame: writer emit → Redis publish → gateway consume → in-memory hub fan-out → WebSocket write → client receive. It is measured client-side as `now − frame.T`, where `frame.T` is the publish wall-time stamped by the writer (`internal/feed/replay/play.go`).

## Method

- **What's under load:** one `gateway` process fanning out the `replay` session (Monza, 10 Hz) over WebSockets. Load is generated by `cmd/loadtest` (Go, one goroutine per connection).
- **Sweep:** <levels> concurrent clients; <duration> per level, <ramp> dial ramp, <warmup> warmup excluded from measurement.
- **Measured:** end-to-end fan-out latency percentiles (p50/p95/p99/max), aggregate frames/s received, dropped connections (the gateway's backpressure valve closing a slow client), and the gateway container's average CPU% / memory (`docker stats`).
- **Run on:** <CPU / cores / RAM / OS>, Docker Compose, <date>.

### Honest caveats

- **Single machine.** The load generator and the gateway share one box, so the harness steals CPU from the server. The real ceiling is therefore **higher** than the number above — this is a lower bound.
- **Same-host clock.** Client and server share a clock, which is *why* `now − T` latency is exact (no clock skew to correct for). Moving the harness to another host would require clock-sync handling.
- **One gateway.** No multi-gateway tier was built. The `/ws?session=<key>` hub registry + Redis pub/sub seam are what would make fan-out horizontal; scaling that out is future work.

## Results

<paste the markdown table printed by bench/run.py>

![Fan-out latency vs concurrent clients](bench/results.png)

## What the curve shows

<2–4 sentences: where latency stays flat, where the knee is, whether degradation showed up first as latency creep or as backpressure drops, and what the next scaling step (a second gateway behind a load balancer) would buy.>
```

- [ ] **Step 3: Add a README pointer**

In `README.md`, add a line near the top (under the project tagline / features) — match the surrounding markdown style:

```markdown
**Benchmark:** one gateway sustained <N> concurrent WebSocket viewers at 10 Hz, p99 fan-out latency <X> ms — see [BENCHMARKS.md](BENCHMARKS.md).
```

- [ ] **Step 4: Verify the artifacts exist and open cleanly**

Run: `git status --short bench/ BENCHMARKS.md`
Expected: `bench/results.csv`, `bench/results.png`, and `BENCHMARKS.md` show as new/modified. Open `bench/results.png` to confirm it's a readable chart and `BENCHMARKS.md` has no remaining `<...>` placeholders.

- [ ] **Step 5: Tear down the stack and commit**

```bash
docker compose down -v
git add BENCHMARKS.md bench/results.csv bench/results.png README.md
git commit -m "docs(bench): load-test results, curve chart, and benchmark write-up"
```

---

## Notes for the executor

- **`.gitignore`:** the built `bench/loadtest` / `bench/loadtest.exe` binary should not be committed. If the repo's `.gitignore` doesn't already cover it, add `bench/loadtest` and `bench/loadtest.exe` before the Task 6 commit (do **not** ignore `bench/results.*` — those are deliverables).
- **Determinism of numbers:** the committed CSV/PNG are one dated snapshot from the dev machine, not a universal claim — the write-up says so. Re-running will produce slightly different figures; that's expected.
- **Windows shell:** commands above are POSIX (use the Bash tool). `docker compose`, `go`, and `python` all work the same; the built binary is `loadtest.exe` on Windows (handled by `run.py`).
```
