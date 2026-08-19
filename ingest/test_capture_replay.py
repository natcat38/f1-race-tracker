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

import pytest

# _replay_capture actually drives fastf1.livetiming.data.LiveTimingData (only
# imported lazily, inside that function, so importing live_signalr itself
# never requires fastf1) — so this test needs fastf1 installed to run, even
# though it needs no network/Redis. CI's `contract` job is deliberately
# fastf1-free (ingest/requirements-dev.txt), so skip cleanly there instead of
# failing; run it for real wherever fastf1 is installed (e.g. locally).
pytest.importorskip("fastf1", reason="needs fastf1 for LiveTimingData; not installed in the fastf1-free contract job")

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


CLIP_BASE = ("https://livetiming.formula1.com/static/"
             "2024/2024-09-01_Italian_Grand_Prix/2024-09-01_Race/TeamRadio/")


def test_replay_capture_delivers_live_radio_on_frames():
    """Live radio refs ride frames and accumulate on the snapshot (ADR-0008).

    The fixture carries TeamRadio in both shapes the feed uses: a list of captures
    and an index-keyed dict (the incremental-patch shape). Both must parse.
    """
    r = FakeRedis()
    _replay_capture(r, "test-session", "Test Capture", CAPTURE_PATH)

    snap = json.loads(r.store["snapshot:test-session"])
    refs = snap.get("radio", [])
    assert len(refs) == 2, f"expected both capture shapes to parse, got {refs}"
    assert [ref["driverNum"] for ref in refs] == [1, 1], refs
    assert [ref["clip"] for ref in refs] == [
        CLIP_BASE + "MAXVER01_1_20240901_125910.mp3",
        CLIP_BASE + "MAXVER01_1_20240901_125940.mp3",
    ], refs
    # timeMs is the clip's own Utc as epoch ms — behind the live wall clock by design.
    assert refs[0]["timeMs"] < refs[1]["timeMs"], refs

    framed = [json.loads(msg) for _, msg in r.published if "radio" in json.loads(msg)]
    assert framed, "expected at least one published frame to carry radio refs"
    assert len(framed[0]["radio"]) == 2, framed[0]


if __name__ == "__main__":
    test_replay_capture_populates_timing_and_tyre_fields()
    test_replay_capture_delivers_live_radio_on_frames()
    print("capture-replay field-coverage self-check PASSED")
    sys.exit(0)
