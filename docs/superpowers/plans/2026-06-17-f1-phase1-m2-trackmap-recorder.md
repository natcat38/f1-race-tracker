# F1 Race Tracker — Phase 1 / Milestone 2: Real Track Map + FastF1 Recorder

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Turn M1's plain dots on a blank canvas into a **real circuit drawn from position data, with cars gliding smoothly** and proper loading/connection states — then swap the synthetic clip for one **baked from a real F1 session via FastF1**.

**Architecture:** Unchanged backbone from M1 (Go replay→Redis→gateway→WS→React). M2 adds: (frontend) track rendering + interpolation + status UI; (Python) a `ingest/record.py` FastF1 recorder that emits the **same `.jsonl` contract** the Go replay player already reads. Redis/Go/WS are untouched.

**Tech Stack:** React + TS (Vite) frontend; Python 3.11 + FastF1 + numpy for the recorder. Go side unchanged.

**Build order (risk-decoupled):**
- **M2a — Frontend (Tasks 1–4):** specifiable, built + verified against the **existing `data/replays/synthetic.jsonl`** (its `track` is a circle). No FastF1 dependency. Immediate visual payoff.
- **M2b — Recorder (Tasks 5–7):** exploratory (real FastF1 API/data); bakes a real clip into the same contract and swaps the default.

---

## Conventions
- Repo `C:\Users\natal\Documents\Coding\f1-race-tracker`, branch `feat/p1-m2-trackmap`. Commit per task (Conventional Commits + `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`). Don't touch `main`; don't push unless asked.
- ⚠️ Go PATH: prepend PowerShell `go` calls with `$env:Path = [System.Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [System.Environment]::GetEnvironmentVariable('Path','User'); `. Node + Python are on PATH (`python` = C:\Python311).
- The **JSON contract is fixed** by `internal/model/model.go` (Go) and `web/src/state/race.ts` (TS): `driverNum, code, team, pos, p.{x,y}, status, rev, timeMs, track[], cars`. Anything the recorder emits MUST match these tags exactly.
- Verify the frontend by running the M1 stack (`docker compose up --build -d`) and viewing `http://localhost:8080`, or `npm run dev` in `web/` (the Vite dev proxy forwards `/ws` to the gateway).

---

# M2a — Frontend (against the synthetic clip)

## Task 1 — Draw the track from position data
**Files:** Modify `web/src/components/Map.tsx`

- [ ] **Step 1:** Render the circuit as a closed SVG path from `state.track` (points are unit-box [0,1], multiply by `SIZE`), drawn *under* the car dots. Replace the `Map` component body with:
```tsx
import type { RaceState } from '../state/race';

const SIZE = 600;
const teamColour: Record<string, string> = {
  'Red Bull': '#3671C6', Ferrari: '#E8002D', Mercedes: '#27F4D2', McLaren: '#FF8000',
  'Aston Martin': '#229971', Alpine: '#0093CC', Williams: '#64C4FF',
  RB: '#6692FF', 'Kick Sauber': '#52E252', Haas: '#B6BABD',
};

export function Map({ state }: { state: RaceState }) {
  const cars = Object.values(state.cars);
  const trackPath = state.track.length
    ? 'M ' + state.track.map((p) => `${p.x * SIZE},${p.y * SIZE}`).join(' L ') + ' Z'
    : '';
  return (
    <svg width={SIZE} height={SIZE} style={{ background: '#111', borderRadius: 12 }}>
      {trackPath && <path d={trackPath} fill="none" stroke="#333" strokeWidth={10} strokeLinejoin="round" />}
      {trackPath && <path d={trackPath} fill="none" stroke="#1a1a1a" strokeWidth={6} strokeLinejoin="round" />}
      {cars.map((c) => (
        <g key={c.driverNum}>
          <circle cx={c.p.x * SIZE} cy={c.p.y * SIZE} r={7} fill={teamColour[c.team] ?? '#bbb'} stroke="#000" strokeWidth={1} />
          <text x={c.p.x * SIZE + 10} y={c.p.y * SIZE + 4} fill="#eee" fontSize={11}>{c.code}</text>
        </g>
      ))}
    </svg>
  );
}
```
- [ ] **Step 2:** Verify — rebuild SPA (`cd web; npm run build`), `docker compose up --build -d`, open `http://localhost:8080`. Expected: a **grey circle** (the synthetic track) with the three dots riding on it. Screenshot to confirm.
- [ ] **Step 3:** Commit: `feat(web): draw circuit from position data`.

