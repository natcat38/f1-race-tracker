// Shared map geometry: the coordinate space the track outline and the car
// markers both live in, and the two derivations every map surface needs.

// Track points and car positions arrive normalised to a unit box, so one
// constant scales both into SVG user units. Every consumer multiplies by SIZE —
// which is why the fitted viewBox below is safe: it re-frames the same space
// rather than re-projecting into a new one.
export const SIZE = 600;

export type Pt = { x: number; y: number };

// trackPathD renders the baked outline as a closed SVG path. Map and Ghost
// carried byte-identical copies of this expression.
export function trackPathD(track: Pt[]): string {
  if (track.length === 0) return '';
  return 'M ' + track.map((p) => `${p.x * SIZE},${p.y * SIZE}`).join(' L ') + ' Z';
}

// Minisector bin size for the sector-dominance heatmap: mirrors
// ingest/record.py's MINISECTOR_SIZE / ingest/ghost.py's compute_sector_dominance
// exactly, so segment i here lines up with RaceState.sectorDominance[i].
export const MINISECTOR_SIZE = 10;

// trackSegmentPaths splits the outline into fixed-size, non-closed sub-paths
// (one per minisector) for the sector-dominance heatmap, using the same
// [start, min(start+binSize, n-1)] windows as the backend's binning so the
// segment at index i corresponds to sectorDominance[i].
export function trackSegmentPaths(track: Pt[], binSize: number = MINISECTOR_SIZE): string[] {
  const n = track.length;
  if (n === 0) return [];
  const paths: string[] = [];
  for (let start = 0; start < n; start += binSize) {
    const end = Math.min(start + binSize, n - 1);
    // Degenerate bin (start === end, only possible when n is tiny relative to
    // binSize): emit a zero-length path rather than skip it, so this array's
    // length always matches the backend's one-entry-per-bin sectorDominance.
    const pts = track.slice(start, end + 1);
    paths.push('M ' + pts.map((p) => `${p.x * SIZE},${p.y * SIZE}`).join(' L '));
  }
  return paths;
}

// The outline is baked into the unit box with its aspect ratio preserved
// (ingest/record.py's normalise() scales both axes by the LARGER range and
// centres), so the narrow axis is letterboxed: Monza measures 372×599 inside the
// 600 square. A fixed `0 0 600 600` viewBox therefore spends ~38% of every map
// panel drawing nothing, worst on #ghost where the panel is full-bleed.
const PAD_FRACTION = 0.04;
// …but never less than this: the casing stroke is 12 wide (6 either side of the
// centreline) and a car marker is r=7, so a path point sitting exactly on the
// bounds still needs room for the ink drawn around it.
const MIN_PAD = 14;
// The ink around the path is asymmetric: a driver code is drawn 10 units to the
// RIGHT of its marker and runs about three glyphs wide, so a car sitting on the
// easternmost point of the circuit needs room the other three sides do not.
// Measured on the running overlay lanes, where a label was clipping by ~6 units.
const LABEL_ALLOWANCE = 34;

const r2 = (n: number) => Math.round(n * 100) / 100;

// fitViewBox returns the `min-x min-y width height` string fitted to the
// outline's own bounds with a little padding, falling back to the full square
// when there is no outline yet. Car markers are NOT re-projected: they are
// plotted in the same SIZE-space, so narrowing the window moves the frame, not
// the dots, and a car stays exactly where it was on the track.
export function fitViewBox(track: Pt[]): string {
  if (track.length === 0) return `0 0 ${SIZE} ${SIZE}`;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of track) {
    const x = p.x * SIZE, y = p.y * SIZE;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const w = maxX - minX, h = maxY - minY;
  const pad = Math.max(Math.max(w, h) * PAD_FRACTION, MIN_PAD);
  return `${r2(minX - pad)} ${r2(minY - pad)} ${r2(w + pad * 2 + LABEL_ALLOWANCE)} ${r2(h + pad * 2)}`;
}
