"""
True-live FastF1 SignalR ingest mode (exploratory, session-only).

WARNING: This module only produces real data during a live F1 session.
Outside a session the SignalR endpoint returns no position/timing stream.
The module is guarded: if CAPTURE_FILE env var points to a saved capture
it replays that file (no network). Otherwise, reaching a real SignalR
connection needs a DOUBLE opt-in — the --live CLI flag (checked in live.py)
AND LIVE=1 (checked here) — so a bare `--live` invocation from an automated
harness or a copy-pasted command can never silently dial out; absent LIVE=1
it logs and exits 0 cleanly (structural-check mode).

---------------------------------------------------------------------------
MESSAGE SHAPE RESEARCH (source: fastf1._api + fastf1.livetiming source,
                         fastf1 >= 3.x, not verified against live stream)
---------------------------------------------------------------------------

SignalRClient subscribes to topics:
  "Heartbeat", "AudioStreams", "DriverList", "ExtrapolatedClock",
  "RaceControlMessages", "SessionInfo", "SessionStatus", "TeamRadio",
  "TimingAppData", "TimingStats", "TrackStatus", "WeatherData",
  "Position.z", "CarData.z", "ContentStreams", "SessionData",
  "TimingData", "TopThree", "RcmSeries", "LapCount"

The capture file written by SignalRClient.start() is line-oriented text.
Each line is a Python-repr'd list of three elements:
  [category: str, payload: str | dict, timestamp_utc: str]

E.g.:
  ['Position.z', '<zlib-compressed-base64-string>', '2024-09-01T13:01:00.123Z']
  ['TimingData', {'Lines': {'1': {'Position': 3, 'GapToLeader': '0.000'}, ...}}, '...']
  ['DriverList', {'1': {'RacingNumber': '1', 'Tla': 'VER', 'TeamName': 'Red Bull Racing'...}, ...}, '...']

--- Position.z (topic "Position.z") ---
Payload is zlib-compressed + base64-encoded JSON (the ".z" suffix means
compressed). FastF1's `parse()` helper decompresses it. Decoded shape:

  {
    "Position": [
      {
        "Timestamp": "2024-09-01T13:01:00.123Z",
        "Entries": {
          "1":  {"X": -14234, "Y": 98765, "Z": 0, "Status": "OnTrack"},
          "16": {"X": -13900, "Y": 97800, "Z": 0, "Status": "OnTrack"},
          ...  (keyed by driver racing number as string)
        }
      },
      ...  (may contain multiple position frames per message)
    ]
  }

X, Y, Z are integers in 1/10 mm (i.e. divide by 10000 for metres).
Status is "OnTrack" | "OffTrack" | "Pitlane". Sample rate: ~220 ms.

--- TimingData (topic "TimingData") ---
Payload is a plain dict (not compressed). Shape is INCREMENTAL — only
changed values are sent, like a JSON Merge Patch:

  {
    "Lines": {
      "1":  {"Position": 1, "GapToLeader": "0.000"},
      "16": {"Position": 2, "GapToLeader": "+0.512"},
      ...
    }
  }

"Lines" keys are driver racing numbers as strings.
"Position" is the race running order (int, 1 = leader).
Not every message contains both fields; some may have only one.

Also (UNVERIFIED against a live capture — see docs/runbooks/live-verification.md):
  "GapToLeader": "+0.512" | "1L" | "", "NumberOfLaps": int,
  "IntervalToPositionAhead": {"Value": "+0.512", "Catching": bool},
  "LastLapTime": {"Value": "1:25.633", "PersonalFastest": bool}

--- TimingAppData (topic "TimingAppData") ---
Same incremental "Lines" shape as TimingData. Fields of interest:
  "Stints": {"0": {"Compound": "SOFT", "TotalLaps": 5, "New": "true"}, ...}
  (or a plain list) — the current stint is the highest-indexed entry; its
  Compound/TotalLaps become the car's tyre/tyreAge.

--- DriverList (topic "DriverList") ---
Each message is a partial update dict:
  {
    "1":  {"RacingNumber": "1", "Tla": "VER", "TeamName": "Red Bull Racing", ...},
    ...
  }
Fields of interest: RacingNumber (str), Tla (3-letter code), TeamName.

---------------------------------------------------------------------------
LIVE NORMALIZATION BOUNDS STRATEGY
---------------------------------------------------------------------------
We do NOT have the full session data to pre-compute bounds (unlike record.py
which post-processes a completed session). Strategy chosen:

  "Accumulate-and-normalize": for the first BOUND_WARMUP_S seconds, collect
  all X/Y samples and update running min/max. After warmup, bounds are frozen.
  Frames emitted during warmup use the best-available bounds so far (they may
  be slightly off at the very start of the session if not all cars have moved
  to their extreme track points yet).

Tradeoff: positions during the first ~30 s may have slightly incorrect
normalisation if the observed range is not yet the full track range. In
practice, F1 tracks are covered quickly during a formation lap/start, so
this is a minor issue. The alternative (fixed nominal bounds) would require
per-circuit configuration, which is fragile.

---------------------------------------------------------------------------
USAGE
---------------------------------------------------------------------------
Invoked from live.py when --live is passed:
  from live_signalr import run_live
  run_live(r, session, label)

Environment variables:
  CAPTURE_FILE   path to a saved SignalR capture .txt file (for offline replay)
  LIVE           set to '1' to allow a real SignalR connection attempt (double
                 opt-in alongside --live); unset/other = structural-check mode
  SESSION_KEY    Redis session key (set by live.py, not read here)

Record a capture during a real session:
  python -m fastf1.livetiming save capture.txt --timeout 0

Then replay offline:
  CAPTURE_FILE=capture.txt python ingest/live.py --live --session test

Connect to a real live session:
  LIVE=1 python ingest/live.py --live --session test
"""

