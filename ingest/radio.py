"""Pure helpers for baking team radio into a clip header.

Kept free of fastf1/pandas so it is unit-testable and importable in the CI
contract job (which installs only `redis`). The recorder does the FastF1 fetch
and tz handling, then hands plain dicts here.
"""
from datetime import datetime, timezone


def _utc_to_session_ms(utc_str, t0_epoch_s):
    """Map an ISO-8601 UTC instant (e.g. '2024-09-01T12:24:46.541Z') to session
    milliseconds, where t0_epoch_s is session-time zero as a UTC epoch second."""
    dt = datetime.fromisoformat(utc_str.replace("Z", "+00:00")).astimezone(timezone.utc)
    return round((dt.timestamp() - t0_epoch_s) * 1000)


def extract_radio(captures, t0_epoch_s, window_start_s, window_end_s, base_url, api_path):
    """captures: list of {'Utc','RacingNumber','Path'} from FastF1's team_radio feed.
    Returns [{timeMs, driverNum, clip}] for captures inside the window, sorted by time."""
    out = []
    for cap in captures:
        time_ms = _utc_to_session_ms(cap["Utc"], t0_epoch_s)
        if window_start_s * 1000 <= time_ms < window_end_s * 1000:
            out.append({
                "timeMs": time_ms,
                "driverNum": int(cap["RacingNumber"]),
                "clip": base_url + api_path + cap["Path"],
            })
    out.sort(key=lambda m: m["timeMs"])
    return out
