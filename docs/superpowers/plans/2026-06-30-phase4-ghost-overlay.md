# Cross-Year Ghost Overlay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A new `#ghost` route that replays a selected driver's fastest lap from two Monza seasons in sync — this year solid, last year a translucent ghost — with a continuous round-the-lap delta bar.

**Architecture:** The recorder bakes a per-driver **lap trace** (cumulative ms at each track-outline index for the fastest accurate lap) into each clip's header, riding the `Snapshot` exactly like `track`/`radio`. The `#ghost` route dual-subscribes both compare lanes, reads each lane's `lapTrace`, and subtracts the two years entirely on the frontend. Both cars animate along the shared 2024 outline driven by a local looping clock. No `Frame` change, no gateway change. See `docs/adr/0004-ghost-overlay-baked-traces-frontend-delta.md`.

**Tech Stack:** Python (recorder, stdlib-only pure helper), Go (contract + replay source), React/TypeScript + Vite + Vitest (frontend), SVG (map + delta bar).

---

## File structure

- `ingest/ghost.py` — **new** pure helper: `build_lap_trace(sample_ts, sample_xy, track_xy) -> list[int]`. Stdlib-only so the CI contract job (installs only `redis`) can import it.
- `ingest/test_ghost.py` — **new** stdlib self-check for `build_lap_trace`.
- `ingest/record.py` — **modify**: compute per-driver lap traces, add `"lapTrace"` to the clip header.
- `internal/model/model.go` — **modify**: add `LapTrace` to `Snapshot`.
- `internal/feed/replay/play.go` — **modify**: read `lapTrace` from the header, expose `LapTrace()`.
- `internal/app/writer.go` — **modify**: thread `LapTrace()` onto the snapshot.
- `ingest/live.py` — **modify**: accept + emit `lapTrace` in `build_snapshot`.
- `ingest/check_live_contract.py` — **modify**: add `lapTrace` to the asserted key set.
- `.github/workflows/ci.yml` — **modify**: run `python test_ghost.py` in the contract job.
- `web/src/state/race.ts` — **modify**: add `lapTrace` to `RaceState` + wire payload.
- `web/src/state/ghost.ts` — **new** pure FE helpers: `deltaSeries`, `indexAtTime`, `commonDrivers`.
- `web/src/state/ghost.test.ts` — **new** Vitest unit tests.
- `web/src/components/Ghost.tsx` — **new** the `#ghost` route component.
- `web/src/App.tsx` — **modify**: route `#ghost` → `<Ghost/>`, add a nav link.
- `data/replays/monza-2024-race.jsonl`, `monza-2023-race.jsonl`, `silverstone-2024-race.jsonl` — **regenerated** by re-running the recorder.

---

## Task 1: Pure recorder helper `build_lap_trace`

**Files:**
- Create: `ingest/ghost.py`
- Test: `ingest/test_ghost.py`
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Write the failing test**

Create `ingest/test_ghost.py`:

```python
"""Self-check for ingest/ghost.build_lap_trace (no fastf1/numpy/network needed)."""
import sys
from ghost import build_lap_trace

# A 4-point square outline; index 0 = start/finish.
track = [(0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0)]

# A lap that visits each corner in order at t = 10,11,12,13,14s (last sample back at start).
ts = [10.0, 11.0, 12.0, 13.0, 14.0]
xy = [(0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0), (0.0, 0.0)]

trace = build_lap_trace(ts, xy, track)

assert len(trace) == len(track), f"length {len(trace)} != {len(track)}"
assert trace[0] == 0, f"trace[0] must be 0, got {trace[0]}"
# cumulative ms from lap start: corners reached at +0, +1000, +2000, +3000 ms
assert trace == [0, 1000, 2000, 3000], trace
# monotonic non-decreasing
assert all(trace[i] >= trace[i - 1] for i in range(1, len(trace))), trace

# An outline point never visited is carried forward from the previous index.
track2 = [(0.0, 0.0), (0.5, 0.0), (1.0, 0.0)]
ts2 = [0.0, 2.0]
xy2 = [(0.0, 0.0), (1.0, 0.0)]   # the midpoint (0.5,0) is never the nearest
trace2 = build_lap_trace(ts2, xy2, track2)
assert trace2[0] == 0 and trace2[2] == 2000, trace2
assert trace2[1] in (0, 2000), trace2  # carried, not None/crash

print("ghost.build_lap_trace self-check PASSED")
sys.exit(0)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ingest && python test_ghost.py`
Expected: FAIL — `ModuleNotFoundError: No module named 'ghost'`.

