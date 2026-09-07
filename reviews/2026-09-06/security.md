# Security Review — f1-race-tracker

**Date:** 2026-09-06
**Scope:** `git diff 73c8f84..HEAD` (73c8f84 = PR #71, the 2026-08-21 security-hardening
pass) — 22 commits, 217 files. Focused read of `ingest/`, `internal/`, `cmd/`,
`.github/workflows/`, `Dockerfile`, `docker-compose.yml`, `web/src/realtime/`,
`web/vite.config.ts`, plus a full re-verification of every Low and Informational
item in `reviews/security.md` (the High and Medium items there are already confirmed
fixed and were not re-litigated here).
**Threat model:** single-operator local deployment plus a static GitHub Pages demo
(`docs/F1_Race_Tracker_Product_Scope.md:106`). No multi-tenancy, no public network
exposure by design. Findings are weighed against that, not against an internet-facing
service.
**Nothing was modified.** Report-only pass; only this file was written.

---

## Summary

| Severity | Count |
|---|---|
| Critical | 0 |
| High | 0 |
| Medium | 0 |
| Low | 1 (new) |
| Informational | 1 (new) |

Plus the **re-verification table** below: of the 6 Low + 7 Informational items from
the 2026-08-21 report, **2 are fixed, 2 are partially fixed, 9 are still open** (all
at their original severity — nothing regressed to a higher one).

**Top 2:**

1. **New-Low** — The PR #71 fix for L-1 (DNS-rebinding / Host-header validation) only
   covers `POST /control/source` (`internal/app/gateway.go:282`). `GET /api/f1auth`
   (`gateway.go:244`) and `/ws` still have no `Host` check, so the original L-1
   disclosure path — reading the operator's F1TV account-linked status via a rebound
   origin — is still live. This is the reason L-1 is scored "partially fixed" below.
2. **L-6 and H-1 are fixed** — `.dockerignore` now excludes `secrets/` and `.env`
   (confirmed on disk), closing the Docker-layer credential leak that was the prior
   report's top finding.

No SQL/command/template injection, no deserialization vulnerabilities, no new
authentication/authorization bypass, and no hardcoded secrets were found anywhere in
the diff. The ingest-side changes (arc-length gap estimator, geometry, pit stops,
pedal traces, corners) are pure numeric transforms over trusted/operator-supplied
data with no new file, network, or subprocess I/O. The `web/src/realtime/` changes
(lane de-duplication, reconnect budget, static-replay scrub/pause) are client-side
state-machine work with no new sink; per the project's threat model, client-side code
is not a trust boundary.

---

## New findings (introduced in 73c8f84..HEAD)

### New-Low — Host allowlist fix is incomplete: `/api/f1auth` and `/ws` remain open to DNS rebinding

* **Severity:** Low
* **Category:** `dns_rebinding` / `information_disclosure`
* **Location:** `internal/app/gateway.go:244` (`handleAuthStatus`) and `gateway.go:208`
  (`wsHandler`) — neither calls `hostAllowed`, which was added at `gateway.go:79-100`
  and is wired in only at `gateway.go:282` inside `handleControl`.

**What's wrong.** PR-era commits added `SetAllowedHosts`/`hostAllowed` and applied it
to `POST /control/source` specifically to close L-1 from the 2026-08-21 report. But
that report's L-1 named three endpoints — `/control/source`, `/api/f1auth`, and
`/ws` — and only the first got the fix. `GET /api/f1auth` still has zero `Host`
validation, so the exact scenario the original finding described (an attacker page at
`evil.com` re-resolving to `127.0.0.1`/the LAN IP, making the browser treat the
request as same-origin) still lets a rebinding attacker read the operator's F1TV
link state, subscription tier, product, and token expiry. `/ws` inherits the same gap
via `coder/websocket`'s same-origin short-circuit (unchanged, see I-5 below).

**Exploit scenario.** Victim (who has linked F1TV) visits `evil.com` in a background
tab while the gateway runs locally; `evil.com`'s DNS entry has a very short TTL and
re-resolves to `127.0.0.1` mid-session. A `fetch('http://evil.com:8080/api/f1auth')`
issued after rebinding is now browser-same-origin and its JSON response (account
tier/expiry) is readable by the attacker's page, with no CSRF token or Origin check
in the way.

**Fix.** Call the same `hostAllowed(r.Host, g.allowedHosts)` check at the top of
`handleAuthStatus` and inside `wsHandler` (or centralize it in `Mount` as
middleware wrapping all four routes), matching the pattern already proven in
`handleControl` and its test (`gateway_test.go:TestHandleControl_RejectsForeignHost`).

### New-Info — `hostAllowed`'s loopback bypass has no accompanying doc note for LAN deployments

* **Severity:** Informational
* **Category:** `missing_hardening`
* **Location:** `internal/app/gateway.go:89-100`

