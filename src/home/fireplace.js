import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { paint, mat, emissive } from './materials.js';
import { facadeFinish } from '../world/surfaces.js';

/**
 * FIREPLACE – the fireplaces and stoves of the house format (notes/peis-og-ovn.md; the model is home/fireplacegeom.js,
 * read by layout.js into layout.house.fireplaces). Built by rooms.js after the chimneys, each in its level's root:
 *   • a stove (vedovn: on legs or round on a base; peisovn: tall, a log store under the firebox) in steel or soapstone,
 *     with a glass door into its firebox; an insert behind glass in a masonry or panel surround; an open fireplace in a
 *     masonry surround with a mantel shelf – the surround round its chimney, up to the ceiling unless it has a height;
 *   • the hearth plate in front (and under a stove): glass, stone or steel, in the shape the model gives;
 *   • the flue pipe of a stove into a masonry chimney (a steel chimney starts at the stove's outlet: chimney.js);
 *   • the fire: embers (their glow is the lamp's emissive mesh – lighting.js drives it), logs, flames (an animated
 *     sprite atlas, additive, following the embers' glow: no extra light, no extra pass) and a faint glow inside the
 *     firebox. Its light is a builtInLights entry of type 'fire' (lighting.js: a flickering Lambertian spot out of the
 *     window in one of the existing light slots, in the fire's own light group);
 *   • a collider per fireplace (a Box3, or a box mesh when it stands at an angle in a corner).
 *
 *   buildFireplaces(H, opts) → { meshes, colliders, lights, update(dt), fires }
 *
 * opts: { roots (ctx.roots.levels), fallback (Group), keep, quality }
 */

const LEG = 0.12; // a box stove's legs
const TOP = 0.02; // the top plate of a stove
const GLASS_IN = 0.015; // the door glass behind a stove's front
const FRAME = 0.035; // the door frame round the glass
const PROUD = 0.008; // … standing out of the front
const ROUND_BASE = 0.1; // the base under a round stove
const INNER = 0.04; // a round stove's wall
/** The fire's look: the embers' glow without a LightManager (a display level like the one lighting.js sets), the
 *  flames over it, the glow inside the firebox. */
const EMBER_GLOW = 1.2;
const FLAME_GAIN = 1.5;
const FIREBOX_GLOW = 0.12;

