"""Sign in to F1 for the beta live path (ADR-0007).

HOST-ONLY. fastf1's login server binds a random port on 127.0.0.1 and the f1login
browser extension POSTs to it, which a container cannot receive — so signing in is a
host command, and the resulting token is copied into ./secrets/ for the compose
mount. Nothing here is ever asked for or stored by this project: fastf1 owns the
login, the cache, and the verification.

    python ingest/f1tv_link.py              # sign in (prints a URL to open)
    python ingest/f1tv_link.py --status     # are we signed in, and until when
    python ingest/f1tv_link.py --unlink     # forget the sign-in, here and in ./secrets
"""
import argparse
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path

from f1tv_auth import auth_status, default_token_path

SECRETS_COPY = Path(__file__).resolve().parent.parent / "secrets" / "fastf1" / "f1auth.json"
EXTENSION_URL = "https://f1login.fastf1.dev"
ACCOUNT_URL = "https://account.formula1.com"
SETTINGS_URL = "http://localhost:8080/#settings"


def _expires_in(expires_utc, now=None):
    """'in 3 days' / 'in 5 hours' — a bare timestamp does not say whether to act.

    `now` is injectable so this is testable without racing the clock: reading the
    clock internally made "3 days from now" round down to "in 2 days" by the
    microseconds spent between building the input and comparing against it.
    Mirrors relativeExpiry() in web/src/state/f1auth.ts.
    """
    if not expires_utc:
        return None
    try:
        left = datetime.fromisoformat(expires_utc) - (now or datetime.now(timezone.utc))
    except (ValueError, TypeError):
        return None
    secs = left.total_seconds()
    if secs <= 0:
        return "expired"
    if secs < 3600:
        return f"in {int(secs // 60)} min"
    if secs < 48 * 3600:
        return f"in {int(secs // 3600)} hours"
    return f"in {int(secs // 86400)} days"


def print_status(status):
    """Report the state as a sentence, then the one command that acts on it."""
    state = status["state"]
    if state != "linked":
        what = "has lapsed" if state == "expired" else "is not set up"
        print(f"Sign-in {what}.")
        print("Run this command with no arguments to sign in.")
        return

    tier = status.get("tier", "unknown")
    product = f" ({status['product']})" if status.get("product") else ""
    print(f"Signed in. Subscription: {tier}{product}")
    print(f"Lapses {_expires_in(status.get('expiresUtc')) or 'in a few days'} "
          f"({status.get('expiresUtc', '?')}).")
    if tier != "active":
        print()
        print("Heads up: this account has no active F1 TV subscription, so the live")
        print("timing feed will stay empty. Signing in still works - the data just does")
        print("not flow without F1 TV Access or better.")
    print()
    print("When it lapses, run this command again.")


def do_link():
    print("Signing in to your F1 account for the beta live path.")
    print()
    print("Before the URL appears, make sure you have:")
    print(f"  1. A free F1 account       {ACCOUNT_URL}")
    print(f"  2. The f1login extension   {EXTENSION_URL}")
    print("     (FastF1's own extension - it is what hands the sign-in to this machine)")
    print()
    print("A URL will print below. Open it in the browser that has the extension.")
    print("You will also see a line saying an active F1TV subscription is required -")
    print("that is expected, not a rejection. A free account signs in fine.")
    print()
    sys.stdout.flush()

    # Imported here, not at module level: only signing in needs fastf1.
    from fastf1.internals.f1auth import get_auth_token

    if not get_auth_token():
        print("\nSign-in failed - no token was returned.", file=sys.stderr)
        print("Most likely the f1login extension is not installed, or the URL was opened",
              file=sys.stderr)
        print(f"in a browser without it. Install from {EXTENSION_URL} and try again.",
              file=sys.stderr)
        sys.exit(1)

    src = default_token_path()
    SECRETS_COPY.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src, SECRETS_COPY)
    print(f"\nDone. Cached by fastf1 at {src}")
    print(f"Copied to {SECRETS_COPY} so docker can read it (git-ignored).")
    print()
    print_status(auth_status())
    print()
    print(f"See it in the app at {SETTINGS_URL}")


def main():
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--status", action="store_true",
                    help="show whether you are signed in, and until when")
    ap.add_argument("--unlink", action="store_true",
                    help="forget the sign-in, here and in ./secrets")
    args = ap.parse_args()

    if args.status:
        print_status(auth_status())
    elif args.unlink:
        from fastf1.internals.f1auth import clear_auth_token
        clear_auth_token()
        SECRETS_COPY.unlink(missing_ok=True)
        print("Signed out. The cached sign-in and the docker copy are both gone.")
    else:
        do_link()


if __name__ == "__main__":
    main()
