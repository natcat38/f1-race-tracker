import { describe, it, expect, test } from 'vitest';
import { emptyState, applyMessage, type RaceState } from './race';

const snapMsg = {
  type: 'snapshot' as const,
  data: { session: 'demo', mode: 'replay', label: 'Synthetic', track: [{ x: 0, y: 0 }], cars: { 1: { driverNum: 1, code: 'VER', team: 'Red Bull', pos: 1, p: { x: 0.5, y: 0.5 }, status: 'OnTrack' } }, timeMs: 0, rev: 3 },
};

describe('applyMessage', () => {
  it('loads a snapshot', () => {
    const s = applyMessage(emptyState(), snapMsg);
    expect(s.rev).toBe(3);
    expect(s.cars[1].code).toBe('VER');
    expect(s.track.length).toBe(1);
  });

  it('applies a newer frame and ignores a stale one', () => {
    let s: RaceState = applyMessage(emptyState(), snapMsg);
    s = applyMessage(s, { type: 'frame' as const, data: { rev: 4, timeMs: 100, cars: [{ driverNum: 1, code: 'VER', team: 'Red Bull', pos: 1, p: { x: 0.6, y: 0.5 }, status: 'OnTrack' }] } });
    expect(s.cars[1].p.x).toBe(0.6);
    const stale = applyMessage(s, { type: 'frame' as const, data: { rev: 4, timeMs: 100, cars: [{ driverNum: 1, code: 'XXX', team: 'Red Bull', pos: 1, p: { x: 0, y: 0 }, status: 'OnTrack' }] } });
    expect(stale.cars[1].code).toBe('VER'); // unchanged
  });
});

describe('timing fields', () => {
  it('folds a frame carrying timing fields into the car', () => {
    const s0 = applyMessage(emptyState(), {
      type: 'snapshot',
      data: { session: 'replay', mode: 'replay', label: 'x', cars: {}, timeMs: 0, rev: 1 },
    });
    const s1 = applyMessage(s0, {
      type: 'frame',
      data: {
        rev: 2, timeMs: 100,
        cars: [{
          driverNum: 1, code: 'VER', team: 'Red Bull', pos: 1,
          p: { x: 0.5, y: 0.5 }, status: 'OnTrack',
          tyre: 'SOFT', tyreAge: 12, lastLapMs: 81234, bestLapMs: 80950,
          s1Ms: 26100, s2Ms: 28200, s3Ms: 26900, gapMs: 0, gapLaps: 0, intMs: 0,
          speed: 312, gear: 7, throttle: 100, brake: 0, drs: true,
        }],
      },
    });
    expect(s1.cars[1].lastLapMs).toBe(81234);
    expect(s1.cars[1].tyre).toBe('SOFT');
    expect(s1.cars[1].drs).toBe(true);
  });
});

test('snapshot carries the radio timeline', () => {
  const s = applyMessage(emptyState(), {
    type: 'snapshot',
    data: {
      session: 'replay', mode: 'replay', label: 'M', cars: {}, timeMs: 3300000, rev: 1,
      radio: [{ timeMs: 3300500, driverNum: 1, clip: 'https://x/VER.mp3' }],
    },
  });
  expect(s.radio).toHaveLength(1);
  expect(s.radio[0].driverNum).toBe(1);
});

test('a frame does not clobber the radio timeline', () => {
  const s0 = applyMessage(emptyState(), {
    type: 'snapshot',
    data: {
      session: 'replay', mode: 'replay', label: 'M', cars: {}, timeMs: 3300000, rev: 1,
      radio: [{ timeMs: 3300500, driverNum: 1, clip: 'https://x/VER.mp3' }],
    },
  });
  const s1 = applyMessage(s0, { type: 'frame', data: { rev: 2, timeMs: 3300100, cars: [] } });
  expect(s1.radio).toHaveLength(1);
});
