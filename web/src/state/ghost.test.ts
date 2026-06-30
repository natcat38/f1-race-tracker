import { test, expect } from 'vitest';
import { deltaSeries, indexAtTime, commonDrivers } from './ghost';

test('deltaSeries subtracts last-year from this-year, element-wise', () => {
  // this year slower at idx1 (+200ms), faster at idx2 (-100ms)
  expect(deltaSeries([0, 1200, 1900], [0, 1000, 2000])).toEqual([0, 200, -100]);
});

test('deltaSeries clamps to the shorter length', () => {
  // divergent values within the shorter length, so this also pins direction
  expect(deltaSeries([0, 150, 300], [0, 100])).toEqual([0, 50]);
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

test('commonDrivers returns sorted numeric keys present in both', () => {
  expect(commonDrivers({ 1: [], 16: [], 44: [] }, { 16: [], 1: [] })).toEqual([1, 16]);
  expect(commonDrivers({}, { 1: [] })).toEqual([]);
});
