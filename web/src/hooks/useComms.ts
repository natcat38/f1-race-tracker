import { useEffect, useRef, useState } from 'react';
import type { RaceState, RadioMessage } from '../state/race';
import { stepComms, isStale, type CommsCursor } from '../state/comms';

const HISTORY_MAX = 6;

// useComms drives the comms layer from the race state. It owns the on/off `enabled`
// flag, tracks the play cursor, queues fired clips into one <audio> element (FIFO),
// skips clips that have gone stale vs the race clock, and keeps a short newest-first
// history. `toggle()` is a click handler — the user gesture that unlocks autoplay.
export function useComms(state: RaceState) {
  const [enabled, setEnabled] = useState(false);
  const [nowPlaying, setNowPlaying] = useState<RadioMessage | null>(null);
  const [history, setHistory] = useState<RadioMessage[]>([]);
  // All refs declared before the helpers so nothing is used-before-defined (lint gate).
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const cursorRef = useRef<CommsCursor>({ lastClock: -1 });
  const queueRef = useRef<RadioMessage[]>([]);
  const lastRevRef = useRef<number>(-1);
  const nowPlayingRef = useRef<RadioMessage | null>(null);
  const enabledRef = useRef<boolean>(false); // read by the rev-effect without re-subscribing
  const clockRef = useRef<number>(0);        // latest race clock, read by pump's staleness check

  function pump() {
    const audio = audioRef.current;
    if (!audio || nowPlayingRef.current) return;
    let next = queueRef.current.shift();
    // Drop clips that have fallen too far behind the race clock (kept in history).
    while (next && isStale(next, clockRef.current)) next = queueRef.current.shift();
    if (!next) return;
    nowPlayingRef.current = next;
    setNowPlaying(next);
    audio.src = next.clip; // ponytail: no crossOrigin attr -> plays cross-origin without CORS
    // A late play() rejection (transient error, or an interrupting src change/AbortError)
    // must only clear the banner if this clip is still the current one — otherwise it
    // would blank the clip that has since replaced it.
    audio.play().catch(() => {
      if (nowPlayingRef.current !== next) return;
      nowPlayingRef.current = null;
      setNowPlaying(null);
    });
  }

  // Create the single audio element on mount and wire 'ended' to drain the queue.
  // Declared before the rev-effect so the element exists when pump() first runs.
  useEffect(() => {
    if (typeof Audio === 'undefined') return;
    const audio = new Audio();
    audioRef.current = audio;
    const onEnded = () => { nowPlayingRef.current = null; setNowPlaying(null); pump(); };
    audio.addEventListener('ended', onEnded);
    return () => { audio.removeEventListener('ended', onEnded); audio.pause(); };
  }, []);

  // On each state change, advance the cursor and enqueue fired clips.
  useEffect(() => {
    if (state.rev === 0) return;
    clockRef.current = state.timeMs;
    const justConnected = lastRevRef.current === -1; // seed history once on first snapshot
    lastRevRef.current = state.rev;

    const { cursor, fired, history: hist } = stepComms(
      cursorRef.current, state.timeMs, state.radio, justConnected,
    );
    cursorRef.current = cursor;

    if (justConnected && hist.length) {
      setHistory(hist.slice(-HISTORY_MAX).reverse()); // newest first
    }
    if (fired.length) {
      // history tracks regardless of enabled; only enabled enqueues audio.
      setHistory((h) => [...[...fired].reverse(), ...h].slice(0, HISTORY_MAX));
      if (enabledRef.current) {
        queueRef.current.push(...fired);
        pump();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.rev]);

  // toggle() runs from an onClick, so its setState calls are not cascading-render
  // hazards. Turning off stops audio and clears the queue + banner.
  function toggle() {
    if (enabledRef.current) {
      queueRef.current = [];
      audioRef.current?.pause();
      nowPlayingRef.current = null;
      setNowPlaying(null);
      enabledRef.current = false;
      setEnabled(false);
    } else {
      enabledRef.current = true;
      setEnabled(true);
    }
  }

  function replay(msg: RadioMessage) {
    const audio = audioRef.current;
    if (!audio) return;
    queueRef.current = []; // manual replay jumps the queue
    nowPlayingRef.current = msg;
    setNowPlaying(msg);
    audio.src = msg.clip;
    audio.play().catch(() => {
      if (nowPlayingRef.current !== msg) return; // a newer replay/clip already took over
      nowPlayingRef.current = null;
      setNowPlaying(null);
    });
  }

  return { enabled, toggle, nowPlaying, history, replay };
}
