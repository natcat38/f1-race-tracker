// Shared formatting and ordering helpers for the timing views: lap/gap/sector
// rendering, running order, personal bests.

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

// GAP_RESOLUTION_MS is the honest resolution of the gap/interval estimator. The
// gateway derives both from track position rather than from timing loops, and the
// observed values come out quantised to ~0.566 s (one resampled step at the
// recorder's cadence) — every reading on a Monza frame is an integer multiple of
// it. Printing +3.399 for a quantity known to about half a second advertises
// precision that does not exist, so the estimates render to one decimal while the
// exact numbers on the same row (Last, Best, the sector times) keep all three.
export const GAP_RESOLUTION_MS = 566;

// fmtGapEstimate renders a DERIVED gap/interval at the resolution it actually
// has: +7.4, not +7.364. Use fmtGap for exact deltas.
export function fmtGapEstimate(ms: number | undefined): string {
  if (ms === undefined || ms < 0) return '—';
  // A zero interval is a real reading (two cars at the same estimated gap),
  // not a missing one — show it as +0.0, keep the dash for "unknown".
  return `+${(ms / 1000).toFixed(1)}`;
}

// fmtLongGap renders a large derived gap as +m:ss.s. "Gaps in seconds" turned a
// lapped car's deficit into +643.6, a number nobody converts to "about eleven
// minutes" in their head.
export function fmtLongGap(ms: number | undefined): string {
  if (!ms || ms <= 0) return '—';
  if (ms < 60000) return fmtGapEstimate(ms);
  const m = Math.floor(ms / 60000);
  const s = (ms % 60000) / 1000;
  return `+${m}:${s.toFixed(1).padStart(4, '0')}`;
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

// lapsDown reconciles the wire's gapLaps against the distance-derived gapMs.
// Clips baked before record.py's fix carry gapLaps as a lap-NUMBER difference,
// which reads 1 for every car between the leader crossing the line and its own
// crossing — so P2..P20 flashed "+1 LAP" for a few seconds every lap. A car is
// only a lap down if it is also at least ~a lap of time behind; refLapMs is the
// leader's last lap. Without a reference lap the wire value stands.
export function lapsDown(
  gapLaps: number | undefined, gapMs: number | undefined, refLapMs: number | undefined,
): number {
  const n = gapLaps ?? 0;
  if (n < 1) return 0;
  if (!refLapMs || gapMs === undefined) return n;
  return Math.min(n, Math.floor(gapMs / refLapMs + 0.1));
}

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
  return secondsMode ? fmtLongGap(gapMs) : fmtGapEstimate(gapMs);
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
  return secondsMode ? fmtLongGap(intMs) : fmtGapEstimate(intMs);
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

// hasNoData: a car the feed carries but has told us nothing about — no lap, no
// sector, no gap. It used to render as six em-dashes across the row, which reads
// as a rendering fault rather than as a known state. statusLabel's Pit/Out path
// already had the right treatment for "this car is not showing a normal lap"; a
// car with no data at all simply fell through it.
export function hasNoData(c: Car): boolean {
  return !c.lastLapMs && !c.bestLapMs && !c.s1Ms && !c.s2Ms && !c.s3Ms && c.gapMs == null;
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
  return leaderOf(cars)?.lap;
}

// leaderOf is the car at the front of the running order, found with one O(n)
// field walk rather than a sort. Split out of leaderLapOf because the board's
// first-paint auto-selection wants the driver, not the lap.
export function leaderOf(cars: RaceState['cars']): Car | undefined {
  let leader: Car | undefined;
  for (const c of Object.values(cars)) {
    if (leader === undefined || byRunningOrder(c, leader) < 0) leader = c;
  }
  return leader;
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

// SectorPb is one driver's running state for ONE sector: the best time seen, the
// last time seen, and how many distinct times they have actually set there.
// `last` exists only to make `samples` honest — see foldSector.
export type SectorPb = { best: number; last: number; samples: number };

// Bests maps driverNum -> their [s1, s2, s3] sector state across all frames.
export type Bests = Record<number, [SectorPb, SectorPb, SectorPb]>;

const NO_PB: SectorPb = { best: Infinity, last: 0, samples: 0 };
const NO_PBS: [SectorPb, SectorPb, SectorPb] = [NO_PB, NO_PB, NO_PB];

// A driver's FIRST time in a sector is trivially their own personal best, so in
// any short replay window almost every cell tied its own record and rendered
// green — measured on the running board at 54 of 60 sector cells, 90%. An accent
// applied to nine cells in ten is not an accent, it is the table's default
// colour, and it drowned the purple session-best that is supposed to be the
// rarest, loudest mark on the tower. Requiring a second time means green says
// "improved on a time you had already set here", which is what a pit wall reads
// it as, and gives the table a resting state to stand out from.
export const PB_MIN_SAMPLES = 2;

// foldSector folds one frame's sector value into a driver's running state.
// The wire re-broadcasts the same sector time at 10 Hz between completions
// (ADR-0002), so a *frame* is not a sample — a value that CHANGED is. Without
// that guard the threshold below would clear itself in 100 ms and mean nothing.
function foldSector(prev: SectorPb, v: number | undefined): SectorPb {
  if (!v || v <= 0 || v === prev.last) return prev;
  return { best: Math.min(prev.best, v), last: v, samples: prev.samples + 1 };
}

// updatePersonalBests folds this frame's sectors into the running per-driver
// state. Pure: returns a new map.
export function updatePersonalBests(prev: Bests, cars: Car[]): Bests {
  const next: Bests = { ...prev };
  for (const c of cars) {
    const cur = next[c.driverNum] ?? NO_PBS;
    next[c.driverNum] = [
      foldSector(cur[0], c.s1Ms), foldSector(cur[1], c.s2Ms), foldSector(cur[2], c.s3Ms),
    ];
  }
  return next;
}

// personalBestOf is the single gate every sector readout goes through: the
// stored best, or Infinity while this driver has fewer than PB_MIN_SAMPLES times
// in that sector. Infinity is already exactly what "no personal best yet" means
// to sectorColour, sectorMark and sectorDelta, so the threshold lands without
// changing any of those three — they stay pure functions of the numbers given.
export function personalBestOf(pb: Bests, driverNum: number, sector: number): number {
  const s = pb[driverNum]?.[sector];
  return s && s.samples >= PB_MIN_SAMPLES ? s.best : Infinity;
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

// --- Gap display: smoothing and running-order consistency -------------------
//
// Two separate problems, both in the display rather than in the estimate:
//
// 1. JITTER. The estimator re-derives the gap from track position every frame,
//    so a value quantised to ~0.566 s hops between adjacent steps ten times a
//    second. The number is never wrong by more than its own resolution, but a
//    column that repaints every 100 ms cannot be read at all.
// 2. CONTRADICTION. Because each car's gap is estimated independently, P4's can
//    come out smaller than P3's — a fourth-placed car closer to the leader than
//    the third. The disclaimer covers imprecision; it does not cover impossible.
//    Anyone who follows the sport spots it in seconds.
//
// The fix for (1) is a median over a short window: it rejects a single hopped
// sample outright, where a mean would smear it across the whole window, and it
// only ever reports a value the estimator actually produced. The fix for (2) is
// to clamp each gap to be at least the gap of the car in front, and to derive the
// interval from the clamped gaps so the two columns cannot disagree with each
// other or with the running order.

// GapSamples holds the recent raw gap/interval readings for one driver, oldest
// first and capped at GAP_WINDOW, plus the value currently ON SCREEN for each.
// The shown value is part of the fold rather than a render-time derivation
// because it is deliberately sticky — see settle().
export type GapSamples = {
  gaps: number[]; ints: number[]; shownGap?: number; shownInt?: number;
};
export type GapSmoothing = Record<number, GapSamples>;

// Just under a second at the 10 Hz frame rate. Long enough that a couple of
// hopped readings cannot carry the median, short enough that a car genuinely
// closing shows up within about half a second.
export const GAP_WINDOW = 9;

// How far the settled median has to move before the printed number follows it.
// Deliberately larger than ONE resolution step (~566ms) and smaller than two:
// measured on the running board, a stationary gap hops a single step several
// times a second, and holding through that is the whole point — while a car that
// has genuinely moved a second is followed within a frame. The cost is lagging a
// real change by up to ~0.7s, which on a figure the column already disclaims as
// an estimate is the right way round.
export const GAP_HYSTERESIS_MS = 750;

// median of a numeric sample window. Returns undefined for an empty window.
export function median(xs: number[]): number | undefined {
  if (xs.length === 0) return undefined;
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// settle: the value to print, given the window and what is already printed. The
// median rejects an outlier outright (a mean would smear it across the window)
// and only ever reports a number the estimator actually produced; the threshold
// then keeps the printed value still until the median has really moved.
export function settle(xs: number[], shown: number | undefined): number | undefined {
  const m = median(xs);
  if (m == null) return shown;
  if (shown == null || Math.abs(m - shown) >= GAP_HYSTERESIS_MS) return m;
  return shown;
}

const pushCapped = (xs: number[], v: number | undefined) =>
  (v == null ? xs : [...xs, v].slice(-GAP_WINDOW));

// updateGapSmoothing folds this frame's raw gap/interval readings into the
// rolling windows and re-settles what each column shows. Pure; returns `prev`
// itself when nothing changed so a caller can bail out on reference equality.
export function updateGapSmoothing(prev: GapSmoothing, cars: Car[]): GapSmoothing {
  let next: GapSmoothing | undefined;
  for (const c of cars) {
    if (c.gapMs == null && c.intMs == null) continue;
    const cur = prev[c.driverNum] ?? { gaps: [], ints: [] };
    const gaps = pushCapped(cur.gaps, c.gapMs);
    const ints = pushCapped(cur.ints, c.intMs);
    const shownGap = settle(gaps, cur.shownGap);
    const shownInt = settle(ints, cur.shownInt);
    if (gaps === cur.gaps && ints === cur.ints
      && shownGap === cur.shownGap && shownInt === cur.shownInt) continue;
    next ??= { ...prev };
    next[c.driverNum] = { gaps, ints, shownGap, shownInt };
  }
  return next ?? prev;
}

// DisplayGap is what a row actually prints: the settled, order-consistent gap to
// the leader and interval to the car ahead, in ms. undefined means "no honest
// number for this row" and renders as an em-dash.
export type DisplayGap = { gapMs?: number; intMs?: number };

// displayGaps turns the running order plus the smoothing windows into one
// consistent set of numbers for the whole table:
//   - each car's gap is its settled reading;
//   - a gap is clamped up to the car in front's, so the column never contradicts
//     the running order it sits beside;
//   - the interval is the difference between neighbouring clamped gaps, which is
//     non-negative by construction, falling back to the settled raw interval only
//     when a neighbour has no gap at all.
// The leader is excluded on purpose: their row reads LEADER, not a number.
export function displayGaps(order: Car[], sm: GapSmoothing): DisplayGap[] {
  let prevGap: number | undefined;
  return order.map((c, i) => {
    if (i === 0) { prevGap = 0; return {}; }
    const s = sm[c.driverNum];
    const raw = s ? s.shownGap : c.gapMs;
    const rawInt = s ? s.shownInt : c.intMs;
    if (raw == null) { prevGap = undefined; return { intMs: rawInt }; }
    const gapMs = prevGap == null ? raw : Math.max(raw, prevGap);
    const intMs = prevGap == null ? rawInt : gapMs - prevGap;
    prevGap = gapMs;
    return { gapMs, intMs };
  });
}

// holdOrder re-sequences this frame's cars into a previously captured order, so
// the table can hold still while a user is pointing at it. Cars that were not in
// the captured sequence (a lane reconnect, a car appearing late) keep their live
// relative position and land at the end rather than being dropped — a held order
// must never hide a row.
export function holdOrder(live: Car[], held: number[]): Car[] {
  const rank = new Map(held.map((dn, i) => [dn, i]));
  return live
    .map((c, i) => ({ c, i, r: rank.get(c.driverNum) ?? Infinity }))
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map((x) => x.c);
}

// needsDriverTag: does this message still need its driver code appended? FastF1's
// text usually already names the car — "WAVED BLUE FLAG FOR CAR 31 (OCO)" — and
// appending unconditionally produced "(OCO)  (OCO)". Checks the code and the car
// number, since the feed uses either.
export function needsDriverTag(message: string, code: string, driverNum: number): boolean {
  // Split into words rather than substring-matching: "CAR 311" must not count as
  // naming car 31, and "(OCO)" must count as naming OCO.
  const words = message.toUpperCase().split(/[^A-Z0-9]+/);
  return !words.includes(code.toUpperCase()) && !words.includes(String(driverNum));
}

// axisTicks picks readable lap labels for a race of `total` laps: first, last,
// and a round step between them. Ten-lap steps for a normal grand prix, five for
// a sprint, so the strip never crowds.
export function axisTicks(total: number): number[] {
  if (total <= 1) return [1];
  const step = total > 30 ? 10 : total > 12 ? 5 : 2;
  const ticks: number[] = [1];
  for (let l = step; l < total - step / 2; l += step) ticks.push(l);
  ticks.push(total);
  return ticks;
}
