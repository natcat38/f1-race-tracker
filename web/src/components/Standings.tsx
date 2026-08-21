import type { RaceState } from '../state/race';
import { fmtLap, gapLabel, lapsDown, orderCars, TYRE_COLOUR, tyreLabel } from './timingHelpers';

// Standings is the #compare view's per-lane readout: an uncomputed, raw-field
// list (tyre/last lap/gap) — CONTEXT.md draws a deliberate line between compare
// ("uncomputed side-by-side") and ghost overlay ("computation is what sets it
// apart"), so no cross-year math belongs here.
export function Standings({ state }: { state: RaceState }) {
  const order = orderCars(state.cars);
  return (
    // A grid rather than wrapped inline spans: entries used to break mid-phrase
    // ("+1 / LAP") and wrap inconsistently row to row, which made a list of
    // twenty numbers ragged and much harder to scan than the board's table.
    <ol className="standings" style={{ margin: 0, padding: 0, listStyle: 'none' }}>
      {order.map((c, idx) => (
        <li key={c.driverNum} className="standings-row">
          <span className="standings-pos">{idx + 1}</span>
          <b>{c.code}</b>
          <span style={{ color: TYRE_COLOUR[c.tyre ?? ''] ?? 'var(--slate)' }}>
            {tyreLabel(c.tyre, c.tyreAge)}
          </span>
          <span>{fmtLap(c.lastLapMs)}</span>
          <span style={{ color: 'var(--slate)' }}>
            {/* Leader is the front of orderCars' running order, not a literal
                pos===1 match (#66) — same test TimingTower uses, so a frame with
                no exact pos:1 still labels someone LEADER instead of nobody. */}
            {gapLabel(c.gapMs, lapsDown(c.gapLaps, c.gapMs, order[0]?.lastLapMs), idx === 0, false, c.lastLapMs)}
          </span>
        </li>
      ))}
    </ol>
  );
}
