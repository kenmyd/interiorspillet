/**
 * Planbygger: levels on top of each other – where one level's plan frame lies in another's
 * (notes/planbygger-runde1-design.md, «align.js»).
 *
 *   alignLevelTo(level, ref, opts?) → { offset: [dx, dy], method: 'stair'|'outline'|'corner', score, … }
 *
 * level and ref are plan levels (model.js): walls in plan metres, offset, image.pxPerM. `offset` is the value for
 * level.offset that lays the level on ref (ref.offset included); the function does not change either level.
 *
 * Three methods, the first that is sure enough wins:
 *   • stair:   the stair lies alike on both floors. The stairs come from the detection (opts.stairs / refStairs in the
 *              detect.stairs shape { bbox: [x0, y0, x1, y1] pixels, axis, treads, kind }, else the levels' stairHints)
 *              and, on a floor where it found none but the image is given, from a small finder here (findStairs:
 *              evenly spaced thin tread lines, winders fanning out).
 *              – With the plan images (opts.img / refImg) each stair's thin lines are searched for in the other
 *                floor's drawing (matchStairDrawing, a coarse-to-fine chamfer match to 1 cm). A flight looks much the
 *                same one tread further on, so a match counts when a second search or the outline agrees, or when it
 *                is clearly best and a clear outline does not contradict it.
 *              – Without them, boxes of about the same size are paired (pairBoxes). A detector's false box pairs with
 *                anything its size, so a pair needs the outline (or, where that is weak or ambiguous, the walls near
 *                the stair) to agree; a pair a clear outline contradicts leaves it to the outline.
 *   • outline: the exterior wall bands are rasterised at 5 cm, the shift with the most overlap is searched within
 *              ±2 m (around the corner and centre alignments of the outer boxes) and refined to 1 cm on the outer faces.
 *              Two peaks within 7 % of each other (a floor longer than the other) leave it to the corner.
 *   • corner:  alignLevel in export.js (avstemming V1: an outer corner flush with the reference's), the reserve: the
 *              given corner, or north-east, or the corner that lies on one of the outline's equal peaks.
 *
 * The finder and the line search run on a copy at about 50 px/m (block minimum, a black top-hat, Zhang–Suen thinning),
 * cached per image: 0.2–0.5 s per plan in Node, about 1.5 s for a 3300–4800 px sheet.
 */
import { add, sub, round } from './geom.js';
import { wallBand } from './regions.js';
import { distanceToMask } from './image.js';
import { outerCorner, northFrame } from './export.js';

export const ALIGN_DEFAULTS = Object.freeze({
  range: 2.0, // m: the outline search window around each start
  coarse: 0.05, // m: the band raster
  fine: 0.01, // m: the face raster for the refinement
  faceTol: 0.03, // m: an outer face within this of the reference's counts (linearly less with the distance)
  minOutline: 0.3, // share of the smaller outline that must overlap for the outline to be trusted
  clearOutline: 0.5, // … and for it to overrule a stair (a box pair or an unbacked drawing match) that disagrees,
  minCoverage: 0.25, // … with this share of the larger outline too (a partial plan's few walls can lie on any band)
  ambiguous: 0.93, // a second peak (≥ 0.3 m away) this close to the best makes the outline unsure
  minStair: 0.6, // the least drawing-match score (8 cm tolerance) for a stair
  backing: 0.85, // another search (or the outline) backs a match with a peak this strong within 10 cm of it
  clearStair: 0.75, // an unbacked match needs this score …
  stairDistinct: 0.93, // … and no peak 0.4 m away within this share of it
  outlineVeto: 0.5, // … and, when the outline is strong (≥ clearOutline), at least this share of its best overlap
  maxStairs: 4, // stair boxes searched per floor (best first)
  maxPositions: 4e5, // coarse positions per drawing search; past it the coarse step grows
});

// ---------------------------------------------------------------------------------------------------------------
// Rasters of a level's walls (in its own plan frame)

/** Fills a convex polygon (plan metres) into a raster grid { x0, y0, res, w, h, data } with value v. */
function fillConvex(g, poly, v = 1) {
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of poly) {
    minY = Math.min(minY, p[1]);
    maxY = Math.max(maxY, p[1]);
  }
  const j0 = Math.max(0, Math.ceil((minY - g.y0) / g.res - 0.5));
  const j1 = Math.min(g.h - 1, Math.floor((maxY - g.y0) / g.res - 0.5));
  for (let j = j0; j <= j1; j++) {
    const y = g.y0 + (j + 0.5) * g.res;
    let xa = Infinity;
    let xb = -Infinity;
    for (let k = 0, n = poly.length; k < n; k++) {
      const p = poly[k];
      const q = poly[(k + 1) % n];
      if ((p[1] - y) * (q[1] - y) > 0 || p[1] === q[1]) {
        if (p[1] === y) {
          xa = Math.min(xa, p[0]);
          xb = Math.max(xb, p[0]);
        }
        continue;
      }
      const x = p[0] + ((y - p[1]) / (q[1] - p[1])) * (q[0] - p[0]);
      xa = Math.min(xa, x);
      xb = Math.max(xb, x);
    }
    if (!(xb >= xa)) continue;
    const i0 = Math.max(0, Math.ceil((xa - g.x0) / g.res - 0.5));
    const i1 = Math.min(g.w - 1, Math.floor((xb - g.x0) / g.res - 0.5));
    for (let i = i0; i <= i1; i++) g.data[j * g.w + i] = v;
  }
}

/**
 * The walls of a level as rasters at res: `band` (all walls, value = wall index + 1), `ext` (the bands of the walls
 * that touch the outside), `face` (ext cells next to the outside: the outer face) and `outside`.
 */
export function wallRasters(walls, res, margin = 0.3) {
  const good = (walls || []).filter((w) => w && w.t > 0 && Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]) > 1e-3);
  if (!good.length) return null;
  const bands = good.map((w) => wallBand(w, good));
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const b of bands) {
    for (const p of b) {
      minX = Math.min(minX, p[0]);
      minY = Math.min(minY, p[1]);
      maxX = Math.max(maxX, p[0]);
      maxY = Math.max(maxY, p[1]);
    }
  }
  const x0 = minX - margin;
  const y0 = minY - margin;
  const w = Math.ceil((maxX - x0 + margin) / res) + 1;
  const h = Math.ceil((maxY - y0 + margin) / res) + 1;
  if (w * h > 16e6) return null;
  const band = { x0, y0, res, w, h, data: new Int32Array(w * h) };
  bands.forEach((poly, k) => fillConvex(band, poly, k + 1));
  // outside: flood fill of the free cells from the border
  const outside = new Uint8Array(w * h);
  const stack = new Int32Array(w * h);
  let top = 0;
  const push = (i) => {
    if (!outside[i] && !band.data[i]) {
      outside[i] = 1;
      stack[top++] = i;
    }
  };
  for (let i = 0; i < w; i++) {
    push(i);
    push((h - 1) * w + i);
  }
  for (let j = 0; j < h; j++) {
    push(j * w);
    push(j * w + w - 1);
  }
  while (top) {
    const p = stack[--top];
    const x = p % w;
    if (x > 0) push(p - 1);
    if (x < w - 1) push(p + 1);
    if (p >= w) push(p - w);
    if (p < w * (h - 1)) push(p + w);
  }
  // exterior walls: some cell of their band next to the outside
  const touches = new Uint8Array(good.length + 1);
  const nextToOutside = (p) => {
    const x = p % w;
    return (x > 0 && outside[p - 1]) || (x < w - 1 && outside[p + 1]) || (p >= w && outside[p - w]) || (p < w * (h - 1) && outside[p + w]);
  };
  for (let p = 0; p < w * h; p++) if (band.data[p] && nextToOutside(p)) touches[band.data[p]] = 1;
  const ext = new Uint8Array(w * h);
  const face = new Uint8Array(w * h);
  let nExt = 0;
  let nFace = 0;
  // the exterior bands again on their own (a band drawn under a later interior wall still counts)
  const extGrid = { x0, y0, res, w, h, data: ext };
  good.forEach((wl, k) => {
    if (touches[k + 1]) fillConvex(extGrid, bands[k], 1);
  });
  for (let p = 0; p < w * h; p++) {
    if (!ext[p]) continue;
    nExt++;
    if (nextToOutside(p)) {
      face[p] = 1;
      nFace++;
    }
  }
  return { x0, y0, res, w, h, band: band.data, ext, face, outside, nExt, nFace, exteriorWalls: good.filter((_, k) => touches[k + 1]), box: [minX, minY, maxX, maxY] };
}

/** Plan-metre centres of the set cells of a mask. */
function cellCentres(R, mask) {
  const pts = [];
  for (let j = 0; j < R.h; j++) {
    for (let i = 0; i < R.w; i++) if (mask[j * R.w + i]) pts.push(R.x0 + (i + 0.5) * R.res, R.y0 + (j + 0.5) * R.res);
  }
  return Float64Array.from(pts);
}

/** How many of the points (level frame), shifted by t, land on set cells of the reference mask. */
function overlapAt(pts, R, mask, tx, ty) {
  let n = 0;
  const k = 1 / R.res;
  for (let q = 0; q < pts.length; q += 2) {
    const i = Math.floor((pts[q] + tx - R.x0) * k);
    const j = Math.floor((pts[q + 1] + ty - R.y0) * k);
    if (i >= 0 && j >= 0 && i < R.w && j < R.h && mask[j * R.w + i]) n++;
  }
  return n;
}

// ---------------------------------------------------------------------------------------------------------------
// Outline

