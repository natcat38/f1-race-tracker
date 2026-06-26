# Phase 3 — Team-Radio Comms Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a toggleable **comms layer** that auto-plays driver↔engineer **team radio** as the replay clock reaches each clip's moment, with audio streamed straight from F1's public URL (nothing committed or downloaded).

**Architecture:** Team radio is a sparse, fixed timeline, so it rides the **snapshot** only (like `Track`), not every frame. The recorder bakes `[{timeMs, driverNum, clip}]` into the clip header; the Go replay writer and the Python live publisher each thread it header→snapshot; the React app reads `snapshot.radio`, schedules auto-play against the frame clock with a guarded FIFO queue, and plays each clip via a native `<audio>` element. No new gateway routes, no proxy, no audio library.

**Tech Stack:** Go (contract + replay writer), Python (FastF1 recorder + live publisher), React/TypeScript + Vite/Vitest (frontend).

**Spec:** `docs/superpowers/specs/2026-06-26-phase3-team-radio-design.md`. **Glossary:** `CONTEXT.md` (Team radio, Comms). **Decision:** `docs/adr/0003-team-radio-streamed-not-committed.md`.

**Conventions in this repo (read before starting):**
- Go tests: `go test ./...`. Web tests: `cd web && npm test` (Vitest). Python self-checks are plain assert scripts run with `python <file>.py` (no pytest) — mirroring `ingest/check_live_contract.py`.
- The contract is defined three times and must stay in lockstep: `internal/model/model.go` (canonical), `ingest/` (Python), `web/src/state/race.ts` (TS).
- `npm run build` (vite) deletes the tracked `web/dist/.gitkeep`; if it vanishes, `git restore web/dist/.gitkeep` — never commit its deletion.
- Commit after every green task.

---

### Task 1: Contract — `RadioMessage` type + `Snapshot.Radio` (Go)

**Files:**
- Modify: `internal/model/model.go` (add type after `RaceControlMessage` ~line 39; add field to `Snapshot` ~line 47)
- Test: `internal/model/model_test.go`

- [ ] **Step 1: Write the failing test**

Add to `internal/model/model_test.go`:

```go
func TestSnapshotRoundTripWithRadio(t *testing.T) {
	in := NewSnapshot("replay", "replay", "Monza 2024 · Race")
	in.Radio = []RadioMessage{
		{TimeMs: 3300500, DriverNum: 1, Clip: "https://livetiming.formula1.com/x/VER_1.mp3"},
		{TimeMs: 3301000, DriverNum: 16, Clip: "https://livetiming.formula1.com/x/LEC_16.mp3"},
	}
	b, err := json.Marshal(in)
	if err != nil {
		t.Fatal(err)
	}
	var out Snapshot
	if err := json.Unmarshal(b, &out); err != nil {
		t.Fatal(err)
	}
	if len(out.Radio) != 2 || out.Radio[1].DriverNum != 16 || out.Radio[0].Clip == "" {
		t.Fatalf("radio round-trip wrong: %+v", out.Radio)
	}
}

func TestSnapshotOmitsEmptyRadio(t *testing.T) {
	b, err := json.Marshal(NewSnapshot("replay", "replay", "x"))
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(b), "radio") {
		t.Fatalf("empty radio should be omitted, got %s", b)
	}
}
```

If `strings` is not already imported in the test file, add it to the import block.

- [ ] **Step 2: Run test to verify it fails**

Run: `go test ./internal/model/ -run TestSnapshot -v`
Expected: FAIL — `Radio` undefined on `Snapshot`.

- [ ] **Step 3: Add the type and field**

In `internal/model/model.go`, after the `RaceControlMessage` struct (line 39), add:

```go
type RadioMessage struct {
	TimeMs    int64  `json:"timeMs"`    // session clock at which the team radio occurred
	DriverNum int    `json:"driverNum"` // FE derives code/team/colour from the cars map
	Clip      string `json:"clip"`      // full https URL to the .mp3 on livetiming.formula1.com
}
```

In the `Snapshot` struct, add this field after `Messages` (line 47):

