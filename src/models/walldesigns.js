// The elements of the high-wall proposals (ARCHITECTURE §9): slat walls, Akupixel/felt checkerboards, textile
// panels, acoustic art, tapestries, felt circles, wood-wool hexagons, wave curtains, moss, shelves, floating
// sideboards, hooks, LED strips, wall lamps, painted fields and plants – built in the high wall's anchor
// (origin u = 0, v = 0 on the wall face, +x = u, +y = v, +z = into the room).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mat, paint, emissive, resolveColor, kindGroup, materialOptions } from '../home/materials.js';
import * as K from './kit.js';
import { buildModel, getArchetype } from './registry.js';
import { elementAbsorption as acousticElementAbsorption } from '../design/Acoustics.js';
import { layout as roomLayout } from '../home/layout.js';
import { createCanvas, canvasTexture, heightToNormalCanvas, createNoise2D, hash2 } from '../world/proctex.js';

/**
 * Public API
 *   applyWallDesign(highWallInfo, elements|null, { quality }?) → Group|null   builds in highWall.anchor, replaces the old one
 *   buildWallDesign(elements, { quality, wall }) → Group|null    the same design as a free group (previews, thumbnails)
 *   ELEMENT_TYPES { type: { label, short, icon, defaults } }
 *   elementEditor(type, element?) → param schema (Def.params format, Norwegian labels) for WallPanel's paramEditor
 *   elementValues(element) → values for that schema · setElementParam(element, key, value) → new element
 *   createElement(type, { u, v }?) → a new element with sensible defaults · describeElement(el) → «Spilepanel · 3,90 × 2,35 m»
 *   elementBounds(el) → { u0, v0, u1, v1, depth } (wall coordinates) · elementAbsorption(el) → Sabine m²
 *   setWallQuality('low'|'medium'|'high')
 *   placeElement(el, existing, { prefer }?) → el moved to the freest spot · moveElement(el, du, dv) → moved copy
 *   sideboardHasLamp(el, elements) → whether a floating sideboard gets its table lamp (el.lamp, or automatic)
 *
 * Shader programs: the curtain shares the moss walls' program (front side + vertex colours), the sideboard lamp and
 * the tapestry use programs the room already has – WallPanel compiles the rest once at start-up (compileAsync).
 *
 * The group's userData.model = { parts, lights (group-local, SceneSync sends them as uid '__wall'), surfaces (shelf
 * and sideboard tops, group-local), colliders ([{ min, max }] group-local boxes for things that stick out),
 * elements: [{ index, type, bounds }] }.
 * Fixtures (sockets/switches from room-spec) that a covering element hides get a black surface-mount box
 * («påbyggsramme») on the element's face, like the proposals' material lists say.
 */

// ---------------------------------------------------------------------------------------------------------------
// Constants, presets

const HW = roomLayout?.highWall || { width: 3.91, height: 3 };
const WALL_W = HW.width ?? 3.91;
const WALL_H = HW.height ?? 3;
const FELT_T = 0.009;

let QUALITY = 'medium';

/** Model quality for the wall designs (art resolution, curtain and moss segments). */
export function setWallQuality(level) {
  if (level === 'low' || level === 'medium' || level === 'high') QUALITY = level;
}

/** Wood presets: kind → { hex, name }. */
export const WOOD_PRESETS = Object.freeze({
  oak: { hex: '#b08b62', name: 'Naturell eik' },
  'white-oak': { hex: '#d9ccb6', name: 'Hvitoljet eik' },
  'smoked-oak': { hex: '#5f4936', name: 'Røkt eik' },
  walnut: { hex: '#6b4a33', name: 'Valnøtt' },
  'black-oak': { hex: '#2a2725', name: 'Sortbeiset eik' },
  teak: { hex: '#9c6b3f', name: 'Teak' },
  ash: { hex: '#d6c4a3', name: 'Ask' },
  painted: { hex: '#8a8774', name: 'Malt (valgfri farge)' },
  lacquer: { hex: '#1c1b1b', name: 'Lakkert' },
});

const WOOD_SWATCHES = Object.entries(WOOD_PRESETS).filter(([k]) => k !== 'painted').map(([, p]) => ({ hex: p.hex, name: p.name }));
const FELT_SWATCHES = [
  { hex: '#1b1b1b', name: 'Sort filt' }, { hex: '#3c3d3f', name: 'Koksgrå' }, { hex: '#4a4d53', name: 'Mørk blågrå' },
  { hex: '#7c766f', name: 'Varmgrå' }, { hex: '#8b8b89', name: 'Grå' }, { hex: '#b9ab90', name: 'Beige' },
  { hex: '#cbbba2', name: 'Sand' }, { hex: '#c9bca6', name: 'Lys sand' }, { hex: '#a39584', name: 'Marrakesh-filt' },
  { hex: '#6f8a6c', name: 'Grønn' }, { hex: '#6b6a47', name: 'Oliven' }, { hex: '#b06f55', name: 'Terrakotta' },
];
const FABRIC_SWATCHES = [
  { hex: '#3a3b40', name: 'Kull' }, { hex: '#5d5f63', name: 'Grafitt' }, { hex: '#cdbfa6', name: 'Sand' },
  { hex: '#d4c8b2', name: 'Lin naturell' }, { hex: '#c6baa5', name: 'Lys sand' }, { hex: '#d6ccbb', name: 'Havre' },
  { hex: '#b06f55', name: 'Terrakotta' }, { hex: '#9a4f2f', name: 'Rust' }, { hex: '#6b6a47', name: 'Oliven' },
  { hex: '#667a62', name: 'Salvie' }, { hex: '#8e9a7e', name: 'Lys salvie' }, { hex: '#2f4a3b', name: 'Skogsgrønn' },
  { hex: '#27334a', name: 'Marineblå' }, { hex: '#4b3b30', name: 'Mørk kork' },
];
const ART_SWATCHES = [
  { hex: '#e9dfcc', name: 'Krem' }, { hex: '#efe9de', name: 'Papirhvit' }, { hex: '#a9ae94', name: 'Salvie' },
  { hex: '#6f846f', name: 'Grønn' }, { hex: '#566650', name: 'Mørk grønn' }, { hex: '#c97f5c', name: 'Terrakotta' },
  { hex: '#d9845f', name: 'Oransje' }, { hex: '#b8a58a', name: 'Sand' }, { hex: '#a9b3b0', name: 'Blågrå' },
  { hex: '#2b2b2b', name: 'Sort' }, { hex: '#8c6c55', name: 'Brun' }, { hex: '#5d6b5a', name: 'Mosegrønn' },
];
const METAL_SWATCHES = [
  { hex: '#1f1f1f', name: 'Matt sort' }, { hex: '#b8925a', name: 'Messing' }, { hex: '#9e7c45', name: 'Antikk messing' },
  { hex: '#b9bcbf', name: 'Børstet stål' }, { hex: '#6b4f37', name: 'Bronse' }, { hex: '#e9e5dc', name: 'Hvit' },
];

const WOOD_OPTIONS = materialOptions('wood');
const FABRIC_KIND = { fabric: 'woven', felt: 'felt', linen: 'linen', velvet: 'velvet', wool: 'wool', cotton: 'cotton', boucle: 'boucle', velour: 'velour', leather: 'leather' };

/** Element types with Norwegian labels, an icon key (ui/icons.js) and the defaults for «Legg til element». */
export const ELEMENT_TYPES = Object.freeze({
  slats: { label: 'Spilepanel', short: 'Spiler', icon: 'blinds' },
  panel: { label: 'Tekstilpanel', short: 'Panel', icon: 'sliders' },
  art: { label: 'Akustikkbilde', short: 'Bilde', icon: 'palette' },
  tapestry: { label: 'Vevd vegghenge', short: 'Vegghenge', icon: 'palette' },
  checker: { label: 'Sjakkbrett av spiler', short: 'Sjakkbrett', icon: 'blinds' },
  circles: { label: 'Filtsirkler', short: 'Sirkler', icon: 'palette' },
  hexagons: { label: 'Sekskanter', short: 'Sekskanter', icon: 'palette' },
  curtain: { label: 'Gardin', short: 'Gardin', icon: 'blinds' },
  moss: { label: 'Mosebilde', short: 'Mose', icon: 'palette' },
  shelf: { label: 'Hylle', short: 'Hylle', icon: 'sofa' },
  'sideboard-floating': { label: 'Vegghengt skjenk', short: 'Skjenk', icon: 'sofa' },
  hooks: { label: 'Knagger', short: 'Knagger', icon: 'pin' },
  led: { label: 'LED-list', short: 'LED', icon: 'bulb' },
  'lamp-wall': { label: 'Vegglampe', short: 'Lampe', icon: 'lamp' },
  'paint-block': { label: 'Malt felt', short: 'Maling', icon: 'palette' },
  plant: { label: 'Plante', short: 'Plante', icon: 'home' },
  wallpaper: { label: 'Tapet', short: 'Tapet', icon: 'palette' },
  moulding: { label: 'Listverk', short: 'Lister', icon: 'sliders' },
  bookcase: { label: 'Bokhylle', short: 'Bokhylle', icon: 'sofa' },
  ledge: { label: 'Bildehylle', short: 'Bildehylle', icon: 'palette' },
});

const DEFAULTS = {
  slats: { u: 0, v: 0, w: 1.2, h: 2.35, slatW: 0.027, slatD: 0.012, gap: 0.013, orientation: 'vertical', wood: 'oak', slatColor: '#b08b62', backing: 'felt', backingColor: '#1b1b1b', standoff: 0.048, alpha: 0.76 },
  panel: { u: 0.5, v: 0.6, w: 1.2, h: 1.6, depth: 0.05, surface: 'fabric', color: '#3a3b40', edge: 'square', frameColor: null, alpha: 0.94 },
  art: { u: 1.05, v: 0.9, w: 1.2, h: 0.9, depth: 0.045, motif: 'landscape-hills', palette: ['#e9dfcc', '#a9ae94', '#6f846f', '#c97f5c'], frame: 'oak', acoustic: true, sun: true, seed: 7, alpha: 0.86 },
  tapestry: { u: 0.6, v: 0.5, w: 2.4, h: 1.7, pattern: 'kilim', colors: ['#d8cbb5', '#a8604a', '#5d6b5a', '#2e2c2a'], rod: true, rodColor: '#1e1e1e', fringe: true, motifCount: 3, alpha: 0.45 },
  checker: { u: 0.15, v: 0.55, w: 3.6, h: 1.8, tile: 0.6, cols: 6, rows: 3, depth: 0.021, fill: 'slats-alternating', colors: ['#b08b62', '#b08b62'], woods: ['oak', 'oak'], gap: 0.003, startOrientation: 'vertical', slatW: 0.027, slatGap: 0.013, backingColor: '#1b1b1b', alpha: 0.77 },
  circles: { items: [{ cu: 0.9, cv: 1.6, r: 0.4, color: '#b9ab90' }, { cu: 1.8, cv: 1.1, r: 0.4, color: '#6f8a6c' }, { cu: 2.7, cv: 1.6, r: 0.4, color: '#7c766f' }], depth: 0.05, surface: 'felt', alpha: 0.8 },
  hexagons: { size: 0.52, depth: 0.025, colors: ['#b3aa95', '#5a5c59', '#7f9275'], surface: 'wood-concrete', orientation: 'flat-top', alpha: 0.45 },
  curtain: { u: 0, w: 3.78, top: 3, bottom: 0.01, fabric: 'velvet', color: '#667a62', fold: 'wave', fullness: 2.2, track: 'ceiling', trackColor: '#1e1e1e', waveWidth: 0.135, alpha: 0.49 },
  moss: { u: 1.35, v: 1.1, w: 1.2, h: 0.8, depth: 0.04, color: '#557030', style: 'mix', alpha: 0.47 },
  shelf: { u: 1.35, v: 1.2, w: 1.2, d: 0.22, thickness: 0.04, color: '#b08b62', material: 'oak', decor: true, alpha: 0 },
  'sideboard-floating': { u: 0.85, v: 0.25, w: 2.2, h: 0.45, d: 0.4, frontStyle: 'flat', color: '#4e3b2c', material: 'smoked-oak', doors: 4, decor: true, alpha: 0 },
  hooks: { items: [{ cu: 3.44, cv: 1.65 }, { cu: 3.55, cv: 1.65 }, { cu: 3.66, cv: 1.65 }], style: 'fold-out', color: '#8a6b4a', material: 'oak', alpha: 0 },
  led: { u: 0, v: 1.27, w: 3.9, direction: 'down', colorK: 2700, lumensPerM: 300, alpha: 0 },
  'lamp-wall': { cu: 0.5, cv: 1.7, style: 'sconce', color: '#b8925a', colorK: 2700, alpha: 0 },
  'paint-block': { u: 1.2, v: 0, w: 1.5, h: 2.25, color: '#aea191', paintName: 'marrakesh', shape: 'arch', alpha: 0 },
  plant: { cu: 0.5, species: 'olive', height: 1.7, potColor: '#ddd6ca', alpha: 0 },
  wallpaper: { u: 0, v: 0, w: 3.91, h: 3, pattern: 'botanical', colors: ['#e3dccd', '#7d8a6a', '#566650', '#c97f5c'], scale: 1, seed: 1, shape: 'rect', alpha: 0 },
  moulding: { u: 0.1, v: 0.1, w: 3.7, h: 0.85, style: 'boxes', cols: 4, rows: 1, gap: 0.1, profile: 0.035, relief: 0.018, color: '#cfc5b4', rail: true, railH: 0.06, alpha: 0 },
  bookcase: { u: 0.15, v: 0, w: 3.4, h: 2.35, d: 0.3, cols: 4, rows: 6, material: 'oak', color: '#b08b62', backColor: null, fill: 0.75, plinth: 0.08, seed: 1, alpha: 0.25 },
  ledge: {
    u: 0.6, v: 1.3, w: 2.7, d: 0.09, material: 'oak', color: '#b08b62', lip: true, alpha: 0,
    items: [
      { cu: 1.15, w: 0.5, h: 0.7, motif: 'botanical', palette: ['#efe8dc', '#7d8a6a', '#3a3936'], seed: 21, frame: 'black' },
      { cu: 1.8, w: 0.6, h: 0.45, motif: 'line-art', palette: ['#f1ece2', '#2b2b2b', '#c98f6b'], seed: 22, frame: 'oak' },
      { cu: 2.55, w: 0.45, h: 0.6, motif: 'abstract-shapes', palette: ['#e9e0d0', '#c98f6b', '#b8a58a', '#3a3936'], seed: 23, frame: 'black' },
    ],
  },
};

const num = (v, fb) => (typeof v === 'number' && Number.isFinite(v) ? v : fb);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const clone = (v) => JSON.parse(JSON.stringify(v));
const fmt = (v, d = 2) => Number(v).toLocaleString('nb-NO', { minimumFractionDigits: d, maximumFractionDigits: d });

function woodKind(k, fb = 'oak') {
  if (k === 'black') return 'painted';
  return kindGroup(k) === 'wood' ? k : fb;
}

/** Wood material for a kind/colour; 'painted' wood keeps the given colour. */
function woodMat(kind, hex, opts) {
  return mat(woodKind(kind), resolveColor(hex, WOOD_PRESETS[woodKind(kind)]?.hex || '#b08b62'), opts);
}

function kelvinHex(k) {
  const t = clamp(k, 1500, 8000) / 100;
  let r, g, b;
  if (t <= 66) {
    r = 255;
    g = 99.4708 * Math.log(t) - 161.1196;
    b = t <= 19 ? 0 : 138.5177 * Math.log(t - 10) - 305.0448;
  } else {
    r = 329.6987 * (t - 60) ** -0.1332;
    g = 288.1222 * (t - 60) ** -0.0755;
    b = 255;
  }
  const c = (x) => Math.round(clamp(x, 0, 255)).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

function shade(hex, l = 0, s = 0) {
  const c = new THREE.Color(resolveColor(hex));
  const hsl = c.getHSL({}, THREE.SRGBColorSpace);
  c.setHSL(hsl.h, clamp(hsl.s + s, 0, 1), clamp(hsl.l + l, 0, 1), THREE.SRGBColorSpace);
  return `#${c.getHexString()}`;
}

function mixHex(a, b, t) {
  const c = new THREE.Color(resolveColor(a)).lerp(new THREE.Color(resolveColor(b)), t);
  return `#${c.getHexString()}`;
}

// ---------------------------------------------------------------------------------------------------------------
// Box batch: many boxes → one indexed BufferGeometry per (material, part), metre UVs like kit.worldUV

const FACES = (() => {
  const out = [];
  for (const [axis, sign] of [[0, 1], [0, -1], [1, 1], [1, -1], [2, 1], [2, -1]]) {
    const t1 = (axis + 1) % 3, t2 = (axis + 2) % 3;
    let corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => {
      const c = [0, 0, 0];
      c[axis] = sign;
      c[t1] = a;
      c[t2] = b;
      return c;
    });
    const e1 = corners[1].map((v, i) => v - corners[0][i]);
    const e2 = corners[2].map((v, i) => v - corners[0][i]);
    const cr = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    if (cr[axis] * sign < 0) corners = corners.reverse();
    const n = [0, 0, 0];
    n[axis] = sign;
    out.push({ axis, sign, corners, n, key: `${sign > 0 ? '+' : '-'}${'xyz'[axis]}` });
  }
  return out;
})();
const GRAIN = { x: 0, y: 1, z: 2 };

class Batch {
  constructor() {
    this.buckets = new Map();
  }

  _bucket(material, part) {
    const key = `${material.uuid}|${part || ''}`;
    let b = this.buckets.get(key);
    if (!b) this.buckets.set(key, (b = { material, part, pos: [], nor: [], uv: [], idx: [] }));
    return b;
  }

