/**
 * Planbygger: automatic detection of walls, doors and windows in a floor-plan image – classical image processing and
 * fixed rules only (thresholds, morphology, run lengths, connected components, profile integration, arc sampling).
 * No learning, no OCR, no network.
 *
 *   detectPlan(img, { pxPerM, ...options }) → {
 *     walls:     [{ a: [x, y], b: [x, y], t, axis: 'h'|'v', exterior }]                 pixels, a → b along +x / +y
 *     openings:  [{ wall, from, to, type: 'door'|'window'|'opening', hinge: 'start'|'end'|null, side: 1|-1|0,
 *                   variant?: 'single'|'double'|'sliding', leaf?, leaf2?, score, symbol }]  from/to: pixels along
 *                   the wall; variant on doors: double = two leaves from the two jambs (hinge 'start' = the first,
 *                   leaf / leaf2 their radii), sliding = no arc, leaf lines from one jamb (hinge = that jamb, side 0)
 *     skylights: [{ x0, y0, x1, y1, sides, score }]                                    dashed rectangles inside
 *     stairs:    [{ bbox: [x0, y0, x1, y1], axis: 'x'|'y', treads, kind: 'straight'|'quarter-turn'|'half-turn'|
 *                   'unknown', flights, winders, lines, pivot? }]                     axis = the run of the main flight
 *     separators: [{ a: [x, y], b: [x, y] }]       the dash-dot lines between open zones (a hall and a TV room): they
 *                   split rooms (regions.js findRooms(walls, { separators })) and are never walls
 *     stats:     { darkThreshold, paper, ink, coreRadius, minRun, timings, cleaned?, clean?, autoWallTone?, upsampled?,
 *                  rotated? },
 *     debug:     { dark, core, pieces, outside, separatorLines, thin, stairInk }       rasters, raw pieces, the dashed
 *                                                                                    lines the separator search judged
 *   }
 *   The result is plain data (the worker posts it): walls, openings, skylights, stairs and separators all go through
 *   postMessage.
 *
 * Scope (v1): plans with thick dark walls drawn axis-parallel (the style of Floorplanner / Planner 5D / magicplan
 * exports and most estate-agent plans), doors as quarter arcs, windows as thin lines inside the wall. Text,
 * dimension lines, hatching and grey furniture are removed because they are thin, light or isolated.
 *
 * The pipeline (see notes/planbygger.md for the reasoning and the measured results):
 *   1. grey → dark mask (threshold in the valley after the black peak of the histogram, or options.darkThreshold; or a
 *      band around a sampled wall tone, options.wallTone = [lo, hi], for plans with grey walls and black text)
 *   2. opening with a small square: strokes thinner than the thinnest wall vanish (text, dimension lines, arcs)
 *   3. long horizontal / vertical runs (longer than the thickest wall) → wall pieces per axis; the rest (short stubs
 *      between windows) is kept when it lies in the band of a wall line
 *   4. each piece → a rectangle (columns / rows with the same extent), refined to sub-pixel centre and thickness by
 *      integrating the darkness across the wall
 *   5. collinear fragments merged, ends snapped into the perpendicular walls (L, T and X joints)
 *   6. gaps between collinear pieces and from a free end to the next wall are examined: a quarter arc of dark dots or
 *      a line → door (hinge and swing side from the best arc), lines inside the band → window (exterior wall) or
 *      opening (interior wall), an empty short gap → opening – only for a piece that hangs on the house's wall network
 *      at its other end; a long gap drawn with dashes only stays open (a separator candidate)
 *   7. pieces not connected to the main wall network are dropped (furniture, labels), exterior walls marked by a flood
 *      fill from the image border (grey walls: when the dark pass finds almost nothing, the whole detection is run once
 *      more on the grey band with the most long wall runs, before anything else is spent)
 *   8. symbols in the thin ink (the dark pixels that are not wall), only in the box of the rooms the walls enclose:
 *      skylights = dashed rectangles, stairs = ladders of evenly spaced parallel treads (followed on in dashed treads)
 *      and fans of winders radiating from a point, and stairs winding round a narrow newel (every tread a winder); a
 *      door kept on a weak arc over a drawn window becomes that window when the arc lies on a stair; separators =
 *      dash-dot lines from a wall end to a wall end between open zones
 * Before 1: options.rotate straightens a skewed plan, options.clean runs the walls' cleaner (clean.js), and a plan
 * under minPxPerM is detected on an upsampled copy; the result comes back in the straightened, original-size frame.
 * Not walls: dashed lines (a roof edge, «plan himling», a beam) and hatching (deck boards, wood floors, tile grids)
 * never count as the lines of a window – a gap drawn with them stays a gap –, and thin strokes never become walls.
 */
import { luma, histogram, threshold, open, dilate, longRuns, subtract, components, raster, minNear, sample, rotateImage } from './image.js';
import { cleanForWalls } from './clean.js';

export const DETECT_DEFAULTS = Object.freeze({
  /** null = automatic (valley after the black peak) */
  darkThreshold: null,
  /** [lo, hi]: walls are this grey band (sampled by a click on a wall) instead of «darker than darkThreshold» */
  wallTone: null,
  /** thinnest / thickest wall drawn, metres */
  minWall: 0.06,
  maxWall: 0.5,
  /** gaps that can be openings, metres */
  minOpening: 0.25,
  maxOpening: 3.6,
  /** an empty gap (no symbol) up to this is an opening (a passage); longer empty gaps stay gaps */
  maxPlainOpening: 1.3,
  /** a gap whose band is drawn with lines (a glass wall, a row of windows) may be this long */
  maxSymbolOpening: 14,
  /** a free end this close to a wall is joined to it without an opening */
  joinGap: 0.2,
  /** door leaves we look for, metres */
  doorMin: 0.55,
  doorMax: 1.05,
  /** arc score (share of the arc that is drawn) for a door */
  arcScore: 0.6,
  /** a part of a gap next to a door shorter than this is the door's frame, not a sidelight */
  minSidelight: 0.3,
  /** lines across a gap in an interior wall narrower than this are a fixture drawn on the wall, not a passage */
  minPassage: 0.6,
  /** wall networks shorter than this share of the largest one are dropped (furniture, labels) */
  minNetworkShare: 0.12,
  /** below this resolution the plan is detected on an upsampled copy (px per metre) */
  minPxPerM: 50,
  /** degrees the plan is skewed by (estimateSkew): it is rotated back first, the result is in the straightened frame */
  rotate: 0,
  /** the walls' cleaner on the image first (clean.js cleanForWalls: coloured ink and fills, and on light grey walls dark
   *  furniture and hatching, become paper): true / false, or a function (img, { pxPerM }) → img. Off by default for
   *  now: it costs about 1 s per megapixel, and the cleaner's own test measures detectPlan(img) as the uncleaned
   *  baseline (notes/planbygger.md) */
  clean: false,
});

const H = 'h';
const V = 'v';

/** Point at along-coordinate s on a piece / wall line. */
const pt = (seg, s, off = 0) => (seg.axis === H ? [s, seg.c + off] : [seg.c + off, s]);

/**
 * The threshold between the walls' ink and everything lighter: the FIRST valley of the smoothed histogram after the
 * black peak – the search stops where the histogram climbs into the next mode (dark grey furniture, a blurred scan's
 * grey edges), so a near-black table is not taken for a wall. At most 100.
 * firstValley = false: the deepest valley up to 100 instead – for an image we upsampled ourselves, where a thin wall
 * has few pure-ink pixels and the blended edges form a mode of their own that belongs to the wall.
 */
export function autoDarkThreshold(hist, { firstValley = true } = {}) {
  let peak = 0;
  for (let i = 0; i < 60; i++) if (hist[i] > hist[peak]) peak = i;
  const sm = (i) => {
    let s = 0;
    for (let k = -4; k <= 4; k++) s += hist[Math.max(0, Math.min(255, i + k))];
    return s;
  };
  let total = 0;
  for (let i = 0; i < 256; i++) total += hist[i];
  const start = Math.max(peak + 8, firstValley ? 12 : 15);
  let best = start;
  let bestV = Infinity;
  for (let t = start; t <= 100; t++) {
    const v = sm(t);
    if (v < bestV - 1e-9) {
      bestV = v;
      best = t;
    } else if (firstValley && t > best + 6 && v > bestV * 1.6 + total * 0.0002) break; // the next mode begins
  }
  // the valley is a range: take its middle (antialiased wall edges are split near half coverage)
  let lo = best;
  let hi = best;
  while (lo > peak + 8 && sm(lo - 1) <= bestV * 1.15 + 2) lo--;
  while (hi < 100 && sm(hi + 1) <= bestV * 1.15 + 2) hi++;
  return Math.round((lo + hi) / 2);
}

/** Paper colour: the most common value above 150. */
function paperGrey(hist) {
  let best = 255;
  for (let i = 150; i < 256; i++) if (hist[i] > hist[best]) best = i;
  return best;
}

/**
 * Rectangles of one axis' mask: per component, the columns (h) / rows (v) split where the extent across changes.
 * @returns {{ axis, s0, s1, a0, a1 }[]}  inclusive pixel indices, s along, a across
 */
function rectanglesOf(mask, axis, minLen) {
  const { w } = mask;
  const { labels, comps } = components(mask, 4);
  const out = [];
  for (const c of comps) {
    const [s0, s1] = axis === H ? [c.minX, c.maxX] : [c.minY, c.maxY];
    const [b0, b1] = axis === H ? [c.minY, c.maxY] : [c.minX, c.maxX];
    const prof = [];
    for (let s = s0; s <= s1; s++) {
      let lo = Infinity;
      let hi = -Infinity;
      for (let a = b0; a <= b1; a++) {
        const idx = axis === H ? a * w + s : s * w + a;
        if (labels[idx] === c.id) {
          if (a < lo) lo = a;
          if (a > hi) hi = a;
        }
      }
      prof.push([lo, hi]);
    }
    let start = 0;
    let ref = prof[0];
    const flush = (end) => {
      if (end - start + 1 < 2) return;
      // the run's extent: the most common lo / hi (robust against a corner pixel)
      const mode = (k) => {
        const m = new Map();
        for (let i = start; i <= end; i++) m.set(prof[i][k], (m.get(prof[i][k]) || 0) + 1);
        return [...m].sort((x, y) => y[1] - x[1])[0][0];
      };
      out.push({ axis, s0: s0 + start, s1: s0 + end, a0: mode(0), a1: mode(1) });
    };
    for (let i = 1; i < prof.length; i++) {
      const p = prof[i];
      if (Math.abs(p[0] - ref[0]) > 1 || Math.abs(p[1] - ref[1]) > 1) {
        flush(i - 1);
        start = i;
        ref = p;
      }
    }
    flush(prof.length - 1);
  }
  return out.filter((r) => r.s1 - r.s0 + 1 >= minLen);
}

/**
 * Sub-pixel centre and thickness of a wall piece: the darkness (paper → ink) integrated across the wall at sample
 * positions along it, where the profile is clean (paper on both sides – not at a joint, not under a label).
 */
function refine(grey, seg, ink, paper, opts) {
  const { margin = 3, darkT = 60, isWall = (v) => v < darkT } = opts;
  if (paper - ink < 40) return;
  const half = seg.t / 2;
  const lo = Math.floor(seg.c - half - margin);
  const hi = Math.ceil(seg.c + half + margin);
  const L = seg.s1 - seg.s0;
  const skip = Math.max(2, Math.min(L * 0.25, seg.t * 0.8));
  const cs = [];
  const ts = [];
  const prof = new Float32Array(hi - lo + 1);
  for (let s = seg.s0 + skip; s <= seg.s1 - skip; s += 1) {
    for (let a = lo; a <= hi; a++) {
      const [x, y] = seg.axis === H ? [s, a] : [a, s];
      prof[a - lo] = sample(grey, x, y);
    }
    // the background on each side (paper, or a grey worktop / filled room next to the wall): the darkness is measured
    // against the darker of the two, so a grey neighbour does not widen the wall
    const left = Math.max(prof[0], prof[1]);
    const right = Math.max(prof[prof.length - 1], prof[prof.length - 2]);
    if (isWall(left) || isWall(right) || left < darkT + 40 || right < darkT + 40) continue; // a joint, a label or another wall: not clean
    const ref = Math.min(left, right);
    const span = ref - ink;
    if (span < 40) continue;
    let sum = 0;
    let mom = 0;
    for (let a = lo; a <= hi; a++) {
      const d = Math.max(0, Math.min(1, (ref - prof[a - lo]) / span));
      sum += d;
      mom += d * (a + 0.5);
    }
    if (sum < 1) continue;
    cs.push(mom / sum);
    ts.push(sum);
  }
  if (cs.length < 3) return;
  const med = (arr) => {
    const s = [...arr].sort((x, y) => x - y);
    return s[s.length >> 1];
  };
  const c = med(cs);
  const t = med(ts);
  if (Math.abs(c - seg.c) <= half + 1 && t > 0.5 * seg.t && t < 1.6 * seg.t + 1) {
    seg.c = c;
    seg.t = t;
    seg.refined = true;
  }
}

/**
 * The grey band of the walls when they are not the darkest ink: the peaks of the histogram between 20 and the paper
 * are tried as bands out to the valleys on both sides (at most ±30), and the one whose mask (after the opening) has the
 * most pixels in long runs wins.
 * @returns {[number, number] | null}
 */
export function autoWallTone(grey, hist, paper, { r = 1, minRun = 25 } = {}) {
  const total = grey.data.length;
  const sm = (i) => {
    let s = 0;
    for (let k = -3; k <= 3; k++) s += hist[Math.max(0, Math.min(255, i + k))];
    return s;
  };
  const peaks = [];
  for (let i = 20; i <= paper - 45; i++) {
    const v = sm(i);
    if (v > total * 0.003 && v >= sm(i - 1) && v > sm(i + 1)) peaks.push(i);
  }
  let best = null;
  for (const p of peaks.slice(0, 8)) {
    // the band: out from the peak to where the histogram falls under 15 % of it (the valleys), at most ±30
    const top = sm(p);
    let lo = p;
    let hi = p;
    while (lo > Math.max(0, p - 30) && sm(lo - 1) > top * 0.15) lo--;
    while (hi < Math.min(paper - 20, p + 30) && sm(hi + 1) > top * 0.15) hi++;
    const band = [Math.max(0, lo - 4), Math.min(paper - 20, hi + 4)];
    const m = raster(grey.w, grey.h);
    for (let i = 0; i < total; i++) m.data[i] = grey.data[i] >= band[0] && grey.data[i] <= band[1] ? 1 : 0;
    const c = open(m, r);
    const H = longRuns(c, 'h', minRun);
    const V = longRuns(c, 'v', minRun);
    let n = 0;
    for (let i = 0; i < total; i++) n += H.data[i] | V.data[i];
    if (!best || n > best.n) best = { n, band };
  }
  return best && best.n > total * 0.002 ? best.band : null;
}

/**
 * How many degrees the walls of a plan are turned from the image axes (a skewed scan): the dark pixels (subsampled)
 * are turned back by each candidate angle and binned by row and by column; aligned walls give the sharpest profile
 * (the largest sum of squared bin counts). Coarse steps of 0.5° within ±maxDeg, then 0.05° around the best.
 * rotateImage(img, −result) straightens the plan. Classical projection-profile deskew, no learning.
 */
export function estimateSkew(img, { maxDeg = 10 } = {}) {
  const grey = luma(img);
  const t = autoDarkThreshold(histogram(grey));
  const { w, h } = grey;
  let count = 0;
  for (let i = 0; i < grey.data.length; i++) if (grey.data[i] < t) count++;
  if (count < 50) return 0;
  const stride = Math.max(1, Math.floor(Math.sqrt(count / 120000)));
  const xs = [];
  const ys = [];
  for (let y = 0; y < h; y += stride) {
    for (let x = 0; x < w; x += stride) {
      if (grey.data[y * w + x] < t) {
        xs.push(x - w / 2);
        ys.push(y - h / 2);
      }
    }
  }
  const n = xs.length;
  const R = Math.ceil(Math.hypot(w, h) / 2) + 2;
  const binsX = new Float64Array(2 * R + 1);
  const binsY = new Float64Array(2 * R + 1);
  const score = (deg) => {
    const a = (-deg * Math.PI) / 180;
    const c = Math.cos(a);
    const sn = Math.sin(a);
    binsX.fill(0);
    binsY.fill(0);
    for (let i = 0; i < n; i++) {
      binsX[Math.round(c * xs[i] - sn * ys[i]) + R]++;
      binsY[Math.round(sn * xs[i] + c * ys[i]) + R]++;
    }
    let s2 = 0;
    for (let i = 0; i < binsX.length; i++) s2 += binsX[i] * binsX[i] + binsY[i] * binsY[i];
    return s2;
  };
  let best = 0;
  let bestS = score(0);
  for (let d = -maxDeg; d <= maxDeg + 1e-9; d += 0.5) {
    const v = score(d);
    if (v > bestS) {
      bestS = v;
      best = d;
    }
  }
  const coarse = best;
  for (let d = coarse - 0.5; d <= coarse + 0.5 + 1e-9; d += 0.05) {
    const v = score(d);
    if (v > bestS) {
      bestS = v;
      best = d;
    }
  }
  return Math.round(best * 100) / 100 || 0; // never -0
}

/** Bilinear upsampling of an RGBA image by an integer factor. */
export function upsample(img, f) {
  const { width: w, height: h, data: d } = img;
  const W = w * f;
  const H = h * f;
  const out = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    const sy = Math.max(0, Math.min(h - 1, (y + 0.5) / f - 0.5));
    const y0 = Math.floor(sy);
    const y1 = Math.min(h - 1, y0 + 1);
    const fy = sy - y0;
    for (let x = 0; x < W; x++) {
      const sx = Math.max(0, Math.min(w - 1, (x + 0.5) / f - 0.5));
      const x0 = Math.floor(sx);
      const x1 = Math.min(w - 1, x0 + 1);
      const fx = sx - x0;
      const o = (y * W + x) * 4;
      for (let c = 0; c < 4; c++) {
        const a = d[(y0 * w + x0) * 4 + c] * (1 - fx) + d[(y0 * w + x1) * 4 + c] * fx;
        const b = d[(y1 * w + x0) * 4 + c] * (1 - fx) + d[(y1 * w + x1) * 4 + c] * fx;
        out[o + c] = a * (1 - fy) + b * fy;
      }
    }
  }
  return { width: W, height: H, data: out };
}

