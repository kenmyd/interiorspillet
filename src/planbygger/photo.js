/**
 * Planbygger: a phone photo of a printed floor plan → a straight, evenly lit plan image. Classical image processing
 * only (colour statistics, a mask, a convex hull, straight edges, a homography, a pinhole camera, a background
 * estimate) – no learning, no network.
 *
 *   isPhoto(img) → { photo: bool, score }
 *       A digital plan (an export, a PDF page, a scan) is mostly pure white paper, white out to its border. A photo of
 *       a print has no pure white (the lit paper is grey), and its border shows the desk around the sheet: saturated or
 *       dark, and never noise-free. A border that is mostly one exact colour – white paper, or the flat bars of a
 *       viewer or a screenshot – is digital whatever its colour. score 0–1 from those four features, photo when ≥ 0.5.
 *   rectifyPhoto(img, { maxSide = 2400, …PHOTO_DEFAULTS }) → { img, quad, applied, cut, aspect, reason }
 *       0. clearly not a photo (isPhoto's score < 0.25) → nothing is done (reason 'digital');
 *       1. the sheet: the largest bright, unsaturated region of a downsampled copy, holes (the ink) filled. On a grey or
 *          white desk that region is the desk as well, and the sheet comes from its straight edges instead: a Hough
 *          transform of the gradient's thin edges, and the quadrilateral of four lines (the photo's border may be one)
 *          whose sides are backed by edges along most of their length;
 *       2. its four corners: the convex hull reduced to a quadrilateral – an edge is removed by extending its two
 *          neighbours until they meet, the edge that adds the least area first, so a corner hidden under a keyboard is
 *          rebuilt from the two sides – then each side measured on the full image (the paper edge along its normal,
 *          sub-pixel) and fitted with the longest straight run of edge points. A side that bends (the sheet hangs over
 *          the desk's edge) is taken from its flat end, and its far corner is extrapolated. A side that lies on the
 *          photo's border (the sheet runs out of the photo) is not measured: it is rebuilt from the other three and the
 *          camera, at the A ratio (cut names it);
 *       3. checked: every measured side must be backed by the paper's edge along ≥ minSupport of it (inside the photo),
 *          at most one side may be cut, the sheet must be A-shaped (± 15 %) where the camera can tell, a sheet found
 *          from its edges must have paper on the inside of each edge only (a wall drawn on the paper has it on both
 *          sides), and a flat, axis-aligned surround is a digital plan in a viewer – otherwise no result (reason
 *          'unsure', 'digital' or 'no-sheet'): a confident wrong sheet is worse than none;
 *       4. the camera (a pinhole: principal point at the centre, square pixels, the focal length from the two vanishing
 *          points when they give one – Zhang & He, «Whiteboard scanning», 2007 – else focal × the diagonal) gives the
 *          sheet's true aspect: portrait or landscape, which a steep shot's foreshortening hides from the side lengths;
 *       5. a homography (8-parameter DLT, Gaussian elimination) from an A-ratio (√2) rectangle with the long side
 *          maxSide onto the corners;
 *       6. refined by the drawing itself: on a low-resolution warp, the long straight wall edges give a vanishing point
 *          per axis, which is sent back to infinity (walls exactly horizontal and vertical); the A rectangle is refitted
 *          to the corners, weighted by how much of each corner was measured rather than extrapolated. A cut side is
 *          then placed again with the focal length those vanishing points give, when the perspective tells it;
 *       7. warped bilinearly, and the light flattened: every channel divided by the local mean of the paper under it
 *          (a grey closing as an envelope, then a normalised blur of the paper pixels), so the paper is ≈ 245
 *          everywhere – a hand's shadow and a coloured light are gone. Thin lines the camera blurred get some depth back
 *          (a black-hat boost), and a tone curve darkens the ink. What is not the sheet becomes paper.
 *       quad: where the output's corners lie in the input (top left, top right, bottom right, bottom left) – the
 *       sheet's corners as finally used, a hidden, extrapolated or cut one included (it may lie outside the photo).
 *       The output is portrait or landscape like the sheet, turned by the smallest angle (its top is the side nearest
 *       the top of the photo – a photo taken upside down comes out upside down). cut: the output's sides ('top',
 *       'right', 'bottom', 'left') that lay outside the photo – their place is the camera model's estimate, so the
 *       plan's aspect is less sure. aspect: the sheet's width / height as the camera model reads the corners (before
 *       the A ratio is imposed; ≈ 0.707 or 1.414 for an A sheet; null when a side was cut, its place coming from the A
 *       ratio). Nothing done → { img: the input, quad: null, applied: false, cut: [], aspect: null, reason }.
 *
 * Measured on plantegninger/hus3-foto against hus3/1etg.png and on synthetic pinhole photos: see notes/planbygger.md
 * («Foto av en utskrift»).
 */
import { raster, components, open, close, erode } from './image.js';

export const PHOTO_DEFAULTS = Object.freeze({
  /** long side of the rectified image, px */
  maxSide: 2400,
  /** the paper's value after the light is flattened */
  paper: 245,
  /** the coarse sheet mask is found on a copy with at most this long side */
  maskSide: 640,
  /** a pixel is paper-like below this saturation (max − min) / max … */
  maxSat: 0.22,
  /** … and above this share of the bright paper's luminance (a hand's shadow keeps ≈ 0.6) */
  minLight: 0.42,
  /** the sheet covers at least this share of the photo */
  minArea: 0.08,
  /**
   * every measured side of the sheet is backed by the paper's edge (an edge point on its line) along at least this
   * share of the side inside the photo – a keyboard over a corner hides ≈ 15 %, a desk taken for paper ≈ all of it
   */
  minSupport: 0.4,
  /**
   * the camera's focal length as a share of the image diagonal, when the photo cannot tell (both vanishing points far
   * away or symmetric): a phone's main camera is 24–28 mm equivalent, 0.55–0.65; hus3-foto measures 0.50
   */
  focal: 0.58,
  /** ink narrower than this share of the long side is removed from the background estimate (the closing's window) */
  inkWindow: 0.04,
  /**
   * thin lines restored: the camera's blur leaves a 1-px line of the print only ≈ 10 % below the paper (detect.js wants
   * 12–14 %, along the whole line). Within lineRadius × the long side, the depth below the neighbourhood minus
   * lineFloor (the paper's grain) is taken off again lineBoost times
   */
  lineBoost: 1,
  lineRadius: 0.0015,
  lineFloor: 0.03,
  /**
   * tone curve on the flattened value (1 = paper): v^contrast – the paper stays, the ink darkens. lineBoost 1 with
   * contrast 1.6 gave the most walls and openings on hus3-foto at 2400 px (a sweep over 0–2 × 1.2–2 at 2000, 2400 and
   * 2800 px; see the notes)
   */
  contrast: 1.6,
  /** refine the homography with the drawing's own straight lines, on a warp with this long side */
  refine: true,
  refineSide: 1200,
  /** an edge for the refinement: a step of this share of the paper's light, at least minEdge × the long side long */
  edgeStep: 0.15,
  minEdge: 0.05,
});

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const r3 = (v) => Math.round(v * 1000) / 1000;

/**
 * The options over PHOTO_DEFAULTS. Only known keys with a usable value count: undefined, null, or a number option that
 * is not a finite number keep the default (a caller that forwards an unset option gets the default, not NaN).
 */
function withDefaults(options) {
  const o = { ...PHOTO_DEFAULTS };
  for (const [k, v] of Object.entries(options ?? {})) {
    if (v == null || !Object.prototype.hasOwnProperty.call(PHOTO_DEFAULTS, k)) continue;
    if (typeof PHOTO_DEFAULTS[k] === 'number') {
      const n = typeof v === 'number' || typeof v === 'string' ? Number(v) : NaN;
      if (Number.isFinite(n)) o[k] = n;
    } else o[k] = !!v;
  }
  return o;
}

// ---------------------------------------------------------------------------------------------------------------
// Photo or digital plan

/**
 * Photo of a print, or a digital plan? Four features on a sample of ≤ 250 000 pixels (alpha composited on white):
 * the share of near-white pixels (min channel ≥ 240) – a digital plan has 18–97 %, a photo ≈ 0; the share of
 * near-white pixels in a frame of 3 % around the border – 65–100 % against ≈ 0; the saturation plus the dark share in
 * that frame – the desk, ≈ 1 against ≤ 0.13; and the frame's flatness, the share of it that is exactly its commonest
 * colour – 0.41–1 for the test set's plans (JPEG copies included), 0.005 for the photo: a photo's desk is never
 * noise-free, a viewer's bars are. The first three give the score, the flatness scales it down.
 */
export function isPhoto(img) {
  const { width: w, height: h, data: d } = img;
  const step = Math.max(1, Math.floor(Math.sqrt((w * h) / 250000)));
  const frame = Math.max(2, Math.round(Math.min(w, h) * 0.03));
  let n = 0;
  let white = 0;
  let bn = 0;
  let bWhite = 0;
  let bSat = 0;
  let bDark = 0;
  const colours = new Map();
  for (let y = 0; y < h; y += step) {
    const edgeY = y < frame || y >= h - frame;
    for (let x = 0; x < w; x += step) {
      const i = (y * w + x) * 4;
      const a = d[i + 3] / 255;
      const r = d[i] * a + 255 * (1 - a);
      const g = d[i + 1] * a + 255 * (1 - a);
      const b = d[i + 2] * a + 255 * (1 - a);
      const mn = Math.min(r, g, b);
      const mx = Math.max(r, g, b);
      n++;
      if (mn >= 240) white++;
      if (edgeY || x < frame || x >= w - frame) {
        bn++;
        if (mn >= 235) bWhite++;
        bSat += mx > 0 ? (mx - mn) / mx : 0;
        if (0.299 * r + 0.587 * g + 0.114 * b < 80) bDark++;
        const key = (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b);
        colours.set(key, (colours.get(key) ?? 0) + 1);
      }
    }
  }
  if (!n || !bn) return { photo: false, score: 0 };
  let flat = 0;
  for (const c of colours.values()) if (c > flat) flat = c;
  const sWhite = 1 - clamp01(white / n / 0.1);
  const sBorder = 1 - clamp01(bWhite / bn / 0.4);
  const sDesk = clamp01((bSat + bDark) / bn / 0.4);
  const sFlat = clamp01((flat / bn - 0.25) / 0.3);
  const score = (0.4 * sWhite + 0.3 * sBorder + 0.3 * sDesk) * (1 - sFlat);
  return { photo: score >= 0.5, score: r3(score) };
}

// ---------------------------------------------------------------------------------------------------------------
// Geometry: hull, quadrilateral, lines, homography

const cross3 = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

