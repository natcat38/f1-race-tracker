import { describe, expect, test } from 'vitest';
import { parseAuthStatus, relativeExpiry } from './f1auth';

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

describe('relativeExpiry', () => {
  const now = Date.parse('2026-08-20T00:00:00Z');
  const at = (iso: string) => relativeExpiry(iso, now);

  test('counts down in the unit that is actually useful', () => {
    expect(at('2026-08-23T00:00:00Z')).toBe('in 3 days');
    expect(at('2026-08-21T00:00:00Z')).toBe('in 24 hours');
    expect(at('2026-08-20T05:00:00Z')).toBe('in 5 hours');
    expect(at('2026-08-20T01:00:00Z')).toBe('in 1 hour');
    expect(at('2026-08-20T00:30:00Z')).toBe('in 30 min');
  });

  test('a past date reads as expired, not a negative countdown', () => {
    expect(at('2026-08-19T00:00:00Z')).toBe('expired');
  });

  test('missing or unparseable dates yield null rather than NaN text', () => {
    expect(relativeExpiry(undefined, now)).toBeNull();
    expect(relativeExpiry('not a date', now)).toBeNull();
  });
});
