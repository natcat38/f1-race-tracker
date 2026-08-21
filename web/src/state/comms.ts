// Comms sub-state: steps a cursor through the radio timeline and decides which clips
// fire, replay or go stale.

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

// liveArrivals returns the refs a frame just appended to the timeline (ADR-0008).
// Live clips cannot be fired by the clock: a clip's timeMs is the instant it was
// spoken, which always lags the live lane's wall-clock timeMs, so stepComms' window
// would never match. Arrival IS the trigger. A snapshot fires nothing — its refs are
// history, seeded by stepComms — and a shrunk timeline (a source switch racing a
// frame) is treated as no arrivals rather than slicing backwards.
export function liveArrivals(
  timeline: RadioMessage[],
  prevLen: number,
  isSnapshot: boolean,
): RadioMessage[] {
  if (isSnapshot || timeline.length <= prevLen) return [];
  return timeline.slice(prevLen);
}

// isStale reports whether a queued clip has fallen too far behind the race clock to
// auto-play (it is still shown in history). Best-effort sync, ~3s tolerance.
export function isStale(msg: RadioMessage, currentClock: number, toleranceMs = 3000): boolean {
  return currentClock - msg.timeMs > toleranceMs;
}

// isAllowedClip guards an external clip URL before it becomes an <audio> src: https only,
// host formula1.com or a subdomain. Clips come from an untrusted external feed, so this
// rejects a spoofed/hostile origin (S5). Malformed URLs are rejected.
export function isAllowedClip(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'https:'
      && (u.hostname === 'formula1.com' || u.hostname.endsWith('.formula1.com'));
  } catch {
    return false;
  }
}
