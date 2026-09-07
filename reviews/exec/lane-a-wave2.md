# Lane A execution report (wave 2)

Branch: `cleanup/verified-backlog` (pre-existing checkout, no commits made).
Scope: `ingest/**` only. Builds on wave 1 (`reviews/exec/lane-a.md`), which
already extracted `live_parsers.py`/`resample.normalise_point` and added
`test_live_parsers.py`. Items done this wave: #11, #3, #4 (backlog numbering
from `reviews/plans/verified-cleanup-backlog.md`).

## #11 — delete `ingest/explore.py`

Re-verified with a fresh repo-wide, case-insensitive grep for `explore`
before deleting. Seven hits, all in docs/reviews prose (`FILE-MAP.md`,
`reviews/plans/verified-cleanup-backlog.md`, `reviews/plans/features-to-add.md`,
`reviews/backlog-still-open.md`, `reviews/tech-debt-scan.md`,
`reviews/ponytail-audit.md`, `docs/superpowers/plans/...roadmap.md`) — no
imports, no CI references. Matches the prior verification; deleted the file.

`FILE-MAP.md` still has a row for it (`explore.py | FastF1 data exploration
script.`) — left alone since FILE-MAP regen is explicitly a main-session /
pre-commit step per `CLAUDE.md`, same call wave 1 made for its two new files.

## #3 — deduplicate the four message-handling blocks in `live_signalr.py`

Re-read the file fresh (post wave-1, ~938 lines going in) rather than trusting
the backlog's stale line numbers. Found the four blocks exactly as described,
duplicated between `_replay_capture` (offline capture-file replay) and
`handle_message` (the live SignalR closure inside `_run_live_signalr`).
Copied the existing SessionInfo/TeamRadio pattern: small free functions living
in the "shared message-handling blocks" section just before `_publish_frame`,
called from both sites.

Deduplicated (each was byte-identical logic, just iterated differently):

- **DriverList** → `_apply_driver_list(driver_info, payload)` — merges one
  patch dict into `driver_info`.
- **TimingData** → `_apply_timing_data(payload, running_positions,
  timing_extra)` — merges one payload's `Lines` into both dicts.
- **TimingAppData** → `_apply_tyre_data(payload, tyre_extra)` — merges one
  payload's `Lines` into `tyre_extra`.
- **Position.z** → `_apply_position_samples(pos_samples, bounds, driver_info,
  running_positions, timing_extra, tyre_extra, latest_cars)` — the decode →
  per-entry car-dict-build → `latest_cars` fold, which was identical in both
  call sites.

**Left duplicated, deliberately** — the code immediately around each
`_apply_position_samples` call:

- The decode-error handling differs in log level and control flow
  (`_log.debug(...); continue` in the capture loop vs `_log.warning(...);
  return` in the closure) — one is "skip this event, keep replaying", the
  other is "bail out of this one message callback". Not the same thing
  wearing different words.
- The rate-limit/publish tail differs in what clock it reads: `_replay_capture`
  publishes on the capture's own recorded `session_s` (so replay pacing is
  reproducible), `handle_message` publishes on `int(time.time() * 1000)` (real
  wall clock, because there's no recorded timestamp during a live session).
  It also differs in variable shape (`rev`/`last_publish`/`snapshot` as plain
  locals in the capture loop vs `rev_holder[0]`/`last_publish[0]`/
  `snapshot_holder[0]` list-holders in the closure, needed because
  `handle_message` never rebinds names from its enclosing scope) and in
  loop-vs-callback control flow (`continue` to the next event vs `return`
  from the callback). None of that is safe or sensible to merge without
  reshaping `_run_live_signalr` into something closer to a loop, which the
  brief said not to do ("do not restructure the module").

SessionInfo and TeamRadio were already shared via `_session_path_from_payload`
/ `_radio_or_defer` / `_flush_deferred_radio` from wave 1's baseline — untouched.

`live_signalr.py`: 938 → 917 lines (net; four call sites now call shared
helpers instead of repeating the loop body, offset by the new helpers'
docstrings).

## #4 — `reconcile_positions` retired-car sinking (`ingest/resample.py`)

**Sort semantics chosen:** primary key is `status == 'Out'` (retired sorts
after running). Retired cars get a constant secondary key — no tie-break at
all among them — so Python's stable sort preserves their *original relative
order in the input list* rather than re-deriving one from their (by
definition stale) raw `pos`/`lap`. Running cars keep the pre-existing
tie-break unchanged: raw `pos` (`UNKNOWN_POS` sorts last within that group),
then laps completed (descending), then driver number (ascending).

```python
def _rank_key(c):
    if c.get('status') == 'Out':
        return (True,)  # retired: one tail block, stable among themselves
    return (False, c.get('pos', UNKNOWN_POS), -(c.get('lap') or 0), c['driverNum'])
```

The final `enumerate` renumbering (`1..N` over the whole sorted list) is
unchanged, so the contiguous-1..N contract still holds — verified by test
below, including a duplicate-raw-pos + `UNKNOWN_POS` + retired mix.

**Left deferred (per instructions):** cold-start partial roster. Rewrote the
stale "KNOWN LIMITATIONS" bullet as a `# ponytail:`-style comment naming a
concrete ceiling (every writer sends a full-roster `DriverList` within the
first couple of frames, so the wrong-order window is a few frames at session
start, not a whole session) and an upgrade path (withhold reconciliation, or
flag the frame's order provisional, until a known full-roster count is hit).

**Tests added** (`ingest/test_resample.py`, following its existing
plain-`assert`, one-behaviour-per-function style):

- `test_reconcile_positions_sinks_retired_car_below_running_cars` — a
  retired car holding the numerically-best raw `pos` still ranks last.
- `test_reconcile_positions_keeps_retired_cars_in_stable_relative_order` —
  three retired cars, deliberately out of raw-pos/lap order in the input
  list, come out in their original relative order, all below the one running
  car.
- `test_reconcile_positions_still_contiguous_1_to_n_with_mixed_statuses` —
  duplicate raw `pos`, an `UNKNOWN_POS` entry, and a mix of retired/running
  cars still produce an exact `1..len(cars)` sequence with every retired
  car's rank after every running car's.

## Verification

From `ingest/`:

```
python test_live_parsers.py     # -> "live_parsers self-check PASSED"
python -m pytest . -q           # -> 83 passed (80 pre-existing + 3 new)
python -m py_compile live_signalr.py resample.py   # -> no errors
```

Did not import or run `record.py`/`live.py` directly (wave 1's report flags
that importing `record` at top level actually runs the recording pipeline);
`record.py` and `live_signalr.py` are already exercised end-to-end by
`test_capture_replay.py` and `test_live_publish.py`, both of which pass.

## Left alone / out of scope

- `record.py` — untouched this wave (no message-handling duplication lives
  there; it's a separate top-level ingest path, not part of item #3's scope).
- FILE-MAP regen — left for the pre-commit pass per `CLAUDE.md`, same as
  wave 1.
- No new dependencies, no commits, no branch created.
