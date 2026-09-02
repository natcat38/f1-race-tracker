// Tests for the replay writer role: frames are published to the bus in order and the
// snapshot is kept current.

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

type fakeSource struct {
	frames []model.Frame
	stints map[int][]model.Stint
}

func (f *fakeSource) Track() []model.Point                  { return []model.Point{{X: 0, Y: 0}} }
func (f *fakeSource) Corners() []model.Corner               { return nil }
func (f *fakeSource) Radio() []model.RadioMessage           { return nil }
func (f *fakeSource) LapTrace() map[int][]int               { return nil }
func (f *fakeSource) TotalLaps() int                        { return 0 }
func (f *fakeSource) Stints() map[int][]model.Stint         { return f.stints }
func (f *fakeSource) PitStops() map[int][]model.PitStop     { return nil }
func (f *fakeSource) PedalTraces() map[int]model.PedalTrace { return nil }
func (f *fakeSource) SectorDominance() []int                { return nil }
func (f *fakeSource) Label() string                         { return "Fake" }
func (f *fakeSource) Mode() string                          { return "replay" }
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

// closingSource emits its frames then CLOSES its channel (unlike fakeSource, which
// blocks on ctx after emitting) — exercising Writer.Run's frames-channel-closed branch.
type closingSource struct{ frames []model.Frame }

func (closingSource) Track() []model.Point                  { return nil }
func (closingSource) Corners() []model.Corner               { return nil }
func (closingSource) Radio() []model.RadioMessage           { return nil }
func (closingSource) LapTrace() map[int][]int               { return nil }
func (closingSource) TotalLaps() int                        { return 0 }
func (closingSource) Stints() map[int][]model.Stint         { return nil }
func (closingSource) PitStops() map[int][]model.PitStop     { return nil }
func (closingSource) PedalTraces() map[int]model.PedalTrace { return nil }
func (closingSource) SectorDominance() []int                { return nil }
func (closingSource) Label() string                         { return "Closing" }
func (closingSource) Mode() string                          { return "replay" }
func (s closingSource) Events(ctx context.Context) (<-chan model.Frame, error) {
	ch := make(chan model.Frame)
	go func() {
		defer close(ch)
		for _, fr := range s.frames {
			select {
			case <-ctx.Done():
				return
			case ch <- fr:
			}
		}
	}()
	return ch, nil
}

func TestWriter_ReturnsNilWhenSourceChannelCloses(t *testing.T) {
	b := testBus(t)
	src := closingSource{frames: []model.Frame{{Rev: 1, Cars: []model.CarState{{DriverNum: 1}}}}}
	done := make(chan error, 1)
	go func() {
		done <- NewWriter(b, src, slog.New(slog.NewTextHandler(io.Discard, nil))).Run(context.Background(), "demo")
	}()
	select {
	case err := <-done:
		if err != nil {
			t.Errorf("Run returned %v, want nil when the source channel closes", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("Run did not return after the source channel closed")
	}
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

func TestWriter_FailsFastWhenSnapshotReadErrors(t *testing.T) {
	// Bus pointing at a dead address: GetSnapshot returns a real error (not not-found),
	// so the writer must return it rather than silently starting at rev 0.
	rdb := redis.NewClient(&redis.Options{Addr: "127.0.0.1:1", DialTimeout: 200 * time.Millisecond, MaxRetries: -1})
	defer func() { _ = rdb.Close() }()
	b := bus.New(rdb)
	src := closingSource{frames: []model.Frame{{Rev: 1, Cars: []model.CarState{{DriverNum: 1}}}}}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	if err := NewWriter(b, src, slog.New(slog.NewTextHandler(io.Discard, nil))).Run(ctx, "demo"); err == nil {
		t.Fatal("expected Run to error when the snapshot read fails, got nil")
	}
}

func TestWriter_PublishesSnapshotWithLatestRevAndTrack(t *testing.T) {
	b := testBus(t)
	src := &fakeSource{
		frames: []model.Frame{
			{Rev: 1, Cars: []model.CarState{{DriverNum: 1, Code: "VER"}}},
			{Rev: 2, Cars: []model.CarState{{DriverNum: 16, Code: "LEC"}}},
		},
		stints: map[int][]model.Stint{1: {{Compound: "SOFT", StartLap: 1, EndLap: 10}}},
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go NewWriter(b, src, slog.New(slog.NewTextHandler(io.Discard, nil))).Run(ctx, "demo")

	deadline := time.After(2 * time.Second)
	for {
		snap, _ := b.GetSnapshot(context.Background(), "demo")
		if snap != nil && snap.Rev == 2 && len(snap.Cars) == 2 && len(snap.Track) == 1 {
			if len(snap.Stints[1]) != 1 || snap.Stints[1][0].Compound != "SOFT" {
				t.Fatalf("stints did not pass through: %+v", snap.Stints)
			}
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