```go
	Radio      []RadioMessage       `json:"radio,omitempty"`
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `go test ./internal/model/ -run TestSnapshot -v`
Expected: PASS (both).

- [ ] **Step 5: Commit**

```bash
git add internal/model/model.go internal/model/model_test.go
git commit -m "feat(contract): add RadioMessage + Snapshot.Radio"
```

---

### Task 2: Replay path — thread radio header→snapshot (Go)

**Files:**
- Modify: `internal/feed/replay/play.go` (`clipHeader` line 16; `Source` struct line 27; `Load` return line 81; add accessor near line 84)
- Modify: `internal/app/writer.go` (`Source` interface line 13; set `snap.Radio` near line 44)
- Test: `internal/feed/replay/play_test.go`

- [ ] **Step 1: Write the failing test**

Add to `internal/feed/replay/play_test.go` (write a tiny clip to a temp file and load it):

```go
func TestLoadParsesRadioFromHeader(t *testing.T) {
	clip := `{"track":[{"x":0.1,"y":0.2}],"label":"T","maxRev":1,"radio":[{"timeMs":3300500,"driverNum":1,"clip":"https://x/VER.mp3"}]}
{"timeMs":3300000,"frame":{"rev":1,"timeMs":3300000,"cars":[{"driverNum":1,"code":"VER","team":"Red Bull","pos":1,"p":{"x":0.1,"y":0.2},"status":"OnTrack"}]}}
`
	path := filepath.Join(t.TempDir(), "clip.jsonl")
	if err := os.WriteFile(path, []byte(clip), 0o600); err != nil {
		t.Fatal(err)
	}
	src, err := Load(path, 1)
	if err != nil {
		t.Fatal(err)
	}
	radio := src.Radio()
	if len(radio) != 1 || radio[0].DriverNum != 1 || radio[0].TimeMs != 3300500 {
		t.Fatalf("radio not parsed: %+v", radio)
	}
}
```

Ensure `path/filepath`, `os` are imported in the test file (add any missing).

- [ ] **Step 2: Run test to verify it fails**

Run: `go test ./internal/feed/replay/ -run TestLoadParsesRadio -v`
Expected: FAIL — `src.Radio` undefined.

- [ ] **Step 3: Implement parsing + accessor**

In `internal/feed/replay/play.go`:

Add `Radio` to `clipHeader` (line 16 struct):

```go
type clipHeader struct {
	Track  []model.Point        `json:"track"`
	Label  string               `json:"label"`
	MaxRev int64                `json:"maxRev"`
	Radio  []model.RadioMessage `json:"radio"`
}
```

Add a field to `Source` (line 27 struct), after `track`:

```go
	radio []model.RadioMessage
```

In `Load`, set it on the returned `Source` (line 81) — change the return to include `radio: hdr.Radio`:

```go
	return &Source{track: hdr.Track, radio: hdr.Radio, label: hdr.Label, lines: lines, max: hdr.MaxRev, speed: speed}, nil
```

Add the accessor next to `Track()` (line 84):

```go
func (s *Source) Radio() []model.RadioMessage { return s.radio }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `go test ./internal/feed/replay/ -run TestLoadParsesRadio -v`
Expected: PASS.

- [ ] **Step 5: Wire it into the writer**

In `internal/app/writer.go`, add `Radio()` to the `Source` interface (line 13):

```go
type Source interface {
	Events(ctx context.Context) (<-chan model.Frame, error)
	Track() []model.Point
	Radio() []model.RadioMessage
	Label() string
	Mode() string
}
```

And set it on the snapshot right after `snap.Track` (line 44):

```go
	snap.Track = wr.src.Track()
	snap.Radio = wr.src.Radio()
```

- [ ] **Step 6: Run the whole Go suite**

Run: `go test ./...`
Expected: PASS. (If `internal/app` has a mock/fake `Source` in a `_test.go` file, add a `Radio() []model.RadioMessage { return nil }` method to it so it still satisfies the interface. Search: `grep -rn "func.*Track() \[\]model.Point" internal/app`.)

- [ ] **Step 7: Commit**

```bash
git add internal/feed/replay/play.go internal/feed/replay/play_test.go internal/app/writer.go
git commit -m "feat(replay): thread team radio from clip header into snapshot"
```

---

### Task 3: Live path — thread radio in `live.py` + parity check (Python)

**Files:**
- Modify: `ingest/live.py` (`build_snapshot` line 47; `publish_clip` line 69-71)
- Modify: `ingest/check_live_contract.py` (SNAP_KEYS line 5; call line 8)

- [ ] **Step 1: Update the parity check first (this is the failing test)**

In `ingest/check_live_contract.py`, add `"radio"` to `SNAP_KEYS` and pass it to the call:

```python
SNAP_KEYS = {"session", "mode", "label", "track", "radio", "cars", "timeMs", "rev"}
```

```python
snap = build_snapshot("live", "Test", [{"x": 0.1, "y": 0.2}],
                      [{"timeMs": 1000, "driverNum": 1, "clip": "https://x/a.mp3"}], 5)
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd ingest && python check_live_contract.py`
Expected: FAIL — `build_snapshot()` takes 4 positional args but 5 given (signature mismatch).

- [ ] **Step 3: Add radio to `build_snapshot` and pass it through**

In `ingest/live.py`, change `build_snapshot` (line 47):

