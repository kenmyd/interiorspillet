import * as THREE from 'three';
import schema from '../data/archetypes.json';
import * as K from './kit.js';
import { mat, kindGroup } from '../home/materials.js';
import { recolorer } from './tables.js';

/**
 * Stools and office chairs (design/furniture.md §3.4, §3.5; ARCHITECTURE §5, seating parts upholstery, legs, frame):
 *
 *   stool         «Krakk»: seat round / square / saddle in wood, upholstered, wood + cushion, cord or cane; legs
 *                 wood-splayed / wood-straight / metal-thin / hairpin (3 or 4) or a trumpet pedestal (swivel disc;
 *                 hidden `foot: 'disc'` = a flat round plate); foot ring, rungs or a front bar (on a pedestal: a ring
 *                 on spokes, or a T bar); optional low back (curved band or tube), a spindle back, or a moulded
 *                 shell back rising out of the seat in one piece (bent veneer, a moulded plastic bucket's rim).
 *                 dims.h = top of the seat; with a back dims.h = top of the back and the hidden `seatH` is the seat.
 *   office-chair  «Kontorstol»: star base with castors or glides, or a round disc; gas lift and mechanism; seat
 *                 cushion with a waterfall front; back mesh (a rounded, tapering frame) / upholstered / shell on a
 *                 recline pivot (styles task, executive = tall upholstered with a head section, lounge = an
 *                 upholstered U-shaped shell whose sides slope down into the arms); channels, headrest, lumbar pad;
 *                 arms none / fixed (L tube) / adjustable (T post) / loop (bent tube). dims = the star's footprint
 *                 and the top of the back at the given seat height; hidden `seatW` / `seatD` = the seat cushion's
 *                 size when it is not 0.8 × w / 0.78 × d (the back then is at most 0.95 × seatW wide).
 *
 * Origin: floor, centre of the footprint, the front toward +z. Params are clamped here (DesignState only cuts absurd
 * values). Fixed-colour details (castor wheels, the chrome piston) carry no part.
 */

const num = (v, fb) => (typeof v === 'number' && Number.isFinite(v) ? v : fb);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const sstep = (x) => {
  const t = clamp(x, 0, 1);
  return t * t * (3 - 2 * t);
};
const pick = (v, list, fb) => (list.includes(v) ? v : fb);
const DEG = Math.PI / 180;
const QF = { low: 0.6, medium: 1, high: 1.5 };
const seg = (spec, n, min = 4) => Math.max(min, Math.round(n * (QF[spec.quality] ?? 1)));
const _UP = new THREE.Vector3(0, 1, 0);

function def(id, { defaults, params = {}, dimsRange, build }) {
  const a = schema.archetypes[id];
  const fam = schema.families[a.family];
  const parts = a.parts || fam.parts;
  return {
    label: a.label, mount: a.mount, parts: [...parts],
    partLabels: Object.fromEntries(parts.map((p) => [p, a.partLabels?.[p] || fam.partLabels[p] || p])),
    defaults: { params: {}, ...defaults }, params, dimsRange, build,
  };
}

function add(g, geo, material, part, x = 0, y = 0, z = 0, rot) {
  const m = K.partMesh(geo, material, part, { position: [x, y, z], rotation: rot });
  g.add(m);
  return m;
}

/** A round or square stick from a (radius r0) to b (radius r1). */
function stick(g, material, part, a, b, r0, r1 = r0, { square = false, n = 10 } = {}) {
  const dir = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const len = dir.length();
  if (len < 0.003) return null;
  dir.normalize();
  const m = K.partMesh(K.taperLeg(len, r1, r0, { seg: n, square }), material, part, { position: a });
  m.quaternion.setFromUnitVectors(_UP, dir);
  g.add(m);
  return m;
}

/** Curved board in plan (an arc of radius R round (0, R), half-angle a), height bh, thickness t, bottom at y = 0. */
function arcBoard(R, a, t, bh, n, bevel = Math.min(0.004, t * 0.3)) {
  const pts = [];
  for (let k = 0; k <= n; k++) {
    const ang = -a + (2 * a * k) / n;
    pts.push([Math.sin(ang) * (R + t / 2), -Math.cos(ang) * (R + t / 2)]);
  }
  for (let k = n; k >= 0; k--) {
    const ang = -a + (2 * a * k) / n;
    pts.push([Math.sin(ang) * (R - t / 2), -Math.cos(ang) * (R - t / 2)]);
  }
  const geo = K.extrudeShape(pts.map(([x, z]) => [x, -z]), bh, { bevel, bevelSegments: 1, curveSegments: 4 });
  geo.rotateX(-Math.PI / 2);
  K.worldUV(geo, 1, { grain: 'x' });
  return geo;
}

/** A polyline [[a, b], …] resampled to n + 1 points evenly spaced by arc length: [[a, b, s], …]. */
function resample(pts, n) {
  const L = [0];
  for (let i = 1; i < pts.length; i++) L.push(L[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const total = L[L.length - 1] || 1e-9;
  const out = [];
  let i = 1;
  for (let k = 0; k <= n; k++) {
    const s = (k / n) * total;
    while (i < pts.length - 1 && L[i] < s) i++;
    const f = clamp((s - L[i - 1]) / Math.max(1e-9, L[i] - L[i - 1]), 0, 1);
    out.push([lerp(pts[i - 1][0], pts[i][0], f), lerp(pts[i - 1][1], pts[i][1], f), s]);
  }
  return out;
}

/**
 * A closed solid over a grid of surface points P[j·(nu + 1) + i] (the face whose normal runs along du × dv), the
 * other face set back by thick[k] along those normals (0 = a feathered edge), the four rims stitched. Metre UVs.
 */
function gridSolid(P, thick, nu, nv, grain = 'x') {
  const id = (i, j) => j * (nu + 1) + i;
  const N = [];
  for (let j = 0; j <= nv; j++) {
    for (let i = 0; i <= nu; i++) {
      const a = P[id(Math.max(0, i - 1), j)], b = P[id(Math.min(nu, i + 1), j)];
      const c = P[id(i, Math.max(0, j - 1))], e = P[id(i, Math.min(nv, j + 1))];
      const du = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], dv = [e[0] - c[0], e[1] - c[1], e[2] - c[2]];
      const n = [du[1] * dv[2] - du[2] * dv[1], du[2] * dv[0] - du[0] * dv[2], du[0] * dv[1] - du[1] * dv[0]];
      const l = Math.hypot(...n) || 1;
      N.push([n[0] / l, n[1] / l, n[2] / l]);
    }
  }
  const pos = [], idx = [];
  const cnt = P.length;
  for (const k of [0, 1]) {
    for (let v = 0; v < cnt; v++) {
      const p = P[v], n = N[v], o = k ? -thick[v] : 0;
      pos.push(p[0] + n[0] * o, p[1] + n[1] * o, p[2] + n[2] * o);
    }
  }
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      const a = id(i, j), b = id(i + 1, j), c = id(i, j + 1), e = id(i + 1, j + 1);
      idx.push(a, b, c, b, e, c, cnt + a, cnt + c, cnt + b, cnt + b, cnt + c, cnt + e);
    }
  }
  for (let j = 0; j < nv; j++) {
    const a = id(0, j), c = id(0, j + 1), b = id(nu, j), e = id(nu, j + 1);
    idx.push(a, c, cnt + a, c, cnt + c, cnt + a, b, cnt + b, e, e, cnt + b, cnt + e);
  }
  for (let i = 0; i < nu; i++) {
    const a = id(i, 0), b = id(i + 1, 0), c = id(i, nv), e = id(i + 1, nv);
    idx.push(a, cnt + a, b, b, cnt + a, cnt + b, c, e, cnt + c, e, cnt + e, cnt + c);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  K.worldUV(geo, 1, { grain });
  return geo;
}

/**
 * Moulded back in one piece with the seat (stool back «shell»). `plan` = points along the seat's back edge from left
 * to right ([[x, z], …], evenly spaced, already inset to the shell's inner face). Through each a profile in the plane
 * of the plan's outward normal: a run lying on the seat (its front edge feathered to nothing), a fillet of radius rf,
 * the back leaning out by `rake` up to H(u) over the seat (u = −1 … 1 along the plan). `bendTop` pushes the middle of a
 * tall back outward toward its top (a cylindrical bend); `dy(x, z)` follows a dished seat under the run.
 */
