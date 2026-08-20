# F1TV Beta: Account Link + Live Team Radio — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fully build WS5 of the polish-and-immersion roadmap — an in-app "Link F1TV" settings page, F1TV-authenticated live timing, and live team-radio flowing through the existing comms layer — verified end-to-end-minus-auth with recorded data; the paid last mile stays honestly labeled beta.

**Architecture:** Auth is delegated entirely to FastF1's `f1auth` (its token cache, its f1login.fastf1.dev browser-extension login) and runs **on the host** via a small link CLI — the browser extension POSTs the token to `127.0.0.1` on the host, and Docker cannot map a host port onto a container's loopback, so an in-container login dance is impossible. The cached token is copied into a git-ignored `./secrets/` dir that compose mounts read-only; the live container finds it via `XDG_DATA_HOME=/secrets`. Python ingest owns auth status and publishes it to the Redis key `f1auth:status`; the read-only gateway serves it at `/api/f1auth`; the React `#settings` page polls it. Live radio refs ride **frames** (sparse, accumulated onto the snapshot — the race-control pattern, per ADR-0008); replay radio stays snapshot-fixed. Live clips **fire on arrival** in the comms hook, not on the clock — a clip's `Utc` always lags the live lane's wall-clock `timeMs`, so clock-window firing would never trigger.

**Tech Stack:** Python 3.11 (`fastf1`, `redis`), Go 1.x (existing gateway), React + TypeScript (Vite), Redis, docker-compose.

## Global Constraints

- ADR-0003: radio audio is streamed from F1's CDN at play time, never downloaded or committed; clip URLs must pass the existing `formula1.com` https allowlist (`ingest/radio.py`, `web/src/state/comms.ts:isAllowedClip`).
- ADR-0002: the new `radio` frame field is sparse (present only when clips arrive, ~50–100/session) — within the frame-size gate; no other wire-shape change.
- Rev stays monotonic per `CONTEXT.md`; SET snapshot before PUBLISH frame (Tech §2.5) — `ingest/live.py` already does this; keep it.
- Gateway is never a writer: `/api/f1auth` only reads Redis.
- No credentials in app code, logs, or Redis: only the auth *status* (state/tier/expiry) is published — never the token itself.
- Lint gate: `npm run lint -- --max-warnings 0` (strict react-hooks: no ref writes during render, no sync setState in effect body — setState inside interval/handler callbacks is fine).
- Local Go tests: `go test ./...` (NO `-race` — no cgo on this machine; CI runs `-race`).
- Before every commit: `git status` must show `web/dist/.gitkeep` present (restore with `git checkout web/dist/.gitkeep` after any `npm run build`) and `bench/results.csv`/`bench/results.png` unmodified.
- Contract pins: `internal/model/contract_test.go`, `web/src/state/contract.test.ts`, and the Python contract check (`ingest/check_live_contract.py` / `test_capture_replay.py`) pin key sets to the Go model — every task that changes the wire updates all three or CI fails.
- Commit messages end with: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`
- `docs/F1_Race_Tracker_Product_Scope.md` §7 wording (Task 2) is the only sanctioned paid-tier mention; the UI and README must always label this feature "beta" and "unverified pending an F1TV subscription".

---

### Task 1: Spike — test the real link flow with a free F1 account (USER REQUIRED)

The user explicitly wants to run this. It de-risks every later task and its findings are **authoritative over this plan's assumptions**. It needs the user at their browser (they perform the F1 login themselves; never ask them for credentials).

**Files:**
- Create: `docs/superpowers/specs/2026-08-20-f1auth-spike-findings.md`

**Interfaces:**
- Produces: the findings doc — exact `f1auth` API surface, token cache absolute path on this Windows host, JWT claims present for a **free** F1 account (especially any subscription/tier claim), and whether `SignalRClient` connects (even to an empty stream) with a free-account token.

- [ ] **Step 1: Install the live requirements on the host**

```bash
pip install -r ingest/requirements-live.txt
```

Expected: `fastf1` >= 3.8 installs. Record the exact installed version in the findings doc.

- [ ] **Step 2: Inspect the real f1auth module before running anything**

```bash
python -c "import fastf1.internals.f1auth as a, inspect; print(inspect.getsourcefile(a))"
```

Open that file and record in the findings doc: the public function names (expected: `get_auth_token`, `clear_auth_token`, `print_auth_status`), the cache-file path expression (expected: `platformdirs`-based `f1auth.json`), and whether the local HTTP server's port is fixable or always random.

- [ ] **Step 3: Run the link dance (user at the browser)**

Run **in the foreground** (stdout buffering hid the login URL in the July incident):

```bash
python -c "from fastf1.internals.f1auth import get_auth_token; print('token acquired:', bool(get_auth_token()))"
```

Ask the user to: create a free F1 account at formula1.com if they don't have one, install the f1login browser extension (linked from https://f1login.fastf1.dev), open the printed URL, and log in. Expected: the command prints `token acquired: True` and a `f1auth.json` appears at the cache path from Step 2.

- [ ] **Step 4: Record token claims and free-account behavior**

```bash
python -c "from fastf1.internals.f1auth import print_auth_status; print_auth_status()"
```

Record: expiry, any tier/subscription claim, and its value for a free account. Then attempt a `SignalRClient` connect (outside a session it should time out cleanly rather than 401/403 — record which happens; a 401/403 for free accounts vs a clean empty-stream timeout tells us whether the *timing feed* needs a paid tier at the socket level).

- [ ] **Step 5: Write the findings doc and commit**

The doc lists: fastf1 version, API surface, cache path (host), claims table, connect result, and a "corrections to the plan" section (empty if none). Every later task's executor reads this doc first.

```bash
git add docs/superpowers/specs/2026-08-20-f1auth-spike-findings.md
git commit -m "docs(spec): f1auth link-flow spike findings (free F1 account)"
```

---

### Task 2: ADRs, scope amendment, CONTEXT.md vocabulary

**Files:**
- Create: `docs/adr/0007-f1tv-auth-delegated-operator-link.md`
- Create: `docs/adr/0008-live-radio-rides-frames.md`
- Modify: `docs/adr/0003-team-radio-streamed-not-committed.md` (append an "Amended 2026-08" section)
- Modify: `docs/F1_Race_Tracker_Product_Scope.md` (§7 paid-tier line)
- Modify: `CONTEXT.md` (Team radio entry; new "Linked" auth-state entry)

**Interfaces:**
- Produces: the decision record every later task cites. The ADR set was **confirmed by the user 2026-08-20**; write them, don't re-ask.

- [ ] **Step 1: Write ADR-0007** — "Beta live timing: operator-linked F1TV auth, delegated to FastF1." Decision: auth handled by fastf1's `f1auth` (its cache, its extension login); the link dance runs **on the host** via `ingest/f1tv_link.py` because the extension POSTs to host loopback (this supersedes the roadmap's earlier "fixed mapped port" sketch — record why); token copied to git-ignored `./secrets/fastf1/f1auth.json`, mounted read-only, found via `XDG_DATA_HOME=/secrets`; Python publishes status-only JSON to `f1auth:status`; gateway serves it read-only; gates: `--live` + `LIVE=1` + `LIVE_TIMING_MODE=beta`. Non-goals: user accounts (one operator, own subscription), storing/relaying the token anywhere beyond fastf1's cache + the mounted copy.
- [ ] **Step 2: Write ADR-0008** — "Live team radio rides frames; replay radio stays snapshot-fixed." Decision: `Frame.Radio []RadioMessage` (sparse, omitempty); `Apply` appends to `Snapshot.Radio` (no cap — a session yields ~50–100 refs; never cleared on the loop-reset branch, which only replay lanes hit and replay frames never carry radio); frontend fires **appended** entries on arrival (clock-window firing can't work live — record the Utc-lags-clock reasoning). Schema assumption: live SignalR `TeamRadio` payloads ≡ archived `TeamRadio.jsonStream` entries (`Utc`, `RacingNumber`, `Path`; incremental patches may arrive as index-keyed dicts instead of lists); verification net = the capture file `SignalRClient` already writes.
- [ ] **Step 3: Amend ADR-0003** — streaming-not-committed and the allowlist now also cover live-session clips resolved against `https://livetiming.formula1.com/static/` + the `SessionInfo.Path`; note the explicitly unverified assumption that clip mp3s are fetchable mid-session.
- [ ] **Step 4: Amend Product Scope §7** — replace the "Paid data tiers" bullet with: free data only for all shipped features; an optional **beta** live path may use the operator's own F1TV subscription (their account, their login, never required for any shipped feature).
- [ ] **Step 5: Update CONTEXT.md** — Team radio entry: replay radio rides the snapshot whole and fixed (unchanged); **live** radio refs arrive on frames and accumulate on the snapshot (ADR-0008). Add "Linked": the operator-level auth state for the beta live source (`unlinked` / `linked` / `expired`), published by the writer over the seam, served read-only by the gateway.
- [ ] **Step 6: Commit**

