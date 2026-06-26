# F1 Race Tracker — Phase 3: Team-Radio Comms — Design

**Status:** Approved (brainstorming) · **Date:** 2026-06-26 · **Milestone:** Phase 3 (second of two remaining phases; Phase 4 = ghost overlay)

## Context

Phases 1–2 shipped the full pipeline (Python FastF1 ingest → Redis seam → Go gateway WS fan-out → React track map) plus the pit-wall timing tower and telemetry. Phase 3 adds a **team-radio layer**: the driver↔engineer audio, played alongside the race as a toggleable layer on the **same pipeline**. No new architecture; ADR-0001 (single gateway) and ADR-0002 (timing fields rebroadcast) are both unaffected.

This is the **second change to the event model / contract**. Phase 3 introduces two things earlier phases never had: **audio**, and **events tied to a moment in the race**. The contract already has `RaceControlMessage` + `Messages []…` on `Snapshot`/`Frame`, but the recorder never populates them — so radio is the first event-timeline to actually ride a clip.

**Data source is verified real.** `fastf1._api.fetch_page(api_path, 'team_radio')` returns a `jsonStream` of captures: `{Utc, RacingNumber, Path}` where `Path` is `TeamRadio/<file>.mp3` under the session's `api_path`. Monza 2024 race has **65 captures**. The full URL `https://livetiming.formula1.com/static/.../TeamRadio/<file>.mp3` serves `audio/mpeg`, 200 OK, `accept-ranges: bytes` — and **plays cross-origin in an `<audio>` element without CORS** (no `Access-Control-Allow-Origin` header is present, but plain media playback doesn't need one; only `fetch()`/Web-Audio sample-reading would be blocked, and we do neither).

## Goal

A **toggleable radio layer** over the existing board: when on, it **auto-plays** each radio message as the replay clock reaches its moment, with a now-playing banner (driver attribution) and a short replayable history. Audio is **streamed straight from F1's public URL at play time** — nothing committed to the repo, nothing downloaded to disk. The committed **replay** clips are the demo target; the layer keeps the track map + timing tower primary.

## Scope

**In scope**
- New `RadioMessage` type + `Radio []RadioMessage` on **`Snapshot` only** (`internal/model/model.go`); Python↔Go contract parity updated.
- Recorder (`ingest/record.py`): fetch `team_radio`, map `Utc`→session-time via `t0_date`, keep in-window captures, bake a radio timeline into the **clip header** (`[{timeMs, driverNum, clip}]`, `clip` = full https URL).
- **Widen the recorder window** 3600→3300s (2.5→7.5 min) for radio density; re-bake `monza-2024-race.jsonl` (default replay) and `monza-2023-race.jsonl` (compare phase). Bake radio into `silverstone-2024-race.jsonl` (live lane) too — free from the same recorder change.
- Gateway: thread the `Radio` field header→snapshot. No new routes, no proxy.
- Frontend: a radio hook that schedules auto-play against the frame clock (FIFO queue + staleness skip + loop reset), an `<audio>` element, a toggleable now-playing banner + small history, and a layer toggle alongside the existing toggles.

**Out of scope (explicitly deferred / not built — ponytail)**
- **Committing audio, any download/cache dir, Git LFS.** Streamed from F1's URL; nothing on disk.
- **A gateway proxy for the audio.** Back-pocket fallback only if F1 ever expires/locks the URLs (would be a tiny passthrough route + the proxy URL in `clip`). Not built now.
- **Audio library, Web-Audio visualiser, waveform.** Native `<audio>` only.
- **Transcripts.** The feed has none; not synthesised.
- **Per-frame radio plumbing.** Radio is a fixed sparse timeline → snapshot-only, like `Track`. No `Frame.Radio`.
- **Radio in the compare view.** 2023 is re-baked only to keep window phase with 2024; the compare view does not render the layer.
- **The genuine SignalR `--live` path.** Unchanged and out of scope, as in Phase 2.

## Design decisions (from brainstorming)

