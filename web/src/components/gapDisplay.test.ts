import { describe, it, expect } from 'vitest';
import {
  fmtGapEstimate, fmtLongGap, median, updateGapSmoothing, displayGaps, holdOrder,
  hasNoData, needsDriverTag, axisTicks, GAP_WINDOW, GAP_HYSTERESIS_MS, settle,
  type GapSmoothing,
} from './timingHelpers';
import { car } from '../state/testCar';

// The Gap column was the one thing a cold reader checks for correctness, and it
// failed on both counts: it printed three decimals for a quantity the estimator
// knows to about half a second, and it could show P4 closer to the leader than
// P3. Both are display problems — the wire is unchanged by any of this.

describe('gap formatting at the estimate’s real resolution', () => {
  it('renders a derived gap to one decimal, not three', () => {
    expect(fmtGapEstimate(7364)).toBe('+7.4');
    expect(fmtGapEstimate(566)).toBe('+0.6');
  });

  it('renders absent and zero gaps as an em-dash, like the exact formatters do', () => {
    expect(fmtGapEstimate(undefined)).toBe('—');
    expect(fmtGapEstimate(0)).toBe('—');
  });

  it('renders a lapped car’s deficit as minutes, not raw seconds', () => {
    // "+643.581" is what "Gaps in seconds" used to print for a lapped car.
    expect(fmtLongGap(643581)).toBe('+10:43.6');
    // Zero-padded so the column stays aligned.
    expect(fmtLongGap(63000)).toBe('+1:03.0');
  });

  it('falls back to plain seconds below a minute', () => {
    expect(fmtLongGap(5000)).toBe('+5.0');
  });
});

describe('median', () => {
  it('is the middle sample, and rejects a single outlier rather than smearing it', () => {
    expect(median([1, 2, 3])).toBe(2);
    // A mean would be dragged to 20.6 by the hop; the median ignores it.
    expect(median([1, 2, 3, 4, 93])).toBe(3);
  });

  it('averages the two middles on an even window, and has no value for none', () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([])).toBeUndefined();
  });
});

describe('updateGapSmoothing', () => {
  it('keeps only the most recent GAP_WINDOW readings per driver', () => {
    let sm: GapSmoothing = {};
    for (let i = 1; i <= GAP_WINDOW + 3; i++) {
      sm = updateGapSmoothing(sm, [car({ driverNum: 4, gapMs: i * 100, intMs: i })]);
    }
    expect(sm[4].gaps).toHaveLength(GAP_WINDOW);
    expect(sm[4].gaps[GAP_WINDOW - 1]).toBe((GAP_WINDOW + 3) * 100);
  });

  it('returns the same object when no car carried a gap, so the caller can bail out', () => {
    const prev = {};
    expect(updateGapSmoothing(prev, [car({ driverNum: 1 })])).toBe(prev);
  });
});

describe('settle', () => {
  it('takes the median when nothing is shown yet', () => {
    expect(settle([3399, 3965, 3399], undefined)).toBe(3399);
  });

  it('holds the printed value while the median only wobbles', () => {
    // A stationary gap wanders across ~two resolution steps on the running
    // board, which repainted the column several times a second.
    expect(settle([3965, 3965, 3399], 3399)).toBe(3399);
  });

  it('follows the median once it has really moved', () => {
    const moved = 3399 + GAP_HYSTERESIS_MS + 100;
    expect(settle([moved, moved, moved], 3399)).toBe(moved);
  });

  it('keeps showing the last known value when the window empties', () => {
    expect(settle([], 3399)).toBe(3399);
  });
});