import json
import logging
import os
import sys
import time
import zlib
import base64

# Contract helpers — must match internal/model/model.go exactly.
from live import (
    snap_key,
    frames_chan,
    starting_rev,
    build_snapshot,
    build_frame,
)
from radio import live_radio_refs
from resample import UNKNOWN_POS

# Live team-radio clips resolve against this + SessionInfo.Path (ADR-0003 amended).
STATIC_BASE = "https://livetiming.formula1.com"

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

logging.basicConfig(format="%(asctime)s [live_signalr] %(levelname)s: %(message)s")
_log = logging.getLogger("live_signalr")
_log.setLevel(logging.INFO)

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

# Seconds to accumulate position data before freezing normalization bounds.
BOUND_WARMUP_S = 30

# Target publish rate (Hz). We decimate the raw ~220 ms stream to this rate.
# 4 Hz = one frame every 250 ms, similar to the baked-clip 10 Hz but gentler
# on Redis under a raw stream.
TARGET_HZ = 4
FRAME_INTERVAL_S = 1.0 / TARGET_HZ

# FastF1 team name → frontend colour map key (mirrors record.py exactly)
TEAM_MAP = {
    'Red Bull Racing': 'Red Bull',
    'Ferrari':         'Ferrari',
    'Mercedes':        'Mercedes',
    'McLaren':         'McLaren',
    'Aston Martin':    'Aston Martin',
    'Alpine':          'Alpine',
    'Williams':        'Williams',
    'RB':              'RB',
    'Kick Sauber':     'Kick Sauber',
    'Haas F1 Team':    'Haas',
}

# ---------------------------------------------------------------------------
# Normalization helpers
# ---------------------------------------------------------------------------

class BoundBox:
    """Accumulate X/Y min/max and normalise to [0,1] unit box.

    Same maths as record.py normalise() but incremental: bounds grow as new
    samples arrive and are frozen after BOUND_WARMUP_S seconds.
    """

    def __init__(self):
        self._x_min = None
        self._x_max = None
        self._y_min = None
        self._y_max = None
        self._frozen = False
        self._start_ts = None

    def update(self, x: float, y: float) -> None:
        """Expand bounds with a new sample (no-op once frozen)."""
        if self._frozen:
            return
        if self._start_ts is None:
            self._start_ts = time.monotonic()
        if self._x_min is None:
            self._x_min = self._x_max = x
            self._y_min = self._y_max = y
        else:
            self._x_min = min(self._x_min, x)
            self._x_max = max(self._x_max, x)
            self._y_min = min(self._y_min, y)
            self._y_max = max(self._y_max, y)
        if (time.monotonic() - self._start_ts) >= BOUND_WARMUP_S:
            self._frozen = True
            _log.info(
                "Normalization bounds frozen after warmup: "
                f"X=[{self._x_min:.0f},{self._x_max:.0f}] "
                f"Y=[{self._y_min:.0f},{self._y_max:.0f}]"
            )

    def normalise(self, x: float, y: float):
        """Return (nx, ny) in [0,1].  Returns (0.5, 0.5) until first sample."""
        if self._x_min is None:
            return 0.5, 0.5
        x_range = self._x_max - self._x_min or 1.0
        y_range = self._y_max - self._y_min or 1.0
        max_range = max(x_range, y_range)
        x_offset = (max_range - x_range) / 2
        y_offset = (max_range - y_range) / 2
        nx = (x - self._x_min + x_offset) / max_range
        ny = 1.0 - (y - self._y_min + y_offset) / max_range  # flip Y for SVG
        return round(float(nx), 4), round(float(ny), 4)


# ---------------------------------------------------------------------------
# Capture-file replay (offline path, using LiveTimingData)
# ---------------------------------------------------------------------------

def _radio_from_payload(payload, session_path, seen):
    """Map one TeamRadio message to wire radio refs, or [] if it carries none.

    The feed sends Captures either as a list or, for incremental patches, as an
    index-keyed dict (ADR-0008's schema assumption). Both shapes land here. Without
    a SessionInfo.Path yet there is nothing to resolve clip URLs against, so refs
    are dropped rather than guessed at.
    """
    if not isinstance(payload, dict) or not session_path:
        return []
    caps = payload.get('Captures')
    if isinstance(caps, dict):
        caps = [v for _, v in sorted(caps.items(), key=lambda kv: _safe_int(kv[0]))]
    if not isinstance(caps, list):
        return []
    return live_radio_refs([c for c in caps if isinstance(c, dict)],
                           STATIC_BASE, session_path, seen)


def _radio_or_defer(payload, session_path, seen, deferred):
    """Map a TeamRadio payload to refs, or park it until SessionInfo.Path arrives.

    Topic order at connect is the server's choice: TeamRadio can land before
    SessionInfo, and without a path there is nothing to resolve clip URLs against.
    Dropping it would silently lose a whole session's radio with no log line, so
    park it instead and flush once the path is known.
    """
    if not session_path:
        deferred.append(payload)
        return []
    return _radio_from_payload(payload, session_path, seen)


def _flush_deferred_radio(deferred, session_path, seen):
    """Drain payloads parked before SessionInfo.Path was known."""
    if not (session_path and deferred):
        return []
    refs = []
    for payload in deferred:
        refs.extend(_radio_from_payload(payload, session_path, seen))
    deferred.clear()
    return refs


