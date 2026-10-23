import * as THREE from 'three';
import schema from '../data/archetypes.json';
import * as K from './kit.js';
import { mat, kindGroup } from '../home/materials.js';
import { recolorer } from './tables.js';

/**
 * Dining chairs with a frame and moulded shell chairs (ARCHITECTURE §5; seating parts upholstery, frame, legs) – the
 * upholstered shell on legs is seating.js `dining-chair`:
 *
 *   chair        back: upholstered (straight) / upholstered-round (a curved band) / spindles / slats / rail (one broad
 *                top rail) / y-back (wishbone) / panel (bent wood) / cane / ladder / framed-pad (an upholstered pad
 *                between wooden posts and rails); seat: upholstered / wood / cord / cane / cushion / saddle (a dished
 *                wooden seat the legs socket into); arms with armStyle frame / pad / loop (hidden default «auto»:
 *                soft back → pad, cantilever → loop, else frame); legs: wood-taper / wood-square / metal-thin / sled /
 *                cantilever (one bent tube per side, S-frame) / metal-frame (square tube) / swivel-legs (four legs
 *                under a turning plate) / swivel-star / swivel-disc; stretchers; hidden legD (leg diameter).
 *   shell-chair  a moulded shell (scoop / square / tub; arms = DAR-type armchair shell) lofted from a centre-line
 *                profile, with an optional seat pad or full upholstery, on wood dowels with wire struts, an eiffel wire
 *                base, thin metal or tapered wooden legs, a sled or a swivel star (design/furniture.md §3.3).
 *
 * Origin: floor, centre of the footprint, the front toward +z. dims.h = top of the back (of the shell).
 */

const num = (v, fb) => (typeof v === 'number' && Number.isFinite(v) ? v : fb);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const sstep = (x) => {
  const t = clamp(x, 0, 1);
  return t * t * (3 - 2 * t);
};
const DEG = Math.PI / 180;
const QF = { low: 0.6, medium: 1, high: 1.5 };
const seg = (spec, n) => Math.max(4, Math.round(n * (QF[spec.quality] ?? 1)));
const _UP = new THREE.Vector3(0, 1, 0);

function add(g, geo, material, part, x = 0, y = 0, z = 0, rot) {
  const m = K.partMesh(geo, material, part, { position: [x, y, z], rotation: rot });
  g.add(m);
  return m;
}

/** A round or square stick between two points (legs, posts, spindles, rails). */
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

/** Curved board in plan (an arc of radius R round (0, zc), half-angle a), height bh, thickness t, bottom at y0. */
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
  // shape in x/(−z) → extrude along +z, then turn the extrusion upward (+y)
  const geo = K.extrudeShape(pts.map(([x, z]) => [x, -z]), bh, { bevel, bevelSegments: bevel > 0.006 ? 3 : 1, curveSegments: 4 });
  geo.rotateX(-Math.PI / 2);
  K.worldUV(geo, 1, { grain: 'x' });
  return geo;
}

