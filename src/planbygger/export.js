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
 *     another room);
 *   • each opening is defined once, on the owner piece (offset from `from`), doors with door:{ hinge, swing, opensInto,
 *     leaf … } and connects, passages as type 'opening'. What the format cannot hold is built as the nearest thing it
 *     can: a double door as two single doors side by side (one per leaf), a sliding door as a passage; their `source`
 *     says so. Skylights go on their room's ceiling entry as data (`skylights: [{ id, polygon }]`, nothing builds them).
 * Coordinates: the plan is rotated so that game +x = south and +z = west (settings.north), then moved so that the main
 * level's rooms start at x = 0, z = 0.
 */
import idsRegistry from '../../research/house/00-ids.json';
import { findRooms, wallBand } from './regions.js';
import { sub, add, mul, dot, cross, dist, unit, perp, signedArea, centroid, slug, round, clipPolygon, pointInPolygon } from './geom.js';
import { DEFAULT_SETTINGS, wallLength, wallDir, stairGeometry } from './model.js';

const RESERVED_IDS = new Set(['stue-kjokken', 'trapp', 'ute', 'forplass']);
const MAIN = 'hoved';
const EPS = 1e-6;

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
  const found = findRooms(level.walls);
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
  const counts = { rooms: 0, walls: 0, backOf: 0, exterior: 0, doors: 0, windows: 0, openings: 0, stairs: 0, doubleDoors: 0, slidingDoors: 0, skylights: 0 };
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
        edgeList.push({ ri, i, a, b, L, d, n: perp(d), wall: r.edges[i]?.wall ?? null, side: r.edges[i]?.side ?? 0 });
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
    // facing edges: antiparallel, behind (outward), within the wall's thickness (+ 1 cm), overlapping
    const facing = (e) => {
      const out = [];
      const w = e.wall ? wallsById.get(e.wall) : null;
      const maxT = (w ? w.t : 0.6) + 0.01;
      for (const f of edgeList) {
        if (f.ri === e.ri) continue;
        if (dot(f.d, e.d) > -0.999) continue;
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
    // roles: 'slab' = owns a shared slab (the room with the lower index), 'face' = the backOf side, 'free' = no room
    // behind (exterior, or a wall end / a shaft)
    for (const p of pieces) {
      p.partner = partnerOf(p);
      p.role = p.partner ? (p.ri < p.partner.ri ? 'slab' : 'face') : 'free';
    }
    // a short free piece between / next to shared pieces of the same edge lies in front of the end of an abutting wall
    // (a T joint): it takes its neighbour's role (a face reaches over it, a slab covers the joint)
    const SHORT = 0.6;
    for (const e of edgeList) {
      const list = pieces.filter((p) => p.e === e);
      list.forEach((p, k) => {
        if (p.role !== 'free' || dist(p.from, p.to) >= SHORT) return;
        const nb = [list[k - 1], list[k + 1]].filter((q) => q && q.role !== 'free' && !q.absorbed);
        if (!nb.length) return;
        const q = nb.sort((x, y) => dist(y.from, y.to) - dist(x.from, x.to))[0];
        p.role = q.role;
        p.absorbed = true;
      });
    }
    // groups: consecutive pieces of an edge with the same role → one wall; a slab is cut where the distance to the
    // faces behind it changes (a wall line that changes thickness: each part gets its own thickness)
    const groups = [];
    const depthOf = (p) => (p.absorbed || !p.behind ? null : p.behind.t);
    for (const e of edgeList) {
      const list = pieces.filter((p) => p.e === e);
      let g = null;
      for (const p of list) {
        const t = depthOf(p);
        const sameDepth = p.role !== 'slab' || t == null || g?.depth == null || Math.abs(t - g.depth) <= 0.01;
        if (g && p.role === g.role && p.role !== 'free' && sameDepth) {
          g.pieces.push(p);
          g.to = p.to;
          if (g.depth == null) g.depth = t;
        } else {
          g = { ri: e.ri, e, role: p.role, pieces: [p], from: p.from, to: p.to, depth: t };
          groups.push(g);
        }
        p.group = g;
      }
    }

    // the distance behind a group to the nearest other room (a ray from the middle, outward)
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

    // ---- thicknesses: the shared slabs first (the distance between the faces), then the free walls: the plan's
    //      thickness, at least exteriorMin, except where the slab would overlap another room or another room's slab
    //      (two rooms' exterior walls meeting at an outer corner) – there the wall is cut and that piece thinned to the
    //      overlap's depth, so only the corner gets thinner
    const slabRect = (g, t) => [g.from, g.to, add(g.to, mul(g.e.n, -t)), add(g.from, mul(g.e.n, -t))];
    const solid = [];
    for (const g of groups) {
      if (g.role !== 'slab') continue;
      g.t = Math.max(...g.pieces.filter((p) => !p.absorbed).map((p) => p.behind.t));
      solid.push(g);
    }
    const conflicts = (g, t) => {
      const rect = slabRect(g, t);
      const L = dist(g.from, g.to);
      const out = [];
      const test = (poly) => {
        const c = clipPolygon(poly, rect);
        if (c.length < 3 || Math.abs(signedArea(c)) < 2e-4) return;
        const us = c.map((p) => dot(sub(p, g.from), g.e.d));
        const ds = c.map((p) => -dot(sub(p, g.from), g.e.n));
        out.push({ u0: Math.max(0, Math.min(...us)), u1: Math.min(L, Math.max(...us)), depth: Math.max(0, Math.min(...ds)) });
      };
      for (let ri = 0; ri < R2.length; ri++) if (ri !== g.ri) test(R2[ri].polygon);
      for (const o of solid) if (o.ri !== g.ri) test(slabRect(o, o.t));
      return out;
    };
    const split = [];
    for (const g of groups) {
      if (g.role !== 'free') {
        split.push(g);
        continue;
      }
      const planWall = g.e.wall ? wallsById.get(g.e.wall) : null;
      const want = Math.max(planWall ? planWall.t : 0.2, settings.exteriorMin ?? 0);
      const L = dist(g.from, g.to);
      const cs = conflicts(g, want);
      const cuts = new Set([0, L]);
      for (const c of cs) for (const u of [c.u0, c.u1]) if (u > 0.01 && u < L - 0.01) cuts.add(u);
      const us = [...cuts].sort((p, q) => p - q);
      const parts = [];
      for (let k = 0; k < us.length - 1; k++) {
        const u0 = us[k];
        const u1 = us[k + 1];
        if (u1 - u0 < 0.005) continue;
        let t = want;
        for (const c of cs) if (c.u1 > u0 + 1e-4 && c.u0 < u1 - 1e-4) t = Math.min(t, c.depth - 0.002);
        t = Math.max(0.005, Math.floor(t * 1000) / 1000);
        const prev = parts[parts.length - 1];
        if (prev && Math.abs(prev.t - t) < 1e-6) prev.u1 = u1;
        else parts.push({ u0, u1, t });
      }
      for (const p of parts) {
        const sg = { ...g, from: add(g.from, mul(g.e.d, p.u0)), to: add(g.from, mul(g.e.d, p.u1)), t: p.t };
        sg.exterior = rayToRooms(sg) > 1.2;
        if (p.t < 0.6 * (planWall ? planWall.t : want) && p.u1 - p.u0 > 0.3) warnings.push(`${level.name}: en yttervegg i ${R2[g.ri].name} er tynnet til ${round(p.t, 3)} m på ${round(p.u1 - p.u0, 2)} m for ikke å gå inn i et annet rom`);
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
        const w = { id, roomId: r.id, from: RP(g.from), to: RP(g.to), normal: RP(g.e.n) };
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

    // ---- openings on their owner pieces. The house format has hinged single leaves only: a double door becomes two
    //      doors side by side in its hole (one per leaf, hinged at the jambs, the same swing), a sliding door a passage
    //      of its width (notes/planbygger.md, «Forespørsler»)
    const roomIdOf = (ri) => R2[ri]?.id ?? null;
    const asBuilt = level.openings.flatMap((o) => {
      if (o.type === 'door' && o.variant === 'double') {
        const half = o.width / 2;
        return [
          { ...o, at: o.at - half / 2, width: half, hinge: 'start', leaf: o.leaf, built: 'double', part: 1 },
          { ...o, at: o.at + half / 2, width: half, hinge: 'end', leaf: o.leaf2 ?? o.leaf, built: 'double', part: 2 },
        ];
      }
      if (o.type === 'door' && o.variant === 'sliding') return [{ ...o, type: 'opening', built: 'sliding' }];
      return [o];
    });
    for (const o of asBuilt) {
      const pw = wallsById.get(o.wall);
      if (!pw) continue;
      const u = wallDir(pw);
      const P0 = frame.toGame(add(pw.a, mul(u, o.at - o.width / 2)), levelId);
      const P1 = frame.toGame(add(pw.a, mul(u, o.at + o.width / 2)), levelId);
      const uGame = frame.vecToGame(u);
      // candidate walls: on a face of this plan wall, solid (a slab or a free wall)
      let best = null;
      for (const p of groups) {
        // (a room edge along a wall line that changes thickness may carry the other plan wall's id)
        if (p.e.wall !== o.wall && !(p.e.wall && sameLine(p.e.wall, o.wall))) continue;
        if (p.role === 'face') continue;
        const L = dist(p.from, p.to);
        const a = dot(sub(P0, p.from), p.e.d);
        const b = dot(sub(P1, p.from), p.e.d);
        const ov = overlap(0, L, Math.min(a, b), Math.max(a, b));
        if (ov > 0.02 && (!best || ov > best.ov)) best = { p, ov, a: Math.min(a, b), b: Math.max(a, b), L };
      }
      if (!best) {
        warnings.push(`${level.name}: åpningen ${o.id} (${o.type}) står ikke på noen romvegg – hoppet over`);
        continue;
      }
      const { p, L } = best;
      let off = best.a;
      let width = best.b - best.a;
      if (off < 0 || off + width > L) {
        const a = Math.max(0, off);
        const b = Math.min(L, off + width);
        if (b - a < 0.2) {
          warnings.push(`${level.name}: åpningen ${o.id} får ikke plass i veggen ${groupId.get(p)} – hoppet over`);
          continue;
        }
        warnings.push(`${level.name}: åpningen ${o.id} er kuttet til veggen ${groupId.get(p)} (${round(width, 2)} → ${round(b - a, 2)} m)`);
        off = a;
        width = b - a;
      }
      const wall = wallObjs.get(p);
      const owner = roomIdOf(p.ri);
      // the room behind the opening (the partner of the piece under its middle), else outside
      const midU = (Math.max(0, off) + Math.min(L, off + width)) / 2;
      const under = p.pieces.find((q) => dot(sub(q.to, p.from), p.e.d) >= midU - 1e-6) ?? p.pieces[p.pieces.length - 1];
      const firstPartner = p.pieces.find((q) => q.partner && !q.absorbed)?.partner ?? null;
      const other = under.partner && !under.absorbed ? roomIdOf(under.partner.ri) : firstPartner ? roomIdOf(firstPartner.ri) : 'ute';
      const room = R2[p.ri];
      const wallH = wall.height ?? room.ceiling;
      const entry = { id: null, type: o.type === 'door' ? 'door' : o.type === 'window' ? 'window' : 'opening', offset: R(off), width: R(width) };
      if (entry.type === 'window') {
        const sill = o.sill ?? settings.windowSill;
        const h = Math.min(o.height ?? settings.windowHeight, wallH - sill - 0.05);
        entry.id = `win-${owner}-${++counts.windows}`;
        entry.height = R(h);
        entry.sill = R(sill);
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
          const frameW = 0.06;
          const leafW = Math.min(o.leaf ?? width - 2 * frameW, width - 2 * frameW);
          const exterior = other === 'ute';
          entry.frame = { color: LOOK.frame, width: frameW, depth: 0.02 };
          entry.door = {
            hinge,
            swing,
            opensInto: swing === 'in' ? owner : other,
            leaf: { w: R(leafW), h: R(h - 0.04) },
            ...(o.openAngle && o.openAngle !== 90 ? { openAngleDeg: o.openAngle } : {}),
            handleSide: hinge === 'from' ? 'to' : 'from',
            handleHeight: 1.05,
            closed: true,
            ...(exterior ? {} : { leafColor: LOOK.door }),
          };
          entry.interactive = true;
          entry.estimated = ['*'];
        } else {
          entry.id = `open-${owner}-${++counts.openings}`;
          entry.estimated = ['*'];
        }
      }
      if (o.built === 'double') {
        entry.source = `planbyggeren: dobbeltdør, blad ${o.part} av 2 (bygget som to dører)`;
        if (o.part === 1) counts.doubleDoors++;
      } else if (o.built === 'sliding') {
        entry.source = 'planbyggeren: skyvedør (bygget som åpning)';
        counts.slidingDoors++;
      }
      (wall.openings ||= []).push(entry);
    }
    for (const w of house.walls) if (w.openings) w.openings.sort((a, b) => a.offset - b.offset);

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
      const lowerRooms = levelRooms[lowerIdx] || [];
      const footMid = st.kind === 'u' ? mul(add(add(topPts[0], topPts[1]), mul(add(footPts[0], footPts[1]), 1)), 0.25) : mul(add(footPts[0], footPts[1]), 0.5);
      const lowerRoom = lowerRooms.find((r) => inside(st.kind === 'u' ? footMid : add(footMid, mul(dG, -0.3)), r.polygon)) ?? lowerRooms.find((r) => inside(mul(add(add(topPts[0], topPts[1]), mul(add(footPts[0], footPts[1]), 1)), 0.25), r.polygon));
      if (!lowerRoom) warnings.push(`${level.name}: fant ikke rommet under trappa i ${below.name} – juster etasjene mot hverandre`);
      const rise = upper.floorY - below.floorY;
      const risers = Math.max(2, Math.round(rise / 0.18));
      const id = `trapp-${++counts.stairs}`;
      const holeId = `trappehull-${counts.stairs}`;
      // guards: the hole's sides that are not on a wall face of the room, except the top edge
      const onFace = (a, b) => {
        const P = room.polygon;
        for (let i = 0; i < P.length; i++) {
          const c = P[i];
          const d = P[(i + 1) % P.length];
          const L = dist(c, d);
          if (L < 1e-6) continue;
          const u = [(d[0] - c[0]) / L, (d[1] - c[1]) / L];
          const off = (p) => Math.abs((p[0] - c[0]) * u[1] - (p[1] - c[1]) * u[0]);
          if (off(a) < 0.03 && off(b) < 0.03) return true;
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
