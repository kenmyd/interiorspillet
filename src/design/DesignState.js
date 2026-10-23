import { Emitter } from '../core/Events.js';
import { originalItems, furnishedItems } from '../home/existing.js';
import { getProduct } from '../catalog/index.js';
import { layout as defaultLayout } from '../home/layout.js';
import schema from '../data/archetypes.json';
import wallData from '../data/wall-proposals.json';
import palette from '../data/palette.json';
import { normaliseFinish, surfaceKind, finishSurfaceIds } from './Finishes.js';

/**
 * DesignState – the whole design as plain data (ARCHITECTURE §7) plus undo/redo.
 *
 * State: items (Map uid → Item), wall (the high wall), windows (shading per window), paints (wall / ceiling colour
 * overrides), finishes (a slat panel on a wall or a ceiling: { [surfaceId]: FinishSpec }, design/Finishes.js; missing =
 * the bare painted surface), env (time of day, light mode, built-in light groups, exposure), meta (name, createdAt,
 * updatedAt). A design saved before the finishes simply has none.
 *
 * Events (payloads): 'item:add' {uid,item} · 'item:update' {uid,item,patch} · 'item:remove' {uid,item} ·
 * 'wall' {wall} · 'window' {windowId, spec} · 'paint' {wallId, color} · 'finish' {surfaceId, spec} · 'env' {patch} ·
 * 'load' {} · 'change' {type, …} (after every one of the above) · 'history' {canUndo, canRedo, undoLabel, redoLabel}.
 *
 * Items and specs returned by get()/list() are the live objects: treat them as read-only and change them only through
 * update()/setWindow()/… (every mutation replaces the stored object, so references taken earlier stay unchanged).
 *
 * History: every mutation is one undo step unless it runs inside transaction(label, fn) / begin(label)…end(), which
 * group everything into one step (a drag = one step). Steps store deep-cloned before/after snapshots of the touched
 * items/wall/windows/paints/finishes/env. Max 200 steps. setEnv() calls within 1 s coalesce into one step, so do
 * setPaint() calls on one surface and setFinish() calls with the same `coalesce` key (a slider drag).
 *
 * Version 2 (hele-huset §5.5, steg 16 E3) – the whole house:
 *   - every item has `level` (a level id of layout.house: 'hoved', 'kjeller'). In memory `position[1]` is WORLD y
 *     (SceneSync, Placement and the lights use it as is); in a save (toJSON) it is LEVEL-LOCAL, above the level's
 *     floor, so a saved piece survives a re-measured floorY. LIMITS.y bounds the level-local y. A live item without a
 *     level (or whose y lies outside its level's band) gets the level its y is in.
 *   - originalJSON() and the start design hold the original furniture of EVERY room (existing.js originalItems with
 *     `rooms`; uid still 'ex-<spec id>'), in world y (`ySpace: 'world'`).
 *   - meta.originalRooms: the rooms whose originals the design has received. Loading adds the originals of every room
 *     with furniture that is not in the list (a version 1 save = ['stue-kjokken']: the rest of the house comes in,
 *     living-room pieces the user removed do not come back).
 *   - meta.originalUids: every original uid the data had when the design was saved. Loading also adds an original whose
 *     uid is not in that list (a piece the data got later, in a room the design already had), so a new original reaches
 *     an old save; a listed piece the user removed stays removed. Without the list only meta.originalRooms counts.
 *   - meta.specRevision: { uid: hash } of each original piece as the data gave it when the design was saved. A piece
 *     still exactly like that on load (the user never changed it) follows the current data (new photo positions).
 *   - version 1 saves load unchanged: their y is world y (= level-local on the first floor).
 */

export const DESIGN_VERSION = 2;
export const MAX_HISTORY = 200;
export const ORIGINAL_NAME = 'Original';

/** Default environment. `builtIn` lists only overridden groups (missing = LightManager default). */
export const DEFAULT_ENV = Object.freeze({ hour: 13, month: 6, day: 15, mode: 'auto', builtIn: Object.freeze({}), exposure: 1 });

const ENV_MODES = ['auto', 'day', 'evening', 'night'];
const SOURCES = ['existing', 'catalog', 'custom'];
const MOUNTS = ['floor', 'wall', 'ceiling', 'surface', 'soft', 'rug', 'window'];
const ITEM_FIELDS = [
  'uid', 'source', 'refId', 'name', 'category', 'archetype', 'mount', 'position', 'level', 'rotationDeg', 'dims', 'params',
  'colors', 'materials', 'variantIndex', 'light', 'attach', 'hidden', 'locked', 'acoustic', 'notes', 'confidence',
];
/** The first floor (layout.js MAIN_LEVEL_ID): the level of an item without one, and of every version 1 item. */
const MAIN_LEVEL = 'hoved';
/** The living room (layout.js LIVING_ROOM_ID): the only room a version 1 design has the originals of. */
const LIVING_ROOM = 'stue-kjokken';
/** Object fields that update() merges one level deep instead of replacing. */
const MERGE_FIELDS = ['dims', 'params', 'colors', 'materials', 'light', 'attach'];
const COALESCE_MS = 1000;

const PROPOSALS = new Map((wallData.proposals || []).map((p) => [p.id, p]));
/** Shading archetypes (data/archetypes.json family «shading»). */
const SHADING_ARCHETYPES = new Set(Object.entries(schema.archetypes).filter(([, a]) => a.family === 'shading').map(([id]) => id));

// ---------------------------------------------------------------------------------------------------------------
// Limits (sanity bounds for loaded / imported designs – a hand-edited or corrupt file must never freeze the tab)

/** Hard bounds that hold without any registry: metres, counts. */
export const LIMITS = Object.freeze({
  dim: [0.005, 12], // no piece of furniture is larger than the room
  roomMargin: 3, // positions may lie this far outside the house's floor rectangle (terrace, mistakes) – not further
  y: [-0.5, 4], // LEVEL-LOCAL: above the floor of the item's level (the basement entrance lies 0.30 below it)
  items: 300,
  wallElements: 80,
  lumens: 30000,
  colorK: [1000, 10000],
  absorption: [0, 60],
});

/**
 * Model limits registered at runtime by the home (home/index.js), so this module stays free of three.js/model code:
 *   archetypes: { [id]: { dimsRange?: { w: [min,max], d, h }, params?: { key: { type: 'number', min, max } } } }
 *   wallTypes: string[]   known element types of the high wall (models/walldesigns.js ELEMENT_TYPES)
 * Missing entries are simply not checked (only the hard LIMITS apply).
 */
const _limits = { archetypes: null, wallTypes: null };
/** Bumped by setDesignLimits (the cached normalised originals depend on the limits). */
let _limitsGen = 0;

/**
 * Registers model limits (see `_limits`). Calling it again replaces the given keys.
 * @param {{ archetypes?: object, wallTypes?: string[] }} limits
 */
export function setDesignLimits({ archetypes, wallTypes } = {}) {
  if (archetypes && typeof archetypes === 'object') _limits.archetypes = archetypes;
  if (Array.isArray(wallTypes)) _limits.wallTypes = new Set(wallTypes);
  _limitsGen++; // the normalised originals (originalsOf) depend on the limits
}

