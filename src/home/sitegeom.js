import { resolveDecks } from './deckgeom.js';

/**
 * SITE – the outside of a generated house (notes/uteomradet.md), without three.js: the terrain, the surfaces on it
 * (driveway, yard, paths, patios, lawn, beds), retaining walls, garden walls, fences, hedges and screens, garden steps,
 * and what the house's own doors and decks need outside (landing slabs, steps up to the door, slabs at a deck stair's
 * foot). layout.js (layout.house.site), the builder (home/site.js) and the validator (data/scripts/house.mjs) all read
 * the same model.
 *
 *   terrainModel(terrain, { groundY })  → { naturalAt(x, z), plane, flat }   the ground from the terrain lines
 *   resolveSite(raw, ctx)              → { site, decks, rawDecks, issues }   `site` with every default filled in
 *   sitePieces(site)                   → [{ key, surf, tri: [x, y, z × 3] }] the ground as triangles per material
 *
 * The terrain: one terrain line per facade (the ground line of the facade drawing, as plan points with a world y:
 * [[x, z, y], …] along the outer face of the walls) and spot heights. A plane fitted to them gives the slope; near a
 * line the ground is the line's own height (inverse distance to each line, so the ground passes through every line).
 * Flat surfaces (`y`) are cut into it: inside they are level, outside their open edges the ground blends back to the
 * terrain over `blend` metres; along their walled edges (`walls`) it does not – a retaining wall holds the step.
 *
 * Plan points are [x, z] (metres, the house's coordinates); every height here is world y (like decks' groundY).
 * ctx: { levels: [{ id, floorY }], mainLevelId,
 *        walls: [{ id, levelId, exterior, start, end, normal, thickness, floorY, height,
 *                  openings: [{ id, type, offset, width, door, connects }] }]  (start / end on the room face, normal
 *                  into the room – the walls of resolveDecks plus their openings),
 *        rooms: [{ id, levelId, floorY, polygon }], decks: the raw `decks[]` (or null) }
 */

export const SITE_KINDS = Object.freeze(['driveway', 'yard', 'path', 'patio', 'lawn', 'bed']);
export const SITE_SURFACES = Object.freeze(['gravel', 'asphalt', 'pavers', 'slabs', 'concrete', 'grass', 'bark']);
export const FENCE_KINDS = Object.freeze(['fence', 'screen', 'hedge']);
export const WALL_MATERIALS = Object.freeze(['concrete', 'stone', 'block']);

/** Defaults of the format (notes/uteomradet.md). */
export const SITE_DEFAULTS = Object.freeze({
  surface: Object.freeze({ driveway: 'gravel', yard: 'gravel', path: 'slabs', patio: 'pavers', lawn: 'grass', bed: 'bark' }),
  color: Object.freeze({
    gravel: '#9a958a', asphalt: '#46474a', pavers: '#8e8983', slabs: '#a8a59e', concrete: '#a7a49e', grass: '#62723f', bark: '#4b3a2c',
  }),
  /** the ground outside every surface: lawn inside the lot, meadow outside it */
  grass: '#62723f',
  meadow: '#717648',
  pathWidth: 1.2,
  blend: 1.2,
  wall: Object.freeze({ thickness: 0.2, height: 0.6, material: 'concrete', color: Object.freeze({ concrete: '#a19f99', stone: '#8a857c', block: '#9b9891' }) }),
  /** a retaining wall stands this far over the higher side, and this far into the ground under the lower */
  wallOver: 0.06,
  wallFoot: 0.4,
  fence: Object.freeze({
    height: Object.freeze({ fence: 1.0, screen: 1.8, hedge: 1.3 }),
    color: Object.freeze({ fence: '#eeebe5', screen: '#5c554d', hedge: '#3e5a2b' }),
  }),
  steps: Object.freeze({ width: 1.2, maxRise: 0.17, minGoing: 0.26, cheek: 0.15, cheekOver: 0.12 }),
  /** the fine ground grid (m) and the margin of fine grid round everything; coarser rings beyond it */
  grid: 0.5,
  margin: 8,
  rings: Object.freeze([1, 2, 4, 8, 16, 32]),
  /** an entrance: the landing slabs (m), the drop that gets a porch with steps */
  entrance: Object.freeze({ depth: 1.4, side: 0.4, porchDrop: 0.45, porchDepth: 1.4, stairWidth: 1.2, yardDepth: 1.8 }),
});

/** World y between the main floor and the ground (as claddinggeom.js GROUND_STEP: one step). */
const STEP = 0.15;
const EPS = 1e-9;
const SNAP = 1e-6;
const HEX = /^#[0-9a-f]{6}$/i;
const num = (v) => typeof v === 'number' && Number.isFinite(v);
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isPt = (p) => Array.isArray(p) && p.length === 2 && num(p[0]) && num(p[1]);
const isPt3 = (p) => Array.isArray(p) && p.length === 3 && p.every(num);
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const add = (a, b, k = 1) => [a[0] + b[0] * k, a[1] + b[1] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
const len = (a) => Math.hypot(a[0], a[1]);
const norm = (a) => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l];
};
const smooth = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const fmt = (v) => (Math.round(v * 100) / 100).toString().replace('.', ',');

const KNOWN = {
  site: ['terrain', 'lot', 'surfaces', 'walls', 'fences', 'steps', 'auto', 'grass', 'margin', 'source', 'estimated'],
  terrain: ['lines', 'points', 'source', 'estimated'],
  line: ['id', 'side', 'points', 'source', 'estimated'],
  surface: ['id', 'name', 'kind', 'surface', 'color', 'outline', 'path', 'width', 'y', 'blend', 'walls', 'wall', 'source', 'estimated'],
  wall: ['id', 'line', 'height', 'top', 'thickness', 'material', 'color', 'source', 'estimated'],
  fence: ['id', 'kind', 'line', 'height', 'color', 'source', 'estimated'],
  steps: ['id', 'from', 'to', 'width', 'fromY', 'toY', 'material', 'color', 'cheeks', 'source', 'estimated'],
  auto: ['entrances', 'paths', 'deckFeet'],
};

// ---------------------------------------------------------------------------------------------------------------
// Plan geometry

export function signedArea(P) {
  let a = 0;
  for (let i = 0; i < P.length; i++) {
    const p = P[i], q = P[(i + 1) % P.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

export function pointInPolygon(x, z, P) {
  let c = false;
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
    const a = P[i], b = P[j];
    if (a[1] > z !== b[1] > z && x < ((b[0] - a[0]) * (z - a[1])) / (b[1] - a[1]) + a[0]) c = !c;
  }
  return c;
}

/** Squared distance from (x, z) to the segment a–b, and the parameter t ∈ [0, 1] of the nearest point. */
function segNear(x, z, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const l2 = dx * dx + dz * dz;
  let t = l2 > 0 ? ((x - ax) * dx + (z - az) * dz) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const px = ax + dx * t - x, pz = az + dz * t - z;
  return { d2: px * px + pz * pz, t };
}

function segsCross(a, b, c, d) {
  const o = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const d1 = o(c, d, a), d2 = o(c, d, b), d3 = o(a, b, c), d4 = o(a, b, d);
  return ((d1 > EPS && d2 < -EPS) || (d1 < -EPS && d2 > EPS)) && ((d3 > EPS && d4 < -EPS) || (d3 < -EPS && d4 > EPS));
}

function isSimple(P) {
  const n = P.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (Math.abs(i - j) <= 1 || (i === 0 && j === n - 1)) continue;
      if (segsCross(P[i], P[(i + 1) % n], P[j], P[(j + 1) % n])) return false;
    }
  }
  return true;
}

