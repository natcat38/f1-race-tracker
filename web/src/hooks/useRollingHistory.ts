// The shared fold behind the lap and gap histories, including reset on session switch
// or replay-loop restart.

import { useEffect, useRef, useState } from 'react';
import type { Car, RaceState } from '../state/race';

// useRollingHistory folds each frame's cars into a rolling per-driver history
// via `update` (a pure `(prev, cars) => next` fold, e.g. updateLapHistory or
// updateGapHistory), resetting on session switch or a replay-loop restart (the
// baked clip loops forever with timeMs jumping back to the window start, so a
// timeMs decrease means the next update is not a continuation of the last one).
// Shared by useLapHistory and useGapHistory, which were previously identical
// copies of this scaffolding differing only in which `update` fn they called.
export function useRollingHistory<H>(state: RaceState, initial: H, update: (prev: H, cars: Car[]) => H): H {
  const [hist, setHist] = useState<H>(initial);
  const histRef = useRef<H>(initial);
  const sessionRef = useRef(state.session);
  const timeMsRef = useRef(state.timeMs);

  useEffect(() => {
    if (sessionRef.current !== state.session || state.timeMs < timeMsRef.current) {
      sessionRef.current = state.session;
      histRef.current = initial;
    }
    timeMsRef.current = state.timeMs;
    const next = update(histRef.current, Object.values(state.cars));
    histRef.current = next;
    setHist(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.rev, state.session]);

  return hist;
}
