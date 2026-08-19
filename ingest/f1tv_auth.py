"""F1TV auth status for the beta live path (ADR-0007).

Status only. This module NEVER handles credentials and never publishes the token —
the login and its verification belong to fastf1's `f1auth`. Here we read its cache
file and report unlinked / linked / expired for the settings page.

Deliberately stdlib-only (no fastf1, no platformdirs at import) so the CI contract
job can test it and the demo container can publish status without a heavy image.
The JWT claims are decoded WITHOUT signature verification — display only; fastf1
does the real verification when it connects.
"""
import base64
import binascii
import json
import os
import threading
import time
from datetime import datetime, timezone
from pathlib import Path

AUTH_STATUS_KEY = "f1auth:status"

# Claim names confirmed against fastf1 3.8.3's f1auth.print_auth_status().
_TIER_CLAIM = "SubscriptionStatus"
_PRODUCT_CLAIM = "SubscribedProduct"


def default_token_path():
    """Where fastf1 caches the F1TV token, or None if it cannot be located here.

    Container: XDG_DATA_HOME=/secrets → /secrets/fastf1/f1auth.json (compose mounts
    ./secrets read-only; we only ever read). Host: fastf1's platformdirs location.
    A demo container has neither, which simply reads as unlinked.
    """
    base = os.environ.get("XDG_DATA_HOME")
    if base:
        return Path(base) / "fastf1" / "f1auth.json"
    try:
        import platformdirs
    except ImportError:
        return None
    return Path(platformdirs.user_data_dir("fastf1")) / "f1auth.json"


def _decode_claims(jwt):
    payload = jwt.split(".")[1]
    payload += "=" * (-len(payload) % 4)
    return json.loads(base64.urlsafe_b64decode(payload))


def auth_status(token_path=None):
    """Report {'state': 'unlinked'|'linked'|'expired', 'expiresUtc'?, 'tier'?, 'product'?}.

    The cache file holds a RAW JWT string (not JSON), and an unlinked host still has a
    0-byte file because importing f1auth touches it — so empty means unlinked, and any
    unreadable/undecodable content degrades to unlinked rather than raising.
    """
    path = Path(token_path) if token_path else default_token_path()
    if path is None:
        return {"state": "unlinked"}
    try:
        token = path.read_text().strip()
        if not token:
            return {"state": "unlinked"}
        claims = _decode_claims(token)
        exp = int(claims["exp"])
    except (OSError, KeyError, TypeError, ValueError, IndexError, binascii.Error):
        return {"state": "unlinked"}
    out = {
        "state": "expired" if exp <= time.time() else "linked",
        "expiresUtc": datetime.fromtimestamp(exp, tz=timezone.utc).isoformat(),
    }
    if out["state"] == "expired":
        return out
    for key, claim in (("tier", _TIER_CLAIM), ("product", _PRODUCT_CLAIM)):
        val = claims.get(claim)
        if val:
            out[key] = str(val)
    return out


def publish_status_loop(r, interval_s=60):
    """SET f1auth:status now and every interval_s. Status only — never the token."""
    while True:
        r.set(AUTH_STATUS_KEY, json.dumps(auth_status(), separators=(",", ":")))
        time.sleep(interval_s)


def start_status_publisher(r, interval_s=60):
    """Run publish_status_loop on a daemon thread so ingest exits cleanly."""
    t = threading.Thread(target=publish_status_loop, args=(r, interval_s), daemon=True)
    t.start()
    return t
