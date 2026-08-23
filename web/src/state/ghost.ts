// Overlay maths: the signed delta between two reference laps, the clock-to-index
// inversion the animation needs, and the per-side driver options.

import type { ConnStatus } from '../realtime/socket';
import type { Car } from './race';

// Pure helpers for the lap-delta overlay. A side is a (session, driver) pair, and
// both sides may name the SAME session — every snapshot carries a lap trace for
// every driver with an accurate lap (ADR-0004), so a two-driver comparison is the
// same subtraction against one socket. Nothing below knows or cares which case it
// is looking at.

// deltaSeries: side A minus side B at each outline index, in ms. Positive = A is
// slower at that point on the lap. Clamped to the shorter trace.
export function deltaSeries(a: number[], b: number[]): number[] {
  const n = Math.min(a.length, b.length);
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(a[i] - b[i]);
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

// driversWithTrace: the driver numbers this lane can actually be asked for,
// ascending. Only drivers with a baked reference lap appear — a driver who never
// set an accurate lap has no trace, and offering them would produce an empty
// overlay with no explanation.
export function driversWithTrace(lapTrace: Record<number, number[]>): number[] {
  return Object.keys(lapTrace)
    .map(Number)
    .filter((n) => Number.isFinite(n) && (lapTrace[n]?.length ?? 0) > 0)
    .sort((x, y) => x - y);
}

// driverCode: the label a picker shows for a driver number — the FIA abbreviation
// when the lane has published one, the car number otherwise (same fallback the
// board's `?car=` grammar uses).
export function driverCode(cars: Record<number, Car>, num: number): string {
  return cars[num]?.code || String(num);
}

// findByCode: resolve a code from a URL back to this lane's driver number. Codes are
// compared case-insensitively and the car-number fallback is honoured, so both
// `?a=monza-2024:VER` and `?a=monza-2024:1` name Verstappen.
export function findByCode(
  cars: Record<number, Car>,
  drivers: number[],
  code: string,
): number | null {
  const want = code.toUpperCase();
  return drivers.find((n) => driverCode(cars, n).toUpperCase() === want) ?? null;
}

// The overlay's skeleton copy. Priority: the one thing the user can fix themselves
// (both sides naming the same driver in the same session, which is a zero delta and
// not a comparison) beats a confirmed data gap, which beats a connection complaint,
// which beats the generic loading line — so a user always sees the most specific
// truth, and one they can act on before one they cannot.
export function overlaySkeletonCopy(
  samePair: boolean,
  lanesLoaded: boolean,
  driverCount: number,
  statusA: ConnStatus,
  statusB: ConnStatus,
): string {
  if (samePair) {
    return 'Both sides are the same lap — pick two different drivers, or a different session.';
  }
  if (lanesLoaded && driverCount === 0) {
    return 'No driver in this session has a reference lap yet.';
  }
  if (statusA === 'reconnecting' || statusB === 'reconnecting') {
    return 'Connection lost — retrying automatically…';
  }
  return 'Loading reference laps…';
}
