import { describe, test, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { StintChart } from './StintChart';
import { emptyState } from '../state/race';
import type { Car } from '../state/race';

const car = (over: Partial<Car>): Car => ({
  driverNum: 1, code: 'VER', team: 'Red Bull', pos: 1, p: { x: 0, y: 0 }, status: 'OnTrack', ...over,
});

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
});
