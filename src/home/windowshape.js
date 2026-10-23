// WINDOW SHAPES – the outline of a window that is not a rectangle (notes/vindusmodeller.md `shape`): a round window, a
// triangle or a five-sided gable window under the ridge, or any convex polygon. Pure (no three.js): layout.js gives each
// shaped window its `outline`, wallkit.js builds the window along it, rooms.js / cladding.js cut the wall and the
// cladding by it, and the validator (src/data/scripts/house.mjs) checks it.
//
// The outline is in the window's frame: x from −width/2 to width/2 (right seen from the room), y from 0 (the sill) to
// height (the highest point), counter-clockwise seen from the room. A shape with a flat bottom starts with its two
// bottom corners (left, right).

/** The shapes of `shape`. */
export const WINDOW_SHAPES = ['round', 'triangle', 'gable', 'polygon'];
/** Segments of a round window's outline. */
const SEGMENTS = 40;
/** A gable window's slopes without a roof over it and without `shoulder`. */
const GABLE_DEG = 35;

const num = (v) => typeof v === 'number' && Number.isFinite(v);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/** Twice the signed area of a polygon ([x, y] points; > 0: counter-clockwise). */
export function signedArea2(P) {
  let a = 0;
  for (let i = 0; i < P.length; i++) {
    const p = P[i], q = P[(i + 1) % P.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a;
}

/** Is the polygon convex (no turn the other way, no zero-length edge)? */
export function isConvex(P) {
  if (P.length < 3) return false;
  let sign = 0;
  for (let i = 0; i < P.length; i++) {
    const a = P[i], b = P[(i + 1) % P.length], c = P[(i + 2) % P.length];
    if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 1e-6) return false;
    const z = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if (Math.abs(z) < 1e-12) continue;
    if (sign && Math.sign(z) !== sign) return false;
    sign = Math.sign(z);
  }
  return sign !== 0;
}

/**
 * The outline of a shaped window, or null (a rectangle, or an unknown shape).
 * @param {{ shape: string, width: number, height: number, peak?: number, shoulder?: number, points?: Array }} o
 *        peak: where the top is (fraction of the width from the left seen from the room); shoulder: a gable window's
 *        vertical sides (m over the sill); points: a polygon's corners as fractions [[x, y], …] of width and height
 * @param {{ peakAt: number, slopeL: number, slopeR: number }|null} [roof]  the wall's top over the window ('gable'):
 *        where it peaks (fraction of the width) and how steeply it falls to each side (m per m)
 * @returns {Array<[number, number]>|null}
 */
export function windowOutline(o, roof = null) {
  const W = o?.width;
  const H = o?.height;
  if (!num(W) || !num(H) || W <= 0 || H <= 0 || !WINDOW_SHAPES.includes(o.shape)) return null;
  const peakX = (f) => -W / 2 + clamp(f, 0, 1) * W;
  if (o.shape === 'round') {
    const out = [];
    for (let i = 0; i < SEGMENTS; i++) {
      const a = -Math.PI / 2 + (2 * Math.PI * i) / SEGMENTS;
      out.push([(W / 2) * Math.cos(a), H / 2 + (H / 2) * Math.sin(a)]);
    }
    return out;
  }
  if (o.shape === 'triangle') {
    const px = peakX(num(o.peak) ? o.peak : 0.5);
    return dedupe([[-W / 2, 0], [W / 2, 0], [px, H]]);
  }
  if (o.shape === 'gable') {
    // the sides up to the shoulders, the slopes to the peak: parallel to the roof over it (the wall's top), else the
    // shoulders' own height, else 35°
    const p = num(o.peak) ? o.peak : roof && num(roof.peakAt) ? roof.peakAt : 0.5;
    const px = peakX(p);
    let yL;
    let yR;
    if (num(o.shoulder)) yL = yR = o.shoulder;
    else if (roof && num(roof.slopeL) && num(roof.slopeR)) {
      yL = H - roof.slopeL * (px + W / 2);
      yR = H - roof.slopeR * (W / 2 - px);
    } else {
      const k = Math.tan((GABLE_DEG * Math.PI) / 180);
      yL = H - k * (px + W / 2);
      yR = H - k * (W / 2 - px);
    }
    yL = clamp(yL, 0, H);
    yR = clamp(yR, 0, H);
    return dedupe([[-W / 2, 0], [W / 2, 0], [W / 2, yR], [px, H], [-W / 2, yL]]);
  }
  // 'polygon': corners as fractions of the window
  const pts = Array.isArray(o.points) ? o.points.filter((q) => Array.isArray(q) && num(q[0]) && num(q[1])).map(([x, y]) => [-W / 2 + x * W, y * H]) : [];
  if (pts.length < 3) return null;
  const P = signedArea2(pts) < 0 ? pts.reverse() : pts;
  // start at the bottom-left corner of a flat bottom when it has one
  let k = 0;
  for (let i = 0; i < P.length; i++) if (P[i][1] < P[k][1] - 1e-9 || (Math.abs(P[i][1] - P[k][1]) < 1e-9 && P[i][0] < P[k][0])) k = i;
  return dedupe([...P.slice(k), ...P.slice(0, k)]);
}

/** Without points that repeat the one before (a gable whose shoulder is at the sill is a triangle there). */
function dedupe(P) {
  const out = [];
  for (const p of P) {
    const q = out[out.length - 1];
    if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) > 1e-6) out.push(p);
  }
  while (out.length > 1 && Math.hypot(out[0][0] - out[out.length - 1][0], out[0][1] - out[out.length - 1][1]) < 1e-6) out.pop();
  return out;
}

