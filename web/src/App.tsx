/**
 * The React app shell: mounts the root component, wires the live WebSocket or static-replay data source into race state, and lays out the dashboard panels.
 * @packageDocumentation
 */
import { useCallback, useEffect, useRef, useState } from 'react';
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
import { leaderOf, updateLapHistory, updateGapHistory } from './components/timingHelpers';
import { useStale } from './hooks/useStale';
import { useRollingHistory } from './hooks/useRollingHistory';
import { Ghost } from './components/Ghost';
import { Settings } from './components/Settings';
import { StintChart } from './components/StintChart';
import { STATIC_DEMO } from './staticDemo';
import { buildHash, parseHash } from './routing';

// How long the clip-wrapped notice stays up. Long enough to be read after the
// clock visibly jumps, short enough not to become part of the chrome.
const LOOP_NOTICE_MS = 8000;

// Four distinct reasons the map is missing, so the copy never contradicts what
// the rest of the board is showing: an unrecoverable static-demo load failure,
// a live socket that has spent its reconnect budget, a session streaming fine
// but without a track outline, or nothing yet at all.
function SkeletonMap({ failed, offline, trackless }: {
  failed?: boolean; offline?: boolean; trackless?: boolean;
}) {
  const copy = failed
    ? 'The demo replay could not be loaded. Refresh the page to retry.'
    : offline
      ? 'Connection lost. Use Reconnect in the status rail above to try again.'
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
  const lapHistory = useRollingHistory(state, {}, updateLapHistory);
  const gapHistory = useRollingHistory(state, {}, updateGapHistory);

  // The replay clip is a few minutes long and wraps forever. When it does, the
  // race clock jumps backwards and the lap counter counts down — which, to anyone
  // who follows the sport, is an unambiguous "this is broken" signal unless
  // something says otherwise. state.loopSeq is bumped by applyMessage the moment
  // timeMs goes backwards (the same signal the Go gateway uses); this turns that
  // into a transient notice. Seeded from the live value and adjusted during
  // render rather than in an effect — an effect here would be a second render
  // pass, and this repo's lint config rejects setState in an effect body.
  const [seenLoop, setSeenLoop] = useState(state.loopSeq);
  const [justLooped, setJustLooped] = useState(false);
  if (seenLoop !== state.loopSeq) {
    setSeenLoop(state.loopSeq);
    setJustLooped(true);
  }
  useEffect(() => {
    if (!justLooped) return;
    const t = setTimeout(() => setJustLooped(false), LOOP_NOTICE_MS);
    return () => clearTimeout(t);
  }, [justLooped, seenLoop]);

  // Esc clears the reference car from anywhere on the board — the keyboard half
  // of making the selection undoable (the tower's own "clear" button is the
  // visible half). Skipped while focus is in a form control so it cannot steal
  // Esc from a native picker.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const el = document.activeElement;
      if (el instanceof HTMLSelectElement || el instanceof HTMLInputElement) return;
      setSelected(null);
      setRival(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // The socket hands its retry function over with the 'offline' status (see
  // MAX_RECONNECT_ATTEMPTS). Held in a ref and pressed through a stable callback
  // so handing it to the rail does not re-render the board every time the status
  // changes, and so a handle from a torn-down connection is replaced rather than
  // captured in a stale closure.
  const retryRef = useRef<(() => void) | null>(null);
  const reconnect = useCallback(() => { retryRef.current?.(); }, []);

  // #22: the socket/clip fetch used to open unconditionally on mount, so a deep
  // link straight to #ghost or #settings paid for it despite never showing the
  // board. Gated on the route actually being 'board' at least once — but NOT
  // torn down on nav away, because that would re-fetch the (~24 MB, ~0.9 MB
  // gzipped) static-demo clip on every trip back to #board. connectedRef makes
  // the connect fire exactly once per App lifetime; the disposer is parked in a
  // ref and only invoked by the unmount-only effect below.
  // ponytail: two refs + two effects instead of one — the ceiling here is "the
  // one lazy-connect-once case", not a general connection-lifecycle manager.
  const connectedRef = useRef(false);
  const disconnectRef = useRef<() => void>(() => {});
  const routeName = parseHash(hash).route;
  useEffect(() => {
    if (connectedRef.current || routeName !== 'board') return;
    connectedRef.current = true;
    const onState = (s: RaceState) => {
      latestRef.current = s;
      if (!frozenRef.current) setState(s);
    };
    const onStatus = (s: ConnStatus, retry?: () => void) => {
      retryRef.current = retry ?? null;
      setStatus(s);
    };
    disconnectRef.current = (STATIC_DEMO ? connectStaticReplay : connectRace)(onState, onStatus);
  }, [routeName]);
  // Clearing connectedRef alongside the disposer is what makes a remount
  // reconnect. Refs survive unmount, so without the reset the connect effect
  // sees a stale `true` and returns early — which under StrictMode's
  // mount/unmount/remount pass killed the connection on the first render and
  // never opened another, leaving the board permanently on its warm-up skeleton.
  useEffect(() => () => { disconnectRef.current(); connectedRef.current = false; }, []);

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

  // Cold open used to be one-third placeholder: Telemetry read "Select a car to
  // see telemetry" and Comms explained a toggle, so two of the six board panels
  // opened as empty boxes describing a setting instead of showing anything.
  // Seeding the selection with the race leader on the first frame that has cars
  // fills Telemetry immediately — and Telemetry is the one place --fs-hero was
  // already wired up, so this also puts display type on the board for free.
  //
  // An "adjusting state during render" seed: an effect would be a cascading
  // render, and useState's initialiser cannot see the first frame because it
  // runs before any frame arrives. State rather than a ref because the flag is
  // read during render, and the lint rule that governs this codebase is right
  // that a ref read in render can leave the component not re-rendering.
  //
  // The flag, not `selected == null`, is what makes this fire exactly once: a
  // user who clears the selection later (ui-ux M4, agent 5's) must not have the
  // leader pushed back at them on the very next frame.
  //
  // A `?car=` in the URL overrides the leader (accessibility M-7): someone who
  // was sent `#board?car=VER` asked for VER, and seeding the leader first would
  // make the board flash the wrong car before correcting itself.
  const { route, car: carParam, a: overlayA, b: overlayB } = parseHash(hash);
  const [leaderSeeded, setLeaderSeeded] = useState(false);
  if (!leaderSeeded) {
    const leader = leaderOf(state.cars);
    if (leader) {
      setLeaderSeeded(true);
      const linked = carParam
        ? Object.values(state.cars).find((c) => c.code.toUpperCase() === carParam)
        : undefined;
      if (linked) setSelected(linked.driverNum);
      else if (selected == null) setSelected(leader.driverNum);
    }
  }

  // The URL is an input as well as an output: a hash change that names a car —
  // pasting a shared link into the address bar of an already-open board, or Back
  // onto one — must move the selection. The seed block above only fires on the
  // first frame with cars, so without this a link pasted into a warm tab changed
  // the URL and nothing else. Reads the cars off the ref rather than state so the
  // effect is keyed on the car code alone and does not re-run at 10 Hz; a code
  // that names nobody in this session is left alone rather than clearing the
  // selection, since the likeliest cause is a link from a different race.
  useEffect(() => {
    if (!carParam) return;
    const linked = Object.values(latestRef.current.cars)
      .find((c) => c.code.toUpperCase() === carParam);
    if (linked) setSelected(linked.driverNum);
  }, [carParam]);

  // Selection is deep-linkable, so it has to be written back — with
  // replaceState, never pushState: the reference car changes on every click of a
  // twenty-row tower, and pushing would bury the previous page under twenty Back
  // presses. Keyed off the code rather than the state object so the effect runs
  // when the selection changes and not at 10 Hz with every frame; and gated on
  // the seed, so it cannot erase the `?car=` in the URL before the first frame
  // with cars has had a chance to read it.
  const selectedCode = selected != null ? state.cars[selected]?.code ?? null : null;
  useEffect(() => {
    // Board only. This effect runs on every route (the hooks above all sit
    // before the route switch, so the socket and the selection stay alive while
    // #ghost is on screen) and an unguarded write would quietly rewrite a
    // #ghost URL to the board's — invisibly, because replaceState fires no
    // hashchange, so the view would stay put and only a reload would betray it.
    if (!leaderSeeded || route !== 'board') return;
    const next = buildHash({ route: 'board', car: selectedCode });
    // location.hash is '' for a bare page and '#' for buildHash's empty board;
    // compare the built forms so an unchanged URL is never rewritten.
    if (buildHash(parseHash(location.hash)) === next) return;
    history.replaceState(null, '', next);
  }, [selectedCode, leaderSeeded, route, hash]);

  // Keyed on the sides the URL names so a hash pasted while the overlay is already
  // on screen remounts it. The overlay's own replaceState writes fire no hashchange,
  // so `hash` (and this key) stay put while its pickers are driven from inside.
  if (route === 'ghost') {
    const sides = `${overlayA?.session}:${overlayA?.car}|${overlayB?.session}:${overlayB?.car}`;
    return <Ghost key={sides} initialA={overlayA} initialB={overlayB} />;
  }
  if (route === 'settings') return <Settings />;

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
          onReconnect={reconnect}
          // The board is the one route that carries a Replay/Live control, so
          // the rail's healthy lane chip would only repeat it (ui-ux m8). On the
          // static demo there is no control, and the chip stays.
          laneNamedElsewhere={!STATIC_DEMO}
          // Zone D. The lane pick and the transport verb travel together now:
          // at 1440 they used to land on different rows a thousand pixels apart,
          // because the rail wrapped wherever it happened to run out of room.
          controls={
            <>
              {!STATIC_DEMO && <SourceToggle state={state} />}
              {/* Label swap rather than aria-pressed, matching the overlay's existing
                  Play/Pause: a transport control names the action it will take. The
                  resulting state is carried by the chip, in a region that is present
                  before it fills so the transition is actually announced. */}
              <button type="button" className="btn" onClick={toggleFrozen}>
                {frozen ? '▶ Resume' : '⏸ Freeze'}
              </button>
            </>
          }
          // Zone C, beside the connection chip: these are readouts of transport
          // state, not controls, and they belong in the reserved slot so the rail
          // does not change shape for eight seconds every time the clip wraps.
          stateChips={
            <span role="status" aria-live="polite">
              {frozen && <span className="chip chip-replay">⏸ FROZEN</span>}
              {justLooped && (
                <span className="chip chip-loop">↻ CLIP LOOPED — the recording restarted</span>
              )}
            </span>
          }
        />
      }
    >
      <div className="board-top">
        <Panel label="Track">
          {(status === 'reconnecting' || status === 'offline') && !showSkeleton && (
            <div style={{ position: 'relative', display: 'inline-block' }}>
              <Map state={state} paused={frozen} selected={selected} rival={effectiveRival} />
              <div className="chip chip-reconnect" style={{
                position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)',
              }}>
                {status === 'offline' ? '⚠ Connection lost' : '↺ Reconnecting…'}
              </div>
            </div>
          )}
          {!showSkeleton && status !== 'reconnecting' && status !== 'offline' && (
            <Map state={state} paused={frozen} selected={selected} rival={effectiveRival} />
          )}
          {showSkeleton && (
            <SkeletonMap
              failed={status === 'failed'}
              offline={status === 'offline'}
              trackless={trackless}
            />
          )}
        </Panel>
        <Panel label="Timing">
          <TimingTower state={state} selected={selected} onSelect={setSelected} />
        </Panel>
      </div>

      <div className="board-bottom">
        {/* Two telemetry cards do not fit one quarter of the strip — the second
            was cut mid-word at every viewport. With a rival picked the panel takes
            two columns; below that width the cards stack (see .telemetry-cards). */}
        <Panel label="Telemetry" className={effectiveRival != null ? 'panel-wide' : undefined}>
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
          <StintChart state={state} selected={selected} rival={effectiveRival} />
        </Panel>
        <Panel label="Comms">
          <Comms state={state} />
        </Panel>
        <Panel label="Race Control">
          <RaceControl state={state} selected={selected} />
        </Panel>
      </div>
    </Route>
  );
}