/** A rectangle along a segment a → b, `w` wide (centred), extended by `ext` at both ends. */
function segRect(a, b, w, ext = 0) {
  const d = norm(sub(b, a)), n = [-d[1], d[0]];
  const a2 = add(a, d, -ext), b2 = add(b, d, ext);
  return [add(a2, n, -w / 2), add(b2, n, -w / 2), add(b2, n, w / 2), add(a2, n, w / 2)];
}

/** A plan rectangle from an origin on a line, the direction out from it, the across direction and its sizes. */
function frontRect(o, out, across, w, depth, from = 0) {
  const a = add(add(o, across, -w / 2), out, from), b = add(add(o, across, w / 2), out, from);
  return [a, b, add(b, out, depth - from), add(a, out, depth - from)];
}

// ---------------------------------------------------------------------------------------------------------------
// The terrain

/**
 * The natural ground from the terrain lines (one per facade) and spot heights: a plane fitted to them (least squares,
 * the slope capped at 60 %) plus, per line, its own deviation from the plane at its nearest point, weighted by the
 * inverse square distance to the line – on a line the ground is that line's height. Without lines or points the ground
 * is flat at groundY (the main floor − one step, as the houses on a flat plate so far).
 * @param {{ lines?: Array<{ points: number[][] }>, points?: number[][] }} terrain
 * @param {{ groundY?: number }} [o]
 */
export function terrainModel(terrain, { groundY = -STEP } = {}) {
  const srcs = [];
  for (const l of terrain?.lines ?? []) if (Array.isArray(l?.points) && l.points.filter(isPt3).length >= 1) srcs.push(l.points.filter(isPt3).map((p) => [...p]));
  for (const p of terrain?.points ?? []) if (isPt3(p)) srcs.push([[...p]]);
  if (!srcs.length) return { naturalAt: () => groundY, plane: { a: groundY, b: 0, c: 0 }, flat: true };
  // samples for the plane: every 0.5 m along each line, each line and each spot height the same weight in all (the
  // lines lie round the house; the spot heights tell how the lot goes on)
  const S = [];
  for (const pts of srcs) {
    if (pts.length === 1) {
      S.push([...pts[0], 1]);
      continue;
    }
    const first = S.length;
    for (let i = 0; i < pts.length - 1; i++) {
      const p = pts[i], q = pts[i + 1];
      const L = Math.hypot(q[0] - p[0], q[1] - p[1]);
      const n = Math.max(1, Math.ceil(L / 0.5));
      for (let k = 0; k <= n; k++) {
        if (k === 0 && i > 0) continue;
        const t = k / n;
        S.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t, Math.max(0.25, L / n)]);
      }
    }
    const sum = S.slice(first).reduce((acc, q) => acc + q[3], 0) || 1;
    for (let k = first; k < S.length; k++) S[k][3] /= sum;
  }
  // weighted least squares for y = a + b·(x − cx) + c·(z − cz), a little ridge on the slope (collinear samples)
  let W = 0, cx = 0, cz = 0;
  for (const [x, z, , w] of S) {
    W += w;
    cx += w * x;
    cz += w * z;
  }
  cx /= W;
  cz /= W;
  const M = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], r = [0, 0, 0];
  for (const [x, z, y, w] of S) {
    const v = [1, x - cx, z - cz];
    for (let i = 0; i < 3; i++) {
      r[i] += w * v[i] * y;
      for (let j = 0; j < 3; j++) M[i][j] += w * v[i] * v[j];
    }
  }
  M[1][1] += 1e-3 * W;
  M[2][2] += 1e-3 * W;
  const [a, b0, c0] = solve3(M, r);
  const g = Math.hypot(b0, c0), cap = 0.6;
  const b = g > cap ? (b0 * cap) / g : b0, c = g > cap ? (c0 * cap) / g : c0;
  // 15 m beyond the data the slope eases to a third (a hillside does not go on for ever at the house's slope)
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const [x, z] of S) {
    x0 = Math.min(x0, x - 15);
    x1 = Math.max(x1, x + 15);
    z0 = Math.min(z0, z - 15);
    z1 = Math.max(z1, z + 15);
  }
  const plane = (x, z) => {
    const qx = Math.min(x1, Math.max(x0, x)), qz = Math.min(z1, Math.max(z0, z));
    return a + b * (qx - cx) + c * (qz - cz) + (b * (x - qx) + c * (z - qz)) / 3;
  };
  const res = srcs.map((pts) => pts.map(([x, z, y]) => [x, z, y - plane(x, z)]));
  const R2 = 0.01;
  function naturalAt(x, z) {
    let sw = 0, sr = 0;
    for (const pts of res) {
      let d2 = Infinity, rr = 0;
      if (pts.length === 1) {
        d2 = (x - pts[0][0]) ** 2 + (z - pts[0][1]) ** 2;
        rr = pts[0][2];
      } else {
        for (let i = 0; i < pts.length - 1; i++) {
          const p = pts[i], q = pts[i + 1];
          const n = segNear(x, z, p[0], p[1], q[0], q[1]);
          if (n.d2 < d2) {
            d2 = n.d2;
            rr = p[2] + (q[2] - p[2]) * n.t;
          }
        }
      }
      const w = 1 / (d2 + R2);
      sw += w;
      sr += w * rr;
    }
    return plane(x, z) + sr / sw;
  }
  return { naturalAt, plane: { a: plane(0, 0), b, c }, flat: false };
}

function solve3(M, r) {
  const A = M.map((row, i) => [...row, r[i]]);
  for (let i = 0; i < 3; i++) {
    let p = i;
    for (let k = i + 1; k < 3; k++) if (Math.abs(A[k][i]) > Math.abs(A[p][i])) p = k;
    [A[i], A[p]] = [A[p], A[i]];
    const d = A[i][i] || 1e-12;
    for (let k = i; k < 4; k++) A[i][k] /= d;
    for (let j = 0; j < 3; j++) {
      if (j === i) continue;
      const f = A[j][i];
      for (let k = i; k < 4; k++) A[j][k] -= f * A[i][k];
    }
  }
  return [A[0][3], A[1][3], A[2][3]];
}

// ---------------------------------------------------------------------------------------------------------------
// The site

/**
 * The site of the house format with every default filled in, the auto entrances / deck feet / step ends added, the
 * decks resolved on the terrain (their groundY from the ground at a stair's foot, unless the data gives one), and the
 * ground grid. Issues: { level: 'error' | 'warn', where, msg } (Norwegian, for validateHouse).
 * @param {object} raw  spec.site
 * @param {object} ctx  see the file comment
 * @returns {{ site: object|null, decks: object[], rawDecks: object[]|null, issues: object[] }}
 */