def _session_path_from_payload(payload):
    """Extract the static-feed path from a SessionInfo message, or '' if absent."""
    if isinstance(payload, dict) and isinstance(payload.get('Path'), str):
        return "/static/" + payload['Path']
    return ""


def _publish_frame(r, session, snapshot, rev, time_ms, latest_cars, running_positions, radio):
    """Fold this frame's cars into the snapshot, store it, and publish the frame.

    The reconcile-then-publish sequence `_replay_capture` and `_run_live_signalr`
    both run on every rate-limited publish, in one place so the two can't drift.

    `latest_cars`' dicts PERSIST across publishes (and are the very objects the
    snapshot holds), while build_frame's reconciliation renumbers 'pos' in place.
    So each car's raw feed position is re-stamped from `running_positions` first:
    without it, a driver with no fresh Position.z sample this cycle would feed its
    previous reconciled RANK back in as if it were raw feed data, letting its rank
    stick or drift away from what the feed actually said.
    """
    for num_str, car in latest_cars.items():
        car['pos'] = running_positions.get(num_str, UNKNOWN_POS)
    # build_frame reconciles 'pos' into a unique, contiguous 1..N (see its comment).
    frame = build_frame(session, rev, time_ms, list(latest_cars.values()), radio=radio)
    for c in frame['cars']:
        snapshot['cars'][str(c['driverNum'])] = c
    snapshot['timeMs'] = time_ms
    snapshot['rev'] = rev
    if radio:
        snapshot['radio'] = snapshot.get('radio', []) + radio
    r.set(snap_key(session), json.dumps(snapshot, separators=(",", ":")))
    r.publish(frames_chan(session), json.dumps(frame, separators=(",", ":")))


def _publish_trailing_radio_frame(r, session, snapshot, rev, time_ms, cars_list, radio):
    """Emit one extra frame carrying only pending radio refs, at stream end.

    Both `_replay_capture` and `_run_live_signalr` only drain `pending_radio`
    inside the position-sample publish path, so refs collected after the last
    published frame (a capture/stream ending shortly after a TeamRadio message,
    or one arriving before any position data flows) were previously dropped
    silently at process exit (issue #62). Call this once, on the way out,
    with whatever refs are still pending.

    Bumps `rev` once more than the stream otherwise would have and carries no
    new car data — ADR-0008's amendment accepts this trade-off in exchange for
    already-connected clients actually receiving the refs. `cars_list` is the
    latest known car list (may be empty if no position data ever arrived); we
    reuse it rather than inventing data, so the frame stays well-formed against
    the event model (Frame.Cars has no `omitempty`, so `[]` is the correct
    empty representation, not `None`). Those cars go out reconciled like every
    other frame's: build_frame does it, so this path can't ship the raw
    duplicate/gapped/UNKNOWN_POS values it used to when the stream ended before
    the rate limiter ever let a regular frame out.
    """
    rev += 1
    snapshot['radio'] = snapshot.get('radio', []) + radio
    snapshot['rev'] = rev
    if time_ms > snapshot.get('timeMs', 0):
        snapshot['timeMs'] = time_ms
    frame = build_frame(session, rev, snapshot['timeMs'], cars_list, radio=radio)
    r.set(snap_key(session), json.dumps(snapshot, separators=(",", ":")))
    r.publish(frames_chan(session), json.dumps(frame, separators=(",", ":")))
    _log.info(
        f"Published trailing frame at stream end with {len(radio)} pending "
        "radio ref(s) that had not yet ridden a frame"
    )
    return rev


def _log_dropped_deferred_radio(deferred_radio):
    """Log (rather than silently drop) TeamRadio payloads that never got a
    SessionInfo.Path to resolve clip URLs against, at stream end."""
    if deferred_radio:
        _log.warning(
            f"Dropping {len(deferred_radio)} TeamRadio payload(s) at stream end: "
            "SessionInfo.Path never arrived, so clip URLs could never be resolved"
        )


def _shutdown_flush_radio(r, session, snapshot, rev, latest_cars, pending_radio, deferred_radio):
    """`_run_live_signalr`'s shutdown-time radio flush: best-effort trailing
    frame, then the deferred-drop log line — unconditionally. Returns the
    (possibly bumped) rev.

    Pulled out of the `finally` block so it can be driven directly in tests
    without needing a real or faked SignalRClient, and so the ordering
    guarantee (flush attempt, then deferred logging, no matter what) lives in
    one place.

    Called from a `finally` around `client.start()`: if that call raised
    because Redis itself died (or is simply unreachable), an unguarded
    `_publish_trailing_radio_frame` here would raise a *second* exception —
    becoming the misleading proximate error in place of whatever
    client.start() actually raised, and skipping `_log_dropped_deferred_radio`
    entirely. Both defeat issue #62's "logged, never silent" guarantee. So the
    flush is caught and logged at WARNING instead, and the deferred-drop log
    always runs; the original exception from client.start(), if any, is
    untouched by this function and propagates normally once `finally` exits.
    """
    if pending_radio:
        n_pending = len(pending_radio)
        try:
            rev = _publish_trailing_radio_frame(
                r, session, snapshot, rev, int(time.time() * 1000),
                list(latest_cars.values()), list(pending_radio))
            pending_radio.clear()
        except Exception as exc:
            _log.warning(
                f"Failed to publish trailing frame: {n_pending} pending "
                f"radio ref(s) lost at stream end: {exc}"
            )
    _log_dropped_deferred_radio(deferred_radio)
    return rev


