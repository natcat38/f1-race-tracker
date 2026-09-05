// Render tests for the strategy timeline's stint segments and leader marker.

import { describe, test, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { StintChart } from './StintChart';
import { emptyState } from '../state/race';
import { car } from '../state/testCar';

describe('StintChart leader-lap marker', () => {
  test('draws the marker when a car is tagged pos:1', () => {
    const state = {
      ...emptyState(),
      totalLaps: 53,
      cars: { 1: car({ driverNum: 1, pos: 1, lap: 12 }) },
      stints: { 1: [{ compound: 'SOFT', startLap: 1, endLap: 20 }] },
    };
    const html = renderToStaticMarkup(<StintChart state={state} />);
    expect(html).toContain('Leader is on lap 12');
  });

  test('degrades honestly instead of silently not drawing when no car carries a literal pos:1 (#66)', () => {
    // Same Monza-2024-shaped frame as StatusRail's test: two cars tied on a
    // stale pos with no car at pos:1. The marker should still land on the
    // front-runner via orderCars' running order rather than vanish.
    const state = {
      ...emptyState(),
      totalLaps: 53,
      cars: {
        22: car({ driverNum: 22, code: 'TSU', pos: 19, lap: 7 }),
        27: car({ driverNum: 27, code: 'HUL', pos: 19, lap: 12 }),
      },
      stints: {
        22: [{ compound: 'SOFT', startLap: 1, endLap: 20 }],
        27: [{ compound: 'SOFT', startLap: 1, endLap: 20 }],
      },
    };
    const html = renderToStaticMarkup(<StintChart state={state} />);
    expect(html).toContain('Leader is on lap 12');
  });

  test('still draws the marker when the leader is on lap 0', () => {
    // Same falsy-zero trap as StatusRail's LAP badge: lap 0 is the opening lap,
    // not "no value", so the marker must sit at the start of the axis.
    const state = {
      ...emptyState(),
      totalLaps: 53,
      cars: { 1: car({ driverNum: 1, pos: 1, lap: 0 }) },
      stints: { 1: [{ compound: 'SOFT', startLap: 1, endLap: 20 }] },
    };
    const html = renderToStaticMarkup(<StintChart state={state} />);
    expect(html).toContain('Leader is on lap 0');
  });
});

describe('StintChart pit-stop tick contrast (#105)', () => {
  test('draws the tick with an asphalt casing outline instead of a fallback colour', () => {
    const state = {
      ...emptyState(),
      totalLaps: 53,
      cars: { 1: car({ driverNum: 1, pos: 1, lap: 12 }) },
      stints: { 1: [{ compound: 'HARD', startLap: 1, endLap: 20 }] },
      pitStops: { 1: [{ lap: 10, durationS: 22.4 }] },
    };
    const html = renderToStaticMarkup(<StintChart state={state} />);
    // The dead `var(--amber, orange)` CSS-fallback must be gone; the tick now
    // carries its own dark casing so it holds 3:1 contrast against any
    // compound colour underneath it, not just the darker ones.
    expect(html).not.toContain('orange');
    expect(html).toContain('box-shadow:0 0 0 1px var(--asphalt)');
    expect(html).toContain('pit stop on lap 10, 22.4 seconds');
  });
});