  /** Axis-aligned box (centre, size) with metre UVs; grain = axis of the texture's U; skip = '-z+y' faces to leave out. */
  box(material, part, cx, cy, cz, sx, sy, sz, { grain = 'x', uOff = 0, vOff = 0, skip = '' } = {}) {
    const b = this._bucket(material, part);
    const g = GRAIN[grain] ?? 0;
    for (const f of FACES) {
      if (skip && skip.includes(f.key)) continue;
      const base = b.pos.length / 3;
      for (const c of f.corners) {
        const x = cx + (c[0] * sx) / 2, y = cy + (c[1] * sy) / 2, z = cz + (c[2] * sz) / 2;
        b.pos.push(x, y, z);
        b.nor.push(f.n[0], f.n[1], f.n[2]);
        let u, v, ua, va;
        if (f.axis === 0) {
          u = f.sign > 0 ? -z : z;
          v = y;
          ua = 2;
          va = 1;
        } else if (f.axis === 2) {
          u = f.sign > 0 ? x : -x;
          v = y;
          ua = 0;
          va = 1;
        } else {
          u = x;
          v = f.sign > 0 ? -z : z;
          ua = 0;
          va = 2;
        }
        if (g !== ua && g === va) {
          const t = u;
          u = v;
          v = -t;
        }
        b.uv.push(u + uOff, v + vOff);
      }
      b.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }

  /** Adds the batched meshes to a group. */
  build(group) {
    for (const b of this.buckets.values()) {
      if (!b.idx.length) continue;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(b.nor, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2));
      geo.setIndex(b.pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(b.idx, 1) : new THREE.Uint16BufferAttribute(b.idx, 1));
      geo.computeBoundingSphere();
      group.add(K.partMesh(geo, b.material, b.part));
    }
    this.buckets.clear();
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Own textures (canvas): art prints, tapestries, wood-wool cement, fringes. LRU so editing does not leak memory.

const TEX_CACHE = new Map();
// every built-in proposal's canvases fit (≈ 25), so flipping back and forth never regenerates them
const TEX_MAX = 48;

function cachedTexture(key, factory) {
  let t = TEX_CACHE.get(key);
  if (t) {
    TEX_CACHE.delete(key);
    TEX_CACHE.set(key, t);
    return t;
  }
  t = factory();
  TEX_CACHE.set(key, t);
  while (TEX_CACHE.size > TEX_MAX) {
    const [k, old] = TEX_CACHE.entries().next().value;
    TEX_CACHE.delete(k);
    // disposing frees the GPU copy; a material still using it re-uploads from the canvas
    if (old.map) old.map.dispose();
    if (old.normalMap) old.normalMap.dispose();
    if (old.alphaMap) old.alphaMap.dispose();
  }
  return t;
}

/** Shared materials made here (never disposed by kit.disposeModel – userData.cached). */
const OWN_MATS = new Map();
function ownMat(key, factory) {
  let m = OWN_MATS.get(key);
  if (!m) {
    m = factory();
    m.userData = { ...(m.userData || {}), cached: true, kind: m.userData?.kind || 'wall-own' };
    OWN_MATS.set(key, m);
  }
  return m;
}

const srgbToLin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

/** Mean linear luminance of a canvas (reference tone: material colour × 1/ref = the hex on average). */
function canvasRef(canvas) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const d = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  let s = 0;
  const step = 4 * 7;
  let n = 0;
  for (let i = 0; i < d.length; i += step) {
    s += srgbToLin((0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255);
    n++;
  }
  return Math.max(0.02, s / n);
}

/** Luminance of a canvas as a height field (for normal maps). */
function canvasHeights(canvas, scale = 1) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const { width: w, height: h } = canvas;
  const d = ctx.getImageData(0, 0, w, h).data;
  const out = new Float32Array(w * h);
  for (let i = 0, j = 0; j < out.length; i += 4, j++) out[j] = ((0.3 * d[i] + 0.59 * d[i + 1] + 0.11 * d[i + 2]) / 255) * scale;
  return out;
}

/** Wood-wool cement (trebetong) texture set, neutral grey; tile 0.3 m. */
function woodWoolSet() {
  return cachedTexture('woodwool', () => {
    const N = QUALITY === 'low' ? 256 : 512;
    const tile = 0.3;
    const c = createCanvas(N, N);
    const ctx = c.getContext('2d', { willReadFrequently: true });
    const R = K.rng('woodwool');
    ctx.fillStyle = '#6d6b66';
    ctx.fillRect(0, 0, N, N);
    const pxm = N / tile;
    const strands = Math.round((N * N) / 55);
    ctx.lineCap = 'round';
    for (let i = 0; i < strands; i++) {
      const x = R() * N, y = R() * N;
      const len = (0.008 + R() * 0.022) * pxm;
      const a = R() * Math.PI * 2;
      const bend = (R() - 0.5) * len * 0.8;
      const wdt = (0.0012 + R() * 0.0018) * pxm;
      const l = 0.62 + R() * 0.55;
      const warm = R() * 10;
      ctx.strokeStyle = `rgb(${Math.round(150 * l + warm)},${Math.round(146 * l + warm * 0.6)},${Math.round(136 * l)})`;
      ctx.lineWidth = wdt;
      const dx = Math.cos(a) * len, dy = Math.sin(a) * len;
      for (const ox of [-N, 0, N]) {
        for (const oy of [-N, 0, N]) {
          if ((x + ox < -len || x + ox > N + len) || (y + oy < -len || y + oy > N + len)) continue;
          ctx.beginPath();
          ctx.moveTo(x + ox - dx / 2, y + oy - dy / 2);
          ctx.quadraticCurveTo(x + ox - dy * 0.1 + bend, y + oy + dx * 0.1, x + ox + dx / 2, y + oy + dy / 2);
          ctx.stroke();
        }
      }
    }
    const ref = canvasRef(c);
    const n = createCanvas(N, N);
    const heights = canvasHeights(c, 1);
    const normal = heightToNormalCanvas(heights, N, N, 3.5);
    n.getContext('2d').drawImage(normal, 0, 0);
    return {
      map: canvasTexture(c, { repeat: [1 / tile, 1 / tile] }),
      normalMap: canvasTexture(n, { repeat: [1 / tile, 1 / tile], srgb: false }),
      ref,
    };
  });
}

function woodWoolMat(hex) {
  const c = resolveColor(hex, '#b3aa95');
  return ownMat(`woodwool|${c}|${QUALITY}`, () => {
    const set = woodWoolSet();
    const color = new THREE.Color(c).multiplyScalar(1 / set.ref);
    const mx = Math.max(color.r, color.g, color.b);
    if (mx > 1.05) color.multiplyScalar(1.05 / mx);
    const m = new THREE.MeshStandardMaterial({ color, map: set.map, normalMap: set.normalMap, normalScale: new THREE.Vector2(0.9, 0.9), roughness: 0.96 });
    m.name = `wood-wool ${c}`;
    return m;
  });
}

/** Fringe strip texture (alpha): vertical twisted strands. */
function fringeSet() {
  return cachedTexture('fringe', () => {
    const W = 256, H = 64;
    const c = createCanvas(W, H);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    const R = K.rng('fringe');
    for (let x = 1; x < W; x += 4) {
      const l = 0.75 + R() * 0.25;
      const len = H * (0.82 + R() * 0.18);
      const g = Math.round(255 * l);
      ctx.strokeStyle = `rgb(${g},${g},${g})`;
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.quadraticCurveTo(x + (R() - 0.5) * 3, len * 0.5, x + (R() - 0.5) * 4, len);
      ctx.stroke();
    }
    const tex = canvasTexture(c, { repeat: [1, 1] });
    tex.wrapT = THREE.ClampToEdgeWrapping;
    return { map: tex, alphaMap: tex };
  });
}

/** Vertical gradient for LED wall-wash glows (white at v = 1 → black at v = 0). */
function glowTexture() {
  return cachedTexture('glow', () => {
    const c = createCanvas(4, 128);
    const ctx = c.getContext('2d');
    const g = ctx.createLinearGradient(0, 0, 0, 128);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.18, 'rgba(160,160,160,1)');
    g.addColorStop(0.55, 'rgba(40,40,40,1)');
    g.addColorStop(1, 'rgba(0,0,0,1)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 4, 128);
    const t = canvasTexture(c, { wrap: false });
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    return { map: t };
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Art and tapestry canvases

const artPpm = () => (QUALITY === 'low' ? 220 : QUALITY === 'high' ? 520 : 380);

function isWarm(hex) {
  const c = new THREE.Color(resolveColor(hex));
  const hsl = c.getHSL({}, THREE.SRGBColorSpace);
  return (hsl.h < 0.12 || hsl.h > 0.96) && hsl.s > 0.32 && hsl.l > 0.3 && hsl.l < 0.8;
}

function lum(hex) {
  const c = new THREE.Color(resolveColor(hex));
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
}

/** Felt-print speckle + very soft vignette baked into the pixels. */
function speckle(ctx, W, H, seed, amount = 0.06, flecks = 0.012) {
  const img = ctx.getImageData(0, 0, W, H);
  const d = img.data;
  const R = K.rng(`speckle:${seed}`);
  for (let i = 0; i < d.length; i += 4) {
    let f = 1 + (R() - 0.5) * amount;
    const r = R();
    if (r < flecks) f *= 0.82;
    else if (r > 1 - flecks) f *= 1.12;
    d[i] = clamp(d[i] * f, 0, 255);
    d[i + 1] = clamp(d[i + 1] * f, 0, 255);
    d[i + 2] = clamp(d[i + 2] * f, 0, 255);
  }
  ctx.putImageData(img, 0, 0);
}

/** Smooth 1-D hill profile in global metres (continuous across the panels of a triptych with the same seed). */
function hillFn(seed, layer, rough) {
  const R = K.rng(`hill:${seed}:${layer}`);
  const waves = [];
  for (let k = 0; k < 4; k++) waves.push({ l: (0.35 + R() * 1.25) / (1 + k * 0.6), p: R() * Math.PI * 2, a: (1 / (1 + k * 0.9)) * (0.6 + R() * 0.5) });
  const norm = waves.reduce((s, w) => s + w.a, 0);
  return (x) => {
    let s = 0;
    for (const w of waves) {
      const t = Math.sin((x / w.l) * Math.PI * 2 + w.p);
      s += w.a * (rough ? 1 - 2 * Math.abs(t) * 0.75 + t * 0.25 : t);
    }
    return s / norm;
  };
}

function drawLandscape(ctx, el, w, h) {
  const pal = (el.palette?.length ? el.palette : DEFAULTS.art.palette).map((c) => resolveColor(c, '#e9dfcc'));
  const bg = pal[0];
  const rest = pal.slice(1);
  const sunColor = el.sun === false ? null : rest.find(isWarm) || null;
  // warm colours are the sun; a rich palette without a sun uses them as a field/earth layer
  const cool = rest.filter((c) => !isWarm(c));
  let hills = el.sun === false && cool.length >= 3 ? rest : cool;
  if (!hills.length) hills = [mixHex(bg, '#7f8f78', 0.6)];
  const seed = el.seed ?? 1;
  const R = K.rng(`land:${seed}`);
  const portrait = h > w * 1.1;
  // few colours (like the round-1 montage H): a soft band between the sky and the first hill, cream foreground
  if (hills.length <= 2) hills = [mixHex(bg, hills[0], 0.42), ...hills, bg];
  const gx0 = num(el.u, 0);
  const rough = !portrait && w > 1.3;
  // sky
  const sky = ctx.createLinearGradient(0, 0, 0, h * 0.6);
  sky.addColorStop(0, mixHex(bg, '#ffffff', 0.12));
  sky.addColorStop(1, bg);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);
  const top = portrait ? 0.5 : 0.42;
  const bottom = portrait ? 0.86 : 0.84;
  const n = hills.length;
  const ys = hills.map((_, i) => h * (top + ((bottom - top) * i) / Math.max(1, n - 1)));
  if (sunColor) {
    const r = w * (portrait ? 0.15 : 0.055) * (0.9 + R() * 0.25);
    const sx = w * (0.56 + R() * 0.2);
    const sy = ys[0] - r * (portrait ? 1.7 : 1.15) - R() * r * 0.4;
    ctx.fillStyle = sunColor;
    ctx.beginPath();
    ctx.arc(sx, sy, r, 0, Math.PI * 2);
    ctx.fill();
  }
  for (let i = 0; i < n; i++) {
    const f = hillFn(seed, i, rough && i < n - 1);
    const amp = h * (rough && i < 2 ? 0.075 : 0.05) * (1 - i * 0.06);
    ctx.fillStyle = hills[i];
    ctx.beginPath();
    ctx.moveTo(0, h + 0.01);
    const steps = 120;
    for (let s = 0; s <= steps; s++) {
      const x = (s / steps) * w;
      ctx.lineTo(x, ys[i] + f(gx0 + x) * amp);
    }
    ctx.lineTo(w, h + 0.01);
    ctx.closePath();
    ctx.fill();
  }
}

function drawLineArt(ctx, el, w, h) {
  const pal = (el.palette?.length ? el.palette : ['#efe9de', '#2b2b2b', '#c58f6e']).map((c) => resolveColor(c));
  const R = K.rng(`line:${el.seed ?? 3}`);
  ctx.fillStyle = pal[0];
  ctx.fillRect(0, 0, w, h);
  const m = Math.min(w, h);
  // accent: a soft organic blob
  if (pal[2]) {
    ctx.fillStyle = pal[2];
    const cx = w * (0.35 + R() * 0.3), cy = h * (0.35 + R() * 0.3), r = m * (0.17 + R() * 0.08);
    ctx.beginPath();
    for (let a = 0; a <= 48; a++) {
      const t = (a / 48) * Math.PI * 2;
      const rr = r * (1 + 0.08 * Math.sin(t * 3 + R() * 0.2) + 0.05 * Math.sin(t * 5));
      ctx.lineTo(cx + Math.cos(t) * rr, cy + Math.sin(t) * rr);
    }
    ctx.fill();
  }
  // a continuous one-line drawing (Catmull–Rom through scattered points)
  const pts = [];
  const count = 9 + Math.floor(R() * 4);
  for (let i = 0; i < count; i++) pts.push([w * (0.18 + R() * 0.64), h * (0.16 + R() * 0.68)]);
  ctx.strokeStyle = pal[1] || '#2b2b2b';
  ctx.lineWidth = Math.max(0.0035, m * 0.006);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
    ctx.bezierCurveTo(p1[0] + (p2[0] - p0[0]) / 4, p1[1] + (p2[1] - p0[1]) / 4, p2[0] - (p3[0] - p1[0]) / 4, p2[1] - (p3[1] - p1[1]) / 4, p2[0], p2[1]);
  }
  ctx.stroke();
}

function drawAbstract(ctx, el, w, h) {
  const pal = (el.palette?.length ? el.palette : ['#e9e0d0', '#c98f6b', '#b8a58a', '#3a3936']).map((c) => resolveColor(c));
  const R = K.rng(`abs:${el.seed ?? 5}`);
  ctx.fillStyle = pal[0];
  ctx.fillRect(0, 0, w, h);
  const c = (i) => pal[1 + ((i % (pal.length - 1)) + (pal.length - 1)) % (pal.length - 1)] || pal[0];
  const m = Math.min(w, h);
  const ground = h * (0.72 + R() * 0.08);
  // a big arch
  const aw = w * (0.32 + R() * 0.16), ax = w * (0.12 + R() * 0.2);
  ctx.fillStyle = c(0);
  ctx.beginPath();
  ctx.moveTo(ax, ground);
  ctx.lineTo(ax, ground - aw * 0.9);
  ctx.arc(ax + aw / 2, ground - aw * 0.9, aw / 2, Math.PI, 0);
  ctx.lineTo(ax + aw, ground);
  ctx.closePath();
  ctx.fill();
  // a circle
  ctx.fillStyle = c(1);
  ctx.beginPath();
  ctx.arc(w * (0.62 + R() * 0.16), h * (0.26 + R() * 0.12), m * (0.11 + R() * 0.06), 0, Math.PI * 2);
  ctx.fill();
  // a half circle on the ground line
  ctx.fillStyle = c(2);
  const hr = m * (0.14 + R() * 0.06), hx = w * (0.58 + R() * 0.2);
  ctx.beginPath();
  ctx.arc(hx, ground, hr, Math.PI, 0);
  ctx.closePath();
  ctx.fill();
  // ground line and a thin stem
  ctx.strokeStyle = c(pal.length >= 4 ? 2 : 0);
  ctx.lineWidth = m * 0.008;
  ctx.beginPath();
  ctx.moveTo(w * 0.08, ground);
  ctx.lineTo(w * 0.92, ground);
  ctx.stroke();
  ctx.fillStyle = mixHex(pal[0], c(0), 0.35);
  ctx.fillRect(0, ground, w, h - ground);
}

function drawBotanical(ctx, el, w, h) {
  const pal = (el.palette?.length ? el.palette : ['#efe8dc', '#7d8a6a', '#3a3936']).map((c) => resolveColor(c));
  const R = K.rng(`bot:${el.seed ?? 6}`);
  ctx.fillStyle = pal[0];
  ctx.fillRect(0, 0, w, h);
  const leaf = pal[1] || '#7d8a6a';
  const dark = pal[2] || mixHex(leaf, '#000000', 0.4);
  const stems = 2 + Math.floor(R() * 2);
  for (let s = 0; s < stems; s++) {
    const x0 = w * (0.4 + (s - (stems - 1) / 2) * 0.12 + (R() - 0.5) * 0.06);
    const bendX = (R() - 0.5) * w * 0.5;
    const topY = h * (0.12 + R() * 0.15);
    const P = (t) => [x0 + bendX * t * t, h * 0.95 - (h * 0.95 - topY) * t];
    ctx.strokeStyle = dark;
    ctx.lineWidth = Math.min(w, h) * 0.006;
    ctx.beginPath();
    for (let i = 0; i <= 30; i++) {
      const [x, y] = P(i / 30);
      if (i) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
    }
    ctx.stroke();
    const leaves = 7 + Math.floor(R() * 4);
    for (let i = 1; i <= leaves; i++) {
      const t = 0.18 + (0.82 * i) / leaves;
      const [x, y] = P(t);
      const [x2, y2] = P(Math.min(1, t + 0.01));
      const ang = Math.atan2(y2 - y, x2 - x);
      const side = i % 2 ? 1 : -1;
      const L = Math.min(w, h) * (0.09 + R() * 0.05) * (1.1 - t * 0.5);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(ang + side * (0.9 + R() * 0.3));
      ctx.fillStyle = R() < 0.25 ? dark : leaf;
      ctx.beginPath();
      ctx.ellipse(L * 0.55, 0, L * 0.55, L * 0.2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }
}

/** Texture (metre UVs: repeat 1/w, 1/h) for an art element. */
function artTexture(el, w, h) {
  const motif = el.motif || 'landscape-hills';
  const ppm = artPpm();
  const key = `art|${motif}|${JSON.stringify(el.palette || [])}|${el.seed ?? ''}|${el.sun}|${w.toFixed(3)}|${h.toFixed(3)}|${motif === 'landscape-hills' ? num(el.u, 0).toFixed(3) : ''}|${ppm}`;
  return cachedTexture(key, () => {
    const W = clamp(Math.round(w * ppm), 64, 1400), H = clamp(Math.round(h * ppm), 64, 1400);
    const c = createCanvas(W, H);
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.save();
    ctx.scale(W / w, H / h);
    if (motif === 'line-art') drawLineArt(ctx, el, w, h);
    else if (motif === 'abstract-shapes') drawAbstract(ctx, el, w, h);
    else if (motif === 'botanical') drawBotanical(ctx, el, w, h);
    else drawLandscape(ctx, el, w, h);
    ctx.restore();
    speckle(ctx, W, H, `${el.seed}:${motif}`, el.acoustic === false ? 0.025 : 0.07, el.acoustic === false ? 0.002 : 0.015);
    const tex = canvasTexture(c, { repeat: [1 / w, 1 / h], wrap: false });
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    return { map: tex, edge: resolveColor(el.palette?.[0] || '#e9dfcc') };
  });
}

function drawDiamonds(ctx, el, w, h, cols) {
  const [bg, mid, accent, dark] = cols;
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  const n = clamp(Math.round(num(el.motifCount, 6)), 1, 14);
  // stripe bands top and bottom
  ctx.fillStyle = mid;
  for (const band of [0.07, h - 0.07 - 0.13]) {
    for (let i = 0; i < 3; i++) ctx.fillRect(0, band + i * 0.05, w, 0.022);
  }
  const cw = w / n;
  const cy = h / 2;
  const hy = h * 0.3, hx = cw * 0.5;
  const dia = (cx, sx, sy) => {
    ctx.beginPath();
    ctx.moveTo(cx, cy - sy);
    ctx.lineTo(cx + sx, cy);
    ctx.lineTo(cx, cy + sy);
    ctx.lineTo(cx - sx, cy);
    ctx.closePath();
  };
  for (let i = 0; i < n; i++) {
    const cx = (i + 0.5) * cw;
    dia(cx, hx, hy);
    ctx.fillStyle = mid;
    ctx.fill();
    dia(cx, hx * 0.8, hy * 0.8);
    ctx.fillStyle = bg;
    ctx.fill();
    dia(cx, hx * 0.58, hy * 0.58);
    ctx.fillStyle = dark;
    ctx.fill();
    dia(cx, hx * 0.47, hy * 0.47);
    ctx.fillStyle = accent;
    ctx.fill();
  }
}

function drawKilim(ctx, el, w, h, cols) {
  const [bg, red, green, dark] = cols;
  const k = 0.02; // knot grid
  const px = (x0, y0, wq, hq, color) => {
    ctx.fillStyle = color;
    ctx.fillRect(x0, y0, wq, hq);
  };
  px(0, 0, w, h, bg);
  // borders
  const bh = h * 0.12;
  for (const y0 of [0, h - bh]) {
    px(0, y0, w, bh, dark);
    px(0, y0 + bh * 0.18, w, bh * 0.12, red);
    px(0, y0 + bh * 0.7, w, bh * 0.12, red);
    // zigzag
    ctx.fillStyle = bg;
    const zz = bh * 0.3;
    for (let x = 0; x < w; x += k) {
      const t = Math.abs(((x / (zz * 2)) % 1) * 2 - 1);
      ctx.fillRect(x, y0 + bh * 0.35 + t * zz * 0.8, k * 0.9, k * 0.9);
    }
  }
  // medallions: stepped diamonds
  const n = clamp(Math.round(num(el.motifCount, 3)), 1, 8);
  const cw = w / n;
  const cy = h / 2;
  const fieldH = h - 2 * bh;
  for (let i = 0; i < n; i++) {
    const cx = (i + 0.5) * cw;
    const rx = cw * 0.42, ry = fieldH * 0.42;
    const layers = [[1, red], [0.78, dark], [0.62, bg], [0.46, green], [0.26, red], [0.1, dark]];
    for (const [s, color] of layers) {
      ctx.fillStyle = color;
      const steps = Math.max(3, Math.round((ry * s) / k));
      for (let j = -steps; j <= steps; j++) {
        const y = cy + j * k;
        const half = rx * s * (1 - Math.abs(j) / (steps + 1));
        const snapped = Math.round(half / k) * k;
        ctx.fillRect(cx - snapped, y - k / 2, snapped * 2, k);
      }
    }
    // hooks on the outline
    ctx.fillStyle = dark;
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) ctx.fillRect(cx + sx * rx * 0.55 - k, cy + sy * ry * 0.55 - k, k * 2, k * 2);
  }
  // small lozenges between the medallions
  for (let i = 0; i <= n; i++) {
    const cx = i * cw;
    for (const y of [cy - fieldH * 0.3, cy + fieldH * 0.3]) {
      ctx.fillStyle = green;
      for (let j = -3; j <= 3; j++) ctx.fillRect(cx - (3 - Math.abs(j)) * k, y + j * k - k / 2, (3 - Math.abs(j)) * 2 * k, k);
    }
  }
}

function tapestryTexture(el, w, h) {
  const pattern = el.pattern || 'diamond';
  const cols = [0, 1, 2, 3].map((i) => resolveColor(el.colors?.[i] ?? DEFAULTS.tapestry.colors[i]));
  const ppm = QUALITY === 'low' ? 160 : QUALITY === 'high' ? 360 : 260;
  const key = `tap|${pattern}|${cols.join(',')}|${el.motifCount ?? ''}|${w.toFixed(3)}|${h.toFixed(3)}|${ppm}`;
  return cachedTexture(key, () => {
    const W = clamp(Math.round(w * ppm), 64, 1400), H = clamp(Math.round(h * ppm), 64, 1200);
    const c = createCanvas(W, H);
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.save();
    ctx.scale(W / w, H / h);
    if (pattern === 'kilim') drawKilim(ctx, el, w, h, cols);
    else if (pattern === 'stripes') {
      let y = 0;
      const R = K.rng('stripes');
      while (y < h) {
        const t = 0.03 + R() * 0.16;
        ctx.fillStyle = cols[Math.floor(R() * 4)];
        ctx.fillRect(0, y, w, t);
        y += t;
      }
    } else if (pattern === 'plain') {
      ctx.fillStyle = cols[0];
      ctx.fillRect(0, 0, w, h);
    } else drawDiamonds(ctx, el, w, h, cols);
    ctx.restore();
    // woven texture: weft ribs and heathered wool
    const img = ctx.getImageData(0, 0, W, H);
    const d = img.data;
    const N = createNoise2D(11);
    const R = K.rng('weave');
    for (let y = 0; y < H; y++) {
      const rib = 1 + 0.05 * Math.sin((y / H) * h * 260 * Math.PI);
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4;
        const f = rib * (1 + 0.06 * N((x / W) * w * 9, (y / H) * h * 30) + (R() - 0.5) * 0.08);
        d[i] = clamp(d[i] * f, 0, 255);
        d[i + 1] = clamp(d[i + 1] * f, 0, 255);
        d[i + 2] = clamp(d[i + 2] * f, 0, 255);
      }
    }
    ctx.putImageData(img, 0, 0);
    const tex = canvasTexture(c, { repeat: [1 / w, 1 / h], wrap: false });
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    return { map: tex, edge: cols[0], fringe: cols[0] };
  });
}

// Wallpaper: repeating patterns are one seamless tile (metre UVs, RepeatWrapping), the mural is one canvas over the
// whole element. Tile sizes in metres; `scale` stretches the motif.
const WALLPAPER_TILE = { botanical: [0.53, 0.64], stripes: [0.2, 0.2], scallop: [0.2, 0.2], grasscloth: [0.91, 0.45] };

/** Draws fn at the tile and its 8 neighbours, so shapes crossing the edge wrap around (seamless tile). */
function wrapDraw(ctx, tw, th, fn) {
  for (const ox of [-tw, 0, tw]) for (const oy of [-th, 0, th]) {
    ctx.save();
    ctx.translate(ox, oy);
    fn();
    ctx.restore();
  }
}

function drawBotanicalTile(ctx, el, tw, th, cols) {
  const [bg, leaf, dark, accent] = cols;
  const R = K.rng(`wp-bot:${el.seed ?? 1}`);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, tw, th);
  // 3 × 3 jittered grid of sprigs that lean alternately left and right, some with a side branch: dense enough to read
  // as a pattern from across the room, irregular enough that the repeat is not obvious
  const mid = mixHex(leaf, bg, 0.3);
  const sprigs = [];
  for (let gy = 0; gy < 3; gy++) {
    for (let gx = 0; gx < 3; gx++) {
      const lean = ((gx + gy) % 2 ? 1 : -1) * (0.28 + R() * 0.4);
      const len = th * (0.24 + R() * 0.12);
      sprigs.push({
        x0: ((gx + 0.5 + (gy % 2) * 0.5) / 3) * tw + (R() - 0.5) * tw * 0.1,
        y0: ((gy + 0.85) / 3) * th + (R() - 0.5) * th * 0.08,
        ang: -Math.PI / 2 + lean, bend: -lean * (0.4 + R() * 0.5), len, lean,
        col: R() < 0.3 ? dark : R() < 0.5 ? mid : leaf,
        leaves: 8 + Math.floor(R() * 4), lseed: R(), branch: R() < 0.55, berry: accent && R() < 0.45,
      });
    }
  }
  const drawSprig = (x0, y0, ang, bend, len, col, leaves, lseed, berry) => {
    const LR = K.rng(`wp-leaf:${lseed}`);
    const P = (t) => {
      const a = ang + bend * t;
      return [x0 + Math.cos(a) * len * t, y0 + Math.sin(a) * len * t];
    };
    ctx.strokeStyle = dark;
    ctx.lineWidth = 0.003;
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (let i = 0; i <= 16; i++) {
      const [x, y] = P(i / 16);
      if (i) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
    }
    ctx.stroke();
    for (let i = 1; i <= leaves; i++) {
      const t = 0.12 + (0.88 * i) / (leaves + 0.5);
      const [x, y] = P(t);
      const [x2, y2] = P(Math.min(1, t + 0.02));
      const side = i % 2 ? 1 : -1;
      const L = len * (0.2 + LR() * 0.06) * (1.1 - t * 0.5);
      const c = LR() < 0.18 ? dark : col;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(Math.atan2(y2 - y, x2 - x) + side * (0.75 + LR() * 0.3));
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(L * 0.45, -L * 0.24, L, 0);
      ctx.quadraticCurveTo(L * 0.45, L * 0.24, 0, 0);
      ctx.fill();
      ctx.strokeStyle = mixHex(c, bg, 0.4);
      ctx.lineWidth = 0.0011;
      ctx.beginPath();
      ctx.moveTo(L * 0.06, 0);
      ctx.lineTo(L * 0.85, 0);
      ctx.stroke();
      ctx.restore();
    }
    if (berry) {
      const [x, y] = P(1);
      ctx.fillStyle = accent;
      for (const [dx, dy] of [[-0.011, -0.004], [0.002, -0.014], [0.012, -0.002]]) {
        ctx.beginPath();
        ctx.arc(x + dx, y + dy, 0.0068, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    return P;
  };
  for (const s of sprigs) {
    wrapDraw(ctx, tw, th, () => {
      const P = drawSprig(s.x0, s.y0, s.ang, s.bend, s.len, s.col, s.leaves, s.lseed, s.berry);
      // a side branch leaning the other way from the lower part of the stem
      if (s.branch) {
        const [bx, by] = P(0.42);
        drawSprig(bx, by, s.ang - Math.sign(s.lean) * 0.75, s.bend * 0.5, s.len * 0.45, s.col, 5, s.lseed + 0.5, false);
      }
    });
  }
}

function drawStripesTile(ctx, el, tw, th, cols) {
  const [bg, stripe, pin] = cols;
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, tw, th);
  // a wide stripe with a pinstripe on each side (Regency stripe), one per tile
  const sw = tw * 0.42;
  ctx.fillStyle = stripe;
  ctx.fillRect((tw - sw) / 2, 0, sw, th);
  ctx.fillStyle = pin || stripe;
  for (const x of [(tw - sw) / 2 - 0.012, (tw + sw) / 2 + 0.008]) ctx.fillRect(x, 0, 0.004, th);
}

function drawScallopTile(ctx, el, tw, th, cols) {
  const [bg, fill, line] = cols;
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, tw, th);
  // fish scales: full circles on a lattice (2r across, r down, every other row offset by r), drawn from the bottom row
  // up so each row covers the top of the row below – every scale shows a rounded bottom. The tile is 2r × 2r.
  const r = tw / 2;
  for (let k = 3; k >= -1; k--) {
    const off = Math.abs(k) % 2 ? r : 0;
    for (let i = -1; i <= 1; i++) {
      const cx = off + i * 2 * r, cy = k * r;
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = line || bg;
      for (const [kk, lw] of [[0.97, 0.003], [0.7, 0.0018], [0.45, 0.0014]]) {
        ctx.lineWidth = lw;
        ctx.beginPath();
        ctx.arc(cx, cy, r * kk, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }
}

function drawGrassclothTile(ctx, el, tw, th, cols) {
  const [bg] = cols;
  const R = K.rng(`wp-grass:${el.seed ?? 1}`);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, tw, th);
  // horizontal grass fibres of varying tone and thickness
  let y = 0;
  while (y < th) {
    const t = 0.0015 + R() * 0.004;
    const l = (R() - 0.5) * 0.22;
    ctx.fillStyle = shade(bg, l * 0.5, l * 0.1);
    ctx.globalAlpha = 0.55 + R() * 0.45;
    // fibres break off along the width
    let x = -R() * 0.2;
    while (x < tw) {
      const len = 0.05 + R() * 0.3;
      ctx.fillRect(x, y, len, t);
      x += len + R() * 0.02;
    }
    y += t * (0.6 + R() * 0.6);
  }
  ctx.globalAlpha = 1;
  // fine warp threads and the roll seam (grasscloth shows its 91 cm panels)
  ctx.fillStyle = shade(bg, -0.12);
  ctx.globalAlpha = 0.25;
  for (let x = 0.012; x < tw; x += 0.012) ctx.fillRect(x, 0, 0.0006, th);
  ctx.globalAlpha = 0.7;
  ctx.fillRect(0, 0, 0.0015, th);
  ctx.globalAlpha = 1;
}

/** Texture set for a wallpaper element: { map, mural, tile: [w, h] }. */
function wallpaperTexture(el, w, h) {
  const pattern = el.pattern || 'botanical';
  const cols = (el.colors?.length ? el.colors : DEFAULTS.wallpaper.colors).map((c) => resolveColor(c));
  const sc = clamp(num(el.scale, 1), 0.4, 3);
  if (pattern === 'mural') {
    const ppm = QUALITY === 'low' ? 140 : QUALITY === 'high' ? 300 : 220;
    const key = `wp|mural|${cols.join(',')}|${el.seed ?? 1}|${el.sun}|${w.toFixed(3)}|${h.toFixed(3)}|${num(el.u, 0).toFixed(3)}|${ppm}`;
    return cachedTexture(key, () => {
      const W = clamp(Math.round(w * ppm), 64, 1400), H = clamp(Math.round(h * ppm), 64, 1200);
      const c = createCanvas(W, H);
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.save();
      ctx.scale(W / w, H / h);
      drawLandscape(ctx, { ...el, palette: cols }, w, h);
      ctx.restore();
      speckle(ctx, W, H, `wp:${el.seed}`, 0.03, 0.003);
      const tex = canvasTexture(c, { repeat: [1 / w, 1 / h], wrap: false });
      tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
      return { map: tex, mural: true };
    });
  }
  const [tw0, th0] = WALLPAPER_TILE[pattern] || WALLPAPER_TILE.botanical;
  const tw = tw0 * sc, th = th0 * sc;
  const ppm = QUALITY === 'low' ? 500 : QUALITY === 'high' ? 1100 : 800;
  const key = `wp|${pattern}|${cols.join(',')}|${el.seed ?? 1}|${sc}|${ppm}`;
  return cachedTexture(key, () => {
    const W = clamp(Math.round(tw * ppm), 32, 1024), H = clamp(Math.round(th * ppm), 32, 1024);
    const c = createCanvas(W, H);
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.save();
    ctx.scale(W / tw, H / th);
    if (pattern === 'stripes') drawStripesTile(ctx, el, tw, th, cols);
    else if (pattern === 'scallop') drawScallopTile(ctx, el, tw, th, cols);
    else if (pattern === 'grasscloth') drawGrassclothTile(ctx, el, tw, th, cols);
    else drawBotanicalTile(ctx, el, tw, th, cols);
    ctx.restore();
    speckle(ctx, W, H, `wp:${pattern}:${el.seed}`, pattern === 'grasscloth' ? 0.08 : 0.025, 0.002);
    return { map: canvasTexture(c, { repeat: [1 / tw, 1 / th] }), mural: false };
  });
}

/** Lime-wash (kalkmaling) texture: cloudy, brushed lightness variation around 1.0; tile 1.6 m. */
function limewashSet() {
  return cachedTexture('limewash', () => {
    const N = QUALITY === 'low' ? 256 : 512;
    const tile = 1.6;
    const c = createCanvas(N, N);
    const ctx = c.getContext('2d', { willReadFrequently: true });
    const noise = createNoise2D(31);
    const img = ctx.createImageData(N, N);
    const d = img.data;
    // tileable fbm: sample the noise on a torus (two circles) so the edges match
    const T = Math.PI * 2;
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const a = (x / N) * T, b = (y / N) * T;
        let s = 0, amp = 1, f = 1, norm = 0;
        for (let o = 0; o < 4; o++) {
          s += amp * noise(Math.cos(a) * f * 1.3 + Math.cos(b) * f * 0.4 + o * 7, Math.sin(a) * f * 1.3 + Math.sin(b) * f * 1.1 + o * 3);
          norm += amp;
          amp *= 0.55;
          f *= 2.1;
        }
        const v = 200 + (s / norm) * 15;
        const i = (y * N + x) * 4;
        d[i] = d[i + 1] = d[i + 2] = clamp(v, 0, 255);
        d[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    // soft criss-cross brush strokes (faint: lime wash reads as clouds, not as smudges)
    const R = K.rng('limewash');
    ctx.lineCap = 'round';
    for (let i = 0; i < 140; i++) {
      const x = R() * N, y = R() * N, len = (0.12 + R() * 0.28) * (N / tile), ang = (R() < 0.5 ? 0.6 : -0.6) + (R() - 0.5) * 0.8;
      ctx.strokeStyle = R() < 0.5 ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.018)';
      ctx.lineWidth = (0.04 + R() * 0.07) * (N / tile);
      for (const ox of [-N, 0, N]) for (const oy of [-N, 0, N]) {
        ctx.beginPath();
        ctx.moveTo(x + ox, y + oy);
        ctx.quadraticCurveTo(x + ox + Math.cos(ang) * len * 0.5 + (R() - 0.5) * 6, y + oy + Math.sin(ang) * len * 0.5, x + ox + Math.cos(ang) * len, y + oy + Math.sin(ang) * len);
        ctx.stroke();
      }
    }
    const ref = canvasRef(c);
    const normal = heightToNormalCanvas(canvasHeights(c, 0.25), N, N, 1.2);
    const n = createCanvas(N, N);
    n.getContext('2d').drawImage(normal, 0, 0);
    return {
      map: canvasTexture(c, { repeat: [1 / tile, 1 / tile] }),
      normalMap: canvasTexture(n, { repeat: [1 / tile, 1 / tile], srgb: false }),
      ref,
    };
  });
}

function limewashMat(hex) {
  const c = resolveColor(hex, '#cfc5b4');
  return ownMat(`limewash|${c}|${QUALITY}`, () => {
    const set = limewashSet();
    const color = new THREE.Color(c).multiplyScalar(1 / set.ref);
    const m = new THREE.MeshStandardMaterial({ color, map: set.map, normalMap: set.normalMap, normalScale: new THREE.Vector2(0.2, 0.2), roughness: 0.96 });
    m.name = `limewash ${c}`;
    return m;
  });
}

/** Normal map of a cached kind (fabric relief on prints/tapestries) – shared, never disposed here. */
function kindNormal(kind) {
  return mat(kind, '#ffffff').normalMap || null;
}

/** Material for a canvas texture: map on metre UVs + a fabric normal map. NEW material (disposed with the model). */
function printMaterial(set, { normalKind = 'felt', normalScale = 0.35, roughness = 0.94 } = {}) {
  const m = new THREE.MeshStandardMaterial({ map: set.map, roughness, metalness: 0 });
  const n = normalKind ? kindNormal(normalKind) : null;
  if (n) {
    m.normalMap = n;
    m.normalScale = new THREE.Vector2(normalScale, normalScale);
  }
  m.name = 'wall-print';
  m.userData = { cached: false, kind: 'wall-print' };
  return m;
}

// ---------------------------------------------------------------------------------------------------------------
// Element geometry helpers

/** Wall-coordinate bounds of an element: { u0, v0, u1, v1, depth }. */
export function elementBounds(el) {
  if (!el) return null;
  const t = el.type;
  if (t === 'circles' || t === 'hooks' || (t === 'hexagons' && el.items?.length)) {
    const items = el.items || [];
    if (!items.length) return { u0: 0, v0: 0, u1: 0, v1: 0, depth: 0 };
    let u0 = Infinity, v0 = Infinity, u1 = -Infinity, v1 = -Infinity;
    const r = t === 'circles' ? null : t === 'hooks' ? 0.03 : num(el.size, 0.52) / Math.sqrt(3);
    for (const it of items) {
      const rr = t === 'circles' ? num(it.r, 0.4) : r;
      const ru = t === 'hooks' ? 0.035 : rr, rv = t === 'hooks' ? 0.05 : t === 'hexagons' ? num(el.size, 0.52) / 2 : rr;
      u0 = Math.min(u0, it.cu - ru);
      u1 = Math.max(u1, it.cu + ru);
      v0 = Math.min(v0, it.cv - rv);
      v1 = Math.max(v1, it.cv + rv);
    }
    const depth = t === 'hooks' ? 0.08 : items.reduce((s, it) => Math.max(s, num(it.depth, 0)), num(el.depth, 0.04));
    return { u0, v0, u1, v1, depth };
  }
  if (t === 'hexagons') return { u0: num(el.u, 0), v0: num(el.v, 0), u1: num(el.u, 0) + num(el.w, 1), v1: num(el.v, 0) + num(el.h, 1), depth: num(el.depth, 0.025) };
  if (t === 'curtain') {
    const u = num(el.u, 0), w = num(el.w, 3.78);
    return { u0: u, v0: num(el.bottom, 0.01), u1: u + w, v1: num(el.top, WALL_H), depth: 0.24 };
  }
  if (t === 'lamp-wall') {
    const cu = num(el.cu, 0.5), cv = num(el.cv, 1.7);
    return { u0: cu - 0.13, v0: cv - 0.15, u1: cu + 0.13, v1: cv + 0.15, depth: el.style === 'arm' ? 0.35 : 0.15 };
  }
  if (t === 'plant') {
    const cu = num(el.cu, 0.5), hh = num(el.height, 1.5);
    const r = clamp(hh * 0.3, 0.25, 0.55);
    return { u0: cu - r, v0: 0, u1: cu + r, v1: hh, depth: 2 * r + 0.06 };
  }
  if (t === 'led') {
    const u = num(el.u, 0), w = num(el.w, 1), v = num(el.v, 1.2);
    return { u0: u, v0: v - 0.02, u1: u + w, v1: v + 0.01, depth: 0.05 };
  }
  if (t === 'shelf') {
    const u = num(el.u, 0), w = num(el.w, 1), v = num(el.v, 1), th = num(el.thickness, 0.04);
    return { u0: u, v0: v, u1: u + w, v1: v + th, depth: num(el.d, 0.22) };
  }
  if (t === 'ledge') {
    const u = num(el.u, 0), w = num(el.w, 1), v = num(el.v, 1.3);
    const top = (el.items || []).reduce((s, it) => Math.max(s, num(it.h, 0.6)), 0.03);
    return { u0: u, v0: v, u1: u + w, v1: v + 0.025 + top, depth: num(el.d, 0.09) };
  }
  const u = num(el.u, 0), v = num(el.v, 0), w = num(el.w, 1), h = num(el.h, 1);
  let depth = num(el.depth, 0.03);
  if (t === 'slats') depth = num(el.standoff, 0.02) + (el.backing === 'none' ? 0 : FELT_T) + num(el.slatD, 0.012) + num(el.waveAmp, 0);
  else if (t === 'sideboard-floating' || t === 'bookcase') depth = num(el.d, t === 'bookcase' ? 0.3 : 0.4);
  else if (t === 'paint-block' || t === 'wallpaper') depth = 0.002;
  else if (t === 'moulding') {
    depth = num(el.relief, 0.018) + (el.rail === false ? 0 : 0.008);
    return { u0: u, v0: v, u1: u + w, v1: v + h + (el.rail === false ? 0 : num(el.railH, 0.06)), depth };
  }
  else if (t === 'tapestry') depth = el.rod === false ? 0.02 : 0.07;
  return { u0: u, v0: v, u1: u + w, v1: v + h, depth };
}

function box3(min, max) {
  return { min: [...min], max: [...max] };
}

// ---------------------------------------------------------------------------------------------------------------
// Builders – ctx = { g, B (Batch), lights, surfaces, colliders, fronts (covering faces for fixtures), index }

function buildSlats(ctx, el) {
  const u = num(el.u, 0), v = num(el.v, 0), w = Math.max(0.03, num(el.w, 1)), h = Math.max(0.03, num(el.h, 1));
  const slatW = clamp(num(el.slatW, 0.027), 0.005, 0.2);
  const slatD = clamp(num(el.slatD, 0.012), 0.003, 0.08);
  const gap = clamp(num(el.gap, 0.013), 0.001, 0.2);
  const standoff = clamp(num(el.standoff, 0), 0, 0.2);
  const felt = el.backing !== 'none';
  const vertical = el.orientation !== 'horizontal';
  const kind = woodKind(el.wood);
  const base = resolveColor(el.slatColor, WOOD_PRESETS[kind]?.hex || '#b08b62');
  const B = ctx.B;
  const R = K.rng(`slats:${ctx.index}:${u.toFixed(2)}:${v.toFixed(2)}`);
  const feltT = felt ? FELT_T : 0;
  const zBack = standoff;
  // thin slats glued straight on the wall (montage T): the narrow grooves read as fine dark lines in the wood, not as
  // black stripes – standard black felt is shown in a dark tone of the slat colour there (any other felt colour as chosen)
  let feltHex = resolveColor(el.backingColor, '#1b1b1b');
  if (standoff < 0.005 && slatD <= 0.01 && gap <= 0.01 && lum(feltHex) < 0.02 && kind !== 'painted' && kind !== 'lacquer') feltHex = mixHex(feltHex, shade(base, -0.17), 0.62);
  if (felt) {
    const feltMat = mat('felt', feltHex);
    B.box(feltMat, 'backing', u + w / 2, v + h / 2, zBack + feltT / 2, w, h, feltT, { skip: '-z' });
  }
  // the skirting board comes off behind panels that stand on the floor: hide it between thin, direct-mounted slats
  const skirt = roomLayout?.baseboard || { height: 0.07, thickness: 0.012 };
  if (v < skirt.height && standoff < skirt.thickness + 0.002) {
    const hh = skirt.height - v + 0.004;
    B.box(mat('felt', feltHex), 'backing', u + w / 2, v + hh / 2, (skirt.thickness + 0.003) / 2, w, hh, skirt.thickness + 0.003, { skip: '-z' });
  }
  // battens + mineral wool behind: the open edges read as a dark shadow gap
  if (standoff > 0.004) {
    const dark = mat('felt', '#141414');
    B.box(dark, 'backing', u + w / 2, v + h / 2, standoff / 2, Math.max(0.01, w - 0.012), Math.max(0.01, h - 0.004), standoff, { skip: '-z+z' });
  }
  // slats: three tones (real oak slats vary), random grain offset per slat
  const tones = kind === 'painted' || kind === 'lacquer'
    ? [mat(kind, base)]
    : [woodMat(kind, shade(base, -0.025)), woodMat(kind, base), woodMat(kind, shade(base, 0.022))];
  const along = vertical ? w : h;
  const pitch = slatW + gap;
  const n = Math.max(1, Math.floor((along + gap) / pitch + 1e-6));
  const start = (along - (n * pitch - gap)) / 2 + slatW / 2;
  // wave (bølgespiler): every slat a little deeper or shallower, so the wall reads as a slow wave in the side light
  const waveAmp = clamp(num(el.waveAmp, 0), 0, 0.12);
  const wavePer = clamp(num(el.wavePeriod, 1.3), 0.2, 8);
  const wavePh = num(el.wavePhase, 0);
  let maxD = slatD;
  for (let i = 0; i < n; i++) {
    const m = tones[Math.floor(R() * tones.length) % tones.length];
    const c = start + i * pitch;
    const sd = waveAmp ? slatD + waveAmp * (0.5 + 0.5 * Math.sin((((vertical ? u : v) + c) / wavePer) * Math.PI * 2 + wavePh)) : slatD;
    maxD = Math.max(maxD, sd);
    const zc = zBack + feltT + sd / 2;
    if (vertical) B.box(m, 'slats', u + c, v + h / 2, zc, slatW, h, sd, { grain: 'y', uOff: R() * 3, skip: '-z' });
    else B.box(m, 'slats', u + w / 2, v + c, zc, w, slatW, sd, { grain: 'x', uOff: R() * 3, skip: '-z' });
  }
  // end trims (oak cover strips over the open sides when the panel stands off the wall on battens)
  if (standoff > 0.015) {
    const trim = woodMat(kind, base);
    const d = standoff + feltT + slatD;
    if (vertical) {
      for (const x of [u + 0.006, u + w - 0.006]) B.box(trim, 'slats', x, v + h / 2, d / 2, 0.012, h, d, { grain: 'y', uOff: R() * 3, skip: '-z' });
      // a band that floats above the floor gets a bottom end trim: it closes the open slat ends, so the spots above do
      // not leak striped light through the gaps onto the paint below (E, N3)
      if (v > 0.02) B.box(trim, 'slats', u + w / 2, v + 0.006, (d + 0.001) / 2, w, 0.012, d + 0.001, { grain: 'x', uOff: R() * 3, skip: '-z' });
    } else {
      for (const y of [v + 0.006, v + h - 0.006]) B.box(trim, 'slats', u + w / 2, y, d / 2, w, 0.012, d, { grain: 'x', uOff: R() * 3, skip: '-z' });
    }
  }
  ctx.fronts.push({ u0: u, v0: v, u1: u + w, v1: v + h, z: zBack + feltT + maxD });
}

function buildChecker(ctx, el) {
  const tile = clamp(num(el.tile, 0.6), 0.15, 1.5);
  const cols = clamp(Math.round(num(el.cols, Math.round(num(el.w, 3.6) / tile))), 1, 12);
  const rows = clamp(Math.round(num(el.rows, Math.round(num(el.h, 1.8) / tile))), 1, 8);
  const u = num(el.u, 0), v = num(el.v, 0);
  const gap = clamp(num(el.gap, 0.003), 0, 0.05);
  const depth = clamp(num(el.depth, 0.021), 0.005, 0.12);
  const colors = [resolveColor(el.colors?.[0], '#b08b62'), resolveColor(el.colors?.[1] ?? el.colors?.[0], '#b08b62')];
  const woods = [woodKind(el.woods?.[0] || el.wood), woodKind(el.woods?.[1] || el.woods?.[0] || el.wood)];
  const slatW = clamp(num(el.slatW, 0.027), 0.005, 0.1);
  const slatGap = clamp(num(el.slatGap, 0.013), 0.002, 0.1);
  const startV = el.startOrientation !== 'horizontal';
  const B = ctx.B;
  const s = tile - gap;
  const R = K.rng(`checker:${ctx.index}`);
  const felt = el.fill === 'felt';
  const backing = mat('felt', resolveColor(el.backingColor, '#1b1b1b'));
  const toneCache = new Map();
  const tonesOf = (parity) => {
    let t = toneCache.get(parity);
    if (!t) {
      const k = woods[parity], c = colors[parity];
      t = k === 'painted' || k === 'lacquer' ? [mat(k, c)] : [woodMat(k, shade(c, -0.022)), woodMat(k, c), woodMat(k, shade(c, 0.02))];
      toneCache.set(parity, t);
    }
    return t;
  };
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const parity = (r + c) % 2;
      const x0 = u + c * tile + gap / 2;
      const y0 = v + (rows - 1 - r) * tile + gap / 2;
      // 'wood-felt': slat tiles (colour A) alternate with felt tiles (colour B)
      if (felt || (el.fill === 'wood-felt' && parity === 1)) {
        const m = mat('felt', colors[parity]);
        const geo = K.roundedBox(s, s, depth, 0.004, 2);
        ctx.g.add(K.partMesh(geo, m, 'panel', { position: [x0 + s / 2, y0 + s / 2, depth / 2] }));
        continue;
      }
      const feltT = Math.min(FELT_T, depth * 0.45);
      const slatD = depth - feltT;
      B.box(backing, 'backing', x0 + s / 2, y0 + s / 2, feltT / 2, s, s, feltT, { skip: '-z' });
      const vertical = parity === 0 ? startV : !startV;
      const pitch = slatW + slatGap;
      const n = Math.max(1, Math.floor((s + slatGap) / pitch + 1e-6));
      const st = (s - (n * pitch - slatGap)) / 2 + slatW / 2;
      const tones = tonesOf(parity);
      for (let i = 0; i < n; i++) {
        const m = tones[Math.floor(R() * tones.length) % tones.length];
        if (vertical) B.box(m, 'slats', x0 + st + i * pitch, y0 + s / 2, feltT + slatD / 2, slatW, s, slatD, { grain: 'y', uOff: R() * 3, skip: '-z' });
        else B.box(m, 'slats', x0 + s / 2, y0 + st + i * pitch, feltT + slatD / 2, s, slatW, slatD, { grain: 'x', uOff: R() * 3, skip: '-z' });
      }
    }
  }
  ctx.fronts.push({ u0: u, v0: v, u1: u + cols * tile, v1: v + rows * tile, z: depth });
}

function surfaceMaterial(surface, hex) {
  const s = surface || 'fabric';
  if (s === 'mirror') return mat('mirror', '#d9dcdc');
  if (s === 'cork') return mat('cork', hex || '#a9825a');
  if (s === 'wood-concrete') return woodWoolMat(hex);
  if (FABRIC_KIND[s]) return mat(FABRIC_KIND[s], hex);
  if (kindGroup(s)) return mat(s, hex);
  return mat('woven', hex);
}

function buildPanel(ctx, el) {
  const u = num(el.u, 0), v = num(el.v, 0), w = Math.max(0.05, num(el.w, 1)), h = Math.max(0.05, num(el.h, 1));
  const depth = clamp(num(el.depth, 0.05), 0.004, 0.2);
  const color = resolveColor(el.color, '#3a3b40');
  const surface = el.surface || 'fabric';
  const edge = el.edge || 'square';
  const g = ctx.g;
  const cx = u + w / 2, cy = v + h / 2;
  if (edge === 'frame') {
    const fw = surface === 'mirror' ? 0.025 : 0.03;
    const fd = depth + 0.006;
    const frameHex = resolveColor(el.frameColor, '#1f1f1f');
    const fm = lum(frameHex) < 0.12 ? mat('black-metal', frameHex) : woodMat(kindGroup(el.frameMaterial) === 'wood' ? el.frameMaterial : 'oak', frameHex);
    const B = ctx.B;
    B.box(fm, 'frame', cx, v + h - fw / 2, fd / 2, w, fw, fd, { skip: '-z' });
    B.box(fm, 'frame', cx, v + fw / 2, fd / 2, w, fw, fd, { skip: '-z' });
    B.box(fm, 'frame', u + fw / 2, cy, fd / 2, fw, h - 2 * fw, fd, { grain: 'y', skip: '-z' });
    B.box(fm, 'frame', u + w - fw / 2, cy, fd / 2, fw, h - 2 * fw, fd, { grain: 'y', skip: '-z' });
    const iw = w - 2 * fw, ih = h - 2 * fw;
    if (surface === 'mirror') {
      g.add(K.partMesh(K.box(iw, ih, 0.006), mat('mirror', '#d9dcdc'), 'panel', { position: [cx, cy, fd - 0.008] }));
    } else {
      // fabric stretched in the frame, a few millimetres behind its front
      const pm = surfaceMaterial(surface, color);
      g.add(K.partMesh(K.roundedBox(iw + 0.004, ih + 0.004, depth - 0.004, 0.004, 2), pm, 'panel', { position: [cx, cy, (depth - 0.004) / 2] }));
    }
  } else if (edge === 'channel') {
    // channel tufting: softly rounded upholstered bars side by side, the seams between them read as grooves
    const geo = K.roundedBox(Math.max(0.02, w - 0.004), h, depth, Math.min(depth * 0.48, w * 0.3), 4);
    g.add(K.partMesh(geo, surfaceMaterial(surface, color), 'panel', { position: [cx, cy, depth / 2] }));
  } else if (edge === 'rounded') {
    // upholstered cushion (bench backs)
    const geo = K.cushion(w, h, depth, { axis: 'z', puff: 0.22, round: 0.8, top: 1, bottom: 0, sides: 0.18, seg: 12 });
    g.add(K.partMesh(geo, surfaceMaterial(surface, color), 'panel', { position: [cx, cy, depth / 2] }));
  } else if (surface === 'cork' || surface === 'mirror' || kindGroup(surface) === 'wood') {
    const geo = K.box(w, h, depth, { grain: h > w ? 'y' : 'x' });
    g.add(K.partMesh(geo, surfaceMaterial(surface, color), 'panel', { position: [cx, cy, depth / 2] }));
    // cork walls: the boards' joints (60 × 90 cm)
    if (surface === 'cork' && w * h > 1.5) {
      const jm = mat('cork', shade(color, -0.06));
      for (let x = u + 0.9; x < u + w - 0.05; x += 0.9) ctx.B.box(jm, 'panel', x, cy, depth + 0.0004, 0.0025, h, 0.0008, { skip: '-z' });
      for (let y = v + 0.6; y < v + h - 0.05; y += 0.6) ctx.B.box(jm, 'panel', cx, y, depth + 0.0004, w, 0.0025, 0.0008, { skip: '-z' });
    }
  } else {
    // fabric-wrapped absorber: softly rounded edges
    const geo = K.roundedBox(w, h, depth, Math.min(0.008, depth / 3), 2);
    g.add(K.partMesh(geo, surfaceMaterial(surface, color), 'panel', { position: [cx, cy, depth / 2] }));
  }
  ctx.fronts.push({ u0: u, v0: v, u1: u + w, v1: v + h, z: depth });
}

function frameMaterialFor(frame) {
  if (frame === 'black') return mat('black-metal', '#1d1d1d');
  if (frame === 'white') return mat('painted', '#ece8e0');
  if (frame === 'walnut') return mat('walnut', WOOD_PRESETS.walnut.hex);
  if (frame === 'smoked-oak') return mat('smoked-oak', WOOD_PRESETS['smoked-oak'].hex);
  return mat('oak', '#b79267');
}

function buildArt(ctx, el) {
  const u = num(el.u, 0), v = num(el.v, 0), w = Math.max(0.1, num(el.w, 1)), h = Math.max(0.1, num(el.h, 1));
  const acoustic = el.acoustic !== false;
  const depth = clamp(num(el.depth, acoustic ? 0.045 : 0.025), 0.01, 0.12);
  const frame = el.frame || 'none';
  const g = ctx.g;
  const B = ctx.B;
  const cx = u + w / 2, cy = v + h / 2;
  const fw = frame === 'none' ? 0 : frame === 'black' ? 0.016 : 0.022;
  const mount = frame !== 'none' && !acoustic ? 0.06 : 0; // passe-partout for ordinary prints
  const iw = w - 2 * fw - 2 * mount, ih = h - 2 * fw - 2 * mount;
  if (iw < 0.05 || ih < 0.05) return;
  const set = artTexture({ ...el, u: u + fw + mount }, iw, ih);
  // a picture hung on a slat wall / panel hangs on its face, not inside it
  let z0 = 0;
  for (const e of ctx.elements || []) {
    if (!e || e === el || !['slats', 'checker', 'panel', 'moss'].includes(e.type)) continue;
    const b = elementBounds(e);
    if (b && cx >= b.u0 && cx <= b.u1 && cy >= b.v0 && cy <= b.v1) z0 = Math.max(z0, b.depth);
  }
  if (fw) {
    const fm = frameMaterialFor(frame);
    const fd = depth + 0.004;
    B.box(fm, 'frame', cx, v + h - fw / 2, z0 + fd / 2, w, fw, fd, { skip: '-z' });
    B.box(fm, 'frame', cx, v + fw / 2, z0 + fd / 2, w, fw, fd, { skip: '-z' });
    B.box(fm, 'frame', u + fw / 2, cy, z0 + fd / 2, fw, h - 2 * fw, fd, { grain: 'y', skip: '-z' });
    B.box(fm, 'frame', u + w - fw / 2, cy, z0 + fd / 2, fw, h - 2 * fw, fd, { grain: 'y', skip: '-z' });
  }
  if (mount) {
    const pm = mat('paper', '#f1ece2');
    B.box(pm, 'print', cx, cy, z0 + depth - 0.006, w - 2 * fw, h - 2 * fw, 0.002, { skip: '-z' });
  }
  // body: fabric-wrapped absorber (sides in the background colour) or a thin print board
  const bodyD = mount ? depth - 0.008 : depth - 0.0015;
  const sideMat = mat(acoustic ? 'woven' : 'paper', set.edge);
  const bw = mount ? w - 2 * fw - 0.002 : iw, bh = mount ? h - 2 * fw - 0.002 : ih;
  B.box(sideMat, 'print', cx, cy, z0 + bodyD / 2, bw, bh, bodyD, { skip: '-z+z' });
  // the print face (metre UVs from the lower-left corner of the image)
  const face = new THREE.PlaneGeometry(iw, ih);
  const uv = face.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * iw, uv.getY(i) * ih);
  const pmat = printMaterial(set, { normalKind: acoustic ? 'felt' : 'paper', normalScale: acoustic ? 0.4 : 0.15, roughness: acoustic ? 0.95 : 0.8 });
  g.add(K.partMesh(face, pmat, 'print', { position: [cx, cy, z0 + (mount ? depth - 0.0045 : depth)] }));
  ctx.fronts.push({ u0: u, v0: v, u1: u + w, v1: v + h, z: z0 + depth });
}

function buildTapestry(ctx, el) {
  const u = num(el.u, 0), v = num(el.v, 0), w = Math.max(0.2, num(el.w, 2)), h = Math.max(0.2, num(el.h, 1.5));
  const set = tapestryTexture(el, w, h);
  const g = ctx.g;
  const zc = el.rod === false ? 0.008 : 0.035;
  // gently rippled textile (heavier toward the bottom)
  const sx = Math.max(8, Math.round(w / (QUALITY === 'low' ? 0.08 : 0.04)));
  const sy = 6;
  const geo = new THREE.PlaneGeometry(w, h, sx, sy);
  const pos = geo.attributes.position;
  const uv = geo.attributes.uv;
  const R = K.rng(`tap:${ctx.index}`);
  const ph = R() * 6.28, ph2 = R() * 6.28;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i);
    const t = 0.5 - y / h; // 0 top … 1 bottom
    const z = (0.004 + 0.006 * t) * Math.sin((x / 0.31) * Math.PI * 2 + ph) + 0.002 * Math.sin((x / 0.13) * Math.PI * 2 + ph2) - zc * t * 0.55;
    pos.setZ(i, z);
    uv.setXY(i, uv.getX(i) * w, uv.getY(i) * h);
  }
  geo.computeVertexNormals();
  // front side only (it hangs against the wall): the same shader program as the art prints
  const tm = printMaterial(set, { normalKind: 'wool', normalScale: 0.9, roughness: 0.97 });
  g.add(K.partMesh(geo, tm, 'fabric', { position: [u + w / 2, v + h / 2, zc] }));
  if (el.rod !== false) {
    const rodHex = resolveColor(el.rodColor, '#1e1e1e');
    const rm = lum(rodHex) < 0.15 ? mat('black-metal', rodHex) : woodMat('oak', rodHex);
    const len = w + 0.22;
    const rod = K.cylinder(0.011, 0.011, len, { seg: 16, center: true });
    rod.rotateZ(Math.PI / 2);
    g.add(K.partMesh(rod, rm, 'frame', { position: [u + w / 2, v + h + 0.012, zc + 0.002] }));
    for (const sgn of [-1, 1]) {
      const fin = K.sphere(0.02, { wSeg: 14, hSeg: 10 });
      g.add(K.partMesh(fin, rm, 'frame', { position: [u + w / 2 + (sgn * len) / 2, v + h + 0.012, zc + 0.002] }));
      ctx.B.box(rm, 'frame', u + w / 2 + sgn * (w / 2 + 0.05), v + h + 0.012, (zc + 0.01) / 2, 0.018, 0.03, zc + 0.01, { skip: '-z' });
    }
  }
  if (el.fringe !== false) {
    const fs = fringeSet();
    const fl = 0.09;
    const fgeo = new THREE.PlaneGeometry(w, fl);
    const fuv = fgeo.attributes.uv;
    for (let i = 0; i < fuv.count; i++) fuv.setX(i, fuv.getX(i) * (w / 0.16));
    const fmap = fs.map.clone();
    fmap.repeat.set(1, 1);
    fmap.wrapS = THREE.RepeatWrapping;
    fmap.needsUpdate = true;
    const fm = new THREE.MeshStandardMaterial({ color: new THREE.Color(set.fringe), alphaMap: fmap, alphaTest: 0.5, roughness: 0.95, side: THREE.DoubleSide });
    fm.userData = { cached: false, kind: 'wall-fringe', ownedTextures: [fmap] };
    const fringe = K.partMesh(fgeo, fm, 'fabric', { position: [u + w / 2, v - fl / 2 + 0.004, zc - zc * 0.55 - 0.002] });
    fringe.userData.noMerge = true;
    g.add(fringe);
  }
  ctx.colliders.push(box3([u, v, 0], [u + w, v + h, 0.06]));
}

