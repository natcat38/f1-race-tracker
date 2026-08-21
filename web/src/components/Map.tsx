// The track map: cars drawn as smoothed dots on the baked track outline, with the
// board's selection highlighted.

import type { RaceState } from '../state/race';
import { TrackPath } from './TrackPath';
import { useSmoothedCars } from '../hooks/useSmoothedCars';
import { teamColour } from './teamColours';
import { SIZE, fitViewBox, trackPathD } from './geometry';

// selected / rival are the board's one selection, reaching the map at last: the
// click-a-row interaction used to change the tower row and the telemetry panel and
// nothing else, so a user who picked SAI and then looked at the track had twenty
// identical dots and no way to find them.
export function Map({ state, paused, selected, rival }: {
  state: RaceState; paused?: boolean; selected?: number | null; rival?: number | null;
}) {
  const cars = useSmoothedCars(state, paused);
  const trackPath = trackPathD(state.track);
  const anySelection = selected != null || rival != null;
  return (
    // Fitted to the outline's own bounds rather than the full unit square: the
    // baked outline is letterboxed inside it, and the empty margin was ~38% of
    // the panel. Markers keep their SIZE-space coordinates — see fitViewBox.
    <svg viewBox={fitViewBox(state.track)} className="track-svg" role="img" aria-label={anySelection ? 'Track map with live car positions; the reference car is ringed' : 'Track map with live car positions'}>
      <TrackPath d={trackPath} />
      {cars.map((c) => {
        const isSel = selected != null && c.driverNum === selected;
        const isRival = rival != null && c.driverNum === rival;
        const marked = isSel || isRival;
        return (
        // A pit-lane car was drawn at 0.35, which put its driver code — real text —
        // at 2.95:1 against the panel. 0.6 measures 6.2:1 and still reads as
        // plainly recessed; the retired 0.5 (4.7:1) already cleared the line.
        // The unselected field is NOT faded further when a car is picked: --dim
        // and the pit/retired steps are already at their contrast floors, and
        // stacking another multiplier on them would spend the whole budget. The
        // ring does the work instead — a shape difference, not a dimming.
        <g key={c.driverNum} opacity={c.status === 'Pit' ? 0.6 : c.status === 'Out' ? 0.5 : 1}>
          {marked && (
            <circle
              cx={c.p.x * SIZE} cy={c.p.y * SIZE} r={12}
              fill="none"
              stroke="var(--chalk)"
              strokeWidth={2}
              // Solid ring for the reference car, dashed for the rival — the same
              // solid-vs-ghost grammar the overlay route already uses, so the two
              // views teach the same vocabulary.
              strokeDasharray={isSel ? undefined : '3 3'}
            />
          )}
          <circle
            cx={c.p.x * SIZE} cy={c.p.y * SIZE} r={7}
            fill={teamColour[c.team] ?? 'var(--team-unknown)'}
            stroke="var(--marker-stroke)" strokeWidth={1}
          />
          {/* Twenty three-letter labels at a fixed size collapse into unreadable
              clusters once the map is a ~330px phone square. Below that width the
              CSS keeps only the marked cars' labels — which is also the first time
              the map has had a reason to know about the selection. */}
          <text
            className={marked ? 'map-label map-label-marked' : 'map-label'}
            x={c.p.x * SIZE + 10} y={c.p.y * SIZE + 4}
            fill={marked ? 'var(--chalk)' : 'var(--track-label)'}
            fontWeight={marked ? 700 : undefined}
            fontSize="var(--fs-xs)"
          >{c.code}</text>
        </g>
        );
      })}
    </svg>
  );
}
