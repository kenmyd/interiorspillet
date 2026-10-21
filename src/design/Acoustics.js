import { layout as defaultLayout } from '../home/layout.js';
import { originalItems, RUG_ALPHA, parsePile } from '../home/existing.js';
import { getProduct } from '../catalog/index.js';
import schema from '../data/archetypes.json';
import wallData from '../data/wall-proposals.json';

/**
 * Reverberation time (Sabine) for the open living room – ARCHITECTURE §7.
 *
 *   RT60 = 0.161 · V / A        V = air volume from home/layout.js (the ceiling integrated over the floor, ≈ 138.6 m³)
 *   A    = A_room + Σ items + high wall + window shading          (Sabine m² at 500–1000 Hz)
 *
 * A_room (walls, ceiling, floor, glass, air, built-ins) is calibrated so that the ORIGINAL design (today's furniture
 * from existing.js, no wall proposal, no shading) gives the measured/estimated 0.86 s. Everything the user adds,
 * removes or changes is counted relative to that:
 * - items: `item.acoustic = { m2, ref }` (from the catalogue product or the existing.js estimate) scaled by the
 *   item's size relative to `ref` (rugs by footprint, wall/ceiling panels by face area, furniture by surface);
 *   without it: catalogue lookup, then a per-archetype estimate. Hidden items count 0.
 * - the high wall: the proposal's `sabineAdded`; when the user has edited the elements: Σ area × alpha.
 * - shading: fabric alpha (product absorption ÷ product area) × covered area × how closed it is (stacked curtains
 *   still absorb ~40 %).
 * Labels in the result are Norwegian.
 *
 * Per room (hele-huset §5.4, steg 16 E3): computeAcoustics(design, home, { roomId = 'stue-kjokken' }).
 *   - V = the room's volume (layout.house.rooms[].volume; the living room's is layout.volume, 138.57 m³).
 *   - Items count in ONE room (itemRoomId): a wall item in the room of its wall (attach.wallId, backOf faces have
 *     their own room), anything else in the physical room of its level that contains (x, z); outside every room
 *     (window sills, recesses) the nearest room of the level within NEAR_ROOM m; further out (the terrace, the
 *     garden) it counts nowhere.
 *   - The living room (`acoustic.mode 'calibrated'`) keeps the 0.86 s calibration with its own originals
 *     (originalItems(layout), exactly as before); the high wall belongs to it alone; shading counts per room, for
 *     the room's own windows.
 *   - Every other room is an ESTIMATE ('estimate'): A_room = Σ surface × α (SURFACE_ALPHA: plaster/gypsum 0.05,
 *     wooden floor 0.07, tile/vinyl 0.03, glass 0.04, closed doors 0.08, open openings and the stairwell 0.5) + air;
 *     its «i dag» is the room with its own original furniture.
 */

export const BASELINE_RT60 = 0.86;
export const TARGET_RT60 = Object.freeze([0.4, 0.6]);
const SABINE_K = 0.161;
/** The living room / kitchen / TV-stue (layout.js LIVING_ROOM_ID): one acoustic room, calibrated (D12). */
export const LIVING_ROOM_ID = 'stue-kjokken';
const MAIN_LEVEL_ID = 'hoved';
/** An item outside every room polygon still belongs to the nearest room of its level this close (window sills, the
 *  TV window's recess, a radiator niche) – not further (the terrace, the garden). */
const NEAR_ROOM = 0.6;

/**
 * Sabine α at 500–1000 Hz for the estimated rooms (§5.4). Doors count as closed (the estimate must not depend on
 * which door the player left open); an open opening (no leaf) and the stairwell send part of the sound into the
 * coupled room next to it.
 */