- [ ] **Step 3: Write minimal implementation**

Create `ingest/ghost.py`:

```python
"""Pure helper for baking a per-driver lap trace into a clip header.

Kept free of fastf1/numpy/pandas so it is unit-testable and importable in the CI
contract job (which installs only `redis`). The recorder does the FastF1 fetch,
lap selection, and coordinate normalisation, then hands plain lists here.
"""


def build_lap_trace(sample_ts, sample_xy, track_xy):
    """Cumulative lap time (ms from lap start) at each track-outline index.

    sample_ts: lap sample times in seconds, ascending (one reference lap).
    sample_xy: [(x, y)] normalised positions, same length as sample_ts.
    track_xy:  [(x, y)] the baked outline points.

    For each sample (in time order) we find its nearest outline index and record
    the FIRST time that index is reached. Unreached indices carry the previous
    value forward, so the result is length len(track_xy), starts at 0, and is
    monotonic non-decreasing — well-defined to invert (time -> index) later.
    """
    n = len(track_xy)
    t0 = sample_ts[0]
    reached = [None] * n
    for ts, (sx, sy) in zip(sample_ts, sample_xy):
        bi, bd = 0, None
        for i, (tx, ty) in enumerate(track_xy):
            d = (tx - sx) ** 2 + (ty - sy) ** 2
            if bd is None or d < bd:
                bd, bi = d, i
        if reached[bi] is None:
            reached[bi] = round((ts - t0) * 1000)
    trace = []
    last = 0
    for i in range(n):
        if reached[i] is not None and reached[i] >= last:
            last = reached[i]
        trace.append(last)
    return trace
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ingest && python test_ghost.py`
Expected: `ghost.build_lap_trace self-check PASSED`

- [ ] **Step 5: Add the check to CI**

In `.github/workflows/ci.yml`, under the `contract` job, after the existing `radio extraction self-check` step, add:

```yaml
      - name: ghost lap-trace self-check
        run: python test_ghost.py
```

