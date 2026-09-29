---
name: f1-repo-review-2026-09-06
description: "2026-09-06 full-repo re-review: 8 reports under reviews/2026-09-06/, ROADMAP.md added via open PR #96, findings to be filed as GitHub issues"
metadata:
  node_type: memory
  type: project
  modified: 2026-09-06T00:00:00.000Z
---

On 2026-09-06 the repo got a full-repo re-review (the "Next up" item ROADMAP.md names for
the Review stage). Reports live under `reviews/2026-09-06/`: architecture, security,
code-review-94 (PR #94's new components), ui-guidelines, accessibility, testing-strategy,
grill-open-questions, and repo-review. Same session added `ROADMAP.md` (house six-stage
lifecycle, retro-filled against existing artifacts) via **PR #96** — Current stage: Review.

**How to apply:** findings from these reports are meant to be filed as GitHub issues, not
fixed inline in this session — check `gh issue list` for what's already been filed before
re-reporting the same finding. See [[f1-tracker-direction]] for the overall project state
and [[f1-build-gotchas]] for known build/verify traps.

**Update 2026-09-06 (later):** all 22 `ready-for-agent` issues (#99–#122 minus the human ones) were fixed and merged via PRs #125–#133, each code-reviewed at `high --fix` before merge (reviews found and fixed: a swallowed zlib-cap error in #125, a missing Dependabot docker ecosystem in #131; the rest were clean). Still open: #115/#123/#124 (`ready-for-human`) and #103 (`needs-info`). Lesson: agent worktrees hold the PR branch checked out, so a land script must `git worktree remove` first or its checkout fails silently; linear-history protection means every PR needs a rebase + fresh FILE-MAP + CI re-run before merge (see the landpr pattern: rebase, regen, force-push-with-lease, wait CI, squash-merge).
