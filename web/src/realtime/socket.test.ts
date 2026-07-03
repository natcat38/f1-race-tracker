import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { connectRace } from './socket';
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
