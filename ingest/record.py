"""
FastF1 → JSONL clip recorder.

Bakes a real F1 session into the contract read by the Go replay player.

CONTRACT (must match internal/model/model.go + web/src/state/race.ts):
  Header line: {"track":[{"x":float,"y":float},...], "label":"...", "maxRev":int,
                "radio":[{"timeMs":int,"driverNum":int,"clip":"https://..."}],
                "lapTrace":{"<num>":[ms,...]},
                "stints":{"<num>":[{"compound":"SOFT","startLap":int,"endLap":int}]},
                "pitStops":{"<num>":[{"lap":int,"durationS":float}]},
                "pedalTraces":{"<num>":{"throttle":[int,...],"brake":[int,...],"gear":[int,...]}}}
  Frame lines: {"timeMs":int, "frame":{"rev":int,"timeMs":int,"cars":[
                 {"driverNum":int,"code":"VER","team":"Red Bull","pos":int,
                  "p":{"x":float,"y":float},"status":"OnTrack"}],
                 "weather":{"airTempC":float,"trackTempC":float,"rainfall":bool}}}

Usage:
  .venv/Scripts/python.exe ingest/record.py [out] [--year YEAR] [--gp GP] [--session S] [--label LABEL] [--start-lap N --end-lap M]

Default output: data/replays/monza-2024-race.jsonl

Note: WINDOW_START_S/WINDOW_END_S define a mid-race window that works well for most
circuits but may need tuning per circuit (e.g. if the window falls under a safety car
or a long pit phase for a particular GP). Pass --start-lap/--end-lap to target a
specific lap range instead (e.g. a green-flag pit-stop phase) — the window is derived
from the leader's LapStartTime for those laps.

Frame lines optionally carry "messages":[{"rev":int,"t":int,"category":"...",
"message":"...","driver":int}] — race-control entries (flags, safety car,
investigations) whose tick falls in this frame.
"""

import fastf1
import numpy as np
import pandas as pd
import json
import sys
import os
import argparse
from pathlib import Path
from fastf1 import _api
from radio import extract_radio
from race_control import extract_race_control
from ghost import build_lap_trace, build_pedal_trace
from resample import nearest_index, step_value, in_window_ms, reconcile_positions, UNKNOWN_POS, normalise_point
from live_parsers import TEAM_MAP
from geometry import (
    resample_closed_loop, project_to_arc, wrap_counts, invert_distance_curve, lap_deficit,
)

# ---------------------------------------------------------------------------
# Args
# ---------------------------------------------------------------------------

_ap = argparse.ArgumentParser(description="Bake a FastF1 session into a JSONL clip.")
_ap.add_argument("out", nargs="?", default="data/replays/monza-2024-race.jsonl")
_ap.add_argument("--year", type=int, default=2024)
_ap.add_argument("--gp", default="Monza")
_ap.add_argument("--session", default="R")
_ap.add_argument("--label", default=None, help="defaults to '<gp> <year> · Race'")
_ap.add_argument("--start-lap", type=int, default=None, help="bake the window starting at this lap (leader's LapStartTime)")
_ap.add_argument("--end-lap", type=int, default=None, help="bake the window ending after this lap completes")
_args = _ap.parse_args()

OUTPUT_PATH = _args.out
GP_LABEL = _args.label or f"{_args.gp} {_args.year} · Race"

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

HZ = 10          # target sample rate (frames per second)
TRACK_POINTS = 150  # number of track outline points

# Window: 7.5-min green-flag mid-race window (widened from 2.5 min in Phase 3 so the
# comms layer has enough team radio to feel alive — see ADR-0003 / Phase 3 spec).
WINDOW_START_S = 3300   # 55 min into session
WINDOW_END_S   = 3750   # 62.5 min  (7.5-min window)

# ---------------------------------------------------------------------------
# Load session
# ---------------------------------------------------------------------------

print("Enabling cache...")
cache_dir = Path(__file__).parent.parent / "cache"
cache_dir.mkdir(exist_ok=True)
fastf1.Cache.enable_cache(str(cache_dir))

print(f"Loading {_args.gp} {_args.year} session '{_args.session}' (cached if already downloaded)...")
session = fastf1.get_session(_args.year, _args.gp, _args.session)
session.load(telemetry=True, laps=True, weather=True)
print(f"Loaded. Drivers: {session.drivers}")

# Lap-window override: derive WINDOW_START_S/WINDOW_END_S from the leader's lap
# start times instead of the fixed mid-race window, so a caller can target a
# specific green-flag pit-stop phase (see --start-lap/--end-lap above).
if _args.start_lap is not None and _args.end_lap is not None:
    lap_starts = session.laps.groupby('LapNumber')['LapStartTime'].min()
    WINDOW_START_S = int(lap_starts.loc[_args.start_lap].total_seconds())
    _next_lap = _args.end_lap + 1
    WINDOW_END_S = (int(lap_starts.loc[_next_lap].total_seconds())
                     if _next_lap in lap_starts.index else WINDOW_START_S + 450)
    print(f"Window from laps {_args.start_lap}-{_args.end_lap}: {WINDOW_START_S}s -> {WINDOW_END_S}s")
    if WINDOW_END_S - WINDOW_START_S > 600:
        print(f"  WARNING: window is {(WINDOW_END_S - WINDOW_START_S) / 60:.1f} min — consider a narrower lap range.")

# ---------------------------------------------------------------------------
# Build driver info map: driver_number -> {code, team}
# ---------------------------------------------------------------------------

driver_info = {}
for num in session.drivers:
    try:
        d = session.get_driver(num)
        raw_team = d['TeamName']
        mapped_team = TEAM_MAP.get(raw_team, raw_team)
        driver_info[int(num)] = {
            'code': d['Abbreviation'],
            'team': mapped_team,
        }
    except Exception as e:
        print(f"  Warning: couldn't get driver info for {num}: {type(e).__name__}: {e}")

print(f"Driver info ({len(driver_info)} drivers):")
for num, info in sorted(driver_info.items()):
    print(f"  {num:>3} | {info['code']} | {info['team']}")

