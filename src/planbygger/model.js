/**
 * Planbygger: the plan document the correction editor edits (one per house, one level per uploaded floor plan).
 *
 *   doc = {
 *     version: 1, name,
 *     settings: { north, ceiling, doorHeight, windowSill, windowHeight, exteriorMin, origin },
 *     levels: [{
 *       id, name, floorY, ceiling,
 *       image: { name, width, height, pxPerM, scaleRef: { a: [px], b: [px], metres } | null },
 *       offset: [dx, dy],                 metres: where this level's plan frame lies in the main level's frame
 *       walls:    [{ id, a: [x, y], b: [x, y], t }]                          plan metres (pixels / pxPerM), a → b
 *       openings: [{ id, wall, type: 'door'|'window'|'opening', at, width, height?, sill?,
 *                    hinge: 'start'|'end', side: 1|-1, leaf?, openAngle?, auto? }]   at = centre, metres from a;
 *                                                                          openAngle: a door's degrees (default 90)
 *       rooms:    [{ id, name, kind, seed: [x, y], ceiling?, floor? }]      labels; the polygons are found (regions.js)
 *       stairs:   [{ id, rect: [[x0, y0], [x1, y1]], axis: 'x'|'y', down: 1|-1, kind?: 'straight'|'u', side?: 0|1 }]
 *                 a stair from this level
 *                 down to the level under it: rect = the hole in this floor, axis / down = the direction it descends
 *     }],
 *   }
 *
 * Plan frame: x to the right, y down in the image, metres. settings.north is the image direction of north in degrees
 * clockwise from «up» (0 = north is up, 90 = right, 180 = down, 270 = left). The export rotates the plan so that the
 * game's +x is south and +z west (notes/hele-huset-design.md: «+x = sør, +z = vest»).
 *
 * Pure functions on plain JSON: the editor keeps the undo history as snapshots (history()).
 */
import { sub, add, mul, dot, dist, unit, perp, projectToSegment, round, roundPt } from './geom.js';

export const ROOM_KINDS = Object.freeze([
  ['living', 'Stue'],
  ['bedroom', 'Soverom'],
  ['bathroom', 'Bad'],
  ['hall', 'Gang'],
  ['laundry', 'Vaskerom'],
  ['storage', 'Bod'],
  ['entrance', 'Entré'],
]);

export const DEFAULT_SETTINGS = Object.freeze({
  /** image direction of north, degrees clockwise from up */
  north: 0,
  ceiling: 2.4,
  doorHeight: 2.1,
  windowSill: 0.9,
  windowHeight: 1.2,
  /** exterior walls thinner than this get this thickness outward (the plan draws them thinner than they are) */
  exteriorMin: 0.25,
});

let counter = 0;
/** A new id with a prefix that is unique in this document session. */
export function newId(prefix, taken = null) {
  for (;;) {
    counter++;
    const id = `${prefix}${Date.now().toString(36).slice(-4)}${counter.toString(36)}`;
    if (!taken || !taken.has(id)) return id;
  }
}

export function createDoc(name = 'Mitt hus') {
  return { version: 1, name, settings: { ...DEFAULT_SETTINGS }, levels: [] };
}

export function createLevel(doc, { id, name, floorY = 0, image = null } = {}) {
  const ids = new Set(doc.levels.map((l) => l.id));
  const lid = id ?? (ids.has('hoved') ? `etasje-${doc.levels.length + 1}` : 'hoved');
  const level = {
    id: lid,
    name: name ?? (lid === 'hoved' ? '1. etasje' : `Etasje ${doc.levels.length + 1}`),
    floorY,
    ceiling: null,
    image,
    offset: [0, 0],
    walls: [],
    openings: [],
    rooms: [],
    stairs: [],
  };
  doc.levels.push(level);
  return level;
}

export const clone = (v) => JSON.parse(JSON.stringify(v));

// ---------------------------------------------------------------------------------------------------------------
// From the detection