```bash
git add docs/adr/0007-f1tv-auth-delegated-operator-link.md docs/adr/0008-live-radio-rides-frames.md docs/adr/0003-team-radio-streamed-not-committed.md docs/F1_Race_Tracker_Product_Scope.md CONTEXT.md
git commit -m "docs(adr): F1TV beta auth (0007), live radio on frames (0008), amend 0003 + scope"
```

---

### Task 3: Pure Python helper — `live_radio_refs` in `ingest/radio.py`

**Files:**
- Modify: `ingest/radio.py`
- Test: `ingest/test_radio.py`

**Interfaces:**
- Consumes: nothing new (module stays fastf1-free, importable by the CI contract job).
- Produces: `live_radio_refs(captures, base_url, session_path, seen) -> list[dict]` — each `{"timeMs": <utc epoch ms>, "driverNum": int, "clip": str}`; mutates `seen` (a set of clip URLs) for dedupe across SignalR re-sends.

- [ ] **Step 1: Write the failing tests** (append to `ingest/test_radio.py`, matching its existing style)

```python
def test_live_radio_refs_maps_and_dedupes():
    seen = set()
    caps = [
        {"Utc": "2026-07-05T14:03:10.500Z", "RacingNumber": "1", "Path": "TeamRadio/MAXVER01_1_20260705_140310.mp3"},
        {"Utc": "2026-07-05T14:03:10.500Z", "RacingNumber": "1", "Path": "TeamRadio/MAXVER01_1_20260705_140310.mp3"},  # dupe
        {"Utc": None, "RacingNumber": "1", "Path": "x.mp3"},          # malformed: skipped
        {"Utc": "2026-07-05T14:04:00Z", "RacingNumber": "abc", "Path": "y.mp3"},  # bad num: skipped
    ]
    out = live_radio_refs(caps, "https://livetiming.formula1.com", "/static/2026/x/y/", seen)
    assert len(out) == 1
    ref = out[0]
    assert ref["driverNum"] == 1
    assert ref["clip"] == "https://livetiming.formula1.com/static/2026/x/y/TeamRadio/MAXVER01_1_20260705_140310.mp3"
    # timeMs is the Utc instant as epoch ms (the live lane's clock domain)
    from datetime import datetime, timezone
    assert ref["timeMs"] == round(datetime(2026, 7, 5, 14, 3, 10, 500000, tzinfo=timezone.utc).timestamp() * 1000)
    # second call with same input: everything already seen
    assert live_radio_refs(caps, "https://livetiming.formula1.com", "/static/2026/x/y/", seen) == []

def test_live_radio_refs_rejects_bad_host():
    import pytest
    with pytest.raises(ValueError):
        live_radio_refs([], "https://evil.example", "/static/", set())
```

- [ ] **Step 2: Run to verify failure**

Run: `python -m pytest ingest/test_radio.py -v -k live_radio`
Expected: FAIL — `NameError`/`ImportError: live_radio_refs`

