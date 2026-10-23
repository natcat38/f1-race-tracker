// The static demo's "How this runs" page: what the full system is and how to start it.

import { Panel } from './Panel';
import { Route } from './Route';
import { StatusRail } from './StatusRail';
import { Cmd } from './Cmd';
import { REPO_URL, RUN_CMD } from '../staticDemo';

// The BENCHMARKS.md the headline figure comes from, on the default branch.
const BENCHMARKS_URL = `${REPO_URL}/blob/main/BENCHMARKS.md`;

// The static build's #settings route. The gear used to open an F1TV account-link
// page that said "Not available in the static demo": a dead end sitting in the
// header of every route, for the one reader (a recruiter) who cannot use it. This
// answers the question that reader actually has instead — what is behind the demo
// and how to run it. Every statement here is already made in README.md or
// BENCHMARKS.md, and nothing is added: the figures are quoted, not re-measured.
export function HowItRuns() {
  // RUN_CMD is the one-liner the README and the other static-demo copy share; the
  // three commands are its parts, so the two can never drift apart.
  const commands = RUN_CMD.split(' && ');

  return (
    <Route
      title="How this runs"
      rail={<StatusRail active="settings" />}
    >
      <Panel label="How this runs">
        <div className="demo-notice">
          <p>
            This page is a static build. It plays one recorded clip, the Monza 2024
            race, from a file in the browser, and no backend is running behind it. It
            is a simplified version of the project and does not demonstrate the full
            pipeline.
          </p>

          <h3>The full system</h3>
          <ol className="how-flow">
            <li>
              <strong>Python ingest</strong> reads the position data and publishes it
              to Redis.
            </li>
            <li>
              <strong>Redis</strong> is the seam between the languages. A Go replay
              writer publishes byte-identical JSON to the same keys, so the gateway
              consumes either source without code changes.
            </li>
            <li>
              <strong>The Go gateway</strong> fans one lane out over WebSocket.
            </li>
            <li>
              <strong>The React single-page application</strong> renders the track map,
              updating at 10 Hz.
            </li>
          </ol>

          <p>
            One gateway sustained 1,000 concurrent WebSocket viewers at 10 Hz, with a
            p99 fan-out latency of 48 ms and zero dropped clients, on a single laptop.
            The method and its caveats are in{' '}
            <a className="demo-notice-link" href={BENCHMARKS_URL} target="_blank" rel="noreferrer">
              BENCHMARKS.md<span aria-hidden="true"> ↗</span>
              <span className="visually-hidden"> (opens in a new tab)</span>
            </a>.
          </p>

          <h3>Run it locally</h3>
          <p>Three commands start the whole system.</p>
          <ol className="how-commands">
            {commands.map((c) => (
              <li key={c}><Cmd>{c}</Cmd></li>
            ))}
          </ol>
          <p>Then open <code>http://localhost:8080</code>.</p>

          <h3>F1TV link</h3>
          <p>
            An optional beta path connects to live timing with an F1TV account, linked
            on the host machine. It is off by default and is not available in this
            demo.
          </p>

          <p>
            <a className="demo-notice-link" href={REPO_URL} target="_blank" rel="noreferrer">
              Source, architecture and ADRs on GitHub ↗
              <span className="visually-hidden"> (opens in a new tab)</span>
            </a>
          </p>
        </div>
      </Panel>
    </Route>
  );
}
