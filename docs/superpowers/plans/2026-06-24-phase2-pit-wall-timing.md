# Phase 2: Pit-Wall Timing Dashboard — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dock a pit-wall timing tower beside the existing track map, carrying lap/tyre/sector/gap/telemetry data baked into the committed replay clips.

**Architecture:** Extend the shared `CarState` contract with flat `omitempty` fields (Option A — rebroadcast every frame, no new types). The Go gateway is unchanged (same struct + JSON). The Python recorder bakes the new fields into the clips; the React board renders a timing tower + a per-car telemetry panel driven by row selection.

**Tech Stack:** Go (`encoding/json`), Python (FastF1, numpy, pandas), React + TypeScript (Vite, vitest).

**Spec:** `docs/superpowers/specs/2026-06-24-phase2-pit-wall-timing-design.md`

---

## File structure

| File | Responsibility |
|------|----------------|
| `internal/model/model.go` | Canonical `CarState` — add timing/telemetry fields. |
| `internal/model/model_test.go` | Round-trip test: a fully-populated `CarState` survives JSON encode→decode. |
| `web/src/state/race.ts` | Client `Car` type — add the same fields; parsing already folds whole car objects. |
| `web/src/state/race.test.ts` | Assert a frame carrying timing fields folds into state. |
| `web/src/components/TimingTower.tsx` | NEW — one row per car (pos/gap/interval/lastLap/tyre/sectors); row click selects a car. Replaces `Standings.tsx`. |
| `web/src/components/TimingTower.test.tsx` | NEW — renders rows sorted by pos; sector colouring; blanks for missing fields. |
| `web/src/components/TelemetryPanel.tsx` | NEW — per selected-car readout (speed/gear/throttle/brake/DRS). |
| `web/src/components/Standings.tsx` | DELETE — superseded by `TimingTower`. |
| `web/src/App.tsx` | Hold `selectedDriver` state; render `TimingTower` + `TelemetryPanel`. |
| `ingest/record.py` | Bake lap/tyre/sector, telemetry, and derived gap/interval into each frame. |
| `data/replays/*.jsonl` | Re-baked clips (monza-2024, monza-2023, silverstone-2024). |
| `README.md` | Mention the timing dashboard. |

---

## Task 1: Extend the Go contract

**Files:**
- Modify: `internal/model/model.go:9-18` (the `CarState` struct)
- Test: `internal/model/model_test.go` (create)

- [ ] **Step 1: Write the failing test**

Create `internal/model/model_test.go`:

