"""Self-check for ingest/radio.extract_radio (no fastf1/network needed)."""
import sys
from datetime import datetime, timezone
from radio import extract_radio

# t0 = session-time zero at 2024-09-01T12:00:00Z
t0 = datetime(2024, 9, 1, 12, 0, 0, tzinfo=timezone.utc).timestamp()
caps = [
    {"Utc": "2024-09-01T12:55:10.000Z", "RacingNumber": "16", "Path": "TeamRadio/LEC.mp3"},  # 3310s -> in window
    {"Utc": "2024-09-01T12:00:30.000Z", "RacingNumber": "1", "Path": "TeamRadio/VER.mp3"},   # 30s -> before window
    {"Utc": "2024-09-01T12:54:00.000Z", "RacingNumber": "4", "Path": "TeamRadio/NOR.mp3"},   # 3240s -> before 3300
]
out = extract_radio(caps, t0, 3300, 3750, "https://livetiming.formula1.com", "/static/x/")

assert len(out) == 1, f"expected 1 in-window clip, got {len(out)}: {out}"
m = out[0]
assert m["timeMs"] == 3310000, m
assert m["driverNum"] == 16 and isinstance(m["driverNum"], int), m
assert m["clip"] == "https://livetiming.formula1.com/static/x/TeamRadio/LEC.mp3", m

# sorted ascending when multiple in-window
caps2 = [
    {"Utc": "2024-09-01T12:56:00.000Z", "RacingNumber": "1", "Path": "b.mp3"},   # 3360s
    {"Utc": "2024-09-01T12:55:00.000Z", "RacingNumber": "16", "Path": "a.mp3"},  # 3300s
]
out2 = extract_radio(caps2, t0, 3300, 3750, "https://x", "/p/")
assert [m["timeMs"] for m in out2] == [3300000, 3360000], out2

print("radio.extract_radio self-check PASSED")
sys.exit(0)
