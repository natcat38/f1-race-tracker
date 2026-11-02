<!-- ADR-0013: the three baked replay clips stay committed in full, so the demo runs offline with no fetch step. -->

# 0013 — The replay clips stay committed in full

**Status:** Accepted (owner decision D2 of the 2026-11-02 open-items sweep, issue #123)

## Context

`data/replays/` holds three baked clips that every demo path reads:

| Clip | Bytes |
|---|---|
| `monza-2023-race.jsonl` | 24,514,046 |
| `monza-2024-race.jsonl` | 23,130,229 |
| `silverstone-2024-race.jsonl` | 22,975,859 |

That is about 70.6 MB in the working tree. Reviews since August flagged the size as the
biggest "bloated repo" signal a reviewer might notice (#123). Three directions were on the
table:

1. Keep the clips as they are and say so.
2. Re-bake shorter lap windows with `ingest/record.py --start-lap/--end-lap`.
3. Move the clips to Git LFS or a release-asset fetch script.

## Decision

**Option 1.** The clips stay committed in full, in plain git. `ingest/README.md` says so
next to the bake instructions, so the size reads as a choice rather than an oversight.

## Why

- `docker compose up --build -d` is the whole run. It needs no network for positions and
  timing, no LFS client, and no fetch script.
- The GitHub Pages build (`.github/workflows/pages.yml`) bakes the static demo from
  `monza-2024-race.jsonl` straight out of the checkout. A fetch step would put a second
  source of truth and a failure point in that build.
- Shorter windows would shorten the replays, and every re-bake has to clear the
  gap-estimator gate (`ingest/check_gap_estimator.py`) again.

## Consequences

- A fresh clone downloads about 70 MB of clips, plus older versions of them in history.
- Re-baking a clip in place (as ADR-0011 did for Monza 2024) adds one more version to
  history each time. Keep re-bakes rare and replace in place; never add a second copy.
- Team radio is the one part that still needs the network. It streams from F1's public
  URLs at play time and is never committed (ADR-0003).
- Revisit only if a clip grows past GitHub's 100 MB per-file limit, or the total passes
  about 150 MB.

## Alternatives considered

- **Shorter windows (option 2):** smaller repo, no new tooling, but shorter replays and a
  gate re-run per clip.
- **Git LFS or a release-asset fetch (option 3):** small clones and full clips, but an
  extra step for anyone cloning and a fetch inside the Pages build.
