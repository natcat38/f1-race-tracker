import type { ConnStatus } from '../realtime/socket';
import type { RaceState } from '../state/race';

interface Props {
  status: ConnStatus;
  state: RaceState;
  staleSec?: number;
}

const STALE_THRESHOLD_SEC = 4;

const LIVE_CAVEAT =
  'Demo lane streaming a second replay clip — real live ingestion not yet verified';

function Chip({ status, state, staleSec }: Props) {
  if (status === 'failed') {
    return <span className="chip chip-stall">⚠ Demo data failed to load — refresh the page to retry.</span>;
  }
  if (status === 'reconnecting') {
    return <span className="chip chip-reconnect">↺ Reconnecting…</span>;
  }
  if (state.rev === 0) {
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
  if (state.mode === 'live') {
    return (
      // "LIVE (DEMO)" put the qualifier in a parenthesis and the truth in a
      // tooltip. The lane is a second recorded clip; the badge now says so on
      // screen, where a touch user can read it.
      <span className="chip chip-live" title={LIVE_CAVEAT}>
        ● LIVE LANE · RECORDED CLIP
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
  return <span className="chip chip-replay">▶ REPLAY · LOOPING CLIP</span>;
}

// The polite live region lives here rather than around the badge at each call
// site. StatusRail wrapped it and Compare did not, so on the one route where two
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
