import { useEffect, useRef, useState } from 'react';
import type { RaceState } from '../state/race';
import {
  fmtLap, fmtSec, fmtGap, gapLabel, intLabel,
  orderCars, bestSectors, updatePersonalBests, sectorColour, sectorDelta,
  TYRE_COLOUR, tyreLabel, statusLabel, sectorDeltaVs, fmtSigned,
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
  if (order.length === 0) {
    return <div className="empty">No cars yet — the timing tower fills in when data arrives.</div>;
  }
  const [b1, b2, b3] = bestSectors(order);
  const cellColour = (v: number | undefined, best: number, dn: number, i: number) => {
    const c = sectorColour(v, best, pb[dn]?.[i] ?? Infinity);
    return c ? { color: c } : undefined;
  };
  // With a reference car selected, every OTHER row's delta compares against
  // that car's same sector (the rival-relative question a race engineer asks)
  // instead of this driver's own personal best.
  const refCar = selected != null ? state.cars[selected] : undefined;
  const refSectors: (number | undefined)[] = refCar ? [refCar.s1Ms, refCar.s2Ms, refCar.s3Ms] : [];
  const cellDelta = (v: number | undefined, dn: number, i: number) =>
    refCar && dn !== selected
      ? sectorDeltaVs(v, refSectors[i])
      : sectorDelta(v, pb[dn]?.[i] ?? Infinity);

  return (
    <div>
    <button
      onClick={() => setSecondsMode((m) => !m)}
      className="btn"
      style={{ marginBottom: 6, fontSize: 11, padding: '2px 8px' }}
    >
      {secondsMode ? 'Show laps' : 'Show seconds'}
    </button>
    <div className="tt-scroll">
    <table className="tt-table">
      <thead>
        <tr>
          <th scope="col">#</th>
          <th scope="col">Driver</th>
          <th scope="col">Gap</th>
          <th scope="col">Int</th>
          <th scope="col">Last</th>
          <th scope="col">Best</th>
          <th scope="col">Tyre</th>
          <th scope="col">S1</th>
          <th scope="col">S2</th>
          <th scope="col">S3</th>
        </tr>
      </thead>
      <tbody>
        {order.map((c, idx) => {
          // Number rows by their place in the sorted order, not the raw feed
          // pos: a duplicated pos would otherwise print the same number twice
          // and skip one entirely.
          const isLeader = idx === 0;
          const ahead = order[idx - 1];
          const isSel = c.driverNum === selected;
          const status = statusLabel(c.status);
          return (
            <tr
              key={c.driverNum}
              className="tt-row"
              role="button"
              tabIndex={0}
              aria-selected={isSel}
              onClick={() => onSelect(c.driverNum)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onSelect(c.driverNum);
                }
              }}
              style={c.status === 'Out' ? { opacity: 0.5 } : undefined}
            >
              <td>{idx + 1}</td>
              <td><b>{c.code}</b></td>
              {status ? (
                <>
                  <td style={{ color: c.status === 'Pit' ? '#e8c84a' : 'var(--slate)' }}>{status}</td>
                  <td>—</td>
                </>
              ) : (
                <>
                  <td title="best-effort, derived">{gapLabel(c.gapMs, c.gapLaps, isLeader, secondsMode, c.lastLapMs)}</td>
                  <td title="best-effort, derived">{intLabel(c.gapLaps, ahead?.gapLaps, c.intMs, isLeader, secondsMode, c.lastLapMs, ahead?.lastLapMs)}</td>
                </>
              )}
              <td>{fmtLap(c.lastLapMs)}</td>
              <td>{fmtLap(c.bestLapMs)}</td>
              <td style={{ color: TYRE_COLOUR[c.tyre ?? ''] ?? 'var(--chalk)' }}>
                {tyreLabel(c.tyre, c.tyreAge)}
              </td>
              {([[c.s1Ms, b1, 0], [c.s2Ms, b2, 1], [c.s3Ms, b3, 2]] as const).map(([v, best, i]) => {
                const d = cellDelta(v, c.driverNum, i);
                const rivalMode = !!refCar && c.driverNum !== selected;
                return (
                  <td key={i} style={cellColour(v, best, c.driverNum, i)}>
                    {fmtSec(v)}
                    {d !== undefined && (
                      <sup style={{
                        fontSize: 9, marginLeft: 3,
                        color: rivalMode ? (d < 0 ? '#3bb273' : 'var(--slate)') : 'var(--slate)',
                      }}>
                        {rivalMode ? fmtSigned(d) : fmtGap(d)}
                      </sup>
                    )}
                  </td>
                );
              })}
            </tr>
          );
        })}
      </tbody>
    </table>
    </div>
    <div className="empty" style={{ fontSize: 10, marginTop: 4 }}>
      Gap / Int are estimates derived from track position, not official timing.
      {refCar && ` Click a row to set the reference car — sector deltas compare against ${refCar.code}.`}
    </div>
    <div className="empty" style={{ fontSize: 10, marginTop: 2, display: 'flex', gap: 10 }}>
      {([['SOFT', 'S Soft'], ['MEDIUM', 'M Medium'], ['HARD', 'H Hard'],
         ['INTERMEDIATE', 'I Inter'], ['WET', 'W Wet']] as const).map(([t, label]) => (
        <span key={t} style={{ color: TYRE_COLOUR[t] }}>{label}</span>
      ))}
    </div>
    </div>
  );
}
