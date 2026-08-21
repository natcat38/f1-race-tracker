# Run every test suite in the repo, in the order CI does. Exits non-zero on first failure.
# Requires: Go toolchain; web deps (`npm ci` in web/); and the shared .venv with
# ingest/requirements-dev.txt (pytest + redis) and bench/requirements.txt installed.
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$py = Join-Path $root ".venv\Scripts\python.exe"

Write-Host "== Go: go test ./... ==" -ForegroundColor Cyan
Push-Location $root
try { go test ./...; if ($LASTEXITCODE -ne 0) { throw "go test failed" } } finally { Pop-Location }

Write-Host "== Web: npm test ==" -ForegroundColor Cyan
Push-Location (Join-Path $root "web")
try { npm test; if ($LASTEXITCODE -ne 0) { throw "npm test failed" } } finally { Pop-Location }

Write-Host "== Python: pytest scripts ==" -ForegroundColor Cyan
& $py -m pytest (Join-Path $root "scripts")
if ($LASTEXITCODE -ne 0) { throw "pytest scripts failed" }

Write-Host "== Python: pytest ingest ==" -ForegroundColor Cyan
& $py -m pytest (Join-Path $root "ingest")
if ($LASTEXITCODE -ne 0) { throw "pytest ingest failed" }

Write-Host "== Python: pytest bench ==" -ForegroundColor Cyan
& $py -m pytest (Join-Path $root "bench")
if ($LASTEXITCODE -ne 0) { throw "pytest bench failed" }

Write-Host "All test suites passed." -ForegroundColor Green