/** arcBoard whose height falls from full at the back to `endRatio` × full at the two front ends (tub backs). */
function tubBand(R, a, t, bh, n, endRatio) {
  const geo = arcBoard(R, a, t, bh, n, Math.min(0.03, t * 0.4));
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const ang = Math.abs(Math.atan2(pos.getX(i), -pos.getZ(i)));
    const k = 1 - (1 - endRatio) * Math.min(1, ang / a) ** 1.6;
    pos.setY(i, pos.getY(i) * k);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

/** Rounds the corners of a closed convex polygon [[x, z], …] (radius per corner, n arc points per corner). */
function roundLoop(corners, radii, n = 4) {
  const m = corners.length;
  const out = [];
  for (let i = 0; i < m; i++) {
    const p = corners[i], a = corners[(i + m - 1) % m], b = corners[(i + 1) % m];
    const ua = [a[0] - p[0], a[1] - p[1]], ub = [b[0] - p[0], b[1] - p[1]];
    const la = Math.hypot(...ua), lb = Math.hypot(...ub);
    ua[0] /= la;
    ua[1] /= la;
    ub[0] /= lb;
    ub[1] /= lb;
    const phi = Math.acos(clamp(ua[0] * ub[0] + ua[1] * ub[1], -1, 1));
    const r = Math.min(radii[i], la * 0.45 * Math.tan(phi / 2), lb * 0.45 * Math.tan(phi / 2));
    const tl = r / Math.tan(phi / 2);
    const t0 = [p[0] + ua[0] * tl, p[1] + ua[1] * tl], t1 = [p[0] + ub[0] * tl, p[1] + ub[1] * tl];
    const bis = [ua[0] + ub[0], ua[1] + ub[1]];
    const bl = Math.hypot(...bis) || 1;
    const cd = r / Math.sin(phi / 2);
    const c = [p[0] + (bis[0] / bl) * cd, p[1] + (bis[1] / bl) * cd];
    const a0 = Math.atan2(t0[1] - c[1], t0[0] - c[0]);
    let da = Math.atan2(t1[1] - c[1], t1[0] - c[0]) - a0;
    while (da > Math.PI) da -= 2 * Math.PI;
    while (da < -Math.PI) da += 2 * Math.PI;
    for (let k = 0; k <= n; k++) out.push([c[0] + Math.cos(a0 + (da * k) / n) * r, c[1] + Math.sin(a0 + (da * k) / n) * r]);
  }
  return out;
}

/**
 * A solid slab over a closed convex outline [[x, z], …]: flat bottom at y = 0, a top at y = t (+ dy(x, z), faded to 0
 * at the bottom) gridded in rings toward the centroid, a rounded top edge of radius r. Metre UVs.
 */
function slabGeo(outline, { t, r = 0.008, nEdge = 2, rings = 4, dy = null, grain = 'z' }) {
  const n = outline.length;
  let cx = 0, cz = 0, area = 0;
  for (const [x, z] of outline) {
    cx += x / n;
    cz += z / n;
  }
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
  const bot = ring(0, 0);
  const bc = v(cx, 0, cz);
  for (let i = 0; i < n; i++) idx.push(bot[(i + 1) % n], bc, bot[i]);
  if (sgn < 0) for (let i = 0; i < idx.length; i += 3) [idx[i + 1], idx[i + 2]] = [idx[i + 2], idx[i + 1]];
  if (dy) for (let i = 0; i < pos.length; i += 3) pos[i + 1] += dy(pos[i], pos[i + 2]) * (pos[i + 1] / t);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  K.worldUV(geo, 1, { grain });
  return geo;
}

/** Planar [a, b] polyline with circular fillets of the given radii at its inner points (seating.js filletPolyline). */
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

/** Bent tube through 3D points in one vertical plane (all x equal, or all z equal), corners filleted with `radius`. */
function bentTube(points, r, radius, { radial = 8, n = 6 } = {}) {
  const sameX = points.every((p) => Math.abs(p[0] - points[0][0]) < 1e-6);
  const flat = points.map((p) => (sameX ? [p[2], p[1]] : [p[0], p[1]]));
  const f = filletPolyline(flat, points.map((_, i) => (i === 0 || i === points.length - 1 ? 0 : radius)), n);
  return K.tube(f.map(([a, y]) => (sameX ? [points[0][0], y, a] : [a, y, points[0][2]])), r, { curve: 'line', radial });
}

/** Round swivel plate with a short column up to topY (seating.js swivelDisc). */
function swivelDisc(g, material, r, topY, q) {
  const colR = 0.032;
  const t = Math.min(0.014, topY * 0.5);
  const prof = [[0.001, 0], [r - 0.006, 0], [r, 0.003], [r - 0.002, t * 0.8], [r * 0.9, t], [colR * 2.2, t + 0.004]];
  if (topY > t + 0.02) prof.push([colR * 1.2, t + 0.012], [colR, t + 0.02], [colR, topY - 0.008], [colR * 3.2, topY - 0.006], [colR * 3.4, topY]);
  else prof.push([colR * 3.4, topY]);
  prof.push([0.001, topY]);
  g.add(K.partMesh(K.lathe(prof, { seg: Math.max(16, Math.round(40 * q)) }), material, 'legs'));
}

/** Swivel star (cross) base: tapered arms from a hub, glides, column up to topY (seating.js swivelStar). */
function swivelStar(g, material, r, topY, q, arms = 4) {
  const hubR = 0.045, hubH = Math.min(0.07, topY * 0.8);
  g.add(K.partMesh(K.cylinder(hubR * 0.9, hubR, hubH, { seg: Math.max(12, Math.round(24 * q)) }), material, 'legs'));
  const len = Math.max(0.08, r - 0.01);
  const shape = [[0, 0.012], [len - 0.012, 0.008], [len, 0.012], [len, 0.026], [len - 0.03, 0.032], [0, Math.max(0.035, hubH * 0.85)]];
  const geo = K.extrudeShape(shape, 0.042, { bevel: 0.006, center: true, curveSegments: 4 });
  for (let i = 0; i < arms; i++) {
    const a = (i / arms) * Math.PI * 2 + Math.PI / arms;
    g.add(K.partMesh(i ? geo.clone() : geo, material, 'legs', { rotation: [0, -a, 0] }));
    g.add(K.partMesh(K.cylinder(0.016, 0.018, 0.009, { seg: 10 }), material, 'legs', { position: [Math.cos(a) * (len - 0.025), 0, Math.sin(a) * (len - 0.025)] }));
  }
  if (topY > hubH + 0.005) g.add(K.partMesh(K.cylinder(0.026, 0.028, topY - hubH, { seg: Math.max(10, Math.round(18 * q)) }), material, 'legs', { position: [0, hubH, 0] }));
  g.add(K.partMesh(K.cylinder(0.11, 0.11, 0.008, { seg: Math.max(12, Math.round(24 * q)) }), material, 'legs', { position: [0, topY - 0.008, 0] }));
}

function def(id, { defaults, params = {}, dimsRange, build }) {
  const a = schema.archetypes[id];
  const fam = schema.families[a.family];
  const parts = a.parts || fam.parts;
  return {
    label: a.label,
    mount: a.mount,
    parts: [...parts],
    partLabels: Object.fromEntries(parts.map((p) => [p, a.partLabels?.[p] || fam.partLabels[p] || p])),
    defaults: { params: {}, ...defaults },
    params,
    dimsRange,
    build,
  };
}

const BACKS = ['upholstered', 'upholstered-round', 'pad', 'spindles', 'slats', 'rail', 'y-back', 'panel', 'cane', 'ladder', 'framed-pad'];
const SEATS = ['upholstered', 'wood', 'cord', 'cane', 'cushion', 'saddle'];
const LEGS = ['wood-taper', 'wood-square', 'metal-thin', 'sled', 'cantilever', 'metal-frame', 'swivel-legs', 'swivel-star', 'swivel-disc'];
const ARM_STYLES = ['frame', 'pad', 'loop'];
const SWIVEL = ['swivel-legs', 'swivel-star', 'swivel-disc'];

function buildChair(spec) {
  const { w, d, h } = spec.dims;
  const P = spec.params;
  const C = spec.colors || {}, M = spec.materials || {};
  const g = new THREE.Group();
  const back = BACKS.includes(P.back) ? P.back : 'upholstered';
  const seat = SEATS.includes(P.seat) ? P.seat : 'upholstered';
  const legStyle = LEGS.includes(P.legStyle) ? P.legStyle : 'wood-taper';
  // runde 3 leg styles: no front/back leg pairs (cantilever, swivel bases) or a square-tube frame of their own
  const cantilever = legStyle === 'cantilever', metalFrame = legStyle === 'metal-frame', swivel = SWIVEL.includes(legStyle);
  const q = QF[spec.quality] ?? 1;
  const upKind = M.upholstery || 'woven';
  const up = mat(upKind, C.upholstery, kindGroup(upKind) === 'wood' ? { grain: 'z' } : undefined);
  const frameKind = M.frame || M.legs || 'oak';
  const frameWood = kindGroup(frameKind) === 'wood';
  const frame = mat(frameKind, C.frame || C.legs, frameWood ? { grain: 'y' } : undefined);
  const frameX = mat(frameKind, C.frame || C.legs, frameWood ? { grain: 'x' } : undefined);
  const legsKind = M.legs || frameKind;
  const metalLegs = kindGroup(legsKind) === 'metal';
  const legs = mat(legsKind, C.legs, kindGroup(legsKind) === 'wood' ? { grain: 'y' } : undefined);
  const n = seg(spec, 12);
  const seatH = clamp(num(P.seatH, 0.46), 0.38, Math.min(0.6, h - 0.15));
  const arms = P.arms === true;
  const softBack = back === 'upholstered' || back === 'upholstered-round' || back === 'pad';
  // seat geometry
  const seatT = seat === 'upholstered' ? 0.075 : seat === 'cushion' ? 0.06 : 0.03;
  const zb = -d / 2 + 0.03, zfr = d / 2 - 0.01; // seat back / front edge
  const sd = zfr - zb;
  const sw = w - (arms ? 0.08 : 0.02);
  const legTop = seatH - (seat === 'upholstered' ? seatT : seat === 'cushion' ? seatT + 0.02 : seat === 'saddle' ? 0.045 : 0.02);
  // underside of the seat (where a swivel plate sits): the cushion, the board, the woven insert or the saddle
  const seatBot = seat === 'upholstered' ? seatH - seatT : seat === 'cushion' ? legTop : seat === 'wood' ? seatH - 0.025 : seat === 'saddle' ? seatH - 0.045 : seatH - 0.02;
  // legs: front pair, back pair (the back legs rise into back posts for frame backs)
  const lx = w / 2 - (metalLegs ? 0.035 : 0.04);
  const fz = d / 2 - 0.05, bz = -d / 2 + 0.06;
  const postsUp = !softBack || frameWood; // wood chairs: the back posts continue above the seat
  // wishbone: the back legs rise only to the bent top rail
  const backTopY = back === 'y-back' ? seatH + (h - seatH) * 0.62 : h;
  const rake = 8 * DEG;
  const postTop = (sx) => [sx * (lx - 0.01), backTopY - 0.01, bz - Math.tan(rake) * (backTopY - legTop)];
  const sq = legStyle === 'wood-square' || metalFrame;
  let rLeg = metalLegs || legStyle === 'metal-thin' ? 0.01 : sq ? 0.017 : 0.019;
  if (metalFrame) rLeg = 0.01;
  if (typeof P.legD === 'number' && Number.isFinite(P.legD)) rLeg = clamp(P.legD / 2, 0.006, 0.03);
  // a saddle seat narrows toward the front: the front legs socket in under it
  const lxF = seat === 'saddle' ? Math.min(lx, (0.85 * sw) / 2 - 0.035) : lx;
  // frame backs need posts from the seat up (the legs that usually continue up are missing on these bases)
  const framePosts = !softBack && back !== 'y-back';
  if (legStyle === 'sled') {
    // a bent tube on each side: front post → floor → back → up (into the back frame when the back is a frame)
    const r = 0.009;
    for (const sx of [-1, 1]) {
      const x = sx * lx;
      const pts = [[x, legTop, fz], [x, 0.012, fz + 0.01], [x, 0.012, bz - 0.01], [x, legTop, bz]];
      g.add(K.partMesh(K.tube(pts, r, { curve: 'line', radial: 8 }), legs, 'legs'));
      for (const p of [[x, 0.012, fz + 0.01], [x, 0.012, bz - 0.01]]) add(g, K.sphere(r, { wSeg: 8, hSeg: 6 }), legs, 'legs', ...p);
      // the tube carries on up as a back post for a frame back
      if (!softBack) stick(g, legs, 'legs', [x, legTop, bz], postTop(sx), r, r, { n: 8 });
    }
  } else if (cantilever) {
    // one bent tube per side: (back post →) under the seat → down at the front → back along the floor; a floor
    // crossbar joins the two runners behind the seat
    const r = clamp(num(P.legD, 0.022) / 2, 0.007, 0.016);
    const railY = legTop - r;
    for (const sx of [-1, 1]) {
      const x = sx * (lx - 0.005);
      const pts = [];
      if (framePosts) pts.push([x, postTop(sx)[1], postTop(sx)[2]]);
      pts.push([x, railY, bz], [x, railY, fz - 0.02], [x, r, fz + 0.03], [x, r, bz - 0.06]);
      g.add(K.partMesh(bentTube(pts, r, 0.05, { radial: 8, n: seg(spec, 6) }), legs, 'legs'));
    }
    stick(g, legs, 'legs', [-(lx - 0.005) - r, r, bz - 0.06], [lx - 0.005 + r, r, bz - 0.06], r, r, { n: 8 });
  } else if (metalFrame) {
    // square-tube legs at the corners, a seat frame of 20 × 25 mm rails, square back posts for frame backs
    for (const sx of [-1, 1]) {
      for (const z of [fz, bz]) stick(g, legs, 'legs', [sx * lx, 0, z], [sx * lx, legTop, z], rLeg, rLeg, { square: true, n: 4 });
      if (framePosts) stick(g, frame, 'frame', [sx * lx, legTop - 0.025, bz], postTop(sx), rLeg, rLeg, { square: true, n: 4 });
    }
    const rw = 2 * rLeg, rh = 0.025;
    for (const z of [fz, bz]) add(g, K.box(2 * lx + rw, rh, rw), frame, 'frame', 0, legTop - rh / 2, z);
    for (const sx of [-1, 1]) add(g, K.box(rw, rh, fz - bz - rw), frame, 'frame', sx * lx, legTop - rh / 2, (fz + bz) / 2);
  } else if (swivel) {
    // a turning plate under the seat on four splayed legs, a cross (star) or a round disc; no apron
    const zc = (zb + zfr) / 2;
    if (legStyle === 'swivel-legs') {
      // four legs radiating from a small turning cross plate, splayed ~17° along the diagonals (Bohus Bjerke)
      const plateY = seatBot - 0.032;
      const rT = typeof P.legD === 'number' ? rLeg : metalLegs ? 0.012 : 0.022;
      const ax = 0.18 * w, az = 0.2 * sd;
      add(g, K.cylinder(0.08, 0.08, 0.02, { seg: Math.max(12, Math.round(24 * q)) }), legs, 'legs', 0, seatBot - 0.02, zc);
      add(g, K.roundedBox(2 * ax + 2 * rT + 0.03, 0.014, 2 * az + 2 * rT + 0.03, 0.005, 1), legs, 'legs', 0, plateY + 0.007, zc);
      const l = Math.hypot(ax, az) || 1, spr = Math.tan(17 * DEG) * plateY;
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          const top = [sx * ax, plateY, zc + sz * az];
          // the feet stay inside the footprint
          const fx = sx * Math.min(ax + (ax / l) * spr, w / 2 - rT);
          const fzz = clamp(zc + sz * (az + (az / l) * spr), -d / 2 + rT, d / 2 - rT);
          stick(g, legs, 'legs', [fx, 0, fzz], top, rT * 0.72, rT, { n });
        }
      }
    } else if (legStyle === 'swivel-star') swivelStar(g, legs, clamp(Math.min(w, d) / 2 - 0.02, 0.18, 0.3), seatBot, q, 4);
    else swivelDisc(g, legs, clamp(Math.min(w, d) / 2 - 0.04, 0.18, 0.26), seatBot, q);
    if (framePosts) for (const sx of [-1, 1]) stick(g, frame, 'frame', [sx * lx, seatBot, bz], postTop(sx), rLeg * 0.85, rLeg * 0.8, { square: sq, n });
  } else {
    for (const sx of [-1, 1]) {
      // splay at the foot (square legs: only with the hidden splay flag, Bohus Falster)
      const sp = legStyle === 'metal-thin' ? 0.02 : sq ? (P.splay === true ? 0.035 : 0) : 0.025;
      stick(g, legs, 'legs', [sx * (lxF + sp), 0, fz + sp], [sx * lxF, legTop, fz], rLeg * 0.78, rLeg, { square: sq, n });
      const footB = [sx * (lx + sp), 0, bz - sp * 1.4];
      if (postsUp && !softBack && legStyle !== 'metal-thin') {
        // one piece: back leg → seat → back post, bent at the seat
        stick(g, legs, 'legs', footB, [sx * lx, legTop, bz], rLeg * 0.78, rLeg, { square: sq, n });
        stick(g, frame, 'frame', [sx * lx, legTop, bz], postTop(sx), rLeg, rLeg * 0.85, { square: sq, n });
      } else stick(g, legs, 'legs', footB, [sx * lx, legTop, bz], rLeg * 0.78, rLeg, { square: sq, n });
    }
  }
  // thin metal legs stop at the seat; the framed pad back still needs its posts (the metal tubes carry on up)
  if (back === 'framed-pad' && legStyle === 'metal-thin') for (const sx of [-1, 1]) stick(g, legs, 'legs', [sx * lx, legTop, bz], postTop(sx), rLeg, rLeg, { n });
  // apron / seat frame (not on the bases that carry the seat themselves, nor under a saddle seat)
  const ownSeatFrame = cantilever || metalFrame || swivel || seat === 'saddle';
  if (!ownSeatFrame && (seat !== 'upholstered' || !metalLegs)) {
    const ah = seat === 'upholstered' ? 0.05 : 0.04;
    const at = 0.018;
    for (const sz of [-1, 1]) add(g, K.box(2 * lx - 0.02, ah, at, { grain: 'x' }), frameX, 'frame', 0, legTop - ah / 2 + (seat === 'upholstered' ? 0.005 : 0), sz > 0 ? fz : bz);
    for (const sx of [-1, 1]) add(g, K.box(at, ah, fz - bz - 0.02, { grain: 'z' }), frame, 'frame', sx * lx, legTop - ah / 2 + (seat === 'upholstered' ? 0.005 : 0), (fz + bz) / 2);
  }
  // seat
  if (seat === 'upholstered') {
    add(g, K.cushion(sw, seatT, sd, { axis: 'y', puff: 0.12, round: 0.8, sides: 0.12, bottom: 0.1, seg: 12 }), up, 'upholstery', 0, seatH - seatT / 2, (zb + zfr) / 2);
  } else if (seat === 'cushion') {
    add(g, K.roundedBox(sw, 0.022, sd, 0.004, 1, { grain: 'z' }), frameX, 'frame', 0, legTop + 0.011, (zb + zfr) / 2);
    add(g, K.cushion(sw - 0.03, seatT, sd - 0.03, { axis: 'y', puff: 0.2, round: 0.9, sides: 0.15, seg: 10 }), up, 'upholstery', 0, legTop + 0.022 + seatT / 2, (zb + zfr) / 2);
  } else if (seat === 'wood') {
    add(g, K.roundedBox(sw, 0.025, sd, 0.006, 2, { grain: 'z' }), up, 'upholstery', 0, seatH - 0.0125, (zb + zfr) / 2);
  } else if (seat === 'saddle') {
    // a sculpted wooden seat (front 0.85 × the back width), dished across with a raised front centre
    const fw = 0.85 * sw;
    const outline = roundLoop([[-sw / 2, zb], [-fw / 2, zfr], [fw / 2, zfr], [sw / 2, zb]], [0.05, 0.04, 0.04, 0.05], Math.max(2, Math.round(4 * q)));
    const dish = (x, z) => {
      const f = clamp((z - zb) / sd, 0, 1);
      const half = lerp(sw / 2, fw / 2, f);
      return -0.012 * (1 - clamp(x / half, -1, 1) ** 2) * (1 - 0.5 * f) + 0.01 * Math.exp(-((x / 0.05) ** 2)) * sstep((f - 0.6) / 0.4);
    };
    add(g, slabGeo(outline, { t: 0.045, r: 0.01, dy: dish, rings: Math.max(3, Math.round(5 * q)) }), up, 'upholstery', 0, seatH - 0.045, 0);
  } else {
    // cord / cane: a seat frame with the woven surface inside it
    const ft = 0.03;
    for (const sz of [-1, 1]) add(g, K.roundedBox(sw, ft, ft, 0.005, 1, { grain: 'x' }), frameX, 'frame', 0, seatH - ft / 2, sz > 0 ? zfr - ft / 2 : zb + ft / 2);
    for (const sx of [-1, 1]) add(g, K.roundedBox(ft, ft, sd - 2 * ft, 0.005, 1, { grain: 'z' }), frame, 'frame', sx * (sw / 2 - ft / 2), seatH - ft / 2, (zb + zfr) / 2);
    const woven = seat === 'cane' ? mat('rattan', C.upholstery || '#c7a777', { open: true }) : up;
    add(g, K.box(sw - 2 * ft + 0.006, 0.012, sd - 2 * ft + 0.006), woven, 'upholstery', 0, seatH - 0.014, (zb + zfr) / 2);
  }
  // stretchers between the legs
  if (P.stretchers === true && legStyle !== 'sled' && !cantilever && !swivel) {
    const y = 0.16, r = rLeg * 0.55;
    for (const sx of [-1, 1]) stick(g, legs, 'legs', [sx * (lx + 0.012), y, fz + 0.01], [sx * (lx + 0.012), y, bz - 0.014], r, r, { n: 8, square: sq });
    stick(g, legs, 'legs', [-(lx + 0.01), y + 0.04, (fz + bz) / 2], [lx + 0.01, y + 0.04, (fz + bz) / 2], r, r, { n: 8, square: sq });
  }
  // back
  const bY0 = seatH + 0.04;
  const bY1 = h;
  const bzc = bz - Math.tan(rake) * ((bY0 + bY1) / 2 - legTop);
  const bw = 2 * (lx - 0.01);
  switch (back) {
    case 'upholstered': {
      // one upholstered piece from the seat frame up, standing behind the seat cushion (Parsons-style)
      const bt = 0.07;
      const y0 = legTop - (frameWood ? 0.04 : 0);
      const bh = bY1 - y0;
      const lean = 5 * DEG;
      const grp = new THREE.Group();
      grp.position.set(0, y0, zb + bt / 2 - 0.01);
      grp.rotation.x = -lean;
      g.add(grp);
      grp.add(K.partMesh(K.cushion(sw, bh, bt, { axis: 'z', puff: 0.12, round: 0.7, sides: 0.08, bottom: 0.15, seg: 12 }), up, 'upholstery', { position: [0, bh / 2, 0] }));
      break;
    }
    case 'upholstered-round': {
      // a tub: a thick curved band round the back, its top falling toward the front (into the arms when there are arms)
      const R = Math.max(0.2, w * 0.47);
      const bh = bY1 - (seatH - 0.03);
      const a = (arms ? 100 : 75) * DEG;
      const geo = tubBand(R, a, 0.09, bh, seg(spec, 16), arms ? 0.38 : 0.7);
      add(g, geo, up, 'upholstery', 0, seatH - 0.03, bz + R - 0.01);
      break;
    }
    case 'pad': {
      // a curved upholstered back pad above the seat with a gap (KRYLBO), on two hidden stays
      // a soft oval-ish pad: gently curved in plan, its top corners rounded off toward the sides
      const R = Math.max(0.3, w * 0.8);
      const y0 = seatH + 0.06;
      const ph = Math.max(0.15, h - y0);
      const a = Math.asin(Math.min(0.95, (w / 2 + 0.02) / R));
      add(g, tubBand(R, a, 0.08, ph, seg(spec, 18), 0.72), up, 'upholstery', 0, y0, bz + R - 0.03);
      for (const sx of [-1, 1]) stick(g, legs, 'legs', [sx * (lx - 0.03), legTop, bz + 0.02], [sx * (lx - 0.05), y0 + 0.05, bz - 0.01], 0.008, 0.008, { n: 8 });
      break;
    }
    case 'spindles':
    case 'ladder':
    case 'slats':
    case 'rail':
    case 'cane':
    case 'panel': {
      // top rail between the posts (slightly curved board); a panel back is one broad board, wider than the posts.
      // With the hidden panelH (Bohus Falster) the panel is a café chair's crest: that tall, bent tighter (R 0.35)
      // and overhanging the posts by 5 cm
      const crest = back === 'panel' && typeof P.panelH === 'number' && Number.isFinite(P.panelH);
      const railH = crest ? clamp(P.panelH, 0.08, Math.max(0.08, bY1 - bY0)) : back === 'panel' ? clamp((bY1 - bY0) * 0.5, 0.12, 0.24) : back === 'rail' ? 0.1 : back === 'ladder' ? 0.035 : 0.05;
      const R = crest ? 0.35 : 0.55;
      const a = Math.asin(Math.min(0.95, (bw / 2 + (crest ? 0.05 : back === 'panel' ? 0.03 : 0)) / R));
      const railGeo = arcBoard(R, a, back === 'panel' ? 0.018 : 0.02, railH, crest ? seg(spec, 20) : back === 'panel' ? 14 : 10);
      const zAt = (y) => bz - Math.tan(rake) * (y - legTop);
      // (a crest leans with the posts, its back face on their centre line, its middle bowing out behind them)
      if (crest) {
        // origin on the posts' line at the crest's bottom, so the lean turns it about the posts
        railGeo.translate(0, 0, R - (R - Math.sqrt(R * R - (bw / 2) ** 2) - 0.009));
        add(g, railGeo, frame, 'frame', 0, bY1 - railH, zAt(bY1 - railH), [-rake, 0, 0]);
      }
      else if (!(back === 'spindles' && P.hoop === true)) add(g, railGeo, frame, 'frame', 0, bY1 - railH, zAt(bY1) + R - 0.02);
      if (back === 'spindles' && P.hoop === true) {
        const rx = w / 2 - 0.02, zc = bz + rx * 0.5, rz = zc - (bz - 0.04);
        const yT = bY1 - railH;
        const hp = [];
        for (let k = 0; k <= 16; k++) {
          const t = Math.PI * (k / 16);
          hp.push([-Math.cos(t) * rx, yT + Math.sin(t) * (bY1 - yT), zc - Math.sin(t) * rz]);
        }
        g.add(K.partMesh(K.tube(hp, 0.014, { radial: 8 }), frame, 'frame'));
        const nS = clamp(Math.round(num(P.spindles, 5)), 3, 12);
        for (let k = 1; k <= nS; k++) {
          const t = Math.PI * (0.18 + (0.64 * k) / (nS + 1));
          const top = [-Math.cos(t) * rx, yT + Math.sin(t) * (bY1 - yT) - 0.01, zc - Math.sin(t) * rz];
          stick(g, frame, 'frame', [top[0] * 0.8, seatH, zAt(seatH) + 0.01], top, 0.007, 0.006, { n: 8 });
        }
      } else if (back === 'spindles') {
        const nS = clamp(Math.round(num(P.spindles, Math.round(bw / 0.06))), 3, 12);
        for (let k = 1; k <= nS; k++) {
          const x = -bw / 2 + (k * bw) / (nS + 1);
          stick(g, frame, 'frame', [x, seatH, zAt(seatH) + 0.004], [x, bY1 - railH + 0.005, zAt(bY1 - railH) + 0.02], 0.007, 0.006, { n: 8 });
        }
      } else if (back === 'slats' || back === 'ladder') {
        const nS = back === 'ladder' ? 3 : clamp(Math.round(num(P.slats, 2)), 1, 4);
        for (let k = 1; k <= nS; k++) {
          const y = bY1 - railH - k * ((bY1 - railH - bY0) / (nS + 0.6));
          add(g, arcBoard(R, a, 0.018, back === 'ladder' ? 0.03 : 0.05, 10), frame, 'frame', 0, y, zAt(y) + R - 0.03);
        }
      } else if (back === 'cane') {
        const y0c = bY0 + 0.05, y1c = bY1 - railH;
        add(g, K.roundedBox(bw, 0.03, 0.02, 0.004, 1, { grain: 'x' }), frameX, 'frame', 0, y0c, zAt(y0c));
        const cm = add(g, K.box(bw - 0.01, y1c - y0c - 0.015, 0.004), mat('rattan', '#c7a777', { open: true }), null, 0, (y0c + y1c) / 2, zAt((y0c + y1c) / 2), [-rake, 0, 0]);
        cm.userData.noShadow = true;
      }
      break;
    }
    case 'y-back': {
      // wishbone: a bent top rail from post to post round the back, and a Y-shaped splat in the middle
      const r = 0.012;
      const yT = backTopY;
      const rx = w / 2 - 0.02;
      const zc = bz + rx * 0.55, rz = zc - (bz - 0.04);
      const pts = [];
      for (let k = 0; k <= 16; k++) {
        const a = Math.PI * (k / 16); // 0 = left end, π/2 = the back, π = right end
        pts.push([-Math.cos(a) * rx, yT + Math.sin(a) * 0.02, zc - Math.sin(a) * rz]);
      }
      g.add(K.partMesh(K.tube(pts, r * 1.7, { radial: 8 }), frame, 'frame'));
      // short posts carry the free ends from the seat frame
      for (const sx of [-1, 1]) stick(g, frame, 'frame', [sx * (lx - 0.005), legTop, zc + 0.01], [sx * rx, yT - 0.01, zc], 0.011, 0.01, { n: 8 });
      // Y splat
      const sm = K.extrudeShape([[-0.012, 0], [0.012, 0], [0.012, 0.09], [0.05, (yT - seatH) * 0.95], [-0.05, (yT - seatH) * 0.95], [-0.012, 0.09]], 0.012, { bevel: 0.002, bevelSegments: 1, curveSegments: 2 });
      K.worldUV(sm, 1, { grain: 'y' });
      add(g, sm, frame, 'frame', 0, seatH, bz - 0.04);
      break;
    }
    case 'framed-pad': {
      // wooden top and lower rails between the posts, an upholstered pad between them following the rails' curve
      const R = 0.55;
      const a = Math.asin(Math.min(0.95, bw / 2 / R));
      const zAt = (y) => bz - Math.tan(rake) * (y - legTop);
      if (kindGroup(frameKind) === 'metal') {
        // metal frame (Bohus Fontas): no rails – a nearly flat pad screwed onto the front of the tube posts, from a
        // hand's width over the seat to the top
        const y0p = bY0 + 0.05, y1p = bY1;
        const ph = y1p - y0p, pt = 0.05, Rf = 1.6;
        const geo = K.cushion(bw + 0.03, ph, pt, { axis: 'z', puff: 0.12, round: 0.7, sides: 0.1, bottom: 0.3, seg: 10 });
        const pos = geo.attributes.position;
        for (let i = 0; i < pos.count; i++) pos.setZ(i, pos.getZ(i) + Rf - Math.sqrt(Rf * Rf - pos.getX(i) ** 2));
        pos.needsUpdate = true;
        K.smoothNormals(geo);
        const ym = (y0p + y1p) / 2;
        // the pad's back touches the tubes (its sides bow forward by the bend there)
        const xT = lx - 0.005;
        add(g, geo, up, 'upholstery', 0, ym, zAt(ym) + 0.01 + pt / 2 - (Rf - Math.sqrt(Rf * Rf - xT * xT)), [-rake, 0, 0]);
        break;
      }
      const railH = 0.04, lowH = 0.03;
      add(g, arcBoard(R, a, 0.02, railH, 10), frame, 'frame', 0, bY1 - railH, zAt(bY1) + R - 0.02);
      add(g, arcBoard(R, a, 0.02, lowH, 10), frame, 'frame', 0, bY0, zAt(bY0) + R - 0.02);
      const y0p = bY0 + lowH + 0.005, y1p = bY1 - railH - 0.005;
      const ph = y1p - y0p;
      if (ph > 0.05) {
        const pt = 0.05;
        const geo = K.cushion(bw - 0.04, ph, pt, { axis: 'z', puff: 0.12, round: 0.7, sides: 0.1, bottom: 0.3, seg: 10 });
        const pos = geo.attributes.position;
        for (let i = 0; i < pos.count; i++) pos.setZ(i, pos.getZ(i) + R - Math.sqrt(R * R - Math.min(R * R * 0.9, pos.getX(i) ** 2)));
        pos.needsUpdate = true;
        K.smoothNormals(geo);
        const ym = (y0p + y1p) / 2;
        add(g, geo, up, 'upholstery', 0, ym, zAt(ym) - 0.01 + pt / 2, [-rake, 0, 0]);
      }
      break;
    }
    default:
  }
  // arms (frame backs: wooden arm rests on the front legs; upholstered: soft pads)
  // armStyle (hidden default «auto»): soft back → padded rests, cantilever → a bent loop, else wooden/metal rests
  const armStyle = ARM_STYLES.includes(P.armStyle) ? P.armStyle : softBack ? 'pad' : cantilever ? 'loop' : 'frame';
  if (arms && back !== 'y-back' && back !== 'upholstered-round') {
    const ay = seatH + 0.2;
    for (const sx of [-1, 1]) {
      const x = sx * (lx + 0.005);
      if (armStyle === 'loop') {
        // one bent tube: from the back (post) at arm height forward, then down into the seat side at the front
        const r = metalLegs || kindGroup(frameKind) === 'metal' ? 0.011 : 0.014;
        const zB = framePosts ? bz - Math.tan(rake) * (ay - legTop) : bz + 0.01;
        g.add(K.partMesh(bentTube([[x, ay, zB], [x, ay, fz - 0.01], [x, legTop - 0.005, fz - 0.01]], r, 0.06, { radial: 8, n: seg(spec, 6) }), frame, 'frame'));
        continue;
      }
      stick(g, frame, 'frame', [x, legTop, fz], [x, ay, fz - 0.03], rLeg * 0.8, rLeg * 0.75, { n, square: sq });
      if (armStyle === 'pad') add(g, K.cushion(0.05, 0.05, fz - bz, { axis: 'y', puff: 0.15, round: 0.9, seg: 8 }), up, 'upholstery', x, ay + 0.02, (fz + bz) / 2 - 0.02);
      else add(g, K.roundedBox(0.04, 0.022, fz - bz + 0.04, 0.008, 2, { grain: 'z' }), frameX, 'frame', x, ay + 0.011, (fz + bz) / 2 - 0.02);
    }
  }
  const rc = recolorer(g, (part, kind) => !!kind && kindGroup(kind) !== kindGroup(part === 'upholstery' ? upKind : part === 'legs' ? legsKind : frameKind));
  g.name = 'chair';
  return K.finishModel(g, { seatY: seatH, recolor: rc });
}

