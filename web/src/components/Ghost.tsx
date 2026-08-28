// The overlay route: two reference laps animated against each other on one track map,
// across two seasons or two drivers in the same race.

import { useEffect, useMemo, useRef, useState } from 'react';
import { teamColour } from './teamColours';
import {
  deltaSeries, indexAtTime, overlaySkeletonCopy, driversWithTrace, driverCode, findByCode,
} from '../state/ghost';
import { SESSIONS, DEFAULT_SESSION, sessionBySlug, crossSeason, type SessionEntry } from '../state/sessions';
import { fmtElapsed } from './timingHelpers';
import { SIZE, fitViewBox, trackPathD } from './geometry';
import { Panel } from './Panel';
import { TrackPath } from './TrackPath';
import { useLane } from '../hooks/useLane';
import { useReducedMotion } from '../hooks/useReducedMotion';
import { StatusRail } from './StatusRail';
import { Route } from './Route';
import { buildHash, type OverlaySide } from '../routing';
import { STATIC_DEMO, REPO_URL } from '../staticDemo';

const BAR_H = 90;
// Named once: '#bbb' appeared three times in this file as the same concept.
const UNKNOWN_TEAM = 'var(--team-unknown)';

/** A side of the comparison as the UI holds it: a catalogue entry plus a driver code. */
interface SideSel { session: SessionEntry; car: string | null }

// The opening pair. On the full stack the catalogue has both Monza seasons, so the
// default is the cross-year comparison this route has always shown; on the static
// demo there is one clip, so it opens on two drivers from that race instead. Either
// way the route is a working comparison on first paint rather than an empty picker.
function defaultSides(): [SideSel, SideSel] {
  const other = SESSIONS.find((s) => s.slug !== DEFAULT_SESSION.slug) ?? DEFAULT_SESSION;
  return [{ session: DEFAULT_SESSION, car: null }, { session: other, car: null }];
}

function sideFromHash(side: OverlaySide | null, fallback: SideSel): SideSel {
  const session = sessionBySlug(side?.session ?? '');
  // A slug this build has no lane for (a link from the full stack opened on the
  // static demo) falls back rather than dead-ends on an unconnectable session.
  if (!side || !session) return fallback;
  return { session, car: side.car };
}

// Split from OverlayLive so the pickers only mount once there is something to pick
// from, and so the initial hash is read exactly once rather than on every frame.
export function Ghost({ initialA, initialB }: {
  initialA?: OverlaySide | null;
  initialB?: OverlaySide | null;
} = {}) {
  const [fa, fb] = defaultSides();
  return (
    <OverlayLive
      initialA={sideFromHash(initialA ?? null, fa)}
      initialB={sideFromHash(initialB ?? null, fb)}
    />
  );
}

function SourcePicker({ label, sel, drivers, cars, onSession, onCar, hint }: {
  label: string;
  sel: SideSel;
  drivers: number[];
  cars: Record<number, { code: string; team: string }>;
  onSession: (s: SessionEntry) => void;
  onCar: (code: string) => void;
  hint: string;
}) {
  const id = `overlay-${label.toLowerCase().replace(/\W+/g, '-')}`;
  return (
    <div className="overlay-side">
      <span className="overlay-side-label">{label}</span>
      {/* One entry in the catalogue is not a choice — the static demo bakes a single
          clip, so the picker states which session it is instead of offering a
          dropdown with nothing to switch to. */}
      {SESSIONS.length > 1 ? (
        <>
          <label className="visually-hidden" htmlFor={`${id}-session`}>{label} session</label>
          <select
            id={`${id}-session`}
            value={sel.session.slug}
            onChange={(e) => {
              const next = sessionBySlug(e.target.value);
              if (next) onSession(next);
            }}
            className="overlay-select"
          >
            {SESSIONS.map((s) => <option key={s.slug} value={s.slug}>{s.label}</option>)}
          </select>
        </>
      ) : (
        <span className="overlay-side-session">{sel.session.label}</span>
      )}
      <label className="visually-hidden" htmlFor={`${id}-driver`}>{label} driver</label>
      <select
        id={`${id}-driver`}
        value={sel.car ?? ''}
        onChange={(e) => onCar(e.target.value)}
        disabled={drivers.length === 0}
        className="overlay-select"
      >
        {/* An empty dropdown reads as "no drivers exist"; say we are waiting instead. */}
        {drivers.length === 0 && <option value="">Waiting for driver data…</option>}
        {drivers.map((n) => {
          const code = cars[n]?.code || String(n);
          return <option key={n} value={code}>{code}</option>;
        })}
      </select>
      <span className="empty">{hint}</span>
    </div>
  );
}

