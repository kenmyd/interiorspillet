import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Building kit (copied from Kraftverkspillet): helpers for constructing architecture in code.
 *
 *  - MeshBatcher / BatchFrame: queue many small static parts (in any local frame) and merge them into one mesh
 *    per material at the end – the main draw-call saver for buildings.
 *  - Shapes: walls with notches (doors) and holes (windows), I-profiles, polygons.
 *  - Geometry: extruded walls with separate front/back/side groups, ribbed (trapezoidal) roof sheeting,
 *    half-round gutters, pipes along polylines, flat-shaded primitives, world-scaled box UVs.
 *
 * Conventions: metres; UVs produced here are in metres, so a material's texture.repeat = 1 / tileSizeInMetres
 * gives the same texel density everywhere.
 */

const KEEP_ATTRS = ['position', 'normal', 'uv'];
const _m = new THREE.Matrix4();
const _e = new THREE.Euler();
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3(1, 1, 1);
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _n = new THREE.Vector3();

/* ------------------------------------------------------------------ matrices */

/**
 * Compose a matrix from a position and Euler rotation (radians, XYZ order unless given).
 * @returns {THREE.Matrix4}
 */
export function place(x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, order = 'XYZ') {
  _e.set(rx, ry, rz, order);
  _q.setFromEuler(_e);
  return new THREE.Matrix4().compose(_v.set(x, y, z), _q, _s);
}

/** Matrix from an orthonormal basis (columns) and an origin. */
export function basis(xAxis, yAxis, zAxis, origin) {
  const m = new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis);
  m.setPosition(origin);
  return m;
}

/* ------------------------------------------------------------------ geometry prep */

/** Clone a geometry as non-indexed with only position/normal/uv (what mergeGeometries needs to be uniform). */
function prepGeometry(geometry) {
  const g = geometry.index ? geometry.toNonIndexed() : geometry.clone();
  for (const name of Object.keys(g.attributes)) if (!KEEP_ATTRS.includes(name)) g.deleteAttribute(name);
  g.morphAttributes = {};
  if (!g.attributes.normal) g.computeVertexNormals();
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  return g;
}

/** Merged batches smaller than this (vertices) stay non-indexed – welding them saves next to nothing. */
const WELD_MIN_VERTICES = 3000;
/** Vertex attributes are compared after quantising to this many steps per unit (1e-5 m, normal and uv). */
const WELD_SCALE = 1e5;

/**
 * Weld equal vertices (position, normal and uv the same to 1e-5) of a non-indexed position/normal/uv geometry into an
 * indexed one. A merged batch repeats every shared vertex of its parts (≈ 3 vertices per triangle); cylinders, tubes
 * and nuts share their ring vertices, so this typically cuts vertex memory and vertex work 2–3×. Hard edges keep
 * their separate vertices (different normals). Open-addressing hash on the quantised values – fast enough for a few
 * 100k vertices at load.
 * @returns {THREE.BufferGeometry} a new indexed geometry, or `geometry` itself when nothing would be gained
 */
