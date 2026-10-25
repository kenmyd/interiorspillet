// Spots and downlights – the «Spotter og downlights» category (design/lighting.md §1–§2, MASTER §2.2/§2.3/§2.5):
// downlight, downlight-surface, spot-ceiling, spot-track, spot-wall, picture-light.
import * as THREE from 'three';
import schema from '../data/archetypes.json';
import * as K from './kit.js';
import { mat } from '../home/materials.js';
import { layout as roomLayout } from '../home/layout.js';
import { Lamp, def, look, EMBED, num, clamp, discGeo, rod, xf, bezier, lightDecalMaterial } from './lamps.js';
import { GRID_PARAMS, gridOf, gridCells } from '../design/grid.js';

/**
 * Spots and downlights – `archetypes` for models/registry.js. Built on lamps.js' `Lamp` (materials, glow, finish).
 *
 * Origins: ceiling fittings hang from the ceiling plane at the item's centre along −y; wall fittings have their back in
 * z = 0, the vertical middle of dims.h at y = 0 and the front toward +z. Tilt is measured from straight down
 * (0° = «rett ned») toward the item's front; aimDir(t, yaw) = (sin t·sin yaw, −cos t, sin t·cos yaw).
 *
 * Grids (downlight, downlight-surface, spot-ceiling): one item = gridRows × gridCols identical fittings
 * (design/grid.js); dims hold the whole extent, gridOf() the size of one fitting. Every head is one honest spot light
 * in userData.model.lights (lumens = the fixture's / heads per fixture); the LightManager pools them (cluster
 * 'downlight' / 'fixture', MASTER §2.5).
 *
 * Ceiling fittings follow a sloping ceiling head by head through a HeadSet: each part is ONE mesh for all heads (draw
 * calls do not grow with the count), rewritten in place only when a head's height or slope changes; the heads' lights
 * move with them (positions/directions mutated in place – SceneSync reads them right after updateMatrixWorld).
 * Fixed recessed fittings aim along the ceiling normal (MASTER D6), aimable heads are plumb-referenced.
 *
 * Every mesh has userData.noShadow; recessed trims carry userData.trim; glow materials shared by n heads carry
 * material.userData.emitters = n; lights[0].emissiveMeshes lists every lens/reflector/diffuser and the picture light's
 * wash on the wall (a light decal, shown only while the fitting hangs on a house wall). userData.model.thumbView is
 * 'below' (downlights: the catalogue shoots them from below against a ceiling plate) or 'under'.
 *
 * Picture lights light the picture with that wash (budget-free, the same whether the fitting holds a light slot or
 * not); their one spot light is the light the lit picture gives back to the room (a wide cone out of the wall, a little
 * down, never onto the canvas).
 *
 * Hidden params (data only, no Inspector control): downlight lensShape 'round'|'square' (a square trim round a round
 * opening by default); downlight-surface plateD / plateH (a ceiling cup narrower than the can); spot-track canopyD /
 * canopyH (a round cup in the middle, the rail canopyH under the ceiling), barShape 'round'|'flat', railW / railH (the
 * rail's section), stemLen (0 = the knuckle right under the adapter); spot-wall plateD; picture-light armGap (two arms
 * on one central plate), washW, artDepth.
 */

const DEG = Math.PI / 180;
const UP = new THREE.Vector3(0, 1, 0);
const DOWN = new THREE.Vector3(0, -1, 0);
/** Recessed trims reach this far up into the ceiling (they follow the slope head by head, so a lip is enough). */
const TRIM_EMBED = 0.004;
/** The lens plane of a recessed downlight (local y): just under the ceiling. */
const LENS_Y = -0.0015;
/** Aimed parts never reach further than this above their ceiling point (above the ceiling nothing is visible). */
const AIM_CAP = 0.006;
/** Steepest ceiling slope a fitting follows (as lamps.js followCeiling: steeper one-sided steps are bulkheads). */
const MAX_SLOPE = 0.47;
const I3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
/**
 * A picture light's wash: nominal luminance per lumen over its area (lighting.md §2.4 proposed 0.22; × 16 by screenshot
 * – the decal brightens what is behind it by a share of this, and 0.22 barely showed at 22:00).
 */
const WASH_NITS = 3.5;
/**
 * Cone (half angle, rad) of a picture light's room spot, from its beamDeg: the axis leans out from straight down by the
 * same angle, so the wall-side edge runs along the wall. 1.0 (default beam): the axis 33° under the horizontal, the
 * top edge 25° over it (1.3 lit the ceiling in front of the picture brighter than the picture – tuning).
 */
const PICTURE_SPOT_MIN = 0.9;
const PICTURE_SPOT_MAX = 1.0;

const pick = (v, options, fb) => (options.includes(v) ? v : fb);
const linLum = (hex) => {
  const c = new THREE.Color(hex);
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
};
const smooth = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};
/** A beam angle (full, degrees) as a three.js cone: the soft edge's 50 % point at the half beam (lighting.md §1.2). */
const beamAngle = (beamDeg, penumbra) => clamp(((clamp(num(beamDeg, 36), 10, 120) / 2) * DEG) / (1 - penumbra / 2), 0.15, 1.45);

/** Rot_y(yaw) · Rot_x(−tilt): turns −y toward +z by tilt, then about y by yaw (= aimDir). */
const _qa = new THREE.Quaternion(), _qb = new THREE.Quaternion();
function aimQuat(tilt, yaw, out = new THREE.Quaternion()) {
  _qa.setFromAxisAngle(new THREE.Vector3(1, 0, 0), -tilt);
  _qb.setFromAxisAngle(UP, yaw);
  return out.copy(_qb).multiply(_qa);
}
/** Unit aim direction from tilt (from straight down) and yaw (0 = local +z). */
export function aimDir(tilt, yaw) {
  return [Math.sin(tilt) * Math.sin(yaw), -Math.cos(tilt), Math.sin(tilt) * Math.cos(yaw)];
}
/** Quaternion turning +y onto the normal of a ceiling plane y = su·x + sv·z (lamps.js followCeiling). */
const _n = new THREE.Vector3();
function slopeQuat(su, sv, out = new THREE.Quaternion()) {
  if (!su && !sv) return out.identity();
  return out.setFromUnitVectors(UP, _n.set(-su, 1, -sv).normalize());
}
const _m4 = new THREE.Matrix4();
/** 3 × 3 rotation (column-major) of a quaternion. */
function rot3(q) {
  const e = _m4.makeRotationFromQuaternion(q).elements;
  return [e[0], e[1], e[2], e[4], e[5], e[6], e[8], e[9], e[10]];
}

/** One indexed geometry (position, normal, uv) from several. */
function joinGeos(list) {
  const geos = list.filter(Boolean);
  if (geos.length === 1 && geos[0].index && geos[0].attributes.normal && geos[0].attributes.uv) return geos[0];
  let nv = 0, ni = 0;
  for (const g of geos) {
    if (!g.attributes.normal) g.computeVertexNormals();
    nv += g.attributes.position.count;
    ni += g.index ? g.index.count : g.attributes.position.count;
  }
  const pos = new Float32Array(nv * 3), nrm = new Float32Array(nv * 3), uv = new Float32Array(nv * 2);
  const idx = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
  let ov = 0, oi = 0;
  for (const g of geos) {
    const c = g.attributes.position.count;
    for (let i = 0; i < c; i++) {
      pos[(ov + i) * 3] = g.attributes.position.getX(i);
      pos[(ov + i) * 3 + 1] = g.attributes.position.getY(i);
      pos[(ov + i) * 3 + 2] = g.attributes.position.getZ(i);
      nrm[(ov + i) * 3] = g.attributes.normal.getX(i);
      nrm[(ov + i) * 3 + 1] = g.attributes.normal.getY(i);
      nrm[(ov + i) * 3 + 2] = g.attributes.normal.getZ(i);
      if (g.attributes.uv) {
        uv[(ov + i) * 2] = g.attributes.uv.getX(i);
        uv[(ov + i) * 2 + 1] = g.attributes.uv.getY(i);
      }
    }
    if (g.index) for (let k = 0; k < g.index.count; k++) idx[oi + k] = g.index.getX(k) + ov;
    else for (let k = 0; k < c; k++) idx[oi + k] = ov + k;
    oi += g.index ? g.index.count : c;
    ov += c;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  return out;
}

/**
 * Round → rounded square («firkantet»): radial squircle scaling about y, normals re-smoothed with crisp 50° edges.
 * minR: vertices with r ≤ minR stay round (a square trim round a round opening).
 */
function squareUp(geo, { minR = 0 } = {}) {
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    if (Math.abs(x) + Math.abs(z) < 1e-9) continue;
    if (minR > 0 && Math.hypot(x, z) <= minR) continue;
    const a = Math.atan2(z, x);
    const f = 1 / (Math.abs(Math.cos(a)) ** 8 + Math.abs(Math.sin(a)) ** 8) ** (1 / 8);
    pos.setXYZ(i, x * f, pos.getY(i), z * f);
  }
  pos.needsUpdate = true;
  return K.smoothNormals(geo, 1e4, 50);
}

/** A disc facing −y at height y (radius r). */
const discDown = (r, seg, y) => new THREE.CircleGeometry(r, seg).rotateX(Math.PI / 2).translate(0, y, 0);
/** An annulus facing −y at height y. */
const ringDown = (r0, r1, seg, y) => new THREE.RingGeometry(r0, r1, seg).rotateX(Math.PI / 2).translate(0, y, 0);

