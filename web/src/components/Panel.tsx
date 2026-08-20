/**
 * The dashboard's presentational components — map, timing tower, standings, telemetry, comms, race control, ghost/compare overlays, and their shared layout/formatting helpers.
 * @packageDocumentation
 */
import type { ReactNode } from 'react';
import { ErrorBoundary } from '../ErrorBoundary';

// Panel is the shared instrument frame: a carbon-bordered box with an
// uppercase label plate along the top edge, and an optional actions slot
// (e.g. a per-lane status chip) right-aligned in that same plate.
export function Panel({ label, actions, children }: {
  label: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="panel">
      <header className="panel-plate">
        <h2>{label}</h2>
        {actions}
      </header>
      <div className="panel-body">
        <ErrorBoundary
          fallback={<div className="empty">This panel hit an error — reload the page to restore it.</div>}
        >
          {children}
        </ErrorBoundary>
      </div>
    </section>
  );
}
