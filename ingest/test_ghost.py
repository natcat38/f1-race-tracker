"""Self-check for ingest/ghost.build_lap_trace (no fastf1/numpy/network needed)."""
import sys
from ghost import build_lap_trace

# A 4-point square outline; index 0 = start/finish.
track = [(0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0)]

# A lap that visits each corner in order at t = 10,11,12,13,14s (last sample back at start).
ts = [10.0, 11.0, 12.0, 13.0, 14.0]
# last sample returns to start; first-reach guard must not overwrite reached[0]
xy = [(0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0), (0.0, 0.0)]

trace = build_lap_trace(ts, xy, track)

assert len(trace) == len(track), f"length {len(trace)} != {len(track)}"
assert trace[0] == 0, f"trace[0] must be 0, got {trace[0]}"
# cumulative ms from lap start: corners reached at +0, +1000, +2000, +3000 ms
assert trace == [0, 1000, 2000, 3000], trace
# monotonic non-decreasing
assert all(trace[i] >= trace[i - 1] for i in range(1, len(trace))), trace

# Empty samples must not crash — returns all-zero of outline length.
assert build_lap_trace([], [], track) == [0, 0, 0, 0]

# An outline point never visited is carried forward from the previous index.
track2 = [(0.0, 0.0), (0.5, 0.0), (1.0, 0.0)]
ts2 = [0.0, 2.0]
xy2 = [(0.0, 0.0), (1.0, 0.0)]   # the midpoint (0.5,0) is never the nearest
trace2 = build_lap_trace(ts2, xy2, track2)
assert trace2[0] == 0 and trace2[2] == 2000, trace2
assert trace2[1] == 0, trace2  # never the nearest point -> carried forward from index 0

# Index 0 reached LATE (car's first sample is nearest a later index) must still
# anchor to 0 — the real-data case (Piastri Monza 2024) the contract invariant guards.
track3 = [(0.0, 0.0), (1.0, 0.0)]
ts3 = [0.0, 1.0]
xy3 = [(1.0, 0.0), (0.0, 0.0)]  # first sample nearest index 1; index 0 reached at t=1s
trace3 = build_lap_trace(ts3, xy3, track3)
assert trace3[0] == 0, trace3
assert all(trace3[i] >= trace3[i - 1] for i in range(1, len(trace3))), trace3

print("ghost.build_lap_trace self-check PASSED")
sys.exit(0)
