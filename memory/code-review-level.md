---
name: code-review-level
description: "Default /code-review effort (high --fix, max only when explicitly asked) is now in global ~/.claude/CLAUDE.md — this file keeps only the project-specific history"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: cc05e5c3-88fb-4539-b16e-504a9c67d918
  modified: 2026-09-06T00:00:00.000Z
---

The rule itself (`high --fix` default, `max` only on explicit request) is now global —
see `~/.claude/CLAUDE.md` "Subagents & Token Economy". Don't duplicate it here.

**Project-specific history behind it:** `max` fanned out many verify/angle workers and
burned through the user's session usage limit mid-run on this repo (2026-08-21), killing
parent agents before they could apply fixes; `high` gives broad coverage at a fraction of
the cost. Related: [[subagent-model-hook]], [[token-economy]].
