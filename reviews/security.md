# Security Review — f1-race-tracker

**Date:** 2026-08-21
**Scope:** Entire repository at `main` @ `7af1f61` (working tree clean).
**Method:** Manual read-through of every security-relevant file, following the
`security-review` skill's methodology but widened from "pending diff" to whole-repo.
Every finding below was verified against the actual file contents on disk — nothing
here is inferred from documentation alone.
**Nothing was modified.** This is a report-only pass.

---

## Summary

| Severity | Count |
|---|---|
| Critical | 0 |
| High | 1 |
| Medium | 2 |
| Low | 6 |
| Informational | 7 |

**Top 3:**

1. **H-1** — `.dockerignore` does not exclude `secrets/`, so the real F1TV JWT
   currently sitting in `secrets/fastf1/f1auth.json` gets copied into Docker
   build-stage image layers by `Dockerfile:14`'s `COPY . .`.
2. **M-1** — `docker-compose.yml:55` publishes the gateway on `0.0.0.0:8080`, exposing
   it to the whole LAN, while every other control in the codebase (origin allowlist,
   `Sec-Fetch-Site` CSRF guard, SECURITY.md's threat model) assumes loopback-only use.
3. **M-2** — `.github/workflows/okf.yml` has no `permissions:` block, handing a
   potentially write-scoped `GITHUB_TOKEN` to a third-party action pinned by a
   mutable tag.

Overall this is a well-defended codebase. Deserialization, command injection, path
traversal, SSRF, XSS sinks, and credential handling all came back clean on direct
inspection, and several controls (the `formula1.com` clip-URL allowlist enforced on
*both* sides of the seam, the `/ws?session=` registry bound, the three-gate live
opt-in) are genuinely above the bar for a portfolio project. The findings are
concentrated in packaging and CI rather than in application logic.

---

## High

### H-1 — F1TV auth token is copied into Docker build-stage image layers

* **Severity:** High
* **Category:** `secrets_exposure`
* **Location:** `.dockerignore:1-12` (omission) together with `Dockerfile:14`
* **Also contradicts:** `README.md:66-67`, `docs/adr/0007-f1tv-auth-delegated-operator-link.md`

**What's wrong.** `Dockerfile:14` is:

```dockerfile
COPY . .
```

…copying the entire build context into the `build` stage. `.dockerignore` excludes
`.git/`, `.venv/`, `node_modules/`, `web/dist/`, `web/.vite/`, `cache/`, `.fastf1/`,
`*.exe`, `*.test`, `*.out`, `.playwright-mcp/`, and `*.png` — but **not `secrets/`**,
even though `.gitignore:43` excludes it from git with the comment "Host-linked F1TV
token for the beta live path (ADR-0007) — never committed."

This is not hypothetical. `secrets/fastf1/f1auth.json` exists in this working tree
right now (1937 bytes — a real JWT, confirmed git-ignored via `git check-ignore`).
Four compose services (`replay`, `compare-2023`, `compare-2024`, `gateway`) build from
this Dockerfile via `build: .`, so `docker compose up --build` — the exact command
`README.md:34` instructs the reader to run — bakes the operator's live F1TV bearer
token into an intermediate image layer of all four.

The final `distroless` stage only pulls `/server` and `/src/data` forward
(`Dockerfile:20-21`), so the *running container* does not carry the token. But the
intermediate layer persists in the local image cache, is readable via
`docker history --no-trunc` / `docker save`, and would escape entirely if a BuildKit
cache export were ever added to CI. `README.md:66-67` claims the token "never leaves
your machine, is never logged, and is never sent to the frontend" — baking it into a
Docker layer is a materially different and worse exposure than a gitignored host file.

**Fix.** Add to `.dockerignore`:

```
secrets/
.env
```

`.env` is the same class of gap: it's gitignored (`.gitignore:14`) and `.env.example:8`
shows it carries `REDIS_URL`, which in any non-toy deployment holds a password.

---

## Medium

### M-1 — Gateway published on all interfaces, not loopback

* **Severity:** Medium
* **Category:** `exposed_service`
* **Location:** `docker-compose.yml:55` — `ports: ["8080:8080"]`

**What's wrong.** Docker's default publish semantics bind `0.0.0.0:8080` on the host,
so the gateway is reachable from any device on the same LAN (coffee-shop Wi-Fi,
shared office network, a compromised IoT device). This is inconsistent with the app's
own stated threat model in three places:

* `SECURITY.md:3-4` — "a self-hosted app you run locally... there is no public deployment to protect"
* `.env.example:26-28` and `internal/config/config.go:71-76` — the WebSocket origin allowlist defaults to `localhost:*,127.0.0.1:*`
* `internal/app/gateway.go:241-245` — the `/control/source` CSRF guard is comment-scoped to browser clients, with the explicit note "pair with a shared secret if ever internet-exposed"

An `Origin` allowlist protects against *browser*-originated cross-site requests. It
does nothing against a direct connection from a LAN peer using `curl` or a raw
WebSocket library — and `coder/websocket`'s `authenticateOrigin` (`accept.go:230-232`)
returns `nil` when the `Origin` header is absent, which non-browser clients simply
omit. A LAN peer can therefore stream `/ws` and `POST /control/source` freely.

Impact is bounded (the data is public replay telemetry; the worst action is flipping
which demo lane everyone sees), which is why this is Medium and not High. But the
exposure directly undercuts the local-only framing the rest of the repo relies on.

**Fix.** `ports: ["127.0.0.1:8080:8080"]`. If LAN exposure is wanted for demos, say so
explicitly in the README next to the `ALLOWED_ORIGINS` note, and add a shared-secret
check to `handleControl` as its own comment already suggests.

### M-2 — `okf.yml` grants default (possibly write) `GITHUB_TOKEN` to a third-party action

* **Severity:** Medium
* **Category:** `ci_supply_chain`
* **Location:** `.github/workflows/okf.yml` (whole file — no `permissions:` key), line 15

**What's wrong.** `ci.yml:6-7` sets `permissions: contents: read` and `pages.yml:14-17`
scopes to exactly what `deploy-pages` needs. `okf.yml` sets **no** `permissions:` block
at all, so `GITHUB_TOKEN` inherits the repository/org default — which for repos created
before GitHub's default flipped, or orgs that haven't tightened it, is read/write across
contents, issues, packages, and more.

That token is then handed to `natcat38/okf-portfolio-standard@v1` (line 15), a
third-party action referenced by a **mutable tag**. Anyone with push access to that
repo — or anyone who compromises that account — can repoint `v1` and execute arbitrary
code against this repository with whatever the default token grants. The workflow
triggers on `push` (line 3), where the token is not force-downgraded the way it is for
fork PRs.

**Fix.** Add to `okf.yml`, matching the other two workflows:

```yaml
permissions:
  contents: read
```

and pin the action to a full commit SHA (see L-4).

---

## Low

### L-1 — No `Host` header validation: DNS rebinding reaches the control and auth endpoints

* **Severity:** Low
* **Category:** `csrf` / `dns_rebinding`
* **Location:** `internal/app/gateway.go:243` (the `Sec-Fetch-Site` guard) and `gateway.go:212-230` (`/api/f1auth`)

**What's wrong.** The CSRF defence on `POST /control/source` is:

```go
if site := r.Header.Get("Sec-Fetch-Site"); site != "" && site != "same-origin" && site != "none" {
```

This is a reasonable, cheap guard against ordinary cross-site POSTs. It does not
survive DNS rebinding, because rebinding makes the attack *genuinely same-origin*:
the attacker's page at `evil.com` re-resolves `evil.com` to `127.0.0.1` (or the
victim's LAN IP, given M-1), and the browser then labels the request
`Sec-Fetch-Site: same-origin`. The same rebinding also satisfies
`coder/websocket`'s `strings.EqualFold(r.Host, u.Host)` short-circuit
(`accept.go:239-241`), bypassing the origin allowlist for `/ws` too.

Nothing anywhere in the gateway validates the `Host` header against an expected value.

Payload is modest: flip the demo lane, and read `GET /api/f1auth`, which discloses
whether the operator has a linked F1TV account, their subscription `tier`, `product`,
and token `expiresUtc`. That is account-status information about a real person, not
just demo data — which is why it's worth listing rather than dismissing.

**Fix.** Add a `Host` allowlist check in front of `/control/source`, `/api/f1auth`, and
`/ws` — accept only `localhost:<port>`, `127.0.0.1:<port>`, and whatever
`ALLOWED_ORIGINS` names. This is a handful of lines and closes the whole rebinding
class, including the `Origin`-less non-browser path.

### L-2 — No security response headers and no Content-Security-Policy

* **Severity:** Low
* **Category:** `missing_hardening`
* **Location:** `internal/app/gateway.go:199-207` (`Mount` — no header middleware), `web/index.html` (no CSP meta)

**What's wrong.** The gateway serves the SPA and two JSON endpoints with no
`Content-Security-Policy`, `X-Content-Type-Options: nosniff`, `X-Frame-Options` /
`frame-ancestors`, or `Referrer-Policy`. `web/index.html` sets no CSP meta tag either.

There is no *known* injection point today — the frontend audit found zero unsafe sinks
(no `dangerouslySetInnerHTML`, no `innerHTML`, no `eval`, no dynamic `href`), and the
one server-controlled URL that reaches a DOM API (`audio.src`) is allowlisted at both
call sites. So this is defence-in-depth, not a live vulnerability. But it is
specifically the thing a security-literate reviewer greps for first, and its absence
reads as an oversight next to how deliberate the rest of the code is.

`frame-ancestors 'none'` is the one with real present-day value: without it the page
can be framed, and `/control/source` is a same-origin state-changing endpoint.

**Fix.** Wrap the mux in a small middleware:

```go
w.Header().Set("Content-Security-Policy",
    "default-src 'self'; connect-src 'self' ws: wss:; media-src https://*.formula1.com https://formula1.com; frame-ancestors 'none'")
w.Header().Set("X-Content-Type-Options", "nosniff")
w.Header().Set("Referrer-Policy", "no-referrer")
```

Verify the `media-src` list against the real clip host before shipping, and note the
static GitHub Pages build (`pages.yml`) needs the meta-tag form instead.

### L-3 — Unbounded `zlib.decompress` on remote `Position.z` payloads

* **Severity:** Low
* **Category:** `decompression_bomb`
* **Location:** `ingest/live_signalr.py:902`

```python
raw = base64.b64decode(payload)
decompressed = zlib.decompress(raw, -15)  # raw deflate (no header)
decoded = json.loads(decompressed)
```

**What's wrong.** Neither `len(payload)` nor the decompressed size is bounded, and the
optional `bufsize` cap on `zlib.decompress` is unused. Reached from two places:
`handle_message` (line 726) on every live `Position.z` message, and `_replay_capture`
(line 532) on every `Position.z` line of a `CAPTURE_FILE`. A crafted blob expands
without limit and exhausts process memory.

Rated Low rather than Medium because the live source is F1's own TLS endpoint (not
attacker-controlled without a compromise upstream), `CAPTURE_FILE` is an
operator-supplied path, and this whole path sits behind three explicit opt-ins
(`--live` + `LIVE=1` + `LIVE_TIMING_MODE=beta`, all verified at `live_signalr.py:1078`,
`1095`, `1115`). The decoded value was traced to its sinks and only ever feeds numeric
`X`/`Y`/`Status` extraction inside `try/except` guards — there is no dangerous sink
downstream.