function shellBackGeo(plan, { y0, H, run, rf, rake, t, bendTop = 0, lift = 0, dy = null, nf = 4, nb = 3, featherEnds = false }) {
  const nu = plan.length - 1;
  // rows up the profile: the run's front edge, nf + 1 points round the fillet, the back in nb pieces
  const nv = nf + 1 + nb;
  const xMax = Math.max(1e-3, ...plan.map((p) => Math.abs(p[0])));
  const N = plan.map((p, i) => {
    const a = plan[Math.max(0, i - 1)], b = plan[Math.min(nu, i + 1)];
    const tx = b[0] - a[0], tz = b[1] - a[1];
    const l = Math.hypot(tx, tz) || 1;
    return [tz / l, -tx / l];
  });
  const P = new Array((nu + 1) * (nv + 1)), thick = new Array(P.length);
  for (let i = 0; i <= nu; i++) {
    const hh = Math.max(0.008, H((2 * i) / nu - 1));
    // a rim that fades out also thins out toward its ends (it would otherwise show its thickness past the seat's side)
    const endK = featherEnds ? sstep((1 - Math.abs((2 * i) / nu - 1)) / 0.2) : 1;
    const r = Math.min(rf, hh * 0.6, run * 0.6);
    const f = filletPolyline([[run, 0], [0, 0], [-Math.tan(rake) * hh, hh]], [0, r, 0], nf);
    const top = f.pop(), from = f[f.length - 1];
    for (let k = 1; k <= nb; k++) f.push([lerp(from[0], top[0], k / nb), lerp(from[1], top[1], k / nb)]);
    let acc = 0;
    const prof = f.map((p, k) => [p[0], p[1], (acc += k ? Math.hypot(p[0] - f[k - 1][0], p[1] - f[k - 1][1]) : 0)]);
    const [px, pz] = plan[i], [nx, nz] = N[i];
    for (let j = 0; j <= nv; j++) {
      const [s, yl, dist] = prof[j];
      const out = bendTop * (1 - (px / xMax) ** 2) * sstep(yl / hh) - s;
      const x = px + nx * out, z = pz + nz * out;
      const onSeat = 1 - sstep(yl / Math.max(0.01, r));
      P[j * (nu + 1) + i] = [x, y0 + yl + (lift + (dy ? dy(x, z) : 0)) * onSeat, z];
      thick[j * (nu + 1) + i] = t * sstep(dist / 0.025) * Math.max(0.15, endK);
    }
  }
  return gridSolid(P, thick, nu, nv);
}

/** Rounds the corners of a closed convex polygon [[x, z], …] (radius per corner, n arc points). */
function roundLoop(corners, radii, n = 4) {
  const m = corners.length;
  const out = [];
  for (let i = 0; i < m; i++) {
    const p = corners[i], a = corners[(i + m - 1) % m], b = corners[(i + 1) % m];
    const ua = [a[0] - p[0], a[1] - p[1]], ub = [b[0] - p[0], b[1] - p[1]];
    const la = Math.hypot(...ua), lb = Math.hypot(...ub);
    ua[0] /= la; ua[1] /= la; ub[0] /= lb; ub[1] /= lb;
    const phi = Math.acos(clamp(ua[0] * ub[0] + ua[1] * ub[1], -1, 1));
    const r = Math.min(radii[i] ?? radii, la * 0.45 * Math.tan(phi / 2), lb * 0.45 * Math.tan(phi / 2));
    const tl = r / Math.tan(phi / 2);
    const t0 = [p[0] + ua[0] * tl, p[1] + ua[1] * tl], t1 = [p[0] + ub[0] * tl, p[1] + ub[1] * tl];
    // arc centre along the bisector
    const bis = [ua[0] + ub[0], ua[1] + ub[1]];
    const bl = Math.hypot(...bis) || 1;
    const cd = r / Math.sin(phi / 2);
    const c = [p[0] + (bis[0] / bl) * cd, p[1] + (bis[1] / bl) * cd];
    let a0 = Math.atan2(t0[1] - c[1], t0[0] - c[0]), a1 = Math.atan2(t1[1] - c[1], t1[0] - c[0]);
    let da = a1 - a0;
    while (da > Math.PI) da -= 2 * Math.PI;
    while (da < -Math.PI) da += 2 * Math.PI;
    for (let k = 0; k <= n; k++) out.push([c[0] + Math.cos(a0 + (da * k) / n) * r, c[1] + Math.sin(a0 + (da * k) / n) * r]);
  }
  return out;
}

/**
 * A solid slab over a closed (convex, counter-clockwise or clockwise) outline [[x, z], …]: flat bottom at y = 0, a
 * gridded top at y = t (+ dy(x, z)), a rounded top edge of radius r. The top is gridded in `rings` rings toward the
 * centroid, so a dished seat or a saddle shows its shape. Metre UVs (box projection).
 */
function slabGeo(outline, { t, r = 0.008, nEdge = 2, rings = 4, dy = null, grain = 'x' }) {
  const n = outline.length;
  let cx = 0, cz = 0;
  for (const [x, z] of outline) {
    cx += x / n;
    cz += z / n;
  }
  // outward normals per outline point (average of the two edge normals)
  let area = 0;
  for (let i = 0; i < n; i++) {
    const [x0, z0] = outline[i], [x1, z1] = outline[(i + 1) % n];
    area += x0 * z1 - x1 * z0;
  }
  const sgn = area > 0 ? 1 : -1;
  const nrm = outline.map((p, i) => {
    const a = outline[(i + n - 1) % n], b = outline[(i + 1) % n];
    const ex = b[0] - a[0], ez = b[1] - a[1];
    const l = Math.hypot(ex, ez) || 1;
    return [(sgn * ez) / l, (-sgn * ex) / l];
  });
  const rr = Math.min(r, t * 0.45);
  const pos = [], idx = [];
  const v = (x, y, z) => (pos.push(x, y, z), pos.length / 3 - 1);
  const ring = (inset, y, scale = 1) => outline.map(([x, z], i) => v(cx + (x - nrm[i][0] * inset - cx) * scale, y, cz + (z - nrm[i][1] * inset - cz) * scale));
  const strip = (A, B) => {
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      idx.push(A[i], B[i], B[j], A[i], B[j], A[j]);
    }
  };
  // side wall (bottom → start of the round edge) → round edge → top rings → centre
  const rows = [ring(0, 0), ring(0, t - rr)];
  for (let k = 1; k <= nEdge; k++) {
    const a = (k / nEdge) * (Math.PI / 2);
    rows.push(ring(rr - rr * Math.cos(a), t - rr + rr * Math.sin(a)));
  }
  for (let k = 1; k < rings; k++) rows.push(ring(rr, t, 1 - k / rings));
  for (let k = 0; k < rows.length - 1; k++) strip(rows[k], rows[k + 1]);
  const top = v(cx, t, cz);
  const last = rows[rows.length - 1];
  for (let i = 0; i < n; i++) idx.push(last[i], top, last[(i + 1) % n]);
  // bottom cap (own vertices: a crisp bottom edge)
  const bot = ring(0, 0);
  const bc = v(cx, 0, cz);
  for (let i = 0; i < n; i++) idx.push(bot[(i + 1) % n], bc, bot[i]);
  // orientation: the strips above were written for a counter-clockwise outline seen from +y; flip for the other way
  if (sgn < 0) for (let i = 0; i < idx.length; i += 3) [idx[i + 1], idx[i + 2]] = [idx[i + 2], idx[i + 1]];
  if (dy) {
    for (let i = 0; i < pos.length; i += 3) pos[i + 1] += dy(pos[i], pos[i + 2]) * (pos[i + 1] / t);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  K.worldUV(geo, 1, { grain });
  return geo;
}

/** Planar [z, y] polyline with circular fillets of the given radii at its inner points (seating.js filletPolyline). */
function filletPolyline(src, radii, n = 8) {
  const len = (p, q) => Math.hypot(q[0] - p[0], q[1] - p[1]) || 1e-9;
  const m = src.length;
  const dir = (i) => [(src[i + 1][0] - src[i][0]) / len(src[i], src[i + 1]), (src[i + 1][1] - src[i][1]) / len(src[i], src[i + 1])];
  const phi = src.map((p, i) => {
    if (i === 0 || i === m - 1 || !(radii[i] > 0)) return 0;
    const u = dir(i - 1), v = dir(i);
    return Math.acos(clamp(u[0] * v[0] + u[1] * v[1], -1, 1));
  });
  const tl = phi.map((f, i) => (f > 1e-4 ? radii[i] * Math.tan(f / 2) : 0));
  for (let i = 0; i < m - 1; i++) {
    const L = len(src[i], src[i + 1]), s = tl[i] + tl[i + 1];
    if (s > L * 0.98) {
      tl[i] *= (L * 0.98) / s;
      tl[i + 1] *= (L * 0.98) / s;
    }
  }
  const pts = [src[0]];
  for (let i = 1; i < m - 1; i++) {
    if (!(tl[i] > 1e-5)) {
      pts.push(src[i]);
      continue;
    }
    const u = dir(i - 1), v = dir(i), p = src[i];
    const r = tl[i] / Math.tan(phi[i] / 2);
    const s = u[0] * v[1] - u[1] * v[0] > 0 ? 1 : -1;
    const T1 = [p[0] - u[0] * tl[i], p[1] - u[1] * tl[i]];
    const C = [T1[0] - s * u[1] * r, T1[1] + s * u[0] * r];
    const a0 = Math.atan2(T1[1] - C[1], T1[0] - C[0]);
    for (let k = 0; k <= n; k++) {
      const a = a0 + (s * phi[i] * k) / n;
      pts.push([C[0] + r * Math.cos(a), C[1] + r * Math.sin(a)]);
    }
  }
  pts.push(src[m - 1]);
  return pts;
}

/** Bent tube through 3D points with filleted corners (all points in one vertical plane x = const or z = const). */
function bentTube(points, r, radius, { radial = 8, n = 6 } = {}) {
  // the plane: points share x (a side frame) or z (a front/back frame)
  const sameX = points.every((p) => Math.abs(p[0] - points[0][0]) < 1e-6);
  const flat = points.map((p) => (sameX ? [p[2], p[1]] : [p[0], p[1]]));
  const f = filletPolyline(flat, points.map((_, i) => (i === 0 || i === points.length - 1 ? 0 : radius)), n);
  const pts3 = f.map(([a, y]) => (sameX ? [points[0][0], y, a] : [a, y, points[0][2]]));
  return K.tube(pts3, r, { curve: 'line', radial });
}

