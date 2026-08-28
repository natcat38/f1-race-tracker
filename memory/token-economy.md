---
name: token-economy
description: "Token-economy rules are GLOBAL now (~/.claude/CLAUDE.md \"Subagents & Token Economy\") — this file keeps only the project-specific history"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: cc05e5c3-88fb-4539-b16e-504a9c67d918
  modified: 2026-08-24T02:42:47.140Z
---

The full ruleset (model tiering, agent scoping, wave scheduling, file-based reports, scoped verification, crash recovery) lives in `~/.claude/CLAUDE.md` under **"Subagents & Token Economy"** — follow that; don't duplicate it here.

**Project-specific history behind it:** the 2026-08 review sweep hit the session limit 4+ times. Biggest costs in order: `code-review max` (multi-angle Opus fleet, ~1M+ tokens), Opus on every subagent, five sequential UI agents each re-running the full go+pytest+npm suite, and duplicate agents relaunched after crashes when the originals' work had survived. Recovery was cheap only because findings were persisted to `reviews/` and worktrees survived. See [[code-review-level]], [[subagent-model-hook]], [[f1-tracker-direction]].
