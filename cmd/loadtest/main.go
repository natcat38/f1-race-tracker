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