/** Union–find. */
function dsu(n) {
  const p = Array.from({ length: n }, (_, i) => i);
  const find = (i) => (p[i] === i ? i : (p[i] = find(p[i])));
  return { find, union: (a, b) => (p[find(a)] = find(b)) };
}

/**
 * Detects the wall graph, doors and windows (see the top of the file).
 * @param {{ width: number, height: number, data: Uint8ClampedArray }} img  RGBA
 * @param {object} options  pxPerM (required) + DETECT_DEFAULTS
 */
export function detectPlan(img, options = {}) {
  const o = { ...DETECT_DEFAULTS, ...options };
  const ppm = o.pxPerM;
  if (!(ppm > 0)) throw new Error('detectPlan: pxPerM (skalaen) mangler');
  // a skewed plan (a scan, a photo of a sheet): straightened first; walls and openings come back in that frame
  if (Math.abs(o.rotate || 0) > 0.01 && !options._rotated) {
    const r = detectPlan(rotateImage(img, -o.rotate), { ...options, _rotated: true });
    return { ...r, stats: { ...r.stats, rotated: o.rotate } };
  }
  // the cleaner first (options.clean): once, at the image's own resolution, on the straightened plan – not on an image
  // it has cleaned already (cleanForWalls marks its output with cleanStats). A boolean passes a worker's postMessage
  const cleaner = o.clean === true ? cleanForWalls : typeof o.clean === 'function' ? o.clean : null;
  if (cleaner && !options._cleaned && !img.cleanStats) {
    const cleaned = cleaner(img, { pxPerM: ppm });
    const r = detectPlan(cleaned, { ...options, _cleaned: true });
    return { ...r, stats: { ...r.stats, cleaned: true, ...(cleaned.cleanStats ? { clean: cleaned.cleanStats } : {}) } };
  }
  // a low-resolution plan (an interior wall of 10 cm under ~5 px) is detected on a bilinear 2–3× copy: the opening
  // that removes text would otherwise remove the thin walls too; the result is scaled back
  if (ppm < o.minPxPerM && !options._scaled) {
    const f = Math.min(4, Math.ceil(o.minPxPerM / ppm));
    const r = detectPlan(upsample(img, f), { ...options, pxPerM: ppm * f, _scaled: f });
    const k = 1 / f;
    return {
      ...r,
      walls: r.walls.map((w) => ({ ...w, a: [w.a[0] * k, w.a[1] * k], b: [w.b[0] * k, w.b[1] * k], t: w.t * k })),
      openings: r.openings.map((op) => ({ ...op, from: op.from * k, to: op.to * k, leaf: op.leaf == null ? null : op.leaf * k, ...(op.leaf2 != null ? { leaf2: op.leaf2 * k } : {}) })),
      skylights: r.skylights.map((b) => ({ ...b, x0: b.x0 * k, y0: b.y0 * k, x1: b.x1 * k, y1: b.y1 * k })),
      stairs: r.stairs.map((st) => scaleStair(st, k)),
      separators: (r.separators || []).map((s) => ({ a: [s.a[0] * k, s.a[1] * k], b: [s.b[0] * k, s.b[1] * k] })),
      stats: { ...r.stats, upsampled: f },
    };
  }
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
  const timings = {};

  // ---- 1. grey + dark mask
  const grey = luma(img);
  const hist = histogram(grey);
  const paper = paperGrey(hist);
  const tone = Array.isArray(o.wallTone) && o.wallTone.length === 2 ? [Math.max(0, o.wallTone[0]), Math.min(255, o.wallTone[1])] : null;
  // with a wall tone: «dark» is the band, and the clean-profile tests only need paper lighter than the band
  const darkT = tone ? Math.min(tone[0], 255) : o.darkThreshold ?? autoDarkThreshold(hist, { firstValley: !o._scaled });
  const isWall = tone ? (v) => v >= tone[0] && v <= tone[1] : (v) => v < darkT;
  // the walls' ink: the black peak, or with a tone the most common grey of the band – the fill of a light grey wall
  // between its darker outlines (hus9, hus4), not the band's middle, so the thickness integrated across a wall
  // (refine) reaches both outlines and the window frame lines at its faces lie in its band
  let ink = 0;
  if (tone) {
    ink = tone[0];
    for (let i = tone[0]; i <= tone[1]; i++) if (hist[i] > hist[ink]) ink = i;
  } else for (let i = 0; i < 60; i++) if (hist[i] > hist[ink]) ink = i;
  const dark = raster(grey.w, grey.h);
  for (let i = 0; i < grey.data.length; i++) dark.data[i] = isWall(grey.data[i]) ? 1 : 0;
  timings.mask = now();

  // ---- 2. opening: strokes thinner than the thinnest wall vanish
  const minWallPx = o.minWall * ppm;
  const maxWallPx = o.maxWall * ppm;
  const r = Math.max(1, Math.min(4, Math.round(minWallPx / 2 - 0.5)));
  const core = open(dark, r);
  // tiny blobs (arrow heads, bold letters) out
  {
    const { labels, comps } = components(core, 8);
    const minExt = Math.max(3, 0.12 * ppm);
    const drop = new Set(comps.filter((c) => Math.max(c.maxX - c.minX, c.maxY - c.minY) + 1 < minExt).map((c) => c.id));
    for (let i = 0; i < labels.length; i++) if (labels[i] >= 0 && drop.has(labels[i])) core.data[i] = 0;
  }
  timings.core = now();

  // ---- 3. long runs per axis, the rest
  const minRun = Math.round(maxWallPx) + 2;
  const Hm = longRuns(core, H, minRun);
  const Vm = longRuns(core, V, minRun);
  const rest = subtract(subtract(core, Hm), Vm);

  // ---- 4. rectangles → pieces { axis, c, s0, s1, t }
  const pieces = [];
  const addRect = (rc, src) => {
    const t = rc.a1 - rc.a0 + 1;
    if (t < Math.max(2, minWallPx * 0.6) || t > maxWallPx + 2) return;
    pieces.push({ axis: rc.axis, c: (rc.a0 + rc.a1 + 1) / 2, s0: rc.s0, s1: rc.s1 + 1, t, src });
  };
  for (const rc of rectanglesOf(Hm, H, 3)) addRect(rc, 'run');
  for (const rc of rectanglesOf(Vm, V, 3)) addRect(rc, 'run');
  // stubs: a leftover blob that lies in the band of a wall line of its axis
  {
    const { comps } = components(rest, 4);
    for (const c of comps) {
      const w = c.maxX - c.minX + 1;
      const h = c.maxY - c.minY + 1;
      if (c.area < 0.6 * w * h) continue; // not a filled rectangle
      // both orientations; the best reason wins: in the band of a wall line > on the face of a perpendicular wall (the
      // start of a wall at a corner / T) > a free piece clearly longer than thick
      let best = null;
      for (const axis of [H, V]) {
        const [s0, s1, a0, a1] = axis === H ? [c.minX, c.maxX, c.minY, c.maxY] : [c.minY, c.maxY, c.minX, c.maxX];
        const cc = (a0 + a1 + 1) / 2;
        const t = a1 - a0 + 1;
        const len = s1 - s0 + 1;
        const wallLike = t >= minWallPx * 0.6 && t <= maxWallPx;
        const inLine = pieces.some((p) => p.axis === axis && p.src === 'run' && Math.abs(p.c - cc) <= 1.6 && Math.abs(p.t - t) <= 2.5);
        const onFace = wallLike && len >= 0.05 * ppm && pieces.some((p) => {
          if (p.axis === axis || p.src !== 'run') return false;
          const touches = Math.abs(s0 - (p.c + p.t / 2)) <= 2 || Math.abs(s1 + 1 - (p.c - p.t / 2)) <= 2;
          return touches && a0 >= p.s0 - 2 && a1 + 1 <= p.s1 + 2;
        });
        const free = wallLike && len >= 0.25 * ppm && len >= 1.5 * t;
        const rank = inLine ? 3 : onFace ? 2 : free ? 1 : 0;
        if (rank && (!best || rank > best.rank || (rank === best.rank && len / t > best.ratio))) best = { rank, ratio: len / t, piece: { axis, c: cc, s0, s1: s1 + 1, t, src: 'stub' } };
      }
      if (best) pieces.push(best.piece);
    }
  }
  for (const p of pieces) refine(grey, p, ink, paper, { darkT: tone ? tone[1] : darkT, isWall });
  // a wall split across its thickness (a bench or a box drawn over half of it: the long runs keep one half, the other
  // half is a stub of its own) is one piece where the two halves lie face to face
  for (const p of mergeStacked(pieces, maxWallPx, Math.max(4, 0.15 * ppm))) refine(grey, p, ink, paper, { darkT: tone ? tone[1] : darkT, isWall });
  timings.pieces = now();

  // ---- 5a. collinear fragments → wall lines
  const tolC = Math.max(1.5, 0.02 * ppm);
  const tolT = Math.max(2.5, 0.04 * ppm);
  let segs = mergeCollinear(pieces, tolC, tolT, 1.5);
  // slivers (an outline corner of a window at high resolution): shorter than ~60 % of their thickness – they would
  // block the gap analysis between the real pieces
  segs = segs.filter((sg) => sg.s1 - sg.s0 >= Math.max(3, 0.6 * sg.t));
  // ---- 5b. joints: a free end inside / next to the band of a perpendicular wall snaps to its centre line
  const tolJ = Math.max(2, 0.03 * ppm);
  snapJoints(segs, tolJ);
  timings.joints = now();

  // ---- 6. gaps → openings
  // dashGaps: the gaps joinGaps found drawn with dashed lines only and left open – separator candidates (step 8)
  const ctx = { grey, core, darkT, isWall, paper, ink, ppm, o, dashGaps: [] };
  const openings = [];
  segs = joinGaps(segs, openings, ctx, tolC, tolT, tolJ);
  snapJoints(segs, tolJ);
  timings.openings = now();

  // ---- 7. networks: drop what is not connected to the main wall network
  const n = segs.length;
  const U = dsu(n);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) if (touches(segs[i], segs[j], tolJ + 1)) U.union(i, j);
  }
  const lenOf = new Map();
  for (let i = 0; i < n; i++) lenOf.set(U.find(i), (lenOf.get(U.find(i)) || 0) + (segs[i].s1 - segs[i].s0));
  const maxLen = Math.max(0, ...lenOf.values());
  const keep = segs.map((_, i) => lenOf.get(U.find(i)) >= o.minNetworkShare * maxLen);
  const remap = new Map();
  const walls = [];
  segs.forEach((s, i) => {
    if (!keep[i]) return;
    remap.set(s, walls.length);
    walls.push(s);
  });
  let ops = openings.filter((op) => remap.has(op.seg));
  timings.network = now();

  // grey walls (lighter than the black text): the black threshold finds (almost) nothing – try the grey band with the
  // most long wall runs (autoWallTone) once, before anything else is spent on this pass
  if (!tone && !options._noAutoTone && walls.length < 3) {
    const t = autoWallTone(grey, hist, paper, { r, minRun });
    if (t) {
      const again = detectPlan(img, { ...options, wallTone: t, _noAutoTone: true });
      if (again.walls.length > walls.length) return { ...again, stats: { ...again.stats, autoWallTone: t } };
    }
  }

  // ---- exterior: flood fill of the paper from the image border, the walls closed
  const outside = outsideMask(img.width, img.height, walls);
  for (const s of walls) {
    const probe = (side) => {
      let hits = 0;
      let total = 0;
      for (let k = 1; k < 8; k++) {
        const sAt = s.s0 + ((s.s1 - s.s0) * k) / 8;
        const [x, y] = pt(s, sAt, side * (s.t / 2 + 3));
        const xi = Math.round(x);
        const yi = Math.round(y);
        if (xi < 0 || yi < 0 || xi >= img.width || yi >= img.height) {
          hits++;
          total++;
          continue;
        }
        total++;
        if (outside.data[yi * img.width + xi]) hits++;
      }
      return hits / total;
    };
    s.outsideSide = probe(1) > 0.5 ? 1 : probe(-1) > 0.5 ? -1 : 0;
    s.exterior = s.outsideSide !== 0;
  }
  timings.exterior = now();

  // ---- 8. symbols inside the building: skylights (dashed rectangles), stairs (ladders of treads, fans of winders)
  const sym = findSymbols(grey, core, outside, paper, ppm, o._scaled || 1);
  const { skylights, stairs } = sym;
  // a door kept on a weak arc over a drawn window (analysePart) whose arc lies on a stair is the winders or the walking
  // line of the stair: the hole is what its band shows
  const pad = 0.1 * ppm;
  const onStair = (p) => stairs.some((st) => p[0] >= st.bbox[0] - pad && p[0] <= st.bbox[2] + pad && p[1] >= st.bbox[1] - pad && p[1] <= st.bbox[3] + pad);
  ops = ops.flatMap((op) => (op.weak && onStair(op.weak.at) ? op.weak.alt.map((x) => ({ ...x, seg: op.seg })) : [op]));
  // the dash-dot lines that close an open zone between two wall ends: room separators, never walls
  const { separators, tried: separatorLines } = findSeparators(sym.thin, sym.box, walls, outside, ppm, { tolC, tolJ, maxWallPx, gaps: ctx.dashGaps });
  timings.symbols = now();

  // classify the line symbols now that we know which walls are exterior
  for (const op of ops) {
    // an opening in an exterior wall with lines in it is a window; an exterior gap with no symbol stays an opening
    if (op.type === 'symbol') op.type = op.seg.exterior ? 'window' : 'opening';
    // a gap in an interior wall narrower than a passage: something drawn on or in the wall (a fuse box, a chimney, a
    // cabinet) – the wall goes on
    if (op.type === 'opening' && !op.seg.exterior && op.s1 - op.s0 < o.minPassage * ppm) op.drop = true;
  }
  timings.classify = now();

  // ---- out: walls a → b (+x / +y), openings along them
  const outWalls = walls.map((s) => ({
    a: pt(s, s.s0),
    b: pt(s, s.s1),
    t: s.t,
    axis: s.axis,
    exterior: s.exterior,
    outsideSide: s.axis === H ? s.outsideSide : -s.outsideSide, // in the wall's normal (−d.y, d.x): h → +y, v → −x
  }));
  const outOpenings = ops
    .filter((op) => !op.drop)
    .map((op) => {
      const s = op.seg;
      const side = op.side ? (s.axis === H ? op.side : -op.side) : 0;
      return {
        wall: remap.get(s),
        from: Math.max(0, op.s0 - s.s0),
        to: Math.min(s.s1 - s.s0, op.s1 - s.s0),
        type: op.type,
        ...(op.type === 'door' ? { variant: op.variant ?? 'single' } : {}),
        hinge: op.hinge === 's0' ? 'start' : op.hinge === 's1' ? 'end' : null,
        side,
        leaf: op.leaf ?? null,
        ...(op.leaf2 != null ? { leaf2: op.leaf2 } : {}),
        score: op.score ?? 0,
        symbol: op.symbol,
      };
    })
    .filter((op) => op.to - op.from >= 0.2 * ppm)
    .sort((a, b) => a.wall - b.wall || a.from - b.from);

  return {
    walls: outWalls,
    openings: outOpenings,
    skylights,
    stairs,
    separators,
    stats: { darkThreshold: darkT, wallTone: tone, paper, ink, coreRadius: r, minRun, pieces: pieces.length, timings },
    debug: {
      dark,
      core,
      pieces,
      outside,
      separatorLines,
      get thin() {
        return uncrop(sym.thin, sym.box, grey.w, grey.h);
      },
      get stairInk() {
        return uncrop(sym.stairInk, sym.box, grey.w, grey.h);
      },
    },
  };
}

/**
 * Pieces of one axis lying face to face (one's face within 1.5 px of the other's) over a common span of at least minLen
 * become one piece there (the union band, at most maxT thick); the rest of each stays its own piece. Mutates the list,
 * returns the new pieces.
 */
function mergeStacked(pieces, maxT, minLen) {
  const made = [];
  for (let guard = 0; guard < 200; guard++) {
    let hit = null;
    for (let i = 0; i < pieces.length && !hit; i++) {
      for (let j = 0; j < pieces.length && !hit; j++) {
        const A = pieces[i];
        const B = pieces[j];
        if (i === j || A.axis !== B.axis || Math.abs(A.c + A.t / 2 - (B.c - B.t / 2)) > 1.5) continue;
        const lo = Math.max(A.s0, B.s0);
        const hi = Math.min(A.s1, B.s1);
        const t = B.c + B.t / 2 - (A.c - A.t / 2);
        if (hi - lo >= minLen && t <= maxT) hit = { i, j, A, B, lo, hi, t };
      }
    }
    if (!hit) break;
    const { i, j, A, B, lo, hi, t } = hit;
    const union = { axis: A.axis, c: A.c - A.t / 2 + t / 2, t, s0: lo, s1: hi, src: 'stack' };
    const rest = [];
    for (const P of [A, B]) {
      if (P.s0 < lo - 1) rest.push({ ...P, s1: lo });
      if (P.s1 > hi + 1) rest.push({ ...P, s0: hi });
    }
    pieces.splice(Math.max(i, j), 1);
    pieces.splice(Math.min(i, j), 1);
    pieces.push(union, ...rest);
    made.push(union);
  }
  return made.filter((p) => pieces.includes(p));
}

/** Merges collinear pieces of the same axis whose bands agree and whose spans overlap or touch (gap ≤ maxGap). */
function mergeCollinear(pieces, tolC, tolT, maxGap) {
  const out = [];
  for (const axis of [H, V]) {
    const list = pieces.filter((p) => p.axis === axis).map((p) => ({ ...p })).sort((a, b) => a.c - b.c || a.s0 - b.s0);
    const used = new Array(list.length).fill(false);
    for (let i = 0; i < list.length; i++) {
      if (used[i]) continue;
      const m = { ...list[i] };
      used[i] = true;
      let grew = true;
      while (grew) {
        grew = false;
        for (let j = 0; j < list.length; j++) {
          if (used[j]) continue;
          const q = list[j];
          if (q.s0 > m.s1 + maxGap || q.s1 < m.s0 - maxGap) continue;
          // the same band only: a wall line drawn with two thicknesses stays two walls that meet end to end
          if (Math.abs(q.c - m.c) > tolC || Math.abs(q.t - m.t) > tolT) continue;
          const la = m.s1 - m.s0;
          const lb = q.s1 - q.s0;
          // the refined pieces decide the band
          const wa = la * (m.refined ? 3 : 1);
          const wb = lb * (q.refined ? 3 : 1);
          m.c = (m.c * wa + q.c * wb) / (wa + wb);
          m.t = (m.t * wa + q.t * wb) / (wa + wb);
          m.refined = m.refined || q.refined;
          m.s0 = Math.min(m.s0, q.s0);
          m.s1 = Math.max(m.s1, q.s1);
          used[j] = true;
          grew = true;
        }
      }
      out.push(m);
    }
  }
  return out;
}

