/**
 * The phone's sticky strip (F1-UX-2, F1-UX-4, F1-UX-5): the transport verb and
 * the section chips are rendered only where the phone breakpoint matches, the
 * verb names the action it will take, and a chip scrolls to its panel and opens
 * it when it is a collapsed <details>.
 *
 * @vitest-environment jsdom
 */

import { describe, test, expect, vi, afterEach } from 'vitest';
import { render, cleanup, screen, fireEvent } from '@testing-library/react';
import { StatusRail, type SectionLink, type StripTransport } from './StatusRail';
import { Panel } from './Panel';
import { emptyState } from '../state/race';

const state = { ...emptyState(), totalLaps: 53, weather: { trackTempC: 52, airTempC: 34, rainfall: false } };
const sections: SectionLink[] = [
  { id: 'track', label: 'Track' },
  { id: 'race-control', label: 'Race control' },
];

function stubPhone(matches: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('StatusRail on a phone', () => {
  test('carries the transport verb in the strip, named for the action it will take', () => {
    stubPhone(true);
    const onToggle = vi.fn();
    const transport: StripTransport = {
      playing: true, onToggle, pauseLabel: 'Pause replay', playLabel: 'Play replay', progress: 0.25,
    };
    const { rerender, container } = render(<StatusRail active="board" state={state} transport={transport} />);
    const strip = container.querySelector('.rail-strip');
    const pause = screen.getByRole('button', { name: 'Pause replay' });
    expect(strip?.contains(pause)).toBe(true);
    fireEvent.click(pause);
    expect(onToggle).toHaveBeenCalledTimes(1);

    rerender(<StatusRail active="board" state={state} transport={{ ...transport, playing: false }} />);
    expect(screen.getByRole('button', { name: 'Play replay' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Pause replay' })).toBeNull();
  });

  test('draws the replay position as a decorative line', () => {
    stubPhone(true);
    const transport: StripTransport = {
      playing: true, onToggle: () => {}, pauseLabel: 'Pause replay', playLabel: 'Play replay', progress: 0.5,
    };
    const { container } = render(<StatusRail active="board" state={state} transport={transport} />);
    const line = container.querySelector('.rail-progress');
    expect(line?.getAttribute('aria-hidden')).toBe('true');
    expect((container.querySelector('.rail-progress-fill') as HTMLElement).style.transform).toBe('scaleX(0.5)');
  });

  test('puts the weather on the session line instead of in a cluster of its own', () => {
    stubPhone(true);
    const { container } = render(<StatusRail active="board" state={state} />);
    expect(container.querySelector('.rail-conditions')).toBeNull();
    expect(container.querySelector('.rail-identity .rail-wx')?.textContent).toContain('52° / 34°');
  });

  test('a section chip scrolls to its panel, opens a collapsed one, and focuses its heading', () => {
    stubPhone(true);
    render(
      <>
        <StatusRail active="board" state={state} sections={sections} />
        <Panel label="Race Control" id="race-control" collapsed>body</Panel>
      </>,
    );
    const panel = document.getElementById('race-control') as HTMLDetailsElement;
    const scrollIntoView = vi.fn();
    panel.scrollIntoView = scrollIntoView;
    expect(panel.open).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'Race control' }));

    expect(panel.open).toBe(true);
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(document.activeElement?.tagName).toBe('H2');
    // The app routes on the hash; a chip must never touch it.
    expect(location.hash).toBe('');
  });
});

describe('StatusRail on a wider screen', () => {
  test('renders neither the strip transport nor the section chips', () => {
    stubPhone(false);
    const transport: StripTransport = {
      playing: true, onToggle: () => {}, pauseLabel: 'Pause replay', playLabel: 'Play replay',
    };
    const { container } = render(
      <StatusRail active="board" state={state} transport={transport} sections={sections} />,
    );
    expect(screen.queryByRole('button', { name: 'Pause replay' })).toBeNull();
    expect(container.querySelector('.rail-sections')).toBeNull();
    expect(container.querySelector('.rail-conditions')).not.toBeNull();
    expect(container.querySelector('.rail-wx')).toBeNull();
  });
});

describe('Panel collapsed', () => {
  test('is a closed <details> with the summary beside the title', () => {
    const { container } = render(
      <Panel label="Race Control" id="race-control" collapsed summary="3 messages">body</Panel>,
    );
    const details = container.querySelector('details') as HTMLDetailsElement;
    expect(details.open).toBe(false);
    expect(details.id).toBe('race-control');
    expect(details.querySelector('summary')?.textContent).toContain('Race Control');
    expect(details.querySelector('summary')?.textContent).toContain('3 messages');
  });

  test('is a plain section when not collapsed', () => {
    const { container } = render(<Panel label="Comms" id="comms">body</Panel>);
    expect(container.querySelector('details')).toBeNull();
    expect(container.querySelector('section#comms h2')?.getAttribute('tabindex')).toBe('-1');
  });
});
