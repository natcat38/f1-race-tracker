import { useSyncExternalStore } from 'react';

const QUERY = '(prefers-reduced-motion: reduce)';

function subscribe(onChange: () => void) {
  if (typeof matchMedia !== 'function') return () => {};
  const mq = matchMedia(QUERY);
  mq.addEventListener('change', onChange);
  return () => mq.removeEventListener('change', onChange);
}

const getSnapshot = () => typeof matchMedia === 'function' && matchMedia(QUERY).matches;

// CSS handles the declarative animations; this is for the two places motion is
// driven from JS (the map's rAF interpolation and the ghost's playback loop),
// which a media query cannot reach. Subscribed rather than read once, so a
// mid-session OS change takes effect without a reload.
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