- [ ] **Step 3: Implement** (in `ingest/radio.py`; reuse the existing `_utc_to_session_ms` epoch math and host validation — extract the host check into a shared `_require_f1_host(base_url)` used by both `extract_radio` and the new function)

```python
def live_radio_refs(captures, base_url, session_path, seen):
    """Map live SignalR TeamRadio captures to wire radio refs (ADR-0008).

    captures: list of {'Utc','RacingNumber','Path'} (archived-feed schema).
    timeMs is the capture's Utc as UTC epoch ms — the live lane's clock domain
    (live frames stamp timeMs = wall clock, see live_signalr.py).
    seen: set of already-emitted clip URLs, mutated here — SignalR re-sends the
    full capture list at (re)subscribe, so dedupe is by final URL.
    Malformed entries are skipped, mirroring extract_radio.
    """
    _require_f1_host(base_url)
    out = []
    for cap in captures:
        utc, num, path = cap.get("Utc"), cap.get("RacingNumber"), cap.get("Path")
        if utc is None or num is None or path is None:
            continue
        try:
            driver_num = int(num)
        except (TypeError, ValueError):
            continue
        clip = base_url.rstrip("/") + "/" + session_path.strip("/") + "/" + path.lstrip("/")
        if clip in seen:
            continue
        seen.add(clip)
        out.append({"timeMs": _utc_to_epoch_ms(utc), "driverNum": driver_num, "clip": clip})
    out.sort(key=lambda m: m["timeMs"])
    return out
```

with `_utc_to_epoch_ms(utc_str)` as a sibling of `_utc_to_session_ms` (same parse, `round(dt.timestamp() * 1000)`, no t0 subtraction).

- [ ] **Step 4: Run all radio tests**

Run: `python -m pytest ingest/test_radio.py -v`
Expected: all PASS (old `extract_radio` tests must still pass after the `_require_f1_host` extraction).

- [ ] **Step 5: Commit**

```bash
git add ingest/radio.py ingest/test_radio.py
git commit -m "feat(ingest): live_radio_refs — live TeamRadio captures to wire refs (ADR-0008)"
```

---

### Task 4: `ingest/f1tv_auth.py` (status) + `ingest/f1tv_link.py` (host link CLI)

**Files:**
- Create: `ingest/f1tv_auth.py`
- Create: `ingest/f1tv_link.py`
- Test: `ingest/test_f1tv_auth.py`
- Modify: `.gitignore` (add `secrets/`)

**Interfaces:**
- Consumes: Task 1's findings doc (cache path, claim names — adapt the constants below to it).
- Produces:
  - `auth_status(token_path=None) -> dict` — `{"state": "unlinked"|"linked"|"expired", "expiresUtc"?: str, "tier"?: str}` — pure (reads a file, decodes JWT claims **without** verification — display only; fastf1 does the real verification at connect time), fastf1-free, so the CI contract job can test it.
  - `publish_status_loop(r, interval_s=60)` — daemon-thread target; `SET f1auth:status <json>` now and every interval.
  - `AUTH_STATUS_KEY = "f1auth:status"`
  - `f1tv_link.py` — host CLI: run fastf1's `get_auth_token()` in the foreground, then copy the cache file to `./secrets/fastf1/f1auth.json`.

- [ ] **Step 1: Write the failing tests**

```python
# ingest/test_f1tv_auth.py
import base64, json, time
from f1tv_auth import auth_status

def _fake_jwt(claims):
    b64 = lambda d: base64.urlsafe_b64encode(json.dumps(d).encode()).rstrip(b"=").decode()
    return f"{b64({'alg': 'RS256'})}.{b64(claims)}.sig"

def test_unlinked_when_file_missing(tmp_path):
    assert auth_status(tmp_path / "nope.json") == {"state": "unlinked"}

def test_linked_with_expiry_and_tier(tmp_path):
    exp = int(time.time()) + 3600
    p = tmp_path / "f1auth.json"
    p.write_text(json.dumps({"token": _fake_jwt({"exp": exp, "SubscriptionStatus": "active"})}))
    st = auth_status(p)
    assert st["state"] == "linked"
    assert "expiresUtc" in st

def test_expired_token(tmp_path):
    p = tmp_path / "f1auth.json"
    p.write_text(json.dumps({"token": _fake_jwt({"exp": int(time.time()) - 10})}))
    assert auth_status(p)["state"] == "expired"

def test_corrupt_file_is_unlinked(tmp_path):
    p = tmp_path / "f1auth.json"
    p.write_text("{not json")
    assert auth_status(p)["state"] == "unlinked"
```

**Adapt to Task 1's findings:** the cache file's actual JSON shape (key holding the JWT) and the claim carrying the tier (`SubscriptionStatus` is the researched guess) — fix the test fixtures AND implementation to the real names; never guess past the spike.

- [ ] **Step 2: Run to verify failure**

Run: `python -m pytest ingest/test_f1tv_auth.py -v`
Expected: FAIL — `ModuleNotFoundError: f1tv_auth`

- [ ] **Step 3: Implement `f1tv_auth.py`**

