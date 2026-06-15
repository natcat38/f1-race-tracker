import { useEffect, useState } from 'react';
import { connectRace } from './realtime/socket';
import { emptyState, type RaceState } from './state/race';
import { Map } from './components/Map';
import { Standings } from './components/Standings';

export default function App() {
  const [state, setState] = useState<RaceState>(emptyState());
  useEffect(() => connectRace(setState), []);
  return (
    <div style={{ display: 'flex', gap: 24, padding: 24, color: '#eee', background: '#0a0a0a', minHeight: '100vh' }}>
      <div>
        <h2>{state.mode === 'live' ? '● LIVE' : '▶ REPLAY'} — {state.label || 'connecting…'}</h2>
        <Map state={state} />
      </div>
      <div><h3>Order</h3><Standings state={state} /></div>
    </div>
  );
}
