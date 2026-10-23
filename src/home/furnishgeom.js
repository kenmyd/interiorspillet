/**
 * FURNISHING – furniture from the game's catalogue in the rooms of a generated house (notes/moblering-genererte-hus.md),
 * without three.js: layout.js (house.furnishing), the builder (home/furnish.js), the original design (home/existing.js)
 * and the validator (data/scripts/house.mjs) read the same model.
 *
 *   resolveFurnishing(raw, ctx) → { furnishing, issues }   the house's `furnishing` with its defaults (null without)
 *   roomUse(room, settings) → use                      what a room is furnished as (FURNISH_USES)
 *   roomInput(layout, roomId) → room                   a room of layout.house as furnishRoom reads it
 *   furnishRoom(room, products) → { use, items, reserved, notes, walk }   the core: one room in, placed pieces out
 *   furnishHouse(layout, catalog) → { items, rooms }   every room, as DesignState item specs (cached per layout)
 *
 * The room furnishRoom reads (plain data, plan points [x, z] in metres, heights over the room's floor):
 *   { id, levelId, use, name, kind, seed,
 *     polygon   [[x, z], …] the room-side faces of its walls
 *     walls     [{ id, a, b, n, holes: [{ id, u0, u1, sill, top, type, walk }] }] the room's faces (n into the room) and
 *               every hole in them (its own openings and those of the walls it is the back of); walk = the player goes
 *               through (a door, a passage, a terrace door: sill at the floor)
 *     swings    [box] the sweep of every door leaf that opens into the room
 *     ceilingAt (x, z) → the ceiling's height over the floor (a sloped ceiling under a roof is lower at the walls)
 *     keepOut   [box & { solid? }] stairs, stairwells, built-ins: no furniture there (solid: the player cannot pass
 *               either, a built-in)
 *     hints     [{ kind, at, rotationDeg? }] the plan's furniture symbols in this room (FURNISH_HINTS) }
 * A box is { cx, cz, ax, az, hw, hd } (centre, the unit axes of its width and depth, half sizes), as Placement.js.
 *
 * What a room gets (USES below): a sofa, a coffee table on a rug, a TV bench and TV across, an armchair, a lamp, a
 * bookcase or sideboard, a plant and a picture (stue); a bed sized after the room with nightstands, a wardrobe, a
 * dresser, a rug and a picture (soverom); a table with chairs (kjøkken, spisestue, a large stue); a desk with a chair,
 * a bookcase and a lamp (kontor); shoe storage, a bench, coat hooks, a mirror and a runner (gang, entré); only loose
 * things in the bathroom and the laundry (a bath mat, a laundry basket, a towel ladder) – their fixtures are another
 * task. Every piece keeps out of the doors (the hole, DOOR_ZONE in front on each side, the leaf's sweep), out of the
 * floor in front of a window that goes down to the floor, from under a window it is taller than, from under a ceiling
 * it does not fit, and out of the keep-outs; after each piece the walk grid (the player's radius, PLAYER R) checks that
 * every door of the room still reaches every other and that the front of every piece can be reached – a piece that
 * would close the way is tried elsewhere, smaller, or left out. A hint puts its piece where the plan drew it (as near
 * as the rules allow); a hint of a fixture (kitchen, toilet …) keeps the floor there free.
 *
 * Deterministic: the same house gives the same furniture (a seeded generator per room, never Math.random).
 */

export const FURNISH_USES = Object.freeze([
  'living', 'kitchen', 'dining', 'bedroom', 'office', 'hall', 'entrance', 'bathroom', 'wc', 'laundry', 'storage',
  'wardrobe', 'technical', 'garage', 'other',
]);
/** The plan's furniture symbols (the KI's FURNITURE_KINDS) and a few more a house file may name. */
export const FURNISH_HINTS = Object.freeze([
  'bed', 'sofa', 'table', 'dining-table', 'coffee-table', 'desk', 'wardrobe', 'dresser', 'bookcase', 'armchair', 'tv',
  'kitchen', 'stove', 'fridge', 'toilet', 'shower', 'bathtub', 'washbasin', 'washer', 'fireplace', 'car', 'other',
]);
/** Hint kinds that are fixtures: no furniture is made for them, the floor they take (and in front of them) stays free. */
const FIXTURE_HINTS = {
  // [width along the wall, depth, free floor in front]
  kitchen: [2.4, 0.62, 1.0],
  stove: [0.6, 0.62, 1.0],
  fridge: [0.6, 0.65, 1.0],
  toilet: [0.4, 0.7, 0.6],
  shower: [0.9, 0.9, 0.6],
  bathtub: [1.7, 0.75, 0.6],
  washbasin: [0.6, 0.5, 0.7],
  washer: [0.6, 0.62, 0.7],
  fireplace: [1.0, 0.6, 0.8],
  car: [2.5, 5.0, 0.6],
};

/** The player's capsule radius (src/config.js PLAYER.radius) – kept here so the module has no imports. */
export const PLAYER_R = 0.3;
/** Ceilings lower than this stop the player (1.8 m tall). */
const HEAD = 1.85;
/** Backs stand this far off the wall face (the skirting is 12 mm). */
const WALL_GAP = 0.02;
/** Free floor in front of a door or passage, on each side of it. */
export const DOOR_ZONE = 0.9;
/** Free floor in front of a window that goes down to the floor (and a terrace door). */
export const FLOOR_WINDOW_ZONE = 0.7;
/** In front of an ordinary window nothing taller than its sill stands closer than this. */
const WINDOW_ZONE = 0.35;
/** A window with its sill under this goes down to the floor. */
const FLOOR_SILL = 0.3;
/** Floor furniture taller than this collides with the player (SceneSync: dynamic boxes over 0.3 m). */
export const COLLIDE_H = 0.3;
/** The game's collision boxes are this much smaller than the model on each side (SceneSync, chairs under tables). */
const SHRINK = 0.02;
/** The walk grid's cell: fine enough for the player's 0.6 m between a bed and a wall. */
const CELL = 0.05;
/** A piece may cut off at most this much more open floor from the doors (m²): a corner behind a nightstand, not half a room. */
const POCKET = 0.5;
const STEP = 0.05;
const DEG = Math.PI / 180;
const EPS = 1e-6;

const num = (v) => typeof v === 'number' && Number.isFinite(v);
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isPt = (p) => Array.isArray(p) && p.length >= 2 && num(p[0]) && num(p[1]);
const r4 = (v) => Math.round(v * 1e4) / 1e4;

// ---------------------------------------------------------------------------------------------------------------
// The format

/**
 * The house's `furnishing` with its defaults:
 *   { auto: true, rooms: { [roomId]: { use?, off? } }, hints: [{ kind, at, levelId?, roomId?, rotationDeg? }], seed }
 * auto false: only the hinted pieces (with what belongs to them: chairs, nightstands …). Issues are Norwegian
 * messages for the validator (an unknown room, use or hint kind, a hint without a point).
 * @param {object|null|undefined} raw  spec.furnishing
 * @param {{ roomIds?: Set<string>|string[], levelIds?: Set<string>|string[] }} [ctx]
 * @returns {{ furnishing: object|null, issues: { level: 'error'|'warn', msg: string }[] }}
 */
export function resolveFurnishing(raw, ctx = {}) {
  const issues = [];
  if (raw == null) return { furnishing: null, issues };
  const error = (msg) => issues.push({ level: 'error', msg });
  const warn = (msg) => issues.push({ level: 'warn', msg });
  if (!isObj(raw)) {
    error('furnishing: må være et objekt { auto, rooms, hints }');
    return { furnishing: null, issues };
  }
  const roomIds = ctx.roomIds ? new Set(ctx.roomIds) : null;
  const levelIds = ctx.levelIds ? new Set(ctx.levelIds) : null;
  for (const k of Object.keys(raw)) if (!['auto', 'rooms', 'hints', 'seed', 'source'].includes(k)) warn(`furnishing: ukjent felt «${k}»`);
  const rooms = {};
  if (raw.rooms != null && !isObj(raw.rooms)) error('furnishing.rooms: må være et objekt { romId: { use, off } }');
  for (const [id, r] of Object.entries(isObj(raw.rooms) ? raw.rooms : {})) {
    if (roomIds && !roomIds.has(id)) error(`furnishing.rooms: rommet «${id}» finnes ikke`);
    if (!isObj(r)) {
      error(`furnishing.rooms/${id}: må være et objekt { use, off }`);
      continue;
    }
    if (r.use != null && !FURNISH_USES.includes(r.use)) error(`furnishing.rooms/${id}: ukjent bruk «${r.use}» (${FURNISH_USES.join(', ')})`);
    rooms[id] = { ...(FURNISH_USES.includes(r.use) ? { use: r.use } : {}), ...(r.off === true ? { off: true } : {}) };
  }
  const hints = [];
  if (raw.hints != null && !Array.isArray(raw.hints)) error('furnishing.hints: må være en liste');
  (Array.isArray(raw.hints) ? raw.hints : []).forEach((h, i) => {
    if (!isObj(h) || !isPt(h.at)) return error(`furnishing.hints[${i}]: mangler punktet at: [x, z]`);
    if (!FURNISH_HINTS.includes(h.kind)) warn(`furnishing.hints[${i}]: ukjent møbel «${h.kind}» – brukes ikke`);
    if (h.roomId != null && roomIds && !roomIds.has(h.roomId)) error(`furnishing.hints[${i}]: rommet «${h.roomId}» finnes ikke`);
    if (h.levelId != null && levelIds && !levelIds.has(h.levelId)) error(`furnishing.hints[${i}]: nivået «${h.levelId}» finnes ikke`);
    if (!FURNISH_HINTS.includes(h.kind) || h.kind === 'other') return;
    hints.push({
      kind: h.kind,
      at: [+h.at[0], +h.at[1]],
      ...(typeof h.levelId === 'string' ? { levelId: h.levelId } : {}),
      ...(typeof h.roomId === 'string' ? { roomId: h.roomId } : {}),
      ...(num(h.rotationDeg) ? { rotationDeg: h.rotationDeg } : {}),
    });
  });
  const furnishing = { auto: raw.auto !== false, rooms, hints, seed: num(raw.seed) || typeof raw.seed === 'string' ? raw.seed : 1 };
  return { furnishing, issues };
}

/** Room names (Norwegian) → use; the first match wins («Stue/kjøkken» is a stue with a kitchen). */
const NAME_USES = [
  [/kj(ø|o)kken.*stue|stue.*kj(ø|o)kken|allrom|familierom|tv-?stue|\bstue/i, 'living'],
  [/kj(ø|o)kken|\bkj\b/i, 'kitchen'],
  [/spise/i, 'dining'],
  [/kontor|arbeidsrom|hjemmekontor/i, 'office'],
  [/garderobe|walk-?in|\bwic\b|w-i-c/i, 'wardrobe'],
  [/\bwc\b|toalett/i, 'wc'],
  [/vask/i, 'laundry'],
  [/\bbad|dusj/i, 'bathroom'],
  [/sov|soverom/i, 'bedroom'],
  [/entr(é|e)|vindfang/i, 'entrance'],
  [/gang|hall|korridor|trapperom/i, 'hall'],
  [/tekn|fyrrom/i, 'technical'],
  [/garasje|carport/i, 'garage'],
  [/\bbod|lager|sportsbod/i, 'storage'],
];
/** layout room kinds → use */
const KIND_USES = { living: 'living', bedroom: 'bedroom', bathroom: 'bathroom', hall: 'hall', laundry: 'laundry', storage: 'storage', entrance: 'entrance' };

