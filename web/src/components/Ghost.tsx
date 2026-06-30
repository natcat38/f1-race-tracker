import { useEffect, useRef, useState } from 'react';
import { connectRace } from '../realtime/socket';
import { emptyState, type RaceState } from '../state/race';
import { teamColour } from './teamColours';
import { commonDrivers, deltaSeries, indexAtTime } from '../state/ghost';

const SIZE = 600;
const BAR_H = 90;
const THIS = { session: 'compare-monza-2024', year: '2024' };
const LAST = { session: 'compare-monza-2023', year: '2023' };

export function Ghost() {
  const [thisYear, setThisYear] = useState<RaceState>(emptyState());
  const [lastYear, setLastYear] = useState<RaceState>(emptyState());
  useEffect(() => connectRace(setThisYear, undefined, THIS.session), []);
  useEffect(() => connectRace(setLastYear, undefined, LAST.session), []);

  const drivers = commonDrivers(thisYear.lapTrace, lastYear.lapTrace);
  const [selected, setSelected] = useState<number | null>(null);
  const resolvedSelected = selected != null ? selected : (drivers[0] ?? null);

  const traceThis = resolvedSelected != null ? thisYear.lapTrace[resolvedSelected] : undefined;
  const traceLast = resolvedSelected != null ? lastYear.lapTrace[resolvedSelected] : undefined;
  const loopMs =
    traceThis && traceLast
      ? Math.max(traceThis[traceThis.length - 1], traceLast[traceLast.length - 1]) + 800
      : 0;

  // Local looping clock (the route replays the two reference laps; live frames unused).
  const [tMs, setTMs] = useState(0);
  const rafRef = useRef<number | undefined>(undefined);
  const startRef = useRef<number>(0);
  useEffect(() => {
    if (!loopMs) return;
    startRef.current = performance.now();
    const tick = (now: number) => {
      setTMs((now - startRef.current) % loopMs);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [loopMs, resolvedSelected]);

  const track = thisYear.track;
  const ready = track.length > 0 && !!traceThis && !!traceLast;
  const trackPath = track.length
    ? 'M ' + track.map((p) => `${p.x * SIZE},${p.y * SIZE}`).join(' L ') + ' Z'
    : '';

  const idxThis = ready ? indexAtTime(traceThis!, tMs) : 0;
  const idxLast = ready ? indexAtTime(traceLast!, tMs) : 0;
  const delta = ready ? deltaSeries(traceThis!, traceLast!) : [];
  // delta is clamped to the shorter trace; idxThis indexes the full outline, so clamp it
  // before reading delta / placing the bar cursor (no-op when the traces are equal length).
  const cursorIdx = delta.length ? Math.min(idxThis, delta.length - 1) : 0;
  const dNow = ready ? (delta[cursorIdx] ?? 0) / 1000 : 0;
  const maxAbs = delta.reduce((m, d) => Math.max(m, Math.abs(d)), 1);

  const car =
    resolvedSelected != null ? thisYear.cars[resolvedSelected] ?? lastYear.cars[resolvedSelected] : undefined;
  const colour = car ? teamColour[car.team] ?? '#bbb' : '#bbb';
  const code = car?.code ?? (resolvedSelected != null ? String(resolvedSelected) : '');

  const solid = ready ? track[idxThis] : undefined;
  const ghost = ready ? track[idxLast] : undefined;

  return (
    <div style={{ padding: 24, color: '#eee', background: '#0a0a0a', minHeight: '100vh' }}>
      <h2 style={{ margin: '0 0 16px', display: 'flex', gap: 16, alignItems: 'baseline' }}>
        <span>Ghost overlay · Monza</span>
        <span style={{ color: '#888', fontSize: 14, fontWeight: 400 }}>
          {THIS.year} solid vs {LAST.year} ghost · fastest lap (approx)
        </span>
        <a href="#" style={{ color: '#3671C6', fontSize: 14, fontWeight: 400 }}>← live board</a>
      </h2>

      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 12 }}>
        <label style={{ fontFamily: 'monospace', fontSize: 14 }}>Driver</label>
        <select
          value={resolvedSelected ?? ''}
          onChange={(e) => setSelected(Number(e.target.value))}
          style={{ background: '#1a1a1a', color: '#eee', border: '1px solid #333', padding: '4px 8px', borderRadius: 6 }}
        >
          {drivers.map((n) => {
            const c = thisYear.cars[n] ?? lastYear.cars[n];
            return <option key={n} value={n}>{c?.code ?? n}</option>;
          })}
        </select>
        {ready && (
          <span style={{ fontFamily: 'monospace', fontSize: 18, color: dNow > 0 ? '#ff5252' : '#4caf50' }}>
            {dNow > 0 ? '+' : ''}{dNow.toFixed(2)}s
          </span>
        )}
      </div>

      {!ready ? (
        <div style={{ width: SIZE, height: SIZE, background: '#111', borderRadius: 12 }} />
      ) : (
        <>
          <svg width={SIZE} height={SIZE} style={{ background: '#111', borderRadius: 12 }}>
            <path d={trackPath} fill="none" stroke="#333" strokeWidth={10} strokeLinejoin="round" />
            <path d={trackPath} fill="none" stroke="#1a1a1a" strokeWidth={6} strokeLinejoin="round" />
            {/* ghost (last year) — translucent */}
            <circle cx={ghost!.x * SIZE} cy={ghost!.y * SIZE} r={7} fill={colour} opacity={0.4} stroke="#000" strokeWidth={1} />
            {/* solid (this year) */}
            <circle cx={solid!.x * SIZE} cy={solid!.y * SIZE} r={7} fill={colour} stroke="#fff" strokeWidth={1.5} />
            <text x={solid!.x * SIZE + 10} y={solid!.y * SIZE + 4} fill="#eee" fontSize={11}>{code}</text>
          </svg>

          {/* delta bar: red above the midline = this year slower, green below = faster */}
          <svg width={SIZE} height={BAR_H} style={{ background: '#111', borderRadius: 12, marginTop: 12, display: 'block' }}>
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
        </>
      )}
    </div>
  );
}
