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

---

## Live mode (Task 8) — true-live FastF1 SignalR ingest

`live_signalr.py` connects to the F1 live-timing SignalR stream during a
real Grand Prix session and publishes the same Redis contract as clip-replay
mode.  It is **exploratory and session-only** — outside a live session the
stream returns no position data.

### Recording a capture during a real session

During any F1 session (FP, Q, Race) run:

```bash
# Record until you press Ctrl-C or until --timeout seconds of silence
.venv/Scripts/python -m fastf1.livetiming save capture.txt --timeout 0
```

This writes a text file where each line is:
```
['Topic', payload, '2024-09-01T13:01:00.123Z']
```

Save the file somewhere persistent (it can be several MB per session).

### Replaying a capture offline

```bash
CAPTURE_FILE=capture.txt .venv/Scripts/python ingest/live.py --live --session live
```

The replay runs at real-time pace using the recorded timestamps.

### Running in true-live mode during a session

```bash
.venv/Scripts/python ingest/live.py --live --session live --label "British GP 2026"
```

Set `CAPTURE_OUT=myfile.txt` to also save the stream to a file while publishing.

### Structural / import check (no session required)

```bash
# Should print True with no errors
NO_LIVE=1 .venv/Scripts/python -c "import sys; sys.path.insert(0,'ingest'); import live_signalr; print(callable(live_signalr.run_live))"
```

### Normalization bounds

Position data arrives incrementally (no full-session data up front).
`live_signalr.py` accumulates X/Y min/max during the first 30 seconds
(`BOUND_WARMUP_S`) then freezes bounds for the rest of the session.
Frames during warmup may have slightly imprecise normalisation if early
samples don't cover the full track extent.  This is an accepted tradeoff
for avoiding per-circuit configuration.
