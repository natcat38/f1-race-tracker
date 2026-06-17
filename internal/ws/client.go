package ws

import (
	"context"
	"sync"
	"time"

	"github.com/coder/websocket"
)

const (
	sendBuffer   = 64
	writeTimeout = 5 * time.Second
)

// Client is one connected browser. Frames queue on a bounded channel; if it
// fills (slow consumer) the client is closed and dropped so it can never stall
// the hub broadcast (Tech §2.5 backpressure).
type Client struct {
	conn   *websocket.Conn
	out    chan []byte
	closed chan struct{}
	once   sync.Once
}

func newClient(conn *websocket.Conn) *Client {
	return &Client{conn: conn, out: make(chan []byte, sendBuffer), closed: make(chan struct{})}
}

func (c *Client) send(b []byte) {
	select {
	case c.out <- b:
	default:
		c.close()
	}
}

func (c *Client) close() { c.once.Do(func() { close(c.closed) }) }

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
				c.close()
				return
			}
		}
	}
}
