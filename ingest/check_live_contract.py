"""Assert live.py builds messages whose key sets exactly match the Go contract.

Collectable by pytest (`pytest ingest`) AND runnable directly
(`python ingest/check_live_contract.py`) for the CI contract job.
"""
import sys
from live import build_snapshot, build_frame, fold_messages
from live_signalr import _parse_timing_line, _parse_tyre_line

SNAP_KEYS = {"session", "mode", "label", "track", "radio", "lapTrace", "totalLaps", "stints", "cars", "timeMs", "rev"}
FRAME_KEYS = {"session", "rev", "t", "timeMs", "cars"}

# Per-car extra fields live_signalr.py's TimingData/TimingAppData parsing may
# add on top of the base car dict (driverNum/code/team/pos/p/status) — must be
# a subset of internal/model/model.go's CarState json tags.
CAR_EXTRA_KEYS = {"lap", "gapMs", "gapLaps", "intMs", "lastLapMs", "tyre", "tyreAge"}


def test_snapshot_and_frame_key_contract():
    snap = build_snapshot("live", "Test", [{"x": 0.1, "y": 0.2}],
                          [{"timeMs": 1000, "driverNum": 1, "clip": "https://x/a.mp3"}],
                          {1: [0, 100, 200]}, {1: [{"compound": "SOFT", "startLap": 1, "endLap": 10}]}, 53, 5)
    frame = build_frame("live", 6, 1234, [{"driverNum": 1, "code": "VER", "team": "Red Bull",
                                           "pos": 1, "p": {"x": 0.1, "y": 0.2}, "status": "OnTrack"}])

    assert set(snap) == SNAP_KEYS, f"snapshot keys {set(snap)} != {SNAP_KEYS}"
    assert set(frame) == FRAME_KEYS, f"frame keys {set(frame)} != {FRAME_KEYS}"
    assert snap["mode"] == "live"
    assert isinstance(frame["cars"], list) and isinstance(snap["cars"], dict)


def test_frame_messages_key_optional():
    msg = {"rev": 7, "t": 1200, "category": "Flag", "message": "GREEN FLAG"}
    frame = build_frame("live", 7, 1234, [], [msg])
    assert set(frame) == FRAME_KEYS | {"messages"}, f"frame keys {set(frame)} != {FRAME_KEYS | {'messages'}}"
    assert frame["messages"] == [msg]
    # No messages passed (or None/empty) -> key omitted, same key set as the base contract.
    assert build_frame("live", 7, 1234, []).keys() == FRAME_KEYS
    assert build_frame("live", 7, 1234, [], None).keys() == FRAME_KEYS
    assert build_frame("live", 7, 1234, [], []).keys() == FRAME_KEYS


def test_frame_weather_key_optional():
    wx = {"airTempC": 28.5, "trackTempC": 41.2, "rainfall": False}
    frame = build_frame("live", 7, 1234, [], None, wx)
    assert set(frame) == FRAME_KEYS | {"weather"}, f"frame keys {set(frame)} != {FRAME_KEYS | {'weather'}}"
    assert frame["weather"] == wx
    # No weather passed -> key omitted, same key set as the base contract.
    assert build_frame("live", 7, 1234, []).keys() == FRAME_KEYS
    assert build_frame("live", 7, 1234, [], None, None).keys() == FRAME_KEYS


def test_live_signalr_car_extras_match_contract():
    timing = _parse_timing_line({
        "NumberOfLaps": 5, "GapToLeader": "+1.234",
        "IntervalToPositionAhead": {"Value": "+0.500"},
        "LastLapTime": {"Value": "1:25.633"},
    })
    assert set(timing) <= CAR_EXTRA_KEYS, f"unexpected keys: {set(timing) - CAR_EXTRA_KEYS}"
    assert timing == {"lap": 5, "gapMs": 1234, "intMs": 500, "lastLapMs": 85633}

    tyre = _parse_tyre_line({"Stints": {"0": {"Compound": "medium", "TotalLaps": 12}}})
    assert set(tyre) <= CAR_EXTRA_KEYS, f"unexpected keys: {set(tyre) - CAR_EXTRA_KEYS}"
    assert tyre == {"tyre": "MEDIUM", "tyreAge": 12}


def test_fold_messages_caps_at_30():
    existing = [{"rev": i} for i in range(28)]
    new = [{"rev": 28}, {"rev": 29}]
    folded = fold_messages(existing, new)
    assert len(folded) == 30, f"expected 30, got {len(folded)}"
    assert folded[0]["rev"] == 0 and folded[-1]["rev"] == 29

    # Pushing 5 more past the cap drops the oldest, keeping the newest 30.
    folded = fold_messages(folded, [{"rev": 30}, {"rev": 31}, {"rev": 32}, {"rev": 33}, {"rev": 34}])
    assert len(folded) == 30
    assert folded[0]["rev"] == 5 and folded[-1]["rev"] == 34


if __name__ == "__main__":
    test_snapshot_and_frame_key_contract()
    test_frame_messages_key_optional()
    test_frame_weather_key_optional()
    test_live_signalr_car_extras_match_contract()
    test_fold_messages_caps_at_30()
    print("live.py contract self-check PASSED")
    sys.exit(0)