**Fix.**

```python
d = zlib.decompressobj(-15)
decompressed = d.decompress(raw, MAX_POSITION_BYTES)
if d.unconsumed_tail:
    raise ValueError("Position.z payload exceeds size limit")
```

### L-4 — Third-party GitHub Actions pinned by mutable tag, not commit SHA

* **Severity:** Low
* **Category:** `ci_supply_chain`
* **Location:** `.github/workflows/ci.yml:115` (`lycheeverse/lychee-action@v2`), `.github/workflows/okf.yml:15` (`natcat38/okf-portfolio-standard@v1`)

**What's wrong.** Every `uses:` in the repo is a floating major tag. For the
GitHub-owned `actions/*` this is normal and low-risk. For the two third-party actions
it is not: a tag repoint (by the maintainer, or by whoever compromises the account)
silently executes new code in CI. This compounds M-2, where one of those two actions
also receives an unscoped token.

**Fix.** Pin both to full commit SHAs with a trailing version comment. Dependabot is
already configured for the `github-actions` ecosystem (`.github/dependabot.yml:41-50`)
and updates SHA pins automatically, so the maintenance cost is zero.

### L-5 — `govulncheck` executed unpinned from the module proxy in CI

* **Severity:** Low
* **Category:** `ci_supply_chain`
* **Location:** `.github/workflows/ci.yml:81` — `go run golang.org/x/vuln/cmd/govulncheck@latest ./...`

