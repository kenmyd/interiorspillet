/**
 * Planbygger: automatic detection of walls, doors and windows in a floor-plan image – classical image processing and
 * fixed rules only (thresholds, morphology, run lengths, connected components, profile integration, arc sampling).
 * No learning, no OCR, no network.
 *
 *   detectPlan(img, { pxPerM, ...options }) → {
 *     walls:    [{ a: [x, y], b: [x, y], t, axis: 'h'|'v', exterior }]                  pixels, a → b along +x / +y
 *     openings: [{ wall, from, to, type: 'door'|'window'|'opening', hinge: 'start'|'end'|null, side: 1|-1|0,
 *                  score, symbol }]                                                     from/to: pixels along the wall
 *     stats:    { darkThreshold, background, coreRadius, minRun, timings … },
 *     debug:    { dark, core, segments }                                               rasters and raw pieces
 *   }
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
 *      opening (interior wall), an empty short gap → opening
 *   7. pieces not connected to the main wall network are dropped (furniture, labels), exterior walls marked by a flood
 *      fill from the image border
 */
import { luma, histogram, threshold, open, longRuns, subtract, components, raster, minNear, sample } from './image.js';

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
  /** wall networks shorter than this share of the largest one are dropped (furniture, labels) */
  minNetworkShare: 0.12,
  /** below this resolution the plan is detected on an upsampled copy (px per metre) */
  minPxPerM: 50,
});

const H = 'h';
const V = 'v';

/** Point at along-coordinate s on a piece / wall line. */
const pt = (seg, s, off = 0) => (seg.axis === H ? [s, seg.c + off] : [seg.c + off, s]);