# ---------------------------------------------------------------------------
# Team radio (Phase 3): baked into the header as [{timeMs, driverNum, clip}].
# Streamed from F1's public URL at play time, never stored (ADR-0003).
# ---------------------------------------------------------------------------
# t0_date is tz-naive-UTC today; tz_convert if FastF1 ever returns it tz-aware.
# FastF1 can leave t0_date unset (None -> NaT) on sessions with no telemetry/position
# data even when session.load() otherwise "succeeds" — degrade to no radio/race-control
# rather than crashing the whole bake (extract_radio/extract_race_control will each
# raise on a None t0_epoch_s, which their own callers already catch and warn on).
try:
    _t0 = pd.Timestamp(session.t0_date)
    t0_epoch_s = (_t0.tz_convert("UTC") if _t0.tzinfo else _t0.tz_localize("UTC")).timestamp()
except (ValueError, TypeError) as e:
    print(f"  Warning: session t0_date unavailable ({type(e).__name__}: {e}); team radio and race control will be empty")
    t0_epoch_s = None

print("\nFetching team radio...")
radio_clips = []
try:
    raw = _api.fetch_page(session.api_path, "team_radio")  # list of [ts, content]
    captures = []
    for _ts, content in raw:
        caps = content.get("Captures") if isinstance(content, dict) else None
        if caps:
            captures.extend(caps.values() if isinstance(caps, dict) else caps)
    radio_clips = extract_radio(
        captures, t0_epoch_s, WINDOW_START_S, WINDOW_END_S,
        _api.base_url, session.api_path,
    )
    print(f"Team radio: {len(captures)} captures in session, {len(radio_clips)} in window")
except Exception as e:
    print(f"  Warning: team radio fetch failed ({type(e).__name__}: {e}); clip will have no radio")

# ---------------------------------------------------------------------------
# Race control messages: baked into the frame whose tick covers each message,
# so flags/SC/investigations replay in sync (internal/model/apply.go keeps the
# rolling buffer on the snapshot; nothing else to do downstream).
# ---------------------------------------------------------------------------
print("\nFetching race control messages...")
rc_msgs = []
try:
    rc_df = session.race_control_messages  # columns: Time, Category, Message, RacingNumber, ...
    rc_rows = [
        {'epoch_s': row['Time'].timestamp(), 'category': row.get('Category'),
         'message': row.get('Message'), 'racingNumber': row.get('RacingNumber')}
        for _, row in rc_df.iterrows() if not pd.isna(row['Time'])
    ]
    rc_msgs = extract_race_control(rc_rows, t0_epoch_s, WINDOW_START_S, WINDOW_END_S,
                                   set(driver_info.keys()))
    print(f"Race control: {len(rc_rows)} messages in session, {len(rc_msgs)} in window")
except Exception as e:
    print(f"  Warning: race control fetch failed ({type(e).__name__}: {e}); clip will have no messages")

# ---------------------------------------------------------------------------
# Collect all position data and determine coordinate bounds
# (use FULL session data for normalisation bounds so the whole circuit fits)
# ---------------------------------------------------------------------------

print("\nCollecting position data for normalisation bounds...")
all_x, all_y = [], []

# Find leader (driver with most laps or race winner)
leader_laps = None
leader_num = None
max_laps = 0
for num in session.drivers:
    inum = int(num)
    if inum not in driver_info:
        continue
    laps = session.laps.pick_drivers(num)
    if len(laps) > max_laps:
        max_laps = len(laps)
        leader_num = inum
        leader_laps = laps

print(f"Leader: driver #{leader_num} ({driver_info[leader_num]['code']}) with {max_laps} laps")

# Get leader's full position data for normalisation + track outline
leader_pos = session.pos_data[str(leader_num)].copy()

# Use OnTrack status only for normalisation (exclude pit lane)
on_track = leader_pos[leader_pos['Status'] == 'OnTrack']
if len(on_track) == 0:
    on_track = leader_pos  # fallback: use all

x_min = on_track['X'].min()
x_max = on_track['X'].max()
y_min = on_track['Y'].min()
y_max = on_track['Y'].max()

print(f"Coordinate bounds (leader, OnTrack): X=[{x_min:.0f}, {x_max:.0f}], Y=[{y_min:.0f}, {y_max:.0f}]")

x_range = x_max - x_min
y_range = y_max - y_min
# Use the larger range for both axes to preserve aspect ratio
max_range = max(x_range, y_range)
# Centre within the unit box
x_offset = (max_range - x_range) / 2
y_offset = (max_range - y_range) / 2

def normalise(x, y):
    """Normalise X/Y coords to [0,1] unit box, preserving aspect ratio.
    Flip Y because SVG y-axis grows downward but F1 telemetry Y grows upward."""
    return normalise_point(x, y, x_min, y_min, max_range, x_offset, y_offset)

# ---------------------------------------------------------------------------
# Build track outline from one clean lap of the leader
# ---------------------------------------------------------------------------

print("\nBuilding track outline...")

# Pick a single clean lap from the leader (not a lap with pit stop)
clean_laps = leader_laps.pick_accurate()
if len(clean_laps) == 0:
    clean_laps = leader_laps

# Take a mid-race lap (avoid first lap chaos)
mid_idx = len(clean_laps) // 2
sample_lap = clean_laps.iloc[mid_idx]

lap_start_t = sample_lap['LapStartTime']
lap_end_t   = lap_start_t + sample_lap['LapTime']

# Get leader position during this lap
lap_pos = on_track[
    (on_track['SessionTime'] >= lap_start_t) &
    (on_track['SessionTime'] <  lap_end_t)
].copy()

print(f"Track lap: SessionTime {lap_start_t} -> {lap_end_t}, {len(lap_pos)} raw points")

# Keep the full-rate reference lap in RAW METRES before the outline downsample —
# the gap estimator's centreline is built from it (see the centreline section).
centreline_ref_xy = list(zip(lap_pos['X'].astype(float), lap_pos['Y'].astype(float), strict=True))

