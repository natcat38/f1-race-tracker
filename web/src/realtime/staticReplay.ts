import { applyMessage, emptyState, parseMsg, type RaceState } from '../state/race';
import type { ConnStatus } from './socket';

// race.ts's Msg union isn't exported (it's an internal detail of parseMsg's
// return type) — alias it here once so every use below refers to the same
// name instead of repeating the ReturnType<typeof parseMsg> gymnastics.
type Msg = NonNullable<ReturnType<typeof parseMsg>>;

const DEFAULT_CLIP_URL = `${import.meta.env.BASE_URL}static-demo/monza-2024-race.ndjson`;

// connectStaticReplay mirrors connectRace's interface (onState/onStatus/close-fn)
// but reads a baked NDJSON file (produced by cmd/bake-static) instead of opening
// a WebSocket, pacing playback on each frame's own relative timeMs offset and
// looping forever — the same algorithm as the Go replay player's playFromStart
// (internal/feed/replay/play.go), ported here since there's no Go process to
// pace it for us in a static build.
export function connectStaticReplay(
  onState: (s: RaceState) => void,
  onStatus?: (status: ConnStatus) => void,
  clipUrl: string = DEFAULT_CLIP_URL,
): () => void {
  let state = emptyState();
  let closed = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let live = false;

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
        onStatus?.('reconnecting'); // no live source to fall back to on a static page — signals "not progressing" over a silent hang
        return;
      }
      schedulePlayback(messages);
    })
    .catch((err) => {
      console.error('connectStaticReplay: failed to load clip', err);
      onStatus?.('reconnecting'); // same: nothing to reconnect to, but better than a silent "connecting" hang
    });

  function schedulePlayback(messages: Msg[]) {
    // Every frame's timeMs, relative to the first frame's timeMs — mirrors
    // play.go's `base := s.lines[0].TimeMs`. The snapshot (if any) always plays
    // at offset 0, same as the Go player's first-message-is-current-state model.
    const frameStartIndex = messages.findIndex((m) => m.type === 'frame');
    const frameBase = frameStartIndex >= 0 ? messages[frameStartIndex].data.timeMs : 0;
    const offsets = messages.map((m) => (m.type === 'frame' ? m.data.timeMs - frameBase : 0));
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

    let loopStart = Date.now();

    const playFrom = (i: number) => {
      if (closed) return;
      if (i >= messages.length) {
        lapsCompleted++;
        loopStart = Date.now();
        timer = setTimeout(() => playFrom(loopRestartIndex), 0);
        return;
      }
      const wait = Math.max(0, offsets[i] - (Date.now() - loopStart));
      timer = setTimeout(() => {
        const msg = messages[i];
        const bumped: Msg = msg.type === 'frame' && lapsCompleted > 0
          ? { ...msg, data: { ...msg.data, rev: msg.data.rev + lapsCompleted * maxRev } }
          : msg;
        state = applyMessage(state, bumped);
        if (!live) { live = true; onStatus?.('live'); }
        onState(state);
        playFrom(i + 1);
      }, wait);
    };

    playFrom(0);
  }

  return () => {
    closed = true;
    if (timer) clearTimeout(timer);
  };
}
