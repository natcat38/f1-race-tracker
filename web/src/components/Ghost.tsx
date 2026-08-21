// The ghost route: a cross-year lap overlay animating this year's car against last
// year's trace.

import { useEffect, useMemo, useRef, useState } from 'react';
import { connectRace, type ConnStatus } from '../realtime/socket';
import { emptyState, type RaceState } from '../state/race';
import { teamColour } from './teamColours';
import { commonDrivers, deltaSeries, indexAtTime, ghostSkeletonCopy } from '../state/ghost';
import { fmtElapsed } from './timingHelpers';
import { SIZE, fitViewBox, trackPathD } from './geometry';
import { Panel } from './Panel';
import { TrackPath } from './TrackPath';
import { useReducedMotion } from '../hooks/useReducedMotion';
import { StatusRail } from './StatusRail';
import { Route } from './Route';
import { StaticDemoNotice } from './StaticDemoNotice';
import { STATIC_DEMO } from '../staticDemo';

const BAR_H = 90;
// Named once: '#bbb' appeared three times in this file as the same concept.
const UNKNOWN_TEAM = 'var(--team-unknown)';
const THIS = { session: 'compare-monza-2024', year: '2024' };
const LAST = { session: 'compare-monza-2023', year: '2023' };

// Split from GhostLive so the static build never mounts the two connectRace
// effects below: a Pages deployment has no gateway to dial, and the old
// unconditional mount left the route stuck on "Connection lost — retrying
// automatically…" forever while the console filled with socket errors.
export function Ghost({ initialSelected }: { initialSelected?: number | null } = {}) {
  if (STATIC_DEMO) {
    return (
      <Route
        title={`Lap delta overlay — ${THIS.year} vs ${LAST.year} (not in this demo)`}
        rail={<StatusRail active="ghost" note="Not available in the static demo" />}
      >
        <StaticDemoNotice
          label={`Lap delta overlay — ${THIS.year} vs ${LAST.year}`}
          what={`The overlay replays one driver's fastest lap from two different years at once —
                 this year solid, last year as a ghost — and draws the time delta corner by
                 corner around the circuit, so you can see exactly where the lap was won.`}
        />
      </Route>
    );
  }
  return <GhostLive initialSelected={initialSelected} />;
}

