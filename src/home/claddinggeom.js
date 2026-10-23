/**
 * CLADDING – the outer finish of the house format (notes/kledning.md), without three.js: layout.js, the room builder
 * (home/rooms.js: the outer layer of every exterior wall, the plinth, corner boards and surrounds) and the validator
 * (data/scripts/house.mjs) all read the same model.
 *
 *   resolveCladding(raw, { levels, walls, mainLevelId }) → { cladding, issues }   `cladding` with every default filled
 *   finishAt(cl, { levelId, wallId, y, gable, below })  → finish                    the finish of a point of a wall
 *   wallCuts(cl, { levelId, wallId, gableY, levelFloorY, plinthTop })  → [y, …]     where the finish can change
 *   finishKey(f)                                        → string                    equal keys = the same look
 *   groundLevel(levels, mainLevelId)                    → world y                    «bakken» (the ground)
 *
 * A finish is { type, direction, profile, color, module }: type 'wood' | 'panels' | 'render' | 'brick' | 'stone';
 * direction 'vertical' | 'horizontal' (wood and panels); profile 'board-batten' | 'shiplap' | 'shadow' | 'plain' (wood);
 * module [w, h] the panel size (panels). Heights (zones' from / to) are local: metres over the floor of the wall's
 * level. The ground and the plinth are world y.
 */

export const CLADDING_TYPES = Object.freeze(['wood', 'panels', 'render', 'brick', 'stone']);
export const DIRECTIONS = Object.freeze(['vertical', 'horizontal']);
export const PROFILES = Object.freeze(['board-batten', 'shiplap', 'shadow', 'plain']);
export const PLINTH_MATERIALS = Object.freeze(['concrete', 'render', 'stone']);
/** «Bakken»: this far under the main floor (the planbygger's 3D view puts its ground there: one threshold step). */
export const GROUND_STEP = 0.15;

/** Defaults of the format (notes/kledning.md). */
export const CLADDING_DEFAULTS = Object.freeze({
  type: 'wood',
  color: Object.freeze({ wood: '#4a4642', panels: '#8b8f91', render: '#d9d6cf', brick: '#8c4b3c', stone: '#85817a' }),
  module: Object.freeze([1.2, 2.4]),
  /** levels under the main floor without a zone of their own: plaster, as before the format had cladding */
  basement: Object.freeze({ type: 'render', direction: 'vertical', profile: null, color: '#d9d6cf', module: null }),
  plinth: Object.freeze({ height: 0.3, material: 'concrete', color: Object.freeze({ concrete: '#9c9b96', render: '#b9b6ae', stone: '#7d7a74' }) }),
  /** the plinth reaches this far under the ground (the ground hides its lower edge) */
  plinthFoot: 0.3,
  trim: Object.freeze({ width: 0.1, thickness: 0.022 }),
});

const num = (v) => typeof v === 'number' && Number.isFinite(v);
const HEX = /^#[0-9a-f]{6}$/i;
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const KNOWN = {
  cladding: ['default', 'zones', 'plinth', 'trim'],
  finish: ['type', 'direction', 'profile', 'color', 'module'],
  zone: ['id', 'name', 'levelId', 'walls', 'from', 'to', 'gable', 'type', 'direction', 'profile', 'color', 'module', 'source', 'estimated'],
  plinth: ['height', 'color', 'material'],
  trim: ['color', 'corners', 'surrounds'],
};

/** World y of the ground: the main level's floor − GROUND_STEP (0 − 0.15 without levels). */
export function groundLevel(levels = [], mainLevelId = null) {
  const main = levels.find((l) => l.id === mainLevelId) ?? levels.find((l) => l.id === 'hoved') ?? levels[0];
  return (num(main?.floorY) ? main.floorY : 0) - GROUND_STEP;
}

/**
 * A finish with its defaults: `base` fills what `f` leaves out when `f` has no type or the same type; another type
 * starts from that type's defaults.
 */
