# Lane A execution report (wave 1)

Branch: `cleanup/verified-backlog` (pre-existing checkout, no commits made per
instructions). Source: `reviews/plans/verified-cleanup-backlog.md` items 2,
12, 13, 1 (in that order, per PR-1 batching: "items 1+2+12 (+3 if appetite)"
— item 3 was NOT attempted, out of scope for this wave).

## #2 — Split the parsers into `ingest/live_parsers.py`

Created `ingest/live_parsers.py`, mirroring `resample.py`'s pure-helper
pattern (module docstring stating the fastf1-free rationale, stdlib-only
imports: `base64`, `json`, `zlib`). Moved verbatim:

- `_decode_position_payload`, `_parse_gap_str`, `_parse_laptime_str`,
  `_parse_timing_line`, `_parse_tyre_line`, `_map_status`, `_safe_int`
- `TEAM_MAP` (see #12 below — same move, same file)

`ingest/live_signalr.py` now does `from live_parsers import (TEAM_MAP,
_decode_position_payload, _parse_gap_str, _parse_laptime_str,
_parse_timing_line, _parse_tyre_line, _map_status, _safe_int)`. Dropped the
now-unused `zlib`/`base64` imports from `live_signalr.py` (only the moved
`_decode_position_payload` used them); kept `import json` since four other
call sites in the file still use it directly.

**Naming call:** kept every function's leading underscore instead of
promoting them to a bare public name. Checked precedent first — `radio.py`
and `geometry.py` (the repo's other "pure helper, imported cross-module"
files alongside `resample.py`) both mix underscored and bare top-level
functions in the same file, so a leading underscore surviving into a shared
module's public surface is already the established convention here, not an
oversight. Renaming would have also touched ~26 call sites across
`live_signalr.py` for no behavioural gain — the shorter diff and the
existing convention pointed the same way.

## #12 — Deduplicate `TEAM_MAP`

Byte-identical dict confirmed in both files before the move. Now defined
once in `ingest/live_parsers.py` (comment updated to `(from
web/src/components/teamColours.ts)`, the actual source of truth — the two
prior copies disagreed on their own comment wording, one said "from
teamColours.ts", the other said "mirrors record.py exactly"). Both
`ingest/record.py` and `ingest/live_signalr.py` now import it:
`record.py` gained `from live_parsers import TEAM_MAP`; `live_signalr.py`'s
import is the same line as #2 above.

## #13 — Extract the shared normalise formula

Added `normalise_point(x, y, x_min, y_min, max_range, x_offset, y_offset)`
to `ingest/resample.py` — just the final formula (`nx =`, `ny =`, round to
4dp), nothing else. Did **not** touch the bounds-accumulation strategies:

- `record.py`'s `normalise(x, y)` closure still computes `x_min`/`y_min`/
  `max_range`/`x_offset`/`y_offset` once up front from the whole session's
  leader position data; its body is now just
  `return normalise_point(x, y, x_min, y_min, max_range, x_offset, y_offset)`.
- `live_signalr.py`'s `BoundBox.normalise` still grows/freezes bounds
  incrementally (`BOUND_WARMUP_S`) and still has its own zero-range guard
  (`x_range = self._x_max - self._x_min or 1.0`) before computing
  `max_range`/offsets; only its final two lines were replaced with a call to
  `normalise_point`.

Call sites (`record.py:734`, `live_signalr.py:579,755`) were untouched —
both still call their own local `normalise`/`bounds.normalise` wrapper.

## #1 — Direct unit tests for the seven parsers

New file `ingest/test_live_parsers.py`, copying `test_ghost.py`'s dual-mode
pattern (plain `assert`s, collectable by pytest, also runnable directly via
`python ingest/test_live_parsers.py` for the CI contract job). Imports only
`base64`, `json`, `sys`, `zlib`, and `live_parsers` — no fastf1/numpy/pandas,
so it runs in CI's fastf1-free contract job unlike `test_capture_replay.py`.

Coverage, table-driven where it made sense:

- `_parse_gap_str`: numeric parse, empty/`None`/unparseable → `(None, None)`,
  negative clamped to `0`, and the `'L'`/`'LAP'`/`'LAPS'` lapped-suffix branch
  (explicitly flagged in the backlog as untested even indirectly) including
  the no-digits-to-extract edge (`"LAP"` → `(None, None)`).
- `_parse_laptime_str`: `M:SS.mmm`, bare `SS.mmm`, empty/`None`/unparseable.
- `_parse_timing_line`: full field set, the lapped-gap branch, missing
  fields, and a malformed `NumberOfLaps` swallowed rather than raised.
- `_parse_tyre_line`: dict-keyed Stints (highest index wins), list-keyed
  Stints (last wins), and the no-Stints/empty-Stints → `{}` paths.
- `_map_status`: `'OnTrack'`, all three pit spellings, and the `'Out'`
  fallback (backlog-flagged) exercised with `'Out'` itself, `'Retired'`, and
  an arbitrary unknown string.
- `_safe_int`: valid, invalid, and `None`.
- `_decode_position_payload`: dict with/without `'Position'`, a real
  zlib-raw-deflate + base64 string (built with `zlib.compressobj(..., -15)`
  to match the wire format `_decode_position_payload` expects), a plain-JSON
  string fallback, and an unparseable string → `[]`.
- One `TEAM_MAP` spot-check (two entries) — the full dict is a data table,
  not logic worth asserting entry-by-entry in this file.

## Verification

Commands run, from `ingest/`:

```
python test_live_parsers.py       # direct-script mode
python -m pytest . -q             # full ingest suite
```

Results:

- `python test_live_parsers.py` → `live_parsers self-check PASSED`.
- `python -m pytest . -q` → **80 passed** (12.25s). This machine has
  `fastf1`/`numpy`/`pandas` installed, so `test_capture_replay.py` ran for
  real (not skipped) and passed too — including its `TEAM_MAP` assertion
  (`car["team"] == "Red Bull"`), which now flows through the moved,
  imported `TEAM_MAP`.

Import/behaviour checks:

- `ast.parse()` on all five touched/new files (`record.py`, `live_signalr.py`,
  `live_parsers.py`, `resample.py`, `test_live_parsers.py`) — all parse clean.
- `record.py` is a top-level script, not import-safe (no `if __name__ ==
  "__main__"` guard) — an attempted `python -c "import record"` sanity check
  actually re-ran the whole recording pipeline against the cached FastF1
  session data and re-baked a replay clip. Caught immediately: it wrote to
  `ingest/data/replays/monza-2024-race.jsonl` (a stray copy, cwd-relative,
  distinct from the tracked `data/replays/monza-2024-race.jsonl` at repo
  root), which I deleted afterward — confirmed via `git status`/`git diff`
  that the tracked root-level file was untouched and the stray copy was
  fully removed, so no working-tree pollution survived. Silver lining: the
  bake ran to completion and passed its own internal contract validation
  (`Positions OK: all 4500 frames carry a unique, contiguous 1..N order`),
  which is a strong end-to-end proof that `record.py`'s new imports
  (`normalise_point` from `resample.py`, `TEAM_MAP` from `live_parsers.py`)
  work and preserve behaviour — I did not repeat this by design given the
  side effect. `import live_signalr` was verified instead through pytest,
  which already imports it via `test_capture_replay.py` and
  `test_live_publish.py` — a plain `python -c "import live_signalr"` was
  attempted afterward for a redundant direct check but was blocked by the
  sandbox's auto-mode classifier (unrelated to correctness; pytest's
  successful collection of those two test files already exercises the same
  import path).

## Left alone / out of scope

- Item 3 (dedupe the four copy-pasted message-handling blocks in
  `live_signalr.py`) — not attempted this wave, per the plan's "(+3 if
  appetite)" being optional and the brief listing only 2, 12, 13, 1.
- Items 4–11, 14–22 — other lanes' scope (their edits already present in the
  working tree from prior lane work; not touched here).
- No new dependencies added, no commits made, no branch created — used the
  existing `cleanup/verified-backlog` checkout as instructed.
- Did not run `scripts/gen_file_map.py` — regeneration is explicitly handled
  by the main session per the brief, even though `live_parsers.py` and
  `test_live_parsers.py` are new files that will need a FILE-MAP entry.
