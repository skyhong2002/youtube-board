/** Inspired by skyhong2002/infovore's src/output/cloud.ts:
 * power-curve size scaling, centre-out packing, then smaller retries.
 * Packing walks every point of a 3-unit grid outward from the centre (an
 * ellipse matching the canvas) against an occupancy grid, so small terms can
 * still fill the gaps between large ones; a spiral samples too sparsely far
 * from the centre for a few hundred terms.
 * The text-only subset of the parent site's lib/word-cloud.mts, including the
 * masthead's hole/clear boxes; the YouTube homepage weights are keyword heat scores
 * (matched video counts while the API has not published heat).
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
    (n, char) => n + (/[^\u0000-ÿ]/.test(char) ? 1 : /[ilI.,: ]/.test(char) ? 0.35 : /[MW@]/.test(char) ? 0.95 : 0.66),
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
  /** A box kept clear at the canvas centre (for a mark the words surround);
   *  with a mask ('#' = taken), only those cells of the box are kept clear. */
  hole?: { width: number; height: number; mask?: readonly string[]; dy?: number };
  /** More boxes kept clear, as offsets from the canvas centre (a caption under the mark). */
  clear?: Array<{ x: number; y: number; width: number; height: number }>;
  /** How far the outline wanders from an ellipse (0 by default); 0.3 gives a lumpy, hand-placed edge. */
  irregular?: number;
  /** Grid points to look past the first fit (0 by default); each word then takes one of the fits found
   *  there, picked by its label, so neighbours stop lining up in rows and columns. */
  scatter?: number;
  /** Space kept between words, in viewBox units (3 by default); larger spreads a short list across the canvas. */
  gap?: number;
  /** Space kept between words and the hole/clear boxes (0 by default: words may touch the mark). */
  markGap?: number;
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
  const hole = sizes.hole;
  const holeCells = hole?.mask?.join('') ?? '';
  const holeShare = hole?.mask ? holeCells.replaceAll('.', '').length / holeCells.length : 1;
  const room =
    width * height - (hole ? hole.width * hole.height * holeShare : 0) - (sizes.clear ?? []).reduce((n, b) => n + b.width * b.height, 0);
  const scale = Math.max(0.5, Math.min(1, Math.sqrt((room * (sizes.budget ?? 0.55)) / Math.max(1, requestedArea))));
  const floor = sizes.floor ?? 11;
  const cols = Math.ceil(width / CELL),
    rows = Math.ceil(height / CELL);
  const taken = new Uint8Array(cols * rows);
  // Cells overlapping [x0, x1) × [y0, y1); a box clear of taken cells is clear of every placed word.
  // Words keep `gap` from each other (1) and `markGap` from the mark's cells (2).
  const span = (from: number, to: number, n: number) => [Math.max(0, Math.floor(from / CELL)), Math.min(n, Math.ceil(to / CELL))];
  const gap = sizes.gap ?? GAP,
    markGap = sizes.markGap ?? 0,
    reach = Math.max(gap, markGap);
  const free = (x: number, y: number, w: number, h: number) => {
    const [c0, c1] = span(x - reach, x + w + reach, cols),
      [r0, r1] = span(y - reach, y + h + reach, rows);
    const [i0, i1] = span(x - gap, x + w + gap, cols),
      [j0, j1] = span(y - gap, y + h + gap, rows);
    const [m0, m1] = span(x - markGap, x + w + markGap, cols),
      [n0, n1] = span(y - markGap, y + h + markGap, rows);
    for (let r = r0; r < r1; r++)
      for (let c = c0; c < c1; c++) {
        const t = taken[r * cols + c];
        if (t === 1 && r >= j0 && r < j1 && c >= i0 && c < i1) return false;
        if (t === 2 && r >= n0 && r < n1 && c >= m0 && c < m1) return false;
      }
    return true;
  };
  if (hole) {
    const left = (width - hole.width) / 2,
      top = (height - hole.height) / 2 + (hole.dy ?? 0);
    const [c0, c1] = span(left, left + hole.width, cols),
      [r0, r1] = span(top, top + hole.height, rows);
    const mask = hole.mask;
    for (let r = r0; r < r1; r++)
      for (let c = c0; c < c1; c++) {
        if (!mask) {
          taken[r * cols + c] = 2;
          continue;
        }
        // Any mask cell under this grid cell takes it.
        const my0 = Math.floor(((r * CELL - top) / hole.height) * mask.length),
          my1 = Math.ceil((((r + 1) * CELL - top) / hole.height) * mask.length);
        const mx0 = Math.floor(((c * CELL - left) / hole.width) * mask[0].length),
          mx1 = Math.ceil((((c + 1) * CELL - left) / hole.width) * mask[0].length);
        for (let my = Math.max(0, my0); my < Math.min(mask.length, my1) && !taken[r * cols + c]; my++)
          for (let mx = Math.max(0, mx0); mx < Math.min(mask[0].length, mx1); mx++)
            if (mask[my][mx] === '#') {
              taken[r * cols + c] = 2;
              break;
            }
      }
  }
  for (const box of sizes.clear ?? []) {
    const [c0, c1] = span(width / 2 + box.x, width / 2 + box.x + box.width, cols),
      [r0, r1] = span(height / 2 + box.y, height / 2 + box.y + box.height, rows);
    for (let r = r0; r < r1; r++) taken.fill(2, r * cols + c0, r * cols + c1);
  }
  const centres = gridCentres(width, height, sizes.irregular ?? 0);
  const scatter = sizes.scatter ?? 0;
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
      const fits: Array<[number, number]> = [];
      let until = centres.length;
      for (let i = 0; i < until && fits.length < 12; i += 2) {
        const x = Math.round(centres[i] - w / 2),
          y = Math.round(centres[i + 1] - h / 2);
        if (x < 4 || y < 4 || x + w > width - 4 || y + h > height - 4 || !free(x, y, w, h)) continue;
        // Keep at most a few fits per row band so the pick is not just the next cell over.
        if (fits.some(([fx, fy]) => Math.abs(fx - x) < w / 2 && Math.abs(fy - y) < h / 2)) continue;
        fits.push([x, y]);
        if (fits.length === 1) until = Math.min(centres.length, i + 2 * (scatter + 1));
      }
      if (fits.length) {
        const [x, y] = fits[hash(term.label) % fits.length];
        const [c0, c1] = span(x, x + w, cols),
          [r0, r1] = span(y, y + h, rows);
        for (let r = r0; r < r1; r++) taken.fill(1, r * cols + c0, r * cols + c1);
        placed.push({ ...term, x, y, width: w, height: h, fontSize });
        done = true;
      }
      if (!done) failed.push([w, h]);
    }
  }
  return placed;
}

