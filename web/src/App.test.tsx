/**
 * Regression coverage for the shell's data-source connection: opened once when
 * the board is first shown, and kept alive across route changes.
 *
 * The mount effect used to call connectRace/connectStaticReplay
 * unconditionally, above the route switch, so a deep link straight to #ghost or
 * #settings paid for the connection — and, on the static build, the clip fetch —
 * despite never showing the board. The fix is lazy-connect-once then keep-alive:
 * connect the first time the board actually renders, and never tear the
 * connection down merely because the route changed away from it (only a real
 * unmount does).
 *
 * Ghost is stubbed out. It owns independent lane subscriptions (useLane ->
 * subscribeLane -> connectRace with a session argument) that are irrelevant to
 * the App-level behaviour under test and would otherwise inflate the count.
 *
 * @vitest-environment jsdom
 */

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';

const connectRaceMock = vi.fn<(...args: unknown[]) => () => void>(() => vi.fn());

vi.mock('./realtime/socket', () => ({ connectRace: connectRaceMock }));
vi.mock('./components/Ghost', () => ({ Ghost: () => <div>ghost stub</div> }));

const { default: App } = await import('./App');

// Only the App's own board connection has no session argument (subscribeLane's
// lane connections always pass one) — filtering on that isolates the effect
// under test from anything else that happens to call connectRace.
const boardConnectCalls = () => connectRaceMock.mock.calls.filter((args) => args[2] === undefined);

function goTo(hash: string) {
  act(() => {
    window.location.hash = hash;
    window.dispatchEvent(new Event('hashchange'));
  });
}

beforeEach(() => {
  connectRaceMock.mockClear();
  window.location.hash = '';
});
afterEach(cleanup);

describe('App connection lifecycle (#22)', () => {
  test('board -> ghost -> board connects exactly once, not once per visit', () => {
    render(<App />);
    expect(boardConnectCalls()).toHaveLength(1);

    goTo('#ghost');
    expect(boardConnectCalls()).toHaveLength(1); // no reconnect on nav away

    goTo('');
    expect(boardConnectCalls()).toHaveLength(1); // no reconnect on nav back
  });

  test('deep-linking straight to #ghost never opens the board connection', () => {
    window.location.hash = '#ghost';
    render(<App />);
    expect(boardConnectCalls()).toHaveLength(0);

    goTo(''); // only now does the board actually show
    expect(boardConnectCalls()).toHaveLength(1);
  });
});
