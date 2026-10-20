import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32, hashString, cached } from '../world/proctex.js';
import { mat, emissive } from '../home/materials.js';

/**
 * Model kit – geometry helpers shared by every model builder (ARCHITECTURE §5). Everything is in METRES and every
 * geometry made here has UVs in metres, so the textures of home/materials.js get the right fibre/grain size.
 *
 * Geometry:   box, roundedBox, cushion, taperLeg, cylinder, lathe, tube, extrudeShape, sphere, torus
 * Shapes:     roundedRectShape, stadiumShape, ellipseShape, ringShape, arcPoints, arcPoints3
 * UVs:        worldUV (box projection, grain-aware), planarUV, smoothNormals
 * Assembly:   partMesh, tagPart, collectParts, mergeSameMaterial, setShadows, finishModel, disposeModel,
 *             sharedGeometry, pointLight, spotLight
 * Misc:       rng(seed) (deterministic – never Math.random in builders), DEG, clamp01, lerp
 * Placeholder: blockout(spec, { archetype, family, mount }) – a quick box model of any archetype (registry fallback,
 *             stub builders)
 *
 * Conventions (ARCHITECTURE §5): front = local +z; floor/surface/rug/soft origin = bottom centre (y = 0 bottom);
 * wall origin = back centre at the vertical middle (back in z = 0, object along +z); ceiling origin = attachment
 * point, object hangs along −y. Tag colourable meshes with `mesh.userData.part = '<part>'` (partMesh does it) –
 * finishModel() builds userData.model.parts from the tags, so SceneSync can recolour without rebuilding.
 */

export const DEG = Math.PI / 180;
export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const lerp = (a, b, t) => a + (b - a) * t;

// ---------------------------------------------------------------------------------------------------------------
// Random

/**
 * Deterministic random generator (mulberry32). Call it for a float in [0, 1).
 * Extras: .range(a, b), .int(a, b) (inclusive), .pick(array), .sign(), .jitter(v, amount), .gauss() (≈ N(0,1)).
 * @param {number|string} [seed=1]  number or string (hashed)
 * @returns {(() => number) & { range: Function, int: Function, pick: Function, sign: Function, jitter: Function, gauss: Function }}
 */
export function rng(seed = 1) {
  const s = typeof seed === 'string' ? hashString(seed) : (Math.floor(seed) >>> 0) || 1;
  const r = mulberry32(s);
  const f = () => r();
  f.range = (a, b) => a + (b - a) * r();
  f.int = (a, b) => Math.floor(a + (b - a + 1) * r());
  f.pick = (arr) => arr[Math.floor(r() * arr.length) % arr.length];
  f.sign = () => (r() < 0.5 ? -1 : 1);
  f.jitter = (v, amount) => v + (r() * 2 - 1) * amount;
  f.gauss = () => {
    let u = 0;
    for (let i = 0; i < 4; i++) u += r();
    return (u - 2) * 1.732;
  };
  return f;
}

// ---------------------------------------------------------------------------------------------------------------
// UVs and normals

const _n = new THREE.Vector3();
const _p = new THREE.Vector3();
const AXIS = { x: 0, y: 1, z: 2, u: 0, v: 1 };

/**
 * Box projection UVs in metres (× scale) from each vertex normal: faces facing ±x get (z, y), ±y get (x, z),
 * ±z get (x, y), oriented as seen from outside. `grain` ('x' | 'y' | 'z') puts the texture's U axis (wood grain,
 * brushed metal streaks, knit columns) along that axis on every face that contains it.
 * @param {THREE.BufferGeometry} geometry  modified in place (needs normals; computed if missing)
 * @param {number} [scale=1]  UV units per metre (2 = texture twice as fine)
 * @param {{ grain?: 'x'|'y'|'z', offset?: [number, number] }} [opts]
 * @returns {THREE.BufferGeometry}
 */
export function worldUV(geometry, scale = 1, { grain = 'x', offset = [0, 0] } = {}) {
  const pos = geometry.attributes.position;
  if (!geometry.attributes.normal) geometry.computeVertexNormals();
  const nrm = geometry.attributes.normal;
  const uv = geometry.attributes.uv && geometry.attributes.uv.count === pos.count
    ? geometry.attributes.uv
    : new THREE.BufferAttribute(new Float32Array(pos.count * 2), 2);
  const g = AXIS[grain] ?? 0;
  for (let i = 0; i < pos.count; i++) {
    _p.fromBufferAttribute(pos, i);
    _n.fromBufferAttribute(nrm, i);
    const ax = Math.abs(_n.x), ay = Math.abs(_n.y), az = Math.abs(_n.z);
    let u, v, uAxis, vAxis;
    if (ax >= ay && ax >= az) {
      u = _n.x > 0 ? -_p.z : _p.z;
      v = _p.y;
      uAxis = 2;
      vAxis = 1;
    } else if (az >= ay) {
      u = _n.z > 0 ? _p.x : -_p.x;
      v = _p.y;
      uAxis = 0;
      vAxis = 1;
    } else {
      u = _p.x;
      v = _n.y > 0 ? -_p.z : _p.z;
      uAxis = 0;
      vAxis = 2;
    }
    if (g !== uAxis && g === vAxis) {
      const t = u;
      u = v;
      v = -t;
    }
    uv.setXY(i, u * scale + offset[0], v * scale + offset[1]);
  }
  geometry.setAttribute('uv', uv);
  uv.needsUpdate = true;
  return geometry;
}

/**
 * Planar projection UVs (metres × scale) along an axis: 'y' → (x, z), 'z' → (x, y), 'x' → (z, y).
 * @returns {THREE.BufferGeometry}
 */
export function planarUV(geometry, axis = 'y', scale = 1) {
  const pos = geometry.attributes.position;
  const uv = new THREE.BufferAttribute(new Float32Array(pos.count * 2), 2);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    if (axis === 'y') uv.setXY(i, x * scale, -z * scale);
    else if (axis === 'z') uv.setXY(i, x * scale, y * scale);
    else uv.setXY(i, -z * scale, y * scale);
  }
  geometry.setAttribute('uv', uv);
  return geometry;
}

/**
 * Smooth (area-weighted) vertex normals across vertices that share a position, keeping the vertices separate – so
 * UV seams stay sharp while the shading is smooth (cushions, deformed boxes).
 * @param {THREE.BufferGeometry} geometry
 * @param {number} [precision=1e4]  positions are compared after rounding to 1/precision m
 * @returns {THREE.BufferGeometry}
 */
export function smoothNormals(geometry, precision = 1e4, creaseDeg = 180) {
  const pos = geometry.attributes.position;
  const idx = geometry.index;
  const count = pos.count;
  const keyOf = (i) => `${Math.round(pos.getX(i) * precision)},${Math.round(pos.getY(i) * precision)},${Math.round(pos.getZ(i) * precision)}`;
  const ids = new Int32Array(count);
  const map = new Map();
  for (let i = 0; i < count; i++) {
    const k = keyOf(i);
    let id = map.get(k);
    if (id === undefined) {
      id = map.size;
      map.set(k, id);
    }
    ids[i] = id;
  }
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const ab = new THREE.Vector3(), cb = new THREE.Vector3();
  const tri = idx ? idx.count / 3 : count / 3;
  // area-weighted face normals, and the faces touching each position
  const fn = new Float32Array(tri * 3);
  const faceOfVertex = new Int32Array(count).fill(-1);
  const facesAt = Array.from({ length: map.size }, () => []);
  for (let t = 0; t < tri; t++) {
    const i0 = idx ? idx.getX(t * 3) : t * 3;
    const i1 = idx ? idx.getX(t * 3 + 1) : t * 3 + 1;
    const i2 = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
    a.fromBufferAttribute(pos, i0);
    b.fromBufferAttribute(pos, i1);
    c.fromBufferAttribute(pos, i2);
    cb.subVectors(c, b);
    ab.subVectors(a, b);
    cb.cross(ab);
    fn[t * 3] = cb.x;
    fn[t * 3 + 1] = cb.y;
    fn[t * 3 + 2] = cb.z;
    for (const i of [i0, i1, i2]) {
      facesAt[ids[i]].push(t);
      if (faceOfVertex[i] < 0) faceOfVertex[i] = t;
    }
  }
  const cosT = Math.cos(Math.min(180, creaseDeg) * DEG) - 1e-6;
  const all = creaseDeg >= 180;
  const nrm = new THREE.BufferAttribute(new Float32Array(count * 3), 3);
  const own = new THREE.Vector3(), other = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    const f0 = faceOfVertex[i];
    _n.set(0, 0, 0);
    if (f0 >= 0) {
      own.set(fn[f0 * 3], fn[f0 * 3 + 1], fn[f0 * 3 + 2]).normalize();
      for (const t of facesAt[ids[i]]) {
        other.set(fn[t * 3], fn[t * 3 + 1], fn[t * 3 + 2]);
        if (all || other.clone().normalize().dot(own) >= cosT) _n.add(other);
      }
    }
    if (_n.lengthSq() < 1e-20) _n.set(0, 1, 0);
    _n.normalize();
    nrm.setXYZ(i, _n.x, _n.y, _n.z);
  }
  geometry.setAttribute('normal', nrm);
  return geometry;
}

