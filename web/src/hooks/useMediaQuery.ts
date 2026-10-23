// Subscribes to a CSS media query so JavaScript can render a different structure
// where a stylesheet cannot, and names the one phone breakpoint both share.

import { useCallback, useSyncExternalStore } from 'react';

/**
 * The phone breakpoint. Must match the `@media (max-width: 700px)` phone-rail
 * block in components.css: CSS lays the strip out, this decides which nodes the
 * strip contains, and the two have to flip at the same width.
 */
export const PHONE_QUERY = '(max-width: 700px)';

/**
 * Whether `query` currently matches. False on the server and wherever
 * `matchMedia` does not exist (jsdom), so tests render the desktop tree unless
 * they stub it.
 */
export function useMediaQuery(query: string): boolean {
  // Stable identities: App re-renders every animation frame during a replay, and
  // a fresh `subscribe` each time would unsubscribe and resubscribe at 60 Hz.
  const subscribe = useCallback((onChange: () => void) => {
    if (typeof matchMedia !== 'function') return () => {};
    const mq = matchMedia(query);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [query]);
  const getSnapshot = useCallback(
    () => typeof matchMedia === 'function' && matchMedia(query).matches,
    [query],
  );
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
