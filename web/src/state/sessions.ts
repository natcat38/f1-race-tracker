// The overlay's source catalogue: the sessions a comparison side may name, and the
// short slugs that address them in a URL.

import { STATIC_DEMO } from '../staticDemo';

// One entry per lane the overlay can pull a reference lap from.
//
//   key   — the gateway session key (`/ws?session=`). Historical: the `compare-*`
//           prefix dates from the deleted COMPARE view (see ADR-0009); the lanes,
//           the compose services and the gateway allowlist are unchanged, so the
//           keys stay as they are rather than churning the backend for a name.
//   slug  — the stable short id that appears in `#ghost?a=<slug>:<CODE>`. Kept
//           separate from `key` so a shared URL never carries a legacy prefix, and
//           so renaming a lane later cannot break existing links.
export interface SessionEntry {
  slug: string;
  key: string;
  circuit: string;
  year: string;
  label: string;
}

const MONZA_2024: SessionEntry = {
  slug: 'monza-2024', key: 'compare-monza-2024', circuit: 'Monza', year: '2024', label: 'Monza 2024',
};
const MONZA_2023: SessionEntry = {
  slug: 'monza-2023', key: 'compare-monza-2023', circuit: 'Monza', year: '2023', label: 'Monza 2023',
};

// The static Pages build bakes exactly one clip (cmd/bake-static → Monza 2024), so
// the catalogue is one entry there. That single entry is enough for the whole
// driver-vs-driver scenario, because every snapshot carries every driver's lap
// trace — which is what makes the overlay the first analytics view that actually
// runs on the public demo instead of showing a "not in this demo" card.
export const SESSIONS: SessionEntry[] = STATIC_DEMO ? [MONZA_2024] : [MONZA_2024, MONZA_2023];

export const DEFAULT_SESSION = SESSIONS[0];

export function sessionBySlug(slug: string): SessionEntry | undefined {
  return SESSIONS.find((s) => s.slug === slug);
}

// crossSeason: the two sides come from different years, so one marker is being
// drawn on the other season's track outline. The clips are normalised
// independently, so that placement is an approximation and the UI must say so.
export function crossSeason(a: SessionEntry, b: SessionEntry): boolean {
  return a.year !== b.year;
}
