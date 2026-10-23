/**
 * FIREPLACE GEOMETRY – the fireplaces and stoves of the house format (notes/peis-og-ovn.md), without three.js:
 * layout.js, the builder (home/fireplace.js) and the validator (data/scripts/house.mjs) read the same model.
 *
 *   resolveFireplaces(raw, { levels, rooms, walls, chimneys, ceilingAt }) → { fireplaces, seats, issues }
 *
 * A fireplace stands on the floor of its room, against a wall, in a corner or free, and its flue goes into one of the
 * house's chimneys (spec.chimneys, notes/tak.md «Piper»): a steel chimney goes straight up from the stove's outlet (its
 * `at` is the outlet's), a masonry chimney stands behind an open fireplace or an insert (inside the surround, from the
 * lowest floor under it) or behind a stove, which reaches it with a flue pipe. `seats` tells resolveChimneys
 * (chimneygeom.js) where each chimney stands and where it starts, so a chimney is given once, in chimneys[].
 * Plan points are [x, z]; heights are world y. The local frame of a fireplace: x across (`side`), z out of its front
 * (`facing`), y up from its floor.
 */
import { inPolygon } from './chimneygeom.js';

export const FIREPLACE_TYPES = Object.freeze(['stove', 'fireplace-stove', 'insert', 'open']);
export const FIREPLACE_PLACEMENTS = Object.freeze(['wall', 'corner', 'free']);
export const STOVE_MATERIALS = Object.freeze(['steel', 'soapstone']);
export const SURROUND_KINDS = Object.freeze(['masonry', 'panel']);
export const SURROUND_MATERIALS = Object.freeze(['brick', 'render', 'stone']);
export const HEARTH_MATERIALS = Object.freeze(['glass', 'stone', 'steel']);
export const HEARTH_SHAPES = Object.freeze(['rect', 'round', 'quarter']);
/** The types with a surround (built against the wall, round their chimney); the others are stoves. */
const MASONRY_TYPES = new Set(['insert', 'open']);
/** Defaults of the format (notes/peis-og-ovn.md). */
export const FIREPLACE_DEFAULTS = Object.freeze({
  /** [width, depth, height]; a surround without a height goes up to the ceiling */
  size: Object.freeze({
    stove: Object.freeze({ box: [0.47, 0.42, 0.95], round: [0.5, 0.5, 1.05] }),
    'fireplace-stove': Object.freeze({ box: [0.6, 0.46, 1.4], round: [0.6, 0.6, 1.35] }),
    insert: Object.freeze([1.2, 0.6, null]),
    open: Object.freeze([1.3, 0.65, null]),
  }),
  color: Object.freeze({ steel: '#1d1e20', soapstone: '#6d706a' }),
  surround: Object.freeze({ insert: 'render', open: 'brick' }),
  surroundColor: Object.freeze({ brick: '#8a4b3c', render: '#ece9e3', stone: '#8d8a84', panel: '#f2f0eb' }),
  /** the firebox's opening in the surround: width, height, sill over the floor, depth into the surround */
  opening: Object.freeze({
    insert: Object.freeze({ width: 0.68, height: 0.5, sill: 0.45, depth: 0.42 }),
    open: Object.freeze({ width: 0.8, height: 0.62, sill: 0.3, depth: 0.45 }),
  }),
  hearth: Object.freeze({
    material: Object.freeze({ stove: 'glass', 'fireplace-stove': 'glass', insert: 'stone', open: 'stone' }),
    front: Object.freeze({ stove: 0.3, 'fireplace-stove': 0.3, insert: 0.3, open: 0.5 }),
    side: Object.freeze({ stove: 0.1, 'fireplace-stove': 0.1, insert: 0.1, open: 0.3 }),
    thickness: Object.freeze({ glass: 0.008, stone: 0.03, steel: 0.003 }),
    color: Object.freeze({ glass: '#c9d6cf', stone: '#3a3b3d', steel: '#1d1e20' }),
  }),
  /** from the wall to a stove's back (insert and open stand against it) */
  gap: Object.freeze({ stove: 0.1, 'fireplace-stove': 0.1, insert: 0, open: 0 }),
  /** from a masonry chimney's face to the back of a stove that stands in front of it (its flue pipe goes in) */
  flueGap: 0.25,
  /** the flue outlet (Ø150) and how far over it the flue pipe bends into a masonry chimney */
  outletRadius: 0.075,
  bendOver: 0.35,
  /** a wall this close to a fireplace's footprint (beyond its gap) is one it stands against */
  nearWall: 0.6,
  /** the light of the fire (notes/lighting.md): lumens and colour temperature */
  fire: Object.freeze({ lumens: Object.freeze({ stove: 250, 'fireplace-stove': 350, insert: 350, open: 500 }), colorK: 1900 }),
  /** the mantel shelf of an open fireplace: over the opening, thickness, depth out of the front */
  mantel: Object.freeze({ over: 0.28, thickness: 0.06, depth: 0.2, color: '#5b5550' }),
});

