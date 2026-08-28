"""Pure geometry behind the replay gap/interval estimator.

Kept free of fastf1/numpy/pandas — same rationale as ghost.py/resample.py — so it
is independently unit-testable and importable in the CI contract job (which
installs only `redis`). record.py does the FastF1 fetch and hands plain lists here.

THE METHOD, in three steps:

1. **A distance-parameterised centreline.** One clean leader lap of raw X/Y
   (metres) is resampled to a fixed number of nodes *evenly spaced in arc length*
   (`resample_closed_loop`). The 150-point display outline this replaces was a
   `linspace` over sample *indices*, and position samples are uniform in time, so
   its nodes bunched up where the car was slow — segment lengths spanned 9.9 m to
   83.5 m at Monza. Even spacing removes that bias by construction.

2. **Race distance in metres.** A car's position is projected onto the segment
   between its nearest node and that node's better neighbour (`project_to_arc`),
   giving a continuous arc length `s` rather than a node index. Race distance is
   `D = laps_completed * lap_length + s`, monotonic by construction once the
   start/finish wrap is counted from `s` itself (`wrap_counts`).

3. **Metres to seconds.** `gapMs` asks "how long ago was the leader here?", so the
   leader's own distance-time curve is inverted at the following car's distance
   (`invert_distance_curve`). No lap-time constant is involved: a slow corner is
   priced as a slow corner because the leader took that long there too. `intMs` is
   the same inversion against the car ahead's curve.

EXPECTED RESOLUTION: ~50-100 ms, dominated by position noise and by each car
running a different racing line from the single reference lap the centreline is
built from — not by any quantum. Honest to one decimal place, never three. See
ingest/README.md for the measured error against official line-crossing times.
"""

import bisect
import math


def _cumulative_arc(xy):
    """Cumulative Euclidean arc length at each point of an open polyline."""
    cum = [0.0]
    for (x0, y0), (x1, y1) in zip(xy, xy[1:], strict=False):  # pairwise by construction: one shorter
        cum.append(cum[-1] + math.hypot(x1 - x0, y1 - y0))
    return cum


def resample_closed_loop(xy, n):
    """Resample a closed loop of (x, y) to n nodes evenly spaced in arc length.

    xy: the reference lap's raw points, in order, NOT repeating the first point.
    Returns (nodes, lap_length) with len(nodes) == n and nodes[0] == xy[0]. The
    loop is closed by appending xy[0] before measuring, so `lap_length` is the
    full closed-lap distance and node n-1 sits one step short of the start.

    Node spacing is lap_length / n by construction — that uniformity, not the node
    count, is what the estimator needs. Raises ValueError on a degenerate input.
    """
    if len(xy) < 3:
        raise ValueError(f"need at least 3 points to close a loop, got {len(xy)}")
    if n < 3:
        raise ValueError(f"need at least 3 nodes, got {n}")
    closed = list(xy) + [xy[0]]
    cum = _cumulative_arc(closed)
    lap_length = cum[-1]
    if lap_length <= 0:
        raise ValueError("reference lap has zero length")

    nodes = []
    j = 0
    for k in range(n):
        target = lap_length * k / n
        while j + 1 < len(cum) - 1 and cum[j + 1] <= target:
            j += 1
        seg = cum[j + 1] - cum[j]
        f = 0.0 if seg <= 0 else (target - cum[j]) / seg
        x0, y0 = closed[j]
        x1, y1 = closed[j + 1]
        nodes.append((x0 + f * (x1 - x0), y0 + f * (y1 - y0)))
    return nodes, lap_length


def project_to_arc(x, y, nodes, nearest_i, lap_length):
    """Arc length s in [0, lap_length) of point (x, y), given its nearest node.

    Projects onto whichever of the two segments adjacent to `nearest_i` the point
    actually falls on, clamped to that segment. This is what removes node
    quantisation: the returned s is continuous, limited by position-data noise
    rather than by the node count. `nearest_i` is passed in because the caller
    (record.py) finds it with a vectorised numpy argmin over the whole clip.
    """
    n = len(nodes)
    step = lap_length / n
    best_s, best_d2 = None, None
    for i in ((nearest_i - 1) % n, nearest_i % n):
        ax, ay = nodes[i]
        bx, by = nodes[(i + 1) % n]
        ux, uy = bx - ax, by - ay
        seg2 = ux * ux + uy * uy
        t = 0.0 if seg2 <= 0 else (x - ax) * ux + (y - ay) * uy
        t = min(max(t / seg2 if seg2 > 0 else 0.0, 0.0), 1.0)
        px, py = ax + t * ux, ay + t * uy
        d2 = (x - px) ** 2 + (y - py) ** 2
        if best_d2 is None or d2 < best_d2:
            best_d2 = d2
            best_s = (i * step + t * math.hypot(ux, uy)) % lap_length
    return best_s


def wrap_counts(s_values, lap_length):
    """Number of start/finish crossings before each entry of s_values.

    s_values is one car's arc length frame by frame. A drop of more than half a
    lap between consecutive frames is a wrap (the car crossed the line); a rise of
    more than half a lap is a backwards wrap (position noise straddling the line),
    and is un-counted so the lap index cannot flicker. Returned counts start at 0
    and are the `laps completed since the window opened` term of race distance.
    """
    half = lap_length / 2
    counts, k = [], 0
    prev = None
    for s in s_values:
        if prev is not None:
            if prev - s > half:
                k += 1
            elif s - prev > half:
                k -= 1
        counts.append(k)
        prev = s
    return counts


def invert_distance_curve(times, dists, d):
    """When was this car at race distance d? Linear inversion of its own curve.

    times/dists are parallel and ascending (dists must be non-decreasing — the
    caller enforces that with a running max). Returns None when d is outside the
    curve's range, which is the honest answer at a window edge: the reference car
    was never observed at that distance, so no gap can be quoted.
    """
    if not dists or d < dists[0] or d > dists[-1]:
        return None
    i = bisect.bisect_left(dists, d)
    if i == 0:
        return times[0]
    d0, d1 = dists[i - 1], dists[i]
    if d1 <= d0:
        return times[i]
    f = (d - d0) / (d1 - d0)
    return times[i - 1] + f * (times[i] - times[i - 1])


def lap_deficit(metres_behind, lap_length, tolerance=0.1):
    """Whole laps behind, from metres — not from a lap-NUMBER difference.

    The lap-number difference reads 1 for every car between the leader crossing
    the line and its own crossing, which is why the tower used to flash "+1 LAP"
    for P2..P20 a few seconds per lap. `tolerance` (in laps) keeps a car exactly
    one lap down from flickering between 0 and 1.
    """
    if lap_length <= 0 or metres_behind <= 0:
        return 0
    return int(metres_behind / lap_length + tolerance)
