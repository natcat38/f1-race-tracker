// The wire types — CarState, Snapshot, Frame — that every layer serialises and parses.

// Package model is the normalised contract shared by every layer (and, later, Python).
package model

type Point struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
}

// CarStatus is the small closed set of values CarState.Status carries.
type CarStatus string

const (
	StatusOnTrack CarStatus = "OnTrack"
	StatusPit     CarStatus = "Pit"
	StatusOut     CarStatus = "Out"
)

type CarState struct {
	DriverNum int       `json:"driverNum"`
	Code      string    `json:"code"` // "VER"
	Team      string    `json:"team"`
	Pos       int       `json:"pos"` // running order
	Lap       int       `json:"lap"` // this car's current lap number; always meaningful (0 is a real value, e.g. before lap 1), so no omitempty
	P         Point     `json:"p"`   // track-space coordinate, scaled to [0,1]
	Status    CarStatus `json:"status"`
	Tyre      string    `json:"tyre,omitempty"` // Phase 2: compound, e.g. "SOFT"
	TyreAge   int       `json:"tyreAge,omitempty"`
	LastLapMs int       `json:"lastLapMs,omitempty"`
	BestLapMs int       `json:"bestLapMs,omitempty"`
	S1Ms      int       `json:"s1Ms,omitempty"`
	S2Ms      int       `json:"s2Ms,omitempty"`
	S3Ms      int       `json:"s3Ms,omitempty"`
	GapMs     int       `json:"gapMs,omitempty"`   // to leader; best-effort, derived at record time
	GapLaps   int       `json:"gapLaps,omitempty"` // whole laps behind leader; FE shows "+1 LAP" when >= 1
	IntMs     int       `json:"intMs,omitempty"`   // interval to car ahead; best-effort
	Speed     int       `json:"speed,omitempty"`
	Gear      int       `json:"gear,omitempty"`
	Throttle  int       `json:"throttle,omitempty"` // 0-100
	Brake     int       `json:"brake,omitempty"`    // 0-100
	DRS       bool      `json:"drs,omitempty"`
}

type RaceControlMessage struct {
	Rev      int64  `json:"rev"`
	T        int64  `json:"t"` // session-relative ms (mirrors Frame.TimeMs) — NOT wall-clock like Frame.T
	Category string `json:"category"`
	Message  string `json:"message"`
	Driver   *int   `json:"driver,omitempty"`
}

type RadioMessage struct {
	TimeMs    int64  `json:"timeMs"`    // session clock at which the team radio occurred
	DriverNum int    `json:"driverNum"` // FE derives code/team/colour from the cars map
	Clip      string `json:"clip"`      // full https URL to the .mp3 on livetiming.formula1.com
}

// Stint is one tyre stint from the full-race lap data (session-constant, like LapTrace).
type Stint struct {
	Compound string `json:"compound"` // "SOFT"|"MEDIUM"|"HARD"|"INTERMEDIATE"|"WET"
	StartLap int    `json:"startLap"`
	EndLap   int    `json:"endLap"`
}

// Weather is a low-rate sample (~1/min at bake). Rides on a frame when it
// changes; folded into the snapshot by Apply.
type Weather struct {
	AirTempC   float64 `json:"airTempC"`
	TrackTempC float64 `json:"trackTempC"`
	Rainfall   bool    `json:"rainfall"`
}

// Mode is the small closed set of values Snapshot.Mode carries.
type Mode string

const (
	ModeLive   Mode = "live"
	ModeReplay Mode = "replay"
)

type Snapshot struct {
	SessionKey string               `json:"session"`
	Mode       Mode                 `json:"mode"`
	Label      string               `json:"label"` // "Synthetic · Demo"
	Track      []Point              `json:"track,omitempty"`
	Cars       map[int]CarState     `json:"cars"` // marshals with string keys (JSON has no int keys); see web/src/state/race.ts's mirroring Record<number, Car>
	Messages   []RaceControlMessage `json:"messages,omitempty"`
	Radio      []RadioMessage       `json:"radio,omitempty"`
	LapTrace   map[int][]int        `json:"lapTrace,omitempty"`
	TotalLaps  int                  `json:"totalLaps,omitempty"` // session-constant race distance
	Stints     map[int][]Stint      `json:"stints,omitempty"`    // session-constant, like LapTrace
	Weather    *Weather             `json:"weather,omitempty"`
	TimeMs     int64                `json:"timeMs"`
	Rev        int64                `json:"rev"`
}

type Frame struct {
	// SessionKey rides along as a passenger field for the Python mirror
	// (ingest/live.py's build_frame()); no Go or TS consumer reads it. T (publish
	// wall-time, unix ms) IS read — cmd/loadtest computes fan-out latency as
	// now - frame.T (see BENCHMARKS.md) — so it is not dead code to prune.
	SessionKey string               `json:"session"`
	Rev        int64                `json:"rev"`
	T          int64                `json:"t"`      // publish wall-time, unix ms
	TimeMs     int64                `json:"timeMs"` // session clock
	Cars       []CarState           `json:"cars"`
	Messages   []RaceControlMessage `json:"messages,omitempty"`
	// Radio carries live-lane team-radio refs, sparse and accumulated onto the
	// snapshot by Apply (ADR-0008). Replay lanes never set it — their radio
	// rides the snapshot whole and fixed.
	Radio   []RadioMessage `json:"radio,omitempty"`
	Weather *Weather       `json:"weather,omitempty"`
}

// NewSnapshot returns an empty snapshot ready to receive frames. mode is a plain
// string (not Mode) so callers — notably the Source interface's Mode() string —
// don't need to change; it's converted at this one boundary.
func NewSnapshot(session, mode, label string) *Snapshot {
	return &Snapshot{SessionKey: session, Mode: Mode(mode), Label: label, Cars: make(map[int]CarState)}
}
