"""Pure parsers for the live SignalR feed, extracted from live_signalr.py.

Kept free of fastf1/numpy/pandas — same rationale as resample.py/ghost.py/
radio.py — so they're independently unit-testable and importable in the CI
contract job (which installs only `redis`). TEAM_MAP lives here too since
record.py needs the identical mapping (see resample.py's normalise_point for
the other cross-module dedup).
"""
import base64
import json
import zlib

# Upper bound on a decompressed Position.z payload (#117/L-3). A single frame's worth of
# car positions is a few KB of JSON at most; 8 MiB is generous headroom while still
# refusing a zip-bomb-shaped payload before it can exhaust memory.
_MAX_DECOMPRESSED_BYTES = 8 * 1024 * 1024

# FastF1 team name -> frontend colour map key (from web/src/components/teamColours.ts)
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
            # ponytail: stdlib decompressobj with max_length is simpler than a custom
            # chunked-read loop and gives us exactly what we need — decompress up to the
            # cap, then check for leftover input instead of trusting a declared size.
            decompressor = zlib.decompressobj(-15)  # raw deflate (no header)
            decompressed = decompressor.decompress(raw, _MAX_DECOMPRESSED_BYTES)
            if decompressor.unconsumed_tail:
                raise ValueError(
                    f"Position.z payload exceeds {_MAX_DECOMPRESSED_BYTES} bytes decompressed"
                )
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