# Downsample to ~TRACK_POINTS evenly spaced points
if len(lap_pos) > TRACK_POINTS:
    indices = np.linspace(0, len(lap_pos) - 1, TRACK_POINTS, dtype=int)
    lap_pos = lap_pos.iloc[indices]

track_points = [
    {"x": normalise(row['X'], row['Y'])[0], "y": normalise(row['X'], row['Y'])[1]}
    for _, row in lap_pos.iterrows()
]

print(f"Track outline: {len(track_points)} points")

# ---------------------------------------------------------------------------
# Lap traces (Phase 4): per-driver pace curve over the fastest accurate lap.
# Cumulative ms at each track-outline index, for the cross-year ghost overlay.
# ---------------------------------------------------------------------------
_outline_xy = [(p['x'], p['y']) for p in track_points]
lap_traces = {}
# pedal_traces: driver_num -> {"throttle":[...],"brake":[...],"gear":[...]}, indexed
# by the same track-outline position as lap_traces (see PedalTrace in model.go).
# ponytail: RPM omitted (reviews/plans/verify/01-telemetry-overlay.md) — FastF1's
# car_data isn't sampled for it anywhere else in this file either.
pedal_traces = {}
for num in session.drivers:
    inum = int(num)
    if inum not in driver_info:
        continue
    try:
        accurate = session.laps.pick_drivers(num).pick_accurate()
        if len(accurate) == 0:
            continue
        fastest = accurate.pick_fastest()
        if fastest is None or pd.isna(fastest['LapTime']):
            continue
        lap_start = fastest['LapStartTime']
        lap_end = lap_start + fastest['LapTime']
        pos = session.pos_data[num]
        driver_lap_pos = pos[(pos['SessionTime'] >= lap_start) & (pos['SessionTime'] < lap_end)]
        if len(driver_lap_pos) < 2:
            continue
        sample_ts = driver_lap_pos['SessionTime'].dt.total_seconds().tolist()
        sample_xy = [normalise(row['X'], row['Y']) for _, row in driver_lap_pos.iterrows()]
        lap_traces[inum] = build_lap_trace(sample_ts, sample_xy, _outline_xy)
        try:
            cd = session.car_data[num]
            cd_lap = cd[(cd['SessionTime'] >= lap_start) & (cd['SessionTime'] < lap_end)]
            if len(cd_lap) >= 2:
                cd_t = cd_lap['SessionTime'].dt.total_seconds().values
                idx = np.array([nearest_index(cd_t, q) for q in sample_ts])
                throttle_vals = cd_lap['Throttle'].values[idx].astype(int)
                brake_vals = (cd_lap['Brake'].values[idx].astype(float) > 0).astype(int) * 100
                gear_vals = cd_lap['nGear'].values[idx].astype(int)
                pedal_traces[inum] = build_pedal_trace(
                    sample_ts, sample_xy, _outline_xy, throttle_vals, brake_vals, gear_vals
                )
        except Exception as e:
            print(f"  Warning: no pedal trace for {num}: {type(e).__name__}: {e}")
    except Exception as e:
        print(f"  Warning: no lap trace for {num}: {type(e).__name__}: {e}")

print(f"Lap traces baked for {len(lap_traces)} drivers")
print(f"Pedal traces baked for {len(pedal_traces)} drivers")

# ---------------------------------------------------------------------------
# Derive running order from laps data
# Build a per-driver position lookup: (DriverNumber -> position) at session time T
# We use the Position column from session.laps which gives lap-level position.
# ---------------------------------------------------------------------------

print("\nBuilding running order lookup...")

# For each driver, get (LapStartTime, Position) pairs so we can do a step lookup.
order_lookup = {}  # driver_num -> (times, positions), parallel lists ascending by time
for num in session.drivers:
    inum = int(num)
    drv_laps = session.laps.pick_drivers(num)[['LapStartTime', 'Position']].dropna()
    if len(drv_laps) == 0:
        continue
    order_lookup[inum] = (
        [t.total_seconds() for t in drv_laps['LapStartTime']],
        [int(p) for p in drv_laps['Position']],
    )

def get_position(driver_num, session_time_s):
    """Return driver's RAW running position at a given session time (step
    lookup into this driver's own timeline only).

    This is deliberately not reconciled against other drivers — two drivers'
    lookups can disagree at the same instant (one's most recent update stale
    relative to another's), which is exactly why every frame's cars list is
    passed through reconcile_positions() before it's written (see #66).
    """
    times, positions = order_lookup.get(driver_num, ([], []))
    if not positions:
        return UNKNOWN_POS
    return step_value(times, positions, session_time_s, positions[0])

# ---------------------------------------------------------------------------
# Per-driver timing lookup: at session time T, the "current" pit-wall numbers.
# Lap/sector times become current at lap COMPLETION (LapStartTime + LapTime);
# tyre compound/age are current from the lap's start. Best lap is the running
# min of completed lap times. Step-lookup mirrors get_position().
# ---------------------------------------------------------------------------

def _ms(td):
    """pandas Timedelta -> int milliseconds, or 0 if NaT."""
    if pd.isna(td):
        return 0
    return int(round(td.total_seconds() * 1000))

print("\nBuilding timing lookup (laps / sectors / tyre)...")