/**
 * The outline search: the shift t (level frame → ref frame) with the most overlap of the exterior wall bands, searched
 * on the coarse lattice within ±range of each start, then refined on the outer faces at `fine`.
 * @returns {{ t, overlap, share, coverage, second, ambiguous, peaks, at(t), near(t, r), refine(t) } | null}  share: the
 *   best overlap as a share of the smaller outline, coverage: of the larger
 */
export function outlineSearch(level, ref, opts = {}) {
  const o = { ...ALIGN_DEFAULTS, ...opts };
  const A = wallRasters(ref.walls, o.coarse);
  const B = wallRasters(level.walls, o.coarse);
  if (!A || !B || !A.nExt || !B.nExt) return null;
  const pts = cellCentres(B, B.ext);
  // starts: the four corners and the centre of the outer boxes lined up (and the shift given by the caller)
  const [ax0, ay0, ax1, ay1] = A.box;
  const [bx0, by0, bx1, by1] = B.box;
  const starts = [
    [ax0 - bx0, ay0 - by0],
    [ax1 - bx1, ay0 - by0],
    [ax0 - bx0, ay1 - by1],
    [ax1 - bx1, ay1 - by1],
    [(ax0 + ax1 - bx0 - bx1) / 2, (ay0 + ay1 - by0 - by1) / 2],
    ...(o.starts || []),
  ];
  const step = o.coarse;
  const n = Math.round(o.range / step);
  const scores = new Map();
  const key = (i, j) => `${i},${j}`;
  for (const s of starts) {
    const ci = Math.round(s[0] / step);
    const cj = Math.round(s[1] / step);
    for (let j = cj - n; j <= cj + n; j++) {
      for (let i = ci - n; i <= ci + n; i++) {
        const kk = key(i, j);
        if (scores.has(kk)) continue;
        scores.set(kk, overlapAt(pts, A, A.ext, i * step, j * step));
      }
    }
  }
  // peaks: local maxima, best first
  const list = [...scores.entries()].map(([k, v]) => {
    const [i, j] = k.split(',').map(Number);
    return { i, j, v };
  });
  list.sort((p, q) => q.v - p.v);
  const best = list[0];
  if (!best || best.v <= 0) return null;
  const sep = Math.round(0.3 / step);
  const peaks = [];
  for (const p of list) {
    if (p.v < best.v * 0.5 || peaks.length >= 8) break;
    if (peaks.some((q) => Math.abs(q.i - p.i) <= sep && Math.abs(q.j - p.j) <= sep)) continue;
    peaks.push(p);
  }
  const denom = Math.min(A.nExt, B.nExt);
  const ctx = faceContext(level, ref, o);
  const refined = peaks.slice(0, 4).map((p) => ({ ...refineOnFaces(level, ref, [p.i * step, p.j * step], o, ctx), coarse: p.v / denom }));
  const scoreAt = (i, j) => {
    const kk = key(i, j);
    if (!scores.has(kk)) scores.set(kk, overlapAt(pts, A, A.ext, i * step, j * step));
    return scores.get(kk);
  };
  return {
    t: refined[0].t,
    overlap: best.v,
    share: best.v / denom,
    coverage: best.v / Math.max(A.nExt, B.nExt),
    second: peaks[1] ? peaks[1].v / best.v : 0,
    ambiguous: peaks[1] ? peaks[1].v / best.v >= o.ambiguous : false,
    peaks: refined,
    rasters: { A, B },
    // the overlap at a shift (best of ±5 cm) as a share of the best
    at: (t) => {
      let v = 0;
      for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) v = Math.max(v, overlapAt(pts, A, A.ext, t[0] + i * step, t[1] + j * step));
      return v / best.v;
    },
    // the best lattice shift within ±r of t: { v (a share of the best), t }
    near: (t, r) => {
      let b = { v: -1, i: 0, j: 0 };
      const ci = Math.round(t[0] / step);
      const cj = Math.round(t[1] / step);
      const ni = Math.max(1, Math.round(r[0] / step));
      const nj = Math.max(1, Math.round(r[1] / step));
      for (let j = cj - nj; j <= cj + nj; j++) {
        for (let i = ci - ni; i <= ci + ni; i++) {
          const v = scoreAt(i, j);
          if (v > b.v) b = { v, i, j };
        }
      }
      return { v: b.v / best.v, t: [b.i * step, b.j * step] };
    },
    // a lattice shift refined on the outer faces (1 cm)
    refine: (t) => refineOnFaces(level, ref, t, o, ctx).t,
  };
}

/** The fine rasters of both levels' outer faces, the reference's distance map and the level's face cells. */
function faceContext(level, ref, o) {
  const fine = o.fine ?? ALIGN_DEFAULTS.fine;
  const A = wallRasters(ref.walls, fine);
  const B = wallRasters(level.walls, fine);
  if (!A || !B || !A.nFace || !B.nFace) return null;
  return { A, B, D: distanceToMask({ w: A.w, h: A.h, data: A.face }).data, pts: cellCentres(B, B.face) };
}

/** The outer faces at `fine`: the shift within ±(coarse + 3 cm) of t0 where the level's face lies on the ref's. */
export function refineOnFaces(level, ref, t0, opts = {}, ctx = faceContext(level, ref, opts)) {
  const o = { ...ALIGN_DEFAULTS, ...opts };
  if (!ctx) return { t: t0, face: 0 };
  const { A, B, D, pts } = ctx;
  const tol = o.faceTol / o.fine;
  const k = 1 / A.res;
  const n = Math.round((o.coarse + 0.03) / o.fine);
  let best = { s: -1, t: t0 };
  const score = (tx, ty) => {
    let s = 0;
    for (let q = 0; q < pts.length; q += 2) {
      const i = Math.floor((pts[q] + tx - A.x0) * k);
      const j = Math.floor((pts[q + 1] + ty - A.y0) * k);
      if (i < 0 || j < 0 || i >= A.w || j >= A.h) continue;
      const d = D[j * A.w + i];
      if (d < tol) s += 1 - d / tol;
    }
    return s;
  };
  for (let j = -n; j <= n; j++) {
    for (let i = -n; i <= n; i++) {
      const tx = t0[0] + i * o.fine;
      const ty = t0[1] + j * o.fine;
      const s = score(tx, ty);
      // ties: the one nearest the coarse shift
      if (s > best.s + 1e-9 || (Math.abs(s - best.s) <= 1e-9 && Math.hypot(i, j) < best.r)) best = { s, t: [tx, ty], r: Math.hypot(i, j) };
    }
  }
  return { t: best.t, face: best.s / Math.min(A.nFace, B.nFace) };
}

// ---------------------------------------------------------------------------------------------------------------
// The fallback stair finder (until detect.stairs exists): thin straight lines, grouped into treads

/** Grey max (dilate) or min (erode) filter along one axis, window 2r + 1 (outside the raster is ignored). */
function greyFilter(g, r, axis, max) {
  const { w, h } = g;
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = max ? 0 : 255;
      for (let k = -r; k <= r; k++) {
        const xx = axis === 'h' ? x + k : x;
        const yy = axis === 'h' ? y : y + k;
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        const s = g.data[yy * w + xx];
        v = max ? Math.max(v, s) : Math.min(v, s);
      }
      out[y * w + x] = v;
    }
  }
  return { w, h, data: out };
}

/**
 * The plan in grey at about 50 px/m (block minimum, so thin lines keep their darkness) and the mask of its thin dark
 * lines (a black top-hat: darker than the grey closing by `contrast`, so lines on a tinted stair fill count too).
 */
function thinLines(img, pxPerM, contrast = 22) {
  const f = Math.max(1, Math.round(pxPerM / 50));
  const w = Math.floor(img.width / f);
  const h = Math.floor(img.height / f);
  const g = { w, h, data: new Uint8Array(w * h) };
  const d = img.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let m = 255;
      for (let dy = 0; dy < f; dy++) {
        for (let dx = 0; dx < f; dx++) {
          const j = ((y * f + dy) * img.width + x * f + dx) * 4;
          const a = d[j + 3] / 255;
          const l = (0.299 * d[j] + 0.587 * d[j + 1] + 0.114 * d[j + 2]) * a + 255 * (1 - a);
          if (l < m) m = l;
        }
      }
      g.data[y * w + x] = m;
    }
  }
  const r = 2;
  const closed = greyFilter(greyFilter(greyFilter(greyFilter(g, r, 'h', true), r, 'v', true), r, 'h', false), r, 'v', false);
  const mask = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) mask[i] = closed.data[i] - g.data[i] >= contrast ? 1 : 0;
  return { f, ppm: pxPerM / f, w, h, mask: thin(mask, w, h) };
}

/**
 * Zhang–Suen thinning: the strokes become one pixel wide, so a line has its own sharp Hough peak and a line merely
 * crossing others gets only a pixel from each.
 */
function thin(src, w, h) {
  const m = src.slice();
  for (let x = 0; x < w; x++) m[x] = m[(h - 1) * w + x] = 0;
  for (let y = 0; y < h; y++) m[y * w] = m[y * w + w - 1] = 0;
  let live = [];
  for (let i = 0; i < w * h; i++) if (m[i]) live.push(i);
  const del = [];
  for (let changed = true; changed; ) {
    changed = false;
    for (let pass = 0; pass < 2; pass++) {
      del.length = 0;
      for (const i of live) {
        if (!m[i]) continue;
        const p2 = m[i - w];
        const p3 = m[i - w + 1];
        const p4 = m[i + 1];
        const p5 = m[i + w + 1];
        const p6 = m[i + w];
        const p7 = m[i + w - 1];
        const p8 = m[i - 1];
        const p9 = m[i - w - 1];
        const B = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9;
        if (B < 2 || B > 6) continue;
        const A = (!p2 && p3) + (!p3 && p4) + (!p4 && p5) + (!p5 && p6) + (!p6 && p7) + (!p7 && p8) + (!p8 && p9) + (!p9 && p2);
        if (A !== 1) continue;
        if (pass === 0 ? p2 * p4 * p6 || p4 * p6 * p8 : p2 * p4 * p8 || p2 * p6 * p8) continue;
        del.push(i);
      }
      for (const i of del) m[i] = 0;
      if (del.length) changed = true;
    }
    live = live.filter((i) => m[i]);
  }
  return m;
}

