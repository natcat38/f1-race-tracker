// Shared "copy to clipboard" control: the success/failure live-region feedback
// pattern that used to live only in Settings.tsx's Cmd (ui-ux item 9b), now
// reused by the board's and overlay's "Copy link" buttons (ui-ux item 6) instead
// of a second copy of the same catch/live-region logic.

import { useEffect, useRef, useState } from 'react';

export function CopyButton({
  getText, label, copiedLabel = '✓ copied', className = 'btn', ariaLabel,
}: {
  /** Read lazily on click, not at render time, so the copied text (e.g.
      `location.href`) is always the value current at the moment of the click. */
  getText: () => string;
  label: string;
  copiedLabel?: string;
  className?: string;
  ariaLabel?: string;
}) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(getText());
      setError(null);
      setCopied(true);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
      setError('Copy failed — copy the URL from the address bar manually.');
    }
  }

  return (
    <span className="cmd">
      <button type="button" className={className} onClick={copy} aria-label={ariaLabel}>
        {copied ? copiedLabel : label}
      </button>
      {/* Announces both the "copied" success and the failure message — see
          Settings.tsx's Cmd, the pattern this was extracted from. */}
      <span role="status" aria-live="polite">
        {copied && <span className="visually-hidden">Copied</span>}
        {error && <span className="src-error">{error}</span>}
      </span>
    </span>
  );
}