// ---------------------------------------------------------------------------------------------------------------
// Primitives (all with metre UVs)

/**
 * Box with metre UVs.
 * @param {number} w @param {number} h @param {number} d
 * @param {{ grain?: string, uvScale?: number, bottom?: boolean }} [opts] bottom: origin at the bottom centre
 */
export function box(w, h, d, { grain, uvScale = 1, bottom = false } = {}) {
  const g = new THREE.BoxGeometry(w, h, d);
  worldUV(g, uvScale, { grain });
  if (bottom) g.translate(0, h / 2, 0);
  return g;
}

/**
 * Box with rounded edges and corners (radius r, `seg` segments per rounded edge), metre UVs.
 * @param {number} w @param {number} h @param {number} d
 * @param {number} [r=0.01] @param {number} [seg=2]
 * @param {{ grain?: string, uvScale?: number, bottom?: boolean }} [opts]
 */
export function roundedBox(w, h, d, r = 0.01, seg = 2, { grain, uvScale = 1, bottom = false } = {}) {
  const rr = Math.min(r, Math.min(w, h, d) / 2 - 1e-4);
  if (rr <= 5e-4) return box(w, h, d, { grain, uvScale, bottom });
  const g = new RoundedBoxGeometry(w, h, d, Math.max(1, seg), rr);
  worldUV(g, uvScale, { grain });
  if (bottom) g.translate(0, h / 2, 0);
  return g;
}

/**
 * Soft, pillowy box (seat/back cushions, throw pillows, poufs): rounded edges, faces bulging outward and optionally
 * pinched corners. The result measures exactly w × h × d.
 * @param {number} w @param {number} h @param {number} d
 * @param {object} [o]
 * @param {number} [o.puff=0.15]   bulge of the two big faces as a fraction of the thin dimension
 * @param {number} [o.round=0.5]   edge radius as a fraction of half the thin dimension (0..1)
 * @param {'x'|'y'|'z'} [o.axis]   thin axis (default: the smallest dimension) – 'y' for seat cushions
 * @param {number} [o.top=1]       bulge factor of the + face along the axis
 * @param {number} [o.bottom=0.5]  bulge factor of the − face (0 = flat bottom)
 * @param {number} [o.sides=0.25]  bulge of the side faces (fraction of the thin dimension)
 * @param {number} [o.pinch=0]     0..1: corners get thinner (throw pillows ≈ 0.5)
 * @param {number} [o.seg=10]      subdivisions along the longest side
 * @param {boolean} [o.bottomOrigin=false]  origin at the bottom centre instead of the centre
 * @param {string} [o.grain] @param {number} [o.uvScale=1]
 */
export function cushion(w, h, d, o = {}) {
  const dims = [w, h, d];
  const axis = o.axis ? AXIS[o.axis] : dims.indexOf(Math.min(w, h, d));
  const puff = o.puff ?? 0.15, round = clamp01(o.round ?? 0.5), top = o.top ?? 1, bottom = o.bottom ?? 0.5;
  const sides = o.sides ?? 0.25, pinch = o.pinch ?? 0;
  const segMax = Math.max(4, o.seg ?? 10);
  const longest = Math.max(w, h, d);
  const segs = dims.map((v) => Math.max(3, Math.round((segMax * v) / longest)));
  const thin = dims[axis];
  const g = new THREE.BoxGeometry(w, h, d, segs[0], segs[1], segs[2]);
  const pos = g.attributes.position;
  const R = Math.max(1e-3, (round * thin) / 2);
  const half = dims.map((v) => v / 2);
  const inner = half.map((v) => Math.max(0, v - R));
  const P = [0, 0, 0], q = [0, 0, 0];
  const a1 = (axis + 1) % 3, a2 = (axis + 2) % 3;
  for (let i = 0; i < pos.count; i++) {
    P[0] = pos.getX(i);
    P[1] = pos.getY(i);
    P[2] = pos.getZ(i);
    for (let k = 0; k < 3; k++) q[k] = half[k] > 0 ? P[k] / half[k] : 0;
    // rounded box: project onto the inner box, push out by R along the offset direction
    let ox = 0, oy = 0, oz = 0;
    const c = [0, 0, 0];
    for (let k = 0; k < 3; k++) c[k] = Math.max(-inner[k], Math.min(inner[k], P[k]));
    ox = P[0] - c[0];
    oy = P[1] - c[1];
    oz = P[2] - c[2];
    const len = Math.hypot(ox, oy, oz);
    if (len > 1e-9) {
      P[0] = c[0] + (ox / len) * R;
      P[1] = c[1] + (oy / len) * R;
      P[2] = c[2] + (oz / len) * R;
    }
    // bulge of the big faces (along the thin axis), fading toward the edges
    const s = q[a1], t = q[a2];
    const fall = (1 - s * s) * (1 - t * t);
    const side = q[axis] >= 0 ? top : bottom;
    P[axis] += q[axis] * puff * thin * side * fall;
    // pinched corners (throw pillows)
    if (pinch) P[axis] *= 1 - pinch * 0.7 * (s * s) * (t * t);
    // side faces bulge a little
    if (sides) {
      const mid = 1 - q[axis] * q[axis];
      P[a1] += q[a1] * Math.abs(q[a1]) ** 3 * sides * thin * mid * (1 - t * t) * 0.5;
      P[a2] += q[a2] * Math.abs(q[a2]) ** 3 * sides * thin * mid * (1 - s * s) * 0.5;
    }
    pos.setXYZ(i, P[0], P[1], P[2]);
  }
  // exact final size
  g.computeBoundingBox();
  const bb = g.boundingBox;
  const sx = w / (bb.max.x - bb.min.x), sy = h / (bb.max.y - bb.min.y), sz = d / (bb.max.z - bb.min.z);
  const cx = (bb.max.x + bb.min.x) / 2, cy = (bb.max.y + bb.min.y) / 2, cz = (bb.max.z + bb.min.z) / 2;
  for (let i = 0; i < pos.count; i++) {
    pos.setXYZ(i, (pos.getX(i) - cx) * sx, (pos.getY(i) - cy) * sy + (o.bottomOrigin ? h / 2 : 0), (pos.getZ(i) - cz) * sz);
  }
  pos.needsUpdate = true;
  smoothNormals(g);
  worldUV(g, o.uvScale ?? 1, { grain: o.grain });
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

/** Re-maps a CylinderGeometry's UVs to metres (side: around × height; caps: planar). */
function cylinderUV(g, rTop, rBottom, h) {
  const uv = g.attributes.uv;
  const idx = g.index;
  const rAvg = (rTop + rBottom) / 2;
  const done = new Uint8Array(uv.count);
  for (const grp of g.groups) {
    for (let k = grp.start; k < grp.start + grp.count; k++) {
      const i = idx ? idx.getX(k) : k;
      if (done[i]) continue;
      done[i] = 1;
      const u = uv.getX(i), v = uv.getY(i);
      if (grp.materialIndex === 0) uv.setXY(i, u * Math.PI * 2 * rAvg, v * h);
      else {
        const r = grp.materialIndex === 1 ? rTop : rBottom;
        uv.setXY(i, (u - 0.5) * 2 * r, (v - 0.5) * 2 * r);
      }
    }
  }
  uv.needsUpdate = true;
  return g;
}

/**
 * Cylinder (or frustum) with metre UVs; origin at the bottom centre unless `center`.
 * @param {number} rTop @param {number} rBottom @param {number} h
 * @param {{ seg?: number, open?: boolean, center?: boolean, thetaStart?: number, thetaLength?: number }} [o]
 */
export function cylinder(rTop, rBottom, h, { seg = 24, open = false, center = false, thetaStart = 0, thetaLength = Math.PI * 2 } = {}) {
  const g = new THREE.CylinderGeometry(rTop, rBottom, h, seg, 1, open, thetaStart, thetaLength);
  cylinderUV(g, rTop, rBottom, h);
  if (!center) g.translate(0, h / 2, 0);
  return g;
}

/**
 * Tapered leg from y = 0 (floor) to y = h. Round by default, `square` for square-section legs.
 * @param {number} h @param {number} rTop @param {number} [rBottom=rTop]
 * @param {{ seg?: number, square?: boolean }} [o]
 */
export function taperLeg(h, rTop, rBottom = rTop, { seg = 12, square = false } = {}) {
  if (square) {
    const g = new THREE.CylinderGeometry(rTop * Math.SQRT2, rBottom * Math.SQRT2, h, 4, 1).toNonIndexed();
    g.rotateY(Math.PI / 4);
    g.computeVertexNormals();
    worldUV(g, 1, { grain: 'y' });
    g.translate(0, h / 2, 0);
    return g;
  }
  return cylinder(rTop, rBottom, h, { seg });
}

/** Sphere with UVs in metres (u around the equator, v pole to pole). */
export function sphere(r, { wSeg = 24, hSeg = 16, phiStart = 0, phiLength = Math.PI * 2, thetaStart = 0, thetaLength = Math.PI } = {}) {
  const g = new THREE.SphereGeometry(r, wSeg, hSeg, phiStart, phiLength, thetaStart, thetaLength);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 2 * Math.PI * r, uv.getY(i) * Math.PI * r);
  return g;
}