/** Principal axis of the points [x, y, s, …]: { c, v } or null. */
function fitLine(pts) {
  const n = pts.length / 3;
  if (n < 4) return null;
  let mx = 0;
  let my = 0;
  for (let q = 0; q < pts.length; q += 3) {
    mx += pts[q];
    my += pts[q + 1];
  }
  mx /= n;
  my /= n;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (let q = 0; q < pts.length; q += 3) {
    const ex = pts[q] - mx;
    const ey = pts[q + 1] - my;
    sxx += ex * ex;
    syy += ey * ey;
    sxy += ex * ey;
  }
  const th = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  return { c: [mx, my], v: [Math.cos(th), Math.sin(th)] };
}

/**
 * Straight thin-line segments: a Hough transform on the thinned line mask (1° and 1 px bins), the peaks read
 * strongest first from the pixels that voted for them (±1 px, gaps up to maxGap, so dashed lines count). Each run is
 * fitted to its stroke (principal axis) and walked again on the fitted line. It is a segment when it is long and full
 * enough and thin – the mask is free `side` pixels to both sides of most of its hits, so a line through a cluster of
 * text or across other lines is not one. Its pixels are then taken out, so weaker peaks cannot reuse them. Runs longer
 * than maxLen come back marked `long`. Pixels of the working raster.
 */
function lineSegments(L, { minLen, maxLen, maxGap, minFill = 0.4, side = 3, minClean = 0.6 }) {
  const { w, h } = L;
  const orig = L.mask;
  const mask = orig.slice();
  const nT = 180;
  const cos = new Float64Array(nT);
  const sin = new Float64Array(nT);
  for (let t = 0; t < nT; t++) {
    cos[t] = Math.cos((t * Math.PI) / nT);
    sin[t] = Math.sin((t * Math.PI) / nT);
  }
  const diag = Math.ceil(Math.hypot(w, h));
  const nR = 2 * diag + 1;
  const acc = new Uint16Array(nT * nR);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!orig[y * w + x]) continue;
      for (let t = 0; t < nT; t++) {
        const r = Math.floor(x * cos[t] + y * sin[t] + diag);
        if (acc[t * nR + r] < 65535) acc[t * nR + r]++;
      }
    }
  }
  // the peaks: local maxima over ±2 angle bins (wrapping) and ±1 distance bins, strongest first
  const minVotes = Math.max(8, Math.round(minLen * minFill));
  const peaks = [];
  for (let t = 0; t < nT; t++) {
    for (let r = 0; r < nR; r++) {
      const v = acc[t * nR + r];
      if (v < minVotes) continue;
      let peak = true;
      for (let dt = -2; dt <= 2 && peak; dt++) {
        for (let dr = -1; dr <= 1; dr++) {
          if (!dt && !dr) continue;
          let tt = t + dt;
          let rr = r + dr;
          if (tt < 0 || tt >= nT) {
            tt = (tt + nT) % nT;
            rr = nR - 1 - rr;
          }
          if (rr < 0 || rr >= nR) continue;
          const u = acc[tt * nR + rr];
          if (u > v || (u === v && (dt < 0 || (dt === 0 && dr < 0)))) {
            peak = false;
            break;
          }
        }
      }
      if (peak) peaks.push(v * 65536 * 256 + t * 65536 + r);
    }
  }
  peaks.sort((a, b) => b - a);
  // the pixels of every bin near a peak, so a peak line is read from its votes and not walked pixel by pixel
  const needed = (b) => acc[b] >= minVotes || (b % nR > 0 && acc[b - 1] >= minVotes) || (b % nR < nR - 1 && acc[b + 1] >= minVotes);
  const start = new Int32Array(nT * nR + 1);
  for (let b = 0; b < nT * nR; b++) start[b + 1] = start[b] + (needed(b) ? acc[b] : 0);
  const idx = new Int32Array(start[nT * nR]);
  const fill = start.slice(0, nT * nR);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      if (!orig[p]) continue;
      for (let t = 0; t < nT; t++) {
        const b = t * nR + Math.floor(x * cos[t] + y * sin[t] + diag);
        if (fill[b] < start[b + 1]) idx[fill[b]++] = p;
      }
    }
  }
  const at = (m, x, y) => {
    const xi = Math.round(x);
    const yi = Math.round(y);
    return xi >= 0 && yi >= 0 && xi < w && yi < h && m[yi * w + xi] === 1;
  };
  /** Runs along the line c + s·u (s from s0 to s1): hits within ±1 px of the line, gaps up to maxGap. */
  const walk = (c, u, s0, s1) => {
    const n = [-u[1], u[0]];
    const runs = [];
    let run = null;
    for (let s = Math.floor(s0); s <= Math.ceil(s1) + maxGap + 1; s++) {
      const x = c[0] + s * u[0];
      const y = c[1] + s * u[1];
      let hit = false;
      if (s <= s1) {
        hit = at(mask, x, y) || at(mask, x + n[0], y + n[1]) || at(mask, x - n[0], y - n[1]);
      }
      if (hit) {
        if (!run) run = { first: s, last: s, hits: 0, clean: 0 };
        run.last = s;
        run.hits++;
        const sideHit = (k) => at(orig, x + k * n[0], y + k * n[1]) || at(orig, x - k * n[0], y - k * n[1]);
        if (!sideHit(side) && !sideHit(side + 1)) run.clean++;
      } else if (run && s - run.last > maxGap) {
        runs.push(run);
        run = null;
      }
    }
    return runs;
  };
  /** The mask pixels within tol of the line c + s·v, s0 ≤ s ≤ s1, as [x, y, s, …]. */
  const seen = new Uint32Array(w * h); // a stamp per call instead of a Set: band() runs a few thousand times
  let stamp = 0;
  const band = (c, v, s0, s1, tol) => {
    stamp++;
    const out = [];
    const n = [-v[1], v[0]];
    const K = Math.ceil(tol);
    for (let s = Math.floor(s0); s <= Math.ceil(s1); s++) {
      for (let k = -K; k <= K; k++) {
        const xi = Math.round(c[0] + s * v[0] + k * n[0]);
        const yi = Math.round(c[1] + s * v[1] + k * n[1]);
        if (xi < 0 || yi < 0 || xi >= w || yi >= h || !mask[yi * w + xi]) continue;
        const id = yi * w + xi;
        if (seen[id] === stamp || Math.abs((xi - c[0]) * n[0] + (yi - c[1]) * n[1]) > tol) continue;
        seen[id] = stamp;
        out.push(xi, yi, s);
      }
    }
    return out;
  };
  /** The runs of a peak line from the pixels of its bin and the two next to it (±1 px), gaps up to maxGap. */
  const runsOf = (t, r, c, u) => {
    const ss = [];
    for (let rr = r - 1; rr <= r + 1; rr++) {
      if (rr < 0 || rr >= nR) continue;
      const b = t * nR + rr;
      for (let k = start[b]; k < start[b + 1]; k++) {
        const p = idx[k];
        if (!mask[p]) continue;
        const x = p % w;
        ss.push(Math.round(x * u[0] + ((p - x) / w) * u[1]));
      }
    }
    if (ss.length < minVotes * 0.8) return [];
    ss.sort((a, b) => a - b);
    const n = [-u[1], u[0]];
    const runs = [];
    let run = null;
    let last = null;
    for (const s of ss) {
      if (s === last) continue;
      last = s;
      if (run && s - run.last > maxGap + 1) {
        runs.push(run);
        run = null;
      }
      if (!run) run = { first: s, last: s, hits: 0, clean: 0 };
      run.last = s;
      run.hits++;
      const x = c[0] + s * u[0];
      const y = c[1] + s * u[1];
      const sideHit = (k) => at(orig, x + k * n[0], y + k * n[1]) || at(orig, x - k * n[0], y - k * n[1]);
      if (!sideHit(side) && !sideHit(side + 1)) run.clean++;
    }
    if (run) runs.push(run);
    return runs;
  };
  const segs = [];
  for (const code of peaks) {
    const t = Math.floor(code / 65536) % 256;
    const rho = (code % 65536) + 0.5 - diag;
    const nrm = [cos[t], sin[t]];
    const u = [-nrm[1], nrm[0]];
    const c = [rho * nrm[0], rho * nrm[1]];
    const runs = runsOf(t, code % 65536, c, u);
    for (const r0 of runs) {
      if (r0.last - r0.first + 1 < minLen || r0.hits / (r0.last - r0.first + 1) < minFill * 0.8) continue;
      // fit the stroke (principal axis) to the line pixels within 2.5 px, a few times over, so a stroke three pixels
      // thick is fitted along its middle even when the peak line crossed it at a slant; last within 1.5 px, so a line
      // crossing it does not tilt it; then walk the fitted line
      const orient = (l, ref) => (l && l.v[0] * ref[0] + l.v[1] * ref[1] < 0 ? { c: l.c, v: [-l.v[0], -l.v[1]] } : l);
      let line = { c, v: u };
      let s0 = r0.first;
      let s1 = r0.last;
      for (const tol of [2.5, 2.5, 2.5, 2.5, 1.5]) {
        const next = orient(fitLine(band(line.c, line.v, s0, s1, tol)), line.v);
        if (!next) break;
        const sOf = (s) => (line.c[0] + s * line.v[0] - next.c[0]) * next.v[0] + (line.c[1] + s * line.v[1] - next.c[1]) * next.v[1];
        [s0, s1] = [Math.min(sOf(s0), sOf(s1)), Math.max(sOf(s0), sOf(s1))];
        line = next;
      }
      // the fitted line may reach further than the run on the slightly tilted peak line: walk it out to maxLen
      const half = Math.max((r0.last - r0.first) / 2, maxLen / 2) + maxGap;
      const near0 = (q) => q.first <= maxGap && q.last >= -maxGap;
      const mx = line.c[0];
      const my = line.c[1];
      const v = line.v;
      const fitted = walk([mx, my], v, -half, half);
      // the fitted run through the middle of the old one
      const r = fitted.find(near0) ?? fitted.sort((p, q) => q.hits - p.hits)[0];
      if (!r) continue;
      const len = r.last - r.first + 1;
      if (len < minLen || r.hits / len < minFill || r.clean / r.hits < minClean) continue;
      // a clean long line (hatching, a dimension line, a tile joint) is used up too, and marked: it is no tread
      for (let s = r.first; s <= r.last; s++) {
        for (let k = -1; k <= 1; k++) {
          const xi = Math.round(mx + s * v[0] - k * v[1]);
          const yi = Math.round(my + s * v[1] + k * v[0]);
          if (xi >= 0 && yi >= 0 && xi < w && yi < h) mask[yi * w + xi] = 0;
        }
      }
      segs.push({ a: [mx + r.first * v[0], my + r.first * v[1]], b: [mx + r.last * v[0], my + r.last * v[1]], fill: r.hits / len, clean: r.clean / r.hits, long: len > maxLen });
    }
  }
  return segs.map((s) => {
    const d = [s.b[0] - s.a[0], s.b[1] - s.a[1]];
    const len = Math.hypot(d[0], d[1]);
    const u = [d[0] / len, d[1] / len];
    const ang = ((Math.atan2(u[1], u[0]) * 180) / Math.PI + 180) % 180;
    return { ...s, len, u, n: [-u[1], u[0]], ang, mid: [(s.a[0] + s.b[0]) / 2, (s.a[1] + s.b[1]) / 2] };
  });
}

