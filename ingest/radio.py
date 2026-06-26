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
    Returns [{timeMs, driverNum, clip}] for captures inside the window, sorted by time.

    The clip URL join is slash-normalised: it works whether or not api_path has a
    trailing slash (or Path a leading one), so a missing separator can't silently
    produce a broken URL. A capture with a missing/non-numeric RacingNumber (or a
    missing Utc/Path) is skipped rather than crashing the whole extraction — the
    feed is external, so one malformed entry must not drop the entire timeline."""
    out = []
    for cap in captures:
        utc, num, path = cap.get("Utc"), cap.get("RacingNumber"), cap.get("Path")
        if utc is None or num is None or path is None:
            continue
        try:
            driver_num = int(num)
        except (TypeError, ValueError):
            continue
        time_ms = _utc_to_session_ms(utc, t0_epoch_s)
        if window_start_s * 1000 <= time_ms < window_end_s * 1000:
            out.append({
                "timeMs": time_ms,
                "driverNum": driver_num,
                "clip": base_url + api_path.rstrip("/") + "/" + path.lstrip("/"),
            })
    out.sort(key=lambda m: m["timeMs"])
    return out
