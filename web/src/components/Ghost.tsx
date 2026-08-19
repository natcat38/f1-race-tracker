import { useEffect, useMemo, useRef, useState } from 'react';
import { connectRace, type ConnStatus } from '../realtime/socket';
import { emptyState, type RaceState } from '../state/race';
import { teamColour } from './teamColours';
import { commonDrivers, deltaSeries, indexAtTime, ghostSkeletonCopy } from '../state/ghost';
import { fmtElapsed } from './timingHelpers';
import { SIZE } from './geometry';
import { Panel } from './Panel';
import { StatusRail } from './StatusRail';

const BAR_H = 90;
const THIS = { session: 'compare-monza-2024', year: '2024' };
const LAST = { session: 'compare-monza-2023', year: '2023' };

export function Ghost({ initialSelected }: { initialSelected?: number | null } = {}) {
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
  const [paused, setPaused] = useState(false);
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
    if (!loopMs || paused) return;
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
  }, [loopMs, paused, resolvedSelected]);

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
  const trackPath = useMemo(
    () => (track.length ? 'M ' + track.map((p) => `${p.x * SIZE},${p.y * SIZE}`).join(' L ') + ' Z' : ''),
    [track],
  );

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
  const colour = car ? teamColour[car.team] ?? '#bbb' : '#bbb';
  const code = car?.code ?? (resolvedSelected != null ? String(resolvedSelected) : '');

  // idxLast comes from last-year's trace; clamp to this-year's outline before the
  // lookup so a cross-year outline-length mismatch can't hand us an undefined point.
  const solid = ready ? track[Math.min(idxThis, track.length - 1)] : undefined;
  const ghost = ready ? track[Math.min(idxLast, track.length - 1)] : undefined;

  return (
    <div className="page">
      <StatusRail
        active="ghost"
        note={`${THIS.year} solid vs ${LAST.year} ghost · fastest lap (approx)`}
      />

      <Panel label="Track">
        {!ready ? (
          <div className="track-skeleton">
            {ghostSkeletonCopy(lanesLoaded, drivers.length, statusThis, statusLast)}
          </div>
        ) : (
          <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="track-svg" role="img" aria-label="Ghost overlay track map">
            <path d={trackPath} fill="none" stroke="#333" strokeWidth={10} strokeLinejoin="round" />
            <path d={trackPath} fill="none" stroke="#1a1a1a" strokeWidth={6} strokeLinejoin="round" />
            {/* ghost (last year) — translucent */}
            <circle cx={ghost!.x * SIZE} cy={ghost!.y * SIZE} r={7} fill={colour} opacity={0.4} stroke="#000" strokeWidth={1} />
            {/* solid (this year) */}
            <circle cx={solid!.x * SIZE} cy={solid!.y * SIZE} r={7} fill={colour} stroke="#fff" strokeWidth={1.5} />
            <text x={solid!.x * SIZE + 10} y={solid!.y * SIZE + 4} fill="#eee" fontSize={11}>{code}</text>
          </svg>
        )}
      </Panel>

      {ready && (
        <Panel label="Delta bar">
          {/* red above the midline = this year slower, green below = faster */}
          <svg viewBox={`0 0 ${SIZE} ${BAR_H}`} className="track-svg" role="img" aria-label="Lap time delta around the circuit">
            <line x1={0} y1={BAR_H / 2} x2={SIZE} y2={BAR_H / 2} stroke="#444" strokeWidth={1} />
            {delta.map((d, i) => {
              const h = (Math.abs(d) / maxAbs) * (BAR_H / 2);
              const x = (i / delta.length) * SIZE;
              const y = d > 0 ? BAR_H / 2 - h : BAR_H / 2;
              return <rect key={i} x={x} y={y} width={Math.max(1, SIZE / delta.length)} height={h} fill={d > 0 ? '#ff5252' : '#4caf50'} />;
            })}
            {/* playback cursor at this-year's current fraction */}
            <line x1={(cursorIdx / delta.length) * SIZE} y1={0} x2={(cursorIdx / delta.length) * SIZE} y2={BAR_H} stroke="#fff" strokeWidth={1.5} />
          </svg>
        </Panel>
      )}

      <Panel label="Controls">
        <div className="ghost-controls">
          <label style={{ fontSize: 'var(--fs-lg)' }}>Driver</label>
          <select
            value={resolvedSelected ?? ''}
            onChange={(e) => setSelected(Number(e.target.value))}
            disabled={drivers.length === 0}
            style={{ background: 'var(--asphalt)', color: 'var(--chalk)', border: '1px solid var(--edge)', padding: '4px 8px', borderRadius: 4 }}
          >
            {/* An empty dropdown reads as "no drivers exist"; say we are waiting instead. */}
            {drivers.length === 0 && <option value="">Waiting for driver data…</option>}
            {drivers.map((n) => {
              const c = thisYear.cars[n] ?? lastYear.cars[n];
              return <option key={n} value={n}>{c?.code ?? n}</option>;
            })}
          </select>
          {ready && (
            <span style={{ fontSize: 'var(--fs-xl)', color: dNow > 0 ? '#ff5252' : '#4caf50' }}>
              {dNow > 0 ? '+' : ''}{dNow.toFixed(2)}s
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
            style={{ flex: 1, minWidth: 160 }}
          />
          <span className="rail-clock">{fmtElapsed(tMs)}</span>
        </div>
      </Panel>
    </div>
  );
}
