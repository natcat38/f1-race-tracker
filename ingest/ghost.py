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
    for ts, (sx, sy) in zip(sample_ts, sample_xy, strict=True):
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


def build_pedal_trace(sample_ts, sample_xy, track_xy, throttle_vals, brake_vals, gear_vals):
    """Throttle/brake/gear at each track-outline index, over one reference lap.

    Same nearest-outline-index bucketing as build_lap_trace, but instead of
    recording elapsed time at first-reached, records that sample's pedal/gear
    values. Unreached indices carry the previous value forward (matches
    build_lap_trace's fill rule) so all three arrays are always fully populated,
    length len(track_xy).

    sample_ts/sample_xy/track_xy: as build_lap_trace.
    throttle_vals/brake_vals/gear_vals: parallel lists, same length as sample_ts.
    """
    n = len(track_xy)
    if not sample_ts or n == 0:
        return {"throttle": [0] * n, "brake": [0] * n, "gear": [0] * n}
    reached = [None] * n
    # ponytail: same brute-force nearest-point search as build_lap_trace, run once
    # per driver per clip bake — see that function's comment for the cost analysis.
    for _ts, (sx, sy), th, br, gr in zip(
        sample_ts, sample_xy, throttle_vals, brake_vals, gear_vals, strict=True
    ):
        bi, bd = 0, None
        for i, (tx, ty) in enumerate(track_xy):
            d = (tx - sx) ** 2 + (ty - sy) ** 2
            if bd is None or d < bd:
                bd, bi = d, i
        if reached[bi] is None:
            reached[bi] = (int(th), int(br), int(gr))
    throttle, brake, gear = [], [], []
    last = (0, 0, 0)
    for i in range(n):
        if reached[i] is not None:
            last = reached[i]
        throttle.append(last[0])
        brake.append(last[1])
        gear.append(last[2])
    return {"throttle": throttle, "brake": brake, "gear": gear}


def compute_sector_dominance(lap_traces, n_points, bin_size):
    """Fastest driver's number through each fixed-size minisector of the outline.

    lap_traces: {driver_num: [cum_ms,...]} of length n_points, as built by
    build_lap_trace (cumulative elapsed ms at each track-outline index, over
    that driver's own fastest lap). Bins are [start, min(start+bin_size, n-1)]
    windows, matching web/src/components/geometry.ts's trackSegmentPaths so
    segment i lines up with sectorDominance[i] on both sides of the contract.

    Returns one driver number per bin — the driver with the least elapsed time
    across that bin's window — or 0 when no driver has a positive time delta
    there (e.g. too few points, or no lap trace data at all).
    """
    out = []
    for start in range(0, n_points, bin_size):
        end = min(start + bin_size, n_points - 1)
        best_driver, best_delta = 0, None
        for dnum, trace in lap_traces.items():
            delta = trace[end] - trace[start]
            if delta <= 0:
                continue
            if best_delta is None or delta < best_delta:
                best_delta, best_driver = delta, dnum
        out.append(best_driver)
    return out