/** Torus with metre UVs (u along the ring, v around the tube). */
export function torus(R, r, { radial = 10, tubular = 48, arc = Math.PI * 2 } = {}) {
  const g = new THREE.TorusGeometry(R, r, radial, tubular, arc);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * arc * R, uv.getY(i) * 2 * Math.PI * r);
  return g;
}

/**
 * Surface of revolution around +y. `profile` = [[r, y], …] from bottom to top (Vector2 also accepted). UVs: u = arc
 * length around at the mean radius, v = length along the profile (metres).
 * @param {Array<[number, number]|THREE.Vector2>} profile
 * @param {{ seg?: number, phiStart?: number, phiLength?: number }} [o]
 */
export function lathe(profile, { seg = 32, phiStart = 0, phiLength = Math.PI * 2 } = {}) {
  const pts = profile.map((p) => (p.isVector2 ? p.clone() : new THREE.Vector2(p[0], p[1])));
  const g = new THREE.LatheGeometry(pts, seg, phiStart, phiLength);
  const n = pts.length;
  const along = [0];
  for (let j = 1; j < n; j++) along.push(along[j - 1] + pts[j].distanceTo(pts[j - 1]));
  const rMean = pts.reduce((s, p) => s + p.x, 0) / n || 0.01;
  const uv = g.attributes.uv;
  for (let i = 0; i <= seg; i++) {
    for (let j = 0; j < n; j++) {
      const k = i * n + j;
      if (k < uv.count) uv.setXY(k, (i / seg) * phiLength * rMean, along[j]);
    }
  }
  uv.needsUpdate = true;
  return g;
}

/**
 * Tube along points (smooth Catmull-Rom by default, `curve: 'line'` for straight segments with sharp corners).
 * UVs: u = along the tube (metres), v = around (metres) – so a wood/metal grain runs along the tube.
 * @param {Array<[number, number, number]|THREE.Vector3>} points
 * @param {number} r
 * @param {{ seg?: number, radial?: number, closed?: boolean, curve?: 'catmull'|'line', tension?: number }} [o]
 */
export function tube(points, r, { seg, radial = 8, closed = false, curve = 'catmull', tension = 0.5 } = {}) {
  const pts = points.map((p) => (p.isVector3 ? p.clone() : new THREE.Vector3(p[0], p[1], p[2])));
  let path;
  if (curve === 'line') {
    path = new THREE.CurvePath();
    for (let i = 0; i < pts.length - 1; i++) path.add(new THREE.LineCurve3(pts[i], pts[i + 1]));
    if (closed) path.add(new THREE.LineCurve3(pts[pts.length - 1], pts[0]));
  } else {
    path = new THREE.CatmullRomCurve3(pts, closed, 'catmullrom', tension);
  }
  const length = path.getLength();
  const tubular = seg ?? Math.max(8, Math.min(200, Math.round(length * 40)));
  const g = new THREE.TubeGeometry(path, tubular, r, radial, closed);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * length, uv.getY(i) * 2 * Math.PI * r);
  return g;
}

/**
 * Extrudes a shape (THREE.Shape or [[x, y], …]) along +z from 0 to depth (or centred). Optional rounded bevel.
 * UVs are metres (caps: shape x/y; sides: along the outline × depth).
 * @param {THREE.Shape|Array<[number,number]>} shape
 * @param {number} depth
 * @param {{ bevel?: number, bevelSegments?: number, curveSegments?: number, center?: boolean }} [o]
 */
export function extrudeShape(shape, depth, { bevel = 0, bevelSegments = 2, curveSegments = 24, center = false } = {}) {
  const s = Array.isArray(shape) ? new THREE.Shape(shape.map(([x, y]) => new THREE.Vector2(x, y))) : shape;
  const g = new THREE.ExtrudeGeometry(s, {
    depth: Math.max(1e-4, depth - 2 * bevel),
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelOffset: -bevel,
    bevelSegments,
    curveSegments,
    steps: 1,
  });
  g.translate(0, 0, bevel);
  if (center) g.translate(0, 0, -depth / 2);
  // ExtrudeGeometry is non-indexed with flat normals: smooth the curved outline, keep the cap edges crisp
  smoothNormals(g, 1e4, 50);
  return g;
}

// ---------------------------------------------------------------------------------------------------------------
// Shapes (2D, x/y)

/** Points on a circular arc (2D). Angles in radians, counter-clockwise from +x. */
export function arcPoints(r, a0, a1, n = 16, cx = 0, cy = 0) {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n;
    out.push(new THREE.Vector2(cx + Math.cos(a) * r, cy + Math.sin(a) * r));
  }
  return out;
}

/**
 * Points on an arc in 3D, in the plane spanned by two unit axes around a centre.
 * @param {THREE.Vector3} center @param {number} r @param {number} a0 @param {number} a1 @param {number} [n=16]
 * @param {THREE.Vector3} [xAxis=(1,0,0)] @param {THREE.Vector3} [yAxis=(0,1,0)]
 * @returns {THREE.Vector3[]}
 */
export function arcPoints3(center, r, a0, a1, n = 16, xAxis = new THREE.Vector3(1, 0, 0), yAxis = new THREE.Vector3(0, 1, 0)) {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n;
    out.push(center.clone().addScaledVector(xAxis, Math.cos(a) * r).addScaledVector(yAxis, Math.sin(a) * r));
  }
  return out;
}

/** Centred rounded rectangle w × h with corner radius r. */
export function roundedRectShape(w, h, r = 0.02) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  const x = -w / 2, y = -h / 2;
  const s = new THREE.Shape();
  s.moveTo(x + rr, y);
  s.lineTo(x + w - rr, y);
  if (rr) s.quadraticCurveTo(x + w, y, x + w, y + rr);
  s.lineTo(x + w, y + h - rr);
  if (rr) s.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  s.lineTo(x + rr, y + h);
  if (rr) s.quadraticCurveTo(x, y + h, x, y + h - rr);
  s.lineTo(x, y + rr);
  if (rr) s.quadraticCurveTo(x, y, x + rr, y);
  return s;
}

