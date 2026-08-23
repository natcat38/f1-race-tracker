// Render tests for the overlay: both comparison scenarios, per-side team colours,
// and the states where there is nothing to compare.

import { describe, test, expect, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { emptyState, type RaceState } from '../state/race';
import { car } from '../state/testCar';

// The lane hook is the component's only data source, so seeding it is the whole
// fixture. Effects do not run under renderToStaticMarkup, which is exactly what we
// want: no sockets, no rAF, no history writes — just the first paint.
const lanes: Record<string, RaceState> = {};
vi.mock('../hooks/useLane', () => ({
  useLane: (session: string) => ({
    state: lanes[session] ?? emptyState(),
    status: 'live' as const,
  }),
}));

const { Ghost } = await import('./Ghost');

// A square-ish outline with four points, so an index maps to a distinguishable spot.
const TRACK = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];

function seed(session: string, extra: Partial<RaceState> = {}): RaceState {
  return {
    ...emptyState(),
    session,
    label: 'Monza',
    rev: 5,
    track: TRACK,
    cars: {
      1: car({ driverNum: 1, code: 'VER', team: 'Red Bull' }),
      16: car({ driverNum: 16, code: 'LEC', team: 'Ferrari' }),
    },
    lapTrace: {
      1: [0, 20000, 45000, 80000],
      16: [0, 20500, 44500, 80600],
    },
    ...extra,
  };
}

beforeEach(() => {
  for (const k of Object.keys(lanes)) delete lanes[k];
});

describe('scenario (b) — two drivers, one race', () => {
  test('renders a delta between two drivers pulled from ONE session', () => {
    lanes['compare-monza-2024'] = seed('compare-monza-2024');
    const html = renderToStaticMarkup(
      <Ghost
        initialA={{ session: 'monza-2024', car: 'VER' }}
        initialB={{ session: 'monza-2024', car: 'LEC' }}
      />,
    );
    expect(html).toContain('Monza 2024 VER (solid)');
    expect(html).toContain('Monza 2024 LEC (ghost)');
    // Delta at t=0 is 0.00s; the readout exists and is interpretable.
    expect(html).toContain('0.00s');
    expect(html).toContain('Lap time delta');
    // Same session and outline: no approximation caveat.
    expect(html).toContain('positions and delta are exact');
    expect(html).not.toContain('approximate');
  });

  test('the two markers carry their own team colours, not one shared colour', () => {
    lanes['compare-monza-2024'] = seed('compare-monza-2024');
    const html = renderToStaticMarkup(
      <Ghost
        initialA={{ session: 'monza-2024', car: 'VER' }}
        initialB={{ session: 'monza-2024', car: 'LEC' }}
      />,
    );
    // Whatever the tokens are, the two sides must not resolve to one value —
    // that was only ever safe when a driver was compared with himself.
    const fills = [...html.matchAll(/<circle[^>]*fill="([^"]+)"/g)].map((m) => m[1]);
    expect(fills).toHaveLength(2);
    expect(fills[0]).not.toBe(fills[1]);
  });

  test('the same driver on both sides refuses to draw and says how to fix it', () => {
    lanes['compare-monza-2024'] = seed('compare-monza-2024');
    const html = renderToStaticMarkup(
      <Ghost
        initialA={{ session: 'monza-2024', car: 'VER' }}
        initialB={{ session: 'monza-2024', car: 'VER' }}
      />,
    );
    expect(html).toContain('pick two different drivers');
    expect(html).not.toContain('Lap time delta');
  });
});

describe('scenario (a) — same driver, two years', () => {
  test('renders across two sessions and marks the position approximation', () => {
    lanes['compare-monza-2024'] = seed('compare-monza-2024');
    lanes['compare-monza-2023'] = seed('compare-monza-2023', {
      lapTrace: { 1: [0, 21000, 46000, 82000], 16: [0, 20800, 45200, 81500] },
    });
    const html = renderToStaticMarkup(
      <Ghost
        initialA={{ session: 'monza-2024', car: 'VER' }}
        initialB={{ session: 'monza-2023', car: 'VER' }}
      />,
    );
    expect(html).toContain('Monza 2024 VER (solid)');
    expect(html).toContain('Monza 2023 VER (ghost)');
    // The honest note the old route left as a code comment.
    expect(html).toContain('positions are approximate');
  });
});

describe('picker and empty states', () => {
  test('the driver picker offers only drivers that actually have a reference lap', () => {
    lanes['compare-monza-2024'] = seed('compare-monza-2024', {
      lapTrace: { 1: [0, 20000, 45000, 80000], 16: [] },
    });
    const html = renderToStaticMarkup(<Ghost />);
    expect(html).toContain('>VER</option>');
    expect(html).not.toContain('>LEC</option>');
  });

  test('an unconnected lane shows the loading copy, not an empty overlay', () => {
    const html = renderToStaticMarkup(<Ghost />);
    expect(html).toContain('Loading reference laps…');
    // The picker says what it is waiting for rather than reading as "no drivers".
    expect(html).toContain('Waiting for driver data…');
  });

  test('a session slug this build has no lane for falls back instead of dead-ending', () => {
    lanes['compare-monza-2024'] = seed('compare-monza-2024');
    const html = renderToStaticMarkup(
      <Ghost
        initialA={{ session: 'spa-2024', car: 'VER' }}
        initialB={{ session: 'monza-2024', car: 'LEC' }}
      />,
    );
    expect(html).toContain('Monza 2024');
  });
});
