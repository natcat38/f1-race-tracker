import { useEffect, useRef, useState } from 'react';
import type { Car, RaceState, Point } from '../state/race';

// Returns cars with positions interpolated at display refresh rate.
// Cars glide from their previous position to their current position over one
// frame interval (~100 ms at 10 Hz), keeping motion smooth at 60 fps.
export function useSmoothedCars(state: RaceState): Car[] {
  const from = useRef<Record<number, Point>>({});
  const to = useRef<Record<number, Point>>({});
  const tFrom = useRef(0);
  const tTo = useRef(0);
  const stateRef = useRef(state);
  const [smoothed, setSmoothed] = useState<Car[]>(() => Object.values(state.cars));

  // Keep the latest state reachable from the animation loop without restarting it.
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

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

  // Interpolate at display refresh rate. Refs are read inside the rAF callback
  // (not during render), which the react-hooks rules require; the result is
  // published to state so the component re-renders ~60 fps with smooth motion.
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      const now = performance.now();
      const dur = Math.max(16, tTo.current - tFrom.current);
      const t = Math.min(1, (now - tTo.current) / dur);
      const cars = Object.values(stateRef.current.cars).map((c) => {
        const a = from.current[c.driverNum] ?? c.p;
        const b = to.current[c.driverNum] ?? c.p;
        return { ...c, p: { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t } };
      });
      setSmoothed(cars);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  return smoothed;
}
