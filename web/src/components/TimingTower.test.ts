import { describe, it, expect } from 'vitest';
import {
  fmtLap, fmtGap, fmtClock, fmtElapsed, gapLabel, intLabel, lapsDown, bestSectors, orderCars,
  updatePersonalBests, sectorColour, sectorDelta, updateLapHistory, tyreLabel, statusLabel,
  sectorDeltaVs, fmtSigned, updateGapHistory, leaderLapOf, leaderOf, sameRunningOrder,
  personalBestOf, sectorMark,
} from './timingHelpers';
import { car } from '../state/testCar';

describe('fmtLap', () => {
  it('formats ms as m:ss.SSS, dash when absent', () => {
    expect(fmtLap(81234)).toBe('1:21.234');
    expect(fmtLap(undefined)).toBe('—');
    expect(fmtLap(0)).toBe('—');
  });
});

describe('fmtElapsed', () => {
  it('formats a fractional ms (as produced by performance.now() deltas) without leaking decimal digits', () => {
    expect(fmtElapsed(7117.799999998533)).toBe('0:07.117');
  });
  it('formats whole ms as m:ss.SSS', () => {
    expect(fmtElapsed(81234)).toBe('1:21.234');
    expect(fmtElapsed(0)).toBe('0:00.000');
  });
});

describe('fmtGap', () => {
  it('formats seconds as +s.SSS, dash when absent', () => {
    expect(fmtGap(1234)).toBe('+1.234');
    expect(fmtGap(undefined)).toBe('—');
    expect(fmtGap(0)).toBe('—');
  });
});

describe('gapLabel (pit-wall)', () => {
  it('reads LEADER for the leader', () => {
    expect(gapLabel(0, 0, true, false, 90000)).toBe('LEADER');
  });
  it('shows lap deficit when lapped, pluralising', () => {
    expect(gapLabel(92000, 1, false, false, 90000)).toBe('+1 LAP');
    expect(gapLabel(184000, 2, false, false, 90000)).toBe('+2 LAPS');
  });
  it('shows seconds for lead-lap cars', () => {
    // One decimal, not three: the estimate's resolution is ~0.566s (see
    // GAP_RESOLUTION_MS), so the extra digits were invented precision.
    expect(gapLabel(1234, 0, false, false, 90000)).toBe('+1.2');
  });
  it('seconds mode forces seconds even when lapped', () => {
    // ...as m:ss.s, because "+92.000" (and, on a real lapped car, "+643.581")
    // is a number nobody converts to minutes in their head.
    expect(gapLabel(92000, 1, false, true, 90000)).toBe('+1:32.0');
  });
  it('suppresses the gap before the first completed lap', () => {
    expect(gapLabel(1234, 0, false, false, undefined)).toBe('—');
  });
});

describe('intLabel (pit-wall)', () => {
  it('dash for the leader', () => {
    expect(intLabel(0, undefined, 0, true, false, undefined, undefined)).toBe('—');
  });
  it('derives lap deficit from the gapLaps difference', () => {
    expect(intLabel(2, 1, 5000, false, false, 90000, 90000)).toBe('+1 LAP'); // this car 2 down, car ahead 1 down
  });
  it('shows seconds when on the same lap as the car ahead', () => {
    expect(intLabel(1, 1, 800, false, false, 90000, 90000)).toBe('+0.8');
  });
  it('seconds mode forces seconds', () => {
    expect(intLabel(2, 1, 5000, false, true, 90000, 90000)).toBe('+5.0');
  });
  it('suppresses the interval until this car has completed a lap', () => {
    expect(intLabel(1, 1, 800, false, false, undefined, 90000)).toBe('—');
  });
  it('suppresses the interval until the car ahead has completed a lap', () => {
    expect(intLabel(1, 1, 800, false, false, 90000, undefined)).toBe('—');
  });
});

describe('lapsDown', () => {
  it('ignores the lap-number transient when the car is only seconds behind', () => {
    // Leader just crossed the line (lap 17), P2 still on lap 16, 3.4s back.
    expect(lapsDown(1, 3400, 85000)).toBe(0);
  });
  it('keeps a genuine lap down', () => {
    expect(lapsDown(1, 86000, 85000)).toBe(1);
    expect(lapsDown(1, 78000, 85000)).toBe(1); // within the 0.1-lap tolerance
    expect(lapsDown(10, 850000, 85000)).toBe(10);
  });
  it('never exceeds the wire value', () => {
    expect(lapsDown(1, 200000, 85000)).toBe(1);
  });
  it('trusts the wire without a reference lap or a gap', () => {
    expect(lapsDown(2, 5000, undefined)).toBe(2);
    expect(lapsDown(2, undefined, 85000)).toBe(2);
    expect(lapsDown(0, 5000, 85000)).toBe(0);
  });
});

