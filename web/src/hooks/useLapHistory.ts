import { useEffect, useRef, useState } from 'react';
import type { RaceState } from '../state/race';
import { updateLapHistory, type LapHistory } from '../components/timingHelpers';

// useLapHistory folds each frame's lastLapMs changes into a rolling per-driver
// lap-time history, reset on session switch (same reason TimingTower resets pb)
// or on a replay-loop restart: the baked clip loops forever with timeMs jumping
// back to the window start, so a timeMs decrease means the next lastLapMs is not
// a continuation of the last one and must not be appended as a "new" lap.
export function useLapHistory(state: RaceState): LapHistory {
  const [hist, setHist] = useState<LapHistory>({});
  const histRef = useRef<LapHistory>({});
  const sessionRef = useRef(state.session);
  const timeMsRef = useRef(state.timeMs);

  useEffect(() => {
    if (sessionRef.current !== state.session || state.timeMs < timeMsRef.current) {
      sessionRef.current = state.session;
      histRef.current = {};
    }
    timeMsRef.current = state.timeMs;
    const next = updateLapHistory(histRef.current, Object.values(state.cars));
    histRef.current = next;
    setHist(next);
  }, [state.rev, state.session]); // eslint-disable-line react-hooks/exhaustive-deps

  return hist;
}