export function resolveSite(raw, ctx = {}) {
  const issues = [];
  const err = (where, msg) => issues.push({ level: 'error', where, msg });
  const warn = (where, msg) => issues.push({ level: 'warn', where, msg });
  const levels = ctx.levels ?? [];
  const mainId = ctx.mainLevelId ?? 'hoved';
  const main = levels.find((l) => l.id === mainId) ?? levels[0];
  const mainY = num(main?.floorY) ? main.floorY : 0;
  const groundY = mainY - STEP;
  const walls = (ctx.walls ?? []).filter((w) => isPt(w.start) && isPt(w.end) && isPt(w.normal));
  const rooms = (ctx.rooms ?? []).filter((r) => Array.isArray(r.polygon) && r.polygon.length >= 3 && r.polygon.every(isPt));
  const deckCtx = { levels, walls, rooms, groundY };
  const rawDecks0 = Array.isArray(ctx.decks) ? ctx.decks : null;
  if (raw == null) {
    const r = rawDecks0 ? resolveDecks(rawDecks0, deckCtx) : { decks: [], issues: [] };
    return { site: null, decks: r.decks, rawDecks: rawDecks0, issues: r.issues };
  }
  if (!isObj(raw)) {
    err('site', 'må være et objekt');
    const r = rawDecks0 ? resolveDecks(rawDecks0, deckCtx) : { decks: [], issues: [] };
    return { site: null, decks: r.decks, rawDecks: rawDecks0, issues: [...issues, ...r.issues] };
  }
  const unknown = (where, o, known) => {
    const bad = Object.keys(o).filter((k) => !known.includes(k));
    if (bad.length) warn(where, `ukjente felt ${bad.map((k) => `«${k}»`).join(', ')} (brukes ikke)`);
  };
  unknown('site', raw, KNOWN.site);
  const color = (where, v, d) => {
    if (v == null) return d;
    if (typeof v === 'string' && HEX.test(v)) return v.toLowerCase();
    err(where, `fargen «${v}» er ikke på formen #rrggbb`);
    return d;
  };
  const polyOk = (where, P, minArea = 0.1) => {
    if (!(Array.isArray(P) && P.length >= 3 && P.every(isPt))) return err(where, 'outline må være minst tre punkter [x, z]'), false;
    if (Math.abs(signedArea(P)) < minArea) return err(where, `outline er for lite (${fmt(Math.abs(signedArea(P)))} m²)`), false;
    if (!isSimple(P)) return err(where, 'outline krysser seg selv'), false;
    return true;
  };

  // ---- the house's footprint below and at the main floor (rooms + wall slabs): the ground has a hole there
  const lowLevels = new Set(levels.filter((l) => !num(l.floorY) || l.floorY <= mainY + 0.5).map((l) => l.id));
  if (!levels.length) lowLevels.add(mainId);
  const footprint = [];
  for (const r of rooms) if (lowLevels.has(r.levelId ?? mainId)) footprint.push(r.polygon.map((p) => [p[0], p[1]]));
  const wallQuads = [];
  for (const w of walls) {
    if (!lowLevels.has(w.levelId ?? mainId) || !(w.thickness > 0.01)) continue;
    const o = [-w.normal[0] * w.thickness, -w.normal[1] * w.thickness];
    const q = [[...w.start], [...w.end], add(w.end, o), add(w.start, o)];
    wallQuads.push({ w, q });
    footprint.push(q);
  }
  const inHouse = (x, z) => footprint.some((P) => pointInPolygon(x, z, P));

  // ---- the terrain
  const T = raw.terrain;
  const lines = [], points = [];
  if (T != null) {
    if (!isObj(T)) err('site.terrain', 'må være et objekt');
    else {
      unknown('site.terrain', T, KNOWN.terrain);
      (Array.isArray(T.lines) ? T.lines : T.lines == null ? [] : (err('site.terrain', 'lines må være en liste'), [])).forEach((l, i) => {
        const where = `site.terrain.lines/${isObj(l) && l.id != null ? l.id : i}`;
        if (!isObj(l)) return err(where, 'en oppføring er ikke et objekt');
        unknown(where, l, KNOWN.line);
        if (!(Array.isArray(l.points) && l.points.length >= 2 && l.points.every(isPt3))) return err(where, 'points må være minst to punkter [x, z, y] (y er verdens-y)');
        lines.push({ id: l.id ?? `linje-${i + 1}`, side: l.side ?? null, points: l.points.map((p) => [...p]) });
      });
      (Array.isArray(T.points) ? T.points : T.points == null ? [] : (err('site.terrain', 'points må være en liste'), [])).forEach((p, i) => {
        if (!isPt3(p)) return err(`site.terrain.points/${i}`, 'et punkt må være [x, z, y]');
        points.push([...p]);
      });
    }
  }
  const terrain = terrainModel({ lines, points }, { groundY });
  const naturalAt = terrain.naturalAt;

  // ---- the lot
  let lot = null;
  if (raw.lot != null && polyOk('site.lot', raw.lot, 4)) lot = raw.lot.map((p) => [p[0], p[1]]);

  // ---- the surfaces of the data
  const surfaces = [];
  const ids = new Set();
  const takeId = (where, id) => {
    if (id == null) return err(where, 'mangler id'), false;
    if (ids.has(id)) err(where, `id-en «${id}» er brukt av noe annet på tomta`);
    ids.add(id);
    return true;
  };
  (Array.isArray(raw.surfaces) ? raw.surfaces : raw.surfaces == null ? [] : (err('site', 'surfaces må være en liste'), [])).forEach((s, i) => {
    const where = `site.surfaces/${isObj(s) && s.id != null ? s.id : i}`;
    if (!isObj(s)) return err(where, 'en oppføring er ikke et objekt');
    unknown(where, s, KNOWN.surface);
    if (!takeId(where, s.id)) return;
    const kind = s.kind ?? 'yard';
    if (!SITE_KINDS.includes(kind)) return err(where, `kind «${kind}» er ikke en av ${SITE_KINDS.join(', ')}`);
    let surface = s.surface ?? SITE_DEFAULTS.surface[kind];
    if (!SITE_SURFACES.includes(surface)) {
      err(where, `surface «${surface}» er ikke en av ${SITE_SURFACES.join(', ')}`);
      surface = SITE_DEFAULTS.surface[kind];
    }
    let polygon;
    if (s.path != null) {
      if (!(Array.isArray(s.path) && s.path.length >= 2 && s.path.every(isPt))) return err(where, 'path må være minst to punkter [x, z]');
      if (s.outline != null) warn(where, 'har både outline og path – path brukes');
      const w = s.width ?? SITE_DEFAULTS.pathWidth;
      if (!(num(w) && w >= 0.3)) return err(where, 'width må være et tall ≥ 0,3');
      polygon = pathPolygon(s.path, w);
      if (!polygon) return err(where, 'path har for korte biter');
    } else {
      if (!polyOk(where, s.outline, 0.1)) return;
      polygon = s.outline.map((p) => [p[0], p[1]]);
    }
    if (s.y != null && !num(s.y)) return err(where, 'y må være et tall (verdens-y) eller utelatt (følger terrenget)');
    const blend = s.blend ?? SITE_DEFAULTS.blend;
    if (!(num(blend) && blend >= 0)) return err(where, 'blend må være et tall ≥ 0');
    let wallEdges = [];
    if (s.walls != null) {
      if (s.y == null) warn(where, 'walls uten y: en flate som følger terrenget trenger ingen murer');
      if (s.walls === true) wallEdges = polygon.map((_, k) => k);
      else if (Array.isArray(s.walls) && s.walls.every((k) => Number.isInteger(k) && k >= 0 && k < polygon.length)) wallEdges = [...new Set(s.walls)];
      else if (s.walls !== false) err(where, `walls må være true, false eller kantnumre 0–${polygon.length - 1}`);
      if (s.path != null && wallEdges.length) warn(where, 'murer på en sti (path) følger kantene til stien');
    }
    const wall = wallSpec(where, s.wall, err);
    surfaces.push({
      id: s.id, name: s.name ?? '', kind, surface, color: color(where, s.color, SITE_DEFAULTS.color[surface]), polygon,
      y: s.y ?? null, blend, walls: s.y != null ? wallEdges : [], wall, auto: null,
    });
  });
  const grass = color('site.grass', raw.grass, SITE_DEFAULTS.grass);

  // ---- heights so far (the data's flat surfaces): what the auto entrances and the decks stand on
  const auto = isObj(raw.auto) ? raw.auto : {};
  if (raw.auto != null) {
    if (!isObj(raw.auto)) err('site.auto', 'må være et objekt { entrances, paths, deckFeet }');
    else unknown('site.auto', raw.auto, KNOWN.auto);
  }
  const autoOn = (k) => auto[k] !== false;
  const flatOf = (list) => list.map((s, i) => ({ s, i, b: bboxOf(s.polygon, s.blend) })).filter(({ s }) => s.y != null);
  const heightWith = (list) => {
    const flat = flatOf(list);
    const inside = (x, z) => list.map((s, i) => (pointInPolygon(x, z, s.polygon) ? i : -1)).filter((i) => i >= 0);
    const at = (x, z, ins) => {
      let h = naturalAt(x, z);
      for (const { s, i, b } of flat) {
        if (ins.includes(i)) {
          h = s.y;
          continue;
        }
        if (!(s.blend > 0) || x < b[0] || x > b[1] || z < b[2] || z > b[3]) continue;
        const d = openDist(x, z, s);
        if (d < s.blend) h = s.y + (h - s.y) * smooth(d / s.blend);
      }
      return h;
    };
    return { at, inside, height: (x, z) => at(x, z, inside(x, z)) };
  };
  const userH = heightWith(surfaces);

  // ---- the auto entrances: landing slabs in front of every outer door at the ground, a porch with steps where the
  //      ground falls away, a sunken yard with steps where the door stands under the ground
  const rawDecks = rawDecks0 ? rawDecks0.map((d) => (isObj(d) ? { ...d } : d)) : [];
  const autoSteps = [];
  const entrances = [];
  const E = SITE_DEFAULTS.entrance;
  const deckHas = (p) => rawDecks.some((d) => isObj(d) && Array.isArray(d.outline) && d.outline.length >= 3 && d.outline.every(isPt) && pointInPolygon(p[0], p[1], d.outline));
  for (const w of walls) {
    if (!w.exterior || !lowLevels.has(w.levelId ?? mainId) || !(w.thickness > 0.05)) continue;
    const L = len(sub(w.end, w.start));
    if (L < 0.1) continue;
    const dir = norm(sub(w.end, w.start));
    const out = [-w.normal[0], -w.normal[1]];
    for (const o of w.openings ?? []) {
      if (o.type !== 'door' || !num(o.offset) || !num(o.width)) continue;
      if (Array.isArray(o.connects) && new Set(o.connects).size >= 2 && !o.connects.includes('ute')) continue; // to an attached room
      const u = o.offset + o.width / 2;
      const face = add(add(w.start, dir, u), out, w.thickness);
      const front = add(face, out, 0.4);
      const floorY = num(w.floorY) ? w.floorY : mainY;
      const ground = userH.height(front[0], front[1]);
      const drop = floorY - ground;
      const where = `site (dør ${o.id})`;
      const e = { doorId: o.id, wallId: w.id, levelId: w.levelId ?? mainId, face, out, across: dir, floorY, ground, drop, width: o.width, kind: 'none' };
      entrances.push(e);
      if (deckHas(front)) {
        e.kind = 'deck';
        continue;
      }
      // a paved surface of the data in front of the door is its landing
      if (surfaces.some((q) => !q.auto && q.surface && q.surface !== 'grass' && q.surface !== 'bark' && pointInPolygon(front[0], front[1], q.polygon))) {
        e.kind = 'surface';
        continue;
      }
      if (o.width > 1.9) {
        e.kind = 'wide'; // a garage or carport door: the driveway is its outside
        continue;
      }
      if (!autoOn('entrances')) continue;
      const W = Math.max(1.6, o.width + 2 * E.side);
      if (drop < -0.05) {
        // the door under the ground: a sunken yard at the step under the floor, walled, with steps up out of it
        e.kind = 'yard';
        const yY = floorY - STEP;
        const D = E.yardDepth, sw = SITE_DEFAULTS.steps.width, ch = SITE_DEFAULTS.steps.cheek;
        const yard = frontRect(face, out, dir, W, D);
        // the front edge has a gap for the steps (their cheek walls stand in the yard's wall line)
        const g0 = add(add(face, out, D), dir, -(sw / 2 + ch)), g1 = add(add(face, out, D), dir, sw / 2 + ch);
        const poly = [yard[0], yard[1], yard[2], g1, g0, yard[3]];
        const id = `ute-gaard-${o.id}`;
        surfaces.push({ id, name: '', kind: 'yard', surface: 'concrete', color: SITE_DEFAULTS.color.concrete, polygon: poly, y: yY, blend: 0, walls: [1, 2, 4, 5], wall: wallSpec(id, null, err), auto: 'yard' });
        // steps from the yard's front edge out and up to the ground (their length from the ground they reach)
        const base = add(face, out, D);
        let run = Math.max(0.6, ((ground - yY) / SITE_DEFAULTS.steps.maxRise) * 0.3);
        for (let k = 0; k < 4; k++) {
          const top = add(base, out, run);
          const rise = userH.height(top[0], top[1]) - yY;
          run = Math.max(0.6, Math.ceil(Math.max(rise, 0.01) / SITE_DEFAULTS.steps.maxRise) * 0.3);
        }
        autoSteps.push({ id: `ute-gaardstrapp-${o.id}`, from: add(base, out, run), to: base, toY: yY, width: sw, auto: 'yard' });
        warn(where, `døra står ${fmt(-drop)} m under terrenget – en nedsenket gårdsplass med trapp opp er lagt til`);
      } else if (drop <= E.porchDrop) {
        e.kind = 'slabs';
        const id = `ute-inngang-${o.id}`;
        surfaces.push({ id, name: '', kind: 'path', surface: 'slabs', color: SITE_DEFAULTS.color.slabs, polygon: frontRect(face, out, dir, W, E.depth), y: floorY - STEP, blend: SITE_DEFAULTS.blend, walls: [], wall: wallSpec(id, null, err), auto: 'entrance' });
        e.foot = add(face, out, E.depth);
      } else {
        // a porch at the threshold with steps straight out (deckgeom: rails where the fall is over 0.5 m)
        e.kind = 'porch';
        const id = `ute-trapp-${o.id}`;
        const P = frontRect(face, out, dir, W, E.porchDepth);
        rawDecks.push({
          id, kind: 'porch', levelId: w.levelId ?? mainId, y: -0.02, outline: P, surface: 'concrete', supports: 'solid',
          railing: { type: 'steel-bars' }, stairs: [{ edge: 2, at: W / 2, width: Math.min(E.stairWidth, W - 0.2) }], source: 'site-auto',
        });
      }
    }
  }

  // ---- the decks on the terrain: groundY from the ground at a stair's foot (else the lowest ground under the outline)
  const autoG = new Set();
  const guessG = (d) => {
    const pts = [...d.outline, d.outline.reduce((s, p) => [s[0] + p[0] / d.outline.length, s[1] + p[1] / d.outline.length], [0, 0])];
    return Math.min(...pts.map((p) => userH.height(p[0], p[1])));
  };
  for (const d of rawDecks) {
    if (!isObj(d) || d.groundY != null || !(Array.isArray(d.outline) && d.outline.length >= 3 && d.outline.every(isPt))) continue;
    d.groundY = round3(guessG(d));
    autoG.add(d);
  }
  let deckRes = resolveDecks(rawDecks, deckCtx);
  for (let it = 0; it < 4; it++) {
    let moved = false;
    for (const dk of deckRes.decks) {
      const d = rawDecks.find((x) => isObj(x) && x.id === dk.id);
      if (!autoG.has(d) || !dk.stairs.length) continue;
      const feet = dk.stairs.map((s) => add(s.origin, s.out, s.reach + 0.3));
      const g = round3(Math.min(...feet.map((p) => userH.height(p[0], p[1]))));
      // never above the deck's top less one riser (the stair needs at least one step)
      const gy = Math.min(g, dk.top - 0.05);
      if (Math.abs(gy - d.groundY) > 0.004) {
        d.groundY = gy;
        moved = true;
      }
    }
    if (!moved) break;
    deckRes = resolveDecks(rawDecks, deckCtx);
  }
  const decks = deckRes.decks;
  issues.push(...deckRes.issues);

  // ---- the deck feet: slabs at the foot of every deck stair (and the ground under the stair at the foot's level)
  if (autoOn('deckFeet')) {
    for (const dk of decks) {
      dk.stairs.forEach((s, k) => {
        const id = `ute-fot-${dk.id}-${k}`;
        const P = frontRect(s.origin, s.out, s.across, s.width + 0.4, s.reach + 1.0, 0.02);
        surfaces.push({ id, name: '', kind: 'path', surface: 'slabs', color: SITE_DEFAULTS.color.slabs, polygon: P, y: s.bottom, blend: SITE_DEFAULTS.blend, walls: [], wall: wallSpec(id, null, err), auto: 'deck-foot' });
        if (dk.kind === 'porch' && dk.id.startsWith('ute-trapp-')) {
          const e = entrances.find((q) => `ute-trapp-${q.doorId}` === dk.id);
          if (e) e.foot = add(s.origin, s.out, s.reach + 1.0);
        }
      });
    }
  }

  // ---- garden steps (data + auto): from the higher end to the lower, flat treads, cheek walls; flat ground at both ends
  const steps = [];
  const stepList = [
    ...(Array.isArray(raw.steps) ? raw.steps : raw.steps == null ? [] : (err('site', 'steps må være en liste'), [])).map((s) => ({ s, auto: null })),
    ...autoSteps.map((s) => ({ s, auto: s.auto })),
  ];
  stepList.forEach(({ s, auto: a }, i) => {
    const where = `site.steps/${isObj(s) && s.id != null ? s.id : i}`;
    if (!isObj(s)) return err(where, 'en oppføring er ikke et objekt');
    if (!a) unknown(where, s, KNOWN.steps);
    if (!takeId(where, s.id)) return;
    if (!isPt(s.from) || !isPt(s.to)) return err(where, 'from og to må være punkter [x, z]');
    const L = len(sub(s.to, s.from));
    if (L < 0.3) return err(where, 'trappa er kortere enn 0,3 m');
    const w = s.width ?? SITE_DEFAULTS.steps.width;
    if (!(num(w) && w >= 0.6)) return err(where, 'width må være et tall ≥ 0,6');
    const h0 = num(s.fromY) ? s.fromY : userH.height(s.from[0], s.from[1]);
    const h1 = num(s.toY) ? s.toY : userH.height(s.to[0], s.to[1]);
    const [top, bot, P0, P1] = h0 >= h1 ? [h0, h1, s.from, s.to] : [h1, h0, s.to, s.from];
    const rise = top - bot;
    const n = Math.max(1, Math.ceil(rise / SITE_DEFAULTS.steps.maxRise - 1e-9));
    const R = rise / n, G = L / n;
    if (rise < 0.05) warn(where, `nesten ingen høydeforskjell (${fmt(rise)} m) – bruk en sti`);
    else if (G < SITE_DEFAULTS.steps.minGoing - 1e-6) warn(where, `for bratt: ${n} trinn på ${fmt(L)} m gir inntrinn ${fmt(G)} (minst ${fmt(SITE_DEFAULTS.steps.minGoing)}) – gjør trappa lengre`);
    const out = norm(sub(P1, P0)), across = [-out[1], out[0]];
    const material = s.material ?? 'concrete';
    if (!WALL_MATERIALS.includes(material)) err(where, `material «${material}» er ikke en av ${WALL_MATERIALS.join(', ')}`);
    const cheeks = s.cheeks !== false;
    const ch = cheeks ? SITE_DEFAULTS.steps.cheek : 0;
    const st = {
      id: s.id, origin: [...P0], out, across, width: w, length: L, top, bottom: bot, risers: n, riserH: R, going: G, cheeks, cheek: ch,
      material, color: color(where, s.color, SITE_DEFAULTS.wall.color[material] ?? SITE_DEFAULTS.wall.color.concrete), auto: a,
      footprint: frontRect(P0, out, across, w + 2 * ch, L),
    };
    steps.push(st);
    // flat ground at both ends (shape only: the material under it stays)
    surfaces.push({ id: `${s.id}:topp`, name: '', kind: 'path', surface: null, color: null, polygon: frontRect(P0, out, across, w + 2 * ch, 0, -0.8), y: top, blend: 1.0, walls: [], wall: null, auto: 'step-end' });
    surfaces.push({ id: `${s.id}:fot`, name: '', kind: 'path', surface: null, color: null, polygon: frontRect(add(P0, out, L), out, across, w + 2 * ch, 0.8), y: bot, blend: 1.0, walls: [], wall: null, auto: 'step-end' });
  });

  // ---- the auto paths: from every entrance to the nearest driveway or yard of the data (draped, slabs)
  const goals = surfaces.filter((s) => !s.auto && (s.kind === 'driveway' || s.kind === 'yard'));
  if (autoOn('paths') && goals.length) {
    for (const e of entrances) {
      if (!e.foot) continue;
      let best = null;
      for (const g of goals) {
        if (pointInPolygon(e.foot[0], e.foot[1], g.polygon)) {
          best = null;
          break;
        }
        const P = g.polygon;
        for (let i = 0; i < P.length; i++) {
          const a = P[i], b = P[(i + 1) % P.length];
          const n = segNear(e.foot[0], e.foot[1], a[0], a[1], b[0], b[1]);
          if (!best || n.d2 < best.d2) best = { d2: n.d2, p: [a[0] + (b[0] - a[0]) * n.t, a[1] + (b[1] - a[1]) * n.t], g };
        }
      }
      if (!best || best.d2 < 0.04) continue;
      const to = add(best.p, norm(sub(best.p, e.foot)), 0.3);
      // not through the house
      const hits = (q) => inHouse(q[0], q[1]);
      let blocked = false;
      for (let k = 1; k < 20 && !blocked; k++) blocked = hits([e.foot[0] + ((to[0] - e.foot[0]) * k) / 20, e.foot[1] + ((to[1] - e.foot[1]) * k) / 20]);
      if (blocked) continue;
      const id = `ute-sti-${e.doorId}`;
      const P = pathPolygon([add(e.foot, norm(sub(to, e.foot)), -0.3), to], 1.0);
      if (P) surfaces.push({ id, name: '', kind: 'path', surface: 'slabs', color: SITE_DEFAULTS.color.slabs, polygon: P, y: null, blend: 0, walls: [], wall: null, auto: 'path' });
    }
  }

  // ---- the final heights: every flat surface (data + auto) cut into the terrain
  const H = heightWith(surfaces);

  // ---- the retaining walls of the walled surfaces: outside the edge, from under the lower side to over the higher
  const retaining = [];
  surfaces.forEach((s, si) => {
    if (!s.walls.length) return;
    const P = s.polygon, n = P.length;
    const ccw = signedArea(P) > 0;
    const t = s.wall.thickness;
    const outN = (k) => {
      const d = norm(sub(P[(k + 1) % n], P[k]));
      return ccw ? [d[1], -d[0]] : [-d[1], d[0]];
    };
    const walled = new Set(s.walls);
    for (const k of walled) {
      const a = P[k], b = P[(k + 1) % n];
      const nk = outN(k);
      // mitred into a walled neighbour, square where the neighbour is open
      const corner = (v, other) => {
        if (!walled.has(other)) return add(P[v], nk, t);
        const no = outN(other);
        const bis = norm([nk[0] + no[0], nk[1] + no[1]]);
        const c = Math.max(0.3, dot(bis, nk));
        return add(P[v], bis, Math.min(3 * t, t / c));
      };
      const oa = corner(k, (k - 1 + n) % n), ob = corner((k + 1) % n, (k + 1) % n);
      // pieces of ≤ 1 m: the top follows the higher side
      const L = len(sub(b, a));
      const m = Math.max(1, Math.ceil(L / 1.0));
      for (let j = 0; j < m; j++) {
        const t0 = j / m, t1 = (j + 1) / m;
        const i0 = lerp2(a, b, t0), i1 = lerp2(a, b, t1), o0 = lerp2(oa, ob, t0), o1 = lerp2(oa, ob, t1);
        const yOut = (p) => H.at(p[0], p[1], H.inside(p[0], p[1]).filter((q) => q !== si));
        const y0o = yOut(o0), y1o = yOut(o1);
        const top0 = Math.max(s.y, y0o) + SITE_DEFAULTS.wallOver, top1 = Math.max(s.y, y1o) + SITE_DEFAULTS.wallOver;
        const bot = Math.min(s.y, y0o, y1o) - SITE_DEFAULTS.wallFoot;
        retaining.push({
          id: `${s.id}:mur-${k}-${j}`, surfaceId: s.id, quad: [i0, i1, o1, o0], top: [top0, top1, top1, top0], bottom: bot, material: s.wall.material, color: s.wall.color,
          step: Math.max(Math.abs(y0o - s.y), Math.abs(y1o - s.y)), capStart: j === 0 && !walled.has((k - 1 + n) % n), capEnd: j === m - 1 && !walled.has((k + 1) % n),
        });
      }
    }
  });

  // ---- garden walls (frittstående murer): along a line, the top `height` over the ground (or at `top`)
  const gardenWalls = [];
  (Array.isArray(raw.walls) ? raw.walls : raw.walls == null ? [] : (err('site', 'walls må være en liste'), [])).forEach((w, i) => {
    const where = `site.walls/${isObj(w) && w.id != null ? w.id : i}`;
    if (!isObj(w)) return err(where, 'en oppføring er ikke et objekt');
    unknown(where, w, KNOWN.wall);
    if (!takeId(where, w.id)) return;
    if (!(Array.isArray(w.line) && w.line.length >= 2 && w.line.every(isPt))) return err(where, 'line må være minst to punkter [x, z]');
    const spec = wallSpec(where, w, err);
    const height = w.height ?? SITE_DEFAULTS.wall.height;
    if (!(num(height) && height > 0.05)) return err(where, 'height må være et tall > 0,05');
    if (w.top != null && !num(w.top)) return err(where, 'top må være et tall (verdens-y)');
    gardenWalls.push({ id: w.id, line: w.line.map((p) => [p[0], p[1]]), height, top: w.top ?? null, ...spec });
  });

  // ---- fences, screens and hedges
  const fences = [];
  (Array.isArray(raw.fences) ? raw.fences : raw.fences == null ? [] : (err('site', 'fences må være en liste'), [])).forEach((f, i) => {
    const where = `site.fences/${isObj(f) && f.id != null ? f.id : i}`;
    if (!isObj(f)) return err(where, 'en oppføring er ikke et objekt');
    unknown(where, f, KNOWN.fence);
    if (!takeId(where, f.id)) return;
    const kind = f.kind ?? 'fence';
    if (!FENCE_KINDS.includes(kind)) return err(where, `kind «${kind}» er ikke en av ${FENCE_KINDS.join(', ')}`);
    if (!(Array.isArray(f.line) && f.line.length >= 2 && f.line.every(isPt))) return err(where, 'line må være minst to punkter [x, z]');
    const height = f.height ?? SITE_DEFAULTS.fence.height[kind];
    if (!(num(height) && height >= 0.3 && height <= 3)) return err(where, 'height må være et tall 0,3–3');
    const line = f.line.map((p) => [p[0], p[1]]);
    for (let k = 0; k < line.length - 1; k++) {
      if (len(sub(line[k + 1], line[k])) < 0.1) return err(where, `bit ${k} er kortere enn 10 cm`);
      for (let q = 0; q < 20; q++) {
        const p = lerp2(line[k], line[k + 1], (q + 0.5) / 20);
        if (inHouse(p[0], p[1])) return warn(where, 'går gjennom huset – flytt linja ut');
      }
    }
    fences.push({ id: f.id, kind, line, height, color: color(where, f.color, SITE_DEFAULTS.fence.color[kind]) });
  });

  // ---- the ground's holes: the house, solid decks (porches), the retaining walls, the steps
  const holes = [...footprint];
  for (const dk of decks) if (dk.supports === 'solid' && dk.bottom <= dk.groundY + 0.05) holes.push(dk.outline.map((p) => [...p]));
  for (const r of retaining) holes.push(r.quad);
  for (const st of steps) holes.push(st.footprint);

  // ---- checks against the house: the ground over the floor outside a wall of the main level (a basement's walls
  //      stand in the ground, the main floor's must not)
  for (const { w } of wallQuads) {
    const floorY = num(w.floorY) ? w.floorY : mainY;
    if (!w.exterior || floorY < mainY - 0.5) continue;
    const out = [-w.normal[0], -w.normal[1]];
    let worst = -Infinity;
    for (let k = 0; k <= 8; k++) {
      const p = add(lerp2(w.start, w.end, k / 8), out, w.thickness + 0.05);
      if (!inHouse(p[0], p[1])) worst = Math.max(worst, H.height(p[0], p[1]) - floorY);
    }
    if (worst > -0.03) warn(`site (vegg ${w.id})`, `terrenget ligger ${fmt(worst)} m over gulvet utenfor veggen – senk terrenglinja eller legg til en kjeller`);
  }

  // ---- the ground grid: fine (0.5 m) over everything and a margin, coarser rings out to the horizon
  const bb = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
  const grow = (p) => {
    bb.minX = Math.min(bb.minX, p[0]);
    bb.maxX = Math.max(bb.maxX, p[0]);
    bb.minZ = Math.min(bb.minZ, p[1]);
    bb.maxZ = Math.max(bb.maxZ, p[1]);
  };
  for (const P of footprint) P.forEach(grow);
  for (const s of surfaces) s.polygon.forEach(grow);
  for (const f of fences) f.line.forEach(grow);
  for (const w of gardenWalls) w.line.forEach(grow);
  for (const d of decks) d.outline.forEach(grow);
  if (lot) lot.forEach(grow);
  for (const l of lines) l.points.forEach(grow);
  if (!Number.isFinite(bb.minX)) Object.assign(bb, { minX: -5, maxX: 5, minZ: -5, maxZ: 5 });
  const margin = num(raw.margin) && raw.margin >= 2 ? raw.margin : SITE_DEFAULTS.margin;
  if (raw.margin != null && !(num(raw.margin) && raw.margin >= 2)) err('site.margin', 'må være et tall ≥ 2 (meter)');
  const g = SITE_DEFAULTS.grid;
  const fine = {
    minX: Math.floor((bb.minX - margin) / g) * g, maxX: Math.ceil((bb.maxX + margin) / g) * g,
    minZ: Math.floor((bb.minZ - margin) / g) * g, maxZ: Math.ceil((bb.maxZ + margin) / g) * g,
  };
  const axis = (lo, hi) => {
    const v = [];
    for (let x = lo; x <= hi + 1e-9; x += g) v.push(Math.round(x * 1e6) / 1e6);
    let a = lo, b = hi;
    for (const r of SITE_DEFAULTS.rings) {
      a -= r;
      b += r;
      v.unshift(a);
      v.push(b);
    }
    return v;
  };
  const grid = { step: g, fine, xs: axis(fine.minX, fine.maxX), zs: axis(fine.minZ, fine.maxZ) };

  // the ground's height range over the fine grid (the walk rectangle's band of feet heights)
  let yLo = Infinity, yHi = -Infinity;
  for (let x = fine.minX; x <= fine.maxX + 1e-9; x += 2) {
    for (let z = fine.minZ; z <= fine.maxZ + 1e-9; z += 2) {
      const y = H.height(x, z);
      yLo = Math.min(yLo, y);
      yHi = Math.max(yHi, y);
    }
  }
  for (const s of surfaces) if (s.y != null) {
    yLo = Math.min(yLo, s.y);
    yHi = Math.max(yHi, s.y);
  }

  const site = {
    groundY, mainY, yRange: [yLo, yHi], terrain: { lines, points, plane: terrain.plane, flat: terrain.flat }, naturalAt,
    /** world y of the ground at a plan point (the surfaces' flat parts included) */
    heightAt: (x, z) => H.height(x, z),
    /** world y of the ground for a point that lies inside the surfaces `ins` (indices into surfaces) */
    heightIn: (x, z, ins) => H.at(x, z, ins),
    insideAt: (x, z) => H.inside(x, z),
    lot, grass, meadow: SITE_DEFAULTS.meadow,
    surfaces, retaining, walls: gardenWalls, fences, steps, entrances, holes, footprint, inHouse, grid,
    /** the walkable rectangle of the site (the fine grid) */
    bounds: { ...fine },
  };
  return { site, decks, rawDecks: rawDecks0 || rawDecks.length ? rawDecks : null, issues };
}

