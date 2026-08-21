// The replay/live lane switch, including the caveat text that keeps the live lane
// honest.

import { useRef, useState } from 'react';
import type { RaceState } from '../state/race';

const SOURCES = [
  { key: 'replay', label: '▶ Replay', caveat: undefined },
  {
    key: 'live', label: '● Live (demo)',
    caveat: 'Demo lane streaming a second replay clip — real live ingestion not yet verified',
  },
] as const;

// The active source is the session key the gateway is currently fanning out
// ("replay"|"live") — it broadcasts a fresh snapshot the instant it switches.
// We key off session (the lane) rather than mode (the data's provenance) so the
// highlight is correct even when both lanes happen to be replay-sourced.
export function SourceToggle({ state }: { state: RaceState }) {
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const active = state.session;
  const btnRefs = useRef(new Map<string, HTMLButtonElement | null>());
  // Replay-vs-Live is a single-select choice, not two independent switches, so it
  // is a radio group: `.btn-active` was the only "on" signal and carried nothing
  // non-visually. Roving tabindex + arrows are what make the role honest — a
  // radiogroup a user can only Tab through is a radiogroup in name only. Falls
  // back to the first option so the group is always reachable even on a route
  // whose session key is neither of these.
  const activeIdx = Math.max(0, SOURCES.findIndex((s) => s.key === active));

  async function pick(source: string) {
    if (pending || source === active) return;
    setPending(source);
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
      setPending(null);
    }
  }

  function onKeyDown(e: React.KeyboardEvent, idx: number) {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 } as const;
    const d = step[e.key as keyof typeof step];
    if (d === undefined) return;
    e.preventDefault();
    const next = SOURCES[(idx + d + SOURCES.length) % SOURCES.length];
    btnRefs.current.get(next.key)?.focus();
    pick(next.key);
  }

  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--sp-2)' }}>
      <div role="radiogroup" aria-label="Data source" style={{ display: 'inline-flex', gap: 'var(--sp-1)' }}>
        {SOURCES.map((s, i) => (
          <button
            key={s.key}
            type="button"
            role="radio"
            aria-checked={active === s.key}
            ref={(el) => { btnRefs.current.set(s.key, el); }}
            tabIndex={i === activeIdx ? 0 : -1}
            onKeyDown={(e) => onKeyDown(e, i)}
            onClick={() => pick(s.key)}
            disabled={pending !== null}
            className={active === s.key ? 'btn btn-active' : 'btn'}
            title={s.caveat}
          >
            {pending === s.key ? 'Switching…' : s.label}
            {/* Was title-only, so unreachable on touch and to anyone who never
                hovers — and this particular caveat is the honest one. */}
            {s.caveat && <span className="visually-hidden"> — {s.caveat}</span>}
          </button>
        ))}
      </div>
      <span role="status" aria-live="polite">
        {error && <span className="src-error">{error}</span>}
      </span>
    </div>
  );
}
