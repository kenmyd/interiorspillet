/**
 * Planbygger: the plan document → the house data the game uses (research/house/NN-*.json format, notes/hele-huset-
 * design.md §1, validated by validateHouse in src/data/scripts/house.mjs).
 *
 *   exportHouse(doc) → {
 *     house:    { $comment, levels, rooms, walls, ceilings, lightGroups, builtInLights, floorOpenings?, stairs? }
 *     registry: an 00-ids.json for this house (levels, rooms, light groups, pseudoRooms ['ute'], the game's schema)
 *     rooms:    per level the found rooms (regions.js) with their ids and names – for the editor
 *     report:   { warnings: [...], counts }
 *     frame:    { toGame(p, levelId) → [x, z], toPlan([x, z], levelId) → [x, y], north, origin }
 *   }
 *
 * How a room becomes walls (the room-spec rules, §1.1–1.3):
 *   • every room has its own wall loop, clockwise seen from above, the room on the right of from → to, the normal
 *     inward (−d.z, d.x); the loop follows the room polygon exactly (collinear points allowed);
 *   • the polygon edges lie on wall faces (regions.js): an edge whose wall has another room's face on its other side is
 *     cut where that room's edges begin and end, so the two sides are split alike; per shared piece one room owns the
 *     slab (thickness = the distance between the faces) and the other room's piece is `backOf` it (D13: no geometry of
 *     its own, exactly one thickness away);
 *   • an edge with nothing behind it is an exterior wall, thickness outward (at least settings.exteriorMin, never into
 *     another room, nor into the room itself: the end of a wall stub);
 *   • a wall with the same room on both sides (the room goes round it) is one inner slab of the distance between its
 *     faces, owned by one side; the other side is a wall of no thickness (the format has no backOf within one room);
 *   • an open room boundary – a separator between two zones of an open plan, or a cut that takes an island of rooms out
 *     of the room around it (regions.js levelRooms: the format's rooms are simple polygons) – has no wall: the format
 *     has no room edge without one, so the owner side is a wall of thickness 0 (rooms.js builds nothing for it) with
 *     one passage over its whole length and height, the portal between the two rooms, and the other side is backOf it;
 *   • each opening is defined once, on the owner piece (offset from `from`), doors with door:{ hinge, swing, opensInto,
 *     leaf … } and connects, passages as type 'opening'; double and sliding doors as the game's door types
 *     (door.variant 'double' | 'sliding', notes/dortyper.md). Skylights go on their room's ceiling entry
 *     (`skylights: [{ id, polygon }]`).
 * Coordinates: the plan is rotated so that game +x = south and +z = west (settings.north), then moved so that the main
 * level's rooms start at x = 0, z = 0.
 */
import idsRegistry from '../../research/house/00-ids.json';
import { levelRooms as roomsOfLevel, wallBand, footprint } from './regions.js';
import { sub, add, mul, dot, cross, dist, unit, perp, signedArea, centroid, slug, round, clipPolygon, pointInPolygon } from './geom.js';
import { DEFAULT_SETTINGS, wallLength, wallDir, stairGeometry } from './model.js';
import { ceilingSlope } from './houseread.js';
import { WALKABLE_NORMAL_Y } from '../config.js';

const RESERVED_IDS = new Set(['stue-kjokken', 'trapp', 'ute', 'forplass']);
const MAIN = 'hoved';
const EPS = 1e-6;
/** metres of wall between a room's corner and an opening drawn against it (export: the hole gets its own side) */
const JAMB = 0.05;
/** the narrowest door hole the player passes (radius 0.3, a 0.06 frame each side and the open leaf) */
const MIN_DOOR = 0.82;
/** metres of wall between two openings side by side (a door and its sidelight): a post, not a sliver */
const MIN_POST = 0.1;

/** The window types the facade check offers (doc opening.style), [style, Norwegian label]; no style = 'auto'. */
export const WINDOW_STYLES = Object.freeze([
  ['auto', 'Automatisk (etter bredden)'],
  ['one', 'Ett felt som kan åpnes'],
  ['fixed', 'Fast glass'],
  ['two', 'Todelt'],
  ['three', 'Tredelt'],
  ['transom', 'Med overlys'],
]);

/**
 * The sashes of a window (notes/vindusmodeller.md: fractions of the hole, from the left as seen from the room, and up
 * from the sill) for its style. 'auto' – what the drawings say nothing more about, until the facade round reads it: one
 * top-hung opening sash up to 0.8 m wide, a fixed and a side-hung one from 0.8 m, three from 1.4 m (fixed in the
 * middle), and a fixed panel under a transom 0.5 m up in a window that stands on the floor and is at least 1.8 m tall.
 * 'transom' puts a fixed band over the sashes the width gives (the top quarter, at most 0.45 m).
 */
export function windowSashes(style, width, height, sill) {
  const byWidth = (bottom, top) => {
    const row =
      width < 0.8
        ? [{ from: 0, to: 1, opening: true, hinge: 'top' }]
        : width < 1.4
          ? [{ from: 0, to: 0.5, opening: false }, { from: 0.5, to: 1, opening: true, hinge: 'right' }]
          : [{ from: 0, to: 0.3, opening: true, hinge: 'left' }, { from: 0.3, to: 0.7, opening: false }, { from: 0.7, to: 1, opening: true, hinge: 'right' }];
    return row.map((x) => ({ ...x, bottom, top }));
  };
  if (style === 'one') return [{ from: 0, to: 1, bottom: 0, top: 1, opening: true, hinge: 'top' }];
  if (style === 'fixed') return [{ from: 0, to: 1, bottom: 0, top: 1, opening: false }];
  if (style === 'two') return [{ from: 0, to: 0.5, bottom: 0, top: 1, opening: false }, { from: 0.5, to: 1, bottom: 0, top: 1, opening: true, hinge: 'right' }];
  if (style === 'three') return [{ from: 0, to: 0.3, bottom: 0, top: 1, opening: true, hinge: 'left' }, { from: 0.3, to: 0.7, bottom: 0, top: 1, opening: false }, { from: 0.7, to: 1, bottom: 0, top: 1, opening: true, hinge: 'right' }];
  if (style === 'transom') {
    const t = round(1 - Math.min(0.45, height / 4) / height, 3);
    return [...byWidth(0, t), { from: 0, to: 1, bottom: t, top: 1, opening: false }];
  }
  const transom = sill < 0.03 && height >= 1.8 ? round(0.5 / height, 3) : 0;
  const sashes = byWidth(transom, 1);
  return transom ? [{ from: 0, to: 1, bottom: 0, top: transom, opening: false }, ...sashes] : sashes;
}
/** the game's door unit is this much wider than its leaf (src/world/Door.js: 2 × (0.05 jamb − 0.012 overlap)) */
const DOOR_UNIT = 0.076;

/** Look of the generated house (white interior, oak floors – the customer repaints in the game). */
export const LOOK = Object.freeze({
  wall: '#ece9e3',
  wetWall: '#e4e2dd',
  ceiling: '#f3f2ef',
  door: '#f2f0eb',
  frame: '#f2f0eb',
  floor: { living: ['oak-plank', '#b8a48c'], bedroom: ['oak-plank', '#b8a48c'], hall: ['oak-plank', '#b0a089'], entrance: ['vinyl', '#7d7a78'], bathroom: ['vinyl', '#8c8789'], laundry: ['vinyl', '#8c8789'], storage: ['concrete', '#8a8580'] },
});

const KIND_NAMES = { living: 'Stue', bedroom: 'Soverom', bathroom: 'Bad', hall: 'Gang', laundry: 'Vaskerom', storage: 'Bod', entrance: 'Entré' };

/** The plan → game rotation for a north direction (degrees clockwise from up in the image). */
export function northFrame(northDeg = 0) {
  const t = (northDeg * Math.PI) / 180;
  const n = [Math.sin(t), -Math.cos(t)]; // north in the plan (y down)
  const south = [-n[0], -n[1]];
  const west = [n[1], -n[0]];
  return {
    rot: (p) => [dot(p, south), dot(p, west)],
    // inverse: p = x·south + z·west (an orthonormal basis)
    inv: (g) => add(mul(south, g[0]), mul(west, g[1])),
    south,
    west,
  };
}

/**
 * The coordinate frame of the house: plan point of a level → game (x, z) and back.
 * @param {object} doc
 * @param {object[]} found  per level the findRooms result (for the origin)
 */
export function houseFrame(doc, found) {
  const nf = northFrame(doc.settings?.north ?? 0);
  const offsetOf = (levelId) => doc.levels.find((l) => l.id === levelId)?.offset ?? [0, 0];
  const mainIdx = Math.max(0, doc.levels.findIndex((l) => l.id === MAIN));
  const mainRooms = found[mainIdx]?.rooms ?? [];
  const main = doc.levels[mainIdx];
  let origin = doc.settings?.origin ?? null;
  if (!origin) {
    const pts = mainRooms.flatMap((r) => r.polygon.map((p) => nf.rot(add(p, main?.offset ?? [0, 0]))));
    origin = pts.length ? [Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1]))] : [0, 0];
  }
  const toGame = (p, levelId) => {
    const g = nf.rot(add(p, offsetOf(levelId)));
    return [g[0] - origin[0], g[1] - origin[1]];
  };
  const toPlan = (g, levelId) => sub(nf.inv([g[0] + origin[0], g[1] + origin[1]]), offsetOf(levelId));
  const vecToGame = (v) => nf.rot(v);
  return { toGame, toPlan, vecToGame, origin, north: doc.settings?.north ?? 0 };
}

/**
 * The outer corner of a level's walls in game coordinates (the wall bands with their end extensions): 'ne' = the
 * smallest x (north) and z (east), 'nw' smallest x and largest z, 'se', 'sw'.
 */
export function outerCorner(level, northDeg = 0, corner = 'ne') {
  const nf = northFrame(northDeg);
  const pts = level.walls.flatMap((w) => wallBand(w, level.walls)).map((p) => nf.rot(add(p, level.offset || [0, 0])));
  if (!pts.length) return null;
  const xs = pts.map((p) => p[0]);
  const zs = pts.map((p) => p[1]);
  return [corner[0] === 'n' ? Math.min(...xs) : Math.max(...xs), corner[1] === 'e' ? Math.min(...zs) : Math.max(...zs)];
}

/**
 * Moves a level (its offset) so that its outer corner lies on the reference level's (avstemming V1: the basement's
 * facades are flush with the ground floor's). Returns the shift in plan metres, or null.
 */
export function alignLevel(doc, level, ref, corner = 'ne') {
  const north = doc.settings?.north ?? 0;
  const a = outerCorner(ref, north, corner);
  const b = outerCorner(level, north, corner);
  if (!a || !b) return null;
  const d = northFrame(north).inv(sub(a, b));
  level.offset = [round((level.offset?.[0] ?? 0) + d[0], 4), round((level.offset?.[1] ?? 0) + d[1], 4)];
  return d;
}

/**
 * A room kind for a region the user has not named – no OCR in v1, only rules on what the plan shows: the largest room
 * is the living room, a small one with the front door the entrance, one with three or more doors / passages a hall, a
 * room without windows a storage room, a small one with a window a bathroom, the rest bedrooms. The editor marks the
 * names as suggestions («?»).
 */
export function guessKind(f, isLargest) {
  if (isLargest) return 'living';
  if (f.exteriorDoors && f.area < 12) return 'entrance';
  if (f.doors >= 3 && f.area < 16) return 'hall';
  if (!f.windows && f.area < 12) return 'storage';
  if (f.area < 7) return 'bathroom';
  return 'bedroom';
}

/**
 * Rooms of one level: the regions with their labels (the user's, or a guess).
 * @returns {{ found, rooms: { region, label, id, name, kind, auto }[] }}
 */
export function labelRooms(level, settings = DEFAULT_SETTINGS, takenIds = new Set()) {
  // with the level's separators, and its islands cut out (regions.js levelRooms): every room one simple polygon
  const found = roomsOfLevel(level);
  const used = new Map();
  for (const r of level.rooms || []) {
    const idx = found.at(r.seed[0], r.seed[1]);
    if (idx >= 0 && !used.has(idx)) used.set(idx, r);
  }
  // doors / passages, windows and front doors per region (for the guess)
  const feat = new Map();
  const F = (idx) => feat.get(idx) ?? feat.set(idx, { doors: 0, windows: 0, exteriorDoors: 0 }).get(idx);
  for (const o of level.openings) {
    const w = level.walls.find((x) => x.id === o.wall);
    if (!w) continue;
    const u = wallDir(w);
    const c = add(w.a, mul(u, o.at));
    const sides = [1, -1].map((s) => found.at(...add(c, mul(perp(u), s * (w.t / 2 + 0.06)))));
    const outside = sides.some((i) => i === -1);
    for (const idx of sides) {
      if (idx < 0) continue;
      if (o.type === 'window') F(idx).windows++;
      else {
        F(idx).doors++;
        if (o.type === 'door' && outside) F(idx).exteriorDoors++;
      }
    }
  }
  const largest = found.rooms.reduce((b, r) => (!b || r.area > b.area ? r : b), null);
  const counters = {};
  const rooms = found.rooms.map((region) => {
    const label = used.get(region.index) ?? null;
    let kind = label?.kind;
    let name = label?.name;
    const auto = !label;
    if (!kind) kind = guessKind({ area: region.area, ...(feat.get(region.index) ?? { doors: 0, windows: 0, exteriorDoors: 0 }) }, region === largest);
    if (!name) {
      counters[kind] = (counters[kind] || 0) + 1;
      name = KIND_NAMES[kind] ?? 'Rom';
    }
    return { region, label, name, kind, auto };
  });
  // numbered names when a guessed name repeats («Soverom 1», «Soverom 2»)
  const byName = new Map();
  for (const r of rooms) byName.set(r.name, (byName.get(r.name) || 0) + 1);
  const seen = new Map();
  for (const r of rooms) {
    if (byName.get(r.name) > 1 && r.auto) {
      const k = (seen.get(r.name) || 0) + 1;
      seen.set(r.name, k);
      r.name = `${r.name} ${k}`;
    }
  }
  // ids: from the name, unique in the house
  for (const r of rooms) {
    let base = slug(r.label?.idHint ?? r.name, 'rom');
    if (RESERVED_IDS.has(base)) base = `${base}-1`;
    let id = base;
    for (let k = 2; takenIds.has(id) || RESERVED_IDS.has(id); k++) id = `${base}-${k}`;
    takenIds.add(id);
    r.id = id;
  }
  return { found, rooms };
}

/** Interval overlap of [a0, a1] and [b0, b1]. */
const overlap = (a0, a1, b0, b1) => Math.min(a1, b1) - Math.max(a0, b0);

/**
 * The whole export (see the top of the file).
 * @param {object} doc
 * @param {{ comment?: string }} [opts]
 */
