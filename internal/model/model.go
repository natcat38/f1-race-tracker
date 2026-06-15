// Package model is the normalised contract shared by every layer (and, later, Python).
package model

type Point struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
}

type CarState struct {
	DriverNum int    `json:"driverNum"`
	Code      string `json:"code"` // "VER"
	Team      string `json:"team"`
	Pos       int    `json:"pos"`            // running order
	P         Point  `json:"p"`              // track-space coordinate, scaled to [0,1]
	Status    string `json:"status"`         // "OnTrack" | "Pit" | "Out"
	Tyre      string `json:"tyre,omitempty"` // Phase 2
	Speed     int    `json:"speed,omitempty"`
}

type RaceControlMessage struct {
	Rev      int64  `json:"rev"`
	T        int64  `json:"t"`
	Category string `json:"category"`
	Message  string `json:"message"`
	Driver   *int   `json:"driver,omitempty"`
}

type Snapshot struct {
	SessionKey string               `json:"session"`
	Mode       string               `json:"mode"`  // "live" | "replay"
	Label      string               `json:"label"` // "Synthetic · Demo"
	Track      []Point              `json:"track,omitempty"`
	Cars       map[int]CarState     `json:"cars"`
	Messages   []RaceControlMessage `json:"messages,omitempty"`
	TimeMs     int64                `json:"timeMs"`
	Rev        int64                `json:"rev"`
}

type Frame struct {
	SessionKey string               `json:"session"`
	Rev        int64                `json:"rev"`
	T          int64                `json:"t"`      // publish wall-time, unix ms
	TimeMs     int64                `json:"timeMs"` // session clock
	Cars       []CarState           `json:"cars"`
	Messages   []RaceControlMessage `json:"messages,omitempty"`
}

// NewSnapshot returns an empty snapshot ready to receive frames.
func NewSnapshot(session, mode, label string) *Snapshot {
	return &Snapshot{SessionKey: session, Mode: mode, Label: label, Cars: make(map[int]CarState)}
}
