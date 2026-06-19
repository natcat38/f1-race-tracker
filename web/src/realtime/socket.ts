import { applyMessage, emptyState, type RaceState } from '../state/race';

export type ConnStatus = 'connecting' | 'live' | 'reconnecting';

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

  const base = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
  const url = session ? `${base}?session=${encodeURIComponent(session)}` : base;

  function open() {
    let live = false; // per-connection: emit 'live' on the first message of THIS connection
    onStatus?.('connecting');
    ws = new WebSocket(url);
    ws.onopen = () => { backoff = 500; };
    ws.onmessage = (ev) => {
      state = applyMessage(state, JSON.parse(ev.data));
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
      backoff = Math.min(backoff * 2, 8000); // exponential backoff (Tech §2.6)
    };
    ws.onerror = () => ws?.close();
  }
  open();

  return () => { closed = true; ws?.close(); };
}
