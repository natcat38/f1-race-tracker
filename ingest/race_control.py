"""Pure helper for baking race-control messages into clip frames.

Kept free of fastf1/pandas so it is unit-testable and importable in the CI
contract job (which installs only `redis`). The recorder does the FastF1 fetch
and tz handling, then hands plain dicts here.
"""
from resample import in_window_ms


def extract_race_control(rows, t0_epoch_s, window_start_s, window_end_s, known_driver_nums):
    """rows: list of {'epoch_s': float, 'category': str, 'message': str,
    'racingNumber': str|None} from FastF1's race_control_messages.
    Returns [{timeMs, category, message, driver}] for messages inside the
    window, sorted by time. driver is None unless racingNumber parses to an
    int present in known_driver_nums — an unscoped/blank number (e.g. a
    track-wide flag) must not become a bogus car link. Rows missing a
    category or message are skipped rather than crashing the extraction."""
    out = []
    for row in rows:
        cat, msg = row.get('category'), row.get('message')
        if not cat or not msg:
            continue
        time_ms = round((row['epoch_s'] - t0_epoch_s) * 1000)
        if not in_window_ms(time_ms, window_start_s, window_end_s):
            continue
        driver = None
        try:
            n = int(row.get('racingNumber'))
            if n in known_driver_nums:
                driver = n
        except (TypeError, ValueError):
            pass
        out.append({'timeMs': time_ms, 'category': cat, 'message': msg, 'driver': driver})
    out.sort(key=lambda m: m['timeMs'])
    return out
