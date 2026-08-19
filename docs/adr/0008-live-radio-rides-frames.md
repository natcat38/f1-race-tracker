# 0008 — Live team radio rides frames; replay radio stays snapshot-fixed

**Status:** accepted

## Context

**Team radio** in replay rides the **snapshot**, whole and fixed from the first frame
(ADR-0003, CONTEXT.md): the recorder knows every clip of a finished session up front.

A live session does not work that way. Clips appear on the SignalR `TeamRadio` topic
as they happen, a handful at a time, and the socket re-sends the full capture list at
every (re)subscribe. There is no complete list to bake into the snapshot.

## Decision

Live radio refs ride **frames**, accumulated onto the snapshot — the **race control**
pattern (ADR-0002's sparse-field precedent), not the snapshot pattern:

- `Frame.Radio []RadioMessage` with `json:"radio,omitempty"`. Sparse: present only
  when clips arrive, ~50–100 per session, well inside the frame-size budget.
- `Apply` **appends** `f.Radio` onto `s.Radio`. **Uncapped** — unlike race control's
  rolling 30, a session's whole radio list is small and the comms history wants it all.
- **Never cleared by the loop-reset branch.** Only replay lanes loop, and replay frames
  never carry radio, so the reset would only ever throw away live data.
- Replay radio is **unchanged**: still snapshot-fixed, still clock-window fired.

**The frontend fires live clips on arrival, not on the clock.** A clip's `timeMs` is
its real recording instant (`Utc`), which by construction lags the live lane's
wall-clock `timeMs` — the clip is published *after* it was spoken. A clock-window
match would therefore never fire. So `useComms` plays refs *appended by a frame* the
moment they appear, and keeps clock-window firing for snapshot-delivered (replay) refs.

## Consequences

- One additive wire field, pinned in all three contract tests (Go, TS, Python).
- `Snapshot.Radio` now has two provenances — fixed-at-connect for replay, growing for
  live — which the comms hook must distinguish. It does so by tracking the previously
  seen length and resetting that on every snapshot.
- Dedupe lives in the writer: `live_radio_refs` keeps a `seen` set of final clip URLs,
  because SignalR re-sends the whole capture list on resubscribe.

## Schema assumption (unverified)

Live `TeamRadio` payloads are assumed identical to the archived
`TeamRadio.jsonStream` entries — `{Utc, RacingNumber, Path}` under `Captures` — with
incremental patches arriving as index-keyed **dicts** rather than lists (the shape the
feed uses elsewhere). Both shapes are parsed. The verification net is the raw capture
file `SignalRClient` already writes (`CAPTURE_OUT`): a single real session settles it.

## Considered and rejected

- **Rebuild the whole snapshot on each arrival** — a full re-SET per clip, wasteful and
  it would break rev monotonicity's cheapness for no gain.
- **Cap the accumulated list** like race control — a live viewer joining late would lose
  earlier clips from the history panel, and the list is tiny.
- **Fire live clips on the clock anyway, with a widened window** — the lag is unbounded
  (clips can publish minutes late); any window wide enough is a window that misfires.