function buildCircles(ctx, el) {
  const depth = clamp(num(el.depth, 0.05), 0.005, 0.12);
  const items = Array.isArray(el.items) ? el.items : [];
  for (const it of items) {
    const r = clamp(num(it.r, 0.4), 0.05, 1.5);
    const bevel = Math.min(0.008, depth / 3);
    const shape = new THREE.Shape();
    shape.absarc(0, 0, r, 0, Math.PI * 2, false);
    const geo = K.extrudeShape(shape, depth, { bevel, bevelSegments: 3, curveSegments: 72 });
    K.worldUV(geo);
    ctx.g.add(K.partMesh(geo, surfaceMaterial(el.surface || 'felt', resolveColor(it.color, '#b9ab90')), 'panel', { position: [num(it.cu, 1), num(it.cv, 1.5), 0] }));
  }
}

function hexShape(R, flatTop) {
  const s = new THREE.Shape();
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i + (flatTop ? 0 : Math.PI / 6);
    const x = Math.cos(a) * R, y = Math.sin(a) * R;
    if (i) s.lineTo(x, y);
    else s.moveTo(x, y);
  }
  s.closePath();
  return s;
}

/** Honeycomb cluster positions (flat-top) ordered from the centre outward. */
function honeycomb(count, size, cu, cv) {
  const R = size / Math.sqrt(3);
  const cells = [];
  for (let q = -6; q <= 6; q++) {
    for (let r = -6; r <= 6; r++) {
      const x = 1.5 * R * q + 0.01 * q;
      const y = size * (r + (Math.abs(q) % 2 ? 0.5 : 0));
      cells.push({ x, y, d: Math.hypot(x * 0.8, y * 1.15) });
    }
  }
  cells.sort((a, b) => a.d - b.d || a.x - b.x);
  return cells.slice(0, count).map((c) => ({ cu: +(cu + c.x).toFixed(3), cv: +(cv + c.y).toFixed(3) }));
}