// ---------------------------------------------------------------------------------------------------------------
// The slope: HeadSet (lighting.md §2.2)

/**
 * The room's ceiling over (x, z) on the level of a fitting hanging at world y: { h (world y), slope: [dh/dx, dh/dz] }
 * or null (lamps.js ceilingAt without the «is the origin on it» test – the caller does that once). One-sided slopes,
 * the gentler side wins, so a bulkhead edge stays a step.
 */
function ceilingSample(x, y, z) {
  const hc = roomLayout?.ceilingHeightAt;
  if (typeof hc !== 'function') return null;
  const yq = y - 0.5;
  const h = (px, pz) => hc(px, pz, yq);
  const h0 = h(x, z);
  if (!Number.isFinite(h0)) return null;
  const e = 0.1;
  const side = (a, b) => {
    const s = Math.abs(a) <= Math.abs(b) ? a : b;
    return Number.isFinite(s) && Math.abs(s) <= MAX_SLOPE && Math.abs(s) > 1e-4 ? s : 0;
  };
  return { h: h0, slope: [side((h(x + e, z) - h0) / e, (h0 - h(x - e, z)) / e), side((h(x, z + e) - h0) / e, (h0 - h(x, z - e)) / e)] };
}

const qz = (v, s) => Math.round(v / s) * s;

/**
 * Fittings with several heads (a grid of downlights, the spots of a track) follow the ceiling head by head: each part
 * is ONE mesh for all heads whose vertices are rewritten in place when a head's height or slope changes – not when the
 * fitting only moves along a plane ceiling. The heads' lights move with them.
 *
 * Part modes: 'slope' (flush with the ceiling: trims, canopies, plates, rails, adapters – turned onto the local
 * slope), 'plumb' (stems: translated, never turned), 'aim' (cans, lenses: turned by the head's aim about its pivot;
 * on a fixed head they take the slope instead). perHead false = one copy for the whole fitting at its centre (a
 * track's rail: sample 'centre' makes the whole fitting rigid).
 */
class HeadSet {
  /** @param {Lamp} L  @param {{ sample?: 'head'|'centre' }} [o] */
  constructor(L, { sample = 'head' } = {}) {
    this.L = L;
    this.sample = sample;
    this.heads = [];
    this.parts = [];
    this.glowMeshes = [];
  }

  /**
   * @param {{ u?: number, v?: number, pivot?: number[], yaw?: number, tilt?: number, fixed?: boolean, lens?: number[],
   *           minY?: number|null, light?: object|null }} h  u, v: the head's offset from the item centre (local x, z);
   *   pivot: from the head's ceiling point (plumb frame); lens: the light's point from the pivot (aim frame, or slope
   *   frame when fixed); minY: the light stays at least this far under the ceiling plane (tiltable recessed lenses)
   */
  addHead({ u = 0, v = 0, pivot = [0, 0, 0], yaw = 0, tilt = 0, fixed = false, lens = [0, -0.004, 0], minY = null, light = null } = {}) {
    const h = { u, v, pivot: new THREE.Vector3(...pivot), yaw, tilt, fixed, lens: new THREE.Vector3(...lens), minY, light, A: aimQuat(tilt, yaw) };
    h.R = rot3(h.A);
    this.heads.push(h);
    return h;
  }

  /** Template part (geometry in its own frame – the head's, or the pivot's for 'aim'). */
  addPart(geos, material, part, { mode = 'slope', glow = false, perHead = true, trim = false, name } = {}) {
    const geo = joinGeos([].concat(geos));
    this.parts.push({ geo, material, part, mode, glow, perHead, trim, name });
  }