/** Centred stadium (rectangle with semicircular ends along x), w ≥ h. */
export function stadiumShape(w, h, n = 24) {
  const r = Math.min(w, h) / 2;
  const cx = Math.max(0, w / 2 - r);
  const pts = [...arcPoints(r, -Math.PI / 2, Math.PI / 2, n, cx, 0), ...arcPoints(r, Math.PI / 2, (3 * Math.PI) / 2, n, -cx, 0)];
  return new THREE.Shape(pts);
}

/** Centred ellipse w × h. */
export function ellipseShape(w, h, n = 48) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    pts.push(new THREE.Vector2((Math.cos(a) * w) / 2, (Math.sin(a) * h) / 2));
  }
  return new THREE.Shape(pts);
}

/** Ring (annulus) shape. */
export function ringShape(rOuter, rInner, n = 48) {
  const s = new THREE.Shape(arcPoints(rOuter, 0, Math.PI * 2, n).slice(0, -1));
  s.holes.push(new THREE.Path(arcPoints(rInner, Math.PI * 2, 0, n).slice(0, -1)));
  return s;
}

// ---------------------------------------------------------------------------------------------------------------
// Assembly

/** Tags a mesh as a colourable part (ARCHITECTURE §13 names). Returns the mesh. */
export function tagPart(mesh, part) {
  if (part) mesh.userData.part = part;
  return mesh;
}

/**
 * Mesh with a part tag and an optional transform.
 * @param {THREE.BufferGeometry} geometry
 * @param {THREE.Material} material
 * @param {string|null} part
 * @param {{ position?: number[], rotation?: number[], scale?: number|number[], name?: string, noMerge?: boolean }} [o]
 */
export function partMesh(geometry, material, part, { position, rotation, scale, name, noMerge } = {}) {
  const m = new THREE.Mesh(geometry, material);
  if (position) m.position.set(position[0], position[1], position[2]);
  if (rotation) m.rotation.set(rotation[0], rotation[1], rotation[2]);
  if (scale != null) Array.isArray(scale) ? m.scale.set(scale[0], scale[1], scale[2]) : m.scale.setScalar(scale);
  if (name) m.name = name;
  if (noMerge) m.userData.noMerge = true;
  return tagPart(m, part);
}

/** { [part]: Mesh[] } from userData.part tags below root. */
export function collectParts(root) {
  const parts = {};
  root.traverse((o) => {
    if (o.isMesh && o.userData.part) (parts[o.userData.part] ||= []).push(o);
  });
  return parts;
}

/** Geometry shared between builds (cached per key, never disposed by disposeModel). */
export function sharedGeometry(key, factory) {
  return cached(`kitgeo:${key}`, () => {
    const g = factory();
    g.userData.shared = true;
    return g;
  });
}

function prepForMerge(geometry, matrix) {
  let g = geometry.clone();
  for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
  g.morphAttributes = {};
  if (!g.attributes.normal) g.computeVertexNormals();
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  if (!g.index) {
    const n = g.attributes.position.count;
    const arr = n > 65535 ? new Uint32Array(n) : new Uint16Array(n);
    for (let i = 0; i < n; i++) arr[i] = i;
    g.setIndex(new THREE.BufferAttribute(arr, 1));
  }
  g.clearGroups();
  g.applyMatrix4(matrix);
  if (matrix.determinant() < 0) {
    // mirrored transform: flip the winding so faces stay front-facing
    const idx = g.index;
    for (let i = 0; i < idx.count; i += 3) {
      const t = idx.getX(i + 1);
      idx.setX(i + 1, idx.getX(i + 2));
      idx.setX(i + 2, t);
    }
  }
  return g;
}

/**
 * Merges the meshes below `group` that share a material, part tag and shadow flags into one mesh each (fewer draw
 * calls). Skips InstancedMesh, SkinnedMesh, multi-material meshes, meshes (or ancestors) with userData.noMerge
 * (lamp bulbs, moving parts) and meshes with userData.lightRef. Transforms are baked relative to `group`.
 * Rebuilds group.userData.model.parts when present. Geometries of the merged source meshes are disposed unless
 * shared.
 * @param {THREE.Object3D} group
 * @returns {THREE.Object3D} group
 */
export function mergeSameMaterial(group) {
  group.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(group.matrixWorld).invert();
  const buckets = new Map();
  const removed = new Set();
  const skip = new Set();
  group.traverse((o) => {
    if (o !== group && o.userData.noMerge) o.traverse((c) => skip.add(c));
  });
  group.traverse((o) => {
    if (!o.isMesh || skip.has(o) || o.isInstancedMesh || o.isSkinnedMesh || Array.isArray(o.material)) return;
    if (o.userData.lightRef || !o.visible) return;
    const key = `${o.material.uuid}|${o.userData.part || ''}|${o.castShadow ? 1 : 0}${o.receiveShadow ? 1 : 0}|${o.renderOrder}`;
    let b = buckets.get(key);
    if (!b) buckets.set(key, (b = []));
    b.push(o);
  });
  for (const list of buckets.values()) {
    if (list.length < 2) continue;
    const geos = list.map((m) => prepForMerge(m.geometry, new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld)));
    const merged = mergeGeometries(geos, false);
    for (const g of geos) g.dispose();
    if (!merged) continue;
    merged.computeBoundingBox();
    merged.computeBoundingSphere();
    const first = list[0];
    const mesh = new THREE.Mesh(merged, first.material);
    mesh.castShadow = first.castShadow;
    mesh.receiveShadow = first.receiveShadow;
    mesh.renderOrder = first.renderOrder;
    mesh.name = first.name || first.userData.part || 'merged';
    if (first.userData.part) mesh.userData.part = first.userData.part;
    for (const m of list) {
      m.parent?.remove(m);
      removed.add(m.geometry);
    }
    group.add(mesh);
  }
  if (removed.size) {
    const used = new Set();
    group.traverse((o) => o.geometry && used.add(o.geometry));
    for (const geo of removed) if (!used.has(geo) && !geo.userData.shared) geo.dispose();
  }
  if (group.userData.model) group.userData.model.parts = collectParts(group);
  return group;
}

/**
 * Shadow flags for every mesh below root. Transparent materials, emissive bulbs and meshes with
 * userData.noShadow never cast.
 * @param {THREE.Object3D} root @param {boolean} [cast=true] @param {boolean} [receive=true]
 */
export function setShadows(root, cast = true, receive = true) {
  root.traverse((o) => {
    if (!o.isMesh) return;
    const m = Array.isArray(o.material) ? o.material[0] : o.material;
    const see = m?.transparent || m?.userData?.kind === 'emissive' || o.userData.noShadow;
    o.castShadow = cast && !see;
    o.receiveShadow = receive && !m?.transparent;
  });
  return root;
}

/**
 * Finishes a model group: shadows, optional merge, userData.model = { parts, lights, surfaces, seatY, colliders? }.
 * colliders: [{ min: [x,y,z], max: [x,y,z] }] in model space – collision boxes for SceneSync when the model's AABB
 * would block too much (L-sofas, open frames); without them the whole AABB collides.
 * @param {THREE.Group} group
 * @param {{ lights?: object[], surfaces?: object[], seatY?: number, merge?: boolean, shadows?: boolean, recolor?: Function, colliders?: object[] }} [o]
 * @returns {THREE.Group}
 */
export function finishModel(group, { lights = [], surfaces = [], seatY, merge = true, shadows = true, recolor, colliders } = {}) {
  if (shadows) setShadows(group, true, true);
  group.userData.model = { parts: {}, lights, surfaces };
  if (seatY != null) group.userData.model.seatY = seatY;
  if (colliders?.length) group.userData.model.colliders = colliders;
  if (recolor) group.userData.model.recolor = recolor;
  if (merge) mergeSameMaterial(group);
  group.userData.model.parts = collectParts(group);
  return group;
}

/**
 * Frees a model: disposes geometries (unless userData.shared) and materials that are not cached by materials.js.
 * @param {THREE.Object3D} root
 */
