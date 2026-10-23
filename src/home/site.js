import * as THREE from 'three';
import { mat } from './materials.js';
import { MeshBatcher } from '../world/buildKit.js';
import { facadeFinish, surfaceFinish } from '../world/surfaces.js';
import { sitePieces, SITE_DEFAULTS } from './sitegeom.js';

/**
 * SITE – the outside of a generated house (notes/uteomradet.md; the model is home/sitegeom.js, read by layout.js into
 * layout.house.site). Built by rooms.js after the decks when the house has a `site`:
 *   • the ground: the terrain cut along the house, the surfaces, the lot and the walls' feet (sitePieces) – one mesh
 *     per material (lawn, meadow, gravel, asphalt, pavers, slabs, concrete, bark), smooth normals, UVs in metres (pavers
 *     and slabs along the surface's longest edge); it receives shadows and casts none;
 *   • the retaining walls of walled surfaces and the garden walls (concrete, stone or blocks), their tops following the
 *     higher side;
 *   • garden steps: solid treads with cheek walls, an invisible walking wedge along the nosing line (as decks.js);
 *   • fences (posts, two rails, pickets), screens (posts and closed board panels) and hedges (a rounded, slightly
 *     uneven profile), all following the ground.
 * Everything is batched per material in one MeshBatcher (a dozen draw calls for a whole site) and casts no shadow.
 * Collision: the ground, the walls, the cheek walls, posts, rails, panels and hedges are solid (the octree); every
 * flight of steps is walked on its wedge.
 *
 *   buildSite(site, opts) → { group, colliders }
 *
 * opts: { keep, quality }. Mesh names: `site:<material>` (the batches), `site-wedge:<id>` (the steps' colliders, not in
 * the scene).
 */

const UP = new THREE.Vector3(0, 1, 0);
const shade = (hex, k) => `#${new THREE.Color(hex).multiplyScalar(k).getHexString()}`;
const yawOf = (d) => Math.atan2(-d[1], d[0]);
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const add = (a, b, k = 1) => [a[0] + b[0] * k, a[1] + b[1] * k];
const len = (a) => Math.hypot(a[0], a[1]);
const norm = (a) => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l];
};
/** A small deterministic hash in [−1, 1] (the hedges' unevenness). */
const jitter = (x, z, k) => {
  const s = Math.sin(x * 12.9898 + z * 78.233 + k * 37.719) * 43758.5453;
  return (s - Math.floor(s)) * 2 - 1;
};

/** Collects triangles with UVs; geometry() with flat normals, or smooth ones welded by position. */
class Tris {
  constructor() {
    this.pos = [];
    this.uv = [];
  }
  tri(a, b, c, ua, ub, uc) {
    this.pos.push(...a, ...b, ...c);
    this.uv.push(...ua, ...ub, ...uc);
  }
  /** A convex polygon (3D points) as a fan, turned so its normal points along `toward` (a vector). */
  poly(P, U, toward) {
    const a = new THREE.Vector3(...P[0]), b = new THREE.Vector3(...P[1]), c = new THREE.Vector3(...P[P.length - 1]);
    const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a));
    let flip = n.dot(toward) < 0;
    // a degenerate start (collinear): judge by the whole polygon (Newell)
    if (n.lengthSq() < 1e-14) {
      const m = new THREE.Vector3();
      for (let i = 0; i < P.length; i++) {
        const p = P[i], q = P[(i + 1) % P.length];
        m.x += (p[1] - q[1]) * (p[2] + q[2]);
        m.y += (p[2] - q[2]) * (p[0] + q[0]);
        m.z += (p[0] - q[0]) * (p[1] + q[1]);
      }
      flip = m.dot(toward) < 0;
    }
    for (let k = 1; k < P.length - 1; k++) {
      if (flip) this.tri(P[0], P[k + 1], P[k], U[0], U[k + 1], U[k]);
      else this.tri(P[0], P[k], P[k + 1], U[0], U[k], U[k + 1]);
    }
  }
  geometry(smooth = false) {
    if (!this.pos.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    if (!smooth) {
      g.computeVertexNormals();
      return g;
    }
    // smooth: face normals (area-weighted) summed per position
    const P = this.pos, acc = new Map(), keyOf = (i) => `${Math.round(P[i] * 1e4)},${Math.round(P[i + 1] * 1e4)},${Math.round(P[i + 2] * 1e4)}`;
    const keys = [];
    for (let i = 0; i < P.length; i += 9) {
      const ax = P[i], ay = P[i + 1], az = P[i + 2];
      const ux = P[i + 3] - ax, uy = P[i + 4] - ay, uz = P[i + 5] - az;
      const vx = P[i + 6] - ax, vy = P[i + 7] - ay, vz = P[i + 8] - az;
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      for (let k = 0; k < 3; k++) {
        const key = keyOf(i + k * 3);
        keys.push(key);
        const a = acc.get(key);
        if (a) {
          a[0] += nx;
          a[1] += ny;
          a[2] += nz;
        } else acc.set(key, [nx, ny, nz]);
      }
    }
    const N = new Float32Array(P.length);
    keys.forEach((key, v) => {
      const a = acc.get(key);
      const l = Math.hypot(a[0], a[1], a[2]) || 1;
      N[v * 3] = a[0] / l;
      N[v * 3 + 1] = a[1] / l;
      N[v * 3 + 2] = a[2] / l;
    });
    g.setAttribute('normal', new THREE.BufferAttribute(N, 3));
    return g;
  }
}