function weldVertices(geometry) {
  const attrs = KEEP_ATTRS.map((name) => geometry.attributes[name]);
  const count = attrs[0].count;
  const stride = attrs.reduce((s, a) => s + a.itemSize, 0);
  const q = new Int32Array(count * stride);
  for (let i = 0, o = 0; i < count; i++) {
    for (const a of attrs) for (let k = 0; k < a.itemSize; k++) q[o++] = Math.round(a.array[i * a.itemSize + k] * WELD_SCALE);
  }
  let size = 1;
  while (size < count * 2) size <<= 1;
  const table = new Int32Array(size).fill(-1);
  const index = new Uint32Array(count);
  const source = new Uint32Array(count); // original vertex of each welded vertex
  let n = 0;
  for (let i = 0; i < count; i++) {
    const o = i * stride;
    let h = 2166136261;
    for (let k = 0; k < stride; k++) h = Math.imul(h ^ q[o + k], 16777619);
    for (let slot = h & (size - 1); ; slot = (slot + 1) & (size - 1)) {
      const j = table[slot];
      if (j < 0) {
        table[slot] = n;
        source[n] = i;
        index[i] = n++;
        break;
      }
      const oj = source[j] * stride;
      let k = 0;
      while (k < stride && q[oj + k] === q[o + k]) k++;
      if (k === stride) {
        index[i] = j;
        break;
      }
    }
  }
  if (n > count * 0.9) return geometry;
  const out = new THREE.BufferGeometry();
  KEEP_ATTRS.forEach((name, a) => {
    const src = attrs[a], s = src.itemSize;
    const arr = new Float32Array(n * s);
    for (let v = 0; v < n; v++) for (let k = 0; k < s; k++) arr[v * s + k] = src.array[source[v] * s + k];
    out.setAttribute(name, new THREE.BufferAttribute(arr, s));
  });
  out.setIndex(new THREE.BufferAttribute(n > 65535 ? index : Uint16Array.from(index), 1));
  return out;
}

/** Split a non-indexed geometry into one geometry per group. */
function splitGroups(g) {
  if (!g.groups.length) return [{ geometry: g, materialIndex: 0 }];
  return g.groups.map((gr) => {
    const sub = new THREE.BufferGeometry();
    for (const [name, attr] of Object.entries(g.attributes)) {
      const s = attr.itemSize;
      sub.setAttribute(name, new THREE.BufferAttribute(attr.array.slice(gr.start * s, (gr.start + gr.count) * s), s));
    }
    return { geometry: sub, materialIndex: gr.materialIndex ?? 0 };
  });
}

/**
 * Replace UVs with a world-space box projection (metres): each triangle is projected onto the plane of its dominant
 * normal axis, oriented as seen from outside (u to the right, v up; on horizontal faces u = x, v = -z / z).
 * Adjacent boxes then share a continuous texture.
 */
export function applyBoxUV(geometry, scale = 1) {
  const pos = geometry.attributes.position;
  const uv = geometry.attributes.uv ?? new THREE.BufferAttribute(new Float32Array(pos.count * 2), 2);
  for (let i = 0; i < pos.count; i += 3) {
    _a.fromBufferAttribute(pos, i);
    _b.fromBufferAttribute(pos, i + 1);
    _c.fromBufferAttribute(pos, i + 2);
    _n.subVectors(_c, _b).cross(_v.subVectors(_a, _b)).normalize();
    const ax = Math.abs(_n.x), ay = Math.abs(_n.y), az = Math.abs(_n.z);
    for (let k = 0; k < 3; k++) {
      const p = k === 0 ? _a : k === 1 ? _b : _c;
      let u, v;
      if (ax >= ay && ax >= az) {
        u = _n.x > 0 ? -p.z : p.z;
        v = p.y;
      } else if (az >= ay) {
        u = _n.z > 0 ? p.x : -p.x;
        v = p.y;
      } else {
        u = p.x;
        v = _n.y > 0 ? -p.z : p.z;
      }
      uv.setXY(i + k, u * scale, v * scale);
    }
  }
  geometry.setAttribute('uv', uv);
  uv.needsUpdate = true;
  return geometry;
}

/** Non-indexed copy with per-face normals (crisp facets for low-poly cones, pyramids, prisms). */
export function flatShaded(geometry) {
  const g = geometry.index ? geometry.toNonIndexed() : geometry.clone();
  g.deleteAttribute('normal');
  g.computeVertexNormals();
  return g;
}

/* ------------------------------------------------------------------ batcher */

/**
 * Collects static geometry and merges it per material. Typical use:
 *
 *   const kit = new MeshBatcher('building');
 *   const wall = kit.frame(wallMatrix);                // parts placed in the wall's local frame
 *   wall.box(0.1, 2, 0.02, x, 1, 0.01, mats.trim, { collide: false });
 *   kit.add(extrudedWall, [mats.plaster, null, mats.plaster], { matrix: wallMatrix });   // null drops a group
 *   const group = kit.build();                         // one Mesh per material/flag combination
 *
 * Meshes built from parts added with collide:false get userData.noCollide = true (skipped by CollisionWorld).
 * Big merged meshes are welded into indexed geometry (shared vertices stored once, see weldVertices).
 */