export function exportHouse(doc, opts = {}) {
  const settings = { ...DEFAULT_SETTINGS, ...(doc.settings || {}) };
  const warnings = [];
  const takenIds = new Set();
  const perLevel = doc.levels.map((level) => labelRooms(level, settings, takenIds));
  const frame = houseFrame(doc, perLevel.map((p) => p.found));
  const R = (v) => round(v, 3);
  const RP = (p) => [R(p[0]), R(p[1])];

  const house = {
    $comment: opts.comment ?? `Generert av planbyggeren (src/planbygger) fra «${doc.name ?? 'planen'}». Hele huset er anslått fra plantegningen: rett målene i planbyggeren og eksporter på nytt.`,
    levels: [],
    rooms: [],
    walls: [],
    ceilings: [],
    lightGroups: [],
    builtInLights: [],
  };
  const floorOpenings = [];
  const stairs = [];
  const counts = { rooms: 0, walls: 0, backOf: 0, exterior: 0, doors: 0, windows: 0, openings: 0, stairs: 0, doubleDoors: 0, slidingDoors: 0, skylights: 0, openBoundaries: 0 };
  const levelRooms = []; // per level the rooms in game coordinates (for the stairs)

  doc.levels.forEach((level, li) => {
    const { rooms } = perLevel[li];
    const levelId = level.id;
    const ceilingDefault = level.ceiling ?? settings.ceiling;
    house.levels.push({
      id: levelId,
      name: level.name,
      floorY: levelId === MAIN ? 0 : R(level.floorY ?? 0),
      slabThickness: 0.3,
      ceilingDefault,
      estimated: ['floorY', 'slabThickness', 'ceilingDefault'],
      source: `planbyggeren: ${level.image?.name ?? 'plantegning'}${level.image?.pxPerM ? `, ${round(level.image.pxPerM, 2)} px/m` : ''}`,
    });

    // ---- per room: the polygon in game coordinates, edges with their plan wall and face side
    const R2 = rooms.map((r) => {
      // rounded to mm FIRST: every thickness and offset below is measured on the coordinates that are written
      const poly = r.region.polygon.map((p) => RP(frame.toGame(p, levelId)));
      // a rotation keeps the orientation; make sure anyway
      let edges = r.region.edges;
      let polygon = poly;
      if (signedArea(poly) < 0) {
        polygon = [...poly].reverse();
        edges = [...edges].reverse();
      }
      // an edge under 1 cm (a jog the region tracing left between a straight face and a slanted one, hus3-foto: 9 mm)
      // would be a wall whose ends are one point to the validator: it goes into the longer of its neighbours (whose
      // direction changes least) – the vertex between them goes
      for (let i = 0; polygon.length > 3 && i < polygon.length; i++) {
        const n = polygon.length;
        if (dist(polygon[i], polygon[(i + 1) % n]) >= 0.01) continue;
        // (the short edge last: turn the loop by one, so it is edge 0 → 1)
        if (i === n - 1) {
          polygon = [polygon[n - 1], ...polygon.slice(0, n - 1)];
          edges = [edges[n - 1], ...edges.slice(0, n - 1)];
          i = 0;
        }
        const prev = dist(polygon[(i + n - 1) % n], polygon[i]);
        const next = dist(polygon[i + 1], polygon[(i + 2) % n]);
        // vertex i goes (the edge before runs on to i + 1) or vertex i + 1 (the edge after starts at i); either way the
        // short edge's entry goes and the others stay with their vertices
        const drop = prev >= next ? i : i + 1;
        polygon = polygon.filter((_, k) => k !== drop);
        edges = edges.filter((_, k) => k !== i);
        i = -1;
      }
      return { ...r, polygon, edges, ceiling: r.label?.ceiling ?? ceilingDefault };
    });
    levelRooms[li] = R2;
    const wallsById = new Map(level.walls.map((w) => [w.id, w]));

    // every room edge as a line with its plan wall reference
    const edgeList = [];
    R2.forEach((r, ri) => {
      const P = r.polygon;
      for (let i = 0; i < P.length; i++) {
        const a = P[i];
        const b = P[(i + 1) % P.length];
        const L = dist(a, b);
        if (L < 1e-4) continue;
        const d = unit(sub(b, a));
        edgeList.push({ ri, i, a, b, L, d, n: perp(d), wall: r.edges[i]?.wall ?? null, side: r.edges[i]?.side ?? 0, separator: r.edges[i]?.separator ?? null });
      }
    });
    // two plan walls of one wall line that changes thickness (flush on one face, meeting end to end, detect.js): the
    // rooms on either side face each other through them
    const sameLine = (a, b) => {
      const A = wallsById.get(a);
      const B = wallsById.get(b);
      if (!A || !B) return false;
      const ua = wallDir(A);
      if (Math.abs(cross(ua, wallDir(B))) > 0.01) return false;
      return Math.abs(dot(sub(B.a, A.a), perp(ua))) <= (A.t + B.t) / 2 + 0.01;
    };
    // facing edges: antiparallel, behind (outward), within the wall's thickness (+ 1 cm), overlapping. An open room
    // boundary (a separator, or a cut taking an island out: regions.js) faces the other room's edge on the same line.
    // The room itself can be behind an edge: a room that goes round a wall (a wall stub standing into it, or a wall it
    // reaches round on both sides – hus3: the closet front under the stair, the living room on one side and the stair's
    // foot on the other, one open room)
    const facing = (e) => {
      const out = [];
      if (e.separator != null) {
        for (const f of edgeList) {
          if (f.ri === e.ri || f.separator !== e.separator || dot(f.d, e.d) > -0.999) continue;
          if (Math.abs(dot(sub(f.a, e.a), e.n)) > 0.01) continue;
          const fa = dot(sub(f.a, e.a), e.d);
          const fb = dot(sub(f.b, e.a), e.d);
          const lo = Math.min(fa, fb);
          const hi = Math.max(fa, fb);
          if (overlap(0, e.L, lo, hi) >= 0.01) out.push({ f, lo, hi, t: 0 });
        }
        return out;
      }
      const w = e.wall ? wallsById.get(e.wall) : null;
      const maxT = (w ? w.t : 0.6) + 0.01;
      for (const f of edgeList) {
        if (f === e || f.separator != null) continue;
        if (dot(f.d, e.d) > -0.999) continue;
        // the room's own edge behind it: only along the same plan wall (the two faces of one wall)
        if (f.ri === e.ri && (!e.wall || f.wall !== e.wall)) continue;
        const off = dot(sub(f.a, e.a), e.n); // f's line relative to e's, + = into e's room
        let lim = maxT;
        let minOverlap = 0.01;
        if (e.wall && f.wall && f.wall !== e.wall) {
          if (!sameLine(e.wall, f.wall)) continue;
          // the faces of two plan walls of one line, on opposite sides: half of each plus the offset of their centre
          // lines; over a real stretch (not just the corner where the line changes)
          const A = wallsById.get(e.wall);
          const B = wallsById.get(f.wall);
          lim = (A.t + B.t) / 2 + Math.abs(dot(sub(B.a, A.a), perp(wallDir(A)))) + 0.01;
          minOverlap = 0.1;
        }
        if (off > -0.005 || off < -lim) continue;
        const fa = dot(sub(f.a, e.a), e.d);
        const fb = dot(sub(f.b, e.a), e.d);
        const lo = Math.min(fa, fb);
        const hi = Math.max(fa, fb);
        if (overlap(0, e.L, lo, hi) < minOverlap) continue;
        out.push({ f, lo, hi, t: -off });
      }
      return out;
    };

    // ---- pieces: each edge split where the rooms behind it change
    const pieces = []; // { ri, edge, u0, u1, from, to, behind: { ri, t } | null }
    for (const e of edgeList) {
      const fs = facing(e);
      const cuts = new Set([0, e.L]);
      for (const x of fs) for (const u of [x.lo, x.hi]) if (u > 0.005 && u < e.L - 0.005) cuts.add(u);
      const us = [...cuts].sort((p, q) => p - q);
      for (let k = 0; k < us.length - 1; k++) {
        const u0 = us[k];
        const u1 = us[k + 1];
        if (u1 - u0 < 0.005) continue;
        const mid = (u0 + u1) / 2;
        const hit = fs.filter((x) => mid > x.lo && mid < x.hi).sort((p, q) => p.t - q.t)[0] ?? null;
        pieces.push({ ri: e.ri, e, u0, u1, from: add(e.a, mul(e.d, u0)), to: add(e.a, mul(e.d, u1)), behind: hit ? { ri: hit.f.ri, t: hit.t, f: hit.f } : null });
      }
    }
    // pieces of one room in loop order (edges are in loop order already, pieces in u order)
    const piecesOf = R2.map((_, ri) => pieces.filter((p) => p.ri === ri));
    const partnerOf = (p) => {
      if (!p.behind) return null;
      // the other room's piece on the same stretch (the same cuts were made on both sides), on the edge found behind it
      // (F140: a stub standing into hus2's living room paired with the room's walls across the room, both faces were
      // void and the stub's end stood alone with a hole down to the ground)
      let best = null;
      for (const q of piecesOf[p.behind.ri]) {
        if (q.e !== p.behind.f || !q.behind || q.behind.ri !== p.ri || dot(q.e.d, p.e.d) > -0.999) continue;
        const qa = dot(sub(q.from, p.from), p.e.d);
        const qb = dot(sub(q.to, p.from), p.e.d);
        const ov = overlap(0, dist(p.from, p.to), Math.min(qa, qb), Math.max(qa, qb));
        if (ov > 0.005 && (!best || ov > best.ov + 1e-9)) best = { q, ov };
      }
      return best?.q ?? null;
    };
    // distance from a wall's middle straight out to the nearest other room (Infinity: open air)
    const rayToRooms = (g) => {
      const mid = mul(add(g.from, g.to), 0.5);
      const dir = mul(g.e.n, -1);
      let best = Infinity;
      R2.forEach((r, ri) => {
        if (ri === g.ri) return;
        const P = r.polygon;
        for (let i = 0; i < P.length; i++) {
          const a = P[i];
          const b = P[(i + 1) % P.length];
          const ab = sub(b, a);
          const den = cross(dir, ab);
          if (Math.abs(den) < 1e-12) continue;
          const am = sub(a, mid);
          const t = cross(am, ab) / den;
          const s2 = cross(am, dir) / den;
          if (t > 1e-6 && s2 >= -1e-9 && s2 <= 1 + 1e-9) best = Math.min(best, t);
        }
      });
      return best;
    };
    // roles: 'slab' = owns a shared slab (the room with the lower index), 'face' = the backOf side, 'free' = no room
    // behind (exterior, or a wall end / a shaft). A wall with the same room on both sides: the format has no backOf
    // within one room (validateHouse), so one side owns the whole slab (the distance between the faces, an inner wall)
    // and the other is a wall of no thickness ('void': rooms.js builds nothing for it, the slab's back is its face).
    // Two exterior walls of exteriorMin each way overlapped there and stood out of the wall by 0.25 m on each side
    // (hus3: into the stair's top, with the facade cladding above the floor of the level over it)
    for (const p of pieces) p.partner = partnerOf(p);
    for (const p of pieces) {
      const q = p.partner;
      if (!q) p.role = 'free';
      else if (q.ri !== p.ri) p.role = p.ri < q.ri ? 'slab' : 'face';
      else p.role = p.e.i < q.e.i ? 'slab' : 'void';
    }
    // a short free piece between / next to shared pieces of the same edge lies in front of the end of an abutting wall
    // (a T joint): it takes its neighbour's role (a face reaches over it, a slab covers the joint)
    const SHORT = 0.6;
    for (const e of edgeList) {
      const list = pieces.filter((p) => p.e === e);
      list.forEach((p, k) => {
        if (p.role !== 'free' || dist(p.from, p.to) >= SHORT) return;
        // longer than a wall is thick and open air behind it: a piece of the facade, not the end of a wall (hus1's loft,
        // F44: 0.6 m of the bedroom's outer wall went with the hall's wall beside it and was never built)
        if (dist(p.from, p.to) > 0.35 && rayToRooms(p) > 1.2) return;
        const nb = [list[k - 1], list[k + 1]].filter((q) => q && q.role !== 'free' && !q.absorbed);
        if (!nb.length) return;
        const q = nb.sort((x, y) => dist(y.from, y.to) - dist(x.from, x.to))[0];
        p.role = q.role;
        p.absorbed = true;
      });
    }
    // groups: consecutive pieces of an edge with the same role → one wall; a slab is cut where the distance to the
    // faces behind it changes (a wall line that changes thickness: each part gets its own thickness). The depths of one
    // slab stay within DEPTH_TOL (under the validator's 5 mm for a backOf pair), and the slab takes the smallest: never
    // into the room behind (hus2: 0.158 over a 0.157 gap was 2.5 cm² inside WIC; hus1's loft: 0.106 over a face 0.100
    // behind failed the pair)
    const DEPTH_TOL = 0.004;
    const groups = [];
    const depthOf = (p) => (p.absorbed || !p.behind ? null : p.behind.t);
    for (const e of edgeList) {
      const list = pieces.filter((p) => p.e === e);
      let g = null;
      for (const p of list) {
        const t = depthOf(p);
        const sameDepth = p.role !== 'slab' || t == null || g?.dmin == null || Math.max(g.dmax, t) - Math.min(g.dmin, t) <= DEPTH_TOL;
        if (g && p.role === g.role && p.role !== 'free' && sameDepth) {
          g.pieces.push(p);
          g.to = p.to;
          if (t != null) {
            g.dmin = Math.min(g.dmin ?? t, t);
            g.dmax = Math.max(g.dmax ?? t, t);
          }
        } else {
          g = { ri: e.ri, e, role: p.role, pieces: [p], from: p.from, to: p.to, dmin: t, dmax: t };
          groups.push(g);
        }
        p.group = g;
      }
    }

    // the distance behind a group to the nearest other room (a ray from the middle, outward)

    // ---- thicknesses: the shared slabs first (the distance between the faces), then the free walls: the plan's
    //      thickness, at least exteriorMin, except where the slab would overlap another room or another room's slab
    //      (two rooms' exterior walls meeting at an outer corner) – there the wall is cut and that piece thinned to the
    //      overlap's depth, so only the corner gets thinner
    const slabRect = (g, t) => [g.from, g.to, add(g.to, mul(g.e.n, -t)), add(g.from, mul(g.e.n, -t))];
    const solid = [];
    for (const g of groups) {
      if (g.role === 'void') g.t = 0;
      if (g.role !== 'slab') continue;
      g.t = Math.min(...g.pieces.filter((p) => !p.absorbed).map((p) => p.behind.t));
      // the slab of a wall with its own room on the other side (a stub's body)
      g.self = g.pieces.some((p) => p.partner && p.partner.ri === p.ri);
      solid.push(g);
    }
    // an absorbed end piece (a slab reaching over a T joint) that runs into another room's slab – both walls of a joint
    // reach into it when a separator continues one of them (hus4: TV room, hall, bedroom) – is a free wall again: the
    // free walls are thinned where they meet a slab (below)
    const overlapsSlab = (rect, g) => solid.some((o) => o !== g && o.ri !== g.ri && o.t > 0 && Math.abs(signedArea(clipPolygon(rect, slabRect(o, o.t)))) > 2e-4);
    for (const g of [...solid]) {
      if (!(g.t > 0) || g.pieces.length < 2) continue;
      for (const end of [0, 1]) {
        const p = end === 0 ? g.pieces[0] : g.pieces[g.pieces.length - 1];
        if (!p.absorbed || g.pieces.length < 2 || !overlapsSlab(slabRect({ from: p.from, to: p.to, e: g.e }, g.t), g)) continue;
        g.pieces = g.pieces.filter((q) => q !== p);
        if (end === 0) g.from = g.pieces[0].from;
        else g.to = g.pieces[g.pieces.length - 1].to;
        p.absorbed = false;
        p.role = 'free';
        const fg = { ri: g.ri, e: g.e, role: 'free', pieces: [p], from: p.from, to: p.to };
        p.group = fg;
        groups.splice(groups.indexOf(g) + end, 0, fg);
      }
    }
    const conflicts = (g, t) => {
      const rect = slabRect(g, t);
      const L = dist(g.from, g.to);
      const out = [];
      const test = (poly, own = false) => {
        const c = clipPolygon(poly, rect);
        if (c.length < 3 || Math.abs(signedArea(c)) < 2e-4) return;
        const us = c.map((p) => dot(sub(p, g.from), g.e.d));
        const ds = c.map((p) => -dot(sub(p, g.from), g.e.n));
        out.push({ u0: Math.max(0, Math.min(...us)), u1: Math.min(L, Math.max(...us)), depth: Math.max(0, Math.min(...ds)), own });
      };
      for (let ri = 0; ri < R2.length; ri++) if (ri !== g.ri) test(R2[ri].polygon);
      for (const o of solid) if (o.ri !== g.ri) test(slabRect(o, o.t));
      // the room itself behind the wall: the end of a wall stub standing into the room (the room goes round it) has the
      // stub's own slab behind it – no slab of its own (and no facade), and none out into the room
      for (const o of solid) if (o.ri === g.ri && o.self && o !== g) test(slabRect(o, o.t), true);
      test(R2[g.ri].polygon, true);
      return out;
    };
    const split = [];
    for (const g of groups) {
      if (g.role !== 'free') {
        split.push(g);
        continue;
      }
      // an open boundary with no room found behind it (the two sides' edges ended a little apart): no wall either
      if (g.e.separator != null) {
        g.t = 0;
        split.push(g);
        continue;
      }
      const planWall = g.e.wall ? wallsById.get(g.e.wall) : null;
      const want = Math.max(planWall ? planWall.t : 0.2, settings.exteriorMin ?? 0);
      const L = dist(g.from, g.to);
      const cs = conflicts(g, want);
      const cuts = new Set([0, L]);
      // a conflict at the very end of the wall (another room's slab reaching a centimetre past the corner) thins only a
      // piece of at least MIN_PIECE there, not the whole wall (hus1's loft: 1.92 m at 5 mm for a 1 cm overlap)
      const MIN_PIECE = 0.012;
      for (const c of cs) {
        for (const u of [c.u0, c.u1]) {
          if (L < 3 * MIN_PIECE) continue;
          const v = u > 1e-4 && u < MIN_PIECE ? MIN_PIECE : u < L - 1e-4 && u > L - MIN_PIECE ? L - MIN_PIECE : u;
          if (v >= MIN_PIECE - 1e-9 && v <= L - MIN_PIECE + 1e-9) cuts.add(v);
        }
      }
      const us = [...cuts].sort((p, q) => p - q);
      const parts = [];
      for (let k = 0; k < us.length - 1; k++) {
        const u0 = us[k];
        const u1 = us[k + 1];
        if (u1 - u0 < 0.005) continue;
        let t = want;
        let own = false;
        for (const c of cs) {
          if (!(c.u1 > u0 + 1e-4 && c.u0 < u1 - 1e-4)) continue;
          t = Math.min(t, c.depth - 0.002);
          own ||= c.own;
        }
        t = Math.max(0.005, Math.floor(t * 1000) / 1000);
        const prev = parts[parts.length - 1];
        // pieces a few centimetres apart in thickness are one wall at the thinner of them: a joint in the room face
        // showed as a line (F29, F44)
        if (prev && Math.abs(prev.t - t) < 0.035 && prev.own === own) {
          prev.u1 = u1;
          prev.t = Math.min(prev.t, t);
        } else parts.push({ u0, u1, t, own });
      }
      for (const p of parts) {
        const sg = { ...g, from: add(g.from, mul(g.e.d, p.u0)), to: add(g.from, mul(g.e.d, p.u1)), t: p.t };
        // the room itself behind it: an inner wall, not a facade
        sg.exterior = !p.own && rayToRooms(sg) > 1.2;
        if (p.t < 0.6 * (planWall ? planWall.t : want) && p.u1 - p.u0 > 0.3) warnings.push(`${level.name}: en yttervegg i ${R2[g.ri].name} er tynnet til ${round(p.t, 3)} m på ${round(p.u1 - p.u0, 2)} m for ikke å gå inn i ${p.own ? 'rommet selv' : 'et annet rom'}`);
        split.push(sg);
        solid.push(sg);
      }
    }
    groups.length = 0;
    groups.push(...split);
    const groupsOf = R2.map((_, ri) => groups.filter((g) => g.ri === ri));
    const groupId = new Map();
    R2.forEach((r, ri) => groupsOf[ri].forEach((g, k) => groupId.set(g, `w-${r.id}-${k + 1}`)));
    // a piece's group after the split (faces point at slab groups, which are never split)
    for (const g of groups) for (const p of g.pieces) if (g.role !== 'free') p.group = g;

    // ---- walls of each room in loop order
    const wallObjs = new Map(); // group → wall entry
    R2.forEach((r, ri) => {
      const height = r.ceiling;
      const wet = r.kind === 'bathroom' || r.kind === 'laundry';
      for (const g of groupsOf[ri]) {
        const id = groupId.get(g);
        // the normal from the written ends: a short slanted piece's mm-rounded ends turn it more than the validator's
        // 0,001 (hus3-foto without AI)
        const from = RP(g.from);
        const to = RP(g.to);
        const axisAligned = Math.abs(g.e.n[0]) < 1e-9 || Math.abs(g.e.n[1]) < 1e-9;
        const w = { id, roomId: r.id, from, to, normal: axisAligned || dist(from, to) < 1e-6 ? RP(g.e.n) : RP(perp(unit(sub(to, from)))) };
        const own = g.pieces.filter((p) => !p.absorbed);
        if (g.role === 'face') {
          const ids = [...new Set(own.map((p) => groupId.get(p.partner.group)))];
          w.backOf = ids.length === 1 ? ids[0] : ids;
          counts.backOf++;
        } else {
          w.thickness = R(g.t);
          w.height = R(height);
          if (g.exterior) {
            w.exterior = true;
            counts.exterior++;
          }
        }
        w.material = 'paint';
        w.color = wet ? LOOK.wetWall : LOOK.wall;
        w.estimated = ['*'];
        house.walls.push(w);
        wallObjs.set(g, w);
        counts.walls++;
      }
    });

    // ---- open room boundaries (separators, island cuts): the house format has no room edge without a wall, so the
    //      owner side is a wall of no thickness (rooms.js builds nothing for it) with one passage over its whole length
    //      and height – the portal between the two rooms (visibility.js); the other side is its backOf face
    //      (notes/planbygger.md, «Forespørsler» 12)
    const openPairs = [];
    for (const g of groups) {
      if (g.e.separator == null || g.role !== 'slab') continue;
      const wall = wallObjs.get(g);
      const owner = R2[g.ri].id;
      const other = g.pieces.find((p) => p.partner && !p.absorbed)?.partner;
      const L = Math.floor(dist(wall.from, wall.to) * 1000) / 1000;
      if (!other || L < 0.02) continue;
      openPairs.push([g.ri, other.ri]);
      wall.openings = [{ id: `open-${owner}-${++counts.openings}`, type: 'opening', offset: 0, width: L, height: wall.height, sill: 0, connects: [owner, R2[other.ri].id], estimated: ['*'], source: `planbyggeren: ${/^cut/.test(g.e.separator) ? 'åpen plan rundt et rom midt i rommet (delt med en tenkt linje)' : 'skillelinje mellom to soner'}, ingen vegg` }];
      counts.openBoundaries++;
    }

    // ---- openings on their owner pieces
    const roomIdOf = (ri) => R2[ri]?.id ?? null;
    // double and sliding doors are the game's own door types (notes/dortyper.md); until they came, a double door was
    // two single doors side by side and a sliding door a hinged one
    const asBuilt = level.openings.map((o) => (o.type === 'door' && (o.variant === 'double' || o.variant === 'sliding' || o.variant === 'folding') ? { ...o, built: o.variant } : o));
    // sliding doors that go into the wall where it has room (after all openings are placed, below): 'auto' when the
    // drawing or the customer said nothing, 'must' when the customer chose a pocket door in the facade check
    const pocketWish = new Map();
    for (const o of asBuilt) {
      const pw = wallsById.get(o.wall);
      if (!pw) continue;
      const u = wallDir(pw);
      const P0 = frame.toGame(add(pw.a, mul(u, o.at - o.width / 2)), levelId);
      const P1 = frame.toGame(add(pw.a, mul(u, o.at + o.width / 2)), levelId);
      const uGame = frame.vecToGame(u);
      // candidate walls: on a face of this plan wall, solid (a slab or a free wall)
      const cands = [];
      for (const p of groups) {
        // (a room edge along a wall line that changes thickness may carry the other plan wall's id)
        if (p.e.wall !== o.wall && !(p.e.wall && sameLine(p.e.wall, o.wall))) continue;
        if (p.role === 'face' || p.role === 'void') continue;
        const L = dist(p.from, p.to);
        const a = dot(sub(P0, p.from), p.e.d);
        const b = dot(sub(P1, p.from), p.e.d);
        const ov = overlap(0, L, Math.min(a, b), Math.max(a, b));
        if (ov > 0.02) cands.push({ p, ov, a: Math.min(a, b), b: Math.max(a, b), L });
      }
      if (!cands.length) {
        warnings.push(`${level.name}: åpningen ${o.id} (${o.type}) står ikke på noen romvegg – hoppet over`);
        continue;
      }
      cands.sort((x, y) => y.ov - x.ov);
      // a passage along the wall pieces of several rooms opens each of them (hus4: 4,5 m along the stair well and the
      // room beside it – on the well's piece it is where the stair comes up); a door or a window goes on the piece it
      // overlaps most
      const split = o.type === 'opening' ? cands.filter((c) => c.ov >= 0.2) : [];
      const targets = split.length > 1 ? split : [cands[0]];
      targets.forEach((best, k) => {
        const { p, L } = best;
        let off = best.a;
        let width = best.b - best.a;
        if (off < 0 || off + width > L) {
          const a = Math.max(0, off);
          const b = Math.min(L, off + width);
          if (b - a < 0.2) {
            warnings.push(`${level.name}: åpningen ${o.id} får ikke plass i veggen ${groupId.get(p)} – hoppet over`);
            return;
          }
          if (targets.length === 1) warnings.push(`${level.name}: åpningen ${o.id} er kuttet til veggen ${groupId.get(p)} (${round(width, 2)} → ${round(b - a, 2)} m)`);
          off = a;
          width = b - a;
        }
        // an opening against a corner of its room: a jamb of JAMB between the corner and the hole, so the hole's side is
        // a face of its own wall – not the plane of the wall across (it flickered) nor the corner's mitre (it slanted
        // the reveal and left a slot to the outside by a door) – F15, F16, F17, F20, F22. A passage along the pieces of
        // several rooms runs on from one piece to the next and keeps its full width
        const width0 = width;
        const jambs = targets.length === 1;
        if (jambs && dist(p.from, p.e.a) < 0.02 && off < JAMB) {
          width -= JAMB - off;
          off = JAMB;
        }
        if (jambs && dist(p.to, p.e.b) < 0.02 && off + width > L - JAMB) width = L - JAMB - off;
        if (width < 0.3 || width < 0.6 * width0) {
          off = best.a < 0 ? 0 : best.a;
          width = width0;
        }
        const wall = wallObjs.get(p);
        const owner = roomIdOf(p.ri);
        // a door the player cannot pass (its radius is 0.3: a 0.69 m hole leaves 0.5 m between frame and leaf – F19)
        // is widened to MIN_DOOR where the wall has room: evenly, within the jambs, clear of the openings already on it
        let widened = false;
        if (o.type === 'door' && width < MIN_DOOR) {
          const lo = dist(p.from, p.e.a) < 0.02 ? JAMB : 0;
          const hi = dist(p.to, p.e.b) < 0.02 ? L - JAMB : L;
          let a = Math.max(lo, off - (MIN_DOOR - width) / 2);
          let b = Math.min(hi, a + MIN_DOOR);
          a = Math.max(lo, b - MIN_DOOR);
          const clear = (wall.openings || []).every((x) => x.offset + x.width <= a + 0.01 || x.offset >= b - 0.01);
          if (b - a > width + 0.01 && clear) {
            off = a;
            width = b - a;
            widened = true;
          }
        }
        // the room behind the opening (the partner of the piece under its middle), else outside
        const midU = (Math.max(0, off) + Math.min(L, off + width)) / 2;
        const under = p.pieces.find((q) => dot(sub(q.to, p.from), p.e.d) >= midU - 1e-6) ?? p.pieces[p.pieces.length - 1];
        const firstPartner = p.pieces.find((q) => q.partner && !q.absorbed)?.partner ?? null;
        let other = under.partner && !under.absorbed ? roomIdOf(under.partner.ri) : firstPartner ? roomIdOf(firstPartner.ri) : 'ute';
        // a door in a wall with the same room on both sides (the room goes round the wall): the format wants two rooms
        // in connects, and the only other one there is is outside ('ute') – the door stays a door you can walk through
        const selfWall = other === owner;
        if (selfWall) other = 'ute';
        const room = R2[p.ri];
        const wallH = wall.height ?? room.ceiling;
        const entry = { id: null, type: o.type === 'door' ? 'door' : o.type === 'window' ? 'window' : 'opening', offset: R(off), width: R(width) };
        if (entry.type === 'window') {
          // a window a few centimetres off the floor stands on it: the game then runs the floor out to the frame
          // (rooms.js, revealFloor – it was the viewer's own strip until the window models came, F5)
          const sill0 = o.sill ?? settings.windowSill;
          const sill = sill0 < 0.03 ? 0 : sill0;
          const h = Math.min(o.height ?? settings.windowHeight, wallH - sill - 0.05);
          entry.id = `win-${owner}-${++counts.windows}`;
          entry.height = R(h);
          entry.sill = R(sill);
          entry.sashes = windowSashes(o.style, width, h, sill);
          // bars (sprosser) the facade check set: [columns, rows] of panes in each sash
          if (Array.isArray(o.panes) && o.panes.length === 2) entry.panes = o.panes;
          entry.estimated = ['*'];
        } else {
          const h = Math.min(o.height ?? settings.doorHeight, wallH - 0.02);
          entry.height = R(h);
          entry.sill = 0;
          entry.connects = [owner, other];
          if (entry.type === 'door') {
            entry.id = `door-${owner}-${++counts.doors}`;
            const sameDir = dot(uGame, p.e.d) > 0;
            const hingeStart = (o.hinge ?? 'start') === 'start';
            const hinge = hingeStart === sameDir ? 'from' : 'to';
            const swingVec = frame.vecToGame(mul(perp(u), o.side || 1));
            const swing = dot(swingVec, p.e.n) > 0 ? 'in' : 'out';
            const exterior = other === 'ute' && !selfWall;
            // an outer door as the owner's (30-kjeller.json door-ute): a deeper frame and a dark-lined reveal in the thick
            // wall – with an inner door's 2 cm frame the leaf's clearance showed the outside as a slit (F17)
            const frameW = exterior ? 0.05 : 0.06;
            // the game's door unit is its leaf + 0.076 (src/world/Door.js: steel jambs 0.05 that the leaf overlaps 0.012):
            // a leaf of the hole − 0.076 makes the unit fill the hole – narrower, it left 1.2 cm of open reveal along both
            // jambs, a slit of daylight beside an outer door (F17)
            const leafW = width - DOOR_UNIT;
            entry.frame = exterior ? { color: '#25272b', width: frameW, depth: 0.06 } : { color: LOOK.frame, width: frameW, depth: 0.02 };
            if (exterior) entry.reveal = { depth: R(Math.max(0.1, Math.min(0.21, (wall.thickness ?? 0.3) - 0.05))), color: '#1d1e21' };
            const opensInto = swing === 'in' ? owner : other;
            // an outer door from a living room, a kitchen or a bedroom is a terrace or balcony door: glass with bars in
            // the leaf (F99, F100, F108); the front door (entrance, hall) and the doors of storerooms stay closed
            // (the customer's choice in the facade check, o.glass, wins)
            const terrace = exterior && !['entrance', 'hall', 'storage', 'laundry', 'bathroom'].includes(room.kind);
            const glass = o.glass ?? terrace;
            const look = { ...(exterior ? {} : { leafColor: LOOK.door }), ...(glass ? { glass: { cols: width >= 1.2 ? 2 : 1, rows: 3 } } : {}) };
            // windows joined to the door in the facade check: glass panels down to the floor in its frame (notes/dortyper.md 4)
            // the leaf keeps at least MIN_DOOR between the posts: the sidelights give way (and go below 0.15 m)
            let sidelights = (o.sidelights || []).map((sl) => ({ side: (sl.side === 'start') === sameDir ? 'from' : 'to', w: sl.width }));
            const sum = sidelights.reduce((t, sl) => t + sl.w + frameW, 0);
            if (sidelights.length && width - sum < MIN_DOOR) {
              const k = Math.max(0, width - MIN_DOOR - sidelights.length * frameW) / sidelights.reduce((t, sl) => t + sl.w, 0);
              sidelights = sidelights.map((sl) => ({ ...sl, w: sl.w * k })).filter((sl) => sl.w >= 0.15);
              warnings.push(`${level.name}: sidefeltene i ${entry.id} er gjort smalere så døra blir minst ${MIN_DOOR} m`);
            }
            if (sidelights.length) look.sidelights = sidelights.map((sl) => ({ ...sl, w: R(sl.w) }));
            if (o.built === 'double') {
              // the leaves fill the hole between the jambs; the drawn arcs' radii give their ratio
              entry.door = { variant: 'double', hinge, swing, opensInto, leaf: { w: R(o.leaf ?? width / 2), h: R(h - 0.04) }, leaf2: { w: R(o.leaf2 ?? o.leaf ?? width / 2) }, ...(o.openAngle && o.openAngle !== 90 ? { openAngleDeg: o.openAngle } : {}), handleHeight: 1.05, closed: true, ...look };
            } else if (o.built === 'sliding') {
              // the leaf parks at the hinge jamb (model.js); two leaves part both ways. An outer one is a glass patio
              // door when it is wide enough for its half-width opening (the figure needs 0.62 m), else on a rail
              // a glass patio door needs 1.35 m (its opening is half the frame); the customer may have chosen the mount
              const patio = (o.mount === 'patio' || (!o.mount && exterior)) && width >= 1.35;
              const slide = o.leaves === 2 && !patio ? 'both' : hinge;
              entry.door = { variant: 'sliding', mount: patio ? 'patio' : 'surface', slide, swing, opensInto, closed: true, ...look };
              if (!patio && o.mount !== 'surface') pocketWish.set(entry, o.mount === 'pocket' ? 'must' : 'auto');
              if (o.mount === 'patio' && !patio) warnings.push(`${level.name}: glass-skyvedøra ${entry.id} er under 1,35 m og står på skinne i stedet`);
            } else if (o.built === 'folding') {
              // a folding door: its leaves fold toward the hinge jamb
              entry.door = { variant: 'folding', slide: hinge, swing, opensInto, closed: true, ...look };
            } else {
              entry.door = {
                hinge,
                swing,
                opensInto,
                leaf: { w: R(leafW), h: R(h - 0.04) },
                ...(o.openAngle && o.openAngle !== 90 ? { openAngleDeg: o.openAngle } : {}),
                handleSide: hinge === 'from' ? 'to' : 'from',
                handleHeight: 1.05,
                closed: true,
                ...look,
              };
            }
            entry.interactive = true;
            entry.estimated = ['*'];
          } else {
            entry.id = `open-${owner}-${++counts.openings}`;
            entry.estimated = ['*'];
          }
        }
        if (o.built === 'double' && k === 0) counts.doubleDoors++;
        else if (o.built === 'sliding' && k === 0) counts.slidingDoors++;
        if (widened) entry.source = `${entry.source ? `${entry.source}; ` : 'planbyggeren: '}gjort bredere enn tegningen (${MIN_DOOR} m) så figuren kommer gjennom`;
        if (targets.length > 1) entry.source = `${entry.source ? `${entry.source}; ` : 'planbyggeren: '}del ${k + 1} av ${targets.length} (åpningen går langs flere rom)`;
        if (selfWall && entry.type !== 'window') entry.source = `${entry.source ? `${entry.source}; ` : 'planbyggeren: '}samme rom på begge sider av veggen (rommet går rundt den), koblet til «ute» fordi formatet vil ha to rom`;
        (wall.openings ||= []).push(entry);
      });
    }
    for (const w of house.walls) if (w.openings) w.openings.sort((a, b) => a.offset - b.offset);
    // two openings side by side (a door and its sidelight) need a post between them: a few millimetres of wall gave
    // overlapping linings and trims that flickered, and a slit to the outside (F16, F17). A window gives way to a door;
    // nothing changes when the window would get narrower than 0.2 m
    for (const w of house.walls) {
      const os = w.openings || [];
      for (let i = 1; i < os.length; i++) {
        const A = os[i - 1];
        const B = os[i];
        const gap = B.offset - (A.offset + A.width);
        if (gap >= MIN_POST || gap < -0.01) continue;
        const cut = MIN_POST - gap;
        const win = B.type === 'window' ? B : A.type === 'window' ? A : B.type !== 'door' ? B : A.type !== 'door' ? A : null;
        if (!win || win.width - cut < 0.2) continue;
        if (win === B) B.offset = R(B.offset + cut);
        win.width = R(win.width - cut);
        win.source = `${win.source ? `${win.source}; ` : 'planbyggeren: '}${round(cut * 100, 0)} cm smalere for en post mot åpningen ved siden av`;
      }
    }
    // an inner sliding door goes into the wall (a pocket door) where the wall has room for its leaf beside the hole –
    // the hole's width + 0.04 of plain wall, notes/dortyper.md – first on the side it slides to: on a rail outside the
    // wall it showed the whole leaf (F98, F104). Two leaves parting both ways stay on their rails
    for (const w of house.walls) {
      const os = w.openings || [];
      const L = dist(w.from, w.to);
      for (const o of os) {
        const wish = pocketWish.get(o);
        if (!wish || o.door.slide === 'both' || !(w.thickness >= 0.08)) continue;
        const need = o.width + 0.04;
        const free = (a, b) => a >= -1e-6 && b <= L + 1e-6 && !os.some((q) => q !== o && q.offset < b && q.offset + q.width > a);
        for (const side of o.door.slide === 'to' ? ['to', 'from'] : ['from', 'to']) {
          const [a, b] = side === 'from' ? [o.offset - need, o.offset] : [o.offset + o.width, o.offset + o.width + need];
          if (!free(a, b)) continue;
          o.door.mount = 'pocket';
          o.door.slide = side;
          break;
        }
        if (wish === 'must' && o.door.mount !== 'pocket') warnings.push(`${level.name}: skyvedøra ${o.id} får ikke plass inne i veggen og står på skinne`);
      }
    }

    // ---- skylights: on the ceiling of the room they lie in. The house format has flat ceilings without roof windows,
    //      so they are kept as data on the ceiling entry (nothing builds them yet – a request in notes/planbygger.md)
    const skylightsOf = new Map();
    for (const s of level.skylights || []) {
      const [[x0, y0], [x1, y1]] = s.rect;
      let poly = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map((p) => RP(frame.toGame(p, levelId)));
      if (signedArea(poly) < 0) poly = poly.reverse();
      const c = frame.toGame([(x0 + x1) / 2, (y0 + y1) / 2], levelId);
      const room = R2.find((r) => pointInPolygon(c, r.polygon));
      if (!room) {
        warnings.push(`${level.name}: takvinduet ${s.id} står ikke i noe rom – hoppet over`);
        continue;
      }
      const list = skylightsOf.get(room) ?? skylightsOf.set(room, []).get(room);
      list.push({ id: `sk-${room.id}-${list.length + 1}`, polygon: poly, estimated: ['*'] });
      counts.skylights++;
    }

    // ---- one floor across an open boundary (F151: hus4's TV room open to the hall along the beam line had oak, the
    //      hall vinyl, though the plan draws one parquet): the rooms joined without a wall, wet rooms aside, have the
    //      floor of the one that is a living room, a bedroom or a hall before an entrance or a store (the largest of them)
    const floorOf = new Map();
    {
      const WET = new Set(['bathroom', 'laundry']);
      const RANK = { living: 0, bedroom: 0, hall: 0, entrance: 1, storage: 2 };
      const root = R2.map((_, i) => i);
      const find = (i) => (root[i] === i ? i : (root[i] = find(root[i])));
      for (const [a, b] of openPairs) if (!WET.has(R2[a].kind) && !WET.has(R2[b].kind)) root[find(a)] = find(b);
      const groupsOf = new Map();
      R2.forEach((r, i) => groupsOf.set(find(i), [...(groupsOf.get(find(i)) ?? []), r]));
      for (const g of groupsOf.values()) {
        if (g.length < 2) continue;
        const area = (r) => Math.abs(signedArea(r.polygon));
        const lead = [...g].sort((x, y) => (RANK[x.kind] ?? 0) - (RANK[y.kind] ?? 0) || area(y) - area(x))[0];
        for (const r of g) floorOf.set(r, LOOK.floor[lead.kind] ?? LOOK.floor.living);
      }
    }

    // ---- rooms, ceilings, lights
    for (const r of R2) {
      const [mat, color] = floorOf.get(r) ?? LOOK.floor[r.kind] ?? LOOK.floor.living;
      const inside = frame.toGame(r.region.inside, levelId);
      house.rooms.push({
        id: r.id,
        name: r.name,
        levelId,
        kind: r.kind,
        polygon: r.polygon.map(RP),
        floor: { material: mat, color, ...(mat === 'oak-plank' ? { boards: 'x' } : {}) },
        ceilingIds: [`c-${r.id}`],
        acoustic: { mode: 'estimate' },
        estimated: ['polygon', 'floor'],
        source: `planbyggeren${r.auto ? ' (navn og type foreslått)' : ''}`,
      });
      const sky = skylightsOf.get(r);
      house.ceilings.push({ id: `c-${r.id}`, roomId: r.id, polygon: r.polygon.map(RP), height: R(r.ceiling), color: LOOK.ceiling, ...(sky ? { skylights: sky } : {}), estimated: ['height'] });
      house.lightGroups.push({ id: r.id, label: r.name, roomId: r.id, dimmer: true, defaultDimmer: 0.6 });
      house.builtInLights.push({
        id: `l-${r.id}`,
        roomId: r.id,
        group: r.id,
        type: 'plafond',
        position: [R(inside[0]), R(r.ceiling), R(inside[1])],
        dims: { d: 0.35, h: 0.07 },
        lumens: Math.round(Math.max(600, Math.min(2400, r.region.area * 110))),
        lightColorK: 3000,
        estimated: ['*'],
      });
      counts.rooms++;
    }
  });
  exportStairs({ doc, house, levelRooms, frame, floorOpenings, stairs, warnings, counts, RP, R });
  // the terraces and balconies with an outline from the plan (generate.js, deckfind.js), notes/kledning.md «decks»;
  // before the roofs: a lower part under a deck has the deck for its roof
  const decks = idsRegistry.schema?.topLevel?.includes('decks') ? decksOf(doc, frame, RP, house) : [];
  exportRoofs({ doc, house, warnings, RP, R, frame, decks });
  // the cladding the AI read on the facades (houseread.js doc.cladding), once the engine knows the key (notes/kledning.md)
  if (idsRegistry.schema?.topLevel?.includes('cladding')) {
    const cladding = claddingOf(doc);
    if (cladding) house.cladding = cladding;
  }
  if (decks.length) house.decks = decks;
  if (floorOpenings.length) house.floorOpenings = floorOpenings;
  if (stairs.length) house.stairs = stairs;

  return {
    house,
    registry: registryFor(house),
    rooms: perLevel.map((p, li) => ({ levelId: doc.levels[li].id, found: p.found, rooms: p.rooms })),
    report: { warnings, counts },
    frame,
  };
}

