# f1auth Spike Findings (Task 1)

**Date:** 2026-08-20 · **Host:** Windows 10, Python 3.11 · **Status:** source-inspection complete; browser login pending the operator.

Authoritative over the assumptions in `docs/superpowers/plans/2026-08-20-f1tv-beta-link-and-live-radio.md`.

## Versions

| Package | Installed |
|---|---|
| `fastf1` | 3.8.3 |
| `platformdirs` | 4.11.0 |

Source: `C:\Python311\Lib\site-packages\fastf1\internals\f1auth.py`

## API surface (`fastf1.internals.f1auth`)

| Name | Behaviour |
|---|---|
| `get_auth_token()` | Returns cached token if it verifies against `https://api.formula1.com/static/jwks.json`; otherwise starts the local auth server and blocks until the browser extension POSTs. Returns `str` or `None`. |
| `clear_auth_token()` | Deletes the cache file, clears module global. |
| `print_auth_status()` | Prints token status, `SubscriptionStatus`, `SubscribedProduct`. **Hits the network** (fetches JWKS even when `verify_signature` is off). |
| `print_auth_token()` | Prints the raw JWT. |

Module-level constants: `JWKS_URL`, `USER_DATA_DIR`, `AUTH_DATA_FILE`.

## Corrections to the plan

1. **The cache file is a raw JWT string, not JSON.** `get_auth_token` does `f.write(_subscription_token)`. The plan's `json.loads(path.read_text())["token"]` is wrong — read the file as text and strip it. Test fixtures in Task 4 must be updated to match.
2. **The file always exists and is usually empty.** Import of `f1auth` runs `AUTH_DATA_FILE.touch(exist_ok=True)`, so an *unlinked* host still has a 0-byte `f1auth.json`. `auth_status` must treat empty/whitespace as `unlinked`, not as a parse error.
3. **`XDG_DATA_HOME` mounted read-only would break a fastf1 import.** At import time `f1auth` runs `platformdirs.user_data_dir("fastf1", ensure_exists=True)` and `AUTH_DATA_FILE.touch()`; on a read-only bind mount both raise. This does **not** bite us: the container never imports fastf1 — `ingest/f1tv_auth.py` is stdlib-only and read-only — so `./secrets:/secrets:ro` with `XDG_DATA_HOME=/secrets` is safe. Recorded as a trap for anyone who later moves the SignalR connection in-container. (`Dockerfile.live` copies only `live.py` today; the beta connection runs on the host, where fastf1 already lives.)
4. **The auth server's port is random** (`HTTPServer(('127.0.0.1', 0), ...)`) — not fixable, confirming the host-only link design in ADR-0007.
5. **Claim names confirmed:** `exp`, `SubscriptionStatus`, `SubscribedProduct`. The plan's `SubscriptionStatus` guess was right; `SubscribedProduct` is a bonus and worth showing.

## Cache path

| Where | Path |
|---|---|
| This host (Windows) | `C:\Users\natal\AppData\Local\fastf1\fastf1\f1auth.json` (exists, 0 bytes → unlinked) |
| Linux container with `XDG_DATA_HOME=/xdg` | `/xdg/fastf1/f1auth.json` |

`platformdirs` honours `XDG_DATA_HOME` on Linux only — Windows always uses the LocalAppData path. That is fine: linking happens on the host, the container only reads a staged copy.

## Claims table

Pending the browser login. `get_auth_token()` prints *"This feature requires an active F1TV Access/Pro/Premium subscription"* only when **no** token is cached — the login itself is not gated on a paid tier, so a free account is expected to produce a token whose `SubscriptionStatus`/`SubscribedProduct` reveal the tier.

| Claim | Free-account value |
|---|---|
| `exp` | _pending_ |
| `SubscriptionStatus` | _pending_ |
| `SubscribedProduct` | _pending_ |

## SignalR connect with a free-account token

_Pending._ Whether the timing feed 401/403s for a free tier or times out cleanly on an empty stream is the residual unknown; it is documented as unverified in the README and runbook and does not block any code path.

## Operator step (run at a browser, on the host)

```
python ingest/f1tv_link.py
```

Open the printed `https://f1login.fastf1.dev?port=<random>` URL with the f1login extension installed and sign in. Then `python ingest/f1tv_link.py --status`.