/** Does the free end at s (of seg) lie in or next to the band of the perpendicular wall p? Returns the overshoot. */
function endInBand(seg, s, p, tol) {
  if (p.axis === seg.axis) return null;
  // the end point
  const across = seg.c; // seg's centre line, measured along p
  if (across < p.s0 - tol - seg.t / 2 || across > p.s1 + tol + seg.t / 2) return null;
  const d = Math.abs(s - p.c);
  if (d > p.t / 2 + tol) return null;
  return d;
}

/** Snaps every free end into the perpendicular wall it touches (to its centre line); stretches p to the joint. */
function snapJoints(segs, tol) {
  for (const seg of segs) {
    seg.joints = seg.joints || [null, null];
    for (const [k, key] of [[0, 's0'], [1, 's1']]) {
      let best = null;
      for (const p of segs) {
        if (p === seg) continue;
        const d = endInBand(seg, seg[key], p, tol);
        if (d !== null && (!best || d < best.d)) best = { p, d };
      }
      if (best) {
        seg[key] = best.p.c;
        seg.joints[k] = best.p;
        // p reaches the joint (an L corner where p stops short of seg's centre line)
        if (seg.c < best.p.s0 && best.p.s0 - seg.c <= seg.t / 2 + tol) best.p.s0 = seg.c;
        if (seg.c > best.p.s1 && seg.c - best.p.s1 <= seg.t / 2 + tol) best.p.s1 = seg.c;
      }
    }
  }
  for (const seg of segs) if (seg.s1 < seg.s0) [seg.s0, seg.s1] = [seg.s1, seg.s0];
}

/** Do two walls touch (a joint, or collinear and overlapping)? */
function touches(a, b, tol) {
  if (a.axis === b.axis) return Math.abs(a.c - b.c) <= tol && a.s0 <= b.s1 + tol && b.s0 <= a.s1 + tol;
  const h = a.axis === H ? a : b;
  const v = a.axis === H ? b : a;
  // h spans x, v spans y: the crossing point (v.c, h.c)
  return v.c >= h.s0 - tol && v.c <= h.s1 + tol && h.c >= v.s0 - tol && h.c <= v.s1 + tol;
}

/**
 * Examines the band of a wall line between s0 and s1 (along) for opening symbols: lines along the wall (window
 * glass, a door's threshold bar) and the share of wall-dark pixels.
 */
function bandSymbol(ctx, axis, c, t, s0, s1) {
  const { grey, paper, isWall, ppm } = ctx;
  const lineT = paper - 35;
  const a0 = Math.round(c - t / 2) - 1;
  const a1 = Math.round(c + t / 2);
  let lines = 0;
  let dashed = 0;
  let darkPx = 0;
  let total = 0;
  let inkSum = 0;
  const x0 = Math.ceil(s0 + 1);
  const x1 = Math.floor(s1 - 1);
  if (x1 <= x0) return { lines: 0, dashed: 0, dashedOnly: false, darkShare: 0, wallCols: 0, ink: 0, hatched: false };
  const colDark = new Uint16Array(x1 - x0 + 1);
  const colMin = new Float32Array(x1 - x0 + 1).fill(255);
  // a row along the wall: its share of ink and its breaks (light runs of 3 px or more) – drawn lines break only between
  // the parts of a gap (a door beside a window, a label), a dashed line (a roof edge, «plan himling», a beam) every few
  // decimetres: at least 3 breaks and 1.5 per metre
  const maxBreaks = Math.max(2, 1.5 * ((x1 - x0) / ppm));
  const rowOf = (a, wallStats) => {
    let hit = 0;
    let n = 0;
    let breaks = 0;
    let light = 0;
    for (let s = x0; s <= x1; s++) {
      const [x, y] = axis === H ? [s, a] : [a, s];
      const v = sample(grey, x, y);
      n++;
      if (v < lineT) {
        hit++;
        if (light >= 3 && hit > 1) breaks++;
        light = 0;
      } else light++;
      if (wallStats) {
        if (isWall(v)) {
          darkPx++;
          colDark[s - x0]++;
        }
        if (v < colMin[s - x0]) colMin[s - x0] = v;
        inkSum += Math.max(0, paper - v);
        total++;
      }
    }
    const share = n ? hit / n : 0;
    const dash = share >= 0.3 && breaks >= 3 && breaks >= maxBreaks;
    return { line: share >= 0.6 && !dash, dash };
  };
  for (let a = a0; a <= a1; a++) {
    const r = rowOf(a, true);
    if (r.line) lines++;
    else if (r.dash) dashed++;
  }
  // a dashed line finer than the rows see (the 1–3 px gaps of a dash-dot beam under ~90 px/m, blurred further on an
  // upsampled copy), in a gap longer than a passage: the band's darkest pixel per column rises above the middle between
  // the dashes' ink and the paper at least 3 times and 3 times per metre – across the whole band at once, so no solid
  // line runs through it (a window's glass, a threshold bar: every column dark) –, regularly: dashes up to 60 cm, breaks
  // up to 20 cm (not a door leaf or window the cleaner broke where it took the floor's hatching, hus4, nor the
  // furniture and hatching of a scanned drawing, hus6). Its line rows are dashes
  if (lines > 0 && x1 - x0 > ctx.o.maxPlainOpening * ppm) {
    const sorted = Float32Array.from(colMin).sort();
    const inkC = sorted[Math.floor(0.1 * sorted.length)];
    if (inkC <= paper - 80) {
      const mid = (inkC + paper) / 2;
      let breaks = 0;
      let runL = 0;
      let runD = 0;
      let started = false;
      let regular = true;
      for (const v of colMin) {
        if (v >= mid) {
          if (runD > 0.6 * ppm) regular = false;
          runD = 0;
          if (started) runL++;
        } else {
          if (runL) {
            breaks++;
            if (runL > 0.2 * ppm) regular = false;
          }
          runL = 0;
          runD++;
          started = true;
        }
      }
      if (runD > 0.6 * ppm) regular = false;
      if (regular && breaks >= 3 && breaks >= 3 * ((x1 - x0) / ppm)) {
        dashed += lines;
        lines = 0;
      }
    }
  }
  // hatching (deck boards, a wood floor, stair treads): lines along the wall in the strips beyond BOTH faces too – the
  // band's lines are then the hatching running through, not a window
  const strip = (sign) => {
    let count = 0;
    let prev = false;
    for (let k = Math.round(t / 2 + 0.05 * ppm); k <= Math.round(t / 2 + 0.35 * ppm); k++) {
      const r = rowOf(Math.round(c + sign * k), false);
      const on = r.line || r.dash;
      if (on && !prev) count++;
      prev = on;
    }
    return count;
  };
  const hatched = lines + dashed > 0 && strip(-1) >= 2 && strip(1) >= 2;
  // columns where a (thinner) wall runs through the band: a third of the band or more is wall-dark
  const rows = a1 - a0 + 1;
  let wallCols = 0;
  for (const c of colDark) if (c >= Math.max(2, rows / 3)) wallCols++;
  // dashedOnly: the band is drawn with dashed lines and no solid one (a beam, a roof edge) – no sliding leaf either
  return { lines: hatched ? 0 : lines, dashed, dashedOnly: lines === 0 && dashed > 0, darkShare: total ? darkPx / total : 0, wallCols: wallCols / colDark.length, ink: total ? inkSum / total : 0, hatched };
}

/**
 * Best door arc in a gap: hinge positions along the gap, both directions along the wall, both sides, radii from
 * doorMin to min(doorMax, gap). In a gap under doorMin / 0.6 also from 60 % of the gap (at least 45 cm): a leaf drawn
 * shorter than its hole (hus8's terrace door, 0.53 m in a 0.8 m hole at 36 px/m) is still the door – when the arc is
 * clearly drawn (75 %, or 60 % with its leaf), so tiles or a label under a passage do not make a small door. A point of
 * the arc is drawn when a pixel within 1.5 px is clearly darker than the paper and is not wall; points that fall into a
 * wall make the arc impossible.
 */
function findArc(ctx, seg, g0, g1) {
  const { ppm, o } = ctx;
  const gap = g1 - g0;
  const rMin = o.doorMin * ppm;
  const rShort = Math.max(0.45 * ppm, Math.min(rMin, 0.6 * gap));
  const rMax = Math.min(o.doorMax * ppm, gap + 2);
  if (rMax < rShort) return null;
  const arcAt = arcProbe(ctx, seg, o.arcScore - 0.15);
  let best = null;
  let short = null;
  const stepH = Math.max(1, Math.round(0.02 * ppm));
  const stepR = Math.max(1, Math.round(0.025 * ppm));
  // the radii: from doorMin up, and the short leaves under it
  const radii = [];
  for (let rad = rMin; rad <= rMax + 0.01; rad += stepR) radii.push(rad);
  for (let rad = rMin - stepR; rad >= rShort - 0.01; rad -= stepR) radii.push(rad);
  for (const dirSign of [1, -1]) {
    for (let h = g0; h <= g1 + 0.01; h += stepH) {
      for (const rad of radii) {
        const tip = h + dirSign * rad;
        if (tip < g0 - 2 || tip > g1 + 2) continue;
        for (const side of [1, -1]) {
          const r = arcAt(h, rad, dirSign, side);
          if (!r) continue;
          const better = (b) => !b || r.score > b.score + 1e-9 || (Math.abs(r.score - b.score) < 1e-9 && rad > b.rad);
          if (rad < rMin - 0.01) {
            if (better(short)) short = r;
          } else if (better(best)) best = r;
        }
      }
    }
  }
  if (short && (short.arc >= 0.75 || (short.arc >= o.arcScore && short.leaf >= 0.5)) && (!best || best.arc < o.arcScore || short.score > best.score + 1e-9)) return short;
  return best;
}

/**
 * The arc test of findArc as a probe on one wall: (h, rad, dirSign, side) → { score, arc, leaf, h, rad, dirSign, side }
 * or null when the arc runs through a wall, or when less than minArc of it can be drawn (the test stops as soon as the
 * points left cannot reach it: most probes are in empty paper). A point of the arc is drawn when a pixel within 1.5 px
 * is clearly darker than the paper, with paper to both sides across it (a THIN line: a grey filled sofa or worktop
 * under the arc is not one); the open leaf is a line from the hinge perpendicular to the wall.
 */
function arcProbe(ctx, seg, minArc = 0) {
  const { grey, core, paper, ppm } = ctx;
  const W = core.w;
  const isCore = (x, y) => {
    const xi = Math.round(x);
    const yi = Math.round(y);
    return xi >= 0 && yi >= 0 && xi < W && yi < core.h && core.data[yi * W + xi] === 1;
  };
  const inkT = paper - 30;
  const thinInk = (x, y, nx, ny) => {
    const m = minNear(grey, x, y, 1.5);
    if (m >= inkT) return false;
    const off = Math.max(3, 0.06 * ppm);
    const a = minNear(grey, x + nx * off, y + ny * off, 0.5);
    const b = minNear(grey, x - nx * off, y - ny * off, 0.5);
    return a > m + 25 && b > m + 25;
  };
  const N = 24;
  const need = Math.ceil(minArc * N - 1e-9);
  const COS = [];
  const SIN = [];
  for (let k = 1; k <= N; k++) {
    const phi = ((8 + (74 * (k - 1)) / (N - 1)) * Math.PI) / 180;
    COS.push(Math.cos(phi));
    SIN.push(Math.sin(phi));
  }
  return (h, rad, dirSign, side) => {
    const face = seg.c + side * (seg.t / 2);
    let drawn = 0;
    let blocked = 0;
    for (let k = 0; k < N; k++) {
      const ca = dirSign * COS[k];
      const cb = side * SIN[k];
      const along = h + rad * ca;
      const off = face + rad * cb;
      const [x, y] = seg.axis === H ? [along, off] : [off, along];
      const [nx, ny] = seg.axis === H ? [ca, cb] : [cb, ca]; // radial = across the arc
      if (isCore(x, y)) {
        if (++blocked > 2) return null;
      } else if (thinInk(x, y, nx, ny)) drawn++;
      if (drawn + N - 1 - k < need) return null;
    }
    let leaf = 0;
    for (let k = 2; k <= 9; k++) {
      const off = face + side * rad * (k / 10);
      const [x, y] = seg.axis === H ? [h, off] : [off, h];
      const [nx, ny] = seg.axis === H ? [1, 0] : [0, 1];
      if (!isCore(x, y) && thinInk(x, y, nx, ny)) leaf++;
    }
    return { score: drawn / N + 0.15 * (leaf / 8), arc: drawn / N, leaf: leaf / 8, h, rad, dirSign, side };
  };
}

/**
 * The best arc hinged at (or within 3 cm of) the jamb h, turning dirSign along the wall, on the given sides, with a
 * radius from rLo to rHi pixels – the second leaf of a double door, or both leaves when they are narrower than doorMin.
 */
function findArcAt(ctx, seg, h, dirSign, sides, rLo, rHi) {
  const { ppm, o } = ctx;
  if (rHi < rLo) return null;
  const arcAt = arcProbe(ctx, seg, o.arcScore - 0.15);
  const stepH = Math.max(1, Math.round(0.01 * ppm));
  const stepR = Math.max(1, Math.round(0.02 * ppm));
  const reach = Math.max(2, Math.round(0.03 * ppm));
  let best = null;
  for (let dh = -reach; dh <= reach; dh += stepH) {
    for (let rad = rLo; rad <= rHi + 0.01; rad += stepR) {
      for (const side of sides) {
        const r = arcAt(h - dirSign * dh, rad, dirSign, side);
        if (r && (!best || r.score > best.score + 1e-9)) best = r;
      }
    }
  }
  return best;
}

/**
 * A sliding door in a gap: its leaf (one or two) is drawn as thin lines along the wall that cover only part of the
 * gap from one jamb – a pocket, or two leaves from opposite jambs overlapping in the middle – often with an arrow; a
 * window's lines run from jamb to jamb. Rows of the band whose longest ink run (2 cm breaks bridged) covers 25–80 % of
 * the gap, is 35 cm long or more and touches exactly one jamb are leaf rows, unless the run is wall core as thick as
 * the wall (a wall stub, not a drawn line): a leaf drawn as a black bar (hus6: four leaves, two stacked at each jamb)
 * is core too, but at most 60 % of the wall's thickness.
 * @returns {{ leaves: number, leaf: number, end: 0|1, rows: number, share: number } | null}  leaf = longest run, px
 */
function slidingLeaf(ctx, seg, p, q) {
  const { grey, core, paper, ppm } = ctx;
  const x0 = Math.ceil(p + 1);
  const x1 = Math.floor(q - 1);
  const n = x1 - x0 + 1;
  if (n < 0.45 * ppm) return null;
  const inkT = Math.min(paper - 45, 205);
  const a0 = Math.round(seg.c - seg.t / 2) - 1;
  const a1 = Math.round(seg.c + seg.t / 2);
  const near = Math.max(2, 0.12 * n);
  const bridge = Math.max(2, Math.round(0.02 * ppm)) + 1;
  const isCore = (x, y) => {
    const xi = Math.round(x);
    const yi = Math.round(y);
    return xi >= 0 && yi >= 0 && xi < core.w && yi < core.h && core.data[yi * core.w + xi] === 1;
  };
  const rows = [];
  for (let a = a0; a <= a1; a++) {
    let best = null;
    let start = -1;
    let last = -1e9;
    const close = () => {
      if (start >= 0 && (!best || last - start > best[1] - best[0])) best = [start, last];
    };
    for (let s = x0; s <= x1; s++) {
      const [x, y] = seg.axis === H ? [s, a] : [a, s];
      if (sample(grey, x, y) >= inkT) continue;
      if (start < 0 || s - last > bridge) {
        close();
        start = s;
      }
      last = s;
    }
    close();
    if (!best) continue;
    const share = (best[1] - best[0] + 1) / n;
    const atStart = best[0] - x0 <= near;
    const atEnd = x1 - best[1] <= near;
    // (a leaf of 60 cm or more may cover less than a quarter of a wide opening: four leaves stacked two and two; and
    // none is under 35 cm – the edge of a bath, a rug or a desk at the wall is: hus9)
    const run = best[1] - best[0] + 1;
    if ((share < 0.25 && !(share >= 0.18 && run >= 0.6 * ppm)) || share > 0.8 || run < 0.35 * ppm || atStart === atEnd) continue;
    let coreHits = 0;
    let probes = 0;
    let coreT = 0;
    const inner = 0.1 * (best[1] - best[0]);
    for (let s = best[0]; s <= best[1]; s += 2) {
      probes++;
      const at = (k) => (seg.axis === H ? isCore(s, k) : isCore(k, s));
      if (!at(a)) continue;
      coreHits++;
      // the core's thickness across the band, away from the jamb (the wall's own end there is as thick as the wall)
      if (s - best[0] < inner || best[1] - s < inner) continue;
      let lo = a;
      let hi = a;
      while (lo > a0 - 2 && at(lo - 1)) lo--;
      while (hi < a1 + 2 && at(hi + 1)) hi++;
      coreT = Math.max(coreT, hi - lo + 1);
    }
    if (coreHits > 0.5 * probes && coreT > 0.6 * seg.t) continue;
    rows.push({ a, r0: best[0], r1: best[1], end: atStart ? 0 : 1, share });
  }
  if (!rows.length) return null;
  // neighbouring rows anchored at the same jamb are one drawn leaf (a line 1–3 px wide)
  const groups = [];
  for (const r of rows) {
    const g = groups.find((x) => x.end === r.end && r.a - x.a1 <= 1);
    if (g) {
      g.a1 = r.a;
      g.len = Math.max(g.len, r.r1 - r.r0 + 1);
      g.share = Math.max(g.share, r.share);
    } else groups.push({ end: r.end, a0: r.a, a1: r.a, len: r.r1 - r.r0 + 1, share: r.share });
  }
  const main = groups.reduce((b, g) => (!b || g.len > b.len ? g : b), null);
  return { leaves: new Set(groups.map((g) => g.end)).size, leaf: main.len, end: main.end, rows: rows.length, share: main.share };
}

/**
 * Gaps → openings: collinear pieces with a gap between them, and free ends that point at a wall, are joined when the
 * gap is an opening (symbol, arc) or short. Returns the new wall list; openings are pushed to `openings`.
 */
