// The top rail: brand, route tabs, session clock and connection status.

import type { ReactNode } from 'react';
import type { RaceState } from '../state/race';
import type { ConnStatus } from '../realtime/socket';
import { StatusBadge } from './StatusBadge';
import { fmtClock, leaderLapOf } from './timingHelpers';
import { REPO_URL } from '../staticDemo';

// Three views, not four. LINK is an operator runbook — pip commands, browser
// extension setup, an ADR reference — and it was the fourth of four top-level
// tabs, peer to the board. For the reader this app is built for, the fourth click
// landed on shell commands. It keeps a permanent affordance (below, beside the
// repo link) rather than a primary slot: quieter, still one click, and honest
// about being a setting rather than a view.
const TABS = [
  { key: 'board', href: '#', label: 'BOARD', sub: 'live board' },
  { key: 'compare', href: '#compare', label: 'COMPARE', sub: 'two replays' },
  { key: 'ghost', href: '#ghost', label: 'OVERLAY', sub: 'lap delta' },
] as const;

// The visible page title, per route (accessibility L-2). The <h1> used to be
// visually hidden on every route because the rail already carried the brand — a
// correct heading chain that nobody could see, so a sighted reader landing on
// #ghost had no titled thing on the page above the panel headings. Rather than
// add a title band above a rail that is already the page's masthead, the brand
// IS the h1 and it names the route after itself: "F1 RACE TRACKER · LAP DELTA
// OVERLAY". One element, no new band, and the chain below it is unchanged.
const ROUTE_TITLES = {
  board: 'Race board',
  compare: 'Compare',
  ghost: 'Lap delta overlay',
  settings: 'F1TV link',
} as const;

// StatusRail is the persistent instrument strip on every route — the
// signature element. On the board it carries live session identity, the
// race clock, and lane health; on Compare/Ghost (two independent lanes,
// no single clock to show) it's a lighter shell: brand, a static note,
// and the same view tabs.
export function StatusRail({
  active, state, status, staleSec, note, onReconnect, laneNamedElsewhere, children,
}: {
  active: 'board' | 'compare' | 'ghost' | 'settings';
  state?: RaceState;
  status?: ConnStatus;
  staleSec?: number;
  note?: string;
  onReconnect?: () => void;
  laneNamedElsewhere?: boolean;
  children?: ReactNode;
}) {
  // The race leader's current lap, out of the session's total — the recorder bakes
  // both from FastF1's lap data (ingest/record.py's _lap_number / TOTAL_LAPS), so
  // this is exact, not a derived estimate like Gap/Int. See leaderLapOf for why it
  // reads the running order rather than matching pos===1.
  const leaderLap = state ? leaderLapOf(state.cars) : undefined;

  return (
    <div className="rail">
      {/* The route's <h1>. Route no longer renders one — two would break the
          chain this comment block exists to keep straight. */}
      <h1 className="rail-brand">
        F1 Race Tracker
        <span className="rail-brand-sep" aria-hidden="true">·</span>
        <span className="rail-route">{ROUTE_TITLES[active]}</span>
      </h1>
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
          {/* No live-region wrapper here any more: StatusBadge carries its own, so
              Compare's two lanes announce their transitions too and there is no
              chance of nesting two polite regions and double-announcing. */}
          <StatusBadge
            status={status ?? 'connecting'}
            state={state}
            staleSec={staleSec}
            onReconnect={onReconnect}
            laneNamedElsewhere={laneNamedElsewhere}
          />
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
      <a
        className={active === 'settings' ? 'rail-repo rail-repo-active' : 'rail-repo'}
        href="#settings"
        aria-current={active === 'settings' ? 'page' : undefined}
      >
        F1TV Link
      </a>
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
