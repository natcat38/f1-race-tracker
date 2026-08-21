// Render tests for the connection/staleness badge, including the live-lane caveat.

import { describe, test, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { StatusBadge } from './StatusBadge';
import { emptyState } from '../state/race';

describe('StatusBadge', () => {
  test('failed status renders unrecoverable-failure copy, not "Reconnecting"', () => {
    const html = renderToStaticMarkup(<StatusBadge status="failed" state={emptyState()} />);
    expect(html).toContain('Demo data failed to load');
    expect(html).not.toContain('Reconnecting');
  });

  test('reconnecting status still renders the reconnect chip', () => {
    const html = renderToStaticMarkup(<StatusBadge status="reconnecting" state={emptyState()} />);
    expect(html).toContain('Reconnecting');
  });

  test('carries its own polite region, so every caller announces transitions', () => {
    // It used to be wrapped at the call site — StatusRail did, Compare did not, so
    // the one route where two lanes stall independently announced nothing.
    const html = renderToStaticMarkup(<StatusBadge status="reconnecting" state={emptyState()} />);
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
  });

  test('the stall chip keeps its ticking seconds out of the announcement', () => {
    // useStale increments once a second, and a polite region announces every change
    // to its text — so a stall used to queue "last frame 6s ago… 7s ago…" forever.
    const state = { ...emptyState(), rev: 5 };
    const html = renderToStaticMarkup(<StatusBadge status="live" state={state} staleSec={9} />);
    expect(html).toContain('Waiting for timing data');
    expect(html).toContain('aria-hidden="true"');
    // The number is still on screen — just not in the announced text.
    expect(html).toContain('last frame 9s ago');
    expect(html.indexOf('aria-hidden')).toBeLessThan(html.indexOf('last frame'));
  });

  test('the live-lane caveat is readable without a hover', () => {
    const state = { ...emptyState(), rev: 5, mode: 'live' };
    const html = renderToStaticMarkup(<StatusBadge status="live" state={state} />);
    expect(html).toContain('visually-hidden');
    expect(html).toContain('real live ingestion not yet verified');
  });
});
