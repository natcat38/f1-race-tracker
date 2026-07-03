package ws

import (
	"log/slog"
	"sync"

	"github.com/natcat38/f1-race-tracker/internal/model"
)

// Hub holds the authoritative in-memory snapshot and fans frames to clients.
type Hub struct {
	mu             sync.Mutex
	snapshot       *model.Snapshot
	clients        map[*Client]struct{}
	originPatterns []string // WS allowed origins; empty => same-origin only (coder/websocket default)
	logger         *slog.Logger
}

func NewHub(initial *model.Snapshot, logger *slog.Logger, originPatterns ...string) *Hub {
	return &Hub{snapshot: initial, clients: make(map[*Client]struct{}), originPatterns: originPatterns, logger: logger}
}

// ApplyFrame folds a frame into the hub snapshot and broadcasts it. Stale
// frames (Rev <= current) are ignored and not broadcast. Returns true if applied.
func (h *Hub) ApplyFrame(f model.Frame) bool {
	h.mu.Lock()
	if _, applied := model.Apply(h.snapshot, f); !applied {
		h.mu.Unlock()
		return false
	}
	b, err := encodeFrame(f)
	if err != nil {
		h.logger.Error("encode frame failed", "session", f.SessionKey, "rev", f.Rev, "err", err)
		h.mu.Unlock()
		return false
	}
	stale := h.broadcastLocked(b)
	h.mu.Unlock()
	closeAll(stale)
	return true
}

// broadcastLocked sends b to every client, returning those whose buffer was
// full. Caller must hold h.mu and must close the returned clients only AFTER
// releasing it — close() runs a socket-close syscall and must never happen
// while h.mu is held, or one slow client's close latency stalls the broadcast
// for every other client and any other goroutine waiting on h.mu (C3).
func (h *Hub) broadcastLocked(b []byte) []*Client {
	var stale []*Client
	for c := range h.clients {
		if !c.send(b) {
			stale = append(stale, c)
		}
	}
	return stale
}

func closeAll(clients []*Client) {
	for _, c := range clients {
		c.close()
	}
}

// Register enqueues the current snapshot as the client's first frame, then adds
// it to the broadcast set — both under the lock, so no frame slips between the
// snapshot the client receives and the frames it then streams.
func (h *Hub) Register(c *Client) error {
	h.mu.Lock()
	defer h.mu.Unlock()
	b, err := encodeSnapshot(h.snapshot)
	if err != nil {
		return err
	}
	c.out <- b // buffer is fresh; never blocks
	h.clients[c] = struct{}{}
	return nil
}

func (h *Hub) Unregister(c *Client) {
	h.mu.Lock()
	delete(h.clients, c)
	h.mu.Unlock()
}

// Reset swaps the hub's authoritative snapshot wholesale (the operator switched the
// gateway to a different source/session) and broadcasts it to every client so they
// full-replace their state. Unlike ApplyFrame this is NOT Rev-gated: the new
// snapshot may carry a lower Rev than the one clients currently hold.
func (h *Hub) Reset(snap *model.Snapshot) {
	h.mu.Lock()
	h.snapshot = snap
	b, err := encodeSnapshot(snap)
	if err != nil {
		h.logger.Error("encode snapshot failed", "session", snap.SessionKey, "err", err)
		h.mu.Unlock()
		return
	}
	stale := h.broadcastLocked(b)
	h.mu.Unlock()
	closeAll(stale)
}
