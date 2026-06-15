import { describe, it, expect } from 'vitest';
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
    s = applyMessage(s, { type: 'frame' as const, data: { rev: 4, timeMs: 100, cars: [{ driverNum: 1, code: 'VER', pos: 1, p: { x: 0.6, y: 0.5 }, status: 'OnTrack' }] } });
    expect(s.cars[1].p.x).toBe(0.6);
    const stale = applyMessage(s, { type: 'frame' as const, data: { rev: 4, timeMs: 100, cars: [{ driverNum: 1, code: 'XXX', pos: 1, p: { x: 0, y: 0 }, status: 'OnTrack' }] } });
    expect(stale.cars[1].code).toBe('VER'); // unchanged
  });
});
