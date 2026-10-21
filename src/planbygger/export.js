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
 *     leaf … } and connects, passages as type 'opening'.
 * Coordinates: the plan is rotated so that game +x = south and +z = west (settings.north), then moved so that the main
 * level's rooms start at x = 0, z = 0.
 */
import idsRegistry from '../../research/house/00-ids.json';
import { findRooms } from './regions.js';
import { sub, add, mul, dot, cross, dist, unit, perp, signedArea, centroid, slug, round, clipPolygon } from './geom.js';
import { DEFAULT_SETTINGS, wallLength, wallDir } from './model.js';

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

/** A room kind and name for a region the user has not named (no OCR in v1: area and doors only). */
function guessKind(room, isLargest) {
  if (isLargest) return 'living';
  if (room.area < 2.6) return 'storage';
  if (room.doors >= 3 && room.area < 14) return 'hall';
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
  // doors per region (for the guess)
  const doorCount = new Map();
  for (const o of level.openings) {
    if (o.type !== 'door') continue;
    const w = level.walls.find((x) => x.id === o.wall);
    if (!w) continue;
    const u = wallDir(w);
    const c = add(w.a, mul(u, o.at));
    for (const s of [1, -1]) {
      const idx = found.at(...add(c, mul(perp(u), s * (w.t / 2 + 0.06))));
      if (idx >= 0) doorCount.set(idx, (doorCount.get(idx) || 0) + 1);
    }
  }
  const largest = found.rooms.reduce((b, r) => (!b || r.area > b.area ? r : b), null);
  const counters = {};
  const rooms = found.rooms.map((region) => {
    const label = used.get(region.index) ?? null;
    let kind = label?.kind;
    let name = label?.name;
    const auto = !label;
    if (!kind) kind = guessKind({ area: region.area, doors: doorCount.get(region.index) || 0 }, region === largest);
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
  const counts = { rooms: 0, walls: 0, backOf: 0, exterior: 0, doors: 0, windows: 0, openings: 0 };

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
    // facing edges: antiparallel, behind (outward), within the wall's thickness (+ 1 cm), overlapping
    const facing = (e) => {
      const out = [];
      const w = e.wall ? wallsById.get(e.wall) : null;
      const maxT = (w ? w.t : 0.6) + 0.01;
      for (const f of edgeList) {
        if (f.ri === e.ri) continue;
        if (dot(f.d, e.d) > -0.999) continue;
        const off = dot(sub(f.a, e.a), e.n); // f's line relative to e's, + = into e's room
        if (off > -0.005 || off < -maxT) continue;
        if (e.wall && f.wall && f.wall !== e.wall) continue;
        const fa = dot(sub(f.a, e.a), e.d);
        const fb = dot(sub(f.b, e.a), e.d);
        const lo = Math.min(fa, fb);
        const hi = Math.max(fa, fb);
        if (overlap(0, e.L, lo, hi) < 0.01) continue;
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
    // groups: consecutive pieces of an edge with the same role → one wall
    const groups = [];
    for (const e of edgeList) {
      const list = pieces.filter((p) => p.e === e);
      let g = null;
      for (const p of list) {
        if (g && p.role === g.role && p.role !== 'free') {
          g.pieces.push(p);
          g.to = p.to;
        } else {
          g = { ri: e.ri, e, role: p.role, pieces: [p], from: p.from, to: p.to };
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

    // ---- openings on their owner pieces
    const roomIdOf = (ri) => R2[ri]?.id ?? null;
    for (const o of level.openings) {
      const pw = wallsById.get(o.wall);
      if (!pw) continue;
      const u = wallDir(pw);
      const P0 = frame.toGame(add(pw.a, mul(u, o.at - o.width / 2)), levelId);
      const P1 = frame.toGame(add(pw.a, mul(u, o.at + o.width / 2)), levelId);
      const uGame = frame.vecToGame(u);
      // candidate walls: on a face of this plan wall, solid (a slab or a free wall)
      let best = null;
      for (const p of groups) {
        if (p.e.wall !== o.wall) continue;
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
      (wall.openings ||= []).push(entry);
    }
    for (const w of house.walls) if (w.openings) w.openings.sort((a, b) => a.offset - b.offset);

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
      house.ceilings.push({ id: `c-${r.id}`, roomId: r.id, polygon: r.polygon.map(RP), height: R(r.ceiling), color: LOOK.ceiling, estimated: ['height'] });
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