## Task 2 — Smooth car interpolation
**Files:** Create `web/src/hooks/useSmoothedCars.ts`; Modify `web/src/components/Map.tsx`

Frames arrive ~10 Hz; raw rendering looks steppy. Interpolate each car between its previous and current position using `requestAnimationFrame`, rendering ~one frame behind so there's always a target to ease toward.

- [ ] **Step 1:** Create the hook (sketch — tune during implementation):
```ts
import { useEffect, useReducer, useRef } from 'react';
import type { Car, RaceState, Point } from '../state/race';

// Returns cars with positions interpolated at display refresh rate.
export function useSmoothedCars(state: RaceState): Car[] {
  const from = useRef<Record<number, Point>>({});
  const to = useRef<Record<number, Point>>({});
  const tFrom = useRef(0), tTo = useRef(0);
  const [, tick] = useReducer((x) => x + 1, 0);

  useEffect(() => {
    const now = performance.now();
    from.current = { ...to.current };
    const next: Record<number, Point> = {};
    for (const c of Object.values(state.cars)) next[c.driverNum] = c.p;
    to.current = next;
    tFrom.current = tTo.current || now;
    tTo.current = now;
  }, [state.rev]);

  useEffect(() => {
    let raf = 0;
    const loop = () => { tick(); raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  const now = performance.now();
  const dur = Math.max(16, tTo.current - tFrom.current);
  const t = Math.min(1, (now - tTo.current) / dur);
  return Object.values(state.cars).map((c) => {
    const a = from.current[c.driverNum] ?? c.p;
    const b = to.current[c.driverNum] ?? c.p;
    return { ...c, p: { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t } };
  });
}
```
- [ ] **Step 2:** Use it in `Map.tsx` — replace `const cars = Object.values(state.cars)` with `const cars = useSmoothedCars(state)`.
- [ ] **Step 3:** Verify visually against the synthetic clip — dots should **glide** around the circle, not jump. Tune `dur`/`t` until smooth. ⚠️ Acceptance is visual; iterate.
- [ ] **Step 4:** Commit: `feat(web): smooth car interpolation via rAF`.

## Task 3 — Loading & connection states
**Files:** Modify `web/src/realtime/socket.ts`, `web/src/App.tsx`; Create `web/src/components/StatusBadge.tsx`

- [ ] **Step 1:** Extend `connectRace` to also report connection status. Change its signature to `connectRace(onState, onStatus?)` where status ∈ `'connecting' | 'live' | 'reconnecting'`: emit `'live'` on first message after open, `'reconnecting'` in `onclose` (when not intentionally closed), `'connecting'` initially.
- [ ] **Step 2:** In `App.tsx`, hold `status` and `state`; show:
  - No snapshot yet (`state.rev === 0`): a **skeleton** map + `Warming up the timing feed…`.
  - `status === 'reconnecting'`: a `Reconnecting…` chip over the board.
  - Otherwise the live badge (`▶ REPLAY` / `● LIVE` from `state.mode`).
- [ ] **Step 3:** Verify: load with the stack down → skeleton/“warming up”; bring stack up → board appears; `docker compose stop gateway` mid-watch → `Reconnecting…`; `start` → recovers.
- [ ] **Step 4:** Commit: `feat(web): loading skeleton + connection-state UI`.

## Task 4 — Full-grid team colours
**Files:** already added in Task 1's `teamColour` map (10 teams). 
- [ ] **Step 1:** Confirm the map covers the current grid's team strings as the recorder will emit them (verify exact strings in M2b Task 6 and reconcile). Commit if changed: `feat(web): full-grid team colours`.

> **M2a done:** the app now shows a real-looking track with smoothly gliding dots + proper states — all on synthetic data, no FastF1 yet.

---

# M2b — FastF1 recorder (exploratory)

> ⚠️ These tasks depend on the **real FastF1 API and live data shapes**. Do NOT write the transform blind — load a session, inspect the actual columns/units, then build. The acceptance gate is: the Go replay player reads the baked clip and frames flow (contract match).

## Task 5 — Recorder scaffold + FastF1 exploration
**Files:** Create `ingest/requirements.txt`, `ingest/record.py`, `ingest/README.md`

