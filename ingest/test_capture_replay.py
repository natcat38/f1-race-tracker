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

from live_signalr import _replay_capture, _shutdown_flush_radio  # noqa: E402

CAPTURE_PATH = os.path.join(os.path.dirname(__file__), "tests", "capture_sample.txt")
CAPTURE_PATH_RADIO_TAIL = os.path.join(
    os.path.dirname(__file__), "tests", "capture_sample_radio_tail.txt")


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


class FailingPublishRedis(FakeRedis):
    """FakeRedis whose publish() always raises — simulates Redis dying (or
    being unreachable) at the exact moment of the shutdown-time trailing-frame
    flush, for PR #68's review fix."""

    def publish(self, channel, message):
        raise ConnectionError("simulated Redis outage")


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


TAIL_CLIP = ("https://livetiming.formula1.com/static/"
             "2024/2024-09-01_Italian_Grand_Prix/2024-09-01_Race/TeamRadio/"
             "MAXVER01_1_20240901_130000.mp3")


def test_replay_capture_flushes_trailing_radio_at_capture_end():
    """Radio arriving after the last position-triggered frame must still reach
    subscribers (issue #62). capture_sample_radio_tail.txt's *last* event is a
    TeamRadio message — unlike capture_sample.txt, which ends on Position.z — so
    with the pre-fix code (refs only drained inside the position-publish branch)
    that ref never rides any frame and is silently dropped at replay end.
    """
    r = FakeRedis()
    _replay_capture(r, "test-session", "Test Capture", CAPTURE_PATH_RADIO_TAIL)

    snap = json.loads(r.store["snapshot:test-session"])
    refs = snap.get("radio", [])
    assert len(refs) == 1, f"expected the trailing TeamRadio ref to reach the snapshot, got {refs}"
    assert refs[0]["clip"] == TAIL_CLIP, refs
    assert refs[0]["driverNum"] == 1, refs

    all_published = [json.loads(msg) for _, msg in r.published]
    assert len(all_published) >= 2, (
        "expected the Position.z sample's own frame plus a separate trailing "
        f"radio-only frame, got {all_published}"
    )
    trailing = all_published[-1]
    assert trailing.get("radio", []) and len(trailing["radio"]) == 1, trailing
    assert trailing["radio"][0]["clip"] == TAIL_CLIP, trailing

    # The trailing frame carries no new car data — it reuses the last known
    # car list (from the one Position.z sample) rather than emitting nothing
    # or something malformed against the Frame contract.
    assert trailing["cars"], "expected the trailing frame to reuse the last known car list"
    assert trailing["cars"][0]["driverNum"] == 1

    # rev keeps advancing past the last regular frame (the trailing frame is a
    # real, later frame, not a rewind), and timeMs does not go backwards.
    assert trailing["rev"] > all_published[0]["rev"]
    assert trailing["timeMs"] >= all_published[0]["timeMs"]


def test_shutdown_flush_survives_redis_failure_without_masking_original_exception(caplog):
    """PR #68 review fix: `_run_live_signalr`'s shutdown flush (`_shutdown_flush_radio`,
    called from a `finally` around client.start()) must be best-effort.

    If client.start() raised because Redis itself died — or Redis is simply
    unreachable at shutdown — an unguarded flush would raise a *second*
    exception from inside that `finally`. That both (a) becomes a misleading
    proximate error in place of whatever client.start() actually raised, and
    (b) skips the deferred-drop log line entirely, defeating issue #62's
    "logged, never silent" guarantee for a *different* reason than the one
    it was built to cover.

    Reproduces that shape directly (a real `try/finally` around a raising
    "client.start()", exactly as in `_run_live_signalr`) with a Redis stand-in
    whose publish() always raises, and checks all three things: the WARNING
    for the lost pending refs, the deferred-drop WARNING still firing
    afterward, and the *original* exception — not a Redis one — propagating.
    """
    r = FailingPublishRedis()
    snapshot = {"session": "test-session", "mode": "live", "cars": {}, "radio": [],
                "rev": 5, "timeMs": 1000}
    pending_radio = [{"timeMs": 1500, "driverNum": 1,
                       "clip": "https://livetiming.formula1.com/static/x/MAXVER01.mp3"}]
    # Contrived (the real code never has both non-empty from the same run — deferred
    # only ever drains *into* pending), but _shutdown_flush_radio takes them as two
    # independent parameters, and both must be handled correctly regardless.
    deferred_radio = [{"Captures": [{"Utc": "2024-09-01T12:59:10Z", "RacingNumber": "1",
                                      "Path": "TeamRadio/UNRESOLVED.mp3"}]}]

    def client_start():
        raise RuntimeError("SignalR stream died (simulated Redis connection loss)")

    caught = None
    with caplog.at_level("WARNING", logger="live_signalr"):
        try:
            try:
                client_start()
            finally:
                # Mirrors _run_live_signalr's `finally` block exactly.
                _shutdown_flush_radio(
                    r, "test-session", snapshot, 5, {}, pending_radio, deferred_radio)
        except RuntimeError as exc:
            caught = exc

    assert caught is not None, "the original exception must still propagate"
    assert "SignalR stream died" in str(caught), (
        "the flush's own Redis failure must not replace the original exception "
        f"as the proximate error, got: {caught!r}"
    )

    messages = [rec.message for rec in caplog.records]
    assert any("Failed to publish trailing frame" in m and "1 pending" in m for m in messages), messages
    assert any("Dropping 1 TeamRadio payload" in m for m in messages), messages

    # The failed flush must not have thrown away the refs it failed to deliver.
    assert pending_radio, "pending radio refs must survive a failed flush, not be dropped"


if __name__ == "__main__":
    # test_shutdown_flush_survives_redis_failure_without_masking_original_exception
    # takes pytest's `caplog` fixture, so it can't be called directly here — run
    # this file through pytest to exercise it.
    test_replay_capture_populates_timing_and_tyre_fields()
    test_replay_capture_delivers_live_radio_on_frames()
    test_replay_capture_flushes_trailing_radio_at_capture_end()
    print("capture-replay field-coverage self-check PASSED")
    sys.exit(0)
