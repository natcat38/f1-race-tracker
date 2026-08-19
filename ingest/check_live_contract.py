"""Assert live.py builds messages whose key sets exactly match the Go contract.

Collectable by pytest (`pytest ingest`) AND runnable directly
(`python ingest/check_live_contract.py`) for the CI contract job.
"""
import re
import sys
from pathlib import Path

from live import build_snapshot, build_frame, fold_messages
from live_signalr import _parse_timing_line, _parse_tyre_line

SNAP_KEYS = {"session", "mode", "label", "track", "radio", "lapTrace", "totalLaps", "stints", "cars", "timeMs", "rev"}
FRAME_KEYS = {"session", "rev", "t", "timeMs", "cars"}

# The base car dict live.py builds (see its module docstring's Car shape).
CAR_BASE_KEYS = {"driverNum", "code", "team", "pos", "p", "status"}

# Per-car extra fields live_signalr.py's TimingData/TimingAppData parsing may
# add on top of the base car dict (driverNum/code/team/pos/p/status) — must be
# a subset of internal/model/model.go's CarState json tags.
CAR_EXTRA_KEYS = {"lap", "gapMs", "gapLaps", "intMs", "lastLapMs", "tyre", "tyreAge"}

# Resolved from this file, not the cwd: pytest runs with working-directory=ingest
# while `python ingest/check_live_contract.py` runs from the repo root.
MODEL_GO = Path(__file__).resolve().parent.parent / "internal" / "model" / "model.go"


def _go_json_tags(struct):
    """Return (all_tags, required_tags) for a struct in internal/model/model.go.

    required_tags are the ones without `,omitempty` — Go always marshals them, so
    the Python mirror must always emit them too.
    """
    src = MODEL_GO.read_text(encoding="utf-8")
    m = re.search(r"^type " + struct + r" struct \{$(.*?)^\}$", src, re.S | re.M)
    assert m, f"struct {struct} not found in {MODEL_GO}"
    all_tags, required = set(), set()
    for tag in re.findall(r'json:"([^"]*)"', m.group(1)):
        name, _, opts = tag.partition(",")
        if not name or name == "-":
            continue
        all_tags.add(name)
        if "omitempty" not in opts.split(","):
            required.add(name)
    return all_tags, required


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


def test_frame_radio_key_optional():
    """Live team-radio refs ride frames as an optional key (ADR-0008).

    Like messages/weather it is omitempty on the Go side, so it must be absent —
    not empty — when there is nothing to send.
    """
    refs = [{"timeMs": 1720188190500, "driverNum": 1,
             "clip": "https://livetiming.formula1.com/static/x/TeamRadio/a.mp3"}]
    frame = build_frame("live", 7, 1234, [], None, None, refs)
    assert set(frame) == FRAME_KEYS | {"radio"}, f"frame keys {set(frame)} != {FRAME_KEYS | {'radio'}}"
    assert frame["radio"] == refs
    # No radio passed (or None/empty) -> key omitted, same key set as the base contract.
    assert build_frame("live", 7, 1234, [], None, None, None).keys() == FRAME_KEYS
    assert build_frame("live", 7, 1234, [], None, None, []).keys() == FRAME_KEYS


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


def test_key_sets_match_go_model():
    """The key sets above are a hand-written mirror of internal/model/model.go.

    Every other check in this file compares Python against those constants, so a
    Go-side rename would leave them stale and still pass. This one pins them to
    the Go source itself, closing the Go<->Python drift path the way
    internal/model/contract_test.go's golden fixture closes Go<->TS.
    """
    snap_all, snap_req = _go_json_tags("Snapshot")
    frame_all, frame_req = _go_json_tags("Frame")
    car_all, car_req = _go_json_tags("CarState")
    car_keys = CAR_BASE_KEYS | CAR_EXTRA_KEYS

    # Python must not emit keys Go has no field for — Go would silently drop them.
    assert SNAP_KEYS <= snap_all, f"snapshot keys not in Go Snapshot: {SNAP_KEYS - snap_all}"
    assert FRAME_KEYS <= frame_all, f"frame keys not in Go Frame: {FRAME_KEYS - frame_all}"
    assert car_keys <= car_all, f"car keys not in Go CarState: {car_keys - car_all}"

    # Go's non-omitempty fields are always on the wire, so Python must emit them
    # all — a new required Go field would otherwise arrive as a zero value.
    assert snap_req <= SNAP_KEYS, f"Go Snapshot requires keys Python omits: {snap_req - SNAP_KEYS}"
    assert frame_req <= FRAME_KEYS, f"Go Frame requires keys Python omits: {frame_req - FRAME_KEYS}"
    assert car_req <= car_keys, f"Go CarState requires keys Python omits: {car_req - car_keys}"


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
    test_frame_radio_key_optional()
    test_live_signalr_car_extras_match_contract()
    test_key_sets_match_go_model()
    test_fold_messages_caps_at_30()
    print("live.py contract self-check PASSED")
    sys.exit(0)
