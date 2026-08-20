import { describe, test, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { StatusRail } from './StatusRail';
import { emptyState } from '../state/race';
import type { Car } from '../state/race';

const car = (over: Partial<Car>): Car => ({
  driverNum: 1, code: 'VER', team: 'Red Bull', pos: 1, p: { x: 0, y: 0 }, status: 'OnTrack', ...over,
});

describe('StatusRail leader-lap badge', () => {
  test('shows LAP n/m when a car is tagged pos:1', () => {
    const state = {
      ...emptyState(),
      totalLaps: 53,
      cars: { 1: car({ driverNum: 1, pos: 1, lap: 12 }) },
    };
    const html = renderToStaticMarkup(<StatusRail active="board" state={state} />);
    expect(html).toContain('LAP 12/53');
  });

  test('degrades honestly instead of vanishing when no car carries a literal pos:1 (#66)', () => {
    // Reconciliation in ingest now guarantees a contiguous 1..N per frame, but this
    // is the belt-and-braces path: a malformed/stale frame with no exact pos:1 (the
    // Monza clips' old symptom) should still show the front-runner's lap via
    // orderCars' running order, not make the whole badge disappear.
    const state = {
      ...emptyState(),
      totalLaps: 53,
      cars: {
        22: car({ driverNum: 22, code: 'TSU', pos: 19, lap: 7 }),
        27: car({ driverNum: 27, code: 'HUL', pos: 19, lap: 12 }),
      },
    };
    const html = renderToStaticMarkup(<StatusRail active="board" state={state} />);
    expect(html).toContain('LAP 12/53');
  });
});
