import * as THREE from 'three';
import { TileableNoise, hash2, clamp, smoothstep, hashString } from '../world/proctex.js';
import palette from '../data/palette.json';

/**
 * Materials and procedural textures for the home and every model (ARCHITECTURE §4).
 *
 *   mat(kind, hex?, opts?) → THREE.Material     cached on (kind, hex, opts) – NEVER mutate or dispose it
 *   paint(colorOrName, opts?) → MeshStandardMaterial   matt wall paint ('sand' | 'marrakesh' | '#hex'), cached
 *   emissive(hex, intensity) → MeshStandardMaterial    a NEW material on every call (lights dim it per lamp)
 *   shadeMaterial(kind, hex, { glow, intensity })      a NEW textured material that glows when lit (lamp shades)
 *   resolveColor('sand'|'marrakesh'|palette name/id|'#hex') → '#rrggbb'
 *   MATERIAL_KINDS { fabric, wood, metal, stone, glass, other }, MATERIAL_LABELS { kind: 'Norsk navn' }
 *   configureMaterials({ textureRes, physical })  quality (call once before building; createHome does it)
 *   prepareMaterials(kinds, onProgress, { idle }) → Promise  textures ahead of use: from the IndexedDB cache when a
 *                                                previous visit made them, else generated (one kind per slice; idle:
 *                                                only in idle time – main.js prefetches behind the start screen)
 *   kindGroup(kind), materialOptions(group|kinds), defaultColor(kind), isTransparentKind(kind), assetUrl(path)
 *   warmupMaterials() → [{ material, instanced?, instanceColor? }]   one material per shader-program variant that
 *                                                mat()/emissive()/shadeMaterial()/ghostMaterial() can produce
 *   ghostMaterial(hex, opacity?) / placeholderMaterial(hex, transparent?)  cached flat materials (Placement ghosts,
 *                                                models whose shaders are still compiling – SceneSync)
 *
 * Shader programs: every material from this module binds map + normalMap + roughnessMap (1×1 neutral textures for
 * untextured kinds and `flat`), so textured and untextured kinds share ONE program per side/transparency instead of
 * one per feature combination (a new program costs seconds on some GPUs). Sheen (MeshPhysicalMaterial) is used only
 * on «høy»; «middels» renders the fabrics with MeshStandardMaterial.
 *
 * Textures are generated on <canvas> the first time a kind is used, tile seamlessly and are scaled in METRES: the
 * geometry's UVs must be metres (kit.worldUV / kit geometries / buildKit.applyBoxUV), then fibre, weave and grain
 * sizes are physically right on every object. One texture set per kind is shared by all colours: the colour is the
 * material colour (normalised so the average albedo of the texture equals the hex). Wood grain runs along U; see
 * `opts.grain` and kit.worldUV(geometry, 1, { grain }).
 *
 * opts (all optional, part of the cache key): grain 'x'|'u' (default) | 'y'|'z'|'v' (rotate the texture 90°),
 * scale (texture scale factor: 2 = twice as coarse, e.g. chunky knit), roughness, metalness, side ('front'|'double'),
 * opacity, open (rattan: see-through weave), flat (no textures, e.g. tiny parts), emissive '#hex',
 * emissiveIntensity, envMapIntensity.
 */

// ---------------------------------------------------------------------------------------------------------------
// Kinds, labels, defaults

/** Valid material kinds per group (same lists as data/archetypes.json). */
export const MATERIAL_KINDS = Object.freeze({
  fabric: Object.freeze(['boucle', 'woven', 'tweed', 'velvet', 'velour', 'linen', 'wool', 'felt', 'leather', 'teddy', 'knit', 'cotton']),
  wood: Object.freeze(['oak', 'white-oak', 'smoked-oak', 'walnut', 'black-oak', 'teak', 'ash', 'painted', 'lacquer']),
  metal: Object.freeze(['black-metal', 'brass', 'chrome', 'steel', 'bronze']),
  stone: Object.freeze(['marble-dark', 'marble-white', 'travertine']),
  glass: Object.freeze(['glass-clear', 'glass-opal', 'glass-smoked']),
  other: Object.freeze(['rattan', 'paper', 'ceramic', 'plastic', 'plant-leaf', 'soil', 'candle', 'moss', 'cork', 'mirror']),
});

/** Norwegian names for drop-downs (Inspector, WallPanel …). */
export const MATERIAL_LABELS = Object.freeze({
  boucle: 'Bouclé', woven: 'Vevd stoff', tweed: 'Tweed (melert)', velvet: 'Fløyel', velour: 'Velur', linen: 'Lin', wool: 'Ull', felt: 'Filt',
  leather: 'Skinn', teddy: 'Teddy', knit: 'Strikk', cotton: 'Bomull',
  oak: 'Eik', 'white-oak': 'Hvitoljet eik', 'smoked-oak': 'Røkt eik', walnut: 'Valnøtt', 'black-oak': 'Sortbeiset eik',
  teak: 'Teak', ash: 'Ask', painted: 'Malt', lacquer: 'Høyglanslakk',
  'black-metal': 'Sort metall', brass: 'Messing', chrome: 'Krom', steel: 'Børstet stål', bronze: 'Bronse',
  'marble-dark': 'Mørk marmor', 'marble-white': 'Hvit marmor', travertine: 'Travertin',
  'glass-clear': 'Klart glass', 'glass-opal': 'Opalglass', 'glass-smoked': 'Røykglass',
  rattan: 'Rotting', paper: 'Papir', ceramic: 'Keramikk', plastic: 'Plast', 'plant-leaf': 'Blader', soil: 'Jord',
  candle: 'Stearin', moss: 'Mose', cork: 'Kork', mirror: 'Speil',
});

/** Norwegian group names. */
export const MATERIAL_GROUP_LABELS = Object.freeze({
  fabric: 'Stoff', wood: 'Tre', metal: 'Metall', stone: 'Stein', glass: 'Glass', other: 'Annet',
});

const GROUP_OF = {};
for (const [g, list] of Object.entries(MATERIAL_KINDS)) for (const k of list) GROUP_OF[k] = g;

/**
 * Per-kind look. tex = texture generator id (null = untextured), rough/metal = PBR values, sheen = [amount,
 * roughness] (MeshPhysicalMaterial sheen, fabrics), ns = normal scale, def = default colour, glass = transparent.
 */
