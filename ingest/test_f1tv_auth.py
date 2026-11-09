"""Self-check for ingest/f1tv_auth.auth_status (no fastf1/network needed).

The token file fastf1 3.9 writes (f1account/tokens.py, TokenManager.store) is JSON:
{"version": 1, "value": "<subscription JWT>", "expires_at": <epoch seconds>} in
f1auth_token.json. fastf1 3.8 wrote a raw JWT to f1auth.json; that format is gone, so
a leftover raw-JWT file must read as unlinked, not crash. Every case below builds its
file under pytest's tmp_path: no network, no real token, no fastf1 import.
"""
import base64
import json
import time

from f1tv_auth import TOKEN_FILENAME, auth_status, default_token_path
from f1tv_link import _expires_in, print_status


def _fake_jwt(claims):
    def b64(d):
        return base64.urlsafe_b64encode(json.dumps(d).encode()).rstrip(b"=").decode()
    return f"{b64({'alg': 'RS256'})}.{b64(claims)}.sig"


def _write_token(path, claims, expires_at=None, fields=None):
    """Write a token file in fastf1 3.9's layout. `fields` replaces/adds raw JSON fields."""
    exp = claims.get("exp", time.time() + 3600) if expires_at is None else expires_at
    data = {"version": 1, "value": _fake_jwt({"exp": exp, **claims}), "expires_at": exp}
    data.update(fields or {})
    path.write_text(json.dumps(data))
    return path


def test_unlinked_when_file_missing(tmp_path):
    assert auth_status(tmp_path / TOKEN_FILENAME) == {"state": "unlinked"}


def test_unlinked_when_file_empty(tmp_path):
    p = tmp_path / TOKEN_FILENAME
    p.write_text("")
    assert auth_status(p) == {"state": "unlinked"}


def test_linked_with_expiry_and_tier(tmp_path):
    exp = int(time.time()) + 3600
    p = _write_token(tmp_path / TOKEN_FILENAME, {
        "exp": exp,
        "SubscriptionStatus": "active",
        "SubscribedProduct": "F1 TV Premium",
    })
    st = auth_status(p)
    assert st["state"] == "linked", st
    assert st["expiresUtc"].endswith("+00:00"), st
    assert st["expiresUtc"].startswith(
        time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(exp))), st
    assert st["tier"] == "active", st
    assert st["product"] == "F1 TV Premium", st


def test_linked_without_subscription_claims_has_no_tier(tmp_path):
    st = auth_status(_write_token(tmp_path / TOKEN_FILENAME, {"exp": int(time.time()) + 60}))
    assert st["state"] == "linked", st
    assert "tier" not in st and "product" not in st, st


def test_expiry_comes_from_the_file_not_the_jwt_claim(tmp_path):
    # fastf1 decides validity from `expires_at`, so the status must agree with it.
    p = _write_token(tmp_path / TOKEN_FILENAME, {"exp": int(time.time()) + 3600},
                     expires_at=int(time.time()) - 10)
    assert auth_status(p)["state"] == "expired"


def test_expired_token(tmp_path):
    p = _write_token(tmp_path / TOKEN_FILENAME,
                     {"exp": int(time.time()) - 10, "SubscriptionStatus": "active"})
    st = auth_status(p)
    assert st["state"] == "expired", st
    assert "expiresUtc" in st, st
    assert "tier" not in st, st


def test_fractional_expiry_is_accepted(tmp_path):
    # fastf1 stores expires_at as a float (SubscriptionToken.expires_at: float).
    p = _write_token(tmp_path / TOKEN_FILENAME, {}, expires_at=time.time() + 3600.5)
    assert auth_status(p)["state"] == "linked"


def test_malformed_json_is_unlinked(tmp_path):
    p = tmp_path / TOKEN_FILENAME
    p.write_text('{"version": 1, "value": ')
    assert auth_status(p) == {"state": "unlinked"}


def test_non_object_json_is_unlinked(tmp_path):
    p = tmp_path / TOKEN_FILENAME
    for body in ("[]", "null", '"a-string"', "42"):
        p.write_text(body)
        assert auth_status(p) == {"state": "unlinked"}, body


