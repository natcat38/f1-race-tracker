import type { RaceState } from '../state/race';

export function Standings({ state }: { state: RaceState }) {
  const order = Object.values(state.cars).sort((a, b) => a.pos - b.pos);
  return (
    <ol style={{ fontFamily: 'monospace', lineHeight: 1.8 }}>
      {order.map((c) => (
        <li key={c.driverNum}><b>{c.code}</b> — {c.team}</li>
      ))}
    </ol>
  );
}
