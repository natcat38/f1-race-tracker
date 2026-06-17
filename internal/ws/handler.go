package ws

import (
	"net/http"

	"github.com/coder/websocket"
)

// Handler upgrades to WebSocket, sends the snapshot, then streams frames.
func (h *Hub) Handler() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{
			OriginPatterns: []string{"*"}, // same-origin in prod; permissive for dev
		})
		if err != nil {
			return
		}
		defer conn.CloseNow()

		client := newClient(conn)
		if err := h.Register(client); err != nil {
			return
		}
		defer h.Unregister(client)

		ctx := r.Context()
		go client.writeLoop(ctx)
		for { // read loop exists only to detect close
			if _, _, err := conn.Read(ctx); err != nil {
				client.close()
				return
			}
		}
	}
}