function buildHexagons(ctx, el) {
  const size = clamp(num(el.size, 0.52), 0.1, 1.2); // flat-to-flat
  const depth = clamp(num(el.depth, 0.025), 0.005, 0.1);
  const flatTop = el.orientation !== 'pointy-top';
  const colors = (el.colors?.length ? el.colors : DEFAULTS.hexagons.colors).map((c) => resolveColor(c));
  let items = Array.isArray(el.items) && el.items.length ? el.items : null;
  if (!items) {
    const u = num(el.u, 0.5), v = num(el.v, 0.5), w = num(el.w, 2.5), hh = num(el.h, 1.6);
    const n = Math.max(1, Math.round(num(el.count, 12)));
    items = honeycomb(n, size, u + w / 2, v + hh / 2).map((p, i) => ({ ...p, color: colors[i % 5 === 2 ? 1 : i % 7 === 4 ? 2 : 0] || colors[0] }));
  }
  const gap = 0.008;
  const R = (size - gap) / Math.sqrt(3);
  // items may have their own depth (relief in several depths) and surface (oak, felt, moss … in one honeycomb)
  const bases = new Map();
  const baseFor = (dp) => {
    let b = bases.get(dp);
    if (!b) bases.set(dp, (b = K.extrudeShape(hexShape(R, flatTop), dp, { bevel: Math.min(0.002, dp / 4), bevelSegments: 1, curveSegments: 6 })));
    return b;
  };
  for (const it of items) {
    const geo = baseFor(clamp(num(it.depth, depth), 0.005, 0.12)).clone();
    geo.translate(num(it.cu, 1), num(it.cv, 1), 0);
    const surf = it.surface || el.surface || 'wood-concrete';
    // wooden tiles: vertical grain, each tile cut from another part of the board
    if (kindGroup(surf) === 'wood') K.worldUV(geo, 1, { grain: 'y', offset: [num(it.cu, 1) * 3.1, num(it.cv, 1) * 1.7] });
    else K.worldUV(geo);
    ctx.g.add(K.partMesh(geo, surfaceMaterial(surf, resolveColor(it.color, colors[0])), 'panel'));
  }
  for (const b of bases.values()) b.dispose();
}

/** Arc-length ratio of a sine with k = 2πA/λ (numeric). */
function sineRatio(k) {
  let s = 0;
  const N = 64;
  for (let i = 0; i < N; i++) {
    const t = ((i + 0.5) / N) * Math.PI * 2;
    s += Math.sqrt(1 + (k * Math.cos(t)) ** 2);
  }
  return s / N;
}

function buildCurtain(ctx, el, hw) {
  const u = num(el.u, 0), w = Math.max(0.2, num(el.w, 3.78));
  const top = clamp(num(el.top, WALL_H), 0.5, WALL_H + 0.01);
  const bottom = clamp(num(el.bottom, 0.01), 0, top - 0.3);
  const fabric = FABRIC_KIND[el.fabric] || (kindGroup(el.fabric) === 'fabric' ? el.fabric : 'velvet');
  const color = resolveColor(el.color, '#667a62');
  const lambda = clamp(num(el.waveWidth, 0.135), 0.06, 0.5);
  const fullness = clamp(num(el.fullness, 2.2), 1.05, 3.2);
  // amplitude from the fullness (fabric width / track length), kept to a real wave-heading depth
  let lo = 0, hi = 12;
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    if (sineRatio(mid) < fullness) lo = mid;
    else hi = mid;
  }
  const A = Math.min(0.062, (lo * lambda) / (Math.PI * 2));
  const trackZ = Math.max(0.1, A + 0.06);
  // the ceiling slopes away from the wall: the track sits on the ceiling where it really is
  const ceilAt = (z) => {
    try {
      if (hw?.origin && hw.uDir && hw.normal && roomLayout?.ceilingHeightAt) {
        const p = hw.origin.clone().addScaledVector(hw.uDir, u + w / 2).addScaledVector(hw.normal, z);
        return Math.min(top, roomLayout.ceilingHeightAt(p.x, p.z));
      }
    } catch {
      /* flat fallback */
    }
    return top;
  };
  const ceil = ceilAt(trackZ);
  const g = ctx.g;
  const trackHex = resolveColor(el.trackColor, '#1e1e1e');
  const tm = lum(trackHex) < 0.2 ? mat('black-metal', trackHex) : mat('painted', trackHex);
  // «Skinne med dekklist» (default, montage C): an ~8 cm deep cover profile over the whole wave hides the heading;
  // «Synlig skinne»: the bare 26 mm track with the wave heads below it
  const pelmet = el.trackStyle !== 'rail';
  let fTop;
  if (pelmet) {
    const z0 = Math.max(0.01, trackZ - A - 0.022), z1 = trackZ + A + 0.022;
    const yTop = Math.max(ceilAt(z0), ceilAt(z1)) + 0.01; // into the sloping ceiling at the front
    const yBot = Math.min(ceilAt(z0), ceilAt(z1)) - 0.08;
    ctx.B.box(tm, 'rail', u + w / 2, (yTop + yBot) / 2, (z0 + z1) / 2, w + 0.03, yTop - yBot, z1 - z0);
    // the cover returns to the wall at the niche end (the curtain wraps back there too)
    if (u < 0.05) ctx.B.box(tm, 'rail', u + 0.006 - 0.015, (yTop + yBot) / 2, z0 / 2, 0.012, yTop - yBot, z0, { skip: '-z' });
    fTop = yBot + 0.012;
  } else {
    const trackH = 0.026;
    ctx.B.box(tm, 'rail', u + w / 2, ceil - trackH / 2, trackZ, w + 0.03, trackH, 0.032);
    fTop = ceil - trackH - 0.004;
  }
  const height = fTop - bottom;
  // wave geometry
  const perWave = QUALITY === 'low' ? 8 : QUALITY === 'high' ? 16 : 12;
  const nx = Math.max(8, Math.round((w / lambda) * perWave));
  const ny = QUALITY === 'low' ? 6 : 10;
  const R = K.rng(`curtain:${ctx.index}`);
  const N = createNoise2D(7 + ctx.index);
  const pos = new Float32Array((nx + 1) * (ny + 1) * 3);
  const nor = new Float32Array((nx + 1) * (ny + 1) * 3);
  const col = new Float32Array((nx + 1) * (ny + 1) * 3);
  const uvs = new Float32Array((nx + 1) * (ny + 1) * 2);
  const phase0 = R() * 0.2;
  const arc = new Float32Array(nx + 1);
  const ampAt = (s, t) => A * (0.88 + 0.16 * (N(s * 0.9, 0.3) * 0.5 + 0.5)) * (1 + 0.1 * t);
  const zAt = (s, t) => trackZ + ampAt(s, t) * Math.sin(((s / lambda) + phase0) * Math.PI * 2);
  let acc = 0;
  for (let i = 0; i <= nx; i++) {
    const s = (i / nx) * w;
    if (i) {
      const s0 = ((i - 1) / nx) * w;
      acc += Math.hypot(s - s0, zAt(s, 0) - zAt(s0, 0));
    }
    arc[i] = acc;
  }
  // folds read soft but high-contrast (montage C): the normals tilt a bit more than the true wave, and the troughs
  // toward the wall get a fold AO term (vertex colours), darker still just under the cover profile
  const TILT = 1.7;
  for (let j = 0; j <= ny; j++) {
    const t = j / ny; // 0 = top
    const y = fTop - height * t;
    const under = pelmet ? Math.max(0, 1 - (fTop - y) / 0.3) : 0;
    for (let i = 0; i <= nx; i++) {
      const s = (i / nx) * w;
      const k = j * (nx + 1) + i;
      const z = zAt(s, t);
      const ds = w / nx * 0.5;
      const dz = (zAt(s + ds, t) - zAt(s - ds, t)) / (2 * ds);
      pos[k * 3] = u + s;
      pos[k * 3 + 1] = y;
      pos[k * 3 + 2] = z;
      const l = Math.hypot(dz * TILT, 1);
      nor[k * 3] = (-dz * TILT) / l;
      nor[k * 3 + 1] = 0;
      nor[k * 3 + 2] = 1 / l;
      const a = Math.max(1e-4, ampAt(s, t));
      const f = clamp((z - (trackZ - a)) / (2 * a), 0, 1);
      const ao = (0.56 + 0.44 * f ** 0.8) * (1 - 0.18 * under);
      col[k * 3] = col[k * 3 + 1] = col[k * 3 + 2] = ao;
      uvs[k * 2] = arc[i];
      uvs[k * 2 + 1] = y;
    }
  }
  const idx = [];
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const a = j * (nx + 1) + i, b = a + 1, c = a + nx + 1, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(idx);
  geo.computeBoundingSphere();
  const fm = curtainMat(fabric, color);
  const fabricMesh = K.partMesh(geo, fm, 'fabric', { noMerge: true });
  g.add(fabricMesh);
  // a slightly heavier hem
  const hem = curtainMat(fabric, shade(color, -0.015));
  const hemGeo = geo.clone();
  const hp = hemGeo.attributes.position;
  for (let i = 0; i < hp.count; i++) {
    const y = hp.getY(i);
    const t = (fTop - y) / height;
    hp.setY(i, bottom + 0.045 * (1 - t));
    hp.setZ(i, hp.getZ(i) + 0.0035);
  }
  hemGeo.computeBoundingSphere();
  g.add(K.partMesh(hemGeo, hem, 'fabric', { noMerge: true }));
  // the curtain wraps back to the wall at the niche corner (return)
  if (u < 0.05) {
    const rp = [], rn = [], rc = [], ru = [], ri = [];
    for (let j = 0; j <= ny; j++) {
      const t = j / ny;
      const y = fTop - height * t;
      const z1 = zAt(0, t);
      rp.push(u + 0.002, y, 0.004, u + 0.002, y, z1);
      rn.push(-1, 0, 0, -1, 0, 0);
      rc.push(0.62, 0.62, 0.62, 0.7, 0.7, 0.7);
      ru.push(0.004, y, z1, y);
      if (j) ri.push((j - 1) * 2, j * 2, (j - 1) * 2 + 1, (j - 1) * 2 + 1, j * 2, j * 2 + 1);
    }
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.Float32BufferAttribute(rp, 3));
    rg.setAttribute('normal', new THREE.Float32BufferAttribute(rn, 3));
    rg.setAttribute('color', new THREE.Float32BufferAttribute(rc, 3));
    rg.setAttribute('uv', new THREE.Float32BufferAttribute(ru, 2));
    rg.setIndex(ri);
    rg.computeBoundingSphere();
    g.add(K.partMesh(rg, fm, 'fabric', { noMerge: true }));
  }
  ctx.colliders.push(box3([u, 0, 0], [u + w, top, trackZ + A + 0.02]));
}