describe('fmtClock', () => {
  it('formats sub-hour as M:SS', () => {
    expect(fmtClock(65000)).toBe('1:05');
    expect(fmtClock(0)).toBe('0:00');
  });
  it('formats over an hour as H:MM:SS', () => {
    expect(fmtClock(4325000)).toBe('1:12:05');
  });
});

describe('orderCars', () => {
  it('sorts by pos', () => {
    const cars = { 1: car({ driverNum: 1, code: 'VER', pos: 2 }), 44: car({ driverNum: 44, code: 'HAM', pos: 1 }) };
    expect(orderCars(cars).map((c) => c.code)).toEqual(['HAM', 'VER']);
  });

  it('breaks a duplicate pos by laps completed, not driver number', () => {
    // The Monza 2024 clip reports TSU and HUL both at pos 19 in every frame,
    // with no 20 — TSU is five laps down. Ascending driver number would put
    // TSU (22) ahead of HUL (27); laps completed puts them in running order.
    const cars = {
      22: car({ driverNum: 22, code: 'TSU', pos: 19, lap: 7 }),
      27: car({ driverNum: 27, code: 'HUL', pos: 19, lap: 12 }),
    };
    expect(orderCars(cars).map((c) => c.code)).toEqual(['HUL', 'TSU']);
  });

  it('falls back to driver number when pos and lap are both tied', () => {
    const cars = {
      27: car({ driverNum: 27, code: 'HUL', pos: 19, lap: 12 }),
      22: car({ driverNum: 22, code: 'TSU', pos: 19, lap: 12 }),
    };
    expect(orderCars(cars).map((c) => c.code)).toEqual(['TSU', 'HUL']);
  });
});

describe('leaderLapOf', () => {
  it('agrees with orderCars[0].lap without sorting', () => {
    const cars = {
      22: car({ driverNum: 22, code: 'TSU', pos: 19, lap: 7 }),
      27: car({ driverNum: 27, code: 'HUL', pos: 19, lap: 12 }),
      1: car({ driverNum: 1, code: 'VER', pos: 3, lap: 11 }),
    };
    expect(leaderLapOf(cars)).toBe(orderCars(cars)[0].lap);
    expect(leaderLapOf(cars)).toBe(11);
  });

  it('returns 0 for a leader on the opening lap, undefined when there is no lap at all', () => {
    // 0 is a real lap number, so callers must guard with != null. Distinguishing
    // the two is the whole point of the undefined return.
    expect(leaderLapOf({ 1: car({ pos: 1, lap: 0 }) })).toBe(0);
    expect(leaderLapOf({ 1: car({ pos: 1 }) })).toBeUndefined();
    expect(leaderLapOf({})).toBeUndefined();
  });
});

describe('leaderOf', () => {
  it('agrees with orderCars[0] — the car the board auto-selects on first paint', () => {
    const cars = {
      22: car({ driverNum: 22, code: 'TSU', pos: 19, lap: 7 }),
      27: car({ driverNum: 27, code: 'HUL', pos: 19, lap: 12 }),
      1: car({ driverNum: 1, code: 'VER', pos: 3, lap: 11 }),
    };
    expect(leaderOf(cars)?.driverNum).toBe(orderCars(cars)[0].driverNum);
    expect(leaderOf(cars)?.code).toBe('VER');
    expect(leaderOf({})).toBeUndefined();
  });
});

describe('sameRunningOrder', () => {
  const a = { 1: car({ driverNum: 1, pos: 1, lap: 10 }), 16: car({ driverNum: 16, pos: 2, lap: 10 }) };

  it('is true for the same values in fresh objects (the 10 Hz no-op frame)', () => {
    expect(sameRunningOrder(a, { ...a, 1: car({ driverNum: 1, pos: 1, lap: 10 }) })).toBe(true);
  });

  it('is false for a position swap that leaves the leader lap unchanged', () => {
    // The staleness this guards: comparing only the leader's lap saw nothing
    // change here, so StintChart's row order froze until the leader next
    // completed a lap.
    const swapped = { 1: car({ driverNum: 1, pos: 2, lap: 10 }), 16: car({ driverNum: 16, pos: 1, lap: 10 }) };
    expect(sameRunningOrder(a, swapped)).toBe(false);
  });

  it('is false when a lap advances, or when the roster changes size', () => {
    expect(sameRunningOrder(a, { ...a, 1: car({ driverNum: 1, pos: 1, lap: 11 }) })).toBe(false);
    expect(sameRunningOrder(a, { ...a, 4: car({ driverNum: 4, pos: 3, lap: 10 }) })).toBe(false);
  });
});

