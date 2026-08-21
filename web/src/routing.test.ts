// Unit tests for hash parsing and serialising: route names and the deep-linked car code.

import { describe, test, expect } from 'vitest';
import { buildHash, parseHash, type RouteName } from './routing';

describe('parseHash', () => {
  test('a bare or empty hash is the board', () => {
    expect(parseHash('')).toEqual({ route: 'board', car: null });
    expect(parseHash('#')).toEqual({ route: 'board', car: null });
  });

  test('the three named routes parse, with or without the leading #', () => {
    for (const r of ['compare', 'ghost', 'settings'] as RouteName[]) {
      expect(parseHash(`#${r}`).route).toBe(r);
      expect(parseHash(r).route).toBe(r);
    }
  });

  test('an unknown route falls back to the board rather than rendering nothing', () => {
    // The skip link navigates to #main, and a stale bookmark can name anything.
    expect(parseHash('#main').route).toBe('board');
    expect(parseHash('#nope?car=VER')).toEqual({ route: 'board', car: 'VER' });
  });

  test('?car= is read on the board and uppercased', () => {
    expect(parseHash('#board?car=VER')).toEqual({ route: 'board', car: 'VER' });
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
    expect(parseHash('#compare?lane=2&car=HAM')).toEqual({ route: 'compare', car: 'HAM' });
    expect(parseHash('#board?lane=2')).toEqual({ route: 'board', car: null });
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
    expect(buildHash({ route: 'compare', car: null })).toBe('#compare');
    expect(buildHash({ route: 'ghost', car: null })).toBe('#ghost');
    expect(buildHash({ route: 'settings', car: null })).toBe('#settings');
  });
});

describe('round-tripping', () => {
  test('parse and build are inverses over every shape the app writes', () => {
    for (const h of ['#', '#board?car=VER', '#compare', '#ghost', '#settings']) {
      expect(buildHash(parseHash(h))).toBe(h);
    }
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