/**
 * Curtain fabric: the cached fabric material with vertex colours on (fold AO) – shared, never disposed. Front side
 * only (the back of the waves faces the wall; the niche end has its return): with that it uses the same shader program
 * as the moss walls, so showing a curtain compiles no extra shader.
 */
function curtainMat(fabric, hex) {
  const base = mat(fabric, hex);
  return ownMat(`curtain-vc|${base.uuid}`, () => {
    const m = base.clone();
    m.vertexColors = true;
    m.name = `${base.name} (folds)`;
    return m;
  });
}

function mossMat(hex) {
  const c = resolveColor(hex, '#557030');
  return ownMat(`moss-vc|${c}`, () => {
    const m = mat('moss', c).clone();
    m.vertexColors = true;
    m.name = `moss ${c} (vertex colours)`;
    return m;
  });
}

function buildMoss(ctx, el) {
  const u = num(el.u, 0), v = num(el.v, 0), w = Math.max(0.1, num(el.w, 0.6)), h = Math.max(0.1, num(el.h, 0.6));
  const depth = clamp(num(el.depth, 0.04), 0.015, 0.12);
  const style = el.style || 'mix';
  const base = resolveColor(el.color, '#557030');
  const board = 0.012;
  const g = ctx.g;
  ctx.B.box(mat('black-oak', '#221d18'), 'backing', u + w / 2, v + h / 2, board / 2, w, h, board, { skip: '-z' });
  const cell = QUALITY === 'low' ? 0.022 : QUALITY === 'high' ? 0.01 : 0.014;
  const nx = Math.max(4, Math.round(w / cell)), ny = Math.max(4, Math.round(h / cell));
  const R = K.rng(`moss:${ctx.index}:${u.toFixed(2)}:${v.toFixed(2)}`);
  const N = createNoise2D(31 + ctx.index);
  // ball-moss clumps on a jittered grid (spatial hash for lookups)
  const bumps = [];
  const bc = style === 'flat' ? 0 : style === 'ball' ? 0.05 : 0.065;
  const hashCell = 0.12;
  const grid = new Map();
  if (bc) {
    for (let y = bc / 2; y < h; y += bc) {
      for (let x = bc / 2; x < w; x += bc) {
        if (style === 'mix' && N(x * 4, y * 4) > 0.35) continue;
        const b = { x: x + (R() - 0.5) * bc * 0.8, y: y + (R() - 0.5) * bc * 0.8, r: bc * (0.45 + R() * 0.45), t: 0.75 + R() * 0.45 };
        bumps.push(b);
        const key = `${Math.floor(b.x / hashCell)},${Math.floor(b.y / hashCell)}`;
        (grid.get(key) || grid.set(key, []).get(key)).push(b);
      }
    }
  }
  const relief = depth - board;
  const lightHex = new THREE.Color(shade(base, 0.05, -0.04));
  const reindeer = new THREE.Color('#9c9c74');
  const baseC = new THREE.Color(base);
  const pos = new Float32Array((nx + 1) * (ny + 1) * 3);
  const col = new Float32Array((nx + 1) * (ny + 1) * 3);
  const uvs = new Float32Array((nx + 1) * (ny + 1) * 2);
  const tmp = new THREE.Color();
  for (let j = 0; j <= ny; j++) {
    for (let i = 0; i <= nx; i++) {
      const x = (i / nx) * w, y = (j / ny) * h;
      const k = j * (nx + 1) + i;
      let z = relief * (0.35 + 0.18 * N(x * 9, y * 9) + 0.08 * N(x * 30, y * 30));
      let tone = 0.9 + 0.12 * N(x * 6 + 3, y * 6);
      const gx = Math.floor(x / hashCell), gy = Math.floor(y / hashCell);
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const list = grid.get(`${gx + dx},${gy + dy}`);
          if (!list) continue;
          for (const b of list) {
            const d = Math.hypot(x - b.x, y - b.y);
            if (d >= b.r) continue;
            const hz = relief * (0.45 + 0.55 * Math.sqrt(1 - (d / b.r) ** 2)) * (0.85 + 0.15 * b.t);
            if (hz > z) {
              z = hz;
              tone = b.t;
            }
          }
        }
      }
      // edges fall to the board
      const e = Math.min(x, w - x, y, h - y);
      if (e < 0.012) z *= 0.35 + 0.65 * (e / 0.012);
      pos[k * 3] = u + x;
      pos[k * 3 + 1] = v + y;
      pos[k * 3 + 2] = board + z;
      tmp.copy(baseC).lerp(lightHex, clamp((tone - 0.9) * 2, 0, 0.6)).multiplyScalar(0.46 + tone * 0.16 + (z / relief) * 0.12);
      if (style === 'mix') tmp.lerp(reindeer, clamp((N(x * 5 + 9, y * 5 - 4) - 0.62) * 1.4, 0, 0.22));
      // vertex colour relative to the material colour (which already is the hex)
      col[k * 3] = clamp(tmp.r / Math.max(0.01, baseC.r), 0, 2.2);
      col[k * 3 + 1] = clamp(tmp.g / Math.max(0.01, baseC.g), 0, 2.2);
      col[k * 3 + 2] = clamp(tmp.b / Math.max(0.01, baseC.b), 0, 2.2);
      uvs[k * 2] = u + x;
      uvs[k * 2 + 1] = v + y;
    }
  }
  const idx = [];
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const a = j * (nx + 1) + i, b = a + 1, c = a + nx + 1, d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const mesh = K.partMesh(geo, mossMat(base), 'panel');
  mesh.userData.mossMerge = true;
  g.add(mesh);
  ctx.fronts.push({ u0: u, v0: v, u1: u + w, v1: v + h, z: depth });
}

const DECOR_COLORS = ['#d9d2c3', '#7d8a6a', '#b06f55', '#3a3b40', '#c9b79c', '#2b2826', '#8c6c55', '#e8e2d6'];

/**
 * Whether a floating sideboard gets a table lamp: `el.lamp` (true/false) when set, `decor: [...'lamp']`, else
 * automatically when the wall design has no other light (LED strip, wall lamp) – the montage E staging (opal
 * mushroom lamp, books and a vase on the sideboard).
 * @param {object} el  sideboard-floating element
 * @param {object[]} [elements]  all elements of the design
 * @returns {boolean}
 */
export function sideboardHasLamp(el, elements = []) {
  if (!el || el.type !== 'sideboard-floating' || el.use === 'bench') return false;
  if (typeof el.lamp === 'boolean') return el.lamp;
  if (Array.isArray(el.decor)) return el.decor.includes('lamp');
  if (el.decor === false) return false;
  return !(elements || []).some((e) => e && (e.type === 'led' || e.type === 'lamp-wall'));
}

/** Opal mushroom table lamp (LAMPS' table-mushroom) standing at (x, y, z); its light goes into ctx.lights. */
function addTableLamp(ctx, x, y, z) {
  let lamp = null;
  if (getArchetype('table-mushroom')) {
    lamp = buildModel({
      archetype: 'table-mushroom',
      dims: { w: 0.3, d: 0.3, h: 0.37 },
      params: { baseShape: 'disc' },
      colors: { shade: '#f3eee4', inner: '#f3eee4', base: '#24211f', metal: '#24211f' },
      materials: { shade: 'glass-opal', inner: 'glass-opal', base: 'black-metal', metal: 'black-metal' },
    });
    // the opal dome glows warm when the lamp is on (montage E); dimmed with the light by the LightManager. A plain
    // emissive material: same shader program as the other lamp glows, so showing E compiles no new shader
    const shades = lamp.userData.model?.parts?.shade || [];
    if (shades.length) {
      const sm = emissive('#ffb070', 1.15, { color: '#f1e2cc' });
      for (const m of shades) m.material = sm;
      const l0 = lamp.userData.model?.lights?.[0];
      if (l0) l0.emissiveMeshes = [...(l0.emissiveMeshes || []), ...shades];
    }
  } else {
    lamp = new THREE.Group();
    const metal = mat('black-metal', '#24211f');
    lamp.add(K.partMesh(K.cylinder(0.07, 0.075, 0.012, { seg: 24 }), metal, 'base'));
    lamp.add(K.partMesh(K.cylinder(0.007, 0.007, 0.3, { seg: 10 }), metal, 'metal', { position: [0, 0.012, 0] }));
    const shadeMesh = K.partMesh(K.sphere(0.15, { wSeg: 24, hSeg: 10, thetaLength: Math.PI / 2 }), emissive('#ffe6c4', 1.6), 'shade', { position: [0, 0.3, 0], noMerge: true });
    lamp.add(shadeMesh);
    lamp = K.finishModel(lamp, { lights: [K.pointLight([0, 0.29, 0], { lumens: 300, emissiveMeshes: [shadeMesh] })], merge: false });
  }
  lamp.position.set(x, y, z);
  lamp.userData.noMerge = true;
  lamp.updateMatrix();
  ctx.g.add(lamp);
  for (const l of lamp.userData.model?.lights || []) {
    const p = new THREE.Vector3(...l.position).applyMatrix4(lamp.matrix);
    const out = { ...l, position: [p.x, p.y, p.z], colorK: l.colorK ?? 2700 };
    if (l.direction) out.direction = [...l.direction];
    ctx.lights.push(out);
  }
}

/**
 * Books, a vase and a bowl on a flat top (deterministic). y = top surface, z0/z1 = depth range.
 * { lamp: true } = the montage staging instead: a book stack and a slim white vase at the left, an opal table lamp at
 * the right; { books: false } leaves the books/vase out (lamp only); items = ['books', 'vase', 'bowl', 'lamp'] subset.
 */
function addDecor(ctx, x0, x1, y, z0, z1, seed, { upright = false, lamp = false, books = true, items = null } = {}) {
  const R = K.rng(`decor:${seed}`);
  const g = ctx.g;
  const B = ctx.B;
  const depth = z1 - z0;
  const span = x1 - x0;
  if (span < 0.3) return;
  const pages = mat('paper', '#efe9dc');
  const want = (k) => (items ? items.includes(k) : true);
  if (lamp) {
    if (books && want('books')) {
      // two lying books (sage green on white, as in montage E)
      let yy = y;
      const bx = x0 + span * 0.08;
      for (const [c, bw, bt] of [['#e6e1d6', 0.27, 0.03], ['#5e786a', 0.24, 0.026]]) {
        const cx = bx + bw / 2 + (R() - 0.5) * 0.015;
        const cz = z0 + depth * 0.5 + (R() - 0.5) * 0.015;
        const bd = Math.min(depth * 0.7, 0.19);
        B.box(mat('cotton', c), 'decor', cx, yy + bt / 2, cz, bw, bt, bd);
        B.box(pages, 'decor', cx + 0.004, yy + bt / 2, cz, bw - 0.004, bt - 0.004, bd + 0.002, { skip: '-x-y+y' });
        yy += bt;
      }
    }
    if (books && want('vase')) {
      const vh = 0.27, vr = 0.045;
      const prof = [[0.001, 0], [vr * 0.92, 0.004], [vr, vh * 0.3], [vr * 0.97, vh * 0.75], [vr * 0.72, vh * 0.95], [vr * 0.7, vh]];
      g.add(K.partMesh(K.lathe(prof, { seg: 28 }), mat('ceramic', '#dcd6cc'), 'decor', { position: [x0 + span * 0.25, y, z0 + depth * 0.55] }));
    }
    if (want('lamp')) addTableLamp(ctx, x0 + span * 0.83, y, z0 + depth * 0.5);
    return;
  }
  if (!books || !want('books')) {
    /* no books */
  } else if (upright) {
    // a row of standing books
    let x = x0 + span * (0.08 + R() * 0.1);
    const n = 6 + Math.floor(R() * 6);
    for (let i = 0; i < n && x < x0 + span * 0.55; i++) {
      const t = 0.02 + R() * 0.025, hh = Math.min(0.3, 0.19 + R() * 0.08), d = Math.min(depth * 0.85, 0.14 + R() * 0.06);
      const c = DECOR_COLORS[Math.floor(R() * DECOR_COLORS.length)];
      B.box(mat('cotton', c), 'decor', x + t / 2, y + hh / 2, z0 + 0.01 + d / 2, t, hh, d, { skip: '-z' });
      x += t + 0.002;
    }
  } else {
    // a stack of lying books
    let yy = y;
    const bx = x0 + span * (0.12 + R() * 0.1);
    const n = 2 + Math.floor(R() * 2);
    for (let i = 0; i < n; i++) {
      const bw = 0.24 + R() * 0.06, bt = 0.022 + R() * 0.015, bd = Math.min(depth * 0.75, 0.17 + R() * 0.04);
      const c = DECOR_COLORS[Math.floor(R() * DECOR_COLORS.length)];
      const cx = bx + bw / 2 + (R() - 0.5) * 0.02;
      const cz = z0 + depth * 0.45 + (R() - 0.5) * 0.02;
      B.box(mat('cotton', c), 'decor', cx, yy + bt / 2, cz, bw, bt, bd);
      B.box(pages, 'decor', cx + 0.004, yy + bt / 2, cz, bw - 0.004, bt - 0.004, bd + 0.002, { skip: '-x-y+y' });
      yy += bt;
    }
  }
  // a ceramic vase
  const vh = 0.2 + R() * 0.12;
  const vr = 0.055 + R() * 0.03;
  const prof = [[0.001, 0], [vr * 0.8, 0.005], [vr, vh * 0.35], [vr * 0.92, vh * 0.65], [vr * 0.45, vh * 0.92], [vr * 0.5, vh]];
  const vc = R() < 0.5 ? '#d8d1c5' : R() < 0.5 ? '#4a4440' : '#b8a58a';
  const vx = x0 + span * (0.68 + R() * 0.12);
  if (books && want('vase')) g.add(K.partMesh(K.lathe(prof, { seg: 28 }), mat('ceramic', vc), 'decor', { position: [vx, y, z0 + depth * 0.5] }));
  // a low bowl
  if (span > 0.9 && !upright && books && want('bowl')) {
    const br = 0.09 + R() * 0.03;
    const bowl = K.lathe([[0.001, 0], [br * 0.5, 0.004], [br * 0.9, 0.03], [br, 0.055], [br * 0.95, 0.056], [br * 0.86, 0.03], [0.001, 0.008]], { seg: 32 });
    g.add(K.partMesh(bowl, mat('ceramic', R() < 0.5 ? '#2f2c29' : '#cfc6b8'), 'decor', { position: [x0 + span * (0.45 + R() * 0.08), y, z0 + depth * 0.52] }));
  }
}

function buildShelf(ctx, el) {
  const u = num(el.u, 0), v = num(el.v, 1), w = Math.max(0.1, num(el.w, 1));
  const d = clamp(num(el.d, 0.22), 0.05, 0.6);
  const th = clamp(num(el.thickness, 0.04), 0.012, 0.1);
  const m = woodMat(el.material || 'oak', el.color);
  ctx.g.add(K.partMesh(K.roundedBox(w, th, d, 0.0025, 1, { grain: 'x' }), m, 'top', { position: [u + w / 2, v + th / 2, d / 2] }));
  ctx.surfaces.push({ y: v + th, w, d, center: [u + w / 2, d / 2] });
  ctx.colliders.push(box3([u, v, 0], [u + w, v + th, d]));
  if (el.decor !== false) addDecor(ctx, u + 0.04, u + w - 0.04, v + th, 0.01, d - 0.01, `${ctx.index}:${u.toFixed(2)}:${v.toFixed(2)}`, { upright: d < 0.3 && v > 0.9 });
}

function buildSideboard(ctx, el) {
  const u = num(el.u, 0), v = num(el.v, 0.25), w = Math.max(0.3, num(el.w, 2)), h = Math.max(0.15, num(el.h, 0.45));
  const d = clamp(num(el.d, 0.4), 0.2, 0.7);
  const kind = woodKind(el.material, 'smoked-oak');
  const hex = resolveColor(el.color, WOOD_PRESETS[kind]?.hex || '#4e3b2c');
  const B = ctx.B;
  const bench = el.use === 'bench';
  const body = woodMat(kind, hex);
  const t = 0.019;
  const frontT = 0.019;
  const cx = u + w / 2;
  // carcass
  B.box(body, 'body', cx, v + h - t / 2, d / 2, w, t, d, { grain: 'x', skip: '-z' });
  B.box(body, 'body', cx, v + t / 2, d / 2, w, t, d, { grain: 'x', skip: '-z' });
  for (const x of [u + t / 2, u + w - t / 2]) B.box(body, 'body', x, v + h / 2, d / 2, t, h - 2 * t, d, { grain: 'y', skip: '-z' });
  // near-black reveal behind the door gaps: the seams between the doors read as fine dark lines (as in montage E)
  B.box(mat(kind === 'painted' || kind === 'lacquer' ? kind : 'black-oak', '#14110e'), 'body', cx, v + h / 2, d - frontT - 0.002, w - 2 * t, h - 2 * t, 0.003, { skip: '-z' });
  const doors = clamp(Math.round(num(el.doors, Math.max(1, Math.round(w / 0.55)))), 1, 8);
  const gap = 0.006;
  const innerW = w - 2 * t;
  const dw = (innerW - gap * (doors + 1)) / doors;
  const dh = h - 2 * t - 2 * gap;
  const R = K.rng(`board:${ctx.index}`);
  const style = el.frontStyle || 'flat';
  const front = woodMat(kind, hex);
  const tones = [woodMat(kind, shade(hex, -0.02)), woodMat(kind, hex), woodMat(kind, shade(hex, 0.02))];
  for (let i = 0; i < doors; i++) {
    const dx = u + t + gap + dw / 2 + i * (dw + gap);
    const dy = v + h / 2;
    if (style === 'ribbed') {
      B.box(front, 'front', dx, dy, d - frontT / 2 - 0.004, dw, dh, frontT - 0.008, { grain: 'y', uOff: R() * 2, skip: '-z' });
      const rib = 0.024;
      const nr = Math.max(1, Math.floor(dw / rib));
      const st = dx - (nr * rib) / 2 + rib / 2;
      for (let k = 0; k < nr; k++) {
        const geo = K.cylinder(rib / 2 - 0.001, rib / 2 - 0.001, dh, { seg: 10, thetaStart: -Math.PI / 2, thetaLength: Math.PI, open: true });
        geo.translate(0, -dh / 2, 0);
        K.worldUV(geo, 1, { grain: 'y' });
        ctx.g.add(K.partMesh(geo, tones[k % 3], 'front', { position: [st + k * rib, dy, d - 0.008] }));
      }
    } else if (style === 'slatted') {
      B.box(mat('felt', '#1b1b1b'), 'front', dx, dy, d - frontT + 0.002, dw, dh, 0.004, { skip: '-z' });
      const sw = 0.027, sg = 0.013;
      const ns = Math.max(1, Math.floor((dw + sg) / (sw + sg)));
      const st = dx - (ns * (sw + sg) - sg) / 2 + sw / 2;
      for (let k = 0; k < ns; k++) B.box(tones[Math.floor(R() * 3)], 'front', st + k * (sw + sg), dy, d - 0.008, sw, dh, 0.014, { grain: 'y', uOff: R() * 2, skip: '-z' });
    } else {
      B.box(tones[i % 3], 'front', dx, dy, d - frontT / 2, dw, dh, frontT, { grain: 'y', uOff: R() * 2, skip: '-z' });
    }
  }
  const topY = v + h;
  if (bench) {
    const seat = K.cushion(w - 0.02, 0.07, d - 0.03, { axis: 'y', puff: 0.18, round: 0.7, bottom: 0, pinch: 0, seg: 12 });
    ctx.g.add(K.partMesh(seat, mat('boucle', resolveColor(el.seatColor, '#cbbba2')), 'upholstery', { position: [cx, topY + 0.035, d / 2 - 0.005] }));
  } else {
    const lamp = sideboardHasLamp(el, ctx.elements);
    const decor = el.decor !== false;
    if (decor || lamp) addDecor(ctx, u + 0.05, u + w - 0.05, topY, 0.03, d - 0.03, `${ctx.index}:${u.toFixed(2)}`, { lamp, books: decor, items: Array.isArray(el.decor) ? el.decor : null });
  }
  ctx.surfaces.push({ y: topY + (bench ? 0.07 : 0), w, d, center: [cx, d / 2] });
  ctx.colliders.push(box3([u, v, 0], [u + w, topY + (bench ? 0.07 : 0), d]));
}

function buildHooks(ctx, el) {
  const items = Array.isArray(el.items) ? el.items : [];
  const m = woodMat(el.material || 'oak', el.color || '#8a6b4a');
  const metal = mat('black-metal', '#1f1f1f');
  const plateM = mat('painted', resolveColor(el.plateColor, '#a6a29b'));
  const slotM = mat('painted', '#55514c');
  const B = ctx.B;
  for (const it of items) {
    const cu = num(it.cu, 3.5), cv = num(it.cv, 1.65);
    // hooks sit on the face of the slat wall / panel they are mounted on (montage G2), not on the bare wall behind it
    const z0 = coverZ(ctx.elements, cu, cv);
    if (el.style === 'peg') {
      const peg = K.cylinder(0.014, 0.017, 0.07, { seg: 16 });
      peg.rotateX(Math.PI / 2);
      ctx.g.add(K.partMesh(peg, m, 'frame', { position: [cu, cv, z0] }));
      continue;
    }
    // fold-out (montage G2): a square grey powder-coated plate that stands out from the slats, a dark slot, and the
    // wooden flap folded out a little so the hook reads as a hook from across the room
    const PW = 0.07, PH = 0.09, PD = 0.009;
    B.box(plateM, 'frame', cu, cv, z0 + PD / 2, PW, PH, PD, { skip: '-z' });
    B.box(slotM, 'frame', cu, cv - 0.002, z0 + PD + 0.0006, 0.036, 0.07, 0.0012, { skip: '-z' });
    const flap = K.box(0.026, 0.056, 0.008, { grain: 'y' });
    flap.translate(0, -0.028, 0.004);
    ctx.g.add(K.partMesh(flap, m, 'frame', { position: [cu, cv + 0.027, z0 + PD + 0.001], rotation: [-0.55, 0, 0] }));
    B.box(metal, 'frame', cu, cv + 0.028, z0 + PD + 0.0025, 0.022, 0.005, 0.004, { skip: '-z' });
  }
}

