// Command loadtest opens many concurrent WebSocket connections to the gateway and
// measures end-to-end fan-out latency (now - frame.T) per received frame.
package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"sync"
	"sync/atomic"
	"time"

	"github.com/coder/websocket"
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