# driver_num -> list of (becomes_current_time_s, fields_dict), sorted by time.
timing_lookup = {}
# driver_num -> (start_times, (tyre, tyreAge) tuples) for a step_value lookup.
# Tyre becomes current at lap START, which — unlike lap completion below — is
# always strictly ascending across a driver's laps, so bisection is safe here.
tyre_lookup = {}
for num in session.drivers:
    inum = int(num)
    if inum not in driver_info:
        continue
    drv = session.laps.pick_drivers(num)
    if len(drv) == 0:
        continue
    events = []
    tyre_starts, tyre_values = [], []
    best_ms = 0
    for _, lap in drv.iterrows():
        start_s = lap['LapStartTime'].total_seconds() if not pd.isna(lap['LapStartTime']) else None
        if start_s is None:
            continue
        last_ms = _ms(lap['LapTime'])
        if last_ms > 0:
            best_ms = last_ms if best_ms == 0 else min(best_ms, last_ms)
        compound = lap['Compound'] if not pd.isna(lap['Compound']) else ''
        tyre_age = int(lap['TyreLife']) if not pd.isna(lap['TyreLife']) else 0
        tyre_starts.append(start_s)
        tyre_values.append((str(compound).upper() if compound else '', tyre_age))
        events.append((start_s, {
            'complete_at': start_s + (last_ms / 1000.0) if last_ms > 0 else start_s,
            'lastLapMs': last_ms,
            'bestLapMs': best_ms,
            's1Ms': _ms(lap['Sector1Time']),
            's2Ms': _ms(lap['Sector2Time']),
            's3Ms': _ms(lap['Sector3Time']),
        }))
    events.sort(key=lambda e: e[0])
    timing_lookup[inum] = events
    tyre_lookup[inum] = (tyre_starts, tyre_values)


def get_timing(driver_num, t_s):
    """Pit-wall numbers for a driver at session time t_s (step lookup)."""
    starts, values = tyre_lookup.get(driver_num, ([], []))
    tyre, tyre_age = step_value(starts, values, t_s, ('', 0))

    # Lap/sector times become current at lap COMPLETION (start + duration), which
    # isn't rigorously guaranteed non-decreasing the way lap start is (missing or
    # anomalous LapTime data can distort it) — kept as a linear scan rather than
    # step_value's bisection, which assumes strictly sorted input.
    events = timing_lookup.get(driver_num, [])
    last_ms = best_ms = s1 = s2 = s3 = 0
    for start_s, f in events:
        if f['complete_at'] <= t_s:
            last_ms, best_ms = f['lastLapMs'], f['bestLapMs']
            s1, s2, s3 = f['s1Ms'], f['s2Ms'], f['s3Ms']
        elif start_s > t_s:
            break
    return {'tyre': tyre, 'tyreAge': tyre_age, 'lastLapMs': last_ms,
            'bestLapMs': best_ms, 's1Ms': s1, 's2Ms': s2, 's3Ms': s3}

# Per-driver derivations, all from the same laps slice: the lap-number step
# lookup (from 'LapNumber'), the whole-race tyre-stint plan (Phase 3, baked
# once — not windowed like the frame stream, so the strategy chart can show
# the full plan), and pit-lane windows. Position-data 'Status' does NOT
# reliably tag pit lane in FastF1 (verified empty — 'OnTrack' for the entire
# session, even during a confirmed pit stop) — so a car's Pit/Out status is
# derived from lap timing (PitInTime/PitOutTime) instead, which is authoritative.
lapnum_lookup = {}  # driver_num -> (times, lap_numbers), parallel lists ascending by time
stints = {}
pit_windows = {}  # driver_num -> [(pit_in_s, pit_out_s), ...]
pit_stops = {}  # driver_num -> [{"lap": int, "durationS": float}, ...] — duration only;
# ponytail: positions-gained/lost and stationary time are out of scope for this
# slice (reviews/plans/verify/02-pit-stops.md) — would need a running-order-at-time
# derivation and per-driver car_data telemetry respectively, neither of which exist yet.
for num in session.drivers:
    inum = int(num)
    if inum not in driver_info:
        continue
    drv = session.laps.pick_drivers(num)

    lap_times = drv[['LapStartTime', 'LapNumber']].dropna()
    lapnum_lookup[inum] = (
        [t.total_seconds() for t in lap_times['LapStartTime']],
        [int(n) for n in lap_times['LapNumber']],
    )

    out = []
    for _, grp in drv.groupby('Stint'):
        grp = grp.dropna(subset=['LapNumber'])
        if grp.empty or pd.isna(grp['Compound'].iloc[0]):
            continue
        out.append({
            "compound": str(grp['Compound'].iloc[0]),
            "startLap": int(grp['LapNumber'].min()),
            "endLap": int(grp['LapNumber'].max()),
        })
    if out:
        stints[inum] = out

    windows = []
    stops = []
    pit_in = None
    pit_in_lap = None
    for _, lap in drv.sort_values('LapNumber').iterrows():
        if not pd.isna(lap['PitInTime']):
            pit_in = lap['PitInTime'].total_seconds()
            pit_in_lap = None if pd.isna(lap['LapNumber']) else int(lap['LapNumber'])
        if not pd.isna(lap['PitOutTime']):
            if pit_in is None and not pd.isna(lap['LapStartTime']):
                # No PitInTime seen before this PitOutTime — e.g. the car
                # started the race from the pit lane. Treat the lap's own
                # start as the pit-in edge so the car is still correctly
                # flagged as in the pits up to PitOutTime.
                pit_in = lap['LapStartTime'].total_seconds()
                pit_in_lap = None if pd.isna(lap['LapNumber']) else int(lap['LapNumber'])
            if pit_in is not None:
                pit_out = lap['PitOutTime'].total_seconds()
                windows.append((pit_in, pit_out))
                if pit_in_lap is not None:
                    stops.append({"lap": pit_in_lap, "durationS": round(pit_out - pit_in, 1)})
                pit_in = None
                pit_in_lap = None
    if pit_in is not None:
        pit_out = pit_in + 30  # no recorded out-lap; assume a typical stop
        windows.append((pit_in, pit_out))
        if pit_in_lap is not None:
            stops.append({"lap": pit_in_lap, "durationS": round(pit_out - pit_in, 1)})
    pit_windows[inum] = windows
    if stops:
        pit_stops[inum] = stops
print(f"Stints baked for {len(stints)} drivers")

def _lap_number(driver_num, t_s):
    times, lapnums = lapnum_lookup.get(driver_num, ([], []))
    if not lapnums:
        return 1
    return step_value(times, lapnums, t_s, lapnums[0])

def _in_pit(driver_num, t_s):
    for in_s, out_s in pit_windows.get(driver_num, []):
        if in_s <= t_s <= out_s:
            return True
    return False

