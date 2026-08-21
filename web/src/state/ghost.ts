// Ghost-overlay maths: signed cross-year delta series and the clock-to-index inversion
// the animation needs.

import type { ConnStatus } from '../realtime/socket';

// Pure helpers for the cross-year ghost overlay. The route holds both years'
// lap traces (cumulative ms per track-outline index, baked per clip); these turn
// them into a signed delta and invert a trace (clock -> index) for animation.

// deltaSeries: this-year minus last-year at each index, in ms. Positive = this
// year is slower at that point on the lap. Clamped to the shorter trace.
export function deltaSeries(thisYear: number[], lastYear: number[]): number[] {
  const n = Math.min(thisYear.length, lastYear.length);
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(thisYear[i] - lastYear[i]);
  return out;
}

// indexAtTime: the largest outline index whose cumulative time is <= tMs, for a
// monotonic non-decreasing trace. Clamped to [0, len-1]. Used to place a car.
export function indexAtTime(trace: number[], tMs: number): number {
  if (trace.length === 0) return 0;
  let idx = 0;
  for (let i = 0; i < trace.length; i++) {
    if (trace[i] <= tMs) idx = i;
    else break;
  }
  return idx;
}

// commonDrivers: numeric driver keys present in both trace maps, ascending.
export function commonDrivers(
  a: Record<number, number[]>,
  b: Record<number, number[]>,
): number[] {
  return Object.keys(a)
    .map(Number)
    .filter((n) => b[n] !== undefined)
    .sort((x, y) => x - y);
}

// The Ghost route's skeleton copy. Priority: a confirmed data gap (both lanes
// loaded, zero common drivers) beats a connection complaint, which beats the
// generic loading line — so a user always sees the most specific truth.
export function ghostSkeletonCopy(
  lanesLoaded: boolean,
  driverCount: number,
  statusThis: ConnStatus,
  statusLast: ConnStatus,
): string {
  if (lanesLoaded && driverCount === 0) {
    return 'No driver appears in both seasons — ghost overlay needs a common driver.';
  }
  if (statusThis === 'reconnecting' || statusLast === 'reconnecting') {
    return 'Connection lost — retrying automatically…';
  }
  return 'Loading reference laps…';
}