export class MeshBatcher {
  /**
   * @param {string} [name]
   * @param {{castShadow?: boolean}} [o]  castShadow: force this flag on every part, ignoring the per-part option – a
   *   material's parts then end up in one mesh instead of a casting and a non-casting one
   */
  constructor(name = 'batch', { castShadow } = {}) {
    this.name = name;
    this.castShadow = castShadow;
    this._buckets = new Map();
    this.geometries = [];
  }

  /**
   * Queue a geometry (it is copied; the original can be reused or disposed).
   * @param {THREE.BufferGeometry} geometry
   * @param {THREE.Material|Array<THREE.Material|null>} material  array → per geometry group, null drops the group
   * @param {object} [o]
   * @param {THREE.Matrix4} [o.matrix]      geometry space → batch space
   * @param {boolean} [o.collide=true]      include in static collision
   * @param {boolean} [o.castShadow=true]
   * @param {boolean} [o.receiveShadow=true]
   * @param {boolean|number} [o.boxUV=false] true/scale → world-space box-projected UVs (after transforming)
   */
  add(geometry, material, o = {}) {
    const g = prepGeometry(geometry);
    if (o.matrix) g.applyMatrix4(o.matrix);
    const parts = Array.isArray(material) ? splitGroups(g) : [{ geometry: g, materialIndex: -1 }];
    for (const part of parts) {
      const mat = part.materialIndex < 0 ? material : material[part.materialIndex];
      if (!mat) continue;
      const pg = part.geometry;
      pg.clearGroups();
      if (o.boxUV) applyBoxUV(pg, typeof o.boxUV === 'number' ? o.boxUV : 1);
      const collide = o.collide ?? true;
      const cast = this.castShadow ?? o.castShadow ?? true;
      const receive = o.receiveShadow ?? true;
      const key = `${mat.uuid}|${collide ? 1 : 0}${cast ? 1 : 0}${receive ? 1 : 0}`;
      let bucket = this._buckets.get(key);
      if (!bucket) {
        bucket = { material: mat, collide, cast, receive, list: [] };
        this._buckets.set(key, bucket);
      }
      bucket.list.push(pg);
    }
    return this;
  }

  /**
   * Queue a box w×h×d centred at (x,y,z). o.rot = [rx,ry,rz] rotates it about its centre; o.matrix (frame)
   * is applied afterwards. Box UVs are world-projected by default (o.boxUV !== false).
   */
  box(w, h, d, x, y, z, material, o = {}) {
    const geo = new THREE.BoxGeometry(w, h, d);
    const r = o.rot ?? [0, 0, 0];
    const m = place(x, y, z, r[0], r[1], r[2], o.order);
    if (o.matrix) m.premultiply(o.matrix);
    this.add(geo, material, { ...o, matrix: m, boxUV: o.boxUV ?? true });
    geo.dispose();
    return this;
  }

  /** Queue a vertical cylinder (axis along local y) centred at (x,y,z); o.rot rotates it. */
  cylinder(rTop, rBottom, h, x, y, z, material, o = {}) {
    const geo = new THREE.CylinderGeometry(rTop, rBottom, h, o.segments ?? 16, 1, o.openEnded ?? false);
    const r = o.rot ?? [0, 0, 0];
    const m = place(x, y, z, r[0], r[1], r[2], o.order);
    if (o.matrix) m.premultiply(o.matrix);
    this.add(geo, material, { ...o, matrix: m });
    geo.dispose();
    return this;
  }

  /** A view of this batcher whose parts are placed in a local frame (matrix applied before o.matrix). */
  frame(matrix) {
    return new BatchFrame(this, matrix);
  }

  /** Snapshot of what is queued so far, for rollback(). */
  mark() {
    return new Map([...this._buckets].map(([key, bucket]) => [key, bucket.list.length]));
  }

