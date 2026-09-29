# F1 Race Tracker — Peer Comparison (Aug 2026)

## Peers reviewed
- **f1-dash** (slowlydev) — ~2k stars, Next.js. Feature dev has stopped (2026); maintenance-only. Successor is **Nitrous**, a cross-platform desktop app (Formula 1 account login, richer telemetry, session replay, planned F1TV-in-app streaming, drag-and-drop layouts, live weather radar).
- **Monaco** (tdjsnelling) — Next.js, GPL-3.0, the original template many forks (f1-dash, f1dash, F1Dash) build on.
- **f1dash** (pesaventofilippo) — fork of Monaco.
- **f1-race-replay** (IAmTomShaw, Python) — post-hoc FastF1 replay tool with GUI, keyboard-driven playback (0.5x–4x), safety-car animation, "OUT" driver states.
- **open-pit-wall** (IAmTomShaw) — headless companion: replays cached FastF1 sessions as a simulated live WebSocket broadcast, for testing dashboard clients without needing a live race.
- **Pitwall** (robinvvinod) — FastF1-based analysis tool: driver-vs-driver throttle/brake/speed/gear overlays, pit-stop duration/track-position-change analysis, stint/degradation visualization.

## Data landscape notes (since mid-2025)
- **OpenF1**: now has a paid Sponsor tier (€9.90/mo) — free tier is historical-only (data available outside the 30-min live window) at 3 req/s / 30 req/min; paid tier unlocks live data + WebSocket/MQTT (6 req/s / 60 req/min, 10 concurrent connections). This is a viable *alternative or supplement* to livetiming.formula1.com for a self-hosted project, though it now gates live data behind payment.
- **FastF1**: dropped Python 3.9 support (3.10+ now required), added pydantic as a dependency, added 2026 team color/name constants with an auto-generated fallback for future seasons whose teams aren't hardcoded yet. No major new data categories — telemetry/timing schema is stable.

## Features/practices this project lacks (peer-sourced ideas)

1. **Driver-vs-driver telemetry overlay with throttle/brake/gear traces over distance** (not just speed) — Pitwall and f1-dash both do full throttle/brake/gear/RPM overlays, not just a speed-delta compare. *Value*: this is the single most "engineer-impressing" F1 dashboard feature — it's what real race engineers look at. *Feasibility*: high — FastF1's `car_data`/`pos_data` already exposes throttle, brake, nGear, RPM per lap; likely an incremental extension of the existing two-car telemetry panel rather than new plumbing.

2. **Pit-stop duration & track-position-change analysis** (Pitwall) — precise stop timing, stationary time, and net positions gained/lost per stop. *Value*: strategy storytelling is a strong recruiter-facing narrative ("who won/lost the race in the pits"), and it's differentiated — none of the simpler forks do this well. *Feasibility*: medium — needs pit lane timestamps from FastF1's `laps`/`pit_stops` data plus position deltas around the stop; doable with existing ingest but needs new aggregation logic.

3. **Session replay as a reusable simulated live feed** (open-pit-wall pattern) — decoupling "replay of a past session" from "the dashboard" by broadcasting it over the same WebSocket protocol as live data. *Value*: this is a strong architecture/portfolio signal (shows you designed one transport contract for both live and historical data, which is exactly the kind of system-design thinking that impresses engineers) and it also gives you a demo-safe, rate-limit-free way to show "live" behavior on GitHub Pages. *Feasibility*: high, and possibly already partially true here (repo already has replay clips) — worth checking whether the existing replay path shares the same message shape as the live path, and calling that out explicitly if so, or unifying it if not.

4. **Native desktop app / F1TV-in-app integration** (Nitrous roadmap) — out of scope for a web dashboard but worth naming so it's a deliberate non-goal rather than an oversight.

5. **Track-map "fastest driver per (mini)sector" heatmap / sector dominance overlay** — f1-dash's track map highlights which driver is fastest through each sector/minisector, filterable by section of track. *Value*: visually striking, well-known F1-broadcast feature ("sector dominance"), good for a portfolio screenshot. *Feasibility*: medium — needs minisector-level speed/time data, which FastF1 partially exposes via telemetry distance-binning; more of a frontend/aggregation build than a new data source.

6. **Session/driver favoriting + filter panel** (f1-dash) — pin specific drivers/teams/compounds to declutter the timing tower during a race. *Value*: minor but expected polish; low effort relative to payoff, shows UX care. *Feasibility*: high, pure frontend state.

7. **Live weather radar / conditions panel beyond a single chip** (Nitrous roadmap item) — richer weather trend (rain radar, track temp over time) vs. this project's single weather chip. *Feasibility*: medium — FastF1 weather data is per-sample (rainfall, track/air temp, wind); a small time-series chart is straightforward, a radar overlay is not (no radar data source in FastF1).

## Where this project is already ahead (short list, for confidence)

- **Cross-season ghost-lap overlay with pause/scrub and delta bar** — none of the peers reviewed (f1-dash, Monaco, f1-race-replay, Pitwall) combine cross-season comparison *and* scrubbable playback *and* a live delta bar in one view; most peers do either live timing (f1-dash/Monaco lineage) or offline analysis (Pitwall/f1-race-replay), not both with this level of interactivity.
- **Full pipeline architecture (FastF1 → Redis → Go WebSocket gateway → React)** is more production-shaped than most peers, which are either a single Next.js app talking directly to a timing feed (f1-dash/Monaco) or a Python-only offline tool (f1-race-replay, Pitwall). The Go gateway + Redis layer is a genuine differentiator for demonstrating backend/systems skills, not just frontend charting.
- **Team radio playback + race control log + strategy timeline in one unified dashboard** — peers tend to specialize (Pitwall = analysis, f1-race-replay = replay visualization, f1-dash = live timing) rather than combining broadcast-adjacent features (radio, race control) with strategy analysis in a single tool.
- **Self-hosted + static GitHub Pages demo mode** — open-pit-wall is the only peer with a comparable "replay as simulated feed" idea, but this project already ships a public static demo, which is a concrete, zero-setup portfolio artifact most peers don't offer.

## Bottom line
Highest-value, most feasible additions to prioritize: (1) full throttle/brake/gear telemetry overlay (extends existing compare panel), (2) pit-stop duration/position-change analysis (new but reuses FastF1 pit/lap data), (3) explicitly unifying/documenting the replay-feed-as-live-feed architecture if not already done. Sector-dominance track map and driver favoriting are good but lower-priority polish.
