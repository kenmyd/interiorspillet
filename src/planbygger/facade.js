/**
 * Planbygger: read a facade drawing (an elevation) – classical image processing and fixed rules only. No learning, no
 * OCR, no network. An AI answer (task `readFacade`, notes/planbygger-runde1-design.md) may be passed in: it decides
 * the roof type, the storey count and door or window where its boxes match ours; all positions and sizes still come
 * from the image.
 *
 *   readFacade(img, { ai, storeys, floorHeight = 2.7, pxPerM }) → {
 *     roof:      'gable'|'gable-dormer'|'hip'|'mono-pitch'|'flat'|'mixed'|null
 *     groundY, eaveY, ridgeY                                         image rows (px)
 *     windows:   [{ x0, y0, x1, y1, kind: 'window'|'door', storey, sill, height }]
 *                x/y: the frame in px; sill and height in metres, the sill above the floor of its storey
 *     pxPerM, method: 'given'|'door'|'window-head'|'storeys'|'eave'|null, confidence: 'high'|'medium'|'low'
 *     – beyond the design contract, for generate.js and the tests:
 *     span: [x0, x1]                    the walls at the ground (px), to match the facade to a plan wall
 *     skylights: [{ x0, y0, x1, y1 }]   framed glass inside the roof surface (roof windows), not in `windows`
 *     roofOptions: [roof]               the types this view allows (the eave side of a mono-pitch looks like a gable's),
 *                                       for houseRoof() over all the facades of a house
 *     storeys, floorYs: [px per storey]  never fewer storeys than the openings stand in (a given count included)
 *     roofFrom: 'ai'|'outline'|null, notes: [Norwegian text]
 *     skew: degrees (0 = straight), workScale: working px per image px (prepareFacade)
 *   }
 *   img is RGBA ({ width, height, data }), one facade per image (a sheet with several is split by sheet.js first).
 *   pxPerM (optional): a known scale, e.g. from another facade of the same sheet; it wins over the door.
 *   All positions are in the pixels of img; for a tilted drawing the rows (groundY …) are taken at the middle of the
 *   house and the boxes are the bounding boxes of the straightened frames.
 *
 *   houseRoof(results) → roof         the roof of a house from all its facades (votes over roofOptions; an AI roof is
 *                                     one more vote, not the answer)
 *
 * The method (the reasoning and the measured results are in notes/planbygger.md):
 *   0. a working copy (prepareFacade): straightened when tilted (projection profiles, ±4°), and resampled when the
 *      house is far outside 400–900 px high
 *   1. paper and ink from the histogram; a «line» is darker than 65 % of the way from the ink to the paper
 *   2. the ground line: the lowest long horizontal line (a faint grey line counts) with ink above it and (almost)
 *      none below it; the wall foot is a plinth line just above it, if there is one. When the house standing on it
 *      holds little of the ink (an architect's sheet: terrain, dimension chains, a level ruler, cars), the line that
 *      carries the biggest and tallest house along most of its width is taken instead, or none
 *   3. the house: the dark components standing on the ground line (a tree beside it is another cluster); its top
 *      outline per column, with chimneys (narrow towers with steep sides) cut down → the ridge
 *   4. the eave: on a long side the roof surface is a dark band under the ridge and the eave is its lower edge; on a
 *      flat top the lower edge of the fascia; on a gable or mono-pitch end the top of the wall corners (the low one)
 *   5. windows and doors: closed frames with a lighter inside, i.e. light regions bounded by dark, at three grey levels
 *      between the ink and the paper. A region counts when it is rectangular (a sloped top is allowed), light, framed
 *      by dark on all four sides and either plain (glass, a leaf) or covered by plain panes (glazing bars lighter than
 *      the frame); a grid of panes counts when its outer frame is dark. A plain region holding other openings is a
 *      wall, unless it is shaped like a door (its panels). Panes, coupled units and stacked parts (a transom, a door's
 *      lower panel, glass seen through a glass railing) are joined. Dropped: rows of narrow equal boards (a railing),
 *      glass railings (thin light posts: not a dark frame; «on a floor but under 1.3 m»), white boards where the glass
 *      is tinted, regions at the outer wall corners. Frames inside the roof surface are roof windows. Dark filled
 *      leaves (black, coloured) are found as solid dark areas on the floor.
 *   6. the scale: a door on the ground (dark, panelled, plain, with a transom; in a line drawing: white and narrow, or
 *      with a handle) is 2.1 m; else glass to the floor in a door's shape; else a door on an upper floor; else the
 *      highest window head in the ground storey is at door height (2.1 m); else an upper floor line is a storey
 *      (floorHeight); else the wall is storeys · floorHeight high. A way that gives a house under 2 or over 30 m is
 *      skipped, and the eave must lie between the ridge and the wall foot
 *   7. each opening → storey (from its sill), sill and height in metres, door or window; the roof type from the
 *      outline: a straight slope (mono-pitch), a peak (gable, with a dormer when one side bulges), a plateau with the
 *      roof surface under it (gable's long side), a plateau without (flat), two heights or two peaks (mixed)
 */
import { luma, histogram, components, raster, open as openMask, close as closeMask, dilate, rotatePoint } from './image.js';

export const FACADE_DEFAULTS = Object.freeze({
  floorHeight: 2.7,
  /** a door with its frame, metres – the scale reference */
  doorHeight: 2.1,
  /** windows whose glass is closer than this are one opening (a coupled window, a glass wall's panels), metres */
  windowGap: 0.2,
  /** door leaves closer than this are one door (a double door), metres */
  doorGap: 0.3,
  /** the tilt searched for, degrees either way (a scan or a rectified photo: 0.5–2°) */
  maxSkew: 4,
  /** the working copy: a house higher than `workMax` px or lower than `workMin` (but at least `workSmall`) is
   *  resampled to about `workTarget` px; the frame and gap rules are tuned at 400–900 px, a small drawing has its own */
  workMax: 900,
  workMin: 400,
  workSmall: 200,
  workTarget: 650,
  /** a house lower than this in the drawing as it came (px): its thin lines are blurred to grey (also in an enlarged
   *  working copy), and a frame counts by its contrast alone */
  smallFrames: 400,
  /** … and lower than this: white glass is greyed a little */
  smallGlass: 250,
  /** a plausible house, ground to ridge, metres: a scale giving anything else is rejected */
  houseMin: 2,
  houseMax: 30,
});

export const ROOF_TYPES = Object.freeze(['gable', 'gable-dormer', 'hip', 'mono-pitch', 'flat', 'mixed']);

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const median = (arr) => {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const round = (v, d = 3) => Math.round(v * 10 ** d) / 10 ** d;
const boxW = (b) => b.x1 - b.x0 + 1;
const boxH = (b) => b.y1 - b.y0 + 1;
const boxArea = (b) => boxW(b) * boxH(b);
function overlapArea(a, b) {
  const w = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) + 1;
  const h = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0) + 1;
  return w > 0 && h > 0 ? w * h : 0;
}
const inside = (a, b, tol = 0) => a.x0 >= b.x0 - tol && a.x1 <= b.x1 + tol && a.y0 >= b.y0 - tol && a.y1 <= b.y1 + tol;

/** Grey value below which a share p of the pixels lie. */
function percentile(hist, n, p) {
  let acc = 0;
  for (let i = 0; i < 256; i++) {
    acc += hist[i];
    if (acc >= n * p) return i;
  }
  return 255;
}

/** Paper (the most common light value) and ink (the darkest 0.2 %, never closer than 60 to the paper). */
export function facadeLevels(grey) {
  const hist = histogram(grey);
  let paper = 255;
  let best = -1;
  for (let i = 128; i < 256; i++) {
    if (hist[i] > best) {
      best = hist[i];
      paper = i;
    }
  }
  const ink = Math.min(percentile(hist, grey.data.length, 0.002), paper - 60);
  return { paper, ink };
}

function darkMask(grey, t) {
  const m = raster(grey.w, grey.h);
  for (let i = 0; i < m.data.length; i++) m.data[i] = grey.data[i] < t ? 1 : 0;
  return m;
}

/**
 * An RGBA image resampled by f (both axes): the area average of the source pixels when shrinking (like a drawing
 * rendered smaller), bilinear when enlarging.
 */
export function resampleImage(img, f) {
  const { width: w, height: h, data: d } = img;
  const W = Math.max(1, Math.round(w * f));
  const H = Math.max(1, Math.round(h * f));
  // per output index along one axis: the source taps and their weights (separable: rows first, then columns)
  const taps = (n, N) => {
    const k = N / n;
    const out = [];
    for (let o = 0; o < N; o++) {
      const t = [];
      if (k < 1) {
        // the output pixel covers [o/k, (o+1)/k) of the source: every source pixel by its overlap
        const a = o / k;
        const b = (o + 1) / k;
        for (let i = Math.floor(a); i < Math.min(n, Math.ceil(b)); i++) t.push(i, (Math.min(b, i + 1) - Math.max(a, i)) * k);
      } else {
        const s = clamp((o + 0.5) / k - 0.5, 0, n - 1);
        const i = Math.floor(s);
        t.push(i, 1 - (s - i));
        if (i + 1 < n) t.push(i + 1, s - i);
      }
      out.push(t);
    }
    return out;
  };
  const tx = taps(w, W);
  const ty = taps(h, H);
  const mid = new Float32Array(W * h * 4);
  for (let y = 0; y < h; y++) {
    for (let X = 0; X < W; X++) {
      const t = tx[X];
      const o = (y * W + X) * 4;
      for (let j = 0; j < t.length; j += 2) {
        const s = (y * w + t[j]) * 4;
        const k = t[j + 1];
        mid[o] += d[s] * k;
        mid[o + 1] += d[s + 1] * k;
        mid[o + 2] += d[s + 2] * k;
        mid[o + 3] += d[s + 3] * k;
      }
    }
  }
  const out = new Uint8ClampedArray(W * H * 4);
  for (let Y = 0; Y < H; Y++) {
    const t = ty[Y];
    for (let X = 0; X < W; X++) {
      const o = (Y * W + X) * 4;
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let j = 0; j < t.length; j += 2) {
        const s = (t[j] * W + X) * 4;
        const k = t[j + 1];
        r += mid[s] * k;
        g += mid[s + 1] * k;
        b += mid[s + 2] * k;
        a += mid[s + 3] * k;
      }
      out[o] = r;
      out[o + 1] = g;
      out[o + 2] = b;
      out[o + 3] = a;
    }
  }
  return { width: W, height: H, data: out };
}

/**
 * rotateImage (image.js) with the nearest source pixel instead of bilinear: the same geometry (rotatePoint maps
 * points), but a thin dark line stays as dark as it was. Straightening a scan by 1° bilinearly greys every 1–2 px frame
 * line once more, and the frames are what the openings are found by.
 */
export function rotateNearest(img, deg) {
  const { width: w, height: h, data: d } = img;
  const out = new Uint8ClampedArray(w * h * 4).fill(255);
  const t = (deg * Math.PI) / 180;
  const cos = Math.cos(t);
  const sin = Math.sin(t);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // inverse map: the source pixel whose centre lands nearest to (x, y)
      const dx = x + 0.5 - w / 2;
      const dy = y + 0.5 - h / 2;
      const sx = Math.round(cos * dx + sin * dy + w / 2 - 0.5);
      const sy = Math.round(-sin * dx + cos * dy + h / 2 - 0.5);
      if (sx < 0 || sy < 0 || sx >= w || sy >= h) continue;
      const o = (y * w + x) * 4;
      const s = (sy * w + sx) * 4;
      out[o] = d[s];
      out[o + 1] = d[s + 1];
      out[o + 2] = d[s + 2];
      out[o + 3] = d[s + 3];
    }
  }
  return { width: w, height: h, data: out };
}

/**
 * The tilt of a drawing in degrees (the sense of rotateImage: positive = turned clockwise; rotateImage(img, −skew)
 * straightens it), 0 when it is straight. A facade is made of horizontal and vertical lines (the ground, the eaves,
 * the walls, the frames), so the projection profiles of the dark pixels on the rows and the columns are sharpest
 * (largest sum of squared counts) at the true angle; the roof slopes (15–45°) do not line up at a small angle. Searched
 * over ±maxDeg in steps of 0.25°, then 0.025°. → degrees, rounded to 0.025
 */
