import { useEffect, useState } from 'react';
import { connectRace } from '../realtime/socket';
import { emptyState, type RaceState } from '../state/race';
import { Map } from './Map';
import { Standings } from './Standings';

const PAIR = [
  { session: 'compare-monza-2023', year: '2023' },
  { session: 'compare-monza-2024', year: '2024' },
] as const;

function Lane({ session, year }: { session: string; year: string }) {
  const [state, setState] = useState<RaceState>(emptyState());
  useEffect(() => connectRace(setState, undefined, session), [session]);

  return (
    <div>
      <h3 style={{ margin: '0 0 8px', fontFamily: 'monospace', display: 'flex', gap: 10, alignItems: 'baseline' }}>
        <span>{year}</span>
        <span style={{ color: '#888', fontWeight: 400, fontSize: 14 }}>{state.label}</span>
      </h3>
      {state.rev === 0 ? (
        <div style={{ width: 600, height: 600, background: '#111', borderRadius: 12 }} />
      ) : (
        <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
          <Map state={state} />
          <Standings state={state} />
        </div>
      )}
    </div>
  );
}

export function Compare() {
  return (
    <div style={{ padding: 24, color: '#eee', background: '#0a0a0a', minHeight: '100vh' }}>
      <h2 style={{ margin: '0 0 16px', display: 'flex', gap: 16, alignItems: 'baseline' }}>
        <span>Cross-year comparison · Monza</span>
        <a href="#" style={{ color: '#3671C6', fontSize: 14, fontWeight: 400 }}>← live board</a>
      </h2>
      <div style={{ display: 'flex', gap: 32, flexWrap: 'wrap' }}>
        {PAIR.map((p) => (
          <Lane key={p.session} session={p.session} year={p.year} />
        ))}
      </div>
    </div>
  );
}
