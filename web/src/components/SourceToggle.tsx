// The replay/live lane switch, including the caveat text that keeps the live lane
// honest.

import { useState } from 'react';
import type { RaceState } from '../state/race';
import { SegmentedControl } from './SegmentedControl';

const SOURCES = [
  { key: 'replay', label: '▶ Replay', caveat: undefined },
  {
    key: 'live', label: '● Live',
    caveat: 'Demo lane streaming a second replay clip — real live ingestion not yet verified',
  },
] as const;

// The active source is the session key the gateway is currently fanning out
// ("replay"|"live") — it broadcasts a fresh snapshot the instant it switches.
// We key off session (the lane) rather than mode (the data's provenance) so the
// highlight is correct even when both lanes happen to be replay-sourced.
//
// The radiogroup, roving tabindex and arrow keys now live in SegmentedControl:
// Replay-vs-Live is a single-select choice, and it is the rail's reference
// example of that grammar rather than a one-off.
export function SourceToggle({ state }: { state: RaceState }) {
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const active = state.session;

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

  return (
    <>
      <SegmentedControl
        scope="Lane"
        ariaLabel="Data source"
        options={SOURCES}
        value={active}
        pending={pending}
        disabled={pending !== null}
        onPick={pick}
      />
      <span role="status" aria-live="polite">
        {error && <span className="src-error">{error}</span>}
      </span>
    </>
  );
}
