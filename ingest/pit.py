"""Pure pit-window / pit-stop derivation, split out of record.py for testability.

Position-data 'Status' does NOT reliably tag pit lane in FastF1 (verified
empty — 'OnTrack' for the entire session, even during a confirmed pit
stop) — so a car's Pit/Out status is derived from lap timing
(PitInTime/PitOutTime) instead, which is authoritative.
"""
import pandas as pd


def build_pit_data(drv):
    """Derive pit-lane windows and pit_stops entries for one driver's laps.

    `drv` is a FastF1 laps DataFrame (or anything with the same columns:
    LapNumber, PitInTime, PitOutTime, LapStartTime) for a single driver.
    Returns (windows, stops) where windows is a list of (pit_in_s, pit_out_s)
    tuples used for pit-window flagging, and stops is a list of
    {"lap": int, "durationS": float} — one per REAL pit stop.

    A car that starts the race from the pit lane has a PitOutTime with no
    preceding PitInTime; we backdate a synthetic pit_in to the lap's own
    LapStartTime purely so the car is still flagged as "in the pits" up to
    PitOutTime. That backdated edge is not a real stop, so it must never
    produce a pit_stops entry (a pit-lane start is not a pit stop).
    """
    windows = []
    stops = []
    pit_in = None
    pit_in_lap = None
    pit_in_synthetic = False
    for _, lap in drv.sort_values('LapNumber').iterrows():
        if not pd.isna(lap['PitInTime']):
            pit_in = lap['PitInTime'].total_seconds()
            pit_in_lap = None if pd.isna(lap['LapNumber']) else int(lap['LapNumber'])
            pit_in_synthetic = False
        if not pd.isna(lap['PitOutTime']):
            if pit_in is None and not pd.isna(lap['LapStartTime']):
                pit_in = lap['LapStartTime'].total_seconds()
                pit_in_lap = None if pd.isna(lap['LapNumber']) else int(lap['LapNumber'])
                pit_in_synthetic = True
            if pit_in is not None:
                pit_out = lap['PitOutTime'].total_seconds()
                windows.append((pit_in, pit_out))
                if pit_in_lap is not None and not pit_in_synthetic:
                    stops.append({"lap": pit_in_lap, "durationS": round(pit_out - pit_in, 1)})
                pit_in = None
                pit_in_lap = None
                pit_in_synthetic = False
    if pit_in is not None:
        pit_out = pit_in + 30  # no recorded out-lap; assume a typical stop
        windows.append((pit_in, pit_out))
        if pit_in_lap is not None and not pit_in_synthetic:
            stops.append({"lap": pit_in_lap, "durationS": round(pit_out - pit_in, 1)})
    return windows, stops
