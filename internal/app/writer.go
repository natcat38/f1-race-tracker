// Package app wires the replay source, the bus, and the hub into runnable roles.
package app

import (
	"context"
	"log/slog"

	"github.com/natcat38/f1-race-tracker/internal/bus"
	"github.com/natcat38/f1-race-tracker/internal/model"
)

// Source is what the writer consumes (satisfied by replay.Source).
type Source interface {
	Events(ctx context.Context) (<-chan model.Frame, error)
	Track() []model.Point
	Radio() []model.RadioMessage
	Label() string
	Mode() string
}

// Writer folds source frames into a snapshot and publishes snapshot+frame to Redis.
type Writer struct {
	bus    *bus.Bus
	src    Source
	logger *slog.Logger
}

func NewWriter(b *bus.Bus, src Source, logger *slog.Logger) *Writer {
	return &Writer{bus: b, src: src, logger: logger}
}

func (wr *Writer) Run(ctx context.Context, session string) error {
	frames, err := wr.src.Events(ctx)
	if err != nil {
		return err
	}
	// Continue Rev above any snapshot a previous run (or a different source on this
	// session key) left in Redis, so a restart never emits a Rev the gateway/clients
	// already passed — which Apply would silently drop, freezing the board.
	var base int64
	if existing, err := wr.bus.GetSnapshot(ctx, session); err == nil && existing != nil {
		base = existing.Rev
	}
	snap := model.NewSnapshot(session, wr.src.Mode(), wr.src.Label())
	snap.Track = wr.src.Track()
	snap.Radio = wr.src.Radio()
	snap.Rev = base
	rev := base
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case fr, ok := <-frames:
			if !ok {
				return nil
			}
			rev++
			fr.Rev = rev // the writer owns Rev; the source's own Rev is ignored
			fr.SessionKey = session
			if _, applied := model.Apply(snap, fr); !applied {
				continue
			}
			if err := wr.bus.Publish(ctx, snap, fr); err != nil {
				wr.logger.Error("publish failed", "err", err)
			}
		}
	}
}
