// The static-demo data source: paces a baked NDJSON clip through the same reducer the
// live socket feeds.

import { applyMessage, emptyState, parseMsg, type Msg, type RaceState } from '../state/race';
import type { ConnStatus } from './socket';

const DEFAULT_CLIP_URL = `${import.meta.env.BASE_URL}static-demo/monza-2024-race.ndjson`;

// The control surface handed back to callers: closing the connection, plus the
// board's pause/resume/scrub transport (reviews/plans/verify/03-06-playback-and-readme.md
// item 3 — client-side static-demo scrub only, mirroring Ghost.tsx's local clock).
// A plain function (call it to close) with these three attached, so the existing
// `disconnectRef.current()` call sites over in App.tsx/lanes.ts need no change.
export interface StaticReplayHandle {
  (): void;
  pause: () => void;
  resume: () => void;
  scrub: (ms: number) => void;
}

// connectStaticReplay mirrors connectRace's interface (onState/onStatus/close-fn)
// but reads a baked NDJSON file (produced by cmd/bake-static) instead of opening
// a WebSocket, pacing playback on each frame's own relative timeMs offset and
// looping forever — the same algorithm as the Go replay player's playFromStart
// (internal/feed/replay/play.go), ported here since there's no Go process to
// pace it for us in a static build.
export function connectStaticReplay(
  onState: (s: RaceState) => void,
  onStatus?: (status: ConnStatus) => void,
  // Fired once, when the clip has loaded, with the length of one lap of the
  // baked clip in ms — the range a scrub slider needs and has no other way
  // to know ahead of time.
  onDuration?: (ms: number) => void,
  clipUrl: string = DEFAULT_CLIP_URL,
): StaticReplayHandle {
  let state = emptyState();
  let closed = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let live = false;
  let paused = false;
  // Set once messages are loaded (schedulePlayback), read by pause/resume/scrub,
  // which are otherwise no-ops before the clip has finished fetching.
  let control: { pause: () => void; resume: () => void; scrub: (ms: number) => void } | null = null;

  onStatus?.('connecting');

  fetch(clipUrl)
    .then((res) => {
      if (!res.ok) throw new Error(`static demo: fetch failed (${res.status})`);
      return res.text();
    })
    .then((text) => {
      if (closed) return;
      const messages = text
        .split('\n')
        .filter((line) => line.length > 0)
        .map((line) => {
          try {
            return parseMsg(JSON.parse(line));
          } catch {
            return null;
          }
        })
        .filter((m): m is Msg => m !== null);
      // Require at least one FRAME, not just any message: a clip with only a
      // parseable snapshot and zero valid frames would otherwise pass this
      // check, then schedulePlayback's loopRestartIndex would fall back to 0
      // (the snapshot itself) and playFrom would reschedule a 0ms timer against
      // itself forever — a busy-loop pegging the tab instead of a visible error.
      if (!messages.some((m) => m.type === 'frame')) {
        console.error('connectStaticReplay: baked clip had no valid frame messages');
        onStatus?.('failed'); // terminal: a static page has no live source to retry
        return;
      }
      schedulePlayback(messages);
    })
    .catch((err) => {
      if (closed) return; // a superseded connection must not mark the live one failed
      console.error('connectStaticReplay: failed to load clip', err);
      onStatus?.('failed'); // terminal: nothing to reconnect to on a static page
    });

  function schedulePlayback(messages: Msg[]) {
    // Every frame's timeMs, relative to the first frame's timeMs — mirrors
    // play.go's `base := s.lines[0].TimeMs`. The snapshot (if any) always plays
    // at offset 0, same as the Go player's first-message-is-current-state model.
    const frameStartIndex = messages.findIndex((m) => m.type === 'frame');
    const frameBase = frameStartIndex >= 0 ? messages[frameStartIndex].data.timeMs : 0;
    const offsets = messages.map((m) => (m.type === 'frame' ? m.data.timeMs - frameBase : 0));
    onDuration?.(Math.max(...offsets, 0));
    // Where a loop restart resumes: the first FRAME, not index 0. The synthetic
    // baked snapshot (empty cars, the pre-playback baseline) plays exactly once,
    // on the very first pass — re-emitting it every lap would flash the map back
    // to empty on every loop, and production never does this either: a real
    // replay loop restart is detected by TimeMs decreasing and only clears the
    // rolling message buffer (internal/model/apply.go), it never re-sends a
    // from-scratch empty snapshot.
    const loopRestartIndex = frameStartIndex >= 0 ? frameStartIndex : 0;
    // applyMessage drops any frame whose Rev isn't greater than the state's
    // current Rev (CONTEXT.md: "Rev ... must never reset — not across a replay
    // loop"). cmd/bake-static bakes Rev as 1..N for one pass, so replaying the
    // same baked messages verbatim on lap 2 would have every frame's Rev <= the
    // Rev the first lap already reached, silently dropped as stale — freezing
    // the map after one lap. Mirror play.go's `fr.Rev = ln.Frame.Rev + loop*s.max`:
    // bump every frame's Rev by (completed laps * the highest baked Rev) so Rev
    // keeps climbing forever, exactly like the real writer does across a loop.
    const maxRev = messages.reduce((max, m) => (m.type === 'frame' ? Math.max(max, m.data.rev) : max), 0);
    let lapsCompleted = 0;
    // The next frame due to play, and the offset it was last (re)anchored
    // against — both read by pause/resume/scrub below, which otherwise have no
    // way to know where a paused clip currently sits.
    let nextIndex = 0;
    let lastOffset = 0;

    const bump = (msg: Msg): Msg => (msg.type === 'frame' && lapsCompleted > 0
      ? { ...msg, data: { ...msg.data, rev: msg.data.rev + lapsCompleted * maxRev } }
      : msg);

    let loopStart = Date.now();

    const playFrom = (i: number) => {
      if (closed || paused) return;
      if (i >= messages.length) {
        lapsCompleted++;
        loopStart = Date.now();
        nextIndex = loopRestartIndex;
        timer = setTimeout(() => playFrom(loopRestartIndex), 0);
        return;
      }
      // If real processing (React committing the previous frame, the tower's
      // per-render layout read, a GC pause — anything) has eaten into the
      // budget far enough that we're now behind this frame's own offset,
      // resync loopStart to "now" instead of chasing the deficit. Without
      // this, elapsed keeps growing relative to the ORIGINAL start while the
      // baked offsets only advance 100ms per frame, so every remaining frame
      // in the lap computes a negative (clamped-to-0) wait and the whole rest
      // of the clip fires back-to-back — feeding React far faster than the
      // live 10 Hz socket ever does, which is exactly the burst that trips
      // the nested-update guard in effects sized for a paced 10 Hz stream
      // (e.g. TimingTower's per-render scroll measurement). Resyncing drops
      // the missed wall-clock time once and resumes normal pacing, the same
      // way the rest of the app treats a stall as "fell behind", not "must
      // catch up at any cost".
      const now = Date.now();
      if (now - loopStart > offsets[i]) loopStart = now - offsets[i];
      const wait = Math.max(0, offsets[i] - (now - loopStart));
      nextIndex = i;
      timer = setTimeout(() => {
        state = applyMessage(state, bump(messages[i]));
        lastOffset = offsets[i];
        if (!live) { live = true; onStatus?.('live'); }
        onState(state);
        playFrom(i + 1);
      }, wait);
    };

    playFrom(0);

    control = {
      pause: () => {
        if (paused) return;
        paused = true;
        if (timer) clearTimeout(timer);
      },
      resume: () => {
        if (!paused) return;
        paused = false;
        // Re-anchor loopStart against the offset already reached, exactly as a
        // fresh lap does above — otherwise the clock treats the paused wall time
        // as elapsed playback and bursts through however many frames it covers.
        loopStart = Date.now() - lastOffset;
        playFrom(nextIndex);
      },
      // Jumps to the nearest frame at or after `ms` and rebuilds state by
      // replaying from the top of the current lap — the reducer folds each
      // frame into the last (CONTEXT.md: state is cumulative), so there is no
      // cheaper way to land on an arbitrary offset than replaying up to it.
      // ponytail: O(n) replay on every scrub, fine for a single baked clip's
      // few thousand frames; scrubbing across a loop boundary (into the next
      // lap's Rev range) is out of scope for this slice.
      scrub: (ms: number) => {
        if (timer) clearTimeout(timer);
        const target = messages.findIndex((_, idx) => idx >= loopRestartIndex && offsets[idx] >= ms);
        const end = target >= 0 ? target : messages.length - 1;
        let replayed = emptyState();
        for (let j = 0; j <= end; j++) {
          replayed = applyMessage(replayed, bump(messages[j]));
        }
        state = replayed;
        lastOffset = offsets[end];
        nextIndex = end + 1;
        onState(state);
        loopStart = Date.now() - lastOffset;
        if (!paused) playFrom(nextIndex);
      },
    };
  }

  const close = (() => {
    closed = true;
    if (timer) clearTimeout(timer);
  }) as StaticReplayHandle;
  // Before the clip has loaded there is nothing to pause/scrub yet; no-ops
  // until `control` is set at the end of schedulePlayback.
  close.pause = () => control?.pause();
  close.resume = () => control?.resume();
  close.scrub = (ms: number) => control?.scrub(ms);
  return close;
}
