# 0003 — Team-radio audio streamed from F1's public URL, not committed

Phase 3 adds **team radio** (driver↔engineer audio) as a toggleable **comms
layer**. The audio bytes are **streamed from F1's public URL at play time** — a
plain `<audio src="https://livetiming.formula1.com/.../TeamRadio/<clip>.mp3">`.
Nothing is downloaded to disk and nothing is committed to the repo. The clip
header (and so the **snapshot**) carries only a reference per message:
`{timeMs, driverNum, clip}`, where `clip` is the full https URL.

## Why

Three genuine options:

1. **Commit the audio** (a sidecar dir, referenced by filename). Consistent with
   how the JSONL clips are committed, fully offline-reproducible — but adds binary
   weight to a repo already holding ~20 MB of clips, and the no-hosting ethos is
   about hosting nothing, not about hoarding bytes.
2. **Gateway proxy** — a Go passthrough route fetches and re-serves the bytes.
   Sidesteps any CORS/referer concern, still commits nothing — but it's a new
   route, a cache dir, and code to maintain for a demo.
3. **Stream direct from F1's URL** *(chosen)*. Verified: those URLs serve
   `audio/mpeg`, 200, `accept-ranges: bytes`, and **play cross-origin in an
   `<audio>` element without CORS** (no `Access-Control-Allow-Origin` header is
   present, but plain media playback doesn't need one — only `fetch()` / Web-Audio
   sample-reading would be blocked, and we do neither). Zero weight, zero new code,
   and most in the spirit of "host nothing, store nothing".

This is **surprising without context** — a future reader will reasonably ask why
the audio isn't committed like the JSONL clips — and **hard-ish to reverse**: the
external dependency is baked into the contract as `clip` = a live F1 URL.

## Consequences

- The comms layer depends on F1 keeping those public URLs live (they are 2024
  assets, still served in 2026). If they ever expire or add CORS/referer locks,
  the **upgrade path is Option 2** (gateway proxy): the only change is what `clip`
  points at — the contract shape (`{timeMs, driverNum, clip}`) is unaffected.
- The demo needs network access for audio (positions/timing remain fully offline
  from the committed clips). Acceptable for a portfolio demo.
- We did not build the proxy up front: a working stream with a named fallback
  beats speculative infrastructure.
