// Command loadtest opens many concurrent WebSocket connections to the gateway and
// measures end-to-end fan-out latency (now - frame.T) per received frame.
package main

import (
	"context"
	"encoding/json"
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
