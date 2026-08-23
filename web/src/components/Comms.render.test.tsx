// Render tests for the Comms panel's radio on/off control.

import { describe, test, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Comms } from './Comms';
import { emptyState } from '../state/race';

describe('Comms radio control', () => {
  test('the on/off toggle is a labelled radiogroup, not a self-swapping button (M13)', () => {
    const html = renderToStaticMarkup(<Comms state={emptyState()} />);
    expect(html).toContain('role="radiogroup"');
    expect(html).toContain('aria-label="Team radio"');
    expect(html).toContain('class="rail-scope"');
    expect(html).toContain('Radio');
    expect(html.match(/role="radio"/g)).toHaveLength(2);
    expect(html).not.toContain('>Comms<');
  });

  test('defaults to the Off segment checked', () => {
    const html = renderToStaticMarkup(<Comms state={emptyState()} />);
    const offButton = html.slice(html.lastIndexOf('<button', html.indexOf('>Off<')));
    const onButton = html.slice(html.lastIndexOf('<button', html.indexOf('>On<')));
    expect(offButton.split('>')[0]).toContain('aria-checked="true"');
    expect(onButton.split('>')[0]).toContain('aria-checked="false"');
  });
});