/** Hairpin leg (FURN §2.3) standing at (x, z), its plane along (dx, dz), the top at yTop. */
function hairpin(g, material, part, x, z, dx, dz, yTop, q = 1) {
  const s = 0.035;
  const prof = [[-s, yTop], [-0.012, 0.05], [-0.005, 0.012], [0, 0.006], [0.005, 0.012], [0.012, 0.05], [s, yTop]];
  const pts = prof.map(([a, y]) => [x + dx * a, y, z + dz * a]);
  // the straight runs need few segments; the bend at the foot gets most of them (catmull spacing follows the points)
  g.add(K.partMesh(K.tube(pts, 0.0045, { curve: 'catmull', radial: 6, seg: Math.max(14, Math.round(24 * q)) }), material, part));
  add(g, K.box(0.07, 0.006, 0.07), material, part, x, yTop - 0.003, z, [0, Math.atan2(dx, dz), 0]);
}

/** Trumpet pedestal (FURN §2.3): a flared foot of radius R, column up to colTop. */
function trumpet(g, material, R, colTop, q) {
  const n = Math.max(16, Math.round(32 * q));
  g.add(K.partMesh(K.lathe([[0.001, 0], [R, 0], [R, 0.005], [0.96 * R, 0.012], [0.5 * R, 0.03], [0.06, 0.06], [0.035, 0.1], [0.03, 0.14], [0.001, 0.14]], { seg: n }), material, 'legs'));
  if (colTop > 0.15) g.add(K.partMesh(K.cylinder(0.025, 0.025, colTop - 0.13, { seg: Math.max(10, Math.round(16 * q)) }), material, 'legs', { position: [0, 0.13, 0] }));
}

/** Flat pedestal foot (IKEA JANINGE): a 1 cm plate of radius R with a rounded rim, a straight column up to colTop. */
function discFoot(g, material, R, colTop, q) {
  const n = Math.max(16, Math.round(40 * q));
  g.add(K.partMesh(K.lathe([[0.001, 0], [R - 0.004, 0], [R, 0.004], [R - 0.001, 0.008], [R - 0.006, 0.011], [0.05, 0.013], [0.034, 0.024], [0.001, 0.024]], { seg: n }), material, 'legs'));
  if (colTop > 0.04) g.add(K.partMesh(K.cylinder(0.025, 0.025, colTop - 0.02, { seg: Math.max(10, Math.round(16 * q)) }), material, 'legs', { position: [0, 0.02, 0] }));
}

// ---------------------------------------------------------------------------------------------------------------
// Stool

const SEAT_SHAPES = ['round', 'square', 'saddle'];
const STOOL_SEATS = ['wood', 'upholstered', 'cushion', 'cord', 'cane'];
const STOOL_LEGS = ['wood-splayed', 'wood-straight', 'metal-thin', 'hairpin', 'pedestal'];
const FOOTRESTS = ['none', 'ring', 'rungs', 'bar'];
const STOOL_BACKS = ['none', 'low', 'spindles', 'shell'];

/** Round wooden seat: a disc with a chamfered underside and an eased top edge (crisp corners via twin points). */
function discSeat(r, t, n) {
  const b = Math.min(0.012, t * 0.4), e = Math.min(0.005, t * 0.2), k = 2e-4;
  return K.lathe([[0.001, 0], [r - b, 0], [r - b + k, k], [r, b * 0.8], [r, b * 0.8 + k], [r, t - e], [r - e, t], [r - e - k, t], [0.001, t]], { seg: n });
}

/** Round upholstered pad (bottom at 0, crown at t). */
function roundPad(r, t, n) {
  return K.lathe([[0.001, 0], [r - 0.012, 0], [r - 0.002, t * 0.18], [r, t * 0.5], [r - 0.004, t * 0.82], [r - 0.022, t * 0.97], [r * 0.6, t], [0.001, t + 0.003]], { seg: n });
}

