/**
 * Planbygger: small 2D geometry helpers. Points are [x, y] arrays (plan metres or pixels).
 */

export const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
export const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
export const mul = (a, k) => [a[0] * k, a[1] * k];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
export const cross = (a, b) => a[0] * b[1] - a[1] * b[0];
export const len = (a) => Math.hypot(a[0], a[1]);
export const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
export const lerp2 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
export const unit = (a) => {
  const l = len(a);
  return l > 1e-12 ? [a[0] / l, a[1] / l] : [0, 0];
};
/** Left normal in a y-down image is (−d.y, d.x) – the same formula as the room-spec's inward normal. */
export const perp = (d) => [-d[1], d[0]];
export const round = (v, d = 3) => Math.round(v * 10 ** d) / 10 ** d;
export const roundPt = (p, d = 3) => [round(p[0], d), round(p[1], d)];

export function signedArea(poly) {
  let a = 0;
  for (let i = 0, n = poly.length; i < n; i++) a += cross(poly[i], poly[(i + 1) % n]);
  return a / 2;
}
export const area = (poly) => Math.abs(signedArea(poly));

export function centroid(poly) {
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0, n = poly.length; i < n; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % n];
    const c = cross(p, q);
    a += c;
    cx += (p[0] + q[0]) * c;
    cy += (p[1] + q[1]) * c;
  }
  if (Math.abs(a) < 1e-12) return poly[0] ? [...poly[0]] : [0, 0];
  return [cx / (3 * a), cy / (3 * a)];
}

export function pointInPolygon(p, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

/** Closest point on segment a–b to p: { t (0…1), point, d }. */
export function projectToSegment(p, a, b) {
  const d = sub(b, a);
  const l2 = dot(d, d);
  const t = l2 > 0 ? Math.max(0, Math.min(1, dot(sub(p, a), d) / l2)) : 0;
  const point = add(a, mul(d, t));
  return { t, point, d: dist(p, point) };
}

/** Intersection of the infinite lines p + s·u and q + t·v (null when parallel). */
export function lineIntersection(p, u, q, v) {
  const den = cross(u, v);
  if (Math.abs(den) < 1e-12) return null;
  const s = cross(sub(q, p), v) / den;
  return add(p, mul(u, s));
}

export function bounds(points) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p[0] < minX) minX = p[0];
    if (p[1] < minY) minY = p[1];
    if (p[0] > maxX) maxX = p[0];
    if (p[1] > maxY) maxY = p[1];
  }
  return { minX, minY, maxX, maxY };
}

/** Douglas–Peucker simplification of a closed ring. */
export function simplifyRing(ring, tol) {
  if (ring.length <= 4) return ring.slice();
  // start at the point farthest from the first one (a stable split of the ring)
  let far = 0;
  let best = -1;
  for (let i = 0; i < ring.length; i++) {
    const d = dist(ring[0], ring[i]);
    if (d > best) {
      best = d;
      far = i;
    }
  }
  const dp = (pts) => {
    if (pts.length <= 2) return pts;
    const a = pts[0];
    const b = pts[pts.length - 1];
    let idx = -1;
    let dmax = 0;
    for (let i = 1; i < pts.length - 1; i++) {
      const d = projectToSegment(pts[i], a, b).d;
      if (d > dmax) {
        dmax = d;
        idx = i;
      }
    }
    if (dmax <= tol) return [a, b];
    const left = dp(pts.slice(0, idx + 1));
    const right = dp(pts.slice(idx));
    return [...left.slice(0, -1), ...right];
  };
  const A = dp(ring.slice(0, far + 1));
  const B = dp([...ring.slice(far), ring[0]]);
  return [...A.slice(0, -1), ...B.slice(0, -1)];
}

/** Drops repeated points and points on the straight line between their neighbours (closed ring). */
export function dropCollinear(ring, tol = 1e-4) {
  let pts = ring.filter((p, i) => dist(p, ring[(i + 1) % ring.length]) > tol);
  let changed = true;
  while (changed && pts.length > 3) {
    changed = false;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[(i + pts.length - 1) % pts.length];
      const b = pts[i];
      const c = pts[(i + 1) % pts.length];
      if (projectToSegment(b, a, c).d < tol && dot(sub(b, a), sub(c, b)) > 0) {
        pts = pts.filter((_, k) => k !== i);
        changed = true;
        break;
      }
    }
  }
  return pts;
}

/**
 * The part of a polygon (any shape) inside a convex polygon – Sutherland–Hodgman clipping (a concave subject may give
 * zero-width bridges; the area is still right). Both in any orientation.
 */
export function clipPolygon(subject, convex) {
  let clip = convex;
  if (signedArea(clip) < 0) clip = [...clip].reverse();
  let out = subject;
  for (let i = 0; i < clip.length && out.length; i++) {
    const a = clip[i];
    const b = clip[(i + 1) % clip.length];
    const inside = (p) => cross(sub(b, a), sub(p, a)) >= -1e-12;
    const input = out;
    out = [];
    for (let k = 0; k < input.length; k++) {
      const p = input[k];
      const q = input[(k + 1) % input.length];
      const pin = inside(p);
      const qin = inside(q);
      if (pin) out.push(p);
      if (pin !== qin) {
        const d = sub(q, p);
        const t = cross(sub(b, a), sub(a, p)) / cross(sub(b, a), d);
        out.push(add(p, mul(d, t)));
      }
    }
  }
  return out;
}

/** Area of the part of a polygon inside a convex polygon. */
export function clipArea(subject, convex) {
  const out = clipPolygon(subject, convex);
  return out.length >= 3 ? area(out) : 0;
}

/** Slug for ids: «Stue / kjøkken» → «stue-kjøkken» (the room-spec id syntax: a–z, 0–9, æøå, _ and -). */
export function slug(s, fallback = 'rom') {
  const ACCENT = { é: 'e', è: 'e', ê: 'e', ë: 'e', á: 'a', à: 'a', â: 'a', ä: 'a', ó: 'o', ò: 'o', ô: 'o', ö: 'o', ú: 'u', ù: 'u', ü: 'u', í: 'i', ì: 'i', ï: 'i', ç: 'c', ñ: 'n' };
  const out = String(s ?? '')
    .toLowerCase()
    .normalize('NFC')
    .replace(/[éèêëáàâäóòôöúùüíìïçñ]/g, (c) => ACCENT[c])
    .replace(/[^a-z0-9æøå_]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-');
  return /^[a-z0-9]/.test(out) ? out : fallback;
}