const round3 = (v) => Math.round(v * 1000) / 1000;
/** [minX, maxX, minZ, maxZ] of a polygon grown by m. */
const bboxOf = (P, m = 0) => [Math.min(...P.map((p) => p[0])) - m, Math.max(...P.map((p) => p[0])) + m, Math.min(...P.map((p) => p[1])) - m, Math.max(...P.map((p) => p[1])) + m];
const lerp2 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

/** Distance from a point to the open (not walled) edges of a flat surface; Infinity outside with only walled edges. */
function openDist(x, z, s) {
  const P = s.polygon, n = P.length;
  let best = Infinity;
  for (let k = 0; k < n; k++) {
    if (s.walls.includes(k)) continue;
    const a = P[k], b = P[(k + 1) % n];
    best = Math.min(best, segNear(x, z, a[0], a[1], b[0], b[1]).d2);
  }
  return Math.sqrt(best);
}

/** The outline of a path (polyline, width w): a strip with mitred joints (null for a degenerate path). */
export function pathPolygon(path, w) {
  const P = path.filter((p, i) => i === 0 || len(sub(p, path[i - 1])) > 0.01);
  if (P.length < 2) return null;
  const left = [], right = [];
  for (let i = 0; i < P.length; i++) {
    const dIn = i > 0 ? norm(sub(P[i], P[i - 1])) : null;
    const dOut = i < P.length - 1 ? norm(sub(P[i + 1], P[i])) : null;
    const nIn = dIn && [-dIn[1], dIn[0]], nOut = dOut && [-dOut[1], dOut[0]];
    let n = nIn && nOut ? norm([nIn[0] + nOut[0], nIn[1] + nOut[1]]) : nIn || nOut;
    const c = nIn && nOut ? Math.max(0.35, dot(n, nOut)) : 1;
    left.push(add(P[i], n, w / 2 / c));
    right.push(add(P[i], n, -w / 2 / c));
  }
  const poly = [...right, ...left.reverse()];
  return isSimple(poly) ? poly : null;
}

