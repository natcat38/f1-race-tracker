package app

import (
	"context"
	"io"
	"log/slog"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"

	"github.com/natcat38/f1-race-tracker/internal/bus"
	"github.com/natcat38/f1-race-tracker/internal/model"
)

type fakeSource struct{ frames []model.Frame }

func (f *fakeSource) Track() []model.Point        { return []model.Point{{X: 0, Y: 0}} }
func (f *fakeSource) Radio() []model.RadioMessage { return nil }
func (f *fakeSource) Label() string               { return "Fake" }
func (f *fakeSource) Mode() string                { return "replay" }
func (f *fakeSource) Events(ctx context.Context) (<-chan model.Frame, error) {
	ch := make(chan model.Frame)
	go func() {
		defer close(ch)
		for _, fr := range f.frames {
			select {
			case <-ctx.Done():
				return
			case ch <- fr:
			}
		}
		<-ctx.Done()
	}()
	return ch, nil
}

func testBus(t *testing.T) *bus.Bus {
	t.Helper()
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(mr.Close)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() { _ = rdb.Close() })
	return bus.New(rdb)
}

func TestWriter_PublishesSnapshotWithLatestRevAndTrack(t *testing.T) {
	b := testBus(t)
	src := &fakeSource{frames: []model.Frame{
		{Rev: 1, Cars: []model.CarState{{DriverNum: 1, Code: "VER"}}},
		{Rev: 2, Cars: []model.CarState{{DriverNum: 16, Code: "LEC"}}},
	}}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go NewWriter(b, src, slog.New(slog.NewTextHandler(io.Discard, nil))).Run(ctx, "demo")

	deadline := time.After(2 * time.Second)
	for {
		snap, _ := b.GetSnapshot(context.Background(), "demo")
		if snap != nil && snap.Rev == 2 && len(snap.Cars) == 2 && len(snap.Track) == 1 {
			return
		}
		select {
		case <-deadline:
			t.Fatalf("snapshot never reached rev 2 with track: %+v", snap)
		case <-time.After(20 * time.Millisecond):
		}
	}
}

func TestWriter_RevContinuesAboveStoredSnapshot(t *testing.T) {
	b := testBus(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// A previous run left a snapshot at rev 1000 on this session key.
	seed := model.NewSnapshot("demo", "replay", "old")
	seed.Rev = 1000
	if err := b.Publish(ctx, seed, model.Frame{SessionKey: "demo", Rev: 1000}); err != nil {
		t.Fatal(err)
	}

	// The writer's source restarts at rev 1 — it must NOT publish rev <= 1000.
	src := &fakeSource{frames: []model.Frame{
		{Rev: 1, Cars: []model.CarState{{DriverNum: 1, Code: "VER"}}},
		{Rev: 2, Cars: []model.CarState{{DriverNum: 1, Code: "VER"}}},
	}}
	go NewWriter(b, src, slog.New(slog.NewTextHandler(io.Discard, nil))).Run(ctx, "demo")

	deadline := time.After(2 * time.Second)
	for {
		snap, _ := b.GetSnapshot(context.Background(), "demo")
		if snap != nil && snap.Rev >= 1002 { // 1000 (base) + 2 frames
			return
		}
		select {
		case <-deadline:
			t.Fatalf("rev did not continue above stored snapshot: %+v", snap)
		case <-time.After(20 * time.Millisecond):
		}
	}
}