**What's wrong.** `@latest` resolves and executes arbitrary third-party code at CI
time, in a job with the repository checked out. The inline comment (lines 78-80) gives
a legitimate reason — pinned releases fail to build against the repo's Go 1.26
toolchain — so this is a considered trade-off, not an accident. Blast radius is
limited by `ci.yml:6-7`'s `contents: read`. Still worth recording as accepted risk
rather than leaving implicit.

**Fix.** Pin to a specific version and bump it via Dependabot when the toolchain
allows; alternatively keep `@latest` but move the step to its own job so it can't share
a runner with anything more privileged. If neither is worth it, add "accepted risk" to
the existing comment so a reviewer sees it was a decision.

### L-6 — `.dockerignore` omits `.env`

* **Severity:** Low
* **Category:** `secrets_exposure`
* **Location:** `.dockerignore:1-12`

Same root cause as H-1, separated because the impact differs: `.env` is gitignored
(`.gitignore:14`) and `.env.example:8` shows it holds `REDIS_URL`, which carries a
password in any deployment with authenticated Redis. It is currently absent from this
working tree, so this is a latent gap rather than a live leak. Fixed by the same
`.dockerignore` addition.

---

## Informational

### I-1 — Base images pinned by floating tag, not digest

`Dockerfile:2` (`node:24`), `Dockerfile:10` (`golang:1.26`), `Dockerfile:19`
(`gcr.io/distroless/static-debian12:nonroot`), `ingest/Dockerfile.live:1`
(`python:3.11-slim`), `docker-compose.yml:3` (`redis:7-alpine`). Builds aren't
byte-reproducible and an upstream tag repoint is pulled silently. Standard hardening
is `@sha256:...`; reasonable to skip for a demo, worth one sentence in the README if so.

