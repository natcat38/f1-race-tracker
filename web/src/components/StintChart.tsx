import { memo } from 'react';
import type { RaceState } from '../state/race';
import { orderCars, TYRE_COLOUR } from './timingHelpers';

// Leader's current lap read off orderCars' running order (front of the sorted
// list) rather than an exact pos===1 match: the wire now reconciles pos into a
// unique, contiguous 1..N per frame (#66), but orderCars' tie-break stays as
// belt-and-braces, so the marker degrades honestly instead of silently not
// drawing if a stale/malformed frame ever lacked a literal pos:1.
function leaderLapOf(state: RaceState): number | undefined {
  return orderCars(state.cars)[0]?.lap;
}

// StintChart is the full-race strategy timeline: one row per car (running
// order), each stint drawn as a coloured segment on a 0..totalLaps axis, with
// a marker at the leader's current lap. Unlike every other board panel this
// isn't windowed to the replay clip — the stint plan is baked for the whole
// race so the strategy story reads at a glance (see ingest/record.py's stints).
//
// state.stints/state.totalLaps are baked once per session and never change
// mid-race; only the leader-lap marker needs to move. Memoized on just those
// three values (not `state` itself, which gets a new identity every 10Hz
// frame) so the full sort + per-driver stint bars aren't rebuilt every tick.
function StintChartInner({ state }: { state: RaceState }) {
  const order = orderCars(state.cars).filter((c) => state.stints[c.driverNum]?.length);
  if (order.length === 0) return <div className="empty">No stint data for this session.</div>;

  // Leader may have no stint data (rare) and so be filtered out of `order` above;
  // derive the marker from the full field, not the stint-filtered list.
  const leaderLap = leaderLapOf(state);
  const total = state.totalLaps || 1;

  return (
    <div style={{ display: 'grid', gap: 3 }}>
      {order.map((c) => (
        <div key={c.driverNum} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 'var(--fs-xs)' }}>
          <span style={{ width: 28, flexShrink: 0 }}>{c.code}</span>
          <div style={{ position: 'relative', flex: 1, height: 10, background: 'var(--edge)', borderRadius: 2 }}>
            {state.stints[c.driverNum].map((s, i) => (
              <div
                key={i}
                title={`${s.compound} · laps ${s.startLap}-${s.endLap}`}
                role="img"
                aria-label={`${c.code}: ${s.compound.toLowerCase()} tyres, laps ${s.startLap} to ${s.endLap}`}
                style={{
                  position: 'absolute',
                  left: `${((s.startLap - 1) / total) * 100}%`,
                  width: `${((s.endLap - s.startLap + 1) / total) * 100}%`,
                  top: 1, bottom: 1,
                  background: TYRE_COLOUR[s.compound] ?? 'var(--slate)',
                  borderRadius: 1,
                }}
              />
            ))}
            {!!leaderLap && (
              <div
                role="img"
                aria-label={`Leader is on lap ${leaderLap}`}
                style={{
                  position: 'absolute',
                  left: `${((leaderLap - 1) / total) * 100}%`,
                  top: -1, bottom: -1,
                  width: 1,
                  background: 'var(--chalk)',
                }}
              />
            )}
          </div>
        </div>
      ))}
      <div className="empty" style={{ fontSize: 'var(--fs-2xs)', marginTop: 2 }}>
        Full-race stint plan baked from session data — the replay window sits inside it.
      </div>
    </div>
  );
}

export const StintChart = memo(StintChartInner, (prev, next) => (
  prev.state.stints === next.state.stints &&
  prev.state.totalLaps === next.state.totalLaps &&
  leaderLapOf(prev.state) === leaderLapOf(next.state)
));