/** Front z of the covering elements (slats, panels, art, checker, moss) at a wall point; 0 = the bare wall. */
function coverZ(elements, u, v) {
  let z = 0;
  for (const e of elements || []) {
    if (!e || !['slats', 'checker', 'panel', 'art', 'moss', 'hexagons', 'circles'].includes(e.type)) continue;
    const b = elementBounds(e);
    if (b && u >= b.u0 && u <= b.u1 && v >= b.v0 && v <= b.v1) z = Math.max(z, b.depth);
  }
  return z;
}

function buildLed(ctx, el) {
  const u = num(el.u, 0), v = num(el.v, 1.2), w = Math.max(0.1, num(el.w, 1));
  const down = el.direction !== 'up';
  const colorK = clamp(num(el.colorK, 2700), 1800, 6500);
  const glowHex = kelvinHex(colorK);
  const B = ctx.B;
  // aluminium profile, recessed just under/over the element above/below it
  const z = 0.035;
  B.box(mat('steel', '#a9acae'), 'rail', u + w / 2, v + (down ? -0.006 : 0.006), z, w, 0.012, 0.018);
  const diffuser = emissive(glowHex, 2.6, { color: '#f4f0e8' });
  const strip = K.partMesh(K.box(w - 0.004, 0.003, 0.012), diffuser, 'led', { position: [u + w / 2, v + (down ? -0.0135 : 0.0135), z], noMerge: true });
  ctx.g.add(strip);
  // soft wall-wash glow (additive, dimmed with the light by the LightManager)
  const glowH = 0.42;
  // Lambert (no specular – a black lit material would still add highlights) with the glow as emissive map
  const gm = new THREE.MeshLambertMaterial({
    color: 0x000000,
    emissive: new THREE.Color(glowHex),
    emissiveIntensity: 0.22,
    emissiveMap: glowTexture().map,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
  });
  gm.name = 'led-glow';
  gm.userData = { cached: false, kind: 'emissive', baseIntensity: 0.22 };
  const plane = new THREE.PlaneGeometry(w, glowH);
  if (!down) plane.rotateZ(Math.PI);
  const glow = K.partMesh(plane, gm, 'led', { position: [u + w / 2, v + (down ? -glowH / 2 : glowH / 2), 0.0035], noMerge: true });
  glow.userData.noShadow = true;
  glow.renderOrder = 2;
  ctx.g.add(glow);
  const n = Math.max(1, Math.round(w / 1.1));
  const lm = clamp(num(el.lumensPerM, 300), 50, 2000) * w;
  for (let i = 0; i < n; i++) {
    const x = u + ((i + 0.5) * w) / n;
    ctx.lights.push({
      type: 'spot',
      position: [x, v + (down ? -0.03 : 0.03), z + 0.02],
      direction: [0, down ? -1 : 1, 0.32],
      angle: 1.15,
      penumbra: 0.95,
      colorK,
      lumens: lm / n,
      emissiveMeshes: i === 0 ? [strip, glow] : [],
    });
  }
}

/** Own simple wall lamp (used when the LAMPS archetype is missing). */
function fallbackLamp(el) {
  const g = new THREE.Group();
  const metal = el.style === 'arm' ? mat('black-metal', resolveColor(el.color, '#1f1f1f')) : mat('brass', resolveColor(el.color, '#b8925a'));
  g.add(K.partMesh(K.cylinder(0.05, 0.05, 0.012, { seg: 24 }).rotateX(Math.PI / 2), metal, 'metal'));
  const bulbM = emissive('#ffe2b8', 2);
  const bulb = K.partMesh(K.sphere(0.06, { wSeg: 20, hSeg: 14 }), el.style === 'arm' ? bulbM : bulbM, 'shade', { position: [0, 0.02, 0.1], noMerge: true });
  g.add(K.partMesh(K.cylinder(0.008, 0.008, 0.09, { seg: 10 }).rotateX(Math.PI / 2), metal, 'metal', { position: [0, 0, 0] }));
  g.add(bulb);
  return K.finishModel(g, { lights: [K.pointLight([0, 0.02, 0.12], { lumens: 450, emissiveMeshes: [bulb] })], merge: false });
}

function buildLampWall(ctx, el) {
  const cu = num(el.cu, 0.5), cv = num(el.cv, 1.7);
  const arch = el.style === 'arm' ? 'wall-arm' : 'wall-sconce';
  const hex = resolveColor(el.color, el.style === 'arm' ? '#1f1f1f' : '#b8925a');
  let lamp;
  if (getArchetype(arch)) {
    const dark = lum(hex) < 0.12;
    const metalKind = dark ? 'black-metal' : lum(hex) > 0.6 ? 'painted' : 'brass';
    lamp = buildModel({ archetype: arch, colors: { metal: hex, base: hex }, materials: { metal: metalKind, base: metalKind } });
  } else lamp = fallbackLamp(el);
  lamp.position.set(cu, cv, 0);
  lamp.userData.noMerge = true;
  lamp.updateMatrix();
  ctx.g.add(lamp);
  const colorK = clamp(num(el.colorK, 2700), 1800, 6500);
  for (const l of lamp.userData.model?.lights || []) {
    const p = new THREE.Vector3(...l.position).applyMatrix4(lamp.matrix);
    const out = { ...l, position: [p.x, p.y, p.z], colorK };
    if (l.direction) out.direction = [...l.direction];
    ctx.lights.push(out);
  }
  const d = elementBounds(el).depth;
  ctx.colliders.push(box3([cu - 0.13, cv - 0.15, 0], [cu + 0.13, cv + 0.15, d]));
}

function paintShape(el, w, h) {
  const s = new THREE.Shape();
  if (el.shape === 'circle') {
    s.absarc(w / 2, h / 2, Math.min(w, h) / 2, 0, Math.PI * 2, false);
  } else if (el.shape === 'half-circle') {
    // a rising sun: the flat side on the bottom edge, as wide as the field (or twice its height)
    const r = Math.min(w / 2, h);
    s.moveTo(w / 2 - r, 0);
    s.lineTo(w / 2 + r, 0);
    s.absarc(w / 2, 0, r, 0, Math.PI, false);
  } else if (el.shape === 'arch' && w < h * 1.6) {
    const r = w / 2;
    s.moveTo(0, 0);
    s.lineTo(w, 0);
    s.lineTo(w, h - r);
    s.absarc(r, h - r, r, 0, Math.PI, false);
    s.lineTo(0, 0);
  } else {
    s.moveTo(0, 0);
    s.lineTo(w, 0);
    s.lineTo(w, h);
    s.lineTo(0, h);
    s.lineTo(0, 0);
  }
  return s;
}

function buildPaintBlock(ctx, el) {
  const u = num(el.u, 0), v = num(el.v, 0), w = Math.max(0.05, num(el.w, 1)), h = Math.max(0.05, num(el.h, 1));
  const geo = new THREE.ShapeGeometry(paintShape(el, w, h), 48);
  geo.translate(u, v, 0.0015 + 0.0002 * (ctx.index % 5));
  const hex = resolveColor(el.color, '') ? el.color : el.paintName || 'marrakesh';
  let m;
  if (el.finish === 'limewash') {
    // wall-global metre UVs, so neighbouring lime-washed fields continue the same clouds
    const uv = geo.attributes.uv, pos = geo.attributes.position;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, pos.getX(i), pos.getY(i));
    m = limewashMat(hex);
  } else m = paint(hex);
  const mesh = K.partMesh(geo, m, 'paint');
  mesh.userData.noShadowCast = true;
  ctx.g.add(mesh);
}

const PLANT_DIMS = { olive: [0.6, 0.6], 'ficus-lyrata': [0.65, 0.6], monstera: [0.9, 0.8], strelitzia: [0.8, 0.7] };

function buildPlant(ctx, el) {
  const cu = num(el.cu, 0.5);
  const height = clamp(num(el.height, 1.5), 0.3, 2.6);
  const [pw, pd] = PLANT_DIMS[el.species] || [0.6, 0.6];
  const k = clamp(height / 1.6, 0.6, 1.4);
  const dims = { w: pw * k, d: pd * k, h: height };
  const plant = buildModel({ archetype: 'plant-floor', dims, params: { species: el.species || 'olive' }, colors: { pot: resolveColor(el.potColor, '#ddd6ca') } });
  const z = dims.d / 2 + 0.06;
  plant.position.set(cu, 0, z);
  plant.userData.noMerge = true;
  ctx.g.add(plant);
  ctx.colliders.push(box3([cu - 0.2, 0, z - 0.2], [cu + 0.2, height, z + 0.2]));
}

function buildWallpaper(ctx, el) {
  const u = num(el.u, 0), v = num(el.v, 0), w = Math.max(0.05, num(el.w, 1)), h = Math.max(0.05, num(el.h, 1));
  const set = wallpaperTexture(el, w, h);
  const geo = new THREE.ShapeGeometry(paintShape(el, w, h), 48);
  // repeating patterns: wall-global metre UVs (pieces next to each other line up); the mural spans the element
  const uv = geo.attributes.uv, pos = geo.attributes.position;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, pos.getX(i) + (set.mural ? 0 : u), pos.getY(i) + (set.mural ? 0 : v));
  geo.translate(u, v, 0.0011 + 0.0001 * (ctx.index % 4));
  const grass = el.pattern === 'grasscloth';
  const m = printMaterial(set, { normalKind: grass ? 'linen' : 'paper', normalScale: grass ? 0.6 : 0.12, roughness: grass ? 0.95 : 0.86 });
  const mesh = K.partMesh(geo, m, 'paper');
  mesh.userData.noShadowCast = true;
  ctx.g.add(mesh);
}

/**
 * Panel moulding in the wall paint: 'boxes' = mitred frames (fyllingspanel, cols × rows in the field), 'grid' = flat
 * battens in a grid (board and batten), 'battens' = vertical battens only. `rail` adds a chair rail along the top.
 */
function buildMoulding(ctx, el) {
  const u = num(el.u, 0), v = num(el.v, 0), w = Math.max(0.1, num(el.w, 1)), h = Math.max(0.1, num(el.h, 1));
  const cols = clamp(Math.round(num(el.cols, 4)), 1, 16), rows = clamp(Math.round(num(el.rows, 1)), 1, 10);
  const gap = clamp(num(el.gap, 0.1), 0, 0.5);
  const profile = clamp(num(el.profile, 0.035), 0.01, 0.15);
  const relief = clamp(num(el.relief, 0.018), 0.004, 0.06);
  // satin paint: the mouldings catch the light a little more than the matt wall around them
  const m = paint(el.color || 'sand', { roughness: 0.62 });
  const style = el.style || 'boxes';
  if (style === 'boxes') {
    const bw = (w - gap * (cols + 1)) / cols, bh = (h - gap * (rows + 1)) / rows;
    if (bw > profile * 2.5 && bh > profile * 2.5) {
      const bevel = Math.min(relief * 0.45, profile * 0.32);
      const shape = new THREE.Shape();
      shape.moveTo(0, 0);
      shape.lineTo(bw, 0);
      shape.lineTo(bw, bh);
      shape.lineTo(0, bh);
      shape.lineTo(0, 0);
      const hole = new THREE.Path();
      hole.moveTo(profile, profile);
      hole.lineTo(profile, bh - profile);
      hole.lineTo(bw - profile, bh - profile);
      hole.lineTo(bw - profile, profile);
      hole.lineTo(profile, profile);
      shape.holes.push(hole);
      const base = K.extrudeShape(shape, relief, { bevel, bevelSegments: 3, curveSegments: 1 });
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const geo = base.clone();
          geo.translate(u + gap + c * (bw + gap), v + gap + r * (bh + gap), 0);
          K.worldUV(geo);
          ctx.g.add(K.partMesh(geo, m, 'moulding'));
        }
      }
      base.dispose();
    }
  } else if (style !== 'rail') {
    const bwid = Math.max(profile, 0.04);
    for (let c = 0; c <= cols; c++) {
      const x = u + bwid / 2 + ((w - bwid) * c) / cols;
      ctx.B.box(m, 'moulding', x, v + h / 2, relief / 2, bwid, h, relief, { grain: 'y', skip: '-z' });
    }
    if (style === 'grid') {
      for (let r = 0; r <= rows; r++) {
        const y = v + bwid / 2 + ((h - bwid) * r) / rows;
        ctx.B.box(m, 'moulding', u + w / 2, y, relief / 2 - 0.0005, w, bwid, relief - 0.001, { skip: '-z' });
      }
    }
  }
  if (el.rail !== false) {
    const rh = clamp(num(el.railH, 0.06), 0.02, 0.2);
    const geo = K.roundedBox(w, rh, relief + 0.008, 0.006, 2, { grain: 'x' });
    ctx.g.add(K.partMesh(geo, m, 'moulding', { position: [u + w / 2, v + h + rh / 2, (relief + 0.008) / 2] }));
  }
}

const BOOK_COLORS = ['#d9d2c3', '#7d8a6a', '#b06f55', '#3a3b40', '#c9b79c', '#2b2826', '#8c6c55', '#e8e2d6', '#5e786a', '#a39584', '#6b4a33', '#27334a', '#c6a76f', '#9a4f2f'];

/** A row of standing books from x0 (max x1), on y, against the back z0; returns the x where the row ended. */
function addBookRow(ctx, R, x0, x1, y, z0, maxH, maxD) {
  let x = x0;
  const pages = mat('paper', '#efe9dc');
  while (x < x1 - 0.015) {
    const t = Math.min(x1 - x, 0.016 + R() * 0.03);
    if (t < 0.012) break;
    const hh = Math.min(maxH, (0.19 + R() * 0.11) * (R() < 0.12 ? 1.25 : 1));
    const d = Math.min(maxD, 0.15 + R() * 0.07);
    const c = BOOK_COLORS[Math.floor(R() * BOOK_COLORS.length)];
    ctx.B.box(mat('cotton', c), 'decor', x + t / 2, y + hh / 2, z0 + d / 2, t, hh, d, { grain: 'y', skip: '-z' });
    // pages show at the top edge of thicker books
    if (t > 0.02) ctx.B.box(pages, 'decor', x + t / 2, y + hh - 0.0015, z0 + d / 2 - 0.003, t - 0.004, 0.004, d - 0.008, { skip: '-z-y' });
    x += t + (R() < 0.08 ? 0.006 : 0.0008);
  }
  return x;
}

/** Built-in bookcase (bokhylle): carcass, dividers, shelves, an optional painted back and books/decor in every bay. */
function buildBookcase(ctx, el) {
  const u = num(el.u, 0), v = num(el.v, 0), w = Math.max(0.3, num(el.w, 2)), h = Math.max(0.3, num(el.h, 2.35));
  const d = clamp(num(el.d, 0.3), 0.15, 0.6);
  const cols = clamp(Math.round(num(el.cols, 4)), 1, 10), rows = clamp(Math.round(num(el.rows, 6)), 1, 12);
  const plinth = clamp(num(el.plinth, 0.08), 0, 0.3);
  const kind = woodKind(el.material, 'oak');
  const hex = resolveColor(el.color, WOOD_PRESETS[kind]?.hex || '#b08b62');
  const body = woodMat(kind, hex);
  const t = 0.022;
  const B = ctx.B;
  const R = K.rng(`bookcase:${ctx.index}:${el.seed ?? 1}`);
  const cx = u + w / 2;
  // carcass: sides, top, bottom shelf over a recessed plinth
  for (const x of [u + t / 2, u + w - t / 2]) B.box(body, 'body', x, v + h / 2, d / 2, t, h, d, { grain: 'y', skip: '-z' });
  B.box(body, 'body', cx, v + h - t / 2, d / 2, w - 2 * t, t, d, { grain: 'x', skip: '-z' });
  const y0 = v + plinth;
  B.box(body, 'body', cx, y0 + t / 2, d / 2, w - 2 * t, t, d, { grain: 'x', skip: '-z' });
  if (plinth > 0.01) B.box(body, 'body', cx, v + plinth / 2, d - 0.03, w - 2 * t, plinth, 0.02, { grain: 'x', skip: '-z' });
  if (el.backColor) {
    const back = paint(el.backColor);
    B.box(back, 'back', cx, (y0 + t + v + h - t) / 2, 0.003, w - 2 * t, v + h - t - y0 - t, 0.006, { skip: '-z' });
  }
  const innerW = w - 2 * t;
  const bayW = (innerW - (cols - 1) * t) / cols;
  const innerH = v + h - t - (y0 + t);
  const bayH = (innerH - (rows - 1) * t) / rows;
  for (let c = 1; c < cols; c++) {
    const x = u + t + c * bayW + (c - 0.5) * t;
    B.box(body, 'body', x, y0 + t + innerH / 2, d / 2, t, innerH, d - 0.004, { grain: 'y', skip: '-z' });
  }
  const fill = clamp(num(el.fill, 0.75), 0, 1);
  const zBack = el.backColor ? 0.006 : 0.002;
  for (let r = 0; r < rows; r++) {
    const yb = y0 + t + r * (bayH + t);
    if (r > 0) B.box(body, 'body', cx, yb - t / 2, d / 2, innerW, t, d - 0.004, { grain: 'x', skip: '-z' });
    for (let c = 0; c < cols; c++) {
      const xb = u + t + c * (bayW + t);
      const roll = R();
      const maxH = Math.min(0.34, bayH - 0.02);
      if (maxH < 0.12 || bayW < 0.2) continue;
      if (roll > fill + 0.12) {
        // an object bay: a vase and a bowl, or a short stack and a vase
        addDecor(ctx, xb, xb + bayW, yb, zBack, d - 0.01, `${ctx.index}:${r}:${c}`, { upright: false, items: R() < 0.5 ? ['vase', 'bowl'] : ['books', 'vase'] });
      } else if (roll > fill - 0.2) {
        // a part-filled bay: books from one side, a vase or a lying stack next to them
        const fromLeft = R() < 0.5;
        const span = bayW * (0.35 + R() * 0.25);
        if (fromLeft) addBookRow(ctx, R, xb + 0.01, xb + span, yb, zBack, maxH, d - 0.03);
        else addBookRow(ctx, R, xb + bayW - span, xb + bayW - 0.01, yb, zBack, maxH, d - 0.03);
        const ox0 = fromLeft ? xb + span + 0.03 : xb + 0.02, ox1 = fromLeft ? xb + bayW - 0.02 : xb + bayW - span - 0.03;
        if (ox1 - ox0 > 0.3) addDecor(ctx, ox0, ox1, yb, zBack, d - 0.01, `${ctx.index}:${r}:${c}:o`, { items: R() < 0.5 ? ['vase'] : ['books'] });
      } else {
        addBookRow(ctx, R, xb + 0.008, xb + bayW * (0.82 + R() * 0.17), yb, zBack, maxH, d - 0.03);
      }
    }
  }
  ctx.colliders.push(box3([u, v, 0], [u + w, v + h, d]));
}

/** Picture ledge (bildehylle): a narrow shelf with a lip and framed prints leaning against the wall. */
function buildLedge(ctx, el) {
  const u = num(el.u, 0), v = num(el.v, 1.3), w = Math.max(0.2, num(el.w, 2));
  const d = clamp(num(el.d, 0.09), 0.05, 0.25);
  const th = 0.025;
  const kind = woodKind(el.material, 'oak');
  const hex = resolveColor(el.color, WOOD_PRESETS[kind]?.hex || '#b08b62');
  const m = lum(hex) < 0.03 && kind !== 'painted' ? mat('black-metal', hex) : woodMat(kind, hex);
  const B = ctx.B;
  B.box(m, 'top', u + w / 2, v + th / 2, d / 2, w, th, d, { grain: 'x', skip: '-z' });
  const lipT = el.lip === false ? 0 : 0.012;
  if (lipT) B.box(m, 'top', u + w / 2, v + th + 0.01, d - lipT / 2, w, 0.02, lipT, { grain: 'x', skip: '-z' });
  const items = Array.isArray(el.items) ? el.items : [];
  const maxLayer = items.reduce((s, it) => Math.max(s, num(it.layer, 0)), 0);
  items.forEach((it, i) => {
    const iw = clamp(num(it.w, 0.5), 0.1, 2), ih = clamp(num(it.h, 0.6), 0.1, 2);
    const depth = 0.025;
    // the back layer stands furthest from the lip; the angle makes the top rest against the wall
    const zb = Math.max(0.004, d - lipT - 0.003 - depth - (maxLayer - num(it.layer, 0)) * (depth + 0.006));
    const lean = Math.asin(clamp(zb / ih, 0, 0.25));
    const sub = { g: new THREE.Group(), B: new Batch(), lights: [], surfaces: [], colliders: [], fronts: [], index: ctx.index * 100 + i, elements: [] };
    buildArt(sub, { type: 'art', u: -iw / 2, v: 0, w: iw, h: ih, depth, acoustic: !!it.acoustic, frame: it.frame || 'black', motif: it.motif, palette: it.palette, seed: it.seed ?? i + 1, sun: it.sun });
    sub.B.build(sub.g);
    sub.g.rotation.x = -lean;
    sub.g.position.set(num(it.cu, u + w / 2), v + th, zb);
    ctx.g.add(sub.g);
  });
  ctx.surfaces.push({ y: v + th, w, d, center: [u + w / 2, d / 2] });
  ctx.colliders.push(box3([u, v, 0], [u + w, v + th + 0.03, d]));
}

const BUILDERS = {
  slats: buildSlats,
  checker: buildChecker,
  panel: buildPanel,
  art: buildArt,
  tapestry: buildTapestry,
  circles: buildCircles,
  hexagons: buildHexagons,
  curtain: buildCurtain,
  moss: buildMoss,
  shelf: buildShelf,
  'sideboard-floating': buildSideboard,
  hooks: buildHooks,
  led: buildLed,
  'lamp-wall': buildLampWall,
  'paint-block': buildPaintBlock,
  plant: buildPlant,
  wallpaper: buildWallpaper,
  moulding: buildMoulding,
  bookcase: buildBookcase,
  ledge: buildLedge,
};

// ---------------------------------------------------------------------------------------------------------------
// Fixtures (sockets, switches) moved out onto covering elements

function wallFixtures(hw) {
  const wallId = hw?.wallId || roomLayout?.highWall?.wallId;
  const origin = hw?.origin || roomLayout?.highWall?.origin;
  const uDir = hw?.uDir || roomLayout?.highWall?.uDir;
  if (!origin || !uDir) return [];
  return (roomLayout?.fixtures || [])
    .filter((f) => f.wallId === wallId && (f.type === 'socket' || f.type === 'switch'))
    .map((f) => {
      const p = f.position;
      const u = (p.x - origin.x) * uDir.x + (p.z - origin.z) * uDir.z;
      return { u, v: p.y, w: f.dims?.w ?? 0.085, h: f.dims?.h ?? 0.085, color: f.color || '#151515', type: f.type, name: f.name };
    });
}

