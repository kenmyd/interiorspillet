// WALLKIT – the pure wall / floor / ceiling / window geometry of the house (notes/hele-huset-design.md §2.1), moved
// out of shell.js so the living room's shell (shell.js) and the other rooms (rooms.js) build with the same code.
// The living room's behaviour is unchanged: every function here is the shell's own, with optional extra arguments
// whose defaults give exactly the old result (floorY 0, no holes, planks along z).
//
// Wall-local frame used throughout: origin at the wall's start on the room-side face (at the wall's floor), +x along
// the wall, +y up, +z = room normal (into the room); the wall occupies z ∈ [−thickness, 0]. Opening-local frame: origin
// at the bottom centre of the hole on the room face (y = sill), +x = right seen from the room, +z = into the room.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { extrudeWall, basis, MeshBatcher, place } from '../world/buildKit.js';
import { splitTriangles, liftTriangles, stepFaces } from './roofgeom.js';
import { insetPolygon, spanAtX, spanAtY } from './windowshape.js';

export const UP = new THREE.Vector3(0, 1, 0);
const EPS = 1e-4;

const v2 = (x, y) => new THREE.Vector2(x, y);

/**
 * Right-handed frame of a wall: x = dir, y = up, z = dir × up (must equal the wanted normal; flip dir otherwise), at
 * the wall's start on the room face. floorY lifts it onto the wall's floor (world y; the living room's is 0).
 * @param {object} w  a layout wall
 * @param {number} [floorY=0]
 */
export function wallMatrix(w, floorY = 0) {
  return basis(w.dir3, UP, w.normal3, new THREE.Vector3(w.start.x, floorY, w.start.y));
}

/** Frame of an opening (origin = bottom centre of the hole on the room face; y overrides its height). */
export function openingMatrix(o, y = null) {
  const origin = o.bottomCenter.clone();
  if (y != null) origin.y = y;
  return basis(o.right, UP, o.normal, origin);
}

/** Copy of one material group of a non-indexed geometry (null when empty). */
export function groupGeometry(g, materialIndex) {
  const gr = g.groups.find((x) => x.materialIndex === materialIndex);
  if (!gr || !gr.count) return null;
  const sub = new THREE.BufferGeometry();
  for (const [name, attr] of Object.entries(g.attributes)) {
    const s = attr.itemSize;
    sub.setAttribute(name, new THREE.BufferAttribute(attr.array.slice(gr.start * s, (gr.start + gr.count) * s), s));
  }
  return sub;
}

/**
 * Extruded layer of a wall in wall-local coordinates with mitred ends.
 * @param {object} o
 * @param {number} o.L                       wall length
 * @param {number} o.bottom                  bottom edge height
 * @param {Array<[number, number]>} o.top    top edge [[u, y], …] from u = 0 to u = L (steps allowed)
 * @param {Array<{x0,x1,y1,y1b?,pts?}>} o.notches  openings cut from the bottom edge (doors); pts: a shaped window's
 *                                           top from x0 to x1 [[x, y], …] (notes/vindusmodeller.md shape)
 * @param {Array<{x0,x1,y0,y1,y1b?,pts?,corner?}>} o.holes openings inside (windows); y1b: a sloped top, y1 at x0 and y1b
 *                                           at x1 (notes/vindusmodeller.md topSlope); pts: a shaped window's outline;
 *                                           corner: a corner window – a hole reaching an end of the layer is cut out
 *                                           of that end (y0 … y1, along the mitre)
 * @param {number} o.z0 @param {number} o.z1 layer depth range (z1 > z0, both ≤ 0)
 * @param {number} o.kStart @param {number} o.kEnd  mitre factors: x += ∓k·depth at the ends (see buildWalls)
 * @returns {THREE.BufferGeometry} groups 0 back (−z), 1 front (+z), 2 sides
 */
export function wallLayer({ L, bottom, top, notches = [], holes = [], z0, z1, kStart = 0, kEnd = 0 }) {
  const pts = [];
  const push = (x, y) => {
    const p = pts[pts.length - 1];
    if (!p || Math.abs(p.x - x) > 1e-6 || Math.abs(p.y - y) > 1e-6) pts.push(v2(x, y));
  };
  const ns = notches.filter((n) => n.x1 > EPS && n.x0 < L - EPS).sort((a, b) => a.x0 - b.x0);
  let startNotch = null;
  let endNotch = null;
  if (ns.length && ns[0].x0 <= EPS) startNotch = ns.shift();
  if (ns.length && ns[ns.length - 1].x1 >= L - EPS) endNotch = ns.pop();
  // (a sloped top: y1 at x0, y1b at x1; a notch over an end of the layer has its top there by the same line)
  const topOf = (n, x) => (n.y1b == null || n.x1 - n.x0 < EPS ? n.y1 : n.y1 + ((n.y1b - n.y1) * (x - n.x0)) / (n.x1 - n.x0));
  if (startNotch) {
    push(0, topOf(startNotch, 0));
    push(startNotch.x1, topOf(startNotch, startNotch.x1));
    push(startNotch.x1, bottom);
  } else push(0, bottom);
  for (const n of ns) {
    push(n.x0, bottom);
    if (n.pts) for (const [x, y] of n.pts) push(x, y);
    else {
      push(n.x0, n.y1);
      push(n.x1, n.y1b ?? n.y1);
    }
    push(n.x1, bottom);
  }
  // corner windows: a hole flagged corner that reaches an end is cut out of that end (the mitre shift below moves its
  // corners at the end onto the mitre, so the two walls of the corner leave it open between them)
  const endCuts = holes.filter((h) => h.corner && h.x1 >= L - EPS).sort((a, b) => a.y0 - b.y0);
  const startCuts = holes.filter((h) => h.corner && h.x0 <= EPS && !endCuts.includes(h)).sort((a, b) => b.y0 - a.y0);
  if (endNotch) {
    push(endNotch.x0, bottom);
    push(endNotch.x0, topOf(endNotch, endNotch.x0));
    push(L, topOf(endNotch, L));
  } else {
    push(L, bottom);
    for (const c of endCuts) {
      push(L, c.y0);
      push(c.x0, c.y0);
      push(c.x0, c.y1);
      push(L, c.y1);
    }
  }
  for (let i = top.length - 1; i >= 0; i--) push(Math.max(0, Math.min(L, top[i][0])), top[i][1]);
  if (!startNotch) {
    for (const c of startCuts) {
      push(0, c.y1);
      push(c.x1, c.y1);
      push(c.x1, c.y0);
      push(0, c.y0);
    }
  }
  if (pts.length > 2 && pts[0].distanceTo(pts[pts.length - 1]) < 1e-6) pts.pop();
  const shape = new THREE.Shape(pts);
  for (const h of holes) {
    if (endCuts.includes(h) || startCuts.includes(h)) continue;
    shape.holes.push(new THREE.Path(h.pts ? h.pts.map(([x, y]) => v2(x, y)) : [v2(h.x0, h.y0), v2(h.x0, h.y1), v2(h.x1, h.y1b ?? h.y1), v2(h.x1, h.y0)]));
  }
  // a layer with a shaped hole or a corner cut (notes/vindusmodeller.md) has each cap triangulated after its own mitre
  // shift: shifting the ends of one triangulation (below) can fold the thin triangles that fan from an end to a
  // many-sided hole over each other. Every other layer is built as before.
  const shaped = holes.some((h) => h.pts || h.corner) || ns.some((n) => n.pts);
  const g = shaped ? extrudeMitred(pts, shape.holes.map((h) => h.getPoints()), z0, z1, (x, d) => (x < EPS ? x - kStart * d : x > L - EPS ? x + kEnd * d : x)) : extrudeWall(shape, z1 - z0, z0);
  const pos = g.attributes.position;
  if (!shaped) {
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const d = -pos.getZ(i);
      if (x < EPS) pos.setX(i, x - kStart * d);
      else if (x > L - EPS) pos.setX(i, x + kEnd * d);
    }
  }
  pos.needsUpdate = true;
  g.computeVertexNormals();
  // UVs in metres from the (mitred) positions – the mitre shift would otherwise shear the caps' texture across
  // their long triangles: faces of the wall planes (u along the wall, v up), ends (depth, up), top/bottom (u, depth)
  const nrm = g.attributes.normal;
  const uv = g.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    const ax = Math.abs(nrm.getX(i)), ay = Math.abs(nrm.getY(i)), az = Math.abs(nrm.getZ(i));
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    if (az >= ax && az >= ay) uv.setXY(i, x, y);
    else if (ax >= ay) uv.setXY(i, -z, y);
    else uv.setXY(i, x, -z);
  }
  uv.needsUpdate = true;
  return g;
}

