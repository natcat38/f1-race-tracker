import type { RaceState } from '../state/race';
import { useComms } from '../hooks/useComms';
import { teamColour } from './teamColours';

// Comms is the toggleable team-radio layer: a now-playing banner + a short
// replayable history. Audio streams from F1's public URL (ADR-0003).
export function Comms({ state }: { state: RaceState }) {
  const { enabled, toggle, nowPlaying, history, replay } = useComms(state);

  function codeFor(driverNum: number) {
    return state.cars[driverNum]?.code ?? String(driverNum);
  }
  function colourFor(driverNum: number) {
    return teamColour[state.cars[driverNum]?.team ?? ''] ?? 'var(--slate)';
  }

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <button
        onClick={toggle}
        className={enabled ? 'btn btn-active' : 'btn'}
        style={{ justifySelf: 'start' }}
      >
        {enabled ? '📻 Comms ON' : '📻 Comms OFF'}
      </button>

      {enabled && nowPlaying && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px',
          background: 'var(--asphalt)', borderRadius: 4, fontSize: 13,
        }}>
          <span style={{ color: colourFor(nowPlaying.driverNum), fontWeight: 700 }}>
            {codeFor(nowPlaying.driverNum)}
          </span>
          <span style={{ color: 'var(--slate)' }}>radio</span>
          <button onClick={() => replay(nowPlaying)} className="btn" style={{ border: 'none', padding: '0 4px' }}>↻</button>
        </div>
      )}

      {enabled && history.length > 0 && (
        <div style={{ display: 'grid', gap: 4 }}>
          {history.map((m, i) => (
            <div key={`${m.timeMs}-${i}`} style={{
              display: 'flex', alignItems: 'center', gap: 8,
              fontSize: 12, color: 'var(--slate)',
            }}>
              <span style={{ color: colourFor(m.driverNum), fontWeight: 700 }}>{codeFor(m.driverNum)}</span>
              <button onClick={() => replay(m)} className="btn" style={{ border: 'none', padding: '0 4px' }}>▶</button>
            </div>
          ))}
        </div>
      )}

      {!enabled && (
        <div className="empty">Radio clips play automatically when comms is on.</div>
      )}
      {enabled && !nowPlaying && history.length === 0 && (
        <div className="empty">No radio yet — clips play as the replay reaches them.</div>
      )}
    </div>
  );
}
