"""
FastF1 data exploration script.
Run BEFORE record.py to understand the actual data shapes,
coordinate ranges, and available fields.
"""
import fastf1
import numpy as np

fastf1.Cache.enable_cache('cache')  # gitignored

print("Loading Monza 2024 Race session...")
s = fastf1.get_session(2024, 'Monza', 'R')
s.load(telemetry=True, laps=True, weather=False)

print("\n=== Drivers ===")
print("s.drivers:", s.drivers)

drv = s.drivers[0]
print(f"\nFirst driver: {drv}")

print("\n=== Position data columns ===")
pos = s.pos_data[drv]
print("Columns:", pos.columns.tolist())
print("\nHead:")
print(pos.head())
print("\nDtypes:")
print(pos.dtypes)

print("\n=== X/Y ranges ===")
print(f"X range: {pos['X'].min():.1f} .. {pos['X'].max():.1f}")
print(f"Y range: {pos['Y'].min():.1f} .. {pos['Y'].max():.1f}")
if 'Z' in pos.columns:
    print(f"Z range: {pos['Z'].min():.1f} .. {pos['Z'].max():.1f}")

print("\n=== Status values ===")
if 'Status' in pos.columns:
    print(pos['Status'].value_counts())

print("\n=== Session time range ===")
print(f"SessionTime min: {pos['SessionTime'].min()}")
print(f"SessionTime max: {pos['SessionTime'].max()}")

print("\n=== Driver info for first 3 drivers ===")
for num in s.drivers[:3]:
    try:
        d = s.get_driver(num)
        print(f"  Driver {num}: Abbreviation={d['Abbreviation']}, TeamName={d['TeamName']}, DriverNumber={d['DriverNumber']}")
    except Exception as e:
        print(f"  Driver {num}: ERROR {e}")

print("\n=== Laps columns (first 5) ===")
print(s.laps.columns.tolist())
if 'Position' in s.laps.columns:
    print("\nPosition values (first lap):")
    print(s.laps[['Driver', 'DriverNumber', 'Position', 'LapStartTime']].head(20))

print("\n=== All team names ===")
teams = set()
for num in s.drivers:
    try:
        d = s.get_driver(num)
        teams.add(d['TeamName'])
    except:
        pass
print(sorted(teams))

print("\n=== Full driver table ===")
for num in s.drivers:
    try:
        d = s.get_driver(num)
        print(f"  {num:>3} | {d['Abbreviation']:>3} | {d['TeamName']}")
    except Exception as e:
        print(f"  {num}: ERROR {e}")
