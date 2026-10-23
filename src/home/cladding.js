import * as THREE from 'three';
import { wallLayer, groupGeometry, profileAt } from './wallkit.js';
import { finishAt, wallCuts, finishKey, plinthFinish, CLADDING_DEFAULTS } from './claddinggeom.js';
import { panelUOffset } from '../world/surfaces.js';

/**
 * CLADDING – the outer layer of an exterior wall with the house's `cladding` (notes/kledning.md; the model is
 * home/claddinggeom.js, read by layout.js into layout.house.cladding). rooms.js builds the outer layer of every piece of
 * an exterior wall with wallLayer as before (up into the roof, up to the facade above, down over the slab edge) and,
 * when the house has `cladding`, hands it to claddingPiece instead of giving it one material:
 *   • the clad face is cut along horizontal lines into bands – the zones' from / to, the gable line (the lowest point of
 *     the wall's top under a roof: a gable zone is the triangle above it), the top of the plinth – and every band gets
 *     its finish (the last zone that applies, else the default; the plinth under its top). Bands with the same finish
 *     stay one. UVs: u along the whole wall (not the piece), v up; horizontal wood / panels swap them (the boards lie);
 *   • a flashing (beslag, 2,5 cm proud) where two different finishes meet, gaps at the openings;
 *   • trim.corners: corner boards (hjørnekasser, 10 cm + 22 mm) at the convex corners to the next / previous exterior
 *     wall, a square 45 mm batten in the concave ones; trim.surrounds: boards (10 cm) round every window and door in
 *     the opening's own frame colour (the window format's `frame.color`), and the outer reveals in that colour too.
 *     The boards of one piece are one union of rectangles (a cell grid), so no two boards lie in one plane.
 * Everything goes into the room's outside batch (rooms.js rr.outside: solid, like the rest of the facade).
 */

const EPS = 1e-6;
const FLASH = { below: 0.025, above: 0.005, proud: 0.025 };

/**
 * Cuts a non-indexed geometry (position, normal, uv) along the horizontal planes y = ys[i]: one geometry per band
 * (−∞, ys[0]), (ys[0], ys[1]) … (ys[n−1], ∞), null where a band is empty. Shared edges are cut at the same point from
 * both sides (the endpoints in a fixed order), so the bands meet without cracks.
 * @param {THREE.BufferGeometry} g
 * @param {number[]} ys  sorted
 * @returns {Array<THREE.BufferGeometry|null>}
 */
export function splitByY(g, ys) {
  const pos = g.attributes.position, nrm = g.attributes.normal, uv = g.attributes.uv;
  const out = Array.from({ length: ys.length + 1 }, () => ({ p: [], n: [], t: [] }));
  const vert = (i) => ({ p: [pos.getX(i), pos.getY(i), pos.getZ(i)], n: nrm ? [nrm.getX(i), nrm.getY(i), nrm.getZ(i)] : [0, 0, 1], t: uv ? [uv.getX(i), uv.getY(i)] : [0, 0] });
  const lerpV = (a, b, y) => {
    // fixed order: a is the one with the smaller (y, x, z)
    const swap = a.p[1] > b.p[1] || (a.p[1] === b.p[1] && (a.p[0] > b.p[0] || (a.p[0] === b.p[0] && a.p[2] > b.p[2])));
    const [p, q] = swap ? [b, a] : [a, b];
    const t = (y - p.p[1]) / (q.p[1] - p.p[1]);
    const L = (x0, x1) => x0.map((v, k) => v + (x1[k] - v) * t);
    const P = L(p.p, q.p);
    P[1] = y;
    return { p: P, n: L(p.n, q.n), t: L(p.t, q.t) };
  };
  /** Sutherland–Hodgman against y ≥ lo and y ≤ hi */
  const clip = (poly, y, keepAbove) => {
    const res = [];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      const ina = keepAbove ? a.p[1] >= y - EPS : a.p[1] <= y + EPS;
      const inb = keepAbove ? b.p[1] >= y - EPS : b.p[1] <= y + EPS;
      if (ina) res.push(a);
      if (ina !== inb) res.push(lerpV(a, b, y));
    }
    return res;
  };
  for (let i = 0; i < pos.count; i += 3) {
    const tri = [vert(i), vert(i + 1), vert(i + 2)];
    const ymin = Math.min(...tri.map((v) => v.p[1])), ymax = Math.max(...tri.map((v) => v.p[1]));
    for (let k = 0; k <= ys.length; k++) {
      const lo = k === 0 ? -Infinity : ys[k - 1];
      const hi = k === ys.length ? Infinity : ys[k];
      if (ymax <= lo + EPS || ymin >= hi - EPS) continue;
      let poly = tri;
      if (ymin < lo - EPS) poly = clip(poly, lo, true);
      if (poly.length >= 3 && ymax > hi + EPS) poly = clip(poly, hi, false);
      if (poly.length < 3) continue;
      const o = out[k];
      for (let j = 1; j < poly.length - 1; j++) {
        for (const v of [poly[0], poly[j], poly[j + 1]]) {
          o.p.push(...v.p);
          o.n.push(...v.n);
          o.t.push(...v.t);
        }
      }
    }
  }
  return out.map((o) => {
    if (!o.p.length) return null;
    const ng = new THREE.BufferGeometry();
    ng.setAttribute('position', new THREE.Float32BufferAttribute(o.p, 3));
    ng.setAttribute('normal', new THREE.Float32BufferAttribute(o.n, 3));
    ng.setAttribute('uv', new THREE.Float32BufferAttribute(o.t, 2));
    return ng;
  });
}