// ---------------------------------------------------------------------------------------------------------------
// Shell chair (FURN §3.3)

const SHELL_SHAPES = ['scoop', 'square', 'tub'];
const SHELL_PADS = ['none', 'seat', 'full'];
const SHELL_LEGS = ['wood-dowel', 'eiffel', 'metal-thin', 'wood-taper', 'sled', 'swivel-star'];

/**
 * The shell's sitting surface S(u, v): u ∈ [−1, 1] across, v ∈ [0, 1] by arc length along the centre-line in the yz
 * plane (front lip → seat front → dished pan → fillet → reclined back → top at y = h). Each cross-section lies in the
 * plane of x and the centre-line's inward normal n(v) (up on the seat, forward on the back); its sides are lifted
 * along n by lift(v)·|u|^p(v) – the seat's curled edges, the cupped back, the armchair's raised sides.
 */
function shellSurface({ w, d, h, seatH, shape, arms }) {
  const recline = (shape === 'tub' ? 6 : shape === 'square' ? 10 : 14) * DEG;
  const zLip = d / 2 - 0.01, zF = d / 2 - 0.035, zTop = -d / 2 + 0.012;
  const yPan = seatH - 0.004;
  // the back line through the top, leaning back by the recline; the corner where it meets the pan
  const zC = zTop + (h - yPan) * Math.tan(recline);
  const src = [[zLip, seatH - 0.03], [zF, seatH], [zC, yPan], [zTop, h]];
  const line = filletPolyline(src, [0, 0.02, 0.08, 0], 10);
  // dense arc-length table
  const L = [0];
  for (let i = 1; i < line.length; i++) L.push(L[i - 1] + Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]));
  const total = L[L.length - 1];
  const at = (s) => {
    let i = 1;
    while (i < L.length - 1 && L[i] < s) i++;
    const t = clamp((s - L[i - 1]) / Math.max(1e-9, L[i] - L[i - 1]), 0, 1);
    const a = line[i - 1], b = line[i];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return { z: lerp(a[0], b[0], t), y: lerp(a[1], b[1], t), tz: (b[0] - a[0]) / len, ty: (b[1] - a[1]) / len };
  };
  // key stations (as fractions of the length): seat front, start / middle of the fillet
  const sF = Math.hypot(zF - zLip, 0.03) / total;
  const sB = (Math.hypot(zF - zLip, 0.03) + Math.max(0, zF - zC - 0.08)) / total;
  const sC = Math.min(0.95, sB + (0.08 * 1.4) / total);
  const backH = h - seatH;
  const lipW = 0.44 * w, panBackW = 0.4 * w, topW = 0.5 * w;
  const halfW = (v) => (shape === 'square' ? 0.48 * w : v <= sF ? lipW : v <= sC ? lerp(lipW, panBackW, sstep((v - sF) / (sC - sF))) : lerp(panBackW, topW, sstep((v - sC) / (1 - sC))));
  // side lift: a tub wraps its low back round the seat at nearly constant depth (one rim all round); arms raise the
  // seat sides 0.12 → 0.2 front to back and carry on round the back
  const tubWrap = clamp(backH * 0.75, 0.08, 0.22);
  const backLift = shape === 'square' ? 0.02 : shape === 'tub' ? Math.max(tubWrap, arms ? 0.2 : 0) : arms ? 0.14 : 0.055;
  const seatLift = (v) => {
    const f = clamp((v - sF) / Math.max(1e-6, sB - sF), 0, 1); // 0 at the seat front … 1 at the pan's back
    let l = shape === 'square' ? 0.015 : 0.035;
    if (shape === 'tub') l = lerp(0.035, backLift, sstep(f));
    if (arms) l = Math.max(l, lerp(0.12, 0.2, f));
    return l;
  };
  const lift = (v) => (v <= sB ? seatLift(v) : lerp(seatLift(sB), backLift, sstep((v - sB) / Math.max(1e-6, 1 - sB))));
  const pSeat = shape === 'square' ? 6 : shape === 'tub' ? 4 : 3;
  const pBack = shape === 'square' ? 5 : 2.2;
  const pw = (v) => lerp(pSeat, pBack, sstep((v - sB) / Math.max(1e-6, sC + 0.06 - sB)));
  // the pan is dished 12 mm along its length (fades out toward the lip and into the fillet)
  const dish = (v) => (v > sF && v < sB ? -0.012 * Math.sin((Math.PI * (v - sF)) / (sB - sF)) : 0);
  // lift direction: the centre-line's inward normal with its angle smoothed along the length, so a side lift larger
  // than the fillet radius (arms, tub) sweeps round the corner instead of folding into a crease
  const maxLift = Math.max(seatLift(sB), backLift);
  const NS = 160;
  const ang = [];
  for (let k = 0; k <= NS; k++) {
    const c = at((k / NS) * total);
    let a = Math.atan2(c.ty, c.tz);
    if (k && a - ang[k - 1] > Math.PI) a -= 2 * Math.PI;
    else if (k && ang[k - 1] - a > Math.PI) a += 2 * Math.PI;
    ang.push(a);
  }
  const sigma = Math.max(0.03, maxLift * 0.9) / total; // in v units
  const angS = ang.map((_, k) => {
    let s = 0, wsum = 0;
    for (let j = 0; j <= NS; j++) {
      const dv = (j - k) / NS;
      if (Math.abs(dv) > 3 * sigma) continue;
      const wt = Math.exp(-0.5 * (dv / sigma) ** 2);
      s += ang[j] * wt;
      wsum += wt;
    }
    return s / wsum;
  });
  const dirAt = (v) => {
    const f = clamp(v, 0, 1) * NS, k = Math.min(NS - 1, Math.floor(f));
    const a = lerp(angS[k], angS[k + 1], f - k);
    return [Math.sin(a), -Math.cos(a)]; // [nz, ny]: up on the seat, forward on the back
  };
  const point = (u, v) => {
    const c = at(v * total);
    const [nz, ny] = dirAt(v);
    const l = lift(v) * Math.abs(u) ** pw(v);
    return [u * halfW(v), c.y + dish(v) + ny * l, c.z + nz * l];
  };
  // the pan's centre and lowest point (for pads and the base's mount)
  const mid = at(((sF + sB) / 2) * total);
  return { point, halfW, total, sF, sB, sC, panZ: mid.z, panY: mid.y - 0.012, panD: zF - (zC + 0.08), zC };
}