const DEFS = {
  // fabrics
  boucle: { tex: 'boucle', rough: 0.97, sheen: [0.55, 0.85], ns: 1.15, def: '#e5ded2' },
  woven: { tex: 'woven', rough: 0.93, sheen: [0.3, 0.8], ns: 0.9, def: '#7b7a77' },
  tweed: { tex: 'tweed', rough: 0.95, sheen: [0.3, 0.8], ns: 1.05, def: '#5a4134' },
  velvet: { tex: 'velvet', rough: 0.78, sheen: [1.0, 0.32], ns: 0.5, def: '#4a5646' },
  velour: { tex: 'velour', rough: 0.82, sheen: [0.85, 0.42], ns: 0.5, def: '#8e9a7e' },
  linen: { tex: 'linen', rough: 0.9, sheen: [0.2, 0.8], ns: 0.8, def: '#d4c8b2' },
  wool: { tex: 'wool', rough: 0.95, sheen: [0.4, 0.75], ns: 0.9, def: '#9d9991' },
  felt: { tex: 'felt', rough: 0.98, sheen: [0.25, 0.9], ns: 0.6, def: '#8b8b89' },
  leather: { tex: 'leather', rough: 0.55, ns: 0.6, def: '#8b4e2b' },
  teddy: { tex: 'teddy', rough: 0.98, sheen: [0.7, 0.75], ns: 1.0, def: '#ebe4d8' },
  knit: { tex: 'knit', rough: 0.95, sheen: [0.35, 0.8], ns: 1.0, def: '#e0d6c8' },
  cotton: { tex: 'cotton', rough: 0.92, sheen: [0.2, 0.85], ns: 0.6, def: '#e8e4dc' },
  // woods (grain along U)
  oak: { tex: 'oak', rough: 0.58, ns: 0.45, def: '#c39b6e' },
  'white-oak': { tex: 'white-oak', rough: 0.62, ns: 0.4, def: '#d9ccb6' },
  'smoked-oak': { tex: 'smoked-oak', rough: 0.55, ns: 0.45, def: '#7a5e47' },
  walnut: { tex: 'walnut', rough: 0.5, ns: 0.4, def: '#5f4332' },
  'black-oak': { tex: 'black-oak', rough: 0.52, ns: 0.5, def: '#2b2623' },
  teak: { tex: 'teak', rough: 0.48, ns: 0.4, def: '#9c6b3f' },
  ash: { tex: 'ash', rough: 0.58, ns: 0.45, def: '#d6c4a3' },
  painted: { tex: 'peel', rough: 0.5, ns: 0.25, def: '#eeece6' },
  lacquer: { tex: null, rough: 0.16, def: '#1c1b1b' },
  // metals
  'black-metal': { tex: 'peel', rough: 0.45, metal: 0.15, ns: 0.3, def: '#1f1f1f' },
  brass: { tex: 'brushed', rough: 0.32, metal: 1, ns: 0.25, def: '#c8a463' },
  chrome: { tex: null, rough: 0.07, metal: 1, def: '#e4e6e8' },
  steel: { tex: 'brushed', rough: 0.36, metal: 1, ns: 0.25, def: '#b9bcbf' },
  bronze: { tex: 'bronze', rough: 0.45, metal: 1, ns: 0.3, def: '#6b4f37' },
  // stones
  'marble-dark': { tex: 'marble-dark', rough: 0.32, ns: 0.15, def: '#3a322d' },
  'marble-white': { tex: 'marble-white', rough: 0.28, ns: 0.15, def: '#ebe8e3' },
  travertine: { tex: 'travertine', rough: 0.72, ns: 0.5, def: '#d6c7ad' },
  // glass
  'glass-clear': { tex: null, rough: 0.04, glass: 0.14, def: '#ffffff' },
  'glass-opal': { tex: null, rough: 0.4, glass: 0.9, def: '#f3f1ec' },
  'glass-smoked': { tex: null, rough: 0.06, glass: 0.55, def: '#4b4641' },
  // other
  rattan: { tex: 'rattan', rough: 0.7, ns: 0.9, def: '#c29b63' },
  paper: { tex: 'paper', rough: 0.9, ns: 0.3, double: true, def: '#f1ead9' },
  ceramic: { tex: 'ceramic', rough: 0.3, ns: 0.15, def: '#cdbfa8' },
  plastic: { tex: null, rough: 0.45, def: '#e6e6e6' },
  'plant-leaf': { tex: 'leaf', rough: 0.55, ns: 0.4, double: true, def: '#4f6b3a' },
  soil: { tex: 'soil', rough: 1, ns: 0.8, def: '#3b2c22' },
  candle: { tex: null, rough: 0.62, def: '#f2efe8' },
  moss: { tex: 'moss', rough: 1, ns: 1.0, def: '#557030' },
  cork: { tex: 'cork', rough: 0.88, ns: 0.6, def: '#a9825a' },
  mirror: { tex: null, rough: 0.02, metal: 1, def: '#f2f2f2', env: 1.2 },
};

// ---------------------------------------------------------------------------------------------------------------
// Configuration

let RES = 1;
let PHYSICAL = true;

/**
 * Texture resolution and material quality. Call before the first mat() (createHome and the dev pages do).
 * @param {{ textureRes?: number, physical?: boolean, quality?: object }} o
 *   textureRes 0.5 / 1 / 1.5 (Settings QUALITY), physical: MeshPhysicalMaterial sheen for fabrics (off on «lav»)
 */
export function configureMaterials({ textureRes, physical, quality } = {}) {
  const q = quality || {};
  const res = textureRes ?? q.textureRes;
  if (typeof res === 'number' && res > 0) RES = res;
  if (typeof physical === 'boolean') PHYSICAL = physical;
  // sheen costs a second BRDF per light per pixel (22 pooled lights) and its own shader programs: «høy» only
  else if (q.level) PHYSICAL = q.level === 'high';
}

// ---------------------------------------------------------------------------------------------------------------
// Colours

const PAINTS = {};
for (const [k, p] of Object.entries(palette?.walls || {})) PAINTS[k] = p.hex;
const NAMED = new Map();
for (const p of palette?.paints || []) {
  for (const key of [p.id, p.name, p.code]) if (key) NAMED.set(String(key).toLowerCase(), p.hex);
}
for (const m of palette?.materials || []) if (m.id) NAMED.set(String(m.id).toLowerCase(), m.hex);

/**
 * Colour name → '#rrggbb': 'sand' / 'marrakesh' (palette walls), a palette paint id/name/code, a palette material id,
 * '#rgb' or '#rrggbb'. Unknown → fallback.
 * @param {string} c
 * @param {string} [fallback='#9a9a9a']
 * @returns {string}
 */
export function resolveColor(c, fallback = '#9a9a9a') {
  if (c && typeof c === 'object' && c.isColor) return `#${c.getHexString()}`;
  const s = String(c ?? '').trim();
  if (/^#[0-9a-f]{6}$/i.test(s)) return s.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(s)) return `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`.toLowerCase();
  const key = s.toLowerCase();
  if (PAINTS[key]) return PAINTS[key];
  if (NAMED.has(key)) return NAMED.get(key);
  return fallback;
}

/** Group of a kind ('fabric' | 'wood' | 'metal' | 'stone' | 'glass' | 'other'), or null when unknown. */
export function kindGroup(kind) {
  return GROUP_OF[kind] || null;
}

/** Default colour of a kind ('#hex'). */
export function defaultColor(kind) {
  return (DEFS[kind] || DEFS.plastic).def;
}

/** True for see-through kinds (no shadow casting, sorted as transparent). */
export function isTransparentKind(kind) {
  return !!DEFS[kind]?.glass;
}

/**
 * Options for a <select>: [[kind, 'Norsk navn'], …].
 * @param {string|string[]} [which]  a group name, a list of kinds, or nothing for all kinds
 * @returns {Array<[string, string]>}
 */
export function materialOptions(which) {
  let kinds;
  if (Array.isArray(which)) kinds = which;
  else if (which && MATERIAL_KINDS[which]) kinds = MATERIAL_KINDS[which];
  else kinds = Object.values(MATERIAL_KINDS).flat();
  return kinds.filter((k) => DEFS[k]).map((k) => [k, MATERIAL_LABELS[k] || k]);
}

/**
 * URL of a file in public/ (e.g. 'img/utsikt/sor.jpg'). Pages in sub-folders (dev/*.html) set
 * window.__ASSET_BASE__ = '../' so the same relative paths work there and in a build served from any folder.
 * @param {string} path  relative path without a leading slash
 * @returns {string}
 */
export function assetUrl(path) {
  const base = (typeof window !== 'undefined' && window.__ASSET_BASE__) || '';
  return base + String(path).replace(/^\/+/, '');
}

// ---------------------------------------------------------------------------------------------------------------
// Texture generation

const srgbToLin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const fract = (x) => x - Math.floor(x);
const mod = (a, n) => ((a % n) + n) % n;
const sz = (n) => Math.max(32, Math.round((n * RES) / 32) * 32);

/**
 * Evaluates `pixel(x, y, u, v, o)` once per texel and returns the texture DATA as plain typed arrays (structured-
 * cloneable, so it can be cached in IndexedDB): { w, h, tile, ref, roughRef, color, normal?, rough?, alpha? } (RGBA
 * Uint8Arrays). o: l (grey multiplier 0..1) or r/g/b, h (height, any scale), rough (0..1), a (alpha 0..1).
 * ref = the linear value of the map that stands for the material colour (default: the mean). finishSet() makes the
 * textures.
 */
function genSet({ w, h, tile, pixel, normal = 0, rough = false, alpha = false, ref = null }) {
  w = sz(w);
  h = sz(h);
  const d = new Uint8Array(w * h * 4);
  const heights = normal ? new Float32Array(w * h) : null;
  const rdata = rough ? new Uint8Array(w * h * 4) : null;
  const adata = alpha ? new Uint8Array(w * h * 4) : null;
  const o = { l: 1, r: -1, g: -1, b: -1, h: 0, rough: 0.5, a: 1 };
  let sum = 0;
  let rsum = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      o.l = 1;
      o.r = o.g = o.b = -1;
      o.h = 0;
      o.rough = 0.5;
      o.a = 1;
      pixel(x, y, x / w, y / h, o);
      let r = o.l, g = o.l, b = o.l;
      if (o.r >= 0) {
        r = o.r;
        g = o.g;
        b = o.b;
      }
      r = clamp(r);
      g = clamp(g);
      b = clamp(b);
      const i = (y * w + x) * 4;
      d[i] = r * 255;
      d[i + 1] = g * 255;
      d[i + 2] = b * 255;
      d[i + 3] = 255;
      sum += srgbToLin(0.2126 * r + 0.7152 * g + 0.0722 * b);
      if (heights) heights[y * w + x] = o.h;
      if (rdata) {
        rsum += clamp(o.rough);
        const rv = clamp(o.rough) * 255;
        rdata[i] = rv;
        rdata[i + 1] = rv;
        rdata[i + 2] = rv;
        rdata[i + 3] = 255;
      }
      if (adata) {
        const av = clamp(o.a) * 255;
        adata[i] = adata[i + 1] = adata[i + 2] = av;
        adata[i + 3] = 255;
      }
    }
  }
  return {
    w,
    h,
    tile: [tile[0], tile[1]],
    ref: ref ?? Math.max(0.02, sum / (w * h)),
    roughRef: rough ? Math.max(0.05, rsum / (w * h)) : 1,
    color: d,
    // normal strength is per texel: keep the relief the same at every resolution
    normal: heights ? heightToNormalData(heights, w, h, normal * RES) : null,
    rough: rdata,
    alpha: adata,
  };
}

