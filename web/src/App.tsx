import { useEffect, useState } from 'react';
import { connectRace, type ConnStatus } from './realtime/socket';
import { connectStaticReplay } from './realtime/staticReplay';
import { emptyState, type RaceState } from './state/race';
import { Map } from './components/Map';
import { TimingTower } from './components/TimingTower';
import { TelemetryPanel } from './components/TelemetryPanel';
import { SourceToggle } from './components/SourceToggle';
import { Comms } from './components/Comms';
import { RaceControl } from './components/RaceControl';
import { Panel } from './components/Panel';
import { StatusRail } from './components/StatusRail';
import { useStale } from './hooks/useStale';
import { useLapHistory } from './hooks/useLapHistory';
import { useGapHistory } from './hooks/useGapHistory';
import { Compare } from './components/Compare';
import { Ghost } from './components/Ghost';
import { StintChart } from './components/StintChart';

function SkeletonMap() {
  return <div className="track-skeleton">Warming up the timing feed…</div>;
}

// Build-time flag: VITE_STATIC_DEMO=true selects the file-backed static player
// instead of the real WebSocket connection. Set only by the GitHub Pages build
// (see .github/workflows/pages.yml) — docker-compose and local dev never set it.
const STATIC_DEMO = import.meta.env.VITE_STATIC_DEMO === 'true';

export default function App() {
  const [state, setState] = useState<RaceState>(emptyState());
  const [status, setStatus] = useState<ConnStatus>('connecting');
  const [hash, setHash] = useState<string>(typeof location !== 'undefined' ? location.hash : '');
  const [selected, setSelected] = useState<number | null>(null);
  const [rival, setRival] = useState<number | null>(null);
  const staleSec = useStale(state);
  const lapHistory = useLapHistory(state);
  const gapHistory = useGapHistory(state);

  useEffect(() => (STATIC_DEMO ? connectStaticReplay : connectRace)(setState, setStatus), []);
  useEffect(() => {
    const onHash = () => setHash(location.hash);
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  // A rival only makes sense alongside a primary selection, and never as the
  // same car as the primary — derived rather than synced via effect.
  const effectiveRival = selected != null && rival !== selected ? rival : null;

  if (hash === '#compare') return <Compare />;
  if (hash === '#ghost') return <Ghost initialSelected={selected} />;

  const showSkeleton = state.rev === 0;

  return (
    <div className="page">
      <StatusRail active="board" state={state} status={status} staleSec={staleSec}>
        {!STATIC_DEMO && <SourceToggle state={state} />}
      </StatusRail>

      <div className="board-top">
        <Panel label="Track">
          {status === 'reconnecting' && !showSkeleton && (
            <div style={{ position: 'relative', display: 'inline-block' }}>
              <Map state={state} />
              <div className="chip chip-reconnect" style={{
                position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)',
              }}>
                ↺ Reconnecting…
              </div>
            </div>
          )}
          {!showSkeleton && status !== 'reconnecting' && <Map state={state} />}
          {showSkeleton && <SkeletonMap />}
        </Panel>
        <Panel label="Timing">
          <TimingTower state={state} selected={selected} onSelect={setSelected} />
        </Panel>
      </div>

      <div className="board-bottom">
        <Panel label="Telemetry">
          <TelemetryPanel
            state={state}
            lapHistory={lapHistory}
            gapHistory={gapHistory}
            selected={selected}
            rival={effectiveRival}
            onRivalChange={setRival}
          />
        </Panel>
        <Panel label="Strategy">
          <StintChart state={state} />
        </Panel>
        <Panel label="Comms">
          <Comms state={state} />
        </Panel>
        <Panel label="Race Control">
          <RaceControl state={state} />
        </Panel>
      </div>
    </div>
  );
}
