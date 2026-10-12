/** Inspired by skyhong2002/infovore's src/output/cloud.ts:
 * power-curve size scaling, centre-out packing, then smaller retries.
 * Packing walks every point of a 3-unit grid outward from the centre (an
 * ellipse matching the canvas) against an occupancy grid, so small terms can
 * still fill the gaps between large ones; a spiral samples too sparsely far
 * from the centre for a few hundred terms.
 * News weights count distinct articles rather than personal attention time.
 */
export interface CloudTerm {
  label: string;
  count: number;
}
export interface PlacedWord extends CloudTerm {
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
}

const widthOf = (label: string, size: number) =>
  Array.from(label).reduce(
    (n, char) => n + (/[^\u0000-\u00ff]/.test(char) ? 1 : /[ilI.,: ]/.test(char) ? 0.35 : /[MW@]/.test(char) ? 0.95 : 0.66),
    0,
  ) *
    size +
  4;
/** Font sizes in viewBox units for the rarest and the most frequent term; the spread between them is what a wide cloud buys. */
export interface CloudSizes {
  min: number;
  max: number;
  /** Share of the canvas the terms may ask for before every size is scaled down (0.55 by default). */
  budget?: number;
  /** Exponent from count share to size (0.5, square root, by default); higher keeps long tails small so the top terms can stay large. */
  curve?: number;
  /** Smallest size a term may shrink to while looking for room (11 by default). */
  floor?: number;
  /** Most terms to place, largest first (50 by default). */
  words?: number;
}
export function layoutWordCloud(terms: CloudTerm[], width = 300, height = 230, sizes: CloudSizes = { min: 12, max: 29 }): PlacedWord[] {
  if (width < 40 || height < 30 || !(sizes.max >= sizes.min && sizes.min > 0)) return [];
  const unique = new Map<string, CloudTerm>();
  for (const term of terms) {
    const label = term.label.trim();
    if (label && Number.isFinite(term.count) && term.count > 0 && !unique.has(label)) unique.set(label, { label, count: term.count });
  }
  const sorted = [...unique.values()]
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'zh-TW'))
    .slice(0, sizes.words ?? 50);
  const max = sorted[0]?.count ?? 1;
  const naturalSize = (count: number) => sizes.min + (sizes.max - sizes.min) * (count / max) ** (sizes.curve ?? 0.5);
  const requestedArea = sorted.reduce((sum, term) => {
    const size = naturalSize(term.count);
    return sum + widthOf(term.label, size) * size * 1.6;
  }, 0);
  const scale = Math.max(0.5, Math.min(1, Math.sqrt((width * height * (sizes.budget ?? 0.55)) / Math.max(1, requestedArea))));
  const floor = sizes.floor ?? 11;
  const cols = Math.ceil(width / CELL),
    rows = Math.ceil(height / CELL);
  const taken = new Uint8Array(cols * rows);
  // Cells overlapping [x0, x1) × [y0, y1); a box clear of taken cells is clear of every placed word.
  const span = (from: number, to: number, n: number) => [Math.max(0, Math.floor(from / CELL)), Math.min(n, Math.ceil(to / CELL))];
  const free = (x: number, y: number, w: number, h: number) => {
    const [c0, c1] = span(x - GAP, x + w + GAP, cols),
      [r0, r1] = span(y - GAP, y + h + GAP, rows);
    for (let r = r0; r < r1; r++) for (let c = c0; c < c1; c++) if (taken[r * cols + c]) return false;
    return true;
  };
  const centres = gridCentres(width, height);
  // Space only shrinks, so a box at least as large as one that found no room never will.
  const failed: Array<[number, number]> = [];
  const placed: PlacedWord[] = [];
  for (const term of sorted) {
    let done = false;
    const natural = Math.max(floor, Math.round(naturalSize(term.count) * scale));
    for (let fontSize = natural; fontSize >= floor && !done; fontSize--) {
      // CJK ascent/descent can exceed the nominal em box in system fonts.
      const w = widthOf(term.label, fontSize),
        h = fontSize * 1.6;
      if (w > width - 8 || h > height - 8 || failed.some(([fw, fh]) => w >= fw && h >= fh)) continue;
      for (let i = 0; i < centres.length; i += 2) {
        const x = Math.round(centres[i] - w / 2),
          y = Math.round(centres[i + 1] - h / 2);
        if (x < 4 || y < 4 || x + w > width - 4 || y + h > height - 4 || !free(x, y, w, h)) continue;
        const [c0, c1] = span(x, x + w, cols),
          [r0, r1] = span(y, y + h, rows);
        for (let r = r0; r < r1; r++) taken.fill(1, r * cols + c0, r * cols + c1);
        placed.push({ ...term, x, y, width: w, height: h, fontSize });
        done = true;
        break;
      }
      if (!done) failed.push([w, h]);
    }
  }
  return placed;
}

const CELL = 3,
  GAP = 3;
/** Grid points as flat [x, y] pairs, nearest the centre first on an ellipse shaped like the canvas. */
function gridCentres(width: number, height: number) {
  const points: Array<[number, number, number]> = [];
  for (let y = CELL / 2; y < height; y += CELL)
    for (let x = CELL / 2; x < width; x += CELL) points.push([x, y, ((x - width / 2) / width) ** 2 + ((y - height / 2) / height) ** 2]);
  points.sort((a, b) => a[2] - b[2]);
  const flat = new Float64Array(points.length * 2);
  for (const [i, [x, y]] of points.entries()) flat.set([x, y], i * 2);
  return flat;
}
