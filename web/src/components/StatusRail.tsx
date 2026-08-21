import type { ReactNode } from 'react';
import type { RaceState } from '../state/race';
import type { ConnStatus } from '../realtime/socket';
import { StatusBadge } from './StatusBadge';
import { fmtClock, leaderLapOf } from './timingHelpers';
import { REPO_URL } from '../staticDemo';

const TABS = [
  { key: 'board', href: '#', label: 'BOARD', sub: 'live board' },
  { key: 'compare', href: '#compare', label: 'COMPARE', sub: 'side by side' },
  { key: 'ghost', href: '#ghost', label: 'OVERLAY', sub: 'lap delta' },
  { key: 'settings', href: '#settings', label: 'LINK', sub: 'F1TV beta' },
] as const;

// StatusRail is the persistent instrument strip on every route — the
// signature element. On the board it carries live session identity, the
// race clock, and lane health; on Compare/Ghost (two independent lanes,
// no single clock to show) it's a lighter shell: brand, a static note,
// and the same view tabs.
export function StatusRail({
  active, state, status, staleSec, note, children,
}: {
  active: 'board' | 'compare' | 'ghost' | 'settings';
  state?: RaceState;
  status?: ConnStatus;
  staleSec?: number;
  note?: string;
  children?: ReactNode;
}) {
  // The race leader's current lap, out of the session's total — the recorder bakes
  // both from FastF1's lap data (ingest/record.py's _lap_number / TOTAL_LAPS), so
  // this is exact, not a derived estimate like Gap/Int. See leaderLapOf for why it
  // reads the running order rather than matching pos===1.
  const leaderLap = state ? leaderLapOf(state.cars) : undefined;

  return (
    <div className="rail">
      <span className="rail-brand">F1 Race Tracker</span>
      {state && (
        <>
          {state.label && <span className="rail-session">{state.label}</span>}
          <span className="rail-clock">{fmtClock(state.timeMs)}</span>
          {/* != null, not truthiness: lap 0 (the leader is on the opening lap) is a
              real value on the wire, and hid the whole badge under `!!leaderLap`. */}
          {leaderLap != null && !!state.totalLaps && (
            <span className="rail-lap">LAP {leaderLap}/{state.totalLaps}</span>
          )}
          {state.weather && (
            <span className="rail-lap" title="Baked from session weather data">
              TRK {state.weather.trackTempC.toFixed(0)}° · AIR {state.weather.airTempC.toFixed(0)}°
              {state.weather.rainfall && <span style={{ color: 'var(--rain)' }}> · RAIN</span>}
            </span>
          )}
          <span role="status" aria-live="polite">
            <StatusBadge status={status ?? 'connecting'} state={state} staleSec={staleSec} />
          </span>
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
      {/* Deliberately outside <nav>: this is a way out of the app, not a fifth
          view. It is the only path from any route back to the project, which
          for a portfolio piece is the whole point of the artefact. */}
      <a
        className="rail-repo"
        href={REPO_URL}
        target="_blank"
        rel="noreferrer"
        title="Project source on GitHub"
      >
        GitHub<span aria-hidden="true"> ↗</span>
        <span className="visually-hidden"> (opens in a new tab)</span>
      </a>
    </div>
  );
}