def _replay_capture(r, session: str, label: str, capture_path: str) -> None:
    """Replay a saved SignalR capture file through the Redis contract.

    The capture was written by SignalRClient and is parseable by LiveTimingData.
    We iterate over Position.z and TimingData in timestamp order.

    NOTE: LiveTimingData is designed for batch loading into fastf1.core.Session,
    not for frame-by-frame streaming. Here we read it as a structured log and
    re-emit at real-time pace using the stored timestamps.
    """
    # Imported lazily (not at module level) so importing this module — e.g. for
    # its parsing helpers in tests/contract checks — never requires fastf1 to
    # be installed; only actually replaying a capture does.
    import fastf1.livetiming.data as _ltd

    _log.info(f"Replaying capture file: {capture_path}")
    livedata = _ltd.LiveTimingData(capture_path)
    # Trigger load
    cats = livedata.list_categories()
    _log.info(f"Capture categories: {cats}")

    # --- Driver list (best-effort from DriverList topic) ---
    driver_info = {}  # str_num -> {'code': str, 'team': str}
    if livedata.has('DriverList'):
        for td, content in livedata.get('DriverList'):
            if not isinstance(content, dict):
                continue
            for num_str, patch in content.items():
                if not isinstance(patch, dict):
                    continue
                if num_str not in driver_info:
                    driver_info[num_str] = {'code': '???', 'team': 'Unknown'}
                if 'Tla' in patch:
                    driver_info[num_str]['code'] = patch['Tla']
                if 'TeamName' in patch:
                    raw_team = patch['TeamName']
                    driver_info[num_str]['team'] = TEAM_MAP.get(raw_team, raw_team)
    _log.info(f"Drivers from DriverList: {list(driver_info.keys())}")

    if not livedata.has('Position.z'):
        _log.error("Capture has no Position.z data — nothing to publish")
        return

    # --- Build a time-ordered event list merging Position.z + TimingData ---
    # Position.z entries: (timedelta, compressed_payload_str)
    # TimingData entries: (timedelta, dict_with_Lines)
    #
    # UNVERIFIED: The exact type of livedata.get('Position.z') items.
    # Based on _api.py source, livedata entries are [timedelta, payload].
    # For Position.z the payload is a compressed string that _api.parse()
    # decodes — but we call _decompress_position() below directly.

    pos_entries = livedata.get('Position.z')
    timing_entries = livedata.get('TimingData') if livedata.has('TimingData') else []
    appdata_entries = livedata.get('TimingAppData') if livedata.has('TimingAppData') else []

    # running position lookup: str_num -> int (1 = leader)
    running_positions: dict[str, int] = {}
    # lap/gap/interval/last-lap (from TimingData) and tyre/tyreAge (from
    # TimingAppData) — incremental patches, so entries accumulate rather than
    # being replaced wholesale each message.
    timing_extra: dict[str, dict] = {}
    tyre_extra: dict[str, dict] = {}
    # Live team radio (ADR-0008): refs ride frames and accumulate on the snapshot.
    session_path = ""
    seen_clips: set[str] = set()
    pending_radio: list[dict] = []
    deferred_radio: list = []   # TeamRadio seen before SessionInfo.Path

    bounds = BoundBox()
    rev = starting_rev(r, session)
    snapshot = build_snapshot(session, label or "Live F1", [], [], {}, {}, 0, rev)
    r.set(snap_key(session), json.dumps(snapshot, separators=(",", ":")))

    # Interleave events by timedelta
    info_entries = livedata.get('SessionInfo') if livedata.has('SessionInfo') else []
    radio_entries = livedata.get('TeamRadio') if livedata.has('TeamRadio') else []

    events = (
        [('pos', td, payload) for td, payload in pos_entries] +
        [('timing', td, payload) for td, payload in timing_entries] +
        [('appdata', td, payload) for td, payload in appdata_entries] +
        [('sessioninfo', td, payload) for td, payload in info_entries] +
        [('radio', td, payload) for td, payload in radio_entries]
    )
    events.sort(key=lambda e: e[1])

    if not events:
        _log.warning("No events to replay")
        return

    # Reference for real-time pacing
    first_td = events[0][1].total_seconds()
    wall_start = time.monotonic()
    last_publish = time.monotonic() - FRAME_INTERVAL_S
    latest_cars: dict[str, dict] = {}  # str_num -> car dict (latest known)

    _log.info(f"Replaying {len(events)} events (pos+timing)...")

    for kind, td, payload in events:
        session_s = td.total_seconds()
        elapsed = session_s - first_td
        wall_target = wall_start + elapsed
        wait = wall_target - time.monotonic()
        if wait > 0:
            time.sleep(wait)

        if kind == 'timing':
            # Update running positions + lap/gap/interval/last-lap from TimingData
            # UNVERIFIED shape: payload should be dict with 'Lines' key
            if isinstance(payload, dict):
                lines = payload.get('Lines', {})
                for num_str, drv_data in lines.items():
                    if not isinstance(drv_data, dict):
                        continue
                    if 'Position' in drv_data:
                        try:
                            running_positions[num_str] = int(drv_data['Position'])
                        except (ValueError, TypeError):
                            pass
                    parsed = _parse_timing_line(drv_data)
                    if parsed:
                        timing_extra.setdefault(num_str, {}).update(parsed)
            continue

        if kind == 'sessioninfo':
            session_path = _session_path_from_payload(payload) or session_path
            pending_radio.extend(_flush_deferred_radio(deferred_radio, session_path, seen_clips))
            continue

        if kind == 'radio':
            pending_radio.extend(
                _radio_or_defer(payload, session_path, seen_clips, deferred_radio))
            continue

        if kind == 'appdata':
            # Tyre compound/age from TimingAppData
            if isinstance(payload, dict):
                lines = payload.get('Lines', {})
                for num_str, drv_data in lines.items():
                    if not isinstance(drv_data, dict):
                        continue
                    parsed = _parse_tyre_line(drv_data)
                    if parsed:
                        tyre_extra.setdefault(num_str, {}).update(parsed)
            continue

        # kind == 'pos': decompress and emit
        # UNVERIFIED: payload might be already-decoded dict or compressed string.
        # LiveTimingData._parse_line stores the JSON-decoded msg directly,
        # so for Position.z the payload arriving here is likely the
        # already-json-parsed Python object (list of dicts after decompression).
        # However, _api.position_data calls parse(record[1], zipped=True)
        # which decompresses if needed. We replicate that logic here.
        try:
            pos_samples = _decode_position_payload(payload)
        except Exception as exc:
            _log.debug(f"Position decode error: {exc}")
            continue

        for sample in pos_samples:
            entries = sample.get('Entries', {})
            for num_str, coords in entries.items():
                if not isinstance(coords, dict):
                    continue
                try:
                    x = float(coords['X'])
                    y = float(coords['Y'])
                except (KeyError, TypeError, ValueError):
                    continue

                bounds.update(x, y)
                nx, ny = bounds.normalise(x, y)

                raw_status = coords.get('Status', 'OnTrack')
                status = _map_status(raw_status)

                info = driver_info.get(num_str, {'code': '???', 'team': 'Unknown'})
                car = {
                    'driverNum': _safe_int(num_str),
                    'code':      info['code'],
                    'team':      info['team'],
                    'pos':       running_positions.get(num_str, UNKNOWN_POS),
                    'p':         {'x': nx, 'y': ny},
                    'status':    status,
                }
                car.update(timing_extra.get(num_str, {}))
                car.update(tyre_extra.get(num_str, {}))
                latest_cars[num_str] = car

        # Rate-limit publishing
        now = time.monotonic()
        if now - last_publish < FRAME_INTERVAL_S:
            continue
        if not latest_cars:
            continue

        last_publish = now
        rev += 1
        radio = list(pending_radio)
        pending_radio.clear()
        _publish_frame(r, session, snapshot, rev, int(session_s * 1000),
                       latest_cars, running_positions, radio)

    # Issue #62: refs collected after the loop's last publish (the capture ends
    # shortly after a TeamRadio message, or one arrived before any position data)
    # would otherwise be dropped silently. `session_s` still holds the last
    # event's session-relative time (the loop always runs at least once here —
    # an empty `events` list returns earlier), so the trailing frame's timeMs
    # keeps advancing rather than rewinding.
    if pending_radio:
        rev = _publish_trailing_radio_frame(
            r, session, snapshot, rev, int(session_s * 1000),
            list(latest_cars.values()), list(pending_radio))
        pending_radio.clear()
    _log_dropped_deferred_radio(deferred_radio)

    _log.info(f"Capture replay complete. Published {rev - starting_rev(r, session)} frames")


