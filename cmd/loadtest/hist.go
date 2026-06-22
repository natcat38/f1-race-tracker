package main

import "math"

// histMaxMs is the upper bound (exclusive) of the 1ms-wide buckets. Latencies at
// or above it land in an overflow bucket; the true maximum is still tracked.
const histMaxMs = 5000

// latencyHist is a fixed-bucket histogram of latency in milliseconds. Memory is
// O(histMaxMs) regardless of sample count, so it scales to millions of frames.
type latencyHist struct {
	buckets []int64 // buckets[i] = number of samples with latency == i ms
	over    int64   // samples >= histMaxMs
	count   int64
	max     int64
}

func newHist() *latencyHist {
	return &latencyHist{buckets: make([]int64, histMaxMs)}
}

// Add records one latency sample (negative values are clamped to 0).
func (h *latencyHist) Add(ms int64) {
	if ms < 0 {
		ms = 0
	}
	if ms > h.max {
		h.max = ms
	}
	h.count++
	if ms >= histMaxMs {
		h.over++
		return
	}
	h.buckets[ms]++
}

// Merge folds another histogram into this one (used to combine per-client hists).
func (h *latencyHist) Merge(o *latencyHist) {
	for i, c := range o.buckets {
		h.buckets[i] += c
	}
	h.over += o.over
	h.count += o.count
	if o.max > h.max {
		h.max = o.max
	}
}

// Percentile returns the smallest latency (ms) at or below which fraction q of
// samples fall. Returns 0 for an empty histogram; returns histMaxMs when the
// rank falls in the overflow bucket (a floor — see Max for the true peak).
func (h *latencyHist) Percentile(q float64) int64 {
	if h.count == 0 {
		return 0
	}
	rank := int64(math.Ceil(q * float64(h.count)))
	if rank < 1 {
		rank = 1
	}
	if rank > h.count {
		rank = h.count
	}
	var cum int64
	for ms, c := range h.buckets {
		cum += c
		if cum >= rank {
			return int64(ms)
		}
	}
	return histMaxMs
}

func (h *latencyHist) Max() int64   { return h.max }
func (h *latencyHist) Count() int64 { return h.count }