/** Convex hull (Andrew's monotone chain), counter-clockwise in a y-up frame = clockwise on the screen (y down). */
function convexHull(points) {
  const p = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const lower = [];
  for (const q of p) {
    while (lower.length >= 2 && cross3(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i];
    while (upper.length >= 2 && cross3(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
    upper.push(q);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

/** Intersection of the line through p1, p2 with the line through p3, p4 (null when parallel). */
function intersectLines(p1, p2, p3, p4) {
  const d1x = p2[0] - p1[0];
  const d1y = p2[1] - p1[1];
  const d2x = p4[0] - p3[0];
  const d2y = p4[1] - p3[1];
  const den = d1x * d2y - d1y * d2x;
  if (Math.abs(den) < 1e-9 * (Math.hypot(d1x, d1y) * Math.hypot(d2x, d2y) + 1e-12)) return null;
  const t = ((p3[0] - p1[0]) * d2y - (p3[1] - p1[1]) * d2x) / den;
  return [p1[0] + t * d1x, p1[1] + t * d1y];
}

/**
 * A convex polygon reduced to k vertices: repeatedly the edge whose removal adds the least area goes – its two
 * neighbouring edges are extended until they meet. A cut-off (hidden) corner is the cheapest edge and is rebuilt.
 */
function reduceHull(hull, k = 4) {
  let P = hull.slice();
  while (P.length > k) {
    const n = P.length;
    let best = -1;
    let bestArea = Infinity;
    let bestX = null;
    for (let i = 0; i < n; i++) {
      const a = P[(i - 1 + n) % n];
      const b = P[i];
      const c = P[(i + 1) % n];
      const d = P[(i + 2) % n];
      const X = intersectLines(a, b, d, c);
      if (!X) continue;
      // X must lie ahead of b on a → b and ahead of c on d → c (the neighbours converge outside the edge)
      if ((X[0] - b[0]) * (b[0] - a[0]) + (X[1] - b[1]) * (b[1] - a[1]) < -1e-9) continue;
      if ((X[0] - c[0]) * (c[0] - d[0]) + (X[1] - c[1]) * (c[1] - d[1]) < -1e-9) continue;
      const area = Math.abs(cross3(b, c, X)) / 2;
      if (area < bestArea) {
        bestArea = area;
        best = i;
        bestX = X;
      }
    }
    if (best < 0) return null;
    const next = [];
    for (let i = 0; i < n; i++) {
      if (i === best) next.push(bestX);
      else if (i !== (best + 1) % n) next.push(P[i]);
    }
    P = next;
  }
  return P;
}

/** Total-least-squares line through points → { p: centroid, u: unit direction }. */
function fitLine(pts) {
  let mx = 0;
  let my = 0;
  for (const [x, y] of pts) {
    mx += x;
    my += y;
  }
  mx /= pts.length;
  my /= pts.length;
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (const [x, y] of pts) {
    sxx += (x - mx) * (x - mx);
    sxy += (x - mx) * (y - my);
    syy += (y - my) * (y - my);
  }
  const th = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  return { p: [mx, my], u: [Math.cos(th), Math.sin(th)] };
}

const lineDist = (L, q) => Math.abs((q[0] - L.p[0]) * L.u[1] - (q[1] - L.p[1]) * L.u[0]);

/** Signed shoelace area (positive = clockwise on the screen, y down). */
function shoelace(poly) {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s / 2;
}

/**
 * Solves A x = b (n × n, row-major arrays) by Gaussian elimination with partial pivoting. Returns x or null (singular).
 */
function solve(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    if (Math.abs(M[piv][c]) < 1e-12) return null;
    [M[c], M[piv]] = [M[piv], M[c]];
    for (let r = c + 1; r < n; r++) {
      const f = M[r][c] / M[c][c];
      if (!f) continue;
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r][n];
    for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k];
    x[r] = s / M[r][r];
  }
  return x;
}

/** 3 × 3 matrices (row-major arrays of 9): product and inverse. */
function mul3(P, Q) {
  const R = new Array(9).fill(0);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) for (let k = 0; k < 3; k++) R[r * 3 + c] += P[r * 3 + k] * Q[k * 3 + c];
  return R;
}
function inv3(m) {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-15) return null;
  return [A / det, -(b * i - c * h) / det, (b * f - c * e) / det, B / det, (a * i - c * g) / det, -(a * f - c * d) / det, C / det, -(a * h - b * g) / det, (a * e - b * d) / det];
}

/**
 * The homography that maps the four points src[i] onto dst[i] (the 8-parameter DLT, h33 = 1). Coordinates are
 * normalised (centred, mean distance √2) before the solve for a well-conditioned system.
 * @returns {number[] | null}  [h0 … h8], x' = (h0 x + h1 y + h2) / (h6 x + h7 y + h8), y' likewise with h3 … h5
 */
export function solveHomography(src, dst) {
  const norm = (pts) => {
    const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
    const cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
    const md = pts.reduce((s, p) => s + Math.hypot(p[0] - cx, p[1] - cy), 0) / pts.length || 1;
    const k = Math.SQRT2 / md;
    return { k, cx, cy, pts: pts.map((p) => [(p[0] - cx) * k, (p[1] - cy) * k]) };
  };
  const S = norm(src);
  const D = norm(dst);
  const A = [];
  const b = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = S.pts[i];
    const [u, v] = D.pts[i];
    A.push([x, y, 1, 0, 0, 0, -x * u, -y * u]);
    b.push(u);
    A.push([0, 0, 0, x, y, 1, -x * v, -y * v]);
    b.push(v);
  }
  const h = solve(A, b);
  if (!h || !h.every(Number.isFinite)) return null;
  // undo the normalisation: H = Tdst⁻¹ · Hn · Tsrc
  const Hn = [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
  const Ts = [S.k, 0, -S.k * S.cx, 0, S.k, -S.k * S.cy, 0, 0, 1];
  const Tdi = [1 / D.k, 0, D.cx, 0, 1 / D.k, D.cy, 0, 0, 1];
  const H = mul3(Tdi, mul3(Hn, Ts));
  const s = H[8];
  return Math.abs(s) > 1e-15 ? H.map((v) => v / s) : null;
}

/** A point through a homography. */
export function mapPoint(H, [x, y]) {
  const w = H[6] * x + H[7] * y + H[8];
  return [(H[0] * x + H[1] * y + H[2]) / w, (H[3] * x + H[4] * y + H[5]) / w];
}

// ---------------------------------------------------------------------------------------------------------------
// The camera: a pinhole with the principal point at the image centre and square pixels

const UNIT = [[0, 0], [1, 0], [1, 1], [0, 1]];
const hcross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const hdot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
/** A line { p, u } in homogeneous coordinates. */
const hline = (L) => hcross([L.p[0], L.p[1], 1], [L.p[0] + L.u[0], L.p[1] + L.u[1], 1]);

/**
 * The two direction columns of the homography from the unit square onto quad (TL, TR, BR, BL), the image centred on
 * the principal point (cx, cy): the vanishing points of the sheet's top side and of its left side.
 */
function vanishing(quad, cx, cy) {
  const Hu = solveHomography(UNIT, quad);
  if (!Hu) return null;
  const col = (j) => [Hu[j] - cx * Hu[6 + j], Hu[3 + j] - cy * Hu[6 + j], Hu[6 + j]];
  return [col(0), col(1)];
}

/** The focal length (px) that makes the two directions perpendicular in space, or null (none, or not finite). */
function focalOf(v) {
  if (!v) return null;
  const [a, b] = v;
  const f2 = -(a[0] * b[0] + a[1] * b[1]) / (a[2] * b[2]);
  return f2 > 0 && Number.isFinite(f2) ? Math.sqrt(f2) : null;
}

/** The rectangle's width / height in space at focal length f: the ratio of the two directions' lengths, |K⁻¹ v|. */
const aspectOf = (v, f) => Math.hypot(v[0][0] / f, v[0][1] / f, v[0][2]) / Math.hypot(v[1][0] / f, v[1][1] / f, v[1][2]);

/**
 * The true shape of the rectangle a quadrilateral (TL, TR, BR, BL) shows, in a photo of W × H. When the aspect hardly
 * depends on the focal length (a view from straight above, or both vanishing points far away: < 1 % between 0.3 and
 * 3 × the diagonal), it is read at the default focal length; else the focal length comes from the vanishing points
 * when they give one that is plausible (0.3–3 × the diagonal) and stable (corners moved 2 px change it < 20 %), else
 * the default. A steep shot's foreshortening is undone: its far side is short in the photo, not on the desk.
 * @returns {{ aspect: number, f: number, measured: boolean, sensitive: boolean } | null}
 */
function sheetShape(quad, W, H, o) {
  const diag = Math.hypot(W, H);
  const v = vanishing(quad, W / 2, H / 2);
  if (!v) return null;
  const f0 = o.focal * diag;
  const sensitive = Math.abs(aspectOf(v, 0.3 * diag) / aspectOf(v, 3 * diag) - 1) > 0.01;
  let f = sensitive ? focalOf(v) : null;
  if (f && (f < 0.3 * diag || f > 3 * diag)) f = null;
  if (f) {
    for (const [dx, dy] of [[2, 0], [0, 2], [-2, 0], [0, -2]]) {
      const q = quad.map((p, i) => [p[0] + (i === 1 || i === 2 ? dx : -dx), p[1] + (i >= 2 ? dy : -dy)]);
      const fq = focalOf(vanishing(q, W / 2, H / 2));
      if (!fq || Math.abs(fq / f - 1) > 0.2) {
        f = null;
        break;
      }
    }
  }
  const aspect = aspectOf(v, f ?? f0);
  return Number.isFinite(aspect) && aspect > 0 ? { aspect, f: f ?? f0, measured: !!f, sensitive } : null;
}

/**
 * A side of the sheet outside the photo, rebuilt from the other three and the camera (focal length f): the two sides
 * next to it meet in a vanishing point – the direction d1 they share in space; the side opposite it gives the other
 * direction (in the plane through the camera and that side, perpendicular to d1), and the two the sheet's plane. The
 * cut side lies ρ × the opposite side's length from it along d1, ρ = 1/√2 or √2: the smaller that still reaches past
 * the part that is visible.
 * @param {[number, number][]} corners  clockwise; corners c and c + 1 (the cut side's) where its neighbours leave the
 *   photo, the other two measured
 * @param {({ p, u } | null)[]} lines  the measured side lines (side i: corner i → i + 1)
 * @returns {[number, number][] | null}  the new corners c and c + 1
 */
function rebuildSide(corners, lines, c, W, H, f) {
  const a1 = lines[(c + 3) % 4];
  const a2 = lines[(c + 1) % 4];
  const op = lines[(c + 2) % 4];
  if (!a1 || !a2 || !op) return null;
  const cx = W / 2;
  const cy = H / 2;
  const Ki = (v) => [(v[0] - cx * v[2]) / f, (v[1] - cy * v[2]) / f, v[2]];
  const K = (X) => [f * X[0] + cx * X[2], f * X[1] + cy * X[2], X[2]];
  const KT = (l) => [f * l[0], f * l[1], cx * l[0] + cy * l[1] + l[2]];
  const d1 = Ki(hcross(hline(a1), hline(a2)));
  const d2 = hcross(KT(hline(op)), d1);
  let N = hcross(d1, d2);
  const Q1 = corners[(c + 3) % 4]; // a1 ∩ the opposite side
  const Q2 = corners[(c + 2) % 4]; // a2 ∩ the opposite side
  const ray = (p) => Ki([p[0], p[1], 1]);
  if (hdot(N, ray(Q1)) < 0) N = N.map((v) => -v);
  // a pixel → its point on the sheet's plane (N · X = 1; the scale does not matter, only ratios are used)
  const X = (p) => {
    const r = ray(p);
    const k = hdot(N, r);
    return k > 1e-12 ? r.map((v) => v / k) : null;
  };
  const foot = (L, q) => {
    const t = (q[0] - L.p[0]) * L.u[0] + (q[1] - L.p[1]) * L.u[1];
    return [L.p[0] + t * L.u[0], L.p[1] + t * L.u[1]];
  };
  const x1 = X(Q1);
  const x2 = X(Q2);
  const e1 = X(foot(a1, corners[c])); // where the neighbours leave the photo
  const e2 = X(foot(a2, corners[(c + 1) % 4]));
  if (!x1 || !x2 || !e1 || !e2) return null;
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const w = Math.hypot(...sub(x1, x2));
  const dl = Math.hypot(...d1);
  if (!(w > 0) || !(dl > 0)) return null;
  let dh = d1.map((v) => v / dl);
  if (hdot(sub(e1, x1), dh) < 0) dh = dh.map((v) => -v);
  const visible = Math.max(hdot(sub(e1, x1), dh), hdot(sub(e2, x2), dh));
  const b = [Math.SQRT1_2 * w, Math.SQRT2 * w].find((v) => v >= 0.98 * visible);
  if (!b) return null;
  const out = [x1, x2].map((x) => {
    const P = K(x.map((v, i) => v + b * dh[i]));
    return P[2] > 1e-12 ? [P[0] / P[2], P[1] / P[2]] : null;
  });
  return out[0] && out[1] && out.every((p) => p.every(Number.isFinite)) ? out : null;
}

// ---------------------------------------------------------------------------------------------------------------
// The sheet

/** Paper-likeness of an RGB value: luminance, damped by saturation (the desk's wood scores ≈ 0, the paper its light). */
const paperness = (r, g, b) => {
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const sat = mx > 0 ? (mx - mn) / mx : 0;
  return (0.299 * r + 0.587 * g + 0.114 * b) * clamp01(1 - 2.5 * sat);
};

/**
 * A block-averaged copy (factor f, the long side ≤ maskSide): luminance and saturation per block, and the bright
 * paper's luminance (the 90th percentile of the unsaturated blocks).
 * @returns {{ lum: Float32Array, sat: Float32Array, sw, sh, f, paperLum } | null}
 */
function sheetStats(img, o) {
  const { width: w, height: h, data: d } = img;
  const f = Math.max(1, Math.ceil(Math.max(w, h) / o.maskSide));
  const sw = Math.ceil(w / f);
  const sh = Math.ceil(h / f);
  const lum = new Float32Array(sw * sh);
  const sat = new Float32Array(sw * sh);
  for (let by = 0; by < sh; by++) {
    for (let bx = 0; bx < sw; bx++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let c = 0;
      for (let y = by * f, y1 = Math.min(h, y + f); y < y1; y++) {
        for (let x = bx * f, x1 = Math.min(w, x + f); x < x1; x++) {
          const i = (y * w + x) * 4;
          r += d[i];
          g += d[i + 1];
          b += d[i + 2];
          c++;
        }
      }
      r /= c;
      g /= c;
      b /= c;
      const mx = Math.max(r, g, b);
      const k = by * sw + bx;
      lum[k] = 0.299 * r + 0.587 * g + 0.114 * b;
      sat[k] = mx > 0 ? (mx - Math.min(r, g, b)) / mx : 0;
    }
  }
  const hist = new Uint32Array(256);
  let nLow = 0;
  for (let k = 0; k < lum.length; k++) {
    if (sat[k] < o.maxSat) {
      hist[Math.min(255, Math.round(lum[k]))]++;
      nLow++;
    }
  }
  if (!nLow) return null;
  let acc = 0;
  let paperLum = 255;
  for (let v = 0; v < 256; v++) {
    acc += hist[v];
    if (acc >= 0.9 * nLow) {
      paperLum = v;
      break;
    }
  }
  return { lum, sat, sw, sh, f, paperLum };
}

/** A paper-like block: unsaturated, and brighter than minLight × the bright paper (a hand's shadow stays in). */
const paperLike = (st, o, k) => st.sat[k] < o.maxSat && st.lum[k] > Math.max(50, o.minLight * st.paperLum);

/** The mask with its holes filled: everything a flood fill from the border through the 0-pixels does not reach. */
function fillHoles(m) {
  const { w, h } = m;
  const outside = new Uint8Array(w * h);
  const stack = [];
  const push = (k) => {
    if (!outside[k] && !m.data[k]) {
      outside[k] = 1;
      stack.push(k);
    }
  };
  for (let x = 0; x < w; x++) {
    push(x);
    push((h - 1) * w + x);
  }
  for (let y = 0; y < h; y++) {
    push(y * w);
    push(y * w + w - 1);
  }
  while (stack.length) {
    const k = stack.pop();
    const x = k % w;
    const y = (k - x) / w;
    if (x > 0) push(k - 1);
    if (x < w - 1) push(k + 1);
    if (y > 0) push(k - w);
    if (y < h - 1) push(k + w);
  }
  const out = raster(w, h);
  for (let k = 0; k < out.data.length; k++) out.data[k] = outside[k] ? 0 : 1;
  return out;
}

/** The coarse sheet mask: the paper-like blocks, closed and opened, the largest component, holes filled (or null). */
function lumMask(st, o) {
  const { sw, sh } = st;
  let m = raster(sw, sh);
  for (let k = 0; k < m.data.length; k++) m.data[k] = paperLike(st, o, k) ? 1 : 0;
  m = open(close(m, 2), 2);
  const { labels, comps } = components(m, 4);
  if (!comps.length) return null;
  const big = comps.reduce((a, c) => (c.area > a.area ? c : a));
  if (big.area < o.minArea * sw * sh) return null;
  const keep = raster(sw, sh);
  for (let k = 0; k < keep.data.length; k++) keep.data[k] = labels[k] === big.id ? 1 : 0;
  return fillHoles(keep);
}

/** The mask's convex hull (its boundary pixels' corners, full-image coordinates) reduced to a clockwise quadrilateral. */
function maskQuad(mask, f) {
  const { w: sw, h: sh } = mask;
  const pts = [];
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      const k = y * sw + x;
      if (!mask.data[k]) continue;
      const edge = x === 0 || y === 0 || x === sw - 1 || y === sh - 1 || !mask.data[k - 1] || !mask.data[k + 1] || !mask.data[k - sw] || !mask.data[k + sw];
      if (!edge) continue;
      pts.push([x * f, y * f], [(x + 1) * f, y * f], [x * f, (y + 1) * f], [(x + 1) * f, (y + 1) * f]);
    }
  }
  const hull = convexHull(pts);
  if (hull.length < 4) return null;
  const quad = reduceHull(hull, 4);
  if (!quad) return null;
  if (shoelace(quad) < 0) quad.reverse();
  return quad;
}

