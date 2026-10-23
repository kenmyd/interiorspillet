/**
 * ROOF GEOMETRY – the roofs of the house format (notes/tak.md), without three.js: layout.js, the roof builder
 * (home/roof.js), rooms.js (ceilings that follow the roof, the cladding up under it) and the validator
 * (data/scripts/house.mjs) all read the same model.
 *
 *   resolveRoofs(raw, { levels, walls }) → { parts, issues }   the house's `roofs[]` with every default filled in
 *   roofField(parts)                    → field                one level's roof as a height field (below)
 *   splitTriangles(tris, lines)         → tris                 cut 2D triangles along lines (the folds of a field)
 *   liftTriangles(tris, planeAt)        → 3D triangles         each piece on the plane active at its centroid
 *   stepFaces(steps, polygon, surface)  → quads                the vertical faces where a surface jumps (dormer sides)
 *   surfaceProfile(p0, p1, samplers)    → [[u, y], …]          the top of a wall under one or more surfaces
 *
 * Plan points are [x, z] (metres, the house's coordinates). A plane is { a, b, c }: y = a·x + b·z + c (world y). A line
 * is { a, b, c } with a² + b² = 1: the points where a·x + b·z + c = 0. A half-plane { a, b, c } keeps a·x + b·z + c ≤ 0.
 *
 * A roof part is a rectangle in plan (`outline`: the outer faces of the walls it covers) with planes over it. Every
 * plane is the INNER surface of the roof (the underside of the rafters = the sloped ceiling of the rooms under it); the
 * covering lies `tv` higher (the build-up `thickness` measured square to the main slope – a mansard's upper slope, the
 * shallower side of a gable with two pitches – so every plane of a part has the same vertical thickness and the faces
 * of the top and the underside have the same outline). A convex roof is the lowest of its planes (gable 2, hip 4,
 * mono-pitch and flat 1, mansard 4 or 8); a V roof (butterfly) is the highest of its two (`combine: 'max'`). A dormer
 * (ark / takopplett) is a small roof on one slope: inside its opening R (between its side lines, from its front up to
 * the valley where it meets the main roof) the roof is the dormer's, which is higher. A recessed roof terrace is a hole
 * in a slope (no roof inside it).
 *
 * Several parts make a union: the highest one counts, with one exception – a part's overhang (its box outside its
 * `core`: the outline, run on into the parts it meets) does not count over another part's core (a wing's roof goes on
 * under the main house's eave). A part on a lower level does not count inside the core of a part on a higher level (the
 * house's upper floor covers it). A part whose whole side stands against another part runs on into it up to its middle
 * (through it when its ridge is the higher one), unless it falls toward that side (an eave keeps its overhang) or stays
 * above the other one all the way (then the other one runs into it).
 */

const DEG = Math.PI / 180;
const EPS = 1e-7;

export const ROOF_TYPES = Object.freeze(['gable', 'hip', 'half-hip', 'mono-pitch', 'flat', 'mansard', 'butterfly']);
export const DORMER_TYPES = Object.freeze(['gable', 'shed', 'hip']);
export const COVERINGS = Object.freeze(['tile', 'slate', 'felt', 'steel']);

/** Defaults of the format (notes/tak.md). */
export const ROOF_DEFAULTS = Object.freeze({
  pitch: Object.freeze({ gable: 35, hip: 30, 'half-hip': 35, 'mono-pitch': 10, flat: 0, mansard: 60, butterfly: 8 }),
  covering: Object.freeze({ gable: 'tile', hip: 'tile', 'half-hip': 'tile', 'mono-pitch': 'steel', flat: 'felt', mansard: 'slate', butterfly: 'steel' }),
  color: Object.freeze({ tile: '#3a3634', slate: '#3c4046', felt: '#2b2b2d', steel: '#30343a' }),
  overhang: 0.5,
  flatOverhang: 0.3,
  vergeOverhang: 0.3,
  thickness: 0.3,
  trimColor: '#2f2f31',
  valleyColor: '#3e4145',
  wallThickness: 0.3,
  /** mansard: the upper slope's pitch */
  pitchUpper: 25,
  parapet: Object.freeze({ height: 0.3 }),
  /** a recessed roof terrace: the roof's edge stands this far out over its walls */
  terraceEdge: 0.04,
  dormer: Object.freeze({ height: 2.2, overhang: 0.25, frontThickness: 0.15, shedPitch: 12 }),
});
/** The underside of a roof lies this far (vertically) above its inner planes: the ceilings own that plane. */
export const ROOF_GAP = 0.01;
/** The cladding of a wall reaches this far up into the roof (above its inner plane at the wall's outer face). */
export const CLADDING_INTO_ROOF = 0.05;

const num = (v) => typeof v === 'number' && Number.isFinite(v);
const isPt = (p) => Array.isArray(p) && p.length === 2 && num(p[0]) && num(p[1]);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const add = (a, b, k = 1) => [a[0] + b[0] * k, a[1] + b[1] * k];
const len = (a) => Math.hypot(a[0], a[1]);
const norm = (a) => {
  const l = len(a);
  return l > EPS ? [a[0] / l, a[1] / l] : [1, 0];
};
const perp = (a) => [-a[1], a[0]];

export const planeY = (p, x, z) => p.a * x + p.b * z + p.c;

/** Signed area (shoelace in x, z). */
export function polyArea(P) {
  let s = 0;
  for (let i = 0; i < P.length; i++) {
    const p = P[i], q = P[(i + 1) % P.length];
    s += p[0] * q[1] - q[0] * p[1];
  }
  return s / 2;
}