function addFixtureBoxes(ctx, hw) {
  if (!ctx.fronts.length) return;
  const frameM = mat('plastic', '#1c1b1a');
  for (const f of wallFixtures(hw)) {
    let z = 0;
    for (const fr of ctx.fronts) {
      if (f.u - f.w / 2 >= fr.u0 - 0.002 && f.u + f.w / 2 <= fr.u1 + 0.002 && f.v - f.h / 2 >= fr.v0 - 0.002 && f.v + f.h / 2 <= fr.v1 + 0.002) z = Math.max(z, fr.z);
    }
    if (z < 0.008) continue;
    // surface-mount box from the wall to the element's face, the cover plate on top
    ctx.B.box(frameM, 'fixture', f.u, f.v, z / 2 + 0.002, f.w + 0.012, f.h + 0.012, z + 0.004, { skip: '-z' });
    ctx.B.box(mat('lacquer', resolveColor(f.color, '#151515')), 'fixture', f.u, f.v, z + 0.008, f.w, f.h, 0.008, { skip: '-z' });
    if (f.type === 'socket') {
      const hole = K.cylinder(0.019, 0.019, 0.003, { seg: 20 });
      hole.rotateX(Math.PI / 2);
      ctx.g.add(K.partMesh(hole, mat('plastic', '#0c0c0c'), 'fixture', { position: [f.u, f.v, z + 0.0115] }));
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Build / apply

/** Merges the moss meshes (vertex colours) per material – kit.mergeSameMaterial would drop the colours. */
function mergeMoss(group) {
  const buckets = new Map();
  group.traverse((o) => {
    if (o.isMesh && o.userData.mossMerge) (buckets.get(o.material) || buckets.set(o.material, []).get(o.material)).push(o);
  });
  for (const [material, list] of buckets) {
    for (const m of list) m.userData.noMerge = true;
    if (list.length < 2) continue;
    const geos = list.map((m) => {
      m.updateMatrix();
      return m.geometry.clone().applyMatrix4(m.matrix);
    });
    const merged = mergeGeometries(geos, false);
    for (const g of geos) g.dispose();
    if (!merged) continue;
    for (const m of list) {
      m.removeFromParent();
      m.geometry.dispose();
    }
    const mesh = K.partMesh(merged, material, 'panel', { noMerge: true });
    group.add(mesh);
  }
}

/**
 * Builds the wall design as a free group in wall coordinates (x = u, y = v, z = out of the wall).
 * @param {object[]|null} elements
 * @param {{ quality?: string, wall?: object }} [opts]  wall = home.highWall (curtain track height, fixtures)
 * @returns {THREE.Group|null}
 */
export function buildWallDesign(elements, { quality, wall } = {}) {
  if (!Array.isArray(elements) || !elements.length) return null;
  const prevQ = QUALITY;
  if (quality) setWallQuality(quality);
  const g = new THREE.Group();
  g.name = 'wall-design';
  const ctx = { g, B: new Batch(), lights: [], surfaces: [], colliders: [], fronts: [], index: 0, elements };
  const info = [];
  try {
    elements.forEach((el, i) => {
      ctx.index = i;
      const fn = BUILDERS[el?.type];
      if (!fn) {
        if (el?.type) console.warn('[walldesigns] unknown element type', el.type);
        return;
      }
      try {
        fn(ctx, el, wall);
        info.push({ index: i, type: el.type, bounds: elementBounds(el) });
      } catch (err) {
        console.warn('[walldesigns] element failed', el?.type, err);
      }
    });
    addFixtureBoxes(ctx, wall);
    ctx.B.build(g);
    mergeMoss(g);
    K.setShadows(g, true, true);
    g.traverse((o) => {
      if (o.isMesh && o.userData.noShadowCast) o.castShadow = false;
    });
    K.mergeSameMaterial(g);
  } finally {
    QUALITY = prevQ;
  }
  g.userData.model = {
    parts: K.collectParts(g),
    lights: ctx.lights,
    surfaces: ctx.surfaces,
    colliders: ctx.colliders,
    elements: info,
  };
  return g;
}

/**
 * Builds the wall design in highWallInfo.anchor (origin u = 0, v = 0 on the wall face, x = u, y = v, z = into the
 * room), replacing the previous one.
 * @param {object} highWallInfo  home.highWall
 * @param {object[]|null} elements
 * @param {{ quality?: string }} [opts]
 * @returns {THREE.Group|null}
 */
export function applyWallDesign(highWallInfo, elements, opts = {}) {
  const anchor = highWallInfo?.anchor;
  if (!anchor) return null;
  const old = anchor.userData.wallDesign;
  if (old) {
    old.removeFromParent();
    disposeDesign(old);
    anchor.userData.wallDesign = null;
  }
  const g = buildWallDesign(elements, { quality: opts.quality, wall: highWallInfo });
  if (!g) return null;
  anchor.add(g);
  anchor.userData.wallDesign = g;
  return g;
}

/** Frees a group made by buildWallDesign (own textures stay in the LRU cache). */
export function disposeDesign(group) {
  if (!group) return;
  group.traverse((o) => {
    for (const t of o.material?.userData?.ownedTextures || []) t.dispose();
  });
  K.disposeModel(group);
}

// ---------------------------------------------------------------------------------------------------------------
// Editor schema

const POS = (o = {}) => ({
  u: { type: 'number', min: 0, max: WALL_W, step: 0.01, label: 'Fra venstre', unit: 'm', ...(o.u || {}) },
  v: { type: 'number', min: 0, max: WALL_H, step: 0.01, label: 'Fra gulvet', unit: 'm', ...(o.v || {}) },
});
const SIZE = (o = {}) => ({
  w: { type: 'number', min: 0.1, max: WALL_W, step: 0.01, label: 'Bredde', unit: 'm', ...(o.w || {}) },
  h: { type: 'number', min: 0.1, max: WALL_H, step: 0.01, label: 'Høyde', unit: 'm', ...(o.h || {}) },
});
const colorP = (label, palette = 'materials') => ({ type: 'color', label, palette });

const FABRIC_OPTIONS = [['fabric', 'Akustikkstoff'], ['felt', 'Filt'], ['linen', 'Lin'], ['velvet', 'Fløyel'], ['wool', 'Ull'], ['boucle', 'Bouclé'], ['cork', 'Kork'], ['mirror', 'Speil'], ['oak', 'Eik'], ['smoked-oak', 'Røkt eik'], ['walnut', 'Valnøtt']];
const CURTAIN_FABRICS = [['velvet', 'Fløyel'], ['linen', 'Lin'], ['wool', 'Ull'], ['cotton', 'Bomull'], ['woven', 'Vevd stoff'], ['velour', 'Velur']];

/**
 * Parameter schema for one element type (same format as Def.params; WallPanel feeds it to panelKit.paramEditor).
 * Keys ending in Mm / Cm are shown in millimetres / centimetres; colour keys c0…cN index the element's colour list.
 * @param {string} type
 * @param {object} [el]  the element (some schemas depend on it: number of colours, fill type …)
 * @returns {Object<string, object>}
 */
export function elementEditor(type, el = null) {
  const e = el || { type, ...DEFAULTS[type] };
  switch (type) {
    case 'slats':
      return {
        ...POS(), ...SIZE(),
        orientation: { type: 'enum', label: 'Retning', options: [['vertical', 'Stående spiler'], ['horizontal', 'Liggende spiler']] },
        wood: { type: 'enum', label: 'Treslag', options: WOOD_OPTIONS },
        slatColor: { ...colorP('Farge på spilene'), palette: WOOD_SWATCHES },
        slatWMm: { type: 'number', min: 10, max: 80, step: 1, label: 'Spilebredde', unit: 'mm' },
        gapMm: { type: 'number', min: 3, max: 60, step: 1, label: 'Fuge mellom spilene', unit: 'mm' },
        slatDMm: { type: 'number', min: 5, max: 40, step: 1, label: 'Spiletykkelse', unit: 'mm' },
        standoffMm: { type: 'number', min: 0, max: 100, step: 1, label: 'Lekter/Glava bak', unit: 'mm' },
        backing: { type: 'enum', label: 'Bakgrunn', options: [['felt', 'Filt'], ['none', 'Ingen (rett på veggen)']] },
        backingColor: { ...colorP('Filtfarge'), palette: FELT_SWATCHES },
        waveAmpMm: { type: 'number', min: 0, max: 80, step: 1, label: 'Bølge (ekstra dybde)', unit: 'mm' },
        ...(num(e.waveAmp, 0) > 0 ? { wavePeriodCm: { type: 'number', min: 40, max: 400, step: 5, label: 'Bølgelengde', unit: 'cm' } } : {}),
      };
    case 'checker': {
      const s = {
        ...POS(),
        cols: { type: 'number', min: 1, max: 10, step: 1, label: 'Kolonner' },
        rows: { type: 'number', min: 1, max: 6, step: 1, label: 'Rader' },
        tileCm: { type: 'number', min: 20, max: 120, step: 1, label: 'Rutestørrelse', unit: 'cm' },
        fill: { type: 'enum', label: 'Fyll', options: [['slats-alternating', 'Spiler i vekslende retning'], ['felt', 'Filt'], ['wood-felt', 'Spiler og filt annenhver']] },
      };
      if (e.fill === 'wood-felt') {
        s.wood0 = { type: 'enum', label: 'Treslag', options: WOOD_OPTIONS };
        s.c0 = { ...colorP('Farge på spilene'), palette: WOOD_SWATCHES };
        s.c1 = { ...colorP('Filtfarge'), palette: FELT_SWATCHES };
        s.startOrientation = { type: 'enum', label: 'Spileretning', options: [['vertical', 'Stående spiler'], ['horizontal', 'Liggende spiler']] };
        s.backingColor = { ...colorP('Filt bak spilene'), palette: FELT_SWATCHES };
      } else if (e.fill === 'felt') {
        s.c0 = { ...colorP('Farge A'), palette: FELT_SWATCHES };
        s.c1 = { ...colorP('Farge B'), palette: FELT_SWATCHES };
        s.depthMm = { type: 'number', min: 9, max: 60, step: 1, label: 'Tykkelse', unit: 'mm' };
      } else {
        s.wood0 = { type: 'enum', label: 'Treslag A', options: WOOD_OPTIONS };
        s.c0 = { ...colorP('Farge A'), palette: WOOD_SWATCHES };
        s.wood1 = { type: 'enum', label: 'Treslag B', options: WOOD_OPTIONS };
        s.c1 = { ...colorP('Farge B'), palette: WOOD_SWATCHES };
        s.startOrientation = { type: 'enum', label: 'Første rute', options: [['vertical', 'Stående spiler'], ['horizontal', 'Liggende spiler']] };
        s.slatWMm = { type: 'number', min: 10, max: 60, step: 1, label: 'Spilebredde', unit: 'mm' };
        s.slatGapMm = { type: 'number', min: 3, max: 40, step: 1, label: 'Fuge', unit: 'mm' };
        s.backingColor = { ...colorP('Filtfarge'), palette: FELT_SWATCHES };
      }
      return s;
    }
    case 'panel':
      return {
        ...POS(), ...SIZE(),
        depthMm: { type: 'number', min: 5, max: 120, step: 1, label: 'Tykkelse', unit: 'mm' },
        surface: { type: 'enum', label: 'Overflate', options: FABRIC_OPTIONS },
        color: { ...colorP('Farge'), palette: FABRIC_SWATCHES },
        edge: { type: 'enum', label: 'Kant', options: [['square', 'Rett, stofftrukket'], ['rounded', 'Polstret (avrundet)'], ['channel', 'Kanalpolstret'], ['frame', 'Med ramme']] },
        frameColor: { ...colorP('Rammefarge'), palette: [...METAL_SWATCHES, ...WOOD_SWATCHES] },
      };
    case 'art': {
      const pal = e.palette?.length ? e.palette : DEFAULTS.art.palette;
      const s = {
        ...POS(), ...SIZE(),
        motif: { type: 'enum', label: 'Motiv', options: [['landscape-hills', 'Landskap med åser'], ['line-art', 'Strektegning'], ['abstract-shapes', 'Abstrakte former'], ['botanical', 'Botanisk']] },
        seed: { type: 'number', min: 1, max: 200, step: 1, label: 'Variant' },
      };
      if ((e.motif || 'landscape-hills') === 'landscape-hills') s.sun = { type: 'bool', label: 'Sol' };
      pal.forEach((_, i) => {
        s[`c${i}`] = { ...colorP(i === 0 ? 'Bakgrunn' : `Farge ${i + 1}`), palette: ART_SWATCHES };
      });
      s.frame = { type: 'enum', label: 'Ramme', options: [['none', 'Uten ramme'], ['black', 'Sort'], ['oak', 'Eik'], ['smoked-oak', 'Røkt eik'], ['walnut', 'Valnøtt'], ['white', 'Hvit']] };
      s.acoustic = { type: 'bool', label: 'Akustisk (demper lyd)' };
      return s;
    }
    case 'tapestry': {
      const s = {
        ...POS(), ...SIZE(),
        pattern: { type: 'enum', label: 'Mønster', options: [['diamond', 'Ruter'], ['kilim', 'Kelim'], ['stripes', 'Striper'], ['plain', 'Ensfarget']] },
        motifCount: { type: 'number', min: 1, max: 10, step: 1, label: 'Antall motiver' },
      };
      for (let i = 0; i < 4; i++) s[`c${i}`] = { ...colorP(i === 0 ? 'Bunnfarge' : `Farge ${i + 1}`), palette: [...FABRIC_SWATCHES, ...ART_SWATCHES] };
      s.rod = { type: 'bool', label: 'Stang' };
      s.rodColor = { ...colorP('Stangfarge'), palette: [...METAL_SWATCHES, ...WOOD_SWATCHES] };
      s.fringe = { type: 'bool', label: 'Frynser' };
      return s;
    }
    case 'circles': {
      const s = {
        ...POS(),
        count: { type: 'number', min: 1, max: 8, step: 1, label: 'Antall' },
        diameterCm: { type: 'number', min: 20, max: 150, step: 1, label: 'Diameter', unit: 'cm' },
        depthMm: { type: 'number', min: 10, max: 80, step: 1, label: 'Tykkelse', unit: 'mm' },
      };
      (e.items || []).forEach((_, i) => {
        s[`c${i}`] = { ...colorP(`Farge ${i + 1}`), palette: FELT_SWATCHES };
      });
      return s;
    }
    case 'hexagons':
      return {
        ...POS(),
        count: { type: 'number', min: 1, max: 40, step: 1, label: 'Antall' },
        sizeCm: { type: 'number', min: 20, max: 80, step: 1, label: 'Størrelse (flat til flat)', unit: 'cm' },
        c0: { ...colorP('Farge 1'), palette: [...FELT_SWATCHES, { hex: '#b3aa95', name: 'Natur' }, { hex: '#5a5c59', name: 'Grå' }, { hex: '#7f9275', name: 'Salvie' }] },
        c1: { ...colorP('Farge 2'), palette: [...FELT_SWATCHES, { hex: '#5a5c59', name: 'Grå' }] },
        c2: { ...colorP('Farge 3'), palette: [...FELT_SWATCHES, { hex: '#7f9275', name: 'Salvie' }] },
        surface: { type: 'enum', label: 'Materiale', options: [['wood-concrete', 'Trebetong'], ['felt', 'Filt'], ['cork', 'Kork'], ['oak', 'Eik'], ['smoked-oak', 'Røkt eik'], ['walnut', 'Valnøtt'], ['moss', 'Mose']] },
        depthMm: { type: 'number', min: 10, max: 100, step: 1, label: 'Tykkelse', unit: 'mm' },
      };
    case 'curtain':
      return {
        u: POS().u,
        w: SIZE().w,
        top: { type: 'number', min: 1.5, max: WALL_H, step: 0.01, label: 'Overkant', unit: 'm' },
        bottom: { type: 'number', min: 0, max: 0.6, step: 0.01, label: 'Avstand til gulvet', unit: 'm' },
        fabric: { type: 'enum', label: 'Stoff', options: CURTAIN_FABRICS },
        color: { ...colorP('Farge'), palette: FABRIC_SWATCHES },
        fullness: { type: 'number', min: 1.3, max: 3, step: 0.1, label: 'Fyldighet (stoff/skinne)' },
        waveCm: { type: 'number', min: 8, max: 30, step: 0.5, label: 'Bølgebredde', unit: 'cm' },
        trackStyle: { type: 'enum', label: 'Skinne', options: [['pelmet', 'Skinne med dekklist'], ['rail', 'Synlig skinne']] },
        trackColor: { ...colorP('Skinnefarge'), palette: METAL_SWATCHES },
      };
    case 'moss':
      return {
        ...POS(), ...SIZE(),
        color: { ...colorP('Farge'), palette: [{ hex: '#557030', name: 'Mosegrønn' }, { hex: '#5a7431', name: 'Lys mose' }, { hex: '#3f5a2a', name: 'Mørk mose' }, { hex: '#6f7d3a', name: 'Olivenmose' }] },
        style: { type: 'enum', label: 'Type', options: [['mix', 'Blandet (ball-, flat- og reinmose)'], ['ball', 'Ballmose'], ['flat', 'Flatmose']] },
        depthMm: { type: 'number', min: 20, max: 100, step: 1, label: 'Tykkelse', unit: 'mm' },
      };
    case 'shelf':
      return {
        ...POS(),
        w: SIZE().w,
        dCm: { type: 'number', min: 8, max: 45, step: 1, label: 'Dybde', unit: 'cm' },
        thicknessMm: { type: 'number', min: 15, max: 80, step: 1, label: 'Tykkelse', unit: 'mm' },
        material: { type: 'enum', label: 'Treslag', options: WOOD_OPTIONS },
        color: { ...colorP('Farge'), palette: WOOD_SWATCHES },
        decor: { type: 'bool', label: 'Pynt (bøker og vase)' },
      };
    case 'sideboard-floating':
      return {
        ...POS(), ...SIZE({ h: { min: 0.2, max: 1.2 } }),
        dCm: { type: 'number', min: 25, max: 60, step: 1, label: 'Dybde', unit: 'cm' },
        material: { type: 'enum', label: 'Treslag', options: WOOD_OPTIONS },
        color: { ...colorP('Farge'), palette: WOOD_SWATCHES },
        frontStyle: { type: 'enum', label: 'Fronter', options: [['flat', 'Glatte'], ['ribbed', 'Riflede'], ['slatted', 'Spiler']] },
        doors: { type: 'number', min: 1, max: 8, step: 1, label: 'Antall dører' },
        use: { type: 'enum', label: 'Bruk', options: [['sideboard', 'Skjenk'], ['bench', 'Benk med sittepute']] },
        ...(e.use === 'bench' ? {} : {
          decor: { type: 'bool', label: 'Pynt (bøker og vase)' },
          lamp: { type: 'bool', label: 'Bordlampe på skjenken' },
        }),
      };
    case 'hooks':
      return {
        ...POS(),
        count: { type: 'number', min: 1, max: 10, step: 1, label: 'Antall' },
        spacingCm: { type: 'number', min: 5, max: 40, step: 1, label: 'Avstand', unit: 'cm' },
        style: { type: 'enum', label: 'Type', options: [['fold-out', 'Utfellbare'], ['peg', 'Runde knagger']] },
        material: { type: 'enum', label: 'Treslag', options: WOOD_OPTIONS },
        color: { ...colorP('Farge'), palette: WOOD_SWATCHES },
        ...(e.style === 'peg' ? {} : { plateColor: { ...colorP('Platefarge'), palette: [{ hex: '#a6a29b', name: 'Lys grå' }, { hex: '#6f6c67', name: 'Grå' }, ...METAL_SWATCHES] } }),
      };
    case 'led':
      return {
        ...POS(),
        w: SIZE().w,
        direction: { type: 'enum', label: 'Lysretning', options: [['down', 'Ned'], ['up', 'Opp']] },
        colorK: { type: 'number', min: 2200, max: 4000, step: 100, label: 'Fargetemperatur', unit: 'K' },
        lumensPerM: { type: 'number', min: 100, max: 1500, step: 50, label: 'Lysstyrke', unit: 'lm/m' },
      };
    case 'lamp-wall':
      return {
        cu: { type: 'number', min: 0, max: WALL_W, step: 0.01, label: 'Midt på, fra venstre', unit: 'm' },
        cv: { type: 'number', min: 0.4, max: WALL_H - 0.2, step: 0.01, label: 'Høyde', unit: 'm' },
        style: { type: 'enum', label: 'Type', options: [['sconce', 'Lampett'], ['arm', 'Med arm']] },
        color: { ...colorP('Metallfarge'), palette: METAL_SWATCHES },
        colorK: { type: 'number', min: 2200, max: 4000, step: 100, label: 'Fargetemperatur', unit: 'K' },
      };
    case 'paint-block':
      return {
        ...POS(), ...SIZE(),
        color: colorP('Farge', 'paints'),
        shape: { type: 'enum', label: 'Form', options: [['rect', 'Rektangel'], ['arch', 'Bue'], ['circle', 'Sirkel'], ['half-circle', 'Halvsirkel']] },
        finish: { type: 'enum', label: 'Overflate', options: [['flat', 'Vanlig maling'], ['limewash', 'Kalkmaling (skyet)']] },
      };
    case 'wallpaper': {
      const s = {
        ...POS(), ...SIZE(),
        pattern: { type: 'enum', label: 'Mønster', options: [['botanical', 'Botanisk'], ['mural', 'Panorama (landskap)'], ['stripes', 'Striper'], ['scallop', 'Fiskeskjell'], ['grasscloth', 'Gresstapet']] },
      };
      if (e.pattern !== 'mural') s.scale = { type: 'number', min: 0.5, max: 2.5, step: 0.05, label: 'Mønsterstørrelse' };
      s.seed = { type: 'number', min: 1, max: 200, step: 1, label: 'Variant' };
      const n = e.pattern === 'grasscloth' ? 1 : e.pattern === 'stripes' || e.pattern === 'scallop' ? 3 : Math.max(4, (e.colors || []).length);
      for (let i = 0; i < n; i++) s[`c${i}`] = { ...colorP(i === 0 ? 'Bunnfarge' : `Farge ${i + 1}`), palette: [...ART_SWATCHES, ...FABRIC_SWATCHES] };
      s.shape = { type: 'enum', label: 'Form', options: [['rect', 'Rektangel'], ['arch', 'Bue']] };
      return s;
    }
    case 'moulding':
      return {
        ...POS(), ...SIZE(),
        style: { type: 'enum', label: 'Type', options: [['boxes', 'Kassetter (fyllingspanel)'], ['grid', 'Rutenett av lister'], ['battens', 'Stående lister'], ['rail', 'Bare brystlist']] },
        cols: { type: 'number', min: 1, max: 16, step: 1, label: 'Kolonner' },
        rows: { type: 'number', min: 1, max: 10, step: 1, label: 'Rader' },
        ...(e.style === 'boxes' || !e.style ? { gapCm: { type: 'number', min: 2, max: 40, step: 1, label: 'Avstand mellom kassettene', unit: 'cm' } } : {}),
        profileMm: { type: 'number', min: 15, max: 120, step: 1, label: 'Listebredde', unit: 'mm' },
        reliefMm: { type: 'number', min: 6, max: 50, step: 1, label: 'Listedybde', unit: 'mm' },
        color: colorP('Farge', 'paints'),
        rail: { type: 'bool', label: 'Brystlist øverst' },
      };
    case 'bookcase':
      return {
        ...POS(), ...SIZE(),
        dCm: { type: 'number', min: 18, max: 50, step: 1, label: 'Dybde', unit: 'cm' },
        cols: { type: 'number', min: 1, max: 10, step: 1, label: 'Seksjoner' },
        rows: { type: 'number', min: 1, max: 12, step: 1, label: 'Hyller i høyden' },
        material: { type: 'enum', label: 'Treslag', options: WOOD_OPTIONS },
        color: { ...colorP('Farge'), palette: WOOD_SWATCHES },
        backColor: { ...colorP('Bakvegg (malt)'), palette: 'paints' },
        fill: { type: 'number', min: 0, max: 1, step: 0.05, label: 'Hvor full (bøker)' },
        seed: { type: 'number', min: 1, max: 200, step: 1, label: 'Variant' },
      };
    case 'ledge':
      return {
        ...POS(),
        w: SIZE().w,
        dCm: { type: 'number', min: 5, max: 25, step: 1, label: 'Dybde', unit: 'cm' },
        material: { type: 'enum', label: 'Treslag', options: WOOD_OPTIONS },
        color: { ...colorP('Farge'), palette: [...WOOD_SWATCHES, { hex: '#1f1f1f', name: 'Sort' }, { hex: '#e9e5dc', name: 'Hvit' }] },
        frame: { type: 'enum', label: 'Rammer', options: [['black', 'Sort'], ['oak', 'Eik'], ['smoked-oak', 'Røkt eik'], ['walnut', 'Valnøtt'], ['white', 'Hvit'], ['mixed', 'Blandet (som foreslått)']] },
      };
    case 'plant':
      return {
        cu: { type: 'number', min: 0, max: WALL_W, step: 0.01, label: 'Plassering fra venstre', unit: 'm' },
        species: { type: 'enum', label: 'Plante', options: [['olive', 'Oliventre'], ['ficus-lyrata', 'Fiolinfiken'], ['monstera', 'Monstera'], ['strelitzia', 'Paradisfugl']] },
        height: { type: 'number', min: 0.5, max: 2.4, step: 0.05, label: 'Høyde', unit: 'm' },
        potColor: { ...colorP('Pottefarge'), palette: [{ hex: '#ddd6ca', name: 'Lys keramikk' }, { hex: '#d8d1c5', name: 'Sand' }, { hex: '#4a4440', name: 'Mørk' }, { hex: '#b06f55', name: 'Terrakotta' }, { hex: '#1f1f1f', name: 'Sort' }] },
      };
    default:
      return { ...POS(), ...SIZE() };
  }
}

/**
 * Values for elementEditor(type, el) from an element.
 * @param {object} el
 * @param {object[]} [elements]  the whole design (for values that depend on it, e.g. the sideboard's automatic lamp)
 */
export function elementValues(el, elements = []) {
  if (!el) return {};
  const out = { ...el };
  const b = elementBounds(el);
  const mm = (k) => Math.round(num(el[k], 0) * 1000);
  switch (el.type) {
    case 'slats':
      Object.assign(out, { slatWMm: mm('slatW'), gapMm: mm('gap'), slatDMm: mm('slatD'), standoffMm: mm('standoff'), backing: el.backing || 'felt', waveAmpMm: mm('waveAmp'), wavePeriodCm: Math.round(num(el.wavePeriod, 1.3) * 100) });
      break;
    case 'wallpaper':
      (el.colors?.length ? el.colors : DEFAULTS.wallpaper.colors).forEach((c, i) => (out[`c${i}`] = c));
      Object.assign(out, { pattern: el.pattern || 'botanical', scale: num(el.scale, 1), seed: num(el.seed, 1), shape: el.shape || 'rect' });
      break;
    case 'moulding':
      Object.assign(out, { style: el.style || 'boxes', cols: num(el.cols, 4), rows: num(el.rows, 1), gapCm: Math.round(num(el.gap, 0.1) * 100), profileMm: mm('profile') || 35, reliefMm: mm('relief') || 18, color: el.color || 'sand', rail: el.rail !== false });
      break;
    case 'bookcase':
      Object.assign(out, { dCm: Math.round(num(el.d, 0.3) * 100), cols: num(el.cols, 4), rows: num(el.rows, 6), material: woodKind(el.material, 'oak'), backColor: el.backColor || resolveColor('sand'), fill: num(el.fill, 0.75), seed: num(el.seed, 1) });
      break;
    case 'ledge': {
      const frames = new Set((el.items || []).map((it) => it.frame || 'black'));
      Object.assign(out, { dCm: Math.round(num(el.d, 0.09) * 100), material: woodKind(el.material, 'oak'), frame: frames.size === 1 ? [...frames][0] : 'mixed' });
      break;
    }
    case 'paint-block':
      out.finish = el.finish || 'flat';
      break;
    case 'checker':
      Object.assign(out, {
        cols: num(el.cols, 6), rows: num(el.rows, 3), tileCm: Math.round(num(el.tile, 0.6) * 100), fill: el.fill || 'slats-alternating',
        c0: el.colors?.[0], c1: el.colors?.[1] ?? el.colors?.[0], wood0: el.woods?.[0] || 'oak', wood1: el.woods?.[1] || el.woods?.[0] || 'oak',
        depthMm: mm('depth'), slatWMm: mm('slatW'), slatGapMm: mm('slatGap'),
      });
      break;
    case 'panel':
      Object.assign(out, { depthMm: mm('depth'), frameColor: el.frameColor || '#1f1f1f' });
      break;
    case 'art':
      (el.palette || DEFAULTS.art.palette).forEach((c, i) => (out[`c${i}`] = c));
      Object.assign(out, { seed: num(el.seed, 1), sun: el.sun !== false, acoustic: el.acoustic !== false, frame: el.frame || 'none' });
      break;
    case 'tapestry':
      for (let i = 0; i < 4; i++) out[`c${i}`] = el.colors?.[i] ?? DEFAULTS.tapestry.colors[i];
      Object.assign(out, { rod: el.rod !== false, fringe: el.fringe !== false, motifCount: num(el.motifCount, 4), rodColor: el.rodColor || '#1e1e1e' });
      break;
    case 'circles':
      (el.items || []).forEach((it, i) => (out[`c${i}`] = it.color));
      Object.assign(out, { u: +b.u0.toFixed(2), v: +b.v0.toFixed(2), count: (el.items || []).length, diameterCm: Math.round(num(el.items?.[0]?.r, 0.4) * 200), depthMm: mm('depth') });
      break;
    case 'hexagons':
      Object.assign(out, { u: +b.u0.toFixed(2), v: +b.v0.toFixed(2), count: (el.items || []).length || num(el.count, 12), sizeCm: Math.round(num(el.size, 0.52) * 100), c0: el.colors?.[0], c1: el.colors?.[1], c2: el.colors?.[2], surface: el.surface || 'wood-concrete', depthMm: mm('depth') || 25 });
      break;
    case 'curtain':
      Object.assign(out, { waveCm: +(num(el.waveWidth, 0.135) * 100).toFixed(1), fullness: num(el.fullness, 2.2), trackStyle: el.trackStyle === 'rail' ? 'rail' : 'pelmet' });
      break;
    case 'moss':
      Object.assign(out, { depthMm: mm('depth'), style: el.style || 'mix' });
      break;
    case 'shelf':
      Object.assign(out, { dCm: Math.round(num(el.d, 0.22) * 100), thicknessMm: mm('thickness'), decor: el.decor !== false, material: el.material || 'oak' });
      break;
    case 'sideboard-floating':
      Object.assign(out, { dCm: Math.round(num(el.d, 0.4) * 100), material: woodKind(el.material, 'smoked-oak'), doors: num(el.doors, Math.max(1, Math.round(num(el.w, 2) / 0.55))), use: el.use === 'bench' ? 'bench' : 'sideboard', decor: el.decor !== false, lamp: sideboardHasLamp(el, elements) });
      break;
    case 'hooks': {
      const it = el.items || [];
      Object.assign(out, { u: +b.u0.toFixed(2), v: +b.v0.toFixed(2), count: it.length, spacingCm: it.length > 1 ? Math.round((it[1].cu - it[0].cu) * 100) : 11, style: el.style || 'fold-out', material: el.material || 'oak', plateColor: el.plateColor || '#a6a29b' });
      break;
    }
    case 'led':
      Object.assign(out, { lumensPerM: num(el.lumensPerM, 300), colorK: num(el.colorK, 2700) });
      break;
    default:
      break;
  }
  return out;
}

/** Absorption coefficient estimate when the user changes an element (wallFacts.absorptionGuide). */
function estimateAlpha(el) {
  switch (el.type) {
    case 'slats': {
      if (el.backing === 'none') return 0.12;
      const open = num(el.gap, 0.013) / (num(el.slatW, 0.027) + num(el.gap, 0.013));
      const st = num(el.standoff, 0);
      if (open >= 0.28) return st >= 0.03 ? 0.76 : 0.77;
      return st >= 0.02 ? 0.49 : 0.44;
    }
    case 'checker':
      return el.fill === 'felt' ? 0.8 : 0.77;
    case 'panel': {
      const s = el.surface || 'fabric';
      if (s === 'mirror' || kindGroup(s) === 'wood') return 0.05;
      if (s === 'cork') return 0.3;
      if (s === 'felt') return 0.8;
      return el.edge === 'frame' ? 0.85 : 0.94;
    }
    case 'art':
      return el.acoustic === false ? 0.05 : num(el.depth, 0.045) >= 0.04 ? 0.86 : 0.56;
    case 'curtain':
      return el.fabric === 'velvet' || el.fabric === 'velour' ? 0.49 : 0.4;
    case 'hexagons':
      return el.surface === 'felt' ? 0.8 : el.surface === 'cork' ? 0.3 : el.surface === 'moss' ? 0.47 : kindGroup(el.surface) === 'wood' ? 0.08 : 0.45;
    case 'bookcase':
      // full shelves of books absorb and scatter a little (≈ 0.3 when full, the open wood shelves ≈ 0.1)
      return +(0.1 + 0.25 * clamp(num(el.fill, 0.75), 0, 1)).toFixed(2);
    default:
      return el.alpha ?? 0;
  }
}

const ALPHA_KEYS = new Set(['backing', 'gapMm', 'slatWMm', 'standoffMm', 'fill', 'surface', 'edge', 'acoustic', 'fabric', 'depthMm']);
const LEDGE_FRAME_KEYS = new Set(['black', 'oak', 'smoked-oak', 'walnut', 'white']);

/**
 * Returns a new element with one schema value changed (handles derived keys: mm/cm, colour lists, item-based
 * elements, wood presets). Absorption (`alpha`) is re-estimated when the change affects it.
 * @param {object} el
 * @param {string} key
 * @param {*} value
 * @returns {object}
 */
export function setElementParam(el, key, value) {
  const e = clone(el);
  const b = elementBounds(el);
  const setList = (name, i, val, fbLen = 0) => {
    const list = Array.isArray(e[name]) ? [...e[name]] : [];
    while (list.length < Math.max(fbLen, i + 1)) list.push(list[list.length - 1] ?? '#cccccc');
    list[i] = val;
    e[name] = list;
  };
  const cm = /^(.*)Cm$/.exec(key), mmk = /^(.*)Mm$/.exec(key), ck = /^c(\d)$/.exec(key);
  const t = e.type;
  if ((t === 'circles' || t === 'hexagons' || t === 'hooks') && (key === 'u' || key === 'v')) {
    const du = key === 'u' ? value - b.u0 : 0, dv = key === 'v' ? value - b.v0 : 0;
    if (Array.isArray(e.items) && e.items.length) e.items = e.items.map((it) => ({ ...it, cu: +(it.cu + du).toFixed(3), cv: +(it.cv + dv).toFixed(3) }));
    else {
      e.u = num(e.u, 0) + du;
      e.v = num(e.v, 0) + dv;
    }
  } else if (ck && (t === 'circles')) {
    const i = Number(ck[1]);
    if (e.items?.[i]) e.items[i] = { ...e.items[i], color: value };
  } else if (ck && t === 'hexagons') {
    const i = Number(ck[1]);
    const old = resolveColor(e.colors?.[i] ?? '#b3aa95');
    setList('colors', i, value, 3);
    if (Array.isArray(e.items)) e.items = e.items.map((it) => (resolveColor(it.color) === old ? { ...it, color: value } : it));
  } else if (ck && t === 'art') {
    setList('palette', Number(ck[1]), value, (e.palette || []).length);
  } else if (ck && (t === 'tapestry' || t === 'wallpaper')) {
    setList('colors', Number(ck[1]), value, t === 'wallpaper' ? (e.colors || DEFAULTS.wallpaper.colors).length : 4);
  } else if (t === 'ledge' && key === 'frame') {
    if (LEDGE_FRAME_KEYS.has(value)) e.items = (e.items || []).map((it) => ({ ...it, frame: value }));
  } else if (t === 'moulding' && key === 'gapCm') {
    e.gap = value / 100;
  } else if (ck && t === 'checker') {
    setList('colors', Number(ck[1]), value, 2);
  } else if (key === 'wood0' || key === 'wood1') {
    const i = key === 'wood0' ? 0 : 1;
    setList('woods', i, value, 2);
    if (WOOD_PRESETS[value] && value !== 'painted') setList('colors', i, WOOD_PRESETS[value].hex, 2);
  } else if (key === 'wood' && t === 'slats') {
    e.wood = value;
    if (WOOD_PRESETS[value] && value !== 'painted') e.slatColor = WOOD_PRESETS[value].hex;
  } else if (key === 'material' && (t === 'shelf' || t === 'sideboard-floating' || t === 'hooks' || t === 'bookcase' || t === 'ledge')) {
    e.material = value;
    if (WOOD_PRESETS[value] && value !== 'painted') e.color = WOOD_PRESETS[value].hex;
  } else if (t === 'checker' && (key === 'cols' || key === 'rows' || key === 'tileCm')) {
    if (key === 'tileCm') e.tile = value / 100;
    else e[key] = Math.round(value);
    e.w = +(num(e.cols, 6) * num(e.tile, 0.6)).toFixed(3);
    e.h = +(num(e.rows, 3) * num(e.tile, 0.6)).toFixed(3);
  } else if (t === 'circles' && key === 'count') {
    const n = Math.round(value);
    const items = [...(e.items || [])];
    const r = num(items[0]?.r, 0.4);
    while (items.length > n) items.pop();
    while (items.length < n) {
      const last = items[items.length - 1] || { cu: 0.6, cv: 1.6 + r, r, color: '#b9ab90' };
      const i = items.length;
      items.push({ cu: +(last.cu + r * 2.2).toFixed(3), cv: +(i % 2 ? last.cv - r * 1.6 : last.cv + r * 1.6).toFixed(3), r, color: FELT_SWATCHES[(i * 3) % FELT_SWATCHES.length].hex });
    }
    e.items = items;
  } else if (t === 'circles' && key === 'diameterCm') {
    e.items = (e.items || []).map((it) => ({ ...it, r: value / 200 }));
  } else if (t === 'hexagons' && (key === 'count' || key === 'sizeCm')) {
    const size = key === 'sizeCm' ? value / 100 : num(e.size, 0.52);
    const n = key === 'count' ? Math.round(value) : (e.items || []).length || 12;
    const old = (e.items || []).map((it) => it.color);
    const cx = (b.u0 + b.u1) / 2, cy = (b.v0 + b.v1) / 2;
    const colors = (e.colors?.length ? e.colors : DEFAULTS.hexagons.colors);
    e.size = size;
    e.items = honeycomb(n, size, cx, cy).map((p, i) => ({ ...p, color: old[i] || colors[i % 5 === 2 ? 1 : i % 7 === 4 ? 2 : 0] || colors[0] }));
  } else if (t === 'hooks' && (key === 'count' || key === 'spacingCm')) {
    const it = e.items || [];
    const n = key === 'count' ? Math.round(value) : it.length || 3;
    const sp = key === 'spacingCm' ? value / 100 : it.length > 1 ? it[1].cu - it[0].cu : 0.11;
    const u0 = it[0]?.cu ?? b.u0 + 0.02, cv = it[0]?.cv ?? 1.65;
    e.items = Array.from({ length: n }, (_, i) => ({ cu: +(u0 + i * sp).toFixed(3), cv }));
  } else if (t === 'curtain' && key === 'waveCm') {
    e.waveWidth = value / 100;
  } else if (t === 'sideboard-floating' && key === 'use') {
    e.use = value === 'bench' ? 'bench' : undefined;
    if (value === 'bench') e.v = 0;
    if (e.use === undefined) delete e.use;
  } else if (t === 'art' && key === 'acoustic') {
    e.acoustic = !!value;
    e.depth = value ? Math.max(num(e.depth, 0.045), 0.04) : Math.min(num(e.depth, 0.025), 0.03);
  } else if (cm) {
    e[cm[1] === 'diameter' ? 'd' : cm[1]] = value / 100;
  } else if (mmk) {
    e[mmk[1]] = value / 1000;
  } else if (key === 'color' && t === 'paint-block') {
    e.color = value;
    delete e.paintName;
  } else {
    e[key] = value;
  }
  if (ALPHA_KEYS.has(key) || key === 'wood' || (t === 'checker' && key === 'fill')) e.alpha = +estimateAlpha(e).toFixed(2);
  // keep things on the wall
  if (typeof e.u === 'number' && typeof e.w === 'number') e.u = clamp(e.u, -0.5, WALL_W - Math.min(e.w, 0.1));
  return e;
}

/**
 * A new element of a type, placed sensibly (centre of the wall, or at { u, v }).
 * @param {string} type
 * @param {{ u?: number, v?: number }} [at]
 * @returns {object}
 */
export function createElement(type, at = {}) {
  const d = DEFAULTS[type];
  if (!d) return null;
  const e = { type, ...clone(d) };
  if (typeof at.u === 'number') {
    if ('u' in e && 'w' in e) e.u = +clamp(at.u - e.w / 2, 0, WALL_W - e.w).toFixed(2);
    if ('cu' in e) e.cu = +at.u.toFixed(2);
  }
  if (typeof at.v === 'number') {
    if ('v' in e && 'h' in e && type !== 'sideboard-floating' && type !== 'paint-block' && type !== 'slats') e.v = +clamp(at.v - e.h / 2, 0, WALL_H - e.h).toFixed(2);
    if ('cv' in e) e.cv = +at.v.toFixed(2);
  }
  return e;
}

/** A copy of an element moved by (du, dv) metres on the wall (item-based types move all their items). */
export function moveElement(el, du = 0, dv = 0) {
  const e = clone(el);
  const r3 = (x) => +x.toFixed(3);
  if (Array.isArray(e.items) && e.items.length) e.items = e.items.map((it) => ({ ...it, cu: r3(num(it.cu, 0) + du), cv: r3(num(it.cv, 0) + dv) }));
  else if (typeof e.cu === 'number') {
    e.cu = r3(e.cu + du);
    if (typeof e.cv === 'number') e.cv = r3(e.cv + dv);
  } else {
    e.u = r3(num(e.u, e.type === 'hexagons' ? 0.5 : 0) + du);
    if (e.type !== 'curtain') e.v = r3(num(e.v, e.type === 'hexagons' ? 0.5 : 0) + dv);
  }
  return e;
}

// types that stand on the floor / hang from the ceiling at a fixed height, and flat ones others may be put on
const FIXED_V_TYPES = new Set(['curtain', 'sideboard-floating', 'plant', 'paint-block', 'slats', 'bookcase', 'wallpaper']);
const FLAT_TYPES = new Set(['paint-block', 'led', 'wallpaper', 'moulding']);

/**
 * Moves a new element to the freest spot on the wall: the least overlap with the existing elements (painted fields
 * and LED strips do not count), then the closest to `prefer` (default: the middle of the wall at eye height).
 * @param {object} el  the new element (e.g. from createElement)
 * @param {object[]} existing
 * @param {{ prefer?: { u?: number, v?: number } }} [opts]
 * @returns {object} a moved copy (or el when the wall is empty)
 */
export function placeElement(el, existing = [], { prefer } = {}) {
  const b = elementBounds(el);
  if (!b) return el;
  const obst = (existing || []).filter((e) => e && !FLAT_TYPES.has(e.type)).map((e) => elementBounds(e)).filter(Boolean);
  if (!obst.length) return el;
  const bw = b.u1 - b.u0, bh = b.v1 - b.v0;
  const fixedV = FIXED_V_TYPES.has(el.type) || bh > WALL_H - 0.4;
  const pu = prefer?.u ?? WALL_W / 2, pv = prefer?.v ?? 1.45;
  const vs = [];
  if (fixedV) vs.push(b.v0);
  else for (let v0 = 0.1; v0 <= WALL_H - bh - 0.05 + 1e-6; v0 += 0.05) vs.push(v0);
  if (!vs.length) vs.push(b.v0);
  let best = null;
  for (let u0 = 0; u0 <= Math.max(0, WALL_W - bw) + 1e-6; u0 += 0.05) {
    for (const v0 of vs) {
      let ov = 0;
      for (const o of obst) {
        const x = Math.min(u0 + bw, o.u1) - Math.max(u0, o.u0);
        const y = Math.min(v0 + bh, o.v1) - Math.max(v0, o.v0);
        if (x > 0 && y > 0) ov += x * y;
      }
      const score = ov * 50 + Math.hypot(u0 + bw / 2 - pu, (v0 + bh / 2 - pv) * 1.3);
      if (!best || score < best.score - 1e-9) best = { u0, v0, score };
    }
  }
  return best ? moveElement(el, best.u0 - b.u0, best.v0 - b.v0) : el;
}

/** Short Norwegian description: «Spilepanel · røkt eik · 3,90 × 2,35 m». */
export function describeElement(el) {
  if (!el) return '';
  const label = ELEMENT_TYPES[el.type]?.label || el.type;
  const b = elementBounds(el);
  const size = `${fmt(b.u1 - b.u0)} × ${fmt(b.v1 - b.v0)} m`;
  const wood = WOOD_PRESETS[el.wood || el.material]?.name;
  switch (el.type) {
    case 'slats':
    case 'shelf':
    case 'sideboard-floating':
      return `${label} · ${wood ? wood.toLowerCase() : ''} · ${size}`.replace(' ·  ·', ' ·');
    case 'checker':
      return `${label} · ${num(el.cols, 6)} × ${num(el.rows, 3)} ruter à ${Math.round(num(el.tile, 0.6) * 100)} cm`;
    case 'circles':
      return `${label} · ${(el.items || []).length} stk Ø${Math.round(num(el.items?.[0]?.r, 0.4) * 200)} cm`;
    case 'hexagons':
      return `${label} · ${(el.items || []).length || num(el.count, 12)} stk`;
    case 'hooks':
      return `${label} · ${(el.items || []).length} stk`;
    case 'lamp-wall':
      return `${label} · ${el.style === 'arm' ? 'med arm' : 'lampett'} · ${fmt(num(el.cv, 1.7))} m over gulvet`;
    case 'plant':
      return `${label} · ${{ olive: 'oliventre', 'ficus-lyrata': 'fiolinfiken', monstera: 'monstera', strelitzia: 'paradisfugl' }[el.species] || 'plante'} · ${fmt(num(el.height, 1.5))} m`;
    case 'led':
      return `${label} · ${fmt(num(el.w, 1))} m · ${num(el.colorK, 2700)} K`;
    case 'curtain':
      return `${label} · ${{ velvet: 'fløyel', linen: 'lin', wool: 'ull', cotton: 'bomull' }[el.fabric] || 'stoff'} · ${size}`;
    case 'wallpaper':
      return `${label} · ${{ botanical: 'botanisk', mural: 'panorama', stripes: 'striper', scallop: 'fiskeskjell', grasscloth: 'gresstapet' }[el.pattern] || 'mønster'} · ${size}`;
    case 'moulding':
      return `${label} · ${{ boxes: 'kassetter', grid: 'rutenett', battens: 'stående lister', rail: 'brystlist' }[el.style || 'boxes']} · ${size}`;
    case 'bookcase':
      return `${label} · ${wood ? `${wood.toLowerCase()} · ` : ''}${num(el.cols, 4)} seksjoner · ${size}`;
    case 'ledge':
      return `${label} · ${(el.items || []).length} bilder · ${fmt(num(el.w, 1))} m`;
    default:
      return `${label} · ${size}`;
  }
}

/**
 * Sabine absorption (m²) of one element (same model as design/Acoustics.js: area × alpha).
 * @param {object} element
 * @returns {number}
 */
export function elementAbsorption(element) {
  return acousticElementAbsorption(element);
}

export default applyWallDesign;
