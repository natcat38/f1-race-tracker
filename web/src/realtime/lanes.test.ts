// Tests for the lane registry: one connection per session key, however many
// subscribers, and a clean close when the last one leaves.

import { describe, test, expect, afterEach, vi } from 'vitest';
import { subscribeLane, resetLanes, openLaneCount, type LaneSnapshot } from './lanes';
import { emptyState, type RaceState } from '../state/race';
import type { ConnStatus } from './socket';

// A fake data source that records how many times it was dialled and for which key.
function fakeConnect() {
  const opened: string[] = [];
  const closed: string[] = [];
  const push: Record<string, (s: RaceState) => void> = {};
  const status: Record<string, (s: ConnStatus) => void> = {};
  const connect = (
    onState: (s: RaceState) => void,
    onStatus: (s: ConnStatus) => void,
    session?: string,
  ) => {
    const key = session ?? '';
    opened.push(key);
    push[key] = onState;
    status[key] = onStatus;
    return () => { closed.push(key); };
  };
  return { connect, opened, closed, push, status };
}

afterEach(() => resetLanes());

describe('subscribeLane', () => {
  test('two subscribers on the same session share ONE connection', () => {
    // The point of ADR-0009's same-lane case: VER vs LEC at Monza 2024 costs one
    // socket, not two, because both traces ride the same snapshot.
    const f = fakeConnect();
    const a = vi.fn();
    const b = vi.fn();
    const offA = subscribeLane('compare-monza-2024', a, f.connect);
    const offB = subscribeLane('compare-monza-2024', b, f.connect);

    expect(f.opened).toEqual(['compare-monza-2024']);
    expect(openLaneCount()).toBe(1);

    // One frame reaches both sides.
    const state = { ...emptyState(), rev: 3 };
    f.push['compare-monza-2024'](state);
    expect(a).toHaveBeenLastCalledWith<[LaneSnapshot]>({ state, status: 'connecting' });
    expect(b).toHaveBeenLastCalledWith<[LaneSnapshot]>({ state, status: 'connecting' });

    offA();
    offB();
  });

  test('two different sessions open two connections', () => {
    const f = fakeConnect();
    subscribeLane('compare-monza-2024', vi.fn(), f.connect);
    subscribeLane('compare-monza-2023', vi.fn(), f.connect);
    expect(f.opened).toEqual(['compare-monza-2024', 'compare-monza-2023']);
    expect(openLaneCount()).toBe(2);
  });

  test('the connection closes only when the LAST subscriber leaves', () => {
    const f = fakeConnect();
    const offA = subscribeLane('lane', vi.fn(), f.connect);
    const offB = subscribeLane('lane', vi.fn(), f.connect);
    offA();
    expect(f.closed).toEqual([]);
    expect(openLaneCount()).toBe(1);
    offB();
    expect(f.closed).toEqual(['lane']);
    expect(openLaneCount()).toBe(0);
  });

  test('a late subscriber gets the warm lane\'s current snapshot immediately', () => {
    // Otherwise switching side B onto side A's session would show an empty state
    // until the next frame, even though the data is already in hand.
    const f = fakeConnect();
    subscribeLane('lane', vi.fn(), f.connect);
    const state = { ...emptyState(), rev: 9 };
    f.push['lane'](state);
    f.status['lane']('live');

    const late = vi.fn();
    subscribeLane('lane', late, f.connect);
    expect(late).toHaveBeenCalledWith<[LaneSnapshot]>({ state, status: 'live' });
    expect(f.opened).toEqual(['lane']);
  });

  test('re-subscribing after the last unsubscribe dials again', () => {
    const f = fakeConnect();
    subscribeLane('lane', vi.fn(), f.connect)();
    subscribeLane('lane', vi.fn(), f.connect);
    expect(f.opened).toEqual(['lane', 'lane']);
  });
});