export const SURFACE_ALPHA = Object.freeze({
  paint: 0.05, // painted plaster / gypsum walls
  'stone-panel': 0.03, // laminated stone-look wall panels (bathroom): hard like tiles
  'wetroom-paint': 0.03, // painted wet-room wall on a membrane
  'dark-panel': 0.08, // wooden wall panelling
  ceiling: 0.05, // painted gypsum ceiling
  wood: 0.07, // wooden floor (oak planks, parquet)
  vinyl: 0.03, // vinyl / tiles
  concrete: 0.02,
  glass: 0.04,
  door: 0.08, // closed wooden door leaf
  opening: 0.5, // open opening / stairwell (coupled room)
});
/** Air absorption 4m at ≈ 1 kHz, 50 % RH (m² per m³). */
const AIR_PER_M3 = 0.004;

/**
 * Target and colour bands per room kind: [target low, target high, yellow up to]. A living room or bedroom should
 * be 0.4–0.6 s; halls may ring a little more; wet rooms and storerooms are hard by nature (estimates, §5.4).
 */
const TARGETS = {
  living: [0.4, 0.6, 0.7],
  bedroom: [0.4, 0.6, 0.7],
  hall: [0.5, 0.8, 1.0],
  entrance: [0.5, 0.8, 1.0],
  bathroom: [0.6, 1.0, 1.4],
  laundry: [0.6, 1.0, 1.4],
  storage: [0.6, 1.2, 1.6],
};

const PROPOSALS = new Map((wallData.proposals || []).map((p) => [p.id, p]));

/** Default alpha per wall element type (wallFacts.absorptionGuide), used when an element has no `alpha`. */
const ELEMENT_ALPHA = {
  slats: 0.76, panel: 0.94, art: 0.56, tapestry: 0.45, checker: 0.77, circles: 0.8, hexagons: 0.45, curtain: 0.45,
  moss: 0.47, shelf: 0, 'sideboard-floating': 0, hooks: 0, led: 0, 'lamp-wall': 0, 'paint-block': 0, plant: 0,
  wallpaper: 0, moulding: 0, bookcase: 0.25, ledge: 0,
};

/** Fabric alpha (m² Sabine per m² of covered window) when a shading spec has no catalogue product. */
const SHADING_ALPHA = {
  curtain: 0.35, vertical: 0.08, roman: 0.12, roller: 0.05, 'duo-roller': 0.06, pleated: 0.1, venetian: 0.02, 'exterior-screen': 0,
};
/** Shading that hangs floor-length beside/over the window (and still absorbs when drawn aside). */
const DRAPED = new Set(['curtain', 'vertical']);

const num = (v, fb = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : fb);
const round = (v, d = 3) => Math.round(v * 10 ** d) / 10 ** d;

// ---------------------------------------------------------------------------------------------------------------
// Items

function scaleArea(archetype, dims) {
  const { w = 0, d = 0, h = 0 } = dims || {};
  const family = schema.archetypes[archetype]?.family;
  if (archetype === 'rug') return w * d;
  if (archetype === 'ceiling-absorber') return w * Math.max(d, h);
  if (family === 'acoustic' || family === 'framed') return w * h;
  return w * d + w * h + d * h; // furniture: proportional to the upholstered surface
}

/** Absorption estimate at the item's current dims when no data is available. */
function estimateAbsorption(item) {
  const { w = 0, d = 0, h = 0 } = item.dims || {};
  const a = item.archetype;
  const family = schema.archetypes[a]?.family;
  if (a === 'rug') return (RUG_ALPHA[parsePile(item.params?.pile)] ?? RUG_ALPHA.low) * w * d;
  if (a?.startsWith('sofa-')) return 1.05 * w;
  if (a === 'dining-chair') return 0.25;
  if (a === 'bar-stool') return 0.15;
  // a recliner (high upholstered back, headrest, footstool or footrest) ≈ 0.7–0.9 m², more with a footstool
  if (a === 'recliner') return Math.min(1.2, (item.params?.footstool ? 0.85 : 0.75) * Math.max(0.6, Math.min(1.6, (w * d) / 0.65)));
  if (family === 'seating') return 0.6 * Math.min(2, (w * d) / 0.56);
  // cabinets, vitrines, tables: hard wood/glass surfaces – no extra absorption
  if (family === 'storage' || family === 'table') return 0;
  if (a === 'cushion') return 0.4 * w * h;
  if (a === 'throw') return 0.18 * w * d;
  if (a === 'pouf') return 0.25;
  if (a === 'slat-panel') return 0.76 * w * h;
  if (a === 'fabric-panel') return 0.9 * w * h;
  if (a === 'acoustic-art') return 0.8 * w * h;
  if (a === 'felt-shape') return 0.6 * w * h;
  if (a === 'ceiling-absorber') return 0.8 * w * Math.max(d, h);
  if (family === 'plant') return 0.05;
  return 0;
}

