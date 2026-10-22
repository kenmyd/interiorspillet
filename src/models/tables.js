import * as THREE from 'three';
import schema from '../data/archetypes.json';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import * as K from './kit.js';
import { mat, emissive, isTransparentKind, kindGroup } from '../home/materials.js';

/**
 * Procedural tables and storage (ARCHITECTURE §5, parts §13): coffee tables, nesting tables, the dining table, side
 * tables, sideboards, TV benches and the wall shelf. Every builder measures itself against spec.dims (metres) and
 * rebuilds its parts from it – legs keep their section, panels their thickness, ribs their pitch – so resizing never
 * just stretches the model.
 *
 * Parts: body (korpus/understell/ramme), front (fronter), top (plate), legs (ben), handle (håndtak).
 *
 * Reference pieces in the real room (bilder_stue): the TV-stue coffee table (082726: square-tube box frame with a
 * bottom rectangle on the floor, dark slab top), the two round nesting tables (082809, 082905: black edge band round
 * a dark oak top, four thin rods to a floor ring), the stadium dining table (082905, 082909, 082941: thin top with a
 * light chamfer underneath, two extension leaves, two A-frames of black flat steel splayed across the width ≈ 0.40
 * in from the ends) and the black lattice wall shelf over the sofa (082726, 082809).
 *
 * Also the flexible coffee-table (salongbord, sidebord, konsollbord, pidestall, round nightstands; design/furniture.md
 * §3.1), fabric (speaker-cloth) cabinet fronts and the wall shelf's box style.
 *
 * Exports: `archetypes` (the Def table for registry.js), `buildCabinet`, `recolorer`, the geometry helper
 * `ribPanelGeometry` and the table helpers listed at the end of the file (desks.js builds on them).
 */

// ---------------------------------------------------------------------------------------------------------------
// Small helpers

const num = (v, fb) => (typeof v === 'number' && Number.isFinite(v) ? v : fb);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const WHITE = new THREE.Color(1, 1, 1);
const STONE = new Set(['marble-dark', 'marble-white', 'travertine', 'ceramic']);

/** Segment count scaled by the model quality. */
function qSeg(spec, n) {
  const f = spec.quality === 'low' ? 0.5 : spec.quality === 'high' ? 1.5 : 1;
  return Math.max(3, Math.round(n * f));
}

/** Darker (f < 1) or lighter (f > 1, toward white) version of a colour. */
function tone(hex, f) {
  const c = new THREE.Color(hex || '#808080');
  if (f <= 1) c.multiplyScalar(f);
  else c.lerp(WHITE, Math.min(1, f - 1));
  return `#${c.getHexString()}`;
}

/** Cached material of a part (kind from spec.materials, colour from spec.colors). */
function pm(spec, part, fallbackKind, opts) {
  return mat(spec.materials?.[part] || fallbackKind, spec.colors?.[part], opts);
}

/** Adds a part mesh to a group and returns it. */
function add(g, geo, material, part, x = 0, y = 0, z = 0, rot) {
  const m = K.partMesh(geo, material, part, { position: [x, y, z], rotation: rot });
  g.add(m);
  return m;
}

/** Interior shadow material (behind door gaps, through cane) – not a part, never recoloured. */
const darkInside = () => mat('painted', '#15120f', { flat: true, roughness: 0.95 });

/**
 * userData.model.recolor for SceneSync: swaps cached materials per part like the default path, but asks for a
 * rebuild (returns false) when `needsRebuild(part, kind)` says the part's look depends on derived materials.
 */
export function recolorer(group, needsRebuild = () => false) {
  return (part, hex, kind) => {
    const meshes = group.userData.model?.parts?.[part];
    if (!meshes?.length) return true;
    if (needsRebuild(part, kind)) return false;
    for (const m of meshes) {
      const ud = m.material?.userData;
      if (!ud?.cached || !ud.kind || ud.kind === 'emissive' || ud.kind === 'paint') return false;
      if (isTransparentKind(kind || ud.kind) !== isTransparentKind(ud.kind)) return false;
    }
    for (const m of meshes) {
      const ud = m.material.userData;
      m.material = mat(kind || ud.kind, hex || ud.hex, ud.opts);
    }
    return true;
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Geometry

/** Minimal indexed geometry builder (position, normal, uv). */
class GeoBuilder {
  constructor() {
    this.pos = [];
    this.nrm = [];
    this.uv = [];
    this.idx = [];
  }

  v(x, y, z, nx, ny, nz, u, w) {
    this.pos.push(x, y, z);
    this.nrm.push(nx, ny, nz);
    this.uv.push(u, w);
    return this.pos.length / 3 - 1;
  }

  /**
   * Planar convex polygon with a given normal; the winding is fixed to face the normal.
   * @param {number[][]} pts [[x,y,z], …]  @param {number[]} n  @param {(p: number[]) => [number, number]} uvf
   */
  poly(pts, n, uvf) {
    const [a, b, c] = pts;
    const cx = (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]);
    const cy = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
    const cz = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    const list = cx * n[0] + cy * n[1] + cz * n[2] < 0 ? [...pts].reverse() : pts;
    const ids = list.map((p) => {
      const [u, w] = uvf(p);
      return this.v(p[0], p[1], p[2], n[0], n[1], n[2], u, w);
    });
    for (let i = 1; i < ids.length - 1; i++) this.idx.push(ids[0], ids[i], ids[i + 1]);
  }

  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.idx);
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return g;
  }
}

/**
 * Panel with a reeded (convex, half-round-ish) front – ribbed veneer, tambour doors, fluted glass. The back face lies
 * in z = 0, the solid base is `t` thick and the ribs rise `depth` above it (sharp V where two ribs meet). Centred in
 * x and y. UVs in metres with U along y, so wood grain runs along the ribs.
 * @param {number} w  width (m) @param {number} h  height (m)
 * @param {{ pitch?: number, depth?: number, t?: number, seg?: number }} [o]  rib pitch (m), rib height, base thickness,
 *   segments per rib arc
 * @returns {THREE.BufferGeometry}
 */
export function ribPanelGeometry(w, h, { pitch = 0.016, depth = 0.0045, t = 0.014, seg = 6 } = {}) {
  const n = Math.max(1, Math.round(w / pitch));
  const p = w / n;
  const s = Math.max(1e-4, Math.min(depth, p / 2));
  const R = (p * p) / 4 / (2 * s) + s / 2;
  const alpha = Math.asin(Math.min(1, p / 2 / R));
  const y0 = -h / 2, y1 = h / 2;
  const B = new GeoBuilder();
  const prof = [];
  for (let i = 0; i < n; i++) {
    const xc = -w / 2 + (i + 0.5) * p;
    const zc = t + s - R;
    const pts = [];
    for (let k = 0; k <= seg; k++) {
      const th = -alpha + (2 * alpha * k) / seg;
      pts.push([xc + R * Math.sin(th), zc + R * Math.cos(th), Math.sin(th), Math.cos(th)]);
    }
    pts[0][1] = t;
    pts[seg][1] = t;
    prof.push(pts);
    // front strip, smooth across the rib
    const base = B.pos.length / 3;
    for (const [x, z, nx, nz] of pts) {
      B.v(x, y0, z, nx, 0, nz, y0, x);
      B.v(x, y1, z, nx, 0, nz, y1, x);
    }
    for (let k = 0; k < seg; k++) {
      const a = base + k * 2;
      B.idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
    // end caps (top and bottom) of the rib: the circular segment above the base slab (convex → one fan)
    if (seg > 1) {
      for (const [y, ny] of [[y1, 1], [y0, -1]]) B.poly(pts.map(([x, z]) => [x, y, z]), [0, ny, 0], (q) => [q[0], q[2]]);
    }
  }
  // end caps of the base slab
  for (const [y, ny] of [[y1, 1], [y0, -1]]) B.poly([[-w / 2, y, 0], [w / 2, y, 0], [w / 2, y, t], [-w / 2, y, t]], [0, ny, 0], (q) => [q[0], q[2]]);
  // sides and back
  for (const sx of [-1, 1]) B.poly([[sx * w / 2, y0, 0], [sx * w / 2, y1, 0], [sx * w / 2, y1, t], [sx * w / 2, y0, t]], [sx, 0, 0], (q) => [q[1], q[2]]);
  B.poly([[-w / 2, y0, 0], [w / 2, y0, 0], [w / 2, y1, 0], [-w / 2, y1, 0]], [0, 0, -1], (q) => [q[1], q[0]]);
  return B.build();
}

/** Plan outline points (Vector2, shape space x / −z) of a rounded rectangle. */
function roundRectPts(w, d, r, n = 8) {
  const rr = clamp(r, 0, Math.min(w, d) / 2 - 1e-4);
  const out = [];
  const corners = [[w / 2 - rr, -d / 2 + rr, -Math.PI / 2], [w / 2 - rr, d / 2 - rr, 0], [-w / 2 + rr, d / 2 - rr, Math.PI / 2], [-w / 2 + rr, -d / 2 + rr, Math.PI]];
  for (const [cx, cy, a0] of corners) {
    if (rr < 1e-4) out.push(new THREE.Vector2(cx, cy));
    else for (let k = 0; k <= n; k++) {
      const a = a0 + (k / n) * (Math.PI / 2);
      out.push(new THREE.Vector2(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr));
    }
  }
  return out;
}

/** Stadium (semicircular ends along x) outline points. */
function stadiumPts(w, d, n = 24) {
  const r = Math.min(w, d) / 2;
  const cx = Math.max(0, w / 2 - r);
  const out = [];
  for (let k = 0; k <= n; k++) {
    const a = -Math.PI / 2 + (k / n) * Math.PI;
    out.push(new THREE.Vector2(cx + Math.cos(a) * r, Math.sin(a) * r));
  }
  for (let k = 0; k <= n; k++) {
    const a = Math.PI / 2 + (k / n) * Math.PI;
    out.push(new THREE.Vector2(-cx + Math.cos(a) * r, Math.sin(a) * r));
  }
  return out;
}

/** Ellipse outline points. */
function ellipsePts(w, d, n = 64) {
  const out = [];
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2;
    out.push(new THREE.Vector2((Math.cos(a) * w) / 2, (Math.sin(a) * d) / 2));
  }
  return out;
}

/** Sutherland–Hodgman clip of a polygon against one axis-aligned half plane. */
function clipHalf(pts, axis, value, keepAbove) {
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const av = a[axis] - value, bv = b[axis] - value;
    const ain = keepAbove ? av >= -1e-9 : av <= 1e-9;
    const bin = keepAbove ? bv >= -1e-9 : bv <= 1e-9;
    if (ain) out.push(a);
    if (ain !== bin) {
      const t = av / (av - bv);
      out.push(new THREE.Vector2(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t));
    }
  }
  return out;
}

/** Removes consecutive (near) duplicate points – ExtrudeGeometry dislikes them. */
function dedupe(pts) {
  const out = [];
  for (const p of pts) if (!out.length || out[out.length - 1].distanceTo(p) > 1e-5) out.push(p);
  if (out.length > 2 && out[0].distanceTo(out[out.length - 1]) < 1e-5) out.pop();
  return out;
}

/**
 * Horizontal slab from a plan outline: y 0..t, shape x → x, shape y → −z. Metre UVs (box projection, grain axis).
 * @param {THREE.Vector2[]|THREE.Shape} outline
 */
function planSlab(outline, t, { bevel = 0, grain = 'x', curveSegments = 12 } = {}) {
  const shape = outline instanceof THREE.Shape ? outline : new THREE.Shape(dedupe(outline));
  const b = Math.min(bevel, t / 3);
  const geo = K.extrudeShape(shape, t, { bevel: b, bevelSegments: b > 0 ? 2 : 0, curveSegments });
  geo.rotateX(-Math.PI / 2);
  K.worldUV(geo, 1, { grain });
  return geo;
}

/**
 * Prism of a flat bar between two points in the y–z plane (A-frame legs): horizontal cut ends, `wz` wide across
 * the bar (in the frame plane), `tx` thick along x, centred on x = 0.
 */
function barYZ(z0, y0, z1, y1, wz, tx) {
  const ang = Math.atan2(z1 - z0, y1 - y0);
  const half = wz / 2 / Math.cos(ang);
  const pts = [[z0 - half, y0], [z0 + half, y0], [z1 + half, y1], [z1 - half, y1]];
  const geo = K.extrudeShape(pts, tx);
  // shape (sx, sy, ez) → world (x = −ez, y = sy, z = sx)
  geo.rotateY(-Math.PI / 2);
  geo.translate(tx / 2, 0, 0);
  K.worldUV(geo, 1, { grain: 'y' });
  return geo;
}

/** Tapered round leg from a top point down to the floor, tilted outward by (tx, tz) radians. */
function splayedLeg(x, yTop, z, rTop, rBot, tiltX, tiltZ, seg = 12) {
  const L = yTop / Math.cos(Math.hypot(tiltX, tiltZ));
  const geo = K.taperLeg(L, rTop, rBot, { seg });
  geo.translate(0, -L, 0);
  // positive tilts move the foot toward +x / +z (outward for legs on that side)
  geo.rotateZ(tiltX);
  geo.rotateX(-tiltZ);
  geo.translate(x, yTop, z);
  return geo;
}

// ---------------------------------------------------------------------------------------------------------------
// Def helper

function def(id, { defaults, params = {}, dimsRange, build, info }) {
  // `info` = { family, mount, label } for an archetype that data/archetypes.json does not list (yet)
  const a = schema.archetypes[id] || info;
  const fam = schema.families[a.family];
  const parts = a.parts || fam.parts;
  const d = defaults.dims;
  return {
    label: a.label,
    mount: a.mount,
    parts: [...parts],
    partLabels: Object.fromEntries(parts.map((p) => [p, fam.partLabels[p] || p])),
    defaults: { params: {}, ...defaults },
    params,
    dimsRange: dimsRange || {
      w: [+(d.w * 0.5).toFixed(2), +(d.w * 1.8).toFixed(2)],
      d: [+(d.d * 0.6).toFixed(2), +(d.d * 1.6).toFixed(2)],
      h: [+(d.h * 0.6).toFixed(2), +(d.h * 1.5).toFixed(2)],
    },
    build,
  };
}

/** body/front/top/legs/handle colours: one wood/metal for the body, another for the top. */
const finish = (body, bodyKind, top = body, topKind = bodyKind, legs = '#1c1c1c', legKind = 'black-metal') => ({
  colors: { body, front: body, top, legs, handle: legs },
  materials: { body: bodyKind, front: bodyKind, top: topKind, legs: legKind, handle: legKind },
});

const P_TOP = { topT: { type: 'number', min: 0.008, max: 0.06, step: 0.002, label: 'Platetykkelse (m)' } };

// ---------------------------------------------------------------------------------------------------------------
// Coffee table (rectangular): square-tube frame

function buildCoffeeRect(spec) {
  const { w, d, h } = spec.dims;
  const P = spec.params;
  const g = new THREE.Group();
  const topT = clamp(num(P.topT ?? P.topThickness, 0.03), 0.008, h * 0.4);
  const tw = clamp(num(P.tubeW, 0.02), 0.008, 0.06);
  const over = clamp(num(P.overhang, 0), 0, Math.min(w, d) * 0.2);
  const frame = P.frame || 'tube-box';
  const top = pm(spec, 'top', 'oak');
  const body = pm(spec, 'body', 'black-metal');
  const legs = pm(spec, 'legs', 'black-metal');

  add(g, K.roundedBox(w, topT, d, Math.min(0.0025, topT / 4), 2, { grain: 'x' }), top, 'top', 0, h - topT / 2, 0);

  const fw = w - 2 * over, fd = d - 2 * over;
  const yTop = h - topT - tw / 2;
  // top rails: long ones over the full length, short ones between them
  for (const sz of [-1, 1]) add(g, K.box(fw, tw, tw, { grain: 'x' }), body, 'body', 0, yTop, sz * (fd / 2 - tw / 2));
  for (const sx of [-1, 1]) add(g, K.box(tw, tw, fd - 2 * tw, { grain: 'z' }), body, 'body', sx * (fw / 2 - tw / 2), yTop, 0);
  const bottomRing = frame === 'tube-box';
  const sled = frame === 'sled';
  const postY0 = bottomRing || sled ? tw : 0;
  const postY1 = h - topT - tw;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      add(g, K.box(tw, postY1 - postY0, tw, { grain: 'y' }), legs, 'legs', sx * (fw / 2 - tw / 2), (postY0 + postY1) / 2, sz * (fd / 2 - tw / 2));
    }
  }
  if (bottomRing) {
    for (const sz of [-1, 1]) add(g, K.box(fw, tw, tw, { grain: 'x' }), legs, 'legs', 0, tw / 2, sz * (fd / 2 - tw / 2));
  }
  if (bottomRing || sled) {
    for (const sx of [-1, 1]) add(g, K.box(tw, tw, fd - (bottomRing ? 2 * tw : 0), { grain: 'z' }), legs, 'legs', sx * (fw / 2 - tw / 2), tw / 2, 0);
  }
  const rc = recolorer(g);
  return K.finishModel(g, { surfaces: [{ y: h, w, d, center: [0, 0] }], recolor: rc });
}

// ---------------------------------------------------------------------------------------------------------------
// Round nesting tables (coffee and side)

/**
 * Table list for the nesting archetypes, scaled to the dims. With explicit offsets (room-spec) dims are the full
 * extent of the set; without (catalogue) dims are the largest table and the lower tables are pushed in a little.
 */
function nestingTables(spec) {
  const { w, d, h } = spec.dims;
  const P = spec.params;
  const raw = Array.isArray(P.tables) && P.tables.length ? P.tables : [{ d: Math.min(w, d), h }];
  const maxH = Math.max(...raw.map((t) => num(t.h, h)));
  const sy = h / maxH;
  const hasOffsets = raw.some((t) => Array.isArray(t.offset));
  let list;
  if (hasOffsets) {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const t of raw) {
      const r = num(t.d, 0.5) / 2;
      const [ox, oz] = t.offset ?? [0, 0];
      x0 = Math.min(x0, ox - r);
      x1 = Math.max(x1, ox + r);
      z0 = Math.min(z0, oz - r);
      z1 = Math.max(z1, oz + r);
    }
    const sx = w / (x1 - x0), sz = d / (z1 - z0);
    const s = Math.min(sx, sz);
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    list = raw.map((t) => ({ r: (num(t.d, 0.5) / 2) * s, h: num(t.h, h) * sy, x: cx + ((t.offset?.[0] ?? 0) - cx) * sx, z: cz + ((t.offset?.[1] ?? 0) - cz) * sz }));
  } else {
    // catalogue set: dims = the largest table; each lower table is pulled out toward the front-right just far
    // enough that its top passes between two legs of the table above (see nestingLegs)
    const maxD = Math.max(...raw.map((t) => num(t.d, 0.5)));
    const s = Math.min(w, d) / maxD;
    list = raw.map((t) => ({ r: (num(t.d, 0.5) / 2) * s, h: num(t.h, h) * sy, x: 0, z: 0 }));
    list.sort((a, b) => b.h - a.h);
    const phi = 35 * K.DEG;
    for (let i = 1; i < list.length; i++) {
      const up = list[i - 1], lo = list[i];
      const lr = 0.0065;
      const n = clamp(Math.round(num(P.legCount, 3)), 3, 6);
      const rlTop = up.r - 0.009 - lr;
      const rlAt = rlTop + Math.max(0, up.h - lo.h) * Math.tan(LEG_SPLAY);
      const c = Math.cos(Math.PI / n);
      const R = lo.r + lr + 0.008;
      const delta = rlAt * c + Math.sqrt(Math.max(0, rlAt * rlAt * c * c - rlAt * rlAt + R * R));
      lo.x = up.x + Math.cos(phi) * delta;
      lo.z = up.z + Math.sin(phi) * delta;
    }
  }
  return list;
}

/** Outward splay of the slim legs of catalogue nesting tables. */
const LEG_SPLAY = 4 * K.DEG;

/**
 * Leg start angle for table i of a nesting set: the direction to an overlapping neighbour is put in the middle of a
 * gap between two legs, so the lower top slides in between them (082809: the legs sit at ±45° from the other table).
 */
function nestingLegAngle(tables, i, n) {
  const t = tables[i];
  let best = null;
  for (let j = 0; j < tables.length; j++) {
    if (j === i) continue;
    const o = tables[j];
    const dist = Math.hypot(o.x - t.x, o.z - t.z);
    if (dist < t.r + o.r && (!best || dist < best.dist)) best = { dist, phi: Math.atan2(o.z - t.z, o.x - t.x) };
  }
  return (best ? best.phi : Math.PI / 4 + i * 0.5) + Math.PI / n;
}

function buildNesting(spec, { frameDefault = 'ring', legCountDefault = 4 } = {}) {
  const P = spec.params;
  const g = new THREE.Group();
  const topT = clamp(num(P.topT ?? P.topThickness, 0.022), 0.008, 0.06);
  const frame = P.frame || frameDefault;
  const nLegs = clamp(Math.round(num(P.legCount, legCountDefault)), 3, 6);
  const top = pm(spec, 'top', 'oak');
  const body = pm(spec, 'body', 'black-metal');
  const legs = pm(spec, 'legs', 'black-metal');
  const seg = qSeg(spec, 64);
  const surfaces = [];
  const tables = nestingTables(spec);
  tables.forEach((t, i) => {
    const { r, h: th, x, z } = t;
    const ring = frame === 'ring';
    const bandT = ring ? 0.004 : 0;
    const legR = ring ? 0.006 : 0.0065;
    // wooden top (inside the band when there is one)
    const topGeo = planSlab(ellipsePts(2 * (r - bandT), 2 * (r - bandT), seg), topT, { bevel: ring ? 0 : 0.003, grain: 'x' });
    add(g, topGeo, top, 'top', x, th - topT, z);
    const underTop = th - topT;
    if (ring) {
      // black edge band round the top, its top edge flush with the wood
      const bandH = topT + 0.012;
      const outer = ellipsePts(2 * r, 2 * r, seg);
      const inner = ellipsePts(2 * (r - bandT), 2 * (r - bandT), seg).reverse();
      const shape = new THREE.Shape(outer);
      shape.holes.push(new THREE.Path(inner));
      add(g, planSlab(shape, bandH, { grain: 'x' }), body, 'body', x, th - bandH, z);
    } else {
      // slim apron ring just inside the rim, under the top
      const ar = r - 0.006;
      const shape = new THREE.Shape(ellipsePts(2 * ar, 2 * ar, seg));
      shape.holes.push(new THREE.Path(ellipsePts(2 * (ar - 0.003), 2 * (ar - 0.003), seg).reverse()));
      add(g, planSlab(shape, 0.018, { grain: 'x' }), body, 'body', x, underTop - 0.018, z);
    }
    const rl = ring ? r - bandT - legR - 0.002 : r - 0.009 - legR;
    const a0 = nestingLegAngle(tables, i, nLegs) + num(P.legAngle, 0) * K.DEG;
    const yFloor = ring ? 2 * legR : 0;
    for (let k = 0; k < nLegs; k++) {
      const a = a0 + (k / nLegs) * Math.PI * 2;
      const ca = Math.cos(a), sa = Math.sin(a);
      const lx = x + ca * rl, lz = z + sa * rl;
      if (ring) add(g, K.cylinder(legR, legR, underTop - yFloor + 0.002, { seg: qSeg(spec, 10) }), legs, 'legs', lx, yFloor - 0.001, lz);
      else add(g, splayedLeg(lx, underTop + 0.001, lz, legR, legR * 0.85, ca * LEG_SPLAY, sa * LEG_SPLAY, qSeg(spec, 10)), legs, 'legs');
    }
    if (ring) {
      const tor = K.torus(rl, legR, { radial: qSeg(spec, 6), tubular: seg });
      add(g, tor, legs, 'legs', x, legR, z, [Math.PI / 2, 0, 0]);
    }
    surfaces.push({ y: th, w: +(2 * r * 0.72).toFixed(3), d: +(2 * r * 0.72).toFixed(3), center: [+x.toFixed(3), +z.toFixed(3)] });
  });
  const rc = recolorer(g);
  return K.finishModel(g, { surfaces, recolor: rc });
}

// ---------------------------------------------------------------------------------------------------------------
// Dining table

/** Outline of a dining top in plan. */
function diningOutline(shape, w, d, n) {
  if (shape === 'oval') return ellipsePts(w, d, n * 2);
  if (shape === 'round') return ellipsePts(w, d, n * 2);
  if (shape === 'rect') return roundRectPts(w, d, 0.02, 4);
  return stadiumPts(w, d, n);
}

/** Outward 2D normals of a closed polygon (CCW or CW). */
function outlineNormals(pts) {
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    area += a.x * b.y - b.x * a.y;
  }
  const sgn = area > 0 ? 1 : -1;
  return pts.map((p, i) => {
    const a = pts[(i - 1 + pts.length) % pts.length], b = pts[(i + 1) % pts.length];
    const tx = b.x - a.x, ty = b.y - a.y;
    const l = Math.hypot(tx, ty) || 1;
    return new THREE.Vector2((ty / l) * sgn, (-tx / l) * sgn);
  });
}

/** Chamfer loft from the outer outline (y = yHi) to the inner outline (y = yLo) + the bottom cap. */
function chamferGeometry(outer, inner, yHi, yLo) {
  const B = new GeoBuilder();
  const n = outer.length;
  const nrm = outlineNormals(outer);
  const cw = outer[0].distanceTo(inner[0]) || 0.01;
  const ch = yHi - yLo;
  let along = 0;
  const ids = [];
  for (let i = 0; i <= n; i++) {
    const k = i % n;
    if (i > 0) along += outer[k].distanceTo(outer[i - 1]);
    const o = outer[k], q = inner[k], m = nrm[k];
    const l = Math.hypot(ch, cw);
    const nx = (m.x * ch) / l, ny = -cw / l, nz = (-m.y * ch) / l;
    ids.push([B.v(o.x, yHi, -o.y, nx, ny, nz, along, 0), B.v(q.x, yLo, -q.y, nx, ny, nz, along, Math.hypot(cw, ch))]);
  }
  // winding (the outline may be CW or CCW): test the first quad against its normal
  const P = (j) => new THREE.Vector3(B.pos[j * 3], B.pos[j * 3 + 1], B.pos[j * 3 + 2]);
  const [a0, b0] = ids[0];
  const [c0] = ids[1];
  const N0 = new THREE.Vector3(B.nrm[a0 * 3], B.nrm[a0 * 3 + 1], B.nrm[a0 * 3 + 2]);
  const flip = new THREE.Vector3().subVectors(P(c0), P(a0)).cross(new THREE.Vector3().subVectors(P(b0), P(a0))).dot(N0) < 0;
  for (let i = 0; i < n; i++) {
    const [a, b] = ids[i];
    const [c, d] = ids[i + 1];
    if (flip) B.idx.push(a, b, c, b, d, c);
    else B.idx.push(a, c, b, b, c, d);
  }
  // bottom cap (faces down): same plan mapping as planSlab (shape y → −z), winding reversed after the rotation
  const cap = new THREE.ShapeGeometry(new THREE.Shape(inner));
  cap.rotateX(-Math.PI / 2);
  cap.translate(0, yLo, 0);
  const pos = cap.attributes.position;
  const base = B.pos.length / 3;
  for (let i = 0; i < pos.count; i++) B.v(pos.getX(i), pos.getY(i), pos.getZ(i), 0, -1, 0, pos.getX(i), -pos.getZ(i));
  const ci = cap.index ? Array.from(cap.index.array) : [...Array(pos.count).keys()];
  for (let i = 0; i < ci.length; i += 3) B.idx.push(base + ci[i], base + ci[i + 2], base + ci[i + 1]);
  cap.dispose();
  return B.build();
}

/**
 * Column of vertical ribs (fluted / reeded base) on a plan outline (shape space x / −z): walks the perimeter and
 * pushes every other sample out by `depth`, then extrudes from y = 0 to colH. Grain along y.
 * `mirror` maps shape y → +z (the dining table's original orientation); otherwise shape y → −z like planSlab.
 */
function ribbedColumn(base, colH, { pitch = 0.028, depth = 0.004, mirror = false } = {}) {
  let per = 0;
  const segs = base.map((p, i) => {
    const q = base[(i + 1) % base.length];
    const l = Math.hypot(q.x - p.x, q.y - p.y);
    per += l;
    return l;
  });
  const nR = Math.max(16, Math.round(per / pitch) * 2);
  const ribbed = [];
  let acc = 0, k = 0;
  for (let i = 0; i < base.length && ribbed.length < nR * 2; i++) {
    const p = base[i], q = base[(i + 1) % base.length];
    const nx = q.y - p.y, ny = -(q.x - p.x), nl = Math.hypot(nx, ny) || 1;
    while (acc < segs[i]) {
      const t = acc / segs[i];
      const out = k % 2 ? 0 : depth;
      ribbed.push([p.x + (q.x - p.x) * t + (nx / nl) * out, p.y + (q.y - p.y) * t + (ny / nl) * out]);
      acc += pitch / 2;
      k++;
    }
    acc -= segs[i];
  }
  const geo = K.extrudeShape(mirror ? ribbed.map(([x, z]) => [x, -z]) : ribbed, colH, { curveSegments: 1 });
  geo.rotateX(-Math.PI / 2);
  K.worldUV(geo, 1, { grain: 'y' });
  return geo;
}

