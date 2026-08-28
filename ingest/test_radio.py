"""Self-check for ingest/radio.extract_radio (no fastf1/network needed).

Collectable by pytest (`pytest ingest`) AND runnable directly
(`python ingest/test_radio.py`) for the CI contract job, which installs only `redis`.
"""
import sys
from datetime import datetime, timezone
from radio import extract_radio, live_radio_refs


def test_extract_radio_window_and_sort():
    # t0 = session-time zero at 2024-09-01T12:00:00Z
    t0 = datetime(2024, 9, 1, 12, 0, 0, tzinfo=timezone.utc).timestamp()
    caps = [
        {"Utc": "2024-09-01T12:55:10.000Z", "RacingNumber": "16", "Path": "TeamRadio/LEC.mp3"},  # 3310s -> in window
        {"Utc": "2024-09-01T12:00:30.000Z", "RacingNumber": "1", "Path": "TeamRadio/VER.mp3"},   # 30s -> before window
        {"Utc": "2024-09-01T12:54:00.000Z", "RacingNumber": "4", "Path": "TeamRadio/NOR.mp3"},   # 3240s -> before 3300
        {"Utc": "2024-09-01T13:02:30.000Z", "RacingNumber": "55", "Path": "TeamRadio/SAI.mp3"},  # 3750s -> EXACTLY at upper bound; half-open window excludes it
        {"Utc": "2024-09-01T12:55:20.000Z", "RacingNumber": "TBD", "Path": "TeamRadio/BAD.mp3"}, # in window but non-numeric number -> skipped, not a crash
    ]
    out = extract_radio(caps, t0, 3300, 3750, "https://livetiming.formula1.com", "/static/x/")

    # A malformed in-window capture is skipped, not fatal: still exactly 1 valid clip.
    assert len(out) == 1, f"expected 1 in-window clip, got {len(out)}: {out}"
    m = out[0]
    assert m["timeMs"] == 3310000, m
    assert m["driverNum"] == 16 and isinstance(m["driverNum"], int), m
    assert m["clip"] == "https://livetiming.formula1.com/static/x/TeamRadio/LEC.mp3", m
    # half-open window: a capture exactly at window_end_s (3750s) is EXCLUDED
    assert 55 not in [c["driverNum"] for c in out], f"upper-bound capture leaked in: {out}"

    # sorted ascending when multiple in-window
    caps2 = [
        {"Utc": "2024-09-01T12:56:00.000Z", "RacingNumber": "1", "Path": "b.mp3"},   # 3360s
        {"Utc": "2024-09-01T12:55:00.000Z", "RacingNumber": "16", "Path": "a.mp3"},  # 3300s
    ]
    out2 = extract_radio(caps2, t0, 3300, 3750, "https://livetiming.formula1.com", "/p/")
    assert [m["timeMs"] for m in out2] == [3300000, 3360000], out2


def test_extract_radio_rejects_bad_base_url():
    t0 = datetime(2024, 9, 1, 12, 0, 0, tzinfo=timezone.utc).timestamp()
    caps = [{"Utc": "2024-09-01T12:55:10.000Z", "RacingNumber": "16", "Path": "TeamRadio/LEC.mp3"}]

    # Non-https base_url is rejected.
    try:
        extract_radio(caps, t0, 3300, 3750, "http://livetiming.formula1.com", "/static/x/")
        raise AssertionError("expected ValueError for non-https base_url")
    except ValueError as e:
        assert "https" in str(e).lower(), e

    # Non-formula1.com host is rejected even over https (spoofed-origin guard).
    try:
        extract_radio(caps, t0, 3300, 3750, "https://evil.example.com", "/static/x/")
        raise AssertionError("expected ValueError for non-formula1.com host")
    except ValueError as e:
        assert "formula1.com" in str(e).lower(), e

    # A legitimate https://*.formula1.com base_url still works.
    out = extract_radio(caps, t0, 3300, 3750, "https://livetiming.formula1.com", "/static/x/")
    assert len(out) == 1, out