/**
 * The sheet from its straight edges, for a desk the colour mask cannot tell from the paper (grey, white, or the paper
 * both lighter and darker than the desk under a shadow). On the block copy: the gradient (Sobel), thinned to its
 * ridges (non-maximum suppression), votes in a Hough transform, each edge pixel for the angles within ±6° of its own
 * normal, so the paper's edge counts whichever side is brighter. The strongest lines are refitted to their edge pixels;
 * pairs of nearly parallel lines (≤ 50° apart: a steep shot makes the sides converge) are combined into quadrilaterals,
 * the photo's border lines included (a side outside the photo; at most one). A quadrilateral counts when each side
 * that is not the border has edge pixels along ≥ 50 % of its length inside the photo, and at least half of its inside
 * is paper-like; the most edge length first. A faint paper edge (a white desk only a little brighter than the paper)
 * can lose to a wall drawn on the sheet, so the caller measures the best few in turn.
 * @returns {{ quad: [number, number][], mask }[]}  up to max, quad in full-image coordinates, clockwise; mask: the
 *   quadrilateral's paper-like blocks, holes filled
 */
function edgeQuads(st, o, max = 4) {
  const { lum, sw, sh, f, paperLum } = st;
  const n = sw * sh;
  const gx = new Float32Array(n);
  const gy = new Float32Array(n);
  const mag = new Float32Array(n);
  for (let y = 1; y < sh - 1; y++) {
    for (let x = 1; x < sw - 1; x++) {
      const i = y * sw + x;
      const a = lum[i - sw - 1];
      const b = lum[i - sw];
      const c = lum[i - sw + 1];
      const d = lum[i - 1];
      const e = lum[i + 1];
      const g = lum[i + sw - 1];
      const h = lum[i + sw];
      const k = lum[i + sw + 1];
      gx[i] = (c + 2 * e + k - a - 2 * d - g) / 8;
      gy[i] = (g + 2 * h + k - a - 2 * b - c) / 8;
      mag[i] = Math.hypot(gx[i], gy[i]);
    }
  }
  const te = Math.max(3, 0.02 * paperLum);
  const ang = new Float32Array(n).fill(-1); // the normal's angle in [0, π) on the ridge pixels, −1 elsewhere
  const ridge = [];
  for (let y = 2; y < sh - 2; y++) {
    for (let x = 2; x < sw - 2; x++) {
      const i = y * sw + x;
      const m = mag[i];
      if (m < te) continue;
      let t = Math.atan2(gy[i], gx[i]);
      if (t < 0) t += Math.PI;
      if (t >= Math.PI) t -= Math.PI;
      const off = [1, sw + 1, sw, sw - 1][Math.round(t / (Math.PI / 4)) % 4];
      if (m < mag[i - off] || m <= mag[i + off]) continue;
      ang[i] = t;
      ridge.push(i);
    }
  }
  if (ridge.length < 50) return [];
  // the Hough transform: θ in 0.5° steps, ρ in 1-px steps
  const NT = 360;
  const R = Math.ceil(Math.hypot(sw, sh));
  const NR = 2 * R + 1;
  const cs = new Float64Array(NT);
  const sn = new Float64Array(NT);
  for (let t = 0; t < NT; t++) {
    cs[t] = Math.cos((t * Math.PI) / NT);
    sn[t] = Math.sin((t * Math.PI) / NT);
  }
  const acc = new Float32Array(NT * NR);
  for (const i of ridge) {
    const x = (i % sw) + 0.5;
    const y = Math.floor(i / sw) + 0.5;
    const t0 = Math.round((ang[i] / Math.PI) * NT);
    for (let dt = -12; dt <= 12; dt++) {
      const t = (((t0 + dt) % NT) + NT) % NT;
      acc[t * NR + Math.round(x * cs[t] + y * sn[t]) + R]++;
    }
  }
  const minVotes = Math.max(12, 0.1 * Math.min(sw, sh));
  const peaks = [];
  for (let t = 0; t < NT; t++) {
    for (let r = 0; r < NR; r++) {
      const v = acc[t * NR + r];
      if (v < minVotes) continue;
      let top = true;
      for (let dt = -6; dt <= 6 && top; dt++) {
        const tt = t + dt;
        if (tt < 0 || tt >= NT) continue;
        for (let dr = -4; dr <= 4; dr++) {
          const rr = r + dr;
          if ((!dt && !dr) || rr < 0 || rr >= NR) continue;
          const u = acc[tt * NR + rr];
          if (u > v || (u === v && (dt < 0 || (!dt && dr < 0)))) {
            top = false;
            break;
          }
        }
      }
      if (top) peaks.push({ t, r: r - R, v });
    }
  }
  peaks.sort((a, b) => b.v - a.v);
  // each peak refitted to its ridge pixels (twice), and its support along the line: a ridge pixel within 1.5 px whose
  // normal is within 15° of the line's (a faint step on a grainy desk has a noisy gradient direction)
  const angDiff = (a, b) => {
    const d = Math.abs(a - b) % Math.PI;
    return Math.min(d, Math.PI - d);
  };
  const lines = [];
  const walk = (L, tolD, tolA, fn) => {
    // the line's stretch inside the block copy, in 1-px steps
    const [px, py] = L.p;
    const [ux, uy] = L.u;
    let s0 = -Infinity;
    let s1 = Infinity;
    for (const [p, u, lim] of [[px, ux, sw], [py, uy, sh]]) {
      if (Math.abs(u) < 1e-9) {
        if (p < 0 || p > lim) s1 = -Infinity;
        continue;
      }
      const a = (0 - p) / u;
      const b = (lim - p) / u;
      s0 = Math.max(s0, Math.min(a, b));
      s1 = Math.min(s1, Math.max(a, b));
    }
    if (!(s1 > s0)) return null;
    const nx = -uy;
    const ny = ux;
    const na = Math.atan2(ny, nx) < 0 ? Math.atan2(ny, nx) + Math.PI : Math.atan2(ny, nx);
    const steps = Math.floor(s1 - s0);
    for (let k = 0; k <= steps; k++) {
      const s = s0 + k;
      let hit = null;
      for (let j = -Math.ceil(tolD); j <= Math.ceil(tolD) && !hit; j++) {
        const x = Math.floor(px + ux * s + nx * j);
        const y = Math.floor(py + uy * s + ny * j);
        if (x < 0 || y < 0 || x >= sw || y >= sh) continue;
        const i = y * sw + x;
        if (ang[i] < 0 || angDiff(ang[i], na) > tolA) continue;
        const dd = Math.abs((x + 0.5 - px) * nx + (y + 0.5 - py) * ny);
        if (dd <= tolD) hit = [x + 0.5, y + 0.5];
      }
      fn(k, hit);
    }
    return { s0, steps };
  };
  for (const pk of peaks.slice(0, 40)) {
    const th = (pk.t * Math.PI) / NT;
    let L = { p: [pk.r * Math.cos(th), pk.r * Math.sin(th)], u: [-Math.sin(th), Math.cos(th)] };
    for (let it = 0; it < 2; it++) {
      const pts = [];
      walk(L, it ? 1.5 : 2.5, (12 * Math.PI) / 180, (k, hit) => hit && pts.push(hit));
      if (pts.length < minVotes) {
        L = null;
        break;
      }
      L = fitLine(pts);
    }
    if (!L) continue;
    const on = [];
    const span = walk(L, 1.5, (15 * Math.PI) / 180, (k, hit) => (on[k] = hit ? 1 : 0));
    if (!span) continue;
    const pre = new Float64Array(on.length + 1);
    for (let k = 0; k < on.length; k++) pre[k + 1] = pre[k] + on[k];
    const a = Math.atan2(L.u[1], L.u[0]);
    const line = { ...L, ang: a < 0 ? a + Math.PI : a >= Math.PI ? a - Math.PI : a, s0: span.s0, pre, border: false };
    // the same line found twice
    if (lines.some((q) => angDiff(q.ang, line.ang) < (1 * Math.PI) / 180 && lineDist(q, line.p) < 2)) continue;
    lines.push(line);
  }
  // the photo's border, as lines a side may lie on (a sheet that runs out of the photo)
  for (const [p, u] of [[[0, 0], [1, 0]], [[sw, 0], [0, 1]], [[0, sh], [1, 0]], [[0, 0], [0, 1]]]) lines.push({ p, u, ang: u[0] ? 0 : Math.PI / 2, border: true });
  if (lines.filter((l) => !l.border).length < 3) return [];
  // support of the stretch of line L between two points: the share of its part inside the copy with a ridge pixel
  const supportOf = (L, A, B) => {
    const sa = (A[0] - L.p[0]) * L.u[0] + (A[1] - L.p[1]) * L.u[1] - L.s0;
    const sb = (B[0] - L.p[0]) * L.u[0] + (B[1] - L.p[1]) * L.u[1] - L.s0;
    const lo = Math.max(0, Math.floor(Math.min(sa, sb)));
    const hi = Math.min(L.pre.length - 1, Math.ceil(Math.max(sa, sb)));
    const inside = hi - lo;
    const len = Math.abs(sb - sa);
    if (inside < 0.4 * len || inside < 10) return null;
    return { inside, hit: L.pre[hi] - L.pre[lo] };
  };
  const meet = (L1, L2) => intersectLines(L1.p, [L1.p[0] + L1.u[0], L1.p[1] + L1.u[1]], L2.p, [L2.p[0] + L2.u[0], L2.p[1] + L2.u[1]]);
  const minSep = 0.15 * Math.min(sw, sh);
  const pairs = [];
  for (let i = 0; i < lines.length; i++) {
    for (let j = i + 1; j < lines.length; j++) {
      const A = lines[i];
      const B = lines[j];
      if (A.border && B.border) continue;
      if (angDiff(A.ang, B.ang) > (50 * Math.PI) / 180) continue;
      // apart across the copy (measured from one line's middle inside the copy to the other)
      const mid = A.border ? B.p : [A.p[0] + A.u[0] * (A.s0 + (A.pre.length - 1) / 2), A.p[1] + A.u[1] * (A.s0 + (A.pre.length - 1) / 2)];
      if (lineDist(A.border ? A : B, mid) < minSep) continue;
      pairs.push([A, B]);
    }
  }
  const cands = [];
  for (let p = 0; p < pairs.length; p++) {
    for (let q = p + 1; q < pairs.length; q++) {
      const [A, B] = pairs[p];
      const [C, D] = pairs[q];
      if (A === C || A === D || B === C || B === D) continue;
      if ([A, B, C, D].filter((l) => l.border).length > 1) continue;
      if (Math.min(angDiff(A.ang, C.ang), angDiff(A.ang, D.ang), angDiff(B.ang, C.ang), angDiff(B.ang, D.ang)) < (35 * Math.PI) / 180) continue;
      const P = [meet(A, C), meet(C, B), meet(B, D), meet(D, A)];
      if (P.some((x) => !x || x[0] < -0.35 * sw || x[0] > 1.35 * sw || x[1] < -0.35 * sh || x[1] > 1.35 * sh)) continue;
      let quad = P;
      let sides = [C, B, D, A]; // side i: corner i → i + 1
      if (shoelace(quad) < 0) {
        quad = [P[0], P[3], P[2], P[1]];
        sides = [A, D, B, C];
      }
      if (shoelace(quad) < o.minArea * sw * sh) continue;
      let ok = true;
      for (let i = 0; i < 4 && ok; i++) {
        const a = quad[(i + 3) % 4];
        const b = quad[i];
        const c = quad[(i + 1) % 4];
        if (cross3(a, b, c) <= 0) ok = false;
        const v1 = [a[0] - b[0], a[1] - b[1]];
        const v2 = [c[0] - b[0], c[1] - b[1]];
        const cos = (v1[0] * v2[0] + v1[1] * v2[1]) / (Math.hypot(...v1) * Math.hypot(...v2));
        if (!(Math.abs(cos) < Math.cos((35 * Math.PI) / 180))) ok = false;
      }
      if (!ok) continue;
      let score = 0;
      for (let i = 0; i < 4 && ok; i++) {
        if (sides[i].border) continue;
        const s = supportOf(sides[i], quad[i], quad[(i + 1) % 4]);
        if (!s || s.hit < 0.5 * s.inside) ok = false;
        else score += s.hit;
      }
      if (ok) cands.push({ quad, score });
    }
  }
  cands.sort((a, b) => b.score - a.score);
  const inQuad = (quad, x, y) => {
    for (let i = 0; i < 4; i++) if (cross3(quad[i], quad[(i + 1) % 4], [x, y]) < 0) return false;
    return true;
  };
  const out = [];
  for (const c of cands.slice(0, 24)) {
    if (out.length >= max) break;
    // at least half of the inside paper-like (the ink and a shadow are the rest)
    let tot = 0;
    let pap = 0;
    for (let y = 1; y < sh; y += 3) {
      for (let x = 1; x < sw; x += 3) {
        if (!inQuad(c.quad, x + 0.5, y + 0.5)) continue;
        tot++;
        if (paperLike(st, o, y * sw + x)) pap++;
      }
    }
    if (!tot || pap < 0.5 * tot) continue;
    const m = raster(sw, sh);
    for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) m.data[y * sw + x] = inQuad(c.quad, x + 0.5, y + 0.5) && paperLike(st, o, y * sw + x) ? 1 : 0;
    out.push({ quad: c.quad.map(([x, y]) => [x * f, y * f]), mask: fillHoles(m) });
  }
  return out;
}