export function estimateFacadeSkew(mask, maxDeg = FACADE_DEFAULTS.maxSkew) {
  const { w, h, data } = mask;
  // the edges of the ink only (a dark pixel beside a light one): the inside of a dark roof would add the same to
  // every angle and flatten the profile
  const edge = (i) => {
    const x = i % w;
    return (x > 0 && !data[i - 1]) || (x < w - 1 && !data[i + 1]) || (i >= w && !data[i - w]) || (i < data.length - w && !data[i + w]);
  };
  let n = 0;
  for (let i = 0; i < data.length; i++) if (data[i] && edge(i)) n++;
  if (n < 50) return 0;
  // at most ~150 000 points, picked by a hash (every k-th pixel in raster order would form a slanted lattice)
  const keep = Math.min(1, 150000 / n);
  const px = new Float32Array(Math.min(n, 150000) + 64);
  const py = new Float32Array(px.length);
  let m = 0;
  for (let i = 0; i < data.length && m < px.length; i++) {
    if (!data[i] || !edge(i)) continue;
    if (keep < 1 && ((Math.imul(i, 2654435761) >>> 0) / 4294967296) >= keep) continue;
    px[m] = (i % w) - w / 2;
    py[m] = Math.floor(i / w) - h / 2;
    m++;
  }
  const R = Math.ceil(Math.hypot(w, h) / 2) + 2;
  const rows = new Float64Array(2 * R + 1);
  const cols = new Float64Array(2 * R + 1);
  const score = (deg) => {
    const t = (deg * Math.PI) / 180;
    const cs = Math.cos(t);
    const sn = Math.sin(t);
    rows.fill(0);
    cols.fill(0);
    // the point straightened by −deg: x = cos·x' + sin·y', y = −sin·x' + cos·y'
    for (let i = 0; i < m; i++) {
      rows[Math.round(-sn * px[i] + cs * py[i]) + R]++;
      cols[Math.round(cs * px[i] + sn * py[i]) + R]++;
    }
    let s = 0;
    for (let i = 0; i < rows.length; i++) s += rows[i] * rows[i] + cols[i] * cols[i];
    return s;
  };
  let best = 0;
  let bestS = score(0);
  const s0 = bestS;
  for (let a = -maxDeg; a <= maxDeg + 1e-9; a += 0.25) {
    const s = score(a);
    if (s > bestS) {
      bestS = s;
      best = a;
    }
  }
  const coarse = best;
  for (let a = coarse - 0.25; a <= coarse + 0.25 + 1e-9; a += 0.025) {
    const s = score(a);
    if (s > bestS) {
      bestS = s;
      best = a;
    }
  }
  // a straight drawing keeps 0 (a rotation blurs the lines); under 0.05° the lines stay within a pixel or two
  best = Math.round(best / 0.025) * 0.025;
  return Math.abs(best) >= 0.05 && bestS > s0 * 1.01 ? round(best, 3) : 0;
}

/** Longest run of 1s in row y between x0 and x1 (gaps up to `gap` px bridged) → { len, a, b }. */
function longestRowRun(mask, y, gap = 2, x0 = 0, x1 = mask.w - 1) {
  const { w, data } = mask;
  let best = { len: 0, a: 0, b: -1 };
  let start = -1;
  let last = -1;
  for (let x = x0; x <= x1; x++) {
    if (!data[y * w + x]) continue;
    if (start < 0 || x - last > gap + 1) {
      if (start >= 0 && last - start + 1 > best.len) best = { len: last - start + 1, a: start, b: last };
      start = x;
    }
    last = x;
  }
  if (start >= 0 && last - start + 1 > best.len) best = { len: last - start + 1, a: start, b: last };
  return best;
}

/** Share of 1-pixels in the rectangle (clipped to the raster). */
function density(mask, x0, y0, x1, y1) {
  x0 = clamp(Math.round(x0), 0, mask.w - 1);
  x1 = clamp(Math.round(x1), 0, mask.w - 1);
  y0 = clamp(Math.round(y0), 0, mask.h - 1);
  y1 = clamp(Math.round(y1), 0, mask.h - 1);
  if (x1 < x0 || y1 < y0) return 0;
  let n = 0;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) n += mask.data[y * mask.w + x];
  return n / ((x1 - x0 + 1) * (y1 - y0 + 1));
}

/**
 * Horizontal lines that may be the ground: rows whose longest run in `faint` (a light threshold: ground lines are
 * often thin and grey) is at least `minFrac` of the inked width, grouped into lines (consecutive rows with the same
 * extent – a plinth on the line is another line), each with the density of `line` ink just above and just below it.
 * `stands` marks a line with clearly more ink above than below. → [{ y (top row), bottom, a, b, above, below, stands }]
 */
export function groundLines(line, faint = line, minFrac = 0.45) {
  const { w, h } = line;
  let inkX0 = w;
  let inkX1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (line.data[y * w + x]) {
        if (x < inkX0) inkX0 = x;
        if (x > inkX1) inkX1 = x;
      }
    }
  }
  if (inkX1 < 0) return [];
  const inkW = inkX1 - inkX0 + 1;
  const same = inkW * 0.05;
  // a row together with the row above it: a thin line that drifts by a pixel over its length (what is left of a tilt
  // after straightening) is still one run
  const pair = raster(w, h);
  for (let i = 0; i < w * h; i++) pair.data[i] = faint.data[i] | (i >= w ? faint.data[i - w] : 0);
  const lines = [];
  for (let y = Math.floor(h * 0.25); y < h; y++) {
    const r = longestRowRun(pair, y, 2);
    if (r.len < inkW * minFrac) continue;
    const l = lines[lines.length - 1];
    if (l && y === l.bottom + 1 && Math.abs(r.a - l.a) <= same && Math.abs(r.b - l.b) <= same) l.bottom = y;
    else lines.push({ y, bottom: y, a: r.a, b: r.b });
  }
  const band = Math.max(4, Math.round(h * 0.03));
  for (const l of lines) {
    l.above = density(line, l.a, l.y - band, l.b, l.y - 3);
    l.below = density(line, l.a, l.bottom + 2, l.b, l.bottom + band);
    l.stands = l.above > 1.5 * l.below + 0.01;
  }
  return lines;
}

/**
 * The ground line: of the lines spanning ≥ 45 % of the inked width (groundLines), the lowest with clearly more ink just
 * above than just below; else the longest. → { y (top row), bottom, a, b, above, below } | null
 */
export function findGround(line, faint = line) {
  const lines = groundLines(line, faint, 0.45);
  let best = null;
  for (const l of lines) if (l.stands && (!best || l.y > best.y)) best = l;
  if (!best && lines.length) best = lines.reduce((a, l) => (l.b - l.a > a.b - a.a ? l : a));
  return best;
}

/**
 * The house standing on the ground line. The columns with ink just above the ground are clustered (gaps under 3 % of
 * the width) and the cluster with most ink is taken; every dark component touching the ground band there is the
 * house (so a wing beyond a white door still belongs to it, a tree beside it does not). `run` is the ground line
 * ({ a, b }): the walls stand within it.
 * → { mask, x0, x1 (the walls at the ground), cx0, cx1 (the whole outline with the eaves), mass (its pixels), height,
 *     footCover (the share of x0…x1 where it touches the band just above the line) } | null
 */
function findHouse(line, gy, run = null) {
  const { w, h } = line;
  const band = Math.max(3, Math.round(h * 0.025));
  const yb0 = Math.max(0, gy - band - 2);
  const yb1 = gy - 3;
  const above = raster(w, h);
  for (let i = 0; i < gy * w; i++) above.data[i] = line.data[i];
  const { labels, comps } = components(above, 8);
  const colInk = new Uint8Array(w);
  for (let y = yb0; y <= yb1; y++) for (let x = 0; x < w; x++) if (above.data[y * w + x]) colInk[x] = 1;
  const gap = Math.max(4, Math.round(w * 0.03));
  const clusters = [];
  let cur = null;
  for (let x = 0; x < w; x++) {
    if (!colInk[x]) continue;
    if (cur && x - cur.b <= gap) {
      cur.b = x;
      cur.n++;
    } else {
      cur = { a: x, b: x, n: 1 };
      clusters.push(cur);
    }
  }
  if (!clusters.length) return null;
  const main = clusters.reduce((a, c) => (c.n > a.n ? c : a));
  const keep = new Set();
  for (let y = yb0; y <= yb1; y++) {
    for (let x = main.a; x <= main.b; x++) {
      const l = labels[y * w + x];
      if (l >= 0) keep.add(l);
    }
  }
  for (const id of [...keep]) {
    const c = comps[id];
    // reaching far beyond the cluster on both sides and low: terrain or a frame around the drawing, not the house
    if (c.minX < main.a - w * 0.1 && c.maxX > main.b + w * 0.1 && c.maxY - c.minY < h * 0.15) keep.delete(id);
  }
  if (!keep.size) return null;
  // components within 2 px of the house and within its columns belong to it too (a roof edge drawn with a small
  // gap to the walls); twice, for a chimney on such a roof
  for (let pass = 0; pass < 2; pass++) {
    const cur = raster(w, h);
    let lo = w;
    let hi = -1;
    for (let i = 0; i < labels.length; i++) {
      if (labels[i] >= 0 && keep.has(labels[i])) {
        cur.data[i] = 1;
        const x = i % w;
        if (x < lo) lo = x;
        if (x > hi) hi = x;
      }
    }
    const grown = dilate(cur, 2);
    const add = new Set();
    for (let i = 0; i < labels.length; i++) {
      const l = labels[i];
      if (l < 0 || keep.has(l) || add.has(l) || !grown.data[i]) continue;
      const c = comps[l];
      if (c.minX >= lo - (hi - lo) * 0.1 && c.maxX <= hi + (hi - lo) * 0.1) add.add(l);
    }
    if (!add.size) break;
    for (const l of add) keep.add(l);
  }
  const mask = raster(w, h);
  let cx0 = w;
  let cx1 = -1;
  let mass = 0;
  for (let i = 0; i < labels.length; i++) {
    if (labels[i] >= 0 && keep.has(labels[i])) {
      mask.data[i] = 1;
      mass++;
      const x = i % w;
      if (x < cx0) cx0 = x;
      if (x > cx1) cx1 = x;
    }
  }
  let x0 = w;
  let x1 = -1;
  for (let y = yb0; y <= yb1; y++) {
    for (let x = cx0; x <= cx1; x++) {
      if (mask.data[y * w + x]) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
      }
    }
  }
  // the walls stand on the ground line, and the roof reaches at most 15 % of their width beyond them: what is
  // joined to the house further out (a terrain line with a car on the road, a pointer line drawn into the facade)
  // is not the house
  if (run) {
    x0 = Math.max(x0, run.a);
    x1 = Math.min(x1, run.b);
  }
  if (x1 < x0) return null;
  const lo = Math.max(0, Math.floor(x0 - 0.15 * (x1 - x0)));
  const hi = Math.min(w - 1, Math.ceil(x1 + 0.15 * (x1 - x0)));
  if (cx0 < lo || cx1 > hi) {
    const clear = (x, y) => {
      mass -= mask.data[y * w + x];
      mask.data[y * w + x] = 0;
    };
    for (let y = 0; y < gy; y++) {
      for (let x = cx0; x < lo; x++) clear(x, y);
      for (let x = hi + 1; x <= cx1; x++) clear(x, y);
    }
    cx0 = Math.max(cx0, lo);
    cx1 = Math.min(cx1, hi);
  }
  // how much of its width the house stands on the line with: walls, a plinth or a door sill all along, not one
  // thin extension line coming down to a dimension chain
  let foot = 0;
  for (let x = x0; x <= x1; x++) {
    let any = 0;
    for (let y = yb0; y <= yb1 && !any; y++) any = mask.data[y * w + x];
    foot += any;
  }
  let top = gy;
  for (let y = 0; y < gy && top === gy; y++) {
    for (let x = cx0; x <= cx1; x++) {
      if (mask.data[y * w + x]) {
        top = y;
        break;
      }
    }
  }
  return { mask, x0, x1, cx0, cx1, mass, footCover: foot / (x1 - x0 + 1), height: gy - top };
}