// ---------------------------------------------------------------------------------------------------------------
// Value helpers

const clone = (v) => (v === undefined ? undefined : v === null ? null : JSON.parse(JSON.stringify(v)));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const num = (v, fb) => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : fb);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
/** World ↔ level-local y (a non-zero floorY only): rounded to the nanometre so a save → load round trip is exact. */
const round9 = (v) => Math.round(v * 1e9) / 1e9;

// ---------------------------------------------------------------------------------------------------------------
// Levels (§5.5)

/** Floor (world y) of a level of the layout; 0 for an unknown level or a layout without levels. */
function floorYOf(layout, levelId) {
  const y = layout?.house?.levelsById?.[levelId]?.floorY;
  return Number.isFinite(y) ? y : 0;
}

/** Level of a world y for an item without a (fitting) level: the band it is in (a ceiling item hangs just under its ceiling). */
function levelAtY(layout, y, mount) {
  const H = layout?.house;
  if (typeof H?.levelAt !== 'function') return MAIN_LEVEL;
  return H.levelAt(mount === 'ceiling' ? y - 0.1 : y + 0.05)?.id ?? MAIN_LEVEL;
}

/** An item as it is saved: position[1] level-local (the in-memory item has world y). */
function storedItem(item, layout) {
  const out = clone(item);
  const fy = floorYOf(layout, item.level);
  if (fy && Array.isArray(out.position)) out.position[1] = round9(out.position[1] - fy);
  return out;
}

/** FNV-1a (32 bit, hex) of a text: meta.specRevision. */
function hashText(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

function vec3(v, fb = [0, 0, 0]) {
  if (Array.isArray(v)) return [num(v[0], fb[0]), num(v[1], fb[1]), num(v[2], fb[2])];
  if (isObj(v)) return [num(v.x, fb[0]), num(v.y, fb[1]), num(v.z, fb[2])];
  return [...fb];
}

function dimsOf(v, fb = { w: 0.5, d: 0.5, h: 0.5 }, range = null) {
  const d = isObj(v) ? v : {};
  const out = {};
  for (const k of ['w', 'd', 'h']) {
    let x = clamp(num(d[k], fb[k]), LIMITS.dim[0], LIMITS.dim[1]);
    // the archetype's slider range with a generous tolerance (catalogue products may lie a little outside it)
    const r = range?.[k];
    if (Array.isArray(r) && Number.isFinite(r[0]) && Number.isFinite(r[1])) x = clamp(x, Math.max(LIMITS.dim[0], r[0] * 0.5), Math.min(LIMITS.dim[1], r[1] * 1.6));
    out[k] = x;
  }
  return out;
}

/** Colour names materials.resolveColor understands (palette walls, paint ids/names/codes, material ids). */
const COLOR_NAMES = new Set(
  [
    ...Object.keys(palette?.walls || {}),
    ...(palette?.paints || []).flatMap((p) => [p.id, p.name, p.code]),
    ...(palette?.materials || []).map((m) => m.id),
  ].filter(Boolean).map((s) => String(s).toLowerCase()),
);

/** A paint value: '#rgb' / '#rrggbb' or a palette name – anything else is dropped (null). */
function hexOrName(v) {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(s)) return s;
  return COLOR_NAMES.has(s.toLowerCase()) ? s : null;
}

/** Plain-data copy without non-finite numbers (NaN/±Infinity → dropped) and without absurd magnitudes. */
function cleanData(v, depth = 0) {
  if (depth > 6) return undefined;
  if (typeof v === 'number') return Number.isFinite(v) && Math.abs(v) <= 1e5 ? v : undefined;
  if (typeof v === 'string') return v.length <= 200000 ? v : v.slice(0, 200000);
  if (typeof v === 'boolean' || v === null) return v;
  if (Array.isArray(v)) {
    const out = [];
    for (const x of v.slice(0, 400)) {
      const c = cleanData(x, depth + 1);
      if (c !== undefined) out.push(c);
    }
    return out;
  }
  if (isObj(v)) {
    const out = {};
    for (const [k, x] of Object.entries(v)) {
      const c = cleanData(x, depth + 1);
      if (c !== undefined) out[k] = c;
    }
    return out;
  }
  return undefined;
}

/**
 * Item params: numbers of the archetype's number params kept within a wide band around their slider range – only
 * absurd values are cut (0 as «none», e.g. armH 0 = no arms, stays; 1e6 candles do not).
 */
function cleanParams(params, schemaParams) {
  const out = isObj(params) ? cleanData(params) : {};
  if (!isObj(schemaParams)) return out;
  for (const [k, def] of Object.entries(schemaParams)) {
    if (def?.type !== 'number' || typeof out[k] !== 'number') continue;
    const lo = num(def.min, null), hi = num(def.max, null);
    if (lo == null || hi == null || hi < lo) continue;
    const slack = 2 * (hi - lo) + Math.max(Math.abs(lo), Math.abs(hi));
    out[k] = clamp(out[k], lo - slack, hi + slack);
  }
  return out;
}

/**
 * Normalises an item spec (tolerant: unknown fields dropped, missing ones defaulted, numbers kept in sane ranges).
 * The result has `level` and WORLD y (§5.5).
 * @param {Object} spec
 * @param {string} uid
 * @param {Object} [layout]
 * @param {{ stored?: boolean }} [opts]  stored: the spec comes from a saved design (version 2) or the room data, its
 *   y is level-local (no level = 'hoved'); default: a live spec (Placement, the inspector, a duplicate …) with world y
 */
