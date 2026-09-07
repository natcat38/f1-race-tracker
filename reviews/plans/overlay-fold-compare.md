# Plan — fold COMPARE into OVERLAY

**Status:** proposed, awaiting owner approval. Read-only research; no code changed.

**Verdict up front**

| Scenario | Today | Gap |
|---|---|---|
| (a) same driver, same circuit, two years — VER Monza 2024 vs 2023 | **Works** — this is literally what `#ghost` does | Hardwired: no year/session picker, no A/B source concept, cross-year outline mismatch |
| (b) same circuit + year, two drivers — VER vs LEC Monza 2024 | **Not in the UI** — but **all the data is already there**, in a single lane's snapshot | Pure frontend work: pick two driver keys out of one `lapTrace` map instead of one key out of two maps |

Scenario (b) needs **no ingest, no gateway, no compose change**. That is the load-bearing fact in this plan.

---

## 1. Current state (evidence)

**The data.** `ingest/record.py:285-312` bakes, per clip, a `lapTrace` for **every** driver with an accurate lap — `lap_traces[inum] = build_lap_trace(...)` (`ingest/ghost.py:9`). A trace is cumulative ms at each track-outline index, monotonic, `trace[0] == 0`. It rides the snapshot: `internal/model/model.go:88` (`LapTrace map[int][]int`), parsed at `internal/feed/replay/play.go:21,97`, landing in the frontend at `web/src/state/race.ts:35`.

So **one clip already contains every driver's fastest lap on a shared outline.** A same-year, two-driver delta is a subtraction over data one socket already delivers.

**The overlay.** `web/src/components/Ghost.tsx`:
- `:19-20` — sessions are module constants: `THIS = {session:'compare-monza-2024', year:'2024'}`, `LAST = {…2023}`. No picker, no props, no hash params.
- `:50-51` — two `connectRace` calls, one per compare lane.
- `:53-64` — `commonDrivers(thisYear.lapTrace, lastYear.lapTrace)`, then **one** `resolvedSelected` indexes both maps. The single-driver assumption lives in exactly these two lines.
- `:132-135` — `deltaSeries(traceThis, traceLast)` (`web/src/state/ghost.ts:9`) is a plain element-wise subtraction of two `number[]`. **It does not care where the two traces came from.**
- `:121,149-150` — both markers are drawn on `thisYear.track`; the ghost's index is clamped into this-year's outline. Cross-year that is an approximation (the two clips are normalised independently — `reviews/ui-ux.md` M6, "two visibly different track outlines"). Same-year it is exact.
- `:27-41` — the whole route is stubbed out in the static Pages demo ("not in this demo") because it needs two gateway lanes.

**The compare view.** `web/src/components/Compare.tsx:14-17` fixes the same two sessions; `Lane` (`:19-40`) is `Map` + `Standings`, one socket each, no shared clock, no delta. `Standings.tsx` is imported by Compare and nothing else. Both reviews condemn it: `reviews/ui-ux.md` M6 "COMPARE doesn't compare" (no shared time reference, no delta, no driver/year selection, no path into OVERLAY, mismatched outlines) and `reviews/frontend-design.md` item 9 (a second visual grammar for standings; "the view's own premise isn't rendered"). Item 10 says OVERLAY buries its headline delta in the controls bar.

**Plumbing.** `docker-compose.yml` `compare-2023` / `compare-2024` publish `compare-monza-2023/2024` with `PHASE_WALLCLOCK: 1`; `internal/app/gateway.go:22` allowlists exactly those two keys for `/ws?session=`, overridable via `ALLOWED_SESSIONS` (`internal/config/config.go:53`). Nav: `StatusRail.tsx:14-18` (BOARD / COMPARE / OVERLAY), hash-routed at `App.tsx:150-152`. Docs: `CONTEXT.md` "Compare" (~:104) and "Ghost overlay" (~:220) define the compare-vs-overlay line; `docs/adr/0004` records baked traces plus frontend subtraction; `README.md:43-45,132-136` documents the compare lanes.

**Static demo constraint.** `cmd/bake-static` bakes **one** clip (`monza-2024-race.jsonl`) into NDJSON replayed client-side (`web/src/realtime/staticReplay.ts:9`). That snapshot carries the full `lapTrace` map — so the Pages demo **can** run scenario (b) end to end (VER vs LEC, Monza 2024), and cannot run scenario (a) without baking a second clip. Today it runs neither.