function buildStool(spec) {
  const { w, d, h } = spec.dims;
  const P = spec.params;
  const C = spec.colors || {}, M = spec.materials || {};
  const q = QF[spec.quality] ?? 1;
  const g = new THREE.Group();
  const shape = pick(P.seatShape, SEAT_SHAPES, 'round');
  const seat = pick(P.seat, STOOL_SEATS, 'wood');
  const legStyle = pick(P.legStyle, STOOL_LEGS, 'wood-splayed');
  const nLegs = clamp(Math.round(num(P.legs, 4)), 3, 4);
  const footrest = pick(P.footrest, FOOTRESTS, 'ring');
  const back = pick(P.back, STOOL_BACKS, 'none');
  // materials: seat (upholstery), legs, frame (rungs, ring, back); a soft seat on a wooden kind gets a woven cover
  const upKind = M.upholstery || 'oak';
  const legKind = M.legs || 'oak';
  const frameKind = M.frame || legKind;
  const woodish = (k) => kindGroup(k) === 'wood';
  const seatMat = mat(upKind, C.upholstery, woodish(upKind) ? { grain: 'x' } : undefined);
  const padKind = kindGroup(upKind) === 'fabric' ? upKind : 'woven';
  const padMat = mat(padKind, C.upholstery);
  const boardKind = woodish(frameKind) ? frameKind : woodish(legKind) ? legKind : 'oak';
  const boardMat = mat(boardKind, woodish(frameKind) ? C.frame || C.legs : woodish(legKind) ? C.legs : undefined, { grain: 'x' });
  const legsMat = mat(legKind, C.legs, woodish(legKind) ? { grain: 'y' } : undefined);
  const frameMat = mat(frameKind, C.frame || C.legs, woodish(frameKind) ? { grain: 'y' } : undefined);
  const n = seg(spec, 12, 6);
  // heights: without a back h is the seat top; with one h is the back top and seatH the seat
  // (a low back may rise only a few cm over the seat: IKEA JANINGE 76 / 84 cm)
  const hasBack = back !== 'none' && h >= 0.45;
  const seatTop = hasBack ? clamp(num(P.seatH, Math.min(0.66, h - 0.2)), 0.3, h - 0.06) : h;
  const soft = seat === 'upholstered';
  const seatT = clamp(num(P.seatT, soft ? 0.07 : seat === 'cushion' ? 0.065 : 0.03), 0.015, 0.12);
  const seatBot = seatTop - seatT;
  // a moulded shell back rises out of the seat's back edge and leans out: the seat moves forward (sz0) and gets
  // shorter (sd) so the back's top stays inside dims.d. A short rim (< 12 cm, a plastic bucket) flares out more and
  // wraps round the back corners, a tall back is a panel bent like a cylinder toward its top.
  const shellBack = hasBack && back === 'shell';
  const shellH = h - seatTop, shortRim = shellH < 0.12;
  const shellRake = (shortRim ? 25 : 9) * DEG;
  const shellBend = shellBack && !shortRim && shape !== 'round' ? 0.025 : 0;
  const off = shellBack ? Math.min(0.25 * d, Math.tan(shellRake) * shellH + shellBend + 0.003) : 0;
  const sd = d - off, sz0 = off / 2;
  // seat footprint: round = min(w, d); square / saddle = w × d
  const R = Math.min(w, sd) / 2;
  const hw = shape === 'round' ? R : w / 2, hd = shape === 'round' ? R : sd / 2;
  // saddle: a rounded trapezoid (front 0.75 w), dished across with a raised pommel at the front (seat coordinates)
  const dish = (x, z) => {
    const fz = clamp((z + sd / 2) / sd, 0, 1);
    const half = lerp(w / 2, 0.375 * w, fz);
    const across = 1 - clamp(x / half, -1, 1) ** 2;
    return -0.012 * across * (1 - fz * 0.6) + 0.012 * Math.exp(-((x / 0.05) ** 2)) * sstep((fz - 0.55) / 0.45);
  };
  // ---- seat
  if (shape === 'round') {
    const ns = Math.max(16, Math.round((shellBack ? 32 : 40) * q)); // (a shell back's own triangles come out of the seat's)
    if (seat === 'wood') add(g, discSeat(R, seatT, ns), seatMat, 'upholstery', 0, seatBot, sz0);
    else if (soft || seat === 'cushion') {
      const bt = soft ? 0.018 : 0.025;
      add(g, discSeat(R - (soft ? 0.008 : 0), bt, ns), boardMat, 'frame', 0, seatBot, sz0);
      add(g, roundPad(soft ? R : R - 0.02, seatT - bt, ns), padMat, 'upholstery', 0, seatBot + bt, sz0);
    } else {
      // cord / cane: a ring frame with the woven disc inside
      const ft = 0.014;
      add(g, K.torus(R - ft, ft, { radial: 6, tubular: ns }), frameMat, 'frame', 0, seatTop - ft, sz0, [Math.PI / 2, 0, 0]);
      const woven = seat === 'cane' ? mat('rattan', C.upholstery || '#c7a777', { open: true }) : seatMat;
      add(g, K.cylinder(R - ft, R - ft, 0.01, { seg: ns }), woven, 'upholstery', 0, seatTop - ft - 0.005, sz0);
    }
  } else if (shape === 'square') {
    if (seat === 'wood') add(g, K.roundedBox(w, seatT, sd, 0.006, 2, { grain: 'x' }), seatMat, 'upholstery', 0, seatBot + seatT / 2, sz0);
    else if (soft || seat === 'cushion') {
      const bt = soft ? 0.018 : 0.025;
      add(g, K.roundedBox(w - (soft ? 0.01 : 0), bt, sd - (soft ? 0.01 : 0), 0.004, 1, { grain: 'x' }), boardMat, 'frame', 0, seatBot + bt / 2, sz0);
      const pw = soft ? w : w - 0.03, pd = soft ? sd : sd - 0.03;
      add(g, K.cushion(pw, seatT - bt, pd, { axis: 'y', puff: 0.14, round: 0.8, sides: 0.12, bottom: 0.1, seg: 10 }), padMat, 'upholstery', 0, seatBot + bt + (seatT - bt) / 2, sz0);
    } else {
      const ft = 0.028;
      for (const sz of [-1, 1]) add(g, K.roundedBox(w, ft, ft, 0.005, 1, { grain: 'x' }), frameMat, 'frame', 0, seatTop - ft / 2, sz0 + sz * (sd / 2 - ft / 2));
      for (const sx of [-1, 1]) add(g, K.roundedBox(ft, ft, sd - 2 * ft, 0.005, 1, { grain: 'z' }), frameMat, 'frame', sx * (w / 2 - ft / 2), seatTop - ft / 2, sz0);
      const woven = seat === 'cane' ? mat('rattan', C.upholstery || '#c7a777', { open: true }) : seatMat;
      add(g, K.box(w - 2 * ft + 0.006, 0.012, sd - 2 * ft + 0.006), woven, 'upholstery', 0, seatTop - 0.014, sz0);
    }
  } else {
    const outline = roundLoop([[-w / 2, -sd / 2], [w / 2, -sd / 2], [0.375 * w, sd / 2], [-0.375 * w, sd / 2]], [0.06, 0.06, 0.05, 0.05], seg(spec, 4, 2));
    const pad = soft || seat === 'cushion';
    const t = pad ? Math.min(0.03, seatT) : seatT;
    add(g, slabGeo(outline, { t, r: 0.008, dy: dish, rings: seg(spec, 5, 3) }), pad ? boardMat : seat === 'wood' ? seatMat : frameMat, pad ? 'frame' : 'upholstery', 0, seatBot, sz0);
    if (pad) {
      const inner = outline.map(([x, z]) => [x * 0.92, z * 0.9]);
      add(g, slabGeo(inner, { t: seatT - t, r: Math.min(0.02, (seatT - t) * 0.45), nEdge: 3, dy: dish, rings: seg(spec, 4, 3) }), padMat, 'upholstery', 0, seatBot + t, sz0);
    } else if (seat === 'cord' || seat === 'cane') {
      const woven = seat === 'cane' ? mat('rattan', C.upholstery || '#c7a777', { open: true }) : seatMat;
      const inner = outline.map(([x, z]) => [x * 0.84, z * 0.82]);
      add(g, slabGeo(inner, { t: 0.004, r: 0.001, nEdge: 1, dy: dish, rings: 3 }), woven, 'upholstery', 0, seatTop - 0.003, sz0);
    }
  }
  // ---- moulded shell back (in the seat's material; a woven seat gets a wooden shell)
  if (shellBack) {
    const t = clamp(seatT, 0.012, 0.03);
    const nu = seg(spec, shortRim ? 16 : 14, shortRim ? 10 : 8);
    const wrap = shortRim ? 0.3 * sd : 0;
    // the run lies on the seat inside the plan; round a corner by more than the run so its inner edge cannot fold
    const run = shortRim ? 0.04 : Math.min(0.05, 0.2 * sd);
    let plan;
    if (shape === 'round') {
      // an arc of the seat's rim
      const a = (shortRim ? 80 : 55) * DEG;
      plan = [];
      for (let k = 0; k <= nu; k++) {
        const th = -a + (2 * a * k) / nu;
        plan.push([Math.sin(th) * (R - t), sz0 - Math.cos(th) * (R - t)]);
      }
    } else {
      // along the back edge (a tall back ends at the back corners, a rim wraps round them a little way forward)
      const zr = sz0 - sd / 2 + t;
      const hwAt = (z) => (shape === 'saddle' ? lerp(w / 2, 0.375 * w, clamp((z - (sz0 - sd / 2)) / sd, 0, 1)) : w / 2) - t;
      const rc = Math.max(shape === 'saddle' ? 0.06 - t * 0.5 : 0.012, run + 0.012);
      const src = shortRim
        ? [[-hwAt(zr + wrap), zr + wrap], [-(w / 2 - t), zr], [w / 2 - t, zr], [hwAt(zr + wrap), zr + wrap]]
        : [[-(w / 2 - (shape === 'saddle' ? 0.035 : 0.004)), zr], [w / 2 - (shape === 'saddle' ? 0.035 : 0.004), zr]];
      plan = resample(shortRim ? filletPolyline(src, [0, rc, rc, 0], seg(spec, 10, 5)) : src, nu).map(([x, z]) => [x, z]);
    }
    // height along the plan: a rim fades out toward its ends, a tall back has rounded top corners
    const halfLen = shape === 'round' ? (R - t) * (shortRim ? 80 : 55) * DEG : Math.abs(plan[0][0]);
    const rcTop = Math.min(0.05, shellH * 0.35);
    const H = (u) => {
      if (shortRim) return shellH * (1 - Math.abs(u) ** 1.8);
      const e = (1 - Math.abs(u)) * halfLen;
      return shellH - (e < rcTop ? rcTop - Math.sqrt(Math.max(0, rcTop * rcTop - (rcTop - e) ** 2)) : 0);
    };
    const shellMat = seat === 'wood' ? seatMat : soft || seat === 'cushion' ? padMat : boardMat;
    add(g, shellBackGeo(plan, {
      y0: seatTop, H, run, rf: 0.04, rake: shellRake, t, bendTop: shellBend,
      lift: soft || seat === 'cushion' ? -0.012 : 0.0015, dy: shape === 'saddle' ? (x, z) => dish(x, z - sz0) : null, nf: seg(spec, 4, 3), nb: seg(spec, 3, 2),
      featherEnds: shortRim,
    }),shellMat, seat === 'cord' || seat === 'cane' ? 'frame' : 'upholstery');
  }
  // ---- legs (anchor under the seat → foot on the floor)
  const topY = seatBot + 0.004;
  const legs = [];
  if (legStyle === 'pedestal') {
    const Rp = clamp(Math.min(w, d) * 0.5, 0.18, 0.24);
    if (P.foot === 'disc') discFoot(g, legsMat, Rp, seatBot - 0.06, q);
    else trumpet(g, legsMat, Rp, seatBot - 0.06, q);
    // sleeve round the column top, and the seat mount (a swivel disc when it turns)
    if (seatBot - 0.16 > 0.15) add(g, K.cylinder(0.032, 0.032, 0.1, { seg: n }), legsMat, 'legs', 0, seatBot - 0.16, 0);
    add(g, K.cylinder(P.swivel === true ? 0.09 : 0.07, P.swivel === true ? 0.09 : 0.07, 0.012, { seg: Math.max(16, n * 2) }), legsMat, 'legs', 0, seatBot - 0.012, 0);
    if (seatBot - 0.072 > 0.14) add(g, K.cylinder(0.025, 0.025, 0.06, { seg: n }), legsMat, 'legs', 0, seatBot - 0.072, 0);
  } else {
    // anchors: on 0.62 r (round, saddle centre-ish) or the inset corners (square, saddle)
    const metal = legStyle === 'metal-thin' || legStyle === 'hairpin';
    const rTop = clamp(num(P.legD, metal ? 0.018 : 0.036) / 2, 0.005, 0.03);
    const rBot = legStyle === 'wood-splayed' ? rTop * 0.72 : legStyle === 'wood-straight' ? rTop * 0.85 : rTop * 0.9;
    const splay = (legStyle === 'wood-splayed' ? 9 : legStyle === 'metal-thin' ? 5 : 0) * DEG;
    const dirs = [];
    if (shape === 'round') {
      const angs = nLegs === 3 ? [180, 60, -60] : [45, 135, 225, 315];
      for (const a of angs) dirs.push([Math.sin(a * DEG) * 0.62 * R, Math.cos(a * DEG) * 0.62 * R]);
    } else {
      const ins = 0.03 + rTop;
      const ax = hw - ins, azB = hd - ins, azF = shape === 'saddle' ? hd - ins - 0.02 : hd - ins;
      const axF = shape === 'saddle' ? Math.min(ax, 0.375 * w - ins) : ax;
      if (nLegs === 3) dirs.push([0, -azB], [axF, azF], [-axF, azF]);
      else dirs.push([-ax, -azB], [ax, -azB], [axF, azF], [-axF, azF]);
    }
    const H = topY;
    for (const [ax, azS] of dirs) {
      // dirs are in seat coordinates (the seat sits sz0 forward of the footprint's centre under a shell back)
      const az = azS + sz0;
      const l = Math.hypot(ax, azS) || 1;
      const ux = ax / l, uz = azS / l;
      let fx = ax + ux * Math.tan(splay) * H, fz = az + uz * Math.tan(splay) * H;
      // keep the feet inside the footprint
      const kx = Math.abs(fx) > w / 2 - rBot ? (w / 2 - rBot - Math.abs(ax)) / Math.max(1e-6, Math.abs(fx - ax)) : 1;
      const kz = Math.abs(fz) > d / 2 - rBot ? (d / 2 - rBot - Math.abs(az)) / Math.max(1e-6, Math.abs(fz - az)) : 1;
      const k = clamp(Math.min(kx, kz), 0, 1);
      fx = ax + (fx - ax) * k;
      fz = az + (fz - az) * k;
      legs.push({ top: [ax, topY, az], foot: [fx, 0, fz], ux, uz, r: rTop });
    }
    for (const L of legs) {
      if (legStyle === 'hairpin') hairpin(g, legsMat, 'legs', L.top[0], L.top[2], L.ux, L.uz, topY, q);
      else stick(g, legsMat, 'legs', L.foot, L.top, rBot, rTop, { n: legStyle === 'wood-straight' && P.square === true ? 4 : n, square: legStyle === 'wood-straight' && P.square === true });
    }
  }
  // ---- footrest (part frame)
  const fH = clamp(num(P.footrestH, 0.25), 0.12, Math.max(0.12, Math.min(0.5, seatBot - 0.12)));
  const at = (L, y) => [lerp(L.foot[0], L.top[0], y / L.top[1]), y, lerp(L.foot[2], L.top[2], y / L.top[1])];
  if (footrest !== 'none' && seatBot > 0.3) {
    if (legStyle === 'pedestal' && footrest === 'bar') {
      // a T bar in front of the column on a short arm (IKEA JANINGE)
      const zb = clamp(0.33 * Math.min(w, d), 0.09, 0.15), bw = clamp(0.7 * w, 0.2, 0.34);
      add(g, K.roundedBox(bw, 0.012, 0.026, 0.004, 1), frameMat, 'frame', 0, fH, zb);
      add(g, K.roundedBox(0.03, 0.02, zb - 0.02, 0.005, 1), frameMat, 'frame', 0, fH - 0.002, (zb + 0.02) / 2);
      add(g, K.cylinder(0.034, 0.034, 0.05, { seg: n }), frameMat, 'frame', 0, fH - 0.03, 0);
    } else if (legStyle === 'pedestal') {
      // a foot ring on three spokes from the column
      const Rr = clamp(0.95 * clamp(Math.min(w, d) * 0.5, 0.18, 0.24), 0.15, 0.21);
      add(g, K.torus(Rr, 0.008, { radial: 6, tubular: Math.max(24, Math.round(40 * q)) }), frameMat, 'frame', 0, fH, 0, [Math.PI / 2, 0, 0]);
      for (let k = 0; k < 3; k++) {
        const a = (k / 3) * Math.PI * 2 + Math.PI / 2;
        stick(g, frameMat, 'frame', [Math.cos(a) * 0.024, fH, Math.sin(a) * 0.024], [Math.cos(a) * Rr, fH, Math.sin(a) * Rr], 0.006, 0.006, { n: 6 });
      }
    } else if (footrest === 'ring') {
      // a closed loop just outside the legs: a circle under a round seat, a rounded polygon under corner legs
      const rr = metalKind(frameKind) ? 0.007 : 0.009;
      const pts = legs.map((L) => at(L, fH));
      const legR = (y, L) => lerp(L.r * (legStyle === 'wood-splayed' ? 0.72 : 0.9), L.r, y / L.top[1]);
      const nl = Math.max(24, Math.round(40 * q));
      let loop;
      if (shape === 'round') {
        const rad = pts.reduce((s, p) => s + Math.hypot(p[0], p[2] - sz0), 0) / pts.length + legR(fH, legs[0]) + rr * 0.5;
        loop = [];
        for (let k = 0; k < nl; k++) loop.push([Math.cos((k / nl) * Math.PI * 2) * rad, fH, sz0 + Math.sin((k / nl) * Math.PI * 2) * rad]);
      } else {
        const out = pts.map((p, i) => {
          const l = Math.hypot(p[0], p[2] - sz0) || 1;
          const o = legR(fH, legs[i]) + rr * 0.5;
          return [p[0] + (p[0] / l) * o, p[2] + ((p[2] - sz0) / l) * o];
        });
        loop = roundLoop(out, out.map(() => 0.035), Math.max(3, Math.round(5 * q))).map(([x, z]) => [x, fH, z]);
      }
      g.add(K.partMesh(K.tube(loop, rr, { closed: true, curve: shape === 'round' ? 'catmull' : 'line', radial: 6, seg: shape === 'round' ? nl : undefined }), frameMat, 'frame'));
    } else if (footrest === 'rungs') {
      // Windsor H: neighbouring legs joined, alternating heights
      for (let i = 0; i < legs.length; i++) {
        const A = legs[i], B = legs[(i + 1) % legs.length];
        const y = fH + (i % 2 ? 0.04 : 0);
        stick(g, frameMat, 'frame', at(A, y), at(B, y), 0.008, 0.008, { n: 8 });
      }
    } else {
      // bar: one strong rung between the front legs, thin side rungs a little higher
      const front = legs.filter((L) => L.top[2] > 0);
      if (front.length === 2) stick(g, frameMat, 'frame', at(front[0], fH), at(front[1], fH), 0.012, 0.012, { n: 10 });
      const back = legs.filter((L) => L.top[2] <= 0);
      for (const F of front) {
        const B = back.reduce((best, L) => (!best || Math.abs(L.top[0] - F.top[0]) < Math.abs(best.top[0] - F.top[0]) ? L : best), null);
        if (B) stick(g, frameMat, 'frame', at(F, fH + 0.05), at(B, fH + 0.05), 0.008, 0.008, { n: 8 });
      }
    }
  }
  // ---- back (part frame)
  if (hasBack && !shellBack) {
    const bandH = back === 'low' ? 0.07 : 0.045;
    const zSeatB = -hd + 0.03;
    const rake = Math.min(8 * DEG, Math.atan(Math.max(0, zSeatB + d / 2 - 0.03) / Math.max(0.05, h - seatTop)));
    const yTop = h - bandH;
    const zAt = (y) => zSeatB - Math.tan(rake) * (y - seatTop);
    const px = Math.min(hw * 0.62, 0.14);
    const wood = woodish(frameKind);
    const R0 = Math.max(0.22, hw * 1.3);
    const a = Math.asin(Math.min(0.95, (px + 0.04) / R0));
    for (const sx of [-1, 1]) stick(g, frameMat, 'frame', [sx * px, seatTop - 0.01, zAt(seatTop)], [sx * px, h - 0.01, zAt(h)], wood ? 0.012 : 0.008, wood ? 0.011 : 0.008, { n: 8 });
    if (back === 'low' && !wood) {
      // a bent tube from post to post round the back
      const pts = [];
      for (let k = 0; k <= 12; k++) {
        const ang = -a + (2 * a * k) / 12;
        pts.push([Math.sin(ang) * R0, h - 0.035, zAt(h) + R0 - Math.cos(ang) * R0 - 0.005]);
      }
      g.add(K.partMesh(K.tube(pts, 0.012, { radial: 8 }), frameMat, 'frame'));
    } else {
      add(g, arcBoard(R0, a, 0.018, bandH, 10), frameMat, 'frame', 0, yTop, zAt(yTop + bandH / 2) + R0 - 0.012);
    }
    if (back === 'spindles') {
      for (let k = 1; k <= 5; k++) {
        const x = -px + (k * 2 * px) / 6;
        stick(g, frameMat, 'frame', [x, seatTop - 0.005, zAt(seatTop) + 0.004], [x, yTop + 0.005, zAt(yTop) + 0.002], 0.007, 0.006, { n: 8 });
      }
    }
  }
  const kinds = { upholstery: seat === 'upholstered' || seat === 'cushion' ? padKind : upKind, legs: legKind, frame: frameKind };
  const rc = recolorer(g, (part, kind) => !!kind && kindGroup(kind) !== kindGroup(kinds[part]));
  g.name = 'stool';
  return K.finishModel(g, { seatY: seatTop, recolor: rc });
}

