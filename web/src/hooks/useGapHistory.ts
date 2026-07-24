import type { RaceState } from '../state/race';
import { updateGapHistory, type GapHistory } from '../components/timingHelpers';
import { useRollingHistory } from './useRollingHistory';

// useGapHistory folds each frame's gapMs into a rolling per-driver gap-trend
// history, one entry per completed lap — the "closing/opening" question a
// race engineer asks that the instantaneous Gap column can't answer. See
// useRollingHistory for the reset semantics.
export function useGapHistory(state: RaceState): GapHistory {
  return useRollingHistory(state, {}, updateGapHistory);
}
