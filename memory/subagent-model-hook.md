---
name: subagent-model-hook
description: "Subagent model-tiering rule (sonnet default, explicit model wins) is now in global ~/.claude/CLAUDE.md — this file keeps only the hook mechanics and history"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 2f3518ba-8712-4d8c-bbfa-366d8631e143
  modified: 2026-09-06T00:00:00.000Z
---

The tiering rule itself is now global — see `~/.claude/CLAUDE.md` "Subagents & Token
Economy" ("My global hook defaults omitted `model` to sonnet; an explicitly passed model is
respected"). Don't duplicate it here.

**Mechanics (not in CLAUDE.md):** enforced by a global `Agent` PreToolUse hook in
`~/.claude/settings.json` ("Routing agent model…"). Model values passed to `Agent` must be
short aliases (`sonnet`/`opus`/`haiku`/`fable`), not full model ids. Editing settings.json
needs the user's explicit OK (self-modification).

**Why (history):** as of 2026-08-20, changed at the user's request from force-overriding
every dispatch to sonnet (which blocked routing to opus) to the current omit-defaults
behavior. See [[f1-tracker-direction]], [[token-economy]].