/** Half chord (along z) of a top outline at x – for seams of extension leaves. */
function halfChordAt(shape, w, d, x) {
  if (shape === 'rect') return d / 2 - 0.004;
  if (shape === 'stadium') {
    const r = Math.min(w, d) / 2, cx = Math.max(0, w / 2 - r);
    const dx = Math.max(0, Math.abs(x) - cx);
    return Math.sqrt(Math.max(0, r * r - dx * dx)) - 0.004;
  }
  const u = (2 * x) / w;
  return (d / 2) * Math.sqrt(Math.max(0, 1 - u * u)) - 0.004;
}

function buildDining(spec) {
  const { w, d, h } = spec.dims;
  const P = spec.params;
  const g = new THREE.Group();
  const shape = ['stadium', 'oval', 'round', 'rect'].includes(P.shape) ? P.shape : 'stadium';
  const topT = clamp(num(P.topT ?? P.topThickness, 0.03), 0.012, 0.08);
  const bevelEdge = P.edge !== 'straight';
  const top = pm(spec, 'top', 'oak');
  const body = pm(spec, 'body', 'black-metal');
  const legs = pm(spec, 'legs', 'black-metal');
  const n = qSeg(spec, 28);
  const outer = diningOutline(shape, w, d, n);
  const edgeT = bevelEdge ? Math.min(0.012, topT * 0.45) : topT;
  add(g, planSlab(outer, edgeT, { bevel: 0.0012, grain: 'x' }), top, 'top', 0, h - edgeT, 0);
  if (bevelEdge) {
    // light chamfer under the thin edge (082909: the edge shows a pale bevel below the dark top)
    const cw = Math.min(0.025, Math.min(w, d) * 0.04);
    const inner = diningOutline(shape, w - 2 * cw, d - 2 * cw, n);
    const fas = mat(spec.materials?.top || 'oak', tone(spec.colors?.top || '#4b4039', 1.22));
    add(g, chamferGeometry(outer, inner, h - edgeT, h - topT), fas, 'top');
  }
  // seams of the extension leaves (thin dark lines across the top)
  const leaves = clamp(Math.round(num(P.leaves, 0)), 0, 4);
  if (leaves > 0 || P.seams === true) {
    const rEnd = Math.min(w, d) / 2;
    const straight = shape === 'stadium' ? Math.max(0, w - 2 * rEnd) : w * 0.4;
    const xs = [];
    if (leaves > 0) {
      const lw = straight / leaves;
      for (let k = 0; k <= leaves; k++) xs.push(-straight / 2 + k * lw);
    } else xs.push(0);
    const seamMat = mat('painted', tone(spec.colors?.top || '#4b4039', 0.32), { flat: true, roughness: 0.9 });
    for (const x of xs) {
      const hc = halfChordAt(shape, w, d, x);
      if (hc < 0.05) continue;
      const m = add(g, K.box(0.0016, 0.0006, 2 * hc), seamMat, null, x, h + 0.0001, 0);
      m.userData.noShadow = true;
    }
  }
  // base
  const legsStyle = P.legs || 'a-frame';
  const yUnder = h - topT;
  if (legsStyle === 'pedestal') {
    const colR = Math.min(0.06, d * 0.06);
    const baseR = Math.min(d * 0.33, 0.3);
    const xs = w > d * 1.35 ? [-(w / 2 - d * 0.42), w / 2 - d * 0.42] : [0];
    for (const x of xs) {
      add(g, K.cylinder(colR, colR, yUnder - 0.02, { seg: qSeg(spec, 24) }), legs, 'legs', x, 0.02, 0);
      add(g, planSlab(ellipsePts(2 * baseR, 2 * baseR, qSeg(spec, 48)), 0.02, { bevel: 0.004 }), legs, 'legs', x, 0, 0);
      add(g, planSlab(ellipsePts(2 * colR * 2.2, 2 * colR * 2.2, qSeg(spec, 32)), 0.012), body, 'body', x, yUnder - 0.012, 0);
    }
    if (xs.length > 1) add(g, K.box(xs[1] - xs[0], 0.04, 0.05, { grain: 'x' }), body, 'body', 0, yUnder - 0.02, 0);
  } else if (legsStyle === 'four') {
    const s = 0.05;
    const ls = ['square', 'round-taper', 'splayed', 'metal-thin'].includes(P.legStyle) ? P.legStyle : 'square';
    const ix = shape === 'rect' ? 0.06 : Math.min(w * 0.2, 0.35);
    const iz = shape === 'rect' ? 0.06 : d * 0.18;
    const legsV = mat(spec.materials?.legs || 'black-metal', spec.colors?.legs, kindGroup(spec.materials?.legs || 'black-metal') === 'wood' ? { grain: 'y' } : undefined);
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const x = sx * (w / 2 - ix), z = sz * (d / 2 - iz);
        if (ls === 'square') add(g, K.box(s, yUnder, s, { grain: 'y' }), legs, 'legs', x, yUnder / 2, z);
        else if (ls === 'metal-thin') add(g, K.cylinder(0.012, 0.011, yUnder, { seg: qSeg(spec, 12) }), legsV, 'legs', x, 0, z);
        else if (ls === 'round-taper') add(g, K.taperLeg(yUnder, 0.028, 0.019, { seg: qSeg(spec, 14) }), legsV, 'legs', x, 0, z);
        else {
          // splayed: the feet further out than the tops, leaning outward along the diagonal
          const tilt = 8 * K.DEG;
          add(g, splayedLeg(x, yUnder + 0.002, z, 0.024, 0.016, sx * tilt, sz * tilt, qSeg(spec, 14)), legsV, 'legs');
        }
      }
    }
    if (ls === 'square' && P.apron !== true) for (const sz of [-1, 1]) add(g, K.box(w - 2 * ix - s, 0.06, 0.02, { grain: 'x' }), body, 'body', 0, yUnder - 0.03, sz * (d / 2 - iz));
  } else if (legsStyle === 'column') {
    // one wide oval (stadium) column of vertical ribs on a low plinth (Nola)
    const cw = clamp(num(P.columnW, w * 0.42), 0.2, w - 0.2), cd = clamp(num(P.columnD, d * 0.45), 0.15, d - 0.1);
    const base = stadiumPts(cw, cd, qSeg(spec, 16));
    const colH = yUnder - 0.03;
    const geo = ribbedColumn(base, colH, { pitch: 0.028, depth: 0.004, mirror: true });
    const legsV = mat(spec.materials?.legs || 'oak', spec.colors?.legs, { grain: 'y' });
    add(g, geo, legsV, 'legs', 0, 0.03, 0);
    add(g, planSlab(stadiumPts(cw + 0.03, cd + 0.03, qSeg(spec, 16)), 0.03, { bevel: 0.003 }), legs, 'legs', 0, 0, 0);
  } else if (legsStyle === 'spider') {
    // four strong legs from a hub under the middle out to the floor (Bastia)
    const R = Math.min(w, d) * clamp(num(P.spread, 0.42), 0.2, 0.5);
    const hub = 0.12;
    const legsV = mat(spec.materials?.legs || 'oak', spec.colors?.legs, kindGroup(spec.materials?.legs || 'oak') === 'wood' ? { grain: 'y' } : undefined);
    for (let k = 0; k < 4; k++) {
      const a = Math.PI / 4 + (k * Math.PI) / 2;
      const top = [Math.cos(a) * hub, yUnder - 0.02, Math.sin(a) * hub];
      const foot = [Math.cos(a) * R, 0, Math.sin(a) * R];
      const len = Math.hypot(foot[0] - top[0], foot[1] - top[1], foot[2] - top[2]);
      const m = add(g, K.box(0.05, len, 0.05, { grain: 'y' }), legsV, 'legs', (top[0] + foot[0]) / 2, (top[1] + foot[1]) / 2, (top[2] + foot[2]) / 2);
      m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(top[0] - foot[0], top[1] - foot[1], top[2] - foot[2]).normalize());
    }
    add(g, K.box(2 * hub + 0.08, 0.04, 2 * hub + 0.08), body, 'body', 0, yUnder - 0.02, 0);
  } else if (legsStyle === 'panel' || legsStyle === 'cross') {
    // panel: two solid slab legs across the width; cross: two crossing fluted slabs under the middle (Palma)
    const legsV = mat(spec.materials?.legs || 'oak', spec.colors?.legs, kindGroup(spec.materials?.legs || 'oak') === 'wood' ? { grain: 'y' } : undefined);
    if (legsStyle === 'panel') {
      const inset = clamp(num(P.legInset, 0.25), 0.05, w / 2 - 0.1);
      const pt = clamp(num(P.panelT, 0.07), 0.02, 0.15);
      for (const sx of [-1, 1]) add(g, K.box(pt, yUnder, clamp(d * 0.8, 0.3, d - 0.06), { grain: 'y' }), legsV, 'legs', sx * (w / 2 - inset - pt / 2), yUnder / 2, 0);
    } else {
      const span = Math.min(w, d) * 0.6;
      for (const a of [Math.PI / 4, -Math.PI / 4]) {
        const geo = ribPanelGeometry(span, yUnder, { pitch: 0.03, depth: 0.006, t: 0.024, seg: spec.quality === 'low' ? 3 : 5 });
        geo.translate(0, 0, -0.015);
        geo.rotateY(a);
        add(g, geo, legsV, 'legs', 0, yUnder / 2, 0);
      }
    }
  } else if (legsStyle === 'trestle' || legsStyle === 'x' || legsStyle === 'sled' || legsStyle === 'u-frame') {
    // two end supports ≈ legInset from the ends, a stretcher between them (trestle/x)
    const inset = clamp(num(P.legInset, 0.3), 0.08, w / 2 - 0.1);
    const fx = w / 2 - inset;
    const wood = kindGroup(spec.materials?.legs || 'black-metal') === 'wood';
    const legsV = mat(spec.materials?.legs || 'black-metal', spec.colors?.legs, wood ? { grain: 'y' } : undefined);
    const legsZ = mat(spec.materials?.legs || 'black-metal', spec.colors?.legs, wood ? { grain: 'z' } : undefined);
    const span = clamp(d * 0.72, 0.3, d - 0.08);
    for (const sx of [-1, 1]) {
      const x = sx * fx;
      if (legsStyle === 'trestle') {
        // a solid panel, narrower at the waist, on a foot rail
        const pw = wood ? 0.05 : 0.02;
        const shape2 = [[-span / 2, 0], [span / 2, 0], [span / 2, 0.05], [span * 0.2, 0.12], [span * 0.2, yUnder - 0.1], [span * 0.4, yUnder], [-span * 0.4, yUnder], [-span * 0.2, yUnder - 0.1], [-span * 0.2, 0.12], [-span / 2, 0.05]];
        const geo = K.extrudeShape(shape2, pw, { center: true, bevel: Math.min(0.004, pw / 4), bevelSegments: 1, curveSegments: 2 });
        geo.rotateY(Math.PI / 2);
        K.worldUV(geo, 1, { grain: 'y' });
        add(g, geo, legsV, 'legs', x, 0, 0);
      } else if (legsStyle === 'x') {
        const bw = wood ? 0.06 : 0.04, bt = wood ? 0.04 : 0.015;
        const len = Math.hypot(span, yUnder);
        const ang = Math.atan2(span, yUnder);
        for (const s2 of [-1, 1]) add(g, K.box(bt, len, bw, { grain: 'y' }), legsV, 'legs', x + s2 * bt * 0.55, yUnder / 2, 0, [s2 * ang, 0, 0]);
      } else {
        // sled / U frame: a closed (sled) or open-bottom (u) rectangle of tube or wood, the bottom a little wider
        const t = wood ? 0.045 : 0.025;
        const top = span * 0.92, bot = legsStyle === 'sled' ? span : span * 0.92;
        add(g, K.box(t, t, top, { grain: 'z' }), legsZ, 'legs', x, yUnder - t / 2, 0);
        if (legsStyle === 'sled') add(g, K.box(t, t, bot, { grain: 'z' }), legsZ, 'legs', x, t / 2, 0);
        for (const sz of [-1, 1]) {
          const a = [x, legsStyle === 'sled' ? t : 0, sz * (bot / 2 - t / 2)];
          const b = [x, yUnder - t, sz * (top / 2 - t / 2)];
          const len = Math.hypot(b[1] - a[1], b[2] - a[2]);
          const m = add(g, K.box(t, len, t, { grain: 'y' }), legsV, 'legs', x, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
          m.rotation.x = -Math.atan2(b[2] - a[2], b[1] - a[1]);
        }
      }
    }
    if (legsStyle === 'trestle' || legsStyle === 'x') add(g, K.box(2 * fx, 0.05, 0.04, { grain: 'x' }), legs, 'legs', 0, legsStyle === 'trestle' ? 0.2 : yUnder * 0.45, 0);
    add(g, K.box(2 * fx, 0.04, 0.04, { grain: 'x' }), body, 'body', 0, yUnder - 0.02, 0);
  } else {
    // two A-frames of black flat steel, splayed across the width, ≈ legInset from the ends (082909, 082941)
    const inset = clamp(num(P.legInset, 0.4), 0.1, w / 2 - 0.08);
    const fx = w / 2 - inset;
    const legW = 0.07, legT = 0.035;
    const zTop = clamp(d * 0.27, 0.12, d / 2 - 0.08);
    const zFoot = Math.min(d / 2 - 0.05, zTop + (yUnder / 0.72) * 0.09);
    const railH = 0.05;
    for (const sx of [-1, 1]) {
      const x = sx * fx;
      for (const sz of [-1, 1]) {
        const geo = barYZ(sz * zFoot, 0, sz * zTop, yUnder - railH, legW, legT);
        add(g, geo, legs, 'legs', x, 0, 0);
      }
      add(g, K.box(legT, railH, 2 * zTop + legW, { grain: 'z' }), legs, 'legs', x, yUnder - railH / 2, 0);
    }
    // hidden spine and side rails under the top (seen from a low angle)
    add(g, K.box(2 * fx - legT, 0.04, 0.04, { grain: 'x' }), body, 'body', 0, yUnder - 0.02, 0);
  }
  if (P.apron === true) {
    // a frame (sarg) under the top, set in from the edge; round/oval tops get a ring of short boards
    const ah = clamp(num(P.apronH, 0.07), 0.03, 0.14), at = 0.022;
    if (shape === 'rect') {
      const ax = w / 2 - 0.07, az = d / 2 - 0.07;
      for (const sz of [-1, 1]) add(g, K.box(2 * ax, ah, at, { grain: 'x' }), body, 'body', 0, yUnder - ah / 2, sz * (az - at / 2));
      for (const sx of [-1, 1]) add(g, K.box(at, ah, 2 * az - 2 * at, { grain: 'z' }), body, 'body', sx * (ax - at / 2), yUnder - ah / 2, 0);
    } else {
      const ring = diningOutline(shape, w - 0.16, d - 0.16, qSeg(spec, 24));
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i], b = ring[(i + 1) % ring.length];
        const len = Math.hypot(b.x - a.x, b.y - a.y);
        if (len < 0.005) continue;
        add(g, K.box(len + 0.004, ah, at, { grain: 'x' }), body, 'body', (a.x + b.x) / 2, yUnder - ah / 2, (a.y + b.y) / 2, [0, -Math.atan2(b.y - a.y, b.x - a.x), 0]);
      }
    }
  }
  const rc = recolorer(g, (part) => part === 'top' && bevelEdge);
  return K.finishModel(g, { surfaces: [{ y: h, w: +(w * 0.9).toFixed(3), d: +(d * 0.9).toFixed(3), center: [0, 0] }], recolor: rc });
}

// ---------------------------------------------------------------------------------------------------------------
// Side tables

/** Smooth lathe profile through control points [r, y] (bottom → top), closed at both ends. */
function smoothProfile(ctrl, n) {
  const curve = new THREE.SplineCurve(ctrl.map(([r, y]) => new THREE.Vector2(r, y)));
  const pts = curve.getPoints(n);
  const first = pts[0], last = pts[pts.length - 1];
  return [[0.0005, first.y], ...pts.map((p) => [Math.max(0.001, p.x), p.y]), [0.0005, last.y]];
}

function buildSideRound(spec) {
  const { w, d, h } = spec.dims;
  const P = spec.params;
  const g = new THREE.Group();
  const r = Math.min(w, d) / 2;
  const topT = clamp(num(P.topT ?? P.topThickness, 0.025), 0.008, h * 0.3);
  const ref = num(P.topD, 2 * r);
  const k = (2 * r) / ref;
  const base = P.base || 'pedestal';
  const top = pm(spec, 'top', 'oak');
  const legKind = spec.materials?.legs || 'oak';
  const legs = mat(legKind, spec.colors?.legs, kindGroup(legKind) === 'wood' ? { grain: 'v' } : undefined);
  const segR = qSeg(spec, 48);
  add(g, planSlab(ellipsePts(2 * r, 2 * r, segR), topT, { bevel: Math.min(0.004, topT / 4), grain: 'x' }), top, 'top', 0, h - topT, 0);
  const ph = h - topT;
  const rw = (num(P.waistD, 0.05) / 2) * k;
  const rb = (num(P.baseD, 2 * r * 0.62) / 2) * k;
  const prof = qSeg(spec, 28);
  if (base === 'sculptural-pedestal') {
    // one soft piece: wide rounded foot, slim waist, flaring to a collar under the top
    const rt = Math.min(r * 0.62, rw * 1.9);
    const ctrl = [[rb * 0.94, 0], [rb, 0.012], [rb * 0.9, ph * 0.08], [rw * 1.45, ph * 0.28], [rw, ph * 0.52], [rw * 1.12, ph * 0.76], [rt * 0.92, ph * 0.96], [rt, ph]];
    add(g, K.lathe(smoothProfile(ctrl, prof), { seg: segR }), legs, 'legs');
  } else if (base === 'hourglass') {
    const rt = r * 0.92;
    const pts = [[0.0005, 0], [rb - 0.004, 0], [rb, 0.004]];
    const nH = Math.max(6, Math.round(prof / 2));
    for (let i = 1; i <= nH; i++) {
      const t = i / nH;
      pts.push([rw + (rb - rw) * (1 - t) ** 1.35, 0.004 + (ph / 2 - 0.004) * t]);
    }
    for (let i = 1; i <= nH; i++) {
      const t = i / nH;
      pts.push([rw + (rt - rw) * t ** 1.35, ph / 2 + (ph / 2) * t]);
    }
    pts.push([0.0005, ph]);
    add(g, K.lathe(pts, { seg: segR }), legs, 'legs');
  } else if (base === 'tripod') {
    const lr = 0.012;
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + Math.PI / 6;
      const ax = Math.cos(a), az = Math.sin(a);
      const rTop = r * 0.42;
      add(g, splayedLeg(ax * rTop, ph, az * rTop, lr, lr * 0.65, ax * 0.12, az * 0.12, qSeg(spec, 10)), legs, 'legs');
    }
    add(g, planSlab(ellipsePts(r * 0.95, r * 0.95, segR), 0.018), legs, 'legs', 0, ph - 0.018, 0);
  } else {
    const cr = Math.max(0.012, rw);
    add(g, K.cylinder(cr, cr, ph - 0.012, { seg: qSeg(spec, 20) }), legs, 'legs', 0, 0.012, 0);
    add(g, planSlab(ellipsePts(2 * rb, 2 * rb, segR), 0.012, { bevel: 0.003 }), legs, 'legs', 0, 0, 0);
  }
  const rc = recolorer(g);
  return K.finishModel(g, { surfaces: [{ y: h, w: +(2 * r * 0.72).toFixed(3), d: +(2 * r * 0.72).toFixed(3), center: [0, 0] }], recolor: rc });
}

function buildSideC(spec) {
  const { w, d, h } = spec.dims;
  const P = spec.params;
  const g = new THREE.Group();
  const topT = clamp(num(P.topT ?? P.topThickness, 0.018), 0.008, 0.05);
  const tw = clamp(num(P.tubeW, 0.02), 0.01, 0.04);
  const top = pm(spec, 'top', 'oak');
  const body = pm(spec, 'body', 'black-metal');
  const legs = pm(spec, 'legs', 'black-metal');
  add(g, K.roundedBox(w, topT, d, Math.min(0.003, topT / 4), 2, { grain: 'x' }), top, 'top', 0, h - topT / 2, 0);
  // the C opens toward +z: uprights at the back, the base slides in under a sofa seat
  const yRail = h - topT - tw / 2;
  const xs = w / 2 - tw / 2;
  const zb = -d / 2 + tw / 2;
  add(g, K.box(w, tw, tw, { grain: 'x' }), body, 'body', 0, yRail, zb);
  for (const sx of [-1, 1]) add(g, K.box(tw, tw, d - tw - 0.01, { grain: 'z' }), body, 'body', sx * xs, yRail, zb + tw / 2 + (d - tw - 0.01) / 2);
  for (const sx of [-1, 1]) add(g, K.box(tw, h - topT - 2 * tw, tw, { grain: 'y' }), body, 'body', sx * xs, (h - topT) / 2, zb);
  const bw = num(P.baseW, w), bd = num(P.baseD, d);
  add(g, K.box(Math.min(bw, w), tw, tw, { grain: 'x' }), legs, 'legs', 0, tw / 2, zb);
  for (const sx of [-1, 1]) add(g, K.box(tw, tw, Math.min(bd, d) - tw, { grain: 'z' }), legs, 'legs', sx * xs, tw / 2, zb + tw / 2 + (Math.min(bd, d) - tw) / 2);
  const rc = recolorer(g);
  return K.finishModel(g, {
    surfaces: [{ y: h, w, d, center: [0, 0] }],
    colliders: [{ min: [-w / 2, 0, -d / 2], max: [w / 2, h, -d / 2 + 0.06] }, { min: [-w / 2, h - topT - tw, -d / 2], max: [w / 2, h, d / 2] }],
    recolor: rc,
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Coffee tables and small tables (coffee-table, design/furniture.md §3.1): salongbord, sidebord, konsollbord,
// pidestall and round nightstands from one builder – a top of any plan shape on one of eleven bases. The table
// helpers below (outline, top, legs, handles) are shared with desks.js.

const CT_SHAPES = ['rect', 'rounded', 'soft', 'round', 'oval', 'stadium', 'organic'];
const CT_BASES = ['legs', 'pedestal', 'drum', 'ribbed', 'panel', 'frame', 'sled', 'x', 'v', 'cross', 'spider', 'cabinet'];
const CT_LEGS = ['square', 'round-taper', 'splayed', 'angled', 'block', 'metal-thin', 'hairpin', 'metal-square'];
/** Plan shapes whose legs stand in the corners (the others get legCount legs round the outline). */
const CORNER_SHAPES = new Set(['rect', 'rounded', 'soft']);

/** Superellipse outline |x/a|ⁿ + |z/b|ⁿ = 1 (a «myk firkant»), `count` points, counter-clockwise. */
function superPts(w, d, n, count = 64) {
  const e = 2 / clamp(n, 2, 10);
  const out = [];
  for (let k = 0; k < count; k++) {
    const a = (k / count) * Math.PI * 2;
    const c = Math.cos(a), s = Math.sin(a);
    out.push(new THREE.Vector2((Math.sign(c) * Math.abs(c) ** e * w) / 2, (Math.sign(s) * Math.abs(s) ** e * d) / 2));
  }
  return out;
}

/**
 * Organic (drop / egg) outline: a circle with a few low harmonics drawn from the seed, rescaled to exactly w × d.
 * `dent` (0–0.35) pushes a concave notch into the edge at the plan angle `dentAt` (0 = +x, π/2 = front +z, π = −x,
 * −π/2 = back), so the outline turns into a bean / kidney (Dråpe).
 */
function blobPts(w, d, seed, count = 64, dent = 0, dentAt = Math.PI / 2) {
  const r = K.rng(`coffee|${seed}`);
  const a1 = r.range(0.1, 0.18), a2 = r.range(0.03, 0.07), a3 = r.range(0, 0.03);
  const p2 = r.range(0, Math.PI * 2), p3 = r.range(0, Math.PI * 2);
  const raw = [];
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  const dn = clamp(num(dent, 0), 0, 0.35);
  const tD = -num(dentAt, Math.PI / 2); // plan angle → shape space (shape y = −z)
  for (let k = 0; k < count; k++) {
    const t = (k / count) * Math.PI * 2;
    let rr = 1 + a1 * Math.cos(t) + a2 * Math.cos(2 * t + p2) + a3 * Math.cos(3 * t + p3);
    if (dn > 0) {
      const dt = Math.atan2(Math.sin(t - tD), Math.cos(t - tD));
      rr -= dn * Math.exp(-((dt / 0.6) ** 2));
    }
    const x = rr * Math.cos(t), y = rr * Math.sin(t);
    raw.push([x, y]);
    x0 = Math.min(x0, x);
    x1 = Math.max(x1, x);
    y0 = Math.min(y0, y);
    y1 = Math.max(y1, y);
  }
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  return raw.map(([x, y]) => new THREE.Vector2(((x - cx) / (x1 - x0)) * w, ((y - cy) / (y1 - y0)) * d));
}

/**
 * Plan outline (shape space x / −z, counter-clockwise) of a table top. The point count depends only on the shape and
 * `n`, so outlines of different sizes correspond point by point (chamfers, rims).
 * @param {string} shape  rect | rounded | soft | round | oval | stadium | organic
 */
export function tableOutline(shape, w, d, { cornerR = 0.03, softness = 4, seed = 1, n = 48, dent = 0, dentAt = Math.PI / 2 } = {}) {
  w = Math.max(0.02, w);
  d = Math.max(0.02, d);
  switch (shape) {
    case 'rounded': return roundRectPts(w, d, Math.max(0.002, cornerR), Math.max(3, Math.round(n / 8)));
    case 'soft': return superPts(w, d, softness, n);
    case 'round':
    case 'oval': return ellipsePts(w, d, n);
    case 'stadium':
      if (w >= d) return stadiumPts(w, d, Math.max(8, Math.round(n / 2)));
      // semicircular ends along z: the x-stadium turned a quarter round (still counter-clockwise)
      return stadiumPts(d, w, Math.max(8, Math.round(n / 2))).map((p) => new THREE.Vector2(-p.y, p.x));
    case 'organic': return blobPts(w, d, seed, n, dent, dentAt);
    default: return roundRectPts(w, d, 0.004, 2);
  }
}

/** Distance from the plan origin to a closed outline (shape space) along the plan direction (ux, uz); 0 when missed. */
function rayHit(outline, ux, uz) {
  const dx = ux, dy = -uz;
  let best = Infinity;
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i], b = outline[(i + 1) % outline.length];
    const ex = b.x - a.x, ey = b.y - a.y;
    const den = dx * ey - dy * ex;
    if (Math.abs(den) < 1e-12) continue;
    const t = (a.x * ey - a.y * ex) / den;
    const s = (a.x * dy - a.y * dx) / den;
    if (t > 0 && s >= -1e-9 && s <= 1 + 1e-9) best = Math.min(best, t);
  }
  return Number.isFinite(best) ? best : 0;
}

/** True when the plan point (x, z) lies inside the outline and at least m from its edge. */
function insideBy(outline, x, z, m) {
  const px = x, py = -z;
  let inside = false, best = Infinity;
  for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) {
    const a = outline[i], b = outline[j];
    if (a.y > py !== b.y > py && px < ((b.x - a.x) * (py - a.y)) / (b.y - a.y) + a.x) inside = !inside;
    const ex = b.x - a.x, ey = b.y - a.y;
    const t = clamp(((px - a.x) * ex + (py - a.y) * ey) / (ex * ex + ey * ey || 1), 0, 1);
    best = Math.min(best, Math.hypot(a.x + ex * t - px, a.y + ey * t - py));
  }
  return inside && best >= m;
}

/**
 * Leg (foot) anchors in plan, [{ x, z, ux, uz }] with u the unit direction out from the centre. Corner shapes get four
 * legs `inset` in from both edges (slid in along the diagonal until they clear a rounded or soft corner); the other
 * shapes get `count` legs round the outline – four on the diagonals of the bounding box, three with one at the back.
 */
export function legAnchors(shape, outline, w, d, inset, legD, count = 4) {
  const out = [];
  const m = inset + legD / 2;
  if (CORNER_SHAPES.has(shape)) {
    const ax = Math.max(0.01, w / 2 - m), az = Math.max(0.01, d / 2 - m);
    const need = Math.max(0, m - 0.002);
    for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      let x = sx * ax, z = sz * az;
      for (let k = 0; k < 30 && !insideBy(outline, x, z, need); k++) {
        x *= 0.97;
        z *= 0.97;
      }
      const l = Math.hypot(x, z) || 1;
      out.push({ x, z, ux: x / l, uz: z / l });
    }
    return out;
  }
  const n = clamp(Math.round(num(count, 4)), 3, 4);
  const a0 = n === 3 ? -Math.PI / 2 : Math.PI / 4;
  for (let k = 0; k < n; k++) {
    const a = a0 + (k * 2 * Math.PI) / n;
    // along the bounding box's own diagonal (the ellipse's parametric angle): oval legs spread along the long side
    const vx = Math.cos(a) * w, vz = Math.sin(a) * d;
    const l = Math.hypot(vx, vz) || 1;
    const ux = vx / l, uz = vz / l;
    const r = Math.max(0.02, rayHit(outline, ux, uz) - inset - legD);
    out.push({ x: ux * r, z: uz * r, ux, uz });
  }
  return out;
}

/**
 * Table top on a plan outline with its upper face at h: `edge` 'straight' (a hair of a bevel), 'rounded' (a soft
 * radius) or 'bevel' (a thin edge over a lighter chamfer underneath). Returns the outline.
 */
