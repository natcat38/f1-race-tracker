// Interpolates car positions at display refresh rate so 10 Hz frames render as
// continuous motion.

import { useEffect, useRef, useState } from 'react';
import type { Car, RaceState, Point } from '../state/race';
import { useReducedMotion } from './useReducedMotion';

// Returns cars with positions interpolated at display refresh rate.
// Cars glide from their previous position to their current position over one
// frame interval (~100 ms at 10 Hz), keeping motion smooth at the display's
// native refresh rate.
// `paused` is the board's Freeze control (WCAG 2.2.2): with frames no longer
// being applied, `state` stops changing and the glide would settle anyway — but
// the rAF loop would keep publishing a fresh array 60 times a second for a
// picture that never changes. Stopping the loop is the honest reading of "pause".
export function useSmoothedCars(state: RaceState, paused = false): Car[] {
  const reducedMotion = useReducedMotion();
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
    const prevTo = to.current;
    const next: Record<number, Point> = {};
    for (const c of Object.values(state.cars)) next[c.driverNum] = c.p;
    // ponytail: a scrub or loop restart moves a car far more than one 10Hz frame
    // ever could (normal frame-to-frame motion on this track is well under this
    // in track-space units) — snap instead of gliding across the map.
    const TELEPORT_THRESHOLD = 50;
    const snapped: Record<number, Point> = {};
    for (const [id, p] of Object.entries(next)) {
      const prev = prevTo[Number(id)];
      const dist = prev ? Math.hypot(p.x - prev.x, p.y - prev.y) : 0;
      snapped[Number(id)] = prev && dist <= TELEPORT_THRESHOLD ? prev : p;
    }
    from.current = snapped;
    to.current = next;
    tFrom.current = tTo.current || now;
    tTo.current = now;
  }, [state.rev]); // eslint-disable-line react-hooks/exhaustive-deps

  // Interpolate at display refresh rate. Refs are read inside the rAF callback
  // (not during render), which the react-hooks rules require; the result is
  // published to state so the component re-renders at the display's native
  // refresh rate with smooth motion.
  useEffect(() => {
    // Reduced motion: no interpolation loop at all (see the return below, which
    // hands back each frame's reported positions directly).
    if (reducedMotion || paused) return;
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
  }, [reducedMotion, paused]);

  // Cars jump straight to each frame's reported position — still a positional
  // update every 100ms, just without the continuous per-refresh glide. Derived
  // rather than synced into state, so there is no second render per frame.
  return reducedMotion || paused ? Object.values(state.cars) : smoothed;
}
