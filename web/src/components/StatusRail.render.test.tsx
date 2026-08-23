// Render tests for the top rail: instrument clusters, empty zones, tabs and status.

import { describe, test, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { StatusRail } from './StatusRail';
import { SourceToggle } from './SourceToggle';
import { emptyState } from '../state/race';
import { car } from '../state/testCar';

const leaderOnLap = (lap: number) => ({
  ...emptyState(),
  totalLaps: 53,
  cars: { 1: car({ driverNum: 1, pos: 1, lap }) },
});

describe('StatusRail leader-lap instrument', () => {
  test('shows the lap value under its LAP label when a car is tagged pos:1', () => {
    const html = renderToStaticMarkup(<StatusRail active="board" state={leaderOnLap(12)} />);
    expect(html).toContain('12/53');
    expect(html).toContain('>Lap<');
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
    expect(html).toContain('12/53');
  });

  test('still shows the instrument when the leader is on lap 0', () => {
    // lap 0 is a real value on the wire (internal/model/model.go) — the opening
    // lap, before anyone has crossed the line. A truthiness guard hid the badge
    // for exactly the moment it is most interesting.
    const html = renderToStaticMarkup(<StatusRail active="board" state={leaderOnLap(0)} />);
    expect(html).toContain('0/53');
    expect(html).toContain('>Lap<');
  });

  test('omits the instrument when the leader has no lap at all', () => {
    const state = { ...emptyState(), totalLaps: 53, cars: { 1: car({ driverNum: 1, pos: 1 }) } };
    const html = renderToStaticMarkup(<StatusRail active="board" state={state} />);
    expect(html).not.toContain('>Lap<');
  });
});

describe('StatusRail instrument clusters', () => {
  test('every instrument renders a value and the label that names it', () => {
    const state = {
      ...leaderOnLap(16),
      weather: { trackTempC: 48.2, airTempC: 33.4, rainfall: false },
    };
    const html = renderToStaticMarkup(<StatusRail active="board" state={state} />);
    for (const label of ['>Session<', '>Lap<', '>Track / Air<']) {
      expect(html).toContain(label);
    }
    expect(html).toContain('48° / 33°');
  });

  test('renders the four zones in cluster order on the board', () => {
    const html = renderToStaticMarkup(
      <StatusRail active="board" state={leaderOnLap(4)} controls={<button type="button">x</button>} />,
    );
    for (const cluster of ['rail-identity', 'rail-instruments', 'rail-state', 'rail-controls', 'rail-tabs', 'rail-exits']) {
      expect(html).toContain(cluster);
    }
  });

  test('empty zones render null rather than a stray seam', () => {
    // The overlay: no session, no lane control. An instruments cluster or a
    // control cluster with nothing in it is a hairline with no zone behind it.
    const html = renderToStaticMarkup(<StatusRail active="ghost" note="two laps" />);
    expect(html).not.toContain('rail-instruments');
    expect(html).not.toContain('rail-conditions');
    expect(html).not.toContain('rail-state');
    expect(html).not.toContain('rail-controls');
    // Identity, nav and the exits are on every route.
    expect(html).toContain('rail-identity');
    expect(html).toContain('rail-tabs');
    expect(html).toContain('rail-exits');
  });

  test('a session with no weather renders no conditions cluster', () => {
    const html = renderToStaticMarkup(<StatusRail active="board" state={leaderOnLap(4)} />);
    expect(html).toContain('rail-instruments');
    expect(html).not.toContain('rail-conditions');
  });

  test('the state zone appears for transient chips even with no session', () => {
    const html = renderToStaticMarkup(
      <StatusRail active="board" stateChips={<span className="chip">FROZEN</span>} />,
    );
    expect(html).toContain('rail-state');
    expect(html).toContain('FROZEN');
  });

  test('the reserved state slot is not itself a live region', () => {
    // Two nested polite regions double-announce; the chip carries its own and
    // the board hands one in beside it.
    const html = renderToStaticMarkup(<StatusRail active="board" state={leaderOnLap(4)} />);
    expect(html).not.toMatch(/class="rail-cluster rail-state"[^>]*aria-live/);
  });

  test('exactly one polite region per chip in the rail subtree', () => {
    const html = renderToStaticMarkup(<StatusRail active="board" state={leaderOnLap(4)} />);
    expect(html.match(/aria-live="polite"/g)).toHaveLength(1);
  });
});

describe('StatusRail navigation', () => {
  test('the nav is labelled and marks exactly one current page', () => {
    const html = renderToStaticMarkup(<StatusRail active="ghost" />);
    expect(html).toContain('aria-label="Views"');
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
  });

  test('Settings marks the demoted F1TV link current, not a tab', () => {
    const html = renderToStaticMarkup(<StatusRail active="settings" />);
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
    expect(html).toContain('rail-repo-active');
  });

  test('the h1 stays visible in the identity zone and names the route', () => {
    const html = renderToStaticMarkup(<StatusRail active="ghost" />);
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html).toContain('Lap delta overlay');
    expect(html).not.toContain('visually-hidden">F1 Race Tracker');
  });
});

describe('control grammar', () => {
  test('a persistent choice is a labelled radiogroup with a visible scope', () => {
    const state = { ...emptyState(), session: 'replay' };
    const html = renderToStaticMarkup(
      <StatusRail active="board" state={state} controls={<SourceToggle state={state} />} />,
    );
    expect(html).toContain('role="radiogroup"');
    expect(html).toContain('aria-label="Data source"');
    // The group names its own scope on screen (ui-ux M14): a bare pair of
    // buttons never says what it is choosing between.
    expect(html).toContain('class="rail-scope"');
    expect(html).toContain('Lane');
    expect(html.match(/role="radio"/g)).toHaveLength(2);
    expect(html).toContain('aria-checked="true"');
  });

  test('roving tabindex leaves exactly one segment reachable by Tab', () => {
    const state = { ...emptyState(), session: 'live' };
    const html = renderToStaticMarkup(<SourceToggle state={state} />);
    expect(html.match(/tabindex="0"/g)).toHaveLength(1);
    expect(html.match(/tabindex="-1"/g)).toHaveLength(1);
  });

  test('an unknown session key still leaves the group reachable', () => {
    const state = { ...emptyState(), session: 'something-else' };
    const html = renderToStaticMarkup(<SourceToggle state={state} />);
    expect(html.match(/tabindex="0"/g)).toHaveLength(1);
    expect(html).not.toContain('aria-checked="true"');
  });

  test('a momentary verb stays a plain button, not a segment', () => {
    const html = renderToStaticMarkup(
      <StatusRail
        active="board"
        state={leaderOnLap(4)}
        controls={<button type="button" className="btn">⏸ Freeze</button>}
      />,
    );
    expect(html).toContain('⏸ Freeze');
    expect(html).not.toContain('role="radiogroup"');
  });
});