```python
def build_snapshot(session, label, track, radio, rev):
    return {
        "session": session, "mode": "live", "label": label,
        "track": track, "radio": radio, "cars": {}, "timeMs": 0, "rev": rev,
    }
```

In `publish_clip` (lines 69-71), read radio from the header and pass it in:

```python
    track = header.get("track", [])
    radio = header.get("radio", [])
    label = label_override or header.get("label", "Live")
    snapshot = build_snapshot(session, label, track, radio, starting_rev(r, session))
```

- [ ] **Step 4: Run the parity check to verify it passes**

Run: `cd ingest && python check_live_contract.py`
Expected: `live.py contract self-check PASSED`.

- [ ] **Step 5: Commit**

```bash
git add ingest/live.py ingest/check_live_contract.py
git commit -m "feat(live): pass team radio from clip header into the live snapshot"
```

---

### Task 4: Recorder — radio extraction module (Python, pure + TDD)

A pure, dependency-free module so the `Utc`→session-ms mapping and window filter are unit-testable without FastF1 or the network.

**Files:**
- Create: `ingest/radio.py`
- Create: `ingest/test_radio.py`

- [ ] **Step 1: Write the failing test**

Create `ingest/test_radio.py`:

```python
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
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd ingest && python test_radio.py`
Expected: FAIL — `ModuleNotFoundError: No module named 'radio'`.

- [ ] **Step 3: Implement `ingest/radio.py`**

```python
"""Pure helpers for baking team radio into a clip header.

Kept free of fastf1/pandas so it is unit-testable and importable in the CI
contract job (which installs only `redis`). The recorder does the FastF1 fetch
and tz handling, then hands plain dicts here.
"""
from datetime import datetime, timezone


def _utc_to_session_ms(utc_str, t0_epoch_s):
    """Map an ISO-8601 UTC instant (e.g. '2024-09-01T12:24:46.541Z') to session
    milliseconds, where t0_epoch_s is session-time zero as a UTC epoch second."""
    dt = datetime.fromisoformat(utc_str.replace("Z", "+00:00")).astimezone(timezone.utc)
    return round((dt.timestamp() - t0_epoch_s) * 1000)


def extract_radio(captures, t0_epoch_s, window_start_s, window_end_s, base_url, api_path):
    """captures: list of {'Utc','RacingNumber','Path'} from FastF1's team_radio feed.
    Returns [{timeMs, driverNum, clip}] for captures inside the window, sorted by time."""
    out = []
    for cap in captures:
        time_ms = _utc_to_session_ms(cap["Utc"], t0_epoch_s)
        if window_start_s * 1000 <= time_ms < window_end_s * 1000:
            out.append({
                "timeMs": time_ms,
                "driverNum": int(cap["RacingNumber"]),
                "clip": base_url + api_path + cap["Path"],
            })
    out.sort(key=lambda m: m["timeMs"])
    return out
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd ingest && python test_radio.py`
Expected: `radio.extract_radio self-check PASSED`.

- [ ] **Step 5: Wire the self-check into CI**

In `.github/workflows/ci.yml`, in the `contract` job after the existing `check_live_contract.py` step (line 57-59), add:

```yaml
      - name: radio extraction self-check
        run: python test_radio.py
        working-directory: ingest
```

- [ ] **Step 6: Commit**

```bash
git add ingest/radio.py ingest/test_radio.py .github/workflows/ci.yml
git commit -m "feat(ingest): pure team-radio extraction helper + self-check in CI"
```

---

### Task 5: Recorder — fetch radio, widen window, emit + validate (Python)

**Files:**
- Modify: `ingest/record.py` (imports ~line 22; window constant line 56; header build line 432; size warning line 543; header validation line 560)

- [ ] **Step 1: Widen the window**

Change `ingest/record.py` line 56-57:

```python
# Window: 7.5-min green-flag mid-race window (widened from 2.5 min in Phase 3 so the
# comms layer has enough team radio to feel alive — see ADR-0003 / Phase 3 spec).
WINDOW_START_S = 3300   # 55 min into session
WINDOW_END_S   = 3750   # 62.5 min  (7.5-min window)
```

- [ ] **Step 2: Fetch + extract radio after the session loads**

In `ingest/record.py`, add the import near the top (after line 29, `from pathlib import Path`):

```python
from fastf1 import _api
from radio import extract_radio
```

After the driver-info block (after line 106, the `for num, info in sorted(driver_info...)` print loop), add:

