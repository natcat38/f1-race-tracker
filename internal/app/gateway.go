package app

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"sync"

	"github.com/redis/go-redis/v9"

	"github.com/natcat38/f1-race-tracker/internal/bus"
	"github.com/natcat38/f1-race-tracker/internal/model"
	"github.com/natcat38/f1-race-tracker/internal/ws"
)

var allowedSources = map[string]bool{"replay": true, "live": true}

// Gateway subscribes to a session's frame channel, seeds an in-memory hub from that
// session's snapshot, serves WebSocket clients, and can be repointed at a different
// session at runtime via SwitchTo (the operator toggle).
type Gateway struct {
	bus     *bus.Bus
	hub     *ws.Hub
	logger  *slog.Logger
	baseCtx context.Context

	mu      sync.Mutex
	session string
	cancel  context.CancelFunc // cancels the active consume goroutine

	regMu    sync.Mutex         // guards registry
	registry map[string]*ws.Hub // read-only per-session hubs for /ws?session=<key>
}

// NewGateway subscribes BEFORE reading the snapshot (Tech §2.5 ordering), seeds the
// hub, and starts forwarding frames for the initial session.
func NewGateway(ctx context.Context, b *bus.Bus, session string, logger *slog.Logger) (*Gateway, error) {
	g := &Gateway{bus: b, logger: logger, baseCtx: ctx, registry: make(map[string]*ws.Hub)}
	snap, pubsub, err := g.subscribeAndSnapshot(ctx, session)
	if err != nil {
		return nil, err
	}
	g.hub = ws.NewHub(snap)
	g.session = session
	cctx, cancel := context.WithCancel(ctx)
	g.cancel = cancel
	go g.consume(cctx, g.hub, pubsub)
	return g, nil
}

// subscribeAndSnapshot preserves subscribe-before-snapshot ordering (Tech §2.5): any
// frame published after we subscribe is buffered and delivered to consume; the
// snapshot we read already reflects at least every Rev up to SUBSCRIBE time.
func (g *Gateway) subscribeAndSnapshot(ctx context.Context, session string) (*model.Snapshot, *redis.PubSub, error) {
	pubsub := g.bus.Subscribe(ctx, session)
	if _, err := pubsub.Receive(ctx); err != nil { // ensure SUBSCRIBE is live
		return nil, nil, err
	}
	snap, err := g.bus.GetSnapshot(ctx, session)
	if err != nil {
		_ = pubsub.Close()
		return nil, nil, err
	}
	if snap == nil {
		snap = model.NewSnapshot(session, "", "") // unknown until the lane publishes
	}
	return snap, pubsub, nil
}

// SwitchTo repoints the gateway at a different session key: subscribe to the new
// channel, load its snapshot, reset every connected client to it, then fan out the
// new session's frames. The old consume goroutine is cancelled first.
func (g *Gateway) SwitchTo(session string) error {
	g.mu.Lock()
	defer g.mu.Unlock()
	if session == g.session {
		return nil
	}
	snap, pubsub, err := g.subscribeAndSnapshot(g.baseCtx, session)
	if err != nil {
		return err
	}
	g.cancel() // stop the old consume goroutine (its defer closes the old pubsub)
	g.hub.Reset(snap)
	cctx, cancel := context.WithCancel(g.baseCtx)
	g.cancel = cancel
	g.session = session
	go g.consume(cctx, g.hub, pubsub)
	return nil
}

func (g *Gateway) consume(ctx context.Context, hub *ws.Hub, pubsub *redis.PubSub) {
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
			hub.ApplyFrame(fr)
		}
	}
}

// getOrCreateHub returns a lazily-created read-only hub fanning out one session.
// Registry hubs live for the gateway's lifetime (baseCtx); they are never switched.
func (g *Gateway) getOrCreateHub(session string) (*ws.Hub, error) {
	g.regMu.Lock()
	defer g.regMu.Unlock()
	if h, ok := g.registry[session]; ok {
		return h, nil
	}
	snap, pubsub, err := g.subscribeAndSnapshot(g.baseCtx, session)
	if err != nil {
		return nil, err
	}
	hub := ws.NewHub(snap)
	g.registry[session] = hub
	go g.consume(g.baseCtx, hub, pubsub)
	return hub, nil
}

// wsHandler routes /ws to the active hub (M3 toggle path) or, when ?session=<key>
// is present, to that session's registry hub.
func (g *Gateway) wsHandler(w http.ResponseWriter, r *http.Request) {
	session := r.URL.Query().Get("session")
	if session == "" {
		g.mu.Lock()
		hub := g.hub
		g.mu.Unlock()
		hub.ServeWS(w, r)
		return
	}
	hub, err := g.getOrCreateHub(session)
	if err != nil {
		g.logger.Error("session subscribe failed", "session", session, "err", err)
		http.Error(w, "session unavailable", http.StatusBadGateway)
		return
	}
	hub.ServeWS(w, r)
}

// Mount registers the gateway routes on mux. staticHandler serves the SPA (Task 9).
func (g *Gateway) Mount(mux *http.ServeMux, staticHandler http.Handler) {
	mux.HandleFunc("/ws", g.wsHandler)
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusOK) })
	mux.HandleFunc("/control/source", g.handleControl)
	if staticHandler != nil {
		mux.Handle("/", staticHandler)
	}
}

// handleControl: GET reports the active source; POST {"source":"replay"|"live"} switches.
func (g *Gateway) handleControl(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		g.mu.Lock()
		cur := g.session
		g.mu.Unlock()
		writeJSON(w, map[string]string{"source": cur})
	case http.MethodPost:
		var body struct {
			Source string `json:"source"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil || !allowedSources[body.Source] {
			http.Error(w, "source must be one of: replay, live", http.StatusBadRequest)
			return
		}
		if err := g.SwitchTo(body.Source); err != nil {
			g.logger.Error("switch failed", "source", body.Source, "err", err)
			http.Error(w, "switch failed", http.StatusBadGateway)
			return
		}
		writeJSON(w, map[string]string{"source": body.Source})
	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(v)
}
