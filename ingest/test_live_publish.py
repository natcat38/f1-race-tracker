"""Unit tests for live_signalr.py's two publish paths, without fastf1 or Redis.

test_capture_replay.py drives the same code through a real capture file, which
needs fastf1 installed (it is skipped in CI's fastf1-free contract job). These
tests poke `_publish_frame` / `_publish_trailing_radio_frame` directly instead,
so the position-reconciliation invariants they cover run everywhere.
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))

from live_signalr import _publish_frame, _publish_trailing_radio_frame  # noqa: E402
from resample import UNKNOWN_POS  # noqa: E402


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

    def frames(self):
        """Every published frame, parsed, oldest first."""
        return [json.loads(msg) for _, msg in self.published]


def _car(dnum, pos, lap=10):
    return {
        'driverNum': dnum, 'code': f'D{dnum}', 'team': 'Test',
        'pos': pos, 'p': {'x': 0.5, 'y': 0.5}, 'status': 'OnTrack', 'lap': lap,
    }


def _assert_contiguous(cars):
    positions = sorted(c['pos'] for c in cars)
    assert positions == list(range(1, len(cars) + 1)), (
        f"positions must be unique and contiguous 1..N, got {positions}")
    assert UNKNOWN_POS not in positions, f"{UNKNOWN_POS} must never reach the wire: {positions}"


def _snapshot():
    return {"session": "test-session", "mode": "live", "cars": {}, "rev": 0, "timeMs": 0}


def test_trailing_radio_frame_reconciles_positions():
    """The trailing radio frame is a publish path like any other, so its cars must
    carry a unique, contiguous 1..N order too.

    It used to be the one path that skipped reconciliation, so a stream ending
    before the rate limiter ever let a regular frame out shipped the raw
    per-driver lookups: duplicates, gaps and the UNKNOWN_POS (99) sentinel. The
    existing capture-file regression test uses a single car, where reconciliation
    is a no-op — this one needs several to bite.
    """
    r = FakeRedis()
    snapshot = _snapshot()
    cars = [
        _car(1, 1, lap=20),
        _car(44, 4, lap=20),                 # duplicate raw pos with 55...
        _car(55, 4, lap=19),                 # ...and a gap at 2/3
        _car(63, UNKNOWN_POS, lap=18),       # never reported by the feed
    ]
    refs = [{"timeMs": 1500, "driverNum": 1, "clip": "https://x/a.mp3"}]

    _publish_trailing_radio_frame(r, "test-session", snapshot, 5, 2000, cars, refs)

    frame = r.frames()[-1]
    _assert_contiguous(frame['cars'])
    by_num = {c['driverNum']: c['pos'] for c in frame['cars']}
    assert by_num == {1: 1, 44: 2, 55: 3, 63: 4}, by_num
    assert frame['radio'] == refs, frame


def test_quiet_car_does_not_inherit_its_own_rank_as_input():
    """A driver with no fresh Position.z sample must not feed its previous RANK
    back in as if it were raw feed data.

    `latest_cars`' dicts persist across publishes and reconciliation renumbers
    'pos' in place, so without re-stamping from `running_positions` every publish
    a quiet car's rank sticks: a position change the feed *did* report can then
    never move it. Two publishes, a position swap reported between them, no fresh
    car dicts in between — the shape the live handler actually produces.
    """
    r = FakeRedis()
    snapshot = _snapshot()
    # Raw feed order: 1 leads, 44 second, then a gap up to 16 (P8) and 63 (P9).
    running_positions = {'1': 1, '44': 2, '16': 8, '63': 9}
    latest_cars = {
        '1': _car(1, 1), '44': _car(44, 2), '16': _car(16, 8), '63': _car(63, 9),
    }

    _publish_frame(r, "test-session", snapshot, 1, 1000, latest_cars, running_positions, [])
    first = r.frames()[-1]
    _assert_contiguous(first['cars'])
    assert {c['driverNum']: c['pos'] for c in first['cars']} == {1: 1, 44: 2, 16: 3, 63: 4}

    # The feed now reports 63 ahead of 16. No new Position.z arrives for anyone,
    # so latest_cars still holds the SAME dicts — whose 'pos' the publish above
    # rewrote to 1/2/3/4.
    running_positions['16'], running_positions['63'] = 9, 8

    _publish_frame(r, "test-session", snapshot, 2, 2000, latest_cars, running_positions, [])
    second = r.frames()[-1]
    _assert_contiguous(second['cars'])
    by_num = {c['driverNum']: c['pos'] for c in second['cars']}
    assert by_num == {1: 1, 44: 2, 63: 3, 16: 4}, (
        "the swap the feed reported must reach the wire; a stale rank fed back in "
        f"as raw input would have kept 16 at P3, got {by_num}")

    # The snapshot holds the same car dicts, so it agrees with the frame.
    assert {int(k): v['pos'] for k, v in snapshot['cars'].items()} == by_num


def test_publish_frame_demotes_a_car_the_feed_never_reported():
    """A driver present in Position.z but absent from TimingData has no raw
    position at all; UNKNOWN_POS must sort it last and never reach the wire."""
    r = FakeRedis()
    snapshot = _snapshot()
    running_positions = {'1': 1, '44': 2}
    latest_cars = {'1': _car(1, 1), '44': _car(44, 2), '63': _car(63, UNKNOWN_POS, lap=18)}

    _publish_frame(r, "test-session", snapshot, 1, 1000, latest_cars, running_positions, [])

    frame = r.frames()[-1]
    _assert_contiguous(frame['cars'])
    assert {c['driverNum']: c['pos'] for c in frame['cars']} == {1: 1, 44: 2, 63: 3}


if __name__ == "__main__":
    test_trailing_radio_frame_reconciles_positions()
    test_quiet_car_does_not_inherit_its_own_rank_as_input()
    test_publish_frame_demotes_a_car_the_feed_never_reported()
    print("live publish-path self-check PASSED")
    sys.exit(0)
