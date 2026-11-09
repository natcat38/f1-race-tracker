<!-- ADR-0014: pause and scrub stay client-only on the static demo, permanently; the live and replay lanes get no playback control. -->

# 0014 — Scrub stays client-only on the static demo

**Status:** Accepted (owner decision D3 of the 2026-11-02 open-items sweep, issue #115)

## Context

PR #94 gave the static GitHub Pages demo (ADR-0006) a Pause button and a scrubber. They
work entirely in the browser: `web/src/realtime/staticReplay.ts` replays the baked clip
from its start up to the chosen offset on every scrub, an O(n) pass that is fine for one
clip of a few thousand frames.

The live and replay lanes have no such control. `internal/app/writer.go` folds events and
publishes snapshots in one loop, with no way to receive a control message, and every
viewer on a lane shares that one stream. The 2026-08-19 polish plan listed server-paced
scrub as WS3, and #115 asked for the design to be settled before WS3 started. Three
options were on the table:

1. Add a control channel to the Writer (a Redis key or pub/sub topic next to `Events()`),
   so scrub works on the live and replay lanes too.
2. Keep scrub client-only on the static demo, permanently.
3. Write a Proposed ADR framing both and decide when WS3 starts.

## Decision

**Option 2.** Pause and scrub exist only on the static demo, client-side. The live and
replay lanes never get pause or scrub. The server-paced scrub part of WS3 is dropped.

## Why

- No new server code and no second input path into the Writer.
- A lane is shared: pausing it for one viewer would pause it for all of them, or force a
  per-viewer stream, which undoes the single-hub fan-out measured in `BENCHMARKS.md`.
- The static demo is where a visitor inspects a moment. Anyone running the full stack is
  watching the pipeline run, which is what the live and replay lanes exist to show.

## Consequences

- `web/src/App.tsx` keeps the replay handle null on the WebSocket path. Its comment now
  points here.
- The overlay view (`#ghost`) keeps its own local clock, as before.
- If a future feature needs time travel on a live lane, it starts as a new ADR that
  supersedes this one.

## Alternatives considered

- **Writer control channel (option 1):** scrub everywhere, but the most work and a
  second input path into `writer.go`.
- **Proposed ADR, decide at WS3 (option 3):** nothing built now, but the decision is only
  postponed.