const metalKind = (k) => kindGroup(k) === 'metal';

// ---------------------------------------------------------------------------------------------------------------
// Office chair

const OC_STYLES = ['task', 'executive', 'lounge'];
const OC_BACKS = ['mesh', 'upholstered', 'shell'];
const OC_ARMS = ['none', 'fixed', 'adjustable', 'loop'];
const OC_BASES = ['castors', 'glides', 'disc'];

/** Star base (seating.js starBase): extruded arms from a hub, at y0 (raised over castors). Returns the tip radius. */
function starArmsBase(g, material, { r, y0, arms, q }) {
  const seg2 = Math.max(10, Math.round(20 * q));
  const hubR = 0.042, hubH = 0.055;
  g.add(K.partMesh(K.cylinder(hubR * 0.85, hubR, hubH, { seg: seg2 }), material, 'legs', { position: [0, y0, 0] }));
  const len = Math.max(0.1, r - 0.012);
  const shape = [[0, 0.012], [len - 0.012, 0.008], [len, 0.012], [len, 0.026], [len - 0.03, 0.03], [0, Math.max(0.035, hubH * 0.8)]];
  const geo = K.extrudeShape(shape, 0.04, { bevel: 0.005, center: true, curveSegments: 4 });
  const a0 = Math.PI / 2;
  const tips = [];
  for (let i = 0; i < arms; i++) {
    const a = a0 + (i / arms) * Math.PI * 2;
    g.add(K.partMesh(i ? geo.clone() : geo, material, 'legs', { position: [0, y0, 0], rotation: [0, -a, 0] }));
    tips.push([Math.cos(a) * (len - 0.02), Math.sin(a) * (len - 0.02), a]);
  }
  return { tips, hubTop: y0 + hubH };
}

