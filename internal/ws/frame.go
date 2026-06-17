// Package ws is the gateway-side WebSocket fan-out hub.
package ws

import (
	"encoding/json"

	"github.com/natcat38/f1-race-tracker/internal/model"
)

type envelope struct {
	Type string          `json:"type"` // "snapshot" | "frame"
	Data json.RawMessage `json:"data"`
}

func encodeSnapshot(s *model.Snapshot) ([]byte, error) {
	d, err := json.Marshal(s)
	if err != nil {
		return nil, err
	}
	return json.Marshal(envelope{Type: "snapshot", Data: d})
}

func encodeFrame(f model.Frame) ([]byte, error) {
	d, err := json.Marshal(f)
	if err != nil {
		return nil, err
	}
	return json.Marshal(envelope{Type: "frame", Data: d})
}
