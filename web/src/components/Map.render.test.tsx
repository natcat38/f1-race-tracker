// Render (renderToStaticMarkup) regression coverage for three a11y/layout bugs
// in the corner-number labels and the sector-dominance heatmap legend:
// issues #99 (fixed contrast against the heatmap), #104 (colour-only heatmap
// meaning), and #109 (corner labels vanishing below 700px).

import { describe, test, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Map } from './Map';
import { emptyState, type RaceState } from '../state/race';
import { car } from '../state/testCar';

const TRACK = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];

function stateWith(extra: Partial<RaceState>): RaceState {
  return {
    ...emptyState(),
    rev: 1,
    track: TRACK,
    corners: [{ number: 1, x: 0.25, y: 0.25 }],
    cars: {
      44: car({ driverNum: 44, code: 'HAM', team: 'Mercedes' }),
    },
    ...extra,
  };
}

describe('corner labels', () => {
  test('#99: corner number gets a fixed-colour backing chip, not the raw heatmap-adjacent fill', () => {
    // Mercedes' team colour (#27F4D2) is the near-invisible case the issue
    // names — the fix must not paint the corner number straight onto it.
    const html = renderToStaticMarkup(
      <Map state={stateWith({ sectorDominance: [44, 44, 44, 44] })} selected={null} rival={null} />,
    );
    expect(html).toContain('fill="var(--asphalt)"');
    expect(html).toContain('fill="var(--chalk)"');
  });

  test('#109: corner labels use their own class, not the one hidden below 700px', () => {
    const html = renderToStaticMarkup(
      <Map state={stateWith({})} selected={null} rival={null} />,
    );
    expect(html).toContain('map-corner-label');
    // Regression guard: the corner <text> must not carry the driver-label
    // class that components.css hides at max-width: 700px.
    const cornerText = html.match(/<text class="map-corner-label"[^>]*>/)?.[0];
    expect(cornerText).toBeDefined();
    expect(cornerText).not.toMatch(/\bmap-label\b/);
  });
});

describe('#104: sector-dominance legend', () => {
  test('renders a text legend naming the dominant team, not colour alone', () => {
    const html = renderToStaticMarkup(
      <Map state={stateWith({ sectorDominance: [44, 44, 44, 44] })} selected={null} rival={null} />,
    );
    expect(html).toContain('tt-legend');
    expect(html).toContain('Mercedes');
  });

  test('renders no legend when there is no sector-dominance data', () => {
    const html = renderToStaticMarkup(
      <Map state={stateWith({ sectorDominance: [] })} selected={null} rival={null} />,
    );
    expect(html).not.toContain('tt-legend');
  });
});
