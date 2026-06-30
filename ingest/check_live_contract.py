"""Assert live.py builds messages whose key sets exactly match the Go contract."""
import sys
from live import build_snapshot, build_frame

SNAP_KEYS = {"session", "mode", "label", "track", "radio", "lapTrace", "cars", "timeMs", "rev"}
FRAME_KEYS = {"session", "rev", "t", "timeMs", "cars"}

snap = build_snapshot("live", "Test", [{"x": 0.1, "y": 0.2}],
                      [{"timeMs": 1000, "driverNum": 1, "clip": "https://x/a.mp3"}],
                      {1: [0, 100, 200]}, 5)
frame = build_frame("live", 6, 1234, [{"driverNum": 1, "code": "VER", "team": "Red Bull",
                                       "pos": 1, "p": {"x": 0.1, "y": 0.2}, "status": "OnTrack"}])

assert set(snap) == SNAP_KEYS, f"snapshot keys {set(snap)} != {SNAP_KEYS}"
assert set(frame) == FRAME_KEYS, f"frame keys {set(frame)} != {FRAME_KEYS}"
assert snap["mode"] == "live"
assert isinstance(frame["cars"], list) and isinstance(snap["cars"], dict)
print("live.py contract self-check PASSED")
sys.exit(0)