```python
"""F1TV auth status for the beta live path (ADR-0007).

Status only — this module NEVER handles credentials and never publishes the
token. The real login/verification belongs to fastf1's f1auth; here we only
read its cache file to report unlinked/linked/expired for the settings page.
Kept fastf1-free (stdlib only) so the CI contract job can import and test it.
"""
import base64, binascii, json, os, threading, time
from datetime import datetime, timezone
from pathlib import Path

AUTH_STATUS_KEY = "f1auth:status"

def default_token_path():
    # Container: XDG_DATA_HOME=/secrets → /secrets/fastf1/f1auth.json (compose mounts ./secrets).
    # Host fallback: fastf1's platformdirs location — value from the Task-1 spike findings.
    base = os.environ.get("XDG_DATA_HOME")
    if base:
        return Path(base) / "fastf1" / "f1auth.json"
    import platformdirs  # host-only path; installed with fastf1
    return Path(platformdirs.user_data_dir("fastf1")) / "f1auth.json"

def _decode_claims(jwt):
    payload = jwt.split(".")[1]
    payload += "=" * (-len(payload) % 4)
    return json.loads(base64.urlsafe_b64decode(payload))

def auth_status(token_path=None):
    path = Path(token_path) if token_path else default_token_path()
    try:
        cached = json.loads(path.read_text())
        claims = _decode_claims(cached["token"])  # key name per spike findings
        exp = int(claims["exp"])
    except (OSError, KeyError, ValueError, IndexError, binascii.Error, json.JSONDecodeError):
        return {"state": "unlinked"}
    state = "expired" if exp <= time.time() else "linked"
    out = {"state": state,
           "expiresUtc": datetime.fromtimestamp(exp, tz=timezone.utc).isoformat()}
    tier = claims.get("SubscriptionStatus")  # claim name per spike findings
    if tier:
        out["tier"] = str(tier)
    return out

def publish_status_loop(r, interval_s=60):
    while True:
        r.set(AUTH_STATUS_KEY, json.dumps(auth_status(), separators=(",", ":")))
        time.sleep(interval_s)

def start_status_publisher(r):
    t = threading.Thread(target=publish_status_loop, args=(r,), daemon=True)
    t.start()
    return t
```

- [ ] **Step 4: Implement `f1tv_link.py`** (host-only; foreground; copies the token into the mounted secrets dir)

```python
"""Link the operator's F1 account for the beta live path (ADR-0007). HOST-ONLY:
the f1login browser extension POSTs the token to 127.0.0.1, which a container
cannot receive. Run:  python ingest/f1tv_link.py        (then follow the URL)
       or:            python ingest/f1tv_link.py --status
       or:            python ingest/f1tv_link.py --unlink
"""
import argparse, shutil, sys
from pathlib import Path
from f1tv_auth import auth_status, default_token_path

SECRETS_COPY = Path(__file__).resolve().parent.parent / "secrets" / "fastf1" / "f1auth.json"

def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--status", action="store_true")
    ap.add_argument("--unlink", action="store_true")
    args = ap.parse_args()
    if args.status:
        print(auth_status()); return
    if args.unlink:
        from fastf1.internals.f1auth import clear_auth_token
        clear_auth_token()
        SECRETS_COPY.unlink(missing_ok=True)
        print("unlinked"); return
    from fastf1.internals.f1auth import get_auth_token  # import here: host has fastf1
    print("Starting F1 account link — a URL will be printed; open it in your browser")
    print("(needs the f1login extension from https://f1login.fastf1.dev).", flush=True)
    if not get_auth_token():
        print("link failed — no token acquired", file=sys.stderr); sys.exit(1)
    SECRETS_COPY.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(default_token_path(), SECRETS_COPY)
    print(f"Linked. Token cached by fastf1 and copied to {SECRETS_COPY} for docker.")
    print("Status:", auth_status())

if __name__ == "__main__":
    main()
```

Add `secrets/` to `.gitignore`.

- [ ] **Step 5: Run the tests**

Run: `python -m pytest ingest/test_f1tv_auth.py -v`
Expected: PASS. Then hand-verify on the host (token exists from Task 1): `python ingest/f1tv_link.py --status` prints a `linked` dict.

- [ ] **Step 6: Commit**

```bash
git add ingest/f1tv_auth.py ingest/f1tv_link.py ingest/test_f1tv_auth.py .gitignore
git commit -m "feat(ingest): F1TV auth status + host link CLI (ADR-0007)"
```

---

### Task 5: Wire auth + TeamRadio into `ingest/live_signalr.py` and `ingest/live.py`

**Files:**
- Modify: `ingest/live_signalr.py` (gate, fail-fast, `SessionInfo` + `TeamRadio` handling in both `handle_message` and `_replay_capture`)
- Modify: `ingest/live.py` (`build_frame` gains `radio=`; `main()` starts the status publisher)
- Test: `ingest/test_capture_replay.py` (TeamRadio lines in the capture fixture)

**Interfaces:**
- Consumes: `live_radio_refs` (Task 3), `start_status_publisher`/`auth_status` (Task 4).
- Produces: frames whose JSON may carry `"radio": [{timeMs,driverNum,clip}]`; snapshot `radio` accumulates the same refs. Downstream (Tasks 6–8) relies on exactly this field name and shape.

- [ ] **Step 1: Extend the capture-replay test first** — append two lines to the fixture capture used by `test_capture_replay.py` (match its existing fixture-building style):

```python
['SessionInfo', {'Path': '2026/2026-07-05_British_Grand_Prix/2026-07-05_Race/'}, '2026-07-05T14:00:00.000Z']
['TeamRadio', {'Captures': [{'Utc': '2026-07-05T14:03:10.5Z', 'RacingNumber': '1', 'Path': 'TeamRadio/MAXVER01_1_20260705_140310.mp3'}]}, '2026-07-05T14:03:12.000Z']
```

Assert after replay: the published snapshot's `radio` contains exactly one ref with `driverNum == 1` and clip `https://livetiming.formula1.com/static/2026/2026-07-05_British_Grand_Prix/2026-07-05_Race/TeamRadio/MAXVER01_1_20260705_140310.mp3`, and at least one published frame carried a `radio` key. Also add a dict-form case (incremental patch shape): `{'Captures': {'1': {...}}}` must parse identically.

- [ ] **Step 2: Run to verify failure**

Run: `python -m pytest ingest/test_capture_replay.py -v`
Expected: new assertions FAIL (no `radio` anywhere).

- [ ] **Step 3: Implement in `live_signalr.py`**