describe('bestSectors', () => {
  it('picks the min positive sector across cars', () => {
    const cars = [car({ s1Ms: 26100 }), car({ s1Ms: 25900 }), car({ s1Ms: 0 })];
    expect(bestSectors(cars)[0]).toBe(25900);
  });
});

describe('updatePersonalBests', () => {
  it('accumulates the per-driver min across frames, ignoring zeros', () => {
    let b = updatePersonalBests({}, [car({ driverNum: 1, s1Ms: 26100, s2Ms: 0, s3Ms: 27000 })]);
    b = updatePersonalBests(b, [car({ driverNum: 1, s1Ms: 25900, s2Ms: 28000, s3Ms: 27500 })]);
    // s1 improved, s2 first real value, s3 kept the faster of the two
    expect(b[1].map((s) => s.best)).toEqual([25900, 28000, 27000]);
  });

  it('counts a changed sector time as a sample, not a frame', () => {
    // The wire re-broadcasts the same sector at 10 Hz between completions; if
    // frames counted, the PB threshold would clear itself in 100ms.
    let b = updatePersonalBests({}, [car({ driverNum: 1, s1Ms: 26100 })]);
    for (let i = 0; i < 20; i++) b = updatePersonalBests(b, [car({ driverNum: 1, s1Ms: 26100 })]);
    expect(b[1][0].samples).toBe(1);
    b = updatePersonalBests(b, [car({ driverNum: 1, s1Ms: 25900 })]);
    expect(b[1][0].samples).toBe(2);
  });
});

describe('personalBestOf', () => {
  it('withholds the personal best until the driver has two times in that sector', () => {
    // The whole point of the threshold: a first observation cannot tie a record
    // it just invented, so it renders neutral rather than green.
    const one = updatePersonalBests({}, [car({ driverNum: 1, s1Ms: 26100 })]);
    expect(personalBestOf(one, 1, 0)).toBe(Infinity);
    expect(sectorColour(26100, 25000, personalBestOf(one, 1, 0))).toBeUndefined();
    expect(sectorMark(26100, 25000, personalBestOf(one, 1, 0))).toBeUndefined();

    const two = updatePersonalBests(one, [car({ driverNum: 1, s1Ms: 25900 })]);
    expect(personalBestOf(two, 1, 0)).toBe(25900);
    expect(sectorColour(25900, 25000, personalBestOf(two, 1, 0))).toBe('var(--good)');
    expect(sectorMark(25900, 25000, personalBestOf(two, 1, 0))).toBe('P');
  });

  it('never withholds the session best — purple outranks the threshold', () => {
    const one = updatePersonalBests({}, [car({ driverNum: 1, s1Ms: 25000 })]);
    expect(sectorColour(25000, 25000, personalBestOf(one, 1, 0))).toBe('var(--best-session)');
    expect(sectorMark(25000, 25000, personalBestOf(one, 1, 0))).toBe('S');
  });

  it('Infinity for a driver or sector with nothing recorded', () => {
    expect(personalBestOf({}, 99, 0)).toBe(Infinity);
  });
});

describe('sectorColour', () => {
  it('purple for session-best, green for personal-best, undefined otherwise', () => {
    expect(sectorColour(25900, 25900, 25900)).toBe('var(--best-session)'); // session-best wins
    expect(sectorColour(26100, 25900, 26100)).toBe('var(--good)'); // personal-best only
    expect(sectorColour(26500, 25900, 26100)).toBeUndefined();
    expect(sectorColour(undefined, 25900, 26100)).toBeUndefined();
  });
});

describe('sectorDelta', () => {
  it('returns the ms above personal best', () => {
    expect(sectorDelta(26100, 25900)).toBe(200);
  });
  it('undefined when the value ties or beats personal best', () => {
    expect(sectorDelta(25900, 25900)).toBeUndefined();
    expect(sectorDelta(25800, 25900)).toBeUndefined();
  });
  it('undefined when there is no personal best yet', () => {
    expect(sectorDelta(26100, Infinity)).toBeUndefined();
  });
  it('undefined when the value is absent or zero', () => {
    expect(sectorDelta(undefined, 25900)).toBeUndefined();
    expect(sectorDelta(0, 25900)).toBeUndefined();
  });
});