const angDiff = (a, b) => {
  const d = Math.abs(a - b) % 180;
  return Math.min(d, 180 - d);
};

/** Overlap along a's direction of b's projection with a's extent, in pixels. */
function alongOverlap(a, b) {
  const p = (q) => (q[0] - a.a[0]) * a.u[0] + (q[1] - a.a[1]) * a.u[1];
  const s0 = Math.min(p(b.a), p(b.b));
  const s1 = Math.max(p(b.a), p(b.b));
  return Math.min(a.len, s1) - Math.max(0, s0);
}

function segmentsCross(a, b) {
  const c = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  return c(a.a, a.b, b.a) * c(a.a, a.b, b.b) < 0 && c(b.a, b.b, a.a) * c(b.a, b.b, a.b) < 0;
}

/** Union–find components of the items under a pair predicate. */
function componentsOf(items, linked) {
  const parent = items.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) if (linked(items[i], items[j])) parent[find(i)] = find(j);
  const groups = new Map();
  items.forEach((s, i) => {
    const r = find(i);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(s);
  });
  return [...groups.values()];
}

/** Where the infinite lines of two segments meet (null when parallel). */
function lineMeet(a, b) {
  const den = a.u[0] * b.u[1] - a.u[1] * b.u[0];
  if (Math.abs(den) < 1e-9) return null;
  const t = ((b.a[0] - a.a[0]) * b.u[1] - (b.a[1] - a.a[1]) * b.u[0]) / den;
  return [a.a[0] + t * a.u[0], a.a[1] + t * a.u[1]];
}

const distTo = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]);

/**
 * Stairs on a plan image, in the shape of detect.stairs: [{ bbox: [x0, y0, x1, y1] pixels, axis: 'x'|'y' (the run),
 * treads, kind, source }]. A small classical finder for when the detection has none (cached per image and scale),
 * from thin straight lines 0.4–1.7 m long (lineSegments):
 *   • treads follow each other: parallel, side by side and 0.15–0.8 m apart (a missed tread leaves a double step),
 *     or turning – winders 4–35° apart whose lines meet near one end of each and fan apart at the other;
 *   • a group of three or more is stair-like when its parallel lines are evenly 0.17–0.42 m apart, or when it has
 *     three winders sweeping 15° or more; groups whose boxes touch (within 0.25 m) are one stair of six treads or more.
 * Floor hatching (parallel lines closer than 0.165 m) is left out first, a flight crossed by three parallel lines is a
 * tile grid, and a flight's box ends at the treads' median ends (a line that runs on into a wall does not widen it).
 * `debug`: an object that receives the line mask, the segments and the groups (for tools).
 */