# ---------------------------------------------------------------------------
# Live SignalR path (session-only)
# ---------------------------------------------------------------------------

def _run_live_signalr(r, session: str, label: str) -> None:
    """Connect to the F1 live-timing SignalR feed and publish frames.

    IMPORTANT: This function only works during a live F1 session.
    Outside a session the stream returns no position data.

    The approach mirrors how fastf1._api.position_data works, but we hook
    into the raw message callback instead of waiting for a full session load.

    NOTE: The SignalRClient is designed for recording to file, not for
    streaming to a callback. We subclass it and override _on_message to
    both write to file (for capture) and process in real time.
    """
    # Import here so that the module remains importable without signalrcore
    # when it isn't installed (signalrcore is in requirements-live.txt).
    try:
        from fastf1.livetiming.client import SignalRClient
    except ImportError as exc:
        _log.error(f"Cannot import SignalRClient: {exc}")
        _log.error("Install requirements-live.txt: pip install -r ingest/requirements-live.txt")
        sys.exit(1)

    capture_out = os.environ.get('CAPTURE_OUT', f'capture-{session}.txt')
    _log.info(f"Connecting to F1 live-timing SignalR stream; saving capture to {capture_out}")
    _log.info("NOTE: This only streams data during a live F1 session.")

    bounds = BoundBox()
    rev_holder = [starting_rev(r, session)]
    driver_info: dict[str, dict] = {}
    running_positions: dict[str, int] = {}
    timing_extra: dict[str, dict] = {}
    tyre_extra: dict[str, dict] = {}
    latest_cars: dict[str, dict] = {}
    # Live team radio (ADR-0008). Holders, not plain names, because handle_message
    # is a closure that rebinds nothing.
    session_path_holder = ['']
    seen_clips: set[str] = set()
    pending_radio: list[dict] = []
    deferred_radio: list = []   # TeamRadio seen before SessionInfo.Path
    snapshot_holder = [build_snapshot(session, label or "Live F1", [], [], {}, {}, 0, rev_holder[0])]
    last_publish = [time.monotonic() - FRAME_INTERVAL_S]

    r.set(snap_key(session), json.dumps(snapshot_holder[0], separators=(",", ":")))

    def handle_message(topic: str, payload) -> None:
        """Process a single live message from the SignalR feed.

        UNVERIFIED shape: during a live session the SignalRClient fires
        _on_message with `msg` as a list. The CompletionMessage path (initial
        subscription response) gives us the snapshot of all topics at connect
        time. See client.py:_on_message for the two branches.

        We hook here after the file write, so the capture is always saved
        regardless of processing errors.
        """
        if topic == 'DriverList':
            if not isinstance(payload, dict):
                return
            for num_str, patch in payload.items():
                if not isinstance(patch, dict):
                    continue
                if num_str not in driver_info:
                    driver_info[num_str] = {'code': '???', 'team': 'Unknown'}
                if 'Tla' in patch:
                    driver_info[num_str]['code'] = patch['Tla']
                if 'TeamName' in patch:
                    raw = patch['TeamName']
                    driver_info[num_str]['team'] = TEAM_MAP.get(raw, raw)

        elif topic == 'TimingData':
            if not isinstance(payload, dict):
                return
            lines = payload.get('Lines', {})
            for num_str, drv_data in lines.items():
                if not isinstance(drv_data, dict):
                    continue
                if 'Position' in drv_data:
                    try:
                        running_positions[num_str] = int(drv_data['Position'])
                    except (ValueError, TypeError):
                        pass
                parsed = _parse_timing_line(drv_data)
                if parsed:
                    timing_extra.setdefault(num_str, {}).update(parsed)

        elif topic == 'TimingAppData':
            if not isinstance(payload, dict):
                return
            lines = payload.get('Lines', {})
            for num_str, drv_data in lines.items():
                if not isinstance(drv_data, dict):
                    continue
                parsed = _parse_tyre_line(drv_data)
                if parsed:
                    tyre_extra.setdefault(num_str, {}).update(parsed)

        elif topic == 'SessionInfo':
            session_path_holder[0] = (_session_path_from_payload(payload)
                                      or session_path_holder[0])
            pending_radio.extend(
                _flush_deferred_radio(deferred_radio, session_path_holder[0], seen_clips))

        elif topic == 'TeamRadio':
            pending_radio.extend(
                _radio_or_defer(payload, session_path_holder[0], seen_clips, deferred_radio))

        elif topic == 'Position.z':
            try:
                samples = _decode_position_payload(payload)
            except Exception as exc:
                _log.warning(f"Position.z decode error: {exc}")
                return
            now = time.monotonic()
            for sample in samples:
                for num_str, coords in sample.get('Entries', {}).items():
                    if not isinstance(coords, dict):
                        continue
                    try:
                        x = float(coords['X'])
                        y = float(coords['Y'])
                    except (KeyError, TypeError, ValueError):
                        continue

                    bounds.update(x, y)
                    nx, ny = bounds.normalise(x, y)
                    raw_status = coords.get('Status', 'OnTrack')
                    info = driver_info.get(num_str, {'code': '???', 'team': 'Unknown'})
                    car = {
                        'driverNum': _safe_int(num_str),
                        'code':      info['code'],
                        'team':      info['team'],
                        'pos':       running_positions.get(num_str, UNKNOWN_POS),
                        'p':         {'x': nx, 'y': ny},
                        'status':    _map_status(raw_status),
                    }
                    car.update(timing_extra.get(num_str, {}))
                    car.update(tyre_extra.get(num_str, {}))
                    latest_cars[num_str] = car

            # Rate-limited publish
            if (now - last_publish[0]) < FRAME_INTERVAL_S or not latest_cars:
                return
            last_publish[0] = now

            rev_holder[0] += 1
            radio = list(pending_radio)
            pending_radio.clear()
            _publish_frame(r, session, snapshot_holder[0], rev_holder[0],
                           int(time.time() * 1000), latest_cars,
                           running_positions, radio)

    # Subclass SignalRClient to intercept messages after the file write.
    # UNVERIFIED: The exact structure of `msg` inside _on_message during a live
    # session. Based on source: CompletionMessage at subscribe time (gives snapshot),
    # then list messages for subsequent updates. We parse best-effort.
    class _LiveClient(SignalRClient):
        def _on_message(self, msg):
            # Write to file first (let the parent handle file I/O)
            super()._on_message(msg)
            # Then process
            _dispatch_message(msg, handle_message)

    client = _LiveClient(
        filename=capture_out,
        filemode='a',  # append so restarts don't lose data
        timeout=120,   # exit if no data for 2 min (session ended)
    )
    _log.info("Starting SignalR client (Ctrl-C to stop)...")
    try:
        client.start()
    except KeyboardInterrupt:
        _log.info("Stopped by user")
    finally:
        # Issue #62: client.start() returning — by Ctrl-C, the 2-minute no-data
        # timeout (session ended), or any other reason — must not silently drop
        # radio refs collected since the last position-triggered publish. Runs
        # on every exit path, including an exception propagating past here (see
        # _shutdown_flush_radio's docstring for why the flush itself must be
        # best-effort here, unlike _replay_capture's — this one is a `finally`).
        rev_holder[0] = _shutdown_flush_radio(
            r, session, snapshot_holder[0], rev_holder[0], latest_cars,
            pending_radio, deferred_radio)


