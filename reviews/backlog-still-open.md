# Still-open review items — f1-race-tracker (checked 2026-08-28, against main @ 65393b3 / PR #87)

Method: read `reviews/ui-fix-log.md`'s "Remaining after all five agents", skimmed
`code-review.md`, `ponytail-audit.md`, `security.md`, `accessibility.md`,
`design-system.md` for deferred/not-fixed items, and the WS1–WS6 roadmap, then
verified each candidate against the current source (not just PR titles).

**Confirmed already fixed since the reviews** (not listed below): reconnect cap
(`socket.ts` `MAX_RECONNECT_ATTEMPTS`), deep-linkable selection, visible page
titles, `.tele-row`/`.tele-label` + `--radius` token + `--fs-3xs/2xs` alias
cleanup (design-system §2.7/2.8/2.10), COMPARE folded into OVERLAY (ADR-0009,
M6/M7, frontend-design #9), rail rebuilt as instrument cluster incl. the
1280px-wrap bug and sticky mobile strip (frontend-design #8, ui-ux m22),
M13/M14 SegmentedControl unification + the rail-badge/control duplication
(ui-ux m8), Race Control wall-clock vs race-clock labelling (ui-ux "m14"
microcopy item), Comms empty-panel resting state (frontend-design #6),
security H-1/M-1/M-2 (`.dockerignore`, loopback bind, `okf.yml` permissions),
and most of ponytail-audit's Tier-1 doc/plan cleanup (`docs/superpowers/plans/`
and `specs/` are down to only the load-bearing files).

---

## UI / product

- **Static demo fetches the 24 MB replay clip even on routes that don't need
  it.** The data-source effect in `App.tsx:113-123` calls
  `connectStaticReplay` unconditionally on mount, before any hash/route check
  — visiting `#settings` still downloads the full clip. Matters for the public
  GH-Pages demo's load time and data cost. Files: `web/src/App.tsx`,
  `web/src/realtime/staticReplay.ts`. Effort: M (needs a design call on
  tearing down/rebuilding the connection on route change).

- **Tower row rhythm still cramped at 10 Hz.** `.tt-table td` padding is
  `var(--sp-0) var(--sp-1)` (2px/4px) with no inter-row separator, and no
  throttle exists on the sector-delta superscripts (they still update at the
  same 10 Hz as the main cell). frontend-design item 7's suggested 4px padding
  + inset hairline + ~2 Hz throttle is not applied. File:
  `web/src/styles/components.css:658-662`, `web/src/components/TimingTower.tsx`.
  Effort: S.

- **Copy pass incomplete.** `#ghost`'s "solid vs ghost" rendering-vocabulary
  phrasing is still in the panel note (`Ghost.tsx:265`) — the "(approx)" hedge
  was successfully moved out of the header into the footnote, but the
  jargon terms weren't reworded. `#compare`'s header copy no longer applies
  (route is gone). File: `web/src/components/Ghost.tsx`. Effort: S.

- **`design-system §2.11` — `index.html`'s `theme-color` duplicates
  `--asphalt` as a hardcoded hex.** Explicitly called "unavoidable" by the
  original review (HTML can't read a CSS variable) — still true today, so
  this is accepted, not a bug, but flagging since it's technically still open.
  File: `web/index.html:7`. Effort: N/A (accepted).

## Ingest / data accuracy

- **Gap estimator still resolves to ~half a second** per `ui-fix-log.md`'s
  closing note — PR #81 shipped an arc-length gap estimator which likely
  improved this, but the review's own claim that a "real fix lives in
  `ingest/resample.py`" was not independently re-verified against current
  numbers in this pass; worth a numeric re-check rather than assuming #81
  closed it completely. File: `ingest/resample.py`. Effort: M (verification),
  possibly already resolved.

- **Cold-start partial roster** and **retired ('Out') cars aren't sunk to the
  tail** — both deliberately deferred as comment-only in `code-review.md`
  (documented under `KNOWN LIMITATIONS` in `ingest/resample.py`'s
  `reconcile_positions` docstring, not fixed in code). Effort: M each.

- **Live `NumberOfLaps` off-by-one risk unverified against a real feed** —
  `ingest/live_signalr.py`'s `_parse_timing_line` still carries the
  `UNVERIFIED` note; no real F1TV session has been captured to confirm/deny.
  Blocked on WS5 (F1TV auth) landing. Effort: needs a live session, not code.

## Security (Low/Info tier — the High/Medium items are fixed)

- **L-1 — No `Host` header validation; DNS rebinding reaches control/auth
  endpoints.** The `Sec-Fetch-Site` guard on `POST /control/source`
  (`internal/app/gateway.go:243`) doesn't survive DNS rebinding. Not verified
  fixed in this pass — full text of the Low/Info section wasn't re-read past
  L-1's opening, so treat the rest of `security.md`'s Low/Informational list
  (L-2 through L-6+, 7 Informational items) as **unverified, likely still
  open** rather than confirmed either way. Effort: S–M per item.

## Repo hygiene (ponytail-audit — cosmetic/portfolio-facing, no runtime effect)

- **`docs/ux-evaluation-2026-07.md` (91 lines)** — point-in-time QA transcript
  with harness caveats, superseded by shipped code / GitHub Issues. Still
  present. Effort: S (delete).
- **`knowledge/` (9 files, 172 lines) + `.github/workflows/okf.yml`** —
  duplicates `CONTEXT.md`/`docs/adr/`, has broken root-absolute links; gated
  by an external portfolio-standard CI action, so deletion is a product
  decision, not just cleanup. Still present. Effort: S.
- **`ingest/explore.py` (72 lines)** — committed FastF1 scratch/debug script,
  zero imports, zero CI references. Still present. Effort: S (delete).
- **`scripts/test.ps1` (28 lines)** — duplicate of `scripts/test.sh`, unused
  by CI. Still present. Effort: S (delete).
- **`web/.gitignore` (24 lines)** — untouched Vite scaffold default, fully
  redundant with root `.gitignore`. Still present. Effort: S (delete).
- **70 MB of committed full-length replay clips** (`monza-2023-race.jsonl`
  24M, `monza-2024-race.jsonl` 23M, `silverstone-2024-race.jsonl` 22M) —
  `ingest/record.py --start-lap/--end-lap` already supports re-baking a
  shorter window; clips are still full races. Biggest single "recruiter sees
  a bloated repo" item. Effort: M (re-bake + re-verify contract tests).
- **`--onair` CSS custom property defined but never referenced** — the one
  place it should apply (`components.css:436`, the LIVE chip wash) uses
  `var(--onair-rgb)` instead, so the token itself is dead. Confirmed:
  `grep var(--onair)` returns nothing. File: `web/src/styles/tokens.css:13-14`.
  Effort: S (delete 2 lines).
- **`useLapHistory.ts`/`useGapHistory.ts`** — one-line pass-throughs to
  `useRollingHistory`, one call site each in `App.tsx`. Still present as
  separate files. Effort: S.
- **`TEAM_MAP` defined byte-identically twice** (`ingest/record.py:76-87`,
  `ingest/live_signalr.py:175-186`). Still duplicated — not moved to
  `resample.py`. Effort: S.
- **Hand-rolled max/min/clamp in `cmd/loadtest/hist.go`** instead of Go
  1.21+ builtins (`go.mod` is on 1.26). Still hand-rolled — no `func max`/
  `func min` found, meaning the builtins aren't shadowed but the manual
  branches at `:23-29,:45-47,:58-63` weren't simplified either. Effort: S.
- **`type Msg = NonNullable<ReturnType<typeof parseMsg>>` "gymnastics"** in
  `staticReplay.ts:10` — `race.ts` still doesn't export a `Msg` type, so the
  workaround remains. Effort: S.
- **Normalisation math written twice** (`ingest/record.py:237-243` batch vs
  `live_signalr.py:229-240` incremental) — not consolidated into
  `resample.py`. Not re-verified line-by-line this pass but no refactor
  landed in the merged PRs list, so treat as likely still open. Effort: S.
- **Four near-identical message-handling blocks** copy-pasted between
  `_replay_capture`/`handle_message` in `live_signalr.py` — not verified
  this pass; likely still open (no PR in the merged list touches that file).
  Effort: M.
- **~190 lines of unverified live-timing field parsing**
  (`_parse_gap_str`/`_parse_laptime_str`/`_parse_timing_line`/
  `_parse_tyre_line`, `live_signalr.py:917-1023`) marked UNVERIFIED against a
  real session — same WS5 blocker as above. Effort: none until F1TV auth
  lands (or a deliberate scope cut, per the audit's suggestion).

## Roadmap workstreams (docs/superpowers/plans/2026-08-19-polish-and-immersion-roadmap.md)

- **WS1 (design-system consolidation): mostly done.** Semantic color tokens
  and the `.tele-row`/`--radius`/font-scale cleanup landed (PR #82 and the
  design-system fixes verified above). Not verified: full audit of the "~64
  inline `style={{}}` blocks" migration into `components.css` classes, and
  the colour-blind fallback / `aria-label` items on the two bare `<select>`s
  (`TelemetryPanel.tsx:99`, `Ghost.tsx:166`) — worth a follow-up grep.
- **WS2 (track furniture — DRS zones, corner numbers, checkered start/finish,
  safety-car marker): not started.** No PR in the merged list touches map
  geometry/snapshot baking for this. Effort: M–L.
- **WS3 (replay pause/scrub/speed + race timeline): not started**, beyond
  PR #87's pacer-resync bugfix (which fixes a stall-recovery bug in the
  *existing* always-on-pace replay, not new playback controls). Effort: L —
  flagged in the roadmap itself as needing its own design pass first.
- **WS4 (race-engineer analytics — sector-delta chip, position-change chart,
  mini-sector heat strip, speed-trap widget, tyre health, battle-forecast
  chip): not started**, except WS4 item 7 ("#compare fix") which is
  superseded by PR #83 folding COMPARE into OVERLAY. Effort: S–M per item.
- **WS5 (F1TV live-timing + live-radio beta): not started.** No ADR-0007/0008
  exist yet in `docs/adr/` (only referenced in reviews as "to be written");
  `ingest/live_signalr.py` still hangs silently on auth per the code-review
  deferred note. This is the single largest remaining workstream. Effort: L.
- **WS6 (small fixes): partially done.**
  - Bogus cold-start interval suppression in `record.py`'s gap pass — not
    verified fixed; treat as open (ties to the reconcile_positions deferred
    item above).
  - Reconnect error logging the raw `Event` object instead of a short string
    — not re-checked against current `socket.ts`; worth a quick grep before
    prioritizing.
  - `@testing-library/react` + jsdom render tests for Map/Comms/Ghost/
    TelemetryPanel/TimingTower — **confirmed still absent**: `code-review.md`
    itself notes `renderToStaticMarkup` doesn't exercise `React.memo` and
    "there is no jsdom renderer in this project," and no PR since then adds
    the dependency. Effort: M.
  - `ingest/test_record.py` for the recorder's orchestration seams — not
    verified; likely still open.

---

## Notes on confidence

Everything under "Repo hygiene" and the `security.md` Low/Info tier beyond
L-1 was spot-checked by direct file/grep inspection, not by re-reading the
full review text — a couple of items (normalisation-math duplication, the
four copy-pasted message-handling blocks, WS1's inline-style migration) are
marked "likely still open" rather than confirmed, since no merged PR title
in the given list plausibly covers them, but the diffs themselves weren't
read in full. Recommend a targeted follow-up grep before filing issues on
those specific three.