# ---------------------------------------------------------------------------
# Weather (Phase 3): low-rate session.weather_data step lookup (air/track temp,
# rainfall). Attached to a frame only when it differs from the last emission.
# ---------------------------------------------------------------------------

_wx = session.weather_data
_wx_times = [t.total_seconds() for t in _wx['Time']] if _wx is not None and not _wx.empty else []
_wx_air = list(_wx['AirTemp']) if _wx_times else []
_wx_track = list(_wx['TrackTemp']) if _wx_times else []
_wx_rain = list(_wx['Rainfall']) if _wx_times else []

def _weather_at(t_s):
    if not _wx_times:
        return None
    idx = nearest_index(np.array(_wx_times), t_s)
    return {
        "airTempC": round(float(_wx_air[idx]), 1),
        "trackTempC": round(float(_wx_track[idx]), 1),
        "rainfall": bool(_wx_rain[idx]),
    }

# Total race distance in laps — the highest lap number anyone reached this session.
TOTAL_LAPS = int(session.laps['LapNumber'].max()) if not session.laps.empty else 0

# ---------------------------------------------------------------------------
# Resample all drivers onto common 10 Hz grid over the window
# ---------------------------------------------------------------------------

print(f"\nResampling {len(session.drivers)} drivers from {WINDOW_START_S}s to {WINDOW_END_S}s at {HZ} Hz...")

window_start = pd.Timedelta(seconds=WINDOW_START_S)
window_end   = pd.Timedelta(seconds=WINDOW_END_S)
dt_s = 1.0 / HZ  # 0.1 seconds

# Build common time grid in seconds from session start
t_grid_s = np.arange(WINDOW_START_S, WINDOW_END_S, dt_s)
t_grid_td = pd.to_timedelta(t_grid_s, unit='s')

driver_frames = {}  # driver_num -> {'x': np.array, 'y': np.array, 'status': list}

for num in session.drivers:
    inum = int(num)
    if inum not in driver_info:
        continue

    pos = session.pos_data[num].copy()

    # Filter to window + small buffer for interpolation
    buffer = pd.Timedelta(seconds=5)
    mask = (pos['SessionTime'] >= window_start - buffer) & \
           (pos['SessionTime'] <= window_end + buffer)
    pos_win = pos[mask].copy()

    if len(pos_win) < 2:
        print(f"  WARNING: driver {num} ({driver_info[inum]['code']}) has < 2 points in window, skipping")
        continue

    # Convert SessionTime to float seconds for interpolation
    t_s = pos_win['SessionTime'].dt.total_seconds().values
    x_raw = pos_win['X'].values
    y_raw = pos_win['Y'].values
    status_raw = pos_win['Status'].values

    # Interpolate X and Y onto common grid
    x_interp = np.interp(t_grid_s, t_s, x_raw)
    y_interp = np.interp(t_grid_s, t_s, y_raw)

    # Status: true nearest-neighbour lookup (closest time to each grid point —
    # see ingest/resample.py; a bare searchsorted would give the next time
    # at-or-after the grid point instead, biasing status forward in time).
    t_indices = np.array([nearest_index(t_s, q) for q in t_grid_s])
    status_interp = status_raw[t_indices]

    # Telemetry: resample car_data onto the same grid (nearest-neighbour in time).
    # Build all five arrays locally first; assign to tel atomically so a partial
    # failure (e.g. missing column) never leaves tel in an inconsistent state.
    tel = {'speed': None, 'gear': None, 'throttle': None, 'brake': None, 'drs': None}
    try:
        cd = session.car_data[num]
        cd_t = cd['SessionTime'].dt.total_seconds().values
        # True nearest-neighbour (see ingest/resample.py) — a bare searchsorted
        # picks the next sample at-or-after the grid point, shifting telemetry
        # forward in time by up to one sample period vs. the position data.
        idx = np.array([nearest_index(cd_t, q) for q in t_grid_s])
        _speed    = cd['Speed'].values[idx].astype(int)
        _gear     = cd['nGear'].values[idx].astype(int)
        _throttle = cd['Throttle'].values[idx].astype(int)
        # FastF1 Brake is a BOOLEAN in current versions (not 0-100). Normalise to
        # 0/100 robustly so the FE bar is right whether the source is bool or %.
        _brake    = (cd['Brake'].values[idx].astype(float) > 0).astype(int) * 100
        # FastF1 DRS code >= 10 means the flap is open (10,12,14 = on; 8 = eligible).
        _drs      = (cd['DRS'].values[idx] >= 10)
        # All five succeeded — assign atomically.
        tel = {'speed': _speed, 'gear': _gear, 'throttle': _throttle, 'brake': _brake, 'drs': _drs}
    except Exception as e:
        print(f"  Warning: no telemetry for {num} ({driver_info[inum]['code']}): {type(e).__name__}: {e}")

    driver_frames[inum] = {
        'x': x_interp,
        'y': y_interp,
        'status': status_interp,
        'tel': tel,
    }

print(f"Active drivers in window: {len(driver_frames)}")

# ---------------------------------------------------------------------------
# Gap / interval (BEST-EFFORT, derived — FastF1 gives no per-tick gap).
#
# Each car's progress is measured in METRES of arc length along a
# distance-parameterised centreline, and metres are converted to milliseconds by
# inverting the *leader's own* distance-time curve ("when was the leader here?").
# ingest/geometry.py holds the pure geometry and the full method write-up; the
# short version is that this replaces snapping to one of 150 unevenly-spaced
# outline points and pricing each step at the field-median lap time, which
# quantised every gap to ~0.57 s and biased it by where on the lap the car was.
#
# Expected resolution ~50-100 ms, so the frontend prints one decimal, never three.
# ---------------------------------------------------------------------------

CENTRELINE_POINTS = 2000  # ~2.9 m per node at Monza; spacing is uniform by construction