/**
 * A closed solid over a grid of surface points: the given (inner) face, the face offset by −t along its normals,
 * the four edges stitched. Normals are smoothed over the rim (a rounded moulded edge). u/v metre UVs.
 */
function shellSolid(surf, nu, nv, { u0 = -1, u1 = 1, v0 = 0, v1 = 1, t, lift = 0 }) {
  const P = [], N = [];
  for (let j = 0; j <= nv; j++) {
    for (let i = 0; i <= nu; i++) P.push(surf.point(lerp(u0, u1, i / nu), lerp(v0, v1, j / nv)));
  }
  const id = (i, j) => j * (nu + 1) + i;
  // normals by central differences, oriented like du × dv (up on the seat)
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
  const pos = [], uv = [], idx = [];
  const cnt = P.length;
  for (const k of [0, 1]) {
    for (let j = 0; j <= nv; j++) {
      for (let i = 0; i <= nu; i++) {
        const p = P[id(i, j)], n = N[id(i, j)];
        const o = k ? -t : 0;
        pos.push(p[0] + n[0] * (o + lift), p[1] + n[1] * (o + lift), p[2] + n[2] * (o + lift));
        uv.push(p[0], (lerp(v0, v1, j / nv) * surf.total));
      }
    }
  }
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      const a = id(i, j), b = id(i + 1, j), c = id(i, j + 1), e = id(i + 1, j + 1);
      idx.push(a, b, c, b, e, c); // inner face (normal along du × dv)
      idx.push(cnt + a, cnt + c, cnt + b, cnt + b, cnt + c, cnt + e); // outer face
    }
  }
  // rims: u = u0 / u1 along v, v = v0 / v1 along u
  for (let j = 0; j < nv; j++) {
    const a = id(0, j), c = id(0, j + 1);
    idx.push(a, c, cnt + a, c, cnt + c, cnt + a);
    const b = id(nu, j), e = id(nu, j + 1);
    idx.push(b, cnt + b, e, e, cnt + b, cnt + e);
  }
  for (let i = 0; i < nu; i++) {
    const a = id(i, 0), b = id(i + 1, 0);
    idx.push(a, cnt + a, b, b, cnt + a, cnt + b);
    const c = id(i, nv), e = id(i + 1, nv);
    idx.push(c, e, cnt + c, e, cnt + e, cnt + c);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

function buildShellChair(spec) {
  const { w, d, h } = spec.dims;
  const P = spec.params;
  const C = spec.colors || {}, M = spec.materials || {};
  const q = QF[spec.quality] ?? 1;
  const g = new THREE.Group();
  const shape = SHELL_SHAPES.includes(P.shellShape) ? P.shellShape : 'scoop';
  const pad = SHELL_PADS.includes(P.pad) ? P.pad : 'none';
  const legStyle = SHELL_LEGS.includes(P.legStyle) ? P.legStyle : 'wood-dowel';
  const arms = P.arms === true;
  const seatH = clamp(num(P.seatH, 0.45), 0.4, Math.min(0.5, h - 0.2));
  const shellT = clamp(num(P.shellT, 0.008), 0.004, 0.015);
  const shellKind = M.frame || 'plastic';
  const upKind = M.upholstery || 'woven';
  const legKind = M.legs || 'oak';
  const wood = (k) => kindGroup(k) === 'wood';
  const shellMat = mat(shellKind, C.frame, wood(shellKind) ? { grain: 'y' } : undefined);
  const up = mat(upKind, C.upholstery, wood(upKind) ? { grain: 'z' } : undefined);
  const legs = mat(legKind, C.legs, wood(legKind) ? { grain: 'y' } : undefined);
  const n = seg(spec, 12);
  // ---- shell
  const surf = shellSurface({ w, d, h, seatH, shape, arms });
  const nu = Math.max(10, Math.round(20 * q)), nv = Math.max(14, Math.round(26 * q));
  add(g, shellSolid(surf, nu, nv, { t: shellT }), shellMat, 'frame');
  // ---- upholstery
  const panW = 2 * surf.halfW((surf.sF + surf.sB) / 2);
  if (pad === 'seat') {
    add(g, K.cushion(0.8 * panW, 0.025, 0.72 * surf.panD, { axis: 'y', puff: 0.15, round: 0.9, seg: 10 }), up, 'upholstery', 0, surf.panY + 0.0125, surf.panZ);
  } else if (pad === 'full') {
    // a second skin 12 mm over the inner face, a little inside the rim (its own edges round over)
    add(g, shellSolid(surf, Math.max(8, Math.round(16 * q)), Math.max(12, Math.round(22 * q)), { u0: -0.94, u1: 0.94, v0: surf.sF * 0.6, v1: 0.975, t: 0.011, lift: 0.0125 }), up, 'upholstery');
  }
  // ---- base: a mount plate under the pan, centred in the footprint
  const plateY = Math.min(seatH - 0.05, surf.panY - shellT - 0.03);
  const plateTop = plateY + 0.004;
  const k = clamp(w / 0.47, 0.85, 1.25);
  const steelHex = P.wireHex || (wood(legKind) ? '#c9cbcc' : '#1a1a1a');
  // tapered legs with the hidden legD ≥ 3 cm («chunky», IKEA ODGER) go straight into the shell: no mount plate
  const chunky = legStyle === 'wood-taper' && typeof P.legD === 'number' && P.legD >= 0.03;
  // the inner face over the seat, sampled once: a chunky leg's top end is cut to the middle of the shell's thickness
  // (the seat curls up toward the back, so a flat end would gap or poke through)
  const innerPts = [];
  if (chunky) for (let j = 0; j <= 60; j++) for (let i = 0; i <= 40; i++) innerPts.push(surf.point(-1 + i / 20, lerp(surf.sF * 0.5, surf.sC, j / 60)));
  const shellMid = (x, z) => {
    let best = innerPts[0], bd = Infinity;
    for (const p of innerPts) {
      const dd = (p[0] - x) ** 2 + (p[2] - z) ** 2;
      if (dd < bd) {
        bd = dd;
        best = p;
      }
    }
    return best[1] - shellT * 0.5;
  };
  if (legStyle !== 'swivel-star' && !chunky) {
    add(g, K.box(0.2, 0.008, 0.24), legStyle === 'wood-dowel' || legStyle === 'wood-taper' ? mat('black-metal', '#1a1a1a') : legs, legStyle === 'wood-dowel' || legStyle === 'wood-taper' ? null : 'legs', 0, plateY, 0);
    // rubber mounts between the plate and the shell
    const shock = mat('plastic', '#1b1b1b');
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) add(g, K.cylinder(0.014, 0.014, surf.panY - shellT - plateTop + 0.003, { seg: 8 }), shock, null, sx * 0.07, plateTop, sz * 0.085);
  }
  const fx = w / 2 - 0.03, fzF = d / 2 - 0.04, fzB = -d / 2 + 0.04;
  if (legStyle === 'wood-dowel') {
    const tops = [], feet = [];
    for (const sx of [-1, 1]) {
      for (const sz of [1, -1]) {
        tops.push([sx * 0.12 * k * 0.8, plateY - 0.004, sz * 0.13 * k * 0.8]);
        feet.push([sx * fx, 0, sz > 0 ? fzF : fzB]);
      }
    }
    for (let i = 0; i < 4; i++) {
      stick(g, legs, 'legs', feet[i], tops[i], 0.011, 0.014, { n });
      add(g, K.cylinder(0.0115, 0.0115, 0.012, { seg: 10 }), mat('chrome', '#c9cbcc'), null, ...feet[i]);
    }
    // wire struts: a side rod each side and a cross between them
    const wire = mat('steel', steelHex);
    const yS = 0.17;
    const atY = (i) => feet[i].map((v, a) => (a === 1 ? yS : lerp(v, tops[i][a], yS / tops[i][1])));
    const pts = [atY(0), atY(1), atY(2), atY(3)]; // [-x front, -x back, +x front, +x back]
    add(g, K.tube([pts[0], pts[1]], 0.003, { curve: 'line', radial: 6 }), wire, null);
    add(g, K.tube([pts[2], pts[3]], 0.003, { curve: 'line', radial: 6 }), wire, null);
    add(g, K.tube([pts[0], [0, yS + 0.02, 0], pts[3]], 0.003, { curve: 'line', radial: 6 }), wire, null);
    add(g, K.tube([pts[2], [0, yS + 0.02, 0], pts[1]], 0.003, { curve: 'line', radial: 6 }), wire, null);
  } else if (legStyle === 'eiffel') {
    // four wire legs from the plate corners and a W-brace in each side plane
    const r = 0.0055;
    const top = (sx, sz) => [sx * 0.085, plateY - 0.004, sz * 0.1];
    const foot = (sx, sz) => [sx * (fx - 0.01), 0, sz > 0 ? fzF - 0.01 : fzB + 0.01];
    const atY = (sx, sz, y) => {
      const a = foot(sx, sz), b = top(sx, sz);
      return [lerp(a[0], b[0], y / b[1]), y, lerp(a[2], b[2], y / b[1])];
    };
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        stick(g, legs, 'legs', foot(sx, sz), top(sx, sz), r, r, { n: 6 });
        add(g, K.cylinder(0.009, 0.009, 0.008, { seg: 8 }), mat('plastic', '#1b1b1b'), null, ...foot(sx, sz));
      }
      const yHi = plateY * 0.62, yLo = plateY * 0.3;
      const f = atY(sx, 1, yHi), b = atY(sx, -1, yHi);
      const mid = (t, y) => [lerp(f[0], b[0], t), y, lerp(f[2], b[2], t)];
      add(g, K.tube([f, mid(0.25, yLo), mid(0.5, yHi), mid(0.75, yLo), b], r * 0.8, { curve: 'line', radial: 6 }), legs, 'legs');
    }
    // the front and back pairs are tied by a short strut each
    for (const sz of [-1, 1]) add(g, K.tube([atY(-1, sz, plateY * 0.62), atY(1, sz, plateY * 0.62)], r * 0.8, { curve: 'line', radial: 6 }), legs, 'legs');
  } else if (chunky) {
    // chunky (square) legs fixed straight into the shell near the seat's corners, nearly upright (IKEA ODGER)
    const rT = clamp(P.legD / 2, 0.008, 0.03), rB = rT * 0.8, square = P.square === true;
    const tx = 0.29 * w, tz = 0.275 * d;
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const top = [sx * tx, shellMid(sx * tx, sz * tz), sz * tz];
        const foot = [sx * Math.min(tx + 0.04, w / 2 - rB), 0, sz * Math.min(tz + 0.045, d / 2 - rB)];
        const m = stick(g, legs, 'legs', foot, top, rB, rT, { n: square ? 4 : n, square });
        if (!m) continue;
        // cut the top end to the shell: each top vertex slides along the leg to the shell's mid-thickness above it
        m.updateMatrix();
        const pos = m.geometry.attributes.position, len = Math.hypot(top[0] - foot[0], top[1] - foot[1], top[2] - foot[2]);
        const ay = (top[1] - foot[1]) / len;
        const v = new THREE.Vector3();
        for (let i = 0; i < pos.count; i++) {
          if (pos.getY(i) < len - 1e-6) continue;
          v.set(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(m.matrix);
          pos.setY(i, pos.getY(i) + (shellMid(v.x, v.z) - v.y) / ay);
        }
        pos.needsUpdate = true;
        if (square) m.geometry.computeVertexNormals();
      }
    }
  } else if (legStyle === 'metal-thin' || legStyle === 'wood-taper') {
    const metal = legStyle === 'metal-thin';
    const rT = metal ? 0.009 : 0.016, rB = metal ? 0.008 : 0.011;
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const top = [sx * 0.08, plateY - 0.004, sz * 0.09];
        const foot = [sx * (metal ? fx - 0.02 : fx), 0, sz > 0 ? (metal ? fzF - 0.02 : fzF) : metal ? fzB + 0.02 : fzB];
        stick(g, legs, 'legs', foot, top, rB, rT, { n });
      }
    }
  } else if (legStyle === 'sled') {
    // a bent tube on each side: from the plate down to the floor at the front, back along the floor, up to the plate
    const r = 0.009, x = fx - 0.02;
    for (const sx of [-1, 1]) {
      const pts = [[sx * 0.09, plateY, 0.1], [sx * x, 0.012, fzF], [sx * x, 0.012, fzB], [sx * 0.09, plateY, -0.1]];
      g.add(K.partMesh(K.tube(pts, r, { curve: 'line', radial: 8 }), legs, 'legs'));
      for (const p of pts.slice(1, 3)) add(g, K.sphere(r, { wSeg: 8, hSeg: 6 }), legs, 'legs', ...p);
    }
    add(g, K.box(0.2, 0.012, 0.02), legs, 'legs', 0, plateY - 0.004, 0.1);
    add(g, K.box(0.2, 0.012, 0.02), legs, 'legs', 0, plateY - 0.004, -0.1);
  } else {
    swivelStar(g, legs, clamp(Math.min(w, d) / 2 - 0.02, 0.2, 0.3), surf.panY - shellT - 0.004, q, 4);
  }
  const kinds = { frame: shellKind, upholstery: upKind, legs: legKind };
  const rc = recolorer(g, (part, kind) => !!kind && kindGroup(kind) !== kindGroup(kinds[part]));
  g.name = 'shell-chair';
  return K.finishModel(g, { seatY: seatH, recolor: rc });
}

