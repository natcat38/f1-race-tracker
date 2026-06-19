package ws

import (
	"sync"

	"github.com/natcat38/f1-race-tracker/internal/model"
)

// Hub holds the authoritative in-memory snapshot and fans frames to clients.
type Hub struct {
	mu       sync.Mutex
	snapshot *model.Snapshot
	clients  map[*Client]struct{}
}

func NewHub(initial *model.Snapshot) *Hub {
	return &Hub{snapshot: initial, clients: make(map[*Client]struct{})}
}

// ApplyFrame folds a frame into the hub snapshot and broadcasts it. Stale
// frames (Rev <= current) are ignored and not broadcast. Returns true if applied.
func (h *Hub) ApplyFrame(f model.Frame) bool {
	h.mu.Lock()
	defer h.mu.Unlock()
	if _, applied := model.Apply(h.snapshot, f); !applied {
		return false
	}
	b, err := encodeFrame(f)
	if err != nil {
		return false
	}
	for c := range h.clients {
		c.send(b)
	}
	return true
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
	defer h.mu.Unlock()
	h.snapshot = snap
	b, err := encodeSnapshot(snap)
	if err != nil {
		return
	}
	for c := range h.clients {
		c.send(b)
	}
}
