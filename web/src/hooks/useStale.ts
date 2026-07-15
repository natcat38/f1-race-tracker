import { useEffect, useRef, useState } from 'react';
import type { RaceState } from '../state/race';

// useStale returns whole seconds since the lane's rev last advanced.
// Callers MUST treat state.rev === 0 as "warming up", not stalled —
// this hook can't tell first-connect from a real stall.
export function useStale(state: RaceState): number {
  const [staleSec, setStaleSec] = useState(0);
  const lastChangeRef = useRef<number | null>(null);

  // Re-anchor the baseline and (re)start the ticking interval every time rev
  // advances. While updates keep arriving faster than the interval fires,
  // this timer is torn down and restarted before it ever ticks — it only
  // gets to run (and raise staleSec) once updates actually stop.
  useEffect(() => {
    lastChangeRef.current = Date.now();
    const id = setInterval(() => {
      const last = lastChangeRef.current;
      if (last != null) setStaleSec(Math.floor((Date.now() - last) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [state.rev]);

  return staleSec;
}
