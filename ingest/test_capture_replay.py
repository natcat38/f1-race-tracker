"""Regression test for live_signalr.py's capture-replay path.

Drives _replay_capture over a small synthetic capture file (ingest/tests/
capture_sample.txt, in the exact format LiveTimingData/_replay_capture
consume — see live_signalr.py's module docstring) and asserts the built
snapshot carries not just positions but the newer timing/tyre fields
(lap, gapMs, intMs, lastLapMs, tyre, tyreAge) sourced from TimingData/
TimingAppData. Runs fully offline — no network, no real Redis.
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))

from live_signalr import _replay_capture  # noqa: E402

CAPTURE_PATH = os.path.join(os.path.dirname(__file__), "tests", "capture_sample.txt")


class FakeRedis:
    """Minimal in-memory stand-in for redis.Redis — get/set/publish only."""

    def __init__(self):
        self.store = {}
        self.published = []

    def get(self, key):
        return self.store.get(key)

    def set(self, key, value):
        self.store[key] = value

    def publish(self, channel, message):
        self.published.append((channel, message))


def test_replay_capture_populates_timing_and_tyre_fields():
    r = FakeRedis()
    _replay_capture(r, "test-session", "Test Capture", CAPTURE_PATH)

    snap = json.loads(r.store["snapshot:test-session"])
    car = snap["cars"]["1"]

    assert car["driverNum"] == 1
    assert car["code"] == "VER"
    assert car["team"] == "Red Bull"  # TEAM_MAP normalises "Red Bull Racing"
    assert car["status"] == "OnTrack"
    # A single position sample gives zero-range bounds — BoundBox.normalise
    # offsets from the (only) min, so this collapses to (0.0, 1.0) (Y flipped).
    assert car["p"]["x"] == 0.0 and car["p"]["y"] == 1.0

    # Newly-covered fields, sourced from TimingData / TimingAppData:
    assert car["lap"] == 5
    assert car["gapMs"] == 0
    assert car["intMs"] == 512
    assert car["lastLapMs"] == 85633
    assert car["tyre"] == "SOFT"
    assert car["tyreAge"] == 5

    assert r.published, "expected at least one frame published"


if __name__ == "__main__":
    test_replay_capture_populates_timing_and_tyre_fields()
    print("capture-replay field-coverage self-check PASSED")
    sys.exit(0)
