import * as THREE from 'three';
import { paint, mat } from './materials.js';
import { roofFinish } from '../world/surfaces.js';
import { basis } from '../world/buildKit.js';
import { UP, wallLayer, groupGeometry, buildWindow, polygonTriangles } from './wallkit.js';
import {
  planeY, clipAll, subtractConvex, polyArea, inPolygon, inConvex, insideHalfPlanes, edgeDistance, ROOF_GAP, CLADDING_INTO_ROOF,
} from './roofgeom.js';

/**
 * ROOF – the roofs of the house format (notes/tak.md; the model is home/roofgeom.js, read by layout.js into
 * layout.house.roofs). Built by rooms.js after the ceilings, for every part of layout.house.roofs:
 *   • each face of the roof as a slab: the covering on top (surfaces.js roofFinish: takstein, skifer, papp, stålplater;
 *     UVs in metres across / down the slope), the soffit underneath ROOF_GAP above the inner plane (the sloped ceilings
 *     own that plane), the fascia / verge boards on the outer edges (the eave cut off at an ark's front);
 *   • holes for the openings of the dormers and for the roof windows (ceilings[].skylights under the roof – their
 *     shafts and windows are rooms.js's);
 *   • a ridge cap along the ridge and the hips (not on felt), half-round gutters along the eaves (`gutters`);
 *   • the dormers: their own slabs, the cheeks (the cladding of their sides, from the main roof up into theirs) and the
 *     front wall of a takopplett with its window (wallkit buildWindow) – its inside in the paint of the ceiling under it.
 * Everything goes into the level's scene root and is hidden with the ceilings (pickables.ceilings, no pick of its own),
 * no collision.
 *
 *   buildRoofs(H, opts) → { meshes, windows, linings: [{ ceilingId, mesh }] }
 *
 * opts: { roots (ctx.roots.levels), fallback (Group), keep, batchers, quality, skylights: [{ id, levelId, polygon }],
 *         cladding(levelId) → material, lining(levelId, x, z) → { material, ceilingId } | null,
 *         windowMaterials() → M for buildWindow, exteriorBatch(levelId, x, z) → the MeshBatcher of the room at x, z }
 */

const GUTTER_R = 0.065;