/** Bilinear paperness (or, lum = true, luminance) at a sub-pixel point of the full image (null outside). */
function papernessAt(img, x, y, lum = false) {
  const { width: w, height: h, data: d } = img;
  const sx = x - 0.5;
  const sy = y - 0.5;
  if (sx < 0 || sy < 0 || sx > w - 1 || sy > h - 1) return null;
  const x0 = Math.floor(sx);
  const y0 = Math.floor(sy);
  const x1 = Math.min(w - 1, x0 + 1);
  const y1 = Math.min(h - 1, y0 + 1);
  const fx = sx - x0;
  const fy = sy - y0;
  const ch = (c) => {
    const a = d[(y0 * w + x0) * 4 + c] * (1 - fx) + d[(y0 * w + x1) * 4 + c] * fx;
    const b = d[(y1 * w + x0) * 4 + c] * (1 - fx) + d[(y1 * w + x1) * 4 + c] * fx;
    return a * (1 - fy) + b * fy;
  };
  return lum ? 0.299 * ch(0) + 0.587 * ch(1) + 0.114 * ch(2) : paperness(ch(0), ch(1), ch(2));
}


/**
 * The paper edge along one side of the coarse quadrilateral (corner A → corner B), on the full image: at points along
 * the side, a walk inwards along the normal finds the coarse mask (a bent sheet's edge lies inside the hull's side),
 * then the half-way crossing between the inside and the outside of the profile gives the edge to a fraction of a
 * pixel. mode 'paper': the paperness profile, the inside the brighter by ≥ 25 (a coloured or dark desk); 'any': the
 * luminance profile, either side the brighter by ≥ 8 (a grey or white desk; a colour cast would make the paper's
 * paperness cross the desk's). Points where the inside is not paper, or the contrast is weak, are skipped.
 * @returns {{ pts: [number, number, number][], n: number }}  pts: [x, y, t] ordered from A (t = 0) to B (t = 1);
 *   n: how many of the sample points lay inside the photo
 */
