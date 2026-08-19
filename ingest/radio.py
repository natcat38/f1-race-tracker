"""Pure helpers for baking team radio into a clip header.

Kept free of fastf1/pandas so it is unit-testable and importable in the CI
contract job (which installs only `redis`). The recorder does the FastF1 fetch
and tz handling, then hands plain dicts here.
"""
from datetime import datetime, timezone
from urllib.parse import urlparse

from resample import in_window_ms

_ALLOWED_HOST_SUFFIX = "formula1.com"


def _require_f1_host(base_url):
    """Raise unless base_url is an https URL on formula1.com (or a subdomain).

    Shared by the replay and live paths: clip URLs come from an untrusted external
    feed and must not be able to point playback at a hostile origin (S5)."""
    parsed = urlparse(base_url)
    if parsed.scheme != "https":
        raise ValueError(f"radio: base_url must use https, got scheme={parsed.scheme!r}")
    host = (parsed.hostname or "").lower()
    if host != _ALLOWED_HOST_SUFFIX and not host.endswith("." + _ALLOWED_HOST_SUFFIX):
        raise ValueError(f"radio: base_url host {host!r} is not formula1.com or a subdomain")


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
    feed is external, so one malformed entry must not drop the entire timeline.

    base_url must be an https URL on formula1.com (or a subdomain). The captures come from
    an untrusted external feed, so this guards clip playback against a spoofed/hostile
    origin (S5)."""
    _require_f1_host(base_url)
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
        if in_window_ms(time_ms, window_start_s, window_end_s):
            out.append({
                "timeMs": time_ms,
                "driverNum": driver_num,
                "clip": base_url + api_path.rstrip("/") + "/" + path.lstrip("/"),
            })
    out.sort(key=lambda m: m["timeMs"])
    return out


def _utc_to_epoch_ms(utc_str):
    """Map an ISO-8601 UTC instant to UTC epoch milliseconds (no session t0)."""
    dt = datetime.fromisoformat(utc_str.replace("Z", "+00:00")).astimezone(timezone.utc)
    return round(dt.timestamp() * 1000)


def live_radio_refs(captures, base_url, session_path, seen):
    """Map live SignalR TeamRadio captures to wire radio refs (ADR-0008).

    captures: list of {'Utc','RacingNumber','Path'} (the archived-feed schema, which
    the live topic is assumed to share — see ADR-0008's schema assumption).
    Returns [{timeMs, driverNum, clip}] sorted by time. timeMs is the capture's Utc as
    UTC epoch ms — the live lane's clock domain, where frames stamp timeMs = wall clock.
    seen: a set of already-emitted clip URLs, mutated here. SignalR re-sends the full
    capture list at every (re)subscribe, so dedupe is by final URL.
    Malformed entries are skipped rather than fatal, mirroring extract_radio.
    """
    _require_f1_host(base_url)
    out = []
    for cap in captures:
        utc, num, path = cap.get("Utc"), cap.get("RacingNumber"), cap.get("Path")
        if utc is None or num is None or path is None:
            continue
        try:
            driver_num = int(num)
        except (TypeError, ValueError):
            continue
        clip = base_url.rstrip("/") + "/" + session_path.strip("/") + "/" + path.lstrip("/")
        if clip in seen:
            continue
        seen.add(clip)
        out.append({"timeMs": _utc_to_epoch_ms(utc), "driverNum": driver_num, "clip": clip})
    out.sort(key=lambda m: m["timeMs"])
    return out
