/**
 * Build-time identity of the public GitHub Pages demo, and the repo it came from.
 * @packageDocumentation
 */

// VITE_STATIC_DEMO=true selects the file-backed static player instead of a real
// WebSocket connection, and is set only by the GitHub Pages build
// (.github/workflows/pages.yml). docker-compose and local dev never set it, so
// they always get the full live app. Every view that needs the gateway reads
// this one constant rather than re-deriving the flag.
export const STATIC_DEMO = import.meta.env.VITE_STATIC_DEMO === 'true';

export const REPO_URL = 'https://github.com/natcat38/f1-race-tracker';

// The one-liner the static-demo panels and the README both point at. Kept here
// so the copy can never drift between the views that quote it.
export const RUN_CMD = 'git clone https://github.com/natcat38/f1-race-tracker && cd f1-race-tracker && docker compose up';

// One sentence on what the system actually is — the engineering story the demo
// otherwise leaves invisible (ui-ux review M15).
export const STACK_LINE =
  'Python ingest normalises the timing feed into Redis, a Go gateway fans it out over WebSocket, and this React board renders it.';