/** The triangles of a non-indexed geometry sorted into groups by key(centroid x, y, normal) → Map(key → geometry). */
function partition(g, key) {
  const pos = g.attributes.position, nrm = g.attributes.normal, uv = g.attributes.uv;
  const acc = new Map();
  for (let i = 0; i < pos.count; i += 3) {
    const cx = (pos.getX(i) + pos.getX(i + 1) + pos.getX(i + 2)) / 3;
    const cy = (pos.getY(i) + pos.getY(i + 1) + pos.getY(i + 2)) / 3;
    const k = key(cx, cy, nrm ? nrm.getZ(i) : 0);
    if (!acc.has(k)) acc.set(k, { p: [], n: [], t: [] });
    const o = acc.get(k);
    for (let j = i; j < i + 3; j++) {
      o.p.push(pos.getX(j), pos.getY(j), pos.getZ(j));
      if (nrm) o.n.push(nrm.getX(j), nrm.getY(j), nrm.getZ(j));
      if (uv) o.t.push(uv.getX(j), uv.getY(j));
    }
  }
  const res = new Map();
  for (const [k, o] of acc) {
    const ng = new THREE.BufferGeometry();
    ng.setAttribute('position', new THREE.Float32BufferAttribute(o.p, 3));
    if (o.n.length) ng.setAttribute('normal', new THREE.Float32BufferAttribute(o.n, 3));
    if (o.t.length) ng.setAttribute('uv', new THREE.Float32BufferAttribute(o.t, 2));
    res.set(k, ng);
  }
  return res;
}

/**
 * Disjoint rectangles covering the union of `rects` ({ x0, x1, y0, y1, key }) minus the `cut` rectangles, each with
 * the key of the first rect that covers it (a corner board before a surround): a grid on every edge, runs of equal
 * cells along x merged, then equal runs of neighbouring rows.
 */
export function unionRects(rects, cut = []) {
  const xs = [...new Set(rects.flatMap((r) => [r.x0, r.x1]).concat(cut.flatMap((r) => [r.x0, r.x1])).map((v) => Math.round(v * 1e5) / 1e5))].sort((a, b) => a - b);
  const ys = [...new Set(rects.flatMap((r) => [r.y0, r.y1]).concat(cut.flatMap((r) => [r.y0, r.y1])).map((v) => Math.round(v * 1e5) / 1e5))].sort((a, b) => a - b);
  const inside = (r, x, y) => x > r.x0 && x < r.x1 && y > r.y0 && y < r.y1;
  const rows = [];
  for (let j = 0; j < ys.length - 1; j++) {
    const y = (ys[j] + ys[j + 1]) / 2;
    const runs = [];
    for (let i = 0; i < xs.length - 1; i++) {
      const x = (xs[i] + xs[i + 1]) / 2;
      const r = cut.some((c) => inside(c, x, y)) ? null : rects.find((q) => inside(q, x, y));
      const last = runs[runs.length - 1];
      if (r && last && last.key === r.key && Math.abs(last.x1 - xs[i]) < 1e-9) last.x1 = xs[i + 1];
      else if (r) runs.push({ x0: xs[i], x1: xs[i + 1], key: r.key });
    }
    rows.push({ y0: ys[j], y1: ys[j + 1], runs });
  }
  const out = [];
  const open = new Map(); // `${x0}|${x1}|${key}` → rect growing up
  for (const row of rows) {
    const next = new Map();
    for (const r of row.runs) {
      const k = `${r.x0}|${r.x1}|${r.key}`;
      const prev = open.get(k);
      if (prev && Math.abs(prev.y1 - row.y0) < 1e-9) {
        prev.y1 = row.y1;
        next.set(k, prev);
        open.delete(k);
      } else next.set(k, { x0: r.x0, x1: r.x1, y0: row.y0, y1: row.y1, key: r.key });
    }
    for (const r of open.values()) out.push(r);
    open.clear();
    for (const [k, r] of next) open.set(k, r);
  }
  for (const r of open.values()) out.push(r);
  return out;
}