const num = (v) => typeof v === 'number' && Number.isFinite(v);
const isPt = (p) => Array.isArray(p) && p.length === 2 && p.every(num);
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
const mul = (a, s) => [a[0] * s, a[1] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
const len = (a) => Math.hypot(a[0], a[1]);
const unit = (a) => {
  const l = len(a);
  return l > 1e-9 ? [a[0] / l, a[1] / l] : null;
};
const r6 = (v) => Math.round(v * 1e6) / 1e6;
const pt6 = (p) => [r6(p[0]), r6(p[1])];

/** The corners of a footprint (centre c, across `side`, out of the front `facing`): back-left, back-right, front-right, front-left. */
export function footprintCorners(c, side, facing, w, d) {
  const s = mul(side, w / 2), f = mul(facing, d / 2);
  return [sub(sub(c, s), f), sub(add(c, s), f), add(add(c, s), f), add(sub(c, s), f)];
}

/** A plan point from a fireplace's local frame (x across, z out of its front). */
export function localToPlan(fp, x, z) {
  return [fp.at[0] + fp.side[0] * x + fp.facing[0] * z, fp.at[1] + fp.side[1] * x + fp.facing[1] * z];
}

/** The polygon clipped to the half-plane in front of a wall face (dot(p − a, n) ≥ 0). */
function clipFront(P, a, n) {
  const out = [];
  for (let i = 0; i < P.length; i++) {
    const p = P[i], q = P[(i + 1) % P.length];
    const dp = dot(sub(p, a), n), dq = dot(sub(q, a), n);
    if (dp >= -1e-9) out.push(p);
    if ((dp > 1e-9 && dq < -1e-9) || (dp < -1e-9 && dq > 1e-9)) {
      const t = dp / (dp - dq);
      out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
    }
  }
  return out;
}

/** The intersection of two lines (point a + t·da); null when parallel. */
function meet(a, da, b, db) {
  const den = da[0] * db[1] - da[1] * db[0];
  if (Math.abs(den) < 1e-9) return null;
  const t = ((b[0] - a[0]) * db[1] - (b[1] - a[1]) * db[0]) / den;
  return [a[0] + da[0] * t, a[1] + da[1] * t];
}

/** The middle of a polygon's vertices. */
function centroid(P) {
  let x = 0, z = 0;
  for (const p of P) {
    x += p[0];
    z += p[1];
  }
  return [x / P.length, z / P.length];
}

/** The four corners of an axis-aligned chimney. */
const chimneyCorners = (c, [cw, cd]) => [[c[0] - cw / 2, c[1] - cd / 2], [c[0] + cw / 2, c[1] - cd / 2], [c[0] + cw / 2, c[1] + cd / 2], [c[0] - cw / 2, c[1] + cd / 2]];
/** How far an axis-aligned chimney reaches along a direction from its middle. */
const chimneyReach = (n, [cw, cd]) => (Math.abs(n[0]) * cw + Math.abs(n[1]) * cd) / 2;

/** The face of an axis-aligned chimney toward a point: { n (outward), mid }. */
function chimneyFace(cAt, size, toward) {
  let best = null;
  for (const n of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const s = dot(sub(toward, cAt), n);
    if (!best || s > best.s) best = { n, s, mid: add(cAt, mul(n, chimneyReach(n, size))) };
  }
  return best;
}

/**
 * The fireplaces of a house with every default filled in, and where they put their chimneys.
 * @param {object[]} raw  spec.fireplaces (house format, notes/peis-og-ovn.md)
 * @param {{ levels: Array<{ id, floorY, ceilingDefault? }>, rooms: Array<{ id, levelId, floorY, polygon: [x, z][] }>,
 *           walls: Array<{ id, roomId, levelId, start: [x, z], end: [x, z], normal: [x, z], thickness }>,
 *           chimneys: object[], ceilingAt?: (x, z, floorY) => number }} ctx
 *   walls: the room-side faces (normal into the room); chimneys: spec.chimneys as written; ceilingAt: the world y of
 *   the ceiling over a point of the room whose floor is floorY (without it: the level's ceilingDefault, else 2.4)
 * @returns {{ fireplaces: object[], seats: Object<string, object[]>, issues: Array<{ level: 'error'|'warn', where: string, msg: string }> }}
 *   seats[chimneyId]: [{ fireplaceId, mode, levelId, roomId, y, at }] – mode 'base': the chimney starts at y on levelId
 *   (a steel chimney on a stove), 'cut': its piece on levelId starts at y (a masonry chimney inside a surround up to y),
 *   'flue': a stove's flue pipe goes into it; `at`: where the chimney stands when the fireplace decides it, else null
 */
export function resolveFireplaces(raw, { levels = [], rooms = [], walls = [], chimneys = [], ceilingAt = null } = {}) {
  const issues = [];
  const fireplaces = [];
  const seats = {};
  if (raw == null) return { fireplaces, seats, issues };
  if (!Array.isArray(raw)) {
    issues.push({ level: 'error', where: 'fireplaces', msg: 'må være en liste' });
    return { fireplaces, seats, issues };
  }
  const D = FIREPLACE_DEFAULTS;
  const levelsById = Object.fromEntries(levels.map((l) => [l.id, l]));
  const mainLevel = levelsById.hoved ?? [...levels].sort((a, b) => a.floorY - b.floorY)[0] ?? null;
  const roomsOk = rooms.filter((r) => Array.isArray(r.polygon) && r.polygon.length >= 3);
  // the chimneys as written (with the ids resolveChimneys gives them)
  const chimneyById = new Map();
  (Array.isArray(chimneys) ? chimneys : []).forEach((c, i) => {
    if (c && typeof c === 'object') chimneyById.set(c.id ?? `pipe-${i + 1}`, c);
  });
  const ids = new Set();
  const steelTaken = new Map();

  raw.forEach((f, i) => {
    const where = `fireplaces/${f?.id ?? i}`;
    const err = (msg) => issues.push({ level: 'error', where, msg });
    const warn = (msg) => issues.push({ level: 'warn', where, msg });
    if (!f || typeof f !== 'object') return err('må være et objekt');
    const id = f.id ?? `peis-${i + 1}`;
    if (ids.has(id)) return err('id-en er brukt av et annet ildsted');
    ids.add(id);
    const type = f.type ?? 'stove';
    if (!FIREPLACE_TYPES.includes(type)) return err(`type «${type}» er ikke en av ${FIREPLACE_TYPES.join(', ')}`);
    const masonry = MASONRY_TYPES.has(type);
    if (f.at != null && !isPt(f.at)) return err('at må være [x, z] (midten av ildstedet i plan)');
    if (f.placement != null && !FIREPLACE_PLACEMENTS.includes(f.placement)) return err(`placement «${f.placement}» er ikke en av ${FIREPLACE_PLACEMENTS.join(', ')}`);
    if (f.facing != null && !(isPt(f.facing) && unit(f.facing))) return err('facing må være [x, z] (retningen fronten vender mot)');
    for (const k of ['gap', 'offset']) if (f[k] != null && !num(f[k])) return err(`${k} må være et tall (m)`);
    if (num(f.gap) && (f.gap < 0 || f.gap > 2)) return err('gap må være 0–2 m');

    // ---- the chimney it goes into
    const chimneyId = f.chimney ?? null;
    let ch = null, chMat = null, chSize = null;
    if (chimneyId != null) {
      ch = chimneyById.get(chimneyId);
      if (!ch) return err(`pipa «${chimneyId}» finnes ikke i chimneys`);
      chMat = ch.material ?? 'brick';
      chSize = Array.isArray(ch.size) && ch.size.length === 2 && ch.size.every(num) ? ch.size : chMat === 'steel' ? [0.2, 0.2] : [0.5, 0.5];
      if (chMat === 'steel') chSize = [Math.min(...chSize), Math.min(...chSize)];
      if (ch.from === 'roof') return err(`pipa «${chimneyId}» begynner i taket (from: 'roof') – et ildsted trenger en pipe fra gulvet`);
      if (chMat === 'steel') {
        if (steelTaken.has(chimneyId)) return err(`stålpipa «${chimneyId}» har allerede et ildsted (${steelTaken.get(chimneyId)})`);
        steelTaken.set(chimneyId, id);
      }
    } else warn('ildstedet har ingen pipe (chimney) – røyken må ut et sted');
    const steel = chMat === 'steel';
    const chAt = ch && isPt(ch.at) ? [...ch.at] : null;

    // ---- size, shape, material
    const shape = f.shape ?? 'box';
    if (!['box', 'round'].includes(shape)) return err(`shape «${shape}» er ikke box eller round`);
    if (masonry && f.shape != null) warn('shape gjelder bare ovner (stove, fireplace-stove)');
    const defSize = masonry ? D.size[type] : D.size[type][shape];
    const size = [...defSize];
    if (f.size != null) {
      if (!(Array.isArray(f.size) && (f.size.length === 2 || f.size.length === 3) && f.size.every((v) => v == null || num(v)))) return err('size må være [bredde, dybde, høyde] i meter (høyden kan utelates)');
      f.size.forEach((v, k) => v != null && (size[k] = v));
    }
    if (shape === 'round' && !masonry) size[0] = size[1] = Math.min(size[0], size[1]);
    if (!(size[0] >= 0.2 && size[0] <= 4 && size[1] >= 0.2 && size[1] <= 2)) return err('size: bredden må være 0,2–4 m og dybden 0,2–2 m');
    if (size[2] != null && !(size[2] >= 0.3 && size[2] <= 6)) return err('size: høyden må være 0,3–6 m');
    if (!masonry && size[2] == null) size[2] = defSize[2];
    const material = f.material ?? 'steel';
    if (!masonry && !STOVE_MATERIALS.includes(material)) return err(`material «${material}» er ikke en av ${STOVE_MATERIALS.join(', ')}`);
    const [w, d] = size;
    const gap = num(f.gap) ? f.gap : D.gap[type];

    // ---- the surround and its opening (insert, open)
    let surround = null, opening = null, mantel = null;
    if (masonry) {
      const s = f.surround ?? {};
      if (typeof s !== 'object') return err('surround må være et objekt { kind, material, color }');
      const kind = s.kind ?? 'masonry';
      if (!SURROUND_KINDS.includes(kind)) return err(`surround.kind «${kind}» er ikke en av ${SURROUND_KINDS.join(', ')}`);
      const smat = kind === 'panel' ? 'panel' : s.material ?? D.surround[type];
      if (kind === 'masonry' && !SURROUND_MATERIALS.includes(smat)) return err(`surround.material «${smat}» er ikke en av ${SURROUND_MATERIALS.join(', ')}`);
      surround = { kind, material: smat, color: s.color ?? D.surroundColor[smat] };
      const o = { ...D.opening[type], ...(f.opening || {}) };
      if (!['width', 'height', 'sill', 'depth'].every((k) => num(o[k]) && o[k] >= 0)) return err('opening må ha width, height, sill og depth i meter');
      if (o.width < 0.3 || o.height < 0.25 || o.depth < 0.2) return err('opening er for liten (minst 0,3 bred, 0,25 høy og 0,2 dyp)');
      if (o.width > w - 0.1) return err(`åpningen (${o.width} m) får ikke plass i omrammingen (${w} m bred)`);
      if (o.depth > d - 0.05) return err(`åpningen er dypere (${o.depth} m) enn omrammingen (${d} m)`);
      opening = o;
      if (type === 'open' && f.mantel !== false) {
        const m = { ...D.mantel, ...(typeof f.mantel === 'object' ? f.mantel : {}) };
        mantel = { y: o.sill + o.height + m.over, thickness: m.thickness, depth: m.depth, color: m.color };
      }
    } else if (f.surround != null) warn('surround gjelder bare innsats og åpen peis (insert, open)');

    // ---- the level and the room
    let room = null, level = null;
    if (f.roomId != null) {
      room = roomsOk.find((r) => r.id === f.roomId);
      if (!room) return err(`rommet «${f.roomId}» finnes ikke`);
      level = levelsById[room.levelId] ?? null;
    }
    if (f.levelId != null) {
      if (!levelsById[f.levelId]) return err(`nivået «${f.levelId}» finnes ikke`);
      if (room && room.levelId !== f.levelId) return err(`rommet «${room.id}» er ikke på «${f.levelId}»`);
      level = levelsById[f.levelId];
    }
    const roomAt = (p, lv) => {
      const list = roomsOk.filter((r) => inPolygon(p[0], p[1], r.polygon) && (!lv || r.levelId === lv.id));
      if (!list.length) return null;
      // without a level: the main level's room, else the lowest
      return list.find((r) => r.levelId === mainLevel?.id) ?? list.sort((a, b) => a.floorY - b.floorY)[0];
    };
    const wall = f.wall != null ? walls.find((x) => x.id === f.wall) : null;
    if (f.wall != null && !wall) return err(`veggen «${f.wall}» finnes ikke`);
    if (wall && room && wall.roomId !== room.id) return err(`veggen «${wall.id}» er ikke i rommet «${room.id}»`);
    if (wall && !room) {
      room = roomsOk.find((r) => r.id === wall.roomId) ?? null;
      level = room ? levelsById[room.levelId] : level;
    }

    // ---- where: `at`, a point on a wall, in front of its masonry chimney, or under its steel chimney
    let at = f.at ? [...f.at] : null;
    let facing = f.facing ? unit(f.facing) : null;
    let underSteel = false;
    let inFront = false;
    if (!at && wall) {
      const dir = unit(sub(wall.end, wall.start));
      const L = len(sub(wall.end, wall.start));
      const off = num(f.offset) ? f.offset : L / 2;
      if (off < 0 || off > L) return err(`offset ${off} er utenfor veggen «${wall.id}» (0–${L.toFixed(2)})`);
      at = add(add(wall.start, mul(dir, off)), mul(wall.normal, gap + d / 2));
      facing ??= [...wall.normal];
    }
    if (!at && chAt && !steel) {
      // in front of the masonry chimney, on its face toward the room (away from a wall it stands against)
      const r0 = room ?? roomAt(chAt, level);
      if (!r0) return err('pipa står ikke i et rom på ildstedets etasje – gi ildstedet at');
      let toward = centroid(r0.polygon);
      for (const wl of walls.filter((x) => x.roomId === r0.id)) {
        const dir = unit(sub(wl.end, wl.start));
        if (!dir) continue;
        const dist = dot(sub(chAt, wl.start), wl.normal) - chimneyReach(wl.normal, chSize);
        const u = dot(sub(chAt, wl.start), dir);
        if (Math.abs(dist) < 0.05 && u > 0 && u < len(sub(wl.end, wl.start))) toward = add(chAt, wl.normal);
      }
      const face = chimneyFace(chAt, chSize, toward);
      facing ??= [...face.n];
      // a surround round the chimney (its back flush with the chimney's back), a stove flueGap in front of it
      at = masonry ? add(chAt, mul(facing, d / 2 - chimneyReach(facing, chSize))) : add(face.mid, mul(facing, D.flueGap + d / 2));
      room ??= r0;
      inFront = true;
    }
    if (!at && chAt && steel) {
      at = [...chAt];
      underSteel = true;
    }
    if (!at) return err('gi at (midten av ildstedet i plan), wall, eller en pipe med at som ildstedet står ved');
    if (!room) room = roomAt(at, level);
    if (!room) return err(`ildstedet (${at.map((v) => v.toFixed(2)).join(', ')}) står ikke i et rom${level ? ` på «${level.id}»` : ''}`);
    if (!inPolygon(at[0], at[1], room.polygon)) return err(`ildstedet (${at.map((v) => v.toFixed(2)).join(', ')}) står ikke i rommet «${room.id}»`);
    level = levelsById[room.levelId] ?? level;
    const floorY = room.floorY;

    // ---- the walls round it, the way it faces and what it stands against
    const roomWalls = walls.filter((x) => x.roomId === room.id && len(sub(x.end, x.start)) > 1e-6);
    const reach = Math.max(w, d) / 2 + D.nearWall + gap;
    const near = [];
    for (const wl of roomWalls) {
      const dir = unit(sub(wl.end, wl.start));
      const L = len(sub(wl.end, wl.start));
      const u = dot(sub(at, wl.start), dir);
      const dist = dot(sub(at, wl.start), wl.normal);
      if (dist < -0.05 || dist > reach || u < -Math.max(w, d) / 2 || u > L + Math.max(w, d) / 2) continue;
      near.push({ wl, dir, L, dist });
    }
    near.sort((a, b) => a.dist - b.dist);
    let corner = null;
    for (let a = 0; a < near.length && !corner; a++) {
      for (let b = a + 1; b < near.length; b++) {
        if (Math.abs(dot(near[a].wl.normal, near[b].wl.normal)) < 0.3) {
          corner = [near[a], near[b]];
          break;
        }
      }
    }
    if (!facing && chAt && !steel && f.at) facing = [...chimneyFace(chAt, chSize, at).n];
    let placement = f.placement ?? null;
    if (!placement) {
      if (wall) placement = 'wall';
      else if (facing) {
        const diagonal = Math.abs(facing[0]) > 0.5 && Math.abs(facing[1]) > 0.5;
        placement = corner && diagonal ? 'corner' : near.some((x) => dot(x.wl.normal, facing) > 0.9) ? 'wall' : 'free';
      } else placement = corner ? 'corner' : near.length ? 'wall' : 'free';
    }
    if (placement === 'corner' && !corner) return err('placement «corner», men ingen to vegger møtes ved ildstedet');
    if (placement === 'wall' && !near.length && !wall) return err('placement «wall», men ingen vegg står ved ildstedet');
    if (!facing) {
      if (placement === 'corner') facing = unit(add(corner[0].wl.normal, corner[1].wl.normal));
      else if (placement === 'wall') facing = [...near[0].wl.normal];
      else facing = unit(sub(centroid(room.polygon), at)) ?? [0, 1];
    }
    const against = placement === 'corner' ? corner : placement === 'wall'
      ? (wall ? [{ wl: wall }] : near.filter((x) => dot(x.wl.normal, facing) > 0.9).slice(0, 1))
      : [];
    if (placement === 'wall' && !against.length) return err('placement «wall», men fronten vender ikke ut fra veggen ved den (sjekk facing)');
    const side = [facing[1], -facing[0]];
    const frame = () => ({ at, side, facing });
    // the corner it stands in (where the two walls' faces meet)
    const cornerAt = placement === 'corner' ? meet(corner[0].wl.start, corner[0].dir, corner[1].wl.start, corner[1].dir) : null;
    if (placement === 'corner' && !cornerAt) return err('hjørnet til ildstedet er ikke et hjørne (veggene er parallelle)');
    // where the flue leaves (local, its height above the base): a stove's top behind its middle, its back, the
    // middle of a surround's top
    const outletKind = f.outlet ?? 'top';
    if (!['top', 'back'].includes(outletKind)) return err(`outlet «${outletKind}» er ikke top eller back`);
    const back = outletKind === 'back' && !masonry && !!ch && !steel;
    if (outletKind === 'back' && !back) warn('outlet: back gjelder bare en ovn foran en murt pipe');
    const outZ = masonry ? 0 : back ? -d / 2 : shape === 'round' ? 0 : -d / 2 + Math.min(0.14, d / 2);
    // under a steel chimney: the outlet under it
    if (underSteel) at = sub(at, mul(facing, outZ));

    // ---- fit it: its back `gap` from the walls it stands against (a surround flush), never into a wall
    let moved = 0;
    for (let it = 0; it < 3; it++) {
      for (const { wl, dir, L } of near) {
        const on = footprintCorners(at, side, facing, w, d).filter((q) => {
          const u = dot(sub(q, wl.start), dir);
          return u > 0.01 && u < L - 0.01;
        });
        if (!on.length) continue;
        const m = Math.min(...on.map((q) => dot(sub(q, wl.start), wl.normal)));
        const isBack = against.some((x) => x.wl.id === wl.id);
        const want = isBack ? gap : 0;
        // a surround stands flush against its wall; a stove keeps the distance it was drawn at (at least its gap)
        const shift = isBack && masonry ? want - m : Math.max(0, want - m);
        if (Math.abs(shift) > 1e-6) {
          at = add(at, mul(wl.normal, shift));
          moved = Math.max(moved, Math.abs(shift));
        }
      }
    }
    if (moved > 0.3 && f.at) warn(`ildstedet er flyttet ${moved.toFixed(2)} m for å stå inntil veggen – sjekk at`);

    // ---- a stove in front of a masonry chimney without `at`: the chimney against the wall behind it
    let cAt = chAt;
    if (ch && !steel && !masonry && !cAt) {
      if (!against.length) return err(`pipa «${chimneyId}» har ingen at, og ovnen står ikke inntil en vegg – gi pipa at`);
      const { wl } = against[0];
      const dir = unit(sub(wl.end, wl.start));
      const u = dot(sub(at, wl.start), dir);
      cAt = add(add(wl.start, mul(dir, u)), mul(wl.normal, chimneyReach(wl.normal, chSize)));
      // the stove then stands (at least) flueGap in front of it
      const ahead = dot(sub(at, cAt), wl.normal) - chimneyReach(wl.normal, chSize) - d / 2;
      if (ahead < D.flueGap - 1e-6) at = add(at, mul(wl.normal, D.flueGap - ahead));
    }

    // ---- heights: a surround without a height goes up to the ceiling
    const ceilY = (p) => (ceilingAt ? ceilingAt(p[0], p[1], floorY) : floorY + (level?.ceilingDefault ?? 2.4));
    const corners = footprintCorners(at, side, facing, w, d);
    const ceil = Math.min(...corners.map(ceilY), ceilY(at));
    let h = size[2];
    if (h == null) h = Math.round((ceil - floorY) * 1e4) / 1e4;
    else if (floorY + h > ceil + 1e-6) {
      warn(`ildstedet (${h} m) er høyere enn taket over det (${(ceil - floorY).toFixed(2)} m) – det kuttes`);
      h = ceil - floorY;
    }
    if (opening && opening.sill + opening.height > h - 0.1) return err(`åpningen (opp til ${(opening.sill + opening.height).toFixed(2)} m) får ikke plass i omrammingen (${h.toFixed(2)} m høy)`);
    if (mantel && mantel.y + mantel.thickness > h - 0.02) mantel = null;
    if (corners.some((q) => !inPolygon(q[0], q[1], room.polygon))) warn(`ildstedet når utenfor rommet «${room.id}»`);

    // ---- the hearth plate in front (and under a stove): glass, stone or steel
    let hearth = null;
    if (f.hearth !== false) {
      const hs = f.hearth && typeof f.hearth === 'object' ? f.hearth : {};
      const hm = hs.material ?? D.hearth.material[type];
      if (!HEARTH_MATERIALS.includes(hm)) return err(`hearth.material «${hm}» er ikke en av ${HEARTH_MATERIALS.join(', ')}`);
      const hShape = masonry ? 'rect' : hs.shape ?? (placement === 'corner' ? 'quarter' : placement === 'free' && shape === 'round' ? 'round' : 'rect');
      if (!HEARTH_SHAPES.includes(hShape)) return err(`hearth.shape «${hShape}» er ikke en av ${HEARTH_SHAPES.join(', ')}`);
      if (hShape === 'quarter' && placement !== 'corner') return err("hearth.shape «quarter» passer bare i et hjørne (placement: 'corner')");
      if (masonry && hs.shape != null && hs.shape !== 'rect') warn('hearth.shape: foran en peis er platen alltid rektangulær');
      const front = num(hs.front) ? hs.front : D.hearth.front[type];
      const hside = num(hs.side) ? hs.side : D.hearth.side[type];
      if (hs.size != null && !(Array.isArray(hs.size) && hs.size.length === 2 && hs.size.every((v) => num(v) && v > 0.1 && v < 6))) return err('hearth.size må være [bredde, dybde] i meter');
      const thickness = num(hs.thickness) ? hs.thickness : D.hearth.thickness[hm];
      if (!(thickness > 0 && thickness <= 0.1)) return err('hearth.thickness må være over 0 og høyst 0,1 m');
      const L = (x, z) => localToPlan(frame(), x, z);
      // the distance from the stove's back to what it stands against (the plate reaches it)
      const backTo = against.length ? Math.min(...against.map(({ wl }) => Math.min(...footprintCorners(at, side, facing, w, d).map((q) => dot(sub(q, wl.start), wl.normal))))) : Infinity;
      let P;
      if (masonry) {
        // in front of the surround, over its width (at least the opening and its sides)
        const hw = hs.size ? hs.size[0] / 2 : Math.max(w, opening.width + 2 * hside) / 2;
        const hd = hs.size ? hs.size[1] : front;
        P = [L(-hw, d / 2), L(hw, d / 2), L(hw, d / 2 + hd), L(-hw, d / 2 + hd)];
      } else if (hShape === 'rect') {
        // back to the wall it stands against, or to the masonry chimney behind it
        const toChimney = ch && !steel && cAt ? dot(sub(at, cAt), facing) - chimneyReach(facing, chSize) - d / 2 : Infinity;
        const reachBack = Math.min(backTo, toChimney >= -1e-6 ? toChimney : Infinity);
        const b = reachBack < 0.4 ? -d / 2 - Math.max(0, reachBack) : -d / 2 - 0.05;
        const hw = hs.size ? hs.size[0] / 2 : w / 2 + hside;
        const z1 = hs.size ? b + hs.size[1] : d / 2 + front;
        P = [L(-hw, b), L(hw, b), L(hw, z1), L(-hw, z1)];
      } else if (hShape === 'round') {
        const R = hs.size ? Math.max(...hs.size) / 2 : Math.max(w, d) / 2 + (front + hside) / 2;
        const cz = hs.size ? 0 : (front - hside) / 2;
        P = [];
        for (let k = 0; k < 40; k++) {
          const a = (2 * Math.PI * k) / 40;
          P.push(L(R * Math.sin(a), cz + R * Math.cos(a)));
        }
      } else {
        // a quarter disc from the corner, out past the stove's front
        const [A, B] = corner;
        const C = cornerAt;
        const fr = [L(-w / 2, d / 2), L(w / 2, d / 2)];
        const R = hs.size ? Math.max(...hs.size) : Math.max(...fr.map((q) => len(sub(q, C)))) + front;
        // from along the first wall (the second's normal) to along the second (the first's normal)
        P = [C];
        for (let k = 0; k <= 16; k++) {
          const a = (Math.PI / 2) * (k / 16);
          P.push(add(C, add(mul(B.wl.normal, R * Math.cos(a)), mul(A.wl.normal, R * Math.sin(a)))));
        }
      }
      // never into a wall
      for (const { wl } of near) P = clipFront(P, wl.start, wl.normal);
      if (P.length >= 3) {
        // clockwise in plan seen from above (x right, z down the page): the builder's top faces up
        let A2 = 0;
        for (let k = 0; k < P.length; k++) A2 += P[k][0] * P[(k + 1) % P.length][1] - P[(k + 1) % P.length][0] * P[k][1];
        if (A2 < 0) P.reverse();
        hearth = { material: hm, shape: hShape, color: hs.color ?? D.hearth.color[hm], thickness, polygon: P.map(pt6), under: !masonry, front, side: hside };
      }
    }
    const baseY = floorY + (hearth?.under ? hearth.thickness : 0);

    // ---- the window of a stove's firebox, the log store under a fireplace stove, the outlet
    let window = null, logStore = null;
    if (!masonry) {
      if (type === 'stove') window = { width: shape === 'round' ? Math.min(0.36, w * 0.68) : w - 0.14, sill: 0.3, height: Math.min(0.42, h - 0.45) };
      else {
        logStore = f.logStore === false ? null : { y0: 0.05, y1: 0.32 };
        window = { width: shape === 'round' ? Math.min(0.42, w * 0.7) : w - 0.12, sill: logStore ? 0.42 : 0.3, height: Math.min(0.62, h - 0.75) };
      }
      if (window.height < 0.15) return err(`ovnen er for lav (${h} m) for en brennkammerdør`);
    }
    const outY = masonry ? floorY + h : baseY + (back ? h - 0.2 : h);
    const outPlan = localToPlan(frame(), 0, outZ);
    const outlet = { kind: back ? 'back' : 'top', at: [r6(outPlan[0]), r6(outY), r6(outPlan[1])], radius: steel ? chSize[0] / 2 : D.outletRadius };

    // ---- the chimney: where it stands and from where (seats); a stove's flue pipe into a masonry chimney
    let flue = null;
    if (ch) {
      const seat = { fireplaceId: id, levelId: room.levelId, roomId: room.id, at: null, mode: 'flue', y: outY };
      if (steel) {
        // straight up from the outlet (on a surround: up from its top)
        seat.mode = 'base';
        seat.at = pt6(outPlan);
        if (chAt) {
          const off = len(sub(chAt, outPlan));
          if (off > 0.5) return err(`stålpipa «${chimneyId}» står ${off.toFixed(2)} m fra røykstussen – utelat pipas at, eller flytt ildstedet under den`);
          if (off > 0.02) warn(`stålpipa «${chimneyId}» er flyttet ${off.toFixed(2)} m til røykstussen`);
        }
        cAt = seat.at;
      } else if (masonry) {
        // inside the surround at its back, from the lowest floor; its piece here starts at the surround's top
        seat.mode = 'cut';
        if (!chAt) {
          cAt = localToPlan(frame(), 0, -d / 2 + chimneyReach(facing, chSize));
          seat.at = pt6(cAt);
        } else {
          const local = chimneyCorners(chAt, chSize).map((q) => [dot(sub(q, at), side), dot(sub(q, at), facing)]);
          const inside = local.every(([x, z]) => Math.abs(x) <= w / 2 + 0.02 && Math.abs(z) <= d / 2 + 0.02);
          if (!inside) warn(`pipa «${chimneyId}» står ikke inne i omrammingen – den bygges ved siden av peisen`);
          else if (Math.max(...local.map(([, z]) => z)) > d / 2 - opening.depth + 1e-6) warn(`pipa «${chimneyId}» går inn i brennkammeret – gjør omrammingen dypere`);
        }
      } else {
        if (!chAt) seat.at = pt6(cAt);
        flue = stoveFlue(outPlan, outY, back, cAt, chSize, D.outletRadius, ceil);
        if (!flue) return err(`røykrøret når ikke pipa «${chimneyId}» (den står ikke bak eller ved siden av ovnen)`);
        if (flue.length > 1.6) warn(`røykrøret til pipa «${chimneyId}» er ${flue.length.toFixed(2)} m langt`);
      }
      (seats[chimneyId] ||= []).push(seat);
    }

    // ---- the fire: its light out of the window / opening, a little down (the glow lies on the floor in front)
    let fire = null;
    if (f.fire !== false) {
      const fs = f.fire && typeof f.fire === 'object' ? f.fire : {};
      const lumens = num(fs.lumens) ? fs.lumens : D.fire.lumens[type];
      const colorK = num(fs.colorK) ? fs.colorK : D.fire.colorK;
      if (lumens < 0 || lumens > 5000) return err('fire.lumens må være 0–5000');
      if (colorK < 1000 || colorK > 4000) return err('fire.colorK må være 1000–4000 K');
      const win = masonry ? opening : window;
      const front = shape === 'round' && !masonry ? w / 2 : d / 2;
      const ly = (masonry ? floorY : baseY) + win.sill + win.height * 0.42;
      const lp = localToPlan(frame(), 0, front + 0.12);
      const tilt = 0.26;
      fire = {
        lumens, colorK, on: fs.on !== false,
        position: [r6(lp[0]), r6(ly), r6(lp[1])],
        direction: [r6(facing[0] * Math.cos(tilt)), r6(-Math.sin(tilt)), r6(facing[1] * Math.cos(tilt))],
      };
    }

    fireplaces.push({
      id,
      name: f.name ?? '',
      index: i,
      type,
      masonry,
      roomId: room.id,
      levelId: room.levelId,
      floorY,
      baseY,
      placement,
      wallIds: against.map(({ wl }) => wl.id),
      cornerAt: cornerAt ? pt6(cornerAt) : null,
      inFront,
      at: pt6(at),
      facing: pt6(facing),
      side: pt6(side),
      yaw: Math.atan2(facing[0], facing[1]),
      size: [w, d, h],
      shape: masonry ? 'box' : shape,
      material: masonry ? null : material,
      color: masonry ? null : f.color ?? D.color[material],
      surround,
      opening,
      mantel,
      window,
      logStore,
      hearth,
      outlet,
      chimneyId,
      chimneyMaterial: chMat,
      chimneyAt: cAt ? pt6(cAt) : null,
      flue,
      fire,
      lightGroup: `fire-${id}`,
      footprint: footprintCorners(at, side, facing, w, d).map(pt6),
      source: f.source ?? '',
    });
  });
  return { fireplaces, seats, issues };
}

/**
 * The flue pipe from a stove to the face of a masonry chimney: up from a top outlet to bendOver over it, then level into
 * the chimney (a back outlet: level from the start). Points are world [x, y, z]; null when the chimney's face toward
 * the outlet is not in front of it.
 */
function stoveFlue(outPlan, outY, back, cAt, chSize, r, ceilY) {
  const [cw, cd] = chSize;
  // the face of the chimney toward the outlet
  const dx = outPlan[0] - cAt[0], dz = outPlan[1] - cAt[1];
  const alongX = Math.abs(dx) / cw >= Math.abs(dz) / cd;
  const n = alongX ? [Math.sign(dx) || 1, 0] : [0, Math.sign(dz) || 1];
  const half = alongX ? cw / 2 : cd / 2;
  const span = alongX ? cd / 2 : cw / 2;
  // the entry: the outlet's point straight across onto that face, kept r inside its edges
  const lat = alongX ? outPlan[1] - cAt[1] : outPlan[0] - cAt[0];
  const latC = Math.max(-span + r + 0.02, Math.min(span - r - 0.02, lat));
  const entry = alongX ? [cAt[0] + n[0] * half, cAt[1] + latC] : [cAt[0] + latC, cAt[1] + n[1] * half];
  if (dot(sub(outPlan, entry), n) < r) return null;
  const y = back ? outY : Math.min(outY + FIREPLACE_DEFAULTS.bendOver, ceilY - 0.25);
  if (y < outY - 1e-6) return null;
  const points = back
    ? [[outPlan[0], y, outPlan[1]], [entry[0], y, entry[1]]]
    : [[outPlan[0], outY, outPlan[1]], [outPlan[0], y, outPlan[1]], [entry[0], y, entry[1]]];
  let length = 0;
  for (let k = 1; k < points.length; k++) length += Math.hypot(points[k][0] - points[k - 1][0], points[k][1] - points[k - 1][1], points[k][2] - points[k - 1][2]);
  return { radius: r, points: points.map((p) => p.map(r6)), entry: pt6(entry), normal: n, length };
}
