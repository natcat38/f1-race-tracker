import type { RaceState } from '../state/race';
import { fmtLap, gapLabel, orderCars, TYRE_COLOUR, tyreLabel } from './timingHelpers';

// Standings is the #compare view's per-lane readout: an uncomputed, raw-field
// list (tyre/last lap/gap) — CONTEXT.md draws a deliberate line between compare
// ("uncomputed side-by-side") and ghost overlay ("computation is what sets it
// apart"), so no cross-year math belongs here.
export function Standings({ state }: { state: RaceState }) {
  const order = orderCars(state.cars);
  return (
    <ol style={{ lineHeight: 1.8, margin: 0, paddingLeft: '1.4em', fontVariantNumeric: 'tabular-nums' }}>
      {order.map((c) => (
        <li key={c.driverNum}>
          <b>{c.code}</b>{' '}
          <span style={{ color: TYRE_COLOUR[c.tyre ?? ''] ?? 'var(--slate)' }}>
            {tyreLabel(c.tyre, c.tyreAge)}
          </span>{' '}
          <span>{fmtLap(c.lastLapMs)}</span>{' '}
          <span style={{ color: 'var(--slate)' }}>
            {gapLabel(c.gapMs, c.gapLaps, c.pos === 1, false, c.lastLapMs)}
          </span>
        </li>
      ))}
    </ol>
  );
}
