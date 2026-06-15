import type { RaceState } from '../state/race';

const SIZE = 600;
const teamColour: Record<string, string> = {
  'Red Bull': '#3671C6', Ferrari: '#E8002D', Mercedes: '#27F4D2',
};

// Map renders cars as dots at their unit-box [0,1] coordinates.
export function Map({ state }: { state: RaceState }) {
  const cars = Object.values(state.cars);
  return (
    <svg width={SIZE} height={SIZE} style={{ background: '#111', borderRadius: 12 }}>
      {cars.map((c) => (
        <g key={c.driverNum}>
          <circle cx={c.p.x * SIZE} cy={c.p.y * SIZE} r={8} fill={teamColour[c.team] ?? '#bbb'} />
          <text x={c.p.x * SIZE + 11} y={c.p.y * SIZE + 4} fill="#eee" fontSize={11}>{c.code}</text>
        </g>
      ))}
    </svg>
  );
}
