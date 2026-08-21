// Tests that gateway-backed views render the static-demo notice instead of dialling a
// socket that cannot connect.

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// Static importers, not a templated path: vite's dynamic-import-vars plugin
// cannot analyse `./${view}` and warns on every run.
const VIEWS = {
  Compare: () => import('./Compare').then((m) => m.Compare),
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

  test.each(['Compare', 'Ghost', 'Settings'] as const)(
    '%s tells the truth on the static build instead of pretending to reconnect',
    async (view) => {
      const html = await renderWithFlag('true', view);
      // The honest state: what the view does, that it needs the real backend,
      // and the one-liner that gets you there.
      expect(html).toContain('docker compose up');
      expect(html).toContain('github.com/natcat38/f1-race-tracker');
      // The optimistic lies this replaced (ui-ux B1, accessibility D-1).
      expect(html).not.toContain('Warming up the timing feed');
      expect(html).not.toContain('Connection lost');
      // The tabs stay: the features are real, so the nav keeps advertising them.
      expect(html).toContain('COMPARE');
      expect(html).toContain('OVERLAY');
    },
  );

  test.each(['Compare', 'Ghost', 'Settings'] as const)(
    '%s renders the real view when the flag is unset',
    async (view) => {
      const html = await renderWithFlag('', view);
      expect(html).not.toContain('docker compose up &&');
      expect(html).not.toContain('NEEDS THE FULL STACK');
    },
  );

  test('every route carries a link back to the repository', async () => {
    const { StatusRail } = await import('./StatusRail');
    const html = renderToStaticMarkup(<StatusRail active="board" />);
    expect(html).toContain('https://github.com/natcat38/f1-race-tracker');
  });
});
