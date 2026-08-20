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
});