/**
 * The extrusion of a wall layer from z0 to z1 (z1 > z0, both ≤ 0) with its mitre shift applied before triangulating:
 * each cap triangulated on its own shifted outline (shift(x, depth) → x), the sides between them. Groups as
 * extrudeWall: 0 back (−z), 1 front (+z), 2 sides; non-indexed, with a uv attribute for the caller to fill.
 * @param {THREE.Vector2[]} outline  the layer's outline
 * @param {THREE.Vector2[][]} holes
 */
function extrudeMitred(outline, holes, z0, z1, shift) {
  const ring = (P, cw) => {
    const r = P.map((q) => v2(q.x, q.y));
    if (r.length > 2 && r[0].distanceTo(r[r.length - 1]) < 1e-9) r.pop();
    if (THREE.ShapeUtils.isClockWise(r) !== cw) r.reverse();
    return r;
  };
  // the outline counter-clockwise, the holes clockwise: the material lies left of every edge
  const outer = ring(outline, false);
  const hs = holes.map((h) => ring(h, true)).filter((h) => h.length >= 3);
  const pos = [];
  const g = new THREE.BufferGeometry();
  for (const [z, face] of [[z0, -1], [z1, 1]]) {
    const start = pos.length / 3;
    const d = -z;
    const C = outer.map((q) => v2(shift(q.x, d), q.y));
    const H = hs.map((h) => h.map((q) => v2(shift(q.x, d), q.y)));
    const all = [...C, ...H.flat()];
    for (const t of THREE.ShapeUtils.triangulateShape(C, H)) {
      let [a, b, c] = t.map((i) => all[i]);
      const cr = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
      if (cr > 0 !== face > 0) [b, c] = [c, b];
      pos.push(a.x, a.y, z, b.x, b.y, z, c.x, c.y, z);
    }
    g.addGroup(start, pos.length / 3 - start, face > 0 ? 1 : 0);
  }
  const sides = pos.length / 3;
  for (const R of [outer, ...hs]) {
    for (let i = 0; i < R.length; i++) {
      const a = R[i], b = R[(i + 1) % R.length];
      const a0 = [shift(a.x, -z0), a.y, z0], b0 = [shift(b.x, -z0), b.y, z0];
      const a1 = [shift(a.x, -z1), a.y, z1], b1 = [shift(b.x, -z1), b.y, z1];
      pos.push(...a0, ...b0, ...b1, ...a0, ...b1, ...a1);
    }
  }
  g.addGroup(sides, pos.length / 3 - sides, 2);
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((pos.length / 3) * 2), 2));
  return g;
}

/**
 * Notches (door holes cut from the bottom edge) side by side merged into one (an outer door between two sidelights):
 * wallLayer would otherwise trace a zero-width spike down to the bottom edge between them.
 * @param {Array<{x0,x1,y1}>} notches
 * @returns {Array<{x0,x1,y1}>}
 */
export function mergeNotches(notches) {
  const ns = [...notches].sort((a, b) => a.x0 - b.x0).map((n) => ({ ...n }));
  const out = [];
  for (const n of ns) {
    const p = out[out.length - 1];
    if (p && n.x0 <= p.x1 + 1e-4 && Math.abs(n.y1 - p.y1) < 1e-4 && n.y1b == null && p.y1b == null && !n.pts && !p.pts) p.x1 = Math.max(p.x1, n.x1);
    else out.push(n);
  }
  return out;
}

/** Piecewise-linear [[u, h], …] lookup (steps: two points with the same u, the left segment's value at the step). */
export function profileAt(profile, u) {
  if (!profile.length) return 0;
  if (u <= profile[0][0]) return profile[0][1];
  for (let i = 0; i < profile.length - 1; i++) {
    const [u0, h0] = profile[i];
    const [u1, h1] = profile[i + 1];
    if (u1 - u0 < 1e-9) continue;
    if (u <= u1 + 1e-9) return h0 + ((h1 - h0) * (u - u0)) / (u1 - u0);
  }
  return profile[profile.length - 1][1];
}