### I-2 — `msgpack>=1.2.1` is the only unbounded pin

`ingest/requirements.txt:7`. Every other Python pin is exact (`fastf1==3.8.3`,
`numpy==2.4.6`, `signalrcore==1.0.2`). The intent is right — floor above
GHSA-6v7p-g79w-8964 — but an open upper bound means the "verified 2026-08-20 against
1.2.1" claim in `requirements-live-nodeps.txt:7-8` silently stops applying to whatever
resolves next. Suggest `msgpack>=1.2.1,<2`.

### I-3 — `/api/f1auth` writes raw Redis bytes through without validating them

`internal/app/gateway.go:229` — `_, _ = w.Write(raw)` with `Content-Type:
application/json` set at line 228. The bytes are whatever sits at `f1auth:status`,
written only by `ingest/f1tv_auth.py:95` (`json.dumps`), so today they are always valid
JSON. Not exploitable: the writer is trusted, and the JSON content type prevents HTML
sniffing. Noted only because "serve unvalidated bytes verbatim from a datastore" is a
pattern a reviewer will pause on, and adding `nosniff` (L-2) closes the residual
sniffing question entirely.

### I-4 — `http.FileServer` exposes a directory listing for `/assets/`

`cmd/server/main.go:61` mounts `http.FileServer(http.FS(web.FS()))`, which renders an
index for any directory lacking `index.html`. Vite emits `dist/assets/` without one, so
`GET /assets/` lists every bundle filename. No secret is disclosed (the filenames are
already referenced from `index.html`), but suppressing listings is a one-line
`fs.FS` wrapper and looks more deliberate.

### I-5 — WebSocket upgrade accepts requests with no `Origin` header

