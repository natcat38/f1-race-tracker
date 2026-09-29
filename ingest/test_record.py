"""Tests for record.py's orchestration seam: assemble_header/assemble_frame plus
the contiguous-position invariant they rely on (resample.reconcile_positions).

record.py is a top-level script (loads a real FastF1 session, hits the network/
cache, argparse's sys.argv) with no importable entry point of its own — see its
`if __name__ == "__main__": main()` guard. assemble_header/assemble_frame are
the two pieces pulled out of main()'s emit loop specifically so this file can
exercise the recorder's own wiring (pit/ghost/heatmap/corner data landing in the
right header/frame fields, contiguous positions) without a real session, network,
or fastf1/pandas. Both are pure dict construction; no behaviour changed.

No fastf1/pandas/network needed for any test below — importing record.py itself
only needs the packages it imports at module scope (fastf1, numpy, pandas), so
this file (like ingest/test_pit.py) skips cleanly in the CI contract job, which
installs only `redis`.
"""
import pytest

pd = pytest.importorskip("pandas", reason="record.py imports pandas/fastf1 at module scope; not installed in the fastf1-free contract job")

import record  # noqa: E402
from ghost import build_lap_trace, build_pedal_trace, compute_sector_dominance  # noqa: E402
from pit import build_pit_data  # noqa: E402
from resample import reconcile_positions  # noqa: E402


def _laps(rows):
    """Same laps-DataFrame builder as ingest/test_pit.py."""
    def td(v):
        return pd.NaT if v is None else pd.Timedelta(seconds=v)

    return pd.DataFrame([{
        "LapNumber": r["LapNumber"],
        "PitInTime": td(r.get("PitInTime")),
        "PitOutTime": td(r.get("PitOutTime")),
        "LapStartTime": td(r.get("LapStartTime")),
    } for r in rows])


def _pit_laps(drv):
    """(lap_number, pit_in_s, pit_out_s, lap_start_s) tuples from a laps
    DataFrame, exactly as record.py's main() converts before calling
    pit.build_pit_data (build_pit_data takes plain tuples, not a DataFrame —
    see PR #128)."""
    return [
        (
            None if pd.isna(lap['LapNumber']) else int(lap['LapNumber']),
            None if pd.isna(lap['PitInTime']) else lap['PitInTime'].total_seconds(),
            None if pd.isna(lap['PitOutTime']) else lap['PitOutTime'].total_seconds(),
            None if pd.isna(lap['LapStartTime']) else lap['LapStartTime'].total_seconds(),
        )
        for _, lap in drv.iterrows()
    ]


def test_assemble_header_wires_pit_ghost_heatmap_and_corners_into_the_header():
    # Two drivers' worth of tiny synthetic data run through the REAL helpers
    # (pit.build_pit_data, ghost.build_lap_trace/build_pedal_trace/
    # compute_sector_dominance) exactly as main() does, then wired together by
    # assemble_header — proving the recorder's own wiring, not just that each
    # helper works in isolation (already covered by test_pit.py/test_ghost.py).
    track = [(0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0)]

    drv1 = _laps([
        {"LapNumber": 1, "LapStartTime": 0.0},
        {"LapNumber": 2, "LapStartTime": 90.0, "PitInTime": 95.0},
        {"LapNumber": 3, "LapStartTime": 120.0, "PitOutTime": 117.0},
    ])
    windows1, stops1 = build_pit_data(_pit_laps(drv1))
    assert stops1 == [{"lap": 2, "durationS": 22.0}]  # sanity: a real stop was baked

    ts1 = [10.0, 11.0, 12.0, 13.0]
    xy1 = [(0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0)]
    lap_trace_1 = build_lap_trace(ts1, xy1, track)
    pedal_trace_1 = build_pedal_trace(ts1, xy1, track, [10, 100, 100, 0], [0, 0, 0, 100], [1, 5, 6, 2])

    ts2 = [10.0, 10.5, 11.0, 11.5]
    xy2 = [(0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0)]
    lap_trace_2 = build_lap_trace(ts2, xy2, track)  # faster than driver 1 everywhere

    lap_traces = {1: lap_trace_1, 2: lap_trace_2}
    sector_dominance = compute_sector_dominance(lap_traces, n_points=len(track), bin_size=2)
    # driver 2's faster trace dominates both bins, plus the closing wraparound
    # bin that reuses the last bin's leader (#112).
    assert sector_dominance == [2, 2, 2]

    corners = [{"number": 1, "x": 0.5, "y": 0.0, "letter": ""}]

    header = record.assemble_header(
        track_points=[{"x": x, "y": y} for x, y in track],
        corners=corners,
        label="Test GP 2024 · Race",
        max_rev=4,
        radio_clips=[{"timeMs": 1000, "driverNum": 1, "clip": "https://example.com/1.mp3"}],
        lap_trace=lap_traces,
        total_laps=3,
        stints={1: [{"compound": "SOFT", "startLap": 1, "endLap": 3}]},
        pit_stops={1: stops1},
        pedal_traces={1: pedal_trace_1},
        sector_dominance=sector_dominance,
    )

    # Every helper's output landed in the field the contract (record.py's module
    # docstring) says it belongs in — this is the wiring the issue is about.
    assert header["pitStops"] == {1: [{"lap": 2, "durationS": 22.0}]}
    assert header["sectorDominance"] == [2, 2, 2]
    assert header["pedalTraces"] == {1: pedal_trace_1}
    assert header["corners"] == corners
    assert header["lapTrace"] == lap_traces
    assert header["track"] == [{"x": x, "y": y} for x, y in track]
    assert header["maxRev"] == 4
    assert header["totalLaps"] == 3