def test_legacy_raw_jwt_file_is_unlinked(tmp_path):
    # What fastf1 3.8 wrote. A host upgraded in place may still have one.
    p = tmp_path / TOKEN_FILENAME
    p.write_text(_fake_jwt({"exp": int(time.time()) + 3600}))
    assert auth_status(p) == {"state": "unlinked"}


def test_unknown_version_is_unlinked(tmp_path):
    # fastf1 itself discards a file whose version it does not know (get_stored).
    p = _write_token(tmp_path / TOKEN_FILENAME, {}, fields={"version": 2})
    assert auth_status(p) == {"state": "unlinked"}
    p = _write_token(tmp_path / TOKEN_FILENAME, {})
    data = json.loads(p.read_text())
    del data["version"]
    p.write_text(json.dumps(data))
    assert auth_status(p) == {"state": "unlinked"}


def test_missing_fields_are_unlinked(tmp_path):
    p = tmp_path / TOKEN_FILENAME
    for drop in ("value", "expires_at"):
        _write_token(p, {})
        data = json.loads(p.read_text())
        del data[drop]
        p.write_text(json.dumps(data))
        assert auth_status(p) == {"state": "unlinked"}, drop


def test_bad_field_types_are_unlinked(tmp_path):
    p = tmp_path / TOKEN_FILENAME
    for overrides in ({"value": "not-a-jwt"},
                      {"value": None},
                      {"value": 123},
                      {"value": "a.!!!.c"},
                      {"expires_at": "soon"},
                      {"expires_at": None},
                      {"expires_at": 1e400},       # parses to inf
                      {"expires_at": 1e300}):      # finite but beyond datetime's range
        _write_token(p, {}, fields=overrides)
        assert auth_status(p) == {"state": "unlinked"}, overrides
    p.write_text('{"version": 1, "value": "x.eyJleHAiOjF9.y", "expires_at": NaN}')
    assert auth_status(p) == {"state": "unlinked"}


def test_non_object_jwt_claims_are_unlinked(tmp_path):
    p = _write_token(tmp_path / TOKEN_FILENAME, {})
    data = json.loads(p.read_text())
    payload = base64.urlsafe_b64encode(b"[1, 2]").rstrip(b"=").decode()
    data["value"] = f"h.{payload}.s"
    p.write_text(json.dumps(data))
    assert auth_status(p) == {"state": "unlinked"}


def test_unreadable_path_is_unlinked(tmp_path):
    # A directory where the file should be raises OSError on read.
    p = tmp_path / TOKEN_FILENAME
    p.mkdir()
    assert auth_status(p) == {"state": "unlinked"}


def test_status_never_leaks_the_token(tmp_path):
    # The seam carries status only, never the credential (ADR-0007).
    p = _write_token(tmp_path / TOKEN_FILENAME, {"exp": int(time.time()) + 60})
    token = json.loads(p.read_text())["value"]
    blob = json.dumps(auth_status(p))
    assert token not in blob and token.split(".")[1] not in blob, blob


def test_default_token_path_follows_xdg_data_home(monkeypatch, tmp_path):
    # Container layout: XDG_DATA_HOME=/secrets -> /secrets/fastf1/f1auth_token.json.
    monkeypatch.setenv("XDG_DATA_HOME", str(tmp_path))
    assert default_token_path() == tmp_path / "fastf1" / "f1auth_token.json"
    p = tmp_path / "fastf1" / TOKEN_FILENAME
    p.parent.mkdir()
    _write_token(p, {"exp": int(time.time()) + 60})
    assert auth_status()["state"] == "linked"


def test_expires_in_picks_a_useful_unit():
    """Fixed `now`, so the assertions cannot race the clock (this test used to)."""
    from datetime import datetime, timedelta, timezone
    now = datetime(2026, 8, 20, 0, 0, 0, tzinfo=timezone.utc)

    def at(delta):
        return _expires_in((now + delta).isoformat(), now=now)

    assert at(timedelta(days=3)) == "in 3 days", at(timedelta(days=3))
    assert at(timedelta(hours=5)) == "in 5 hours", at(timedelta(hours=5))
    assert at(timedelta(minutes=30)) == "in 30 min", at(timedelta(minutes=30))
    assert at(timedelta(seconds=-10)) == "expired"
    assert _expires_in(None) is None
    assert _expires_in("not a date") is None
    # Exactly on a day boundary must not round down a moment early.
    assert at(timedelta(days=2)) == "in 2 days", at(timedelta(days=2))


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