print("\nBuilding distance-parameterised centreline...")
centreline, LAP_LENGTH_M = resample_closed_loop(centreline_ref_xy, CENTRELINE_POINTS)
# FastF1 X/Y are in decimetres (1/10 m); convert so the printed length is metres.
LAP_LENGTH_M /= 10.0
print(f"Centreline: {CENTRELINE_POINTS} nodes, lap length {LAP_LENGTH_M:.0f} m "
      f"({LAP_LENGTH_M * 10 / CENTRELINE_POINTS:.1f} raw units/node)")
if not 2000 <= LAP_LENGTH_M <= 8000:
    print(f"  WARNING: centreline lap length {LAP_LENGTH_M:.0f} m is not a plausible "
          f"F1 circuit length — the reference lap may be corrupt.")

_cl_arr = np.asarray(centreline)          # (N,2) raw FastF1 units
_LAP_RAW = LAP_LENGTH_M * 10.0            # lap length in the same raw units as _cl_arr


def _nearest_nodes(xs, ys):
    """Nearest centreline node index for each frame, in memory-bounded chunks."""
    out = np.empty(len(xs), dtype=int)
    for a in range(0, len(xs), 512):
        b = min(a + 512, len(xs))
        dx = xs[a:b, None] - _cl_arr[None, :, 0]
        dy = ys[a:b, None] - _cl_arr[None, :, 1]
        out[a:b] = np.argmin(dx * dx + dy * dy, axis=1)
    return out


print("Projecting every car onto it (race distance in metres)...")
t_grid_list = t_grid_s.tolist()  # plain list: geometry.py is numpy-free
race_dist = {}   # driver_num -> [metres of race distance], one per frame
pit_frames = {}  # driver_num -> [bool], True while the car is in the pit lane
for dnum, fr in driver_frames.items():
    xs, ys = np.asarray(fr['x'], dtype=float), np.asarray(fr['y'], dtype=float)
    idx = _nearest_nodes(xs, ys)
    s_raw = [project_to_arc(float(x), float(y), centreline, int(i), _LAP_RAW)
             for x, y, i in zip(xs, ys, idx, strict=True)]

    # Pit lane: not on the centreline, so projecting a stopped car would smear it
    # onto whichever track point happens to be nearest. Freeze arc length at its
    # pit-entry value instead, and emit no gap/interval for those frames (the UI
    # already renders IN PIT from status). A stop that straddles the start/finish
    # line still counts its lap: the frozen value is late-lap and the resume value
    # is early-lap, which wrap_counts reads as the crossing it was.
    in_pit = [_in_pit(dnum, float(t)) for t in t_grid_s]
    frozen = []
    held = None
    for s, pit in zip(s_raw, in_pit, strict=True):
        if pit and held is not None:
            frozen.append(held)
        else:
            frozen.append(s)
            held = s
    counts = wrap_counts(frozen, _LAP_RAW)

    lap0 = _lap_number(dnum, float(t_grid_s[0]))
    d = np.array([(lap0 + c) * _LAP_RAW + s for c, s in zip(counts, frozen, strict=True)]) / 10.0
    # Race distance can only increase; a backwards step is position noise, and the
    # curve must be monotone for invert_distance_curve's bisection to be sound.
    race_dist[dnum] = np.maximum.accumulate(d).tolist()
    pit_frames[dnum] = in_pit

# ---------------------------------------------------------------------------
# Emit JSONL
# ---------------------------------------------------------------------------

n_frames = len(t_grid_s)
max_rev = n_frames

# Map each race-control message onto the frame whose tick covers it.
msgs_by_idx = {}
for m in rc_msgs:
    idx = int(nearest_index(t_grid_s, m['timeMs'] / 1000.0))
    entry = {"rev": idx + 1, "t": m['timeMs'], "category": m['category'], "message": m['message']}
    if m['driver'] is not None:
        entry["driver"] = m['driver']
    msgs_by_idx.setdefault(idx, []).append(entry)

print(f"\nEmitting {n_frames} frames ({n_frames / HZ:.1f} seconds) for {len(driver_frames)} drivers...")
print(f"Estimated output: {n_frames} lines")

os.makedirs(os.path.dirname(OUTPUT_PATH), exist_ok=True)