/** Twin-wheel castor (FURN §2.3) under a star tip at (x, z), its axle along the tangent of angle a. */
function castor(g, x, z, a, yTip, n) {
  const dark = mat('plastic', '#1b1b1b');
  const grp = new THREE.Group();
  grp.position.set(x, 0, z);
  grp.rotation.y = -a;
  g.add(grp);
  // stem from the arm underside down into the hood
  const stemH = Math.max(0.01, yTip - 0.05);
  grp.add(K.partMesh(K.cylinder(0.006, 0.006, stemH, { seg: 6 }), mat('chrome', '#c9cbcc'), null, { position: [0, 0.05, 0] }));
  const hood = K.cylinder(0.03, 0.03, 0.024, { seg: Math.max(6, Math.round(n * 0.6)), thetaStart: Math.PI / 2, thetaLength: Math.PI, center: true });
  hood.rotateX(Math.PI / 2);
  grp.add(K.partMesh(hood, dark, null, { position: [0, 0.025, 0] }));
  for (const s of [-1, 1]) {
    const wheel = K.cylinder(0.025, 0.025, 0.011, { seg: n, center: true });
    wheel.rotateX(Math.PI / 2);
    grp.add(K.partMesh(wheel, dark, null, { position: [0, 0.025, s * 0.018] }));
  }
}

/** A box (w × h × t) bent forward toward its sides: z += bend · (2x / w)². Origin at its centre. */
function bentPanel(w, h, t, bend, nx = 10) {
  const geo = new THREE.BoxGeometry(w, h, t, nx, 1, 1);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) pos.setZ(i, pos.getZ(i) + bend * ((2 * pos.getX(i)) / w) ** 2);
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  K.worldUV(geo, 1, { grain: 'x' });
  return geo;
}

/** K.cushion bent like bentPanel (axis z), its seat-like front optionally rolled down (waterfall, axis y). */
function bentCushion(w, h, t, bend, o = {}) {
  const geo = K.cushion(w, h, t, { axis: 'z', puff: 0.12, round: 0.7, sides: 0.1, bottom: 0.4, seg: 12, ...o });
  if (bend) {
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) pos.setZ(i, pos.getZ(i) + bend * ((2 * pos.getX(i)) / w) ** 2);
    pos.needsUpdate = true;
    K.smoothNormals(geo);
  }
  return geo;
}

