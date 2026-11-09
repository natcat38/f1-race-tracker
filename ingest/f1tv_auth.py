"""F1TV auth status for the beta live path (ADR-0007).

Status only. This module NEVER handles credentials and never publishes the token —
the login and its verification belong to fastf1's `f1account` package (fastf1 3.9+).
Here we read its token file and report unlinked / linked / expired for the settings
page.

Deliberately stdlib-only (no fastf1, no platformdirs at import) so the CI contract
job can test it and the demo container can publish status without a heavy image.
The JWT claims are decoded WITHOUT signature verification — display only; fastf1
does the real verification when it connects.

Token file (fastf1 3.9, `f1account/tokens.py`, TokenManager.store): JSON
`{"version": 1, "value": "<subscription JWT>", "expires_at": <epoch seconds>}` in
`f1auth_token.json`. fastf1 3.8 wrote a raw JWT to `f1auth.json`; that file is no
longer read.
"""
import base64
import binascii
import json
import logging
import math
import os
import threading
import time
from datetime import datetime, timezone
from pathlib import Path

_log = logging.getLogger("f1tv_auth")

AUTH_STATUS_KEY = "f1auth:status"

# Token file name and schema version written by fastf1 3.9's TokenManager.
TOKEN_FILENAME = "f1auth_token.json"
TOKEN_FILE_VERSION = 1

# Claim names confirmed against fastf1 3.8.3's f1auth.print_auth_status(); the 3.9
# token is the same F1TV entitlement JWT (SubscriptionToken.claims), so they carry over.
_TIER_CLAIM = "SubscriptionStatus"
_PRODUCT_CLAIM = "SubscribedProduct"


def default_token_path():
    """Where fastf1 caches the F1TV token, or None if it cannot be located here.

    Container: XDG_DATA_HOME=/secrets → /secrets/fastf1/f1auth_token.json (compose
    mounts ./secrets read-only; we only ever read). Host: fastf1's platformdirs
    location, the same one TokenManager uses by default.
    A demo container has neither, which simply reads as unlinked.
    """
    base = os.environ.get("XDG_DATA_HOME")
    if base:
        return Path(base) / "fastf1" / TOKEN_FILENAME
    try:
        import platformdirs
    except ImportError:
        return None
    return Path(platformdirs.user_data_dir("fastf1")) / TOKEN_FILENAME


def _decode_claims(jwt):
    payload = jwt.split(".")[1]
    payload += "=" * (-len(payload) % 4)
    return json.loads(base64.urlsafe_b64decode(payload))


def auth_status(token_path=None):
    """Report {'state': 'unlinked'|'linked'|'expired', 'expiresUtc'?, 'tier'?, 'product'?}.

    The file is JSON (see the module docstring). Missing, empty, wrong-version,
    malformed or undecodable content all degrade to unlinked rather than raising. The
    expiry is the file's own `expires_at` (what fastf1 checks); the JWT is decoded only
    for the subscription claims and must be well-formed.
    """
    path = Path(token_path) if token_path else default_token_path()
    if path is None:
        return {"state": "unlinked"}
    try:
        raw = path.read_text().strip()
        if not raw:
            return {"state": "unlinked"}
        data = json.loads(raw)
        if not isinstance(data, dict) or data.get("version") != TOKEN_FILE_VERSION:
            return {"state": "unlinked"}
        claims = _decode_claims(data["value"])
        if not isinstance(claims, dict):
            return {"state": "unlinked"}
        exp = float(data["expires_at"])
        if not math.isfinite(exp):
            return {"state": "unlinked"}
        expires_utc = datetime.fromtimestamp(exp, tz=timezone.utc).isoformat()
    except (OSError, KeyError, TypeError, ValueError, IndexError, AttributeError,
            OverflowError, binascii.Error):
        return {"state": "unlinked"}
    out = {
        "state": "expired" if exp <= time.time() else "linked",
        "expiresUtc": expires_utc,
    }
    if out["state"] == "expired":
        return out
    for key, claim in (("tier", _TIER_CLAIM), ("product", _PRODUCT_CLAIM)):
        val = claims.get(claim)
        if val:
            out[key] = str(val)
    return out


def publish_status_loop(r, interval_s=60):
    """SET f1auth:status now and every interval_s. Status only — never the token.

    Never lets an exception end the loop: this runs on a daemon thread, so an
    unhandled error would kill status publishing for the life of the process while
    the settings page went on serving whatever was written last, with nothing to
    explain it. A Redis blip should cost one tick, not the feature.
    """
    while True:
        try:
            r.set(AUTH_STATUS_KEY, json.dumps(auth_status(), separators=(",", ":")))
        except Exception:
            _log.warning("f1auth: status publish failed, retrying next tick", exc_info=True)
        time.sleep(interval_s)


def start_status_publisher(r, interval_s=60):
    """Run publish_status_loop on a daemon thread so ingest exits cleanly."""
    t = threading.Thread(target=publish_status_loop, args=(r, interval_s), daemon=True)
    t.start()
    return t
