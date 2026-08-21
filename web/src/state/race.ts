/**
 * The frontend's race state: wire message types, the applyMessage reducer, and the comms/ghost sub-state it composes.
 * @packageDocumentation
 */
export interface Point { x: number; y: number }
export interface Car {
  driverNum: number; code: string; team: string; pos: number; lap?: number;
  p: Point; status: string;
  // Phase 2 — all optional; absent renders blank.
  tyre?: string; tyreAge?: number;
  lastLapMs?: number; bestLapMs?: number;
  s1Ms?: number; s2Ms?: number; s3Ms?: number;
  gapMs?: number; gapLaps?: number; intMs?: number;
  speed?: number; gear?: number; throttle?: number; brake?: number; drs?: boolean;
}
export interface RadioMessage { timeMs: number; driverNum: number; clip: string }
export interface Stint { compound: string; startLap: number; endLap: number }
export interface Weather { airTempC: number; trackTempC: number; rainfall: boolean }
export interface RaceControlMessage {
  rev: number; t: number; category: string; message: string; driver?: number;
}
// Rolling cap on the message buffer, mirroring internal/model/apply.go's maxMessages.
const MAX_MESSAGES = 30;
// How far the clock has to jump backwards before it counts as a clip wrap rather
// than a frame arriving out of order. Frames are 100 ms apart; clips are minutes.
const LOOP_REWIND_MS = 5000;
// cars/lapTrace are Record<number, ...> but the wire (and JS object) keys are actually
// strings (see internal/model/model.go's Cars map[int]CarState, which marshals with
// string keys — JSON has no int keys). Object.keys(cars) is string[]; coerce with
// Number() before comparing, as ghost.ts's commonDrivers does.
export interface RaceState {
  session: string; mode: string; label: string;
  track: Point[]; cars: Record<number, Car>; timeMs: number; rev: number;
  radio: RadioMessage[];
  lapTrace: Record<number, number[]>;
  totalLaps: number;
  stints: Record<number, Stint[]>;
  weather?: Weather;
  messages: RaceControlMessage[];
  // Bumped on every snapshot (never on a frame) — lets a consumer (useComms) tell
  // a reconnect or source-switch snapshot apart from steady-state frames.
  snapshotSeq: number;
  // Bumped every time the replaying clip wraps back to its start (timeMs goes
  // backwards). The board's clock and lap counter genuinely run backwards at that
  // moment, which reads as a bug unless something says "this clip looped" — and
  // anything accumulated per play-through (race-control messages, personal-best
  // sector times) has to be dropped with it or it bleeds across passes.
  loopSeq: number;
}

export function emptyState(): RaceState {
  return {
    session: '', mode: '', label: '', track: [], cars: {}, timeMs: 0, rev: 0,
    radio: [], lapTrace: {}, totalLaps: 0, stints: {}, messages: [], snapshotSeq: 0,
    loopSeq: 0,
  };
}

// Wire payloads from the gateway, mirroring internal/model (Snapshot, Frame).
interface SnapshotData {
  session: string; mode: string; label: string;
  track?: Point[]; cars: Record<number, Car>; timeMs: number; rev: number;
  radio?: RadioMessage[];
  lapTrace?: Record<number, number[]>;
  totalLaps?: number;
  stints?: Record<number, Stint[]>;
  weather?: Weather;
  messages?: RaceControlMessage[];
}
interface FrameData {
  rev: number; timeMs: number; cars?: Car[]; messages?: RaceControlMessage[]; weather?: Weather;
  radio?: RadioMessage[]; // live lane only — accumulated onto state.radio (ADR-0008)
}
type Msg =
  | { type: 'snapshot'; data: SnapshotData }
  | { type: 'frame'; data: FrameData };

// parseMsg validates an unknown parsed-JSON value against the Msg shape before
// it's trusted as wire data, rejecting a malformed or evolved payload (missing
// fields, wrong type, unknown message type) instead of letting it flow into
// applyMessage as an unchecked cast.
// Radio refs are the one wire field the comms hook holds by identity (a WeakSet of
// live arrivals), and a WeakSet throws on a primitive — so an element check here is
// the difference between a rejected frame and a crashed board.
function isRadioRefs(v: unknown): boolean {
  return Array.isArray(v) && v.every((m) => {
    if (typeof m !== 'object' || m === null) return false;
    const r = m as Record<string, unknown>;
    return typeof r.timeMs === 'number' && typeof r.driverNum === 'number'
      && typeof r.clip === 'string';
  });
}