function sideEdges(img, sm, A, B, centre, mode, walk = true) {
  const { mask, f, paperLum } = sm;
  const W = img.width;
  const H = img.height;
  const L = Math.hypot(B[0] - A[0], B[1] - A[1]);
  if (L < 20) return { pts: [], n: 0 };
  const u = [(B[0] - A[0]) / L, (B[1] - A[1]) / L];
  let n = [-u[1], u[0]];
  const mid = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2];
  if ((mid[0] - centre[0]) * n[0] + (mid[1] - centre[1]) * n[1] < 0) n = [-n[0], -n[1]];
  const maskAt = (x, y) => {
    const mx = Math.floor(x / f);
    const my = Math.floor(y / f);
    return mx >= 0 && my >= 0 && mx < mask.w && my < mask.h && mask.data[my * mask.w + mx] === 1;
  };
  const N = Math.max(24, Math.min(160, Math.round(L / 8)));
  const maxIn = 0.2 * L;
  const reach = 2 * f + 2;
  const ds = 0.5;
  const minStep = mode === 'any' ? 8 : 25;
  const pts = [];
  const prof = [];
  let inside = 0;
  for (let k = 0; k < N; k++) {
    const t = 0.03 + (0.94 * k) / (N - 1);
    const p = [A[0] + u[0] * t * L, A[1] + u[1] * t * L];
    if (p[0] < 0 || p[1] < 0 || p[0] > W || p[1] > H) continue;
    inside++;
    let s0 = walk ? null : 0;
    if (walk && mode === 'any') {
      // no mask boundary to walk to (on a grey desk the mask is the quadrilateral itself): the nearest strong step
      // along the normal within ±M – the luminance 3 px in against 3 px out, at a local maximum, and at least half the
      // strongest there (the desk's grain makes small steps everywhere)
      const M = Math.max(12, Math.round(0.05 * L));
      const lv = [];
      for (let s = -M - 3; s <= M + 3; s++) lv.push(papernessAt(img, p[0] + n[0] * s, p[1] + n[1] * s, true));
      const dv = lv.map((_, j) => (j < 3 || j >= lv.length - 3 || lv[j - 3] == null || lv[j + 3] == null ? 0 : Math.abs(lv[j - 3] - lv[j + 3])));
      const strong = Math.max(minStep, 0.5 * Math.max(...dv));
      for (let j = 4; j < dv.length - 4; j++) {
        if (dv[j] < strong || dv[j] < dv[j - 1] || dv[j] <= dv[j + 1]) continue;
        const s = j - M - 3;
        if (s0 == null || Math.abs(s) < Math.abs(s0)) s0 = s;
      }
    }
    for (let s = f; walk && mode !== 'any' && s >= -maxIn; s -= f / 2) {
      if (maskAt(p[0] + n[0] * s, p[1] + n[1] * s)) {
        s0 = s;
        break;
      }
    }
    if (s0 == null) continue;
    prof.length = 0;
    let ok = true;
    for (let s = s0 - reach; s <= s0 + reach + 1e-9; s += ds) {
      const q = papernessAt(img, p[0] + n[0] * s, p[1] + n[1] * s, mode === 'any');
      if (q == null) {
        ok = false;
        break;
      }
      prof.push(q);
    }
    if (!ok) continue;
    const m = prof.length;
    const q4 = Math.max(1, Math.floor(m / 4));
    let qin = 0;
    let qout = 0;
    for (let i = 0; i < q4; i++) {
      qin += prof[i];
      qout += prof[m - 1 - i];
    }
    qin /= q4;
    qout /= q4;
    const down = qin > qout;
    if ((mode === 'any' ? Math.abs(qin - qout) : qin - qout) < minStep || qin < 0.35 * paperLum) continue;
    const half = (qin + qout) / 2;
    let bestS = null;
    for (let i = 0; i + 1 < m; i++) {
      if (down ? prof[i] >= half && prof[i + 1] < half : prof[i] <= half && prof[i + 1] > half) {
        const s = s0 - reach + (i + (prof[i] - half) / (prof[i] - prof[i + 1])) * ds;
        if (bestS == null || Math.abs(s - s0) < Math.abs(bestS - s0)) bestS = s;
      }
    }
    if (bestS != null) pts.push([p[0] + n[0] * bestS, p[1] + n[1] * bestS, t]);
  }
  return { pts, n: inside };
}

/**
 * The longest straight run of edge points near the start of seq: it begins within the first quarter of the points
 * (the coarse corner may overshoot the real one, so the first points can lie on the next side) and grows point by
 * point while at most 10 % of its points (and not the last three) lie farther than tol from its line (fitted on the
 * inliers).
 * @returns {{ line, k } | null}  k = number of points in the run
 */
function straightRun(seq, tol) {
  const minK = 8;
  const n = seq.length;
  if (n < minK) return null;
  let best = null;
  const maxStart = Math.floor(0.25 * n);
  for (let s0 = 0; s0 <= maxStart && n - s0 > (best?.k ?? minK - 1); s0++) {
    for (let k = minK; s0 + k <= n; k++) {
      const sub = seq.slice(s0, s0 + k);
      let line = fitLine(sub);
      const inl = sub.filter((q) => lineDist(line, q) <= tol);
      if (inl.length >= minK) line = fitLine(inl);
      const res = sub.map((q) => lineDist(line, q));
      let bad = 0;
      for (const r of res) if (r > tol) bad++;
      if (bad > 0.1 * k || res.slice(-3).every((r) => r > tol) || res[0] > tol) break;
      if (!best || k > best.k) best = { line, k };
    }
  }
  return best;
}

/**
 * The line of each side of the coarse quadrilateral that is not cut. A straight side (one run covers ≥ 75 % of its edge
 * points – the rest may be hidden under something) gives its run's line. A curved side (the sheet bends over the desk's
 * edge, or is curled) is taken from the end at the flat corner: the corner whose other side is the straighter one.
 * @returns {({ p, u, first, last } | null)[]}  first, last: the end points of the stretch the line was measured on
 */
function sideLines(img, sm, quad, cut, mode) {
  const centre = [quad.reduce((s, p) => s + p[0], 0) / 4, quad.reduce((s, p) => s + p[1], 0) / 4];
  const sides = quad.map((A, i) => {
    if (cut[i]) return null;
    const B = quad[(i + 1) % 4];
    const { pts } = sideEdges(img, sm, A, B, centre, mode);
    const tol = Math.max(1.5, 0.0015 * Math.hypot(B[0] - A[0], B[1] - A[1]));
    const fromA = straightRun(pts, tol);
    const fromB = straightRun(pts.slice().reverse(), tol);
    const frac = pts.length ? Math.max(fromA?.k ?? 0, fromB?.k ?? 0) / pts.length : 0;
    return { pts, tol, fromA, fromB, frac };
  });
  return sides.map((sd, i) => {
    if (!sd || (!sd.fromA && !sd.fromB)) return null;
    const longer = (sd.fromA?.k ?? 0) >= (sd.fromB?.k ?? 0) ? sd.fromA : sd.fromB;
    let line = longer.line;
    if (sd.frac < 0.75) {
      const atA = sides[(i + 3) % 4]?.frac ?? 0; // the other side at corner A (= corner i)
      const atB = sides[(i + 1) % 4]?.frac ?? 0; // the other side at corner B (= corner i + 1)
      line = ((atA >= atB ? sd.fromA : sd.fromB) ?? longer).line;
    }
    const on = sd.pts.filter((q) => lineDist(line, q) <= sd.tol);
    return { ...line, first: on[0], last: on[on.length - 1] };
  });
}

const SIDES = ['top', 'right', 'bottom', 'left'];

/**
 * How well each side of the final quadrilateral is backed by the paper's edge: at points along the side inside the
 * photo, the edge is looked for around the side itself (no walk inwards), and support is the share of them where it
 * lies within max(2 px, 0.3 % of the side) of the side. A wrong side – across the desk, or to a corner the hull left
 * in the wrong place – has its edge elsewhere or nowhere. A cut side has none.
 */
function sideSupport(img, sm, quad, cut, mode) {
  const centre = [quad.reduce((s, p) => s + p[0], 0) / 4, quad.reduce((s, p) => s + p[1], 0) / 4];
  return quad.map((A, i) => {
    if (cut[i]) return 0;
    const B = quad[(i + 1) % 4];
    const len = Math.hypot(B[0] - A[0], B[1] - A[1]);
    const { pts, n } = sideEdges(img, sm, A, B, centre, mode, false);
    if (!n || !(len > 0)) return 0;
    const L = { p: A, u: [(B[0] - A[0]) / len, (B[1] - A[1]) / len] };
    const tol = Math.max(2, 0.003 * len);
    return pts.filter((q) => lineDist(L, q) <= tol).length / n;
  });
}

/**
 * Whether each side is the paper's edge – paper on one side, another surface on the other – and not a line drawn on
 * the paper (a wall: dark, with paper again beyond its thickness; text and a grid outside it on the same paper). At
 * points along the side inside the photo, the brightest of 7 samples across a band – the surface's own level, past thin
 * ink lines – just inside (1–2 % of the side's length) must be paper-like (≥ 0.45 × the bright paper, and ≥ 0.7 × the
 * outside: a sheet is never much darker than the desk around it, a wall is than the paper), and differ by ≥ 4 % both
 * from just outside (1–2 %) and from well outside (4–8 %); and well outside must differ by ≥ 4 % from the brightest
 * paper deeper in (1–25 %) as well – a grey fill drawn on white paper has that white paper both outside and further in.
 * contrast: the share of the points (whose bands lie in the photo) that pass, per side; null when fewer than five
 * points could be tested (a side along the border).
 */
function sideContrast(img, quad, cut, paperLum) {
  const W = img.width;
  const H = img.height;
  const centre = [quad.reduce((s, p) => s + p[0], 0) / 4, quad.reduce((s, p) => s + p[1], 0) / 4];
  const lumAt = (x, y) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    if (xi < 0 || yi < 0 || xi >= W || yi >= H) return null;
    const i = (yi * W + xi) * 4;
    return 0.299 * img.data[i] + 0.587 * img.data[i + 1] + 0.114 * img.data[i + 2];
  };
  return quad.map((A, i) => {
    if (cut[i]) return null;
    const B = quad[(i + 1) % 4];
    const L = Math.hypot(B[0] - A[0], B[1] - A[1]);
    let n = [-(B[1] - A[1]) / L, (B[0] - A[0]) / L];
    if (((A[0] + B[0]) / 2 - centre[0]) * n[0] + ((A[1] + B[1]) / 2 - centre[1]) * n[1] < 0) n = [-n[0], -n[1]];
    let tested = 0;
    let pass = 0;
    for (let k = 0; k < 30; k++) {
      const t = 0.1 + (0.8 * k) / 29;
      const p = [A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t];
      // the brightest sample across a band from s0 to s1 × L along the normal (negative = inside), or null when the
      // band leaves the photo
      const band = (s0, s1, m = 7) => {
        let top = 0;
        for (let j = 0; j < m; j++) {
          const s = L * (s0 + ((s1 - s0) * j) / (m - 1));
          const v = lumAt(p[0] + n[0] * s, p[1] + n[1] * s);
          if (v == null) return null;
          if (v > top) top = v;
        }
        return top;
      };
      const inside = band(-0.02, -0.01);
      const near = band(0.01, 0.02);
      const far = band(0.04, 0.08);
      const deep = band(-0.25, -0.01, 25);
      if (inside == null || near == null || far == null || deep == null) continue;
      tested++;
      const diff = (a, b) => Math.abs(a - b) / Math.max(a, b, 1);
      if (inside >= 0.45 * paperLum && inside >= 0.7 * Math.max(near, far) && diff(inside, near) >= 0.04 && diff(inside, far) >= 0.04 && diff(deep, far) >= 0.04) pass++;
    }
    return tested >= 5 ? pass / tested : null;
  });
}

/**
 * The sheet's four corners from a coarse quadrilateral (clockwise on the screen), measured on the full image and
 * checked. A side of the coarse quadrilateral that lies on the photo's border is cut: not measured, but rebuilt from
 * the other three and the camera (rebuildSide). The corners are ordered top left, top right, bottom right, bottom
 * left (the top side the one nearest to horizontal). weights: how much each corner is measured rather than
 * extrapolated – 1 when both its sides were measured up to it, falling as the lines are extended over a hidden or bent
 * stretch (1 / (1 + (e / 0.1)²), e = the longer extension as a share of its side), 0.05 for a cut side's corners.
 * @returns {{ quad, weights, cut: boolean[], support: number[], mask, f } | { reason: string }}
 */