export function normaliseItem(spec, uid, layout = null, { stored = false } = {}) {
  const s = isObj(spec) ? spec : {};
  const archetype = typeof s.archetype === 'string' && s.archetype ? s.archetype : 'vase';
  const info = schema.archetypes[archetype];
  const lim = _limits.archetypes?.[archetype] || null;
  const dims = dimsOf(s.dims, undefined, lim?.dimsRange);
  const mount = MOUNTS.includes(s.mount) ? s.mount : info?.mount || 'floor';
  const position = vec3(s.position);
  const b = layout?.house?.bounds ?? layout?.bounds;
  const m = LIMITS.roomMargin;
  if (b && Number.isFinite(b.minX)) {
    position[0] = clamp(position[0], b.minX - m, b.maxX + m);
    position[2] = clamp(position[2], b.minZ - m, b.maxZ + m);
  } else {
    position[0] = clamp(position[0], -50, 50);
    position[2] = clamp(position[2], -50, 50);
  }
  // the level and the y above its floor (LIMITS.y); in memory the world y
  const levels = layout?.house?.levelsById || null;
  let level = typeof s.level === 'string' && s.level && (!levels || levels[s.level]) ? s.level.slice(0, 40) : null;
  let local;
  if (stored) {
    level ??= MAIN_LEVEL;
    local = position[1];
  } else {
    // a live y outside its level's band (a piece carried to another floor without a new level) → the level it is on
    if (level && levels) {
      const l = position[1] - floorYOf(layout, level);
      if (l < LIMITS.y[0] - 1e-9 || l > LIMITS.y[1] + 1e-9) level = null;
    }
    level ??= levels ? levelAtY(layout, position[1], mount) : MAIN_LEVEL;
    local = position[1] - floorYOf(layout, level);
  }
  const fy = floorYOf(layout, level);
  local = clamp(fy ? round9(local) : local, LIMITS.y[0], LIMITS.y[1]);
  position[1] = fy ? round9(local + fy) : local;
  const item = {
    uid,
    source: SOURCES.includes(s.source) ? s.source : 'custom',
    refId: s.refId ?? null,
    name: typeof s.name === 'string' && s.name ? s.name.slice(0, 160) : info?.label || archetype,
    category: typeof s.category === 'string' ? s.category : null,
    archetype,
    mount,
    position,
    level,
    rotationDeg: clamp(num(s.rotationDeg, 0), -720, 720),
    dims,
    params: cleanParams(s.params, lim?.params),
    colors: isObj(s.colors) ? cleanData(s.colors) : {},
    materials: isObj(s.materials) ? cleanData(s.materials) : {},
    variantIndex: clamp(Math.round(num(s.variantIndex, 0)), 0, 200),
    hidden: s.hidden === true,
    locked: s.locked === true,
  };
  if (isObj(s.light)) {
    item.light = {
      ...cleanData(s.light),
      on: s.light.on !== false,
      dimmer: clamp(num(s.light.dimmer, 1), 0, 1),
      colorK: clamp(num(s.light.colorK, 2700), LIMITS.colorK[0], LIMITS.colorK[1]),
    };
    if (s.light.lumens != null) item.light.lumens = clamp(num(s.light.lumens, 800), 0, LIMITS.lumens);
  }
  if (isObj(s.attach)) {
    item.attach = {};
    if (s.attach.wallId != null) item.attach.wallId = String(s.attach.wallId);
    if (s.attach.normal != null) item.attach.normal = vec3(s.attach.normal).map((x) => clamp(x, -1, 1));
    if (s.attach.tilt != null) item.attach.tilt = clamp(num(s.attach.tilt, 0), -90, 90);
    for (const [k, v] of Object.entries(s.attach)) if (!(k in item.attach)) item.attach[k] = cleanData(v);
  }
  if (isObj(s.acoustic)) item.acoustic = { m2: clamp(num(s.acoustic.m2, 0), LIMITS.absorption[0], LIMITS.absorption[1]), ref: dimsOf(s.acoustic.ref, item.dims) };
  if (typeof s.notes === 'string' && s.notes) item.notes = s.notes.slice(0, 2000);
  if (typeof s.confidence === 'string') item.confidence = s.confidence;
  return item;
}

/** Geometric fields of wall elements and their sane ranges (W/H = the high wall's width/height). */
function wallFieldRange(key, W, H) {
  switch (key) {
    case 'u':
    case 'cu':
      return [-1, W + 1];
    case 'v':
    case 'cv':
      return [-1, H + 1];
    case 'w':
      return [0.01, W + 0.5];
    case 'h':
      return [0.01, H + 0.5];
    case 'top':
    case 'bottom':
      return [0, H + 0.5];
    case 'd':
    case 'depth':
    case 'thickness':
      return [0.001, 1];
    case 'r':
    case 'size':
    case 'tile':
      return [0.02, 2.5];
    case 'slatW':
      return [0.005, 0.3];
    case 'slatD':
      return [0.003, 0.15];
    case 'gap':
    case 'slatGap':
      return [0.001, 0.5];
    case 'standoff':
      return [0, 0.3];
    case 'waveWidth':
      return [0.03, 0.6];
    case 'fullness':
      return [1, 4];
    case 'cols':
    case 'rows':
    case 'doors':
    case 'motifCount':
      return [1, 24];
    case 'count':
    case 'n':
      return [1, 200];
    default:
      return null;
  }
}

/** One wall element (null when it is not a known element). */
function normaliseElement(el, W, H) {
  if (!isObj(el) || typeof el.type !== 'string') return null;
  if (_limits.wallTypes && !_limits.wallTypes.has(el.type)) return null;
  const out = cleanData(el);
  const fix = (o) => {
    for (const [k, v] of Object.entries(o)) {
      if (typeof v !== 'number') continue;
      const r = wallFieldRange(k, W, H);
      if (r) o[k] = clamp(v, r[0], r[1]);
    }
  };
  fix(out);
  if (Array.isArray(out.items)) {
    out.items = out.items.filter(isObj).slice(0, 120);
    out.items.forEach(fix);
  }
  return out;
}

function normaliseWall(w, layout = null) {
  const s = isObj(w) ? w : {};
  const W = num(layout?.highWall?.width, 4), H = num(layout?.highWall?.height, 3);
  let elements = null;
  if (Array.isArray(s.elements)) {
    elements = [];
    for (const el of s.elements) {
      if (elements.length >= LIMITS.wallElements) break;
      const e = normaliseElement(el, W, H);
      if (e) elements.push(e);
    }
  }
  return {
    proposalId: (typeof s.proposalId === 'string' && s.proposalId.length <= 40) || typeof s.proposalId === 'number' ? String(s.proposalId) : null,
    elements,
    edited: s.edited === true,
  };
}

function normaliseShading(spec) {
  if (!isObj(spec)) return null;
  const archetype = typeof spec.archetype === 'string' ? spec.archetype : 'roller';
  if (SHADING_ARCHETYPES.size && !SHADING_ARCHETYPES.has(archetype)) return null;
  const out = {
    ...cleanData(spec),
    archetype,
    params: isObj(spec.params) ? cleanData(spec.params) : {},
    colors: isObj(spec.colors) ? cleanData(spec.colors) : {},
    materials: isObj(spec.materials) ? cleanData(spec.materials) : {},
    open: clamp(num(spec.open, 1), 0, 1),
    tilt: clamp(num(spec.tilt, 0), -90, 90),
    mount: typeof spec.mount === 'string' ? spec.mount : 'recess',
  };
  if (spec.productId == null) delete out.productId;
  return out;
}

/**
 * Ids of the paintable surfaces (walls, backOf faces, ceilings, bulkheads) of the whole house (layout.house; a layout
 * without it: its own lists); null = unknown layout → every id is accepted. The whole house, so a saved paint on a
 * surface of another room is not dropped silently.
 */
function paintIds(layout) {
  const src = layout?.house ?? layout;
  const ids = [
    ...Object.keys(src?.wallsById || {}),
    ...(Array.isArray(src?.ceilings) ? src.ceilings.map((c) => c.id) : []),
    ...(Array.isArray(src?.bulkheads) ? src.bulkheads.map((b) => b.id) : []),
  ].filter(Boolean);
  return ids.length ? new Set(ids) : null;
}

/** Ids of the windows of the whole house (layout.house; else the layout's own list); null = unknown layout → every id is accepted. */
function windowIds(layout) {
  const list = layout?.house?.windows ?? layout?.windows;
  return Array.isArray(list) && list.length ? new Set(list.map((w) => w.id)) : null;
}

const ORIGINALS = new WeakMap();
const NO_LAYOUT = {};