/** Geometry with explicit normals and UVs in metres. */
class Geo {
  constructor() {
    this.p = [];
    this.n = [];
    this.uv = [];
  }
  /** A triangle, counter-clockwise seen from where it faces; normals per vertex or flat. */
  tri(a, b, c, ua = [0, 0], ub = [0, 0], uc = [0, 0], na = null, nb = null, nc = null) {
    if (!na) {
      const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
      const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const l = Math.hypot(nx, ny, nz) || 1;
      na = nb = nc = [nx / l, ny / l, nz / l];
    }
    this.p.push(...a, ...b, ...c);
    this.n.push(...na, ...nb, ...nc);
    this.uv.push(...ua, ...ub, ...uc);
  }
  quad(a, b, c, d, ua, ub, uc, ud, na, nb, nc, nd) {
    this.tri(a, b, c, ua, ub, uc, na, nb, nc);
    this.tri(a, c, d, ua, uc, ud, na, nc, nd);
  }
  /**
   * An axis-aligned rectangle facing `face` ('x+', 'x-', 'y+', 'y-', 'z+', 'z-') in the plane at k, over [u0, u1] ×
   * [v0, v1] of its other two axes (x: z, y; y: x, z; z: x, y). UVs: those two, in metres.
   */
  rect(face, k, u0, u1, v0, v1) {
    if (u1 - u0 < 1e-6 || v1 - v0 < 1e-6) return;
    const uv = (u, v) => [u, v];
    switch (face) {
      case 'z+': return this.quad([u0, v0, k], [u1, v0, k], [u1, v1, k], [u0, v1, k], uv(u0, v0), uv(u1, v0), uv(u1, v1), uv(u0, v1));
      case 'z-': return this.quad([u1, v0, k], [u0, v0, k], [u0, v1, k], [u1, v1, k], uv(-u1, v0), uv(-u0, v0), uv(-u0, v1), uv(-u1, v1));
      case 'x+': return this.quad([k, v0, u1], [k, v0, u0], [k, v1, u0], [k, v1, u1], uv(-u1, v0), uv(-u0, v0), uv(-u0, v1), uv(-u1, v1));
      case 'x-': return this.quad([k, v0, u0], [k, v0, u1], [k, v1, u1], [k, v1, u0], uv(u0, v0), uv(u1, v0), uv(u1, v1), uv(u0, v1));
      case 'y+': return this.quad([u0, k, v1], [u1, k, v1], [u1, k, v0], [u0, k, v0], uv(u0, v1), uv(u1, v1), uv(u1, v0), uv(u0, v0));
      case 'y-': return this.quad([u0, k, v0], [u1, k, v0], [u1, k, v1], [u0, k, v1], uv(u0, v0), uv(u1, v0), uv(u1, v1), uv(u0, v1));
      default: throw new Error(`rect: face ${face}`);
    }
  }
  /** A box, leaving out the faces in `skip` (e.g. 'z- y-'). */
  box(x0, y0, z0, x1, y1, z1, skip = '') {
    const s = new Set(skip.split(/\s+/).filter(Boolean));
    if (!s.has('x-')) this.rect('x-', x0, z0, z1, y0, y1);
    if (!s.has('x+')) this.rect('x+', x1, z0, z1, y0, y1);
    if (!s.has('y-')) this.rect('y-', y0, x0, x1, z0, z1);
    if (!s.has('y+')) this.rect('y+', y1, x0, x1, z0, z1);
    if (!s.has('z-')) this.rect('z-', z0, x0, x1, y0, y1);
    if (!s.has('z+')) this.rect('z+', z1, x0, x1, y0, y1);
  }
  /** The inside of a recess in a front (z+ at z1) back to zb: floor, ceiling, sides and back facing into it. */
  recess(x0, x1, y0, y1, zb, z1) {
    this.rect('y+', y0, x0, x1, zb, z1);
    this.rect('y-', y1, x0, x1, zb, z1);
    this.rect('x+', x0, zb, z1, y0, y1);
    this.rect('x-', x1, zb, z1, y0, y1);
    this.rect('z+', zb, x0, x1, y0, y1);
  }
  /** A front (z+ at z) over [x0, x1] × [y0, y1] with rectangular holes ({ x0, x1, y0, y1 }, not overlapping in y). */
  front(z, x0, x1, y0, y1, holes) {
    let y = y0;
    for (const h of [...holes].sort((a, b) => a.y0 - b.y0)) {
      this.rect('z+', z, x0, x1, y, h.y0);
      this.rect('z+', z, x0, h.x0, h.y0, h.y1);
      this.rect('z+', z, h.x1, x1, h.y0, h.y1);
      y = h.y1;
    }
    this.rect('z+', z, x0, x1, y, y1);
  }
  /** The side of a cylinder (axis y through cx, cz) between the angles th0 … th1 (0 at +z, toward +x), out or in. */
  cyl(cx, cz, r, y0, y1, th0, th1, segs, inward = false) {
    for (let i = 0; i < segs; i++) {
      const a = th0 + ((th1 - th0) * i) / segs, b = th0 + ((th1 - th0) * (i + 1)) / segs;
      const na = [Math.sin(a), 0, Math.cos(a)], nb = [Math.sin(b), 0, Math.cos(b)];
      const pa0 = [cx + r * na[0], y0, cz + r * na[2]], pb0 = [cx + r * nb[0], y0, cz + r * nb[2]];
      const pa1 = [pa0[0], y1, pa0[2]], pb1 = [pb0[0], y1, pb0[2]];
      const ua = r * a, ub = r * b;
      if (!inward) this.quad(pa0, pb0, pb1, pa1, [ua, y0], [ub, y0], [ub, y1], [ua, y1], na, nb, nb, na);
      else {
        const ma = na.map((v) => -v), mb = nb.map((v) => -v);
        this.quad(pb0, pa0, pa1, pb1, [ub, y0], [ua, y0], [ua, y1], [ub, y1], mb, ma, ma, mb);
      }
    }
  }
  /** A flat ring sector at y between r0 and r1 (r0 0: a disc), facing up or down. */
  ring(cx, cz, r0, r1, y, th0, th1, segs, up = true) {
    const P = (r, a) => [cx + r * Math.sin(a), y, cz + r * Math.cos(a)];
    const U = (p) => [p[0], p[2]];
    for (let i = 0; i < segs; i++) {
      const a = th0 + ((th1 - th0) * i) / segs, b = th0 + ((th1 - th0) * (i + 1)) / segs;
      const ia = P(r0, a), oa = P(r1, a), ob = P(r1, b), ib = P(r0, b);
      if (up) {
        this.tri(ia, oa, ob, U(ia), U(oa), U(ob));
        if (r0 > 1e-6) this.tri(ia, ob, ib, U(ia), U(ob), U(ib));
      } else {
        this.tri(ia, ob, oa, U(ia), U(ob), U(oa));
        if (r0 > 1e-6) this.tri(ia, ib, ob, U(ia), U(ib), U(ob));
      }
    }
  }
  /** A three.js geometry appended (made non-indexed; its own normals and UVs). */
  add(g, matrix = null) {
    const ng = g.index ? g.toNonIndexed() : g;
    if (matrix) ng.applyMatrix4(matrix);
    const p = ng.attributes.position, n = ng.attributes.normal, uv = ng.attributes.uv;
    for (let i = 0; i < p.count; i++) {
      this.p.push(p.getX(i), p.getY(i), p.getZ(i));
      this.n.push(n.getX(i), n.getY(i), n.getZ(i));
      this.uv.push(uv ? uv.getX(i) : 0, uv ? uv.getY(i) : 0);
    }
    if (ng !== g) ng.dispose();
    g.dispose();
  }
  build() {
    if (!this.p.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    return g;
  }
}

// ---- the fire's textures, made once (pure JS: no canvas, so Node builds them too) ---------------------------------

const hash = (x, y) => {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
};
/** Smooth value noise (0…1). */
function noise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const sx = xf * xf * (3 - 2 * xf), sy = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}
const smooth = (e0, e1, x) => {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

export const FLAME_FRAMES = 4;
let _flames = null;
/**
 * The flames: FLAME_FRAMES frames side by side (64 × 128 each), three tongues each that sway and change height from
 * frame to frame, white-yellow in the core to dark red at the edge (sRGB, black outside: drawn additively).
 */
export function flameAtlas() {
  if (_flames) return _flames;
  const FW = 64, FH = 128, W = FW * FLAME_FRAMES;
  const data = new Uint8Array(W * FH * 4);
  const tongues = [
    { dx: 0, h: 0.95, w: 0.2, a: 1, ph: 0 },
    { dx: -0.17, h: 0.62, w: 0.14, a: 0.85, ph: 1.7 },
    { dx: 0.16, h: 0.7, w: 0.15, a: 0.9, ph: 3.1 },
  ];
  for (let k = 0; k < FLAME_FRAMES; k++) {
    const phi = (k * 2 * Math.PI) / FLAME_FRAMES;
    for (let j = 0; j < FH; j++) {
      const v = (j + 0.5) / FH;
      for (let i = 0; i < FW; i++) {
        const u = (i + 0.5) / FW;
        let I = 0;
        for (const t of tongues) {
          const ht = t.h * (0.82 + 0.18 * Math.sin(phi * 1.3 + t.ph));
          if (v >= ht) continue;
          const cx = 0.5 + t.dx + 0.08 * v * Math.sin(v * 6 + phi + t.ph);
          const wt = t.w * Math.pow(1 - v / ht, 0.65) + 0.004;
          const core = Math.exp(-(((u - cx) / wt) ** 2) * 2.2) * smooth(0, 0.06, v) * t.a;
          I = Math.max(I, core * (1 - 0.35 * smooth(ht * 0.5, ht, v)));
        }
        // the glow at the foot, and the flicker inside the tongues
        I += 0.3 * Math.exp(-(((u - 0.5) / 0.32) ** 2)) * (1 - smooth(0, 0.16, v));
        I *= 0.72 + 0.28 * noise(u * 7 + k * 3.1, v * 5 - phi);
        I = Math.max(0, Math.min(1, I));
        // white-yellow core → orange → dark red
        const r = smooth(0, 0.3, I), g = smooth(0.18, 0.95, I) * 0.8, b = smooth(0.6, 1, I) * 0.45;
        const o = (j * W + k * FW + i) * 4;
        data[o] = Math.round(255 * r);
        data[o + 1] = Math.round(255 * g);
        data[o + 2] = Math.round(255 * b);
        data[o + 3] = 255;
      }
    }
  }
  const tex = new THREE.DataTexture(data, W, FH, THREE.RGBAFormat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.repeat.set(1 / FLAME_FRAMES, 1);
  tex.name = 'fire-flames';
  tex.needsUpdate = true;
  _flames = tex;
  return tex;
}

let _embers = null;
/** Glowing embers: bright cracks in dark ash (the embers' emissive map). */
function emberMap() {
  if (_embers) return _embers;
  const N = 64;
  const data = new Uint8Array(N * N * 4);
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const n = 0.6 * noise(i / 6, j / 6) + 0.4 * noise(i / 2.5 + 9, j / 2.5 + 3);
      const e = smooth(0.42, 0.78, n);
      const o = (j * N + i) * 4;
      data[o] = Math.round(255 * (0.1 + 0.9 * e));
      data[o + 1] = Math.round(255 * (0.02 + 0.6 * Math.pow(e, 1.6)));
      data[o + 2] = Math.round(255 * 0.08 * e * e * e);
      data[o + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.name = 'fire-embers';
  tex.needsUpdate = true;
  _embers = tex;
  return tex;
}

let _stoveGlass = null;
/** The ceramic glass of a stove door: like the window glass (wallkit.js), but smoked and with soot on it. */
function stoveGlass() {
  if (_stoveGlass) return _stoveGlass;
  const m = new THREE.MeshStandardMaterial({
    color: 0x000000,
    roughness: 0.08,
    metalness: 0,
    envMapIntensity: 0.9,
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
  // transmission ≈ 0.72 / 0.7 / 0.66: a faint brown smoke
  m.blendColor.setRGB(0.28, 0.3, 0.34);
  m.name = 'stove-glass';
  m.userData = { cached: true, kind: 'glass-stove' };
  _stoveGlass = m;
  return m;
}

const _hearthGlass = new Map();
/** A glass floor plate: the top clear (the floor shows through), its edges green as thick glass is. */
function hearthGlass(hex) {
  if (_hearthGlass.has(hex)) return _hearthGlass.get(hex);
  const top = new THREE.MeshStandardMaterial({ color: hex, roughness: 0.04, metalness: 0, transparent: true, opacity: 0.22, depthWrite: false });
  top.name = `hearth-glass ${hex}`;
  top.userData = { cached: true, kind: 'glass-hearth' };
  const edge = new THREE.MeshStandardMaterial({ color: new THREE.Color(hex).multiplyScalar(0.62), roughness: 0.1, metalness: 0, transparent: true, opacity: 0.8 });
  edge.name = `hearth-glass-edge ${hex}`;
  edge.userData = { cached: true, kind: 'glass-hearth' };
  const pair = { top, edge };
  _hearthGlass.set(hex, pair);
  return pair;
}

/**
 * Builds the fireplaces of layout.house (see the top of this file).
 * @param {object} H  layout.house
 * @param {object} opts
 */
export function buildFireplaces(H, opts) {
  const { keep, quality = {} } = opts;
  const res = quality.level === 'low' ? 0.5 : 1;
  const segs = quality.level === 'low' ? 24 : 40;
  const meshes = [];
  const colliders = [];
  const lights = [];
  const fires = [];
  const list = H.fireplaces || [];
  if (!list.length) return { meshes, colliders, lights, fires, update() {} };
  const parentOf = (levelId) => opts.roots?.[levelId] ?? opts.fallback;
  const finish = (kind, hex) => {
    if (kind === 'panel') return paint(hex, { roughness: 0.85 });
    try {
      return facadeFinish(kind, hex, { res });
    } catch {
      return mat('painted', hex, { roughness: 0.9 }); // no texture support (Node)
    }
  };
  const steel = (hex) => mat('painted', hex, { roughness: 0.55, metalness: 0.3 });
  const trimMat = mat('painted', '#141415', { roughness: 0.4, metalness: 0.5 });
  const logMat = mat('painted', '#2b1f17', { roughness: 0.97 });
  const sootMat = mat('painted', '#2f2925', { roughness: 0.98 });
  const flameTex = flameAtlas();

  /** A mesh from an accumulator, named, in the list (null without geometry). */
  const meshOf = (geo, material, name, { shadow = true } = {}) => {
    const g = geo.build();
    if (!g) return null;
    keep(g);
    const m = new THREE.Mesh(g, material);
    m.name = name;
    m.castShadow = shadow;
    m.receiveShadow = true;
    m.userData.noCollide = true;
    meshes.push(m);
    return m;
  };

  for (const fp of list) {
    const root = new THREE.Group();
    root.name = `fireplace:${fp.id}`;
    root.position.set(fp.at[0], fp.masonry ? fp.floorY : fp.baseY, fp.at[1]);
    root.rotation.y = fp.yaw;
    root.userData.noCollide = true;
    root.userData.fireplaceId = fp.id;
    parentOf(fp.levelId)?.add(root);
    const [w, d, h] = fp.size;
    const body = new Geo(), trim = new Geo(), box = new Geo(), glass = new Geo(), niche = new Geo(), logs = new Geo(), embers = new Geo();
    // the firebox's inside: soot with a faint glow of the fire on it
    const fireboxMat = keep(new THREE.MeshStandardMaterial({ color: '#2b2522', roughness: 0.97, metalness: 0, emissive: '#ff6a24', emissiveIntensity: FIREBOX_GLOW }));
    fireboxMat.name = `firebox ${fp.id}`;
    // the fire: where it burns (local), how wide and high the flames are
    let bed = null; // { x0, x1, z0, z1, y } or { r, y } (round)
    let flame = null; // { y, z, w, h }

    if (!fp.masonry && fp.shape === 'box') {
      // ---- a box stove (vedovn on legs, peisovn on the floor with a log store)
      const tall = fp.type === 'fireplace-stove';
      const legH = tall ? 0 : LEG;
      const win = fp.window;
      const x0 = -w / 2, x1 = w / 2, z0 = -d / 2, z1 = d / 2, y0 = legH, y1 = h - TOP;
      const wx = win.width / 2, wy0 = win.sill, wy1 = win.sill + win.height, zb = z0 + 0.06;
      const holes = [{ x0: -wx, x1: wx, y0: wy0, y1: wy1 }];
      const ls = fp.logStore;
      if (ls) holes.push({ x0: x0 + 0.05, x1: x1 - 0.05, y0: ls.y0, y1: ls.y1 });
      body.rect('x-', x0, z0, z1, y0, y1);
      body.rect('x+', x1, z0, z1, y0, y1);
      body.rect('z-', z0, x0, x1, y0, y1);
      if (legH > 0) body.rect('y-', y0, x0, x1, z0, z1);
      body.front(z1, x0, x1, y0, y1, holes);
      // the top plate, 1 cm over the sides
      body.box(x0 - 0.01, y1, z0 - 0.01, x1 + 0.01, h, z1 + 0.01);
      if (legH > 0) {
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
          const cx = sx * (w / 2 - 0.05), cz = sz * (d / 2 - 0.05);
          trim.box(cx - 0.02, 0, cz - 0.02, cx + 0.02, legH, cz + 0.02, 'y+');
        }
      }
      // the firebox behind the glass, the door frame round it and its handle
      box.recess(-wx, wx, wy0, wy1, zb, z1);
      glass.rect('z+', z1 - GLASS_IN, -wx, wx, wy0, wy1);
      trim.box(-wx - FRAME, wy0 - FRAME, z1, -wx, wy1 + FRAME, z1 + PROUD, 'z-');
      trim.box(wx, wy0 - FRAME, z1, wx + FRAME, wy1 + FRAME, z1 + PROUD, 'z-');
      trim.box(-wx, wy0 - FRAME, z1, wx, wy0, z1 + PROUD, 'z- x- x+');
      trim.box(-wx, wy1, z1, wx, wy1 + FRAME, z1 + PROUD, 'z- x- x+');
      const hy = (wy0 + wy1) / 2;
      trim.box(wx + FRAME * 0.3, hy - 0.07, z1 + PROUD, wx + FRAME * 0.3 + 0.014, hy + 0.07, z1 + PROUD + 0.03, 'z-');
      if (ls) {
        // the log store: an open niche with logs stacked in it
        niche.recess(x0 + 0.05, x1 - 0.05, ls.y0, ls.y1, z0 + 0.04, z1);
        const L = w - 0.14, r = 0.042;
        for (const [lx, ly, lz] of [[0, ls.y0 + r, z1 - 0.07], [0.01, ls.y0 + r, z1 - 0.16], [-0.01, ls.y0 + r, z1 - 0.25], [0, ls.y0 + 3 * r * 0.9, z1 - 0.115], [0.02, ls.y0 + 3 * r * 0.9, z1 - 0.205]]) {
          if (lz - r < z0 + 0.04) continue;
          logs.add(new THREE.CylinderGeometry(r, r * 0.92, L, 9), new THREE.Matrix4().makeRotationZ(Math.PI / 2).setPosition(lx, ly, lz));
        }
      }
      bed = { x0: -wx + 0.02, x1: wx - 0.02, z0: zb + 0.03, z1: z1 - GLASS_IN - 0.03, y: wy0 };
      flame = { y: wy0 + 0.03, z: (zb + z1 - GLASS_IN) / 2, w: win.width * 0.75, h: win.height * 0.92 };
    } else if (!fp.masonry) {
      // ---- a round stove on a round base, its door curved in the front
      const r = w / 2, ri = r - INNER;
      const win = fp.window;
      const half = win.width / 2 / r;
      const wy0 = win.sill, wy1 = win.sill + win.height;
      body.cyl(0, 0, r * 0.8, 0, ROUND_BASE, 0, 2 * Math.PI, segs);
      body.ring(0, 0, 0, r, ROUND_BASE, 0, 2 * Math.PI, segs, false);
      body.cyl(0, 0, r, ROUND_BASE, wy0, 0, 2 * Math.PI, segs);
      body.cyl(0, 0, r, wy0, wy1, half, 2 * Math.PI - half, Math.max(8, Math.round(segs * (1 - half / Math.PI))));
      body.cyl(0, 0, r, wy1, h - TOP, 0, 2 * Math.PI, segs);
      // the top plate
      body.cyl(0, 0, r + 0.01, h - TOP, h, 0, 2 * Math.PI, segs);
      body.ring(0, 0, 0, r + 0.01, h, 0, 2 * Math.PI, segs, true);
      body.ring(0, 0, r, r + 0.01, h - TOP, 0, 2 * Math.PI, segs, false);
      // the firebox: a cylinder inside (not where the window is), its floor and ceiling, the jambs of the window
      const ws = Math.max(4, Math.round((segs * half) / Math.PI));
      box.cyl(0, 0, ri, wy0, wy1, half, 2 * Math.PI - half, segs, true);
      // (floor and ceiling as fans from the middle: out to the shell in the window, to the firebox's wall elsewhere)
      for (const [y, up] of [[wy0, true], [wy1, false]]) {
        box.ring(0, 0, 0, r, y, -half, half, ws, up);
        box.ring(0, 0, 0, ri, y, half, 2 * Math.PI - half, segs, up);
      }
      for (const [a, s] of [[-half, 1], [half, -1]]) {
        // the jamb at the window's edge, facing into the window
        const n = [s * Math.cos(a), 0, -s * Math.sin(a)];
        const pi = [ri * Math.sin(a), 0, ri * Math.cos(a)], po = [r * Math.sin(a), 0, r * Math.cos(a)];
        const q = (p, y) => [p[0], y, p[2]];
        if (s > 0) box.quad(q(po, wy0), q(pi, wy0), q(pi, wy1), q(po, wy1), [0, wy0], [INNER, wy0], [INNER, wy1], [0, wy1], n, n, n, n);
        else box.quad(q(pi, wy0), q(po, wy0), q(po, wy1), q(pi, wy1), [0, wy0], [INNER, wy0], [INNER, wy1], [0, wy1], n, n, n, n);
      }
      glass.cyl(0, 0, r - GLASS_IN, wy0, wy1, -half, half, ws);
      // the handle beside the window
      const ha = half + 0.1, hy = (wy0 + wy1) / 2;
      trim.add(new THREE.BoxGeometry(0.014, 0.14, 0.03), new THREE.Matrix4().makeRotationY(ha).setPosition((r + 0.015) * Math.sin(ha), hy, (r + 0.015) * Math.cos(ha)));
      bed = { r: ri * 0.72, y: wy0 };
      flame = { y: wy0 + 0.03, z: 0, w: Math.min(win.width, ri * 1.4) * 0.8, h: win.height * 0.92 };
    } else {
      // ---- a surround (insert, open fireplace): round its chimney, its opening with the firebox behind
      const o = fp.opening, s = fp.surround;
      const x0 = -w / 2, x1 = w / 2, z0 = -d / 2, z1 = d / 2;
      const ox = o.width / 2, oy0 = o.sill, oy1 = o.sill + o.height, zb = z1 - o.depth;
      const ceilY = H.ceilingHeightAt ? H.ceilingHeightAt(fp.at[0], fp.at[1], fp.floorY + 0.5) : Infinity;
      body.rect('x-', x0, z0, z1, 0, h);
      body.rect('x+', x1, z0, z1, 0, h);
      if (fp.placement === 'free') body.rect('z-', z0, x0, x1, 0, h);
      body.front(z1, x0, x1, 0, h, [{ x0: -ox, x1: ox, y0: oy0, y1: oy1 }]);
      if (fp.floorY + h < ceilY - 0.005) {
        body.rect('y+', h, x0, x1, z0, z1);
        if (fp.cornerAt) {
          // in a corner: the triangle between its back and the corner, on top
          const c = [fp.cornerAt[0] - fp.at[0], fp.cornerAt[1] - fp.at[1]];
          const lc = [c[0] * fp.side[0] + c[1] * fp.side[1], c[0] * fp.facing[0] + c[1] * fp.facing[1]];
          const a = [x0, h, z0], b = [x1, h, z0], k = [lc[0], h, lc[1]];
          body.tri(a, k, b, [a[0], a[2]], [k[0], k[2]], [b[0], b[2]]);
        }
      }
      box.recess(-ox, ox, oy0, oy1, zb, z1);
      if (fp.type === 'insert') {
        // the insert: a steel frame round the opening, the glass door just inside it, a handle
        glass.rect('z+', z1 - 0.02, -ox, ox, oy0, oy1);
        const F = 0.045, P = 0.012;
        trim.box(-ox - F, oy0 - F, z1, -ox, oy1 + F, z1 + P, 'z-');
        trim.box(ox, oy0 - F, z1, ox + F, oy1 + F, z1 + P, 'z-');
        trim.box(-ox, oy0 - F, z1, ox, oy0, z1 + P, 'z- x- x+');
        trim.box(-ox, oy1, z1, ox, oy1 + F, z1 + P, 'z- x- x+');
        trim.box(ox - 0.05, oy1 + F * 0.25, z1 + P, ox - 0.03, oy1 + F * 0.75, z1 + P + 0.025, 'z-');
      } else if (fp.mantel) {
        // the mantel shelf over the opening
        const m = fp.mantel;
        const shelf = new Geo();
        shelf.box(x0 - 0.05, m.y, z1, x1 + 0.05, m.y + m.thickness, z1 + m.depth, 'z-');
        const sm = meshOf(shelf, mat('painted', m.color, { roughness: 0.7 }), `fireplace-mantel:${fp.id}`);
        if (sm) root.add(sm);
      }
      bed = { x0: -ox + 0.06, x1: ox - 0.06, z0: zb + 0.05, z1: z1 - (fp.type === 'insert' ? 0.06 : 0.1), y: oy0 };
      flame = { y: oy0 + 0.035, z: zb + o.depth * 0.45, w: o.width * 0.62, h: o.height * 0.8 };
      const bm = meshOf(body, finish(s.material, s.color), `fireplace-surround:${fp.id}`);
      if (bm) root.add(bm);
    }

    if (!fp.masonry) {
      const bm = meshOf(body, fp.material === 'soapstone' ? mat('painted', fp.color, { roughness: 0.78 }) : steel(fp.color), `fireplace-body:${fp.id}`);
      if (bm) root.add(bm);
    }
    for (const [geo, material, name, shadow] of [[trim, trimMat, 'trim', true], [box, fireboxMat, 'firebox', false], [niche, sootMat, 'logstore', false], [glass, stoveGlass(), 'glass', false]]) {
      const m = meshOf(geo, material, `fireplace-${name}:${fp.id}`, { shadow });
      if (m) root.add(m);
    }
    // a stove without a chimney still has its flue collar on top
    if (!fp.chimneyId && !fp.masonry) {
      const c = new Geo();
      const oz = fp.shape === 'round' ? 0 : -d / 2 + Math.min(0.14, d / 2);
      c.cyl(0, oz, fp.outlet.radius, h, h + 0.12, 0, 2 * Math.PI, 20);
      const m = meshOf(c, trimMat, `fireplace-collar:${fp.id}`);
      if (m) root.add(m);
    }

    // ---- the fire: embers (the lamp's glowing part), logs on them, flames over them
    if (fp.fire && bed) {
      if (bed.r) embers.add(new THREE.CylinderGeometry(bed.r, bed.r, 0.025, 24), new THREE.Matrix4().makeTranslation(0, bed.y + 0.0125, 0));
      else embers.box(bed.x0, bed.y, bed.z0, bed.x1, bed.y + 0.025, bed.z1, 'y-');
      const span = bed.r ? bed.r * 1.6 : Math.min(bed.x1 - bed.x0, 0.75);
      const zc = bed.r ? 0 : (bed.z0 + bed.z1) / 2;
      const dz = bed.r ? bed.r * 0.35 : Math.min(0.06, (bed.z1 - bed.z0) / 4);
      const lr = fp.type === 'open' ? 0.05 : 0.038;
      const L = span * 0.85;
      // two logs side by side (a little askew) and one across them
      logs.add(new THREE.CylinderGeometry(lr, lr * 0.9, L, 9), new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(0, 0.12, Math.PI / 2)).setPosition(0, bed.y + 0.025 + lr, zc - dz));
      logs.add(new THREE.CylinderGeometry(lr * 0.9, lr, L * 0.95, 9), new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(0, -0.1, Math.PI / 2)).setPosition(0.01, bed.y + 0.025 + lr, zc + dz));
      logs.add(new THREE.CylinderGeometry(lr * 0.85, lr * 0.8, L * 0.8, 9), new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(0, 0.9, Math.PI / 2)).setPosition(0, bed.y + 0.025 + lr * 2.6, zc));
      const emberMat = keep(emissive('#ff8a3a', EMBER_GLOW, { color: '#1f120c' }));
      emberMat.emissiveMap = emberMap();
      emberMat.map = null;
      emberMat.roughness = 0.95;
      emberMat.name = `embers ${fp.id}`;
      const em = meshOf(embers, emberMat, `fireplace-embers:${fp.id}`, { shadow: false });
      root.add(em);
      // the flames: three crossed sprites from the logs up, each its own frame of the atlas
      const flames = [];
      for (let k = 0; k < 3; k++) {
        const tex = keep(flameTex.clone());
        tex.offset.x = k / FLAME_FRAMES;
        const fm = keep(new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(FLAME_GAIN, FLAME_GAIN, FLAME_GAIN), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: true }));
        fm.name = `flame ${fp.id}`;
        const sc = k ? 0.72 : 1;
        const g = keep(new THREE.PlaneGeometry(flame.w * sc, flame.h * sc).translate(0, (flame.h * sc) / 2, 0));
        const m = new THREE.Mesh(g, fm);
        m.name = `fireplace-flame:${fp.id}:${k}`;
        m.position.set(k === 0 ? 0 : (k === 1 ? -1 : 1) * flame.w * 0.18, flame.y, flame.z);
        m.rotation.y = [0, 0.95, -0.95][k];
        m.castShadow = false;
        m.receiveShadow = false;
        m.userData.noCollide = true;
        root.add(m);
        meshes.push(m);
        flames.push({ mesh: m, mat: fm, tex, phase: k * 1.37, base: m.scale.clone() });
      }
      fires.push({ fp, embers: emberMat, firebox: fireboxMat, flames, t: Math.random() * 10 });
      // (no ':' in the id: lighting.js groups the glowing parts of a fixture by the id before one)
      lights.push({
        id: fp.lightGroup, group: fp.lightGroup, label: fp.name || 'Peis', type: 'fire', fitting: fp.type, roomId: fp.roomId, levelId: fp.levelId,
        position: new THREE.Vector3(...fp.fire.position), direction: new THREE.Vector3(...fp.fire.direction).normalize(),
        colorK: fp.fire.colorK, lumens: fp.fire.lumens, emissiveMeshes: [em], flicker: true,
      });
    } else fireboxMat.emissiveIntensity = 0;
    const lm = meshOf(logs, logMat, `fireplace-logs:${fp.id}`);
    if (lm) root.add(lm);

    // ---- the hearth plate (world plan, on the floor)
    if (fp.hearth) {
      const hp = fp.hearth;
      const y0 = fp.floorY, y1 = fp.floorY + hp.thickness;
      const top = new Geo(), edge = new Geo();
      const P = hp.polygon;
      const c = P.reduce((s, p) => [s[0] + p[0] / P.length, s[1] + p[1] / P.length], [0, 0]);
      for (let k = 1; k < P.length - 1; k++) {
        const a = [P[0][0], y1, P[0][1]], b = [P[k][0], y1, P[k][1]], q = [P[k + 1][0], y1, P[k + 1][1]];
        // facing up: (b − a) × (q − a) has y > 0
        const up = (b[2] - a[2]) * (q[0] - a[0]) - (b[0] - a[0]) * (q[2] - a[2]) > 0;
        if (up) top.tri(a, b, q, [a[0], a[2]], [b[0], b[2]], [q[0], q[2]]);
        else top.tri(a, q, b, [a[0], a[2]], [q[0], q[2]], [b[0], b[2]]);
      }
      let s = 0;
      for (let k = 0; k < P.length; k++) {
        const a = P[k], b = P[(k + 1) % P.length];
        const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (L < 1e-6) continue;
        // facing away from the middle
        const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        const out = (b[1] - a[1]) * (m[0] - c[0]) - (b[0] - a[0]) * (m[1] - c[1]) < 0;
        const [p, q] = out ? [a, b] : [b, a];
        edge.quad([p[0], y0, p[1]], [q[0], y0, q[1]], [q[0], y1, q[1]], [p[0], y1, p[1]], [s, y0], [s + L, y0], [s + L, y1], [s, y1]);
        s += L;
      }
      const glassy = hp.material === 'glass' ? hearthGlass(hp.color) : null;
      const solid = hp.material === 'steel' ? mat('painted', hp.color, { roughness: 0.4, metalness: 0.5 }) : mat('painted', hp.color, { roughness: 0.55 });
      const tm = meshOf(top, glassy ? glassy.top : solid, `fireplace-hearth:${fp.id}`, { shadow: !glassy });
      const ed = meshOf(edge, glassy ? glassy.edge : solid, `fireplace-hearth-edge:${fp.id}`, { shadow: false });
      for (const m of [tm, ed]) if (m) parentOf(fp.levelId)?.add(m);
    }

    // ---- the flue pipe of a stove into a masonry chimney (world), with a rosette where it goes in
    if (fp.flue) {
      const pts = fp.flue.points.map((p) => new THREE.Vector3(...p));
      const path = new THREE.CurvePath();
      const rb = 0.12;
      for (let k = 0; k < pts.length - 1; k++) {
        const a = k === 0 ? pts[k] : pts[k].clone().addScaledVector(pts[k + 1].clone().sub(pts[k]).normalize(), rb);
        const b = k === pts.length - 2 ? pts[k + 1] : pts[k + 1].clone().addScaledVector(pts[k].clone().sub(pts[k + 1]).normalize(), rb);
        path.add(new THREE.LineCurve3(a, b));
        if (k < pts.length - 2) {
          const c = pts[k + 2].clone().sub(pts[k + 1]).normalize().multiplyScalar(rb).add(pts[k + 1]);
          path.add(new THREE.QuadraticBezierCurve3(b, pts[k + 1], c));
        }
      }
      const pipe = new Geo();
      pipe.add(new THREE.TubeGeometry(path, 24, fp.flue.radius, 16, false));
      // the rosette on the chimney's face
      const n = new THREE.Vector3(fp.flue.normal[0], 0, fp.flue.normal[1]);
      const end = pts[pts.length - 1];
      const ring = new THREE.RingGeometry(fp.flue.radius, fp.flue.radius + 0.04, 24);
      ring.lookAt(n);
      pipe.add(ring, new THREE.Matrix4().makeTranslation(end.x + n.x * 0.004, end.y, end.z + n.z * 0.004));
      const m = meshOf(pipe, steel(fp.color ?? '#1d1e20'), `fireplace-flue:${fp.id}`);
      if (m) parentOf(fp.levelId)?.add(m);
    }

    // ---- the collider: its footprint up to its top (at an angle: a box mesh turned with it)
    const y0 = fp.floorY, y1 = (fp.masonry ? fp.floorY : fp.baseY) + h;
    const aligned = Math.abs(fp.facing[0]) < 1e-6 || Math.abs(fp.facing[1]) < 1e-6;
    if (aligned) {
      const xs = fp.footprint.map((p) => p[0]), zs = fp.footprint.map((p) => p[1]);
      colliders.push(new THREE.Box3(new THREE.Vector3(Math.min(...xs), y0, Math.min(...zs)), new THREE.Vector3(Math.max(...xs), y1, Math.max(...zs))));
    } else {
      const g = keep(new THREE.BoxGeometry(w, y1 - y0, d));
      const m = new THREE.Mesh(g);
      m.name = `fireplace-collider:${fp.id}`;
      m.visible = false;
      m.position.set(fp.at[0], (y0 + y1) / 2, fp.at[1]);
      m.rotation.y = fp.yaw;
      m.updateMatrixWorld(true);
      colliders.push(m);
    }
  }

  /** The flames: their frames, sway and height, following the embers' glow (on/off and the exposure lighting.js gives them). */
  function update(dt = 0) {
    for (const f of fires) {
      f.t += dt;
      const glow = Math.max(0, f.embers.emissiveIntensity / EMBER_GLOW);
      const flick = 0.88 + 0.12 * Math.sin(f.t * 11.3) * Math.sin(f.t * 4.7 + 1.1);
      f.firebox.emissiveIntensity = FIREBOX_GLOW * glow * flick;
      for (const fl of f.flames) {
        const s = FLAME_GAIN * glow;
        fl.mesh.visible = s > 0.01;
        if (!fl.mesh.visible) continue;
        fl.mat.color.setScalar(s * (0.9 + 0.1 * Math.sin(f.t * 17 + fl.phase)));
        fl.tex.offset.x = (Math.floor(f.t * 9 + fl.phase * 3) % FLAME_FRAMES) / FLAME_FRAMES;
        fl.mesh.scale.set(fl.base.x * (0.92 + 0.08 * Math.sin(f.t * 5.3 + fl.phase)), fl.base.y * (0.86 + 0.14 * Math.sin(f.t * 7.9 + fl.phase * 2) * Math.sin(f.t * 3.1 + fl.phase)), 1);
      }
    }
  }
  return { meshes, colliders, lights, fires, update };
}
