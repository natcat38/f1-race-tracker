/**
 * The frontend's data-source connections: a reconnecting live WebSocket and a paced static-replay reader, both feeding the same RaceState reducer.
 * @packageDocumentation
 */
import { applyMessage, emptyState, parseMsg, type RaceState } from '../state/race';

// 'failed' is terminal — only the static replay emits it (a missing/empty baked
// clip has nothing to retry against); the live socket always keeps reconnecting.
export type ConnStatus = 'connecting' | 'live' | 'reconnecting' | 'failed';

// connectRace opens a reconnecting WebSocket. onState is called with the latest
// RaceState on every message. The optional onStatus callback receives connection
// lifecycle events. Returns a close function.
export function connectRace(
  onState: (s: RaceState) => void,
  onStatus?: (status: ConnStatus) => void,
  session?: string,
): () => void {
  let state = emptyState();
  let ws: WebSocket | null = null;
  let closed = false;
  let backoff = 500;
  let attempted = false;

  const base = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
  const url = session ? `${base}?session=${encodeURIComponent(session)}` : base;

  function open() {
    let live = false; // per-connection: emit 'live' on the first message of THIS connection
    // Only the FIRST attempt is 'connecting' here. Re-emitting it at the top of
    // every retry overwrote the 'reconnecting' onclose had just set, and since
    // no consumer renders 'connecting' distinctly, an outage fell through to
    // the staleness chip ("waiting for timing data") and the map's reconnect
    // overlay blinked out — a dead backend read as a merely slow one.
    if (!attempted) {
      attempted = true;
      onStatus?.('connecting');
    }
    ws = new WebSocket(url);
    ws.onopen = () => {
      backoff = 500;
      // Back to 'connecting': the socket is established but no data has crossed
      // it yet, so consumers should show their warming-up/staleness copy rather
      // than keep claiming we are still retrying. 'live' follows on the first
      // message. Safe to emit here (unlike at the top of open()) because this
      // only fires on a connection that actually succeeded.
      onStatus?.('connecting');
    };
    ws.onmessage = (ev) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(ev.data);
      } catch (err) {
        console.error('connectRace: dropping malformed message', err);
        return;
      }
      const msg = parseMsg(parsed);
      if (!msg) {
        console.error('connectRace: dropping message with invalid shape', parsed);
        return;
      }
      state = applyMessage(state, msg);
      if (!live) {
        live = true;
        onStatus?.('live');
      }
      onState(state);
    };
    ws.onclose = () => {
      if (closed) return;
      onStatus?.('reconnecting');
      setTimeout(open, backoff);
      backoff = Math.min(backoff * 2, 8000); // exponential backoff, capped at 8s (Task 7 acceptance)
    };
    ws.onerror = () => {
      // ev.type is the literal string 'error', which made the line read
      // "socket error error" and said nothing about which socket. Log the URL
      // instead — on a multi-lane route that is the only distinguishing detail.
      console.error('connectRace: socket error on', url);
      ws?.close();
    };
  }
  open();

  return () => { closed = true; ws?.close(); };
}