/**
 * The straight stairs (model.js addStair) → floorOpenings + stairs (notes/hele-huset-design.md §1.6): the hole in the
 * upper floor (its sides snapped onto the faces of the room it stands in), the stair from the level under it, risers
 * from the floor heights (≈ 0,18), the top edge at the start of the rectangle and the lowest nosing at its far end,
 * guards on the hole's free sides (not along a wall) on the upper floor.
 */
function exportStairs({ doc, house, levelRooms, frame, floorOpenings, stairs, warnings, counts, RP, R }) {
  const roomLevel = new Map(house.rooms.map((r) => [r.id, r.levelId]));
  const wallById = new Map(house.walls.map((w) => [w.id, w]));
  const levels = house.levels;
  const inside = (p, poly) => pointInPolygon(p, poly);
  doc.levels.forEach((level, li) => {
    for (const st of level.stairs || []) {
      const upper = levels[li];
      const below = levels.filter((l) => l.floorY < upper.floorY - 0.5).sort((a, b) => b.floorY - a.floorY)[0];
      if (!below) {
        warnings.push(`${level.name}: trappa går ned, men det er ingen etasje under – hoppet over`);
        continue;
      }
      const lowerIdx = levels.indexOf(below);
      const g = stairGeometry(st);
      const toG = (p) => frame.toGame(p, level.id);
      let poly = g.corners.map(toG);
      if (signedArea(poly) < 0) poly = poly.reverse();
      const centre = poly.reduce((a, p) => [a[0] + p[0] / 4, a[1] + p[1] / 4], [0, 0]);
      const room = levelRooms[li].find((r) => inside(centre, r.polygon));
      if (!room) {
        warnings.push(`${level.name}: trappa står ikke i noe rom – hoppet over`);
        continue;
      }
      // the hole inside its room: clipped to the room (a side dragged a little into the wall lands on the face)
      const clipped = clipPolygon(room.polygon, poly);
      const xs = clipped.map((p) => p[0]);
      const zs = clipped.map((p) => p[1]);
      const box = [Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs)];
      if (clipped.length < 3 || Math.abs(signedArea(clipped)) < 0.95 * (box[2] - box[0]) * (box[3] - box[1])) {
        warnings.push(`${level.name}: trappehullet går over en vegg – tegn det inne i ett rom`);
        continue;
      }
      // the box of the clipped part can still reach out of a room that is not convex there (hus1 without AI: the loft's
      // edge 4 mm in from the box on one half, the room going on beyond it on the other): each side that lies outside is
      // moved in onto the room's parallel edge (at most 0,15 m), until the hole lies inside (the validator allows 10 cm²)
      const outside = (b) => (b[2] - b[0]) * (b[3] - b[1]) - Math.abs(signedArea(clipPolygon(room.polygon, [[b[0], b[1]], [b[2], b[1]], [b[2], b[3]], [b[0], b[3]]])));
      for (let round = 0; round < 4 && outside(box) > 5e-4; round++) {
        const P = room.polygon;
        for (const [k, axis, sign] of [[1, 1, 1], [3, 1, -1], [0, 0, 1], [2, 0, -1]]) {
          let best = null;
          for (let i = 0; i < P.length; i++) {
            const a = P[i];
            const b = P[(i + 1) % P.length];
            if (Math.abs(a[axis] - b[axis]) > 1e-6) continue;
            const v = a[axis];
            const d = (v - box[k]) * sign;
            const lo = Math.min(a[1 - axis], b[1 - axis]);
            const hi = Math.max(a[1 - axis], b[1 - axis]);
            const span = axis === 1 ? [box[0], box[2]] : [box[1], box[3]];
            if (d <= 1e-6 || d > 0.15 || hi <= span[0] + 1e-6 || lo >= span[1] - 1e-6) continue;
            if (best == null || d > (best - box[k]) * sign) best = v;
          }
          if (best != null) box[k] = best;
        }
      }
      if (outside(box) > 5e-4) {
        warnings.push(`${level.name}: trappehullet går over en vegg – tegn det inne i ett rom`);
        continue;
      }
      // a side a few centimetres short of the room's face along it left a ledge of floor sticking out over the stair
      // well (F63, hus4: 3 cm): it goes out onto a parallel face within 6 cm that runs along most of it
      for (const [k, axis, sign] of [[1, 1, 1], [3, 1, -1], [0, 0, 1], [2, 0, -1]]) {
        const P = room.polygon;
        const span = axis === 1 ? [box[0], box[2]] : [box[1], box[3]];
        let best = null;
        for (let i = 0; i < P.length; i++) {
          const p = P[i];
          const q = P[(i + 1) % P.length];
          if (Math.abs(p[axis] - q[axis]) > 1e-6) continue;
          const out = (box[k] - p[axis]) * sign;
          const cover = Math.min(span[1], Math.max(p[1 - axis], q[1 - axis])) - Math.max(span[0], Math.min(p[1 - axis], q[1 - axis]));
          if (out <= 1e-6 || out > 0.06 || cover < 0.8 * (span[1] - span[0])) continue;
          if (best == null || out < (box[k] - best) * sign) best = p[axis];
        }
        if (best == null) continue;
        const was = box[k];
        box[k] = best;
        if (outside(box) > 5e-4) box[k] = was;
      }
      // a side on an exterior wall's face comes 6 cm in: a strip of floor stays along the wall, and its edge closes the
      // slot between the storeys there (F152, hus4: the sky showed between the walls beside the stair)
      const upperExt = house.walls.filter((w) => w.exterior && w.thickness > 0 && roomLevel.get(w.roomId) === upper.id);
      for (const [k, axis, sign] of [[1, 1, 1], [3, 1, -1], [0, 0, 1], [2, 0, -1]]) {
        const span = axis === 1 ? [box[0], box[2]] : [box[1], box[3]];
        const onExt = upperExt.some((w) => {
          if (Math.abs(w.from[axis] - w.to[axis]) > 1e-3 || Math.abs(w.from[axis] - box[k]) > 0.03) return false;
          const lo = Math.min(w.from[1 - axis], w.to[1 - axis]);
          const hi = Math.max(w.from[1 - axis], w.to[1 - axis]);
          return Math.min(span[1], hi) - Math.max(span[0], lo) > 0.5 * (span[1] - span[0]);
        });
        if (onExt) box[k] += 0.06 * sign;
      }
      const hole = [[box[0], box[1]], [box[2], box[1]], [box[2], box[3]], [box[0], box[3]]].map(RP);
      // the floor's hole: the rectangle, or for an L only the two flights (F160: the floor over the inner corner was
      // open, and one saw through the floor from the stair)
      let holePoly = hole;
      // the way down in game coordinates, and the edges on the (clipped) hole
      const dG = unit(frame.vecToGame(g.down));
      const along = (p) => dot(p, dG);
      const lo = Math.min(...hole.map(along));
      const hi = Math.max(...hole.map(along));
      const topPts = hole.filter((p) => Math.abs(along(p) - lo) < 1e-6);
      const footPts = hole.filter((p) => Math.abs(along(p) - hi) < 1e-6);
      if (topPts.length !== 2 || footPts.length !== 2) {
        warnings.push(`${level.name}: trappa har ingen tydelig retning – hoppet over`);
        continue;
      }
      // a U stair's sides as the editor draws them (editor.js _drawUStair): its top flight starts at the plan's first top
      // corner (stairGeometry top[0]) unless st.side is 1 – generate.js orientStair chooses the side by its landings
      // (a quarter-turn stair the same way: side 0 turns toward the first top corner, side 1 toward the other)
      if (st.kind === 'u' || st.kind === 'l') {
        const n0 = toG(g.top[0]);
        if (dist(topPts[1], n0) < dist(topPts[0], n0)) topPts.reverse();
      }
      const lowerRooms = levelRooms[lowerIdx] || [];
      const footMid = st.kind === 'u' ? mul(add(add(topPts[0], topPts[1]), mul(add(footPts[0], footPts[1]), 1)), 0.25) : mul(add(footPts[0], footPts[1]), 0.5);
      const lowerRoom = lowerRooms.find((r) => inside(st.kind === 'u' ? footMid : add(footMid, mul(dG, -0.3)), r.polygon)) ?? lowerRooms.find((r) => inside(mul(add(add(topPts[0], topPts[1]), mul(add(footPts[0], footPts[1]), 1)), 0.25), r.polygon));
      if (!lowerRoom) warnings.push(`${level.name}: fant ikke rommet under trappa i ${below.name} – juster etasjene mot hverandre`);
      const rise = upper.floorY - below.floorY;
      const risers = Math.max(2, Math.round(rise / 0.18));
      const id = `trapp-${++counts.stairs}`;
      const holeId = `trappehull-${counts.stairs}`;
      // guards: the hole's sides that do not run along a wall of the upper level, except the top edge. A room edge
      // without a wall (an open boundary, a separator) needs one: the stair came up into the living room of hus4
      // through a piece split off by a line, and its open side had no railing (F67)
      const wallsHere = house.walls.filter((w) => roomLevel.get(w.roomId) === upper.id && (w.thickness > 0 || [].concat(w.backOf ?? []).some((id) => wallById.get(id)?.thickness > 0)));
      const onFace = (a, b) => {
        for (const w of wallsHere) {
          const c = w.from;
          const L = dist(c, w.to);
          if (L < 1e-6) continue;
          const u = [(w.to[0] - c[0]) / L, (w.to[1] - c[1]) / L];
          const off = (p) => Math.abs((p[0] - c[0]) * u[1] - (p[1] - c[1]) * u[0]);
          if (off(a) > 0.03 || off(b) > 0.03) continue;
          const along = (p) => (p[0] - c[0]) * u[0] + (p[1] - c[1]) * u[1];
          const lo = Math.max(0, Math.min(along(a), along(b)));
          const hi = Math.min(L, Math.max(along(a), along(b)));
          // a passage in the wall (the stair room open to the living room under a header) is no wall for a railing
          const open = (w.openings || []).filter((o) => o.type === 'opening').reduce((sum, o) => sum + Math.max(0, Math.min(hi, o.offset + o.width) - Math.max(lo, o.offset)), 0);
          if (hi - lo - open > 0.5 * dist(a, b)) return true;
        }
        return false;
      };
      // the flights: a straight stair runs the whole rectangle; a U stair (half-turn with winders, the game's
      // «half-turn-winder») has its top flight on one half of the near side, descends to the far end, turns around a
      // narrow well and comes back on the other half to the near end
      const u = st.kind === 'u';
      // the game's stair types (notes/trapper.md): a quarter turn with winders, a steep stair for a small shaft
      const quarter = st.kind === 'l';
      const steep = st.kind === 'steep';
      const guards = [];
      const guard = (a, b) => guards.push({ id: `rekk-${counts.stairs}-${guards.length + 1}`, level: upper.id, line: [RP(a), RP(b)] });
      let top;
      let foot;
      let extra = {};
      if (quarter) {
        // the rectangle is the whole L, as a plan draws it and the customer drags it: the top flight down one long side
        // from the top end, the turn (a square of the flight's width) in the far corner, the foot flight along the far
        // end to the other side (side 0: the top flight at the first top corner, the foot flight toward the second)
        const N0 = topPts[0];
        const N1 = topPts[1];
        const e = unit(sub(N1, N0));
        const B = dist(N0, N1);
        const A = hi - lo;
        const w = st.flight ?? Math.max(0.7, Math.min(1.0, Math.min(A, B) * 0.5));
        if (B < w + 0.4 || A < w + 0.6) {
          warnings.push(`${level.name}: den kvartsvingte trappa er for liten (${round(B, 2)} × ${round(A, 2)} m) for løp på ${round(w, 2)} m`);
          continue;
        }
        const P = (acr, alg) => add(add(N0, mul(e, acr)), mul(dG, alg));
        const first = !(st.side === 1);
        top = { edge: (first ? [P(0, 0), P(w, 0)] : [P(B - w, 0), P(B, 0)]).map(RP), down: RP(dG) };
        foot = first ? { edge: [P(B, A - w), P(B, A)].map(RP), down: RP(e) } : { edge: [P(0, A - w), P(0, A)].map(RP), down: RP(mul(e, -1)) };
        extra = { winders: 'balanced' };
        holePoly = (first ? [P(0, 0), P(w, 0), P(w, A - w), P(B, A - w), P(B, A), P(0, A)] : [P(B - w, 0), P(B, 0), P(B, A), P(0, A), P(0, A - w), P(B - w, A - w)]).map(RP);
        // (the format's polygons wind with a positive area, like the rectangle's)
        if (Math.sign(signedArea(holePoly)) !== Math.sign(signedArea(hole))) holePoly.reverse();
        // guards: the hole's sides not along a wall, except the top flight's own top edge (the way off upstairs)
        for (let i = 0; i < holePoly.length; i++) {
          const p = holePoly[i];
          const q = holePoly[(i + 1) % holePoly.length];
          const isTop = Math.abs(along(p) - lo) < 1e-6 && Math.abs(along(q) - lo) < 1e-6;
          if (isTop || onFace(p, q)) continue;
          guard(p, q);
        }
      } else if (!u) {
        top = { edge: topPts.map(RP), down: RP(dG) };
        foot = { edge: footPts.map(RP), down: RP(dG) };
        for (let i = 0; i < 4; i++) {
          const a = hole[i];
          const b = hole[(i + 1) % 4];
          const isTop = Math.abs(along(a) - lo) < 1e-6 && Math.abs(along(b) - lo) < 1e-6;
          if (isTop || onFace(a, b)) continue;
          guard(a, b);
        }
      } else {
        const N0 = topPts[0];
        const N1 = topPts[1];
        const e = unit(sub(N1, N0));
        const W = dist(N0, N1);
        const L = hi - lo;
        const wellW = Math.min(0.2, Math.max(0.06, W * 0.06));
        const half = (W - wellW) / 2;
        if (half < 0.6 || L < half + 0.4) {
          warnings.push(`${level.name}: U-trappa er for liten (${round(W, 2)} × ${round(L, 2)} m) – den trenger minst 1,3 m bredde og plass til svingen`);
          continue;
        }
        const P = (acr, alg) => add(add(N0, mul(e, acr)), mul(dG, alg));
        const sideA = !(st.side === 1);
        const topHalf = sideA ? [P(0, 0), P(half, 0)] : [P(half + wellW, 0), P(W, 0)];
        const footHalf = sideA ? [P(half + wellW, 0), P(W, 0)] : [P(0, 0), P(half, 0)];
        const turn = half; // the winders fill a square at the far end
        const well = [P(half, 0), P(half + wellW, 0), P(half + wellW, L - turn), P(half, L - turn)];
        const flight = L - turn;
        const nStraight = Math.max(1, Math.min(Math.floor((risers - 4) / 2), Math.round(flight / 0.25)));
        top = { edge: topHalf.map(RP), down: RP(dG), straightTreads: nStraight };
        foot = { edge: footHalf.map(RP), down: RP(mul(dG, -1)), straightTreads: nStraight };
        extra = { well: { polygon: (signedArea(well) < 0 ? [...well].reverse() : well).map(RP), newel: RP(sideA ? P(half, 0) : P(half + wellW, 0)) }, footprint: hole, winders: 'balanced', walkLine: 'flight-centre' };
        // guards: the near side over the foot flight, the long sides and the far side unless along a wall, the well
        if (!onFace(footHalf[0], footHalf[1])) guard(footHalf[0], footHalf[1]);
        for (let i = 0; i < 4; i++) {
          const a = hole[i];
          const b = hole[(i + 1) % 4];
          const isNear = Math.abs(along(a) - lo) < 1e-6 && Math.abs(along(b) - lo) < 1e-6;
          if (isNear || onFace(a, b)) continue;
          guard(a, b);
        }
        guards.push({ id: `rekk-${counts.stairs}-oye`, on: 'well' });
      }
      // the walk line (src/home/stairs.js; generate.js stairWalkLength) against the steepest the player walks up
      const W0 = dist(topPts[0], topPts[1]);
      const well0 = Math.min(0.2, Math.max(0.06, W0 * 0.06));
      const half0 = (W0 - well0) / 2;
      const walk = u ? 2 * Math.max(0, hi - lo - half0) + (Math.PI * half0) / 2 + well0 : quarter ? (risers - 1) * 0.25 : hi - lo;
      const slope = (Math.atan2(rise, walk) * 180) / Math.PI;
      const maxSlope = (Math.acos(WALKABLE_NORMAL_Y) * 180) / Math.PI;
      // (a steep stair is steep on purpose: the game climbs it up to its limit, notes/trapper.md)
      if (slope > maxSlope && !steep) warnings.push(`${level.name}: trappa er for bratt å gå i (${round(slope, 0)}° med ${round(walk, 2)} m ganglinje for ${round(rise, 2)} m; høyst ${round(maxSlope, 0)}°) – den trenger minst ${round(rise / Math.tan((maxSlope * Math.PI) / 180), 1)} m ganglinje`);
      floorOpenings.push({ id: holeId, levelId: upper.id, roomId: room.id, stairId: id, polygon: holePoly, edgeBand: { color: '#f2efe8', depth: 0.3 }, estimated: ['polygon'] });
      stairs.push({
        id,
        name: 'Trapp',
        planbyggerId: st.id,
        type: u ? 'half-turn-winder' : quarter ? 'quarter-turn-winder' : steep ? 'steep' : 'straight',
        fromLevel: below.id,
        toLevel: upper.id,
        openingId: holeId,
        roomIds: [lowerRoom?.id ?? room.id, room.id],
        risers,
        top,
        foot,
        ...extra,
        tread: { thickness: 0.04, nosing: 0.03, material: 'oak', color: '#bfab9b' },
        // closed risers as in most Norwegian houses (F7)
        openRisers: false,
        riser: { color: '#f2efe8' },
        stringers: { color: '#1d1e21', thickness: 0.05, depth: 0.28 },
        guards,
        // the posts end at the floor (hang 0): the owner's posts hang 0.45 m down, which looked wrong elsewhere (F12, F21, F42)
        guardStyle: { height: 1.0, stairHeight: 0.9, post: 0.065, baluster: 0.022, spacing: 0.13, topRail: [0.07, 0.05], color: '#1d1e21', hang: 0 },
        estimated: ['*'],
        source: `planbyggeren: ${u ? 'U-trapp' : quarter ? 'kvartsvingt trapp' : steep ? 'bratt trapp' : 'rett trapp'} ${R(dist(topPts[0], topPts[1]))} × ${R(hi - lo)} m, ${risers} opptrinn à ${R(rise / risers)}`,
      });
    }
  });
}

