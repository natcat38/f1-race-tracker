package ws

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"

	"github.com/natcat38/f1-race-tracker/internal/model"
)

func (h *Hub) clientCount() int {
	h.mu.Lock()
	defer h.mu.Unlock()
	return len(h.clients)
}

// A client that connects then disconnects must be removed from the broadcast set:
// ServeWS's read loop detects the close and runs the deferred Unregister. Locks in
// the clean-disconnect path so it can't silently regress into a client leak.
func TestServeWS_DisconnectUnregisters(t *testing.T) {
	h := NewHub(model.NewSnapshot("demo", "replay", "Synthetic"), testLogger())
	srv := httptest.NewServer(http.HandlerFunc(h.ServeWS))
	defer srv.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	conn, _, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(srv.URL, "http"), nil)
	if err != nil {
		t.Fatal(err)
	}
	// Read the seed snapshot so registration has definitely happened.
	if _, _, err := conn.Read(ctx); err != nil {
		t.Fatal(err)
	}
	waitFor(t, func() bool { return h.clientCount() == 1 }, "client never registered")

	_ = conn.Close(websocket.StatusNormalClosure, "bye")
	waitFor(t, func() bool { return h.clientCount() == 0 }, "client never unregistered after close")
}

// C1 regression: Client.close() must close the underlying socket so a stalled
// client's blocking read unblocks. Here the dialed client should observe the
// connection closing once the server-side Client.close() runs.
func TestClient_CloseClosesUnderlyingConn(t *testing.T) {
	connCh := make(chan *websocket.Conn, 1)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		c, err := websocket.Accept(w, r, &websocket.AcceptOptions{OriginPatterns: []string{"*"}})
		if err != nil {
			return
		}
		connCh <- c
		<-r.Context().Done() // keep the handler (and conn) alive until the test ends
	}))
	defer srv.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	clientConn, _, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(srv.URL, "http"), nil)
	if err != nil {
		t.Fatal(err)
	}
	defer clientConn.CloseNow()

	cl := newClient(<-connCh, testLogger())
	cl.close()

	if _, _, err := clientConn.Read(ctx); err == nil {
		t.Fatal("expected client Read to error after server-side close(), got nil")
	}
}

// S2: ServeWS honors the configured origin allowlist — a disallowed Origin is rejected,
// an allowed one connects.
func TestServeWS_EnforcesOriginAllowlist(t *testing.T) {
	h := NewHub(model.NewSnapshot("demo", "replay", "x"), testLogger(), "goodhost.example")
	srv := httptest.NewServer(http.HandlerFunc(h.ServeWS))
	defer srv.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	wsURL := "ws" + strings.TrimPrefix(srv.URL, "http")

	if _, _, err := websocket.Dial(ctx, wsURL, &websocket.DialOptions{
		HTTPHeader: http.Header{"Origin": []string{"http://evil.example"}},
	}); err == nil {
		t.Error("expected dial with a disallowed origin to fail")
	}

	conn, _, err := websocket.Dial(ctx, wsURL, &websocket.DialOptions{
		HTTPHeader: http.Header{"Origin": []string{"http://goodhost.example"}},
	})
	if err != nil {
		t.Fatalf("allowed origin should connect: %v", err)
	}
	_ = conn.CloseNow()
}

// The client never legitimately sends data (the read loop exists only to detect
// close) — a custom, low SetReadLimit means an oversized message from a client
// is rejected rather than accepted up to the library's 32KiB default.
func TestServeWS_EnforcesReadLimit(t *testing.T) {
	h := NewHub(model.NewSnapshot("demo", "replay", "x"), testLogger())
	srv := httptest.NewServer(http.HandlerFunc(h.ServeWS))
	defer srv.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	conn, _, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(srv.URL, "http"), nil)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.CloseNow()
	if _, _, err := conn.Read(ctx); err != nil { // drain the seed snapshot
		t.Fatal(err)
	}

	// 1024 bytes: comfortably under the library's 32KiB default (so this only
	// fails once a smaller custom limit is enforced), comfortably over the
	// small limit this app needs.
	big := make([]byte, 1024)
	if err := conn.Write(ctx, websocket.MessageText, big); err != nil {
		t.Fatal(err)
	}

	// A short, separate deadline: a hung/unenforced read must fail fast here
	// rather than this test "passing" by exhausting the outer 5s timeout —
	// that would be true whether or not the limit is actually enforced.
	readCtx, readCancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer readCancel()
	_, _, readErr := conn.Read(readCtx)
	if readErr == nil {
		t.Fatal("expected the server to close the connection after an oversized message")
	}
	if status := websocket.CloseStatus(readErr); status != websocket.StatusMessageTooBig {
		t.Errorf("close status = %v (err=%v), want StatusMessageTooBig", status, readErr)
	}
}

func waitFor(t *testing.T, cond func() bool, msg string) {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if cond() {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal(msg)
}