/** The wall settings of a surface's retaining walls or a garden wall (thickness, material, colour). */
function wallSpec(where, w, err) {
  const D = SITE_DEFAULTS.wall;
  const o = isObj(w) ? w : {};
  const material = o.material ?? D.material;
  if (!WALL_MATERIALS.includes(material)) err(where, `material «${material}» er ikke en av ${WALL_MATERIALS.join(', ')}`);
  const thickness = o.thickness ?? D.thickness;
  if (!(num(thickness) && thickness >= 0.08 && thickness <= 1)) err(where, 'thickness må være et tall 0,08–1');
  const m = WALL_MATERIALS.includes(material) ? material : D.material;
  let color = o.color ?? D.color[m];
  if (typeof color !== 'string' || !HEX.test(color)) {
    err(where, `fargen «${color}» er ikke på formen #rrggbb`);
    color = D.color[m];
  }
  return { thickness: num(thickness) ? thickness : D.thickness, material: m, color: color.toLowerCase() };
}

// ---------------------------------------------------------------------------------------------------------------
// The ground as triangles

/**
 * The ground of the site cut along every constraint (the holes, the surfaces, the lot) on the site's grid: each grid
 * cell is split by the lines of the constraint edges that touch it into convex pieces; a piece inside a hole is
 * dropped, the others are fanned into triangles with the material of the last surface they lie in (else lawn inside
 * the lot, meadow outside). Heights: exact (heightIn with the piece's surfaces) inside a cell and at the corners and
 * where a constraint edge crosses a cell edge (both cells have that point); a point only one cell has on its edge (an
 * extended split line) is interpolated between its neighbours on that edge, so neighbouring cells meet without cracks.
 * The edge of a walled surface is a step in the ground; its retaining wall stands in a hole beside it.
 * @param {object} site  resolveSite().site
 * @returns {Array<{ key: string, surf: number, tri: number[] }>}  key: 'grass' | 'meadow' | the surface's index
 */
