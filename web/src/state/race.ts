export interface Point { x: number; y: number }
export interface Car {
  driverNum: number; code: string; team: string; pos: number;
  p: Point; status: string;
  // Phase 2 — all optional; absent renders blank.
  tyre?: string; tyreAge?: number;
  lastLapMs?: number; bestLapMs?: number;
  s1Ms?: number; s2Ms?: number; s3Ms?: number;
  gapMs?: number; gapLaps?: number; intMs?: number;
  speed?: number; gear?: number; throttle?: number; brake?: number; drs?: boolean;
}
export interface RadioMessage { timeMs: number; driverNum: number; clip: string }
export interface RaceControlMessage {
  rev: number; t: number; category: string; message: string; driver?: number;
}
// Rolling cap on the message buffer, mirroring internal/model/apply.go's maxMessages.
const MAX_MESSAGES = 30;
// cars/lapTrace are Record<number, ...> but the wire (and JS object) keys are actually
// strings (see internal/model/model.go's Cars map[int]CarState, which marshals with
// string keys — JSON has no int keys). Object.keys(cars) is string[]; coerce with
// Number() before comparing, as ghost.ts's commonDrivers does.
export interface RaceState {
  session: string; mode: string; label: string;
  track: Point[]; cars: Record<number, Car>; timeMs: number; rev: number;
  radio: RadioMessage[];
  lapTrace: Record<number, number[]>;
  messages: RaceControlMessage[];
  // Bumped on every snapshot (never on a frame) — lets a consumer (useComms) tell
  // a reconnect or source-switch snapshot apart from steady-state frames.
  snapshotSeq: number;
}

export function emptyState(): RaceState {
  return {
    session: '', mode: '', label: '', track: [], cars: {}, timeMs: 0, rev: 0,
    radio: [], lapTrace: {}, messages: [], snapshotSeq: 0,
  };
}

// Wire payloads from the gateway, mirroring internal/model (Snapshot, Frame).
interface SnapshotData {
  session: string; mode: string; label: string;
  track?: Point[]; cars: Record<number, Car>; timeMs: number; rev: number;
  radio?: RadioMessage[];
  lapTrace?: Record<number, number[]>;
  messages?: RaceControlMessage[];
}
interface FrameData { rev: number; timeMs: number; cars?: Car[]; messages?: RaceControlMessage[] }
type Msg =
  | { type: 'snapshot'; data: SnapshotData }
  | { type: 'frame'; data: FrameData };

// applyMessage folds a snapshot or frame into state. Frames with rev <= current
// are ignored (idempotent — mirrors the Go Apply, Tech §2.6).
export function applyMessage(s: RaceState, msg: Msg): RaceState {
  if (msg.type === 'snapshot') {
    const d = msg.data;
    return {
      session: d.session, mode: d.mode, label: d.label,
      track: d.track ?? [], cars: { ...d.cars }, timeMs: d.timeMs, rev: d.rev,
      radio: d.radio ?? [], lapTrace: d.lapTrace ?? {}, messages: d.messages ?? [],
      snapshotSeq: s.snapshotSeq + 1,
    };
  }
  const d = msg.data;
  if (d.rev <= s.rev) return s; // stale
  const cars = { ...s.cars };
  for (const c of d.cars ?? []) cars[c.driverNum] = c;
  const messages = d.messages?.length
    ? [...s.messages, ...d.messages].slice(-MAX_MESSAGES)
    : s.messages;
  return { ...s, cars, timeMs: d.timeMs, rev: d.rev, messages };
}
