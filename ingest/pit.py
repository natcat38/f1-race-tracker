"""Pure pit-window / pit-stop derivation, split out of record.py for testability.

Position-data 'Status' does NOT reliably tag pit lane in FastF1 (verified
empty — 'OnTrack' for the entire session, even during a confirmed pit
stop) — so a car's Pit/Out status is derived from lap timing
(PitInTime/PitOutTime) instead, which is authoritative.

Deliberately pandas-free (see issue #114): callers (record.py) convert the
FastF1 laps DataFrame's Timedelta columns to plain floats/None before calling
build_pit_data, so this module imports cleanly in CI's fastf1-free contract
job like ghost.py/radio.py/race_control.py/resample.py.
"""


def build_pit_data(laps):
    """Derive pit-lane windows and pit_stops entries for one driver's laps.

    `laps` is an iterable of (lap_number, pit_in_s, pit_out_s, lap_start_s)
    tuples for a single driver, in any order — one per lap. lap_number is an
    int or None; the three time fields are floats (seconds) or None.

    Returns (windows, stops) where windows is a list of (pit_in_s, pit_out_s)
    tuples used for pit-window flagging, and stops is a list of
    {"lap": int, "durationS": float} — one per REAL, completed pit stop.

    A car that starts the race from the pit lane has a pit_out_s with no
    preceding pit_in_s; we backdate a synthetic pit_in to the lap's own
    lap_start_s purely so the car is still flagged as "in the pits" up to
    pit_out_s. That backdated edge is not a real stop, so it must never
    produce a pit_stops entry (a pit-lane start is not a pit stop).

    A driver who retires while stationary in the pits (pit_in_s seen but no
    pit_out_s ever follows) gets a window out to the end of the data so it
    still reads as "in the pits", but no pit_stops entry — there is no real
    duration to report, and fabricating one (e.g. a flat 30s) would misrepresent
    a retirement as a completed stop downstream (see issue #110).
    """
    windows = []
    stops = []
    pit_in = None
    pit_in_lap = None
    pit_in_synthetic = False
    for lap_number, pit_in_s, pit_out_s, lap_start_s in sorted(
        laps, key=lambda r: (r[0] is None, r[0])
    ):
        # Process PitOutTime (closing any pending window) before PitInTime
        # (opening a new one) — a same-row PitOutTime+PitInTime pair (e.g. a
        # double-stack) must close stop 1 with THIS row's pit_out before
        # stop 2's pit_in overwrites the pending state (issue #100).
        if pit_out_s is not None:
            if pit_in is None and lap_start_s is not None:
                pit_in = lap_start_s
                pit_in_lap = lap_number
                pit_in_synthetic = True
            if pit_in is not None:
                windows.append((pit_in, pit_out_s))
                if pit_in_lap is not None and not pit_in_synthetic:
                    stops.append({"lap": pit_in_lap, "durationS": round(pit_out_s - pit_in, 1)})
                pit_in = None
                pit_in_lap = None
                pit_in_synthetic = False
        if pit_in_s is not None:
            pit_in = pit_in_s
            pit_in_lap = lap_number
            pit_in_synthetic = False
    if pit_in is not None:
        # No PitOutTime ever arrived for this pending window: either the
        # session's data just ends mid-stop, or the driver retired in the
        # pits. Keep flagging the car as "in the pits" for a typical stop
        # window (windows only drive position-flagging, not the stint
        # timeline), but do not fabricate a pit_stops entry — there is no
        # real duration to report for a stop that never completed.
        # ponytail: omitting the entry (vs. carrying a null-duration/incomplete
        # flag through the contract) is the simplest fix that matches how
        # StintChart consumes pitStops today — it only ever reads real,
        # completed stops, so a missing entry just means "no stop shown" and
        # can't crash anything.
        pit_out = pit_in + 30
        windows.append((pit_in, pit_out))
    return windows, stops
