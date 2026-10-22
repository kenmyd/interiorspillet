/**
 * STAIR TYPES – the plan of the stair types besides the owner's half-turn stair (notes/trapper.md). Pure: no three.js,
 * no imports. src/home/stairs.js (the builder), src/home/layout.js (floorYAt) and src/data/scripts/house.mjs
 * (validateHouse) share it, so the three agree on the walk line, the risers and the ramp. The half-turn stair
 * ('half-turn-winder', research/house/20-trapp.json) keeps its own code in each of them.
 *
 *   'straight'              one flight from top.edge to foot.edge;
 *   'steep'                 the same, steep (a ship's ladder / attic stair, 50–75°): the player climbs it on an
 *                           analytic surface (stairClimb in stairs.js, CollisionWorld climbs), not on the wedge;
 *   'quarter-turn-winder'   two flights at 90° (an L), balanced winders in the corner;
 *   'quarter-turn-landing'  two flights at 90°, a square landing in the corner.
 *
 * Plan points are [x, z]. Directions: perp(d) = [−d.z, d.x] is the right-hand side walking along d (y up). The walk
 * line goes from the top edge (u = 0, the upper floor's edge) to the lowest nosing (u = length), in the middle of each
 * flight, and round the inner corner of an L on a quarter arc (centre the corner, radius half the top flight's width →
 * half the foot flight's): the same line as V13 of the half-turn stair.
 */

export const STAIR_TYPES = Object.freeze(['straight', 'half-turn-winder', 'quarter-turn-winder', 'quarter-turn-landing', 'steep']);
const QUARTER = new Set(['quarter-turn-winder', 'quarter-turn-landing']);
/** A two-flight stair at 90° (an L). */
export const isQuarterTurn = (type) => QUARTER.has(type);
/** One flight (straight or steep). */
export const isStraightType = (type) => type === 'straight' || type === 'steep';
/** Handled by this module (everything but the half-turn stair and unknown types). */
export const isPlanType = (type) => isStraightType(type) || isQuarterTurn(type);

/** 2R + G the default number of risers aims at (TEK: 0.60–0.64). */
export const STEP_TARGET = 0.62;
/** Highest riser the default picks: an ordinary stair / a steep one. */
export const RISER_MAX = 0.22;
export const STEEP_RISER_MAX = 0.25;
/** Shortest going on the walk line the default picks (a steep stair's treads overlap little). */
export const GOING_MIN = 0.1;
/**
 * Steepest ramp the player walks on the collision wedge: WALKABLE_NORMAL_Y 0.62 is 51.7°, the ground snap holds 49°
 * (tools/house-tests/stair-geom.test.mjs); 48° leaves a margin. A steeper stair has to be 'steep' (climbed).
 */
export const WALK_MAX_DEG = 48;
/** The stringers of a plan stair reach this far past the lowest nose (stringers.footCut = tread.nosing + this). */
export const FOOT_CUT_EXTRA = 0.015;
/**
 * A 'steep' stair: below minDeg (riser / going) validateHouse warns; its ramp (the climb, top edge to the floor at the
 * lowest nosing) steeper than maxRampDeg, a riser over riserMax or a going under goingMin are judged. Over a 68° ramp
 * the climb surface, lifted at the top edge, does not come down to the ramp before the foot (measured at 30–144 Hz).
 */
export const STEEP = Object.freeze({ minDeg: 45, maxRampDeg: 68, riserMax: 0.25, goingMin: 0.1 });

const EPS = 1e-9;
const TOL = 0.005;
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
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
/** [x, z] from an array, a THREE.Vector2 ({x, y}) or a {x, z}. */
const pt = (p) => (Array.isArray(p) ? [Number(p[0]), Number(p[1])] : p && isNum(p.x) ? [p.x, isNum(p.z) && !isNum(p.y) ? p.z : p.y] : null);
const signedArea = (pl) => {
  let s = 0;
  for (let i = 0; i < pl.length; i++) s += pl[i][0] * pl[(i + 1) % pl.length][1] - pl[(i + 1) % pl.length][0] * pl[i][1];
  return s / 2;
};

/** Intersection of the lines a + s·da and b + t·db; null when parallel. */
function meet(a, da, b, db) {
  const den = cross(da, db);
  if (Math.abs(den) < 1e-9) return null;
  return add(a, mul(da, cross(sub(b, a), db) / den));
}

/**
 * Walk functions over line / arc segments ({ kind: 'line', a, d, len, hw } | { kind: 'arc', C, a0, da, rs, re, len }):
 * at(u) → { p, dir (down the stair), seg, radial? } (beyond the ends the end flights go on straight) and param(p) – the
 * walk parameter of a plan point (the cross-section through it: square to a flight, radial in a turn). The same
 * functions as the half-turn stair's walkLine in stairs.js.
 */