/**
 * The original furniture of the whole house for a layout (cached until setDesignLimits): the living room's first
 * (originalItems(layout), the order of version 1), then every other room with furniture in the data, in the order of
 * layout.house.rooms. `items` are normalised live items (world y, `level`).
 * @returns {{ rooms: string[], items: Object[], byUid: Map<string, Object>, specs: Map<string, Object>,
 *   roomOf: Map<string, string>, hash: (uid: string) => string|null }}
 */
function originalsOf(layout) {
  const key = layout || NO_LAYOUT;
  let c = ORIGINALS.get(key);
  if (c && c.gen === _limitsGen) return c;
  const living = originalItems(layout);
  const withFurniture = new Set((layout?.house?.furniture || []).map((f) => f.roomId ?? LIVING_ROOM));
  // a generated house: the rooms the game furnished (notes/moblering-genererte-hus.md)
  for (const it of furnishedItems(layout)) withFurniture.add(it.roomId);
  const others = (layout?.house?.rooms || []).map((r) => r.id).filter((id) => id !== LIVING_ROOM && withFurniture.has(id));
  const otherSpecs = others.length ? originalItems(layout, { rooms: others }) : [];
  const items = [];
  const specs = new Map();
  const roomOf = new Map();
  for (const [spec, room] of [...living.map((s) => [s, LIVING_ROOM]), ...otherSpecs.map((s) => [s, s.roomId ?? LIVING_ROOM])]) {
    if (specs.has(spec.uid)) continue;
    specs.set(spec.uid, spec);
    roomOf.set(spec.uid, room);
    // the data's y is over the ROOM's floor; a save's is over the LEVEL's: the entrance and the room under the terrace
    // lie floorOffset (−0.30) below their level
    const off = room !== LIVING_ROOM ? num(layout?.house?.roomsById?.[room]?.floorOffset, 0) : 0;
    const p = Array.isArray(spec.position) ? spec.position : null;
    const levelLocal = off && p ? { ...spec, position: [p[0], round9(num(p[1], 0) + off), p[2]] } : spec;
    items.push(normaliseItem(levelLocal, spec.uid, layout, { stored: true }));
  }
  const byUid = new Map(items.map((it) => [it.uid, it]));
  const hashes = new Map();
  c = {
    gen: _limitsGen,
    rooms: [LIVING_ROOM, ...others],
    items,
    byUid,
    specs,
    roomOf,
    /** hash of the original as it is saved (meta.specRevision) */
    hash(uid) {
      if (!hashes.has(uid)) {
        const it = byUid.get(uid);
        hashes.set(uid, it ? hashText(JSON.stringify(storedItem(it, layout))) : null);
      }
      return hashes.get(uid);
    },
  };
  ORIGINALS.set(key, c);
  return c;
}

/**
 * True when `data` looks like a design of this game: an items array (or a non-empty uid → item map) with at least one
 * recognisable item, or the app marker / version with an items array.
 * @param {any} data
 */
export function looksLikeDesign(data) {
  if (!isObj(data)) return false;
  const items = Array.isArray(data.items) ? data.items : isObj(data.items) ? Object.values(data.items) : null;
  if (!items) return false;
  const marked = data.app === 'Interiørspillet' || data.version === 1 || data.version === DESIGN_VERSION;
  if (marked && Array.isArray(data.items)) return true;
  return items.some((it) => isObj(it) && typeof it.archetype === 'string' && !!schema.archetypes[it.archetype]);
}

function normaliseEnv(env, base = DEFAULT_ENV) {
  const s = isObj(env) ? env : {};
  const builtIn = {};
  const srcBuiltIn = isObj(s.builtIn) ? s.builtIn : base.builtIn;
  for (const [id, g] of Object.entries(srcBuiltIn || {})) {
    if (!isObj(g)) continue;
    builtIn[id] = { on: g.on !== false, dimmer: clamp(num(g.dimmer, 1), 0, 1) };
  }
  return {
    hour: clamp(num(s.hour, base.hour), 0, 24),
    month: clamp(Math.round(num(s.month, base.month)), 1, 12),
    day: clamp(Math.round(num(s.day, base.day)), 1, 31),
    mode: ENV_MODES.includes(s.mode) ? s.mode : base.mode,
    builtIn,
    exposure: clamp(num(s.exposure, base.exposure), 0.05, 8),
  };
}

// ---------------------------------------------------------------------------------------------------------------

export class DesignState extends Emitter {
  /**
   * @param {Object} [opts]
   * @param {Object} [opts.layout]      home/layout.js object (default: the real room)
   * @param {boolean} [opts.original=true] start with the original design (no history step)
   * @param {number} [opts.maxHistory=200]
   */
  constructor({ layout = defaultLayout, original = true, maxHistory = MAX_HISTORY } = {}) {
    super();
    this.layout = layout;
    this.maxHistory = maxHistory;
    /** @type {Map<string, Object>} */
    this.items = new Map();
    this.wall = { proposalId: null, elements: null, edited: false };
    this.windows = {};
    this.paints = {};
    this.finishes = {};
    this.env = normaliseEnv(DEFAULT_ENV);
    const now = new Date().toISOString();
    // an empty design (original: false) never gets the originals added later: it «has» every room
    this.meta = { name: ORIGINAL_NAME, createdAt: now, updatedAt: now, originalRooms: [...originalsOf(layout).rooms], originalUids: [...originalsOf(layout).byUid.keys()] };
    this._undo = [];
    this._redo = [];
    this._tx = null; // open step { label, before, after, depth, coalesce, time }
    this._seq = 0;
    this._historyDirty = false;
    if (original) this._replaceAll(this.originalJSON());
  }

  // ---- reading -------------------------------------------------------------------------------------------------

  /** @returns {Object|null} the item (read-only) */
  get(uid) {
    return this.items.get(uid) || null;
  }

  /**
   * Items, optionally filtered by a predicate or by fields ({ category, source, mount, archetype, refId, hidden }).
   * @param {Function|Object} [filter]
   * @returns {Object[]}
   */
  list(filter) {
    const all = [...this.items.values()];
    if (!filter) return all;
    if (typeof filter === 'function') return all.filter(filter);
    return all.filter((it) => Object.entries(filter).every(([k, v]) => (Array.isArray(v) ? v.includes(it[k]) : it[k] === v)));
  }

  /** The proposal data (data/wall-proposals.json) for an id, or null. */
  proposal(id = this.wall.proposalId) {
    return id != null ? PROPOSALS.get(String(id)) || null : null;
  }

  get canUndo() {
    return this._undo.length > 0 || !!(this._tx && this._txHasChanges());
  }

  get canRedo() {
    return this._redo.length > 0;
  }

  /** Label of the step undo() would revert ('' if none). */
  get undoLabel() {
    return this._undo[this._undo.length - 1]?.label || '';
  }

  get redoLabel() {
    return this._redo[this._redo.length - 1]?.label || '';
  }

  get historySize() {
    return this._undo.length;
  }

  // ---- items ---------------------------------------------------------------------------------------------------

  /**
   * Adds an item. `spec.uid` is kept when given and free.
   * @param {Object} spec  item spec (catalog productToItemSpec, existing.js, a duplicate …)
   * @returns {string} uid
   */
  add(spec) {
    const uid = typeof spec?.uid === 'string' && spec.uid && !this.items.has(spec.uid) ? spec.uid : this._newUid();
    const item = normaliseItem(spec, uid, this.layout);
    this._step(`Legg til ${item.name}`, () => {
      this._touch('items', uid);
      this.items.set(uid, item);
    });
    this._emit('item:add', { uid, item });
    this._changed({ type: 'item:add', uid });
    return uid;
  }

