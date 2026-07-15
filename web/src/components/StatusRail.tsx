import type { ReactNode } from 'react';
import type { RaceState } from '../state/race';
import type { ConnStatus } from '../realtime/socket';
import { StatusBadge } from './StatusBadge';
import { fmtClock } from './timingHelpers';

const TABS = [
  { key: 'board', href: '#', label: 'BOARD', sub: 'live board' },
  { key: 'compare', href: '#compare', label: 'COMPARE', sub: 'side by side' },
  { key: 'ghost', href: '#ghost', label: 'OVERLAY', sub: 'lap delta' },
] as const;

// StatusRail is the persistent instrument strip on every route — the
// signature element. On the board it carries live session identity, the
// race clock, and lane health; on Compare/Ghost (two independent lanes,
// no single clock to show) it's a lighter shell: brand, a static note,
// and the same view tabs.
export function StatusRail({
  active, state, status, staleSec, note, children,
}: {
  active: 'board' | 'compare' | 'ghost';
  state?: RaceState;
  status?: ConnStatus;
  staleSec?: number;
  note?: string;
  children?: ReactNode;
}) {
  return (
    <div className="rail">
      <span className="rail-brand">F1 Race Tracker</span>
      {state && (
        <>
          {state.label && <span className="rail-session">{state.label}</span>}
          <span className="rail-clock">{fmtClock(state.timeMs)}</span>
          <StatusBadge status={status ?? 'connecting'} state={state} staleSec={staleSec} />
        </>
      )}
      {note && <span className="rail-note">{note}</span>}
      {children}
      <span className="rail-spacer" />
      <nav className="rail-tabs">
        {TABS.map((t) => (
          <a
            key={t.key}
            href={t.href}
            className={active === t.key ? 'rail-tab rail-tab-active' : 'rail-tab'}
          >
            <span>{t.label}</span>
            <span className="rail-tab-sub">{t.sub}</span>
          </a>
        ))}
      </nav>
    </div>
  );
}