/** Tangent-space normal map (RGBA bytes) from a tileable height field (same maths as proctex.heightToNormalCanvas). */
function heightToNormalData(heights, w, h, strength) {
  const out = new Uint8Array(w * h * 4);
  const H = (x, y) => heights[((y + h) % h) * w + ((x + w) % w)];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (H(x + 1, y) - H(x - 1, y)) * strength;
      const dy = (H(x, y + 1) - H(x, y - 1)) * strength;
      const nx = -dx, ny = dy; // image y goes down; OpenGL normal maps expect +y up (the upload flips Y)
      const len = Math.hypot(nx, ny, 1);
      const i = (y * w + x) * 4;
      out[i] = ((nx / len) * 0.5 + 0.5) * 255;
      out[i + 1] = ((ny / len) * 0.5 + 0.5) * 255;
      out[i + 2] = ((1 / len) * 0.5 + 0.5) * 255;
      out[i + 3] = 255;
    }
  }
  return out;
}

/** RGBA bytes → a repeating, mip-mapped texture (oriented like the former canvas textures: flipY). */
function dataTexture(data, w, h, repeat, srgb) {
  const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat[0], repeat[1]);
  t.anisotropy = 8; // three clamps it to the GPU's maximum
  t.flipY = true;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

/** Texture set { map, normalMap?, roughnessMap?, alphaMap?, tile, ref, roughRef } from genSet() data. */
function finishSet(data) {
  const { w, h, tile } = data;
  const repeat = [1 / tile[0], 1 / tile[1]];
  const set = { tile, ref: data.ref, roughRef: data.roughRef };
  set.map = dataTexture(data.color, w, h, repeat, true);
  if (data.normal) set.normalMap = dataTexture(data.normal, w, h, repeat, false);
  if (data.rough) set.roughnessMap = dataTexture(data.rough, w, h, repeat, false);
  if (data.alpha) set.alphaMap = dataTexture(data.alpha, w, h, repeat, false);
  return set;
}

/** Tileable cellular noise: nearest/second distance (in cell units) to jittered points, and the nearest cell id. */
function worley(u, v, cells, seed, out) {
  const gx = u * cells, gy = v * cells;
  const ix = Math.floor(gx), iy = Math.floor(gy);
  let f1 = 9, f2 = 9, id = 0;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const cx = ix + dx, cy = iy + dy;
      const hx = mod(cx, cells), hy = mod(cy, cells);
      const px = cx + hash2(hx, hy, seed);
      const py = cy + hash2(hx, hy, seed + 101);
      const dd = Math.hypot(gx - px, gy - py);
      if (dd < f1) {
        f2 = f1;
        f1 = dd;
        id = hx * 7919 + hy;
      } else if (dd < f2) f2 = dd;
    }
  }
  out.f1 = f1;
  out.f2 = f2;
  out.id = id;
  return out;
}

/** Tileable noise sample with integer frequencies (fu, fv) over the tile. */
const nz = (N, u, v, fu, fv = fu) => N.noise(u * fu, v * fv, fu, fv);

/** Scattered loops (bouclé / teddy): returns { h, tone } of the highest loop at (u, v). */
function loops(u, v, cells, perCell, R0, R1, ring, seed, out) {
  const gx = u * cells, gy = v * cells;
  const ix = Math.floor(gx), iy = Math.floor(gy);
  let best = 0, tone = 1;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const cx = ix + dx, cy = iy + dy;
      const hx = mod(cx, cells), hy = mod(cy, cells);
      for (let k = 0; k < perCell; k++) {
        const s = seed + k * 31;
        const px = cx + hash2(hx, hy, s);
        const py = cy + hash2(hx, hy, s + 7);
        const R = R0 + (R1 - R0) * hash2(hx, hy, s + 13);
        const dd = Math.hypot(gx - px, gy - py);
        if (dd > R + ring * 2.5) continue;
        const t = (dd - R) / ring;
        const loop = Math.exp(-t * t);
        const blob = 0.55 * Math.exp(-(dd * dd) / (R * R * 0.8));
        const hh = Math.max(loop, blob) * (0.75 + 0.5 * hash2(hx, hy, s + 17));
        if (hh > best) {
          best = hh;
          tone = hash2(hx, hy, s + 19);
        }
      }
    }
  }
  out.h = best;
  out.tone = tone;
  return out;
}

/** Woven cloth: threads per tile T, weave(i, j) → true when the warp (along v) is on top. */
function weave(u, v, T, isWarpTop, seed, out) {
  const tx = u * T, ty = v * T;
  const i = Math.floor(tx), j = Math.floor(ty);
  const fx = tx - i, fy = ty - j;
  const warp = isWarpTop(mod(i, T), mod(j, T));
  // thread cross-section profile (0 at the gaps, 1 at the crown) and an over/under bulge along the thread
  const pw = Math.sin(Math.PI * fx), pf = Math.sin(Math.PI * fy);
  if (warp) {
    out.h = 0.55 + 0.45 * pw * (0.75 + 0.25 * pf);
    out.prof = pw;
    out.thread = mod(i, T);
    out.along = ty;
    out.warp = true;
  } else {
    out.h = 0.55 + 0.45 * pf * (0.75 + 0.25 * pw);
    out.prof = pf;
    out.thread = mod(j, T) + 1000;
    out.along = tx;
    out.warp = false;
  }
  out.tone = 0.95 + 0.05 * hash2(out.thread, 0, seed);
  return out;
}

