// The shared page frame every route renders inside: skip link, heading, and the main
// landmark.

import { useEffect, useState, type ReactNode } from 'react';

// The panel entrance stagger is charming exactly once. It is keyed off .page, and
// a hash change remounts the whole route — so every tab switch replayed the full
// 240ms + 180ms cascade and made navigation feel slower than it is. Module scope,
// not state: the question is "has this app ever painted", not "has this component".
let firstPaint = true;

// Route is the shared page frame: the skip link (first focusable element on
// every route), the rail, and the <main> landmark the skip link targets. The
// route's <h1> lives inside StatusRail — visible, named after the route, and
// part of the masthead rather than a band above it (accessibility L-2). Panel
// titles are <h2> beneath it, so every route has one unbroken heading chain
// instead of a grid of untitled boxes.
//
// `title` is the long form of the same thing and now drives document.title,
// which is what a screen reader announces on navigation and what a browser tab,
// a bookmark and a shared link all show — none of which a hidden <h1> ever fed.
export function Route({ title, rail, children }: {
  title: string;
  rail: ReactNode;
  children: ReactNode;
}) {
  // Read once at mount and cleared in an effect: React's rules put a write to a
  // module variable outside render, and the next route only mounts after this
  // one's effects have run, so the flag is already down by then.
  const [intro] = useState(() => firstPaint);
  useEffect(() => { firstPaint = false; }, []);
  useEffect(() => { document.title = `${title} · F1 Race Tracker`; }, [title]);
  return (
    <div className={intro ? 'page page-intro' : 'page'}>
      <a className="skip-link" href="#main">Skip to content</a>
      {rail}
      <main id="main" className="route-main">{children}</main>
    </div>
  );
}
