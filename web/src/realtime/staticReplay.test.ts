import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { connectStaticReplay } from './staticReplay';
import type { RaceState } from '../state/race';

const CLIP_NDJSON = [
  JSON.stringify({ type: 'snapshot', data: { session: 'static-demo', mode: 'replay', label: 'Test', cars: {}, timeMs: 0, rev: 0 } }),
  JSON.stringify({ type: 'frame', data: { rev: 1, timeMs: 100, cars: [{ driverNum: 1, code: 'VER', team: 'Red Bull', pos: 1, p: { x: 0.1, y: 0.1 }, status: 'OnTrack' }] } }),
  JSON.stringify({ type: 'frame', data: { rev: 2, timeMs: 300, cars: [{ driverNum: 1, code: 'VER', team: 'Red Bull', pos: 1, p: { x: 0.2, y: 0.2 }, status: 'OnTrack' }] } }),
].join('\n') + '\n';

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, text: () => Promise.resolve(CLIP_NDJSON) })));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('connectStaticReplay', () => {
  test('applies the snapshot then the first frame immediately, later frames paced by their timeMs delta', async () => {
    const states: RaceState[] = [];
    connectStaticReplay((s) => states.push(s));

    // The first frame defines its own zero-point (offset = its own timeMs minus
    // itself = 0) — mirrors play.go's `base := lines[0].TimeMs`, where the first
    // emitted frame always has target=0. So the snapshot AND the first frame both
    // play at offset 0, back to back, with no artificial delay between them.
    await vi.waitFor(() => expect(states.length).toBeGreaterThanOrEqual(2), { interval: 1 });
    expect(states[0].rev).toBe(0); // snapshot
    expect(states[1].rev).toBe(1); // first frame, right behind it

    await vi.advanceTimersByTimeAsync(200); // second frame is 200ms after the first (300 - 100)
    expect(states.at(-1)?.rev).toBe(2);
  });

  test('loops back to the first frame after the last frame, without re-emitting the snapshot, and Rev keeps climbing', async () => {
    const states: RaceState[] = [];
    connectStaticReplay((s) => states.push(s));
    await vi.waitFor(() => expect(states.length).toBeGreaterThanOrEqual(2), { interval: 1 }); // snapshot + frame 1

    await vi.advanceTimersByTimeAsync(200); // frame 2, rev 2 (end of clip)
    await vi.advanceTimersByTimeAsync(50);  // past the end -> loop restarts at frame 1, not the snapshot

    // The restarted frame 1 is baked with rev 1, which is <= the rev 2 the state
    // already reached — applyMessage would silently drop it as stale (CONTEXT.md's
    // Rev invariant) unless its rev is bumped past the previous lap's max (2),
    // landing at 1 + 1*2 = 3. This is the whole point of the test: prove Rev keeps
    // climbing across a loop restart instead of freezing the map.
    expect(states.at(-1)?.rev).toBe(3);
  });

  test('the returned close function stops scheduling further frames', async () => {
    const states: RaceState[] = [];
    const close = connectStaticReplay((s) => states.push(s));
    await vi.waitFor(() => expect(states.length).toBeGreaterThanOrEqual(2), { interval: 1 });

    close();
    const countAtClose = states.length;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(states.length).toBe(countAtClose); // nothing scheduled after close
  });

  test('onStatus reports connecting then live', async () => {
    const statuses: string[] = [];
    connectStaticReplay(() => {}, (s) => statuses.push(s));
    expect(statuses[0]).toBe('connecting');
    await vi.waitFor(() => expect(statuses).toContain('live'), { interval: 1 });
  });

  test('reports a non-hung status instead of leaving the UI on "connecting" forever when the clip fetch fails', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('network down'))));
    const statuses: string[] = [];
    connectStaticReplay(() => {}, (s) => statuses.push(s));
    await vi.waitFor(() => expect(statuses).toContain('reconnecting'), { interval: 1 });
  });

  test('reports a non-hung status and does not busy-loop when the clip has no valid frame messages', async () => {
    // Snapshot-only clip: parses fine, but has zero frames. Without the
    // frameStartIndex guard, loopRestartIndex would fall back to 0 (the
    // snapshot itself) and playFrom would reschedule a 0ms timer against
    // itself forever.
    const snapshotOnly = JSON.stringify({
      type: 'snapshot',
      data: { session: 'x', mode: 'replay', label: 'Test', cars: {}, timeMs: 0, rev: 0 },
    }) + '\n';
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, text: () => Promise.resolve(snapshotOnly) })));

    const states: RaceState[] = [];
    const statuses: string[] = [];
    connectStaticReplay((s) => states.push(s), (s) => statuses.push(s));

    await vi.waitFor(() => expect(statuses).toContain('reconnecting'), { interval: 1 });
    expect(states).toHaveLength(0); // playback never started — the snapshot itself is never applied

    // The busy-loop this guard exists to prevent would show up as a timer
    // still ticking; confirm none is scheduled, even after time passes.
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(vi.getTimerCount()).toBe(0);
  });
});