- [ ] **Step 1:** `ingest/requirements.txt`: `fastf1\nnumpy`. Create a venv and install: `python -m venv .venv ; .\.venv\Scripts\python -m pip install -r ingest/requirements.txt`. (⚠️ `.venv/` is gitignored.)
- [ ] **Step 2:** Exploration script — load a recent completed race, enable cache, and **print the shape** of position data so the transform is built against reality:
```python
import fastf1, numpy as np
fastf1.Cache.enable_cache('cache')          # gitignored
s = fastf1.get_session(2024, 'Monza', 'R')
s.load(telemetry=True, laps=True, weather=False)
drv = s.drivers[0]
pos = s.pos_data[drv]                        # inspect columns: SessionTime, Status, X, Y, Z
print(pos.columns.tolist()); print(pos.head())
print('X range', pos['X'].min(), pos['X'].max())   # for unit-box normalisation
```
Run it; record the actual columns, coordinate units/ranges, and how running order is available (e.g. `s.laps`, the `Position` channel, or per-lap position). ⚠️ FastF1's first `load()` is slow + network-heavy; the cache makes reruns fast.
- [ ] **Step 3:** Commit scaffold + notes: `feat(ingest): fastf1 recorder scaffold + data notes`.

## Task 6 — Transform FastF1 → clip contract
**Files:** Modify `ingest/record.py`

- [ ] **Step 1:** Implement the transform (build against what Task 5 revealed):
  - Choose a window (exciting ~2–4 min segment via SessionTime bounds).
  - Resample every driver's X/Y onto a common grid (~10 Hz) within the window.
  - Normalise X/Y to unit box [0,1] using min/max across one full lap (so the whole track fits); flip Y if needed so it renders upright.
  - Compute the **track outline** from one clean lap of the leader's positions → header `track`.
  - Derive `pos` (running order) per frame from FastF1 timing/position data available (from Task 5 findings); map driver number → `code`/`team` from `s.get_driver(num)`.
  - Emit header line `{"track":[...],"label":"Monza 2024 · Race","maxRev":N}` then frame lines `{"timeMs":..,"frame":{rev, timeMs, cars:[{driverNum,code,team,pos,p:{x,y},status}]}}` — **exact** contract.
- [ ] **Step 2:** Acceptance — contract check: point the **existing Go replay player** at the baked clip and confirm frames flow and parse:
  `$env:Path=...; $env:CLIP_FILE='data/replays/monza-2024-race.jsonl'; go run ./cmd/server` won't help directly (needs Redis); instead add a tiny Go check OR run `docker compose up` with the new clip (Task 7). Minimum: a Python assertion that every emitted object round-trips and field names match the contract list above.
- [ ] **Step 3:** Commit: `feat(ingest): transform fastf1 session to clip contract`.

## Task 7 — Bake a real clip + make it the default
**Files:** Create `data/replays/<gp>-<year>-race.jsonl`; Modify `internal/config/config.go` default + `Dockerfile` ENV

- [ ] **Step 1:** Run the recorder to bake a **downsampled, few-MB** clip of the chosen segment; commit it (per the data strategy — short curated clips ARE committed).
- [ ] **Step 2:** Point the default `CLIP_FILE` at the real clip (config default + Dockerfile `ENV CLIP_FILE`). Keep `synthetic.jsonl` committed for tests/fallback.
- [ ] **Step 3:** Smoke: `docker compose up --build -d` → `http://localhost:8080` → the **real circuit** with the **real grid** moving smoothly. Screenshot.
- [ ] **Step 4:** Commit: `feat: default to real recorded clip`.

## Task 8 — End-to-end verify + docs
- [ ] **Step 1:** WS client check (positions changing) + browser screenshot, as in M1.
- [ ] **Step 2:** Update `web/README.md`/root notes with `ingest/` usage (how to bake more clips). Commit: `docs: recorder usage`.

---

## Self-Review checklist (run after writing code)
- Frontend consumes only the fixed contract fields; `teamColour` strings match what the recorder emits (Task 6 ↔ Task 1).
- Interpolation hook cleans up its rAF on unmount; no stale-closure on `state.rev`.
- Recorder output round-trips against `internal/model` tags exactly (the seam).
- Committed clip is downsampled + small; `.venv/`, `cache/`, full-race data are gitignored.

## Roadmap after M2
- **M3:** live FastF1 feed (`ingest/live.py` → Redis) + manual live/replay toggle.
- **M4:** cross-year side-by-side comparison + load test/benchmark + README/demo polish.
