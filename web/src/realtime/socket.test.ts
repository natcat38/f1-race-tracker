// Tests for the live socket: reconnect backoff, status transitions and message
// dispatch.

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { connectRace, MAX_RECONNECT_ATTEMPTS } from './socket';
import type { RaceState } from '../state/race';

class MockWebSocket {
  static instances: MockWebSocket[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  url: string;
  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }
  close() { this.closed = true; }
}

beforeEach(() => {
  MockWebSocket.instances = [];
  vi.stubGlobal('WebSocket', MockWebSocket);
  vi.stubGlobal('location', { protocol: 'http:', host: 'localhost:8080' });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('connectRace', () => {
  test('a malformed message is skipped, not thrown, and does not close the connection', () => {
    const states: RaceState[] = [];
    connectRace((s) => states.push(s));
    const ws = MockWebSocket.instances[0];
    expect(() => ws.onmessage?.({ data: 'not json' })).not.toThrow();
    expect(states).toHaveLength(0);
    expect(ws.closed).toBe(false);
  });

  test('a well-formed JSON message with an invalid shape is dropped, not applied', () => {
    const states: RaceState[] = [];
    connectRace((s) => states.push(s));
    const ws = MockWebSocket.instances[0];
    expect(() => ws.onmessage?.({ data: JSON.stringify({ type: 'unknown', data: {} }) })).not.toThrow();
    expect(states).toHaveLength(0);
    expect(ws.closed).toBe(false);
  });

  test('a valid message after a malformed one still applies', () => {
    const states: RaceState[] = [];
    connectRace((s) => states.push(s));
    const ws = MockWebSocket.instances[0];
    ws.onmessage?.({ data: 'not json' });
    ws.onmessage?.({
      data: JSON.stringify({
        type: 'snapshot',
        data: { session: 'x', mode: 'replay', label: 'L', cars: {}, timeMs: 0, rev: 1 },
      }),
    });
    expect(states).toHaveLength(1);
    expect(states[0].rev).toBe(1);
  });
});

describe('connectRace reconnect/backoff', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  test('onclose reports reconnecting and schedules a retry after exactly the current backoff', () => {
    const statuses: string[] = [];
    connectRace(() => {}, (s) => statuses.push(s));
    const ws = MockWebSocket.instances[0];

    ws.onclose?.();
    expect(statuses.at(-1)).toBe('reconnecting');

    vi.advanceTimersByTime(499);
    expect(MockWebSocket.instances).toHaveLength(1); // not yet — backoff hasn't elapsed

    vi.advanceTimersByTime(1);
    expect(MockWebSocket.instances).toHaveLength(2); // exactly at 500ms, open() re-ran
  });

  test('backoff doubles on each successive close, capped at 8000ms', () => {
    connectRace(() => {});
    const expected = [500, 1000, 2000, 4000, 8000, 8000]; // caps, doesn't keep doubling

    for (const ms of expected) {
      const before = MockWebSocket.instances.length;
      MockWebSocket.instances[before - 1].onclose?.();
      vi.advanceTimersByTime(ms - 1);
      expect(MockWebSocket.instances).toHaveLength(before); // not yet
      vi.advanceTimersByTime(1);
      expect(MockWebSocket.instances).toHaveLength(before + 1); // reconnected on schedule
    }
  });

  test('a successful onopen resets backoff to 500 for the next close', () => {
    connectRace(() => {});
    MockWebSocket.instances[0].onclose?.(); // backoff 500 -> 1000
    vi.advanceTimersByTime(500);
    MockWebSocket.instances[1].onopen?.(); // reconnected successfully: backoff resets to 500

    MockWebSocket.instances[1].onclose?.();
    vi.advanceTimersByTime(499);
    expect(MockWebSocket.instances).toHaveLength(2); // not yet — should be 500, not 1000
    vi.advanceTimersByTime(1);
    expect(MockWebSocket.instances).toHaveLength(3);
  });

  test('a retry keeps the reconnecting status instead of falling back to connecting', () => {
    // 'connecting' means "no connection has been tried yet". Re-emitting it on
    // every retry made an outage read as a slow feed: StatusBadge has no
    // 'connecting' branch, so the chip fell through to the staleness warning
    // and App's reconnect overlay blinked out with it.
    const statuses: string[] = [];
    connectRace(() => {}, (s) => statuses.push(s));
    expect(statuses).toEqual(['connecting']);

    MockWebSocket.instances[0].onclose?.();
    vi.advanceTimersByTime(500); // retry opens
    expect(MockWebSocket.instances).toHaveLength(2);
    expect(statuses).toEqual(['connecting', 'reconnecting']);

    MockWebSocket.instances[1].onclose?.();
    vi.advanceTimersByTime(1000); // and again, through a longer backoff
    expect(MockWebSocket.instances).toHaveLength(3);
    expect(statuses).toEqual(['connecting', 'reconnecting', 'reconnecting']);
  });

  test('a reopened socket reports connecting again, so it is not still "reconnecting"', () => {
    // Open but silent is not the same as retrying: the badge should fall through
    // to its warming-up/staleness copy, not keep claiming a lost connection.
    const statuses: string[] = [];
    connectRace(() => {}, (s) => statuses.push(s));
    MockWebSocket.instances[0].onclose?.();
    vi.advanceTimersByTime(500);
    expect(statuses.at(-1)).toBe('reconnecting');

    MockWebSocket.instances[1].onopen?.();
    expect(statuses.at(-1)).toBe('connecting');
  });

  test('a failing retry never reaches onopen, so it stays reconnecting', () => {
    const statuses: string[] = [];
    connectRace(() => {}, (s) => statuses.push(s));
    for (const ms of [500, 1000, 2000]) {
      MockWebSocket.instances.at(-1)!.onclose?.();
      vi.advanceTimersByTime(ms);
    }
    expect(statuses.at(-1)).toBe('reconnecting');
    expect(statuses.filter((s) => s === 'connecting')).toHaveLength(1); // the initial attempt only
  });

  test('a message on a reconnected socket still reports live', () => {
    const statuses: string[] = [];
    connectRace(() => {}, (s) => statuses.push(s));
    MockWebSocket.instances[0].onclose?.();
    vi.advanceTimersByTime(500);

    MockWebSocket.instances[1].onmessage?.({
      data: JSON.stringify({
        type: 'snapshot',
        data: { session: 'x', mode: 'replay', label: 'L', cars: {}, timeMs: 0, rev: 1 },
      }),
    });
    expect(statuses.at(-1)).toBe('live');
  });

  test('after the returned close function runs, a late onclose does not schedule a reconnect', () => {
    const close = connectRace(() => {});
    close();
    MockWebSocket.instances[0].onclose?.(); // a real browser can still fire this post-close

    vi.advanceTimersByTime(10_000); // well past the largest possible backoff
    expect(MockWebSocket.instances).toHaveLength(1); // no reconnect was scheduled
  });
});

describe('connectRace reconnect budget', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  // Drives one failed attempt: close the newest socket and let its whole backoff
  // elapse. 10s is past the 8s ceiling, so it covers every rung of the curve.
  function failOnce() {
    MockWebSocket.instances.at(-1)!.onclose?.();
    vi.advanceTimersByTime(10_000);
  }

  const snapshot = JSON.stringify({
    type: 'snapshot',
    data: { session: 'x', mode: 'replay', label: 'L', cars: {}, timeMs: 0, rev: 1 },
  });

  test('the socket keeps retrying for the whole budget — a gateway restart still self-heals', () => {
    const statuses: string[] = [];
    connectRace(() => {}, (s) => statuses.push(s));

    for (let i = 0; i < MAX_RECONNECT_ATTEMPTS; i++) failOnce();

    // One socket per attempt, on top of the original.
    expect(MockWebSocket.instances).toHaveLength(MAX_RECONNECT_ATTEMPTS + 1);
    expect(statuses.at(-1)).toBe('reconnecting');
    expect(statuses).not.toContain('offline');
  });

  test('one attempt past the budget it goes offline and stops dialling', () => {
    const statuses: string[] = [];
    connectRace(() => {}, (s) => statuses.push(s));

    for (let i = 0; i <= MAX_RECONNECT_ATTEMPTS; i++) failOnce();

    expect(statuses.at(-1)).toBe('offline');
    const opened = MockWebSocket.instances.length;
    vi.advanceTimersByTime(60_000); // a minute of nothing
    expect(MockWebSocket.instances).toHaveLength(opened); // no timer was left running
  });

  test('offline hands over a retry that resets the budget and dials immediately', () => {
    const statuses: string[] = [];
    let retry: (() => void) | undefined;
    connectRace(() => {}, (s, r) => { statuses.push(s); if (r) retry = r; });

    for (let i = 0; i <= MAX_RECONNECT_ATTEMPTS; i++) failOnce();
    expect(retry).toBeTypeOf('function');

    const before = MockWebSocket.instances.length;
    retry!();
    expect(MockWebSocket.instances).toHaveLength(before + 1); // no wait, no backoff
    expect(statuses.at(-1)).toBe('reconnecting');

    // The budget is genuinely reset, not merely nudged: a full budget's worth of
    // failures is survivable again, and the backoff restarts at 500ms.
    MockWebSocket.instances.at(-1)!.onclose?.();
    vi.advanceTimersByTime(499);
    expect(MockWebSocket.instances).toHaveLength(before + 1);
    vi.advanceTimersByTime(1);
    expect(MockWebSocket.instances).toHaveLength(before + 2);

    for (let i = 0; i < MAX_RECONNECT_ATTEMPTS - 1; i++) failOnce();
    expect(statuses.at(-1)).toBe('reconnecting');
    failOnce();
    expect(statuses.at(-1)).toBe('offline');
  });

  test('retry is idempotent — a double press opens one socket, not two', () => {
    let retry: (() => void) | undefined;
    connectRace(() => {}, (_s, r) => { if (r) retry = r; });
    for (let i = 0; i <= MAX_RECONNECT_ATTEMPTS; i++) failOnce();

    const before = MockWebSocket.instances.length;
    retry!();
    retry!();
    retry!();
    expect(MockWebSocket.instances).toHaveLength(before + 1);
  });

  test('a frame refills the budget; a handshake alone does not', () => {
    const statuses: string[] = [];
    connectRace(() => {}, (s) => statuses.push(s));

    // Nineteen failures, then a socket that opens and immediately drops without
    // ever delivering a frame. A gateway flapping like this must still reach the
    // terminal state rather than refilling its budget on every handshake.
    for (let i = 0; i < MAX_RECONNECT_ATTEMPTS - 1; i++) failOnce();
    MockWebSocket.instances.at(-1)!.onopen?.();
    failOnce();
    expect(statuses.at(-1)).toBe('reconnecting'); // attempt 20 — the last one in budget
    failOnce();
    expect(statuses.at(-1)).toBe('offline');
  });

  test('a single delivered frame resets the count, so a long outage later starts clean', () => {
    const statuses: string[] = [];
    connectRace(() => {}, (s) => statuses.push(s));

    for (let i = 0; i < MAX_RECONNECT_ATTEMPTS; i++) failOnce();
    MockWebSocket.instances.at(-1)!.onmessage?.({ data: snapshot });
    expect(statuses.at(-1)).toBe('live');

    // The budget is back to full: the whole span passes without going offline.
    for (let i = 0; i < MAX_RECONNECT_ATTEMPTS; i++) failOnce();
    expect(statuses).not.toContain('offline');
    failOnce();
    expect(statuses.at(-1)).toBe('offline');
  });

  test('a retry handle from a closed connection is inert', () => {
    let retry: (() => void) | undefined;
    const close = connectRace(() => {}, (_s, r) => { if (r) retry = r; });
    for (let i = 0; i <= MAX_RECONNECT_ATTEMPTS; i++) failOnce();

    close();
    const before = MockWebSocket.instances.length;
    retry!();
    expect(MockWebSocket.instances).toHaveLength(before);
  });
});