export function walkFunctions(segs) {
  let s0 = 0;
  for (const g of segs) {
    g.s0 = s0;
    s0 += g.len;
  }
  const length = s0;
  const last = segs[segs.length - 1];
  const segAt = (u) => (u >= length ? last : u <= 0 ? segs[0] : segs.find((g) => u <= g.s0 + g.len + 1e-12 && g.len > 0) ?? last);
  const at = (u) => {
    const g = segAt(u);
    if (g.kind === 'line') return { p: add(g.a, mul(g.d, u - g.s0)), dir: g.d, seg: g };
    const t = g.len > 0 ? clamp((u - g.s0) / g.len, 0, 1) : 0;
    const ang = g.a0 + g.da * t;
    const radial = [Math.cos(ang), Math.sin(ang)];
    const p = add(g.C, mul(radial, lerp(g.rs, g.re, t)));
    const s = Math.sign(g.da) || 1;
    return { p, dir: [s * -radial[1], s * radial[0]], seg: g, radial };
  };
  const param = (p) => {
    let best = null;
    for (let i = 0; i < segs.length; i++) {
      const g = segs[i];
      let u;
      let d;
      if (g.kind === 'line') {
        const t = dot(sub(p, g.a), g.d);
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
    return dist(p, segs[0].a) <= dist(p, at(length).p) ? 0 : length;
  };
  return { length, segAt, at, param };
}

const lineSeg = (a, d, l, hw) => ({ kind: 'line', a, d, len: Math.max(0, l), hw });
const arcSeg = (C, from, to, rs, re) => {
  const a0 = Math.atan2(from[1], from[0]);
  const da = Math.atan2(cross(from, to), dot(from, to));
  return { kind: 'arc', C, a0, da, rs, re, len: (Math.abs(da) * (rs + re)) / 2 };
};

/** The two ends of an edge as [right, left] walking along d. */
function bySide(edge, d) {
  const r = perp(d);
  return dot(edge[0], r) >= dot(edge[1], r) ? [edge[0], edge[1]] : [edge[1], edge[0]];
}

/**
 * The plan of a straight, steep or quarter-turn stair.
 * @param {object} stair  a house-format stair (top/foot { edge, down }, type, tread.nosing)
 * @returns {object} { type, segs, length, at, param, corners, P0, P3, d1, d2, w1, w2, te: [inner, outer],
 *   fe: [inner, outer], turn (+1 right / −1 left going down, 0 straight), innerUp ('left' | 'right': the inner side
 *   seen going up), L1, La, L3 (top flight, turn, foot flight on the walk line), landing, footprint (the default:
 *   the flight's rectangle / the L), walkDeg }
 * Throws (Norwegian message) when the edges do not make the type.
 */
export function stairPlan(stair) {
  const type = stair.type;
  const te = [pt(stair.top?.edge?.[0]), pt(stair.top?.edge?.[1])];
  const fe = [pt(stair.foot?.edge?.[0]), pt(stair.foot?.edge?.[1])];
  if (!te[0] || !te[1] || !fe[0] || !fe[1]) throw new Error('top.edge og foot.edge må være to punkter hver');
  const d1 = unit(pt(stair.top?.down) ?? [0, 0]);
  const d2 = unit(pt(stair.foot?.down) ?? [0, 0]);
  if (!len(d1) || !len(d2)) throw new Error('top.down og foot.down må være retninger');
  const nosing = isNum(stair.tread?.nosing) ? stair.tread.nosing : 0.03;
  const P0 = mul(add(te[0], te[1]), 0.5);
  const P3 = mul(add(fe[0], fe[1]), 0.5);
  const w1 = dist(te[0], te[1]);
  const w2 = dist(fe[0], fe[1]);
  const ccw = (pl) => (signedArea(pl) < 0 ? [...pl].reverse() : pl);
  let plan;
  if (isQuarterTurn(type)) {
    if (Math.abs(dot(d1, d2)) > 0.2) throw new Error('en kvartsvingt trapp må ha top.down og foot.down på tvers av hverandre (90°)');
    const turn = cross(d1, d2) > 0 ? 1 : -1;
    const [tR, tL] = bySide(te, d1);
    const [fR, fL] = bySide(fe, d2);
    const [tIn, tOut] = turn > 0 ? [tR, tL] : [tL, tR];
    const [fIn, fOut] = turn > 0 ? [fR, fL] : [fL, fR];
    const C = meet(tIn, d1, fIn, d2);
    const O = meet(tOut, d1, fOut, d2);
    if (!C || !O) throw new Error('top.down og foot.down er parallelle');
    const L1 = dot(sub(C, P0), d1);
    const L3 = dot(sub(P3, C), d2);
    if (L1 < -TOL || L3 < -TOL) throw new Error('top.edge og foot.edge passer ikke med svingen: løpene må gå mot og fra hjørnet');
    const P1 = add(P0, mul(d1, Math.max(0, L1)));
    const P2 = sub(P3, mul(d2, Math.max(0, L3)));
    const r1 = Math.abs(cross(d1, sub(C, P0)));
    const r3 = Math.abs(cross(d2, sub(P3, C)));
    const segs = [lineSeg(P0, d1, L1, w1 / 2), arcSeg(C, unit(sub(P1, C)), unit(sub(P2, C)), r1, r3), lineSeg(P2, d2, L3, w2 / 2)];
    const footprint = ccw([tOut, tIn, C, add(fIn, mul(d2, nosing)), add(fOut, mul(d2, nosing)), O]);
    plan = { segs, corners: [C], outerCorner: O, te: [tIn, tOut], fe: [fIn, fOut], turn, innerUp: turn > 0 ? 'left' : 'right', L1: Math.max(0, L1), La: segs[1].len, L3: Math.max(0, L3), footprint };
  } else if (isStraightType(type)) {
    const L = dist(P0, P3);
    const d = L > EPS ? unit(sub(P3, P0)) : d1;
    if (dot(sub(P3, P0), d1) < L - 0.01) throw new Error('en rett trapp må gå fra top.edge til foot.edge langs top.down');
    const [tR, tL] = bySide(te, d);
    const [fR, fL] = bySide(fe, d);
    // inner = the right-hand side going down (the left one going up)
    const footprint = ccw([tL, tR, add(fR, mul(d, nosing)), add(fL, mul(d, nosing))]);
    plan = { segs: [lineSeg(P0, d, L, w1 / 2)], corners: [], te: [tR, tL], fe: [fR, fL], turn: 0, innerUp: 'left', L1: L, La: 0, L3: 0, footprint };
  } else throw new Error(`stairPlan: typen «${type}» har sin egen kode`);
  const W = walkFunctions(plan.segs);
  return { type, ...plan, ...W, P0, P3, d1, d2, w1, w2, landing: type === 'quarter-turn-landing', steep: type === 'steep' };
}

/** 'inner' | 'outer' of a side name ('inner', 'outer', 'left', 'right' – left / right seen going up). */
export function sideKey(plan, side) {
  if (side === 'inner' || side === 'well') return 'inner';
  if (side === 'outer') return 'outer';
  if (side === 'left' || side === 'right') return side === plan.innerUp ? 'inner' : 'outer';
  return null;
}

/**
 * Treads per flight of a landing stair (risers − 2 = top + foot; the landing is one tread): top.straightTreads /
 * foot.straightTreads when given, else in proportion to the flights' lengths.
 */
export function landingSplit(plan, risers, stair = {}) {
  const n = Math.max(0, risers - 2);
  let nf = Number.isInteger(stair.foot?.straightTreads) ? stair.foot.straightTreads : null;
  let nt = Number.isInteger(stair.top?.straightTreads) ? stair.top.straightTreads : null;
  if (nf === null && nt === null) nf = Math.round((n * plan.L3) / (plan.L1 + plan.L3 || 1));
  if (nf === null) nf = n - nt;
  nf = clamp(nf, plan.L3 > 0.05 ? 1 : 0, n);
  nt = n - nf;
  if (nt < 1 && plan.L1 > 0.05 && nf > 1) {
    nt = 1;
    nf = n - 1;
  }
  return { nt, nf };
}

/** The mean going a stair's 2R + G is judged on: the walk line over the treads, the landing left out. */
export function planGoing(plan, risers) {
  if (plan.landing) return (plan.L1 + plan.L3) / Math.max(1, risers - 2);
  return plan.length / Math.max(1, risers - 1);
}

/**
 * The number of risers for a rise and a plan: 2R + G closest to STEP_TARGET with R ≤ RISER_MAX (STEEP_RISER_MAX for
 * a steep stair) and G ≥ GOING_MIN; a landing counts as no going.
 */
export function stairRisers(rise, plan) {
  const rMax = plan.steep ? STEEP_RISER_MAX : RISER_MAX;
  let best = null;
  for (let n = plan.landing ? 3 : 2; n <= 80; n++) {
    const R = rise / n;
    const G = planGoing(plan, n);
    const score = Math.abs(2 * R + G - STEP_TARGET) + (R > rMax ? 10 * (R - rMax) : 0) + (G < GOING_MIN ? 10 * (GOING_MIN - G) : 0);
    if (!best || score < best.score - 1e-12) best = { n, score };
  }
  return best ? best.n : Math.max(2, Math.round(rise / 0.18));
}

/**
 * The ramp along the walk line (the top of the collision wedge, layout floorYAt): knots [u, y]. One line from the
 * upper floor at the top edge to the lower floor at the lowest nosing (as the half-turn stair); a landing stair is
 * level over the landing, each flight ending on its floor (the landing or the lower floor) at its lowest nosing.
 */
export function rampKnots(plan, risers, topY, bottomY, stair = {}) {
  const L = plan.length;
  if (!plan.landing) return [[0, topY], [L, bottomY]];
  const { nf } = landingSplit(plan, risers, stair);
  const yL = bottomY + ((nf + 1) * (topY - bottomY)) / risers;
  return [[0, topY], [plan.L1, yL], [plan.L1 + plan.La, yL], [L, bottomY]];
}

/** y of the ramp at u (clamped to the walk line). */
export function rampAt(knots, u) {
  const L = knots[knots.length - 1][0];
  const v = clamp(u, 0, L);
  for (let i = 1; i < knots.length; i++) {
    const [u1, y1] = knots[i];
    if (v <= u1 + 1e-12) {
      const [u0, y0] = knots[i - 1];
      return u1 - u0 > EPS ? lerp(y0, y1, (v - u0) / (u1 - u0)) : y1;
    }
  }
  return knots[knots.length - 1][1];
}

/** Steepest part of the ramp, degrees. */
export function rampDeg(knots) {
  let worst = 0;
  for (let i = 1; i < knots.length; i++) {
    const du = knots[i][0] - knots[i - 1][0];
    const dy = Math.abs(knots[i][1] - knots[i - 1][1]);
    if (du > EPS) worst = Math.max(worst, (Math.atan2(dy, du) * 180) / Math.PI);
    else if (dy > EPS) worst = 90;
  }
  return worst;
}

/**
 * The nosings of a plan stair along the walk line: vOf(k) (from the lowest nosing, k = 1 … risers; u = length − v),
 * kindOf(k) ('straight' | 'winder') and the bounds of the winders (nf straight treads at the foot, nt at the top).
 *   straight / steep: equal goings;
 *   quarter-turn-winder: equal goings on the walk line; the nosings within one going of the turn (the arc) are winders,
 *     spread along the inner line between the last straight ones (balanced, as the half-turn stair);
 *   quarter-turn-landing: each flight's treads fill it (landingSplit), the landing is tread nf + 1.
 * top.straightTreads / foot.straightTreads override the winder stair's counts.
 */
export function nosingPlan(plan, risers, stair = {}) {
  const n = risers - 1;
  const L = plan.length;
  if (plan.landing) {
    const { nt, nf } = landingSplit(plan, risers, stair);
    const g3 = nf ? plan.L3 / nf : 0;
    const g1 = nt ? plan.L1 / nt : 0;
    const vOf = (k) => (k <= nf + 1 ? (k - 1) * g3 : L - (risers - k) * g1);
    return { vOf, kindOf: () => 'straight', nf, nt, gFoot: g3, gRest: g1, landingK: nf + 1 };
  }
  const g = L / Math.max(1, n);
  if (!isQuarterTurn(plan.type)) return { vOf: (k) => (k - 1) * g, kindOf: () => 'straight', nf: n, nt: 0, gFoot: g, gRest: g, landingK: null };
  const b = g; // the balancing reaches one going into each flight
  let nf = Number.isInteger(stair.foot?.straightTreads) ? stair.foot.straightTreads : Math.floor((plan.L3 - b) / g + 1e-6);
  let nt = Number.isInteger(stair.top?.straightTreads) ? stair.top.straightTreads : Math.floor((plan.L1 - b) / g + 1e-6);
  // a straight nosing never lies in the turn
  nf = clamp(Math.min(nf, Math.floor(plan.L3 / g + 1e-6)), 0, n);
  nt = clamp(Math.min(nt, Math.floor(plan.L1 / g + 1e-6)), 0, n - nf);
  if (n - nf - nt < 1 && nf + nt > 0) {
    if (nt >= nf && nt > 0) nt--;
    else nf--;
  }
  const kindOf = (k) => (k <= nf + 1 || k >= risers - nt ? 'straight' : 'winder');
  return { vOf: (k) => (k - 1) * g, kindOf, nf, nt, gFoot: g, gRest: g, landingK: null };
}
