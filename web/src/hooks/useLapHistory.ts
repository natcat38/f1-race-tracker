import { useEffect, useRef, useState } from 'react';
import type { RaceState } from '../state/race';
import { updateLapHistory, type LapHistory } from '../components/timingHelpers';

// useLapHistory folds each frame's lastLapMs changes into a rolling per-driver
// lap-time history, reset on session switch (same reason TimingTower resets pb).
export function useLapHistory(state: RaceState): LapHistory {
  const [hist, setHist] = useState<LapHistory>({});
  const histRef = useRef<LapHistory>({});
  const sessionRef = useRef(state.session);

  useEffect(() => {
    if (sessionRef.current !== state.session) {
      sessionRef.current = state.session;
      histRef.current = {};
    }
    const next = updateLapHistory(histRef.current, Object.values(state.cars));
    histRef.current = next;
    setHist(next);
  }, [state.rev, state.session]); // eslint-disable-line react-hooks/exhaustive-deps

  return hist;
}