/**
 * The outline without chimneys: a narrow tower (under 6 % of the width) that rises steeply from the roof line and
 * falls steeply back to it is cut down to the higher of its two feet; the rest of the outline is kept as it is,
 * so the tip of a gable keeps its height (a 1-D opening would cut it by the slope times the window).
 */
function withoutChimneys(raw) {
  const n = raw.length;
  let top = 0;
  for (const v of raw) top = Math.max(top, v);
  const out = Float64Array.from(raw);
  const steep = Math.max(3, top * 0.03);
  const maxW = Math.max(3, Math.round(n * 0.06));
  for (let i = 2; i < n - 2; i++) {
    if (raw[i] - raw[i - 2] < steep) continue;
    let j = -1;
    for (let k = i; k < Math.min(n - 2, i + maxW); k++) {
      if (raw[k] - raw[k + 2] >= steep) {
        j = k;
        break;
      }
    }
    if (j < 0) continue;
    const a = raw[i - 2];
    const b = raw[j + 2];
    let tower = true;
    for (let k = i; k <= j && tower; k++) tower = raw[k] > Math.max(a, b);
    if (!tower) continue;
    // the higher foot: a chimney often stands where two roof parts meet
    for (let k = i - 1; k <= j + 1; k++) out[k] = Math.min(raw[k], Math.max(a, b));
    i = j + 1;
  }
  return out;
}

/** The top outline: per column of [cx0, cx1] the height above the ground of the house's topmost pixel. */
function outline(house, gy) {
  const { mask, cx0, cx1 } = house;
  const { w } = mask;
  const hgt = new Float64Array(cx1 - cx0 + 1);
  for (let x = cx0; x <= cx1; x++) {
    for (let y = 0; y < gy; y++) {
      if (mask.data[y * w + x]) {
        hgt[x - cx0] = gy - y;
        break;
      }
    }
  }
  return hgt;
}

/**
 * A wall corner: scanning inwards from `from`, the first column with a long vertical dark run whose foot stands on
 * the ground (within `foot` px); of it and the next `near` columns the one reaching highest (a grey plinth board
 * or a downpipe beside the corner line is lower). → { x, top } | null
 */
function wallCorner(line, gy, from, to, minLen, foot, near) {
  const { w } = line;
  const step = to >= from ? 1 : -1;
  let found = null;
  for (let x = from; x !== to + step; x += step) {
    if (x < 0 || x >= w) continue;
    if (found && Math.abs(x - found.first) > near) break;
    let y = gy - 3;
    while (y > gy - foot && !line.data[y * w + x]) y--;
    if (!line.data[y * w + x]) continue;
    let top = y;
    let miss = 0;
    for (let yy = y; yy >= 0; yy--) {
      if (line.data[yy * w + x]) {
        top = yy;
        miss = 0;
      } else if (++miss > 2) break;
    }
    if (y - top < minLen) continue;
    if (!found) found = { first: x, x, top };
    else if (top < found.top) Object.assign(found, { x, top });
  }
  return found && { x: found.x, top: found.top };
}

/**
 * The roof band of a long side: per row from the ridge down, the share of the given columns (where the outline is at
 * the ridge: the roof surface is seen under it) darker than t. The
 * band starts within the top 15 % (share ≥ 30 %); its bottom is the first dark row (share ≥ 50 %) after which the
 * next 5 % of the house height stay light on average (< 25 %): a thin dark soffit under a white fascia still belongs
 * to the band, the window heads under it do not. → { top, bottom } | null
 */
function roofBand(grey, t, cols, ridgeY, gy) {
  const { w } = grey;
  const H = gy - ridgeY;
  const y0 = Math.max(0, Math.round(ridgeY));
  const shares = new Float64Array(gy - y0 + 1);
  const dk = (x, y) => y >= 0 && y < grey.h && grey.data[y * w + x] < t;
  for (let y = y0; y <= gy; y++) {
    let n = 0;
    // a pixel counts when it or a vertical neighbour is dark: the lines of a hatched roof are a few px apart
    for (const x of cols) n += dk(x, y) || dk(x, y - 1) || dk(x, y + 1) ? 1 : 0;
    shares[y - y0] = n / Math.max(1, cols.length);
  }
  let top = -1;
  for (let y = y0; y < ridgeY + H * 0.15; y++) {
    if (shares[y - y0] >= 0.3) {
      top = y;
      break;
    }
  }
  if (top < 0) return null;
  const L = Math.max(3, Math.round(H * 0.05));
  for (let y = top; y < gy - H * 0.1; y++) {
    if (shares[y - y0] < 0.5) continue;
    let sum = 0;
    for (let k = 1; k <= L; k++) sum += shares[Math.min(shares.length - 1, y - y0 + k)];
    if (sum / L < 0.25) return { top, bottom: y };
  }
  return null;
}

/**
 * Light regions bounded by dark (grey < t) inside `box`: candidates for glass, panes and door leaves. Kept when they
 * do not touch the box, are at least `minSide` across, not a thin strip, and rectangular (the rows and columns span
 * ≥ 85 % of the bounding box in ≥ 75 % of the rows and columns – a sloped top under a roof is allowed).
 * Each gets its mean grey, standard deviation and texture (grey steps ≥ `step` between
 * neighbouring pixels of the region, per pixel: cladding gives many, glass few).
 */
export function lightRegions(grey, t, box, o) {
  const { w } = grey;
  const [bx0, by0, bx1, by1] = box;
  const bw0 = bx1 - bx0 + 1;
  const sub = raster(bw0, by1 - by0 + 1);
  for (let y = by0; y <= by1; y++) for (let x = bx0; x <= bx1; x++) sub.data[(y - by0) * bw0 + x - bx0] = grey.data[y * w + x] >= t ? 1 : 0;
  const { labels, comps } = components(sub, 4);
  const out = [];
  for (const c of comps) {
    const bw = c.maxX - c.minX + 1;
    const bh = c.maxY - c.minY + 1;
    if (c.minX <= 0 || c.minY <= 0 || c.maxX >= bw0 - 1 || c.maxY >= sub.h - 1) continue;
    if (Math.min(bw, bh) < o.minSide || Math.max(bw, bh) > o.maxSide) continue;
    if (Math.max(bw / bh, bh / bw) > o.maxAspect) continue;
    if (c.area < bw * bh * 0.5) continue;
    const rowSpan = [];
    for (let y = c.minY; y <= c.maxY; y++) {
      let a = -1;
      let b = -1;
      for (let x = c.minX; x <= c.maxX; x++) {
        if (labels[y * bw0 + x] === c.id) {
          if (a < 0) a = x;
          b = x;
        }
      }
      rowSpan.push(a >= 0 ? b - a + 1 : 0);
    }
    const colSpan = [];
    const colBottom = [];
    for (let x = c.minX; x <= c.maxX; x++) {
      let a = -1;
      let b = -1;
      for (let y = c.minY; y <= c.maxY; y++) {
        if (labels[y * bw0 + x] === c.id) {
          if (a < 0) a = y;
          b = y;
        }
      }
      colSpan.push(a >= 0 ? b - a + 1 : 0);
      colBottom.push(b);
    }
    const share = (arr, test) => arr.filter(test).length / arr.length;
    const rect = share(rowSpan, (v) => v >= bw * 0.85) >= 0.75 && share(colSpan, (v) => v >= bh * 0.85) >= 0.75;
    // a sloped top (glass under a mono-pitch roof): the lower 60 % of the rows full, the columns standing on one
    // bottom line and at least half as high as the box
    const sloped = share(rowSpan.slice(Math.round(bh * 0.4)), (v) => v >= bw * 0.85) >= 0.9
      && share(colBottom, (v) => c.maxY - v <= 2) >= 0.9 && share(colSpan, (v) => v >= bh * 0.5) >= 0.9;
    if (!rect && !sloped) continue;
    // mean grey and texture over the region's own pixels
    let sum = 0;
    let sq = 0;
    let edges = 0;
    for (let y = c.minY; y <= c.maxY; y++) {
      for (let x = c.minX; x <= c.maxX; x++) {
        const i = y * bw0 + x;
        if (labels[i] !== c.id) continue;
        const g = grey.data[(y + by0) * w + x + bx0];
        sum += g;
        sq += g * g;
        // texture inside only: the antialiased ring along the frame is not texture
        if (x <= c.minX || y <= c.minY || x >= c.maxX - 1 || y >= c.maxY - 1) continue;
        if (labels[i + 1] === c.id && Math.abs(grey.data[(y + by0) * w + x + bx0 + 1] - g) >= o.step) edges++;
        if (labels[i + bw0] === c.id && Math.abs(grey.data[(y + by0 + 1) * w + x + bx0] - g) >= o.step) edges++;
      }
    }
    out.push({
      x0: c.minX + bx0, y0: c.minY + by0, x1: c.maxX + bx0, y1: c.maxY + by0, area: c.area, t,
      mean: sum / c.area, sd: Math.sqrt(Math.max(0, sq / c.area - (sum / c.area) ** 2)), tex: edges / c.area,
    });
  }
  return out;
}

/**
 * The frame around a box: per side the median, along the side, of the darkest grey within `reach` px outside it.
 * → [top, right, bottom, left]
 */
function frameSides(grey, b, reach) {
  const { w, h } = grey;
  const at = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? 255 : grey.data[y * w + x]);
  const side = (n, pt, dx, dy) => {
    const v = [];
    for (let i = 0; i < n; i++) {
      const [x, y] = pt(i);
      let m = 255;
      for (let k = 1; k <= reach; k++) m = Math.min(m, at(x + dx * k, y + dy * k));
      v.push(m);
    }
    return median(v);
  };
  const bw = boxW(b);
  const bh = boxH(b);
  return [
    side(bw, (i) => [b.x0 + i, b.y0], 0, -1),
    side(bh, (i) => [b.x1, b.y0 + i], 1, 0),
    side(bw, (i) => [b.x0 + i, b.y1], 0, 1),
    side(bh, (i) => [b.x0, b.y0 + i], -1, 0),
  ];
}

/** The pooled mean grey and standard deviation of regions (each with mean, sd and its pixel count in `key`). */
function toneOf(parts, key = 'area') {
  const n = parts.reduce((s, p) => s + p[key], 0);
  const mean = parts.reduce((s, p) => s + p.mean * p[key], 0) / n;
  const v = parts.reduce((s, p) => s + p[key] * (p.sd ** 2 + (p.mean - mean) ** 2), 0) / n;
  return { mean, sd: Math.sqrt(v), n };
}

/** Share of the box's area covered by the union of `parts` (boxes inside it). */
function coverage(b, parts) {
  const bw = boxW(b);
  const bh = boxH(b);
  const m = new Uint8Array(bw * bh);
  for (const p of parts) {
    for (let y = Math.max(p.y0, b.y0); y <= Math.min(p.y1, b.y1); y++) {
      for (let x = Math.max(p.x0, b.x0); x <= Math.min(p.x1, b.x1); x++) m[(y - b.y0) * bw + x - b.x0] = 1;
    }
  }
  let n = 0;
  for (let i = 0; i < m.length; i++) n += m[i];
  return n / m.length;
}

/**
 * Joins boxes into one when they lie side by side ('h': the gap between them ≤ gap px and they overlap ≥ 70 % of the
 * taller one vertically) or stacked ('v': the same across). Repeats until nothing changes.
 */
