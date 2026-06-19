# F1 Race Tracker

A real-time F1 race tracker built as a polyglot stack: Python ingests position data and publishes it to Redis; Go reads from Redis and fans it out over WebSocket; a React SPA renders an interactive track map. The design is track-map-first — car positions on circuit are the primary view, updating at 10 Hz.

## Run it

```bash
docker compose up --build -d
```

Open [http://localhost:8080](http://localhost:8080).

The default view shows the Monza 2024 race clip (replay lane). Use the toggle at the top of the page to switch to the Silverstone 2024 clip streaming on the live lane.

## Architecture — two lanes, one seam

```
Python live.py ──────────────────────┐
  (lane: "live", Silverstone clip)   │
                                      ▼
                              Redis ──────► Gateway (Go) ──► WebSocket ──► React SPA
                                      ▲         ▲
Go replay writer ────────────────────┘         │
  (lane: "replay", Monza clip)            /control/source
```

Each lane writes to its own Redis keys (`snapshot:<session>` and `frames:<session>`) and never touches the other lane's keys. The gateway fans out exactly one lane at a time. Switching lanes is a live operation — no restart needed.

**Redis is the polyglot seam.** Python (`ingest/live.py`) and Go publish byte-identical JSON to the same key shapes. The gateway consumes either with zero code changes. The shared contract is defined in `internal/model/model.go`.

**Monotonic Rev.** Both the Go writer and the Python ingester read the stored snapshot's `rev` at startup and emit strictly above it. A restart or a source swap therefore never re-emits a Rev the gateway and clients already passed (which would silently freeze the board).

## Control endpoint

Switch the active source at runtime:

```
GET  /control/source
```
Returns `{"source":"replay"}` or `{"source":"live"}` — whichever lane the gateway is currently fanning out.

```
POST /control/source
Content-Type: application/json

{"source":"replay"}   # or "live"
```
Repoints the gateway at that lane, re-seeds every connected browser with that lane's snapshot (a wholesale replace), and starts streaming its frames. Only `"replay"` and `"live"` are valid values; anything else returns HTTP 400. Unknown HTTP method returns 405; switch failure returns 502.

The React UI toggle at the top of the page POSTs this endpoint. The active button is highlighted using the `session` field from the snapshot.

## Service layout (`docker-compose.yml`)

| Service  | Language | Role                                    | Default session |
|----------|----------|-----------------------------------------|-----------------|
| `redis`  | —        | The polyglot seam                       | —               |
| `replay` | Go       | Loops the Monza 2024 clip               | `replay`        |
| `live`   | Python   | Streams the Silverstone 2024 clip       | `live`          |
| `gateway`| Go       | Serves SPA + WebSocket, switchable lane | starts on `replay` |

## Further reading

- `ingest/` — how to bake a new circuit clip or run the live SignalR ingester
- `docs/F1_Race_Tracker_Tech_Scope.md` — technical architecture decisions
- `docs/F1_Race_Tracker_Product_Scope.md` — product scope and milestones
- `internal/model/model.go` — the shared Redis JSON contract
