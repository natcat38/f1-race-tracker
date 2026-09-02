<!-- Feedback memory: never push directly to main, even for chores — always go through a PR. -->
---
name: no-direct-pushes
description: Route ALL commits through PRs, including chore/docs/data commits — never push directly to main via the admin bypass
metadata:
  type: feedback
---

On 2026-09-02 four chore commits (memory updates, clip re-bake, FILE-MAP regen, BOM fix)
were pushed straight to main using the owner's admin bypass; the ruleset flagged
"Changes must be made through a pull request" each time. The user then said:
route chore commits through PRs from now on.

**Why:** the repo's branch protection ([[f1-tracker-direction]], protect-repo ruleset)
exists so every change lands with the 7 required checks green *before* merge — the
bypass skips that gate and puts red-main risk on even "safe" commits (the FILE-MAP
staleness failure on main proved the point).

**How to apply:** for any commit — chore, docs, data, memory — create a branch,
push it, open a PR, and merge once checks pass (`gh pr merge --auto --squash` is fine).
Never `git push` to main directly, regardless of how small the change is.
