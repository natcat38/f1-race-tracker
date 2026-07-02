package app

import (
	"context"
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

func TestGateway_SessionParamServesRequestedSession(t *testing.T) {
	b := testBus(t)
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	// Two lanes on two session keys (loopingSource is defined in switch_test.go).
	go NewWriter(b, loopingSource(model.CarState{DriverNum: 1, Code: "VER"}), logger).Run(ctx, "compare-monza-2023")
	go NewWriter(b, loopingSource(model.CarState{DriverNum: 44, Code: "HAM"}), logger).Run(ctx, "compare-monza-2024")
	for {
		a, _ := b.GetSnapshot(ctx, "compare-monza-2023")
		bb, _ := b.GetSnapshot(ctx, "compare-monza-2024")
		if a != nil && bb != nil {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}

	gw, err := NewGateway(ctx, b, "compare-monza-2023", logger) // default/active session = compare-monza-2023
	if err != nil {
		t.Fatal(err)
	}
	mux := http.NewServeMux()
	gw.Mount(mux, nil)
	srv := httptest.NewServer(mux)
	defer srv.Close()
	wsBase := "ws" + strings.TrimPrefix(srv.URL, "http")

	// A ?session=compare-monza-2024 client must receive the compare-monza-2024 lane...
	connB, _, err := websocket.Dial(ctx, wsBase+"/ws?session=compare-monza-2024", nil)
	if err != nil {
		t.Fatal(err)
	}
	defer connB.Close(websocket.StatusNormalClosure, "")
	if got := readSession(t, ctx, connB); got != "compare-monza-2024" { // readSession is in switch_test.go
		t.Fatalf("?session=compare-monza-2024 first snapshot = %q, want compare-monza-2024", got)
	}

	// ...while the default (no param) client still gets the active session (compare-monza-2023).
	connDef, _, err := websocket.Dial(ctx, wsBase+"/ws", nil)
	if err != nil {
		t.Fatal(err)
	}
	defer connDef.Close(websocket.StatusNormalClosure, "")
	if got := readSession(t, ctx, connDef); got != "compare-monza-2023" {
		t.Fatalf("default /ws first snapshot = %q, want compare-monza-2023", got)
	}
}
