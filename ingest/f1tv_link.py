"""Link the operator's F1 account for the beta live path (ADR-0007).

HOST-ONLY. fastf1's login server binds a random port on 127.0.0.1 and the f1login
browser extension POSTs to it, which a container cannot receive — so linking is a
host command, and the resulting token is copied into ./secrets/ for the compose
mount. Nothing here is ever asked for or stored by this project: fastf1 owns the
login, the cache, and the verification.

    python ingest/f1tv_link.py              # link (prints a URL to open)
    python ingest/f1tv_link.py --status     # show linked / expired / unlinked
    python ingest/f1tv_link.py --unlink     # forget the token, here and in ./secrets
"""
import argparse
import shutil
import sys
from pathlib import Path

from f1tv_auth import auth_status, default_token_path

SECRETS_COPY = Path(__file__).resolve().parent.parent / "secrets" / "fastf1" / "f1auth.json"


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--status", action="store_true", help="print the current link status")
    ap.add_argument("--unlink", action="store_true", help="clear the cached token")
    args = ap.parse_args()

    if args.status:
        print(auth_status())
        return

    if args.unlink:
        from fastf1.internals.f1auth import clear_auth_token
        clear_auth_token()
        SECRETS_COPY.unlink(missing_ok=True)
        print("unlinked")
        return

    # Imported here, not at module level: only the link dance needs fastf1.
    from fastf1.internals.f1auth import get_auth_token
    print("Linking your F1 account — a URL will be printed below; open it in your browser.")
    print("You need the f1login extension from https://f1login.fastf1.dev installed.", flush=True)
    if not get_auth_token():
        print("Link failed — no token acquired.", file=sys.stderr)
        sys.exit(1)

    src = default_token_path()
    SECRETS_COPY.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src, SECRETS_COPY)
    print(f"Linked. fastf1 cached the token at {src}")
    print(f"Copied to {SECRETS_COPY} for the docker mount (git-ignored).")
    print("Status:", auth_status())


if __name__ == "__main__":
    main()
