import { useEffect, useReducer, useRef } from 'react';
import type { Car, RaceState, Point } from '../state/race';

// Returns cars with positions interpolated at display refresh rate.
// Cars glide from their previous position to their current position over one
// frame interval (~100 ms at 10 Hz), keeping motion smooth at 60 fps.
export function useSmoothedCars(state: RaceState): Car[] {
  const from = useRef<Record<number, Point>>({});
  const to = useRef<Record<number, Point>>({});
  const tFrom = useRef(0);
  const tTo = useRef(0);
  const [, tick] = useReducer((x: number) => x + 1, 0);

  // When a new frame/snapshot arrives (rev changes), snapshot from→to.
  useEffect(() => {
    const now = performance.now();
    from.current = { ...to.current };
    const next: Record<number, Point> = {};
    for (const c of Object.values(state.cars)) next[c.driverNum] = c.p;
    to.current = next;
    tFrom.current = tTo.current || now;
    tTo.current = now;
  }, [state.rev]); // eslint-disable-line react-hooks/exhaustive-deps

  // Drive re-renders at display refresh rate.
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      tick();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const now = performance.now();
  const dur = Math.max(16, tTo.current - tFrom.current);
  const t = Math.min(1, (now - tTo.current) / dur);

  return Object.values(state.cars).map((c) => {
    const a = from.current[c.driverNum] ?? c.p;
    const b = to.current[c.driverNum] ?? c.p;
    return { ...c, p: { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t } };
  });
}
