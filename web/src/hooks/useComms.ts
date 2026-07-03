import { useEffect, useRef, useState } from 'react';
import type { RaceState, RadioMessage } from '../state/race';
import { stepComms, isStale, isAllowedClip, type CommsCursor } from '../state/comms';

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
  const lastSnapshotSeqRef = useRef<number>(-1);
  const nowPlayingRef = useRef<RadioMessage | null>(null);
  const enabledRef = useRef<boolean>(false); // read by the rev-effect without re-subscribing
  const clockRef = useRef<number>(0);        // latest race clock, read by pump's staleness check

  function pump() {
    const audio = audioRef.current;
    if (!audio || nowPlayingRef.current) return;
    let next = queueRef.current.shift();
    // Skip clips that are stale vs the race clock or have a disallowed URL (kept in history).
    while (next && (isStale(next, clockRef.current) || !isAllowedClip(next.clip))) {
      if (!isAllowedClip(next.clip)) console.warn('comms: skipping clip with disallowed URL', next.clip);
      next = queueRef.current.shift();
    }
    if (!next) return;
    nowPlayingRef.current = next;
    setNowPlaying(next);
    audio.src = next.clip; // ponytail: no crossOrigin attr -> plays cross-origin without CORS
    // A late play() rejection (transient error, or an interrupting src change/AbortError)
    // must only clear the banner if this clip is still the current one — otherwise it
    // would blank the clip that has since replaced it.
    audio.play().catch((err) => {
      if (nowPlayingRef.current !== next) return;
      console.warn('comms: playback failed', next.clip, err);
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

  // On each state change, advance the cursor and enqueue fired clips. A snapshot
  // (initial connect, a reconnect, or a source switch) always reseeds the cursor
  // silently; only a steady-state frame "fires" newly-crossed messages. Driven by
  // snapshotSeq (not "have we ever seen a rev yet") so a mid-session reconnect is
  // caught too, not just the very first snapshot after mount.
  useEffect(() => {
    if (state.rev === 0) return;
    clockRef.current = state.timeMs;
    const isSnapshot = lastSnapshotSeqRef.current !== state.snapshotSeq;
    lastSnapshotSeqRef.current = state.snapshotSeq;

    const { cursor, fired, history: hist } = stepComms(
      cursorRef.current, state.timeMs, state.radio, isSnapshot,
    );
    cursorRef.current = cursor;

    if (isSnapshot && hist.length) {
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
  }, [state.rev, state.snapshotSeq]);

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
    if (!isAllowedClip(msg.clip)) {
      console.warn('comms: refusing to replay clip with disallowed URL', msg.clip);
      return;
    }
    queueRef.current = []; // manual replay jumps the queue
    nowPlayingRef.current = msg;
    setNowPlaying(msg);
    audio.src = msg.clip;
    audio.play().catch((err) => {
      if (nowPlayingRef.current !== msg) return; // a newer replay/clip already took over
      console.warn('comms: replay playback failed', msg.clip, err);
      nowPlayingRef.current = null;
      setNowPlaying(null);
    });
  }

  return { enabled, toggle, nowPlaying, history, replay };
}