/**
 * Fills a level from detectPlan's result (pixels) – replaces its walls and openings, keeps room labels.
 * @param {object} level
 * @param {object} det  detectPlan(img, { pxPerM }) result
 * @param {number} pxPerM
 */
export function applyDetection(level, det, pxPerM, settings = DEFAULT_SETTINGS) {
  const k = 1 / pxPerM;
  const ids = det.walls.map((_, i) => `w${i + 1}`);
  level.walls = det.walls.map((w, i) => ({
    id: ids[i],
    a: roundPt(mul(w.a, k), 4),
    b: roundPt(mul(w.b, k), 4),
    t: round(w.t * k, 4),
    exterior: !!w.exterior,
    outsideSide: w.outsideSide ?? 0,
    auto: true,
  }));
  level.openings = det.openings.map((o, i) => {
    const width = (o.to - o.from) * k;
    const base = {
      id: `o${i + 1}`,
      wall: ids[o.wall],
      type: o.type,
      at: round(((o.from + o.to) / 2) * k, 4),
      width: round(width, 4),
      auto: true,
    };
    if (o.type === 'door') {
      base.hinge = o.hinge ?? 'start';
      base.side = o.side || 1;
      if (o.leaf) base.leaf = round(Math.min(width, o.leaf * k), 3);
    }
    if (o.type === 'window') {
      base.sill = settings.windowSill;
      base.height = settings.windowHeight;
    }
    return base;
  });
  return level;
}

// ---------------------------------------------------------------------------------------------------------------
// Queries

export const wallById = (level, id) => level.walls.find((w) => w.id === id) ?? null;
export const wallLength = (w) => dist(w.a, w.b);
export const wallDir = (w) => unit(sub(w.b, w.a));
export const openingsOf = (level, wallId) => level.openings.filter((o) => o.wall === wallId);

/** The point at distance s from a along the wall, offset k along its left normal. */
export function wallPoint(w, s, k = 0) {
  const u = wallDir(w);
  return add(add(w.a, mul(u, s)), mul(perp(u), k));
}

/** Nearest wall to a point: { wall, s (along), d (distance to the centre line), t (0…1) } or null. */
export function nearestWall(level, p, maxDist = Infinity) {
  let best = null;
  for (const w of level.walls) {
    const pr = projectToSegment(p, w.a, w.b);
    if (pr.d <= maxDist && (!best || pr.d < best.d)) best = { wall: w, s: pr.t * wallLength(w), t: pr.t, d: pr.d };
  }
  return best;
}

// ---------------------------------------------------------------------------------------------------------------
// Editing operations (they mutate the level; the editor snapshots before each)

export function addWall(level, a, b, t = 0.1) {
  const id = newId('w', new Set(level.walls.map((w) => w.id)));
  const w = { id, a: roundPt(a, 4), b: roundPt(b, 4), t: round(t, 4) };
  level.walls.push(w);
  return w;
}

export function deleteWall(level, id) {
  level.walls = level.walls.filter((w) => w.id !== id);
  level.openings = level.openings.filter((o) => o.wall !== id);
}

/** Moves a wall's end ('a' | 'b') – openings keep their distance from a (clamped into the wall). */
export function moveWallEnd(level, id, end, p) {
  const w = wallById(level, id);
  if (!w) return;
  // the openings stay where they are in the plan (clamped into the wall)
  const oldA = w.a;
  const oldU = wallDir(w);
  const placed = openingsOf(level, id).map((o) => [o, add(oldA, mul(oldU, o.at))]);
  w[end] = roundPt(p, 4);
  const L = wallLength(w);
  const u = wallDir(w);
  for (const [o, P] of placed) o.at = round(Math.max(o.width / 2, Math.min(L - o.width / 2, dot(sub(P, w.a), u))), 4);
}

/**
 * Moves a whole wall by a vector. The ends of other walls that met it (on its centre line, within half its thickness)
 * follow: they slide along their own direction onto the new centre line, so every joint stays closed and the other
 * walls stay straight (a collinear neighbour just moves along).
 */
