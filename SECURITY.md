<!-- Security posture and vulnerability-reporting policy for this self-hosted app. -->

# Security Policy

This is a self-hosted app you run locally, not a hosted service — there is no public
deployment to protect and no SLA. Still, if you find a security issue in the code
(e.g. in the gateway, the ingest pipeline, or the Docker setup), please report it
privately rather than opening a public issue:

- Preferred: [GitHub Security Advisories](https://github.com/natcat38/f1-race-tracker/security/advisories/new) for this repo.
- Alternative: open a regular GitHub issue with minimal detail and a note asking to
  discuss privately.

Please include what you found, where (file/line if possible), and how to reproduce it.
There's no fixed response-time guarantee, but reports will be looked at and credited.

## Threat model

This app is meant to run two ways, and everything above is weighed against those two
cases only:

1. **Single-operator local deployment.** You run the Go gateway and Python ingest on
   your own machine (or LAN), reachable at `localhost`/`127.0.0.1` (or a host you've
   explicitly added to `ALLOWED_HOSTS`). There's one user — you — and no login, because
   there's no one else to authenticate against. The gateway trusts whoever can reach its
   port, the same way a personal `localhost:3000` dev server does; it is not designed to
   be exposed to the public internet or a shared/untrusted network.
2. **Static GitHub Pages demo.** The public demo at
   `https://natcat38.github.io/f1-race-tracker/` is a pre-built, static replay with no
   backend, no ingest, and no control endpoints — it's a read-only artifact, not a
   running instance of the gateway.

Findings are judged as "real" when they'd let an attacker cross one of those boundaries:
reach the gateway from a page it didn't intend to trust (the DNS-rebinding class of
issue this file's history covers), exhaust resources it wasn't given a way to bound, or
get more out of a response than the single operator asked for. Findings that assume a
multi-tenant server, a public deployment with untrusted concurrent users, or an
authentication system are out of scope until the project actually takes on that shape.
