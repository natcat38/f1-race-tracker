// The top rail as an instrument cluster: identity, instruments, state, controls.

import type { ReactNode } from 'react';
import type { RaceState } from '../state/race';
import type { ConnStatus } from '../realtime/socket';
import { StatusBadge } from './StatusBadge';
import { fmtClock, leaderLapOf } from './timingHelpers';
import { REPO_URL } from '../staticDemo';

// Two primary tabs, plus two permanent affordances below. COMPARE was folded into
// OVERLAY (ADR-0009) — it showed two maps side by side and computed nothing, which
// is the thing OVERLAY does properly. LINK is an operator runbook — pip commands,
// browser extension setup, an ADR reference — and it was once a top-level tab, peer
// to the board. For the reader this app is built for, that click landed on shell
// commands. It keeps a permanent affordance (below, beside the
// repo link) rather than a primary slot: quieter, still one click, and honest
// about being a setting rather than a view.
const TABS = [
  { key: 'board', href: '#', label: 'BOARD', sub: 'live board' },
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
  ghost: 'Lap delta overlay',
  settings: 'F1TV link',
} as const;

// One instrument: a value over the 11px uppercase label that says what it is.
// A row of bare numbers is a readout; a row of labelled numbers is a cluster,
// and the labels are the only thing that turns one into the other.
function Metric({ label, title, children }: {
  label: string; title?: string; children: ReactNode;
}) {
  return (
    <div className="rail-metric" title={title}>
      <span className="rail-metric-value">{children}</span>
      <span className="rail-metric-label">{label}</span>
    </div>
  );
}

// StatusRail is the persistent instrument cluster on every route — the signature
// element. Four zones, each a `.rail-cluster` closed by a hairline: IDENTITY
// (brand/h1, session, route note), INSTRUMENTS (clock, lap, conditions), STATE
// (the connection chip plus the board's transient FROZEN / CLIP-LOOPED chips, in
// one reserved slot so a chip appearing never reflows the rail) and CONTROLS
// (segmented lane pick and transport verbs, then nav, then the exits).
//
// Zones wrap at the zone seam, never mid-instrument, and a zone with nothing in
// it renders null — the overlay and Settings have no session and no lane
// control, and an empty cluster there would show as a stray hairline.
export function StatusRail({
  active, state, status, staleSec, note, onReconnect, laneNamedElsewhere,
  controls, stateChips,
}: {
  active: 'board' | 'ghost' | 'settings';
  state?: RaceState;
  status?: ConnStatus;
  staleSec?: number;
  note?: string;
  onReconnect?: () => void;
  laneNamedElsewhere?: boolean;
  /** Zone D: the route's own controls — lane pick, transport verbs. */
  controls?: ReactNode;
  /** Zone C: transient state the route owns, e.g. the board's FROZEN/loop region. */
  stateChips?: ReactNode;
}) {
  // The race leader's current lap, out of the session's total — the recorder bakes
  // both from FastF1's lap data (ingest/record.py's _lap_number / TOTAL_LAPS), so
  // this is exact, not a derived estimate like Gap/Int. See leaderLapOf for why it
  // reads the running order rather than matching pos===1.
  const leaderLap = state ? leaderLapOf(state.cars) : undefined;
  // != null, not truthiness: lap 0 (the leader is on the opening lap) is a real
  // value on the wire, and hid the whole badge under `!!leaderLap`.
  const showLap = !!state && leaderLap != null && !!state.totalLaps;
  const weather = state?.weather;
  const hasInstruments = !!state;
  const hasState = !!state || !!stateChips;

  return (
    // <header>, not a bare div: the rail is the page masthead and carries the h1.
    // The two wrappers below are `display: contents` on desktop — they exist only
    // so the phone breakpoint can lift the strip clusters into one sticky bar
    // without duplicating a single node (a second <nav> would give two
    // aria-current targets and two tab stops for the same link).
    <header className="rail">
      <div className="rail-block">
        <div className="rail-cluster rail-identity">
          {/* The route's <h1>. Route no longer renders one — two would break the
              chain this comment block exists to keep straight. */}
          <h1 className="rail-brand">
            F1 Race Tracker
            <span className="rail-brand-sep" aria-hidden="true">·</span>
            <span className="rail-route">{ROUTE_TITLES[active]}</span>
          </h1>
          {state?.label && <span className="rail-session">{state.label}</span>}
          {note && <span className="rail-note">{note}</span>}
        </div>

        {/* Conditions live in the block rather than beside the clock so the phone
            breakpoint can leave them behind: the sticky 48px strip carries only
            what is watched continuously (clock, lap, an exception, the tabs),
            and track temperature is read once. On desktop `order` puts this
            cell back where it belongs — the last instrument in the cluster. */}
        {weather && (
          <div className="rail-cluster rail-conditions">
            <Metric label="Track / Air" title="Baked from session weather data">
              <span className="rail-lap">
                {weather.trackTempC.toFixed(0)}° / {weather.airTempC.toFixed(0)}°
                {weather.rainfall && <span style={{ color: 'var(--rain)' }}> · RAIN</span>}
              </span>
            </Metric>
          </div>
        )}

        {controls && <div className="rail-cluster rail-controls">{controls}</div>}

        <div className="rail-cluster rail-exits">
          <a
            className={active === 'settings' ? 'rail-repo rail-repo-active' : 'rail-repo'}
            href="#settings"
            aria-current={active === 'settings' ? 'page' : undefined}
          >
            <span className="rail-repo-glyph" aria-hidden="true">⚙</span>
            <span className="rail-repo-text">F1TV<span className="rail-repo-long"> Link</span></span>
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
            <span className="rail-repo-glyph" aria-hidden="true">↗</span>
            <span className="rail-repo-text">GitHub<span aria-hidden="true"> ↗</span></span>
            <span className="visually-hidden"> (opens in a new tab)</span>
          </a>
        </div>
      </div>

      <div className="rail-strip">
        {hasInstruments && (
          <div className="rail-cluster rail-instruments">
            <Metric label="Session">
              <span className="rail-clock">{fmtClock(state.timeMs)}</span>
            </Metric>
            {showLap && (
              <Metric label="Lap">
                <span className="rail-lap">{leaderLap}/{state.totalLaps}</span>
              </Metric>
            )}
          </div>
        )}

        {/* The reserved state slot. Deliberately NOT a live region itself: the
            chip carries its own polite region (StatusBadge) and the board hands
            in another for FROZEN/CLIP-LOOPED, and nesting two would
            double-announce. min-width, not a fixed width, so an arriving chip
            does not reflow the rail but a long one is never clipped. */}
        {hasState && (
          <div className="rail-cluster rail-state">
            {state && (
              <StatusBadge
                status={status ?? 'connecting'}
                state={state}
                staleSec={staleSec}
                onReconnect={onReconnect}
                laneNamedElsewhere={laneNamedElsewhere}
              />
            )}
            {stateChips}
          </div>
        )}

        <span className="rail-cluster rail-spacer" aria-hidden="true" />

        <nav className="rail-cluster rail-tabs" aria-label="Views">
          {TABS.map((t) => (
            <a
              key={t.key}
              href={t.href}
              className={active === t.key ? 'rail-tab rail-tab-active' : 'rail-tab'}
              aria-current={active === t.key ? 'page' : undefined}
            >
              <span>{t.label}</span>
              <span className="rail-tab-sub">{t.sub}</span>
            </a>
          ))}
        </nav>
      </div>
    </header>
  );
}
