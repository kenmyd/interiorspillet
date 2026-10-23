/**
 * Lighting rules for generated houses (notes/belysning-genererte-hus.md). From what the planbygger knows without any
 * furniture – room type, polygon, ceiling type and height, doors and windows, stairs and decks – and the optional hints
 * it may have (where the dining table, the kitchen island, the upper cabinets, a mirror, a bed or the carport are), the
 * built-in lights and light groups of a real house: spots in kitchens, bathrooms and halls, pendants over the dining
 * table and the island, LED under the upper cabinets, wall lamps, lights that follow a sloping ceiling, outdoor lamps at
 * the outer doors, on the terrace and at the carport, and step lights in the stair.
 *
 * Plain data in, plain data out (no three.js): layout.js runs it for a house with `lighting` (its output goes through
 * the same parsing as the file's own builtInLights / lightGroups), and the planbygger may run it itself to write the
 * lights into the file. A house without `lighting` never gets here (the owner's house is untouched).
 *
 *   planLighting(input) → { builtInLights, lightGroups, issues, stats }
 *   lightingIssues(lighting, { roomIds, roomAt }) → [{ level, where, msg }]      (validateHouse)
 *   roomUse(room) → one of ROOM_USES (room.use, else its name, else its kind)
 *
 * input (plan points [x, z]; heights above the room's / level's floor unless named world):
 *   lighting     the house file's `lighting` (see notes/belysning-genererte-hus.md)
 *   levels       [{ id, floorY }]
 *   rooms        [{ id, name, kind, use?, lighting?, levelId, floorY, polygon, hasLights }]   physical rooms, no hud
 *   walls        [{ id, roomId, levelId, floorY, start, end, normal (into the room), thickness, exterior,
 *                   heightAt(u), openings: [{ id, type, u0, u1, sill, top, connects }] }]
 *   ceilingAt    (roomId, x, z) → ceiling height above the room's floor (bulkheads included)
 *   ceilingHoles {roomId: polygon[]} – holes in the room's ceiling (the stairwell of the level above)
 *   stairs       [{ id, fromLevel, toLevel, roomIds, bottomY, topY (world), risers, walkLine (foot → top), surfaceY(x, z) }]
 *   decks        [{ id, kind, levelId, top (world), outline, edges: [{ a, b, dir, out, house: [[s0, s1]] }] }]
 *   groups       the file's light groups [{ id, roomId }]
 *   lightIds     ids already taken by the file's lights
 */

/** What a room is used for (the format's `kind` has no kitchen, dining room, office, WC …). */
export const ROOM_USES = Object.freeze([
  'living', 'kitchen', 'kitchen-living', 'dining', 'bedroom', 'office', 'bathroom', 'wc', 'hall', 'entrance', 'laundry',
  'storage', 'wardrobe', 'technical', 'garage', 'stair',
]);
/** How much light: 'basic' one ceiling light per room and the lamps at the outer doors; 'standard' every rule below;
 *  'rich' also wall lamps in bedrooms, offices and halls and step lights on every second riser. */
export const LIGHTING_LEVELS = Object.freeze(['basic', 'standard', 'rich']);
export const HINT_TYPES = Object.freeze(['dining-table', 'island', 'upper-cabinets', 'mirror', 'bed', 'carport']);
/** Pseudo room of the outdoor lamps (the registry's pseudoRooms). */
export const OUTSIDE_ROOM = 'ute';

/**
 * Per use: the general light (`general`: 'downlight' grid or 'plafond'), its flux per m² (`lmPerM2`; ≈ half of it
 * reaches the floor: 300 lm/m² ≈ 150 lux), the downlight spacing (m), the colour temperature, the group's start dimmer
 * and auto rule (lighting.js _autoOnFor: 'on' rooms without daylight, 'off' storerooms, 'evening', 'dark' / none: the
 * room's own daylight), and the wall lamps (`wall`: 'standard' | 'rich' – from which level, null never).
 */
export const USE_RULES = Object.freeze({
  living: { general: 'plafond', lmPerM2: 120, K: 2700, dimmer: 0.6, auto: 'dark', wall: 'standard' },
  'kitchen-living': { general: 'downlight', spacing: 1.6, lmPerM2: 160, K: 2700, dimmer: 0.6, auto: 'dark', wall: 'standard' },
  kitchen: { general: 'downlight', spacing: 1.2, lmPerM2: 300, K: 3000, dimmer: 0.8, auto: 'dark', wall: null },
  dining: { general: 'pendant', lmPerM2: 100, K: 2700, dimmer: 0.6, auto: 'dark', wall: 'rich' },
  bedroom: { general: 'plafond', lmPerM2: 100, K: 2700, dimmer: 0.5, auto: 'dark', wall: 'rich' },
  office: { general: 'plafond', lmPerM2: 250, K: 3000, dimmer: 0.8, auto: 'dark', wall: 'rich' },
  bathroom: { general: 'downlight', spacing: 1.2, lmPerM2: 200, K: 3000, dimmer: 0.8, auto: 'on', wall: null },
  wc: { general: 'downlight', spacing: 1.1, lmPerM2: 220, K: 3000, dimmer: 0.8, auto: 'on', wall: null },
  hall: { general: 'downlight', spacing: 1.4, lmPerM2: 150, K: 2700, dimmer: 0.5, auto: 'dark', wall: 'rich' },
  entrance: { general: 'downlight', spacing: 1.3, lmPerM2: 170, K: 2700, dimmer: 0.6, auto: 'evening', wall: null },
  laundry: { general: 'downlight', spacing: 1.2, lmPerM2: 250, K: 3500, dimmer: 1, auto: 'dark', wall: null },
  storage: { general: 'plafond', lmPerM2: 120, K: 3500, dimmer: 1, auto: 'off', wall: null, minCeil: 1.0 },
  wardrobe: { general: 'downlight', spacing: 1.2, lmPerM2: 200, K: 3000, dimmer: 1, auto: 'off', wall: null, minCeil: 1.0 },
  technical: { general: 'plafond', lmPerM2: 150, K: 4000, dimmer: 1, auto: 'off', wall: null, minCeil: 1.0 },
  garage: { general: 'plafond', lmPerM2: 150, K: 4000, dimmer: 1, auto: 'off', wall: null },
  stair: { general: 'plafond', lmPerM2: 120, K: 2700, dimmer: 0.6, auto: 'dark', wall: null },
});

/** Numbers of the fittings (m, lm). */
export const LIGHT = Object.freeze({
  downlight: { d: 0.08, lm: [250, 600], lmEach: 300, maxPerRoom: 16, inset: 0.45 },
  plafond: { d: 0.4, h: 0.08, lm: [700, 2200], areaPerLamp: 15 },
  pendant: { tableTop: 0.74, aboveTable: 0.65, islandTop: 0.9, aboveIsland: 0.75, minBelowCeiling: 0.25 },
  wall: { y: 1.75, lm: 300, minRun: 1.2, depth: 0.1, w: 0.14, h: 0.2 },
  bedside: { y: 1.2, lm: 250 },
  mirror: { above: 0.08, lm: 500, w: 0.5 },
  strip: { bottom: 1.45, depth: 0.35, lmPerM: 250 },
  step: { above: 0.3, everyRisers: 3, lm: 60, reach: 0.8, max: 10 },
  outdoor: { y: 1.95, lm: 450, spacing: 3, gap: 1.2, K: 3000 },
  /** a ceiling steeper than this (rise per m, ≈ 10°) is sloping: no plafond there */
  flatSlope: 0.18,
  /** a ceiling lower than this is no place for a ceiling lamp (sloping ceilings) */
  minCeiling: 2.0,
  /** total cap; the rules thin the downlights out above it */
  maxLights: 220,
});

