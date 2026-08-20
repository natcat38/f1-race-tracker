import type { RaceState } from '../state/race';
import { fmtClock, TYRE_COLOUR } from './timingHelpers';

const MAX_SHOWN = 8;

// Category labels/colours for FastF1's race-control feed. Falls back to an
// uppercased raw category for anything not in this table rather than hiding it.
const CATEGORY: Record<string, { label: string; colour: string }> = {
  Flag: { label: 'FLAG', colour: TYRE_COLOUR.MEDIUM },
  SafetyCar: { label: 'SAFETY CAR', colour: 'var(--amber)' },
  Drs: { label: 'DRS', colour: 'var(--good)' },
  CarEvent: { label: 'CAR', colour: 'var(--chalk)' },
  Other: { label: 'NOTE', colour: 'var(--slate)' },
};

// RaceControl is a passive feed of the most recent race-control messages
// (flags, safety car, investigations), newest first.
export function RaceControl({ state }: { state: RaceState }) {
  if (state.messages.length === 0) return <div className="empty">No incidents.</div>;
  const recent = state.messages.slice(-MAX_SHOWN).reverse();

  return (
    <div style={{ display: 'grid', gap: 4 }}>
      {recent.map((m, i) => {
        const cat = CATEGORY[m.category] ?? { label: m.category.toUpperCase(), colour: 'var(--chalk)' };
        return (
        <div key={`${m.rev}-${i}`} style={{
          display: 'flex', alignItems: 'baseline', gap: 8, fontSize: 'var(--fs-sm)', color: 'var(--slate)',
        }}>
          <span style={{ fontVariantNumeric: 'tabular-nums', fontSize: 'var(--fs-2xs)' }}>{fmtClock(m.t)}</span>
          <span style={{ color: cat.colour, fontWeight: 700, fontSize: 'var(--fs-2xs)', letterSpacing: '0.08em' }}>
            {cat.label}
          </span>
          <span>{m.message}</span>
          {m.driver != null && state.cars[m.driver] && (
            <span style={{ color: 'var(--slate)' }}>({state.cars[m.driver].code})</span>
          )}
        </div>
        );
      })}
    </div>
  );
}