def test_assemble_header_with_no_optional_data_does_not_crash():
    # A session with no pit stops, no lap-trace data (so no sector dominance),
    # and no corners: the header must still come out as a valid contract
    # document rather than raising — the "missing optional data" case.
    header = record.assemble_header(
        track_points=[{"x": 0.0, "y": 0.0}, {"x": 1.0, "y": 1.0}],
        corners=[],
        label="Empty Session",
        max_rev=0,
        radio_clips=[],
        lap_trace={},
        total_laps=0,
        stints={},
        pit_stops={},
        pedal_traces={},
        sector_dominance=compute_sector_dominance({}, n_points=2, bin_size=2),
    )
    assert header["corners"] == []
    assert header["pitStops"] == {}
    assert header["pedalTraces"] == {}
    # no lap-trace data -> all-zero bins (plus the closing wraparound bin), not crashing
    assert header["sectorDominance"] == [0, 0]
    assert header["stints"] == {}
    assert header["radio"] == []


def test_assemble_frame_attaches_messages_and_weather_only_when_present():
    bare = record.assemble_frame(rev=1, time_ms=100, cars=[])
    assert "messages" not in bare
    assert "weather" not in bare

    full = record.assemble_frame(
        rev=2, time_ms=200, cars=[],
        messages=[{"rev": 2, "t": 200, "category": "Flag", "message": "GREEN"}],
        weather={"airTempC": 24.0, "trackTempC": 32.0, "rainfall": False},
    )
    assert full["messages"] == [{"rev": 2, "t": 200, "category": "Flag", "message": "GREEN"}]
    assert full["weather"] == {"airTempC": 24.0, "trackTempC": 32.0, "rainfall": False}

    # An empty messages list is falsy: mirrors main()'s `msgs_by_idx.get(i)` --
    # a frame with no race-control entry for its tick must not carry the key.
    empty_msgs = record.assemble_frame(rev=3, time_ms=300, cars=[], messages=[])
    assert "messages" not in empty_msgs


def test_contiguous_position_invariant_survives_reconciliation_into_a_frame():
    # Mirrors the #66/F8 invariant: raw per-driver position lookups can collide,
    # gap, or carry UNKNOWN_POS — reconcile_positions (called by main() before
    # assemble_frame, same as here) must always renumber to a unique, contiguous
    # 1..N order regardless of how tangled the raw input is.
    from resample import UNKNOWN_POS

    cars = [
        {"driverNum": 1, "pos": 1, "lap": 5, "status": "OnTrack"},
        {"driverNum": 2, "pos": 1, "lap": 4, "status": "OnTrack"},  # duplicate raw pos
        {"driverNum": 3, "pos": UNKNOWN_POS, "lap": 3, "status": "OnTrack"},
        {"driverNum": 4, "pos": 7, "lap": 1, "status": "Out"},  # retired, sinks to the tail
    ]
    reconcile_positions(cars)
    frame = record.assemble_frame(rev=1, time_ms=100, cars=cars)

    positions = sorted(c["pos"] for c in frame["cars"])
    assert positions == list(range(1, len(cars) + 1)), positions
    # Retired car sinks to the tail regardless of its raw 'pos'.
    assert frame["cars"][-1]["driverNum"] == 4
    assert frame["cars"][-1]["status"] == "Out"


def test_reconciled_frame_via_assemble_frame_round_trips_json_cleanly():
    # A lighter end-to-end sanity check: the dict assemble_frame hands back is
    # exactly what main() writes as one JSONL frame line — must serialise and
    # carry the REQUIRED_FRAME_FIELDS the recorder's own contract validation
    # (bottom of record.py) checks for.
    import json

    cars = [
        {"driverNum": 44, "code": "HAM", "team": "Mercedes", "pos": 2, "p": {"x": 0.1, "y": 0.2}, "status": "OnTrack"},
        {"driverNum": 1, "code": "VER", "team": "Red Bull", "pos": 1, "p": {"x": 0.5, "y": 0.5}, "status": "OnTrack"},
    ]
    reconcile_positions(cars)
    frame = record.assemble_frame(rev=5, time_ms=500, cars=cars)
    line = json.dumps({"timeMs": 500, "frame": frame}, separators=(",", ":"))
    parsed = json.loads(line)

    assert {"rev", "timeMs", "cars"} <= set(parsed["frame"].keys())
    assert sorted(c["pos"] for c in parsed["frame"]["cars"]) == [1, 2]