/**
 * The gable line of a wall: the lowest point of the top of its outer layer under a roof, the profile carried on to the
 * outer corners u0 / u1 (the profile spans the room face; on a gable wall it reaches the eave line only at the corners).
 * null when the top is level (an eave wall).
 */
export function gableLine(roofTop, u0 = null, u1 = null) {
  if (!roofTop?.length) return null;
  const ys = roofTop.map((p) => p[1]);
  const n = roofTop.length;
  const extend = (u, first) => {
    // the first / last segment with a length (a step at the end has none)
    let a = null, b = null;
    if (first) {
      for (let i = 0; i < n - 1 && !a; i++) if (roofTop[i + 1][0] - roofTop[i][0] > 1e-9) [a, b] = [roofTop[i], roofTop[i + 1]];
    } else for (let i = n - 1; i > 0 && !a; i--) if (roofTop[i][0] - roofTop[i - 1][0] > 1e-9) [a, b] = [roofTop[i - 1], roofTop[i]];
    return a ? a[1] + ((b[1] - a[1]) * (u - a[0])) / (b[0] - a[0]) : roofTop[first ? 0 : n - 1][1];
  };
  if (u0 !== null) ys.push(extend(u0, true));
  if (u1 !== null) ys.push(extend(u1, false));
  const lo = Math.min(...ys), hi = Math.max(...ys);
  return hi - lo > 0.1 ? lo : null;
}

/**
 * The outer layer of one piece (a … b) of an exterior wall, clad (see the top of this file).
 * @param {object} o
 * @param {object} o.CL        layout.house.cladding
 * @param {object} o.w         the layout wall
 * @param {object} o.lv        its level (layout.house.levelsById)
 * @param {THREE.BufferGeometry} o.gOut  wallLayer of the piece, piece-local (disposed here)
 * @param {THREE.Matrix4} o.T  piece-local → world
 * @param {number} o.a         the piece's start along the wall
 * @param {number} o.b         its end
 * @param {Array<[number, number]>} o.oTop  the layer's top, piece-local
 * @param {number} o.oBottom
 * @param {Array<{x0,x1,y0,y1,door,frameColor}>} o.openings  the openings of the piece, piece-local
 * @param {number} o.kS @param {number} o.kE  the piece's mitre factors
 * @param {number|null} o.gableY   gableLine of the wall (wall-local y) or null
 * @param {{ prev?: object, next?: object, startConvex?: boolean, endConvex?: boolean, startConcave?: boolean, endConcave?: boolean }} o.corner
 * @param {object} o.batch     the room's outside MeshBatcher
 * @param {(f: object) => THREE.Material} o.finishMat
 * @param {(hex: string) => THREE.Material} o.trimMat
 * @param {THREE.Material} o.sideMat  the layer's other sides (top, bottom, ends)
 */
