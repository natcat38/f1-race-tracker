// The app's hash routing: which view a URL names, and which car it pre-selects.

// The four views. 'board' is the default because the board's own tab links to a
// bare '#' — the hash a browser lands on with no fragment at all is the board,
// and so is an explicit '#board'.
export type RouteName = 'board' | 'compare' | 'ghost' | 'settings';

const ROUTES: RouteName[] = ['board', 'compare', 'ghost', 'settings'];

// Driver codes on the wire are FIA three-letter abbreviations (VER, HAM), but a
// session that has not published one yet falls back to a car number, so two to
// four alphanumerics is the honest shape. Anything else in ?car= is somebody
// else's URL or a typo, and is dropped rather than used to search the field —
// the parse must never hand a caller a value it would then have to re-validate.
const CAR_CODE = /^[A-Z0-9]{2,4}$/;

export interface ParsedHash {
  route: RouteName;
  /** Uppercased driver code from `?car=`, or null when absent or malformed. */
  car: string | null;
}

// parseHash reads a location.hash into a route and an optional car selection.
// Unknown routes fall back to the board rather than rendering nothing, because
// a stale or hand-edited URL should land somewhere real.
export function parseHash(hash: string): ParsedHash {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  const q = raw.indexOf('?');
  const name = (q === -1 ? raw : raw.slice(0, q)).toLowerCase();
  const route = (ROUTES as string[]).includes(name) ? (name as RouteName) : 'board';

  let car: string | null = null;
  if (q !== -1) {
    const value = new URLSearchParams(raw.slice(q + 1)).get('car');
    // Uppercased before the test, so a shared `#board?car=ver` works: driver
    // codes are conventionally upper case but a URL typed by hand rarely is.
    const code = value?.toUpperCase() ?? '';
    if (CAR_CODE.test(code)) car = code;
  }
  return { route, car };
}

// buildHash is parseHash's inverse: the shortest hash that round-trips.
// The board with no selection is a bare '#', which is exactly what the BOARD tab
// already links to — so the common case leaves the URL looking untouched, and
// only a deliberate selection lengthens it.
export function buildHash({ route, car }: ParsedHash): string {
  const query = car ? `?car=${encodeURIComponent(car)}` : '';
  if (route === 'board') return query ? `#board${query}` : '#';
  return `#${route}${query}`;
}
