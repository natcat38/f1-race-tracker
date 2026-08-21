import { memo } from 'react';
import type { RaceState } from '../state/race';
import { leaderLapOf, orderCars, sameRunningOrder, TYRE_COLOUR } from './timingHelpers';

// StintChart is the full-race strategy timeline: one row per car (running
// order), each stint drawn as a coloured segment on a 0..totalLaps axis, with
// a marker at the leader's current lap. Unlike every other board panel this
// isn't windowed to the replay clip — the stint plan is baked for the whole
// race so the strategy story reads at a glance (see ingest/record.py's stints).
//
// state.stints/state.totalLaps are baked once per session and never change
// mid-race; the row order and the leader-lap marker are what move. Memoized on
// those (not `state` itself, which gets a new identity every 10Hz frame) so the
// full sort + per-driver stint bars aren't rebuilt every tick.
function StintChartInner({ state }: { state: RaceState }) {
  const order = orderCars(state.cars).filter((c) => state.stints[c.driverNum]?.length);
  if (order.length === 0) return <div className="empty">No stint data for this session.</div>;

  // Leader may have no stint data (rare) and so be filtered out of `order` above;
  // derive the marker from the full field, not the stint-filtered list.
  const leaderLap = leaderLapOf(state.cars);
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
            {/* != null, not truthiness: lap 0 is a real value on the wire, and
                `!!leaderLap` silently skipped the marker on the opening lap. */}
            {leaderLap != null && (
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

// Chose sameRunningOrder over comparing only the leader's lap: row order comes
// from EVERY car's pos, so a position swap that left the leader's lap unchanged
// used to leave the chart's order stale indefinitely — and it's cheaper besides,
// one O(n) field walk instead of the two full sorts leaderLapOf used to do here.
export const StintChart = memo(StintChartInner, (prev, next) => (
  prev.state.stints === next.state.stints &&
  prev.state.totalLaps === next.state.totalLaps &&
  sameRunningOrder(prev.state.cars, next.state.cars)
));
