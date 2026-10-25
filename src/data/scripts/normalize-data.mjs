#!/usr/bin/env node
/**
 * Data normaliser: research/* → src/data/*.
 *
 *   node src/data/scripts/normalize-data.mjs [--only=catalog|room-spec|palette|walls,…] [--out=<dir>] [--verbose]
 *   (run from the project root; --out writes the files to another folder instead of src/data – e.g. to diff them)
 *
 * - room-spec.json: research/room-spec.json (the living room) with every research/house/NN-*.json merged in and the
 *   whole house validated (house.mjs: mergeHouse + validateHouse, which throws on errors – nothing is written then;
 *   00-ids.json is the id register and schema, not merged), then fixes.mjs; the measuring list (every `estimated`
 *   field) goes into the generated «Målelista» section of research/room-spec-notes.md. Never edit it by hand.
 * - palette.json: copied (validated as JSON).
 * - catalog/<key>.json: unique ids, dims in metres, archetype mapped to a known one, colour/material keys renamed to
 *   the canonical part names (ARCHITECTURE §13) and filled for every part of the archetype family, material kinds
 *   mapped to the known kinds (§4), numeric strings → numbers, "mount" added from the archetype.
 *   Sources: research/catalog/<key>.json, then every research/catalog-new/*.json (newer research rounds, e.g.
 *   taklampe-secto.json, lenestol-ny.json, vitrineskap.json): each product goes to its own `category` (else the file
 *   name before the first «-»), appended after the older products – a product with an id that already exists
 *   replaces the old one in place (the newer research wins). Products in fixes.mjs CATEGORY_MOVES move to their new
 *   category (the round-1 mirrors: Smått → Speil). Families bed/fixture keep only the parts their archetype lists.
 * - wall-proposals.json: research/wall-proposals.json + wall-proposals-new.json merged into
 *   { …, acousticModel, wallFacts, proposals }, image paths rewritten to the public copies.
 *
 * Not imported by the game (Vite never bundles it). Re-run it whenever the research files change.
 * fixes.mjs is applied last (room-spec colours/decor, catalogue variant prices, names …), so its corrections survive.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fixRoomSpec, fixCatalog, CATEGORY_MOVES } from './fixes.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../..');
const RESEARCH = path.join(ROOT, 'research');
const DATA = path.join(ROOT, 'src', 'data');

const argValue = (name) => {
  const a = process.argv.find((x) => x.startsWith(`--${name}=`));
  return a ? a.slice(name.length + 3) : null;
};
/** Output folder (default src/data). */
const OUT = argValue('out') ? path.resolve(argValue('out')) : DATA;
/** Which outputs to write (default: all). */
const ONLY = argValue('only') ? new Set(argValue('only').split(',').map((s) => s.trim())) : null;
const wants = (what) => !ONLY || ONLY.has(what);

const SCHEMA = readJson(path.join(DATA, 'archetypes.json'));
/** Catalogue categories in catalogue order (catalog/index.js CATEGORIES). */
export const CATEGORY_KEYS = [
  'sofa', 'lenestol', 'bord', 'stoler', 'skjenk', 'tvbenk', 'vitrineskap', 'hylle', 'seng', 'nattbord', 'kommode', 'garderobe', 'speil', 'bad', 'gang',
  'taklampe', 'smalamper', 'tekstil', 'teppe', 'solskjerming', 'akustikk', 'smatt',
];
const VALID_MATERIALS = new Set(Object.values(SCHEMA.materials).flat());
const FABRIC_MATERIALS = new Set(SCHEMA.materials.fabric);

const log = [];
const note = (msg) => log.push(msg);

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

// ---------------------------------------------------------------------------------------------------------------
// Generic helpers

const NUMERIC = /^\s*-?\d+(?:[.,]\d+)?\s*$/;

