// @vitest-environment jsdom
//
// The one interaction TelemetryPanel actually owns: picking a rival from the
// "Compare with" select. This is a controlled component (rival/onRivalChange are
// props), so a real user event has to round-trip through a small stateful
// harness — the same shape App.tsx itself uses — to prove the readout actually
// updates rather than just that onRivalChange fires with the right value.

import { describe, test, expect, afterEach } from 'vitest';
import { useState } from 'react';
import { render, cleanup, fireEvent, screen } from '@testing-library/react';
import { TelemetryPanel } from './TelemetryPanel';
import { emptyState, type RaceState } from '../state/race';
import { car } from '../state/testCar';

const state: RaceState = {
  ...emptyState(),
  rev: 1,
  cars: {
    1: car({ driverNum: 1, code: 'VER', team: 'Red Bull', speed: 300 }),
    16: car({ driverNum: 16, code: 'LEC', team: 'Ferrari', speed: 295 }),
  },
};

function Harness() {
  const [rival, setRival] = useState<number | null>(null);
  return (
    <TelemetryPanel
      state={state}
      lapHistory={{}}
      gapHistory={{}}
      selected={1}
      rival={rival}
      onRivalChange={setRival}
    />
  );
}

afterEach(cleanup);

describe('TelemetryPanel rival selection', () => {
  test('choosing a rival in the dropdown renders their telemetry, not just VER twice', () => {
    render(<Harness />);
    expect(screen.queryByText('295')).toBeNull();

    fireEvent.change(screen.getByLabelText(/compare with/i), { target: { value: '16' } });

    // The second card is real, driver-specific data — the string coercion in
    // TelemetryPanel's onChange (`Number(e.target.value)`) has to land on the
    // right key in state.cars, or this silently renders nothing new.
    expect(screen.getByText('295')).not.toBeNull();
    expect(screen.getByText('Rival')).not.toBeNull();
  });

  test('clearing the dropdown drops the rival card again', () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText(/compare with/i), { target: { value: '16' } });
    expect(screen.getByText('295')).not.toBeNull();

    fireEvent.change(screen.getByLabelText(/compare with/i), { target: { value: '' } });
    expect(screen.queryByText('295')).toBeNull();
  });
});
