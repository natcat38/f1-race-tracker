# web — F1 Race Tracker frontend

Vite + React + TypeScript SPA. Renders the live track map, timing tower, team-radio
comms, and cross-year ghost overlay from the gateway's WebSocket stream.

The built output (`dist/`) is embedded into the Go gateway binary via `web/embed.go`
(`go:embed`), so a production build is served by the gateway itself — there is no
separate web host. See the repo root `README.md` for the full architecture.

## Scripts

- `npm run dev` — dev server with HMR (proxies `/ws` and `/control` to `localhost:8080`)
- `npm run build` — type-check (`tsc -b`) then `vite build` into `dist/`
- `npm run lint` — ESLint (CI runs with `--max-warnings 0`)
- `npm test` — Vitest

## Layout

- `src/realtime/` — reconnecting WebSocket client
- `src/state/` — pure reducers over the wire contract (`race`, `comms`, `ghost`)
- `src/components/` — map, timing tower, standings, comms, compare, ghost, telemetry
- `src/hooks/` — car-position smoothing, comms cursor