function joinBoxes(boxes, gap, axes = 'hv') {
  const out = boxes.map((b) => ({ ...b, parts: b.parts ?? [b] }));
  // across the gap the two overlap ≥ 70 % of the larger, or one lies within the other's extent (a pane beside a row of
  // panes that is already joined)
  const within = (a0, a1, b0, b1) => (a0 >= b0 - gap && a1 <= b1 + gap) || (b0 >= a0 - gap && b1 <= a1 + gap);
  const touch = (a, b) => {
    if (axes.includes('h')) {
      const ov = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0) + 1;
      const d = Math.max(a.x0, b.x0) - Math.min(a.x1, b.x1) - 1;
      if (d <= gap && ov > 0 && (ov >= 0.7 * Math.max(boxH(a), boxH(b)) || within(a.y0, a.y1, b.y0, b.y1))) return true;
    }
    if (axes.includes('v')) {
      const ov = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) + 1;
      const d = Math.max(a.y0, b.y0) - Math.min(a.y1, b.y1) - 1;
      if (d <= gap && ov > 0 && (ov >= 0.7 * Math.max(boxW(a), boxW(b)) || within(a.x0, a.x1, b.x0, b.x1))) return true;
    }
    return false;
  };
  let changed = true;
  while (changed) {
    changed = false;
    outer: for (let i = 0; i < out.length; i++) {
      for (let j = i + 1; j < out.length; j++) {
        const a = out[i];
        const b = out[j];
        if (!touch(a, b)) continue;
        out[i] = {
          ...a, x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1),
          parts: [...a.parts, ...b.parts], dark: a.dark || b.dark,
        };
        out.splice(j, 1);
        changed = true;
        break outer;
      }
    }
  }
  return out;
}

/** Grows a box outwards over its frame: a side moves out while the row / column just outside is ≥ 60 % dark. */
function growToFrame(grey, b, darkT, reach) {
  const { w, h } = grey;
  const g = { ...b };
  const darkShare = (x0, y0, x1, y1) => {
    if (x0 < 0 || y0 < 0 || x1 >= w || y1 >= h) return 0;
    let n = 0;
    let all = 0;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        all++;
        if (grey.data[y * w + x] < darkT) n++;
      }
    }
    return n / all;
  };
  for (let k = 0; k < reach && darkShare(g.x0, g.y0 - 1, g.x1, g.y0 - 1) >= 0.6; k++) g.y0--;
  for (let k = 0; k < reach && darkShare(g.x0, g.y1 + 1, g.x1, g.y1 + 1) >= 0.6; k++) g.y1++;
  for (let k = 0; k < reach && darkShare(g.x0 - 1, g.y0, g.x0 - 1, g.y1) >= 0.6; k++) g.x0--;
  for (let k = 0; k < reach && darkShare(g.x1 + 1, g.y0, g.x1 + 1, g.y1) >= 0.6; k++) g.x1++;
  return g;
}

/** Dark filled door leaves (black, coloured) standing on the floor: solid dark areas shaped like a door. */
function darkDoors(grey, t, box, o) {
  const { w } = grey;
  const [bx0, by0, bx1, by1] = box;
  const bw0 = bx1 - bx0 + 1;
  const sub = raster(bw0, by1 - by0 + 1);
  for (let y = by0; y <= by1; y++) for (let x = bx0; x <= bx1; x++) sub.data[(y - by0) * bw0 + x - bx0] = grey.data[y * w + x] < t ? 1 : 0;
  // solid dark areas only: a closing fills a glass slit, an opening removes the frames, outlines and lines that
  // touch the leaf
  const solidDark = openMask(closeMask(sub, o.slit), o.r);
  const { labels, comps } = components(solidDark, 4);
  const out = [];
  for (const c of comps) {
    const bh = c.maxY - c.minY + 1;
    if (bh < o.minH || bh > o.maxH) continue;
    if (Math.abs(o.floorY - 1 - (c.maxY + by0)) > o.tol) continue;
    // the leaf: the longest run of columns that are dark over ≥ 90 % of the height, so the frame of a sidelight beside it
    // is not part of it
    const full = [];
    for (let x = c.minX; x <= c.maxX; x++) {
      let n = 0;
      for (let y = c.minY; y <= c.maxY; y++) if (labels[y * bw0 + x] === c.id) n++;
      full.push(n >= bh * 0.9);
    }
    // close gaps up to the width of a glass slit (8 % of the height) between full columns; a sidelight is wider
    const slit = Math.max(2, Math.round(bh * 0.08));
    let lastFull = -1;
    for (let i = 0; i < full.length; i++) {
      if (!full[i]) continue;
      if (lastFull >= 0 && i - lastFull - 1 <= slit) for (let k = lastFull + 1; k < i; k++) full[k] = true;
      lastFull = i;
    }
    let best = [0, -1];
    for (let i = 0, s = -1; i <= full.length; i++) {
      if (i < full.length && full[i]) {
        if (s < 0) s = i;
      } else if (s >= 0) {
        if (i - 1 - s > best[1] - best[0]) best = [s, i - 1];
        s = -1;
      }
    }
    const lw = best[1] - best[0] + 1;
    if (lw < 2 || bh < lw * 1.5 || bh > lw * 4) continue;
    out.push({ x0: c.minX + best[0] + bx0, y0: c.minY + by0, x1: c.minX + best[1] + bx0, y1: c.maxY + by0, dark: true });
  }
  return out;
}

/**
 * Drops railing boards: four or more narrow boxes (height ≥ 2.5 × width) of the same height in a row, spaced by
 * less than twice their width.
 */
function dropRailings(boxes) {
  const narrow = boxes.filter((b) => boxH(b) >= 2.5 * boxW(b));
  const drop = new Set();
  for (const b of narrow) {
    const row = narrow.filter((c) => Math.abs(c.y0 - b.y0) <= boxH(b) * 0.1 && Math.abs(c.y1 - b.y1) <= boxH(b) * 0.1
      && Math.abs(boxW(c) - boxW(b)) <= boxW(b) * 0.3);
    if (row.length < 4) continue;
    row.sort((p, q) => p.x0 - q.x0);
    let run = [row[0]];
    for (let i = 1; i <= row.length; i++) {
      if (i < row.length && row[i].x0 - run[run.length - 1].x1 - 1 <= 2 * boxW(b)) run.push(row[i]);
      else {
        if (run.length >= 4) for (const r of run) drop.add(r);
        if (i < row.length) run = [row[i]];
      }
    }
  }
  return boxes.filter((b) => !drop.has(b));
}

/**
 * The roof type from the outline (heights above the ground per column, chimneys removed), the roof band and the
 * openings above the eave. → { roof, why }
 */
function roofFromOutline(p, { bandH, H, eaveH, dormer }) {
  const n = p.length;
  if (n < 5 || H <= 0) return { roof: null, options: [], why: 'for lite omriss' };
  const q = Array.from(p, (v) => v / H);
  const top = q.filter((v) => v >= 0.97).length / n;
  // the plateau's extent and the heights at the ends
  let i0 = 0;
  while (i0 < n && q[i0] < 0.97) i0++;
  let i1 = n - 1;
  while (i1 > 0 && q[i1] < 0.97) i1--;
  const qa = median(q.slice(0, Math.max(1, Math.round(n * 0.04))));
  const qb = median(q.slice(n - Math.max(1, Math.round(n * 0.04))));
  // a straight line through the whole outline (mono-pitch end)
  const fit = (lo, hi) => {
    let sx = 0;
    let sy = 0;
    let sxx = 0;
    let sxy = 0;
    const m = hi - lo + 1;
    for (let i = lo; i <= hi; i++) {
      sx += i;
      sy += q[i];
      sxx += i * i;
      sxy += i * q[i];
    }
    const k = (m * sxy - sx * sy) / Math.max(1e-9, m * sxx - sx * sx);
    const c = (sy - k * sx) / m;
    let worst = 0;
    for (let i = lo; i <= hi; i++) worst = Math.max(worst, Math.abs(q[i] - (k * i + c)));
    return { k, c, worst };
  };
  const all = fit(Math.round(n * 0.03), Math.round(n * 0.97));
  const rise = Math.abs(all.k) * n;
  if (rise >= 0.08 && all.worst <= 0.05 && top < 0.35) return { roof: 'mono-pitch', options: ['mono-pitch'], why: `rett skrå linje (${Math.round(rise * 100)} %)` };
  // levels: share of the outline at clearly different heights (a lower wing beside the main volume)
  const low = q.filter((v) => v < 0.9).length / n;
  const flatLow = (() => {
    // a lower plateau: a run ≥ 12 % of the width where the height is constant (± 2 %) and under 85 %
    let best = 0;
    let s = 0;
    for (let i = 1; i < n; i++) {
      if (Math.abs(q[i] - q[s]) <= 0.02 && q[i] < 0.85) best = Math.max(best, i - s + 1);
      else s = i;
    }
    return best / n;
  })();
  if (top >= 0.5) {
    // two volumes of different height (a lower wing, a carport): mixed; the main volume's own type is an option
    const main = bandH >= 0.12 * H ? ['gable', 'mono-pitch'] : ['flat', 'mono-pitch'];
    if (flatLow >= 0.12) return { roof: 'mixed', options: ['mixed', ...main], why: `to høyder (lavere del ${Math.round(flatLow * 100)} %)` };
    const ends = Math.min(qa, qb);
    if (bandH >= 0.12 * H) {
      // a long side with the roof surface seen; sloping ends from about the eave up → hipped
      if (ends <= eaveH / H + 0.15 && top < 0.85 && i0 / n > 0.08 && (n - 1 - i1) / n > 0.08) return { roof: 'hip', options: ['hip'], why: 'skrå ender fra takfoten' };
      // the roof surface seen from the eave: a gable's long side or a mono-pitch's low side look the same
      if (dormer) return { roof: 'gable-dormer', options: ['gable-dormer', 'mono-pitch'], why: 'langside med takflate og ark' };
      return { roof: 'gable', options: ['gable', 'mono-pitch'], why: 'langside med takflate' };
    }
    // no roof surface under the edge: a flat roof or the high side of a mono-pitch
    return { roof: 'flat', options: ['flat', 'mono-pitch'], why: 'flatt omriss uten takflate' };
  }
  // a peak: both sides fall to the ends
  const peak = (i0 + i1) / 2 / n;
  if (top < 0.35 && peak > 0.2 && peak < 0.8 && qa < 0.9 && qb < 0.9) {
    // two high points with a lower part between them: two roofs (two mono-pitches rising to a lower link). The high
    // points: the top, and the highest place at least 15 % of the width away from it that is the top of its ±5 %
    let m1 = 0;
    for (let i = 0; i < n; i++) if (q[i] > q[m1]) m1 = i;
    let m2 = -1;
    const nb = Math.max(1, Math.round(n * 0.05));
    for (let i = 0; i < n; i++) {
      if (Math.abs(i - m1) < n * 0.15 || q[i] < 0.85) continue;
      let isTop = true;
      for (let k = Math.max(0, i - nb); k <= Math.min(n - 1, i + nb) && isTop; k++) isTop = q[k] <= q[i];
      if (isTop && (m2 < 0 || q[i] > q[m2])) m2 = i;
    }
    const floorQ = m2 >= 0 ? Math.min(q[m1], q[m2]) - 0.03 : 0;
    const dip = m2 >= 0 ? q.slice(Math.min(m1, m2), Math.max(m1, m2) + 1).filter((v) => v < floorQ).length / n : 0;
    if (dip >= 0.1) return { roof: 'mixed', options: ['mixed', 'mono-pitch'], why: `to høye punkter med lavere midtparti (${Math.round(dip * 100)} %)` };
    // the slopes from the eave up (below it the outline is the overhang, a wall or the terrain beside the house)
    const e = eaveH / H + 0.05;
    let lo = Math.round(n * 0.03);
    while (lo < i0 && q[lo] < e) lo++;
    let hi = Math.round(n * 0.97);
    while (hi > i1 && q[hi] < e) hi--;
    const l = fit(Math.min(lo, Math.max(0, i0 - 2)), i0);
    const r = fit(i1, Math.max(hi, Math.min(n - 1, i1 + 2)));
    const bump = Math.max(l.worst, r.worst);
    if (bump > 0.06 || dormer) return { roof: 'gable-dormer', options: ['gable-dormer'], why: `gavl med ark (avvik ${Math.round(bump * 100)} %)` };
    return { roof: 'gable', options: ['gable', 'gable-dormer'], why: 'gavl' };
  }
  if (low > 0.2) return { roof: 'mixed', options: ['mixed'], why: 'sammensatt omriss' };
  return { roof: 'mixed', options: ['mixed'], why: 'uklart omriss' };
}

/**
 * A door handle: a small dark mark inside the leaf (its glass box g), near one side, 0.8–1.25 m above the floor –
 * not a glazing bar (a bar runs across the glass). → bool
 */