function joinGaps(segs, openings, ctx, tolC, tolT, tolJ) {
  const { ppm, o } = ctx;
  const minO = o.minOpening * ppm;
  const maxO = o.maxOpening * ppm;
  const maxS = Math.max(maxO, o.maxSymbolOpening * ppm);
  const list = segs.map((s) => ({ ...s, joints: s.joints ? [...s.joints] : [null, null] }));
  // one part of a gap (between pillars): a door (+ the sidelights next to it), a window / glass, or a passage
  const sideJamb = o.minSidelight * ppm;
  // the best arc of a stretch, remembered (the whole gap and its one part are often the same stretch)
  const arcs = new Map();
  const arcOf = (seg, p, q) => {
    const key = `${seg.axis}|${seg.c.toFixed(1)}|${seg.t.toFixed(1)}|${p.toFixed(1)}|${q.toFixed(1)}`;
    if (!arcs.has(key)) arcs.set(key, findArc(ctx, seg, p, q));
    return arcs.get(key);
  };
  // a sliding door is a door (0.6 m or more) whose leaf rows outnumber the full lines (a window with a stray partial
  // line is still a window), or a leaf drawn as a bar (5 rows or more) beside the outline of a pocket, or – in a gap no
  // longer than a passage (an edge of furniture along a long gap is no leaf) – a single leaf line in an otherwise
  // empty gap
  const slidingOk = (sl, sym, len) => (sl.rows >= 2 && sl.rows >= sym.lines) || (sl.rows >= 5 && sl.rows >= 0.5 * sym.lines) || (sym.lines === 0 && sl.rows >= 1 && len <= o.maxPlainOpening * ppm);
  // a weak arc: under 75 % drawn, or under 85 % with no leaf drawn (over a drawn window: furniture, winders or a
  // window's frame more often than a door, see analysePart)
  const weak = (a) => a.arc < 0.75 || (a.arc < 0.85 && a.leaf < 0.25);
  // the second leaf of a double door: an arc on the same side hinged at the far jamb whose tip meets the first's
  const secondLeaf = (seg, arc, p, q, windowDrawn = false) => {
    const near = arc.dirSign > 0 ? p : q;
    if (Math.abs(arc.h - near) >= sideJamb) return null;
    const tip = arc.h + arc.dirSign * arc.rad;
    const far = arc.dirSign > 0 ? q : p;
    const room = (far - tip) * arc.dirSign;
    if (room < 0.25 * ppm) return null;
    const r2 = findArcAt(ctx, seg, far, -arc.dirSign, [arc.side], Math.max(0.25 * ppm, room * 0.75), Math.min(o.doorMax * ppm, room * 1.25 + 2));
    if (!r2 || r2.arc < o.arcScore || (windowDrawn && weak(r2))) return null;
    return Math.abs(r2.h + r2.dirSign * r2.rad - tip) <= 0.15 * ppm ? r2 : null;
  };
  // a double door whose leaves are both narrower than doorMin (findArc does not look for them): one arc from each jamb
  const smallDouble = (seg, p, q, windowDrawn) => {
    const len = q - p;
    // a quick look first: the two half-width arcs drawn at all (most gaps have none, and the full search is slow)
    const probe = arcProbe(ctx, seg, 0.4);
    const sides = [1, -1].filter((side) => (probe(p, len / 2, 1, side)?.arc ?? 0) >= 0.4 && (probe(q, len / 2, -1, side)?.arc ?? 0) >= 0.4);
    let best = null;
    for (const side of sides) {
      const r1 = findArcAt(ctx, seg, p, 1, [side], 0.25 * ppm, Math.min(o.doorMin * ppm, 0.65 * len));
      if (!r1 || r1.arc < o.arcScore || (windowDrawn && weak(r1))) continue;
      const r2 = secondLeaf(seg, r1, p, q, windowDrawn);
      if (r2 && (!best || r1.score + r2.score > best[0].score + best[1].score)) best = [r1, r2];
    }
    return best;
  };
  // one part of a gap (between pillars): a door (+ the sidelights next to it), a window / glass, or a passage
  const analysePart = (seg, p, q) => {
    const len = q - p;
    const sym = bandSymbol(ctx, seg.axis, seg.c, seg.t, p, q);
    const rows = Math.round(seg.t) + 2;
    const arc = len >= o.doorMin * ppm * 0.9 ? arcOf(seg, p, q) : null;
    const windowDrawn = sym.lines >= Math.max(3, 0.3 * rows);
    const double = (r1, r2) => {
      const [A, B] = r1.dirSign > 0 ? [r1, r2] : [r2, r1]; // A hinged at the start of the part, B at its end
      const d0 = Math.abs(A.h - p) < sideJamb ? p : A.h;
      const d1 = Math.abs(B.h - q) < sideJamb ? q : B.h;
      return { s0: d0, s1: d1, type: 'door', variant: 'double', hinge: 's0', side: A.side, leaf: A.rad, leaf2: B.rad, score: (A.score + B.score) / 2, symbol: { arc: Math.min(A.arc, B.arc), leaf: Math.min(A.leaf, B.leaf), lines: sym.lines, double: true } };
    };
    // no hinged door: a double door of two small leaves, a sliding door, a window / glass, or a passage
    const noDoor = () => {
      if (len >= 0.6 * ppm) {
        const d = smallDouble(seg, p, q, windowDrawn);
        if (d) return [double(d[0], d[1])];
      }
      const sl = len >= 0.6 * ppm && !sym.dashedOnly ? slidingLeaf(ctx, seg, p, q) : null;
      if (sl && slidingOk(sl, sym, len)) return [{ s0: p, s1: q, type: 'door', variant: 'sliding', hinge: sl.end ? 's1' : 's0', side: 0, leaf: sl.leaf, score: sl.share, symbol: { sliding: sl.rows, leaves: sl.leaves, lines: sym.lines, arc: arc?.arc ?? 0 } }];
      if (sym.lines >= 1) return [{ s0: p, s1: q, type: 'symbol', side: 0, score: sym.lines, symbol: { lines: sym.lines, arc: arc?.arc ?? 0 } }];
      if (len <= o.maxPlainOpening * ppm) return [{ s0: p, s1: q, type: 'opening', side: 0, score: 0, symbol: { lines: 0, arc: arc?.arc ?? 0, ...(sym.dashed ? { dashed: sym.dashed } : {}) } }];
      return [];
    };
    if (!arc || arc.arc < o.arcScore) return noDoor();
    // a weak arc over a drawn window (under 75 % drawn, or under 85 % with no leaf: a door band in some styles is drawn
    // like a window, hus8): furniture by the glass (an armchair, a shower tray, a dashed box) and stair winders sit
    // somewhere along it, a door fills its hole – it is a door only when nothing is left for a sidelight and its leaf
    // is drawn or most of the arc is; no double door from it. The same over any line in the band when no leaf is drawn
    // (a window whose glass the cleaner took: hus9, the flowers of a rug by it make the arc)
    const weakHere = weak(arc) && (windowDrawn || (sym.lines >= 1 && arc.leaf < 0.25));
    const r2 = weakHere ? null : secondLeaf(seg, arc, p, q, windowDrawn);
    if (r2) return [double(arc, r2)];
    const a = arc.dirSign > 0 ? arc.h : arc.h - arc.rad;
    const b = arc.dirSign > 0 ? arc.h + arc.rad : arc.h;
    // the door fills the part when the rest is too short for a sidelight (the frame is part of the hole)
    const d0 = Math.abs(a - p) < sideJamb ? p : a;
    const d1 = Math.abs(b - q) < sideJamb ? q : b;
    if (weakHere && !(d0 === p && d1 === q && (arc.arc >= 0.8 || arc.leaf >= 0.5))) return noDoor();
    const door = { s0: d0, s1: d1, type: 'door', variant: 'single', hinge: arc.dirSign > 0 ? 's0' : 's1', side: arc.side, leaf: arc.rad, score: arc.score, symbol: { arc: arc.arc, leaf: arc.leaf, lines: sym.lines } };
    if (weakHere) {
      // kept on probation: a stair found later around the arc's middle makes it the window it is drawn as (detectPlan);
      // it fills its part, so there are no sidelights to undo
      const mid = arc.h + (arc.dirSign * arc.rad) / Math.SQRT2;
      const off = seg.c + arc.side * (seg.t / 2 + arc.rad / Math.SQRT2);
      door.weak = { at: seg.axis === H ? [mid, off] : [off, mid], alt: noDoor() };
    }
    const ops = [door];
    for (const [x, y] of [[p, d0], [d1, q]]) {
      if (y - x >= minO * 0.8) {
        const s2 = bandSymbol(ctx, seg.axis, seg.c, seg.t, x, y);
        ops.push({ s0: x, s1: y, type: s2.lines ? 'symbol' : 'opening', side: 0, score: s2.lines, symbol: { lines: s2.lines } });
      }
    }
    return ops;
  };
  // the opening analysis of one gap; returns the openings in it (absolute along-coordinates) or null = not an opening.
  // Remembered per band and gap: the pair loop below starts over after every merge and meets the same gaps again
  const seen = new Map();
  const analyse = (seg, g0, g1) => {
    const key = `${seg.axis}|${seg.c.toFixed(1)}|${seg.t.toFixed(1)}|${g0.toFixed(1)}|${g1.toFixed(1)}`;
    if (!seen.has(key)) seen.set(key, analyseGap(seg, g0, g1));
    const res = seen.get(key);
    return res && { join: res.join, ops: res.ops.map((op) => ({ ...op })) };
  };
  const analyseGap = (seg, g0, g1) => {
    const gap = g1 - g0;
    const sym = bandSymbol(ctx, seg.axis, seg.c, seg.t, g0, g1);
    // the wall goes on (a dark piece the runs missed, or a thinner wall in the same line)
    if (sym.darkShare > 0.45 || sym.wallCols > 0.8) return { join: true, ops: [] };
    // a long gap drawn with dashes only (a beam between open zones): no opening, and a separator candidate – also where
    // its dashes are too fine for the thin-ink search (under ~45 px/m)
    if (sym.dashedOnly && gap > o.maxPlainOpening * ppm) ctx.dashGaps.push({ axis: seg.axis, c: seg.c, s0: g0, s1: g1 });
    // only a drawn glass wall / row of windows – or a wide sliding door (two leaves drawn from the jambs) – may be that
    // long
    if (gap > maxO && sym.lines < 1) {
      const sl = sym.dashedOnly ? null : slidingLeaf(ctx, seg, g0, g1);
      if (!(sl && sl.leaves === 2 && slidingOk(sl, sym, gap))) return null;
    }
    // an empty long gap is no opening – unless a door (an arc, a sliding leaf) is drawn in it, and the door fills it:
    // a door arc somewhere in a long empty stretch is furniture (a corner bath) near a wall end
    const longEmpty = sym.lines < 1 && gap > o.maxPlainOpening * ppm;
    if (longEmpty) {
      const arc = arcOf(seg, g0, g1);
      const sl = (!arc || arc.arc < o.arcScore) && !sym.dashedOnly ? slidingLeaf(ctx, seg, g0, g1) : null;
      if ((!arc || arc.arc < o.arcScore) && !(sl && slidingOk(sl, sym, gap))) return null;
    }
    const ops = [];
    for (const [p, q] of splitAtPillars(ctx, seg, g0, g1)) ops.push(...analysePart(seg, p, q));
    if (longEmpty) {
      const plain = ops.filter((op) => op.type === 'opening').reduce((s, op) => s + op.s1 - op.s0, 0);
      if (plain > 0.5 * o.maxPlainOpening * ppm) return null;
    }
    return { join: true, ops };
  };

  // an opening with nothing drawn in it – an empty gap, or a «sliding door» of one leaf line (1–2 rows) in an empty band
  // (the edge of a TV, a shelf or a bed cover beside the gap draws the same: hus9) – is no evidence of its own: it joins
  // only a piece that hangs on the wall network at its other end ((b), (c))
  const bare = (op) => (op.type === 'opening' && !(op.symbol?.lines > 0)) || (op.variant === 'sliding' && !(op.symbol?.lines > 0) && op.symbol?.leaves === 1 && op.symbol?.sliding < 3);
  // the band of P lies inside the band of Q (± tol)
  const inBand = (P, Q, tol) => P.c - P.t / 2 >= Q.c - Q.t / 2 - tol && P.c + P.t / 2 <= Q.c + Q.t / 2 + tol;
  // two pieces of one wall line that changes thickness: the thinner band inside the thicker, one face in line (an
  // exterior wall that goes on as an interior one past a joint)
  const flushPair = (A, B, tol) => {
    const [thin, thick] = A.t <= B.t ? [A, B] : [B, A];
    if (thin.t < 0.3 * thick.t || !inBand(thin, thick, tol)) return null;
    const lo = Math.abs(thin.c - thin.t / 2 - (thick.c - thick.t / 2));
    const hi = Math.abs(thin.c + thin.t / 2 - (thick.c + thick.t / 2));
    return Math.min(lo, hi) <= tol ? thin : null;
  };
  // (a) collinear pieces with a gap (or flush pieces of a wall line that changes thickness: the gap goes to the thinner)
  let merged = true;
  while (merged) {
    merged = false;
    outer: for (let i = 0; i < list.length; i++) {
      const A = list[i];
      for (let j = 0; j < list.length; j++) {
        if (i === j) continue;
        const B = list[j];
        if (A.axis !== B.axis) continue;
        const tc = Math.max(tolC * 1.5, 0.25 * Math.min(A.t, B.t));
        const collinear = Math.abs(A.c - B.c) <= tc && Math.abs(A.t - B.t) <= tolT * 1.5;
        const thin = collinear ? A : flushPair(A, B, tolC * 1.5);
        if (!thin) continue;
        const g0 = A.s1;
        const g1 = B.s0;
        const gap = g1 - g0;
        if (gap < 1 || gap > maxS) continue;
        // nothing crossing the gap
        if (list.some((p) => p.axis !== A.axis && p.c > g0 + 1 && p.c < g1 - 1 && p.s0 <= thin.c + thin.t / 2 && p.s1 >= thin.c - thin.t / 2)) continue;
        // the gap is the visible half of the same wall (a fixture box drawn over the other half): one wall, no opening
        const covered = gap >= minO && list.some((p) => p !== A && p !== B && p.axis === A.axis && p.t < thin.t && p.s0 <= g0 + tolJ && p.s1 >= g1 - tolJ && inBand(p, thin, tolC) && !!flushPair(p, thin, tolC * 1.5));
        // nothing collinear in between – but in a gap of a door or window size, a piece under half as thick inside the
        // band is something drawn in it (a sliding door's leaf drawn as a black bar, a window's frame line), not a wall:
        // the analysis decides
        const drawnIn = (p) => gap <= 1.1 * maxO && p.t < 0.45 * Math.min(A.t, B.t) && inBand(p, thin, tolC);
        if (!covered && list.some((p) => p !== A && p !== B && p.axis === A.axis && (Math.abs(p.c - A.c) <= tolC * 1.5 || (!collinear && Math.abs(p.c - B.c) <= tolC * 1.5)) && p.s1 > g0 + 1 && p.s0 < g1 - 1 && !drawnIn(p))) continue;
        if (gap < minO || covered) {
          // a tiny gap, or a covered one: one wall
        } else {
          const res = analyse(thin, g0, g1);
          if (!res) continue;
          for (const op of res.ops) openings.push({ ...op, seg: thin });
        }
        if (!collinear) {
          // flush pieces stay two walls that meet at the end of the gap; the thinner one spans the gap
          if (thin === B) B.s0 = g0;
          else A.s1 = g1;
          A.joints[1] = B;
          B.joints[0] = A;
          merged = true;
          break outer;
        }
        const la = A.s1 - A.s0;
        const lb = B.s1 - B.s0;
        A.c = (A.c * la + B.c * lb) / (la + lb);
        A.t = (A.t * la + B.t * lb) / (la + lb);
        A.s1 = B.s1;
        A.joints[1] = B.joints[1];
        for (const op of openings) if (op.seg === B) op.seg = A;
        list.splice(j, 1);
        merged = true;
        break outer;
      }
    }
  }

  // a thin piece inside the band and span of a thicker wall (the visible half of it beside a fixture box) is part of it,
  // and so is a line under half as thick on its face (a light grey wall's outline, a window's frame line: hus9)
  for (let i = list.length - 1; i >= 0; i--) {
    const P = list[i];
    if (list.some((Q) => Q !== P && Q.axis === P.axis && Q.t > P.t + 1 && Q.s0 <= P.s0 + tolJ && Q.s1 >= P.s1 - tolJ && inBand(P, Q, P.t < 0.5 * Q.t ? tolC + P.t / 2 : tolC))) list.splice(i, 1);
  }

  // collinear pieces of different thickness that meet end to end (a wall line that changes thickness): one joint
  for (const A of list) {
    for (const B of list) {
      if (A === B || A.axis !== B.axis || A.joints[1] || B.joints[0]) continue;
      const ov = Math.min(A.c + A.t / 2, B.c + B.t / 2) - Math.max(A.c - A.t / 2, B.c - B.t / 2);
      if (ov < 0.5 * Math.min(A.t, B.t) || Math.abs(B.s0 - A.s1) > Math.max(3, 0.1 * ppm)) continue;
      const m = (A.s1 + B.s0) / 2;
      A.s1 = m;
      B.s0 = m;
      A.joints[1] = B;
      B.joints[0] = A;
    }
  }

  // a piece hangs on the house's wall network when the pieces it touches (joints, collinear overlaps) add up to at
  // least minNetworkShare of the longest such network – the share the networks need to be kept (detectPlan, step 7) –
  // not on a frame of dark pieces that holds itself together (a rug's border, a desk: hus9) and would grow into the
  // house through an empty gap
  const onNetwork = (A) => {
    const id = new Map();
    const lens = [];
    for (const S of list) {
      if (id.has(S)) continue;
      const k = lens.length;
      lens.push(0);
      id.set(S, k);
      const stack = [S];
      while (stack.length) {
        const P = stack.pop();
        lens[k] += P.s1 - P.s0;
        for (const Q of list) {
          if (id.has(Q) || !touches(P, Q, tolJ + 1)) continue;
          id.set(Q, k);
          stack.push(Q);
        }
      }
    }
    return lens[id.get(A)] >= o.minNetworkShare * Math.max(...lens);
  };

  // (b) free ends that point at a perpendicular wall
  for (const A of list) {
    for (const [k, key, dir] of [[0, 's0', -1], [1, 's1', 1]]) {
      if (A.joints[k]) continue;
      const e = A[key];
      let best = null;
      for (const P of list) {
        if (P === A || P.axis === A.axis) continue;
        // P's band must cross A's line
        if (A.c < P.s0 - P.t / 2 || A.c > P.s1 + P.t / 2) continue;
        const face = P.c - dir * (P.t / 2);
        const d = (face - e) * dir;
        if (d < -1 || d > maxS) continue;
        if (!best || d < best.d) best = { P, d, face };
      }
      if (!best) continue;
      const { P, d, face } = best;
      // a collinear piece ahead (a thicker / thinner part of the same wall line) comes first: never run through it – one
      // that starts in P's band (the wall line going on past P) is not in the way
      const ahead = list.some((q) => {
        if (q === A || q.axis !== A.axis) return false;
        const ov = Math.min(q.c + q.t / 2, A.c + A.t / 2) - Math.max(q.c - q.t / 2, A.c - A.t / 2);
        if (ov < 0.5 * Math.min(q.t, A.t)) return false;
        const start = dir > 0 ? q.s0 : q.s1;
        const dd = (start - e) * dir;
        return dd > -2 && dd < d + P.t && !(dd >= d - 1 && Math.abs(start - P.c) <= P.t / 2 + 2);
      });
      if (ahead) continue;
      if (d <= o.joinGap * ppm) {
        A[key] = P.c;
        A.joints[k] = P;
        continue;
      }
      if (d < minO) continue;
      const g0 = dir > 0 ? e : face;
      const g1 = dir > 0 ? face : e;
      const res = analyse(A, g0, g1);
      if (!res) continue;
      // an empty gap (no lines, no arc) is a passage only for a piece that hangs on the wall network at its other end –
      // a free-standing dark block (a table) near a wall must not grow into a wall, nor a frame of them (a rug)
      const plain = res.ops.length > 0 && res.ops.every(bare);
      if (plain && !(A.joints[1 - k] && onNetwork(A))) continue;
      for (const op of res.ops) openings.push({ ...op, seg: A });
      A[key] = P.c;
      A.joints[k] = P;
    }
  }

  // (c) two free ends that point at the same corner (an L corner with a window on both sides: the post at the corner
  //     is too short to be a piece of its own): both run to the corner when both gaps are openings; an empty gap only
  //     for a piece that hangs on the wall network at its other end
  const ends = [[0, 's0', -1], [1, 's1', 1]];
  for (const A of list) {
    for (const [k, key, dir] of ends) {
      if (A.joints[k]) continue;
      let best = null;
      for (const Q of list) {
        if (Q === A || Q.axis === A.axis) continue;
        for (const [kq, keyq, dirq] of ends) {
          if (Q.joints[kq]) continue;
          const dA = (Q.c - A[key]) * dir; // from A's end to the corner, along A
          const dQ = (A.c - Q[keyq]) * dirq; // from Q's end to the corner, along Q
          if (dA < -1 || dQ < -1 || dA > maxS || dQ > maxS || dA + dQ < minO) continue;
          if (!best || dA + dQ < best.dA + best.dQ) best = { Q, kq, keyq, dirq, dA, dQ };
        }
      }
      if (!best) continue;
      const { Q, kq, keyq, dirq, dA, dQ } = best;
      // each gap runs from the free end to the face of the other wall's line at the corner
      const gapOf = (S, e, d, other, dist) => {
        if (dist < minO) return { join: true, ops: [] };
        const face = other.c - d * (other.t / 2);
        return analyse(S, Math.min(e, face), Math.max(e, face));
      };
      const resA = gapOf(A, A[key], dir, Q, dA);
      const resQ = resA && gapOf(Q, Q[keyq], dirq, A, dQ);
      if (!resA || !resQ) continue;
      const plainOf = (res) => res.ops.length > 0 && res.ops.every(bare);
      if ((plainOf(resA) && !(A.joints[1 - k] && onNetwork(A))) || (plainOf(resQ) && !(Q.joints[1 - kq] && onNetwork(Q)))) continue;
      for (const op of resA.ops) openings.push({ ...op, seg: A });
      for (const op of resQ.ops) openings.push({ ...op, seg: Q });
      A[key] = Q.c;
      Q[keyq] = A.c;
      A.joints[k] = Q;
      Q.joints[kq] = A;
    }
  }
  return list;
}

