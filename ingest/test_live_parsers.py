"""Direct self-check for live_parsers.py's pure feed parsers (no fastf1/network).

Collectable by pytest (`pytest ingest`) AND runnable directly
(`python ingest/test_live_parsers.py`) for the CI contract job.

test_capture_replay.py exercises these seven functions indirectly through a
capture-file replay, but that test is skipped in CI's fastf1-free contract
job (needs fastf1) and doesn't hit every branch — this file covers each
function's branches directly instead.
"""
import base64
import json
import sys
import zlib

from live_parsers import (
    TEAM_MAP,
    _decode_position_payload,
    _map_status,
    _parse_gap_str,
    _parse_laptime_str,
    _parse_timing_line,
    _parse_tyre_line,
    _safe_int,
)


def test_parse_gap_str_numeric():
    cases = [
        ("+0.512", (512, None)),
        ("0.512", (512, None)),
        ("1.000", (1000, None)),
        ("", (None, None)),
        (None, (None, None)),
        ("not-a-number", (None, None)),
    ]
    for raw, expected in cases:
        assert _parse_gap_str(raw) == expected, raw


def test_parse_gap_str_negative_clamped_to_zero():
    # Every gapMs/intMs producer elsewhere in this codebase is non-negative
    # by convention — a leading '-' must not leak a negative value out.
    assert _parse_gap_str("-0.5") == (0, None)


def test_parse_gap_str_lapped_suffix():
    # The 'L' / 'LAP' branch — untested even indirectly per the backlog.
    assert _parse_gap_str("1L") == (None, 1)
    assert _parse_gap_str("2 LAP") == (None, 2)
    assert _parse_gap_str("3 LAPS") == (None, 3)
    assert _parse_gap_str("LAP") == (None, None)  # no digits to extract


def test_parse_gap_str_lap_with_number_format():
    # "LAP 12" (word, space, number) is a documented real payload shape
    # (issue #122 / docs/adr/0007) distinct from the "1L"/"2 LAP" suffix
    # forms already covered above.
    # UNVERIFIED against a live session: pins current behaviour
    assert _parse_gap_str("LAP 12") == (None, 12)


def test_parse_laptime_str():
    cases = [
        ("1:25.633", 85633),
        ("25.633", 25633),
        ("0:59.999", 59999),
        ("", None),
        (None, None),
        ("bogus", None),
    ]
    for raw, expected in cases:
        assert _parse_laptime_str(raw) == expected, raw


def test_parse_timing_line_full():
    drv_data = {
        "NumberOfLaps": "5",
        "GapToLeader": "+0.512",
        "IntervalToPositionAhead": {"Value": "0.512"},
        "LastLapTime": {"Value": "1:25.633"},
    }
    assert _parse_timing_line(drv_data) == {
        "lap": 5,
        "gapMs": 512,
        "intMs": 512,
        "lastLapMs": 85633,
    }


def test_parse_timing_line_lapped_gap():
    drv_data = {"GapToLeader": "1L"}
    assert _parse_timing_line(drv_data) == {"gapLaps": 1}


def test_parse_timing_line_missing_fields_returns_partial_dict():
    assert _parse_timing_line({}) == {}
    # Malformed NumberOfLaps is swallowed, not raised.
    assert _parse_timing_line({"NumberOfLaps": "not-a-number"}) == {}


def test_parse_timing_line_malformed_nested_fields_ignored():
    # A driver line where the nested fields aren't the documented shape
    # (IntervalToPositionAhead/LastLapTime as dicts, GapToLeader as a str)
    # must degrade to a partial dict rather than raising.
    # UNVERIFIED against a live session: pins current behaviour
    drv_data = {
        "GapToLeader": None,  # not a str -> ignored
        "IntervalToPositionAhead": "0.512",  # not a dict -> ignored
        "LastLapTime": ["1:25.633"],  # not a dict -> ignored
    }
    assert _parse_timing_line(drv_data) == {}


def test_parse_tyre_line_dict_stints_picks_highest_index():
    app_data = {
        "Stints": {
            "0": {"Compound": "MEDIUM", "TotalLaps": 10},
            "1": {"Compound": "soft", "TotalLaps": 3},
        }
    }
    assert _parse_tyre_line(app_data) == {"tyre": "SOFT", "tyreAge": 3}


def test_parse_tyre_line_list_stints_picks_last():
    app_data = {"Stints": [{"Compound": "HARD", "TotalLaps": 20}]}
    assert _parse_tyre_line(app_data) == {"tyre": "HARD", "tyreAge": 20}


