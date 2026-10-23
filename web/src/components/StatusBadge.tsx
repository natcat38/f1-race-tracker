// The connection/staleness badge: what the socket is doing and how old the data is.

import type { ConnStatus } from '../realtime/socket';
import { isWarmingUp, type RaceState } from '../state/race';

interface Props {
  status: ConnStatus;
  state: RaceState;
  staleSec?: number;
  // Handed down from the socket when it gives up (see MAX_RECONNECT_ATTEMPTS).
  // Absent everywhere else, which is why the terminal chip renders its button
  // conditionally rather than assuming one is always available.
  onReconnect?: () => void;
  // True on a route that already carries a Replay/Live control (the board's
  // SourceToggle sits ~40px to the left of this chip). The healthy chip and that
  // control said the same word with the same glyph, one a readout and one a
  // button, so a reader could not tell which one to press (ui-ux m8). Where the
  // control exists the chip stands down in the healthy case and keeps only the
  // exceptional states — warming, stale, reconnecting, offline, failed — which
  // is where a chip earns its slot. Routes with no toggle (the overlay's
  // lanes, the static demo's board, Settings) leave this false and keep the readout,
  // because there it is the only thing naming the lane.
  laneNamedElsewhere?: boolean;
}

const STALE_THRESHOLD_SEC = 4;

// The healthy chip's words, kept in one place because the phone shows them twice:
// the sticky strip has room for the glyph only, and StatusRail repeats the full
// line in the scroll-away block (RestingLaneLine below).
const RESTING = {
  live: { glyph: '●', text: 'LIVE LANE · RECORDED CLIP' },
  replay: { glyph: '▶', text: 'REPLAY · LOOPING CLIP' },
} as const;

// Which healthy chip a lane shows, or null when an exception chip (offline, failed,
// reconnecting, warming, stale) or nothing at all takes the slot. Mirrors the order
// Chip checks them in, and exists so the phone's block line can never say "REPLAY"
// while the strip chip is saying "Connection lost".
function restingKind(
  { status, state, staleSec, laneNamedElsewhere }: Props,
): keyof typeof RESTING | null {
  if (status === 'offline' || status === 'failed' || status === 'reconnecting') return null;
  if (isWarmingUp(state)) return null;
  if ((staleSec ?? 0) >= STALE_THRESHOLD_SEC) return null;
  if (laneNamedElsewhere) return null;
  return state.mode === 'live' ? 'live' : 'replay';
}

const LIVE_CAVEAT =
  'Demo lane streaming a second replay clip — real live ingestion not yet verified';

function Chip({ status, state, staleSec, onReconnect, laneNamedElsewhere }: Props) {
  // Terminal, and the only chip in the set that carries an action: the socket
  // has stopped dialling, so nothing will change on its own and the reader needs
  // to be told that as well as given the way out.
  if (status === 'offline') {
    return (
      <span className="chip chip-stall">
        ⚠ Connection lost — not retrying any more
        {onReconnect && (
          <button type="button" className="btn chip-action" onClick={onReconnect}>
            Reconnect
          </button>
        )}
      </span>
    );
  }
  if (status === 'failed') {
    return <span className="chip chip-stall">⚠ Demo data failed to load — refresh the page to retry.</span>;
  }
  if (status === 'reconnecting') {
    return <span className="chip chip-reconnect">↺ Reconnecting…</span>;
  }
  if (isWarmingUp(state)) {
    return <span className="chip chip-warm">⏳ Warming up the timing feed…</span>;
  }
  if ((staleSec ?? 0) >= STALE_THRESHOLD_SEC) {
    return (
      <span className="chip chip-stall">
        ⚠ Waiting for timing data
        {/* The seconds counter ticks every 1000ms, and a polite live region
            announces every change to its contents — so a stall used to produce
            "last frame 5 seconds ago… 6 seconds ago… 7 seconds ago…" forever,
            each announcement queued behind the last until the user could hear
            nothing else on the page. Exactly the wrong moment to lose the page.
            aria-hidden keeps the number on screen and out of the announcement,
            so the region speaks once when the stall starts and once when it
            clears. */}
        <span aria-hidden="true"> — last frame {staleSec}s ago</span>
      </span>
    );
  }
  // Everything below this line is the healthy case — see laneNamedElsewhere.
  if (laneNamedElsewhere) return null;
  if (state.mode === 'live') {
    return (
      // "LIVE (DEMO)" put the qualifier in a parenthesis and the truth in a
      // tooltip. The lane is a second recorded clip; the badge now says so on
      // screen, where a touch user can read it.
      <span className="chip chip-live chip-resting" title={LIVE_CAVEAT}>
        <span className="chip-glyph">{RESTING.live.glyph}</span>{' '}
        <span className="chip-text">{RESTING.live.text}</span>
        {/* The caveat used to live only in that title attribute — invisible to
            touch, and to any keyboard user who never hovers. It is now part of the
            chip's own text (aria-describedby would be unreliable on a role-less
            span), so it is announced once when the badge flips to live. Making it
            visible is a copy decision the UX review owns separately. */}
        <span className="visually-hidden"> — {LIVE_CAVEAT}</span>
      </span>
    );
  }
  // A fixed-length recording on repeat, said up front: the clip wraps every few
  // minutes, and a race clock that suddenly runs backwards reads as a bug unless
  // the reader was told to expect it. The transient wrap notice on the board
  // (App.tsx) is the other half of the same story.
  return (
    <span className="chip chip-replay chip-resting">
      <span className="chip-glyph">{RESTING.replay.glyph}</span>{' '}
      <span className="chip-text">{RESTING.replay.text}</span>
    </span>
  );
}

// The full words of the healthy chip, for the phone's scroll-away block, where it is
// visible text rather than an announcement: aria-hidden, because the polite region
// in the strip already says it and a second reading is noise. Null whenever the
// strip chip is an exception or absent. CSS shows it only where the strip has
// shrunk its own chip to the glyph.
export function RestingLaneLine(props: Props) {
  const kind = restingKind(props);
  if (!kind) return null;
  return (
    <span className="rail-lane" aria-hidden="true">
      {RESTING[kind].glyph} {RESTING[kind].text}
    </span>
  );
}

// The polite live region lives here rather than around the badge at each call
// site. StatusRail wrapped it and other callers did not, so on a route where two
// lanes can stall independently the transitions were silent — and the region has
// to be in the DOM before the text changes for the change to be announced at all,
// which an always-rendered wrapper guarantees.
export function StatusBadge(props: Props) {
  return (
    <span role="status" aria-live="polite">
      <Chip {...props} />
    </span>
  );
}
