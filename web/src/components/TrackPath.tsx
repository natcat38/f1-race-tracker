// The circuit outline, drawn as a casing stroke under a surface stroke so the
// track reads as a road rather than a line. Shared by the board map and the
// ghost overlay, which previously carried identical hardcoded copies.
//
// 12/8 rather than 10/6: a 6px surface between two 2px slivers of casing is a
// hairline, and with the retuned --track-fill (see tokens.css) there is now an
// actual road surface worth showing. The 2px casing margin either side is kept
// deliberately thin — it is a seam, not an outline.
// segments, when given, is the sector-dominance heatmap: one coloured sub-path
// per minisector (see geometry.ts's trackSegmentPaths), drawn instead of the
// single plain-fill path. Casing is drawn under every segment first so two
// adjacent colours never show a fill-coloured seam between them.
export function TrackPath({ d, segments }: {
  d: string; segments?: { d: string; colour: string }[];
}) {
  if (segments && segments.length > 0) {
    return (
      <>
        {segments.map((s, i) => (
          <path key={i} d={s.d} fill="none" stroke="var(--track-edge)" strokeWidth={12} strokeLinejoin="round" strokeLinecap="round" />
        ))}
        {segments.map((s, i) => (
          <path key={i} d={s.d} fill="none" stroke={s.colour} strokeWidth={8} strokeLinejoin="round" strokeLinecap="round" />
        ))}
      </>
    );
  }
  if (!d) return null;
  return (
    <>
      <path d={d} fill="none" stroke="var(--track-edge)" strokeWidth={12} strokeLinejoin="round" />
      <path d={d} fill="none" stroke="var(--track-fill)" strokeWidth={8} strokeLinejoin="round" />
    </>
  );
}