/**
 * The parts of a gap between pillars: columns across the band that are wall-dark over most of the wall's thickness
 * (the posts between two windows, a column beside a door). Parts shorter than 10 cm are dropped.
 */
function splitAtPillars(ctx, seg, g0, g1) {
  const { grey, isWall, ppm } = ctx;
  const a0 = Math.round(seg.c - seg.t / 2);
  const a1 = Math.round(seg.c + seg.t / 2) - 1;
  const n = a1 - a0 + 1;
  const parts = [];
  let start = g0;
  let inPillar = false;
  let pillarStart = 0;
  for (let s = Math.ceil(g0); s <= Math.floor(g1); s++) {
    let d = 0;
    for (let a = a0; a <= a1; a++) {
      const [x, y] = seg.axis === H ? [s, a] : [a, s];
      if (isWall(sample(grey, x, y))) d++;
    }
    const dark = n > 0 && d / n >= 0.7;
    if (dark && !inPillar) {
      inPillar = true;
      pillarStart = s;
    } else if (!dark && inPillar) {
      inPillar = false;
      if (s - pillarStart >= 2) {
        parts.push([start, pillarStart]);
        start = s;
      }
    }
  }
  if (inPillar && Math.floor(g1) - pillarStart >= 2) parts.push([start, pillarStart]);
  else parts.push([start, g1]);
  return parts.filter(([p, q]) => q - p >= 0.1 * ppm);
}

/**
 * Step 8, the symbols in the thin ink inside the building: skylights and stairs. Only the box of the paper the walls
 * enclose (outsideMask: its inner box, 30 cm round) is looked at – a symbol outside it is outside the building – so a
 * sheet with sections, facades or a garden round the plan costs little, and walls that enclose nothing cost nothing. The ink is the cores of the thin lines, 80 grey levels under the paper: a
 * light grey outline with antialiasing gaps is not a dashed line, and a halo does not join neighbouring strokes. Below
 * 70 px/m of the original a 1 px line is antialiased over two lighter pixels: 55 levels for the dashes, and for the
 * treads (drawn lighter still, often on a grey filled stair) 30 levels under the local background – 20 under 40 px/m,
 * where a JPEG estate-agent plan draws its treads 20–35 levels under the paper (hus8).
 * @returns {{ skylights, stairs, thin, stairInk, box }}  pixels of the image; thin / stairInk: rasters of the box
 */
function findSymbols(grey, core, outside, paper, ppm, scaled) {
  if (!outside.inner) return { skylights: [], stairs: [], thin: null, stairInk: null, box: null };
  const [bx0, by0, bx1, by1] = outside.inner;
  const pad = Math.max(4, 0.3 * ppm);
  const x0 = Math.max(0, Math.floor(bx0 - pad));
  const y0 = Math.max(0, Math.floor(by0 - pad));
  const x1 = Math.min(grey.w - 1, Math.ceil(bx1 + pad));
  const y1 = Math.min(grey.h - 1, Math.ceil(by1 + pad));
  if (x1 - x0 < 4 || y1 - y0 < 4) return { skylights: [], stairs: [], thin: null, stairInk: null, box: null };
  const crop = (m) => {
    const out = raster(x1 - x0 + 1, y1 - y0 + 1, m.data.constructor);
    for (let y = y0; y <= y1; y++) out.data.set(m.data.subarray(y * m.w + x0, y * m.w + x1 + 1), (y - y0) * out.w);
    return out;
  };
  const g = crop(grey);
  const c = crop(core);
  // not in a room: outside, or on a wall's band (a fan's point or a flight's middle on a wall is not a stair)
  const out = crop(outside);
  const wall = crop(outside.block);
  for (let i = 0; i < out.data.length; i++) out.data[i] |= wall.data[i];
  const r2 = Math.max(1, Math.round(0.02 * ppm));
  const fine = ppm / scaled >= 70;
  const thin = thinInk(g, c, paper, r2, fine ? 80 : 55);
  const skylights = findSkylights(thin, c, out, ppm).map((b) => ({ ...b, x0: b.x0 + x0, y0: b.y0 + y0, x1: b.x1 + x0, y1: b.y1 + y0 }));
  const stairInk = fine ? thin : localInk(g, c, r2, Math.max(3, Math.round(0.05 * ppm)), ppm / scaled < 40 ? 20 : 30);
  const stairs = findStairs(stairInk, c, out, ppm, scaled).map((st) => moveStair(st, x0, y0));
  return { skylights, stairs, thin, stairInk, box: [x0, y0, x1, y1] };
}

/** A raster of a box [x0, y0, x1, y1] back in an image of w × h (for the debug images). */
function uncrop(m, box, w, h) {
  const full = raster(w, h);
  if (!m) return full;
  for (let y = 0; y < m.h; y++) full.data.set(m.data.subarray(y * m.w, (y + 1) * m.w), (y + box[1]) * w + box[0]);
  return full;
}

/**
 * The thin ink of a plan: pixels darker than the paper by margin that are not wall (the wall core grown by r) and not
 * part of a filled shape (a grey sofa, a worktop: what survives an opening by r + 1) – symbols, furniture outlines,
 * treads, dashed lines, text. A larger margin keeps only the cores of the lines.
 */
function thinInk(grey, core, paper, r, margin = 40) {
  const grown = dilate(core, r);
  const t = Math.min(paper - margin, 255 - margin);
  const out = raster(grey.w, grey.h);
  for (let i = 0; i < out.data.length; i++) out.data[i] = grey.data[i] < t && !grown.data[i] ? 1 : 0;
  const filled = dilate(open(out, r + 1), 1);
  for (let i = 0; i < out.data.length; i++) if (filled.data[i]) out.data[i] = 0;
  return out;
}

/**
 * Dashed lines of one axis in a mask: per row ('h') or column ('v') chains of at least two short ink runs (dashes of
 * 1.5–35 cm, gaps of 1.5–20 cm, longer solid runs ending the chain); a dash must be a THIN line, with no ink 3–4 px to
 * both sides across it over most of its length (the top row of a word is not a dashed line); chains in neighbouring
 * rows that overlap are one line. @returns {{ axis, c, s0, s1, dashes }[]}  pixels; c across, s0 … s1 along
 */
function dashedLines(mask, axis, ppm, minLen) {
  const { w, h } = mask;
  const n = axis === H ? w : h;
  const lines = axis === H ? h : w;
  const dMin = Math.max(1, 0.015 * ppm);
  const dMax = Math.max(4, 0.35 * ppm);
  const gMin = Math.max(1, 0.015 * ppm);
  const gMax = Math.max(3, 0.2 * ppm);
  const off = Math.max(3, Math.round(0.035 * ppm));
  const at = (l, i) => (l < 0 || l >= lines ? 0 : mask.data[axis === H ? l * w + i : i * w + l]);
  const thin = (l, r) => {
    let clear = 0;
    for (let i = r[0]; i <= r[1]; i++) if (!at(l - off, i) && !at(l + off, i) && !at(l - off - 1, i) && !at(l + off + 1, i)) clear++;
    return clear >= 0.7 * (r[1] - r[0] + 1);
  };
  const joined = (l, r) => {
    for (const i of [r[0] - 1, r[0], r[1], r[1] + 1]) {
      for (let k = 3; k <= off + 1; k++) if (at(l - k, i) || at(l + k, i)) return true;
    }
    return false;
  };
  const raw = [];
  for (let l = 0; l < lines; l++) {
    const runs = [];
    let start = -1;
    for (let i = 0; i <= n; i++) {
      const on = i < n && at(l, i);
      if (on && start < 0) start = i;
      else if (!on && start >= 0) {
        runs.push([start, i - 1]);
        start = -1;
      }
    }
    let chain = [];
    // a chain is split at a dash inside it with a stroke leaving one of its ends across the line: only the corners of
    // a drawn box have that, while the strokes of a word (the top of an R, the bar of a T) are joined all along
    const push = (part) => {
      if (part.length >= 2 && part[part.length - 1][1] - part[0][0] + 1 >= minLen) raw.push({ c: l, s0: part[0][0], s1: part[part.length - 1][1] + 1, dashes: part.length });
    };
    const flush = () => {
      let from = 0;
      for (let k = 1; k < chain.length - 1; k++) {
        if (!joined(l, chain[k])) continue;
        push(chain.slice(from, k + 1));
        from = k;
      }
      push(chain.slice(from));
      chain = [];
    };
    for (const r of runs) {
      const len = r[1] - r[0] + 1;
      const okDash = len >= dMin && len <= dMax && thin(l, r);
      if (chain.length) {
        const gap = r[0] - chain[chain.length - 1][1] - 1;
        if (!okDash || gap < gMin || gap > gMax) flush();
      }
      if (okDash) chain.push(r);
    }
    flush();
  }
  // neighbouring rows (a dashed line 1–3 px wide) → one line
  raw.sort((a, b) => a.c - b.c || a.s0 - b.s0);
  const out = [];
  for (const r of raw) {
    const m = out.find((x) => r.c - x.c1 <= 1.5 && Math.min(x.s1, r.s1) - Math.max(x.s0, r.s0) > 0.5 * Math.min(x.s1 - x.s0, r.s1 - r.s0));
    if (m) {
      m.c1 = r.c;
      m.sum += r.c;
      m.k++;
      m.s0 = Math.min(m.s0, r.s0);
      m.s1 = Math.max(m.s1, r.s1);
      m.dashes = Math.max(m.dashes, r.dashes);
    } else out.push({ axis, c0: r.c, c1: r.c, sum: r.c, k: 1, s0: r.s0, s1: r.s1, dashes: r.dashes });
  }
  return out.filter((x) => x.c1 - x.c0 <= Math.max(3, 0.04 * ppm)).map((x) => ({ axis, c: x.sum / x.k + 0.5, s0: x.s0, s1: x.s1, dashes: x.dashes }));
}

/**
 * Skylights (roof windows, «Takvindu»): dashed rectangles inside the building, 0.5–1.5 m by 0.6–1.8 m, with at least
 * three of their four sides drawn dashed (furniture under one side may hide it). Two parallel dashed lines of about the
 * same length and a dashed line across their ends make a candidate; it must be inside the building, clear of walls
 * and not against one (10 cm). @returns {{ x0, y0, x1, y1, sides, score }[]}  pixels
 */
function findSkylights(thin, core, outside, ppm) {
  const minSide = 0.3 * ppm;
  const L = { h: dashedLines(thin, H, ppm, minSide), v: dashedLines(thin, V, ppm, minSide) };
  const tol = Math.max(3, 0.04 * ppm);
  const found = [];
  for (const axis of [V, H]) {
    const other = axis === V ? H : V;
    const list = L[axis];
    for (let i = 0; i < list.length; i++) {
      for (let j = 0; j < list.length; j++) {
        const A = list[i];
        const B = list[j];
        const span = B.c - A.c; // across: the rectangle's side perpendicular to A and B
        if (span < 0.4 * ppm || span > 1.5 * ppm) continue;
        const lo = Math.max(A.s0, B.s0);
        const hi = Math.min(A.s1, B.s1);
        const la = A.s1 - A.s0;
        const lb = B.s1 - B.s0;
        if (hi - lo < 0.6 * Math.min(la, lb) || Math.min(la, lb) < 0.6 * Math.max(la, lb)) continue;
        const s0 = Math.min(A.s0, B.s0);
        const s1 = Math.max(A.s1, B.s1);
        const len = s1 - s0;
        if (len > 1.8 * ppm || Math.max(len, span) < 0.6 * ppm || Math.min(len, span) < 0.5 * ppm) continue;
        // the ends: dashed lines across, between A and B
        const across = (s) => L[other].filter((q) => Math.abs(q.c - s) <= tol && Math.min(q.s1, B.c) - Math.max(q.s0, A.c) >= 0.5 * span).reduce((m, q) => Math.max(m, q.dashes), 0);
        const ends = [across(s0), across(s1)];
        const sides = 2 + ends.filter(Boolean).length;
        // three sides at least, and enough dashes for a drawn box (a word's strokes do not line up that often)
        if (sides < 3 || A.dashes + B.dashes + ends[0] + ends[1] < 8) continue;
        const [x0, y0, x1, y1] = axis === V ? [A.c, s0, B.c, s1] : [s0, A.c, s1, B.c];
        found.push({ x0, y0, x1, y1, sides, score: sides / 4 });
      }
    }
  }
  // inside the building, clear of walls and not against one (a dashed bath, shower or worktop stands at a wall, a roof
  // window lies in the slope); overlapping candidates (the same box found from both axes) → the best one
  const at = (m, x, y) => {
    const xi = Math.round(x);
    const yi = Math.round(y);
    return xi >= 0 && yi >= 0 && xi < m.w && yi < m.h && m.data[yi * m.w + xi] === 1;
  };
  const gap = Math.max(3, 0.1 * ppm);
  const against = (b) => {
    const sides = [
      (k) => [b.x0 - gap, b.y0 + (b.y1 - b.y0) * k],
      (k) => [b.x1 + gap, b.y0 + (b.y1 - b.y0) * k],
      (k) => [b.x0 + (b.x1 - b.x0) * k, b.y0 - gap],
      (k) => [b.x0 + (b.x1 - b.x0) * k, b.y1 + gap],
    ];
    return sides.some((P) => {
      let hits = 0;
      for (let k = 1; k <= 9; k++) if (at(core, ...P(k / 10))) hits++;
      return hits >= 5;
    });
  };
  const ok = found.filter((b) => {
    const cx = (b.x0 + b.x1) / 2;
    const cy = (b.y0 + b.y1) / 2;
    if (at(outside, cx, cy) || against(b)) return false;
    for (let k = 0; k <= 8; k++) {
      for (let m = 0; m <= 8; m++) if (at(core, b.x0 + ((b.x1 - b.x0) * k) / 8, b.y0 + ((b.y1 - b.y0) * m) / 8)) return false;
    }
    return true;
  });
  ok.sort((a, b) => b.score - a.score || (b.x1 - b.x0) * (b.y1 - b.y0) - (a.x1 - a.x0) * (a.y1 - a.y0));
  const out = [];
  for (const b of ok) {
    const dup = out.some((q) => {
      const ix = Math.min(q.x1, b.x1) - Math.max(q.x0, b.x0);
      const iy = Math.min(q.y1, b.y1) - Math.max(q.y0, b.y0);
      return ix > 0 && iy > 0 && ix * iy > 0.3 * Math.min((q.x1 - q.x0) * (q.y1 - q.y0), (b.x1 - b.x0) * (b.y1 - b.y0));
    });
    if (!dup) out.push(b);
  }
  return out;
}

