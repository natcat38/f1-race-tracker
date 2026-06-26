"""
True-live FastF1 SignalR ingest mode (exploratory, session-only).

WARNING: This module only produces real data during a live F1 session.
Outside a session the SignalR endpoint returns no position/timing stream.
The module is guarded: if CAPTURE_FILE env var points to a saved capture
it replays that file; otherwise it logs and exits 0 cleanly.

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
  SESSION_KEY    Redis session key (set by live.py, not read here)

Record a capture during a real session:
  python -m fastf1.livetiming save capture.txt --timeout 0

Then replay offline:
  CAPTURE_FILE=capture.txt python ingest/live.py --live --session test
"""

import json
import logging
import os
import sys
import time
import zlib
import base64
from datetime import datetime, timezone

# FastF1 imports — safe at module level because live.py imports us lazily
# (only when --live is passed). These do NOT trigger data downloads.
import fastf1.livetiming.data as _ltd

# Contract helpers — must match internal/model/model.go exactly.
from live import (
    snap_key,
    frames_chan,
    starting_rev,
    build_snapshot,
    build_frame,
)

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

def _replay_capture(r, session: str, label: str, capture_path: str) -> None:
    """Replay a saved SignalR capture file through the Redis contract.

    The capture was written by SignalRClient and is parseable by LiveTimingData.
    We iterate over Position.z and TimingData in timestamp order.

    NOTE: LiveTimingData is designed for batch loading into fastf1.core.Session,
    not for frame-by-frame streaming. Here we read it as a structured log and
    re-emit at real-time pace using the stored timestamps.
    """
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

    # running position lookup: str_num -> int (1 = leader)
    running_positions: dict[str, int] = {}

    bounds = BoundBox()
    rev = starting_rev(r, session)
    snapshot = build_snapshot(session, label or "Live F1", [], [], rev)
    r.set(snap_key(session), json.dumps(snapshot, separators=(",", ":")))

    # Interleave events by timedelta
    events = (
        [('pos', td, payload) for td, payload in pos_entries] +
        [('timing', td, payload) for td, payload in timing_entries]
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
            # Update running positions from TimingData
            # UNVERIFIED shape: payload should be dict with 'Lines' key
            if isinstance(payload, dict):
                lines = payload.get('Lines', {})
                for num_str, drv_data in lines.items():
                    if isinstance(drv_data, dict) and 'Position' in drv_data:
                        try:
                            running_positions[num_str] = int(drv_data['Position'])
                        except (ValueError, TypeError):
                            pass
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
                latest_cars[num_str] = {
                    'driverNum': _safe_int(num_str),
                    'code':      info['code'],
                    'team':      info['team'],
                    'pos':       running_positions.get(num_str, 99),
                    'p':         {'x': nx, 'y': ny},
                    'status':    status,
                }

        # Rate-limit publishing
        now = time.monotonic()
        if now - last_publish < FRAME_INTERVAL_S:
            continue
        if not latest_cars:
            continue

        last_publish = now
        rev += 1
        time_ms = int(session_s * 1000)
        cars_list = list(latest_cars.values())

        for c in cars_list:
            snapshot['cars'][str(c['driverNum'])] = c
        snapshot['timeMs'] = time_ms
        snapshot['rev'] = rev

        frame = build_frame(session, rev, time_ms, cars_list)
        r.set(snap_key(session), json.dumps(snapshot, separators=(",", ":")))
        r.publish(frames_chan(session), json.dumps(frame, separators=(",", ":")))

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

    import threading

    capture_out = os.environ.get('CAPTURE_OUT', f'capture-{session}.txt')
    _log.info(f"Connecting to F1 live-timing SignalR stream; saving capture to {capture_out}")
    _log.info("NOTE: This only streams data during a live F1 session.")

    bounds = BoundBox()
    rev_holder = [starting_rev(r, session)]
    driver_info: dict[str, dict] = {}
    running_positions: dict[str, int] = {}
    latest_cars: dict[str, dict] = {}
    snapshot_holder = [build_snapshot(session, label or "Live F1", [], [], rev_holder[0])]
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
                if isinstance(drv_data, dict) and 'Position' in drv_data:
                    try:
                        running_positions[num_str] = int(drv_data['Position'])
                    except (ValueError, TypeError):
                        pass

        elif topic == 'Position.z':
            try:
                samples = _decode_position_payload(payload)
            except Exception:
                return
            now = time.monotonic()
            for sample in samples:
                ts_str = sample.get('Timestamp', '')
                try:
                    time_ms = _parse_timestamp_ms(ts_str)
                except Exception:
                    time_ms = int(time.time() * 1000)

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
                    latest_cars[num_str] = {
                        'driverNum': _safe_int(num_str),
                        'code':      info['code'],
                        'team':      info['team'],
                        'pos':       running_positions.get(num_str, 99),
                        'p':         {'x': nx, 'y': ny},
                        'status':    _map_status(raw_status),
                    }

            # Rate-limited publish
            if (now - last_publish[0]) < FRAME_INTERVAL_S or not latest_cars:
                return
            last_publish[0] = now

            rev_holder[0] += 1
            rev = rev_holder[0]
            t_ms = int(time.time() * 1000)
            cars_list = list(latest_cars.values())
            snap = snapshot_holder[0]
            for c in cars_list:
                snap['cars'][str(c['driverNum'])] = c
            snap['timeMs'] = t_ms
            snap['rev'] = rev
            frame = build_frame(session, rev, t_ms, cars_list)
            r.set(snap_key(session), json.dumps(snap, separators=(",", ":")))
            r.publish(frames_chan(session), json.dumps(frame, separators=(",", ":")))

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


# ---------------------------------------------------------------------------
# Message dispatch helpers
# ---------------------------------------------------------------------------

def _dispatch_message(msg, callback) -> None:
    """Extract (topic, payload) pairs from a raw SignalR message and call callback.

    UNVERIFIED: The live message shape depends on signalrcore internals.
    Based on client.py and signalrcore, a 'feed' event msg is a list of
    items where each item may be [topic, payload] or similar.
    CompletionMessage.result is a dict of {topic: snapshot_payload}.

    We handle the two known cases from SignalRClient._on_message.
    """
    try:
        from signalrcore.messages.completion_message import CompletionMessage
        if isinstance(msg, CompletionMessage):
            # Initial subscription snapshot: result = {topic: payload, ...}
            for topic, payload in msg.result.items():
                try:
                    callback(topic, payload)
                except Exception:
                    pass
            return
    except ImportError:
        pass

    if isinstance(msg, list):
        # Incremental update: list of [topic, payload] pairs
        # UNVERIFIED: exact list shape. Best-effort two-element tuple parse.
        for item in msg:
            try:
                if isinstance(item, (list, tuple)) and len(item) >= 2:
                    callback(str(item[0]), item[1])
            except Exception:
                pass


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


def _parse_timestamp_ms(ts: str) -> int:
    """Parse ISO 8601 UTC timestamp to milliseconds since epoch."""
    # '2024-09-01T13:01:00.123Z' -> int ms
    ts = ts.rstrip('Z')
    # Right-pad fractional seconds to 6 digits
    if '.' in ts:
        base, frac = ts.split('.', 1)
        frac = (frac + '000000')[:6]
        ts = f"{base}.{frac}"
    dt = datetime.strptime(ts, '%Y-%m-%dT%H:%M:%S.%f')
    dt = dt.replace(tzinfo=timezone.utc)
    return int(dt.timestamp() * 1000)


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
        1. If env var CAPTURE_FILE is set and the file exists → replay offline.
        2. Else if env var LIVE=1 is set (or no CAPTURE_FILE set but we're in
           live mode) → attempt SignalR connection.
        3. If neither condition holds → log and return 0 (structural-check mode).

    Environment:
        CAPTURE_FILE  path to a saved capture file (for offline replay)
        CAPTURE_OUT   where to save a new capture during live mode (default:
                      capture-<session>.txt)
        NO_LIVE       set to '1' to skip live connection attempt (useful for tests)
    """
    capture_file = os.environ.get('CAPTURE_FILE', '')
    no_live = os.environ.get('NO_LIVE', '0') == '1'

    if capture_file and os.path.exists(capture_file):
        _log.info(f"CAPTURE_FILE={capture_file} → offline replay mode")
        _replay_capture(r, session, label or "Live F1 (replay)", capture_file)
        return

    if capture_file and not os.path.exists(capture_file):
        _log.warning(f"CAPTURE_FILE={capture_file!r} does not exist — skipping replay")

    if no_live:
        _log.info("NO_LIVE=1 set — skipping live connection (structural check mode)")
        _log.info("run_live is callable and would connect during a real session.")
        return

    # Attempt live connection
    _log.info("No capture file found → attempting live SignalR connection")
    _log.info("NOTE: This only works during a live F1 session.")
    _log.info("Outside a session: the stream will time out after ~120 s with no data.")
    _log.info("To skip: set NO_LIVE=1")
    _run_live_signalr(r, session, label)