  /** Drop (and dispose) every part queued since `mark` was taken – e.g. the parts of a builder that threw halfway. */
  rollback(mark) {
    for (const [key, bucket] of this._buckets) {
      for (const g of bucket.list.splice(mark.get(key) ?? 0)) g.dispose();
      if (!bucket.list.length) this._buckets.delete(key);
    }
  }

  /** Merge everything queued so far into a Group (one Mesh per material/flags). The batcher is emptied. */
  build() {
    const group = new THREE.Group();
    group.name = this.name;
    for (const bucket of this._buckets.values()) {
      let merged = mergeGeometries(bucket.list, false);
      for (const g of bucket.list) g.dispose();
      if (!merged) continue;
      if (merged.attributes.position.count > WELD_MIN_VERTICES) {
        const welded = weldVertices(merged);
        if (welded !== merged) merged.dispose();
        merged = welded;
      }
      merged.computeBoundingBox();
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, bucket.material);
      mesh.name = `${this.name}:${bucket.material.name || 'mat'}`;
      mesh.castShadow = bucket.cast;
      mesh.receiveShadow = bucket.receive;
      mesh.matrixAutoUpdate = false;
      if (!bucket.collide) mesh.userData.noCollide = true;
      group.add(mesh);
      this.geometries.push(merged);
    }
    this._buckets.clear();
    return group;
  }
}

/** A MeshBatcher view with a fixed local frame. Same API as MeshBatcher (add/box/cylinder/frame). */
export class BatchFrame {
  constructor(batcher, matrix) {
    this.batcher = batcher;
    this.matrix = matrix.clone();
  }

  _m(o) {
    return o.matrix ? this.matrix.clone().multiply(o.matrix) : this.matrix;
  }

  add(geometry, material, o = {}) {
    this.batcher.add(geometry, material, { ...o, matrix: this._m(o) });
    return this;
  }

  box(w, h, d, x, y, z, material, o = {}) {
    this.batcher.box(w, h, d, x, y, z, material, { ...o, matrix: this._m(o) });
    return this;
  }

  cylinder(rTop, rBottom, h, x, y, z, material, o = {}) {
    this.batcher.cylinder(rTop, rBottom, h, x, y, z, material, { ...o, matrix: this._m(o) });
    return this;
  }

  frame(matrix) {
    return new BatchFrame(this.batcher, this.matrix.clone().multiply(matrix));
  }

  /** Transform a local point into batch space. */
  point(x, y, z, target = new THREE.Vector3()) {
    return target.set(x, y, z).applyMatrix4(this.matrix);
  }
}

/* ------------------------------------------------------------------ shapes */

const v2 = (x, y) => new THREE.Vector2(x, y);

/**
 * Wall outline with door notches and window holes, in the wall's 2D frame (x along the wall, y up).
 * @param {Array<[number,number]>} outline  closed polygon, counter-clockwise; outline[0] → outline[1] must be the
 *   horizontal bottom edge (left → right).
 * @param {Array<{x0:number,x1:number,y0:number,y1:number}>} openings  rectangles; those reaching the bottom edge
 *   (y0 ≤ bottom) become notches, the others holes.
 * @returns {THREE.Shape}
 */
export function wallShape(outline, openings = []) {
  const yb = outline[0][1];
  const eps = 1e-4;
  const notches = openings.filter((o) => o.y0 <= yb + eps).sort((p, q) => p.x0 - q.x0);
  const pts = [v2(outline[0][0], yb)];
  for (const n of notches) pts.push(v2(n.x0, yb), v2(n.x0, n.y1), v2(n.x1, n.y1), v2(n.x1, yb));
  for (let i = 1; i < outline.length; i++) pts.push(v2(outline[i][0], outline[i][1]));
  const shape = new THREE.Shape(dedupe(pts));
  for (const o of openings) {
    if (o.y0 <= yb + eps) continue;
    shape.holes.push(new THREE.Path([v2(o.x0, o.y0), v2(o.x0, o.y1), v2(o.x1, o.y1), v2(o.x1, o.y0)]));
  }
  return shape;
}

