"""Self-check for live_signalr._dispatch_message / _decode_payload.

Pinned to a REAL connection capture (2026-08-20, Hungarian GP 2026 snapshot): every
topic payload arrives as a JSON string, so a dict-only handler silently no-ops. See
docs/superpowers/specs/2026-08-20-f1auth-spike-findings.md.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))

from live_signalr import _decode_payload, _dispatch_message, _radio_from_payload  # noqa: E402

# Verbatim from the real capture, trimmed to two entries.
REAL_TEAM_RADIO = (
    '{"Captures": [{"Utc": "2026-07-26T12:53:19.4139931Z", "RacingNumber": "87", '
    '"Path": "TeamRadio/BEA_87_20260726_145310.mp3"}, '
    '{"Utc": "2026-07-26T12:55:01.0Z", "RacingNumber": "1", '
    '"Path": "TeamRadio/VER_1_20260726_145501.mp3"}]}'
)
REAL_SESSION_INFO = '{"Key": 11342, "Type": "Race", "Path": "2026/2026-07-26_Hungarian_Grand_Prix/2026-07-26_Race/"}'


def test_decode_payload_parses_json_strings():
    assert _decode_payload(REAL_SESSION_INFO)["Path"].startswith("2026/")
    # Already-decoded data passes through untouched.
    assert _decode_payload({"Path": "x"}) == {"Path": "x"}
    # Position.z is zlib+base64, not JSON — must survive unparsed for the decoder.
    blob = "eNqrVkrLz1eyUvJNLS7OzM9TqgUAKgkFEA=="
    assert _decode_payload(blob) == blob


def test_dispatch_decodes_before_the_handler_sees_it():
    seen = []
    _dispatch_message([["TeamRadio", REAL_TEAM_RADIO], ["SessionInfo", REAL_SESSION_INFO]],
                      lambda topic, payload: seen.append((topic, payload)))
    assert len(seen) == 2, seen
    assert isinstance(seen[0][1], dict), "TeamRadio must reach the handler as data, not a string"
    assert len(seen[0][1]["Captures"]) == 2, seen[0][1]


def test_real_capture_shape_maps_to_wire_refs():
    """The end the whole feature rests on: real payload -> allowlisted clip refs."""
    payload = _decode_payload(REAL_TEAM_RADIO)
    path = "/static/" + _decode_payload(REAL_SESSION_INFO)["Path"]
    refs = _radio_from_payload(payload, path, set())
    assert len(refs) == 2, refs
    assert refs[0]["driverNum"] == 87, refs[0]
    assert refs[0]["clip"] == (
        "https://livetiming.formula1.com/static/2026/2026-07-26_Hungarian_Grand_Prix/"
        "2026-07-26_Race/TeamRadio/BEA_87_20260726_145310.mp3"
    ), refs[0]
    # 7-digit fractional seconds are real feed data and must parse (Python 3.11 truncates).
    assert refs[0]["timeMs"] == 1785070399414, refs[0]


if __name__ == "__main__":
    test_decode_payload_parses_json_strings()
    test_dispatch_decodes_before_the_handler_sees_it()
    test_real_capture_shape_maps_to_wire_refs()
    print("live_signalr dispatch self-check PASSED")
    sys.exit(0)