function fillFinish(f, base, where, issues) {
  const own = isObj(f) ? f : {};
  const type = own.type ?? base?.type ?? CLADDING_DEFAULTS.type;
  if (!CLADDING_TYPES.includes(type)) {
    issues.push({ level: 'error', where, msg: `type «${type}» er ikke en av ${CLADDING_TYPES.join(', ')}` });
    return null;
  }
  const inherit = base && base.type === type ? base : null;
  let direction = own.direction ?? inherit?.direction ?? 'vertical';
  if (!DIRECTIONS.includes(direction)) {
    issues.push({ level: 'error', where, msg: `direction «${direction}» er ikke en av ${DIRECTIONS.join(', ')}` });
    direction = 'vertical';
  }
  let profile = null;
  if (type === 'wood') {
    profile = own.profile ?? (own.direction == null ? inherit?.profile : null) ?? (direction === 'horizontal' ? 'shiplap' : 'board-batten');
    if (!PROFILES.includes(profile)) {
      issues.push({ level: 'error', where, msg: `profile «${profile}» er ikke en av ${PROFILES.join(', ')}` });
      profile = direction === 'horizontal' ? 'shiplap' : 'board-batten';
    }
  } else if (own.profile != null) issues.push({ level: 'warn', where, msg: `profile gjelder bare type 'wood' (brukes ikke for «${type}»)` });
  if (own.direction != null && !['wood', 'panels'].includes(type)) issues.push({ level: 'warn', where, msg: `direction gjelder bare 'wood' og 'panels' (brukes ikke for «${type}»)` });
  let color = own.color ?? inherit?.color ?? CLADDING_DEFAULTS.color[type];
  if (typeof color !== 'string' || !HEX.test(color)) {
    issues.push({ level: 'error', where, msg: `color «${color}» må være en hex-farge som '#4a4642'` });
    color = CLADDING_DEFAULTS.color[type];
  }
  let module = null;
  if (type === 'panels') {
    module = own.module ?? inherit?.module ?? CLADDING_DEFAULTS.module;
    if (!(Array.isArray(module) && module.length === 2 && module.every((v) => num(v) && v >= 0.2 && v <= 6))) {
      issues.push({ level: 'error', where, msg: 'module må være [bredde, høyde] i meter (0,2–6)' });
      module = CLADDING_DEFAULTS.module;
    }
    module = [module[0], module[1]];
  } else if (own.module != null) issues.push({ level: 'warn', where, msg: `module gjelder bare type 'panels'` });
  return { type, direction, profile, color: color.toLowerCase(), module };
}

function unknownKeys(obj, known, where, issues) {
  if (!isObj(obj)) return;
  const bad = Object.keys(obj).filter((k) => !known.includes(k));
  if (bad.length) issues.push({ level: 'warn', where, msg: `ukjente felt ${bad.map((k) => `«${k}»`).join(', ')} (brukes ikke)` });
}

/**
 * The house's `cladding` with every default filled in.
 * @param {object|undefined} raw   spec.cladding
 * @param {{ levels: Array<{id, floorY}>, walls: Array<{id, levelId, exterior}>, mainLevelId?: string }} ctx
 * @returns {{ cladding: object|null, issues: Array<{level: 'error'|'warn', where: string, msg: string}> }}
 */
