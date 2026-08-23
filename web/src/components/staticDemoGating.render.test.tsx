// Tests what each route does on the static Pages build: the ones that genuinely need
// the gateway say so, and the overlay — which does not — runs for real.

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// Static importers, not a templated path: vite's dynamic-import-vars plugin
// cannot analyse `./${view}` and warns on every run.
const VIEWS = {
  Ghost: () => import('./Ghost').then((m) => m.Ghost),
  Settings: () => import('./Settings').then((m) => m.Settings),
} as const;

// STATIC_DEMO is a module-level constant read from import.meta.env at import
// time, so each case stubs the env and re-imports the module graph rather than
// toggling a value the components have already captured.
async function renderWithFlag(flag: 'true' | '', view: keyof typeof VIEWS) {
  vi.resetModules();
  vi.stubEnv('VITE_STATIC_DEMO', flag);
  const Component = (await VIEWS[view]()) as () => ReactElement;
  return renderToStaticMarkup(<Component />);
}

describe('static-demo gating of the gateway-backed routes', () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.unstubAllEnvs());

  test('Settings tells the truth on the static build instead of pretending to reconnect', async () => {
    const html = await renderWithFlag('true', 'Settings');
    // The honest state: what the view does, that it needs the real backend,
    // and the one-liner that gets you there.
    expect(html).toContain('docker compose up');
    expect(html).toContain('github.com/natcat38/f1-race-tracker');
    // The optimistic lies this replaced (ui-ux B1, accessibility D-1).
    expect(html).not.toContain('Warming up the timing feed');
    expect(html).not.toContain('Connection lost');
    // The tabs stay: the features are real, so the nav keeps advertising them.
    expect(html).toContain('BOARD');
    expect(html).toContain('OVERLAY');
  });

  test('Settings renders the real view when the flag is unset', async () => {
    const html = await renderWithFlag('', 'Settings');
    expect(html).not.toContain('docker compose up &&');
    expect(html).not.toContain('NEEDS THE FULL STACK');
  });

  // The overlay used to be a dead end here. It is not any more: every snapshot
  // carries every driver's reference lap (ADR-0004), so the driver-vs-driver
  // comparison runs entirely off the one baked clip (ADR-0009).
  test('the overlay is a working view on the static build, not a placeholder', async () => {
    const html = await renderWithFlag('true', 'Ghost');
    expect(html).not.toContain('NEEDS THE FULL STACK');
    expect(html).toContain('Sources');
    expect(html).toContain('A (solid)');
    expect(html).toContain('B (ghost)');
  });

  test('the overlay admits which half of the comparison the static build cannot do', async () => {
    const html = await renderWithFlag('true', 'Ghost');
    expect(html).toContain('one baked clip');
    // One clip means one session: no picker to offer, and no cross-season preset.
    expect(html).not.toContain('Same driver, two years');
  });

  test('the overlay offers both scenarios once the full stack is behind it', async () => {
    const html = await renderWithFlag('', 'Ghost');
    expect(html).toContain('Same driver, two years');
    expect(html).toContain('Two drivers, one race');
    expect(html).not.toContain('one baked clip');
  });

  test('every route carries a link back to the repository', async () => {
    const { StatusRail } = await import('./StatusRail');
    const html = renderToStaticMarkup(<StatusRail active="board" />);
    expect(html).toContain('https://github.com/natcat38/f1-race-tracker');
  });
});
