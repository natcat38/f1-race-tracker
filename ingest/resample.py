"""Pure nearest-neighbour / step lookup helpers used by record.py's resampling.

Kept free of fastf1/numpy/pandas — same rationale as ghost.py/radio.py — so
they're independently unit-testable and importable in the CI contract job
(which installs only `redis`).
"""
import bisect


def nearest_index(sorted_values, query):
    """Index into sorted_values (ascending) of the entry closest to query.

    Unlike a bare bisect/searchsorted, this compares both neighbours, so it is
    a true nearest-neighbour lookup rather than a "next value at-or-after"
    ceiling.
    """
    i = bisect.bisect_left(sorted_values, query)
    if i == 0:
        return 0
    if i == len(sorted_values):
        return len(sorted_values) - 1
    before, after = sorted_values[i - 1], sorted_values[i]
    return i - 1 if (query - before) <= (after - query) else i


def step_value(times, values, t, default):
    """Last values[i] where times[i] <= t (right-continuous step function).

    times must be ascending. Returns default if t is before the first time
    (or times is empty).
    """
    i = bisect.bisect_right(times, t) - 1
    return values[i] if i >= 0 else default


def in_window_ms(time_ms, window_start_s, window_end_s):
    """True if time_ms (session-relative ms) falls in the baked window
    [window_start_s, window_end_s) seconds — half-open, so a message/capture
    exactly at the upper bound is excluded. Shared by radio.py and
    race_control.py so the boundary convention can't silently drift between them.
    """
    return window_start_s * 1000 <= time_ms < window_end_s * 1000
