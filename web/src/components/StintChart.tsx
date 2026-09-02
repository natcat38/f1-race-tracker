// The full-race strategy timeline: one row per car, each stint a coloured segment on a
// lap axis.

import { memo } from 'react';
import type { RaceState } from '../state/race';
import { axisTicks, leaderLapOf, orderCars, sameRunningOrder, TYRE_COLOUR, TYRE_LEGEND } from './timingHelpers';

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
function StintChartInner({ state, selected, rival }: {
  state: RaceState; selected?: number | null; rival?: number | null;
}) {
  const order = orderCars(state.cars).filter((c) => state.stints[c.driverNum]?.length);
  if (order.length === 0) return <div className="empty">No stint data for this session.</div>;

  // Leader may have no stint data (rare) and so be filtered out of `order` above;
  // derive the marker from the full field, not the stint-filtered list.
  const leaderLap = leaderLapOf(state.cars);
  const total = state.totalLaps || 1;

  return (
    // Deliberately off the 2/4/8/12/16/24 scale, and the only value in the app
    // that is. This gap repeats between twenty rows, so the nearest step either
    // way moves the panel's height by ~19px — enough to re-flow the four-up
    // bottom strip, which every other panel in it shares a grid row with. A
    // named half-step for one call site would be worse than an annotated 3.
    <div style={{ display: 'grid', gap: 3 }}>
      {order.map((c) => (
        <div
          key={c.driverNum}
          // The board's selection reaches this panel too: the chosen driver's row
          // is outlined and its code brought up to full strength, so the strategy
          // story can be read for the car the rest of the board is talking about.
          className={
            c.driverNum === selected ? 'stint-row stint-row-selected'
              : c.driverNum === rival ? 'stint-row stint-row-rival' : 'stint-row'
          }
          style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', fontSize: 'var(--fs-xs)' }}
        >
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
            {/* Pit-stop duration ticks: one short marker per stop at the lap it
                happened, title/aria-label carrying the pit-lane duration. Duration
                only — positions gained/lost and stationary time are out of scope
                for this slice (reviews/plans/verify/02-pit-stops.md).
                # ponytail: no visual distinction between stops yet (e.g. drive-through
                vs stop-go) — not derivable from the current data, deferred. */}
            {(state.pitStops[c.driverNum] ?? []).map((p, i) => (
              <div
                key={`pit-${i}`}
                title={`Pit stop: ${p.durationS.toFixed(1)}s (lap ${p.lap})`}
                role="img"
                aria-label={`${c.code}: pit stop on lap ${p.lap}, ${p.durationS.toFixed(1)} seconds`}
                style={{
                  position: 'absolute',
                  left: `${((p.lap - 1) / total) * 100}%`,
                  top: -2, bottom: -2,
                  width: 2,
                  background: 'var(--amber, orange)',
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
      {/* An unlabelled 0..53 axis: the chart had no lap numbers anywhere, no ticks,
          and the chalk line marking the leader's lap was legible only to a screen
          reader. The axis strip is offset by the 28px code gutter so its ticks line
          up with the bars above them. */}
      <div className="stint-axis" aria-hidden="true">
        <span style={{ width: 28, flexShrink: 0 }} />
        <div className="stint-axis-track">
          {axisTicks(total).map((lap) => (
            <span key={lap} className="stint-tick" style={{ left: `${((lap - 1) / total) * 100}%` }}>{lap}</span>
          ))}
          {leaderLap != null && (
            <span className="stint-tick stint-tick-leader" style={{ left: `${((leaderLap - 1) / total) * 100}%` }}>
              ▲L{leaderLap}
            </span>
          )}
        </div>
      </div>
      {/* The tyre key lived in the Timing panel, several hundred pixels away and
          in a different container — and on touch there is no hover to recover the
          compound from. It costs one line to repeat it where the colours are.
          TYRE_LEGEND (shared with TimingTower) is what keeps the two in sync
          instead of formatting the same five compounds two different ways
          (ui-ux item 12) — this row used to have no leading glyph at all. */}
      <div className="empty tt-legend" style={{ fontSize: 'var(--fs-sm)' }}>
        {TYRE_LEGEND.map(([t, label]) => (
          <span key={t} style={{ color: TYRE_COLOUR[t] }}>{label}</span>
        ))}
      </div>
      <div className="empty" style={{ fontSize: 'var(--fs-sm)', marginTop: 'var(--sp-0)' }}>
        Full-race stint plan baked from session data — the marker is where the replay currently sits.
      </div>
    </div>
  );
}

// Chose sameRunningOrder over comparing only the leader's lap: row order comes
// from EVERY car's pos, so a position swap that left the leader's lap unchanged
// used to leave the chart's order stale indefinitely — and it's cheaper besides,
// one O(n) field walk instead of the two full sorts leaderLapOf used to do here.
// selected/rival join the comparator: they change what the chart draws, so a
// memo that ignored them would leave the highlight one selection behind.
export const StintChart = memo(StintChartInner, (prev, next) => (
  prev.state.stints === next.state.stints &&
  prev.state.totalLaps === next.state.totalLaps &&
  prev.selected === next.selected &&
  prev.rival === next.rival &&
  sameRunningOrder(prev.state.cars, next.state.cars)
));
