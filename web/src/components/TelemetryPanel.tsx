// The selected car's telemetry readout: speed, gear, pedal bars and lap/gap sparklines.

import type { Car, RaceState } from '../state/race';
import { fmtLap, fmtGapEstimate, type LapHistory, type GapHistory } from './timingHelpers';

// Below this many points a sparkline is decoration: two bars with no axis convey
// nothing, and a single bar beside an em-dash reads as a rendering fault.
const MIN_SPARK_POINTS = 4;

// Throttle and brake are opposite inputs, so they read as opposite colours —
// both bars being green made a full-brake trace look like a full-throttle one
// at a glance.
function Bar({ label, value, tone }: { label: string; value: number; tone: 'good' | 'bad' }) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div className="tele-row">
      <span className="tele-label">{label}</span>
      {/* role="meter" (WIG best practice, not a WCAG conformance gap — label and
          value are both real visible text already) ties the bar, its value and
          its label into one readable unit for assistive tech instead of three
          disconnected nodes. */}
      <div
        role="meter"
        aria-label={`${label} ${value}%`}
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        style={{ flex: 1, height: 8, background: 'var(--edge)', borderRadius: 'var(--radius)' }}
      >
        <div style={{
          width: `${pct}%`, height: '100%',
          background: tone === 'good' ? 'var(--good)' : 'var(--bad)', borderRadius: 'var(--radius)',
        }} />
      </div>
      <span className="tele-value">{value}</span>
    </div>
  );
}

// Matches MAX_LAP_HISTORY / MAX_GAP_HISTORY in timingHelpers — the cap both
// series are sliced to, and so the widest a sparkline ever gets.
const MAX_SPARK_BARS = 8;
const BAR_W = 15;

// Sparkline: one bar per completed lap, red = slower than previous lap,
// green = faster — the stint-degradation squint test. Reused for the gap
// trend too, where the same colouring reads as "closing" (green) vs
// "opening" (red).
// The visual trend (up/down per bar, colour-coded) reduced to words: which way
// the series moved overall, and the value a sighted reader reads off the last
// bar — the two things the graphic conveys that the adjacent latest-value span
// (WCAG 1.1.1) does not, since that span only ever shows the final point.
function trendSummary(known: number[]) {
  if (known.length < 2) return '';
  const first = known[0], last = known[known.length - 1];
  const direction = last > first ? 'rising' : last < first ? 'falling' : 'flat';
  const min = Math.min(...known), max = Math.max(...known);
  return `, ${direction} over the last ${known.length} laps, ranging ${min} to ${max}`;
}

function Sparkline({ values, label }: { values: (number | undefined)[]; label: string }) {
  const known = values.filter((v): v is number => v != null);
  if (known.length === 0) return null;
  const min = Math.min(...known), max = Math.max(...known);
  const span = max - min || 1;
  const fullLabel = `${label}${trendSummary(known)}`;
  return (
    // minWidth reserves the full 8-lap span so the row does not reflow one bar at
    // a time as history accumulates. Not flex-pinned: the panel is already tight
    // when a rival card is open, and a hard floor there would push it wider still.
    <svg
      width={values.length * 15} height={24} role="img" aria-label={fullLabel}
      style={{ minWidth: MAX_SPARK_BARS * BAR_W }}
    >
      {values.map((v, i) => {
        if (v == null) return null;
        const h = 4 + ((v - min) / span) * 18;
        const prev = values[i - 1];
        const slower = i > 0 && prev != null && v > prev;
        // Colour alone would be the only signal for a red/green-blind reader, so
        // the worse bars also carry a hatch overlay — a shape difference that
        // survives any palette.
        return (
          <g key={i}>
            <rect x={i * 15} y={24 - h} width={11} height={h}
                  fill={slower ? 'var(--bad)' : 'var(--good)'} />
            {slower && (
              <rect x={i * 15} y={24 - h} width={11} height={h}
                    fill="url(#spark-hatch)" />
            )}
          </g>
        );
      })}
    </svg>
  );
}

// One shared hatch pattern for every Sparkline on the page.
function SparkHatch() {
  return (
    <svg width={0} height={0} aria-hidden="true" style={{ position: 'absolute' }}>
      <defs>
        <pattern id="spark-hatch" patternUnits="userSpaceOnUse" width={4} height={4}
                 patternTransform="rotate(45)">
          <rect width={4} height={4} fill="none" />
          <line x1={0} y1={0} x2={0} y2={4} stroke="var(--asphalt)" strokeWidth={1.5} />
        </pattern>
      </defs>
    </svg>
  );
}

