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


def normalise_point(x, y, x_min, y_min, max_range, x_offset, y_offset):
    """Normalise one X/Y sample into a [0,1] unit box given precomputed bounds.

    Just the formula: record.py fixes x_min/y_min/max_range/offsets once from
    the whole session up front, live_signalr.py's BoundBox grows them
    incrementally then freezes — those bounds-accumulation strategies are
    legitimately different and stay in each caller; only the shared final
    step lives here.
    """
    nx = (x - x_min + x_offset) / max_range
    ny = 1.0 - (y - y_min + y_offset) / max_range  # flip Y for SVG
    return round(float(nx), 4), round(float(ny), 4)


def in_window_ms(time_ms, window_start_s, window_end_s):
    """True if time_ms (session-relative ms) falls in the baked window
    [window_start_s, window_end_s) seconds — half-open, so a message/capture
    exactly at the upper bound is excluded. Shared by radio.py and
    race_control.py so the boundary convention can't silently drift between them.
    """
    return window_start_s * 1000 <= time_ms < window_end_s * 1000


# "No position data at all" sentinel — sorts after every real position (1..20)
# rather than reaching the wire, per reconcile_positions below.
UNKNOWN_POS = 99


def reconcile_positions(cars):
    """Reconcile a frame's per-car 'pos' into a unique, contiguous 1..N order.

    Each driver's position is looked up independently (per-driver step lookup
    into their own timeline), so nothing guarantees the values agree with each
    other across drivers at a given instant: one driver's most recent update
    can be stale relative to another's, producing duplicate positions, gaps,
    and UNKNOWN_POS (99) reaching the wire (see issue #66).

    This reconciles once per frame: retired cars (status 'Out') sink to the
    tail as one block, kept in their existing relative order (stable sort —
    no further tie-break among them, since a retired car's raw 'pos'/'lap'
    freeze the moment it retires and aren't a meaningful ranking any more).
    Every still-running car sorts ahead of that block, by its most recent
    known raw position (UNKNOWN_POS sorts last within the running group),
    tie-broken by laps completed (descending) then driver number (ascending)
    — the same tie-break web/src/components/timingHelpers.ts's orderCars
    uses, so a frame that still needed a tie-break server-side agrees with
    how the frontend would have broken it. Then renumber 1..N over the whole
    sorted list so every frame's running order is unique and contiguous, and
    99 never reaches the wire.

    # ponytail: cold start is a known gap, deliberately left unfixed here.
    # The renumbering is over whoever is in `cars` right now, so a partial
    # roster (only some drivers have reported at session start) gets a dense
    # 1..N over that subset — i.e. a plausible-looking but wrong running
    # order until the whole field reports. Ceiling: every writer sends a
    # full-roster DriverList within the first couple of frames, so the
    # wrong-order window is a handful of frames at session start, never a
    # whole session — not worth the complexity below. Upgrade path, if it
    # ever matters: withhold reconciliation (or flag the frame's order
    # provisional) until a known full-roster count is reached.

    cars: list of dicts, each with at least 'driverNum' and 'pos' (raw,
    possibly stale/duplicate/UNKNOWN_POS), and optionally 'lap' (laps
    completed so far) and 'status'. Mutates each dict's 'pos' in place.
    Returns the same list, now sorted into running order (rank 1 first).

    Callers must pass RAW feed positions, not a previous call's output mixed
    with fresh values: this renumbers in place, so re-feeding a car's own rank
    as if it were feed data lets that rank stick (see live_signalr's
    _publish_frame, which re-stamps every car from running_positions first).
    """
    def _rank_key(c):
        if c.get('status') == 'Out':
            return (True,)  # retired: one tail block, stable among themselves
        return (False, c.get('pos', UNKNOWN_POS), -(c.get('lap') or 0), c['driverNum'])

    cars.sort(key=_rank_key)
    for i, c in enumerate(cars):
        c['pos'] = i + 1
    return cars