/**
 * The roof (notes/tak.md): over the top level, the type the facades show (doc.roof; a gable roof when there are no
 * facades), one part per wing – the level's footprint (its rooms and outer walls) covered by up to three rectangles
 * along the house's main axis, the largest first. A top level that is a loft (roof windows, «loft» in its name or its
 * rooms) gets sloped ceilings (type 'roof', flat at the room's height as a collar beam) and knee walls of 1.2 m; any
 * other top level keeps its flat ceilings with the roof resting on its walls.
 */
function exportRoofs({ doc, house, warnings, RP, R, frame, decks = [] }) {
  const levels = [...house.levels].sort((a, b) => b.floorY - a.floorY);
  const top = levels[0];
  if (!top) return;
  const roomsHere = house.rooms.filter((r) => r.levelId === top.id);
  const ids = new Set(roomsHere.map((r) => r.id));
  const outer = house.walls.filter((w) => ids.has(w.roomId) && w.exterior && w.thickness > 0);
  const slabs = house.walls.filter((w) => ids.has(w.roomId) && w.thickness > 0);
  if (!roomsHere.length || !outer.length) return;
  // the main axis: the longest outer wall
  const longest = outer.reduce((b, w) => (dist(w.from, w.to) > dist(b.from, b.to) ? w : b));
  const ax = unit(sub(longest.to, longest.from));
  const ay = [-ax[1], ax[0]];
  const toL = (p) => [dot(p, ax), dot(p, ay)];
  const toG = (u, v) => add(mul(ax, u), mul(ay, v));
  // the footprint in the main axis' frame: the rooms and the walls' slabs (behind the room face), inner walls too
  const polys = [
    ...roomsHere.map((r) => r.polygon.map(toL)),
    ...slabs.map((w) => {
      const n = w.normal ?? perp(unit(sub(w.to, w.from)));
      const o = (p, k) => toL([p[0] - n[0] * k, p[1] - n[1] * k]);
      return [o(w.from, 0), o(w.to, 0), o(w.to, w.thickness), o(w.from, w.thickness)];
    }),
  ];
  const pts = polys.flat();
  const u0 = Math.min(...pts.map((p) => p[0]));
  const v0 = Math.min(...pts.map((p) => p[1]));
  const CELL = 0.1;
  const nu = Math.ceil((Math.max(...pts.map((p) => p[0])) - u0) / CELL);
  const nv = Math.ceil((Math.max(...pts.map((p) => p[1])) - v0) / CELL);
  if (!(nu > 0 && nv > 0) || nu * nv > 4e6) return;
  const on = new Uint8Array(nu * nv);
  for (let j = 0; j < nv; j++)
    for (let i = 0; i < nu; i++) {
      const c = [u0 + (i + 0.5) * CELL, v0 + (j + 0.5) * CELL];
      if (polys.some((P) => pointInPolygon(c, P))) on[j * nu + i] = 1;
    }
  const total = on.reduce((s, x) => s + x, 0);
  // what the plans and the AI say about this level (houseread.js, the Himling step): the ceiling texts with their room
  // points and ridge lines, the AI's roof wings – all in plan metres of the level
  const docL = doc.levels.find((l) => l.id === top.id);
  const marks = docL?.ceilingMarks ?? [];
  const G = (q) => frame.toGame(q, top.id);
  const wingsHere = (doc.roof?.wings ?? []).filter((w) => w.level === top.id);
  // the AI's wings: each room to the wing whose rooms it holds (else the wing of the nearest room), each wing the
  // rectangle around its rooms and their walls – an L whose wings are no clean rectangles (hus2: the entrance niche, the
  // laundry's jut) is split where the drawings split it
  const wingParts = (() => {
    if (wingsHere.length < 2) return null;
    const owner = new Map();
    for (const r of roomsHere) {
      let best = -1;
      let most = 0;
      wingsHere.forEach((w, k) => {
        const n = w.points.filter((q) => pointInPolygon(G(q), r.polygon)).length;
        if (n > most) [best, most] = [k, n];
      });
      if (best >= 0) owner.set(r.id, best);
    }
    if (!owner.size) return null;
    for (const r of roomsHere) {
      if (owner.has(r.id)) continue;
      let best = null;
      let bd = Infinity;
      for (const s of roomsHere) {
        if (!owner.has(s.id)) continue;
        const d = dist(centroid(r.polygon), centroid(s.polygon));
        if (d < bd) [best, bd] = [owner.get(s.id), d];
      }
      owner.set(r.id, best);
    }
    const boxes = wingsHere.map(() => null);
    const grow = (k, q) => {
      const l = toL(q);
      const b = (boxes[k] ??= [Infinity, Infinity, -Infinity, -Infinity]);
      [b[0], b[1], b[2], b[3]] = [Math.min(b[0], l[0]), Math.min(b[1], l[1]), Math.max(b[2], l[0]), Math.max(b[3], l[1])];
    };
    for (const r of roomsHere) for (const q of r.polygon) grow(owner.get(r.id), q);
    for (const w of slabs) {
      const k = owner.get(w.roomId);
      if (k == null) continue;
      const n = w.normal ?? perp(unit(sub(w.to, w.from)));
      for (const q of [w.from, w.to, sub(w.from, mul(n, w.thickness)), sub(w.to, mul(n, w.thickness))]) grow(k, q);
    }
    const out = boxes.filter(Boolean).map((b) => {
      const i0 = Math.max(0, Math.floor((b[0] - u0) / CELL + 0.25));
      const i1 = Math.min(nu, Math.ceil((b[2] - u0) / CELL - 0.25));
      const j0 = Math.max(0, Math.floor((b[1] - v0) / CELL + 0.25));
      const j1 = Math.min(nv, Math.ceil((b[3] - v0) / CELL - 0.25));
      let area = 0;
      for (let j = j0; j < j1; j++) for (let i = i0; i < i1; i++) area += on[j * nu + i];
      return { area, i0, i1, j0, j1 };
    });
    // one box, or boxes that overlap so much that they are one roof: not wings
    if (out.length < 2 || out.reduce((s, p) => s + p.area, 0) > 1.3 * total) return null;
    return out.sort((a, b) => b.area - a.area);
  })();
  // without the AI's wings: an L (or a T, a jut) cut in two where its two halves fill their rectangles best – one cut
  // across the whole footprint, along either axis; kept when it fills clearly better than the one rectangle (hus2's L
  // has an entrance niche and a jut, which the largest-rectangle method below broke into four pieces)
  const splitParts = (() => {
    if (wingParts || total >= 0.85 * nu * nv) return null;
    // per column (and per row) its count of footprint cells and their first and last row: the box of a band of columns
    // in one pass over the band
    const lines = (n, m, at) => {
      const cnt = new Int32Array(n);
      const lo = new Int32Array(n).fill(m);
      const hi = new Int32Array(n).fill(-1);
      for (let a = 0; a < n; a++)
        for (let b = 0; b < m; b++)
          if (at(a, b)) {
            cnt[a]++;
            lo[a] = Math.min(lo[a], b);
            hi[a] = Math.max(hi[a], b);
          }
      return { cnt, lo, hi };
    };
    const C = lines(nu, nv, (i, j) => on[j * nu + i]);
    const Rw = lines(nv, nu, (j, i) => on[j * nu + i]);
    // the box of the band [a, b) of columns (cols) or rows: { area, i0, i1, j0, j1 } | null
    const band = (L, a, b, cols) => {
      let area = 0;
      let first = -1;
      let last = -1;
      let lo = Infinity;
      let hi = -Infinity;
      for (let k = a; k < b; k++) {
        if (!L.cnt[k]) continue;
        area += L.cnt[k];
        if (first < 0) first = k;
        last = k;
        lo = Math.min(lo, L.lo[k]);
        hi = Math.max(hi, L.hi[k]);
      }
      if (!area) return null;
      return cols ? { area, i0: first, i1: last + 1, j0: lo, j1: hi + 1 } : { area, i0: lo, i1: hi + 1, j0: first, j1: last + 1 };
    };
    const fillOf = (ps) => ps.reduce((s, p) => s + p.area, 0) / ps.reduce((s, p) => s + (p.i1 - p.i0) * (p.j1 - p.j0), 0);
    let best2 = null;
    let best3 = null;
    const MIN = 10; // a wing at least 1 m
    for (const [L, n, cols] of [[C, nu, true], [Rw, nv, false]]) {
      for (let c = MIN; c <= n - MIN; c++) {
        const ps = [band(L, 0, c, cols), band(L, c, n, cols)];
        if (ps.every(Boolean) && (!best2 || fillOf(ps) > best2.fill)) best2 = { ps, fill: fillOf(ps) };
        // a U or an H: two cuts along the same axis
        for (let d = c + MIN; d <= n - MIN; d += 2) {
          const qs = [band(L, 0, c, cols), band(L, c, d, cols), band(L, d, n, cols)];
          if (qs.every(Boolean) && (!best3 || fillOf(qs) > best3.fill)) best3 = { ps: qs, fill: fillOf(qs) };
        }
      }
    }
    const one = total / (nu * nv);
    // three parts only when they fill clearly better than two
    const best = best3 && (!best2 || best3.fill >= best2.fill + 0.05) ? best3 : best2;
    return best && best.fill >= 0.88 && best.fill >= one + 0.1 ? best.ps.sort((a, b) => b.area - a.area) : null;
  })();
  // a level that nearly fills its rectangle gets one roof over all of it (wings only for an L or a T)
  const whole = !wingParts && !splitParts && total >= 0.85 * nu * nv;
  // the largest rectangle of cells still to cover (histogram method), up to three while it pays off
  const parts = wingParts ? [...wingParts] : splitParts ? [...splitParts] : [];
  const left = Uint8Array.from(on);
  if (whole) parts.push({ area: total, i0: 0, i1: nu, j0: 0, j1: nv });
  for (let n = 0; n < 4 && !whole && !wingParts && !splitParts; n++) {
    const hgt = new Int32Array(nu);
    let best = null;
    for (let j = 0; j < nv; j++) {
      for (let i = 0; i < nu; i++) hgt[i] = left[j * nu + i] ? hgt[i] + 1 : 0;
      const stack = [];
      for (let i = 0; i <= nu; i++) {
        const hh = i < nu ? hgt[i] : 0;
        let start = i;
        while (stack.length && stack[stack.length - 1][1] >= hh) {
          const [si, sh] = stack.pop();
          const area = sh * (i - si);
          if (!best || area > best.area) best = { area, i0: si, i1: i, j0: j - sh + 1, j1: j + 1 };
          start = si;
        }
        stack.push([start, hh]);
      }
    }
    if (!best || best.area * CELL * CELL < 1) break;
    parts.push(best);
    for (let j = best.j0; j < best.j1; j++) for (let i = best.i0; i < best.i1; i++) left[j * nu + i] = 0;
  }
  // the wings are kept when every wall of the level stands inside one of them (a wall outside them stood under another
  // part's overhang, where the roof comes down and cut it below its doors); else one roof over the level's rectangle.
  // One roof over an L covered the empty corner too (F136)
  const inPart = (q) => parts.some((p) => q[0] >= u0 + p.i0 * CELL - 0.12 && q[0] <= u0 + p.i1 * CELL + 0.12 && q[1] >= v0 + p.j0 * CELL - 0.12 && q[1] <= v0 + p.j1 * CELL + 0.12);
  const wallsIn = slabs.every((w) => {
    const n = w.normal ?? perp(unit(sub(w.to, w.from)));
    const o = (p, k) => toL([p[0] - n[0] * k, p[1] - n[1] * k]);
    return [o(w.from, 0), o(w.to, 0), o(w.from, w.thickness), o(w.to, w.thickness), o([(w.from[0] + w.to[0]) / 2, (w.from[1] + w.to[1]) / 2], w.thickness)].every(inPart);
  });
  if (!whole && (!wallsIn || parts.reduce((sum, p) => sum + p.area, 0) < 0.95 * total)) parts.splice(0, parts.length, { area: total, i0: 0, i1: nu, j0: 0, j1: nv });
  if (!parts.length) return;
  const kind = doc.roof?.type;
  const type = kind === 'hip' || kind === 'mono-pitch' || kind === 'flat' ? kind : 'gable';
  const loft = top.floorY > 0.5 && (/loft/i.test(top.name) || roomsHere.some((r) => /loft/i.test(r.name ?? '')) || house.ceilings.some((c) => ids.has(c.roomId) && c.skylights?.length));
  // a loft under a gable or hip roof: knee walls of KNEE on the eave sides (along a part's longer side, the ridge's
  // default), and a dormer (ark) over each window or door in them that reaches above the knee wall – the way the drawings
  // show it (hus1 «gable-dormer», F126, F127, F129). Its front is on the wall's outer face, 0.3 m wider than the openings
  const KNEE = 1.2;
  // a loft's eave as the facades show it (generate.js doc.roof.eaveTop, the eave over the loft's floor: hus1's is at
  // the floor, F159 – the house was 1,2 m too high with knee walls in the outer walls), never under 5 cm (the storey
  // below stands up to the floor); without facades knee walls of KNEE
  const eaveLoft = Number.isFinite(doc.roof?.eaveTop) ? Math.max(0.05, Math.min(1.6, doc.roof.eaveTop)) : null;
  const kneeOf = (pitch) => (eaveLoft != null ? eaveLoft + 0.25 * Math.tan(((pitch ?? 35) * Math.PI) / 180) : KNEE);
  // tekking: the AI's reading of the roof (houseread.js) in the house format's words
  const COVERING = { tiles: 'tile', slate: 'slate', felt: 'felt', metal: 'steel' };
  const dormersOf = (p, knee = KNEE) => {
    const along = p.i1 - p.i0 >= p.j1 - p.j0 ? ax : ay;
    const out = [];
    for (const w of outer) {
      const L = dist(w.from, w.to);
      if (L < 0.1) continue;
      const d = unit(sub(w.to, w.from));
      if (Math.abs(dot(d, along)) < 0.9) continue;
      const n = w.normal ?? perp(d);
      const tall = (w.openings || []).filter((o) => (o.sill ?? 0) + (o.height ?? 0) > knee - 0.05).map((o) => [Math.max(0, o.offset - 0.3), Math.min(L, o.offset + o.width + 0.3)]).sort((x, y) => x[0] - y[0]);
      const merged = [];
      for (const iv of tall) {
        const last = merged[merged.length - 1];
        if (last && iv[0] <= last[1] + 0.2) last[1] = Math.max(last[1], iv[1]);
        else merged.push([...iv]);
      }
      for (const [u0, u1] of merged) {
        const P = (u) => [w.from[0] + d[0] * u - n[0] * w.thickness, w.from[1] + d[1] * u - n[1] * w.thickness];
        const top = Math.max(...(w.openings || []).filter((o) => o.offset < u1 && o.offset + o.width > u0).map((o) => (o.sill ?? 0) + (o.height ?? 0)));
        out.push({ id: `ark-${w.id}-${out.length + 1}`, type: doc.roof?.dormerType === 'shed' ? 'shed' : 'gable', front: [P(u0), P(u1)].map(RP), height: R(Math.max(2.2, top + 0.15)) });
      }
    }
    return out;
  };
  const inPartOf =(p, q, slack = 0.05) => {
    const l = toL(q);
    return l[0] >= u0 + p.i0 * CELL - slack && l[0] <= u0 + p.i1 * CELL + slack && l[1] >= v0 + p.j0 * CELL - slack && l[1] <= v0 + p.j1 * CELL + slack;
  };
  /** The part's roof: the ridge line drawn with a sloped ceiling (its direction, and at an edge: a mono-pitch roof high
   *  there), else the AI's wing with most of its rooms in the part, else the house's type from the facades. */
  const roofOf = (p, withRise = true) => {
    const line = marks.find((m) => m.kind === 'sloped' && m.ridge && inPartOf(p, G([(m.ridge[0][0] + m.ridge[1][0]) / 2, (m.ridge[0][1] + m.ridge[1][1]) / 2])));
    // the AI's wing of this part: one with most of its rooms in it (F155: a «gable» wing over rooms all over hus5
    // made all three parts gables, steep at the default 35°)
    let wing = null;
    let most = 0;
    for (const w of wingsHere) {
      const n = w.points.filter((q) => inPartOf(p, G(q))).length;
      if (n >= 0.6 * w.points.length && n > most) [wing, most] = [w, n];
    }
    const written = doc.roof?.pitchSet ?? marks.find((m) => m.kind === 'sloped' && m.degrees && m.points.some((q) => inPartOf(p, G(q))))?.degrees ?? doc.roof?.pitch ?? null;
    // the AI's type only where it split the house into wings: one roof over it all keeps the facades' type (they read
    // hus1's half-hip with dormers right, the AI called it hip – notes/planbygger.md, «KI-laget»)
    const wingType = wingsHere.length >= 2 && ['gable', 'hip', 'mono-pitch', 'flat'].includes(wing?.type) ? wing.type : null;
    const typeHere = wingType ?? type;
    const out = { type: typeHere, from: wingType ? 'KI' : kind ? 'fasadene' : null };
    if (line) {
      const a = G(line.ridge[0]);
      const b = G(line.ridge[1]);
      const dir = unit(sub(b, a));
      // across the ridge: where the line lies between the part's two long edges
      const across = Math.abs(dot(dir, ax)) >= Math.abs(dot(dir, ay)) ? 1 : 0;
      const mid = toL(mul(add(a, b), 0.5));
      const lo = across ? v0 + p.j0 * CELL : u0 + p.i0 * CELL;
      const hi = across ? v0 + p.j1 * CELL : u0 + p.i1 * CELL;
      const t = (mid[across] - lo) / Math.max(0.1, hi - lo);
      if (t < 0.2 || t > 0.8) {
        // the ridge along one edge: a mono-pitch roof, high there, falling to the other side
        const n = across ? ay : ax;
        out.type = 'mono-pitch';
        out.fall = (t < 0.5 ? n : mul(n, -1)).map((v) => R(v) || 0);
      } else {
        out.type = out.type === 'flat' || out.type === 'mono-pitch' ? 'gable' : out.type;
        out.ridge = dir.map((v) => R(v) || 0);
      }
      out.from = 'planen (mønelinja)';
    } else {
      // (one AI wing over the whole house says nothing about a part of it: its ridge only for one roof)
      if (wing?.ridge && (wingsHere.length >= 2 || parts.length === 1) && (out.type === 'gable' || out.type === 'hip')) out.ridge = unit(frame.vecToGame(wing.ridge)).map((v) => R(v) || 0);
      // a mono-pitch roof's fall: the AI's per wing where it split the house, else the end views' high side (classical,
      // facadematch.js roofFromFacades), else the AI's
      if (out.type === 'mono-pitch') {
        const f = wingsHere.length >= 2 && wing?.fall ? wing.fall : doc.roof?.monoHigh ? doc.roof.monoHigh.map((v) => -v) : wing?.fall;
        if (f) out.fall = unit(frame.vecToGame(f)).map((v) => R(v) || 0);
      }
    }
    // the facades' measured slope only for the type it was measured on (a gable end's, a mono-pitch end's); a gable's
    // or a hip's from the long sides' rise (one pitch for the house, over the main part's depth), else the gable ends'
    const pitchedHere = out.type === 'gable' || out.type === 'hip';
    const measured = out.type === 'mono-pitch' ? doc.roof?.pitchMono : pitchedHere ? (withRise ? risePitchOf() : null) ?? doc.roof?.pitchGable ?? doc.roof?.pitchFacades : null;
    const degrees = written ?? measured ?? null;
    if (degrees) out.pitch = degrees;
    return out;
  };
  /** A part's depth across its ridge (along its longer side when no ridge is given). */
  const depthAcross = (p, ridge) => (ridge ? (Math.abs(dot(ridge, ax)) >= Math.abs(dot(ridge, ay)) ? p.j1 - p.j0 : p.i1 - p.i0) : Math.min(p.i1 - p.i0, p.j1 - p.j0)) * CELL;
  /** The pitch from the facades' long-side rise (generate.js doc.roof.riseFacades, the eave to the ridge): over half the
   *  biggest part's depth across its ridge, 15–60° (a rise read off a wing seen end on is no pitch) */
  let risePitch;
  const risePitchOf = () => {
    if (risePitch !== undefined) return risePitch;
    risePitch = null;
    const rise = doc.roof?.riseFacades;
    const main = [...parts].sort((x, y) => y.area - x.area)[0];
    if (!(rise > 0) || !main) return null;
    const depth = depthAcross(main, roofOf(main, false).ridge);
    const deg = depth > 1 ? (Math.atan(rise / (depth / 2)) * 180) / Math.PI : null;
    risePitch = deg >= 15 && deg <= 60 ? Math.round(deg) : null;
    return risePitch;
  };
  const NAMES = { gable: 'saltak', hip: 'valmtak', 'mono-pitch': 'pulttak', flat: 'flatt tak' };
  house.roofs = parts.map((p, i) => {
    const a = toG(u0 + p.i0 * CELL, v0 + p.j0 * CELL);
    const b = toG(u0 + p.i1 * CELL, v0 + p.j0 * CELL);
    const c = toG(u0 + p.i1 * CELL, v0 + p.j1 * CELL);
    const d = toG(u0 + p.i0 * CELL, v0 + p.j1 * CELL);
    const rf = roofOf(p);
    const pitched = rf.type === 'gable' || rf.type === 'hip';
    const dormers = loft && pitched && parts.length === 1 ? dormersOf(p, kneeOf(rf.pitch)) : [];
    return {
      id: `roof-${i + 1}`,
      type: rf.type,
      levelId: top.id,
      outline: [a, b, c, d].map(RP),
      ...(rf.ridge ? { ridge: rf.ridge } : {}),
      ...(rf.fall ? { fall: rf.fall } : {}),
      ...(rf.pitch ? { pitch: rf.pitch } : {}),
      ...(loft && pitched ? (eaveLoft != null ? { eaveHeight: R(eaveLoft) } : { kneeHeight: KNEE }) : {}),
      ...(COVERING[doc.roof?.covering] ? { covering: COVERING[doc.roof.covering] } : {}),
      // small overhangs, as the facade drawings show them (F137)
      overhang: rf.type === 'flat' ? 0.15 : 0.25,
      vergeOverhang: 0.1,
      ...(dormers.length ? { dormers } : {}),
      estimated: ['*'],
      source: `planbyggeren: ${NAMES[rf.type]}${rf.from ? ` fra ${rf.from}` : ' (ingen fasader)'}${rf.pitch ? `, ${rf.pitch}°` : ''}${parts.length > 1 ? `, fløy ${i + 1} av ${parts.length}` : ''}${loft && pitched ? `, loft ${eaveLoft != null ? `med takfoten ${R(eaveLoft)} m over gulvet (fasadene)` : `med knevegg ${KNEE} m`}${dormers.length ? ` og ${dormers.length} ark${dormers.length > 1 ? 'er' : ''}` : ''}` : ''}`,
    };
  });
  // the ceilings: a loft follows the roof everywhere (flat at the room's height where the roof is higher, a collar
  // beam). Else per room: the Himling step's choice, else the ceiling texts in it («SKRÅ HIMLING» / «PLAN HIMLING»: the
  // most points of the texts in the room), else flat when the plans have ceiling texts (they marked the sloped rooms),
  // else the level's rule (generate.js, the question). A sloped ceiling goes up to the ridge (no height).
  if (loft) {
    for (const c of house.ceilings) if (ids.has(c.roomId)) Object.assign(c, { type: 'roof' });
  } else {
    for (const r of roomsHere) {
      const s = ceilingSlope(docL, (q) => pointInPolygon(G(q), r.polygon));
      if (!s.slope) continue;
      const c = house.ceilings.find((x) => x.roomId === r.id);
      if (!c) continue;
      c.type = 'roof';
      delete c.height;
      c.estimated = (c.estimated ?? []).filter((k) => k !== 'height');
      c.source = `planbyggeren: ${s.why === 'bruker' ? 'valgt i «Himling»' : s.why === 'tegning' ? `${s.text ? `«${s.text}»` : 'skrå himling'} på planen` : 'himlingen følger taket (gjettet, spurt om)'}`;
    }
  }
  const covered = parts.reduce((s, p) => s + p.area, 0) / total;
  if (covered < 0.9) warnings.push(`${top.name}: taket dekker bare ${Math.round(covered * 100)} % av etasjen (huset har en form med mer enn tre fløyer)`);
  // the parts of a lower level with no level over them (a garage, a storage room, a carport beside a two-storey house,
  // hus4): a flat roof of their own, over the largest rectangles of what the levels above leave open – a deck of a level
  // above is over it too (hus4's terrace over the carport and the storage room, F153: their roof stood up through it)
  for (const L of levels.slice(1)) {
    const rs = house.rooms.filter((r) => r.levelId === L.id);
    const lids = new Set(rs.map((r) => r.id));
    const own = house.walls.filter((w) => lids.has(w.roomId) && w.thickness > 0);
    const aboveIds = new Set(house.rooms.filter((r) => levels.some((l) => l.floorY > L.floorY + 0.5 && l.id === r.levelId)).map((r) => r.id));
    const above = house.walls.filter((w) => aboveIds.has(w.roomId) && w.thickness > 0);
    const slab = (w) => {
      const n = w.normal ?? perp(unit(sub(w.to, w.from)));
      const o = (q, k) => toL([q[0] - n[0] * k, q[1] - n[1] * k]);
      return [o(w.from, 0), o(w.to, 0), o(w.to, w.thickness), o(w.from, w.thickness)];
    };
    const mine = [...rs.map((r) => r.polygon.map(toL)), ...own.map(slab)];
    const aboveLevels = new Set(levels.filter((l) => l.floorY > L.floorY + 0.5).map((l) => l.id));
    const over = [...house.rooms.filter((r) => aboveIds.has(r.id)).map((r) => r.polygon.map(toL)), ...above.map(slab), ...decks.filter((dk) => aboveLevels.has(dk.levelId)).map((dk) => dk.outline.map(toL))];
    if (!mine.length || !over.length) continue;
    const q = mine.flat();
    const a0 = Math.min(...q.map((p) => p[0]));
    const b0 = Math.min(...q.map((p) => p[1]));
    const mu = Math.ceil((Math.max(...q.map((p) => p[0])) - a0) / CELL);
    const mv = Math.ceil((Math.max(...q.map((p) => p[1])) - b0) / CELL);
    if (!(mu > 0 && mv > 0) || mu * mv > 4e6) continue;
    // open: in this level's footprint, and more than a cell from everything above (no sliver along the upper walls)
    const open = new Uint8Array(mu * mv);
    let n = 0;
    for (let j = 0; j < mv; j++)
      for (let i = 0; i < mu; i++) {
        const c = [a0 + (i + 0.5) * CELL, b0 + (j + 0.5) * CELL];
        if (!mine.some((P) => pointInPolygon(c, P))) continue;
        const near = [[0, 0], [CELL, 0], [-CELL, 0], [0, CELL], [0, -CELL]].some(([dx, dy]) => over.some((P) => pointInPolygon([c[0] + dx, c[1] + dy], P)));
        if (!near) {
          open[j * mu + i] = 1;
          n++;
        }
      }
    if (n * CELL * CELL < 3) continue;
    for (let k = 0; k < 3; k++) {
      const hgt = new Int32Array(mu);
      let best = null;
      for (let j = 0; j < mv; j++) {
        for (let i = 0; i < mu; i++) hgt[i] = open[j * mu + i] ? hgt[i] + 1 : 0;
        const stack = [];
        for (let i = 0; i <= mu; i++) {
          const hh = i < mu ? hgt[i] : 0;
          let start = i;
          while (stack.length && stack[stack.length - 1][1] >= hh) {
            const [si, sh] = stack.pop();
            if (!best || sh * (i - si) > best.area) best = { area: sh * (i - si), i0: si, i1: i, j0: j - sh + 1, j1: j + 1 };
            start = si;
          }
          stack.push([start, hh]);
        }
      }
      // at least 1.5 m across and 3 m² (not the strip of a jut)
      if (!best || best.area * CELL * CELL < 3 || Math.min(best.i1 - best.i0, best.j1 - best.j0) * CELL < 1.5) break;
      for (let j = best.j0; j < best.j1; j++) for (let i = best.i0; i < best.i1; i++) open[j * mu + i] = 0;
      const corners = [[best.i0, best.j0], [best.i1, best.j0], [best.i1, best.j1], [best.i0, best.j1]].map(([i, j]) => toG(a0 + i * CELL, b0 + j * CELL));
      house.roofs.push({
        id: `roof-${L.id}-${k + 1}`,
        type: 'flat',
        levelId: L.id,
        outline: corners.map(RP),
        overhang: 0.15,
        vergeOverhang: 0.1,
        estimated: ['*'],
        source: `planbyggeren: flatt tak over den delen av ${L.name.toLowerCase()} som ikke har noen etasje over seg`,
      });
    }
  }
}

