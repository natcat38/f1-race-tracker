/**
 * F1TV beta auth status served by /api/f1auth (ADR-0007). Untrusted wire data,
 * validated here before render — the same discipline as race.ts's parseMsg.
 * Status only: the token never leaves the host, so nothing here can carry one.
 */
export type AuthState = 'unlinked' | 'linked' | 'expired' | 'unavailable';

export interface AuthStatus {
  state: AuthState;
  expiresUtc?: string;
  tier?: string;
  product?: string;
}

// 'unavailable' is frontend-only: it means we could not read a status at all
// (no gateway, no ingester, garbage on the wire) — distinct from a confident
// 'unlinked', which is a real answer from the seam.
const KNOWN: string[] = ['unlinked', 'linked', 'expired'];

export function parseAuthStatus(raw: unknown): AuthStatus {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { state: 'unavailable' };
  const r = raw as Record<string, unknown>;
  if (typeof r.state !== 'string' || !KNOWN.includes(r.state)) return { state: 'unavailable' };
  const out: AuthStatus = { state: r.state as AuthState };
  if (typeof r.expiresUtc === 'string') out.expiresUtc = r.expiresUtc;
  if (typeof r.tier === 'string') out.tier = r.tier;
  if (typeof r.product === 'string') out.product = r.product;
  return out;
}

/** Human-readable time until a token expires, e.g. "in 3 days" / "in 5 hours".
 *  Tokens last about four days, so a raw ISO timestamp tells the operator nothing
 *  actionable — this answers "do I need to re-link now?" at a glance.
 *  Returns null when there is no usable date. */
export function relativeExpiry(expiresUtc: string | undefined, now = Date.now()): string | null {
  if (!expiresUtc) return null;
  const ms = Date.parse(expiresUtc);
  if (Number.isNaN(ms)) return null;
  const left = ms - now;
  if (left <= 0) return 'expired';
  const mins = Math.floor(left / 60000);
  if (mins < 60) return `in ${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) return `in ${hours} hour${hours === 1 ? '' : 's'}`;
  return `in ${Math.floor(hours / 24)} days`;
}
