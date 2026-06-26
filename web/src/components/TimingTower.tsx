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
