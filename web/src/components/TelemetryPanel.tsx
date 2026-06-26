import type { Car } from '../state/race';

function Bar({ label, value }: { label: string; value: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: 'monospace', fontSize: 12 }}>
      <span style={{ width: 64, color: '#888' }}>{label}</span>
      <div style={{ flex: 1, height: 8, background: '#222', borderRadius: 4 }}>
        <div style={{ width: `${Math.max(0, Math.min(100, value))}%`, height: '100%', background: '#3bb273', borderRadius: 4 }} />
      </div>
      <span style={{ width: 36, textAlign: 'right' }}>{value}</span>
    </div>
  );
}

export function TelemetryPanel({ car }: { car: Car | undefined }) {
  if (!car) {
    return <div style={{ color: '#666', fontFamily: 'monospace', fontSize: 12 }}>Select a car to see telemetry</div>;
  }
  return (
    <div style={{ display: 'grid', gap: 8, minWidth: 240 }}>
      <div style={{ fontFamily: 'monospace', fontSize: 14 }}>
        <b>{car.code}</b> <span style={{ color: '#888' }}>{car.team}</span>
      </div>
      <div style={{ fontFamily: 'monospace', fontSize: 28 }}>
        {car.speed ?? 0} <span style={{ fontSize: 14, color: '#888' }}>km/h</span>
        <span style={{ marginLeft: 16 }}>G{car.gear ?? 0}</span>
        {car.drs ? <span style={{ marginLeft: 16, color: '#3bb273' }}>DRS</span> : <span style={{ marginLeft: 16, color: '#444' }}>DRS</span>}
      </div>
      <Bar label="Throttle" value={car.throttle ?? 0} />
      <Bar label="Brake" value={car.brake ?? 0} />
    </div>
  );
}
