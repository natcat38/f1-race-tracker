# Public-repo audit: f1-race-tracker (2026-10-22, closed 2026-11-09)

Source: the 2026-10-22 public-repo check of this repo, rechecked 2026-11-09. Owner decisions D2 and D5 were made 2026-11-09. Sits beside [ux-audit-2026-10.md](ux-audit-2026-10.md).

| ID | Finding | Outcome |
|----|---------|---------|
| P0-1 | `govulncheck` fails: `go.mod` pinned Go 1.27.1 (10 stdlib advisories) | Fixed earlier in PR #163 (go 1.27.3, Dockerfile `golang:1.27.3`, staticcheck v0.8.2, `npm audit fix`). |
| P1-1 | README gap-accuracy claim described a clip that was no longer shipped (#103) | Fixed earlier in PR #169 (clip re-baked, ingest/README table re-measured, README says "under 50 ms"). #103 closed 2026-11-02. |
| P1-2 | "Byte-identical JSON" across Python and Go was never tested | Owner decision D2 (test, then decide). Outcome B: the claim is false, so it was softened. See below. Fixed in this PR. |
| P2-1 | Benchmark is a stale single snapshot | Fixed in this PR: README now says it was measured 2026-06-22 on one laptop, before the PR #94 frame fields, and not re-measured. |
| P2-2 | ROADMAP mislabels #115 | Fixed earlier by the D1-D5 ROADMAP rewrite (PR #179, which closed #115 via ADR-0014). |
| P2-3 | Tech Scope said `go test -race` is not gated | Fixed in this PR: the sentence now says CI runs `go test -race` and `staticcheck`. |
| P2-4 | Agent files at the repo root | Owner decision D5: `memory/` deleted (and its link in CLAUDE.md and the FILE-MAP row removed); `reviews/` and `CLAUDE.md` kept. Fixed in this PR. |
| Issues | #123, #124, #115, #103 | All closed, by #178, #180, #179 and #169. |
| Dependabot | #156, #160, #161, #164 | #161 merged. #156, #160 and #164 closed as superseded. |
| okf pin | Validator pinned at `e136499 # v1` | Fixed in this PR: `okf.yml` now uses `natcat38/okf-portfolio-standard@a9d01a2b63545a4db537a1aaef0d05de1a0ea69a # v1.4.0`. `dependabot.yml` already had a weekly `github-actions` entry. |

## P1-2: the byte comparison

Run on 2026-11-09 with Python 3.11 (`json.dumps(..., separators=(",", ":"))`, as `ingest/live.py` writes) and Go 1.27 (`json.Marshal`, as `internal/bus/redis.go` writes) on the same values:

| Value | Python | Go |
|-------|--------|----|
| `"Pérez"` | `"P\u00e9rez"` | `"Pérez"` |
| `"<&>"` | `"<&>"` | `"\u003c\u0026\u003e"` |
| `1.0` | `1.0` | `1` |
| `0.00001` | `1e-05` | `0.00001` |
| `3e16` | `3e+16` | `30000000000000000` |

Non-ASCII and HTML characters could be aligned with one flag or a replace. The float formatting could not, without a hand-written number encoder in `ingest/live.py`. Whole-number floats are real: track coordinates normalised to 0..1 hit `0.0` and `1.0`. So the two writers produce different bytes for the same data, and a test asserting equality would fail or force a custom encoder for no user benefit: the gateway parses JSON, so both forms decode to the same values.

Decision: soften the claim, and keep no new test harness. The schema is still enforced by `ingest/check_live_contract.py` (key sets pinned to the Go struct tags) and `internal/model/contract_test.go` (golden snapshot). Wording changed in README.md (three places), `web/src/components/HowItRuns.tsx`, `docs/F1_Race_Tracker_Tech_Scope.md`, and a dated note in ADR-0002.
