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
from f1tv_link import _expires_in, print_status


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


def test_expires_in_picks_a_useful_unit():
    from datetime import datetime, timedelta, timezone
    def at(delta):
        return _expires_in((datetime.now(timezone.utc) + delta).isoformat())
    assert at(timedelta(days=3)) == "in 3 days", at(timedelta(days=3))
    assert at(timedelta(hours=5)) == "in 4 hours" or at(timedelta(hours=5)) == "in 5 hours"
    assert at(timedelta(minutes=30)).endswith("min"), at(timedelta(minutes=30))
    assert at(timedelta(seconds=-10)) == "expired"
    assert _expires_in(None) is None
    assert _expires_in("not a date") is None


def test_print_status_is_ascii_only():
    """Windows consoles are cp1252 - a stray em-dash prints as '?' to the operator."""
    import io
    import contextlib
    for status in ({"state": "unlinked"},
                   {"state": "expired"},
                   {"state": "linked", "expiresUtc": "2099-01-01T00:00:00+00:00", "tier": "inactive"},
                   {"state": "linked", "expiresUtc": "2099-01-01T00:00:00+00:00", "tier": "active",
                    "product": "F1 TV Premium"}):
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            print_status(status)
        text = buf.getvalue()
        assert text.strip(), status
        non_ascii = [c for c in text if ord(c) > 127]
        assert not non_ascii, f"non-ascii {non_ascii!r} for {status}"
    # An inactive subscription must be called out - it is why the stream stays empty.
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        print_status({"state": "linked", "expiresUtc": "2099-01-01T00:00:00+00:00", "tier": "inactive"})
    assert "no active F1 TV subscription" in buf.getvalue()


def test_publish_loop_survives_a_redis_error():
    """A daemon thread that dies on one blip stops publishing status forever."""
    import f1tv_auth

    class FlakyRedis:
        def __init__(self):
            self.calls = 0

        def set(self, key, value):
            self.calls += 1
            if self.calls == 1:
                raise ConnectionError("redis went away")

    r = FlakyRedis()
    slept = []
    real_sleep = f1tv_auth.time.sleep

    def fake_sleep(_s):
        slept.append(_s)
        if len(slept) >= 3:
            raise KeyboardInterrupt  # break out of the infinite loop

    f1tv_auth.time.sleep = fake_sleep
    try:
        f1tv_auth.publish_status_loop(r, interval_s=0)
    except KeyboardInterrupt:
        pass
    finally:
        f1tv_auth.time.sleep = real_sleep

    assert r.calls >= 3, f"loop stopped after the error: {r.calls} calls"


if __name__ == "__main__":
    test_unlinked_when_file_missing()
    test_unlinked_when_file_empty()
    test_linked_with_expiry_and_tier()
    test_expired_token()
    test_corrupt_file_is_unlinked()
    test_status_never_leaks_the_token()
    test_expires_in_picks_a_useful_unit()
    test_print_status_is_ascii_only()
    test_publish_loop_survives_a_redis_error()
    print("f1tv_auth.auth_status self-check PASSED")
    sys.exit(0)
