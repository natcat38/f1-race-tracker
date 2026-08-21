/**
 * The React app shell: mounts the root component, wires the live WebSocket or static-replay data source into race state, and lays out the dashboard panels.
 * @packageDocumentation
 */
import { useEffect, useRef, useState } from 'react';
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
import { Route } from './components/Route';
import { StatusRail } from './components/StatusRail';
import { useStale } from './hooks/useStale';
import { useLapHistory } from './hooks/useLapHistory';
import { useGapHistory } from './hooks/useGapHistory';
import { Compare } from './components/Compare';
import { Ghost } from './components/Ghost';
import { Settings } from './components/Settings';
import { StintChart } from './components/StintChart';
import { STATIC_DEMO } from './staticDemo';

// Three distinct reasons the map is missing, so the copy never contradicts what
// the rest of the board is showing: an unrecoverable static-demo load failure,
// a session streaming fine but without a track outline, or nothing yet at all.
function SkeletonMap({ failed, trackless }: { failed?: boolean; trackless?: boolean }) {
  const copy = failed
    ? 'The demo replay could not be loaded. Refresh the page to retry.'
    : trackless
      ? 'No track outline for this session — timing still works.'
      : 'Warming up the timing feed…';
  return <div className="track-skeleton">{copy}</div>;
}

export default function App() {
  const [state, setState] = useState<RaceState>(emptyState());
  const [status, setStatus] = useState<ConnStatus>('connecting');
  const [hash, setHash] = useState<string>(typeof location !== 'undefined' ? location.hash : '');
  const [selected, setSelected] = useState<number | null>(null);
  const [rival, setRival] = useState<number | null>(null);
  // WCAG 2.2.2: the board starts moving on load and never stops — car markers
  // animate via rAF indefinitely and the tower repaints at 10 Hz — with no pause,
  // stop or hide control anywhere. prefers-reduced-motion removes the glide but
  // not the 10 Hz positional jumps, and it is an OS-level setting besides. Freeze
  // holds the rendered frame while the feed keeps arriving in the background;
  // resuming snaps to whatever is current, so nothing is replayed or queued.
  // (The #ghost route already had its own Play/Pause; this is the board's.)
  const [frozen, setFrozen] = useState(false);
  const frozenRef = useRef(false);
  const latestRef = useRef<RaceState>(state);
  const staleSec = useStale(state);
  const lapHistory = useLapHistory(state);
  const gapHistory = useGapHistory(state);

  useEffect(() => {
    const onState = (s: RaceState) => {
      latestRef.current = s;
      if (!frozenRef.current) setState(s);
    };
    return (STATIC_DEMO ? connectStaticReplay : connectRace)(onState, setStatus);
  }, []);

  useEffect(() => {
    const onHash = () => setHash(location.hash);
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  function toggleFrozen() {
    const next = !frozenRef.current;
    frozenRef.current = next;
    setFrozen(next);
    if (!next) setState(latestRef.current);
  }

  // A rival only makes sense alongside a primary selection, and never as the
  // same car as the primary — derived rather than synced via effect.
  const effectiveRival = selected != null && rival !== selected ? rival : null;

  if (hash === '#compare') return <Compare />;
  if (hash === '#ghost') return <Ghost initialSelected={selected} />;
  if (hash === '#settings') return <Settings />;

  // A snapshot without a track outline would render an invisible map, so stand
  // in for it — but say which of the two cases it is, because "warming up" is a
  // lie once frames are arriving and the timing tower is already populated.
  const trackless = state.rev > 0 && state.track.length === 0;
  const showSkeleton = state.rev === 0 || trackless;

  return (
    <Route
      title={`Race board${state.label ? ` — ${state.label}` : ''}`}
      rail={
        <StatusRail
          active="board"
          state={state}
          status={status}
          // Frozen means "we are choosing not to apply frames", not "the feed has
          // stopped" — so the staleness chip must not start claiming an outage the
          // moment a user pauses to read a row.
          staleSec={frozen ? 0 : staleSec}
        >
          {!STATIC_DEMO && <SourceToggle state={state} />}
          {/* Label swap rather than aria-pressed, matching the overlay's existing
              Play/Pause: a transport control names the action it will take. The
              resulting state is carried by the chip, in a region that is present
              before it fills so the transition is actually announced. */}
          <button type="button" className="btn" onClick={toggleFrozen}>
            {frozen ? '▶ Resume' : '⏸ Freeze'}
          </button>
          <span role="status" aria-live="polite">
            {frozen && <span className="chip chip-replay">⏸ FROZEN</span>}
          </span>
        </StatusRail>
      }
    >
      <div className="board-top">
        <Panel label="Track">
          {status === 'reconnecting' && !showSkeleton && (
            <div style={{ position: 'relative', display: 'inline-block' }}>
              <Map state={state} paused={frozen} />
              <div className="chip chip-reconnect" style={{
                position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)',
              }}>
                ↺ Reconnecting…
              </div>
            </div>
          )}
          {!showSkeleton && status !== 'reconnecting' && <Map state={state} paused={frozen} />}
          {showSkeleton && <SkeletonMap failed={status === 'failed'} trackless={trackless} />}
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
    </Route>
  );
}