const GEN = {
  boucle() {
    const N = new TileableNoise(41);
    const L = {};
    const C = {};
    // loops (≈4 mm) bunched into clumps (≈8 mm) with shaded crevices between them: clumps and crevices are what still
    // reads as bouclé at 2–3 m, where the single loops are below a pixel and mip-map to an even tone
    return genSet({ w: 256, h: 256, tile: [0.1, 0.1], normal: 3.6, pixel(x, y, u, v, o) {
      loops(u, v, 26, 2, 0.32, 0.5, 0.14, 5, L);
      worley(u, v, 12, 43, C);
      const crevice = smoothstep(0.0, 0.32, C.f2 - C.f1); // 0 in the gap between two clumps
      const dome = 1 - smoothstep(0.15, 0.85, C.f1); // clump centres stand proud
      const clumpTone = 0.9 + 0.2 * hash2(C.id, 7, 3);
      const fuzz = nz(N, u, v, 64);
      const mel = nz(N, u, v, 12) * 0.04;
      o.l = (0.76 + 0.2 * L.tone) * (0.62 + 0.38 * L.h) * (0.66 + 0.34 * crevice) * clumpTone + 0.04 * fuzz + mel;
      o.h = 0.75 * L.h + 0.45 * dome + 0.35 * crevice + 0.1 * fuzz;
    } });
  },
  teddy() {
    const N = new TileableNoise(43);
    const L = {};
    return genSet({ w: 256, h: 256, tile: [0.15, 0.15], normal: 2.4, pixel(x, y, u, v, o) {
      loops(u, v, 28, 3, 0.3, 0.55, 0.2, 9, L);
      const fuzz = nz(N, u, v, 96);
      o.l = (0.86 + 0.1 * L.tone) * (0.8 + 0.2 * L.h) + 0.03 * fuzz;
      o.h = L.h * 0.8 + 0.2 * fuzz;
    } });
  },
  woven() {
    const W = {};
    const N = new TileableNoise(45);
    // 2/2 basket weave of a mélange yarn (two-tone fibres)
    return genSet({ w: 256, h: 256, tile: [0.04, 0.04], normal: 2.2, pixel(x, y, u, v, o) {
      weave(u, v, 48, (i, j) => (Math.floor(i / 2) + Math.floor(j / 2)) % 2 === 0, 3, W);
      const fleck = hash2(W.thread, mod(Math.floor(W.along * 2), 48 * 2), 77);
      const mel = fleck < 0.2 ? 0.74 : fleck > 0.85 ? 1.1 : 0.95;
      const lum = W.tone * mel * (0.66 + 0.34 * W.prof) + 0.03 * N.fbm(u, v, 3, 3, 0.5);
      o.l = lum;
      o.h = W.h;
    } });
  },
  tweed() {
    const W = {};
    const N = new TileableNoise(63);
    // chunky 2/2 basket weave of two yarns (Conform's Nanda): dark base threads and warm, lighter copper nubs. The
    // texture carries the hue of the two yarns, so the item colour sets the overall tone and the nubs stay warmer
    return genSet({ w: 256, h: 256, tile: [0.07, 0.07], normal: 2.4, pixel(x, y, u, v, o) {
      weave(u, v, 40, (i, j) => (Math.floor(i / 2) + Math.floor(j / 2)) % 2 === 0, 5, W);
      const nub = hash2(W.thread, mod(Math.floor(W.along * 1.5), 60), 31) > 0.68;
      const lum = (0.66 + 0.34 * W.prof) + 0.04 * N.fbm(u, v, 3, 3, 0.5);
      if (nub) {
        o.r = lum * 1.7;
        o.g = lum * 1.42;
        o.b = lum * 1.12;
      } else {
        o.r = o.g = o.b = lum * 0.6;
      }
      o.h = W.h * (nub ? 1.15 : 0.9);
    } });
  },
  linen() {
    const W = {};
    const N = new TileableNoise(47);
    return genSet({ w: 256, h: 256, tile: [0.05, 0.05], normal: 1.8, pixel(x, y, u, v, o) {
      weave(u, v, 64, (i, j) => (i + j) % 2 === 0, 7, W);
      // slubs: short, irregular thicker/lighter stretches along a few threads (no regular stripes)
      const seg = mod(Math.floor(W.along / 3), 64 / 3 | 0);
      const sl = hash2(W.thread, seg, 11);
      const slub = sl > 0.82 ? (sl - 0.82) / 0.18 : 0;
      const fleck = hash2(W.thread, mod(Math.floor(W.along), 64), 13);
      const tone = 0.9 + 0.06 * fleck + 0.1 * slub;
      o.l = tone * (0.76 + 0.24 * W.prof) + 0.03 * N.fbm(u, v, 3, 3, 0.5);
      o.h = W.h * (0.85 + 0.35 * slub);
    } });
  },
  cotton() {
    const W = {};
    const N = new TileableNoise(49);
    return genSet({ w: 256, h: 256, tile: [0.03, 0.03], normal: 1.2, pixel(x, y, u, v, o) {
      weave(u, v, 64, (i, j) => (i + j) % 2 === 0, 13, W);
      o.l = (0.9 + 0.08 * W.tone) * (0.82 + 0.18 * W.prof) + 0.02 * nz(N, u, v, 4);
      o.h = W.h;
    } });
  },
  wool() {
    const W = {};
    const N = new TileableNoise(51);
    // 2/2 twill (diagonal ribs), fuzzy
    return genSet({ w: 256, h: 256, tile: [0.06, 0.06], normal: 1.8, pixel(x, y, u, v, o) {
      weave(u, v, 40, (i, j) => mod(i + j, 4) < 2, 17, W);
      const fuzz = nz(N, u, v, 128) * 0.5 + nz(N, u, v, 64) * 0.5;
      o.l = (0.86 + 0.12 * W.tone) * (0.78 + 0.22 * W.prof) + 0.05 * fuzz + 0.02 * nz(N, u, v, 5);
      o.h = W.h * 0.7 + 0.3 * fuzz;
    } });
  },
  felt() {
    const N = new TileableNoise(53);
    return genSet({ w: 256, h: 256, tile: [0.1, 0.1], normal: 1.4, pixel(x, y, u, v, o) {
      const f = nz(N, u, v, 96) * 0.45 + nz(N, u, v, 128, 48) * 0.3 + nz(N, u, v, 48, 128) * 0.25;
      const big = N.fbm(u, v, 3, 3, 0.5);
      o.l = 0.92 + 0.05 * f + 0.025 * big;
      o.h = f;
    } });
  },
  velvet() {
    const N = new TileableNoise(55);
    return genSet({ w: 256, h: 256, tile: [0.3, 0.3], normal: 0.6, rough: true, pixel(x, y, u, v, o) {
      const crush = nz(N, u, v, 5, 14) * 0.6 + nz(N, u, v, 11, 3) * 0.4;
      const fine = nz(N, u, v, 96);
      o.l = 0.93 + 0.05 * crush + 0.015 * fine;
      o.h = 0.4 * crush + 0.15 * fine;
      o.rough = 0.72 + 0.1 * crush;
    } });
  },
  velour() {
    const N = new TileableNoise(57);
    return genSet({ w: 256, h: 256, tile: [0.25, 0.25], normal: 0.8, rough: true, pixel(x, y, u, v, o) {
      const crush = N.fbm(u, v, 4, 3, 0.55);
      const fine = nz(N, u, v, 128);
      o.l = 0.9 + 0.08 * crush + 0.02 * fine;
      o.h = 0.5 * crush + 0.2 * fine;
      o.rough = 0.78 + 0.1 * crush;
    } });
  },
  leather() {
    const N = new TileableNoise(59);
    const C = {};
    return genSet({ w: 256, h: 256, tile: [0.1, 0.1], normal: 2.2, rough: true, pixel(x, y, u, v, o) {
      worley(u, v, 44, 21, C);
      const crease = smoothstep(0.0, 0.16, C.f2 - C.f1);
      const big = N.fbm(u, v, 3, 3, 0.5);
      o.l = 0.84 + 0.1 * crease + 0.05 * big + 0.03 * (hash2(C.id, 1, 3) - 0.5);
      o.h = crease * 0.7 + (1 - Math.min(1, C.f1)) * 0.3;
      o.rough = 0.5 + 0.12 * (1 - crease) + 0.05 * big;
    } });
  },
  knit() {
    const N = new TileableNoise(61);
    // stockinette: columns of V-shaped stitches (two slanted legs per stitch)
    const COLS = 12, ROWS = 16;
    const leg = (fx, fy, side) => {
      // leg from the top corner (side) to the bottom centre of the stitch cell
      const x0 = 0.5 + side * 0.42, y0 = -0.15, x1 = 0.5 + side * 0.04, y1 = 1.05;
      const dx = x1 - x0, dy = y1 - y0;
      const t = clamp(((fx - x0) * dx + (fy - y0) * dy) / (dx * dx + dy * dy));
      const px = x0 + dx * t - fx, py = y0 + dy * t - fy;
      const dd = Math.hypot(px, py) / 0.2;
      return Math.exp(-dd * dd) * (0.85 + 0.15 * Math.sin(t * Math.PI));
    };
    // 9 mm wide × 7 mm tall stitches (a medium-chunky cushion knit; mat(…, { scale }) for finer/coarser)
    return genSet({ w: 256, h: 256, tile: [0.108, 0.112], normal: 3.2, pixel(x, y, u, v, o) {
      const gx = u * COLS, gy = v * ROWS;
      const fx = fract(gx);
      let hh = 0;
      for (let k = -1; k <= 1; k++) {
        const fy = fract(gy) - k;
        hh = Math.max(hh, leg(fx, fy, -1), leg(fx, fy, 1));
      }
      const twist = 0.5 + 0.5 * Math.sin((gy * 2 + gx) * Math.PI * 3);
      o.l = (0.58 + 0.42 * hh) * (0.94 + 0.06 * twist) + 0.03 * nz(N, u, v, 48);
      o.h = hh;
    } });
  },
  // ---- woods: grain along U, tile 0.8 × 0.4 m
  oak: () => wood({ seed: 71, rings: 52, warp: 0.6, contrast: 0.13, pores: 0.2, rays: 0.1, figure: 0.06 }),
  'white-oak': () => wood({ seed: 73, rings: 52, warp: 0.55, contrast: 0.07, pores: 0.13, rays: 0.06, figure: 0.04 }),
  'smoked-oak': () => wood({ seed: 75, rings: 48, warp: 0.65, contrast: 0.13, pores: 0.17, rays: 0.05, figure: 0.07 }),
  walnut: () => wood({ seed: 77, rings: 36, warp: 1.3, contrast: 0.18, pores: 0.12, rays: 0, figure: 0.12 }),
  'black-oak': () => wood({ seed: 79, rings: 52, warp: 0.6, contrast: 0.05, pores: 0.22, rays: 0.03, figure: 0.03 }),
  teak: () => wood({ seed: 81, rings: 64, warp: 0.35, contrast: 0.1, pores: 0.1, rays: 0, figure: 0.08 }),
  ash: () => wood({ seed: 83, rings: 32, warp: 1.1, contrast: 0.16, pores: 0.15, rays: 0, figure: 0.05 }),
  // ---- painted / powder coat orange peel
  peel() {
    const N = new TileableNoise(85);
    return genSet({ w: 128, h: 128, tile: [0.12, 0.12], normal: 0.9, pixel(x, y, u, v, o) {
      const p = nz(N, u, v, 32) * 0.6 + nz(N, u, v, 64) * 0.4;
      o.l = 0.985 + 0.012 * N.fbm(u, v, 2, 2, 0.5);
      o.h = p;
    } });
  },
  brushed() {
    const N = new TileableNoise(87);
    return genSet({ w: 256, h: 256, tile: [0.2, 0.2], normal: 0.8, rough: true, pixel(x, y, u, v, o) {
      const s = nz(N, u, v, 2, 64) * 0.6 + nz(N, u, v, 4, 128) * 0.4;
      o.l = 0.95 + 0.04 * s + 0.015 * N.fbm(u, v, 2, 2, 0.5);
      o.h = s * 0.5;
      o.rough = 0.42 + 0.08 * s;
    } });
  },
  bronze() {
    const N = new TileableNoise(89);
    return genSet({ w: 256, h: 256, tile: [0.25, 0.25], normal: 0.6, rough: true, pixel(x, y, u, v, o) {
      const m = N.fbm(u, v, 3, 4, 0.55);
      const s = nz(N, u, v, 2, 96);
      o.l = 0.9 + 0.08 * m + 0.02 * s;
      o.h = 0.3 * s + 0.2 * m;
      o.rough = 0.42 + 0.14 * m;
    } });
  },
  // ---- stones
  'marble-dark'() {
    return marble({ seed: 91, base: 0.3, vein: 0.74, fine: 0.5, dark: true });
  },
  'marble-white'() {
    return marble({ seed: 93, base: 0.93, vein: 0.58, fine: 0.8, dark: false });
  },
  travertine() {
    const N = new TileableNoise(95);
    const C = {};
    return genSet({ w: 512, h: 512, tile: [0.6, 0.6], normal: 1.5, rough: true, pixel(x, y, u, v, o) {
      const bands = nz(N, u, v, 2, 14) * 0.6 + nz(N, u, v, 3, 31) * 0.4;
      const mott = N.fbm(u, v, 4, 4, 0.5);
      worley(u, v, 40, 31, C);
      const pit = hash2(C.id, 5, 9) < 0.3 ? 1 - smoothstep(0.08, 0.22, C.f1) : 0;
      o.l = (0.9 + 0.05 * bands + 0.03 * mott) * (1 - 0.3 * pit);
      o.h = 0.2 * bands - pit;
      o.rough = 0.68 + 0.1 * pit;
    } });
  },
  // ---- other
  rattan() {
    const N = new TileableNoise(97);
    // cane ("Wiener-flett") weave: horizontal + vertical strand pairs and two diagonals, open octagons between
    const S = 10;
    const strand = (d, w) => Math.exp(-(d / w) * (d / w));
    return genSet({ w: 256, h: 256, tile: [0.04, 0.04], normal: 2.0, alpha: true, pixel(x, y, u, v, o) {
      const gx = u * S, gy = v * S;
      const fx = fract(gx), fy = fract(gy);
      const dh = Math.min(Math.abs(fy - 0.4), Math.abs(fy - 0.6));
      const dv = Math.min(Math.abs(fx - 0.4), Math.abs(fx - 0.6));
      const d1 = Math.abs(fract(gx + gy + 0.5) - 0.5) * 0.7071;
      const d2 = Math.abs(fract(gx - gy + 0.5) - 0.5) * 0.7071;
      const hH = strand(dh, 0.07), hV = strand(dv, 0.07), h1 = strand(d1, 0.06), h2 = strand(d2, 0.06);
      const hh = Math.max(hH, hV, h1 * 0.9, h2 * 0.9);
      const grain = 0.92 + 0.08 * nz(N, u, v, 160, 8);
      o.l = (0.62 + 0.38 * hh) * grain;
      o.h = hh;
      o.a = hh > 0.22 ? 1 : 0;
    } });
  },
  paper() {
    const N = new TileableNoise(99);
    return genSet({ w: 256, h: 256, tile: [0.25, 0.25], normal: 0.5, pixel(x, y, u, v, o) {
      const fib = nz(N, u, v, 12, 128) * 0.5 + nz(N, u, v, 128, 12) * 0.5;
      const m = N.fbm(u, v, 4, 3, 0.5);
      o.l = 0.95 + 0.03 * fib + 0.025 * m;
      o.h = fib * 0.5 + m * 0.3;
    } });
  },
  ceramic() {
    const N = new TileableNoise(101);
    return genSet({ w: 256, h: 256, tile: [0.2, 0.2], normal: 0.4, rough: true, pixel(x, y, u, v, o) {
      const m = N.fbm(u, v, 3, 4, 0.5);
      const speck = hash2(x, y, 5) < 0.003 ? 0.7 : 1;
      o.l = (0.96 + 0.035 * m) * speck;
      o.h = 0.4 * nz(N, u, v, 24) + 0.2 * m;
      o.rough = 0.28 + 0.06 * m;
    } });
  },
  leaf() {
    const N = new TileableNoise(103);
    return genSet({ w: 256, h: 256, tile: [0.06, 0.06], normal: 1.0, pixel(x, y, u, v, o) {
      const vein = Math.exp(-((fract(v * 20 + 0.08 * nz(N, u, v, 3)) - 0.5) ** 2) / 0.006);
      const m = N.fbm(u, v, 4, 3, 0.5);
      o.l = 0.86 + 0.08 * m + 0.1 * vein;
      o.h = vein * 0.4 + m * 0.2;
    } });
  },
  soil() {
    const N = new TileableNoise(105);
    const C = {};
    return genSet({ w: 256, h: 256, tile: [0.15, 0.15], normal: 2.0, pixel(x, y, u, v, o) {
      worley(u, v, 64, 41, C);
      const g = 1 - smoothstep(0.2, 0.75, C.f1);
      o.l = (0.55 + 0.45 * hash2(C.id, 2, 7)) * (0.6 + 0.4 * g) + 0.05 * nz(N, u, v, 32);
      o.h = g;
    } });
  },
  moss() {
    const N = new TileableNoise(107);
    const C = {};
    return genSet({ w: 256, h: 256, tile: [0.25, 0.25], normal: 3.0, pixel(x, y, u, v, o) {
      worley(u, v, 14, 51, C);
      const clump = 1 - smoothstep(0.1, 0.95, C.f1);
      const frond = nz(N, u, v, 128) * 0.5 + nz(N, u, v, 64) * 0.5;
      const t = hash2(C.id, 3, 11);
      const lum = (0.55 + 0.45 * clump) * (0.85 + 0.25 * t) + 0.08 * frond;
      // clumps vary from yellow-green to blue-green
      o.r = lum * (0.92 + 0.14 * t);
      o.g = lum;
      o.b = lum * (1.02 - 0.14 * t);
      o.h = clump * 0.8 + frond * 0.35;
    } });
  },
  cork() {
    const N = new TileableNoise(109);
    const C = {};
    return genSet({ w: 256, h: 256, tile: [0.06, 0.06], normal: 1.4, pixel(x, y, u, v, o) {
      worley(u, v, 36, 61, C);
      const edge = smoothstep(0.0, 0.12, C.f2 - C.f1);
      const t = hash2(C.id, 4, 13);
      o.l = (0.72 + 0.3 * t) * (0.78 + 0.22 * edge) + 0.03 * nz(N, u, v, 64);
      o.h = edge * 0.5 + t * 0.3;
    } });
  },
  wallpaint() {
    const N = new TileableNoise(111);
    // matt roller paint on plaster: very faint mottling and a fine stipple (barely visible, catches grazing light)
    return genSet({ w: 256, h: 256, tile: [1.6, 1.6], normal: 0.35, pixel(x, y, u, v, o) {
      const big = N.fbm(u, v, 3, 3, 0.5);
      const roller = nz(N, u, v, 6, 40);
      const st = nz(N, u, v, 96) * 0.6 + nz(N, u, v, 64) * 0.4;
      o.l = 0.985 + 0.01 * big + 0.004 * roller + 0.004 * st;
      o.h = st * 0.6 + 0.2 * roller;
    } });
  },
};

