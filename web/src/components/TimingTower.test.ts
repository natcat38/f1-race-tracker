import { describe, it, expect } from 'vitest';
import {
  fmtLap, fmtGap, fmtClock, fmtElapsed, gapLabel, intLabel, bestSectors, orderCars,
  updatePersonalBests, sectorColour, sectorDelta, updateLapHistory, tyreLabel, statusLabel,
  sectorDeltaVs, fmtSigned, updateGapHistory,
} from './timingHelpers';
import type { Car } from '../state/race';

const car = (over: Partial<Car>): Car => ({
  driverNum: 1, code: 'VER', team: 'Red Bull', pos: 1, p: { x: 0, y: 0 }, status: 'OnTrack', ...over,
});

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
    expect(gapLabel(1234, 0, false, false, 90000)).toBe('+1.234');
  });
  it('seconds mode forces seconds even when lapped', () => {
    expect(gapLabel(92000, 1, false, true, 90000)).toBe('+92.000');
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
    expect(intLabel(1, 1, 800, false, false, 90000, 90000)).toBe('+0.800');
  });
  it('seconds mode forces seconds', () => {
    expect(intLabel(2, 1, 5000, false, true, 90000, 90000)).toBe('+5.000');
  });
  it('suppresses the interval until this car has completed a lap', () => {
    expect(intLabel(1, 1, 800, false, false, undefined, 90000)).toBe('—');
  });
  it('suppresses the interval until the car ahead has completed a lap', () => {
    expect(intLabel(1, 1, 800, false, false, 90000, undefined)).toBe('—');
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
    expect(b[1]).toEqual([25900, 28000, 27000]); // s1 improved, s2 first real value, s3 kept faster
  });
});

describe('sectorColour', () => {
  it('purple for session-best, green for personal-best, undefined otherwise', () => {
    expect(sectorColour(25900, 25900, 25900)).toBe('#b14aff'); // session-best wins
    expect(sectorColour(26100, 25900, 26100)).toBe('#3bb273'); // personal-best only
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