export function findStairs(img, { pxPerM, debug = null } = {}) {
  if (!img || !(pxPerM > 0)) return [];
  const L = planLines(img, pxPerM);
  if (L.stairs && !debug) return L.stairs.map((s) => ({ ...s, bbox: [...s.bbox] }));
  const m = L.ppm;
  const lines = lineSegments(L, { minLen: 0.4 * m, maxLen: 1.7 * m, maxGap: Math.max(2, Math.round(0.22 * m)) });
  let segs = lines.filter((s) => !s.long);
  // the same line found twice: keep the fuller one
  segs.sort((p, q) => q.len * q.fill - p.len * p.fill);
  const kept = [];
  for (const s of segs) {
    const dup = kept.some((k) => angDiff(k.ang, s.ang) <= 4 && Math.abs((s.mid[0] - k.mid[0]) * k.n[0] + (s.mid[1] - k.mid[1]) * k.n[1]) <= 0.05 * m && alongOverlap(k, s) >= 0.5 * Math.min(k.len, s.len));
    if (!dup) kept.push(s);
  }
  // floor hatching: parallel lines closer than a tread
  const hatch = new Set();
  for (let i = 0; i < kept.length; i++) {
    for (let j = i + 1; j < kept.length; j++) {
      const a = kept[i];
      const b = kept[j];
      if (angDiff(a.ang, b.ang) > 3) continue;
      const dp = Math.abs((b.mid[0] - a.mid[0]) * a.n[0] + (b.mid[1] - a.mid[1]) * a.n[1]);
      if (dp > 0.05 * m && dp < 0.165 * m && alongOverlap(a, b) >= 0.5 * Math.min(a.len, b.len)) hatch.add(a).add(b);
    }
  }
  segs = kept.filter((s) => !hatch.has(s));
  // ---- treads that follow each other: parallel a tread apart (a missed tread leaves a double step), or turning –
  // winders whose lines meet near one end of each and fan apart at the other
  const dpOf = (a, b) => Math.abs((b.mid[0] - a.mid[0]) * a.n[0] + (b.mid[1] - a.mid[1]) * a.n[1]);
  const sideBySide = (a, b, maxDp) => {
    if (Math.min(a.len, b.len) < 0.5 * Math.max(a.len, b.len)) return false;
    const dp = dpOf(a, b);
    return dp >= 0.15 * m && dp <= maxDp && alongOverlap(a, b) >= 0.6 * Math.min(a.len, b.len);
  };
  const turning = (a, b) => {
    if (Math.min(a.len, b.len) < 0.4 * Math.max(a.len, b.len)) return false;
    const x = lineMeet(a, b);
    if (!x) return false;
    const ea = Math.min(distTo(x, a.a), distTo(x, a.b));
    const eb = Math.min(distTo(x, b.a), distTo(x, b.b));
    if (ea > 0.6 * m || eb > 0.6 * m) return false;
    const inside = (s) => {
      const t = (x[0] - s.a[0]) * s.u[0] + (x[1] - s.a[1]) * s.u[1];
      return t > 0.12 * m && t < s.len - 0.12 * m;
    };
    if (inside(a) || inside(b)) return false;
    const fa = distTo(x, a.a) > distTo(x, a.b) ? a.a : a.b;
    const fb = distTo(x, b.a) > distTo(x, b.b) ? b.a : b.b;
    return distTo(fa, fb) >= 0.12 * m && distTo(fa, fb) <= 0.7 * m;
  };
  const follows = (a, b) => {
    const d = angDiff(a.ang, b.ang);
    if (d > 35 || segmentsCross(a, b)) return false;
    if (d <= 4) return sideBySide(a, b, 0.8 * m);
    // the last straight tread next to the first winder
    if (d <= 10 && sideBySide(a, b, 0.5 * m)) return true;
    return turning(a, b);
  };
  const median = (xs) => [...xs].sort((p, q) => p - q)[xs.length >> 1];
  /** A flight inside a part: the lines within 4° of the most common angle, one per tread position. */
  const flightOf = (g) => {
    const best = g
      .map((s) => g.filter((t) => angDiff(t.ang, s.ang) <= 4))
      .sort((p, q) => q.length - p.length)[0];
    const n = best[0].n;
    const u = best[0].u;
    const cOf = (s) => s.mid[0] * n[0] + s.mid[1] * n[1];
    const fl = [];
    for (const s of [...best].sort((p, q) => q.len - p.len)) if (!fl.some((t) => Math.abs(cOf(t) - cOf(s)) < 0.08 * m)) fl.push(s);
    if (fl.length < 3) return null;
    const c = fl.map(cOf).sort((p, q) => p - q);
    const gaps = c.slice(1).map((v, i) => v - c[i]);
    const med = median(gaps);
    // even steps (a missed tread makes a double or triple one)
    const even = gaps.filter((x) => {
      const k = Math.round(x / med);
      return k >= 1 && k <= 3 && Math.abs(x / med - k) <= 0.35 * k;
    }).length;
    const regular = med >= 0.17 * m && med <= 0.42 * m && even >= 0.75 * gaps.length;
    // its box: the treads' median ends along them (a line that runs on into the next thing does not widen it)
    const ends = fl.map((s) => {
      const p = s.a[0] * u[0] + s.a[1] * u[1];
      const q = s.b[0] * u[0] + s.b[1] * u[1];
      return [Math.min(p, q), Math.max(p, q)];
    });
    const e0 = median(ends.map((e) => e[0]));
    const e1 = median(ends.map((e) => e[1]));
    const corners = [
      [e0, c[0]],
      [e1, c[0]],
      [e0, c[c.length - 1]],
      [e1, c[c.length - 1]],
    ].map(([s, t]) => [s * u[0] + t * n[0], s * u[1] + t * n[1]]);
    return {
      segs: fl,
      all: best,
      ang: best[0].ang,
      spacing: med / m,
      regular,
      positions: Math.round((c[c.length - 1] - c[0]) / med) + 1,
      box: [Math.min(...corners.map((p) => p[0])), Math.min(...corners.map((p) => p[1])), Math.max(...corners.map((p) => p[0])), Math.max(...corners.map((p) => p[1]))],
    };
  };
  const spanOf = (ss) => {
    const angs = ss.map((s) => s.ang).sort((p, q) => p - q);
    let gap = 180 - angs[angs.length - 1] + angs[0];
    for (let i = 1; i < angs.length; i++) gap = Math.max(gap, angs[i] - angs[i - 1]);
    return 180 - gap;
  };
  const parts = [];
  for (const g of componentsOf(segs, follows)) {
    if (g.length < 3) continue;
    const fl = flightOf(g);
    const winders = fl ? g.filter((s) => !fl.all.includes(s)) : g;
    const span = spanOf(g);
    // stair-like: an even flight, or turning treads
    if (!(fl?.regular || (winders.length >= 3 && span >= 15))) continue;
    // a tile grid: three or more parallel lines crossing three or more of the flight
    if (fl) {
      const cross = lines.filter((s) => !g.includes(s) && angDiff(s.ang, fl.ang) >= 60 && fl.segs.filter((t) => segmentsCross(s, t)).length >= 3);
      if (cross.some((s) => cross.filter((q) => angDiff(q.ang, s.ang) <= 6).length >= 3)) continue;
    }
    const xs = winders.flatMap((s) => [s.a[0], s.b[0]]);
    const ys = winders.flatMap((s) => [s.a[1], s.b[1]]);
    const box = fl ? [...fl.box] : [Infinity, Infinity, -Infinity, -Infinity];
    if (xs.length) {
      box[0] = Math.min(box[0], ...xs);
      box[1] = Math.min(box[1], ...ys);
      box[2] = Math.max(box[2], ...xs);
      box[3] = Math.max(box[3], ...ys);
    }
    parts.push({ segs: g, flight: fl, winders, span, box, treads: (fl?.regular ? fl.positions : fl?.segs.length ?? 0) + winders.length });
  }
  // ---- stairs: parts whose boxes touch (within 0.25 m) – a flight and its winders, a flight broken by a symbol
  const near = 0.25 * m;
  const touch = (a, b) => a.box[0] - near <= b.box[2] && b.box[0] - near <= a.box[2] && a.box[1] - near <= b.box[3] && b.box[1] - near <= a.box[3];
  const stairs = [];
  for (const g of componentsOf(parts, touch)) {
    const treads = g.reduce((k, p) => k + p.treads, 0);
    if (treads < 6) continue;
    const box = [Math.min(...g.map((p) => p.box[0])), Math.min(...g.map((p) => p.box[1])), Math.max(...g.map((p) => p.box[2])), Math.max(...g.map((p) => p.box[3]))];
    const bw = (box[2] - box[0]) / m;
    const bh = (box[3] - box[1]) / m;
    if (Math.min(bw, bh) < 0.5 || Math.max(bw, bh) > 6.5) continue;
    const ss = g.flatMap((p) => p.segs);
    const span = spanOf(ss);
    const turns = g.some((p) => p.winders.length >= 2) || span > 12;
    const kind = !turns ? 'straight' : span >= 150 ? 'half-turn' : span >= 60 ? 'quarter-turn' : 'unknown';
    const main = (g.filter((p) => p.flight).sort((p, q) => q.flight.segs.length - p.flight.segs.length)[0]?.flight ?? { ang: ss[0].ang }).ang;
    stairs.push({ box, treads, kind, main });
  }
  if (debug) Object.assign(debug, { L, kept, hatch, segs, parts, stairs });
  const f = L.f;
  L.stairs = stairs.map((s) => ({
    bbox: s.box.map((v, i) => round(i < 2 ? v * f : (v + 1) * f, 1)),
    // treads lie across the run: horizontal treads → the stair runs along y
    axis: angDiff(s.main, 0) <= 45 ? 'y' : 'x',
    treads: s.treads,
    kind: s.kind,
    source: 'align.findStairs',
  }));
  return L.stairs.map((s) => ({ ...s, bbox: [...s.bbox] }));
}

// ---------------------------------------------------------------------------------------------------------------
// Stair: the boxes paired, or one floor's stair drawing found again in the other's lines

const LINES = new WeakMap();
/** The thin-line skeleton of a plan image and its distance map, cached per image and scale. */
function planLines(img, pxPerM) {
  let per = LINES.get(img);
  if (!per) LINES.set(img, (per = new Map()));
  if (!per.has(pxPerM)) {
    const L = thinLines(img, pxPerM);
    per.set(pxPerM, { ...L, pxPerM, D: distanceToMask({ w: L.w, h: L.h, data: L.mask }).data });
  }
  return per.get(pxPerM);
}

/**
 * The level's stairs as boxes in plan metres, best first: the given ones (detect.stairs shape in pixels, or model.js
 * stairHints with `rect` in metres) in their order, else the ones findStairs finds on its image (most treads first).
 * An empty or missing list is searched on the image unless `find` is false (detect.js misses many stairs that the
 * finder here gets, plantegninger hus3, hus4, hus9); without an image an empty list means none.
 * @returns {{ box: number[], stair: object, source: 'given'|'found' }[]}
 */
export function stairBoxes(level, stairs, img, pxPerM = level?.image?.pxPerM, { find = true } = {}) {
  let list = stairs || [];
  let source = 'given';
  if (!list.length && find && img && pxPerM > 0) {
    list = findStairs(img, { pxPerM }).sort((p, q) => q.treads - p.treads);
    source = 'found';
  }
  return list
    .map((s) => {
      if (Array.isArray(s.rect)) return { box: [Math.min(s.rect[0][0], s.rect[1][0]), Math.min(s.rect[0][1], s.rect[1][1]), Math.max(s.rect[0][0], s.rect[1][0]), Math.max(s.rect[0][1], s.rect[1][1])], stair: s, source };
      const b = Array.isArray(s.bbox) ? s.bbox : s.bbox && [s.bbox.x0, s.bbox.y0, s.bbox.x1, s.bbox.y1];
      if (!b || !(pxPerM > 0)) return null;
      return { box: b.map((v) => v / pxPerM), stair: s, source };
    })
    .filter((s) => s && s.box[2] > s.box[0] && s.box[3] > s.box[1]);
}

const boxSize = (b) => [b[2] - b[0], b[3] - b[1]];
const boxCentre = (b) => [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];

/** Two stair boxes of about the same size (within 0.4 m or 30 %): the IoU when centred on each other, else 0. */
function boxFit(a, b) {
  const [wa, ha] = boxSize(a);
  const [wb, hb] = boxSize(b);
  const ok = (p, q) => Math.abs(p - q) <= Math.max(0.4, 0.3 * Math.max(p, q));
  if (!ok(wa, wb) || !ok(ha, hb)) return 0;
  return (Math.min(wa, wb) * Math.min(ha, hb)) / (Math.max(wa, wb) * Math.max(ha, hb));
}

/**
 * Finds the line drawing of a box of plan A (metres) again in plan B: the shift t (A frame → B frame) where most of
 * A's thin-line pixels in the box lie on B's thin lines (a chamfer score: 1 on a line, falling to 0 at tau). Coarse to
 * fine, so a big sheet costs little more than a small plan:
 *   0. 16 cm steps over the shifts (tolerance 16 cm, 200 points);
 *   1. 8 cm steps (tolerance 12 cm, 400 points) within two coarse steps of the 60 strongest local peaks and one step
 *      of the 300 strongest cells (a straight flight is a plateau a few treads long), the 16 best 16 cm apart kept
 *      (less than a tread);
 *   2. 2 cm steps around those (tolerance 6 cm, 1000 points), then ranked both ways (A's lines on B and B's lines
 *      round the box on A, flat within ±3 cm), so a flight one tread off – a tread line short at each end – loses;
 *   3. 1 cm around the winner (a tight tolerance, all points).
 * The lattices are multiples of their steps, so a drawing found on itself gives exactly 0. The shifts are t ± r
 * (`window`), else those that put the box centre anywhere on B. Past `maxPositions` coarse positions the coarse
 * step grows (and `coarseStep` says so). (Limiting the search to the other floor's walls lost the stair on hus4 and
 * hus9, whose detected walls cover only part of the floor.)
 * @param {{ img, pxPerM }} planA  the plan image (RGBA, as detected) and its scale; planB likewise
 * @param {number[]} boxA  [x0, y0, x1, y1] plan metres of A
 * @param {{ t: [number, number], r: [number, number] } | null} window  the shifts t ± r, or null
 * @param {{ maxPositions?: number }} [opts]
 * @returns {{ t, score, second, peaks: [{ t, s }], fineAt(t), coarseStep, positions } | null}  score: A's lines on B
 *   at t with an 8 cm tolerance; second: the best peak at least 0.4 m from t, as a share of the best (both ways);
 *   peaks: the strongest (5 cm apart or more), s as a share of the best (both ways)
 */