# ---------------------------------------------------------------------------
# Message dispatch helpers
# ---------------------------------------------------------------------------

def _decode_payload(payload):
    """Normalise a topic payload to Python data.

    VERIFIED 2026-08-20 against a real connection: every topic's payload arrives
    as a JSON *string*, not a dict — DriverList, TimingData, SessionInfo, TeamRadio,
    all of them. Parsing here, at the one boundary, keeps every topic handler able to
    assume real data instead of each re-parsing (and silently no-opping if it forgets).

    Position.z is the deliberate exception: its payload is a zlib+base64 blob that is
    not JSON, so it fails the parse and passes through untouched for
    _decode_position_payload to handle.
    """
    if not isinstance(payload, str):
        return payload
    try:
        return json.loads(payload)
    except (ValueError, TypeError):
        return payload


def _dispatch_message(msg, callback) -> None:
    """Extract (topic, payload) pairs from a raw SignalR message and call callback.

    VERIFIED 2026-08-20: CompletionMessage.result is {topic: payload} at connect, and
    every payload is a JSON string (see _decode_payload). The incremental list shape
    is still UNVERIFIED — it needs a genuinely live session, not a connect snapshot.
    """
    try:
        from signalrcore.messages.completion_message import CompletionMessage
        if isinstance(msg, CompletionMessage):
            # Initial subscription snapshot: result = {topic: payload, ...}
            for topic, payload in msg.result.items():
                try:
                    callback(topic, _decode_payload(payload))
                except Exception as exc:
                    _log.error(f"handler failed for topic={topic}: {exc}")
            return
    except ImportError:
        pass

    if isinstance(msg, list):
        # Incremental update: list of [topic, payload] pairs
        # UNVERIFIED: exact list shape. Best-effort two-element tuple parse.
        for item in msg:
            try:
                if isinstance(item, (list, tuple)) and len(item) >= 2:
                    callback(str(item[0]), _decode_payload(item[1]))
            except Exception as exc:
                _log.error(f"handler failed for item={item!r}: {exc}")


