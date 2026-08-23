// Unit tests for hash parsing and serialising: route names, the deep-linked car code,
// and the overlay's two `(session, driver)` sides.

import { describe, test, expect } from 'vitest';
import { buildHash, parseHash, type RouteName } from './routing';

const EMPTY = { car: null, a: null, b: null };

describe('parseHash', () => {
  test('a bare or empty hash is the board', () => {
    expect(parseHash('')).toEqual({ route: 'board', ...EMPTY });
    expect(parseHash('#')).toEqual({ route: 'board', ...EMPTY });
  });

  test('the three named routes parse, with or without the leading #', () => {
    for (const r of ['board', 'ghost', 'settings'] as RouteName[]) {
      expect(parseHash(`#${r}`).route).toBe(r);
      expect(parseHash(r).route).toBe(r);
    }
  });

  test('#compare redirects to the overlay that absorbed it (ADR-0009)', () => {
    // Links to the deleted view exist in the wild; they must land on the view that
    // now does the comparing, not silently on the board.
    expect(parseHash('#compare').route).toBe('ghost');
    expect(parseHash('#compare?lane=2').route).toBe('ghost');
  });

  test('an unknown route falls back to the board rather than rendering nothing', () => {
    // The skip link navigates to #main, and a stale bookmark can name anything.
    expect(parseHash('#main').route).toBe('board');
    expect(parseHash('#nope?car=VER')).toEqual({ route: 'board', ...EMPTY, car: 'VER' });
  });

  test('?car= is read on the board and uppercased', () => {
    expect(parseHash('#board?car=VER')).toEqual({ route: 'board', ...EMPTY, car: 'VER' });
    expect(parseHash('#board?car=ver').car).toBe('VER');
  });

  test('a car number is a valid code — not every session publishes abbreviations', () => {
    expect(parseHash('#board?car=44').car).toBe('44');
  });

  test('a malformed car is dropped, so no caller has to re-validate it', () => {
    expect(parseHash('#board?car=').car).toBeNull();
    expect(parseHash('#board?car=V').car).toBeNull();
    expect(parseHash('#board?car=TOOLONG').car).toBeNull();
    expect(parseHash('#board?car=V%20R').car).toBeNull();
    expect(parseHash('#board?car=<script>').car).toBeNull();
  });

  test('other query keys are ignored and do not disturb the route', () => {
    expect(parseHash('#ghost?lane=2&car=HAM')).toEqual({ route: 'ghost', ...EMPTY, car: 'HAM' });
    expect(parseHash('#board?lane=2')).toEqual({ route: 'board', ...EMPTY });
  });

  test('the overlay sides parse into (session, driver) pairs', () => {
    expect(parseHash('#ghost?a=monza-2024:VER&b=monza-2024:LEC')).toEqual({
      route: 'ghost',
      car: null,
      a: { session: 'monza-2024', car: 'VER' },
      b: { session: 'monza-2024', car: 'LEC' },
    });
    // Cross-year: the other axis of the same grammar.
    expect(parseHash('#ghost?a=monza-2024:VER&b=monza-2023:VER').b)
      .toEqual({ session: 'monza-2023', car: 'VER' });
  });

  test('a half-formed side is dropped whole — half a side is not a comparison', () => {
    expect(parseHash('#ghost?a=monza-2024').a).toBeNull();
    expect(parseHash('#ghost?a=monza-2024:').a).toBeNull();
    expect(parseHash('#ghost?a=:VER').a).toBeNull();
    expect(parseHash('#ghost?a=Monza 2024:VER').a).toBeNull();
    expect(parseHash('#ghost?a=monza-2024:TOOLONG').a).toBeNull();
  });

  test('a side is case-normalised the way a hand-typed URL arrives', () => {
    expect(parseHash('#ghost?a=MONZA-2024:ver').a).toEqual({ session: 'monza-2024', car: 'VER' });
  });
});

describe('buildHash', () => {
  test('the board with no selection is the bare # the BOARD tab already links to', () => {
    expect(buildHash({ route: 'board', car: null })).toBe('#');
  });

  test('a selection names the board explicitly, so the query has something to hang off', () => {
    expect(buildHash({ route: 'board', car: 'VER' })).toBe('#board?car=VER');
  });

  test('the other routes keep their existing hashes untouched', () => {
    expect(buildHash({ route: 'ghost', car: null })).toBe('#ghost');
    expect(buildHash({ route: 'settings', car: null })).toBe('#settings');
  });

  test('both overlay sides are written, or neither', () => {
    expect(buildHash({
      route: 'ghost',
      a: { session: 'monza-2024', car: 'VER' },
      b: { session: 'monza-2023', car: 'VER' },
    })).toBe('#ghost?a=monza-2024:VER&b=monza-2023:VER');
    expect(buildHash({ route: 'ghost', a: { session: 'monza-2024', car: 'VER' } })).toBe('#ghost');
  });
});

describe('round-tripping', () => {
  test('parse and build are inverses over every shape the app writes', () => {
    const shapes = [
      '#',
      '#board?car=VER',
      '#ghost',
      '#settings',
      '#ghost?a=monza-2024:VER&b=monza-2024:LEC',
    ];
    for (const h of shapes) expect(buildHash(parseHash(h))).toBe(h);
  });

  test('the two spellings of an empty board normalise to one, so no-op writes are detectable', () => {
    // App compares built forms before calling replaceState; '' and '#' and
    // '#board' must all collapse to the same string or every frame would rewrite
    // the URL.
    for (const h of ['', '#', '#board']) {
      expect(buildHash(parseHash(h))).toBe('#');
    }
  });
});
