# Section B (status & feedback) — implementation notes

Branch: `uiux-audit-fixes`, built on top of Section A. Not committed.

## 1. Item 3 — "● Live" overpromises
`web/src/components/SourceToggle.tsx`: visible segment label changed to
`● Live (demo)`. The fuller caveat string (rendered via `SegmentedControl`'s
`title` + visually-hidden span) is unchanged. No test referenced the old
`'● Live'` string, so no test updates were needed.

## 2. Item 7 — Reconnect far from the failure
`web/src/App.tsx`:
- The map-overlay "⚠ Connection lost" chip (offline branch, ~line 295) now
  includes a `Reconnect` button wired to the same `reconnect` callback already
  passed to `StatusRail`.
- `SkeletonMap` gained an `onReconnect` prop and its own `Reconnect` button for
  the offline case (previously text-only: "Connection lost. Use Reconnect in
  the status rail above to try again."). The rail-pointing copy is gone —
  the fix is on the panel itself now (Nielsen #6 / Gestalt proximity).

## 3. Item 8 — Race Control conflates "no incidents" with "not connected"
`web/src/components/RaceControl.tsx`: added a `state.rev === 0` branch
("⏳ Warming up the timing feed…", matching `StatusBadge`'s existing wording)
ahead of the `messages.length === 0` check, so "No incidents." is only shown
once a snapshot has actually arrived.

## 4. Item 9b — Cmd copy button: silent failure, unannounced success
`web/src/components/Settings.tsx` `Cmd`: added an `error` state set in the
`catch` branch ("Copy failed — select the text and copy it manually."),
rendered via the existing `.src-error` class (matching `SourceToggle`'s error
styling) inside a `role="status" aria-live="polite"` region that also carries
a visually-hidden "Copied" announcement for the success case. Added the
item-9c comment on `children: string` explaining why that typing is
load-bearing for the aria-label.

## 5. Item 9a — Settings wall of prose for a linked operator
`web/src/components/Settings.tsx`: factored the four-step `<ol>` + the
check/forget-commands `<p>` into a `SigningInSteps` component. When
`auth.state === 'linked'` it renders inside a native
`<details><summary>Signing in (already linked)</summary>…</details>`;
otherwise it renders inline under the existing `<h3>Signing in</h3>`, unchanged
from before. The subscription warning, `NextStep`, and privacy/beta paragraphs
were left exactly as they were (out of this fix's scope).

## 6. Item 14a — CLIP LOOPED chip not dismissable
`web/src/App.tsx`: added a small `✕` `.btn-icon` button
(`aria-label="Dismiss clip looped notice"`) inside the loop chip that calls
`setJustLooped(false)`, alongside the existing 8s `LOOP_NOTICE_MS` auto-clear.

## 7. Item 14b — rival `<select>` disagrees with the collapsed rival card
`web/src/components/TelemetryPanel.tsx`: the `<select>`'s `value` was already
bound to the `rival` prop, and `App.tsx` already passes `effectiveRival` (not
raw `rival` state) into that prop — so the select and the rival card were
already reading the same collapsed value. Added a comment at the call site
documenting that this is intentional (the select must reflect the *effective*
rival, while `onRivalChange` still writes the raw, un-collapsed `rival` state
in `App.tsx`), so a future edit doesn't accidentally wire the raw state back
in believing it's more "correct".

## Verification
- `npm test -- --run`: 23 files, 269 tests, all passing. (Unrelated
  `HTMLMediaElement.prototype.pause` "not implemented" jsdom warnings appear
  during teardown of pre-existing Comms tests — cosmetic, not failures.)
- `npm run lint`: clean, no errors or warnings.
