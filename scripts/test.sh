#!/usr/bin/env bash
# scripts/test.sh — run every test suite in the repo. Exits non-zero on first failure.
# Requires: Go toolchain; web deps (`npm ci` in web/); and the shared .venv with
# ingest/requirements-dev.txt (pytest + redis) and bench/requirements.txt installed.
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
py="$root/.venv/Scripts/python.exe"; [ -x "$py" ] || py="$root/.venv/bin/python"

echo "== Go: go test ./... =="
(cd "$root" && go test ./...)

echo "== Web: npm test =="
(cd "$root/web" && npm test)

echo "== Python: pytest ingest =="
"$py" -m pytest "$root/ingest"

echo "== Python: pytest bench =="
"$py" -m pytest "$root/bench"

echo "All test suites passed."
