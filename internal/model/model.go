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
	Tyre      string `json:"tyre,omitempty"` // Phase 2: compound, e.g. "SOFT"
	TyreAge   int    `json:"tyreAge,omitempty"`
	LastLapMs int    `json:"lastLapMs,omitempty"`
	BestLapMs int    `json:"bestLapMs,omitempty"`
	S1Ms      int    `json:"s1Ms,omitempty"`
	S2Ms      int    `json:"s2Ms,omitempty"`
	S3Ms      int    `json:"s3Ms,omitempty"`
	GapMs     int    `json:"gapMs,omitempty"`   // to leader; best-effort, derived at record time
	GapLaps   int    `json:"gapLaps,omitempty"` // whole laps behind leader; FE shows "+1 LAP" when >= 1
	IntMs     int    `json:"intMs,omitempty"`   // interval to car ahead; best-effort
	Speed     int    `json:"speed,omitempty"`
	Gear      int    `json:"gear,omitempty"`
	Throttle  int    `json:"throttle,omitempty"` // 0-100
	Brake     int    `json:"brake,omitempty"`    // 0-100
	DRS       bool   `json:"drs,omitempty"`
}

type RaceControlMessage struct {
	Rev      int64  `json:"rev"`
	T        int64  `json:"t"`
	Category string `json:"category"`
	Message  string `json:"message"`
	Driver   *int   `json:"driver,omitempty"`
}

type RadioMessage struct {
	TimeMs    int64  `json:"timeMs"`    // session clock at which the team radio occurred
	DriverNum int    `json:"driverNum"` // FE derives code/team/colour from the cars map
	Clip      string `json:"clip"`      // full https URL to the .mp3 on livetiming.formula1.com
}

type Snapshot struct {
	SessionKey string               `json:"session"`
	Mode       string               `json:"mode"`  // "live" | "replay"
	Label      string               `json:"label"` // "Synthetic · Demo"
	Track      []Point              `json:"track,omitempty"`
	Cars       map[int]CarState     `json:"cars"`
	Messages   []RaceControlMessage `json:"messages,omitempty"`
	Radio      []RadioMessage       `json:"radio,omitempty"`
	LapTrace   map[int][]int        `json:"lapTrace,omitempty"`
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
