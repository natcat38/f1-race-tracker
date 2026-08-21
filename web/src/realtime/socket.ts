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
  // A systematically bad feed drops every frame, and at 10 Hz that used to write
  // ten console.error lines a second forever while the board showed a
  // normal-looking but frozen tower. Log enough to diagnose the shape, then say
  // once that the rest are being dropped silently and stop.
  let dropped = 0;
  const MAX_DROP_LOGS = 5;
  const noteDrop = (what: string, detail: unknown) => {
    dropped++;
    if (dropped <= MAX_DROP_LOGS) console.error(`connectRace: ${what}`, detail);
    if (dropped === MAX_DROP_LOGS) {
      console.error(
        `connectRace: further dropped frames on ${url} will not be logged — the feed is producing messages this client cannot read`,
      );
    }
  };

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
        noteDrop('dropping malformed message', err);
        return;
      }
      const msg = parseMsg(parsed);
      if (!msg) {
        noteDrop('dropping message with invalid shape', parsed);
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
      // A socket WE closed also fires onerror ("closed before the connection is
      // established") — every unmount, and twice per mount under StrictMode in
      // dev. Reporting our own teardown as a failure put a console error on every
      // page load, which is exactly what the audit asked this file to stop doing.
      if (closed) return;
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
