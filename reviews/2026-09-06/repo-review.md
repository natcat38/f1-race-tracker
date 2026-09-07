<!-- Recruiter-readiness review, scoped to docs/README/repo-hygiene per orchestrator ground rules (code review, design/a11y, and ponytail passes run separately/concurrently). -->

# Repo review — 2026-09-06

## Score / verdict

**Solid, one real gap now fixed.** Docs, ADRs, memory, CI-gated FILE-MAP, SECURITY.md,
LICENSE, and the `gh` repo description/topics are all accurate and specific — this repo
already reads as unusually well-maintained for a portfolio project. The one real defect
was the README's feature list silently missing all five features PR #94 shipped
(2026-09-02): PR #94 touched 14 files and added throttle/brake/gear pedal traces,
pit-stop durations, static-demo pause/scrub, corner numbers + start/finish line, and the
sector-dominance heatmap — but only added 2 lines to README.md (an unrelated note about
the simulated-live feed). Fixed below.

## Fixes applied

- `README.md:13` — added corner numbers + start/finish line ("track furniture") to the
  track-map-first bullet.
- `README.md:14` — added the throttle/brake/gear pedal-trace-over-lap-distance feature
  to the telemetry-compare bullet (previously only mentioned the older time-based
  sparklines).
- `README.md:15` — added the sector-dominance (minisector) heatmap as a track-map
  extension of the existing sector-shading bullet.
- `README.md:16` — added pit-stop durations to the strategy-timeline bullet.
- `README.md:29` — added a sentence noting the static demo's pause/scrub playback
  controls (previously the demo section said nothing about them).

All five edits reuse the terminology CONTEXT.md already fixed for these features
("pedal trace", "corner" / "track furniture", "sector dominance" / "minisector") so the
new prose stays consistent with the glossary. No voice/structure changes — only inserted
clauses into existing bullets, one new clause per sentence, verified each described
feature exists in `web/src/components/TelemetryPanel.tsx`, `web/src/App.tsx`, and the
`7026249`/`0770883`/`8c0ef05` commits before writing it.

## Findings not applied (need owner decision or can't be done here)

1. **`docs/assets/board.png` and `overlay.png` are stale** (last shot 2026-08-23,
   before PR #94 merged 2026-09-02). Neither screenshot shows corner numbers, the
   sector-dominance heatmap, or a pit-stop duration label — the features the README now
   describes aren't visible in its own screenshots. Not fixed: I can't take screenshots.
2. **70 MB of committed replay clips in `data/replays/`** (monza-2023 24 MB, monza-2024
   21 MB, silverstone-2024 23 MB). Flagged as an open follow-up in the prior docs review
   (`reviews/docs.md` item 2) and still unresolved. README doesn't explain why they're
   committed rather than fetched/LFS-tracked. This is a product/repo-structure decision,
   not a docs fix — see below.
3. **ROADMAP.md Ship-stage items unchecked**: "API docs/Swagger if applicable" and
   "Final pass with /repo-review" (this review is that pass, but ROADMAP.md itself lives
   on open PR #96, not main, so I can't check the box here per the ground rules —
   flagging for whoever merges #96).
4. **`docs/Design_Direction.md` still doesn't exist** (Plan-stage item, unchecked on the
   PR #96 roadmap). Design tokens live in `web/src/styles/tokens.css` with no written
   rationale doc. Product/design decision, not a docs typo fix.
5. Confirmed **not** a problem, just verified: `reviews/` is untracked but *not*
   gitignored (`.gitignore` has no `reviews` entry) — it's local by owner choice, as
   assumed. `web/index.html` already carries full OG/Twitter meta tags (a prior review's
   follow-up item is already done, no action needed).

## Screenshot requests (can't be taken here)

1. **Board hero shot replacement** — Monza 2024 replay showing a corner number and the
   start/finish line marker on the track map, ideally also catching the sector-dominance
   heatmap coloring on part of the outline. Replaces `docs/assets/board.png`.
2. **Telemetry-compare panel** — the two-car "vs" view with the throttle/brake/gear
   pedal-trace charts visible (new in PR #94, never shown in any README image).
3. **Strategy timeline** — the stint chart with a pit-stop duration label visible on one
   of the stops.
4. Optional: the static-demo pause/scrub control bar, since it's now called out in the
   Quick Look section's text.

## Product decisions for the owner

1. **70 MB of committed clip data** — keep committing full-resolution clips (simplest,
   fully offline demo, already the status quo), or move to Git LFS / a `scripts/fetch-clips.sh`
   that pulls them from a release asset. If the answer is "keep as-is," worth one sentence
   in README's "Further reading" or `ingest/README.md` saying so explicitly, so it doesn't
   read as an oversight to a reviewer who notices repo size.
2. **New screenshots** — when convenient, reshoot `board.png`/`overlay.png` (or add a
   third image) to reflect PR #94's map furniture and heatmap, per the requests above.
3. **`docs/Design_Direction.md`** — write it now or explicitly defer; it's the one
   unchecked Plan-stage box with no artifact standing in for it (unlike the other
   unchecked items, which have partial substitutes).