export function disposeModel(root) {
  if (!root) return;
  root.traverse((o) => {
    if (o.geometry && !o.geometry.userData?.shared) o.geometry.dispose();
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of mats) if (!m.userData?.cached && !m.userData?.shared) m.dispose();
  });
}

/**
 * Light entry for userData.model.lights (local coordinates).
 * @param {number[]} position [x, y, z]
 * @param {{ lumens?: number, colorK?: number, emissiveMeshes?: THREE.Mesh[] }} [o]
 */
export function pointLight(position, { lumens = 800, colorK = 2700, emissiveMeshes = [] } = {}) {
  return { type: 'point', position: [...position], colorK, lumens, emissiveMeshes };
}

/** Spot light entry (direction local, angle in radians). */
export function spotLight(position, direction, { angle = 0.6, penumbra = 0.5, lumens = 600, colorK = 2700, emissiveMeshes = [] } = {}) {
  return { type: 'spot', position: [...position], direction: [...direction], angle, penumbra, colorK, lumens, emissiveMeshes };
}

// ---------------------------------------------------------------------------------------------------------------
// Block-out models (placeholder builder)

/**
 * A quick but correctly sized box model of any archetype: the registry's fallback and the stub builders. Parts are
 * tagged with the canonical names (§13) and coloured from spec.colors / spec.materials; lamps get a light and a
 * glowing bulb; tables report their top surface.
 * @param {{ dims: {w,d,h}, params?: object, colors?: object, materials?: object }} spec  (merged with defaults)
 * @param {{ archetype?: string, family?: string, mount?: string, color?: string }} [info]
 * @returns {THREE.Group}
 */