---

## 2. Gap analysis

**(a) cross-year, one driver — works; needs generalising, not building.**
Missing: source-selection UI (which circuit, which two years), a session-to-year mapping that isn't two module constants, and honesty about the outline mismatch. Optional quality fix: normalise both outlines to a shared bounding box (or keep using lane A's outline and say so — which is what the code silently does today).

**(b) same-year, two drivers — UI only.**
Needed: let each side address a `(session, driver)` pair instead of `(fixed session pair, one driver)`. Concretely, replace the two lookups at `Ghost.tsx:63-64` with `laneA.lapTrace[driverA]` / `laneB.lapTrace[driverB]`, where lane B may be the *same* lane as A. When both sides name one session, open **one** socket. Everything downstream — `deltaSeries`, `indexAtTime`, the delta bar, the scrubber, the two markers — is already agnostic. Colouring must move from one team colour for both markers (`Ghost.tsx:142-144`) to per-side colours, and the copy from "2024 vs 2023" to a computed pair label.

---

## 3. Proposed design

**Tabs become BOARD / OVERLAY / SETTINGS.** `#compare` redirects to `#ghost`.

**One source model.** Each side is `{ session, driver }`:

    Side A   [ Monza 2024 v ]  [ VER v ]     <- solid
    Side B   [ Monza 2024 v ]  [ LEC v ]     <- ghost (dashed)
                 delta readout - Play/Pause - scrubber

Sessions come from a small static catalogue (`{key, circuit, year, label}`) mirroring the gateway allowlist, so adding a circuit is one array entry plus a compose lane. Driver options are the keys of that side's `lapTrace`. Preset chips ("Same driver, two years" / "Two drivers, one race") set both sides in one click. State is reflected in the hash (`#ghost?a=compare-monza-2024:1&b=compare-monza-2023:1`) so a comparison is linkable — which also subsumes M6's "no link into OVERLAY".

**Socket sharing.** A small `useLane(session)` hook memoised by key, so A == B opens one connection. This is what makes the static demo work: under `STATIC_DEMO` the catalogue holds exactly one entry (Monza 2024, the baked clip) backed by `connectStaticReplay`, and the route stops being a "not in this demo" card and becomes a real, fully client-side driver-vs-driver overlay. Cross-year stays gated with an honest note.

**Side-by-side maps: drop them.** The two-map view is precisely what the reviews say fails (independent outlines, no shared clock, no delta). One map with two markers is strictly more comparative. If the owner wants side-by-side kept, do it as a **sub-mode toggle inside OVERLAY** ("Overlay | Side by side") reusing the same source pickers — but that keeps `Standings.tsx` and the alternate grammar alive (frontend-design item 9), so the recommendation is to drop it.

**Take frontend-design item 10 along** (cheap, same file): promote the delta to a display-scale readout above the bar, add a zero rule and S1/S2/S3 ticks.

**Deleted:** `web/src/components/Compare.tsx`, `web/src/components/Standings.tsx` + `Standings.render.test.tsx`, the COMPARE tab entry (`StatusRail.tsx:16`), the `#compare` branch (`App.tsx:150`), `.compare-lanes` / `.lane-body` CSS, Compare's static-demo notice.

**Kept:** both compose lanes, both gateway sessions, `ALLOWED_SESSIONS`, ADR-0004's baked-trace contract. They are the *sources* for scenario (a); the "compare" naming on them is now historical, so either leave the keys (zero risk) or rename to `monza-2023`/`monza-2024` in a separate follow-up (compose, gateway defaults, Go tests, README — not worth bundling here).

**Docs:** `CONTEXT.md` — delete the "Compare" section, rewrite "Ghost overlay" as *the* comparison view spanning both axes (year and driver), and fix the usage notes that now point at a deleted term (`:107-108`, `:202`, `:224`); note that `compare-*` lane keys are legacy identifiers. `README.md:43-45,132-136` — one OVERLAY section; drop or reshoot the compare screenshot. **New `docs/adr/0009-overlay-absorbs-compare.md`** (0008 is the highest today): decision — one computed-delta view over `(session, driver)` pairs; consequence — the same-lane case needs no backend and unlocks the Pages demo; ADR-0004 stays valid and is referenced, not superseded.

