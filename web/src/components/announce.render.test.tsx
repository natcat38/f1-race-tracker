import { describe, test, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { RaceControl } from './RaceControl';
import { SourceToggle } from './SourceToggle';
import { StatusRail } from './StatusRail';
import { emptyState } from '../state/race';
import { car } from '../state/testCar';

// The board runs three different announcement policies on purpose, and each one
// is a decision that would be easy to undo by accident:
//   - the 10 Hz timing stream is announced NOWHERE (it would be unusable),
//   - the race-control feed is announced (low-frequency, and a change there is
//     the whole point),
//   - the status chip announces its state but not its per-second counter.
// These tests pin the first two; StatusBadge's own file pins the third.

describe('live-region policy', () => {
  test('race control is a log — the one feed where a new entry is the news', () => {
    const state = {
      ...emptyState(),
      rev: 1,
      messages: [{ rev: 1, t: 1000, category: 'Flag', message: 'YELLOW IN TRACK SECTOR 4' }],
    };
    const html = renderToStaticMarkup(<RaceControl state={state} />);
    expect(html).toContain('role="log"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('aria-relevant="additions"');
  });

  test('the timing tower stays out of every live region', () => {
    const state = { ...emptyState(), rev: 1, cars: { 1: car({ lap: 3 }) }, totalLaps: 53 };
    const html = renderToStaticMarkup(<StatusRail active="board" state={state} status="live" />);
    // Exactly one polite region in the rail: the status chip's own, from
    // StatusBadge. Nesting a second one around it double-announced.
    expect(html.match(/aria-live="polite"/g) ?? []).toHaveLength(1);
  });
});

describe('toggle state', () => {
  test('the source picker is a radio group, not two buttons coloured differently', () => {
    const state = { ...emptyState(), rev: 1, session: 'replay' };
    const html = renderToStaticMarkup(<SourceToggle state={state} />);
    expect(html).toContain('role="radiogroup"');
    expect(html).toContain('role="radio"');
    expect(html).toContain('aria-checked="true"');
    expect(html).toContain('aria-checked="false"');
  });

  test('the source picker is one tab stop with the active option as the entry point', () => {
    const state = { ...emptyState(), rev: 1, session: 'live' };
    const html = renderToStaticMarkup(<SourceToggle state={state} />);
    expect(html.match(/tabindex="0"/g) ?? []).toHaveLength(1);
    expect(html.match(/tabindex="-1"/g) ?? []).toHaveLength(1);
    // …and it is the checked one.
    const checked = html.indexOf('aria-checked="true"');
    expect(html.slice(checked - 160, checked + 160)).toContain('tabindex="0"');
  });
});
