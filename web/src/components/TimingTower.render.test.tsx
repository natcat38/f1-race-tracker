import { describe, test, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { TimingTower } from './TimingTower';
import { emptyState } from '../state/race';

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