export function matchStairDrawing(planA, boxA, planB, window = null, { maxPositions = ALIGN_DEFAULTS.maxPositions } = {}) {
  const A = planA.mask ? planA : planLines(planA.img, planA.pxPerM);
  const B = planB.mask ? planB : planLines(planB.img, planB.pxPerM);
  const kA = A.f / A.pxPerM; // metres per working pixel of A
  const pad = 0.15;
  const i0 = Math.max(0, Math.floor((boxA[0] - pad) / kA));
  const j0 = Math.max(0, Math.floor((boxA[1] - pad) / kA));
  const i1 = Math.min(A.w - 1, Math.ceil((boxA[2] + pad) / kA));
  const j1 = Math.min(A.h - 1, Math.ceil((boxA[3] + pad) / kA));
  const pts = [];
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) if (A.mask[j * A.w + i]) pts.push((i + 0.5) * kA, (j + 0.5) * kA);
  if (pts.length < 120) return null;
  const kB = B.pxPerM / B.f; // working pixels of B per metre
  const score = (P, tx, ty, tau) => {
    let s = 0;
    for (let q = 0; q < P.length; q += 2) {
      const i = Math.floor((P[q] + tx) * kB);
      const j = Math.floor((P[q + 1] + ty) * kB);
      if (i < 0 || j < 0 || i >= B.w || j >= B.h) continue;
      const d = B.D[j * B.w + i];
      if (d < tau) s += 1 - d / tau;
    }
    return (2 * s) / P.length;
  };
  const subsample = (n) => {
    const stride = Math.max(1, Math.round(pts.length / 2 / n));
    const P = [];
    for (let q = 0; q < pts.length; q += 2 * stride) P.push(pts[q], pts[q + 1]);
    return P;
  };
  /**
   * The ranking score both ways at t: A's lines on B and B's lines on A, where B's are those in A's box grown by
   * 0.35 m (more than a tread, so a tread of B past the end of A's flight counts against t). A point within `flat`
   * of a line counts fully (the lines of two drawings fall on the pixels differently, ±1 px), falling to 0 at
   * flat + 6 cm: one tread further on, a flight is a tread line short at each end.
   */
  const flatB = Math.max(1.5, 0.03 * kB);
  const flatA = Math.max(1.5, 0.03 / kA);
  const trap = (d, flat, run) => (d <= flat ? 1 : d >= flat + run ? 0 : 1 - (d - flat) / run);
  const both = (t) => {
    let f = 0;
    for (let q = 0; q < pts.length; q += 2) {
      const i = Math.floor((pts[q] + t[0]) * kB);
      const j = Math.floor((pts[q + 1] + t[1]) * kB);
      if (i >= 0 && j >= 0 && i < B.w && j < B.h) f += trap(B.D[j * B.w + i], flatB, 0.06 * kB);
    }
    const g = 0.35;
    const x0 = Math.max(0, Math.floor((boxA[0] - g + t[0]) * kB));
    const y0 = Math.max(0, Math.floor((boxA[1] - g + t[1]) * kB));
    const x1 = Math.min(B.w - 1, Math.ceil((boxA[2] + g + t[0]) * kB));
    const y1 = Math.min(B.h - 1, Math.ceil((boxA[3] + g + t[1]) * kB));
    let r = 0;
    let n = 0;
    for (let j = y0; j <= y1; j++) {
      for (let i = x0; i <= x1; i++) {
        if (!B.mask[j * B.w + i]) continue;
        n++;
        const ia = Math.floor(((i + 0.5) / kB - t[0]) / kA);
        const ja = Math.floor(((j + 0.5) / kB - t[1]) / kA);
        if (ia >= 0 && ja >= 0 && ia < A.w && ja < A.h) r += trap(A.D[ja * A.w + ia], flatA, 0.06 / kA);
      }
    }
    return ((2 * f) / pts.length + (n ? r / n : 0)) / 2;
  };
  // the shifts searched
  let lo;
  let hi;
  if (window) {
    lo = [window.t[0] - window.r[0], window.t[1] - window.r[1]];
    hi = [window.t[0] + window.r[0], window.t[1] + window.r[1]];
  } else {
    const [cx, cy] = boxCentre(boxA);
    const wB = (B.w * B.f) / B.pxPerM;
    const hB = (B.h * B.f) / B.pxPerM;
    lo = [-cx, -cy];
    hi = [wB - cx, hB - cy];
  }
  if (!(hi[0] >= lo[0] && hi[1] >= lo[1])) return null;
  // pass 0: the coarse lattice
  const step0 = Math.max(0.16, Math.sqrt(((hi[0] - lo[0] + 0.16) * (hi[1] - lo[1] + 0.16)) / maxPositions));
  const a0 = Math.floor(lo[0] / step0);
  const b0 = Math.floor(lo[1] / step0);
  const nx = Math.ceil(hi[0] / step0) - a0 + 1;
  const ny = Math.ceil(hi[1] / step0) - b0 + 1;
  const P0 = subsample(200);
  const tau0 = step0 * kB;
  const map = new Float32Array(nx * ny);
  for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) map[y * nx + x] = score(P0, (a0 + x) * step0, (b0 + y) * step0, tau0);
  let top0 = 0;
  for (let k = 0; k < map.length; k++) top0 = Math.max(top0, map[k]);
  if (!(top0 > 0)) return null;
  const local = [];
  const cells = [];
  for (let y = 0; y < ny; y++) {
    for (let x = 0; x < nx; x++) {
      const v = map[y * nx + x];
      if (v < 0.5 * top0) continue;
      cells.push({ v, x, y });
      let peak = true;
      for (let dy = -1; dy <= 1 && peak; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          const yy = y + dy;
          if ((!dx && !dy) || xx < 0 || yy < 0 || xx >= nx || yy >= ny) continue;
          const u = map[yy * nx + xx];
          if (u > v || (u === v && (dy < 0 || (dy === 0 && dx < 0)))) {
            peak = false;
            break;
          }
        }
      }
      if (peak) local.push({ v, x, y });
    }
  }
  local.sort((p, q) => q.v - p.v);
  cells.sort((p, q) => q.v - p.v);
  // pass 1: 8 cm steps around the strongest local peaks (two coarse steps) and cells (one step)
  const step = 0.08;
  const P1 = subsample(400);
  const tau1 = 0.12 * kB;
  const seen = new Map();
  const around = (p, reach) => {
    const n1 = Math.ceil((reach * step0) / step);
    const ci = Math.round(((a0 + p.x) * step0) / step);
    const cj = Math.round(((b0 + p.y) * step0) / step);
    for (let j = cj - n1; j <= cj + n1; j++) {
      for (let i = ci - n1; i <= ci + n1; i++) {
        const kk = j * 1048576 + i;
        if (!seen.has(kk)) seen.set(kk, { i, j, s: score(P1, i * step, j * step, tau1) });
      }
    }
  };
  for (const p of local.slice(0, 60)) around(p, 2);
  for (const p of cells.slice(0, 300)) around(p, 1);
  const order = [...seen.values()].sort((p, q) => q.s - p.s);
  // the 16 best at least 16 cm apart: less than a tread, so the flight one tread off does not hide the right one
  const top = [];
  for (const p of order) {
    if (top.length >= 16 || p.s < 0.6 * order[0].s) break;
    if (top.some((q) => Math.max(Math.abs(q.i - p.i), Math.abs(q.j - p.j)) <= 1)) continue;
    top.push(p);
  }
  // pass 2: 2 cm steps, tolerance 6 cm, 1000 points
  const P2 = subsample(1000);
  const tau2 = 0.06 * kB;
  const peaks = top.map(({ i, j }) => {
    let b = { s: -1, t: null };
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const t = [round(i * step + dx * 0.02, 4), round(j * step + dy * 0.02, 4)];
        const s = score(P2, t[0], t[1], tau2);
        if (s > b.s) b = { s, t };
      }
    }
    return b;
  });
  // the peaks ranked both ways (the best within ±1 cm): one tread further on, a flight loses a tread line at each
  // end, while the 2 cm pass can favour it by how the lines fell on the pixels
  for (const p of peaks) {
    if (!(p.s > 0)) continue;
    let b = -1;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) b = Math.max(b, both([p.t[0] + dx * 0.01, p.t[1] + dy * 0.01]));
    p.s = b;
  }
  peaks.sort((p, q) => q.s - p.s);
  // two that met in pass 2 are one
  for (let k = peaks.length - 1; k > 0; k--) if (peaks.slice(0, k).some((q) => Math.hypot(q.t[0] - peaks[k].t[0], q.t[1] - peaks[k].t[1]) < 0.05)) peaks.splice(k, 1);
  const best = peaks[0];
  if (!best || best.s <= 0) return null;
  const second = peaks.filter((p) => Math.hypot(p.t[0] - best.t[0], p.t[1] - best.t[1]) > 0.4).reduce((m, p) => Math.max(m, p.s), 0) / best.s;
  // pass 3: 1 cm around the winner, a tight tolerance, all points
  const tauF = Math.max(1.2, 0.04 * kB);
  let fine = { s: -1, t: best.t };
  for (let dy = -3; dy <= 3; dy++) {
    for (let dx = -3; dx <= 3; dx++) {
      const t = [round(best.t[0] + dx * 0.01, 4), round(best.t[1] + dy * 0.01, 4)];
      const s = score(pts, t[0], t[1], tauF);
      // ties: the one nearest the 2 cm winner
      if (s > fine.s + 1e-9 || (Math.abs(s - fine.s) <= 1e-9 && Math.hypot(dx, dy) < fine.r)) fine = { s, t, r: Math.hypot(dx, dy) };
    }
  }
  return {
    t: fine.t,
    score: score(pts, fine.t[0], fine.t[1], 0.08 * kB),
    fineScore: fine.s,
    second,
    peaks: peaks.map((p) => ({ t: p.t, s: p.s / best.s })),
    points: pts.length / 2,
    coarseStep: step0,
    positions: nx * ny,
    fineAt: (t) => score(pts, t[0], t[1], tauF),
  };
}