/** Flat-sawn board: rings across V that wander along U, open pores, ray flecks, slow figure. */
function wood({ seed, rings, warp, contrast, pores, rays, figure }) {
  const N = new TileableNoise(seed);
  return genSet({ w: 512, h: 256, tile: [0.8, 0.4], normal: 1.0, rough: true, pixel(x, y, u, v, o) {
    // ring coordinate: integer ring count across the tile keeps it tileable; the warp wanders slowly along U
    const wv = warp * 0.035 * (0.6 * nz(N, u, v, 1, 2) + 0.4 * nz(N, u, v, 3, 1)) + 0.004 * nz(N, u, v, 2, 12);
    const r = rings * (v + wv);
    const f = fract(r);
    const late = smoothstep(0.68, 0.93, f) * (1 - smoothstep(0.93, 1, f));
    const pore = Math.max(0, nz(N, u, v, 6, 64) * 0.5 + nz(N, u, v, 12, 96) * 0.5 - 0.2) * 1.4;
    const ray = rays ? smoothstep(0.55, 0.9, nz(N, u, v, 80, 16)) : 0;
    const fig = N.fbm(u, v, 2, 3, 0.5);
    const streak = nz(N, u, v, 4, 64);
    let l = 1 - contrast * late - pores * pore * (0.5 + 0.5 * late) + rays * 0.8 * ray + figure * fig + 0.04 * streak;
    o.l = l * 0.9;
    o.h = -pore * 0.5 - late * 0.1 + ray * 0.05;
    o.rough = 0.5 + 0.2 * pore;
  } });
}

