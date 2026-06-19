import { useEffect, useState } from 'react';
import { connectRace, type ConnStatus } from './realtime/socket';
import { emptyState, type RaceState } from './state/race';
import { Map } from './components/Map';
import { Standings } from './components/Standings';
import { StatusBadge } from './components/StatusBadge';
import { SourceToggle } from './components/SourceToggle';

const SIZE = 600;

function SkeletonMap() {
  return (
    <div
      style={{
        width: SIZE, height: SIZE, background: '#111', borderRadius: 12,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: '#444', fontFamily: 'monospace', fontSize: 14,
      }}
    >
      Warming up the timing feed…
    </div>
  );
}

export default function App() {
  const [state, setState] = useState<RaceState>(emptyState());
  const [status, setStatus] = useState<ConnStatus>('connecting');

  useEffect(() => connectRace(setState, setStatus), []);

  const showSkeleton = state.rev === 0;

  return (
    <div style={{ display: 'flex', gap: 24, padding: 24, color: '#eee', background: '#0a0a0a', minHeight: '100vh' }}>
      <div>
        <h2 style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '0 0 12px' }}>
          <StatusBadge status={status} state={state} />
          {state.label ? <span style={{ color: '#aaa', fontWeight: 400, fontSize: 16 }}>{state.label}</span> : null}
          <SourceToggle state={state} />
        </h2>
        {status === 'reconnecting' && !showSkeleton && (
          <div style={{
            position: 'relative', display: 'inline-block',
          }}>
            <Map state={state} />
            <div style={{
              position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)',
              background: '#7c3f00cc', color: '#ffb347', padding: '4px 14px',
              borderRadius: 8, fontFamily: 'monospace', fontSize: 13, fontWeight: 600,
            }}>
              ↺ Reconnecting…
            </div>
          </div>
        )}
        {!showSkeleton && status !== 'reconnecting' && <Map state={state} />}
        {showSkeleton && <SkeletonMap />}
      </div>
      <div><h3>Order</h3><Standings state={state} /></div>
    </div>
  );
}