const CELL = 3,
  GAP = 3;
/** A stable small number per label (FNV-1a), for choices that should not change between renders. */
function hash(label: string) {
  let h = 2166136261;
  for (const ch of label) h = Math.imul(h ^ ch.codePointAt(0)!, 16777619);
  return h >>> 0;
}
/** Grid points as flat [x, y] pairs, nearest the centre first on an ellipse shaped like the canvas,
 *  its radius wobbling with the angle when `irregular` is set (fixed waves, so a layout is repeatable). */
function gridCentres(width: number, height: number, irregular: number) {
  const points: Array<[number, number, number]> = [];
  for (let y = CELL / 2; y < height; y += CELL)
    for (let x = CELL / 2; x < width; x += CELL) {
      const dx = (x - width / 2) / width,
        dy = (y - height / 2) / height;
      const a = Math.atan2(dy, dx);
      const wobble = 1 + irregular * (0.5 * Math.sin(3 * a + 0.7) + 0.3 * Math.sin(5 * a + 2.1) + 0.2 * Math.sin(8 * a + 4.4));
      points.push([x, y, (dx ** 2 + dy ** 2) / wobble ** 2]);
    }
  points.sort((a, b) => a[2] - b[2]);
  const flat = new Float64Array(points.length * 2);
  for (const [i, [x, y]] of points.entries()) flat.set([x, y], i * 2);
  return flat;
}
