<!-- ADR-0012: the 2026-11-02 open-items sweep: what blocked the dependency scan, and why three dependabot PRs and issue #103 were closed. -->

# 0012 — Open-items sweep, 2026-11-02: scan fix and dependency dispositions

**Status:** Accepted

## Context

On 2026-11-02 the required "Dependency vulnerability scan" check failed on every
open PR, including the docs-only #173. The job runs govulncheck, then
`npm audit --audit-level=high`, then `pip-audit`, and stops at the first failure,
so one advisory hid the next:

1. `web/`: undici 8.0.0–8.12.1 (GHSA-4qv8-2p9j-2685 and three more) and zod below
   4.6.6 (GHSA-mrhx-c7xc-m3w5), both high.
2. `ingest/`: GHSA-j586-36cw-2gc2 on msgpack below 1.2.3. It hit the real floor
   (`>=1.2.1`) and signalrcore's declared-but-never-installed `msgpack==1.1.2`.

Six dependabot PRs and four issues were open at the same time.

## Decision

- **Scan fix (#174).** `npm audit fix` without `--force` (lockfile only). The msgpack
  floor rises to `>=1.2.3`. The `--no-deps` audit ignores the new ID next to
  PYSEC-2026-3625, under ADR-0007's ghost-pin rule (see ADR-0007's 2026-11-02
  update). The moderate minimatch findings via eslint need a breaking `--force` and
  stay below the gate.
- **#156 (msgpack `>=1.2.3`) closed as superseded** by #174, which carries the same line.
- **#171 (Python 3.15 in `ingest/Dockerfile.live`) closed.** `ingest/requirements.txt`
  requires `ci.yml`, `Dockerfile.live` and `pyproject.toml` to move together. One of
  three would ship a container on a Python that CI never tests. A 3.15 move is one
  coordinated PR, once fastf1, numpy and signalrcore are confirmed on 3.15.
- **#170 (fastf1 3.9.0, numpy 2.5.4, pytest 9.2.0) closed.** fastf1 3.9.0 deletes
  `fastf1.internals.f1auth`, imported lazily at `ingest/f1tv_link.py:89`. It also moves
  the token from a raw JWT in `f1auth.json` to JSON in `f1auth_token.json`, which
  `ingest/f1tv_auth.py` reads. CI stays green because nothing imports that path at
  test time. The way forward (stay on 3.8.3, port to `f1account`, or drop the live
  link) is an owner decision and is not made here.
- **#103 closed.** `check_gap_estimator.py` passes on the clip re-baked in #169:
  Monza 2024 `intMs` p95 is 127 ms against the 600 ms gate, down from 87,450 ms.
  The other two clips pass too.

## Consequences

- Until the fastf1 3.9 decision is made, each weekly pip group will propose fastf1
  3.9 again. Close it each time, or add a dependabot ignore if the decision is to stay.
- Local venvs still hold msgpack 1.2.1 until `pip install -r ingest/requirements.txt`
  is re-run.
- #103's root-cause hypothesis (opening-lap instability in `ingest/geometry.py`) was
  never confirmed or ruled out. The gate is the guard: any future re-bake that
  includes laps 1–3 must pass it.