function hasHandle(grey, u, floorY, pxPerM, darkT) {
  const { w } = grey;
  const g = u.g;
  const gw = g.x1 - g.x0 + 1;
  const gh = g.y1 - g.y0 + 1;
  const side = Math.max(2, Math.round(gw * 0.3));
  const ya = Math.max(g.y0, Math.round(floorY - 1.25 * pxPerM));
  const yb = Math.min(g.y1, Math.round(floorY - 0.8 * pxPerM));
  const dark = (x, y) => grey.data[y * w + x] < darkT;
  let n = 0;
  for (let y = ya; y <= yb; y++) {
    for (let x = g.x0; x <= g.x1; x++) {
      if (x >= g.x0 + side && x <= g.x1 - side) continue;
      if (!dark(x, y)) continue;
      // the dark runs through it, across and along the glass
      let h0 = x;
      let h1 = x;
      while (h0 > g.x0 && dark(h0 - 1, y)) h0--;
      while (h1 < g.x1 && dark(h1 + 1, y)) h1++;
      let v0 = y;
      let v1 = y;
      while (v0 > g.y0 && dark(x, v0 - 1)) v0--;
      while (v1 < g.y1 && dark(x, v1 + 1)) v1++;
      if (h1 - h0 + 1 < 0.5 * gw && v1 - v0 + 1 < 0.25 * gh) n++;
    }
  }
  return n >= 2 && n <= 0.03 * gw * gh;
}

/**
 * The roof of a house from its facades. Each facade votes with weight 1 for the types its outline allows
 * (`roofOptions`, split evenly), so a type all the views allow wins over the first guess of one view (the eave side of
 * a mono-pitch looks like a gable's). An AI roof is one more vote of weight `aiWeight` for its type on that facade: it
 * settles a tie or a view the outline cannot read, but one AI answer does not outvote the other views (a model also
 * sees only one view, and the eave side does not tell a gable from a mono-pitch for it either). → roof | null
 */
export function houseRoof(results, { aiWeight = 1 } = {}) {
  const votes = new Map();
  const add = (k, v) => votes.set(k, (votes.get(k) ?? 0) + v);
  for (const r of results) {
    if (!r) continue;
    const opts = r.roofOptions?.length ? r.roofOptions : r.roof && r.roofFrom !== 'ai' ? [r.roof] : [];
    for (const o of opts) add(o, 1 / opts.length);
    if (r.roofFrom === 'ai' && r.roof) add(r.roof, aiWeight);
  }
  let best = null;
  for (const [k, v] of votes) {
    if (!best || v > votes.get(best) + 1e-9) best = k;
    // a tie goes to the type an AI answer named
    else if (Math.abs(v - votes.get(best)) <= 1e-9 && results.some((r) => r?.roofFrom === 'ai' && r.roof === k)) best = k;
  }
  return best;
}

/** Matches the AI's normalised boxes to ours: kind from the AI where a box overlaps ≥ 30 % (IoU). */
function applyAiKinds(windows, ai, w, h) {
  if (!Array.isArray(ai?.windows)) return 0;
  let n = 0;
  for (const a of ai.windows) {
    if (!Array.isArray(a?.bbox) || a.bbox.length !== 4 || (a.kind !== 'door' && a.kind !== 'window')) continue;
    const b = { x0: a.bbox[0] * w, y0: a.bbox[1] * h, x1: a.bbox[2] * w, y1: a.bbox[3] * h };
    let best = null;
    let bestIou = 0.3;
    for (const o of windows) {
      const i = overlapArea(o, b);
      const iou = i / (boxArea(o) + boxArea(b) - i);
      if (iou > bestIou) {
        bestIou = iou;
        best = o;
      }
    }
    if (best && best.kind !== a.kind) {
      best.kind = a.kind;
      n++;
    }
  }
  return n;
}

/**
 * The wall foot: where the walls end above the ground line – the top of a plinth band (a horizontal line a little above
 * the ground line, separated from it), else the ground line itself.
 */
function wallFoot(line, gy, x0, x1, H) {
  // a row is a line when half of the house's width is dark in it (the foot may step at a recessed entrance)
  const long = (y) => density(line, x0, y, x1, y) >= 0.5;
  // the plinth zone: the lowest 7 % of the house
  const lim = gy - H * 0.07;
  let seenGap = false;
  for (let y = gy - 1; y >= lim; y--) {
    if (!long(y)) seenGap = true;
    else if (seenGap) {
      // the top of that line; dark rows going on above the plinth zone are a dark wall or a roof band, not a plinth
      let t = y;
      while (t > 0 && long(t - 1)) {
        if (t - 1 < lim) return gy;
        t--;
      }
      return t;
    }
  }
  return gy;
}

/**
 * The eave of a view without a roof surface (a flat roof or the high side of a mono-pitch): the lowest long dark
 * line in the roof edge just under the ridge (the fascia's lower edge). → y | null
 */
function edgeBottom(mask, ridgeY, H, x0, x1) {
  let best = null;
  const minLen = (x1 - x0 + 1) * 0.6;
  for (let y = Math.round(ridgeY); y <= ridgeY + H * 0.15; y++) {
    if (longestRowRun(mask, y, 2, x0, x1).len >= minLen) best = y;
  }
  return best;
}

/**
 * Windows and doors: closed frames with a lighter inside (see the file header, step 5). → units [{ x0, y0, x1, y1,
 * parts, mean, dark?, leaf?, panel?, transom? }] in px, before the scale is known.
 */
function findOpenings(grey, c) {
  const { ink, range, H, box, minSide, paneSide, mullion, floorY } = c;
  const o = { minSide: paneSide, maxSide: H * 0.8, maxAspect: 12, step: Math.max(12, range * 0.12) };
  const levels = [0.35, 0.55, 0.75].map((f) => Math.round(ink + f * range));
  const reach = Math.max(2, Math.round(minSide * 0.6));
  const cands = [];
  for (const t of levels) {
    for (const r of lightRegions(grey, t, box, o)) {
      const short = Math.min(boxW(r), boxH(r));
      const aspect = Math.max(boxW(r) / boxH(r), boxH(r) / boxW(r));
      // a narrow region must look like a pane, a tall one must be wide enough: not a strip of cladding
      if (short < minSide && aspect > 4) continue;
      const frame = Math.max(...frameSides(grey, r, reach));
      r.frame = frame;
      // a strong frame is dark in itself; in a small drawing (house under 200 px) every line is blurred to grey, and
      // only the contrast counts
      r.strong = frame <= Math.min(c.blurred ? 255 : ink + 0.3 * range, r.mean - 0.3 * range);
      r.rel = frame <= r.mean - 0.25 * range;
      r.bright = r.mean >= ink + 0.55 * range;
      r.uniform = r.tex < 0.1;
      if (r.bright && r.rel) cands.push(r);
    }
  }
  const tol = Math.max(3, H * 0.03);
  const doorLike = (b) => boxH(b) >= 1.4 * boxW(b) && Math.abs(floorY - 1 - b.y1) <= tol * 2;
  const panes = cands.filter((d) => d.uniform);
  const accepted = [];
  // a region inside another that touches two or more of its sides is the same glass at a higher grey level (the light
  // part of two-tone glass), not an opening or a panel inside it
  const sides = (d, r) => [d.x0 - r.x0 <= 2, r.x1 - d.x1 <= 2, d.y0 - r.y0 <= 2, r.y1 - d.y1 <= 2].filter(Boolean).length;
  const nested = (d, r) => d !== r && inside(d, r, 1) && boxArea(d) <= 0.7 * boxArea(r) && sides(d, r) <= 1;
  for (const r of cands) {
    if (!r.strong) continue;
    const inner = panes.filter((d) => d !== r && inside(d, r, 1) && boxArea(d) <= 0.7 * boxArea(r));
    r.cov = inner.length ? coverage(r, inner) : 0;
    const holes = inner.filter((d) => nested(d, r));
    if (r.cov >= 0.4) accepted.push(r);
    else if (holes.length && r.cov >= 0.03) {
      if (doorLike(r)) accepted.push(Object.assign(r, { leaf: true }));
    } else if (r.uniform) accepted.push(r);
  }
  // a wall: a plain region holding other openings (a leaf holds only its panels, a window its panes)
  const walls = new Set(accepted.filter((r) => !r.leaf && r.cov < 0.4 && accepted.some((d) => nested(d, r) && boxArea(d) < 0.5 * boxArea(r))));
  // largest first; a region mostly inside a larger one goes (the same glass at another grey level, or its panes)
  const pool = accepted.filter((r) => !walls.has(r)).sort((p, q) => boxArea(q) - boxArea(p));
  const kept = [];
  for (const r of pool) if (!kept.some((k) => overlapArea(r, k) >= 0.7 * boxArea(r))) kept.push(r);
  // a grid of panes with grey glazing bars and no region around them all (a black bar splits the glass): the panes
  // join, and the group counts when its own outer frame is strong
  const strongFrame = (b, mean) => Math.max(...frameSides(grey, b, reach)) <= Math.min(c.blurred ? 255 : ink + 0.3 * range, mean - 0.3 * range);
  const loose = [];
  for (const d of panes.filter((p) => !p.strong).sort((p, q) => boxArea(q) - boxArea(p))) {
    if ([...kept, ...loose].some((k) => overlapArea(d, k) >= 0.5 * boxArea(d))) continue;
    loose.push(d);
  }
  for (const g of joinBoxes(loose, mullion)) {
    if (g.parts.length < 2) continue;
    const tone = toneOf(g.parts);
    if (strongFrame(g, tone.mean)) kept.push({ ...g, ...tone, strong: true, uniform: true, cov: 1 });
  }
  // panes join into windows
  let units = joinBoxes(dropRailings(kept), mullion);
  for (const u of units) {
    Object.assign(u, toneOf(u.parts));
    u.leaf = u.parts.some((p) => p.leaf);
    u.panel = lowerPanel(u, 0.06 * range);
  }
  // a door with a lower panel: glass ending a little above the floor, a frame line as dark as a window frame going on
  // down beside it on both sides, and a bottom rail across it just above the floor (a rail may be a grey line)
  const railT = c.paper - 0.35 * range;
  const frameDark = ink + 0.3 * range;
  const dk = (x, y, t = railT) => x >= 0 && y >= 0 && x < grey.w && y < grey.h && grey.data[y * grey.w + x] < t;
  // a leaf of a double door is tested together with its twin beside it (the frame lines are on the outer sides)
  const twin = (u) => units.find((v) => v !== u && Math.abs(v.y0 - u.y0) <= 2 && Math.abs(v.y1 - u.y1) <= 2
    && Math.abs(boxW(v) - boxW(u)) <= 0.15 * boxW(u) && Math.max(v.x0, u.x0) - Math.min(v.x1, u.x1) - 1 <= 0.4 * boxW(u));
  for (const u0 of units) {
    const t = twin(u0);
    const u = t ? { x0: Math.min(u0.x0, t.x0), x1: Math.max(u0.x1, t.x1), y0: u0.y0, y1: u0.y1 } : u0;
    const gap = floorY - 1 - u.y1;
    if (gap <= tol || gap > 0.4 * boxH(u) || boxH(u0) < 1.4 * boxW(u0)) continue;
    const sideDown = (x0, x1, yEnd) => {
      for (let y = u.y1 + 1; y < yEnd; y++) {
        let any = false;
        for (let x = Math.min(x0, x1); x <= Math.max(x0, x1) && !any; x++) any = dk(x, y, frameDark);
        if (!any) return false;
      }
      return true;
    };
    let rail = -1;
    for (let y = Math.min(grey.h - 1, floorY + 2); y >= floorY - 1 - gap * 0.35 && rail < 0; y--) {
      let n = 0;
      for (let x = u.x0; x <= u.x1; x++) n += dk(x, y) ? 1 : 0;
      if (n >= 0.8 * boxW(u)) rail = y;
    }
    if (rail < 0) continue;
    if (!sideDown(u.x0 - 1, u.x0 - reach, rail) || !sideDown(u.x1 + 1, u.x1 + reach, rail)) continue;
    for (const v of t ? [u0, t] : [u0]) {
      v.y1 = floorY - 1;
      v.panel = true;
    }
  }
  // the part of a window seen through a glass railing: plain glass right under it, across its width (its frame is
  // lighter behind the railing glass, so it is not a candidate of its own; the railing posts may cut it in pieces)
  for (const u of units) {
    for (let k = 0; k < 3; k++) {
      const wu = boxW(u);
      // glass in the tone of the window's lowest rows (white wall strips between cladding lines are not)
      let sum = 0;
      let n = 0;
      for (let y = u.y1 - 3; y <= u.y1 - 1; y++) for (let x = u.x0 + 2; x <= u.x1 - 2; x++) {
        sum += grey.data[y * grey.w + x];
        n++;
      }
      const tone = n ? sum / n : u.mean;
      const below = panes.filter((e) => !e.strong && e.y0 > u.y1 && e.y0 - u.y1 - 1 <= 2 * mullion && e.y1 < floorY
        && e.x0 >= u.x0 - 0.05 * wu && e.x1 <= u.x1 + 0.05 * wu && boxH(e) >= 0.05 * H && Math.abs(tone - e.mean) <= 0.04 * range);
      if (!below.length) break;
      const y1 = median(below.map((e) => e.y1));
      const row = below.filter((e) => Math.abs(e.y1 - y1) <= 2);
      const covered = new Set();
      for (const e of row) for (let x = Math.max(u.x0, e.x0); x <= Math.min(u.x1, e.x1); x++) covered.add(x);
      if (covered.size < 0.7 * wu) break;
      u.y1 = Math.max(...row.map((e) => e.y1));
      u.parts.push(...row);
      Object.assign(u, toneOf(u.parts));
    }
  }
  // dark filled leaves standing on the floor; a glass slit in one belongs to it
  const darkT = Math.min(ink + 0.3 * range, c.paper * 0.4);
  const dark = darkDoors(grey, darkT, box, {
    minH: H * 0.18, maxH: H * 0.6, floorY, tol: tol * 2, slit: Math.max(1, Math.round(H * 0.012)), r: Math.max(1, Math.round(H * 0.012)),
  });
  units = units.filter((u) => !dark.some((d) => overlapArea(u, d) >= 0.5 * boxArea(u)));
  units.push(...dark.map((d) => ({ ...d, parts: [d], mean: ink, sd: 0, n: boxArea(d) })));
  units = units.filter((u) => Math.min(boxW(u), boxH(u)) >= minSide);
  const frameT = ink + 0.45 * range;
  return {
    cands,
    // the frame box for the result, the glass box (g) for the gaps between neighbouring units
    units: units.map((u) => ({ ...u, ...(u.dark ? u : growToFrame(grey, u, frameT, reach)), g: { x0: u.x0, y0: u.y0, x1: u.x1, y1: u.y1 } })),
  };
}