# ---------------------------------------------------------------------------
# Codec helpers
# ---------------------------------------------------------------------------

def _decode_position_payload(payload) -> list:
    """Decode a Position.z message payload to a list of position samples.

    The payload from LiveTimingData is already the JSON-parsed Python object.
    However, the ".z" suffix means the original wire format is zlib-compressed
    base64. After LiveTimingData._parse_line calls json.loads on the line,
    the payload for 'Position.z' is the JSON-decoded content.

    Based on fastf1._api.parse() and position_data():
      - After json.loads the Position.z payload is a dict-like object with key 'Position'
        containing a list of {Timestamp, Entries} dicts.
      - But the raw wire value is still a zlib+base64 string that fastf1._api.parse()
        decompresses. After LiveTimingData loads it, the payload is already a string
        (the compressed blob) because LiveTimingData stores the raw JSON string
        from the file without calling parse().

    UNVERIFIED: The exact type stored by LiveTimingData for Position.z entries.
    We handle both cases:
      1. payload is a str → attempt zlib decompress → parse JSON → extract 'Position'
      2. payload is a dict with 'Position' key → use directly
      3. payload is a dict without 'Position' → return []
    """
    if isinstance(payload, dict):
        return payload.get('Position', [])

    if isinstance(payload, str):
        # Try zlib-compressed base64 (fastf1._api.parse zipped=True path)
        try:
            raw = base64.b64decode(payload)
            decompressed = zlib.decompress(raw, -15)  # raw deflate (no header)
            decoded = json.loads(decompressed)
            return decoded.get('Position', [])
        except Exception:
            pass
        # Try plain JSON
        try:
            decoded = json.loads(payload)
            return decoded.get('Position', [])
        except Exception:
            pass

    return []


def _parse_gap_str(s: str):
    """Parse a gap/interval string ('+0.512', '1L', '1 LAP') into (gapMs, gapLaps).

    UNVERIFIED: exact string forms based on public reverse-engineering of the F1
    timing feed (fastf1 treats these as opaque strings) — confirm against a real
    capture per docs/runbooks/live-verification.md.
    """
    if not s:
        return None, None
    s = s.strip()
    upper = s.upper()
    if upper.endswith('L') or 'LAP' in upper:
        digits = ''.join(ch for ch in s if ch.isdigit())
        return (None, int(digits)) if digits else (None, None)
    try:
        # Clamp to non-negative: every other gapMs/intMs producer in this
        # codebase (ingest/record.py) is non-negative by convention (a
        # "catching" interval is never rendered as a signed value downstream),
        # so a feed variant that encodes it with a leading '-' shouldn't leak
        # a negative value into the contract.
        return max(0, int(round(float(s) * 1000))), None
    except ValueError:
        return None, None


def _parse_laptime_str(s: str):
    """Parse 'M:SS.mmm' or 'SS.mmm' into milliseconds, or None if unparseable."""
    if not s:
        return None
    parts = s.split(':')
    try:
        if len(parts) == 2:
            total_s = int(parts[0]) * 60 + float(parts[1])
        else:
            total_s = float(parts[0])
        return int(round(total_s * 1000))
    except ValueError:
        return None


def _parse_timing_line(drv_data: dict) -> dict:
    """Extract lap/gap/interval/last-lap fields from one TimingData Lines[num] entry.

    UNVERIFIED: field names ('GapToLeader', 'IntervalToPositionAhead.Value',
    'LastLapTime.Value', 'NumberOfLaps') are based on community documentation of
    the F1 timing feed, not confirmed against a real capture — see
    docs/runbooks/live-verification.md for how to verify and correct these.
    """
    out = {}
    if 'NumberOfLaps' in drv_data:
        try:
            # UNVERIFIED: assumed to be the car's current (in-progress) lap
            # number, matching ingest/record.py's 'lap' (from FastF1's
            # LapNumber). If the real feed instead counts *completed* laps,
            # this is off-by-one vs. the replay path until the driver crosses
            # the line — check this specifically per the runbook's
            # NumberOfLaps checklist item before relying on it.
            out['lap'] = int(drv_data['NumberOfLaps'])
        except (ValueError, TypeError):
            pass
    gap = drv_data.get('GapToLeader')
    if isinstance(gap, str) and gap:
        gap_ms, gap_laps = _parse_gap_str(gap)
        if gap_ms is not None:
            out['gapMs'] = gap_ms
        if gap_laps is not None:
            out['gapLaps'] = gap_laps
    interval = drv_data.get('IntervalToPositionAhead')
    if isinstance(interval, dict):
        int_ms, _ = _parse_gap_str(interval.get('Value', ''))
        if int_ms is not None:
            out['intMs'] = int_ms
    last_lap = drv_data.get('LastLapTime')
    if isinstance(last_lap, dict):
        ms = _parse_laptime_str(last_lap.get('Value', ''))
        if ms is not None:
            out['lastLapMs'] = ms
    return out


