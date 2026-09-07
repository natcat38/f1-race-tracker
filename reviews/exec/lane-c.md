# Lane C execution report (wave 1)

Branch: `cleanup/verified-backlog` (pre-existing checkout, no commits made per
instructions). Source: `reviews/plans/verified-cleanup-backlog.md` items 17, 9.

## #17 — Use Go builtins in `cmd/loadtest/hist.go`

`go.mod` pins `go 1.26.6` — well past 1.21, so the `min`/`max` builtins are
available. Replaced all four hand-rolled spots:

- `Add` (~:26-29): `if ms < 0 { ms = 0 }` → `ms = max(ms, 0)`; `if ms > h.max
  { h.max = ms }` → `h.max = max(h.max, ms)`.
- `Merge` (~:43): `if o.max > h.max { h.max = o.max }` → `h.max = max(h.max,
  o.max)`.
- `Percentile` (~:55-58): `if rank < 1 { rank = 1 }` → `rank = max(rank, 1)`;
  `if rank > h.count { rank = h.count }` → `rank = min(rank, h.count)`.

No behavior change, net -9 lines. `math` import stays (still used for
`math.Ceil`).

## #9 — Host-header / DNS-rebinding guard on the gateway

Verified current state matches the plan: `POST /control/source`
(`internal/app/gateway.go` `handleControl`) rejects a cross-site
`Sec-Fetch-Site` but explicitly allows the header being **absent**, and
`internal/config/config.go` defaults `ADDR` to `:8080` (all interfaces) —
loopback protection today is purely `docker-compose.yml`'s
`127.0.0.1:8080:8080` mapping. This is the same gap `reviews/security.md`
records as **L-1**: DNS rebinding re-resolves an attacker domain to loopback,
which makes the browser label the request `Sec-Fetch-Site: same-origin` and
slips past the existing guard entirely.

**Guard semantics implemented** — additive to the `Sec-Fetch-Site` check, on
`POST /control/source` only (the one state-changing control endpoint; `GET
/api/f1auth` and `/ws` were left alone as out of scope for this item):

- New `hostAllowed(reqHost string, extra map[string]bool) bool` in
  `internal/app/gateway.go`. Strips the port via `net.SplitHostPort` (falls
  back to the raw value if there's no port), lowercases, and allows
  unconditionally if the hostname is `localhost`, `127.0.0.1`, or `::1`.
  Otherwise checks membership in `extra`.
- `Gateway.allowedHosts map[string]bool` + `SetAllowedHosts([]string)`,
  mirroring the existing `allowedSessions`/`SetAllowedSessions` pattern
  exactly (no-op on empty input, call before serving).
- `handleControl`'s `POST` case now rejects with 403 `"unrecognized host"`
  when `hostAllowed(r.Host, g.allowedHosts)` is false — checked right after
  the existing `Sec-Fetch-Site` guard, which is unchanged.

**Config wiring** — followed the existing `env()`/`csv()` pattern in
`internal/config/config.go` exactly, no new parsing helper:

- `Config.AllowedHosts []string`, loaded via `csv("ALLOWED_HOSTS")` (same
  comma-separated/trim/empty-means-unset shape as `ALLOWED_SESSIONS`).
- `cmd/server/main.go`: `gw.SetAllowedHosts(cfg.AllowedHosts)` added right
  after the existing `gw.SetAllowedSessions(cfg.AllowedSessions)` call.

**Why this doesn't break the documented deployments:**

- docker-compose: gateway's `Host` header is `localhost:8080` or
  `127.0.0.1:8080` depending on how the client reaches it — both loopback,
  always allowed regardless of `ALLOWED_HOSTS`.
- Local `go run`: same — `ADDR=:8080` served, browser hits it via
  `localhost:8080`.
- Existing tests: `TestHandleControl_RejectsCrossSitePost` posts to
  `httptest.NewServer`'s URL, which listens on `127.0.0.1` — Host header is
  loopback, so the new check is a no-op there and the test still passes
  unmodified.

**Docs**: added `ALLOWED_HOSTS` to `.env.example` right after
`ALLOWED_SESSIONS` (the same file documents `ADDR`, `ALLOWED_ORIGINS`, etc. —
no other doc location mentions these env vars, so this is the complete
doc surface).

**Tests added**, following the existing style in `internal/app/gateway_test.go`
(table test + an httptest.NewServer-based handler test, both referencing the
L-1 finding by name like the file's other C2/S1/S3 comments):

- `TestHostAllowed` — table test: `localhost:8080`, `127.0.0.1:8080`,
  `127.0.0.1`, `[::1]:8080` all pass with no extra list; `evil.com` (with and
  without a port) fails with no extra list; `evil.com` / `EVIL.com:443` pass
  once `evil.com` is in the extra map (case-insensitive match confirmed).
- `TestHandleControl_RejectsForeignHost` — an end-to-end handler test:
  overrides `req.Host` to `evil.com` with `Sec-Fetch-Site: same-origin` set
  (the exact DNS-rebinding shape) → expects 403; the same request with
  `req.Host = "127.0.0.1"` → expects 200, confirming the documented
  deployment still works.
- `internal/config/config_test.go`: added `ALLOWED_HOSTS` to the
  `TestLoad_Defaults` unset-list, a new default-is-empty assertion, and
  `TestLoad_AllowedHostsFromEnv` (trims/splits, blank env → empty), mirroring
  `TestLoad_AllowedSessionsFromEnv` line for line.

## Verification

Run from the repo root:

```
gofmt -l .
go vet ./...
go test ./...
```

Results:

- `gofmt -l .` → no output (clean) both before and after all edits.
- `go vet ./...` → exit 0, no output.
- `go test ./...` → all packages `ok`, including `internal/app` (4 files, new
  host-guard tests among them), `internal/config` (new `ALLOWED_HOSTS`
  tests), and `cmd/loadtest` (histogram builtins).
- Targeted verbose runs confirmed the new tests actually execute and pass:
  `go test ./internal/app/... -run 'TestHostAllowed|TestHandleControl_RejectsForeignHost|TestHandleControl_RejectsCrossSitePost' -v`
  and
  `go test ./internal/config/... -run 'TestLoad_AllowedHostsFromEnv|TestLoad_Defaults' -v`
  — all PASS.
- `go test ./internal/app/... -race` → could not run: this environment has no
  C compiler (`CGO_ENABLED=1` required, cgo unavailable here). Not a
  regression — plain `go test ./...` already covers the new code, and CI's
  environment presumably has cgo available for the repo's other race-tagged
  tests.
- `staticcheck` — not installed in this environment; per instructions, did not
  install it and skipped rather than adding a new tool. (Another lane is
  wiring it into CI.)

## Left alone / out of scope

- `GET /api/f1auth` and `/ws` — `reviews/security.md` L-1 suggests covering
  these too, but item 9's own requirements scope the guard to "the
  state-changing control endpoint(s)"; `/control/source` POST is the only one.
  Flagging here rather than scope-creeping into read-only endpoints.
- Items 1–8, 10–16, 18–22 — other lanes' scope; unrelated files already showed
  modified in the working tree from prior/parallel lane work (`ingest/`,
  `web/src/`, `knowledge/index.md`, `docs/ux-evaluation-2026-07.md` deletion)
  and were not touched here.
- No new Go dependencies added; no commits made; no branch created.
