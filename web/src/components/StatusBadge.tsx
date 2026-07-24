import type { ConnStatus } from '../realtime/socket';
import type { RaceState } from '../state/race';

interface Props {
  status: ConnStatus;
  state: RaceState;
  staleSec?: number;
}

const STALE_THRESHOLD_SEC = 4;

export function StatusBadge({ status, state, staleSec }: Props) {
  if (status === 'reconnecting') {
    return <span className="chip chip-reconnect">↺ Reconnecting…</span>;
  }
  if (state.rev === 0) {
    return <span className="chip chip-warm">⏳ Warming up the timing feed…</span>;
  }
  if ((staleSec ?? 0) >= STALE_THRESHOLD_SEC) {
    return (
      <span className="chip chip-stall">
        ⚠ Waiting for timing data — last frame {staleSec}s ago
      </span>
    );
  }
  if (state.mode === 'live') {
    return (
      <span
        className="chip chip-live"
        title="Demo lane streaming a second replay clip — real live ingestion not yet verified"
      >
        ● LIVE (DEMO)
      </span>
    );
  }
  return <span className="chip chip-replay">▶ REPLAY</span>;
}
