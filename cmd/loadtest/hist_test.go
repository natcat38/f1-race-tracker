package main

import (
	"encoding/json"
	"testing"

	"github.com/natcat38/f1-race-tracker/internal/model"
)

func TestHist_PercentileAndMax(t *testing.T) {
	h := newHist()
	for i := int64(1); i <= 100; i++ {
		h.Add(i)
	}
	if got := h.Percentile(0.50); got != 50 {
		t.Errorf("p50 = %d, want 50", got)
	}
	if got := h.Percentile(0.99); got != 99 {
		t.Errorf("p99 = %d, want 99", got)
	}
	if got := h.Max(); got != 100 {
		t.Errorf("max = %d, want 100", got)
	}
	if got := h.Count(); got != 100 {
		t.Errorf("count = %d, want 100", got)
	}
}

func TestHist_EmptyIsZero(t *testing.T) {
	h := newHist()
	if got := h.Percentile(0.5); got != 0 {
		t.Errorf("empty p50 = %d, want 0", got)
	}
}

func TestHist_OverflowUsesCeilingButMaxIsTrue(t *testing.T) {
	h := newHist()
	h.Add(6000) // beyond histMaxMs
	if got := h.Percentile(0.99); got != histMaxMs {
		t.Errorf("overflow p99 = %d, want %d", got, histMaxMs)
	}
	if got := h.Max(); got != 6000 {
		t.Errorf("max = %d, want 6000 (true value preserved)", got)
	}
}

func TestHist_Merge(t *testing.T) {
	a, b := newHist(), newHist()
	a.Add(10)
	a.Add(20)
	b.Add(30)
	a.Merge(b)
	if got := a.Count(); got != 3 {
		t.Errorf("merged count = %d, want 3", got)
	}
	if got := a.Max(); got != 30 {
		t.Errorf("merged max = %d, want 30", got)
	}
}

func envFrame(t *testing.T, tMs int64) []byte {
	t.Helper()
	d, _ := json.Marshal(model.Frame{T: tMs})
	b, _ := json.Marshal(wsEnvelope{Type: "frame", Data: d})
	return b
}

func TestParseFrameLatency_FrameYieldsLatency(t *testing.T) {
	raw := envFrame(t, 1000)
	lat, ok := parseFrameLatency(raw, 1050)
	if !ok || lat != 50 {
		t.Errorf("got (%d,%v), want (50,true)", lat, ok)
	}
}

func TestParseFrameLatency_SnapshotSkipped(t *testing.T) {
	b, _ := json.Marshal(wsEnvelope{Type: "snapshot", Data: json.RawMessage(`{}`)})
	if _, ok := parseFrameLatency(b, 1050); ok {
		t.Error("snapshot envelope should not yield a latency sample")
	}
}

func TestParseFrameLatency_GarbageSkipped(t *testing.T) {
	if _, ok := parseFrameLatency([]byte("not json"), 1050); ok {
		t.Error("malformed input should not yield a sample")
	}
}

func TestParseFrameLatency_MissingTSkipped(t *testing.T) {
	if _, ok := parseFrameLatency(envFrame(t, 0), 1050); ok {
		t.Error("a frame with T==0 should not yield a sample")
	}
}
