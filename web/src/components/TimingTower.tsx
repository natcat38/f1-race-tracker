import { useEffect, useRef, useState } from 'react';
import type { RaceState } from '../state/race';
import {
  fmtLap, fmtSec, fmtGap, gapLabel, intLabel,
  orderCars, bestSectors, updatePersonalBests, sectorColour, sectorDelta,
  TYRE_COLOUR, tyreLabel, statusLabel, sectorDeltaVs, fmtSigned, sectorMark,
} from './timingHelpers';
import type { Bests } from './timingHelpers';

export function TimingTower({
  state, selected, onSelect,
}: {
  state: RaceState;
  selected: number | null;
  onSelect: (driverNum: number) => void;
}) {
  const [secondsMode, setSecondsMode] = useState(false);
  const [pb, setPb] = useState<Bests>({});
  const pbRef = useRef<Bests>({});
  const sessionRef = useRef(state.session);
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
    const over = el.scrollWidth > el.clientWidth + 1;
    setScrollable((s) => (s === over ? s : over));
  });

  useEffect(() => {
    // New session (e.g. replay <-> live switch): drop the previous clip's
    // personal bests so sector colours don't bleed across datasets.
    if (sessionRef.current !== state.session) {
      sessionRef.current = state.session;
      pbRef.current = {};
    }
    const next = updatePersonalBests(pbRef.current, orderCars(state.cars));
    pbRef.current = next;
    setPb(next);
  }, [state.rev, state.session]); // eslint-disable-line react-hooks/exhaustive-deps

  const order = orderCars(state.cars);
  if (order.length === 0) {
    return <div className="empty">No cars yet — the timing tower fills in when data arrives.</div>;
  }
  const [b1, b2, b3] = bestSectors(order);
  const cellColour = (v: number | undefined, best: number, dn: number, i: number) => {
    const c = sectorColour(v, best, pb[dn]?.[i] ?? Infinity);
    return c ? { color: c } : undefined;
  };
  const cellMark = (v: number | undefined, best: number, dn: number, i: number) =>
    sectorMark(v, best, pb[dn]?.[i] ?? Infinity);
  // With a reference car selected, every OTHER row's delta compares against
  // that car's same sector (the rival-relative question a race engineer asks)
  // instead of this driver's own personal best.
  const refCar = selected != null ? state.cars[selected] : undefined;
  const refSectors: (number | undefined)[] = refCar ? [refCar.s1Ms, refCar.s2Ms, refCar.s3Ms] : [];
  const cellDelta = (v: number | undefined, dn: number, i: number) =>
    refCar && dn !== selected
      ? sectorDeltaVs(v, refSectors[i])
      : sectorDelta(v, pb[dn]?.[i] ?? Infinity);

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
    <button
      type="button"
      onClick={() => setSecondsMode((m) => !m)}
      // A stable label plus aria-pressed, rather than a label that swaps between
      // "Show seconds" and "Show laps": with a swapping label there is no state to
      // report non-visually, and the button reads as an action whose current
      // setting is invisible.
      aria-pressed={secondsMode}
      className={secondsMode ? 'btn btn-active' : 'btn'}
      style={{ marginBottom: 6 }}
    >
      Gaps in seconds
    </button>
    <div
      className="tt-scroll"
      ref={scrollRef}
      tabIndex={scrollable ? 0 : -1}
      role={scrollable ? 'group' : undefined}
      aria-label={scrollable ? 'Timing tower — scroll sideways for the remaining columns' : undefined}
    >
    <table className="tt-table">
      <thead>
        <tr>
          <th scope="col">#</th>
          <th scope="col">Driver</th>
          <th scope="col">Gap</th>
          <th scope="col">Int</th>
          <th scope="col">Last</th>
          <th scope="col">Best</th>
          <th scope="col">Tyre</th>
          <th scope="col">S1</th>
          <th scope="col">S2</th>
          <th scope="col">S3</th>
        </tr>
      </thead>
      <tbody>
        {order.map((c, idx) => {
          // Number rows by their place in the sorted order, not the raw feed
          // pos: a duplicated pos would otherwise print the same number twice
          // and skip one entirely.
          const isLeader = idx === 0;
          const ahead = order[idx - 1];
          const isSel = c.driverNum === selected;
          const status = statusLabel(c.status);
          return (
            <tr
              key={c.driverNum}
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
              // Row-wide click is a mouse convenience layered over the real control.
              // Clicks that came from the button are its own to handle, so the
              // selection is not applied twice for one activation.
              onClick={(e) => {
                if ((e.target as HTMLElement).closest('.tt-select')) return;
                onSelect(c.driverNum);
              }}
            >
              <td>{idx + 1}</td>
              <td>
                <button
                  type="button"
                  className="tt-select"
                  ref={(el) => { btnRefs.current.set(c.driverNum, el); }}
                  aria-pressed={isSel}
                  tabIndex={c.driverNum === rovingDriver ? 0 : -1}
                  onFocus={() => setFocusedDriver(c.driverNum)}
                  onKeyDown={(e) => onRowKeyDown(e, c.driverNum)}
                  onClick={() => onSelect(c.driverNum)}
                >
                  <b>{c.code}</b>
                  <span className="visually-hidden">
                    {isSel ? ' — reference car' : ' — set as reference car'}
                  </span>
                </button>
              </td>
              {status ? (
                <>
                  <td style={{ color: c.status === 'Pit' ? TYRE_COLOUR.MEDIUM : 'var(--slate)' }}>{status}</td>
                  <td>—</td>
                </>
              ) : (
                <>
                  <td title="best-effort, derived">{gapLabel(c.gapMs, c.gapLaps, isLeader, secondsMode, c.lastLapMs)}</td>
                  <td title="best-effort, derived">{intLabel(c.gapLaps, ahead?.gapLaps, c.intMs, isLeader, secondsMode, c.lastLapMs, ahead?.lastLapMs)}</td>
                </>
              )}
              <td>{fmtLap(c.lastLapMs)}</td>
              <td>{fmtLap(c.bestLapMs)}</td>
              <td style={{ color: TYRE_COLOUR[c.tyre ?? ''] ?? 'var(--chalk)' }}>
                {tyreLabel(c.tyre, c.tyreAge)}
              </td>
              {([[c.s1Ms, b1, 0], [c.s2Ms, b2, 1], [c.s3Ms, b3, 2]] as const).map(([v, best, i]) => {
                const d = cellDelta(v, c.driverNum, i);
                const mark = cellMark(v, best, c.driverNum, i);
                const rivalMode = !!refCar && c.driverNum !== selected;
                return (
                  <td key={i} style={cellColour(v, best, c.driverNum, i)}>
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
      Gap / Int are estimates derived from track position, not official timing.
      {refCar && ` Choose a driver to set the reference car — sector deltas compare against ${refCar.code}.`}
    </div>
    <div className="empty tt-note tt-legend">
      {([['SOFT', 'S Soft'], ['MEDIUM', 'M Medium'], ['HARD', 'H Hard'],
         ['INTERMEDIATE', 'I Inter'], ['WET', 'W Wet']] as const).map(([t, label]) => (
        <span key={t} style={{ color: TYRE_COLOUR[t] }}>{label}</span>
      ))}
      {/* The S/P glyph is the colour-blind-safe half of the sector-best signal,
          but its meaning used to live only in a title attribute on a superscript
          — unreachable on touch. It gets a visible legend like the compounds do. */}
      <span>S = session best · P = personal best</span>
    </div>
    </div>
  );
}
