import { useEffect, useState } from 'react';
import { Panel } from './Panel';
import { StatusRail } from './StatusRail';
import { Route } from './Route';
import { parseAuthStatus, relativeExpiry, type AuthStatus } from '../state/f1auth';
import { StaticDemoNotice } from './StaticDemoNotice';
import { REPO_URL, STACK_LINE, STATIC_DEMO } from '../staticDemo';

const POLL_MS = 5000;

const LINK_CMD = 'python ingest/f1tv_link.py';

// No green token exists (--amber is attention-only, by design) so "linked" reads as
// the settled chalk chip rather than inventing a colour.
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

// The one thing to do next, stated as an instruction rather than a diagnosis.
function NextStep({ auth }: { auth: AuthStatus }) {
  if (auth.state === 'unavailable') {
    return (
      <p>
        <strong>Next:</strong> can&apos;t reach the link status — the gateway or the
        ingest service is probably down. Check <code>docker compose ps</code>.
      </p>
    );
  }
  if (auth.state === 'linked') {
    const left = relativeExpiry(auth.expiresUtc);
    return (
      <p>
        <strong>Next:</strong> nothing — you&apos;re linked. This sign-in lapses{' '}
        {left ?? 'in a few days'}; when it does, run <code>{LINK_CMD}</code> again.
      </p>
    );
  }
  return (
    <p>
      <strong>Next:</strong> run <code>{LINK_CMD}</code> on this machine
      {auth.state === 'expired' ? ' to sign in again.' : ' to sign in.'}
    </p>
  );
}

// The one place in the app that says what was built and links back to it — the
// board, compare and overlay routes are all instruments with no room for prose
// (ui-ux review M15). The rail carries a compact repo link on every route; this
// is the sentence behind it.
function About() {
  return (
    <Panel label="About this project">
      <div className="demo-notice">
        <p>
          F1 Race Tracker is a broadcast-style timing board fed by a real telemetry
          pipeline: {STACK_LINE}
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

// Settings is the #settings route: the operator's view of the beta F1TV link.
// It only ever reads status — linking itself is a host command, because fastf1's
// browser login POSTs to host loopback and a container cannot receive that
// (ADR-0007). The page says so rather than offering a button that cannot work.
export function Settings() {
  const auth = useAuthStatus();
  const expiresIn = relativeExpiry(auth.expiresUtc);
  const noSubscription = auth.state === 'linked' && auth.tier !== 'active';

  // The static build has no ingest process to link an account with, and no
  // /api/f1auth to ask — so it says so plainly instead of reporting the
  // "UNAVAILABLE" chip that an unreachable gateway would otherwise produce.
  if (STATIC_DEMO) {
    return (
      <Route
        title="F1TV account link (not in this demo)"
        rail={<StatusRail active="settings" note="Not available in the static demo" />}
      >
        <StaticDemoNotice
          label="F1TV Link — beta"
          what="This page links a Formula 1 account to the ingest service, so the
                tracker can pull a live session's timing feed instead of a recorded
                one. Signing in runs as a host command on your own machine — nothing
                about it can work from a static page."
        />
        {/* No <About /> here: StaticDemoNotice already carries the stack line
            and the repo link, and saying both twice on one screen reads as a
            template rather than as writing. */}
      </Route>
    );
  }

  return (
    <Route
      title="F1TV account link"
      rail={<StatusRail active="settings" note="F1TV link — beta" />}
    >
      <Panel
        label="F1TV Link — beta"
        actions={<span className={CHIP[auth.state]}>{CHIP_LABEL[auth.state]}</span>}
      >
        <>
            <p>
              <strong>You need a paid F1 TV Access subscription for this to show live
              data.</strong> Signing in with a free F1 account works and is worth doing —
              it is how you find out which tier you have — but the timing feed itself is
              only served to paying subscribers. Every other feature of this tracker runs
              on free data and never touches any of this.
            </p>

            <NextStep auth={auth} />

            {auth.state === 'linked' && (
              <p>
                Signed in · subscription <strong>{auth.tier ?? 'unknown'}</strong>
                {auth.product && <> ({auth.product})</>}
                {expiresIn && <> · lapses {expiresIn}</>}
                {auth.expiresUtc && <> ({auth.expiresUtc})</>}
              </p>
            )}

            {noSubscription && (
              <p>
                Your account has <strong>no active F1 TV subscription</strong>, so expect
                the live stream to stay empty even when everything else is set up
                correctly. That is the account, not a bug in the link.
              </p>
            )}

            <h3>Signing in</h3>
            <ol>
              <li>
                Have a free F1 account — <code>https://account.formula1.com</code>
              </li>
              <li>
                Install the f1login browser extension —{' '}
                <code>https://f1login.fastf1.dev</code> (this is FastF1&apos;s own
                extension; it is what hands the sign-in to this machine)
              </li>
              <li>
                Install the Python dependencies:
                <br />
                <code>pip install -r ingest/requirements.txt -r ingest/requirements-live.txt</code>
                <br />
                <code>pip install --no-deps -r ingest/requirements-live-nodeps.txt</code>
              </li>
              <li>
                Run <code>{LINK_CMD}</code>, then open the URL it prints and sign in.
                It will say <em>&quot;requires an active F1TV Access/Pro/Premium
                subscription&quot;</em> before the URL — that line is expected, not a
                rejection; a free account signs in fine.
              </li>
            </ol>

            <p>
              To check without signing in again: <code>{LINK_CMD} --status</code>.
              To forget the sign-in: <code>{LINK_CMD} --unlink</code>.
            </p>

            <p>
              Sign-in runs on this machine rather than in a container, because the
              browser extension posts to <code>127.0.0.1</code> on a random port and
              Docker cannot forward that into a container. Your sign-in never leaves this
              machine — only whether it worked, when it lapses, and which tier you have
              are sent to this page.
            </p>

            <p>
              <strong>Beta.</strong> Verified on 2026-08-20: the account links, the feed
              accepts the sign-in, and the team-radio wire format is confirmed. Whether a
              live session&apos;s stream is tier-gated is still untested — that needs a
              race weekend. See <code>docs/runbooks/live-verification.md</code> §5 and
              ADR-0007.
            </p>
          </>
      </Panel>
      <About />
    </Route>
  );
}
