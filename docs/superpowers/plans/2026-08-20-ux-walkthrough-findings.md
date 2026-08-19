# UX Walkthrough Findings — 2026-08-20

Evidence for `2026-08-20-ux-error-path-hardening.md` Task 1. No app code changed by this pass.

Format: `[route] [scenario] — observed — expected — severity`.

**Environment note.** The browser pane in this session could not composite frames, so
`requestAnimationFrame` never ran. `useSmoothedCars` (`web/src/hooks/useSmoothedCars.ts:48`)
publishes car positions from inside a rAF loop, so **car dots are frozen in every DOM sample
below**. This is an artifact of the harness, not a defect: the WebSocket payloads were sampled
directly and carried 51 distinct positions per 5 s window on both the board and the compare
lanes. Everything else (text, chips, tables, controls, SVG delta bars) renders from plain React
state and was verified normally. Anything depending purely on animation smoothness is marked
*unverified* rather than passed.

Stack: `docker compose up --build -d` at `http://localhost:8080` for good paths;
`npm run dev` at `http://localhost:5173` with no gateway for bad paths;
`VITE_STATIC_DEMO=true npx vite --port 5174` for the static demo.

---

## Board (`/`)

- **Board, no backend** — status chip `↺ Reconnecting…`, skeleton `Warming up the timing feed…`, console shows only expected `connectRace: socket error` / WebSocket-failed lines, no unhandled exceptions — matches expectation — *no defect*.
- **Board, no backend, chip flickers** — the chip alternates between `↺ Reconnecting…` and `⏳ Warming up the timing feed…` roughly every backoff cycle. `connectRace`'s `open()` emits `'connecting'` at the top of *every* retry (`web/src/realtime/socket.ts:27`), immediately overwriting the `'reconnecting'` that `onclose` just emitted — expected a stable "we are trying to reconnect" state — **confusing**. See *Not covered by this plan #1*.
- **Timing panel, no cars** — bare `<table>` with headers only, plus a live but pointless `Show seconds` toggle, the gap/int footnote and the tyre legend, and no explanatory copy — expected a short empty-state line — **confusing**. KNOWN GAP, Task 4.
- **Board, snapshot without a track outline** — not reproducible against the real gateway (every session ships a track), so verified by code reading only: `App.tsx:59` gates the skeleton on `state.rev === 0` alone, so a track-less snapshot would draw an empty `<svg>` with no explanation — expected the warm-up skeleton to stay — **confusing**. KNOWN GAP, Task 7.
- **Board, full stack** — chip `▶ REPLAY`, clock ticks (1:13:25 → 1:13:28 over 2.5 s), `LAP 13/53`, weather `TRK 48° · AIR 33°`, 20 timing rows, 20 car markers present — matches expectation — *no defect* (map motion *unverified*, see environment note).
- **Car selection** — clicking a timing row populates telemetry (`PIA McLaren · 306 km/h · G8 · DRS`, throttle/brake bars); picking `LEC` as rival renders a second telemetry block with its own readouts — matches expectation — *no defect*.
- **Source toggle** — `● Live (demo)` switches the session to `Silverstone 2024 · Race` and the chip to `● LIVE (DEMO)`; switching back returns `Monza 2024 · Race` / `▶ REPLAY`; no error text either way. The `Switching…` pending label was not observable — the round trip completes in well under 300 ms — matches expectation — *no defect*.
- **Mid-session disconnect (`docker compose stop gateway`)** — the chip stays on `⚠ Waiting for timing data — last frame Ns ago` for the entire outage and the map's `↺ Reconnecting…` overlay never appears at all (sampled every 700 ms for 30 s: zero occurrences) — expected `↺ Reconnecting…` within ~1 s — **blocker**. Same root cause as the flicker above. See *Not covered by this plan #1*.
- **Mid-session reconnect (`docker compose start gateway`)** — recovers to live data with no page reload; took ~20 s, consistent with the 8 s backoff cap plus container start — matches expectation — *no defect*.
- **Console after every board scenario** — no uncaught exceptions and no unhandled rejections — *no defect*.

## Comms (Board → Comms panel)

