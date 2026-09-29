# Grill-with-docs open questions — PR #94 vocabulary pass (non-interactive session)

Session ran non-interactively (see CLAUDE.md's session note); questions the
`grill-with-docs` skill would normally ask the user are recorded here instead,
each with my recommended default. `CONTEXT.md` was left unchanged on these
points.

## 1. Is "clip header" a glossary term or an implementation detail?

`clipHeader` is an unexported Go struct name in `internal/feed/replay/play.go:18`
(the parsed JSON header of a baked clip file — track, corners, stints, etc.).
It doesn't appear in any UI copy, cross-layer contract naming, or other source
file — it's a private parsing detail of one file, not a concept `CONTEXT.md`
readers (issues, ADRs, other layers) need to name.

- **Options:** (a) add a "Clip header" glossary entry anyway, since PR #94 grew
  it by four fields; (b) leave it out — `CONTEXT.md`'s own rule is "no
  implementation details," and this is a private struct, not a cross-layer
  concept.
- **Recommended default:** (b) — leave it out. If a future ADR or issue needs
  to talk about "the baked clip's session-constant fields" as a concept, ADR-0010
  (drafted this session) already names that set without needing a glossary
  entry.

## 2. Should WS3's "client-side scrub vs. server-paced live-lane scrub" become an ADR now?

`reviews/2026-09-06/architecture.md` (the architecture review run alongside
this pass) already surfaces this as a **blocker**, not a settled decision:
`App.tsx:74-78`'s own comment states pause/resume/scrub only works on the
static demo, and `internal/app/writer.go`'s `Writer.Run` has no control-channel
concept for a live/replay-lane pause or seek. The architecture review's
recommendation is that this "should be made explicit (and ADR'd) **before**
WS3 work starts" — i.e., the decision has not been made in code yet, only the
absence of a decision has been confirmed.

Per this task's instructions, I only draft an ADR when the decision is
"clearly already made in code and consistent with existing ADRs." This one
isn't — there's no code implementing either option (a control channel on
`Writer`, or a permanent client-only limitation) — so I did not draft an
ADR-0010 for it. ADR-0010 in this PR is reserved for the track-furniture/
pit/pedal data-placement decision instead (see below), matching
`reviews/2026-09-06/architecture.md`'s own suggested filename.

- **Options:** (a) draft a *placeholder* "Status: Proposed" ADR now, framing
  the two options (writer-side control channel vs. client-only, live/replay
  lanes permanently excluded) so WS3 starts by accepting or rejecting it
  rather than starting design from a blank page; (b) wait until WS3 design
  actually picks one, then write the ADR retroactively (repeating the
  Phase-5 / PR-94 pattern architecture.md is already calling out as a
  recurring gap).
- **Recommended default:** (a) — draft the placeholder before WS3 starts,
  precisely so this doesn't become a third retroactive ADR. Not done in this
  session since it's a product/design decision the user should make (per
  CLAUDE.md: "Product/design decisions are mine — elicit via questions"), not
  one this pass should pre-empt by picking an option.

## Summary

- Terms checked against code/UI and found consistently named already (no
  `CONTEXT.md` change needed beyond the two precision fixes made): minisector,
  sector dominance, corner (number), pedal trace, scrub/pause/resume.
- `CONTEXT.md` changes made this session: (1) sharpened the "Pit stop" entry —
  it previously said "stationary/pit-lane duration" as if interchangeable;
  the code (`internal/model/model.go:70-72`, `ingest/pit.py`) is explicit that
  `DurationS` is pit-lane time only and stationary time is out of scope, so the
  entry now says so. (2) Added a one-line note to "Corner / track furniture"
  that the start/finish line is drawn from `track[0]` by convention, not a
  separate baked field. (3) Added a short "scrub"/"pause"/"resume" usage note
  under "Static demo," since PR #94 introduced real transport controls there.
- `docs/adr/0010-track-furniture-and-pit-pedal-data-extend-existing-patterns.md`
  drafted (Status: Proposed) for the `Corners`/`PitStops`/`PedalTraces`/
  `SectorDominance` data-placement decision, mirroring ADR-0005 and
  `reviews/2026-09-06/architecture.md`'s Missing-ADR finding (same filename it
  recommended).
- `docs/agents/domain.md` is a how-to layer (how to consume `FILE-MAP.md`/
  `CONTEXT.md`/ADRs), not a concept listing — nothing there needed updating.
