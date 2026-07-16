"""Assert live.py builds messages whose key sets exactly match the Go contract.

Collectable by pytest (`pytest ingest`) AND runnable directly
(`python ingest/check_live_contract.py`) for the CI contract job.
"""
import sys
from live import build_snapshot, build_frame

SNAP_KEYS = {"session", "mode", "label", "track", "radio", "lapTrace", "cars", "timeMs", "rev"}
FRAME_KEYS = {"session", "rev", "t", "timeMs", "cars"}


def test_snapshot_and_frame_key_contract():
    snap = build_snapshot("live", "Test", [{"x": 0.1, "y": 0.2}],
                          [{"timeMs": 1000, "driverNum": 1, "clip": "https://x/a.mp3"}],
                          {1: [0, 100, 200]}, 5)
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


if __name__ == "__main__":
    test_snapshot_and_frame_key_contract()
    test_frame_messages_key_optional()
    print("live.py contract self-check PASSED")
    sys.exit(0)
