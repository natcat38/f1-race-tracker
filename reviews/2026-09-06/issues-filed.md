# Issues filed from the 2026-09-06 review pass

Filed via `gh issue create` against `natcat38/f1-race-tracker`. No open issues
existed at filing time (`gh issue list --state open` was empty), so nothing
was skipped as a duplicate. PRs #96 (ROADMAP.md), #97 (CONTEXT.md/ADR-0010/
memory), and #98 (README feature list) were already open and cover their
respective items, per instructions — no issues filed against their scope.

Filed in severity order per the task brief (accessibility blocker, pit.py
back-to-back stop bug, security Low on `/api/f1auth`/`/ws`, scrub teleport
bug, failing `check_gap_estimator` gate — first), then grouped by source
report.

| # | Title | Label | Size | Source report |
|---|---|---|---|---|
| [#99](../../../issues/99) | a11y: Corner-number text unreadable against sector-dominance heatmap (Map.tsx:80-89) | `bug`, `ready-for-agent` | S | accessibility.md |
| [#100](../../../issues/100) | ingest: back-to-back pit stops corrupt each other in build_pit_data (pit.py:32-48) | `bug`, `ready-for-agent` | M | code-review-94.md |
| [#101](../../../issues/101) | security: Host validation missing on /api/f1auth and /ws — DNS-rebinding gap | `bug`, `ready-for-agent` | S | security.md |
| [#102](../../../issues/102) | Teleport-snap threshold compares [0,1]-space distance against a SIZE-space constant — dead code | `bug`, `ready-for-agent` | S | architecture.md |
| [#103](../../../issues/103) | check_gap_estimator gate fails on the rebaked Monza 2024 clip (opening-lap instability) | `bug`, `needs-info` | M | code-review-94.md |
| [#104](../../../issues/104) | a11y: Sector-dominance heatmap encodes its whole meaning in colour alone, no legend | `bug`, `ready-for-agent` | S-M | accessibility.md |
| [#105](../../../issues/105) | a11y: Pit-stop duration tick fails contrast against lighter tyre-compound bars | `bug`, `ready-for-agent` | S | accessibility.md |
| [#106](../../../issues/106) | a11y: Distance-trace SVGs give assistive tech a label but no data | `bug`, `ready-for-agent` | S | accessibility.md |
| [#107](../../../issues/107) | Replay scrub range input doesn't share Ghost scrubber's dark-mode/touch-target/sizing styling | `bug`, `ready-for-agent` | S | accessibility.md |
| [#108](../../../issues/108) | Replay-elapsed readout reuses the hero session-clock class | `bug`, `ready-for-agent` | S | ui-guidelines.md |
| [#109](../../../issues/109) | Corner numbers vanish entirely below 700px width, with no fallback | `bug`, `ready-for-agent` | S | ui-guidelines.md |
| [#110](../../../issues/110) | ingest: retiring mid-stop gets a fabricated 30s pit-stop entry | `bug`, `ready-for-agent` | S-M | code-review-94.md |
| [#111](../../../issues/111) | ingest: missing telemetry samples produce garbage throttle/gear ints | `bug`, `ready-for-agent` | S | code-review-94.md |
| [#112](../../../issues/112) | Sector-dominance heatmap never draws the start/finish wraparound segment | `bug`, `ready-for-agent` | M | code-review-94.md |
| [#113](../../../issues/113) | Collapse Source interface's 9 session-constant getters into one Baked() call | `ready-for-agent` | M-L | architecture.md |
| [#114](../../../issues/114) | ingest/pit.py imports pandas, breaking the pure-helper CI convention | `ready-for-agent` | S-M | architecture.md |
| [#115](../../../issues/115) | Decide live-lane scrub control-channel design before WS3 starts | `ready-for-human` | L | architecture.md, grill-open-questions.md |
| [#116](../../../issues/116) | security: gateway hardening pass — CSP headers, directory listing, SECURITY.md threat model | `bug`, `ready-for-agent` | S-M | security.md |
| [#117](../../../issues/117) | security: unbounded zlib.decompress on Position.z has no size cap | `bug`, `ready-for-agent` | S | security.md |
| [#118](../../../issues/118) | chore: pin remaining floating version references (lychee-action, Docker base images, msgpack) | `ready-for-agent` | S | security.md |
| [#119](../../../issues/119) | test: staticReplay.ts pause/resume/scrub has zero test coverage | `ready-for-agent` | S-M | testing-strategy.md |
| [#120](../../../issues/120) | test: add ingest/test_record.py for the recorder's orchestration seam | `ready-for-agent` | M | testing-strategy.md |
| [#121](../../../issues/121) | test: TelemetryPanel's DistanceTrace rendering is untested (38% coverage) | `ready-for-agent` | S | testing-strategy.md |
| [#122](../../../issues/122) | test: add unit tests for live_signalr.py's ~190 UNVERIFIED parser lines | `ready-for-agent` | M | testing-strategy.md |
| [#123](../../../issues/123) | Decide policy for 70 MB of committed full-length replay clips | `ready-for-human` | M | repo-review.md, backlog-still-open.md |
| [#124](../../../issues/124) | Reshoot stale docs screenshots for PR #94; decide on docs/Design_Direction.md | `ready-for-human` | S | repo-review.md |

**Totals: 26 issues.** By label: 17 `ready-for-agent` (+`bug` on 13 of those),
1 `needs-info` (+`bug`), 3 `ready-for-human`, 5 `ready-for-agent` without
`bug` (refactors/tests/chores, not defects).

## Findings deliberately not filed

- **`reviews/security.md` I-3** (`/api/f1auth` writes raw Redis bytes without
  validation) — re-verified "still open, low risk as before," writer is
  trusted, no new information since the last report. Not filed; no new risk
  surfaced.
- **`reviews/security.md` I-6** (free-form upstream text has no length cap) —
  re-verified "still open" but the existing mitigating control (no
  `dangerouslySetInnerHTML`/unsafe sink in `web/src`, re-confirmed this pass)
  still holds. Lower priority than the other security items filed; dropped to
  keep the batch to independently-grabbable, higher-value slices.
- **`reviews/security.md` L-5** (`govulncheck@latest` unpinned) — explicitly
  "accepted risk, as before" in the source report; this is a recorded
  decision, not an open item.
- **`reviews/architecture.md`'s `race.ts` `isRecord()` helper dedup** — the
  report itself recommends doing this "opportunistically alongside the next
  field addition rather than as its own PR," not as a standalone slice. Not
  filed per the report's own guidance.
- **`reviews/architecture.md`'s `StaticReplayHandle` callable-object shape**
  (Speculative finding) — report explicitly says "not worth fixing now… the
  moment live-lane pause/scrub is built, this is the seam to revisit." Folded
  conceptually into #115 (the WS3 ADR decision) rather than filed separately.
- **`reviews/architecture.md`'s three-flavors-of-nearest-index consolidation**
  (Worth-exploring finding) — report explicitly says "not urgent." Not filed.
- **`reviews/architecture.md`'s Missing-ADR (ADR-0010) finding** — already
  covered by open PR #97 per task instructions.
- **`reviews/backlog-still-open.md` items not reconfirmed by any 2026-09-06
  report** — per instructions, only backlog items a 2026-09-06 report
  re-confirmed as open were filed. This excludes: static-demo unconditional
  clip fetch, tower row rhythm at 10Hz, incomplete Ghost.tsx copy pass,
  `theme-color` hardcoded hex (explicitly "accepted, not a bug"), cold-start
  partial roster / retired-cars-not-sunk-to-tail, live `NumberOfLaps`
  off-by-one (general parser risk is covered by #122, but this specific claim
  wasn't reconfirmed today), and the full repo-hygiene/ponytail list
  (`docs/ux-evaluation-2026-07.md`, `knowledge/`, `ingest/explore.py`,
  `scripts/test.ps1`, `web/.gitignore`, dead `--onair` token,
  `useLapHistory`/`useGapHistory` passthroughs, duplicated `TEAM_MAP`,
  hand-rolled max/min in `hist.go`, `Msg` type gymnastics, duplicated
  normalisation math, four copy-pasted message-handling blocks in
  `live_signalr.py`) — none of today's 8 reports touched repo hygiene outside
  `repo-review.md`'s docs/README-only scope.
- **`reviews/testing-strategy.md`'s "no coverage threshold" CI gap** — the
  report's own recommendation is "don't add a hard threshold." Not
  actionable as a fix; not filed.
- **`reviews/grill-open-questions.md` #1** (whether "clip header" needs a
  `CONTEXT.md` glossary entry) — resolved in the report itself as "leave it
  out" (private implementation detail, not a cross-layer concept). No open
  item to file.
- **Trivia folded into related issues rather than filed standalone**:
  `ui-guidelines.md` M2 (hardcoded `width: 120` on the scrub slider) folded
  into #107; `ui-guidelines.md` L1 (dead `var(--amber, orange)` CSS fallback)
  folded into #105; accessibility.md m1 (`aria-hidden` on corner `<text>`)
  folded into #99; security.md New-Info (`.env.example` note on the loopback
  bypass) folded into #101.
