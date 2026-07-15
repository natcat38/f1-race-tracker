import { describe, it, expect } from 'vitest';
import { fmtLap, fmtGap, fmtClock, gapLabel, intLabel, bestSectors, orderCars, updatePersonalBests, sectorColour } from './timingHelpers';
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
