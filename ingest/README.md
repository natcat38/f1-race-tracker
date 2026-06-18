# ingest/ — FastF1 Recorder

Bakes real F1 session data into the `.jsonl` clip format read by the Go replay player.

## Setup

```bash
python -m venv .venv
.venv/Scripts/python -m pip install -r ingest/requirements.txt
```

## Bake a clip

```bash
.venv/Scripts/python ingest/record.py [output_path]
```

Default output: `data/replays/monza-2024-race.jsonl`

On first run, FastF1 downloads ~50 MB of session data and caches it under `cache/` (gitignored). Subsequent runs are fast.

## Clip contract

The output is JSONL (one JSON object per line):

- **Line 1 (header):** `{"track":[{"x":float,"y":float},...], "label":"...", "maxRev":int}`
- **Lines 2–N (frames):** `{"timeMs":int, "frame":{"rev":int,"timeMs":int,"cars":[...]}}`

Each car: `{"driverNum":int,"code":"VER","team":"Red Bull","pos":int,"p":{"x":float,"y":float},"status":"OnTrack"}`

Coordinates are normalised to `[0,1]`. Team strings match the frontend colour map in `web/src/components/Map.tsx`.

## Team name mapping (FastF1 → frontend)

| FastF1 `TeamName`  | Frontend key   |
|--------------------|----------------|
| Red Bull Racing    | Red Bull       |
| Haas F1 Team       | Haas           |
| Kick Sauber        | Kick Sauber    |
| RB                 | RB             |
| All others         | (unchanged)    |

## Configuration

Edit the top of `record.py` to adjust:
- `WINDOW_START_S` / `WINDOW_END_S` — session time window (seconds)
- `HZ` — sample rate (default 10 Hz)
- `TRACK_POINTS` — track outline resolution (default 150)

## Notes

- FastF1 position data is in millimetres (X range ~12,000 mm at Monza = ~12 m? — actually in local track coordinate system, ~metres scaled).
- Y is flipped (`1.0 - normalised_y`) so the track renders upright in SVG (SVG y-axis grows downward).
- Running order (`pos`) is derived from lap-level `Position` data with step interpolation — accurate to within one lap interval.
- `cache/` is gitignored. Delete it to force a re-download.
