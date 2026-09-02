<!-- Index of the repo's portable agent memory: one line per memory file, plus the convention for adding one. -->
# Memory Index

This directory IS the memory system — it lives in the repo, not in `.claude/`, so it
survives switching machines and works for any agent (Claude Code, Codex, Cursor, …).
Read every file here at the start of a session.

Convention: one fact per file, kebab-case name, frontmatter `name` / `description` /
`metadata.type` (`user` | `feedback` | `project` | `reference`). Body links to related
memories as `[[other-file-name]]`. Add or update a file, then add/update its one-line
pointer below. Never put memory content in this index. Update stale files, delete wrong
ones; don't duplicate what CLAUDE.md, FILE-MAP.md, CONTEXT.md, or git history already say.

- [Plain-English preference](plain-english-preference.md) — unpack jargon; lead with why it matters
- [F1 Tracker direction](f1-tracker-direction.md) — 2026-09-02: PR #94 merged all 6 peer-comparison features; static demo re-baked with the new clip-header fields
- [Token economy](token-economy.md) — rules are GLOBAL in ~/.claude/CLAUDE.md ("Subagents & Token Economy"); file keeps the why/history
- [Code-review level](code-review-level.md) — default `code-review high --fix`; `max` only when the user explicitly asks
- [Subagent model hook](subagent-model-hook.md) — omit `model` → hook defaults sonnet; explicit model (e.g. opus) is respected
- [No direct pushes](no-direct-pushes.md) — ALL commits (even chores) go through PRs; never push main directly
- [F1 build gotchas](f1-build-gotchas.md) — vite wipes .gitkeep; bench/results.* canonical; no cgo locally, -race is CI-only; static demo needs a bake + temp web/.env.local