export function tableTop(g, spec, { shape, w, d, h, topT, edge = 'straight', cornerR = 0.03, softness = 4, seed = 1, n = 48, dent = 0, dentAt = Math.PI / 2 }) {
  const top = pm(spec, 'top', 'oak');
  const o = { cornerR, softness, seed, n, dent, dentAt };
  const outline = tableOutline(shape, w, d, o);
  if (edge === 'bevel') {
    const edgeT = Math.min(0.012, topT * 0.45);
    add(g, planSlab(outline, edgeT, { bevel: 0.0012, grain: 'x' }), top, 'top', 0, h - edgeT, 0);
    const cw = Math.min(0.025, Math.min(w, d) * 0.04);
    const inner = tableOutline(shape, w - 2 * cw, d - 2 * cw, { ...o, cornerR: cornerR - cw });
    // the cut chamfer reads a little lighter than the face on light wood; on dark wood (smoked oak, Nardo) a light
    // band looks like an aluminium strip, so the lift fades out toward dark tops
    const topHex = spec.colors?.top || '#4b4039';
    const lum = new THREE.Color(topHex);
    const L = 0.2126 * lum.r + 0.7152 * lum.g + 0.0722 * lum.b;
    const fas = mat(spec.materials?.top || 'oak', tone(topHex, 1.06 + 0.16 * clamp((L - 0.05) / 0.15, 0, 1)));
    add(g, chamferGeometry(outline, inner, h - edgeT, h - topT), fas, 'top');
  } else {
    const bevel = edge === 'rounded' ? Math.min(topT / 3, 0.01) : Math.min(0.0015, topT / 4);
    add(g, planSlab(outline, topT, { bevel, grain: 'x' }), top, 'top', 0, h - topT, 0);
  }
  return outline;
}

/**
 * Section between two points (angled and spider legs): `geo(len)` is centred and runs along y. `half` = half the
 * section: a leaning leg's foot is lifted so its lowest corner, not its centre, stands on the floor.
 */
function strut(g, geo, material, part, top, foot, half = 0) {
  if (half > 0 && foot[1] < 1e-6) {
    const hd = Math.hypot(top[0] - foot[0], top[2] - foot[2]), vd = top[1] - foot[1];
    foot = [foot[0], (half * Math.SQRT2 * hd) / (Math.hypot(hd, vd) || 1), foot[2]];
  }
  const dir = new THREE.Vector3(top[0] - foot[0], top[1] - foot[1], top[2] - foot[2]);
  const len = dir.length();
  if (len < 0.004) return null;
  const m = add(g, geo(len), material, part, (top[0] + foot[0]) / 2, (top[1] + foot[1]) / 2, (top[2] + foot[2]) / 2);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  return m;
}

/**
 * Leg materials of a table spec: `box` for box/extruded sections (the geometry carries the grain), `round` for turned
 * and tapered legs (grain along the leg), plus the kind and its group.
 */
export function legMats(spec, fallbackKind = 'oak') {
  const kind = spec.materials?.legs || fallbackKind;
  const wood = kindGroup(kind) === 'wood';
  return { kind, group: kindGroup(kind), box: mat(kind, spec.colors?.legs), round: mat(kind, spec.colors?.legs, wood ? { grain: 'v' } : undefined) };
}

/**
 * One table leg from the floor up to yTop at the plan anchor a ({ x, z, ux, uz }) in a leg style:
 * square | round-taper | splayed (foot out 8°) | angled (square, 14°, top further in) | block | metal-thin |
 * metal-square | hairpin. legD = the section (diameter / side). Returns { top: [x, z], foot: [x, z] } in plan.
 */
export function styledLeg(g, style, a, yTop, legD, lm, seg = 12) {
  const { x, z, ux, uz } = a;
  if (yTop < 0.01) return { top: [x, z], foot: [x, z] };
  switch (style) {
    case 'round-taper':
      add(g, K.taperLeg(yTop, legD / 2, legD * 0.35, { seg }), lm.round, 'legs', x, 0, z);
      return { top: [x, z], foot: [x, z] };
    case 'splayed': {
      const t = 8 * K.DEG;
      add(g, splayedLeg(x, yTop + 0.002, z, legD / 2, legD * 0.35, ux * t, uz * t, seg), lm.round, 'legs');
      const out = yTop * Math.tan(t);
      return { top: [x, z], foot: [x + ux * out, z + uz * out] };
    }
    case 'angled': {
      const back = Math.tan(14 * K.DEG) * yTop;
      const top = [x - ux * back, yTop + 0.004, z - uz * back];
      strut(g, (len) => K.box(legD, len, legD, { grain: 'y' }), lm.box, 'legs', top, [x, 0, z], legD / 2);
      return { top: [top[0], top[2]], foot: [x, z] };
    }
    case 'block': {
      const s = Math.max(legD, 0.04);
      add(g, K.roundedBox(s, yTop + 0.001, s, 0.006, 1, { grain: 'y', bottom: true }), lm.box, 'legs', x, 0, z);
      return { top: [x, z], foot: [x, z] };
    }
    case 'metal-thin': {
      const r = clamp(legD / 2, 0.005, 0.0125);
      add(g, K.cylinder(r, r * 0.92, yTop, { seg }), lm.round, 'legs', x, 0, z);
      add(g, K.box(0.04, 0.004, 0.04), lm.box, 'legs', x, yTop - 0.002, z);
      return { top: [x, z], foot: [x, z] };
    }
    case 'hairpin': {
      // two 9 mm rods in the vertical plane along the leg's diagonal, bent into a U at the floor, on a mount plate
      const s = 0.035;
      const prof = [[-s, yTop], [-0.012, 0.05], [-0.005, 0.012], [0, 0.006], [0.005, 0.012], [0.012, 0.05], [s, yTop]];
      const pts = prof.map(([u, y]) => [x + u * ux, y, z + u * uz]);
      add(g, K.tube(pts, 0.0045, { curve: 'catmull', radial: 6, seg: Math.max(16, Math.round(seg * 3)) }), lm.box, 'legs');
      add(g, K.box(0.07, 0.006, 0.07), lm.box, 'legs', x, yTop - 0.003, z);
      return { top: [x, z], foot: [x, z] };
    }
    default: {
      // square / metal-square: a straight box section
      const s = style === 'metal-square' ? clamp(legD, 0.012, 0.05) : legD;
      add(g, K.box(s, yTop, s, { grain: 'y' }), lm.box, 'legs', x, yTop / 2, z);
      return { top: [x, z], foot: [x, z] };
    }
  }
}

/**
 * Handle on a drawer front centred (cx, cy) with its face at zFace (facing +z): knob, bar, cutout (a finger groove at
 * the top edge: a shadowed slot in a darker tone of `frontHex`, near-black without it) or edge (a grip lip along the
 * bottom). `hm` = the handle material.
 */
export function drawerHandle(g, style, hm, cx, cy, zFace, dw, dh, seg = 16, frontHex) {
  if (style === 'knob') add(g, K.cylinder(0.011, 0.014, 0.024, { seg }), hm, 'handle', cx, cy, zFace, [Math.PI / 2, 0, 0]);
  else if (style === 'bar') {
    const len = clamp(dw * 0.38, 0.06, Math.min(0.22, dw - 0.04));
    if (kindGroup(hm.userData?.kind) === 'metal') {
      add(g, K.box(len, 0.011, 0.011, { grain: 'x' }), hm, 'handle', cx, cy, zFace + 0.026);
      for (const s of [-1, 1]) add(g, K.cylinder(0.0045, 0.0045, 0.022, { seg: 8, center: true }), hm, 'handle', cx + s * (len / 2 - 0.012), cy, zFace + 0.011, [Math.PI / 2, 0, 0]);
    } else add(g, K.roundedBox(len, 0.02, 0.016, 0.006, 2, { grain: 'x' }), hm, 'handle', cx, cy, zFace + 0.008);
  } else if (style === 'cutout') {
    const nw = clamp(dw * 0.3, 0.05, 0.12), nd = Math.min(0.022, dh * 0.3);
    const groove = typeof frontHex === 'string' ? mat('painted', tone(frontHex, 0.5), { flat: true, roughness: 0.92 }) : darkInside();
    add(g, K.box(nw, nd, 0.004), groove, null, cx, cy + dh / 2 - nd / 2, zFace - 0.0015);
  } else if (style === 'edge') {
    add(g, K.roundedBox(dw - 0.004, 0.012, 0.018, 0.003, 1, { grain: 'x' }), hm, 'handle', cx, cy - dh / 2 + 0.006, zFace + 0.004);
  }
}

/** Shelf board on a plan outline under a table: board | slats | cane | glass, its upper face at y. */
function shelfInto(g, spec, kind, outline, y, body) {
  const pts = dedupe(outline);
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const p of pts) {
    x0 = Math.min(x0, p.x);
    x1 = Math.max(x1, p.x);
    z0 = Math.min(z0, -p.y);
    z1 = Math.max(z1, -p.y);
  }
  const sw = x1 - x0, sd = z1 - z0;
  if (sw < 0.06 || sd < 0.06) return null;
  if (kind === 'slats') {
    // slats along x, each as long as the outline is wide at its z
    const n = Math.max(2, Math.round(sd / 0.05));
    const pitch = sd / n, sw2 = pitch - 0.012;
    for (let k = 0; k < n; k++) {
      const z = z0 + (k + 0.5) * pitch;
      const half = chordHalf(pts, z);
      if (half < 0.03) continue;
      add(g, K.roundedBox(2 * half - 0.006, 0.016, sw2, 0.003, 1, { grain: 'x' }), body, 'body', 0, y - 0.008, z);
    }
    // two bearers under the slats
    for (const sx of [-1, 1]) {
      const bx = sx * Math.max(0.02, sw / 2 - 0.05);
      const bl = 2 * chordHalfZ(pts, bx) - 0.03;
      if (bl > 0.04) add(g, K.box(0.03, 0.02, bl, { grain: 'z' }), body, 'body', bx, y - 0.026, (z0 + z1) / 2);
    }
  } else if (kind === 'cane' || kind === 'glass') {
    const ft = 0.03;
    const inner = pts.map((p) => new THREE.Vector2(p.x * (1 - (2 * ft) / sw), p.y * (1 - (2 * ft) / sd)));
    const ring = new THREE.Shape(pts);
    ring.holes.push(new THREE.Path([...inner].reverse()));
    add(g, planSlab(ring, 0.02, { grain: 'x' }), body, 'body', 0, y - 0.02, 0);
    const insert = kind === 'cane' ? mat('rattan', tone(spec.colors?.body || '#c7ab8a', 1.12), { open: true }) : mat('glass-clear', '#e9efec');
    const grown = pts.map((p) => new THREE.Vector2(p.x * (1 - (1.6 * ft) / sw), p.y * (1 - (1.6 * ft) / sd)));
    add(g, planSlab(grown, kind === 'cane' ? 0.004 : 0.008), insert, null, 0, y - (kind === 'cane' ? 0.012 : 0.014), 0);
  } else add(g, planSlab(pts, 0.018, { bevel: 0.0015, grain: 'x' }), body, 'body', 0, y - 0.018, 0);
  return { y, w: +(sw * 0.8).toFixed(3), d: +(sd * 0.8).toFixed(3) };
}

/** Half width (largest |x|) of an outline at plan depth z. */
function chordHalf(outline, z) {
  const py = -z;
  let best = 0;
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i], b = outline[(i + 1) % outline.length];
    if (a.y > py === b.y > py) continue;
    const x = a.x + ((py - a.y) / (b.y - a.y)) * (b.x - a.x);
    best = Math.max(best, Math.abs(x));
  }
  return best;
}

/** Half depth (largest |z|) of an outline at plan x. */
function chordHalfZ(outline, x) {
  let best = 0;
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i], b = outline[(i + 1) % outline.length];
    if (a.x > x === b.x > x) continue;
    const y = a.y + ((x - a.x) / (b.x - a.x)) * (b.y - a.y);
    best = Math.max(best, Math.abs(y));
  }
  return best;
}

/**
 * One coffee table (the main one or one of a `set`) into group tg, local to its own centre. Pushes its surfaces.
 * @returns {{ complex: boolean }}
 */
function coffeeTableInto(tg, spec, t, out) {
  const P = spec.params;
  const { w, d, h, shape } = t;
  const n = qSeg(spec, 48);
  const seg = qSeg(spec, 12);
  const topT = clamp(num(P.topT, 0.03), 0.008, Math.min(0.06, h * 0.3));
  const edge = ['straight', 'bevel', 'rounded'].includes(P.edge) ? P.edge : 'straight';
  const cornerR = clamp(num(P.cornerR, 0.03), 0.005, 0.3);
  const softness = clamp(num(P.softness, 4), 3, 6);
  // a set table may carry its own seed and notch (Dråpe: two beans nested notch to notch)
  const seed = clamp(Math.round(num(t.seed, num(P.seed, 1))), 1, 9999);
  const dent = clamp(num(t.dent, num(P.dent, 0)), 0, 0.35);
  const dentAt = num(t.dentAt, num(P.dentAt, Math.PI / 2));
  let base = CT_BASES.includes(P.base) ? P.base : 'legs';
  if (base === 'panel' && !CORNER_SHAPES.has(shape)) base = 'legs';
  const legStyle = CT_LEGS.includes(P.legStyle) ? P.legStyle : 'square';
  const legD = clamp(num(P.legD, 0.045), 0.01, 0.12);
  const legInset = clamp(num(P.legInset, 0.05), 0, 0.4);
  const legCount = clamp(Math.round(num(P.legCount, 4)), 3, 4);
  const lm = legMats(spec);
  const body = pm(spec, 'body', 'oak');
  const hm = pm(spec, 'handle', 'black-metal');
  const io = { cornerR, softness, seed, n, dent, dentAt };
  // a tray rim (brett) stands on the top: the top sinks by the rim height so the rim's upper edge is dims.h
  const trayH = P.tray === true ? clamp(num(P.trayH, 0.022), 0.015, Math.min(0.1, h * 0.3)) : 0;
  const hTop = h - trayH;
  const outline = tableTop(tg, spec, { shape, w, d, h: hTop, topT, edge, ...io });
  if (trayH > 0) {
    const inner = tableOutline(shape, w - 0.03, d - 0.03, { ...io, cornerR: cornerR - 0.015 });
    const rim = new THREE.Shape(dedupe(outline));
    rim.holes.push(new THREE.Path(dedupe(inner).reverse()));
    add(tg, planSlab(rim, trayH, { grain: 'x' }), pm(spec, 'top', 'oak'), 'top', 0, hTop, 0);
  }
  const yUnder = hTop - topT;
  const corner = CORNER_SHAPES.has(shape);
  out.surfaces.push({ y: trayH > 0 ? +hTop.toFixed(4) : h, w: +(corner ? w - 0.04 : w * 0.72).toFixed(3), d: +(corner ? d - 0.04 : d * 0.72).toFixed(3), center: [+t.dx.toFixed(3), +t.dz.toFixed(3)] });
  const shelfKind = ['board', 'slats', 'cane', 'glass'].includes(P.shelf) ? P.shelf : 'none';
  let shelfOutline = null;
  let complex = false;
  const yShelfMax = (y) => clamp(num(P.shelfH, 0.12), 0.04, Math.max(0.05, y - 0.04));

  if (base === 'legs') {
    const drawers = clamp(Math.round(num(P.drawers, 0)), 0, 4);
    const apronOn = P.apron === true || drawers > 0;
    const apronH = clamp(num(P.apronH, 0.07), 0.04, Math.min(0.14, yUnder * 0.5));
    const anchors = legAnchors(shape, outline, w, d, legInset, legStyle === 'block' ? Math.max(legD, 0.04) : legD, legCount);
    const legs = anchors.map((a) => styledLeg(tg, legStyle, a, yUnder, legD, lm, seg));
    const back = legD / 2 - 0.017; // apron board centre line, out from the leg centres (face 6 mm behind the legs')
    if (apronOn) {
      if (corner) {
        const ax = Math.max(...legs.map((l) => Math.abs(l.top[0]))) + back, az = Math.max(...legs.map((l) => Math.abs(l.top[1]))) + back;
        const zs = drawers > 0 ? (P.drawersBack === true ? [] : [-1]) : [-1, 1];
        for (const sz of zs) add(tg, K.box(2 * ax, apronH, 0.022, { grain: 'x' }), body, 'body', 0, yUnder - apronH / 2, sz * az);
        for (const sx of [-1, 1]) add(tg, K.box(0.022, apronH, Math.max(0.02, 2 * az - 0.044), { grain: 'z' }), body, 'body', sx * ax, yUnder - apronH / 2, 0);
        if (drawers > 0) {
          const span = 2 * (ax - legD / 2 - back) - 0.006;
          for (const sz of P.drawersBack === true ? [1, -1] : [1]) {
            const grp = new THREE.Group();
            grp.position.z = sz * az;
            if (sz < 0) grp.rotation.y = Math.PI;
            tg.add(grp);
            add(grp, K.box(span, apronH - 0.004, 0.004), darkInside(), null, 0, yUnder - apronH / 2, -0.006);
            const fw = (span - 0.003 * (drawers - 1)) / drawers;
            for (let k = 0; k < drawers; k++) {
              const cx = -span / 2 + fw / 2 + k * (fw + 0.003);
              add(grp, K.roundedBox(fw, apronH - 0.006, 0.02, 0.0012, 1, { grain: 'x' }), pm(spec, 'front', 'oak'), 'front', cx, yUnder - apronH / 2, 0.001);
              drawerHandle(grp, P.handle, hm, cx, yUnder - apronH / 2, 0.011, fw, apronH - 0.006, 16, spec.colors?.front);
            }
          }
          complex = true;
        }
      } else {
        // a ring of short boards just inside the legs; drawers as flat fronts on the front chord
        const off = legInset + legD / 2 + 0.017;
        const ring = tableOutline(shape, w - 2 * off, d - 2 * off, { ...io, cornerR: cornerR - off, n: Math.max(16, Math.round(n / 2)) });
        for (let i = 0; i < ring.length; i++) {
          const a = ring[i], b = ring[(i + 1) % ring.length];
          const len = Math.hypot(b.x - a.x, b.y - a.y);
          if (len < 0.005) continue;
          add(tg, K.box(len + 0.004, apronH, 0.022, { grain: 'x' }), body, 'body', (a.x + b.x) / 2, yUnder - apronH / 2, -(a.y + b.y) / 2, [0, Math.atan2(b.y - a.y, b.x - a.x), 0]);
        }
        if (drawers > 0) {
          for (const sz of P.drawersBack === true ? [1, -1] : [1]) {
            const zr = rayHit(ring, 0, sz);
            const half = chordHalf(ring, sz * (zr - 0.03)) * 0.8;
            const fw = (2 * half - 0.003 * (drawers - 1)) / drawers;
            const grp = new THREE.Group();
            grp.position.z = sz * (zr - 0.004);
            if (sz < 0) grp.rotation.y = Math.PI;
            tg.add(grp);
            for (let k = 0; k < drawers; k++) {
              const cx = -half + fw / 2 + k * (fw + 0.003);
              add(grp, K.roundedBox(fw, apronH - 0.006, 0.02, 0.0012, 1, { grain: 'x' }), pm(spec, 'front', 'oak'), 'front', cx, yUnder - apronH / 2, 0.01);
              drawerHandle(grp, P.handle, hm, cx, yUnder - apronH / 2, 0.02, fw, apronH - 0.006, 16, spec.colors?.front);
            }
          }
          complex = true;
        }
      }
    }
    if (shelfKind !== 'none') {
      const sy = yShelfMax(yUnder - (apronOn ? apronH : 0));
      const at = sy / yUnder;
      const pos = legs.map((l) => [l.foot[0] + (l.top[0] - l.foot[0]) * at, l.foot[1] + (l.top[1] - l.foot[1]) * at]);
      if (corner) {
        const sx = Math.max(...pos.map((p) => Math.abs(p[0]))) + 0.01, sz = Math.max(...pos.map((p) => Math.abs(p[1]))) + 0.01;
        shelfOutline = roundRectPts(2 * sx, 2 * sz, shape === 'rect' ? 0.004 : 0.012, 3);
      } else {
        const a = anchors[0], p = pos[0];
        const k = (Math.hypot(p[0], p[1]) + 0.01) / Math.max(0.05, rayHit(outline, a.ux, a.uz));
        shelfOutline = tableOutline(shape, w * k, d * k, { ...io, cornerR: cornerR * k });
      }
      out.shelfY = sy;
    }
  } else if (base === 'pedestal') {
    const colR = clamp(legD / 2, 0.03, 0.12);
    const xs = w > d * 1.35 ? [-(w / 2 - d * 0.42), w / 2 - d * 0.42] : [0];
    const footR = Math.max(colR + 0.04, 0.32 * Math.min(w, d));
    for (const x of xs) {
      add(tg, K.cylinder(colR, colR, Math.max(0.01, yUnder - 0.032), { seg: qSeg(spec, 24) }), lm.round, 'legs', x, 0.02, 0);
      add(tg, planSlab(ellipsePts(2 * footR, 2 * footR, qSeg(spec, 48)), 0.02, { bevel: 0.004 }), lm.box, 'legs', x, 0, 0);
      add(tg, planSlab(ellipsePts(colR * 4.4, colR * 4.4, qSeg(spec, 32)), 0.012), body, 'body', x, yUnder - 0.012, 0);
    }
    if (xs.length > 1) add(tg, K.box(xs[1] - xs[0], 0.04, 0.05, { grain: 'x' }), body, 'body', 0, yUnder - 0.02, 0);
  } else if (base === 'drum' || base === 'ribbed') {
    const bi = clamp(num(P.baseInset, 0.1), 0, Math.min(w, d) / 2 - 0.04);
    const wi = w - 2 * bi, di = d - 2 * bi;
    const plinthH = clamp(num(P.plinthH, 0.02), 0, Math.min(0.15, yUnder * 0.4));
    const y0 = plinthH > 0.003 ? plinthH : 0;
    const bo = { ...io, cornerR: cornerR - bi };
    if (base === 'ribbed') {
      const pitch = clamp(num(P.ribPitch, 0.028), 0.012, 0.08);
      const depth = clamp(num(P.ribDepth, 0.004), 0.001, Math.min(0.02, pitch / 2));
      // a plinth slab 15 mm proud of the ribs (never past the top's own outline)
      if (y0) {
        const grow = Math.min(0.03, 2 * bi);
        add(tg, planSlab(tableOutline(shape, wi + grow, di + grow, { ...bo, cornerR: bo.cornerR + grow / 2 }), y0, { bevel: Math.min(0.003, y0 / 4), grain: 'x' }), lm.box, 'legs');
      }
      const col = tableOutline(shape, wi - 2 * depth, di - 2 * depth, { ...bo, cornerR: bo.cornerR - depth, n: Math.max(24, n) });
      add(tg, ribbedColumn(col, Math.max(0.01, yUnder - y0), { pitch, depth }), lm.box, 'legs', 0, y0, 0);
    } else {
      // recessed plinth (a shadow line) under a solid drum
      if (y0) add(tg, planSlab(tableOutline(shape, wi - 0.02, di - 0.02, { ...bo, cornerR: bo.cornerR - 0.01 }), y0, { grain: 'x' }), lm.box, 'legs');
      const taper = clamp(num(P.drumTaper, 0), 0, 0.4);
      if (taper > 0.001 && (shape === 'round' || shape === 'oval')) {
        const r = wi / 2, rb = r * (1 - taper), e = Math.min(0.003, r * 0.05);
        const geo = K.lathe([[0.001, y0], [rb - e, y0], [rb, y0 + e], [r, yUnder - e], [r - e, yUnder], [0.001, yUnder]], { seg: n });
        if (Math.abs(di - wi) > 1e-4) geo.scale(1, 1, di / wi);
        add(tg, geo, lm.round, 'legs');
      } else add(tg, planSlab(tableOutline(shape, wi, di, bo), Math.max(0.01, yUnder - y0), { bevel: Math.min(0.002, bi > 0 ? 0.002 : 0), grain: 'y' }), lm.box, 'legs', 0, y0, 0);
      const nd = clamp(Math.round(num(P.drumDrawers, 0)), 0, 3);
      if (nd > 0) {
        // drawer seams (dark grooves across the front) and a knob per drawer – round nightstands
        const drum = tableOutline(shape, wi, di, bo);
        const zf = rayHit(drum, 0, 1);
        const bandH = Math.min(0.16, (yUnder - y0) / (nd + 1));
        const groove = darkInside();
        const roundish = !CORNER_SHAPES.has(shape);
        for (let k = 1; k <= nd; k++) {
          const y = yUnder - k * bandH;
          if (roundish) {
            const geo = K.torus(wi / 2 + 0.0005, 0.0022, { radial: 4, tubular: Math.max(12, Math.round(n / 2)), arc: (110 * Math.PI) / 180 });
            geo.rotateX(Math.PI / 2);
            geo.rotateY((-35 * Math.PI) / 180);
            if (Math.abs(di - wi) > 1e-4) geo.scale(1, 1, di / wi);
            add(tg, geo, groove, null, 0, y, 0);
          } else add(tg, K.box(wi * 0.92, 0.004, 0.003), groove, null, 0, y, zf);
          drawerHandle(tg, ['knob', 'bar', 'cutout'].includes(P.handle) ? P.handle : 'knob', hm, 0, y + bandH / 2, zf, Math.min(wi, 0.4), bandH, 16, spec.colors?.legs);
        }
      }
    }
  } else if (base === 'panel') {
    const t2 = lm.group === 'metal' ? 0.012 : 0.035;
    const waterfall = P.waterfall === true;
    const x = waterfall ? w / 2 - t2 / 2 : w / 2 - clamp(legInset, 0, w / 2 - 0.1) - t2 / 2;
    const pd = waterfall ? d - (shape === 'rect' ? 0 : 2 * Math.min(shape === 'soft' ? 0.15 * d : cornerR, d / 4)) : d * 0.9;
    for (const sx of [-1, 1]) add(tg, K.box(t2, yUnder, pd, { grain: 'y' }), lm.box, 'legs', sx * x, yUnder / 2, 0);
    if (shelfKind !== 'none') {
      shelfOutline = roundRectPts(2 * x - t2, pd * 0.92, 0.004, 2);
      out.shelfY = yShelfMax(yUnder);
    }
  } else if (base === 'frame') {
    const tw = clamp(num(P.tubeW, 0.02), 0.01, 0.05);
    const inset = clamp(legInset, 0, Math.min(w, d) / 2 - 0.05);
    const floorOn = P.frameFloor !== false;
    const fw = w - 2 * inset, fd = d - 2 * inset;
    if (corner) {
      // square-tube box frame under the top (TV-stue coffee table, Josh)
      const yT = yUnder - tw / 2;
      for (const sz of [-1, 1]) add(tg, K.box(fw, tw, tw, { grain: 'x' }), body, 'body', 0, yT, sz * (fd / 2 - tw / 2));
      for (const sx of [-1, 1]) add(tg, K.box(tw, tw, fd - 2 * tw, { grain: 'z' }), body, 'body', sx * (fw / 2 - tw / 2), yT, 0);
      const py0 = floorOn ? tw : 0, py1 = yUnder - tw;
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) add(tg, K.box(tw, Math.max(0.01, py1 - py0), tw, { grain: 'y' }), lm.box, 'legs', sx * (fw / 2 - tw / 2), (py0 + py1) / 2, sz * (fd / 2 - tw / 2));
      if (floorOn) {
        for (const sz of [-1, 1]) add(tg, K.box(fw, tw, tw, { grain: 'x' }), lm.box, 'legs', 0, tw / 2, sz * (fd / 2 - tw / 2));
        for (const sx of [-1, 1]) add(tg, K.box(tw, tw, fd - 2 * tw, { grain: 'z' }), lm.box, 'legs', sx * (fw / 2 - tw / 2), tw / 2, 0);
      }
      if (shelfKind !== 'none') shelfOutline = roundRectPts(fw - 0.004, fd - 0.004, 0.004, 2);
    } else {
      // a band under the top, posts round it and a ring on the floor (as the nesting tables)
      const ring = tableOutline(shape, fw, fd, { ...io, cornerR: cornerR - inset });
      const band = new THREE.Shape(dedupe(ring));
      band.holes.push(new THREE.Path(dedupe(tableOutline(shape, fw - 2 * tw * 0.5, fd - 2 * tw * 0.5, { ...io, cornerR: cornerR - inset - tw / 2 })).reverse()));
      const bandH = Math.max(tw, 0.03);
      add(tg, planSlab(band, bandH, { grain: 'x' }), body, 'body', 0, yUnder - bandH, 0);
      const posts = legAnchors(shape, ring, fw, fd, tw * 0.25, tw, legCount);
      const py0 = floorOn ? tw : 0;
      for (const p of posts) add(tg, K.cylinder(tw / 2, tw / 2, Math.max(0.01, yUnder - bandH - py0 + 0.002), { seg }), lm.round, 'legs', p.x, py0 - 0.001, p.z);
      if (floorOn) {
        const r = Math.hypot(posts[0].x, posts[0].z) / Math.max(0.05, rayHit(ring, posts[0].ux, posts[0].uz));
        const fl = tableOutline(shape, fw * r, fd * r, { ...io, cornerR: (cornerR - inset) * r, n: Math.max(16, Math.round(n / 2)) });
        add(tg, K.tube(fl.map((p) => [p.x, tw / 2, -p.y]), tw / 2, { closed: true, radial: Math.max(4, Math.round(seg / 2)) }), lm.box, 'legs');
      }
      if (shelfKind !== 'none') shelfOutline = tableOutline(shape, fw * 0.9, fd * 0.9, { ...io, cornerR: (cornerR - inset) * 0.9 });
    }
    if (shelfOutline) out.shelfY = yShelfMax(yUnder - tw);
  } else if (base === 'sled' || base === 'x') {
    const wood = lm.group === 'wood' || lm.group === 'stone';
    const inset = clamp(legInset, 0.02, w / 2 - 0.08);
    let span = clamp(d * (base === 'sled' ? 0.82 : 0.72), 0.2, d - 0.04);
    // crossed bars under a round or oval top: never wider than the top's own depth at the bars' x
    if (base === 'x' && !corner) span = Math.max(0.1, Math.min(span, 2 * chordHalfZ(outline, w / 2 - inset - 0.03) - 0.04));
    if (base === 'sled') {
      // two closed side frames (mederammer) of tube or wood, a spine under the top
      const t2 = wood ? 0.04 : clamp(num(P.tubeW, 0.025), 0.015, 0.04);
      const fx = w / 2 - inset - t2 / 2;
      const top = span * 0.92;
      for (const sx of [-1, 1]) {
        const x = sx * fx;
        add(tg, K.box(t2, t2, top, { grain: 'z' }), lm.box, 'legs', x, yUnder - t2 / 2, 0);
        add(tg, K.box(t2, t2, span, { grain: 'z' }), lm.box, 'legs', x, t2 / 2, 0);
        for (const sz of [-1, 1]) strut(tg, (len) => K.box(t2, len + t2 * 0.5, t2, { grain: 'y' }), lm.box, 'legs', [x, yUnder - t2, sz * (top / 2 - t2 / 2)], [x, t2, sz * (span / 2 - t2 / 2)]);
      }
      add(tg, K.box(2 * fx, 0.03, 0.03, { grain: 'x' }), body, 'body', 0, yUnder - 0.015, 0);
      if (shelfKind !== 'none') {
        shelfOutline = roundRectPts(2 * fx - t2, span - 2 * t2, 0.004, 2);
        out.shelfY = yShelfMax(yUnder);
      }
    } else {
      // two crossed bars at each end and a stretcher (kryssben)
      const fx = w / 2 - inset - 0.03;
      const bw = wood ? 0.05 : 0.035, bt = wood ? 0.035 : 0.015;
      // each bar from the floor up to the opposite top corner, cut level at the floor and under the top
      for (const sx of [-1, 1]) for (const s2 of [-1, 1]) add(tg, barYZ(-s2 * span / 2, 0, s2 * span / 2, yUnder, bw, bt), lm.box, 'legs', sx * fx + s2 * bt * 0.55, 0, 0);
      add(tg, K.box(2 * fx, 0.04, 0.035, { grain: 'x' }), lm.box, 'legs', 0, yUnder * 0.45, 0);
      add(tg, K.box(2 * fx, 0.03, 0.03, { grain: 'x' }), body, 'body', 0, yUnder - 0.015, 0);
    }
  } else if (base === 'v') {
    const metal = lm.group === 'metal';
    const inset = clamp(legInset, 0.02, Math.min(w, d) / 2 - 0.08);
    if (lm.group === 'stone') {
      // stone: two upright slabs meeting near the front middle and opening toward the back corners, a V in plan (Vega);
      // hidden vDepth = the V's depth from the apex to the slab ends: a shallow V reaches out to the sides and shows
      // both slab faces from the front (centred on the same z as the default V)
      const t2 = 0.03;
      const vDepth = typeof P.vDepth === 'number' && Number.isFinite(P.vDepth) ? clamp(P.vDepth, 0.05, Math.max(0.05, d - 2 * inset - 0.06)) : null;
      const zc = -0.04;
      const apex = [0, vDepth != null ? zc + vDepth / 2 : d / 2 - inset - 0.12];
      for (const sx of [-1, 1]) {
        const end = vDepth != null ? [sx * (w / 2 - inset - 0.04), zc - vDepth / 2] : [sx * (w / 2 - inset - 0.06), -(d / 2 - inset - 0.04)];
        const len = Math.hypot(end[0] - apex[0], end[1] - apex[1]);
        const ang = Math.atan2(end[1] - apex[1], end[0] - apex[0]);
        add(tg, K.box(len, yUnder, t2, { grain: 'y' }), lm.box, 'legs', (apex[0] + end[0]) / 2, yUnder / 2, (apex[1] + end[1]) / 2, [0, -ang, 0]);
      }
    } else {
      // a V of flat bars at each end, meeting on the floor, a rail across the top of each V and a spine
      const bw = clamp(legD, 0.03, 0.08), bt = metal ? 0.012 : 0.03;
      const fx = w / 2 - inset - bt / 2;
      let zt = Math.max(0.05, d / 2 - 0.06);
      // under a round or oval top the end rail stays inside the top's depth at its x
      if (!corner) zt = Math.max(0.05, Math.min(zt, chordHalfZ(outline, fx) - 0.02 - bw / 2));
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) add(tg, barYZ(0, 0, sz * zt, yUnder - 0.03, bw, bt), lm.box, 'legs', sx * fx, 0, 0);
        add(tg, K.box(bt, 0.03, 2 * zt + bw, { grain: 'z' }), lm.box, 'legs', sx * fx, yUnder - 0.015, 0);
      }
      add(tg, K.box(2 * fx, 0.03, 0.03, { grain: 'x' }), body, 'body', 0, yUnder - 0.015, 0);
      if (shelfKind !== 'none') {
        shelfOutline = roundRectPts(2 * fx - bt, 2 * zt * 0.5, 0.004, 2);
        out.shelfY = clamp(num(P.shelfH, 0.12), yUnder * 0.55, yUnder - 0.06);
      }
    }
  } else if (base === 'cross') {
    // two full-height slabs crossing at right angles under the middle, an X in plan (Ritz), on a small plate under
    // the top; hidden crossL = the length of each slab, legD = its thickness. Any material.
    const sT = clamp(legD, 0.02, 0.08);
    const plateT = 0.012;
    const reach = Math.min(...[[1, 1], [-1, 1], [1, -1], [-1, -1]].map(([a, b]) => rayHit(outline, a * Math.SQRT1_2, b * Math.SQRT1_2) || Math.min(w, d) / 2));
    const crossL = clamp(num(P.crossL, Math.min(w, d) * 0.6), 0.1, Math.max(0.1, 2 * (reach - 0.03)));
    const sh = Math.max(0.01, yUnder - plateT);
    for (const s of [-1, 1]) add(tg, K.box(crossL, sh, sT, { grain: 'y' }), lm.box, 'legs', 0, sh / 2, 0, [0, (s * Math.PI) / 4, 0]);
    const pr = clamp(crossL * 0.22, 0.05, 0.16);
    add(tg, K.cylinder(pr, pr, plateT, { seg: qSeg(spec, 24) }), body, 'body', 0, yUnder - plateT, 0);
  } else if (base === 'spider') {
    // legs from a hub under the middle out to the floor (Bastia, Ritz); hidden hubH puts the hub low on a column,
    // the legs then splay from there (spider foot, Celma)
    const hub = clamp(Math.min(w, d) * 0.12, 0.025, 0.12);
    const yh = clamp(num(P.hubH, yUnder - 0.02), 0.06, yUnder - 0.02);
    // feet on the diagonals, never leaning more than ≈ 38° (a long rectangular top would splay them flat)
    const reach = hub + yh * Math.tan(38 * K.DEG);
    const feet = legAnchors(CORNER_SHAPES.has(shape) ? 'oval' : shape, outline, w, d, legInset, legD, legCount).map((f) => {
      const r = Math.hypot(f.x, f.z);
      return r > reach ? { ...f, x: f.ux * reach, z: f.uz * reach } : f;
    });
    const hubR = yh < yUnder - 0.06 ? Math.max(0.012, legD) : hub;
    for (const f of feet) {
      const top = [f.ux * hubR, yh, f.uz * hubR];
      if (legStyle === 'metal-thin' || legStyle === 'hairpin') {
        const r = clamp(legD / 2, 0.005, 0.0125);
        strut(tg, (len) => K.cylinder(r, r, len, { seg, center: true }), lm.round, 'legs', top, [f.x, 0, f.z], r / Math.SQRT2);
      } else if (legStyle === 'round-taper') strut(tg, (len) => K.cylinder(legD / 2, legD * 0.35, len, { seg, center: true }), lm.round, 'legs', top, [f.x, 0, f.z], (legD * 0.35) / Math.SQRT2);
      else {
        const s = Math.max(legD, 0.03);
        strut(tg, (len) => K.box(s, len, s, { grain: 'y' }), lm.box, 'legs', top, [f.x, 0, f.z], s / 2);
      }
    }
    if (yh < yUnder - 0.06) {
      // the column from the hub up to a plate under the top
      const cr = clamp(legD * 0.6, 0.007, 0.04);
      add(tg, K.cylinder(cr, cr, yUnder - yh, { seg }), lm.round, 'legs', 0, yh - 0.01, 0);
      add(tg, K.cylinder(Math.max(cr * 1.6, 0.012), Math.max(cr * 1.6, 0.012), 0.025, { seg }), lm.round, 'legs', 0, yh - 0.02, 0);
      add(tg, K.cylinder(cr * 3, cr * 3, 0.008, { seg: qSeg(spec, 24) }), body, 'body', 0, yUnder - 0.008, 0);
    } else add(tg, K.cylinder(hub + 0.02, hub + 0.02, 0.03, { seg: qSeg(spec, 24) }), body, 'body', 0, yUnder - 0.03, 0);
  } else if (base === 'cabinet') {
    // storage under the top (konsollbord with a box, Nola with tambour doors): the cabinet builder as a child
    const bi = clamp(num(P.baseInset, 0.04), 0, Math.min(w, d) / 2 - 0.1);
    const cw = w - 2 * bi, cd = d - 2 * bi;
    const legH = clamp(num(P.cabinetLegH, 0), 0, yUnder - 0.08);
    const roundish = !CORNER_SHAPES.has(shape);
    const cab = buildCabinet({
      dims: { w: cw, d: cd, h: yUnder },
      params: {
        fronts: Array.isArray(P.fronts) && P.fronts.length ? P.fronts : ['open'], frontStyle: P.frontStyle, slidingDoors: P.slidingDoors === true,
        ribPitch: P.ribPitch, base: legH > 0.005 ? 'legs' : 'none', legH, legMaxFrac: 0.95, legStyle: P.cabinetLegStyle ?? 'metal-thin',
        handle: P.handle, top: 'same', corners: shape === 'rect' ? 'square' : 'rounded', cornerR: roundish ? cd / 2 : cornerR,
      },
      colors: spec.colors, materials: spec.materials, quality: spec.quality,
    }, 'coffee-table');
    tg.add(cab);
    complex = true;
  }
  if (shelfOutline && shelfKind !== 'none') {
    const s = shelfInto(tg, spec, shelfKind, shelfOutline, out.shelfY, body);
    if (s) out.surfaces.push({ ...s, y: +s.y.toFixed(4), center: [+t.dx.toFixed(3), +t.dz.toFixed(3)] });
  }
  out.shelfY = undefined;
  return { complex };
}

