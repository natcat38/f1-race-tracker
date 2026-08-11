/**
 * React hooks that derive UI-facing state (staleness, gap/lap history, smoothed car positions, comms playback) from the raw RaceState stream.
 * @packageDocumentation
 */
import { useEffect, useRef, useState } from 'react';
import type { RaceState } from '../state/race';

// useStale returns whole seconds since the lane's rev last advanced.
// Callers MUST treat state.rev === 0 as "warming up", not stalled —
// this hook can't tell first-connect from a real stall.
export function useStale(state: RaceState): number {
  const [staleSec, setStaleSec] = useState(0);
  const [trackedRev, setTrackedRev] = useState(state.rev);
  const lastChangeRef = useRef<number | null>(null);

  // Reset immediately (render-time state adjustment, not an effect) the
  // instant rev changes, so the badge snaps back to 0 the moment data
  // resumes rather than waiting on the 1s interval below. During steady
  // 10Hz updates rev changes far faster than that interval ticks, so
  // relying on the interval alone to reset would leave staleSec stuck at
  // whatever it last reached.
  if (trackedRev !== state.rev) {
    setTrackedRev(state.rev);
    if (staleSec !== 0) setStaleSec(0);
  }

  useEffect(() => {
    lastChangeRef.current = Date.now();
  }, [state.rev]);

  // One persistent interval for the component's lifetime — NOT torn down and
  // rebuilt on every rev change — so it keeps ticking even while updates are
  // arriving rapidly, and correctly keeps counting once they stop.
  useEffect(() => {
    const id = setInterval(() => {
      const last = lastChangeRef.current;
      if (last != null) setStaleSec(Math.floor((Date.now() - last) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, []);

  return staleSec;
}