/**
 * The part a … b of a top profile, shifted to start at 0 (steps inside are kept; at a step on the cut the side inside
 * the part counts).
 * @param {Array<[number, number]>} profile
 * @param {number} a
 * @param {number} b
 * @returns {Array<[number, number]>}
 */
export function profileSlice(profile, a, b) {
  const out = [[0, profileAt(profile, a + 1e-6)]];
  for (const [u, h] of profile) if (u > a + 1e-6 && u < b - 1e-6) out.push([u - a, h]);
  out.push([b - a, profileAt(profile, b - 1e-6)]);
  return out;
}

/** Four boxes forming a rectangular ring (outer size w × h centred on x = cx, bottom y0) in a batch frame. */
export function ring(f, cx, y0, w, h, side, topW, bottomW, z0, z1, material, o = {}) {
  const d = z1 - z0;
  const zc = (z0 + z1) / 2;
  if (topW > 0) f.box(w, topW, d, cx, y0 + h - topW / 2, zc, material, o);
  if (bottomW > 0) f.box(w, bottomW, d, cx, y0 + bottomW / 2, zc, material, o);
  const hh = h - topW - bottomW;
  if (hh > 0 && side > 0) {
    f.box(side, hh, d, cx - w / 2 + side / 2, y0 + bottomW + hh / 2, zc, material, o);
    f.box(side, hh, d, cx + w / 2 - side / 2, y0 + bottomW + hh / 2, zc, material, o);
  }
}

/** Even-odd point in polygon ([x, z] or Vector2 points). */
function inside(x, z, poly) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const ax = poly[i].x ?? poly[i][0], az = poly[i].y ?? poly[i][1];
    const bx = poly[j].x ?? poly[j][0], bz = poly[j].y ?? poly[j][1];
    if (az > z !== bz > z && x < ((bx - ax) * (z - az)) / (bz - az) + ax) c = !c;
  }
  return c;
}

/**
 * A rectilinear polygon minus rectilinear holes as merged rectangles [x0, z0, x1, z1] (grid of all their corner
 * coordinates, a cell is in when its centre is inside the polygon and in no hole; runs along x merged per band, equal
 * bands merged). Robust where earcut is not: a hole that touches the outline (the stairwell along the shaft walls).
 * @returns {Array<[number, number, number, number]>}
 */
export function rectCells(poly, holes = []) {
  const P = poly.map((p) => [p.x ?? p[0], p.y ?? p[1]]);
  const Hs = holes.filter((h) => h?.length >= 3).map((h) => h.map((p) => [p.x ?? p[0], p.y ?? p[1]]));
  const r4 = (v) => Math.round(v * 1e4) / 1e4;
  const X = [...new Set([...P, ...Hs.flat()].map((p) => r4(p[0])))].sort((a, b) => a - b);
  const Z = [...new Set([...P, ...Hs.flat()].map((p) => r4(p[1])))].sort((a, b) => a - b);
  const on = (x, z) => inside(x, z, P) && !Hs.some((h) => inside(x, z, h));
  const bands = [];
  for (let j = 0; j < Z.length - 1; j++) {
    const zc = (Z[j] + Z[j + 1]) / 2;
    const runs = [];
    let s0 = null;
    for (let i = 0; i < X.length - 1; i++) {
      const v = on((X[i] + X[i + 1]) / 2, zc);
      if (v && s0 === null) s0 = X[i];
      if (!v && s0 !== null) {
        runs.push([s0, X[i]]);
        s0 = null;
      }
    }
    if (s0 !== null) runs.push([s0, X[X.length - 1]]);
    bands.push({ z0: Z[j], z1: Z[j + 1], runs });
  }
  const key = (b) => b.runs.map((r) => r.join(':')).join('|');
  const out = [];
  for (let j = 0; j < bands.length; j++) {
    const b = bands[j];
    if (!b.runs.length) continue;
    let z1 = b.z1;
    while (j + 1 < bands.length && key(bands[j + 1]) === key(b)) z1 = bands[++j].z1;
    for (const [x0, x1] of b.runs) out.push([x0, b.z0, x1, z1]);
  }
  return out;
}

/** Is every edge of the polygon on a world axis? */
const rectilinear = (poly) => poly.every((p, i) => {
  const q = poly[(i + 1) % poly.length];
  return Math.abs((p.x ?? p[0]) - (q.x ?? q[0])) < 1e-6 || Math.abs((p.y ?? p[1]) - (q.y ?? q[1])) < 1e-6;
});

/** Horizontal quads of rectCells at y(x, z), facing up (floor) or down (ceiling). */
function cellsGeometry(cells, yAt, up) {
  const pos = [];
  const nrm = [];
  for (const [x0, z0, x1, z1] of cells) {
    const a = [x0, yAt(x0, z0), z0], b = [x1, yAt(x1, z0), z0], c = [x1, yAt(x1, z1), z1], d = [x0, yAt(x0, z1), z1];
    // up: counter-clockwise seen from above (+y) = a, d, c / a, c, b
    const tris = up ? [a, d, c, a, c, b] : [a, b, c, a, c, d];
    for (const v of tris) pos.push(...v);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  for (let i = 0; i < pos.length / 3; i++) nrm.push(0, up ? 1 : -1, 0);
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((pos.length / 3) * 2), 2));
  return g;
}

/**
 * Floor (x, z polygon) → horizontal ShapeGeometry at y with UVs in metres: boards 'z' (default, the living room's
 * planks) u = z (along the planks), v = x; boards 'x' u = x, v = z. holes: polygons cut out (the stairwell).
 * @param {Array} poly   Vector2(x, z) or [x, z]
 * @param {number} [y=0]
 * @param {{ holes?: Array<Array>, boards?: 'x'|'z' }} [o]
 */
export function floorGeometry(poly, y = 0, { holes = [], boards = 'z' } = {}) {
  const hs = holes.filter((h) => h?.length >= 3);
  let g;
  if (hs.length && rectilinear(poly) && hs.every(rectilinear)) g = cellsGeometry(rectCells(poly, hs), () => y, true);
  else {
    const pt = (p) => v2(p.x ?? p[0], -(p.y ?? p[1]));
    const shape = new THREE.Shape(poly.map(pt));
    for (const h of hs) shape.holes.push(new THREE.Path(h.map(pt)));
    g = new THREE.ShapeGeometry(shape);
    g.rotateX(-Math.PI / 2);
    g.translate(0, y, 0);
  }
  const pos = g.attributes.position;
  const uv = g.attributes.uv;
  if (boards === 'x') for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i), pos.getZ(i));
  else for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getZ(i), pos.getX(i));
  return g;
}