# --- f1tv_link against a stubbed fastf1 3.9 f1account (no fastf1, no network) -------

class _FakeF1AuthError(Exception):
    pass


def _stub_fastf1(monkeypatch, get_token, clear_token=None):
    """Install fake `fastf1.exceptions` / `fastf1.internals.f1account` modules."""
    import sys
    import types

    exceptions = types.ModuleType("fastf1.exceptions")
    exceptions.F1AuthError = _FakeF1AuthError
    f1account = types.ModuleType("fastf1.internals.f1account")
    f1account.get_token = get_token
    f1account.clear_token = clear_token or (lambda: None)
    for name, mod in (("fastf1", types.ModuleType("fastf1")),
                      ("fastf1.exceptions", exceptions),
                      ("fastf1.internals", types.ModuleType("fastf1.internals")),
                      ("fastf1.internals.f1account", f1account)):
        monkeypatch.setitem(sys.modules, name, mod)


def test_link_signs_in_with_the_browser_method_and_copies_the_token(
        monkeypatch, tmp_path, capsys):
    import f1tv_link

    # The container-style layout, so the real default_token_path() finds the cache.
    monkeypatch.setenv("XDG_DATA_HOME", str(tmp_path / "xdg"))
    cache = tmp_path / "xdg" / "fastf1" / TOKEN_FILENAME
    cache.parent.mkdir(parents=True)
    _write_token(cache, {"exp": int(time.time()) + 3600, "SubscriptionStatus": "active"})
    calls = []

    def fake_get_token(force_renew=False, method=None):
        calls.append(method)
        return object()

    _stub_fastf1(monkeypatch, fake_get_token)
    monkeypatch.setattr(f1tv_link, "SECRETS_COPY", tmp_path / "secrets" / TOKEN_FILENAME)

    f1tv_link.do_link()

    assert calls == ["browser"], calls  # never the credential-prompting "password" method
    assert (tmp_path / "secrets" / TOKEN_FILENAME).read_text() == cache.read_text()
    assert "Signed in" in capsys.readouterr().out


def test_link_reports_a_fastf1_auth_error_and_exits_nonzero(monkeypatch, tmp_path, capsys):
    import pytest

    import f1tv_link

    def fake_get_token(force_renew=False, method=None):
        raise _FakeF1AuthError("Sign-in returned no subscription token.")

    _stub_fastf1(monkeypatch, fake_get_token)
    monkeypatch.setattr(f1tv_link, "SECRETS_COPY", tmp_path / "secrets" / TOKEN_FILENAME)

    with pytest.raises(SystemExit) as exc:
        f1tv_link.do_link()

    assert exc.value.code == 1
    assert "no subscription token" in capsys.readouterr().err
    assert not (tmp_path / "secrets").exists()


def test_unlink_clears_fastf1_and_both_secrets_copies(monkeypatch, tmp_path, capsys):
    import sys

    import f1tv_link

    cleared = []
    _stub_fastf1(monkeypatch, lambda **_: None, clear_token=lambda: cleared.append(True))
    secrets = tmp_path / "secrets"
    secrets.mkdir()
    new_copy, legacy_copy = secrets / TOKEN_FILENAME, secrets / "f1auth.json"
    new_copy.write_text("{}")
    legacy_copy.write_text("raw.jwt.here")
    monkeypatch.setattr(f1tv_link, "SECRETS_COPY", new_copy)
    monkeypatch.setattr(f1tv_link, "LEGACY_SECRETS_COPY", legacy_copy)
    monkeypatch.setattr(sys, "argv", ["f1tv_link.py", "--unlink"])

    f1tv_link.main()

    assert cleared == [True]
    assert not new_copy.exists() and not legacy_copy.exists()
    assert "Signed out" in capsys.readouterr().out