function buildCoffeeTable(spec) {
  const { w, d, h } = spec.dims;
  const P = spec.params;
  const g = new THREE.Group();
  const shape = CT_SHAPES.includes(P.shape) ? P.shape : 'rect';
  const out = { surfaces: [] };
  const tables = [{ w, d, h, dx: 0, dz: 0, shape }];
  // a set (settbord, Dråpe): extra tables in the same style, dims and offsets in metres from the main table's centre
  if (Array.isArray(P.set)) {
    for (const s of P.set.slice(0, 4)) {
      if (!s || typeof s !== 'object') continue;
      tables.push({
        w: clamp(num(s.w, w * 0.8), 0.2, 2), d: clamp(num(s.d, d * 0.8), 0.2, 1.3), h: clamp(num(s.h, h * 0.85), 0.2, 0.85),
        dx: clamp(num(s.dx, 0), -2, 2), dz: clamp(num(s.dz, 0), -2, 2), shape: CT_SHAPES.includes(s.shape) ? s.shape : shape,
        seed: s.seed, dent: s.dent, dentAt: s.dentAt,
      });
    }
  }
  let complex = false;
  for (const t of tables) {
    const tg = new THREE.Group();
    tg.position.set(t.dx, 0, t.dz);
    g.add(tg);
    complex = coffeeTableInto(tg, spec, t, out).complex || complex;
  }
  const colliders = tables.length > 1 ? tables.map((t) => ({ min: [t.dx - t.w / 2, 0, t.dz - t.d / 2], max: [t.dx + t.w / 2, t.h, t.dz + t.d / 2] })) : undefined;
  const legKind = spec.materials?.legs || 'oak';
  const handleKind = spec.materials?.handle || 'black-metal';
  const bevel = P.edge === 'bevel';
  const rc = recolorer(g, (part, kind) =>
    (part === 'top' && bevel) || (part === 'front' && complex) || (part === 'body' && complex && P.base === 'cabinet') ||
    (part === 'legs' && !!kind && kindGroup(kind) !== kindGroup(legKind)) || (part === 'handle' && !!kind && kindGroup(kind) !== kindGroup(handleKind)));
  g.name = 'coffee-table';
  return K.finishModel(g, { surfaces: out.surfaces, colliders, recolor: rc });
}

// ---------------------------------------------------------------------------------------------------------------
// Sideboards and TV benches

/** Parses a front column code: 'door' | 'glass' | 'open' | 'drawer' | 'drawersN'. */
function parseCell(code) {
  const s = String(code || 'door').toLowerCase();
  // flip:N = N tilt-out compartments (shoe cabinets): drawer-like fronts with the grip at the top edge
  if (s.startsWith('flip')) return { kind: 'drawers', n: clamp(parseInt(s.replace(/\D/g, ''), 10) || 2, 1, 8), flip: true };
  if (s.startsWith('drawer')) return { kind: 'drawers', n: clamp(parseInt(s.replace(/\D/g, ''), 10) || (s === 'drawer' ? 1 : 3), 1, 8) };
  if (s === 'mirror') return { kind: 'door', n: 1, mirror: true };
  // door+drawers:N / mirror+drawers:N = a door over N drawers in the same column (wardrobes)
  const split = /^(door|mirror)\+drawers?:?(\d*)$/.exec(s);
  if (split) return { kind: 'door', n: 1, mirror: split[1] === 'mirror', drawersBelow: clamp(parseInt(split[2], 10) || 2, 1, 6) };
  if (s === 'glass' || s === 'open' || s === 'door') return { kind: s, n: 1 };
  return { kind: 'door', n: 1 };
}

/** Front columns from params.fronts, resized to params.doors when that is set. */
function frontColumns(P, w) {
  let cols = Array.isArray(P.fronts) && P.fronts.length ? P.fronts.map(String) : null;
  const want = typeof P.doors === 'number' && Number.isFinite(P.doors) ? clamp(Math.round(P.doors), 1, 8) : null;
  if (!cols) cols = Array(want ?? Math.max(1, Math.round(w / 0.5))).fill('door');
  else if (want && want !== cols.length) {
    if (want < cols.length) cols = cols.slice(0, want);
    else while (cols.length < want) cols.push(cols.includes('glass') && !cols.includes('door') ? 'glass' : 'door');
  }
  return cols.map(parseCell);
}

/** Handle side for door i of n: +1 = handle at the right edge, −1 = left (pairs meet in the middle). */
function handleSide(i, n) {
  if (n === 1) return 1;
  if (n % 2 === 0) return i % 2 === 0 ? 1 : -1;
  const c = (n - 1) / 2;
  return i < c ? 1 : -1;
}

/**
 * Herringbone (chevron) veneer face, dw × dh in the x–y plane facing +z, centred: tiles at ±45° with alternating
 * grain, fine joints (cabinet fronts, desk tops).
 */
export function herringboneGeometry(dw, dh) {
  const B = new GeoBuilder();
  const nc = Math.max(1, Math.round(dw / 0.2));
  const cw = dw / nc;
  const plank = 0.055;
  const per = plank * Math.SQRT2;
  const jg = 0.0012;
  const yMin = -dh / 2, yMax = dh / 2;
  for (let c = 0; c < nc; c++) {
    const cx = -dw / 2 + (c + 0.5) * cw;
    for (const half of [-1, 1]) {
      const ua = half < 0 ? -cw / 2 : jg / 2, ub = half < 0 ? -jg / 2 : cw / 2;
      // strips s = y − half·u ∈ [k·per, (k+1)·per − jg]
      const sMin = yMin - cw, sMax = yMax + cw;
      for (let k = Math.floor(sMin / per); k * per < sMax; k++) {
        const s0 = k * per + jg / 2, s1 = (k + 1) * per - jg / 2;
        let pts = [
          new THREE.Vector2(ua, s0 + half * ua), new THREE.Vector2(ub, s0 + half * ub),
          new THREE.Vector2(ub, s1 + half * ub), new THREE.Vector2(ua, s1 + half * ua),
        ];
        pts = clipHalf(pts, 'y', yMin + jg, true);
        if (pts.length >= 3) pts = clipHalf(pts, 'y', yMax - jg, false);
        if (pts.length < 3) continue;
        const dir = new THREE.Vector2(1, half).normalize();
        const off = (c * 7.31 + k * 3.17 + (half > 0 ? 1.9 : 0)) % 5;
        B.poly(pts.map((p) => [cx + p.x, p.y, 0]), [0, 0, 1], (q) => [(q[0] - cx) * dir.x + q[1] * dir.y + off, -(q[0] - cx) * dir.y + q[1] * dir.x]);
      }
    }
  }
  return B.build();
}

