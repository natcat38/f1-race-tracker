// A shell command shown as code with a copy button beside it.

import { CopyButton } from './CopyButton';

// The one control a setup page owes its reader: the commands on the Settings and
// How this runs pages are meant to be run somewhere else, and selecting mono text
// out of a wrapped paragraph by hand is the whole friction. The copy button (and
// its success/failure live-region feedback, ui-ux item 9b) is CopyButton, shared
// with the board's and overlay's "Copy link" buttons (ui-ux item 6) instead of a
// second copy of the same logic.
// children: string (not ReactNode) is load-bearing — it is what lets the
// aria-label below interpolate the command text directly. Widening this to
// ReactNode would make `Copy: ${children}` render "[object Object]" at every
// call site (ui-ux item 9c) with no compile-time warning.
export function Cmd({ children }: { children: string }) {
  return (
    <span className="cmd">
      <code>{children}</code>
      <CopyButton
        getText={() => children}
        label="copy"
        className="btn cmd-copy"
        ariaLabel={`Copy: ${children}`}
      />
    </span>
  );
}
