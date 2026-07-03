import type { RaceState } from '../state/race';

const MAX_SHOWN = 8;

// RaceControl is a passive feed of the most recent race-control messages
// (flags, safety car, investigations), newest first.
export function RaceControl({ state }: { state: RaceState }) {
  if (state.messages.length === 0) return null;
  const recent = state.messages.slice(-MAX_SHOWN).reverse();

  return (
    <div style={{ display: 'grid', gap: 4 }}>
      {recent.map((m, i) => (
        <div key={`${m.rev}-${i}`} style={{
          display: 'flex', alignItems: 'baseline', gap: 8,
          fontFamily: 'monospace', fontSize: 12, color: '#aaa',
        }}>
          <span style={{ color: '#3671C6', fontWeight: 700 }}>{m.category}</span>
          <span>{m.message}</span>
          {m.driver != null && state.cars[m.driver] && (
            <span style={{ color: '#888' }}>({state.cars[m.driver].code})</span>
          )}
        </div>
      ))}
    </div>
  );
}
