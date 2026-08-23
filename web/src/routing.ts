// The app's hash routing: which view a URL names, which car it pre-selects, and which
// pair of laps the overlay opens on.

// The three views. 'board' is the default because the board's own tab links to a
// bare '#' — the hash a browser lands on with no fragment at all is the board,
// and so is an explicit '#board'. '#compare' is gone (ADR-0009) but is still
// answered, below: links to it exist in the wild.
export type RouteName = 'board' | 'ghost' | 'settings';

const ROUTES: RouteName[] = ['board', 'ghost', 'settings'];

// Retired route names and where they now land. COMPARE folded into OVERLAY, so a
// '#compare' bookmark opens the view that absorbed it rather than silently falling
// back to the board.
const REDIRECTS: Record<string, RouteName> = { compare: 'ghost' };

// Driver codes on the wire are FIA three-letter abbreviations (VER, HAM), but a
// session that has not published one yet falls back to a car number, so two to
// four alphanumerics is the honest shape. Anything else in ?car= is somebody
// else's URL or a typo, and is dropped rather than used to search the field —
// the parse must never hand a caller a value it would then have to re-validate.
const CAR_CODE = /^[A-Z0-9]{2,4}$/;

// A session slug from the overlay catalogue (web/src/state/sessions.ts): lowercase
// words and digits joined by hyphens, e.g. `monza-2024`. Validated by shape here
// and resolved against the catalogue by the caller — routing must not import the
// catalogue, or the two would have to agree on a build-time flag (STATIC_DEMO)
// that has nothing to do with parsing a URL.
const SESSION_SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** One side of the overlay: which session, and which driver in it. */
export interface OverlaySide {
  session: string;
  car: string;
}

export interface ParsedHash {
  route: RouteName;
  /** Uppercased driver code from `?car=`, or null when absent or malformed. */
  car: string | null;
  /** `?a=<slug>:<CODE>` — the overlay's solid side, or null. */
  a: OverlaySide | null;
  /** `?b=<slug>:<CODE>` — the overlay's ghost side, or null. */
  b: OverlaySide | null;
}

function parseCode(value: string | null | undefined): string | null {
  // Uppercased before the test, so a shared `#board?car=ver` works: driver
  // codes are conventionally upper case but a URL typed by hand rarely is.
  const code = value?.toUpperCase() ?? '';
  return CAR_CODE.test(code) ? code : null;
}

// parseSide reads `<slug>:<CODE>`. Both halves must be well-formed or the whole
// side is dropped: half a side is not a comparison, and a caller handed
// `{session, car:null}` would just have to invent the missing half anyway.
function parseSide(value: string | null): OverlaySide | null {
  if (!value) return null;
  const sep = value.indexOf(':');
  if (sep === -1) return null;
  const session = value.slice(0, sep).toLowerCase();
  const car = parseCode(value.slice(sep + 1));
  if (!SESSION_SLUG.test(session) || !car) return null;
  return { session, car };
}

// parseHash reads a location.hash into a route and its parameters. Unknown routes
// fall back to the board rather than rendering nothing, because a stale or
// hand-edited URL should land somewhere real.
export function parseHash(hash: string): ParsedHash {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  const q = raw.indexOf('?');
  const name = (q === -1 ? raw : raw.slice(0, q)).toLowerCase();
  const route = (ROUTES as string[]).includes(name)
    ? (name as RouteName)
    : REDIRECTS[name] ?? 'board';

  let car: string | null = null;
  let a: OverlaySide | null = null;
  let b: OverlaySide | null = null;
  if (q !== -1) {
    const params = new URLSearchParams(raw.slice(q + 1));
    car = parseCode(params.get('car'));
    a = parseSide(params.get('a'));
    b = parseSide(params.get('b'));
  }
  return { route, car, a, b };
}

function side(value: OverlaySide): string {
  return `${encodeURIComponent(value.session)}:${encodeURIComponent(value.car)}`;
}

// buildHash is parseHash's inverse: the shortest hash that round-trips.
// The board with no selection is a bare '#', which is exactly what the BOARD tab
// already links to — so the common case leaves the URL looking untouched, and
// only a deliberate selection lengthens it.
export function buildHash({ route, car, a, b }: Partial<ParsedHash> & { route: RouteName }): string {
  const parts: string[] = [];
  if (car) parts.push(`car=${encodeURIComponent(car)}`);
  // Both overlay sides or neither: one side alone is not a comparison, and the
  // route would have to default the other half on load anyway.
  if (a && b) parts.push(`a=${side(a)}`, `b=${side(b)}`);
  const query = parts.length ? `?${parts.join('&')}` : '';
  if (route === 'board') return query ? `#board${query}` : '#';
  return `#${route}${query}`;
}
