import { describe, it, expect, test } from 'vitest';
import { emptyState, applyMessage, parseMsg, type RaceState } from './race';

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

describe('parseMsg', () => {
  it('accepts a well-formed snapshot message', () => {
    const raw = { type: 'snapshot', data: { session: 'x', mode: 'replay', label: 'L', cars: {}, timeMs: 0, rev: 1 } };
    expect(parseMsg(raw)).toEqual(raw);
  });

  it('accepts a well-formed frame message', () => {
    const raw = { type: 'frame', data: { rev: 2, timeMs: 100, cars: [] } };
    expect(parseMsg(raw)).toEqual(raw);
  });

  it('rejects null and non-objects', () => {
    expect(parseMsg(null)).toBeNull();
    expect(parseMsg('snapshot')).toBeNull();
    expect(parseMsg(42)).toBeNull();
  });

  it('rejects a missing or unknown type', () => {
    expect(parseMsg({ data: {} })).toBeNull();
    expect(parseMsg({ type: 'error', data: {} })).toBeNull();
  });

  it('rejects a snapshot missing required fields', () => {
    expect(parseMsg({ type: 'snapshot', data: { session: 'x', mode: 'replay', label: 'L', timeMs: 0, rev: 1 } })).toBeNull(); // no cars
    expect(parseMsg({ type: 'snapshot' })).toBeNull(); // no data at all
  });

  it('rejects a frame with the wrong field types', () => {
    expect(parseMsg({ type: 'frame', data: { rev: '2', timeMs: 100, cars: [] } })).toBeNull(); // rev as string
    expect(parseMsg({ type: 'frame', data: { rev: 2 } })).toBeNull(); // no timeMs
  });

  it('rejects a frame whose cars/messages are present but not arrays', () => {
    expect(parseMsg({ type: 'frame', data: { rev: 2, timeMs: 100, cars: {} } })).toBeNull();
    expect(parseMsg({ type: 'frame', data: { rev: 2, timeMs: 100, messages: 'x' } })).toBeNull();
  });

  it('rejects a snapshot whose array fields are the wrong type', () => {
    const base = { session: 'x', mode: 'replay', label: 'L', cars: {}, timeMs: 0, rev: 1 };
    expect(parseMsg({ type: 'snapshot', data: { ...base, messages: 'x' } })).toBeNull();
    expect(parseMsg({ type: 'snapshot', data: { ...base, radio: {} } })).toBeNull();
    expect(parseMsg({ type: 'snapshot', data: { ...base, track: 'nope' } })).toBeNull();
    expect(parseMsg({ type: 'snapshot', data: { ...base, cars: [] } })).toBeNull(); // array cars is wrong shape for a snapshot
  });
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
  it('accumulates frame radio refs onto state (ADR-0008)', () => {
    const s0 = applyMessage(emptyState(), {
      type: 'snapshot',
      data: {
        session: 'live', mode: 'live', label: 'L', cars: {}, timeMs: 0, rev: 1,
        radio: [{ timeMs: 100, driverNum: 1, clip: 'https://livetiming.formula1.com/a.mp3' }],
      },
    });
    const s1 = applyMessage(s0, {
      type: 'frame',
      data: {
        rev: 2, timeMs: 200, cars: [],
        radio: [{ timeMs: 150, driverNum: 16, clip: 'https://livetiming.formula1.com/b.mp3' }],
      },
    });
    expect(s1.radio).toHaveLength(2);
    expect(s1.radio[1].driverNum).toBe(16);
    // A frame without radio leaves the accumulated list untouched (same reference).
    const s2 = applyMessage(s1, { type: 'frame', data: { rev: 3, timeMs: 300, cars: [] } });
    expect(s2.radio).toBe(s1.radio);
  });

  it('rejects a frame whose radio is not an array', () => {
    expect(parseMsg({ type: 'frame', data: { rev: 2, timeMs: 200, radio: 'nope' } })).toBeNull();
  });

  it('rejects radio elements that are not real refs (useComms holds them by identity)', () => {
    const frame = (radio: unknown) => parseMsg({ type: 'frame', data: { rev: 2, timeMs: 200, radio } });
    expect(frame(['oops'])).toBeNull();
    expect(frame([null])).toBeNull();
    expect(frame([{ timeMs: 1, driverNum: 1 }])).toBeNull();          // no clip
    expect(frame([{ timeMs: '1', driverNum: 1, clip: 'x' }])).toBeNull(); // wrong type
    expect(frame([])).not.toBeNull();
    expect(frame([{ timeMs: 1, driverNum: 1, clip: 'https://livetiming.formula1.com/a.mp3' }]))
      .not.toBeNull();
  });
});

// The replay clip is a fixed-length recording on repeat. When it wraps, the clock
// jumps backwards and everything accumulated per play-through has to go with it —
// otherwise the race-control feed fills with duplicates in an order that is
// neither chronological nor newest-first, which is what the UX review found live.
describe('clip loop detection', () => {
  const frame = (rev: number, timeMs: number, messages?: { rev: number; t: number; category: string; message: string }[]) =>
    ({ type: 'frame' as const, data: { rev, timeMs, messages } });

  const withClock = (timeMs: number) => {
    const s = applyMessage(emptyState(), snapMsg);
    return applyMessage(s, frame(10, timeMs, [{ rev: 10, t: timeMs, category: 'Flag', message: 'GREEN FLAG' }]));
  };

  it('bumps loopSeq and drops the previous pass’s messages when the clock rewinds', () => {
    const s = withClock(600000);
    expect(s.messages).toHaveLength(1);
    // Rev keeps climbing across a loop (the player bumps it), so a decreasing
    // timeMs is the only signal there is — the same one internal/model/apply.go
    // uses server-side.
    const looped = applyMessage(s, frame(11, 1000, [{ rev: 11, t: 1000, category: 'Flag', message: 'GREEN FLAG' }]));
    expect(looped.loopSeq).toBe(1);
    expect(looped.messages).toHaveLength(1);
    expect(looped.messages[0].t).toBe(1000);
  });

  it('clears the buffer even when the restarting frame carries no messages', () => {
    const s = withClock(600000);
    const looped = applyMessage(s, frame(11, 1000));
    expect(looped.messages).toHaveLength(0);
  });

  it('does not call a frame arriving slightly out of order a loop', () => {
    const s = withClock(600000);
    const jitter = applyMessage(s, frame(11, 599900));
    expect(jitter.loopSeq).toBe(0);
    expect(jitter.messages).toHaveLength(1);
  });

  it('does not call a fresh snapshot a loop', () => {
    // A reconnect mid-clip rebases the clock downwards, and that is a new
    // baseline rather than a wrap — anything watching loopSeq (the tower's
    // personal bests, the board's notice) must not fire on it.
    const s = withClock(600000);
    const resnap = applyMessage(s, snapMsg);
    expect(resnap.loopSeq).toBe(0);
  });
});