export function buildCabinet(spec, arch) {
  const { w, d, h } = spec.dims;
  const P = spec.params;
  const M = spec.materials || {}, C = spec.colors || {};
  const g = new THREE.Group();
  const seg = qSeg(spec, 8);

  // -- configuration ------------------------------------------------------------------------------------------
  const base = P.base || 'legs';
  const wall = base === 'wall';
  const lift = wall ? clamp(num(P.mountHeight, 0.3), 0, 2) : 0;
  const toFloor = !!P.roundedEndsToFloor && !wall;
  const legH = wall || base === 'none' ? 0 : clamp(num(P.legH, 0.15), 0, h * clamp(num(P.legMaxFrac, 0.6), 0.6, 0.95));
  const yb = lift + legH;
  const yt = lift + h;
  const frontKind = M.front || 'oak';
  let style = P.frontStyle || 'flat';
  if (frontKind === 'rattan') style = 'cane';
  else if (isTransparentKind(frontKind)) style = 'glass';
  // a textile front material means speaker-cloth fronts (TV-benk Vision), the way rattan means cane
  else if (kindGroup(frontKind) === 'fabric') style = 'fabric';
  if (style === 'cane' && frontKind !== 'rattan' && !['wood', 'other'].includes(kindGroup(frontKind))) style = 'flat';
  const herring = P.frontPattern === 'herringbone' && (style === 'flat' || style === 'ribbed');
  if (herring) style = 'flat';
  const handle = ['bar', 'cutout', 'knob', 'none', 'edge'].includes(P.handle) ? P.handle : 'none';
  const stone = P.top === 'marble' || P.top === 'stone' || STONE.has(M.top);
  const sT = stone ? clamp(num(P.topT, 0.02), 0.01, 0.05) : 0;
  const tpT = stone ? 0.016 : clamp(num(P.topT, 0.022), 0.012, 0.06);
  const botT = 0.018, gT = 0.018;
  const rMax = Math.min(d / 2 - 0.001, w / 4);
  let r = P.corners === 'rounded' ? num(P.cornerR, toFloor || P.slidingDoors ? d / 2 : 0.04) : 0.003;
  r = clamp(r, 0.001, rMax);
  const endW = Math.max(gT, r);
  let cells = frontColumns(P, w);
  const anyOpen = cells.some((c) => c.kind === 'open' || c.kind === 'glass');
  const fit = !anyOpen && (P.frontFit === 'overlay' || (P.frontFit !== 'inset' && wall)) && !toFloor && r < 0.02 ? 'overlay' : 'inset';
  const fT = 0.019;
  const zf = d / 2;
  const ribPitch = clamp(num(P.ribPitch, 0.016), 0.006, 0.06);

  const body = pm(spec, 'body', 'oak');
  const front = mat(frontKind, C.front);
  const topMat = pm(spec, 'top', 'oak');
  const legKind = M.legs || 'black-metal';
  const legWood = kindGroup(legKind) === 'wood';
  const legsMat = mat(legKind, C.legs);
  const legsRound = mat(legKind, C.legs, legWood ? { grain: 'v' } : undefined);
  const handleKind = M.handle || 'black-metal';
  const handleMat = mat(handleKind, C.handle);
  const dark = darkInside();
  const outline = roundRectPts(w, d, r, seg);

  // -- carcass -------------------------------------------------------------------------------------------------
  const yTopPanel = yt - sT - tpT;
  if (stone) {
    add(g, planSlab(outline, sT, { bevel: 0.0015, grain: 'x' }), topMat, 'top', 0, yt - sT, 0);
  }
  let xo0, xo1, yo0, yo1;
  if (fit === 'overlay') {
    const cd = d - fT;
    const cOutline = roundRectPts(w, cd, r, seg);
    add(g, planSlab(cOutline, tpT, { bevel: stone ? 0 : 0.0015, grain: 'x' }), stone ? body : topMat, stone ? 'body' : 'top', 0, yTopPanel, -fT / 2);
    add(g, planSlab(cOutline, yTopPanel - yb, { grain: 'y' }), body, 'body', 0, yb, -fT / 2);
    add(g, K.box(w - 0.002, yt - yb - 0.002, 0.001), dark, null, 0, (yb + yt) / 2, zf - fT + 0.0006);
    xo0 = -w / 2;
    xo1 = w / 2;
    yo0 = yb;
    yo1 = yt;
  } else {
    add(g, planSlab(outline, tpT, { bevel: stone ? 0 : 0.0015, grain: 'x' }), stone ? body : topMat, stone ? 'body' : 'top', 0, yTopPanel, 0);
    xo0 = -w / 2 + endW;
    xo1 = w / 2 - endW;
    yo0 = yb + botT;
    yo1 = yTopPanel;
    if (toFloor) add(g, K.box(xo1 - xo0, botT, d, { grain: 'x' }), body, 'body', 0, yb + botT / 2, 0);
    else add(g, planSlab(outline, botT, { grain: 'x' }), body, 'body', 0, yb, 0);
    // gables (with the rounded ends of the plan)
    const gy0 = toFloor ? lift : yo0;
    for (const sx of [-1, 1]) {
      let pts = sx > 0 ? clipHalf(outline, 'x', w / 2 - endW, true) : clipHalf(outline, 'x', -w / 2 + endW, false);
      pts = dedupe(pts);
      if (pts.length >= 3) add(g, planSlab(pts, yo1 - gy0, { grain: 'y' }), body, 'body', 0, gy0, 0);
    }
    add(g, K.box(xo1 - xo0, yo1 - yo0, 0.012, { grain: 'x' }), body, 'body', 0, (yo0 + yo1) / 2, -d / 2 + 0.006);
  }
  const openW = xo1 - xo0;

  // -- fronts --------------------------------------------------------------------------------------------------
  const gap = 0.003;
  const eg = fit === 'inset' ? 0.0025 : 0.001;
  const drawerRow = clamp(Math.round(num(P.drawerRow, 0)), 0, 6);
  const openH = yo1 - yo0;
  // the band may not swallow the columns: 45 % of the opening, 75 % when the columns are open niches (a short niche
  // over a tall drawer or door: SKAVE, RÅDMANSÖ, BESTÅ)
  const capFrac = cells.every((c) => c.kind === 'open') ? 0.75 : 0.45;
  const bandH = drawerRow ? clamp(num(P.drawerH, openH * 0.24), 0.08, openH * capFrac) : 0;
  const rowBottom = drawerRow > 0 && P.drawerRowPos === 'bottom';
  const yCols0 = rowBottom ? yo0 + bandH : yo0;
  const yCols1 = rowBottom ? yo1 : yo1 - bandH;
  const graduated = P.graduated === true;
  const handleYAbs = typeof P.handleY === 'number' && Number.isFinite(P.handleY) ? P.handleY : null;
  const nCols = cells.length;
  const colW = openW / nCols;
  const doorCount = cells.filter((c) => c.kind === 'door' || c.kind === 'glass').length;
  let doorIdx = 0;
  const complexFront = style !== 'flat' || herring || handle === 'cutout' || cells.some((c) => c.mirror) || P.doorFrame === 'alu';
  // speaker cloth goes on the doors; the drawers next to them are plain wood (Vision)
  const clothOnDoors = style === 'fabric' && (cells.some((c) => c.kind === 'door' && !c.mirror) || (drawerRow > 0 && P.drawerRowDoors === true));

  /** Interior behind a closed cell (dark) – or a lined niche (body) for open/glass cells. */
  const interior = (x0, x1, y0, y1, lined, i) => {
    if (fit === 'overlay') return;
    // behind the back track of sliding doors (an aluminium-framed back door sits 2,6 cm in)
    const zb = -d / 2 + 0.012, ze = zf - fT - 0.0015 - (P.slidingDoors ? (P.doorFrame === 'alu' ? 0.03 : 0.016) : 0);
    if (!lined) {
      add(g, K.box(x1 - x0 - 0.001, y1 - y0 - 0.001, ze - zb), dark, null, (x0 + x1) / 2, (y0 + y1) / 2, (zb + ze) / 2);
      return;
    }
    const dt = 0.016;
    const depthIn = zf - 0.004 - zb;
    if (i > 0) add(g, K.box(dt, y1 - y0, depthIn, { grain: 'z' }), body, 'body', x0 + dt / 2, (y0 + y1) / 2, zb + depthIn / 2);
    if (i < nCols - 1) add(g, K.box(dt, y1 - y0, depthIn, { grain: 'z' }), body, 'body', x1 - dt / 2, (y0 + y1) / 2, zb + depthIn / 2);
    const sx0 = x0 + (i > 0 ? dt : 0), sx1 = x1 - (i < nCols - 1 ? dt : 0);
    if (y1 - y0 > 0.26) add(g, K.box(sx1 - sx0, dt, depthIn - 0.02, { grain: 'x' }), body, 'body', (sx0 + sx1) / 2, (y0 + y1) / 2, zb + (depthIn - 0.02) / 2);
  };

  /** Handle on a front: vertical near the opening edge for doors, horizontal and centred for drawers. */
  const addHandle = (x0, x1, y0, y1, side, drawer, zFace, flip = false) => {
    if (handle === 'none' || handle === 'cutout') return;
    const dw = x1 - x0, dh = y1 - y0;
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    if (handle === 'edge') {
      // a thin grip lip along the top edge of drawers/flaps, along the opening edge of doors
      if (drawer) add(g, K.roundedBox(dw - 0.004, 0.014, 0.02, 0.003, 1, { grain: 'x' }), handleMat, 'handle', cx, y1 - 0.007, zFace + 0.006);
      else {
        const len = clamp(num(P.handleLen, Math.min(dh * 0.5, 0.6)), 0.08, dh - 0.04);
        const hy = handleYAbs != null ? clamp(handleYAbs, y0 + len / 2 + 0.02, y1 - len / 2 - 0.02) : dh > 0.7 ? y1 - 0.04 - len / 2 : cy;
        add(g, K.roundedBox(0.014, len, 0.02, 0.003, 1, { grain: 'y' }), handleMat, 'handle', side > 0 ? x1 - 0.007 : x0 + 0.007, hy, zFace + 0.006);
      }
      return;
    }
    if (flip && handle === 'knob') {
      add(g, K.cylinder(0.011, 0.014, 0.024, { seg: qSeg(spec, 16) }), handleMat, 'handle', cx, y1 - 0.045, zFace, [Math.PI / 2, 0, 0]);
      return;
    }
    if (handle === 'knob') {
      const kx = drawer ? cx : side > 0 ? x1 - 0.04 : x0 + 0.04;
      const ky = !drawer && handleYAbs != null ? clamp(handleYAbs, y0 + 0.04, y1 - 0.04) : cy;
      add(g, K.cylinder(0.011, 0.014, 0.024, { seg: qSeg(spec, 16) }), handleMat, 'handle', kx, ky, zFace, [Math.PI / 2, 0, 0]);
      return;
    }
    const metal = kindGroup(handleKind) === 'metal';
    if (drawer) {
      const len = clamp(num(P.handleLen, dw * 0.38), 0.08, Math.min(0.26, dw - 0.06));
      const hy = dh < 0.14 ? cy : y1 - 0.045;
      if (metal) {
        add(g, K.box(len, 0.011, 0.011, { grain: 'x' }), handleMat, 'handle', cx, hy, zFace + 0.026);
        for (const s of [-1, 1]) add(g, K.cylinder(0.0045, 0.0045, 0.022, { seg: 8, center: true }), handleMat, 'handle', cx + s * (len / 2 - 0.012), hy, zFace + 0.011, [Math.PI / 2, 0, 0]);
      } else {
        add(g, K.roundedBox(len, 0.022, 0.018, 0.006, 2, { grain: 'x' }), handleMat, 'handle', cx, hy, zFace + 0.009);
      }
      return;
    }
    const len = clamp(num(P.handleLen, dh * 0.42), 0.08, dh - 0.06);
    const hx = side > 0 ? x1 - 0.034 : x0 + 0.034;
    const hy = handleYAbs != null ? clamp(handleYAbs, y0 + len / 2 + 0.03, y1 - len / 2 - 0.03) : dh > 0.7 ? y1 - 0.06 - len / 2 : cy;
    if (metal) {
      add(g, K.box(0.011, len, 0.011, { grain: 'y' }), handleMat, 'handle', hx, hy, zFace + 0.026);
      for (const s of [-1, 1]) add(g, K.cylinder(0.0045, 0.0045, 0.022, { seg: 8, center: true }), handleMat, 'handle', hx, hy + s * (len / 2 - 0.012), zFace + 0.011, [Math.PI / 2, 0, 0]);
    } else {
      add(g, K.roundedBox(0.024, len, 0.02, 0.007, 2, { grain: 'y' }), handleMat, 'handle', hx, hy, zFace + 0.01);
    }
  };

  /** Herringbone (chevron) veneer face for a front (herringboneGeometry). */
  const herringboneFace = herringboneGeometry;

  /** One front (door or drawer) in the rect x0..x1 × y0..y1. */
  const addFront = (x0, x1, y0, y1, { side = 1, drawer = false, glass = false, track = 0, mirror = false, flip = false }) => {
    const dw = x1 - x0, dh = y1 - y0;
    if (dw < 0.02 || dh < 0.02) return;
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    const zFace = zf - track * (P.doorFrame === 'alu' ? 0.026 : 0.014);
    const zBack = zFace - fT;
    const grain = drawer && style === 'flat' ? 'x' : 'y';
    // glass drawers get plain fronts, and so do drawers beside a cloth door (the cloth is the door's); cane only on
    // shallow drawers (deep ones keep the framed cane panel, Shimoda)
    let st = glass ? 'glass' : drawer && (style === 'glass' || (style === 'fabric' && clothOnDoors) || (style === 'cane' && dh < 0.12)) ? 'flat' : style;
    if (mirror) st = 'mirror';
    // a plain drawer under speaker cloth is the carcass wood (Vision: oak drawers beside a cloth door)
    const asBody = drawer && style === 'fabric' && st === 'flat';
    const fm = asBody ? body : front, fp = asBody ? 'body' : 'front';
    if (P.slidingDoors && P.doorFrame === 'alu' && !drawer) {
      // sliding door in a slim aluminium frame (handle part), divided into horizontal panels by thin rails
      const fw = 0.022;
      for (const s of [-1, 1]) add(g, K.box(fw, dh, fT + 0.006, { grain: 'y' }), handleMat, 'handle', s > 0 ? x1 - fw / 2 : x0 + fw / 2, cy, zFace - fT / 2);
      for (const s of [-1, 1]) add(g, K.box(dw - 2 * fw, fw * 0.8, fT + 0.004, { grain: 'x' }), handleMat, 'handle', cx, s > 0 ? y1 - fw * 0.4 : y0 + fw * 0.4, zFace - fT / 2);
      const nP = clamp(Math.round(num(P.slidingPanels, 1)), 1, 6);
      const iw = dw - 2 * fw, ih = dh - 1.6 * fw;
      const ph = (ih - (nP - 1) * 0.012) / nP;
      for (let k = 0; k < nP; k++) {
        const py0 = y0 + 0.8 * fw + k * (ph + 0.012);
        if (k > 0) add(g, K.box(iw, 0.012, fT + 0.002, { grain: 'x' }), handleMat, 'handle', cx, py0 - 0.006, zFace - fT / 2);
        if (mirror) add(g, K.box(iw, ph, 0.006), mat('mirror', '#c9cfd0'), null, cx, py0 + ph / 2, zFace - fT / 2);
        else add(g, K.box(iw, ph, fT - 0.006, { grain: 'y' }), front, 'front', cx, py0 + ph / 2, zFace - fT / 2);
      }
      return;
    }
    if (st === 'mirror') {
      // a door panel with a mirror glued on, 1 cm of the door edge showing
      add(g, K.roundedBox(dw, dh, fT, 0.0012, 1, { grain: 'y' }), front, 'front', cx, cy, zBack + fT / 2);
      add(g, K.box(dw - 0.02, dh - 0.02, 0.004), mat('mirror', '#c9cfd0'), null, cx, cy, zFace + 0.0015);
    } else if (st === 'grooved') {
      add(g, K.roundedBox(dw, dh, fT, 0.0012, 1, { grain: 'y' }), front, 'front', cx, cy, zBack + fT / 2);
      const n = drawer ? 0 : clamp(Math.round(dw / 0.1) - 1, 2, 8);
      const gm = mat(frontKind, tone(C.front, 0.55), { flat: true, roughness: 0.9 });
      for (let k = 1; k <= n; k++) add(g, K.box(0.004, dh - 0.01, 0.002), gm, 'front', x0 + (k * dw) / (n + 1), cy, zFace + 0.0006);
    } else if (st === 'ribbed') {
      const depth = ribPitch * 0.28;
      add(g, ribPanelGeometry(dw, dh, { pitch: ribPitch, depth, t: fT - depth, seg: spec.quality === 'low' ? 3 : spec.quality === 'high' ? 8 : 5 }), front, 'front', cx, cy, zBack);
    } else if (st === 'slatted') {
      const backT = 0.006;
      add(g, K.box(dw, dh, backT), mat(frontKind, tone(C.front, 0.3)), 'front', cx, cy, zBack + backT / 2);
      const gapS = 0.008;
      const sd = fT - backT;
      if (P.slatDir === 'h') {
        // horizontal slats stacked up the front (Linley)
        const n = Math.max(1, Math.round((dh + gapS) / (0.028 + gapS)));
        const sh = (dh - gapS * (n - 1)) / n;
        for (let k = 0; k < n; k++) add(g, K.box(dw, sh, sd, { grain: 'x' }), front, 'front', cx, y0 + sh / 2 + k * (sh + gapS), zFace - sd / 2);
      } else {
        const n = Math.max(1, Math.round((dw + gapS) / (0.028 + gapS)));
        const sw = (dw - gapS * (n - 1)) / n;
        for (let k = 0; k < n; k++) add(g, K.box(sw, dh, sd, { grain: 'y' }), front, 'front', x0 + sw / 2 + k * (sw + gapS), cy, zFace - sd / 2);
      }
    } else if (st === 'fabric') {
      // a body-coloured frame round an inset textile panel (høyttalerduk); a non-textile front kind gets woven cloth
      const fw = Math.min(0.02, Math.min(dw, dh) * 0.2);
      for (const s of [-1, 1]) add(g, K.box(fw, dh, fT, { grain: 'y' }), body, 'body', s > 0 ? x1 - fw / 2 : x0 + fw / 2, cy, zFace - fT / 2);
      for (const s of [-1, 1]) add(g, K.box(dw - 2 * fw, fw, fT, { grain: 'x' }), body, 'body', cx, s > 0 ? y1 - fw / 2 : y0 + fw / 2, zFace - fT / 2);
      const cloth = kindGroup(frontKind) === 'fabric' ? front : mat('woven', C.front);
      const pt = fT - 0.006;
      add(g, K.box(dw - 2 * fw + 0.004, dh - 2 * fw + 0.004, pt), cloth, 'front', cx, cy, zBack + pt / 2);
    } else if (st === 'cane' || st === 'glass' || st === 'framed') {
      const fw = st === 'framed' ? clamp(Math.min(dw, dh) * 0.14, 0.045, 0.075) : clamp(Math.min(dw, dh) * 0.12, 0.035, 0.05);
      let frameMat = front;
      if (st === 'glass') frameMat = body;
      else if (st === 'cane' && frontKind === 'rattan') frameMat = mat('smoked-oak', C.front);
      const framePart = st === 'glass' ? 'body' : 'front';
      for (const s of [-1, 1]) add(g, K.box(fw, dh, fT, { grain: 'y' }), frameMat, framePart, s > 0 ? x1 - fw / 2 : x0 + fw / 2, cy, zFace - fT / 2);
      for (const s of [-1, 1]) add(g, K.box(dw - 2 * fw, fw, fT, { grain: 'x' }), frameMat, framePart, cx, s > 0 ? y1 - fw / 2 : y0 + fw / 2, zFace - fT / 2);
      const iw = dw - 2 * fw + 0.008, ih = dh - 2 * fw + 0.008;
      if (st === 'framed') {
        const pt = fT - 0.008;
        // the recessed panel a shade darker and the bead darker still, so the frame reads in light paint too (Sandnes)
        const panelM = C.front ? mat(frontKind, tone(C.front, 0.93)) : front;
        const beadM = C.front ? mat(frontKind, tone(C.front, 0.8)) : front;
        add(g, K.box(iw, ih, pt, { grain: 'y' }), panelM, 'front', cx, cy, zBack + pt / 2);
        // a thin bevelled bead round the panel
        const bead = 0.006;
        for (const s of [-1, 1]) add(g, K.box(bead, ih - 0.008, 0.004, { grain: 'y' }), beadM, 'front', cx + s * (iw / 2 - 0.004 - bead / 2), cy, zBack + pt + 0.002);
        for (const s of [-1, 1]) add(g, K.box(iw - 0.008, bead, 0.004, { grain: 'x' }), beadM, 'front', cx, cy + s * (ih / 2 - 0.004 - bead / 2), zBack + pt + 0.002);
      } else if (st === 'cane') {
        add(g, K.box(iw, ih, 0.003), mat('rattan', frontKind === 'rattan' ? C.front : tone(C.front, 1.15), { open: true }), 'front', cx, cy, zFace - fT * 0.55);
      } else {
        const gk = isTransparentKind(frontKind) ? frontKind : 'glass-opal';
        const gm = mat(gk, isTransparentKind(frontKind) ? C.front : '#d8dcd8');
        if (P.glassPattern === 'clear') add(g, K.box(iw, ih, 0.004), gm, 'front', cx, cy, zFace - fT * 0.5);
        else add(g, ribPanelGeometry(iw, ih, { pitch: 0.011, depth: 0.0022, t: 0.003, seg: spec.quality === 'low' ? 2 : 4 }), gm, 'front', cx, cy, zFace - fT * 0.5 - 0.0026);
      }
    } else if (P.gripRecess === 'top' && drawer) {
      // a recessed grip channel above the front: the front is lower, a dark channel shows behind its top edge
      // the channel is a shaded tone of the grip profile's (handle) colour: light grey on Next, body-toned on MALM types
      const gh = Math.min(0.022, dh * 0.25);
      const channel = C.handle ? mat(handleKind, tone(C.handle, 0.75)) : darkInside();
      add(g, K.roundedBox(dw, dh - gh, fT, 0.0012, 1, { grain }), fm, fp, cx, cy - gh / 2, zBack + fT / 2);
      // a coloured profile sits close behind the face (it reads as a light strip, Next); the dark fallback stays deep
      add(g, K.box(dw, gh, 0.004), channel, null, cx, y1 - gh / 2, C.handle ? zBack + 0.004 : zBack - 0.012);
      add(g, K.box(dw, 0.003, fT * 0.7), fm, fp, cx, y1 - gh + 0.0015, zBack + fT * 0.35);
    } else if (handle === 'cutout' && !drawer && dh > 0.7) {
      // a vertical finger slot near the opening edge of a tall door (PAX/TONSTAD style)
      add(g, K.roundedBox(dw, dh, fT, 0.0012, 1, { grain }), front, 'front', cx, cy, zBack + fT / 2);
      const sl = clamp(num(P.handleLen, 0.12), 0.06, 0.3);
      const sy = handleYAbs != null ? clamp(handleYAbs, y0 + sl / 2 + 0.03, y1 - sl / 2 - 0.03) : cy;
      const sx = side > 0 ? x1 - 0.045 : x0 + 0.045;
      add(g, K.roundedBox(0.026, sl, 0.004, 0.012, 3), handleMat, 'handle', sx, sy, zFace + 0.0004);
    } else if (handle === 'cutout') {
      // routed finger grip in the top edge (a U notch), the darker handle colour shows behind it
      const nw = clamp(dw * 0.36, 0.06, 0.12), nd = Math.min(0.028, dh * 0.3);
      const nx = drawer ? 0 : side > 0 ? dw / 2 - nw / 2 - 0.03 : -dw / 2 + nw / 2 + 0.03;
      const pts = [[-dw / 2, -dh / 2], [dw / 2, -dh / 2], [dw / 2, dh / 2]];
      const ns = 12;
      for (let k = 0; k <= ns; k++) {
        const a = -(k / ns) * Math.PI;
        pts.push([nx + (nw / 2) * Math.cos(a), dh / 2 + nd * Math.sin(a)]);
      }
      pts.push([-dw / 2, dh / 2]);
      const geo = K.extrudeShape(pts, fT, { bevel: 0.001, bevelSegments: 1 });
      K.worldUV(geo, 1, { grain });
      add(g, geo, fm, fp, cx, cy, zBack);
      add(g, K.box(nw + 0.02, nd + 0.012, 0.004), handleMat, 'handle', cx + nx, y1 - nd / 2 - 0.002, zBack - 0.0025);
    } else if (herring) {
      add(g, K.box(dw, dh, fT - 0.0008), mat(frontKind, tone(C.front, 0.5)), 'front', cx, cy, zBack + (fT - 0.0008) / 2);
      add(g, herringboneFace(dw, dh), front, 'front', cx, cy, zFace - 0.0002);
    } else {
      add(g, K.roundedBox(dw, dh, fT, 0.0012, 1, { grain }), fm, fp, cx, cy, zBack + fT / 2);
    }
    if (!(P.gripRecess === 'top' && drawer)) addHandle(x0, x1, y0, y1, side, drawer, zFace, flip);
  };

  // columns
  cells.forEach((cell, i) => {
    const cx0 = xo0 + i * colW, cx1 = cx0 + colW;
    const fx0 = cx0 + (i === 0 ? eg : gap / 2), fx1 = cx1 - (i === nCols - 1 ? eg : gap / 2);
    const fy0 = yCols0 + (drawerRow && rowBottom ? gap / 2 : eg), fy1 = yCols1 - (drawerRow && !rowBottom ? gap / 2 : eg);
    if (cell.kind === 'open') {
      interior(cx0, cx1, yCols0, yCols1, true, i);
      return;
    }
    const glass = cell.kind === 'glass' || style === 'glass';
    interior(cx0, cx1, yCols0, yCols1, glass, i);
    if (cell.kind === 'drawers') {
      const n = cell.n;
      // graduated: each drawer 18 % taller than the one above it (classic chests); else equal heights
      const wts = Array.from({ length: n }, (_, k) => (graduated && !cell.flip ? 1.18 ** (n - 1 - k) : 1));
      const sum = wts.reduce((a, b) => a + b, 0);
      const avail = fy1 - fy0 - gap * (n - 1);
      let y0 = fy0;
      for (let k = 0; k < n; k++) {
        const hh = (avail * wts[k]) / sum;
        addFront(fx0, fx1, y0, y0 + hh, { drawer: true, flip: !!cell.flip });
        y0 += hh + gap;
      }
    } else {
      // knobs on sliding doors sit at each door's outer edge (HAVSTA); bar pulls and grips of sliding doors stay where
      // hinged pairs have them, meeting in the middle (Nola's tambour doors, TONSTAD)
      const side = P.slidingDoors && handle === 'knob' ? -handleSide(doorIdx, doorCount) : handleSide(doorIdx, doorCount);
      const track = P.slidingDoors && doorIdx % 2 === 1 ? 1 : 0;
      doorIdx++;
      // a door in the back track runs behind its neighbours (no open gap between sliding doors)
      const ov = track ? 0.012 : 0;
      let dy0 = fy0;
      if (cell.drawersBelow) {
        const zone = clamp(num(P.cellDrawerH, cell.drawersBelow * 0.2), 0.1, (fy1 - fy0) * 0.6);
        const hh = (zone - gap * (cell.drawersBelow - 1)) / cell.drawersBelow;
        for (let k = 0; k < cell.drawersBelow; k++) addFront(fx0, fx1, fy0 + k * (hh + gap), fy0 + k * (hh + gap) + hh, { drawer: true });
        dy0 = fy0 + zone + gap;
      }
      addFront(fx0 - (i > 0 ? ov : 0), fx1 + (i < nCols - 1 ? ov : 0), dy0, fy1, { side, glass: cell.kind === 'glass', track, mirror: !!cell.mirror });
    }
  });
  // drawer row on top
  if (drawerRow) {
    const ry0 = rowBottom ? yo0 : yCols1, ry1 = rowBottom ? yCols0 : yo1;
    interior(xo0, xo1, ry0, ry1, false, 0);
    // open or glass columns next to the band: a body-coloured shelf is their floor (bottom row) or ceiling (top row)
    // instead of the dark drawer box behind the fronts (IDANÄS, BESTÅ, Madrid)
    if (fit === 'inset' && (style === 'glass' || cells.some((c) => c.kind === 'open' || c.kind === 'glass'))) {
      const zb = -d / 2 + 0.012, ze = zf - fT - 0.0015;
      add(g, K.box(openW, gT, ze - zb, { grain: 'x' }), body, 'body', 0, rowBottom ? yCols0 - gT / 2 : yCols1 + gT / 2, (zb + ze) / 2);
    }
    const dw = (openW - 2 * eg - gap * (drawerRow - 1)) / drawerRow;
    for (let k = 0; k < drawerRow; k++) {
      const x0 = xo0 + eg + k * (dw + gap);
      const asDoor = P.drawerRowDoors === true;
      addFront(x0, x0 + dw, rowBottom ? ry0 + eg : ry0 + gap / 2, rowBottom ? ry1 - gap / 2 : ry1 - eg, asDoor ? { side: handleSide(k, drawerRow) } : { drawer: true });
    }
  }
  // sliding doors in an aluminium frame run in a top and a bottom track
  if (P.slidingDoors && P.doorFrame === 'alu') {
    for (const ty of [yo0 + 0.004, yo1 - 0.004]) add(g, K.box(openW, 0.008, 0.05, { grain: 'x' }), handleMat, 'handle', 0, ty, zf - 0.03);
  }
  // gallery: a low rim along the back and both sides of the top (Asker)
  if (P.gallery === true) {
    const gh = clamp(num(P.galleryH, 0.04), 0.015, 0.1), gt = 0.014;
    add(g, K.roundedBox(w, gh, gt, 0.004, 1, { grain: 'x' }), topMat, 'top', 0, yt + gh / 2, -d / 2 + gt / 2);
    for (const sx of [-1, 1]) add(g, K.roundedBox(gt, gh, d - 0.02, 0.004, 1, { grain: 'z' }), topMat, 'top', sx * (w / 2 - gt / 2), yt + gh / 2, -0.01);
  }
  // cornice: an overhanging crown on top (classic wardrobes)
  if (P.cornice === true && !wall) {
    const ch = 0.045, ov = 0.022;
    add(g, K.roundedBox(w + 2 * ov, ch * 0.45, d + ov, 0.004, 1, { grain: 'x' }), topMat, 'top', 0, yt + ch * 0.775, ov / 2);
    add(g, K.roundedBox(w + ov, ch * 0.55, d + ov * 0.5, 0.006, 2, { grain: 'x' }), topMat, 'top', 0, yt + ch * 0.275, ov / 4);
  }

  // -- base ----------------------------------------------------------------------------------------------------
  const legStyle = P.legStyle || 'metal-thin';
  if (toFloor && legH > 0.005) {
    // half-round gables reach the floor; a recessed toe-kick in between
    add(g, K.box(xo1 - xo0 - 0.01, legH, d - 0.06, { grain: 'x' }), legsMat, 'legs', 0, lift + legH / 2, -0.025);
  } else if (base === 'plinth' && legH > 0.005) {
    const pw = w - 2 * Math.max(0.03, r * 0.7), pd = d - 0.06;
    add(g, K.box(pw, legH, pd, { grain: 'x' }), legsMat, 'legs', 0, legH / 2, -0.02);
  } else if (base === 'legs' && legH > 0.005) {
    const curved = r > 0.08;
    const ix = (legStyle === 'block' && legH < 0.1 ? 0.075 : 0.05) + (curved ? r * 0.6 : r * 0.5);
    const iz = (legStyle === 'block' && legH < 0.1 ? 0.07 : 0.045) + (curved ? 0.03 : 0);
    const spots = [];
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) spots.push([sx, sz]);
    if ((w > 1.9 || P.midLegs === true) && legStyle !== 'metal-frame') spots.push([0, -1], [0, 1]);
    if (legStyle === 'metal-frame' && legH > 0.1) {
      // a steel stand: square-tube legs, a frame under the carcass and low stretchers at the sides and back
      const tw = 0.016, ax = 0.03;
      const fw = w - 2 * ax, fd = d - 2 * ax;
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) add(g, K.box(tw, yb, tw, { grain: 'y' }), legsMat, 'legs', sx * (fw / 2 - tw / 2), yb / 2, sz * (fd / 2 - tw / 2));
      for (const sz of [-1, 1]) add(g, K.box(fw, tw, tw, { grain: 'x' }), legsMat, 'legs', 0, yb - tw / 2, sz * (fd / 2 - tw / 2));
      for (const sx of [-1, 1]) add(g, K.box(tw, tw, fd, { grain: 'z' }), legsMat, 'legs', sx * (fw / 2 - tw / 2), yb - tw / 2, 0);
      const sy = Math.min(0.08, yb * 0.3);
      for (const sx of [-1, 1]) add(g, K.box(tw * 0.8, tw * 0.8, fd, { grain: 'z' }), legsMat, 'legs', sx * (fw / 2 - tw / 2), sy, 0);
      add(g, K.box(fw, tw * 0.8, tw * 0.8, { grain: 'x' }), legsMat, 'legs', 0, sy, -fd / 2 + tw / 2);
    } else if (legStyle === 'metal-frame') {
      const fw = w - 0.04 - (curved ? r : 0), fd = d - 0.05;
      const ft = 0.006;
      for (const sz of [-1, 1]) add(g, K.box(fw, legH, ft, { grain: 'x' }), legsMat, 'legs', 0, legH / 2, sz * (fd / 2 - ft / 2));
      for (const sx of [-1, 1]) add(g, K.box(ft, legH, fd - 2 * ft, { grain: 'z' }), legsMat, 'legs', sx * (fw / 2 - ft / 2), legH / 2, 0);
    } else if (legStyle === 'wood-taper') {
      if (P.legFrame) {
        const ax = 0.035, railH = Math.min(0.045, legH * 0.3), railT = 0.024;
        const fw = w - 2 * ax, fd = d - 2 * ax;
        for (const sz of [-1, 1]) add(g, K.box(fw, railH, railT, { grain: 'x' }), legsMat, 'legs', 0, yb - railH / 2, sz * (fd / 2 - railT / 2));
        for (const sx of [-1, 1]) add(g, K.box(railT, railH, fd - 2 * railT, { grain: 'z' }), legsMat, 'legs', sx * (fw / 2 - railT / 2), yb - railH / 2, 0);
        for (const [sx, sz] of spots) {
          const x = sx * (fw / 2 - 0.022), z = sz * (fd / 2 - 0.022);
          add(g, K.taperLeg(yb - railH + 0.002, 0.02, 0.015, { seg: qSeg(spec, 14) }), legsRound, 'legs', x, 0, z);
        }
      } else {
        const tilt = 6 * K.DEG;
        for (const [sx, sz] of spots) {
          const x = sx * (w / 2 - ix - 0.02), z = sz * (d / 2 - iz - 0.02);
          add(g, splayedLeg(x, yb + 0.002, z, 0.019, 0.012, sx * tilt, sz * tilt * 0.7, qSeg(spec, 14)), legsRound, 'legs');
        }
      }
    } else if (legStyle === 'block' && P.squareFeet === true) {
      // hidden squareFeet: square posts flush under the corners, the carcass's corner posts carried to the floor
      // (Shimoda, the Madrid desk's drawer unit)
      const s = clamp(Math.min(w, d) * 0.09, 0.03, 0.05);
      for (const [sx, sz] of spots) {
        add(g, K.box(s, yb + 0.001, s, { grain: 'y' }), legsMat, 'legs', sx * (w / 2 - s / 2 - 0.002), yb / 2, sz * (d / 2 - s / 2 - 0.002));
      }
    } else if (legStyle === 'block') {
      for (const [sx, sz] of spots) {
        const x = sx * (w / 2 - ix), z = sz * (d / 2 - iz);
        if (legH < 0.1) add(g, K.cylinder(0.022, 0.02, yb + 0.001, { seg: qSeg(spec, 16) }), legsRound, 'legs', x, 0, z);
        else add(g, K.roundedBox(0.05, yb + 0.001, 0.05, 0.004, 1, { grain: 'y', bottom: true }), legsMat, 'legs', x, 0, z);
      }
    } else {
      // thin metal legs with a small mounting plate (legFrame: square legs in a frame with low stretchers)
      for (const [sx, sz] of spots) {
        const x = sx * (w / 2 - ix), z = sz * (d / 2 - iz);
        if (P.legFrame) add(g, K.box(0.014, yb, 0.014, { grain: 'y' }), legsMat, 'legs', x, yb / 2, z);
        else {
          add(g, K.cylinder(0.0075, 0.0068, yb, { seg: qSeg(spec, 12) }), legsMat, 'legs', x, 0, z);
          add(g, K.box(0.04, 0.004, 0.04), legsMat, 'legs', x, yb - 0.002, z);
        }
      }
      if (P.legFrame) {
        const fx = w / 2 - ix, fz = d / 2 - iz;
        const sy = Math.min(0.1, yb * 0.3);
        for (const y of [yb - 0.007, sy]) {
          for (const sz of [-1, 1]) if (y > sy || sz < 0) add(g, K.box(2 * fx, 0.012, 0.012, { grain: 'x' }), legsMat, 'legs', 0, y, sz * fz);
          for (const sx of [-1, 1]) add(g, K.box(0.012, 0.012, 2 * fz, { grain: 'z' }), legsMat, 'legs', sx * fx, y, 0);
        }
      }
    }
    // a fixed open shelf low between the legs (TONSTAD)
    const ls = num(P.lowerShelf, 0);
    if (ls > 0.02 && ls < yb - 0.06) {
      const fx = legStyle === 'wood-taper' && P.legFrame ? w / 2 - 0.035 - 0.022 : w / 2 - ix;
      const fz = legStyle === 'wood-taper' && P.legFrame ? d / 2 - 0.035 - 0.022 : d / 2 - iz;
      add(g, K.roundedBox(2 * fx + 0.03, 0.018, 2 * fz + 0.03, 0.003, 1, { grain: 'x' }), body, 'body', 0, ls, 0);
    }
  }

  // -- finish --------------------------------------------------------------------------------------------------
  const curvedTop = r > 0.08;
  const surfaces = [{ y: yt + (P.cornice === true && !wall ? 0.045 : 0), w: +(w - (curvedTop ? r : 0.02) - (P.gallery === true ? 0.03 : 0)).toFixed(3), d: +(d - 0.03).toFixed(3), center: [0, 0] }];
  if (num(P.lowerShelf, 0) > 0.02 && base === 'legs') surfaces.push({ y: +(num(P.lowerShelf, 0) + 0.009).toFixed(4), w: +(w - 0.12).toFixed(3), d: +(d - 0.1).toFixed(3), center: [0, 0] });
  const colliders = wall ? [{ min: [-w / 2, lift, -d / 2], max: [w / 2, yt, d / 2] }] : undefined;
  const builtStyle = style;
  const rc = recolorer(g, (part, kind) => {
    if (part === 'front') return complexFront || (kind && kind !== frontKind) || builtStyle === 'cane' || builtStyle === 'grooved';
    // the grip channel is a tone of the handle colour
    if (part === 'handle') return P.gripRecess === 'top' || (kind && kindGroup(kind) !== kindGroup(handleKind));
    if (part === 'legs') return kind && kindGroup(kind) !== kindGroup(legKind);
    if (part === 'top') return kind && STONE.has(kind) !== STONE.has(M.top);
    if (part === 'body') return builtStyle === 'glass';
    return false;
  });
  g.name = arch;
  return K.finishModel(g, { surfaces, colliders, recolor: rc });
}

// ---------------------------------------------------------------------------------------------------------------
// Wall shelf

/** The lattice shelf over the TV-stue sofa (room-spec f-vegghylle), local x from the middle, y from the bottom. */
const GRID_DEFAULT = {
  uprights: [[-0.52, 0.03, 0.23], [-0.22, 0, 0.45], [0.18, 0, 0.45], [0.5, 0.25, 0.5]],
  bars: [[-0.35, 0.55, 0.43], [-0.56, 0.32, 0.18], [-0.22, -0.08, 0.02]],
  boards: [[-0.26, 0.21, 0.44], [0.14, 0.59, 0.28], [-0.26, 0.21, 0.15], [-0.6, -0.22, 0]],
};

const isTriples = (a) => Array.isArray(a) && a.length > 0 && a.every((t) => Array.isArray(t) && t.length >= 3 && t.every((v) => typeof v === 'number'));