  /**
   * Changes an item. dims/params/colors/materials/light/attach merge one level deep; other fields are replaced;
   * `null` removes light/attach. Position may be [x,y,z] or {x,y,z}.
   * @param {string} uid
   * @param {Object} patch
   * @param {{ label?: string, coalesce?: string }} [opts] coalesce: merge with the previous step if it had the same key (< 1 s)
   * @returns {Object|null} the new item, or null when the uid is unknown
   */
  update(uid, patch, opts = {}) {
    const cur = this.items.get(uid);
    if (!cur || !isObj(patch)) return cur || null;
    const next = { ...cur };
    for (const [k, v] of Object.entries(patch)) {
      if (k === 'uid' || !ITEM_FIELDS.includes(k) || v === undefined) continue;
      if (v === null && (k === 'light' || k === 'attach' || k === 'acoustic' || k === 'notes')) delete next[k];
      else if (MERGE_FIELDS.includes(k) && isObj(v) && isObj(cur[k])) next[k] = { ...cur[k], ...clone(v) };
      else next[k] = clone(v);
    }
    const item = normaliseItem(next, uid, this.layout);
    if (same(item, cur)) return cur;
    this._step(opts.label || `Endre ${cur.name}`, () => {
      this._touch('items', uid);
      this.items.set(uid, item);
    }, opts.coalesce ? `item:${uid}:${opts.coalesce}` : null);
    this._emit('item:update', { uid, item, patch: clone(patch) });
    this._changed({ type: 'item:update', uid });
    return item;
  }

  /**
   * Removes an item.
   * @returns {boolean} false when the uid is unknown
   */
  remove(uid) {
    const item = this.items.get(uid);
    if (!item) return false;
    this._step(`Fjern ${item.name}`, () => {
      this._touch('items', uid);
      this.items.delete(uid);
    });
    this._emit('item:remove', { uid, item });
    this._changed({ type: 'item:remove', uid });
    return true;
  }

  /**
   * Copies an item (new uid), moved by `offset` metres.
   * @returns {string|null} the new uid
   */
  duplicate(uid, { offset = [0.3, 0, 0.3] } = {}) {
    const item = this.items.get(uid);
    if (!item) return null;
    const p = item.position;
    const copy = { ...clone(item), uid: undefined, position: [p[0] + offset[0], p[1] + offset[1], p[2] + offset[2]] };
    if (copy.source === 'existing') copy.source = 'custom';
    return this.add(copy);
  }

  // ---- wall / windows / paints / env ----------------------------------------------------------------------------

  /**
   * Changes the high wall. Setting `proposalId` without `elements` loads that proposal's elements (edited = false);
   * setting `elements` without `edited` marks the wall as edited.
   * @param {{ proposalId?: string|null, elements?: Object[]|null, edited?: boolean }} patch
   */
  setWall(patch) {
    if (!isObj(patch)) return;
    const next = { ...this.wall };
    if ('proposalId' in patch) {
      next.proposalId = patch.proposalId == null ? null : String(patch.proposalId);
      if (!('elements' in patch)) next.elements = clone(this.proposal(next.proposalId)?.elements ?? null);
      if (!('edited' in patch)) next.edited = false;
    }
    if ('elements' in patch) {
      next.elements = Array.isArray(patch.elements) ? clone(patch.elements) : null;
      if (!('edited' in patch) && !('proposalId' in patch)) next.edited = true;
    }
    if ('edited' in patch) next.edited = patch.edited === true;
    const wall = normaliseWall(next, this.layout);
    if (same(wall, this.wall)) return;
    this._step('Endre den høye veggen', () => {
      this._touch('wall', '_');
      this.wall = wall;
    });
    this._emit('wall', { wall });
    this._changed({ type: 'wall' });
  }

  /**
   * Chooses a wall proposal and applies its wall paint (proposal.wallPaint, or the room-spec colour) as one step.
   * @param {string|null} proposalId
   */
  setWallProposal(proposalId) {
    const p = this.proposal(proposalId);
    const wallId = this.layout?.highWall?.wallId || 'w-hoy';
    this.transaction(p ? `Veggforslag ${p.code}` : 'Fjern veggforslag', () => {
      this.setWall({ proposalId: p ? p.id : null, elements: clone(p?.elements ?? null), edited: false });
      this.setPaint(wallId, p?.wallPaint || null);
    });
  }

  /**
   * Sets (or removes with null) the shading of a window.
   * @param {string} windowId
   * @param {Object|null} spec ShadingSpec
   */
  setWindow(windowId, spec) {
    const next = normaliseShading(spec);
    const cur = this.windows[windowId] ?? null;
    if (same(next, cur)) return;
    this._step(next ? 'Endre solskjerming' : 'Fjern solskjerming', () => {
      this._touch('windows', windowId);
      if (next) this.windows = { ...this.windows, [windowId]: next };
      else {
        const { [windowId]: _drop, ...rest } = this.windows;
        this.windows = rest;
      }
    }, next && cur && next.productId === cur.productId ? `window:${windowId}` : null);
    this._emit('window', { windowId, spec: next });
    this._changed({ type: 'window', windowId });
  }

  /**
   * Overrides (or resets with null) a wall's paint: 'sand' | 'marrakesh' | '#hex'.
   * @param {string} wallId
   * @param {string|null} color
   */
  setPaint(wallId, color) {
    const next = hexOrName(color);
    const cur = this.paints[wallId] ?? null;
    if (next === cur) return;
    this._step('Endre veggfarge', () => {
      this._touch('paints', wallId);
      if (next) this.paints = { ...this.paints, [wallId]: next };
      else {
        const { [wallId]: _drop, ...rest } = this.paints;
        this.paints = rest;
      }
    }, `paint:${wallId}`);
    this._emit('paint', { wallId, color: next });
    this._changed({ type: 'paint', wallId });
  }

  /**
   * Puts (or removes with null) a surface finish – a slat panel – on a wall or a ceiling (design/Finishes.js; not the
   * high wall, it has the wall proposals). The spec is normalised for the surface's kind.
   * @param {string} surfaceId  wall or ceiling id
   * @param {Object|null} spec  FinishSpec ({ type: 'slats', look, slatW, gap, depth, backing, … })
   * @param {{ coalesce?: string, label?: string }} [opts] coalesce: steps with the same key on the same surface within
   *   1 s are one undo step (a slider drag)
   * @returns {Object|null} the stored finish
   */
  setFinish(surfaceId, spec, opts = {}) {
    const kind = surfaceKind(this.layout, surfaceId);
    const known = finishSurfaceIds(this.layout);
    if (known && !known.has(surfaceId)) return this.finishes[surfaceId] ?? null;
    const next = spec == null ? null : normaliseFinish(spec, kind);
    const cur = this.finishes[surfaceId] ?? null;
    if (same(next, cur)) return cur;
    const label = opts.label || (!next ? 'Fjern spiler' : !cur ? 'Legg inn spiler' : 'Endre spiler');
    this._step(label, () => {
      this._touch('finishes', surfaceId);
      if (next) this.finishes = { ...this.finishes, [surfaceId]: next };
      else {
        const { [surfaceId]: _drop, ...rest } = this.finishes;
        this.finishes = rest;
      }
    }, opts.coalesce && next && cur ? `finish:${surfaceId}:${opts.coalesce}` : null);
    this._emit('finish', { surfaceId, spec: next });
    this._changed({ type: 'finish', surfaceId });
    return next;
  }