function GhostLive({ initialSelected }: { initialSelected?: number | null }) {
  const [thisYear, setThisYear] = useState<RaceState>(emptyState());
  const [lastYear, setLastYear] = useState<RaceState>(emptyState());
  const [statusThis, setStatusThis] = useState<ConnStatus>('connecting');
  const [statusLast, setStatusLast] = useState<ConnStatus>('connecting');
  useEffect(() => connectRace(setThisYear, setStatusThis, THIS.session), []);
  useEffect(() => connectRace(setLastYear, setStatusLast, LAST.session), []);

  const drivers = useMemo(
    () => commonDrivers(thisYear.lapTrace, lastYear.lapTrace),
    [thisYear.lapTrace, lastYear.lapTrace],
  );
  const [selected, setSelected] = useState<number | null>(initialSelected ?? null);
  // Default to the first common driver; fall back to it if a prior selection is no
  // longer present in both years (e.g. a lane reconnects with a different driver set).
  const resolvedSelected =
    selected != null && drivers.includes(selected) ? selected : (drivers[0] ?? null);

  const traceThis = resolvedSelected != null ? thisYear.lapTrace[resolvedSelected] : undefined;
  const traceLast = resolvedSelected != null ? lastYear.lapTrace[resolvedSelected] : undefined;
  const loopMs =
    traceThis && traceLast
      ? Math.max(traceThis[traceThis.length - 1], traceLast[traceLast.length - 1]) + 800
      : 0;

  // Local looping/scrubbable clock (the route replays the two reference laps;
  // live frames unused). tMsRef mirrors tMs so pause/resume/scrub can re-anchor
  // the rAF loop without waiting on a stale closure value.
  const [tMs, setTMs] = useState(0);
  // Reduced motion: the lap does not auto-play. The scrubber still works, so the
  // overlay stays fully usable — the user drives the clock instead of a loop.
  const reducedMotion = useReducedMotion();
  const [paused, setPaused] = useState(reducedMotion);
  const tMsRef = useRef(0);
  const rafRef = useRef<number | undefined>(undefined);
  const startRef = useRef(0);

  // Hard reset on driver switch — an "adjusting state during render" reset
  // (not an effect), so switching drivers while paused does NOT resume
  // playback: paused stays true, and the rAF effect below early-returns.
  // Refs may only be written in effects/handlers, not render, so tMsRef is
  // re-synced by the effect just below rather than written here directly.
  const prevSelectedRef = useRef(resolvedSelected);
  if (prevSelectedRef.current !== resolvedSelected) {
    prevSelectedRef.current = resolvedSelected;
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
    // resolvedSelected is included so a driver switch always re-anchors startRef,
    // even in the edge case where two drivers happen to share the same loopMs.
  }, [loopMs, paused, resolvedSelected, reducedMotion]);

  function scrub(v: number) {
    tMsRef.current = v;
    startRef.current = performance.now() - v;
    setTMs(v);
  }

  const track = thisYear.track;
  const ready = track.length > 0 && !!traceThis && !!traceLast;
  // Distinguishes "both lanes connected but share no driver" (a genuine data gap)
  // from "still waiting on a snapshot" — both would otherwise show the same
  // "Loading reference laps…" copy forever in the no-overlap case.
  const lanesLoaded = thisYear.rev > 0 && lastYear.rev > 0;
  const trackPath = useMemo(() => trackPathD(track), [track]);
  const viewBox = useMemo(() => fitViewBox(track), [track]);

  const idxThis = ready ? indexAtTime(traceThis!, tMs) : 0;
  const idxLast = ready ? indexAtTime(traceLast!, tMs) : 0;
  const delta = useMemo(
    () => (ready ? deltaSeries(traceThis!, traceLast!) : []),
    [ready, traceThis, traceLast],
  );
  // delta is clamped to the shorter trace; idxThis indexes the full outline, so clamp it
  // before reading delta / placing the bar cursor (no-op when the traces are equal length).
  const cursorIdx = delta.length ? Math.min(idxThis, delta.length - 1) : 0;
  const dNow = ready ? (delta[cursorIdx] ?? 0) / 1000 : 0;
  const maxAbs = useMemo(() => delta.reduce((m, d) => Math.max(m, Math.abs(d)), 1), [delta]);

  const car =
    resolvedSelected != null ? thisYear.cars[resolvedSelected] ?? lastYear.cars[resolvedSelected] : undefined;
  const colour = car ? teamColour[car.team] ?? UNKNOWN_TEAM : UNKNOWN_TEAM;
  const code = car?.code ?? (resolvedSelected != null ? String(resolvedSelected) : '');

  // idxLast comes from last-year's trace; clamp to this-year's outline before the
  // lookup so a cross-year outline-length mismatch can't hand us an undefined point.
  const solid = ready ? track[Math.min(idxThis, track.length - 1)] : undefined;
  const ghost = ready ? track[Math.min(idxLast, track.length - 1)] : undefined;

  return (
    <Route
      title={`Lap delta overlay — ${THIS.year} vs ${LAST.year}`}
      rail={
        <StatusRail
          active="ghost"
          note={`${THIS.year} solid vs ${LAST.year} ghost · fastest lap (approx)`}
        />
      }
    >
      <Panel label="Controls">
        <div className="ghost-controls">
          <label htmlFor="ghost-driver" style={{ fontSize: 'var(--fs-lg)' }}>Driver</label>
          <select
            id="ghost-driver"
            value={resolvedSelected ?? ''}
            onChange={(e) => setSelected(Number(e.target.value))}
            disabled={drivers.length === 0}
            style={{ background: 'var(--asphalt)', color: 'var(--chalk)', border: '1px solid var(--edge)', padding: 'var(--sp-1) var(--sp-2)', borderRadius: 'var(--radius)' }}
          >
            {/* An empty dropdown reads as "no drivers exist"; say we are waiting instead. */}
            {drivers.length === 0 && <option value="">Waiting for driver data…</option>}
            {drivers.map((n) => {
              const c = thisYear.cars[n] ?? lastYear.cars[n];
              return <option key={n} value={n}>{c?.code ?? n}</option>;
            })}
          </select>
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
                  ? `${THIS.year} level here`
                  : `${THIS.year} ${dNow > 0 ? 'behind' : 'ahead'} by ${Math.abs(dNow).toFixed(2)}s here`}
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
            {ghostSkeletonCopy(lanesLoaded, drivers.length, statusThis, statusLast)}
          </div>
        ) : (
          <>
          {/* Two dots that overlap for most of a lap, one solid and one dashed,
              with nothing on the page saying which year is which. */}
          <div className="delta-key">
            <span>● {THIS.year} (solid)</span>
            <span>◌ {LAST.year} (ghost)</span>
          </div>
          <svg viewBox={viewBox} className="track-svg ghost-track" role="img" aria-label="Ghost overlay track map">
            <TrackPath d={trackPath} />
            {/* Ghost (last year). A flat 0.4 opacity over a dark map measured
                1.59:1 — well under the 3:1 a graphic that carries meaning needs,
                and for dark team colours no opacity gets there. The ring does the
                work instead: dashed and full-strength, so the ghost is told apart
                from the solid car by outline style rather than by how faint it is. */}
            <circle
              cx={ghost!.x * SIZE} cy={ghost!.y * SIZE} r={7}
              fill={colour} fillOpacity={0.45}
              stroke="var(--track-label)" strokeWidth={1.5} strokeDasharray="3 2"
            />
            {/* solid (this year) */}
            <circle cx={solid!.x * SIZE} cy={solid!.y * SIZE} r={7} fill={colour} stroke="var(--marker-halo)" strokeWidth={1.5} />
            <text x={solid!.x * SIZE + 10} y={solid!.y * SIZE + 4} fill="var(--track-label)" fontSize="var(--fs-xs)">{code}</text>
          </svg>
          </>
        )}
      </Panel>

      {ready && (
        <Panel label="Lap time delta">
          {/* The one sentence a reader needs was a code comment: "red above the
              midline = this year slower, green below = faster". It is on screen
              now, with the scale the chart auto-fits to — without it a 0.05s
              spread and a 5s spread draw identically. */}
          <div className="delta-key">
            <span style={{ color: 'var(--bad)' }}>▲ {THIS.year} slower</span>
            <span style={{ color: 'var(--good)' }}>▼ {THIS.year} faster</span>
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
            {/* playback cursor at this-year's current fraction */}
            <line x1={(cursorIdx / delta.length) * SIZE} y1={0} x2={(cursorIdx / delta.length) * SIZE} y2={BAR_H} stroke="var(--chalk)" strokeWidth={1.5} />
          </svg>
        </Panel>
      )}

    </Route>
  );
}
