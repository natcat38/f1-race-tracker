# Polish & Immersion Roadmap — research synthesis and phased plan

> **For agentic workers:** This is a **roadmap**, not a task-level plan. It spans
> multiple independent subsystems, so (per the writing-plans scope check) each
> workstream below gets its **own** design/plan pass at execution time:
> use `superpowers:brainstorming` → `superpowers:writing-plans` per workstream,
> then `superpowers:subagent-driven-development` to implement. Do **not** try to
> execute this document directly as one plan.

**Goal:** Make the tracker feel immersive ("you're at the race") and give users
race-engineer-grade insight into car performance, while paying down the code and
design debt that keeps it from reading as a polished portfolio piece — plus a
**beta, buildable-now-verifiable-later** F1TV-authenticated live-timing path.

**Date / provenance:** 2026-08-19. Synthesized from four research passes:
(a) deep-dive of `IAmTomShaw/f1-race-replay` (the visual/immersion reference),
(b) deep-dive of `IAmTomShaw/open-pit-wall` (turned out to be a headless
FastF1→WebSocket replay backend, no UI), (c) the 2025–2026 F1 data-source
landscape (FastF1 auth, OpenF1, community apps), and (d) a full audit of this
repo's frontend/Go/Python state.

---

## 1. Where the app stands (audit summary)

Phases 1–5 are shipped: track map, timing tower, telemetry panel (with two-car
compare and sparklines), team-radio comms (streamed per ADR-0003), race control,
weather, stint timeline, `#compare`, `#ghost` (which **already has**
pause + scrub), static GH-Pages demo, staleness chip (the July P1 is fixed),
keyboard-accessible tower rows.

**Strengths:** disciplined design system (`web/src/styles/tokens.css` +
`components.css`, broadcast-instrument aesthetic, self-hosted Chakra Petch /
Martian Mono); pure, well-tested reducers (`web/src/state/*`); Go layer clean
with per-file tests; Python ingest split into fastf1-free testable helpers.

**Debts (verified in source):**

- **Colour sprawl:** at least four greens (`#3bb273`, `#4caf50`, …) and three
  reds (`#e1342e`, `#ff5252`, `--onair`) live as inline hex in `Map.tsx`,
  `Ghost.tsx`, `TelemetryPanel.tsx`, `TimingTower.tsx`, `RaceControl.tsx`,
  `Comms.tsx`, `StintChart.tsx` — none reconciled with `tokens.css`.
- **~64 inline `style={{}}` blocks** bypass the panel/chip CSS vocabulary.
- **Track map is a bare outline** — no start/finish line, DRS zones, corner
  numbers, sector boundaries, or safety-car marker.
- **No playback control on the main board** (Ghost has pause/scrub; the replay
  lane always runs at native pace, no seek).
- **Zero component-render tests** (all 7 web test files are pure-logic; no
  `@testing-library/react` in `package.json`).
- **`ingest/live_signalr.py` is unverified against a real feed** and hangs
  silently on the new F1TV auth requirement (see §4, WS5) — undocumented in
  repo.
- Open July-UX items: `#compare` carries no pace data / naming vs `#ghost`
  ambiguous; bogus cold-start interval (`+81.014`) baked by
  `ingest/record.py`'s gap pass; raw `[object Event]` console error on
  reconnect. (Cross-linking between compare/ghost may already be fixed by the
  shared `TABS` array in `StatusRail.tsx` — executor must verify live.)

---

## 2. What the research found (facts the plan relies on)

### f1-race-replay (Python/Arcade desktop app, 6.2k★) — the immersion playbook
Feature ideas with proven implementations to translate (not port): seekable
race timeline with event markers (DNF/flags/SC/VSC, hover tooltips,
click-to-seek — `src/ui_components.py:1236-1646`); discrete speed ladder
0.1×–256× + hold-to-scrub arrows; DRS zones drawn from a reference lap's `DRS`
telemetry (`value in [10,12,14]`); checkered start/finish strip; simulated
safety car placed ~500 m ahead of the leader on the track polyline, gated on
FastF1 track-status code `4`; Bayesian tyre-degradation model feeding a
tyre-health % (leaderboard icon brightness). Design tricks: halo-behind-dot car
markers with 1 px dark outline; alternating label offsets (45/75 px by index)
to cut overlap; tyre icon doubling as a health gauge; colour reserved solely
for driver identity. **They have no corner numbers either** — that's our
differentiator via FastF1 `circuit_info`.