/** Colour words on Norwegian drawings → the house format's hex (an NCS code or anything else: none, the default's). */
const COLOR_WORDS = [
  [/beige\s*\/\s*brun|brun\s*\/\s*beige|lysebrun|lys\s*brun|\btan\b/i, '#b39e80'],
  [/antrasitt/i, '#3a3d40'],
  [/m[øo]rke?\s*gr[åa]/i, '#4a4642'],
  [/lyse?\s*gr[åa]/i, '#c9c8c3'],
  [/gr[åa]/i, '#8b8b88'],
  [/hvit|white/i, '#f2f0ea'],
  [/sort|svart|black/i, '#2a2a2a'],
  [/r[øo]d|red/i, '#8e2f25'],
  [/brun|brown/i, '#6b4a33'],
  [/beige|sand/i, '#d6cbb3'],
  [/bl[åa]|blue/i, '#50677c'],
  [/gr[øo]nn|green/i, '#5d6e55'],
  [/gul|yellow|oker/i, '#d8b65e'],
  [/natur|ubehandlet|beis/i, '#a07850'],
];
export const colorHex = (s) => (typeof s === 'string' ? (/^#[0-9a-f]{6}$/i.test(s.trim()) ? s.trim() : COLOR_WORDS.find(([re]) => re.test(s))?.[1] ?? null) : null);

/**
 * The house format's cladding (notes/kledning.md) from what the AI read on the facades (doc.cladding): the house's most
 * common finish as `default`, the gable triangles and the basement as zones when they differ, a 30 cm concrete plinth,
 * corner boards and surrounds (the windows' own frame colour). null without a reading.
 */
export function claddingOf(doc) {
  const c = doc.cladding;
  if (!c?.main?.type) return null;
  const finish = (f) => {
    const out = { type: f.type };
    if ((f.type === 'wood' || f.type === 'panels') && f.direction) out.direction = f.direction;
    if (f.type === 'wood') out.profile = (f.direction ?? 'vertical') === 'horizontal' ? 'shiplap' : 'board-batten';
    const hex = colorHex(f.color);
    if (hex) out.color = hex;
    return out;
  };
  const main = finish(c.main);
  const same = (f) => f.type === c.main.type && (f.direction ?? null) === (c.main.direction ?? null);
  const parts = (c.facades ?? []).flatMap((f) => f.parts ?? []);
  const zones = [];
  const gable = parts.find((p) => p.part === 'gable' && p.type && !same(p));
  if (gable) zones.push({ id: 'gavl', name: 'Gavlene', gable: true, ...finish(gable), source: 'planbyggeren: KI-en på fasadene' });
  const basement = parts.find((p) => p.part === 'basement' && p.type && !same(p));
  for (const L of doc.levels.filter((l) => (l.floorY ?? 0) < -0.5)) if (basement) zones.push({ id: `kjeller-${L.id}`, name: L.name, levelId: L.id, ...finish(basement), source: 'planbyggeren: KI-en på fasadene' });
  return {
    default: main,
    ...(zones.length ? { zones } : {}),
    plinth: { height: 0.3, material: 'concrete' },
    trim: { corners: true, surrounds: true },
  };
}

/**
 * The house format's decks from the document's (doc.decks with an outline, plan metres): on the level the plan is of,
 * 2 cm under its floor (the door threshold), boards or tiles as drawn, the railing the AI read, and one stair down from
 * the edge farthest from the house when the AI saw steps. The engine puts railings on the free edges with a fall.
 * Decks on one level that touch are one deck (F153: hus4's terrace and the balcony along the front had a railing
 * across between them, and three surfaces), with the surface, the kind and the railing of the largest. With `house`
 * (its rooms and walls), a deck on an upper level stands on the house, no posts, when every part of it is over a room
 * of the level below or at most 1,6 m from a wall (a balcony out from the wall; hus4's terrace over the carport and the
 * storage room, F150) – the engine's default for its kind otherwise.
 */
export function decksOf(doc, frame, RP = (p) => p, house = null) {
  const pieces = [];
  for (const d of doc.decks ?? []) {
    const L = doc.levels.find((l) => l.id === d.level);
    if (!L || !Array.isArray(d.outline) || d.outline.length < 3) continue;
    const outline = d.outline.map((p) => frame.toGame(p, L.id));
    pieces.push({ d, L, outline, area: Math.abs(signedArea(outline)) });
  }
  // touching decks on a level → one (a seam under 0,1 m closes: regions.js footprint); one inside another goes in it
  const groups = pieces.map((p) => ({ ...p, parts: [p] }));
  for (let merged = true; merged; ) {
    merged = false;
    for (let i = 0; i < groups.length && !merged; i++)
      for (let j = i + 1; j < groups.length && !merged; j++) {
        const A = groups[i];
        const B = groups[j];
        if (A.L !== B.L) continue;
        const [big, small] = A.area >= B.area ? [A, B] : [B, A];
        const inside = small.outline.every((q) => pointInPolygon(q, big.outline) || big.outline.some((r) => dist(r, q) < 0.05));
        const union = inside ? big.outline : footprint([A.outline, B.outline]);
        const area = Math.abs(signedArea(union));
        // joined: the union is more than the larger one alone, and no more than both (a deck around the house would
        // fill the house)
        if (!inside && !(area > big.area + 0.2 && area <= A.area + B.area + 0.3)) continue;
        groups.splice(j, 1);
        groups[i] = { ...big, outline: union, area, parts: [...A.parts, ...B.parts] };
        merged = true;
      }
  }
  // what a deck can stand on: the rooms of the levels below it, and the walls of its own level and the one below
  const roomsBelow = (L) => (house?.rooms ?? []).filter((r) => (house.levels.find((l) => l.id === r.levelId)?.floorY ?? 0) < L.floorY - 0.5);
  const carried = (g) => {
    if (!house || !(g.L.floorY > 0.5)) return false;
    const rooms = roomsBelow(g.L);
    const near = house.walls.filter((w) => w.thickness > 0 && rooms.concat(house.rooms.filter((r) => r.levelId === g.L.id)).some((r) => r.id === w.roomId));
    const xs = g.outline.map((p) => p[0]);
    const zs = g.outline.map((p) => p[1]);
    const step = 0.25;
    for (let x = Math.min(...xs) + step / 2; x < Math.max(...xs); x += step)
      for (let z = Math.min(...zs) + step / 2; z < Math.max(...zs); z += step) {
        const q = [x, z];
        if (!pointInPolygon(q, g.outline) || rooms.some((r) => pointInPolygon(q, r.polygon))) continue;
        const d = Math.min(Infinity, ...near.map((w) => {
          const u = sub(w.to, w.from);
          const t = Math.max(0, Math.min(1, dot(sub(q, w.from), u) / Math.max(1e-9, dot(u, u))));
          return dist(q, add(w.from, mul(u, t)));
        }));
        if (d > 1.6) return false;
      }
    return true;
  };
  const out = [];
  for (const g of groups) {
    const { d, L } = g;
    const outline = g.outline.map(RP);
    const deck = { id: `dekk-${out.length + 1}`, kind: d.kind ?? 'terrace', levelId: L.id, y: -0.02, outline, surface: d.surface === 'tiles' ? 'tiles' : 'boards' };
    if (carried(g)) deck.supports = 'none';
    if (d.railing && d.railing !== 'unknown') deck.railing = { type: d.railing };
    if (g.parts.some((p) => p.d.stairs)) {
      // the edge farthest from the level's walls
      const mids = outline.map((p, i) => [(p[0] + outline[(i + 1) % outline.length][0]) / 2, (p[1] + outline[(i + 1) % outline.length][1]) / 2]);
      const wallPts = L.walls.flatMap((w) => [frame.toGame(w.a, L.id), frame.toGame(w.b, L.id)]);
      const far = (m) => Math.min(...wallPts.map((q) => Math.hypot(q[0] - m[0], q[1] - m[1])));
      const edge = mids.reduce((b, m, i) => (far(m) > far(mids[b]) ? i : b), 0);
      deck.stairs = [{ edge }];
    }
    deck.source = `planbyggeren: ${d.kind === 'balcony' ? 'balkongen' : 'terrassen'} KI-en så, omrisset fra planen${g.parts.length > 1 ? ` (${g.parts.length} dekk som henger sammen)` : ''}${deck.supports === 'none' ? ', står på huset' : ''}`;
    out.push(deck);
  }
  return out;
}

/** An 00-ids.json for a generated house: its levels, rooms and light groups, the game's schema. */
export function registryFor(house) {
  return {
    levels: Object.fromEntries(house.levels.map((l) => [l.id, { name: l.name, floorY: l.floorY }])),
    rooms: Object.fromEntries(house.rooms.map((r) => [r.id, { levelId: r.levelId, kind: r.kind }])),
    pseudoRooms: ['ute'],
    lightGroups: Object.fromEntries(house.lightGroups.map((g) => [g.id, { roomId: g.roomId, label: g.label, defaultDimmer: g.defaultDimmer }])),
    schema: idsRegistry.schema,
  };
}

/**
 * The room-spec base a generated house is merged onto (the game's own house has its photo-measured living room here;
 * a customer's house has none): every key layout.js reads, empty.
 */
export function baseSpec(name = 'Planbygger') {
  return {
    meta: { name, units: 'm', planFile: null, planPxPerM: null, planOriginPx: null, paints: {} },
    zones: [],
    floor: { polygon: [], material: 'oak-plank', color: '#b8a48c' },
    baseboard: { height: 0.07, thickness: 0.012, color: '#ece9e3' },
    walls: [],
    ceilings: [],
    bulkheads: [],
    builtInLights: [],
    kitchen: { items: [] },
    furniture: [],
    fixtures: [],
    highWall: { wallId: null, name: '', start: [0, 0], end: [0, 0], uDir: [1, 0], normal: [0, 1], width: 0, height: 0, obstacles: [] },
    outside: {},
    photoCameras: [],
  };
}

/**
 * Plain merge of a house file onto the base (what mergeHouse does for a base without entries of its own), ready for
 * home/layout.js buildLayout: layout.js takes the centroid of the living room's floor.polygon unconditionally, so a
 * house without the game's living room gets a zero-area floor at its first room corner (no point is ever inside it,
 * the bounds do not change). Request to the house work: let buildLayout accept an empty floor polygon.
 */
export function mergeOnto(base, house) {
  const out = JSON.parse(JSON.stringify(base));
  for (const [k, v] of Object.entries(house)) {
    if (k.startsWith('$')) continue;
    if (Array.isArray(v)) out[k] = [...(out[k] || []), ...JSON.parse(JSON.stringify(v))];
    else out[k] = JSON.parse(JSON.stringify(v));
  }
  if (!out.floor?.polygon?.length) {
    const p = out.rooms?.find((r) => r.polygon?.length)?.polygon[0] ?? [0, 0];
    out.floor = { ...(out.floor || {}), polygon: [[...p], [...p], [...p]] };
  }
  return out;
}

/** Errors of validateHouse that only concern the owner's own house (its photo-measured living room). */
export const OWNER_ONLY_ERRORS = [/rommet «stue-kjokken» mangler/];

/** True for a report message the planbygger does not count (see OWNER_ONLY_ERRORS). */
export const ownerOnly = (msg) => OWNER_ONLY_ERRORS.some((re) => re.test(msg));

/** Quick sanity numbers of a house file (for the UI). */
export function summary(house) {
  const rooms = house.rooms.map((r) => ({ id: r.id, name: r.name, levelId: r.levelId, kind: r.kind, area: round(Math.abs(signedArea(r.polygon)), 2), centre: centroid(r.polygon) }));
  const openings = house.walls.flatMap((w) => w.openings || []);
  return {
    rooms,
    doors: openings.filter((o) => o.type === 'door').length,
    windows: openings.filter((o) => o.type === 'window').length,
    passages: openings.filter((o) => o.type === 'opening').length,
    walls: house.walls.length,
    area: round(rooms.reduce((s, r) => s + r.area, 0), 2),
  };
}

export { cross };