function CarTelemetry({ car, history, gapHistory, role }: {
  car: Car; history?: number[]; gapHistory?: (number | undefined)[];
  role?: 'reference' | 'rival';
}) {
  const trend = (values: (number | undefined)[] | undefined) =>
    (values?.filter((v) => v != null).length ?? 0) >= MIN_SPARK_POINTS;
  return (
    // min-width: 0 (via the CSS class) rather than a 200px floor: two cards with
    // a hard floor could not shrink, so the second was clipped mid-word by the
    // panel edge at every viewport instead of the pair getting narrower.
    <div className="telemetry-card" style={{ display: 'grid', gap: 'var(--sp-2)' }}>
      {role && (
        <div className="telemetry-role">
          {role === 'reference' ? 'Reference car' : 'Rival'}
        </div>
      )}
      <div style={{ fontSize: 'var(--fs-lg)' }}>
        <b>{car.code}</b> <span style={{ color: 'var(--slate)' }}>{car.team}</span>
      </div>
      <div style={{ fontFamily: 'var(--display)', fontSize: 'var(--fs-hero)' }}>
        {car.speed ?? 0} <span style={{ fontSize: 'var(--fs-lg)', color: 'var(--slate)' }}>km/h</span>
        <span style={{ marginLeft: 'var(--sp-4)' }}>G{car.gear ?? 0}</span>
        {/* The off state used --edge (a border colour, 1.2:1) and was effectively
            invisible; --dim was raised from there to 3.4:1 and then, in this pass,
            to 4.8:1 — the threshold, not just an improvement on invisible.
            On/off was also signalled by colour alone, which the sector marks and
            the sparkline hatch elsewhere in this codebase already know not to do. */}
        <span style={{ marginLeft: 'var(--sp-4)', color: car.drs ? 'var(--good)' : 'var(--dim)' }}>
          DRS<span className="visually-hidden">{car.drs ? ' active' : ' inactive'}</span>
        </span>
      </div>
      <Bar label="Throttle" value={car.throttle ?? 0} tone="good" />
      <Bar label="Brake" value={car.brake ?? 0} tone="bad" />
      {trend(history) && history && (
        <div className="tele-row">
          <span className="tele-label">Laps</span>
          <Sparkline values={history} label={`${car.code} lap time trend`} />
          <span>{fmtLap(history[history.length - 1])}</span>
        </div>
      )}
      {trend(gapHistory) && gapHistory && (
        <div className="tele-row">
          <span className="tele-label">Gap</span>
          <Sparkline values={gapHistory} label={`${car.code} gap trend`} />
          {/* The derived gap, at the derived gap's resolution — same rule as the
              tower's Gap column. */}
          <span>{fmtGapEstimate(gapHistory[gapHistory.length - 1])}</span>
        </div>
      )}
      {!trend(history) && (
        <div className="empty" style={{ fontSize: 'var(--fs-sm)' }}>
          Lap and gap trends build after {MIN_SPARK_POINTS} laps.
        </div>
      )}
    </div>
  );
}

// TelemetryPanel takes the raw state + selection (rather than every car/history
// combination pre-looked-up by the caller) and does the primary/rival lookup
// once, itself, for both cars — instead of the caller duplicating the same
// `x != null ? lookup[x] : undefined` pattern once per car.
export function TelemetryPanel({
  state, lapHistory, gapHistory, selected, rival, onRivalChange,
}: {
  state: RaceState;
  lapHistory: LapHistory;
  gapHistory: GapHistory;
  selected: number | null;
  rival: number | null;
  onRivalChange?: (driverNum: number | null) => void;
}) {
  const car = selected != null ? state.cars[selected] : undefined;
  if (!car) {
    return <div className="empty">Select a car to see telemetry</div>;
  }
  const rivalCar = rival != null ? state.cars[rival] : undefined;
  const others = Object.values(state.cars).filter((c) => c.driverNum !== car.driverNum);
  return (
    <div style={{ display: 'grid', gap: 'var(--sp-2)' }}>
      <SparkHatch />
      {others.length > 0 && onRivalChange && (
        <label style={{ fontSize: 'var(--fs-xs)', color: 'var(--slate)', display: 'flex', alignItems: 'center', gap: 'var(--sp-2)' }}>
          {/* "vs" said nothing about what the control does; the empty option said
              what the state IS rather than offering the action. */}
          Compare with
          {/* `rival` here is already the caller's *effective* rival (App.tsx
              collapses it to null when it matches the primary selection) — so
              this reflects the same value the card below is keyed on. Without
              that collapse the select would keep showing a rival the card no
              longer renders, a control disagreeing with the view (ui-ux 14b).
              onRivalChange still writes the raw, un-collapsed rival state. */}
          {/* .overlay-select, not .btn: .btn is transparent-background and left
              this the only select on the board styled that way — one idiom for
              a select, shared with the overlay's pickers (ui-ux item 11). */}
          <select
            value={rival ?? ''}
            onChange={(e) => onRivalChange(e.target.value ? Number(e.target.value) : null)}
            className="overlay-select"
            style={{ fontSize: 'var(--fs-xs)' }}
          >
            <option value="">— pick a rival —</option>
            {others.map((c) => (
              <option key={c.driverNum} value={c.driverNum}>{c.code}</option>
            ))}
          </select>
        </label>
      )}
      {/* A flex row that WRAPS, with shrinkable children: the two cards sit side
          by side wherever the panel can hold them and stack when it cannot,
          instead of the second being cut off by the panel border. */}
      <div className="telemetry-cards">
        <CarTelemetry
          car={car} history={lapHistory[car.driverNum]}
          gapHistory={gapHistory[car.driverNum]?.gaps}
          role={rivalCar ? 'reference' : undefined}
        />
        {rivalCar && (
          <CarTelemetry
            car={rivalCar} history={lapHistory[rivalCar.driverNum]}
            gapHistory={gapHistory[rivalCar.driverNum]?.gaps}
            role="rival"
          />
        )}
      </div>
    </div>
  );
}