/**
 * What a room is furnished as: furnishing.rooms[id].use, else its name (Norwegian: «Kontor», «Kjøkken», «Spisestue»
 * …), else its kind (the planbygger's: living, bedroom, bathroom, hall, laundry, storage, entrance – or a KI kind),
 * else 'other'.
 */
export function roomUse(room, settings = null) {
  const set = settings?.rooms?.[room.id]?.use;
  if (FURNISH_USES.includes(set)) return set;
  const name = String(room.name ?? '');
  for (const [re, use] of NAME_USES) if (re.test(name)) return use;
  if (FURNISH_USES.includes(room.kind)) return room.kind;
  return KIND_USES[room.kind] ?? 'other';
}

// ---------------------------------------------------------------------------------------------------------------
// Plan geometry (boxes as Placement.js: centre, unit axes of width and depth, half sizes)

/** A box at (cx, cz) turned like an item of rotationDeg (rotation.y: local +x → (cos, −sin), front +z → (sin, cos)). */
export function box(cx, cz, rotationDeg, w, d) {
  const t = rotationDeg * DEG;
  const c = Math.cos(t), s = Math.sin(t);
  return { cx, cz, ax: [c, -s], az: [s, c], hw: w / 2, hd: d / 2 };
}
/** A point in a box's frame (lx along its width, lz along its depth) → plan. */
const at = (b, lx, lz) => [b.cx + b.ax[0] * lx + b.az[0] * lz, b.cz + b.ax[1] * lx + b.az[1] * lz];
/** The part [x0, x1] × [z0, z1] of a box's frame as a box. */
const part = (b, x0, x1, z0, z1) => {
  const c = at(b, (x0 + x1) / 2, (z0 + z1) / 2);
  return { cx: c[0], cz: c[1], ax: b.ax, az: b.az, hw: Math.abs(x1 - x0) / 2, hd: Math.abs(z1 - z0) / 2 };
};
const grow = (b, m) => ({ ...b, hw: Math.max(0, b.hw + m), hd: Math.max(0, b.hd + m) });
export const corners = (b) => [at(b, -b.hw, -b.hd), at(b, b.hw, -b.hd), at(b, b.hw, b.hd), at(b, -b.hw, b.hd)];
/** Do two boxes overlap by more than m (m < 0: touching within −m is fine)? Separating axes. */
export function overlaps(a, b, m = 0) {
  const dx = b.cx - a.cx, dz = b.cz - a.cz;
  for (const k of [a.ax, a.az, b.ax, b.az]) {
    const ra = a.hw * Math.abs(a.ax[0] * k[0] + a.ax[1] * k[1]) + a.hd * Math.abs(a.az[0] * k[0] + a.az[1] * k[1]);
    const rb = b.hw * Math.abs(b.ax[0] * k[0] + b.ax[1] * k[1]) + b.hd * Math.abs(b.az[0] * k[0] + b.az[1] * k[1]);
    if (Math.abs(dx * k[0] + dz * k[1]) >= ra + rb + m - EPS) return false;
  }
  return true;
}
/** Distance from a point to a box (0 inside). */
export function boxDist(p, b) {
  const dx = p[0] - b.cx, dz = p[1] - b.cz;
  const lx = Math.abs(dx * b.ax[0] + dz * b.ax[1]) - b.hw;
  const lz = Math.abs(dx * b.az[0] + dz * b.az[1]) - b.hd;
  return Math.hypot(Math.max(lx, 0), Math.max(lz, 0));
}
export function inPoly(x, z, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
function segDist(p, a, b) {
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const L2 = dx * dx + dz * dz || 1e-12;
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / L2));
  return Math.hypot(p[0] - (a[0] + dx * t), p[1] - (a[1] + dz * t));
}
/** Is the whole box inside the polygon (its edges sampled every ≤ 10 cm, no corner of the polygon inside it)? */
export function boxInPoly(b, poly) {
  const cs = corners(b);
  for (let i = 0; i < 4; i++) {
    const p = cs[i], q = cs[(i + 1) % 4];
    const n = Math.max(1, Math.ceil(Math.hypot(q[0] - p[0], q[1] - p[1]) / 0.1));
    for (let k = 0; k < n; k++) if (!inPoly(p[0] + ((q[0] - p[0]) * k) / n, p[1] + ((q[1] - p[1]) * k) / n, poly)) return false;
  }
  const inner = grow(b, -0.005);
  return !poly.some((v) => boxDist(v, inner) === 0 && inner.hw > 0 && inner.hd > 0);
}
const polyArea = (poly) => Math.abs(poly.reduce((s, p, i) => {
  const q = poly[(i + 1) % poly.length];
  return s + p[0] * q[1] - q[0] * p[1];
}, 0)) / 2;
/** rotationDeg of an item whose front (+z) looks along n. */
const facing = (n) => r4(Math.atan2(n[0], n[1]) / DEG);

