import { describe, test, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { TimingTower } from './TimingTower';
import { emptyState } from '../state/race';
import { car } from '../state/testCar';

const field = (over: Partial<ReturnType<typeof car>>[] = []) => ({
  ...emptyState(),
  rev: 1,
  cars: Object.fromEntries(
    [
      { driverNum: 1, code: 'VER', pos: 1 },
      { driverNum: 4, code: 'NOR', pos: 2 },
      { driverNum: 16, code: 'LEC', pos: 3 },
      ...over,
    ].map((c, i) => [c.driverNum ?? i, car(c)]),
  ),
});

describe('TimingTower empty state', () => {
  test('renders explanatory copy instead of a bare table when there are no cars', () => {
    const html = renderToStaticMarkup(
      <TimingTower state={emptyState()} selected={null} onSelect={() => {}} />,
    );
    expect(html).toContain('No cars yet');
    expect(html).not.toContain('<table');
  });

  test('renders the table once cars exist', () => {
    const state = {
      ...emptyState(),
      rev: 1,
      cars: { 1: { driverNum: 1, code: 'VER', team: 'Red Bull', pos: 1, p: { x: 0, y: 0 }, status: 'OnTrack' } },
    };
    const html = renderToStaticMarkup(
      <TimingTower state={state} selected={null} onSelect={() => {}} />,
    );
    expect(html).toContain('<table');
    expect(html).toContain('VER');
  });
});

describe('TimingTower row semantics', () => {
  test('rows stay rows — no role="button" flattening the table body', () => {
    const html = renderToStaticMarkup(
      <TimingTower state={field()} selected={null} onSelect={() => {}} />,
    );
    // role="button" on a <tr> has a presentational children content model, which
    // strips every <td> of its cell role and detaches all ten scope="col" headers.
    expect(html).not.toContain('role="button"');
    expect(html).not.toMatch(/<tr[^>]*tabindex/i);
    expect(html).toContain('scope="col"');
  });

  test('each row carries a short accessible name, not the whole row concatenated', () => {
    const html = renderToStaticMarkup(
      <TimingTower state={field()} selected={16} onSelect={() => {}} />,
    );
    expect(html).toContain('VER</b><span class="visually-hidden"> — set as reference car');
    // The selected car says what it is rather than what pressing it would do.
    expect(html).toContain('LEC</b><span class="visually-hidden"> — reference car');
    expect(html).toContain('aria-pressed="true"');
  });

  test('the tower is one tab stop: exactly one row button is reachable by Tab', () => {
    const html = renderToStaticMarkup(
      <TimingTower state={field()} selected={null} onSelect={() => {}} />,
    );
    const stops = html.match(/class="tt-select"[^>]*tabindex="0"/g) ?? [];
    const skipped = html.match(/class="tt-select"[^>]*tabindex="-1"/g) ?? [];
    expect(stops).toHaveLength(1);
    expect(skipped).toHaveLength(2);
  });

  test('the roving tab stop follows the reference car when one is set', () => {
    const html = renderToStaticMarkup(
      <TimingTower state={field()} selected={4} onSelect={() => {}} />,
    );
    const rowOf = (code: string) => html.slice(html.indexOf(`>${code}</b>`) - 300, html.indexOf(`>${code}</b>`));
    expect(rowOf('NOR')).toContain('tabindex="0"');
    expect(rowOf('VER')).toContain('tabindex="-1"');
  });
});

describe('TimingTower de-emphasis', () => {
  test('a retired car is dimmed by class, not by an opacity that halves its contrast', () => {
    const state = field([{ driverNum: 81, code: 'PIA', pos: 4, status: 'Out' }]);
    const html = renderToStaticMarkup(
      <TimingTower state={state} selected={null} onSelect={() => {}} />,
    );
    // opacity:0.5 over --slate measured 2.40:1; .tt-row-out uses --dim at 4.8:1.
    expect(html).toContain('tt-row-out');
    expect(html).not.toContain('opacity:0.5');
    expect(html).toContain('OUT');
  });

  test('the S/P sector marks get a visible legend, not a hover-only title', () => {
    const html = renderToStaticMarkup(
      <TimingTower state={field()} selected={null} onSelect={() => {}} />,
    );
    expect(html).toContain('S = session best · P = personal best');
  });
});

describe('TimingTower constructor key', () => {
  test('every row carries its team colour as --team, for the position rule', () => {
    const state = field();
    // The map has always painted markers by constructor; the tower did not, so
    // a dot and a row could not be tied together.
    const html = renderToStaticMarkup(
      <TimingTower state={state} selected={null} onSelect={() => {}} />,
    );
    expect(html).toContain('--team:#3671C6'); // testCar's default team is Red Bull
  });

  test('an unknown constructor falls back to transparent, so nothing shifts', () => {
    const state = field([{ driverNum: 77, code: 'BOT', pos: 4, team: 'Nowhere F1' }]);
    const html = renderToStaticMarkup(
      <TimingTower state={state} selected={null} onSelect={() => {}} />,
    );
    expect(html).toContain('--team:transparent');
  });

  test('the driver code itself is NOT painted — several team hexes fail on carbon', () => {
    // Haas #B6BABD and AlphaTauri #2B4562 are the cases; a 3px rule carries the
    // key without spending any contrast.
    const state = field([{ driverNum: 20, code: 'MAG', pos: 4, team: 'Haas' }]);
    const html = renderToStaticMarkup(
      <TimingTower state={state} selected={null} onSelect={() => {}} />,
    );
    expect(html).not.toContain('color:#B6BABD');
  });
});
