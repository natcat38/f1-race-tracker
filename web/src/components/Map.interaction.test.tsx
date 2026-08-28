/**
 * Interaction coverage for the track map: the animation loop and the marker
 * updates that static rendering never exercises.
 *
 * useSmoothedCars' rAF loop only exists as a real DOM effect, so whether it
 * starts and stops with `paused`, and whether a new frame actually reaches the
 * marker, are invisible to the SSR render tests (Ghost.render.test.tsx et al).
 *
 * @vitest-environment jsdom
 */

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { Map } from './Map';
import { emptyState, type RaceState } from '../state/race';
import { car } from '../state/testCar';

const TRACK = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];

function stateWith(driverP: { x: number; y: number }, rev: number): RaceState {
  return {
    ...emptyState(),
    rev,
    track: TRACK,
    cars: { 1: car({ driverNum: 1, code: 'VER', p: driverP }) },
  };
}

let rafSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  rafSpy = vi.spyOn(window, 'requestAnimationFrame');
});

afterEach(() => {
  cleanup(); // unmount first: Map's rAF loop only stops via its effect cleanup
  rafSpy.mockRestore();
});

describe('Map + useSmoothedCars effects', () => {
  test('paused never starts the interpolation loop', () => {
    render(<Map state={stateWith({ x: 0.2, y: 0.2 }, 1)} paused selected={null} rival={null} />);
    expect(rafSpy).not.toHaveBeenCalled();
  });

  test('unpaused starts the interpolation loop', () => {
    render(<Map state={stateWith({ x: 0.2, y: 0.2 }, 1)} paused={false} selected={null} rival={null} />);
    expect(rafSpy).toHaveBeenCalled();
  });

  test('a new frame reaches the marker (paused, so no interpolation lag to wait out)', () => {
    const { rerender, container } = render(
      <Map state={stateWith({ x: 0.2, y: 0.2 }, 1)} paused selected={null} rival={null} />,
    );
    const circleAt = () => [...container.querySelectorAll('circle[r="7"]')][0];
    expect(circleAt().getAttribute('cx')).toBe(String(0.2 * 600));

    rerender(<Map state={stateWith({ x: 0.8, y: 0.8 }, 2)} paused selected={null} rival={null} />);
    expect(circleAt().getAttribute('cx')).toBe(String(0.8 * 600));
  });
});