/**
 * Room separators: the dashed or dash-dot lines that close an open zone between two wall ends – a beam or a floor edge
 * drawn from the end of one wall to the end of another (hus4: the hall and the TV room) – one line, or two parallel
 * lines as far apart as a wall (the beam's two edges), as one. They split rooms (regions.js findRooms, option
 * separators) and are never walls. A line is one when it lies inside the building, crosses no wall, does not run
 * along one, and BOTH its ends meet a wall end within 30 cm: the end of a wall in its line (it continues that wall,
 * also past a corner) or the end of a wall across it that does not go on past the line (a post, the start of a wall).
 * A line with an end on the face of a wall that runs through – a section line, a beam over a room, a roof edge over a
 * corridor, a stair's hidden flight – is not one, nor is the front of a niche (a wardrobe: under 1 m deep).
 * @param {object|null} thin  the thin ink of the box (findSymbols)
 * @param {number[]|null} box  [x0, y0, x1, y1] of that raster in the image
 * @param {object[]} walls  the wall lines { axis, c, s0, s1, t } (pixels)
 * @param {{ gaps?: object[] }} opts  gaps: the gaps in a wall line drawn with dashes only that joinGaps left open
 *   ({ axis, c, s0, s1 }, pixels) – candidates too, for a dash-dot line finer than the thin ink resolves (under ~45 px/m)
 * @returns {{ separators: { a: [x, y], b: [x, y] }[], tried }}  pixels, a → b along +x / +y; tried: every line looked
 *   at, { axis, c, s0, s1, why } (why = 'ok', or the reason it is none: 'start' | 'end' | 'ends' (no wall end there) |
 *   'short' | 'crosses' | 'along' | 'outside' | 'niche' (less than 1 m of floor on one side)), for the debug image
 */
function findSeparators(thin, box, walls, outside, ppm, { tolC, tolJ, maxWallPx, gaps = [] }) {
  if (!thin || !box) return { separators: [], tried: [] };
  const minLen = 0.8 * ppm;
  const reach = 0.3 * ppm;
  const minDepth = 1.0 * ppm;
  // how far a line may run on into the wall end it meets (its last dash drawn over a post)
  const over = 0.15 * ppm;
  const tol = tolJ + 1;
  const raw = [];
  for (const axis of [H, V]) {
    const [dc, ds] = axis === H ? [box[1], box[0]] : [box[0], box[1]];
    for (const l of dashedLines(thin, axis, ppm, minLen)) if (l.dashes >= 4) raw.push({ axis, c: l.c + dc, s0: l.s0 + ds, s1: l.s1 + ds });
  }
  // the two edges of a beam (parallel, at most a wall's thickness apart, over the same stretch) → their middle line
  const lines = [];
  const used = new Set();
  raw.sort((p, q) => p.c - q.c);
  for (let i = 0; i < raw.length; i++) {
    if (used.has(i)) continue;
    const L = { ...raw[i] };
    for (let j = i + 1; j < raw.length; j++) {
      const Q = raw[j];
      if (used.has(j) || Q.axis !== L.axis || Q.c - L.c > maxWallPx) continue;
      const ov = Math.min(L.s1, Q.s1) - Math.max(L.s0, Q.s0);
      if (ov < 0.7 * Math.min(L.s1 - L.s0, Q.s1 - Q.s0)) continue;
      L.c = (L.c + Q.c) / 2;
      L.s0 = Math.min(L.s0, Q.s0);
      L.s1 = Math.max(L.s1, Q.s1);
      used.add(j);
      break;
    }
    lines.push(L);
  }
  // the dashed gaps no line found here covers
  for (const G of gaps) {
    const covered = lines.some((L) => L.axis === G.axis && Math.abs(L.c - G.c) <= maxWallPx / 2 + tolC && Math.min(L.s1, G.s1) - Math.max(L.s0, G.s0) >= 0.7 * (G.s1 - G.s0));
    if (!covered) lines.push({ axis: G.axis, c: G.c, s0: G.s0, s1: G.s1 });
  }
  // the wall line of W goes on past its end (another wall in its line starts there): W's end is no wall end
  const goesOn = (W, key) => {
    const e = W[key];
    const dir = key === 's1' ? 1 : -1;
    return walls.some((X) => X !== W && X.axis === W.axis && Math.abs(X.c - W.c) <= Math.max(X.t, W.t) / 2 + tolC && (dir > 0 ? X.s1 > e + tol && X.s0 <= e + tol : X.s0 < e - tol && X.s1 >= e - tol));
  };
  // where an end of the line (at s, going outward by dir) meets a wall end: the snapped end, or null. A wall end is the
  // end of a wall in the line (the line continues it; a corner there is fine) or the end of a wall across the line
  // that does not go on past it (a post, a wall that starts there) – not the face of a wall that runs through
  const endAt = (L, s, dir) => {
    let best = null;
    for (const W of walls) {
      if (W.axis === L.axis) {
        if (Math.abs(W.c - L.c) > W.t / 2 + tolC) continue;
        const key = dir > 0 ? 's0' : 's1';
        const d = (W[key] - s) * dir;
        if (d < -over - W.t || d > reach) continue;
        if (!best || Math.abs(d) < best.d) best = { s: W[key], d: Math.abs(d), W, key, inLine: true };
      } else {
        const d = (W.c - s) * dir;
        if (d < -over - W.t / 2 || d > reach) continue;
        for (const key of ['s0', 's1']) {
          if (Math.abs(W[key] - L.c) > W.t / 2 + tol + 0.05 * ppm || goesOn(W, key)) continue;
          if (!best || Math.abs(d) < best.d) best = { s: W.c, d: Math.abs(d), W, key, inLine: false };
        }
      }
    }
    return best;
  };
  const at = (m, x, y) => {
    const xi = Math.round(x);
    const yi = Math.round(y);
    return xi >= 0 && yi >= 0 && xi < m.w && yi < m.h && m.data[yi * m.w + xi] === 1;
  };
  const out = [];
  const tried = [];
  for (const L of lines) {
    const why = (() => {
      const e0 = endAt(L, L.s0, -1);
      const e1 = endAt(L, L.s1, 1);
      if (!e0 || !e1) return !e0 && !e1 ? 'ends' : !e0 ? 'start' : 'end';
      const s0 = e0.s;
      const s1 = e1.s;
      const len = s1 - s0;
      if (len < minLen) return 'short';
      // the line of the wall it continues (a beam drawn along the wall's faces lies on its centre line)
      const c = e0.inLine ? e0.W.c : e1.inLine ? e1.W.c : L.c;
      // no wall across it in between, none along it
      if (walls.some((W) => W.axis !== L.axis && W.c > s0 + W.t / 2 + tol && W.c < s1 - W.t / 2 - tol && W.s0 - tol <= c && W.s1 + tol >= c)) return 'crosses';
      if (walls.some((W) => W.axis === L.axis && Math.abs(W.c - c) < 0.5 * ppm && Math.min(W.s1, s1) - Math.max(W.s0, s0) > 0.2 * len)) return 'along';
      // inside the building
      const mid = (s0 + s1) / 2;
      if (L.axis === H ? at(outside, mid, c) : at(outside, c, mid)) return 'outside';
      // a zone on each side, not a niche (the front of a wardrobe, a shelf): free floor 1 m deep both ways at two of
      // its quarter points
      const deep = (q, side) => {
        for (let k = 0.05 * ppm; k <= minDepth; k += 0.05 * ppm) {
          const [x, y] = L.axis === H ? [q, c + side * k] : [c + side * k, q];
          if (at(outside, x, y) || at(outside.block, x, y)) return false;
        }
        return true;
      };
      if ([0.25, 0.5, 0.75].filter((f) => { const q = s0 + f * len; return deep(q, 1) && deep(q, -1); }).length < 2) return 'niche';
      const a = L.axis === H ? [s0, c] : [c, s0];
      const b = L.axis === H ? [s1, c] : [c, s1];
      if (out.some((q) => Math.hypot(q.a[0] - a[0], q.a[1] - a[1]) < 0.2 * ppm && Math.hypot(q.b[0] - b[0], q.b[1] - b[1]) < 0.2 * ppm)) return 'ok';
      out.push({ a, b });
      // a wall across that stops short of the line (its post is drawn up to it) reaches it, so the rooms close
      for (const e of [e0, e1]) if (!e.inLine) e.W[e.key] = c;
      return 'ok';
    })();
    tried.push({ axis: L.axis, c: L.c, s0: L.s0, s1: L.s1, why });
  }
  return { separators: out, tried };
}

/**
 * Thin ink against the local background instead of the paper: pixels at least margin darker than the lightest pixel
 * within rb (a separable max filter), not wall – a tread drawn light grey on a grey filled stair counts, and a filled
 * shape wider than 2·rb is its own background. For the stairs of a low-resolution plan.
 */
function localInk(grey, core, r, rb, margin) {
  const { w, h } = grey;
  const grown = dilate(core, r);
  const tmp = new Uint8Array(w * h);
  const bg = new Uint8Array(w * h);
  const g = grey.data;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      let m = 0;
      const k1 = Math.min(w - 1, x + rb);
      for (let k = Math.max(0, x - rb); k <= k1; k++) if (g[row + k] > m) m = g[row + k];
      tmp[row + x] = m;
    }
  }
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      let m = 0;
      const k1 = Math.min(h - 1, y + rb);
      for (let k = Math.max(0, y - rb); k <= k1; k++) if (tmp[k * w + x] > m) m = tmp[k * w + x];
      bg[y * w + x] = m;
    }
  }
  const out = raster(w, h);
  for (let i = 0; i < out.data.length; i++) out.data[i] = bg[i] - g[i] >= margin && !grown.data[i] ? 1 : 0;
  return out;
}

/** A detected stair moved by (dx, dy) (a box of the image back to the image). */
function moveStair(st, dx, dy) {
  return { ...st, bbox: [st.bbox[0] + dx, st.bbox[1] + dy, st.bbox[2] + dx, st.bbox[3] + dy], lines: st.lines.map((l) => l.map((p) => [p[0] + dx, p[1] + dy])), ...(st.pivot ? { pivot: [st.pivot[0] + dx, st.pivot[1] + dy] } : {}) };
}

/** A detected stair scaled by k (the upsampled copy back to the image). */
function scaleStair(st, k) {
  return { ...st, bbox: st.bbox.map((v) => v * k), lines: (st.lines || []).map((l) => l.map((p) => [p[0] * k, p[1] * k])), ...(st.pivot ? { pivot: [st.pivot[0] * k, st.pivot[1] * k] } : {}) };
}

/**
 * Solid thin lines of one axis in a mask: per row ('h') or column ('v') runs of ink (breaks up to 2 cm bridged) that
 * are THIN – no ink 3–4 px to both sides across over most of the run (a tread, not the edge of a filled shape or a
 * word) –; runs in neighbouring rows that overlap are one line. One scan of the mask for several length ranges: each
 * [minLen, maxLen] gets the lines of the runs in it.
 * @returns {{ axis, c, s0, s1 }[][]}  per range; pixels, c across, s0 … s1 along
 */
function solidLines(mask, axis, ppm, ranges) {
  const minLen = Math.min(...ranges.map((r) => r[0]));
  const { w, h } = mask;
  const n = axis === H ? w : h;
  const lines = axis === H ? h : w;
  const bridge = Math.max(2, Math.round(0.02 * ppm));
  const off = Math.max(3, Math.round(0.035 * ppm));
  const at = (l, i) => (l < 0 || l >= lines ? 0 : mask.data[axis === H ? l * w + i : i * w + l]);
  const raw = [];
  for (let l = 0; l < lines; l++) {
    let start = -1;
    let last = -1e9;
    const flush = () => {
      if (start < 0) return;
      const len = last - start + 1;
      if (len >= minLen) {
        let clear = 0;
        for (let i = start; i <= last; i++) if (!at(l - off, i) && !at(l + off, i)) clear++;
        if (clear >= 0.7 * len) raw.push({ c: l, s0: start, s1: last + 1, len });
      }
      start = -1;
    };
    for (let i = 0; i < n; i++) {
      if (!at(l, i)) continue;
      if (start >= 0 && i - last > bridge + 1) flush();
      if (start < 0) start = i;
      last = i;
    }
    flush();
  }
  raw.sort((a, b) => a.c - b.c || a.s0 - b.s0);
  return ranges.map(([lo, hi = Infinity]) => {
    const out = [];
    for (const r of raw) {
      if (r.len < lo || r.len > hi) continue;
      const m = out.find((x) => r.c - x.c1 <= 1.5 && Math.min(x.s1, r.s1) - Math.max(x.s0, r.s0) > 0.7 * Math.min(x.s1 - x.s0, r.s1 - r.s0));
      if (m) {
        m.c1 = r.c;
        m.sum += r.c;
        m.k++;
        m.s0 = Math.min(m.s0, r.s0);
        m.s1 = Math.max(m.s1, r.s1);
      } else out.push({ c0: r.c, c1: r.c, sum: r.c, k: 1, s0: r.s0, s1: r.s1 });
    }
    return out.filter((x) => x.c1 - x.c0 <= Math.max(3, 0.04 * ppm)).map((x) => ({ axis, c: x.sum / x.k + 0.5, s0: x.s0, s1: x.s1 }));
  });
}

/**
 * The segments of a rectangle (localSegments) drawn as lines, and the broken ones that are not one of those: dashed,
 * or a 1 px line at a slant aliased into dots (hus6) – breaks up to 8 cm bridged, 40 % on ink.
 */
function allSegments(mask, rect, minLen, ppm) {
  const segs = localSegments(mask, rect, minLen);
  for (const d of localSegments(mask, rect, minLen, { maxBreak: Math.max(4, Math.round(0.08 * ppm)), minHit: 0.4 })) {
    const mid = [(d.a[0] + d.b[0]) / 2, (d.a[1] + d.b[1]) / 2];
    const same = segs.some((q) => {
      let dt = Math.abs(q.theta - d.theta);
      dt = Math.min(dt, 180 - dt);
      const qd = [q.b[0] - q.a[0], q.b[1] - q.a[1]];
      const off = Math.abs((mid[0] - q.a[0]) * qd[1] - (mid[1] - q.a[1]) * qd[0]) / Math.hypot(qd[0], qd[1]);
      return dt <= 4 && off <= 3;
    });
    if (!same) segs.push(d);
  }
  return segs;
}

/**
 * Straight thin segments of any direction inside a rectangle of a mask: a small Hough transform (1° × 1 px) of the
 * ink in it, the local maxima with at least minLen votes, each followed through the rectangle (ink within 1 px across,
 * breaks up to maxBreak − 1 px bridged, minHit of it on ink: 2 px and 85 % for drawn lines, more for dashed ones);
 * near-duplicates (the same stroke from neighbouring peaks) are dropped.
 * @returns {{ a: [x, y], b: [x, y], theta: number, len: number }[]}  theta: the normal's angle 0…179°, pixels
 */
function localSegments(mask, rect, minLen, { maxBreak = 3, minHit = 0.85 } = {}) {
  const x0 = Math.max(0, Math.floor(rect[0]));
  const y0 = Math.max(0, Math.floor(rect[1]));
  const x1 = Math.min(mask.w - 1, Math.ceil(rect[2]));
  const y1 = Math.min(mask.h - 1, Math.ceil(rect[3]));
  if (x1 - x0 < 4 || y1 - y0 < 4) return [];
  const nT = 180;
  const cs = new Float64Array(nT);
  const sn = new Float64Array(nT);
  for (let t = 0; t < nT; t++) {
    cs[t] = Math.cos((t * Math.PI) / 180);
    sn[t] = Math.sin((t * Math.PI) / 180);
  }
  const W = x1 - x0 + 1;
  const Hh = y1 - y0 + 1;
  const R = Math.ceil(Math.hypot(W, Hh)) + 1;
  const nR = 2 * R + 1;
  const acc = new Uint32Array(nT * nR);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (!mask.data[y * mask.w + x]) continue;
      for (let t = 0; t < nT; t++) acc[t * nR + Math.round((x - x0) * cs[t] + (y - y0) * sn[t]) + R]++;
    }
  }
  const minVotes = Math.max(6, Math.round(minLen * 0.8));
  const peaks = [];
  for (let t = 0; t < nT; t++) {
    for (let r = 2; r < nR - 2; r++) {
      const v = acc[t * nR + r];
      if (v < minVotes) continue;
      let max = true;
      for (let dt = -1; dt <= 1 && max; dt++) {
        if (t + dt < 0 || t + dt >= nT) continue;
        for (let dr = -2; dr <= 2; dr++) {
          if (!dt && !dr) continue;
          const u = acc[(t + dt) * nR + r + dr];
          if (u > v || (u === v && (dt < 0 || (!dt && dr < 0)))) {
            max = false;
            break;
          }
        }
      }
      if (max) peaks.push([v, t, r - R]);
    }
  }
  peaks.sort((a, b) => b[0] - a[0]);
  const on = (x, y) => {
    const xi = Math.round(x);
    const yi = Math.round(y);
    return xi >= x0 && yi >= y0 && xi <= x1 && yi <= y1 && mask.data[yi * mask.w + xi] === 1;
  };
  const out = [];
  for (const [, t, rho] of peaks.slice(0, 400)) {
    const n = [cs[t], sn[t]];
    const d = [-sn[t], cs[t]];
    const p0 = [x0 + rho * n[0], y0 + rho * n[1]];
    let start = null;
    let last = null;
    let hits = 0;
    const found = [];
    const flush = () => {
      if (start !== null && last - start >= minLen && hits >= minHit * (last - start + 1)) found.push([start, last]);
      start = null;
      hits = 0;
    };
    for (let s = -R; s <= R; s++) {
      const x = p0[0] + d[0] * s;
      const y = p0[1] + d[1] * s;
      if (x < x0 - 1 || y < y0 - 1 || x > x1 + 1 || y > y1 + 1) continue;
      if (on(x, y) || on(x + n[0], y + n[1]) || on(x - n[0], y - n[1])) {
        if (start !== null && s - last > maxBreak) flush();
        if (start === null) start = s;
        last = s;
        hits++;
      }
    }
    flush();
    for (const [a, b] of found) {
      const seg = { a: [p0[0] + d[0] * a, p0[1] + d[1] * a], b: [p0[0] + d[0] * b, p0[1] + d[1] * b], theta: t, len: b - a };
      const mid = [(seg.a[0] + seg.b[0]) / 2, (seg.a[1] + seg.b[1]) / 2];
      const dupe = out.some((q) => {
        let dt = Math.abs(q.theta - t);
        dt = Math.min(dt, 180 - dt);
        if (dt > 4) return false;
        const qd = [q.b[0] - q.a[0], q.b[1] - q.a[1]];
        const off = Math.abs((mid[0] - q.a[0]) * qd[1] - (mid[1] - q.a[1]) * qd[0]) / Math.hypot(qd[0], qd[1]);
        const u = ((mid[0] - q.a[0]) * qd[0] + (mid[1] - q.a[1]) * qd[1]) / (qd[0] ** 2 + qd[1] ** 2);
        return off <= 3 && u > -0.2 && u < 1.2;
      });
      if (!dupe) out.push(seg);
    }
  }
  return out;
}

