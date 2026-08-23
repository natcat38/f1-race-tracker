// The rail's one control grammar for a choice between persistent states: a
// labelled radiogroup of .btn segments with roving tabindex.

import { useRef } from 'react';

export interface Segment {
  key: string;
  label: string;
  /** Honest small print. Rendered visually-hidden inside the segment and as its title. */
  caveat?: string;
}

// Two idioms share the rail and they must never be confused for one another:
// a segmented control is a *pick* between states that persist (LANE: REPLAY |
// LIVE), and a plain .btn is a momentary verb that names what it will do
// (⏸ FREEZE). Anything that is a pick comes through here, so the pick always
// arrives with the same keyboard contract and the same visible scope label —
// ui-ux M13/M14's finding was that a bare toggle never says what it is toggling.
export function SegmentedControl({
  scope, ariaLabel, options, value, pending, disabled, onPick,
}: {
  /** Visible scope label — the group naming what it governs, e.g. "LANE". */
  scope: string;
  ariaLabel: string;
  options: readonly Segment[];
  value: string;
  /** Key of the option whose switch is in flight, if any. */
  pending?: string | null;
  disabled?: boolean;
  onPick: (key: string) => void;
}) {
  const refs = useRef(new Map<string, HTMLButtonElement | null>());
  // Falls back to the first option so the group is always reachable even when
  // the current value is neither of them: a radiogroup every one of whose
  // members is tabIndex -1 is a radiogroup no keyboard can enter.
  const activeIdx = Math.max(0, options.findIndex((o) => o.key === value));

  function onKeyDown(e: React.KeyboardEvent, idx: number) {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 } as const;
    const d = step[e.key as keyof typeof step];
    if (d === undefined) return;
    e.preventDefault();
    const next = options[(idx + d + options.length) % options.length];
    refs.current.get(next.key)?.focus();
    onPick(next.key);
  }

  return (
    <div className="rail-segmented">
      {/* aria-hidden because the group already carries the same word in its
          accessible name — announcing "Lane, Lane, radio group" is noise. */}
      <span className="rail-scope" aria-hidden="true">{scope}</span>
      <div role="radiogroup" aria-label={ariaLabel} className="rail-segments">
        {options.map((o, i) => (
          <button
            key={o.key}
            type="button"
            role="radio"
            aria-checked={value === o.key}
            ref={(el) => { refs.current.set(o.key, el); }}
            tabIndex={i === activeIdx ? 0 : -1}
            onKeyDown={(e) => onKeyDown(e, i)}
            onClick={() => onPick(o.key)}
            disabled={disabled}
            className={value === o.key ? 'btn btn-active' : 'btn'}
            title={o.caveat}
          >
            {pending === o.key ? 'Switching…' : o.label}
            {/* Was title-only, so unreachable on touch and to anyone who never
                hovers — and this particular caveat is the honest one. */}
            {o.caveat && <span className="visually-hidden"> — {o.caveat}</span>}
          </button>
        ))}
      </div>
    </div>
  );
}