export function parseMsg(raw: unknown): Msg | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const d = r.data;
  if (typeof d !== 'object' || d === null) return null;
  const data = d as Record<string, unknown>;

  if (r.type === 'snapshot') {
    if (typeof data.session !== 'string' || typeof data.mode !== 'string' || typeof data.label !== 'string') return null;
    // Snapshot cars is a Record<number,Car> (object keyed by driverNum) — an array would be
    // spread into the wrong shape, so reject it explicitly.
    if (typeof data.cars !== 'object' || data.cars === null || Array.isArray(data.cars)) return null;
    if (typeof data.timeMs !== 'number' || typeof data.rev !== 'number') return null;
    // Optional array fields, when present, must be arrays: applyMessage assigns them straight
    // through and downstream code (RaceControl/Comms) iterates them, so a wrong-typed value
    // would crash the render rather than being rejected here.
    if (data.messages !== undefined && !Array.isArray(data.messages)) return null;
    if (data.radio !== undefined && !isRadioRefs(data.radio)) return null;
    if (data.track !== undefined && !Array.isArray(data.track)) return null;
    // stints/weather are objects, not arrays — reject an array (would spread wrong).
    if (data.stints !== undefined && (typeof data.stints !== 'object' || data.stints === null || Array.isArray(data.stints))) return null;
    if (data.weather !== undefined && (typeof data.weather !== 'object' || data.weather === null || Array.isArray(data.weather))) return null;
    return { type: 'snapshot', data: data as unknown as SnapshotData };
  }
  if (r.type === 'frame') {
    if (typeof data.rev !== 'number' || typeof data.timeMs !== 'number') return null;
    // applyMessage iterates cars and spreads messages — reject a present-but-non-array value.
    if (data.cars !== undefined && !Array.isArray(data.cars)) return null;
    if (data.messages !== undefined && !Array.isArray(data.messages)) return null;
    if (data.radio !== undefined && !isRadioRefs(data.radio)) return null;
    if (data.weather !== undefined && (typeof data.weather !== 'object' || data.weather === null || Array.isArray(data.weather))) return null;
    return { type: 'frame', data: data as unknown as FrameData };
  }
  return null;
}

// applyMessage folds a snapshot or frame into state. Frames with rev <= current
// are ignored (idempotent — mirrors the Go Apply, Tech §2.6).
export function applyMessage(s: RaceState, msg: Msg): RaceState {
  if (msg.type === 'snapshot') {
    const d = msg.data;
    return {
      session: d.session, mode: d.mode, label: d.label,
      track: d.track ?? [], cars: { ...d.cars }, timeMs: d.timeMs, rev: d.rev,
      radio: d.radio ?? [], lapTrace: d.lapTrace ?? {}, totalLaps: d.totalLaps ?? 0,
      stints: d.stints ?? {}, weather: d.weather,
      messages: d.messages ?? [],
      snapshotSeq: s.snapshotSeq + 1,
      // A snapshot is a fresh baseline, not a wrap: keep the counter so a
      // reconnect mid-clip doesn't read as a loop to anything watching it.
      loopSeq: s.loopSeq,
    };
  }
  const d = msg.data;
  if (d.rev <= s.rev) return s; // stale
  const cars = { ...s.cars };
  for (const c of d.cars ?? []) cars[c.driverNum] = c;
  // Loop restart: a replaying clip that reaches its end rewinds rather than
  // stopping, so timeMs drops by however long the clip is. Rev keeps climbing
  // (the player bumps it across laps), so this is the only signal there is —
  // and it is the same one internal/model/apply.go uses server-side. The
  // threshold keeps an out-of-order frame arriving a tick early from being
  // mistaken for a wrap; a clip is minutes long, a reordered frame is ~100 ms.
  const looped = s.rev > 0 && d.timeMs < s.timeMs - LOOP_REWIND_MS;
  // The previous pass's race control belongs to the previous pass. Left alone it
  // re-appends the same finite set of messages every lap, so the feed fills with
  // duplicates in an order that reads as neither chronological nor newest-first.
  const carried = looped ? [] : s.messages;
  const messages = d.messages?.length
    ? [...carried, ...d.messages].slice(-MAX_MESSAGES)
    : carried;
  // Live radio accumulates uncapped, mirroring Go's Apply (ADR-0008) — and, like
  // Go's, is deliberately NOT cleared on a wrap: only replay lanes loop, and
  // replay frames never carry radio.
  const radio = d.radio?.length ? [...s.radio, ...d.radio] : s.radio;
  return {
    ...s, cars, timeMs: d.timeMs, rev: d.rev, messages, radio,
    weather: d.weather ?? s.weather,
    loopSeq: looped ? s.loopSeq + 1 : s.loopSeq,
  };
}
