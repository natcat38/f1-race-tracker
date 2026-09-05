/**
 * Static-markup coverage for the replay scrub row (issues #107, #108): the
 * range input must reuse the Ghost scrubber's shared dark-mode/touch-target
 * class instead of being a bare, unclassed input, and the elapsed readout
 * must NOT reuse the hero session-clock class (.rail-clock) — it needs its
 * own smaller class so it doesn't visually outrank the real session clock.
 *
 * @vitest-environment jsdom
 */

import { describe, test, expect, vi, afterEach } from 'vitest';
import { render, cleanup, screen } from '@testing-library/react';

vi.mock('./staticDemo', () => ({ STATIC_DEMO: true, REPO_URL: 'https://example.test/repo' }));
vi.mock('./components/Ghost', () => ({ Ghost: () => <div>ghost stub</div> }));
vi.mock('./realtime/staticReplay', () => ({
  connectStaticReplay: (
    onState: (s: unknown) => void,
    onStatus: (s: string) => void,
    setDuration: (d: number) => void,
  ) => {
    onStatus('connected');
    onState({ cars: {}, rev: 1, timeMs: 0, track: [], lapTrace: {}, label: '' });
    setDuration(60_000); // non-zero so the scrub row renders
    return () => {};
  },
}));
vi.mock('./realtime/socket', () => ({ connectRace: vi.fn(() => vi.fn()) }));

const { default: App } = await import('./App');

afterEach(cleanup);

describe('replay scrub row styling (#107, #108)', () => {
  test('the range input carries the shared dark/touch-target range class, not a raw width', () => {
    render(<App />);
    const input = screen.getByLabelText('Replay position');
    expect(input.className).toContain('range-dark');
  });

  test('the elapsed readout does not reuse the hero .rail-clock class', () => {
    render(<App />);
    const input = screen.getByLabelText('Replay position');
    const readout = input.parentElement?.querySelector('span:last-of-type');
    expect(readout?.className).not.toContain('rail-clock');
    expect(readout?.className).toContain('rail-scrub-clock');
  });
});
