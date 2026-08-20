import type { RaceState } from '../state/race';
import { TrackPath } from './TrackPath';
import { useSmoothedCars } from '../hooks/useSmoothedCars';
import { teamColour } from './teamColours';
import { SIZE } from './geometry';

export function Map({ state }: { state: RaceState }) {
  const cars = useSmoothedCars(state);
  const trackPath = state.track.length
    ? 'M ' + state.track.map((p) => `${p.x * SIZE},${p.y * SIZE}`).join(' L ') + ' Z'
    : '';
  return (
    <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="track-svg" role="img" aria-label="Track map with live car positions">
      <TrackPath d={trackPath} />
      {cars.map((c) => (
        <g key={c.driverNum} opacity={c.status === 'Pit' ? 0.35 : c.status === 'Out' ? 0.5 : 1}>
          <circle cx={c.p.x * SIZE} cy={c.p.y * SIZE} r={7} fill={teamColour[c.team] ?? '#bbb'} stroke="#000" strokeWidth={1} />
          <text x={c.p.x * SIZE + 10} y={c.p.y * SIZE + 4} fill="var(--track-label)" fontSize="var(--fs-xs)">{c.code}</text>
        </g>
      ))}
    </svg>
  );
}
