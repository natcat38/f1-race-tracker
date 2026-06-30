"""
Live ingester — publishes normalized race frames to Redis using the SAME contract
the Go writer uses (internal/model/model.go), so the gateway fans it out with zero
Go changes. This is the polyglot seam: Python and Go speak one Redis JSON shape.

Modes:
  --replay-clip FILE   stream a baked .jsonl clip to Redis in real time (testable anytime)
  --live               connect to the F1 live-timing SignalR feed (real sessions only; Task 8)

Redis contract:
  SET     snapshot:<session> = {"session","mode","label","track":[{x,y}],
                                "radio":[{timeMs,driverNum,clip}],"lapTrace":{...},
                                "cars":{"1":{...}},"timeMs","rev"}
  PUBLISH frames:<session>   = {"session","rev","t","timeMs","cars":[{...}]}
  Car = {"driverNum":int,"code":str,"team":str,"pos":int,"p":{"x":float,"y":float},"status":str}
  Go marshals map[int]CarState with STRING keys, so snapshot.cars is keyed by str(driverNum).
  SET before PUBLISH (a subscriber seeing a frame can trust the stored snapshot).
"""
import argparse
import json
import os
import sys
import time

import redis


def snap_key(s):
    return f"snapshot:{s}"


def frames_chan(s):
    return f"frames:{s}"


def starting_rev(r, session):
    """Continue Rev above whatever a previous run left in Redis, so a restart or a
    source swap never re-emits a Rev the gateway/clients already passed (Apply drops it)."""
    raw = r.get(snap_key(session))
    if not raw:
        return 0
    try:
        return int(json.loads(raw).get("rev", 0))
    except (ValueError, json.JSONDecodeError):
        return 0


def build_snapshot(session, label, track, radio, lap_trace, rev):
    return {
        "session": session, "mode": "live", "label": label,
        "track": track, "radio": radio, "lapTrace": lap_trace,
        "cars": {}, "timeMs": 0, "rev": rev,
    }


def build_frame(session, rev, time_ms, cars):
    return {
        "session": session, "rev": rev,
        "t": int(time.time() * 1000), "timeMs": time_ms, "cars": cars,
    }


def publish_clip(r, session, clip_path, label_override):
    with open(clip_path, "r", encoding="utf-8") as f:
        header = json.loads(f.readline())
        lines = [json.loads(ln) for ln in f if ln.strip()]
    if not lines:
        print(f"clip {clip_path} has no frames", file=sys.stderr)
        sys.exit(1)

    track = header.get("track", [])
    radio = header.get("radio", [])
    lap_trace = header.get("lapTrace", {})
    label = label_override or header.get("label", "Live")
    snapshot = build_snapshot(session, label, track, radio, lap_trace, starting_rev(r, session))
    rev = snapshot["rev"]
    base_ms = lines[0]["timeMs"]
    print(f"live: streaming {len(lines)} frames of '{label}' to session '{session}' (start rev {rev})")

    while True:  # loop the clip forever, like the Go replay player
        loop_start = time.monotonic()
        for ln in lines:
            target = (ln["timeMs"] - base_ms) / 1000.0
            wait = target - (time.monotonic() - loop_start)
            if wait > 0:
                time.sleep(wait)
            rev += 1
            fr = ln["frame"]
            cars = fr["cars"]
            for c in cars:  # fold into the running snapshot (string keys, per Go)
                snapshot["cars"][str(c["driverNum"])] = c
            snapshot["timeMs"] = fr["timeMs"]
            snapshot["rev"] = rev
            frame = build_frame(session, rev, fr["timeMs"], cars)
            r.set(snap_key(session), json.dumps(snapshot, separators=(",", ":")))
            r.publish(frames_chan(session), json.dumps(frame, separators=(",", ":")))


def parse_args():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--session", default=os.environ.get("SESSION_KEY", "live"))
    ap.add_argument("--redis-url", default=os.environ.get("REDIS_URL", "redis://localhost:6379"))
    ap.add_argument("--label", default=None, help="override the clip's label")
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--replay-clip", metavar="FILE", help="stream a baked .jsonl clip in real time")
    g.add_argument("--live", action="store_true", help="connect to the F1 live-timing feed (Task 8)")
    return ap.parse_args()


def main():
    args = parse_args()
    r = redis.from_url(args.redis_url, decode_responses=True)
    r.ping()
    if args.replay_clip:
        publish_clip(r, args.session, args.replay_clip, args.label)
    else:
        from live_signalr import run_live  # Task 8 (exploratory; same dir)
        run_live(r, args.session, args.label)


if __name__ == "__main__":
    main()