const EPS = 1e-6;

// ---------------------------------------------------------------------------------------------------------------
// Plan geometry ([x, z])

const P = (p) => (Array.isArray(p) ? [p[0], p[1]] : [p.x, p.y]);
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const add = (a, b, k = 1) => [a[0] + b[0] * k, a[1] + b[1] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
const len = (a) => Math.hypot(a[0], a[1]);
const norm = (a) => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l];
};
const r3 = (v) => Math.round(v * 1000) / 1000;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function signedArea(poly) {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s / 2;
}
function centroid(poly) {
  let cx = 0, cz = 0, a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    const c = p[0] * q[1] - q[0] * p[1];
    a += c;
    cx += (p[0] + q[0]) * c;
    cz += (p[1] + q[1]) * c;
  }
  if (Math.abs(a) < EPS) return [poly.reduce((s, p) => s + p[0], 0) / poly.length, poly.reduce((s, p) => s + p[1], 0) / poly.length];
  return [cx / (3 * a), cz / (3 * a)];
}
export function inPolygon(x, z, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if (a[1] > z !== b[1] > z && x < ((b[0] - a[0]) * (z - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}
function segDist(p, a, b) {
  const d = sub(b, a);
  const l2 = dot(d, d);
  const t = l2 > 0 ? clamp(dot(sub(p, a), d) / l2, 0, 1) : 0;
  return len(sub(p, add(a, d, t)));
}
function edgeDist(p, poly) {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) best = Math.min(best, segDist(p, poly[i], poly[(i + 1) % poly.length]));
  return best;
}
/** Direction of the polygon's longest edge (the room's long axis for the grid). */
function mainAxis(poly) {
  let best = [1, 0], bl = -1;
  for (let i = 0; i < poly.length; i++) {
    const d = sub(poly[(i + 1) % poly.length], poly[i]);
    const l = len(d);
    if (l > bl) {
      bl = l;
      best = d;
    }
  }
  const u = norm(best);
  return u[0] < -EPS || (Math.abs(u[0]) < EPS && u[1] < 0) ? [-u[0], -u[1]] : u;
}
/** Bounds of the polygon in the frame (u along `ax`, v across). */
function frameBounds(poly, ax) {
  const v = [-ax[1], ax[0]];
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
  for (const p of poly) {
    const a = dot(p, ax), b = dot(p, v);
    u0 = Math.min(u0, a);
    u1 = Math.max(u1, a);
    v0 = Math.min(v0, b);
    v1 = Math.max(v1, b);
  }
  return { u0, u1, v0, v1, ax, v, at: (a, b) => [ax[0] * a + v[0] * b, ax[1] * a + v[1] * b] };
}
/** The point of `poly` (optionally only where ok(p)) farthest from its edges, pulled a little toward the centroid. */
function freestPoint(poly, ok = null, near = null) {
  const c = near ?? centroid(poly);
  const xs = poly.map((p) => p[0]), zs = poly.map((p) => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs);
  const step = clamp(Math.max(x1 - x0, z1 - z0) / 30, 0.05, 0.25);
  let best = null, bs = -Infinity;
  for (let x = x0 + step / 2; x < x1; x += step) {
    for (let z = z0 + step / 2; z < z1; z += step) {
      if (!inPolygon(x, z, poly)) continue;
      const p = [x, z];
      if (ok && !ok(p)) continue;
      const s = Math.min(edgeDist(p, poly), 1.5) - 0.2 * len(sub(p, c));
      if (s > bs) {
        bs = s;
        best = p;
      }
    }
  }
  return best;
}
/** A rectangle hint ({ position, size, angle } or { outline }) as centre, length axis, length and width. */
function rectOf(h, defSize) {
  if (Array.isArray(h.outline) && h.outline.length >= 3) {
    const o = h.outline.map(P);
    const ax = mainAxis(o);
    const b = frameBounds(o, ax);
    return { c: b.at((b.u0 + b.u1) / 2, (b.v0 + b.v1) / 2), ax, L: b.u1 - b.u0, W: b.v1 - b.v0 };
  }
  const size = Array.isArray(h.size) ? h.size : defSize;
  const a = ((h.angle ?? 0) * Math.PI) / 180;
  let ax = [Math.cos(a), Math.sin(a)];
  let L = size[0], W = size[1] ?? size[0];
  if (W > L) {
    [L, W] = [W, L];
    ax = [-ax[1], ax[0]];
  }
  return { c: P(h.position), ax, L, W };
}

// ---------------------------------------------------------------------------------------------------------------
// Room use

const NAME_USES = [
  [/kj(ø|o)kken.*(stue|spise)|(stue|spise).*kj(ø|o)kken|allrom/, 'kitchen-living'],
  [/kj(ø|o)kken|kjøkk/, 'kitchen'],
  [/spisestue|spiserom|spise/, 'dining'],
  [/kontor|arbeidsrom|hjemmekontor/, 'office'],
  [/garderobe|walk.?in|klesrom/, 'wardrobe'],
  [/^wc|\bwc\b|toalett|gjeste.?wc/, 'wc'],
  [/bad|dusj/, 'bathroom'],
  [/vaskerom|vask/, 'laundry'],
  [/tekn|fyrrom|sentral/, 'technical'],
  [/garasje/, 'garage'],
  [/entr(é|e)|vindfang|inngang/, 'entrance'],
  [/gang|hall|korridor|repos/, 'hall'],
  [/trapp/, 'stair'],
  [/bod|lager|kott|loft(s)?rom/, 'storage'],
  [/sov|barnerom|gjesterom|soverom/, 'bedroom'],
  [/stue|tv|familierom|kjellerstue/, 'living'],
];
const KIND_USES = { living: 'living', bedroom: 'bedroom', bathroom: 'bathroom', hall: 'hall', entrance: 'entrance', laundry: 'laundry', storage: 'storage' };

/** The room's use: `use` when given, else from its name («Kjøkken/stue», «WC», «Kontor» …), else from its kind. */
export function roomUse(room) {
  if (ROOM_USES.includes(room?.use)) return room.use;
  const name = String(room?.name ?? '').toLowerCase();
  for (const [re, use] of NAME_USES) if (re.test(name)) return use;
  return KIND_USES[room?.kind] ?? 'living';
}

// ---------------------------------------------------------------------------------------------------------------
// Validation (validateHouse)

/**
 * Problems in a house file's `lighting` (the validator's errors and warnings).
 * @param {object} lighting
 * @param {{ roomIds?: Set<string>, roomAt?: (p: number[]) => string|null }} [ctx]
 */
export function lightingIssues(lighting, { roomIds = null, roomAt = null } = {}) {
  const out = [];
  const err = (where, msg) => out.push({ level: 'error', where, msg });
  const warn = (where, msg) => out.push({ level: 'warn', where, msg });
  if (lighting === true) return out;
  if (lighting == null || typeof lighting !== 'object' || Array.isArray(lighting)) {
    err('lighting', 'må være et objekt (eller true)');
    return out;
  }
  const known = new Set(['$comment', 'auto', 'level', 'outdoor', 'stairs', 'colorK', 'hints', 'maxLights', 'source', 'estimated']);
  for (const k of Object.keys(lighting)) if (!known.has(k)) warn('lighting', `ukjent felt «${k}» (brukes ikke)`);
  if (lighting.auto != null && typeof lighting.auto !== 'boolean') err('lighting', 'auto må være true eller false');
  if (lighting.level != null && !LIGHTING_LEVELS.includes(lighting.level)) err('lighting', `level «${lighting.level}» er ikke en av ${LIGHTING_LEVELS.join(', ')}`);
  for (const k of ['outdoor', 'stairs']) if (lighting[k] != null && typeof lighting[k] !== 'boolean') err('lighting', `${k} må være true eller false`);
  if (lighting.colorK != null && !(Number.isFinite(lighting.colorK) && lighting.colorK >= 1800 && lighting.colorK <= 6500)) err('lighting', 'colorK må være et tall mellom 1800 og 6500');
  if (lighting.maxLights != null && !(Number.isInteger(lighting.maxLights) && lighting.maxLights > 0)) err('lighting', 'maxLights må være et heltall over 0');
  if (lighting.hints != null && !Array.isArray(lighting.hints)) err('lighting', 'hints må være en liste');
  const isPt = (p) => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite);
  const isPoly = (o) => Array.isArray(o) && o.length >= 3 && o.every(isPt);
  for (const [i, h] of (Array.isArray(lighting.hints) ? lighting.hints : []).entries()) {
    const where = `lighting.hints[${i}]`;
    if (!h || typeof h !== 'object') {
      err(where, 'må være et objekt');
      continue;
    }
    if (!HINT_TYPES.includes(h.type)) {
      err(where, `type «${h.type}» er ikke en av ${HINT_TYPES.join(', ')}`);
      continue;
    }
    if (h.roomId != null && roomIds && !roomIds.has(h.roomId)) err(where, `rommet «${h.roomId}» finnes ikke`);
    let p = null;
    if (h.type === 'upper-cabinets') {
      if (!isPt(h.from) || !isPt(h.to)) err(where, 'upper-cabinets trenger from og to ([x, z] langs veggen)');
      else p = [(h.from[0] + h.to[0]) / 2, (h.from[1] + h.to[1]) / 2];
      for (const k of ['bottom', 'depth']) if (h[k] != null && !(Number.isFinite(h[k]) && h[k] > 0)) err(where, `${k} må være et tall over 0`);
    } else if (h.type === 'carport') {
      if (!isPoly(h.outline)) err(where, 'carport trenger outline (minst tre punkter [x, z])');
    } else if (h.outline != null) {
      if (!isPoly(h.outline)) err(where, 'outline må være minst tre punkter [x, z]');
      else p = centroid(h.outline);
    } else if (!isPt(h.position)) err(where, `${h.type} trenger position [x, z] (eller outline)`);
    else {
      p = h.position;
      if (h.size != null && !(Array.isArray(h.size) && h.size.length >= 1 && h.size.length <= 2 && h.size.every((v) => Number.isFinite(v) && v > 0))) err(where, 'size må være [lengde, bredde] i meter');
      if (h.angle != null && !Number.isFinite(h.angle)) err(where, 'angle må være et tall (grader)');
    }
    if (p && roomAt && h.type !== 'carport') {
      const r = roomAt(p);
      if (!r) warn(where, `står ikke i noe rom (${r3(p[0])}, ${r3(p[1])}) – hintet brukes ikke`);
      else if (h.roomId != null && r !== h.roomId) warn(where, `står i rommet «${r}», ikke i «${h.roomId}»`);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// The rules

/**
 * The lights and groups of the house (see the top of the file).
 * @returns {{ builtInLights: object[], lightGroups: object[], issues: object[], stats: object }}
 */
export function planLighting(input) {
  const cfg = input.lighting === true ? {} : input.lighting || {};
  const issues = [];
  const note = (where, msg) => issues.push({ level: 'warn', where, msg });
  if (cfg.auto === false) return { builtInLights: [], lightGroups: [], issues, stats: { lights: 0, groups: 0, byType: {}, byRoom: {} } };
  const level = LIGHTING_LEVELS.includes(cfg.level) ? cfg.level : 'standard';
  const rich = level === 'rich';
  const basic = level === 'basic';
  const atLeast = (lv) => lv != null && (lv === 'standard' ? !basic : lv === 'rich' ? rich : false);
  const Kfor = (use) => (Number.isFinite(cfg.colorK) ? cfg.colorK : USE_RULES[use]?.K ?? 2700);

  const levels = new Map((input.levels || []).map((l) => [l.id, l]));
  const rooms = (input.rooms || []).map((r) => ({ ...r, polygon: r.polygon.map(P) })).filter((r) => r.polygon.length >= 3);
  const roomsById = new Map(rooms.map((r) => [r.id, r]));
  const walls = (input.walls || []).map((w) => {
    const start = P(w.start), end = P(w.end);
    const L = len(sub(end, start));
    return { ...w, start, end, normal: P(w.normal), dir: norm(sub(end, start)), L, openings: w.openings || [] };
  });
  const wallsOfRoom = new Map();
  for (const w of walls) (wallsOfRoom.get(w.roomId) ?? wallsOfRoom.set(w.roomId, []).get(w.roomId)).push(w);
  const ceilingAt = (roomId, x, z) => {
    const h = input.ceilingAt?.(roomId, x, z);
    return Number.isFinite(h) ? h : 2.4;
  };
  const holes = input.ceilingHoles || {};
  const inHole = (roomId, p) => (holes[roomId] || []).some((poly) => inPolygon(p[0], p[1], poly.map(P)));
  const roomAt = (levelId, p) => rooms.find((r) => r.levelId === levelId && inPolygon(p[0], p[1], r.polygon)) ?? null;

  // ---- hints, per room
  const hintsOf = new Map();
  const outdoorHints = [];
  for (const h of Array.isArray(cfg.hints) ? cfg.hints : []) {
    if (!h || !HINT_TYPES.includes(h.type)) continue;
    if (h.type === 'carport') {
      outdoorHints.push(h);
      continue;
    }
    const p = h.type === 'upper-cabinets' ? (Array.isArray(h.from) && Array.isArray(h.to) ? [(h.from[0] + h.to[0]) / 2, (h.from[1] + h.to[1]) / 2] : null)
      : Array.isArray(h.outline) ? centroid(h.outline.map(P)) : Array.isArray(h.position) ? P(h.position) : null;
    if (!p) continue;
    const room = (h.roomId != null ? roomsById.get(h.roomId) : null) ?? rooms.find((r) => inPolygon(p[0], p[1], r.polygon));
    if (!room) {
      note('lighting.hints', `${h.type} ved (${r3(p[0])}, ${r3(p[1])}) står ikke i noe rom – hoppet over`);
      continue;
    }
    (hintsOf.get(room.id) ?? hintsOf.set(room.id, []).get(room.id)).push(h);
  }

  // ---- groups: the file's groups by room (a generated room's own group is reused), new ones made unique
  const groups = [];
  const groupIds = new Set((input.groups || []).map((g) => g.id));
  const dataGroupOfRoom = new Map();
  for (const g of input.groups || []) if (g.roomId != null && !dataGroupOfRoom.has(g.roomId)) dataGroupOfRoom.set(g.roomId, g.id);
  const madeGroups = new Map();
  /** The group `key` of a room (main: its general light), created once. */
  function groupFor(key, def) {
    if (madeGroups.has(key)) return madeGroups.get(key);
    let id = def.reuse ?? null;
    if (!id) {
      id = def.id;
      for (let k = 2; groupIds.has(id); k++) id = `${def.id}-${k}`;
      groupIds.add(id);
      groups.push({ id, label: def.label, roomId: def.roomId ?? null, ...(def.levelId ? { levelId: def.levelId } : {}), dimmer: true, defaultDimmer: def.dimmer ?? 0.6, auto: def.auto ?? 'dark', source: 'lysregler (src/home/lightplan.js)' });
    }
    madeGroups.set(key, id);
    return id;
  }

  // ---- lights
  const lights = [];
  const lightIds = new Set(input.lightIds || []);
  function push(l) {
    let id = l.id;
    for (let k = 2; lightIds.has(id); k++) id = `${l.id}-${k}`;
    lightIds.add(id);
    lights.push({ ...l, id, estimated: ['*'], source: `lysregler: ${l.source}` });
  }
  const pos3 = (p, y) => [r3(p[0]), r3(y), r3(p[1])];

  /** Ceiling normal (plan components and y) at p from the room's ceiling height field. */
  function ceilingSlope(roomId, p) {
    const e = 0.05;
    const gx = (ceilingAt(roomId, p[0] + e, p[1]) - ceilingAt(roomId, p[0] - e, p[1])) / (2 * e);
    const gz = (ceilingAt(roomId, p[0], p[1] + e) - ceilingAt(roomId, p[0], p[1] - e)) / (2 * e);
    return { gx, gz, steep: Math.hypot(gx, gz) };
  }
  /** Is p a place for a ceiling fitting in the room (inside, off the walls, under a ceiling of at least `min`)? */
  let roomMin = LIGHT.minCeiling; // the lowest ceiling for a fitting in the room being lit (USE_RULES minCeil)
  const ceilingOk = (room, p, inset, min = roomMin) => inPolygon(p[0], p[1], room.polygon) && edgeDist(p, room.polygon) >= inset - EPS && !inHole(room.id, p) && ceilingAt(room.id, p[0], p[1]) >= min;

  /** A ceiling fitting at p: position on the ceiling, its tilt on a sloping ceiling as `ceilingNormal` (x, y, z, down). */
  function ceilingLight(room, p, type, group, extra) {
    const h = ceilingAt(room.id, p[0], p[1]);
    const s = ceilingSlope(room.id, p);
    const n = s.steep > 0.02 ? (() => {
      const l = Math.hypot(s.gx, 1, s.gz);
      return [r3(s.gx / l), r3(-1 / l), r3(s.gz / l)];
    })() : null;
    push({ id: `l-auto-${room.id}-${type === 'downlight' ? 's' : 't'}${lights.length + 1}`, roomId: room.id, group, type, position: pos3(p, h), ...(n ? { ceilingNormal: n } : {}), ...extra });
  }

  /** Downlights in a grid over the room (long axis), where the ceiling is high enough. */
  function downlightGrid(room, spacing, lmTotal, group, K, why, area = room.polygon) {
    const ax = mainAxis(area);
    const b = frameBounds(area, ax);
    const inset = Math.min(LIGHT.downlight.inset, (b.v1 - b.v0) / 2 - 0.05, (b.u1 - b.u0) / 2 - 0.05);
    const span = (lo, hi) => {
      const L = hi - lo - 2 * Math.max(inset, 0);
      const n = Math.max(1, Math.round(L / spacing) + 1);
      return Array.from({ length: n }, (_, i) => (n === 1 ? (lo + hi) / 2 : lo + inset + (L * i) / (n - 1)));
    };
    let pts = [];
    for (const u of span(b.u0, b.u1)) for (const v of span(b.v0, b.v1)) {
      const p = b.at(u, v);
      if (inPolygon(p[0], p[1], area) && ceilingOk(room, p, Math.max(0.2, inset * 0.8))) pts.push(p);
    }
    if (!pts.length) {
      const p = freestPoint(area, (q) => ceilingOk(room, q, 0.2));
      if (p) pts = [p];
    }
    // no more spots than the room's flux needs (a sloping ceiling packs the grid where it is high enough), and the cap
    const most = Math.min(LIGHT.downlight.maxPerRoom, Math.max(1, Math.ceil(lmTotal / LIGHT.downlight.lmEach)));
    if (pts.length > most) {
      // thinned: every k-th, evenly
      const k = pts.length / most;
      pts = Array.from({ length: most }, (_, i) => pts[Math.floor(i * k)]);
    }
    if (!pts.length) return 0;
    const lm = Math.round(clamp(lmTotal / pts.length, ...LIGHT.downlight.lm));
    for (const p of pts) ceilingLight(room, p, 'downlight', group, { dims: { d: LIGHT.downlight.d }, lumens: lm, lightColorK: K, source: why });
    return pts.length;
  }

  /** Ceiling lamps (plafonds) along the long axis: one per ~15 m², each at the freest point of its slice. */
  function plafonds(room, lmTotal, group, K, why) {
    const area = Math.abs(signedArea(room.polygon));
    const n = clamp(Math.round(area / LIGHT.plafond.areaPerLamp), 1, 3);
    const ax = mainAxis(room.polygon);
    const b = frameBounds(room.polygon, ax);
    const lm = Math.round(clamp(lmTotal / n, ...LIGHT.plafond.lm));
    let made = 0;
    for (let i = 0; i < n; i++) {
      const lo = b.u0 + ((b.u1 - b.u0) * i) / n, hi = b.u0 + ((b.u1 - b.u0) * (i + 1)) / n;
      const near = b.at((lo + hi) / 2, (b.v0 + b.v1) / 2);
      // a sloping ceiling: where it is flattest and high enough (the collar beam), else just high enough
      const inSlice = (q) => dot(q, ax) >= lo && dot(q, ax) <= hi;
      const flat = (q) => inSlice(q) && ceilingOk(room, q, 0.35, roomMin + 0.1) && ceilingSlope(room.id, q).steep < LIGHT.flatSlope;
      // (a narrow room under the slope – the knee-wall storeroom – closer to its walls)
      const p = freestPoint(room.polygon, flat, near) ?? freestPoint(room.polygon, (q) => inSlice(q) && ceilingOk(room, q, 0.35, roomMin + 0.1), near)
        ?? freestPoint(room.polygon, (q) => inSlice(q) && ceilingOk(room, q, 0.15, roomMin), near);
      if (!p) continue;
      ceilingLight(room, p, 'plafond', group, { dims: { d: LIGHT.plafond.d, h: LIGHT.plafond.h }, lumens: lm, lightColorK: K, source: why });
      made++;
    }
    return made;
  }

  /** A pendant hanging from the ceiling over p, its shade's bottom at `bottom` above the floor. */
  function pendant(room, p, bottom, group, { d, lm, K, why }) {
    const h = ceilingAt(room.id, p[0], p[1]);
    const b = Math.min(bottom, h - LIGHT.pendant.minBelowCeiling - 0.2);
    push({ id: `l-auto-${room.id}-p${lights.length + 1}`, roomId: room.id, group, type: 'pendant', position: pos3(p, h), dims: { d, h: r3(Math.min(0.3, d * 0.8)), drop: r3(h - b) }, lumens: lm, lightColorK: K, source: why });
  }

  /** Free stretches [u0, u1] of a wall at height y (openings, the ends and a wall too low there taken out). */
  function freeRuns(w, y, { margin = 0.3, end = 0.35 } = {}) {
    const cuts = [[-Infinity, end], [w.L - end, Infinity]];
    for (const o of w.openings) if (o.top > y - 0.35 && o.sill < y + 0.35) cuts.push([o.u0 - margin, o.u1 + margin]);
    cuts.sort((a, b) => a[0] - b[0]);
    const runs = [];
    let at = 0;
    for (const [a, b] of cuts) {
      if (a > at) runs.push([at, Math.min(a, w.L)]);
      at = Math.max(at, b);
    }
    // the wall must reach above the lamp there (a knee wall under a sloping ceiling does not)
    return runs.map(([a, b]) => {
      let lo = a, hi = b;
      while (lo < hi && (w.heightAt?.(lo) ?? 2.4) < y + 0.25) lo += 0.1;
      while (hi > lo && (w.heightAt?.(hi) ?? 2.4) < y + 0.25) hi -= 0.1;
      return [lo, hi];
    }).filter(([a, b]) => b - a > 0.05);
  }
  /** A wall lamp on the wall's room side at u, y. */
  function wallLamp(room, w, u, y, group, { lm, K, why, kind = 'sconce' }) {
    const p = add(add(w.start, w.dir, u), w.normal, LIGHT.wall.depth / 2);
    push({ id: `l-auto-${room.id}-v${lights.length + 1}`, roomId: room.id, group, type: 'wall', wallId: w.id, position: pos3(p, y), normal: [r3(w.normal[0]), r3(w.normal[1])], dims: { w: LIGHT.wall.w, h: LIGHT.wall.h, depth: LIGHT.wall.depth }, style: kind, lumens: lm, lightColorK: K, source: why });
  }
  /** Two (or one) wall lamps on the longest free stretch of the room's walls. */
  function wallLamps(room, group, K, why) {
    let best = null;
    for (const w of wallsOfRoom.get(room.id) || []) {
      if (w.L < LIGHT.wall.minRun) continue;
      for (const [a, b] of freeRuns(w, LIGHT.wall.y)) if (b - a >= LIGHT.wall.minRun && (!best || b - a > best.b - best.a)) best = { w, a, b };
    }
    if (!best) return 0;
    const run = best.b - best.a;
    const us = run >= 2.4 ? [best.a + run * 0.25, best.a + run * 0.75] : [(best.a + best.b) / 2];
    for (const u of us) wallLamp(room, best.w, u, LIGHT.wall.y, group, { lm: LIGHT.wall.lm, K, why });
    return us.length;
  }
  /** The wall of the room nearest to p (and how far, and where along it). */
  function nearestWall(room, p) {
    let best = null;
    for (const w of wallsOfRoom.get(room.id) || []) {
      const u = clamp(dot(sub(p, w.start), w.dir), 0, w.L);
      const d = len(sub(p, add(w.start, w.dir, u)));
      if (!best || d < best.d) best = { w, u, d };
    }
    return best;
  }

  // ---- per room
  const counts = {};
  const cap = Number.isInteger(cfg.maxLights) ? cfg.maxLights : LIGHT.maxLights;
  for (const room of rooms) {
    if (room.hasLights || room.lighting === false || room.lighting === 'none') continue;
    const use = roomUse(room);
    const rule = USE_RULES[use];
    const K = Kfor(use);
    roomMin = rule.minCeil ?? LIGHT.minCeiling;
    const area = Math.abs(signedArea(room.polygon));
    const hints = hintsOf.get(room.id) || [];
    const mainGroup = groupFor(`${room.id}`, { reuse: dataGroupOfRoom.get(room.id), id: room.id, label: room.name ?? room.id, roomId: room.id, dimmer: rule.dimmer, auto: rule.auto });
    const subGroup = (key, label, extra = {}) => groupFor(`${room.id}:${key}`, { id: `${room.id}-${key}`, label: `${room.name ?? room.id}: ${label}`, roomId: room.id, dimmer: extra.dimmer ?? 0.7, auto: extra.auto ?? 'dark' });
    const lmTotal = rule.lmPerM2 * area;
    const tables = hints.filter((h) => h.type === 'dining-table');
    const islands = hints.filter((h) => h.type === 'island');
    const before = lights.length;

    // general light
    if (basic) plafonds(room, lmTotal, mainGroup, K, `${use}: grunnlys`);
    else if (rule.general === 'downlight') {
      // an open kitchen/living room with an island or a counter: dense spots over the kitchen, sparse over the rest
      const kitchenZone = use === 'kitchen-living' ? hints.filter((h) => h.type === 'island' || h.type === 'upper-cabinets') : [];
      if (kitchenZone.length) {
        const zone = kitchenZoneOf(room, kitchenZone);
        downlightGrid(room, USE_RULES.kitchen.spacing, USE_RULES.kitchen.lmPerM2 * Math.abs(signedArea(zone)), mainGroup, Kfor('kitchen'), 'kjøkkendelen: spotter i rutenett', zone);
        const rest = subGroup('stue', 'Taklys i stua', { dimmer: 0.6 });
        const n = plafondsOutside(room, room.polygon, zone, USE_RULES.living.lmPerM2 * Math.max(0, area - Math.abs(signedArea(zone))), rest, Kfor('living'), 'stuedelen: taklampe');
        if (!n) note(`rooms/${room.id}`, 'ingen plass til taklampe i stuedelen');
      } else downlightGrid(room, rule.spacing, lmTotal, mainGroup, K, `${use}: spotter i rutenett (${rule.spacing} m)`);
    } else if (rule.general === 'pendant') {
      if (!tables.length) {
        const p = freestPoint(room.polygon, (q) => ceilingOk(room, q, 0.6));
        if (p) pendant(room, p, LIGHT.pendant.tableTop + LIGHT.pendant.aboveTable, mainGroup, { d: 0.45, lm: Math.round(clamp(lmTotal, 600, 1500)), K, why: 'spiserom uten bordhint: pendel midt i rommet' });
      }
      downlightGrid(room, 1.8, lmTotal * 0.6, subGroup('spotter', 'Spotter', { dimmer: 0.5 }), K, 'spiserom: spotter rundt');
    } else {
      // a sloping ceiling over most of the room (less than ¼ of it flat and ≥ 2,1 m): spots on the slope instead; with a
      // flat part (the collar) the ceiling lamps go there
      if (!rule.minCeil && slopingRoom(room)) downlightGrid(room, 1.6, lmTotal, mainGroup, K, `${use}: skrå himling, spotter der himlingen er minst ${LIGHT.minCeiling} m`);
      else plafonds(room, lmTotal, mainGroup, K, `${use}: taklampe`);
    }

    // pendants over the dining table(s) and the island(s)
    if (!basic) {
      for (const t of tables) {
        const r = rectOf(t, [1.8, 0.9]);
        const n = t.round || r.L <= 1.4 ? 1 : r.L <= 2.2 ? 2 : 3;
        const top = Number.isFinite(t.height) ? t.height : LIGHT.pendant.tableTop;
        const g = subGroup('spisebord', 'Over spisebordet', { dimmer: 0.6 });
        const step = n > 1 ? Math.min(0.8, (r.L - 0.4) / (n - 1)) : 0;
        for (let i = 0; i < n; i++) pendant(room, add(r.c, r.ax, (i - (n - 1) / 2) * step), top + LIGHT.pendant.aboveTable, g, { d: n === 1 ? 0.45 : 0.3, lm: n === 1 ? 800 : 500, K: Kfor('dining'), why: `pendel over spisebordet (${n} stk, ${r3(r.L)} m bord)` });
      }
      for (const isl of islands) {
        const r = rectOf(isl, [2.4, 0.9]);
        const n = r.L < 1.2 ? 1 : clamp(Math.round(r.L / 0.8), 2, 4);
        const top = Number.isFinite(isl.height) ? isl.height : LIGHT.pendant.islandTop;
        const g = subGroup('oy', 'Pendler over kjøkkenøya', { dimmer: 0.6 });
        const step = n > 1 ? (r.L - 0.5) / (n - 1) : 0;
        for (let i = 0; i < n; i++) pendant(room, add(r.c, r.ax, (i - (n - 1) / 2) * step), top + LIGHT.pendant.aboveIsland, g, { d: 0.22, lm: 350, K: Kfor('kitchen'), why: `pendel over kjøkkenøya (${n} stk)` });
      }
      // LED under the upper cabinets (only where the planbygger knows them)
      for (const c of hints.filter((h) => h.type === 'upper-cabinets')) {
        const a = P(c.from), b = P(c.to);
        const L = len(sub(b, a));
        if (L < 0.3) continue;
        const d = norm(sub(b, a));
        let n = [-d[1], d[0]];
        const mid = add(a, sub(b, a), 0.5);
        if (!inPolygon(...add(mid, n, 0.2), room.polygon)) n = [-n[0], -n[1]];
        const depth = Number.isFinite(c.depth) ? c.depth : LIGHT.strip.depth;
        const off = Math.max(0.05, depth - 0.06);
        const y = (Number.isFinite(c.bottom) ? c.bottom : LIGHT.strip.bottom) - 0.01;
        const from = add(add(a, d, 0.05), n, off), to = add(add(b, d, -0.05), n, off);
        push({ id: `l-auto-${room.id}-b${lights.length + 1}`, roomId: room.id, group: subGroup('benk', 'Lys under overskapene', { dimmer: 0.8 }), type: 'led-strip', mount: 'under-cabinet', from: pos3(from, y), to: pos3(to, y), dims: { w: 0.012 }, lumensPerM: LIGHT.strip.lmPerM, lightColorK: Kfor('kitchen'), source: `LED-list under overskapene (${r3(L - 0.1)} m)` });
      }
      // a lamp over the mirror (bathroom, hall) where the planbygger knows it
      for (const m of hints.filter((h) => h.type === 'mirror')) {
        const nw = nearestWall(room, P(m.position));
        if (!nw || nw.d > 0.5) {
          note(`rooms/${room.id}`, 'speilet står ikke ved en vegg – ingen speillampe');
          continue;
        }
        const top = (Number.isFinite(m.height) ? m.height : 1.6) + (Number.isFinite(m.size?.[1]) ? m.size[1] / 2 : 0.35);
        wallLamp(room, nw.w, nw.u, Math.min(top + LIGHT.mirror.above, (nw.w.heightAt?.(nw.u) ?? 2.4) - 0.15), subGroup('speil', 'Speillys', { dimmer: 0.9, auto: rule.auto }), { lm: LIGHT.mirror.lm, K: Kfor(use), why: 'lampe over speilet', kind: 'bar' });
      }
      // reading lamps on both sides of the bed's head end
      for (const bed of hints.filter((h) => h.type === 'bed')) {
        const r = rectOf(bed, [2.0, 1.6]);
        const ends = [add(r.c, r.ax, r.L / 2), add(r.c, r.ax, -r.L / 2)];
        const hits = ends.map((e) => nearestWall(room, e)).filter(Boolean).sort((p, q) => p.d - q.d);
        const nw = hits[0];
        if (!nw || nw.d > 0.4) {
          note(`rooms/${room.id}`, 'senga står ikke med hodeenden mot en vegg – ingen leselamper');
          continue;
        }
        const g = subGroup('seng', 'Leselamper', { dimmer: 0.6 });
        for (const s of [-1, 1]) {
          const u = nw.u + s * (r.W / 2 + 0.25);
          if (u > 0.2 && u < nw.w.L - 0.2) wallLamp(room, nw.w, u, LIGHT.bedside.y, g, { lm: LIGHT.bedside.lm, K, why: 'leselampe ved senga', kind: 'reading' });
        }
      }
      // wall lamps
      if (atLeast(rule.wall) || (rich && ['bedroom', 'office', 'hall', 'dining'].includes(use))) {
        if (!hints.some((h) => h.type === 'bed')) wallLamps(room, subGroup('vegg', 'Vegglamper', { dimmer: 0.5 }), K, `${use}: vegglamper på den lengste ledige veggen`);
      }
    }
    counts[room.id] = lights.length - before;
  }

  roomMin = LIGHT.minCeiling;
  // ---- stairs: step lights in the wall along the flight (or a lamp over the stair where no wall is near)
  if (cfg.stairs !== false && !basic) for (const st of input.stairs || []) stairLights(st);

  // ---- outdoors: the outer doors, the terraces and balconies, the carport
  if (cfg.outdoor !== false) outdoorLights();

  // ---- the cap: the densest downlight groups thinned until the house is under it
  if (lights.length > cap) {
    note('lighting', `${lights.length} lys er over taket på ${cap} – spottene tynnes ut`);
    const dl = lights.filter((l) => l.type === 'downlight');
    const drop = new Set();
    for (let i = 1; i < dl.length && lights.length - drop.size > cap; i += 2) drop.add(dl[i]);
    for (let i = lights.length - 1; i >= 0; i--) if (drop.has(lights[i])) lights.splice(i, 1);
  }

  // ---- groups without lights out
  const used = new Set(lights.map((l) => l.group));
  const outGroups = groups.filter((g) => used.has(g.id));
  const byType = {};
  for (const l of lights) byType[l.type] = (byType[l.type] || 0) + 1;
  return { builtInLights: lights, lightGroups: outGroups, issues, stats: { lights: lights.length, groups: outGroups.length, byType, byRoom: counts, level } };

  // ------------------------------------------------------------------------------------------------------------
  // helpers that need the state above

  /** The kitchen part of an open room: the hints' rectangles grown by 1,2 m (as a convex hull clipped by bounds). */
  function kitchenZoneOf(room, list) {
    const pts = [];
    for (const h of list) {
      if (h.type === 'upper-cabinets') {
        const a = P(h.from), b = P(h.to);
        const d = norm(sub(b, a));
        let n = [-d[1], d[0]];
        if (!inPolygon(...add(add(a, sub(b, a), 0.5), n, 0.2), room.polygon)) n = [-n[0], -n[1]];
        pts.push(add(a, d, -0.3), add(b, d, 0.3), add(add(b, d, 0.3), n, 1.8), add(add(a, d, -0.3), n, 1.8));
      } else {
        const r = rectOf(h, [2.4, 0.9]);
        const v = [-r.ax[1], r.ax[0]];
        for (const [su, sv] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) pts.push(add(add(r.c, r.ax, su * (r.L / 2 + 1.0)), v, sv * (r.W / 2 + 1.0)));
      }
    }
    const hull = convexHull(pts);
    // clip to the room: keep the hull, the grid tests every point against the room as well
    return hull.length >= 3 ? hull : room.polygon;
  }
  /** Ceiling lamps of the open room outside the kitchen zone (one per ~15 m² of what is left). */
  function plafondsOutside(room, poly, zone, lmTotal, group, K, why) {
    const restArea = Math.abs(signedArea(poly)) - Math.abs(signedArea(zone));
    const n = clamp(Math.round(restArea / LIGHT.plafond.areaPerLamp), 1, 2);
    const ok = (q) => !inPolygon(q[0], q[1], zone) && edgeDist(q, zone) > 0.6 && ceilingOk(room, q, 0.5, 2.1);
    let made = 0;
    let p = freestPoint(poly, ok);
    const taken = [];
    for (let i = 0; i < n && p; i++) {
      ceilingLight(room, p, 'plafond', group, { dims: { d: LIGHT.plafond.d, h: LIGHT.plafond.h }, lumens: Math.round(clamp(lmTotal / n, ...LIGHT.plafond.lm)), lightColorK: K, source: why });
      taken.push(p);
      made++;
      p = freestPoint(poly, (q) => ok(q) && taken.every((t) => len(sub(q, t)) > 2.5));
    }
    return made;
  }
  /** Less than a quarter of the room under a flat ceiling of at least 2,1 m. */
  function slopingRoom(room) {
    const b = frameBounds(room.polygon, [1, 0]);
    let n = 0, flat = 0;
    for (let x = b.u0 + 0.25; x < b.u1; x += 0.5) {
      for (let z = b.v0 + 0.25; z < b.v1; z += 0.5) {
        if (!inPolygon(x, z, room.polygon)) continue;
        n++;
        if (ceilingAt(room.id, x, z) >= 2.1 && ceilingSlope(room.id, [x, z]).steep < LIGHT.flatSlope) flat++;
      }
    }
    return n > 0 && flat / n < 0.25;
  }

  function stairLights(st) {
    const walk = (st.walkLine || []).map(P);
    if (walk.length < 2 || !(st.risers > 1)) return;
    const lower = (st.roomIds || []).map((id) => roomsById.get(id)).find((r) => r && r.levelId === st.fromLevel);
    const segLen = walk.slice(1).map((p, i) => len(sub(p, walk[i])));
    const total = segLen.reduce((s, x) => s + x, 0);
    const at = (t) => {
      let d = t * total;
      for (let i = 0; i < segLen.length; i++) {
        if (d <= segLen[i] || i === segLen.length - 1) {
          const k = segLen[i] > 0 ? clamp(d / segLen[i], 0, 1) : 0;
          return { p: add(walk[i], sub(walk[i + 1], walk[i]), k), dir: norm(sub(walk[i + 1], walk[i])) };
        }
        d -= segLen[i];
      }
      return { p: walk[walk.length - 1], dir: [1, 0] };
    };
    const every = rich ? 2 : LIGHT.step.everyRisers;
    const group = groupFor(`stair:${st.id}`, { id: (input.stairs || []).length > 1 ? `trapp-${st.id}` : 'trapp', label: 'Trappa', roomId: null, levelId: st.fromLevel, dimmer: 0.5, auto: 'dark' });
    let made = 0;
    let side = null;
    for (let k = 1; k < st.risers && made < LIGHT.step.max; k += every) {
      const { p, dir } = at((k + 0.5) / st.risers);
      const yw = (st.surfaceY?.(p[0], p[1]) ?? st.bottomY + ((st.topY - st.bottomY) * k) / st.risers) + LIGHT.step.above;
      // the nearest wall face beside the walk line whose level reaches this height (one side for the whole flight)
      let best = null;
      for (const w of walls) {
        if (w.levelId !== st.fromLevel && w.levelId !== st.toLevel) continue;
        const u = dot(sub(p, w.start), w.dir);
        if (u < 0.1 || u > w.L - 0.1) continue;
        const dn = dot(sub(p, w.start), w.normal);
        if (dn < 0.05 || dn > LIGHT.step.reach) continue;
        if (Math.abs(dot(w.dir, dir)) < 0.7) continue; // along the flight, not across it
        if (yw < w.floorY + 0.05 || yw > w.floorY + (w.heightAt?.(u) ?? 2.4) - 0.1) continue;
        if (w.openings.some((o) => u > o.u0 - 0.1 && u < o.u1 + 0.1 && yw - w.floorY > o.sill - 0.1 && yw - w.floorY < o.top + 0.1)) continue;
        const s = Math.sign(dot(w.normal, [-dir[1], dir[0]]));
        if (side != null && s !== side) continue;
        if (!best || dn < best.dn) best = { w, u, dn, s };
      }
      if (!best) continue;
      side = best.s;
      const room = lower ?? roomAt(st.fromLevel, p) ?? roomsById.get(best.w.roomId);
      if (!room) continue;
      const q = add(add(best.w.start, best.w.dir, best.u), best.w.normal, 0.01);
      push({ id: `l-auto-trapp-${st.id}-${k}`, roomId: room.id, group, type: 'step', wallId: best.w.id, position: pos3(q, yw - room.floorY), normal: [r3(best.w.normal[0]), r3(best.w.normal[1])], dims: { w: 0.08, h: 0.08 }, lumens: LIGHT.step.lm, lightColorK: 2700, source: `trinnlys i veggen ved trinn ${k + 1} av ${st.risers}` });
      made++;
    }
    if (made) return;
    // an open stair: a pendant in the stairwell, from the ceiling of the upper level over the middle of the flight
    const mid = at(0.5).p;
    const upper = roomAt(st.toLevel, mid) ?? (st.roomIds || []).map((id) => roomsById.get(id)).find((r) => r && r.levelId === st.toLevel);
    if (upper && inPolygon(mid[0], mid[1], upper.polygon)) {
      const h = ceilingAt(upper.id, mid[0], mid[1]);
      push({ id: `l-auto-trapp-${st.id}-p`, roomId: upper.id, group, type: 'pendant', position: pos3(mid, h), dims: { d: 0.35, h: 0.28, drop: r3(Math.min(1.2, Math.max(0.4, h - 2.1))) }, lumens: 900, lightColorK: 2700, source: 'åpen trapp uten vegg ved siden: pendel i trapperommet' });
    } else note(`stairs/${st.id}`, 'ingen vegg langs trappa og intet rom over den – ingen trappelys');
  }

  function outdoorLights() {
    const outLamps = []; // { wall, u, levelId } – kept apart along the same wall
    const groupEntry = () => groupFor('ute:inngang', { id: 'ute-inngang', label: 'Utelys ved inngangen', roomId: null, dimmer: 0.7, auto: 'evening' });
    const groupDeck = () => groupFor('ute:terrasse', { id: 'ute-terrasse', label: 'Utelys på terrassen', roomId: null, dimmer: 0.6, auto: 'evening' });
    const groupCarport = () => groupFor('ute:carport', { id: 'ute-carport', label: 'Lys ved carporten', roomId: null, dimmer: 0.8, auto: 'evening' });
    const taken = (w, u, levelId) => outLamps.some((o) => o.levelId === levelId && segDist(add(w.start, w.dir, u), o.a, o.a) < LIGHT.outdoor.gap);
    /** The free place on the outside of w nearest to `want` within [lo, hi] (25 cm steps): no opening, no lamp near. */
    function freeOn(w, want, y, lo, hi) {
      const ok = (u) => u >= lo && u <= hi && !taken(w, u, w.levelId) && (w.heightAt?.(u) ?? 2.4) > y + 0.15
        && !w.openings.some((o) => u > o.u0 - 0.25 && u < o.u1 + 0.25 && o.top > y - 0.35 && o.sill < y + 0.35);
      for (let k = 0; k <= 24; k++) {
        const u = want + (k % 2 ? 1 : -1) * 0.25 * Math.ceil(k / 2);
        if (ok(u)) return u;
      }
      return null;
    }
    /** A lamp on the outside of the exterior wall w at u, y above the wall's floor (stored above its level's floor). */
    function outLamp(w, u, y, group, why) {
      const out = [-w.normal[0], -w.normal[1]];
      const face = add(add(w.start, w.dir, u), out, w.thickness);
      const lvFloor = levels.get(w.levelId)?.floorY ?? 0;
      const wallFloor = roomsById.get(w.roomId)?.floorY ?? lvFloor;
      const a = add(w.start, w.dir, u);
      if (taken(w, u, w.levelId)) return false;
      outLamps.push({ a, levelId: w.levelId });
      push({ id: `l-auto-ute-${lights.length + 1}`, roomId: OUTSIDE_ROOM, levelId: w.levelId, group, type: 'wall', outdoor: true, wallId: w.id, position: pos3(add(face, out, LIGHT.wall.depth / 2), y + wallFloor - lvFloor), normal: [r3(out[0]), r3(out[1])], dims: { w: 0.12, h: 0.24, depth: LIGHT.wall.depth }, style: 'outdoor', lumens: LIGHT.outdoor.lm, lightColorK: LIGHT.outdoor.K, source: why });
      return true;
    }
    /** A spot beside (or over) the opening o of w for an outdoor lamp. */
    function besideDoor(w, o) {
      const y = Math.max(1.8, (o.top ?? 2.1) - 0.15);
      const free = (u) => u > 0.15 && u < w.L - 0.15 && !w.openings.some((x) => u > x.u0 - 0.15 && u < x.u1 + 0.15 && x.top > y - 0.3 && x.sill < y + 0.3) && (w.heightAt?.(u) ?? 2.4) > y + 0.15;
      for (const u of [o.u1 + 0.3, o.u0 - 0.3]) if (free(u)) return { u, y };
      return (w.heightAt?.((o.u0 + o.u1) / 2) ?? 2.4) > (o.top ?? 2.1) + 0.45 ? { u: (o.u0 + o.u1) / 2, y: (o.top ?? 2.1) + 0.25 } : null;
    }
    // the outer doors (front doors first: they get the lamp when two doors share one)
    const doors = [];
    for (const w of walls) {
      if (!(w.thickness > 0)) continue;
      for (const o of w.openings) {
        const outer = Array.isArray(o.connects) ? o.connects.includes(OUTSIDE_ROOM) : w.exterior;
        if (!outer || !(o.type === 'door' || o.type === 'terrace-door')) continue;
        const use = roomUse(roomsById.get(w.roomId) ?? {});
        const terrace = o.type === 'terrace-door' || ['living', 'kitchen', 'kitchen-living', 'dining', 'bedroom'].includes(use);
        doors.push({ w, o, terrace });
      }
    }
    doors.sort((a, b) => a.terrace - b.terrace);
    for (const { w, o, terrace } of doors) {
      const group = terrace ? groupDeck() : groupEntry();
      const why = terrace ? `utelampe ved terrassedøra ${o.id}` : `utelampe ved ytterdøra ${o.id}`;
      const s = besideDoor(w, o);
      if (s) {
        outLamp(w, s.u, s.y, group, why);
        continue;
      }
      // windows or sidelights tight on both sides and no room above: the nearest free place on an outer face of the
      // level within 1,5 m of the door (further along the wall, or round the corner)
      const y = Math.max(1.8, (o.top ?? 2.1) - 0.15);
      const c = add(add(w.start, w.dir, (o.u0 + o.u1) / 2), w.normal, -w.thickness);
      let best = null;
      for (const v of walls) {
        if (!v.exterior || !(v.thickness > 0) || v.levelId !== w.levelId) continue;
        const want = clamp(dot(sub(c, v.start), v.dir), 0, v.L);
        const u = freeOn(v, want, y, Math.max(0.15, want - 1.5), Math.min(v.L - 0.15, want + 1.5));
        if (u == null) continue;
        const d = len(sub(add(add(v.start, v.dir, u), v.normal, -v.thickness), c));
        if (d <= 1.5 + (o.u1 - o.u0) / 2 && (!best || d < best.d)) best = { v, u, d };
      }
      if (best) outLamp(best.v, best.u, y, group, `${why} (litt bortenfor: tett med vinduer ved døra)`);
      else note(`walls/${w.id}`, `ingen plass til utelampe ved døra ${o.id}`);
    }
    if (basic) return;
    // the terraces and balconies: lamps on the house wall along them, one per ~3 m
    for (const dk of input.decks || []) {
      const lvId = dk.levelId ?? [...levels.values()].sort((a, b) => Math.abs(a.floorY - dk.top) - Math.abs(b.floorY - dk.top))[0]?.id;
      for (const e of dk.edges || []) {
        for (const [s0, s1] of e.house || []) {
          const L = s1 - s0;
          if (L < 1) continue;
          const n = Math.max(1, Math.round(L / LIGHT.outdoor.spacing));
          for (let i = 0; i < n; i++) {
            const pt = add(P(e.a), P(e.dir), s0 + (L * (i + 0.5)) / n);
            // the exterior wall whose outer face is there
            let best = null;
            for (const w of walls) {
              if (!w.exterior || !(w.thickness > 0) || (lvId && w.levelId !== lvId)) continue;
              const u = dot(sub(pt, w.start), w.dir);
              if (u < 0.2 || u > w.L - 0.2) continue;
              const d = Math.abs(-dot(sub(pt, w.start), w.normal) - w.thickness);
              if (d < 0.15 && (!best || d < best.d)) best = { w, u, d };
            }
            if (!best) continue;
            const room = roomsById.get(best.w.roomId);
            const y = dk.top + LIGHT.outdoor.y - (room?.floorY ?? 0);
            // off the windows and doors of that wall and the other lamps, along the deck
            const ua = dot(sub(add(P(e.a), P(e.dir), s0), best.w.start), best.w.dir), ub = dot(sub(add(P(e.a), P(e.dir), s1), best.w.start), best.w.dir);
            const u = freeOn(best.w, best.u, y, Math.max(Math.min(ua, ub), 0.2), Math.min(Math.max(ua, ub), best.w.L - 0.2));
            if (u == null) continue;
            outLamp(best.w, u, y, groupDeck(), `utelampe på husveggen ved ${dk.kind === 'balcony' ? 'balkongen' : 'terrassen'} ${dk.id}`);
          }
        }
      }
    }
    // the carport: lamps on the house wall it stands against
    for (const [i, h] of outdoorHints.entries()) {
      const o = (h.outline || []).map(P);
      if (o.length < 3) continue;
      let made = 0;
      for (const w of walls) {
        if (!w.exterior || !(w.thickness > 0)) continue;
        const out = [-w.normal[0], -w.normal[1]];
        // the wall's outer face runs along the carport (its middle within 0,6 m of the outline)
        const us = [];
        for (let u = 0.3; u < w.L - 0.3; u += 0.5) {
          const q = add(add(add(w.start, w.dir, u), out, w.thickness), out, 0.3);
          if (inPolygon(q[0], q[1], o) || edgeDist(q, o) < 0.3) us.push(u);
        }
        if (us.length < 2) continue;
        const a = us[0], b = us[us.length - 1];
        const n = b - a > 4 ? 2 : 1;
        const y = 2.0;
        for (let k = 0; k < n; k++) {
          const want = n === 1 ? (a + b) / 2 : a + ((b - a) * (k + 0.5)) / 2;
          const u = freeOn(w, want, y, n === 1 ? a : a + ((b - a) * k) / 2, n === 1 ? b : a + ((b - a) * (k + 1)) / 2);
          if (u != null && outLamp(w, u, y, groupCarport(), 'lampe på husveggen ved carporten')) made++;
        }
      }
      if (!made) note(`lighting.hints[carport ${i}]`, 'carporten står ikke inntil en yttervegg – ingen lampe (en frittstående carport trenger sitt eget tak i formatet)');
    }
  }
}

/** Convex hull (monotone chain) of plan points. */
function convexHull(points) {
  const pts = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (pts.length < 3) return pts;
  const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], hi = [];
  for (const p of pts) {
    while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop();
    lo.push(p);
  }
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (hi.length >= 2 && cr(hi[hi.length - 2], hi[hi.length - 1], p) <= 0) hi.pop();
    hi.push(p);
  }
  return lo.slice(0, -1).concat(hi.slice(0, -1));
}
