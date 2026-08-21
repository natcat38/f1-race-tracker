"""
Live ingester — publishes normalized race frames to Redis using the SAME contract
the Go writer uses (internal/model/model.go), so the gateway fans it out with zero
Go changes. This is the polyglot seam: Python and Go speak one Redis JSON shape.

Modes:
  --replay-clip FILE   stream a baked .jsonl clip to Redis in real time (testable anytime)
  --live               connect to the F1 live-timing SignalR feed (real sessions only; Task 10)

Redis contract:
  SET     snapshot:<session> = {"session","mode","label","track":[{x,y}],
                                "radio":[{timeMs,driverNum,clip}],"lapTrace":{...},
                                "cars":{"1":{...}},"timeMs","rev","messages":[{...}]}
  PUBLISH frames:<session>   = {"session","rev","t","timeMs","cars":[{...}],"messages":[{...}]}
  Car = {"driverNum":int,"code":str,"team":str,"pos":int,"p":{"x":float,"y":float},"status":str}
  Go marshals map[int]CarState with STRING keys, so snapshot.cars is keyed by str(driverNum).
  "messages" (race-control entries: rev, t, category, message, driver?) is optional on
  both snapshot and frame, mirroring internal/model/apply.go's rolling buffer (cap 30).
  SET before PUBLISH (a subscriber seeing a frame can trust the stored snapshot).
"""
import argparse
import json
import os
import sys
import time

import redis

from resample import reconcile_positions


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
    except (ValueError, json.JSONDecodeError) as e:
        print(f"live: corrupt snapshot at {snap_key(session)}, starting from rev 0: {e}", file=sys.stderr)
        return 0


def build_snapshot(session, label, track, radio, lap_trace, stints, total_laps, rev):
    return {
        "session": session, "mode": "live", "label": label,
        "track": track, "radio": radio, "lapTrace": lap_trace, "totalLaps": total_laps,
        "stints": stints,
        "cars": {}, "timeMs": 0, "rev": rev,
    }


def build_frame(session, rev, time_ms, cars, messages=None, weather=None, radio=None):
    # Every publish path in this package goes through here, so the unique-and-
    # contiguous 1..N position invariant (#66) is enforced at this one choke
    # point rather than at each call site — one of which (live_signalr.py's
    # trailing radio frame) had already forgotten it. Sorts `cars` into running
    # order and renumbers each dict's 'pos' IN PLACE; callers that fold the same
    # dicts into a snapshot therefore see the reconciled value too. Idempotent,
    # so an already-reconciled list (a baked clip) passes through unchanged.
    cars = reconcile_positions(cars)
    frame = {
        "session": session, "rev": rev,
        "t": int(time.time() * 1000), "timeMs": time_ms, "cars": cars,
    }
    if messages:
        frame["messages"] = messages
    if weather is not None:
        frame["weather"] = weather
    if radio:
        # Live team-radio refs, accumulated onto the snapshot by Apply (ADR-0008).
        frame["radio"] = radio
    return frame


def fold_messages(existing, new, cap=30):
    """Append new race-control messages onto existing and cap the rolling
    buffer, mirroring internal/model/apply.go's Apply()."""
    return (existing + new)[-cap:]


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
    total_laps = header.get("totalLaps", 0)
    stints = header.get("stints", {})
    label = label_override or header.get("label", "Live")
    snapshot = build_snapshot(session, label, track, radio, lap_trace, stints, total_laps, starting_rev(r, session))
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
            msgs = fr.get("messages")
            if msgs:
                snapshot["messages"] = fold_messages(snapshot.get("messages", []), msgs)
            weather = fr.get("weather")
            if weather is not None:
                snapshot["weather"] = weather
            snapshot["timeMs"] = fr["timeMs"]
            snapshot["rev"] = rev
            frame = build_frame(session, rev, fr["timeMs"], cars, msgs, weather)
            r.set(snap_key(session), json.dumps(snapshot, separators=(",", ":")))
            r.publish(frames_chan(session), json.dumps(frame, separators=(",", ":")))


def parse_args():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--session", default=os.environ.get("SESSION_KEY", "live"))
    ap.add_argument("--redis-url", default=os.environ.get("REDIS_URL", "redis://localhost:6379"))
    ap.add_argument("--label", default=None, help="override the clip's label")
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--replay-clip", metavar="FILE", help="stream a baked .jsonl clip in real time")
    g.add_argument("--live", action="store_true", help="connect to the F1 live-timing feed (Task 10)")
    return ap.parse_args()


def main():
    args = parse_args()
    r = redis.from_url(args.redis_url, decode_responses=True)
    r.ping()
    # Publish F1TV link status in every mode, so the settings page works in the
    # demo too — status only, never the token (ADR-0007).
    from f1tv_auth import start_status_publisher
    start_status_publisher(r)
    if args.replay_clip:
        publish_clip(r, args.session, args.replay_clip, args.label)
    else:
        from live_signalr import run_live  # Task 10 (exploratory; same dir)
        run_live(r, args.session, args.label)


if __name__ == "__main__":
    main()
