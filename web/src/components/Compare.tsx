import { useEffect, useState } from 'react';
import { connectRace, type ConnStatus } from '../realtime/socket';
import { emptyState, type RaceState } from '../state/race';
import { Map } from './Map';
import { Standings } from './Standings';
import { Panel } from './Panel';
import { StatusRail } from './StatusRail';
import { Route } from './Route';
import { StatusBadge } from './StatusBadge';
import { useStale } from '../hooks/useStale';

const PAIR = [
  { session: 'compare-monza-2023', year: '2023' },
  { session: 'compare-monza-2024', year: '2024' },
] as const;

function Lane({ session, year }: { session: string; year: string }) {
  const [state, setState] = useState<RaceState>(emptyState());
  const [status, setStatus] = useState<ConnStatus>('connecting');
  useEffect(() => connectRace(setState, setStatus, session), [session]);
  const staleSec = useStale(state);

  return (
    <Panel
      label={`${year} — ${state.label || '…'}`}
      actions={<StatusBadge status={status} state={state} staleSec={staleSec} />}
    >
      {state.rev === 0 ? (
        <div className="track-skeleton">Warming up the timing feed…</div>
      ) : (
        <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
          <Map state={state} />
          <Standings state={state} />
        </div>
      )}
    </Panel>
  );
}

export function Compare() {
  return (
    <Route
      title="Compare — Monza 2023 vs 2024"
      rail={<StatusRail active="compare" note="Fixed historical replay — Monza 2023 vs 2024" />}
    >
      <div className="compare-lanes">
        {PAIR.map((p) => (
          <Lane key={p.session} session={p.session} year={p.year} />
        ))}
      </div>
    </Route>
  );
}
