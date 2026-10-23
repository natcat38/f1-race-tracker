// Render tests for the connection/staleness badge, including the live-lane caveat.

import { describe, test, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { StatusBadge, RestingLaneLine } from './StatusBadge';
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
    // It used to be wrapped at the call site — StatusRail did, other callers did
    // not, so a route whose two lanes stall independently announced nothing.
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

  test('the healthy chip keeps every word in the DOM, with the glyph in its own span', () => {
    // The phone strip hides .chip-text and keeps .chip-glyph (F1-UX-10); the words
    // must stay in the announced text, byte for byte.
    const state = { ...emptyState(), rev: 5, mode: 'replay' };
    const html = renderToStaticMarkup(<StatusBadge status="live" state={state} />);
    expect(html).toContain('<span class="chip-glyph">▶</span>');
    expect(html).toContain('<span class="chip-text">REPLAY · LOOPING CLIP</span>');
    expect(html.replace(/<[^>]+>/g, '')).toBe('▶ REPLAY · LOOPING CLIP');
  });
});

describe('RestingLaneLine', () => {
  const healthy = { ...emptyState(), rev: 5, mode: 'replay' };

  test('repeats the healthy chip in full, hidden from assistive tech', () => {
    const html = renderToStaticMarkup(<RestingLaneLine status="live" state={healthy} />);
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('▶ REPLAY · LOOPING CLIP');
    const live = renderToStaticMarkup(
      <RestingLaneLine status="live" state={{ ...healthy, mode: 'live' }} />,
    );
    expect(live).toContain('● LIVE LANE · RECORDED CLIP');
  });

  test.each([
    ['offline', { status: 'offline' as const }],
    ['failed', { status: 'failed' as const }],
    ['reconnecting', { status: 'reconnecting' as const }],
    ['stale', { status: 'live' as const, staleSec: 9 }],
    ['warming up', { status: 'live' as const, state: emptyState() }],
    ['lane named elsewhere', { status: 'live' as const, laneNamedElsewhere: true }],
  ])('says nothing while the strip chip is an exception: %s', (_name, extra) => {
    const html = renderToStaticMarkup(<RestingLaneLine state={healthy} {...extra} />);
    expect(html).toBe('');
  });
});
