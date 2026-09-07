# Ruff tighten: fix the 16 suppressed findings, drop the ignores

Follow-up to the first ruff config: it went green by ignoring `W292`, `B007`,
`B011`, `B023`, `B905` (plus `E501`) wholesale. All 16 findings those five
rules were hiding live in `ingest/`. This pass fixes each at the source and
removes the five ignores; `E501` stays (out-of-scope reformat, unrelated to
this pass).

## Mechanical

- **`ingest/test_dispatch.py:102`** — W292, missing trailing newline. Added one.
- **`ingest/test_radio.py` (4 sites, ~48/55/103/108)** — B011, `assert False, "msg"`.
  Replaced each with `raise AssertionError("msg")`, keeping the original message text.
- **`ingest/live_signalr.py:506`** — B007, `for td, content in livedata.get('DriverList')`.
  Confirmed `td` is never read in the loop body; renamed to `_td`.
- **`ingest/record.py:872`** — B007, `for dn, stint_list in hdr['stints'].items()`.
  Confirmed `dn` is never read in the loop body; renamed to `_dn`.

## B023 — closure over loop variable (`ingest/record.py:773/781/783`)

**Verdict: false positive, not a latent bug.** `_behind_ms` is defined inside
the per-frame loop (`for i, t_s in enumerate(t_grid_s):`, starting line 699)
and closes over `t_s`. But it is only ever *called* synchronously within the
same iteration that defines it — at line 795 and line 804, both before the
loop advances to the next `i`/`t_s`. It's never stored, returned, or invoked
after `t_s` moves on, so the late-binding hazard B023 warns about doesn't
actually occur here. It is redefined every iteration (wasteful, but harmless).

Fixed anyway with the cheapest binding rather than leaving it flagged: added
`t_s=t_s` as a default argument, which binds the current frame's value at
function-definition time and shadows the outer name inside the function body.
Same behavior, silences the linter, one-line diff. Added a short comment
explaining why (since the closure being immediately-called isn't obvious from
a quick read).

## B905 — `zip()` without explicit `strict=`

Seven sites, judged individually:

| Site | Verdict | Reasoning |
|---|---|---|
| `check_gap_estimator.py:95` — `zip(gaps, gaps[1:])` | `strict=False` | Classic pairwise-adjacent idiom; the second sequence is deliberately one element shorter by construction. Comment added. |
| `geometry.py:41` — `zip(xy, xy[1:])` in `_cumulative_arc` | `strict=False` | Same pairwise idiom (adjacent-point iteration for arc length). Comment added. |
| `ghost.py:32` — `zip(sample_ts, sample_xy)` | `strict=True` | Docstring states `sample_xy` is "same length as sample_ts" — an explicit invariant. Mismatch should raise, not silently truncate. |
| `record.py:260` — `zip(lap_pos['X']..., lap_pos['Y']...)` | `strict=True` | Both columns pulled from the same `lap_pos` DataFrame — always equal length. |
| `record.py:636` — `zip(xs, ys, idx)` | `strict=True` | `xs`/`ys` are `np.interp(t_grid_s, ...)` outputs (both length `len(t_grid_s)`), and `idx = _nearest_nodes(xs, ys)` builds `out = np.empty(len(xs))` — all three provably equal length. |
| `record.py:647` — `zip(s_raw, in_pit)` | `strict=True` | `s_raw` is a list comprehension over `zip(xs, ys, idx)` (length `len(t_grid_s)`); `in_pit` is a list comprehension over `t_grid_s` directly. Same length by construction. |
| `record.py:656` — `zip(counts, frozen)` | `strict=True` | `counts = wrap_counts(frozen, _LAP_RAW)`, and `wrap_counts` appends exactly one count per input element (1:1 map) — same length as `frozen` by construction. |

No ragged `zip` was found among the seven; all four `strict=True` sites stayed
green through the full test run (see Verification), so none was actually
truncating silently at runtime today — the `strict=True` sites are there to
catch it if that invariant is ever violated in the future.

## `pyproject.toml`

Removed `W292`, `B007`, `B011`, `B023`, `B905` from `ignore`. Rewrote the
comment block: only `E501` remains, with a note that everything else the
config catches has been fixed at the source rather than ignored.

## Verification

1. `python -m ruff check . --extend-select E,W,B --ignore E501 --output-format concise` → no output (all 16 fixed).
2. `python -m ruff check .` (tightened project config) → `All checks passed!`
3. `python -m pytest .` from `ingest/` → `83 passed in 16.37s`. No test failed,
   so none of the `strict=True` zips turned out to be ragged in practice.
4. Did not run `record.py` or perform a recording, per instructions.
