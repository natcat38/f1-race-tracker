import { useEffect, useState } from 'react';
import { Panel } from './Panel';
import { StatusRail } from './StatusRail';
import { parseAuthStatus, type AuthStatus } from '../state/f1auth';

const POLL_MS = 5000;
const STATIC_DEMO = import.meta.env.VITE_STATIC_DEMO === 'true';

// No green token exists (--amber is attention-only, by design) so "linked" reads
// as the settled chalk chip rather than inventing a colour.
const CHIP: Record<AuthStatus['state'], string> = {
  linked: 'chip chip-replay',
  unlinked: 'chip chip-warm',
  expired: 'chip chip-stall',
  unavailable: 'chip chip-stall',
};

const CHIP_LABEL: Record<AuthStatus['state'], string> = {
  linked: 'LINKED',
  unlinked: 'NOT LINKED',
  expired: 'EXPIRED',
  unavailable: 'UNAVAILABLE',
};

function useAuthStatus(): AuthStatus {
  const [auth, setAuth] = useState<AuthStatus>({ state: 'unavailable' });
  useEffect(() => {
    if (STATIC_DEMO) return;
    let live = true;
    const pull = () =>
      fetch('/api/f1auth')
        .then((r) => r.json())
        .then((j) => { if (live) setAuth(parseAuthStatus(j)); })
        .catch(() => { if (live) setAuth({ state: 'unavailable' }); });
    pull();
    const id = setInterval(pull, POLL_MS);
    return () => { live = false; clearInterval(id); };
  }, []);
  return auth;
}

// Settings is the #settings route: the operator's view of the beta F1TV link.
// It only ever reads status — linking itself is a host command, because fastf1's
// browser login POSTs to host loopback and a container cannot receive that
// (ADR-0007). The page says so rather than offering a button that cannot work.
export function Settings() {
  const auth = useAuthStatus();

  return (
    <div className="page">
      <StatusRail active="settings" note="F1TV link — beta" />

      <Panel label="F1TV Link — beta" actions={<span className={CHIP[auth.state]}>{CHIP_LABEL[auth.state]}</span>}>
        {STATIC_DEMO ? (
          <p>
            Not available in the static demo — run the full system
            (<code>docker compose up</code>) to link an account.
          </p>
        ) : (
          <>
            <p>
              Live timing from F1&apos;s own feed needs an F1TV subscription. This links
              <em> your </em> account, on this machine, for your own use. Every other feature
              of this tracker runs on free data and never touches this.
            </p>

            <p>
              <strong>Status:</strong>{' '}
              {auth.state === 'linked' && (
                <>
                  linked
                  {auth.product && <> · {auth.product}</>}
                  {auth.tier && <> · {auth.tier}</>}
                  {auth.expiresUtc && <> · expires {auth.expiresUtc}</>}
                </>
              )}
              {auth.state === 'unlinked' && <>no account linked on this host.</>}
              {auth.state === 'expired' && <>the cached token has expired — link again.</>}
              {auth.state === 'unavailable' && (
                <>can&apos;t read the status — the gateway or the ingest service may be down.</>
              )}
            </p>

            <p>
              Linking runs on the <strong>host</strong>, not in a container: the F1 login
              browser extension posts the token to <code>127.0.0.1</code> on a random port,
              which Docker cannot forward into a container.
            </p>

            <ol>
              <li><code>pip install -r ingest/requirements.txt -r ingest/requirements-live.txt</code></li>
              <li>
                Install the f1login extension from <code>https://f1login.fastf1.dev</code>
              </li>
              <li><code>python ingest/f1tv_link.py</code> — then open the URL it prints and sign in</li>
            </ol>

            <p>To unlink: <code>python ingest/f1tv_link.py --unlink</code></p>

            <p>
              <strong>Beta, and unverified.</strong> The whole path is built and tested
              end-to-end against recorded sessions, but the authenticated live connection
              itself is unverified pending an F1TV subscription. See
              <code> docs/runbooks/live-verification.md</code> and ADR-0007.
            </p>
          </>
        )}
      </Panel>
    </div>
  );
}