/** Marble: warped ridged-noise veins on a cloudy base. `base`/`vein` are sRGB tones; ref = the base tone. */
function marble({ seed, base, vein, fine, dark }) {
  const N = new TileableNoise(seed);
  const M = new TileableNoise(seed + 1);
  return genSet({ w: 512, h: 512, tile: [0.9, 0.9], normal: 0.6, rough: true, ref: srgbToLin(base), pixel(x, y, u, v, o) {
    const wu = u + 0.09 * N.fbm(u, v, 2, 4, 0.55);
    const wv = v + 0.09 * N.fbm(u + 0.37, v + 0.61, 2, 4, 0.55);
    const r1 = 1 - Math.abs(M.fbm(fract(wu), fract(wv), 2, 5, 0.55));
    const r2 = 1 - Math.abs(N.fbm(fract(wu * 1 + 0.5), fract(wv), 5, 4, 0.5));
    const v1 = smoothstep(0.962, 0.997, r1);
    const v2 = smoothstep(0.975, 1, r2) * 0.7;
    const cloud = N.fbm(u, v, 4, 4, 0.5);
    const b = base * (1 + (dark ? 0.08 : 0.025) * cloud);
    let t = b + (vein - b) * v1;
    t = t + (fine - t) * v2 * 0.6;
    const spark = dark && hash2(x, y, seed) < 0.002 ? 0.12 : 0;
    o.l = t + spark;
    o.h = -0.2 * v1;
    o.rough = 0.3 + 0.08 * cloud + 0.05 * v1;
  } });
}

const _sets = new Map();

/** Texture set of a generator id (made once per resolution, shared): already prepared, else generated now. */
function texSet(id) {
  const key = `${id}@${RES}`;
  let set = _sets.get(key);
  if (!set) {
    const gen = GEN[id];
    if (!gen) return null;
    const data = gen();
    set = finishSet(data);
    _sets.set(key, set);
    cachePut(key, data);
  }
  return set;
}

// ---- IndexedDB cache of generated texture data (a second visit runs no pixel loops at all) -------------------
// Key '<id>@<RES>#<hash of the generator sources>': editing any generator invalidates the cache by itself.

const CACHE_DB = 'interiorspillet-tex';
const CACHE_STORE = 'sets';
let _srcHash = null;
let _dbPromise = null;

function srcHash() {
  if (_srcHash == null) {
    const src = [genSet, heightToNormalData, loops, weave, worley, wood, marble, ...Object.values(GEN)].map(String).join('|');
    _srcHash = `${(hashString(src) >>> 0).toString(36)}-${src.length}`;
  }
  return _srcHash;
}

const cacheKey = (key) => `${key}#${srcHash()}`;

/** The cache database, or null (no IndexedDB, private window, blocked …). Never rejects. */
function cacheDb() {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve) => {
    let done = false;
    const finish = (db) => {
      if (done) return;
      done = true;
      resolve(db);
    };
    setTimeout(() => finish(null), 1500); // some browsers never answer open() in private mode
    try {
      if (typeof indexedDB === 'undefined') {
        finish(null);
        return;
      }
      const req = indexedDB.open(CACHE_DB, 1);
      req.onupgradeneeded = () => {
        try {
          req.result.createObjectStore(CACHE_STORE);
        } catch {
          /* exists already */
        }
      };
      req.onsuccess = () => {
        finish(req.result);
        pruneCache(req.result);
      };
      req.onerror = () => finish(null);
      req.onblocked = () => finish(null);
    } catch {
      finish(null);
    }
  });
  return _dbPromise;
}

/** Drops cached sets of older generator versions (once per page). */
function pruneCache(db) {
  try {
    const store = db.transaction(CACHE_STORE, 'readwrite').objectStore(CACHE_STORE);
    const req = store.getAllKeys();
    req.onsuccess = () => {
      const tail = `#${srcHash()}`;
      for (const k of req.result || []) if (!String(k).endsWith(tail)) store.delete(k);
    };
  } catch {
    /* the cache is optional */
  }
}

function validData(d) {
  return !!d && Number.isFinite(d.w) && Number.isFinite(d.h) && d.color instanceof Uint8Array && d.color.length === d.w * d.h * 4 && Array.isArray(d.tile);
}