/**
 * Sabine absorption (m²) of one design item.
 * @param {Object} item DesignState item
 * @returns {number}
 */
export function itemAbsorption(item) {
  if (!item || item.hidden) return 0;
  let m2 = item.acoustic?.m2;
  let ref = item.acoustic?.ref;
  if (typeof m2 !== 'number' && item.source === 'catalog') {
    const p = getProduct(item.refId);
    if (p) {
      m2 = p.absorption || 0;
      ref = p.dims;
    }
  }
  if (typeof m2 !== 'number') return estimateAbsorption(item);
  if (!m2) return 0;
  const a0 = scaleArea(item.archetype, ref || item.dims);
  const a1 = scaleArea(item.archetype, item.dims);
  const ratio = a0 > 0 ? Math.max(0.05, Math.min(20, a1 / a0)) : 1;
  return m2 * ratio;
}

// ---------------------------------------------------------------------------------------------------------------
// High wall

/**
 * Absorption (m²) of one wall-proposal element: area × alpha (circles: Σ πr², hexagons: n × hex area,
 * curtain: width × (top − bottom)).
 * @param {Object} el
 * @returns {number}
 */
export function elementAbsorption(el) {
  if (!el) return 0;
  const alpha = typeof el.alpha === 'number' ? el.alpha : ELEMENT_ALPHA[el.type] ?? 0;
  if (!alpha) return 0;
  let area = 0;
  if (el.type === 'circles') {
    const items = Array.isArray(el.items) ? el.items : [];
    area = items.reduce((s, c) => s + Math.PI * num(c.r, num(c.d, 0) / 2) ** 2, 0);
    if (!items.length && el.r) area = Math.PI * el.r ** 2 * num(el.count, 1);
  } else if (el.type === 'hexagons' && Array.isArray(el.items) && el.items.length) {
    const size = num(el.size, 0.5); // flat-to-flat
    area = el.items.length * (Math.sqrt(3) / 2) * size * size;
  } else if (el.type === 'curtain') {
    const top = num(el.top, num(el.v, 0) + num(el.h, 0));
    const bottom = num(el.bottom, num(el.v, 0));
    area = num(el.w, 0) * Math.max(0, (num(el.h, 0) || top - bottom));
  } else {
    area = num(el.w, 0) * num(el.h, 0) * Math.max(1, num(el.count, 1));
  }
  return area * alpha;
}

/**
 * Absorption added by the high wall: the proposal's sabineAdded, or Σ elementAbsorption when edited.
 * @param {{ proposalId?: string|null, elements?: Object[]|null, edited?: boolean }} wall
 * @returns {{ m2: number, label: string, proposal: Object|null }}
 */
export function wallAbsorption(wall) {
  if (!wall) return { m2: 0, label: '', proposal: null };
  const proposal = wall.proposalId != null ? PROPOSALS.get(String(wall.proposalId)) || null : null;
  let m2;
  if (proposal && !wall.edited) m2 = num(proposal.sabineAdded, 0);
  else m2 = (wall.elements || []).reduce((s, el) => s + elementAbsorption(el), 0);
  const name = proposal ? `Veggforslag ${proposal.code} – ${proposal.name}` : 'Egen vegg';
  return { m2, label: wall.edited ? `${name} (endret)` : name, proposal };
}

