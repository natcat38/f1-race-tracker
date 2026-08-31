// The timing tower: the running order with gaps, interval, lap times, sectors and
// tyres.

import { useEffect, useRef, useState } from 'react';
import type { RaceState } from '../state/race';
import {
  fmtLap, fmtSec, fmtGap, gapLabel, intLabel,
  orderCars, bestSectors, updatePersonalBests, personalBestOf, sectorColour, sectorDelta,
  TYRE_COLOUR, TYRE_LEGEND, tyreLabel, statusLabel, sectorDeltaVs, fmtSigned, sectorMark,
  updateGapSmoothing, displayGaps, hasNoData, holdOrder,
} from './timingHelpers';
import type { Bests, GapSmoothing } from './timingHelpers';
import { teamColour } from './teamColours';
import { SegmentedControl } from './SegmentedControl';
import { CopyButton } from './CopyButton';

const GAP_UNIT_OPTIONS = [
  { key: 'laps', label: 'Laps' },
  { key: 'seconds', label: 'Seconds' },
] as const;

// The header row, in order. A list rather than ten literals because the phone
// layout reads the same names back out of each cell's data-label.
const COLUMNS = ['#', 'Driver', 'Gap', 'Int', 'Last', 'Best', 'Tyre', 'S1', 'S2', 'S3'] as const;

// One sentence, on both estimated columns, saying what they are and how good
// they are. "best-effort, derived" said the first half only. The tenth is measured,
// not claimed: see ingest/README.md's validation against official crossing times.
const GAP_TITLE = 'Estimated from track position and the leader’s own pace, to about a tenth of a second — not official timing';