/**
 * A vertical prism over a convex plan polygon: the top at `tops[i]` over foot[i], the bottom at `bots[i]`; the sides
 * listed in `skip` (side k: foot[k] → foot[k + 1]) are left out. UVs in metres (sides: along, up; top: x, z).
 */
function prism(T, foot, tops, bots, skip = new Set()) {
  const n = foot.length;
  const c = foot.reduce((s, p) => [s[0] + p[0] / n, s[1] + p[1] / n], [0, 0]);
  T.poly(foot.map((p, i) => [p[0], tops[i], p[1]]), foot.map((p) => [p[0], p[1]]), UP);
  let run = 0;
  for (let k = 0; k < n; k++) {
    const a = foot[k], b = foot[(k + 1) % n];
    const L = len(sub(b, a));
    if (!skip.has(k) && L > 1e-6) {
      const mid = [(a[0] + b[0]) / 2 - c[0], 0, (a[1] + b[1]) / 2 - c[1]];
      T.poly([[a[0], bots[k], a[1]], [b[0], bots[(k + 1) % n], b[1]], [b[0], tops[(k + 1) % n], b[1]], [a[0], tops[k], a[1]]],
        [[run, bots[k]], [run + L, bots[(k + 1) % n]], [run + L, tops[(k + 1) % n]], [run, tops[k]]], new THREE.Vector3(...mid));
    }
    run += L;
  }
}

/** Left / right offsets of a polyline with mitred joints: across[i] (unit-ish, scaled 1/cos at a joint). */
function acrossAt(line) {
  return line.map((p, i) => {
    const dIn = i > 0 ? norm(sub(p, line[i - 1])) : null;
    const dOut = i < line.length - 1 ? norm(sub(line[i + 1], p)) : null;
    const nIn = dIn && [-dIn[1], dIn[0]], nOut = dOut && [-dOut[1], dOut[0]];
    const n = nIn && nOut ? norm([nIn[0] + nOut[0], nIn[1] + nOut[1]]) : nIn || nOut;
    const c = nIn && nOut ? Math.max(0.35, n[0] * nOut[0] + n[1] * nOut[1]) : 1;
    return [n[0] / c, n[1] / c];
  });
}