// ---------------------------------------------------------------------------------------------------------------
// Window shading

/**
 * Absorption (m²) of the shading on one window.
 * @param {Object} win    layout window (width, height, top, center)
 * @param {Object} spec   ShadingSpec
 * @param {Object} [layout]
 * @returns {number}
 */
export function shadingAbsorption(win, spec, layout = defaultLayout) {
  if (!win || !spec) return 0;
  const a = spec.archetype;
  if (a === 'exterior-screen') return 0;
  let alpha = SHADING_ALPHA[a] ?? 0.05;
  const product = spec.productId ? getProduct(spec.productId) : null;
  if (product && product.dims?.w > 0 && product.dims?.h > 0) alpha = (product.absorption || 0) / (product.dims.w * product.dims.h);
  const open = Math.max(0, Math.min(1, num(spec.open, 1)));
  let area;
  let closed;
  if (DRAPED.has(a)) {
    const width = num(spec.params?.width, win.width + 0.3);
    // the ceiling over the window's own room (3 arguments: world y, §1.8 – the living room's value is unchanged), as a
    // height above the window's floor like win.top
    const floorY = num(win.floorY, 0);
    const ceiling = layout?.ceilingHeightAt
      ? layout.house ? layout.ceilingHeightAt(win.center.x, win.center.z, win.center.y) - floorY : layout.ceilingHeightAt(win.center.x, win.center.z)
      : win.top + 0.3;
    const height = num(spec.params?.height, spec.params?.track === 'ceiling' || spec.mount === 'ceiling' ? ceiling - 0.02 : Math.min(ceiling, win.top + 0.15));
    area = width * height;
    closed = 0.4 + 0.6 * (1 - open);
  } else {
    const pad = spec.mount === 'wall' || spec.mount === 'ceiling' ? 0.1 : 0;
    area = (win.width + pad) * (win.height + pad);
    closed = 0.03 + 0.97 * (1 - open);
  }
  return alpha * area * closed;
}

// ---------------------------------------------------------------------------------------------------------------
// Rooms (hele-huset §5.4)

/** Distance from (x, z) to the edges of a plan polygon (Vector2 points, y = z). */
function distToPolygon(x, z, poly) {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const dx = b.x - a.x;
    const dz = b.y - a.y;
    const len2 = dx * dx + dz * dz;
    const t = len2 > 0 ? Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.y) * dz) / len2)) : 0;
    best = Math.min(best, Math.hypot(x - (a.x + t * dx), z - (a.y + t * dz)));
  }
  return best;
}

const isPhysical = (rm) => !!rm && !rm.hud && Array.isArray(rm.polygon) && rm.polygon.length >= 3;

/**
 * The room an item counts in (see the top of this file), or null outside the house. Works for design items (world y,
 * `level`) and for original specs (level-local y, `level`; the living room's have none = 'hoved') alike: only the
 * level, the plan position and the wall matter.
 * @param {Object} item  { position, level?, attach?: { wallId } }
 * @param {Object} [layout]
 * @returns {string|null}
 */
export function itemRoomId(item, layout = defaultLayout) {
  const H = layout?.house;
  if (!H?.roomAt) return LIVING_ROOM_ID;
  const wall = item?.attach?.wallId != null ? H.wallsById?.[item.attach.wallId] : null;
  if (wall && isPhysical(H.roomsById?.[wall.roomId])) return wall.roomId;
  const p = Array.isArray(item?.position) ? item.position : [0, 0, 0];
  const levelId = H.levelsById?.[item?.level] ? item.level : MAIN_LEVEL_ID;
  const x = num(p[0]);
  const z = num(p[2]);
  const r = H.roomAt(x, 0, z, { levelId });
  if (r) return r.id;
  let best = null;
  let bestD = NEAR_ROOM;
  for (const rm of H.rooms || []) {
    if (!isPhysical(rm) || rm.levelId !== levelId) continue;
    const d = distToPolygon(x, z, rm.polygon);
    if (d < bestD) {
      bestD = d;
      best = rm;
    }
  }
  return best ? best.id : null;
}

