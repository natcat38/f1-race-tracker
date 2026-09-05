"""Unit tests for the pure pit-window / pit-stop derivation in ingest/pit.py.

pit.py is deliberately pandas-free (issue #114), so this needs nothing beyond
pytest and runs in CI's fastf1-free contract job like ghost.py/radio.py's tests.
"""
from pit import build_pit_data


def _laps(rows):
    """Build the plain-tuple laps shape build_pit_data expects from dicts of
    LapNumber/PitInTime/PitOutTime/LapStartTime given as plain seconds (float)
    or None (or omitted, meaning None) — the shape record.py hands over after
    converting FastF1's Timedelta columns."""
    return [
        (
            r["LapNumber"],
            r.get("PitInTime"),
            r.get("PitOutTime"),
            r.get("LapStartTime"),
        )
        for r in rows
    ]


def test_pit_lane_start_produces_a_window_but_no_stop():
    # Car starts the race from the pit lane: lap 1 has a PitOutTime but no
    # PitInTime. The backdated pit_in must flag the pit window but must NOT
    # be recorded as a pit stop.
    laps = _laps([
        {"LapNumber": 1, "LapStartTime": 0.0, "PitOutTime": 25.0},
        {"LapNumber": 2, "LapStartTime": 90.0},
        {"LapNumber": 3, "LapStartTime": 180.0},
    ])
    windows, stops = build_pit_data(laps)
    assert windows == [(0.0, 25.0)]
    assert stops == []


def test_real_pit_stop_mid_race_is_recorded():
    laps = _laps([
        {"LapNumber": 1, "LapStartTime": 0.0},
        {"LapNumber": 10, "LapStartTime": 900.0, "PitInTime": 905.0},
        {"LapNumber": 11, "LapStartTime": 930.0, "PitOutTime": 927.0},
    ])
    windows, stops = build_pit_data(laps)
    assert windows == [(905.0, 927.0)]
    assert stops == [{"lap": 10, "durationS": 22.0}]


def test_pit_lane_start_followed_by_a_real_stop_records_only_the_real_one():
    laps = _laps([
        {"LapNumber": 1, "LapStartTime": 0.0, "PitOutTime": 25.0},
        {"LapNumber": 20, "LapStartTime": 1800.0, "PitInTime": 1805.0},
        {"LapNumber": 21, "LapStartTime": 1830.0, "PitOutTime": 1827.0},
    ])
    windows, stops = build_pit_data(laps)
    assert windows == [(0.0, 25.0), (1805.0, 1827.0)]
    assert stops == [{"lap": 20, "durationS": 22.0}]


def test_no_pit_activity_yields_empty_windows_and_stops():
    laps = _laps([
        {"LapNumber": 1, "LapStartTime": 0.0},
        {"LapNumber": 2, "LapStartTime": 90.0},
    ])
    windows, stops = build_pit_data(laps)
    assert windows == []
    assert stops == []


def test_unfinished_stop_at_end_of_data_flags_window_but_records_no_stop():
    # PitInTime seen but no matching PitOutTime anywhere after (rare edge —
    # session ended mid-stop). No real duration exists, so no pit_stops entry
    # is fabricated (issue #110) — the window still flags the car as "in the
    # pits" for a typical stop length.
    laps = _laps([
        {"LapNumber": 5, "LapStartTime": 400.0, "PitInTime": 405.0},
    ])
    windows, stops = build_pit_data(laps)
    assert windows == [(405.0, 435.0)]
    assert stops == []


def test_driver_retires_mid_stop_gets_no_fabricated_pit_stop_entry():
    # Same shape as above but explicitly modeling a mid-race retirement: the
    # driver pits on lap 30 and the data simply ends there (car never leaves).
    # Regression test for issue #110 — must not synthesize a plausible-looking
    # 30.0s pit_stops entry for a stop that never actually completed.
    laps = _laps([
        {"LapNumber": 1, "LapStartTime": 0.0},
        {"LapNumber": 29, "LapStartTime": 2600.0},
        {"LapNumber": 30, "LapStartTime": 2700.0, "PitInTime": 2705.0},
    ])
    windows, stops = build_pit_data(laps)
    assert windows == [(2705.0, 2735.0)]
    assert stops == []


def test_back_to_back_stops_on_consecutive_laps_are_both_recorded():
    # Regression test for issue #100: two independent stops on consecutive
    # laps (not a same-row double-stack) must both be recorded — the second
    # PitInTime must not corrupt or drop the first stop's pending window.
    laps = _laps([
        {"LapNumber": 1, "LapStartTime": 0.0},
        {"LapNumber": 10, "LapStartTime": 900.0, "PitInTime": 905.0},
        {"LapNumber": 11, "LapStartTime": 930.0, "PitOutTime": 927.0},
        {"LapNumber": 12, "LapStartTime": 960.0, "PitInTime": 965.0},
        {"LapNumber": 13, "LapStartTime": 990.0, "PitOutTime": 987.0},
    ])
    windows, stops = build_pit_data(laps)
    assert windows == [(905.0, 927.0), (965.0, 987.0)]
    assert stops == [
        {"lap": 10, "durationS": 22.0},
        {"lap": 12, "durationS": 22.0},
    ]


def test_same_row_pit_out_and_pit_in_closes_the_pending_stop_first():
    # Regression test for issue #100: a same-row PitOutTime (closing stop 1)
    # and PitInTime (opening stop 2) — e.g. a double-stack or a stop-go right
    # after leaving the pits. The PitOutTime branch must close stop 1 with
    # THIS row's PitOutTime before the PitInTime branch opens stop 2, instead
    # of stop 2's pit_in overwriting stop 1's pending state first.
    laps = _laps([
        {"LapNumber": 1, "LapStartTime": 0.0},
        {"LapNumber": 10, "LapStartTime": 900.0, "PitInTime": 905.0},
        # Lap 11: car leaves stop 1 (PitOutTime=927) and immediately pits
        # again for stop 2 (PitInTime=929) on the same lap row.
        {"LapNumber": 11, "LapStartTime": 930.0, "PitOutTime": 927.0, "PitInTime": 929.0},
        {"LapNumber": 12, "LapStartTime": 960.0, "PitOutTime": 951.0},
    ])
    windows, stops = build_pit_data(laps)
    assert windows == [(905.0, 927.0), (929.0, 951.0)]
    assert stops == [
        {"lap": 10, "durationS": 22.0},
        {"lap": 11, "durationS": 22.0},
    ]
