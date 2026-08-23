// React binding for the shared lane registry: one session key, one connection, however
// many overlay sides name it.

import { useEffect, useState } from 'react';
import { subscribeLane, type LaneSnapshot } from '../realtime/lanes';
import { emptyState } from '../state/race';

function pending(session: string): { session: string; snap: LaneSnapshot } {
  return { session, snap: { state: emptyState(), status: 'connecting' } };
}

// useLane returns the live state and status for a session key. Two components (or
// the overlay's two sides) passing the same key share a single connection — see
// subscribeLane. Passing a different key tears the old subscription down and opens
// the new one, so a session picker is just a state change.
export function useLane(session: string): LaneSnapshot {
  // The session is stored WITH the snapshot rather than reset in an effect: on the
  // render where the key changes the old lane's state is still in state, and
  // returning it under the new session's label would show one frame of the wrong
  // race. Comparing keys here discards it without a cascading render.
  const [held, setHeld] = useState(() => pending(session));
  useEffect(() => subscribeLane(session, (snap) => setHeld({ session, snap })), [session]);
  return held.session === session ? held.snap : pending(session).snap;
}
