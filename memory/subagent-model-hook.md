---
name: subagent-model-hook
description: "Subagent model hook defaults to sonnet only when Agent call omits model; explicit model now wins"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 2f3518ba-8712-4d8c-bbfa-366d8631e143
  modified: 2026-08-20T07:35:36.285Z
---

The user has a global `Agent` PreToolUse hook in `~/.claude/settings.json` ("Routing agent model…"). As of 2026-08-20 (changed at the user's request) it **defaults the model to `sonnet` only when the Agent call omits `model`** — an explicitly passed `model` (e.g. `opus`) is respected. Previously it force-overrode every dispatch to sonnet, which blocked routing a subagent to opus.

**Why:** the user optimizes subagents onto a cheaper model by default to cut token usage (their 5-hour rolling limit gets hit otherwise), but wants explicit model choices to win.

**How to apply:** omit `model` for routine subagents (they'll get sonnet); pass `model` only when a bigger model is deliberately wanted. Model values must be short aliases (`sonnet`/`opus`/`haiku`/`fable`), not full model ids. Editing settings.json needs the user's explicit OK (self-modification). See [[f1-tracker-direction]].