function measureSheet(img, sm, coarse, o, mode) {
  const W = img.width;
  const H = img.height;
  let quad = coarse.map((p) => p.slice());
  if (shoelace(quad) < 0) quad.reverse();
  const tb = 2 * sm.f + 2;
  const onBorder = (a, b) => (a[0] <= tb && b[0] <= tb) || (a[0] >= W - tb && b[0] >= W - tb) || (a[1] <= tb && b[1] <= tb) || (a[1] >= H - tb && b[1] >= H - tb);
  let cut = quad.map((a, i) => onBorder(a, quad[(i + 1) % 4]));
  const nCut = cut.filter(Boolean).length;
  if (nCut === 4) return { reason: 'no-sheet' }; // the whole frame is «paper»: a close-up, or a plan with no desk
  if (nCut > 1) return { reason: 'unsure' }; // two sides outside the photo: its extent is unknown along both axes
  // each side's line on the full image; the corners are the intersections of neighbouring sides
  const lines = sideLines(img, sm, quad, cut, mode);
  const side = (i) => Math.hypot(quad[(i + 1) % 4][0] - quad[i][0], quad[(i + 1) % 4][1] - quad[i][1]);
  quad = quad.map((c, i) => {
    const L0 = lines[(i + 3) % 4];
    const L1 = lines[i];
    if (!L0 || !L1) return c;
    const X = intersectLines(L0.p, [L0.p[0] + L0.u[0], L0.p[1] + L0.u[1]], L1.p, [L1.p[0] + L1.u[0], L1.p[1] + L1.u[1]]);
    const lim = 0.25 * Math.min(side((i + 3) % 4), side(i));
    return X && Math.hypot(X[0] - c[0], X[1] - c[1]) <= lim ? X : c;
  });
  let weights = quad.map((c, i) => {
    const L0 = lines[(i + 3) % 4];
    const L1 = lines[i];
    if (!L0 || !L1) return 0.05;
    const e = Math.max(Math.hypot(L0.last[0] - c[0], L0.last[1] - c[1]) / side((i + 3) % 4), Math.hypot(L1.first[0] - c[0], L1.first[1] - c[1]) / side(i));
    return 1 / (1 + (e / 0.1) ** 2);
  });
  const ci = cut.indexOf(true);
  if (ci >= 0) {
    // at the default focal length – or the nearest one at which the visible part fits on an A sheet (rectifyPhoto
    // measures the camera's own later, from the walls)
    let rebuilt = null;
    for (const k of [1, 0.93, 1.07, 0.86, 1.15, 0.8, 1.25, 0.72, 1.4, 0.62, 1.6]) {
      rebuilt = rebuildSide(quad, lines, ci, W, H, k * o.focal * Math.hypot(W, H));
      if (rebuilt) break;
    }
    if (!rebuilt) return { reason: 'unsure' };
    quad[ci] = rebuilt[0];
    quad[(ci + 1) % 4] = rebuilt[1];
  }
  // the top side: the one nearest to horizontal, pointing right
  let start = 0;
  let bestAng = Infinity;
  for (let i = 0; i < 4; i++) {
    const a = quad[i];
    const b = quad[(i + 1) % 4];
    const ang = Math.abs(Math.atan2(b[1] - a[1], b[0] - a[0]));
    if (ang < bestAng) {
      bestAng = ang;
      start = i;
    }
  }
  const turn = (arr) => [0, 1, 2, 3].map((i) => arr[(start + i) % 4]);
  quad = turn(quad);
  weights = turn(weights);
  cut = turn(cut);
  // sanity: a convex quadrilateral of a decent size with angles a perspective view of a rectangle can give
  const area = shoelace(quad);
  if (!(area >= o.minArea * W * H)) return { reason: 'no-sheet' };
  for (let i = 0; i < 4; i++) {
    const a = quad[(i + 3) % 4];
    const b = quad[i];
    const c = quad[(i + 1) % 4];
    const v1 = [a[0] - b[0], a[1] - b[1]];
    const v2 = [c[0] - b[0], c[1] - b[1]];
    const cos = (v1[0] * v2[0] + v1[1] * v2[1]) / (Math.hypot(...v1) * Math.hypot(...v2));
    if (!(Math.abs(cos) < Math.cos((35 * Math.PI) / 180))) return { reason: 'unsure' }; // every angle within 35°–145°
    if (cross3(a, b, c) <= 0) return { reason: 'unsure' }; // not convex in the screen-clockwise order
  }
  // the whole frame is «paper»: a digital plan or a scan, nothing to straighten
  const tol = 0.02 * Math.max(W, H);
  const frame = [[0, 0], [W, 0], [W, H], [0, H]];
  if (quad.every((p, i) => Math.hypot(p[0] - frame[i][0], p[1] - frame[i][1]) <= tol)) return { reason: 'no-sheet' };
  // every measured side backed by the paper's edge – a desk taken for paper has no edge where its «side» runs
  const support = sideSupport(img, sm, quad, cut, mode);
  if (support.some((s, i) => !cut[i] && !(s >= o.minSupport))) return { reason: 'unsure', support };
  // an A sheet (± 15 %) under some plausible camera – at the focal length the vanishing points give, or else at any
  // of 0.35–2 × the diagonal: a house's outline or a filled area taken for the sheet has its own proportions
  if (!cut.some(Boolean)) {
    const diag = Math.hypot(W, H);
    const shape = sheetShape(quad, W, H, o);
    const v = vanishing(quad, W / 2, H / 2);
    const fs = shape?.measured ? [shape.f] : [0.35, 0.5, 0.7, 1, 1.4, 2].map((k) => k * diag);
    const isA = (f) => {
      const a = aspectOf(v, f);
      return Math.abs(Math.log(a < 1 ? a * Math.SQRT2 : a / Math.SQRT2)) <= Math.log(1.15);
    };
    if (!v || !fs.some(isA)) return { reason: 'unsure', support, aspect: shape?.aspect };
  }
  // from the edges: every measured side the paper's edge, not a wall drawn on it (paper on both sides)
  if (mode === 'any') {
    const contrast = sideContrast(img, quad, cut, sm.paperLum);
    if (contrast.some((c) => c != null && c < 0.5)) return { reason: 'unsure', support, contrast };
  }
  return { quad, weights, cut, support, mask: sm.mask, f: sm.f };
}

/**
 * A digital plan shown in a viewer (a screenshot, a PDF page on grey): its «sheet» is an axis-aligned rectangle
 * (every side within 0.5° of an axis) in a flat, noise-free surround (≥ 60 % of a band 3 % of the long side wide
 * outside it is one exact colour) – no desk, no perspective.
 */
function looksDigital(img, quad) {
  for (let i = 0; i < 4; i++) {
    const a = quad[i];
    const b = quad[(i + 1) % 4];
    const ang = Math.atan2(Math.abs(b[1] - a[1]), Math.abs(b[0] - a[0]));
    if (Math.min(ang, Math.PI / 2 - ang) > (0.5 * Math.PI) / 180) return false;
  }
  const { width: W, height: H, data: d } = img;
  const band = 0.03 * Math.max(W, H);
  const cx = quad.reduce((s, p) => s + p[0], 0) / 4;
  const cy = quad.reduce((s, p) => s + p[1], 0) / 4;
  const colours = new Map();
  let n = 0;
  for (let i = 0; i < 4; i++) {
    const a = quad[i];
    const b = quad[(i + 1) % 4];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    let nx = (b[1] - a[1]) / L;
    let ny = -(b[0] - a[0]) / L;
    if (((a[0] + b[0]) / 2 - cx) * nx + ((a[1] + b[1]) / 2 - cy) * ny < 0) {
      nx = -nx;
      ny = -ny;
    }
    for (let k = 0; k < 40; k++) {
      const t = 0.05 + (0.9 * k) / 39;
      for (let j = 1; j <= 5; j++) {
        const x = Math.floor(a[0] + (b[0] - a[0]) * t + (nx * band * j) / 5);
        const y = Math.floor(a[1] + (b[1] - a[1]) * t + (ny * band * j) / 5);
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        const q = (y * W + x) * 4;
        const key = (d[q] << 16) | (d[q + 1] << 8) | d[q + 2];
        colours.set(key, (colours.get(key) ?? 0) + 1);
        n++;
      }
    }
  }
  if (n < 50) return false;
  let top = 0;
  for (const c of colours.values()) if (c > top) top = c;
  return top / n >= 0.6;
}

/**
 * The sheet: first from the paper-like region (lumMask, the paper edge measured as a step down from the paper), then,
 * if that gives no sheet whose sides are backed by the paper's edge, from the straight edges (edgeQuads, the best few
 * in turn, the edge measured either way).
 * @returns {{ quad, weights, cut, support, mask, f, method: 'colour'|'edges' } | { reason: string }}
 */
function findSheet(img, o) {
  const st = sheetStats(img, o);
  if (!st) return { reason: 'no-sheet' };
  const sm = { f: st.f, paperLum: st.paperLum };
  const reasons = [];
  const mask = lumMask(st, o);
  const coarse = mask && maskQuad(mask, st.f);
  if (coarse) {
    const r = measureSheet(img, { ...sm, mask }, coarse, o, 'paper');
    if (r.quad) return { ...r, method: 'colour' };
    reasons.push(r.reason);
  }
  for (const e of edgeQuads(st, o)) {
    const r = measureSheet(img, { ...sm, mask: e.mask }, e.quad, o, 'any');
    if (r.quad) return { ...r, method: 'edges' };
    reasons.push(r.reason);
  }
  return { reason: reasons.includes('unsure') ? 'unsure' : 'no-sheet' };
}

// ---------------------------------------------------------------------------------------------------------------
// Warp and light

/**
 * Running max (or min) over a window of 2r + 1 along the rows ('h') or columns ('v') of a w × h float raster – the van
 * Herk / Gil–Werman algorithm, three comparisons per sample whatever r is. Outside the raster does not count.
 */
function runningExtreme(src, w, h, r, axis, isMax) {
  const out = new Float32Array(src.length);
  const n = axis === 'h' ? w : h;
  const lines = axis === 'h' ? h : w;
  const step = axis === 'h' ? 1 : w;
  const k = 2 * r + 1;
  const len = n + 2 * r;
  const pad = isMax ? -Infinity : Infinity;
  const buf = new Float32Array(len);
  const pre = new Float32Array(len);
  const suf = new Float32Array(len);
  for (let l = 0; l < lines; l++) {
    const base = axis === 'h' ? l * w : l;
    for (let i = 0; i < len; i++) {
      const j = i - r;
      buf[i] = j >= 0 && j < n ? src[base + j * step] : pad;
    }
    for (let i = 0; i < len; i++) {
      const v = buf[i];
      pre[i] = i % k === 0 ? v : isMax ? (v > pre[i - 1] ? v : pre[i - 1]) : v < pre[i - 1] ? v : pre[i - 1];
    }
    for (let i = len - 1; i >= 0; i--) {
      const v = buf[i];
      suf[i] = i % k === k - 1 || i === len - 1 ? v : isMax ? (v > suf[i + 1] ? v : suf[i + 1]) : v < suf[i + 1] ? v : suf[i + 1];
    }
    for (let j = 0; j < n; j++) {
      const a = suf[j];
      const b = pre[j + 2 * r];
      out[base + j * step] = isMax ? (a > b ? a : b) : a < b ? a : b;
    }
  }
  return out;
}

