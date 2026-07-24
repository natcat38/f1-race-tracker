# Static GitHub Pages demo: a third front door, not a hosting reversal

**Status:** accepted

## Context

§6/§7 of `F1_Race_Tracker_Product_Scope.md` retire "always-on public hosting":
the primary artifact is README + recorded video, the hands-on experience is
`docker-compose up` running the real polyglot system, and a hosted live link is
explicitly optional and deferred. The stated reason is cost/maintenance — no
server to keep alive or pay for.

The single biggest adoption friction is exactly that: a recruiter or portfolio
visitor won't clone the repo and run `docker compose up`. An always-on visual
demo converts "I'll never run this" into "oh, I see what it does" — but
building one means hosting *something*, which reads as a direct reversal of
§7's "always-on public hosting" bullet.

Two different reasons turned out to be bundled into "no hosting":
1. **Cost/maintenance** (the one §6 states) — a static GitHub Pages site is
   free and zero-maintenance, so this reason doesn't block it.
2. **The hands-on reviewer should see the real system** (implicit in §6's
   "not a simplified version") — a static, backend-free replay is
   structurally a simplified version. This reason isn't satisfied by GH Pages
   and isn't overridden by it either.

## Decision

Add a **static demo**: a frontend-only build hosted on GitHub Pages that reads
a pre-baked snapshot+frames JSON for one clip and plays it back client-side on
a JS clock, with no writer, no seam, no gateway behind it (see `CONTEXT.md`'s
**Static demo** entry). It sits **alongside** the README/video and
`docker-compose`, not in place of either — a third front door, explicitly
framed (in the README and in-app) as a quick look, not the real architecture.
`docker-compose` remains the only way to see the actual polyglot system run.

Key design choices, resolved during scoping:
- **Bake, don't reimplement.** The static file is produced by reusing the
  existing Go replay-load → hub-accumulation → `encodeSnapshot`/`encodeFrame`
  path (`internal/ws/frame.go`), writing envelopes to a file instead of
  broadcasting over WebSocket. No second translation of the clip format into
  wire format gets written in TypeScript or Python.
- **No custom decimation.** The default clip (`monza-2024-race.jsonl`, 24 MB
  raw) gzip-compresses to ~927 KB — under the 2 MB budget with no downsampling
  or coordinate quantization. GitHub Pages' Fastly CDN serves gzip
  automatically. Revisit only if a future clip's baseline exceeds budget.
- **v1 scope: one clip, full feature parity except the live source.** Track
  map, timing tower, stints, weather, race control, team radio (streamed
  live from F1's public URLs, same as today) all work statically. Compare and
  ghost overlay (which need two synced clips) are deferred to a fast-follow.
  The live/replay source toggle is hidden entirely in the static build rather
  than shown disabled.
- **Playback clock** ports the Go replay player's real per-frame `timeMs`
  pacing and looping (`playFromStart`), not a flat interval.

## Consequences

- Two build outputs from one frontend: the docker-compose `web/dist` (base
  `/`) and the Pages `dist` (base `/f1-race-tracker/`), selected by a Vite
  build-time flag.
- A new CI workflow builds and publishes the static demo on push to `main`;
  it's additive and doesn't touch the existing CI/OKF workflows.
- `CONTEXT.md`'s **Live/Replay** entry now cross-references **Static demo** so
  the two are never conflated — the static build proves nothing about the
  live pipeline.
- `docs/F1_Race_Tracker_Product_Scope.md` §6/§7 are updated to describe three
  front doors instead of two, and to state explicitly that "no always-on
  hosting" meant cost/maintenance, not "no static artifact."

## Considered and rejected

- **Treat this as a full reversal and drop the no-hosting rule.** Rejected —
  the "see the real system" reason behind the rule still holds for the
  hands-on reviewer; `docker-compose` stays the only way to see it.
- **Replace the README/video as the primary artifact with the Pages demo.**
  Rejected — additive, not a replacement; the recorded video/GIF stays useful
  for a visitor who won't even follow a link.
- **Ship compare/ghost overlay in v1.** Rejected for now — they need two
  synced baked clips (heavier payload, more bake work); prove the single-clip
  player and size budget first.