/**
 * Stairs: flights of evenly spaced parallel thin lines along the plan's axes (the treads: 60–170 cm long – the shelves
 * of a closet are shorter –, 14–40 cm apart (within 30 % or two pixels of the original image), at least three, up to
 * two lines missing under furniture, no line of the same extent between them – that is hatching – and no grid across
 * them – that is tiles), followed on in treads the line search missed (extendFlight: dashed or broken ones); and fans
 * of winders next to a flight's end (at least four thin lines in four directions whose extensions meet in one point
 * near their inner ends – the newel, the inner corner –, two of them reaching most of the way across the flight, or
 * three that all do; the point at a side of the flight, the turn 200° at most); flights and fans that touch are one
 * stair, and so is a fan with the flight it was found beside. A lone flight needs five lines, flights of three lines
 * need winders.
 * kind: two parallel flights side by side → 'half-turn'; two flights at right angles → 'quarter-turn'; else a fan of
 * 150° or more → 'half-turn', a smaller fan → 'quarter-turn'; one flight (or flights one after the other) →
 * 'straight' ('unknown' is never given). axis: the run of the longest flight ('x' | 'y', as
 * model.js stairs); treads: the tread lines plus the winder lines.
 * @returns {{ bbox: [x0, y0, x1, y1], axis, treads, kind, flights, winders, lines, pivot? }[]}  pixels
 */
function findStairs(thin, core, outside, ppm, scaled = 1) {
  const inside = (p) => {
    const xi = Math.round(p[0]);
    const yi = Math.round(p[1]);
    return xi >= 0 && yi >= 0 && xi < outside.w && yi < outside.h && !outside.data[yi * outside.w + xi];
  };
  // the treads (60–170 cm) and every long line (40 cm or more, for the tile test), one scan per axis
  const treadsOf = {};
  const longOf = {};
  for (const axis of [H, V]) [treadsOf[axis], longOf[axis]] = solidLines(thin, axis, ppm, [[0.6 * ppm, 1.7 * ppm], [0.4 * ppm]]);
  const tolS = Math.max(3, 0.1 * ppm);
  const dup = Math.max(3, 0.04 * ppm);
  // a step agrees within 30 %, or two pixels of the original image (an upsampled plan's lines lie on its pixel grid)
  const tolStep = (st) => Math.max(0.3 * st, 2 * scaled);
  const flights = [];
  for (const axis of [H, V]) {
    const items = [...treadsOf[axis]].sort((p, q) => p.c - q.c);
    const used = new Set();
    for (let i = 0; i < items.length; i++) {
      if (used.has(items[i])) continue;
      const chain = [items[i]];
      let step = null;
      let dense = false;
      let missed = 0;
      for (let j = i + 1; j < items.length; j++) {
        const q = items[j];
        const gap = q.c - chain[chain.length - 1].c;
        if (gap > (step ? 2.4 * step : 0.45 * ppm)) break;
        // the same extent as the first line or the last one: both ends in line, or one end (at a stringer) and most of
        // the length (furniture or a label over the other end)
        const same = (r) => {
          const e0 = Math.abs(q.s0 - r.s0) <= tolS;
          const e1 = Math.abs(q.s1 - r.s1) <= tolS;
          const ov = Math.min(q.s1, r.s1) - Math.max(q.s0, r.s0);
          return (e0 && e1) || ((e0 || e1) && ov >= 0.6 * Math.max(q.s1 - q.s0, r.s1 - r.s0));
        };
        if (!same(chain[0]) && !same(chain[chain.length - 1])) continue;
        // a parallel line of the same extent closer than a tread: hatching (a wood floor, deck boards), not a stair
        if (gap < 0.12 * ppm) {
          if (gap > dup) {
            dense = true;
            break;
          }
          continue;
        }
        if (used.has(q)) continue;
        if (step === null) {
          if (gap < 0.14 * ppm || gap > 0.4 * ppm) continue;
          step = gap;
        } else if (Math.abs(gap - step) > tolStep(step) && !(missed < 2 && Math.abs(gap - 2 * step) <= tolStep(step))) continue;
        if (step !== null && gap > 1.5 * step) missed++;
        chain.push(q);
        // the step: the mean over the positions so far (one pixel more or less between two lines is a lot at 6 px)
        step = (q.c - chain[0].c) / (chain.length - 1 + missed);
      }
      if (chain.length < 3 || (dense && chain.length < 5)) continue;
      const c0 = chain[0].c;
      const c1 = chain[chain.length - 1].c;
      const s0 = Math.min(...chain.map((q) => q.s0));
      const s1 = Math.max(...chain.map((q) => q.s1));
      const bbox = axis === H ? [s0, c0, s1, c1] : [c0, s0, c1, s1];
      if (!inside([(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2])) continue;
      // a tile grid: lines across the treads in the middle of the flight too (a stair has at most its walking line)
      const other = axis === H ? V : H;
      const crossing = longOf[other].filter((q) => q.s0 <= c0 + 0.2 * (c1 - c0) && q.s1 >= c1 - 0.2 * (c1 - c0) && q.c > s0 + 0.15 * (s1 - s0) && q.c < s1 - 0.15 * (s1 - s0));
      if (crossing.length >= 2) continue;
      for (const q of chain) used.add(q);
      const lines = chain.map((q) => (axis === H ? [[q.s0, q.c], [q.s1, q.c]] : [[q.c, q.s0], [q.c, q.s1]]));
      // the treads: the lines found plus the ones a piece of furniture or a label hid (a gap of two steps)
      const f = { bbox, axis, step, width: s1 - s0, lines, count: chain.length + missed, run: axis === H ? 'y' : 'x' };
      // a flight that is one by itself (five lines) may go on, and one of four between two walls (a narrow stair
      // between its walls, its other treads too faint for the line search: hus8); no tile grid across what it gained
      const walled = () => {
        const mid = (c0 + c1) / 2;
        const wallAt = (from, dir) => {
          for (let k = 0; k <= 0.15 * ppm; k++) {
            const sAt = Math.round(from + dir * k);
            const [x, y] = axis === H ? [sAt, Math.round(mid)] : [Math.round(mid), sAt];
            if (x >= 0 && y >= 0 && x < core.w && y < core.h && core.data[y * core.w + x]) return true;
          }
          return false;
        };
        return wallAt(s0, -1) && wallAt(s1, 1);
      };
      if (chain.length >= 5 || (chain.length === 4 && walled())) {
        const was = { bbox: [...f.bbox], lines: [...f.lines], count: f.count };
        f.found = [...f.bbox];
        extendFlight(f, thin, inside, ppm);
        const [e0, e1] = axis === H ? [f.bbox[1], f.bbox[3]] : [f.bbox[0], f.bbox[2]];
        if (f.extended && longOf[other].filter((q) => q.s0 <= e0 + 0.2 * (e1 - e0) && q.s1 >= e1 - 0.2 * (e1 - e0) && q.c > s0 + 0.15 * (s1 - s0) && q.c < s1 - 0.15 * (s1 - s0)).length >= 2) Object.assign(f, was, { extended: 0 });
      }
      flights.push(f);
    }
  }
  // ---- fans of winders beside the ends of the flights
  const fans = [];
  const minSeg = 0.3 * ppm;
  const near = 0.35 * ppm;
  for (const f of flights) {
    const w = f.width;
    // (around the flight as the line search found it: an extension may have taken the first winders in)
    const [bx0, by0, bx1, by1] = f.found ?? f.bbox;
    // the regions beyond both ends of the run, as wide as four flights (an L or a U turns to either side; the outer
    // winders of a U reach a flight and a half out: hus6)
    const e = 1.5 * w;
    const regions = f.run === 'y'
      ? [[bx0 - e, by0 - e, bx1 + e, by0 + f.step], [bx0 - e, by1 - f.step, bx1 + e, by1 + e]]
      : [[bx0 - e, by0 - e, bx0 + f.step, by1 + e], [bx1 - f.step, by0 - e, bx1 + e, by1 + e]];
    for (const rect of regions) {
      const segs = allSegments(thin, rect, minSeg, ppm).filter((s) => s.len <= 1.8 * ppm);
      // four winders, two of them reaching most of the way across the flight (from the newel to the outer stringer),
      // or three that all do (the 1 px winders of an architect's drawing cross other lines, and the line search
      // misses some: hus6) – their point at a side of the flight (its inner stringer, the newel), not across the
      // middle of its end (a door's jamb or threshold beyond the flight has short strokes all round it: hus8)
      const [w0, w1] = f.axis === H ? [bx0, bx1] : [by0, by1];
      const long = (x, n) => x.lines.filter(([a, b]) => Math.hypot(b[0] - a[0], b[1] - a[1]) >= 0.75 * w).length >= n;
      const ok = (x, n) => x && long(x, n) && Math.min(Math.abs((f.axis === H ? x.pivot[0] : x.pivot[1]) - w0), Math.abs((f.axis === H ? x.pivot[0] : x.pivot[1]) - w1)) <= 0.3 * w;
      const four = fanOf(segs, ppm, near, inside);
      const three = ok(four, 2) ? null : fanOf(segs, ppm, near, inside, { minLines: 3, minMember: Math.max(0.4 * ppm, 0.75 * w) });
      const fan = ok(four, 2) ? four : ok(three, 3) ? three : null;
      // the same turn found from both flights (its point within 30 cm, or most of its box shared) is one fan
      const shared = (a, b) => {
        const ix = Math.min(a[2], b[2]) - Math.max(a[0], b[0]);
        const iy = Math.min(a[3], b[3]) - Math.max(a[1], b[1]);
        return ix > 0 && iy > 0 && ix * iy >= 0.5 * Math.min((a[2] - a[0]) * (a[3] - a[1]), (b[2] - b[0]) * (b[3] - b[1]));
      };
      const twin = fan && fans.find((q) => Math.hypot(q.pivot[0] - fan.pivot[0], q.pivot[1] - fan.pivot[1]) < 0.3 * ppm || shared(q.bbox, fan.bbox));
      if (twin) twin.from.push(f);
      else if (fan) fans.push({ ...fan, from: [f] });
    }
  }
  // ---- stairs: flights and fans that touch (within 30 cm), a fan with the flights it was found beside
  const parts = [...flights.map((f) => ({ f, bbox: f.bbox })), ...fans.map((wf) => ({ wf, bbox: wf.bbox }))];
  const pad = 0.3 * ppm;
  const touch = (a, b) => a[0] <= b[2] + pad && b[0] <= a[2] + pad && a[1] <= b[3] + pad && b[1] <= a[3] + pad;
  const U = dsu(parts.length);
  for (let i = 0; i < parts.length; i++) {
    for (let j = i + 1; j < parts.length; j++) {
      if (touch(parts[i].bbox, parts[j].bbox) || (parts[j].wf && parts[j].wf.from.includes(parts[i].f))) U.union(i, j);
    }
  }
  const groups = new Map();
  parts.forEach((p, i) => {
    const r = U.find(i);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(p);
  });
  const stairs = [];
  for (const g of groups.values()) {
    const fl = g.filter((p) => p.f).map((p) => p.f);
    const wi = g.filter((p) => p.wf).map((p) => p.wf);
    if (!fl.length) continue;
    // a lone flight needs five lines (an armchair or a sofa has three or four cushion lines), and flights of three
    // lines (a short first flight before the winders of a small stair: hus8) need winders beside them
    if (!wi.length && ((fl.length === 1 && fl[0].lines.length < 5) || fl.every((x) => x.lines.length < 4))) continue;
    const bbox = [Math.min(...g.map((p) => p.bbox[0])), Math.min(...g.map((p) => p.bbox[1])), Math.max(...g.map((p) => p.bbox[2])), Math.max(...g.map((p) => p.bbox[3]))];
    const main = fl.reduce((b, f) => (!b || f.lines.length * f.step > b.lines.length * b.step ? f : b), null);
    const spread = wi.reduce((m, x) => Math.max(m, x.spread), 0);
    const perp = fl.some((a) => fl.some((b) => a.axis !== b.axis));
    // two flights of one axis side by side (their treads do not overlap: a U), not one after the other along the run
    // (one flight broken by a landing, a label or furniture)
    const treadSpan = (f) => (f.axis === H ? [f.bbox[0], f.bbox[2]] : [f.bbox[1], f.bbox[3]]);
    const sideBySide = fl.some((a) => fl.some((b) => a !== b && a.axis === b.axis && Math.min(treadSpan(a)[1], treadSpan(b)[1]) - Math.max(treadSpan(a)[0], treadSpan(b)[0]) < 0.5 * Math.min(a.width, b.width)));
    // the flights decide first – flights at right angles are an L whatever the fan between them spans (the outer
    // winders of an L lie close to the treads of both flights, ~150°) –, a fan alone by its spread
    // a fan at each end of one flight, 1.5 m or more apart along its run: a quarter turn at both ends (hus6)
    const runAt = (p) => (main.run === 'x' ? p[0] : p[1]);
    const bothEnds = wi.length >= 2 && Math.max(...wi.map((x) => runAt(x.pivot))) - Math.min(...wi.map((x) => runAt(x.pivot))) >= 1.5 * ppm;
    let kind = 'straight';
    if (sideBySide) kind = 'half-turn';
    else if (perp) kind = 'quarter-turn';
    else if (spread >= 150 || bothEnds) kind = 'half-turn';
    else if (wi.length) kind = 'quarter-turn';
    stairs.push({
      bbox,
      axis: main.run,
      treads: fl.reduce((s, f) => s + f.count, 0) + wi.reduce((s, x) => s + x.count, 0),
      kind,
      flights: fl.length,
      winders: wi.reduce((s, x) => s + x.count, 0),
      lines: [...fl.flatMap((f) => f.lines), ...wi.flatMap((x) => x.lines)],
      ...(wi.length ? { pivot: wi[0].pivot } : {}),
    });
  }
  // ---- stairs winding round a newel (no flight of parallel treads: every tread a winder, hus4): a stair of the flights
  //      above in the same place takes the newel's lines, and its box and turn when the newel is a half-turn or the
  //      flights are straight
  for (const n of newelStairs(thin, inside, ppm)) {
    const pad2 = 0.2 * ppm;
    const hit = stairs.find((st) => n.pivot[0] >= st.bbox[0] - pad2 && n.pivot[0] <= st.bbox[2] + pad2 && n.pivot[1] >= st.bbox[1] - pad2 && n.pivot[1] <= st.bbox[3] + pad2);
    if (!hit) {
      stairs.push(n);
      continue;
    }
    // (a quarter-turn newel only confirms the flights' stair: its box stays theirs)
    if (n.kind === 'half-turn' || hit.kind === 'straight') {
      hit.bbox = [Math.min(hit.bbox[0], n.bbox[0]), Math.min(hit.bbox[1], n.bbox[1]), Math.max(hit.bbox[2], n.bbox[2]), Math.max(hit.bbox[3], n.bbox[3])];
      hit.kind = n.kind;
    }
    hit.winders = Math.max(hit.winders, n.winders);
    hit.treads = Math.max(hit.treads, n.treads);
    hit.lines = [...hit.lines, ...n.lines];
    if (!hit.pivot) hit.pivot = n.pivot;
  }
  return stairs;
}

/**
 * Stairs that wind round a newel (hus4: a half-turn where every tread is a winder): no flight of parallel treads, but
 * long thin lines (40 cm – 1.8 m, more than 10° off the axes) whose inner ends lie on a narrow newel and that radiate
 * from it out to the stair's outline. The places first: clusters of long diagonal strokes in the ink (the axis runs
 * taken out, components of 35 cm or more, 40 cm apart at most) that add up to 2 m; there the Hough segments, drawn and
 * dashed (the flight above the cut plane is drawn dashed, hus4 1. etasje), and the newel among them (newelOf).
 * @returns {{ bbox, axis, treads, kind, flights: 0, winders, lines, pivot }[]}  pixels of the mask
 */
function newelStairs(ink, inside, ppm) {
  // (an antialiased line 10° off an axis still has runs under 12 cm)
  const run = Math.max(6, Math.round(0.12 * ppm));
  const diag = subtract(subtract(ink, longRuns(ink, H, run)), longRuns(ink, V, run));
  const extent = (c) => Math.hypot(c.maxX - c.minX, c.maxY - c.minY);
  const strokes = components(diag, 8).comps.filter((c) => extent(c) >= 0.35 * ppm);
  // clusters of strokes whose boxes lie within 40 cm of each other
  const gap = 0.4 * ppm;
  const U = dsu(strokes.length);
  for (let i = 0; i < strokes.length; i++) {
    for (let j = i + 1; j < strokes.length; j++) {
      const a = strokes[i];
      const b = strokes[j];
      if (a.minX <= b.maxX + gap && b.minX <= a.maxX + gap && a.minY <= b.maxY + gap && b.minY <= a.maxY + gap) U.union(i, j);
    }
  }
  const clusters = new Map();
  strokes.forEach((c, i) => {
    const r = U.find(i);
    if (!clusters.has(r)) clusters.set(r, []);
    clusters.get(r).push(c);
  });
  const out = [];
  // (a flight drawn dashed has no long strokes: the place reaches a flight's width beyond them)
  const pad = 1.0 * ppm;
  for (const cs of clusters.values()) {
    if (cs.reduce((s, c) => s + extent(c), 0) < 2 * ppm) continue;
    const rect = [Math.min(...cs.map((c) => c.minX)) - pad, Math.min(...cs.map((c) => c.minY)) - pad, Math.max(...cs.map((c) => c.maxX)) + pad, Math.max(...cs.map((c) => c.maxY)) + pad];
    if (rect[2] - rect[0] > 9 * ppm || rect[3] - rect[1] > 9 * ppm) continue; // no stair: a whole hatched or tiled floor
    const long = (sg) => sg.len >= 0.4 * ppm && sg.len <= 1.8 * ppm;
    const ok = (sg) => long(sg) && sg.theta % 90 > 10 && sg.theta % 90 < 80;
    // drawn and dashed (allSegments); the treads of the flights along the newel that lie within 10° of the axes are
    // the stair's ends, for the box
    const found = allSegments(ink, rect, 0.4 * ppm, ppm);
    const segs = found.filter(ok);
    const flat = found.filter((sg) => long(sg) && !ok(sg));
    const n = newelOf(segs, ppm, inside, flat);
    if (n) out.push(n);
  }
  return out;
}

/**
 * The best newel among segments: a window 50 cm wide and 1.6 m long (upright or lying, placed with a segment's end at
 * its middle or near one of its ends) that holds exactly one end of each of its lines – the inner end; the other lies
 * 35 cm or more outside – and where the lines meet: half the pairs 8° or more apart, extended, cross within 30 cm of
 * it (at a wall or the stair's outline the lines end too, but they meet at the newel across the stair). The window
 * whose lines have the most directions 8° apart wins (a rotated armchair or a word has two or three); it needs eight
 * lines in six directions, turning 60° or more from the inner ends to the outer ones, its middle inside the building.
 * Lines leaving the newel to both sides (three or more each, 30 cm out) make a half-turn – as wide on both sides as
 * on the wider one (a flight drawn dashed beyond the cut plane may be missing) –, else a quarter-turn. The box: the
 * lines, one step (the spacing of the inner ends) past the newel's last ones, and the flat treads (within 10° of the
 * axes, flat) that start on the newel's line past them.
 * @returns {{ bbox, axis, treads, kind, flights: 0, winders, lines, pivot } | null}
 */
function newelOf(segs, ppm, inside, flat = []) {
  if (segs.length < 8) return null;
  const hw = 0.25 * ppm;
  const hl = 0.8 * ppm;
  const reach = 0.3 * ppm;
  const away = 0.35 * ppm;
  let best = null;
  for (const S of segs) {
    for (const E of [S.a, S.b]) {
      for (const upright of [true, false]) {
        for (const shift of [0, 0.75, -0.75]) {
          const c = upright ? [E[0], E[1] + shift * hl] : [E[0] + shift * hl, E[1]];
          const [ax, ay] = upright ? [hw, hl] : [hl, hw];
          const inWin = (p, r = 0) => Math.abs(p[0] - c[0]) <= ax + r && Math.abs(p[1] - c[1]) <= ay + r;
          const members = [];
          for (const q of segs) {
            const ia = inWin(q.a);
            const ib = inWin(q.b);
            // the outer end well clear of the newel (a stroke across a crowded junction is not a tread)
            if (ia !== ib && !inWin(ia ? q.b : q.a, away)) members.push({ q, i: ia ? q.a : q.b, o: ia ? q.b : q.a });
          }
          if (members.length < 8) continue;
          // the lines' own directions (a rotated armchair or a word has two or three, every tread of a winding stair
          // its own)
          const th = members.map(({ q }) => q.theta).sort((p, q) => p - q);
          const distinct = th.filter((t, k) => k === 0 || t - th[k - 1] >= 8).length - (th.length > 1 && th[0] + 180 - th[th.length - 1] < 8 ? 1 : 0);
          if (distinct < 6 || (best && distinct <= best.distinct)) continue;
          const ang = members.map(({ i, o }) => (Math.atan2(o[1] - i[1], o[0] - i[0]) * 180) / Math.PI).sort((p, q) => p - q);
          let gapMax = 360 - (ang[ang.length - 1] - ang[0]);
          for (let k = 1; k < ang.length; k++) gapMax = Math.max(gapMax, ang[k] - ang[k - 1]);
          const spread = 360 - gapMax;
          if (spread < 60 || !inside(c)) continue;
          // the lines meet here
          let pairs = 0;
          let meet = 0;
          for (let a = 0; a < members.length; a++) {
            for (let b = a + 1; b < members.length; b++) {
              const A = members[a].q;
              const B = members[b].q;
              let dt = Math.abs(A.theta - B.theta);
              dt = Math.min(dt, 180 - dt);
              if (dt < 8) continue;
              pairs++;
              const da = [A.b[0] - A.a[0], A.b[1] - A.a[1]];
              const db = [B.b[0] - B.a[0], B.b[1] - B.a[1]];
              const den = da[0] * db[1] - da[1] * db[0];
              const k = ((B.a[0] - A.a[0]) * db[1] - (B.a[1] - A.a[1]) * db[0]) / den;
              if (inWin([A.a[0] + da[0] * k, A.a[1] + da[1] * k], reach)) meet++;
            }
          }
          if (!pairs || meet < 0.5 * pairs) continue;
          best = { members, distinct, spread, upright };
        }
      }
    }
  }
  if (!best) return null;
  const { members } = best;
  const inner = members.map((m) => m.i);
  const pts = members.flatMap((m) => [m.i, m.o]);
  const median = (v) => [...v].sort((p, q) => p - q)[v.length >> 1];
  // a half-turn: treads leave the newel to both sides, three or more each (two flights side by side) – across x (an
  // upright newel) or across y; a quarter-turn: to one side and round its end
  const sides = (k) => {
    const m = median(inner.map((p) => p[k]));
    const n = (sg) => members.filter((x) => (x.o[k] - m) * sg > 0.3 * ppm).length;
    return n(1) >= 3 && n(-1) >= 3;
  };
  const uX = sides(0);
  const uY = !uX && sides(1);
  const upright = uX ? true : uY ? false : best.upright;
  const kind = uX || uY ? 'half-turn' : 'quarter-turn';
  // along (the newel's long axis) and across, per point
  const al = (p) => (upright ? p[1] : p[0]);
  const ac = (p) => (upright ? p[0] : p[1]);
  const axisC = median(inner.map(ac));
  const steps = inner.map(al).sort((p, q) => p - q);
  const diffs = steps.slice(1).map((v, k) => v - steps[k]).filter((d) => d > 0.1 * ppm).sort((p, q) => p - q);
  const step = diffs.length ? diffs[diffs.length >> 1] : 0;
  let lo = Math.min(...pts.map(al), steps[0] - step);
  let hi = Math.max(...pts.map(al), steps[steps.length - 1] + step);
  // past the newel's end away from the turn (where no line leaves beyond its inner ends): the flights' last treads,
  // across the newel within 10° of the axes (not members), from the newel's line, and the newel's own outline along
  // it – up to 1.2 m past the last inner end
  const last = steps[steps.length - 1];
  const turnLo = members.filter((m) => al(m.o) < steps[0] - 0.3 * ppm).length >= 2;
  const turnHi = members.filter((m) => al(m.o) > last + 0.3 * ppm).length >= 2;
  for (const q of flat) {
    const across = Math.abs(q.theta - (upright ? 90 : 0)) <= 10 || (!upright && q.theta >= 170);
    for (const [e, o] of [[q.a, q.b], [q.b, q.a]]) {
      if (Math.abs(ac(e) - axisC) > 0.3 * ppm || (!across && Math.abs(ac(o) - axisC) > 0.3 * ppm)) continue;
      if (!turnHi && al(e) > last && al(e) <= last + 1.2 * ppm) hi = Math.max(hi, al(e), al(o));
      if (!turnLo && al(e) < steps[0] && al(e) >= steps[0] - 1.2 * ppm) lo = Math.min(lo, al(e), al(o));
    }
  }
  let left = Math.min(...pts.map(ac));
  let right = Math.max(...pts.map(ac));
  if (kind === 'half-turn') {
    const w = Math.max(axisC - left, right - axisC);
    left = axisC - w;
    right = axisC + w;
  }
  const bbox = upright ? [left, lo, right, hi] : [lo, left, hi, right];
  const nb = [Math.min(...inner.map((p) => p[0])), Math.min(...inner.map((p) => p[1])), Math.max(...inner.map((p) => p[0])), Math.max(...inner.map((p) => p[1]))];
  return {
    bbox,
    axis: upright ? 'y' : 'x',
    treads: members.length,
    kind,
    flights: 0,
    winders: members.length,
    lines: members.map((m) => [m.i, m.o]),
    pivot: [(nb[0] + nb[2]) / 2, (nb[1] + nb[3]) / 2],
  };
}

/**
 * A flight goes on in treads the line search missed: dashed ones (the part beyond the cut line, drawn hidden), or
 * ones the cut line, the walking line or a label broke. At each next tread position (± 30 % of a step) beyond either
 * end, a row of the ink that covers 40 % or more of the flight's width is a tread when it is a line: the rows 4 cm to
 * both sides have under half of its ink (winders crossing the row at a slant have it on every row), and so has the row
 * half a step back (a filled area, hatching); and the ink does not run on past both of the flight's sides (hatching
 * through the room). The search stops at a wall or outside, and after two positions with nothing. Mutates the flight.
 */
function extendFlight(f, mask, inside, ppm) {
  const { axis, step } = f;
  const [s0, s1] = axis === H ? [f.bbox[0], f.bbox[2]] : [f.bbox[1], f.bbox[3]];
  const ink = (s, l) => {
    const [x, y] = axis === H ? [s, l] : [l, s];
    return x >= 0 && y >= 0 && x < mask.w && y < mask.h && mask.data[y * mask.w + x] === 1;
  };
  const cover = (l, a, b) => {
    let hit = 0;
    let n = 0;
    for (let s = Math.ceil(a); s <= Math.floor(b); s++, n++) if (ink(s, l) || ink(s, l - 1) || ink(s, l + 1)) hit++;
    return n ? hit / n : 0;
  };
  const out = Math.max(3, 0.3 * ppm);
  const off = Math.max(3, Math.round(0.04 * ppm));
  const add = [];
  for (const dir of [-1, 1]) {
    let c = dir < 0 ? (axis === H ? f.bbox[1] : f.bbox[0]) : axis === H ? f.bbox[3] : f.bbox[2];
    let miss = 0;
    for (let k = 0; k < 40 && miss < 2; k++) {
      const want = c + dir * step;
      const mid = (s0 + s1) / 2;
      if (!inside(axis === H ? [mid, want] : [want, mid])) break;
      let best = null;
      for (let l = Math.round(want - 0.3 * step); l <= Math.round(want + 0.3 * step); l++) {
        const v = cover(l, s0, s1);
        if (!best || v > best.v) best = { l, v };
      }
      const line = cover(best.l - off, s0, s1) < 0.5 * best.v && cover(best.l + off, s0, s1) < 0.5 * best.v;
      const back = cover(Math.round(best.l - (dir * step) / 2), s0, s1);
      const through = cover(best.l, s0 - out, s0 - 3) > 0.6 && cover(best.l, s1 + 3, s1 + out) > 0.6;
      if (best.v >= 0.4 && line && back < 0.5 * best.v && !through) {
        add.push(best.l);
        c = best.l;
        miss = 0;
      } else {
        c = want;
        miss++;
      }
    }
  }
  if (!add.length) return;
  for (const l of add) f.lines.push(axis === H ? [[s0, l], [s1, l]] : [[l, s0], [l, s1]]);
  f.count += add.length;
  const cs = f.lines.map((ln) => (axis === H ? ln[0][1] : ln[0][0]));
  if (axis === H) [f.bbox[1], f.bbox[3]] = [Math.min(...cs), Math.max(...cs)];
  else [f.bbox[0], f.bbox[2]] = [Math.min(...cs), Math.max(...cs)];
  f.extended = add.length;
}

/**
 * A fan of winders among segments: the point where most pairs of lines (8° or more apart) meet near the inner ends of
 * both, and the lines through it (within 8 cm: balanced winders do not all meet in one point) that start at it (within
 * 20 cm) and are minMember long or more (40 cm) – minLines at least (four), in as many directions 5° apart, reaching
 * 60 cm out, turning 200° at most. Lines within 12° of the plan's axes are the flights' stringers and treads, not
 * winders.
 * @returns {{ pivot, spread, count, lines, bbox } | null}
 */
function fanOf(segs, ppm, near, inside, { minLines = 4, minMember = 0.4 * ppm } = {}) {
  const cell = Math.max(2, 0.05 * ppm);
  const votes = new Map();
  const endDist = (S, X) => Math.min(Math.hypot(S.a[0] - X[0], S.a[1] - X[1]), Math.hypot(S.b[0] - X[0], S.b[1] - X[1]));
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      const A = segs[i];
      const B = segs[j];
      let dt = Math.abs(A.theta - B.theta);
      dt = Math.min(dt, 180 - dt);
      if (dt < 8) continue;
      const da = [A.b[0] - A.a[0], A.b[1] - A.a[1]];
      const db = [B.b[0] - B.a[0], B.b[1] - B.a[1]];
      const den = da[0] * db[1] - da[1] * db[0];
      if (Math.abs(den) < 1e-9) continue;
      const k = ((B.a[0] - A.a[0]) * db[1] - (B.a[1] - A.a[1]) * db[0]) / den;
      const X = [A.a[0] + da[0] * k, A.a[1] + da[1] * k];
      if (endDist(A, X) > near || endDist(B, X) > near) continue;
      const key = `${Math.round(X[0] / cell)},${Math.round(X[1] / cell)}`;
      votes.set(key, (votes.get(key) || 0) + 1);
    }
  }
  let best = null;
  for (const [key, own] of votes) {
    // the votes of the cell and its neighbours (three lines meeting in one point split their pairs over two cells)
    const [cx, cy] = key.split(',').map(Number);
    let v = own;
    if (minLines < 4) for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) if (dx || dy) v += votes.get(`${cx + dx},${cy + dy}`) || 0;
    if (v < (minLines * (minLines - 1)) / 2) continue; // four lines through a point make six pairs
    const P = [cx * cell, cy * cell];
    if (!inside(P)) continue;
    const members = segs.filter((s) => {
      const d = [s.b[0] - s.a[0], s.b[1] - s.a[1]];
      const off = Math.abs((P[0] - s.a[0]) * d[1] - (P[1] - s.a[1]) * d[0]) / Math.hypot(d[0], d[1]);
      return off <= Math.max(3, 0.08 * ppm) && endDist(s, P) <= 0.2 * ppm && s.len >= minMember && s.theta % 90 > 12 && s.theta % 90 < 78;
    });
    const ang = members
      .map((s) => {
        const far = Math.hypot(s.a[0] - P[0], s.a[1] - P[1]) > Math.hypot(s.b[0] - P[0], s.b[1] - P[1]) ? s.a : s.b;
        return (Math.atan2(far[1] - P[1], far[0] - P[0]) * 180) / Math.PI;
      })
      .sort((a, b) => a - b);
    const distinct = ang.filter((a, i) => i === 0 || a - ang[i - 1] >= 5).length;
    if (distinct < minLines) continue;
    const outer = Math.max(...members.map((s) => Math.max(Math.hypot(s.a[0] - P[0], s.a[1] - P[1]), Math.hypot(s.b[0] - P[0], s.b[1] - P[1]))));
    if (outer < 0.6 * ppm) continue;
    let gapMax = 360 - (ang[ang.length - 1] - ang[0]);
    for (let i = 1; i < ang.length; i++) gapMax = Math.max(gapMax, ang[i] - ang[i - 1]);
    // winders turn a stair by 180° at most: lines all round a point are a door's jamb, a symbol, a JPEG corner
    if (360 - gapMax > 200) continue;
    if (!best || distinct > best.count) {
      const pts = [P, ...members.flatMap((s) => [s.a, s.b])];
      best = { pivot: P, spread: 360 - gapMax, count: distinct, lines: members.map((s) => [s.a, s.b]), bbox: [Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))] };
    }
  }
  return best;
}