(Match the existing steps' `working-directory`/indentation — the radio step runs `python test_radio.py` the same way.)

- [ ] **Step 6: Commit**

```bash
git add ingest/ghost.py ingest/test_ghost.py .github/workflows/ci.yml
git commit -m "Phase 4: pure build_lap_trace helper + CI self-check"
```

---

## Task 2: Contract — `LapTrace` field end-to-end (Go + Python parity)

**Files:**
- Modify: `internal/model/model.go:47-57`
- Modify: `internal/feed/replay/play.go:16-21`, `:28-37`, `:83`, `:86-89`
- Modify: `internal/app/writer.go:13-19`, `:44-47`
- Modify: `ingest/live.py:47-50`, `:69-72`
- Modify: `ingest/check_live_contract.py:5-9`

- [ ] **Step 1: Write the failing test (Python parity)**

In `ingest/check_live_contract.py`, change `SNAP_KEYS` (line 5) to include `lapTrace`, and update the `build_snapshot` call (line 8-9) to pass a trace map:

```python
SNAP_KEYS = {"session", "mode", "label", "track", "radio", "lapTrace", "cars", "timeMs", "rev"}
FRAME_KEYS = {"session", "rev", "t", "timeMs", "cars"}

snap = build_snapshot("live", "Test", [{"x": 0.1, "y": 0.2}],
                      [{"timeMs": 1000, "driverNum": 1, "clip": "https://x/a.mp3"}],
                      {1: [0, 100, 200]}, 5)
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd ingest && python check_live_contract.py`
Expected: FAIL — `build_snapshot` takes too few/many args, or `snapshot keys ... != ...` (lapTrace missing).

- [ ] **Step 3: Update `live.py`**

In `ingest/live.py`, change `build_snapshot` (around line 47) to accept and emit `lap_trace`:

```python
def build_snapshot(session, label, track, radio, lap_trace, rev):
    return {
        "session": session, "mode": "live", "label": label,
        "track": track, "radio": radio, "lapTrace": lap_trace,
        "cars": {}, "timeMs": 0, "rev": rev,
    }
```

And at the call site (around line 69-72) read it from the header:

```python
    track = header.get("track", [])
    radio = header.get("radio", [])
    lap_trace = header.get("lapTrace", {})
    label = label_override or header.get("label", "Live")
    snapshot = build_snapshot(session, label, track, radio, lap_trace, starting_rev(r, session))
```

Also update the docstring key list near the top of `live.py` (line 11-12) to include `"lapTrace":{...}` alongside `"radio"`.

- [ ] **Step 4: Run the Python check to verify it passes**

Run: `cd ingest && python check_live_contract.py`
Expected: `live.py contract self-check PASSED`

- [ ] **Step 5: Add `LapTrace` to the Go model**

In `internal/model/model.go`, add to the `Snapshot` struct (after the `Radio` field, line 54):

```go
	LapTrace   map[int][]int        `json:"lapTrace,omitempty"`
```

- [ ] **Step 6: Thread it through the replay source**

In `internal/feed/replay/play.go`:

`clipHeader` (after line 20):
```go
	LapTrace map[int][]int        `json:"lapTrace"`
```

`Source` struct (after line 30):
```go
	lapTrace map[int][]int
```

`Load` return (line 83) — add `lapTrace: hdr.LapTrace`:
```go
	return &Source{track: hdr.Track, radio: hdr.Radio, lapTrace: hdr.LapTrace, label: hdr.Label, lines: lines, max: hdr.MaxRev, speed: speed}, nil
```

Accessor (after line 87):
```go
func (s *Source) LapTrace() map[int][]int     { return s.lapTrace }
```

- [ ] **Step 7: Thread it onto the snapshot in the writer**

In `internal/app/writer.go`, add to the `Source` interface (after line 16):
```go
	LapTrace() map[int][]int
```

And in `Run` (after line 46):
```go
	snap.LapTrace = wr.src.LapTrace()
```

- [ ] **Step 8: Run Go tests to verify nothing broke**

Run: `go build ./... && go test ./...`
Expected: PASS (all packages). The new interface method is satisfied by `replay.Source`; compilation proves the wiring.

- [ ] **Step 9: Commit**

```bash
git add internal/model/model.go internal/feed/replay/play.go internal/app/writer.go ingest/live.py ingest/check_live_contract.py
git commit -m "Phase 4: add LapTrace snapshot field (Go + Python parity)"
```

---

## Task 3: Recorder integration + re-bake the clips

**Files:**
- Modify: `ingest/record.py` (header build near line 458; new trace pass after the track outline is built, ~line 225)
- Regenerate: `data/replays/monza-2024-race.jsonl`, `monza-2023-race.jsonl`, `silverstone-2024-race.jsonl`

> Note: this task needs the recorder's environment (the project `.venv` with fastf1/pandas/numpy) and network access for the FastF1 cache. The pure trace logic is already covered by Task 1; this task wires it to real data and re-bakes the committed clips (as Phase 3 did for radio).

- [ ] **Step 1: Add the lap-trace pass in `record.py`**

After the track outline is built (the `track_points` list exists by line 225) and after `normalise(...)` is defined, add a pass that uses `session.laps` and `session.pos_data`. Insert before the JSONL emit section (before line 444):

```python
# ---------------------------------------------------------------------------
# Lap traces (Phase 4): per-driver pace curve over the fastest accurate lap.
# Cumulative ms at each track-outline index, for the cross-year ghost overlay.
# ---------------------------------------------------------------------------
from ghost import build_lap_trace

_outline_xy = [(p['x'], p['y']) for p in track_points]
lap_traces = {}
for num in session.drivers:
    inum = int(num)
    if inum not in driver_info:
        continue
    try:
        accurate = session.laps.pick_drivers(num).pick_accurate()
        if len(accurate) == 0:
            continue
        fastest = accurate.pick_fastest()
        if fastest is None or pd.isna(fastest['LapTime']):
            continue
        lap_start = fastest['LapStartTime']
        lap_end = lap_start + fastest['LapTime']
        pos = session.pos_data[num]
        lap_pos = pos[(pos['SessionTime'] >= lap_start) & (pos['SessionTime'] < lap_end)]
        if len(lap_pos) < 2:
            continue
        sample_ts = lap_pos['SessionTime'].dt.total_seconds().tolist()
        sample_xy = [normalise(row['X'], row['Y']) for _, row in lap_pos.iterrows()]
        lap_traces[inum] = build_lap_trace(sample_ts, sample_xy, _outline_xy)
    except Exception as e:
        print(f"  Warning: no lap trace for {num}: {e}")

print(f"Lap traces baked for {len(lap_traces)} drivers")
```

- [ ] **Step 2: Add `lapTrace` to the header**

In `record.py`, the header dict (line 458-463) becomes:

```python
    header = {
        "track": track_points,
        "label": GP_LABEL,
        "maxRev": max_rev,
        "radio": radio_clips,
        "lapTrace": lap_traces,
    }
```

Also update the header-format comment at the top of `record.py` (lines 7-8) to mention `"lapTrace":{"<num>":[ms,...]}`.

- [ ] **Step 3: Re-bake the three clips**

Run from the repo root (uses the project venv; each takes a few minutes):

```bash
python ingest/record.py --year 2024 --gp Monza      --out data/replays/monza-2024-race.jsonl
python ingest/record.py --year 2023 --gp Monza      --out data/replays/monza-2023-race.jsonl
python ingest/record.py --year 2024 --gp Silverstone --out data/replays/silverstone-2024-race.jsonl
```

Expected: each prints `Lap traces baked for N drivers` (N in the teens/low twenties) before writing.

- [ ] **Step 4: Verify the baked header**

Run (reads only the first line of each clip and asserts the trace shape):

```bash
python - <<'PY'
import json
for f in ["monza-2024", "monza-2023", "silverstone-2024"]:
    with open(f"data/replays/{f}-race.jsonl", encoding="utf-8") as fh:
        hdr = json.loads(fh.readline())
    lt = hdr.get("lapTrace", {})
    n = len(hdr["track"])
    assert lt, f"{f}: no lapTrace"
    for num, tr in lt.items():
        assert len(tr) == n, f"{f}: trace {num} len {len(tr)} != {n}"
        assert tr[0] == 0, f"{f}: trace {num}[0] != 0"
        assert all(tr[i] >= tr[i-1] for i in range(1, n)), f"{f}: trace {num} not monotonic"
    print(f"{f}: {len(lt)} traces, len {n}, OK")
print("Monza 2023 ∩ 2024 common drivers:",
      sorted(set(json.loads(open('data/replays/monza-2023-race.jsonl', encoding='utf-8').readline())['lapTrace'])
             & set(json.loads(open('data/replays/monza-2024-race.jsonl', encoding='utf-8').readline())['lapTrace'])))
PY
```

Expected: three `OK` lines and a non-empty common-driver list (the `#ghost` picker source).

- [ ] **Step 5: Restore the gitkeep if vite touched it, then commit**

```bash
git add ingest/record.py data/replays/monza-2024-race.jsonl data/replays/monza-2023-race.jsonl data/replays/silverstone-2024-race.jsonl
git commit -m "Phase 4: bake per-driver lap traces into the clips"
```

---

## Task 4: Frontend state — carry `lapTrace`

**Files:**
- Modify: `web/src/state/race.ts:12-50`
- Test: `web/src/state/race.test.ts`

- [ ] **Step 1: Write the failing test**

In `web/src/state/race.test.ts`, add (use the existing imports `applyMessage`, `emptyState` already in that file):

```ts
test('snapshot carries lapTrace; emptyState defaults it', () => {
  expect(emptyState().lapTrace).toEqual({});
  const s = applyMessage(emptyState(), {
    type: 'snapshot',
    data: {
      session: 'compare-monza-2024', mode: 'replay', label: 'Monza',
      track: [], cars: {}, timeMs: 0, rev: 1,
      lapTrace: { 1: [0, 100, 200] },
    },
  });
  expect(s.lapTrace[1]).toEqual([0, 100, 200]);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd web && npx vitest run src/state/race.test.ts`
Expected: FAIL — `lapTrace` is `undefined` on `emptyState()` / type error.

- [ ] **Step 3: Add `lapTrace` to the types and folding**

In `web/src/state/race.ts`:

`RaceState` (after `radio` on line 16):
```ts
  lapTrace: Record<number, number[]>;
```

`emptyState()` return (line 20):
```ts
  return { session: '', mode: '', label: '', track: [], cars: {}, timeMs: 0, rev: 0, radio: [], lapTrace: {} };
```

`SnapshotData` (after `radio?` on line 27):
```ts
  lapTrace?: Record<number, number[]>;
```

`applyMessage` snapshot branch (line 39-43) — add `lapTrace`:
```ts
    return {
      session: d.session, mode: d.mode, label: d.label,
      track: d.track ?? [], cars: { ...d.cars }, timeMs: d.timeMs, rev: d.rev,
      radio: d.radio ?? [], lapTrace: d.lapTrace ?? {},
    };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd web && npx vitest run src/state/race.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/state/race.ts web/src/state/race.test.ts
git commit -m "Phase 4: carry lapTrace in frontend race state"
```

---

## Task 5: Frontend pure helpers — delta, inversion, common drivers

**Files:**
- Create: `web/src/state/ghost.ts`
- Test: `web/src/state/ghost.test.ts`

- [ ] **Step 1: Write the failing test**

Create `web/src/state/ghost.test.ts`:

```ts
import { test, expect } from 'vitest';
import { deltaSeries, indexAtTime, commonDrivers } from './ghost';

test('deltaSeries subtracts last-year from this-year, element-wise', () => {
  // this year slower at idx1 (+200ms), faster at idx2 (-100ms)
  expect(deltaSeries([0, 1200, 1900], [0, 1000, 2000])).toEqual([0, 200, -100]);
});

test('deltaSeries clamps to the shorter length', () => {
  expect(deltaSeries([0, 100, 200], [0, 100])).toEqual([0, 0]);
});

test('indexAtTime returns the largest index reached by t (monotonic trace)', () => {
  const tr = [0, 1000, 2000, 3000];
  expect(indexAtTime(tr, 0)).toBe(0);
  expect(indexAtTime(tr, 1500)).toBe(1);
  expect(indexAtTime(tr, 2000)).toBe(2);
  expect(indexAtTime(tr, 99999)).toBe(3); // clamp at end
  expect(indexAtTime(tr, -5)).toBe(0);    // clamp at start
});

test('commonDrivers returns sorted numeric keys present in both', () => {
  expect(commonDrivers({ 1: [], 16: [], 44: [] }, { 16: [], 1: [] })).toEqual([1, 16]);
  expect(commonDrivers({}, { 1: [] })).toEqual([]);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd web && npx vitest run src/state/ghost.test.ts`
Expected: FAIL — cannot resolve `./ghost`.

- [ ] **Step 3: Write the implementation**

Create `web/src/state/ghost.ts`:

```ts
// Pure helpers for the cross-year ghost overlay. The route holds both years'
// lap traces (cumulative ms per track-outline index, baked per clip); these turn
// them into a signed delta and invert a trace (clock -> index) for animation.

// deltaSeries: this-year minus last-year at each index, in ms. Positive = this
// year is slower at that point on the lap. Clamped to the shorter trace.
export function deltaSeries(thisYear: number[], lastYear: number[]): number[] {
  const n = Math.min(thisYear.length, lastYear.length);
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(thisYear[i] - lastYear[i]);
  return out;
}

// indexAtTime: the largest outline index whose cumulative time is <= tMs, for a
// monotonic non-decreasing trace. Clamped to [0, len-1]. Used to place a car.
export function indexAtTime(trace: number[], tMs: number): number {
  if (trace.length === 0) return 0;
  let idx = 0;
  for (let i = 0; i < trace.length; i++) {
    if (trace[i] <= tMs) idx = i;
    else break;
  }
  return idx;
}

// commonDrivers: numeric driver keys present in both trace maps, ascending.
export function commonDrivers(
  a: Record<number, number[]>,
  b: Record<number, number[]>,
): number[] {
  return Object.keys(a)
    .map(Number)
    .filter((n) => b[n] !== undefined)
    .sort((x, y) => x - y);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd web && npx vitest run src/state/ghost.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/state/ghost.ts web/src/state/ghost.test.ts
git commit -m "Phase 4: pure frontend ghost helpers (delta, inversion, common drivers)"
```

---

## Task 6: Frontend `#ghost` route component

**Files:**
- Create: `web/src/components/Ghost.tsx`
- Modify: `web/src/App.tsx:10` (import), `:41` (route), `:52` (nav link)

- [ ] **Step 1: Create the component**

Create `web/src/components/Ghost.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react';
import { connectRace } from '../realtime/socket';
import { emptyState, type RaceState } from '../state/race';
import { teamColour } from './teamColours';
import { commonDrivers, deltaSeries, indexAtTime } from '../state/ghost';

const SIZE = 600;
const BAR_H = 90;
const THIS = { session: 'compare-monza-2024', year: '2024' };
const LAST = { session: 'compare-monza-2023', year: '2023' };

export function Ghost() {
  const [thisYear, setThisYear] = useState<RaceState>(emptyState());
  const [lastYear, setLastYear] = useState<RaceState>(emptyState());
  useEffect(() => connectRace(setThisYear, undefined, THIS.session), []);
  useEffect(() => connectRace(setLastYear, undefined, LAST.session), []);

  const drivers = commonDrivers(thisYear.lapTrace, lastYear.lapTrace);
  const [selected, setSelected] = useState<number | null>(null);
  useEffect(() => {
    if (selected == null && drivers.length) setSelected(drivers[0]);
  }, [drivers, selected]);

  const traceThis = selected != null ? thisYear.lapTrace[selected] : undefined;
  const traceLast = selected != null ? lastYear.lapTrace[selected] : undefined;
  const loopMs =
    traceThis && traceLast
      ? Math.max(traceThis[traceThis.length - 1], traceLast[traceLast.length - 1]) + 800
      : 0;

  // Local looping clock (the route replays the two reference laps; live frames unused).
  const [tMs, setTMs] = useState(0);
  const rafRef = useRef<number | undefined>(undefined);
  const startRef = useRef<number>(0);
  useEffect(() => {
    if (!loopMs) return;
    startRef.current = performance.now();
    const tick = (now: number) => {
      setTMs((now - startRef.current) % loopMs);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [loopMs, selected]);

  const track = thisYear.track;
  const ready = track.length > 0 && !!traceThis && !!traceLast;
  const trackPath = track.length
    ? 'M ' + track.map((p) => `${p.x * SIZE},${p.y * SIZE}`).join(' L ') + ' Z'
    : '';

  const idxThis = ready ? indexAtTime(traceThis!, tMs) : 0;
  const idxLast = ready ? indexAtTime(traceLast!, tMs) : 0;
  const delta = ready ? deltaSeries(traceThis!, traceLast!) : [];
  const dNow = ready ? (delta[idxThis] ?? 0) / 1000 : 0;
  const maxAbs = delta.reduce((m, d) => Math.max(m, Math.abs(d)), 1);

  const car =
    selected != null ? thisYear.cars[selected] ?? lastYear.cars[selected] : undefined;
  const colour = car ? teamColour[car.team] ?? '#bbb' : '#bbb';
  const code = car?.code ?? (selected != null ? String(selected) : '');

  const solid = ready ? track[idxThis] : undefined;
  const ghost = ready ? track[idxLast] : undefined;

  return (
    <div style={{ padding: 24, color: '#eee', background: '#0a0a0a', minHeight: '100vh' }}>
      <h2 style={{ margin: '0 0 16px', display: 'flex', gap: 16, alignItems: 'baseline' }}>
        <span>Ghost overlay · Monza</span>
        <span style={{ color: '#888', fontSize: 14, fontWeight: 400 }}>
          {THIS.year} solid vs {LAST.year} ghost · fastest lap (approx)
        </span>
        <a href="#" style={{ color: '#3671C6', fontSize: 14, fontWeight: 400 }}>← live board</a>
      </h2>

      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 12 }}>
        <label style={{ fontFamily: 'monospace', fontSize: 14 }}>Driver</label>
        <select
          value={selected ?? ''}
          onChange={(e) => setSelected(Number(e.target.value))}
          style={{ background: '#1a1a1a', color: '#eee', border: '1px solid #333', padding: '4px 8px', borderRadius: 6 }}
        >
          {drivers.map((n) => {
            const c = thisYear.cars[n] ?? lastYear.cars[n];
            return <option key={n} value={n}>{c?.code ?? n}</option>;
          })}
        </select>
        {ready && (
          <span style={{ fontFamily: 'monospace', fontSize: 18, color: dNow > 0 ? '#ff5252' : '#4caf50' }}>
            {dNow > 0 ? '+' : ''}{dNow.toFixed(2)}s
          </span>
        )}
      </div>

      {!ready ? (
        <div style={{ width: SIZE, height: SIZE, background: '#111', borderRadius: 12 }} />
      ) : (
        <>
          <svg width={SIZE} height={SIZE} style={{ background: '#111', borderRadius: 12 }}>
            <path d={trackPath} fill="none" stroke="#333" strokeWidth={10} strokeLinejoin="round" />
            <path d={trackPath} fill="none" stroke="#1a1a1a" strokeWidth={6} strokeLinejoin="round" />
            {/* ghost (last year) — translucent */}
            <circle cx={ghost!.x * SIZE} cy={ghost!.y * SIZE} r={7} fill={colour} opacity={0.4} stroke="#000" strokeWidth={1} />
            {/* solid (this year) */}
            <circle cx={solid!.x * SIZE} cy={solid!.y * SIZE} r={7} fill={colour} stroke="#fff" strokeWidth={1.5} />
            <text x={solid!.x * SIZE + 10} y={solid!.y * SIZE + 4} fill="#eee" fontSize={11}>{code}</text>
          </svg>

          {/* delta bar: red above the midline = this year slower, green below = faster */}
          <svg width={SIZE} height={BAR_H} style={{ background: '#111', borderRadius: 12, marginTop: 12, display: 'block' }}>
            <line x1={0} y1={BAR_H / 2} x2={SIZE} y2={BAR_H / 2} stroke="#444" strokeWidth={1} />
            {delta.map((d, i) => {
              const h = (Math.abs(d) / maxAbs) * (BAR_H / 2);
              const x = (i / delta.length) * SIZE;
              const y = d > 0 ? BAR_H / 2 - h : BAR_H / 2;
              return <rect key={i} x={x} y={y} width={Math.max(1, SIZE / delta.length)} height={h} fill={d > 0 ? '#ff5252' : '#4caf50'} />;
            })}
            {/* playback cursor at this-year's current fraction */}
            <line x1={(idxThis / delta.length) * SIZE} y1={0} x2={(idxThis / delta.length) * SIZE} y2={BAR_H} stroke="#fff" strokeWidth={1.5} />
          </svg>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Wire the route in `App.tsx`**

Add the import (after line 10, `import { Compare } ...`):
```tsx
import { Ghost } from './components/Ghost';
```

Add the route (after line 41, the `#compare` line):
```tsx
  if (hash === '#ghost') return <Ghost />;
```

Add a nav link next to the compare link (after line 52):
```tsx
          <a href="#ghost" style={{ color: '#3671C6', fontSize: 13, fontWeight: 400 }}>Ghost overlay →</a>
```

- [ ] **Step 3: Lint + build + tests**

Run: `cd web && npm run lint -- --max-warnings 0 && npm run build && npm test`
Expected: lint clean, build succeeds, all Vitest suites pass.

> Build gotcha (memory `f1-build-gotchas`): `npm run build` (vite) deletes the tracked `web/dist/.gitkeep` the Go embed relies on. Restore it before committing: `git checkout -- web/dist/.gitkeep` (or `git status` and re-add it). Never commit its deletion.

- [ ] **Step 4: Manual verification in the running app**

```bash
docker compose up --build -d
```
Open http://localhost:8080/#ghost. Confirm: a driver dropdown (populated from drivers in both years), one map with a solid car and a translucent ghost moving at different paces round the lap, a red/green delta bar with a moving white cursor, and a signed `±N.NNs` readout. Switch drivers; confirm it re-syncs. (The two cars pulling apart and rejoining each lap is the intended "ghost lap" behaviour.)

- [ ] **Step 5: Commit**

```bash
git checkout -- web/dist/.gitkeep 2>/dev/null || true
git add web/src/components/Ghost.tsx web/src/App.tsx
git commit -m "Phase 4: #ghost route — reference-lap player with delta bar"
```

---

## Self-review notes (for the executor)

- **Spec coverage:** Task 1 = lap-trace logic; Task 2 = `LapTrace` contract; Task 3 = recorder bake + re-record; Task 4 = FE state; Task 5 = FE delta/inversion/picker logic; Task 6 = the route (map + ghost + delta bar + picker + looping clock). Edge cases from the spec: missing-driver → handled by `commonDrivers` (only offers drivers in both) + the `!ready` guard; monotonicity → enforced in `build_lap_trace` and asserted in Task 3 Step 4.
- **Type consistency:** `lapTrace` is `Record<number, number[]>` in TS / `map[int][]int` in Go / a `{int: [int]}` dict in Python throughout. `build_lap_trace` / `build_snapshot` signatures match their call sites and tests.
- **No placeholders:** every code step has complete code; every run step has an expected result.
- **Approximations are labelled** in the UI ("fastest lap (approx)"), consistent with gap/interval/radio and ADR-0004.
```
