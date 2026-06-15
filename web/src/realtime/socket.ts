import { applyMessage, emptyState, type RaceState } from '../state/race';

// connectRace opens a reconnecting WebSocket. onState is called with the latest
// RaceState on every message. Returns a close function.
export function connectRace(onState: (s: RaceState) => void): () => void {
  let state = emptyState();
  let ws: WebSocket | null = null;
  let closed = false;
  let backoff = 500;

  const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;

  function open() {
    ws = new WebSocket(url);
    ws.onopen = () => { backoff = 500; };
    ws.onmessage = (ev) => {
      state = applyMessage(state, JSON.parse(ev.data));
      onState(state);
    };
    ws.onclose = () => {
      if (closed) return;
      setTimeout(open, backoff);
      backoff = Math.min(backoff * 2, 8000); // exponential backoff (Tech §2.6)
    };
    ws.onerror = () => ws?.close();
  }
  open();

  return () => { closed = true; ws?.close(); };
}