/** The threshold between ink and paper: the deepest valley of the smoothed histogram in 15 … 100 after the black peak. */
export function autoDarkThreshold(hist) {
  let peak = 0;
  for (let i = 0; i < 60; i++) if (hist[i] > hist[peak]) peak = i;
  const sm = (i) => {
    let s = 0;
    for (let k = -4; k <= 4; k++) s += hist[Math.max(0, Math.min(255, i + k))];
    return s;
  };
  let best = Math.max(peak + 8, 15);
  let bestV = Infinity;
  for (let t = Math.max(peak + 8, 15); t <= 100; t++) {
    const v = sm(t);
    if (v < bestV - 1e-9) {
      bestV = v;
      best = t;
    }
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
  // a low-resolution plan (an interior wall of 10 cm under ~5 px) is detected on a bilinear 2–3× copy: the opening
  // that removes text would otherwise remove the thin walls too; the result is scaled back
  if (ppm < o.minPxPerM && !options._scaled) {
    const f = Math.min(4, Math.ceil(o.minPxPerM / ppm));
    const r = detectPlan(upsample(img, f), { ...options, pxPerM: ppm * f, _scaled: f });
    const k = 1 / f;
    return {
      ...r,
      walls: r.walls.map((w) => ({ ...w, a: [w.a[0] * k, w.a[1] * k], b: [w.b[0] * k, w.b[1] * k], t: w.t * k })),
      openings: r.openings.map((op) => ({ ...op, from: op.from * k, to: op.to * k, leaf: op.leaf == null ? null : op.leaf * k })),
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
  const darkT = tone ? Math.min(tone[0], 255) : o.darkThreshold ?? autoDarkThreshold(hist);
  const isWall = tone ? (v) => v >= tone[0] && v <= tone[1] : (v) => v < darkT;
  let ink = 0;
  if (tone) ink = Math.round((tone[0] + tone[1]) / 2);
  else for (let i = 0; i < 60; i++) if (hist[i] > hist[ink]) ink = i;
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
  const ctx = { grey, core, darkT, isWall, paper, ink, ppm, o };
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
  const ops = openings.filter((op) => remap.has(op.seg));

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
  // classify the line symbols now that we know which walls are exterior
  for (const op of ops) {
    if (op.type === 'symbol') op.type = op.seg.exterior ? 'window' : 'opening';
    // an opening in an exterior wall with lines in it is a window; an exterior gap with no symbol stays an opening
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
    .map((op) => {
      const s = op.seg;
      const side = op.side ? (s.axis === H ? op.side : -op.side) : 0;
      return {
        wall: remap.get(s),
        from: Math.max(0, op.s0 - s.s0),
        to: Math.min(s.s1 - s.s0, op.s1 - s.s0),
        type: op.type,
        hinge: op.hinge === 's0' ? 'start' : op.hinge === 's1' ? 'end' : null,
        side,
        leaf: op.leaf ?? null,
        score: op.score ?? 0,
        symbol: op.symbol,
      };
    })
    .filter((op) => op.to - op.from >= 0.2 * ppm)
    .sort((a, b) => a.wall - b.wall || a.from - b.from);

  // grey walls (lighter than the black text): the black threshold finds (almost) nothing – try the grey band with the
  // most long wall runs (autoWallTone) once
  if (!tone && !options._noAutoTone && outWalls.length < 3) {
    const t = autoWallTone(grey, hist, paper, { r, minRun });
    if (t) {
      const again = detectPlan(img, { ...options, wallTone: t, _noAutoTone: true });
      if (again.walls.length > outWalls.length) return { ...again, stats: { ...again.stats, autoWallTone: t } };
    }
  }
  return {
    walls: outWalls,
    openings: outOpenings,
    stats: { darkThreshold: darkT, wallTone: tone, paper, ink, coreRadius: r, minRun, pieces: pieces.length, timings },
    debug: { dark, core, pieces, outside },
  };
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
  const { grey, paper, isWall } = ctx;
  const lineT = paper - 35;
  const a0 = Math.round(c - t / 2) - 1;
  const a1 = Math.round(c + t / 2);
  let lines = 0;
  let darkPx = 0;
  let total = 0;
  let inkSum = 0;
  const x0 = Math.ceil(s0 + 1);
  const x1 = Math.floor(s1 - 1);
  if (x1 <= x0) return { lines: 0, darkShare: 0, wallCols: 0, ink: 0 };
  const colDark = new Uint16Array(x1 - x0 + 1);
  for (let a = a0; a <= a1; a++) {
    let hit = 0;
    let n = 0;
    for (let s = x0; s <= x1; s++) {
      const [x, y] = axis === H ? [s, a] : [a, s];
      const v = sample(grey, x, y);
      n++;
      if (v < lineT) hit++;
      if (isWall(v)) {
        darkPx++;
        colDark[s - x0]++;
      }
      inkSum += Math.max(0, paper - v);
      total++;
    }
    if (n && hit / n >= 0.6) lines++;
  }
  // columns where a (thinner) wall runs through the band: a third of the band or more is wall-dark
  const rows = a1 - a0 + 1;
  let wallCols = 0;
  for (const c of colDark) if (c >= Math.max(2, rows / 3)) wallCols++;
  return { lines, darkShare: total ? darkPx / total : 0, wallCols: wallCols / colDark.length, ink: total ? inkSum / total : 0 };
}

/**
 * Best door arc in a gap: hinge positions along the gap, both directions along the wall, both sides, radii from
 * doorMin to min(doorMax, gap). A point of the arc is drawn when a pixel within 1.5 px is clearly darker than the paper
 * and is not wall; points that fall into a wall make the arc impossible.
 */
function findArc(ctx, seg, g0, g1) {
  const { grey, core, paper, ppm, o } = ctx;
  const W = core.w;
  const isCore = (x, y) => {
    const xi = Math.round(x);
    const yi = Math.round(y);
    return xi >= 0 && yi >= 0 && xi < W && yi < core.h && core.data[yi * W + xi] === 1;
  };
  const inkT = paper - 30;
  const gap = g1 - g0;
  const rMin = o.doorMin * ppm;
  const rMax = Math.min(o.doorMax * ppm, gap + 2);
  if (rMax < rMin) return null;
  // a drawn point is a THIN line: clearly darker than the paper, and the paper shows 3 px to both sides across it
  // (a grey filled sofa or worktop under the arc is not a line)
  const thinInk = (x, y, nx, ny) => {
    const m = minNear(grey, x, y, 1.5);
    if (m >= inkT) return false;
    const off = Math.max(3, 0.06 * ppm);
    const a = minNear(grey, x + nx * off, y + ny * off, 0.5);
    const b = minNear(grey, x - nx * off, y - ny * off, 0.5);
    return a > m + 25 && b > m + 25;
  };
  let best = null;
  const N = 24;
  const stepH = Math.max(1, Math.round(0.02 * ppm));
  const stepR = Math.max(1, Math.round(0.025 * ppm));
  for (const dirSign of [1, -1]) {
    for (let h = g0; h <= g1 + 0.01; h += stepH) {
      for (let rad = rMin; rad <= rMax + 0.01; rad += stepR) {
        const tip = h + dirSign * rad;
        if (tip < g0 - 2 || tip > g1 + 2) continue;
        for (const side of [1, -1]) {
          const face = seg.c + side * (seg.t / 2);
          let drawn = 0;
          let blocked = 0;
          for (let k = 1; k <= N; k++) {
            const phi = ((8 + (74 * (k - 1)) / (N - 1)) * Math.PI) / 180;
            const ca = dirSign * Math.cos(phi);
            const cb = side * Math.sin(phi);
            const along = h + rad * ca;
            const off = face + rad * cb;
            const [x, y] = seg.axis === H ? [along, off] : [off, along];
            const [nx, ny] = seg.axis === H ? [ca, cb] : [cb, ca]; // radial = across the arc
            if (isCore(x, y)) blocked++;
            else if (thinInk(x, y, nx, ny)) drawn++;
          }
          if (blocked > 2) continue;
          // the open leaf: a line from the hinge perpendicular to the wall
          let leaf = 0;
          for (let k = 2; k <= 9; k++) {
            const off = face + side * rad * (k / 10);
            const [x, y] = seg.axis === H ? [h, off] : [off, h];
            const [nx, ny] = seg.axis === H ? [1, 0] : [0, 1];
            if (!isCore(x, y) && thinInk(x, y, nx, ny)) leaf++;
          }
          const score = drawn / N + 0.15 * (leaf / 8);
          if (!best || score > best.score + 1e-9 || (Math.abs(score - best.score) < 1e-9 && rad > best.rad)) {
            best = { score, arc: drawn / N, leaf: leaf / 8, h, rad, dirSign, side };
          }
        }
      }
    }
  }
  return best;
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
  const analysePart = (seg, p, q) => {
    const len = q - p;
    const sym = bandSymbol(ctx, seg.axis, seg.c, seg.t, p, q);
    const arc = len >= o.doorMin * ppm * 0.9 ? findArc(ctx, seg, p, q) : null;
    const ops = [];
    if (arc && arc.arc >= o.arcScore) {
      const a = arc.dirSign > 0 ? arc.h : arc.h - arc.rad;
      const b = arc.dirSign > 0 ? arc.h + arc.rad : arc.h;
      // the door fills the part when the rest is too short for a sidelight (the frame is part of the hole)
      const d0 = Math.abs(a - p) < o.minSidelight * ppm ? p : a;
      const d1 = Math.abs(b - q) < o.minSidelight * ppm ? q : b;
      ops.push({ s0: d0, s1: d1, type: 'door', hinge: arc.dirSign > 0 ? 's0' : 's1', side: arc.side, leaf: arc.rad, score: arc.score, symbol: { arc: arc.arc, leaf: arc.leaf, lines: sym.lines } });
      for (const [x, y] of [[p, d0], [d1, q]]) {
        if (y - x >= minO * 0.8) {
          const s2 = bandSymbol(ctx, seg.axis, seg.c, seg.t, x, y);
          ops.push({ s0: x, s1: y, type: s2.lines ? 'symbol' : 'opening', side: 0, score: s2.lines, symbol: { lines: s2.lines } });
        }
      }
      return ops;
    }
    if (sym.lines >= 1) ops.push({ s0: p, s1: q, type: 'symbol', side: 0, score: sym.lines, symbol: { lines: sym.lines, arc: arc?.arc ?? 0 } });
    else if (len <= o.maxPlainOpening * ppm) ops.push({ s0: p, s1: q, type: 'opening', side: 0, score: 0, symbol: { lines: 0, arc: arc?.arc ?? 0 } });
    return ops;
  };
  // the opening analysis of one gap; returns the openings in it (absolute along-coordinates) or null = not an opening
  const analyse = (seg, g0, g1) => {
    const gap = g1 - g0;
    const sym = bandSymbol(ctx, seg.axis, seg.c, seg.t, g0, g1);
    // the wall goes on (a dark piece the runs missed, or a thinner wall in the same line)
    if (sym.darkShare > 0.45 || sym.wallCols > 0.8) return { join: true, ops: [] };
    if (gap > maxO && sym.lines < 1) return null; // only a drawn glass wall / row of windows may be that long
    if (sym.lines < 1 && gap > o.maxPlainOpening * ppm) {
      // an empty long gap is no opening – unless a door arc is drawn in it
      const arc = findArc(ctx, seg, g0, g1);
      if (!arc || arc.arc < o.arcScore) return null;
    }
    const ops = [];
    for (const [p, q] of splitAtPillars(ctx, seg, g0, g1)) ops.push(...analysePart(seg, p, q));
    return { join: true, ops };
  };

  // (a) collinear pieces with a gap
  let merged = true;
  while (merged) {
    merged = false;
    outer: for (let i = 0; i < list.length; i++) {
      const A = list[i];
      for (let j = 0; j < list.length; j++) {
        if (i === j) continue;
        const B = list[j];
        const tc = Math.max(tolC * 1.5, 0.25 * Math.min(A.t, B.t));
        if (A.axis !== B.axis || Math.abs(A.c - B.c) > tc || Math.abs(A.t - B.t) > tolT * 1.5) continue;
        const g0 = A.s1;
        const g1 = B.s0;
        const gap = g1 - g0;
        if (gap < 1 || gap > maxS) continue;
        // nothing crossing the gap
        if (list.some((p) => p.axis !== A.axis && p.c > g0 + 1 && p.c < g1 - 1 && p.s0 <= A.c + A.t / 2 && p.s1 >= A.c - A.t / 2)) continue;
        // nothing collinear in between
        if (list.some((p) => p !== A && p !== B && p.axis === A.axis && Math.abs(p.c - A.c) <= tolC * 1.5 && p.s1 > g0 + 1 && p.s0 < g1 - 1)) continue;
        if (gap < minO) {
          // a tiny gap: one wall
        } else {
          const res = analyse(A, g0, g1);
          if (!res) continue;
          for (const op of res.ops) openings.push({ ...op, seg: A });
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

  // collinear pieces of different thickness that meet end to end (a wall line that changes thickness): one joint
  for (const A of list) {
    for (const B of list) {
      if (A === B || A.axis !== B.axis || A.joints[1] || B.joints[0]) continue;
      const ov = Math.min(A.c + A.t / 2, B.c + B.t / 2) - Math.max(A.c - A.t / 2, B.c - B.t / 2);
      if (ov < 0.5 * Math.min(A.t, B.t) || Math.abs(B.s0 - A.s1) > Math.max(3, 0.05 * ppm)) continue;
      const m = (A.s1 + B.s0) / 2;
      A.s1 = m;
      B.s0 = m;
      A.joints[1] = B;
      B.joints[0] = A;
    }
  }

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
      // a collinear piece ahead (a thicker / thinner part of the same wall line) comes first: never run through it
      const ahead = list.some((q) => {
        if (q === A || q.axis !== A.axis) return false;
        const ov = Math.min(q.c + q.t / 2, A.c + A.t / 2) - Math.max(q.c - q.t / 2, A.c - A.t / 2);
        if (ov < 0.5 * Math.min(q.t, A.t)) return false;
        const start = dir > 0 ? q.s0 : q.s1;
        const dd = (start - e) * dir;
        return dd > -2 && dd < d + P.t;
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
      for (const op of res.ops) openings.push({ ...op, seg: A });
      A[key] = P.c;
      A.joints[k] = P;
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

/** Paper reachable from the image border without crossing a wall (walls drawn as full bands, openings closed). */
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
  const stack = [];
  const push = (x, y) => {
    const i = y * w + x;
    if (block.data[i] || out.data[i]) return;
    out.data[i] = 1;
    stack.push(i);
  };
  for (let x = 0; x < w; x++) {
    push(x, 0);
    push(x, h - 1);
  }
  for (let y = 0; y < h; y++) {
    push(0, y);
    push(w - 1, y);
  }
  while (stack.length) {
    const i = stack.pop();
    const x = i % w;
    const y = (i - x) / w;
    if (x > 0) push(x - 1, y);
    if (x < w - 1) push(x + 1, y);
    if (y > 0) push(x, y - 1);
    if (y < h - 1) push(x, y + 1);
  }
  return out;
}
