package app

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"

	"github.com/natcat38/f1-race-tracker/internal/model"
)

type wire struct {
	Type string          `json:"type"`
	Data json.RawMessage `json:"data"`
}

func TestEndToEnd_LateJoinerConverges(t *testing.T) {
	b := testBus(t)
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	src := &fakeSource{}
	for i := int64(1); i <= 50; i++ {
		src.frames = append(src.frames, model.Frame{
			Rev: i, TimeMs: i * 100,
			Cars: []model.CarState{{DriverNum: 1, Code: "VER", Pos: 1, P: model.Point{X: float64(i) / 50}}},
		})
	}
	go NewWriter(b, src, logger).Run(ctx, "demo")

	for { // wait until some state exists
		if s, _ := b.GetSnapshot(ctx, "demo"); s != nil && s.Rev >= 5 {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}

	gw, err := NewGateway(ctx, b, "demo", logger)
	if err != nil {
		t.Fatal(err)
	}
	mux := http.NewServeMux()
	gw.Mount(mux, nil)
	srv := httptest.NewServer(mux)
	defer srv.Close()

	conn, _, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(srv.URL, "http")+"/ws", nil)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close(websocket.StatusNormalClosure, "")

	_, first, err := conn.Read(ctx)
	if err != nil {
		t.Fatal(err)
	}
	var e wire
	_ = json.Unmarshal(first, &e)
	if e.Type != "snapshot" {
		t.Fatalf("first frame = %q, want snapshot", e.Type)
	}
	// Fast-path: if the gateway was seeded at rev>=50 (all frames already written),
	// the snapshot itself proves convergence — no subsequent frames needed.
	{
		var snap model.Snapshot
		_ = json.Unmarshal(e.Data, &snap)
		if snap.Rev >= 50 {
			return // converged via snapshot seed
		}
	}

	// Must converge to the latest rev the writer reaches.
	// Accept convergence from a snapshot (late-seed at high rev) or a subsequent frame.
	for {
		_, data, err := conn.Read(ctx)
		if err != nil {
			t.Fatalf("read: %v", err)
		}
		var ev wire
		_ = json.Unmarshal(data, &ev)
		if ev.Type == "frame" {
			var fr model.Frame
			_ = json.Unmarshal(ev.Data, &fr)
			if fr.Rev >= 50 {
				return // converged via frame
			}
		}
		if ev.Type == "snapshot" {
			var snap model.Snapshot
			_ = json.Unmarshal(ev.Data, &snap)
			if snap.Rev >= 50 {
				return // converged via snapshot seed
			}
		}
	}
}