/** @type {Record<string, object>} */
export const archetypes = {
  chair: def('chair', {
    defaults: {
      dims: { w: 0.5, d: 0.55, h: 0.82 },
      params: { back: 'upholstered', seat: 'upholstered', arms: false, legStyle: 'wood-taper', seatH: 0.46, stretchers: false },
      colors: { upholstery: '#c8bfb2', frame: '#7a5a3f', legs: '#7a5a3f' },
      materials: { upholstery: 'woven', frame: 'oak', legs: 'oak' },
    },
    params: {
      back: { type: 'enum', label: 'Rygg', options: [['upholstered', 'Polstret, rett'], ['upholstered-round', 'Polstret, rund'], ['pad', 'Polstret ryggpute'], ['spindles', 'Pinner'], ['slats', 'Tverrspiler'], ['rail', 'Bred toppspile'], ['y-back', 'Y-rygg (wishbone)'], ['panel', 'Bøyd treplate'], ['cane', 'Rotting'], ['ladder', 'Stige'], ['framed-pad', 'Polstret rygg i treramme']] },
      seat: { type: 'enum', label: 'Sete', options: [['upholstered', 'Polstret'], ['wood', 'Tre'], ['cord', 'Flettet papirsnor'], ['cane', 'Rotting'], ['cushion', 'Tre med pute'], ['saddle', 'Sadelsete (tre)']] },
      arms: { type: 'bool', label: 'Armlener' },
      // «auto» (no value) follows the back and the base: soft back → Polstret, frittbærende → Bøyd rør, else Tre/metall
      armStyle: { type: 'enum', label: 'Armlenetype', requires: 'arms', options: [['auto', 'Automatisk'], ['frame', 'Tre/metall'], ['pad', 'Polstret'], ['loop', 'Bøyd rør']] },
      legStyle: { type: 'enum', label: 'Ben', options: [['wood-taper', 'Runde treben'], ['wood-square', 'Firkantede treben'], ['metal-thin', 'Tynne metallben'], ['sled', 'Medeben i metall'], ['cantilever', 'Frittbærende (S-ramme)'], ['metal-frame', 'Metallramme (firkantrør)'], ['swivel-legs', 'Dreibar på fire ben'], ['swivel-star', 'Dreiefot med kryss'], ['swivel-disc', 'Dreiefot med rund plate']] },
      seatH: { type: 'number', min: 0.4, max: 0.55, step: 0.01, label: 'Setehøyde (m)' },
      stretchers: { type: 'bool', label: 'Sprosser mellom bena' },
    },
    dimsRange: { w: [0.4, 0.7], d: [0.42, 0.7], h: [0.7, 1.05] },
    build: buildChair,
  }),
  'shell-chair': def('shell-chair', {
    defaults: {
      dims: { w: 0.47, d: 0.53, h: 0.81 },
      params: { shellShape: 'scoop', arms: false, pad: 'none', legStyle: 'wood-dowel', seatH: 0.45, shellT: 0.008 },
      colors: { frame: '#ece9e2', upholstery: '#b9b2a6', legs: '#c9a77f' },
      materials: { frame: 'plastic', upholstery: 'woven', legs: 'oak' },
    },
    params: {
      shellShape: { type: 'enum', label: 'Skall', options: [['scoop', 'Rund skål'], ['square', 'Rett skall'], ['tub', 'Lav tubstol']] },
      arms: { type: 'bool', label: 'Armlener' },
      pad: { type: 'enum', label: 'Polstring', options: [['none', 'Uten'], ['seat', 'Setepute'], ['full', 'Helpolstret']] },
      legStyle: { type: 'enum', label: 'Understell', options: [['wood-dowel', 'Treben med stag'], ['eiffel', 'Trådunderstell'], ['metal-thin', 'Tynne metallben'], ['wood-taper', 'Treben (skrå)'], ['sled', 'Medeben'], ['swivel-star', 'Dreiefot med kryss']] },
      seatH: { type: 'number', min: 0.4, max: 0.5, step: 0.01, label: 'Setehøyde (m)' },
    },
    dimsRange: { w: [0.4, 0.68], d: [0.42, 0.65], h: [0.7, 0.95] },
    build: buildShellChair,
  }),
};
