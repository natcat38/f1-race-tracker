// Package ws is the gateway-side WebSocket fan-out hub.
package ws

import (
	"encoding/json"
	"fmt"

	"github.com/natcat38/f1-race-tracker/internal/model"
)

type envelope struct {
	Type string          `json:"type"` // "snapshot" | "frame"
	Data json.RawMessage `json:"data"`
}

func EncodeSnapshot(s *model.Snapshot) ([]byte, error) {
	d, err := json.Marshal(s)
	if err != nil {
		return nil, err
	}
	return json.Marshal(envelope{Type: "snapshot", Data: d})
}

func EncodeFrame(f model.Frame) ([]byte, error) {
	// A zero-value frame (Rev 0, no cars) is never a real broadcast — Rev 0 is the
	// "no frame yet" sentinel the hub's stale check assumes. Refuse it rather than
	// silently fan out an empty frame.
	if f.Rev == 0 && len(f.Cars) == 0 {
		return nil, fmt.Errorf("ws: refusing to encode zero-value frame")
	}
	d, err := json.Marshal(f)
	if err != nil {
		return nil, err
	}
	return json.Marshal(envelope{Type: "frame", Data: d})
}