class Acc {
  constructor() {
    this.pos = [];
    this.uv = [];
  }
  tri(a, b, c, ua, ub, uc) {
    this.pos.push(...a, ...b, ...c);
    this.uv.push(...ua, ...ub, ...uc);
  }
  /** a quad a b c d (counter-clockwise seen from its front) */
  quad(a, b, c, d, ua, ub, uc, ud) {
    this.tri(a, b, c, ua, ub, uc);
    this.tri(a, c, d, ua, uc, ud);
  }
  build(material, name, keep) {
    if (!this.pos.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.computeVertexNormals();
    keep(g);
    const m = new THREE.Mesh(g, material);
    m.name = name;
    m.castShadow = true;
    m.receiveShadow = true;
    m.userData.noCollide = true;
    return m;
  }
}

/** UVs of a plane's top: u across the slope (along its contour lines), v down the slope, in metres in the plane. */
function slopeUV(p, fallbackDir) {
  const g = Math.hypot(p.a, p.b);
  const down = g > 1e-6 ? [-p.a / g, -p.b / g] : [fallbackDir[1], -fallbackDir[0]];
  const across = [-down[1], down[0]];
  const k = Math.sqrt(1 + g * g);
  return (x, z) => [x * across[0] + z * across[1], (x * down[0] + z * down[1]) * k];
}

/** The regions left of a convex polygon after cutting convex polygons out: [{ outer, holes }]. */
function cutRegions(poly, cuts) {
  let regions = [{ outer: poly, holes: [] }];
  for (const q of cuts) {
    if (q.length < 3) continue;
    const next = [];
    for (const r of regions) {
      const inter = clipAll(r.outer, insideHalfPlanes(q));
      if (!inter.length || Math.abs(polyArea(inter)) < 1e-6) {
        next.push(r);
        continue;
      }
      const inside = q.every((p) => inPolygon(p[0], p[1], r.outer) && edgeDistance(p, r.outer) > 1e-3);
      const clear = r.holes.every((h) => !clipAll(h, insideHalfPlanes(q)).length);
      if (inside && clear) {
        next.push({ outer: r.outer, holes: [...r.holes, q] });
        continue;
      }
      for (const piece of subtractConvex(r.outer, q)) next.push({ outer: piece, holes: r.holes.filter((h) => h.every((p) => inConvex(p[0], p[1], piece))) });
    }
    regions = next;
  }
  return regions;
}

const onLine = (hp, p) => Math.abs(hp.a * p[0] + hp.b * p[1] + hp.c) < 1e-6;

/**
 * Builds the roofs of layout.house (see the top of this file).
 * @param {object} H  layout.house
 * @param {object} opts
 */
export function buildRoofs(H, opts) {
  const { keep, batchers, quality = {} } = opts;
  const res = quality.level === 'low' ? 0.5 : 1;
  const meshes = [];
  const windows = [];
  const linings = [];
  const parts = H.roofs || [];
  if (!parts.length) return { meshes, windows, linings };
  const parentOf = (levelId) => opts.roots?.[levelId] ?? opts.fallback;
  const add = (m, levelId) => {
    if (!m) return;
    parentOf(levelId)?.add(m);
    meshes.push(m);
  };
  const covering = (part, color) => {
    try {
      return roofFinish(part.covering, color ?? part.color, { res });
    } catch {
      return mat('painted', color ?? part.color, { roughness: 0.75 }); // no texture support
    }
  };

  for (const part of parts) {
    const top = new Acc();
    const bottom = new Acc();
    const edges = new Acc();
    const caps = new Acc();
    const cheeks = new Acc();
    const outline = part.outline;
    const skylights = (opts.skylights || []).filter((s) => s.levelId === part.levelId && s.polygon.length >= 3);

    /** One slab face: the regions on plane p, the edges that get a fascia / verge. */
    const slab = (p, regions, edgeOf) => {
      const uvTop = slopeUV(p, part.frame.eu);
      for (const r of regions) {
        for (const t of polygonTriangles(r.outer, r.holes)) {
          const T = t.map(([x, z]) => [x, planeY(p, x, z) + p.tv, z]);
          const B = t.map(([x, z]) => [x, planeY(p, x, z) + ROOF_GAP, z]);
          // the top faces up, the soffit down: (b − a) × (c − a) y > 0 is up
          const up = (T[1][2] - T[0][2]) * (T[2][0] - T[0][0]) - (T[1][0] - T[0][0]) * (T[2][2] - T[0][2]) > 0;
          const [ta, tb, tc] = up ? T : [T[0], T[2], T[1]];
          top.tri(ta, tb, tc, uvTop(ta[0], ta[2]), uvTop(tb[0], tb[2]), uvTop(tc[0], tc[2]));
          const [ba, bb, bc] = up ? [B[0], B[2], B[1]] : B;
          bottom.tri(ba, bb, bc, [ba[0], ba[2]], [bb[0], bb[2]], [bc[0], bc[2]]);
        }
        const P = r.outer;
        const cx = P.reduce((s, q) => s + q[0], 0) / P.length, cz = P.reduce((s, q) => s + q[1], 0) / P.length;
        for (let i = 0; i < P.length; i++) {
          const a0 = P[i], b0 = P[(i + 1) % P.length];
          if (Math.hypot(b0[0] - a0[0], b0[1] - a0[1]) < 1e-5) continue;
          for (const [a, b] of edgeOf(a0, b0)) {
            // vertical, facing away from the region
            const out = [-(b[1] - a[1]), b[0] - a[0]];
            const away = out[0] * (a[0] - cx) + out[1] * (a[1] - cz) > 0;
            const [p0, p1] = away ? [a, b] : [b, a];
            const y0a = planeY(p, p0[0], p0[1]) + ROOF_GAP, y0b = planeY(p, p1[0], p1[1]) + ROOF_GAP;
            const L = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
            edges.quad([p0[0], y0a, p0[1]], [p1[0], y0b, p1[1]], [p1[0], y0b - ROOF_GAP + p.tv, p1[1]], [p0[0], y0a - ROOF_GAP + p.tv, p0[1]],
              [0, y0a], [L, y0b], [L, y0b + p.tv], [0, y0a + p.tv]);
          }
        }
      }
    };

    // ---- the main faces: minus the dormers' openings and the roof windows under them
    const Rs = part.dormers.map((d) => d.R);
    const outlineHps = insideHalfPlanes(outline);
    /** the parts of a → b outside the outline (convex): the eave cut at an ark's front, beyond the facade */
    const outsideOutline = (a, b) => {
      const f = (p) => Math.max(...outlineHps.map((hp) => hp.a * p[0] + hp.b * p[1] + hp.c)); // > 0 outside
      const ts = [0, 1];
      for (const hp of outlineHps) {
        const fa = hp.a * a[0] + hp.b * a[1] + hp.c, fb = hp.a * b[0] + hp.b * b[1] + hp.c;
        if ((fa < 0 && fb > 0) || (fa > 0 && fb < 0)) ts.push(fa / (fa - fb));
      }
      ts.sort((x, y) => x - y);
      const out = [];
      for (let i = 0; i < ts.length - 1; i++) {
        const t0 = ts[i], t1 = ts[i + 1], tm = (t0 + t1) / 2;
        if (t1 - t0 < 1e-6) continue;
        const at = (t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
        if (f(at(tm)) > 1e-6) out.push([at(t0), at(t1)]);
      }
      return out;
    };
    // another part of the level that is higher: this face goes under it (they meet in a valley) – cut where it is
    const others = parts.filter((q) => q !== part && q.levelId === part.levelId);
    const higherThan = (p) => others.map((q) => clipAll(q.over, [...q.boxHps, ...q.planes.map((qp) => ({ a: p.a - qp.a, b: p.b - qp.b, c: p.c - qp.c }))])).filter((Q) => Q.length >= 3 && Math.abs(polyArea(Q)) > 1e-6);
    for (const f of part.faces) {
      const p = part.planes[f.plane];
      const sky = skylights.filter((s) => {
        const c = s.polygon.reduce((acc, q) => [acc[0] + q[0] / s.polygon.length, acc[1] + q[1] / s.polygon.length], [0, 0]);
        return inConvex(c[0], c[1], f.poly);
      });
      const regions = cutRegions(f.poly, [...Rs, ...higherThan(p), ...sky.map((s) => s.polygon)]);
      slab(p, regions, (a, b) => {
        if (part.boxHps.some((hp) => onLine(hp, a) && onLine(hp, b))) return [[a, b]];
        if (Rs.some((R) => insideHalfPlanes(R).some((hp) => onLine(hp, a) && onLine(hp, b)))) return outsideOutline(a, b);
        return [];
      });
    }
    // ---- dormers: their slabs, cheeks, a takopplett's front wall
    for (const d of part.dormers) {
      const dbox = boxLines(d);
      for (const f of d.faces) slab(d.planes[f.plane], [{ outer: f.poly, holes: [] }], (a, b) => (dbox.some((hp) => onLine(hp, a) && onLine(hp, b)) ? [[a, b]] : []));
      const dormerAt = (x, z) => Math.min(...d.planes.map((q) => planeY(q, x, z)));
      const lo = (q) => planeY(d.main, q[0], q[1]) + ROOF_GAP;
      const hi = (q) => dormerAt(q[0], q[1]) + CLADDING_INTO_ROOF;
      /** a vertical quad over the segment a – b from lo to hi, facing out */
      const wallQuad = (a, b, out, loA, loB) => {
        const fn = [-(b[1] - a[1]), b[0] - a[0]]; // (b − a) × up
        const [p0, p1, l0, l1] = fn[0] * out[0] + fn[1] * out[1] > 0 ? [a, b, loA, loB] : [b, a, loB, loA];
        const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
        cheeks.quad([p0[0], l0, p0[1]], [p1[0], l1, p1[1]], [p1[0], hi(p1), p1[1]], [p0[0], hi(p0), p0[1]], [0, l0], [L, l1], [L, hi(p1)], [0, hi(p0)]);
      };
      for (const c of d.cheeks) {
        // the outer face, then its front end (on an ark: from the top of the wall's cladding under it)
        wallQuad(c.a, c.b, c.out, lo(c.a), lo(c.b));
        const front = d.ark ? (q) => planeY(d.main, q[0], q[1]) + CLADDING_INTO_ROOF : lo;
        wallQuad(c.side, c.a, [-d.frame.ev[0], -d.frame.ev[1]], front(c.side), front(c.a));
      }
      if (d.frontWall) frontWall(part, d, dormerAt);
    }
    // ---- ridge caps: where two faces of the same roof (or dormer) meet on top
    if (part.ridgeCap) {
      const sets = [part.faces.map((f) => ({ poly: f.poly, p: part.planes[f.plane] })), ...part.dormers.map((d) => d.faces.map((f) => ({ poly: f.poly, p: d.planes[f.plane] })))];
      for (const set of sets) {
        for (let i = 0; i < set.length; i++) {
          for (let j = i + 1; j < set.length; j++) {
            for (const [a, b] of sharedEdges(set[i].poly, set[j].poly)) {
              // not where another part of the level is higher (it goes in under that roof)
              for (const [a1, b1] of segmentOutside(a, b, higherThan(set[i].p))) ridgeCap(caps, a1, b1, set[i].p);
            }
          }
        }
      }
    }
    // ---- gutters along the eaves (the low, horizontal outer edges of the main faces)
    if (part.gutters) {
      const gm = mat('painted', part.trimColor, { roughness: 0.5, side: 'double' });
      for (const f of part.faces) {
        const p = part.planes[f.plane];
        const g = Math.hypot(p.a, p.b);
        if (g < 1e-4) continue;
        for (const r of cutRegions(f.poly, [...Rs, ...higherThan(p)])) {
          const P = r.outer;
          for (let i = 0; i < P.length; i++) {
            const a = P[i], b = P[(i + 1) % P.length];
            if (!part.boxHps.some((hp) => onLine(hp, a) && onLine(hp, b))) continue;
            if (Math.abs(planeY(p, ...a) - planeY(p, ...b)) > 1e-4) continue;
            const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
            if (L < 0.3) continue;
            const dir = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
            // outward = downhill
            let out = [-dir[1], dir[0]];
            if (out[0] * -p.a + out[1] * -p.b < 0) out = [-out[0], -out[1]];
            if (out[0] * -p.a + out[1] * -p.b < g * 0.5) continue;
            const y = planeY(p, ...a) + p.tv - 0.06;
            const geo = new THREE.CylinderGeometry(GUTTER_R, GUTTER_R, L, 12, 1, true, -Math.PI / 2, Math.PI);
            geo.rotateX(Math.PI / 2); // axis along z, the open half up
            const z3 = new THREE.Vector3(dir[0], 0, dir[1]);
            const x3 = new THREE.Vector3().crossVectors(UP, z3);
            const c = new THREE.Vector3((a[0] + b[0]) / 2 + out[0] * (GUTTER_R + 0.01), y, (a[1] + b[1]) / 2 + out[1] * (GUTTER_R + 0.01));
            geo.applyMatrix4(basis(x3, UP, z3, c));
            keep(geo);
            const m = new THREE.Mesh(geo, gm);
            m.name = `roof-gutter:${part.id}`;
            m.castShadow = true;
            m.userData.noCollide = true;
            add(m, part.levelId);
          }
        }
      }
    }
    add(top.build(covering(part), `roof:${part.id}`, keep), part.levelId);
    add(bottom.build(paint(part.soffitColor, { roughness: 0.8 }), `roof-soffit:${part.id}`, keep), part.levelId);
    add(edges.build(paint(part.trimColor, { roughness: 0.6 }), `roof-trim:${part.id}`, keep), part.levelId);
    add(caps.build(mat('painted', part.color, { roughness: 0.7 }), `roof-ridge:${part.id}`, keep), part.levelId);
    add(cheeks.build(opts.cladding?.(part.levelId) ?? paint('#4a4642'), `roof-cheeks:${part.id}`, keep), part.levelId);
  }

  /** A takopplett's front wall (r 0 … tf): cladding outside, the ceiling's paint inside, its window. */
  function frontWall(part, d, dormerAt) {
    const fw = d.frontWall;
    const F = d.frame;
    const n = F.ev;
    const tf = fw.thickness;
    // x along the front so that x × up = n (into the dormer): start at the end of the front where x runs from
    const x3 = new THREE.Vector3(n[1], 0, -n[0]);
    const n3 = new THREE.Vector3(n[0], 0, n[1]);
    const fromS0 = x3.x * F.eu[0] + x3.z * F.eu[1] > 0;
    const s0 = fromS0 ? 0 : d.width;
    const start = [F.O[0] + F.eu[0] * s0 + n[0] * tf, F.O[1] + F.eu[1] * s0 + n[1] * tf];
    const at = (u) => [start[0] + x3.x * u, start[1] + x3.z * u];
    const W = d.width;
    const bottom = planeY(d.main, ...at(W / 2));
    const us = d.type === 'gable' ? [0, W / 2, W] : [0, W];
    const topProfile = us.map((u) => [u, dormerAt(...at(u)) + CLADDING_INTO_ROOF]);
    const w = fw.window;
    const holes = [];
    if (w) holes.push({ x0: W / 2 - w.width / 2, x1: W / 2 + w.width / 2, y0: part.floorY + w.sill, y1: part.floorY + w.sill + w.height });
    const g = wallLayer({ L: W, bottom, top: topProfile, holes, z0: -tf, z1: 0 });
    g.applyMatrix4(basis(x3, UP, n3, new THREE.Vector3(start[0], 0, start[1])));
    const inner = groupGeometry(g, 1);
    const outer = groupGeometry(g, 0);
    const sides = groupGeometry(g, 2);
    g.dispose();
    const mid = at(W / 2);
    const lin = opts.lining?.(part.levelId, mid[0] + n[0] * 0.2, mid[1] + n[1] * 0.2);
    const clad = opts.cladding?.(part.levelId) ?? paint('#4a4642');
    for (const [geo, material, name] of [[inner, lin?.material ?? paint('#f4f2ee'), `roof-front-inside:${d.id}`], [outer, clad, `roof-front:${d.id}`], [sides, clad, `roof-front-sides:${d.id}`]]) {
      if (!geo) continue;
      keep(geo);
      const m = new THREE.Mesh(geo, material);
      m.name = name;
      m.castShadow = true;
      m.receiveShadow = true;
      m.userData.noCollide = true;
      add(m, part.levelId);
      if (geo === inner && lin?.ceilingId) linings.push({ ceilingId: lin.ceilingId, mesh: m });
    }
    if (w && opts.windowMaterials) {
      const fd = w.frame?.depth ?? 0.07;
      const o = {
        id: `win-${d.id}`,
        width: w.width,
        height: w.height,
        revealDepth: Math.max(0.02, tf - fd - 0.01),
        frame: { width: 0.07, depth: fd, ...(w.frame || {}) },
        sashes: w.sashes ?? [{ opening: true }],
        panes: w.panes ?? null,
        bars: w.bars ?? null,
        sillBoard: null,
      };
      const origin = new THREE.Vector3(mid[0], part.floorY + w.sill, mid[1]);
      const win = buildWindow(o, false, { M: opts.windowMaterials(), exteriorBatch: opts.exteriorBatch?.(part.levelId, mid[0] + n[0] * 0.2, mid[1] + n[1] * 0.2), batchers, keep, matrix: basis(x3, UP, n3, origin) });
      win.group.name = `roof-window:${d.id}`;
      win.group.userData.noCollide = true;
      parentOf(part.levelId)?.add(win.group);
      if (win.glass) parentOf(part.levelId)?.add(win.glass);
      for (const m of [...win.group.children, ...(win.glass ? [win.glass] : [])]) {
        m.userData.noCollide = true;
        meshes.push(m);
      }
      windows.push({ id: o.id, dormerId: d.id, group: win.group, glass: win.glass ? [win.glass] : [] });
    }
  }

  return { meshes, windows, linings };
}

/** The four half-plane lines of a dormer's box (its slab's outer edges). */
function boxLines(d) {
  const F = d.frame;
  const ov = d.overhang;
  const lines = [];
  const dot = (p, e) => p[0] * e[0] + p[1] * e[1];
  const o = [dot(F.O, F.eu), dot(F.O, F.ev)];
  for (const [e, k] of [[F.eu, o[0] - ov], [F.eu, o[0] + d.width + ov], [F.ev, o[1] - ov]]) lines.push({ a: e[0], b: e[1], c: -k });
  return lines;
}

/** The parts of segment a – b outside every convex polygon in Qs. */
function segmentOutside(a, b, Qs) {
  let parts = [[0, 1]];
  for (const Q of Qs) {
    // the parameter range inside Q
    let t0 = 0, t1 = 1;
    for (const hp of insideHalfPlanes(Q)) {
      const fa = hp.a * a[0] + hp.b * a[1] + hp.c, fb = hp.a * b[0] + hp.b * b[1] + hp.c;
      if (fa > 0 && fb > 0) (t0 = 1), (t1 = 0);
      else if (fa > 0) t0 = Math.max(t0, fa / (fa - fb));
      else if (fb > 0) t1 = Math.min(t1, fa / (fa - fb));
    }
    if (t1 - t0 < 1e-6) continue;
    parts = parts.flatMap(([u0, u1]) => [[u0, Math.min(u1, t0)], [Math.max(u0, t1), u1]]).filter(([u0, u1]) => u1 - u0 > 1e-6);
  }
  const at = (t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  return parts.map(([u0, u1]) => [at(u0), at(u1)]);
}

/** Edges [a, b] that two convex polygons share (collinear and overlapping). */
function sharedEdges(P, Q) {
  const out = [];
  for (let i = 0; i < P.length; i++) {
    const a = P[i], b = P[(i + 1) % P.length];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (L < 1e-4) continue;
    for (let j = 0; j < Q.length; j++) {
      const c = Q[j], e = Q[(j + 1) % Q.length];
      const d = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
      const off = (p) => Math.abs((p[0] - a[0]) * d[1] - (p[1] - a[1]) * d[0]);
      if (off(c) > 1e-5 || off(e) > 1e-5) continue;
      const t = (p) => (p[0] - a[0]) * d[0] + (p[1] - a[1]) * d[1];
      const t0 = Math.max(0, Math.min(t(c), t(e))), t1 = Math.min(L, Math.max(t(c), t(e)));
      if (t1 - t0 > 1e-3) out.push([[a[0] + d[0] * t0, a[1] + d[1] * t0], [a[0] + d[0] * t1, a[1] + d[1] * t1]]);
    }
  }
  return out;
}

/** A ridge cap along a → b on top of plane p (its top: p + tv): a low triangular prism, its feet under the covering. */
function ridgeCap(acc, a0, b0, p) {
  const L0 = Math.hypot(b0[0] - a0[0], b0[1] - a0[1]);
  if (L0 < 0.05) return;
  // 2 cm past both ends: its end caps stand clear of the verge boards (not in their plane)
  const e = [(b0[0] - a0[0]) / L0, (b0[1] - a0[1]) / L0];
  const a = [a0[0] - e[0] * 0.02, a0[1] - e[1] * 0.02], b = [b0[0] + e[0] * 0.02, b0[1] + e[1] * 0.02];
  const A = [a[0], planeY(p, a[0], a[1]) + p.tv, a[1]];
  const B = [b[0], planeY(p, b[0], b[1]) + p.tv, b[1]];
  const L = L0 + 0.04;
  const side = [-(b[1] - a[1]) / L, (b[0] - a[0]) / L];
  const w = 0.13, h = 0.07, sink = 0.04;
  const pt = (P, s, dy) => [P[0] + side[0] * s, P[1] + dy, P[2] + side[1] * s];
  const [l0, r0, t0] = [pt(A, w, -sink), pt(A, -w, -sink), pt(A, 0, h)];
  const [l1, r1, t1] = [pt(B, w, -sink), pt(B, -w, -sink), pt(B, 0, h)];
  const L3 = Math.hypot(L, B[1] - A[1]);
  // the two sloped sides (outward), and the end caps
  const faceOut = (q0, q1, q2, q3, outDir) => {
    const ux = q1[0] - q0[0], uy = q1[1] - q0[1], uz = q1[2] - q0[2];
    const vx = q3[0] - q0[0], vy = q3[1] - q0[1], vz = q3[2] - q0[2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const ok = nx * outDir[0] + ny * outDir[1] + nz * outDir[2] > 0;
    if (ok) acc.quad(q0, q1, q2, q3, [0, 0], [L3, 0], [L3, 0.15], [0, 0.15]);
    else acc.quad(q0, q3, q2, q1, [0, 0], [0, 0.15], [L3, 0.15], [L3, 0]);
  };
  faceOut(l0, l1, t1, t0, [side[0], 1, side[1]]);
  faceOut(r0, r1, t1, t0, [-side[0], 1, -side[1]]);
  const dir = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
  for (const [l, r, t, s] of [[l0, r0, t0, -1], [l1, r1, t1, 1]]) {
    const nx = (r[1] - l[1]) * (t[2] - l[2]) - (r[2] - l[2]) * (t[1] - l[1]);
    const nz = (r[0] - l[0]) * (t[1] - l[1]) - (r[1] - l[1]) * (t[0] - l[0]);
    if ((nx * dir[0] + nz * dir[1]) * s > 0) acc.tri(l, r, t, [0, 0], [0.26, 0], [0.13, 0.1]);
    else acc.tri(l, t, r, [0, 0], [0.13, 0.1], [0.26, 0]);
  }
}
