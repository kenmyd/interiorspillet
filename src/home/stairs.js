import * as THREE from 'three';

/**
 * STAIRS – the stair between the levels (notes/hele-huset-design.md §1.6, §2.6, §3.1, §3.3; the numbers are
 * notes/hele-huset-avstemming.md §2, V12–V23, which overrides the plan).
 *
 * The pure part (Node-testable, no scene / ctx; tools/house-tests/stair-geom.test.mjs, tools/test-stairs.mjs):
 *   stairLayout(stair, levels)    treads (straight + balanced winders around the well), nosing lines, the walk line,
 *                                 the stringers, the guards and the handrail of one layout.house.stairs entry, in
 *                                 world space (plan points are [x, z]);
 *   stairColliders(lay)           the invisible closed wedge along the walk line (it ends on the lower floor at the
 *                                 bottom riser, §3.1) with a soffit, the inner stringer sides (guard height) and a
 *                                 clearance block at each corner of the well – the visible treads / stringers /
 *                                 balusters get collide:false;
 *   slabColliders(layout, levelId) the slab box under a level minus its holes and the guards around the holes (§2.8,
 *                                 §3.3);
 * and, with three.js, buildStairs (§2.6): oak treads with a batten under the nose and open risers, black stringers,
 * the guards A/B/C on the upper floor, the well guard (rail, balusters, the plate around the well), the handrail on
 * the shaft walls with its LED strip (§4.11), the nosing list at the top edge and the decor.
 *
 * Geometry (V12–V14, V17–V19, V22–V23):
 *   • riser = (upper floorY − lower floorY) / risers – nothing hard-codes a number of risers;
 *   • the walk line is V13 (halfTurnWalk in src/data/scripts/house.mjs, the validator's line): the middle of the free
 *     width, quarter arcs around the well's two far corners; u = 0 at the top nosing (the upper floor's edge),
 *     u = length at the lowest nosing;
 *   • nosing k (k = 1 … risers, k = risers is the floor edge) has its tread top at lowerY + k·riser; the straight treads
 *     at the foot fill the foot flight (going = its length / foot.straightTreads, 0.23), all other treads share the
 *     rest of the walk line (≈ 0.243, V13); a straight nosing is the flight's cross-section, a winder nosing is the line
 *     from its point on the inner stringer (spread evenly along the well between the last straight nosing at each
 *     end: «balanced», V14) through its point on the walk line out to the shaft wall;
 *   • the wedge (collision) is the ramp y = upperY − rise·u/length – from the upper floor at the top edge to the lower
 *     floor at the lowest nosing (the same surface as layout.house.floorYAt, §3.1) – over the footprint minus the well,
 *     constant along each cross-section of the walk line (radial in the turn: the winders' helicoid, §3.1).
 *
 * The colliders are THREE.Box3 / THREE.Mesh (not in the scene), the same list `colliders` of the build contract:
 * index.js registers them with ctx.collision (addStaticBox / addStatic), tools/test-stairs.mjs (steg 20) puts them in
 * its own CollisionWorld. The wedge's triangles face outwards (Octree's capsule test is one-sided).
 *
 *   buildStairs(ctx, layout) → { group, walls, windows, doors, pickables, builtInLights, colliders, update, setPaint, dispose }
 *
 * The stair spans two levels: its meshes go in ctx.roots.rooms['trapp'] (surfaces / contents; the hud room of the stair
 * is in the upper level). The returned `group` stays empty. The LED strip of the handrail goes in builtInLights →
 * home.house.builtInLights (group 'gang', at most one strip per straight wall run, §4.10–4.11). colliders =
 * stairColliders + slabColliders of the stair's upper level (rooms.js must not register the slab box again).
 */

/** Defaults where the stair data says nothing (house-mini, older data). Metres. */
export const STAIR = Object.freeze({
  treadThickness: 0.04,
  nosing: 0.03,
  batten: Object.freeze({ h: 0.04, inset: 0.025, depth: 0.045 }),
  stringerThickness: 0.05,
  stringerDepth: 0.28,
  /** the stringers' top edge above the nosing line */
  stringerAbove: 0.03,
  /** vertical depth of a stringer below its top edge (0.28 across the slope at ≈ 40°) */
  stringerDrop: 0.36,
  /** the treads end this far from the shaft wall / the inner edge (inside the stringer by 5 mm) */
  treadInset: 0.045,
  /** the wedge's soffit: this far under the ramp (the slab's thickness at the top edge) */
  wedgeDepth: 0.3,
  /** collision height of the inner stringer sides above the ramp (the rails are at 0.90, §3.3) */
  guardCollide: 0.95,
  /** thickness of a guard collider */
  guardThickness: 0.05,
  /** half size of the clearance block at a corner of the well: keeps the capsule 0.40 from the corner, where the
   *  helicoid is ≤ 46° (the snap holds 49°, M1) */
  cornerClear: 0.1,
  /** sampling step of the wedge's cross-sections along the walk line */
  wedgeStep: 0.025,
  /** the inner stringer becomes a plate up to the rail around the well, blended over this length */
  plateBlend: 0.14,
});

const EPS = 1e-9;

// ---------------------------------------------------------------------------------------------------------------
// 2D helpers (plan points [x, z])

const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const mul = (a, k) => [a[0] * k, a[1] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
const cross = (a, b) => a[0] * b[1] - a[1] * b[0];
const len = (a) => Math.hypot(a[0], a[1]);
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const unit = (a) => {
  const l = len(a);
  return l > EPS ? [a[0] / l, a[1] / l] : [0, 0];
};
const perp = (a) => [-a[1], a[0]];
const lerp = (a, b, t) => a + (b - a) * t;
const lerp2 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t)];
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smoothstep = (a, b, v) => {
  const t = clamp((v - a) / (b - a || EPS), 0, 1);
  return t * t * (3 - 2 * t);
};
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/** [x, z] from an array, a THREE.Vector2 ({x, y}) or a {x, z}. */
function pt(p) {
  if (Array.isArray(p)) return [Number(p[0]), Number(p[1])];
  if (p && isNum(p.x)) return [p.x, isNum(p.z) && !isNum(p.y) ? p.z : p.y];
  return null;
}
const poly = (list) => (Array.isArray(list) ? list.map(pt).filter(Boolean) : []);

