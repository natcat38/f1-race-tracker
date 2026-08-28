"""Measure the baked gap/interval estimator against official line-crossing times.

Ground truth needs no new download: `session.laps.LapStartTime` is the moment a
driver crossed the start/finish line, from F1's own timing loops. When car C
crosses the line to begin lap N, the true gap to the leader is
`LapStartTime[C, N] - LapStartTime[leader, N]` — both cars measured at the same
point on the same lap. The estimator's job is to reproduce that number from track
position alone, so this script reads the baked `gapMs` at the frame nearest each
crossing and reports how far off it is.

`intMs` is checked the same way against the car directly ahead in the clip's own
running order at that frame.

Collectable by pytest (`pytest ingest`) AND runnable directly
(`python ingest/check_gap_estimator.py`). The FastF1 half needs the local session
cache (cache/, ~284 MB, not in the repo), so the pytest case SKIPS when the cache
or a clip is missing — CI has neither, and the pure geometry underneath is covered
by test_geometry.py, which CI does run.

Usage:
  .venv/Scripts/python.exe ingest/check_gap_estimator.py [clip-key ...]
"""

import json
import os
import statistics
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
CACHE_DIR = REPO / "cache"

# The three committed clips and the sessions they were baked from. Lap windows are
# content-chosen (real green-flag pit stops) — see ingest/README.md.
CLIPS = {
    "monza-2024":       ("data/replays/monza-2024-race.jsonl", 2024, "Monza"),
    "monza-2023":       ("data/replays/monza-2023-race.jsonl", 2023, "Monza"),
    "silverstone-2024": ("data/replays/silverstone-2024-race.jsonl", 2024, "Silverstone"),
}

# Pass/fail gates. Sized off the measured numbers for the arc-length estimator
# (median |error| ~0.1 s), with enough headroom that ordinary session-to-session
# variation does not trip them, and tight enough to catch a regression to the old
# outline-index estimator (which measured a median |error| several times larger).
MAX_MEDIAN_ABS_MS = 250
MAX_P95_ABS_MS = 600

# How many evenly spaced frames to check the gap column's monotonicity on.
MONOTONICITY_SAMPLES = 400


def _p95(xs):
    return sorted(xs)[min(len(xs) - 1, int(round(0.95 * (len(xs) - 1))))]


def load_clip(path):
    """(header, frames) — frames as a list of dicts, one per line, in time order."""
    lines = Path(path).read_text(encoding="utf-8").splitlines()
    header = json.loads(lines[0])
    return header, lines[1:]


def frame_index_for(frames, target_ms):
    """Index of the frame whose timeMs is nearest target_ms.

    The grid is uniform 10 Hz, so this is arithmetic rather than a scan over 4000+
    parsed lines — the whole point of not JSON-decoding a 24 MB clip to find one
    frame.
    """
    first = json.loads(frames[0])["timeMs"]
    step = json.loads(frames[1])["timeMs"] - first
    i = int(round((target_ms - first) / step))
    return i if 0 <= i < len(frames) else None


