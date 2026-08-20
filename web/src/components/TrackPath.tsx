// The circuit outline, drawn as a casing stroke under a surface stroke so the
// track reads as a road rather than a line. Shared by the board map and the
// ghost overlay, which previously carried identical hardcoded copies.
export function TrackPath({ d }: { d: string }) {
  if (!d) return null;
  return (
    <>
      <path d={d} fill="none" stroke="var(--track-edge)" strokeWidth={10} strokeLinejoin="round" />
      <path d={d} fill="none" stroke="var(--track-fill)" strokeWidth={6} strokeLinejoin="round" />
    </>
  );
}
