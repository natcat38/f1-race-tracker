"""Unit tests for the pure pit-window / pit-stop derivation in ingest/pit.py."""
import pandas as pd

from pit import build_pit_data


def _laps(rows):
    """Build a laps-like DataFrame from dicts of LapNumber/PitInTime/PitOutTime/LapStartTime
    given as plain seconds (float) or None; converted to Timedelta like FastF1 laps."""
    def td(v):
        return pd.NaT if v is None else pd.Timedelta(seconds=v)

    return pd.DataFrame([{
        "LapNumber": r["LapNumber"],
        "PitInTime": td(r.get("PitInTime")),
        "PitOutTime": td(r.get("PitOutTime")),
        "LapStartTime": td(r.get("LapStartTime")),
    } for r in rows])


def test_pit_lane_start_produces_a_window_but_no_stop():
    # Car starts the race from the pit lane: lap 1 has a PitOutTime but no
    # PitInTime. The backdated pit_in must flag the pit window but must NOT
    # be recorded as a pit stop.
    drv = _laps([
        {"LapNumber": 1, "LapStartTime": 0.0, "PitOutTime": 25.0},
        {"LapNumber": 2, "LapStartTime": 90.0},
        {"LapNumber": 3, "LapStartTime": 180.0},
    ])
    windows, stops = build_pit_data(drv)
    assert windows == [(0.0, 25.0)]
    assert stops == []


def test_real_pit_stop_mid_race_is_recorded():
    drv = _laps([
        {"LapNumber": 1, "LapStartTime": 0.0},
        {"LapNumber": 10, "LapStartTime": 900.0, "PitInTime": 905.0},
        {"LapNumber": 11, "LapStartTime": 930.0, "PitOutTime": 927.0},
    ])
    windows, stops = build_pit_data(drv)
    assert windows == [(905.0, 927.0)]
    assert stops == [{"lap": 10, "durationS": 22.0}]


def test_pit_lane_start_followed_by_a_real_stop_records_only_the_real_one():
    drv = _laps([
        {"LapNumber": 1, "LapStartTime": 0.0, "PitOutTime": 25.0},
        {"LapNumber": 20, "LapStartTime": 1800.0, "PitInTime": 1805.0},
        {"LapNumber": 21, "LapStartTime": 1830.0, "PitOutTime": 1827.0},
    ])
    windows, stops = build_pit_data(drv)
    assert windows == [(0.0, 25.0), (1805.0, 1827.0)]
    assert stops == [{"lap": 20, "durationS": 22.0}]


def test_no_pit_activity_yields_empty_windows_and_stops():
    drv = _laps([
        {"LapNumber": 1, "LapStartTime": 0.0},
        {"LapNumber": 2, "LapStartTime": 90.0},
    ])
    windows, stops = build_pit_data(drv)
    assert windows == []
    assert stops == []


def test_unfinished_stop_at_end_of_data_assumes_typical_duration_no_lap_dropped():
    # PitInTime seen but no matching PitOutTime anywhere after (rare edge —
    # session ended mid-stop). Still recorded as a real stop since a real
    # PitInTime existed.
    drv = _laps([
        {"LapNumber": 5, "LapStartTime": 400.0, "PitInTime": 405.0},
    ])
    windows, stops = build_pit_data(drv)
    assert windows == [(405.0, 435.0)]
    assert stops == [{"lap": 5, "durationS": 30.0}]