function buildWallShelf(spec) {
  const { w, d, h } = spec.dims;
  const P = spec.params;
  const g = new THREE.Group();
  const body = pm(spec, 'body', 'black-metal');
  const top = pm(spec, 'top', 'black-metal');
  const surfaces = [];
  const y0 = -h / 2;
  if (P.style === 'box') {
    // wall unit of boxes (Bohus Tamara): an outer frame of 18 mm boards and a grid of dividers, open in front
    const T = Math.min(0.018, w / 8, h / 8);
    const cols = clamp(Math.round(num(P.cols, 3)), 1, 6);
    const rows = clamp(Math.round(num(P.rows, 2)), 1, 5);
    const zc = d / 2;
    add(g, K.box(w, T, d, { grain: 'x' }), top, 'top', 0, h / 2 - T / 2, zc);
    add(g, K.box(w, T, d, { grain: 'x' }), body, 'body', 0, y0 + T / 2, zc);
    for (const sx of [-1, 1]) add(g, K.box(T, h - 2 * T, d, { grain: 'y' }), body, 'body', sx * (w / 2 - T / 2), 0, zc);
    const iw = w - 2 * T, ih = h - 2 * T;
    const cw = (iw - (cols - 1) * T) / cols, ch = (ih - (rows - 1) * T) / rows;
    for (let c = 1; c < cols; c++) add(g, K.box(T, ih, d - 0.002, { grain: 'y' }), body, 'body', -iw / 2 + c * (cw + T) - T / 2, 0, zc - 0.001);
    for (let r = 1; r < rows; r++) add(g, K.box(iw, T, d - 0.004, { grain: 'x' }), body, 'body', 0, y0 + T + r * (ch + T) - T / 2, zc - 0.002);
    if (P.backPanel === true) add(g, K.box(iw, ih, 0.006, { grain: 'x' }), body, 'body', 0, 0, 0.003);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const y = y0 + T + r * (ch + T);
        surfaces.push({ y: +y.toFixed(4), w: +(cw - 0.01).toFixed(3), d: +(d - 0.02).toFixed(3), center: [+(-iw / 2 + c * (cw + T) + cw / 2).toFixed(3), +(zc + 0.005).toFixed(3)] });
      }
    }
    surfaces.push({ y: +(h / 2).toFixed(4), w: +(w - 0.02).toFixed(3), d: +(d - 0.02).toFixed(3), center: [0, +zc.toFixed(3)] });
    const rc = recolorer(g);
    return K.finishModel(g, { surfaces, recolor: rc });
  }
  if (P.style === 'simple') {
    const n = clamp(Math.round(num(P.shelves, 3)), 1, 8);
    const bt = clamp(num(P.topT, 0.025), 0.01, 0.06);
    const mounts = ['straps', 'battens', 'brackets'].includes(P.brackets) ? P.brackets : 'none';
    const bd = clamp(num(P.boardDepth, d), 0.05, d);
    // straps hang from above, so a single strap shelf sits at the bottom of its box; a single board on brackets sits
    // at the top, its brackets filling dims.h below it (hat shelves, BERGSHULT)
    const oneOnBrackets = n === 1 && mounts === 'brackets';
    const ys = Array.from({ length: n }, (_, i) => (n === 1 ? (mounts === 'straps' ? y0 : oneOnBrackets ? h / 2 - bt : -bt / 2) : y0 + (i * (h - bt)) / (n - 1)));
    // hidden rails: the board is n round steel tubes instead (Stord hat shelf)
    const rails = clamp(Math.round(num(P.rails, 0)), 0, 8);
    for (const y of ys) {
      if (rails >= 2) {
        const rr = 0.008;
        for (let k = 0; k < rails; k++) {
          const z = rr + 0.012 + (k * (bd - 2 * rr - 0.024)) / (rails - 1);
          add(g, K.cylinder(rr, rr, w, { seg: qSeg(spec, 10), center: true }), top, 'top', 0, y + bt - rr, z, [0, 0, Math.PI / 2]);
        }
      } else add(g, K.roundedBox(w, bt, bd, 0.002, 1, { grain: 'x' }), top, 'top', 0, y + bt / 2, bd / 2);
      surfaces.push({ y: +(y + bt).toFixed(4), w, d: bd, center: [0, bd / 2] });
    }
    const ix = w / 2 - Math.min(0.08, w * 0.12);
    if (mounts === 'straps') {
      // a leather strap from the wall above round the front edge of the board (body part)
      for (const sx of [-1, 1]) {
        const len = Math.hypot(h, bd);
        const m = add(g, K.box(0.035, len, 0.005), body, 'body', sx * ix, y0 + h / 2, bd / 2);
        m.rotation.x = -Math.atan2(bd, h); // top at the wall, bottom round the front edge of the board
        add(g, K.cylinder(0.008, 0.008, 0.006, { seg: 10, center: true }), mat('brass', '#b08d57'), null, sx * ix, h / 2 - 0.015, 0.006, [Math.PI / 2, 0, 0]);
      }
    } else if (mounts === 'battens') {
      // wooden battens, or thin rods for a metal frame (rising a little above the top board); hidden battenCount
      // spreads 2–5 of them evenly (Tamara 137 hangs on three)
      const rod = kindGroup(spec.materials?.body || 'oak') === 'metal';
      const nB = clamp(Math.round(num(P.battenCount, 2)), 2, 5);
      for (let k = 0; k < nB; k++) add(g, K.roundedBox(rod ? 0.012 : 0.035, h, rod ? 0.012 : 0.02, rod ? 0.005 : 0.003, 1, { grain: 'y' }), body, 'body', -ix + (2 * ix * k) / (nB - 1), 0, rod ? 0.02 : 0.01);
    } else if (mounts === 'brackets') {
      const bh = oneOnBrackets ? clamp(h - bt, 0.08, h) : 0.08;
      const woodB = kindGroup(spec.materials?.body || 'black-metal') === 'wood';
      // a part of the bracket between two (z, y) points in the bracket's plane: a box of width t (x) and depth s
      const brace = (x, [za, ya], [zb, yb2], t, s) => {
        const L = Math.hypot(zb - za, yb2 - ya);
        add(g, K.box(t, L, s, { grain: 'y' }), body, 'body', x, (ya + yb2) / 2, (za + zb) / 2, [Math.atan2(zb - za, yb2 - ya), 0, 0]);
      };
      for (const y of ys) for (const sx of [-1, 1]) {
        const x = sx * ix;
        if (woodB) {
          // solid knee bracket (SANDSHULT): an upright against the wall, an arm under the board, a diagonal strut
          const t = 0.022, al = bd * 0.85;
          add(g, K.box(t, bh, 0.03, { grain: 'y' }), body, 'body', x, y - bh / 2, 0.015);
          add(g, K.box(t, 0.03, al, { grain: 'z' }), body, 'body', x, y - 0.015, al / 2);
          brace(x, [0.02, y - bh * 0.78], [al * 0.78, y - 0.02], t, 0.026);
        } else {
          // bent flat-bar bracket (Stord): a bar on the wall, an arm under the shelf and a diagonal from the wall
          // bar's foot to the arm's front end, which turns up into a short lip
          const t = 0.006, s = 0.022, al = bd * 0.94;
          add(g, K.box(t, bh, s, { grain: 'y' }), body, 'body', x, y - bh / 2, s / 2);
          add(g, K.box(t, s, al, { grain: 'z' }), body, 'body', x, y - s / 2, al / 2);
          brace(x, [s * 0.6, y - bh + s * 0.6], [al - s * 0.4, y - s * 0.6], t, s * 0.9);
          if (rails >= 2) add(g, K.box(t, 0.035, s * 0.8, { grain: 'y' }), body, 'body', x, y + 0.006, al - s * 0.4);
        }
      }
      // hidden hooks: a strip between the brackets low on the wall with n pegs (Stord's coat hooks under the shelf)
      const nH = clamp(Math.round(num(P.hooks, 0)), 0, 10);
      if (nH > 0 && oneOnBrackets) {
        const hy = ys[0] - bh + 0.02;
        add(g, K.box(2 * ix, 0.02, 0.006, { grain: 'x' }), body, 'body', 0, hy, 0.014);
        for (let k = 0; k < nH; k++) {
          const hx = -ix + (2 * ix * (k + 0.5)) / nH;
          const tilt = 18 * K.DEG;
          add(g, K.cylinder(0.005, 0.005, 0.06, { seg: qSeg(spec, 8), center: true }), body, 'body', hx, hy + 0.03 * Math.sin(tilt), 0.017 + 0.03 * Math.cos(tilt), [Math.PI / 2 - tilt, 0, 0]);
          add(g, K.sphere(0.009, { wSeg: qSeg(spec, 10), hSeg: 6 }), body, 'body', hx, hy + 0.06 * Math.sin(tilt), 0.017 + 0.06 * Math.cos(tilt));
        }
      }
    }
    const rc = recolorer(g);
    return K.finishModel(g, { surfaces, recolor: rc });
  }
  // lattice of black flat bars against the wall + tray shelves with a back upstand (082726, 082809)
  const uprights = isTriples(P.uprights) ? P.uprights : GRID_DEFAULT.uprights;
  const bars = isTriples(P.bars) ? P.bars : GRID_DEFAULT.bars;
  const boards = isTriples(P.boards) ? P.boards : GRID_DEFAULT.boards;
  const bw = clamp(num(P.barW, 0.015), 0.006, 0.04);
  let maxX = 0.01, maxY = 0.01;
  for (const [x, a, b] of uprights) {
    maxX = Math.max(maxX, Math.abs(x) + bw / 2);
    maxY = Math.max(maxY, a, b);
  }
  for (const [a, b, y] of bars) {
    maxX = Math.max(maxX, Math.abs(a), Math.abs(b));
    maxY = Math.max(maxY, y + bw);
  }
  for (const [a, b, y] of boards) {
    maxX = Math.max(maxX, Math.abs(a), Math.abs(b));
    maxY = Math.max(maxY, y);
  }
  const sx = w / (2 * maxX), sy = h / maxY;
  const lz = 0.012;
  const bd = clamp(num(P.boardDepth, d - lz), 0.05, d - lz);
  for (const [x, a, b] of uprights) {
    const ya = y0 + Math.min(a, b) * sy, yb = y0 + Math.max(a, b) * sy;
    add(g, K.box(bw, yb - ya, lz, { grain: 'y' }), body, 'body', x * sx, (ya + yb) / 2, lz / 2);
  }
  for (const [a, b, y] of bars) {
    const xa = Math.min(a, b) * sx, xb = Math.max(a, b) * sx;
    const yy = y0 + y * sy;
    add(g, K.box(xb - xa, bw, lz - 0.002, { grain: 'x' }), body, 'body', (xa + xb) / 2, Math.min(h / 2 - bw / 2, yy + bw / 2), (lz - 0.002) / 2);
  }
  const plate = 0.003, lip = 0.012, up = 0.045;
  for (const [a, b, y] of boards) {
    const xa = Math.min(a, b) * sx, xb = Math.max(a, b) * sx;
    const bwid = xb - xa, cx = (xa + xb) / 2;
    const yy = Math.min(h / 2 - lip - up, y0 + y * sy);
    add(g, K.box(bwid, plate, bd, { grain: 'x' }), top, 'top', cx, yy + lip - plate / 2, lz + bd / 2);
    add(g, K.box(bwid, lip, plate, { grain: 'x' }), top, 'top', cx, yy + lip / 2, lz + bd - plate / 2);
    add(g, K.box(bwid, up, plate, { grain: 'x' }), top, 'top', cx, yy + lip + up / 2, lz + plate / 2);
    surfaces.push({ y: +(yy + lip).toFixed(4), w: +bwid.toFixed(3), d: +(bd - plate).toFixed(3), center: [+cx.toFixed(3), +(lz + bd / 2).toFixed(3)] });
  }
  const rc = recolorer(g);
  return K.finishModel(g, { surfaces, recolor: rc });
}

// ---------------------------------------------------------------------------------------------------------------
// Display cabinet (vitrineskap)

/** Neutral styling inside a vitrine: off-white → graphite ceramics, muted book spines, clear glass. */
const VITRINE_CERAMIC = ['#ebe6dd', '#b6ad9f', '#5c5752'];
const VITRINE_BOOKS = ['#d6cdbd', '#7d7262', '#4c5551', '#2b2928', '#a39787'];
// ceramics and books are baked into one vertex-coloured mesh per kind (see buildDisplayCabinet's decor batch)
const decorCeramic = (hex) => ({ decor: 'ceramic', hex });
const decorBook = (hex) => ({ decor: 'book', hex });
const decorGlass = () => mat('glass-clear', CLEAR_GLASS);
const CLEAR_GLASS = '#f2f6f4';
const TILT_PLATE = 12 * K.DEG;

/**
 * Small decor pieces for vitrine levels. Each builder gets a slot { x0, x1, y, clear, z0, z1 } (y = top of the shelf,
 * clear = free height above it, z0..z1 = usable depth) and `put(geo, material, x, y, z, rot)`. Low-poly lathes and
 * boxes, sized to the slot, deterministic through `rnd` (kit rng).
 */
const DECOR_KINDS = [
  {
    id: 'books', minH: 0.17, minW: 0.1, minD: 0.12, weight: 1.4,
    build(put, s, rnd) {
      const hMax = Math.min(0.26, s.clear - 0.015);
      const bd = Math.min(rnd.range(0.13, 0.17), s.z1 - s.z0 - 0.01);
      const z = s.z0 + 0.004 + bd / 2;
      const room = s.x1 - s.x0 - 0.02;
      const books = [];
      let rowW = 0;
      for (let k = 0, n = rnd.int(3, 6); k < n; k++) {
        const t = rnd.range(0.018, 0.034);
        if (rowW + t + 0.001 > room * 0.75) break;
        books.push({ t, h: hMax * rnd.range(0.74, 1), hex: rnd.pick(VITRINE_BOOKS) });
        rowW += t + 0.001;
      }
      if (!books.length) return;
      // the last book leans on the row when there is room for it
      const lean = books.length >= 3 && rnd() < 0.6 ? books.pop() : null;
      let x = s.x0 + 0.01 + (room - rowW) * rnd.range(0.15, 0.6);
      for (const b of books) {
        put(K.box(b.t, b.h, bd), decorBook(b.hex), x + b.t / 2, s.y + b.h / 2, z);
        x += b.t + 0.001;
      }
      if (lean) {
        const th = 14 * K.DEG;
        const hh = Math.min(lean.h, books[books.length - 1].h * 0.98 / Math.cos(th));
        // it stands on its bottom-left edge and its top-left edge rests on the last upright book
        const px = x + hh * Math.sin(th);
        if (px + lean.t * Math.cos(th) < s.x1 - 0.005) {
          put(K.box(lean.t, hh, bd), decorBook(lean.hex), px + (lean.t / 2) * Math.cos(th) - (hh / 2) * Math.sin(th), s.y + (lean.t / 2) * Math.sin(th) + (hh / 2) * Math.cos(th), z, [0, 0, th]);
        }
      }
    },
  },
  {
    id: 'stack', minH: 0.07, minW: 0.18, minD: 0.13,
    build(put, s, rnd, seg) {
      const bw = Math.min(rnd.range(0.15, 0.2), s.x1 - s.x0 - 0.02);
      const bdp = Math.min(rnd.range(0.12, 0.15), s.z1 - s.z0 - 0.01);
      const cx = (s.x0 + s.x1) / 2 + rnd.range(-0.2, 0.2) * (s.x1 - s.x0 - bw) * 0.5;
      const cz = s.z0 + (s.z1 - s.z0) * 0.48;
      let y = s.y;
      for (let k = 0, n = rnd.int(2, 3); k < n && y - s.y < s.clear * 0.5; k++) {
        const t = rnd.range(0.02, 0.034);
        const f = 1 - k * 0.07;
        put(K.box(bw * f, t, bdp * f), decorBook(rnd.pick(VITRINE_BOOKS)), cx, y + t / 2, cz, [0, rnd.range(-0.09, 0.09), 0]);
        y += t;
      }
      const left = s.clear - (y - s.y);
      if (left > 0.06 && rnd() < 0.7) {
        const r = Math.min(0.05, bw * 0.3), hb = Math.min(left - 0.012, r * 0.62);
        put(bowlGeometry(r, hb, seg), decorCeramic(rnd.pick(VITRINE_CERAMIC)), cx, y, cz);
      }
    },
  },
  {
    id: 'vase', minH: 0.15, minW: 0.1, minD: 0.1,
    build(put, s, rnd, seg) {
      const r = Math.min(rnd.range(0.04, 0.06), (s.x1 - s.x0) / 2 - 0.01, (s.z1 - s.z0) / 2 - 0.01);
      const hv = Math.min(s.clear - 0.02, rnd.range(0.15, 0.24));
      const x = (s.x0 + s.x1) / 2 + rnd.range(-0.3, 0.3) * ((s.x1 - s.x0) / 2 - r);
      put(vaseGeometry(r, hv, rnd() < 0.5 ? 'bottle' : 'urn', seg), decorCeramic(rnd.pick(VITRINE_CERAMIC)), x, s.y, s.z0 + (s.z1 - s.z0) * 0.45);
    },
  },
  {
    id: 'bowl', minH: 0.06, minW: 0.15, minD: 0.15,
    build(put, s, rnd, seg) {
      const r = Math.min(rnd.range(0.07, 0.1), (s.x1 - s.x0) / 2 - 0.01, (s.z1 - s.z0) / 2 - 0.01);
      const hb = Math.min(s.clear - 0.012, r * rnd.range(0.5, 0.72));
      put(bowlGeometry(r, hb, seg), decorCeramic(rnd.pick(VITRINE_CERAMIC)), (s.x0 + s.x1) / 2, s.y, s.z0 + (s.z1 - s.z0) * 0.5);
    },
  },
  {
    id: 'glasses', minH: 0.14, minW: 0.14, minD: 0.08,
    build(put, s, rnd, seg) {
      const rg = rnd.range(0.03, 0.037);
      const hg = Math.min(s.clear - 0.015, rnd.range(0.15, 0.19));
      const n = Math.max(1, Math.min(rnd.int(2, 3), Math.floor((s.x1 - s.x0 - 0.02) / (rg * 2.5))));
      const geo = wineGlassGeometry(rg, hg, seg);
      const x0 = (s.x0 + s.x1) / 2 - ((n - 1) * rg * 2.5) / 2;
      for (let k = 0; k < n; k++) {
        put(k === 0 ? geo : geo.clone(), decorGlass(), x0 + k * rg * 2.5, s.y, s.z0 + (s.z1 - s.z0) * (k % 2 ? 0.35 : 0.55));
      }
    },
  },
  {
    id: 'plate', minH: 0.2, minW: 0.2, minD: 0.06, weight: 0.45,
    build(put, s, rnd, seg) {
      const r = Math.min(rnd.range(0.08, 0.1), (s.clear - 0.02) / 2 / Math.cos(TILT_PLATE), (s.x1 - s.x0) / 2 - 0.01);
      const t = 0.012;
      const cz = s.z0 + 0.006 + r * Math.sin(TILT_PLATE) + t;
      const cy = s.y + r * Math.cos(TILT_PLATE) + 0.002;
      // the plate leans on the back panel, its face toward the front (rotation +x tips the disc's axis forward)
      put(K.cylinder(r, r * 0.94, t, { seg: Math.max(12, seg + 6), center: true }), decorCeramic(rnd.pick(VITRINE_CERAMIC.slice(0, 2))), (s.x0 + s.x1) / 2, cy, cz, [Math.PI / 2 - TILT_PLATE, 0, 0]);
    },
  },
  {
    id: 'jar', minH: 0.1, minW: 0.09, minD: 0.09,
    build(put, s, rnd, seg) {
      const r = Math.min(rnd.range(0.035, 0.05), (s.x1 - s.x0) / 2 - 0.01);
      const hj = Math.min(s.clear - 0.035, rnd.range(0.08, 0.13));
      const x = (s.x0 + s.x1) / 2 + rnd.range(-0.25, 0.25) * ((s.x1 - s.x0) / 2 - r);
      const z = s.z0 + (s.z1 - s.z0) * 0.5;
      const m = decorCeramic(rnd.pick(VITRINE_CERAMIC));
      put(K.cylinder(r, r, hj, { seg }), m, x, s.y, z);
      put(K.cylinder(r * 1.05, r * 1.05, 0.012, { seg }), m, x, s.y + hj, z);
      put(K.sphere(0.011, { wSeg: 8, hSeg: 6 }), m, x, s.y + hj + 0.016, z);
    },
  },
];

/** Bowl (outer wall up to the rim, inner wall back down), origin at the bottom centre. */
function bowlGeometry(r, hb, seg) {
  return K.lathe([[0.0005, 0], [r * 0.42, 0], [r * 0.46, 0.004], [r * 0.78, hb * 0.42], [r * 0.97, hb * 0.86], [r, hb], [r - 0.004, hb], [r * 0.93, hb * 0.84], [r * 0.72, hb * 0.42], [r * 0.38, 0.008], [0.0005, 0.008]], { seg });
}

/** Vase: 'bottle' (round belly, slim neck) or 'urn' (straight body, wide mouth). */
function vaseGeometry(r, hv, kind, seg) {
  const p = kind === 'bottle'
    ? [[0.0005, 0], [r * 0.72, 0], [r * 0.93, 0.008], [r, hv * 0.3], [r * 0.88, hv * 0.56], [r * 0.4, hv * 0.78], [r * 0.32, hv * 0.93], [r * 0.38, hv], [r * 0.3, hv], [r * 0.25, hv * 0.9], [0.0005, hv * 0.86]]
    : [[0.0005, 0], [r * 0.8, 0], [r * 0.96, 0.008], [r, hv * 0.55], [r * 0.86, hv * 0.88], [r * 0.9, hv], [r * 0.83, hv], [r * 0.78, hv * 0.88], [0.0005, hv * 0.84]];
  return K.lathe(p, { seg });
}

/** Wine glass: foot, stem and bowl as one thin-walled lathe. */
function wineGlassGeometry(rg, hg, seg) {
  return K.lathe([[0.0005, 0], [rg * 0.82, 0], [rg * 0.82, 0.003], [0.0045, 0.007], [0.0035, hg * 0.42], [rg * 0.55, hg * 0.52], [rg, hg * 0.76], [rg * 0.9, hg], [rg * 0.86, hg], [rg * 0.94, hg * 0.76], [rg * 0.5, hg * 0.55], [0.0005, hg * 0.5]], { seg });
}

/**
 * Fills one vitrine level with 1–4 decor groups (never the same kind twice in a row, now and then an empty slot).
 * @param {Function} put  (geo, material, x, y, z, rot?) → adds a decor mesh
 * @param {{ x0: number, x1: number, y: number, clear: number, z0: number, z1: number }} lv
 */
export function vitrineDecor(put, lv, rnd, seg) {
  const avail = lv.x1 - lv.x0 - 0.03;
  const depth = lv.z1 - lv.z0;
  if (avail < 0.09 || lv.clear < 0.06 || depth < 0.06) return;
  const n = clamp(Math.floor(avail / 0.22), 1, 4);
  const slot = avail / n;
  let prev = '';
  for (let i = 0; i < n; i++) {
    const kinds = DECOR_KINDS.filter((k) => k.minH <= lv.clear && k.minW <= slot && k.minD <= depth && k.id !== prev);
    if (!kinds.length || (n >= 3 && rnd() < 0.18)) {
      prev = '';
      continue;
    }
    let pick = rnd() * kinds.reduce((a, k) => a + (k.weight ?? 1), 0);
    let k = kinds[kinds.length - 1];
    for (const c of kinds) if ((pick -= c.weight ?? 1) < 0) {
      k = c;
      break;
    }
    prev = k.id;
    const sx0 = lv.x0 + 0.015 + i * slot;
    k.build(put, { x0: sx0, x1: sx0 + slot, y: lv.y, clear: lv.clear, z0: lv.z0, z1: lv.z1 }, rnd, seg);
  }
}

/**
 * Vertex-coloured decor material (a clone of the cached ceramic / matt plastic, so the textures stay shared): every
 * ceramic or book of a vitrine in one draw call. Not cached – disposed with the model.
 */
export function decorMaterial(kind) {
  const base = kind === 'book' ? mat('plastic', '#ffffff', { roughness: 0.82 }) : mat('ceramic', '#ffffff');
  const m = base.clone();
  m.vertexColors = true;
  m.userData = { cached: false, kind: base.userData?.kind, decor: true };
  return m;
}

/** Approximate colour of a warm/neutral light (kelvin) for the LED glow (the LightManager retints it in the game). */
function kelvinHex(k) {
  const t = clamp((k - 2200) / (6500 - 2200), 0, 1);
  return `#${new THREE.Color('#ffc98a').lerp(new THREE.Color('#f4f6ff'), t).getHexString()}`;
}

/** Soft fall-off from the top centre (1) to the sides and the bottom (0), shared by every vitrine wash. */
let _washTex = null;
function washTexture() {
  if (_washTex) return _washTex;
  const nx = 32, ny = 64;
  const data = new Uint8Array(nx * ny * 4);
  const ex = Math.exp(-2.4), ey = Math.exp(-3.4);
  for (let j = 0; j < ny; j++) {
    const dy = 1 - (j + 0.5) / ny; // 0 at the top edge (row 0 = bottom of the plane)
    const b = Math.max(0, (Math.exp(-3.4 * dy * dy) - ey) / (1 - ey));
    for (let i = 0; i < nx; i++) {
      const u = ((i + 0.5) / nx) * 2 - 1;
      const a = Math.max(0, (Math.exp(-2.4 * u * u) - ex) / (1 - ex));
      const v = Math.round(255 * a * b);
      data.set([v, v, v, 255], (j * nx + i) * 4);
    }
  }
  _washTex = new THREE.DataTexture(data, nx, ny, THREE.RGBAFormat);
  _washTex.colorSpace = THREE.NoColorSpace;
  _washTex.magFilter = THREE.LinearFilter;
  _washTex.minFilter = THREE.LinearFilter;
  _washTex.needsUpdate = true;
  _washTex.userData.shared = true;
  return _washTex;
}

/** Level of the vitrine wash against its emissive level (the LightManager sets that from the LED's lumens). */
const WASH_GAIN = 1.2;

/**
 * Light from the LED strip on the back panel: a decal that brightens what is behind it (dst · (1 + glow)) – lit by
 * the LightManager with the strip (emissiveMeshes), so it also shows when the cabinet's spot gets no light slot. Same
 * technique as the lamps' ceiling pools.
 */
function washMaterial(hex) {
  const m = emissive(hex, 0.4, { color: '#000000' });
  m.emissiveMap = washTexture();
  m.roughness = 1;
  m.envMapIntensity = 0;
  m.transparent = true;
  m.depthWrite = false;
  m.blending = THREE.CustomBlending;
  m.blendEquation = THREE.AddEquation;
  m.blendSrc = THREE.DstColorFactor;
  m.blendDst = THREE.OneFactor;
  m.polygonOffset = true;
  m.polygonOffsetFactor = -2;
  m.toneMapped = false;
  const gain = { value: WASH_GAIN };
  m.onBeforeCompile = (sh) => {
    sh.uniforms.washGain = gain;
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float washGain;')
      .replace('#include <opaque_fragment>', 'outgoingLight = totalEmissiveRadiance * washGain;\n#include <opaque_fragment>');
  };
  m.customProgramCacheKey = () => 'vitrine-wash-v1';
  m.userData.washGain = gain;
  return m;
}

/**
 * Rectangular frustum (skirt under a cabinet): top w × d at y = hgt, bottom inset by `ix`/`iz`, origin at the bottom
 * centre. Metre UVs (grain along x).
 */
function frustumGeometry(w, d, hgt, ix, iz) {
  const B = new GeoBuilder();
  const t = [[-w / 2, hgt, -d / 2], [w / 2, hgt, -d / 2], [w / 2, hgt, d / 2], [-w / 2, hgt, d / 2]];
  const b = [[-w / 2 + ix, 0, -d / 2 + iz], [w / 2 - ix, 0, -d / 2 + iz], [w / 2 - ix, 0, d / 2 - iz], [-w / 2 + ix, 0, d / 2 - iz]];
  const uv = (p) => [p[0], p[1] + p[2]];
  B.poly(t, [0, 1, 0], (p) => [p[0], p[2]]);
  B.poly([...b].reverse(), [0, -1, 0], (p) => [p[0], p[2]]);
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    const e = [t[j][0] - t[i][0], 0, t[j][2] - t[i][2]];
    // outward normal of the side: horizontal edge × slope, tilted down by the inset
    const len = Math.hypot(e[0], e[2]) || 1;
    let nx = e[2] / len, nz = -e[0] / len;
    const cx = (t[i][0] + t[j][0]) / 2, cz = (t[i][2] + t[j][2]) / 2;
    if (nx * cx + nz * cz < 0) {
      nx = -nx;
      nz = -nz;
    }
    const inset = Math.abs(nx) > 0.5 ? ix : iz;
    const l = Math.hypot(hgt, inset) || 1;
    B.poly([t[i], t[j], b[j], b[i]], [(nx * hgt) / l, -inset / l, (nz * hgt) / l], uv);
  }
  const geo = B.build();
  K.worldUV(geo, 1, { grain: 'x' });
  return geo;
}

/**
 * Vitrine (display cabinet): glass doors with thin frames (or frameless / smoked / fluted glass), visible glass
 * shelves with a green edge, a closed lower part (doors or drawers) or drawers in the middle behind the glass,
 * stacked or side-by-side doors, warm LED strips under the top that glow and light the shelves, and a few neutral
 * objects on every level. Floor (legs/plinth/metal stand) or wall-hung (base 'wall': ARCHITECTURE §5 wall origin –
 * back centre at z = 0, y = vertical middle).
 */