  /**
   * Changes the environment ({ hour, month, day, mode, exposure, builtIn: { [groupId]: { on, dimmer } } }).
   * builtIn merges per group. Consecutive calls within 1 s are one undo step.
   * @param {Object} patch
   */
  setEnv(patch) {
    if (!isObj(patch)) return;
    const merged = { ...this.env, ...clone(patch) };
    if (isObj(patch.builtIn)) {
      merged.builtIn = { ...this.env.builtIn };
      for (const [id, g] of Object.entries(patch.builtIn)) {
        if (g === null) delete merged.builtIn[id];
        else merged.builtIn[id] = { ...(this.env.builtIn[id] || {}), ...g };
      }
    }
    const env = normaliseEnv(merged, this.env);
    if (same(env, this.env)) return;
    this._step('Endre lys og tid', () => {
      this._touch('env', '_');
      this.env = env;
    }, 'env');
    this._emit('env', { patch: clone(patch) });
    this._changed({ type: 'env' });
  }

  /** Changes meta fields (name …). Not part of the undo history. */
  setMeta(patch) {
    if (!isObj(patch)) return;
    if (typeof patch.name === 'string' && patch.name.trim()) this.meta.name = patch.name.trim();
    this.meta.updatedAt = new Date().toISOString();
    this.emit('change', { type: 'meta' });
  }

  // ---- history -------------------------------------------------------------------------------------------------

  /**
   * Runs fn as ONE undo step. Nested calls join the outer step. If fn returns a promise the step stays open until
   * it settles (e.g. a drag that ends on mouse-up).
   * @param {string} label  Norwegian, shown in the undo tooltip («Flytt Lenestol»)
   * @param {(design: DesignState) => any} fn
   */
  transaction(label, fn) {
    this.begin(label);
    let result;
    try {
      result = fn(this);
    } catch (err) {
      this.end();
      throw err;
    }
    if (result && typeof result.then === 'function') return result.finally(() => this.end());
    this.end();
    return result;
  }

  /** Opens a transaction (pair with end()). Use transaction() when the work is synchronous. */
  begin(label = 'Endring') {
    if (this._tx) {
      this._tx.depth++;
      return;
    }
    this._tx = this._newStep(label);
    this._tx.depth = 1;
  }

  /** Closes the innermost begin(); the outermost one commits the step. */
  end() {
    if (!this._tx) return;
    if (--this._tx.depth > 0) return;
    const step = this._tx;
    this._tx = null;
    this._commit(step);
    if (this._historyDirty) this._emitHistory();
  }

  /** Reverts everything done since begin() and closes the transaction without a history step. */
  cancel() {
    if (!this._tx) return;
    const step = this._tx;
    this._tx = null;
    this._finishSnapshot(step);
    this._apply(step.before, 'cancel');
  }

  /** Reverts the last step. */
  undo() {
    this._closeTx();
    const step = this._undo.pop();
    if (!step) return false;
    this._redo.push(step);
    this._apply(step.before, 'undo');
    return true;
  }

  /** Re-applies the last undone step. */
  redo() {
    this._closeTx();
    const step = this._redo.pop();
    if (!step) return false;
    this._undo.push(step);
    this._apply(step.after, 'redo');
    return true;
  }

  /** Forgets all undo/redo steps. */
  clearHistory() {
    this._tx = null;
    this._undo = [];
    this._redo = [];
    this._emitHistory();
  }

  // ---- save / load ---------------------------------------------------------------------------------------------

  /**
   * Plain JSON of the design ({ version: 2, meta: { name, createdAt, updatedAt, originalRooms, specRevision },
   * items: [...] (y level-local), wall, windows, paints, finishes, env }).
   */
  toJSON() {
    const orig = originalsOf(this.layout);
    const specRevision = {};
    for (const uid of this.items.keys()) {
      const h = orig.byUid.has(uid) ? orig.hash(uid) : null;
      if (h) specRevision[uid] = h;
    }
    const meta = clone(this.meta);
    meta.originalRooms = Array.isArray(this.meta.originalRooms) ? [...this.meta.originalRooms] : [...orig.rooms];
    // every original the design has seen (loading added the ones it had not): a later data piece is added on load
    meta.originalUids = [...orig.byUid.keys()];
    meta.specRevision = specRevision;
    return {
      version: DESIGN_VERSION,
      meta,
      items: [...this.items.values()].map((it) => storedItem(it, this.layout)),
      wall: clone(this.wall),
      windows: clone(this.windows),
      paints: clone(this.paints),
      finishes: clone(this.finishes),
      env: clone(this.env),
    };
  }

  /**
   * Loads a design (object or JSON string). Tolerant: unknown fields are ignored, missing ones defaulted, items may
   * be an array or a uid → item map. Emits 'load' + 'change'.
   * @param {Object|string} json
   * @param {{ keepHistory?: boolean, label?: string, meta?: { name?: string } }} [opts] keepHistory: record the load as
   *   one undo step (default: the history is cleared). The step also restores `meta` (the design's name), so undoing
   *   an «Åpne»/«Importer» gives the previous design back under its own name. meta: fields set on the loaded design
   *   (part of the same step).
   */
  load(json, { keepHistory = false, label = 'Åpne design', meta = null } = {}) {
    let data = json;
    if (typeof data === 'string') {
      try {
        data = JSON.parse(data);
      } catch {
        throw new Error('Filen er ikke et gyldig design (ugyldig JSON).');
      }
    }
    if (!isObj(data)) throw new Error('Filen er ikke et gyldig design.');
    this._closeTx();
    const applyMeta = () => {
      if (isObj(meta) && typeof meta.name === 'string' && meta.name.trim()) this.meta.name = meta.name.trim();
    };
    if (keepHistory) {
      const step = this._newStep(label);
      for (const uid of this.items.keys()) this._touchStep(step, 'items', uid);
      this._touchStep(step, 'wall', '_');
      for (const id of Object.keys(this.windows)) this._touchStep(step, 'windows', id);
      for (const id of Object.keys(this.paints)) this._touchStep(step, 'paints', id);
      for (const id of Object.keys(this.finishes)) this._touchStep(step, 'finishes', id);
      this._touchStep(step, 'env', '_');
      this._touchStep(step, 'meta', '_');
      this._replaceAll(data);
      applyMeta();
      for (const uid of this.items.keys()) this._touchStep(step, 'items', uid, null);
      for (const id of Object.keys(this.windows)) this._touchStep(step, 'windows', id, null);
      for (const id of Object.keys(this.paints)) this._touchStep(step, 'paints', id, null);
      for (const id of Object.keys(this.finishes)) this._touchStep(step, 'finishes', id, null);
      this._commit(step);
    } else {
      this._replaceAll(data);
      applyMeta();
      this._undo = [];
      this._redo = [];
    }
    this._historyDirty = true;
    this.emit('load', {});
    this._changed({ type: 'load' });
  }

