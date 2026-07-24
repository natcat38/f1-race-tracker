import type { Car, RaceState } from '../state/race';
import { fmtLap, fmtGap, type LapHistory, type GapHistory } from './timingHelpers';

function Bar({ label, value }: { label: string; value: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
      <span style={{ width: 64, color: 'var(--slate)' }}>{label}</span>
      <div style={{ flex: 1, height: 8, background: 'var(--edge)', borderRadius: 4 }}>
        <div style={{ width: `${Math.max(0, Math.min(100, value))}%`, height: '100%', background: '#3bb273', borderRadius: 4 }} />
      </div>
      <span style={{ width: 36, textAlign: 'right' }}>{value}</span>
    </div>
  );
}

// Sparkline: one bar per completed lap, red = slower than previous lap,
// green = faster — the stint-degradation squint test. Reused for the gap
// trend too, where the same colouring reads as "closing" (green) vs
// "opening" (red).
function Sparkline({ values }: { values: (number | undefined)[] }) {
  const known = values.filter((v): v is number => v != null);
  if (known.length === 0) return null;
  const min = Math.min(...known), max = Math.max(...known);
  const span = max - min || 1;
  return (
    <svg width={values.length * 15} height={24} role="img" aria-label="Trend">
      {values.map((v, i) => {
        if (v == null) return null;
        const h = 4 + ((v - min) / span) * 18;
        const prev = values[i - 1];
        const slower = i > 0 && prev != null && v > prev;
        return (
          <rect key={i} x={i * 15} y={24 - h} width={11} height={h}
                fill={slower ? '#e1342e' : '#3bb273'} />
        );
      })}
    </svg>
  );
}

function CarTelemetry({ car, history, gapHistory }: {
  car: Car; history?: number[]; gapHistory?: (number | undefined)[];
}) {
  return (
    <div style={{ display: 'grid', gap: 8, minWidth: 200 }}>
      <div style={{ fontSize: 14 }}>
        <b>{car.code}</b> <span style={{ color: 'var(--slate)' }}>{car.team}</span>
      </div>
      <div style={{ fontFamily: 'var(--display)', fontSize: 28 }}>
        {car.speed ?? 0} <span style={{ fontSize: 14, color: 'var(--slate)' }}>km/h</span>
        <span style={{ marginLeft: 16 }}>G{car.gear ?? 0}</span>
        {car.drs ? <span style={{ marginLeft: 16, color: '#3bb273' }}>DRS</span> : <span style={{ marginLeft: 16, color: 'var(--edge)' }}>DRS</span>}
      </div>
      <Bar label="Throttle" value={car.throttle ?? 0} />
      <Bar label="Brake" value={car.brake ?? 0} />
      {history && history.length >= 2 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
          <span style={{ width: 64, color: 'var(--slate)' }}>Laps</span>
          <Sparkline values={history} />
          <span>{fmtLap(history[history.length - 1])}</span>
        </div>
      )}
      {gapHistory && gapHistory.length >= 2 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
          <span style={{ width: 64, color: 'var(--slate)' }}>Gap</span>
          <Sparkline values={gapHistory} />
          <span>{fmtGap(gapHistory[gapHistory.length - 1])}</span>
        </div>
      )}
    </div>
  );
}

// TelemetryPanel takes the raw state + selection (rather than every car/history
// combination pre-looked-up by the caller) and does the primary/rival lookup
// once, itself, for both cars — instead of the caller duplicating the same
// `x != null ? lookup[x] : undefined` pattern once per car.
export function TelemetryPanel({
  state, lapHistory, gapHistory, selected, rival, onRivalChange,
}: {
  state: RaceState;
  lapHistory: LapHistory;
  gapHistory: GapHistory;
  selected: number | null;
  rival: number | null;
  onRivalChange?: (driverNum: number | null) => void;
}) {
  const car = selected != null ? state.cars[selected] : undefined;
  if (!car) {
    return <div className="empty">Select a car to see telemetry</div>;
  }
  const rivalCar = rival != null ? state.cars[rival] : undefined;
  const others = Object.values(state.cars).filter((c) => c.driverNum !== car.driverNum);
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      {others.length > 0 && onRivalChange && (
        <label style={{ fontSize: 11, color: 'var(--slate)', display: 'flex', alignItems: 'center', gap: 6 }}>
          vs
          <select
            value={rival ?? ''}
            onChange={(e) => onRivalChange(e.target.value ? Number(e.target.value) : null)}
            className="btn"
            style={{ fontSize: 11 }}
          >
            <option value="">— none —</option>
            {others.map((c) => (
              <option key={c.driverNum} value={c.driverNum}>{c.code}</option>
            ))}
          </select>
        </label>
      )}
      <div style={{ display: 'flex', gap: 16 }}>
        <CarTelemetry car={car} history={lapHistory[car.driverNum]} gapHistory={gapHistory[car.driverNum]?.gaps} />
        {rivalCar && (
          <CarTelemetry car={rivalCar} history={lapHistory[rivalCar.driverNum]} gapHistory={gapHistory[rivalCar.driverNum]?.gaps} />
        )}
      </div>
    </div>
  );
}