Library behaviour, not a repo bug: `coder/websocket@v1.8.15` `accept.go:230-232` returns
`nil` immediately when `Origin` is empty. This is correct and intentional (non-browser
clients don't send it), but it means the origin allowlist provides *zero* protection
against non-browser clients — which matters given M-1's LAN exposure. Worth stating
explicitly next to the `ALLOWED_ORIGINS` docs in `.env.example:26-28`, which currently
read as if the allowlist is a general access control.

### I-6 — Free-form upstream text crosses the seam with no length cap or sanitisation

`ingest/live_signalr.py:681-685` (driver `Tla` / `TeamName`), `ingest/record.py:124-128`,
`ingest/race_control.py:33` (`category`, `message`). These strings come from the F1
feed and are JSON-serialised into the Redis snapshot, rebroadcast verbatim by the Go
gateway, and rendered in the SPA. The escaping burden therefore rests entirely on React,
and it **does hold** — `RaceControl.tsx:34` and `Comms.tsx` use plain JSX interpolation
with no unsafe sink anywhere in `web/src`. But that's an unstated invariant: one future
`dangerouslySetInnerHTML` turns this into stored XSS. Worth a length cap at ingest and a
one-line comment recording the invariant.

### I-7 — `SECURITY.md` doesn't state the threat model it depends on

`SECURITY.md` covers reporting well but never states the assumption the whole design
rests on: loopback-only, single-operator, no multi-tenancy, no authentication by
design. Every control in the code (origin allowlist, `Sec-Fetch-Site` guard, unauthenticated
`/control/source`) is correct *under that model* and questionable outside it. Adding
three lines — "runs on localhost; do not expose to a network without adding
authentication; the F1TV token stays on the host and only status crosses the Redis
seam" — turns each of those from an apparent omission into a documented decision. For a
repo shown to hiring managers, that is the single highest-leverage edit in this report.

---

## Claims verified

Security-relevant assertions in `README.md`, `SECURITY.md`, `ADR-0007`, and code
comments, checked against the implementation.

| Claim | Source | Verdict | Notes |
|---|---|---|---|
| "the token... is never logged" | `README.md:66-67` | **True** | `f1tv_auth.py` reads the file and emits only `state`/`expiresUtc`/`tier`/`product` (lines 72-82). `live_signalr.py:1100-1113` logs only those three fields. No token, cookie, or `Authorization` value is logged anywhere. |
| "the token... is never sent to the frontend" | `README.md:66-67` | **True** | The only path to the browser is `GET /api/f1auth` → `bus.GetAuthStatus` → the `f1auth:status` key, which contains status only. `web/src/state/f1auth.ts:20-28` has no field for a token in its `AuthStatus` type at all. |
| "the token never leaves your machine" | `README.md:66-67` | **Partially true** | True in the network sense — no code transmits it. But `f1tv_link.py:101` copies it to `./secrets/`, and `Dockerfile:14`'s `COPY . .` then bakes it into build-stage image layers (H-1). It stays on the machine but leaves the boundary the sentence implies. |
| "`./secrets/` is git-ignored" | `ADR-0007` | **True** | `.gitignore:43`; confirmed with `git check-ignore -v secrets/fastf1/f1auth.json`. |
| "mounted **read-only** at `/secrets` in the live container" | `ADR-0007` | **True** | `docker-compose.yml:26` — `./secrets:/secrets:ro`. The container cannot write back. |
| "Only status crosses the seam... `{state, expiresUtc, tier, product}`" | `ADR-0007` | **True** | `f1tv_auth.py:72-82` builds exactly that dict; `f1tv_auth.py:95` is the only writer; `internal/bus/redis.go:67-81` is read-only on that key. |
| "the container only ever *reads* it: `f1tv_auth.py` is stdlib-only and fastf1 is never imported there" | `ADR-0007` | **True** | `f1tv_auth.py` imports only `base64`, `binascii`, `json`, `logging`, `os`, `threading`, `time`, `datetime`, `pathlib`. `ingest/Dockerfile.live:5` copies only `live.py` and `f1tv_auth.py`. |
| "JWT claims are decoded WITHOUT signature verification — display only" | `f1tv_auth.py:9-11`, `ADR-0007` | **True, and correctly scoped** | `_decode_claims` (lines 48-51) does no verification, and no security decision depends on the result — only UI display and an expiry comparison. Acceptable because the file is local and operator-owned. |
| "The gateway stays read-only... serves the stored JSON verbatim, defaulting to `{"state":"unlinked"}`" | `ADR-0007` | **True** | `internal/app/gateway.go:212-230`. `POST` is rejected with 405 (line 213-216). |
| "Three gates guard a real connection: `--live`, `LIVE=1`, `LIVE_TIMING_MODE=beta`" | `ADR-0007` | **True** | `live.py:132` (`--live`), `live_signalr.py:1078` (`LIVE=1`), `live_signalr.py:1095` (`LIVE_TIMING_MODE=beta`), with the confirmation log at line 1115. All three are hard gates, not warnings. |
| "No host port: [Redis] isn't exposed to the host/LAN" | `docker-compose.yml:4-5` | **True** | The `redis` service declares no `ports:`; reachable only over the compose network. |
| "external origins are rejected" (default `ALLOWED_ORIGINS`) | `internal/config/config.go:70-71`, `.env.example:27` | **Partially true** | Holds for browsers, which always send `Origin`. Does not hold for clients that omit it — `coder/websocket` `accept.go:230-232` accepts an absent `Origin` outright (I-5). Also bypassable via DNS rebinding (L-1). |
| "Reject cross-site state-changing POSTs" | `internal/app/gateway.go:241-242` | **Partially true** | Correct for ordinary cross-site POSTs. Bypassed by DNS rebinding, which makes the request genuinely `same-origin` (L-1). The comment already concedes the non-browser gap. |
| "a self-hosted app you run locally, not a hosted service — there is no public deployment to protect" | `SECURITY.md:3-4` | **Partially true** | Matches the code defaults (`ADDR=:8080`, localhost origin allowlist), but `docker-compose.yml:55` publishes on `0.0.0.0`, making the documented compose path LAN-reachable (M-1). |
| "`--no-deps` is safe here because msgpack is signalrcore 1.0.2's ONLY third-party runtime import" | `requirements-live-nodeps.txt:10-13` | **Not independently verified; mitigation sound** | signalrcore isn't vendored here so the import claim couldn't be checked from this repo. The surrounding mitigation *is* verifiable and correct: install order forces the patched msgpack first (lines 15-17), and `ci.yml:98-108` scopes `--ignore-vuln PYSEC-2026-3625` to that one advisory on that one file, leaving signalrcore itself subject to future advisories. This is the best-documented decision in the repo and should not draw fire. Residual risk is I-2's open upper bound. |
| "`npm audit` / `pip-audit` / `govulncheck` run in CI" | `ci.yml:71-108` | **True** | All three present, plus `web/package-lock.json` and `go.sum` are both committed, so the scans have something deterministic to scan. |

---

## Verified clean

Checked directly and found free of the vulnerability classes searched for. Listed so a
reviewer can see the negative space, not just the findings.

* **Injection / RCE** — no `pickle`, `yaml.load`, `eval`, `exec`, or `marshal` anywhere in `ingest/`. No `subprocess`, `os.system`, or `os.popen` in `ingest/`; `bench/run.py` uses list-form `subprocess.run` exclusively, never `shell=True`. No `exec.Command` anywhere in Go.
* **XSS** — zero unsafe sinks across `web/src`: no `dangerouslySetInnerHTML`, `innerHTML`/`outerHTML`, `document.write`, `eval`, `new Function`, or `javascript:` URLs (the only `javascript:` string in the tree is a unit-test assertion at `comms.test.ts:46`). SVG in `Map.tsx` / `TrackPath.tsx` / `Ghost.tsx` builds path data from numeric arithmetic passed as ordinary JSX attributes.
* **Clip-URL allowlist (defence in depth, done well)** — enforced independently on both sides: `ingest/radio.py:15-25` (`_require_f1_host`: https + `formula1.com` or subdomain) and `web/src/state/comms.ts:59-67` (`isAllowedClip`), the latter checked before *both* `audio.src` writes (`useComms.ts:37-38` in `pump`, `useComms.ts:130-134` in `replay`). URL joining is string concatenation rather than `urljoin`, so a hostile `Path` segment cannot override scheme or host.
* **WebSocket URL construction** — `web/src/realtime/socket.ts:25-26` derives the scheme from `location.protocol` and the host from `location.host`, and `encodeURIComponent`s the only variable (`session`). No hardcoded `ws://`, no mixed-content risk.
* **Path traversal** — no remote or feed-supplied value reaches a filesystem path in either language. Output paths (`CAPTURE_OUT`, `OUTPUT_PATH`, `bake-static`'s `-out`) are all operator/CLI-controlled build-time inputs.
* **SSRF / TLS** — no `requests`/`httpx`/`urllib` calls in the reviewed ingest files; no `verify=False`, no disabled SSL context, no `CERT_NONE`. `InsecureSkipVerify` appears only in `cmd/loadtest/hist_test.go:107,146` (test files).
* **Hardcoded secrets** — a repo-wide regex sweep for key/secret/password/token assignments to long literals returned nothing.
* **Client-side storage** — zero `localStorage`/`sessionStorage` usage anywhere in `web/src`.
* **Build-time secret leakage** — `web/vite.config.ts` has no `define` block; the only `import.meta.env` uses are `VITE_STATIC_DEMO` and `BASE_URL`. No `.env` under `web/`. `build.sourcemap` is unset, so Vite's production default (`false`) applies — no source maps shipped.
* **Container users** — `ingest/Dockerfile.live:6-7` creates and switches to a non-root `appuser` (uid 1000); the gateway's final stage uses `distroless:nonroot`. Both correct already.
* **GitHub Actions injection** — no `pull_request_target` anywhere; no `${{ github.event.* }}` or `github.head_ref` interpolated into any `run:` block.
* **`/ws?session=` registry bound** — `internal/app/gateway.go:185-188` allowlist-checks the session key before `getOrCreateHub`, so an arbitrary value can't spawn unbounded hubs/goroutines/subscriptions.
* **WebSocket read limit** — `internal/ws/client.go:18` sets `readLimit = 512`, well below the library's 32 KiB default, correctly reasoned for a fan-out-only protocol.