export function sitePieces(site) {
  const { xs, zs } = site.grid;
  const nx = xs.length - 1, nz = zs.length - 1;
  const polys = [];
  for (const P of site.holes) polys.push(P);
  for (const s of site.surfaces) polys.push(s.polygon);
  if (site.lot) polys.push(site.lot);
  // constraint segments, canonical (sorted end points)
  const segs = [];
  for (const P of polys) {
    for (let i = 0; i < P.length; i++) {
      let a = P[i], b = P[(i + 1) % P.length];
      if (Math.abs(a[0] - b[0]) < EPS && Math.abs(a[1] - b[1]) < EPS) continue;
      if (a[0] > b[0] || (a[0] === b[0] && a[1] > b[1])) [a, b] = [b, a];
      segs.push([a[0], a[1], b[0], b[1]]);
    }
  }
  const lowerIdx = (v, x) => {
    let lo = 0, hi = v.length - 1;
    while (lo < hi) {
      const m = (lo + hi + 1) >> 1;
      if (v[m] <= x) lo = m;
      else hi = m - 1;
    }
    return lo;
  };
  // per cell: the segments touching it; per grid line: the points where segments cross it
  const bucket = new Map();
  const crossX = xs.map(() => []), crossZ = zs.map(() => []);
  segs.forEach((s, si) => {
    const [ax, az, bx, bz] = s;
    const i0 = Math.max(0, Math.min(nx - 1, lowerIdx(xs, Math.min(ax, bx)) - (xs.includes(Math.min(ax, bx)) ? 1 : 0)));
    const i1 = Math.max(0, Math.min(nx - 1, lowerIdx(xs, Math.max(ax, bx))));
    const j0 = Math.max(0, Math.min(nz - 1, lowerIdx(zs, Math.min(az, bz)) - (zs.includes(Math.min(az, bz)) ? 1 : 0)));
    const j1 = Math.max(0, Math.min(nz - 1, lowerIdx(zs, Math.max(az, bz))));
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        if (!segTouchesRect(s, xs[i], xs[i + 1], zs[j], zs[j + 1])) continue;
        const k = i * nz + j;
        (bucket.get(k) ?? bucket.set(k, []).get(k)).push(si);
      }
    }
    for (let i = Math.max(0, i0); i <= Math.min(nx, i1 + 1); i++) {
      const X = xs[i];
      if (bx - ax > EPS && X >= ax - EPS && X <= bx + EPS) crossX[i].push(X <= ax ? az : X >= bx ? bz : az + ((X - ax) * (bz - az)) / (bx - ax));
    }
    const zlo = Math.min(az, bz), zhi = Math.max(az, bz);
    for (let j = Math.max(0, j0); j <= Math.min(nz, j1 + 1); j++) {
      const Z = zs[j];
      if (zhi - zlo > EPS && Z >= zlo - EPS && Z <= zhi + EPS) {
        const [px, pz, qx, qz] = az <= bz ? [ax, az, bx, bz] : [bx, bz, ax, az];
        crossZ[j].push(Z <= pz ? px : Z >= qz ? qx : px + ((Z - pz) * (qx - px)) / (qz - pz));
      }
    }
  });
  for (const c of crossX) c.sort((p, q) => p - q);
  for (const c of crossZ) c.sort((p, q) => p - q);

  const lotIn = (x, z) => !site.lot || pointInPolygon(x, z, site.lot);
  const surf = site.surfaces;
  const holeAt = (x, z) => site.holes.some((P) => pointInPolygon(x, z, P));
  const insideOf = (x, z) => {
    const r = [];
    for (let i = 0; i < surf.length; i++) if (pointInPolygon(x, z, surf[i].polygon)) r.push(i);
    return r;
  };
  const keyOf = (x, z, ins) => {
    for (let k = ins.length - 1; k >= 0; k--) if (surf[ins[k]].surface) return { key: String(ins[k]), surf: ins[k] };
    return lotIn(x, z) ? { key: 'grass', surf: -1 } : { key: 'meadow', surf: -1 };
  };
  const out = [];
  const near = (v, list) => {
    let lo = 0, hi = list.length - 1, best = null;
    while (lo <= hi) {
      const m = (lo + hi) >> 1;
      if (Math.abs(list[m] - v) <= SNAP) return list[m];
      if (list[m] < v) lo = m + 1;
      else hi = m - 1;
    }
    for (const k of [lo - 1, lo, lo + 1]) if (k >= 0 && k < list.length && Math.abs(list[k] - v) <= SNAP) best = list[k];
    return best;
  };
  for (let i = 0; i < nx; i++) {
    const x0 = xs[i], x1 = xs[i + 1];
    for (let j = 0; j < nz; j++) {
      const z0 = zs[j], z1 = zs[j + 1];
      const list = bucket.get(i * nz + j);
      let pieces = [[[x0, z0], [x1, z0], [x1, z1], [x0, z1]]];
      if (list) for (const si of list) pieces = pieces.flatMap((p) => splitConvex(p, segs[si]));
      // the shared points of the cell's four edges (corners + crossings), per edge sorted along it
      const sharedOn = (side) => {
        if (side === 0) return [x0, ...crossZ[j].filter((v) => v > x0 + SNAP && v < x1 - SNAP), x1]; // z = z0, along x
        if (side === 2) return [x0, ...crossZ[j + 1].filter((v) => v > x0 + SNAP && v < x1 - SNAP), x1];
        if (side === 3) return [z0, ...crossX[i].filter((v) => v > z0 + SNAP && v < z1 - SNAP), z1]; // x = x0, along z
        return [z0, ...crossX[i + 1].filter((v) => v > z0 + SNAP && v < z1 - SNAP), z1];
      };
      for (const P of pieces) {
        if (Math.abs(signedArea(P)) < 1e-9) continue;
        let cx = 0, cz = 0;
        for (const p of P) {
          cx += p[0];
          cz += p[1];
        }
        cx /= P.length;
        cz /= P.length;
        if (holeAt(cx, cz)) continue;
        const ins = insideOf(cx, cz);
        const { key, surf: si } = keyOf(cx, cz, ins);
        const hAt = (x, z) => site.heightIn(x, z, ins);
        const pts = P.map(([x, z]) => {
          // on a cell edge: snap to a shared point, else interpolate between the shared points either side
          const onZ0 = Math.abs(z - z0) < 1e-12, onZ1 = Math.abs(z - z1) < 1e-12, onX0 = Math.abs(x - x0) < 1e-12, onX1 = Math.abs(x - x1) < 1e-12;
          if ((onZ0 || onZ1) && (onX0 || onX1)) return [x, hAt(x, z), z];
          if (onZ0 || onZ1) {
            const sh = sharedOn(onZ0 ? 0 : 2);
            const s = near(x, sh);
            if (s !== null) return [s, hAt(s, z), z];
            const k = sh.findIndex((v) => v > x);
            const a = sh[k - 1], b = sh[k];
            const t = (x - a) / (b - a);
            return [x, hAt(a, z) + (hAt(b, z) - hAt(a, z)) * t, z];
          }
          if (onX0 || onX1) {
            const sh = sharedOn(onX0 ? 3 : 1);
            const s = near(z, sh);
            if (s !== null) return [x, hAt(x, s), s];
            const k = sh.findIndex((v) => v > z);
            const a = sh[k - 1], b = sh[k];
            const t = (z - a) / (b - a);
            return [x, hAt(x, a) + (hAt(x, b) - hAt(x, a)) * t, z];
          }
          return [x, hAt(x, z), z];
        });
        // fan, facing up (the plan is counter-clockwise in (x, z) seen from below: flip to +y normals)
        const up = signedArea(P) < 0;
        for (let k = 1; k < pts.length - 1; k++) {
          const a = pts[0], b = pts[k], c = pts[k + 1];
          const ar = (b[0] - a[0]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[0] - a[0]);
          if (Math.abs(ar) < 1e-12) continue;
          out.push({ key, surf: si, tri: up ? [...a, ...b, ...c] : [...a, ...c, ...b] });
        }
      }
    }
  }
  return out;
}