/**
 * Joins units stacked with a thin bar between them (≤ gap px between their glass, overlapping ≥ 80 % across): a
 * transom over a door, a fixed pane under a window. A short top part (≤ 35 % of the joined glass height) is a
 * transom; `transom` is then the middle of the bar under it, where the leaf starts. A short bottom part in another
 * tone than the glass above it is a door's lower panel (`panel`).
 */
function joinStacked(units, gap, toneStep) {
  const gw = (u) => u.g.x1 - u.g.x0 + 1;
  const out = units.map((u) => ({ ...u, stack: [u] }));
  for (let changed = true; changed; ) {
    changed = false;
    for (let i = 0; i < out.length && !changed; i++) {
      for (let j = i + 1; j < out.length && !changed; j++) {
        const a = out[i];
        const b = out[j];
        const ov = Math.min(a.g.x1, b.g.x1) - Math.max(a.g.x0, b.g.x0) + 1;
        const d = Math.max(a.g.y0, b.g.y0) - Math.min(a.g.y1, b.g.y1) - 1;
        if (d > gap || d < -2 || ov < 0.8 * Math.max(gw(a), gw(b))) continue;
        out[i] = {
          ...a,
          x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1),
          g: { x0: Math.min(a.g.x0, b.g.x0), y0: Math.min(a.g.y0, b.g.y0), x1: Math.max(a.g.x1, b.g.x1), y1: Math.max(a.g.y1, b.g.y1) },
          ...toneOf([a, b], 'n'),
          parts: [...a.parts, ...b.parts], stack: [...a.stack, ...b.stack],
          dark: a.dark || b.dark, leaf: a.leaf || b.leaf, panel: a.panel || b.panel,
        };
        out.splice(j, 1);
        changed = true;
      }
    }
  }
  for (const u of out) {
    if (u.stack.length < 2) continue;
    const s = [...u.stack].sort((p, q) => p.g.y0 - q.g.y0);
    if (boxH(s[0].g) <= 0.35 * boxH(u.g)) u.transom = Math.round((s[0].g.y1 + s[1].g.y0) / 2);
    if (lowerPanel(u, toneStep)) u.panel = true;
  }
  return out;
}

/**
 * A door's lower panel: the parts in the bottom 30 % of a unit span most of its width and differ in tone from the
 * parts above them (a white or striped panel under glass).
 */
function lowerPanel(u, toneStep) {
  const parts = u.parts ?? [];
  const cut = u.y1 - 0.3 * boxH(u);
  const low = parts.filter((p) => p.y0 >= cut);
  const high = parts.filter((p) => p.y0 < cut);
  if (!low.length || !high.length) return false;
  const span = Math.max(...low.map((p) => p.x1)) - Math.min(...low.map((p) => p.x0)) + 1;
  if (span < 0.8 * boxW(u)) return false;
  return Math.abs(toneOf(low).mean - toneOf(high).mean) >= toneStep;
}

/**
 * The ground line and the house standing on it, with its top outline (chimneys cut down) and its height H in px.
 * → { paper, ink, range, line, ground, house, hOpen, H, note }  (ground / house null and a Norwegian note where a
 * step failed)
 */
function groundAndHouse(grey) {
  const { paper, ink } = facadeLevels(grey);
  const range = paper - ink;
  const line = darkMask(grey, paper - 0.35 * range);
  const out = { paper, ink, range, line, ground: null, house: null, hOpen: null, H: 0, note: null, groundFrom: 'line', tried: [] };
  const faint = darkMask(grey, paper - 0.12 * range);
  out.ground = findGround(line, faint);
  out.house = out.ground && findHouse(line, out.ground.y, out.ground);
  // the house should hold most of the ink above its ground. On an architect's sheet the elevation has terrain,
  // dimension chains, a level ruler, cars and notes around it, its foot covers less of the inked width, and the
  // longest low line is a dimension chain with a number on it. Then every line spanning ≥ 15 % of the width that
  // has more ink above than below is tried: the house must stand on it along half its width or more, and the biggest
  // and tallest such house wins.
  let inkAbove = (y) => {
    let n = 0;
    for (let i = 0; i < y * line.w; i++) n += line.data[i];
    return n;
  };
  const share = (g, hs) => (hs ? hs.mass / Math.max(1, inkAbove(g.y)) : 0);
  if (!out.house || share(out.ground, out.house) < 0.35) {
    const prefix = new Float64Array(line.h + 1);
    for (let y = 0; y < line.h; y++) {
      let n = 0;
      for (let x = 0; x < line.w; x++) n += line.data[y * line.w + x];
      prefix[y + 1] = prefix[y] + n;
    }
    inkAbove = (y) => prefix[y];
    // lines a few rows apart that overlap are one line (a thick plinth band, or a line left a little tilted)
    const alt = [];
    for (const l of groundLines(line, faint, 0.15).filter((q) => q.stands)) {
      const p = alt[alt.length - 1];
      if (p && l.y - p.bottom <= Math.max(3, line.h * 0.01) && l.a <= p.b && l.b >= p.a) {
        Object.assign(p, { bottom: l.bottom, a: Math.min(p.a, l.a), b: Math.max(p.b, l.b) });
      } else alt.push({ ...l });
    }
    alt.sort((p, q) => q.y - p.y).splice(12);
    // the biggest and tallest thing standing on its line (a car on the road beside a garage weighs nearly as much)
    const score = (hs) => hs.mass * hs.height;
    let best = out.house?.footCover >= 0.5 ? { g: out.ground, hs: out.house } : null;
    for (const l of alt) {
      const hs = findHouse(line, l.y, l);
      out.tried.push({ y: l.y, a: l.a, b: l.b, mass: hs?.mass ?? 0, height: hs?.height ?? 0, share: round(share(l, hs), 2), foot: round(hs?.footCover ?? 0, 2) });
      if (hs && hs.footCover >= 0.5 && (!best || score(hs) > score(best.hs) * 1.05)) best = { g: l, hs };
    }
    if (best && best.g !== out.ground) {
      out.ground = best.g;
      out.house = best.hs;
      out.groundFrom = 'house';
    }
    // a «house» holding under a fifth of the ink is a part of the drawing (a roof, a dimension chain with the house
    // hanging on an extension line), not the house: no ground rather than a wrong one
    if (!best || share(best.g, best.hs) < 0.18) {
      return { ...out, ground: null, house: null, note: 'Fant ingen sikker bakkelinje: huset står ikke på noen lang linje (terreng, målekjeder eller tekst rundt det).' };
    }
  }
  out.share = out.house ? round(share(out.ground, out.house), 2) : 0;
  if (!out.ground) return { ...out, note: 'Fant ingen bakkelinje.' };
  if (!out.house) return { ...out, note: 'Fant ikke huset over bakkelinja.' };
  out.hOpen = withoutChimneys(outline(out.house, out.ground.y));
  for (const v of out.hOpen) out.H = Math.max(out.H, v);
  if (out.H < 10) out.note = 'Huset er for lavt i bildet.';
  return out;
}

/**
 * The working copy of a facade image (step 0). It is straightened when it is tilted: a scan or a rectified photo is
 * often 0.5–2° off, and a thin ground line is then no longer one row. It is resampled so the house is about
 * `workTarget` px high when it is much higher or lower: the frame, gap and texture rules are tuned there, and a frame
 * drawn 1 px wide at half the size, or a clad panel drawn 1000 px wide at 2.5 times the size, otherwise reads as
 * something else. A drawing whose house is under `workSmall` px keeps its size (it has rules of its own). The tilt and
 * the house height are measured on a copy of at most 1000 px.
 * → { img, scale (working px per image px), skew (degrees, 0 = straight), houseH (image px, or null) }
 */
export function prepareFacade(img) {
  const D = FACADE_DEFAULTS;
  const pf = Math.min(1, 1000 / Math.max(img.width, img.height));
  const probe = pf < 1 ? resampleImage(img, pf) : img;
  let grey = luma(probe);
  const { paper, ink } = facadeLevels(grey);
  const skew = estimateFacadeSkew(darkMask(grey, paper - 0.35 * (paper - ink)));
  if (skew) grey = luma(rotateNearest(probe, -skew));
  const gh = groundAndHouse(grey);
  const houseH = gh.house && gh.H >= 10 ? gh.H / pf : null;
  let scale = 1;
  if (houseH != null && (houseH > D.workMax || (houseH >= D.workSmall && houseH < D.workMin))) scale = D.workTarget / houseH;
  // (bilinear when enlarging: the nearest pixel was tried and read the half-size drawings worse)
  let work = scale !== 1 ? resampleImage(img, scale) : img;
  if (skew) work = rotateNearest(work, -skew);
  return { img: work, scale, skew, houseH };
}

/**
 * Reads one facade drawing. See the file header for the result. Everything is measured in a working copy
 * (prepareFacade) and given back in the pixels of `img`.
 * @param {{ width: number, height: number, data: Uint8ClampedArray }} img
 * @param {{ ai?: object|null, storeys?: number, floorHeight?: number, pxPerM?: number, debug?: boolean, raw?: boolean }} [options]
 *   raw: read the image as it is (no straightening, no resampling)
 */