  /**
   * JSON of the original design: today's furniture of every room, no wall proposal («0»), no shading, default env.
   * Its items are normalised live items (WORLD y, `ySpace: 'world'` – the Inspector and SavePanel compare them with
   * the design's items as they are; load() reads the marker).
   */
  originalJSON() {
    const now = new Date().toISOString();
    const orig = originalsOf(this.layout);
    return {
      version: DESIGN_VERSION,
      ySpace: 'world',
      meta: { name: ORIGINAL_NAME, createdAt: now, updatedAt: now, originalRooms: [...orig.rooms], originalUids: [...orig.byUid.keys()] },
      items: orig.items.map(clone),
      wall: { proposalId: '0', elements: [], edited: false },
      windows: {},
      paints: {},
      finishes: {},
      env: clone(DEFAULT_ENV),
    };
  }

  /**
   * Loads the original design (existing.js). Undoable by default.
   * @param {{ keepHistory?: boolean }} [opts]
   */
  resetToOriginal({ keepHistory = true } = {}) {
    this.load(this.originalJSON(), { keepHistory, label: 'Tilbake til original' });
  }

  // ---- internals -----------------------------------------------------------------------------------------------

  _newUid() {
    let uid;
    do uid = `it-${Date.now().toString(36)}-${(++this._seq).toString(36)}`;
    while (this.items.has(uid));
    return uid;
  }

  /**
   * Replaces the whole state from (tolerant) JSON without events or history. The items' y is level-local for a
   * version 2 design and world y for version 1 and for `ySpace: 'world'` (originalJSON); see the top of the file for
   * meta.originalRooms and meta.specRevision.
   */
  _replaceAll(data) {
    const items = new Map();
    const list = Array.isArray(data.items) ? data.items : isObj(data.items) ? Object.entries(data.items).map(([uid, it]) => ({ uid, ...(isObj(it) ? it : {}) })) : [];
    const stored = (data.ySpace ?? (num(data.version, 1) >= 2 ? 'level' : 'world')) !== 'world';
    const m = isObj(data.meta) ? data.meta : {};
    const orig = originalsOf(this.layout);
    // originals the user never changed follow the data (their saved form is still the one the data gave)
    const revision = stored && isObj(m.specRevision) ? m.specRevision : null;
    // a level the layout left out (the game without the basement, layout.js withoutBasement): its pieces are skipped
    // instead of landing on the main floor, and its rooms count as not had, so their originals come back with the level
    const removed = this.layout?.spec?.removed;
    const skipLevel = new Set(removed?.levels || []);
    const skipRoom = new Set(removed?.rooms || []);
    for (const raw of list) {
      if (!isObj(raw)) continue;
      if (skipLevel.has(raw.level)) continue;
      if (items.size >= LIMITS.items) break; // a corrupt file with 100 000 items must not freeze the tab
      let uid = typeof raw.uid === 'string' && raw.uid ? raw.uid : null;
      if (!uid || items.has(uid)) {
        do uid = `it-${Date.now().toString(36)}-${(++this._seq).toString(36)}`;
        while (items.has(uid));
      }
      const rev = revision && raw.source === 'existing' && raw.uid === uid ? revision[uid] : null;
      const cur = typeof rev === 'string' && orig.byUid.has(uid) ? orig.hash(uid) : null;
      if (cur && cur !== rev && hashText(JSON.stringify(raw)) === rev) items.set(uid, clone(orig.byUid.get(uid)));
      else items.set(uid, normaliseItem(raw, uid, this.layout, { stored }));
    }
    // the rooms whose originals this design has not had yet (a version 1 design: every room but the living room)
    const had = Array.isArray(m.originalRooms) ? m.originalRooms.filter((r) => typeof r === 'string' && r && !skipRoom.has(r)).map((r) => r.slice(0, 60)) : [LIVING_ROOM];
    const hadSet = new Set(had);
    // the originals the save knew (meta.originalUids): one it did not know is new in the data → added, even in a room
    // the save already had; without the list only the rooms count (version 1, a hand-written file)
    const knew = Array.isArray(m.originalUids) ? new Set(m.originalUids.filter((u) => typeof u === 'string')) : null;
    for (const it of orig.items) {
      if (items.size >= LIMITS.items) break;
      if (items.has(it.uid)) continue;
      if (hadSet.has(orig.roomOf.get(it.uid)) && (!knew || knew.has(it.uid))) continue;
      items.set(it.uid, clone(it));
    }
    const originalRooms = [...new Set([...had, ...orig.rooms])];
    // the lumens of today's lamps are room-spec data, not a user setting (nothing edits them): a design saved before a
    // data change (add-lighting: the chandelier 2000 → 800 lm) gets the current value
    for (const it of items.values()) {
      if (it.source !== 'existing' || !it.light) continue;
      const lm = orig.specs.get(it.uid)?.light?.lumens;
      if (lm != null) it.light.lumens = lm;
    }
    // room-data corrections to existing pieces that a design saved earlier still holds (2026-10-20: the pampas vase on
    // the island was 1 m tall in the data, the real one is ≈ 55 cm) – only while the saved piece still has the old size
    for (const it of items.values()) {
      if (it.source !== 'existing' || it.refId !== 'f-pampas' || !(it.dims?.h > 0.8)) continue;
      const o = orig.specs.get(it.uid);
      if (o) { it.dims = { ...o.dims }; it.params = { ...it.params, ...o.params }; }
    }
    // catalogue model corrections a design saved earlier still holds (2026-10-20: Oslo Wood was drawn with a drum shade;
    // the real one is a tiltable cone) – the product's shape params, only while the saved item still has the old shape
    for (const it of items.values()) {
      if (it.refId !== 'nordicnest-northern-oslo-wood-gulvlampe' || it.params?.shadeShape === 'cone') continue;
      const p = getProduct(it.refId)?.params;
      if (p) it.params = { ...it.params, ...Object.fromEntries(['shadeShape', 'shadeD', 'shadeBottomD', 'shadeH', 'tilt', 'tiltable'].filter((k) => k in p).map((k) => [k, p[k]])) };
    }
    this.items = items;
    this.wall = normaliseWall(data.wall, this.layout);
    const windows = {};
    const known = windowIds(this.layout);
    for (const [id, spec] of Object.entries(isObj(data.windows) ? data.windows : {})) {
      if (known && !known.has(id)) continue; // shading for a window this room does not have
      const s = normaliseShading(spec);
      if (s) windows[id] = s;
    }
    this.windows = windows;
    const paints = {};
    const surfaces = paintIds(this.layout);
    for (const [id, c] of Object.entries(isObj(data.paints) ? data.paints : {})) {
      if (surfaces && !surfaces.has(id)) continue; // a wall/ceiling this room does not have
      const v = hexOrName(c);
      if (v) paints[id] = v;
    }
    this.paints = paints;
    // slat finishes (a design saved before them has none); a surface this layout does not have is dropped
    const finishes = {};
    const finishable = finishSurfaceIds(this.layout);
    for (const [id, spec] of Object.entries(isObj(data.finishes) ? data.finishes : {})) {
      if (finishable && !finishable.has(id)) continue;
      const f = normaliseFinish(spec, surfaceKind(this.layout, id));
      if (f) finishes[id] = f;
    }
    this.finishes = finishes;
    this.env = normaliseEnv(data.env);
    const now = new Date().toISOString();
    this.meta = {
      name: typeof m.name === 'string' && m.name.trim() ? m.name.trim().slice(0, 80) : 'Uten navn',
      createdAt: typeof m.createdAt === 'string' ? m.createdAt : now,
      updatedAt: typeof m.updatedAt === 'string' ? m.updatedAt : now,
      originalRooms,
      originalUids: [...orig.byUid.keys()],
    };
  }