- **Comms OFF** — `Radio clips play automatically when comms is on.` — matches expectation — *no defect*.
- **Comms ON, before any clip** — `No radio yet — clips play as the replay reaches them.` — matches expectation — *no defect*.
- **Comms ON, clips reached** — history fills newest-first (`LEC ▶`, `NOR ▶`, later `SAI`/`PER`); the clips themselves auto-skipped because they were already stale against the race clock, so no now-playing banner appeared. That skip is correct-by-design and explicitly out of scope — *no defect*.
- **History ▶ button** — plays the clip from the F1 CDN and shows the now-playing banner (`LEC · radio · ↻`); the banner clears on `ended` — matches expectation — *no defect*.
- **Now-playing ↻ button** — restarts the clip, banner stays — matches expectation — *no defect*.
- **Blocked (non-allowlisted) clip URL** — not reachable from real data; verified by code reading: `useComms.ts:129-131` logs a `console.warn` and returns, so the ▶/↻ button visibly does nothing — expected an error banner — **confusing**. KNOWN GAP, Task 5.

## `#compare`

- **Compare, no backend** — both lanes render a `Warming up the timing feed…` skeleton with a per-lane chip. Sampling the chips over ~5 s returned all three combinations of `↺ Reconnecting…` and `⏳ Warming up the timing feed…` across the two lanes — expected a stable per-lane reconnect indication — **confusing**. Same root cause as *Not covered by this plan #1*.
- **Compare, full stack** — both lanes show `▶ REPLAY`, correct labels (`Monza 2023 · Race`, `Monza 2024 · Race`), 20 car markers each, and full standings under each map — matches expectation — *no defect* (map motion *unverified*, see environment note; wire data confirmed live for both lanes).

## `#ghost`

- **Ghost, no backend** — `Loading reference laps…` forever, with no connection feedback at all: `Ghost.tsx:18-19` passes `undefined` for `onStatus` — expected some indication that the connection is down — **blocker**. KNOWN GAP, Task 3.
- **Ghost, full stack** — 17 common drivers in the dropdown, track overlay renders with the selected driver's code, delta bar renders 150 bars, pause and scrubber enabled — matches expectation — *no defect*.
- **Ghost controls** — selecting `LEC` switches the track label to `LEC`; `⏸ Pause` toggles to `▶ Play`; scrubbing to 30 000 ms shows `0:30.000` and a delta of `-0.80s` — matches expectation — *no defect*.

## `#settings`

- **Settings, no backend** — `/api/f1auth` fails and the panel renders the `UNAVAILABLE` state plus `Next: can't reach the link status — the gateway or the ingest service is probably down. Check docker compose ps.` No crash, no blank page, and the whole sign-in walkthrough still renders — matches expectation — *no defect*.
- **Route teardown** — instrumented `window.WebSocket` on `#settings` for 6 s after visiting `#compare`: zero new sockets opened, so the compare lanes' reconnect loops are properly torn down on unmount. Earlier `compare-monza-2023/2024` console errors were historical, not live retries — *no defect*.

## Static demo

- **Static demo, clip not baked** — chip `↺ Reconnecting…` permanently, over a permanent `Warming up the timing feed…` skeleton, on a page with nothing to reconnect to — expected copy that says the demo data could not be loaded — **blocker**. KNOWN GAP, Task 2.
- **Static demo, clip baked** (`go run ./cmd/bake-static …`, 24 MB NDJSON) — replay plays: `Monza 2024 · Race`, clock `1:12:59`, `LAP 13/53`, chip `▶ REPLAY`, 20 timing rows, full stint chart — matches expectation — *no defect*.

---

## Not covered by this plan

1. **A dead connection never says so; it reads as a slow feed.** `connectRace`'s `open()` calls `onStatus?.('connecting')` at the top of every reconnect attempt (`web/src/realtime/socket.ts:27`), which immediately overwrites the `'reconnecting'` that `onclose` emitted one tick earlier. `StatusBadge` has no `'connecting'` branch, so once a session has data (`state.rev > 0`) an outage falls through to `⚠ Waiting for timing data — last frame Ns ago` — which describes a stalled feed, not a lost connection — and `App.tsx:69`'s `↺ Reconnecting…` map overlay never renders at all. Before any data has arrived the same race makes the chip flicker between `Reconnecting…` and `Warming up…`. Severity **blocker**: the board silently misreports a dead backend for the whole outage. Likely fix: emit `'connecting'` only for the first attempt, or add a distinct `'retrying'` state that survives the retry. Fixing this changes `ConnStatus` semantics and would collide with Task 2's edits to the same union, so it is deliberately left out of this plan.

2. **Two cars share position 19 in the timing tower.** In the static-demo replay at lap 13, `TSU` and `HUL` both render as `19` and no row shows `20`. Data/ordering issue in `orderCars` or upstream, not an error-path UX gap. Severity **cosmetic**.

3. **Empty `Driver` dropdown on `#ghost` before data arrives.** With no backend the select renders with zero options and no placeholder, next to a disabled `⏸ Pause` (which implies something is playing). Task 3 fixes the skeleton copy above it but not the controls. Severity **cosmetic**.
