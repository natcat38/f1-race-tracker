import { describe, test, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Standings } from './Standings';
import { emptyState } from '../state/race';
import { car } from '../state/testCar';

describe('Standings leader label', () => {
  test('labels the front-runner LEADER', () => {
    const state = {
      ...emptyState(),
      cars: {
        1: car({ driverNum: 1, code: 'VER', pos: 1, lap: 12, lastLapMs: 85000 }),
        16: car({ driverNum: 16, code: 'LEC', pos: 2, lap: 12, lastLapMs: 85500, gapMs: 1200 }),
      },
    };
    const html = renderToStaticMarkup(<Standings state={state} />);
    expect(html).toContain('LEADER');
    // The gap is an estimate at ~0.5s resolution, so it renders to one decimal.
    expect(html).toContain('+1.2');
  });

  test('degrades honestly instead of labelling nobody when no car carries a literal pos:1 (#66)', () => {
    // Mirrors the StatusRail/StintChart tests: the Monza-2024-shaped frame with
    // two cars tied on a stale pos and none at pos:1. Reading the leader off
    // orderCars' running order keeps a LEADER row; the old `c.pos === 1` test
    // labelled nobody and showed a nonsense gap for the actual front-runner.
    const state = {
      ...emptyState(),
      cars: {
        22: car({ driverNum: 22, code: 'TSU', pos: 19, lap: 7, lastLapMs: 86000, gapMs: 90000 }),
        27: car({ driverNum: 27, code: 'HUL', pos: 19, lap: 12, lastLapMs: 85000, gapMs: 0 }),
      },
    };
    const html = renderToStaticMarkup(<Standings state={state} />);
    expect(html).toContain('LEADER');
    // ...and it is the front-runner's row that carries it, not the lapped car's.
    expect(html.indexOf('HUL')).toBeLessThan(html.indexOf('LEADER'));
    expect(html.indexOf('LEADER')).toBeLessThan(html.indexOf('TSU'));
  });
});