/**
 * Horizontal band (y0..y1, x0..x1) with rectangular notches cut down from the top edge to `n.y` (e.g. a plinth that
 * drops to floor level under doors).
 * @param {Array<{x0:number,x1:number,y:number}>} notches
 */
export function bandWithTopNotches(x0, x1, y0, y1, notches = []) {
  const pts = [v2(x0, y0), v2(x1, y0), v2(x1, y1)];
  const sorted = [...notches].sort((p, q) => q.x1 - p.x1); // walk the top edge right → left
  for (const n of sorted) pts.push(v2(n.x1, y1), v2(n.x1, n.y), v2(n.x0, n.y), v2(n.x0, y1));
  pts.push(v2(x0, y1));
  return new THREE.Shape(dedupe(pts));
}

/** Polygon shape from [[x,y],...]. */
export function polygonShape(points) {
  return new THREE.Shape(dedupe(points.map(([x, y]) => v2(x, y))));
}

function dedupe(pts) {
  const out = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (!last || last.distanceToSquared(p) > 1e-10) out.push(p);
  }
  if (out.length > 2 && out[0].distanceToSquared(out[out.length - 1]) < 1e-10) out.pop();
  return out;
}

/**
 * I-beam (HEB/IPE style) cross-section centred on the origin: depth h along y, flange width b along x.
 * @param {number} h  section depth   @param {number} b flange width
 * @param {number} tw web thickness   @param {number} tf flange thickness
 */
export function iProfileShape(h, b, tw, tf) {
  const hh = h / 2, hb = b / 2, ht = tw / 2;
  return polygonShape([
    [-hb, -hh], [hb, -hh], [hb, -hh + tf], [ht, -hh + tf], [ht, hh - tf], [hb, hh - tf],
    [hb, hh], [-hb, hh], [-hb, hh - tf], [-ht, hh - tf], [-ht, -hh + tf], [-hb, -hh + tf],
  ]);
}

/* ------------------------------------------------------------------ geometries */

/**
 * Extrude a shape along +z from z0 to z0 + depth (no bevel). Material groups:
 *   0 = back cap (z = z0, normal −z), 1 = front cap (z = z0 + depth, normal +z), 2 = side walls (edges, reveals).
 * UVs are in metres (shape x/y on the caps; along-edge × depth on the sides).
 */
export function extrudeWall(shape, depth, z0 = 0) {
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 6, steps: 1 });
  // ExtrudeGeometry emits the lid as one group: all bottom faces, then the same number of top faces.
  const lid = g.groups.find((gr) => gr.materialIndex === 0);
  const side = g.groups.find((gr) => gr.materialIndex === 1);
  g.clearGroups();
  if (lid) {
    const half = lid.count / 2;
    g.addGroup(lid.start, half, 0);
    g.addGroup(lid.start + half, half, 1);
  }
  if (side) g.addGroup(side.start, side.count, 2);
  if (z0) g.translate(0, 0, z0);
  return g;
}

/**
 * Copy of a geometry without the triangles for which `remove(normal)` returns true (face normal in geometry
 * space). Groups are dropped – use it for single-material parts, e.g. a roof slab whose top is covered by sheeting
 * (coplanar hidden faces z-fight from a distance).
 * @param {THREE.BufferGeometry} geometry
 * @param {(n: THREE.Vector3) => boolean} remove
 * @returns {THREE.BufferGeometry} non-indexed
 */
