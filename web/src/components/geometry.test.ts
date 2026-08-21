// Tests that track outlines are letterboxed into the square viewBox without distortion.

import { describe, it, expect } from 'vitest';
import { SIZE, fitViewBox, trackPathD } from './geometry';

// A portrait outline shaped like the real thing: Monza's baked outline measures
// roughly 348 × 600 inside the 600 unit square, letterboxed left and right.
const portrait = [
  { x: 0.21, y: 0.0 },
  { x: 0.79, y: 0.5 },
  { x: 0.21, y: 1.0 },
];

const box = (vb: string) => {
  const [x, y, w, h] = vb.split(' ').map(Number);
  return { x, y, w, h };
};

describe('trackPathD', () => {
  it('scales unit coordinates into SIZE-space and closes the loop', () => {
    expect(trackPathD([{ x: 0, y: 0.5 }, { x: 1, y: 1 }])).toBe('M 0,300 L 600,600 Z');
  });

  it('is empty before the outline arrives, so TrackPath can bail out', () => {
    expect(trackPathD([])).toBe('');
  });
});

describe('fitViewBox', () => {
  it('crops the letterboxing a fixed 0 0 600 600 box wastes', () => {
    const b = box(fitViewBox(portrait));
    // x spans 0.21–0.79 of the square, so the fitted box is far narrower than 600
    // while the tall axis keeps essentially all of it.
    expect(b.w).toBeLessThan(SIZE * 0.75);
    expect(b.h).toBeGreaterThan(SIZE);
    expect(b.w / b.h).toBeLessThan(1); // portrait, as the outline is
  });

  it('leaves padding on every side so strokes and markers are never clipped', () => {
    const b = box(fitViewBox(portrait));
    expect(b.x).toBeLessThan(0.21 * SIZE);
    expect(b.y).toBeLessThan(0);
    expect(b.x + b.w).toBeGreaterThan(0.79 * SIZE);
    expect(b.y + b.h).toBeGreaterThan(SIZE);
  });

  it('keeps every outline point inside the box — the invariant the car dots ride on', () => {
    // Car positions are plotted in the same SIZE-space as the outline, so a point
    // that lands inside the fitted box is a marker that lands on the track.
    const b = box(fitViewBox(portrait));
    for (const p of portrait) {
      expect(p.x * SIZE).toBeGreaterThanOrEqual(b.x);
      expect(p.x * SIZE).toBeLessThanOrEqual(b.x + b.w);
      expect(p.y * SIZE).toBeGreaterThanOrEqual(b.y);
      expect(p.y * SIZE).toBeLessThanOrEqual(b.y + b.h);
    }
  });

  it('falls back to the full square before any outline has arrived', () => {
    expect(fitViewBox([])).toBe(`0 0 ${SIZE} ${SIZE}`);
  });

  it('gives a degenerate single-point outline a real box rather than a zero one', () => {
    const b = box(fitViewBox([{ x: 0.5, y: 0.5 }]));
    expect(b.w).toBeGreaterThan(0);
    expect(b.h).toBeGreaterThan(0);
    expect(b.y + b.h / 2).toBeCloseTo(SIZE / 2);
  });

  it('leaves extra room on the right, where the driver-code labels are drawn', () => {
    // A label sits 10 units right of its marker and runs ~3 glyphs; on a car at
    // the easternmost point of the circuit it was clipping against a symmetric box.
    const b = box(fitViewBox(portrait));
    const rightMargin = b.x + b.w - 0.79 * SIZE;
    const leftMargin = 0.21 * SIZE - b.x;
    expect(rightMargin).toBeGreaterThan(leftMargin + 30);
  });
});
