# Runbook: verifying `live_signalr.py` against a real session

`ingest/live_signalr.py` is exploratory — every message shape it parses is
marked `UNVERIFIED:` in the source, based on community documentation of the F1
timing feed rather than a confirmed capture. This runbook is the checklist to
run through the next time a real F1 session (FP/Q/Race) is available, so the
"exploratory" caveat in the [README](../../README.md) can eventually be
dropped field-by-field instead of all at once.

For the day-to-day commands (recording a capture, replaying it offline,
running true-live mode), see [`ingest/README.md`](../../ingest/README.md)'s
"Live mode" section — this doc only covers verification, not operation.

## Prerequisites

```bash
pip install -r ingest/requirements-live.txt
```

## 1. Capture a real session

During any live session:

```bash
python -m fastf1.livetiming save capture-<gp>-<year>.txt --timeout 0
```

Let it run for at least 5–10 minutes covering a pit stop if possible (the
tyre/stint fields can only be checked against a stop). Ctrl-C to stop.

## 2. Replay it offline and inspect

```bash
CAPTURE_FILE=capture-<gp>-<year>.txt python ingest/live.py --live --session live
```

While it runs, in another terminal poll a snapshot and eyeball the car
fields the live path now populates:

```bash
redis-cli GET snapshot:live | python -m json.tool | less
```

## 3. Checklist — confirm or correct each `UNVERIFIED:` assumption

Each item names the assumption and the file/function where it's coded. Cross
off ✅ what matches; where it doesn't, fix the parsing code at that location
and remove the `UNVERIFIED:` comment (or narrow it).

- [ ] **Position.z shape** — `{"Position": [{"Timestamp", "Entries": {num: {X, Y, Z, Status}}}]}`, `X`/`Y` in 1/10 mm. (`_decode_position_payload`)
- [ ] **Position `Status` values** — `"OnTrack" | "OffTrack" | "Pitlane"`. (`_map_status`)
- [ ] **TimingData `Position`** — race running order, int, 1 = leader. (`handle_message`'s `TimingData` branch)
- [ ] **TimingData `GapToLeader`** — string, `"+0.512"` (seconds) or lap-deficit form (`"1L"`/`"1 LAP"`). (`_parse_gap_str`)
- [ ] **TimingData `IntervalToPositionAhead.Value`** — same string form as `GapToLeader`, nested under a `Value` key. (`_parse_timing_line`)
- [ ] **TimingData `LastLapTime.Value`** — `"M:SS.mmm"` or `"SS.mmm"`, nested under `Value`. (`_parse_laptime_str`)
- [ ] **TimingData `NumberOfLaps`** — current lap number, plain int. (`_parse_timing_line`)
- [ ] **TimingAppData `Stints`** — dict keyed by stint index (`"0"`, `"1"`, …) *or* a plain list; current stint = highest index / last element. (`_parse_tyre_line`)
- [ ] **TimingAppData stint `Compound`** — string, matches `SOFT`/`MEDIUM`/`HARD`/`INTERMEDIATE`/`WET` after `.upper()`. (`_parse_tyre_line`)
- [ ] **TimingAppData stint `TotalLaps`** — int, used directly as `tyreAge`. (`_parse_tyre_line`)
- [ ] **DriverList `Tla`/`TeamName`** — 3-letter code and full team name, team name run through the same `TEAM_MAP` as `record.py`. (`handle_message`'s `DriverList` branch)
- [ ] **Message dispatch shape** — `CompletionMessage.result` is `{topic: payload}` at connect; subsequent messages are a list of `[topic, payload]` pairs. (`_dispatch_message`)

## 4. Save a regression fixture

Once you've confirmed (or fixed) the shapes above, trim the capture to a
short, representative slice (a few seconds spanning one pit stop is enough)
and save it as a new fixture alongside
[`ingest/tests/capture_sample.txt`](../../ingest/tests/capture_sample.txt), or
replace that file if the synthetic version was masking a real shape
difference. Extend
[`ingest/test_capture_replay.py`](../../ingest/test_capture_replay.py) to
assert against the real values so this verification is never lost — a future
FastF1/feed change that breaks parsing should fail this test, not silently
degrade the live board.

## Definition of "verified"

`live_signalr.py` (and this runbook) can drop "exploratory" for a given field
once: the checklist item above is checked off against a real capture, AND a
regression test asserts the parsed value from that real capture. Fields not
yet checked off should keep their `UNVERIFIED:` comment — don't remove it
preemptively.