### open-pit-wall — headless; almost nothing to copy
No UI at all. Two reusable ideas: its computed-but-never-broadcast safety-car
position simulation (prior art for WS2), and its shared replay clock with
play/pause/seek/speed protocol (prior art for WS3). Its "gaps" are
distance-derived and *worse* than ours — nothing to adopt there.

### Data landscape (2025–2026)
- **F1TV auth for live timing:** FastF1 3.8.x's `fastf1/internals/f1auth.py`
  handles it — cached JWT at a `platformdirs` location (`f1auth.json`),
  verified against `https://api.formula1.com/static/jwks.json`; on cache miss
  it spins a localhost server and the user completes login via the
  **f1login.fastf1.dev browser extension** (the only maintained implementation
  of F1's login handshake — reCAPTCHA/Akamai blocks scripted logins). **Reuse
  it, never reinvent.** `no_auth=True` is broken in fastf1 3.8.3 (passes
  `access_token_factory=None` → `TypeError`).
- **Tier:** **F1TV Access** (~$3/mo, cheapest tier) advertises live lap timing,
  sector telemetry, tyre wear, live position maps — i.e. the SignalR timing
  feed. Live **team-radio audio** is likely bundled with the broadcast product
  (Pro/Premium) but *may* ride the SignalR `TeamRadio` topic under Access —
  unconfirmed until someone authenticates. **However**, the live topic's
  payload shape can be assumed with high confidence: the
  `livetiming.formula1.com/static/` files are recordings of the live SignalR
  feed (that is how FastF1 replay works), so live `TeamRadio` payloads ≡
  archived `TeamRadio.jsonStream` entries (`Utc`, `RacingNumber`, relative
  mp3 `Path`). WS5 builds against that schema and keeps a raw-capture logger
  as the verification net.
- **Historical team radio stays auth-free today** via
  `https://livetiming.formula1.com/static/{year}/{event}/{session}/TeamRadio.jsonStream`
  → per-clip `.mp3` under `.../TeamRadio/` (what ADR-0003 already streams), and
  via OpenF1 `team_radio.recording_url`. Treat as "reachable, not sanctioned" —
  keep graceful degradation. Note: OpenF1 reports radio coverage collapsed for
  most 2026 events.
- **OpenF1** (openf1.org): free tier is now **historical-only** (2023+),
  3 req/s / 30 req/min; live needs the €9.90/mo sponsor tier (REST/MQTT/WS,
  ~3 s delay). Verdict: **complement, not replacement** — valuable for
  `overtakes` (not in FastF1), `session_result`, `starting_grid`, and
  cross-checks. For live, F1TV Access + SignalR is cheaper and authoritative.
- **FastF1 unused capabilities:** `session.circuit_info` → `corners`
  (X/Y/Number/Letter/Angle/Distance) and `marshal_sectors`;
  `session.track_status` (SC/VSC/red windows); `Laps.Position` per lap
  (position-change chart); `SpeedI1/I2/FL/ST` speed traps; mini-sector
  `segments_sector_*` colouring; `TyreLife`/`Compound`/`FreshTyre`/`Stint`
  (everything a pace-vs-tyre-age fit needs); `session.results`
  (Grid/Status/ClassifiedPosition). **Hard limit:** no public ERS/fuel data
  anywhere — never promise it.
- **Community bar:** f1-dash (dev ended; open-source) did mini-sectors + radio
  transcription; F1's own AWS "Strategy Insight" broadcast graphic (2026) is a
  battle/pit-strategy forecast — we hold the raw ingredients (gap trend + pace
  delta) for a simple version.

### Legal posture (hardened 2025–2026)
F1's guidelines now bar "substantial" timing-data reproduction, scraping, and
AI/data-mining use without licence; audio re-serving is the most clearly
restricted. Our shape — non-commercial, self-hosted, no ads, streamed-not-
stored audio, graceful degradation — is the defensible fan-project posture.
**Keep it**: no hosted multi-tenant version, no monetization framing, and the
existing `docs/F1_Race_Tracker_Product_Scope.md` §7 "no paid data tiers" line
must be **amended, not silently violated** by WS5 (reword to: free data for
everything shipped; the *user's own* F1TV subscription may unlock the beta
live path).

---

## 3. Global constraints (every workstream inherits these)

- **ADR-0002:** new per-frame fields must pass the frame-size gate; no new wire
  *shape* without revisiting the ADR.
- **ADR-0003:** team-radio audio is streamed from F1's CDN at play time, never
  downloaded or committed.
- **ADR-0004:** ghost/compare computation stays frontend-only; no new gateway
  correlation logic.
- **Scope:** no required hosting; `docker-compose up` remains the full demo;
  static GH-Pages demo (ADR-0006) must keep working — any new frame fields
  need the bake path (`cmd/bake-static`) updated too.
- **Build gotchas (docs/../memory, verified):** `npm run build` deletes
  `web/dist/.gitkeep` — restore before commit; `bench/results.csv|png` are
  canonical — never overwrite with partial runs; lint gate is
  `npm run lint -- --max-warnings 0` with strict react-hooks rules (no ref
  writes during render; no sync setState in effect bodies); local Go tests run
  **without** `-race` (no cgo on this machine) — CI covers `-race`.
- **Vocabulary:** use `CONTEXT.md` terms exactly (lane/writer/seam/gateway/
  frame/Rev/compare-vs-overlay…). New concepts added by these workstreams
  (e.g. "race timeline", "track furniture", "tyre health") must be added to
  `CONTEXT.md` when introduced.
- **Design tokens:** all new UI colours come from `tokens.css` tokens — WS1
  establishes `--good`/`--bad` (names negotiable) and everything later uses
  them. No new inline hex.
- **Commits:** end messages with the project's Co-Authored-By convention;
  PR-per-workstream (repo history shows PR-numbered commits).

---

## 4. Workstreams (priority order)

### WS1 — Design-system consolidation (do first; everything later builds on it)
**Why:** the one debt a reviewer notices in 30 seconds — mismatched
greens/reds between tower, sparklines, and delta bar undermines an otherwise
disciplined system.
**What:**
1. Add semantic colour tokens to `tokens.css` (suggest `--good`, `--bad`,
   `--caution`; keep `--onair` for LIVE only) and replace every ad-hoc hex in
   `Map.tsx`, `Ghost.tsx`, `TelemetryPanel.tsx`, `TimingTower.tsx`,
   `RaceControl.tsx`, `Comms.tsx`, `StintChart.tsx`.
2. Migrate the ~64 inline `style={{}}` blocks into `components.css` classes
   following the existing `.panel`/`.chip`/`.rail` vocabulary (Comms,
   RaceControl, Standings, TelemetryPanel, StintChart, Ghost, SourceToggle).
3. State the single-dark-theme choice explicitly in README (intentional
   broadcast aesthetic, not an oversight).
4. Colour-blind fallbacks: non-colour signal for tyre compound (letter already
   exists — verify), sector best/personal-best (add glyph or underline), comms
   driver identity. `aria-label` the two bare `<select>`s
   (`TelemetryPanel.tsx:99`, `Ghost.tsx:166`).
**Effort:** S–M. Pure frontend; no wire changes. **Test:** extend existing
pure-logic tests where helpers change; visual QA via `npm run dev`; lint gate.

### WS2 — Track furniture (the biggest immersion jump)
**Why:** the map is the hero surface and it's a bare outline; every reference
app that feels "broadcast" earns it here. Corner numbers exceed even
f1-race-replay.
**What (in order of ROI):**
1. **Checkered start/finish strip** across the track width at s=0 (pure
   cosmetic, trivial once track normals exist).
2. **DRS zones** highlighted on the outline: bake zone start/end distances at
   record time (`ingest/record.py`) by scanning one clean reference lap's
   `DRS` column for `value in [10,12,14]` transitions; ride the **snapshot**
   (static per circuit, like the track outline — no per-frame cost, ADR-0002
   safe).
3. **Corner numbers** from `session.circuit_info().corners` (X/Y/Number/
   Letter), baked the same way; small labels offset outward from the outline.
4. **Safety-car marker**: gate on track-status code 4 windows
   (`session.track_status`, baked as status windows on the snapshot), animate
   a marker ~500 m ahead of the leader along the outline with
   deploy/on-track/return phases. Prior art: open-pit-wall
   `data_loader._compute_safety_car_positions`, f1-race-replay `f1_data.py`.
5. **Car-marker legibility:** halo-behind-dot + 1 px dark outline; alternating
   label offsets (45/75 px pattern) to cut overlap.
**Wire note:** items 2–4 add snapshot-header data (like `trackOutline`), so
Python bake + Go model + contract test (`check_live_contract.py` /
`test(contract)`) + `cmd/bake-static` all need the same fields. **Effort:** M–L.

### WS3 — Replay control: pause/scrub/speed + race timeline
**Why:** turns "a clip that plays at you" into "a race you explore" — the
single biggest interaction upgrade, and the July eval's remaining structural
ask.
**What:**
1. Main-board **pause / scrub / speed ladder** (suggest 0.5×/1×/2×/4×; YAGNI
   on 256×). Architectural decision to settle in this workstream's design
   pass: control the **replay writer** (Go `internal/feed/replay` — affects
   all viewers of the lane, matches the operator model) vs a client-side
   buffered mode. Default recommendation: writer-side controls exposed via a
   small gateway control endpoint, because the lane concept (one writer, many
   readers) already implies shared playback state — and the static demo
   (`web/src/realtime/staticReplay.ts`) gets the same controls client-side
   for free since it already paces frames itself.
2. **Race timeline bar** with event markers: bake an events list at record
   time (flag/SC/VSC windows from `track_status`, DNFs by set-diff of cars
   present, pit stops from existing stint data) onto the snapshot; render a
   seekable bar with hover tooltips + click-to-seek; inline swatch legend.
3. **Rewind-aware panels:** race-control feed and comms history must clear and
   re-accumulate when the clock goes backwards (f1-race-replay's hash+reset
   pattern); Rev semantics for scrubbing need care — a seek is a new snapshot
   publish, not a Rev rollback (Rev must stay monotonic per CONTEXT.md).
**Effort:** L (the writer-control seam is the hard part). **This is the
workstream most in need of its own design spec before planning.**

### WS4 — Race-engineer analytics
**Why:** "what a race engineer would need" — all from data already ingested or
one bake-time pass away.
**What (each item independently shippable, in ROI order):**
1. **Sector-delta magnitude chip** (July eval): show *how far* off own/session
   best, not just tied/not-tied — UI-only over existing fields.
2. **Position-change chart** (per-driver line across laps, `Laps.Position`
   baked once) — broadcast staple, cheap.
3. **Mini-sector heat strip** in the tower (`segments_sector_*` per lap) —
   needs a small baked per-lap field; check ADR-0002 gate.
4. **Speed-trap widget** (`SpeedI1/I2/FL/ST` per lap, baked).
5. **Tyre health / degradation:** start with the lazy version — linear
   pace-vs-tyre-age fit per compound from the session's own laps at bake time,
   rendered as a health % bar (tyre icon brightness, f1-race-replay style).
   The full Bayesian state-space model is explicitly **later-if-ever**
   (`ponytail:` ceiling comment in code).
6. **Battle forecast chip:** "P5 catching P4 at 0.4 s/lap → in DRS range in 3
   laps" — rolling gap-trend regression client-side from data the tower
   already has; mirrors F1's 2026 AWS Strategy Insight graphic. Show on tower
   rows and optionally as a map highlight between the two cars.
7. **`#compare` fix** (July P2): give `Standings.tsx` a slim real timing
   readout (gap/interval — uncomputed, so CONTEXT.md's compare/overlay line
   holds) and relabel links to disambiguate from `#ghost`
   ("Ghost overlay — compare lap pace"). Verify whether `TABS` already
   cross-links the routes before touching that part.
**Effort:** items 1–2 S; 3–6 M each; 7 S.

### WS5 — Live-timing + live-radio **beta**, fully built (F1TV-gated; verified when paid)
**Why:** the user wants the whole feature built now — including an in-app
"link your F1TV subscription" page — accepting that the last mile can't be
verified until they hold a subscription. The current live path hangs silently
on auth with zero documentation — worst possible state.

**ADR set (confirmed by the user, 2026-08-20):**
- **New ADR-0007 — "Beta live timing: operator-linked F1TV auth, delegated to
  FastF1."** Auth is handled entirely by fastf1's `f1auth` (its token cache
  at `f1auth.json`, its f1login.fastf1.dev browser-extension login); the app
  never builds a credential store and never sees a password. Python ingest
  owns auth and publishes an auth-status key over the seam; the gateway stays
  read-only and serves it. Records the `LIVE_TIMING_MODE=beta` gate and the
  fixed host-mapped port the login dance needs (the extension POSTs the token
  to localhost on the host, so the ingest container must expose one fixed
  port). Explicitly does NOT reopen the "no user accounts" scope line — one
  operator links their own subscription; there are no accounts.
