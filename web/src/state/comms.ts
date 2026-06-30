import type { RadioMessage } from './race';

export interface CommsCursor { lastClock: number }

export interface CommsStep {
  cursor: CommsCursor;
  fired: RadioMessage[];   // messages to enqueue for auto-play this step
  history: RadioMessage[]; // messages to add to history (silent) — only on snapshot init
}

// stepComms advances the cursor by one frame/snapshot and decides what to play.
// One rule drives steady-state, connect, and loop:
//   - isSnapshot: init lastClock = clock; messages at/before clock go to history, none fire.
//   - clock < lastClock (loop): reset lastClock = clock, fire nothing.
//   - otherwise (steady): fire messages with lastClock < timeMs <= clock, in time order.
export function stepComms(
  cursor: CommsCursor,
  clock: number,
  timeline: RadioMessage[],
  isSnapshot: boolean,
): CommsStep {
  if (isSnapshot) {
    const history = timeline.filter((m) => m.timeMs <= clock).sort((a, b) => a.timeMs - b.timeMs);
    return { cursor: { lastClock: clock }, fired: [], history };
  }
  if (clock < cursor.lastClock) {
    return { cursor: { lastClock: clock }, fired: [], history: [] };
  }
  const fired = timeline
    .filter((m) => m.timeMs > cursor.lastClock && m.timeMs <= clock)
    .sort((a, b) => a.timeMs - b.timeMs);
  return { cursor: { lastClock: clock }, fired, history: [] };
}

// isStale reports whether a queued clip has fallen too far behind the race clock to
// auto-play (it is still shown in history). Best-effort sync, ~3s tolerance.
export function isStale(msg: RadioMessage, currentClock: number, toleranceMs = 3000): boolean {
  return currentClock - msg.timeMs > toleranceMs;
}
