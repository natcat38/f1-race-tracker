"""Tests for the resampler's nearest-neighbour grid lookup and windowing helpers."""

from resample import UNKNOWN_POS, in_window_ms, nearest_index, reconcile_positions, step_value


def test_nearest_index_picks_closer_neighbour_not_ceiling():
    # Regression: a bare bisect/searchsorted picks the next value at-or-after
    # the query (a ceiling lookup), not the truly nearest one.
    grid = [0, 1, 2, 3]
    assert nearest_index(grid, 0.4) == 0  # nearest is 0 (dist .4), not 1 (dist .6)
    assert nearest_index(grid, 0.6) == 1  # nearest is 1 (dist .4), not 0 (dist .6)


def test_nearest_index_exact_match():
    assert nearest_index([0, 1, 2, 3], 1.0) == 1
    assert nearest_index([0, 1, 2, 3], 0.0) == 0


def test_nearest_index_out_of_range_clamps_to_ends():
    assert nearest_index([0, 1, 2, 3], -5) == 0
    assert nearest_index([0, 1, 2, 3], 10) == 3


def test_nearest_index_tie_prefers_earlier():
    assert nearest_index([0, 2], 1.0) == 0  # equidistant -> earlier index


def test_step_value_holds_last_value_at_or_before_t():
    times = [10, 20, 30]
    values = ['a', 'b', 'c']
    assert step_value(times, values, 5, 'default') == 'default'   # before first
    assert step_value(times, values, 10, 'default') == 'a'        # exact
    assert step_value(times, values, 15, 'default') == 'a'        # holds
    assert step_value(times, values, 20, 'default') == 'b'
    assert step_value(times, values, 999, 'default') == 'c'       # holds to the end


def test_step_value_empty_returns_default():
    assert step_value([], [], 5, 'default') == 'default'


def test_in_window_ms_half_open():
    assert in_window_ms(3300000, 3300, 3750) is True   # at lower bound: included
    assert in_window_ms(3749999, 3300, 3750) is True   # just under upper bound
    assert in_window_ms(3750000, 3300, 3750) is False  # at upper bound: excluded
    assert in_window_ms(3299999, 3300, 3750) is False  # just before lower bound


def test_reconcile_positions_sinks_retired_car_below_running_cars():
    # Retired car holds the best raw 'pos' (stale from before it retired) but
    # must rank behind every still-running car regardless.
    cars = [
        {'driverNum': 1, 'pos': 1, 'lap': 5, 'status': 'Out'},
        {'driverNum': 2, 'pos': 2, 'lap': 5, 'status': 'OnTrack'},
        {'driverNum': 3, 'pos': 3, 'lap': 5, 'status': 'OnTrack'},
    ]
    reconcile_positions(cars)
    assert [c['driverNum'] for c in cars] == [2, 3, 1]
    assert [c['pos'] for c in cars] == [1, 2, 3]


def test_reconcile_positions_keeps_retired_cars_in_stable_relative_order():
    # Three retired cars, deliberately NOT in raw-pos/lap order in the input
    # list — they must keep their original relative order among themselves
    # (no secondary tie-break), all sunk below the one running car.
    cars = [
        {'driverNum': 5, 'pos': UNKNOWN_POS, 'lap': 10, 'status': 'Out'},
        {'driverNum': 2, 'pos': 1, 'lap': 20, 'status': 'Out'},
        {'driverNum': 9, 'pos': 3, 'lap': 1, 'status': 'Out'},
        {'driverNum': 1, 'pos': 4, 'lap': 30, 'status': 'OnTrack'},
    ]
    reconcile_positions(cars)
    assert [c['driverNum'] for c in cars] == [1, 5, 2, 9]
    assert [c['pos'] for c in cars] == [1, 2, 3, 4]


def test_reconcile_positions_still_contiguous_1_to_n_with_mixed_statuses():
    # The event-model guarantee (unique, contiguous 1..N) must survive the
    # retired-car change, even with duplicate/UNKNOWN_POS raw positions.
    cars = [
        {'driverNum': 44, 'pos': UNKNOWN_POS, 'lap': 3, 'status': 'Out'},
        {'driverNum': 1, 'pos': 2, 'lap': 5, 'status': 'OnTrack'},
        {'driverNum': 16, 'pos': 2, 'lap': 5, 'status': 'OnTrack'},  # dup raw pos
        {'driverNum': 63, 'pos': UNKNOWN_POS, 'lap': 4, 'status': 'OnTrack'},
        {'driverNum': 4, 'pos': 1, 'lap': 6, 'status': 'Out'},
    ]
    reconcile_positions(cars)
    assert [c['pos'] for c in cars] == list(range(1, len(cars) + 1))
    # Both retired cars (44, 4) land after both running cars (1, 16, 63).
    retired_ranks = [c['pos'] for c in cars if c['status'] == 'Out']
    running_ranks = [c['pos'] for c in cars if c['status'] != 'Out']
    assert min(retired_ranks) > max(running_ranks)
