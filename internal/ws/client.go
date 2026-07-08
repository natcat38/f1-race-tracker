package ws

import (
	"context"
	"log/slog"
	"sync"
	"time"

	"github.com/coder/websocket"
)

const (
	sendBuffer   = 64
	writeTimeout = 5 * time.Second
	// readLimit is deliberately far below the library's 32KiB default: this
	// protocol is fan-out only (the read loop exists solely to detect close),
	// so no legitimate client message is ever larger than a few bytes.
	readLimit = 512
)

// Client is one connected browser. Frames queue on a bounded channel; if it
// fills (slow consumer) the client is closed and dropped so it can never stall
// the hub broadcast (Tech §2.5 backpressure).
type Client struct {
	conn   *websocket.Conn
	out    chan []byte
	closed chan struct{}
	once   sync.Once
	logger *slog.Logger
}

func newClient(conn *websocket.Conn, logger *slog.Logger) *Client {
	return &Client{conn: conn, out: make(chan []byte, sendBuffer), closed: make(chan struct{}), logger: logger}
}

// send attempts to queue b for delivery. Returns false if the client's buffer
// is full (a slow consumer) — the caller must then close the client itself,
// OUTSIDE any lock it holds, since close() runs a socket-close syscall (C3).
func (c *Client) send(b []byte) bool {
	select {
	case c.out <- b:
		return true
	default:
		return false
	}
}

func (c *Client) close() {
	c.once.Do(func() {
		close(c.closed)
		// Also close the socket so a stalled client's blocking conn.Read in ServeWS
		// returns, letting the deferred Unregister run (else the client leaks). conn is
		// nil only in hub unit tests that never open a real socket.
		if c.conn != nil {
			_ = c.conn.CloseNow()
		}
	})
}

func (c *Client) writeLoop(ctx context.Context) {
	for {
		select {
		case <-ctx.Done():
			return
		case <-c.closed:
			return
		case b := <-c.out:
			wctx, cancel := context.WithTimeout(ctx, writeTimeout)
			err := c.conn.Write(wctx, websocket.MessageText, b)
			cancel()
			if err != nil {
				// Debug, not Warn/Error: a write failure here is the ordinary shape of a
				// client disconnecting (closed tab, dropped network) and happens routinely.
				c.logger.Debug("client write failed, dropping", "err", err)
				c.close()
				return
			}
		}
	}
}