function OverlayLive({ initialA, initialB }: { initialA: SideSel; initialB: SideSel }) {
  const [a, setA] = useState<SideSel>(initialA);
  const [b, setB] = useState<SideSel>(initialB);

  // One subscription per DISTINCT session key: when both sides name the same race
  // (VER vs LEC at Monza 2024) the registry hands both hooks the same connection.
  const laneA = useLane(a.session.key);
  const laneB = useLane(b.session.key);
  const sameLane = a.session.key === b.session.key;

  const driversA = useMemo(() => driversWithTrace(laneA.state.lapTrace), [laneA.state.lapTrace]);
  const driversB = useMemo(() => driversWithTrace(laneB.state.lapTrace), [laneB.state.lapTrace]);

  // Resolve each side's code against its own lane. A code that names nobody in that
  // session (a cross-year link to a driver who was not on the grid) falls back to
  // the first available driver rather than rendering nothing.
  const numA = (a.car ? findByCode(laneA.state.cars, driversA, a.car) : null) ?? driversA[0] ?? null;
  const numB = (() => {
    const named = b.car ? findByCode(laneB.state.cars, driversB, b.car) : null;
    if (named != null) return named;
    // Same session and no explicit pick: default to a DIFFERENT driver, because
    // one driver against himself is a flat zero and says nothing.
    if (sameLane) return driversB.find((n) => n !== numA) ?? driversB[0] ?? null;
    // Cross-session: the same driver a year apart is the classic comparison.
    return (numA != null && driversB.includes(numA) ? numA : driversB[0]) ?? null;
  })();

  const codeA = numA != null ? driverCode(laneA.state.cars, numA) : '';
  const codeB = numB != null ? driverCode(laneB.state.cars, numB) : '';
  const samePair = sameLane && numA != null && numA === numB;

  const traceA = numA != null ? laneA.state.lapTrace[numA] : undefined;
  const traceB = numB != null ? laneB.state.lapTrace[numB] : undefined;
  const loopMs =
    traceA && traceB && !samePair
      ? Math.max(traceA[traceA.length - 1], traceB[traceB.length - 1]) + 800
      : 0;

  // The URL is the route's shareable state. replaceState, never pushState: changing
  // a picker must not bury the previous page under a stack of Back presses.
  useEffect(() => {
    if (!codeA || !codeB) return;
    const next = buildHash({
      route: 'ghost',
      a: { session: a.session.slug, car: codeA },
      b: { session: b.session.slug, car: codeB },
    });
    if (location.hash === next) return;
    history.replaceState(null, '', next);
  }, [a.session.slug, b.session.slug, codeA, codeB]);

  // Local looping/scrubbable clock (the route replays two reference laps; live
  // frames unused). tMsRef mirrors tMs so pause/resume/scrub can re-anchor the rAF
  // loop without waiting on a stale closure value.
  const [tMs, setTMs] = useState(0);
  // Reduced motion: the lap does not auto-play. The scrubber still works, so the
  // overlay stays fully usable — the user drives the clock instead of a loop.
  const reducedMotion = useReducedMotion();
  const [paused, setPaused] = useState(reducedMotion);
  const tMsRef = useRef(0);
  const rafRef = useRef<number | undefined>(undefined);
  const startRef = useRef(0);

  // Hard reset when either side changes — an "adjusting state during render" reset
  // (not an effect), so switching drivers while paused does NOT resume playback:
  // paused stays true, and the rAF effect below early-returns. The previous pair is
  // held in state rather than a ref: a ref may not be read during render, and this
  // comparison happens on every render by construction. tMsRef is re-synced by the
  // effect just below rather than written here.
  const pairKey = `${a.session.key}:${numA}|${b.session.key}:${numB}`;
  const [prevPair, setPrevPair] = useState(pairKey);
  if (prevPair !== pairKey) {
    setPrevPair(pairKey);
    setTMs(0);
  }

  // Keep the ref mirror in sync with committed tMs state (covers both the
  // render-time reset above and any external setTMs call).
  useEffect(() => { tMsRef.current = tMs; }, [tMs]);

  // Run/halt the loop. Re-anchor on every (re)start so resuming after a pause
  // continues from the frozen position instead of jumping forward by however
  // long it was paused.
  useEffect(() => {
    if (!loopMs || paused || reducedMotion) return;
    startRef.current = performance.now() - tMsRef.current;
    const tick = (now: number) => {
      const v = (now - startRef.current) % loopMs;
      tMsRef.current = v;
      setTMs(v);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
    // pairKey is included so a side switch always re-anchors startRef, even in the
    // edge case where two pairs happen to share the same loopMs.
  }, [loopMs, paused, pairKey, reducedMotion]);

  function scrub(v: number) {
    tMsRef.current = v;
    startRef.current = performance.now() - v;
    setTMs(v);
  }

  // Side A's outline is the one map both markers are drawn on.
  const track = laneA.state.track;
  const ready = track.length > 0 && !!traceA && !!traceB && !samePair;
  // Distinguishes "connected but nothing to compare" (a genuine data gap) from
  // "still waiting on a snapshot" — both would otherwise show the same
  // "Loading reference laps…" copy forever.
  const lanesLoaded = laneA.state.rev > 0 && laneB.state.rev > 0;
  const trackPath = useMemo(() => trackPathD(track), [track]);
  const viewBox = useMemo(() => fitViewBox(track), [track]);

  const idxA = ready ? indexAtTime(traceA!, tMs) : 0;
  const idxB = ready ? indexAtTime(traceB!, tMs) : 0;
  const delta = useMemo(
    () => (ready ? deltaSeries(traceA!, traceB!) : []),
    [ready, traceA, traceB],
  );
  // delta is clamped to the shorter trace; idxA indexes the full outline, so clamp it
  // before reading delta / placing the bar cursor (no-op when traces are equal length).
  const cursorIdx = delta.length ? Math.min(idxA, delta.length - 1) : 0;
  const dNow = ready ? (delta[cursorIdx] ?? 0) / 1000 : 0;
  const maxAbs = useMemo(() => delta.reduce((m, d) => Math.max(m, Math.abs(d)), 1), [delta]);

  // Per-side team colours. Two markers in one colour was readable only because the
  // old route always compared a driver with himself; two drivers need two colours.
  const carA = numA != null ? laneA.state.cars[numA] : undefined;
  const carB = numB != null ? laneB.state.cars[numB] : undefined;
  const colourA = carA ? teamColour[carA.team] ?? UNKNOWN_TEAM : UNKNOWN_TEAM;
  const colourB = carB ? teamColour[carB.team] ?? UNKNOWN_TEAM : UNKNOWN_TEAM;

  // idxB comes from side B's trace; clamp to side A's outline before the lookup so a
  // cross-year outline-length mismatch can't hand us an undefined point.
  const solid = ready ? track[Math.min(idxA, track.length - 1)] : undefined;
  const ghost = ready ? track[Math.min(idxB, track.length - 1)] : undefined;

  const approx = crossSeason(a.session, b.session);
  const labelA = `${a.session.label} ${codeA}`;
  const labelB = `${b.session.label} ${codeB}`;
  const pairLabel = sameLane
    ? `${a.session.label} — ${codeA} vs ${codeB}`
    : `${codeA} ${a.session.year} vs ${codeB} ${b.session.year}`;

  return (
    <Route
      title={`Lap delta overlay — ${pairLabel}`}
      rail={
        <StatusRail
          active="ghost"
          note={`${labelA} vs ${labelB} · each driver's fastest lap`}
        />
      }
    >
      <Panel label="Sources">
        <div className="overlay-sources">
          <SourcePicker
            label="A (solid)"
            sel={a}
            drivers={driversA}
            cars={laneA.state.cars}
            onSession={(s) => setA({ session: s, car: a.car })}
            onCar={(car) => setA({ ...a, car })}
            hint={laneA.state.label || '…'}
          />
          <SourcePicker
            label="B (ghost)"
            sel={b}
            drivers={driversB}
            cars={laneB.state.cars}
            onSession={(s) => setB({ session: s, car: b.car })}
            onCar={(car) => setB({ ...b, car })}
            hint={laneB.state.label || '…'}
          />
          {SESSIONS.length > 1 && (
            <div className="overlay-presets">
              <button
                type="button"
                className="btn"
                onClick={() => {
                  const other = SESSIONS.find((s) => s.slug !== a.session.slug) ?? a.session;
                  setB({ session: other, car: codeA || null });
                }}
              >
                Same driver, two years
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => setB({ session: a.session, car: null })}
              >
                Two drivers, one race
              </button>
            </div>
          )}
        </div>
        {/* The two clips are normalised independently, so a marker from another
            season is placed on THIS season's outline — close, but not the same
            metres. Said out loud rather than left as a code comment. */}
        <p className="empty overlay-note">
          {approx
            ? 'Across seasons the ghost is placed on this year’s track outline — the two clips are normalised independently, so positions are approximate. The delta itself is exact.'
            : 'Both laps come from the same session and the same outline, so positions and delta are exact.'}
          {' '}Each side replays that driver&rsquo;s fastest accurate lap of the session — not
          two cars racing wheel to wheel.
        </p>
        {/* The Pages build bakes one clip, so one axis of the comparison genuinely
            is not here. Said plainly, in place, rather than replacing the whole
            working view with a "not in this demo" card. */}
        {STATIC_DEMO && (
          <p className="empty overlay-note">
            This public demo plays one baked clip (Monza 2024), so the driver-vs-driver
            comparison above is the whole of it — a cross-season overlay needs a second
            replay lane. <code>docker compose up</code> from{' '}
            <a className="demo-notice-link" href={REPO_URL} target="_blank" rel="noreferrer">
              the repository ↗
            </a>{' '}brings both seasons up locally.
          </p>
        )}
      </Panel>
      <Panel label="Controls">
        <div className="ghost-controls">
          {/* The headline number of the whole route, so it gets the display rung
              rather than sitting at control size beside the scrubber. */}
          {/* "−1.66s" alone is uninterpretable — ahead of what, behind by what?
              The number keeps the display rung; the words say which way it points. */}
          {ready && (
            <span className="ghost-delta">
              <span style={{ fontSize: 'var(--fs-2xl)', fontWeight: 700, color: dNow > 0 ? 'var(--bad)' : 'var(--good)' }}>
                {dNow > 0 ? '+' : ''}{dNow.toFixed(2)}s
              </span>
              <span className="empty">
                {Math.abs(dNow) < 0.005
                  ? `${labelA} level here`
                  : `${labelA} ${dNow > 0 ? 'behind' : 'ahead'} by ${Math.abs(dNow).toFixed(2)}s here`}
              </span>
            </span>
          )}
          <button className="btn" onClick={() => setPaused((p) => !p)} disabled={!ready}>
            {/* Before playback exists there is nothing to pause — offering Pause
                implies something is running. Show the inert Play instead. */}
            {paused || !ready ? '▶ Play' : '⏸ Pause'}
          </button>
          <input
            type="range"
            min={0}
            max={Math.max(0, loopMs - 1)}
            step={100}
            value={Math.floor(tMs)}
            disabled={!ready}
            onChange={(e) => scrub(Number(e.target.value))}
            aria-label="Lap position"
            // Without this the slider announces its raw value — "43700" — while
            // the human-readable elapsed time sits rendered right beside it.
            aria-valuetext={fmtElapsed(tMs)}
            style={{ flex: 1, minWidth: 160 }}
          />
          <span className="rail-clock">{fmtElapsed(tMs)}</span>
        </div>
      </Panel>
      <Panel label="Track">
        {!ready ? (
          <div className="track-skeleton">
            {overlaySkeletonCopy(samePair, lanesLoaded, driversA.length, laneA.status, laneB.status)}
          </div>
        ) : (
          <>
          {/* Two dots that overlap for most of a lap, one solid and one dashed,
              with nothing on the page saying which side is which. */}
          <div className="delta-key">
            <span><span className="key-dot" style={{ background: colourA }} /> {labelA} (solid)</span>
            <span><span className="key-dot key-dot-ghost" style={{ background: colourB }} /> {labelB} (ghost)</span>
          </div>
          <svg viewBox={viewBox} className="track-svg ghost-track" role="img" aria-label={`Overlay track map — ${pairLabel}`}>
            <TrackPath d={trackPath} />
            {/* Side B. A flat 0.4 opacity over a dark map measured 1.59:1 — well
                under the 3:1 a graphic that carries meaning needs, and for dark
                team colours no opacity gets there. The ring does the work instead:
                dashed and full-strength, so the ghost is told apart from the solid
                car by outline style rather than by how faint it is. */}
            <circle
              cx={ghost!.x * SIZE} cy={ghost!.y * SIZE} r={7}
              fill={colourB} fillOpacity={0.45}
              stroke="var(--track-label)" strokeWidth={1.5} strokeDasharray="3 2"
            />
            <text x={ghost!.x * SIZE + 10} y={ghost!.y * SIZE - 8} fill="var(--track-label)" fontSize="var(--fs-xs)">{codeB}</text>
            {/* Side A */}
            <circle cx={solid!.x * SIZE} cy={solid!.y * SIZE} r={7} fill={colourA} stroke="var(--marker-halo)" strokeWidth={1.5} />
            <text x={solid!.x * SIZE + 10} y={solid!.y * SIZE + 4} fill="var(--track-label)" fontSize="var(--fs-xs)">{codeA}</text>
          </svg>
          </>
        )}
      </Panel>

      {ready && (
        <Panel label="Lap time delta">
          {/* The one sentence a reader needs was a code comment: "red above the
              midline = A slower, green below = faster". It is on screen now, with
              the scale the chart auto-fits to — without it a 0.05s spread and a 5s
              spread draw identically. */}
          <div className="delta-key">
            <span style={{ color: 'var(--bad)' }}>▲ {codeA} slower</span>
            <span style={{ color: 'var(--good)' }}>▼ {codeA} faster</span>
            <span className="empty">full height = {(maxAbs / 1000).toFixed(2)}s</span>
          </div>
          {/* Its own class, not .track-svg: the delta bar is a wide short strip
              with a fixed 600×90 box, and .track-svg is now sized from its
              height so a portrait circuit can't grow taller than the panel. */}
          <svg viewBox={`0 0 ${SIZE} ${BAR_H}`} className="delta-svg" role="img" aria-label="Lap time delta around the circuit">
            <line x1={0} y1={BAR_H / 2} x2={SIZE} y2={BAR_H / 2} stroke="var(--ghost-rule)" strokeWidth={1} />
            {delta.map((d, i) => {
              const h = (Math.abs(d) / maxAbs) * (BAR_H / 2);
              const x = (i / delta.length) * SIZE;
              const y = d > 0 ? BAR_H / 2 - h : BAR_H / 2;
              return <rect key={i} x={x} y={y} width={Math.max(1, SIZE / delta.length)} height={h} fill={d > 0 ? 'var(--bad)' : 'var(--good)'} />;
            })}
            {/* playback cursor at side A's current fraction */}
            <line x1={(cursorIdx / delta.length) * SIZE} y1={0} x2={(cursorIdx / delta.length) * SIZE} y2={BAR_H} stroke="var(--chalk)" strokeWidth={1.5} />
          </svg>
        </Panel>
      )}

    </Route>
  );
}