describe('tyreLabel', () => {
  it('formats compound letter + age, no space', () => {
    expect(tyreLabel('SOFT', 5)).toBe('S5');
    expect(tyreLabel('MEDIUM', 0)).toBe('M');
  });
  it('dash when no tyre', () => {
    expect(tyreLabel(undefined, 5)).toBe('—');
  });
});

describe('statusLabel', () => {
  it('IN PIT for Pit, OUT for Out, undefined for OnTrack', () => {
    expect(statusLabel('Pit')).toBe('IN PIT');
    expect(statusLabel('Out')).toBe('OUT');
    expect(statusLabel('OnTrack')).toBeUndefined();
  });
});

describe('sectorDeltaVs', () => {
  it('signed ms difference vs a reference sector', () => {
    expect(sectorDeltaVs(26100, 25900)).toBe(200);
    expect(sectorDeltaVs(25700, 25900)).toBe(-200);
  });
  it('undefined when either value is absent or zero', () => {
    expect(sectorDeltaVs(undefined, 25900)).toBeUndefined();
    expect(sectorDeltaVs(26100, undefined)).toBeUndefined();
    expect(sectorDeltaVs(0, 25900)).toBeUndefined();
  });
});

describe('fmtSigned', () => {
  it('formats positive and negative ms with an explicit sign', () => {
    expect(fmtSigned(312)).toBe('+0.312');
    expect(fmtSigned(-145)).toBe('-0.145');
  });
});

describe('updateGapHistory', () => {
  it('appends gapMs once per completed lap', () => {
    let h = updateGapHistory({}, [car({ driverNum: 1, lap: 1, gapMs: 5000 })]);
    h = updateGapHistory(h, [car({ driverNum: 1, lap: 1, gapMs: 5000 })]); // same lap, no-op
    h = updateGapHistory(h, [car({ driverNum: 1, lap: 2, gapMs: 4800 })]); // new lap
    expect(h[1].gaps).toEqual([5000, 4800]);
  });
  it('ignores cars with no lap number yet', () => {
    const h = updateGapHistory({}, [car({ driverNum: 1 })]);
    expect(h[1]).toBeUndefined();
  });
  it('records undefined (not 0) when gapMs is legitimately absent', () => {
    let h = updateGapHistory({}, [car({ driverNum: 1, lap: 1 })]); // no gapMs yet
    h = updateGapHistory(h, [car({ driverNum: 1, lap: 2, gapMs: 4800 })]);
    expect(h[1].gaps).toEqual([undefined, 4800]);
  });
});

describe('updateLapHistory', () => {
  it('records a new lastLapMs the first time it appears', () => {
    const h = updateLapHistory({}, [car({ driverNum: 1, lastLapMs: 81000 })]);
    expect(h[1]).toEqual([81000]);
  });
  it('appends only when lastLapMs actually changes (ignores 10 Hz re-broadcast)', () => {
    let h = updateLapHistory({}, [car({ driverNum: 1, lastLapMs: 81000 })]);
    h = updateLapHistory(h, [car({ driverNum: 1, lastLapMs: 81000 })]); // same value, no new lap
    h = updateLapHistory(h, [car({ driverNum: 1, lastLapMs: 80500 })]); // new lap
    expect(h[1]).toEqual([81000, 80500]);
  });
  it('ignores cars with no lastLapMs yet', () => {
    const h = updateLapHistory({}, [car({ driverNum: 1 })]);
    expect(h[1]).toBeUndefined();
  });
  it('caps history at the last 8 laps', () => {
    let h: ReturnType<typeof updateLapHistory> = {};
    for (let i = 0; i < 10; i++) {
      h = updateLapHistory(h, [car({ driverNum: 1, lastLapMs: 80000 + i })]);
    }
    expect(h[1]).toHaveLength(8);
    expect(h[1][0]).toBe(80002); // oldest two laps (80000, 80001) dropped
    expect(h[1][7]).toBe(80009);
  });
  it('is pure — does not mutate the previous map', () => {
    const prev = { 1: [81000] };
    const next = updateLapHistory(prev, [car({ driverNum: 1, lastLapMs: 80500 })]);
    expect(prev[1]).toEqual([81000]);
    expect(next[1]).toEqual([81000, 80500]);
  });
  it('returns the same reference when no driver\'s history changed (10 Hz no-op tick)', () => {
    const prev = updateLapHistory({}, [car({ driverNum: 1, lastLapMs: 81000 })]);
    const next = updateLapHistory(prev, [car({ driverNum: 1, lastLapMs: 81000 })]);
    expect(next).toBe(prev);
  });
});
