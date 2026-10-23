// Cascade guard for the touch-target floor (F1-UX-8, F1-UX-6, F1-UX-12): a
// (pointer: coarse) rule only wins if it comes after the base rule it overrides,
// and for .tt-clear and .cmd-copy it did not - both stayed 24px on a phone.

import { describe, test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const css = readFileSync(fileURLToPath(new URL('./components.css', import.meta.url)), 'utf8');

// Index of the first top-level rule whose selector list starts with `selector`.
const baseIndex = (selector: string) => css.indexOf(`\n${selector} {`);
const coarseBlocks = [...css.matchAll(/@media \(pointer: coarse\) \{/g)].map((m) => m.index!);

describe('coarse-pointer touch targets', () => {
  test.each(['.tt-clear', '.cmd-copy'])('%s: a coarse 44px rule comes after its 24px base rule', (sel) => {
    const base = baseIndex(sel);
    expect(base).toBeGreaterThan(-1);
    const later = coarseBlocks.filter((i) => i > base).map((i) => css.slice(i, i + 600));
    expect(later.some((b) => b.includes(sel) && b.includes('min-height: 44px'))).toBe(true);
  });

  test('the glyph-only rail exits are 44px wide on touch', () => {
    const block = css.slice(coarseBlocks[0]);
    expect(block).toMatch(/\.rail-repo \{[^}]*min-width: 44px/);
  });

  test('the desktop scrubber hit box meets the 24px floor', () => {
    expect(css).toMatch(/\.range-dark \{[^}]*height: 24px/);
  });
});
