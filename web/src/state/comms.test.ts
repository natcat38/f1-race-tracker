// Tests for the comms cursor: which clips fire, which are skipped as stale, and which
// are allowed.

import { describe, test, expect } from 'vitest';
import { stepComms, isAllowedClip, liveArrivals } from './comms';
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

describe('isAllowedClip', () => {
  test('accepts https formula1.com and subdomains', () => {
    expect(isAllowedClip('https://livetiming.formula1.com/static/x/a.mp3')).toBe(true);
    expect(isAllowedClip('https://formula1.com/a.mp3')).toBe(true);
  });
  test('rejects non-https, other hosts, suffix tricks, and malformed URLs', () => {
    expect(isAllowedClip('http://livetiming.formula1.com/a.mp3')).toBe(false);
    expect(isAllowedClip('https://evil.example.com/a.mp3')).toBe(false);
    expect(isAllowedClip('https://notformula1.com/a.mp3')).toBe(false);
    expect(isAllowedClip('javascript:alert(1)')).toBe(false);
    expect(isAllowedClip('not a url')).toBe(false);
  });
});

describe('liveArrivals', () => {
  const refs = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ timeMs: i, driverNum: i, clip: `https://livetiming.formula1.com/${i}.mp3` }));

  test('a frame fires only the refs appended since last step', () => {
    expect(liveArrivals(refs(3), 1, false)).toEqual(refs(3).slice(1));
  });
  test('a snapshot fires nothing — its refs are history, seeded by stepComms', () => {
    expect(liveArrivals(refs(3), 0, true)).toEqual([]);
  });
  test('no growth fires nothing, and a shrunk timeline never slices backwards', () => {
    expect(liveArrivals(refs(2), 2, false)).toEqual([]);
    expect(liveArrivals(refs(1), 5, false)).toEqual([]);
  });
});

describe('live arrivals vs the clock window', () => {
  test('a low-lag clip matches both paths, so callers must fire it once', () => {
    // Regression note for useComms: stepComms and liveArrivals CAN both return the
    // same clip when it is published within one frame interval of being spoken.
    const clock = 1_000_000_000_000;
    const clip = { timeMs: clock + 500, driverNum: 1, clip: 'https://livetiming.formula1.com/a.mp3' };
    const clockFired = stepComms({ lastClock: clock }, clock + 1000, [clip], false).fired;
    const arrived = liveArrivals([clip], 0, false);
    expect(clockFired).toEqual([clip]);
    expect(arrived).toEqual([clip]);
    const fired = [...clockFired.filter((m) => !arrived.includes(m)), ...arrived];
    expect(fired).toHaveLength(1);
  });
});
