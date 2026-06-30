import { describe, test, expect } from 'vitest';
import { stepComms } from './comms';
import type { RadioMessage } from './race';

const tl: RadioMessage[] = [
  { timeMs: 100, driverNum: 1, clip: 'a' },
  { timeMs: 200, driverNum: 16, clip: 'b' },
  { timeMs: 5000, driverNum: 4, clip: 'c' },
];

describe('stepComms', () => {
  test('init from snapshot: earlier messages are history, not fired', () => {
    const { cursor, fired, history } = stepComms({ lastClock: -1 }, 150, tl, true);
    expect(fired).toEqual([]);                 // nothing auto-plays on connect
    expect(history.map((m) => m.driverNum)).toEqual([1]); // 100 <= 150 -> history
    expect(cursor.lastClock).toBe(150);
  });

  test('steady state fires messages crossed since lastClock', () => {
    const { cursor, fired } = stepComms({ lastClock: 150 }, 250, tl, false);
    expect(fired.map((m) => m.driverNum)).toEqual([16]); // 150 < 200 <= 250
    expect(cursor.lastClock).toBe(250);
  });

  test('loop (clock jumps back) resets cursor without firing', () => {
    const { cursor, fired } = stepComms({ lastClock: 5000 }, 120, tl, false);
    expect(fired).toEqual([]);
    expect(cursor.lastClock).toBe(120);
  });

  test('multiple crossed in one step fire in time order', () => {
    const { fired } = stepComms({ lastClock: 50 }, 250, tl, false);
    expect(fired.map((m) => m.timeMs)).toEqual([100, 200]);
  });
});