/**
 * 2D triangles ([[x, z] × 3]) of a polygon with holes (points as Vector2 or [x, z]).
 * @returns {Array<Array<[number, number]>>}
 */
export function polygonTriangles(poly, holes = []) {
  const pt = (p) => v2(p.x ?? p[0], p.y ?? p[1]);
  let contour = poly.map(pt);
  if (THREE.ShapeUtils.isClockWise(contour)) contour = contour.reverse();
  const hs = holes.filter((h) => h?.length >= 3).map((h) => {
    const c = h.map(pt);
    return THREE.ShapeUtils.isClockWise(c) ? c : c.reverse();
  });
  const all = [...contour, ...hs.flat()];
  return THREE.ShapeUtils.triangulateShape(contour, hs).map((f) => f.map((i) => [all[i].x, all[i].y]));
}

/**
 * A ceiling under a roof (layout ceiling.surface, home/roofgeom.js): the polygon minus its holes cut along the
 * surface's folds, each piece on its own plane, facing down, plus the vertical faces where the surface jumps inside the
 * polygon (a dormer's sides, facing into the dormer). UVs (x, z) metres on the sloped faces, (along, y) on the steps.
 */
export function surfaceGeometry(poly, holes, surface) {
  const tris = liftTriangles(splitTriangles(polygonTriangles(poly, holes), surface.lines), surface.planeAt);
  const pos = [];
  const uv = [];
  for (const t of tris) {
    // facing down: (b − a) × (c − a) has y < 0
    const [a, b, c] = t;
    const ny = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
    for (const p of ny < 0 ? [a, b, c] : [a, c, b]) pos.push(p[0], p[1], p[2]), uv.push(p[0], p[2]);
  }
  const P = poly.map((p) => [p.x ?? p[0], p.y ?? p[1]]);
  for (const q of stepFaces(surface.steps || [], P, surface)) {
    const along = (p) => Math.hypot(p[0] - q[0][0], p[2] - q[0][2]);
    for (const k of [0, 1, 2, 0, 2, 3]) pos.push(...q[k]), uv.push(along(q[k]), q[k][1]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}

/**
 * Ceiling polygon → downward-facing geometry, y from heightAt(x, z) (world), UVs (x, z) metres; holes cut out (the
 * stairwell in the ceiling of the level below). With `surface` (a ceiling under a roof, layout ceiling.surface) the
 * piecewise planar surfaceGeometry.
 */
export function ceilingGeometry(poly, heightAt, holes = [], surface = null) {
  const hs = holes.filter((h) => h?.length >= 3);
  if (surface) return surfaceGeometry(poly, hs, surface);
  let g;
  if (hs.length && rectilinear(poly) && hs.every(rectilinear)) g = cellsGeometry(rectCells(poly, hs), heightAt, false);
  else {
    const pt = (p) => v2(p.x ?? p[0], p.y ?? p[1]);
    const shape = new THREE.Shape(poly.map(pt));
    for (const h of hs) shape.holes.push(new THREE.Path(h.map(pt)));
    g = new THREE.ShapeGeometry(shape);
    g.rotateX(Math.PI / 2);
  }
  const pos = g.attributes.position;
  const uv = g.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    pos.setY(i, heightAt(x, z));
    uv.setXY(i, x, z);
  }
  g.computeVertexNormals();
  return g;
}

/**
 * Window glass: only the specular (environment reflection with Fresnel + light highlights) is added to what lies
 * behind, which is dimmed by a constant, slightly green-grey transmission – reads as glass, costs one draw, no
 * transmission pass. Shared by every pane (do not dispose per window).
 * @returns {THREE.MeshStandardMaterial}
 */
export function glassMaterial() {
  if (glassMaterial._m) return glassMaterial._m;
  const m = new THREE.MeshStandardMaterial({
    color: 0x000000,
    roughness: 0.035,
    metalness: 0,
    envMapIntensity: 1.1,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusConstantColorFactor,
    blendSrcAlpha: THREE.ZeroFactor,
    blendDstAlpha: THREE.OneFactor,
  });
  // transmission ≈ (0.88, 0.91, 0.895): double glazing, faintly green-grey
  m.blendColor.setRGB(0.12, 0.09, 0.105);
  m.name = 'window-glass';
  m.userData = { cached: true, kind: 'glass-window' };
  glassMaterial._m = m;
  return m;
}

/**
 * Frosted (sandblasted) glass of the bathroom window: a milky, slightly translucent pane – the light outside shows as
 * a soft glow, nothing behind it is recognisable. Shared (do not dispose per window).
 * @returns {THREE.MeshStandardMaterial}
 */
export function frostedGlassMaterial() {
  if (frostedGlassMaterial._m) return frostedGlassMaterial._m;
  const m = new THREE.MeshStandardMaterial({
    color: '#dfe3e3',
    roughness: 0.55,
    metalness: 0,
    transparent: true,
    opacity: 0.86,
    depthWrite: false,
    side: THREE.DoubleSide,
    envMapIntensity: 0.6,
  });
  m.name = 'window-glass-frosted';
  m.userData = { cached: true, kind: 'glass-frosted' };
  frostedGlassMaterial._m = m;
  return m;
}

/**
 * The frame stands this far in from the sides and the top of its hole (2.5 mm narrower than the hole): with the frame
 * exactly as wide as the hole its sides lay in the planes of the reveal (planbygger F3/F4/F6, request 14). It still
 * stands on the sill.
 */
export const FRAME_INSET = 0.00125;
/** Hinge sides of an opening sash, seen from the room. */
const HINGES = new Set(['top', 'bottom', 'left', 'right']);
/** Most panes along one side of a sash. */
const MAX_PANES = 12;

/** [cols, rows] of a panes entry ([c, r] or { cols, rows }), whole numbers 1 … MAX_PANES; [1, 1] without one. */
export function panesOf(p) {
  const n = (v) => Math.max(1, Math.min(MAX_PANES, Math.round(Number.isFinite(v) ? v : 1)));
  if (Array.isArray(p)) return [n(p[0]), n(p[1])];
  if (p && typeof p === 'object') return [n(p.cols), n(p.rows)];
  return [1, 1];
}

/**
 * The fields of a window in its local frame (x centred on the hole, y from the sill): one per entry of o.sashes –
 * `from` … `to` of the width (left → right seen from the room) and `bottom` … `top` of the height, as fractions – or
 * one fixed field without sashes. `outer` says which sides lie on the window's own edge (the rest meet a post or a
 * transom); `panes` is the sash's own, else the window's (o.panes), else [1, 1].
 * @returns {Array<{ x0, x1, y0, y1, outer: { l, r, b, t }, opening: boolean, hinge: string, panes: [number, number] }>}
 */
export function windowSashes(o) {
  const list = (o.sashes || []).filter((s) => s && typeof s === 'object');
  const W = o.width;
  const H = o.height;
  const fr = (v, d) => Math.min(1, Math.max(0, Number.isFinite(v) ? v : d));
  return (list.length ? list : [{}])
    .map((s) => {
      const a = fr(s.from, 0), b = fr(s.to, 1), c = fr(s.bottom, 0), d = fr(s.top, 1);
      return {
        x0: -W / 2 + a * W,
        x1: -W / 2 + b * W,
        y0: c * H,
        y1: d * H,
        outer: { l: a < 1e-3, r: b > 1 - 1e-3, b: c < 1e-3, t: d > 1 - 1e-3 },
        opening: !!s.opening,
        hinge: HINGES.has(s.hinge) ? s.hinge : 'top',
        panes: panesOf(s.panes ?? o.panes),
      };
    })
    .filter((c) => c.x1 - c.x0 > 0.02 && c.y1 - c.y0 > 0.02);
}

/** Four boxes between an outer and an inner rectangle [x0, y0, x1, y1] (inner inside outer): a ring whose sides may differ. */
function rectRing(f, outer, inner, z0, z1, material, o) {
  const [ox0, oy0, ox1, oy1] = outer;
  const [ix0, iy0, ix1, iy1] = inner;
  const d = z1 - z0;
  const zc = (z0 + z1) / 2;
  const w = ox1 - ox0;
  const cx = (ox0 + ox1) / 2;
  if (oy1 - iy1 > 1e-6) f.box(w, oy1 - iy1, d, cx, (iy1 + oy1) / 2, zc, material, o);
  if (iy0 - oy0 > 1e-6) f.box(w, iy0 - oy0, d, cx, (oy0 + iy0) / 2, zc, material, o);
  const hh = iy1 - iy0;
  if (hh <= 1e-6) return;
  if (ix0 - ox0 > 1e-6) f.box(ix0 - ox0, hh, d, (ox0 + ix0) / 2, (iy0 + iy1) / 2, zc, material, o);
  if (ox1 - ix1 > 1e-6) f.box(ox1 - ix1, hh, d, (ix1 + ox1) / 2, (iy0 + iy1) / 2, zc, material, o);
}
const inset = (r, l, b = l, rt = l, t = l) => [r[0] + l, r[1] + b, r[2] - rt, r[3] - t];

/**
 * A prism over a convex quad [[x, y] × 4] (either winding) from z0 to z1, queued in a batch frame (box UVs): the
 * sloped pieces of a window under a sloped top (notes/vindusmodeller.md topSlope).
 */
export function quadPrism(f, pts, z0, z1, material, o = {}) {
  const g = new THREE.ExtrudeGeometry(new THREE.Shape(pts.map(([x, y]) => v2(x, y))), { depth: z1 - z0, bevelEnabled: false, steps: 1 });
  g.translate(0, 0, z0);
  f.add(g, material, { boxUV: true, ...o });
  g.dispose();
}
/**
 * A ring of prisms between a convex polygon A and its inset B (corresponding corners, [x, y]) from z0 to z1: the karm,
 * bead and gasket of a shaped window (notes/vindusmodeller.md shape), one prism per edge.
 */
export function polyRing(f, A, B, z0, z1, material, o = {}) {
  for (let i = 0; i < A.length; i++) {
    const j = (i + 1) % A.length;
    quadPrism(f, [A[i], A[j], B[j], B[i]], z0, z1, material, o);
  }
}
/**
 * A prism over a convex footprint [[x, z], …] in a batch frame from y0 to y1 (box UVs): the mitred ends of a corner
 * window's sill board and the halves of its corner post.
 */
export function prismY(f, pts, y0, y1, material, o = {}) {
  const g = new THREE.ExtrudeGeometry(new THREE.Shape(pts.map(([x, z]) => v2(x, -z))), { depth: y1 - y0, bevelEnabled: false, steps: 1 });
  // the shape's (x, −z) plane turned up: (X, Y, Z) → (X, Z, −Y), then lifted to y0
  g.rotateX(-Math.PI / 2);
  g.translate(0, y0, 0);
  f.add(g, material, { boxUV: true, ...o });
  g.dispose();
}

/**
 * A field of a window as a trapezoid { x0, x1, y0, yl, yr }: the bottom level at y0, the top a line from (x0, yl) to
 * (x1, yr) – a rectangle when yl = yr. trapTop is the top line (extended past the ends), trapInset moves the sides in
 * by l, r, the bottom up by b and the top down by t square to it (a rectangle gives exactly inset()'s numbers).
 */
const trapTop = (q, x) => q.yl + ((q.yr - q.yl) * (x - q.x0)) / (q.x1 - q.x0);
function trapInset(q, l, b = l, r = l, t = l) {
  const k = (q.yr - q.yl) / (q.x1 - q.x0);
  const dt = t * Math.sqrt(1 + k * k);
  const x0 = q.x0 + l, x1 = q.x1 - r;
  return { x0, x1, y0: q.y0 + b, yl: trapTop(q, x0) - dt, yr: trapTop(q, x1) - dt };
}
const isRect = (q) => Math.abs(q.yl - q.yr) < 1e-9;
/** A ring between an outer and an inner trapezoid: rectRing's boxes for rectangles, else a sloped head over two jambs. */
function quadRing(f, outer, inner, z0, z1, material, o) {
  if (isRect(outer) && isRect(inner)) return rectRing(f, [outer.x0, outer.y0, outer.x1, outer.yl], [inner.x0, inner.y0, inner.x1, inner.yl], z0, z1, material, o);
  const it = (x) => trapTop(inner, x), ot = (x) => trapTop(outer, x);
  if (inner.y0 - outer.y0 > 1e-6) f.box(outer.x1 - outer.x0, inner.y0 - outer.y0, z1 - z0, (outer.x0 + outer.x1) / 2, (outer.y0 + inner.y0) / 2, (z0 + z1) / 2, material, o);
  quadPrism(f, [[outer.x0, it(outer.x0)], [outer.x1, it(outer.x1)], [outer.x1, ot(outer.x1)], [outer.x0, ot(outer.x0)]], z0, z1, material, o);
  if (inner.x0 - outer.x0 > 1e-6) quadPrism(f, [[outer.x0, inner.y0], [inner.x0, inner.y0], [inner.x0, it(inner.x0)], [outer.x0, it(outer.x0)]], z0, z1, material, o);
  if (outer.x1 - inner.x1 > 1e-6) quadPrism(f, [[inner.x1, inner.y0], [outer.x1, inner.y0], [outer.x1, it(outer.x1)], [inner.x1, it(inner.x1)]], z0, z1, material, o);
}

/**
 * Builds the frame / sash / glass / board of one opening in its local frame (origin bottom centre of the hole on the
 * room face at y = sill): a glazed terrace door's karm and threshold, or a window of one or more fields (o.sashes):
 * a top-, bottom- or side-hung sash (karm + sash with a shadow gap and a handle) or fixed glazing (karm + glazing
 * bead), posts and transoms where fields meet, glazing bars (sprosser) where a field has more than one pane. The
 * exterior window sill (vannbrett) goes into `exteriorBatch`. A window of one field is built as before.
 * @param {object} o        a layout window (or terrace door) opening
 * @param {boolean} isDoor  terrace door
 * @param {object} k
 * @param {object} k.M      materials: frame, gasket, hardware, threshold, sill, trim, glass (+ bars: the glazing bars,
 *                          default frame)
 * @param {MeshBatcher} k.exteriorBatch
 * @param {Array} k.batchers  { geometries } of the window kit is pushed here (disposed with the builder)
 * @param {(x: any) => any} k.keep  registers a geometry / material to dispose
 * @param {THREE.Matrix4} [k.matrix]  the opening's frame (default openingMatrix(o)) – a skylight lies in its ceiling
 * @returns {{ group: THREE.Group, glass: THREE.Mesh|null, pickMeshes: THREE.Mesh[], sillY: number|null }}
 */
export function buildWindow(o, isDoor, { M, exteriorBatch, batchers, keep, matrix = null }) {
  const kit = new MeshBatcher(`window:${o.id}`);
  const f = kit.frame(new THREE.Matrix4());
  const om = matrix ?? openingMatrix(o);
  const W = o.width;
  const H = o.height;
  const rd = o.revealDepth;
  const fd = o.frame?.depth ?? 0.07;
  const fw = o.frame?.width ?? 0.07;
  const zF = -rd; // room-side face of the frame
  const zB = -rd - fd; // outside face
  let glass = null;
  let glassRect = null;
  const nf = { collide: false };
  const gk = { collide: false, castShadow: false };
  if (isDoor) {
    // karm (jambs + head) around the door leaf; the leaf itself is built on the Door's pivot
    const fk = 0.055;
    f.box(fk, H, fd, -W / 2 + fk / 2, H / 2, (zF + zB) / 2, M.frame, nf);
    f.box(fk, H, fd, W / 2 - fk / 2, H / 2, (zF + zB) / 2, M.frame, nf);
    f.box(W - 2 * fk, fk, fd, 0, H - fk / 2, (zF + zB) / 2, M.frame, nf);
    // aluminium threshold sill under the leaf and the light oak threshold across the reveal floor
    f.box(W, 0.018, fd + 0.03, 0, 0.009, zB + (fd + 0.03) / 2, M.frame, nf);
    f.box(W, 0.012, rd, 0, 0.006, -rd / 2, M.threshold, nf);
  } else if (o.outline) {
    // a shaped window (layout opening.outline, notes/vindusmodeller.md shape): fixed glazing in a karm along the
    // outline (karm, bead, gasket: one prism per edge), posts and transoms where o.sashes divide it, glazing bars
    // clipped to the glass
    const P = o.outline;
    const fk = Math.max(0.03, fw * 0.62);
    const fb = Math.max(0.015, fw - fk);
    const K = insetPolygon(P, fk);
    polyRing(f, insetPolygon(P, FRAME_INSET), K, zB, zF, M.frame, nf);
    const G = insetPolygon(K, fb);
    polyRing(f, K, G, zF - 0.034, zF - 0.007, M.frame, nf);
    polyRing(f, G, insetPolygon(G, 0.004), zF - 0.041, zF - 0.032, M.gasket, gk);
    const zG = zF - 0.04;
    const fin = (v) => typeof v === 'number' && Number.isFinite(v) && v > 0.01 && v < 0.99;
    const xs = new Set();
    const ys = new Set();
    for (const sa of (o.sashes || []).filter((x) => x && typeof x === 'object')) {
      for (const v of [sa.from, sa.to]) if (fin(v)) xs.add(Math.round(v * 1e4) / 1e4);
      for (const v of [sa.bottom, sa.top]) if (fin(v)) ys.add(Math.round(v * 1e4) / 1e4);
    }
    // a post's / transom's ends reach 2 mm into the karm (past its sloped side), 2 mm shallower than the karm: none of
    // its faces in the karm's or the bead's planes
    const mull = o.frame?.mullion ?? Math.max(0.03, fw * 0.6);
    const reach = (spans) => {
      const ok = spans.filter(Boolean);
      return ok.length ? [Math.min(...ok.map((q) => q[0])) - 0.002, Math.max(...ok.map((q) => q[1])) + 0.002] : null;
    };
    for (const fx of xs) {
      const x = -W / 2 + fx * W;
      const sp = reach([spanAtX(K, x - mull / 2), spanAtX(K, x + mull / 2)]);
      if (sp) f.box(mull, sp[1] - sp[0], fd - 0.004, x, (sp[0] + sp[1]) / 2, (zB + zF) / 2, M.frame, nf);
    }
    for (const fy of ys) {
      const y = fy * H;
      const sp = reach([spanAtY(K, y - mull / 2), spanAtY(K, y + mull / 2)]);
      if (sp) f.box(sp[1] - sp[0], mull, fd - 0.006, (sp[0] + sp[1]) / 2, y, (zB + zF) / 2, M.frame, nf);
    }
    // glazing bars (o.panes over the whole window), through the glass, the cross bars 2 mm shallower
    const [cols, rows] = panesOf(o.panes);
    const gx0 = Math.min(...G.map((q) => q[0])), gx1 = Math.max(...G.map((q) => q[0]));
    const gy0 = Math.min(...G.map((q) => q[1])), gy1 = Math.max(...G.map((q) => q[1]));
    const bw = Math.min(o.bars?.width ?? 0.024, (gx1 - gx0) / (3 * cols), (gy1 - gy0) / (3 * rows));
    for (let i = 1; i < cols; i++) {
      const x = gx0 + ((gx1 - gx0) * i) / cols;
      const sp = spanAtX(G, x);
      if (sp) f.box(bw, sp[1] - sp[0] + 0.01, 0.024, x, (sp[0] + sp[1]) / 2, zG, M.bars ?? M.frame, nf);
    }
    for (let j = 1; j < rows; j++) {
      const y = gy0 + ((gy1 - gy0) * j) / rows;
      const sp = spanAtY(G, y);
      if (sp) f.box(sp[1] - sp[0] + 0.01, bw, 0.02, (sp[0] + sp[1]) / 2, y, zG, M.bars ?? M.frame, nf);
    }
    // the glass reaches 5 mm into the bead
    glassRect = { poly: insetPolygon(G, -0.005), x: 0, y: 0, z: zG };
  } else {
    // a corner window (o.corner, notes/vindusmodeller.md): the frame runs on past the hole's end on the room face to
    // the mitre at the frame's depth (cornerK · revealDepth), where it stops at the corner post – no karm on that side
    const cs = o.corner === 'to' ? 1 : o.corner === 'from' ? -1 : 0;
    const ext = cs ? (o.cornerK ?? 1) * rd : 0;
    const fields = cs ? windowSashes({ ...o, width: W + ext }).map((c) => ({ ...c, x0: c.x0 + (cs * ext) / 2, x1: c.x1 + (cs * ext) / 2 })) : windowSashes(o);
    // one karm for the whole window: a window of one field keeps its own (narrow for a sash, wide for fixed glazing);
    // fields side by side share the sash's, the fixed ones make up for it with a wider bead. Where two fields meet,
    // each has half a post (o.frame.mullion).
    const fkOf = (open) => (open || fields.length > 1 ? Math.max(0.025, fw * 0.42) : Math.max(0.03, fw * 0.62));
    const half = (o.frame?.mullion ?? Math.max(0.03, fw * 0.6)) / 2;
    const bars = M.bars ?? M.frame;
    const rects = [];
    // a sloped top (layout opening.topSlope, notes/vindusmodeller.md): the line through the window's top, its high end
    // at H; the fields up to the top follow it (trapezoids), the rest stay rectangles
    let slope = Number.isFinite(o.topSlope) ? o.topSlope : 0;
    if (Math.abs(slope) * W > H - 0.1) slope = Math.sign(slope) * Math.max(0, H - 0.1) / W;
    const yTop = (x) => H - Math.abs(slope) * (slope > 0 ? W / 2 - x : x + W / 2);
    for (const c of fields) {
      const fk = fkOf(c.opening);
      const k = { l: c.outer.l ? fk : half, r: c.outer.r ? fk : half, b: c.outer.b ? fk : half, t: c.outer.t ? fk : half };
      // (the corner side: the post is the karm)
      const atCorner = (cs > 0 && c.outer.r) || (cs < 0 && c.outer.l);
      if (cs > 0 && c.outer.r) k.r = 0;
      if (cs < 0 && c.outer.l) k.l = 0;
      const sloped = Math.abs(slope) > 1e-6 && c.outer.t;
      const q = { x0: c.x0, x1: c.x1, y0: c.y0, yl: sloped ? yTop(c.x0) : c.y1, yr: sloped ? yTop(c.x1) : c.y1 };
      // the karm's outer rectangle: in from the hole on its sides and top (FRAME_INSET)
      const outerRect = trapInset(q, c.outer.l && !(atCorner && cs < 0) ? FRAME_INSET : 0, 0, c.outer.r && !(atCorner && cs > 0) ? FRAME_INSET : 0, c.outer.t ? FRAME_INSET : 0);
      const K = trapInset(q, k.l, k.b, k.r, k.t);
      quadRing(f, outerRect, K, zB, zF, M.frame, nf);
      let G; // the glass opening (what the sash or the bead leaves free)
      let zG;
      if (c.opening) {
        // sash with a shadow gap to the karm and a heavier bottom rail, the handle on the rail opposite the hinge
        const gap = 0.004;
        const fs = Math.max(0.03, fw - fk - gap);
        const fsB = fs + 0.012;
        quadRing(f, K, trapInset(K, gap), zB + 0.03, zF - 0.012, M.gasket, gk);
        const S = trapInset(K, gap);
        G = trapInset(S, fs, fsB, fs, fs);
        quadRing(f, S, G, zB + 0.012, zF + 0.002, M.frame, nf);
        quadRing(f, G, trapInset(G, 0.004), zB + 0.03, zF - 0.008, M.gasket, gk);
        zG = zF - 0.035;
        const sx = (S.x0 + S.x1) / 2;
        if (c.hinge === 'left' || c.hinge === 'right') {
          // side-hung: rose + lever pointing down in the middle of the stile opposite the hinge
          const hx = c.hinge === 'left' ? S.x1 - fs / 2 : S.x0 + fs / 2;
          const sy = (S.y0 + trapTop(S, sloped ? hx : sx)) / 2;
          f.box(0.034, 0.07, 0.012, hx, sy, zF + 0.008, M.hardware, nf);
          f.box(0.018, 0.12, 0.02, hx, sy - 0.045, zF + 0.026, M.hardware, nf);
        } else {
          // top-hung: on the bottom rail; bottom-hung: on the top rail
          const hy = c.hinge === 'bottom' ? trapTop(S, sx) - fs / 2 : S.y0 + fsB / 2;
          f.box(0.034, 0.07, 0.012, sx, hy + 0.005, zF + 0.008, M.hardware, nf);
          f.box(0.12, 0.018, 0.02, sx + 0.045, hy + 0.012, zF + 0.026, M.hardware, nf);
        }
      } else {
        // fixed glazing: karm + glazing bead, glass set ~4 cm into the frame (the rubber 1 mm deeper than the glass)
        const fb = Math.max(0.015, fw - fk);
        G = trapInset(K, fb);
        quadRing(f, K, G, zF - 0.034, zF - 0.007, M.frame, nf);
        quadRing(f, G, trapInset(G, 0.004), zF - 0.041, zF - 0.032, M.gasket, gk);
        zG = zF - 0.04;
      }
      // glazing bars (sprosser): through the glass, the cross bars 2 mm shallower (no faces in one plane where they cross)
      const [cols, rows] = c.panes;
      const gw = G.x1 - G.x0;
      const gh = (G.yl + G.yr) / 2 - G.y0;
      if ((cols > 1 || rows > 1) && gw > 0.02 && gh > 0.02) {
        const bw = Math.min(o.bars?.width ?? 0.024, gw / (3 * cols), gh / (3 * rows));
        if (!sloped) {
          for (let i = 1; i < cols; i++) f.box(bw, gh + 0.01, 0.024, G.x0 + (i * gw) / cols, (G.y0 + G.yl) / 2, zG, bars, nf);
          for (let j = 1; j < rows; j++) f.box(gw + 0.01, bw, 0.02, (G.x0 + G.x1) / 2, G.y0 + (j * gh) / rows, zG, bars, nf);
        } else {
          // under the slope: the posts reach the sloped glass edge, the cross bars stop where it comes down to them
          for (let i = 1; i < cols; i++) {
            const x = G.x0 + (i * gw) / cols, a = x - bw / 2, b = x + bw / 2;
            quadPrism(f, [[a, G.y0 - 0.005], [b, G.y0 - 0.005], [b, trapTop(G, b) + 0.005], [a, trapTop(G, a) + 0.005]], zG - 0.012, zG + 0.012, bars, nf);
          }
          const kG = (G.yr - G.yl) / gw;
          for (let j = 1; j < rows; j++) {
            const y = G.y0 + (j * gh) / rows;
            // where the top line is at the bar's top edge
            const xs = G.x0 + (y + bw / 2 - G.yl) / kG;
            const a = kG > 0 ? Math.max(G.x0 - 0.005, xs) : G.x0 - 0.005, b = kG > 0 ? G.x1 + 0.005 : Math.min(G.x1 + 0.005, xs);
            if (b - a > 0.02) f.box(b - a, bw, 0.02, (a + b) / 2, y, zG, bars, nf);
          }
        }
      }
      // the glass reaches 5 mm into the sash / bead
      if (!sloped) rects.push({ w: gw + 0.01, h: G.yl - G.y0 + 0.01, x: (G.x0 + G.x1) / 2, y: (G.y0 + G.yl) / 2, z: zG });
      else rects.push({ poly: [[G.x0 - 0.005, G.y0 - 0.005], [G.x1 + 0.005, G.y0 - 0.005], [G.x1 + 0.005, G.yr + 0.005], [G.x0 - 0.005, G.yl + 0.005]], x: 0, y: 0, z: zG });
    }
    if (rects.length === 1) glassRect = rects[0];
    else if (rects.length) glassRect = { parts: rects, z: rects[0].z };
    if (cs) {
      // this window's half of the corner post: the corner of the two walls from the frame's depth out to the facade,
      // split along the mitre with the window on the other wall (o.wallThickness: this wall's)
      const k = o.cornerK ?? 1;
      const t = o.wallThickness ?? rd + fd + 0.03;
      const y0 = o.sillBoard ? -(o.sillBoard.thickness ?? 0.025) : 0;
      if (t > rd + 0.005) prismY(f, [[cs * (W / 2 + k * rd), -rd], [cs * (W / 2 + k * rd), -t], [cs * (W / 2 + k * t), -t]], y0, H, M.frame, nf);
    }
  }
  let sillY = null;
  if (o.sillBoard && !isDoor) {
    const st = o.sillBoard.thickness ?? 0.025;
    const over = o.sillBoard.overhang ?? 0.01;
    const depth = rd + over;
    const cs = o.outline ? 0 : o.corner === 'to' ? 1 : o.corner === 'from' ? -1 : 0;
    const k = o.cornerK ?? 1;
    if (cs) {
      // a corner window's board runs into the corner, mitred with the one on the other wall
      const xa = -cs * (W / 2);
      prismY(f, [[xa, -rd], [cs * (W / 2 + k * rd), -rd], [cs * (W / 2 - k * over), over], [xa, over]], -st, 0, M.sill, { collide: false });
    } else {
      const g = new THREE.BoxGeometry(W, st, depth);
      f.add(g, M.sill, { matrix: place(0, -st / 2, -rd + depth / 2), collide: false, boxUV: true });
      g.dispose();
    }
    sillY = o.sill;
    // exterior window sill (vannbrett), sloping outward (a corner window's out to the corner)
    const vx = cs ? k * (-zB + 0.075) : 0;
    exteriorBatch.frame(om).box(W + vx, 0.012, 0.075, (cs * vx) / 2, -0.012, zB - 0.025, M.trim, { rot: [0.14, 0, 0], collide: false, castShadow: false });
  }
  const built = kit.build();
  batchers.push({ geometries: kit.geometries });
  built.name = `window:${o.id}`;
  built.matrixAutoUpdate = false;
  built.matrix.copy(om);
  const pickMeshes = [];
  built.traverse((m) => {
    if (!m.isMesh) return;
    m.matrixAutoUpdate = false;
    if (m.material !== M.sill) pickMeshes.push(m);
  });
  if (glassRect) {
    // one mesh per window: the panes of several fields merged, the mesh at the first pane's depth (shading.js reads the
    // depth of the glass in the reveal from the mesh's position)
    let geo;
    // (a pane under a sloped top is its trapezoid, in the window's frame)
    const pane = (r) => (r.poly ? new THREE.ShapeGeometry(new THREE.Shape(r.poly.map(([x, y]) => v2(x, y)))) : new THREE.PlaneGeometry(r.w, r.h));
    if (glassRect.parts) {
      const parts = glassRect.parts.map((r) => pane(r).translate(r.x, r.y, r.z - glassRect.z));
      geo = mergeGeometries(parts, false);
      for (const g of parts) g.dispose();
    } else geo = pane(glassRect);
    glass = new THREE.Mesh(keep(geo), M.glass);
    glass.name = `glass:${o.id}`;
    glass.position.set(glassRect.x ?? 0, glassRect.y ?? 0, glassRect.z);
    glass.updateMatrix();
    glass.applyMatrix4(om);
    glass.castShadow = false;
    glass.receiveShadow = false;
    glass.renderOrder = 2;
    glass.userData.pick = { kind: 'window', windowId: o.id };
  }
  return { group: built, glass, pickMeshes, sillY };
}
