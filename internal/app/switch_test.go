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

// loops a fakeSource forever so both lanes stay published.
func loopingSource(car model.CarState) *fakeSource {
	return &fakeSource{frames: []model.Frame{{Rev: 1, Cars: []model.CarState{car}}}}
}

func TestGateway_SwitchSourceReseedsClients(t *testing.T) {
	b := testBus(t)
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	// Two independent lanes on two session keys.
	go NewWriter(b, loopingSource(model.CarState{DriverNum: 1, Code: "VER"}), logger).Run(ctx, "replay")
	go NewWriter(b, loopingSource(model.CarState{DriverNum: 44, Code: "HAM"}), logger).Run(ctx, "live")
	for { // wait until both lanes have a snapshot
		r, _ := b.GetSnapshot(ctx, "replay")
		l, _ := b.GetSnapshot(ctx, "live")
		if r != nil && l != nil {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}

	gw, err := NewGateway(ctx, b, "replay", logger)
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

	// First message: the replay lane snapshot.
	if got := readSession(t, ctx, conn); got != "replay" {
		t.Fatalf("first snapshot session = %q, want replay", got)
	}

	// Operator switches to live.
	resp, err := http.Post(srv.URL+"/control/source", "application/json", strings.NewReader(`{"source":"live"}`))
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("control status = %d, want 200", resp.StatusCode)
	}

	// The client must be re-seeded with the live lane within a few messages.
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if readSession(t, ctx, conn) == "live" {
			return // switched
		}
	}
	t.Fatal("client never received the live lane snapshot after switch")
}

// readSession reads one WS message and returns the session key it carries
// (works for both snapshot and frame envelopes).
func readSession(t *testing.T, ctx context.Context, conn *websocket.Conn) string {
	t.Helper()
	_, data, err := conn.Read(ctx)
	if err != nil {
		t.Fatalf("ws read: %v", err)
	}
	var e struct {
		Type string          `json:"type"`
		Data json.RawMessage `json:"data"`
	}
	_ = json.Unmarshal(data, &e)
	var s struct {
		Session string `json:"session"`
	}
	_ = json.Unmarshal(e.Data, &s)
	return s.Session
}
