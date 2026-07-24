"""Self-check for ingest/race_control.extract_race_control (no fastf1/network needed).

Collectable by pytest (`pytest ingest`) AND runnable directly
(`python ingest/test_race_control.py`) for the CI contract job, which installs only `redis`.
"""
import sys
from race_control import extract_race_control


def test_extract_race_control_window_and_sort():
    # t0 = session-time zero; rows already carry epoch_s (record.py does the tz conversion).
    t0 = 1_725_192_000.0  # 2024-09-01T12:00:00Z
    known = {16, 1, 4, 55}
    rows = [
        {'epoch_s': t0 + 3310, 'category': 'Flag', 'message': 'YELLOW FLAG', 'racingNumber': None},  # in window, unscoped
        {'epoch_s': t0 + 30, 'category': 'Flag', 'message': 'GREEN FLAG', 'racingNumber': None},      # before window
        {'epoch_s': t0 + 3240, 'category': 'Flag', 'message': 'TRACK CLEAR', 'racingNumber': None},   # before 3300
        {'epoch_s': t0 + 3750, 'category': 'Flag', 'message': 'CHEQUERED', 'racingNumber': None},     # exactly at upper bound; half-open excludes it
        {'epoch_s': t0 + 3320, 'category': 'Other', 'message': 'TURN 4 INCIDENT', 'racingNumber': '16'},   # in window, scoped to a known driver
        {'epoch_s': t0 + 3330, 'category': 'Other', 'message': 'UNKNOWN DRIVER', 'racingNumber': '99'},    # in window, unknown driver -> driver None
        {'epoch_s': t0 + 3340, 'category': 'Other', 'message': 'GARBAGE NUMBER', 'racingNumber': 'TBD'},   # in window, non-numeric -> driver None, not a crash
        {'epoch_s': t0 + 3350, 'category': None, 'message': 'NO CATEGORY', 'racingNumber': None},     # missing category -> skipped
        {'epoch_s': t0 + 3360, 'category': 'Flag', 'message': '', 'racingNumber': None},               # missing message -> skipped
    ]
    out = extract_race_control(rows, t0, 3300, 3750, known)

    assert len(out) == 4, f"expected 4 in-window messages, got {len(out)}: {out}"
    assert [m['timeMs'] for m in out] == [3310000, 3320000, 3330000, 3340000], out

    unscoped = out[0]
    assert unscoped['category'] == 'Flag' and unscoped['message'] == 'YELLOW FLAG'
    assert unscoped['driver'] is None, unscoped

    scoped = out[1]
    assert scoped['driver'] == 16 and isinstance(scoped['driver'], int), scoped

    unknown_driver = out[2]
    assert unknown_driver['driver'] is None, unknown_driver

    garbage_number = out[3]
    assert garbage_number['driver'] is None, garbage_number

    # half-open window: a message exactly at window_end_s (3750s) is EXCLUDED
    assert 'CHEQUERED' not in [m['message'] for m in out], f"upper-bound message leaked in: {out}"
    # before-window messages excluded
    assert 'GREEN FLAG' not in [m['message'] for m in out]
    assert 'TRACK CLEAR' not in [m['message'] for m in out]

    # sorted ascending when supplied out of order
    rows2 = [
        {'epoch_s': t0 + 3360, 'category': 'Flag', 'message': 'b', 'racingNumber': None},
        {'epoch_s': t0 + 3300, 'category': 'Flag', 'message': 'a', 'racingNumber': None},
    ]
    out2 = extract_race_control(rows2, t0, 3300, 3750, known)
    assert [m['timeMs'] for m in out2] == [3300000, 3360000], out2


if __name__ == "__main__":
    test_extract_race_control_window_and_sort()
    print("race_control.extract_race_control self-check PASSED")
    sys.exit(0)