/** The room acoustics are computed for: a physical room of the house (never the stair's hud room), else the living room. */
function acousticRoom(layout, roomId) {
  const H = layout?.house;
  const rm = H?.roomsById?.[roomId];
  if (isPhysical(rm)) return rm;
  return H?.roomsById?.[LIVING_ROOM_ID] ?? null;
}

/** Shoelace area of a polygon given as [{x, y}] or [[x, z]]. */
function polyArea(poly) {
  let a = 0;
  const pts = (poly || []).map((p) => (Array.isArray(p) ? { x: p[0], y: p[1] } : p));
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a) / 2;
}

/** Face area of a wall (its top profile integrated along it). */
function wallArea(w) {
  const L = num(w.length, 0);
  if (!(L > 0)) return 0;
  if (typeof w.heightAt !== 'function') return L * num(w.height, 2.4);
  const us = [0, L, ...(w.topProfile || []).map((p) => p[0]).filter((u) => u > 0 && u < L)].sort((a, b) => a - b);
  let a = 0;
  for (let i = 1; i < us.length; i++) a += ((w.heightAt(us[i - 1]) + w.heightAt(us[i])) / 2) * (us[i] - us[i - 1]);
  return a;
}

/** α of a room's floor from its data (material / surface). */
function floorAlpha(floor) {
  const s = `${floor?.surface ?? ''} ${floor?.material ?? ''}`.toLowerCase();
  if (/concrete|betong/.test(s)) return SURFACE_ALPHA.concrete;
  if (/vinyl|tile|flis|klinker|stone|stein/.test(s)) return SURFACE_ALPHA.vinyl;
  return SURFACE_ALPHA.wood;
}

const SURFACE_LABELS = {
  walls: 'Vegger', ceiling: 'Tak', floor: 'Gulv', glass: 'Vinduer', doors: 'Dører (lukket)', openings: 'Åpninger og trappehull',
};

/**
 * Estimated absorption of a room's own surfaces (§5.4): walls minus their holes, windows (glass), doors (closed),
 * open openings and floor/ceiling holes (the stairwell), ceilings, floor and air.
 * @param {Object} layout
 * @param {Object} room  layout.house.rooms entry
 * @returns {{ total: number, parts: Array<{ key: string, label: string, area: number, m2: number }> }}
 */
