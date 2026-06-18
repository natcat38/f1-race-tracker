import type { ConnStatus } from '../realtime/socket';
import type { RaceState } from '../state/race';

interface Props {
  status: ConnStatus;
  state: RaceState;
}

const badgeStyle: React.CSSProperties = {
  display: 'inline-block',
  padding: '2px 10px',
  borderRadius: 6,
  fontFamily: 'monospace',
  fontSize: 13,
  fontWeight: 600,
  letterSpacing: '0.04em',
};

export function StatusBadge({ status, state }: Props) {
  if (status === 'reconnecting') {
    return (
      <span style={{ ...badgeStyle, background: '#7c3f00', color: '#ffb347' }}>
        ↺ Reconnecting…
      </span>
    );
  }
  if (state.rev === 0) {
    return (
      <span style={{ ...badgeStyle, background: '#1a1a2e', color: '#888' }}>
        ⏳ Warming up the timing feed…
      </span>
    );
  }
  if (state.mode === 'live') {
    return (
      <span style={{ ...badgeStyle, background: '#1a3a1a', color: '#52E252' }}>
        ● LIVE
      </span>
    );
  }
  return (
    <span style={{ ...badgeStyle, background: '#1a2a3a', color: '#64C4FF' }}>
      ▶ REPLAY
    </span>
  );
}
