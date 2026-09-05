// Render tests for TelemetryPanel's distance-trace SVGs (throttle/brake/gear):
// covers the pickThrottle/pickBrake/pickGear + toPolyline path (#121) and the
// derived-summary aria-label that replaces the bare "<label> over lap
// distance" text alternative (#106).

import { describe, test, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { TelemetryPanel } from './TelemetryPanel';
import { emptyState, type RaceState } from '../state/race';
import { car } from '../state/testCar';

function stateWithTraces(pedalTraces: RaceState['pedalTraces']): RaceState {
  return {
    ...emptyState(),
    cars: { 1: car({ driverNum: 1, code: 'VER' }) },
    pedalTraces,
  };
}

function render(state: RaceState) {
  return renderToStaticMarkup(
    <TelemetryPanel state={state} lapHistory={{}} gapHistory={{}} selected={1} rival={null} />,
  );
}

describe('TelemetryPanel distance trace', () => {
  test('draws throttle/brake/gear polylines and a summarised aria-label for equal-length samples', () => {
    const html = render(stateWithTraces({
      1: { throttle: [0, 50, 100], brake: [100, 50, 0], gear: [1, 4, 8] },
    }));
    expect(html).toContain('Throttle over lap distance: ranging 0 to 100, ending at 100');
    expect(html).toContain('Brake over lap distance: ranging 0 to 100, ending at 0');
    // Gear as integer steps: min/max/last should read as whole numbers, not 8.0.
    expect(html).toContain('Gear over lap distance: ranging 1 to 8, ending at 8');
    expect(html).toMatch(/<polyline[^>]*points="0\.00,28\.00 50\.00,14\.00 100\.00,0\.00"/);
  });

  test('does not crash when the two cars have mismatched trace lengths', () => {
    const html = renderToStaticMarkup(
      <TelemetryPanel
        state={{
          ...emptyState(),
          cars: {
            1: car({ driverNum: 1, code: 'VER' }),
            16: car({ driverNum: 16, code: 'LEC' }),
          },
          pedalTraces: {
            1: { throttle: [0, 50, 100], brake: [0, 0, 0], gear: [1, 2, 3] },
            16: { throttle: [10, 90], brake: [0, 0], gear: [2, 2] },
          },
        }}
        lapHistory={{}}
        gapHistory={{}}
        selected={1}
        rival={16}
      />,
    );
    expect(html).toContain('Throttle over lap distance');
    expect(html).toContain('LEC');
  });

  test('does not crash on NaN/undefined samples, and excludes them from the summary', () => {
    const html = render(stateWithTraces({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- deliberately malformed samples
      1: { throttle: [0, NaN, undefined as any, 100], brake: [0, 0, 0, 0], gear: [1, 1, 1, 1] },
    }));
    expect(html).toContain('Throttle over lap distance: ranging 0 to 100, ending at 100');
  });

  test('renders "no data" summary and no crash for an empty trace array', () => {
    const html = render(stateWithTraces({
      1: { throttle: [], brake: [], gear: [] },
    }));
    expect(html).toContain('Throttle over lap distance: no data');
    expect(html).toContain('Brake over lap distance: no data');
    expect(html).toContain('Gear over lap distance: no data');
  });

  test('renders nothing distance-trace-related when the selected car has no pedal trace', () => {
    const html = render(stateWithTraces({}));
    expect(html).not.toContain('over lap distance');
  });
});
