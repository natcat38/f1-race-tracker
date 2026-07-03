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

test('snapshot carries lapTrace; emptyState defaults it', () => {
  expect(emptyState().lapTrace).toEqual({});
  const s = applyMessage(emptyState(), {
    type: 'snapshot',
    data: {
      session: 'compare-monza-2024', mode: 'replay', label: 'Monza',
      track: [], cars: {}, timeMs: 0, rev: 1,
      lapTrace: { 1: [0, 100, 200] },
    },
  });
  expect(s.lapTrace[1]).toEqual([0, 100, 200]);
});

test('snapshotSeq increments on every snapshot but not on frames', () => {
  // Lets consumers (useComms) tell a reconnect/fresh-connect snapshot apart from
  // steady-state frames, instead of relying on "have I ever seen a rev yet".
  const s0 = emptyState();
  expect(s0.snapshotSeq).toBe(0);
  const s1 = applyMessage(s0, {
    type: 'snapshot',
    data: { session: 'replay', mode: 'replay', label: 'M', cars: {}, timeMs: 0, rev: 5 },
  });
  expect(s1.snapshotSeq).toBe(1);
  const s2 = applyMessage(s1, { type: 'frame', data: { rev: 6, timeMs: 100, cars: [] } });
  expect(s2.snapshotSeq).toBe(1); // frame does not bump it
  // A second snapshot (e.g. a reconnect) bumps it again, even if rev goes backwards.
  const s3 = applyMessage(s2, {
    type: 'snapshot',
    data: { session: 'replay', mode: 'replay', label: 'M', cars: {}, timeMs: 0, rev: 1 },
  });
  expect(s3.snapshotSeq).toBe(2);
});

test('a frame does not clobber lapTrace', () => {
  const s0 = applyMessage(emptyState(), {
    type: 'snapshot',
    data: {
      session: 'compare-monza-2024', mode: 'replay', label: 'Monza', cars: {}, timeMs: 0, rev: 1,
      lapTrace: { 1: [0, 100, 200] },
    },
  });
  const s1 = applyMessage(s0, { type: 'frame', data: { rev: 2, timeMs: 100, cars: [] } });
  expect(s1.lapTrace[1]).toEqual([0, 100, 200]);
});

describe('race-control messages', () => {
  it('emptyState starts with no messages', () => {
    expect(emptyState().messages).toEqual([]);
  });

  it('a snapshot carries its messages', () => {
    const s = applyMessage(emptyState(), {
      type: 'snapshot',
      data: {
        session: 'replay', mode: 'replay', label: 'M', cars: {}, timeMs: 0, rev: 1,
        messages: [{ rev: 1, t: 0, category: 'Flag', message: 'GREEN FLAG' }],
      },
    });
    expect(s.messages).toHaveLength(1);
    expect(s.messages[0].message).toBe('GREEN FLAG');
  });

  it('a frame appends messages without clobbering existing ones', () => {
    const s0 = applyMessage(emptyState(), {
      type: 'snapshot',
      data: {
        session: 'replay', mode: 'replay', label: 'M', cars: {}, timeMs: 0, rev: 1,
        messages: [{ rev: 1, t: 0, category: 'Flag', message: 'GREEN FLAG' }],
      },
    });
    const s1 = applyMessage(s0, {
      type: 'frame',
      data: { rev: 2, timeMs: 100, cars: [], messages: [{ rev: 2, t: 100, category: 'Flag', message: 'YELLOW FLAG', driver: 44 }] },
    });
    expect(s1.messages).toHaveLength(2);
    expect(s1.messages[1]).toEqual({ rev: 2, t: 100, category: 'Flag', message: 'YELLOW FLAG', driver: 44 });
  });

  it('a frame with no messages leaves the list unchanged', () => {
    const s0 = applyMessage(emptyState(), {
      type: 'snapshot',
      data: {
        session: 'replay', mode: 'replay', label: 'M', cars: {}, timeMs: 0, rev: 1,
        messages: [{ rev: 1, t: 0, category: 'Flag', message: 'GREEN FLAG' }],
      },
    });
    const s1 = applyMessage(s0, { type: 'frame', data: { rev: 2, timeMs: 100, cars: [] } });
    expect(s1.messages).toEqual(s0.messages);
  });

  it('caps the rolling message buffer at 30, mirroring internal/model/apply.go', () => {
    let s = applyMessage(emptyState(), {
      type: 'snapshot',
      data: { session: 'replay', mode: 'replay', label: 'M', cars: {}, timeMs: 0, rev: 1 },
    });
    for (let i = 0; i < 35; i++) {
      s = applyMessage(s, {
        type: 'frame',
        data: { rev: 2 + i, timeMs: i, cars: [], messages: [{ rev: 2 + i, t: i, category: 'Flag', message: `msg-${i}` }] },
      });
    }
    expect(s.messages).toHaveLength(30);
    expect(s.messages[0].message).toBe('msg-5'); // oldest 5 dropped
    expect(s.messages[29].message).toBe('msg-34');
  });
});
