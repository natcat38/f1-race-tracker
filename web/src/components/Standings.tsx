import type { RaceState } from '../state/race';

export function Standings({ state }: { state: RaceState }) {
  const order = Object.values(state.cars).sort((a, b) => a.pos - b.pos);
  return (
    <ol style={{ lineHeight: 1.8, margin: 0, paddingLeft: '1.4em' }}>
      {order.map((c) => (
        <li key={c.driverNum}>
          <b style={{ color: 'var(--chalk)' }}>{c.code}</b>{' '}
          <span style={{ color: 'var(--slate)' }}>— {c.team}</span>
        </li>
      ))}
    </ol>
  );
}