/** Does the segment [ax, az, bx, bz] touch the closed rectangle? */
function segTouchesRect([ax, az, bx, bz], x0, x1, z0, z1) {
  // Liang–Barsky
  let t0 = 0, t1 = 1;
  const dx = bx - ax, dz = bz - az;
  const clip = (p, q) => {
    if (Math.abs(p) < EPS) return q >= -EPS;
    const r = q / p;
    if (p < 0) {
      if (r > t1 + EPS) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0 - EPS) return false;
      if (r < t1) t1 = r;
    }
    return true;
  };
  return clip(-dx, ax - x0) && clip(dx, x1 - ax) && clip(-dz, az - z0) && clip(dz, z1 - az) && t0 <= t1 + EPS;
}

/** Splits a convex polygon by the line through a segment; pieces with area ≈ 0 are dropped. */
function splitConvex(P, [ax, az, bx, bz]) {
  const dx = bx - ax, dz = bz - az;
  const L = Math.hypot(dx, dz);
  const side = P.map(([x, z]) => (dx * (z - az) - dz * (x - ax)) / L);
  const tol = 1e-9;
  if (side.every((s) => s >= -tol) || side.every((s) => s <= tol)) return [P];
  const A = [], B = [];
  for (let i = 0; i < P.length; i++) {
    const p = P[i], q = P[(i + 1) % P.length];
    const sp = side[i], sq = side[(i + 1) % P.length];
    if (sp >= -tol) A.push(p);
    if (sp <= tol) B.push(p);
    if ((sp > tol && sq < -tol) || (sp < -tol && sq > tol)) {
      const t = sp / (sp - sq);
      const r = [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
      // exact on an axis-aligned edge (the cell's sides): keep the shared coordinate
      if (p[0] === q[0]) r[0] = p[0];
      if (p[1] === q[1]) r[1] = p[1];
      A.push(r);
      B.push(r);
    }
  }
  const clean = (Q) => Q.filter((p, i) => {
    const q = Q[(i + 1) % Q.length];
    return Math.abs(p[0] - q[0]) > 1e-12 || Math.abs(p[1] - q[1]) > 1e-12;
  });
  return [clean(A), clean(B)].filter((Q) => Q.length >= 3 && Math.abs(signedArea(Q)) > 1e-10);
}