def monotonicity(frames):
    """Fraction of sampled frames whose gap column never decreases down the order.

    INFORMATIONAL, not a gate. The estimator itself is monotonic by construction —
    every car is read off ONE shared leader curve — but `pos` is not: it comes from
    FastF1's lap-level Position column, which only updates when a car crosses the
    line. Through a pit-stop phase the classified order therefore lags the road
    order by up to a lap, and a car that has really passed another still reads
    behind it. That mismatch, not the estimate, is what remains of review finding
    M10, and it is why the frontend's displayGaps() clamp stays load-bearing for
    replay rather than being demoted to a live-lane safety net.
    """
    n = len(frames)
    step = max(1, n // MONOTONICITY_SAMPLES)
    ok = total = 0
    for i in range(0, n, step):
        cars = json.loads(frames[i])["frame"]["cars"]
        gaps = [c["gapMs"] for c in sorted(cars, key=lambda c: c["pos"]) if "gapMs" in c]
        total += 1
        ok += all(a <= b for a, b in zip(gaps, gaps[1:], strict=False))  # pairwise: one shorter
    return ok / total if total else 1.0


def measure(clip_path, year, gp):
    """Error stats for one clip. Returns a dict; raises if FastF1 can't load."""
    import fastf1

    fastf1.Cache.enable_cache(str(CACHE_DIR))
    session = fastf1.get_session(year, gp, "R")
    session.load(telemetry=False, weather=False, messages=False)

    header, frames = load_clip(clip_path)
    t_first = json.loads(frames[0])["timeMs"]
    t_last = json.loads(frames[-1])["timeMs"]

    # driver -> {lap number: crossing time in ms}, from official timing loops,
    # plus driver -> [pit entry times in ms] (see the interval guard below).
    crossings, pit_ins = {}, {}
    for _, lap in session.laps.iterrows():
        dnum = str(int(lap["DriverNumber"]))
        t = lap["LapStartTime"]
        if t is not None and t == t:  # not NaT
            crossings.setdefault(dnum, {})[int(lap["LapNumber"])] = t.total_seconds() * 1000.0
        pit_in, pit_out = lap["PitInTime"], lap["PitOutTime"]
        if pit_in is not None and pit_in == pit_in:
            pit_ins.setdefault(dnum, []).append([pit_in.total_seconds() * 1000.0, None])
        if pit_out is not None and pit_out == pit_out and pit_ins.get(dnum):
            pit_ins[dnum][-1][1] = pit_out.total_seconds() * 1000.0

    gap_err, int_err = [], []
    for dnum, laps in crossings.items():
        for lap_no, t_ms in laps.items():
            if not (t_first <= t_ms <= t_last):
                continue
            i = frame_index_for(frames, t_ms)
            if i is None:
                continue
            frame = json.loads(frames[i])["frame"]
            order = sorted(frame["cars"], key=lambda c: c["pos"])
            me = next((c for c in order if str(c["driverNum"]) == dnum), None)
            if me is None or me["pos"] == 1:
                continue
            leader = str(order[0]["driverNum"])
            truth = crossings.get(leader, {}).get(lap_no)
            if truth is not None and "gapMs" in me:
                gap_err.append(me["gapMs"] - (t_ms - truth))

            # The interval is only comparable when the crossing difference measures
            # the same thing the estimator does. Two conditions: the car ahead is on
            # the same lap (against a car a lap up, the same lap number is a
            # different moment in the race), and neither car was in the pit lane
            # between the two crossings — a stop costs ~20 s AFTER the line, so the
            # line-crossing difference and the on-road interval legitimately differ
            # by the whole stop and neither number is wrong.
            ahead = order[me["pos"] - 2]
            ahead_num = str(ahead["driverNum"])
            truth_int = crossings.get(ahead_num, {}).get(lap_no)
            pitted = truth_int is not None and any(
                (out or (a + 30_000)) > truth_int and a <= t_ms
                for who in (ahead_num, dnum) for a, out in pit_ins.get(who, []))
            if (truth_int is not None and "intMs" in me and not pitted
                    and ahead.get("lap") == me.get("lap")):
                int_err.append(me["intMs"] - (t_ms - truth_int))

    def stats(errs, label):
        if not errs:
            return {"label": label, "n": 0}
        a = [abs(e) for e in errs]
        return {"label": label, "n": len(errs), "bias": statistics.mean(errs),
                "median_abs": statistics.median(a), "p95_abs": _p95(a), "max_abs": max(a)}

    return {"clip": os.path.basename(clip_path), "label": header["label"],
            "gap": stats(gap_err, "gapMs"), "int": stats(int_err, "intMs"),
            "monotonic": monotonicity(frames)}


def report(result):
    print(f"\n{result['clip']}  ({result['label']})")
    for key in ("gap", "int"):
        s = result[key]
        if not s["n"]:
            print(f"  {s['label']}: no comparable crossings in this window")
            continue
        print(f"  {s['label']}: n={s['n']}  bias={s['bias']:+.0f} ms  "
              f"median|err|={s['median_abs']:.0f} ms  p95|err|={s['p95_abs']:.0f} ms  "
              f"max|err|={s['max_abs']:.0f} ms")
    print(f"  gap column monotonic vs the classified order in "
          f"{result['monotonic'] * 100:.1f}% of sampled frames (informational — see "
          f"monotonicity()'s docstring)")


def failures(result):
    """Threshold breaches for one clip, as human-readable strings."""
    out = []
    for key in ("gap", "int"):
        s = result[key]
        if not s["n"]:
            continue
        if s["median_abs"] > MAX_MEDIAN_ABS_MS:
            out.append(f"{result['clip']} {s['label']} median|err| "
                       f"{s['median_abs']:.0f} ms > {MAX_MEDIAN_ABS_MS} ms")
        if s["p95_abs"] > MAX_P95_ABS_MS:
            out.append(f"{result['clip']} {s['label']} p95|err| "
                       f"{s['p95_abs']:.0f} ms > {MAX_P95_ABS_MS} ms")
    return out


def available():
    """Clip keys whose clip file and session cache are both present locally."""
    if not CACHE_DIR.is_dir():
        return []
    return [k for k, (p, _, _) in CLIPS.items() if (REPO / p).is_file()]


def test_baked_gaps_match_official_line_crossings():
    """pytest entry point. Skips without the local FastF1 cache (i.e. in CI)."""
    import pytest

    keys = available()
    if not keys:
        pytest.skip("no local FastF1 cache/ or no baked clips — see this module's docstring")
    problems = []
    for key in keys:
        path, year, gp = CLIPS[key]
        result = measure(str(REPO / path), year, gp)
        report(result)
        problems += failures(result)
    assert not problems, "\n".join(problems)


def main(argv):
    keys = argv or available()
    if not keys:
        print("Nothing to check: need cache/ and at least one baked clip.")
        return 1
    problems = []
    for key in keys:
        path, year, gp = CLIPS[key]
        result = measure(str(REPO / path), year, gp)
        report(result)
        problems += failures(result)
    print()
    for p in problems:
        print(f"FAIL: {p}")
    print("Gap estimator check " + ("FAILED" if problems else "PASSED"))
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
