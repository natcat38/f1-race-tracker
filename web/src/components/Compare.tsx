import { useEffect, useState } from 'react';
import { connectRace } from '../realtime/socket';
import { emptyState, type RaceState } from '../state/race';
import { Map } from './Map';
import { Standings } from './Standings';
import { Panel } from './Panel';
import { StatusRail } from './StatusRail';
import { StatusBadge } from './StatusBadge';
import { useStale } from '../hooks/useStale';

const PAIR = [
  { session: 'compare-monza-2023', year: '2023' },
  { session: 'compare-monza-2024', year: '2024' },
] as const;

function Lane({ session, year }: { session: string; year: string }) {
  const [state, setState] = useState<RaceState>(emptyState());
  useEffect(() => connectRace(setState, undefined, session), [session]);
  const staleSec = useStale(state);

  return (
    <Panel
      label={`${year} — ${state.label || '…'}`}
      actions={<StatusBadge status={state.rev === 0 ? 'connecting' : 'live'} state={state} staleSec={staleSec} />}
    >
      {state.rev === 0 ? (
        <div className="track-skeleton" />
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
    <div className="page">
      <StatusRail active="compare" note="Fixed historical replay — Monza 2023 vs 2024" />
      <div className="compare-lanes">
        {PAIR.map((p) => (
          <Lane key={p.session} session={p.session} year={p.year} />
        ))}
      </div>
    </div>
  );
}
