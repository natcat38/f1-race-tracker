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
export interface RaceState {
  session: string; mode: string; label: string;
  track: Point[]; cars: Record<number, Car>; timeMs: number; rev: number;
}

export function emptyState(): RaceState {
  return { session: '', mode: '', label: '', track: [], cars: {}, timeMs: 0, rev: 0 };
}

// Wire payloads from the gateway, mirroring internal/model (Snapshot, Frame).
interface SnapshotData {
  session: string; mode: string; label: string;
  track?: Point[]; cars: Record<number, Car>; timeMs: number; rev: number;
}
interface FrameData { rev: number; timeMs: number; cars?: Car[] }
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
    };
  }
  const d = msg.data;
  if (d.rev <= s.rev) return s; // stale
  const cars = { ...s.cars };
  for (const c of d.cars ?? []) cars[c.driverNum] = c;
  return { ...s, cars, timeMs: d.timeMs, rev: d.rev };
}
