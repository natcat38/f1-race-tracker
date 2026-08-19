"""Self-check for ingest/f1tv_auth.auth_status (no fastf1/network needed).

The cache file fastf1 writes is a RAW JWT string, not JSON, and an unlinked host
still has a 0-byte file (f1auth touches it at import) — both confirmed by the spike,
docs/superpowers/specs/2026-08-20-f1auth-spike-findings.md.
"""
import base64
import json
import sys
import tempfile
import time
from pathlib import Path

from f1tv_auth import auth_status


def _fake_jwt(claims):
    def b64(d):
        return base64.urlsafe_b64encode(json.dumps(d).encode()).rstrip(b"=").decode()
    return f"{b64({'alg': 'RS256'})}.{b64(claims)}.sig"


def test_unlinked_when_file_missing():
    with tempfile.TemporaryDirectory() as d:
        assert auth_status(Path(d) / "nope.json") == {"state": "unlinked"}


def test_unlinked_when_file_empty():
    # f1auth touches the cache file at import, so "unlinked" is a 0-byte file.
    with tempfile.TemporaryDirectory() as d:
        p = Path(d) / "f1auth.json"
        p.write_text("")
        assert auth_status(p) == {"state": "unlinked"}


def test_linked_with_expiry_and_tier():
    with tempfile.TemporaryDirectory() as d:
        p = Path(d) / "f1auth.json"
        p.write_text(_fake_jwt({
            "exp": int(time.time()) + 3600,
            "SubscriptionStatus": "active",
            "SubscribedProduct": "F1 TV Premium",
        }))
        st = auth_status(p)
        assert st["state"] == "linked", st
        assert st["expiresUtc"].endswith("+00:00"), st
        assert st["tier"] == "active", st
        assert st["product"] == "F1 TV Premium", st


def test_expired_token():
    with tempfile.TemporaryDirectory() as d:
        p = Path(d) / "f1auth.json"
        p.write_text(_fake_jwt({"exp": int(time.time()) - 10}))
        st = auth_status(p)
        assert st["state"] == "expired", st
        assert "tier" not in st, st


def test_corrupt_file_is_unlinked():
    with tempfile.TemporaryDirectory() as d:
        p = Path(d) / "f1auth.json"
        p.write_text("not-a-jwt")
        assert auth_status(p)["state"] == "unlinked"


def test_status_never_leaks_the_token():
    # The seam carries status only, never the credential (ADR-0007).
    with tempfile.TemporaryDirectory() as d:
        p = Path(d) / "f1auth.json"
        token = _fake_jwt({"exp": int(time.time()) + 60})
        p.write_text(token)
        blob = json.dumps(auth_status(p))
        assert token not in blob and token.split(".")[1] not in blob, blob


if __name__ == "__main__":
    test_unlinked_when_file_missing()
    test_unlinked_when_file_empty()
    test_linked_with_expiry_and_tier()
    test_expired_token()
    test_corrupt_file_is_unlinked()
    test_status_never_leaks_the_token()
    print("f1tv_auth.auth_status self-check PASSED")
    sys.exit(0)
