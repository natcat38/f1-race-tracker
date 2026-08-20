import type { ReactNode } from 'react';

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
  return (
    <div className="page">
      <a className="skip-link" href="#main">Skip to content</a>
      <h1 className="visually-hidden">{title}</h1>
      {rail}
      <main id="main" className="route-main">{children}</main>
    </div>
  );
}
