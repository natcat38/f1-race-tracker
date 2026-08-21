"""Unit tests for the pure gap-estimator geometry in ingest/geometry.py."""
import math

import pytest

from geometry import (
    invert_distance_curve,
    lap_deficit,
    project_to_arc,
    resample_closed_loop,
    wrap_counts,
)


def _circle(n, r=100.0):
    return [(r * math.cos(2 * math.pi * k / n), r * math.sin(2 * math.pi * k / n))
            for k in range(n)]


def test_resample_closed_loop_spacing_is_uniform():
    # A unit-ish circle sampled unevenly still comes back evenly spaced.
    raw = _circle(37)
    nodes, lap_length = resample_closed_loop(raw, 200)
    assert len(nodes) == 200
    gaps = [math.dist(nodes[i], nodes[(i + 1) % 200]) for i in range(200)]
    # Even in ARC length; chords differ only where a node straddles a polygon corner.
    assert max(gaps) / min(gaps) < 1.01
    # Chord length of a 37-gon vs the true circumference: within a fraction of a %.
    assert lap_length == pytest.approx(2 * math.pi * 100, rel=0.01)


def test_resample_closed_loop_keeps_the_start_point():
    nodes, _ = resample_closed_loop([(0, 0), (10, 0), (10, 10), (0, 10)], 8)
    assert nodes[0] == (0, 0)


def test_resample_closed_loop_rejects_degenerate_input():
    with pytest.raises(ValueError):
        resample_closed_loop([(0, 0), (1, 1)], 10)
    with pytest.raises(ValueError):
        resample_closed_loop([(0, 0), (1, 1), (2, 2)], 2)


def test_project_to_arc_is_continuous_between_nodes():
    # Square of side 100, 4 nodes: a point midway along the first edge must read
    # exactly half a segment, NOT snap to a node (the old estimator's defect).
    nodes = [(0, 0), (100, 0), (100, 100), (0, 100)]
    lap = 400.0
    assert project_to_arc(50, 0, nodes, 0, lap) == pytest.approx(50.0)
    assert project_to_arc(25, 0, nodes, 0, lap) == pytest.approx(25.0)
    assert project_to_arc(100, 40, nodes, 1, lap) == pytest.approx(140.0)


def test_project_to_arc_uses_the_better_of_the_two_adjacent_segments():
    nodes = [(0, 0), (100, 0), (100, 100), (0, 100)]
    # Just BEFORE node 1: the correct segment is the one ending at node 1.
    assert project_to_arc(90, 1, nodes, 1, 400.0) == pytest.approx(90.0, abs=0.5)


def test_project_to_arc_wraps_at_the_start_line():
    nodes = [(0, 0), (100, 0), (100, 100), (0, 100)]
    # Midway along the closing edge (node 3 -> node 0), so s ~ 350.
    assert project_to_arc(0, 50, nodes, 3, 400.0) == pytest.approx(350.0)


def test_project_to_arc_offtrack_point_still_lands_on_the_line():
    nodes = [(0, 0), (100, 0), (100, 100), (0, 100)]
    # 5 m off the racing line: the longitudinal reading is unaffected.
    assert project_to_arc(50, 5, nodes, 0, 400.0) == pytest.approx(50.0)


def test_wrap_counts_counts_start_finish_crossings():
    # Frame-to-frame steps are small (a car covers ~7 m per 100 ms tick), so only a
    # start/finish crossing produces a jump of more than half a lap.
    lap = 1000.0
    s_values = [(7.0 * k) % lap for k in range(430)]  # three crossings' worth
    counts = wrap_counts(s_values, lap)
    assert counts[0] == 0
    assert counts[-1] == 3
    assert counts == sorted(counts)                      # never decreases
    assert counts[142] == 0 and counts[143] == 1         # 994.0 -> 1.0 crosses


def test_wrap_counts_ignores_noise_that_straddles_the_line_backwards():
    # Car sits on the line and jitters across it: each backwards straddle is un-counted,
    # so the lap index cannot flicker upwards frame after frame.
    assert wrap_counts([998, 2, 998, 2, 6], 1000) == [0, 1, 0, 1, 1]


def test_wrap_counts_ignores_small_backwards_steps():
    assert wrap_counts([100, 99, 101], 1000) == [0, 0, 0]


def test_invert_distance_curve_interpolates_between_samples():
    times = [0.0, 1.0, 2.0]
    dists = [0.0, 100.0, 300.0]
    assert invert_distance_curve(times, dists, 50) == pytest.approx(0.5)
    assert invert_distance_curve(times, dists, 200) == pytest.approx(1.5)
    assert invert_distance_curve(times, dists, 100) == pytest.approx(1.0)


def test_invert_distance_curve_returns_none_outside_the_observed_range():
    # The window-edge case: no honest gap exists, so no number is fabricated.
    assert invert_distance_curve([0.0, 1.0], [10.0, 20.0], 5) is None
    assert invert_distance_curve([0.0, 1.0], [10.0, 20.0], 25) is None
    assert invert_distance_curve([], [], 1) is None


def test_invert_distance_curve_handles_a_stationary_plateau():
    # A stopped car repeats a distance; the inversion must not divide by zero.
    assert invert_distance_curve([0.0, 1.0, 2.0], [0.0, 50.0, 50.0], 50) == pytest.approx(1.0)


def test_lap_deficit_is_distance_derived_with_tolerance():
    assert lap_deficit(0, 5000) == 0
    assert lap_deficit(4000, 5000) == 0
    assert lap_deficit(4600, 5000) == 1     # inside the 0.1-lap tolerance
    assert lap_deficit(5200, 5000) == 1
    assert lap_deficit(10500, 5000) == 2
    assert lap_deficit(-100, 5000) == 0