export function resolveCladding(raw, { levels = [], walls = [], mainLevelId = null } = {}) {
  const issues = [];
  if (raw == null) return { cladding: null, issues };
  if (!isObj(raw)) {
    issues.push({ level: 'error', where: 'cladding', msg: 'må være et objekt { default, zones, plinth, trim }' });
    return { cladding: null, issues };
  }
  unknownKeys(raw, KNOWN.cladding, 'cladding', issues);
  unknownKeys(raw.default, KNOWN.finish, 'cladding.default', issues);
  if (raw.default != null && !isObj(raw.default)) issues.push({ level: 'error', where: 'cladding.default', msg: 'må være et objekt { type, direction, profile, color }' });
  const def = fillFinish(raw.default, null, 'cladding.default', issues) ?? fillFinish({}, null, 'cladding.default', []);
  const levelIds = new Set(levels.map((l) => l.id));
  const main = levels.find((l) => l.id === mainLevelId) ?? levels.find((l) => l.id === 'hoved') ?? levels[0];
  const mainY = num(main?.floorY) ? main.floorY : 0;
  const wallsById = new Map(walls.map((w) => [w.id, w]));

  const zones = [];
  if (raw.zones != null && !Array.isArray(raw.zones)) issues.push({ level: 'error', where: 'cladding.zones', msg: 'må være en liste' });
  const seen = new Set();
  (Array.isArray(raw.zones) ? raw.zones : []).forEach((z, i) => {
    const where = `cladding.zones/${isObj(z) && z.id != null ? z.id : i}`;
    if (!isObj(z)) {
      issues.push({ level: 'error', where, msg: 'en sone må være et objekt' });
      return;
    }
    unknownKeys(z, KNOWN.zone, where, issues);
    if (z.id == null) issues.push({ level: 'error', where, msg: 'mangler id' });
    else if (seen.has(z.id)) issues.push({ level: 'error', where, msg: `id-en «${z.id}» er brukt av en annen sone` });
    seen.add(z.id);
    if (z.levelId != null && !levelIds.has(z.levelId)) issues.push({ level: 'error', where, msg: `nivået «${z.levelId}» finnes ikke` });
    let ws = null;
    if (z.walls != null) {
      if (!Array.isArray(z.walls)) issues.push({ level: 'error', where, msg: 'walls må være en liste med vegg-id-er' });
      else if (z.walls.length) {
        ws = [];
        for (const id of z.walls) {
          const w = wallsById.get(id);
          if (!w) issues.push({ level: 'error', where, msg: `veggen «${id}» finnes ikke` });
          else if (!w.exterior) issues.push({ level: 'error', where, msg: `${id} er ikke en yttervegg` });
          else if (z.levelId != null && w.levelId !== z.levelId) issues.push({ level: 'error', where, msg: `${id} står på nivået «${w.levelId}», ikke «${z.levelId}»` });
          ws.push(id);
        }
      }
    }
    for (const k of ['from', 'to']) if (z[k] != null && !num(z[k])) issues.push({ level: 'error', where, msg: `${k} må være et tall (meter over etasjens gulv)` });
    const from = num(z.from) ? z.from : null;
    const to = num(z.to) ? z.to : null;
    if (from !== null && to !== null && !(to > from + 1e-6)) issues.push({ level: 'error', where, msg: `to (${to}) må være høyere enn from (${from})` });
    if (z.gable != null && typeof z.gable !== 'boolean') issues.push({ level: 'error', where, msg: 'gable må være true eller false' });
    const f = fillFinish(z, def, where, issues);
    if (!f) return;
    zones.push({ id: z.id ?? `sone-${i + 1}`, name: z.name ?? '', levelId: z.levelId ?? null, walls: ws, from, to, gable: z.gable === true, ...f });
  });

  let plinth = null;
  if (raw.plinth != null) {
    const p = raw.plinth;
    const where = 'cladding.plinth';
    if (!isObj(p)) issues.push({ level: 'error', where, msg: 'må være et objekt { height, color, material }' });
    else {
      unknownKeys(p, KNOWN.plinth, where, issues);
      let material = p.material ?? CLADDING_DEFAULTS.plinth.material;
      if (!PLINTH_MATERIALS.includes(material)) {
        issues.push({ level: 'error', where, msg: `material «${material}» er ikke en av ${PLINTH_MATERIALS.join(', ')}` });
        material = CLADDING_DEFAULTS.plinth.material;
      }
      let height = p.height ?? CLADDING_DEFAULTS.plinth.height;
      if (!(num(height) && height >= 0 && height <= 3)) {
        issues.push({ level: 'error', where, msg: `height må være et tall mellom 0 og 3 (meter fra bakken opp til kledningen)` });
        height = CLADDING_DEFAULTS.plinth.height;
      }
      let color = p.color ?? CLADDING_DEFAULTS.plinth.color[material];
      if (typeof color !== 'string' || !HEX.test(color)) {
        issues.push({ level: 'error', where, msg: `color «${color}» må være en hex-farge` });
        color = CLADDING_DEFAULTS.plinth.color[material];
      }
      plinth = { height, material, color: color.toLowerCase() };
    }
  }

  let trim = null;
  if (raw.trim != null) {
    const t = raw.trim;
    const where = 'cladding.trim';
    if (!isObj(t)) issues.push({ level: 'error', where, msg: 'må være et objekt { color, corners, surrounds }' });
    else {
      unknownKeys(t, KNOWN.trim, where, issues);
      let color = t.color ?? def.color;
      if (typeof color !== 'string' || !HEX.test(color)) {
        issues.push({ level: 'error', where, msg: `color «${color}» må være en hex-farge` });
        color = def.color;
      }
      for (const k of ['corners', 'surrounds']) if (t[k] != null && typeof t[k] !== 'boolean') issues.push({ level: 'error', where, msg: `${k} må være true eller false` });
      trim = { color: color.toLowerCase(), corners: t.corners !== false, surrounds: t.surrounds !== false, ...CLADDING_DEFAULTS.trim };
    }
  }

  const groundY = groundLevel(levels, mainLevelId);
  const below = new Set(levels.filter((l) => num(l.floorY) && l.floorY < mainY - 0.5).map((l) => l.id));
  const cladding = { default: def, basement: { ...CLADDING_DEFAULTS.basement }, zones, plinth, trim, groundY, mainY, belowMain: [...below] };
  // a gable zone on walls without a gable, a zone that names a level below the main floor … are only noticed by the builder
  return { cladding, issues };
}

