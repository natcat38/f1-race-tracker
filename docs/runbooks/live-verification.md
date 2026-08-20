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
pip install -r ingest/requirements.txt -r ingest/requirements-live.txt
pip install --no-deps -r ingest/requirements-live-nodeps.txt
```

**Two commands, and the second one matters.** `signalrcore` must be installed with
`--no-deps`: it declares a `msgpack` pin that is both vulnerable and conflicting, so
pip refuses to install it alongside the patched msgpack. Its only real runtime
dependency *is* msgpack, so skipping resolution is safe — the file's header explains
this in full. Install it second, so the patched msgpack is already in place.

Skipping the second command leaves you with no `signalrcore` at all and a live path
that exits with an import error; installing it *without* `--no-deps` either fails to
resolve or downgrades msgpack to a vulnerable version.

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

## 5. Beta live path — the operator's own F1TV subscription

F1's live timing feed now needs an F1TV subscription. Sections 1–4 above still work
with a free account for *capture* work; this section covers the authenticated path
(ADR-0007), which is opt-in three times over and off by default.

### 5.1 Link the account (host only, once)

```bash
python ingest/f1tv_link.py
```

Runs in the foreground and prints a `https://f1login.fastf1.dev?port=…` URL. Open it
in a browser with the f1login extension installed and sign in with your own F1
account. On success the token is cached by fastf1 and copied to
`./secrets/fastf1/f1auth.json` (git-ignored) for the compose mount.

This is a **host** command. fastf1's login server binds a random port on
`127.0.0.1` and the extension POSTs to it; Docker cannot forward a host port onto a
container's loopback, and the port is not fixable. There is no in-container variant.

Check and undo:

```bash
python ingest/f1tv_link.py --status
python ingest/f1tv_link.py --unlink
```

A **free** F1 account links fine — the login is not tier-gated. What the *timing
feed* requires is F1 TV Access or better; the `SubscriptionStatus` /
`SubscribedProduct` claims on the token say which you have, and the settings page
shows them.

### 5.2 Confirm the app sees it

`docker compose up -d`, then open <http://localhost:8080#settings>. The chip reads
NOT LINKED with no token and flips to LINKED within a minute of the ingest service
seeing one — status is republished every 60 s. Nothing but the state, expiry and
tier crosses the seam; the token itself never leaves the host.

### 5.3 Race day — connect for real

The tracked compose defaults stay a demo. Put the beta settings in a
`docker-compose.override.yml`, which compose merges automatically:

```yaml
services:
  live:
    environment:
      LIVE: "1"
      LIVE_TIMING_MODE: beta
    command: ["--live", "--session", "live"]
```

All three gates must line up — the `--live` flag, `LIVE=1`, and
`LIVE_TIMING_MODE=beta` — plus a linked account. Miss any one and the service exits
non-zero with the exact command to run; it never degrades silently.

To run the ingest from the host instead (where fastf1 lives, which is what capture
work wants), expose Redis and point at it:

```yaml
services:
  redis:
    ports: ["6379:6379"]
```

```bash
LIVE=1 LIVE_TIMING_MODE=beta CAPTURE_OUT=capture-live.txt   python ingest/live.py --live --session live --redis-url redis://localhost:6379
```

`CAPTURE_OUT` is the verification net: the raw feed is written there as it streams,
so §3's checklist and the TeamRadio schema below can be settled from one real session.

### 5.4 What the 2026-08-20 spike settled, and what is left

Verified for real (see
[the spike findings](../superpowers/specs/2026-08-20-f1auth-spike-findings.md)):

- [x] **A free F1 account links.** The login is not tier-gated; the token carries
      `SubscriptionStatus: inactive` and an empty `SubscribedProduct`.
- [x] **The websocket accepts a free-tier token.** Connect succeeded and the server
      pushed a 91 KB snapshot of all 17 topics for the last completed session.
      Negotiate returns 200 with or without a token.
- [x] **`TeamRadio` schema** — `Captures` holding `{Utc, RacingNumber, Path}`, as a
      list, 37 entries. ADR-0008's assumption was right.
- [x] **Payloads are JSON strings, not dicts** — was a real bug, now fixed at
      `_dispatch_message` and pinned by `ingest/test_dispatch.py`.

Still open:

- [ ] **The `signalrcore` pin blocks the live path.** `0.8.8` (pinned for msgpack
      security) is incompatible with modern websocket-client and dies on connect.
      `1.0.2` works — including with the *patched* msgpack — but its declared pin
      conflicts, so it cannot go in a plain requirements file. **This, not auth, is
      what stops a real run today.** See the options table in the spike findings.
- [ ] Whether a **live session's** stream is tier-gated (the connect snapshot is not).
      Needs a race weekend, not a subscription.
- [ ] The **incremental patch shape** (index-keyed dict `Captures`). Only the connect
      snapshot has been observed; both shapes are parsed defensively.
- [ ] Clip mp3s fetchable **mid-session** from
      `https://livetiming.formula1.com/static/<SessionInfo.Path>/<Path>` (ADR-0003,
      amended). The URL construction itself is confirmed against real `Path` values.

### 5.5 Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Settings shows NOT LINKED after linking | container has no `./secrets` mount, or the copy failed | check `./secrets/fastf1/f1auth.json` exists, then `docker compose up -d --force-recreate live` |
| Settings shows EXPIRED | the cached JWT is past `exp` | `python ingest/f1tv_link.py` again |
| Settings shows UNAVAILABLE | gateway up but no ingest publishing status | check the `live` service logs |
| `f1tv_link.py` prints no URL | output buffering, or the extension is missing | run it in the foreground (not through a pipe) and install the extension first |
| Service exits: "Real connection needs LIVE_TIMING_MODE=beta" | only two of the three gates set | see §5.3 |
| Service exits: "F1TV account is unlinked" | no token where the container looks | §5.1, then restart the service |
| Runs but no data | outside a live session | expected — the stream times out after ~120 s with nothing |

## Definition of "verified"

`live_signalr.py` (and this runbook) can drop "exploratory" for a given field
once: the checklist item above is checked off against a real capture, AND a
regression test asserts the parsed value from that real capture. Fields not
yet checked off should keep their `UNVERIFIED:` comment — don't remove it
preemptively.
