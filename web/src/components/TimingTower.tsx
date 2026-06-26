import { useEffect, useRef, useState } from 'react';
import type { RaceState } from '../state/race';
import {
  fmtLap, fmtSec, gapLabel, intLabel,
  orderCars, bestSectors, updatePersonalBests, sectorColour,
  TYRE_COLOUR,
} from './timingHelpers';
import type { Bests } from './timingHelpers';

export function TimingTower({
  state, selected, onSelect,
}: {
  state: RaceState;
  selected: number | null;
  onSelect: (driverNum: number) => void;
}) {
  const [secondsMode, setSecondsMode] = useState(false);
  const [pb, setPb] = useState<Bests>({});
  const pbRef = useRef<Bests>({});
  const sessionRef = useRef(state.session);

  useEffect(() => {
    // New session (e.g. replay <-> live switch): drop the previous clip's
    // personal bests so sector colours don't bleed across datasets.
    if (sessionRef.current !== state.session) {
      sessionRef.current = state.session;
      pbRef.current = {};
    }
    const next = updatePersonalBests(pbRef.current, orderCars(state.cars));
    pbRef.current = next;
    setPb(next);
  }, [state.rev, state.session]); // eslint-disable-line react-hooks/exhaustive-deps

  const order = orderCars(state.cars);
  const [b1, b2, b3] = bestSectors(order);
  const cellColour = (v: number | undefined, best: number, dn: number, i: number) => {
    const c = sectorColour(v, best, pb[dn]?.[i] ?? Infinity);
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
          <th style={{ padding: '2px 8px' }}>Best</th>
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
              <td style={{ padding: '2px 8px' }}>{fmtLap(c.bestLapMs)}</td>
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