/** Does zone z apply to a wall of level levelId with id wallId? */
export function zoneApplies(z, levelId, wallId) {
  if (z.levelId !== null && z.levelId !== levelId) return false;
  if (z.walls && !z.walls.includes(wallId)) return false;
  return true;
}

/**
 * The finish at height y (metres over the level's floor) of a wall: the last zone that applies (level, walls, from ≤ y
 * < to, gable: only above the wall's gable line), else the default – or plaster on a level under the main floor.
 * @param {object} cl  resolved cladding
 * @param {{ levelId: string, wallId: string, y: number, gableY?: number|null }} at
 */
export function finishAt(cl, { levelId, wallId, y, gableY = null }) {
  for (let i = cl.zones.length - 1; i >= 0; i--) {
    const z = cl.zones[i];
    if (!zoneApplies(z, levelId, wallId)) continue;
    if (z.from !== null && y < z.from - 1e-9) continue;
    if (z.to !== null && y >= z.to - 1e-9) continue;
    if (z.gable && !(gableY !== null && y > gableY + 1e-9)) continue;
    return z;
  }
  return cl.belowMain.includes(levelId) ? cl.basement : cl.default;
}

/**
 * The heights (over the level's floor) where the finish of a wall can change: the zones' from / to, the gable line
 * (when a gable zone applies to the wall), the top of the plinth (plinthTop, already in the wall's level frame).
 * Sorted, without duplicates.
 */
export function wallCuts(cl, { levelId, wallId, gableY = null, plinthTop = null }) {
  const ys = new Set();
  for (const z of cl.zones) {
    if (!zoneApplies(z, levelId, wallId)) continue;
    if (z.from !== null) ys.add(z.from);
    if (z.to !== null) ys.add(z.to);
    if (z.gable && gableY !== null) ys.add(gableY);
  }
  if (plinthTop !== null) ys.add(plinthTop);
  return [...ys].sort((a, b) => a - b).filter((y, i, a) => i === 0 || y - a[i - 1] > 1e-6);
}

/** A string that is equal for two finishes that look the same (type, profile, direction, colour, module). */
export function finishKey(f) {
  if (!f) return '';
  if (f.plinth) return `plinth|${f.material}|${f.color}`;
  return `${f.type}|${f.type === 'wood' || f.type === 'panels' ? f.direction : ''}|${f.profile ?? ''}|${f.color}|${f.module ? f.module.join('x') : ''}`;
}

/** The plinth as a finish (for finishKey / the builder): { plinth: true, type, material, color }. */
export function plinthFinish(cl) {
  if (!cl?.plinth) return null;
  const p = cl.plinth;
  return { plinth: true, type: p.material === 'concrete' ? 'concrete' : p.material, direction: 'vertical', profile: null, module: null, material: p.material, color: p.color };
}
