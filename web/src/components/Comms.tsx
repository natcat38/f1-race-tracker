// The team-radio layer: a now-playing banner over a short replayable history.

import type { CSSProperties } from 'react';
import type { RaceState } from '../state/race';
import { useComms } from '../hooks/useComms';
import { teamColour } from './teamColours';
import { fmtClock } from './timingHelpers';
import { SegmentedControl } from './SegmentedControl';

const RADIO_OPTIONS = [
  { key: 'off', label: 'Off' },
  { key: 'on', label: 'On' },
] as const;

// Comms is the toggleable team-radio layer: a now-playing banner + a short
// replayable history. Audio streams from F1's public URL (ADR-0003).
export function Comms({ state }: { state: RaceState }) {
  const { enabled, toggle, nowPlaying, history, replay, error } = useComms(state);

  function codeFor(driverNum: number) {
    return state.cars[driverNum]?.code ?? String(driverNum);
  }
  function colourFor(driverNum: number) {
    return teamColour[state.cars[driverNum]?.team ?? ''] ?? 'var(--slate)';
  }
  // Team colour as a border accent, not the text fill (WCAG 1.4.3) — shared by
  // the now-playing banner and every history row so the two sites can't drift.
  function accentStyle(driverNum: number): CSSProperties {
    return {
      color: 'var(--chalk)', fontWeight: 700, borderLeft: `3px solid ${colourFor(driverNum)}`,
      paddingLeft: 'var(--sp-1)',
    };
  }

  return (
    <div style={{ display: 'grid', gap: 'var(--sp-2)' }}>
      {/* "Comms ON"/"Comms OFF" was an ad-hoc toggle with no scope word — M13
          found three different toggle idioms on one screen. This is a pick
          between two persistent states, so it goes through the rail's one
          control grammar: a labelled radiogroup, same as the lane switch. */}
      <div style={{ justifySelf: 'start' }}>
        <SegmentedControl
          scope="Radio"
          ariaLabel="Team radio"
          options={RADIO_OPTIONS}
          value={enabled ? 'on' : 'off'}
          onPick={(key) => { if ((key === 'on') !== enabled) toggle(); }}
        />
      </div>

      {enabled && nowPlaying && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', padding: 'var(--sp-2) var(--sp-3)',
          background: 'var(--asphalt)', borderRadius: 'var(--radius)', fontSize: 'var(--fs-md)',
        }}>
          {/* Team colour as a border accent, not the text fill (WCAG 1.4.3): the
              AlphaTauri hex measured 1.97:1 on --asphalt / 1.82:1 on --carbon, both
              well under the 4.5:1 floor for this text size. Same pattern as the
              tower's constructor rule (components.css ~724-728) — colour identifies
              the team, --chalk keeps the code itself readable. */}
          <span style={accentStyle(nowPlaying.driverNum)}>
            {codeFor(nowPlaying.driverNum)}
          </span>
          <span style={{ color: 'var(--slate)' }}>radio</span>
          <button
            onClick={() => replay(nowPlaying)}
            className="btn btn-icon"
            style={{ border: 'none' }}
            aria-label="Replay current clip"
          >↻</button>
        </div>
      )}

      {/* The history is tracked whether or not comms is enabled (useComms keeps
          it either way), so the off state does not have to be an empty box —
          see the resting branch below. */}
      {history.length > 0 && (
        <div style={{ display: 'grid', gap: 'var(--sp-1)' }}>
          {/* The history used to be six identical "CODE ▶" rows: no time, no
              ordering stated, and no way to tell which one was playing — so there
              was no reason to press one button over another. */}
          <div className="empty" style={{ fontSize: 'var(--fs-sm)' }}>
            {enabled ? 'Newest first' : 'Recent radio — newest first'}
          </div>
          {history.map((m, i) => {
            const playing = nowPlaying?.clip === m.clip;
            return (
            <div
              key={`${m.timeMs}-${i}`}
              className={enabled ? 'comms-row' : 'comms-row comms-row-resting'}
            >
              <span style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtClock(m.timeMs)}</span>
              <span style={accentStyle(m.driverNum)}>{codeFor(m.driverNum)}</span>
              {/* No play button while comms is off. The clips are real and the
                  list is the substance of the resting state, but the one control
                  offered there has to be the toggle above — two ways to start
                  audio, one of which silently turns the feature on and one of
                  which does not, is a worse resting state than none. */}
              {enabled && (
                <button
                  onClick={() => replay(m)}
                  className="btn btn-icon"
                  style={{ border: 'none' }}
                  aria-label={`Play ${codeFor(m.driverNum)} radio from ${fmtClock(m.timeMs)}`}
                >▶</button>
              )}
              {enabled && playing && <span className="chip chip-replay">PLAYING</span>}
            </div>
            );
          })}
        </div>
      )}

      {/* Comms off used to be a single line explaining a setting — one of the two
          board panels that opened as an empty box describing a control
          (frontend-design item 6). With clips in hand the resting state shows
          what is being missed; with none, it still has to explain itself. */}
      {!enabled && (
        <div className="empty">
          {history.length > 0
            ? 'Press Comms to hear these as they arrive.'
            : 'Radio clips play automatically when comms is on.'}
        </div>
      )}
      {enabled && !nowPlaying && history.length === 0 && (
        <div className="empty">No radio yet — clips play as the replay reaches them.</div>
      )}
      {/* Announced, not just shown: a blocked or failed clip is the only feedback
          a click on ▶/↻ gives, and the button itself does not change. */}
      <div role="status" aria-live="polite">
        {error && <div className="empty" style={{ color: 'var(--amber)' }}>{error}</div>}
      </div>
    </div>
  );
}