  /**
   * One mesh per MATERIAL (noMerge, part tags, noShadow, plain raycast so Selection skips its cached BVH), baked flat:
   * parts that share a material (the trim and the gimbal ring, a rail and its cans in one colour, an adapter and its
   * stem) are segments of one mesh – each keeps its own mode – so a fitting costs one draw call per material, not per
   * part (QA §5.2). userData.parts lists every part a merged mesh holds (finishSpot puts it under each in
   * model.parts; lamps rebuild on a recolour, so one material per mesh is all a recolour needs).
   */
  build() {
    const nh = this.heads.length;
    const groups = new Map();
    for (const p of this.parts) {
      const key = `${p.material.uuid}|${p.glow ? 1 : 0}|${p.trim ? 1 : 0}`;
      let gr = groups.get(key);
      if (!gr) groups.set(key, (gr = { material: p.material, glow: p.glow, trim: p.trim, segs: [] }));
      gr.segs.push(p);
    }
    this.groups = [];
    for (const gr of groups.values()) {
      let nv = 0, ni = 0;
      for (const p of gr.segs) {
        const src = p.geo;
        p.count = src.attributes.position.count;
        p.n = p.perHead ? nh : 1;
        p.v0 = nv;
        nv += p.count * p.n;
        ni += src.index.count * p.n;
      }
      const uv = new Float32Array(nv * 2);
      const idx = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
      let oi = 0;
      for (const p of gr.segs) {
        const src = p.geo, cnt = p.count;
        p.pos0 = Float32Array.from(src.attributes.position.array);
        p.nrm0 = Float32Array.from(src.attributes.normal.array);
        const uv0 = src.attributes.uv.array, i0 = src.index.array;
        for (let k = 0; k < p.n; k++) {
          const base = p.v0 + k * cnt;
          uv.set(uv0, base * 2);
          for (let i = 0; i < i0.length; i++) idx[oi++] = i0[i] + base;
        }
        src.dispose();
        p.geo = null;
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(nv * 3), 3));
      g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(nv * 3), 3));
      g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      g.setIndex(new THREE.BufferAttribute(idx, 1));
      const tags = [...new Set(gr.segs.map((p) => p.part).filter(Boolean))];
      const name = gr.segs.find((p) => p.name === 'lens')?.name ?? gr.segs.find((p) => p.name)?.name;
      const mesh = K.partMesh(g, gr.material, tags[0] ?? null, { name, noMerge: true });
      if (tags.length > 1) mesh.userData.parts = tags;
      mesh.userData.noShadow = true;
      if (gr.trim) mesh.userData.trim = true;
      // rewritten in place: three's own raycast (Selection uses a cached BVH only for the stock raycast)
      mesh.raycast = function raycast(r, out) {
        THREE.Mesh.prototype.raycast.call(this, r, out);
      };
      if (gr.glow) this.glowMeshes.push(mesh);
      gr.mesh = mesh;
      this.groups.push(gr);
      this.L.g.add(mesh);
    }
    this.flat = { centre: { su: 0, sv: 0 }, heads: this.heads.map(() => ({ dy: 0, su: 0, sv: 0 })) };
    this.bake(this.flat);
  }

  /** Rewrites every part's vertices and every head's light for the samples ({ centre, heads: [{ dy, su, sv }] }). */
  bake(S) {
    const centre = slopeQuat(S.centre.su, S.centre.sv);
    const Rc = rot3(centre);
    const T = this.heads.map((h, i) => {
      const s = this.sample === 'centre' ? { dy: 0, ...S.centre } : S.heads[i];
      const Q = this.sample === 'centre' ? centre.clone() : slopeQuat(s.su, s.sv);
      const B = this.sample === 'centre' ? new THREE.Vector3(h.u, 0, h.v).applyQuaternion(Q) : new THREE.Vector3(h.u, s.dy, h.v);
      return { B, Q, R: rot3(Q), su: s.su, sv: s.sv };
    });
    for (const gr of this.groups) {
      const geo = gr.mesh.geometry;
      const P = geo.attributes.position.array, N = geo.attributes.normal.array;
      for (const p of gr.segs) this.bakeSeg(p, T, Rc, P, N);
      geo.attributes.position.needsUpdate = true;
      geo.attributes.normal.needsUpdate = true;
      geo.computeBoundingBox();
      geo.computeBoundingSphere();
    }
    const v = new THREE.Vector3(), d = new THREE.Vector3();
    this.heads.forEach((h, k) => {
      const l = h.light;
      if (!l) return;
      const t = T[k];
      if (h.fixed) {
        v.copy(h.pivot).add(h.lens).applyQuaternion(t.Q).add(t.B);
        d.copy(DOWN).applyQuaternion(t.Q);
      } else {
        v.copy(h.lens).applyQuaternion(h.A).add(h.pivot);
        if (h.minY != null) v.y = Math.min(v.y, t.su * v.x + t.sv * v.z + h.minY);
        v.add(t.B);
        d.copy(DOWN).applyQuaternion(h.A);
      }
      l.position[0] = v.x;
      l.position[1] = v.y;
      l.position[2] = v.z;
      l.direction[0] = d.x;
      l.direction[1] = d.y;
      l.direction[2] = d.z;
    });
  }

  /** Writes one segment's vertices (all its copies) into its mesh's buffers. */
  bakeSeg(p, T, Rc, P, N) {
    const src = p.pos0, srcN = p.nrm0, cnt = p.count;
    for (let k = 0; k < p.n; k++) {
      let R = Rc, tx = 0, ty = 0, tz = 0, cap = null;
      if (p.perHead) {
        const h = this.heads[k], t = T[k];
        tx = t.B.x;
        ty = t.B.y;
        tz = t.B.z;
        if (p.mode === 'slope') R = t.R;
        else if (p.mode === 'plumb') R = I3;
        else if (h.fixed) {
          R = t.R;
          const pv = h.pivot.clone().applyQuaternion(t.Q);
          tx += pv.x;
          ty += pv.y;
          tz += pv.z;
        } else {
          R = h.R;
          tx += h.pivot.x;
          ty += h.pivot.y;
          tz += h.pivot.z;
          cap = t;
        }
      }
      const o = (p.v0 + k * cnt) * 3;
      for (let i = 0; i < cnt; i++) {
        const j = i * 3;
        const x = src[j], y = src[j + 1], z = src[j + 2];
        const X = R[0] * x + R[3] * y + R[6] * z + tx;
        let Y = R[1] * x + R[4] * y + R[7] * z + ty;
        const Z = R[2] * x + R[5] * y + R[8] * z + tz;
        if (cap) {
          // above the head's ceiling plane nothing shows: a tilted lens rim is pressed flat there
          const lim = cap.B.y + cap.su * (X - cap.B.x) + cap.sv * (Z - cap.B.z) + AIM_CAP;
          if (Y > lim) Y = lim;
        }
        P[o + j] = X;
        P[o + j + 1] = Y;
        P[o + j + 2] = Z;
        const nx = srcN[j], ny = srcN[j + 1], nz = srcN[j + 2];
        N[o + j] = R[0] * nx + R[3] * ny + R[6] * nz;
        N[o + j + 1] = R[1] * nx + R[4] * ny + R[7] * nz;
        N[o + j + 2] = R[2] * nx + R[5] * ny + R[8] * nz;
      }
    }
  }

  /** The ceiling under the heads for a world matrix (flat when the origin is not on a room's ceiling). */
  sampleAt(e) {
    const c0 = ceilingSample(e[12], e[13], e[14]);
    // galleries, thumbnails, Placement before the first aim: the origin is not on the ceiling → everything flat
    if (!c0 || Math.abs(c0.h - e[13]) > 0.03) return this.flat;
    const lx = Math.hypot(e[0], e[2]) || 1, lz = Math.hypot(e[8], e[10]) || 1;
    const local = (s) => ({ su: (s[0] * e[0] + s[1] * e[2]) / lx, sv: (s[0] * e[8] + s[1] * e[10]) / lz });
    const centre = local(c0.slope);
    if (this.sample === 'centre') return { centre, heads: this.heads.map(() => ({ dy: 0, ...centre })) };
    const heads = this.heads.map((h) => {
      const wx = e[12] + e[0] * h.u + e[8] * h.v, wz = e[14] + e[2] * h.u + e[10] * h.v;
      const c = ceilingSample(wx, e[13], wz);
      // over a stairwell / off the room: that head stays level
      if (!c || Math.abs(c.h - e[13]) > 0.6) return { dy: 0, su: 0, sv: 0 };
      return { dy: c.h - e[13], ...local(c.slope) };
    });
    return { centre, heads };
  }

  /** Wraps the root's updateMatrixWorld (chains a previous override): re-bakes when the ceiling under a head changes. */
  install() {
    const g = this.L.g;
    const hs = this;
    const prev = g.updateMatrixWorld;
    let last = null;
    let lastKey = hs.keyOf(hs.flat);
    g.userData.model.ceilingTilt = { su: 0, sv: 0 };
    g.updateMatrixWorld = function updateMatrixWorld(force) {
      prev.call(this, force);
      const e = this.matrixWorld.elements;
      if (last && last[0] === e[12] && last[1] === e[13] && last[2] === e[14] && last[3] === e[0] && last[4] === e[2] && last[5] === e[8] && last[6] === e[10]) return;
      last = [e[12], e[13], e[14], e[0], e[2], e[8], e[10]];
      const raw = hs.sampleAt(e);
      // dy to 0.5 mm, slopes to 1e-4: a move along a plane ceiling changes nothing
      const S = {
        centre: { su: qz(raw.centre.su, 1e-4), sv: qz(raw.centre.sv, 1e-4) },
        heads: raw.heads.map((s) => ({ dy: qz(s.dy, 0.0005), su: qz(s.su, 1e-4), sv: qz(s.sv, 1e-4) })),
      };
      const key = hs.keyOf(S);
      if (key === lastKey) return;
      lastKey = key;
      hs.bake(S);
      if (this.userData.model) this.userData.model.ceilingTilt = { su: S.centre.su, sv: S.centre.sv };
    };
  }

  keyOf(S) {
    let k = `${S.centre.su},${S.centre.sv}`;
    for (const s of S.heads) k += `|${s.dy},${s.su},${s.sv}`;
    return k;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Light decals on the wall (picture light): shown only while the fitting hangs on a house wall

/**
 * Hides the wall decals unless the origin lies on a house wall face (in its plane, within its length, above its floor,
 * facing out of it) and the model is not Placement's ghost – no wash in the gallery, the thumbnails or mid-air.
 */
function followDecals(g, decals) {
  if (!decals.length) return;
  const prev = g.updateMatrixWorld;
  let last = null;
  g.updateMatrixWorld = function updateMatrixWorld(force) {
    prev.call(this, force);
    const e = this.matrixWorld.elements;
    const ghost = !!this.userData.ghost;
    if (last && last[0] === e[12] && last[1] === e[13] && last[2] === e[14] && last[3] === e[8] && last[4] === e[10] && last[5] === ghost) return;
    last = [e[12], e[13], e[14], e[8], e[10], ghost];
    const on = !ghost && onHouseWall(e);
    for (const d of decals) d.visible = on;
  };
}

function onHouseWall(e) {
  const walls = roomLayout?.house?.walls || roomLayout?.walls;
  if (!Array.isArray(walls)) return false;
  const x = e[12], y = e[13], z = e[14];
  const lz = Math.hypot(e[8], e[10]) || 1;
  const fx = e[8] / lz, fz = e[10] / lz;
  for (const w of walls) {
    if (!w?.start || !w.normal) continue;
    const px = x - w.start.x, pz = z - w.start.y;
    if (Math.abs(px * w.normal.x + pz * w.normal.y) >= 0.02) continue;
    const u = px * w.dir.x + pz * w.dir.y;
    if (u < 0 || u > w.length) continue;
    if (y <= (w.floorY || 0) + 0.2) continue;
    if (fx * w.normal.x + fz * w.normal.y > 0.9) return true;
  }
  return false;
}

/** The picture light's wash: bright under the bar, fading toward the bottom, soft at the sides (lighting.md §2.4). */
let _washTex = null;
function washTexture() {
  if (_washTex) return _washTex;
  const n = 64;
  const data = new Uint8Array(n * n * 4);
  for (let j = 0; j < n; j++) {
    const t = 1 - (j + 0.5) / n; // 0 at the top edge (v = 1), 1 at the bottom
    const top = t < 0.08 ? smooth(0, 0.08, t) : (1 - (t - 0.08) / 0.92) ** 1.6;
    for (let i = 0; i < n; i++) {
      const s = (i + 0.5) / n;
      const v = Math.round(255 * top * smooth(0, 0.18, s) * smooth(1, 0.82, s));
      data.set([v, v, v, 255], (j * n + i) * 4);
    }
  }
  _washTex = new THREE.DataTexture(data, n, n, THREE.RGBAFormat);
  _washTex.colorSpace = THREE.NoColorSpace;
  _washTex.magFilter = THREE.LinearFilter;
  _washTex.minFilter = THREE.LinearFilter;
  _washTex.needsUpdate = true;
  _washTex.userData.shared = true;
  return _washTex;
}

// ---------------------------------------------------------------------------------------------------------------
// Shared pieces

/**
 * A spot's can in its aim frame (pivot at the origin, the beam along −y): [{ geo, material, part, glow }] and the
 * front's y. Shapes: cylinder, cone (narrow at the back), dome (half sphere + short tube), cube.
 */
function canParts(L, { shape = 'cylinder', D = 0.06, len = 0.1, seg = 16 } = {}) {
  const r = D / 2, y0 = -0.004, y1 = -len;
  const ri = Math.max(r * 0.55, r - Math.max(0.0025, r * 0.09));
  const rl = ri * 0.72;
  const out = [];
  if (shape === 'cube') {
    const H = len - 0.004;
    out.push({ geo: K.roundedBox(D, H, D, Math.min(0.006, D * 0.12), 2).translate(0, (y0 + y1) / 2, 0), material: L.mat('shade'), part: 'shade' });
    out.push({ geo: ringDown(rl, ri, seg, y1 - 0.0004), material: L.mat('inner'), part: 'inner' });
    out.push({ geo: discDown(rl, seg, y1 - 0.0006), material: L.bulbMat(3.2), part: null, glow: true });
    return { parts: out, front: y1 - 0.0006 };
  }
  const e = Math.min(0.004, r * 0.3);
  let prof;
  if (shape === 'cone') {
    const rb = r * 0.5;
    prof = [[ri, y1], [r, y1], [rb, y0 - e], [rb - e * 0.6, y0], [0.0005, y0]];
  } else if (shape === 'dome') {
    const dh = Math.min(r, (len - 0.004) * 0.6);
    const ym = y0 - dh;
    prof = [[ri, y1], [r, y1], [r, ym]];
    for (let k = 1; k <= 6; k++) {
      const a = (k / 6) * (Math.PI / 2);
      prof.push([Math.max(0.0005, r * Math.cos(a)), ym + dh * Math.sin(a)]);
    }
  } else {
    prof = [[ri, y1], [r, y1], [r, y0 - e], [r - e * 0.3, y0 - e * 0.3], [r - e, y0], [0.0005, y0]];
  }
  out.push({ geo: K.lathe(prof, { seg }), material: L.mat('shade'), part: 'shade' });
  // the reflector inside the open front, the lens recessed in it
  const recess = Math.min(0.014, len * 0.22);
  const yl = y1 + recess;
  out.push({ geo: K.lathe([[rl, yl], [ri, y1]], { seg }), material: L.mat('inner'), part: 'inner' });
  out.push({ geo: discDown(rl, seg, yl - 0.0002), material: L.bulbMat(3.2), part: null, glow: true });
  return { parts: out, front: y1 };
}

/** Light entry of a head (local; position/direction mutated by the HeadSet). */
function headLight(L, lumens, angle, penumbra, cluster, fitting) {
  const l = K.spotLight([0, -0.01, 0], [0, -1, 0], { angle, penumbra, lumens, colorK: L.colorK });
  if (cluster) l.cluster = cluster;
  l.fitting = fitting;
  return l;
}

/**
 * Lamp.finish merges per material AND part; a fitting's plate, arm and head are often one material (a white wall
 * spot): those meshes become one (userData.parts lists the parts) – a draw call per material (QA §5.2). Glowing meshes,
 * light decals and the HeadSet's meshes (noMerge) are left alone.
 */
function mergeAcrossParts(g) {
  g.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(g.matrixWorld).invert();
  const buckets = new Map();
  for (const o of g.children) {
    if (!o.isMesh || o.userData.noMerge || o.userData.lightDecal || Array.isArray(o.material) || !o.visible || o.isInstancedMesh) continue;
    const key = `${o.material.uuid}|${o.renderOrder}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(o);
  }
  for (const list of buckets.values()) {
    if (list.length < 2) continue;
    const tags = [...new Set(list.flatMap((m) => m.userData.parts || (m.userData.part ? [m.userData.part] : [])))];
    const geo = joinGeos(list.map((m) => {
      const c = m.geometry.clone();
      for (const name of Object.keys(c.attributes)) if (!['position', 'normal', 'uv'].includes(name)) c.deleteAttribute(name);
      c.morphAttributes = {};
      return c.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld));
    }));
    geo.computeBoundingBox();
    geo.computeBoundingSphere();
    const first = list[0];
    const mesh = K.partMesh(geo, first.material, tags[0] ?? null, { name: first.name || tags[0] || 'merged' });
    if (tags.length > 1) mesh.userData.parts = tags;
    mesh.castShadow = first.castShadow;
    mesh.receiveShadow = first.receiveShadow;
    mesh.renderOrder = first.renderOrder;
    for (const m of list) {
      m.removeFromParent();
      if (!m.geometry.userData?.shared) m.geometry.dispose();
    }
    g.add(mesh);
  }
}

/**
 * Finishes a spots.js model: Lamp.finish (+ one mesh per material across parts), every mesh noShadow, the extra glow meshes and wall decals appended to
 * lights[0].emissiveMeshes (finish overwrites that list: MASTER D41), emitters on every glow material, thumbView.
 */
function finishSpot(L, { hs = null, decals = [], thumbView = 'under' } = {}) {
  const g = L.finish();
  mergeAcrossParts(g);
  g.traverse((o) => {
    if (!o.isMesh) return;
    o.userData.noShadow = true;
    o.castShadow = false;
  });
  // model.parts: a merged mesh is listed under every part it holds (the Inspector offers each part's colour)
  const parts = {};
  g.traverse((o) => {
    if (!o.isMesh) return;
    for (const p of o.userData.parts || (o.userData.part ? [o.userData.part] : [])) (parts[p] ||= []).push(o);
  });
  g.userData.model.parts = parts;
  const lights = g.userData.model.lights;
  const extra = [...(hs ? hs.glowMeshes : []), ...decals];
  if (lights.length) lights[0].emissiveMeshes = [...(lights[0].emissiveMeshes || []), ...extra];
  // a glow material shared by n heads: the LightManager levels each lens as one fitting
  const n = Math.max(1, lights.length);
  for (const m of lights[0]?.emissiveMeshes || []) {
    if (m?.material && !m.material.userData?.cached) m.material.userData.emitters = n;
  }
  g.userData.model.thumbView = thumbView;
  if (hs) hs.install();
  followDecals(g, decals);
  return g;
}

// ---------------------------------------------------------------------------------------------------------------
// Ceiling fittings

/** Recessed downlight(s): trim, reflector, lens (lighting.md §1.4). */
function buildDownlight(spec) {
  const L = new Lamp('downlight', spec);
  const P = L.P;
  const grid = gridOf({ ...spec, archetype: 'downlight' });
  const head = grid.head;
  const W = clamp(head.w, 0.02, 0.4), Dd = clamp(head.d, 0.02, 0.4);
  const R = W / 2, kz = Dd / W;
  const square = P.shape === 'square';
  // a square trim round a ROUND opening (GU10 gimbal, round module, round hole in the plaster) unless the product
  // says its lens is square too
  const roundLens = square && pick(P.lensShape, ['round', 'square'], 'round') === 'round';
  const flush = P.trim === 'flush';
  const refl = pick(P.reflector, ['smooth', 'deep', 'honeycomb'], 'smooth');
  const tiltable = P.tiltable === true;
  const tilt = tiltable ? clamp(num(P.tilt, 0), 0, 35) * DEG : 0;
  const ap = clamp(num(P.aperture, 0.7), 0.3, 0.9);
  const seg = square ? Math.max(40, L.q.lathe) : L.q.lathe;
  // a round opening in a non-square trim fits its shorter side
  const ra = ap * (roundLens ? Math.min(R, R * kz) : R);
  const tv = flush ? 0.0015 : clamp(head.h, 0.0015, 0.04);
  // a flush round trim shows a 4 mm lip round its opening; a flush SQUARE one with a round opening is the plastered-in
  // body (SLV Plastra): flush with the ceiling, as wide as the fitting, the round hole in it
  const Ro = flush && !roundLens ? Math.min(R, ra + 0.004) : R;
  const rl = (refl === 'deep' ? 0.55 : tiltable ? 0.7 : 0.85) * ra;
  const shape = (geo) => {
    // round opening: everything inside the trim stays round
    if (roundLens) return geo;
    if (square) squareUp(geo);
    if (Math.abs(kz - 1) > 1e-3) geo.scale(1, 1, kz);
    return geo;
  };
  /** The trim: square (and kz-stretched) outside the opening only, when the opening is round. */
  const shapeTrim = (geo) => {
    if (!roundLens) return shape(geo);
    const minR = ra + 1e-4;
    squareUp(geo, { minR });
    if (Math.abs(kz - 1) > 1e-3) {
      const pos = geo.attributes.position;
      for (let i = 0; i < pos.count; i++) if (Math.hypot(pos.getX(i), pos.getZ(i)) > minR) pos.setZ(i, pos.getZ(i) * kz);
      pos.needsUpdate = true;
    }
    return geo;
  };
  const hs = new HeadSet(L);
  // trim: the bottom face and its outer edge, a lip up into the ceiling
  const e = Math.min(0.002, tv / 2, Ro * 0.1);
  hs.addPart(shapeTrim(K.lathe([[ra, -tv], [Ro - e, -tv], [Ro - e * 0.3, -tv + e * 0.3], [Ro, -tv + e], [Ro, TRIM_EMBED]], { seg })), L.mat('shade'), 'shade', { trim: true });
  // reflector: a cone from the aperture edge up to the lens rim, in the product's inner colour. A light painted / opal
  // one glows a little with the lamp (a «deep» cavity less: it is lit by the bounce of its own light – from below a
  // white deep downlight reads white, not as a black ring); a metal one (chrome, steel) never glows: the warm emissive
  // turned a chrome ring bronze. A dark inner stays dark (a black «deep» reflector is the product's own colour).
  const innerHex = L.hex('inner');
  let rmat = L.mat('inner'), rglow = false;
  if (linLum(innerHex) > 0.3 && !(rmat.metalness >= 0.5)) {
    rmat = L.glow('inner', refl === 'deep' ? 0.22 : 0.45);
    rglow = true;
  }
  const rg = tiltable ? Math.max(rl * 1.12, ra * 0.9) : rl;
  hs.addPart(shape(K.lathe([[rg, LENS_Y], [ra, -tv]], { seg })), rmat, 'inner', { glow: rglow });
  const lumens = L.lumens(450);
  const angle = beamAngle(P.beamDeg ?? 40, 0.5);
  const lensGeo = () => {
    const parts = [shape(discDown(rl, seg, -0.0001))];
    return parts;
  };
  if (tiltable) {
    // gimbal: a ring in the trim colour (part of the trim: one mesh with it), the lens and its bezel turned by the tilt –
    // the bezel is the tilting module, in the reflector's colour (Artos: a steel ring in every trim colour), one mesh
    // with the reflector
    hs.addPart(shape(ringDown(rl * 1.06, rg, seg, LENS_Y - 0.0001)), L.mat('shade'), 'shade', { trim: true });
    hs.addPart(shape(K.lathe([[rl * 1.03, -0.0025], [rl * 1.03, 0.002]], { seg })), rmat, 'inner', { mode: 'aim', glow: rglow });
    hs.addPart(lensGeo(), L.bulbMat(3.2), null, { mode: 'aim', glow: true, name: 'lens' });
  } else {
    hs.addPart(shape(discDown(rl, seg, LENS_Y - 0.0001)), L.bulbMat(3.2), null, { glow: true, name: 'lens' });
  }
  if (refl === 'honeycomb') {
    // a grid of thin black bars over the lens
    const bars = [];
    const s = Math.max(0.004, rl / 4);
    for (let x = -rl + s / 2; x < rl; x += s) {
      const c = Math.sqrt(Math.max(0, rl * rl - x * x)) * 2;
      if (c > 0.002) bars.push(K.box(0.0007, 0.0008, c).translate(x, 0, 0), K.box(c, 0.0008, 0.0007).translate(0, 0, x));
    }
    const y = tiltable ? -0.0006 : LENS_Y - 0.0006;
    const geo = shape(joinGeos(bars).translate(0, y, 0));
    hs.addPart(geo, mat('black-metal', '#161616', { flat: true, roughness: 0.62 }), 'inner', { mode: tiltable ? 'aim' : 'slope' });
  }
  for (const c of gridCells(grid)) {
    const light = headLight(L, lumens, angle, 0.5, 'downlight', 'recessed');
    L.lights.push(light);
    if (tiltable) hs.addHead({ u: c.u, v: c.v, pivot: [0, LENS_Y, 0], tilt, lens: [0, -0.004, 0], minY: -0.005, light });
    else hs.addHead({ u: c.u, v: c.v, fixed: true, lens: [0, -0.0055, 0], light });
  }
  hs.build();
  return finishSpot(L, { hs, thumbView: 'below' });
}

/** Surface-mounted downlight(s): ceiling plate, can, recessed lens (lighting.md §1.4). */
function buildDownlightSurface(spec) {
  const L = new Lamp('downlight-surface', spec);
  const P = L.P;
  const grid = gridOf({ ...spec, archetype: 'downlight-surface' });
  const head = grid.head;
  const W = clamp(head.w, 0.02, 0.5), Dd = clamp(head.d, 0.02, 0.5);
  const R = W / 2, kz = Dd / W;
  const hh = clamp(head.h, 0.012, 0.4);
  const square = P.shape === 'square';
  const seg = square ? Math.max(40, L.q.lathe) : L.q.lathe;
  const ld = clamp(num(P.lensDepth, 0.02), 0, Math.min(0.06, hh - 0.008));
  const ro = R * (ld > 0.001 ? 0.8 : 0.86);
  const shape = (geo) => {
    if (square) squareUp(geo);
    if (Math.abs(kz - 1) > 1e-3) geo.scale(1, 1, kz);
    return geo;
  };
  const hs = new HeadSet(L);
  // the ceiling cup: by default a 4 mm plate a little wider than the can; plateD < the can (Valerie: a small white cup
  // over a wide opal cylinder) draws a cup Ø plateD, plateH high, and the can hangs from under it
  const cupD = num(P.plateD, 0);
  const cup = cupD > 0.02 && cupD < W - 0.004;
  const cupH = cup ? clamp(num(P.plateH, 0.03), 0.004, hh - 0.01) : 0.004;
  if (cup) hs.addPart(discGeo(Math.max(0.02, cupD), cupH + EMBED, seg, { y0: -cupH, round: Math.min(0.004, cupH / 3) }), L.mat('base'), 'base');
  else hs.addPart(shape(discGeo(W + 0.004, 0.004 + EMBED, seg, { y0: -0.004, round: 0.0015 })), L.mat('base'), 'base');
  // the can: its bottom face round the opening, its side up to the plate (closed on top under a narrow cup)
  const e = Math.min(0.004, R * 0.15, hh * 0.2);
  const canProf = [[ro, -hh], [R - e, -hh], [R - e * 0.3, -hh + e * 0.3], [R, -hh + e]];
  if (cup) {
    const yt = -cupH;
    canProf.push([R, yt - e], [R - e * 0.3, yt - e * 0.3], [R - e, yt], [Math.max(0.002, cupD / 2 - 0.002), yt]);
  } else canProf.push([R, -0.002]);
  // an opal glass can (a small plafond) glows with the light
  const smat = L.shadeMat('shade', 1.2);
  hs.addPart(shape(K.lathe(canProf, { seg })), smat, 'shade', { glow: smat.userData?.kind === 'emissive' });
  let ly = -hh - 0.0003;
  if (ld > 0.001) {
    // anti-glare tube up to the recessed lens
    hs.addPart(shape(K.lathe([[ro, -hh + ld], [ro, -hh]], { seg })), L.mat('inner'), 'inner');
    ly = -hh + ld - 0.0002;
  }
  hs.addPart(shape(discDown(ro, seg, ly)), L.bulbMat(3.2), null, { glow: true, name: 'lens' });
  const lumens = L.lumens(500);
  const angle = beamAngle(P.beamDeg ?? 36, 0.5);
  for (const c of gridCells(grid)) {
    const light = headLight(L, lumens, angle, 0.5, 'downlight', 'surface');
    L.lights.push(light);
    hs.addHead({ u: c.u, v: c.v, fixed: true, lens: [0, -hh + ld - 0.004, 0], light });
  }
  hs.build();
  return finishSpot(L, { hs, thumbView: 'below' });
}

/** Adds a can (aim parts about a pivot) to a HeadSet. */
function addCan(hs, L, o) {
  const can = canParts(L, o);
  for (const p of can.parts) hs.addPart(p.geo, p.material, p.part, { mode: 'aim', glow: !!p.glow, name: p.glow ? 'lens' : undefined });
  return can.front;
}

/** Single aimable ceiling spot(s) on a canopy (lighting.md §1.4). */
function buildSpotCeiling(spec) {
  const L = new Lamp('spot-ceiling', spec);
  const P = L.P;
  const grid = gridOf({ ...spec, archetype: 'spot-ceiling' });
  const head = grid.head;
  const cw = clamp(head.w, 0.03, 0.25), kz = clamp(head.d, 0.03, 0.25) / cw;
  const hh = clamp(head.h, 0.05, 0.45);
  const D = clamp(num(P.headD, 0.06), 0.04, 0.12), len = clamp(num(P.headL, 0.1), 0.05, 0.2);
  const tilt = clamp(num(P.tilt, 20), 0, 90) * DEG;
  const shape = pick(P.headShape, ['cylinder', 'cone', 'dome', 'cube'], 'cylinder');
  const seg = L.q.lathe;
  const cseg = Math.max(14, Math.round(L.q.lathe * 0.6));
  const CH = 0.018;
  const stem = Math.max(0.015, hh - CH - len);
  const py = -(CH + stem);
  const hs = new HeadSet(L);
  const canopy = discGeo(cw, CH + EMBED, seg, { y0: -CH });
  if (Math.abs(kz - 1) > 1e-3) canopy.scale(1, 1, kz);
  hs.addPart(canopy, L.mat('base'), 'base');
  const kr = clamp(D * 0.2, 0.008, 0.014);
  hs.addPart([rod([0, -CH + 0.004, 0], [0, py + kr * 0.5, 0], 0.0045, L.q.rod), K.sphere(kr, { wSeg: 12, hSeg: 8 }).translate(0, py, 0)], L.mat('metal'), 'metal', { mode: 'plumb' });
  const front = addCan(hs, L, { shape, D, len, seg: cseg });
  const lumens = L.lumens(350);
  const angle = beamAngle(P.beamDeg ?? 30, 0.4);
  for (const c of gridCells(grid)) {
    const light = headLight(L, lumens, angle, 0.4, 'downlight', 'spot');
    L.lights.push(light);
    hs.addHead({ u: c.u, v: c.v, pivot: [0, py, 0], tilt, lens: [0, front - 0.004, 0], light });
  }
  hs.build();
  return finishSpot(L, { hs });
}

/** Track, bar or round plate with 1–8 aimable spots (lighting.md §1.4; MASTER D2 for the plate). */
function buildSpotTrack(spec) {
  const L = new Lamp('spot-track', spec);
  const P = L.P;
  const { w: W0, d: D0, h: H0 } = L.dims;
  const w = clamp(W0, 0.1, 3.5), d = clamp(D0, 0.03, 2.2), hh = clamp(H0, 0.05, 0.45);
  const n = clamp(Math.round(num(P.heads, 3)), 1, 8);
  const kind = pick(P.railKind, ['track', 'bar', 'plate'], 'track');
  const lShape = kind !== 'plate' && P.trackShape === 'L';
  const D = clamp(num(P.headD, 0.055), 0.04, 0.12), len = clamp(num(P.headL, 0.09), 0.05, 0.2);
  const tilt = clamp(num(P.tilt, 25), 0, 90) * DEG;
  const aimMode = pick(P.aim, ['parallel', 'alternate', 'fan'], 'parallel');
  const spread = clamp(num(P.spread, 40), 0, 120) * DEG;
  const shape = pick(P.headShape, ['cylinder', 'cone', 'dome', 'cube'], 'cylinder');
  const seg = L.q.lathe;
  const cseg = Math.max(14, Math.round(L.q.lathe * 0.6));
  const hs = new HeadSet(L, { sample: 'centre' });
  const base = L.mat('base'), metal = L.mat('metal');
  // the heads' attachment points (local x, z) and, on a plate, their ring angles
  const pts = [];
  let railBottom;
  if (kind === 'plate') {
    // a round plate nearly as wide as the fitting with the spots on short stems under it (the shops' photos: Bohus
    // Hugin, Flint, Avenir – MASTER D2's 0.45 × span canopy on arms looked like a spider)
    const span = Math.min(w, d);
    const cd = Math.max(0.08, 0.78 * span);
    const ch = 0.025;
    hs.addPart(discGeo(cd, ch + EMBED, seg, { y0: -ch }), base, 'base', { perHead: false });
    const rr = n > 1 ? Math.max(0, Math.min((span - D) / 2, cd / 2 - 0.3 * D)) : 0;
    for (let i = 0; i < n; i++) {
      const a = (2 * Math.PI * (i + (n % 2 === 0 ? 0.5 : 0))) / n;
      pts.push({ x: Math.sin(a) * rr, z: Math.cos(a) * rr, a });
    }
    railBottom = -ch;
    if (rr > cd / 2 - 0.012) {
      // flat arms from the canopy out to each head
      const arms = pts.map((p) => K.roundedBox(0.016, 0.008, rr, 0.002, 1).translate(0, -ch + 0.003, rr / 2).rotateY(p.a));
      hs.addPart(arms, metal, 'metal', { perHead: false });
      railBottom = -ch - 0.001;
    }
  } else {
    // rail section: hidden params railW / railH (a 7 cm flat plate, a 3 × 3 cm bar); barShape 'round' = a thin rod
    const round = kind === 'bar' && P.barShape === 'round';
    const RW = round ? clamp(num(P.railW, 0.012), 0.006, 0.04) : clamp(num(P.railW, kind === 'bar' ? 0.02 : 0.035), 0.008, 0.12);
    const RH = round ? RW : clamp(num(P.railH, kind === 'bar' ? 0.012 : 0.033), 0.004, 0.06);
    const r = Math.min(kind === 'bar' ? 0.003 : 0.004, RH / 3);
    const z0 = lShape ? -d / 2 : 0;
    // canopy (hidden canopyD / canopyH): a round cup in the middle, the rail hanging canopyH under the ceiling on a
    // short stem (Hugin: a thin rod under a Ø 12 cm cup; Pluto: a flat bar under a Ø 10 cm cup)
    const cD = clamp(num(P.canopyD, 0), 0, 0.3);
    const cH = cD > 0.02 ? clamp(num(P.canopyH, 0.03), 0.008, 0.12) : 0;
    let top = 0;
    if (cH > 0) {
      const disc = Math.min(cH, Math.max(0.006, cH - 0.008));
      hs.addPart(discGeo(cD, disc + EMBED, seg, { y0: -disc, round: Math.min(0.004, disc / 3) }).translate(0, 0, z0), base, 'base', { perHead: false });
      if (cH - disc > 0.001) hs.addPart(rod([0, -disc + 0.001, z0], [0, -cH - 0.001, z0], Math.min(0.006, RW * 0.4), L.q.rod), base, 'base', { perHead: false });
      top = -cH;
    }
    const emb = top < 0 ? 0 : EMBED;
    const yc = top - RH / 2 + emb / 2;
    const legs = [];
    if (round) {
      legs.push(K.cylinder(RW / 2, RW / 2, w, { seg: Math.max(10, L.q.rod + 2), center: true }).rotateZ(Math.PI / 2).translate(0, top - RH / 2, z0));
      if (lShape) legs.push(K.cylinder(RW / 2, RW / 2, d, { seg: Math.max(10, L.q.rod + 2), center: true }).rotateX(Math.PI / 2).translate(w / 2 - RW / 2, top - RH / 2, z0 + d / 2));
    } else {
      legs.push(K.roundedBox(w, RH + emb, RW, r, 2, { grain: 'x' }).translate(0, yc, z0));
      if (lShape) legs.push(K.roundedBox(RW, RH + emb, d, r, 2, { grain: 'z' }).translate(w / 2 - RW / 2, yc, z0 + d / 2));
    }
    hs.addPart(legs, base, 'base', { perHead: false });
    if (kind === 'track') {
      // the dark slot on the underside of a 3-phase track
      const slots = [K.box(Math.max(0.01, w - 0.02), 0.001, Math.min(0.007, RW * 0.4)).translate(0, top - RH - 0.0003, z0)];
      if (lShape) slots.push(K.box(Math.min(0.007, RW * 0.4), 0.001, Math.max(0.01, d - 0.02)).translate(w / 2 - RW / 2, top - RH - 0.0003, z0 + d / 2));
      hs.addPart(slots, mat('black-metal', '#141414', { flat: true, roughness: 0.62 }), null, { perHead: false });
    }
    const path = w + (lShape ? d : 0);
    for (let i = 0; i < n; i++) {
      const s = (path * (i + 0.5)) / n;
      pts.push(s <= w || !lShape ? { x: -w / 2 + Math.min(s, w), z: z0, a: 0 } : { x: w / 2 - RW / 2, z: z0 + (s - w), a: 0 });
    }
    railBottom = top - RH;
  }
  // adapter on the rail, stem, knuckle, can
  const ad = kind === 'track' ? [0.03, 0.022, 0.028] : kind === 'bar' ? [0.022, 0.014, 0.022] : [0.024, 0.012, 0.024];
  hs.addPart(K.roundedBox(ad[0], ad[1], ad[2], 0.003, 1).translate(0, railBottom - ad[1] / 2, 0), metal, 'metal');
  const ya = railBottom - ad[1];
  const kr = clamp(D * 0.2, 0.008, 0.013);
  // hidden stemLen: the stem's length (0 = the knuckle right under the adapter); unset = down to dims.h
  const stemLen = P.stemLen == null ? null : clamp(num(P.stemLen, 0), 0, 0.4);
  const py = stemLen == null ? Math.min(ya - 0.012, -(hh - len)) : ya - stemLen - kr * 0.8;
  const knuckle = K.sphere(kr, { wSeg: 12, hSeg: 8 }).translate(0, py, 0);
  hs.addPart(py + kr * 0.5 < ya + 0.002 ? [rod([0, ya + 0.003, 0], [0, py + kr * 0.5, 0], 0.0045, L.q.rod), knuckle] : [knuckle], metal, 'metal', { mode: 'plumb' });
  const front = addCan(hs, L, { shape, D, len, seg: cseg });
  const lumens = L.lumens(900) / n;
  const angle = beamAngle(P.beamDeg ?? 30, 0.4);
  pts.forEach((p, i) => {
    let yaw = 0, t = tilt;
    if (aimMode === 'alternate') yaw = i % 2 ? Math.PI : 0;
    else if (aimMode === 'fan') {
      // a rail fans the heads sideways over `spread`; a plate leans each head outward along its ring angle by spread/2
      if (kind === 'plate') {
        yaw = n > 1 ? p.a : 0;
        t = n > 1 ? Math.min(spread / 2, 90 * DEG) : tilt;
      } else yaw = n > 1 ? -spread / 2 + (spread * i) / (n - 1) : 0;
    }
    const light = headLight(L, lumens, angle, 0.4, 'fixture', 'track');
    L.lights.push(light);
    hs.addHead({ u: p.x, v: p.z, pivot: [0, py, 0], yaw, tilt: t, lens: [0, front - 0.004, 0], light });
  });
  hs.build();
  return finishSpot(L, { hs });
}

// ---------------------------------------------------------------------------------------------------------------
// Wall fittings (back in z = 0, the vertical middle of dims.h at y = 0)

/**
 * The sizes of a wall spot that the product does not state, from its dims (so the Inspector's size sliders act): the
 * head's Ø from the width (two side by side: from the height), the plate from the smaller of width and height, the
 * head's length so the fitting fills dims.h at its tilt, the arm so the head's front reaches dims.d.
 */
function wallSizes(P, dims, { n, updown, tilt }) {
  const w = clamp(dims.w, 0.04, 0.5), hh = clamp(dims.h, 0.04, 0.5), dd = clamp(dims.d, 0.04, 0.5);
  const two = n === 2 && !updown;
  const PT = 0.012;
  const D = clamp(num(P.headD, two ? Math.min(0.7 * hh, w / 2 - 0.01) : 0.75 * w), 0.04, 0.12);
  const plateD = clamp(num(P.plateD, Math.min(w, hh) * 0.9), 0.04, 0.15);
  const plateH = updown ? 0.11 : two ? 0.04 : plateD;
  const r = D / 2, c = Math.abs(Math.cos(tilt)), s = Math.sin(tilt);
  const pzMin = Math.max(PT + 0.02, r + 0.006);
  let len = num(P.headL, null);
  if (len == null) {
    // fill dims.h below the plate (up and down: from each head's pivot 3 cm off the middle) …
    const room = updown ? hh / 2 - 0.03 : hh - plateH / 2;
    const byH = c > 0.3 ? (room - r * s) / c : Infinity;
    // … but leave the arm its minimum inside dims.d
    const byD = s > 0.3 ? (dd - r * c - pzMin) / s : Infinity;
    len = Math.min(byH, byD);
    if (!Number.isFinite(len)) len = 0.1;
  }
  len = clamp(len, 0.05, 0.2);
  const armLen = clamp(num(P.armLen, dd - len * s - r * c - PT), 0.02, 0.3);
  return { D, len, armLen, plateD };
}

/** Wall spot with 1–2 heads on a plate and a short arm (lighting.md §1.4). */
function buildSpotWall(spec) {
  const L = new Lamp('spot-wall', spec);
  const P = L.P;
  const { w: W0, h: H0 } = L.dims;
  const w = clamp(W0, 0.04, 0.5), hh = clamp(H0, 0.04, 0.5);
  const n = clamp(Math.round(num(P.heads, 1)), 1, 2);
  const layout = pick(P.layout, ['side', 'updown'], 'side');
  const square = P.plateShape === 'square';
  const tilt = clamp(num(P.tilt, 45), 0, 180) * DEG;
  const yaw = clamp(num(P.aimYaw, 0), -60, 60) * DEG;
  const shape = pick(P.headShape, ['cylinder', 'cone', 'dome', 'cube'], 'cylinder');
  const seg = L.q.lathe;
  const cseg = Math.max(14, Math.round(L.q.lathe * 0.6));
  const PT = 0.012;
  const base = L.mat('base'), metal = L.mat('metal');
  // pivots: side by side (x) or up and down (y); the plate's top at the top of dims.h for spots aimed down
  const two = n === 2;
  const updown = two && layout === 'updown';
  // headD / headL / armLen / plateD (hidden: the store size of a single head's plate) as the product states them,
  // else from dims
  const { D, len, armLen, plateD } = wallSizes(P, L.dims, { n, updown, tilt });
  const px = two && !updown ? Math.max(0.04, w / 2 - D / 2 - 0.004) : 0;
  const plateW = two && !updown ? 2 * px + 0.04 : updown ? 0.045 : plateD;
  const plateH = updown ? 0.11 : two ? 0.04 : plateD;
  const yp = updown ? 0 : Math.max(0, hh / 2 - plateH / 2) * (tilt <= 90 * DEG ? 1 : -1);
  const pz = Math.max(PT + armLen, D / 2 + 0.006);
  if (!two && !square) {
    const g = discGeo(plateW, PT + EMBED, seg, { y0: -EMBED, round: 0.003 });
    L.add(g.rotateX(Math.PI / 2).translate(0, yp, 0), base, 'base');
  } else {
    L.add(K.roundedBox(plateW, plateH, PT + EMBED, 0.004, 2).translate(0, yp, (PT - EMBED) / 2), base, 'base');
  }
  const heads = [];
  if (updown) {
    heads.push({ x: 0, y: yp - 0.03, t: tilt }, { x: 0, y: yp + 0.03, t: Math.PI - tilt });
  } else if (two) {
    heads.push({ x: -px, y: yp, t: tilt }, { x: px, y: yp, t: tilt });
  } else heads.push({ x: 0, y: yp, t: tilt });
  const lumens = L.lumens(300) / n;
  const angle = beamAngle(P.beamDeg ?? 36, 0.4);
  const kr = clamp(D * 0.2, 0.008, 0.013);
  for (const hd of heads) {
    const pivot = new THREE.Vector3(hd.x, hd.y, pz);
    L.add(rod([hd.x, hd.y, PT - 0.002], [hd.x, hd.y, pz], 0.005, L.q.rod), metal, 'metal');
    L.add(K.sphere(kr, { wSeg: 12, hSeg: 8 }).translate(hd.x, hd.y, pz), metal, 'metal');
    const A = aimQuat(hd.t, yaw);
    const can = canParts(L, { shape, D, len, seg: cseg });
    for (const p of can.parts) {
      const geo = xf(p.geo, pivot, A);
      if (p.glow) L.glowAdd(geo, p.material, null);
      else L.add(geo, p.material, p.part);
    }
    const pos = new THREE.Vector3(0, can.front - 0.004, 0).applyQuaternion(A).add(pivot);
    const dir = DOWN.clone().applyQuaternion(A);
    const light = K.spotLight(pos.toArray(), dir.toArray(), { angle, penumbra: 0.4, lumens, colorK: L.colorK });
    light.cluster = 'fixture';
    light.fitting = 'wall-spot';
    L.lights.push(light);
  }
  return finishSpot(L);
}

/** Picture light: wall plate, arm, light bar or hood turned toward the picture, and its wash on the picture (§1.4, §2.4). */
function buildPictureLight(spec) {
  const L = new Lamp('picture-light', spec);
  const P = L.P;
  const { w: W0, d: D0, h: H0 } = L.dims;
  const w = clamp(W0, 0.1, 1.6), d = clamp(D0, 0.04, 0.55), hh = clamp(H0, 0.03, 0.55);
  const tilt = clamp(num(P.tilt, 40), 0, 75) * DEG;
  const hood = P.headShape === 'hood';
  const swan = P.armShape === 'swan';
  const seg = L.q.lathe;
  const metal = L.mat('metal');
  // the head: centre, turned toward the wall by the tilt
  const hz = Math.max(0.035, d - 0.02);
  const hy = -hh / 2 + 0.015;
  const Q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), tilt);
  const top = hy + 0.011;
  // arm (one, two on long bars), each on its wall plate at the top – or (hidden armGap, m) two arms that close together
  // on ONE central plate (Mailine: a 12 × 4 cm plate, the arms 5 cm apart)
  const yP = hh / 2 - 0.0175;
  const gap = P.armGap == null ? null : clamp(num(P.armGap, 0.05), 0.02, Math.max(0.02, w - 0.06));
  const xs = gap != null ? [-gap / 2, gap / 2] : w >= 0.6 ? [-w / 4, w / 4] : [0];
  if (gap != null) L.add(K.roundedBox(gap + 0.08, 0.035, 0.012 + EMBED, 0.004, 2).translate(0, yP, (0.012 - EMBED) / 2), L.mat('base'), 'base');
  for (const x of xs) {
    if (gap == null) L.add(K.roundedBox(xs.length > 1 ? 0.045 : 0.06, 0.035, 0.012 + EMBED, 0.004, 2).translate(x, yP, (0.012 - EMBED) / 2), L.mat('base'), 'base');
    if (swan) {
      const pts = bezier([x, yP, 0.01], [x, yP, hz * 0.6], [x, top + Math.max(0.02, (yP - top) * 0.7), hz], [x, top, hz], 14);
      L.add(K.tube(pts, 0.005, { radial: L.q.rod }), metal, 'metal');
    } else {
      L.add(rod([x, yP, 0.01], [x, yP, hz], 0.005, L.q.rod), metal, 'metal');
      L.add(K.sphere(0.0055, { wSeg: 8, hSeg: 6 }).translate(x, yP, hz), metal, 'metal');
      if (yP - top > 0.004) L.add(rod([x, yP, hz], [x, top, hz], 0.005, L.q.rod), metal, 'metal');
    }
  }
  const at = (geo) => xf(geo, [0, hy, hz], Q);
  let diffW;
  if (hood) {
    // a half-cylinder hood open toward the picture, with end caps
    const rH = 0.03;
    const shell = K.cylinder(rH, rH, w, { seg: Math.max(12, Math.round(seg / 2)), open: true, center: true, thetaStart: 0, thetaLength: Math.PI }).rotateZ(Math.PI / 2).translate(0, -0.011, 0);
    L.add(at(shell), L.mat('shade'), 'shade');
    for (const s of [-1, 1]) {
      const cap = new THREE.CircleGeometry(rH, 12, 0, Math.PI).rotateY((s * Math.PI) / 2).translate((s * w) / 2, -0.011, 0);
      L.add(at(cap), L.mat('shade'), 'shade');
    }
    diffW = rH * 1.96;
  } else {
    L.add(at(K.roundedBox(w, 0.022, 0.03, 0.006, 2, { grain: 'x' })), L.mat('shade'), 'shade');
    diffW = 0.018;
  }
  // diffuser on the underside, facing the aim
  L.glowAdd(at(new THREE.PlaneGeometry(w * 0.96, diffW).rotateX(Math.PI / 2).translate(0, -0.0113, 0)), L.glow('inner', 1.6), null);
  const lumens = L.lumens(250);
  // The light on the picture is the wash below (a decal: the same in every pose, whether the fitting holds a light slot
  // or not). The spot is the light the lit picture gives back to the room – a picture reflects diffusely, out of the
  // wall: a WIDE cone (57°) whose axis leans 33° below the horizontal, its wall-side edge parallel to the wall (a real
  // spot 15 cm from the canvas burnt the picture white with a hard edge). The furniture right under the picture sits in
  // the cone's soft wall-side half and gets mild spill; a 34° cone aimed down and out made a bright pool on the sofa,
  // a 75° one lit the ceiling in front (tuning).
  const pos = new THREE.Vector3(0, -0.011 - 0.004, 0).applyQuaternion(Q).add(new THREE.Vector3(0, hy, hz));
  const angle = clamp(beamAngle(P.beamDeg ?? 110, 0.8), PICTURE_SPOT_MIN, PICTURE_SPOT_MAX);
  const dir = new THREE.Vector3(0, -Math.cos(angle), Math.sin(angle));
  const light = K.spotLight(pos.toArray(), dir.toArray(), { angle, penumbra: 0.8, lumens, colorK: L.colorK });
  light.fitting = 'picture';
  L.lights.push(light);
  // the wash on the picture: budget-free light on the art (a light decal, LightManager wash path); a higher tilt aims
  // more of the bar's light at the picture
  const washW = clamp(num(P.washW, w + 0.15), 0.1, 3.0);
  const washH = clamp(num(P.washH, 0.7), 0.2, 1.6);
  const artDepth = clamp(num(P.artDepth, 0.04), 0, 0.12);
  const wtop = top - 0.011 - 0.02;
  const nits = (WASH_NITS * lumens * (0.6 + (0.8 * tilt) / (75 * DEG))) / (washW * washH);
  const g = new THREE.PlaneGeometry(washW, washH).translate(0, wtop - washH / 2, artDepth + 0.004);
  g.computeBoundingSphere();
  // light, not part of the fitting: not in its bounds, not clickable, not outlined
  g.boundingBox = new THREE.Box3(new THREE.Vector3(), new THREE.Vector3());
  const wash = K.partMesh(g, lightDecalMaterial(L.kc, nits, lumens, washTexture()), null, { name: 'wall-wash', noMerge: true });
  wash.raycast = () => {};
  Object.assign(wash.userData, { lightDecal: true, noHighlight: true, noCollide: true, noShadow: true });
  wash.visible = false;
  L.g.add(wash);
  return finishSpot(L, { decals: [wash] });
}

// ---------------------------------------------------------------------------------------------------------------
// Definitions (MASTER §2.3)

const BEAM = { type: 'number', min: 10, max: 120, step: 1, unit: '°', label: 'Spredning (strålevinkel)' };
const HEAD_SHAPE = { type: 'enum', label: 'Spothode', options: [['cylinder', 'Sylinder'], ['cone', 'Kjegle'], ['dome', 'Kuppel'], ['cube', 'Kube']] };
const HEAD_D = { type: 'number', min: 0.04, max: 0.12, step: 0.005, unit: 'm', label: 'Diameter på hodet' };
const HEAD_L = { type: 'number', min: 0.05, max: 0.2, step: 0.005, unit: 'm', label: 'Lengde på hodet' };
const AIM_TILT = (max, dflt, hint) => ({ type: 'number', min: 0, max, step: 1, unit: '°', label: 'Vinkel', section: 'light', hint, default: dflt });
const ROUND_SQUARE = { type: 'enum', label: 'Form', options: [['round', 'Rund'], ['square', 'Firkantet']] };

/** def() with the archetype's own part names from archetypes.json (the family's generic ones would mislead). */
function spotDef(id, build, defaults, extra) {
  const d = def(id, build, defaults, extra);
  const own = schema.archetypes[id]?.partLabels || {};
  d.partLabels = { ...d.partLabels, ...own };
  return d;
}

const WHITE = '#f2f0ec';

export const archetypes = {
  downlight: spotDef('downlight', buildDownlight, {
    dims: { w: 0.09, d: 0.09, h: 0.008 },
    ...look(WHITE, 'painted', WHITE, 'painted', WHITE, 'painted'),
    params: { shape: 'round', trim: 'ring', reflector: 'smooth', aperture: 0.7, tiltable: false, tilt: 0, beamDeg: 40, cutout: 0.075, recessDepth: 0.06, gridRows: 1, gridCols: 1, gridDx: 1.2, gridDz: 1.2, lumens: 450 },
  }, {
    params: {
      shape: ROUND_SQUARE,
      trim: { type: 'enum', label: 'Kant', options: [['ring', 'Med kant'], ['flush', 'Kantløs (sparklet inn)']] },
      reflector: { type: 'enum', label: 'Reflektor', options: [['smooth', 'Glatt'], ['deep', 'Dyp (blendfri)'], ['honeycomb', 'Bikakefilter']] },
      beamDeg: BEAM,
      tilt: { ...AIM_TILT(35, 0, '0° = rett ned. Vippbare downlights kan vinkles ca. 30°. Snu spotten (R) for å vippe mot en annen kant.'), requires: 'tiltable' },
      ...GRID_PARAMS,
    },
    dimsRange: { w: [0.05, 7.5], d: [0.05, 7.5], h: [0.005, 0.04] },
  }),
  'downlight-surface': spotDef('downlight-surface', buildDownlightSurface, {
    dims: { w: 0.09, d: 0.09, h: 0.1 },
    ...look(WHITE, 'painted', WHITE, 'painted', '#1a1a1a', 'black-metal'),
    params: { shape: 'round', lensDepth: 0.02, beamDeg: 36, gridRows: 1, gridCols: 1, gridDx: 1.2, gridDz: 1.2, lumens: 500 },
  }, {
    params: {
      shape: ROUND_SQUARE,
      lensDepth: { type: 'number', min: 0, max: 0.06, step: 0.005, unit: 'm', label: 'Linsen trukket inn' },
      beamDeg: BEAM,
      ...GRID_PARAMS,
    },
    dimsRange: { w: [0.05, 7.5], d: [0.05, 7.5], h: [0.03, 0.3] },
  }),
  'spot-ceiling': spotDef('spot-ceiling', buildSpotCeiling, {
    dims: { w: 0.08, d: 0.08, h: 0.16 },
    ...look(WHITE, 'painted', WHITE, 'painted', '#d8d5cf', 'chrome'),
    params: { headShape: 'cylinder', headD: 0.06, headL: 0.1, tilt: 20, beamDeg: 30, gridRows: 1, gridCols: 1, gridDx: 1.0, gridDz: 1.0, lumens: 350 },
  }, {
    params: {
      headShape: HEAD_SHAPE,
      headD: HEAD_D,
      headL: HEAD_L,
      tilt: AIM_TILT(90, 20, '0° = rett ned, 90° = vannrett. Roter spotten (R) for å rette den mot en annen kant.'),
      beamDeg: BEAM,
      ...GRID_PARAMS,
    },
    dimsRange: { w: [0.05, 7.5], d: [0.05, 7.5], h: [0.08, 0.4] },
  }),
  'spot-track': spotDef('spot-track', buildSpotTrack, {
    dims: { w: 1.0, d: 0.08, h: 0.16 },
    ...look('#1c1c1c', 'black-metal', '#1c1c1c', 'black-metal', '#d8d5cf', 'chrome'),
    params: { heads: 3, trackShape: 'straight', railKind: 'track', headShape: 'cylinder', headD: 0.055, headL: 0.09, tilt: 25, aim: 'parallel', spread: 40, beamDeg: 30, lumens: 900 },
  }, {
    params: {
      heads: { type: 'number', min: 1, max: 8, step: 1, label: 'Antall spotter' },
      trackShape: { type: 'enum', label: 'Skinneform', options: [['straight', 'Rett'], ['L', 'L-form']] },
      railKind: { type: 'enum', label: 'Feste', options: [['track', 'Skinne (3-faset)'], ['bar', 'Flat stang'], ['plate', 'Rund takplate']] },
      headShape: HEAD_SHAPE,
      headD: HEAD_D,
      headL: HEAD_L,
      tilt: AIM_TILT(90, 25, '0° = rett ned. Alle spottene vippes like mye – velg mønster under.'),
      aim: { type: 'enum', label: 'Retning', section: 'light', options: [['parallel', 'Samme vei'], ['alternate', 'Annenhver vei'], ['fan', 'Vifte']] },
      spread: { type: 'number', min: 0, max: 120, step: 1, unit: '°', label: 'Vifte-bredde', section: 'light', hint: 'Vifte: på en skinne vris spottene sidelengs over denne vinkelen; på en rund takplate heller hver spot utover med halve vinkelen.' },
      beamDeg: BEAM,
    },
    dimsRange: { w: [0.15, 3.0], d: [0.04, 2.0], h: [0.06, 0.4] },
  }),
  // headD / headL / armLen (and the hidden plateD) default to null: then they follow dims (wallSizes) – the size
  // sliders act; a product that states them keeps them
  'spot-wall': spotDef('spot-wall', buildSpotWall, {
    dims: { w: 0.08, d: 0.16, h: 0.12 },
    ...look('#1c1c1c', 'black-metal', '#1c1c1c', 'black-metal', '#d8d5cf', 'chrome'),
    params: { heads: 1, layout: 'side', plateShape: 'round', headShape: 'cylinder', headD: null, headL: null, armLen: null, tilt: 45, aimYaw: 0, beamDeg: 36, lumens: 300 },
  }, {
    params: {
      heads: { type: 'number', min: 1, max: 2, step: 1, label: 'Antall spotter' },
      layout: { type: 'enum', label: 'Plassering av spottene', options: [['side', 'Side om side'], ['updown', 'Opp og ned']] },
      plateShape: { type: 'enum', label: 'Veggplate', options: [['round', 'Rund'], ['square', 'Firkantet']] },
      headShape: HEAD_SHAPE,
      headD: { ...HEAD_D, default: 0.06 },
      headL: { ...HEAD_L, default: 0.1 },
      armLen: { type: 'number', min: 0.02, max: 0.3, step: 0.005, unit: 'm', label: 'Armlengde', default: 0.06 },
      tilt: AIM_TILT(180, 45, '0° = rett ned, 90° = rett ut fra veggen, 180° = rett opp.'),
      aimYaw: { type: 'number', min: -60, max: 60, step: 1, unit: '°', label: 'Retning sidelengs', section: 'light' },
      beamDeg: BEAM,
    },
    dimsRange: { w: [0.05, 0.4], d: [0.05, 0.5], h: [0.05, 0.4] },
  }),
  'picture-light': spotDef('picture-light', buildPictureLight, {
    dims: { w: 0.45, d: 0.2, h: 0.12 },
    ...look('#b08a4a', 'brass', '#b08a4a', 'brass', '#f4efe6', 'glass-opal'),
    params: { headShape: 'bar', armShape: 'straight', tilt: 40, beamDeg: 110, washH: 0.7, washW: null, artDepth: 0.04, lumens: 250 },
  }, {
    params: {
      headShape: { type: 'enum', label: 'Lampehode', options: [['bar', 'Lysbjelke'], ['hood', 'Klassisk skjerm']] },
      armShape: { type: 'enum', label: 'Arm', options: [['straight', 'Rett'], ['swan', 'Svanehals']] },
      tilt: AIM_TILT(75, 40, '0° = rett ned – høyere tall lyser mer inn mot bildet.'),
      washH: { type: 'number', min: 0.2, max: 1.6, step: 0.05, unit: 'm', label: 'Høyde på lyset over bildet' },
      beamDeg: BEAM,
    },
    dimsRange: { w: [0.15, 1.5], d: [0.05, 0.5], h: [0.04, 0.5] },
  }),
};

export { HeadSet, aimQuat, washTexture };
