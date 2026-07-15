import type { ReactNode } from 'react';

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
        <span>{label}</span>
        {actions}
      </header>
      <div className="panel-body">{children}</div>
    </section>
  );
}
