import { applyMessage, emptyState, parseMsg, type RaceState } from '../state/race';

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
    ws.onerror = (ev) => {
      console.error('connectRace: socket error', ev);
      ws?.close();
    };
  }
  open();

  return () => { closed = true; ws?.close(); };
}
