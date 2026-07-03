import { useState } from 'react';
import type { RaceState } from '../state/race';

const SOURCES = [
  { key: 'replay', label: '▶ Replay' },
  { key: 'live', label: '● Live' },
] as const;

// The active source is the session key the gateway is currently fanning out
// ("replay"|"live") — it broadcasts a fresh snapshot the instant it switches.
// We key off session (the lane) rather than mode (the data's provenance) so the
// highlight is correct even when both lanes happen to be replay-sourced.
export function SourceToggle({ state }: { state: RaceState }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const active = state.session;

  async function pick(source: string) {
    if (busy || source === active) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/control/source', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source }),
      });
      if (!res.ok) setError(`switch failed (${res.status})`);
    } catch {
      setError('switch failed: network error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      <div style={{ display: 'inline-flex', gap: 4, padding: 4, background: '#1a1a1a', borderRadius: 10 }}>
      {SOURCES.map((s) => (
        <button
          key={s.key}
          onClick={() => pick(s.key)}
          disabled={busy}
          style={{
            border: 'none', cursor: busy ? 'wait' : 'pointer',
            padding: '6px 14px', borderRadius: 8, fontFamily: 'monospace', fontSize: 13,
            background: active === s.key ? '#3671C6' : 'transparent',
            color: active === s.key ? '#fff' : '#888',
          }}
        >
          {s.label}
        </button>
      ))}
      </div>
      {error && <span style={{ color: '#e10600', fontFamily: 'monospace', fontSize: 12 }}>{error}</span>}
    </div>
  );
}
