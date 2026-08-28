---
name: code-review-level
description: "Default /code-review effort is `high --fix`; `max` only when the user explicitly asks for it"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: cc05e5c3-88fb-4539-b16e-504a9c67d918
  modified: 2026-08-23T04:51:04.119Z
---

When running the `code-review` skill — whether I run it myself, delegate it to an agent, or the user asks for "a code review" — use **`high --fix`**. Do **not** use `max` unless the user explicitly says to run code-review at max.

**Why:** max fans out many verify/angle workers and burned through the user's session usage limit mid-run (2026-08-21), killing parent agents before they could apply fixes; `high` gives broad coverage at a fraction of the cost.

**How to apply:** Skill `code-review` with args `high --fix <target>` by default. Only pass `max` when the user's message literally asks for max. Related: [[subagent-model-hook]] (explicit `model: 'opus'` passes through the hook; omitting it routes to sonnet).
