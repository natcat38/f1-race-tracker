# 1. Single gateway for now; multi-gateway deferred

Date: 2026-06-21

## Status

Accepted

## Context

The project's headline system-design story is horizontal scale: a stateless Go
fan-out tier sitting behind Redis, scaled out to *many* gateway processes, with a
benchmark proving sustained concurrent WebSocket viewers. The scope docs, the
README, and the `knowledge/` bundle all leaned on that "multiple gateways,
horizontally scalable, proven by benchmark" framing.

The repo as built runs **one** `gateway` process. The pieces that *make* horizontal
scale possible are in place — gateways are stateless (subscribe to `frames:{s}`,
keep an in-memory snapshot, serve the SPA + WebSockets), Redis pub/sub is the
language-agnostic seam, and the `/ws?session=<key>` hub registry routes lanes — but
no second gateway, load balancer, or multi-gateway benchmark was ever built. The M4
load-test work (`docs/superpowers/specs/2026-06-19-f1-m4-loadtest-benchmark-design.md`)
re-scoped the benchmark to measure a **single** gateway and explicitly listed the
multi-gateway tier as future work.

So the documentation claimed something the code did not deliver. We had to choose
between making the docs true (build the tier) and making the claim honest (correct
the docs).

## Decision

Keep the architecture *designed for* horizontal scale, but stop claiming it is
*built or proven*. Concretely:

- Run and benchmark **one** gateway. The benchmark measures how a single gateway's
  fan-out latency and drop-rate behave as concurrent viewers climb, framed as a
  lower bound (load generator and server share one host).
- Frame the stateless-gateway + Redis-seam + hub-registry design as the thing that
  *would* make multi-gateway scaling real — the deliberate seam, not a delivered tier.
- Treat the multi-gateway tier (N replicas behind a load balancer, cross-gateway
  benchmark) as explicit future work, not a Phase 1 deliverable.

## Consequences

- The docs become honest: a reviewer reading "horizontally scalable" now sees a
  measured single-gateway curve plus a clearly-marked path to multi-gateway, instead
  of an unbacked claim.
- The strongest portfolio talking point shifts from "I proved horizontal scale" to
  "I built the seam that makes horizontal scale a config change, and measured the
  single-node ceiling honestly." This is a smaller but defensible claim.
- If the multi-gateway tier is built later, this ADR should be superseded by one that
  records the load-balancer choice and the cross-gateway benchmark method.
- All scale language across `README.md`, both scope docs, and the `knowledge/`
  bundle was softened to match (see the reconciliation pass dated 2026-06-21).
