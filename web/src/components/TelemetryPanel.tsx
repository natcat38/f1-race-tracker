import type { Car } from '../state/race';
import { fmtLap } from './timingHelpers';

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
// green = faster — the stint-degradation squint test.
function Sparkline({ values }: { values: number[] }) {
  const min = Math.min(...values), max = Math.max(...values);
  const span = max - min || 1;
  return (
    <svg width={values.length * 15} height={24} role="img" aria-label="Lap time trend">
      {values.map((v, i) => {
        const h = 4 + ((v - min) / span) * 18;
        const slower = i > 0 && v > values[i - 1];
        return (
          <rect key={i} x={i * 15} y={24 - h} width={11} height={h}
                fill={slower ? '#e1342e' : '#3bb273'} />
        );
      })}
    </svg>
  );
}

export function TelemetryPanel({ car, history }: { car: Car | undefined; history?: number[] }) {
  if (!car) {
    return <div className="empty">Select a car to see telemetry</div>;
  }
  return (
    <div style={{ display: 'grid', gap: 8, minWidth: 240 }}>
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
    </div>
  );
}
