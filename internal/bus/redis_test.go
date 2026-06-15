package bus

import (
	"context"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"

	"github.com/natcat38/f1-race-tracker/internal/model"
)

func newTestBus(t *testing.T) *Bus {
	t.Helper()
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(mr.Close)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() { _ = rdb.Close() })
	return New(rdb)
}

func TestBus_PublishStoresSnapshotAndDelivers(t *testing.T) {
	b := newTestBus(t)
	ctx := context.Background()

	ps := b.Subscribe(ctx, "demo")
	defer ps.Close()
	if _, err := ps.Receive(ctx); err != nil {
		t.Fatal(err)
	}
	ch := ps.Channel()

	snap := model.NewSnapshot("demo", "replay", "Synthetic")
	fr := model.Frame{SessionKey: "demo", Rev: 1, Cars: []model.CarState{{DriverNum: 1, Code: "VER"}}}
	model.Apply(snap, fr)

	if err := b.Publish(ctx, snap, fr); err != nil {
		t.Fatal(err)
	}
	got, err := b.GetSnapshot(ctx, "demo")
	if err != nil || got == nil || got.Rev != 1 {
		t.Fatalf("GetSnapshot = %+v err=%v", got, err)
	}
	select {
	case <-ch:
	case <-time.After(time.Second):
		t.Fatal("frame not delivered to subscriber")
	}
}

func TestBus_GetSnapshotNilWhenAbsent(t *testing.T) {
	b := newTestBus(t)
	got, err := b.GetSnapshot(context.Background(), "missing")
	if err != nil || got != nil {
		t.Fatalf("want (nil,nil), got (%+v,%v)", got, err)
	}
}
