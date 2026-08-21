// The HTTP entry point: upgrades a request to WebSocket, sends the snapshot, then
// streams frames.

package ws

import (
	"net/http"

	"github.com/coder/websocket"
)

// ServeWS upgrades to WebSocket, sends the snapshot, then streams frames.
func (h *Hub) ServeWS(w http.ResponseWriter, r *http.Request) {
	conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{
		OriginPatterns: h.originPatterns, // configured allowlist; empty => same-origin only
	})
	if err != nil {
		// Warn, not Error: this fires routinely for disallowed-origin probes, not just
		// real bugs, but an operator investigating "why can't the browser connect" needs
		// to see it — currently this path leaves zero trace.
		h.logger.Warn("websocket accept failed", "remote", r.RemoteAddr, "origin", r.Header.Get("Origin"), "err", err)
		return
	}
	defer conn.CloseNow()
	conn.SetReadLimit(readLimit)

	client := newClient(conn, h.logger)
	if err := h.Register(client); err != nil {
		h.logger.Error("register failed", "remote", r.RemoteAddr, "err", err)
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
