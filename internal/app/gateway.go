// The gateway role: subscribes to the bus, keeps a hub per compare lane, and serves
// /ws, /healthz and the embedded SPA.

package app

import (
	"context"
	"encoding/json"
	"log/slog"
	"net"
	"net/http"
	"strings"
	"sync"

	"github.com/redis/go-redis/v9"

	"github.com/natcat38/f1-race-tracker/internal/bus"
	"github.com/natcat38/f1-race-tracker/internal/model"
	"github.com/natcat38/f1-race-tracker/internal/ws"
)

var allowedSources = map[string]bool{"replay": true, "live": true}

// defaultAllowedSessions bounds the /ws?session=<key> registry to the known compare lanes when
// ALLOWED_SESSIONS isn't set, so an arbitrary session value can't spawn an unbounded
// hub+goroutine+subscription (S1). Override for other lanes via SetAllowedSessions (config).
var defaultAllowedSessions = []string{"compare-monza-2023", "compare-monza-2024"}

// Gateway subscribes to a session's frame channel, seeds an in-memory hub from that
// session's snapshot, serves WebSocket clients, and can be repointed at a different
// session at runtime via SwitchTo (the operator toggle).
type Gateway struct {
	bus             *bus.Bus
	hub             *ws.Hub
	logger          *slog.Logger
	baseCtx         context.Context
	allowedOrigins  []string        // WS origin allowlist, applied to every hub this gateway creates
	allowedSessions map[string]bool // /ws?session= registry allowlist (S1); set before serving
	allowedHosts    map[string]bool // extra Host-header allowlist for control endpoints (L-1); loopback is always allowed

	mu      sync.Mutex
	session string
	cancel  context.CancelFunc // cancels the active consume goroutine
	gen     int                // bumped per SwitchTo; the toggle consume applies only while current (C2)

	regMu    sync.Mutex         // guards registry
	registry map[string]*ws.Hub // read-only per-session hubs for /ws?session=<key>
}

// NewGateway subscribes BEFORE reading the snapshot (Tech §2.5 ordering), seeds the
// hub, and starts forwarding frames for the initial session.
func NewGateway(ctx context.Context, b *bus.Bus, session string, logger *slog.Logger, allowedOrigins ...string) (*Gateway, error) {
	g := &Gateway{bus: b, logger: logger, baseCtx: ctx, registry: make(map[string]*ws.Hub), allowedOrigins: allowedOrigins, allowedSessions: toSet(defaultAllowedSessions)}
	snap, pubsub, err := g.subscribeAndSnapshot(ctx, session)
	if err != nil {
		return nil, err
	}
	g.hub = ws.NewHub(snap, g.logger, g.allowedOrigins...)
	g.session = session
	cctx, cancel := context.WithCancel(ctx)
	g.cancel = cancel
	go g.consume(cctx, g.hub, pubsub, g.gen)
	return g, nil
}

// SetAllowedSessions overrides the /ws?session= registry allowlist (the S1 bound). Call before
// serving (single-goroutine startup); a nil/empty list leaves the default compare-lane set.
func (g *Gateway) SetAllowedSessions(sessions []string) {
	if len(sessions) == 0 {
		return
	}
	g.allowedSessions = toSet(sessions)
}

// SetAllowedHosts adds extra hostnames (port stripped) to the Host-header allowlist checked by
// handleControl (L-1: DNS rebinding makes a cross-site POST look same-origin, so the
// Sec-Fetch-Site guard alone isn't enough). Call before serving; loopback is always allowed
// regardless of this list.
func (g *Gateway) SetAllowedHosts(hosts []string) {
	if len(hosts) == 0 {
		return
	}
	g.allowedHosts = toSet(hosts)
}

// hostAllowed reports whether reqHost (an http.Request.Host value, usually "host:port") names
// an allowed control-endpoint target: loopback always qualifies; anything else must be in extra.
// The port is stripped before matching since ADDR/reverse proxies vary it.
func hostAllowed(reqHost string, extra map[string]bool) bool {
	h := reqHost
	if hh, _, err := net.SplitHostPort(reqHost); err == nil {
		h = hh
	}
	h = strings.ToLower(h)
	if h == "localhost" || h == "127.0.0.1" || h == "::1" {
		return true
	}
	return extra[h]
}

// toSet builds a membership set from a slice.
func toSet(items []string) map[string]bool {
	m := make(map[string]bool, len(items))
	for _, s := range items {
		m[s] = true
	}
	return m
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
	g.gen++
	g.session = session
	go g.consume(cctx, g.hub, pubsub, g.gen)
	return nil
}

// consume forwards frames from pubsub into hub. gen<0 marks an ungated registry hub (never
// switched); otherwise a frame is applied only while g.gen still equals gen — so a SwitchTo
// that cancels this goroutine can't race a stale frame onto the just-reset hub (C2).
func (g *Gateway) consume(ctx context.Context, hub *ws.Hub, pubsub *redis.PubSub, gen int) {
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
			if gen < 0 { // registry hub: not subject to switching
				hub.ApplyFrame(fr)
				continue
			}
			g.mu.Lock()
			current := g.gen == gen
			if current {
				hub.ApplyFrame(fr) // under g.mu so a concurrent SwitchTo can't interleave
			}
			g.mu.Unlock()
			if !current {
				return
			}
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
	hub := ws.NewHub(snap, g.logger, g.allowedOrigins...)
	g.registry[session] = hub
	go g.consume(g.baseCtx, hub, pubsub, -1) // registry hubs are never switched
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
	if !g.allowedSessions[session] {
		http.Error(w, "unknown session", http.StatusBadRequest)
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
	mux.HandleFunc("/api/f1auth", g.handleAuthStatus)
	if staticHandler != nil {
		mux.Handle("/", staticHandler)
	}
}

// handleAuthStatus serves the Python-published F1TV auth status verbatim (ADR-0007).
// The gateway stays read-only: the status is written only by the ingest side, and
// only ever carries state/expiry/tier — never the token.
func (g *Gateway) handleAuthStatus(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	raw, err := g.bus.GetAuthStatus(r.Context())
	if err != nil {
		g.logger.Error("auth status read failed", "err", err)
		http.Error(w, "auth status unavailable", http.StatusBadGateway)
		return
	}
	if raw == nil {
		// Nothing published yet (no ingester running, or an older one): the honest
		// answer is "not linked", not an error the settings page has to decode.
		raw = []byte(`{"state":"unlinked"}`)
	}
	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write(raw)
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
		// Reject cross-site state-changing POSTs (browsers send Sec-Fetch-Site). Non-browser
		// clients omit it and are allowed; pair with a shared secret if ever internet-exposed.
		if site := r.Header.Get("Sec-Fetch-Site"); site != "" && site != "same-origin" && site != "none" {
			http.Error(w, "cross-site control request rejected", http.StatusForbidden)
			return
		}
		// Host allowlist (L-1): DNS rebinding re-resolves an attacker domain to loopback,
		// making the request genuinely same-origin and slipping past the Sec-Fetch-Site
		// guard above. Additive, not a replacement for it.
		if !hostAllowed(r.Host, g.allowedHosts) {
			http.Error(w, "unrecognized host", http.StatusForbidden)
			return
		}
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
	// ponytail: v is always a small static map[string]string here; an encode error
	// would mean the client vanished mid-write, which the client already learns
	// from its own broken response. Not logged to avoid a logger dependency for
	// a failure mode with no operator action to take.
	_ = json.NewEncoder(w).Encode(v)
}