1. **Stream from F1's URL; metadata-only in the clip.** The clip header carries `{timeMs, driverNum, clip-URL}` (tiny text). At play time the browser streams the bytes from CloudFront via a plain `<audio src>`. Verified: cross-origin playback works without CORS. This resolves both the "audio source" and "binary asset" questions at once and is fully in the spirit of the no-hosting rule — we host nothing and commit nothing.
   - **Known ceiling (ponytail):** depends on F1 keeping those public URLs live (they're 2024 assets, still served in 2026). If they ever expire or add CORS/referer locks, the upgrade path is a small Go gateway passthrough route serving the bytes (sidesteps CORS, still nothing committed). Named, not built.
2. **`Radio` on `Snapshot` only — not rebroadcast per-frame.** Radio is a finite, sparse timeline for a replay clip; it belongs in the snapshot (the source of truth, healed on reconnect) exactly like `Track []Point` is sent once. No `Frame.Radio`, no ADR-0002 frame-size pressure, no benchmark impact. The FE already tracks the frame clock and schedules playback locally.
   - Contrast with `RaceControlMessage` (which sits on both Snapshot and Frame): that shape anticipated live text flags; radio's fixed-timeline nature makes snapshot-only both correct and lazier. If a true-live radio source is ever added, add `Frame.Radio` then.
3. **Auto-play at each message's moment, with a guarded queue.** One `<audio>` element, FIFO. As the frame `timeMs` passes an unplayed message, enqueue it. Any message more than **~3 s stale** vs the current race clock when it reaches the queue front is **skipped for audio but still added to history** (so a busy spell, or toggling the layer on mid-replay, never lags the audio behind the race). On replay **loop** (clock jumps backward), reset the played-cursor so the timeline replays.
   - **Autoplay policy:** browsers block audio until a user gesture. The **layer toggle is that gesture** (and the user's opt-in). Layer OFF → no auto-play. Toggling ON mid-replay fires only messages from *now* forward; earlier ones appear in history as clickable.
4. **Widen the window to 7.5 min for radio density.** The current 2.5-min mid-race window (3600–3750s) contains **only 1 capture**. Measured alternatives: widen to 7.5 min (3300–3750s) → **~5 captures** during real racing; or move to the closing-laps cluster (~78.7 min) → 4 captures same size; or the post-race burst (132.8 min) → 22 but cars aren't racing (rejected — kills the track-map demo). **Chosen: widen to 7.5 min**, keeping the mid-race action. Cost: `monza-2024-race.jsonl` grows ~7.8 MB → ~23 MB, the loop is 3× longer, and `monza-2023-race.jsonl` must be re-baked to the same window so the compare lanes stay in phase.
5. **Driver attribution derived in the FE.** `RadioMessage` carries only `driverNum`; the FE maps it to code/team/colour via the existing `cars` map it already holds. No redundant `code`/`team` in the contract.

## The contract extension

New type and one `Snapshot` field (`internal/model/model.go`):

```go
type RadioMessage struct {
    TimeMs    int64  `json:"timeMs"`    // session clock at which the radio occurred (within the window)
    DriverNum int    `json:"driverNum"` // FE derives code/team/colour from the cars map
    Clip      string `json:"clip"`      // full https URL to the .mp3 on livetiming.formula1.com
}

// on Snapshot (not Frame):
Radio []RadioMessage `json:"radio,omitempty"`
```

`omitempty`: a clip with no in-window radio simply omits the field; the FE treats absence as an empty timeline (layer toggle shows nothing to play), not an error.

## Recorder (`ingest/record.py`)

- After loading the session (telemetry already loaded for `t0_date`), call `fastf1._api.fetch_page(session.api_path, 'team_radio')`, flatten the `Captures`, and for each: `timeMs = round((Timestamp(Utc, UTC→naive) - t0_date).total_seconds() * 1000)`, keep those with `WINDOW_START_S*1000 <= timeMs < WINDOW_END_S*1000`, build `clip = base_url + api_path + Path`.
- Emit `radio: [{timeMs, driverNum, clip}]` sorted by `timeMs` in the **clip header line** (alongside the existing track/header data).
- Change `WINDOW_START_S` 3600 → 3300 (window now 7.5 min). Re-bake monza-2024, monza-2023 (compare phase), silverstone-2024 (radio comes free).
- The Go replay player reads the header and copies `header.radio` → `Snapshot.Radio`.

## Frontend (`web/src`)

- **Radio hook** (new, in `state/` or `hooks/`): holds `snapshot.radio`; on each frame, fires any message with `timeMs <= currentClock` not yet played; manages the FIFO queue + ~3 s staleness skip + loop-reset (cursor resets when the clock jumps backward).
- **Audio:** a single `<audio>` element; `src` set to the firing message's `clip`; no `crossOrigin` attribute (keep it CORS-free).
- **UI (banner + small history):** a transient **now-playing banner** — driver code in team colour + a replay button, auto-fades — plus a short **collapsible history** of recent clips (click to replay). Driver code/team/colour from the existing `cars` map. A **radio layer toggle** sits with the existing source/seconds toggles; OFF disables auto-play and hides the banner/history.

## Testing

- **Recorder:** unit check on `Utc`→`timeMs` window mapping and that the in-window count is sane (>0 for the widened Monza window); clip header validation extended to accept `radio`.
- **Frontend:** queue logic test — fires in order, skips stale (>3 s), resets cursor on loop, no auto-play when layer off.
- **Contract parity:** Python↔Go `radio`/`RadioMessage` shape stays green in the existing CI parity check.
- **CI** unchanged otherwise (Go fmt+vet+test, Web build+test, Docker build, docs link check, validate).

## Risks / open items

- **F1 URL longevity** (decision 1 ceiling) — accepted; proxy is the named fallback.
- **Window widening weight** — accepted (+~15 MB); compare phase preserved by re-baking 2023.
- **Silverstone radio density** — verify its widened window has enough captures during the plan; if sparse, live-lane radio is a thin bonus, not a goal.
- **Loop/seek edge cases** in the FE cursor reset — covered by the queue logic test.

---
*Next: `grill-with-docs` pass to pressure-test against CONTEXT.md + ADRs and update domain docs inline (CONTEXT.md gains "radio layer"; no ADR expected unless the contract decision warrants one).*
