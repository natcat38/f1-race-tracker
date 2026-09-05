---
name: f1-tracker-direction
description: "F1 Race Tracker current state (2026-09-06): Phases 1-5 + WS5 (F1TV live beta) shipped, PR #94 peer-comparison features merged, ROADMAP.md landing via open PR #96, stage Review"
metadata: 
  node_type: memory
  type: project
  originSessionId: b1e490a6-d5ad-420a-9780-b925bd1e9764
  modified: 2026-09-06T00:00:00.000Z
---

**Current state (2026-09-06):** Architecture unchanged since Phase 5 — Python FastF1 → Redis
seam → Go gateway → React; no-hosting, docker-compose demo; portfolio piece. Phases 1-5
(track map, timing tower, telemetry + two-car compare, team-radio comms, race control,
weather, stint timeline, #compare, #ghost) and WS5 (F1TV-gated live-timing beta: `f1tv_auth`/
`f1tv_link`, `#settings`, live TeamRadio on frames) are shipped on `main`. ADR-0001 through
ADR-0009 all exist in `docs/adr/` (0007 F1TV auth, 0008 live radio on frames, 0009 overlay
absorbs compare). PR #94 shipped all 6 features from `reviews/plans/features-to-add.md`
(pedal/gear traces, pit-stop durations, static-replay pause/scrub, corner numbers +
start/finish line, sector-dominance heatmap, README simulated-live paragraph) — that plan
file's items are all done, don't restart from it. `ROADMAP.md` (house six-stage lifecycle,
retro-filled) is on **open PR #96**, not yet merged to main; it records **Current stage:
Review**, next up a 2026-09-06 full-repo re-review. Only real-race-weekend verification of
the live F1TV stream remains outstanding from WS5.

**History (most recent first):**
- 2026-09-06 — PR #96 opened: adds retro-filled `ROADMAP.md`; stage set to Review; full-repo re-review planned (see [[f1-repo-review-2026-09-06]]).
- 2026-09-02 — PR #94 merged: all 6 peer-comparison features (see current-state above); static Pages demo re-baked for the new clip-header fields; CI gotcha — contract job is pandas/fastf1-free, new pandas-touching tests need `pytest.importorskip`.
- 2026-08-29 — Survey findings distilled into `reviews/plans/features-to-add.md` (source of PR #94) and `reviews/plans/verified-cleanup-backlog.md`; PR #89 portable-memory merged.
- 2026-08-28 — signalrcore blocker resolved (`requirements-live-nodeps.txt` pins `signalrcore==1.0.2` installed `--no-deps`, patched msgpack applied at runtime; documented in ADR-0007); WS5 merged to main.
- 2026-08-23 — Overlay/compare fold (#83, ADR-0009), rail instrument-cluster restructure (#84), comms/gap toggles onto SegmentedControl (#85), README reshoot (#86), static-demo pacer resync fix (#87).
- 2026-08-20 — WS5 built and F1TV link flow verified live with a free F1 account (login not tier-gated); dependency conflict between `signalrcore==0.8.8` (patched msgpack) and `1.0.2` (working websocket callbacks) identified as the one remaining blocker — resolved 2026-08-28 above.
- 2026-08-19 — Phases 1-5 all shipped; polish-and-immersion roadmap adopted (WS1-WS6), execution model: Opus orchestrates, Sonnet subagents execute.

**Durable data facts:** FastF1's `f1auth` + f1login.fastf1.dev browser extension is the only
viable F1 login path (reuse, never rebuild; `no_auth=True` is broken in fastf1 3.8.3);
historical team-radio mp3s are still auth-free via livetiming.formula1.com/static/; OpenF1's
free tier is historical-only (live = paid); no public ERS/fuel data exists anywhere; whether a
*live* session's stream is tier-gated is still untested (needs a real race weekend).

**Next direction:** Follow `ROADMAP.md`'s stage list once PR #96 merges — repo is at **Review**.
Next unchecked item there is the 2026-09-06 full-repo re-review (architecture, security,
code-review of #94, UI guidelines + accessibility on #94's new components, testing strategy,
docs/repo-review — see [[f1-repo-review-2026-09-06]] for where those reports live), then file
survivors as GitHub issues. After Review closes, the roadmap's open Ship-stage items are API
docs/Swagger and a final `/repo-review` pass; Plan-stage still lacks a written
`docs/Design_Direction.md`. Prefer plain English per [[plain-english-preference]]; build
gotchas in [[f1-build-gotchas]].