export function withoutFaces(geometry, remove) {
  const src = geometry.index ? geometry.toNonIndexed() : geometry;
  const pos = src.attributes.position;
  const keep = [];
  for (let i = 0; i < pos.count; i += 3) {
    _a.fromBufferAttribute(pos, i);
    _b.fromBufferAttribute(pos, i + 1);
    _c.fromBufferAttribute(pos, i + 2);
    _n.subVectors(_c, _b).cross(_v.subVectors(_a, _b)).normalize();
    if (!remove(_n)) keep.push(i);
  }
  const out = new THREE.BufferGeometry();
  for (const [name, attr] of Object.entries(src.attributes)) {
    const s = attr.itemSize;
    const arr = new attr.array.constructor(keep.length * 3 * s);
    keep.forEach((i, k) => arr.set(attr.array.subarray(i * s, (i + 3) * s), k * 3 * s));
    out.setAttribute(name, new THREE.BufferAttribute(arr, s, attr.normalized));
  }
  if (src !== geometry) src.dispose();
  return out;
}

/**
 * Trapezoidal steel roof sheeting. Local frame: x across the ribs (0..width), y = up from the sheet base,
 * z along the ribs (0..length). Flat-shaded facets. UVs in metres (u = x, v = z).
 * Material groups: 0 = the sheet, 1 = the profile closures under the ribs at both ends (black foam fillers on a
 * real roof – give them a dark material).
 */
export function ribbedSheetGeometry({ width, length, period = 0.2, ribHeight = 0.03, crest = 0.035, flank = 0.025 }) {
  const valley = Math.max(0.01, period - crest - 2 * flank);
  const prof = [[0, 0]];
  for (let x0 = 0; x0 < width - 1e-6; x0 += period) {
    const pts = [
      [x0 + valley, 0], [x0 + valley + flank, ribHeight], [x0 + valley + flank + crest, ribHeight], [x0 + period, 0],
    ];
    for (const p of pts) prof.push(p);
  }
  // clip the profile at `width`
  const clipped = [prof[0]];
  for (let i = 1; i < prof.length; i++) {
    const [ax, ay] = prof[i - 1], [bx, by] = prof[i];
    if (bx <= width) clipped.push(prof[i]);
    else {
      if (ax < width) clipped.push([width, ay + ((by - ay) * (width - ax)) / (bx - ax)]);
      break;
    }
  }

  const pos = [], nor = [], uv = [];
  const cPos = [], cNor = [], cUv = []; // closures, appended after the sheet as group 1
  const quad = (p0, p1, p2, p3, n) => {
    for (const p of [p0, p1, p2, p0, p2, p3]) {
      pos.push(p[0], p[1], p[2]);
      nor.push(n[0], n[1], n[2]);
      uv.push(p[0], p[2]);
    }
  };
  for (let i = 1; i < clipped.length; i++) {
    const [ax, ay] = clipped[i - 1], [bx, by] = clipped[i];
    const dx = bx - ax, dy = by - ay;
    const l = Math.hypot(dx, dy) || 1;
    const n = [-dy / l, dx / l, 0];
    // counter-clockwise seen from above (+y): a@z=length, b@z=length, b@0, a@0
    quad([ax, ay, length], [bx, by, length], [bx, by, 0], [ax, ay, 0], n);
    // end closures under raised parts
    if (ay > 1e-6 || by > 1e-6) {
      tri(cPos, cNor, cUv, [ax, 0, length], [bx, 0, length], [bx, by, length], [0, 0, 1]);
      tri(cPos, cNor, cUv, [ax, 0, length], [bx, by, length], [ax, ay, length], [0, 0, 1]);
      tri(cPos, cNor, cUv, [bx, 0, 0], [ax, 0, 0], [ax, ay, 0], [0, 0, -1]);
      tri(cPos, cNor, cUv, [bx, 0, 0], [ax, ay, 0], [bx, by, 0], [0, 0, -1]);
    }
  }
  const sheetVerts = pos.length / 3;
  pos.push(...cPos);
  nor.push(...cNor);
  uv.push(...cUv);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.addGroup(0, sheetVerts, 0);
  g.addGroup(sheetVerts, cPos.length / 3, 1);
  return g;
}

function tri(pos, nor, uv, a, b, c, n) {
  for (const p of [a, b, c]) {
    pos.push(p[0], p[1], p[2]);
    nor.push(n[0], n[1], n[2]);
    uv.push(p[0], p[1]);
  }
}