function buildDisplayCabinet(spec) {
  const { w, d, h } = spec.dims;
  const P = spec.params || {};
  const M = spec.materials || {}, C = spec.colors || {};
  const g = new THREE.Group();
  const seg = qSeg(spec, 8);
  const dseg = spec.quality === 'low' ? 8 : spec.quality === 'high' ? 20 : 14;

  // -- mount and base -------------------------------------------------------------------------------------------
  let base = ['legs', 'plinth', 'wall', 'none'].includes(P.base) ? P.base : 'legs';
  // the item's mount wins when the spec carries it; otherwise base 'wall' means the wall origin (catalogue: mount 'wall')
  const wallMount = typeof spec.mount === 'string' ? spec.mount === 'wall' : base === 'wall';
  if (wallMount) base = 'wall';
  // a floor item switched to «veggmontert» floats at mountHeight with its origin on the floor (like the sideboard)
  const lift = !wallMount && base === 'wall' ? clamp(num(P.mountHeight, 0.9), 0, 2.2) : 0;
  const oy = wallMount ? -h / 2 : 0;
  const oz = wallMount ? d / 2 : 0;
  const put = (geo, material, part, x = 0, y = 0, z = 0, rot) => add(g, geo, material, part, x, y + oy, z + oz, rot);
  const legStyle = ['wood-taper', 'block', 'metal-frame', 'metal-thin'].includes(P.legStyle) ? P.legStyle : 'wood-taper';
  const legH = base === 'legs' || base === 'plinth' ? clamp(num(P.legH, base === 'plinth' ? 0.06 : 0.2), 0, h * 0.5) : 0;
  const yb = lift + legH;
  const yt = lift + h;

  // -- materials ------------------------------------------------------------------------------------------------
  const bodyKind = M.body || 'oak';
  const frontKind = M.front || bodyKind;
  const frontMetal = kindGroup(frontKind) === 'metal';
  const body = mat(bodyKind, C.body);
  // thin aluminium door frames: untextured (the metal grain reads as noise at 1–2 cm)
  const front = mat(frontKind, C.front, frontMetal ? { flat: true } : undefined);
  const topMat = pm(spec, 'top', bodyKind);
  const legKind = M.legs || 'black-metal';
  const legWood = kindGroup(legKind) === 'wood';
  const legsMat = mat(legKind, C.legs);
  const legsRound = mat(legKind, C.legs, legWood ? { grain: 'v' } : undefined);
  const handleKind = M.handle || 'black-metal';
  const handleMat = mat(handleKind, C.handle);
  const handleMetal = kindGroup(handleKind) === 'metal';
  const dark = darkInside();
  const doorStyle = ['glass-full', 'glass-framed', 'glass-ribbed', 'glass-smoked'].includes(P.doorStyle) ? P.doorStyle : 'glass-framed';
  const paneMat = doorStyle === 'glass-smoked'
    ? mat('glass-smoked', typeof P.glassColor === 'string' ? P.glassColor : '#1e1b19', { opacity: 0.86, envMapIntensity: 0.4 })
    : doorStyle === 'glass-ribbed' ? mat('glass-clear', '#e4ebe7', { opacity: 0.3 }) : mat('glass-clear', CLEAR_GLASS);
  const edgeMat = mat('glass-clear', '#9cc2b2', { opacity: 0.6 });
  const shelfGlass = mat('glass-clear', '#ecf4f0', { opacity: 0.2 });
  const pinMat = mat('chrome', '#d8dadc', { flat: true });
  const shelfWood = P.shelfMaterial === 'wood';

  // -- carcass --------------------------------------------------------------------------------------------------
  const stone = P.top === 'marble' || P.top === 'stone' || STONE.has(M.top);
  const sT = stone ? clamp(num(P.topT, 0.02), 0.01, 0.04) : 0;
  const tpT = stone ? 0.016 : clamp(num(P.topT, wallMount ? 0.016 : 0.022), 0.012, 0.05);
  const botT = 0.019, backT = 0.008;
  const gT = clamp(num(P.gableT, 0.019), 0.012, 0.04);
  const glassSides = !!P.glassSides;
  const rMax = Math.min(d / 2 - 0.001, w / 4);
  let r = P.corners === 'rounded' && !glassSides ? num(P.cornerR, 0.03) : 0.002;
  r = clamp(r, 0.001, rMax);
  const endW = Math.max(gT, r);
  const fit = (P.frontFit === 'overlay' || (P.frontFit !== 'inset' && wallMount)) && r < 0.02 ? 'overlay' : 'inset';
  const fT = 0.02;
  const zf = d / 2;
  const outline = roundRectPts(w, d, r, seg);
  const yTopPanel = yt - sT - tpT;

  if (stone) put(planSlab(outline, sT, { bevel: 0.0015, grain: 'x' }), topMat, 'top', 0, yt - sT, 0);
  put(planSlab(outline, tpT, { bevel: stone ? 0 : 0.0012, grain: 'x' }), stone ? body : topMat, stone ? 'body' : 'top', 0, yTopPanel, 0);
  // interior box (behind the doors) and the door field
  const ix0 = fit === 'overlay' ? -w / 2 + gT : -w / 2 + endW;
  const ix1 = -ix0;
  const iy0 = yb + botT, iy1 = yTopPanel;
  const izB = -d / 2 + backT;
  const izF = zf - fT - 0.003;
  const dx0 = fit === 'overlay' ? -w / 2 + 0.0015 : ix0, dx1 = -dx0;
  const dy0 = fit === 'overlay' ? yb + 0.0015 : iy0, dy1 = iy1;
  const cd = fit === 'overlay' ? d - fT - 0.002 : d;
  const cz = fit === 'overlay' ? -(d - cd) / 2 : 0;
  if (fit === 'overlay') {
    put(K.box(w - 2 * gT, botT, cd, { grain: 'x' }), body, 'body', 0, yb + botT / 2, cz);
  } else {
    put(planSlab(outline, botT, { grain: 'x' }), body, 'body', 0, yb, 0);
  }
  put(K.box(ix1 - ix0, iy1 - iy0, backT, { grain: 'y' }), body, 'body', 0, (iy0 + iy1) / 2, -d / 2 + backT / 2);

  // -- vertical layout ------------------------------------------------------------------------------------------
  const doorsN = clamp(Math.round(num(P.doors, w > 0.75 ? 2 : 1)), 1, 6);
  const stacked = P.doorLayout === 'stacked';
  const nCols = stacked ? Math.max(1, Math.round(doorsN / 2)) : doorsN;
  const colW = (dx1 - dx0) / nCols;
  const bays = w > 1.0 && nCols >= 2 ? nCols : 1;
  const drawersN = clamp(Math.round(num(P.drawers, 0)), 0, 6);
  const midDrawers = P.drawerPosition === 'middle-inside' && drawersN > 0 && !stacked;
  const openH = dy1 - dy0;
  let lowH = clamp(num(P.bottomHeight, 0), 0, openH * 0.5);
  if (!midDrawers && drawersN > 0 && lowH < 0.06) lowH = clamp(0.16, 0.1, openH * 0.3);
  if (lowH < 0.06) lowH = 0;
  // a tall closed part gets doors (drawers = the number of doors, Sagene), unless there are more drawers than doors
  const lowDoors = lowH >= 0.28 && drawersN <= Math.max(nCols, 2);
  const gap = 0.003;
  const eg = fit === 'inset' ? 0.0025 : 0.0015;
  const gy0 = lowH ? dy0 + lowH : dy0; // front split between the closed part and the glass doors
  const divT = 0.019;
  const secFloor = lowH ? gy0 + divT - 0.002 : iy0;
  if (lowH) put(K.box(ix1 - ix0, divT, izF - izB + 0.002, { grain: 'x' }), body, 'body', 0, gy0 + divT / 2 - 0.002, (izB + izF) / 2 + 0.001);
  const splitAt = clamp(num(P.splitAt, 0.5), 0.3, 0.7);
  const ySplit = stacked ? gy0 + (dy1 - gy0) * splitAt : null;
  const sections = stacked
    ? [{ y0: secFloor, y1: ySplit - divT / 2 }, { y0: ySplit + divT / 2, y1: iy1 }]
    : [{ y0: secFloor, y1: iy1 }];
  if (stacked) put(K.box(ix1 - ix0, divT, izF - izB, { grain: 'x' }), body, 'body', 0, ySplit, (izB + izF) / 2);

  // -- gables (glass sides: a frame with a pane over the glass part) -------------------------------------------
  const glassY0 = lowH ? gy0 : iy0;
  if (fit === 'overlay') {
    for (const sx of [-1, 1]) put(K.box(gT, yTopPanel - yb, cd, { grain: 'y' }), body, 'body', sx * (w / 2 - gT / 2), (yb + yTopPanel) / 2, cz);
  } else if (glassSides) {
    const st = Math.min(0.045, d * 0.14);
    for (const sx of [-1, 1]) {
      const x = sx * (w / 2 - gT / 2);
      if (glassY0 > iy0 + 0.005) put(K.box(gT, glassY0 - iy0, d, { grain: 'y' }), body, 'body', x, (iy0 + glassY0) / 2, 0);
      for (const sz of [-1, 1]) put(K.box(gT, iy1 - glassY0, st, { grain: 'y' }), body, 'body', x, (glassY0 + iy1) / 2, sz * (d / 2 - st / 2));
      put(K.box(0.004, iy1 - glassY0, d - 2 * st + 0.004), paneMat, null, x, (glassY0 + iy1) / 2, 0);
    }
  } else {
    for (const sx of [-1, 1]) {
      const pts = dedupe(sx > 0 ? clipHalf(outline, 'x', w / 2 - endW, true) : clipHalf(outline, 'x', -w / 2 + endW, false));
      if (pts.length >= 3) put(planSlab(pts, iy1 - iy0, { grain: 'y' }), body, 'body', 0, iy0, 0);
    }
  }

  // -- bays, shelves, drawers in the glass part, LED strips and decor levels ------------------------------------
  let free = clamp(Math.round(num(P.shelves, 3)), 0, 14);
  if (lowDoors) free -= 1; // one shelf lives in the closed cupboard
  if (stacked) free -= 1; // the fixed shelf behind the meeting rails
  free = Math.max(0, free);
  let perBay = bays > 1 ? Math.round(free / bays) : free;
  if (midDrawers) perBay = Math.max(0, perBay - 1); // the drawer box stands on one of them
  const divW = 0.018;
  const bayList = [];
  for (let b = 0; b < bays; b++) {
    const x0 = bays > 1 ? dx0 + b * ((dx1 - dx0) / bays) : ix0;
    const x1 = bays > 1 ? dx0 + (b + 1) * ((dx1 - dx0) / bays) : ix1;
    bayList.push({ x0: Math.max(ix0, x0 + (b > 0 ? divW / 2 : 0)), x1: Math.min(ix1, x1 - (b < bays - 1 ? divW / 2 : 0)) });
    if (b > 0) put(K.box(divW, iy1 - secFloor, izF - izB, { grain: 'y' }), body, 'body', x0, (secFloor + iy1) / 2, (izB + izF) / 2);
  }
  const shT = shelfWood ? 0.018 : 0.006;
  const sd = izF - izB - 0.006;
  const szc = (izB + izF) / 2 - 0.001;
  const levels = [];
  const strips = [];
  const ledOn = !!P.led;
  const ledK = clamp(num(P.ledK, 3000), 2200, 6500);
  const decorOn = P.decor !== false;
  const drawerH = clamp(num(P.drawerH, 0.12), 0.08, 0.2);
  const midDrawerFronts = [];

  const shelf = (x0, x1, y) => {
    const sw = x1 - x0 - 0.004;
    if (shelfWood) {
      put(K.box(sw, shT, sd, { grain: 'x' }), body, 'body', (x0 + x1) / 2, y, szc);
    } else {
      put(K.box(sw, shT, sd), shelfGlass, null, (x0 + x1) / 2, y, szc);
      // polished edge: the green line that makes a glass shelf visible
      put(K.box(sw, shT, 0.0016), edgeMat, null, (x0 + x1) / 2, y, szc + sd / 2 + 0.0004);
    }
    // shelf pins
    const pin = K.cylinder(0.0028, 0.0028, 0.012, { seg: 6, center: true });
    for (const px of [x0 + 0.004, x1 - 0.004]) for (const pz of [izB + 0.035, izF - 0.035]) put(pin.clone(), pinMat, null, px, y - shT / 2 - 0.003, pz, [0, 0, Math.PI / 2]);
    pin.dispose();
  };

  /** Shelves evenly in [y0, y1] of a bay; records the decor levels between them. */
  const fill = (bay, y0, y1, n, bi) => {
    const span = y1 - y0;
    const nn = Math.max(0, Math.min(n, Math.floor(span / 0.13) - 1));
    let floor = y0;
    for (let k = 1; k <= nn; k++) {
      const y = y0 + (span * k) / (nn + 1);
      shelf(bay.x0, bay.x1, y);
      levels.push({ bi, x0: bay.x0, x1: bay.x1, y: floor, clear: y - shT / 2 - floor - 0.004 });
      floor = y + shT / 2;
    }
    levels.push({ bi, x0: bay.x0, x1: bay.x1, y: floor, clear: y1 - floor - 0.012 }); // room for the LED channel either way
  };

  bayList.forEach((bay, bi) => {
    sections.forEach((sec, si) => {
      let n = perBay;
      if (stacked) n = si === 1 ? Math.ceil(perBay / 2) : Math.floor(perBay / 2);
      if (midDrawers) {
        // drawer box on a shelf in the middle of the glass part (Belfort), finger notch at the top
        const mid = sec.y0 + (sec.y1 - sec.y0) * clamp(num(P.drawerAt, 0.5), 0.25, 0.75);
        const yd0 = mid - drawerH / 2, yd1 = mid + drawerH / 2;
        const bw = bay.x1 - bay.x0;
        put(K.box(bw - 0.002, 0.016, sd + 0.004, { grain: 'x' }), body, 'body', (bay.x0 + bay.x1) / 2, yd0 - 0.008, szc);
        put(K.box(bw - 0.02, drawerH - 0.012, sd - 0.03, { grain: 'x' }), body, 'body', (bay.x0 + bay.x1) / 2, (yd0 + yd1) / 2 - 0.004, szc - 0.02);
        const zFace = izF - 0.006;
        put(K.roundedBox(bw - 0.012, drawerH - 0.004, 0.018, 0.0012, 1, { grain: 'x' }), front, 'front', (bay.x0 + bay.x1) / 2, (yd0 + yd1) / 2, zFace - 0.009);
        midDrawerFronts.push({ x: (bay.x0 + bay.x1) / 2, y: yd1 - 0.002, z: zFace, w: bw });
        fill(bay, sec.y0, yd0 - 0.016, Math.floor(n / 2), bi);
        fill(bay, yd1, sec.y1, Math.ceil(n / 2), bi);
      } else {
        fill(bay, sec.y0, sec.y1, n, bi);
      }
      if (ledOn) strips.push({ bi, si, x0: bay.x0, x1: bay.x1, y: sec.y1, y0: sec.y0 });
    });
  });
  // finger notches of the inner drawers
  for (const f of midDrawerFronts) {
    const nw = clamp(f.w * 0.16, 0.05, 0.09);
    put(K.extrudeShape(K.stadiumShape(nw, 0.012, 8), 0.004), handleMetal ? dark : handleMat, handleMetal ? null : 'handle', f.x, f.y - 0.008, f.z - 0.0035);
  }

  // LED strips: an aluminium channel under each section ceiling (a little behind the doors, so the glowing line
  // shows through the glass from standing eye height), a soft wash of light on the back panel below it, and one warm
  // spot light per strip (two at most – further strips glow with the nearest light)
  const lights = [];
  if (ledOn && strips.length) {
    const chan = mat('steel', '#b9bcbf', { flat: true });
    const lit = [];
    const glowHex = kelvinHex(ledK);
    for (const st of strips) {
      const sw = Math.max(0.05, st.x1 - st.x0 - 0.04);
      const sx = (st.x0 + st.x1) / 2;
      const sz = clamp(izF - 0.09, (izB + izF) / 2, izF - 0.02);
      put(K.box(sw, 0.006, 0.016), chan, null, sx, st.y - 0.003, sz);
      const glow = K.partMesh(K.box(sw - 0.004, 0.0025, 0.011), emissive(glowHex, 2.4, { color: '#fff3e2' }), null, { position: [sx, st.y - 0.0072 + oy, sz + oz], noMerge: true });
      glow.userData.noShadow = true;
      g.add(glow);
      const meshes = [glow];
      const washH = Math.min(st.y - st.y0, 0.95);
      if (washH > 0.08) {
        // back panel + the two inner side walls of the bay, one mesh
        const yc = st.y - washH / 2 + oy, zc = (izB + izF) / 2 + oz, dep = izF - izB - 0.01;
        const back = new THREE.PlaneGeometry(st.x1 - st.x0 - 0.004, washH).translate(sx, yc, izB + 0.0015 + oz);
        const left = new THREE.PlaneGeometry(dep, washH).rotateY(Math.PI / 2).translate(st.x0 + 0.0015, yc, zc);
        const right = new THREE.PlaneGeometry(dep, washH).rotateY(-Math.PI / 2).translate(st.x1 - 0.0015, yc, zc);
        const geo = mergeGeometries([back, left, right], false);
        for (const x of [back, left, right]) x.dispose();
        const wash = new THREE.Mesh(geo, washMaterial(glowHex));
        wash.name = 'vitrine-wash';
        wash.raycast = () => {};
        wash.userData.noMerge = true;
        wash.userData.noHighlight = true;
        wash.userData.noShadow = true;
        g.add(wash);
        meshes.push(wash);
      }
      lit.push({ st, meshes, sw, sx, sz });
    }
    const keys = lit.length <= 2 ? lit : [lit[0], lit[lit.length - 1]];
    const groups = keys.map((k) => ({ k, items: [] }));
    const dist = (a, l) => Math.abs(a.sx - l.sx) + Math.abs(a.st.y - l.st.y);
    for (const l of lit) groups.reduce((best, gr) => (dist(gr.k, l) < dist(best.k, l) ? gr : best), groups[0]).items.push(l);
    const dir = new THREE.Vector3(0, -1, -0.12).normalize().toArray();
    for (const gr of groups) {
      const { st, sx, sz } = gr.k;
      const lumens = Math.round(clamp(240 * gr.items.reduce((a, l) => a + l.sw, 0), 50, 420));
      lights.push(K.spotLight([sx, st.y - 0.012 + oy, sz + oz], dir, { angle: 1.15, penumbra: 0.9, lumens, colorK: ledK, emissiveMeshes: gr.items.flatMap((l) => l.meshes) }));
    }
  }

  // decor: a few neutral pieces per level (deterministic per bay and level)
  if (decorOn) {
    const z0 = izB + 0.004, z1 = izF - 0.012;
    const batch = { ceramic: [], book: [] };
    const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _one = new THREE.Vector3(1, 1, 1), _v = new THREE.Vector3();
    const _col = new THREE.Color();
    const dput = (geo, material, x, y, z, rot) => {
      if (!material?.decor) {
        put(geo, material, null, x, y, z, rot);
        return;
      }
      // bake the transform and the colour, merge per kind below (one draw call for all ceramics, one for the books)
      _q.setFromEuler(_e.set(...(rot || [0, 0, 0])));
      geo.applyMatrix4(_m.compose(_v.set(x, y + oy, z + oz), _q, _one));
      _col.set(material.hex); // Color.set converts the sRGB hex to the linear working space (= vertex colour space)
      const n = geo.attributes.position.count;
      const c = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) c.set([_col.r, _col.g, _col.b], i * 3);
      geo.setAttribute('color', new THREE.BufferAttribute(c, 3));
      for (const k of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(k)) geo.deleteAttribute(k);
      batch[material.decor].push(geo.index ? geo : geo.toNonIndexed());
    };
    levels.forEach((lv, li) => {
      // seeded by the cabinet's size and the level's place, so toggling LED/handles/colours keeps the same objects
      const rnd = K.rng(`vitrine|${Math.round(w * 100)}|${Math.round(d * 100)}|${lv.bi}|${li}|${Math.round(lv.y * 100)}|${Math.round(lv.clear * 100)}`);
      vitrineDecor(dput, { x0: lv.x0, x1: lv.x1, y: lv.y, clear: lv.clear, z0, z1: Math.max(z0 + 0.05, z1) }, rnd, dseg);
    });
    for (const [kind, list] of Object.entries(batch)) {
      if (!list.length) continue;
      const geo = mergeGeometries(list, false);
      for (const x of list) x.dispose();
      if (!geo) continue;
      const m = new THREE.Mesh(geo, decorMaterial(kind));
      m.name = `vitrine-decor-${kind}`;
      m.userData.noMerge = true;
      m.userData.noShadow = true; // small pieces inside a cabinet: receive, but keep them out of the shadow passes
      g.add(m);
    }
  }

  // -- doors ----------------------------------------------------------------------------------------------------
  const fw0 = clamp(num(P.frameW, frontMetal ? 0.013 : 0.04), 0.006, 0.09);
  const handle = ['bar', 'cutout', 'knob', 'none'].includes(P.handle) ? P.handle : 'none';
  const cutout = handle === 'cutout' || P.handleCutout === true;
  const grooveMat = handleMat;

  /** Handle on a glass door: on the stile at the opening edge (vertical), `yAt` = centre height. */
  const doorHandle = (x0, x1, side, yAt, fwv, yLim) => {
    if (handle === 'none' || handle === 'cutout') return;
    const hx = side > 0 ? x1 - Math.max(fwv / 2, 0.012) : x0 + Math.max(fwv / 2, 0.012);
    if (handle === 'knob') {
      // slim fluted knob (vertical) on a short stem
      put(K.cylinder(0.0035, 0.0035, 0.016, { seg: 8, center: true }), handleMat, 'handle', hx, yAt, zf + 0.008, [Math.PI / 2, 0, 0]);
      put(K.cylinder(0.0065, 0.0065, 0.046, { seg: 8, center: true }), handleMat, 'handle', hx, yAt, zf + 0.021);
      for (const s of [-1, 1]) put(K.sphere(0.0065, { wSeg: 8, hSeg: 4 }), handleMat, 'handle', hx, yAt + s * 0.023, zf + 0.021);
      return;
    }
    const len = clamp(num(P.handleLen, 0.13), 0.06, yLim * 0.45);
    if (handleMetal) {
      put(K.box(0.011, len, 0.011, { grain: 'y' }), handleMat, 'handle', hx, yAt, zf + 0.024);
      for (const s of [-1, 1]) put(K.cylinder(0.0045, 0.0045, 0.022, { seg: 8, center: true }), handleMat, 'handle', hx, yAt + s * (len / 2 - 0.012), zf + 0.011, [Math.PI / 2, 0, 0]);
    } else {
      put(K.roundedBox(0.02, len, 0.02, 0.006, 2, { grain: 'y' }), handleMat, 'handle', hx, yAt, zf + 0.01);
    }
  };

  /** Pull on a solid lower front / drawer: centred near the top edge (lip pull, bar, knob or a routed notch). */
  const frontHandle = (x0, x1, y0, y1) => {
    const dw = x1 - x0, dh = y1 - y0;
    const cx = (x0 + x1) / 2;
    if (cutout || handle === 'cutout') {
      const nw = clamp(dw * 0.3, 0.06, 0.16);
      put(K.extrudeShape(K.stadiumShape(nw, 0.016, 8), 0.004), grooveMat, 'handle', cx, y1 - 0.016, zf - 0.0035);
      return;
    }
    if (handle === 'none') return;
    if (handle === 'knob') {
      // small horizontal pull (Signature: brass)
      put(K.cylinder(0.0035, 0.0035, 0.016, { seg: 8, center: true }), handleMat, 'handle', cx, dh < 0.2 ? (y0 + y1) / 2 : y1 - 0.04, zf + 0.008, [Math.PI / 2, 0, 0]);
      put(K.cylinder(0.006, 0.006, 0.05, { seg: 8, center: true }), handleMat, 'handle', cx, dh < 0.2 ? (y0 + y1) / 2 : y1 - 0.04, zf + 0.02, [0, 0, Math.PI / 2]);
      return;
    }
    const len = clamp(num(P.handleLen, dw * 0.26), 0.07, Math.min(0.2, dw - 0.06));
    if (handleMetal) {
      // lip pull on the top edge (Sagene): a plate over the edge and a short lip in front
      put(K.box(len, 0.003, 0.024, { grain: 'x' }), handleMat, 'handle', cx, y1 - 0.0015, zf + 0.008);
      put(K.box(len, 0.016, 0.003, { grain: 'x' }), handleMat, 'handle', cx, y1 - 0.009, zf + 0.0185);
    } else {
      put(K.roundedBox(len, 0.02, 0.018, 0.006, 2, { grain: 'x' }), handleMat, 'handle', cx, y1 - 0.035, zf + 0.009);
    }
  };

  /** Solid front (lower door / drawer). */
  const solidFront = (x0, x1, y0, y1, grain) => {
    if (x1 - x0 < 0.02 || y1 - y0 < 0.02) return;
    put(K.roundedBox(x1 - x0, y1 - y0, fT, 0.0012, 1, { grain }), front, 'front', (x0 + x1) / 2, (y0 + y1) / 2, zf - fT / 2);
    frontHandle(x0, x1, y0, y1);
  };

  /** One glass door x0..x1 × y0..y1; railB/railT widen the bottom/top rail (stacked doors meet on wide rails). */
  const glassDoor = (x0, x1, y0, y1, { side = 1, railB = 0, railT = 0, handleY = null } = {}) => {
    const dw = x1 - x0, dh = y1 - y0;
    if (dw < 0.03 || dh < 0.03) return;
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    const zMid = zf - fT / 2;
    if (doorStyle === 'glass-full') {
      // frameless toughened glass with polished (green) edges and two small hinge plates
      const t = 0.005;
      put(K.box(dw, dh, t), paneMat, null, cx, cy, zf - t / 2);
      for (const s of [-1, 1]) {
        put(K.box(0.0014, dh, t), edgeMat, null, cx + s * (dw / 2 - 0.0007), cy, zf - t / 2);
        put(K.box(dw - 0.003, 0.0014, t), edgeMat, null, cx, cy + s * (dh / 2 - 0.0007), zf - t / 2);
      }
      const hxp = side > 0 ? x0 + 0.012 : x1 - 0.012;
      for (const hy of [y0 + Math.min(0.08, dh * 0.2), y1 - Math.min(0.08, dh * 0.2)]) put(K.box(0.02, 0.04, 0.008), pinMat, null, hxp, hy, zf - t - 0.004);
      doorHandle(x0, x1, side, handleY ?? cy, 0.012, dh);
      return;
    }
    const fwv = clamp(fw0, 0.006, Math.min(dw, dh) * 0.22);
    const rb = Math.max(fwv, railB), rt = Math.max(fwv, railT);
    for (const s of [-1, 1]) put(K.box(fwv, dh, fT, { grain: 'y' }), front, 'front', s > 0 ? x1 - fwv / 2 : x0 + fwv / 2, cy, zMid);
    put(K.box(dw - 2 * fwv, rt, fT, { grain: 'x' }), front, 'front', cx, y1 - rt / 2, zMid);
    put(K.box(dw - 2 * fwv, rb, fT, { grain: 'x' }), front, 'front', cx, y0 + rb / 2, zMid);
    const iw = dw - 2 * fwv, ih = dh - rt - rb;
    const icy = (y0 + rb + y1 - rt) / 2;
    if (iw > 0.01 && ih > 0.01) {
      if (doorStyle === 'glass-ribbed') {
        const geo = ribPanelGeometry(iw + 0.006, ih + 0.006, { pitch: 0.012, depth: 0.0024, t: 0.003, seg: spec.quality === 'low' ? 2 : 4 });
        put(geo, paneMat, null, cx, icy, zMid - 0.0027);
      } else {
        put(K.box(iw + 0.006, ih + 0.006, 0.004), paneMat, null, cx, icy, zMid);
      }
      // hidden glassBars: horizontal glazing bars across the pane (Wolin 1, Madrid 2)
      const nBars = clamp(Math.round(num(P.glassBars, 0)), 0, 6);
      for (let k = 1; k <= nBars; k++) put(K.box(iw, Math.max(0.008, fwv * 0.6), fT * 0.7, { grain: 'x' }), front, 'front', cx, icy - ih / 2 + (k * ih) / (nBars + 1), zMid + fT * 0.1);
      // glazing bead: a thin moulding on the inner edge of a wooden frame, a little behind its face
      if (!frontMetal && fwv >= 0.025) {
        const bd = 0.006, bz = zf - 0.0055 - 0.0035;
        for (const s of [-1, 1]) put(K.box(bd, ih, 0.007, { grain: 'y' }), front, 'front', cx + s * (iw / 2 - bd / 2), icy, bz);
        for (const s of [-1, 1]) put(K.box(iw - 2 * bd, bd, 0.007, { grain: 'x' }), front, 'front', cx, icy + s * (ih / 2 - bd / 2), bz);
      }
    }
    doorHandle(x0, x1, side, handleY ?? cy, fwv, dh);
  };

  // closed lower part: side-by-side doors (≥ 28 cm) or drawers
  if (lowH) {
    if (fit === 'inset') put(K.box(dx1 - dx0 - 0.001, lowH, 0.001), dark, null, (dx0 + dx1) / 2, dy0 + lowH / 2, zf - fT - 0.0008);
    const nLow = clamp(drawersN || nCols, 1, 6);
    const ly0 = dy0 + eg, ly1 = gy0 - gap / 2;
    // drawers: side by side in a low band (≤ 4), otherwise stacked
    const stack = !lowDoors && (lowH >= 0.28 || nLow > 4);
    const lowCols = stack ? 1 : nLow;
    const rows = stack ? nLow : 1;
    const lw = (dx1 - dx0) / lowCols;
    for (let c = 0; c < lowCols; c++) {
      const x0 = dx0 + c * lw + (c === 0 ? eg : gap / 2), x1 = dx0 + (c + 1) * lw - (c === lowCols - 1 ? eg : gap / 2);
      const rh = (ly1 - ly0 - gap * (rows - 1)) / rows;
      for (let k = 0; k < rows; k++) solidFront(x0, x1, ly0 + k * (rh + gap), ly0 + k * (rh + gap) + rh, lowDoors ? 'y' : 'x');
    }
  }
  // glass doors
  const railWide = cutout && stacked ? clamp(fw0 * 1.4, 0.05, 0.075) : 0;
  for (let c = 0; c < nCols; c++) {
    const x0 = dx0 + c * colW + (c === 0 ? eg : gap / 2), x1 = dx0 + (c + 1) * colW - (c === nCols - 1 ? eg : gap / 2);
    const side = handleSide(c, nCols);
    const y0 = gy0 + (lowH ? gap / 2 : eg);
    if (stacked) {
      // two doors on top of each other; they meet on wide rails with the routed grip across the joint (Scandi)
      glassDoor(x0, x1, y0, ySplit - gap / 2, { side, railT: railWide, handleY: ySplit - Math.min(0.12, (ySplit - y0) * 0.2) });
      glassDoor(x0, x1, ySplit + gap / 2, dy1 - eg, { side, railB: railWide, handleY: ySplit + Math.min(0.12, (dy1 - ySplit) * 0.2) });
      if (cutout) {
        const nw = clamp((x1 - x0) * 0.45, 0.08, 0.34);
        put(K.extrudeShape(K.stadiumShape(nw, 0.04, 10), 0.004), grooveMat, 'handle', (x0 + x1) / 2, ySplit, zf - 0.0035);
      }
    } else {
      glassDoor(x0, x1, y0, dy1 - eg, { side });
      if (cutout) {
        // vertical routed grip in the stile at the opening edge
        const gx = side > 0 ? x1 - 0.02 : x0 + 0.02;
        put(K.extrudeShape(K.stadiumShape(Math.min(0.16, (dy1 - y0) * 0.2), 0.022, 8), 0.004), grooveMat, 'handle', gx, (y0 + dy1) / 2, zf - 0.0035, [0, 0, Math.PI / 2]);
      }
    }
  }

  // -- base -----------------------------------------------------------------------------------------------------
  if (base === 'plinth' && legH > 0.005) {
    const pw = w - 2 * Math.max(0.015, r * 0.7), pd = d - 0.04;
    put(K.box(pw, legH, pd, { grain: 'x' }), legsMat, 'legs', 0, lift + legH / 2, -0.012);
  } else if (base === 'legs' && legH > 0.005) {
    if (legStyle === 'metal-frame' && legH >= 0.15) {
      // tall stand of square tube (Signature 1860): a frame under the cabinet, corner legs, floor rails on the sides and
      // at the back (open at the front)
      const s = clamp(num(P.tubeW, 0.018), 0.012, 0.03);
      const fx = w / 2 - 0.012 - s / 2, fzz = d / 2 - 0.012 - s / 2;
      for (const sz of [-1, 1]) put(K.box(2 * fx + s, s, s, { grain: 'x' }), legsMat, 'legs', 0, yb - s / 2, sz * fzz);
      for (const sx of [-1, 1]) put(K.box(s, s, 2 * fzz - s, { grain: 'z' }), legsMat, 'legs', sx * fx, yb - s / 2, 0);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) put(K.box(s, yb - lift - s, s, { grain: 'y' }), legsMat, 'legs', sx * fx, lift + (yb - lift - s) / 2, sz * fzz);
      if (P.legCross === true) {
        // hidden legCross: two diagonal stretchers crossing corner to corner low between the legs (FABRIKÖR)
        const L = Math.hypot(2 * fx, 2 * fzz) - s;
        for (const sg of [-1, 1]) put(K.box(s, s, L, { grain: 'z' }), legsMat, 'legs', 0, lift + 0.08 + (sg > 0 ? s * 0.5 : -s * 0.5), 0, [0, sg * Math.atan2(2 * fx, 2 * fzz), 0]);
      } else {
        for (const sx of [-1, 1]) put(K.box(s, s, 2 * fzz - s, { grain: 'z' }), legsMat, 'legs', sx * fx, lift + s / 2, 0);
        put(K.box(2 * fx - s, s, s, { grain: 'x' }), legsMat, 'legs', 0, lift + s / 2, -fzz);
      }
    } else if (legStyle === 'metal-frame') {
      const fw = w - 0.04, fd = d - 0.05, ft = 0.006;
      for (const sz of [-1, 1]) put(K.box(fw, legH, ft, { grain: 'x' }), legsMat, 'legs', 0, lift + legH / 2, sz * (fd / 2 - ft / 2));
      for (const sx of [-1, 1]) put(K.box(ft, legH, fd - 2 * ft, { grain: 'z' }), legsMat, 'legs', sx * (fw / 2 - ft / 2), lift + legH / 2, 0);
    } else if (legStyle === 'wood-taper') {
      const apron = typeof P.legFrame === 'boolean' ? P.legFrame : w >= 1.05;
      const tilt = 5 * K.DEG;
      if (apron) {
        // apron frame under the cabinet, square tapered legs at its corners, splayed a little (Belfort)
        const railH = Math.min(0.045, legH * 0.22), railT = 0.022;
        const ax = 0.03, az = 0.02;
        const fw = w - 2 * ax, fd = d - 2 * az;
        put(K.box(fw, railH, railT, { grain: 'x' }), legsMat, 'legs', 0, yb - railH / 2, fd / 2 - railT / 2 - 0.006);
        put(K.box(fw, railH, railT, { grain: 'x' }), legsMat, 'legs', 0, yb - railH / 2, -fd / 2 + railT / 2);
        for (const sx of [-1, 1]) put(K.box(railT, railH, fd - 2 * railT - 0.006, { grain: 'z' }), legsMat, 'legs', sx * (fw / 2 - railT / 2), yb - railH / 2, -0.003);
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
          const geo = K.taperLeg((yb - lift) / Math.cos(tilt), 0.02, 0.014, { square: true });
          geo.translate(0, -(yb - lift) / Math.cos(tilt), 0);
          geo.rotateZ(sx * tilt);
          geo.rotateX(-sz * tilt * 0.6);
          geo.translate(sx * (fw / 2 - 0.02), yb, sz * (fd / 2 - 0.022));
          put(geo, legsMat, 'legs');
        }
      } else {
        // chamfered skirt under the bottom and round tapered legs, splayed (Sagene)
        const skH = Math.min(0.03, legH * 0.15);
        put(frustumGeometry(w - 0.002, d - 0.002, skH, 0.018, 0.012), body, 'body', 0, yb - skH, 0);
        const ix = 0.06 + r * 0.5, iz = 0.05;
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
          const x = sx * (w / 2 - ix), z = sz * (d / 2 - iz);
          put(splayedLeg(x, yb - skH + 0.002, z, 0.017, 0.011, sx * tilt, sz * tilt * 0.7, qSeg(spec, 14)), legsRound, 'legs');
        }
      }
    } else if (legStyle === 'block') {
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        const x = sx * (w / 2 - 0.05 - r * 0.5), z = sz * (d / 2 - 0.045);
        if (legH < 0.1) put(K.cylinder(0.022, 0.02, legH + 0.001, { seg: qSeg(spec, 16) }), legsRound, 'legs', x, lift, z);
        else put(K.roundedBox(0.05, legH + 0.001, 0.05, 0.004, 1, { grain: 'y', bottom: true }), legsMat, 'legs', x, lift, z);
      }
    } else {
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        const x = sx * (w / 2 - 0.05 - r * 0.5), z = sz * (d / 2 - 0.045);
        put(K.cylinder(0.0075, 0.0068, legH, { seg: qSeg(spec, 12) }), legsMat, 'legs', x, lift, z);
        put(K.box(0.04, 0.004, 0.04), legsMat, 'legs', x, yb - 0.002, z);
      }
    }
  }

  // -- finish ---------------------------------------------------------------------------------------------------
  const surfaces = [{ y: +(yt + oy).toFixed(4), w: +(w - 0.02).toFixed(3), d: +(d - 0.03).toFixed(3), center: [0, +oz.toFixed(4)] }];
  const colliders = !wallMount && lift > 0 ? [{ min: [-w / 2, lift, -d / 2], max: [w / 2, yt, d / 2] }] : undefined;
  const rc = recolorer(g, (part, kind) => {
    if (part === 'front') return !!kind && kindGroup(kind) !== kindGroup(frontKind);
    if (part === 'handle') return !!kind && kindGroup(kind) !== kindGroup(handleKind);
    if (part === 'legs') return !!kind && kindGroup(kind) !== kindGroup(legKind);
    if (part === 'top') return !!kind && STONE.has(kind) !== STONE.has(M.top);
    return false;
  });
  g.name = 'display-cabinet';
  return K.finishModel(g, { lights, surfaces, colliders, recolor: rc });
}