with open(OUTPUT_PATH, 'w', encoding='utf-8') as f:

    # --- Header ---
    header = {
        "track": track_points,
        "label": GP_LABEL,
        "maxRev": max_rev,
        "radio": radio_clips,
        "lapTrace": lap_traces,
        "totalLaps": TOTAL_LAPS,
        "stints": stints,
        "pitStops": pit_stops,
        "pedalTraces": pedal_traces,
    }
    f.write(json.dumps(header, separators=(',', ':')) + '\n')

    # --- Frame lines ---
    _last_weather = None
    for i, t_s in enumerate(t_grid_s):
        rev = i + 1
        time_ms = int(round(t_s * 1000))
        t_td = pd.Timedelta(seconds=t_s)

        cars = []
        for dnum in sorted(driver_frames.keys()):
            info = driver_info[dnum]
            xi = driver_frames[dnum]['x'][i]
            yi = driver_frames[dnum]['y'][i]
            st = driver_frames[dnum]['status'][i]

            # Map status. Position-data 'Status' never reliably reports pit
            # lane (see the note above _in_pit's definition), so it's only
            # used for OnTrack-vs-not; pit status comes from lap timing.
            status_str = 'OnTrack' if st == 'OnTrack' else 'Out'
            if _in_pit(dnum, t_s):
                status_str = 'Pit'

            nx, ny = normalise(xi, yi)
            pos_order = get_position(dnum, t_s)

            t = get_timing(dnum, t_s)
            car = {
                "driverNum": dnum,
                "code": info['code'],
                "team": info['team'],
                "pos": pos_order,
                "p": {"x": nx, "y": ny},
                "status": status_str,
                # Doubles as reconcile_positions()'s tie-break below, so it is set
                # here rather than in the gap/interval pass that also reads it.
                "lap": _lap_number(dnum, t_s),
            }
            # Only attach non-zero/non-empty timing fields (mirror Go omitempty).
            if t['tyre']:
                car['tyre'] = t['tyre']
            for k in ('tyreAge', 'lastLapMs', 'bestLapMs', 's1Ms', 's2Ms', 's3Ms'):
                if t[k] > 0:
                    car[k] = t[k]
            tel = driver_frames[dnum]['tel']
            if tel['speed'] is not None:
                sp = int(tel['speed'][i])
                if sp > 0:
                    car['speed'] = sp
                gr = int(tel['gear'][i])
                if gr > 0:
                    car['gear'] = gr
                th = int(tel['throttle'][i])
                if th > 0:
                    car['throttle'] = th
                br = int(tel['brake'][i])
                if br > 0:
                    car['brake'] = br
                if bool(tel['drs'][i]):
                    car['drs'] = True
            cars.append(car)

        # Reconcile 'pos' into a unique, contiguous 1..N running order (#66) —
        # get_position() above is an independent per-driver lookup, so raw values
        # can collide, gap, or carry UNKNOWN_POS. See reconcile_positions' docstring.
        # Returns `cars` sorted into that order, so P1 is cars[0] from here on.
        reconcile_positions(cars)

        # --- gap / interval pass (best-effort; see the centreline section) ---
        # Each car's race distance in metres this frame, then "how long ago was
        # the reference car at that distance?" against that car's OWN curve.
        # Anchor the leader to the CLASSIFIED P1, not the max-distance car
        # (derivation noise could disagree).
        leader_car = cars[0] if cars else None
        leader_has_lap = leader_car is not None and 'lastLapMs' in leader_car
        leader_curve = race_dist.get(leader_car['driverNum']) if leader_car else None
        leader_dist = leader_curve[i] if leader_curve else 0.0

        def _behind_ms(curve, d_car, t_s=t_s):
            """ms since the reference car (whose curve this is) was at d_car.

            None when the answer would be fabricated: the reference car was never
            observed at that distance inside this window (window-edge case), or it
            is somehow behind, which the classified order says it is not.

            t_s defaulted to bind this frame's value — the closure is only ever
            called within this same loop iteration, but B023 can't tell that.
            """
            t_ref = invert_distance_curve(t_grid_list, curve, d_car)
            if t_ref is None or t_ref > t_s:
                return None
            return int(round((t_s - t_ref) * 1000))

        prev_car = None
        prev_gap_ms = None
        for car in cars:
            dn = car['driverNum']
            has_lap = 'lastLapMs' in car
            d_car = race_dist[dn][i]
            # Suppress while in the pit lane (distance is frozen, so any gap would
            # be a stale reading) and until both ends have a completed reference
            # lap — the same lastLapMs signal the FE's gapLabel/intLabel guards use.
            quotable = has_lap and leader_has_lap and not pit_frames[dn][i]
            gap_ms = _behind_ms(leader_curve, d_car) if quotable and leader_curve else None
            if gap_ms and gap_ms > 0:
                car['gapMs'] = gap_ms
            gap_laps = lap_deficit(leader_dist - d_car, LAP_LENGTH_M)
            if gap_laps > 0:
                car['gapLaps'] = gap_laps

            if (prev_car is not None and quotable and 'lastLapMs' in prev_car
                    and not pit_frames[prev_car['driverNum']][i]):
                int_ms = _behind_ms(race_dist[prev_car['driverNum']], d_car)
                # Window edge: the car ahead's curve does not reach back far enough
                # yet. The difference of the two leader-referenced gaps is the same
                # quantity measured against a curve that does, and is non-negative
                # because both come from one monotone curve.
                if int_ms is None and gap_ms is not None and prev_gap_ms is not None:
                    int_ms = gap_ms - prev_gap_ms
                if int_ms is not None and 0 < int_ms:
                    car['intMs'] = int_ms
            prev_car = car
            prev_gap_ms = gap_ms

        frame = {"rev": rev, "timeMs": time_ms, "cars": cars}
        if i in msgs_by_idx:
            frame["messages"] = msgs_by_idx[i]
        wx = _weather_at(t_s)
        if wx is not None and (i == 0 or wx != _last_weather):
            frame["weather"] = wx
            _last_weather = wx
        frame_line = {"timeMs": time_ms, "frame": frame}
        f.write(json.dumps(frame_line, separators=(',', ':')) + '\n')

print(f"\nWrote {n_frames + 1} lines (1 header + {n_frames} frames) to: {OUTPUT_PATH}")
print(f"  Race control: {len(rc_msgs)} messages baked")

# File size check
size_bytes = os.path.getsize(OUTPUT_PATH)
size_mb = size_bytes / (1024 * 1024)
print(f"File size: {size_mb:.2f} MB ({size_bytes:,} bytes)")

if size_mb > 25.0:
    print("WARNING: File exceeds 25 MB! Consider trimming the window or reducing Hz.")

# ---------------------------------------------------------------------------
# Contract validation
# ---------------------------------------------------------------------------

print("\nRunning contract validation...")

REQUIRED_CAR_FIELDS = {'driverNum', 'code', 'team', 'pos', 'p', 'status'}
REQUIRED_P_FIELDS   = {'x', 'y'}
REQUIRED_FRAME_FIELDS = {'rev', 'timeMs', 'cars'}
errors = 0

with open(OUTPUT_PATH, 'r', encoding='utf-8') as f:
    lines = f.readlines()

