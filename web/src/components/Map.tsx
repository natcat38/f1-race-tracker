import type { RaceState } from '../state/race';
import { useSmoothedCars } from '../hooks/useSmoothedCars';

const SIZE = 600;
const teamColour: Record<string, string> = {
  'Red Bull': '#3671C6', Ferrari: '#E8002D', Mercedes: '#27F4D2', McLaren: '#FF8000',
  'Aston Martin': '#229971', Alpine: '#0093CC', Williams: '#64C4FF',
  RB: '#6692FF', 'Kick Sauber': '#52E252', Haas: '#B6BABD',
};

export function Map({ state }: { state: RaceState }) {
  const cars = useSmoothedCars(state);
  const trackPath = state.track.length
    ? 'M ' + state.track.map((p) => `${p.x * SIZE},${p.y * SIZE}`).join(' L ') + ' Z'
    : '';
  return (
    <svg width={SIZE} height={SIZE} style={{ background: '#111', borderRadius: 12 }}>
      {trackPath && <path d={trackPath} fill="none" stroke="#333" strokeWidth={10} strokeLinejoin="round" />}
      {trackPath && <path d={trackPath} fill="none" stroke="#1a1a1a" strokeWidth={6} strokeLinejoin="round" />}
      {cars.map((c) => (
        <g key={c.driverNum}>
          <circle cx={c.p.x * SIZE} cy={c.p.y * SIZE} r={7} fill={teamColour[c.team] ?? '#bbb'} stroke="#000" strokeWidth={1} />
          <text x={c.p.x * SIZE + 10} y={c.p.y * SIZE + 4} fill="#eee" fontSize={11}>{c.code}</text>
        </g>
      ))}
    </svg>
  );
}
