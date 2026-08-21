import type { RaceControlMessage, RaceState } from '../state/race';
import { fmtClock, TYRE_COLOUR } from './timingHelpers';

const MAX_SHOWN = 8;

// Stable per-message identity, so React prepends one node to the log instead of
// re-keying all eight. The old key was `${m.rev}-${i}` over a REVERSED slice, so
// every existing row's key shifted the moment a new message arrived — which under
// the live region added below would have re-announced the entire backlog each
// time. applyMessage keeps existing message objects by reference when it appends,
// so object identity is the honest key; a WeakMap lets them be collected with the
// state that holds them.
const messageIds = new WeakMap<RaceControlMessage, number>();
let nextMessageId = 0;
function idOf(m: RaceControlMessage): number {
  let id = messageIds.get(m);
  if (id === undefined) {
    id = nextMessageId++;
    messageIds.set(m, id);
  }
  return id;
}

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
    // The one feed on the board where a *change* is inherently newsworthy — flags,
    // safety cars, investigations — and the only one that was announced nowhere.
    // role="log" is the right role for a chronological message feed; it is safe to
    // make polite here because this stream is genuinely low-frequency, unlike the
    // 10 Hz timing tower, which is deliberately kept out of every live region.
    <div style={{ display: 'grid', gap: 4 }} role="log" aria-live="polite" aria-relevant="additions">
      {recent.map((m) => {
        const cat = CATEGORY[m.category] ?? { label: m.category.toUpperCase(), colour: 'var(--chalk)' };
        return (
        <div key={idOf(m)} style={{
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