  _newStep(label) {
    return { label, before: {}, after: {}, depth: 0, coalesce: null, time: Date.now() };
  }

  _section(name) {
    switch (name) {
      case 'items':
        return { get: (k) => this.items.get(k) ?? null };
      case 'wall':
        return { get: () => this.wall };
      case 'windows':
        return { get: (k) => this.windows[k] ?? null };
      case 'paints':
        return { get: (k) => this.paints[k] ?? null };
      case 'finishes':
        return { get: (k) => this.finishes[k] ?? null };
      case 'env':
        return { get: () => this.env };
      case 'meta': // only load steps touch it (the design's name follows undo/redo of «Åpne»/«Importer»)
        return { get: () => this.meta };
      default:
        throw new Error(`unknown section ${name}`);
    }
  }

  /** Records the current value of section/key as the step's «before» (first touch wins). */
  _touchStep(step, section, key, value) {
    const bucket = (step.before[section] ||= {});
    if (!(key in bucket)) bucket[key] = value !== undefined ? value : clone(this._section(section).get(key));
  }

  _touch(section, key) {
    this._touchStep(this._tx, section, key);
  }

  /** Runs one mutation inside the open transaction, or as its own step. */
  _step(label, mutate, coalesce = null) {
    const own = !this._tx;
    if (own) {
      this._tx = this._newStep(label);
      this._tx.depth = 1;
      this._tx.coalesce = coalesce;
    }
    mutate();
    if (own) {
      const step = this._tx;
      this._tx = null;
      this._commit(step);
    }
  }

  _finishSnapshot(step) {
    for (const [section, bucket] of Object.entries(step.before)) {
      const after = (step.after[section] = {});
      for (const key of Object.keys(bucket)) after[key] = clone(this._section(section).get(key));
    }
  }

  _txHasChanges() {
    const step = this._tx;
    if (!step) return false;
    return Object.entries(step.before).some(([section, bucket]) =>
      Object.entries(bucket).some(([key, v]) => !same(v, this._section(section).get(key))),
    );
  }

  /** Pushes a finished step (drops unchanged keys; coalesces with the previous step when allowed). */
  _commit(step) {
    this._finishSnapshot(step);
    let changed = false;
    for (const section of Object.keys(step.before)) {
      for (const key of Object.keys(step.before[section])) {
        if (same(step.before[section][key], step.after[section][key])) {
          delete step.before[section][key];
          delete step.after[section][key];
        } else changed = true;
      }
      if (!Object.keys(step.before[section]).length) {
        delete step.before[section];
        delete step.after[section];
      }
    }
    if (!changed) return;
    const now = Date.now();
    const last = this._undo[this._undo.length - 1];
    if (step.coalesce && last && last.coalesce === step.coalesce && now - last.time < COALESCE_MS && !this._redo.length) {
      for (const section of Object.keys(step.after)) {
        last.before[section] ||= {};
        last.after[section] ||= {};
        for (const key of Object.keys(step.after[section])) {
          if (!(key in last.before[section])) last.before[section][key] = step.before[section][key];
          last.after[section][key] = step.after[section][key];
        }
      }
      last.time = now;
    } else {
      step.time = now;
      delete step.depth;
      this._undo.push(step);
      if (this._undo.length > this.maxHistory) this._undo.splice(0, this._undo.length - this.maxHistory);
    }
    this._redo = [];
    this.meta.updatedAt = new Date().toISOString();
    this._historyDirty = true;
  }

  _closeTx() {
    if (!this._tx) return;
    const step = this._tx;
    this._tx = null;
    this._commit(step);
    if (this._historyDirty) this._emitHistory();
  }

  /** Applies a snapshot (undo/redo/cancel) and emits the matching events. */
  _apply(snapshot, type) {
    for (const [uid, target] of Object.entries(snapshot.items || {})) {
      const cur = this.items.get(uid);
      if (!target) {
        if (cur) {
          this.items.delete(uid);
          this._emit('item:remove', { uid, item: cur });
        }
      } else if (!cur) {
        const item = clone(target);
        this.items.set(uid, item);
        this._emit('item:add', { uid, item });
      } else {
        const item = clone(target);
        this.items.set(uid, item);
        this._emit('item:update', { uid, item, patch: clone(target) });
      }
    }
    if (snapshot.wall && '_' in snapshot.wall) {
      this.wall = clone(snapshot.wall._) || normaliseWall(null);
      this._emit('wall', { wall: this.wall });
    }
    for (const [id, spec] of Object.entries(snapshot.windows || {})) {
      if (spec) this.windows = { ...this.windows, [id]: clone(spec) };
      else {
        const { [id]: _drop, ...rest } = this.windows;
        this.windows = rest;
      }
      this._emit('window', { windowId: id, spec: this.windows[id] ?? null });
    }
    for (const [id, color] of Object.entries(snapshot.paints || {})) {
      if (color) this.paints = { ...this.paints, [id]: color };
      else {
        const { [id]: _drop, ...rest } = this.paints;
        this.paints = rest;
      }
      this._emit('paint', { wallId: id, color: this.paints[id] ?? null });
    }
    for (const [id, spec] of Object.entries(snapshot.finishes || {})) {
      if (spec) this.finishes = { ...this.finishes, [id]: clone(spec) };
      else {
        const { [id]: _drop, ...rest } = this.finishes;
        this.finishes = rest;
      }
      this._emit('finish', { surfaceId: id, spec: this.finishes[id] ?? null });
    }
    if (snapshot.env && '_' in snapshot.env) {
      this.env = clone(snapshot.env._);
      this._emit('env', { patch: clone(this.env) });
    }
    if (snapshot.meta && isObj(snapshot.meta._)) this.meta = clone(snapshot.meta._);
    this.meta.updatedAt = new Date().toISOString();
    this._historyDirty = true;
    this._changed({ type });
  }

  _emit(name, payload) {
    this.emit(name, payload);
  }

  /** 'change' after every mutation, then 'history' when the undo stacks changed (not while a transaction is open). */
  _changed(payload) {
    this.emit('change', payload);
    if (this._historyDirty && !this._tx) this._emitHistory();
  }

  _emitHistory() {
    this._historyDirty = false;
    this.emit('history', { canUndo: this.canUndo, canRedo: this.canRedo, undoLabel: this.undoLabel, redoLabel: this.redoLabel });
  }
}

export default DesignState;