export function moveWall(level, id, delta, { drag = true } = {}) {
  const w = wallById(level, id);
  if (!w) return;
  const oldA = w.a;
  const oldB = w.b;
  const n = perp(unit(sub(oldB, oldA)));
  w.a = roundPt(add(w.a, delta), 4);
  w.b = roundPt(add(w.b, delta), 4);
  if (!drag) return;
  const shift = dot(delta, n);
  for (const o of level.walls) {
    if (o === w) continue;
    const u = unit(sub(o.b, o.a));
    for (const end of ['a', 'b']) {
      const pr = projectToSegment(o[end], oldA, oldB);
      if (pr.d > w.t / 2 + 0.01) continue;
      const ud = dot(u, n);
      o[end] = roundPt(Math.abs(ud) > 0.2 ? add(o[end], mul(u, shift / ud)) : add(o[end], delta), 4);
    }
  }
}

/** Splits a wall at distance s from a; openings go to the part they lie in. Returns [first, second]. */
export function splitWall(level, id, s) {
  const w = wallById(level, id);
  if (!w) return null;
  const L = wallLength(w);
  if (s <= 0.02 || s >= L - 0.02) return null;
  const p = roundPt(wallPoint(w, s), 4);
  const w2 = { ...clone(w), id: newId('w', new Set(level.walls.map((x) => x.id))), a: p };
  w.b = p;
  level.walls.push(w2);
  for (const o of openingsOf(level, id)) {
    if (o.at > s) {
      o.wall = w2.id;
      o.at = round(o.at - s, 4);
    }
  }
  return [w, w2];
}

export function addOpening(level, wallId, at, type, settings = DEFAULT_SETTINGS) {
  const w = wallById(level, wallId);
  if (!w) return null;
  const L = wallLength(w);
  const width = type === 'door' ? 0.9 : type === 'window' ? 1.2 : 1.0;
  const ww = Math.min(width, L - 0.04);
  const o = {
    id: newId('o', new Set(level.openings.map((x) => x.id))),
    wall: wallId,
    type,
    at: round(Math.max(ww / 2, Math.min(L - ww / 2, at)), 4),
    width: round(ww, 4),
  };
  if (type === 'door') Object.assign(o, { hinge: 'start', side: 1 });
  if (type === 'window') Object.assign(o, { sill: settings.windowSill, height: settings.windowHeight });
  level.openings.push(o);
  return o;
}

export function deleteOpening(level, id) {
  level.openings = level.openings.filter((o) => o.id !== id);
}

/**
 * A straight stair down from this level, drawn as a rectangle from its top end toward its foot: the longer side is the
 * run, the drag direction along it the way down.
 */
export function addStair(level, a, b) {
  const rect = [[round(Math.min(a[0], b[0]), 4), round(Math.min(a[1], b[1]), 4)], [round(Math.max(a[0], b[0]), 4), round(Math.max(a[1], b[1]), 4)]];
  const dx = rect[1][0] - rect[0][0];
  const dy = rect[1][1] - rect[0][1];
  const axis = dx >= dy ? 'x' : 'y';
  const down = (axis === 'x' ? b[0] - a[0] : b[1] - a[1]) >= 0 ? 1 : -1;
  const st = { id: newId('t', new Set((level.stairs || []).map((x) => x.id))), rect, axis, down };
  (level.stairs ||= []).push(st);
  return st;
}

