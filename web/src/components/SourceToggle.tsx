import { useState } from 'react';
import type { RaceState } from '../state/race';

const SOURCES = [
  { key: 'replay', label: '▶ Replay' },
  { key: 'live', label: '● Live' },
] as const;

// The active source is whatever the current snapshot's mode says — the gateway
// broadcasts a fresh snapshot (mode "live"|"replay") the instant it switches.
export function SourceToggle({ state }: { state: RaceState }) {
  const [busy, setBusy] = useState(false);
  const active = state.mode;

  async function pick(source: string) {
    if (busy || source === active) return;
    setBusy(true);
    try {
      await fetch('/control/source', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source }),
      });
    } finally {
      setBusy(false);
    }
  }

  return (
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
  );
}