export function claddingPiece(o) {
  const { CL, w, lv, T, a, b, oTop, oBottom, openings, kS, kE, gableY, corner = {}, batch, finishMat, trimMat, sideMat } = o;
  const Lp = b - a;
  const t = w.thickness;
  const toLocal = (lv?.floorY ?? w.floorY) - w.floorY;
  const trim = CL.trim;
  const surrounds = !!trim?.surrounds;

  // ---- the sides: the reveals in the opening's frame colour (surrounds), the rest as before
  const clad = groupGeometry(o.gOut, 0);
  const sides = groupGeometry(o.gOut, 2);
  o.gOut.dispose();
  if (sides) {
    if (surrounds && openings.length) {
      const groups = partition(sides, (x, y) => {
        const op = openings.find((q) => x > q.x0 - 1e-4 && x < q.x1 + 1e-4 && y > q.y0 - 1e-4 && y < q.y1 + 1e-4);
        return op ? op.frameColor : '';
      });
      for (const [k, g] of groups) {
        g.applyMatrix4(T);
        batch.add(g, k ? trimMat(k) : sideMat, { collide: true });
        g.dispose();
      }
    } else {
      sides.applyMatrix4(T);
      batch.add(sides, sideMat, { collide: true });
    }
    sides.dispose();
  }

  // ---- the bands of the clad face
  // the plinth: a band from plinthFoot under the ground up to `height` over it (world y → the wall's frame)
  const plinthTop = CL.plinth ? CL.groundY + CL.plinth.height - w.floorY : null;
  const plinthBottom = CL.plinth ? CL.groundY - CLADDING_DEFAULTS.plinthFoot - w.floorY : null;
  const gLevel = gableY === null ? null : gableY - toLocal;
  const levelCuts = wallCuts(CL, { levelId: w.levelId, wallId: w.id, gableY: gLevel });
  const cuts = [...new Set([...levelCuts.map((y) => y + toLocal), ...(plinthTop !== null ? [plinthBottom, plinthTop] : [])].map((y) => Math.round(y * 1e6) / 1e6))].sort((p, q) => p - q);
  const plinthF = plinthFinish(CL);
  const finishOf = (y) => (plinthTop !== null && y < plinthTop && y >= plinthBottom ? plinthF : finishAt(CL, { levelId: w.levelId, wallId: w.id, y: y - toLocal, gableY: gLevel }));
  const bands = [];
  for (let k = 0; k <= cuts.length; k++) {
    const lo = k === 0 ? -Infinity : cuts[k - 1];
    const hi = k === cuts.length ? Infinity : cuts[k];
    const mid = Number.isFinite(lo) && Number.isFinite(hi) ? (lo + hi) / 2 : Number.isFinite(lo) ? lo + 0.01 : hi - 0.01;
    const f = finishOf(mid);
    const last = bands[bands.length - 1];
    if (last && finishKey(last.f) === finishKey(f)) last.hi = hi;
    else bands.push({ lo, hi, f });
  }
  const bounds = bands.slice(1).map((q) => q.lo);
  if (clad) {
    const parts = splitByY(clad, bounds);
    clad.dispose();
    parts.forEach((g, k) => {
      if (!g) return;
      const f = bands[k].f;
      const uv = g.attributes.uv;
      const shift = a + (f.type === 'panels' && f.module ? panelUOffset(w.length, f.direction === 'horizontal' ? f.module[1] : f.module[0]) : 0);
      const lying = f.direction === 'horizontal' && (f.type === 'wood' || f.type === 'panels');
      for (let i = 0; i < uv.count; i++) {
        const u = uv.getX(i) + shift, v = uv.getY(i);
        if (lying) uv.setXY(i, v, u);
        else uv.setXY(i, u, v);
      }
      g.applyMatrix4(T);
      batch.add(g, finishMat(f), { collide: true });
      g.dispose();
    });
  }

  // ---- boards in front of the cladding: corner boards and surrounds, one union per piece (no faces in one plane)
  const rects = [];
  const cutOut = [];
  const ct = trim?.thickness ?? 0.022;
  const cw = trim?.width ?? 0.1;
  const atStart = Math.abs(a) < 1e-6, atEnd = Math.abs(b - w.length) < 1e-6;
  const boardBottom = Math.max(oBottom, plinthTop ?? -Infinity);
  let startClear = 0, endClear = Lp; // the surrounds and flashings stay off the corner boards
  if (trim?.corners) {
    // (a corner over one of the level below starts at the floor, one under the level above reaches its floor)
    const yEnd0 = Math.max(boardBottom, corner.endFrom ?? -Infinity), yEnd1 = profileAt(oTop, Lp) + (corner.endUp ?? 0);
    const yStart0 = Math.max(boardBottom, corner.startFrom ?? -Infinity), yStart1 = profileAt(oTop, 0) + (corner.startUp ?? 0);
    if (atEnd && corner.endConvex) {
      const ext = corner.next.thickness;
      if (yEnd1 > yEnd0 + 0.05) rects.push({ x0: Lp + ext - cw, x1: Lp + ext + ct, y0: yEnd0, y1: yEnd1, key: `c|${trim.color}` });
      endClear = Lp + ext - cw;
    }
    if (atStart && corner.startConvex) {
      const ext = corner.prev.thickness;
      if (yStart1 > yStart0 + 0.05) rects.push({ x0: -ext, x1: -ext + cw, y0: yStart0, y1: yStart1, key: `c|${trim.color}` });
      startClear = -ext + cw;
    }
    if (atEnd && corner.endConcave) {
      const u1 = Lp - corner.next.thickness;
      // the batten is square: its own box (45 mm deep), not part of the 22 mm boards
      if (yEnd1 > yEnd0 + 0.05) batch.frame(T).box(0.045, yEnd1 - yEnd0, 0.045, u1 - 0.0225, (yEnd1 + yEnd0) / 2, -t - 0.0225, trimMat(trim.color), { collide: false });
      endClear = Math.min(endClear, u1 - 0.045);
    }
  }
  if (surrounds) {
    for (const op of openings) {
      const x0 = Math.max(startClear, op.x0 - cw), x1 = Math.min(endClear, op.x1 + cw);
      const k = `s|${op.frameColor}`;
      rects.push({ x0, x1, y0: op.y1, y1: Math.min(op.y1 + cw, profileAt(oTop, (op.x0 + op.x1) / 2) - 0.01), key: k });
      const yb = op.door ? Math.max(op.y0, oBottom) : op.y0 - 0.06;
      if (op.x0 - x0 > 0.005) rects.push({ x0, x1: op.x0, y0: yb, y1: op.y1, key: k });
      if (x1 - op.x1 > 0.005) rects.push({ x0: op.x1, x1, y0: yb, y1: op.y1, key: k });
      if (!op.door) rects.push({ x0, x1, y0: op.y0 - 0.06, y1: op.y0, key: k });
      cutOut.push(op);
    }
  }
  if (rects.length) {
    const f = batch.frame(T);
    for (const r of unionRects(rects.filter((q) => q.x1 - q.x0 > 0.005 && q.y1 - q.y0 > 0.005), cutOut)) {
      const hex = r.key.slice(2);
      f.box(r.x1 - r.x0, r.y1 - r.y0, ct, (r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2, -t - ct / 2, trimMat(hex), { collide: false });
    }
  }

  // ---- flashings where two finishes meet (not across openings, not over the corner boards)
  for (let k = 1; k < bands.length; k++) {
    const y = bands[k].lo;
    const y0 = y - FLASH.below, y1 = y + FLASH.above;
    if (y0 < oBottom - EPS || y + w.floorY < CL.groundY) continue; // (none under the ground)
    let free = [[Math.max(0, startClear), Math.min(Lp, endClear)]];
    for (const op of openings) {
      if (op.y1 + (surrounds ? cw : 0) <= y0 || op.y0 - (surrounds ? 0.06 : 0) >= y1) continue;
      const c0 = op.x0 - (surrounds ? cw : 0), c1 = op.x1 + (surrounds ? cw : 0);
      free = free.flatMap(([p, q]) => (c1 <= p || c0 >= q ? [[p, q]] : [[p, c0], [c1, q]].filter(([s, e]) => e - s > 0.02)));
    }
    // where the layer's top comes down under the flashing (a gable's corners), it stops. At a corner to another exterior
    // wall it is mitred like the layer; at a T-junction with a partition it ends straight where the clad face ends
    const mat = trimMat(trim?.color ?? '#2f2f31');
    const exS = atStart && (corner.startConvex || corner.startConcave), exE = atEnd && (corner.endConvex || corner.endConcave);
    for (const [p, q] of free) {
      if (q - p < 0.02) continue;
      const endS = Math.abs(p) < 1e-6 && startClear === 0, endE = Math.abs(q - Lp) < 1e-6 && endClear === Lp;
      const p2 = endS && !exS ? p - kS * t : p, q2 = endE && !exE ? q + kE * t : q;
      const top = Math.min(y1, profileAt(oTop, p + 0.01), profileAt(oTop, q - 0.01));
      if (top - y0 < 0.01) continue;
      const g = wallLayer({ L: q2 - p2, bottom: y0, top: [[0, top], [q2 - p2, top]], z0: -t - FLASH.proud, z1: -t, kStart: endS && exS ? kS : 0, kEnd: endE && exE ? kE : 0 });
      g.translate(p2, 0, 0);
      g.applyMatrix4(T);
      batch.add(g, mat, { collide: false });
      g.dispose();
    }
  }
}
