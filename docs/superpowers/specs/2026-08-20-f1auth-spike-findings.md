# f1auth Spike Findings (Task 1)

**Date:** 2026-08-20 · **Host:** Windows 10, Python 3.11 · **Status:** complete — source inspected and the link flow run for real with a free F1 account.

These findings are what the F1TV beta path was actually built against; the decision
they fed is recorded in [ADR-0007](../../adr/0007-f1tv-auth-delegated-operator-link.md),
and the operator procedure in
[docs/runbooks/live-verification.md](../../runbooks/live-verification.md) §5.

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

## Claims table — real free F1 account

Linked 2026-08-20. The login is **not** tier-gated: a free account signs in fine and
fastf1 verifies the returned JWT against F1's JWKS ("Sign-in successful"). What the
free tier lacks shows up in the claims, not in the ability to link.

| Claim | Free-account value |
|---|---|
| `exp` | `2026-08-23T17:13:17+00:00` |
| `iat` | `2026-08-19T17:13:17+00:00` (a **4-day** token lifetime) |
| `SubscriptionStatus` | `'inactive'` — this is the tier signal |
| `SubscribedProduct` | `''` (empty string, so `auth_status` omits `product`) |

Full claim set: `ExternalAuthorizationsContextData`, `FirstName`, `LastName`,
`SessionId`, `SubscribedProduct`, `SubscriberId`, `SubscriptionStatus`, `ents`, `exp`,
`hashedSubscriberId`, `iat`, `jti`, `ved`.

**Privacy note, load-bearing for ADR-0007:** the token carries the operator's real
name and subscriber id. `auth_status` reads only `exp`, `SubscriptionStatus` and
`SubscribedProduct`, so none of that reaches Redis, the gateway, or the browser. Any
future change that widens what is published must not simply forward the claim dict.

A paid account should show `SubscriptionStatus: 'active'` and a non-empty
`SubscribedProduct` (e.g. `F1 TV Premium`) — still unconfirmed, since only a free
account was available.

**Token expiry is 4 days**, so the settings page's EXPIRED state is a routine
occurrence, not an edge case: re-run `python ingest/f1tv_link.py` roughly weekly.

## SignalR connect with a free-account token — VERIFIED, and it works

Run 2026-08-20 outside any live session, with the free-account token above.

```
INFO SignalR: Connection established
WARNING SignalR: Timeout - received no data for more than 30 seconds!
INFO SignalR: Connection closed
RESULT: capture bytes = 91648
```

**Auth is not the blocker.** A free-tier token (`SubscriptionStatus: inactive`) opens
the websocket and the server pushes the full subscription snapshot — 91 KB across all
17 topics — for the most recent completed session (Hungarian GP 2026, `Finalised`).
Negotiate returns 200 with *or without* a bearer token, so the tier gate, if any, is
not at connect. Whether a *live* session's stream is tier-gated remains untested, and
now needs an actual race weekend rather than a subscription.

### The real blocker: the `signalrcore` pin

`ingest/requirements-live.txt` pins `signalrcore==0.8.8` to keep the patched
`msgpack>=1.2.1` (GHSA-6v7p-g79w-8964). But 0.8.8's websocket callbacks predate the
websocket-client API that passes the app instance, so with any modern
websocket-client the connection dies the instant it opens:

```
INFO websocket: Websocket connected
ERROR websocket: BaseHubConnection.on_open() takes 1 positional argument but 2 were given
```

Verified: this is **not** fixable by pinning websocket-client down — 0.59.0 fails
identically (`callback(self, *args)` at `_app.py:393`). fastf1 3.8.3 leaves
`signalrcore` unpinned and effectively expects 1.x.

**`signalrcore==1.0.2` works at runtime with the safe `msgpack==1.2.1`** — that is the
combination that produced the successful capture above. Its *declared* pin is
over-strict, so the two cannot be expressed together in one requirements file:

```
ERROR: ResolutionImpossible  (signalrcore 1.0.2 requires msgpack==1.1.2)
```

Options, none taken here because this is a security-posture call:

| Option | Live path | msgpack | CI `pip-audit` |
|---|---|---|---|
| `signalrcore==0.8.8` (today) | **broken** | patched | passes |
| `signalrcore==1.0.2` + `msgpack==1.1.2` | works | **vulnerable** | fails |
| `signalrcore==1.0.2` installed `--no-deps`, msgpack pinned separately | works | patched | passes |

The third is what the successful run actually used. It needs a Dockerfile/runbook
change rather than a plain requirements pin.

## Wire-schema verification (ADR-0008's assumption)

The capture settles the assumptions the ADR flagged as unverified:

- **`TeamRadio` schema CONFIRMED** — `{"Captures": [{"Utc", "RacingNumber", "Path"}, …]}`,
  37 entries for that race. Exactly what `live_radio_refs` expects.
- **`Captures` is a list** in the connect snapshot. The index-keyed dict variant is
  still unobserved (it would be an incremental patch, which needs a live session).
- **`Utc` carries 7 fractional digits** (`2026-07-26T12:53:19.4139931Z`). Python 3.11's
  `fromisoformat` truncates rather than raising, so `_utc_to_epoch_ms` is fine —
  checked explicitly, and now pinned by a test.
- **Every payload arrives as a JSON string, not a dict** — `DriverList`, `TimingData`,
  `SessionInfo`, `TeamRadio`, all 17. This was a **real bug**: every `isinstance(payload,
  dict)` handler in `live_signalr.py` would have silently no-opped against the real
  feed. Fixed at the one boundary (`_decode_payload` in `_dispatch_message`), with
  `ingest/test_dispatch.py` pinned to verbatim capture data. `Position.z` is the
  intended exception — not JSON, so it passes through for the zlib decoder.

The raw capture is not committed (it is 91 KB of one session's snapshot with no
`Position.z`, so `_replay_capture` cannot use it); the trimmed excerpts that matter
live in `ingest/test_dispatch.py`.

## Operator step (run at a browser, on the host)

```
python ingest/f1tv_link.py
```

Open the printed `https://f1login.fastf1.dev?port=<random>` URL with the f1login extension installed and sign in. Then `python ingest/f1tv_link.py --status`.
