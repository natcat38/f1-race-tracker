import { useEffect, useRef, useState } from 'react';
import type { RaceState } from '../state/race';
import { updateGapHistory, type GapHistory } from '../components/timingHelpers';

// useGapHistory folds each frame's gapMs into a rolling per-driver gap-trend
// history, one entry per completed lap — the "closing/opening" question a
// race engineer asks that the instantaneous Gap column can't answer. Reset on
// session switch or a replay-loop restart, same reasoning as useLapHistory.
export function useGapHistory(state: RaceState): GapHistory {
  const [hist, setHist] = useState<GapHistory>({});
  const histRef = useRef<GapHistory>({});
  const sessionRef = useRef(state.session);
  const timeMsRef = useRef(state.timeMs);

  useEffect(() => {
    if (sessionRef.current !== state.session || state.timeMs < timeMsRef.current) {
      sessionRef.current = state.session;
      histRef.current = {};
    }
    timeMsRef.current = state.timeMs;
    const next = updateGapHistory(histRef.current, Object.values(state.cars));
    histRef.current = next;
    setHist(next);
  }, [state.rev, state.session]); // eslint-disable-line react-hooks/exhaustive-deps

  return hist;
}
