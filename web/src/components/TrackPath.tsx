// The circuit outline, drawn as a casing stroke under a surface stroke so the
// track reads as a road rather than a line. Shared by the board map and the
// ghost overlay, which previously carried identical hardcoded copies.
//
// 12/8 rather than 10/6: a 6px surface between two 2px slivers of casing is a
// hairline, and with the retuned --track-fill (see tokens.css) there is now an
// actual road surface worth showing. The 2px casing margin either side is kept
// deliberately thin — it is a seam, not an outline.
export function TrackPath({ d }: { d: string }) {
  if (!d) return null;
  return (
    <>
      <path d={d} fill="none" stroke="var(--track-edge)" strokeWidth={12} strokeLinejoin="round" />
      <path d={d} fill="none" stroke="var(--track-fill)" strokeWidth={8} strokeLinejoin="round" />
    </>
  );
}