/** Recursively converts numeric strings ("0,45", "12") to numbers. */
function numbersAreNumbers(value) {
  if (typeof value === 'string' && NUMERIC.test(value)) return Number(value.replace(',', '.'));
  if (Array.isArray(value)) return value.map(numbersAreNumbers);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = numbersAreNumbers(v);
    return out;
  }
  return value;
}

function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex([r, g, b]) {
  const c = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

/** Multiplies a colour's brightness (factor < 1 darkens, > 1 lightens toward white). */
function shade(hex, factor) {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  if (factor <= 1) return rgbToHex(rgb.map((v) => v * factor));
  const t = Math.min(1, factor - 1);
  return rgbToHex(rgb.map((v) => v + (255 - v) * t));
}

function normHex(hex, fallback) {
  const rgb = hexToRgb(hex);
  return rgb ? rgbToHex(rgb) : fallback;
}

function luminance(hex) {
  const rgb = hexToRgb(hex) || [128, 128, 128];
  return (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255;
}

function saturation(hex) {
  const rgb = hexToRgb(hex) || [128, 128, 128];
  const max = Math.max(...rgb);
  const min = Math.min(...rgb);
  return max === 0 ? 0 : (max - min) / max;
}

/** Maps a research material value to one of the known material kinds (ARCHITECTURE §4). */
function mapMaterial(kind, colorHex, where) {
  if (kind == null) return null;
  const raw = String(kind).trim().toLowerCase();
  if (VALID_MATERIALS.has(raw)) return raw;
  let mapped = SCHEMA.materialAliases[raw];
  if (raw === 'marble') mapped = luminance(colorHex) < 0.45 ? 'marble-dark' : 'marble-white';
  if (raw === 'alu' || raw === 'aluminium') {
    // Bare/anodised aluminium (light neutral grey) reads as metal; coloured slats are powder-coated paint.
    const l = luminance(colorHex);
    mapped = saturation(colorHex) < 0.06 && l > 0.55 && l < 0.85 ? 'steel' : 'painted';
  }
  if (!mapped) {
    mapped = raw.includes('metal') ? 'black-metal' : raw.includes('glass') ? 'glass-clear' : raw.includes('oak') ? 'oak' : 'plastic';
  }
  note(`material ${where}: "${kind}" → "${mapped}"`);
  return mapped;
}

function mapArchetype(archetype, where) {
  const raw = String(archetype || '').trim();
  if (SCHEMA.archetypes[raw]) return raw;
  const alias = SCHEMA.archetypeAliases[raw];
  if (alias) {
    note(`archetype ${where}: "${raw}" → "${alias}"`);
    return alias;
  }
  throw new Error(`Unknown archetype "${raw}" at ${where}`);
}

// ---------------------------------------------------------------------------------------------------------------
// Part normalisation per family. Each function takes the variant's colours/materials (research keys) and returns
// canonical { colors, materials, params } (params = pattern colours that have no canonical part).

const DEFAULT_MATERIAL = {
  upholstery: 'woven', legs: 'black-metal', frame: 'oak', piping: 'woven',
  body: 'oak', front: 'oak', top: 'oak', handle: 'black-metal',
  shade: 'linen', inner: 'linen', base: 'black-metal', metal: 'black-metal', cord: 'cotton',
  fabric: 'woven', accent: 'wool', accent2: 'wool',
  slat: 'painted', rail: 'painted',
  leaves: 'plant-leaf', pot: 'ceramic', trunk: 'plastic',
  flowers: 'plant-leaf', print: 'paper',
  panel: 'felt', slats: 'oak', backing: 'felt',
};

/**
 * Builds canonical colours/materials from a mapping table: target part → list of source keys (first present wins)
 * or a function (colors) → hex for derived defaults. Source keys consumed by a target are not moved to params.
 */
function remapParts(src, plan, { family, archetype, where, keepExtra = [] }) {
  const colors = {};
  const materials = {};
  const used = new Set();
  const srcColors = src.colors || {};
  const srcMaterials = src.materials || {};
  for (const [part, rule] of Object.entries(plan)) {
    let hex = null;
    let mat = null;
    for (const key of rule.from || []) {
      if (srcColors[key] != null || srcMaterials[key] != null) {
        hex = srcColors[key] ?? null;
        mat = srcMaterials[key] ?? null;
        used.add(key);
        if (hex) break;
      }
    }
    if (!hex && rule.derive) hex = rule.derive(colors, srcColors);
    if (!mat && rule.deriveMaterial) mat = rule.deriveMaterial(materials, srcMaterials);
    if (!hex) continue; // optional part without a source
    colors[part] = normHex(hex, '#888888');
    materials[part] = mapMaterial(mat || DEFAULT_MATERIAL[part] || 'plastic', colors[part], `${where}.${part}`);
  }
  // Leftover keys: optional canonical parts stay as parts, pure pattern colours move to params.
  const params = {};
  for (const key of new Set([...Object.keys(srcColors), ...Object.keys(srcMaterials)])) {
    if (used.has(key) || colors[key]) continue;
    if (keepExtra.includes(key)) {
      if (srcColors[key]) colors[key] = normHex(srcColors[key], '#888888');
      if (srcColors[key] || srcMaterials[key]) {
        materials[key] = mapMaterial(srcMaterials[key] || DEFAULT_MATERIAL[key] || 'plastic', colors[key], `${where}.${key}`);
      }
      continue;
    }
    if (srcColors[key]) params[`${key}Color`] = normHex(srcColors[key], '#888888');
    if (srcMaterials[key]) params[`${key}Material`] = mapMaterial(srcMaterials[key], srcColors[key], `${where}.${key}`);
    note(`part ${where}: "${key}" has no canonical part in family ${family} (${archetype}) → params.${key}Color`);
  }
  return { colors, materials, params };
}

const pick = (...keys) => ({ from: keys });

/** Keeps only the parts an archetype lists (archetypes.json `parts`), plus the family's optional parts the data names. */
function onlyParts(archetype, plan) {
  const parts = SCHEMA.archetypes[archetype]?.parts;
  if (!parts) return plan;
  return Object.fromEntries(Object.entries(plan).filter(([k, rule]) => parts.includes(k) || !rule.derive));
}

function partPlan(family, archetype) {
  const sameAs = (part) => (c) => c[part];
  const sameMat = (part) => (m) => m[part];
  switch (family) {
    case 'seating': {
      const plan = {
        upholstery: { ...pick('upholstery', 'fabric', 'main', 'cover', 'seat'), derive: () => '#9a9086' },
        legs: { ...pick('legs', 'base', 'feet', 'foot'), derive: (c, s) => s.frame || '#1c1c1c' },
      };
      const archParts = SCHEMA.archetypes[archetype].parts || [];
      plan.frame = { ...pick('frame', 'wood') };
      if (archParts.includes('frame')) {
        plan.frame.derive = sameAs('legs');
        plan.frame.deriveMaterial = sameMat('legs');
      }
      plan.piping = { ...pick('piping') };
      return plan;
    }
    case 'table':
    case 'storage': // vitrineskap: korpus, dører (front), topplate, understell (legs), grep – the same keys as a sideboard
      return {
        body: { ...pick('body', 'frame', 'base', 'carcass'), derive: (c, s) => s.legs || s.top || '#5a4232' },
        front: { ...pick('front', 'doors'), derive: sameAs('body'), deriveMaterial: sameMat('body') },
        top: { ...pick('top'), derive: sameAs('body'), deriveMaterial: sameMat('body') },
        legs: { ...pick('legs'), derive: sameAs('body'), deriveMaterial: sameMat('body') },
        handle: { ...pick('handle', 'handles'), derive: sameAs('legs'), deriveMaterial: sameMat('legs') },
      };
    case 'lamp':
      return {
        shade: { ...pick('shade', 'glass', 'main'), derive: () => '#e8e1d3' },
        metal: { ...pick('metal', 'frame', 'arm'), derive: (c, s) => s.base || '#1c1c1c' },
        base: { ...pick('base', 'stand', 'foot'), derive: sameAs('metal'), deriveMaterial: sameMat('metal') },
        inner: {
          ...pick('inner', 'lining'),
          derive: (c) => c.shade,
          deriveMaterial: (m) => m.shade,
        },
        cord: { ...pick('cord', 'wire', 'cable'), derive: () => '#1a1a1a', deriveMaterial: () => 'cotton' },
      };
    case 'textile':
      return {
        fabric: { ...pick('fabric', 'main', 'upholstery', 'cover'), derive: () => '#d6c9b4' },
        piping: { ...pick('piping', 'edge', 'trim'), derive: sameAs('fabric'), deriveMaterial: sameMat('fabric') },
        legs: { ...pick('legs') },
      };
    case 'rug':
      return {
        base: { ...pick('base', 'main', 'ground'), derive: () => '#c4c2bf' },
        accent: { ...pick('accent', 'accent1', 'fleck1', 'pattern'), derive: (c) => shade(c.base, 0.8), deriveMaterial: sameMat('base') },
        accent2: { ...pick('accent2', 'fleck2', 'border'), derive: (c) => shade(c.base, 1.12), deriveMaterial: sameMat('base') },
      };
    case 'shading':
      return {
        slat: { ...pick('slat', 'slats', 'vane', 'vanes') },
        fabric: { ...pick('fabric', 'tape'), derive: (c) => c.slat || '#e9e4d9', deriveMaterial: (m) => (m.slat ? 'woven' : null) },
        rail: { ...pick('rail', 'cassette', 'headrail', 'rod', 'track'), derive: () => '#e6e6e3' },
        // A missing slat colour (fabric archetypes) is filled from the fabric in normaliseVariant().
      };
    case 'plant':
      return {
        leaves: { ...pick('leaves', 'foliage', 'main'), derive: () => '#4f6b3a' },
        pot: { ...pick('pot', 'planter', 'base'), derive: () => '#e8e4dc' },
        trunk: { ...pick('trunk', 'stem') },
      };
    case 'object':
      return {
        body: { ...pick('body', 'main', 'frame', 'glass'), derive: () => '#cfc6b8' },
        flowers: { ...pick('flowers', 'stems') },
      };
    case 'framed':
      return {
        print: { ...pick('print', 'canvas', 'motif', 'glass', 'main'), derive: () => '#d6c8b4' },
        frame: { ...pick('frame', 'edge'), derive: (c) => shade(c.print, 0.35), deriveMaterial: () => 'painted' },
      };
    case 'acoustic':
      if (archetype === 'slat-panel') {
        return {
          slats: { ...pick('slats', 'wood', 'slat'), derive: () => '#b08b62' },
          backing: { ...pick('backing', 'felt'), derive: () => '#1b1b1b', deriveMaterial: () => 'felt' },
          panel: { from: [], derive: sameAs('backing'), deriveMaterial: sameMat('backing') },
          frame: { ...pick('frame', 'edge'), derive: sameAs('slats'), deriveMaterial: sameMat('slats') },
        };
      }
      return {
        panel: { ...pick('panel', 'fabric', 'motif', 'felt', 'main'), derive: () => '#c8bba5' },
        backing: { ...pick('backing'), derive: (c) => shade(c.panel, 0.6), deriveMaterial: () => 'felt' },
        frame: { ...pick('frame', 'edge', 'rod'), derive: sameAs('panel'), deriveMaterial: sameMat('panel') },
        slats: { ...pick('slats'), derive: sameAs('panel'), deriveMaterial: sameMat('panel') },
      };
    case 'bed':
      // beds and headboards (hele huset): frame = the base/side rails (fabric or wood), bedding = duvet/pillows (shown made)
      return onlyParts(archetype, {
        frame: { ...pick('frame', 'base', 'body', 'upholstery'), derive: () => '#8f8a84', deriveMaterial: () => 'woven' },
        headboard: { ...pick('headboard', 'gavl'), derive: (c, s) => c.frame || s.frame || '#8f8a84', deriveMaterial: (m, s) => m.frame || s.frame || 'woven' },
        legs: { ...pick('legs', 'feet'), derive: () => '#5a4232', deriveMaterial: () => 'oak' },
        bedding: { ...pick('bedding', 'duvet', 'linen'), derive: () => '#f1eee8', deriveMaterial: () => 'cotton' },
        throw: { ...pick('throw', 'bedspread', 'runner') },
      });
    case 'fixture':
      // towel ladders/rails, coat racks/stands, bath accessories: body + details (+ the textiles they show)
      return onlyParts(archetype, {
        body: { ...pick('body', 'main', 'frame', 'wood'), derive: () => '#cfc6b8', deriveMaterial: () => 'oak' },
        accent: { ...pick('accent', 'hooks', 'pump', 'metal'), derive: sameAs('body'), deriveMaterial: sameMat('body') },
        fabric: { ...pick('fabric', 'towels', 'coats', 'textile'), derive: () => '#e9e4da', deriveMaterial: () => 'cotton' },
      });
    default:
      throw new Error(`No part plan for family ${family}`);
  }
}

function normaliseVariant(variant, product, family, where) {
  const plan = partPlan(family, product.archetype);
  const keepExtra = [...(SCHEMA.families[family].optionalParts || [])];
  const res = remapParts(variant, plan, { family, archetype: product.archetype, where, keepExtra });
  if (family === 'shading' && !res.colors.slat) {
    res.colors.slat = res.colors.fabric;
    res.materials.slat = res.materials.fabric;
  }
  // A venetian blind with both a tape and a fabric: the tape colour is a detail colour.
  if (family === 'shading' && variant.colors?.tape && variant.colors?.fabric) res.params.tapeColor = normHex(variant.colors.tape);
  // Order colours the way the family lists its parts (Inspector order), extras last.
  const order = [...SCHEMA.families[family].parts, ...keepExtra];
  const sortKeys = (obj) => Object.fromEntries(Object.entries(obj).sort(([a], [b]) => idx(order, a) - idx(order, b)));
  const out = { name: String(variant.name || 'Standard').trim(), colors: sortKeys(res.colors), materials: sortKeys(res.materials) };
  for (const [k, v] of Object.entries(variant)) {
    if (!['name', 'colors', 'materials'].includes(k)) out[k] = numbersAreNumbers(v);
  }
  if (Object.keys(res.params).length) out.params = res.params;
  return out;
}

function idx(list, key) {
  const i = list.indexOf(key);
  return i < 0 ? 999 : i;
}

// ---------------------------------------------------------------------------------------------------------------
// Catalog

const SUBCATEGORY_FROM_ARCHETYPE = {
  // only filled where the product has none: recliners are «hvilestol», every pendant «pendel» (so «Bytt modell» on a
  // new Secto pendant flips through all pendants, not only the ones whose research named a subcategory)
  lenestol: { recliner: 'hvilestol' },
  taklampe: {
    'pendant-dome': 'pendel', 'pendant-globe': 'pendel', 'pendant-cylinder': 'pendel', 'pendant-linear': 'pendel',
    'pendant-multi': 'pendel', 'pendant-tiered': 'pendel', 'pendant-woven': 'pendel', 'pendant-mushroom': 'pendel',
    'pendant-slatted': 'pendel', 'pendant-felt': 'pendel',
  },
  solskjerming: {
    curtain: 'gardin', venetian: 'persienne', roller: 'rullegardin', pleated: 'plissé', 'duo-roller': 'duo-rullegardin',
    vertical: 'lamellgardin', roman: 'liftgardin', 'exterior-screen': 'utvendig screen',
  },
  akustikk: {
    'slat-panel': 'spilepanel', 'fabric-panel': 'tekstilpanel', 'acoustic-art': 'akustikkbilde', 'felt-shape': 'filtform',
    'ceiling-absorber': 'takabsorbent',
  },
};

/** Dimensions → metres. Values > 10 are taken as centimetres, > 400 as millimetres. */
function toMetres(dims, where) {
  const out = {};
  for (const axis of ['w', 'd', 'h']) {
    let v = Number(typeof dims?.[axis] === 'string' ? dims[axis].replace(',', '.') : dims?.[axis]);
    if (!Number.isFinite(v) || v <= 0) {
      note(`dims ${where}.${axis} missing → 0.05`);
      v = 0.05;
    }
    if (v > 400) {
      note(`dims ${where}.${axis} ${v} mm → m`);
      v /= 1000;
    } else if (v > 10) {
      note(`dims ${where}.${axis} ${v} cm → m`);
      v /= 100;
    }
    out[axis] = Math.round(v * 10000) / 10000;
  }
  for (const [k, v] of Object.entries(dims || {})) if (!(k in out)) out[k] = numbersAreNumbers(v);
  return out;
}

const PRODUCT_FIELD_ORDER = [
  'id', 'category', 'subcategory', 'name', 'brand', 'store', 'url', 'priceNok', 'salePriceNok', 'priceFromNok', 'priceNote',
  'dims', 'archetype', 'mount', 'params', 'variants', 'defaultVariant', 'absorption', 'light', 'description', 'why', 'imageUrl',
  'verified', 'verifiedNote',
];

const productList = (raw) => (Array.isArray(raw) ? raw : raw?.products || raw?.items || []);

/**
 * Research products per category: research/catalog/<key>.json first, then research/catalog-new/*.json (sorted by
 * file name) – a newer product with the same id replaces the older one in place, other new ones are appended.
 * @returns {Map<string, object[]>}
 */
function researchProducts() {
  const byCat = new Map(CATEGORY_KEYS.map((k) => [k, []]));
  for (const key of CATEGORY_KEYS) {
    const file = path.join(RESEARCH, 'catalog', `${key}.json`);
    if (fs.existsSync(file)) byCat.get(key).push(...productList(readJson(file)));
  }
  const dir = path.join(RESEARCH, 'catalog-new');
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort() : [];
  for (const f of files) {
    const fallback = f.replace(/\.json$/, '').split('-')[0];
    for (const src of productList(readJson(path.join(dir, f)))) {
      const key = String(src.category || fallback).trim();
      if (!byCat.has(key)) throw new Error(`research/catalog-new/${f}: unknown category «${key}» (${src.id})`);
      const list = byCat.get(key);
      const i = src.id ? list.findIndex((p) => String(p.id).trim().toLowerCase() === String(src.id).trim().toLowerCase()) : -1;
      if (i >= 0) {
        note(`catalog-new/${f}: ${src.id} replaces the older research product`);
        list[i] = src;
      } else list.push(src);
    }
  }
  // products that changed category (fixes.mjs CATEGORY_MOVES, e.g. the mirrors from Smått to Speil) keep their place order
  for (const [id, to] of Object.entries(CATEGORY_MOVES || {})) {
    for (const [key, list] of byCat) {
      const i = list.findIndex((p) => String(p.id).trim().toLowerCase() === id);
      if (i < 0 || key === to) continue;
      const [p] = list.splice(i, 1);
      byCat.get(to).push({ ...p, category: to });
      note(`moved ${id}: ${key} → ${to}`);
    }
  }
  return byCat;
}

/**
 * Mount of a product: the archetype's mount, or another mount the archetype allows (`mounts`) when the research says
 * so (product.mount, or params.base 'wall' = wall-hung). Floor vases share the bottom-centre origin with 'surface'.
 */
function productMount(p, def) {
  const allowed = Array.isArray(def.mounts) ? def.mounts : [def.mount];
  if (p.archetype === 'vase' && p.params?.floor === true) return 'floor';
  if (allowed.length > 1) {
    if (allowed.includes('wall') && p.params?.base === 'wall') return 'wall';
    if (allowed.includes(p.mount)) return p.mount;
  }
  return def.mount;
}

function normaliseCatalog() {
  const seen = new Set();
  const counts = {};
  const sources = researchProducts();
  for (const key of CATEGORY_KEYS) {
    const list = sources.get(key) || [];
    const out = [];
    for (const src of list) {
      const p = numbersAreNumbers({ ...src });
      // Unique ids (slug-safe).
      let id = String(p.id || `${key}-${out.length + 1}`).trim().toLowerCase().replace(/[^a-z0-9æøå-]+/g, '-');
      if (seen.has(id)) {
        let n = 2;
        while (seen.has(`${id}-${n}`)) n++;
        note(`duplicate id ${id} → ${id}-${n}`);
        id = `${id}-${n}`;
      }
      seen.add(id);
      p.id = id;
      p.category = key;
      const where = `${key}/${id}`;
      p.archetype = mapArchetype(p.archetype, where);
      const def = SCHEMA.archetypes[p.archetype];
      p.params = p.params && typeof p.params === 'object' ? p.params : {};
      const mount = productMount(p, def);
      if (p.mount != null && p.mount !== mount) note(`mount ${where}: "${p.mount}" → "${mount}" (archetype ${p.archetype})`);
      p.mount = mount;
      p.dims = toMetres(p.dims, where);
      if (!p.subcategory && SUBCATEGORY_FROM_ARCHETYPE[key]?.[p.archetype]) p.subcategory = SUBCATEGORY_FROM_ARCHETYPE[key][p.archetype];
      const variants = Array.isArray(p.variants) && p.variants.length ? p.variants : [{ name: 'Standard', colors: {}, materials: {} }];
      p.variants = variants.map((v, i) => normaliseVariant(v, p, def.family, `${where}#${i}`));
      p.defaultVariant = Number.isInteger(p.defaultVariant) && p.defaultVariant >= 0 && p.defaultVariant < p.variants.length ? p.defaultVariant : 0;
      for (const f of ['priceNok', 'salePriceNok', 'priceFromNok', 'absorption']) {
        if (p[f] != null && typeof p[f] !== 'number') {
          const n = Number(String(p[f]).replace(/[^\d.,-]/g, '').replace(',', '.'));
          p[f] = Number.isFinite(n) ? n : null;
        }
      }
      if (typeof p.absorption !== 'number' || !Number.isFinite(p.absorption)) p.absorption = 0;
      if (p.priceNok == null) p.priceNok = p.priceFromNok ?? null;
      p.verified = p.verified === true;
      const ordered = {};
      for (const f of PRODUCT_FIELD_ORDER) if (p[f] !== undefined) ordered[f] = p[f];
      for (const [f, v] of Object.entries(p)) if (!(f in ordered)) ordered[f] = v;
      out.push(ordered);
    }
    // corrections on top of the research data (variant prices, names, mounts … – see fixes.mjs)
    writeJson(path.join(OUT, 'catalog', `${key}.json`), fixCatalog(key, out));
    counts[key] = out.length;
  }
  return counts;
}

// ---------------------------------------------------------------------------------------------------------------
// Wall proposals

function normaliseProposals() {
  const a = readJson(path.join(RESEARCH, 'wall-proposals.json'));
  const b = readJson(path.join(RESEARCH, 'wall-proposals-new.json'));
  const all = [...(a.proposals || []), ...(Array.isArray(b) ? b : b.proposals || [])];
  const byCode = new Map();
  for (const p of all) byCode.set(String(p.code ?? p.id), p); // later files win on a duplicate code
  const isNew = (code) => /^N\d+$/.test(code);
  const existing = [...byCode.keys()].filter((c) => !isNew(c));
  const fresh = [...byCode.keys()].filter(isNew).sort((x, y) => Number(x.slice(1)) - Number(y.slice(1)));
  const proposals = [...existing, ...fresh].map((code) => {
    const p = numbersAreNumbers(byCode.get(code));
    const out = { id: code, code };
    for (const [k, v] of Object.entries(p)) {
      if (k === 'id' || k === 'code' || k === 'image' || k === 'drawings') continue;
      out[k] = v;
    }
    out.image = p.image ? `img/forslag/${code}.jpg` : null;
    out.thumb = p.image ? `img/forslag/thumb/${code}.jpg` : null;
    out.imageSource = p.image || null;
    out.drawingsSource = Array.isArray(p.drawings) ? p.drawings : [];
    out.elements = Array.isArray(p.elements) ? p.elements : [];
    out.sabineAdded = typeof out.sabineAdded === 'number' ? out.sabineAdded : 0;
    return out;
  });
  const wallFacts = numbersAreNumbers(a.wallFacts);
  const merged = {
    version: 1,
    generated: a.generated,
    source: a.source,
    units: a.units,
    rankingNote: a.rankingNote,
    acousticModel: wallFacts.acousticModel,
    wallFacts,
    proposals,
  };
  writeJson(path.join(OUT, 'wall-proposals.json'), merged);
  return { proposals: proposals.length, withImage: proposals.filter((p) => p.image).length };
}

// ---------------------------------------------------------------------------------------------------------------

async function main() {
  if (OUT !== DATA) console.log(`writing to ${OUT}`);
  if (wants('room-spec')) {
    // hele huset (notes/hele-huset-design.md §1.7): research/house/NN-*.json merged in, then the whole house validated –
    // it throws on errors, so a broken house file never reaches src/data. The measuring list (every `estimated` field)
    // is the generated «Målelista» section of research/room-spec-notes.md (with --out: a copy in the out folder).
    const house = await import('./house.mjs');
    let spec;
    let report;
    try {
      spec = fixRoomSpec(house.mergeHouse(readJson(path.join(RESEARCH, 'room-spec.json')), RESEARCH, { log: note }));
      report = house.validateHouse(spec, { archetypes: SCHEMA });
    } catch (err) {
      // only the message (it lists every error, or names the house file) – not the whole report object
      console.error(`room-spec: ${err.message}\nnothing written`);
      process.exit(1);
    }
    writeJson(path.join(OUT, 'room-spec.json'), spec);
    const notesFile = path.join(RESEARCH, 'room-spec-notes.md');
    house.writeMeasureList(report, notesFile, OUT === DATA ? notesFile : path.join(OUT, 'room-spec-notes.md'));
    const inStue = (list) => (list || []).filter((e) => !e.roomId || e.roomId === house.STUE).length;
    console.log('room-spec: walls', inStue(spec.walls), 'furniture', inStue(spec.furniture), 'photoCameras', inStue(spec.photoCameras), '(stua);',
      'whole house: walls', spec.walls.length, 'furniture', spec.furniture.length, 'photoCameras', spec.photoCameras.length);
    console.log(house.formatReport(report, { verbose: process.argv.includes('--verbose') }));
  }
  if (wants('palette')) {
    const palette = readJson(path.join(RESEARCH, 'palette.json'));
    writeJson(path.join(OUT, 'palette.json'), palette);
    console.log('palette: paints', palette.paints.length, 'materials', palette.materials.length);
  }
  if (wants('catalog')) {
    const catalog = normaliseCatalog();
    console.log('catalog:', JSON.stringify(catalog), 'total', Object.values(catalog).reduce((s, n) => s + n, 0));
  }
  if (wants('walls')) console.log('wall proposals:', JSON.stringify(normaliseProposals()));
  if (process.argv.includes('--verbose')) console.log(log.join('\n'));
  else console.log(`${log.length} normalisation notes (run with --verbose to list them)`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
