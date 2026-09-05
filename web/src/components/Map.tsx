// The track map: cars drawn as smoothed dots on the baked track outline, with the
// board's selection highlighted.

import { useMemo } from 'react';
import type { RaceState } from '../state/race';
import { TrackPath } from './TrackPath';
import { useSmoothedCars } from '../hooks/useSmoothedCars';
import { teamColour } from './teamColours';
import { SIZE, fitViewBox, trackPathD, trackSegmentPaths } from './geometry';

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
  // Driver -> team, as a single stable string keyed only on the pairs that
  // actually matter for colouring (not on the `cars` object itself, which
  // race.ts rebuilds every 10 Hz frame regardless of whether any team changed).
  const driverTeamKey = Object.values(state.cars)
    .map((c) => `${c.driverNum}:${c.team}`)
    .join('|');
  // A plain object, not the built-in Map class: this module's own component
  // is named `Map`, which shadows the global `Map` constructor in this scope.
  const driverTeam = useMemo(() => {
    const byDriver: Record<number, string> = {};
    for (const c of Object.values(state.cars)) byDriver[c.driverNum] = c.team;
    return byDriver;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- driverTeamKey is the real dep
  }, [driverTeamKey]);
  // Sector-dominance heatmap (item 5): one coloured segment per minisector,
  // by the fastest driver's team colour. Always on rather than a toggle — the
  // plain outline is what renders whenever a clip carries no sectorDominance
  // (older clips, or a bake with too little lap-trace data). Memoized on
  // state.track + state.sectorDominance only — NOT state.cars, which race.ts
  // rebuilds every frame — with team colour resolved via driverTeam instead.
  const segments = useMemo(() => {
    if (!state.sectorDominance.length) return undefined;
    const paths = trackSegmentPaths(state.track);
    return paths.map((d, i) => {
      const dnum = state.sectorDominance[i];
      const team = dnum ? driverTeam[dnum] : undefined;
      return { d, colour: team ? (teamColour[team] ?? 'var(--track-fill)') : 'var(--track-fill)' };
    });
  }, [state.track, state.sectorDominance, driverTeam]);
  // Sector-dominance legend (WCAG 1.4.1 Use of Color): the heatmap's whole
  // meaning otherwise lives in which of 12 close-hued team colours a stretch of
  // track is painted, with no text fallback. Lists only the teams actually
  // dominating a minisector in this clip, in the order they're first seen —
  // same idea as StintChart's tyre legend (TYRE_LEGEND), reusing .tt-legend.
  const legendTeams = useMemo(() => {
    if (!state.sectorDominance.length) return [];
    const seen = new Set<string>();
    const teams: string[] = [];
    for (const dnum of state.sectorDominance) {
      const team = dnum ? driverTeam[dnum] : undefined;
      if (team && !seen.has(team)) {
        seen.add(team);
        teams.push(team);
      }
    }
    return teams;
  }, [state.sectorDominance, driverTeam]);
  // Start/finish tick: track[0] by convention (ingest/record.py's outline
  // starts at lap_start_t) — a short perpendicular tick using its neighbour
  // point for direction. Keyed on state.track only, so it isn't recomputed
  // every 10 Hz frame alongside cars/positions.
  const startFinishTick = useMemo(() => {
    if (state.track.length <= 1) return undefined;
    const p0 = state.track[0], p1 = state.track[1];
    const dx = p1.x - p0.x, dy = p1.y - p0.y;
    const len = Math.hypot(dx, dy) || 1;
    // Perpendicular unit vector, scaled to a short tick either side of track[0].
    const nx = (-dy / len) * 0.012, ny = (dx / len) * 0.012;
    const cx = p0.x * SIZE, cy = p0.y * SIZE;
    return { x1: cx - nx * SIZE, y1: cy - ny * SIZE, x2: cx + nx * SIZE, y2: cy + ny * SIZE };
  }, [state.track]);
  return (
    <>
    {/* Fitted to the outline's own bounds rather than the full unit square: the
        baked outline is letterboxed inside it, and the empty margin was ~38% of
        the panel. Markers keep their SIZE-space coordinates — see fitViewBox. */}
    <svg viewBox={fitViewBox(state.track)} className="track-svg" role="img" aria-label={anySelection ? 'Track map with live car positions; the reference car is ringed' : 'Track map with live car positions'}>
      <TrackPath d={trackPath} segments={segments} />
      {/* Start/finish: track[0] by convention (ingest/record.py's outline starts
          at lap_start_t) — drawn as a short perpendicular tick using its
          neighbour point for direction. */}
      {startFinishTick && (
        <line
          x1={startFinishTick.x1} y1={startFinishTick.y1}
          x2={startFinishTick.x2} y2={startFinishTick.y2}
          stroke="var(--chalk)" strokeWidth={2}
        />
      )}
      {state.corners.map((c) => (
        // map-corner-label, NOT map-label: the latter is hidden below 700px
        // (components.css) so twenty overlapping driver-code labels don't turn
        // into phone-width noise, but corners have no other on-screen
        // representation, so sharing that class silently dropped them below
        // 700px with no fallback (issue #109). A fixed --asphalt chip sits
        // behind the number so it stays >=4.5:1 against every heatmap team
        // colour instead of the old fixed --track-label fill, which the
        // sector-dominance heatmap can paint almost any hue underneath
        // (issue #99). aria-hidden: the SVG's own role="img" aria-label
        // already speaks for it; two ambiguous text nodes inside one image
        // buys nothing for AT users.
        <g key={`${c.number}${c.letter ?? ''}`} aria-hidden="true">
          <circle
            cx={c.x * SIZE} cy={c.y * SIZE} r={7}
            fill="var(--asphalt)"
          />
          <text
            className="map-corner-label"
            x={c.x * SIZE} y={c.y * SIZE}
            dy="0.35em"
            fill="var(--chalk)"
            fontSize="var(--fs-xs)"
            textAnchor="middle"
          >{c.number}{c.letter ?? ''}</text>
        </g>
      ))}
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
    {legendTeams.length > 0 && (
      <div className="empty tt-legend" style={{ fontSize: 'var(--fs-sm)' }}>
        {legendTeams.map((t) => (
          <span key={t} style={{ color: teamColour[t] ?? 'var(--team-unknown)' }}>{t}</span>
        ))}
      </div>
    )}
    </>
  );
}