/**
 * The stair method. With both images, every stair box of either level (the best few per floor) is searched for in the
 * other level's drawing (matchStairDrawing). A straight flight looks much the same
 * one tread further on, so a match counts when another search (the other level's box, a second box) or the outline has
 * a peak at the same place, or when it is clearly the best (score ≥ clearStair, nothing within 7 % of it 0.4 m away).
 * An unbacked match where a strong outline (share ≥ clearOutline and coverage ≥ minCoverage, one peak or two equal
 * ones) does not fit (under outlineVeto of its best overlap) is a false box matched by chance and does not count
 * (hus8: a «stair» in the footer both FINN sheets share, at shift 0, far from either building). A clear outline also
 * picks among the tread-shifted peaks of the winner. The winner is refined on all the searches that agree.
 * Without the images the boxes are paired (pairBoxes).
 * @param {object} o  { stairs, refStairs, img, refImg, pxPerM?, refPxPerM?, findStairs?, outline? (outlineSearch) }
 * @returns {{ t, score, how, support, candidates, levelStairs, refStairs, notes } | null}  t: level frame → ref frame
 */
export function stairSearch(level, ref, opts = {}) {
  const o = { ...ALIGN_DEFAULTS, ...opts };
  const ppmL = o.pxPerM ?? level?.image?.pxPerM;
  const ppmR = o.refPxPerM ?? ref?.image?.pxPerM;
  const find = o.findStairs !== false;
  // the given stairs (opts, else the levels' stairHints from the detection); a floor without any is searched on its
  // image
  const SL = stairBoxes(level, o.stairs !== undefined ? o.stairs : level?.stairHints, o.img, ppmL, { find });
  const SR = stairBoxes(ref, o.refStairs !== undefined ? o.refStairs : ref?.stairHints, o.refImg, ppmR, { find });
  if (!SL.length && !SR.length) return null;
  const ol = o.outline ?? null;
  const outlineAt = o.outlineAt ?? ol?.at ?? null;
  const olStrong = !!(ol && ol.share >= o.clearOutline && ol.coverage >= o.minCoverage);
  const olClear = olStrong && !ol.ambiguous;
  const neg = (t) => [-t[0], -t[1]];
  const near = (p, q, r) => Math.hypot(p[0] - q[0], p[1] - q[1]) <= r;
  const candidates = [];
  const notes = [];
  let pick = null;
  if (o.img && o.refImg && ppmL > 0 && ppmR > 0) {
    const PL = planLines(o.img, ppmL);
    const PR = planLines(o.refImg, ppmR);
    const searches = [];
    for (const [S, name] of [
      [SL, 'level'],
      [SR, 'ref'],
    ]) {
      if (S.length > o.maxStairs) notes.push(`${name}: searched the first ${o.maxStairs} of ${S.length} stair boxes`);
    }
    for (const s of SL.slice(0, o.maxStairs)) {
      const m = matchStairDrawing(PL, s.box, PR, null, { maxPositions: o.maxPositions });
      if (m) searches.push({ ...m, from: 'level', box: s.box, source: s.source });
    }
    for (const s of SR.slice(0, o.maxStairs)) {
      const m = matchStairDrawing(PR, s.box, PL, null, { maxPositions: o.maxPositions });
      if (m) searches.push({ ...m, from: 'ref', box: s.box, source: s.source, t: neg(m.t), peaks: m.peaks.map((p) => ({ ...p, t: neg(p.t) })), fineAt: (t) => m.fineAt(neg(t)) });
    }
    const coarse = Math.max(0, ...searches.map((S) => S.coarseStep));
    if (coarse > 0.161) notes.push(`a large sheet: the coarse stair search ran at ${round(coarse, 2)} m steps`);
    for (const S of searches) {
      const backers = searches.filter((U) => U !== S && U.peaks.some((p) => p.s >= o.backing && near(p.t, S.t, 0.1)));
      const outline = outlineAt ? outlineAt(S.t) : 0;
      const support = backers.length + (outline >= o.backing ? 1 : 0);
      const vetoed = olStrong && !backers.length && outline < o.outlineVeto;
      candidates.push({ t: S.t, score: S.score, second: S.second, support, outline, from: S.from, source: S.source, box: S.box, vetoed, S, backers });
    }
    const ok = candidates.filter((c) => !c.vetoed && c.score >= o.minStair && (c.support >= 1 || (c.score >= o.clearStair && c.second <= o.stairDistinct)));
    ok.sort((p, q) => q.support - p.support || q.score - p.score);
    if (ok[0]) {
      const c = ok[0];
      const all = [c.S, ...c.backers];
      // a flight matches almost as well a tread or two further on (hus3: 94 % one tread down, the 1st floor drawing the
      // upper treads dashed): a clear outline picks among those peaks when it clearly prefers one
      let t0 = c.t;
      let how = c.support ? 'drawing, confirmed' : 'drawing';
      if (olClear && outlineAt) {
        const here = outlineAt(c.t);
        const alt = all
          .flatMap((S) => S.peaks.filter((p) => p.s >= o.backing && Math.hypot(p.t[0] - c.t[0], p.t[1] - c.t[1]) <= 1))
          .map((p) => ({ t: p.t, v: outlineAt(p.t) }))
          .sort((p, q) => q.v - p.v)[0];
        if (alt && alt.v >= here + 0.05) {
          t0 = alt.t;
          how += ', tread from the outline';
        }
      }
      // refine on every search that agrees: the sum of their fine scores, 1 cm steps within ±6 cm
      let best = { s: -1, t: t0 };
      for (let dy = -6; dy <= 6; dy++) {
        for (let dx = -6; dx <= 6; dx++) {
          const t = [round(t0[0] + dx * 0.01, 4), round(t0[1] + dy * 0.01, 4)];
          const s = all.reduce((k, S) => k + S.fineAt(t), 0);
          if (s > best.s + 1e-9 || (Math.abs(s - best.s) <= 1e-9 && Math.hypot(dx, dy) < best.r)) best = { s, t, r: Math.hypot(dx, dy) };
        }
      }
      pick = { t: best.t, score: c.score * (c.support ? 1 : 0.8), how, support: c.support };
    }
  } else {
    pick = pairBoxes(level, ref, SL, SR, o, ol, candidates);
  }
  return {
    ...(pick ?? { t: null, score: 0 }),
    candidates: candidates.map(({ S, backers, ...c }) => c),
    levelStairs: SL.map((s) => s.box),
    refStairs: SR.map((s) => s.box),
    notes,
  };
}

/**
 * The stair boxes paired without the images. Two boxes of about the same size (boxFit) give a shift from their
 * centres, but a detector's false box pairs with anything of its size, so a pair is only used with something else
 * that agrees:
 *   • a clear outline (share ≥ clearOutline, coverage ≥ minCoverage, one peak): the pair lands on its peak (≥ backing
 *     of the best overlap within the boxes' slack); the answer is that outline peak refined on the outer faces (the box
 *     centres are good to a few cm only);
 *   • a usable but ambiguous or weak outline: the pair picks a peak it lands on (≥ ambiguous of the best);
 *   • else the walls near the stair agree (refineNearBox, ≥ 50 % of the faces there);
 *   • nothing to go by: one pair that fits clearly better than any pair at another shift (fit ≥ 0.8, those under
 *     fit − 0.2), with a low score.
 * A pair a clear outline contradicts is never used: the outline then decides. The score says how well the evidence
 * agrees (noisy-or of the outline and the box fit), not how alike the boxes are.
 * @returns {{ t, score, how, support } | null}  (candidates: filled with every pair)
 */