(a) Module state alongside the existing holders in `_run_live_signalr` (and mirrored in `_replay_capture`'s local state):

```python
STATIC_BASE = "https://livetiming.formula1.com"
session_path_holder = [""]      # from SessionInfo.Path
seen_clips: set[str] = set()
pending_radio: list[dict] = []
```

(b) New branches in `handle_message` (same guard style as the existing topics):

```python
elif topic == 'SessionInfo':
    if isinstance(payload, dict) and isinstance(payload.get('Path'), str):
        session_path_holder[0] = "/static/" + payload['Path']

elif topic == 'TeamRadio':
    if not isinstance(payload, dict):
        return
    caps = payload.get('Captures')
    if isinstance(caps, dict):   # incremental patch: index-keyed dict, order by int key
        caps = [v for _, v in sorted(caps.items(), key=lambda kv: _safe_int(kv[0]))]
    if not isinstance(caps, list) or not session_path_holder[0]:
        return
    entries = [c for c in caps if isinstance(c, dict)]
    pending_radio.extend(live_radio_refs(entries, STATIC_BASE, session_path_holder[0], seen_clips))
```

(c) In the rate-limited publish block (after `frame = build_frame(...)` is constructed): attach and fold —

```python
if pending_radio:
    frame["radio"] = list(pending_radio)
    snap["radio"] = snap.get("radio", []) + pending_radio
    pending_radio.clear()
```

(d) `_replay_capture`: add `('sessioninfo', td, payload)` / `('radio', td, payload)` entries to the merged event list (from `livedata.get('SessionInfo')` / `livedata.get('TeamRadio')` when present) and handle them with the same logic, so capture replay exercises the identical code path.

(e) The gate + fail-fast in `run_live` (replacing the bare `LIVE=1` branch):

```python
if not live_enabled:
    ... # unchanged structural-check log-and-return
if os.environ.get('LIVE_TIMING_MODE') != 'beta':
    _log.error("Real connection needs LIVE_TIMING_MODE=beta (ADR-0007) on top of --live and LIVE=1.")
    sys.exit(1)
from f1tv_auth import auth_status
st = auth_status()
if st["state"] != "linked":
    _log.error(f"F1TV account is {st['state']} — run on the HOST:  python ingest/f1tv_link.py")
    _log.error("Then restart this service. See docs/runbooks/live-verification.md.")
    sys.exit(1)
_log.info(f"F1TV linked (tier={st.get('tier', '?')}, expires {st.get('expiresUtc', '?')}) — connecting…")
```

(f) `ingest/live.py`: `build_frame(..., radio=None)` adds `frame["radio"] = radio` when truthy (mirroring `messages`); `main()` calls `start_status_publisher(r)` right after `r.ping()` (all modes — the settings page works even in the demo).

- [ ] **Step 4: Run the ingest tests**

Run: `python -m pytest ingest/ -v`
Expected: all PASS, including the extended capture replay.

- [ ] **Step 5: Commit**

```bash
git add ingest/live_signalr.py ingest/live.py ingest/test_capture_replay.py
git commit -m "feat(ingest): beta gate + fail-fast auth + live TeamRadio → frames (ADR-0007/0008)"
```

---

### Task 6: Go model — `Frame.Radio`, `Apply` accumulation, contract pins

**Files:**
- Modify: `internal/model/model.go` (Frame struct)
- Modify: `internal/model/apply.go`
- Test: `internal/model/apply_test.go`, `internal/model/contract_test.go`
- Modify: `web/src/state/contract.test.ts` and the Python key-set pin (`ingest/check_live_contract.py` or wherever `test_capture_replay.py` pins frame keys — locate with `grep -rn "timeMs" ingest/check_live_contract.py`): add `radio` to the Frame key set in **all three** pins.

**Interfaces:**
- Consumes: the wire field `"radio"` produced by Task 5.
- Produces: `Frame.Radio []RadioMessage` with JSON tag `radio,omitempty`; `Apply` appends `f.Radio` onto `s.Radio` (never cleared by the loop-reset branch).

- [ ] **Step 1: Write the failing tests** (append to `apply_test.go`, matching its table/style conventions)

```go
func TestApplyAccumulatesRadio(t *testing.T) {
	s := NewSnapshot("live", "live", "Live F1")
	s.Rev = 1
	s.Radio = []RadioMessage{{TimeMs: 100, DriverNum: 1, Clip: "https://livetiming.formula1.com/a.mp3"}}
	_, ok := Apply(s, Frame{Rev: 2, TimeMs: 200, Radio: []RadioMessage{{TimeMs: 150, DriverNum: 16, Clip: "https://livetiming.formula1.com/b.mp3"}}})
	if !ok || len(s.Radio) != 2 || s.Radio[1].DriverNum != 16 {
		t.Fatalf("radio not accumulated: ok=%v radio=%v", ok, s.Radio)
	}
}

func TestApplyLoopResetKeepsRadio(t *testing.T) {
	s := NewSnapshot("replay", "replay", "Monza")
	s.Rev, s.TimeMs = 5, 5000
	s.Radio = []RadioMessage{{TimeMs: 100, DriverNum: 1, Clip: "https://livetiming.formula1.com/a.mp3"}}
	s.Messages = []RaceControlMessage{{Rev: 5, T: 4000, Category: "Flag", Message: "GREEN"}}
	_, _ = Apply(s, Frame{Rev: 6, TimeMs: 100}) // clip loops back: TimeMs decreases
	if len(s.Messages) != 0 {
		t.Fatalf("loop reset must clear messages")
	}
	if len(s.Radio) != 1 {
		t.Fatalf("loop reset must NOT clear radio (replay timeline is snapshot-fixed, ADR-0008)")
	}
}
```

- [ ] **Step 2: Run to verify failure**

Run: `go test ./internal/model/ -run TestApply -v`
Expected: FAIL — `Frame` has no field `Radio` (compile error).

- [ ] **Step 3: Implement** — in `model.go`, add to `Frame` (after `Messages`):

```go
	Radio []RadioMessage `json:"radio,omitempty"` // live-lane team-radio refs; accumulated by Apply (ADR-0008)
```

In `apply.go`, after the Messages block:

```go
	if len(f.Radio) > 0 {
		// ADR-0008: live radio refs accumulate; uncapped (~50-100/session).
		// Deliberately NOT cleared by the loop-reset branch above — only replay
		// lanes loop, and replay frames never carry radio.
		s.Radio = append(s.Radio, f.Radio...)
	}
```

- [ ] **Step 4: Update all three contract pins** — add `"radio"` to the Frame key set in `internal/model/contract_test.go`, `web/src/state/contract.test.ts`, and the Python pin. Run each until green.

- [ ] **Step 5: Run the full Go and contract suites**

Run: `go test ./...` then `python -m pytest ingest/ -v` then `cd web && npx vitest run src/state/contract.test.ts`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add internal/model/ web/src/state/contract.test.ts ingest/
git commit -m "feat(model): Frame.Radio accumulated by Apply; pin radio in all contract tests (ADR-0008)"
```

---

### Task 7: Gateway — `/api/f1auth` + `bus.GetAuthStatus`

**Files:**
- Modify: `internal/bus/redis.go`
- Modify: `internal/app/gateway.go` (Mount + handler)
- Test: `internal/bus/` existing test file (match its name), `internal/app/gateway_test.go`

**Interfaces:**
- Consumes: Redis key `f1auth:status` written by Task 4/5 (`f1tv_auth.AUTH_STATUS_KEY`).
- Produces: `GET /api/f1auth` → the stored JSON verbatim, or `{"state":"unlinked"}` when the key is absent. `func (b *Bus) GetAuthStatus(ctx context.Context) ([]byte, error)` (nil, nil when absent).

- [ ] **Step 1: Write the failing tests** — bus test (using the package's existing miniredis/real-redis harness — follow whatever `redis_test.go` does): set `f1auth:status` to `{"state":"linked"}`, assert `GetAuthStatus` returns those bytes; absent key returns `(nil, nil)`. Gateway test (follow `gateway_test.go`'s httptest pattern): GET `/api/f1auth` with the key set returns 200, `Content-Type: application/json`, body `{"state":"linked"}`; with the key absent returns 200 body `{"state":"unlinked"}`; POST returns 405.

- [ ] **Step 2: Run to verify failure**

Run: `go test ./internal/bus/ ./internal/app/ -run 'AuthStatus|F1auth' -v`
Expected: FAIL (method/route missing).

- [ ] **Step 3: Implement** — `redis.go`:

```go
// authStatusKey mirrors ingest/f1tv_auth.py's AUTH_STATUS_KEY.
const authStatusKey = "f1auth:status"

// GetAuthStatus returns the raw F1TV auth-status JSON published by the Python
// ingester, or (nil, nil) if none has been published. Read-only: the gateway
// serves this verbatim (ADR-0007) and never writes it.
func (b *Bus) GetAuthStatus(ctx context.Context) ([]byte, error) {
	val, err := b.rdb.Get(ctx, authStatusKey).Bytes()
	if err == redis.Nil {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("bus: get auth status: %w", err)
	}
	return val, nil
}
```

`gateway.go` — in `Mount`, after the `/control/source` line: `mux.HandleFunc("/api/f1auth", g.handleAuthStatus)`; and:

```go
// handleAuthStatus serves the Python-published F1TV auth status verbatim (ADR-0007).
// The gateway stays read-only: status is written only by the ingest side.
func (g *Gateway) handleAuthStatus(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	raw, err := g.bus.GetAuthStatus(r.Context())
	if err != nil {
		g.logger.Error("auth status read failed", "err", err)
		http.Error(w, "auth status unavailable", http.StatusBadGateway)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	if raw == nil {
		raw = []byte(`{"state":"unlinked"}`)
	}
	_, _ = w.Write(raw)
}
```

- [ ] **Step 4: Run**: `go test ./...` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add internal/bus/ internal/app/
git commit -m "feat(gateway): read-only /api/f1auth serving the seam's auth status (ADR-0007)"
```

---

### Task 8: Frontend wire — radio on frames (parse, apply, fire-on-arrival)

**Files:**
- Modify: `web/src/state/race.ts` (`FrameData.radio`, `parseMsg` guard, `applyMessage` append)
- Modify: `web/src/hooks/useComms.ts` (fire appended refs)
- Test: `web/src/state/race.test.ts`

**Interfaces:**
- Consumes: `Frame.Radio` from Task 6.
- Produces: `RaceState.radio` grows when frames carry refs; `useComms` auto-plays refs that appear via frames (replay lanes are unaffected — their frames never carry radio).

- [ ] **Step 1: Write the failing tests** (append to `race.test.ts`, matching its style)

```ts
it('accumulates frame radio refs onto state (ADR-0008)', () => {
  const s0 = applyMessage(emptyState(), {
    type: 'snapshot',
    data: { session: 'live', mode: 'live', label: 'L', cars: {}, timeMs: 0, rev: 1,
            radio: [{ timeMs: 100, driverNum: 1, clip: 'https://livetiming.formula1.com/a.mp3' }] },
  });
  const s1 = applyMessage(s0, {
    type: 'frame',
    data: { rev: 2, timeMs: 200, cars: [],
            radio: [{ timeMs: 150, driverNum: 16, clip: 'https://livetiming.formula1.com/b.mp3' }] },
  });
  expect(s1.radio).toHaveLength(2);
  expect(s1.radio[1].driverNum).toBe(16);
});

it('rejects a frame whose radio is not an array', () => {
  expect(parseMsg({ type: 'frame', data: { rev: 2, timeMs: 200, radio: 'nope' } })).toBeNull();
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd web && npx vitest run src/state/race.test.ts`
Expected: new tests FAIL.

- [ ] **Step 3: Implement in `race.ts`** — `FrameData` gains `radio?: RadioMessage[];` — `parseMsg`'s frame branch gains (beside the cars/messages guards):

```ts
    if (data.radio !== undefined && !Array.isArray(data.radio)) return null;
```

`applyMessage`'s frame branch (beside `messages`):

```ts
  const radio = d.radio?.length ? [...s.radio, ...d.radio] : s.radio;
```

and include `radio` in the returned object.

- [ ] **Step 4: Fire-on-arrival in `useComms.ts`** — read the hook first; it currently drives `stepComms(cursor, clock, state.radio, isSnapshot)` off `snapshotSeq`/frames. Add: track the previously-seen radio length in the same state the cursor lives in (`prevRadioLen`); on a non-snapshot step where `state.radio.length > prevRadioLen`, enqueue the appended slice `state.radio.slice(prevRadioLen)` for auto-play **instead of** clock-window filtering for those entries (they are live arrivals whose `timeMs` — the clip's real Utc — is already behind the live wall clock, so `stepComms`' window can never catch them); on a snapshot step, reset `prevRadioLen = state.radio.length` (snapshot refs go to history exactly as today). Clips still pass `isAllowedClip` before playback (existing code path — do not duplicate the check). Keep the change inside the hook's existing pump/handler structure — no `setState` directly in an effect body (lint gate).

- [ ] **Step 5: Run web tests + lint**

Run: `cd web && npx vitest run && npm run lint -- --max-warnings 0`
Expected: PASS, zero warnings.

- [ ] **Step 6: Commit**

```bash
git add web/src/state/race.ts web/src/state/race.test.ts web/src/hooks/useComms.ts
git commit -m "feat(web): frame-delivered radio refs accumulate and fire on arrival (ADR-0008)"
```

---

### Task 9: Settings page — `#settings` route, status display, link guide

**Files:**
- Create: `web/src/components/Settings.tsx`
- Create: `web/src/state/f1auth.ts` (pure status-shape parsing — testable)
- Test: `web/src/state/f1auth.test.ts`
- Modify: `web/src/App.tsx` (route), `web/src/components/StatusRail.tsx` (tab), `web/src/styles/components.css` (only if a needed class is missing — reuse `.panel`/`.chip` vocabulary; NO inline hex colours, per the roadmap's WS1 direction)

**Interfaces:**
- Consumes: `GET /api/f1auth` (Task 7).
- Produces: `parseAuthStatus(raw: unknown): AuthStatus` where `type AuthStatus = { state: 'unlinked' | 'linked' | 'expired' | 'unavailable'; expiresUtc?: string; tier?: string }`.

- [ ] **Step 1: Write the failing tests**

```ts
// web/src/state/f1auth.test.ts
import { describe, expect, it } from 'vitest';
import { parseAuthStatus } from './f1auth';

describe('parseAuthStatus', () => {
  it('passes through a valid linked status', () => {
    expect(parseAuthStatus({ state: 'linked', expiresUtc: '2026-09-01T00:00:00+00:00', tier: 'active' }))
      .toEqual({ state: 'linked', expiresUtc: '2026-09-01T00:00:00+00:00', tier: 'active' });
  });
  it('maps unknown states and garbage to unavailable', () => {
    expect(parseAuthStatus({ state: 'weird' }).state).toBe('unavailable');
    expect(parseAuthStatus(null).state).toBe('unavailable');
    expect(parseAuthStatus('x').state).toBe('unavailable');
  });
});
```

- [ ] **Step 2: Run to verify failure** — `cd web && npx vitest run src/state/f1auth.test.ts` — FAIL (module missing).

- [ ] **Step 3: Implement `f1auth.ts`**

```ts
/** F1TV beta auth status served by /api/f1auth (ADR-0007). Untrusted wire data
 *  → validated here before render, mirroring race.ts's parseMsg discipline. */
export type AuthState = 'unlinked' | 'linked' | 'expired' | 'unavailable';
export interface AuthStatus { state: AuthState; expiresUtc?: string; tier?: string }

const KNOWN: AuthState[] = ['unlinked', 'linked', 'expired'];

export function parseAuthStatus(raw: unknown): AuthStatus {
  if (typeof raw !== 'object' || raw === null) return { state: 'unavailable' };
  const r = raw as Record<string, unknown>;
  if (!KNOWN.includes(r.state as AuthState)) return { state: 'unavailable' };
  const out: AuthStatus = { state: r.state as AuthState };
  if (typeof r.expiresUtc === 'string') out.expiresUtc = r.expiresUtc;
  if (typeof r.tier === 'string') out.tier = r.tier;
  return out;
}
```

- [ ] **Step 4: Implement `Settings.tsx`** — a `Panel`-based page: heading "F1TV Link — beta"; a status chip (`unlinked` → `--slate`, `linked` → the token WS1 will name for good, `expired`/`unavailable` → `--amber`; if WS1 hasn't landed yet, use `--amber`/`--slate` only — both exist today); when linked, show tier + expiry; always show the honest beta copy: "This feature is unverified pending an F1TV subscription — see the runbook."; link instructions with the exact host command in a `<code>` block (`python ingest/f1tv_link.py`) and unlink (`python ingest/f1tv_link.py --unlink`); a note that linking runs on the host because the browser login cannot reach a container. Poll `/api/f1auth` every 5 s while mounted:

```tsx
import { useEffect, useState } from 'react';
import { Panel } from './Panel';
import { StatusRail } from './StatusRail';
import { parseAuthStatus, type AuthStatus } from '../state/f1auth';

const POLL_MS = 5000;

export function Settings() {
  const [auth, setAuth] = useState<AuthStatus>({ state: 'unavailable' });
  useEffect(() => {
    let live = true;
    const pull = () =>
      fetch('/api/f1auth')
        .then((r) => r.json())
        .then((j) => { if (live) setAuth(parseAuthStatus(j)); })
        .catch(() => { if (live) setAuth({ state: 'unavailable' }); });
    pull();
    const id = setInterval(pull, POLL_MS);
    return () => { live = false; clearInterval(id); };
  }, []);
  // ... render per the states above
}
```

In the static GH-Pages demo (`import.meta.env.VITE_STATIC_DEMO === 'true'`) there is no gateway: render the page with a single line — "Not available in the static demo — run the full system (`docker compose up`) to link." — and skip polling entirely.

- [ ] **Step 5: Route + tab** — `App.tsx`: `if (hash === '#settings') return <Settings />;` beside the `#compare`/`#ghost` branches. `StatusRail.tsx`: append to `TABS`: `{ key: 'settings', href: '#settings', label: 'LINK', sub: 'F1TV beta' }` and widen the `active` prop union with `'settings'`.

- [ ] **Step 6: Verify** — `cd web && npx vitest run && npm run lint -- --max-warnings 0 && npx tsc -b`. Then live: `docker compose up --build -d`, open `http://localhost:8080#settings` — with no status key it shows "unlinked" (gateway default); with the host token linked and the live container running it flips to "linked" within a minute. If `npm run build` ran, restore `web/dist/.gitkeep`.

- [ ] **Step 7: Commit**

```bash
git add web/src/components/Settings.tsx web/src/state/f1auth.ts web/src/state/f1auth.test.ts web/src/App.tsx web/src/components/StatusRail.tsx web/src/styles/components.css
git commit -m "feat(web): #settings page — F1TV link status, guided host link flow (ADR-0007)"
```

---

### Task 10: Compose, secrets mount, runbook + README

**Files:**
- Modify: `docker-compose.yml` (live service only)
- Modify: `docs/runbooks/live-verification.md`
- Modify: `README.md` (new "Beta: live timing with your F1TV subscription" section)
- Modify: `ingest/requirements-live.txt` (pin the fastf1 version recorded in Task 1)

**Interfaces:**
- Consumes: `./secrets/fastf1/f1auth.json` (written by `f1tv_link.py`, Task 4).
- Produces: the documented operator flow the settings page references.

- [ ] **Step 1: Compose** — add to the `live` service:

```yaml
    environment:
      REDIS_URL: redis://redis:6379
      SESSION_KEY: live
      XDG_DATA_HOME: /secrets        # fastf1/f1auth token resolves to /secrets/fastf1/f1auth.json (ADR-0007)
    volumes:
      - ./data:/data:ro
      - ./secrets:/secrets:ro        # host-linked F1TV token; git-ignored; absent dir = unlinked, still boots
```

Create `secrets/.gitkeep`-style presence is NOT needed — compose creates an empty dir mount; verify `docker compose up` still boots the demo with no `secrets/` dir present.

- [ ] **Step 2: Runbook** — extend `docs/runbooks/live-verification.md` with the beta flow: (1) `pip install -r ingest/requirements-live.txt` on the host; (2) `python ingest/f1tv_link.py` (foreground, browser + f1login extension; free F1 account links, paid F1TV Access is what the timing feed needs per the spike findings); (3) `#settings` page shows Linked; (4) race-day: set `LIVE=1 LIVE_TIMING_MODE=beta` and the `--live` command on the live service (show the exact compose-override snippet, including the existing Redis-port override pattern for host-side capture — do not change the tracked compose defaults); (5) what remains unverified until a paid subscription (the three residue items) and where the raw capture lands (`CAPTURE_OUT`) for schema verification; (6) troubleshooting: expired token, missing extension, structural-check mode.

- [ ] **Step 3: README** — a short beta section: what it is, one-paragraph honest status ("built and tested end-to-end against recorded sessions; the authenticated live connection, the radio topic's tier requirement, and mid-session clip availability are unverified pending an F1TV subscription"), pointer to the runbook and ADR-0007/0008.

- [ ] **Step 4: Verify the default demo is untouched** — `docker compose up --build -d` with no secrets dir and no LIVE env: all four lanes play exactly as before; `#settings` shows unlinked. Then `docker compose down`.

- [ ] **Step 5: Commit**

```bash
git add docker-compose.yml docs/runbooks/live-verification.md README.md ingest/requirements-live.txt
git commit -m "docs+compose: F1TV beta operator flow — secrets mount, runbook, README honesty"
```

---

### Task 11: End-to-end-minus-auth verification + FILE-MAP

**Files:**
- Modify: none expected (verification task); `FILE-MAP.md` regenerated (new `ingest` modules change its file count)

- [ ] **Step 1: Full-suite run**

```bash
go test ./...
python -m pytest ingest/ -v
cd web && npx vitest run && npm run lint -- --max-warnings 0 && npx tsc -b && cd ..
python scripts/gen_file_map.py
```

Expected: all green; `FILE-MAP.md` regenerates (new files carry module docstrings — CI fails on blanks, so `f1tv_auth.py`/`f1tv_link.py` docstrings from Task 4 must be present).

- [ ] **Step 2: Live-ish smoke with real recorded data** — using the repo's existing capture fixture (or a freshly downloaded historical session per the runbook): `CAPTURE_FILE=<capture> python ingest/live.py --live --session live` against the compose Redis (host override port, per runbook), gateway on `live` source, browser open: confirm a radio clip fires in the Comms panel from frame-delivered refs (not the snapshot), and the settings page shows the real host token status. This is the "end-to-end minus auth" acceptance gate for the whole feature.

- [ ] **Step 3: Pre-commit hygiene then final commit** — `git status`: `web/dist/.gitkeep` present, `bench/results.*` clean, `secrets/` untracked.

```bash
git add FILE-MAP.md
git commit -m "chore: regenerate FILE-MAP for F1TV beta modules; e2e-minus-auth verified"
```

---

## Self-review notes (done at plan time)

- **Spec coverage:** link page (Task 9), host link flow (Task 4), auth over the seam (Tasks 4/5/7), live radio full pipeline (Tasks 3/5/6/8), beta gating + fail-fast (Task 5), docs/ADR set exactly as user-confirmed (Task 2), free-account spike the user asked for (Task 1), e2e-minus-auth (Tasks 5/11), static-demo unaffected (Tasks 9/10).
- **Known unknowns are quarantined:** everything dependent on fastf1's exact internals (cache JSON shape, claim names, port behavior) is resolved by Task 1 and consumed as data by Tasks 4/5/10 — those tasks say exactly what to adapt.
- **Type consistency:** `radio` field name and `{timeMs,driverNum,clip}` shape are identical across Python (`live_radio_refs`), Go (`RadioMessage`), and TS (`RadioMessage`) — all pre-existing except the frame placement; `AUTH_STATUS_KEY`/`authStatusKey` = `f1auth:status` in both languages; `AuthStatus.state` values match Python's `auth_status` output plus the FE-only `unavailable`.