/** Box blur (mean over 2r + 1 along each axis, the window clipped at the border) of a w × h float raster. */
function boxBlur(src, w, h, r) {
  let cur = src;
  for (const axis of ['h', 'v']) {
    const out = new Float32Array(cur.length);
    const n = axis === 'h' ? w : h;
    const lines = axis === 'h' ? h : w;
    const step = axis === 'h' ? 1 : w;
    const pre = new Float64Array(n + 1);
    for (let l = 0; l < lines; l++) {
      const base = axis === 'h' ? l * w : l;
      for (let i = 0; i < n; i++) pre[i + 1] = pre[i] + cur[base + i * step];
      for (let i = 0; i < n; i++) {
        const a = Math.max(0, i - r);
        const b = Math.min(n, i + r + 1);
        out[base + i * step] = (pre[b] - pre[a]) / (b - a);
      }
    }
    cur = out;
  }
  return cur;
}

/**
 * The paper's light under each channel, at half resolution. A grey closing of the luminance (running max, then running
 * min, over a square of 2r + 1) removes the ink – everything darker and narrower than the window – and keeps the
 * shading, including the soft edge of a shadow (a monotone ramp passes a closing unchanged). That envelope rides on the
 * grain's peaks, so the light is the local mean of the paper pixels under it: the pixels within 20 % of the envelope,
 * one mask for all channels (a normalised box blur per channel); where a large dark area leaves no paper nearby, the
 * envelope scaled to the paper's mean. Pixels that are not the sheet count as white in the envelope, so they never
 * darken the paper next to them, and never count as paper.
 * @param {Float32Array[]} chans  1 (luminance) or 3 (R, G, B) full-resolution channels
 * @returns {{ g: Float32Array, w: number, h: number }[]}  per channel
 */
function background(chans, isSheet, W, H, r) {
  const w = Math.ceil(W / 2);
  const h = Math.ceil(H / 2);
  const halves = chans.map(() => new Float32Array(w * h));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      for (let c = 0; c < chans.length; c++) {
        let s2 = 0;
        let n = 0;
        for (let yy = 2 * y; yy < Math.min(H, 2 * y + 2); yy++) {
          for (let xx = 2 * x; xx < Math.min(W, 2 * x + 2); xx++) {
            const i = yy * W + xx;
            s2 += isSheet[i] ? chans[c][i] : 255;
            n++;
          }
        }
        halves[c][y * w + x] = s2 / n;
      }
    }
  }
  let L = halves[0];
  if (chans.length === 3) {
    L = new Float32Array(w * h);
    for (let k = 0; k < L.length; k++) L[k] = 0.299 * halves[0][k] + 0.587 * halves[1][k] + 0.114 * halves[2][k];
  }
  let env = runningExtreme(L, w, h, r, 'h', true);
  env = runningExtreme(env, w, h, r, 'v', true);
  env = runningExtreme(env, w, h, r, 'h', false);
  env = runningExtreme(env, w, h, r, 'v', false);
  const m = new Float32Array(w * h);
  for (let k = 0; k < L.length; k++) if (L[k] < 255 && L[k] > 0.8 * env[k]) m[k] = 1;
  const rb = Math.max(2, Math.round(r / 2));
  const den = boxBlur(boxBlur(m, w, h, rb), w, h, rb);
  return halves.map((half) => {
    const vm = new Float32Array(w * h);
    let ratio = 0;
    let nr = 0;
    for (let k = 0; k < half.length; k++) {
      if (!m[k]) continue;
      vm[k] = half[k];
      ratio += half[k] / env[k];
      nr++;
    }
    ratio = nr ? ratio / nr : 1;
    const num = boxBlur(boxBlur(vm, w, h, rb), w, h, rb);
    const g = new Float32Array(w * h);
    for (let k = 0; k < g.length; k++) {
      const t = Math.min(1, den[k] / 0.1); // blend into the envelope where there is little paper
      g[k] = t * (den[k] > 0 ? num[k] / den[k] : 0) + (1 - t) * env[k] * ratio;
    }
    return { g, w, h };
  });
}

/** A half-resolution raster at full-resolution pixel (x, y), bilinear. */
function halfAt(G, x, y) {
  const { g, w, h } = G;
  const gx = Math.max(0, Math.min(w - 1, (x + 0.5) / 2 - 0.5));
  const gy = Math.max(0, Math.min(h - 1, (y + 0.5) / 2 - 0.5));
  const x0 = Math.floor(gx);
  const y0 = Math.floor(gy);
  const x1 = Math.min(w - 1, x0 + 1);
  const y1 = Math.min(h - 1, y0 + 1);
  const fx = gx - x0;
  const fy = gy - y0;
  const a = g[y0 * w + x0] * (1 - fx) + g[y0 * w + x1] * fx;
  const b = g[y1 * w + x0] * (1 - fx) + g[y1 * w + x1] * fx;
  return a * (1 - fy) + b * fy;
}

/**
 * The source through a homography (output pixel → source point), bilinear: R, G and B (rgb = true) or the luminance
 * as float rasters, and which output pixels are the sheet (the coarse mask, nearest). Outside the source = white, not
 * the sheet.
 */
function warp(img, Hm, W, H, sheet, rgb) {
  const { width: w, height: h, data: d } = img;
  const { mask, f } = sheet;
  const { w: mw, h: mh } = mask;
  const n = W * H;
  const out = (rgb ? [0, 1, 2] : [0]).map(() => new Float32Array(n));
  const [o0, o1, o2] = out;
  const isSheet = new Uint8Array(n);
  for (let y = 0; y < H; y++) {
    const Y = y + 0.5;
    for (let x = 0; x < W; x++) {
      const X = x + 0.5;
      const den = Hm[6] * X + Hm[7] * Y + Hm[8];
      const px = (Hm[0] * X + Hm[1] * Y + Hm[2]) / den;
      const py = (Hm[3] * X + Hm[4] * Y + Hm[5]) / den;
      const i = y * W + x;
      const sx = px - 0.5;
      const sy = py - 0.5;
      if (!(sx >= 0 && sy >= 0 && sx <= w - 1 && sy <= h - 1)) {
        o0[i] = 255;
        if (rgb) o1[i] = o2[i] = 255;
        continue;
      }
      isSheet[i] = mask.data[Math.min(mh - 1, Math.floor(py / f)) * mw + Math.min(mw - 1, Math.floor(px / f))];
      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      const x1 = Math.min(w - 1, x0 + 1);
      const y1 = Math.min(h - 1, y0 + 1);
      const fx = sx - x0;
      const fy = sy - y0;
      const i00 = (y0 * w + x0) * 4;
      const i01 = (y0 * w + x1) * 4;
      const i10 = (y1 * w + x0) * 4;
      const i11 = (y1 * w + x1) * 4;
      const w00 = (1 - fx) * (1 - fy);
      const w01 = fx * (1 - fy);
      const w10 = (1 - fx) * fy;
      const w11 = fx * fy;
      const r = d[i00] * w00 + d[i01] * w01 + d[i10] * w10 + d[i11] * w11;
      const g = d[i00 + 1] * w00 + d[i01 + 1] * w01 + d[i10 + 1] * w10 + d[i11 + 1] * w11;
      const b = d[i00 + 2] * w00 + d[i01 + 2] * w01 + d[i10 + 2] * w10 + d[i11 + 2] * w11;
      if (rgb) {
        o0[i] = r;
        o1[i] = g;
        o2[i] = b;
      } else o0[i] = 0.299 * r + 0.587 * g + 0.114 * b;
    }
  }
  return { out, isSheet };
}

/** The channels divided by their background, in place: 1 = paper. Pixels that are not the sheet, and a margin, → 1. */
function flatten(chans, isSheet, W, H, o) {
  const long = Math.max(W, H);
  const Gs = background(chans, isSheet, W, H, Math.max(4, Math.round((o.inkWindow * long) / 2)));
  const margin = Math.max(2, Math.round(0.004 * long));
  chans.forEach((v, c) => {
    const G = Gs[c];
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        v[i] = !isSheet[i] || x < margin || y < margin || x >= W - margin || y >= H - margin ? 1 : v[i] / Math.max(8, halfAt(G, x, y));
      }
    }
  });
  return chans;
}

/**
 * The drawing's own lines refine the rectification: a plan's walls are straight and run along two perpendicular
 * directions, so in a correct rectification their edges are exactly horizontal and vertical. On a flattened
 * luminance (1 = paper), the strong, long, thin edge components (walls; thin lines are too faint, text too short) are
 * fitted with lines; each family gives a vanishing point (least squares, the outliers dropped), and the correction
 * sends them back to infinity along x and y. A bent sheet's extrapolated corner and an occluded corner leave a small
 * tilt, shear or keystone that this removes; the aspect stays the paper's (the caller refits the A rectangle).
 * @returns {number[] | null}  the correction (this frame → corrected frame), or null without enough lines
 */