```python
# ---------------------------------------------------------------------------
# Team radio (Phase 3): baked into the header as [{timeMs, driverNum, clip}].
# Streamed from F1's public URL at play time, never stored (ADR-0003).
# ---------------------------------------------------------------------------
print("\nFetching team radio...")
radio_clips = []
try:
    raw = _api.fetch_page(session.api_path, "team_radio")  # list of [ts, content]
    captures = []
    for _ts, content in raw:
        caps = content.get("Captures") if isinstance(content, dict) else None
        if caps:
            captures.extend(caps.values() if isinstance(caps, dict) else caps)
    t0_epoch_s = pd.Timestamp(session.t0_date).tz_localize("UTC").timestamp()
    radio_clips = extract_radio(
        captures, t0_epoch_s, WINDOW_START_S, WINDOW_END_S,
        _api.base_url, session.api_path,
    )
    print(f"Team radio: {len(captures)} captures in session, {len(radio_clips)} in window")
except Exception as e:
    print(f"  Warning: team radio fetch failed ({e}); clip will have no radio")
```

- [ ] **Step 3: Emit radio in the header**

Change the header dict in `ingest/record.py` (lines 432-436):

```python
    header = {
        "track": track_points,
        "label": GP_LABEL,
        "maxRev": max_rev,
        "radio": radio_clips,
    }
```

- [ ] **Step 4: Raise the file-size warning ceiling**

The 7.5-min Monza clip is ~23 MB by design. Change `ingest/record.py` line 543-544:

```python
if size_mb > 25.0:
    print(f"WARNING: File exceeds 25 MB! Consider trimming the window or reducing Hz.")
```

- [ ] **Step 5: Validate the radio header field**

In the header-validation block of `ingest/record.py`, after the `maxRev` assertion (line 570), add:

```python
    assert 'radio' in hdr, "header missing 'radio'"
    assert isinstance(hdr['radio'], list), "radio must be a list"
    for rm in hdr['radio']:
        assert {'timeMs', 'driverNum', 'clip'} <= set(rm.keys()), f"radio item missing fields: {rm}"
        assert WINDOW_START_S * 1000 <= rm['timeMs'] < WINDOW_END_S * 1000, f"radio timeMs out of window: {rm}"
        assert rm['clip'].startswith('http'), f"radio clip not a URL: {rm}"
```

And extend the success print (line 571):

```python
    print(f"  Header OK: {len(hdr['track'])} track points, maxRev={hdr['maxRev']}, {len(hdr['radio'])} radio clips")
```

- [ ] **Step 6: Update the contract docstring**

In the module docstring of `ingest/record.py` (line 7), update the header-line description:

```
  Header line: {"track":[{"x":float,"y":float},...], "label":"...", "maxRev":int,
                "radio":[{"timeMs":int,"driverNum":int,"clip":"https://..."}]}
```

- [ ] **Step 7: Commit (recorder logic only — clips re-baked in Task 6)**

```bash
git add ingest/record.py
git commit -m "feat(record): bake team radio into clip header; widen window to 7.5 min"
```

---

### Task 6: Re-bake the committed clips

Network + FastF1 cache required. This regenerates the binary clips; expect Monza 2024 to grow ~7.8 MB → ~23 MB. Monza 2023 must be re-baked too so the compare lanes stay phase-aligned (identical window length).

- [ ] **Step 1: Re-bake Monza 2024 (default replay)**

Run:
```bash
.venv/Scripts/python.exe ingest/record.py data/replays/monza-2024-race.jsonl --year 2024 --gp Monza --session R --label "Monza 2024 · Race"
```
Expected: ends with `Contract validation PASSED` and `Header OK: ... ~5 radio clips`. If the radio count is 0, stop and investigate (the window or fetch failed) — do not commit an empty layer.

- [ ] **Step 2: Re-bake Monza 2023 (compare phase parity)**

Run:
```bash
.venv/Scripts/python.exe ingest/record.py data/replays/monza-2023-race.jsonl --year 2023 --gp Monza --session R --label "Monza 2023 · Race"
```
Expected: `Contract validation PASSED`.

- [ ] **Step 3: Re-bake Silverstone 2024 (live lane)**

Run:
```bash
.venv/Scripts/python.exe ingest/record.py data/replays/silverstone-2024-race.jsonl --year 2024 --gp Silverstone --session R --label "Silverstone 2024 · Race"
```
Expected: `Contract validation PASSED`. Note the radio count — if Silverstone's widened window is sparse, that's acceptable (live-lane radio is a bonus, not a goal).

- [ ] **Step 4: Verify radio is present in a baked clip**

Run:
```bash
head -c 400 data/replays/monza-2024-race.jsonl
```
Expected: the header line contains a non-empty `"radio":[{"timeMs":...,"driverNum":...,"clip":"https://livetiming.formula1.com/..."}]`.

- [ ] **Step 5: Commit the re-baked clips**