function buildOfficeChair(spec) {
  const { w, d, h } = spec.dims;
  const P = spec.params;
  const C = spec.colors || {}, M = spec.materials || {};
  const q = QF[spec.quality] ?? 1;
  const g = new THREE.Group();
  const style = pick(P.style, OC_STYLES, 'task');
  const back = style === 'executive' ? 'upholstered' : pick(P.back, OC_BACKS, 'mesh');
  const arms = pick(P.arms, OC_ARMS, 'adjustable');
  const base = pick(P.base, OC_BASES, 'castors');
  const starN = clamp(Math.round(num(P.starArms, 5)), 4, 5);
  const seatH = clamp(num(P.seatH, 0.47), 0.4, Math.min(0.6, h - 0.25));
  const recline = clamp(num(P.recline, 0), 0, 20) * DEG;
  const channels = P.channels === true;
  const upKind = M.upholstery || 'woven';
  const frameKind = M.frame || 'plastic';
  const legKind = M.legs || 'black-metal';
  const up = mat(upKind, C.upholstery);
  const frame = mat(frameKind, C.frame, kindGroup(frameKind) === 'wood' ? { grain: 'y' } : undefined);
  const legs = mat(legKind, C.legs, kindGroup(legKind) === 'wood' ? { grain: 'y' } : undefined);
  const n = seg(spec, 12, 6);
  const seatT = style === 'task' ? 0.075 : 0.1;
  const yM = Math.max(0.2, seatH - seatT - 0.065); // mechanism bottom
  // ---- base
  let hubTop;
  if (base === 'disc') {
    const rd = clamp(Math.min(w, d) / 2 - 0.02, 0.2, 0.3);
    g.add(K.partMesh(K.lathe([[0.001, 0], [rd - 0.006, 0], [rd, 0.004], [rd - 0.003, 0.012], [rd * 0.9, 0.016], [0.08, 0.022], [0.05, 0.04], [0.001, 0.04]], { seg: Math.max(20, Math.round(40 * q)) }), legs, 'legs'));
    hubTop = 0.04;
  } else {
    const L = clamp(Math.min(w, d) / 2 - 0.03, 0.24, 0.36);
    const y0 = base === 'castors' ? 0.06 : 0.012;
    const star = starArmsBase(g, legs, { r: L, y0, arms: starN, q });
    hubTop = star.hubTop;
    for (const [x, z, a] of star.tips) {
      if (base === 'castors') castor(g, x, z, a, y0 + 0.009, Math.max(8, Math.round(14 * q)));
      else g.add(K.partMesh(K.cylinder(0.018, 0.02, 0.012, { seg: 10 }), mat('plastic', '#1a1a1a'), null, { position: [x, 0, z] }));
    }
  }
  // ---- gas lift: outer tube (legs) and the chrome piston up to the mechanism
  const outerTop = Math.min(hubTop + 0.2, yM - 0.05);
  if (outerTop > hubTop + 0.02) g.add(K.partMesh(K.cylinder(0.028, 0.028, outerTop - hubTop, { seg: n }), legs, 'legs', { position: [0, hubTop, 0] }));
  g.add(K.partMesh(K.cylinder(0.014, 0.014, Math.max(0.01, yM - Math.max(hubTop, outerTop) + 0.01), { seg: n }), mat('chrome', '#d6d8da'), null, { position: [0, Math.max(hubTop, outerTop) - 0.005, 0] }));
  // ---- mechanism + lever
  add(g, K.roundedBox(0.2, 0.05, 0.22, 0.008, 1), frame, 'frame', 0, yM + 0.025, 0);
  add(g, K.box(0.1, 0.01, 0.014), frame, 'frame', 0.14, yM + 0.015, 0.05);
  add(g, K.roundedBox(0.03, 0.012, 0.045, 0.004, 1), frame, 'frame', 0.2, yM + 0.012, 0.05);
  // ---- seat: pan + cushion (waterfall front; channels = stitched pads)
  // the seat's front edge sits 3 cm inside the footprint (dims.d is the whole chair, seat + back), over the column
  // dims are the star's footprint: a product may give the seat cushion's own size (hidden seatW / seatD)
  const hasSeatW = typeof P.seatW === 'number' && Number.isFinite(P.seatW);
  const sw = hasSeatW ? clamp(P.seatW, 0.36, 0.9 * w) : 0.8 * w;
  const sd = typeof P.seatD === 'number' && Number.isFinite(P.seatD) ? clamp(P.seatD, 0.36, 0.85 * d) : 0.78 * d;
  const sz = clamp(d / 2 - 0.03 - sd / 2, 0, 0.06);
  const seatY0 = seatH - seatT;
  if (style !== 'lounge') add(g, K.roundedBox(sw - 0.02, 0.015, sd - 0.03, 0.005, 1), frame, 'frame', 0, seatY0 - 0.004, sz);
  const waterfall = (geo, z0, half) => {
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const z = pos.getZ(i) + z0;
      pos.setY(i, pos.getY(i) - 0.02 * sstep((z - (half - 0.06)) / 0.06));
    }
    pos.needsUpdate = true;
    K.smoothNormals(geo);
    return geo;
  };
  const seatPads = channels ? Math.max(2, Math.round(sd / 0.11)) : 1;
  for (let k = 0; k < seatPads; k++) {
    const pd = sd / seatPads;
    const zc = -sd / 2 + pd * (k + 0.5);
    const geo = K.cushion(sw, seatT, pd + (channels ? 0.004 : 0), { axis: 'y', puff: channels ? 0.18 : 0.12, round: 0.8, sides: 0.1, bottom: 0.2, seg: 12 });
    waterfall(geo, zc, sd / 2);
    add(g, geo, up, 'upholstery', 0, seatH - seatT / 2, sz + zc);
  }
  // ---- back
  const theta = 8 * DEG + recline;
  const head = style === 'task' && P.headrest === true && back !== 'shell' ? 0.16 : style === 'task' && P.headrest === true ? 0.16 : 0;
  const bt = back === 'upholstered' ? (style === 'executive' ? 0.1 : 0.07) : back === 'shell' ? 0.03 : 0.022;
  let bh = Math.max(0.2, (h - seatH - head) / Math.cos(theta) - 0.06 - bt * Math.sin(theta));
  let bw = (style === 'executive' ? 0.84 : style === 'lounge' ? 0.9 : 0.74) * w;
  if (hasSeatW) bw = Math.min(bw, 0.95 * sw);
  // pivot: the back's rearmost point (its top edge, the shell 12 mm behind the pivot plane) lands 1 cm inside the
  // footprint's back edge, kept near the seat's back edge
  const rearOff = (0.06 + bh + head) * Math.sin(theta) + 0.012 * Math.cos(theta);
  const zPivot = clamp(-d / 2 + 0.01 + rearOff, sz - sd / 2 - 0.06, sz - sd / 2 + 0.1);
  if (style === 'lounge') {
    // an upholstered shell round the seat (Stressless Vanilla, Nora): a U in plan hugging the seat cushion – a soft
    // rounded back, sides splaying a little toward the front – whose top runs from the back's full height down to arm
    // height at 2/3 of the seat depth (no arms: a low wrap to 1/3), the arm's front end rounded off. One swept band
    // (frame) with a half-round top edge, leaning back by up to 8° (recline adds to it) within the footprint.
    const t = 0.05;
    const y0 = seatY0 - 0.06;
    const zSeatB = sz - sd / 2;
    const armTop = arms === 'none' ? seatH + 0.1 : seatH + 0.2;
    const zArm = zSeatB + (arms === 'none' ? 0.3 : 0.67) * sd;
    const room = zSeatB - t - (-d / 2 + 0.005);
    const lean = clamp(Math.atan(Math.max(0, room) / Math.max(0.1, h - seatY0)), 0, 8 * DEG + recline * 0.5);
    const xB = sw / 2 + 0.004 + t / 2, zB = zSeatB - t / 2;
    const xF = Math.min(xB + Math.tan(6 * DEG) * (zArm - zB), w / 2 - t / 2 - 0.004);
    const rc = Math.min(0.16, xB * 0.6, (zArm - zB) * 0.6);
    const path = resample(filletPolyline([[-xF, zArm], [-xB, zB], [xB, zB], [xF, zArm]], [0, rc, rc, 0], seg(spec, 10, 5)), seg(spec, 44, 26));
    const np = path.length, total = path[np - 1][2];
    const rTop = t / 2, nR = seg(spec, 6, 4);
    const tip = Math.min(0.06, (zArm - zB) * 0.2);
    // the top along the band: full height at the back, an S-curve down the sides, the last few cm rounded down
    const topAt = (x, z, s) => {
      const f = clamp((z - zB) / Math.max(0.05, zArm - zB), 0, 1);
      let y = lerp(h, armTop, sstep((f - 0.06) / 0.8));
      const e = Math.min(s, total - s);
      if (e < tip) y -= tip - Math.sqrt(tip * tip - (tip - e) ** 2);
      return Math.max(y, seatH + 0.02);
    };
    const pos = [], idx = [];
    const ring = [];
    for (let i = 0; i < np; i++) {
      const [x, z, s] = path[i];
      const a = path[Math.max(0, i - 1)], b = path[Math.min(np - 1, i + 1)];
      const tl = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      const nx = (b[1] - a[1]) / tl, nz = -(b[0] - a[0]) / tl; // outward
      const yt = topAt(x, z, s);
      // a 5 mm step above the bottom corners keeps the walls' normals level
      const sec = [[-t / 2, y0], [-t / 2, y0 + 0.005]];
      for (let k = 0; k <= nR; k++) {
        const ang = Math.PI - (Math.PI * k) / nR;
        sec.push([rTop * Math.cos(ang), yt - rTop + rTop * Math.sin(ang)]);
      }
      sec.push([t / 2, y0 + 0.005], [t / 2, y0]);
      ring.push(sec.map(([o, y]) => [x + nx * o, y, z + nz * o, s, o]));
    }
    // metre UVs: along the band × height (no projection seams round the corners); caps: across × height
    const uv = [];
    const m = ring[0].length;
    for (const sec of ring) for (const p of sec) pos.push(p[0], p[1], p[2]), uv.push(p[3], p[1]);
    for (let i = 0; i < np - 1; i++) {
      for (let k = 0; k < m; k++) {
        const k2 = (k + 1) % m;
        const a = i * m + k, b = (i + 1) * m + k, c = i * m + k2, e = (i + 1) * m + k2;
        idx.push(a, b, c, b, e, c);
      }
    }
    // end caps (own vertices: a crisp edge round the arm's front face)
    for (const [i, flip] of [[0, false], [np - 1, true]]) {
      const base = pos.length / 3;
      for (const p of ring[i]) pos.push(p[0], p[1], p[2]), uv.push(p[4], p[1]);
      for (let k = 1; k < m - 1; k++) idx.push(...(flip ? [base, base + k + 1, base + k] : [base, base + k, base + k + 1]));
    }
    // lean: shear everything above the seat's underside backward
    const tanL = Math.tan(lean);
    for (let i = 0; i < pos.length; i += 3) pos[i + 2] -= tanL * Math.max(0, pos[i + 1] - seatY0);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    add(g, geo, frame, 'frame');
    // seat base under the cushion
    add(g, K.roundedBox(sw - 0.02, 0.05, sd - 0.03, 0.01, 1), frame, 'frame', 0, y0 + 0.025, sz);
  } else {
    const bg = new THREE.Group();
    bg.position.set(0, seatH, zPivot);
    bg.rotation.x = -theta;
    g.add(bg);
    const yb = 0.06 + bh / 2;
    if (back === 'mesh') {
      // a rounded shield: the top corners r 10 cm, the sides tapering to 0.85 × the width at the bottom (r 5 cm
      // corners); the frame is a dense polyline (no spline overshoot at the corners), the mesh a grid inside it
      const hx = bw / 2, hb = 0.85 * hx, y0b = yb - bh / 2, y1b = yb + bh / 2;
      const rT = Math.min(0.1, hx * 0.45, bh * 0.3), rB = Math.min(0.05, hb * 0.4, bh * 0.2);
      const side = (y) => lerp(hb, hx, sstep((y - y0b) / (0.7 * bh)));
      const halfAt = (y) => {
        if (y > y1b - rT) return hx - rT + Math.sqrt(Math.max(0, rT * rT - (y - (y1b - rT)) ** 2));
        if (y < y0b + rB) return hb - rB + Math.sqrt(Math.max(0, rB * rB - (y0b + rB - y) ** 2));
        return side(y);
      };
      const bend = (x) => 0.035 * ((2 * x) / bw) ** 2;
      const nA = Math.max(3, Math.round(6 * q)), nS = Math.max(4, Math.round(8 * q));
      const outline = [];
      const arc = (cx, cy, r, a0, a1) => {
        for (let k = 0; k <= nA; k++) outline.push([cx + r * Math.cos(lerp(a0, a1, k / nA)), cy + r * Math.sin(lerp(a0, a1, k / nA))]);
      };
      for (let k = 1; k < nS; k++) {
        const y = lerp(y0b + rB, y1b - rT, k / nS);
        outline.push([side(y), y]);
      }
      arc(hx - rT, y1b - rT, rT, 0, Math.PI / 2);
      arc(-(hx - rT), y1b - rT, rT, Math.PI / 2, Math.PI);
      for (let k = 1; k < nS; k++) {
        const y = lerp(y1b - rT, y0b + rB, k / nS);
        outline.push([-side(y), y]);
      }
      arc(-(hb - rB), y0b + rB, rB, Math.PI, 1.5 * Math.PI);
      arc(hb - rB, y0b + rB, rB, 1.5 * Math.PI, 2 * Math.PI);
      const loop = outline.map(([x, y]) => [x, y, bend(x)]);
      bg.add(K.partMesh(K.tube(loop, 0.011, { closed: true, curve: 'line', radial: 6, seg: Math.max(48, Math.round(96 * q)) }), frame, 'frame'));
      // the mesh: two faces of a grid whose rows sit at the outline's own heights (the corners too), its edge 4 mm
      // inside the frame tube's centre line
      const nx = Math.max(6, Math.round(10 * q));
      const ys = [y0b + 0.004, ...outline.filter(([x, y]) => x > 0 && y > y0b + 0.008 && y < y1b - 0.008).map(([, y]) => y).sort((a, b) => a - b), y1b - 0.004];
      const ny = ys.length - 1;
      const mp = [], mi = [];
      for (const [face, dz] of [[0, 0.003], [1, -0.003]]) {
        for (let j = 0; j <= ny; j++) {
          const y = ys[j];
          const hw = Math.max(0.01, halfAt(y) - 0.004);
          for (let i = 0; i <= nx; i++) {
            const x = lerp(-hw, hw, i / nx);
            mp.push(x, y, bend(x) + dz);
          }
        }
        const o = face * (nx + 1) * (ny + 1);
        for (let j = 0; j < ny; j++) {
          for (let i = 0; i < nx; i++) {
            const a = o + j * (nx + 1) + i, b = a + 1, c = a + nx + 1, e = c + 1;
            mi.push(...(face ? [a, c, b, b, c, e] : [a, b, c, b, e, c]));
          }
        }
      }
      const mg = new THREE.BufferGeometry();
      mg.setAttribute('position', new THREE.Float32BufferAttribute(mp, 3));
      mg.setIndex(mi);
      mg.computeVertexNormals();
      K.worldUV(mg, 1, { grain: 'x' });
      const meshKind = kindGroup(upKind) === 'fabric' ? upKind : 'knit';
      bg.add(K.partMesh(mg, mat(meshKind, C.upholstery), 'upholstery'));
    } else if (back === 'upholstered') {
      const pads = channels ? Math.max(2, Math.round(bh / 0.13)) : 1;
      const mainH = style === 'executive' ? bh * 0.78 : bh;
      for (let k = 0; k < pads; k++) {
        const ph = mainH / pads;
        bg.add(K.partMesh(bentCushion(bw, ph + (channels ? 0.004 : 0), bt, 0.04, { puff: channels ? 0.18 : 0.12 }), up, 'upholstery', { position: [0, 0.06 + ph * (k + 0.5), bt / 2] }));
      }
      if (style === 'executive') {
        // integrated head section: narrower, on top of the main back
        const hh = bh - mainH;
        bg.add(K.partMesh(bentCushion(bw * 0.72, hh, bt * 0.9, 0.03), up, 'upholstery', { position: [0, 0.06 + mainH + hh / 2, bt / 2] }));
      }
      // thin shell behind
      bg.add(K.partMesh(bentPanel(bw - 0.02, (style === 'executive' ? mainH : bh) - 0.02, 0.012, 0.04), frame, 'frame', { position: [0, 0.06 + (style === 'executive' ? mainH : bh) / 2, -0.006] }));
    } else {
      bg.add(K.partMesh(bentPanel(bw, bh, 0.012, 0.05), frame, 'frame', { position: [0, yb, 0] }));
      bg.add(K.partMesh(bentCushion(bw - 0.05, bh - 0.06, 0.03, 0.045, { puff: 0.1 }), up, 'upholstery', { position: [0, yb, 0.02] }));
    }
    // spine from the mechanism up behind the back
    const spineTop = Math.min(0.3, bh * 0.6);
    bg.add(K.partMesh(K.box(0.05, spineTop + 0.08, 0.02), frame, 'frame', { position: [0, 0.06 + spineTop / 2 - 0.04, -0.03] }));
    add(g, K.box(0.05, 0.03, Math.max(0.02, -zPivot - 0.09)), frame, 'frame', 0, yM + 0.035, (zPivot - 0.11) / 2 - 0.0);
    if (P.lumbar === true) bg.add(K.partMesh(K.roundedBox(0.7 * bw, 0.07, 0.02, 0.008, 1), frame, 'frame', { position: [0, 0.06 + bh * 0.3, back === 'upholstered' ? bt + 0.006 : 0.03] }));
    if (head > 0) {
      bg.add(K.partMesh(K.box(0.03, 0.06, 0.012), frame, 'frame', { position: [0, 0.06 + bh + 0.02, -0.004] }));
      bg.add(K.partMesh(bentCushion(0.6 * bw, 0.14, 0.06, 0.03), up, 'upholstery', { position: [0, 0.06 + bh + 0.04 + 0.07, 0.02] }));
    }
  }
  // ---- arms (part frame)
  const ax = Math.min(sw / 2 + 0.02, w / 2 - 0.045);
  const armY = seatH + 0.21;
  const pad = (x, y, z) => add(g, K.roundedBox(0.07, 0.025, 0.24, 0.008, 2), frame, 'frame', x, y, z);
  if (style !== 'lounge') {
    for (const sx of [-1, 1]) {
      const x = sx * ax;
      if (arms === 'fixed') {
        g.add(K.partMesh(bentTube([[sx * 0.09, yM + 0.03, -0.02], [x, yM + 0.03, -0.02], [x, armY - 0.012, -0.02]], 0.011, 0.04), frame, 'frame'));
        pad(x, armY, -0.02);
      } else if (arms === 'adjustable') {
        add(g, K.box(Math.abs(x) - 0.08, 0.02, 0.05), frame, 'frame', sx * (0.08 + (Math.abs(x) - 0.08) / 2), yM + 0.03, -0.02);
        add(g, K.box(0.035, armY - yM - 0.03, 0.06), frame, 'frame', x, (armY + yM + 0.03) / 2, -0.02);
        pad(x, armY, -0.02);
      } else if (arms === 'loop') {
        const zf = sz + sd / 2 - 0.05, zb = zPivot + 0.04;
        g.add(K.partMesh(bentTube([[x, seatY0 - 0.01, zf - 0.04], [x, armY - 0.01, zf], [x, armY - 0.01, zb], [x, seatH + 0.08, zb - 0.02]], 0.011, 0.05), frame, 'frame'));
        add(g, K.roundedBox(0.04, 0.02, Math.max(0.1, zf - zb - 0.12), 0.007, 2), up, 'upholstery', x, armY + 0.009, (zf + zb) / 2);
      }
    }
  }
  const kinds = { upholstery: upKind, frame: frameKind, legs: legKind };
  const rc = recolorer(g, (part, kind) => !!kind && kindGroup(kind) !== kindGroup(kinds[part]));
  g.name = 'office-chair';
  return K.finishModel(g, { seatY: seatH, recolor: rc });
}

