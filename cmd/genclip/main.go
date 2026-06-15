package main

import (
	"bufio"
	"encoding/json"
	"flag"
	"log"
	"math"
	"os"

	"github.com/natcat38/f1-race-tracker/internal/model"
)

type clipHeader struct {
	Track  []model.Point `json:"track"`
	Label  string        `json:"label"`
	MaxRev int64         `json:"maxRev"`
}

type clipLine struct {
	TimeMs int64       `json:"timeMs"`
	Frame  model.Frame `json:"frame"`
}

func main() {
	out := flag.String("out", "data/replays/synthetic.jsonl", "output path")
	flag.Parse()

	const (
		cx, cy, r = 0.5, 0.5, 0.4
		nFrames   = 200 // 20s @ 10Hz
		hz        = 10
	)
	cars := []struct {
		num   int
		code  string
		team  string
		phase float64
		spd   float64 // radians per frame
	}{
		{1, "VER", "Red Bull", 0, 0.05},
		{16, "LEC", "Ferrari", 0.4, 0.048},
		{44, "HAM", "Mercedes", 0.8, 0.052},
	}

	// Track outline: 64 points around the circle.
	track := make([]model.Point, 0, 64)
	for i := 0; i < 64; i++ {
		a := 2 * math.Pi * float64(i) / 64
		track = append(track, model.Point{X: cx + r*math.Cos(a), Y: cy + r*math.Sin(a)})
	}

	f, err := os.Create(*out)
	if err != nil {
		log.Fatal(err)
	}
	defer f.Close()
	w := bufio.NewWriter(f)
	defer w.Flush()
	enc := json.NewEncoder(w)

	if err := enc.Encode(clipHeader{Track: track, Label: "Synthetic · Demo", MaxRev: nFrames}); err != nil {
		log.Fatal(err)
	}

	for i := 0; i < nFrames; i++ {
		fr := model.Frame{Rev: int64(i + 1), TimeMs: int64(i) * (1000 / hz)}
		for _, c := range cars {
			a := c.phase + c.spd*float64(i)
			fr.Cars = append(fr.Cars, model.CarState{
				DriverNum: c.num, Code: c.code, Team: c.team, Status: "OnTrack",
				P: model.Point{X: cx + r*math.Cos(a), Y: cy + r*math.Sin(a)},
			})
		}
		// running order by angle travelled (just a deterministic stand-in)
		for j := range fr.Cars {
			fr.Cars[j].Pos = j + 1
		}
		if err := enc.Encode(clipLine{TimeMs: fr.TimeMs, Frame: fr}); err != nil {
			log.Fatal(err)
		}
	}
	log.Printf("wrote %d frames to %s", nFrames, *out)
}
