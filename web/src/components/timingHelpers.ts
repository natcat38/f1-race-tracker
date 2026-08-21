import type { RaceState, Car } from '../state/race';

// fmtLap renders a lap/sector time (ms) as m:ss.SSS, or em-dash when absent.
export function fmtLap(ms: number | undefined): string {
  if (!ms || ms <= 0) return '—';
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const millis = ms % 1000;
  return `${m}:${String(s).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
}

// fmtElapsed renders any non-negative elapsed duration as m:ss.SSS. Unlike fmtLap,
// 0 is a real moment in time here (e.g. Ghost's playback clock at loop start),
// not "no value yet" — so there's no absent-value guard.
export function fmtElapsed(ms: number): string {
  // Ghost's tMs is a raw performance.now() delta, so it's a float — floor it
  // first or `ms % 1000` leaves a fractional millis that prints as garbage digits.
  const whole = Math.floor(ms);
  const m = Math.floor(whole / 60000);
  const s = Math.floor((whole % 60000) / 1000);
  const millis = whole % 1000;
  return `${m}:${String(s).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
}

// fmtSec renders a sector time (ms) as ss.SSS (no minutes — sectors are < 60s).
export function fmtSec(ms: number | undefined): string {
  if (!ms || ms <= 0) return '—';
  return (ms / 1000).toFixed(3);
}

// fmtGap renders a time gap/interval (ms) as +s.SSS, or em-dash when absent.
export function fmtGap(ms: number | undefined): string {
  if (!ms || ms <= 0) return '—';
  return `+${(ms / 1000).toFixed(3)}`;
}

// fmtClock renders the session clock (ms) as H:MM:SS above an hour, else M:SS.
export function fmtClock(ms: number): string {
  const t = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
}

const laps = (n: number) => `+${n} LAP${n > 1 ? 'S' : ''}`;

// gapLabel renders the pit-wall gap to leader: LEADER for P1; "+N LAP(S)" when
// lapped (unless secondsMode forces raw time); else the time gap. Suppressed
// (em-dash) before the car has completed its first lap — the gap is meaningless
// (and can be wildly wrong) until then.
export function gapLabel(
  gapMs: number | undefined, gapLaps: number | undefined, isLeader: boolean, secondsMode: boolean,
  lastLapMs: number | undefined,
): string {
  if (isLeader) return 'LEADER';
  if (!lastLapMs) return '—';
  if (!secondsMode && gapLaps && gapLaps >= 1) return laps(gapLaps);
  return fmtGap(gapMs);
}

// intLabel renders the pit-wall interval to the car ahead. The lap deficit is
// derived from the gapLaps difference (this car minus the car ahead). Suppressed
// (em-dash) until both this car and the car ahead have completed a lap.
export function intLabel(
  gapLaps: number | undefined, aheadGapLaps: number | undefined,
  intMs: number | undefined, isLeader: boolean, secondsMode: boolean,
  lastLapMs: number | undefined, aheadLastLapMs: number | undefined,
): string {
  if (isLeader) return '—';
  if (!lastLapMs || !aheadLastLapMs) return '—';
  const def = (gapLaps ?? 0) - (aheadGapLaps ?? 0);
  if (!secondsMode && def >= 1) return laps(def);
  return fmtGap(intMs);
}

// The compound swatches. The values, the contrast ratios and the reasoning now
// live beside the rest of the palette in styles/tokens.css — this is the lookup
// that turns a compound name from the wire into the token that draws it, and
// nothing more. Re-typing the hexes here was how INTERMEDIATE ended up as a
// lowercase copy of --good and WET as an exact copy of Red Bull's team colour.
//
// These are also STATUS-neutral: a compound colour describes rubber, not a race
// state. The yellow-flag label and the in-pit indicator used to borrow
// TYRE_COLOUR.MEDIUM; they use --amber and --pit now, so retuning the medium
// swatch for legibility no longer restyles race control and the timing tower.
export const TYRE_COLOUR: Record<string, string> = {
  SOFT: 'var(--tyre-soft)',
  MEDIUM: 'var(--tyre-medium)',
  HARD: 'var(--tyre-hard)',
  INTERMEDIATE: 'var(--tyre-inter)',
  WET: 'var(--tyre-wet)',
};

// tyreLabel is the single compact tyre readout shared by TimingTower and
// Standings (previously formatted inconsistently between the two: "S 5" vs "S5").
export function tyreLabel(tyre?: string, age?: number): string {
  if (!tyre) return '—';
  return `${tyre[0]}${age ? age : ''}`;
}

// statusLabel renders the Gap-cell override for a car that's not on a flying
// lap: "IN PIT" while in the pit lane, "OUT" once retired. undefined for a
// car that's on track, so the caller falls back to the normal gap/int display.
export function statusLabel(status: string): string | undefined {
  if (status === 'Pit') return 'IN PIT';
  if (status === 'Out') return 'OUT';
  return undefined;
}

// byRunningOrder is the running-order comparator: position, then laps completed,
// then driver number. The feed is not guaranteed to hand out unique positions —
// the Monza 2024 clip reports two cars at pos 19 (and no 20) in every frame — so
// laps completed keeps the order right, and driver number makes the result stable
// rather than dependent on object key order. ingest/resample.py's
// reconcile_positions sorts server-side by the same three keys, so a frame that
// still needed a tie-break agrees with how the frontend would have broken it.
const byRunningOrder = (a: Car, b: Car) =>
  a.pos - b.pos || (b.lap ?? 0) - (a.lap ?? 0) || a.driverNum - b.driverNum;

// orderCars returns the cars sorted by running position.
export function orderCars(cars: RaceState['cars']): Car[] {
  return Object.values(cars).sort(byRunningOrder);
}

// leaderLapOf is the race leader's current lap: the front of the running order
// without the sort, so a caller that wants only this one number (StatusRail's LAP
// badge, StintChart's marker) is O(n) rather than O(n log n) per 10 Hz frame.
// Read off the running order rather than matching pos===1 directly: the wire now
// reconciles pos into a unique, contiguous 1..N per frame (#66), but the tie-break
// stays as belt-and-braces, so callers degrade honestly instead of showing nothing
// if a stale/malformed frame ever lacked a literal pos:1.
// undefined means "no cars, or the leader has no lap yet" — 0 is a real lap number
// (internal/model/model.go), so callers must guard with != null, not truthiness.
export function leaderLapOf(cars: RaceState['cars']): number | undefined {
  let leader: Car | undefined;
  for (const c of Object.values(cars)) {
    if (leader === undefined || byRunningOrder(c, leader) < 0) leader = c;
  }
  return leader?.lap;
}

// sameRunningOrder: do these two car maps produce the same rendered running order?
// Compares the two fields the order (and the leader-lap marker) depend on, per car,
// without sorting either side — cheap enough to run in a React.memo comparator that
// exists to avoid the sort.
export function sameRunningOrder(a: RaceState['cars'], b: RaceState['cars']): boolean {
  if (a === b) return true;
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((k) => {
    const ca = a[k as unknown as number], cb = b[k as unknown as number];
    return cb !== undefined && ca.pos === cb.pos && ca.lap === cb.lap;
  });
}

// bestSectors finds the session-best (min across all cars) for each sector this frame.
export function bestSectors(cars: Car[]): [number, number, number] {
  const min = (sel: (c: Car) => number | undefined) =>
    cars.reduce((acc, c) => {
      const v = sel(c);
      return v && v > 0 && v < acc ? v : acc;
    }, Infinity);
  return [min((c) => c.s1Ms), min((c) => c.s2Ms), min((c) => c.s3Ms)];
}

// Bests maps driverNum -> their best-seen [s1, s2, s3] (ms) across all frames.
export type Bests = Record<number, [number, number, number]>;

const faster = (prev: number, v: number | undefined) => (v && v > 0 && v < prev ? v : prev);

// updatePersonalBests folds this frame's sectors into the running per-driver mins.
// Pure: returns a new map; Infinity means "no value yet".
export function updatePersonalBests(prev: Bests, cars: Car[]): Bests {
  const next: Bests = { ...prev };
  for (const c of cars) {
    const cur = next[c.driverNum] ?? [Infinity, Infinity, Infinity];
    next[c.driverNum] = [faster(cur[0], c.s1Ms), faster(cur[1], c.s2Ms), faster(cur[2], c.s3Ms)];
  }
  return next;
}

// Tokens, not hexes, so a palette change reaches the sector cells too.
const PURPLE = 'var(--best-session)'; // session-best
const GREEN = 'var(--good)';          // personal-best

// sectorColour returns the cell colour for a sector value: purple if it ties the
// session-best, else green if it ties this driver's personal-best, else none.
export function sectorColour(
  v: number | undefined, sessionBest: number, personalBest: number,
): string | undefined {
  if (!v || v <= 0) return undefined;
  if (v === sessionBest) return PURPLE;
  if (v === personalBest) return GREEN;
  return undefined;
}

// sectorMark is the same information as sectorColour, as a glyph: colour alone
// would leave a purple/green best sector indistinguishable to a colour-blind
// reader. 'S' = session best, 'P' = personal best.
export function sectorMark(
  v: number | undefined, sessionBest: number, personalBest: number,
): 'S' | 'P' | undefined {
  if (!v || v <= 0) return undefined;
  if (v === sessionBest) return 'S';
  if (v === personalBest) return 'P';
  return undefined;
}

// sectorDelta: ms above this driver's personal-best sector, or undefined when
// the value IS the personal best (nothing to show) or is absent/unknown.
export function sectorDelta(v: number | undefined, personalBest: number): number | undefined {
  if (!v || v <= 0 || personalBest === Infinity || v <= personalBest) return undefined;
  return v - personalBest;
}

// sectorDeltaVs: signed ms this car's sector is slower (+) or faster (-) than
// a reference car's same sector — the "how much am I losing to them, right
// now" question a race engineer actually asks, as opposed to sectorDelta's
// against-your-own-best framing.
export function sectorDeltaVs(v: number | undefined, ref: number | undefined): number | undefined {
  if (!v || v <= 0 || !ref || ref <= 0) return undefined;
  return v - ref;
}

// fmtSigned renders a signed ms delta as "+0.312" / "-0.145".
export function fmtSigned(ms: number): string {
  const sign = ms < 0 ? '-' : '+';
  return `${sign}${(Math.abs(ms) / 1000).toFixed(3)}`;
}

// GapHistory maps driverNum -> {lap: last lap counted, gaps: recent gapMs
// readings, oldest-first} — the "closing/opening" trend a race engineer
// watches lap over lap, as opposed to the instantaneous Gap column. A gap
// reading is `undefined` (not 0) for a lap where gapMs was legitimately
// absent (no completed reference lap yet) — 0 means "tied with the leader",
// a real and different value.
export type GapHistory = Record<number, { lap: number; gaps: (number | undefined)[] }>;
const MAX_GAP_HISTORY = 8;

// updateGapHistory appends a driver's gapMs once per completed lap (detected
// via c.lap incrementing), mirroring updateLapHistory's reference-equality
// bail-out when nothing actually changed this tick.
export function updateGapHistory(prev: GapHistory, cars: Car[]): GapHistory {
  let next: GapHistory | undefined;
  for (const c of cars) {
    if (c.lap == null) continue;
    const entry = prev[c.driverNum];
    if (entry && c.lap <= entry.lap) continue;
    next ??= { ...prev };
    const gaps = [...(entry?.gaps ?? []), c.gapMs].slice(-MAX_GAP_HISTORY);
    next[c.driverNum] = { lap: c.lap, gaps };
  }
  return next ?? prev;
}

// LapHistory maps driverNum -> recent completed lap times (ms), oldest-first.
export type LapHistory = Record<number, number[]>;
const MAX_LAP_HISTORY = 8;

// updateLapHistory appends a driver's lastLapMs when it changes from the last
// recorded value (a real lap completion, not the 10 Hz re-broadcast of the same
// value — see ADR-0002). Pure: returns a new map capped to MAX_LAP_HISTORY, or
// `prev` itself (same reference) when no driver's history actually changed —
// most of the 10 ticks/sec between lap completions — so callers can bail out
// via reference equality instead of re-rendering on a no-op update.
export function updateLapHistory(prev: LapHistory, cars: Car[]): LapHistory {
  let next: LapHistory | undefined;
  for (const c of cars) {
    if (!c.lastLapMs) continue;
    const hist = prev[c.driverNum] ?? [];
    if (hist[hist.length - 1] !== c.lastLapMs) {
      next ??= { ...prev };
      next[c.driverNum] = [...hist, c.lastLapMs].slice(-MAX_LAP_HISTORY);
    }
  }
  return next ?? prev;
}
