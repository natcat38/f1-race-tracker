// A refcounted registry of open lanes, so two overlay sides naming the same session
// share one connection instead of opening two.

import { emptyState, type RaceState } from '../state/race';
import { connectRace, type ConnStatus } from './socket';
import { connectStaticReplay } from './staticReplay';
import { STATIC_DEMO } from '../staticDemo';

export interface LaneSnapshot { state: RaceState; status: ConnStatus }

type Listener = (snap: LaneSnapshot) => void;
type Connect = (
  onState: (s: RaceState) => void,
  onStatus: (s: ConnStatus) => void,
  session?: string,
) => () => void;

interface Entry {
  listeners: Set<Listener>;
  snap: LaneSnapshot;
  close: () => void;
}

const lanes = new Map<string, Entry>();

// The default data source. The static build has no gateway to dial, so it plays the
// baked clip through the same reducer; either way one session key means one source.
const defaultConnect: Connect = (onState, onStatus, session) =>
  STATIC_DEMO ? connectStaticReplay(onState, onStatus) : connectRace(onState, onStatus, session);

// subscribeLane hands the caller the latest snapshot for `session` and keeps it
// updated. The FIRST subscriber opens the connection; every later one attaches to
// the same entry, and the connection closes when the last one detaches. This is what
// makes the same-session case (VER vs LEC at Monza 2024) cost one socket rather than
// two — and it is why the overlay can address both sides independently without
// doubling the load on the gateway.
//
// `connect` is injectable so the dedupe can be tested without a WebSocket.
export function subscribeLane(
  session: string,
  listener: Listener,
  connect: Connect = defaultConnect,
): () => void {
  let entry = lanes.get(session);
  if (!entry) {
    const created: Entry = {
      listeners: new Set(),
      snap: { state: emptyState(), status: 'connecting' },
      close: () => {},
    };
    lanes.set(session, created);
    const emit = () => { for (const l of [...created.listeners]) l(created.snap); };
    created.close = connect(
      (state) => { created.snap = { ...created.snap, state }; emit(); },
      (status) => { created.snap = { ...created.snap, status }; emit(); },
      session,
    );
    entry = created;
  }
  const e = entry;
  e.listeners.add(listener);
  // Deliver what we already have, so a second subscriber joining a warm lane does
  // not sit on an empty state until the next frame.
  listener(e.snap);
  return () => {
    e.listeners.delete(listener);
    if (e.listeners.size === 0) {
      lanes.delete(session);
      e.close();
    }
  };
}

// Test seam: the registry is module state, so a test that opened lanes must be able
// to put it back. Not used by the app.
export function resetLanes(): void {
  for (const e of lanes.values()) e.close();
  lanes.clear();
}

export function openLaneCount(): number {
  return lanes.size;
}
