package app

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"

	"github.com/redis/go-redis/v9"

	"github.com/natcat38/f1-race-tracker/internal/bus"
	"github.com/natcat38/f1-race-tracker/internal/model"
	"github.com/natcat38/f1-race-tracker/internal/ws"
)

// Gateway subscribes to the frame channel, seeds an in-memory hub from the
// latest snapshot, and serves WebSocket clients.
type Gateway struct {
	hub    *ws.Hub
	logger *slog.Logger
}

// NewGateway subscribes BEFORE reading the snapshot (Tech §2.5 ordering), seeds
// the hub, and starts forwarding frames. Stale frames are dropped by Apply.
func NewGateway(ctx context.Context, b *bus.Bus, session string, logger *slog.Logger) (*Gateway, error) {
	pubsub := b.Subscribe(ctx, session)
	if _, err := pubsub.Receive(ctx); err != nil { // ensure SUBSCRIBE is live
		return nil, err
	}
	snap, err := b.GetSnapshot(ctx, session)
	if err != nil {
		return nil, err
	}
	if snap == nil {
		snap = model.NewSnapshot(session, "replay", "")
	}
	g := &Gateway{hub: ws.NewHub(snap), logger: logger}
	go g.consume(ctx, pubsub)
	return g, nil
}

func (g *Gateway) consume(ctx context.Context, pubsub *redis.PubSub) {
	defer pubsub.Close()
	ch := pubsub.Channel()
	for {
		select {
		case <-ctx.Done():
			return
		case msg, ok := <-ch:
			if !ok {
				return
			}
			var fr model.Frame
			if err := json.Unmarshal([]byte(msg.Payload), &fr); err != nil {
				g.logger.Warn("bad frame", "err", err)
				continue
			}
			g.hub.ApplyFrame(fr)
		}
	}
}

// Mount registers the gateway routes on mux. staticHandler serves the SPA (Task 9).
func (g *Gateway) Mount(mux *http.ServeMux, staticHandler http.Handler) {
	mux.Handle("/ws", g.hub.Handler())
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusOK) })
	if staticHandler != nil {
		mux.Handle("/", staticHandler)
	}
}