export function surfaceAbsorption(layout, room) {
  const H = layout?.house;
  const acc = { walls: [0, 0], ceiling: [0, 0], floor: [0, 0], glass: [0, 0], doors: [0, 0], openings: [0, 0] };
  const add = (key, area, alpha) => {
    if (!(area > 0)) return;
    acc[key][0] += area;
    acc[key][1] += area * alpha;
  };
  for (const id of room?.wallIds || []) {
    const w = H?.wallsById?.[id];
    if (!w) continue;
    let holes = 0;
    for (const h of w.holes || []) {
      const u0 = Math.max(0, num(h.u0, 0));
      const u1 = Math.min(num(w.length, 0), num(h.u1, 0));
      const a = Math.max(0, u1 - u0) * Math.max(0, num(h.top, 0) - num(h.sill, 0));
      if (!(a > 0)) continue;
      holes += a;
      if (h.type === 'window' || h.type === 'terrace-door') add('glass', a, SURFACE_ALPHA.glass);
      else if (h.type === 'door' && h.door) add('doors', a, SURFACE_ALPHA.door);
      else add('openings', a, SURFACE_ALPHA.opening);
    }
    add('walls', Math.max(0, wallArea(w) - holes), SURFACE_ALPHA[w.material] ?? SURFACE_ALPHA.paint);
  }
  const ceilings = (room?.ceilingIds || []).map((id) => (H?.ceilings || []).find((c) => c.id === id)).filter(Boolean);
  if (ceilings.length) {
    for (const c of ceilings) {
      const holeArea = (c.holes || []).reduce((s, hp) => s + polyArea(hp), 0);
      add('ceiling', Math.max(0, num(c.area, polyArea(c.polygon)) - holeArea), SURFACE_ALPHA.ceiling);
      add('openings', holeArea, SURFACE_ALPHA.opening);
    }
  } else add('ceiling', num(room?.area, 0), SURFACE_ALPHA.ceiling);
  const net = num(room?.netArea, num(room?.area, 0));
  add('floor', net, floorAlpha(room?.floor));
  add('openings', Math.max(0, num(room?.area, 0) - net), SURFACE_ALPHA.opening);
  const parts = Object.entries(acc)
    .filter(([, [area]]) => area > 0)
    .map(([key, [area, m2]]) => ({ key, label: SURFACE_LABELS[key], area: round(area, 2), m2 }));
  parts.push({ key: 'air', label: 'Luft', area: 0, m2: AIR_PER_M3 * num(room?.volume, 0) });
  return { total: parts.reduce((s, p) => s + p.m2, 0), parts };
}

// ---------------------------------------------------------------------------------------------------------------
// Whole design

const BASE_CACHE = new WeakMap();

function layoutOf(design, home) {
  if (home?.layout?.volume) return home.layout;
  if (home?.volume && home?.windows) return home;
  if (design?.layout?.volume) return design.layout;
  return defaultLayout;
}

/** Ids of the rooms other than the living room that have furniture in the data. */
function otherFurnitureRooms(layout) {
  const ids = new Set();
  for (const f of layout?.house?.furniture || []) if ((f.roomId ?? LIVING_ROOM_ID) !== LIVING_ROOM_ID) ids.add(f.roomId);
  return [...ids];
}

/**
 * Original items' absorption per uid + the room absorption, per room. The living room: calibrated to 0.86 s with
 * its own originals (originalItems(layout), exactly as before the rest of the house). Another room: its surfaces
 * (estimate) + the originals that count in it.
 */
function calibration(layout, roomId) {
  let byRoom = BASE_CACHE.get(layout);
  if (!byRoom) {
    byRoom = new Map();
    BASE_CACHE.set(layout, byRoom);
  }
  let cal = byRoom.get(roomId);
  if (cal) return cal;
  if (roomId === LIVING_ROOM_ID) {
    const originals = originalItems(layout);
    const byUid = new Map(originals.map((it) => [it.uid, { item: it, m2: itemAbsorption(it) }]));
    const furniture = [...byUid.values()].reduce((s, x) => s + x.m2, 0);
    const total = (SABINE_K * layout.volume) / BASELINE_RT60;
    cal = { byUid, furniture, total, room: Math.max(1, total - furniture), volume: layout.volume, baseline: BASELINE_RT60, mode: 'calibrated', surfaces: null };
  } else {
    const room = layout.house.roomsById[roomId];
    const rooms = otherFurnitureRooms(layout);
    const originals = [...originalItems(layout), ...(rooms.length ? originalItems(layout, { rooms }) : [])].filter((it) => itemRoomId(it, layout) === roomId);
    const byUid = new Map(originals.map((it) => [it.uid, { item: it, m2: itemAbsorption(it) }]));
    const furniture = [...byUid.values()].reduce((s, x) => s + x.m2, 0);
    const est = surfaceAbsorption(layout, room);
    const volume = num(room.volume, 0);
    const total = est.total + furniture;
    cal = { byUid, furniture, total, room: est.total, volume, baseline: (SABINE_K * volume) / Math.max(0.5, total), mode: 'estimate', surfaces: est.parts };
  }
  byRoom.set(roomId, cal);
  return cal;
}

