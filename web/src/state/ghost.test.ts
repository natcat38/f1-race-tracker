// Tests for the overlay maths: delta series, index lookup, per-side driver options
// and the skeleton copy.

import { describe, test, expect } from 'vitest';
import {
  deltaSeries, indexAtTime, driversWithTrace, driverCode, findByCode, overlaySkeletonCopy,
} from './ghost';
import { car } from './testCar';

test('deltaSeries subtracts side B from side A, element-wise', () => {
  // A slower at idx1 (+200ms), faster at idx2 (-100ms)
  expect(deltaSeries([0, 1200, 1900], [0, 1000, 2000])).toEqual([0, 200, -100]);
});

test('deltaSeries clamps to the shorter length', () => {
  // divergent values within the shorter length, so this also pins direction
  expect(deltaSeries([0, 150, 300], [0, 100])).toEqual([0, 50]);
});

test('deltaSeries works for two drivers pulled from one session (scenario b)', () => {
  // The load-bearing fact of ADR-0009: both traces come out of ONE snapshot's
  // lapTrace map, and the subtraction neither knows nor cares.
  const lapTrace: Record<number, number[]> = {
    1: [0, 1000, 2000, 3000],   // VER
    16: [0, 1100, 1950, 3200],  // LEC
  };
  expect(deltaSeries(lapTrace[1], lapTrace[16])).toEqual([0, -100, 50, -200]);
  // A driver against himself is a flat zero — which is why the UI refuses the pair.
  expect(deltaSeries(lapTrace[1], lapTrace[1])).toEqual([0, 0, 0, 0]);
});

test('indexAtTime returns the largest index reached by t (monotonic trace)', () => {
  const tr = [0, 1000, 2000, 3000];
  expect(indexAtTime(tr, 0)).toBe(0);
  expect(indexAtTime(tr, 1500)).toBe(1);
  expect(indexAtTime(tr, 2000)).toBe(2);
  expect(indexAtTime(tr, 99999)).toBe(3); // clamp at end
  expect(indexAtTime(tr, -5)).toBe(0);    // clamp at start
  expect(indexAtTime([], 500)).toBe(0);   // empty trace -> 0
});

describe('driversWithTrace', () => {
  test('returns the lane\'s driver numbers, ascending', () => {
    expect(driversWithTrace({ 44: [0, 1], 1: [0, 1], 16: [0, 1] })).toEqual([1, 16, 44]);
  });

  test('drops drivers with no usable trace, so a picker never offers an empty overlay', () => {
    expect(driversWithTrace({ 1: [0, 1], 16: [] })).toEqual([1]);
    expect(driversWithTrace({})).toEqual([]);
  });
});

describe('driver code resolution', () => {
  const cars = { 1: car({ driverNum: 1, code: 'VER' }), 16: car({ driverNum: 16, code: 'LEC' }) };

  test('falls back to the car number when a lane has published no abbreviation', () => {
    expect(driverCode(cars, 1)).toBe('VER');
    expect(driverCode({ 5: car({ driverNum: 5, code: '' }) }, 5)).toBe('5');
    expect(driverCode({}, 77)).toBe('77');
  });

  test('findByCode resolves a URL code back to this lane\'s driver number', () => {
    expect(findByCode(cars, [1, 16], 'LEC')).toBe(16);
    expect(findByCode(cars, [1, 16], 'lec')).toBe(16);
    // A driver who was not in this session — a cross-year link to someone off the
    // grid that year — resolves to nothing rather than to the wrong car.
    expect(findByCode(cars, [1, 16], 'HAM')).toBeNull();
    // Only drivers with a trace are candidates.
    expect(findByCode(cars, [1], 'LEC')).toBeNull();
  });
});

describe('overlaySkeletonCopy', () => {
  test('the same driver on both sides is the one problem the user can fix, so it wins', () => {
    expect(overlaySkeletonCopy(true, true, 20, 'live', 'live'))
      .toBe('Both sides are the same lap — pick two different drivers, or a different session.');
    // Even mid-reconnect: the pair is still unusable once the data lands.
    expect(overlaySkeletonCopy(true, false, 0, 'reconnecting', 'live'))
      .toContain('pick two different drivers');
  });

  test('no reference laps once both lanes are loaded', () => {
    expect(overlaySkeletonCopy(false, true, 0, 'live', 'live'))
      .toBe('No driver in this session has a reference lap yet.');
  });

  test('either lane reconnecting wins over the generic loading copy', () => {
    expect(overlaySkeletonCopy(false, false, 0, 'reconnecting', 'connecting'))
      .toBe('Connection lost — retrying automatically…');
    expect(overlaySkeletonCopy(false, false, 0, 'connecting', 'reconnecting'))
      .toBe('Connection lost — retrying automatically…');
  });

  test('still loading otherwise', () => {
    expect(overlaySkeletonCopy(false, false, 0, 'connecting', 'connecting'))
      .toBe('Loading reference laps…');
  });
});