```bash
git add data/replays/monza-2024-race.jsonl data/replays/monza-2023-race.jsonl data/replays/silverstone-2024-race.jsonl
git commit -m "data: re-bake clips with team radio (7.5-min window)"
```

---

### Task 7: Frontend state — parse `radio` into `RaceState` (TS)

**Files:**
- Modify: `web/src/state/race.ts`
- Test: `web/src/state/race.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `web/src/state/race.test.ts`:

```ts
import { applyMessage, emptyState } from './race';

test('snapshot carries the radio timeline', () => {
  const s = applyMessage(emptyState(), {
    type: 'snapshot',
    data: {
      session: 'replay', mode: 'replay', label: 'M', cars: {}, timeMs: 3300000, rev: 1,
      radio: [{ timeMs: 3300500, driverNum: 1, clip: 'https://x/VER.mp3' }],
    },
  });
  expect(s.radio).toHaveLength(1);
  expect(s.radio[0].driverNum).toBe(1);
});

test('a frame does not clobber the radio timeline', () => {
  const s0 = applyMessage(emptyState(), {
    type: 'snapshot',
    data: {
      session: 'replay', mode: 'replay', label: 'M', cars: {}, timeMs: 3300000, rev: 1,
      radio: [{ timeMs: 3300500, driverNum: 1, clip: 'https://x/VER.mp3' }],
    },
  });
  const s1 = applyMessage(s0, { type: 'frame', data: { rev: 2, timeMs: 3300100, cars: [] } });
  expect(s1.radio).toHaveLength(1);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd web && npm test -- race.test`
Expected: FAIL — `radio` missing on the state type / undefined.

- [ ] **Step 3: Add radio to the types and `applyMessage`**

In `web/src/state/race.ts`:

Add an interface above `RaceState` (after `Car`, ~line 11):

```ts
export interface RadioMessage { timeMs: number; driverNum: number; clip: string }
```

Add `radio` to `RaceState` (line 12-15):

```ts
export interface RaceState {
  session: string; mode: string; label: string;
  track: Point[]; cars: Record<number, Car>; timeMs: number; rev: number;
  radio: RadioMessage[];
}
```

Add it to `emptyState` (line 18):

```ts
  return { session: '', mode: '', label: '', track: [], cars: {}, timeMs: 0, rev: 0, radio: [] };
```

Add `radio` to `SnapshotData` (line 22-25):

```ts
interface SnapshotData {
  session: string; mode: string; label: string;
  track?: Point[]; cars: Record<number, Car>; timeMs: number; rev: number;
  radio?: RadioMessage[];
}
```

In `applyMessage`, set it from the snapshot (line 36-39):

```ts
    return {
      session: d.session, mode: d.mode, label: d.label,
      track: d.track ?? [], cars: { ...d.cars }, timeMs: d.timeMs, rev: d.rev,
      radio: d.radio ?? [],
    };
```

(The frame branch already spreads `...s`, so `radio` is preserved across frames with no change.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && npm test -- race.test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/state/race.ts web/src/state/race.test.ts
git commit -m "feat(web): parse team radio timeline from the snapshot"
```

---

### Task 8: Frontend — comms scheduling core (pure TS + TDD)

The cursor/queue logic — the spec's required correctness test. Pure functions, no React, no audio.

**Files:**
- Create: `web/src/state/comms.ts`
- Test: `web/src/state/comms.test.ts`

- [ ] **Step 1: Write the failing test**

Create `web/src/state/comms.test.ts`:

```ts
import { describe, test, expect } from 'vitest';
import { stepComms, type CommsCursor } from './comms';
import type { RadioMessage } from './race';

const tl: RadioMessage[] = [
  { timeMs: 100, driverNum: 1, clip: 'a' },
  { timeMs: 200, driverNum: 16, clip: 'b' },
  { timeMs: 5000, driverNum: 4, clip: 'c' },
];

describe('stepComms', () => {
  test('init from snapshot: earlier messages are history, not fired', () => {
    const { cursor, fired, history } = stepComms({ lastClock: -1 }, 150, tl, true);
    expect(fired).toEqual([]);                 // nothing auto-plays on connect
    expect(history.map((m) => m.driverNum)).toEqual([1]); // 100 <= 150 -> history
    expect(cursor.lastClock).toBe(150);
  });

  test('steady state fires messages crossed since lastClock', () => {
    const { cursor, fired } = stepComms({ lastClock: 150 }, 250, tl, false);
    expect(fired.map((m) => m.driverNum)).toEqual([16]); // 150 < 200 <= 250
    expect(cursor.lastClock).toBe(250);
  });

  test('loop (clock jumps back) resets cursor without firing', () => {
    const { cursor, fired } = stepComms({ lastClock: 5000 }, 120, tl, false);
    expect(fired).toEqual([]);
    expect(cursor.lastClock).toBe(120);
  });

  test('multiple crossed in one step fire in time order', () => {
    const { fired } = stepComms({ lastClock: 50 }, 250, tl, false);
    expect(fired.map((m) => m.timeMs)).toEqual([100, 200]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd web && npm test -- comms.test`
Expected: FAIL — cannot find `./comms`.

- [ ] **Step 3: Implement `web/src/state/comms.ts`**

```ts
import type { RadioMessage } from './race';

export interface CommsCursor { lastClock: number }

export interface CommsStep {
  cursor: CommsCursor;
  fired: RadioMessage[];   // messages to enqueue for auto-play this step
  history: RadioMessage[]; // messages to add to history (silent) — only on snapshot init
}

// stepComms advances the cursor by one frame/snapshot and decides what to play.
// One rule drives steady-state, connect, and loop:
//   - isSnapshot: init lastClock = clock; messages at/before clock go to history, none fire.
//   - clock < lastClock (loop): reset lastClock = clock, fire nothing.
//   - otherwise (steady): fire messages with lastClock < timeMs <= clock, in time order.
export function stepComms(
  cursor: CommsCursor,
  clock: number,
  timeline: RadioMessage[],
  isSnapshot: boolean,
): CommsStep {
  if (isSnapshot) {
    const history = timeline.filter((m) => m.timeMs <= clock).sort((a, b) => a.timeMs - b.timeMs);
    return { cursor: { lastClock: clock }, fired: [], history };
  }
  if (clock < cursor.lastClock) {
    return { cursor: { lastClock: clock }, fired: [], history: [] };
  }
  const fired = timeline
    .filter((m) => m.timeMs > cursor.lastClock && m.timeMs <= clock)
    .sort((a, b) => a.timeMs - b.timeMs);
  return { cursor: { lastClock: clock }, fired, history: [] };
}

// isStale reports whether a queued clip has fallen too far behind the race clock to
// auto-play (it is still shown in history). Best-effort sync, ~3s tolerance.
export function isStale(msg: RadioMessage, currentClock: number, toleranceMs = 3000): boolean {
  return currentClock - msg.timeMs > toleranceMs;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && npm test -- comms.test`
Expected: PASS (all four).

- [ ] **Step 5: Commit**

```bash
git add web/src/state/comms.ts web/src/state/comms.test.ts
git commit -m "feat(web): pure comms scheduling core (cursor + loop + staleness)"
```

---

### Task 9: Frontend — comms hook with audio playback (React/TS)

Wires the pure core to a single `<audio>` element with a FIFO queue. The toggle is the user gesture that unlocks autoplay.

**Files:**
- Create: `web/src/hooks/useComms.ts`

- [ ] **Step 1: Implement the hook**

Create `web/src/hooks/useComms.ts`:

```ts
import { useEffect, useRef, useState } from 'react';
import type { RaceState, RadioMessage } from '../state/race';
import { stepComms, isStale, type CommsCursor } from '../state/comms';

const HISTORY_MAX = 6;

// useComms drives the comms layer from the race state. It tracks the play cursor,
// queues fired clips into one <audio> element (FIFO), skips clips that have gone
// stale vs the race clock, and keeps a short newest-first history. `enabled` gates
// auto-play; the toggle click is the user gesture that satisfies autoplay policy.
export function useComms(state: RaceState, enabled: boolean) {
  const [nowPlaying, setNowPlaying] = useState<RadioMessage | null>(null);
  const [history, setHistory] = useState<RadioMessage[]>([]);
  // All refs declared before pump() so nothing is used-before-defined (lint gate).
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const cursorRef = useRef<CommsCursor>({ lastClock: -1 });
  const queueRef = useRef<RadioMessage[]>([]);
  const lastRevRef = useRef<number>(-1);
  const nowPlayingRef = useRef<RadioMessage | null>(null);
  const clockRef = useRef<number>(0); // latest race clock, read by pump's staleness check

  if (!audioRef.current && typeof Audio !== 'undefined') {
    audioRef.current = new Audio();
  }

  function pump() {
    const audio = audioRef.current;
    if (!audio || nowPlayingRef.current) return;
    let next = queueRef.current.shift();
    // Drop clips that have fallen too far behind the race clock (kept in history).
    while (next && isStale(next, clockRef.current)) next = queueRef.current.shift();
    if (!next) return;
    nowPlayingRef.current = next;
    setNowPlaying(next);
    audio.src = next.clip; // ponytail: no crossOrigin attr -> plays cross-origin without CORS
    audio.play().catch(() => { nowPlayingRef.current = null; setNowPlaying(null); });
  }

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onEnded = () => { nowPlayingRef.current = null; setNowPlaying(null); pump(); };
    audio.addEventListener('ended', onEnded);
    return () => audio.removeEventListener('ended', onEnded);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // On each state change, advance the cursor and enqueue fired clips.
  useEffect(() => {
    if (state.rev === 0) return;
    clockRef.current = state.timeMs;
    const justConnected = lastRevRef.current === -1; // seed history once on first snapshot
    lastRevRef.current = state.rev;

    const { cursor, fired, history: hist } = stepComms(
      cursorRef.current, state.timeMs, state.radio, justConnected,
    );
    cursorRef.current = cursor;

    if (justConnected && hist.length) {
      setHistory(hist.slice(-HISTORY_MAX).reverse()); // newest first
    }
    if (fired.length) {
      // history tracks regardless of enabled; only enabled enqueues audio.
      setHistory((h) => [...[...fired].reverse(), ...h].slice(0, HISTORY_MAX));
      if (enabled) {
        queueRef.current.push(...fired);
        pump();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.rev]);

  // Stop audio + clear the queue when the layer is switched off.
  useEffect(() => {
    if (enabled) return;
    queueRef.current = [];
    audioRef.current?.pause();
    nowPlayingRef.current = null;
    setNowPlaying(null);
  }, [enabled]);

  function replay(msg: RadioMessage) {
    const audio = audioRef.current;
    if (!audio) return;
    queueRef.current = []; // manual replay jumps the queue
    nowPlayingRef.current = msg;
    setNowPlaying(msg);
    audio.src = msg.clip;
    audio.play().catch(() => { nowPlayingRef.current = null; setNowPlaying(null); });
  }

  return { nowPlaying, history, replay };
}
```

**Known limitation (ponytail):** Rev is monotonic and never resets (CONTEXT.md), so a *reconnect* snapshot mid-replay can't be told apart from a frame by rev — `justConnected` only seeds history on the very first snapshot. A reconnect could therefore enqueue a small batch, but the staleness skip drops anything >3 s behind the clock, so at most one near-current clip plays. Acceptable for a best-effort demo layer.

- [ ] **Step 2: Type-check**

Run: `cd web && npm run build`
Expected: builds clean (tsc passes). If `web/dist/.gitkeep` disappears, run `git restore web/dist/.gitkeep`.

- [ ] **Step 3: Commit**

```bash
git add web/src/hooks/useComms.ts web/dist/.gitkeep
git commit -m "feat(web): useComms hook — FIFO audio queue with staleness skip"
```

---

### Task 10: Frontend — Comms UI component + wire into App

**Files:**
- Create: `web/src/components/teamColours.ts`
- Create: `web/src/components/Comms.tsx`
- Modify: `web/src/components/Map.tsx` (use the shared colours)
- Modify: `web/src/App.tsx`

- [ ] **Step 1: Extract the shared team-colour lookup**

Create `web/src/components/teamColours.ts` (move the map out of `Map.tsx`):

```ts
export const teamColour: Record<string, string> = {
  'Red Bull': '#3671C6', Ferrari: '#E8002D', Mercedes: '#27F4D2', McLaren: '#FF8000',
  'Aston Martin': '#229971', Alpine: '#0093CC', Williams: '#64C4FF',
  RB: '#6692FF', 'Kick Sauber': '#52E252', Haas: '#B6BABD',
  AlphaTauri: '#2B4562', 'Alfa Romeo': '#C92D4B',
};
```

In `web/src/components/Map.tsx`, delete the local `teamColour` const (lines 5-10) and import it instead:

```ts
import { teamColour } from './teamColours';
```

- [ ] **Step 2: Build the Comms component**

Create `web/src/components/Comms.tsx`:

```tsx
import { useState } from 'react';
import type { RaceState } from '../state/race';
import { useComms } from '../hooks/useComms';
import { teamColour } from './teamColours';

// Comms is the toggleable team-radio layer: a now-playing banner + a short
// replayable history. Audio streams from F1's public URL (ADR-0003).
export function Comms({ state }: { state: RaceState }) {
  const [enabled, setEnabled] = useState(false);
  const { nowPlaying, history, replay } = useComms(state, enabled);

  function codeFor(driverNum: number) {
    return state.cars[driverNum]?.code ?? String(driverNum);
  }
  function colourFor(driverNum: number) {
    return teamColour[state.cars[driverNum]?.team ?? ''] ?? '#bbb';
  }

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <button
        onClick={() => setEnabled((v) => !v)}
        style={{
          border: 'none', cursor: 'pointer', padding: '6px 14px', borderRadius: 8,
          fontFamily: 'monospace', fontSize: 13, justifySelf: 'start',
          background: enabled ? '#3671C6' : '#1a1a1a', color: enabled ? '#fff' : '#888',
        }}
      >
        {enabled ? '📻 Comms ON' : '📻 Comms OFF'}
      </button>

      {enabled && nowPlaying && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px',
          background: '#1a1a1a', borderRadius: 8, fontFamily: 'monospace', fontSize: 13,
        }}>
          <span style={{ color: colourFor(nowPlaying.driverNum), fontWeight: 700 }}>
            {codeFor(nowPlaying.driverNum)}
          </span>
          <span style={{ color: '#888' }}>radio</span>
          <button onClick={() => replay(nowPlaying)} style={replayBtn}>↻</button>
        </div>
      )}

      {enabled && history.length > 0 && (
        <div style={{ display: 'grid', gap: 4 }}>
          {history.map((m, i) => (
            <div key={`${m.timeMs}-${i}`} style={{
              display: 'flex', alignItems: 'center', gap: 8,
              fontFamily: 'monospace', fontSize: 12, color: '#aaa',
            }}>
              <span style={{ color: colourFor(m.driverNum), fontWeight: 700 }}>{codeFor(m.driverNum)}</span>
              <button onClick={() => replay(m)} style={replayBtn}>▶</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const replayBtn: React.CSSProperties = {
  border: 'none', cursor: 'pointer', background: 'transparent', color: '#3671C6',
  fontSize: 13, padding: '0 4px',
};
```

- [ ] **Step 3: Wire into App**

In `web/src/App.tsx`, import it (after the `SourceToggle` import, line 8):

```tsx
import { Comms } from './components/Comms';
```

Add it to the right-hand column, after the Telemetry block (after line 78, the closing `</div>` of the Telemetry section, before line 79's `</div>`):

```tsx
        <div>
          <h3 style={{ margin: '0 0 8px' }}>Comms</h3>
          <Comms state={state} />
        </div>
```

- [ ] **Step 4: Build + test**

Run: `cd web && npm run build && npm test`
Expected: builds clean, all tests pass. Restore `web/dist/.gitkeep` if vite removed it.

- [ ] **Step 5: Lint (CI gate is `--max-warnings 0`)**

Run: `cd web && npm run lint -- --max-warnings 0`
Expected: no errors/warnings. Fix any (e.g. unused imports) before committing.

- [ ] **Step 6: Commit**

```bash
git add web/src/components/teamColours.ts web/src/components/Comms.tsx web/src/components/Map.tsx web/src/App.tsx web/dist/.gitkeep
git commit -m "feat(web): comms layer UI (banner + history) wired into the board"
```

---

### Task 11: Docs — README feature note

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add the comms layer to the feature list and note the audio dependency**

Find the feature/phase list in `README.md` (search for "Timing" or "Phase 2") and add a bullet describing the **comms layer** (toggleable team-radio audio synced to the replay clock). Add a one-line note that audio streams from F1's public URLs at play time — so the audio (only) needs network access — linking `docs/adr/0003-team-radio-streamed-not-committed.md`. Match the surrounding wording/format exactly; do not restructure the README.

- [ ] **Step 2: Verify links resolve (mirrors the CI docs-link job)**

Run: `npx --yes lychee --no-progress --exclude-loopback README.md CONTEXT.md docs/*.md docs/adr/**/*.md` (or just re-read the edited section to confirm the ADR path is correct).
Expected: no broken links.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: note the Phase 3 comms layer in the README"
```

---

## Final verification (before opening the PR)

- [ ] `go test ./...` — all Go packages pass.
- [ ] `cd web && npm run build && npm test && npm run lint -- --max-warnings 0` — web builds, tests, lints clean.
- [ ] `cd ingest && python check_live_contract.py && python test_radio.py` — both self-checks pass.
- [ ] `git status` clean and `web/dist/.gitkeep` still tracked (not deleted).
- [ ] `docker compose up --build -d`, open http://localhost:8080: toggle **Comms ON**, let the replay run; a radio clip should auto-play with the driver's code in the banner and appear in history. Toggle to the **Live** lane and confirm the same. (Manual — the user drives the browser check.)

## Notes / out of scope (carried from the spec)

- Compare lanes (`#compare`) will carry `radio` in their snapshots (same replay source path) but the `Compare` view does not mount the comms layer — no task needed, by design.
- No committed audio, no gateway proxy, no audio library, no transcripts, no `Frame.Radio`. The proxy is the named fallback in ADR-0003 if F1's URLs ever expire.
- Autoplay note: the toggle click satisfies Chrome's autoplay policy (the demo target). Safari can be stricter about programmatic `.play()`; acceptable for the demo.