def test_parse_tyre_line_no_stints_returns_empty():
    assert _parse_tyre_line({}) == {}
    assert _parse_tyre_line({"Stints": {}}) == {}
    assert _parse_tyre_line({"Stints": []}) == {}


def test_parse_tyre_line_current_entry_not_dict_returns_empty():
    # A malformed feed where the "current" stint entry isn't itself a dict
    # (e.g. a bare string/number slipped into Stints) must not raise.
    # UNVERIFIED against a live session: pins current behaviour
    assert _parse_tyre_line({"Stints": {"0": "MEDIUM"}}) == {}
    assert _parse_tyre_line({"Stints": [None]}) == {}


def test_map_status():
    assert _map_status("OnTrack") == "OnTrack"
    assert _map_status("Pitlane") == "Pit"
    assert _map_status("Pit") == "Pit"
    assert _map_status("PitLane") == "Pit"
    # The fallback branch — untested even indirectly per the backlog.
    assert _map_status("Out") == "Out"
    assert _map_status("Retired") == "Out"
    assert _map_status("anything-else") == "Out"


def test_safe_int():
    assert _safe_int("42") == 42
    assert _safe_int("not-a-number") == 0
    assert _safe_int(None) == 0


def test_decode_position_payload_dict_shapes():
    assert _decode_position_payload({"Position": [{"Timestamp": "t"}]}) == [{"Timestamp": "t"}]
    assert _decode_position_payload({"NoPositionKey": True}) == []


def test_decode_position_payload_zlib_b64_string():
    body = {"Position": [{"Timestamp": "2024-09-01T13:01:00.123Z"}]}
    compressor = zlib.compressobj(6, zlib.DEFLATED, -15)  # raw deflate, no header
    compressed = compressor.compress(json.dumps(body).encode()) + compressor.flush()
    payload = base64.b64encode(compressed).decode()
    assert _decode_position_payload(payload) == body["Position"]


def test_decode_position_payload_plain_json_string():
    body = {"Position": [{"Timestamp": "t"}]}
    assert _decode_position_payload(json.dumps(body)) == body["Position"]


def test_decode_position_payload_unparseable_returns_empty_list():
    assert _decode_position_payload("not json and not base64 either!!") == []


def test_decode_position_payload_zip_bomb_capped_not_exhausted():
    # #117: a highly compressible payload that would decompress to well beyond
    # live_parsers._MAX_DECOMPRESSED_BYTES must be refused, not decompressed in full.
    import live_parsers

    huge = b"0" * (live_parsers._MAX_DECOMPRESSED_BYTES * 4)
    compressor = zlib.compressobj(9, zlib.DEFLATED, -15)  # raw deflate, no header
    compressed = compressor.compress(huge) + compressor.flush()
    payload = base64.b64encode(compressed).decode()
    # The oversized decompression is caught and treated like any other unparseable
    # payload (empty list), never a multi-hundred-MB buffer in memory.
    assert _decode_position_payload(payload) == []


def test_team_map_matches_frontend_colour_keys():
    # Spot-check a couple of entries rather than the whole dict — the exhaustive
    # mapping is a data table, not logic worth asserting entry-by-entry here.
    assert TEAM_MAP["Red Bull Racing"] == "Red Bull"
    assert TEAM_MAP["Haas F1 Team"] == "Haas"


if __name__ == "__main__":
    test_parse_gap_str_numeric()
    test_parse_gap_str_negative_clamped_to_zero()
    test_parse_gap_str_lapped_suffix()
    test_parse_gap_str_lap_with_number_format()
    test_parse_laptime_str()
    test_parse_timing_line_full()
    test_parse_timing_line_lapped_gap()
    test_parse_timing_line_missing_fields_returns_partial_dict()
    test_parse_timing_line_malformed_nested_fields_ignored()
    test_parse_tyre_line_dict_stints_picks_highest_index()
    test_parse_tyre_line_list_stints_picks_last()
    test_parse_tyre_line_no_stints_returns_empty()
    test_parse_tyre_line_current_entry_not_dict_returns_empty()
    test_map_status()
    test_safe_int()
    test_decode_position_payload_dict_shapes()
    test_decode_position_payload_zlib_b64_string()
    test_decode_position_payload_plain_json_string()
    test_decode_position_payload_unparseable_returns_empty_list()
    test_decode_position_payload_zip_bomb_capped_not_exhausted()
    test_team_map_matches_frontend_colour_keys()
    print("live_parsers self-check PASSED")
    sys.exit(0)
