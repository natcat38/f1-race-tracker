# Phase 5 — Pit-wall completion: make the race-engineer story real

> **Status: as-executed, archived retroactively.** This plan drove the work shipped in
> commit `32957a1` / PR [#39](https://github.com/natcat38/f1-race-tracker/pull/39)
> ("Pit-wall completion — strategy, weather, live-field coverage"). It originally lived
> only as a local, uncommitted plan file, which meant it wasn't reviewable by anyone
> cloning the repo — see issue [#36](https://github.com/natcat38/f1-race-tracker/issues/36).
> Committed here unchanged in substance (light formatting only) to restore the
> per-milestone plan pattern the earlier phases established. The described decisions
> (contract fields, clip re-bake windows, feature scope) are recorded as landed;
> `docs/F1_Race_Tracker_Product_Scope.md` and `CONTEXT.md` are the current source of
> truth for the shipped product, not this plan.

## Context

Evaluation of branch `feat/pit-wall-race-engineer-polish` found the pipeline solid (Python bake → Redis → Go gateway → WebSocket → React; `docker compose up` just works) but the product can't deliver its "you're the race engineer" promise:

- **All three replay clips are laps 1–5 slices** — hardcoded `WINDOW_START_S = 3300 / WINDOW_END_S = 3750` in [record.py:66-67](../../../ingest/record.py). Verified: 90,000/90,000 car frames are `status:"OnTrack"`, zero pit stops, no tyre-age resets. Strategy signals are structurally impossible.
- **Two CI blockers uncommitted**: `internal/model/model.go` fails `gofmt`; new `lap`/`totalLaps` fields missing from the golden contract fixture.
- **Missing analysis features**: stint history, weather, gap trends, rival sector deltas, two-car telemetry compare. The "LIVE" toggle silently plays a second replay clip. `live_signalr.py` is positions-only and unverified.

User decisions: re-bake all three clips around a pit window; label live honestly; do all polish; build ALL formerly-deferred features. Docs may be amended freely.

**Ordering rule**: Phase 1 extends the wire contract with everything later phases need, so clips are re-baked exactly once.

**Contract discipline (applies to every phase)**: any field added to the Go model MUST land, in the same commit, in all of:
1. [internal/model/model.go](../../../internal/model/model.go) (+ [apply.go](../../../internal/model/apply.go) if frame-carried)
2. TS mirror [web/src/state/race.ts](../../../web/src/state/race.ts) (interfaces, `parseMsg` guards, `applyMessage`)
3. Python builders `build_snapshot`/`build_frame` in [ingest/live.py:51-64](../../../ingest/live.py)
4. [ingest/check_live_contract.py](../../../ingest/check_live_contract.py) key sets
5. Golden fixture [testdata/contract/golden_snapshot.json](../../../testdata/contract/golden_snapshot.json) + BOTH its tests: [internal/model/contract_test.go](../../../internal/model/contract_test.go) and [web/src/state/contract.test.ts](../../../web/src/state/contract.test.ts)

---

## Phase 0 — CI blockers

1. `gofmt -w internal/model/model.go` (the new `Lap` field broke struct-tag alignment; CI has a hard `gofmt -l` gate).
2. Golden fixture: add `"lap": 12` to car `"1"` and top-level `"totalLaps": 53` in [golden_snapshot.json](../../../testdata/contract/golden_snapshot.json). Assert in [contract_test.go](../../../internal/model/contract_test.go) (`c1.Lap != 12`, `s.TotalLaps != 53`) and [contract.test.ts](../../../web/src/state/contract.test.ts) (`s.cars[1].lap`, `s.totalLaps`).

**Gate**: `gofmt -l .` prints nothing; `go test ./internal/model/...`; `cd web && npx vitest run src/state/contract.test.ts`.

---

## Phase 1 — Contract extension + single re-bake

### 1a. Go model

[model.go](../../../internal/model/model.go) — add after `RadioMessage`:

```go
// Stint is one tyre stint from the full-race lap data (session-constant, like LapTrace).
type Stint struct {
	Compound string `json:"compound"` // "SOFT"|"MEDIUM"|"HARD"|"INTERMEDIATE"|"WET"
	StartLap int    `json:"startLap"`
	EndLap   int    `json:"endLap"`
}

// Weather is a low-rate sample (~1/min at bake). Rides on a frame when it
// changes; folded into the snapshot by Apply.
type Weather struct {
	AirTempC   float64 `json:"airTempC"`
	TrackTempC float64 `json:"trackTempC"`
	Rainfall   bool    `json:"rainfall"`
}
```

- `Snapshot`: `Stints map[int][]Stint \`json:"stints,omitempty"\`` and `Weather *Weather \`json:"weather,omitempty"\`` (place near `LapTrace`/`TotalLaps`).
- `Frame`: `Weather *Weather \`json:"weather,omitempty"\``.
- [apply.go](../../../internal/model/apply.go) inside `Apply`, before `s.TimeMs = f.TimeMs`:
  ```go
  if f.Weather != nil {
  	s.Weather = f.Weather
  }
  ```
- [play.go:16-23](../../../internal/feed/replay/play.go): `clipHeader` gains `Stints map[int][]model.Stint \`json:"stints"\``; `Source` gains field + accessor `func (s *Source) Stints() map[int][]model.Stint`; wire through `Load` (mirror how `totalLaps` was added in this branch's diff — see `git diff internal/feed/replay/play.go`).
- [writer.go:14-22](../../../internal/app/writer.go): `Source` interface gains `Stints() map[int][]model.Stint`; in `Run`, `snap.Stints = wr.src.Stints()` next to `snap.TotalLaps`. **Find all `Source` implementations first** — `grep -rn "TotalLaps() int" internal cmd` — and add `Stints()` to each (there is at least the replay source and test stubs in `writer_test.go`/`play_test.go`; a synthetic source may exist too).
- Extend `writer_test.go` to assert `snap.Stints` passes through, mirroring its existing `TotalLaps` assertion.

### 1b. TS mirror

[race.ts](../../../web/src/state/race.ts):
```ts
export interface Stint { compound: string; startLap: number; endLap: number }
export interface Weather { airTempC: number; trackTempC: number; rainfall: boolean }
```
- `RaceState` + `SnapshotData`: `stints?: Record<number, Stint[]>` (RaceState non-optional, default `{}`), `weather?: Weather`. `FrameData`: `weather?: Weather`.
- `emptyState()`: `stints: {}` (weather stays undefined).
- `applyMessage` snapshot branch: `stints: d.stints ?? {}, weather: d.weather,`. Frame branch: `weather: d.weather ?? s.weather` in the returned object.
- `parseMsg`: reject present-but-wrong-typed values, same style as the existing guards ([race.ts:75-77](../../../web/src/state/race.ts)): `stints` must be a non-array object when present; `weather` must be a non-array object when present (both snapshot and frame).

### 1c. Python mirror

- [live.py:51-64](../../../ingest/live.py): `build_snapshot(..., stints, total_laps, rev)` adds `"stints": stints` (always present, default `{}` at call sites — matches how `lapTrace` behaves). `build_frame(..., weather=None)` adds `"weather": weather` only when not None (same omission pattern as `messages`).
- Clip-replay path ([live.py:77-88](../../../ingest/live.py)): `stints = header.get("stints", {})`, pass through; pass frame-line `weather` through if present in the clip line's frame dict.
- Update every `build_snapshot(`/`build_frame(` call site: `grep -n "build_snapshot(\|build_frame(" ingest/*.py` — includes [live_signalr.py](../../../ingest/live_signalr.py) (pass `{}` / `None` there for now; Phase 4 improves it).
- [check_live_contract.py](../../../ingest/check_live_contract.py): add `"stints"` to `SNAP_KEYS` ([line 9](../../../ingest/check_live_contract.py)); new test asserting `weather` is omitted from frames when None and present when passed (mirror `test_frame_messages_key_optional`).

### 1d. Golden fixture + both contract tests

Add to [golden_snapshot.json](../../../testdata/contract/golden_snapshot.json):
```json
"stints": { "1": [ {"compound": "SOFT", "startLap": 1, "endLap": 14},
                    {"compound": "HARD", "startLap": 15, "endLap": 53} ] },
"weather": { "airTempC": 28.5, "trackTempC": 41.2, "rainfall": false }
```
Assert in [contract_test.go](../../../internal/model/contract_test.go): `len(s.Stints[1]) == 2`, `s.Stints[1][1].Compound == "HARD"`, `s.Weather.TrackTempC == 41.2`, `!s.Weather.Rainfall`. Mirror in [contract.test.ts](../../../web/src/state/contract.test.ts): `s.stints[1]` length 2, compound, `s.weather?.trackTempC`.

### 1e. record.py: lap-window args + stints + weather

[record.py](../../../ingest/record.py):

1. **Args** (near [line 47-51](../../../ingest/record.py)): `--start-lap` / `--end-lap` (int, default None). After `session.laps` is available, when both given:
   ```python
   lap_starts = session.laps.groupby('LapNumber')['LapStartTime'].min()
   WINDOW_START_S = int(lap_starts.loc[args.start_lap].total_seconds())
   nxt = args.end_lap + 1
   WINDOW_END_S = (int(lap_starts.loc[nxt].total_seconds())
                   if nxt in lap_starts.index else WINDOW_START_S + 450)
   print(f"Window from laps {args.start_lap}-{args.end_lap}: {WINDOW_START_S}s -> {WINDOW_END_S}s")
   ```
   Keep the constants as defaults when flags absent. Warn (reuse the 25 MB warning style) if the window exceeds ~600 s.
2. **Stints** (near the `lapnum_lookup` block, [record.py:413-429](../../../ingest/record.py)) — whole-race stints per driver:
   ```python
   stints = {}
   for num in session.drivers:
       inum = int(num)
       if inum not in driver_info: continue
       drv = session.laps.pick_drivers(num)
       out = []
       for _, grp in drv.groupby('Stint'):
           grp = grp.dropna(subset=['LapNumber'])
           if grp.empty or pd.isna(grp['Compound'].iloc[0]): continue
           out.append({"compound": str(grp['Compound'].iloc[0]),
                       "startLap": int(grp['LapNumber'].min()),
                       "endLap": int(grp['LapNumber'].max())})
       if out: stints[inum] = out
   ```
   Add `"stints": stints` to the header dict at [record.py:545-552](../../../ingest/record.py).
3. **Weather**: `wx = session.weather_data` (columns `Time` [session Timedelta], `AirTemp`, `TrackTemp`, `Rainfall` [bool]; ~1-min cadence). Build a step-lookup; in the frame-emit loop ([record.py:556+](../../../ingest/record.py)), compute the current sample per grid tick (round temps to 0.1) and attach `"weather": {"airTempC":…, "trackTempC":…, "rainfall":…}` to the frame dict **only when it differs from the last emitted one** (always emit on frame 1 so the snapshot gets seeded).
4. **Post-write assertions** ([record.py:675+](../../../ingest/record.py)): header `stints` non-empty for ≥ 15 drivers; ≥ 1 frame carries `weather`; and when `--start-lap` was used, assert ≥ 1 frame car has `"status": "Pit"` — the whole point of the re-bake.

### 1f. Re-bake all three clips (network + FastF1 cache under `cache/`)

For each session, FIRST inspect pit-stop laps before choosing the window (don't guess):
```python
laps = session.laps
print(laps[~laps['PitInTime'].isna()][['Driver', 'LapNumber']].sort_values('LapNumber'))
```
Pick a green-flag ~7.5-min window with ≥ 3 top-10 stops (green-flag: check `session.race_control_messages` for SC/red flags in range). Expected ballparks — verify against actual data: Monza 2024 ≈ laps 13–20; Monza 2023 similar; Silverstone 2024 → the rain-stop phase ≈ laps 25–33 (inters + `rainfall:true` = best demo).

```bash
python ingest/record.py data/replays/monza-2024-race.jsonl --year 2024 --gp Monza --start-lap <N> --end-lap <M>
python ingest/record.py data/replays/monza-2023-race.jsonl --year 2023 --gp Monza --start-lap <N> --end-lap <M>
python ingest/record.py data/replays/silverstone-2024-race.jsonl --year 2024 --gp Silverstone --start-lap <N> --end-lap <M>
```
Run sequentially (FastF1 memory). First run per session is slow (downloads).

**Gates**: each file < 25 MB; `grep -c '"status":"Pit"' <file>` > 0 for each; `go test ./...`; `cd web && npm test`; `python -m pytest ingest`; `docker compose up --build -d` then confirm `stints`/`weather` arrive (devtools WS message or `docker compose exec redis redis-cli GET snapshot:replay | head -c 2000`).

⚠️ The compare lanes assume identical-length clips for wall-clock phasing ([play.go:144](../../../internal/feed/replay/play.go) — average-gap-derived `loopLen`). Keep the two Monza windows the same lap-count/duration.

---

## Phase 2 — Pit-wall UX polish

1. **Map pit/out** ([Map.tsx:15-20](../../../web/src/components/Map.tsx)):
   ```tsx
   {cars.filter((c) => c.status !== 'Out').map((c) => (
     <g key={c.driverNum} opacity={c.status === 'Pit' ? 0.35 : 1}>
   ```
2. **Tower pit/out** ([TimingTower.tsx:90-91](../../../web/src/components/TimingTower.tsx)): when `c.status === 'Pit'` render `IN PIT` in the Gap cell (colour `#e8c84a`) and `—` in Int; when `'Out'` render `OUT` (colour `var(--slate)`) and grey the row (`opacity: 0.5` on the `<tr>` style). Put the label logic in a small `statusLabel(status)` helper in [timingHelpers.ts](../../../web/src/components/timingHelpers.ts) and cover it in `TimingTower.test.ts` (existing test file, pure-helper style).
3. **Tyre format unification**: new helper in timingHelpers —
   ```ts
   export function tyreLabel(tyre?: string, age?: number): string {
     if (!tyre) return '—';
     return `${tyre[0]}${age ? age : ''}`;
   }
   ```
   Use in [TimingTower.tsx:95](../../../web/src/components/TimingTower.tsx) (currently `S 5` with a space) and [Standings.tsx:16](../../../web/src/components/Standings.tsx) (currently `S5`) — the compact `S5` form wins.
4. **Tyre legend**: extend the footnote div ([TimingTower.tsx:116-118](../../../web/src/components/TimingTower.tsx)) with swatches built from `TYRE_COLOUR` ([timingHelpers.ts:77-80](../../../web/src/components/timingHelpers.ts)): `S Soft · M Medium · H Hard · I Inter · W Wet`, each letter in its colour.
5. **Race-control timestamps** ([RaceControl.tsx:26-36](../../../web/src/components/RaceControl.tsx)): prepend `<span style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtClock(m.t)}</span>` (import `fmtClock` from timingHelpers; `m.t` is session-relative ms per [model.go:45](../../../internal/model/model.go)).
6. **Honest live label** ([SourceToggle.tsx:4-7](../../../web/src/components/SourceToggle.tsx)): `{ key: 'live', label: '● Live (demo)' }` + `title="Demo lane streaming a second replay clip — real live ingestion not yet verified"` on the button. Busy feedback: while `busy`, the clicked button's label gets an `…` suffix (track `pending` key in state). Also check [StatusBadge.tsx](../../../web/src/components/StatusBadge.tsx) for a `LIVE` badge string and apply the same `(demo)` suffix when `state.session === 'live'`.
7. **Cleanups**: delete `.navlink` block ([components.css:298-306](../../../web/src/styles/components.css)); check [Comms.tsx](../../../web/src/components/Comms.tsx) has empty-state copy when the layer is on but no radio yet — add "No radio in this window yet." if missing. (RaceControl already has "No incidents." — leave it.)

**Gate**: `cd web && npm run lint && npm test && npm run build`; compose up → watch a pit stop read on map + tower.

---

## Phase 3 — Strategy & analysis features

1. **Stint timeline panel** — new `web/src/components/StintChart.tsx`:
   - Props `{ state: RaceState }`. For each car in `orderCars(state.cars)` with `state.stints[c.driverNum]`: a row `[code | flex bar]`; the bar is a `position:relative` div; each stint a child div at `left: ${(startLap-1)/totalLaps*100}%`, `width: ${(endLap-startLap+1)/totalLaps*100}%`, background `TYRE_COLOUR[compound]`, height ~10px, 1px gap.
   - Current-lap marker: one absolute white 1px vertical line at `leaderLap/totalLaps*100%` (derive `leaderLap` exactly as [StatusRail.tsx:31](../../../web/src/components/StatusRail.tsx) does).
   - Footnote (`className="empty"`, matching the tower's): "Full-race stint plan baked from session data — the replay window sits inside it."
   - Mount in [App.tsx:67-80](../../../web/src/App.tsx) as `<Panel label="Strategy">` (fourth panel in `board-bottom`); change `.board-bottom` grid ([components.css:265-269](../../../web/src/styles/components.css)) to `repeat(4, minmax(220px, 1fr))` (media query at 1100px already collapses to 1fr); add `.board-bottom .panel:nth-child(4) { animation-delay: 180ms; }` beside [components.css:322-324](../../../web/src/styles/components.css).
2. **Gap-trend sparkline**:
   - timingHelpers: `export type GapHistory = Record<number, { lap: number; gaps: number[] }>` and pure `updateGapHistory(prev, cars)` — when `c.lap` is set and `> prev[c.driverNum]?.lap`, append `c.gapMs ?? 0` (cap 8, mirror `updateLapHistory`'s reference-equality bail-out at [timingHelpers.ts:144-155](../../../web/src/components/timingHelpers.ts)). Unit-test beside the lap-history tests.
   - New hook `web/src/hooks/useGapHistory.ts`: copy [useLapHistory.ts](../../../web/src/hooks/useLapHistory.ts) verbatim including the session/loop-seam reset (`state.timeMs < timeMsRef.current`), swapping the fold function.
   - [TelemetryPanel.tsx](../../../web/src/components/TelemetryPanel.tsx): new prop `gapHistory?: number[]`; render a second sparkline row labelled "Gap" when length ≥ 2 (existing `Sparkline` red/green semantics already read as growing/shrinking); trailing value via `fmtGap`. Wire in [App.tsx:69-72](../../../web/src/App.tsx).
3. **Per-rival sector deltas** ([TimingTower.tsx:40-41](../../../web/src/components/TimingTower.tsx) + timingHelpers):
   - New pure helper `sectorDeltaVs(v, ref)` → signed ms (`v - ref`) when both present, else undefined; and `fmtSigned(ms)` → `+0.312` / `−0.145`.
   - In the tower: when `selected != null && c.driverNum !== selected`, superscript shows `fmtSigned(sectorDeltaVs(v, selectedCar[sNMs]))` — green when negative (faster than the reference), slate when positive; when no selection, keep today's personal-best delta. Add cases to `TimingTower.test.ts` for both modes.
   - Update the footnote: "Click a row to set the reference car — sector deltas compare against it."
4. **Two-car telemetry compare**:
   - [App.tsx](../../../web/src/App.tsx): `const [rival, setRival] = useState<number | null>(null)`; clear rival when `selected` changes to null or equals rival; pass `rivalCar={rival != null ? state.cars[rival] : undefined}`, `rivalHistory`, `cars={orderCars(state.cars)}`, `onRival={setRival}`.
   - [TelemetryPanel.tsx](../../../web/src/components/TelemetryPanel.tsx): when a primary car is shown, render a native `<select value={rival ?? ''} onChange=…>` labelled "vs" listing other cars (`— none —` default). With a rival set: two-column grid (`grid-template-columns: 1fr 1fr`), second column repeating the code/team, speed/gear/DRS, throttle/brake bars, lap sparkline for the rival. No new dependencies.
5. **Weather chip** ([StatusRail.tsx:40-42](../../../web/src/components/StatusRail.tsx)): after the lap counter:
   ```tsx
   {state.weather && (
     <span className="rail-lap" title="Baked from session weather data">
       TRK {state.weather.trackTempC.toFixed(0)}° · AIR {state.weather.airTempC.toFixed(0)}°
       {state.weather.rainfall && <span style={{ color: '#3671C6' }}> · RAIN</span>}
     </span>
   )}
   ```

**Gate**: `npm run lint && npm test && npm run build`; compose up → Silverstone lane shows RAIN + inter stints in the chart; two-car compare renders; selecting a row flips sector-delta mode.

---

## Phase 4 — Live client hardening ([live_signalr.py](../../../ingest/live_signalr.py))

Real-session verification is impossible offline — the deliverables are field coverage, a regression harness, and a runbook. Keep the existing `UNVERIFIED:` comment convention on every assumed message shape.

1. **Field coverage**: extend the message handlers to populate per-car `lap`, `lastLapMs`, `gapMs`/`intMs` (from `TimingData` — `Lines.<num>.LastLapTime.Value`, `GapToLeader`, `IntervalToPositionAhead.Value`, `NumberOfLaps`) and `tyre`/`tyreAge` (from `TimingAppData` `Stints`). The snapshot/frame build sites ([live_signalr.py:290,432,494-501](../../../ingest/live_signalr.py)) stop hardcoding empty timing fields. Time strings like `"1:25.633"` need a parse helper → ms; gaps like `"+1.2"`/`"1L"` need tolerant parsing (laps → `gapLaps`).
2. **Capture-replay regression test**: new `ingest/test_capture_replay.py` (pytest picks up `ingest/` already — same collection as `check_live_contract.py`) + a small synthetic fixture `ingest/tests/capture_sample.txt` in the exact format `_replay_capture` ([live_signalr.py:235-394](../../../ingest/live_signalr.py)) consumes, containing a `DriverList`, a few `Position.z` messages, and `TimingData`/`TimingAppData` samples. The test drives the capture path and asserts the built snapshot carries positions AND the new timing/tyre fields.
3. **Runbook**: `docs/runbooks/live-verification.md` — prerequisites (`pip install -r ingest/requirements-live.txt`), the double opt-in (`--live` + `LIVE=1`, per [live.py:132](../../../ingest/live.py) and [live_signalr.py:678](../../../ingest/live_signalr.py)), what to watch during a real session, how to save a `CAPTURE_FILE` for regression, and the definition of "verified" (each `UNVERIFIED:` assumption confirmed or corrected). CI runs `lychee` — make internal links valid.
4. Structural-check mode must still exit 0 with no network.

**Gate**: `python -m pytest ingest`; `python ingest/check_live_contract.py` exits 0.

---

## Phase 5 — Docs reconciliation

- [README.md](../../../README.md): demo description now includes the pit window (stops, stints, weather, rain on the Silverstone lane); shrink "What's not done" to what remains true (real-session live verification pending → link the runbook; gaps still position-derived estimates).
- [docs/F1_Race_Tracker_Product_Scope.md](../../F1_Race_Tracker_Product_Scope.md) + [Tech Scope](../../F1_Race_Tracker_Tech_Scope.md): record the clip-window change, new contract fields (`stints`, `weather`, `lap`, `totalLaps`), `Live (demo)` labeling, and the new analysis features (stint chart, gap trend, rival deltas, two-car compare).
- [docs/ux-evaluation-2026-07.md](../../ux-evaluation-2026-07.md): add a dated "Resolved" note per finding this work closes (P2 interval, P3 empty states, etc.).
- [CONTEXT.md](../../../CONTEXT.md): glossary entries for *stint*, *weather*, *reference car / rival delta*, in the existing voice.

---

## Final verification

1. `gofmt -l .` empty; `go vet ./...`; `go test ./...` (plain — `-race` is CI-only on this machine, no local cgo).
2. `cd web && npm run lint && npm test && npm run build` (eslint runs `--max-warnings 0`).
3. `python -m pytest ingest bench`; `ruff check ingest`.
4. `docker compose up --build -d` → `http://localhost:8080`: watch a pit stop (map dim → IN PIT tag → compound change → stint bar), gap sparkline, rival sector deltas, two-car compare, weather chip + RAIN on the Silverstone lane, `Live (demo)` label, `#compare` and `#ghost` still coherent on the re-baked Monza pair.
5. Each `.jsonl` < 25 MB; data diff dominates the branch diff — expected.

## Execution notes

- Commit per phase (0+1 may merge — the fixture edits overlap). Never skip hooks.
- FastF1 bakes need network; run the three sequentially; cache under `cache/` may already be warm.
- All new snapshot/frame fields are optional/`omitempty` so `synthetic.jsonl` and stale clips still parse.
- When adding `Stints()` to the `Source` interface, compile errors are the to-do list — fix every implementation the compiler names (including test stubs).
- Keep the two Monza clips the same lap-window length (wall-clock phase alignment in [play.go:144-183](../../../internal/feed/replay/play.go) assumes identical-length clips).
