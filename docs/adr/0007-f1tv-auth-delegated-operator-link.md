# 0007 — Beta live timing: operator-linked F1TV auth, delegated to FastF1

**Status:** accepted

## Context

The live lane has always been the honest gap in this project: FastF1's free live
client can be pointed at `livetiming.formula1.com`, but the timing feed itself now
sits behind an F1TV subscription. FastF1 3.8 ships `fastf1.internals.f1auth`, which
does the whole login dance for you — a local HTTP server, a browser extension
(`f1login.fastf1.dev`), JWKS verification, and a token cache.

Three things constrain how we can use it:

1. **The extension POSTs to `127.0.0.1` on a random port** (`HTTPServer(('127.0.0.1', 0), …)`).
   Docker cannot map a host port onto a container's loopback, and the port is not
   fixable, so an in-container login is impossible. (The roadmap's earlier sketch
   assumed a fixed mapped port; the spike disproved it —
   `docs/superpowers/specs/2026-08-20-f1auth-spike-findings.md`.)
2. **This is one operator's personal subscription**, not a product feature. Nobody
   else's account is ever involved.
3. **The project's promise is that everything shipped runs on free data.** Whatever
   this adds must be optional, off by default, and honestly labelled.

## Decision

Auth is **delegated entirely to FastF1** — its cache, its extension, its
verification. We write no login code and never touch a credential.

- **Linking runs on the host**, via `ingest/f1tv_link.py` (`link` / `--status` /
  `--unlink`). It calls `get_auth_token()` in the foreground and copies the resulting
  cache file to `./secrets/fastf1/f1auth.json`.
- **`./secrets/` is git-ignored** and mounted **read-only** into the live container.
  Because importing `f1auth` *writes* to its data dir (`ensure_exists=True` plus a
  `touch()`), the container points `XDG_DATA_HOME` at a **writable** dir and
  `f1tv_auth.stage_token()` copies the mounted token there before fastf1 is imported.
- **Only status crosses the seam.** `ingest/f1tv_auth.py` reads the cache file,
  decodes the JWT claims *without verification* (display only — fastf1 does the real
  verification at connect time) and publishes `{"state","expiresUtc","tier","product"}`
  to the Redis key `f1auth:status`. The token itself is never published, logged, or
  sent to the frontend.
- **The gateway stays read-only** (ADR-0001): `GET /api/f1auth` serves the stored JSON
  verbatim, defaulting to `{"state":"unlinked"}`.
- **Three gates guard a real connection**: the `--live` flag, `LIVE=1`, and
  `LIVE_TIMING_MODE=beta`. Missing auth is a **fail-fast** with the exact host command
  to run — never a silent degrade.

## Consequences

- Nothing about the shipped demo changes. With no `secrets/` dir and no env vars, all
  four lanes replay exactly as before and `#settings` reads "unlinked".
- The last mile is **unverified**: whether a free-tier token is accepted by the timing
  socket, whether the radio topic needs a paid tier, and whether clip mp3s are
  fetchable mid-session all await an actual subscription. The UI and README say so.
- We inherit fastf1's auth internals as a dependency surface (`f1auth` is an
  `internals` module and may move). The blast radius is two functions in
  `ingest/f1tv_link.py`; everything else reads a file path.

## Non-goals

- **User accounts.** One operator, their own subscription. No multi-user auth, ever.
- **Storing or relaying the token** anywhere beyond fastf1's own cache and the
  read-only mounted copy.
- **Making live the default.** The beta path is opt-in three times over.