def test_live_radio_refs_maps_and_dedupes():
    seen = set()
    caps = [
        {"Utc": "2026-07-05T14:03:10.500Z", "RacingNumber": "1", "Path": "TeamRadio/MAXVER01_1_20260705_140310.mp3"},
        {"Utc": "2026-07-05T14:03:10.500Z", "RacingNumber": "1", "Path": "TeamRadio/MAXVER01_1_20260705_140310.mp3"},  # dupe
        {"Utc": None, "RacingNumber": "1", "Path": "x.mp3"},                       # malformed: skipped
        {"Utc": "2026-07-05T14:04:00Z", "RacingNumber": "abc", "Path": "y.mp3"},   # bad num: skipped
    ]
    out = live_radio_refs(caps, "https://livetiming.formula1.com", "/static/2026/x/y/", seen)
    assert len(out) == 1, out
    ref = out[0]
    assert ref["driverNum"] == 1 and isinstance(ref["driverNum"], int), ref
    assert ref["clip"] == (
        "https://livetiming.formula1.com/static/2026/x/y/"
        "TeamRadio/MAXVER01_1_20260705_140310.mp3"
    ), ref
    # timeMs is the Utc instant as epoch ms (the live lane's clock domain), not session-relative
    expected = round(datetime(2026, 7, 5, 14, 3, 10, 500000, tzinfo=timezone.utc).timestamp() * 1000)
    assert ref["timeMs"] == expected, ref

    # SignalR re-sends the whole capture list on resubscribe: everything is already seen
    assert live_radio_refs(caps, "https://livetiming.formula1.com", "/static/2026/x/y/", seen) == []


def test_live_radio_refs_sorts_by_time():
    out = live_radio_refs(
        [
            {"Utc": "2026-07-05T14:05:00Z", "RacingNumber": "4", "Path": "b.mp3"},
            {"Utc": "2026-07-05T14:03:00Z", "RacingNumber": "16", "Path": "a.mp3"},
        ],
        "https://livetiming.formula1.com", "/static/p/", set(),
    )
    assert [m["driverNum"] for m in out] == [16, 4], out


def test_live_radio_refs_rejects_bad_host():
    # Same spoofed-origin guard as extract_radio (S5) — shared _require_f1_host.
    try:
        live_radio_refs([], "https://evil.example", "/static/", set())
        raise AssertionError("expected ValueError for non-formula1.com host")
    except ValueError as e:
        assert "formula1.com" in str(e).lower(), e
    try:
        live_radio_refs([], "http://livetiming.formula1.com", "/static/", set())
        raise AssertionError("expected ValueError for non-https base_url")
    except ValueError as e:
        assert "https" in str(e).lower(), e


def test_live_radio_refs_survives_a_malformed_timestamp():
    """A bad Utc must not abort the batch, nor poison `seen` for the good refs.

    SignalR re-sends the whole capture list on resubscribe, so a clip marked seen
    but never emitted is lost permanently, not just this once.
    """
    seen = set()
    caps = [
        {"Utc": "2026-07-05T14:03:10Z", "RacingNumber": "1", "Path": "a.mp3"},
        {"Utc": "", "RacingNumber": "44", "Path": "b.mp3"},          # malformed
        {"Utc": 12345, "RacingNumber": "11", "Path": "c.mp3"},        # not even a string
        {"Utc": "2026-07-05T14:05:00Z", "RacingNumber": "16", "Path": "d.mp3"},
    ]
    out = live_radio_refs(caps, "https://livetiming.formula1.com", "/static/x/", seen)
    assert [m["driverNum"] for m in out] == [1, 16], out
    # The malformed entries left no trace, so a later good value for them still works.
    assert not any(u.endswith(("b.mp3", "c.mp3")) for u in seen), seen


def test_extract_radio_survives_a_malformed_timestamp():
    t0 = datetime(2024, 9, 1, 12, 0, 0, tzinfo=timezone.utc).timestamp()
    out = extract_radio(
        [
            {"Utc": "not-a-date", "RacingNumber": "1", "Path": "bad.mp3"},
            {"Utc": "2024-09-01T12:55:10.000Z", "RacingNumber": "16", "Path": "good.mp3"},
        ],
        t0, 3300, 3750, "https://livetiming.formula1.com", "/static/x/")
    assert len(out) == 1 and out[0]["driverNum"] == 16, out


if __name__ == "__main__":
    test_extract_radio_window_and_sort()
    test_extract_radio_rejects_bad_base_url()
    test_live_radio_refs_maps_and_dedupes()
    test_live_radio_refs_sorts_by_time()
    test_live_radio_refs_rejects_bad_host()
    test_live_radio_refs_survives_a_malformed_timestamp()
    test_extract_radio_survives_a_malformed_timestamp()
    print("radio self-check PASSED (extract_radio + live_radio_refs)")
    sys.exit(0)
