// Package bus is the Redis seam: snapshot store + frame pub/sub.
package bus

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/redis/go-redis/v9"

	"github.com/natcat38/f1-race-tracker/internal/model"
)

func snapshotKey(s string) string   { return "snapshot:" + s }
func framesChannel(s string) string { return "frames:" + s }

type Bus struct{ rdb *redis.Client }

func New(rdb *redis.Client) *Bus { return &Bus{rdb: rdb} }

// Publish stores the snapshot then publishes the frame. SET before PUBLISH
// so any subscriber receiving the frame can trust the stored snapshot already
// reflects at least that Rev (Tech §2.5).
func (b *Bus) Publish(ctx context.Context, snap *model.Snapshot, fr model.Frame) error {
	sj, err := json.Marshal(snap)
	if err != nil {
		return fmt.Errorf("bus: marshal snapshot: %w", err)
	}
	fj, err := json.Marshal(fr)
	if err != nil {
		return fmt.Errorf("bus: marshal frame: %w", err)
	}
	if err := b.rdb.Set(ctx, snapshotKey(snap.SessionKey), sj, 0).Err(); err != nil {
		return fmt.Errorf("bus: set snapshot: %w", err)
	}
	if err := b.rdb.Publish(ctx, framesChannel(snap.SessionKey), fj).Err(); err != nil {
		return fmt.Errorf("bus: publish: %w", err)
	}
	return nil
}

// GetSnapshot returns the latest snapshot, or (nil,nil) if none exists.
func (b *Bus) GetSnapshot(ctx context.Context, session string) (*model.Snapshot, error) {
	val, err := b.rdb.Get(ctx, snapshotKey(session)).Bytes()
	if err == redis.Nil {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("bus: get snapshot: %w", err)
	}
	var snap model.Snapshot
	if err := json.Unmarshal(val, &snap); err != nil {
		return nil, fmt.Errorf("bus: unmarshal snapshot: %w", err)
	}
	return &snap, nil
}

// Subscribe returns a PubSub for the session's frame channel. Caller closes it.
func (b *Bus) Subscribe(ctx context.Context, session string) *redis.PubSub {
	return b.rdb.Subscribe(ctx, framesChannel(session))
}