export function blockout(spec, { archetype = '', family = '', mount = 'floor', color } = {}) {
  const dims = spec?.dims || { w: 0.5, d: 0.5, h: 0.5 };
  const w = Math.max(0.01, dims.w), d = Math.max(0.005, dims.d), h = Math.max(0.005, dims.h);
  const P = spec?.params || {};
  const C = spec?.colors || {};
  const M = spec?.materials || {};
  const g = new THREE.Group();
  g.name = archetype || 'blockout';
  const mm = (part, kind, hex) => mat(M[part] || kind, C[part] || color || hex);
  const add = (geo, part, x, y, z, kind, hex, rot) => {
    const m = partMesh(geo, mm(part, kind, hex), part, { position: [x, y, z], rotation: rot });
    g.add(m);
    return m;
  };
  const lights = [];
  const surfaces = [];
  const colliders = [];
  let seatY;

  switch (family) {
    case 'seating': {
      const up = 'upholstery';
      const seatH = Math.min(P.seatH ?? h * 0.55, h - 0.05);
      if (archetype.startsWith('sofa')) {
        const baseH = Math.min(0.14, seatH * 0.35);
        const backT = Math.min(P.backT ?? 0.22, d * 0.4);
        const armW = archetype === 'sofa-curved' ? 0 : Math.min(P.armW ?? 0.2, w * 0.15);
        const depth = archetype === 'sofa-modular-l' ? Math.min(P.depth ?? 0.92, d) : d;
        const z0 = -d / 2 + depth / 2;
        add(roundedBox(w, baseH, depth, 0.02), 'legs', 0, baseH / 2, z0, 'woven', '#707173');
        add(cushion(w - 2 * armW, seatH - baseH, depth - backT, { axis: 'y', puff: 0.12, round: 0.6, bottom: 0 }), up, 0, (seatH + baseH) / 2, z0 + backT / 2, 'woven', '#707173');
        add(cushion(w, h - baseH, backT, { axis: 'z', puff: 0.1, round: 0.8 }), up, 0, (h + baseH) / 2, -d / 2 + backT / 2, 'woven', '#707173');
        if (armW > 0) {
          const armH = Math.min(P.armH ?? 0.62, h);
          for (const s of [-1, 1]) {
            if (archetype === 'sofa-modular-l' && P.armSide && ((P.armSide === '+x') !== (s > 0))) continue;
            add(cushion(armW, armH - baseH, depth - backT, { axis: 'x', puff: 0.08, round: 0.8 }), up, s * (w / 2 - armW / 2), (armH + baseH) / 2, z0 + backT / 2, 'woven', '#707173');
          }
        }
        if (archetype === 'sofa-modular-l') colliders.push({ min: [-w / 2, 0, -d / 2], max: [w / 2, h, -d / 2 + depth] });
        if (archetype === 'sofa-modular-l' && d > depth + 0.1) {
          // the short leg / chaise of the L
          const sx = P.shortLegSide === '+x' ? 1 : -1;
          const legW = depth;
          const legD = d - depth;
          const x = sx * (w / 2 - legW / 2);
          colliders.push({ min: [x - legW / 2, 0, -d / 2 + depth], max: [x + legW / 2, seatH, d / 2] });
          add(roundedBox(legW, baseH, legD, 0.02), 'legs', x, baseH / 2, d / 2 - legD / 2, 'woven', '#707173');
          add(cushion(legW, seatH - baseH, legD, { axis: 'y', puff: 0.12, round: 0.6, bottom: 0 }), up, x, (seatH + baseH) / 2, d / 2 - legD / 2, 'woven', '#707173');
        }
        if (C.piping) add(box(w, 0.012, 0.012), 'piping', 0, seatH, z0 + depth / 2 - 0.006, 'woven', C.piping);
      } else if (archetype === 'tub-swivel') {
        const baseH = Math.min(P.baseH ?? 0.25, seatH * 0.8);
        const baseR = (P.baseD ?? Math.min(w, d) * 0.85) / 2;
        add(cylinder(baseR * 0.95, baseR, baseH, { seg: 32 }), 'legs', 0, 0, 0, 'boucle', '#a7a19b');
        add(cylinder(w / 2, w / 2 * 0.96, seatH - baseH, { seg: 32 }), up, 0, baseH, 0, 'boucle', '#a7a19b');
        // wrapped back shell (≈ backWrapDeg) behind the seat: an annular sector extruded upward
        const wrap = ((P.backWrapDeg ?? 200) * DEG) / 2;
        const shellT = P.shellT ?? 0.1;
        const outer = arcPoints(w / 2, Math.PI / 2 - wrap, Math.PI / 2 + wrap, 32);
        const inner = arcPoints(w / 2 - shellT, Math.PI / 2 + wrap, Math.PI / 2 - wrap, 32);
        const shellGeo = extrudeShape(new THREE.Shape([...outer, ...inner]), Math.max(0.05, h - seatH), { bevel: 0.02, curveSegments: 8 });
        shellGeo.rotateX(-Math.PI / 2);
        worldUV(shellGeo);
        add(shellGeo, up, 0, seatH, 0, 'boucle', '#a7a19b');
        add(cushion(w * 0.86, 0.1, d * 0.8, { axis: 'y', puff: 0.2, round: 0.8, bottom: 0 }), up, 0, seatH + 0.03, d * 0.05, 'boucle', '#a7a19b');
      } else if (archetype === 'dining-chair' || archetype === 'bar-stool' || archetype === 'shell-legs') {
        const legR = (P.legD ?? 0.022) / 2;
        const inset = 0.05;
        for (const sx of [-1, 1]) {
          for (const sz of [-1, 1]) add(taperLeg(seatH - 0.04, legR, legR * 0.8), 'legs', sx * (w / 2 - inset), 0, sz * (d / 2 - inset), 'black-metal', '#1a1a1a');
        }
        if (archetype === 'bar-stool' && P.footrest !== false) add(box(w - 2 * inset, 0.015, 0.015), 'legs', 0, seatH * 0.35, d / 2 - inset, 'black-metal', '#1a1a1a');
        add(cushion(w, 0.08, d * 0.88, { axis: 'y', puff: 0.15, round: 0.7 }), up, 0, seatH - 0.04, d * 0.04, 'boucle', '#d2cbc2');
        add(cushion(w * 0.95, h - seatH, 0.07, { axis: 'z', puff: 0.12, round: 0.8 }), up, 0, seatH + (h - seatH) / 2 - 0.02, -d / 2 + 0.06, 'boucle', '#d2cbc2', [-0.12, 0, 0]);
      } else {
        // generic armchair: seat + back + arms on four legs
        const legH = Math.max(0.05, seatH - 0.2);
        for (const sx of [-1, 1]) {
          for (const sz of [-1, 1]) add(taperLeg(legH, 0.018, 0.012), 'legs', sx * (w / 2 - 0.06), 0, sz * (d / 2 - 0.06), 'oak', '#8a6a4a');
        }
        add(cushion(w, seatH - legH, d, { axis: 'y', puff: 0.15, round: 0.6 }), up, 0, legH + (seatH - legH) / 2, 0, 'boucle', '#cbbba2');
        add(cushion(w, h - seatH, 0.16, { axis: 'z', puff: 0.15, round: 0.8 }), up, 0, seatH + (h - seatH) / 2, -d / 2 + 0.08, 'boucle', '#cbbba2', [-0.1, 0, 0]);
        if (archetype !== 'shell-legs' && archetype !== 'rocking') {
          for (const s of [-1, 1]) add(cushion(0.12, 0.2, d * 0.85, { axis: 'x', puff: 0.1 }), up, s * (w / 2 - 0.06), seatH + 0.08, 0.02, 'boucle', '#cbbba2');
        }
        if (C.frame) add(box(0.03, 0.03, d), 'frame', 0, legH, 0, 'oak', C.frame);
      }
      seatY = seatH;
      break;
    }
    case 'table': {
      const topT = Math.min(P.topT ?? 0.03, h * 0.3);
      if (archetype === 'sideboard' || archetype === 'tv-bench') {
        const legH = Math.min(P.legH ?? (archetype === 'tv-bench' ? 0.08 : 0.12), h * 0.4);
        const lift = P.base === 'wall' ? (P.mountHeight ?? 0.3) : 0;
        const bodyH = h - legH - topT;
        if (P.base !== 'wall') {
          for (const sx of [-1, 1]) for (const sz of [-1, 1]) add(taperLeg(legH, 0.015, 0.012), 'legs', sx * (w / 2 - 0.05), lift, sz * (d / 2 - 0.05), 'black-metal', '#1c1c1c');
        }
        add(box(w, bodyH, d - 0.02), 'body', 0, lift + legH + bodyH / 2, -0.01, 'oak', '#b08b62');
        const doors = Math.max(1, Math.round(P.doors ?? Math.round(w / 0.5)));
        const dw = (w - 0.006 * (doors + 1)) / doors;
        for (let i = 0; i < doors; i++) {
          const x = -w / 2 + 0.006 + dw / 2 + i * (dw + 0.006);
          add(box(dw, bodyH - 0.012, 0.018, { grain: 'y' }), 'front', x, lift + legH + bodyH / 2, d / 2 - 0.02 + 0.009, 'oak', '#b08b62');
          add(box(0.012, 0.08, 0.012), 'handle', x + (i % 2 ? -1 : 1) * (dw / 2 - 0.03), lift + legH + bodyH / 2, d / 2 + 0.004, 'black-metal', '#1c1c1c');
        }
        add(roundedBox(w, topT, d, 0.003, 1), 'top', 0, lift + h - topT / 2, 0, 'oak', '#b08b62');
        surfaces.push({ y: lift + h, w, d, center: [0, 0] });
      } else if (archetype === 'coffee-table-round-nesting' || archetype === 'side-table-nesting') {
        const tables = Array.isArray(P.tables) && P.tables.length ? P.tables : [{ d: Math.min(w, d), h, offset: [0, 0] }];
        for (const t of tables) {
          const r = (t.d ?? Math.min(w, d)) / 2, th = t.h ?? h;
          const [ox, oz] = t.offset ?? [0, 0];
          add(cylinder(r, r, topT, { seg: 48 }), 'top', ox, th - topT, oz, 'smoked-oak', '#3d332d');
          add(cylinder(r * 0.97, r * 0.97, 0.03, { seg: 48, open: true }), 'body', ox, th - topT - 0.03, oz, 'black-metal', '#1c1c1c');
          for (let i = 0; i < 3; i++) {
            const a = (i / 3) * Math.PI * 2 + 0.4;
            add(taperLeg(th - topT - 0.01, 0.01, 0.01), 'legs', ox + Math.cos(a) * r * 0.85, 0, oz + Math.sin(a) * r * 0.85, 'black-metal', '#1c1c1c');
          }
          surfaces.push({ y: th, w: 2 * r * 0.7, d: 2 * r * 0.7, center: [ox, oz] });
        }
      } else if (archetype === 'wall-shelf') {
        const boards = Math.max(2, Math.round(P.boards?.length ?? 3));
        for (let i = 0; i < boards; i++) {
          const y = -h / 2 + 0.01 + (i * (h - 0.02)) / (boards - 1);
          add(box(w, 0.018, d), 'top', 0, y, d / 2, 'black-metal', '#1e1e1e');
          surfaces.push({ y: y + 0.009, w, d, center: [0, d / 2] });
        }
        for (const sx of [-1, 1]) add(box(0.015, h, 0.015), 'body', sx * (w / 2 - 0.01), 0, 0.01, 'black-metal', '#1e1e1e');
      } else {
        const round = archetype === 'side-table-round' || archetype === 'side-table-c';
        const oval = archetype === 'dining-table-oval';
        if (round) add(cylinder(w / 2, w / 2, topT, { seg: 48 }), 'top', 0, h - topT, 0, 'oak', '#b08b62');
        else if (oval) {
          const geo = extrudeShape(stadiumShape(w, d), topT, { bevel: Math.min(0.006, topT / 3) });
          geo.rotateX(-Math.PI / 2);
          worldUV(geo, 1, { grain: 'x' });
          add(geo, 'top', 0, h - topT, 0, 'smoked-oak', '#4b4039');
        } else add(roundedBox(w, topT, d, 0.004, 1, { grain: 'x' }), 'top', 0, h - topT / 2, 0, 'oak', '#b08b62');
        const legH = h - topT;
        if (round) add(taperLeg(legH, 0.025, 0.03), 'legs', 0, 0, 0, 'black-metal', '#1c1c1c');
        else if (oval || P.legs === 'a-frame') {
          const inset = Math.min(P.legInset ?? 0.4, w / 2 - 0.1);
          for (const sx of [-1, 1]) {
            add(box(0.05, legH, d * 0.6), 'legs', sx * (w / 2 - inset), legH / 2, 0, 'black-metal', '#1c1c1c');
          }
        } else {
          for (const sx of [-1, 1]) for (const sz of [-1, 1]) add(box(0.025, legH, 0.025), 'legs', sx * (w / 2 - 0.04), legH / 2, sz * (d / 2 - 0.04), 'black-metal', '#1c1c1c');
        }
        if (round) add(cylinder(w * 0.25, w * 0.25, 0.015, { seg: 32 }), 'body', 0, 0, 0, 'black-metal', '#1c1c1c');
        surfaces.push({ y: h, w: round ? w * 0.7 : w, d: round ? w * 0.7 : d, center: [0, 0] });
      }
      break;
    }
    case 'lamp': {
      const bulbMat = emissive('#ffe2b8', 2.2);
      const bulb = (x, y, z, r = 0.03) => {
        const b = partMesh(sphere(r, { wSeg: 12, hSeg: 8 }), bulbMat, null, { position: [x, y, z], noMerge: true });
        b.userData.noShadow = true;
        g.add(b);
        return b;
      };
      const lumens = P.lumens ?? 800;
      if (mount === 'ceiling') {
        const drop = Math.max(0.05, P.drop ?? h);
        if (archetype === 'chandelier-molecule') {
          const hub = P.hubDrop ?? drop * 0.5;
          add(cylinder(0.06, 0.06, 0.02, { seg: 24 }), 'base', 0, -0.02, 0, 'black-metal', '#1a1a1a');
          add(cylinder(0.006, 0.006, hub), 'metal', 0, -hub, 0, 'black-metal', '#1a1a1a');
          const r = rng(`${archetype}:${w}`);
          const n = Math.max(3, P.shades ?? 8);
          const shadeD = Array.isArray(P.shadeD) ? P.shadeD : [];
          const em = [];
          for (let i = 0; i < n; i++) {
            const a = (i / n) * Math.PI * 2 + r.range(-0.3, 0.3);
            const rad = r.range(0.25, 0.5) * w;
            const y = -hub + r.range(-(drop - hub) + 0.08, 0.15);
            const p = new THREE.Vector3(Math.cos(a) * rad, y, Math.sin(a) * rad);
            add(tube([[0, -hub, 0], [p.x, p.y, p.z]], 0.006, { curve: 'line', radial: 6 }), 'metal', 0, 0, 0, 'black-metal', '#1a1a1a');
            const sd = (shadeD[i] ?? 0.16) / 2;
            add(sphere(sd, { wSeg: 20, hSeg: 12, thetaStart: Math.PI * 0.35, thetaLength: Math.PI * 0.65 }), 'shade', p.x, p.y + sd * 0.2, p.z, 'black-metal', '#1a1a1a', [Math.PI, 0, 0]);
            em.push(bulb(p.x, p.y, p.z, sd * 0.35));
          }
          add(sphere(0.025, { wSeg: 12, hSeg: 8 }), 'metal', 0, -hub, 0, 'black-metal', '#1a1a1a');
          lights.push(pointLight([0, -hub - 0.1, 0], { lumens, emissiveMeshes: em }));
        } else {
          const shadeH = Math.min(h * 0.6, archetype === 'pendant-linear' ? 0.08 : Math.max(0.12, w * 0.55));
          add(cylinder(0.05, 0.05, 0.02), 'base', 0, -0.02, 0, 'black-metal', '#1a1a1a');
          add(cylinder(0.003, 0.003, Math.max(0.01, drop - shadeH)), 'cord', 0, -drop + shadeH, 0, 'cotton', '#1a1a1a');
          const y0 = -drop;
          if (archetype === 'pendant-globe') add(sphere(w / 2, { wSeg: 32, hSeg: 20 }), 'shade', 0, y0 + w / 2, 0, 'glass-opal', '#f3f1ec');
          else if (archetype === 'pendant-cylinder') add(cylinder(w / 2, w / 2, shadeH, { seg: 32, open: true }), 'shade', 0, y0, 0, 'black-metal', '#1a1a1a');
          else if (archetype === 'pendant-linear') add(roundedBox(w, shadeH, Math.max(0.05, d), 0.01), 'shade', 0, y0 + shadeH / 2, 0, 'black-metal', '#1a1a1a');
          else if (archetype === 'ceiling-ring') add(torus(w / 2, 0.015, { radial: 8, tubular: 64 }), 'shade', 0, y0 + 0.02, 0, 'black-metal', '#1a1a1a', [Math.PI / 2, 0, 0]);
          else {
            const prof = [[w / 2, 0], [w / 2 * 0.96, shadeH * 0.25], [w / 2 * 0.75, shadeH * 0.7], [w * 0.12, shadeH], [0.02, shadeH]];
            const shadeMat = archetype === 'pendant-woven' ? 'rattan' : archetype === 'pendant-tiered' ? 'paper' : 'black-metal';
            add(lathe(prof, { seg: 40 }), 'shade', 0, y0, 0, shadeMat, '#1a1a1a');
            const inner = add(lathe(prof.map(([r, y]) => [r * 0.97, y - 0.004]).reverse(), { seg: 40 }), 'inner', 0, y0, 0, 'brass', '#b08a4a');
            inner.userData.noShadow = true;
          }
          const em = [bulb(0, y0 + Math.min(shadeH * 0.4, 0.06), 0)];
          lights.push(pointLight([0, y0 + 0.02, 0], { lumens, emissiveMeshes: em }));
        }
      } else if (mount === 'wall') {
        add(cylinder(0.05, 0.05, 0.02, { seg: 24 }), 'base', 0, 0, 0.01, 'black-metal', '#1a1a1a', [Math.PI / 2, 0, 0]);
        const armL = Math.max(0.05, d - w / 2);
        add(cylinder(0.006, 0.006, armL), 'metal', 0, 0, 0.02, 'brass', '#b8925a', [Math.PI / 2, 0, 0]);
        add(lathe([[w / 2, 0], [w * 0.4, h * 0.5], [w * 0.15, h * 0.7]], { seg: 32 }), 'shade', 0, -h * 0.3, d - w / 2, 'brass', '#b8925a');
        const em = [bulb(0, -h * 0.1, d - w / 2)];
        lights.push(pointLight([0, -h * 0.15, d - w / 2], { lumens, emissiveMeshes: em }));
      } else {
        // floor / table lamps
        const shadeH = Math.min(h * 0.35, Math.max(0.12, w * 0.6));
        const baseR = Math.min(w, d) * 0.35;
        add(cylinder(baseR, baseR, 0.02, { seg: 32 }), 'base', 0, 0, 0, 'black-metal', '#1a1a1a');
        if (archetype === 'floor-arc') {
          const reach = Math.max(w, d) * 0.8;
          add(tube([[0, 0, 0], [0, h * 0.75, 0], [reach * 0.5, h, 0], [reach, h * 0.92, 0]], 0.01, { radial: 8 }), 'metal', 0, 0, 0, 'steel', '#b9bcbf');
          add(lathe([[0.18, 0], [0.16, 0.12], [0.03, 0.2]], { seg: 32 }), 'shade', reach, h * 0.92 - 0.2, 0, 'steel', '#b9bcbf');
          const em = [bulb(reach, h * 0.92 - 0.12, 0)];
          lights.push(pointLight([reach, h * 0.92 - 0.15, 0], { lumens, emissiveMeshes: em }));
        } else {
          add(cylinder(0.008, 0.008, Math.max(0.02, h - shadeH - 0.02)), 'metal', 0, 0.02, 0, 'black-metal', '#1a1a1a');
          const y = h - shadeH;
          if (archetype.endsWith('globe')) add(sphere(Math.min(w, shadeH) / 2, { wSeg: 32, hSeg: 20 }), 'shade', 0, y + shadeH / 2, 0, 'glass-opal', '#f3f1ec');
          else if (archetype.endsWith('mushroom') || archetype === 'table-dome') add(sphere(w / 2, { wSeg: 32, hSeg: 12, thetaLength: Math.PI / 2 }), 'shade', 0, y, 0, 'paper', '#f1ead9');
          else add(cylinder(w * 0.42, w / 2, shadeH, { seg: 40, open: true }), 'shade', 0, y, 0, 'linen', '#e8e1d2');
          const em = [bulb(0, y + shadeH * 0.4, 0)];
          lights.push(pointLight([0, y + shadeH * 0.4, 0], { lumens, emissiveMeshes: em }));
        }
      }
      break;
    }
    case 'textile': {
      if (archetype === 'cushion') {
        const lean = P.lean ?? 70; // degrees from the floor (90 = upright)
        const c = add(cushion(w, h, d, { axis: 'z', puff: 0.35, round: 0.9, pinch: 0.5 }), 'fabric', 0, 0, 0, 'woven', '#cfc6b8');
        const tilt = (90 - lean) * DEG;
        c.rotation.x = -tilt;
        // sit on the origin plane: bottom edge at y = 0
        c.position.set(0, (h / 2) * Math.cos(tilt) + (d / 2) * Math.sin(tilt) * 0.6, 0);
      } else if (archetype === 'throw') {
        add(cushion(w, Math.max(0.01, h), d, { axis: 'y', puff: 0.2, round: 0.9, bottom: 0 }), 'fabric', 0, h / 2, 0, 'wool', '#cfc6b8');
      } else if (archetype === 'pouf') {
        add(cylinder(w / 2, w / 2, h, { seg: 40 }), 'fabric', 0, 0, 0, 'boucle', '#cfc6b8');
      } else {
        add(roundedBox(w, Math.max(0.004, h), d, Math.min(0.004, h / 2), 1), 'base', 0, h / 2, 0, 'wool', '#c4c2bf');
      }
      break;
    }
    case 'rug': {
      add(roundedBox(w, Math.max(0.004, h), d, Math.min(0.006, h / 2), 1), 'base', 0, h / 2, 0, 'wool', '#c4c2bf');
      if (P.border) add(box(w + 0.002, Math.max(0.004, h) * 0.98, 0.04), 'accent', 0, h / 2, d / 2 - 0.02, 'wool', C.accent || '#2e2f33');
      break;
    }
    case 'plant': {
      const ped = P.pedestal || P.stand;
      const pedH = ped?.h ?? 0;
      if (ped) {
        const pg = P.pedestal ? box(ped.w ?? w, pedH, ped.d ?? d, { bottom: true }) : cylinder((ped.d ?? w) / 2, (ped.d ?? w) / 2, pedH, { seg: 24, open: true });
        g.add(partMesh(pg, mat('black-metal', ped.color || '#1a1a1a'), null));
      }
      const potR = (P.potD ?? Math.min(w, d) * 0.8) / 2;
      const potH = P.potH ?? Math.min(0.35, (h - pedH) * 0.3);
      add(cylinder(potR, potR * 0.85, potH, { seg: 32 }), 'pot', 0, pedH, 0, 'ceramic', '#e8e4dc');
      const plantH = Math.max(0.05, h - pedH - potH);
      const spread = Math.max(P.spread ?? Math.max(w, d), potR * 2);
      const r = rng(`${archetype}:${h}`);
      const blobs = Math.max(3, Math.round(plantH * 6));
      for (let i = 0; i < blobs; i++) {
        const t = (i + 0.5) / blobs;
        const rad = spread * 0.25 * (0.5 + 0.5 * Math.sin(t * Math.PI));
        const a = r() * Math.PI * 2;
        add(sphere(Math.max(0.03, spread * 0.18 * (1 - t * 0.4)), { wSeg: 10, hSeg: 8 }), 'leaves', Math.cos(a) * rad, pedH + potH + plantH * t, Math.sin(a) * rad, 'plant-leaf', '#4f6b3a');
      }
      break;
    }
    case 'object': {
      if (archetype === 'tv' || archetype === 'speaker') {
        add(roundedBox(w, h, Math.max(0.005, d), 0.004, 1), 'body', 0, 0, d / 2, archetype === 'tv' ? 'glass-smoked' : 'painted', archetype === 'tv' ? '#100e0f' : '#d6d6d4');
        if (archetype === 'tv') {
          const screen = partMesh(box(w * 0.98, h * 0.97, 0.002), mat('lacquer', '#060607'), null, { position: [0, 0, d + 0.001] });
          g.add(screen);
        }
      } else if (archetype === 'vase') {
        const vh = P.h ?? h, vr = (P.d ?? Math.min(w, d)) / 2;
        add(lathe([[0.001, 0], [vr * 0.75, 0], [vr, vh * 0.35], [vr * 0.85, vh * 0.75], [vr * 0.45, vh * 0.95], [vr * 0.5, vh]], { seg: 32 }), 'body', 0, 0, 0, 'ceramic', '#cfc6b8');
        if (P.flowers && P.flowers !== 'none') {
          const sh = P.stemsH ?? h;
          add(sphere(Math.max(0.03, Math.min(0.15, (sh - vh) * 0.4)), { wSeg: 12, hSeg: 8 }), 'flowers', 0, sh - Math.min(0.15, (sh - vh) * 0.4), 0, 'plant-leaf', '#8fa39a');
          add(cylinder(0.004, 0.004, Math.max(0.01, sh - vh)), 'flowers', 0, vh, 0, 'plant-leaf', '#6f8f5a');
        }
      } else if (archetype === 'candle-holder') {
        const n = P.kind === 'tealight' ? Math.max(1, P.count ?? 2) : 1;
        const sp = P.spacing ?? w / n;
        for (let i = 0; i < n; i++) {
          const x = (i - (n - 1) / 2) * sp;
          const r = Math.min(w / n, d) / 2;
          add(cylinder(r, r, h, { seg: 24, open: true }), 'body', x, 0, 0, 'glass-smoked', '#8e9094');
          const candle = partMesh(cylinder(r * 0.5, r * 0.5, Math.min(h * 0.5, 0.05), { seg: 16 }), mat('candle', P.candleColor || '#f2efe8'), null, { position: [x, 0.005, 0] });
          g.add(candle);
        }
      } else if (archetype === 'basket') {
        if (P.shape === 'rect' || P.shape === 'oval') add(roundedBox(w, h, d, Math.min(0.02, h / 2), 2, { bottom: true }), 'body', 0, 0, 0, 'woven', '#8f8d88');
        else add(cylinder(w / 2, w / 2 * 0.95, h, { seg: 32 }), 'body', 0, 0, 0, 'woven', '#8f8d88');
      } else {
        add(roundedBox(w, h, d, 0.01, 2, { bottom: true }), 'body', 0, 0, 0, 'ceramic', '#cfc6b8');
      }
      break;
    }
    case 'framed': {
      const fw = archetype === 'mirror' ? (P.frameW ?? 0.03) : (P.frameW ?? 0.025);
      const depth = Math.max(0.01, P.depth ?? d);
      const printMat = archetype === 'mirror' ? 'mirror' : 'cotton';
      add(box(Math.max(0.01, w - 2 * fw), Math.max(0.01, h - 2 * fw), depth * 0.6), 'print', 0, 0, depth * 0.3 + (fw ? 0 : depth * 0.2), printMat, archetype === 'mirror' ? '#f2f2f2' : '#c9cfcd');
      if (fw > 0) {
        add(box(w, fw, depth), 'frame', 0, h / 2 - fw / 2, depth / 2, 'black-metal', '#1a1a1a');
        add(box(w, fw, depth), 'frame', 0, -h / 2 + fw / 2, depth / 2, 'black-metal', '#1a1a1a');
        add(box(fw, h - 2 * fw, depth), 'frame', -w / 2 + fw / 2, 0, depth / 2, 'black-metal', '#1a1a1a');
        add(box(fw, h - 2 * fw, depth), 'frame', w / 2 - fw / 2, 0, depth / 2, 'black-metal', '#1a1a1a');
      } else add(box(w, h, depth * 0.4), 'frame', 0, 0, depth * 0.2, 'painted', '#464848');
      break;
    }
    case 'acoustic': {
      if (mount === 'ceiling') {
        add(cylinder(0.002, 0.002, 0.3), 'frame', 0, -0.3, 0, 'steel', '#b9bcbf');
        add(roundedBox(w, Math.max(0.02, h), d, 0.005, 1), 'panel', 0, -0.3 - h / 2, 0, 'felt', '#8b8b89');
      } else if (archetype === 'slat-panel') {
        add(box(w, h, 0.012), 'backing', 0, 0, 0.006, 'felt', '#1b1b1b');
        const slatW = P.slatW ?? 0.027, gap = P.gap ?? 0.013;
        const n = Math.max(1, Math.floor((w + gap) / (slatW + gap)));
        const geo = box(slatW, h, Math.max(0.005, d - 0.012), { grain: 'y' });
        const im = new THREE.InstancedMesh(geo, mm('slats', 'oak', '#b08b62'), n);
        const m4 = new THREE.Matrix4();
        const x0 = -((n - 1) * (slatW + gap)) / 2;
        for (let i = 0; i < n; i++) im.setMatrixAt(i, m4.makeTranslation(x0 + i * (slatW + gap), 0, 0.012 + (d - 0.012) / 2));
        tagPart(im, 'slats');
        g.add(im);
      } else if (archetype === 'felt-shape') {
        const geo = extrudeShape(ellipseShape(w, h, 6), Math.max(0.005, d));
        worldUV(geo);
        add(geo, 'panel', 0, 0, 0, 'felt', '#8b8b89');
      } else {
        add(roundedBox(w, h, Math.max(0.01, d), 0.008, 2), 'panel', 0, 0, d / 2, archetype === 'acoustic-art' ? 'cotton' : 'felt', '#8b8b89');
      }
      break;
    }
    default: {
      // unknown family: a translucent-free grey box with the mount's origin convention
      const geo = roundedBox(w, h, d, Math.min(0.01, w / 4, h / 4, d / 4), 1);
      const y = mount === 'wall' ? 0 : mount === 'ceiling' ? -h / 2 : h / 2;
      const z = mount === 'wall' ? d / 2 : 0;
      add(geo, 'body', 0, y, z, 'plastic', color || '#9a9a9a');
    }
  }
  return finishModel(g, { lights, surfaces, seatY, colliders });
}
