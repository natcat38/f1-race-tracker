# Roadmap — f1-race-tracker

**Current stage: Review**
**Next up:** owner decisions on #115 (ADR-0010 accept/reject), #124 (screenshot reshoot), #123 (70 MB clips policy); #103 needs-info on the gap-estimator gate; then start the next feature cycle (WS3 server-paced scrub) from Define.

Lifecycle: Define → Plan → Build → Verify → Review → Ship.
Agents: read this file at session start, state the current stage and next unchecked item before any other work, and update this file (checkboxes + Current stage + Next up) before ending. Product and design decisions belong to the user — elicit them with questions, never decide for them.

> Retro-filled 2026-09-06: this repo predates the house roadmap. Boxes below are ticked only where the artifact verifiably exists in the repo (scope docs, ADRs, CI, README, Pages demo); unticked items are genuinely open.

## 1 · Define — why this exists (before any code)

- [x] One paragraph: who is this for, what pain does it remove? If the honest answer is "my resume", still pick a fictional real user — it forces every later decision. (`docs/F1_Race_Tracker_Product_Scope.md`)
- [x] One sentence: what does this repo prove to a recruiter (stack keywords + one differentiator)? (README "why I built this")
- [x] Name the cut line: the smallest version that is complete and presentable. (Phases 1–5 shipped)
- [x] `docs/Product_Scope.md`: background & problem · proposed solution (behaviour, not tech) · hard rules/validation with exact UI copy · decision matrix for any state machine · explicit out-of-scope list · phases with the cut line marked. (`docs/F1_Race_Tracker_Product_Scope.md`)

Exit: user has signed off the product scope. Skills: superpowers:brainstorming, grill-with-docs, feature-scope-docs.

## 2 · Plan — how it gets built

- [x] `docs/Tech_Scope.md`: stack with versions · data model sketch · core logic/formulae with a worked example · numbered tasks in vertical slices (each ends runnable + committed) · ⚠️ gotchas · test strategy per slice. (`docs/F1_Race_Tracker_Tech_Scope.md`)
- [x] One ADR in `docs/adr/` per non-obvious decision, written when the decision is made, not after. (ADR-0001…0009)
- [ ] `docs/Design_Direction.md` (any project with a UI): ground it in the subject's own world. Tokens: 4–6 named colors, 2–3 typefaces with roles, layout concept. One signature element; restraint everywhere else. Explicit loading/empty/error states with copy. Quality floor: focus visible, contrast, reduced motion, responsive to 375px. Self-check: "what would the generic default be, and where did I deviate?" (tokens live in `web/src/styles/tokens.css`; no written direction doc yet)

Exit: numbered vertical slices exist and the user approves. Skills: superpowers:writing-plans, to-issues, hallmark (design direction).

## 3 · Build — the only stage where feature code happens

- [x] Day-1 hygiene, before feature work: sensible `.gitignore` · README stub with the purpose paragraph · OKF knowledge bundle + validator (local + CI) · CI running the test command (even if 0 tests yet) · /protect-repo once pushed public · Docker/compose for backing services · config via env vars from the start.
- [x] Vertical slices from the Tech Scope, in order. Every slice: implement → test → commit with a message that names the slice. No slice starts while the previous one is red.

Exit: all slices to the cut line done, CI green. Skills: tdd, ponytail.

## 4 · Verify — does the real thing work

- [x] Run the actual app end-to-end (not just tests): the happy path plus each hard rule from Product_Scope. (docker-compose demo + static Pages demo; live F1TV lane still needs a real race weekend)
- [x] UI: check the built screens against Design_Direction.md — states (loading/empty/error), 375px, keyboard focus. (UI/UX audit applied in #93)

Exit: no known broken flows. Skills: run, webapp-testing, diagnose.

## 5 · Review — quality gate before polish

- [x] `/code-review high --fix` on the accumulated work. (#72, #94 pre-merge)
- [ ] `/simplify` pass.
- [x] UI: web-design-guidelines audit. (#93; full 3-page design-critique + WCAG AA re-audit 2026-09-08, fixes merged in #145 — reports in `reviews/2026-09-08/`)
- [x] UX polish, batch 1 "touch and cascade fixes": every touch target 44px on touch, 24px scrubber on desktop, phone strip no longer clips the REPLAY chip. (F1-UX-8, F1-UX-12, F1-UX-10, and the `min-width` part of F1-UX-6 from the 2026-10-23 UX audit; the rest of that audit is open or waiting on owner decisions D1-D3.)
- [x] UX polish, batch 2 "phone header and navigation": Pause and the section chips stay in the sticky phone strip, the map panel starts at 178 px instead of 307 px, and the strip comes first in the tab order. (F1-UX-2, F1-UX-5, F1-UX-9, F1-UX-4; F1-UX-3, F1-UX-7 and F1-UX-1 follow in later PRs.)
- [x] UX polish, batch 3 "desktop density": one board grid, so the map column carries the map and the strategy chart, the tower sits on the right, and Telemetry sits beside a Comms-over-Race-Control stack. Desktop page 1.68 to 1.49 screens at 1440 px. (F1-UX-11)
- [x] UX polish, batch 4 "phone tower and the gear" (owner decisions D2 option 2, D3 option 3): phone timing cards cut to two lines with Best and the sectors behind a Detail switch (tower 3.5 to 2.4 screens); the static demo's F1TV dead end is now a "How this runs" page, and the link carries a text label. (F1-UX-3, F1-UX-7, naming part of F1-UX-6)
- [x] UX polish, batch 5 "demo clip opens on a full tower" (owner decision D1, option 3): the Monza 2024 clip is re-baked from lap 2 (laps 2-6) with the repo's own `ingest/record.py`, replacing the old file in place. 19 of 20 tower rows read NO DATA for 2:30 of every loop before; about 8 s after. Clip size 20.9 MB to 23.1 MB (+10.6%). (F1-UX-1; issue #123 on the clips policy stays open.)

Exit: findings addressed or explicitly waived. Skills: code-review, simplify, web-design-guidelines.

## 6 · Ship — recruiter-ready

- [x] README rewrite: screenshots, architecture diagram, run-in-3-commands, "why I built this". (#86)
- [ ] API docs/Swagger if applicable.
- [x] Deployed demo link. (GitHub Pages static demo)
- [ ] Final pass with /repo-review.

Exit: /repo-review comes back clean. Skills: repo-review.

## House rules

- Docs before code; scope doc changes are cheaper than code changes.
- Enforcement lives in the backend; the UI mirrors it.
- One well-finished project beats three tutorial follow-alongs.
- If a stage feels like ceremony for a tiny project, shrink the doc to a few sentences — but never skip the stage.
