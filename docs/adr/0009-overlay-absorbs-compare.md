<!-- ADR-0009: the ghost overlay absorbs the side-by-side COMPARE view and addresses each side as a (session, driver) pair. -->

# 0009 — The ghost overlay absorbs COMPARE

**Status:** accepted

## Context

The app shipped two comparison views over the same two `compare-*` lanes:

- **COMPARE** (`#compare`) — two maps side by side, one socket each. No shared clock,
  no delta, no driver or season selection, and no link into the other view. It renders
  a second standings grammar (`Standings.tsx`) that exists nowhere else in the app.
- **OVERLAY** (`#ghost`) — one map, two markers, a computed per-index delta from the
  baked **lap traces** (ADR-0004). Hardwired to one driver across the two Monza
  seasons: two module constants, no pickers.

COMPARE only gestured at what OVERLAY computes. Two design reviews name it unfinished.

Meanwhile the more useful comparison — two drivers in the *same* race — was never in
the UI, despite the data already being there. ADR-0004's recorder bakes a `lapTrace`
for **every** driver with an accurate lap, and the whole map rides every **snapshot**.
`deltaSeries` is an element-wise subtraction of two `number[]`; it does not care
whether the two traces came from two lanes or one. So VER-vs-LEC at Monza 2024 needs
no ingest, no gateway and no compose change — only a frontend that can address a
driver per side.

## Decision

**One comparison view.** COMPARE is deleted; the tab set is BOARD / OVERLAY / SETTINGS
and `#compare` redirects to `#ghost` rather than falling back to the board, because
links to it exist in the wild.

**A side is a `(session, driver)` pair.** Both sides are picked independently from a
small static catalogue (`web/src/state/sessions.ts`) that mirrors the gateway
allowlist, and from the drivers that lane actually has a trace for. This spans both
axes with one mechanism:

- different sessions, same driver → the cross-season comparison, as before;
- same session, different drivers → the new one, free.

**One socket per distinct session key.** A refcounted lane registry
(`web/src/realtime/lanes.ts`, bound by `useLane`) means both sides naming one session
share one connection. The same-session case therefore costs no more than the board.

**State lives in the hash** — `#ghost?a=<slug>:<CODE>&b=<slug>:<CODE>`, written with
`replaceState` so a picker change does not bury the previous page under Back presses.
Slugs are kept separate from the gateway session keys so a shared URL never carries
the legacy `compare-` prefix.

**The approximation is stated on screen.** Across seasons the ghost is placed on side
A's outline — the two clips are normalised independently — so the view says positions
are approximate and the delta is exact. Within one session both are exact. It also
says that each side is that driver's *fastest accurate lap of the session*, not two
cars racing wheel to wheel.

**The backend is untouched.** Both compose lanes, both `compare-monza-*` session keys,
`ALLOWED_SESSIONS`, and ADR-0004's baked-trace contract stay exactly as they are —
they are the cross-season *sources*. The `compare-` prefix is now a historical name.

## Consequences

- **The overlay works on the public Pages demo.** The static build bakes one clip
  (ADR-0006), whose snapshot carries every driver's trace — so the driver-vs-driver
  scenario runs entirely client-side. The route stops being a "not in this demo" card
  and becomes the first analytics view that actually runs there. The catalogue holds
  one entry under `STATIC_DEMO`, and the view says plainly that cross-season needs the
  second lane.
- **Deleted:** `Compare.tsx`, `Standings.tsx` (+ its test), the COMPARE tab and route,
  `.compare-lanes` / `.lane-body` / `.standings*` CSS. The app has one standings
  grammar again.
- **Two markers need two colours.** The old single team colour was only ever legible
  because a driver was being compared with himself.
- **`docs/assets/compare.png` no longer depicts a shipped view** and is dropped from
  the README.
- ADR-0004 is **referenced, not superseded**: baked traces plus a frontend subtraction
  is exactly what made the same-lane case free.

## Considered and rejected

- **Keep COMPARE and give it a shared-lap delta.** Cheapest fix for the review
  findings, but leaves four tabs, two standings grammars, and two sockets doing what
  one can — and still does not serve the two-driver case.
- **Keep side-by-side as an OVERLAY sub-mode.** Preserves the two-map visual at the
  cost of keeping `Standings.tsx`, the alternate grammar, and one more mode to test.
  One map with two markers is strictly more comparative.
- **Rename the `compare-*` lane keys to `monza-2023` / `monza-2024`.** Correct
  eventually, but it churns compose, the gateway defaults, Go tests and the README for
  a name. Deliberately deferred; the URL slugs already hide the legacy prefix.