/** Breakdown groups (archetype family → group; families without their own group – tables, storage/vitrines, lamps,
 * plants, art – count as «other»). */
const GROUPS = [
  { key: 'seating', label: 'Sofaer og stoler' },
  { key: 'bed', label: 'Senger' }, // the rest of the house (archetype family «bed»: bed, headboard)
  { key: 'textile', label: 'Puter, pledd og puffer' },
  { key: 'rug', label: 'Tepper' },
  { key: 'acoustic', label: 'Akustikkprodukter' },
  { key: 'other', label: 'Planter, bilder og annet' },
];

/**
 * Reverberation time of a design in one room.
 * @param {Object} design  DesignState (or its toJSON(): items may be an array)
 * @param {Object} [home]  the home (uses home.layout) or a layout; default: design.layout / the real room
 * @param {{ roomId?: string }} [opts]  the room (default the living room; the stair's hud room or an unknown id → the
 *   living room)
 * @returns {{ rt60: number, absorption: number, volume: number, baseline: number, roomAbsorption: number,
 *   target: number[], yellow: number, level: 'green'|'yellow'|'red', label: string,
 *   breakdown: Array<{ label: string, m2: number }>, changes: Array<{ label: string, m2: number }>,
 *   roomId: string, roomName: string (with the level when two rooms share the name), roomShortName: string, roomKind: string, mode: 'calibrated'|'estimate', estimated: boolean,
 *   surfaces: Array<{ key: string, label: string, area: number, m2: number }>|null }}
 */
export function computeAcoustics(design, home, { roomId = LIVING_ROOM_ID } = {}) {
  const layout = layoutOf(design, home);
  const room = layout.house ? acousticRoom(layout, roomId) : null;
  const rid = room?.id ?? LIVING_ROOM_ID;
  const living = rid === LIVING_ROOM_ID;
  const cal = calibration(layout, rid);
  const all = design?.items instanceof Map ? [...design.items.values()] : Array.isArray(design?.items) ? design.items : [];
  const items = layout.house ? all.filter((it) => itemRoomId(it, layout) === rid) : all;

  const groups = Object.fromEntries(GROUPS.map((g) => [g.key, 0]));
  const changes = [];
  const seen = new Set();
  for (const it of items) {
    const m2 = itemAbsorption(it);
    const family = schema.archetypes[it.archetype]?.family;
    const key = family === 'textile' ? 'textile' : family in groups ? family : 'other';
    groups[key] += m2;
    const orig = cal.byUid.get(it.uid);
    if (orig) {
      seen.add(it.uid);
      if (Math.abs(m2 - orig.m2) > 0.005) changes.push({ label: `Endret: ${it.name}`, m2: round(m2 - orig.m2) });
    } else if (m2 > 0.005) changes.push({ label: `Lagt til: ${it.name}`, m2: round(m2) });
  }
  for (const [uid, orig] of cal.byUid) {
    if (!seen.has(uid) && orig.m2 > 0.005) changes.push({ label: `Fjernet: ${orig.item.name}`, m2: round(-orig.m2) });
  }

  // the high wall is the living room's
  const wall = living ? wallAbsorption(design?.wall) : { m2: 0, label: '', proposal: null };
  if (wall.m2 > 0.005) changes.push({ label: wall.label, m2: round(wall.m2) });

  // shading on the room's own windows
  const windows = living ? layout.windows : (layout.house?.windows || []).filter((w) => w.roomId === rid);
  let shading = 0;
  for (const [windowId, spec] of Object.entries(design?.windows || {})) {
    const win = windows.find((w) => w.id === windowId);
    if (!win) continue;
    const m2 = shadingAbsorption(win, spec, layout);
    shading += m2;
    if (m2 > 0.005) changes.push({ label: `Solskjerming: ${win?.name || windowId}`, m2: round(m2) });
  }

  const absorption = cal.room + Object.values(groups).reduce((s, v) => s + v, 0) + wall.m2 + shading;
  const rt60 = (SABINE_K * cal.volume) / Math.max(0.5, absorption);

  const breakdown = [{ label: living ? 'Rommet (vegger, tak, gulv, vinduer og luft)' : 'Rommet (vegger, tak, gulv, vinduer, dører og luft – anslått)', m2: round(cal.room, 2) }];
  for (const g of GROUPS) if (groups[g.key] > 0.005) breakdown.push({ label: g.label, m2: round(groups[g.key], 2) });
  if (wall.m2 > 0.005) breakdown.push({ label: 'Den høye veggen', m2: round(wall.m2, 2) });
  if (shading > 0.005) breakdown.push({ label: 'Gardiner og solskjerming', m2: round(shading, 2) });
  changes.sort((a, b) => Math.abs(b.m2) - Math.abs(a.m2));

  const [lo, hi, yellow] = living ? [TARGET_RT60[0], TARGET_RT60[1], 0.7] : TARGETS[room?.kind] ?? TARGETS.living;
  const level = rt60 <= hi + 1e-9 ? 'green' : rt60 <= yellow + 1e-9 ? 'yellow' : 'red';
  return {
    rt60,
    absorption,
    volume: cal.volume,
    baseline: cal.baseline,
    roomAbsorption: cal.room,
    target: [lo, hi],
    yellow,
    level,
    label: `Etterklang ≈ ${rt60.toFixed(2).replace('.', ',')} s`,
    breakdown,
    changes,
    roomId: rid,
    roomName: displayRoomName(layout, room),
    // the data name alone, for the narrow badge (the HUD banner above already names the level)
    roomShortName: room?.name ?? 'Stue/kjøkken',
    roomKind: room?.kind ?? 'living',
    mode: cal.mode,
    estimated: !living,
    surfaces: cal.surfaces ? cal.surfaces.map((p) => ({ ...p, m2: round(p.m2, 3) })) : null,
  };
}

