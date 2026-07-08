"""Pure helper for baking a per-driver lap trace into a clip header.

Kept free of fastf1/numpy/pandas so it is unit-testable and importable in the CI
contract job (which installs only `redis`). The recorder does the FastF1 fetch,
lap selection, and coordinate normalisation, then hands plain lists here.
"""


def build_lap_trace(sample_ts, sample_xy, track_xy):
    """Cumulative lap time (ms from lap start) at each track-outline index.

    sample_ts: lap sample times in seconds, ascending (one reference lap).
    sample_xy: [(x, y)] normalised positions, same length as sample_ts.
    track_xy:  [(x, y)] the baked outline points.

    For each sample (in time order) we find its nearest outline index and record
    the FIRST time that index is reached. Unreached indices carry the previous
    value forward, so the result is length len(track_xy), starts at 0, and is
    monotonic non-decreasing — well-defined to invert (time -> index) later.
    """
    if not sample_ts:
        return [0] * len(track_xy)
    n = len(track_xy)
    t0 = sample_ts[0]
    reached = [None] * n
    # ponytail: O(len(sample_ts) * len(track_xy)) brute-force nearest-point search,
    # run once per driver per clip bake (record.py) — fine at today's ~150 track
    # points and one lap's samples (well under a second total). If TRACK_POINTS
    # or sample density grows enough to matter, switch to a spatial index (e.g.
    # a k-d tree) or bisection against a precomputed cumulative-arc-length
    # parameterization of the outline.
    for ts, (sx, sy) in zip(sample_ts, sample_xy):
        bi, bd = 0, None
        for i, (tx, ty) in enumerate(track_xy):
            d = (tx - sx) ** 2 + (ty - sy) ** 2
            if bd is None or d < bd:
                bd, bi = d, i
        if reached[bi] is None:
            reached[bi] = round((ts - t0) * 1000)
    trace = []
    last = 0
    for i in range(n):
        # A reached value that would break monotonicity is silently discarded;
        # the carried-forward value is correct for the downstream time->index inversion.
        if reached[i] is not None and reached[i] >= last:
            last = reached[i]
        trace.append(last)
    # Guarantee the contract invariant: trace[0] == 0.
    # Outline index 0 may be "reached" mid-lap (non-zero ms) if the car's first
    # sample is nearest to a later index; force 0 so the ghost's time->index
    # inversion always has a clean anchor.
    if trace:
        trace[0] = 0
    return trace
