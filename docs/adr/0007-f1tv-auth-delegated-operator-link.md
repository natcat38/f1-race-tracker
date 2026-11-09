<!-- ADR-0007: beta live timing authenticates via an operator-linked F1 TV session, delegated to FastF1. -->

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
- **`./secrets/` is git-ignored** and mounted **read-only** at `/secrets` in the live
  container, with `XDG_DATA_HOME=/secrets` so the token resolves to
  `/secrets/fastf1/f1auth.json`. Safe because the container only ever *reads* it:
  `ingest/f1tv_auth.py` is stdlib-only and fastf1 is never imported there.
  **Caveat for any future in-container fastf1 use:** importing `f1auth` *writes* to
  its data dir (`user_data_dir(..., ensure_exists=True)` plus a `touch()`), so it
  would need `XDG_DATA_HOME` pointed at a writable dir with the token copied in.
- **The beta SignalR connection itself runs on the host**, where fastf1 already lives
  — the same place the existing capture workflow runs. The container image stays
  demo-sized (no pandas/numpy pulled in for a path that is opt-in three times over).
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

## Update 2026-11-02: second advisory on the declared msgpack pin

A new advisory, GHSA-j586-36cw-2gc2, covers msgpack below 1.2.3. It hit two places:

- The real install: `ingest/requirements.txt` allowed `msgpack>=1.2.1`, so 1.2.1 and
  1.2.2 were still installable. The floor is now `>=1.2.3`.
- The `--no-deps` audit of `requirements-live-nodeps.txt`, which reports signalrcore
  1.0.2's declared `msgpack==1.1.2` again. That version is still never installed, so
  CI now ignores this second ID next to PYSEC-2026-3625, on that one step only.

The live link was verified against msgpack 1.2.1 on 2026-08-20. 1.2.3 is a patch
release, but the live socket has not been re-run against it; the next live session
should confirm it. Existing local venvs still hold 1.2.1 until
`pip install -r ingest/requirements.txt` is re-run.

## Update 2026-11-03: fastf1 3.9 moved the login to `f1account`

fastf1 3.9.0 deleted `fastf1.internals.f1auth`, which the decision above built on, and
replaced it with `fastf1.internals.f1account`. The decision itself stands: the login,
the token store and the verification still belong to fastf1, and this project still
never touches a credential. What changed is the surface we read and call. The bump to
fastf1 3.9.0 (with numpy 2.5.4 and pytest 9.2.0, first proposed in the closed PR #170)
lands together with this port.

- **Token file.** fastf1 3.9 writes JSON, not a raw JWT, to `f1auth_token.json`:
  `{"version": 1, "value": "<subscription JWT>", "expires_at": <epoch seconds>}`
  (`TokenManager.store` in `f1account/tokens.py`). The default location is unchanged,
  `platformdirs.user_data_dir("fastf1")`. The copy for the compose mount is now
  `./secrets/fastf1/f1auth_token.json`, and `XDG_DATA_HOME=/secrets` resolves to it.
  The old `f1auth.json` is no longer read; `--unlink` deletes a leftover copy.
- **Status reader.** `ingest/f1tv_auth.py` stays stdlib-only. It parses the JSON,
  takes the expiry from the file's `expires_at` (the value fastf1's own validity check
  uses), and decodes the JWT claims, still without verification, for the tier and
  product. A missing, empty, malformed, wrong-version or undecodable file reads as
  unlinked, as before. A raw-JWT file left over from 3.8 therefore reads as unlinked,
  which is correct: fastf1 3.9 would ignore it too.
- **Link command.** `ingest/f1tv_link.py` now calls
  `fastf1.internals.f1account.get_token(method="browser")` and `clear_token()`.
  The method is pinned on purpose. fastf1 3.9 defaults to a native `"password"` sign-in
  that reads `F1_USERNAME` / `F1_PASSWORD` or prompts for them in the terminal. That
  would put the credentials in this project's process, which this ADR rules out. The
  `"browser"` method is the same f1login extension flow as before.
- **Writes at import.** The old caveat about `f1auth` touching its data dir on import
  does not carry over: `f1account` creates the directory and file only when it stores
  a token. Any future in-container use still needs a writable `XDG_DATA_HOME`, because
  signing in and renewing both write.
- **Tests.** The token parsing is unit-tested against files in the real 3.9 layout, and
  `f1tv_link` is tested against a stubbed `f1account` (no network, no real token). One
  scratch check also round-tripped a file through the installed `TokenManager.store`
  into `auth_status`.

**Unverified.** None of the live path was run against the F1 service. Without an F1TV
subscription this session could not sign in, so these remain open:

- Whether the browser sign-in under 3.9 completes end to end. The code reads as the
  old flow, but it was not exercised.
- Whether a free account still gets a token. The 2026-08-20 spike found that on 3.8.3
  (`SubscriptionStatus: inactive`). In 3.9 `login_browser` raises `F1AuthError` when the
  login session carries no `subscriptionToken`, so a free account may now be refused.
  `f1tv_link.py` says so instead of promising it works.
- Whether the live SignalR connection accepts the 3.9 token. It is the same entitlement
  JWT, but the socket was not re-run.
- Whether the `0600` mode fastf1 sets on the token file survives the copy into
  `./secrets` in a way the container's `appuser` (uid 1000) can read on a Linux host.
  Docker Desktop on Windows, the current host, ignores the mode bits.

The next live session with a subscription should run `python ingest/f1tv_link.py`,
`--status`, and a short `--live` capture, and settle each point above.
