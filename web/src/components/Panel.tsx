// The shared panel chrome every dashboard card renders inside: title, framing and spacing.

/**
 * The dashboard's presentational components — map, timing tower, telemetry, comms, race control, the lap-delta overlay, and their shared layout/formatting helpers.
 * @packageDocumentation
 */
import type { ReactNode } from 'react';
import { ErrorBoundary } from '../ErrorBoundary';

// Panel is the shared instrument frame: a carbon-bordered box with an
// uppercase label plate along the top edge, and an optional actions slot
// (e.g. a per-lane status chip) right-aligned in that same plate.
export function Panel({ label, actions, className, id, collapsed, summary, children }: {
  label: string;
  actions?: ReactNode;
  // An extra class on the frame, for a panel whose GRID placement depends on its
  // contents — Telemetry spans two columns once a second car is in it.
  className?: string;
  // Makes the panel a jump target for the phone's section chips. The <h2> becomes
  // programmatically focusable (tabIndex -1, never a tab stop) so a jump can move
  // keyboard focus to where the page scrolled to.
  id?: string;
  // On a phone, Comms and Race Control are reference material read on demand, and
  // together they were 480px of a 6.5-screen page. `collapsed` renders the panel as
  // a <details> that starts shut; `summary` is the always-visible one-line state
  // beside the label ("3 messages"), so a closed panel still says what is in it.
  // The caller passes it only on the phone — on wider screens the panel is the
  // plain open section it has always been.
  collapsed?: boolean;
  summary?: ReactNode;
  children: ReactNode;
}) {
  const classes = className ? `panel ${className}` : 'panel';
  const body = (
    <div className="panel-body">
      <ErrorBoundary
        fallback={<div className="empty">This panel hit an error — reload the page to restore it.</div>}
      >
        {children}
      </ErrorBoundary>
    </div>
  );

  if (collapsed) {
    return (
      <details className={`${classes} panel-collapsible`} id={id}>
        <summary className="panel-plate">
          <h2 tabIndex={id ? -1 : undefined}>{label}</h2>
          {summary != null && <span className="panel-summary">{summary}</span>}
          {actions}
        </summary>
        {body}
      </details>
    );
  }

  return (
    <section className={classes} id={id}>
      <header className="panel-plate">
        <h2 tabIndex={id ? -1 : undefined}>{label}</h2>
        {actions}
      </header>
      {body}
    </section>
  );
}