/** A stair's plan geometry: the hole, the top and foot edges, the way down, width and length. */
export function stairGeometry(st) {
  const [[x0, y0], [x1, y1]] = st.rect;
  const corners = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  const down = st.axis === 'x' ? [st.down, 0] : [0, st.down];
  const start = st.axis === 'x' ? (st.down > 0 ? x0 : x1) : st.down > 0 ? y0 : y1;
  const end = st.axis === 'x' ? (st.down > 0 ? x1 : x0) : st.down > 0 ? y1 : y0;
  const top = st.axis === 'x' ? [[start, y0], [start, y1]] : [[x0, start], [x1, start]];
  const foot = st.axis === 'x' ? [[end, y0], [end, y1]] : [[x0, end], [x1, end]];
  const length = Math.abs(end - start);
  const width = st.axis === 'x' ? y1 - y0 : x1 - x0;
  return { corners, down, top, foot, length, width };
}

export function deleteStair(level, id) {
  level.stairs = (level.stairs || []).filter((s) => s.id !== id);
}

/** Room label: the one whose seed lies in the region, or a new one. */
export function setRoomLabel(level, seed, props) {
  let r = level.rooms.find((x) => x.id === props.id);
  if (!r) {
    r = { id: props.id ?? newId('r', new Set(level.rooms.map((x) => x.id))), name: 'Rom', kind: 'living', seed: roundPt(seed, 3) };
    level.rooms.push(r);
  }
  Object.assign(r, props, { seed: roundPt(props.seed ?? r.seed ?? seed, 3) });
  return r;
}

/** Changes the scale of a level (the user measured again): every coordinate is scaled by oldPxPerM / newPxPerM. */
export function rescaleLevel(level, newPxPerM) {
  const old = level.image?.pxPerM;
  if (!(old > 0) || !(newPxPerM > 0)) return;
  const k = old / newPxPerM;
  const sc = (p) => roundPt(mul(p, k), 4);
  for (const w of level.walls) {
    w.a = sc(w.a);
    w.b = sc(w.b);
    w.t = round(w.t * k, 4);
  }
  for (const o of level.openings) {
    o.at = round(o.at * k, 4);
    o.width = round(o.width * k, 4);
    if (o.leaf) o.leaf = round(o.leaf * k, 4);
  }
  for (const r of level.rooms) r.seed = sc(r.seed);
  for (const s of level.stairs || []) s.rect = s.rect.map(sc);
  level.offset = sc(level.offset || [0, 0]);
  level.image.pxPerM = newPxPerM;
}

/** Plain undo / redo of JSON snapshots. */
export function history(limit = 100) {
  const past = [];
  const future = [];
  return {
    push(state) {
      past.push(JSON.stringify(state));
      if (past.length > limit) past.shift();
      future.length = 0;
    },
    undo(current) {
      if (!past.length) return null;
      future.push(JSON.stringify(current));
      return JSON.parse(past.pop());
    },
    redo(current) {
      if (!future.length) return null;
      past.push(JSON.stringify(current));
      return JSON.parse(future.pop());
    },
    get canUndo() {
      return past.length > 0;
    },
    get canRedo() {
      return future.length > 0;
    },
    clear() {
      past.length = 0;
      future.length = 0;
    },
  };
}

/** Basic integrity: openings on existing walls, inside them, not overlapping. Returns a list of Norwegian messages. */
export function checkLevel(level) {
  const out = [];
  const byWall = new Map();
  for (const o of level.openings) {
    const w = wallById(level, o.wall);
    if (!w) {
      out.push(`Åpningen ${o.id} står på en vegg som ikke finnes`);
      continue;
    }
    const L = wallLength(w);
    if (o.at - o.width / 2 < -0.005 || o.at + o.width / 2 > L + 0.005) out.push(`Åpningen ${o.id} stikker utenfor veggen`);
    if (!byWall.has(o.wall)) byWall.set(o.wall, []);
    byWall.get(o.wall).push(o);
  }
  for (const list of byWall.values()) {
    list.sort((a, b) => a.at - b.at);
    for (let i = 1; i < list.length; i++) {
      if (list[i].at - list[i].width / 2 < list[i - 1].at + list[i - 1].width / 2 - 0.005) out.push(`Åpningene ${list[i - 1].id} og ${list[i].id} overlapper`);
    }
  }
  return out;
}
