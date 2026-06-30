import type { CSSProperties } from 'react';
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
    return teamColour[state.cars[driverNum]?.team ?? ''] ?? '#bbb';
  }

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <button
        onClick={toggle}
        style={{
          border: 'none', cursor: 'pointer', padding: '6px 14px', borderRadius: 8,
          fontFamily: 'monospace', fontSize: 13, justifySelf: 'start',
          background: enabled ? '#3671C6' : '#1a1a1a', color: enabled ? '#fff' : '#888',
        }}
      >
        {enabled ? '📻 Comms ON' : '📻 Comms OFF'}
      </button>

      {enabled && nowPlaying && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px',
          background: '#1a1a1a', borderRadius: 8, fontFamily: 'monospace', fontSize: 13,
        }}>
          <span style={{ color: colourFor(nowPlaying.driverNum), fontWeight: 700 }}>
            {codeFor(nowPlaying.driverNum)}
          </span>
          <span style={{ color: '#888' }}>radio</span>
          <button onClick={() => replay(nowPlaying)} style={replayBtn}>↻</button>
        </div>
      )}

      {enabled && history.length > 0 && (
        <div style={{ display: 'grid', gap: 4 }}>
          {history.map((m, i) => (
            <div key={`${m.timeMs}-${i}`} style={{
              display: 'flex', alignItems: 'center', gap: 8,
              fontFamily: 'monospace', fontSize: 12, color: '#aaa',
            }}>
              <span style={{ color: colourFor(m.driverNum), fontWeight: 700 }}>{codeFor(m.driverNum)}</span>
              <button onClick={() => replay(m)} style={replayBtn}>▶</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const replayBtn: CSSProperties = {
  border: 'none', cursor: 'pointer', background: 'transparent', color: '#3671C6',
  fontSize: 13, padding: '0 4px',
};