describe('displayGaps', () => {
  const order = [
    car({ driverNum: 1, pos: 1 }),
    car({ driverNum: 4, pos: 2, gapMs: 7364 }),
    car({ driverNum: 16, pos: 3, gapMs: 3965 }),
  ];

  it('leaves the leader without a number — their row reads LEADER', () => {
    expect(displayGaps(order, {})[0]).toEqual({});
  });

  it('never shows a car behind as closer to the leader than the car ahead', () => {
    // The exact contradiction the review caught live: P3 +7.364, P4 +3.965.
    const out = displayGaps(order, {});
    expect(out[2].gapMs).toBeGreaterThanOrEqual(out[1].gapMs!);
  });

  it('derives the interval from the reconciled gaps, so the two columns agree', () => {
    const out = displayGaps(
      [car({ driverNum: 1, pos: 1 }), car({ driverNum: 4, pos: 2, gapMs: 2000 }),
        car({ driverNum: 16, pos: 3, gapMs: 5000 })],
      {},
    );
    expect(out[1]).toEqual({ gapMs: 2000, intMs: 2000 });
    expect(out[2]).toEqual({ gapMs: 5000, intMs: 3000 });
  });

  it('smooths a hopped reading out of the displayed value', () => {
    // Steady readings with one hop of a full resolution step: the display must
    // not follow the hop.
    let sm: GapSmoothing = {};
    for (const g of [3399, 3399, 3965, 3399, 3399]) {
      sm = updateGapSmoothing(sm, [car({ driverNum: 4, pos: 2, gapMs: g })]);
    }
    const out = displayGaps([car({ driverNum: 1, pos: 1 }), car({ driverNum: 4, pos: 2, gapMs: 3965 })], sm);
    expect(out[1].gapMs).toBe(3399);
  });
});

describe('holdOrder', () => {
  const live = [car({ driverNum: 16, pos: 1 }), car({ driverNum: 4, pos: 2 }), car({ driverNum: 1, pos: 3 })];

  it('replays a captured sequence over this frame’s cars', () => {
    expect(holdOrder(live, [1, 4, 16]).map((c) => c.driverNum)).toEqual([1, 4, 16]);
  });

  it('never drops a car that was not in the captured sequence', () => {
    // A held order that hid a row would be worse than the reorder it prevents.
    const out = holdOrder(live, [4]);
    expect(out.map((c) => c.driverNum)).toEqual([4, 16, 1]);
  });
});

describe('hasNoData', () => {
  it('is true only for a car the feed has said nothing about', () => {
    expect(hasNoData(car({ driverNum: 10 }))).toBe(true);
    expect(hasNoData(car({ driverNum: 10, lastLapMs: 85000 }))).toBe(false);
    expect(hasNoData(car({ driverNum: 10, gapMs: 0 }))).toBe(false); // 0 is a real gap
  });
});

describe('needsDriverTag', () => {
  it('does not re-append a code the message already carries', () => {
    expect(needsDriverTag('WAVED BLUE FLAG FOR CAR 31 (OCO)', 'OCO', 31)).toBe(false);
  });

  it('matches on the car number too, since the feed uses either', () => {
    expect(needsDriverTag('CAR 31 TIME DELETED', 'OCO', 31)).toBe(false);
    // ...but not on a number that merely contains it.
    expect(needsDriverTag('CAR 311 TIME DELETED', 'OCO', 31)).toBe(true);
  });

  it('appends when the message names nobody', () => {
    expect(needsDriverTag('TRACK LIMITS', 'OCO', 31)).toBe(true);
  });
});

describe('axisTicks', () => {
  it('always labels the first and last lap', () => {
    const t = axisTicks(53);
    expect(t[0]).toBe(1);
    expect(t[t.length - 1]).toBe(53);
  });

  it('steps by ten over a grand prix and by five over a sprint', () => {
    expect(axisTicks(53)).toEqual([1, 10, 20, 30, 40, 53]);
    expect(axisTicks(20)).toEqual([1, 5, 10, 15, 20]);
  });

  it('degenerates safely for a session with no lap count', () => {
    expect(axisTicks(1)).toEqual([1]);
    expect(axisTicks(0)).toEqual([1]);
  });
});