export function readFacade(img, options = {}) {
  const prep = options.raw ? { img, scale: 1, skew: 0, houseH: null } : prepareFacade(img);
  const W = prep.img.width;
  const Hh = prep.img.height;
  const sx = W / img.width;
  const sy = Hh / img.height;
  const r = readCore(prep.img, { ...options, pxPerM: options.pxPerM ? options.pxPerM * sy : null, workScale: sy });
  r.skew = prep.skew;
  r.workScale = round(sy, 4);
  if (prep.skew) r.notes.unshift(`Tegningen heller ${String(round(prep.skew, 2)).replace('.', ',')}°; den er rettet opp før lesingen.`);
  if (prep.scale !== 1) {
    r.notes.unshift(`Lest i en kopi i ${Math.round(prep.scale * 100)} % størrelse (huset er ${Math.round(prep.houseH)} px høyt i tegningen).`);
  }
  if (prep.scale !== 1 || prep.skew) {
    // working px (continuous: pixel i covers [i, i + 1]) → image px
    const back = (x, y) => {
      const p = prep.skew ? rotatePoint([x, y], prep.skew, W, Hh) : [x, y];
      return [p[0] / sx, p[1] / sy];
    };
    const cx = r.span ? (r.span[0] + r.span[1] + 1) / 2 : W / 2;
    const row = (y) => (y == null ? y : round(back(cx, y + 0.5)[1] - 0.5, 1));
    const box = (b) => {
      const p = [[b.x0, b.y0], [b.x1 + 1, b.y0], [b.x0, b.y1 + 1], [b.x1 + 1, b.y1 + 1]].map(([x, y]) => back(x, y));
      const xs = p.map((q) => q[0]);
      const ys = p.map((q) => q[1]);
      return { x0: Math.round(Math.min(...xs)), y0: Math.round(Math.min(...ys)), x1: Math.round(Math.max(...xs)) - 1, y1: Math.round(Math.max(...ys)) - 1 };
    };
    const gyW = r.groundY;
    if (r.span) r.span = r.span.map((x) => Math.round(back(x + 0.5, gyW + 0.5)[0] - 0.5));
    r.groundY = row(r.groundY);
    r.eaveY = row(r.eaveY);
    r.ridgeY = row(r.ridgeY);
    r.floorYs = r.floorYs.map(row);
    r.windows = r.windows.map((o) => ({ ...o, ...box(o) }));
    r.skylights = r.skylights.map(box);
    if (r.pxPerM != null) r.pxPerM = round(r.pxPerM / sy, 2);
    if (r.debug) r.debug.work = { scale: prep.scale, skew: prep.skew, width: W, height: Hh, houseH: prep.houseH };
  }
  // the AI's door or window where its box matches ours (its boxes are normalised to the image it saw: this one)
  const aiKinds = applyAiKinds(r.windows, options.ai, img.width, img.height);
  if (aiKinds) r.notes.push(`KI rettet dør/vindu på ${aiKinds} åpning${aiKinds > 1 ? 'er' : ''}.`);
  return r;
}