/** Seeded generator (mulberry32 over a string hash): the same room gives the same choices. */
function rng(seed) {
  let h = 2166136261;
  for (const ch of String(seed)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  let a = h >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------------------------------------------
// The catalogue: which products a role takes, in order of preference (the catalogue's order: Bohus first)

const sub = (p) => String(p.subcategory ?? '');
const ROLES = {
  bed: (p) => p.archetype === 'bed',
  nightstand: (p) => p.archetype === 'bedside-table' && !/vegghengt/.test(sub(p)) && p.dims.h >= 0.4,
  wardrobe: (p) => p.category === 'garderobe' && p.archetype === 'wardrobe',
  dresser: (p) => p.archetype === 'dresser' && p.dims.h <= 1.0,
  sofa: (p) => p.archetype === 'sofa-straight' && !/sove/.test(sub(p)),
  armchair: (p) => p.category === 'lenestol' && ['lounge-wood', 'club-box', 'shell-legs', 'tub-swivel'].includes(p.archetype),
  coffeeTable: (p) => p.category === 'bord' && /sofabord/.test(sub(p)),
  diningTable: (p) => p.category === 'bord' && /spisebord/.test(sub(p)),
  chair: (p) => p.category === 'stoler',
  desk: (p) => /skrivebord/.test(sub(p)) || p.archetype === 'desk',
  deskChair: (p) => /kontorstol/.test(sub(p)),
  tvBench: (p) => p.category === 'tvbenk' && p.dims.h >= 0.4,
  sideboard: (p) => p.category === 'skjenk' && p.dims.h >= 0.7,
  bookcase: (p) => p.archetype === 'bookcase',
  rug: (p) => p.category === 'teppe' && p.mount === 'rug' && !/lopere/.test(sub(p)) && p.params?.shape !== 'round',
  runner: (p) => p.category === 'teppe' && /lopere/.test(sub(p)),
  floorLamp: (p) => p.category === 'smalamper' && p.mount === 'floor' && p.dims.d <= 0.6 && p.dims.h >= 1.2,
  plant: (p) => p.archetype === 'plant-floor',
  art: (p) => p.archetype === 'art-frame' && p.mount === 'wall',
  mirror: (p) => p.archetype === 'mirror' && p.mount === 'wall',
  shoeCabinet: (p) => p.archetype === 'shoe-cabinet' && p.dims.h >= 0.8,
  bench: (p) => p.category === 'gang' && p.archetype === 'bench',
  coatStand: (p) => p.archetype === 'coat-stand',
  coatRack: (p) => p.archetype === 'coat-rack' && p.mount === 'wall',
  bathMat: (p) => p.category === 'bad' && p.archetype === 'rug',
  laundryBasket: (p) => p.category === 'bad' && p.archetype === 'basket',
  towelLadder: (p) => p.archetype === 'towel-ladder',
};
/** The TV is not in the catalogue (the owner's are «existing»): a 55″ on the wall over the TV bench. */
const TV = Object.freeze({ id: null, name: 'TV (55″)', category: 'elektronikk', archetype: 'tv', mount: 'wall', dims: { w: 1.23, d: 0.05, h: 0.71 } });

/**
 * The products of a role, best first, that fit (w × d × h at most / at least). `pick` takes up to `spread` of them in
 * a seeded order, so two rooms of the same kind need not get the same piece.
 */
function choose(S, role, { maxW = Infinity, maxD = Infinity, maxH = Infinity, minW = 0, test = null, spread = 3, sort = null } = {}) {
  const ok = S.products.filter((p) => ROLES[role]?.(p) && p.dims && p.dims.w <= maxW + EPS && p.dims.d <= maxD + EPS && p.dims.h <= maxH + EPS && p.dims.w >= minW - EPS && (!test || test(p)));
  if (sort) ok.sort(sort);
  const head = ok.slice(0, spread);
  const order = head.map((p) => [S.rand(), p]).sort((a, b) => a[0] - b[0]).map((x) => x[1]);
  return [...order, ...ok.slice(spread)];
}

// ---------------------------------------------------------------------------------------------------------------
// The room: walls, zones, the walk grid

function prepare(room, products, opts) {
  const poly = room.polygon.map((p) => [p[0], p[1]]);
  const walls = (room.walls || []).map((w) => {
    const t = [w.b[0] - w.a[0], w.b[1] - w.a[1]];
    const L = Math.hypot(t[0], t[1]);
    const dir = L > EPS ? [t[0] / L, t[1] / L] : [1, 0];
    const holes = (w.holes || []).map((h) => ({ ...h, walk: h.walk ?? (h.type !== 'window' && (h.sill ?? 0) <= 0.05) }));
    const open = holes.filter((h) => h.walk && h.type === 'opening').reduce((s, h) => s + Math.max(0, Math.min(L, h.u1) - Math.max(0, h.u0)), 0);
    return { id: w.id, a: w.a, b: w.b, n: w.n, dir, L, holes, open: open > 0.6 * L };
  }).filter((w) => w.L > 0.05);
  const ceilingAt = typeof room.ceilingAt === 'function' ? room.ceilingAt : () => (num(room.ceiling) ? room.ceiling : 2.4);
  const S = {
    room, poly, walls, ceilingAt, products, rand: rng(`${opts.seed ?? 1}|${room.seed ?? room.id}`),
    area: polyArea(poly), placed: [], wallItems: [], hard: [], low: [], reserved: [], notes: [],
  };
  // the room's main frame: the direction of its longest wall, the extents along (W) and across (D)
  const main = walls.reduce((b, w) => (!b || w.L > b.L ? w : b), null);
  const u = main ? main.dir : [1, 0];
  const v = [-u[1], u[0]];
  const pu = poly.map((p) => p[0] * u[0] + p[1] * u[1]), pv = poly.map((p) => p[0] * v[0] + p[1] * v[1]);
  S.W = Math.max(...pu) - Math.min(...pu);
  S.D = Math.max(...pv) - Math.min(...pv);
  if (S.W < S.D) [S.W, S.D] = [S.D, S.W];
  S.axis = u;
  S.centre = poly.reduce((s, p) => [s[0] + p[0] / poly.length, s[1] + p[1] / poly.length], [0, 0]);

  // doors and passages: the hole and DOOR_ZONE in front (the other room keeps its own side); windows down to the floor:
  // FLOOR_WINDOW_ZONE in front; ordinary windows: WINDOW_ZONE in front, for what is taller than the sill
  S.doors = [];
  for (const w of walls) {
    for (const h of w.holes) {
      const u0 = Math.max(0, h.u0), u1 = Math.min(w.L, h.u1);
      if (u1 - u0 < 0.05) continue;
      const mid = (u0 + u1) / 2;
      const p = [w.a[0] + w.dir[0] * mid, w.a[1] + w.dir[1] * mid];
      const zone = (depth, extra = 0.1) => {
        const c = [p[0] + w.n[0] * depth / 2, p[1] + w.n[1] * depth / 2];
        return box(c[0], c[1], facing(w.n), u1 - u0 + 2 * extra, depth);
      };
      if (h.walk) {
        S.hard.push({ ...zone(DOOR_ZONE), what: 'door' });
        if (u1 - u0 >= 2 * PLAYER_R + 0.04) S.doors.push({ id: h.id, at: p, n: w.n, width: u1 - u0, wallId: w.id, type: h.type, outer: !!h.outer });
        if (h.type === 'terrace-door') S.hard.push({ ...zone(FLOOR_WINDOW_ZONE), what: 'window', rugOk: true });
      } else if (h.type === 'window' || h.type === 'terrace-door') {
        if ((h.sill ?? 1) < FLOOR_SILL) S.hard.push({ ...zone(FLOOR_WINDOW_ZONE, 0.05), what: 'window', rugOk: true });
        else S.low.push({ ...zone(WINDOW_ZONE, 0.05), sill: h.sill });
      }
    }
  }
  for (const s of room.swings || []) S.hard.push({ ...s, what: 'swing' });
  for (const k of room.keepOut || []) S.hard.push({ ...k, what: k.what ?? 'keep-out' });
  // fixtures drawn on the plan: their floor and the floor in front of them
  S.hints = [];
  for (const h of room.hints || []) {
    if (FIXTURE_HINTS[h.kind]) {
      const r = fixtureZone(S, h);
      if (r) {
        S.hard.push({ ...r.zone, what: h.kind, solid: true });
        S.reserved.push({ kind: h.kind, box: r.zone, at: h.at });
      }
    } else S.hints.push({ ...h, used: false });
  }
  S.walk = makeWalk(S);
  return S;
}

/** The nearest wall to a point (perpendicular distance, within its length), or null. */
function nearestWall(S, p, maxDist = 2.0) {
  let best = null;
  for (const w of S.walls) {
    if (w.open) continue;
    const q = [p[0] - w.a[0], p[1] - w.a[1]];
    const u = q[0] * w.dir[0] + q[1] * w.dir[1];
    const d = q[0] * w.n[0] + q[1] * w.n[1];
    if (u < -0.2 || u > w.L + 0.2 || d < -0.1 || d > maxDist) continue;
    if (!best || d < best.d) best = { w, u: Math.max(0, Math.min(w.L, u)), d };
  }
  return best;
}

/** A fixture hint's floor (against the nearest wall when there is one) with the free floor in front of it. */
function fixtureZone(S, h) {
  const [fw, fd, front] = FIXTURE_HINTS[h.kind];
  const nw = nearestWall(S, h.at, Math.max(1.2, fd + 0.6));
  if (!nw) return { zone: box(h.at[0], h.at[1], h.rotationDeg ?? 0, Math.max(fw, fd) + front, Math.max(fw, fd) + front) };
  const { w } = nw;
  const len = Math.min(fw, w.L);
  const u = Math.max(len / 2, Math.min(w.L - len / 2, nw.u));
  const depth = fd + front;
  const c = [w.a[0] + w.dir[0] * u + w.n[0] * depth / 2, w.a[1] + w.dir[1] * u + w.n[1] * depth / 2];
  return { zone: box(c[0], c[1], facing(w.n), len, depth) };
}

/**
 * The walk grid: cells of CELL over the room, free where the player (PLAYER_R) stands inside the polygon, clear of the
 * walls (the holes the player walks through are not walls), of the solid keep-outs and under a ceiling high enough.
 * Targets: a point just inside every door and passage. `ok(extra)` floods from the targets with the furniture's cells
 * (and `extra`) blocked: every door must still reach the others, and each piece's reach zones a reached cell.
 */
function makeWalk(S) {
  const xs = S.poly.map((p) => p[0]), zs = S.poly.map((p) => p[1]);
  const x0 = Math.min(...xs), z0 = Math.min(...zs);
  const nx = Math.max(1, Math.ceil((Math.max(...xs) - x0) / CELL)), nz = Math.max(1, Math.ceil((Math.max(...zs) - z0) / CELL));
  const segs = [];
  for (const w of S.walls) {
    const cuts = w.holes.filter((h) => h.walk).map((h) => [Math.max(0, h.u0), Math.min(w.L, h.u1)]).sort((a, b) => a[0] - b[0]);
    let u = 0;
    for (const [a, b] of [...cuts, [w.L, w.L]]) {
      if (a - u > 1e-3) segs.push([[w.a[0] + w.dir[0] * u, w.a[1] + w.dir[1] * u], [w.a[0] + w.dir[0] * a, w.a[1] + w.dir[1] * a]]);
      u = Math.max(u, b);
    }
  }
  const solids = S.hard.filter((h) => h.solid);
  const free = new Uint8Array(nx * nz);
  const centre = (i) => [x0 + ((i % nx) + 0.5) * CELL, z0 + (Math.floor(i / nx) + 0.5) * CELL];
  for (let i = 0; i < free.length; i++) {
    const p = centre(i);
    if (!inPoly(p[0], p[1], S.poly)) continue;
    if (segs.some(([a, b]) => segDist(p, a, b) < PLAYER_R)) continue;
    if (solids.some((b) => boxDist(p, b) < PLAYER_R)) continue;
    if (S.ceilingAt(p[0], p[1]) < HEAD) continue;
    free[i] = 1;
  }
  const cellOf = (p) => {
    const ix = Math.floor((p[0] - x0) / CELL), iz = Math.floor((p[1] - z0) / CELL);
    return ix >= 0 && iz >= 0 && ix < nx && iz < nz ? iz * nx + ix : -1;
  };
  /** the nearest free cell to a point within `r` (−1 if none) */
  const nearFree = (p, r = 0.3) => {
    let best = -1, bd = Infinity;
    const k = Math.ceil(r / CELL);
    const c0 = cellOf(p);
    if (c0 < 0) return -1;
    const ix0 = c0 % nx, iz0 = Math.floor(c0 / nx);
    for (let dz = -k; dz <= k; dz++) for (let dx = -k; dx <= k; dx++) {
      const ix = ix0 + dx, iz = iz0 + dz;
      if (ix < 0 || iz < 0 || ix >= nx || iz >= nz) continue;
      const i = iz * nx + ix;
      if (!free[i]) continue;
      const q = centre(i);
      const d = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (d <= r && d < bd) (bd = d), (best = i);
    }
    return best;
  };
  const targets = [];
  for (const d of S.doors) {
    const c = nearFree([d.at[0] + d.n[0] * (PLAYER_R + 0.06), d.at[1] + d.n[1] * (PLAYER_R + 0.06)], 0.3);
    if (c >= 0) targets.push({ door: d.id, cell: c });
  }
  const blocked = new Uint8Array(nx * nz);
  const flood = (starts, extra) => {
    const seen = new Uint8Array(nx * nz);
    const q = [];
    for (const s of starts) if (free[s] && !blocked[s] && !extra?.has(s) && !seen[s]) (seen[s] = 1), q.push(s);
    while (q.length) {
      const i = q.pop();
      const ix = i % nx;
      for (const j of [ix > 0 ? i - 1 : -1, ix < nx - 1 ? i + 1 : -1, i - nx, i + nx]) {
        if (j < 0 || j >= free.length || seen[j] || !free[j] || blocked[j] || extra?.has(j)) continue;
        seen[j] = 1;
        q.push(j);
      }
    }
    return seen;
  };
  // the targets the empty room connects (a door the walls alone close off is not the furniture's to keep)
  const groups = [];
  for (const t of targets) {
    const g = groups.find((gr) => flood([gr[0].cell], null)[t.cell]);
    if (g) g.push(t);
    else groups.push([t]);
  }
  /** cells whose centre is closer to the box than the player's radius (the box shrunk like the game's colliders) */
  const cellsNear = (b) => {
    const out = [];
    const bb = grow(b, -SHRINK);
    const ext = Math.abs(bb.ax[0]) * bb.hw + Math.abs(bb.az[0]) * bb.hd + PLAYER_R, ezt = Math.abs(bb.ax[1]) * bb.hw + Math.abs(bb.az[1]) * bb.hd + PLAYER_R;
    const ix0 = Math.max(0, Math.floor((bb.cx - ext - x0) / CELL)), ix1 = Math.min(nx - 1, Math.floor((bb.cx + ext - x0) / CELL));
    const iz0 = Math.max(0, Math.floor((bb.cz - ezt - z0) / CELL)), iz1 = Math.min(nz - 1, Math.floor((bb.cz + ezt - z0) / CELL));
    for (let iz = iz0; iz <= iz1; iz++) for (let ix = ix0; ix <= ix1; ix++) {
      const i = iz * nx + ix;
      if (free[i] && boxDist(centre(i), bb) < PLAYER_R) out.push(i);
    }
    return out;
  };
  const reachIn = (seen, zones) => zones.some((z) => {
    for (const i of cellsInside(z)) if (seen[i]) return true;
    return false;
  });
  const cellsInside = (b) => {
    const out = [];
    const ext = Math.abs(b.ax[0]) * b.hw + Math.abs(b.az[0]) * b.hd, ezt = Math.abs(b.ax[1]) * b.hw + Math.abs(b.az[1]) * b.hd;
    const ix0 = Math.max(0, Math.floor((b.cx - ext - x0) / CELL)), ix1 = Math.min(nx - 1, Math.floor((b.cx + ext - x0) / CELL));
    const iz0 = Math.max(0, Math.floor((b.cz - ezt - z0) / CELL)), iz1 = Math.min(nz - 1, Math.floor((b.cz + ezt - z0) / CELL));
    for (let iz = iz0; iz <= iz1; iz++) for (let ix = ix0; ix <= ix1; ix++) {
      const i = iz * nx + ix;
      if (boxDist(centre(i), b) === 0) out.push(i);
    }
    return out;
  };
  // with no door (a room the plan left closed): the largest free part stands in for the doors
  let seeds = groups.map((g) => g[0].cell);
  if (!seeds.length) {
    let best = -1, size = 0;
    const done = new Uint8Array(nx * nz);
    for (let i = 0; i < free.length; i++) {
      if (!free[i] || done[i]) continue;
      const s = flood([i], null);
      let n = 0;
      for (let j = 0; j < s.length; j++) if (s[j]) (done[j] = 1), n++;
      if (n > size) (size = n), (best = i);
    }
    if (best >= 0) seeds = [best];
  }
  /** open floor (free, not under furniture or `extra`) the flood did not reach */
  const lostCells = (seen, extra) => {
    let n = 0;
    for (let i = 0; i < free.length; i++) if (free[i] && !blocked[i] && !extra?.has(i) && !seen[i]) n++;
    return n;
  };
  let lost = lostCells(flood(seeds, null), null);
  return {
    nx, nz, x0, z0, free, blocked, targets, groups,
    /** may `b` (a collider, null for none) stand with the pieces so far, every piece's reach zones still reachable? */
    ok(b, reach = [], all = false) {
      const extra = b ? new Set(cellsNear(b)) : null;
      for (const g of groups) {
        const seen = flood([g[0].cell], extra);
        if (!g.every((t) => seen[t.cell])) return false;
      }
      const seen = flood(seeds, extra);
      // no part of the room cut off (a wall of furniture across it, a door-less half behind it)
      if (extra && (lostCells(seen, extra) - lost) * CELL * CELL > POCKET) return false;
      // each piece: one of its reach zones reached (both sides of a double bed: all of them)
      const zones = [...S.placed.filter((p) => p.reach?.length).map((p) => [p.reach, p.reachAll]), ...(reach.length ? [[reach, all]] : [])];
      return zones.every(([z, every]) => (every ? z.every((one) => reachIn(seen, [one])) : reachIn(seen, z)));
    },
    commit(b) {
      for (const i of cellsNear(b)) blocked[i] = 1;
      lost = lostCells(flood(seeds, null), null);
    },
    /** after a piece is taken away: the blocked cells are rebuilt, and with them what is cut off */
    reset() {
      blocked.fill(0);
      lost = lostCells(flood(seeds, null), null);
    },
    /** the grid as text, a line per row of z, a character per x: '#' wall / too low, 'o' furniture, '.' reached,
     *  ',' open but not reached, 'D' a door's target (debugging and the test's failure messages) */
    ascii() {
      const seen = flood(seeds, null);
      const tset = new Set(targets.map((t) => t.cell));
      const rows = [];
      for (let iz = 0; iz < nz; iz++) {
        let s = '';
        for (let ix = 0; ix < nx; ix++) {
          const i = iz * nx + ix;
          s += tset.has(i) ? 'D' : !free[i] ? '#' : blocked[i] ? 'o' : seen[i] ? '.' : ',';
        }
        rows.push(s);
      }
      return rows.join('\n');
    },
    /** the share of the room's open floor (free, not under furniture) the player reaches from its doors */
    reached() {
      const seen = flood(seeds, null);
      let a = 0, n = 0;
      for (let i = 0; i < free.length; i++) if (free[i] && !blocked[i]) (a += seen[i] ? 1 : 0), n++;
      return n ? a / n : 0;
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Placing

/**
 * Is a piece allowed where it is (everything but the walk)? piece: { role, body, mount, h, clear, parent, rug }.
 */
function allowed(S, piece) {
  const { body } = piece;
  if (!boxInPoly(body, S.poly)) return false;
  // the floor a piece needs in front of it (doors that open, chairs pulled out, the way round a bed) is in the room
  for (const c of piece.clear || []) if (!boxInPoly(grow(c, -0.03), S.poly)) return false;
  const rug = piece.mount === 'rug';
  for (const z of S.hard) {
    if (rug && (z.rugOk || z.what === 'door')) continue;
    if (overlaps(body, z, -0.005)) return false;
  }
  if (!rug) {
    for (const z of S.low) if (piece.h > z.sill - 0.02 && overlaps(body, z, -0.005)) return false;
    // the ceiling over the whole footprint (sloped ceilings)
    const need = piece.h + 0.05;
    const pts = [...corners(body), at(body, 0, 0), at(body, 0, -body.hd), at(body, 0, body.hd), at(body, -body.hw, 0), at(body, body.hw, 0)];
    if (pts.some((p) => S.ceilingAt(p[0], p[1]) < need)) return false;
  }
  for (const q of S.placed) {
    const qRug = q.mount === 'rug';
    if (rug !== qRug) continue; // a rug lies under the furniture
    const kin = piece.parent === q || q.parent === piece || (piece.parent && piece.parent === q.parent && piece.role === q.role && piece.role === 'chair');
    if (piece.parent === q || q.parent === piece) {
      // a companion may reach under its parent (chairs under the table) but not through it
      if (piece.under !== true && overlaps(body, q.body, -0.01)) return false;
      continue;
    }
    if (overlaps(body, q.body, 0.01)) return false;
    if (kin) continue;
    for (const c of q.clear || []) if (overlaps(body, c, -0.01)) return false;
    for (const c of piece.clear || []) if (overlaps(q.body, c, -0.01)) return false;
  }
  return true;
}

/** Tries candidates (best score first); the first allowed one that keeps the room walkable is placed. */
function placeBest(S, cands, make, { tries = 10 } = {}) {
  cands.sort((a, b) => b.score - a.score);
  let walks = 0;
  for (const c of cands) {
    const piece = make(c);
    if (!piece || !allowed(S, piece)) continue;
    const collides = piece.mount === 'floor' && piece.h > COLLIDE_H;
    if (collides) {
      if (++walks > tries) break;
      if (!S.walk.ok(piece.body, piece.reach || [], piece.reachAll)) continue;
    } else if (piece.reach?.length && !S.walk.ok(null, piece.reach, piece.reachAll)) continue;
    commit(S, piece);
    return piece;
  }
  return null;
}

function commit(S, piece) {
  S.placed.push(piece);
  if (piece.mount === 'floor' && piece.h > COLLIDE_H) S.walk.commit(piece.body);
}

/** A floor piece of a product: body box, its clear zones (in its frame: [x0, x1, z0, z1]) and reach zones. */
function floorPiece(role, product, cx, cz, rot, { clear = [], reach = [], reachAll = false, parent = null, under = false, hint = null } = {}) {
  const { w, d, h } = product.dims;
  const body = box(cx, cz, rot, w, d);
  const zone = (r) => part(body, r[0], r[1], r[2], r[3]);
  return {
    role, product, mount: product.mount === 'rug' ? 'rug' : 'floor', w, d, h, rot, body,
    clear: clear.map(zone), reach: reach.map(zone), reachAll, parent, under, hint,
  };
}

/** Slots along the walls: the back WALL_GAP off the face, the front into the room, the width along the wall. */
function wallSlots(S, w, d, { step = STEP, walls = null } = {}) {
  const out = [];
  for (const wall of walls ?? S.walls) {
    if (wall.open || wall.L < w + 2 * WALL_GAP) continue;
    const lo = w / 2 + WALL_GAP, hi = wall.L - w / 2 - WALL_GAP;
    const us = new Set([lo, hi, (lo + hi) / 2]);
    for (let u = lo; u <= hi + EPS; u += step) us.add(Math.min(hi, u));
    for (const u of us) {
      const c = [wall.a[0] + wall.dir[0] * u + wall.n[0] * (d / 2 + WALL_GAP), wall.a[1] + wall.dir[1] * u + wall.n[1] * (d / 2 + WALL_GAP)];
      out.push({ wall, u, c, rot: facing(wall.n), lo, hi });
    }
  }
  return out;
}

/** Free-standing slots on a grid, turned along the room's main axis (both ways). */
function gridSlots(S, step = 0.1) {
  const xs = S.poly.map((p) => p[0]), zs = S.poly.map((p) => p[1]);
  const out = [];
  const r0 = facing(S.axis);
  for (let x = Math.min(...xs) + step / 2; x < Math.max(...xs); x += step) {
    for (let z = Math.min(...zs) + step / 2; z < Math.max(...zs); z += step) {
      if (!inPoly(x, z, S.poly)) continue;
      out.push({ c: [x, z], rot: r0 }, { c: [x, z], rot: r0 + 90 });
    }
  }
  return out;
}

/** Free floor round a point: the distance to the walls and to the furniture placed so far (not the rugs), at most 1.6. */
function clearance(S, p) {
  let best = Math.min(1.6, wallDistance(S, p));
  for (const q of S.placed) if (q.mount === 'floor') best = Math.min(best, boxDist(p, q.body));
  return best;
}

/** Distance from a point to the room's walls (its solid faces). */
function wallDistance(S, p) {
  let best = Infinity;
  for (const w of S.walls) best = Math.min(best, segDist(p, w.a, w.b));
  return best;
}
const doorDistance = (S, p) => S.doors.reduce((m, d) => Math.min(m, Math.hypot(p[0] - d.at[0], p[1] - d.at[1])), Infinity);
const wallHas = (w, type) => w.holes.some((h) => (type === 'walk' ? h.walk : h.type === 'window' || h.type === 'terrace-door'));
/** The unused hint of these kinds nearest to a point (within `r`). */
function hintFor(S, kinds) {
  return S.hints.find((h) => !h.used && kinds.includes(h.kind)) ?? null;
}
const hintScore = (hint, c, k = 3) => (hint ? -k * Math.hypot(c[0] - hint.at[0], c[1] - hint.at[1]) : 0);

/** A wall item (picture, mirror, TV, coat hooks) centred at u on a wall, its middle `y` over the floor. */
function placeOnWall(S, role, product, wall, u, y, { parent = null } = {}) {
  const { w, h } = product.dims;
  if (u - w / 2 < 0.05 || u + w / 2 > wall.L - 0.05) return null;
  const y0 = y - h / 2, y1 = y + h / 2;
  if (y0 < 0.05) return null;
  const p = [wall.a[0] + wall.dir[0] * u, wall.a[1] + wall.dir[1] * u];
  if (S.ceilingAt(p[0] + wall.n[0] * 0.1, p[1] + wall.n[1] * 0.1) < y1 + 0.1) return null;
  for (const hole of wall.holes) if (hole.u0 < u + w / 2 + 0.08 && hole.u1 > u - w / 2 - 0.08 && hole.sill < y1 + 0.08 && hole.top > y0 - 0.08) return null;
  for (const it of S.wallItems) if (it.wall === wall && Math.abs(it.u - u) < (it.w + w) / 2 + 0.1 && it.y1 > y0 - 0.05 && it.y0 < y1 + 0.05) return null;
  // nothing standing in front of it that reaches up over its lower edge (its parent stands under it on purpose)
  const face = box(p[0] + wall.n[0] * 0.15, p[1] + wall.n[1] * 0.15, facing(wall.n), w, 0.3);
  for (const q of S.placed) if (q !== parent && q.mount === 'floor' && q.h > y0 - 0.1 && overlaps(face, q.body, -0.01)) return null;
  const it = { role, product, mount: 'wall', wall, u, w, h, d: product.dims.d, y, y0, y1, at: [p[0] + wall.n[0] * 0.005, p[1] + wall.n[1] * 0.005], n: wall.n, rot: facing(wall.n), parent };
  S.wallItems.push(it);
  return it;
}

// ---------------------------------------------------------------------------------------------------------------
// The rules per use

/** A sofa against a wall (hint or the best wall), coffee table, rug, TV bench and TV across, armchair, lamp … */
function furnishLiving(S, { dining = false } = {}) {
  const hint = hintFor(S, ['sofa']);
  const big = S.area >= 14 && S.D >= 3.0;
  const sofaW = S.area >= 14 ? 2.6 : S.area >= 10 ? 2.25 : 1.7;
  let sofa = null;
  for (const p of choose(S, 'sofa', { maxW: Math.min(sofaW, S.W - 0.4), sort: (a, b) => b.dims.w - a.dims.w, spread: 2 })) {
    const front = 0.42 + 0.6 + 0.9; // coffee table gap + table + the way past it
    const slots = wallSlots(S, p.dims.w, p.dims.d).map((s) => {
      // the wall across: room for the TV bench at 2.4–4.5 m from the sofa's front
      const across = S.walls.find((w) => w !== s.wall && w.n[0] * s.wall.n[0] + w.n[1] * s.wall.n[1] < -0.95);
      const dist = across ? Math.abs((s.c[0] - across.a[0]) * across.n[0] + (s.c[1] - across.a[1]) * across.n[1]) - p.dims.d / 2 : 0;
      const centred = -Math.abs(s.u - s.wall.L / 2) * 0.6;
      const score = s.wall.L * 0.3 + centred + (dist >= 2.3 && dist <= 5 ? 2 : 0) - (wallHas(s.wall, 'walk') ? 1 : 0) - (wallHas(s.wall, 'window') ? 0.4 : 0) + hintScore(hint, s.c) + S.rand() * 0.05;
      return { ...s, score };
    });
    sofa = placeBest(S, slots, (s) => floorPiece('sofa', p, s.c[0], s.c[1], s.rot, { clear: [[-p.dims.w / 2, p.dims.w / 2, p.dims.d / 2, p.dims.d / 2 + Math.min(front, 1.2)]], reach: [[-p.dims.w / 2, p.dims.w / 2, p.dims.d / 2, p.dims.d / 2 + 0.7]], hint }));
    if (sofa) break;
  }
  if (hint && sofa) hint.used = true;
  if (sofa) {
    // the coffee table in front (its clear zone is the sofa's, so it is a companion)
    let table = null;
    for (const p of choose(S, 'coffeeTable', { maxW: sofa.w - 0.3, spread: 2, sort: (a, b) => b.dims.w - a.dims.w })) {
      const z = sofa.d / 2 + 0.42 + p.dims.d / 2;
      const c = at(sofa.body, 0, z);
      table = placeBest(S, [{ c, score: 0 }], (s) => floorPiece('coffeeTable', p, s.c[0], s.c[1], sofa.rot, { parent: sofa }));
      if (table) break;
    }
    // the rug under the coffee table and the sofa's front legs
    const rc = table ? at(sofa.body, 0, sofa.d / 2 + 0.25) : at(sofa.body, 0, sofa.d / 2 + 0.5);
    for (const p of choose(S, 'rug', { spread: 3, sort: (a, b) => b.dims.w * b.dims.d - a.dims.w * a.dims.d })) {
      const long = Math.max(p.dims.w, p.dims.d), short = Math.min(p.dims.w, p.dims.d);
      if (long > sofa.w + 1.2 || long < sofa.w * 0.8) continue;
      // its long side along the sofa: turn it a quarter when the product's long side is its depth
      const rot = p.dims.w >= p.dims.d ? sofa.rot : sofa.rot + 90;
      const c = at(sofa.body, 0, sofa.d / 2 - 0.15 + short / 2);
      if (placeBest(S, [{ c, score: 0 }, { c: rc, score: -1 }], (s) => floorPiece('rug', p, s.c[0], s.c[1], rot, {}))) break;
    }
    // the TV bench on the wall across, centred on the sofa, and the TV over it
    const across = S.walls.filter((w) => w.n[0] * sofa.body.az[0] + w.n[1] * sofa.body.az[1] < -0.95);
    for (const p of choose(S, 'tvBench', { maxW: sofa.w, spread: 3 })) {
      const slots = wallSlots(S, p.dims.w, p.dims.d, { walls: across }).map((s) => {
        const off = (s.c[0] - sofa.body.cx) * sofa.body.ax[0] + (s.c[1] - sofa.body.cz) * sofa.body.ax[1];
        const dist = (s.c[0] - sofa.body.cx) * sofa.body.az[0] + (s.c[1] - sofa.body.cz) * sofa.body.az[1];
        return { ...s, score: -Math.abs(off) * 2 - (dist > 5.5 || dist < 2.2 ? 5 : 0), far: dist > 5.5 || dist < 2.2 };
      }).filter((s) => !s.far);
      const bench = placeBest(S, slots, (s) => floorPiece('tvBench', p, s.c[0], s.c[1], s.rot, { clear: [[-p.dims.w / 2, p.dims.w / 2, p.dims.d / 2, p.dims.d / 2 + 0.6]] }));
      if (bench) {
        const s = slots.find((x) => Math.abs(x.c[0] - bench.body.cx) < 1e-6 && Math.abs(x.c[1] - bench.body.cz) < 1e-6);
        if (s) placeOnWall(S, 'tv', TV, s.wall, s.u, bench.h + 0.12 + TV.dims.h / 2, { parent: bench });
        break;
      }
    }
    // a picture over the sofa
    const sw = wallOf(S, sofa);
    if (sw) for (const p of choose(S, 'art', { maxW: sofa.w * 0.7, spread: 4 })) if (placeOnWall(S, 'art', p, sw.wall, sw.u, Math.max(sofa.h + 0.25 + p.dims.h / 2, 1.45), { parent: sofa })) break;
    // the table of a stue with the kitchen comes before the extras
    if (dining || S.area >= 28) furnishDining(S, { centre: false });
    // an armchair beside the coffee table, facing it (or against a wall near the sofa)
    if (big) {
      for (const p of choose(S, 'armchair', { maxW: 0.9, spread: 4 })) {
        const cands = [];
        const tz = table ? (table.body.cx - sofa.body.cx) * sofa.body.az[0] + (table.body.cz - sofa.body.cz) * sofa.body.az[1] : sofa.d / 2 + 0.7;
        const tw = table ? table.w / 2 : 0.5;
        for (const side of [1, -1]) {
          const c = at(sofa.body, side * (tw + 0.4 + p.dims.d / 2), tz + 0.1);
          cands.push({ c, rot: sofa.rot - side * 90, score: side > 0 ? 1 : 0.9 });
        }
        for (const s of wallSlots(S, p.dims.w, p.dims.d)) cands.push({ ...s, score: -Math.hypot(s.c[0] - sofa.body.cx, s.c[1] - sofa.body.cz) * 0.2 - 1 });
        if (placeBest(S, cands, (s) => floorPiece('armchair', p, s.c[0], s.c[1], s.rot, { clear: [[-p.dims.w / 2, p.dims.w / 2, p.dims.d / 2, p.dims.d / 2 + 0.35]], reach: [[-p.dims.w / 2, p.dims.w / 2, p.dims.d / 2, p.dims.d / 2 + 0.6]] }), { tries: 6 })) break;
      }
    }
    // a floor lamp at one end of the sofa
    for (const p of choose(S, 'floorLamp', { maxW: 0.5, maxD: 0.5, spread: 4 })) {
      const cands = [1, -1].map((side) => ({ c: at(sofa.body, side * (sofa.w / 2 + 0.05 + p.dims.w / 2), -sofa.d / 2 + p.dims.d / 2 + 0.05), score: side > 0 ? 1 : 0.9 }));
      if (placeBest(S, cands, (s) => floorPiece('floorLamp', p, s.c[0], s.c[1], sofa.rot, {}), { tries: 2 })) break;
    }
  }
  else if (dining || S.area >= 28) furnishDining(S, { centre: false });
  // a bookcase or a sideboard on a free wall, then a plant in a free corner
  if (S.area >= 16) {
    const role = S.rand() < 0.5 ? 'bookcase' : 'sideboard';
    storageOnWall(S, role, { front: 0.6 }) || storageOnWall(S, role === 'bookcase' ? 'sideboard' : 'bookcase', { front: 0.6 });
  }
  plantInCorner(S);
}

/** The wall a piece stands against (its back on the face), with the u of its middle. */
function wallOf(S, piece) {
  for (const w of S.walls) {
    const q = [piece.body.cx - w.a[0], piece.body.cz - w.a[1]];
    const u = q[0] * w.dir[0] + q[1] * w.dir[1];
    const dn = q[0] * w.n[0] + q[1] * w.n[1];
    if (u > 0 && u < w.L && Math.abs(dn - piece.d / 2 - WALL_GAP) < 0.03 && piece.body.az[0] * w.n[0] + piece.body.az[1] * w.n[1] > 0.99) return { wall: w, u };
  }
  return null;
}

/** A storage piece (bookcase, sideboard, dresser, shoe cabinet …) on a wall, away from the doors, centred on free runs. */
function storageOnWall(S, role, { front = 0.6, maxW = Infinity, maxD = Infinity, minWall = 0, score = null, hint = null, spread = 3 } = {}) {
  for (const p of choose(S, role, { maxW, maxD, spread, sort: (a, b) => b.dims.w - a.dims.w })) {
    const slots = wallSlots(S, p.dims.w, p.dims.d).filter((s) => s.wall.L >= minWall).map((s) => ({
      ...s,
      score: (score ? score(s, p) : 0) - (wallHas(s.wall, 'walk') ? 0.6 : 0) + Math.min(1.5, doorDistance(S, s.c)) * 0.4 - Math.abs(s.u - s.wall.L / 2) * 0.1 + hintScore(hint, s.c) + S.rand() * 0.05,
    }));
    const piece = placeBest(S, slots, (s) => floorPiece(role, p, s.c[0], s.c[1], s.rot, { clear: [[-p.dims.w / 2, p.dims.w / 2, p.dims.d / 2, p.dims.d / 2 + front]], reach: [[-p.dims.w / 2, p.dims.w / 2, p.dims.d / 2, p.dims.d / 2 + Math.max(front, 0.65)]], hint }), { tries: 6 });
    if (piece) return piece;
  }
  return null;
}

function plantInCorner(S) {
  for (const p of choose(S, 'plant', { maxW: 0.6, spread: 4 })) {
    const slots = wallSlots(S, p.dims.w, p.dims.d).map((s) => ({ ...s, score: (Math.min(s.u - s.lo, s.hi - s.u) < 0.02 ? 2 : -1) + Math.min(2, doorDistance(S, s.c)) * 0.5 + S.rand() * 0.1 }));
    if (placeBest(S, slots, (s) => floorPiece('plant', p, s.c[0], s.c[1], s.rot, {}), { tries: 4 })) return;
  }
}

/** A table with chairs: free-standing (the hint, else the freest spot), or against a wall for two in a small room. */
function furnishDining(S, { centre = true, people = null } = {}) {
  const hint = hintFor(S, ['table', 'dining-table']);
  const tables = choose(S, 'diningTable', { spread: 2, sort: (a, b) => b.dims.w * b.dims.d - a.dims.w * a.dims.d });
  const chairs = choose(S, 'chair', { maxW: 0.62, spread: 4 });
  const chair = chairs[0];
  if (!chair) return null;
  const want = people ?? (S.area >= 20 ? 6 : 4);
  // the table with its chairs: the first table and spot (freest first) where all its chairs stand, else the most chairs
  let best = null;
  for (const t of tables) {
    const round = Math.abs(t.dims.w - t.dims.d) < 0.05;
    const seats = round ? 4 : Math.min(want, 2 * Math.max(1, Math.floor((t.dims.w + 0.05) / 0.6)));
    if (!round && t.dims.w > (want >= 6 ? 2.3 : 1.85)) continue;
    const slots = gridSlots(S, 0.1).map((s) => ({ ...s, score: clearance(S, s.c) * (centre ? 1.5 : 1) + hintScore(hint, s.c, 4) + S.rand() * 0.02 }));
    slots.sort((x, y) => y.score - x.score);
    const make = (s) => floorPiece('diningTable', t, s.c[0], s.c[1], s.rot, { clear: [[-t.dims.w / 2 - 0.65, t.dims.w / 2 + 0.65, -t.dims.d / 2 - 0.7, t.dims.d / 2 + 0.7]], hint });
    let walks = 0;
    for (const s of slots) {
      const table = make(s);
      if (!allowed(S, table)) continue;
      if (++walks > 16) break;
      if (!S.walk.ok(table.body)) continue;
      commit(S, table);
      const n = placeChairs(S, table, chair, seats);
      if (n >= seats) {
        if (hint) hint.used = true;
        return table;
      }
      if (n >= 2 && (!best || n > best.n)) best = { s, n, make, seats };
      unplace(S, table);
    }
  }
  if (best) {
    const table = best.make(best.s);
    commit(S, table);
    placeChairs(S, table, chair, best.seats);
    if (hint) hint.used = true;
    return table;
  }
  // a small room: a table for two against a wall
  const small = tables.filter((t) => t.dims.d <= 0.9).sort((a, b) => a.dims.w - b.dims.w)[0];
  if (small) {
    const slots = wallSlots(S, small.dims.w, small.dims.d).map((s) => ({ ...s, score: hintScore(hint, s.c, 4) + Math.min(1.5, doorDistance(S, s.c)) + S.rand() * 0.02 }));
    const table = placeBest(S, slots, (s) => floorPiece('diningTable', small, s.c[0], s.c[1], s.rot, { clear: [[-small.dims.w / 2, small.dims.w / 2, small.dims.d / 2, small.dims.d / 2 + 0.7]], hint }));
    if (table) {
      if (placeChairs(S, table, chair, 2, { oneSide: true }) >= 1) {
        if (hint) hint.used = true;
        return table;
      }
      unplace(S, table);
    }
  }
  return null;
}

/** Chairs round a table (pulled 12 cm in under the top, facing it); returns how many stand. */
function placeChairs(S, table, chair, seats, { oneSide = false } = {}) {
  const t = table.product.dims;
  const cd = chair.dims.d, cw = chair.dims.w;
  const spots = [];
  const round = Math.abs(t.w - t.d) < 0.05;
  if (round) {
    for (let k = 0; k < seats; k++) {
      const a = (k / seats) * Math.PI * 2;
      const r = t.w / 2 + cd / 2 - 0.12;
      spots.push({ lx: Math.sin(a) * r, lz: Math.cos(a) * r, face: 180 + (a / DEG) });
    }
  } else {
    const per = oneSide ? seats : Math.ceil(seats / 2);
    const sides = oneSide ? [1] : [1, -1];
    for (const side of sides) {
      const n = side === 1 ? per : seats - per;
      for (let k = 0; k < n; k++) {
        const lx = n === 1 ? 0 : -t.w / 2 + 0.3 + ((t.w - 0.6) * k) / (n - 1);
        spots.push({ lx, lz: side * (t.d / 2 + cd / 2 - 0.12), face: side > 0 ? 180 : 0 });
      }
    }
  }
  let n = 0;
  for (const s of spots) {
    const c = at(table.body, s.lx, s.lz);
    const piece = placeBest(S, [{ c, score: 0 }], () => {
      const p = floorPiece('chair', chair, c[0], c[1], table.rot + s.face, { parent: table, under: true });
      return p.w <= cw + EPS ? p : null;
    }, { tries: 1 });
    if (piece) n++;
  }
  return n;
}

function unplace(S, piece) {
  const gone = new Set([piece, ...S.placed.filter((p) => p.parent === piece)]);
  S.placed = S.placed.filter((p) => !gone.has(p));
  S.wallItems = S.wallItems.filter((w) => !gone.has(w.parent));
  // rebuild the walk's blocked cells
  S.walk.reset();
  for (const p of S.placed) if (p.mount === 'floor' && p.h > COLLIDE_H) S.walk.commit(p.body);
}

/** Bed sized after the room, nightstands, wardrobe, dresser, rug, picture. */
function furnishBedroom(S) {
  const hint = hintFor(S, ['bed']);
  // the bed's width after the room: 180 in a large room, then 160, 140, 120 (a single against a wall in a small one)
  const sizes = S.D >= 3.0 && S.area >= 11 ? [1.8, 1.6, 1.4, 1.2] : S.D >= 2.7 && S.area >= 9 ? [1.6, 1.4, 1.2] : S.D >= 2.4 && S.area >= 7 ? [1.4, 1.2] : [1.2];
  let bed = null;
  for (const size of sizes) {
    const beds = choose(S, 'bed', { test: (p) => Math.abs((p.params?.mattressW ?? p.dims.w) - size) < 0.05 && p.dims.h <= 1.25, spread: 3 });
    const double = size >= 1.4;
    for (const p of beds.slice(0, 3)) {
      const { w, d } = p.dims;
      const side = double ? 0.6 : 0.55;
      const slots = wallSlots(S, w, d).map((s) => ({
        ...s,
        score: -Math.abs(s.u - s.wall.L / 2) * (double ? 1 : 0.2) - (wallHas(s.wall, 'walk') ? 2 : 0) - (wallHas(s.wall, 'window') ? 0.8 : 0) + Math.min(3, doorDistance(S, s.c)) * 0.4 + hintScore(hint, s.c, 4) + S.rand() * 0.05,
      }));
      // a single bed may stand with one side against the wall: then only the free side needs room
      const zones = double
        ? { clear: [[-w / 2 - side, -w / 2, -d / 2, d / 2], [w / 2, w / 2 + side, -d / 2, d / 2], [-w / 2, w / 2, d / 2, d / 2 + 0.5]], reach: [[-w / 2 - side - 0.1, -w / 2, -d / 2 + 0.5, d / 2], [w / 2, w / 2 + side + 0.1, -d / 2 + 0.5, d / 2]], reachAll: true }
        : { clear: [[-w / 2, w / 2, d / 2, d / 2 + 0.4]], reach: [[-w / 2 - side - 0.1, -w / 2, -d / 2 + 0.4, d / 2], [w / 2, w / 2 + side + 0.1, -d / 2 + 0.4, d / 2], [-w / 2, w / 2, d / 2, d / 2 + 0.7]] };
      bed = placeBest(S, slots, (s) => floorPiece('bed', p, s.c[0], s.c[1], s.rot, { ...zones, hint }), { tries: 14 });
      if (bed) break;
    }
    if (bed) break;
  }
  if (!bed) {
    S.notes.push('Fant ingen plass til en seng');
    return;
  }
  if (hint) hint.used = true;
  const double = (bed.product.params?.mattressW ?? bed.w) >= 1.4;
  // nightstands at the head, on both sides of a double bed (as far as they fit)
  for (const p of choose(S, 'nightstand', { maxW: 0.5, maxD: 0.5, spread: 3 }).slice(0, 1)) {
    for (const side of double ? [1, -1] : [1, -1]) {
      const c = at(bed.body, side * (bed.w / 2 + 0.03 + p.dims.w / 2), -bed.d / 2 + p.dims.d / 2);
      const n = placeBest(S, [{ c, score: 0 }], () => floorPiece('nightstand', p, c[0], c[1], bed.rot, { parent: bed }), { tries: 1 });
      if (n && !double) break;
    }
  }
  const bw = wallOf(S, bed);
  if (bw) for (const p of choose(S, 'art', { maxW: Math.min(1.2, bed.w * 0.8), spread: 4 })) if (placeOnWall(S, 'art', p, bw.wall, bw.u, Math.max((bed.product.dims.h ?? 0.7) + 0.3 + p.dims.h / 2, 1.35), { parent: bed })) break;
  // the wardrobe: as wide as the room allows, in a corner, where the ceiling is high enough
  const wardHint = hintFor(S, ['wardrobe']);
  const ward = storageOnWall(S, 'wardrobe', { front: 0.75, maxW: S.area >= 12 ? 1.8 : 1.2, hint: wardHint, score: (s) => (Math.min(s.u - s.lo, s.hi - s.u) < 0.02 ? 1 : 0) });
  if (ward && wardHint) wardHint.used = true;
  if (S.area >= 11) storageOnWall(S, 'dresser', { front: 0.6, maxW: 1.6 });
  // the rug across the lower part of the bed
  if (S.area >= 9) {
    for (const p of choose(S, 'rug', { maxW: 2.0, maxD: 2.9, spread: 3, sort: (a, b) => a.dims.w * a.dims.d - b.dims.w * b.dims.d })) {
      const long = Math.max(p.dims.w, p.dims.d);
      if (long < bed.w + 0.5 || long > bed.w + 1.4) continue;
      const rot = p.dims.w >= p.dims.d ? bed.rot : bed.rot + 90;
      const short = Math.min(p.dims.w, p.dims.d);
      const c = at(bed.body, 0, bed.d / 2 - short / 2 + 0.35);
      if (placeBest(S, [{ c, score: 0 }], (s) => floorPiece('rug', p, s.c[0], s.c[1], rot, {}))) break;
    }
  }
  const room = S.area >= 13;
  if (room) plantInCorner(S);
}

/** A desk at a wall near the light, a chair, a bookcase, a lamp (the catalogue's desk, else a narrow table). */
function furnishOffice(S) {
  const hint = hintFor(S, ['desk', 'table']);
  const desks = choose(S, 'desk', { spread: 2 });
  if (!desks.length) desks.push(...choose(S, 'diningTable', { maxD: 0.8, maxW: 1.6, test: (p) => p.params?.shape === 'rect' || !p.params?.shape, spread: 1 }));
  const chair = choose(S, 'deskChair', { spread: 2 })[0] ?? choose(S, 'chair', { maxW: 0.6, spread: 3 })[0];
  const windows = S.walls.flatMap((w) => w.holes.filter((h) => h.type === 'window').map((h) => [w.a[0] + w.dir[0] * (h.u0 + h.u1) / 2, w.a[1] + w.dir[1] * (h.u0 + h.u1) / 2]));
  let desk = null;
  for (const p of desks) {
    const slots = wallSlots(S, p.dims.w, p.dims.d).map((s) => ({
      ...s,
      score: (windows.length ? -Math.min(...windows.map((q) => Math.hypot(q[0] - s.c[0], q[1] - s.c[1]))) * 0.6 : 0) - (wallHas(s.wall, 'walk') ? 0.8 : 0) + hintScore(hint, s.c, 4) + S.rand() * 0.05,
    }));
    desk = placeBest(S, slots, (s) => floorPiece('desk', p, s.c[0], s.c[1], s.rot, { clear: [[-p.dims.w / 2, p.dims.w / 2, p.dims.d / 2, p.dims.d / 2 + 0.85]], reach: [[-p.dims.w / 2, p.dims.w / 2, p.dims.d / 2, p.dims.d / 2 + 0.9]], hint }));
    if (desk) break;
  }
  if (desk) {
    if (hint) hint.used = true;
    if (chair) {
      const c = at(desk.body, 0, desk.d / 2 + chair.dims.d / 2 - 0.15);
      placeBest(S, [{ c, score: 0 }], () => floorPiece('chair', chair, c[0], c[1], desk.rot + 180, { parent: desk, under: true }), { tries: 1 });
    }
    for (const p of choose(S, 'floorLamp', { maxW: 0.45, maxD: 0.45, spread: 4 })) {
      const cands = [1, -1].map((side) => ({ c: at(desk.body, side * (desk.w / 2 + 0.05 + p.dims.w / 2), -desk.d / 2 + p.dims.d / 2), score: side }));
      if (placeBest(S, cands, (s) => floorPiece('floorLamp', p, s.c[0], s.c[1], desk.rot, {}), { tries: 2 })) break;
    }
  }
  storageOnWall(S, 'bookcase', { front: 0.6 });
  if (S.area >= 10) storageOnWall(S, 'bookcase', { front: 0.6 });
  if (S.area >= 11) {
    for (const p of choose(S, 'armchair', { maxW: 0.85, spread: 4 })) if (placeBest(S, wallSlots(S, p.dims.w, p.dims.d).map((s) => ({ ...s, score: S.rand() })), (s) => floorPiece('armchair', p, s.c[0], s.c[1], s.rot, { reach: [[-p.dims.w / 2, p.dims.w / 2, p.dims.d / 2, p.dims.d / 2 + 0.6]] }), { tries: 4 })) break;
  }
  plantInCorner(S);
}

/** Shoe storage, a bench, hooks and a mirror, a runner – only where the way through stays wide. */
function furnishHall(S, { entrance = false } = {}) {
  // the main way: a hall narrower than 1.25 m gets nothing on the floor but the runner
  const outer = S.walls.find((w) => w.holes.some((h) => h.walk && h.type === 'door' && h.outer));
  const deep = S.D >= 1.6 ? 0.36 : S.D >= 1.25 ? 0.26 : 0;
  let low = null;
  if (deep) {
    const role = deep >= 0.36 && S.rand() < 0.5 ? 'bench' : 'shoeCabinet';
    low = storageOnWall(S, role, { front: 0.5, maxD: deep, maxW: 1.2 }) || storageOnWall(S, role === 'bench' ? 'shoeCabinet' : 'bench', { front: 0.5, maxD: deep, maxW: 1.2 });
  }
  // coat hooks: over the bench / shoe cabinet, else on a free wall near the entrance door
  for (const p of choose(S, 'coatRack', { spread: 3 })) {
    const lw = low && wallOf(S, low);
    if (lw && placeOnWall(S, 'coatRack', p, lw.wall, lw.u, Math.max(low.h + 0.45, 1.6), { parent: low })) break;
    const cands = S.walls.filter((w) => !w.open).flatMap((w) => [0.25, 0.5, 0.75].map((k) => ({ w, u: w.L * k, s: -Math.min(3, doorDistance(S, [w.a[0] + w.dir[0] * w.L * k, w.a[1] + w.dir[1] * w.L * k])) * (entrance ? 0.5 : -0.1) + (outer === w ? 1 : 0) })));
    cands.sort((a, b) => b.s - a.s);
    if (cands.some((c) => placeOnWall(S, 'coatRack', p, c.w, c.u, 1.6))) break;
  }
  // a mirror on another free stretch of wall
  for (const p of choose(S, 'mirror', { maxW: 0.9, spread: 4 })) {
    const cands = S.walls.filter((w) => !w.open).flatMap((w) => [0.3, 0.5, 0.7].map((k) => ({ w, u: w.L * k, s: S.rand() })));
    cands.sort((a, b) => b.s - a.s);
    if (cands.some((c) => placeOnWall(S, 'mirror', p, c.w, c.u, 1.45))) break;
  }
  if (entrance && S.D >= 1.7 && S.area >= 4) {
    for (const p of choose(S, 'coatStand', { maxW: 0.45, spread: 2 })) {
      const slots = wallSlots(S, p.dims.w, p.dims.d).map((s) => ({ ...s, score: Math.min(s.u - s.lo, s.hi - s.u) < 0.02 ? 1 : 0 }));
      if (placeBest(S, slots, (s) => floorPiece('coatStand', p, s.c[0], s.c[1], s.rot, {}), { tries: 4 })) break;
    }
  }
  // the runner along the hall
  if (S.D >= 1.0 && S.W >= 2.4) {
    for (const p of choose(S, 'runner', { spread: 2, sort: (a, b) => b.dims.d - a.dims.d })) {
      const long = Math.max(p.dims.w, p.dims.d);
      if (long > S.W - 0.6) continue;
      const rot = facing(S.axis) + (p.dims.d >= p.dims.w ? 0 : 90);
      const slots = gridSlots(S, 0.1).map((s) => ({ ...s, score: Math.min(1, wallDistance(S, s.c)) * 2 - Math.hypot(s.c[0] - S.centre[0], s.c[1] - S.centre[1]) * 0.2 }));
      if (placeBest(S, slots, (s) => floorPiece('runner', p, s.c[0], s.c[1], rot, {}), { tries: 1 })) break;
    }
  }
}

/** Only loose things: a bath mat, a laundry basket in a corner, a towel ladder (the fixtures are another task). */
function furnishBathroom(S, { laundry = false, wc = false } = {}) {
  if (!laundry) {
    for (const p of choose(S, 'bathMat', { spread: 3 })) {
      const slots = gridSlots(S, 0.1).map((s) => ({ ...s, score: -Math.hypot(s.c[0] - S.centre[0], s.c[1] - S.centre[1]) + S.rand() * 0.05 }));
      if (placeBest(S, slots, (s) => floorPiece('bathMat', p, s.c[0], s.c[1], s.rot, {}), { tries: 1 })) break;
    }
  }
  if (!wc || S.area >= 2.5) {
    for (const p of choose(S, 'laundryBasket', { spread: 2 })) {
      const slots = wallSlots(S, p.dims.w, p.dims.d).map((s) => ({ ...s, score: (Math.min(s.u - s.lo, s.hi - s.u) < 0.02 ? 1 : 0) + Math.min(2, doorDistance(S, s.c)) * 0.3 }));
      if (placeBest(S, slots, (s) => floorPiece('laundryBasket', p, s.c[0], s.c[1], s.rot, { clear: [[-p.dims.w / 2, p.dims.w / 2, p.dims.d / 2, p.dims.d / 2 + 0.3]] }), { tries: 4 })) break;
    }
  }
  if (!laundry && !wc && S.area >= 4) {
    for (const p of choose(S, 'towelLadder', { spread: 1 })) {
      const slots = wallSlots(S, p.dims.w, p.dims.d).map((s) => ({ ...s, score: Math.min(2, doorDistance(S, s.c)) * 0.2 + S.rand() * 0.05 }));
      if (placeBest(S, slots, (s) => floorPiece('towelLadder', p, s.c[0], s.c[1], s.rot, {}), { tries: 4 })) break;
    }
  }
}

function furnishStorage(S, { wardrobe = false } = {}) {
  if (S.D < 1.1 || S.area < 1.5) return;
  const role = wardrobe ? 'wardrobe' : 'bookcase';
  storageOnWall(S, role, { front: wardrobe ? 0.7 : 0.55, maxD: S.D - 0.85 });
  if (S.W >= 2.4) storageOnWall(S, role, { front: wardrobe ? 0.7 : 0.55, maxD: S.D - 0.85 });
}

/** A kitchen with no fixtures on the plan: the longest free wall is kept for the worktop (and its working floor). */
function reserveKitchen(S) {
  if (S.reserved.some((r) => ['kitchen', 'stove', 'fridge'].includes(r.kind))) return;
  const runs = [];
  for (const w of S.walls) {
    if (w.open) continue;
    const cuts = w.holes.filter((h) => h.walk || (h.sill ?? 1) < FLOOR_SILL).map((h) => [h.u0 - 0.1, h.u1 + 0.1]).sort((a, b) => a[0] - b[0]);
    let u = 0;
    for (const [a, b] of [...cuts, [w.L, w.L]]) {
      if (a - u >= 1.8) runs.push({ w, u0: u, u1: a });
      u = Math.max(u, b);
    }
  }
  const run = runs.sort((a, b) => b.u1 - b.u0 - (a.u1 - a.u0))[0];
  if (!run) return;
  const len = Math.min(run.u1 - run.u0, 3.6), mid = (run.u0 + run.u1) / 2, depth = 0.62 + 1.0;
  const { w } = run;
  const zone = box(w.a[0] + w.dir[0] * mid + w.n[0] * depth / 2, w.a[1] + w.dir[1] * mid + w.n[1] * depth / 2, facing(w.n), len, depth);
  S.hard.push({ ...zone, what: 'kitchen', solid: false });
  S.reserved.push({ kind: 'kitchen', box: zone, wallId: w.id, guessed: true });
}

const RULES = {
  living: (S) => {
    // «Stue/kjøkken»: the kitchen's wall is kept (unless the plan drew it) and the table comes too
    const kitchen = /kj(ø|o)kken/i.test(S.room.name ?? '');
    if (kitchen) reserveKitchen(S);
    furnishLiving(S, { dining: (kitchen || S.reserved.some((r) => r.kind === 'kitchen')) && S.area >= 20 });
  },
  kitchen: (S) => {
    reserveKitchen(S);
    furnishDining(S, { centre: true, people: S.area >= 14 ? 6 : 4 });
  },
  dining: (S) => {
    furnishDining(S, { centre: true });
    storageOnWall(S, 'sideboard', { front: 0.6 });
    plantInCorner(S);
  },
  bedroom: furnishBedroom,
  office: furnishOffice,
  hall: (S) => furnishHall(S, { entrance: S.doors.some((d) => d.outer) }),
  entrance: (S) => furnishHall(S, { entrance: true }),
  bathroom: (S) => furnishBathroom(S),
  wc: (S) => furnishBathroom(S, { wc: true }),
  laundry: (S) => furnishBathroom(S, { laundry: true }),
  storage: (S) => furnishStorage(S),
  wardrobe: (S) => furnishStorage(S, { wardrobe: true }),
};

/** Hints whose piece the room's own rules did not place: the piece where the plan drew it. */
function furnishHints(S) {
  for (const h of S.hints) {
    if (h.used) continue;
    const roles = { bed: null, sofa: null, table: 'diningTable', 'dining-table': 'diningTable', 'coffee-table': 'coffeeTable', desk: 'desk', wardrobe: 'wardrobe', dresser: 'dresser', bookcase: 'bookcase', armchair: 'armchair', tv: 'tvBench' };
    if (h.kind === 'bed') furnishBedroom(S);
    else if (h.kind === 'sofa') furnishLiving(S, {});
    else if (h.kind === 'table' || h.kind === 'dining-table') furnishDining(S, { centre: false });
    else if (h.kind === 'desk') furnishOffice(S);
    else if (roles[h.kind]) storageOnWall(S, roles[h.kind], { front: 0.6, hint: h });
    h.used = true;
  }
}

/**
 * Furniture for one room (see the top of the file for `room`).
 * @param {object} room
 * @param {object[]} products  the catalogue's products (catalog/index.js allProducts())
 * @param {{ seed?: number|string, auto?: boolean }} [opts]
 * @returns {{ use: string, items: object[], reserved: object[], notes: string[], walk: { doors: number, reached: number } }}
 *   items: { role, product (null for the TV), archetype, mount, name, category, dims, at: [x, z], y, rotationDeg,
 *            wallId?, normal? (wall items: [nx, nz] into the room), hint? }
 */
export function furnishRoom(room, products, opts = {}) {
  const S = prepare(room, products || [], opts);
  const use = FURNISH_USES.includes(room.use) ? room.use : roomUse(room, null);
  if (opts.auto === false) furnishHints(S);
  else {
    RULES[use]?.(S);
    furnishHints(S);
  }
  // furniture standing on a rug stands ON it (existing.js liftOntoRugs, Placement)
  const rugs = S.placed.filter((p) => p.mount === 'rug');
  const items = [];
  for (const p of S.placed) {
    let y = 0;
    if (p.mount !== 'rug') for (const r of rugs) if (boxDist([p.body.cx, p.body.cz], r.body) === 0) y = Math.max(y, r.h);
    items.push(itemOf(p, [p.body.cx, p.body.cz], y));
  }
  for (const w of S.wallItems) items.push({ ...itemOf(w, w.at, w.y), wallId: w.wall.id, normal: [w.n[0], w.n[1]] });
  return { use, items, reserved: S.reserved, notes: S.notes, walk: { doors: S.walk.targets.length, reached: r4(S.walk.reached()), ascii: () => S.walk.ascii() } };
}

function itemOf(p, xz, y) {
  const pr = p.product;
  return {
    role: p.role,
    product: pr.id ?? null,
    archetype: pr.archetype,
    mount: p.mount === 'wall' ? 'wall' : pr.mount === 'rug' ? 'rug' : 'floor',
    name: pr.name,
    category: pr.category,
    dims: { w: pr.dims.w, d: pr.dims.d, h: pr.dims.h },
    at: [r4(xz[0]), r4(xz[1])],
    y: r4(y),
    rotationDeg: r4(((p.rot % 360) + 540) % 360 - 180),
    ...(p.hint ? { hint: p.hint.kind } : {}),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// From the layout

/**
 * The sweep of a hinged door leaf as a box on the side it opens to (Placement.js swingBox, on the layout's door).
 * @returns {object|null}
 */
export function swingOf(d, t) {
  const door = d.door;
  if (!door || d.type !== 'door' || door.variant === 'sliding') return null;
  const b = [d.bottomCenter.x, d.bottomCenter.z], n = [d.normal.x, d.normal.z], r = [d.right.x, d.right.z];
  const rot = facing(n);
  const side = (door.swing ?? d.swing) === 'out' ? -1 : 1;
  if (door.variant === 'folding') {
    const dc = (side > 0 ? 0 : t) + 0.15;
    return box(b[0] + n[0] * side * dc, b[1] + n[1] * side * dc, rot, d.width, 0.3);
  }
  const double = door.variant === 'double';
  const leaf = double ? Math.max(door.leaf?.w ?? d.width / 2, door.leaf2?.w ?? door.leaf?.w ?? d.width / 2) : door.leaf?.w ?? d.leaf?.w ?? d.width;
  const angle = d.openAngleDeg ?? 90;
  const hinge = door.hinge ?? d.hinge;
  const z0 = side > 0 ? 0 : t;
  const hu = hinge === 'to' ? d.width / 2 : -d.width / 2;
  const towards = hinge === 'to' ? -1 : 1;
  const u0 = double ? -d.width / 2 - (angle > 95 ? leaf : 0) : angle > 95 ? hu - leaf : Math.min(hu, hu + towards * leaf);
  const u1 = double ? d.width / 2 + (angle > 95 ? leaf : 0) : angle > 95 ? hu + leaf : Math.max(hu, hu + towards * leaf);
  const uc = (u0 + u1) / 2, dc = z0 + leaf / 2;
  // the box's width runs along r: rotationDeg of n gives ax = (n.z, −n.x) = r for a wall whose n is r turned left
  const bx = box(b[0] + r[0] * uc + n[0] * side * dc, b[1] + r[1] * uc + n[1] * side * dc, rot, u1 - u0, leaf);
  return grow(bx, 0.05);
}

/**
 * A room of layout.house as furnishRoom reads it: its faces with their holes, the sweeps of the doors that open into
 * it, its ceiling, the stairs / stairwells / built-ins on its level as keep-outs, and the hints in it.
 * @param {object} layout  home/layout.js
 * @param {string} roomId
 * @param {{ settings?: object, hints?: object[] }} [o]
 */
export function roomInput(layout, roomId, { settings = null, hints = [] } = {}) {
  const H = layout.house;
  const r = H.room(roomId);
  if (!r) return null;
  const xz = (p) => [p.x, p.y];
  const walls = H.walls.filter((w) => w.roomId === r.id).map((w) => ({
    id: w.id,
    a: xz(w.start),
    b: xz(w.end),
    n: [w.normal.x, w.normal.y],
    holes: (w.holes || []).map((h) => {
      const o = H.opening(h.openingId);
      const outer = !!o && (o.connects || []).some((c) => c === 'ute') || (!!o && (o.connects || []).length < 2 && !!H.wall(o.wallId)?.exterior);
      return { id: h.openingId, u0: h.u0, u1: h.u1, sill: h.sill, top: h.top, type: h.type, door: h.door, outer };
    }),
  }));
  const swings = [];
  for (const d of H.doors) {
    if (d.levelId !== r.levelId) continue;
    const s = swingOf(d, H.wall(d.wallId)?.thickness ?? 0.1);
    if (s && inPoly(s.cx, s.cz, r.polygon.map(xz))) swings.push(s);
  }
  const keepOut = [];
  const polyBox = (poly, what, solid = false) => {
    const xs = poly.map((p) => p.x ?? p[0]), zs = poly.map((p) => p.y ?? p.z ?? p[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs);
    return { ...box((x0 + x1) / 2, (z0 + z1) / 2, 0, x1 - x0, z1 - z0), what, solid };
  };
  // the floor where a stair ends, beyond its end along the walk line (layout.js walkLine runs top → foot): the foot on
  // the lower level, the arrival at the top on the upper one – free for the player 0,6 m out and its radius (a sofa
  // against the wall the stair arrives along closed hus3's stair at its top)
  const endBox = (wl, top) => {
    const P = (p) => [p.x ?? p[0], p.z ?? p.y ?? p[1]];
    const e = P(top ? wl[0] : wl[wl.length - 1]);
    const q = P(top ? wl[1] : wl[wl.length - 2]);
    const L = Math.hypot(e[0] - q[0], e[1] - q[1]) || 1;
    const out = [(e[0] - q[0]) / L, (e[1] - q[1]) / L];
    return { ...box(e[0] + out[0] * 0.5, e[1] + out[1] * 0.5, 0, 1.6, 1.6), what: 'stair' };
  };
  for (const st of H.stairs || []) {
    const up = (H.level(st.fromLevel)?.floorY ?? 0) <= (H.level(st.toLevel)?.floorY ?? 0);
    const lower = up ? st.fromLevel : st.toLevel;
    const upper = up ? st.toLevel : st.fromLevel;
    const wl = st.walkLine;
    if (lower === r.levelId && st.footprint?.length) {
      keepOut.push(grow(polyBox(st.footprint, 'stair'), 0.1));
      if (wl?.length >= 2) keepOut.push(endBox(wl, false));
    }
    if (upper === r.levelId && wl?.length >= 2) keepOut.push(endBox(wl, true));
  }
  for (const fo of H.floorOpenings || []) if (fo.levelId === r.levelId && fo.polygon?.length) keepOut.push(grow(polyBox(fo.polygon, 'stairwell', true), 0.15));
  for (const b of H.builtIns || []) {
    if (b.levelId !== r.levelId || !b.dims || !b.position) continue;
    const p = b.position.isVector3 ? [b.position.x, b.position.z] : [b.position[0], b.position[2]];
    const yaw = (b.rotationDeg ?? 0) * DEG;
    const c = b.mount === 'wall' ? [p[0] + Math.sin(yaw) * b.dims.d / 2, p[1] + Math.cos(yaw) * b.dims.d / 2] : p;
    keepOut.push({ ...box(c[0], c[1], b.rotationDeg ?? 0, b.dims.w, b.dims.d), what: 'built-in', solid: b.collide !== false && b.mount !== 'wall' });
  }
  const floor = r.floorY;
  const ceilingAt = (x, z) => {
    const y = H.ceilingHeightAt(x, z, floor + 1);
    return Number.isFinite(y) ? y - floor : 2.4;
  };
  return {
    id: r.id, levelId: r.levelId, name: r.name, kind: r.kind, use: roomUse(r, settings), seed: r.id,
    polygon: r.polygon.map(xz), walls, swings, ceilingAt, keepOut, hints,
  };
}

const CACHE = new WeakMap();

/**
 * The furniture of every room of a house with `furnishing` (layout.house.furnishing), as DesignState item specs
 * (catalog productToItemSpec + where: `position` [x, y over the ROOM's floor, z], rotationDeg, roomId, level, uid
 * 'mb-<room>-<n>', attach for wall items). Rooms with `off`, hud rooms and the owner's living room get none. Cached per
 * layout.
 * @param {object} layout
 * @param {{ products: object[], toSpec: (product, variantIndex?) => object }} catalog
 * @returns {{ items: object[], rooms: Object<string, { use, items, reserved, notes, walk }> }}
 */
export function furnishHouse(layout, catalog) {
  const F = layout?.house?.furnishing;
  if (!F) return { items: [], rooms: {} };
  const cached = CACHE.get(layout) ?? CACHE.set(layout, new Map()).get(layout);
  if (cached.has(catalog)) return cached.get(catalog);
  const H = layout.house;
  const out = { items: [], rooms: {} };
  const hintsByRoom = new Map();
  for (const h of F.hints || []) {
    const room = h.roomId ? H.room(h.roomId) : H.rooms.find((r) => !r.hud && (!h.levelId || r.levelId === h.levelId) && r.contains(h.at[0], h.at[1]));
    if (!room) continue;
    (hintsByRoom.get(room.id) ?? hintsByRoom.set(room.id, []).get(room.id)).push(h);
  }
  for (const r of H.rooms) {
    if (r.hud || r.id === 'stue-kjokken' || F.rooms?.[r.id]?.off) continue;
    const input = roomInput(layout, r.id, { settings: F, hints: hintsByRoom.get(r.id) ?? [] });
    if (!input) continue;
    const res = furnishRoom(input, catalog.products, { seed: F.seed, auto: F.auto });
    out.rooms[r.id] = res;
    res.items.forEach((it, i) => {
      const product = it.product ? catalog.products.find((p) => p.id === it.product) : null;
      const base = product ? catalog.toSpec(product) : { source: 'custom', refId: null, name: it.name, category: it.category, archetype: it.archetype, mount: it.mount, dims: { ...it.dims }, params: {}, colors: {}, materials: {}, variantIndex: 0, acoustic: { m2: 0, ref: { ...it.dims } } };
      const spec = {
        ...base,
        uid: `mb-${r.id}-${i + 1}`,
        mount: it.mount,
        position: [it.at[0], it.y, it.at[1]],
        rotationDeg: it.rotationDeg,
        roomId: r.id,
        level: r.levelId,
        notes: `Møblert av spillet (${it.role}${it.hint ? `, tegnet på planen som «${it.hint}»` : ''}).`,
      };
      if (it.mount === 'wall') spec.attach = { wallId: it.wallId, normal: [it.normal[0], 0, it.normal[1]] };
      out.items.push(spec);
    });
  }
  cached.set(catalog, out);
  return out;
}