/**
 * Half-round gutter along +x (0..length), opening upwards, centred on the x axis, rolled front bead on the +z side.
 * @param {number} r  radius   @param {number} t wall thickness
 */
export function gutterGeometry(length, r = 0.065, t = 0.004, segments = 12) {
  const shape = new THREE.Shape();
  // outer arc from back rim (−z side, angle π) under to the front rim (angle 0); shape plane = (z, y)
  for (let i = 0; i <= segments; i++) {
    const a = Math.PI + (i / segments) * Math.PI;
    const x = Math.cos(a) * r, y = Math.sin(a) * r;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  // front bead
  shape.lineTo(r + 0.008, 0.006);
  shape.lineTo(r - t, 0.006);
  for (let i = segments; i >= 0; i--) {
    const a = Math.PI + (i / segments) * Math.PI;
    shape.lineTo(Math.cos(a) * (r - t), Math.sin(a) * (r - t));
  }
  const g = new THREE.ExtrudeGeometry(shape, { depth: length, bevelEnabled: false, curveSegments: 4 });
  // extrusion along +z → rotate so it runs along x (0..length); shape x becomes world +z (bead on the +z side)
  g.rotateY(-Math.PI / 2);
  g.translate(length, 0, 0);
  return g;
}

/** Half disc closing a gutter end (plane x = 0, facing ±x). */
export function gutterEndGeometry(r = 0.065, segments = 12) {
  const shape = new THREE.Shape();
  shape.moveTo(-r, 0);
  for (let i = 0; i <= segments; i++) {
    const a = Math.PI + (i / segments) * Math.PI;
    shape.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  const g = new THREE.ExtrudeGeometry(shape, { depth: 0.004, bevelEnabled: false });
  g.rotateY(Math.PI / 2);
  return g;
}

/**
 * Round pipe through a polyline: cylinders between the points with sphere joints (elbows).
 * @param {Array<THREE.Vector3|[number,number,number]>} points
 * @returns {THREE.BufferGeometry} non-indexed, merged
 */
export function pipeGeometry(points, radius, radialSegments = 12) {
  const pts = points.map((p) => (Array.isArray(p) ? new THREE.Vector3(...p) : p));
  const parts = [];
  const up = new THREE.Vector3(0, 1, 0);
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const dir = new THREE.Vector3().subVectors(b, a);
    const len = dir.length();
    if (len < 1e-5) continue;
    const g = new THREE.CylinderGeometry(radius, radius, len, radialSegments, 1, true);
    const q = new THREE.Quaternion().setFromUnitVectors(up, dir.normalize());
    g.applyQuaternion(q);
    g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
    parts.push(prepGeometry(g));
    g.dispose();
  }
  for (let i = 1; i < pts.length - 1; i++) {
    const s = new THREE.SphereGeometry(radius, radialSegments, Math.max(4, radialSegments / 2));
    s.translate(pts[i].x, pts[i].y, pts[i].z);
    parts.push(prepGeometry(s));
    s.dispose();
  }
  const merged = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  return merged;
}

/** Four-sided pyramid (square base side `size`, apex height h) with a closed base, flat-shaded, base at y = 0. */
export function pyramidGeometry(size, h) {
  const g = new THREE.ConeGeometry(size / Math.SQRT2, h, 4, 1, false);
  g.rotateY(Math.PI / 4);
  g.translate(0, h / 2, 0);
  return flatShaded(g);
}

/** Prism from a 2D polygon in the (z, y) plane extruded along x from x0 to x1 (e.g. a wedge or ramp). */
export function prismX(points, x0, x1) {
  const shape = polygonShape(points.map(([z, y]) => [-z, y]));
  const g = new THREE.ExtrudeGeometry(shape, { depth: x1 - x0, bevelEnabled: false });
  // extrude axis z → world x; shape x (= −z) → world z
  g.rotateY(Math.PI / 2);
  g.translate(x0, 0, 0);
  return g;
}
