// Tests for the static-replay reader: clip pacing, looping and status reporting.

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

  test('a real-time stall resyncs the pacer instead of bursting through the rest of the clip', async () => {
    // A five-frame clip, 100ms apart, so a burst is easy to tell from paced delivery.
    const clip = [
      JSON.stringify({ type: 'snapshot', data: { session: 'x', mode: 'replay', label: 'Test', cars: {}, timeMs: 0, rev: 0 } }),
      ...[1, 2, 3, 4, 5].map((n) => JSON.stringify({
        type: 'frame',
        data: { rev: n, timeMs: n * 100, cars: [{ driverNum: 1, code: 'VER', team: 'Red Bull', pos: 1, p: { x: 0, y: 0 }, status: 'OnTrack' }] },
      })),
    ].join('\n') + '\n';
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, text: () => Promise.resolve(clip) })));

    const states: RaceState[] = [];
    connectStaticReplay((s) => {
      states.push(s);
      // Simulate real processing (a slow commit, a layout thrash, a GC pause)
      // eating 500ms of wall-clock time while still "inside" the delivery of
      // frame 1 — the same way React work runs between one setTimeout firing
      // and the next being scheduled. Only done once, on the first frame.
      if (s.rev === 1) vi.setSystemTime(Date.now() + 500);
    });
    await vi.waitFor(() => expect(states.length).toBeGreaterThanOrEqual(2), { interval: 1 }); // snapshot + frame 1

    // Frame 2 was already scheduled behind (500ms stall vs its 100ms offset),
    // so it fires on the next tick of the clock: one frame is allowed to catch up.
    await vi.advanceTimersByTimeAsync(10);
    expect(states.at(-1)?.rev).toBe(2);

    // But the pacer must have resynced rather than staying 500ms behind: a
    // small further advance must NOT also deliver frame 3. The pre-fix
    // scheduler stayed permanently behind schedule after any stall and fired
    // every remaining frame back-to-back regardless of elapsed time.
    await vi.advanceTimersByTimeAsync(10);
    expect(states.at(-1)?.rev).toBe(2); // frame 3 needs its own ~100ms, not 10ms more

    // Normal pacing resumes: frame 3 needs the rest of its ~100ms budget.
    await vi.advanceTimersByTimeAsync(90);
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

  test('reports a failed status instead of leaving the UI on "connecting" forever when the clip fetch fails', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('network down'))));
    const statuses: string[] = [];
    connectStaticReplay(() => {}, (s) => statuses.push(s));
    await vi.waitFor(() => expect(statuses).toContain('failed'), { interval: 1 });
  });

  test('reports a failed status and does not busy-loop when the clip has no valid frame messages', async () => {
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

    await vi.waitFor(() => expect(statuses).toContain('failed'), { interval: 1 });
    expect(states).toHaveLength(0); // playback never started — the snapshot itself is never applied

    // The busy-loop this guard exists to prevent would show up as a timer
    // still ticking; confirm none is scheduled, even after time passes.
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(vi.getTimerCount()).toBe(0);
  });

  test('pause() stops further onFrame delivery', async () => {
    const states: RaceState[] = [];
    const handle = connectStaticReplay((s) => states.push(s));
    await vi.waitFor(() => expect(states.length).toBeGreaterThanOrEqual(2), { interval: 1 }); // snapshot + frame 1

    handle.pause();
    const countAtPause = states.length;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(states.length).toBe(countAtPause); // no further frames delivered while paused
  });

  test('resume() after pause() continues from the paused position, not the clip start', async () => {
    const states: RaceState[] = [];
    const handle = connectStaticReplay((s) => states.push(s));
    await vi.waitFor(() => expect(states.length).toBeGreaterThanOrEqual(2), { interval: 1 }); // snapshot + frame 1
    expect(states.at(-1)?.rev).toBe(1);

    handle.pause();
    await vi.advanceTimersByTimeAsync(5_000); // long enough that a "resume from start" bug would burst

    handle.resume();
    // Frame 2 is 200ms after frame 1; resuming from the paused position should
    // require ~200ms more, not replay frame 1 again or burst straight to the end.
    await vi.advanceTimersByTimeAsync(199);
    expect(states.at(-1)?.rev).toBe(1); // not yet
    await vi.advanceTimersByTimeAsync(1);
    expect(states.at(-1)?.rev).toBe(2);
  });

  test('scrub() before the first frame clamps to the first frame', async () => {
    const states: RaceState[] = [];
    const handle = connectStaticReplay((s) => states.push(s));
    await vi.waitFor(() => expect(states.length).toBeGreaterThanOrEqual(2), { interval: 1 });

    handle.scrub(-1000);
    expect(states.at(-1)?.rev).toBe(1);
    expect(states.at(-1)?.cars[1]?.p).toEqual({ x: 0.1, y: 0.1 });
  });

  test('scrub() after the last frame clamps to the last frame', async () => {
    const states: RaceState[] = [];
    const handle = connectStaticReplay((s) => states.push(s));
    await vi.waitFor(() => expect(states.length).toBeGreaterThanOrEqual(2), { interval: 1 });

    handle.scrub(100_000);
    expect(states.at(-1)?.rev).toBe(2);
    expect(states.at(-1)?.cars[1]?.p).toEqual({ x: 0.2, y: 0.2 });
  });

  test('scrub() while paused lands on the scrubbed frame, and a later resume() plays on from there', async () => {
    const states: RaceState[] = [];
    const handle = connectStaticReplay((s) => states.push(s));
    await vi.waitFor(() => expect(states.length).toBeGreaterThanOrEqual(2), { interval: 1 });

    handle.pause();
    handle.scrub(300); // lands on frame 2 (rev 2, timeMs 300)
    expect(states.at(-1)?.rev).toBe(2);

    const countAfterScrub = states.length;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(states.length).toBe(countAfterScrub); // still paused: scrub must not itself resume playback

    handle.resume();
    // Scrubbed to the last frame in this clip, so resume runs off the end and loops.
    await vi.advanceTimersByTimeAsync(10);
    expect(states.at(-1)?.rev).toBe(3); // loop restart, rev bumped past the previous lap's max
  });

  test('a stall after a scrub still resyncs the pacer instead of bursting through the rest of the clip', async () => {
    // A seven-frame clip, 100ms apart, matching the stall test above, so a resync
    // failure after scrubbing is easy to tell apart from a genuinely paced delivery.
    // Extra frames past the stall point keep the test clear of the loop boundary.
    const clip = [
      JSON.stringify({ type: 'snapshot', data: { session: 'x', mode: 'replay', label: 'Test', cars: {}, timeMs: 0, rev: 0 } }),
      ...[1, 2, 3, 4, 5, 6, 7].map((n) => JSON.stringify({
        type: 'frame',
        data: { rev: n, timeMs: n * 100, cars: [{ driverNum: 1, code: 'VER', team: 'Red Bull', pos: 1, p: { x: 0, y: 0 }, status: 'OnTrack' }] },
      })),
    ].join('\n') + '\n';
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, text: () => Promise.resolve(clip) })));

    const states: RaceState[] = [];
    const handle = connectStaticReplay((s) => {
      states.push(s);
      // Simulate real processing (a slow commit, layout thrash, GC pause) eating
      // 500ms of wall-clock time while still "inside" the delivery of frame 4 —
      // same trick as the real-time stall test above. Done once, after scrubbing.
      if (s.rev === 4) vi.setSystemTime(Date.now() + 500);
    });
    await vi.waitFor(() => expect(states.length).toBeGreaterThanOrEqual(2), { interval: 1 }); // snapshot + frame 1

    // Offsets (relative to frame 1's timeMs of 100) are 0/100/200/... for
    // rev 1/2/3/... . scrub(200) lands on the first offset >= 200, i.e. rev 3,
    // and (unpaused) resumes playback from there.
    handle.scrub(200);
    expect(states.at(-1)?.rev).toBe(3);

    // Frame 4 (100ms later) arrives normally and triggers the simulated stall.
    await vi.advanceTimersByTimeAsync(100);
    expect(states.at(-1)?.rev).toBe(4);

    // Frame 5 was already scheduled behind (500ms stall vs its 100ms offset),
    // so it fires on the next tick: one frame is allowed to catch up.
    await vi.advanceTimersByTimeAsync(10);
    expect(states.at(-1)?.rev).toBe(5);

    // But the pacer must have resynced rather than staying 500ms behind: a
    // further small advance must NOT also deliver frame 6.
    await vi.advanceTimersByTimeAsync(10);
    expect(states.at(-1)?.rev).toBe(5);

    // Normal pacing resumes: frame 6 needs the rest of its ~100ms budget.
    await vi.advanceTimersByTimeAsync(90);
    expect(states.at(-1)?.rev).toBe(6);
  });

  test('timers are cleared on disconnect after pause/resume/scrub have been used', async () => {
    const states: RaceState[] = [];
    const handle = connectStaticReplay((s) => states.push(s));
    await vi.waitFor(() => expect(states.length).toBeGreaterThanOrEqual(2), { interval: 1 });

    handle.scrub(150);
    handle();
    expect(vi.getTimerCount()).toBe(0);

    const countAtClose = states.length;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(states.length).toBe(countAtClose); // nothing scheduled after close
  });
});