/**
 * Paper reachable from the image border without crossing a wall (walls drawn as full bands, openings closed): a span
 * flood fill. out.inner is the box [x0, y0, x1, y1] of the paper the walls enclose (neither outside nor wall), or null
 * when they enclose nothing; out.block the walls' bands.
 */
function outsideMask(w, h, walls) {
  const block = raster(w, h);
  for (const s of walls) {
    const a0 = Math.floor(s.c - s.t / 2);
    const a1 = Math.ceil(s.c + s.t / 2);
    const s0 = Math.floor(s.s0 - s.t / 2);
    const s1 = Math.ceil(s.s1 + s.t / 2);
    for (let a = a0; a <= a1; a++) {
      for (let q = s0; q <= s1; q++) {
        const [x, y] = s.axis === H ? [q, a] : [a, q];
        if (x >= 0 && y >= 0 && x < w && y < h) block.data[y * w + x] = 1;
      }
    }
  }
  const out = raster(w, h);
  const B = block.data;
  const O = out.data;
  let stack = new Int32Array(1024);
  let top = 0;
  const seed = (x, y) => {
    if (top + 2 > stack.length) {
      const bigger = new Int32Array(stack.length * 2);
      bigger.set(stack);
      stack = bigger;
    }
    stack[top++] = x;
    stack[top++] = y;
  };
  // the free runs of row y between x0 and x1 that are not filled yet: one seed each
  const seedRow = (y, x0, x1) => {
    if (y < 0 || y >= h) return;
    const row = y * w;
    let inRun = false;
    for (let x = x0; x <= x1; x++) {
      const free = !B[row + x] && !O[row + x];
      if (free && !inRun) seed(x, y);
      inRun = free;
    }
  };
  for (let x = 0; x < w; x++) {
    seed(x, 0);
    seed(x, h - 1);
  }
  for (let y = 0; y < h; y++) {
    seed(0, y);
    seed(w - 1, y);
  }
  while (top) {
    const y = stack[--top];
    const x = stack[--top];
    const row = y * w;
    if (B[row + x] || O[row + x]) continue;
    let l = x;
    let r = x;
    while (l > 0 && !B[row + l - 1] && !O[row + l - 1]) l--;
    while (r < w - 1 && !B[row + r + 1] && !O[row + r + 1]) r++;
    O.fill(1, row + l, row + r + 1);
    seedRow(y - 1, l, r);
    seedRow(y + 1, l, r);
  }
  let ix0 = w;
  let iy0 = h;
  let ix1 = -1;
  let iy1 = -1;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      if (O[row + x] || B[row + x]) continue;
      if (x < ix0) ix0 = x;
      if (x > ix1) ix1 = x;
      if (y < iy0) iy0 = y;
      iy1 = y;
    }
  }
  out.inner = ix1 >= 0 ? [ix0, iy0, ix1, iy1] : null;
  out.block = block;
  return out;
}
