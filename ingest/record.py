"""
FastF1 → JSONL clip recorder.

Bakes a real F1 session into the contract read by the Go replay player.

CONTRACT (must match internal/model/model.go + web/src/state/race.ts):
  Header line: {"track":[{"x":float,"y":float},...], "label":"...", "maxRev":int}
  Frame lines: {"timeMs":int, "frame":{"rev":int,"timeMs":int,"cars":[
                 {"driverNum":int,"code":"VER","team":"Red Bull","pos":int,
                  "p":{"x":float,"y":float},"status":"OnTrack"}]}}

Usage:
  .venv/Scripts/python.exe ingest/record.py [out] [--year YEAR] [--gp GP] [--session S] [--label LABEL]

Default output: data/replays/monza-2024-race.jsonl

Note: WINDOW_START_S/WINDOW_END_S define a mid-race window that works well for most
circuits but may need tuning per circuit (e.g. if the window falls under a safety car
or a long pit phase for a particular GP).
"""

import fastf1
import numpy as np
import pandas as pd
import json
import sys
import os
import argparse
from pathlib import Path

# ---------------------------------------------------------------------------
# Args
# ---------------------------------------------------------------------------

_ap = argparse.ArgumentParser(description="Bake a FastF1 session into a JSONL clip.")
_ap.add_argument("out", nargs="?", default="data/replays/monza-2024-race.jsonl")
_ap.add_argument("--year", type=int, default=2024)
_ap.add_argument("--gp", default="Monza")
_ap.add_argument("--session", default="R")
_ap.add_argument("--label", default=None, help="defaults to '<gp> <year> · Race'")
_args = _ap.parse_args()

OUTPUT_PATH = _args.out
GP_LABEL = _args.label or f"{_args.gp} {_args.year} · Race"

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

HZ = 10          # target sample rate (frames per second)
TRACK_POINTS = 150  # number of track outline points

# Window: 15:00 - 17:30 into session (green-flag mid-race racing at Monza).
# Monza race is ~1:20:00 total. We pick a ~2.5-min window in the middle of lap ~30-35.
# Note: this window is generic enough for a full race; may need tuning per circuit.
WINDOW_START_S = 3600   # 60 min into session
WINDOW_END_S   = 3750   # 60 + 2.5 min = 62.5 min

# FastF1 team name → frontend colour map key (from web/src/components/Map.tsx teamColour)
TEAM_MAP = {
    'Red Bull Racing': 'Red Bull',
    'Ferrari':         'Ferrari',
    'Mercedes':        'Mercedes',
    'McLaren':         'McLaren',
    'Aston Martin':    'Aston Martin',
    'Alpine':          'Alpine',
    'Williams':        'Williams',
    'RB':              'RB',
    'Kick Sauber':     'Kick Sauber',
    'Haas F1 Team':    'Haas',
}

# ---------------------------------------------------------------------------
# Load session
# ---------------------------------------------------------------------------

print("Enabling cache...")
cache_dir = Path(__file__).parent.parent / "cache"
cache_dir.mkdir(exist_ok=True)
fastf1.Cache.enable_cache(str(cache_dir))

print(f"Loading {_args.gp} {_args.year} session '{_args.session}' (cached if already downloaded)...")
session = fastf1.get_session(_args.year, _args.gp, _args.session)
session.load(telemetry=True, laps=True, weather=False)
print(f"Loaded. Drivers: {session.drivers}")

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
        print(f"  Warning: couldn't get driver info for {num}: {e}")

print(f"Driver info ({len(driver_info)} drivers):")
for num, info in sorted(driver_info.items()):
    print(f"  {num:>3} | {info['code']} | {info['team']}")

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
    nx = (x - x_min + x_offset) / max_range
    # Flip Y: 1.0 - ... so track isn't upside-down
    ny = 1.0 - (y - y_min + y_offset) / max_range
    return round(float(nx), 4), round(float(ny), 4)

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
# Derive running order from laps data
# Build a per-driver position lookup: (DriverNumber -> position) at session time T
# We use the Position column from session.laps which gives lap-level position.
# ---------------------------------------------------------------------------

print("\nBuilding running order lookup...")

# For each driver, get (LapStartTime, Position) pairs so we can do a step lookup.
order_lookup = {}  # driver_num -> list of (session_time_seconds, position)
for num in session.drivers:
    inum = int(num)
    drv_laps = session.laps.pick_drivers(num)[['LapStartTime', 'Position']].dropna()
    if len(drv_laps) == 0:
        continue
    order_lookup[inum] = [
        (t.total_seconds(), int(p))
        for t, p in zip(drv_laps['LapStartTime'], drv_laps['Position'])
    ]