async function cacheGet(key) {
  const db = await cacheDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const req = db.transaction(CACHE_STORE, 'readonly').objectStore(CACHE_STORE).get(cacheKey(key));
      req.onsuccess = () => resolve(validData(req.result) ? req.result : null);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

function cachePut(key, data) {
  cacheDb().then((db) => {
    if (!db) return;
    try {
      db.transaction(CACHE_STORE, 'readwrite').objectStore(CACHE_STORE).put(data, cacheKey(key));
    } catch {
      /* quota / blocked: the cache is optional */
    }
  });
}

const _pending = new Map();
let _urgent = 0;

/** Resolves in the next idle period (or after a short timeout) – at once while a caller is waiting for textures. */
function idleSlot() {
  if (_urgent) return Promise.resolve();
  return new Promise((r) => {
    if (typeof requestIdleCallback === 'function') requestIdleCallback(() => r(), { timeout: 400 });
    else setTimeout(r, 30);
  });
}

/** Makes sure the set of a generator id exists (cache → generate). One promise per set and resolution. */
function ensureSet(id, idle) {
  const key = `${id}@${RES}`;
  if (_sets.has(key)) return Promise.resolve(_sets.get(key));
  if (_pending.has(key)) return _pending.get(key);
  const p = (async () => {
    try {
      const cached = await cacheGet(key);
      if (!_sets.has(key)) {
        if (cached) _sets.set(key, finishSet(cached));
        else {
          if (idle) await idleSlot();
          if (!_sets.has(key)) texSet(id); // generates (and caches)
        }
      }
    } finally {
      _pending.delete(key);
    }
    return _sets.get(key);
  })();
  _pending.set(key, p);
  return p;
}

const _variants = new Map();

/** A clone of a set's texture with a rotation/scale (shares the GPU image with the original). */
function texVariant(tex, setId, slot, rot, scale) {
  if (!tex) return null;
  if (!rot && scale === 1) return tex;
  const key = `${setId}@${RES}:${slot}:${rot}:${scale}`;
  let t = _variants.get(key);
  if (!t) {
    t = tex.clone();
    t.repeat.set(tex.repeat.x / scale, tex.repeat.y / scale);
    t.rotation = rot;
    t.needsUpdate = false;
    _variants.set(key, t);
  }
  return t;
}

/**
 * Makes the textures for `kinds` ahead of use: from the IndexedDB cache when an earlier visit generated them, else
 * generated, one kind per slice so a loading screen keeps animating. Unknown kinds are skipped; the wall paint set is
 * always included. idle: generate only in idle time (the start-screen prefetch) – a call without it takes priority.
 * @param {string[]} kinds
 * @param {(fraction: number) => void} [onProgress]
 * @param {{ idle?: boolean }} [opts]
 */
export async function prepareMaterials(kinds, onProgress, { idle = false } = {}) {
  const ids = [...new Set([...kinds.map((k) => DEFS[k]?.tex), 'wallpaint'].filter(Boolean))];
  if (!idle) _urgent++;
  try {
    for (let i = 0; i < ids.length; i++) {
      await ensureSet(ids[i], idle);
      onProgress?.((i + 1) / ids.length);
      await new Promise((r) => setTimeout(r, 0));
    }
  } finally {
    if (!idle) _urgent--;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Materials

const _mats = new Map();
const _c = new THREE.Color();

function optsKey(opts) {
  if (!opts) return '';
  const keys = Object.keys(opts).filter((k) => opts[k] !== undefined).sort();
  return keys.map((k) => `${k}=${opts[k]}`).join(',');
}

/**
 * Material of a kind in a colour. Cached: the same arguments return the same instance – treat it as read-only and
 * never dispose it (it carries userData.cached = true; kit.disposeModel skips it). Unknown kinds fall back to
 * 'plastic' (with one warning per kind).
 * @param {string} kind   see MATERIAL_KINDS
 * @param {string} [hex]  colour ('#hex' or a palette name); default: the kind's default colour
 * @param {object} [opts] see the module comment
 * @returns {THREE.MeshStandardMaterial|THREE.MeshPhysicalMaterial}
 */
export function mat(kind, hex, opts) {
  let k = kind;
  if (!DEFS[k]) {
    if (!_warned.has(k)) {
      _warned.add(k);
      console.warn(`[materials] unknown material kind «${k}» – using plastic`);
    }
    k = 'plastic';
  }
  const color = resolveColor(hex ?? DEFS[k].def, DEFS[k].def);
  const key = `${k}|${color}|${optsKey(opts)}|${RES}|${PHYSICAL ? 1 : 0}`;
  let m = _mats.get(key);
  if (!m) {
    m = buildMaterial(k, color, opts || {});
    m.name = `${k} ${color}`;
    m.userData = { cached: true, kind: k, hex: color, opts: opts ? { ...opts } : undefined };
    _mats.set(key, m);
  }
  return m;
}
const _warned = new Set();

// 1×1 neutral textures: untextured kinds bind them so every material shares one shader program per type
let _neutral = null;
function neutralTex(r, g, b, srgb) {
  const t = new THREE.DataTexture(new Uint8Array([r, g, b, 255]), 1, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.needsUpdate = true;
  return t;
}
function neutral() {
  // map white (colour × 1), flat normal (128,128,255), roughness map white (roughness × 1)
  _neutral ||= { map: neutralTex(255, 255, 255, true), normal: neutralTex(128, 128, 255, false), rough: neutralTex(255, 255, 255, false) };
  return _neutral;
}

/** Gives material params the neutral map / normalMap / roughnessMap where they have none. */
function withNeutralMaps(params) {
  const n = neutral();
  params.map ??= n.map;
  if (!params.normalMap) {
    params.normalMap = n.normal;
    params.normalScale = new THREE.Vector2(0, 0); // the flat map adds nothing: keep the geometry normal exact
  }
  params.roughnessMap ??= n.rough;
  return params;
}

function buildMaterial(kind, hex, o) {
  const def = DEFS[kind];
  const sheen = PHYSICAL && def.sheen && !o.flat;
  const params = {
    roughness: o.roughness ?? def.rough,
    metalness: o.metalness ?? def.metal ?? 0,
  };
  if (def.env || o.envMapIntensity != null) params.envMapIntensity = o.envMapIntensity ?? def.env;
  const set = def.tex && !o.flat ? texSet(def.tex) : null;
  const scale = o.scale && o.scale > 0 ? o.scale : 1;
  const g = o.grain;
  const rot = g === 'y' || g === 'z' || g === 'v' ? Math.PI / 2 : 0;
  _c.set(hex);
  if (set) {
    params.map = texVariant(set.map, def.tex, 'map', rot, scale);
    if (set.normalMap) {
      params.normalMap = texVariant(set.normalMap, def.tex, 'n', rot, scale);
      const ns = def.ns ?? 1;
      params.normalScale = new THREE.Vector2(ns, ns);
    }
    if (set.roughnessMap) {
      params.roughnessMap = texVariant(set.roughnessMap, def.tex, 'r', rot, scale);
      // the map holds absolute roughness; scale it to the requested base value
      params.roughness = (o.roughness ?? def.rough) / set.roughRef;
    }
    // the texture's reference tone becomes the hex: average albedo = colour
    _c.multiplyScalar(1 / set.ref);
    // keep albedo physically plausible (≤ ~1) for very light colours
    const mx = Math.max(_c.r, _c.g, _c.b);
    if (mx > 1.05) _c.multiplyScalar(1.05 / mx);
    if (kind === 'rattan' && o.open) {
      params.alphaMap = texVariant(set.alphaMap, def.tex, 'a', rot, scale);
      params.alphaTest = 0.5;
      params.side = THREE.DoubleSide;
    }
  }
  params.color = _c.clone();
  if (def.double || o.side === 'double') params.side = THREE.DoubleSide;
  if (def.glass) {
    params.transparent = true;
    params.opacity = o.opacity ?? def.glass;
    params.depthWrite = (o.opacity ?? def.glass) > 0.8;
    params.envMapIntensity = params.envMapIntensity ?? 1.4;
  } else if (o.opacity != null && o.opacity < 1) {
    params.transparent = true;
    params.opacity = o.opacity;
    params.depthWrite = false;
  }
  if (o.emissive) {
    params.emissive = new THREE.Color(resolveColor(o.emissive, '#ffffff'));
    params.emissiveIntensity = o.emissiveIntensity ?? 1;
  }
  withNeutralMaps(params);
  let m;
  if (sheen) {
    const sc = new THREE.Color(hex);
    // sheen tint: the fabric colour lifted toward white (soft rim light on pile/loops)
    sc.lerp(new THREE.Color(1, 1, 1), 0.35);
    m = new THREE.MeshPhysicalMaterial({ ...params, sheen: def.sheen[0], sheenRoughness: def.sheen[1], sheenColor: sc });
  } else {
    m = new THREE.MeshStandardMaterial(params);
  }
  return m;
}

const _paints = new Map();

/**
 * Matt wall paint: 'sand' | 'marrakesh' | palette paint | '#hex'. Very subtle roller texture (UVs in metres),
 * shared by every colour. Cached – do not mutate.
 * @param {string} colorOrName
 * @param {{ roughness?: number }} [opts]
 * @returns {THREE.MeshStandardMaterial}
 */
export function paint(colorOrName, opts = {}) {
  const hex = resolveColor(colorOrName, PAINTS.sand || '#cfc5b4');
  const key = `${hex}|${opts.roughness ?? ''}|${RES}`;
  let m = _paints.get(key);
  if (!m) {
    const set = texSet('wallpaint');
    const color = new THREE.Color(hex).multiplyScalar(1 / set.ref);
    m = new THREE.MeshStandardMaterial(withNeutralMaps({
      color,
      map: set.map,
      normalMap: set.normalMap,
      normalScale: new THREE.Vector2(0.18, 0.18),
      roughness: opts.roughness ?? 0.92,
      metalness: 0,
    }));
    m.name = `paint ${hex}`;
    m.userData = { cached: true, kind: 'paint', hex };
    _paints.set(key, m);
  }
  return m;
}

/**
 * Glowing material (lamp bulbs, LED strips, lit shades). Returns a NEW material on every call, so a LightManager can
 * dim it per lamp (it is disposed with the model).
 * @param {string} [hex='#fff4e0']
 * @param {number} [intensity=1]
 * @param {{ color?: string }} [opts] color = base (unlit) colour, default the hex
 * @returns {THREE.MeshStandardMaterial}
 */
export function emissive(hex = '#fff4e0', intensity = 1, opts = {}) {
  const c = resolveColor(hex, '#fff4e0');
  const m = new THREE.MeshStandardMaterial(withNeutralMaps({
    color: resolveColor(opts.color ?? c, c),
    emissive: c,
    emissiveIntensity: intensity,
    roughness: 0.5,
    metalness: 0,
  }));
  m.name = `emissive ${c}`;
  m.userData = { cached: false, kind: 'emissive', hex: c, baseIntensity: intensity };
  return m;
}

/**
 * Lamp-shade material that glows from inside when the lamp is on (paper, linen, opal glass, rattan, cotton): a NEW
 * material on every call (not cached, disposed with the model) with the kind's texture also as emissive map, so the
 * weave/fibres show against the light. Put the shade mesh in the lamp's `emissiveMeshes` – the LightManager scales
 * emissiveIntensity with on/dimmer (userData.baseIntensity = intensity at full power).
 * @param {string} kind
 * @param {string} [hex]
 * @param {{ glow?: string, intensity?: number } & object} [opts]  glow = colour of the light through the shade
 * @returns {THREE.MeshStandardMaterial|THREE.MeshPhysicalMaterial}
 */
export function shadeMaterial(kind, hex, { glow = '#ffd2a0', intensity = 0.8, ...opts } = {}) {
  const base = mat(kind, hex, { side: 'double', ...opts });
  const m = base.clone();
  m.emissive = new THREE.Color(resolveColor(glow, '#ffd2a0'));
  m.emissiveIntensity = intensity;
  if (base.map) m.emissiveMap = base.map;
  m.userData = { cached: false, kind: 'emissive', baseKind: base.userData.kind, hex: base.userData.hex, baseIntensity: intensity };
  return m;
}

const _flat = new Map();

/**
 * Translucent preview material (Placement ghosts): flat colour plus the neutral maps, so it shares the shader program
 * of the transparent materials that exist from the start (glass) – showing a ghost never compiles a new program.
 * Cached per colour; SceneSync clones it per ghost before tinting.
 * @param {string} hex
 * @param {number} [opacity=0.55]
 */
export function ghostMaterial(hex = '#bfbfbf', opacity = 0.55) {
  const c = resolveColor(hex, '#bfbfbf');
  const key = `ghost|${c}|${opacity}`;
  let m = _flat.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial(withNeutralMaps({ color: c, roughness: 0.7, metalness: 0, transparent: true, opacity, depthWrite: false }));
    m.name = `ghost ${c}`;
    m.userData = { cached: true, kind: 'ghost', hex: c };
    _flat.set(key, m);
  }
  return m;
}

/**
 * Flat material in a colour that uses the most common shader program (opaque, or glass-like when transparent) –
 * shown on a new model until its own shaders are compiled (SceneSync). Cached – never mutate or dispose.
 * @param {string} hex
 * @param {boolean} [transparent=false]
 */
export function placeholderMaterial(hex = '#9a9a9a', transparent = false) {
  const c = resolveColor(hex, '#9a9a9a');
  const key = `ph|${c}|${transparent ? 1 : 0}`;
  let m = _flat.get(key);
  if (!m) {
    const p = { color: c, roughness: 0.8, metalness: 0 };
    if (transparent) Object.assign(p, { transparent: true, opacity: 0.3, depthWrite: false });
    m = new THREE.MeshStandardMaterial(withNeutralMaps(p));
    m.name = `placeholder ${c}`;
    m.userData = { cached: true, kind: 'placeholder', hex: c };
    _flat.set(key, m);
  }
  return m;
}

let _warm = null;
let _warmPhysical = null;

/**
 * One material for every shader-program variant this module hands out (front/double side × opaque/transparent,
 * alpha-tested rattan, glowing lamp shades, sheen fabrics on «høy»), each also used on an InstancedMesh (with and
 * without instance colours) – SceneSync.warmUp precompiles them before the user opens the catalogue. Only the
 * neutral textures are used (nothing is generated). The materials stay alive, and with them the GPU programs.
 * @returns {Array<{ material: THREE.Material, instanced?: boolean, instanceColor?: boolean }>}
 */
export function warmupMaterials() {
  if (_warm && _warmPhysical === PHYSICAL) return _warm;
  const n = neutral();
  const std = (extra = {}) => new THREE.MeshStandardMaterial(withNeutralMaps({ color: '#808080', roughness: 0.6, ...extra }));
  const list = [
    std(),
    std({ side: THREE.DoubleSide }),
    std({ transparent: true, opacity: 0.5, depthWrite: false }),
    std({ transparent: true, opacity: 0.5, depthWrite: false, side: THREE.DoubleSide }),
    std({ alphaMap: n.rough, alphaTest: 0.5, side: THREE.DoubleSide }),
    std({ emissive: new THREE.Color('#ffd2a0'), emissiveMap: n.map, side: THREE.DoubleSide }),
    std({ emissive: new THREE.Color('#ffd2a0'), emissiveMap: n.map }),
  ];
  if (PHYSICAL) {
    const phys = (extra = {}) => new THREE.MeshPhysicalMaterial(withNeutralMaps({ color: '#808080', roughness: 0.9, sheen: 0.5, sheenRoughness: 0.8, sheenColor: new THREE.Color('#ffffff'), ...extra }));
    list.push(phys(), phys({ side: THREE.DoubleSide }));
  }
  _warm = [];
  _warmPhysical = PHYSICAL;
  for (const material of list) {
    material.userData = { cached: true, kind: 'warmup' };
    _warm.push({ material }, { material, instanced: true }, { material, instanced: true, instanceColor: true });
  }
  return _warm;
}

/** Kind information for UIs: { kind, group, label, defaultColor, transparent }. */
export function materialInfo(kind) {
  if (!DEFS[kind]) return null;
  return { kind, group: kindGroup(kind), label: MATERIAL_LABELS[kind] || kind, defaultColor: DEFS[kind].def, transparent: !!DEFS[kind].glass };
}

/** Every kind with a definition (for tests / galleries). */
export const ALL_KINDS = Object.freeze(Object.keys(DEFS));