/** Does the outline have a flat bottom on the sill (its first two corners at y 0)? */
export function flatBottom(P) {
  return !!P && P.length >= 3 && Math.abs(P[0][1]) < 1e-6 && Math.abs(P[1][1]) < 1e-6;
}

/**
 * A convex counter-clockwise polygon moved in by d (out with d < 0): every edge parallel at distance d, the corners
 * where the moved edges meet.
 */
export function insetPolygon(P, d) {
  const n = P.length;
  const lines = [];
  for (let i = 0; i < n; i++) {
    const a = P[i], b = P[(i + 1) % n];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const l = Math.hypot(dx, dy) || 1;
    // the inward normal of a counter-clockwise polygon is the left one
    const nx = -dy / l, ny = dx / l;
    lines.push({ p: [a[0] + nx * d, a[1] + ny * d], v: [dx / l, dy / l] });
  }
  const out = [];
  for (let i = 0; i < n; i++) {
    const A = lines[(i - 1 + n) % n], B = lines[i];
    const den = A.v[0] * B.v[1] - A.v[1] * B.v[0];
    if (Math.abs(den) < 1e-9) {
      out.push([B.p[0], B.p[1]]);
      continue;
    }
    const t = ((B.p[0] - A.p[0]) * B.v[1] - (B.p[1] - A.p[1]) * B.v[0]) / den;
    out.push([A.p[0] + A.v[0] * t, A.p[1] + A.v[1] * t]);
  }
  return out;
}

/** The y range [y0, y1] of a convex polygon on the vertical line x (null when the line misses it). */
export function spanAtX(P, x) {
  let y0 = Infinity;
  let y1 = -Infinity;
  for (let i = 0; i < P.length; i++) {
    const a = P[i], b = P[(i + 1) % P.length];
    if ((x < Math.min(a[0], b[0]) - 1e-9) || (x > Math.max(a[0], b[0]) + 1e-9)) continue;
    const ys = Math.abs(b[0] - a[0]) < 1e-9 ? [a[1], b[1]] : [a[1] + ((b[1] - a[1]) * (x - a[0])) / (b[0] - a[0])];
    for (const y of ys) {
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
    }
  }
  return y1 > y0 ? [y0, y1] : null;
}

/** The x range [x0, x1] of a convex polygon on the horizontal line y (null when the line misses it). */
export function spanAtY(P, y) {
  const s = spanAtX(P.map(([px, py]) => [py, px]), y);
  return s;
}

/** The top chain of an outline with a flat bottom, from its left corner to its right (what lies over the sill). */
export function topChain(P) {
  // counter-clockwise from the bottom left: bottom right, up the right side, over the top, down the left side
  return flatBottom(P) ? P.slice(2).reverse() : null;
}
