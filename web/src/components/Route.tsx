import { useEffect, useState, type ReactNode } from 'react';

// The panel entrance stagger is charming exactly once. It is keyed off .page, and
// a hash change remounts the whole route — so every tab switch replayed the full
// 240ms + 180ms cascade and made navigation feel slower than it is. Module scope,
// not state: the question is "has this app ever painted", not "has this component".
let firstPaint = true;

// Route is the shared page frame: the skip link (first focusable element on
// every route), the route's own <h1> — visually hidden because the status rail
// already carries the brand — and the <main> landmark the skip link targets.
// Panel titles are <h2> beneath it, so every route has one unbroken heading
// chain instead of a grid of untitled boxes.
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
  return (
    <div className={intro ? 'page page-intro' : 'page'}>
      <a className="skip-link" href="#main">Skip to content</a>
      <h1 className="visually-hidden">{title}</h1>
      {rail}
      <main id="main" className="route-main">{children}</main>
    </div>
  );
}