def _parse_tyre_line(app_data: dict) -> dict:
    """Extract current tyre compound/age from one TimingAppData Lines[num] entry.

    UNVERIFIED: 'Stints' shape (dict keyed by stint index vs a plain list) varies
    by feed version; the current stint is taken as the highest-indexed entry.
    See docs/runbooks/live-verification.md.
    """
    stints = app_data.get('Stints')
    if isinstance(stints, dict) and stints:
        current = stints[max(stints, key=lambda k: _safe_int(k))]
    elif isinstance(stints, list) and stints:
        current = stints[-1]
    else:
        current = None
    if not isinstance(current, dict):
        return {}
    out = {}
    compound = current.get('Compound')
    if isinstance(compound, str) and compound:
        out['tyre'] = compound.upper()
    age = current.get('TotalLaps')
    if age is not None:
        try:
            out['tyreAge'] = int(age)
        except (ValueError, TypeError):
            pass
    return out


def _map_status(raw: str) -> str:
    """Map F1 live-timing status strings to contract status values."""
    if raw == 'OnTrack':
        return 'OnTrack'
    if raw in ('Pitlane', 'Pit', 'PitLane'):
        return 'Pit'
    return 'Out'


def _safe_int(s: str) -> int:
    """Convert a driver number string to int, fallback 0."""
    try:
        return int(s)
    except (ValueError, TypeError):
        return 0


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------

def run_live(r, session: str, label: str | None) -> None:
    """Connect to the F1 live-timing stream and publish contract-shaped frames.

    IMPORTANT: Only produces real data during a live F1 session.

    Args:
        r:       redis.Redis instance (decode_responses=True)
        session: session key for Redis keys (e.g. 'live')
        label:   human-readable label for the snapshot (e.g. 'British GP 2026')

    Behaviour:
        1. If env var CAPTURE_FILE is set and the file exists → replay offline
           (no network; always allowed).
        2. Else, only if LIVE=1 AND LIVE_TIMING_MODE=beta are set and the operator's
           F1TV account is linked, attempt a real SignalR connection.
           Reaching this function already requires the explicit --live CLI
           flag; LIVE=1 is a second, deliberate opt-in so a bare --live
           invocation can never silently dial out.
        3. Otherwise → log and return (structural-check mode).

    Environment:
        CAPTURE_FILE  path to a saved capture file (for offline replay; no network)
        CAPTURE_OUT   where to save a new capture during live mode (default:
                      capture-<session>.txt)
        LIVE          set to '1' to allow the real SignalR connection attempt
                      (double opt-in alongside --live; unset/other = skip)
        LIVE_TIMING_MODE
                      set to 'beta' for the third opt-in; the connection also
                      requires a linked F1TV account (ADR-0007), else exit 1
    """
    capture_file = os.environ.get('CAPTURE_FILE', '')
    live_enabled = os.environ.get('LIVE', '0') == '1'

    if capture_file and os.path.exists(capture_file):
        _log.info(f"CAPTURE_FILE={capture_file} → offline replay mode")
        _replay_capture(r, session, label or "Live F1 (replay)", capture_file)
        return

    if capture_file and not os.path.exists(capture_file):
        _log.warning(f"CAPTURE_FILE={capture_file!r} does not exist — skipping replay")

    if not live_enabled:
        _log.info("LIVE=1 not set — skipping live connection (structural check mode)")
        _log.info("run_live is callable and would connect during a real session.")
        return

    # Third opt-in: the beta path uses the operator's own F1TV subscription
    # (ADR-0007). Missing or stale auth fails fast — never a silent degrade.
    if os.environ.get('LIVE_TIMING_MODE') != 'beta':
        _log.error("Real connection needs LIVE_TIMING_MODE=beta (ADR-0007) "
                   "on top of --live and LIVE=1.")
        sys.exit(1)

    from f1tv_auth import auth_status
    status = auth_status()
    if status['state'] != 'linked':
        _log.error(f"F1TV sign-in {status['state']}. Run this on the HOST, not in a "
                   "container:  python ingest/f1tv_link.py")
        _log.error("Then restart this service. See docs/runbooks/live-verification.md "
                   "section 5.")
        sys.exit(1)

    tier = status.get('tier', '?')
    _log.info(f"F1TV signed in (subscription={tier}, lapses {status.get('expiresUtc', '?')})")
    if tier != 'active':
        _log.warning("This account has no active F1 TV subscription - the stream will "
                     "connect but stay empty. F1 TV Access or better is needed for data.")

    _log.info("All three gates set (--live, LIVE=1, LIVE_TIMING_MODE=beta) - connecting.")
    _log.info("NOTE: real data only arrives during a live F1 session.")
    _log.info("Outside a session: the stream times out after ~120 s with no data.")
    _run_live_signalr(r, session, label)
