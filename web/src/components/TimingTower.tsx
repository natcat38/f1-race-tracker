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
      className="btn"
      style={{ marginBottom: 6, fontSize: 11, padding: '2px 8px' }}
    >
      {secondsMode ? 'Show laps' : 'Show seconds'}
    </button>
    <table className="tt-table">
      <thead>
        <tr>
          <th>#</th>
          <th>Driver</th>
          <th>Gap</th>
          <th>Int</th>
          <th>Last</th>
          <th>Best</th>
          <th>Tyre</th>
          <th>S1</th>
          <th>S2</th>
          <th>S3</th>
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
              className="tt-row"
              tabIndex={0}
              aria-selected={isSel}
              onClick={() => onSelect(c.driverNum)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onSelect(c.driverNum);
                }
              }}
            >
              <td>{c.pos}</td>
              <td><b>{c.code}</b></td>
              <td title="best-effort, derived">{gapLabel(c.gapMs, c.gapLaps, isLeader, secondsMode, c.lastLapMs)}</td>
              <td title="best-effort, derived">{intLabel(c.gapLaps, ahead?.gapLaps, c.intMs, isLeader, secondsMode, c.lastLapMs, ahead?.lastLapMs)}</td>
              <td>{fmtLap(c.lastLapMs)}</td>
              <td>{fmtLap(c.bestLapMs)}</td>
              <td style={{ color: TYRE_COLOUR[c.tyre ?? ''] ?? 'var(--chalk)' }}>
                {c.tyre ? `${c.tyre[0]}${c.tyreAge ? ` ${c.tyreAge}` : ''}` : '—'}
              </td>
              <td style={cellColour(c.s1Ms, b1, c.driverNum, 0)}>{fmtSec(c.s1Ms)}</td>
              <td style={cellColour(c.s2Ms, b2, c.driverNum, 1)}>{fmtSec(c.s2Ms)}</td>
              <td style={cellColour(c.s3Ms, b3, c.driverNum, 2)}>{fmtSec(c.s3Ms)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
    </div>
  );
}