export function signedArea(pl) {
  let s = 0;
  for (let i = 0; i < pl.length; i++) {
    const a = pl[i];
    const b = pl[(i + 1) % pl.length];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s / 2;
}
const ccw = (pl) => (signedArea(pl) < 0 ? [...pl].reverse() : pl);

export function pointInPolygon(p, pl) {
  let inside = false;
  for (let i = 0, j = pl.length - 1; i < pl.length; j = i++) {
    const a = pl[i];
    const b = pl[j];
    if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}
function distPointSeg(p, a, b) {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  const t = l2 > EPS ? clamp(dot(sub(p, a), ab) / l2, 0, 1) : 0;
  return dist(p, add(a, mul(ab, t)));
}
export function distToPolygon(p, pl) {
  let d = Infinity;
  for (let i = 0; i < pl.length; i++) d = Math.min(d, distPointSeg(p, pl[i], pl[(i + 1) % pl.length]));
  return d;
}
const inOrOn = (p, pl, tol = 1e-4) => pointInPolygon(p, pl) || distToPolygon(p, pl) <= tol;
const centroid = (pl) => mul(pl.reduce((s, p) => add(s, p), [0, 0]), 1 / Math.max(1, pl.length));

/** First hit (t > tMin) of the ray o + t·dir with the segments [a, b, …]; null when none. */
function raySegments(o, dir, segs, tMin = 1e-7) {
  let best = null;
  for (let i = 0; i < segs.length; i++) {
    const [a, b] = segs[i];
    const e = sub(b, a);
    const den = cross(dir, e);
    if (Math.abs(den) < 1e-12) continue;
    const ao = sub(a, o);
    const t = cross(ao, e) / den;
    const s = cross(ao, dir) / den;
    if (t > tMin && s >= -1e-9 && s <= 1 + 1e-9 && (!best || t < best.t)) best = { t, p: add(o, mul(dir, t)), i, f: clamp(s, 0, 1) };
  }
  return best;
}

// ---------------------------------------------------------------------------------------------------------------
// Chains: polylines with an arc-length parameter s (the inner stringer line, the shaft walls)

function makeChain(points) {
  const pts = [];
  for (const p of points) if (!pts.length || dist(pts[pts.length - 1], p) > 1e-6) pts.push(p);
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + dist(pts[i - 1], pts[i]));
  const length = cum[cum.length - 1];
  const dirAt = (i) => unit(sub(pts[Math.min(i + 1, pts.length - 1)], pts[Math.min(i, pts.length - 2)]));
  const at = (s) => {
    if (s <= 0) return add(pts[0], mul(dirAt(0), s));
    if (s >= length) return add(pts[pts.length - 1], mul(dirAt(pts.length - 2), s - length));
    let i = 1;
    while (i < cum.length - 1 && cum[i] < s) i++;
    const t = (s - cum[i - 1]) / (cum[i] - cum[i - 1] || 1);
    return lerp2(pts[i - 1], pts[i], t);
  };
  /** the segments, the first and last extended by `ext` (rays from just outside the ends still hit) */
  const segs = (ext = 0.25) =>
    pts.slice(1).map((b, k) => {
      let a = pts[k];
      let bb = b;
      const d = unit(sub(b, a));
      if (k === 0) a = sub(a, mul(d, ext));
      if (k === pts.length - 2) bb = add(bb, mul(d, ext));
      return [a, bb];
    });
  const segList = segs();
  /** ray hit with the chain → { p, s } (s < 0 / > length on the extended ends) */
  const hit = (o, dir) => {
    const h = raySegments(o, dir, segList);
    if (!h) return null;
    const k = h.i;
    const a = pts[k];
    return { p: h.p, s: cum[k] + dot(sub(h.p, a), dirAt(k)), t: h.t };
  };
  /** nearest chain parameter of a point */
  const project = (p) => {
    let best = { d: Infinity, s: 0 };
    for (let k = 0; k < pts.length - 1; k++) {
      const a = pts[k];
      const e = sub(pts[k + 1], a);
      const l = len(e);
      const t = clamp(dot(sub(p, a), e) / (l * l || 1), 0, 1);
      const d = dist(p, add(a, mul(e, t)));
      if (d < best.d) best = { d, s: cum[k] + t * l };
    }
    return best;
  };
  return { pts, cum, length, at, hit, project, dirAt };
}

/** The chain moved `d` to the side `side(k)` (+1 left of the segment direction, −1 right), mitred corners. */
function offsetChain(chain, d, sideOf) {
  const { pts } = chain;
  const n = pts.length;
  const normals = [];
  for (let k = 0; k < n - 1; k++) normals.push(mul(perp(unit(sub(pts[k + 1], pts[k]))), sideOf(k)));
  const out = [];
  for (let i = 0; i < n; i++) {
    if (i === 0) out.push(add(pts[0], mul(normals[0], d)));
    else if (i === n - 1) out.push(add(pts[n - 1], mul(normals[n - 2], d)));
    else {
      const m = unit(add(normals[i - 1], normals[i]));
      const c = dot(m, normals[i]);
      out.push(add(pts[i], mul(m, d / Math.max(0.2, c))));
    }
  }
  return makeChain(out);
}

// ---------------------------------------------------------------------------------------------------------------
// The walk line (avstemming V13 – the same line as stairWalk / halfTurnWalk in src/data/scripts/house.mjs)

function walkLine(stair, footprint) {
  const top = stair.top;
  const foot = stair.foot;
  const te = [pt(top.edge[0]), pt(top.edge[1])];
  const fe = [pt(foot.edge[0]), pt(foot.edge[1])];
  const P0 = mul(add(te[0], te[1]), 0.5);
  const P3 = mul(add(fe[0], fe[1]), 0.5);
  const w1 = dist(te[0], te[1]);
  const w2 = dist(fe[0], fe[1]);
  const d1 = unit(pt(top.down));
  const d2 = unit(pt(foot.down));
  const well = poly(stair.wellPolygon?.length ? stair.wellPolygon : stair.well?.polygon);
  const line = (a, d, l, hw) => ({ kind: 'line', a, d, len: Math.max(0, l), hw });
  const arc = (C, from, to, rs, re) => {
    const a0 = Math.atan2(from[1], from[0]);
    const da = Math.atan2(cross(from, to), dot(from, to));
    return { kind: 'arc', C, a0, da, rs, re, len: (Math.abs(da) * (rs + re)) / 2 };
  };
  let segs;
  let corners = [];
  if (stair.type !== 'straight' && well.length >= 3 && dot(d1, d2) < -0.9) {
    const proj = well.map((p) => dot(p, d1));
    const far = Math.max(...proj);
    const farPts = well.filter((p, i) => Math.abs(proj[i] - far) < 1e-6);
    const off = (p, P, d) => Math.abs(cross(d, sub(p, P)));
    const nearest = (P, d) => farPts.reduce((best, p) => (off(p, P, d) < off(best, P, d) - 1e-9 ? p : best), farPts[0]);
    const A = nearest(P0, d1);
    const B = nearest(P3, d2);
    if (farPts.length < 2 || dist(A, B) < 1e-6) throw new Error(`stair ${stair.id}: the well has no far edge`);
    const r1 = off(A, P0, d1);
    const r3 = off(B, P3, d2);
    const r2 = footprint.length ? (Math.max(...footprint.map((p) => dot(p, d1))) - far) / 2 : (r1 + r3) / 2;
    const L1 = far - dot(P0, d1);
    const L3 = dot(sub(P3, B), d2);
    if (L1 < -0.005 || L3 < -0.005) throw new Error(`stair ${stair.id}: top/foot do not fit the well`);
    const P1 = add(P0, mul(d1, Math.max(0, L1)));
    const P2 = sub(P3, mul(d2, Math.max(0, L3)));
    const e = unit(sub(B, A));
    segs = [
      line(P0, d1, L1, w1 / 2),
      arc(A, unit(sub(P1, A)), d1, r1, r2),
      line(add(A, mul(d1, r2)), e, dist(A, B), r2),
      arc(B, d1, unit(sub(P2, B)), r2, r3),
      line(P2, d2, L3, w2 / 2),
    ];
    corners = [A, B];
  } else {
    const L = dist(P0, P3);
    segs = [line(P0, unit(sub(P3, P0)), L, w1 / 2)];
  }
  let s0 = 0;
  for (const g of segs) {
    g.s0 = s0;
    s0 += g.len;
  }
  const length = s0;
  const last = segs[segs.length - 1];
  const segAt = (u) => (u >= length ? last : u <= 0 ? segs[0] : segs.find((g) => u <= g.s0 + g.len + 1e-12 && g.len > 0) ?? last);
  /** walk point, direction (down the stair) and the segment; beyond the ends the end flights go on straight */
  const at = (u) => {
    const g = segAt(u);
    if (g.kind === 'line') {
      const p = add(g.a, mul(g.d, u - g.s0));
      return { p, dir: g.d, seg: g };
    }
    const t = g.len > 0 ? clamp((u - g.s0) / g.len, 0, 1) : 0;
    const ang = g.a0 + g.da * t;
    const radial = [Math.cos(ang), Math.sin(ang)];
    const p = add(g.C, mul(radial, lerp(g.rs, g.re, t)));
    const s = Math.sign(g.da) || 1;
    return { p, dir: [s * -radial[1], s * radial[0]], seg: g, radial };
  };
  /** the walk parameter of a plan point (the cross-section through it: perpendicular on a flight, radial in a turn) */
  const param = (p) => {
    let best = null;
    for (let i = 0; i < segs.length; i++) {
      const g = segs[i];
      let u;
      let d;
      if (g.kind === 'line') {
        let t = dot(sub(p, g.a), g.d);
        if (i > 0 && t < -1e-9) continue;
        if (i < segs.length - 1 && t > g.len + 1e-9) continue;
        u = g.s0 + clamp(t, 0, g.len) + (i === 0 && t < 0 ? t : 0) + (i === segs.length - 1 && t > g.len ? t - g.len : 0);
        d = Math.abs(cross(g.d, sub(p, g.a)));
      } else {
        const v = sub(p, g.C);
        const r = len(v);
        let rel = (Math.atan2(v[1], v[0]) - g.a0) * Math.sign(g.da);
        rel = ((rel % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
        const span = Math.abs(g.da);
        if (rel > span + 1e-9) continue;
        const t = span > 0 ? rel / span : 0;
        u = g.s0 + g.len * t;
        d = Math.abs(r - lerp(g.rs, g.re, t));
      }
      if (!best || d < best.d - 1e-12) best = { u, d };
    }
    if (best) return best.u;
    // outside every segment's region (behind a corner): the nearer end
    return dist(p, segs[0].a) <= dist(p, at(length).p) ? 0 : length;
  };
  return { length, segs, at, param, corners, P0, P3, d1, d2, w1, w2, te, fe, well };
}

// ---------------------------------------------------------------------------------------------------------------
// stairLayout

/** World y of a level's floor. */
function levelFloor(levels, id) {
  const lv = (levels || []).find((l) => l.id === id);
  if (lv && isNum(lv.floorY)) return lv.floorY;
  return id === 'hoved' ? 0 : null;
}

/**
 * Splits the footprint into the shaft-wall chain (outer, from the foot to the top) and builds the inner stringer line
 * (foot → the well's corners → top). The outer chain is the longer of the two boundary paths between the outer ends
 * of the foot (with the nosing) and the top edge.
 */
function chains(W, footprint, nosing) {
  const wellC = W.well.length ? centroid(W.well) : centroid(footprint);
  const near = (e) => (dist(e[0], wellC) <= dist(e[1], wellC) ? [e[0], e[1]] : [e[1], e[0]]);
  const [tIn, tOut] = near(W.te);
  const [fIn0, fOut0] = near(W.fe);
  const fIn = add(fIn0, mul(W.d2, nosing));
  const fOut = add(fOut0, mul(W.d2, nosing));
  // outer: along the footprint boundary
  const n = footprint.length;
  const locate = (p) => {
    let best = { d: Infinity, k: 0, t: 0 };
    for (let k = 0; k < n; k++) {
      const a = footprint[k];
      const b = footprint[(k + 1) % n];
      const e = sub(b, a);
      const t = clamp(dot(sub(p, a), e) / (dot(e, e) || 1), 0, 1);
      const d = dist(p, add(a, mul(e, t)));
      if (d < best.d - 1e-9) best = { d, k, t };
    }
    return best;
  };
  let outer;
  if (n >= 3) {
    const a = locate(fOut);
    const b = locate(tOut);
    const walk = (from, to, step) => {
      // boundary path from point `from` (on edge from.k) to `to` (on edge to.k), going forward (+1) or backward (−1)
      const path = [add(footprint[from.k], mul(sub(footprint[(from.k + 1) % n], footprint[from.k]), from.t))];
      let k = from.k;
      for (let guard = 0; guard <= n; guard++) {
        if (k === to.k && (step > 0 ? to.t >= from.t - 1e-9 || guard > 0 : to.t <= from.t + 1e-9 || guard > 0)) break;
        if (step > 0) {
          k = (k + 1) % n;
          path.push(footprint[k]);
        } else {
          path.push(footprint[k]);
          k = (k - 1 + n) % n;
        }
      }
      path.push(add(footprint[to.k], mul(sub(footprint[(to.k + 1) % n], footprint[to.k]), to.t)));
      return makeChain(path);
    };
    const fwd = walk(a, b, 1);
    const bwd = walk(a, b, -1);
    outer = fwd.length >= bwd.length ? fwd : bwd;
  } else {
    outer = makeChain([fOut, tOut]);
  }
  // inner: the inner side of the foot flight, the well's far edge (corners B → A), the inner side of the top flight
  const innerPts = [fIn];
  if (W.corners.length === 2) innerPts.push(W.corners[1], W.corners[0]);
  innerPts.push(tIn);
  const inner = makeChain(innerPts);
  return { inner, outer, tIn, tOut, fIn, fOut, wellC };
}

/**
 * Geometry of one stair, in world space (y = world y, plan points [x, z]). Pure and deterministic.
 * @param {object} stair     a layout.house.stairs entry (or a room-spec stairs entry; then pass opts.footprint when it
 *                           has none)
 * @param {object[]} [levels]  layout.house.levels (floorY, slabThickness) – for a room-spec entry
 * @param {{ footprint?: Array }} [opts]
 * @returns {object} lay – see the fields at the end
 */
export function stairLayout(stair, levels = [], opts = {}) {
  const id = stair?.id ?? null;
  const fromLevel = stair?.fromLevel ?? null;
  const toLevel = stair?.toLevel ?? null;
  const bottomY = isNum(stair?.bottomY) ? stair.bottomY : levelFloor(levels, fromLevel);
  const topY = isNum(stair?.topY) ? stair.topY : levelFloor(levels, toLevel);
  const base = { id, stair, levelIds: [fromLevel, toLevel], fromLevel, toLevel, treads: [], nosings: [], sections: [] };
  if (!stair || !stair.top?.edge || !stair.foot?.edge || !isNum(bottomY) || !isNum(topY) || topY <= bottomY) return base;
  const rise = topY - bottomY;
  const risers = Number.isInteger(stair.risers) && stair.risers >= 2 ? stair.risers : Math.max(2, Math.round(rise / 0.18));
  const riser = rise / risers;
  const upper = (levels || []).find((l) => l.id === toLevel);
  const slab = isNum(upper?.slabThickness) ? upper.slabThickness : 0.3;

  const tread = stair.tread || {};
  const nosing = isNum(tread.nosing) ? tread.nosing : STAIR.nosing;
  const treadT = isNum(tread.thickness) ? tread.thickness : STAIR.treadThickness;
  const batten = {
    h: isNum(tread.batten?.h) ? tread.batten.h : tread.batten === false ? 0 : STAIR.batten.h,
    inset: isNum(tread.batten?.inset) ? tread.batten.inset : STAIR.batten.inset,
    depth: isNum(tread.batten?.depth) ? tread.batten.depth : STAIR.batten.depth,
  };
  const strT = isNum(stair.stringers?.thickness) ? stair.stringers.thickness : STAIR.stringerThickness;
  const strDepth = isNum(stair.stringers?.depth) ? stair.stringers.depth : STAIR.stringerDepth;
  const footCut = isNum(stair.stringers?.footCut) ? stair.stringers.footCut : nosing;

  let footprint = poly(stair.footprint?.length ? stair.footprint : opts.footprint);
  if (footprint.length >= 3) footprint = ccw(footprint);
  const W = walkLine(stair, footprint);
  const L = W.length;
  const n = risers - 1; // treads
  const { inner, outer, fIn, fOut } = chains(W, footprint, nosing);
  const wellC = W.well.length ? centroid(W.well) : null;

  // ---- goings: the foot's straight treads fill the foot flight (V14: 0.23), the rest share the walk line (V13)
  const lastSeg = W.segs[W.segs.length - 1];
  const firstSeg = W.segs[0];
  let nf = clamp(Number.isInteger(stair.foot?.straightTreads) ? stair.foot.straightTreads : 0, 0, n);
  let nt = clamp(Number.isInteger(stair.top?.straightTreads) ? stair.top.straightTreads : 0, 0, n - nf);
  if (W.segs.length === 1) {
    nf = n;
    nt = 0;
  }
  let gFoot = nf ? lastSeg.len / nf : 0;
  if (W.segs.length > 1 && nf && (gFoot < 0.15 || gFoot > 0.35)) gFoot = L / n; // a foot flight that does not fit
  if (W.segs.length === 1) gFoot = L / n;
  const gRest = n > nf ? (L - nf * gFoot) / (n - nf) : 0;
  const vOf = (k) => (k - 1 <= nf ? (k - 1) * gFoot : nf * gFoot + (k - 1 - nf) * gRest); // from the foot
  const kindOf = (k) => (W.segs.length === 1 || k <= nf + 1 || k >= risers - nt ? 'straight' : 'winder');

  const rampY = (u) => topY - (rise * clamp(u, 0, L)) / L;
  // which side of a straight walk segment the well (inner chain) is on
  const innerSideOf = (seg) => {
    const pd = perp(seg.d);
    if (wellC) return dot(pd, sub(wellC, seg.a)) >= 0 ? pd : mul(pd, -1);
    const m = inner.at(inner.length / 2);
    return dot(pd, sub(m, seg.a)) >= 0 ? pd : mul(pd, -1);
  };
  /** cross-section of the walk line at u: { inner, outer, sIn, sOut } on the inner line / shaft walls */
  const section = (u) => {
    const a = W.at(u);
    if (a.seg.kind === 'arc') {
      const C = a.seg.C;
      const o = outer.hit(C, a.radial);
      return { u, inner: C, outer: o ? o.p : add(C, mul(a.radial, 2 * a.seg.re)), sIn: inner.project(C).s, sOut: o ? o.s : null, walk: a.p, dir: a.dir };
    }
    const toIn = innerSideOf(a.seg);
    const hi = inner.hit(a.p, toIn);
    const ho = outer.hit(a.p, mul(toIn, -1));
    const hw = a.seg.hw ?? 0.45;
    return {
      u,
      inner: hi ? hi.p : add(a.p, mul(toIn, hw)),
      outer: ho ? ho.p : sub(a.p, mul(toIn, hw)),
      sIn: hi ? hi.s : inner.project(add(a.p, mul(toIn, hw))).s,
      sOut: ho ? ho.s : null,
      walk: a.p,
      dir: a.dir,
    };
  };

  // ---- nosing lines (k = 1 at the foot … risers = the upper floor's edge)
  const nosings = [];
  for (let k = 1; k <= risers; k++) {
    const v = k === risers ? L : vOf(k);
    const u = L - v;
    nosings.push({ k, u, v, y: bottomY + k * riser, kind: kindOf(k) });
  }
  const kA = Math.min(nf + 1, risers);
  const kB = Math.max(risers - nt, kA);
  for (const ns of nosings) {
    const sec = section(ns.u);
    ns.walk = sec.walk;
    if (ns.kind === 'straight') {
      ns.inner = sec.inner;
      ns.outer = sec.outer;
      ns.sIn = sec.sIn;
      ns.sOut = sec.sOut;
    }
  }
  const sA = nosings[kA - 1].sIn;
  const sB = nosings[kB - 1].sIn;
  for (const ns of nosings) {
    if (ns.kind === 'straight') continue;
    ns.sIn = lerp(sA, sB, (ns.k - kA) / (kB - kA || 1));
    ns.inner = inner.at(ns.sIn);
    const dir = unit(sub(ns.walk, ns.inner));
    const o = outer.hit(ns.walk, dir);
    ns.outer = o ? o.p : add(ns.walk, dir);
    ns.sOut = o ? o.s : null;
  }
  for (const ns of nosings) {
    ns.dir = unit(sub(ns.outer, ns.inner)); // across the stair, inner → wall
    // the nose faces down the stair: toward the lower nosing (the foot direction for the lowest)
    let nrm = perp(ns.dir);
    const down = ns.k > 1 ? sub(nosings[ns.k - 2].walk, ns.walk) : W.d2;
    if (dot(nrm, down) < 0) nrm = mul(nrm, -1);
    ns.down = nrm;
  }

  // ---- treads (k = 1 … risers − 1): between nosing k (front, with the nose) and nosing k + 1 (back)
  const sideToFlight = (chain, sign) => (k) => {
    const a = chain.pts[k];
    const b = chain.pts[k + 1];
    const m = lerp2(a, b, 0.5);
    const nn = perp(unit(sub(b, a)));
    const test = add(m, mul(nn, 0.01 * sign));
    const ok = footprint.length >= 3 ? pointInPolygon(test, footprint) && !(W.well.length >= 3 && pointInPolygon(test, W.well)) : true;
    return ok ? 1 : -1;
  };
  const treadInset = STAIR.treadInset;
  const innerOff = offsetChain(inner, treadInset, sideToFlight(inner, 1));
  const outerOff = offsetChain(outer, treadInset, sideToFlight(outer, 1));
  /** the line through point p with direction d (inner → wall) cut by the two offset chains */
  const cut = (p, d) => {
    const a = innerOff.hit(p, mul(d, -1));
    const b = outerOff.hit(p, d);
    return a && b ? { a, b } : null;
  };
  const between = (chain, s0, s1) => chain.pts.filter((_, i) => chain.cum[i] > s0 + 1e-6 && chain.cum[i] < s1 - 1e-6);
  const region = (front, back) => {
    // front / back: { a: inner hit, b: outer hit } – polygon front-inner → front-outer → (walls) → back-outer →
    // back-inner → (inner line, backwards)
    const pts = [front.a.p, front.b.p, ...between(outerOff, front.b.s, back.b.s), back.b.p, back.a.p, ...between(innerOff, front.a.s, back.a.s).reverse()];
    return ccw(pts);
  };
  const treads = [];
  for (let k = 1; k < risers; k++) {
    const f = nosings[k - 1];
    const b = nosings[k];
    const backCut = cut(b.walk, b.dir);
    const frontCut = cut(f.walk, f.dir);
    const noseCut = cut(add(f.walk, mul(f.down, nosing)), f.dir);
    if (!backCut || !frontCut || !noseCut) continue;
    const y = f.y;
    const t = {
      k,
      kind: f.kind === 'straight' && b.kind === 'straight' ? 'straight' : 'winder',
      y,
      bottom: y - treadT,
      polygon: region(frontCut, backCut),
      plate: region(noseCut, backCut),
      front: [noseCut.a.p, noseCut.b.p],
      along: f.dir,
      going: b.v - f.v,
      innerGoing: Math.abs(b.sIn - f.sIn),
      outerGoing: b.sOut != null && f.sOut != null ? b.sOut - f.sOut : null,
    };
    if (batten.h > 0) {
      const c0 = cut(add(f.walk, mul(f.down, nosing - batten.inset)), f.dir);
      const c1 = cut(add(f.walk, mul(f.down, nosing - batten.inset - batten.depth)), f.dir);
      if (c0 && c1) t.batten = { polygon: ccw([c1.a.p, c1.b.p, c0.b.p, c0.a.p]), y0: y - treadT - batten.h, y1: y - treadT };
    }
    treads.push(t);
  }

  // ---- cross-sections of the wedge (u = 0 at the top edge … the footprint's foot edge)
  const us = new Set();
  for (let u = 0; u < L; u += STAIR.wedgeStep) us.add(+u.toFixed(6));
  for (const g of W.segs) {
    us.add(+g.s0.toFixed(6));
    us.add(+(g.s0 + g.len).toFixed(6));
  }
  us.add(+L.toFixed(6));
  // a section through every corner of the shaft walls, so no chord cuts a corner off
  for (const c of outer.pts.slice(1, -1)) {
    const u = W.param(c);
    if (u > 1e-4 && u < L - 1e-4) us.add(+u.toFixed(6));
  }
  const footEnd = footprint.length >= 3 ? Math.max(0, Math.max(...footprint.map((p) => dot(sub(p, W.P3), W.d2)))) : nosing;
  if (footEnd > 1e-4) us.add(+(L + footEnd).toFixed(6));
  const sections = [...us]
    .sort((a, b) => a - b)
    .map((u) => {
      const s = section(u);
      const yTop = rampY(u);
      return { ...s, yTop, yBot: Math.max(bottomY, yTop - STAIR.wedgeDepth) };
    });

  // ---- stringers: top edge along the nosing line (+ stringerAbove), vertical depth stringerDrop
  const profile = (key, sKey) => {
    // (s, y) of the nosing points on a chain, extrapolated straight past both ends
    const pts = nosings.filter((ns) => ns[sKey] != null).map((ns) => [ns[sKey], ns.y]);
    pts.sort((a, b) => a[0] - b[0]);
    return (s) => {
      if (pts.length < 2) return topY;
      if (s <= pts[0][0]) {
        const [a, b] = pts;
        return a[1] + ((b[1] - a[1]) / (b[0] - a[0] || 1)) * (s - a[0]);
      }
      if (s >= pts[pts.length - 1][0]) {
        const a = pts[pts.length - 2];
        const b = pts[pts.length - 1];
        return b[1] + ((b[1] - a[1]) / (b[0] - a[0] || 1)) * (s - b[0]);
      }
      let i = 1;
      while (pts[i][0] < s) i++;
      const a = pts[i - 1];
      const b = pts[i];
      return lerp(a[1], b[1], (s - a[0]) / (b[0] - a[0] || 1));
    };
  };
  const noseOut = profile('outer', 'sOut');
  const noseIn = profile('inner', 'sIn');
  const drop = Math.max(strDepth, STAIR.stringerDrop);
  const above = STAIR.stringerAbove;
  const capTop = topY - 0.003;
  const sampleChain = (chain, s0, s1, extra = []) => {
    const ss = new Set([s0, s1, ...extra.filter((s) => s > s0 && s < s1)]);
    for (let s = s0; s < s1; s += 0.05) ss.add(+s.toFixed(6));
    for (const c of chain.cum) if (c > s0 && c < s1) ss.add(c);
    return [...ss].sort((a, b) => a - b);
  };
  // outer (wall) stringer: from the vertical foot cut (footCut past the lowest nosing line, V17) to the top edge
  const outerStart = footCut - nosing; // s on the outer chain (it starts at the nose)
  const outerEnd = nosings[risers - 1].sOut ?? outer.length;
  const outerSamples = sampleChain(outer, -outerStart, outerEnd, nosings.map((ns) => ns.sOut).filter(isNum)).map((s) => {
    const top = Math.min(capTop, noseOut(s) + above);
    return { s, p: outer.at(s), top, bottom: Math.max(bottomY, Math.min(top, noseOut(s) + above) - drop) };
  });
  // inner stringer: from the foot (the start post) round the well to the newel at the top; a plate up to the rail
  // around the well's far edge (V18, 225349: «en bred, sort plate som vrir seg bratt oppover»)
  const guardStyle = stair.guardStyle || {};
  const railH = isNum(guardStyle.stairHeight) ? guardStyle.stairHeight : 0.9;
  const cornerS = W.corners.length === 2 ? [inner.project(W.corners[1]).s, inner.project(W.corners[0]).s] : [];
  const plateW = (s) => (cornerS.length ? smoothstep(cornerS[0] - STAIR.plateBlend, cornerS[0], s) * (1 - smoothstep(cornerS[1], cornerS[1] + STAIR.plateBlend, s)) : 0);
  const innerEnd = inner.length;
  const innerSamples = sampleChain(inner, 0, innerEnd, nosings.map((ns) => ns.sIn).filter(isNum)).map((s) => {
    const base = noseIn(s) + above;
    const top = Math.min(capTop, base + (railH - above) * plateW(s));
    return { s, p: inner.at(s), top, bottom: Math.max(bottomY, base - drop), plate: plateW(s) };
  });
  const stringers = {
    thickness: strT,
    outer: { chain: outer, samples: outerSamples, side: sideToFlight(outer, 1) },
    inner: { chain: inner, samples: innerSamples, side: sideToFlight(inner, 1) },
  };

  // ---- the well guard (rekk-oye): rail 0.90 over the inner nosing line, balusters on the straight flights
  const guards = [];
  const wellGuard = { rail: [], posts: [], balusters: [] };
  const railSide = offsetChain(inner, strT / 2, sideToFlight(inner, 1));
  const railAt = (s) => {
    const y = noseIn(s) + railH;
    return Math.max(y, bottomY + (isNum(guardStyle.height) ? guardStyle.height : 1.0) - 0.05);
  };
  if (W.corners.length === 2) {
    const s0 = 0.035;
    for (const s of sampleChain(inner, s0, innerEnd, nosings.map((ns) => ns.sIn).filter(isNum))) {
      const p = railSide.at(s);
      wellGuard.rail.push([p[0], railAt(s), p[1]]);
    }
    wellGuard.posts.push({ p: railSide.at(s0), y0: bottomY, y1: bottomY + (isNum(guardStyle.height) ? guardStyle.height : 1.0) });
    const spacing = isNum(guardStyle.spacing) ? guardStyle.spacing : 0.13;
    const runs = [
      [s0 + spacing * 0.8, cornerS[0] - 0.06],
      [cornerS[1] + STAIR.plateBlend, innerEnd - 0.06],
    ];
    for (const [a, b] of runs) {
      if (b <= a) continue;
      const count = Math.max(1, Math.round((b - a) / spacing) + 1);
      for (let i = 0; i < count; i++) {
        const s = count === 1 ? (a + b) / 2 : lerp(a, b, i / (count - 1));
        const sm = innerSamples.reduce((best, x) => (Math.abs(x.s - s) < Math.abs(best.s - s) ? x : best), innerSamples[0]);
        const yLow = Math.max(sm.top, noseIn(s) + above);
        const yHigh = railAt(s) - 0.025;
        if (yHigh - yLow > 0.05) wellGuard.balusters.push({ p: railSide.at(s), y0: yLow, y1: yHigh });
      }
    }
  }
  // the guards A/B/C on the upper floor (line on the hole's edge, moved half a post onto the floor)
  const post = isNum(guardStyle.post) ? guardStyle.post : 0.065;
  const gH = isNum(guardStyle.height) ? guardStyle.height : 1.0;
  const holeish = footprint.length >= 3 ? footprint : [];
  for (const g of Array.isArray(stair.guards) ? stair.guards : []) {
    if (!Array.isArray(g.line) || g.line.length < 2) continue;
    const a = pt(g.line[0]);
    const b = pt(g.line[1]);
    const d = unit(sub(b, a));
    let nrm = perp(d);
    // toward the floor: away from the stair's footprint / the well
    const m = lerp2(a, b, 0.5);
    const probe = add(m, mul(nrm, 0.05));
    const inStair = (holeish.length && pointInPolygon(probe, holeish)) || (W.well.length >= 3 && pointInPolygon(probe, W.well));
    if (inStair) nrm = mul(nrm, -1);
    const sh = mul(nrm, post / 2);
    guards.push({ id: g.id, level: g.level ?? toLevel, line: [add(a, sh), add(b, sh)], raw: [a, b], normal: nrm, y0: topY, height: gH, post });
  }

  // ---- the handrail on the shaft walls (V22): 0.90 over the nosing line along the walls, the top end at startHeight
  const handrails = [];
  const wallName = (k) => {
    const sgn = sideToFlight(outer, 1)(k);
    const nIn = mul(perp(unit(sub(outer.pts[k + 1], outer.pts[k]))), sgn);
    if (Math.abs(nIn[0]) >= Math.abs(nIn[1])) return nIn[0] > 0 ? 'nord' : 'sør';
    return nIn[1] > 0 ? 'øst' : 'vest';
  };
  for (const h of Array.isArray(stair.handrails) ? stair.handrails : []) {
    const prof = Array.isArray(h.profile) ? h.profile : [0.05, 0.04];
    const rh = isNum(h.height) ? h.height : 0.9;
    const off = (isNum(h.offset) ? h.offset : 0.05) + prof[1] / 2;
    const path = offsetChain(outer, off, sideToFlight(outer, 1));
    const walls = new Set(Array.isArray(h.walls) ? h.walls : ['øst', 'nord', 'vest']);
    // the top end: the start point projected onto the rail line; the lower end over the middle of tread 1 (V22: «fra
    // trinn 1–2»)
    const startP = h.start ? pt(h.start) : null;
    const sTop = startP ? path.project(startP).s : path.length;
    const sLow = nosings[0].sOut != null && nosings[1]?.sOut != null ? (nosings[0].sOut + nosings[1].sOut) / 2 : 0;
    const startH = isNum(h.startHeight) ? topY + h.startHeight : null;
    const ss = sampleChain(path, sLow, sTop, []);
    const raw = (s) => noseOut(clamp(s, 0, outer.length)) + rh;
    const endRaw = raw(sTop);
    const pts = ss.map((s) => {
      let y = raw(s);
      if (startH !== null) y -= (endRaw - startH) * smoothstep(sTop - 0.45, sTop, s);
      return { s, p: path.at(s), y };
    });
    // smooth (±0.2 m window) so the rail runs on through the winders, keeping both ends
    const sm = pts.map((q, i) => {
      if (i === 0 || i === pts.length - 1) return q;
      let wsum = 0;
      let ysum = 0;
      for (const o of pts) {
        const w = Math.max(0, 1 - Math.abs(o.s - q.s) / 0.2);
        wsum += w;
        ysum += w * o.y;
      }
      return { ...q, y: ysum / (wsum || 1) };
    });
    // which wall each sample is on (by the chain segment)
    const segOf = (s) => {
      let k = 0;
      while (k < path.cum.length - 2 && path.cum[k + 1] < s - 1e-9) k++;
      return k;
    };
    const run = sm.map((q) => ({ ...q, wall: wallName(segOf(q.s)) }));
    const railPts = run.filter((q) => walls.has(q.wall) || path.cum.some((c) => Math.abs(c - q.s) < 1e-6));
    // LED strips under the rail: one per straight wall run (§4.11)
    const led = [];
    if (h.led) {
      const ledWalls = new Set(Array.isArray(h.led.walls) ? h.led.walls : ['øst', 'nord']);
      for (let k = 0; k < path.pts.length - 1; k++) {
        const name = wallName(k);
        if (!ledWalls.has(name)) continue;
        const a = Math.max(sLow, path.cum[k] + 0.04);
        const b = Math.min(sTop - 0.03, path.cum[k + 1] - 0.04);
        if (b - a < 0.2) continue;
        const seg = railPts.filter((q) => q.s >= a - 1e-9 && q.s <= b + 1e-9);
        const ya = interpY(railPts, a);
        const yb = interpY(railPts, b);
        const pa = path.at(a);
        const pb = path.at(b);
        led.push({
          id: `led-${id}-${name}`.replace(/[^a-z0-9_æøå-]/gi, '-'),
          wall: name,
          group: h.led.group ?? 'gang',
          lightColorK: h.led.lightColorK ?? 3000,
          lumensPerM: h.led.lumensPerM ?? 120,
          length: b - a,
          lumens: (h.led.lumensPerM ?? 120) * (b - a),
          from: [pa[0], ya - prof[0] / 2, pa[1]],
          to: [pb[0], yb - prof[0] / 2, pb[1]],
          path: [[pa[0], ya, pa[1]], ...seg.map((q) => [q.p[0], q.y, q.p[1]]), [pb[0], yb, pb[1]]],
        });
      }
    }
    handrails.push({
      side: h.side ?? 'outer',
      profile: prof,
      color: h.color ?? '#1d1e21',
      wallOffset: off,
      path: railPts.map((q) => [q.p[0], q.y, q.p[1]]),
      wallOf: railPts.map((q) => q.wall),
      // the miter direction at each sample (toward the wall)
      side3: railPts.map((q) => {
        const k = segOf(q.s);
        const sgn = sideToFlight(outer, 1)(Math.min(k, outer.pts.length - 2));
        const nIn = mul(perp(path.dirAt(k)), sgn);
        return [-nIn[0], -nIn[1]];
      }),
      led,
      startHeight: h.startHeight ?? null,
    });
  }

  // ---- the top edge's nosing list (§2.6): oak, the nose over the hole, the rest on the floor
  const te = W.te;
  const listDepth = 0.05;
  const nosingList = {
    lip: ccw([add(te[0], mul(W.d1, nosing)), add(te[1], mul(W.d1, nosing)), te[1], te[0]]),
    cap: ccw([te[0], te[1], sub(te[1], mul(W.d1, listDepth)), sub(te[0], mul(W.d1, listDepth))]),
    lipY: [topY - 0.035, topY + 0.004],
    capY: [topY, topY + 0.004],
  };

  // ---- ramp: the walking surface (the wedge's top) at a plan point
  const contains = (p) => footprint.length >= 3 && inOrOn(p, footprint, 1e-6) && !(W.well.length >= 3 && pointInPolygon(p, W.well) && distToPolygon(p, W.well) > 1e-6);
  const surfaceY = (x, z) => {
    const p = [x, z];
    if (!contains(p)) return null;
    return rampY(W.param(p));
  };
  /** lowest y of the stair (tread / batten / stringer underside) above a plan point, or null */
  const undersideAt = (x, z) => {
    const p = [x, z];
    let low = null;
    const take = (y) => {
      if (low === null || y < low) low = y;
    };
    for (const t of treads) {
      if (pointInPolygon(p, t.plate)) take(t.bottom);
      if (t.batten && pointInPolygon(p, t.batten.polygon)) take(t.batten.y0);
    }
    for (const [key, st] of [['outer', stringers.outer], ['inner', stringers.inner]]) {
      const pr = st.chain.project(p);
      const sgn = st.side(segIndex(st.chain, pr.s));
      const nIn = mul(perp(st.chain.dirAt(segIndex(st.chain, pr.s))), sgn);
      const off = dot(sub(p, st.chain.at(pr.s)), nIn);
      if (off < -1e-6 || off > strT + 1e-6) continue;
      const smp = st.samples;
      if (!smp.length || pr.s < smp[0].s - 1e-6 || pr.s > smp[smp.length - 1].s + 1e-6) continue;
      void key;
      take(interpField(smp, pr.s, 'bottom'));
    }
    return low;
  };

  return {
    ...base,
    bottomY,
    topY,
    rise,
    risers,
    riser,
    slab,
    /** mean going on the walk line (the validator's), the foot's straight treads, the others */
    going: L / n,
    goingFoot: gFoot,
    goingRest: gRest,
    /** slope of the wedge along the walk line and of riser / mean going (the validator's θ) */
    rampDeg: (Math.atan2(rise, L) * 180) / Math.PI,
    slopeDeg: (Math.atan2(riser, L / n) * 180) / Math.PI,
    nosing,
    treadThickness: treadT,
    batten,
    walk: { length: L, at: W.at, param: W.param, segments: W.segs.map((g) => ({ kind: g.kind, start: g.s0, length: g.len, C: g.C ?? null })), P0: W.P0, P3: W.P3, corners: W.corners },
    footprint,
    well: W.well,
    inner,
    outer,
    innerOff,
    outerOff,
    footIn: fIn,
    footOut: fOut,
    nosings,
    treads,
    sections,
    stringers,
    wellGuard,
    guards,
    handrails,
    nosingList,
    ledge: stair.ledge ?? null,
    decor: Array.isArray(stair.decor) ? stair.decor : [],
    rampY,
    contains: (x, z) => contains([x, z]),
    surfaceY,
    undersideAt,
  };
}

function segIndex(chain, s) {
  let k = 0;
  while (k < chain.cum.length - 2 && chain.cum[k + 1] < s - 1e-9) k++;
  return k;
}
function interpField(samples, s, key) {
  if (s <= samples[0].s) return samples[0][key];
  for (let i = 1; i < samples.length; i++) {
    if (samples[i].s >= s) {
      const a = samples[i - 1];
      const b = samples[i];
      return lerp(a[key], b[key], (s - a.s) / (b.s - a.s || 1));
    }
  }
  return samples[samples.length - 1][key];
}
function interpY(pts, s) {
  if (s <= pts[0].s) return pts[0].y;
  for (let i = 1; i < pts.length; i++) {
    if (pts[i].s >= s) return lerp(pts[i - 1].y, pts[i].y, (s - pts[i - 1].s) / (pts[i].s - pts[i - 1].s || 1));
  }
  return pts[pts.length - 1].y;
}

// ---------------------------------------------------------------------------------------------------------------
// Colliders

/**
 * Builds a closed solid from cross-sections ({ inner, outer, yTop, yBot }, in order): top, soffit, both sides and the
 * end caps, every triangle facing outwards (Octree's capsule test is one-sided). Degenerate triangles are dropped.
 * @returns {Float32Array} positions (non-indexed)
 */
function sectionSolid(sections, endDirs) {
  const out = [];
  const tri = (a, b, c, want) => {
    const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const nn = [ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]];
    const area = Math.hypot(nn[0], nn[1], nn[2]);
    if (area < 1e-9) return;
    const flip = nn[0] * want[0] + nn[1] * want[1] + nn[2] * want[2] < 0;
    if (flip) out.push(...a, ...c, ...b);
    else out.push(...a, ...b, ...c);
  };
  const quad = (a, b, c, d, want) => {
    tri(a, b, c, want);
    tri(a, c, d, want);
  };
  const V = (p, y) => [p[0], y, p[1]];
  // every cross-section is cut into M pieces, the first one 2 cm long: in a turn all sections share the well's corner
  // (the helicoid's axis), and the triangle between two sections that touches it is vertical – a fin only 2 cm long
  const M = 9;
  const pts = (s) => {
    const l = dist(s.inner, s.outer) || 1;
    const f1 = Math.min(0.5, 0.02 / l);
    const out2 = [s.inner];
    for (let j = 1; j <= M; j++) out2.push(lerp2(s.inner, s.outer, j === 1 ? f1 : lerp(f1, 1, (j - 1) / (M - 1))));
    return out2;
  };
  const P = sections.map(pts);
  for (let i = 0; i < sections.length - 1; i++) {
    const s0 = sections[i];
    const s1 = sections[i + 1];
    const a = P[i];
    const b = P[i + 1];
    // flat on the floor in front of the lowest nosing (the nose's 3 cm): nothing to collide with but the floor
    if (s0.yTop - s0.yBot < 1e-6 && s1.yTop - s1.yBot < 1e-6) continue;
    for (let j = 0; j < M; j++) {
      quad(V(a[j], s0.yTop), V(a[j + 1], s0.yTop), V(b[j + 1], s1.yTop), V(b[j], s1.yTop), [0, 1, 0]);
      quad(V(a[j], s0.yBot), V(a[j + 1], s0.yBot), V(b[j + 1], s1.yBot), V(b[j], s1.yBot), [0, -1, 0]);
    }
    const toIn = unit(sub(lerp2(s0.inner, s1.inner, 0.5), lerp2(s0.outer, s1.outer, 0.5)));
    quad(V(s0.inner, s0.yBot), V(s0.inner, s0.yTop), V(s1.inner, s1.yTop), V(s1.inner, s1.yBot), [toIn[0], 0, toIn[1]]);
    quad(V(s0.outer, s0.yBot), V(s0.outer, s0.yTop), V(s1.outer, s1.yTop), V(s1.outer, s1.yBot), [-toIn[0], 0, -toIn[1]]);
  }
  const cap = (i, d) => {
    const s = sections[i];
    const p = P[i];
    for (let j = 0; j < M; j++) quad(V(p[j], s.yBot), V(p[j + 1], s.yBot), V(p[j + 1], s.yTop), V(p[j], s.yTop), [d[0], 0, d[1]]);
  };
  cap(0, endDirs[0]);
  cap(sections.length - 1, endDirs[1]);
  return new Float32Array(out);
}

/**
 * Static colliders of a stair: the wedge (one closed THREE.Mesh, not in the scene), the inner stringer sides from the
 * soffit to STAIR.guardCollide over the ramp (THREE.Box3 pieces outside the flight) and a clearance block at each
 * corner of the well.
 * @param {object} lay  stairLayout(…)
 * @returns {Array<THREE.Box3|THREE.Mesh>}
 */
export function stairColliders(lay) {
  if (!lay?.sections?.length) return [];
  const out = [];
  const secs = lay.sections;
  const pos = sectionSolid(secs, [mul(lay.walk.at(0).dir, -1), lay.walk.at(lay.walk.length).dir]);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  geo.computeBoundingBox();
  const wedge = new THREE.Mesh(geo);
  wedge.name = `stair-wedge:${lay.id}`;
  wedge.visible = false;
  wedge.userData.collider = 'stair-wedge';
  wedge.userData.stairId = lay.id;
  out.push(wedge);

  // the inner stringer sides: boxes along the inner line, on the far side of it (in the well / toward the open floor)
  const { inner } = lay;
  const sideOf = lay.stringers.inner.side;
  const t = STAIR.guardThickness;
  const corners = lay.walk.corners || [];
  const cornerS = corners.map((c) => inner.project(c).s);
  const keepOff = STAIR.cornerClear;
  const rampNear = (p, nIn) => {
    const q = add(p, mul(nIn, 0.01));
    const y = lay.surfaceY(q[0], q[1]);
    return y === null ? lay.rampY(lay.walk.param(q)) : y;
  };
  for (let k = 0; k < inner.pts.length - 1; k++) {
    const a = inner.pts[k];
    const b = inner.pts[k + 1];
    const d = unit(sub(b, a));
    const nIn = mul(perp(d), sideOf(k)); // into the flight
    const L = dist(a, b);
    const s0 = inner.cum[k];
    const pieces = Math.max(1, Math.ceil(L / 0.05));
    for (let i = 0; i < pieces; i++) {
      const sa = s0 + (L * i) / pieces;
      const sb = s0 + (L * (i + 1)) / pieces;
      if (cornerS.some((c) => sb > c - keepOff && sa < c + keepOff)) continue;
      const pa = inner.at(sa);
      const pb = inner.at(sb);
      const ya = rampNear(pa, nIn);
      const yb = rampNear(pb, nIn);
      const yLow = Math.max(lay.bottomY, Math.min(ya, yb) - STAIR.wedgeDepth);
      const yHigh = Math.max(ya, yb) + STAIR.guardCollide;
      const qa = add(pa, mul(nIn, -t));
      const qb = add(pb, mul(nIn, -t));
      out.push(new THREE.Box3(
        new THREE.Vector3(Math.min(pa[0], pb[0], qa[0], qb[0]), yLow, Math.min(pa[1], pb[1], qa[1], qb[1])),
        new THREE.Vector3(Math.max(pa[0], pb[0], qa[0], qb[0]), yHigh, Math.max(pa[1], pb[1], qa[1], qb[1])),
      ));
    }
  }
  // the corners of the well: the turn's arc spans every height there
  for (const c of corners) {
    const arcs = lay.walk.segments.filter((g) => g.kind === 'arc');
    let lo = Infinity;
    let hi = -Infinity;
    for (const g of arcs) {
      if (!g.C || dist(g.C, c) > 1e-6) continue;
      lo = Math.min(lo, lay.rampY(g.start + g.length + 0.1));
      hi = Math.max(hi, lay.rampY(Math.max(0, g.start - 0.1)));
    }
    if (!Number.isFinite(lo)) continue;
    out.push(new THREE.Box3(
      new THREE.Vector3(c[0] - keepOff, Math.max(lay.bottomY, lo - STAIR.wedgeDepth), c[1] - keepOff),
      new THREE.Vector3(c[0] + keepOff, hi + STAIR.guardCollide, c[1] + keepOff),
    ));
  }
  return out;
}

/**
 * Splits rectilinear polygons (minus holes) into few axis-aligned rectangles: a grid on every corner coordinate, the
 * cells inside a polygon and outside every hole, merged along x and then along z.
 * @returns {Array<[number, number, number, number]>} [minX, maxX, minZ, maxZ]
 */
export function rectangles(polys, holes = []) {
  const xs = [...new Set(polys.flat().concat(holes.flat()).map((p) => +p[0].toFixed(6)))].sort((a, b) => a - b);
  const zs = [...new Set(polys.flat().concat(holes.flat()).map((p) => +p[1].toFixed(6)))].sort((a, b) => a - b);
  const cell = (i, j) => {
    const c = [(xs[i] + xs[i + 1]) / 2, (zs[j] + zs[j + 1]) / 2];
    return polys.some((pl) => pointInPolygon(c, pl)) && !holes.some((h) => pointInPolygon(c, h));
  };
  let open = new Map(); // "i0,i1" → rect being grown along z
  const out = [];
  for (let j = 0; j < zs.length - 1; j++) {
    const runs = [];
    let i = 0;
    while (i < xs.length - 1) {
      if (!cell(i, j)) {
        i++;
        continue;
      }
      let e = i;
      while (e < xs.length - 1 && cell(e, j)) e++;
      runs.push([i, e]);
      i = e;
    }
    const next = new Map();
    for (const [a, b] of runs) {
      const key = `${a},${b}`;
      const r = open.get(key);
      if (r) {
        r[3] = zs[j + 1];
        next.set(key, r);
        open.delete(key);
      } else next.set(key, [xs[a], xs[b], zs[j], zs[j + 1]]);
    }
    for (const r of open.values()) out.push(r);
    open = next;
  }
  for (const r of open.values()) out.push(r);
  return out;
}

/**
 * Static colliders of a level's slab and its guards (§2.8, §3.3): the slab box (floorY − slabThickness … floorY) under
 * the level's physical rooms minus its floor openings – it stops the head of a player jumping on the level below –
 * and one box per guard (A/B/C) of the stairs that end on this level, from the floor to the guard's height. A level
 * with nothing below it gets the guards only.
 * @param {object} layout   home/layout.js
 * @param {string} levelId
 * @returns {THREE.Box3[]}
 */
export function slabColliders(layout, levelId) {
  const h = layout?.house;
  if (!h) return [];
  const lv = (h.levels || []).find((l) => l.id === levelId);
  if (!lv) return [];
  const out = [];
  const t = isNum(lv.slabThickness) ? lv.slabThickness : 0.3;
  if (lv.belowId) {
    const rooms = (h.rooms || []).filter((r) => r.levelId === levelId && !r.hud && r.kind !== 'hud' && r.polygon?.length >= 3);
    const holes = (h.floorOpenings || []).filter((fo) => fo.levelId === levelId).map((fo) => poly(fo.polygon));
    const byY = new Map();
    for (const r of rooms) {
      const y = isNum(r.floorY) ? r.floorY : lv.floorY;
      if (!byY.has(y)) byY.set(y, []);
      byY.get(y).push(poly(r.polygon));
    }
    for (const [y, polys] of byY) {
      for (const [x0, x1, z0, z1] of rectangles(polys, holes)) out.push(new THREE.Box3(new THREE.Vector3(x0, y - t, z0), new THREE.Vector3(x1, y, z1)));
    }
  }
  for (const st of h.stairs || []) {
    if (st.toLevel !== levelId) continue;
    const lay = stairLayout(st, h.levels);
    for (const g of lay.guards || []) {
      if (g.level !== levelId) continue;
      const [a, b] = g.line;
      const half = g.post / 2;
      out.push(new THREE.Box3(
        new THREE.Vector3(Math.min(a[0], b[0]) - half, g.y0, Math.min(a[1], b[1]) - half),
        new THREE.Vector3(Math.max(a[0], b[0]) + half, g.y0 + g.height, Math.max(a[1], b[1]) + half),
      ));
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// buildStairs (three.js)

/**
 * Builds every stair of layout.house.stairs (STUB: nothing yet).
 * @param {object} ctx     createHome ctx (+ ctx.roots)
 * @param {object} layout  home/layout.js
 */
export function buildStairs(ctx, layout) {
  const group = new THREE.Group();
  group.name = 'stairs';
  return {
    group,
    walls: [],
    windows: [],
    doors: [],
    pickables: { floor: [], walls: [], ceilings: [], windows: [] },
    builtInLights: [],
    colliders: [],
    update() {},
    setPaint() {},
    dispose() {
      group.removeFromParent();
    },
  };
}
