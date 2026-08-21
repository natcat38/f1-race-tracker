// The race-control log: the most recent marshalling messages, announced politely as
// they arrive.

import type { RaceControlMessage, RaceState } from '../state/race';
import { fmtClock, needsDriverTag, splitWallClock } from './timingHelpers';

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
  // --amber, not the medium-compound yellow this used to borrow: "flags" is
  // literally named in --amber's own docstring, and SafetyCar one line below was
  // already using it — the file disagreed with itself within two lines.
  Flag: { label: 'FLAG', colour: 'var(--amber)' },
  SafetyCar: { label: 'SAFETY CAR', colour: 'var(--amber)' },
  Drs: { label: 'DRS', colour: 'var(--good)' },
  CarEvent: { label: 'CAR', colour: 'var(--chalk)' },
  Other: { label: 'NOTE', colour: 'var(--slate)' },
};

// RaceControl is a passive feed of the most recent race-control messages
// (flags, safety car, investigations), newest first.
export function RaceControl({ state, selected }: { state: RaceState; selected?: number | null }) {
  if (state.messages.length === 0) return <div className="empty">No incidents.</div>;
  const recent = state.messages.slice(-MAX_SHOWN).reverse();

  return (
    // The one feed on the board where a *change* is inherently newsworthy — flags,
    // safety cars, investigations — and the only one that was announced nowhere.
    // role="log" is the right role for a chronological message feed; it is safe to
    // make polite here because this stream is genuinely low-frequency, unlike the
    // 10 Hz timing tower, which is deliberately kept out of every live region.
    <div style={{ display: 'grid', gap: 'var(--sp-1)' }} role="log" aria-live="polite" aria-relevant="additions">
      {recent.map((m) => {
        const cat = CATEGORY[m.category] ?? { label: m.category.toUpperCase(), colour: 'var(--chalk)' };
        // The row's leading number is the race clock; anything FastF1 appended to
        // the message body is the circuit's time of day. Two different clocks, so
        // they are no longer printed as two identical-looking numbers (ui-ux m14).
        const { text, wallClock } = splitWallClock(m.message);
        return (
        <div key={idOf(m)} className={m.driver != null && m.driver === selected ? 'rc-row rc-row-mine' : 'rc-row'}>
          <span style={{ fontVariantNumeric: 'tabular-nums', fontSize: 'var(--fs-sm)' }}>{fmtClock(m.t)}</span>
          <span style={{ color: cat.colour, fontWeight: 700, fontSize: 'var(--fs-sm)', letterSpacing: '0.08em' }}>
            {cat.label}
          </span>
          <span className="rc-text">{text}</span>
          {m.driver != null && state.cars[m.driver]
            && needsDriverTag(m.message, state.cars[m.driver].code, m.driver) && (
            <span style={{ color: 'var(--slate)' }}>({state.cars[m.driver].code})</span>
          )}
          {wallClock && (
            // Labelled, not stripped: it is the only record of when race control
            // actually issued the message, which for a deleted lap or a penalty
            // is the operative fact. "at" plus --dim puts it a tier below both
            // the race clock and the message, so it cannot be misread as either.
            <span className="rc-wall">
              at {wallClock}
              <span className="visually-hidden"> local time at the circuit</span>
            </span>
          )}
        </div>
        );
      })}
    </div>
  );
}
