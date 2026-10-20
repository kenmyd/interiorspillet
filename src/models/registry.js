import { archetypes as seating } from './seating.js';
import { archetypes as tables } from './tables.js';
import { archetypes as lamps } from './lamps.js';
import { archetypes as textiles } from './textiles.js';
import { archetypes as decor } from './decor.js';
import { blockout, finishModel, roundedBox, partMesh } from './kit.js';
import { mat } from '../home/materials.js';
import { products } from '../catalog/index.js';
import schema from '../data/archetypes.json';
import * as THREE from 'three';

/**
 * Model registry (ARCHITECTURE §5): every archetype of seating/tables/lamps/textiles/decor in one table, and
 * buildModel() which merges an item spec with the archetype defaults and calls its builder.
 *
 *   ARCHETYPES                       { id: Def } (frozen)
 *   getArchetype(id) → Def|null
 *   mergeSpec(def|null, spec) → spec { archetype, dims, params, colors, materials, quality }   (defaults merged)
 *   buildModel(spec) → THREE.Group   never throws: a missing archetype or a throwing builder gives a grey box
 *                                    (console.warn once per archetype) with userData.model.fallback = true
 *   archetypesFor(category) → id[]   archetypes used in a catalogue category (or an extra furniture category)
 *   setModelQuality('low'|'medium'|'high')  default spec.quality for builders (createHome sets it)
 *
 * The returned group carries userData.archetype, userData.spec (the merged spec) and userData.model
 * ({ parts, lights, surfaces, seatY? } – see kit.finishModel).
 */

const SOURCES = { seating, tables, lamps, textiles, decor };

/** All archetypes (later files win on a duplicate id, with a warning). */
export const ARCHETYPES = (() => {
  const out = {};
  for (const [file, defs] of Object.entries(SOURCES)) {
    for (const [id, def] of Object.entries(defs || {})) {
      if (out[id]) console.warn(`[registry] archetype «${id}» defined twice (also in ${file}.js)`);
      out[id] = def;
    }
  }
  return Object.freeze(out);
})();

let QUALITY = 'medium';

/** Default model quality passed to builders as spec.quality. */
export function setModelQuality(level) {
  if (level === 'low' || level === 'medium' || level === 'high') QUALITY = level;
}

/** @returns {object|null} the archetype definition */
export function getArchetype(id) {
  return ARCHETYPES[id] || null;
}

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

/**
 * Item spec merged with the archetype defaults (one level deep per field; arrays/objects inside params are taken
 * from the spec as a whole).
 * @param {object|null} def
 * @param {{ archetype?: string, dims?: object, params?: object, colors?: object, materials?: object, quality?: string }} spec
 * @returns {{ archetype: string, dims: {w:number,d:number,h:number}, params: object, colors: object, materials: object, quality: string }}
 */
export function mergeSpec(def, spec = {}) {
  const d = def?.defaults || {};
  const dims = { w: 0.5, d: 0.5, h: 0.5, ...(d.dims || {}) };
  for (const k of ['w', 'd', 'h']) {
    const v = spec.dims?.[k];
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) dims[k] = v;
  }
  return {
    archetype: spec.archetype,
    dims,
    params: { ...clone(d.params || {}), ...clone(isObj(spec.params) ? spec.params : {}) },
    colors: { ...(d.colors || {}), ...(isObj(spec.colors) ? spec.colors : {}) },
    materials: { ...(d.materials || {}), ...(isObj(spec.materials) ? spec.materials : {}) },
    quality: spec.quality || QUALITY,
  };
}

const _warned = new Set();

/**
 * Builds the model of an item spec. Never throws.
 * @param {{ archetype: string, dims?: object, params?: object, colors?: object, materials?: object, quality?: string }} spec
 * @returns {THREE.Group}
 */
export function buildModel(spec) {
  const id = spec?.archetype;
  const def = getArchetype(id);
  const full = mergeSpec(def, spec || {});
  if (!def) {
    warnOnce(id, `[registry] unknown archetype «${id}» – showing a grey box`);
    return fallbackModel(full, id);
  }
  let group;
  try {
    group = def.build(full);
    if (!group || !group.isObject3D) throw new Error('builder returned no Object3D');
  } catch (err) {
    warnOnce(`${id}:build`, `[registry] builder for «${id}» failed – showing a grey box`, err);
    return fallbackModel(full, id, def);
  }
  if (!group.userData.model) finishModel(group, { merge: false });
  group.userData.model.parts ||= {};
  group.userData.model.lights ||= [];
  group.userData.model.surfaces ||= [];
  group.userData.archetype = id;
  group.userData.spec = full;
  return group;
}

function warnOnce(key, msg, err) {
  if (_warned.has(key)) return;
  _warned.add(key);
  if (err) console.warn(msg, err);
  else console.warn(msg);
}

/** Grey box in the mount's origin convention (still recolourable as part 'body'). */
function fallbackModel(full, id, def) {
  const info = schema.archetypes[id];
  const mount = def?.mount || info?.mount || 'floor';
  let g;
  try {
    if (info) g = blockout(full, { archetype: id, family: info.family, mount });
  } catch {
    g = null;
  }
  if (!g) {
    const { w, d, h } = full.dims;
    g = new THREE.Group();
    const y = mount === 'wall' ? 0 : mount === 'ceiling' ? -h / 2 : h / 2;
    g.add(partMesh(roundedBox(w, h, d, Math.min(0.01, w / 4, h / 4, d / 4), 1), mat('plastic', '#9a9a9a'), 'body', { position: [0, y, mount === 'wall' ? d / 2 : 0] }));
    finishModel(g, { merge: false });
  }
  g.userData.model.fallback = true;
  g.userData.archetype = id;
  g.userData.spec = full;
  return g;
}

const EXTRA = {
  sofa: ['sofa-modular-l', 'sofa-curved', 'sofa-straight'],
  bord: ['coffee-table-rect', 'coffee-table-round-nesting', 'dining-table-oval'],
  stoler: ['dining-chair', 'bar-stool'],
  elektronikk: ['tv', 'speaker'],
  hylle: ['wall-shelf'],
};

/**
 * Archetypes that occur in a category (catalogue order; extra furniture categories from catalog/index.js).
 * @param {string} category
 * @returns {string[]}
 */
export function archetypesFor(category) {
  if (EXTRA[category]) return [...EXTRA[category]];
  const ids = [];
  for (const p of products(category)) if (p.archetype && !ids.includes(p.archetype)) ids.push(p.archetype);
  return ids;
}