/** readFacade on the working copy: all positions in its pixels. */
function readCore(img, options) {
  const D = FACADE_DEFAULTS;
  const floorHeight = options.floorHeight ?? D.floorHeight;
  const doorH = D.doorHeight;
  const ai = options.ai ?? null;
  const aiRoof = ROOF_TYPES.includes(ai?.roof) ? ai.roof : null;
  const aiStoreys = Number.isInteger(ai?.storeys) && ai.storeys > 0 ? ai.storeys : null;
  const storeysGiven = Number.isInteger(options.storeys) && options.storeys > 0 ? options.storeys : aiStoreys;
  const notes = [];
  const grey = luma(img);
  const { w, h } = grey;
  const gh = groundAndHouse(grey);
  const { paper, ink, range, line } = gh;

  const result = {
    roof: aiRoof, groundY: null, eaveY: null, ridgeY: null, windows: [], pxPerM: options.pxPerM ?? null,
    method: options.pxPerM ? 'given' : null, confidence: 'low', span: null, skylights: [], roofOptions: [], storeys: storeysGiven,
    floorYs: [], roofFrom: aiRoof ? 'ai' : null, notes,
  };

  // 2. the ground line; 3. the house and its top outline → the ridge
  if (gh.ground) result.groundY = gh.ground.y;
  if (gh.note) {
    notes.push(gh.note);
    return result;
  }
  const gy = gh.ground.y;
  const { house, hOpen, H } = gh;
  const spanW = house.cx1 - house.cx0 + 1;
  // the house height in the drawing as it came: a small drawing stays blurred when the working copy is enlarged
  const srcH = H / (options.workScale ?? 1);
  const ridgeY = gy - H;
  result.ridgeY = ridgeY;
  result.span = [house.x0, house.x1];
  const footY = wallFoot(line, gy, house.x0, house.x1, H);

  // 4. the eave: the roof band of a long side, the roof edge of a flat top, else the tops of the wall corners; the
  // first that lies between the ridge and the wall foot with a wall under it (≥ 10 % of the house)
  const near = Math.max(3, Math.round(spanW * 0.015));
  const reachIn = Math.round((house.x1 - house.x0) * 0.15);
  const minLen = Math.max(4, Math.round(H * 0.2));
  const foot = Math.max(3, Math.round(H * 0.07)) + (gy - footY);
  const left = wallCorner(line, gy, house.x0 - 2, house.x0 + reachIn, minLen, foot, near);
  const right = wallCorner(line, gy, house.x1 + 2, house.x1 - reachIn, minLen, foot, near);
  const roofT = ink + 0.4 * range;
  const ridgeCols = [];
  for (let i = 0; i < hOpen.length; i++) if (hOpen[i] >= H * 0.97) ridgeCols.push(house.cx0 + i);
  const band = roofBand(grey, roofT, ridgeCols, ridgeY, gy);
  const plateau = Array.from(hOpen).filter((v) => v >= H * 0.97).length / hOpen.length;
  const corners = [left, right].filter(Boolean);
  let bandH = band ? band.bottom - ridgeY : 0;
  const eaves = [];
  if (plateau >= 0.5 && bandH >= H * 0.12) eaves.push([band.bottom + 1, 'takflaten']);
  if (plateau >= 0.5) {
    const e = edgeBottom(darkMask(grey, roofT), ridgeY, H, house.cx0, house.cx1);
    const wallTop = corners.length === 2 ? Math.min(left.top, right.top) : null;
    const plain = wallTop != null && e != null && wallTop - e >= H * 0.15 && density(line, house.x0, e + 2, house.x1, wallTop - 2) <= 0.05;
    if (bandH < H * 0.12 && plain) {
      // the walls end far below the roof edge: the roof surface between is drawn plain (no tiles, no tone), a pitched
      // roof seen from the eave side, not the fascia of a flat roof
      eaves.push([wallTop, 'hjørnene under en lys takflate']);
      bandH = wallTop - ridgeY;
    } else if (e != null) eaves.push([e + 1, 'takkanten']);
  }
  // a mono-pitch end has two different wall tops: the eave is the low one
  if (corners.length) eaves.push([Math.max(...corners.map((q) => q.top)), 'hjørnene']);
  eaves.push([ridgeY + H * 0.4, 'anslått']);
  const [eaveY, eaveFrom] = eaves.find(([y]) => y > ridgeY && y < footY - H * 0.1);
  result.eaveY = eaveY;

  // 5. openings (px)
  const box = [Math.max(0, house.cx0 - 2), Math.max(0, Math.round(ridgeY) - 2), Math.min(w - 1, house.cx1 + 2), Math.min(h - 1, gy + 1)];
  const minSide = Math.max(4, Math.round(H * 0.03));
  const mullion = Math.max(2, Math.round(H * 0.015));
  const found = findOpenings(grey, {
    ink, paper, range, H, box, minSide, paneSide: Math.max(3, Math.round(H * 0.012)), mullion, floorY: footY, blurred: srcH < D.smallFrames,
  });
  // stacked units with a thin bar between them are one (a transom over a door, a fixed pane under a window); a region
  // reaching the outer wall corners is a part of the wall (a clad corner panel, a post), not an opening
  const atCorner = (u) => u.x0 <= house.x0 + 3 || u.x1 >= house.x1 - 3;
  const stacked = joinStacked(found.units.filter((u) => !atCorner(u)), Math.max(3, Math.round(H * 0.05)), 0.06 * range);
  // roof windows: framed glass above the eave with the roof surface all around
  const roofDark = (u) => {
    const m = Math.max(3, Math.round(H * 0.02));
    let n = 0;
    let dark = 0;
    const at = (x, y) => {
      if (x < 0 || y < 0 || x >= w || y >= h) return;
      n++;
      if (grey.data[y * w + x] < roofT) dark++;
    };
    for (let x = u.x0 - m; x <= u.x1 + m; x++) {
      at(x, u.y0 - m);
      at(x, u.y1 + m);
    }
    for (let y = u.y0 - m; y <= u.y1 + m; y++) {
      at(u.x0 - m, y);
      at(u.x1 + m, y);
    }
    return n ? dark / n : 0;
  };
  const skylights = [];
  const openings = [];
  for (const u of stacked) {
    if (u.y1 < eaveY && roofDark(u) >= 0.6) skylights.push(u);
    else openings.push(u);
  }

  // floors: the wall foot, and upper floor lines where two or more openings end at the same height, one of them tall;
  // an opening «on» a floor ends within 3.5 % of the house height above it (a threshold step)
  const tol = Math.max(3, H * 0.035);
  const floorLines = [];
  for (const u of [...openings].sort((p, q) => q.y1 - p.y1)) {
    if (footY - 1 - u.y1 < H * 0.25) continue;
    const l = floorLines.find((q) => Math.abs(q.y - (u.y1 + 1)) <= tol);
    if (l) l.items.push(u);
    else floorLines.push({ y: u.y1 + 1, items: [u] });
  }
  for (const l of floorLines) l.y = median(l.items.map((u) => u.y1 + 1));
  const upperFloors = floorLines.filter((l) => l.items.length >= 2 && l.items.some((u) => boxH(u) >= 1.4 * boxW(u) && boxH(u) >= 0.25 * H));
  const onLine = (u, y) => Math.abs(y - 1 - u.y1) <= tol;
  const leafTop = (u) => u.transom ?? u.y0;
  // a door with a lower panel ends on the floor, wherever its panel's lower edge was drawn
  const leafH = (u) => (u.panel && onLine(u, footY) ? footY : u.y1 + 1) - leafTop(u);
  // the glass tone: the openings that do not reach a floor
  const reachesFloor = (u) => onLine(u, footY) || upperFloors.some((l) => onLine(u, l.y));
  const glassTone = median(openings.filter((u) => !u.dark && !reachesFloor(u)).map((u) => u.mean))
    ?? median(openings.filter((u) => !u.dark).map((u) => u.mean)) ?? paper;
  // a line drawing: glass and leaves are both (nearly) paper; a small drawing greys its white glass a little
  const plainGlass = glassTone >= paper - (srcH < D.smallGlass ? 0.15 : 0.05) * range;
  // a leaf that is clearly not glass: dark, with panels, plain in another tone than the glass
  const solid = (u) => u.dark || u.leaf || u.panel || (u.sd <= 0.04 * range && Math.abs(u.mean - glassTone) >= 0.08 * range);
  const doorShaped = (u) => leafH(u) >= 1.4 * boxW(u) * (u.parts.length > 1 && !u.panel ? 0.5 : 1) && leafH(u) >= H * 0.18 && leafH(u) <= H * 0.6;

  // 6. the scale; each way must give a house of a plausible height (houseMin–houseMax), else the next one is tried
  let pxPerM = options.pxPerM ?? null;
  let method = options.pxPerM ? 'given' : null;
  let confidence = options.pxPerM ? 'high' : 'low';
  let scaleDoors = [];
  const rejected = [];
  const plausible = (ppm, how) => {
    const ok = Number.isFinite(ppm) && ppm > 0 && H / ppm >= D.houseMin && H / ppm <= D.houseMax;
    if (!ok) rejected.push(`${how} (${Number.isFinite(ppm) ? round(ppm, 1) : '–'} px/m)`);
    return ok;
  };
  if (!pxPerM) {
    // doors that are surely doors (not glass to the floor): on the ground, else on an upper floor
    const sure = openings.filter((u) => onLine(u, footY) && doorShaped(u) && (solid(u) || u.transom != null || plainGlass));
    const upper = upperFloors.flatMap((l) => l.items.filter((u) => onLine(u, l.y) && doorShaped(u) && (solid(u) || u.transom != null)));
    // else glass reaching the ground floor in a door's shape (a glass door or a floor-length window: heads are usually
    // at door height), else doors on an upper floor (often lower than 2.1 m)
    const glass = openings.filter((u) => onLine(u, footY) && doorShaped(u));
    const doors = sure.length ? sure : glass.length ? glass : upper;
    if (doors.length) {
      const hs = doors.map(leafH);
      const ppm = median(hs) / doorH;
      if (plausible(ppm, 'døra')) {
        scaleDoors = doors;
        pxPerM = ppm;
        method = 'door';
        const spread = (Math.max(...hs) - Math.min(...hs)) / median(hs);
        confidence = doors === sure && doors.length >= 2 && spread <= 0.06 ? 'high' : doors === sure ? 'medium' : 'low';
        const where = doors === upper ? 'på et øvre gulv' : doors === glass ? 'på bakken (glass til gulvet)' : 'på bakken';
        notes.push(`Skala fra ${doors.length} dør${doors.length > 1 ? 'er' : ''} ${where} (${doorH} m).`);
      }
    }
  }
  if (!pxPerM) {
    // the highest head of the openings in the ground storey (their bottoms in the lower 30 % of the house) is at door
    // height: Norwegian windows are usually set with their heads in line with the doors
    // (a transom over a door does not count: the leaf below it does)
    const low = openings.filter((u) => footY - u.y1 <= H * 0.3);
    if (low.length) {
      const ppm = (footY - Math.min(...low.map(leafTop))) / doorH;
      if (plausible(ppm, 'vindusoverkanten')) {
        pxPerM = ppm;
        method = 'window-head';
        notes.push(`Skala fra den høyeste vindusoverkanten i nederste etasje (${doorH} m over gulvet).`);
      }
    }
  }
  if (!pxPerM && upperFloors.length) {
    // an upper floor line is a storey above the wall foot
    const ppm = (footY - Math.max(...upperFloors.map((l) => l.y))) / floorHeight;
    if (plausible(ppm, 'etasjehøyden')) {
      pxPerM = ppm;
      method = 'storeys';
      notes.push(`Skala fra høyden til gulvet i etasjen over (${floorHeight} m etasjehøyde).`);
    }
  }
  if (!pxPerM) {
    // the wall is storeys · floorHeight high; without a given count, two storeys when openings stand both in the lower
    // and in the upper half of the wall, else one
    const wallMid = (footY + eaveY) / 2;
    const below = openings.filter((u) => u.y1 >= wallMid && u.y1 < footY);
    const above = openings.filter((u) => u.y1 < wallMid && u.y1 > eaveY);
    const n = storeysGiven ?? (below.length && above.length ? 2 : 1);
    const ppm = (footY - eaveY) / (n * floorHeight);
    if (plausible(ppm, 'vegghøyden')) {
      pxPerM = ppm;
      method = 'eave';
      notes.push(`Skala anslått fra vegghøyden (${n} etasje${n > 1 ? 'r' : ''} à ${floorHeight} m).`);
    }
  }
  if (rejected.length) notes.push(`Forkastet skala som ga et hus under ${D.houseMin} eller over ${D.houseMax} m: ${rejected.join(', ')}.`);
  // the roof type from the outline (a dormer: an opening above the eave on a long side)
  const roofOf = (ops) => {
    const dormer = plateau >= 0.5 && ops.some((q) => q.y1 < eaveY - H * 0.02);
    const fromOutline = roofFromOutline(hOpen, { bandH, H, eaveH: gy - eaveY, dormer });
    if (!aiRoof) {
      result.roof = fromOutline.roof;
      result.roofFrom = fromOutline.roof ? 'outline' : null;
    }
    result.roofOptions = fromOutline.options;
    notes.push(`Takfot fra ${eaveFrom}; takform fra omrisset: ${fromOutline.roof ?? 'ukjent'} (${fromOutline.why}).`);
  };
  if (!pxPerM) {
    notes.push('Fant ingen troverdig skala: vinduene er ikke målt.');
    roofOf(openings);
    return result;
  }

  // 7. storeys, sills, heights, door or window. The ground floor is where the doors stand (a threshold step above the
  // wall foot is inside), a door with a lower panel stands on the wall foot
  const floor0 = scaleDoors.length && scaleDoors.every((u) => onLine(u, footY))
    ? median(scaleDoors.map((u) => (u.panel ? footY : u.y1 + 1))) : footY;
  const storeyPx = floorHeight * pxPerM;
  // the floor of storey k: a measured floor line near the estimate wins
  const floorOf = (k) => {
    if (k === 0) return floor0;
    const est = floor0 - k * storeyPx;
    const l = upperFloors.find((q) => Math.abs(q.y - est) <= 0.6 * pxPerM);
    return l ? l.y : est;
  };
  const storeyOf = (u) => {
    let k = Math.max(0, Math.floor((floor0 - 1 - u.y1) / storeyPx + 0.15));
    if (k > 0 && floorOf(k) - 1 - u.y1 < -0.15 * pxPerM) k--;
    return k;
  };
  // in a line drawing (glass as white as a leaf): where any leaf has a handle drawn, the doors of this drawing have
  // handles, and white glass to the floor without one is a window
  const handles = new Set(plainGlass ? openings.filter((u) => !u.dark && hasHandle(grey, u, floorOf(storeyOf(u)), pxPerM, (u.mean + ink) / 2)) : []);
  // a garage door: wide, on the floor, with four or more lines all across it (the sections of a sectional or an
  // up-and-over door) and no upright bar (a glass wall has its posts)
  const lineT = paper - 0.25 * range;
  const lines = (u, along) => {
    const { x0, y0, x1, y1 } = u.g;
    const [a0, a1, b0, b1] = along === 'h' ? [y0 + 2, y1 - 2, x0 + 2, x1 - 2] : [x0 + 2, x1 - 2, y0 + 2, y1 - 2];
    let runs = 0;
    let prev = false;
    for (let a = a0; a <= a1; a++) {
      let n = 0;
      for (let b = b0; b <= b1; b++) n += grey.data[along === 'h' ? a * w + b : b * w + a] < lineT ? 1 : 0;
      const full = n >= 0.7 * (b1 - b0 + 1);
      if (full && !prev) runs++;
      prev = full;
    }
    return runs;
  };
  const garage = (u, atFloor, height, glassW) => atFloor && height >= 1.8 && height <= 3 && glassW >= 2 && lines(u, 'h') >= 4 && lines(u, 'v') === 0;
  let ops = openings.map((u) => {
    const storey = storeyOf(u);
    const sill = (floorOf(storey) - 1 - u.y1) / pxPerM;
    const height = boxH(u) / pxPerM;
    const atFloor = sill <= 0.25;
    const glassW = (u.g.x1 - u.g.x0 + 1) / pxPerM;
    // a leaf is at least 55 cm wide: a narrower glass beside a door is a sidelight, a window
    const gate = garage(u, atFloor, height, glassW);
    const door = gate || u.dark || u.leaf || u.panel || (atFloor && height >= 1.75 && height <= 3 && glassW >= 0.55
      && (u.transom != null || solid(u) || handles.has(u) || (plainGlass && !handles.size && glassW <= 1.1)));
    // a door with a lower panel reaches its floor
    const y1 = door && u.panel && storey === 0 && onLine(u, footY) ? Math.max(u.y1, floor0 - 1) : u.y1;
    return { ...u, y1, kind: door ? 'door' : 'window', storey, sill, height, gate };
  });
  // where the glass is tinted, a plain paper-white «window» is a board or a post (a white corner board, a carport post)
  if (!plainGlass) ops = ops.filter((u) => u.kind === 'door' || u.mean < paper - 0.06 * range);
  // a glass railing panel: «standing on a floor» but under 1.3 m high – no window is like that
  const railing = ops.filter((u) => u.kind === 'window' && u.sill <= 0.15 && u.height <= 1.3);
  ops = ops.filter((u) => !railing.includes(u));
  // leaves closer than 30 cm (a double door), windows closer than 20 cm (a coupled window, panels of a glass wall)
  // are one opening; the gap is measured between the glass, not the frames
  const joinable = (a, b) => {
    // garage doors side by side are two doors
    if (a.storey !== b.storey || a.kind !== b.kind || a.gate || b.gate) return false;
    const gap = Math.max(a.g.x0, b.g.x0) - Math.min(a.g.x1, b.g.x1) - 1;
    const ov = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0) + 1;
    if (ov < 0.7 * Math.max(boxH(a), boxH(b))) return false;
    if (a.kind === 'door') return gap <= D.doorGap * pxPerM && Math.abs(a.y1 - b.y1) <= tol;
    return gap <= D.windowGap * pxPerM + 2; // + 2 px: in a small drawing the frames are blurred wider
  };
  let joined = ops.map((u) => ({ ...u }));
  for (let again = true; again; ) {
    again = false;
    for (let i = 0; i < joined.length && !again; i++) {
      for (let j = i + 1; j < joined.length && !again; j++) {
        if (!joinable(joined[i], joined[j])) continue;
        const a = joined[i];
        const b = joined[j];
        const box2 = (p, q) => ({ x0: Math.min(p.x0, q.x0), y0: Math.min(p.y0, q.y0), x1: Math.max(p.x1, q.x1), y1: Math.max(p.y1, q.y1) });
        joined[i] = { ...a, ...box2(a, b), g: box2(a.g, b.g) };
        joined.splice(j, 1);
        again = true;
      }
    }
  }
  joined = joined.map((u) => ({
    x0: u.x0, y0: u.y0, x1: u.x1, y1: u.y1, kind: u.kind, storey: u.storey,
    sill: round(Math.max(0, (floorOf(u.storey) - 1 - u.y1) / pxPerM), 2), height: round(boxH(u) / pxPerM, 2),
  }));
  joined.sort((a, b) => a.storey - b.storey || a.x0 - b.x0);
  // the storeys: a given count (the plans, the AI) wins, but never fewer than the openings stand in, so every
  // window's storey has its floor in floorYs
  const winStorey = joined.reduce((m, q) => Math.max(m, q.storey), 0);
  const maxStorey = Math.max(winStorey, skylights.length ? 1 : 0);
  const wallStoreys = Math.max(1, Math.round((floor0 - eaveY) / storeyPx));
  let storeys = storeysGiven ?? Math.max(maxStorey + 1, wallStoreys);
  if (storeys < winStorey + 1) {
    notes.push(`Oppgitt ${storeys} etasje${storeys > 1 ? 'r' : ''}, men vinduene står i ${winStorey + 1}: bruker ${winStorey + 1}.`);
    storeys = winStorey + 1;
  }
  result.windows = joined;
  result.skylights = skylights.map(({ x0, y0, x1, y1 }) => ({ x0, y0, x1, y1 }));
  result.pxPerM = round(pxPerM, 2);
  result.method = method;
  result.storeys = storeys;
  result.floorYs = Array.from({ length: storeys }, (_, k) => round(floorOf(k), 1));
  roofOf(joined);
  // the order of the lines is checked here once more: a broken order is a bad read, whatever the method says
  const ordered = ridgeY < eaveY && eaveY < floor0 && footY <= gy && result.floorYs.every((y, k) => k === 0 || y < result.floorYs[k - 1]);
  if (!ordered) notes.push('Linjene i fasaden ligger i feil rekkefølge (møne, takfot, gulv, bakke): lav sikkerhet.');
  result.confidence = ordered ? confidence : 'low';
  if (options.debug) {
    result.debug = {
      paper, ink, ground: gh.ground, groundFrom: gh.groundFrom, share: gh.share, tried: gh.tried, footY, house: { x0: house.x0, x1: house.x1, cx0: house.cx0, cx1: house.cx1 }, hOpen, left, right,
      band, plateau, eaves, cands: found.cands, units: stacked, scaleDoors, glassTone, plainGlass, upperFloors: upperFloors.map((l) => l.y), railing,
      ops: ops.map((u) => ({ box: [u.x0, u.y0, u.x1, u.y1], g: u.g, kind: u.kind, storey: u.storey, sill: round(u.sill, 2), height: round(u.height, 2), mean: round(u.mean, 0), sd: round(u.sd, 1), transom: u.transom, dark: u.dark, leaf: u.leaf, panel: u.panel })),
    };
  }
  return result;
}
