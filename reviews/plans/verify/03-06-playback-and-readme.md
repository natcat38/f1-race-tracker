# Verification: items 3 (playback controls) and 6 (README marketing paragraph)

## Item 3 — WS3 replay playback controls on main board

**Verdict: BUILD (client-side static-demo scrub slice only), full live-lane WS3 stays DEFER pending its own design pass.**

Evidence:
- Roadmap (`docs/superpowers/plans/2026-08-19-polish-and-immersion-roadmap.md`)
  confirms: "No playback control on the main board (Ghost has pause/scrub; the
  replay lane always runs at native pace, no seek)" — still true, not done.
- `web/src/components/Ghost.tsx` already implements pause/scrub/loop for the
  ghost overlay (`paused`, `scrub()`, rAF loop, slider at line ~366) — this is
  local-clock, purely client-side replay of two baked reference laps. Proven
  pattern to reuse.
- Main board's replay pacing is genuinely two different mechanisms:
  - Live/replay-lane WebSocket path: paced server-side by the Go writer
    (`internal/feed/replay/play.go`'s `playFromStart`), fanned out over one
    shared WebSocket to all clients — pause/seek here needs a writer-side
    protocol change (open-pit-wall's play/pause/seek/speed prior art, per
    roadmap §2). This is the part the roadmap and item 3's own caveat correctly
    flag as needing its own design pass — it is NOT a small addition (affects
    gateway fanout, multi-client consistency, snapshot semantics).
  - Static GH-Pages demo path: `web/src/realtime/staticReplay.ts`'s
    `connectStaticReplay` paces entirely client-side via `setTimeout`s keyed
    off each frame's own `timeMs` offset, with its own `loopStart` anchor
    (confirmed via commit 65393b3, which fixed a resync bug in exactly this
    local clock). Because the whole clock lives in this one closure already,
    adding pause (skip scheduling the next `setTimeout`) and scrub (jump `i`
    to the frame index matching a target offset, reset `loopStart`) is a
    same-shape, self-contained change — no server, no protocol, no fanout
    concerns. This is the "easier client-side static-demo scrub slice" the
    task asked to assess, and it is viable as its own PR-sized slice.

**Sketch for the BUILD slice:**
- Extend `connectStaticReplay`'s returned control surface (currently just a
  close fn) to also expose `pause()`, `resume()`, `scrub(ms)`, mirroring
  Ghost's local pattern.
- Add UI controls (reuse Ghost's play/pause button + range slider styling) to
  the main board, gated to only render when the active lane is the static
  demo — the live/replay WebSocket lane still has no control surface and
  must not show controls it can't honor.
- A race-timeline strip with flag/SC/pit markers (also named in item 3) is a
  separate, larger addition — track it as a follow-up, don't fold into this
  slice.
- Effort: S–M (much less than the L estimate in the doc, which was pricing
  the full live-lane version).

## Item 6 — README paragraph marketing replay-as-simulated-live architecture

**Verdict: BUILD — does not exist yet.**

Searched `README.md` for "simulated live", "simulated-live", "same contract",
"open-pit-wall" — no matches. The architecture itself is real and already
documented piecemeal (README already explains the replay/live lane switch,
the Go writer, gateway fanout, `{"source":"replay"|"live"}` toggle — lines
~92-145), but no paragraph explicitly frames this as "this repo already
ships a simulated-live feed pattern for testing dashboard clients" (the
open-pit-wall comparison). Confirmed as genuinely not done, not just missed
by grep — it's an explicit synthesis/framing that the current README doesn't
attempt.

Effort: S (docs-only, ~1 paragraph plus maybe a link to peer-comparison.md
for backup). Low risk, no code changes.
