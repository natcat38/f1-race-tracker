import type { RaceState } from '../state/race';
import { updateLapHistory, type LapHistory } from '../components/timingHelpers';
import { useRollingHistory } from './useRollingHistory';

// useLapHistory folds each frame's lastLapMs changes into a rolling per-driver
// lap-time history — see useRollingHistory for the reset semantics.
export function useLapHistory(state: RaceState): LapHistory {
  return useRollingHistory(state, {}, updateLapHistory);
}