`hostAllowed` always admits `localhost`/`127.0.0.1`/`::1` regardless of
`ALLOWED_HOSTS`, which is correct for the documented loopback-only deployment but
means `ALLOWED_HOSTS` is additive-only and cannot be used to *restrict* below the
loopback default. Not a vulnerability under the stated threat model — noted only
because a future reader might expect `ALLOWED_HOSTS=""` to lock things down and be
surprised it doesn't. Worth one line in `.env.example` next to `ALLOWED_HOSTS`.

---

## Re-verification of `reviews/security.md`'s Low / Informational items

| ID | Original finding | Status | Evidence |
|---|---|---|---|
| L-1 | No Host validation → DNS rebinding reaches `/control/source` and `/api/f1auth` | **Partially fixed** | `hostAllowed`/`SetAllowedHosts` added (`gateway.go:79-100`, `config.go` `AllowedHosts`, wired in `cmd/server/main.go:60`) and applied to `handleControl` (`gateway.go:282`), with a passing regression test. Not applied to `handleAuthStatus` or `wsHandler` — see New-Low above. |
| L-2 | No CSP / security response headers | **Still open** | No `Content-Security-Policy`, `X-Content-Type-Options`, or `Referrer-Policy` header anywhere in `gateway.go`'s `Mount`/`handleAuthStatus`/`handleControl`; no CSP `<meta>` in `web/index.html` (checked — only OG/Twitter meta tags were added). |
| L-3 | Unbounded `zlib.decompress` on `Position.z` | **Still open** | Logic moved from `live_signalr.py` into `ingest/live_parsers.py:57` verbatim: `zlib.decompress(raw, -15)` with no `bufsize` cap, still reached from the same two call sites, still behind the same three-gate live opt-in. No behavior change. |
| L-4 | Third-party Actions pinned by mutable tag | **Partially fixed** | `okf.yml:20` now pins `natcat38/okf-portfolio-standard@bfc3f188263f0e16adc7e8961000a4ff0fc618d9 # v1` (full SHA). `ci.yml:124`'s `lycheeverse/lychee-action@v2` is still a floating tag. |
| L-5 | `govulncheck@latest` unpinned | **Still open (accepted risk, as before)** | `ci.yml:93` unchanged; the inline comment (lines 90-92) now more explicitly documents the toolchain-compatibility rationale, which is the "record it as a decision" remediation the original report suggested as an alternative to pinning. |
| L-6 | `.dockerignore` omits `.env` | **Fixed** | `.dockerignore` now contains `secrets/` and `.env` (same fix as H-1, confirmed on disk with a comment: "Never bake credentials into image layers"). |
| I-1 | Base images pinned by floating tag, not digest | **Still open** | `Dockerfile:5,13,22` (`node:24`, `golang:1.26`, `distroless/static-debian12:nonroot`) and `ingest/Dockerfile.live:3` (`python:3.11-slim`) unchanged; `docker-compose.yml`'s `redis:7-alpine` unchanged. |
| I-2 | `msgpack>=1.2.1` unbounded upper pin | **Still open** | `ingest/requirements.txt:9` unchanged. |
| I-3 | `/api/f1auth` writes raw Redis bytes without validation | **Still open (unchanged, low risk as before)** | `handleAuthStatus` logic unchanged; writer is still trusted (`ingest/f1tv_auth.py`). |
| I-4 | `http.FileServer` exposes `/assets/` directory listing | **Still open** | `Mount` (`gateway.go:231-243`) still mounts `staticHandler` at `/` with no listing suppression. |
| I-5 | WebSocket upgrade accepts requests with no `Origin` header | **Still open (library behavior, unchanged)** | Now slightly more relevant given L-1's partial fix leaves `/ws` without a Host check either — a non-browser or rebinding client reaching `/ws` still bypasses the origin allowlist by the same two independent gaps. |
| I-6 | Free-form upstream text (`Tla`, `TeamName`, `category`, `message`) has no length cap | **Still open** | No length cap or sanitization added in `ingest/live_signalr.py`, `ingest/live_parsers.py`, or `ingest/record.py`. React's lack of an unsafe sink (re-verified: no new `dangerouslySetInnerHTML`/`innerHTML` in `web/src`) still holds as the mitigating control. |
| I-7 | `SECURITY.md` doesn't state its threat model | **Still open** | `SECURITY.md`'s only change since 73c8f84 is a one-line header comment; the loopback/single-operator/no-auth assumption is still unstated. |

---

## Method notes

* Diff-only review: `git diff --stat 73c8f84..HEAD` was used to scope files, then full
  unified diffs for the six target areas were read in entirety (no truncation).
* Every "still open" / "fixed" / "partially fixed" verdict above was checked against
  the current file on disk, not just the diff hunk, to rule out the fix landing in a
  file outside the reviewed diff.
* Searched the full ingest diff (3050 lines) for `subprocess`, `eval`/`exec`,
  `pickle`/`yaml.load`, new `open()`/`Path()`/network calls, and any `secrets`/`token`
  handling — all hits were either test fixtures, operator-controlled CLI paths, or
  unrelated string matches (e.g. "binding" in a code comment).
* No live testing was performed (no server started, no requests sent); all findings
  are from static reading of the code and tests.