---

## 4. Test plan

- `web/src/state/ghost.test.ts` — extend: `deltaSeries` across two drivers from one trace map; a per-side driver-options helper; `ghostSkeletonCopy` gains a same-lane case ("pick two different drivers").
- New `Ghost.render.test.tsx` — renders from a seeded two-driver snapshot; switching side B's driver changes the delta; A == B yields a zero delta and a clear empty state; picker disabled states.
- `staticDemoGating.render.test.tsx` — flip the expectation: OVERLAY renders live under `STATIC_DEMO`; cross-year selection stays gated.
- Hash-param parse/serialise round-trip test.
- Go: `internal/app/compare_test.go` passes untouched (per-session fan-out is unchanged); keep it, rename only if the lane keys are ever renamed.
- Manual: `docker compose up` and exercise both scenarios; build the static bundle and confirm the Pages overlay animates.

## 5. Risks

- **Cross-year outline mismatch becomes a first-class feature**, not a footnote. Mitigate with shared-bounds normalisation or an explicit "positions approximate across seasons" note (consistent with ADR-0002/0004's best-effort stance).
- **Reference-lap semantics.** Each trace is that driver's *fastest accurate lap of the session* — VER vs LEC compares two different moments of the race, not a wheel-to-wheel lap. The UI must say so or it is quietly misleading.
- **Sparse traces.** A driver with no accurate lap has no trace; each picker must list only drivers present in that lane's `lapTrace`.
- **Losing a demo surface.** COMPARE's "two races at once" README screenshot goes away. The single-map two-marker overlay is a better shot, but it needs reshooting.
- **Scope creep** into the delta-bar redesign; keep item 10 in its own phase.

## 6. Effort (phases)

1. **Source model + same-lane delta** — `(session, driver)` pairs, `useLane` memo, per-side colours, computed labels. Unlocks scenario (b). ~M (half a day).
2. **Session picker + hash state** — catalogue, presets, linkable URLs. Generalises scenario (a). ~S/M.
3. **Delete Compare** — component, Standings, tab, route, CSS, tests. ~S.
4. **Static demo unlock** — single-entry catalogue, gating flip, tests. ~S.
5. **Docs** — CONTEXT.md, ADR-0009, README. ~S.
6. *(optional)* **Delta-bar polish** — display readout, zero rule, sector ticks (frontend-design item 10). ~S.

Phases 1–5 are each about one PR. Order 1 → 2 → 3; 4–6 are independent.

## 7. Recommendation

**Do it.** OVERLAY already computes the thing COMPARE only gestured at, and scenario (b) — the more useful of the two for a race fan — turns out to be nearly free: every driver's lap trace is already in every snapshot, so VER-vs-LEC is the same subtraction against one socket instead of two. Folding COMPARE in removes the view both reviews call unfinished, deletes the app's second standings grammar, cuts the tab set to three honest views, and — the sweetener — makes OVERLAY the first analytics view that actually *works* on the public Pages demo instead of showing a "not in this demo" card. Phases 1–3 deliver the whole product change; keep the `compare-*` lane keys and ADR-0004 exactly as they are.

## 8. Alternatives

- **A. Keep COMPARE, give it a shared-lap delta** (ui-ux M6's cheapest fix): shared lap cursor, shared outline normalisation, a per-position delta column, rows linking into OVERLAY. Preserves the side-by-side screenshot and the documented compare/overlay distinction — but leaves four views, two standings grammars, and two sockets doing what one can, and still does not serve scenario (b). Similar effort to phases 1–3 for less product.
- **B. Fold, but keep side-by-side as an OVERLAY sub-mode.** Same source pickers, a toggle between "Overlay" and "Side by side". Lowest-regret if the two-map visual is valued; costs keeping `Standings.tsx` and the coherence break, plus one more mode to test.
- **C. Minimal: leave COMPARE alone, just add driver B to OVERLAY.** Phase 1 only — one afternoon, unlocks scenario (b) and the static demo, defers every deletion and doc change. Good if appetite is small, but the tab set stays at four and the review findings stay open.