# Validate header
try:
    hdr = json.loads(lines[0])
    assert 'track' in hdr, "header missing 'track'"
    assert 'label' in hdr, "header missing 'label'"
    assert 'maxRev' in hdr, "header missing 'maxRev'"
    assert isinstance(hdr['track'], list) and len(hdr['track']) > 0, "track must be non-empty list"
    for tp in hdr['track']:
        assert 'x' in tp and 'y' in tp, f"track point missing x/y: {tp}"
        assert 0 <= tp['x'] <= 1 and 0 <= tp['y'] <= 1, f"track point out of [0,1]: {tp}"
    assert hdr['maxRev'] == n_frames, f"maxRev mismatch: {hdr['maxRev']} vs {n_frames}"
    assert 'radio' in hdr, "header missing 'radio'"
    assert isinstance(hdr['radio'], list), "radio must be a list"
    for rm in hdr['radio']:
        assert {'timeMs', 'driverNum', 'clip'} <= set(rm.keys()), f"radio item missing fields: {rm}"
        assert in_window_ms(rm['timeMs'], WINDOW_START_S, WINDOW_END_S), f"radio timeMs out of window: {rm}"
        assert rm['clip'].startswith('http'), f"radio clip not a URL: {rm}"
    assert 'totalLaps' in hdr, "header missing 'totalLaps'"
    assert isinstance(hdr['totalLaps'], int) and hdr['totalLaps'] >= 0, "totalLaps must be a non-negative int"
    assert 'stints' in hdr, "header missing 'stints'"
    assert len(hdr['stints']) >= 15, f"expected stints for >=15 drivers, got {len(hdr['stints'])}"
    for _dn, stint_list in hdr['stints'].items():
        for st in stint_list:
            assert {'compound', 'startLap', 'endLap'} <= set(st.keys()), f"stint missing fields: {st}"
    assert 'pitStops' in hdr, "header missing 'pitStops'"
    for _dn, stop_list in hdr['pitStops'].items():
        for ps in stop_list:
            assert {'lap', 'durationS'} <= set(ps.keys()), f"pit stop missing fields: {ps}"
    assert 'pedalTraces' in hdr, "header missing 'pedalTraces'"
    for _dn, pt in hdr['pedalTraces'].items():
        assert {'throttle', 'brake', 'gear'} <= set(pt.keys()), f"pedal trace missing fields: {pt}"
        assert len(pt['throttle']) == len(hdr['track']) == len(pt['brake']) == len(pt['gear']), \
            f"pedal trace length {len(pt['throttle'])} != track length {len(hdr['track'])}"
    print(f"  Header OK: {len(hdr['track'])} track points, maxRev={hdr['maxRev']}, {len(hdr['radio'])} radio clips, totalLaps={hdr['totalLaps']}, stints for {len(hdr['stints'])} drivers, pitStops for {len(hdr['pitStops'])} drivers, pedalTraces for {len(hdr['pedalTraces'])} drivers")
except AssertionError as e:
    print(f"  HEADER ERROR: {e}")
    errors += 1

# Validate a sample of frames (first, middle, last)
check_indices = [1, len(lines) // 2, len(lines) - 1]
for idx in check_indices:
    try:
        line = json.loads(lines[idx])
        assert 'timeMs' in line, f"line {idx}: missing 'timeMs'"
        assert 'frame' in line, f"line {idx}: missing 'frame'"
        frame = line['frame']
        missing = REQUIRED_FRAME_FIELDS - set(frame.keys())
        assert not missing, f"line {idx}: frame missing fields {missing}"
        for car in frame['cars']:
            missing_car = REQUIRED_CAR_FIELDS - set(car.keys())
            assert not missing_car, f"line {idx}: car missing fields {missing_car}"
            missing_p = REQUIRED_P_FIELDS - set(car['p'].keys())
            assert not missing_p, f"line {idx}: p missing fields {missing_p}"
            assert isinstance(car['driverNum'], int), f"driverNum not int: {car['driverNum']}"
            assert isinstance(car['pos'], int), f"pos not int: {car['pos']}"
            assert 0 <= car['p']['x'] <= 1, f"p.x out of range: {car['p']['x']}"
            assert 0 <= car['p']['y'] <= 1, f"p.y out of range: {car['p']['y']}"
        print(f"  Frame line {idx} OK: rev={frame['rev']}, {len(frame['cars'])} cars")
    except AssertionError as e:
        print(f"  FRAME ERROR at line {idx}: {e}")
        errors += 1

# Scan every frame line (not just the sample) for weather presence and, when a
# lap window was requested, an actual pit stop — the whole point of the re-bake.
# The same pass checks reconcile_positions' actual invariant (#66): every frame's
# positions unique and contiguous 1..N, with no UNKNOWN_POS sentinel. The sampled
# per-frame checks above only assert pos is an int, which a duplicate/gapped/99
# frame passes — exactly the bug that shipped.
saw_weather = False
saw_pit = False
bad_positions = None    # (line index, positions) of the first offending frame
for n, line in enumerate(lines[1:], start=1):
    fr = json.loads(line)['frame']
    if 'weather' in fr:
        saw_weather = True
    if any(c.get('status') == 'Pit' for c in fr['cars']):
        saw_pit = True
    positions = sorted(c['pos'] for c in fr['cars'])
    if bad_positions is None and positions != list(range(1, len(fr['cars']) + 1)):
        bad_positions = (n, positions)
if bad_positions is None:
    print(f"  Positions OK: all {len(lines) - 1} frames carry a unique, contiguous 1..N order")
else:
    bad_line, bad = bad_positions
    print(f"  POSITION ERROR: line {bad_line}: positions must be unique and "
          f"contiguous 1..{len(bad)}, got {bad}")
    errors += 1

try:
    assert saw_weather, "no frame carried a 'weather' field"
    print("  Weather OK: at least one frame carries weather")
except AssertionError as e:
    print(f"  WEATHER ERROR: {e}")
    errors += 1

if _args.start_lap is not None:
    try:
        assert saw_pit, "no frame car had status 'Pit' in the requested lap window"
        print("  Pit-stop OK: at least one car shows status 'Pit' in this window")
    except AssertionError as e:
        print(f"  PIT-STOP ERROR: {e}")
        errors += 1

if errors == 0:
    print("\nContract validation PASSED.")
else:
    print(f"\nContract validation FAILED with {errors} errors.")
    sys.exit(1)

print(f"\nDone! Clip: {OUTPUT_PATH}")
print(f"  Label:       {hdr['label']}")
print(f"  Frames:      {n_frames}")
print(f"  Drivers:     {len(driver_frames)}")
print(f"  Window:      {WINDOW_END_S - WINDOW_START_S}s at {HZ} Hz")
print(f"  Track pts:   {len(hdr['track'])}")
print(f"  File size:   {size_mb:.2f} MB")
