"""Self-check for ingest/ghost.build_lap_trace (no fastf1/numpy/network needed).

Collectable by pytest (`pytest ingest`) AND runnable directly
(`python ingest/test_ghost.py`) for the CI contract job.
"""
import sys
from ghost import build_lap_trace, build_pedal_trace, compute_sector_dominance, nan_safe_int


def test_build_lap_trace_basic():
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


def test_build_lap_trace_empty_input():
    track = [(0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0)]
    # Empty samples must not crash — returns all-zero of outline length.
    assert build_lap_trace([], [], track) == [0, 0, 0, 0]


def test_build_lap_trace_carries_unvisited_index_forward():
    # An outline point never visited is carried forward from the previous index.
    track2 = [(0.0, 0.0), (0.5, 0.0), (1.0, 0.0)]
    ts2 = [0.0, 2.0]
    xy2 = [(0.0, 0.0), (1.0, 0.0)]   # the midpoint (0.5,0) is never the nearest
    trace2 = build_lap_trace(ts2, xy2, track2)
    assert trace2[0] == 0 and trace2[2] == 2000, trace2
    assert trace2[1] == 0, trace2  # never the nearest point -> carried forward from index 0


def test_build_lap_trace_anchors_index_zero_even_when_reached_late():
    # Index 0 reached LATE (car's first sample is nearest a later index) must still
    # anchor to 0 — the real-data case (Piastri Monza 2024) the contract invariant guards.
    track3 = [(0.0, 0.0), (1.0, 0.0)]
    ts3 = [0.0, 1.0]
    xy3 = [(1.0, 0.0), (0.0, 0.0)]  # first sample nearest index 1; index 0 reached at t=1s
    trace3 = build_lap_trace(ts3, xy3, track3)
    assert trace3[0] == 0, trace3
    assert all(trace3[i] >= trace3[i - 1] for i in range(1, len(trace3))), trace3


def test_build_pedal_trace_basic():
    track = [(0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0)]
    ts = [10.0, 11.0, 12.0, 13.0]
    xy = [(0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0)]
    throttle = [10, 100, 100, 0]
    brake = [0, 0, 0, 100]
    gear = [1, 5, 6, 2]

    trace = build_pedal_trace(ts, xy, track, throttle, brake, gear)

    assert trace["throttle"] == [10, 100, 100, 0], trace
    assert trace["brake"] == [0, 0, 0, 100], trace
    assert trace["gear"] == [1, 5, 6, 2], trace


def test_build_pedal_trace_empty_input():
    track = [(0.0, 0.0), (1.0, 0.0)]
    trace = build_pedal_trace([], [], track, [], [], [])
    assert trace == {"throttle": [0, 0], "brake": [0, 0], "gear": [0, 0]}, trace


def test_build_pedal_trace_carries_unvisited_index_forward():
    track = [(0.0, 0.0), (0.5, 0.0), (1.0, 0.0)]
    ts = [0.0, 2.0]
    xy = [(0.0, 0.0), (1.0, 0.0)]  # midpoint never nearest
    trace = build_pedal_trace(ts, xy, track, [20, 90], [0, 0], [1, 4])
    assert trace["throttle"] == [20, 20, 90], trace
    assert trace["gear"] == [1, 1, 4], trace


def test_compute_sector_dominance_picks_fastest_per_bin():
    # 4 outline points, bin_size=2 -> 2 bins: [0,2] and [2,3].
    # Driver 1 is faster in bin 0 (1000ms vs 2000ms), driver 2 faster in bin 1.
    lap_traces = {
        1: [0, 1000, 1500, 3500],
        2: [0, 2000, 2500, 2600],
    }
    out = compute_sector_dominance(lap_traces, n_points=4, bin_size=2)
    # [1, 2] for the two real bins, plus one extra wraparound entry (#112).
    assert out == [1, 2, 2], out


def test_compute_sector_dominance_no_data_is_zero():
    assert compute_sector_dominance({}, n_points=4, bin_size=2) == [0, 0, 0]


def test_compute_sector_dominance_wraparound_matches_frontend_segment_count():
    # geometry.ts's trackSegmentPaths appends one closing segment (track[n-1] ->
    # track[0]) on top of its ceil(n_points/bin_size) binned segments; this
    # array must carry a matching extra entry so segment i still lines up with
    # sectorDominance[i] on both sides of the contract (#112).
    lap_traces = {1: [0, 1000, 1500, 3500]}
    out = compute_sector_dominance(lap_traces, n_points=4, bin_size=2)
    assert len(out) == 3  # 2 binned entries + 1 wraparound entry
    assert out[-1] == out[-2]  # wraparound reuses the last bin's leader


def test_nan_safe_int_zeroes_a_telemetry_gap():
    # A dropped car_data sample surfaces as NaN (#111); nan_safe_int must not let
    # NumPy's undefined float->int NaN cast (a garbage large-negative int) through.
    nan = float("nan")
    assert nan_safe_int([10.0, nan, 90.0]) == [10, 0, 90]


def test_compute_sector_dominance_skips_non_positive_deltas():
    # Driver 1 never advances in bin 0 (degenerate/unreached) — driver 2 wins by default.
    lap_traces = {1: [0, 0, 0], 2: [0, 50, 100]}
    out = compute_sector_dominance(lap_traces, n_points=3, bin_size=2)
    assert out[0] == 2, out


if __name__ == "__main__":
    test_build_lap_trace_basic()
    test_build_lap_trace_empty_input()
    test_build_lap_trace_carries_unvisited_index_forward()
    test_build_lap_trace_anchors_index_zero_even_when_reached_late()
    test_build_pedal_trace_basic()
    test_build_pedal_trace_empty_input()
    test_build_pedal_trace_carries_unvisited_index_forward()
    test_compute_sector_dominance_picks_fastest_per_bin()
    test_compute_sector_dominance_no_data_is_zero()
    test_compute_sector_dominance_wraparound_matches_frontend_segment_count()
    test_compute_sector_dominance_skips_non_positive_deltas()
    test_nan_safe_int_zeroes_a_telemetry_gap()
    print("ghost.build_lap_trace / build_pedal_trace / compute_sector_dominance self-check PASSED")
    sys.exit(0)