// ---------------------------------------------------------------------------------------------------------------

/** @type {Record<string, object>} */
export const archetypes = {
  stool: def('stool', {
    defaults: {
      dims: { w: 0.38, d: 0.38, h: 0.65 },
      params: { seatShape: 'round', seat: 'wood', legStyle: 'wood-splayed', legs: 4, footrest: 'ring', footrestH: 0.25, back: 'none', swivel: false },
      colors: { upholstery: '#b08a62', legs: '#b08a62', frame: '#b08a62' },
      materials: { upholstery: 'oak', legs: 'oak', frame: 'oak' },
    },
    params: {
      seatShape: { type: 'enum', label: 'Seteform', options: [['round', 'Rund'], ['square', 'Firkantet'], ['saddle', 'Sadel']] },
      seat: { type: 'enum', label: 'Sete', options: [['wood', 'Tre'], ['upholstered', 'Polstret'], ['cushion', 'Tre med pute'], ['cord', 'Flettet snor'], ['cane', 'Rotting']] },
      legStyle: { type: 'enum', label: 'Ben', options: [['wood-splayed', 'Skrå treben'], ['wood-straight', 'Rette treben'], ['metal-thin', 'Tynne metallben'], ['hairpin', 'Hårnålsben'], ['pedestal', 'Søyle med rund fot']] },
      legs: { type: 'number', min: 3, max: 4, step: 1, label: 'Antall ben' },
      footrest: { type: 'enum', label: 'Fotstøtte', options: [['none', 'Ingen'], ['ring', 'Ring'], ['rungs', 'Sprosser'], ['bar', 'Fotlist foran']] },
      footrestH: { type: 'number', min: 0.12, max: 0.5, step: 0.01, label: 'Høyde fotstøtte (m)' },
      back: { type: 'enum', label: 'Rygg', options: [['none', 'Uten'], ['low', 'Lav ryggbøyle'], ['spindles', 'Pinnerygg'], ['shell', 'Skallrygg i ett med setet']] },
      swivel: { type: 'bool', label: 'Dreibar (søylefot)' },
    },
    dimsRange: { w: [0.28, 0.6], d: [0.28, 0.6], h: [0.35, 1.1] },
    build: buildStool,
  }),
  'office-chair': def('office-chair', {
    defaults: {
      dims: { w: 0.62, d: 0.62, h: 1.0 },
      params: { style: 'task', back: 'mesh', channels: false, headrest: false, lumbar: false, arms: 'adjustable', base: 'castors', starArms: 5, seatH: 0.47, recline: 0 },
      colors: { upholstery: '#3a3b3d', frame: '#1c1c1c', legs: '#1c1c1c' },
      materials: { upholstery: 'woven', frame: 'plastic', legs: 'black-metal' },
    },
    params: {
      style: { type: 'enum', label: 'Type', options: [['task', 'Arbeidsstol'], ['executive', 'Sjefsstol (høy, polstret)'], ['lounge', 'Komfortstol (skall med pute)']] },
      back: { type: 'enum', label: 'Rygg', options: [['mesh', 'Nett'], ['upholstered', 'Polstret'], ['shell', 'Skall']] },
      channels: { type: 'bool', label: 'Tverrsømmer' },
      headrest: { type: 'bool', label: 'Nakkestøtte' },
      lumbar: { type: 'bool', label: 'Korsryggstøtte' },
      arms: { type: 'enum', label: 'Armlener', options: [['none', 'Uten'], ['fixed', 'Faste'], ['adjustable', 'Justerbare (T)'], ['loop', 'Bøyle']] },
      base: { type: 'enum', label: 'Fot', options: [['castors', 'Stjernefot med hjul'], ['glides', 'Stjernefot uten hjul'], ['disc', 'Rund dreiefot']] },
      starArms: { type: 'number', min: 4, max: 5, step: 1, label: 'Armer i foten' },
      seatH: { type: 'number', min: 0.4, max: 0.6, step: 0.01, label: 'Setehøyde (m)' },
      recline: { type: 'number', min: 0, max: 20, step: 1, unit: '°', label: 'Ryggvinkel' },
    },
    dimsRange: { w: [0.45, 0.8], d: [0.45, 0.8], h: [0.75, 1.35] },
    build: buildOfficeChair,
  }),
};