/** Stations along a polyline at most `step` apart (every vertex is one): { p, i (segment), across }. */
function stations(line, step) {
  const A = acrossAt(line);
  const out = [];
  for (let i = 0; i < line.length - 1; i++) {
    const a = line[i], b = line[i + 1];
    const L = len(sub(b, a));
    const m = Math.max(1, Math.ceil(L / step));
    const n = [-(b[1] - a[1]) / L, (b[0] - a[0]) / L];
    for (let k = i === 0 ? 0 : 1; k <= m; k++) {
      const t = k / m;
      out.push({ p: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], seg: i, across: k === 0 ? A[i] : k === m ? A[i + 1] : n, s: (out.length ? out[out.length - 1].s : 0) + (k === 0 ? 0 : L / m) });
    }
  }
  return out;
}

/**
 * The geometry of a profile (u, y) extruded across [−w/2, w/2]: local x = out·u + across·c (as decks.js's flights),
 * UVs in metres.
 */
function extrude(prof, origin, out, across, w, c0 = 0) {
  const shape = new THREE.Shape(prof.map(([u, y]) => new THREE.Vector2(u, y)));
  const g = new THREE.ExtrudeGeometry(shape, { depth: w, bevelEnabled: false });
  g.translate(0, 0, -w / 2 + c0);
  const m = new THREE.Matrix4().makeBasis(new THREE.Vector3(out[0], 0, out[1]), UP, new THREE.Vector3(across[0], 0, across[1])).setPosition(origin[0], 0, origin[1]);
  if (m.determinant() < 0) {
    g.scale(1, 1, -1);
    m.makeBasis(new THREE.Vector3(out[0], 0, out[1]), UP, new THREE.Vector3(-across[0], 0, -across[1])).setPosition(origin[0], 0, origin[1]);
  }
  g.applyMatrix4(m);
  const pos = g.attributes.position, nrm = g.attributes.normal, uv = g.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    if (Math.abs(nrm.getY(i)) > 0.5) uv.setXY(i, x, z);
    else uv.setXY(i, Math.abs(nrm.getX(i)) > Math.abs(nrm.getZ(i)) ? z : x, y);
  }
  return g;
}

/**
 * Builds the site of layout.house.site.
 * @param {object} site  layout.house.site (sitegeom.js resolveSite)
 * @param {{ keep?: Function, quality?: object }} [opts]
 * @returns {{ group: THREE.Group, colliders: Array<THREE.Object3D> }}
 */