/**
 * The room's name for the badge and the panel: the data name, with the level added when another physical room has the
 * same name (two «Soverom», two «Gang»: «Soverom (kjeller)», «Soverom (1. etasje)»). The living room as before.
 * @param {Object} layout
 * @param {Object|null} room
 */
function displayRoomName(layout, room) {
  const name = room?.name ?? 'Stue/kjøkken';
  if (!room) return name;
  const twin = (layout?.house?.rooms || []).some((r) => r !== room && r.id !== room.id && isPhysical(r) && r.name === name);
  if (!twin) return name;
  const lv = layout.house.levelsById?.[room.levelId]?.name;
  return lv ? `${name} (${lv.toLowerCase()})` : name;
}

const LIVE = new WeakMap();

/**
 * computeAcoustics per room, cached until the design's next change (a Map per design: the widget, the catalogue and
 * the inspector ask for the same room every frame). A plain object without `on` is computed every time.
 * @param {Object} design  DesignState
 * @param {Object} home
 * @param {string} [roomId]
 */
export function acousticsFor(design, home, roomId = LIVING_ROOM_ID) {
  if (!design || typeof design.on !== 'function') return computeAcoustics(design, home, { roomId });
  let c = LIVE.get(design);
  if (!c) {
    const entry = { map: new Map(), home };
    design.on('change', () => entry.map.clear());
    LIVE.set(design, entry);
    c = entry;
  }
  if (c.home !== home) {
    c.map.clear();
    c.home = home;
  }
  let r = c.map.get(roomId);
  if (!r) {
    r = computeAcoustics(design, home, { roomId });
    c.map.set(roomId, r);
  }
  return r;
}

/**
 * RT60 for a total absorption (m²) in a volume (m³).
 * @param {number} absorption
 * @param {number} [volume]
 */
export function rt60For(absorption, volume = defaultLayout.volume) {
  return (SABINE_K * volume) / Math.max(0.5, absorption);
}
