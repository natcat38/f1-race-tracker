/**
 * The board's DOM contract (F1-UX-11): all six panels sit in one `.board` grid, in
 * the order the phone stacks them and Tab visits them, with Comms and Race Control
 * sharing one `.board-stack` cell. The desktop layout places them by CSS grid area,
 * so this order is what keeps the phone and keyboard order from bending to it.
 *
 * @vitest-environment jsdom
 */

import { describe, test, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';

vi.mock('./staticDemo', () => ({ STATIC_DEMO: true, REPO_URL: 'https://example.test/repo' }));
vi.mock('./components/Ghost', () => ({ Ghost: () => <div>ghost stub</div> }));
vi.mock('./realtime/staticReplay', () => ({
  connectStaticReplay: (
    onState: (s: unknown) => void,
    onStatus: (s: string) => void,
    setDuration: (d: number) => void,
  ) => {
    onStatus('connected');
    onState({ cars: {}, rev: 1, timeMs: 0, track: [], lapTrace: {}, label: '', messages: [] });
    setDuration(60_000);
    return () => {};
  },
}));
vi.mock('./realtime/socket', () => ({ connectRace: vi.fn(() => vi.fn()) }));

const { default: App } = await import('./App');

afterEach(cleanup);

describe('board layout contract', () => {
  test('six panels in reading order inside one grid, Comms and Race Control stacked', () => {
    const { container } = render(<App />);
    const board = container.querySelector('.board');
    expect(board).not.toBeNull();
    const ids = [...board!.querySelectorAll('.panel')].map((p) => p.querySelector('h2')?.textContent);
    expect(ids).toEqual(['Track', 'Timing', 'Telemetry', 'Strategy', 'Comms', 'Race Control']);

    const stack = board!.querySelector('.board-stack');
    expect([...stack!.querySelectorAll('.panel h2')].map((h) => h.textContent)).toEqual(['Comms', 'Race Control']);
    expect(container.querySelector('.board-top, .board-bottom')).toBeNull();
  });
});