export function buildSite(site, opts = {}) {
  const { keep = (x) => x, quality = {} } = opts;
  const res = quality.level === 'high' ? 1 : 0.5;
  const colliders = [];
  const batch = new MeshBatcher('site', { castShadow: false });
  const tryMat = (f, hex, rough = 0.9) => {
    try {
      return f() ?? mat('painted', hex, { roughness: rough });
    } catch {
      return mat('painted', hex, { roughness: rough }); // no texture support (Node)
    }
  };
  const mats = new Map();
  const once = (key, f) => mats.get(key) ?? mats.set(key, f()).get(key);
  const groundMat = (surface, hex) => once(`g|${surface}|${hex}`, () => {
    switch (surface) {
      case 'grass': return tryMat(() => mat('moss', hex, { roughness: 1 }), hex, 1);
      case 'bark': return tryMat(() => mat('soil', hex, { roughness: 1 }), hex, 1);
      case 'gravel': return tryMat(() => facadeFinish('render', hex, { res, roughness: 1 }), hex, 1);
      case 'asphalt': return tryMat(() => facadeFinish('render', hex, { res, roughness: 0.92 }), hex, 0.92);
      case 'concrete': return tryMat(() => facadeFinish('concrete', hex, { res }), hex);
      case 'pavers': return tryMat(() => surfaceFinish('tiles', hex, { size: [0.21, 0.14], grout: 0.005, groutColor: shade(hex, 0.68), res, roughness: 0.85 }), hex, 0.85);
      case 'slabs': return tryMat(() => surfaceFinish('tiles', hex, { size: [0.6, 0.4], grout: 0.008, groutColor: shade(hex, 0.72), res, roughness: 0.85 }), hex, 0.85);
      default: return mat('painted', hex, { roughness: 0.95 });
    }
  });
  const wallMat = (material, hex) => once(`w|${material}|${hex}`, () => tryMat(() => facadeFinish(material === 'block' ? 'brick' : material, hex, { res }), hex));

  // ---- the ground
  {
    const pieces = sitePieces(site);
    const byKey = new Map();
    const rot = site.surfaces.map((s) => {
      // pavers and slabs run along the surface's longest edge
      let best = [1, 0], bl = 0;
      const P = s.polygon;
      for (let i = 0; i < P.length; i++) {
        const d = sub(P[(i + 1) % P.length], P[i]);
        if (len(d) > bl) {
          bl = len(d);
          best = norm(d);
        }
      }
      return best;
    });
    for (const p of pieces) {
      let T = byKey.get(p.key);
      if (!T) byKey.set(p.key, (T = new Tris()));
      const r = p.surf >= 0 ? rot[p.surf] : [1, 0];
      const t = p.tri;
      const uv = (i) => [t[i] * r[0] + t[i + 2] * r[1], -t[i] * r[1] + t[i + 2] * r[0]];
      T.tri([t[0], t[1], t[2]], [t[3], t[4], t[5]], [t[6], t[7], t[8]], uv(0), uv(3), uv(6));
    }
    for (const [key, T] of byKey) {
      const g = T.geometry(true);
      if (!g) continue;
      const s = key === 'grass' || key === 'meadow' ? null : site.surfaces[Number(key)];
      const m = s ? groundMat(s.surface, s.color) : groundMat('grass', key === 'grass' ? site.grass : site.meadow);
      batch.add(g, m, { collide: true, receiveShadow: true });
      g.dispose();
    }
  }

  // ---- the retaining walls (the walled surfaces' edges)
  {
    const by = new Map();
    for (const r of site.retaining) {
      const k = `${r.material}|${r.color}`;
      const T = by.get(k) ?? by.set(k, new Tris()).get(k);
      // quad: inner edge (against the surface) → its end → outer edge → its start; the ends only where the chain ends
      const skip = new Set();
      if (!r.capEnd) skip.add(1);
      if (!r.capStart) skip.add(3);
      prism(T, r.quad, r.top, r.quad.map(() => r.bottom), skip);
    }
    for (const [k, T] of by) {
      const [material, color] = k.split('|');
      const g = T.geometry();
      batch.add(g, wallMat(material, color), { collide: true });
      g.dispose();
    }
  }

  // ---- garden walls: along their line, centred, the top `height` over the ground (or at `top`)
  for (const w of site.walls) {
    const T = new Tris();
    const st = stations(w.line, 1.0);
    const h = (p) => site.heightAt(p[0], p[1]);
    for (let k = 0; k < st.length - 1; k++) {
      const a = st[k], b = st[k + 1];
      const t = w.thickness / 2;
      const foot = [add(a.p, a.across, -t), add(b.p, b.across, -t), add(b.p, b.across, t), add(a.p, a.across, t)];
      const g = foot.map(h);
      const topA = w.top ?? h(a.p) + w.height, topB = w.top ?? h(b.p) + w.height;
      const bot = Math.min(...g) - 0.3;
      const skip = new Set();
      if (k > 0) skip.add(3);
      if (k < st.length - 2) skip.add(1);
      prism(T, foot, [topA, topB, topB, topA], foot.map(() => bot), skip);
    }
    const g = T.geometry();
    if (g) {
      batch.add(g, wallMat(w.material, w.color), { collide: true });
      g.dispose();
    }
  }

  // ---- garden steps: solid treads, cheek walls up to the ground beside them, a walking wedge
  for (const s of site.steps) {
    const { origin: O, out, across, width: w, length: L, top, bottom, risers: n, riserH: R, going: G } = s;
    const m = wallMat(s.material, s.color);
    const at = (u, c) => [O[0] + out[0] * u + across[0] * c, O[1] + out[1] * u + across[1] * c];
    // the lowest ground round the flight (the solid body goes down under it)
    let low = bottom;
    for (const u of [0, L / 2, L]) for (const c of [-w / 2 - s.cheek, w / 2 + s.cheek]) low = Math.min(low, site.heightAt(...at(u, c)));
    const base = low - 0.3;
    // treads: tread i (1…n) at top − i·R from (i − 1)·G to i·G; the last one is the foot's level
    const prof = [[0, base], [L, base], [L, bottom]];
    for (let i = n; i >= 1; i--) {
      prof.push([(i - 1) * G, top - i * R]);
      if (i > 1) prof.push([(i - 1) * G, top - (i - 1) * R]);
    }
    prof.push([0, top]);
    const g = extrude(prof, O, out, across, w);
    batch.add(g, m, { collide: false });
    g.dispose();
    if (s.cheeks) {
      // the cheek walls: over the nosing line by cheekOver, and never under the ground beside them
      const ch = s.cheek, over = SITE_DEFAULTS.steps.cheekOver;
      for (const side of [-1, 1]) {
        const c = side * (w / 2 + ch / 2);
        const tp = [];
        const m2 = Math.max(2, n + 1);
        for (let k = 0; k <= m2; k++) {
          const u = (L * k) / m2;
          const line = top + over - ((top - bottom) * u) / L;
          const ground = Math.max(site.heightAt(...at(u, side * (w / 2 + ch + 0.05))), site.heightAt(...at(u, side * (w / 2 + ch / 2))));
          tp.push([u, Math.max(line, ground + 0.05)]);
        }
        const cp = [[0, base], [L, base], ...tp.reverse()];
        const gc = extrude(cp, O, out, across, ch, c);
        batch.add(gc, m, { collide: true });
        gc.dispose();
      }
    }
    // the walking wedge along the nosing line (as decks.js: invisible, closed, not in the scene)
    const wedge = new THREE.Mesh(keep(extrude([[-0.02, top], [-0.02, top - 0.3], [L, bottom - 0.1], [L, bottom]], O, out, across, w)));
    wedge.name = `site-wedge:${s.id}`;
    wedge.visible = false;
    wedge.userData.collider = 'site-step-wedge';
    wedge.updateMatrixWorld(true);
    colliders.push(wedge);
  }

  // ---- fences, screens, hedges
  for (const f of site.fences) {
    const h = (p) => site.heightAt(p[0], p[1]);
    if (f.kind === 'hedge') {
      const T = new Tris();
      const st = stations(f.line, 1.2);
      const W = 0.75;
      // the profile across (−1…1 of the half width) and up (0…1 of the height): a rounded top, slightly fuller low
      const PROF = [[-1, -0.15], [-1, 0.62], [-0.86, 0.86], [-0.5, 0.99], [0.5, 0.99], [0.86, 0.86], [1, 0.62], [1, -0.15]];
      const ring = st.map((q) => {
        const hw = (W / 2) * (1 + 0.07 * jitter(q.p[0], q.p[1], 1));
        const hh = f.height * (1 + 0.05 * jitter(q.p[0], q.p[1], 2));
        const g0 = h(q.p);
        return PROF.map(([a, y]) => [q.p[0] + q.across[0] * a * hw, g0 + (y < 0 ? y : y * hh), q.p[1] + q.across[1] * a * hw]);
      });
      for (let k = 0; k < st.length - 1; k++) {
        const A = ring[k], B = ring[k + 1];
        for (let j = 0; j < PROF.length - 1; j++) {
          const mid = [(A[j][0] + A[j + 1][0]) / 2 - st[k].p[0], 0, (A[j][2] + A[j + 1][2]) / 2 - st[k].p[1]];
          const toward = new THREE.Vector3(mid[0], PROF[j][1] + PROF[j + 1][1] > 1.5 ? 1 : 0, mid[2]);
          T.poly([A[j], B[j], B[j + 1], A[j + 1]], [[st[k].s, j * 0.25], [st[k + 1].s, j * 0.25], [st[k + 1].s, (j + 1) * 0.25], [st[k].s, (j + 1) * 0.25]], toward);
        }
      }
      // the two ends
      for (const [k, sgn] of [[0, -1], [st.length - 1, 1]]) {
        const d = norm(k === 0 ? sub(st[1].p, st[0].p) : sub(st[k].p, st[k - 1].p));
        T.poly(ring[k], ring[k].map((p) => [p[0] + p[2], p[1]]), new THREE.Vector3(d[0] * sgn, 0, d[1] * sgn));
      }
      const g = T.geometry(true);
      batch.add(g, once(`hedge|${f.color}`, () => tryMat(() => mat('moss', f.color, { roughness: 1 }), f.color, 1)), { collide: true });
      g.dispose();
      continue;
    }
    const screen = f.kind === 'screen';
    const wood = once(`fence|${f.kind}|${f.color}`, () => (screen
      ? tryMat(() => facadeFinish('wood', f.color, { profile: 'shadow', res }), f.color)
      : tryMat(() => mat('painted', f.color, { roughness: 0.8 }), f.color, 0.8)));
    const postMat = once(`post|${f.color}`, () => tryMat(() => mat('painted', screen ? shade(f.color, 0.85) : f.color, { roughness: 0.8 }), f.color, 0.8));
    const spacing = screen ? 1.8 : 2.0;
    const st = stations(f.line, spacing);
    const ps = screen ? 0.09 : 0.08;
    for (const q of st) {
      const g0 = h(q.p);
      const top = g0 + f.height + (screen ? 0.02 : 0.06);
      batch.box(ps, top - (g0 - 0.3), ps, q.p[0], (top + g0 - 0.3) / 2, q.p[1], postMat, { rot: [0, yawOf(norm([-q.across[1], q.across[0]])), 0], collide: true });
    }
    for (let k = 0; k < st.length - 1; k++) {
      const a = st[k].p, b = st[k + 1].p;
      const d = norm(sub(b, a)), L = len(sub(b, a));
      const ga = h(a), gb = h(b);
      if (screen) {
        // a closed panel of boards between the posts, from just over the ground to the top
        const T = new Tris();
        const t = 0.018;
        const a2 = add(a, d, ps / 2), b2 = add(b, d, -ps / 2);
        const n = [-d[1], d[0]];
        const foot = [add(a2, n, -t), add(b2, n, -t), add(b2, n, t), add(a2, n, t)];
        const bot = [ga + 0.04, gb + 0.04, gb + 0.04, ga + 0.04];
        const tops = [ga + f.height, gb + f.height, gb + f.height, ga + f.height];
        prism(T, foot, tops, bot);
        const g = T.geometry();
        batch.add(g, wood, { collide: true });
        g.dispose();
        continue;
      }
      // two rails (sloped with the ground) between the posts, and pickets
      for (const y of [0.22, f.height - 0.18]) {
        const yA = ga + y, yB = gb + y;
        const len3 = Math.hypot(L, yB - yA) - ps;
        batch.box(len3, 0.07, 0.04, (a[0] + b[0]) / 2 - d[1] * 0.04, (yA + yB) / 2, (a[1] + b[1]) / 2 + d[0] * 0.04, postMat, { rot: [0, yawOf(d), Math.atan2(yB - yA, L)], order: 'YXZ', collide: true });
      }
      const m = Math.max(1, Math.floor((L - ps) / 0.12));
      for (let j = 0; j < m; j++) {
        const u = ps / 2 + 0.06 + ((L - ps - 0.12) * (j + 0.5)) / m;
        const p = add(a, d, u);
        const g0 = h(p);
        const y0 = g0 + 0.06, y1 = g0 + f.height;
        batch.box(0.07, y1 - y0, 0.02, p[0] - d[1] * 0.07, (y0 + y1) / 2, p[1] + d[0] * 0.07, wood, { rot: [0, yawOf(d), 0], collide: false });
      }
    }
  }

  const group = batch.build();
  group.name = 'site';
  group.userData.site = true;
  for (const m of group.children) m.userData.site = true;
  group.updateMatrixWorld(true);
  colliders.push(group);
  return { group, colliders };
}
