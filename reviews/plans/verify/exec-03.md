# Exec note: item 3 — static-replay pause/scrub controls

Implemented the BUILD slice from `03-06-playback-and-readme.md` item 3:
client-side pause/scrub for the static-demo replay lane only. The live/
replay-lane WebSocket path is untouched and still has no control surface
(needs a writer-side protocol change — out of scope, flagged with a
`ponytail:` comment at the call site).

## Changes

- `web/src/realtime/staticReplay.ts`: `connectStaticReplay` now returns a
  `StaticReplayHandle` — the same close-fn as before, with `pause()`,
  `resume()`, and `scrub(ms)` attached. Internals track `nextIndex` /
  `lastOffset` so pause/resume can re-anchor the local `setTimeout` clock
  without bursting through missed frames (mirrors the existing stall-resync
  logic). `scrub(ms)` rebuilds state by replaying `applyMessage` from the top
  of the clip up to the target frame — cumulative reducer state has no
  cheaper way to land on an arbitrary offset. Added an `onDuration` callback
  (new 3rd param, `clipUrl` shifted to 4th) so callers learn one lap's length
  once the clip loads, for a slider's `max`. Scrubbing across a loop boundary
  is out of scope (`ponytail:` comment).
- `web/src/App.tsx`: on `STATIC_DEMO`, the board's transport control is now a
  real Play/Pause button + range slider (reusing Ghost.tsx's local rAF-clock
  pattern: `replayTMs`/`replayTMsRef`/`replayStartRef`) wired to the new
  handle, replacing the render-only Freeze toggle. The live-lane path keeps
  the existing Freeze toggle unchanged.

## Checks (web layer only)

- `npx tsc --noEmit -p .` — clean.
- `npx eslint src/App.tsx src/realtime/staticReplay.ts` — clean.
- `npx vitest run src/realtime/staticReplay.test.ts src/App.test.tsx` — 10/10
  passed (existing jsdom `HTMLMediaElement.pause not implemented` warnings
  are pre-existing console noise from `useComms`, unrelated to this change).

No new tests were added for pause/scrub specifically — flagged as a
follow-up if this slice gets promoted past demo-quality.
