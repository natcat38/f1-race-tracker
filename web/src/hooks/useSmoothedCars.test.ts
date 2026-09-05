// Pure-function coverage for issue #102: TELEPORT_THRESHOLD must be compared
// in the same [0,1] normalised track-space as the car positions themselves,
// so a scrub-sized jump actually snaps instead of gliding across the map.

import { describe, test, expect } from 'vitest';
import { snapTeleports } from './useSmoothedCars';

describe('snapTeleports (#102)', () => {
  test('a scrub-sized jump snaps (from starts at the new point)', () => {
    const prevTo = { 1: { x: 0.1, y: 0.1 } };
    // Far larger than any real frame-to-frame motion, but well within [0,1]²
    // — this is the exact case the old SIZE-scale threshold (50) could never
    // catch, since the max possible [0,1]-space distance is only ~1.41.
    const next = { 1: { x: 0.9, y: 0.9 } };
    const snapped = snapTeleports(next, prevTo);
    expect(snapped[1]).toEqual(next[1]);
  });
});
