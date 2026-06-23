# F1 Race Tracker — M4 part 3: README / demo polish (design)

**Date:** 2026-06-23
**Status:** approved
**Milestone:** M4 part 3 (final M4 piece; part 1 = cross-year compare ✅, part 2 = load test + benchmark ✅)

## Goal

Polish the project's "front door" so a portfolio visitor gets it in ~5 seconds:
a visual at the top, the scale story up front, and a cleaner architecture
diagram. No new runtime code — this is docs + committed image assets only.

## Scope (3 pieces)

### 1. Committed screenshot assets

- New committed path `docs/assets/` holding two images, **copied** from the
  existing gitignored root-level screenshots (originals stay put):
  - `docs/assets/live-lane.png` ← `m3a-live-lane-silverstone.png` (hero: live
    lane toggle + track map + order list)
  - `docs/assets/compare.png` ← `m4-compare-monza-2023-vs-2024.png` (cross-year
    stack)
- `m3b-python-live-lane.png` is **not** used — near-duplicate of the live-lane
  shot, no added signal.
- The compare shot is a tall scroll-capture with a slightly clipped title;
  shipped as-is (reads fine at README width). A cleaner recapture can replace
  the file later with no other change.

### 2. README narrative polish

Restructure the top of `README.md` so the value lands fast, without rewriting
the solid reference sections below:

- Hero screenshot (`docs/assets/live-lane.png`) directly under the title.
- One-sentence hook, then **lead with the benchmark headline** (1,000
  concurrent WS viewers @ 10 Hz, p99 fan-out 48 ms, zero drops) as the
  credibility line — currently buried mid-page.
- A short "What this demonstrates" framing: 2–3 portfolio-angled bullets
  (polyglot Redis seam, live WebSocket fan-out, track-map-first design).
- Compare screenshot embedded inside the existing cross-year section.
- Keep **Run**, **Control endpoint**, **Service layout**, **Further reading**
  essentially as-is.

### 3. How-it-works diagram

Replace the ASCII architecture diagram with a **Mermaid flowchart**. GitHub
renders Mermaid natively in the README, so there's no image to generate,
commit, or keep in sync — it stays diff-able text. Same "two lanes → Redis
seam → gateway fan-out → SPA" story plus the `/control/source` switch.

## Out of scope (YAGNI)

- Animated GIF / video and any capture or frame-render tooling.
- A screenshot-generation pipeline or CI for assets.
- The Python live-lane screenshot as a separate "polyglot proof" image.
- Any change to runtime code, the contract, or service layout.

## Success criteria

- README opens with a screenshot and the scale headline above the fold.
- `docs/assets/` contains the two committed images, referenced by the README.
- Architecture section renders as a Mermaid diagram on GitHub.
- `docker compose up --build -d` instructions and all existing reference
  sections remain correct and intact.
