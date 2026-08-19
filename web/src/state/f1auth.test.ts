import { describe, expect, test } from 'vitest';
import { parseAuthStatus } from './f1auth';

describe('parseAuthStatus', () => {
  test('passes through a valid linked status', () => {
    expect(parseAuthStatus({
      state: 'linked', expiresUtc: '2026-09-01T00:00:00+00:00', tier: 'active', product: 'F1 TV Premium',
    })).toEqual({
      state: 'linked', expiresUtc: '2026-09-01T00:00:00+00:00', tier: 'active', product: 'F1 TV Premium',
    });
  });

  test('accepts the bare states the writer publishes', () => {
    expect(parseAuthStatus({ state: 'unlinked' })).toEqual({ state: 'unlinked' });
    expect(parseAuthStatus({ state: 'expired' })).toEqual({ state: 'expired' });
  });

  test('maps unknown states and garbage to unavailable', () => {
    expect(parseAuthStatus({ state: 'weird' }).state).toBe('unavailable');
    expect(parseAuthStatus({}).state).toBe('unavailable');
    expect(parseAuthStatus(null).state).toBe('unavailable');
    expect(parseAuthStatus('x').state).toBe('unavailable');
    expect(parseAuthStatus(['linked']).state).toBe('unavailable');
  });

  test('drops non-string optional fields rather than rendering them', () => {
    const st = parseAuthStatus({ state: 'linked', expiresUtc: 12345, tier: { a: 1 } });
    expect(st).toEqual({ state: 'linked' });
  });
});
