---
name: plain-english-preference
description: "User prefers plain-English, low-jargon explanations of technical options"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 2f3518ba-8712-4d8c-bbfa-366d8631e143
---

When presented with technical options or architecture decisions, the user repeatedly asked for plain-English explanations (e.g. "can you explain in plain english the options?", "what is the purpose of fly.io or railway in this project?"). They are building a portfolio system-design project but are not deeply versed in infra/ops terminology.

**Why:** They make better decisions when jargon (CORS, anycast, pub/sub, scale-to-zero) is unpacked with analogies and concrete consequences rather than assumed.

**How to apply:** Default to plain language; when a term is unavoidable, define it in a phrase. Lead with the "why it matters to your project" before the mechanism. Keep recommending a concrete option rather than surveying abstractly. See [[f1-tracker-direction]].