/** Even-odd point in polygon (edges count as inside within tol). */
export function inPolygon(x, z, P, tol = 1e-6) {
  let inside = false;
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
    const a = P[i], b = P[j];
    if (segDist([x, z], a, b) <= tol) return true;
    if (a[1] > z !== b[1] > z && x < ((b[0] - a[0]) * (z - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}
function segDist(p, a, b) {
  const d = sub(b, a);
  const l2 = dot(d, d);
  const t = l2 > 0 ? Math.max(0, Math.min(1, dot(sub(p, a), d) / l2)) : 0;
  return len(sub(p, add(a, d, t)));
}

/** Sutherland–Hodgman: the part of a polygon where hp (a·x + b·z + c ≤ 0) holds. */
export function clipHalf(P, hp) {
  const out = [];
  const f = (p) => hp.a * p[0] + hp.b * p[1] + hp.c;
  for (let i = 0; i < P.length; i++) {
    const p = P[i], q = P[(i + 1) % P.length];
    const fp = f(p), fq = f(q);
    if (fp <= 1e-9) out.push(p);
    if ((fp < -1e-9 && fq > 1e-9) || (fp > 1e-9 && fq < -1e-9)) {
      const t = fp / (fp - fq);
      out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
    }
  }
  // drop repeated points
  const clean = [];
  for (const p of out) {
    const l = clean[clean.length - 1];
    if (!l || Math.abs(l[0] - p[0]) > 1e-9 || Math.abs(l[1] - p[1]) > 1e-9) clean.push(p);
  }
  if (clean.length > 1 && Math.abs(clean[0][0] - clean[clean.length - 1][0]) < 1e-9 && Math.abs(clean[0][1] - clean[clean.length - 1][1]) < 1e-9) clean.pop();
  return clean.length >= 3 ? clean : [];
}
export const clipAll = (P, hps) => hps.reduce((acc, hp) => (acc.length ? clipHalf(acc, hp) : acc), P);

/** Half-plane «plane i ≤ plane j» (with an offset: i + di ≤ j + dj). */
const below = (pi, pj, di = 0, dj = 0) => ({ a: pi.a - pj.a, b: pi.b - pj.b, c: pi.c + di - pj.c - dj });
const flip = (hp) => ({ a: -hp.a, b: -hp.b, c: -hp.c });
/** The plane of a set that counts at x, z: the lowest ('min', a convex roof) or the highest ('max', a V roof). */
export function activePlane(planes, combine, x, z) {
  let best = null, by = combine === 'max' ? -Infinity : Infinity;
  for (const p of planes) {
    const y = planeY(p, x, z);
    if (combine === 'max' ? y > by : y < by) (by = y), (best = p);
  }
  return best;
}
/** The highest point of a convex ('min') or V ('max') surface over a convex polygon. */
function surfaceMax(planes, combine, P) {
  if (combine === 'max') return Math.max(...P.flatMap((q) => planes.map((p) => planeY(p, q[0], q[1]))));
  let best = -Infinity;
  for (const p of planes) for (const q of clipAll(P, planes.filter((o) => o !== p).map((o) => below(p, o)))) best = Math.max(best, planeY(p, q[0], q[1]));
  return best;
}
/** The line where two planes cross (null when parallel). */
function planeLine(pi, pj) {
  const a = pi.a - pj.a, b = pi.b - pj.b;
  const l = Math.hypot(a, b);
  if (l < 1e-9) return null;
  return { a: a / l, b: b / l, c: (pi.c - pj.c) / l };
}
/** The line through two points. */
export function lineThrough(p, q) {
  const d = norm(sub(q, p));
  const n = perp(d);
  return { a: n[0], b: n[1], c: -(n[0] * p[0] + n[1] * p[1]) };
}

/** The half-planes whose intersection is the convex polygon Q (either orientation). */
export function insideHalfPlanes(Q) {
  const ccw = polyArea(Q) > 0;
  return Q.map((a, i) => {
    const l = lineThrough(a, Q[(i + 1) % Q.length]);
    // for a ccw polygon the interior is on the left of a → b, where the line function is positive
    return ccw ? flip(l) : l;
  });
}

/** Smallest distance from a point to a polygon's edges. */
export function edgeDistance(p, P) {
  let d = Infinity;
  for (let i = 0; i < P.length; i++) d = Math.min(d, segDist(p, P[i], P[(i + 1) % P.length]));
  return d;
}

/**
 * Convex polygon P minus convex polygon Q: disjoint convex pieces (P ∩ outside edge k of Q ∩ inside the edges before k).
 * Q counter- or clockwise.
 */
export function subtractConvex(P, Q) {
  if (!P.length || !Q.length) return P.length ? [P] : [];
  const hps = insideHalfPlanes(Q);
  const out = [];
  let rest = P;
  for (const hp of hps) {
    if (!rest.length) break;
    const outside = clipHalf(rest, flip(hp));
    if (outside.length && Math.abs(polyArea(outside)) > 1e-8) out.push(outside);
    rest = clipHalf(rest, hp);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// The rectangle frame of a part: origin O, eu (along the ridge), ev (across), Lu × Lv

/**
 * mono: ev points up the slope (from the low side to the high side). sided (a gable with two different sides, a V
 * roof): ev points from the front side (v0: the side falling toward `fall`, else the side of the first outline edge
 * along the ridge) to the back.
 */
function rectFrame(outline, { along = null, fall = null, mono = false, sided = false } = {}) {
  const [p0, p1, p2] = outline;
  const d0 = norm(sub(p1, p0));
  const d1 = norm(sub(p2, p1));
  const l0 = len(sub(p1, p0)), l1 = len(sub(p2, p1));
  let eu;
  if ((mono || sided) && fall) eu = Math.abs(dot(d0, norm(fall))) <= Math.abs(dot(d1, norm(fall))) ? d0 : d1;
  else if (along) eu = Math.abs(dot(d0, norm(along))) >= Math.abs(dot(d1, norm(along))) ? d0 : d1;
  else eu = l0 >= l1 ? d0 : d1;
  let ev = perp(eu);
  const C = outline.reduce((s, p) => [s[0] + p[0] / 4, s[1] + p[1] / 4], [0, 0]);
  if (mono || sided) {
    if (fall) {
      if (dot(ev, fall) > 0) ev = [-ev[0], -ev[1]];
    } else if (mono) {
      // without fall: high along the longest edge with the lower index, falling across the outline
      const high = l0 >= l1 ? [p0, p1] : [p1, p2];
      const mid = [(high[0][0] + high[1][0]) / 2, (high[0][1] + high[1][1]) / 2];
      if (dot(ev, sub(mid, C)) < 0) ev = [-ev[0], -ev[1]];
    } else {
      const front = Math.abs(dot(d0, eu)) >= Math.abs(dot(d1, eu)) ? [p0, p1] : [p1, p2];
      const mid = [(front[0][0] + front[1][0]) / 2, (front[0][1] + front[1][1]) / 2];
      if (dot(ev, sub(C, mid)) < 0) ev = [-ev[0], -ev[1]];
    }
  }
  const us = outline.map((p) => dot(p, eu));
  const vs = outline.map((p) => dot(p, ev));
  const u0 = Math.min(...us), v0 = Math.min(...vs);
  const O = [eu[0] * u0 + ev[0] * v0, eu[1] * u0 + ev[1] * v0];
  return { O, eu, ev, Lu: Math.max(...us) - u0, Lv: Math.max(...vs) - v0 };
}
const toWorld = (F, u, v) => [F.O[0] + F.eu[0] * u + F.ev[0] * v, F.O[1] + F.eu[1] * u + F.ev[1] * v];
const toLocal = (F, p) => [dot(sub(p, F.O), F.eu), dot(sub(p, F.O), F.ev)];
/** The world plane of y = k + du·u + dv·v in frame F. */
function localPlane(F, du, dv, k) {
  const a = du * F.eu[0] + dv * F.ev[0];
  const b = du * F.eu[1] + dv * F.ev[1];
  return { a, b, c: k - (a * F.O[0] + b * F.O[1]) };
}
/** Half-planes of the local box u0 ≤ u ≤ u1, v0 ≤ v ≤ v1. */
function boxHalfPlanes(F, u0, u1, v0, v1) {
  const oe = dot(F.O, F.eu), ov = dot(F.O, F.ev);
  return [
    { a: -F.eu[0], b: -F.eu[1], c: oe + u0 }, // u ≥ u0
    { a: F.eu[0], b: F.eu[1], c: -oe - u1 }, // u ≤ u1
    { a: -F.ev[0], b: -F.ev[1], c: ov + v0 },
    { a: F.ev[0], b: F.ev[1], c: -ov - v1 },
  ];
}
const boxPolygon = (F, u0, u1, v0, v1) => [toWorld(F, u0, v0), toWorld(F, u1, v0), toWorld(F, u1, v1), toWorld(F, u0, v1)];

/** Is a 4-point polygon a rectangle (within tol)? */
export function isRectangle(P, tol = 0.02) {
  if (!Array.isArray(P) || P.length !== 4 || !P.every(isPt)) return false;
  for (let i = 0; i < 4; i++) {
    const a = P[i], b = P[(i + 1) % 4], c = P[(i + 2) % 4];
    const d1 = sub(b, a), d2 = sub(c, b);
    if (len(d1) < 0.05 || len(d2) < 0.05) return false;
    if (Math.abs(dot(norm(d1), norm(d2))) > tol) return false;
  }
  return Math.abs(len(sub(P[1], P[0])) - len(sub(P[3], P[2]))) < 0.05 && Math.abs(len(sub(P[2], P[1])) - len(sub(P[0], P[3]))) < 0.05;
}

// ---------------------------------------------------------------------------------------------------------------

/**
 * The roofs of a house with every default filled in.
 * @param {object[]} raw  spec.roofs (house format, notes/tak.md)
 * @param {{ levels: Array<{ id, floorY, ceilingDefault? }>, walls: Array<{ levelId, exterior, thickness, from: [x,z],
 *          to: [x,z], height?, backOf? }> }} ctx  the levels and the walls (the room on the right of from → to)
 * @returns {{ parts: object[], issues: Array<{ level: 'error'|'warn', where: string, msg: string }> }}
 */
export function resolveRoofs(raw, { levels = [], walls = [] } = {}) {
  const issues = [];
  const parts = [];
  if (raw == null) return { parts, issues };
  if (!Array.isArray(raw)) {
    issues.push({ level: 'error', where: 'roofs', msg: 'må være en liste' });
    return { parts, issues };
  }
  const top = [...levels].sort((a, b) => b.floorY - a.floorY)[0];
  raw.forEach((r, i) => {
    const where = `roofs/${r?.id ?? i}`;
    const err = (msg) => issues.push({ level: 'error', where, msg });
    const warn = (msg) => issues.push({ level: 'warn', where, msg });
    if (!r || typeof r !== 'object') return err('må være et objekt');
    const type = r.type ?? 'gable';
    if (!ROOF_TYPES.includes(type)) return err(`type «${type}» er ikke en av ${ROOF_TYPES.join(', ')}`);
    const levelId = r.levelId ?? top?.id;
    const level = levels.find((l) => l.id === levelId);
    if (!level) return err(`nivået «${levelId}» finnes ikke`);
    const floorY = level.floorY ?? 0;
    // the exterior walls of the level: the default outline and the eave height
    const own = walls.filter((w) => w.levelId === levelId && !w.backOf && (w.thickness ?? 0) > 0 && isPt(w.from) && isPt(w.to));
    const ext = own.filter((w) => w.exterior);
    const outerPts = (ext.length ? ext : own).flatMap((w) => {
      const d = norm(sub(w.to, w.from));
      const n = perp(d); // into the room
      const t = w.thickness ?? 0.1;
      return [add(w.from, n, -t), add(w.to, n, -t)];
    });
    let outline = r.outline;
    if (outline != null && !isRectangle(outline)) {
      err('outline må være et rektangel med 4 hjørner [[x, z], …]');
      return;
    }
    if (outline == null) {
      if (!outerPts.length) return err(`nivået «${levelId}» har ingen vegger å legge taket på (gi outline)`);
      const xs = outerPts.map((p) => p[0]), zs = outerPts.map((p) => p[1]);
      const x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs);
      outline = [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
    }
    const pitch = r.pitch ?? ROOF_DEFAULTS.pitch[type];
    const maxPitch = type === 'mansard' ? 80 : 70;
    if (!num(pitch) || pitch < 0 || pitch > maxPitch) return err(`pitch må være 0–${maxPitch} grader`);
    if (type !== 'flat' && pitch < 2) warn(`${pitch}° er veldig slakt for ${type}`);
    const hipped = type === 'hip' || type === 'half-hip';
    const pitchEnds = hipped ? r.pitchEnds ?? pitch : null;
    if (pitchEnds != null && (!num(pitchEnds) || pitchEnds < 5 || pitchEnds > 70)) return err('pitchEnds må være 5–70 grader');
    for (const k of ['ridge', 'fall']) if (r[k] != null && !(isPt(r[k]) && len(r[k]) > 1e-6)) return err(`${k} må være en retning [dx, dz]`);
    // a gable with two different sides (ulike takfall / takfot) and a V roof: the front side (v0) and the back (v1)
    const backKeys = ['pitchBack', 'eaveHeightBack', 'kneeHeightBack', 'overhangBack'].filter((k) => r[k] != null);
    const twoSided = type === 'butterfly' || (type === 'gable' && backKeys.length > 0);
    if (backKeys.length && !twoSided) warn(`${backKeys.join(', ')} brukes bare på saltak og V-tak, ikke på ${type}`);
    for (const k of backKeys) if (!num(r[k])) return err(`${k} må være et tall`);
    const pitchBack = twoSided ? r.pitchBack ?? pitch : pitch;
    if (twoSided && (pitchBack < 2 || pitchBack > 70)) return err('pitchBack må være 2–70 grader');
    // mansard: a steep lower slope (pitch) and a shallow upper one (pitchUpper) above the break
    const pitchUpper = type === 'mansard' ? r.pitchUpper ?? ROOF_DEFAULTS.pitchUpper : null;
    if (type === 'mansard' && (!num(pitchUpper) || pitchUpper < 5 || pitchUpper > pitch - 5)) return err(`pitchUpper må være 5–${pitch - 5} grader (slakere enn pitch, den bratte nedre delen)`);
    if (type !== 'mansard') for (const k of ['pitchUpper', 'breakDepth', 'breakHeight', 'hipped']) if (r[k] != null) warn(`${k} brukes bare på mansardtak`);
    const parapet = r.parapet != null && r.parapet !== false;
    if (parapet && type !== 'flat' && type !== 'mono-pitch') return err(`parapet (attika) brukes bare på flatt tak og pulttak, ikke på ${type}`);
    const mono = type === 'mono-pitch' || (type === 'flat' && pitch > 0);
    const F = rectFrame(outline, { along: r.ridge ?? null, fall: r.fall ?? null, mono, sided: twoSided });
    const thickness = r.thickness ?? ROOF_DEFAULTS.thickness;
    if (!num(thickness) || thickness < 0.05 || thickness > 1) return err('thickness må være 0,05–1 m');
    const t = Math.tan(pitch * DEG);
    const tb = Math.tan(pitchBack * DEG);
    const tu = pitchUpper != null ? Math.tan(pitchUpper * DEG) : null;
    const te = pitchEnds != null ? Math.tan(pitchEnds * DEG) : t;
    // (square to the main slope; a mansard's upper slope, the shallower side of a two-sided roof)
    const tv = thickness / Math.cos((type === 'mansard' ? pitchUpper : twoSided ? Math.min(pitch, pitchBack) : pitch) * DEG);
    const tws = ext.map((w) => w.thickness).filter(num).sort((a, b) => a - b);
    const wallThickness = r.wallThickness ?? (tws.length ? tws[Math.floor(tws.length / 2)] : ROOF_DEFAULTS.wallThickness);
    const half = type === 'gable' || hipped || type === 'mansard' ? F.Lv / 2 : F.Lv;
    // the inner plane's height at the outline (the outer face of the eave walls), world y; a two-sided roof's back E1
    let E;
    let E1 = null;
    const anchors = ['ridgeHeight', 'kneeHeight', 'eaveHeight'].filter((k) => r[k] != null);
    if (anchors.length > 1) warn(`både ${anchors.join(' og ')} er gitt – ${anchors[0]} gjelder`);
    for (const k of anchors) if (!num(r[k])) return err(`${k} må være et tall`);
    // (a V roof's planes fall inward: its knee is higher than its eave)
    const kneeSign = type === 'butterfly' ? 1 : -1;
    const backAnchors = ['eaveHeightBack', 'kneeHeightBack'].filter((k) => r[k] != null);
    if (backAnchors.length > 1) warn(`både ${backAnchors.join(' og ')} er gitt – ${backAnchors[0]} gjelder`);
    if (twoSided && backAnchors.length) E1 = r.eaveHeightBack != null ? floorY + r.eaveHeightBack : floorY + r.kneeHeightBack + kneeSign * tb * wallThickness;
    if (type === 'mansard') {
      for (const k of ['breakDepth', 'breakHeight']) if (r[k] != null && !num(r[k])) return err(`${k} må være et tall (m)`);
      if (r.breakDepth != null && r.breakHeight != null) warn('både breakDepth og breakHeight er gitt – breakDepth gjelder');
    }
    let breakDepth = null;
    const breakDefault = Math.round((F.Lv / 6) * 100) / 100;
    if (r.ridgeHeight != null) {
      const top = floorY + r.ridgeHeight - tv; // the inner surface at the top
      if (type === 'butterfly') E = top;
      else if (twoSided) {
        // the back side reaches the ridge from E1 (given) or both eaves are as high
        if (E1 != null) E = top - t * (F.Lv - (top - E1) / tb);
        else E = E1 = top - (t * tb * F.Lv) / (t + tb);
      } else if (type === 'mansard') {
        if (r.breakDepth == null && r.breakHeight != null) {
          const kIn = floorY + r.breakHeight - tv;
          breakDepth = F.Lv / 2 - (top - kIn) / tu;
          E = kIn - t * breakDepth;
        } else {
          breakDepth = r.breakDepth ?? breakDefault;
          E = top - t * breakDepth - tu * (F.Lv / 2 - breakDepth);
        }
      } else E = floorY + r.ridgeHeight - tv - (type === 'flat' && !mono ? 0 : t * half);
    } else if (r.kneeHeight != null) E = floorY + r.kneeHeight + kneeSign * t * wallThickness;
    else if (r.eaveHeight != null) E = floorY + r.eaveHeight;
    else {
      const hs = ext.map((w) => w.height).filter(num);
      E = floorY + (hs.length ? Math.max(...hs) : level.ceilingDefault ?? 2.4);
    }
    if (twoSided && E1 == null) E1 = E;
    if (type === 'mansard') {
      if (breakDepth == null) breakDepth = r.breakDepth ?? (r.breakHeight != null ? (floorY + r.breakHeight - tv - E) / t : breakDefault);
      if (!(breakDepth >= 0.2 && breakDepth <= F.Lv / 2 - 0.3)) return err(`knekken havner ${breakDepth.toFixed(2)} m inn fra veggen – breakDepth må være 0,2–${(F.Lv / 2 - 0.3).toFixed(2)} m (sjekk breakHeight og høydene)`);
    }
    // where the two sides meet: a gable's ridge, a V roof's valley (from the front side's outline)
    let split = null;
    if (twoSided) {
      split = type === 'butterfly' ? (E - E1 + tb * F.Lv) / (t + tb) : (E1 - E + tb * F.Lv) / (t + tb);
      const what = type === 'butterfly' ? 'dalen' : 'mønet';
      if (!(split > 0.2 && split < F.Lv - 0.2)) return err(`${what} havner ${split.toFixed(2)} m fra forsiden, utenfor huset (${F.Lv.toFixed(2)} m bredt) – sjekk høydene og vinklene`);
      if (type === 'butterfly' && E - t * split < floorY + 1.5) return err(`dalen i V-taket er bare ${(E - t * split - floorY).toFixed(2)} m over gulvet`);
    }
    // half-hip (halvvalm): the top of each gable is hipped – the hip planes start `hipHeight` under the ridge at the
    // outline (the gable walls' outer faces), so the gable under them stays a wall
    let hipHeight = null;
    if (type === 'half-hip') {
      const rise = (t * F.Lv) / 2;
      if (r.hipHeight != null && r.hipDepth != null) warn('både hipHeight og hipDepth er gitt – hipHeight gjelder');
      for (const k of ['hipHeight', 'hipDepth']) if (r[k] != null && !num(r[k])) return err(`${k} må være et tall (m)`);
      hipHeight = r.hipHeight ?? (r.hipDepth != null ? r.hipDepth * te : Math.round((rise / 3) * 100) / 100);
      if (hipHeight < 0.1 || hipHeight > rise - 0.1) return err(`hipHeight må være 0,1–${(rise - 0.1).toFixed(2)} m (fra mønet ned til der valmen møter gavlveggen; lenger ned er det et valmtak)`);
      if ((2 * hipHeight) / te > F.Lu - 0.2) return err(`valmene (${(hipHeight / te).toFixed(2)} m inn fra hver gavl) møtes – gjør hipHeight mindre eller pitchEnds brattere`);
    }
    // planes (inner surface)
    const planes = [];
    const P = (du, dv, k, side, tier) => planes.push({ ...localPlane(F, du, dv, k), tv, side, role: 'roof', ...(tier ? { tier } : {}) });
    const mansardHip = type === 'mansard' && r.hipped === true;
    if (type === 'butterfly') {
      // both halves fall to the valley
      P(0, -t, E, 'v0');
      P(0, tb, E1 - tb * F.Lv, 'v1');
    } else if (twoSided) {
      P(0, t, E, 'v0');
      P(0, -tb, E1 + tb * F.Lv, 'v1');
    } else if (type === 'mansard') {
      // the lower slope from the eave to the break, the upper one from the break to the ridge (on the ends too when hipped)
      const kb = E + (t - tu) * breakDepth;
      P(0, t, E, 'v0', 'lower');
      P(0, tu, kb, 'v0', 'upper');
      P(0, -tu, kb + tu * F.Lv, 'v1', 'upper');
      P(0, -t, E + t * F.Lv, 'v1', 'lower');
      if (mansardHip) {
        if (F.Lu < 2 * breakDepth + 0.6) return err('huset er for kort for et valmet mansardtak');
        P(t, 0, E, 'u0', 'lower');
        P(tu, 0, kb, 'u0', 'upper');
        P(-tu, 0, kb + tu * F.Lu, 'u1', 'upper');
        P(-t, 0, E + t * F.Lu, 'u1', 'lower');
      }
    } else if (type === 'gable' || hipped) {
      P(0, t, E, 'v0');
      P(0, -t, E + t * F.Lv, 'v1');
      if (hipped) {
        // a hip's ends start at the eave, a half-hip's `hipHeight` under the ridge
        const Eh = type === 'hip' ? E : E + (t * F.Lv) / 2 - hipHeight;
        P(te, 0, Eh, 'u0');
        P(-te, 0, Eh + te * F.Lu, 'u1');
      }
    } else P(0, t, E, 'v0');
    const combine = type === 'butterfly' ? 'max' : 'min';
    // the overhang box (local); a parapet stands on the walls, so the roof ends at the outline
    if (parapet && ((r.overhang ?? 0) !== 0 || (r.vergeOverhang ?? 0) !== 0)) warn('parapet: overhang og vergeOverhang brukes ikke (taket slutter innenfor parapeten)');
    const ov = parapet ? 0 : r.overhang ?? (type === 'flat' ? ROOF_DEFAULTS.flatOverhang : ROOF_DEFAULTS.overhang);
    const og = parapet ? 0 : r.vergeOverhang ?? (type === 'hip' || type === 'flat' || mansardHip ? ov : ROOF_DEFAULTS.vergeOverhang);
    const ob = twoSided ? r.overhangBack ?? ov : ov;
    if (!num(ov) || ov < 0 || ov > 3 || !num(og) || og < 0 || og > 3 || ob < 0 || ob > 3) return err('overhang, overhangBack og vergeOverhang må være 0–3 m');
    const box = { u0: -og, u1: F.Lu + og, v0: -ov, v1: F.Lv + (mono ? og : ob) };
    const boxHps = boxHalfPlanes(F, box.u0, box.u1, box.v0, box.v1);
    const over = boxPolygon(F, box.u0, box.u1, box.v0, box.v1);
    const covering = r.covering ?? ROOF_DEFAULTS.covering[type];
    if (!COVERINGS.includes(covering)) return err(`covering «${covering}» er ikke en av ${COVERINGS.join(', ')}`);
    const part = {
      id: r.id ?? `roof-${i + 1}`,
      name: r.name ?? '',
      index: i,
      levelId,
      floorY,
      type,
      pitch,
      pitchEnds,
      /** half-hip: how far under the ridge the hips meet the gable walls' outer faces, how far in from them the ridge ends */
      hipHeight,
      hipDepth: hipHeight != null ? hipHeight / te : null,
      covering,
      color: r.color ?? ROOF_DEFAULTS.color[covering],
      trimColor: r.trimColor ?? ROOF_DEFAULTS.trimColor,
      soffitColor: r.soffitColor ?? r.trimColor ?? ROOF_DEFAULTS.trimColor,
      thickness,
      tv,
      overhang: ov,
      vergeOverhang: og,
      /** a two-sided roof: the back's pitch, eave (world y, as eaveY) and overhang; where the sides meet (from v0) */
      pitchBack: twoSided ? pitchBack : null,
      eaveYBack: twoSided ? E1 : null,
      overhangBack: twoSided ? ob : null,
      split,
      /** mansard: the upper slope's pitch, the break's distance in from the outline, hipped ends */
      pitchUpper,
      breakDepth,
      hippedEnds: mansardHip,
      /** 'min': a convex roof (the lowest plane counts), 'max': a V roof */
      combine,
      gutters: r.gutters ?? (pitch >= 5 && !parapet),
      ridgeCap: r.ridgeCap ?? covering !== 'felt',
      valleys: r.valleys ?? true,
      valleyColor: r.valleyColor ?? ROOF_DEFAULTS.valleyColor,
      wallThickness,
      eaveY: E,
      ridgeY: 0,
      frame: F,
      outline: outline.map((p) => [p[0], p[1]]),
      over,
      box,
      boxHps,
      planes,
      faces: [],
      dormers: [],
      terraces: [],
      parapet: null,
      source: r.source ?? '',
    };
    // ridge height: the lowest plane at the ridge (gable/hip/mansard) or the high edge (mono/flat); a two-sided roof's
    // highest point over the outline
    const mid = toWorld(F, F.Lu / 2, half);
    part.ridgeY = (twoSided ? surfaceMax(planes, combine, outline) : Math.min(...planes.map((p) => planeY(p, mid[0], mid[1])))) + tv;
    if (parapet) {
      const pr = r.parapet === true ? {} : r.parapet;
      if (!pr || typeof pr !== 'object' || Array.isArray(pr)) return err('parapet må være true eller { height, top, thickness, color, copingColor }');
      for (const k of ['height', 'top', 'thickness']) if (pr[k] != null && !num(pr[k])) return err(`parapet.${k} må være et tall (m)`);
      if (pr.height != null && pr.top != null) warn('parapet: både height og top er gitt – top gjelder');
      const topY = pr.top != null ? floorY + pr.top : part.ridgeY + (pr.height ?? ROOF_DEFAULTS.parapet.height);
      if (topY < part.ridgeY + 0.05 || topY > part.ridgeY + 2) return err(`parapeten må stå 0,05–2 m over tekkingen (toppen ${(topY - floorY).toFixed(2)}, tekkingen ${(part.ridgeY - floorY).toFixed(2)} m over gulvet)`);
      const th = pr.thickness ?? wallThickness;
      if (th < 0.08 || th > 0.8) return err('parapet.thickness må være 0,08–0,8 m');
      if (Math.min(F.Lu, F.Lv) < 2 * th + 0.5) return err('taket er for lite for parapeten');
      part.parapet = {
        topY,
        height: topY - part.ridgeY,
        thickness: th,
        color: pr.color ?? null,
        copingColor: pr.copingColor ?? part.trimColor,
        /** the inner face of the parapet (the outline inset by its thickness) */
        inner: boxPolygon(F, th, F.Lu - th, th, F.Lv - th),
      };
    }
    part.raw = r;
    part.where = where;
    parts.push(part);
  });
  // a part whose whole side stands against another part (the wing of an L, a T or a U, on its level or the one under)
  // runs on into it, up to its middle: it goes in under the other roof, and the two meet in valleys (builder: each is
  // cut where the other is higher). Through it, when its own ridge is the higher one (a cross gable). Not on a side it
  // falls toward (an eave keeps its overhang: two gables side by side meet in a valley over the shared wall), and not
  // when it stays above the other roof all the way (in line with a lower part: that one runs into it). A side that only
  // partly touches (the main house's side along the wing) keeps its overhang.
  const surfaceAt = (part, q) => {
    const ys = part.planes.map((p) => planeY(p, q[0], q[1]));
    return part.combine === 'max' ? Math.max(...ys) : Math.min(...ys);
  };
  const fallsToward = (B, side) => {
    const F = B.frame;
    const out = { u0: [-F.eu[0], -F.eu[1]], u1: F.eu, v0: [-F.ev[0], -F.ev[1]], v1: F.ev }[side];
    return [0.25, 0.5, 0.75].some((k) => {
      const q = side[0] === 'u' ? toWorld(F, side === 'u0' ? 0.01 : F.Lu - 0.01, k * F.Lv) : toWorld(F, k * F.Lu, side === 'v0' ? 0.01 : F.Lv - 0.01);
      const p = activePlane(B.planes, B.combine, q[0], q[1]);
      return p.a * out[0] + p.b * out[1] < -1e-3;
    });
  };
  for (const B of parts) {
    const F = B.frame;
    const core = { u0: 0, u1: F.Lu, v0: 0, v1: F.Lv };
    for (const A of parts) {
      if (A === B) continue;
      const us = A.outline.map((q) => toLocal(F, q)[0]), vs = A.outline.map((q) => toLocal(F, q)[1]);
      const [au0, au1, av0, av1] = [Math.min(...us), Math.max(...us), Math.min(...vs), Math.max(...vs)];
      const overlapV = Math.min(F.Lv, av1) - Math.max(0, av0), overlapU = Math.min(F.Lu, au1) - Math.max(0, au0);
      const touch = 0.05;
      /** B run on to u = at (or v = at) meets A's roof there: A is higher somewhere across B */
      const meets = (axis, at) => [0.1, 0.3, 0.5, 0.7, 0.9].some((k) => {
        const q = axis === 'u' ? toWorld(F, at, k * F.Lv) : toWorld(F, k * F.Lu, at);
        return surfaceAt(A, q) > surfaceAt(B, q) + 0.01;
      });
      const through = B.ridgeY > A.ridgeY + 0.05;
      // side → [the middle of A beyond it, A's far side, the direction outward]
      const runs = [];
      if (overlapV > F.Lv - 0.05) {
        if (au0 < -touch && au1 > -touch && au1 < F.Lu / 2) runs.push(['u0', (au0 + Math.min(au1, 0)) / 2, au0, -1]);
        if (au1 > F.Lu + touch && au0 < F.Lu + touch && au0 > F.Lu / 2) runs.push(['u1', (au1 + Math.max(au0, F.Lu)) / 2, au1, 1]);
      }
      if (overlapU > F.Lu - 0.05) {
        if (av0 < -touch && av1 > -touch && av1 < F.Lv / 2) runs.push(['v0', (av0 + Math.min(av1, 0)) / 2, av0, -1]);
        if (av1 > F.Lv + touch && av0 < F.Lv + touch && av0 > F.Lv / 2) runs.push(['v1', (av1 + Math.max(av0, F.Lv)) / 2, av1, 1]);
      }
      for (const [side, middle, far, sgn] of runs) {
        if (fallsToward(B, side) || !meets(side[0], middle)) continue;
        // (through: on to A's far side, the part's own overhang beyond it)
        const monoB = B.type === 'mono-pitch' || (B.type === 'flat' && B.pitch > 0);
        const k = side[0] === 'u' || (side === 'v1' && monoB) ? B.vergeOverhang : side === 'v1' ? B.overhangBack ?? B.overhang : B.overhang;
        const to = through ? far + sgn * k : middle;
        const reach = through ? far : middle;
        B.box[side] = sgn < 0 ? Math.min(B.box[side], to) : Math.max(B.box[side], to);
        core[side] = sgn < 0 ? Math.min(core[side], reach) : Math.max(core[side], reach);
      }
    }
    B.boxHps = boxHalfPlanes(F, B.box.u0, B.box.u1, B.box.v0, B.box.v1);
    B.over = boxPolygon(F, B.box.u0, B.box.u1, B.box.v0, B.box.v1);
    /** the part's own roof: the outline, run on into the parts it meets (the box minus its free overhangs) */
    B.core = boxPolygon(F, core.u0, core.u1, core.v0, core.v1);
    B.coreHps = boxHalfPlanes(F, core.u0, core.u1, core.v0, core.v1);
  }
  for (const part of parts) {
    // faces of the main roof (convex: plane i where it is the lowest; a V roof: where it is the highest)
    part.planes.forEach((p, k) => {
      const hps = [...part.boxHps, ...part.planes.filter((q) => q !== p).map((q) => (part.combine === 'max' ? below(q, p) : below(p, q)))];
      const poly = clipAll(part.over, hps);
      if (poly.length && Math.abs(polyArea(poly)) > 1e-6) part.faces.push({ plane: k, poly, role: 'roof' });
    });
    // dormers
    const r = part.raw;
    const where = part.where;
    delete part.raw;
    delete part.where;
    const list = (key, label) => (Array.isArray(r[key]) ? r[key] : r[key] != null ? (issues.push({ level: 'error', where, msg: `${label} må være en liste` }), []) : []);
    const dormers = list('dormers', 'dormers');
    if (dormers.length && part.combine === 'max') issues.push({ level: 'error', where, msg: 'arker på et V-tak støttes ikke' });
    else dormers.forEach((d, j) => {
      const dz = resolveDormer(part, d, j, (lvl, msg) => issues.push({ level: lvl, where: `${where}/dormers/${d?.id ?? j}`, msg }));
      if (dz) part.dormers.push(dz);
    });
    // recessed roof terraces
    const terraces = list('terraces', 'terraces');
    if (terraces.length && (part.combine === 'max' || part.type === 'flat')) issues.push({ level: 'error', where, msg: 'en innfelt takterrasse trenger et skrått tak (ikke flatt tak eller V-tak)' });
    else terraces.forEach((t, j) => {
      const tz = resolveTerrace(part, t, j, (lvl, msg) => issues.push({ level: lvl, where: `${where}/terraces/${t?.id ?? j}`, msg }));
      if (tz) part.terraces.push(tz);
    });
  }
  // two parts of one level whose planes coincide where both are the roof: the same plane twice (it flickers)
  for (let i = 0; i < parts.length; i++) {
    for (let j = i + 1; j < parts.length; j++) {
      const A = parts[i], B = parts[j];
      if (A.levelId !== B.levelId) continue;
      const both = clipAll(A.over, B.boxHps);
      if (!both.length) continue;
      for (const fa of A.faces) {
        for (const fb of B.faces) {
          const pa = A.planes[fa.plane], pb = B.planes[fb.plane];
          if (Math.abs(pa.a - pb.a) < 1e-4 && Math.abs(pa.b - pb.b) < 1e-4 && Math.abs(pa.c - pb.c) < 1e-3) {
            const ov = clipAll(fa.poly, B.boxHps);
            if (ov.length && Math.abs(polyArea(ov)) > 0.01) issues.push({ level: 'warn', where: `roofs/${B.id}`, msg: `en takflate ligger i samme plan som en flate av ${A.id} – flytt den 1 cm eller slå delene sammen` });
          }
        }
      }
    }
  }
  return { parts, issues };
}

/** A dormer of a part: its planes, its slab faces, the opening R in the main roof, the cheek and front lines. */
function resolveDormer(part, d, j, report) {
  if (!d || typeof d !== 'object') return report('error', 'må være et objekt'), null;
  const type = d.type ?? 'gable';
  if (!DORMER_TYPES.includes(type)) return report('error', `type «${type}» er ikke en av ${DORMER_TYPES.join(', ')}`), null;
  if (!(Array.isArray(d.front) && d.front.length === 2 && d.front.every(isPt))) return report('error', 'front må være to punkter [[x, z], [x, z]] (forkanten, utsiden av veggen)'), null;
  const F = part.frame;
  const C = toWorld(F, F.Lu / 2, F.Lv / 2);
  const mid = [(d.front[0][0] + d.front[1][0]) / 2, (d.front[0][1] + d.front[1][1]) / 2];
  // the main plane under it: the lowest at a point 0.3 m from the front toward the middle of the part
  const probe = add(mid, norm(sub(C, mid)), Math.min(0.3, len(sub(C, mid))));
  let m = null;
  let my = Infinity;
  for (const p of part.planes) {
    const y = planeY(p, probe[0], probe[1]);
    if (y < my) (my = y), (m = p);
  }
  const grad = [m.a, m.b];
  if (len(grad) < 1e-3) return report('error', 'en ark trenger et skrått tak under seg'), null;
  const n = norm(grad); // uphill = into the roof
  let dd = perp(n);
  if (dot(dd, sub(d.front[1], d.front[0])) < 0) dd = [-dd[0], -dd[1]];
  const D0 = d.front[0];
  const W = dot(sub(d.front[1], D0), dd);
  if (W < 0.4) return report('error', `forkanten er bare ${W.toFixed(2)} m bred`), null;
  if (Math.abs(dot(norm(sub(d.front[1], d.front[0])), n)) > 0.05) report('warn', 'forkanten står ikke parallelt med takfoten – den rettes inn');
  const DF = { O: D0, eu: dd, ev: n, Lu: W, Lv: 0 };
  // how far the front stands in from the outline (0: an ark on the wall, > 0: a takopplett on the roof)
  const rOut = Math.min(...part.outline.map((p) => dot(sub(p, D0), n)));
  const setback = -rOut;
  if (setback < -0.1) return report('error', `forkanten ligger ${(-setback).toFixed(2)} m utenfor husets vegg`), null;
  const ark = setback < 0.1;
  const floorY = part.floorY;
  const height = d.height ?? ROOF_DEFAULTS.dormer.height;
  if (!num(height) || height < 1 || height > 6) return report('error', 'height må være 1–6 m (over gulvet)'), null;
  const hf = floorY + height;
  // (a gable or hipped dormer has the roof's pitch; on a mansard's steep lower slope 40°)
  const pitch = d.pitch ?? (type === 'shed' ? ROOF_DEFAULTS.dormer.shedPitch : part.type === 'mansard' ? 40 : part.pitch);
  if (!num(pitch) || pitch < 0 || pitch > 70) return report('error', 'pitch må være 0–70 grader'), null;
  const td = Math.tan(pitch * DEG);
  const tm = len(grad);
  const planes = [];
  const P = (du, dv, k, side) => planes.push({ ...localPlane(DF, du, dv, k), tv: part.tv, side, role: 'dormer', dormer: j });
  let pitchFront = null;
  if (type === 'gable' || type === 'hip') {
    P(td, 0, hf, 's0');
    P(-td, 0, hf + td * W, 's1');
    if (type === 'hip') {
      // ark med valm: the front is hipped too, rising from the front's eave into the dormer
      pitchFront = d.pitchFront ?? pitch;
      if (!num(pitchFront) || pitchFront < 10 || pitchFront > 80) return report('error', 'pitchFront må være 10–80 grader'), null;
      P(0, Math.tan(pitchFront * DEG), hf, 'f');
    }
  } else {
    if (td >= tm - 1e-3) return report('error', `en pulttaksark må være slakere enn taket (${pitch}° mot ${(Math.atan(tm) / DEG).toFixed(0)}°)`), null;
    P(0, td, hf, 'r');
  }
  if (type !== 'hip' && d.pitchFront != null) report('warn', 'pitchFront brukes bare på arker med valm (type: \'hip\')');
  const mainFront = planeY(m, D0[0], D0[1]);
  if (hf <= mainFront + 0.3) return report('error', `arken er for lav: forkanten ${height.toFixed(2)} m, taket ${(mainFront - floorY).toFixed(2)} m der`), null;
  const ridgeD = type === 'shed' ? hf : hf + (td * W) / 2;
  if (ridgeD + part.tv > part.ridgeY - 0.05) report('error', 'arken når over mønet på taket');
  const ov = d.overhang ?? ROOF_DEFAULTS.dormer.overhang;
  const tf = ark ? 0 : d.frontThickness ?? ROOF_DEFAULTS.dormer.frontThickness;
  // depth: up to where the main plane m ends (its face's far edge)
  const face = part.faces.find((f) => part.planes[f.plane] === m);
  const rMax = Math.max(...face.poly.map((p) => dot(sub(p, D0), n)));
  const dormerAt = (x, z) => Math.min(...planes.map((p) => planeY(p, x, z)));
  // the slab: the dormer's box, where the dormer is above the main plane
  const boxHps = boxHalfPlanes(DF, -ov, W + ov, -ov, rMax);
  const box = boxPolygon(DF, -ov, W + ov, -ov, rMax);
  const faces = [];
  planes.forEach((p, k) => {
    const hps = [...boxHps, ...planes.filter((q) => q !== p).map((q) => below(p, q)), below(m, p)];
    const poly = clipAll(box, hps);
    if (poly.length && Math.abs(polyArea(poly)) > 1e-6) faces.push({ plane: k, poly, role: 'dormer' });
  });
  if (!faces.length) return report('error', 'arken når ikke over taket'), null;
  // the opening R: between the side lines, from the front (ark: from the eave) up to the valley
  const rFront = ark ? -10 : tf;
  const Rhps = [...boxHalfPlanes(DF, 0, W, rFront, rMax), ...planes.map((p) => below(m, p)), ...part.boxHps];
  const R = clipAll(boxPolygon(DF, 0, W, rFront, rMax), Rhps);
  if (!R.length) return report('error', 'arken når ikke over taket'), null;
  // still above the main plane where that plane ends (a mansard's break, the ridge): it would end in the air
  const far = toWorld(DF, W / 2, rMax);
  if (dormerAt(far[0], far[1]) > planeY(m, far[0], far[1]) + 0.01) report('error', `arken går forbi ${part.type === 'mansard' ? 'knekken' : 'mønet'} i taket – gjør den lavere, slakere eller smalere`);
  // the cheeks: solid sides `cheekThickness` thick OUTSIDE the side lines, from the front up to the valley (the
  // ceiling's step faces are their inside; on an ark they hide the steps in the top of the wall under the front)
  const cheekThickness = Math.min(0.1, Math.max(0.02, ov - 0.05));
  const cheekLine = (s, sign) => {
    const at = (r) => toWorld(DF, s + sign * cheekThickness, r);
    // the valley on the outer line: dormer(r) = main(r), both linear in r
    const fa = (p) => dormerAt(p[0], p[1]) - planeY(m, p[0], p[1]);
    const f0 = fa(at(0)), f1 = fa(at(rMax));
    if (f0 <= 0) return null;
    const rEnd = f1 >= 0 ? rMax : (rMax * f0) / (f0 - f1);
    return { s, side: toWorld(DF, s, 0), a: at(0), b: at(rEnd), out: sign < 0 ? [-dd[0], -dd[1]] : dd };
  };
  const cheeks = [cheekLine(0, -1), cheekLine(W, 1)].filter(Boolean);
  // a takopplett's windows in its front wall: `window` (one, in the middle) or `windows` (several, at `offset` from the
  // front's first point to the window's near edge, else spread evenly)
  if (d.windows != null && !Array.isArray(d.windows)) return report('error', 'windows må være en liste'), null;
  if (d.windows != null && d.window != null) report('warn', 'både window og windows er gitt – windows gjelder');
  const many = d.windows != null;
  const winsRaw = many ? d.windows : d.window != null ? [d.window] : [];
  if (winsRaw.length && ark) report('warn', `${many ? 'windows' : 'window'} på en ark brukes ikke – vinduet står i husets vegg (walls[].openings)`);
  const wins = [];
  if (!ark) {
    const ok = winsRaw.filter((w, k) => {
      if (w && num(w.width) && num(w.height) && w.width > 0.2 && w.height > 0.2 && (w.offset == null || num(w.offset))) return true;
      report('error', many ? `windows/${k}: må ha width og height (m)` : 'window må ha width og height (m)');
      return false;
    });
    const gap = (W - ok.reduce((s, w) => s + w.width, 0)) / (ok.length + 1);
    let at = gap;
    for (const w of ok) {
      wins.push({ width: w.width, height: w.height, sill: w.sill ?? null, offset: w.offset ?? at, frame: w.frame ?? null, sashes: w.sashes ?? null, panes: w.panes ?? null, bars: w.bars ?? null });
      at += w.width + gap;
    }
  }
  const frontWall = ark ? null : { a: D0, b: toWorld(DF, W, 0), thickness: tf, windows: wins, window: wins[0] ?? null };
  wins.forEach((w, k) => {
    const name = many ? `vindu ${k + 1}` : 'vinduet';
    const bottom = planeY(m, ...toWorld(DF, w.offset + w.width / 2, tf)) - floorY;
    const topY = Math.min(dormerAt(...toWorld(DF, w.offset, tf)), dormerAt(...toWorld(DF, w.offset + w.width, tf))) - floorY;
    if (w.sill == null) w.sill = Math.max(bottom + 0.1, topY - 0.15 - w.height);
    if (w.width > W - 0.1) report('error', `${name} (${w.width} m) er bredere enn arken (${W.toFixed(2)} m)`);
    else if (w.offset < 0.05 || w.offset + w.width > W - 0.05) report('error', `${name} går utenfor forveggen (offset ${w.offset.toFixed(2)}, bredde ${w.width}, forveggen ${W.toFixed(2)} m)`);
    if (w.sill < bottom + 0.02 || w.sill + w.height > topY - 0.05) report('error', `${name} får ikke plass i forveggen (${bottom.toFixed(2)}–${topY.toFixed(2)} m over gulvet)`);
    const prev = wins[k - 1];
    if (prev && w.offset < prev.offset + prev.width + 0.08) report('error', `${name} overlapper vinduet før (minst 8 cm mellom)`);
  });
  return {
    id: d.id ?? `${part.id}-ark-${j + 1}`,
    index: j,
    type,
    ark,
    setback: Math.max(0, setback),
    pitch,
    height,
    overhang: ov,
    frame: DF,
    width: W,
    main: m,
    planes,
    faces,
    R,
    cheeks,
    cheekThickness,
    frontWall,
    pitchFront,
    color: d.color ?? null,
  };
}

/**
 * A recessed roof terrace (innfelt takterrasse) in one slope of a part: `front` is where the outer faces of its side
 * walls meet the eave line (on the outline), `depth` how far in from the outline the outer face of its back wall
 * stands. The roof has a hole over it (its edge `edge` out over the walls), the eave is cut between its sides; the
 * walls round it are the level's own (walls[]), the floor a deck (decks[], kind 'roof-terrace').
 */
function resolveTerrace(part, t, j, report) {
  if (!t || typeof t !== 'object') return report('error', 'må være et objekt'), null;
  if (!(Array.isArray(t.front) && t.front.length === 2 && t.front.every(isPt))) return report('error', 'front må være to punkter [[x, z], [x, z]] (der sideveggene møter takfoten, yttersiden)'), null;
  const F = part.frame;
  const C = toWorld(F, F.Lu / 2, F.Lv / 2);
  const mid = [(t.front[0][0] + t.front[1][0]) / 2, (t.front[0][1] + t.front[1][1]) / 2];
  const probe = add(mid, norm(sub(C, mid)), Math.min(0.3, len(sub(C, mid))));
  const m = activePlane(part.planes, 'min', probe[0], probe[1]);
  const grad = [m.a, m.b];
  if (len(grad) < 1e-3) return report('error', 'en innfelt takterrasse trenger et skrått tak'), null;
  const n = norm(grad); // uphill = into the house
  let dd = perp(n);
  if (dot(dd, sub(t.front[1], t.front[0])) < 0) dd = [-dd[0], -dd[1]];
  const D0 = t.front[0];
  const W = dot(sub(t.front[1], D0), dd);
  if (W < 0.8) return report('error', `terrassen er bare ${W.toFixed(2)} m bred`), null;
  if (Math.abs(dot(norm(sub(t.front[1], t.front[0])), n)) > 0.05) report('warn', 'forkanten står ikke parallelt med takfoten – den rettes inn');
  const setback = -Math.min(...part.outline.map((p) => dot(sub(p, D0), n)));
  if (Math.abs(setback) > 0.1) return report('error', `front må ligge på takfoten (yttersiden av veggen under raftet), den ligger ${setback.toFixed(2)} m ${setback > 0 ? 'inne på taket' : 'utenfor'}`), null;
  const depth = t.depth;
  if (!num(depth) || depth < 0.6) return report('error', 'depth må være minst 0,6 m (fra yttersiden av veggen under raftet inn til yttersiden av bakveggen)'), null;
  const edge = t.edge ?? ROOF_DEFAULTS.terraceEdge;
  if (!num(edge) || edge < 0 || edge > 0.3) return report('error', 'edge må være 0–0,3 m'), null;
  const face = part.faces.find((f) => part.planes[f.plane] === m);
  const rMax = Math.max(...face.poly.map((p) => dot(sub(p, D0), n)));
  if (depth > rMax - 0.3) return report('error', `bakveggen står ${depth.toFixed(2)} m inn, for nær ${part.type === 'mansard' ? 'knekken' : 'mønet'} (${rMax.toFixed(2)} m inn)`), null;
  const TF = { O: D0, eu: dd, ev: n, Lu: W, Lv: depth };
  // the hole: between the sides, from beyond the eave up to the back wall, `edge` in from the walls' outer faces
  const hole = clipAll(boxPolygon(TF, edge, W - edge, -10, depth - edge), part.boxHps);
  if (!hole.length) return report('error', 'terrassen ligger utenfor taket'), null;
  const back = planeY(m, ...toWorld(TF, W / 2, depth)) - part.floorY;
  if (back < 2.0) report('warn', `bakveggen er bare ${back.toFixed(2)} m høy under taket – for lav for en dør`);
  for (const d of part.dormers) {
    const both = clipAll(hole, insideHalfPlanes(d.R));
    if (both.length && Math.abs(polyArea(both)) > 1e-4) report('error', `terrassen overlapper arken ${d.id}`);
  }
  return { id: t.id ?? `${part.id}-terrasse-${j + 1}`, index: j, front: [D0, toWorld(TF, W, 0)], width: W, depth, edge, frame: TF, main: m, hole };
}

// ---------------------------------------------------------------------------------------------------------------
// One level's roof as a height field

/**
 * @param {object[]} parts  resolveRoofs(…).parts of one level
 * @param {{ above?: object[] }} [opts]  parts on the levels above: inside their cores this level has no roof (the
 *   floor above covers it) – roofFields() fills it in
 * @returns {{ parts, innerAt(x, z): number|null, planeAt(x, z): object|null, lines: object[], steps: object[] }}
 *   innerAt: world y of the inner surface (the sloped ceiling's plane), null where no roof is over the point (and in a
 *   recessed roof terrace);
 *   lines: every line along which the active plane may change (fold lines, the edges of parts and openings);
 *   steps: [{ a, b, kind: 'cheek' | 'front' }] segments where the inner surface jumps (vertical faces): 'cheek' is a
 *   side of a dormer (the ceiling builds it), 'front' the inside of a takopplett's front wall (the roof builder does).
 */
export function roofField(parts, { above = [] } = {}) {
  const inside = (hps, x, z) => hps.every((hp) => hp.a * x + hp.b * z + hp.c <= 1e-9);
  const partPlane = (part, x, z) => {
    if (!inside(part.boxHps, x, z)) return null;
    for (const t of part.terraces) if (inConvex(x, z, t.hole)) return null;
    for (const d of part.dormers) if (inConvex(x, z, d.R)) return activePlane(d.planes, 'min', x, z);
    return activePlane(part.planes, part.combine, x, z);
  };
  const several = parts.length > 1;
  // the highest part counts – inside a part's core only the parts whose core it is too (an overhang does not count
  // over another part's own roof: the wing's ceiling under the main house's eave is the wing's)
  const planeAt = (x, z) => {
    for (const q of above) if (inside(q.coreHps, x, z)) return null;
    let best = null, by = -Infinity, core = false;
    for (const part of parts) {
      const p = partPlane(part, x, z);
      if (!p) continue;
      const c = several && inside(part.coreHps, x, z);
      if (c && !core) (core = true), (best = null), (by = -Infinity);
      else if (core && !c) continue;
      const y = planeY(p, x, z);
      if (y > by) (by = y), (best = p);
    }
    return best;
  };
  const innerAt = (x, z) => {
    const p = planeAt(x, z);
    return p ? planeY(p, x, z) : null;
  };
  const edgesOf = (P) => P.map((a, i) => [a, P[(i + 1) % P.length]]);
  const same = (e, f) => (len(sub(e[0], f[0])) < 1e-9 && len(sub(e[1], f[1])) < 1e-9) || (len(sub(e[0], f[1])) < 1e-9 && len(sub(e[1], f[0])) < 1e-9);
  const lines = [];
  const all = [];
  for (const part of parts) {
    for (let i = 0; i < 4; i++) lines.push(lineThrough(part.over[i], part.over[(i + 1) % 4]));
    if (several) for (const [a, b] of edgesOf(part.core)) lines.push(lineThrough(a, b));
    const ps = [...part.planes, ...part.dormers.flatMap((d) => d.planes)];
    all.push(...ps);
    for (const d of part.dormers) for (let i = 0; i < d.R.length; i++) lines.push(lineThrough(d.R[i], d.R[(i + 1) % d.R.length]));
    for (const t of part.terraces) for (const [a, b] of edgesOf(t.hole)) lines.push(lineThrough(a, b));
  }
  for (const q of above) for (const [a, b] of edgesOf(q.core)) lines.push(lineThrough(a, b));
  for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
    const l = planeLine(all[i], all[j]);
    if (l) lines.push(l);
  }
  const steps = [];
  for (const part of parts) {
    // the edges of a part (its box, its core) where another part goes on lower (a wing under the eave of the house):
    // the surface jumps
    if (several) {
      const box = edgesOf(part.over);
      for (const [a, b] of box) steps.push({ a, b, kind: 'cheek', partId: part.id });
      for (const e of edgesOf(part.core)) if (!box.some((f) => same(e, f))) steps.push({ a: e[0], b: e[1], kind: 'cheek', partId: part.id });
    }
    for (const d of part.dormers) {
      const F = d.frame;
      // the side lines of R (s = 0, s = W) and a takopplett's front (r = tf): the inner surface jumps there
      for (let i = 0; i < d.R.length; i++) {
        const a = d.R[i], b = d.R[(i + 1) % d.R.length];
        const la = toLocal(F, a), lb = toLocal(F, b);
        const onSide = (Math.abs(la[0]) < 1e-6 && Math.abs(lb[0]) < 1e-6) || (Math.abs(la[0] - d.width) < 1e-6 && Math.abs(lb[0] - d.width) < 1e-6);
        const onFront = !d.ark && Math.abs(la[1] - d.frontWall.thickness) < 1e-6 && Math.abs(lb[1] - d.frontWall.thickness) < 1e-6;
        if (onSide || onFront) steps.push({ a, b, kind: onSide ? 'cheek' : 'front', dormer: d.id, partId: part.id });
      }
    }
  }
  return { parts, planeAt, innerAt, lines: dedupeLines(lines), steps };
}

/**
 * Every level's roof field: { [levelId]: roofField(the level's parts, { above: the parts of higher levels over them }) }.
 * @param {object[]} parts  resolveRoofs(…).parts
 */
export function roofFields(parts) {
  const out = {};
  for (const id of [...new Set(parts.map((p) => p.levelId))]) {
    const list = parts.filter((p) => p.levelId === id);
    const fy = list[0].floorY;
    const above = parts.filter((q) => q.floorY > fy + 0.5 && list.some((p) => clipAll(p.over, q.coreHps).length));
    out[id] = roofField(list, { above });
  }
  return out;
}
/** The top of the lowest ('min') or highest ('max') of some planes along a → b: [[u, y], …] (world y, u from a). */
export function planesProfile(planes, combine, a, b) {
  const lines = [];
  for (let i = 0; i < planes.length; i++) for (let j = i + 1; j < planes.length; j++) {
    const l = planeLine(planes[i], planes[j]);
    if (l) lines.push(l);
  }
  return surfaceProfile(a, b, [{ planeAt: (x, z) => activePlane(planes, combine, x, z), lines }], 0, 0);
}

/** A point inside (or on) a convex polygon of either orientation. */
export function inConvex(x, z, P) {
  let sign = 0;
  for (let i = 0; i < P.length; i++) {
    const a = P[i], b = P[(i + 1) % P.length];
    const c = (b[0] - a[0]) * (z - a[1]) - (b[1] - a[1]) * (x - a[0]);
    if (Math.abs(c) < 1e-9) continue;
    const s = Math.sign(c);
    if (sign && s !== sign) return false;
    sign = s;
  }
  return true;
}
function dedupeLines(lines) {
  const out = [];
  for (const l of lines) {
    if (!out.some((o) => (Math.abs(o.a - l.a) < 1e-7 && Math.abs(o.b - l.b) < 1e-7 && Math.abs(o.c - l.c) < 1e-7) || (Math.abs(o.a + l.a) < 1e-7 && Math.abs(o.b + l.b) < 1e-7 && Math.abs(o.c + l.c) < 1e-7))) out.push(l);
  }
  return out;
}

/**
 * The surface of a ceiling under a roof: flat at flatY (world; Infinity: none) where the roof is higher, else the roof.
 * @returns {{ heightAt(x, z) (world y), planeAt(x, z) → { a, b, c } (world), lines, steps }}
 */
export function ceilingSurface(field, flatY) {
  const flat = { a: 0, b: 0, c: flatY };
  const planeAt = (x, z) => {
    const p = field.planeAt(x, z);
    if (!p) return Number.isFinite(flatY) ? flat : null;
    return planeY(p, x, z) < flatY ? p : flat;
  };
  const lines = [...field.lines];
  if (Number.isFinite(flatY)) {
    for (const part of field.parts) {
      for (const p of [...part.planes, ...part.dormers.flatMap((d) => d.planes)]) {
        const l = planeLine(p, flat);
        if (l) lines.push(l);
      }
    }
  }
  return {
    planeAt,
    heightAt: (x, z) => {
      const p = planeAt(x, z);
      return p ? planeY(p, x, z) : flatY;
    },
    lines: dedupeLines(lines),
    steps: field.steps.filter((s) => s.kind === 'cheek'),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Triangles

/**
 * Cuts 2D triangles ([[x, z] × 3]) along every line: afterwards no line crosses a triangle's inside, so a piecewise
 * planar surface whose folds lie on the lines is one plane per triangle.
 */
export function splitTriangles(tris, lines) {
  let cur = tris;
  for (const l of lines) {
    const next = [];
    for (const t of cur) {
      const f = t.map((p) => l.a * p[0] + l.b * p[1] + l.c);
      const pos = f.filter((v) => v > 1e-7).length, neg = f.filter((v) => v < -1e-7).length;
      if (!pos || !neg) {
        next.push(t);
        continue;
      }
      const cut = (i, j) => {
        const s = f[i] / (f[i] - f[j]);
        return [t[i][0] + (t[j][0] - t[i][0]) * s, t[i][1] + (t[j][1] - t[i][1]) * s];
      };
      const zero = f.findIndex((v) => Math.abs(v) <= 1e-7);
      if (zero >= 0) {
        // one vertex on the line: two triangles
        const i = (zero + 1) % 3, j = (zero + 2) % 3;
        const m = cut(i, j);
        next.push([t[zero], t[i], m], [t[zero], m, t[j]]);
        continue;
      }
      // the vertex alone on its side
      const sgn = f.map(Math.sign);
      const k = sgn[0] === sgn[1] ? 2 : sgn[0] === sgn[2] ? 1 : 0;
      const i = (k + 1) % 3, j = (k + 2) % 3;
      const mi = cut(k, i), mj = cut(k, j);
      next.push([t[k], mi, mj], [mi, t[i], t[j]], [mi, t[j], mj]);
    }
    cur = next;
  }
  return cur.filter((t) => Math.abs((t[1][0] - t[0][0]) * (t[2][1] - t[0][1]) - (t[2][0] - t[0][0]) * (t[1][1] - t[0][1])) > 1e-12);
}

/** 2D triangles → 3D ([[x, y, z] × 3]) on the plane active at each triangle's centroid (null plane: dropped). */
export function liftTriangles(tris, planeAt) {
  const out = [];
  for (const t of tris) {
    const cx = (t[0][0] + t[1][0] + t[2][0]) / 3, cz = (t[0][1] + t[1][1] + t[2][1]) / 3;
    const p = planeAt(cx, cz);
    if (!p) continue;
    out.push(t.map(([x, z]) => [x, planeY(p, x, z), z]));
  }
  return out;
}

/** Area-weighted integral of the height above y0 over 2D triangles (exact for one plane per triangle). */
export function volumeUnder(tris, planeAt, y0) {
  let v = 0;
  for (const t of tris) {
    const cx = (t[0][0] + t[1][0] + t[2][0]) / 3, cz = (t[0][1] + t[1][1] + t[2][1]) / 3;
    const p = planeAt(cx, cz);
    if (!p) continue;
    const a = Math.abs((t[1][0] - t[0][0]) * (t[2][1] - t[0][1]) - (t[2][0] - t[0][0]) * (t[1][1] - t[0][1])) / 2;
    v += a * (planeY(p, cx, cz) - y0);
  }
  return v;
}

/** The parts of segment a–b inside polygon P (sorted, as parameter ranges [t0, t1] of a → b). */
function segmentInside(a, b, P) {
  const ts = [0, 1];
  const d = sub(b, a);
  for (let i = 0; i < P.length; i++) {
    const p = P[i], q = P[(i + 1) % P.length];
    const e = sub(q, p);
    const den = d[0] * e[1] - d[1] * e[0];
    if (Math.abs(den) < 1e-12) continue;
    const w = sub(p, a);
    const t = (w[0] * e[1] - w[1] * e[0]) / den;
    const s = (w[0] * d[1] - w[1] * d[0]) / den;
    if (t > 0 && t < 1 && s >= -1e-9 && s <= 1 + 1e-9) ts.push(t);
  }
  ts.sort((x, y) => x - y);
  const out = [];
  for (let i = 0; i < ts.length - 1; i++) {
    const t0 = ts[i], t1 = ts[i + 1];
    if (t1 - t0 < 1e-6) continue;
    const m = add(a, d, (t0 + t1) / 2);
    if (inPolygon(m[0], m[1], P, 1e-9)) {
      const last = out[out.length - 1];
      if (last && Math.abs(last[1] - t0) < 1e-9) last[1] = t1;
      else out.push([t0, t1]);
    }
  }
  return out;
}
/** Parameters (0…1 on a → b) where the segment crosses the lines. */
function lineCuts(a, b, lines) {
  const out = [];
  for (const l of lines) {
    const fa = l.a * a[0] + l.b * a[1] + l.c, fb = l.a * b[0] + l.b * b[1] + l.c;
    if ((fa < -1e-9 && fb > 1e-9) || (fa > 1e-9 && fb < -1e-9)) out.push(fa / (fa - fb));
  }
  return out;
}

/**
 * The vertical faces of a surface along its steps, inside a polygon: quads [[x, y, z] × 4] whose front faces the
 * higher side (into the space under the higher part).
 * @param {object[]} steps   [{ a, b }]
 * @param {Array<[number, number]>} P  the polygon (a room's ceiling)
 * @param {{ planeAt, lines }} surface
 */
export function stepFaces(steps, P, surface) {
  const quads = [];
  for (const s of steps) {
    const d = norm(sub(s.b, s.a));
    const n = perp(d);
    for (const [t0, t1] of segmentInside(s.a, s.b, P)) {
      const ts = [t0, ...lineCuts(s.a, s.b, surface.lines).filter((t) => t > t0 + 1e-6 && t < t1 - 1e-6), t1].sort((x, y) => x - y);
      for (let i = 0; i < ts.length - 1; i++) {
        const p0 = add(s.a, sub(s.b, s.a), ts[i]);
        const p1 = add(s.a, sub(s.b, s.a), ts[i + 1]);
        const m = [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2];
        const e = 2e-4;
        const pl = surface.planeAt(m[0] + n[0] * e, m[1] + n[1] * e);
        const pr = surface.planeAt(m[0] - n[0] * e, m[1] - n[1] * e);
        if (!pl || !pr) continue;
        const l0 = planeY(pl, ...p0), l1 = planeY(pl, ...p1), r0 = planeY(pr, ...p0), r1 = planeY(pr, ...p1);
        const d0 = l0 - r0, d1 = l1 - r1;
        // where the two sides cross, split; each piece faces its higher side
        const pieces = [];
        if (d0 * d1 < 0) {
          const t = d0 / (d0 - d1);
          const pm = [p0[0] + (p1[0] - p0[0]) * t, p0[1] + (p1[1] - p0[1]) * t];
          const ym = l0 + (l1 - l0) * t;
          pieces.push([p0, pm, l0, ym, r0, ym], [pm, p1, ym, l1, ym, r1]);
        } else pieces.push([p0, p1, l0, l1, r0, r1]);
        for (const [q0, q1, a0, a1, b0, b1] of pieces) {
          const high = a0 + a1 > b0 + b1 ? 'l' : 'r';
          const [h0, h1, k0, k1] = high === 'l' ? [a0, a1, b0, b1] : [b0, b1, a0, a1];
          if (h0 - k0 < 1e-5 && h1 - k1 < 1e-5) continue;
          // front toward the higher side: seen from that side, q0 → q1 runs to the left when high is +n
          const quad = [[q0[0], k0, q0[1]], [q1[0], k1, q1[1]], [q1[0], h1, q1[1]], [q0[0], h0, q0[1]]];
          // the quad's normal (counter-clockwise front) is (q1 − q0) × up; flip to face the high side
          const fn = [-(q1[1] - q0[1]), q1[0] - q0[0]]; // (dx, 0, dz) × (0, 1, 0) = (−dz, 0, dx)
          const toHigh = high === 'l' ? n : [-n[0], -n[1]];
          quads.push(dot(fn, toHigh) > 0 ? quad : [quad[1], quad[0], quad[3], quad[2]]);
        }
      }
    }
  }
  return quads;
}

/**
 * A wall's top under one or more surfaces: [[u, y − floorY], …] from u = 0 at p0 to u = |p1 − p0| at p1, the highest
 * of the samplers at every u (steps where a surface jumps).
 * @param {[number, number]} p0 @param {[number, number]} p1
 * @param {Array<{ planeAt, lines, shift?: [number, number] }>} samplers  each read at p(u) + shift
 * @param {number} floorY  world y of the wall's floor
 * @param {number} [fallback]  local height where no sampler has a plane
 */
export function surfaceProfile(p0, p1, samplers, floorY, fallback = 2.4) {
  const L = len(sub(p1, p0));
  const d = norm(sub(p1, p0));
  const us = new Set([0, L]);
  for (const s of samplers) {
    const sh = s.shift ?? [0, 0];
    const a = add(p0, sh), b = add(p1, sh);
    for (const t of lineCuts(a, b, s.lines)) us.add(t * L);
  }
  const cuts = [...us].sort((a, b) => a - b).filter((u, i, arr) => !i || u - arr[i - 1] > 1e-6);
  const out = [];
  const push = (u, y) => {
    const l = out[out.length - 1];
    if (l && Math.abs(l[0] - u) < 1e-7 && Math.abs(l[1] - y) < 1e-7) return;
    out.push([u, y]);
  };
  for (let i = 0; i < cuts.length - 1; i++) {
    const u0 = cuts[i], u1 = cuts[i + 1];
    const um = (u0 + u1) / 2;
    // the linear function of each sampler on this interval (its plane at the middle)
    const fns = [];
    for (const s of samplers) {
      const sh = s.shift ?? [0, 0];
      const pm = add(add(p0, d, um), sh);
      const p = s.planeAt(pm[0], pm[1]);
      if (!p) continue;
      const at = (u) => {
        const q = add(add(p0, d, u), sh);
        return planeY(p, q[0], q[1]) - floorY;
      };
      fns.push(at);
    }
    if (!fns.length) fns.push(() => fallback);
    // the upper envelope on [u0, u1]: split where two cross
    const ks = [u0, u1];
    for (let a = 0; a < fns.length; a++) for (let b = a + 1; b < fns.length; b++) {
      const da0 = fns[a](u0) - fns[b](u0), da1 = fns[a](u1) - fns[b](u1);
      if (da0 * da1 < 0) ks.push(u0 + ((u1 - u0) * da0) / (da0 - da1));
    }
    ks.sort((x, y) => x - y);
    for (let k = 0; k < ks.length - 1; k++) {
      const a = ks[k], b = ks[k + 1];
      if (b - a < 1e-7) continue;
      const m = (a + b) / 2;
      let best = fns[0];
      for (const f of fns) if (f(m) > best(m)) best = f;
      push(a, best(a));
      push(b, best(b));
    }
  }
  // drop the points in the middle of a straight run (the lines cut it where nothing changes; the extruded outline is
  // triangulated, and collinear points give slivers that overlap)
  const keep = [];
  for (let i = 0; i < out.length; i++) {
    const p = out[i], a = keep[keep.length - 1], b = out[i + 1];
    if (a && b && b[0] - a[0] > 1e-7 && p[0] - a[0] > 1e-7 && b[0] - p[0] > 1e-7) {
      const y = a[1] + ((b[1] - a[1]) * (p[0] - a[0])) / (b[0] - a[0]);
      if (Math.abs(y - p[1]) < 1e-6) continue;
    }
    keep.push(p);
  }
  return keep;
}