def get_position(driver_num, session_time_s):
    """Return driver's running position at a given session time (step lookup)."""
    entries = order_lookup.get(driver_num, [])
    if not entries:
        return 99  # unknown
    pos = entries[0][1]
    for t, p in entries:
        if t <= session_time_s:
            pos = p
        else:
            break
    return pos

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
for num in session.drivers:
    inum = int(num)
    if inum not in driver_info:
        continue
    drv = session.laps.pick_drivers(num)
    if len(drv) == 0:
        continue
    events = []
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
        events.append((start_s, {
            'tyre': str(compound).upper() if compound else '',
            'tyreAge': tyre_age,
            'complete_at': start_s + (last_ms / 1000.0) if last_ms > 0 else start_s,
            'lastLapMs': last_ms,
            'bestLapMs': best_ms,
            's1Ms': _ms(lap['Sector1Time']),
            's2Ms': _ms(lap['Sector2Time']),
            's3Ms': _ms(lap['Sector3Time']),
        }))
    events.sort(key=lambda e: e[0])
    timing_lookup[inum] = events


def get_timing(driver_num, t_s):
    """Pit-wall numbers for a driver at session time t_s (step lookup)."""
    events = timing_lookup.get(driver_num, [])
    tyre, tyre_age = '', 0
    last_ms = best_ms = s1 = s2 = s3 = 0
    for start_s, f in events:
        if start_s <= t_s:
            tyre, tyre_age = f['tyre'], f['tyreAge']
        if f['complete_at'] <= t_s:
            last_ms, best_ms = f['lastLapMs'], f['bestLapMs']
            s1, s2, s3 = f['s1Ms'], f['s2Ms'], f['s3Ms']
        elif start_s > t_s:
            break
    return {'tyre': tyre, 'tyreAge': tyre_age, 'lastLapMs': last_ms,
            'bestLapMs': best_ms, 's1Ms': s1, 's2Ms': s2, 's3Ms': s3}

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

    # Status: use nearest-neighbor (find closest time for each grid point)
    t_indices = np.searchsorted(t_s, t_grid_s, side='left').clip(0, len(t_s) - 1)
    status_interp = status_raw[t_indices]

    # Telemetry: resample car_data onto the same grid (nearest-neighbour in time).
    # Build all five arrays locally first; assign to tel atomically so a partial
    # failure (e.g. missing column) never leaves tel in an inconsistent state.
    tel = {'speed': None, 'gear': None, 'throttle': None, 'brake': None, 'drs': None}
    try:
        cd = session.car_data[num]
        cd_t = cd['SessionTime'].dt.total_seconds().values
        idx = np.searchsorted(cd_t, t_grid_s, side='left').clip(0, len(cd_t) - 1)
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
        print(f"  Warning: no telemetry for {num} ({driver_info[inum]['code']}): {e}")

    driver_frames[inum] = {
        'x': x_interp,
        'y': y_interp,
        'status': status_interp,
        'tel': tel,
    }

print(f"Active drivers in window: {len(driver_frames)}")

# ---------------------------------------------------------------------------
# Emit JSONL
# ---------------------------------------------------------------------------

n_frames = len(t_grid_s)
max_rev = n_frames

print(f"\nEmitting {n_frames} frames ({n_frames / HZ:.1f} seconds) for {len(driver_frames)} drivers...")
print(f"Estimated output: {n_frames} lines")

os.makedirs(os.path.dirname(OUTPUT_PATH), exist_ok=True)

with open(OUTPUT_PATH, 'w', encoding='utf-8') as f:

    # --- Header ---
    header = {
        "track": track_points,
        "label": GP_LABEL,
        "maxRev": max_rev,
    }
    f.write(json.dumps(header, separators=(',', ':')) + '\n')

    # --- Frame lines ---
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

            # Map status
            if st == 'OnTrack':
                status_str = 'OnTrack'
            elif st in ('Pitlane', 'Pit'):
                status_str = 'Pit'
            else:
                status_str = 'Out'

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

        frame_line = {
            "timeMs": time_ms,
            "frame": {
                "rev": rev,
                "timeMs": time_ms,
                "cars": cars,
            }
        }
        f.write(json.dumps(frame_line, separators=(',', ':')) + '\n')

print(f"\nWrote {n_frames + 1} lines (1 header + {n_frames} frames) to: {OUTPUT_PATH}")

# File size check
size_bytes = os.path.getsize(OUTPUT_PATH)
size_mb = size_bytes / (1024 * 1024)
print(f"File size: {size_mb:.2f} MB ({size_bytes:,} bytes)")

if size_mb > 5.0:
    print(f"WARNING: File exceeds 5 MB! Consider trimming the window or reducing Hz.")

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
    print(f"  Header OK: {len(hdr['track'])} track points, maxRev={hdr['maxRev']}")
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
