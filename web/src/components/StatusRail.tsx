// The top rail as an instrument cluster: identity, instruments, state, controls.

import type { ReactNode } from 'react';
import type { RaceState } from '../state/race';
import { PHONE_QUERY, useMediaQuery } from '../hooks/useMediaQuery';
import { useReducedMotion } from '../hooks/useReducedMotion';
import type { ConnStatus } from '../realtime/socket';
import { StatusBadge, RestingLaneLine } from './StatusBadge';
import { fmtClock, leaderLapOf } from './timingHelpers';
import { REPO_URL, STATIC_DEMO } from '../staticDemo';

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
  settings: STATIC_DEMO ? 'How this runs' : 'F1TV link',
} as const;

// The #settings link. On the full build it is the F1TV account link, and keeps the
// gear it has always had. On the static demo that page cannot work (no gateway, no
// ingest), so the same slot opens "How this runs" and carries an info mark and its
// own words: a bare gear that opened a "not available" page was a dead end, and a
// bare glyph under a 1360px rail told nobody what it was (F1-UX-6, F1-UX-7).
const SETTINGS_LINK = STATIC_DEMO
  ? { name: 'How this runs', text: 'How this runs' }
  : { name: 'F1TV link', text: 'F1TV Link' };

// Drawn, like the transport icons: a circled "i", 16px, currentColor.
function InfoIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <circle cx="8" cy="8" r="6.25" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <rect x="7.25" y="7" width="1.5" height="4.5" rx="0.5" fill="currentColor" />
      <circle cx="8" cy="5" r="0.95" fill="currentColor" />
    </svg>
  );
}

/**
 * The transport verb the phone's sticky strip carries: Pause/Play for the static
 * replay, Freeze/Resume for the live lane. `progress` (0 to 1) draws the thin
 * position line under the strip and is omitted where there is no position.
 */
export interface StripTransport {
  playing: boolean;
  onToggle: () => void;
  pauseLabel: string;
  playLabel: string;
  progress?: number;
}

/** One jump target in the phone's section row: the panel's DOM id and its chip text. */
export interface SectionLink {
  id: string;
  label: string;
}

// Drawn, not a glyph: the strip button is icon-only, and the pause and play
// characters render from whatever emoji font the phone has. 20px box, currentColor.
function TransportIcon({ playing }: { playing: boolean }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      {playing ? (
        <>
          <rect x="4.5" y="3.5" width="3.5" height="13" rx="0.75" fill="currentColor" />
          <rect x="12" y="3.5" width="3.5" height="13" rx="0.75" fill="currentColor" />
        </>
      ) : (
        <path d="M6 3.8v12.4a.6.6 0 0 0 .92.5l9.6-6.2a.6.6 0 0 0 0-1L6.92 3.3A.6.6 0 0 0 6 3.8Z" fill="currentColor" />
      )}
    </svg>
  );
}

// Jump to a panel, open it if it is a collapsed <details>, and put keyboard focus
// on its heading so the next Tab continues from there rather than from the chip.
// Not an <a href="#id">: this app routes on the hash, and '#track' would be read
// as an unknown route and remount the board.
function jumpTo(id: string, reduced: boolean) {
  const el = document.getElementById(id);
  if (!el) return;
  if (el instanceof HTMLDetailsElement) el.open = true;
  el.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
  el.querySelector<HTMLElement>('h2')?.focus({ preventScroll: true });
}

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
  controls, stateChips, transport, sections,
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
  /** Phone only: the transport verb the sticky strip carries, so it never scrolls away. */
  transport?: StripTransport;
  /** Phone only: the section chips under the strip. The board passes them; other routes do not. */
  sections?: SectionLink[];
}) {
  const phone = useMediaQuery(PHONE_QUERY);
  const reducedMotion = useReducedMotion();
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
    // aria-current targets and two tab stops for the same link). The strip comes
    // first in the DOM because it is first on screen on a phone: it used to be
    // last in the DOM and pulled to the top with `order: -1`, so Tab visited the
    // transport and the exit links before the tabs it sits beside (WCAG 1.3.2).
    <header className="rail">
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

        {/* Overlay and Settings carry no clock, lap or state chip, so on a phone the
            sticky strip was a 48px box with nothing in it but two tabs. The route
            name fills it. aria-hidden: the <h1> above already says this, and a
            second announcement of the same words is noise. Hidden on desktop,
            where the h1 is in view. */}
        {!hasInstruments && (
          <span className="rail-strip-title" aria-hidden="true">{ROUTE_TITLES[active]}</span>
        )}

        <span className="rail-cluster rail-spacer" aria-hidden="true" />

        {/* Phone only, and rendered rather than hidden: a node that CSS hides is
            still a second "Replay position"/"Pause" for tests and tooling, and the
            strip is the only place on a phone that cannot scroll away. The verb
            names the action it will take, as the desktop button does. */}
        {phone && transport && (
          <button
            type="button"
            className="rail-strip-transport"
            onClick={transport.onToggle}
            aria-label={transport.playing ? transport.pauseLabel : transport.playLabel}
          >
            <TransportIcon playing={transport.playing} />
          </button>
        )}

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

        {phone && transport?.progress != null && (
          <span className="rail-progress" aria-hidden="true">
            <span
              className="rail-progress-fill"
              style={{ transform: `scaleX(${Math.min(1, Math.max(0, transport.progress))})` }}
            />
          </span>
        )}

        {phone && sections && sections.length > 0 && (
          <nav className="rail-sections" aria-label="Jump to section">
            {sections.map((sec) => (
              <button
                key={sec.id}
                type="button"
                className="rail-section-chip"
                onClick={() => jumpTo(sec.id, reducedMotion)}
              >
                {sec.label}
              </button>
            ))}
          </nav>
        )}
      </div>

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
          {/* The phone's block has no room for a cluster of its own, so conditions
              ride the session line there; on wider screens the .rail-conditions
              cluster below carries them. One or the other is rendered, never both. */}
          {phone && weather && (
            <span className="rail-wx">
              {weather.trackTempC.toFixed(0)}° / {weather.airTempC.toFixed(0)}°
              {weather.rainfall && <span style={{ color: 'var(--rain)' }}> · RAIN</span>}
            </span>
          )}
          {note && <span className="rail-note">{note}</span>}
          {state && (
            <RestingLaneLine
              status={status ?? 'connecting'}
              state={state}
              staleSec={staleSec}
              laneNamedElsewhere={laneNamedElsewhere}
            />
          )}
        </div>

        {/* Conditions live in the block rather than beside the clock so the phone
            breakpoint can leave them behind: the sticky 48px strip carries only
            what is watched continuously (clock, lap, an exception, the tabs),
            and track temperature is read once. On desktop `order` puts this
            cell back where it belongs — the last instrument in the cluster. */}
        {!phone && weather && (
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
            className={active === 'settings' ? 'rail-repo rail-repo-settings rail-repo-active' : 'rail-repo rail-repo-settings'}
            href="#settings"
            title={SETTINGS_LINK.name}
            aria-current={active === 'settings' ? 'page' : undefined}
          >
            <span className="rail-repo-glyph" aria-hidden="true">
              {STATIC_DEMO ? <InfoIcon /> : '⚙'}
            </span>
            <span className="rail-repo-text">{SETTINGS_LINK.text}</span>
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
    </header>
  );
}
