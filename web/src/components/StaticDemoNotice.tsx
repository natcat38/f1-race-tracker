// The placeholder gateway-backed views render on the static GitHub Pages build, where
// no gateway exists.

import { Panel } from './Panel';
import { REPO_URL, RUN_CMD, STACK_LINE } from '../staticDemo';

// The public GitHub Pages build is a static page: it plays one baked NDJSON clip
// out of a file and there is no gateway, no Redis and no ingest behind it. Views
// that need the live gateway render this instead of dialling a socket that can
// never connect — which previously left them claiming "reconnecting…" forever
// while filling the console with WebSocket errors (ui-ux B1, accessibility D-1/D-2).
//
// The tabs stay in the rail on purpose: the features are real, and a truthful
// signpost advertises them better than a hidden tab does.
export function StaticDemoNotice({ label, what }: { label: string; what: string }) {
  return (
    <Panel
      label={label}
      actions={<span className="chip chip-warm">NEEDS THE FULL STACK</span>}
    >
      <div className="demo-notice">
        <p>{what}</p>
        <p>
          It reads from the live gateway, and this public demo has no gateway behind
          it — it is a static page playing one recorded Monza 2024 clip straight from
          a file. The <strong>BOARD</strong> tab is that clip, running in the real UI.
        </p>
        <p>
          To see this view for yourself, run the whole system locally:
        </p>
        <pre className="demo-notice-cmd"><code>{RUN_CMD}</code></pre>
        <p>
          then open <code>http://localhost:8080</code>. {STACK_LINE}
        </p>
        <p>
          <a className="demo-notice-link" href={REPO_URL} target="_blank" rel="noreferrer">
            Source, architecture and ADRs on GitHub ↗
          </a>
        </p>
      </div>
    </Panel>
  );
}
