import { describe, test, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { StatusRail } from './StatusRail';
import { emptyState } from '../state/race';
import { car } from '../state/testCar';

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

  test('still shows the badge when the leader is on lap 0', () => {
    // lap 0 is a real value on the wire (internal/model/model.go) — the opening
    // lap, before anyone has crossed the line. A truthiness guard hid the badge
    // for exactly the moment it is most interesting.
    const state = {
      ...emptyState(),
      totalLaps: 53,
      cars: { 1: car({ driverNum: 1, pos: 1, lap: 0 }) },
    };
    const html = renderToStaticMarkup(<StatusRail active="board" state={state} />);
    expect(html).toContain('LAP 0/53');
  });

  test('omits the badge when the leader has no lap at all', () => {
    const state = {
      ...emptyState(),
      totalLaps: 53,
      cars: { 1: car({ driverNum: 1, pos: 1 }) },
    };
    const html = renderToStaticMarkup(<StatusRail active="board" state={state} />);
    expect(html).not.toContain('LAP ');
  });
});