// ---------------------------------------------------------------------------------------------------------------
// Param schemas (Norwegian labels)

export const P_CABINET = {
  ...P_TOP,
  base: { type: 'enum', label: 'Understell', options: [['legs', 'Ben'], ['plinth', 'Sokkel'], ['wall', 'Veggmontert (svevende)'], ['none', 'Rett på gulvet']] },
  legStyle: { type: 'enum', label: 'Bentype', options: [['metal-thin', 'Tynne metallben'], ['wood-taper', 'Skrå treben'], ['block', 'Klosser / føtter'], ['metal-frame', 'Lav metallramme']] },
  legH: { type: 'number', min: 0, max: 0.35, step: 0.01, label: 'Benhøyde (m)' },
  mountHeight: { type: 'number', min: 0.1, max: 1.2, step: 0.01, label: 'Høyde over gulv (m)' },
  doors: { type: 'number', min: 1, max: 6, step: 1, label: 'Antall dører / kolonner', default: 3 },
  drawerRow: { type: 'number', min: 0, max: 4, step: 1, label: 'Skuffer i egen rad', default: 0 },
  drawerRowPos: { type: 'enum', label: 'Skufferaden', options: [['top', 'Øverst'], ['bottom', 'Nederst']], default: 'top' },
  frontStyle: { type: 'enum', label: 'Fronter', options: [['flat', 'Glatte'], ['ribbed', 'Riflede'], ['slatted', 'Spiler'], ['cane', 'Flettet'], ['glass', 'Glass i treramme'], ['framed', 'Rammedører'], ['grooved', 'Med spor'], ['fabric', 'Tekstil (høyttalerduk)']] },
  frontPattern: { type: 'enum', label: 'Mønster', options: [['none', 'Ingen'], ['herringbone', 'Fiskebein']], default: 'none' },
  ribPitch: { type: 'number', min: 0.008, max: 0.04, step: 0.001, label: 'Riflebredde (m)', default: 0.016 },
  handle: { type: 'enum', label: 'Håndtak', options: [['none', 'Uten (trykk og åpne)'], ['bar', 'Stanggrep'], ['cutout', 'Innfrest grep'], ['knob', 'Knott'], ['edge', 'Grepslist']] },
  top: { type: 'enum', label: 'Topplate', options: [['same', 'Som korpus'], ['marble', 'Stein / keramikk']] },
  corners: { type: 'enum', label: 'Hjørner', options: [['square', 'Rette'], ['rounded', 'Avrundede']] },
  cornerR: { type: 'number', min: 0.005, max: 0.25, step: 0.005, label: 'Hjørneradius (m)', default: 0.04 },
};

const P_DISPLAY = {
  // base 'wall' is the product's construction (mount 'wall', wall origin) and is not offered here: the Inspector cannot
  // move an item between the floor and a wall. floorOnly: nothing to change on a wall-hung cabinet (notes/add-storage.md)
  base: { type: 'enum', label: 'Understell', options: [['legs', 'Ben'], ['plinth', 'Sokkel']], floorOnly: true },
  legStyle: { type: 'enum', label: 'Bentype', options: [['wood-taper', 'Skrå treben'], ['block', 'Klosser / føtter'], ['metal-frame', 'Metallstativ'], ['metal-thin', 'Tynne metallben']], floorOnly: true },
  legH: { type: 'number', min: 0, max: 0.6, step: 0.01, label: 'Ben-/sokkelhøyde (m)', floorOnly: true },
  doors: { type: 'number', min: 1, max: 4, step: 1, label: 'Antall glassdører' },
  doorLayout: { type: 'enum', label: 'Dørene', options: [['side-by-side', 'Ved siden av hverandre'], ['stacked', 'Over hverandre']], default: 'side-by-side' },
  doorStyle: { type: 'enum', label: 'Glassdører', options: [['glass-framed', 'Klart glass i ramme'], ['glass-full', 'Helglass uten ramme'], ['glass-ribbed', 'Riflet glass'], ['glass-smoked', 'Røykfarget glass']] },
  frameW: { type: 'number', min: 0.008, max: 0.08, step: 0.002, label: 'Rammebredde (m)', default: 0.04 },
  glassSides: { type: 'bool', label: 'Glass i sidene', default: false },
  shelves: { type: 'number', min: 0, max: 10, step: 1, label: 'Antall hyller' },
  shelfMaterial: { type: 'enum', label: 'Hyller', options: [['glass', 'Glass'], ['wood', 'Tre']] },
  bottomHeight: { type: 'number', min: 0, max: 0.8, step: 0.01, label: 'Lukket del nederst (m)' },
  drawers: { type: 'number', min: 0, max: 4, step: 1, label: 'Antall skuffer' },
  drawerPosition: { type: 'enum', label: 'Skuffene', options: [['bottom', 'Nederst'], ['middle-inside', 'I midten bak glasset']], default: 'bottom' },
  led: { type: 'bool', label: 'LED-lys inni' },
  decor: { type: 'bool', label: 'Pynt i hyllene', default: true },
  handle: { type: 'enum', label: 'Håndtak', options: [['none', 'Uten (trykk og åpne)'], ['bar', 'Stanggrep'], ['knob', 'Knott'], ['cutout', 'Innfrest grep']] },
  handleCutout: { type: 'bool', label: 'Innfrest grep i rammen', default: false },
  top: { type: 'enum', label: 'Topplate', options: [['same', 'Som korpus'], ['marble', 'Stein / keramikk']] },
  corners: { type: 'enum', label: 'Hjørner', options: [['square', 'Rette'], ['rounded', 'Avrundede']] },
};

// ---------------------------------------------------------------------------------------------------------------
// Archetypes

/**
 * Table/storage archetypes for models/registry.js (ARCHITECTURE §5): { id: Def } with Norwegian labels, the §13 parts
 * (body, front, top, legs, handle), defaults (the stub's colours/materials, plus the real room's construction where
 * an existing piece uses the archetype), the Inspector param schema and dims ranges.
 * @type {Record<string, object>}
 */
export const archetypes = {
  'coffee-table-rect': def('coffee-table-rect', {
    defaults: { dims: { w: 1.2, d: 0.6, h: 0.43 }, params: { topT: 0.03, frame: 'tube-box', tubeW: 0.02 }, ...finish('#1b1b1b', 'black-metal', '#4a4746', 'marble-dark', '#1b1b1b') },
    params: {
      ...P_TOP,
      frame: { type: 'enum', label: 'Understell', options: [['tube-box', 'Kasseramme (ramme på gulvet)'], ['legs', 'Fire ben'], ['sled', 'Medeben']] },
      tubeW: { type: 'number', min: 0.01, max: 0.05, step: 0.002, label: 'Rørdimensjon (m)' },
      overhang: { type: 'number', min: 0, max: 0.1, step: 0.005, label: 'Utstikk plate (m)', default: 0 },
    },
    dimsRange: { w: [0.6, 2.0], d: [0.4, 1.1], h: [0.3, 0.6] },
    build: buildCoffeeRect,
  }),
  'coffee-table-round-nesting': def('coffee-table-round-nesting', {
    defaults: {
      dims: { w: 1.48, d: 0.9, h: 0.45 },
      params: { topT: 0.025, frame: 'ring', legCount: 4, tables: [{ d: 0.9, h: 0.45, offset: [0.29, 0] }, { d: 0.75, h: 0.4, offset: [-0.36, 0] }] },
      ...finish('#1c1c1c', 'black-metal', '#3d332d', 'smoked-oak'),
    },
    params: {
      ...P_TOP,
      frame: { type: 'enum', label: 'Understell', options: [['ring', 'Kant og ring på gulvet'], ['legs', 'Bare ben']] },
      legCount: { type: 'number', min: 3, max: 5, step: 1, label: 'Ben per bord' },
    },
    dimsRange: { w: [0.6, 2.2], d: [0.45, 1.3], h: [0.3, 0.6] },
    build: (spec) => buildNesting(spec, { frameDefault: 'ring', legCountDefault: 4 }),
  }),
  'dining-table-oval': def('dining-table-oval', {
    defaults: {
      dims: { w: 2.0, d: 1.05, h: 0.75 },
      params: { topT: 0.03, shape: 'stadium', legs: 'a-frame', legInset: 0.4, edge: 'bevel', leaves: 2 },
      ...finish('#1c1c1c', 'black-metal', '#4b4039', 'smoked-oak'),
    },
    params: {
      ...P_TOP,
      shape: { type: 'enum', label: 'Form', options: [['stadium', 'Stadionoval'], ['oval', 'Oval'], ['round', 'Rund'], ['rect', 'Rektangulær']] },
      legs: { type: 'enum', label: 'Understell', options: [['a-frame', 'A-rammer'], ['four', 'Fire ben'], ['pedestal', 'Søyle'], ['column', 'Bred riflet søyle'], ['spider', 'Fire ben fra midten'], ['panel', 'Platebein'], ['cross', 'Kryssplater'], ['trestle', 'Bukker'], ['sled', 'Mederammer'], ['x', 'Kryssben'], ['u-frame', 'U-rammer']] },
      legStyle: { type: 'enum', label: 'Bena (fire ben)', options: [['square', 'Firkantede'], ['round-taper', 'Runde'], ['splayed', 'Skrå'], ['metal-thin', 'Tynne metallben']], default: 'square' },
      apron: { type: 'bool', label: 'Sarg under platen', default: false },
      legInset: { type: 'number', min: 0.1, max: 0.8, step: 0.01, label: 'Understell fra enden (m)' },
      edge: { type: 'enum', label: 'Kant', options: [['bevel', 'Tynn kant med skråfas'], ['straight', 'Rett kant']] },
      leaves: { type: 'number', min: 0, max: 3, step: 1, label: 'Innleggsplater' },
    },
    dimsRange: { w: [0.9, 3.2], d: [0.7, 1.3], h: [0.68, 0.8] },
    build: buildDining,
  }),
  'side-table-round': def('side-table-round', {
    defaults: { dims: { w: 0.45, d: 0.45, h: 0.5 }, params: { topT: 0.025, base: 'pedestal' }, ...finish('#4a3426', 'walnut', '#4a3426', 'walnut', '#4a3426', 'walnut') },
    params: {
      ...P_TOP,
      base: { type: 'enum', label: 'Fot', options: [['pedestal', 'Søyle med fotplate'], ['sculptural-pedestal', 'Skulpturell sokkel'], ['hourglass', 'Timeglass'], ['tripod', 'Tre ben']] },
      waistD: { type: 'number', min: 0.03, max: 0.35, step: 0.01, label: 'Smaleste diameter (m)' },
      baseD: { type: 'number', min: 0.15, max: 0.6, step: 0.01, label: 'Fotdiameter (m)' },
    },
    dimsRange: { w: [0.3, 0.8], d: [0.3, 0.8], h: [0.3, 0.75] },
    build: buildSideRound,
  }),
  'side-table-c': def('side-table-c', {
    defaults: { dims: { w: 0.43, d: 0.35, h: 0.63 }, params: { topT: 0.018, tubeW: 0.02 }, ...finish('#1a1a1a', 'black-metal', '#2a2724', 'black-oak', '#1a1a1a') },
    params: { ...P_TOP, tubeW: { type: 'number', min: 0.012, max: 0.035, step: 0.001, label: 'Rørdimensjon (m)' } },
    dimsRange: { w: [0.3, 0.7], d: [0.25, 0.6], h: [0.45, 0.75] },
    build: buildSideC,
  }),
  'side-table-nesting': def('side-table-nesting', {
    defaults: {
      dims: { w: 0.49, d: 0.49, h: 0.52 },
      params: { topT: 0.018, frame: 'legs', legCount: 3, tables: [{ d: 0.49, h: 0.52 }, { d: 0.47, h: 0.31 }] },
      ...finish('#1e1e1e', 'black-metal', '#5a4232', 'walnut'),
    },
    params: {
      ...P_TOP,
      frame: { type: 'enum', label: 'Understell', options: [['legs', 'Tynne ben'], ['ring', 'Kant og ring på gulvet']] },
      legCount: { type: 'number', min: 3, max: 4, step: 1, label: 'Ben per bord' },
    },
    dimsRange: { w: [0.3, 0.8], d: [0.3, 0.8], h: [0.3, 0.7] },
    build: (spec) => buildNesting(spec, { frameDefault: 'legs', legCountDefault: 3 }),
  }),
  'coffee-table': def('coffee-table', {
    defaults: {
      dims: { w: 1.2, d: 0.6, h: 0.42 },
      params: { shape: 'rect', cornerR: 0.03, edge: 'straight', topT: 0.03, base: 'legs', legStyle: 'square', legCount: 4, legInset: 0.05, legD: 0.045, apron: false, shelf: 'none', shelfH: 0.12, drawers: 0, handle: 'none', baseInset: 0.1, tray: false },
      ...finish('#b08a62', 'oak', '#b08a62', 'oak', '#b08a62', 'oak'),
    },
    // hidden (products): seed, softness, waterfall, tubeW, frameFloor, ribPitch, ribDepth, plinthH, drumTaper,
    // drumDrawers, apronH, drawersBack, hubH (spider), set [{ w, d, h, dx, dz, shape?, seed?, dent?, dentAt? }], fronts,
    // frontStyle, slidingDoors, cabinetLegH, cabinetLegStyle, dent / dentAt (organic: a concave notch, plan angle),
    // vDepth (stone V), crossL (cross: slab length), trayH (tray rim height)
    params: {
      ...P_TOP,
      shape: { type: 'enum', label: 'Form', options: [['rect', 'Rektangulær'], ['rounded', 'Avrundede hjørner'], ['soft', 'Myk firkant'], ['round', 'Rund'], ['oval', 'Oval'], ['stadium', 'Stadionoval'], ['organic', 'Organisk (dråpe)']] },
      cornerR: { type: 'number', min: 0.005, max: 0.3, step: 0.005, label: 'Hjørneradius (m)' },
      edge: { type: 'enum', label: 'Kant', options: [['straight', 'Rett kant'], ['bevel', 'Tynn kant med skråfas'], ['rounded', 'Avrundet kant']] },
      base: {
        type: 'enum', label: 'Understell',
        options: [['legs', 'Ben'], ['pedestal', 'Søyle med fot'], ['drum', 'Sokkel (massiv)'], ['ribbed', 'Riflet sokkel'], ['panel', 'Platebein (gavler)'], ['frame', 'Metallramme'], ['sled', 'Mederammer'], ['x', 'Kryssben'], ['v', 'V-understell'], ['cross', 'Kryss av plater'], ['spider', 'Fire ben fra midten'], ['cabinet', 'Skap/hyller under platen']],
      },
      legStyle: { type: 'enum', label: 'Ben', options: [['square', 'Firkantede'], ['round-taper', 'Runde, smalnende'], ['splayed', 'Skrå (utoverlente)'], ['angled', 'Vinklede'], ['block', 'Kraftige klosser'], ['metal-thin', 'Tynne metallben'], ['hairpin', 'Hårnålsben']] },
      legCount: { type: 'number', min: 3, max: 4, step: 1, label: 'Antall ben' },
      legInset: { type: 'number', min: 0, max: 0.4, step: 0.01, label: 'Ben/understell fra kanten (m)' },
      legD: { type: 'number', min: 0.01, max: 0.12, step: 0.002, label: 'Bentykkelse (m)' },
      apron: { type: 'bool', label: 'Sarg under platen' },
      shelf: { type: 'enum', label: 'Hylle under', options: [['none', 'Ingen'], ['board', 'Hylleplate'], ['slats', 'Spilehylle'], ['cane', 'Flettet'], ['glass', 'Glass']] },
      shelfH: { type: 'number', min: 0.04, max: 0.35, step: 0.01, label: 'Hyllehøyde (m)' },
      drawers: { type: 'number', min: 0, max: 4, step: 1, label: 'Skuffer i sargen' },
      handle: { type: 'enum', label: 'Håndtak', options: [['none', 'Uten'], ['knob', 'Knott'], ['bar', 'Stanggrep'], ['cutout', 'Innfrest grep']] },
      baseInset: { type: 'number', min: 0, max: 0.4, step: 0.01, label: 'Sokkel inntrukket (m)' },
      tray: { type: 'bool', label: 'Opphøyd kant (brett)' },
    },
    dimsRange: { w: [0.3, 2.0], d: [0.3, 1.3], h: [0.25, 0.85] },
    build: buildCoffeeTable,
  }),
  sideboard: def('sideboard', {
    defaults: {
      dims: { w: 1.8, d: 0.45, h: 0.76 },
      params: { base: 'legs', legH: 0.2, legStyle: 'metal-thin', topT: 0.025, fronts: ['door', 'door', 'door'], frontStyle: 'flat', handle: 'bar', top: 'same', corners: 'square' },
      ...finish('#74563c', 'smoked-oak', '#6e5139', 'smoked-oak'),
    },
    params: P_CABINET,
    dimsRange: { w: [0.8, 2.6], d: [0.3, 0.6], h: [0.4, 1.1] },
    build: (spec) => buildCabinet(spec, 'sideboard'),
  }),
  'tv-bench': def('tv-bench', {
    defaults: {
      dims: { w: 1.8, d: 0.42, h: 0.45 },
      params: { base: 'legs', legH: 0.08, legStyle: 'block', topT: 0.02, fronts: ['door', 'open', 'door'], frontStyle: 'ribbed', handle: 'none', top: 'same', corners: 'square' },
      ...finish('#2b2623', 'black-oak', '#2b2623', 'black-oak', '#2b2623', 'black-oak'),
    },
    params: P_CABINET,
    // h from 0.22: the wall-hung Vision is 23 cm tall
    dimsRange: { w: [0.9, 2.8], d: [0.3, 0.55], h: [0.22, 0.65] },
    build: (spec) => buildCabinet(spec, 'tv-bench'),
  }),
  'display-cabinet': def('display-cabinet', {
    info: { family: 'table', mount: 'floor', label: 'Vitrineskap' },
    defaults: {
      dims: { w: 0.9, d: 0.4, h: 1.8 },
      params: {
        base: 'legs', legH: 0.22, legStyle: 'wood-taper', doors: 2, doorLayout: 'side-by-side', doorStyle: 'glass-framed', glassSides: false,
        shelves: 3, shelfMaterial: 'glass', drawers: 0, bottomHeight: 0, drawerPosition: 'bottom', led: true, decor: true, handle: 'bar',
        handleCutout: false, top: 'same', corners: 'square',
      },
      colors: { body: '#5b4232', front: '#5e4535', top: '#5b4232', legs: '#4c372a', handle: '#1c1c1c' },
      materials: { body: 'smoked-oak', front: 'smoked-oak', top: 'smoked-oak', legs: 'smoked-oak', handle: 'black-metal' },
    },
    params: P_DISPLAY,
    dimsRange: { w: [0.4, 2.0], d: [0.28, 0.6], h: [0.4, 2.3] },
    build: buildDisplayCabinet,
  }),
  'wall-shelf': def('wall-shelf', {
    defaults: { dims: { w: 1.2, d: 0.2, h: 0.5 }, params: { style: 'grid', boardDepth: 0.19, barW: 0.015, ...GRID_DEFAULT }, ...finish('#1e1e1e', 'black-metal', '#1e1e1e', 'black-metal') },
    params: {
      style: { type: 'enum', label: 'Type', options: [['grid', 'Rutenett i metall'], ['simple', 'Enkle hyller'], ['box', 'Hyllemodul med rom']] },
      shelves: { type: 'number', min: 1, max: 6, step: 1, label: 'Antall hyller (enkle)', default: 3 },
      cols: { type: 'number', min: 1, max: 6, step: 1, label: 'Kolonner (modul)', default: 3 },
      rows: { type: 'number', min: 1, max: 5, step: 1, label: 'Rader (modul)', default: 2 },
      brackets: { type: 'enum', label: 'Oppheng (enkle)', options: [['none', 'Skjult'], ['straps', 'Lærstropper'], ['battens', 'Lister bak'], ['brackets', 'Konsoller']], default: 'none' },
      barW: { type: 'number', min: 0.008, max: 0.03, step: 0.001, label: 'Stangbredde (m)' },
    },
    // h from 0.04: a single board (IKEA LACK vegghylle 110x26 is 0.05 thick) must not be clamped to 0.10
    // d from 0.10: Bjørvik is 11 cm deep
    dimsRange: { w: [0.4, 2.4], d: [0.1, 0.35], h: [0.04, 1.6] },
    build: buildWallShelf,
  }),
};

// Helpers for desks.js and the other model files (design/furniture.md §1.1); the table helpers tableOutline, tableTop,
// legAnchors, legMats, styledLeg, drawerHandle, herringboneGeometry, ribPanelGeometry, recolorer and buildCabinet
// are exported where they are defined.
export { qSeg, tone, pm, add, darkInside, roundRectPts, stadiumPts, ellipsePts, clipHalf, dedupe, planSlab, barYZ, splayedLeg, finish, P_TOP, diningOutline, chamferGeometry, smoothProfile, ribbedColumn, strut };