- **New ADR-0008 — "Live team radio rides frames; replay radio stays
  snapshot-fixed."** Live radio refs attach sparsely to frames and accumulate
  on the snapshot (mirroring race control's rolling pattern); baked replay
  clips keep the existing fixed-on-snapshot delivery. Records the schema
  assumption (live SignalR `TeamRadio` topic ≡ archived `TeamRadio.jsonStream`
  entries — static files are recordings of the live feed) and the raw-capture
  logger as its verification net. The new sparse frame field goes through
  ADR-0002's existing frame-size gate (that ADR is unchanged).
- **Amend ADR-0003** (streamed-not-committed): extend to live-session clips —
  same streaming-from-CDN rule, same URL allowlist, plus the explicitly
  unverified assumption that clip mp3s are fetchable mid-session.
- Untouched: ADR-0001, ADR-0002, ADR-0004.

**What:**
1. **Amend scope + context first:** `docs/F1_Race_Tracker_Product_Scope.md`
   §7 — "no paid data tiers" becomes "free data for all shipped features; an
   optional **beta** live path can use the operator's own F1TV subscription."
   CONTEXT.md gains the radio delivery split (ADR-0008) and the auth "linked"
   state vocabulary. Write ADR-0007/0008 and the ADR-0003 amendment.
2. **Reuse fastf1's auth, don't rebuild:** wire
   `fastf1.internals.f1auth.get_auth_token` into `ingest/live_signalr.py`;
   surface the login URL **unbuffered/foreground** (the July hang was stdout
   buffering swallowing the URL); publish auth status (unlinked / linking /
   linked+tier+expiry / expired, via `print_auth_status()`-equivalent
   introspection) to a Redis key; fail fast with a clear message when no
   cached token exists instead of hanging.
3. **Settings / "Link F1TV" page** in the React app: shows the auth state
   served by the gateway from the seam; "Link" starts the f1auth dance
   (ingest opens its local auth server on the fixed mapped port, page shows
   the f1login URL + instructions, then polls status to "Linked"); an unlink
   action clears the cached token. No credentials ever touch app code.
4. **Live radio, fully wired:** subscribe the SignalR `TeamRadio` topic,
   parse using the archived-jsonStream schema, resolve relative mp3 paths
   against the session's static base URL, publish refs per ADR-0008, play
   through the existing comms layer. Keep a raw-payload capture logger on
   every authenticated run so the first real session confirms (or corrects)
   the schema in one pass. Historical radio stays the primary, always-free
   source.
5. **Verification without a subscription:** replay a real past session's
   downloaded capture (timing + `TeamRadio.jsonStream`) through the existing
   `CAPTURE_FILE` path as an end-to-end-minus-auth test — real data flowing
   ingest → seam → gateway → comms UI. Unit-test the auth-status state
   machine with a mocked status publisher. Likely free win to verify early:
   an F1 *account* is free (only the subscription is paid), so the entire
   link flow may be testable today with a free account — confirm during
   implementation.
6. **Honest residue, degraded gracefully:** three things stay unverified
   until paid — the authenticated handshake, whether Access tier (vs Pro)
   carries the live `TeamRadio` topic, and mid-session mp3 availability.
   Each gets an explicit UI state ("Linked — awaiting live session", "Radio
   unavailable on your tier") rather than a crash; README/runbook section
   "Beta: live timing with your F1TV subscription" states plainly what is
   unverified. Integration test skipped unless `F1TV_TEST_ACCOUNT=1`. Also
   verify the docstring-flagged `TimingData`/`TimingAppData` field
   assumptions against the first real capture.
7. Document the `docker-compose.override.yml` Redis-port pattern for
   host-side live capture (don't change the tracked compose file).
**Effort:** L. The deliverable is the **complete feature** — link page, live
radio pipeline, graceful degradation — with only the paid last mile pending.

### WS6 — Small fixes & code health (fold into other PRs where natural)
1. Suppress the bogus cold-start interval in `ingest/record.py`'s gap pass
   (require valid reference laps for both cars, matching the `—` convention).
2. Reconnect error: log a short string, not the raw `Event`
   (`web/src/realtime/socket.ts`).
3. Add `@testing-library/react` + jsdom render tests for Map, Comms, Ghost,
   TelemetryPanel, TimingTower (smoke + interaction, not snapshot spam).
4. `ingest/test_record.py` for the recorder's orchestration seams that are
   pure enough to test (gap/interval derivation, stint baking) — extract-then-
   test where needed, consistent with the existing helper-module pattern.

### Explicitly skipped (YAGNI, with reasons)
- **Rain-radar overlay** — needs an external weather-radar API; weather chip
  already covers conditions. Revisit only if live mode lands.
- **Radio AI transcription** — F1's AI/data-mining ToS clause + local STT
  weight; park it.
- **Full Bayesian tyre model** — linear fit first (WS4.5); upgrade path noted
  in code.
- **Driver headshots** — licensing murk, low insight value; team colours
  already carry identity.
- **ERS/fuel displays** — no public data exists; do not attempt proxies.
- **OpenF1 sponsor tier / MQTT live** — F1TV Access path (WS5) is cheaper and
  authoritative; OpenF1 stays a free historical complement (its `overtakes`
  endpoint may feed the WS3 timeline as an optional enrichment — bake-time
  only, free tier).

---

## 5. Suggested execution order

WS1 → WS2 → WS3 → WS4 (items in listed order, each its own PR) → WS5 → WS6
(continuous, fold into neighboring PRs). Rationale: WS1 sets the tokens every
later UI touches; WS2/WS3 are the visible transformation; WS4 rides on both;
WS5 is independent and can interleave whenever; nothing blocks on money —
WS5's paid verification is explicitly deferred.

## 6. Handoff notes for the orchestrating session

- Per workstream: `superpowers:brainstorming` (settle the flagged design
  decisions — especially WS3's writer-vs-client playback seam) → design spec in
  `docs/superpowers/specs/` if the workstream changes the wire contract (WS2,
  WS3, WS4.3–5, WS5) → `superpowers:writing-plans` →
  `superpowers:subagent-driven-development`.
- Keep `CONTEXT.md` and `FILE-MAP.md` current (`python scripts/gen_file_map.py`;
  CI fails if stale). New ADRs: playback control seam (WS3, number TBD at its
  design pass); **ADR-0007** F1TV auth + link page and **ADR-0008** live radio
  on frames, plus the **ADR-0003 amendment** (WS5 — this exact set was
  confirmed by the user on 2026-08-20; write them as specified in WS5, no
  further confirmation needed).
- Issue tracking: `gh` CLI per `docs/agents/issue-tracker.md`; the `to-issues`
  skill can split this roadmap into grabbable issues if the user wants a
  backlog instead of direct execution.
- Before every commit: restore `web/dist/.gitkeep` if deleted, check
  `bench/results.*` untouched, run the lint gate and `go test ./...` (no
  `-race` locally).