function contentCorrection(lum, isSheet, W, H, o) {
  const n = W * H;
  const masks = [0, 1, 2, 3].map(() => raster(W, H));
  const gmag = new Float32Array(n);
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      if (!isSheet[i]) continue;
      const gx = lum[i + 1] - lum[i - 1];
      const gy = lum[i + W] - lum[i - W];
      const ax = Math.abs(gx);
      const ay = Math.abs(gy);
      if (ay > o.edgeStep && ay > 2 * ax) {
        masks[gy > 0 ? 0 : 1].data[i] = 1;
        gmag[i] = ay;
      } else if (ax > o.edgeStep && ax > 2 * ay) {
        masks[gx > 0 ? 2 : 3].data[i] = 1;
        gmag[i] = ax;
      }
    }
  }
  const long = Math.max(W, H);
  const minLen = o.minEdge * long;
  const s = long / 2;
  const cx = W / 2;
  const cy = H / 2;
  const fams = [[], []]; // horizontal, vertical: { e: [a, b, c] normalised line, w }
  masks.forEach((m, mi) => {
    const horiz = mi < 2;
    const { labels, comps } = components(m, 8);
    const keep = comps.map((c) => {
      const along = horiz ? c.maxX - c.minX + 1 : c.maxY - c.minY + 1;
      const across = horiz ? c.maxY - c.minY + 1 : c.maxX - c.minX + 1;
      return along >= minLen && across <= 0.08 * along + 6;
    });
    const mom = comps.map(() => new Float64Array(6));
    for (let i = 0; i < n; i++) {
      const l = labels[i];
      if (l < 0 || !keep[l]) continue;
      const x = (i % W) + 0.5;
      const y = Math.floor(i / W) + 0.5;
      const w = gmag[i];
      const M = mom[l];
      M[0] += w;
      M[1] += w * x;
      M[2] += w * y;
      M[3] += w * x * x;
      M[4] += w * x * y;
      M[5] += w * y * y;
    }
    comps.forEach((c, l) => {
      const M = mom[l];
      if (!keep[l] || !M[0]) return;
      const mx = M[1] / M[0];
      const my = M[2] / M[0];
      const sxx = M[3] / M[0] - mx * mx;
      const sxy = M[4] / M[0] - mx * my;
      const syy = M[5] / M[0] - my * my;
      const th = 0.5 * Math.atan2(2 * sxy, sxx - syy);
      const ux = Math.cos(th);
      const uy = Math.sin(th);
      const spread = Math.sqrt(Math.max(0, sxx * uy * uy - 2 * sxy * ux * uy + syy * ux * ux));
      if (spread > 1.5) return; // not one straight edge
      if (Math.abs(horiz ? uy : ux) > Math.sin((6 * Math.PI) / 180)) return;
      const a = -uy;
      const b = ux;
      const X = (mx - cx) / s;
      const Y = (my - cy) / s;
      const along = horiz ? c.maxX - c.minX + 1 : c.maxY - c.minY + 1;
      fams[horiz ? 0 : 1].push({ e: horiz ? [a, b, -(a * X + b * Y)] : [b, a, -(a * X + b * Y)], w: along });
    });
  });
  // each family's vanishing point: v = (1, p, q) for the horizontal lines, (r, 1, t) for the vertical ones – one
  // linear least squares on e0 + e1·p + e2·q = 0 (e = the line with the roles of a and b swapped for the vertical
  // family), the lines that disagree dropped
  const vp = (lines) => {
    let L = lines;
    let sol = null;
    for (let pass = 0; pass < 3; pass++) {
      if (L.length < 3) return null;
      let s11 = 0;
      let s12 = 0;
      let s22 = 0;
      let r1 = 0;
      let r2 = 0;
      let sw = 0;
      for (const { e, w } of L) {
        s11 += w * e[1] * e[1];
        s12 += w * e[1] * e[2];
        s22 += w * e[2] * e[2];
        r1 -= w * e[0] * e[1];
        r2 -= w * e[0] * e[2];
        sw += w;
      }
      const lam = 1e-4 * sw; // a little ridge: lines all at one height say nothing about the perspective term
      s11 += lam;
      s22 += lam;
      const det = s11 * s22 - s12 * s12;
      if (!(det > 0)) return null;
      sol = [(r1 * s22 - r2 * s12) / det, (s11 * r2 - s12 * r1) / det];
      const res = L.map(({ e }) => Math.abs(e[0] + e[1] * sol[0] + e[2] * sol[1]));
      const med = res.slice().sort((x, y) => x - y)[Math.floor(res.length / 2)];
      const lim = Math.max(4 * med, 0.002);
      const next = L.filter((_, k) => res[k] <= lim);
      if (next.length === L.length) break;
      L = next;
    }
    return sol && L.length >= 3 ? { sol, n: L.length } : null;
  };
  const vh = vp(fams[0]);
  const vv = vp(fams[1]);
  if (!vh || !vv) return null;
  const [p, q] = vh.sol;
  const [r, t] = vv.sol;
  if (![p, q, r, t].every((v) => Math.abs(v) < 0.1)) return null;
  // M sends e1 → (1, p, q), e2 → (r, 1, t), e3 → the centre; its inverse is the correction (normalised frame)
  const Minv = inv3([1, r, 0, p, 1, 0, q, t, 1]);
  if (!Minv) return null;
  const T = [1 / s, 0, -cx / s, 0, 1 / s, -cy / s, 0, 0, 1];
  const Ti = [s, 0, cx, 0, s, cy, 0, 0, 1];
  return mul3(Ti, mul3(Minv, T));
}

/**
 * Straightens and flattens a photo of a printed plan (see the top of the file).
 * @param {{ width: number, height: number, data: Uint8ClampedArray }} img  RGBA
 * @param {{ maxSide?: number }} options  maxSide and the other PHOTO_DEFAULTS (undefined or null = the default)
 * @returns {{ img, quad: [number, number][] | null, applied: boolean, cut: string[], aspect: number | null, reason?: 'digital'|'no-sheet'|'unsure' }}
 */
export function rectifyPhoto(img, options = {}) {
  const o = withDefaults(options);
  const none = (reason) => ({ img, quad: null, applied: false, cut: [], aspect: null, reason });
  // clearly digital (the test set's plans score ≤ 0.01, a viewer's flat bars 0): nothing to do. Between that and
  // isPhoto's 0.5 – an overexposed photo on a grey desk, its paper clipped to white – the checks below decide
  if (isPhoto(img).score < 0.25) return none('digital');
  const found = findSheet(img, o);
  if (!found.quad) return none(found.reason);
  const { quad } = found;
  if (looksDigital(img, quad)) return none('digital');
  // which output pixels are the sheet: the coarse mask, one cell in (its boundary cells mix in the desk, a keyboard)
  const sheet = { ...found, mask: erode(found.mask, 1) };

  // ---- size: A ratio, portrait or landscape like the sheet on the desk – the camera model's aspect, not the side
  // lengths in the photo (a steep shot shortens the far side: a portrait sheet whose long axis points away looks
  // landscape)
  const shape = sheetShape(quad, img.width, img.height, o);
  const side = (i) => Math.hypot(quad[(i + 1) % 4][0] - quad[i][0], quad[(i + 1) % 4][1] - quad[i][1]);
  const landscape = shape ? shape.aspect > 1 : side(0) + side(2) > side(1) + side(3);
  const long = Math.max(16, Math.round(o.maxSide));
  const short = Math.round(long / Math.SQRT2);
  const W = landscape ? long : short;
  const H = landscape ? short : long;
  let Hm = solveHomography([[0, 0], [W, 0], [W, H], [0, H]], quad);
  if (!Hm) return none('unsure');

  // ---- the drawing's lines refine it, on a low-resolution warp (twice: the second pass mops up)
  let refined = false;
  if (o.refine) {
    const k = Math.min(1, o.refineSide / long);
    const W1 = Math.max(16, Math.round(W * k));
    const H1 = Math.max(16, Math.round(H * k));
    const Sk = [W1 / W, 0, 0, 0, H1 / H, 0, 0, 0, 1];
    const Ski = inv3(Sk);
    for (let pass = 0; pass < 2; pass++) {
      const low = warp(img, mul3(Hm, Ski), W1, H1, sheet, false);
      const [lum] = flatten(low.out, low.isSheet, W1, H1, o);
      const C = contentCorrection(lum, low.isSheet, W1, H1, o);
      if (!C) break;
      // the paper's corners in the corrected frame → an axis-aligned box (each side the mean of its two corners,
      // weighted by how much they were measured) → the A rectangle
      const cs = [[0, 0], [W1, 0], [W1, H1], [0, H1]].map((c) => mapPoint(C, c));
      const wt = sheet.weights;
      const avg = (i, j, k) => (cs[i][k] * wt[i] + cs[j][k] * wt[j]) / (wt[i] + wt[j]);
      const x0 = avg(0, 3, 0);
      const x1 = avg(1, 2, 0);
      const y0 = avg(0, 1, 1);
      const y1 = avg(2, 3, 1);
      if (!(x1 - x0 > 0.5 * W1 && y1 - y0 > 0.5 * H1)) break;
      const Fit = [W1 / (x1 - x0), 0, (-W1 * x0) / (x1 - x0), 0, H1 / (y1 - y0), (-H1 * y0) / (y1 - y0), 0, 0, 1];
      const corr = mul3(Ski, mul3(mul3(Fit, C), Sk)); // full-resolution output frame → corrected output frame
      const ci = inv3(corr);
      if (!ci) break;
      // how far the correction moves the output's corners (px): stop when it is negligible, refuse when it is wild
      const moved = Math.max(...[[0, 0], [W, 0], [W, H], [0, H]].map((c) => {
        const m = mapPoint(corr, c);
        return Math.hypot(m[0] - c[0], m[1] - c[1]);
      }));
      if (moved > 0.08 * long) break;
      Hm = mul3(Hm, ci);
      const sc = Hm[8];
      Hm = Hm.map((v) => v / sc);
      refined = true;
      if (moved < 0.5) break;
    }
  }

  // ---- a cut side was placed with the default focal length. With the walls straight, the output's two axes are the
  // sheet's, and their vanishing points give the camera's own focal length (Zhang & He) when the perspective is strong
  // enough to tell it – and with it the sheet's true extent across the cut: the box of the output that is the A sheet
  if (refined && found.cut.some(Boolean)) {
    const v = vanishing([[0, 0], [W, 0], [W, H], [0, H]].map((c) => mapPoint(Hm, c)), img.width / 2, img.height / 2);
    const fc = focalOf(v);
    const diag = Math.hypot(img.width, img.height);
    const a = fc && fc >= 0.3 * diag && fc <= 3 * diag ? aspectOf(v, fc) / (W / H) : 1; // the output's true aspect / the A ratio
    if (Math.abs(a - 1) > 0.002 && Math.abs(a - 1) <= 0.2) {
      const [cT, cR, cB, cL] = found.cut;
      const x0 = cL ? W * (1 - 1 / a) : 0;
      const x1 = cR ? W / a : W;
      const y0 = cT ? H * (1 - a) : 0;
      const y1 = cB ? H * a : H;
      const Fit = [W / (x1 - x0), 0, (-W * x0) / (x1 - x0), 0, H / (y1 - y0), (-H * y0) / (y1 - y0), 0, 0, 1];
      const Fi = inv3(Fit);
      if (Fi) {
        Hm = mul3(Hm, Fi);
        const sc = Hm[8];
        Hm = Hm.map((x) => x / sc);
      }
    }
  }

  // ---- warp the colour, and the light: each channel divided by its background (1 = paper), the thin lines deepened,
  // the tone curve
  const n = W * H;
  const { out: rgb, isSheet } = warp(img, Hm, W, H, sheet, true);
  const out = new Uint8ClampedArray(n * 4);
  const LUT = 4096;
  const tone = new Float32Array(LUT + 1);
  for (let k = 0; k <= LUT; k++) tone[k] = o.paper * (k / LUT) ** o.contrast;
  const flat = flatten(rgb, isSheet, W, H, o);
  // thin lines: the black-hat of the luminance (a small grey closing minus the image) is how much darker a pixel is
  // than its neighbourhood within lineRadius – the depth of a line the camera blurred out. Its part above lineFloor
  // (the paper's grain) is taken off again lineBoost times; walls (wider than the window) are not touched.
  let boost = null;
  if (o.lineBoost > 0) {
    const L = new Float32Array(n);
    for (let i = 0; i < n; i++) L[i] = 0.299 * flat[0][i] + 0.587 * flat[1][i] + 0.114 * flat[2][i];
    const r = Math.max(1, Math.round(o.lineRadius * long));
    let cl = runningExtreme(L, W, H, r, 'h', true);
    cl = runningExtreme(cl, W, H, r, 'v', true);
    cl = runningExtreme(cl, W, H, r, 'h', false);
    cl = runningExtreme(cl, W, H, r, 'v', false);
    boost = cl;
    for (let i = 0; i < n; i++) boost[i] = o.lineBoost * Math.max(0, cl[i] - L[i] - o.lineFloor);
  }
  for (let c = 0; c < 3; c++) {
    const v = flat[c];
    for (let i = 0; i < n; i++) {
      const t = boost ? v[i] - boost[i] : v[i];
      out[i * 4 + c] = t <= 0 ? 0 : t >= 1 ? o.paper * t : tone[Math.round(t * LUT)];
    }
  }
  for (let i = 0; i < n; i++) out[i * 4 + 3] = 255;
  return {
    img: { width: W, height: H, data: out },
    quad: [[0, 0], [W, 0], [W, H], [0, H]].map((c) => mapPoint(Hm, c).map((v) => Math.round(v * 10) / 10)),
    applied: true,
    cut: SIDES.filter((_, i) => found.cut[i]),
    aspect: shape && !found.cut.some(Boolean) ? r3(shape.aspect) : null,
  };
}