function pairBoxes(level, ref, SL, SR, o, ol, candidates) {
  const olUsable = !!(ol && ol.share >= o.minOutline);
  const olClear = olUsable && ol.share >= o.clearOutline && ol.coverage >= o.minCoverage && !ol.ambiguous;
  const pairs = [];
  for (const a of SL) {
    for (const b of SR) {
      const fit = boxFit(a.box, b.box);
      if (fit < 0.5) continue;
      const [wa, ha] = boxSize(a.box);
      const [wb, hb] = boxSize(b.box);
      const r = [Math.max(0.15, 0.1 + Math.abs(wa - wb) / 2), Math.max(0.15, 0.1 + Math.abs(ha - hb) / 2)];
      const t = sub(boxCentre(b.box), boxCentre(a.box));
      pairs.push({ a, b, fit, t, r, on: olUsable ? ol.near(t, r) : null });
    }
  }
  pairs.sort((p, q) => q.fit - p.fit);
  for (const p of pairs) candidates.push({ t: p.t, score: p.fit, second: 0, support: 0, outline: p.on ? round(p.on.v, 3) : null, from: 'boxes', box: p.a.box, mate: p.b.box });
  if (!pairs.length) return null;
  const noisyOr = (p, q) => 1 - (1 - p) * (1 - q);
  const byAgreement = (list) => list.sort((p, q) => q.fit * q.on.v - p.fit * p.on.v)[0];
  if (olClear) {
    const p = byAgreement(pairs.filter((q) => q.on.v >= o.backing));
    return p ? { t: ol.refine(p.on.t), score: noisyOr(ol.share * (1 - 0.5 * ol.second) * p.on.v, 0.5 * p.fit), how: 'boxes + outline', support: 1 } : null;
  }
  if (olUsable) {
    const p = byAgreement(pairs.filter((q) => q.on.v >= o.ambiguous));
    if (p) return { t: ol.refine(p.on.t), score: noisyOr(0.5 * ol.share * p.on.v, 0.5 * p.fit), how: 'boxes + outline', support: 1 };
  }
  let best = null;
  for (const p of pairs.slice(0, 6)) {
    const w = refineNearBox(level, ref, p.t, p.a.box, p.r);
    if (w && w.share >= 0.5 && (!best || p.fit * w.share > best.p.fit * best.w.share)) best = { p, w };
  }
  if (best) return { t: best.w.t, score: 0.8 * best.p.fit * best.w.share, how: 'boxes + walls', support: 1 };
  // pairs within 0.3 m of the best one are the same answer, not rivals
  const p = pairs[0];
  const rival = pairs.find((q) => Math.hypot(q.t[0] - p.t[0], q.t[1] - p.t[1]) > 0.3);
  if (p.fit >= 0.8 && !(rival && rival.fit >= p.fit - 0.2)) return { t: p.t, score: 0.4 * p.fit, how: 'boxes', support: 0 };
  return null;
}

/**
 * The wall faces near a stair (its box with 1 m around it) on top of each other: the shift within ±r of t0 (1 cm
 * steps) where most of the level's faces there lie on the ref's; an axis moves only when that raises the share of
 * faces that agree by 5 points. Null when too few faces agree (under 30 %).
 */
export function refineNearBox(level, ref, t0, box, r) {
  const res = 0.01;
  const A = wallRasters(ref.walls, res);
  const B = wallRasters(level.walls, res);
  if (!A || !B) return null;
  // all wall faces: band cells next to a free cell
  const faces = (R) => {
    const m = new Uint8Array(R.w * R.h);
    for (let p = 0; p < R.w * R.h; p++) {
      if (!R.band[p]) continue;
      const x = p % R.w;
      if ((x > 0 && !R.band[p - 1]) || (x < R.w - 1 && !R.band[p + 1]) || (p >= R.w && !R.band[p - R.w]) || (p < R.w * (R.h - 1) && !R.band[p + R.w])) m[p] = 1;
    }
    return m;
  };
  const DA = distanceToMask({ w: A.w, h: A.h, data: faces(A) }).data;
  const fB = faces(B);
  const pts = [];
  for (let j = 0; j < B.h; j++) {
    for (let i = 0; i < B.w; i++) {
      if (!fB[j * B.w + i]) continue;
      const x = B.x0 + (i + 0.5) * res;
      const y = B.y0 + (j + 0.5) * res;
      if (x >= box[0] - 1 && x <= box[2] + 1 && y >= box[1] - 1 && y <= box[3] + 1) pts.push(x, y);
    }
  }
  if (pts.length < 100) return null;
  const tol = 3;
  const score = (tx, ty) => {
    let s = 0;
    for (let q = 0; q < pts.length; q += 2) {
      const i = Math.floor((pts[q] + tx - A.x0) / res);
      const j = Math.floor((pts[q + 1] + ty - A.y0) / res);
      if (i < 0 || j < 0 || i >= A.w || j >= A.h) continue;
      const d = DA[j * A.w + i];
      if (d < tol) s += 1 - d / tol;
    }
    return (2 * s) / pts.length;
  };
  let best = { s: -1, t: t0 };
  const nx = Math.round(r[0] / res);
  const ny = Math.round(r[1] / res);
  for (let j = -ny; j <= ny; j++) for (let i = -nx; i <= nx; i++) {
    const t = [t0[0] + i * res, t0[1] + j * res];
    const s = score(t[0], t[1]);
    if (s > best.s) best = { s, t };
  }
  if (best.s < 0.3) return null;
  // each axis moves only when the walls clearly agree better there (other rooms near the stair can pull it)
  const s0 = score(t0[0], t0[1]);
  const t = [score(best.t[0], t0[1]) >= s0 + 0.05 ? best.t[0] : t0[0], score(t0[0], best.t[1]) >= s0 + 0.05 ? best.t[1] : t0[1]];
  return { t, share: score(t[0], t[1]) };
}

// ---------------------------------------------------------------------------------------------------------------
// Corner (export.js alignLevel without changing the level)

/** The offset that puts the level's outer corner on the ref's (game-frame corner names, as in export.js). */
export function cornerOffset(level, ref, corner = 'ne', north = 0) {
  const a = outerCorner(ref, north, corner);
  const b = outerCorner(level, north, corner);
  if (!a || !b) return null;
  const d = northFrame(north).inv(sub(a, b));
  return add(level.offset || [0, 0], d);
}

// ---------------------------------------------------------------------------------------------------------------

/**
 * Where the level lies on the reference level.
 * @param {object} level  plan level (model.js): walls, offset, image.pxPerM
 * @param {object} ref    the level it is aligned to (its offset is kept)
 * @param {object} [opts]
 *   stairs, refStairs  the levels' detect.stairs (pixels, [{ bbox: [x0, y0, x1, y1], … }]) or stairHints (rect in
 *                      metres); left out, level.stairHints / ref.stairHints. A floor with none is searched on its image
 *                      (img / refImg) unless findStairs is false; without an image, [] means none
 *   img, refImg        the levels' plan images (RGBA, as detected): the stair drawings are matched on them
 *   pxPerM, refPxPerM  the images' scales (default: level.image.pxPerM)
 *   findStairs         false: no fallback stair finder
 *   north, corner      for the corner reserve (export.js names; default 'ne', avstemming V1)
 * @returns {{ offset: [number, number], method: 'stair'|'outline'|'corner', score: number, detail: object }}
 *   offset: the value for level.offset; score 0–1; detail: what each method found (detail.stair.notes: stair boxes
 *   left out, a coarser search on a very large sheet)
 */
export function alignLevelTo(level, ref, opts = {}) {
  const o = { ...ALIGN_DEFAULTS, ...opts };
  const refOff = ref.offset || [0, 0];
  const north = o.north ?? 0;
  const detail = {};
  const out = (t, method, score) => ({ offset: [round(refOff[0] + t[0], 4), round(refOff[1] + t[1], 4)], method, score: round(Math.max(0, Math.min(1, score)), 3), detail });

  const ol = outlineSearch(level, ref, o);
  if (ol) detail.outline = { t: ol.t, share: round(ol.share, 3), coverage: round(ol.coverage, 3), second: round(ol.second, 3), ambiguous: ol.ambiguous, peaks: ol.peaks.map((p) => ({ t: p.t, coarse: round(p.coarse, 3), face: round(p.face, 3) })) };

  // 1. the stair
  const st = stairSearch(level, ref, { ...o, outline: ol });
  if (st) {
    detail.stair = {
      t: st.t,
      score: round(st.score, 3),
      how: st.how,
      support: st.support,
      levelStairs: st.levelStairs,
      refStairs: st.refStairs,
      candidates: st.candidates.map((c) => ({ t: c.t, score: round(c.score, 3), second: round(c.second, 3), support: c.support, outline: c.outline == null ? null : round(c.outline, 3), from: c.from, ...(c.vetoed ? { vetoed: true } : {}) })),
      notes: st.notes,
    };
  }
  if (st?.t) return out(st.t, 'stair', st.score);

  // 2. the outline, when it has one clear peak
  if (ol && ol.share >= o.minOutline && !ol.ambiguous) return out(ol.t, 'outline', ol.share * (1 - 0.5 * ol.second));

  // 3. an outer corner flush (avstemming V1). When the outline had several equal peaks, the corner that lies on one of
  // them, the given (or north-east) corner first
  const order = [o.corner ?? 'ne', ...['ne', 'nw', 'se', 'sw'].filter((c) => c !== (o.corner ?? 'ne'))];
  const offs = order.map((corner) => ({ corner, c: cornerOffset(level, ref, corner, north) })).filter((x) => x.c);
  if (!offs.length) return out([0, 0], 'corner', 0);
  let chosen = offs[0];
  if (ol?.ambiguous && !opts.corner) {
    const top = ol.peaks.filter((p) => p.coarse >= ol.share * o.ambiguous);
    chosen = offs.find((x) => top.some((p) => Math.hypot(x.c[0] - refOff[0] - p.t[0], x.c[1] - refOff[1] - p.t[1]) <= 0.1)) ?? offs[0];
  }
  detail.corner = chosen.corner;
  return out(sub(chosen.c, refOff), 'corner', ol ? 0.3 * (ol.at(sub(chosen.c, refOff)) || 0) : 0.1);
}