```go
package model

import (
	"encoding/json"
	"testing"
)

func TestCarStateRoundTripWithTimingFields(t *testing.T) {
	in := CarState{
		DriverNum: 1, Code: "VER", Team: "Red Bull", Pos: 1,
		P: Point{X: 0.5, Y: 0.5}, Status: "OnTrack",
		Tyre: "SOFT", TyreAge: 12,
		LastLapMs: 81234, BestLapMs: 80950,
		S1Ms: 26100, S2Ms: 28200, S3Ms: 26900,
		GapMs: 0, GapLaps: 0, IntMs: 0,
		Speed: 312, Gear: 7, Throttle: 100, Brake: 0, DRS: true,
	}
	b, err := json.Marshal(in)
	if err != nil {
		t.Fatal(err)
	}
	var out CarState
	if err := json.Unmarshal(b, &out); err != nil {
		t.Fatal(err)
	}
	if out != in {
		t.Fatalf("round trip mismatch:\n got %+v\nwant %+v", out, in)
	}
}

func TestCarStateOmitsZeroTimingFields(t *testing.T) {
	b, _ := json.Marshal(CarState{DriverNum: 1, Code: "VER", Team: "x", Pos: 1, Status: "OnTrack"})
	s := string(b)
	for _, k := range []string{"tyreAge", "lastLapMs", "gapMs", "gear", "drs"} {
		if contains(s, k) {
			t.Errorf("expected %q omitted from %s", k, s)
		}
	}
}

func contains(haystack, needle string) bool {
	return len(haystack) >= len(needle) && (indexOf(haystack, needle) >= 0)
}

func indexOf(h, n string) int {
	for i := 0; i+len(n) <= len(h); i++ {
		if h[i:i+len(n)] == n {
			return i
		}
	}
	return -1
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `go test ./internal/model/`
Expected: FAIL — `unknown field 'TyreAge' in struct literal` (compile error).

- [ ] **Step 3: Add the fields**

In `internal/model/model.go`, replace the `CarState` struct with:

```go
type CarState struct {
	DriverNum int    `json:"driverNum"`
	Code      string `json:"code"` // "VER"
	Team      string `json:"team"`
	Pos       int    `json:"pos"`            // running order
	P         Point  `json:"p"`              // track-space coordinate, scaled to [0,1]
	Status    string `json:"status"`         // "OnTrack" | "Pit" | "Out"
	Tyre      string `json:"tyre,omitempty"` // Phase 2: compound, e.g. "SOFT"
	TyreAge   int    `json:"tyreAge,omitempty"`
	LastLapMs int    `json:"lastLapMs,omitempty"`
	BestLapMs int    `json:"bestLapMs,omitempty"`
	S1Ms      int    `json:"s1Ms,omitempty"`
	S2Ms      int    `json:"s2Ms,omitempty"`
	S3Ms      int    `json:"s3Ms,omitempty"`
	GapMs     int    `json:"gapMs,omitempty"`   // to leader; best-effort, derived at record time
	GapLaps   int    `json:"gapLaps,omitempty"` // whole laps behind leader; FE shows "+1 LAP" when >= 1
	IntMs     int    `json:"intMs,omitempty"`   // interval to car ahead; best-effort
	Speed     int    `json:"speed,omitempty"`
	Gear      int    `json:"gear,omitempty"`
	Throttle  int    `json:"throttle,omitempty"` // 0-100
	Brake     int    `json:"brake,omitempty"`    // 0-100
	DRS       bool   `json:"drs,omitempty"`
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `go test ./internal/model/`
Expected: PASS.

- [ ] **Step 5: Verify nothing else broke**

Run: `go build ./... && go vet ./...`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add internal/model/model.go internal/model/model_test.go
git commit -m "feat(contract): add Phase 2 timing/telemetry fields to CarState"
```

---

## Task 2: Mirror the fields in the client state

**Files:**
- Modify: `web/src/state/race.ts:1-5` (the `Car` interface)
- Test: `web/src/state/race.test.ts` (append a case)

- [ ] **Step 1: Write the failing test**

Append to `web/src/state/race.test.ts` (it already imports `describe/it/expect` and `applyMessage/emptyState` — do **not** re-import; just add the new `describe` block):

```ts
describe('timing fields', () => {
  it('folds a frame carrying timing fields into the car', () => {
    const s0 = applyMessage(emptyState(), {
      type: 'snapshot',
      data: { session: 'replay', mode: 'replay', label: 'x', cars: {}, timeMs: 0, rev: 1 },
    });
    const s1 = applyMessage(s0, {
      type: 'frame',
      data: {
        rev: 2, timeMs: 100,
        cars: [{
          driverNum: 1, code: 'VER', team: 'Red Bull', pos: 1,
          p: { x: 0.5, y: 0.5 }, status: 'OnTrack',
          tyre: 'SOFT', tyreAge: 12, lastLapMs: 81234, bestLapMs: 80950,
          s1Ms: 26100, s2Ms: 28200, s3Ms: 26900, gapMs: 0, intMs: 0,
          speed: 312, gear: 7, throttle: 100, brake: 0, drs: true,
        }],
      },
    });
    expect(s1.cars[1].lastLapMs).toBe(81234);
    expect(s1.cars[1].tyre).toBe('SOFT');
    expect(s1.cars[1].drs).toBe(true);
  });
});
```

(If `race.test.ts` already imports these, reuse the existing import line instead of duplicating.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npm test -- race.test.ts`
Expected: FAIL — type error: object literal may only specify known properties (`tyreAge` not on `Car`).

- [ ] **Step 3: Extend the `Car` interface**

In `web/src/state/race.ts`, replace the `Car` interface:

```ts
export interface Car {
  driverNum: number; code: string; team: string; pos: number;
  p: Point; status: string;
  // Phase 2 — all optional; absent renders blank.
  tyre?: string; tyreAge?: number;
  lastLapMs?: number; bestLapMs?: number;
  s1Ms?: number; s2Ms?: number; s3Ms?: number;
  gapMs?: number; gapLaps?: number; intMs?: number;
  speed?: number; gear?: number; throttle?: number; brake?: number; drs?: boolean;
}
```

(No change to `applyMessage` — it already folds whole car objects.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npm test -- race.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/state/race.ts web/src/state/race.test.ts
git commit -m "feat(web): add Phase 2 timing fields to client Car type"
```

---

## Task 3: TimingTower component (replaces Standings)

A presentational table sorted by `pos`. Formats ms→`m:ss.SSS`, shows tyre compound + age, and colours sector cells **personal-best green / session-best purple** (purple wins). Personal bests are accumulated across frames in a `useRef`. Clicking a row calls `onSelect(driverNum)`; a local toggle flips gap/interval between pit-wall and raw-seconds. The project has **no DOM test deps** (no jsdom/testing-library) — so the test covers the **pure exported helpers** (`fmtLap`, `fmtGap`, `gapLabel`, `intLabel`, `bestSectors`, `orderCars`, `updatePersonalBests`, `sectorColour`); the rendered output is verified in the Task 9 e2e step.

**Files:**
- Create: `web/src/components/TimingTower.tsx`
- Create: `web/src/components/TimingTower.test.ts` (note: `.ts`, not `.tsx` — pure-logic test, no JSX)
- Delete: `web/src/components/Standings.tsx` (in Task 5, after App stops importing it)

- [ ] **Step 1: Write the failing test**

Create `web/src/components/TimingTower.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { fmtLap, fmtGap, gapLabel, intLabel, bestSectors, orderCars, updatePersonalBests, sectorColour } from './TimingTower';
import type { Car } from '../state/race';

const car = (over: Partial<Car>): Car => ({
  driverNum: 1, code: 'VER', team: 'Red Bull', pos: 1, p: { x: 0, y: 0 }, status: 'OnTrack', ...over,
});

describe('fmtLap', () => {
  it('formats ms as m:ss.SSS, dash when absent', () => {
    expect(fmtLap(81234)).toBe('1:21.234');
    expect(fmtLap(undefined)).toBe('—');
    expect(fmtLap(0)).toBe('—');
  });
});

describe('fmtGap', () => {
  it('formats seconds as +s.SSS, dash when absent', () => {
    expect(fmtGap(1234)).toBe('+1.234');
    expect(fmtGap(undefined)).toBe('—');
    expect(fmtGap(0)).toBe('—');
  });
});

describe('gapLabel (pit-wall)', () => {
  it('reads LEADER for the leader', () => {
    expect(gapLabel(0, 0, true, false)).toBe('LEADER');
  });
  it('shows lap deficit when lapped, pluralising', () => {
    expect(gapLabel(92000, 1, false, false)).toBe('+1 LAP');
    expect(gapLabel(184000, 2, false, false)).toBe('+2 LAPS');
  });
  it('shows seconds for lead-lap cars', () => {
    expect(gapLabel(1234, 0, false, false)).toBe('+1.234');
  });
  it('seconds mode forces seconds even when lapped', () => {
    expect(gapLabel(92000, 1, false, true)).toBe('+92.000');
  });
});

describe('intLabel (pit-wall)', () => {
  it('dash for the leader', () => {
    expect(intLabel(0, undefined, 0, true, false)).toBe('—');
  });
  it('derives lap deficit from the gapLaps difference', () => {
    expect(intLabel(2, 1, 5000, false, false)).toBe('+1 LAP'); // this car 2 down, car ahead 1 down
  });
  it('shows seconds when on the same lap as the car ahead', () => {
    expect(intLabel(1, 1, 800, false, false)).toBe('+0.800');
  });
  it('seconds mode forces seconds', () => {
    expect(intLabel(2, 1, 5000, false, true)).toBe('+5.000');
  });
});

describe('orderCars', () => {
  it('sorts by pos', () => {
    const cars = { 1: car({ driverNum: 1, code: 'VER', pos: 2 }), 44: car({ driverNum: 44, code: 'HAM', pos: 1 }) };
    expect(orderCars(cars).map((c) => c.code)).toEqual(['HAM', 'VER']);
  });
});

describe('bestSectors', () => {
  it('picks the min positive sector across cars', () => {
    const cars = [car({ s1Ms: 26100 }), car({ s1Ms: 25900 }), car({ s1Ms: 0 })];
    expect(bestSectors(cars)[0]).toBe(25900);
  });
});

describe('updatePersonalBests', () => {
  it('accumulates the per-driver min across frames, ignoring zeros', () => {
    let b = updatePersonalBests({}, [car({ driverNum: 1, s1Ms: 26100, s2Ms: 0, s3Ms: 27000 })]);
    b = updatePersonalBests(b, [car({ driverNum: 1, s1Ms: 25900, s2Ms: 28000, s3Ms: 27500 })]);
    expect(b[1]).toEqual([25900, 28000, 27000]); // s1 improved, s2 first real value, s3 kept faster
  });
});

describe('sectorColour', () => {
  it('purple for session-best, green for personal-best, undefined otherwise', () => {
    expect(sectorColour(25900, 25900, 25900)).toBe('#b14aff'); // session-best wins
    expect(sectorColour(26100, 25900, 26100)).toBe('#3bb273'); // personal-best only
    expect(sectorColour(26500, 25900, 26100)).toBeUndefined();
    expect(sectorColour(undefined, 25900, 26100)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npm test -- TimingTower`
Expected: FAIL — cannot find module `./TimingTower`.

- [ ] **Step 3: Implement the component**

Create `web/src/components/TimingTower.tsx`:

```tsx
import { useRef, useState } from 'react';
import type { RaceState, Car } from '../state/race';

// fmtLap renders a lap/sector time (ms) as m:ss.SSS, or em-dash when absent.
export function fmtLap(ms: number | undefined): string {
  if (!ms || ms <= 0) return '—';
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const millis = ms % 1000;
  return `${m}:${String(s).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
}

// fmtSec renders a sector time (ms) as ss.SSS (no minutes — sectors are < 60s).
function fmtSec(ms: number | undefined): string {
  if (!ms || ms <= 0) return '—';
  return (ms / 1000).toFixed(3);
}

// fmtGap renders a time gap/interval (ms) as +s.SSS, or em-dash when absent.
export function fmtGap(ms: number | undefined): string {
  if (!ms || ms <= 0) return '—';
  return `+${(ms / 1000).toFixed(3)}`;
}

const laps = (n: number) => `+${n} LAP${n > 1 ? 'S' : ''}`;

// gapLabel renders the pit-wall gap to leader: LEADER for P1; "+N LAP(S)" when
// lapped (unless secondsMode forces raw time); else the time gap.
export function gapLabel(
  gapMs: number | undefined, gapLaps: number | undefined, isLeader: boolean, secondsMode: boolean,
): string {
  if (isLeader) return 'LEADER';
  if (!secondsMode && gapLaps && gapLaps >= 1) return laps(gapLaps);
  return fmtGap(gapMs);
}

// intLabel renders the pit-wall interval to the car ahead. The lap deficit is
// derived from the gapLaps difference (this car minus the car ahead).
export function intLabel(
  gapLaps: number | undefined, aheadGapLaps: number | undefined,
  intMs: number | undefined, isLeader: boolean, secondsMode: boolean,
): string {
  if (isLeader) return '—';
  const def = (gapLaps ?? 0) - (aheadGapLaps ?? 0);
  if (!secondsMode && def >= 1) return laps(def);
  return fmtGap(intMs);
}

const TYRE_COLOUR: Record<string, string> = {
  SOFT: '#e1342e', MEDIUM: '#e8c84a', HARD: '#e8e8e8',
  INTERMEDIATE: '#3bb273', WET: '#3671C6',
};

// orderCars returns the cars sorted by running position.
export function orderCars(cars: RaceState['cars']): Car[] {
  return Object.values(cars).sort((a, b) => a.pos - b.pos);
}

// bestSectors finds the session-best (min across all cars) for each sector this frame.
export function bestSectors(cars: Car[]): [number, number, number] {
  const min = (sel: (c: Car) => number | undefined) =>
    cars.reduce((acc, c) => {
      const v = sel(c);
      return v && v > 0 && v < acc ? v : acc;
    }, Infinity);
  return [min((c) => c.s1Ms), min((c) => c.s2Ms), min((c) => c.s3Ms)];
}

// Bests maps driverNum -> their best-seen [s1, s2, s3] (ms) across all frames.
export type Bests = Record<number, [number, number, number]>;

const faster = (prev: number, v: number | undefined) => (v && v > 0 && v < prev ? v : prev);

// updatePersonalBests folds this frame's sectors into the running per-driver mins.
// Pure: returns a new map; Infinity means "no value yet".
export function updatePersonalBests(prev: Bests, cars: Car[]): Bests {
  const next: Bests = { ...prev };
  for (const c of cars) {
    const cur = next[c.driverNum] ?? [Infinity, Infinity, Infinity];
    next[c.driverNum] = [faster(cur[0], c.s1Ms), faster(cur[1], c.s2Ms), faster(cur[2], c.s3Ms)];
  }
  return next;
}

const PURPLE = '#b14aff'; // session-best
const GREEN = '#3bb273';  // personal-best

// sectorColour returns the cell colour for a sector value: purple if it ties the
// session-best, else green if it ties this driver's personal-best, else none.
export function sectorColour(
  v: number | undefined, sessionBest: number, personalBest: number,
): string | undefined {
  if (!v || v <= 0) return undefined;
  if (v === sessionBest) return PURPLE;
  if (v === personalBest) return GREEN;
  return undefined;
}

export function TimingTower({
  state, selected, onSelect,
}: {
  state: RaceState;
  selected: number | null;
  onSelect: (driverNum: number) => void;
}) {
  const [secondsMode, setSecondsMode] = useState(false);
  const pbRef = useRef<Bests>({});
  const order = orderCars(state.cars);
  // Accumulate per-driver best sectors. Monotonic (min only) so re-running on a
  // re-render with the same frame is idempotent — safe to do during render.
  pbRef.current = updatePersonalBests(pbRef.current, order);
  const [b1, b2, b3] = bestSectors(order);
  const cellColour = (v: number | undefined, best: number, dn: number, i: number) => {
    const c = sectorColour(v, best, pbRef.current[dn]?.[i] ?? Infinity);
    return c ? { color: c } : undefined;
  };

  return (
    <div>
    <button
      onClick={() => setSecondsMode((m) => !m)}
      style={{ marginBottom: 6, fontFamily: 'monospace', fontSize: 11, background: '#1d2a44', color: '#9bf', border: 'none', borderRadius: 4, padding: '2px 8px', cursor: 'pointer' }}
    >
      {secondsMode ? 'Show laps' : 'Show seconds'}
    </button>
    <table style={{ fontFamily: 'monospace', fontSize: 12, borderCollapse: 'collapse', color: '#ddd' }}>
      <thead style={{ color: '#888', textAlign: 'left' }}>
        <tr>
          <th style={{ padding: '2px 8px' }}>#</th>
          <th style={{ padding: '2px 8px' }}>Driver</th>
          <th style={{ padding: '2px 8px' }}>Gap</th>
          <th style={{ padding: '2px 8px' }}>Int</th>
          <th style={{ padding: '2px 8px' }}>Last</th>
          <th style={{ padding: '2px 8px' }}>Tyre</th>
          <th style={{ padding: '2px 8px' }}>S1</th>
          <th style={{ padding: '2px 8px' }}>S2</th>
          <th style={{ padding: '2px 8px' }}>S3</th>
        </tr>
      </thead>
      <tbody>
        {order.map((c, idx) => {
          const isLeader = c.pos === 1;
          const ahead = order[idx - 1];
          const isSel = c.driverNum === selected;
          return (
            <tr
              key={c.driverNum}
              onClick={() => onSelect(c.driverNum)}
              style={{ cursor: 'pointer', background: isSel ? '#1d2a44' : undefined }}
            >
              <td style={{ padding: '2px 8px' }}>{c.pos}</td>
              <td style={{ padding: '2px 8px' }}><b>{c.code}</b></td>
              <td style={{ padding: '2px 8px' }} title="best-effort, derived">{gapLabel(c.gapMs, c.gapLaps, isLeader, secondsMode)}</td>
              <td style={{ padding: '2px 8px' }} title="best-effort, derived">{intLabel(c.gapLaps, ahead?.gapLaps, c.intMs, isLeader, secondsMode)}</td>
              <td style={{ padding: '2px 8px' }}>{fmtLap(c.lastLapMs)}</td>
              <td style={{ padding: '2px 8px', color: TYRE_COLOUR[c.tyre ?? ''] ?? '#ddd' }}>
                {c.tyre ? `${c.tyre[0]}${c.tyreAge ? ` ${c.tyreAge}` : ''}` : '—'}
              </td>
              <td style={{ padding: '2px 8px', ...cellColour(c.s1Ms, b1, c.driverNum, 0) }}>{fmtSec(c.s1Ms)}</td>
              <td style={{ padding: '2px 8px', ...cellColour(c.s2Ms, b2, c.driverNum, 1) }}>{fmtSec(c.s2Ms)}</td>
              <td style={{ padding: '2px 8px', ...cellColour(c.s3Ms, b3, c.driverNum, 2) }}>{fmtSec(c.s3Ms)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
    </div>
  );
}
```

> Note: in a 2.5-min clip window each driver completes ~1–2 laps, so personal-best (green) will paint most cells — that's expected given the data, not a bug. Purple (session-best) is the high-signal colour here. Personal bests persist across clip loops (mins never reset), which is fine for the demo.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && npm test -- TimingTower`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/TimingTower.tsx web/src/components/TimingTower.test.tsx
git commit -m "feat(web): TimingTower component with gap/lap/tyre/sector columns"
```

---

## Task 4: TelemetryPanel component

Shows one selected car's live telemetry. Pure presentational; blank when nothing selected. **No unit test** — it's trivial presentational markup (no DOM test deps in this project; ponytail: trivial render needs no test), verified in the Task 9 e2e step.

**Files:**
- Create: `web/src/components/TelemetryPanel.tsx`

- [ ] **Step 1: Implement the component**

Create `web/src/components/TelemetryPanel.tsx`:

```tsx
import type { Car } from '../state/race';

function Bar({ label, value }: { label: string; value: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: 'monospace', fontSize: 12 }}>
      <span style={{ width: 64, color: '#888' }}>{label}</span>
      <div style={{ flex: 1, height: 8, background: '#222', borderRadius: 4 }}>
        <div style={{ width: `${Math.max(0, Math.min(100, value))}%`, height: '100%', background: '#3bb273', borderRadius: 4 }} />
      </div>
      <span style={{ width: 36, textAlign: 'right' }}>{value}</span>
    </div>
  );
}

export function TelemetryPanel({ car }: { car: Car | undefined }) {
  if (!car) {
    return <div style={{ color: '#666', fontFamily: 'monospace', fontSize: 12 }}>Select a car to see telemetry</div>;
  }
  return (
    <div style={{ display: 'grid', gap: 8, minWidth: 240 }}>
      <div style={{ fontFamily: 'monospace', fontSize: 14 }}>
        <b>{car.code}</b> <span style={{ color: '#888' }}>{car.team}</span>
      </div>
      <div style={{ fontFamily: 'monospace', fontSize: 28 }}>
        {car.speed ?? 0} <span style={{ fontSize: 14, color: '#888' }}>km/h</span>
        <span style={{ marginLeft: 16 }}>G{car.gear ?? 0}</span>
        {car.drs ? <span style={{ marginLeft: 16, color: '#3bb273' }}>DRS</span> : <span style={{ marginLeft: 16, color: '#444' }}>DRS</span>}
      </div>
      <Bar label="Throttle" value={car.throttle ?? 0} />
      <Bar label="Brake" value={car.brake ?? 0} />
    </div>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd web && npm run build`
Expected: build succeeds (the component is imported in Task 5; a standalone `tsc -b` here just confirms no type errors in the new file).

- [ ] **Step 3: Commit**

```bash
git add web/src/components/TelemetryPanel.tsx
git commit -m "feat(web): TelemetryPanel for selected-car readout"
```

---

## Task 5: Wire the tower + telemetry into the board

**Files:**
- Modify: `web/src/App.tsx`
- Delete: `web/src/components/Standings.tsx`

- [ ] **Step 1: Replace the Standings import + usage**

In `web/src/App.tsx`:

Replace the import line:

```tsx
import { Standings } from './components/Standings';
```

with:

```tsx
import { TimingTower } from './components/TimingTower';
import { TelemetryPanel } from './components/TelemetryPanel';
```

Add selection state next to the existing `useState` calls (after the `hash` state on line 29):

```tsx
const [selected, setSelected] = useState<number | null>(null);
```

Replace the right-hand column (the `<div><h3>Order</h3><Standings state={state} /></div>` on line 68) with:

```tsx
<div style={{ display: 'grid', gap: 16, alignContent: 'start' }}>
  <div>
    <h3 style={{ margin: '0 0 8px' }}>Timing</h3>
    <TimingTower state={state} selected={selected} onSelect={setSelected} />
  </div>
  <div>
    <h3 style={{ margin: '0 0 8px' }}>Telemetry</h3>
    <TelemetryPanel car={selected != null ? state.cars[selected] : undefined} />
  </div>
</div>
```

- [ ] **Step 2: Delete the dead component**

```bash
rm web/src/components/Standings.tsx
```

- [ ] **Step 3: Verify build + tests + lint**

Run: `cd web && npm run build && npm test && npm run lint`
Expected: build succeeds, all tests pass, no lint errors. (If lint flags an unused import, remove it.)

- [ ] **Step 4: Commit**

```bash
git add web/src/App.tsx
git rm web/src/components/Standings.tsx
git commit -m "feat(web): dock TimingTower + TelemetryPanel on the board, drop Standings"
```

---

## Task 6: Recorder — bake lap, tyre, and sector fields

The recorder already loads `session.laps`. Add a per-driver step-lookup keyed on session time that returns the "current" timing snapshot (most recently completed lap's times + current stint tyre), mirroring the existing `get_position` pattern.

**Files:**
- Modify: `ingest/record.py`

- [ ] **Step 1: Add a timing lookup builder**

In `ingest/record.py`, after the running-order lookup block (after `get_position`, ~line 231), add:

```python
# ---------------------------------------------------------------------------
# Per-driver timing lookup: at session time T, the "current" pit-wall numbers.
# Lap/sector times become current at lap COMPLETION (LapStartTime + LapTime);
# tyre compound/age are current from the lap's start. Best lap is the running
# min of completed lap times. Step-lookup mirrors get_position().
# ---------------------------------------------------------------------------

def _ms(td):
    """pandas Timedelta -> int milliseconds, or 0 if NaT."""
    if pd.isna(td):
        return 0
    return int(round(td.total_seconds() * 1000))

print("\nBuilding timing lookup (laps / sectors / tyre)...")

# driver_num -> list of (becomes_current_time_s, fields_dict), sorted by time.
timing_lookup = {}
for num in session.drivers:
    inum = int(num)
    if inum not in driver_info:
        continue
    drv = session.laps.pick_drivers(num)
    if len(drv) == 0:
        continue
    events = []
    best_ms = 0
    for _, lap in drv.iterrows():
        start_s = lap['LapStartTime'].total_seconds() if not pd.isna(lap['LapStartTime']) else None
        if start_s is None:
            continue
        last_ms = _ms(lap['LapTime'])
        if last_ms > 0:
            best_ms = last_ms if best_ms == 0 else min(best_ms, last_ms)
        # Tyre/age current from lap start:
        compound = lap['Compound'] if not pd.isna(lap['Compound']) else ''
        tyre_age = int(lap['TyreLife']) if not pd.isna(lap['TyreLife']) else 0
        events.append((start_s, {
            'tyre': str(compound).upper() if compound else '',
            'tyreAge': tyre_age,
            # last/best/sectors only valid AFTER this lap completes:
            'complete_at': start_s + (last_ms / 1000.0) if last_ms > 0 else start_s,
            'lastLapMs': last_ms,
            'bestLapMs': best_ms,
            's1Ms': _ms(lap['Sector1Time']),
            's2Ms': _ms(lap['Sector2Time']),
            's3Ms': _ms(lap['Sector3Time']),
        }))
    events.sort(key=lambda e: e[0])
    timing_lookup[inum] = events


def get_timing(driver_num, t_s):
    """Pit-wall numbers for a driver at session time t_s (step lookup)."""
    events = timing_lookup.get(driver_num, [])
    tyre, tyre_age = '', 0
    last_ms = best_ms = s1 = s2 = s3 = 0
    for start_s, f in events:
        if start_s <= t_s:
            tyre, tyre_age = f['tyre'], f['tyreAge']  # current from lap start
        if f['complete_at'] <= t_s:
            last_ms, best_ms = f['lastLapMs'], f['bestLapMs']
            s1, s2, s3 = f['s1Ms'], f['s2Ms'], f['s3Ms']
        elif start_s > t_s:
            break
    return {'tyre': tyre, 'tyreAge': tyre_age, 'lastLapMs': last_ms,
            'bestLapMs': best_ms, 's1Ms': s1, 's2Ms': s2, 's3Ms': s3}
```

- [ ] **Step 2: Populate the fields per car**

In the frame-emit loop, the `cars.append({...})` block (~line 336), add the timing fields. Replace the append with:

```python
            t = get_timing(dnum, t_s)
            car = {
                "driverNum": dnum,
                "code": info['code'],
                "team": info['team'],
                "pos": pos_order,
                "p": {"x": nx, "y": ny},
                "status": status_str,
            }
            # Only attach non-zero/non-empty timing fields (mirror Go omitempty).
            if t['tyre']:
                car['tyre'] = t['tyre']
            for k in ('tyreAge', 'lastLapMs', 'bestLapMs', 's1Ms', 's2Ms', 's3Ms'):
                if t[k] > 0:
                    car[k] = t[k]
            cars.append(car)
```

- [ ] **Step 3: Re-bake Monza 2024 and inspect**

Run:
```bash
.venv/Scripts/python.exe ingest/record.py data/replays/monza-2024-race.jsonl --year 2024 --gp Monza
```
Expected: prints "Contract validation PASSED." Then spot-check a mid-clip frame carries timing:
```bash
sed -n '750p' data/replays/monza-2024-race.jsonl | python -c "import sys,json; c=json.loads(sys.stdin.readline())['frame']['cars'][0]; print({k:c.get(k) for k in ('code','tyre','lastLapMs','s1Ms')})"
```
Expected: a dict with a tyre compound and a non-zero `lastLapMs` for a mid-race frame.

- [ ] **Step 4: Commit**

```bash
git add ingest/record.py data/replays/monza-2024-race.jsonl
git commit -m "feat(ingest): bake lap/tyre/sector timing into clips"
```

---

## Task 7: Recorder — bake telemetry fields

Resample `session.car_data[num]` (Speed/nGear/Throttle/Brake/DRS) onto the same 10 Hz grid already built for positions.

**Files:**
- Modify: `ingest/record.py`

- [ ] **Step 1: Resample car telemetry onto the grid**

In the per-driver resample loop (the `for num in session.drivers:` block that fills `driver_frames`, ~line 251), after the position interpolation that sets `driver_frames[inum]`, extend that dict. Replace the `driver_frames[inum] = {...}` assignment with:

```python
    # Telemetry: resample car_data onto the same grid (nearest-neighbour in time).
    tel = {'speed': None, 'gear': None, 'throttle': None, 'brake': None, 'drs': None}
    try:
        cd = session.car_data[num]
        cd_t = cd['SessionTime'].dt.total_seconds().values
        idx = np.searchsorted(cd_t, t_grid_s, side='left').clip(0, len(cd_t) - 1)
        tel['speed'] = cd['Speed'].values[idx].astype(int)
        tel['gear'] = cd['nGear'].values[idx].astype(int)
        tel['throttle'] = cd['Throttle'].values[idx].astype(int)
        # FastF1 Brake is a BOOLEAN in current versions (not 0-100). Normalise to
        # 0/100 robustly so the FE bar is right whether the source is bool or %.
        tel['brake'] = (cd['Brake'].values[idx].astype(float) > 0).astype(int) * 100
        # FastF1 DRS code >= 10 means the flap is open (10,12,14 = on; 8 = eligible).
        tel['drs'] = (cd['DRS'].values[idx] >= 10)
    except Exception as e:
        print(f"  Warning: no telemetry for {num} ({driver_info[inum]['code']}): {e}")

    driver_frames[inum] = {
        'x': x_interp,
        'y': y_interp,
        'status': status_interp,
        'tel': tel,
    }
```

- [ ] **Step 2: Emit telemetry per car**

In the frame loop, after the timing-field block from Task 6, before `cars.append(car)`, add:

```python
            tel = driver_frames[dnum]['tel']
            if tel['speed'] is not None:
                sp = int(tel['speed'][i])
                if sp > 0:
                    car['speed'] = sp
                gr = int(tel['gear'][i])
                if gr > 0:
                    car['gear'] = gr
                th = int(tel['throttle'][i])
                if th > 0:
                    car['throttle'] = th
                br = int(tel['brake'][i])
                if br > 0:
                    car['brake'] = br
                if bool(tel['drs'][i]):
                    car['drs'] = True
```

- [ ] **Step 3: Re-bake and inspect**

Run:
```bash
.venv/Scripts/python.exe ingest/record.py data/replays/monza-2024-race.jsonl --year 2024 --gp Monza
```
Then:
```bash
sed -n '750p' data/replays/monza-2024-race.jsonl | python -c "import sys,json; c=json.loads(sys.stdin.readline())['frame']['cars'][0]; print({k:c.get(k) for k in ('code','speed','gear','throttle','drs')})"
```
Expected: a non-zero `speed` and a plausible `gear` (1–8) for a mid-race frame.

- [ ] **Step 4: Commit**

```bash
git add ingest/record.py data/replays/monza-2024-race.jsonl
git commit -m "feat(ingest): bake live telemetry (speed/gear/throttle/brake/drs)"
```

---

## Task 8: Recorder — derive gap and interval (best-effort)

Approximate race distance per car as `lap_number + fraction_of_lap`, where the fraction is the nearest index on the baked track outline. Gap to leader = distance behind × leader's median lap time. Interval = gap delta between adjacent cars by position.

**Files:**
- Modify: `ingest/record.py`

- [ ] **Step 1: Precompute track-fraction and leader pace**

After the timing lookup (Task 6 block), add:

```python
# ---------------------------------------------------------------------------
# Gap / interval (BEST-EFFORT, derived). FastF1 gives no per-tick gap, so we
# approximate race distance as lap_number + fraction-along-the-baked-outline,
# and convert a distance-behind-leader into milliseconds via leader pace.
# ponytail: good enough for a labeled-approximate tower; swap for a real
# timing-feed gap if broadcast accuracy is ever needed. Fallback if noisy:
# lap-level position deltas (coarser, stable).
# ---------------------------------------------------------------------------

_track_xy = np.array([(p['x'], p['y']) for p in track_points])  # (N,2) in [0,1]

def _lap_fraction(nx, ny):
    """Fraction [0,1) around the lap = nearest baked-outline index / N."""
    d = (_track_xy[:, 0] - nx) ** 2 + (_track_xy[:, 1] - ny) ** 2
    return int(np.argmin(d)) / len(_track_xy)

# Lap-number step lookup per driver (from laps 'LapNumber').
lapnum_lookup = {}
for num in session.drivers:
    inum = int(num)
    if inum not in driver_info:
        continue
    drv = session.laps.pick_drivers(num)[['LapStartTime', 'LapNumber']].dropna()
    lapnum_lookup[inum] = [(t.total_seconds(), int(n)) for t, n in
                           zip(drv['LapStartTime'], drv['LapNumber'])]

def _lap_number(driver_num, t_s):
    entries = lapnum_lookup.get(driver_num, [])
    n = entries[0][1] if entries else 1
    for t, ln in entries:
        if t <= t_s:
            n = ln
        else:
            break
    return n

# Leader pace: median completed lap time (ms) across the field; fallback 90s.
_all_laps_ms = [_ms(t) for t in session.laps['LapTime'] if not pd.isna(t)]
_all_laps_ms = [m for m in _all_laps_ms if m > 0]
LEADER_LAP_MS = int(np.median(_all_laps_ms)) if _all_laps_ms else 90000
```

- [ ] **Step 2: Compute gap/interval inside the frame loop**

The gap needs every car's race distance for the frame *before* assigning gaps. Restructure the per-frame `cars` build to two passes. In the frame loop, after building the `cars` list (after the `for dnum in ...` loop, before `frame_line = {...}`), add:

```python
        # --- gap / interval pass (best-effort) ---
        # Race distance in "lap units" = whole lap number + fraction round the lap.
        lapn, frac, dist = {}, {}, {}
        for car in cars:
            dn = car['driverNum']
            lapn[dn] = _lap_number(dn, t_s)
            frac[dn] = _lap_fraction(car['p']['x'], car['p']['y'])
            dist[dn] = lapn[dn] + frac[dn]
        by_pos = sorted(cars, key=lambda c: c['pos'])
        # Anchor the leader to the CLASSIFIED P1 (matches the FE pos===1 leader test),
        # not the max-distance car (derivation noise could disagree).
        leader_dn = by_pos[0]['driverNum'] if by_pos else None
        leader_dist = dist.get(leader_dn, 0.0)
        leader_lap = lapn.get(leader_dn, 0)
        prev_dist = None
        for car in by_pos:
            dn = car['driverNum']
            behind = max(0.0, leader_dist - dist[dn])      # lap units behind leader
            gap_ms = int(behind * LEADER_LAP_MS)
            gap_laps = max(0, leader_lap - lapn[dn])        # whole-lap deficit (from LapNumber)
            if gap_ms > 0:
                car['gapMs'] = gap_ms
            if gap_laps > 0:
                car['gapLaps'] = gap_laps
            if prev_dist is not None:
                int_ms = int(max(0.0, prev_dist - dist[dn]) * LEADER_LAP_MS)
                if int_ms > 0:
                    car['intMs'] = int_ms
            prev_dist = dist[dn]
```

- [ ] **Step 3: Re-bake and sanity-check gaps**

Run:
```bash
.venv/Scripts/python.exe ingest/record.py data/replays/monza-2024-race.jsonl --year 2024 --gp Monza
```
Then check gaps are monotonic-ish by position on a mid frame:
```bash
sed -n '750p' data/replays/monza-2024-race.jsonl | python -c "import sys,json; cs=sorted(json.loads(sys.stdin.readline())['frame']['cars'], key=lambda c:c['pos']); print([(c['pos'], c.get('gapMs',0), c.get('gapLaps',0)) for c in cs])"
```
Expected: pos 1 has `gapMs`/`gapLaps` 0 (absent); gaps generally increase down the order (small non-monotonic jitter is acceptable — best-effort). Note whether any tail cars carry `gapLaps ≥ 1` — that's the lapped case the FE renders as "+N LAP".

- [ ] **Step 4: Commit**

```bash
git add ingest/record.py data/replays/monza-2024-race.jsonl
git commit -m "feat(ingest): derive best-effort gap/interval into clips"
```

---

## Task 9: Re-bake all clips, verify end-to-end, benchmark gate

**Files:**
- Modify: `data/replays/monza-2023-race.jsonl`, `data/replays/silverstone-2024-race.jsonl`
- Modify: `README.md`

- [ ] **Step 1: Re-bake the remaining two clips**

Run:
```bash
.venv/Scripts/python.exe ingest/record.py data/replays/monza-2023-race.jsonl --year 2023 --gp Monza
.venv/Scripts/python.exe ingest/record.py data/replays/silverstone-2024-race.jsonl --year 2024 --gp "British Grand Prix" --label "Silverstone 2024 · Race"
```
Expected: both print "Contract validation PASSED." Confirm the two Monza clips are **equal length** (compare-view constraint):
```bash
wc -l data/replays/monza-2023-race.jsonl data/replays/monza-2024-race.jsonl
```
Expected: identical line counts. If not, the 2023 window landed on a safety car / sparse running — shift `WINDOW_START_S`/`WINDOW_END_S` in `record.py` and re-bake **both** Monza clips together.

- [ ] **Step 2: Full Go + web verification**

Run:
```bash
go build ./... && go test ./... && go vet ./...
cd web && npm run build && npm test && npm run lint && cd ..
```
Expected: all green.

- [ ] **Step 3: End-to-end in Docker**

Run:
```bash
docker compose up --build -d
```
Open `http://localhost:8080`. Confirm: track map renders, timing tower beside it shows ~20 rows sorted by position with gaps/last-lap/tyre/sectors populated, clicking a row shows that car's telemetry (speed/gear/throttle/brake/DRS) updating. Capture a screenshot for the PR. Then `docker compose down`.

- [ ] **Step 4: Benchmark gate (Option A check)**

Run the existing load-test harness (see `BENCHMARKS.md` for the exact command) against the re-baked `replay` lane and record p99 frame latency with the larger frames.
Expected: p99 stays within the prior budget (Phase 1: p99 48 ms, 0 drops). **If p99 regresses materially or drops appear, STOP** — this is the documented trigger to escalate to Option B (split slow fields to a lower-cadence message); flag it for the user rather than proceeding.

- [ ] **Step 5: Update the README**

In `README.md`, add a sentence to the feature list noting the pit-wall timing tower beside the map (gaps, last lap, tyres, sectors, per-car telemetry on click). Match the existing README's tone/format.

- [ ] **Step 6: Commit**

```bash
git add data/replays/monza-2023-race.jsonl data/replays/silverstone-2024-race.jsonl README.md
git commit -m "feat(phase2): re-bake all clips with timing data + README note"
```

---

## Self-review notes (for the executor)

- **Spec coverage:** contract (Task 1–2), recorder lap/tyre/sector (6), telemetry (7), gap/interval (8), tower UI (3,5), telemetry panel (4,5), sector colouring (3), re-bake + parity + benchmark gate (9). All spec sections map to a task.
- **`check_live_contract.py`** intentionally unchanged — it asserts message-level keys, not car fields; the new optional fields don't affect it. Go round-trip test (Task 1) is the contract guard.
- **FastF1 column names** (`Compound`, `TyreLife`, `Sector1Time`, `LapNumber`, `nGear`, `DRS`, etc.) are standard but verify against the installed FastF1 version on first re-bake; the recorder's self-validation + the spot-checks are the safety net.
- **Gap/interval is best-effort** — jitter is expected and acceptable; the fallback (lap-level deltas) is noted in Task 8 if a baked window looks bad.
```
