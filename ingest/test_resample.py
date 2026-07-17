from resample import in_window_ms, nearest_index, step_value


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