export function TimingTower({
  state, selected, onSelect,
}: {
  state: RaceState;
  selected: number | null;
  // null clears the reference car. Selection used to be a one-way door: once a
  // row was clicked the sector deltas switched to rival-relative for the rest of
  // the session, and only a page reload — which also loses the lane, the comms
  // toggle and the gap units — put them back.
  onSelect: (driverNum: number | null) => void;
}) {
  const [secondsMode, setSecondsMode] = useState(false);
  const [pb, setPb] = useState<Bests>({});
  const pbRef = useRef<Bests>({});
  const sessionRef = useRef(state.session);
  const loopRef = useRef(state.loopSeq);
  // The rolling windows behind the Gap/Int columns — see displayGaps.
  const [smoothing, setSmoothing] = useState<GapSmoothing>({});
  const smoothingRef = useRef<GapSmoothing>({});
  // The running order re-sorts on every 10 Hz frame, so a row can move out from
  // under the pointer between aiming and clicking — during the UX review a click
  // aimed at PIA landed on SAI. While the pointer is over the table the order is
  // held; the VALUES in every row keep updating, only the sequence is pinned.
  const [heldOrder, setHeldOrder] = useState<number[] | null>(null);
  // Roving tabindex (below) tracked by driver number, not row index: the running
  // order re-sorts on every 10 Hz frame, so an index-based tab stop would wander
  // between drivers while the user is reading. Keyed by driver, the stop follows
  // the car — and because each row's React key is the driver number, the focused
  // DOM node survives the reorder too.
  const [focusedDriver, setFocusedDriver] = useState<number | null>(null);
  const btnRefs = useRef(new Map<number, HTMLButtonElement | null>());
  // A scrolling region has to be keyboard-operable or its off-screen columns are
  // mouse-only (WCAG 2.1.1) — but a focusable div with nothing to scroll is just a
  // dead tab stop, so it becomes focusable only when the table actually overruns.
  // The column drops in components.css keep that rare; a user who has raised their
  // browser's default font size is the case that still hits it, which is exactly
  // the user who can least afford a silently clipped column.
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollable, setScrollable] = useState(false);
  // Deliberately unkeyed: this runs after every render, which for the tower means
  // ~10 times a second. A ResizeObserver looks tidier but misses the case that
  // matters most — raising the browser's default font size widens the table's
  // CONTENT while its border box, pinned at width:100%, never changes — and the
  // tower renders empty copy before the first frame, so a mount-time observer
  // finds no element at all. The functional updater returns the same value when
  // nothing changed, so React bails out and this costs one layout read per frame.
  // The lint rule's worry (an unkeyed effect that sets state loops forever) does not
  // apply: the updater bails out on no change, and flipping tabIndex/role does not
  // affect layout, so the measurement cannot oscillate.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    // A DEADBAND, not a single threshold. This effect runs after every render —
    // ~10 times a second — and the table's content width moves by a pixel or two
    // between frames as digits change. With one threshold, a table sitting on the
    // boundary flips the flag on alternate renders, and because each flip is a
    // setState from an effect that then runs again, a burst (a clip wrap changes
    // every sector cell at once) can chain far enough to trip React's nested
    // update guard. Turning on needs 4px of real overflow; turning off needs the
    // table to actually fit — so the two cannot alternate on a 1px wobble.
    setScrollable((s) => {
      const over = el.scrollWidth - el.clientWidth;
      const next = s ? over > 0 : over > 4;
      return s === next ? s : next;
    });
  });

  useEffect(() => {
    // New session (e.g. replay <-> live switch): drop the previous clip's
    // personal bests so sector colours don't bleed across datasets.
    //
    // A clip WRAP is the same problem inside one session, and it was missed: the
    // recording restarts, every driver drives the same sectors again, and their
    // bests from the previous pass are still standing — so on lap two of the loop
    // nothing can be a personal best until a driver beats a time set in a pass
    // the viewer never saw. Green stops meaning anything. Same reset, same reason.
    if (sessionRef.current !== state.session || loopRef.current !== state.loopSeq) {
      sessionRef.current = state.session;
      loopRef.current = state.loopSeq;
      pbRef.current = {};
      smoothingRef.current = {};
    }
    const cars = orderCars(state.cars);
    const next = updatePersonalBests(pbRef.current, cars);
    pbRef.current = next;
    setPb(next);
    // Returns the same reference when no window moved, so this is a no-op render
    // for most of the ten ticks a second.
    const sm = updateGapSmoothing(smoothingRef.current, cars);
    if (sm !== smoothingRef.current) {
      smoothingRef.current = sm;
      setSmoothing(sm);
    }
  }, [state.rev, state.session, state.loopSeq]); // eslint-disable-line react-hooks/exhaustive-deps

  const live = orderCars(state.cars);
  const order = heldOrder ? holdOrder(live, heldOrder) : live;
  if (order.length === 0) {
    return <div className="empty">No cars yet — the timing tower fills in when data arrives.</div>;
  }
  const [b1, b2, b3] = bestSectors(order);
  // Smoothed and made consistent with the running order — the raw per-car
  // estimates jitter ±0.6 s between frames and can come out non-monotonic.
  const gaps = displayGaps(order, smoothing);
  // personalBestOf, not a raw lookup: it withholds the personal best until the
  // driver has actually set two times in that sector, so the first observation of
  // a sector no longer paints itself green for tying a record it just invented.
  const cellColour = (v: number | undefined, best: number, dn: number, i: number) => {
    const c = sectorColour(v, best, personalBestOf(pb, dn, i));
    return c ? { color: c } : undefined;
  };
  const cellMark = (v: number | undefined, best: number, dn: number, i: number) =>
    sectorMark(v, best, personalBestOf(pb, dn, i));
  // With a reference car selected, every OTHER row's delta compares against
  // that car's same sector (the rival-relative question a race engineer asks)
  // instead of this driver's own personal best.
  const refCar = selected != null ? state.cars[selected] : undefined;
  const refSectors: (number | undefined)[] = refCar ? [refCar.s1Ms, refCar.s2Ms, refCar.s3Ms] : [];
  const cellDelta = (v: number | undefined, dn: number, i: number) =>
    refCar && dn !== selected
      ? sectorDeltaVs(v, refSectors[i])
      : sectorDelta(v, personalBestOf(pb, dn, i));

  // The tower is one tab stop, not twenty: exactly one row button is reachable by
  // Tab and Arrow/Home/End move between them. Prefer wherever focus last was, then
  // the reference car, then the leader — so tabbing in lands somewhere meaningful.
  const inOrder = (dn: number | null) => dn != null && order.some((c) => c.driverNum === dn);
  const rovingDriver = inOrder(focusedDriver)
    ? focusedDriver
    : inOrder(selected) ? selected : order[0].driverNum;

  function moveFocus(from: number, to: number | 'first' | 'last') {
    const i = order.findIndex((c) => c.driverNum === from);
    if (i < 0) return;
    const nextIdx =
      to === 'first' ? 0
        : to === 'last' ? order.length - 1
          : Math.min(order.length - 1, Math.max(0, i + to));
    const dn = order[nextIdx].driverNum;
    setFocusedDriver(dn);
    btnRefs.current.get(dn)?.focus();
  }

  function onRowKeyDown(e: React.KeyboardEvent, dn: number) {
    // Enter and Space are left to the native <button>, which already activates on
    // both and swallows Space's page scroll.
    const step = { ArrowDown: 1, ArrowUp: -1, Home: 'first', End: 'last' } as const;
    const to = step[e.key as keyof typeof step];
    if (to === undefined) return;
    e.preventDefault();
    moveFocus(dn, to);
  }

  return (
    <div>
    {/* "Gaps in seconds" swapped its own label between "Show seconds" and "Show
        laps" — M13 found this was one of three different toggle idioms on one
        screen, and M14 found the label gave no scope: nineteen of twenty rows
        don't change, so pressing it looked like it did nothing. A labelled
        radiogroup names what it governs up front. */}
    <div style={{ marginBottom: 'var(--sp-2)' }}>
      <SegmentedControl
        scope="Gaps"
        ariaLabel="Gap units for lapped cars"
        options={GAP_UNIT_OPTIONS}
        value={secondsMode ? 'seconds' : 'laps'}
        onPick={(key) => setSecondsMode(key === 'seconds')}
      />
    </div>
    <div
      className="tt-scroll"
      ref={scrollRef}
      tabIndex={scrollable ? 0 : -1}
      role={scrollable ? 'group' : undefined}
      aria-label={scrollable ? 'Timing tower — scroll sideways for the remaining columns' : undefined}
      // Mouse only: on a touch screen pointerenter fires on the tap itself, so a
      // touch user would pin the order by reading the table and never release it.
      onPointerEnter={(e) => { if (e.pointerType === 'mouse') setHeldOrder(live.map((c) => c.driverNum)); }}
      onPointerLeave={(e) => { if (e.pointerType === 'mouse') setHeldOrder(null); }}
    >
    {/* Explicit roles that duplicate what <table> already implies. They are
        redundant on the desktop layout and load-bearing on the phone one: below
        ~560px the container query turns every row into a card, and changing a
        table element's `display` is exactly what makes a browser drop its
        implicit table/row/cell roles. Naming them keeps the semantics agent 2
        restored from being undone by a layout rule. */}
    <table className="tt-table" role="table">
      <thead>
        <tr role="row">
          {COLUMNS.map((c) => (
            <th key={c} scope="col" role="columnheader">{c}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {order.map((c, idx) => {
          const g = gaps[idx] ?? {};
          // Number rows by their place in the sorted order, not the raw feed
          // pos: a duplicated pos would otherwise print the same number twice
          // and skip one entirely.
          const isLeader = idx === 0;
          const ahead = order[idx - 1];
          const isSel = c.driverNum === selected;
          // A car the feed carries but has said nothing about used to render as
          // six em-dashes with no explanation; NO DATA reads as a known state.
          const status = statusLabel(c.status) ?? (!isLeader && hasNoData(c) ? 'NO DATA' : undefined);
          return (
            <tr
              key={c.driverNum}
              role="row"
              // No role and no tabIndex on the <tr>. role="button" used to sit here
              // and it flattened the whole table body: a button has a presentational
              // children content model, so every <td> lost its cell role, the ten
              // <th scope="col"> headers associated with nothing, and each row was
              // announced as one 66-character run-on ("1PIALEADER—1:24.748…").
              // The control now lives in the Driver cell, which keeps the table a
              // table and gives every row a short, correct accessible name.
              // No aria-selected either: a plain <tr> is not in a grid or listbox,
              // so the attribute would be invalid ARIA here — the button's
              // aria-pressed carries the state instead.
              className={
                `tt-row${isSel ? ' tt-row-selected' : ''}${c.status === 'Out' ? ' tt-row-out' : ''}`
              }
              // The constructor key the map has always had and the tower never
              // did, so the board's two hero surfaces finally share one identity
              // system: a dot on the map and a row in the tower are tied by
              // colour. It lands as a 3px rule on the position cell rather than
              // on the driver code itself — Haas (#B6BABD) and AlphaTauri
              // (#2B4562) are among the constructor hexes that miss the text
              // contrast floor on carbon, and a rule carries the key without
              // spending any of it.
              style={{ '--team': teamColour[c.team] ?? 'transparent' } as React.CSSProperties}
              // Row-wide click is a mouse convenience layered over the real control.
              // Clicks that came from the button are its own to handle, so the
              // selection is not applied twice for one activation.
              onClick={(e) => {
                if ((e.target as HTMLElement).closest('.tt-select')) return;
                onSelect(isSel ? null : c.driverNum);
              }}
            >
              <td role="cell" data-label="Pos">{idx + 1}</td>
              <td role="cell" data-label="Driver">
                <button
                  type="button"
                  className="tt-select"
                  ref={(el) => { btnRefs.current.set(c.driverNum, el); }}
                  aria-pressed={isSel}
                  tabIndex={c.driverNum === rovingDriver ? 0 : -1}
                  onFocus={() => setFocusedDriver(c.driverNum)}
                  onKeyDown={(e) => onRowKeyDown(e, c.driverNum)}
                  onClick={() => onSelect(isSel ? null : c.driverNum)}
                >
                  <b>{c.code}</b>
                  <span className="visually-hidden">
                    {isSel ? ' — reference car, choose again to clear' : ' — set as reference car'}
                  </span>
                </button>
              </td>
              {status ? (
                <>
                  {/* --pit, not the medium-compound yellow: "in the pit lane" is a
                      race state, and borrowing a tyre colour for it meant the
                      swatch and the indicator could never be tuned apart. */}
                  <td role="cell" data-label="Gap" style={{ color: c.status === 'Pit' ? 'var(--pit)' : 'var(--slate)' }}>{status}</td>
                  <td role="cell" data-label="Int">—</td>
                </>
              ) : (
                <>
                  {/* g.gapMs / g.intMs, not the raw wire values: smoothed over a
                      half-second window and reconciled with the running order,
                      then printed at the estimator's real resolution. */}
                  <td role="cell" data-label="Gap" title={GAP_TITLE}>{gapLabel(g.gapMs, c.gapLaps, isLeader, secondsMode, c.lastLapMs)}</td>
                  <td role="cell" data-label="Int" title={GAP_TITLE}>{intLabel(c.gapLaps, ahead?.gapLaps, g.intMs, isLeader, secondsMode, c.lastLapMs, ahead?.lastLapMs)}</td>
                </>
              )}
              <td role="cell" data-label="Last">{fmtLap(c.lastLapMs)}</td>
              {/* Best is the one derived, rarely-watched readout on the row, so
                  it is where the variable weight axis earns its keep: 300 and
                  --slate recede it without hiding it. A class rather than a
                  :nth-child rule so .tt-row-out's dimming still outranks it. */}
              <td role="cell" data-label="Best" className="tt-quiet">{fmtLap(c.bestLapMs)}</td>
              <td role="cell" data-label="Tyre" style={{ color: TYRE_COLOUR[c.tyre ?? ''] ?? 'var(--chalk)' }}>
                {tyreLabel(c.tyre, c.tyreAge)}
              </td>
              {([[c.s1Ms, b1, 0], [c.s2Ms, b2, 1], [c.s3Ms, b3, 2]] as const).map(([v, best, i]) => {
                const d = cellDelta(v, c.driverNum, i);
                const mark = cellMark(v, best, c.driverNum, i);
                const rivalMode = !!refCar && c.driverNum !== selected;
                return (
                  <td key={i} role="cell" data-label={`S${i + 1}`} style={cellColour(v, best, c.driverNum, i)}>
                    {fmtSec(v)}
                    {mark && (
                      <sup className="tt-mark" title={mark === 'S' ? 'Session best' : 'Personal best'}>
                        {mark}
                      </sup>
                    )}
                    {/* Always rendered, even when empty: the delta used to appear
                        only once a reference car was picked, which grew the table
                        by ~40px and pushed S3 off the edge at the exact moment the
                        user asked for more sector detail. Reserving the width keeps
                        the table the same size selected or not. */}
                    <sup
                      className={
                        `tt-delta${d !== undefined && rivalMode && d < 0 ? ' tt-delta-good' : ''}`
                      }
                    >
                      {d === undefined ? '' : rivalMode ? fmtSigned(d) : fmtGap(d)}
                    </sup>
                  </td>
                );
              })}
            </tr>
          );
        })}
      </tbody>
    </table>
    </div>
    <div className="empty tt-note">
      {/* Rounded to one decimal because that is the resolution the estimate has:
          the wire's values come out quantised to ~0.566s, so the three decimals
          this column used to print were three digits of invented precision. */}
      Gap / Int are estimated from track position and shown to 0.1s — not official timing.
      {heldOrder && ' Order held while you point at the tower.'}
    </div>
    {/* The hint used to be gated on refCar, so it appeared only AFTER the user
        had already found the interaction — the one moment it could not help. It
        now states the invitation up front and becomes the status line (with a way
        back out) once a reference car is set. */}
    <div className="empty tt-note">
      {refCar ? (
        <>
          Sector deltas compare against <b>{refCar.code}</b>.{' '}
          <button type="button" className="tt-clear" onClick={() => onSelect(null)}>
            Clear reference car
          </button>
          <span className="tt-hint-key"> (or press Esc)</span>
          {' '}
          {/* Deep links (?car=) had no UI at all (ui-ux item 6) — App.tsx already
              keeps the URL in sync with the reference car via replaceState, so the
              current href is always the shareable link the moment a car is set. */}
          <CopyButton
            getText={() => location.href}
            label="Copy link"
            copiedLabel="✓ link copied"
            className="btn tt-clear"
            ariaLabel={`Copy link to ${refCar.code}`}
          />
        </>
      ) : (
        'Choose a driver row to set the reference car — sector deltas then compare against it.'
      )}
    </div>
    <div className="empty tt-note tt-legend">
      {TYRE_LEGEND.map(([t, label]) => (
        <span key={t} style={{ color: TYRE_COLOUR[t] }}>{label}</span>
      ))}
      {/* The S/P glyph is the colour-blind-safe half of the sector-best signal,
          but its meaning used to live only in a title attribute on a superscript
          — unreachable on touch. It gets a visible legend like the compounds do. */}
      <span>S = session best · P = personal best</span>
    </div>
    {/* The ghost overlay was reachable only from the OVERLAY rail tab, with no
        pointer from the board itself (ui-ux item 2, Nielsen #6). One line, next
        to the reference-car hint it complements rather than a coach mark. */}
    <div className="empty tt-note">
      <a className="demo-notice-link" href="#ghost">Compare laps in the overlay →</a>
    </div>
    </div>
  );
}
