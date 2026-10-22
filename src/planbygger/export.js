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
import { levelRooms as roomsOfLevel, wallBand } from './regions.js';
import { sub, add, mul, dot, cross, dist, unit, perp, signedArea, centroid, slug, round, clipPolygon, pointInPolygon } from './geom.js';
import { DEFAULT_SETTINGS, wallLength, wallDir, stairGeometry } from './model.js';
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

/**
 * The sashes of a window the drawings say nothing more about, until the facade round reads them from the facades
 * (notes/vindusmodeller.md: fractions of the hole, from the left as seen from the room, and up from the sill): one
 * top-hung opening sash up to 0.8 m wide, a fixed and a side-hung one from 0.8 m, three from 1.4 m (fixed in the
 * middle), and a fixed panel under a transom 0.5 m up in a window that stands on the floor and is at least 1.8 m tall.
 */
function defaultSashes(width, height, sill) {
  const transom = sill < 0.03 && height >= 1.8 ? round(0.5 / height, 3) : 0;
  const row =
    width < 0.8
      ? [{ from: 0, to: 1, opening: true, hinge: 'top' }]
      : width < 1.4
        ? [{ from: 0, to: 0.5, opening: false }, { from: 0.5, to: 1, opening: true, hinge: 'right' }]
        : [{ from: 0, to: 0.3, opening: true, hinge: 'left' }, { from: 0.3, to: 0.7, opening: false }, { from: 0.7, to: 1, opening: true, hinge: 'right' }];
  const sashes = row.map((x) => ({ ...x, bottom: transom, top: 1 }));
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
      // the other room's piece on the same stretch (the same cuts were made on both sides)
      let best = null;
      for (const q of piecesOf[p.behind.ri]) {
        if (!q.behind || q.behind.ri !== p.ri || dot(q.e.d, p.e.d) > -0.999) continue;
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
    for (const g of groups) {
      if (g.e.separator == null || g.role !== 'slab') continue;
      const wall = wallObjs.get(g);
      const owner = R2[g.ri].id;
      const other = g.pieces.find((p) => p.partner && !p.absorbed)?.partner;
      const L = Math.floor(dist(wall.from, wall.to) * 1000) / 1000;
      if (!other || L < 0.02) continue;
      wall.openings = [{ id: `open-${owner}-${++counts.openings}`, type: 'opening', offset: 0, width: L, height: wall.height, sill: 0, connects: [owner, R2[other.ri].id], estimated: ['*'], source: `planbyggeren: ${/^cut/.test(g.e.separator) ? 'åpen plan rundt et rom midt i rommet (delt med en tenkt linje)' : 'skillelinje mellom to soner'}, ingen vegg` }];
      counts.openBoundaries++;
    }

    // ---- openings on their owner pieces
    const roomIdOf = (ri) => R2[ri]?.id ?? null;
    // double and sliding doors are the game's own door types (notes/dortyper.md); until they came, a double door was
    // two single doors side by side and a sliding door a hinged one
    const asBuilt = level.openings.map((o) => (o.type === 'door' && (o.variant === 'double' || o.variant === 'sliding') ? { ...o, built: o.variant } : o));
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
          entry.sashes = defaultSashes(width, h, sill);
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
            const terrace = exterior && !['entrance', 'hall', 'storage', 'laundry', 'bathroom'].includes(room.kind);
            const look = { ...(exterior ? {} : { leafColor: LOOK.door }), ...(terrace ? { glass: { cols: width >= 1.2 ? 2 : 1, rows: 3 } } : {}) };
            if (o.built === 'double') {
              // the leaves fill the hole between the jambs; the drawn arcs' radii give their ratio
              entry.door = { variant: 'double', hinge, swing, opensInto, leaf: { w: R(o.leaf ?? width / 2), h: R(h - 0.04) }, leaf2: { w: R(o.leaf2 ?? o.leaf ?? width / 2) }, ...(o.openAngle && o.openAngle !== 90 ? { openAngleDeg: o.openAngle } : {}), handleHeight: 1.05, closed: true, ...look };
            } else if (o.built === 'sliding') {
              // the leaf parks at the hinge jamb (model.js); two leaves part both ways. An outer one is a glass patio
              // door when it is wide enough for its half-width opening (the figure needs 0.62 m), else on a rail
              const patio = exterior && width >= 1.35;
              const slide = o.leaves === 2 && !patio ? 'both' : hinge;
              entry.door = { variant: 'sliding', mount: patio ? 'patio' : 'surface', slide, swing, opensInto, closed: true, ...look };
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
        if (o.door?.variant !== 'sliding' || o.door.mount !== 'surface' || o.door.slide === 'both' || !(w.thickness >= 0.08)) continue;
        const need = o.width + 0.04;
        const free = (a, b) => a >= -1e-6 && b <= L + 1e-6 && !os.some((q) => q !== o && q.offset < b && q.offset + q.width > a);
        for (const side of o.door.slide === 'to' ? ['to', 'from'] : ['from', 'to']) {
          const [a, b] = side === 'from' ? [o.offset - need, o.offset] : [o.offset + o.width, o.offset + o.width + need];
          if (!free(a, b)) continue;
          o.door.mount = 'pocket';
          o.door.slide = side;
          break;
        }
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

    // ---- rooms, ceilings, lights
    for (const r of R2) {
      const [mat, color] = LOOK.floor[r.kind] ?? LOOK.floor.living;
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
      const hole = [[box[0], box[1]], [box[2], box[1]], [box[2], box[3]], [box[0], box[3]]].map(RP);
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
      if (st.kind === 'u') {
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
      const guards = [];
      const guard = (a, b) => guards.push({ id: `rekk-${counts.stairs}-${guards.length + 1}`, level: upper.id, line: [RP(a), RP(b)] });
      let top;
      let foot;
      let extra = {};
      if (!u) {
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
      const walk = u ? 2 * Math.max(0, hi - lo - half0) + (Math.PI * half0) / 2 + well0 : hi - lo;
      const slope = (Math.atan2(rise, walk) * 180) / Math.PI;
      const maxSlope = (Math.acos(WALKABLE_NORMAL_Y) * 180) / Math.PI;
      if (slope > maxSlope) warnings.push(`${level.name}: trappa er for bratt å gå i (${round(slope, 0)}° med ${round(walk, 2)} m ganglinje for ${round(rise, 2)} m; høyst ${round(maxSlope, 0)}°) – den trenger minst ${round(rise / Math.tan((maxSlope * Math.PI) / 180), 1)} m ganglinje`);
      floorOpenings.push({ id: holeId, levelId: upper.id, roomId: room.id, stairId: id, polygon: hole, edgeBand: { color: '#f2efe8', depth: 0.3 }, estimated: ['polygon'] });
      stairs.push({
        id,
        name: 'Trapp',
        planbyggerId: st.id,
        type: u ? 'half-turn-winder' : 'straight',
        fromLevel: below.id,
        toLevel: upper.id,
        openingId: holeId,
        roomIds: [lowerRoom?.id ?? room.id, room.id],
        risers,
        top,
        foot,
        ...extra,
        tread: { thickness: 0.04, nosing: 0.03, material: 'oak', color: '#bfab9b' },
        openRisers: true,
        stringers: { color: '#1d1e21', thickness: 0.05, depth: 0.28 },
        guards,
        guardStyle: { height: 1.0, stairHeight: 0.9, post: 0.065, baluster: 0.022, spacing: 0.13, topRail: [0.07, 0.05], color: '#1d1e21' },
        estimated: ['*'],
        source: `planbyggeren: ${u ? 'U-trapp' : 'rett trapp'} ${R(dist(topPts[0], topPts[1]))} × ${R(hi - lo)} m, ${risers} opptrinn à ${R(rise / risers)}`,
      });
    }
  });
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
