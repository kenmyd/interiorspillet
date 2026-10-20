import * as THREE from 'three';
import schema from '../data/archetypes.json';
import * as K from './kit.js';
import { mat, resolveColor } from '../home/materials.js';
import { createCanvas, canvasTexture, heightToNormalCanvas, TileableNoise, hash2 } from '../world/proctex.js';

/**
 * Soft textiles (ARCHITECTURE §5 «textiles.js», parts §13): `cushion`, `throw`, `pouf`, `rug`.
 *
 *   cushion  params.shape 'square' | 'lumbar' | 'round' | 'bolster'; params.texture = surface look (a fabric kind, or
 *            'bobble' = popcorn tufts); params.pattern 'solid' | 'check' | 'houndstooth' | 'herringbone' | 'zigzag' |
 *            'stripes' | 'waffle' (+ params.patternColor); params.lean = angle to the horizontal (90 upright, 70 leaning
 *            against a sofa back, 0 lying flat); params.flange (m, flat border), params.piping (bool).
 *            dims: w = width, h = height, d = thickness (loft). Origin = centre of the footprint on the surface.
 *   throw    params.drape 'folded' | 'over-arm' | 'over-back' | 'flat' (legacy: params.folded / params.draped);
 *            params.fringe (+ fringeColor), texture/pattern as cushions; over-arm: armH (arm top above the base),
 *            armW, hang (how far it hangs below the arm top); over-back: backH, backT, hang.
 *            dims: h ≤ 2.5 cm → w × d is the fabric (1.3 × 1.7 …) and h its thickness; h > 2.5 cm → w × d × h are the
 *            visible bounds of the folded/draped throw (room-spec «existing» throws). The arm/back is at local +x
 *            (over-arm) / −z (over-back); y = 0 is the seat, a hanging part may reach below it.
 *   pouf     params.shape 'round' | 'square' | 'cylinder', params.legs 'none' | 'wood' | 'plinth' (+ legHeight),
 *            stitchedLines, storage (lid seam), piping. Parts fabric, piping, legs.
 *   rug      params.shape 'rect' | 'round' | 'oval' | 'organic'; pile 'flat' | 'low' | 'medium' | 'high' | 'shaggy';
 *            pattern 'solid' | 'border' | 'stripes' | 'geometric' | 'melange' | 'abstract' | 'wool-knotted' |
 *            'pebble'; weave 'handwoven' | 'hand-tufted' | 'machine-woven' | 'flatweave' | 'braided' | 'felted';
 *            fringe, border (+ borderColor), accent3Color, seed. dims.h = thickness. Parts base, accent, accent2.
 *            'geometric' is the TV-stue rug traced from the photos (seed 2–4 mirror its layout).
 *
 * Textures: fibre detail comes from home/materials.js kinds (metre UVs); relief looks that kinds do not have
 * (popcorn, waffle knit), woven colour patterns (gingham check, houndstooth, herringbone …), rug pile/weave detail and
 * rug pattern maps are generated here on canvases, once per look, and shared. Rug colours are uniforms, so a rug
 * recolours in place (userData.model.recolor) without regenerating anything.
 */

// ---------------------------------------------------------------------------------------------------------------
// Small helpers

const FABRIC_KINDS = new Set(['boucle', 'woven', 'velvet', 'velour', 'linen', 'wool', 'felt', 'leather', 'teddy', 'knit', 'cotton']);
const WOOD_KINDS = new Set(['oak', 'white-oak', 'smoked-oak', 'walnut', 'black-oak', 'teak', 'ash', 'painted', 'lacquer', 'black-metal', 'brass', 'chrome', 'steel', 'bronze']);
const RES_OF = { low: 0.5, medium: 1, high: 1.5 };
const SEG_OF = { low: 0.6, medium: 1, high: 1.45 };
const PATTERNED = new Set(['check', 'houndstooth', 'herringbone', 'zigzag', 'stripes']);
const DEG = Math.PI / 180;
const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
const fract = (x) => x - Math.floor(x);
const smooth = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};
const hexOf = (c, fb = '#cccccc') => resolveColor(c, fb);
const srgbToLin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

/** Linear (working space) colour of a hex. */
const linColor = (hex) => new THREE.Color(hexOf(hex));

/** '#rrggbb' scaled toward black (f < 1) or toward white (f > 1). */
function shadeHex(hex, f) {
  const c = new THREE.Color().setStyle(hexOf(hex), THREE.NoColorSpace);
  const t = f <= 1 ? c.multiplyScalar(f) : c.lerp(new THREE.Color(1, 1, 1), Math.min(1, f - 1));
  return `#${t.getHexString(THREE.NoColorSpace)}`;
}

/** Perceived lightness 0..1 of a hex (sRGB luma). */
function luma(hex) {
  const n = parseInt(hexOf(hex).slice(1), 16);
  return (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
}

/** A pattern colour that contrasts gently with the base when the product data gives none. */
const autoPatternColor = (hex) => (luma(hex) > 0.45 ? shadeHex(hex, 0.74) : shadeHex(hex, 1.28));

/** Valid fabric kind from a material kind / texture param. */
function fabricKind(kind, texture, fallback = 'woven') {
  if (FABRIC_KINDS.has(kind)) return kind;
  if (FABRIC_KINDS.has(texture)) return texture;
  if (texture === 'velvet') return 'velvet';
  if (texture === 'bobble' || texture === 'popcorn') return 'teddy';
  return fallback;
}

const isBobble = (texture) => texture === 'bobble' || texture === 'popcorn';

/** Deterministic seed from the parts of a spec that change the shape. */
const seedOf = (...parts) => parts.map((p) => (typeof p === 'number' ? p.toFixed(3) : String(p))).join('|');

/** Small LRU for generated textures (disposed when evicted; a texture still in use re-uploads on its next use). */
class TexLRU {
  constructor(max) {
    this.max = max;
    this.map = new Map();
  }
  get(key, make) {
    let v = this.map.get(key);
    if (v) {
      this.map.delete(key);
      this.map.set(key, v);
      return v;
    }
    v = make();
    this.map.set(key, v);
    while (this.map.size > this.max) {
      const [k, old] = this.map.entries().next().value;
      this.map.delete(k);
      old?.tex?.dispose?.();
    }
    return v;
  }
}

/** Fast tileable value noise helpers on top of TileableNoise (u, v in tile units 0..1). */
const nz = (N, u, v, f, g = f) => N.noise(u * f, v * g, f, g);

const _lattices = new Map();

/** Jittered points (and two random numbers) per cell of an nx × ny tileable lattice, cached. */
function lattice(nx, ny, seed, jitter) {
  const key = `${nx}|${ny}|${seed}|${jitter}`;
  let L = _lattices.get(key);
  if (!L) {
    const px = new Float32Array(nx * ny), py = new Float32Array(nx * ny), r1 = new Float32Array(nx * ny), r2 = new Float32Array(nx * ny);
    for (let y = 0; y < ny; y++) {
      for (let x = 0; x < nx; x++) {
        const i = y * nx + x;
        px[i] = 0.5 + (hash2(x, y, seed) - 0.5) * jitter;
        py[i] = 0.5 + (hash2(x, y, seed + 101) - 0.5) * jitter;
        r1[i] = hash2(x, y, seed + 7);
        r2[i] = hash2(x, y, seed + 13);
      }
    }
    L = { px, py, r1, r2 };
    _lattices.set(key, L);
  }
  return L;
}

/**
 * Tileable jittered-grid cell noise. Writes into out: f1 (distance to the nearest point, cell units), f2, id (cell id),
 * dx, dy (offset from the nearest point, cell units; x scaled by ax), r1/r2 (two random numbers of the nearest cell).
 */
function cellNoise(u, v, nx, ny, seed, jitter, out, ax = 1) {
  const L = lattice(nx, ny, seed, jitter);
  const gx = u * nx, gy = v * ny;
  const ix = Math.floor(gx), iy = Math.floor(gy);
  let f1 = 9, f2 = 9, best = 0, bdx = 0, bdy = 0;
  for (let dy = -1; dy <= 1; dy++) {
    const cy = iy + dy;
    const hy = ((cy % ny) + ny) % ny;
    for (let dx = -1; dx <= 1; dx++) {
      const cx = ix + dx;
      const hx = ((cx % nx) + nx) % nx;
      const i = hy * nx + hx;
      const ex = (gx - cx - L.px[i]) * ax, ey = gy - cy - L.py[i];
      const dd = Math.sqrt(ex * ex + ey * ey);
      if (dd < f1) {
        f2 = f1;
        f1 = dd;
        best = i;
        bdx = ex;
        bdy = ey;
      } else if (dd < f2) f2 = dd;
    }
  }
  out.f1 = f1;
  out.f2 = f2;
  out.id = best;
  out.dx = bdx;
  out.dy = bdy;
  out.r1 = L.r1[best];
  out.r2 = L.r2[best];
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Texture generation (canvas, flipY = true: canvas row 0 is v = 1, like world/proctex heightToNormalCanvas expects)

const _sets = new Map();

/**
 * Generates a tileable texture set by evaluating pixel(u, v, o) per texel (u, v ∈ [0, 1), v up).
 * o.r/o.g/o.b (0..1; o.g/o.b default to o.r), o.h height. data: true = linear data map (no sRGB decode).
 * Returns { map, normalMap, tile, ref (mean linear luminance of the map, or mean of r for data maps) }.
 */
function genSet(key, { w, h, tile, normal = 2, data = false, res = 1, pixel }) {
  let set = _sets.get(key);
  if (set) return set;
  w = Math.max(16, Math.round(w));
  h = Math.max(16, Math.round(h));
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const img = ctx.createImageData(w, h);
  const D = img.data;
  const heights = new Float32Array(w * h);
  const o = { r: 0, g: -1, b: -1, h: 0 };
  let sum = 0;
  for (let y = 0; y < h; y++) {
    const v = 1 - (y + 0.5) / h;
    for (let x = 0; x < w; x++) {
      o.r = 1;
      o.g = -1;
      o.b = -1;
      o.h = 0;
      pixel((x + 0.5) / w, v, o);
      const r = clamp(o.r), g = clamp(o.g < 0 ? o.r : o.g), b = clamp(o.b < 0 ? o.r : o.b);
      const i = (y * w + x) * 4;
      D[i] = r * 255;
      D[i + 1] = g * 255;
      D[i + 2] = b * 255;
      D[i + 3] = 255;
      heights[y * w + x] = o.h;
      sum += data ? r : srgbToLin(0.2126 * r + 0.7152 * g + 0.0722 * b);
    }
  }
  ctx.putImageData(img, 0, 0);
  const repeat = [1 / tile[0], 1 / tile[1]];
  set = {
    tile,
    ref: Math.max(0.02, sum / (w * h)),
    map: canvasTexture(canvas, { repeat, srgb: !data }),
    // the relief strength is per texel: keep it the same at every resolution
    normalMap: normal ? canvasTexture(heightToNormalCanvas(heights, w, h, normal * res), { repeat, srgb: false }) : null,
  };
  set.map.userData.shared = true;
  if (set.normalMap) set.normalMap.userData.shared = true;
  _sets.set(key, set);
  return set;
}

// ---- popcorn tufts (shared by the texture and the cushion geometry)

const BOB = { sx: 0.05, sy: 0.044, cols: 4, rows: 4 };
const BOB_J = Array.from({ length: BOB.cols * BOB.rows }, (_, i) => [hash2(i % BOB.cols, Math.floor(i / BOB.cols), 31), hash2(i % BOB.cols, Math.floor(i / BOB.cols), 37), hash2(i % BOB.cols, Math.floor(i / BOB.cols), 41)]);
const _bob = { h: 0, dx: 0, dy: 0 };

/**
 * Popcorn tuft field at (x, y) metres: rows of shaggy «shingles» in a brick pattern; each row overlaps the top of
 * the row below like roof tiles. h 0..1, dx/dy offset from the tuft centre (m), edge = how close to the ragged
 * bottom edge (0..1). `rag(x, y)` (optional, ≈ ±1) roughens the bottom edges.
 */
function bobble(x, y, out = _bob, rag = null) {
  const { sx, sy } = BOB;
  const row = Math.floor(y / sy);
  let best = 0, bdx = 0, bdy = 0, bedge = 0;
  const rg = rag ? rag(x, y) * 0.16 : 0;
  for (let k = -1; k <= 1; k++) {
    const r = row + k;
    const off = ((r % 2) + 2) % 2 ? sx / 2 : 0;
    const col = Math.round((x - off) / sx);
    for (let m = -1; m <= 1; m++) {
      // per-tuft variation (repeats with the texture tile: cols × rows tufts)
      const hc = (((col + m) % BOB.cols) + BOB.cols) % BOB.cols, hr = ((r % BOB.rows) + BOB.rows) % BOB.rows;
      const [j1, j2, j3] = BOB_J[hr * BOB.cols + hc];
      const cx = (col + m) * sx + off + (j1 - 0.5) * sx * 0.18, cy = (r + 0.5) * sy + (j2 - 0.5) * sy * 0.15;
      const sc = 0.9 + 0.22 * j3;
      const ex = (x - cx) / (sx * 0.62 * sc), ey = (y - cy) / (sy * 0.78 * sc);
      const bottom = -1 + rg + 0.18 * ex * ex; // rounded, ragged lower edge
      if (ey < bottom || ey > 1.15 || Math.abs(ex) > 1) continue;
      // thicker toward the lower edge (the tuft hangs down and overlaps the next row), thin where it is covered
      const ramp = 0.35 + 0.65 * smooth(1.15, -0.55, ey);
      const lip = smooth(bottom, bottom + 0.3, ey);
      const hh = (1 - ex * ex) ** 0.45 * ramp * (0.25 + 0.75 * lip) * (0.85 + 0.15 * j1);
      if (hh > best) {
        best = hh;
        bdx = x - cx;
        bdy = y - cy;
        bedge = 1 - lip;
      }
    }
  }
  out.h = best;
  out.dx = bdx;
  out.dy = bdy;
  out.edge = bedge;
  return out;
}

function bobbleSet(res) {
  const N = new TileableNoise(301);
  const tile = [BOB.sx * BOB.cols, BOB.sy * BOB.rows];
  const B = {};
  const rag = (x, y) => nz(N, x / tile[0], y / tile[1], 48, 12);
  return genSet(`bobble@${res}`, { w: 384 * res, h: 338 * res, tile, normal: 7, res, pixel(u, v, o) {
    bobble(u * tile[0], v * tile[1], B, rag);
    // shaggy loops hanging down: streaks along y, with clumps
    const streak = nz(N, u, v, 128, 20) * 0.6 + nz(N, u, v, 256, 48) * 0.4;
    const clump = nz(N, u, v, 40, 24);
    const fuzz = nz(N, u, v, 320);
    const top = B.h ** 0.6;
    o.r = (0.5 + 0.5 * top) * (0.88 + 0.12 * streak + 0.05 * clump) * (1 - 0.2 * B.edge) + 0.03 * fuzz;
    o.h = B.h * 0.9 + 0.05 * (0.5 + 0.5 * streak) * top + 0.03 * clump + 0.01 * fuzz;
  } });
}

// ---- waffle knit (grid of soft raised squares, «vaffelstrikk»)

function waffleSet(res) {
  const N = new TileableNoise(303);
  const cells = 4;
  return genSet(`waffle@${res}`, { w: 256 * res, h: 256 * res, tile: [0.084, 0.084], normal: 12, res, pixel(u, v, o) {
    const fx = fract(u * cells) * 2 - 1, fy = fract(v * cells) * 2 - 1;
    const sq = Math.abs(fx) ** 2.6 + Math.abs(fy) ** 2.6;
    const bump = clamp(1 - sq * 0.92) ** 0.75;
    // knit micro-structure: little V stitches in columns
    const col = fract(u * cells * 6), row = fract(v * cells * 8);
    const st = Math.exp(-(((col - 0.5) * 2 - Math.abs(row - 0.5)) ** 2) * 8);
    const fuzz = nz(N, u, v, 64);
    o.r = (0.84 + 0.16 * bump) * (0.93 + 0.07 * st) + 0.02 * fuzz;
    o.h = bump + 0.03 * st + 0.01 * fuzz;
  } });
}

function reliefSet(id, res) {
  if (id === 'bobble') return { ...bobbleSet(res), ns: 1.1 };
  if (id === 'waffle') return { ...waffleSet(res), ns: 1.0 };
  return null;
}

// ---- woven colour patterns for cushions and throws (tile in metres; thread-level so they read as woven)

const _patterns = new TexLRU(24);

function fabricPattern(id, hex, pc, res) {
  if (!PATTERNED.has(id)) return null;
  const base = hexOf(hex);
  const pat = pc ? hexOf(pc) : id === 'herringbone' ? (luma(base) > 0.45 ? shadeHex(base, 0.84) : shadeHex(base, 1.18)) : autoPatternColor(base);
  return _patterns.get(`${id}|${base}|${pat}|${res}`, () => {
    const A = new THREE.Color().setStyle(base, THREE.NoColorSpace);
    const B = new THREE.Color().setStyle(pat, THREE.NoColorSpace);
    const mix = (t) => [A.r + (B.r - A.r) * t, A.g + (B.g - A.g) * t, A.b + (B.b - A.b) * t];
    let tile, fn;
    if (id === 'check') {
      // gingham: coloured warp and weft bands, 2/2 twill decides which thread shows
      const T = 64;
      tile = [0.08, 0.08];
      fn = (u, v) => {
        const i = Math.floor(u * T), j = Math.floor(v * T);
        const bu = i < T * 0.34, bv = j < T * 0.34;
        const warpUp = ((i + j) & 3) < 2;
        return mix(warpUp ? (bu ? 1 : 0) : bv ? 1 : 0);
      };
    } else if (id === 'houndstooth') {
      const T = 32;
      tile = [0.064, 0.064];
      fn = (u, v) => {
        const i = Math.floor(u * T), j = Math.floor(v * T);
        const warpUp = ((i + j) & 3) < 2;
        const dark = warpUp ? ((i >> 2) & 1) === 0 : ((j >> 2) & 1) === 0;
        return mix(dark ? 1 : 0);
      };
    } else if (id === 'herringbone') {
      const T = 32;
      tile = [0.048, 0.048];
      fn = (u, v) => {
        const i = Math.floor(u * T), j = Math.floor(v * T);
        const dir = ((i >> 3) & 1) ? 1 : -1;
        const warpUp = ((((i + dir * j) % 4) + 4) % 4) < 2;
        return mix(warpUp ? 1 : 0);
      };
    } else if (id === 'zigzag') {
      tile = [0.04, 0.04];
      fn = (u, v) => {
        const tri = Math.abs(fract(u) * 2 - 1);
        const y = fract(v * 2 - tri * 0.8);
        const line = smooth(0.05, 0.1, y) * (1 - smooth(0.24, 0.29, y));
        return mix(line);
      };
    } else {
      tile = [0.12, 0.12];
      fn = (u, v) => mix(v < 0.16 || (v > 0.5 && v < 0.56) ? 1 : 0);
    }
    const n = Math.round(clamp(256 * res, 128, 384));
    const canvas = createCanvas(n, n);
    const ctx = canvas.getContext('2d');
    const img = ctx.createImageData(n, n);
    const s = 4; // 4×4 supersampling against thread aliasing
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        let r = 0, g = 0, b = 0;
        for (let sy = 0; sy < s; sy++) {
          for (let sx = 0; sx < s; sx++) {
            const c = fn((x + (sx + 0.5) / s) / n, 1 - (y + (sy + 0.5) / s) / n);
            r += c[0];
            g += c[1];
            b += c[2];
          }
        }
        const i = (y * n + x) * 4, k = 255 / (s * s);
        img.data[i] = r * k;
        img.data[i + 1] = g * k;
        img.data[i + 2] = b * k;
        img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    const tex = canvasTexture(canvas, { srgb: true });
    tex.userData.shared = true;
    return { tex, tile };
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Fabric materials

const _fabMats = new Map();

/** Adds `diffuse *= pattern(uv / tile)` to a material (the pattern carries the colours, the map the fibres). */
function addPatternShader(m, tex, tile) {
  const rep = new THREE.Vector2(1 / tile[0], 1 / tile[1]);
  m.onBeforeCompile = (sh) => {
    sh.uniforms.txPattern = { value: tex };
    sh.uniforms.txPatRep = { value: rep };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform vec2 txPatRep;\nvarying vec2 vTxPatUv;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\n\tvTxPatUv = uv * txPatRep;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D txPattern;\nvarying vec2 vTxPatUv;')
      .replace('#include <map_fragment>', '#include <map_fragment>\n\tdiffuseColor.rgb *= texture2D( txPattern, vTxPatUv ).rgb;');
  };
  m.customProgramCacheKey = () => 'textile-pattern-1';
}

/**
 * Fabric material: a cached materials.js kind, or (relief / woven pattern) a shared clone of it with the extra maps.
 * Shared clones carry userData.shared (never disposed by kit.disposeModel) and no userData.cached, so SceneSync
 * rebuilds the model on a recolour instead of swapping in a plain kind.
 * @param {string} kind  fabric kind
 * @param {string} hex
 * @param {{ relief?: 'bobble'|'waffle'|null, pattern?: string|null, patternColor?: string, scale?: number, res?: number, side?: string }} [o]
 * @returns {THREE.Material}
 */
function fabricMaterial(kind, hex, { relief = null, pattern = null, patternColor = null, scale = 1, res = 1, side } = {}) {
  const k = fabricKind(kind);
  const opts = {};
  if (scale && scale !== 1) opts.scale = scale;
  if (side) opts.side = side;
  const o = Object.keys(opts).length ? opts : undefined;
  const pat = pattern ? fabricPattern(pattern, hex, patternColor, res) : null;
  if (!relief && !pat) return mat(k, hex, o);
  const key = `${k}|${hexOf(hex)}|${relief}|${pattern}|${patternColor}|${scale}|${res}|${side}`;
  let m = _fabMats.get(key);
  if (m) return m;
  const base = mat(k, hex, o);
  m = base.clone();
  const c = linColor(hex);
  const ch = c.r >= c.g && c.r >= c.b ? 'r' : c.g >= c.b ? 'g' : 'b';
  let ref = c[ch] > 1e-4 && base.color[ch] > 1e-6 ? c[ch] / base.color[ch] : 1;
  if (relief) {
    const set = reliefSet(relief, res);
    m.map = set.map;
    m.normalMap = set.normalMap;
    m.normalScale = new THREE.Vector2(set.ns, set.ns);
    m.roughnessMap = null;
    m.roughness = 0.97;
    ref = set.ref;
  }
  if (pat) {
    m.color.setScalar(Math.min(1.6, 1 / ref));
    addPatternShader(m, pat.tex, pat.tile);
  } else {
    m.color.copy(c).multiplyScalar(1 / ref);
    const mx = Math.max(m.color.r, m.color.g, m.color.b);
    if (mx > 1.05) m.color.multiplyScalar(1.05 / mx);
  }
  m.name = `textile ${k} ${hexOf(hex)}${relief ? ` ${relief}` : ''}${pattern ? ` ${pattern}` : ''}`;
  m.userData = { shared: true, kind: k, hex: hexOf(hex), textile: true };
  _fabMats.set(key, m);
  return m;
}

/** Leg/plinth material (wood or metal kind). */
function legMaterial(kind, hex) {
  const k = WOOD_KINDS.has(kind) ? kind : 'oak';
  return mat(k, hex, { grain: 'v' });
}

// ---------------------------------------------------------------------------------------------------------------
// Fringes (alpha-tested ribbons with twisted tassels)

const FRINGE_TILE = 0.04; // metres of hem per texture repeat (6 tassels)

function fringeTexture(res) {
  const key = `fringe@${res}`;
  let t = _sets.get(key);
  if (t) return t;
  const W = Math.round(clamp(128 * res, 64, 256)), H = Math.round(clamp(128 * res, 64, 256));
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  const r = K.rng(77);
  const n = 6;
  // v = 0 (hem) is the bottom row of the canvas (flipY), the tips are at the top
  for (let k = 0; k < n; k++) {
    const x0 = ((k + 0.5) / n) * W;
    const sway = (r() - 0.5) * W * 0.05;
    const len = H * (0.86 + 0.12 * r());
    const wid = (W / n) * 0.42;
    for (let s = -2; s <= 2; s++) {
      ctx.beginPath();
      ctx.moveTo(x0 + s * wid * 0.18, H);
      ctx.bezierCurveTo(x0 + s * wid * 0.2, H * 0.6, x0 + sway + s * wid * 0.25, H * 0.35, x0 + sway * 1.6 + s * wid * 0.32, H - len);
      ctx.lineWidth = Math.max(1, wid * 0.32);
      const tone = 215 + Math.round(40 * r());
      ctx.strokeStyle = `rgb(${tone},${tone},${tone})`;
      ctx.lineCap = 'round';
      ctx.stroke();
    }
    // twist: darker diagonal ticks along the cord
    ctx.strokeStyle = 'rgba(120,120,120,0.55)';
    ctx.lineWidth = Math.max(1, wid * 0.12);
    for (let y = H * 0.95; y > H - len * 0.85; y -= wid * 0.55) {
      const f = (H - y) / len;
      const cx = x0 + sway * f * f * 1.4;
      ctx.beginPath();
      ctx.moveTo(cx - wid * 0.35, y);
      ctx.lineTo(cx + wid * 0.35, y - wid * 0.35);
      ctx.stroke();
    }
    // knot at the hem
    ctx.fillStyle = 'rgb(235,235,235)';
    ctx.beginPath();
    ctx.ellipse(x0, H - wid * 0.25, wid * 0.55, wid * 0.4, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  t = canvasTexture(canvas, { srgb: true });
  t.wrapT = THREE.ClampToEdgeWrapping;
  t.userData.shared = true;
  _sets.set(key, t);
  return t;
}

const _fringeMats = new Map();

function fringeMaterial(hex, res) {
  const key = `${hexOf(hex)}|${res}`;
  let m = _fringeMats.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      color: linColor(hex).multiplyScalar(1.12),
      map: fringeTexture(res),
      alphaTest: 0.42,
      side: THREE.DoubleSide,
      roughness: 0.95,
      metalness: 0,
    });
    m.name = `fringe ${hexOf(hex)}`;
    m.userData = { shared: true, kind: 'fringe', hex: hexOf(hex) };
    _fringeMats.set(key, m);
  }
  return m;
}

/**
 * Fringe ribbon from a hem polyline: each hem point grows `L` metres along its direction, bending toward `bend`
 * (e.g. gravity, or the surface it lies on) at the tip.
 * @param {THREE.Vector3[]} pts  hem points
 * @param {THREE.Vector3[]} dirs unit start direction per point
 * @param {number} L
 * @param {{ bend?: THREE.Vector3, floorY?: number, seed?: string }} [o]
 */
function fringeGeometry(pts, dirs, L, { bend = null, floorY = null, seed = 'f' } = {}) {
  const rows = 4;
  const r = K.rng(seed);
  const pos = [], uv = [], idx = [];
  let acc = 0;
  for (let i = 0; i < pts.length; i++) {
    if (i) acc += pts[i].distanceTo(pts[i - 1]);
    const jitter = (r() - 0.5) * 0.25;
    for (let k = 0; k <= rows; k++) {
      const f = k / rows;
      const p = pts[i].clone().addScaledVector(dirs[i], L * f);
      if (bend) p.addScaledVector(bend, L * f * f * 0.6);
      p.addScaledVector(dirs[i], L * f * jitter * 0.3);
      if (floorY != null && p.y < floorY) p.y = floorY;
      pos.push(p.x, p.y, p.z);
      uv.push(acc / FRINGE_TILE, f);
    }
  }
  for (let i = 0; i < pts.length - 1; i++) {
    for (let k = 0; k < rows; k++) {
      const a = i * (rows + 1) + k, b = a + rows + 1;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function fringeMesh(geo, hex, res, part = 'fabric') {
  const m = K.partMesh(geo, fringeMaterial(hex, res), part, { noMerge: false });
  m.userData.noShadow = true;
  return m;
}

// ---------------------------------------------------------------------------------------------------------------
// Cushions

/**
 * One face of a throw pillow as an indexed grid in the x/y plane (thin axis z, side +1 = front, −1 = back).
 * The seam (z = 0) is pulled in at the middle of each side, the faces dome like a stuffed pillow with thin corners
 * and a few soft wrinkles toward the corners; relief(x, y) adds a height along +z on the front (popcorn).
 */
function pillowFace(W, H, T, side, { nu, nv, kx, ky, rnd, relief }) {
  const pos = new Float32Array((nu + 1) * (nv + 1) * 3);
  const uv = new Float32Array((nu + 1) * (nv + 1) * 2);
  const ph1 = rnd() * 6.28, ph2 = rnd() * 6.28, lump = rnd() * 6.28;
  for (let j = 0; j <= nv; j++) {
    const t = Math.sin(((-1 + (2 * j) / nv) * Math.PI) / 2);
    for (let i = 0; i <= nu; i++) {
      const s = Math.sin(((-1 + (2 * i) / nu) * Math.PI) / 2);
      const x = s * (W / 2) * (1 - kx * (1 - t * t));
      const y = t * (H / 2) * (1 - ky * (1 - s * s));
      const ps = (1 - s * s) ** 0.85, pt = (1 - t * t) ** 0.85;
      const prof = ps * pt;
      let z = (T / 2) * prof * (1 + 0.04 * Math.sin(s * 2.1 + t * 1.7 + lump) * side);
      // folds that run toward the corners (fabric bunching where the stuffing cannot reach)
      const corner = smooth(0.35, 0.95, Math.abs(s * t));
      z += T * 0.035 * corner * Math.sin((Math.abs(s) - Math.abs(t)) * 16 + (side > 0 ? ph1 : ph2)) * prof ** 0.35;
      if (relief && side > 0) z += relief(x, y) * prof ** 0.45;
      const k = (j * (nu + 1) + i) * 3;
      pos[k] = x;
      pos[k + 1] = y;
      pos[k + 2] = side * Math.max(0, z);
      const q = (j * (nu + 1) + i) * 2;
      uv[q] = side * x;
      uv[q + 1] = y;
    }
  }
  const idx = [];
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      const a = j * (nu + 1) + i, b = a + 1, c = a + nu + 1, d = c + 1;
      if (side > 0) idx.push(a, b, c, b, d, c);
      else idx.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Seam outline of a pillow (same pull-in as pillowFace), counter-clockwise, as Vector2 (x, y). */
function pillowOutline(W, H, kx, ky, n = 16) {
  const pts = [];
  const edge = (fn) => {
    for (let i = 0; i < n; i++) pts.push(fn(-1 + (2 * i) / n));
  };
  const P = (s, t) => new THREE.Vector2(s * (W / 2) * (1 - kx * (1 - t * t)), t * (H / 2) * (1 - ky * (1 - s * s)));
  edge((a) => P(a, -1));
  edge((a) => P(1, a));
  edge((a) => P(-a, 1));
  edge((a) => P(-1, -a));
  return pts;
}

/** Round (disc) pillow face: polar grid with a centre fan, in the x/y plane. */
function roundFace(R, T, side, { nr, ns, rnd, button }) {
  const pos = [0, 0, 0], uv = [0, 0];
  const lump = rnd() * 6.28;
  const zc = (T / 2) * (button ? 0.6 : 1);
  pos[2] = side * zc;
  for (let j = 1; j <= nr; j++) {
    const rr = R * Math.sin(((j / nr) * Math.PI) / 2);
    const q = rr / R;
    for (let i = 0; i < ns; i++) {
      const a = (i / ns) * Math.PI * 2;
      let z = (T / 2) * (1 - q * q) ** 0.8 * (1 + 0.04 * Math.sin(a * 3 + lump));
      if (button) z *= 1 - 0.4 * Math.exp(-((rr / (R * 0.22)) ** 2));
      // gathered seam: shallow radial pleats near the rim
      const rim = smooth(0.7, 1, q);
      const pr = rr * (1 - 0.012 * rim * (0.5 + 0.5 * Math.sin(a * 22 + lump)));
      pos.push(Math.cos(a) * pr, Math.sin(a) * pr, side * z * (1 - 0.06 * rim * Math.sin(a * 22 + lump)));
      uv.push(side * Math.cos(a) * pr, Math.sin(a) * pr);
    }
  }
  const idx = [];
  for (let i = 0; i < ns; i++) {
    const a = 1 + i, b = 1 + ((i + 1) % ns);
    if (side > 0) idx.push(0, a, b);
    else idx.push(0, b, a);
  }
  for (let j = 1; j < nr; j++) {
    for (let i = 0; i < ns; i++) {
      const a = 1 + (j - 1) * ns + i, b = 1 + (j - 1) * ns + ((i + 1) % ns);
      const c = a + ns, d = b + ns;
      if (side > 0) idx.push(a, c, b, b, c, d);
      else idx.push(a, b, c, b, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Bolster (neck roll) along x: length L, radius R, gathered ends with a button; centred at the origin. */
function bolsterGeometry(L, R, { seg, rnd }) {
  const end = Math.min(R * 0.55, L * 0.2);
  const prof = [];
  const ne = Math.max(5, Math.round(8 * seg));
  for (let k = 0; k <= ne; k++) {
    const f = k / ne;
    prof.push([R * Math.sin((f * Math.PI) / 2) ** 0.7, -L / 2 + end * (1 - Math.cos((f * Math.PI) / 2))]);
  }
  const nm = Math.max(4, Math.round(10 * seg));
  for (let k = 1; k < nm; k++) {
    const f = k / nm;
    const y = -L / 2 + end + (L - 2 * end) * f;
    prof.push([R * (1 + 0.035 * Math.sin(f * Math.PI)), y]);
  }
  for (let k = ne; k >= 0; k--) {
    const f = k / ne;
    prof.push([R * Math.sin((f * Math.PI) / 2) ** 0.7, L / 2 - end * (1 - Math.cos((f * Math.PI) / 2))]);
  }
  prof[0][0] = 0.002;
  prof[prof.length - 1][0] = 0.002;
  const g = K.lathe(prof, { seg: Math.max(16, Math.round(32 * seg)) });
  // radial pleats where the end is gathered
  const p = g.attributes.position;
  const ph = rnd() * 6.28;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const r = Math.hypot(x, z);
    if (r < 1e-5) continue;
    const de = L / 2 - Math.abs(y);
    const w = 1 - smooth(0, end * 1.3, de);
    if (w <= 0) continue;
    const a = Math.atan2(z, x);
    const f = 1 + 0.07 * w * Math.sin(a * 18 + ph) * (r / R);
    p.setXYZ(i, x * f, y, z * f);
  }
  g.computeVertexNormals();
  g.rotateZ(-Math.PI / 2); // axis y → x
  return g;
}

/**
 * Throw pillow / lumbar / round / bolster. Built upright (front +z), then leant back by (90° − lean) and set down so
 * the footprint is centred on the origin and the part touching the surface is slightly squashed.
 */
function buildCushion(spec) {
  const { dims, params: P, colors: C, materials: M } = spec;
  const q = spec.quality || 'medium';
  const seg = SEG_OF[q] ?? 1, res = RES_OF[q] ?? 1;
  const shape = ['square', 'lumbar', 'round', 'bolster'].includes(P.shape) ? P.shape : 'square';
  const kind = fabricKind(M.fabric, P.texture, 'boucle');
  const relief = isBobble(P.texture) ? 'bobble' : P.pattern === 'waffle' ? 'waffle' : null;
  const pattern = PATTERNED.has(P.pattern) ? P.pattern : null;
  const scale = kind === 'knit' ? 1.35 : kind === 'teddy' ? 1.15 : 1;
  const fabHex = C.fabric || '#cfc6b8';
  const front = fabricMaterial(kind, fabHex, { relief, pattern, patternColor: P.patternColor, scale, res });
  // popcorn cushions have a plain woven back
  const back = relief === 'bobble' ? mat('cotton', fabHex) : front;
  const pipKind = fabricKind(M.piping, null, kind);
  const pipe = mat(pipKind, C.piping || fabHex, pipKind === 'knit' ? { scale } : undefined);
  const rnd = K.rng(seedOf('cushion', dims.w, dims.h, dims.d, shape, kind, P.seed ?? 0));
  const parts = []; // [geometry, material, part, soft (squash)]
  const W = Math.max(0.1, dims.w), H = Math.max(0.1, dims.h);

  if (shape === 'bolster') {
    const R = Math.max(0.04, Math.min(dims.h, dims.d * 1.5, dims.w * 0.45) / 2);
    const geo = bolsterGeometry(W, R, { seg, rnd });
    K.worldUV(geo, 1, { grain: 'x' });
    parts.push([geo, front, 'fabric', true]);
    for (const sx of [-1, 1]) {
      const b = K.cylinder(R * 0.12, R * 0.12, 0.012, { seg: 12, center: true });
      b.rotateZ(Math.PI / 2);
      b.translate(sx * (W / 2 - 0.004), 0, 0);
      parts.push([b, pipe, 'piping', false]);
    }
    return settleCushion(parts, { tilt: 0, squash: Math.min(0.01, R * 0.12) });
  }

  const T = clamp(dims.d, 0.03, 0.6 * Math.min(W, H));
  const flange = clamp(P.flange ?? 0, 0, Math.min(W, H) * 0.12);
  const piping = !!P.piping && flange < 0.003;
  if (shape === 'round') {
    const R = Math.min(W, H) / 2 - flange;
    const nr = Math.max(6, Math.round(12 * seg)), ns = Math.max(20, Math.round(44 * seg));
    const button = !!P.button;
    parts.push([roundFace(R, T, 1, { nr, ns, rnd, button }), front, 'fabric', true]);
    parts.push([roundFace(R, T, -1, { nr, ns, rnd, button }), back, 'fabric', true]);
    if (flange >= 0.003) {
      const ring = K.extrudeShape(K.ringShape(R + flange, R - 0.002, 64), 0.005, { center: true, bevel: 0.0015, curveSegments: 48 });
      parts.push([ring, front, 'fabric', false]);
    }
    if (piping) {
      const pts = K.arcPoints3(new THREE.Vector3(), R, 0, Math.PI * 2, 72, new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0));
      parts.push([K.tube(pts, 0.004, { radial: 6, closed: true, seg: 96 }), pipe, 'piping', false]);
    }
  } else {
    const iw = W - 2 * flange, ih = H - 2 * flange;
    const kx = clamp((0.3 * T) / iw, 0, 0.1), ky = clamp((0.3 * T) / ih, 0, 0.1);
    const dense = relief === 'bobble' && q !== 'low' ? 2.2 : 1;
    const base = Math.round(22 * seg * dense);
    const nu = Math.max(8, Math.round((base * iw) / Math.max(iw, ih)));
    const nv = Math.max(8, Math.round((base * ih) / Math.max(iw, ih)));
    const rel = relief === 'bobble' && q !== 'low' ? (x, y) => 0.014 * bobble(x, y).h : null;
    parts.push([pillowFace(iw, ih, T, 1, { nu, nv, kx, ky, rnd, relief: rel }), front, 'fabric', true]);
    parts.push([pillowFace(iw, ih, T, -1, { nu, nv, kx, ky, rnd, relief: null }), back, 'fabric', true]);
    if (flange >= 0.003) {
      const outer = K.roundedRectShape(W, H, 0.006);
      outer.holes.push(new THREE.Path(pillowOutline(iw - 0.004, ih - 0.004, kx, ky, 12).reverse()));
      parts.push([K.extrudeShape(outer, 0.005, { center: true, bevel: 0.0015, curveSegments: 8 }), front, 'fabric', false]);
    }
    if (piping) {
      const pts = pillowOutline(iw, ih, kx, ky, 18).map((p) => new THREE.Vector3(p.x, p.y, 0));
      parts.push([K.tube(pts, 0.004, { radial: 6, closed: true, seg: 140 }), pipe, 'piping', false]);
    }
  }
  const lean = clamp(Number(P.lean ?? 70), 0, 90);
  return settleCushion(parts, { tilt: (90 - lean) * DEG, squash: Math.min(0.014, T * 0.1) });
}

/** Tilts the cushion back, centres the footprint, sets it down with a squashed contact patch, finishes the model. */
function settleCushion(parts, { tilt, squash }) {
  const m = new THREE.Matrix4().makeRotationX(-tilt);
  const box = new THREE.Box3();
  for (const [geo] of parts) {
    geo.applyMatrix4(m);
    geo.computeBoundingBox();
    box.union(geo.boundingBox);
  }
  const cx = (box.min.x + box.max.x) / 2, cz = (box.min.z + box.max.z) / 2;
  const dy = -box.min.y - squash;
  const g = new THREE.Group();
  for (const [geo, material, part, soft] of parts) {
    geo.translate(-cx, dy, -cz);
    const p = geo.attributes.position;
    let changed = false;
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i);
      if (y < 0) {
        // compressed against the surface: flatten and bulge out a little
        p.setY(i, y * 0.04);
        changed = true;
      }
    }
    if (changed) {
      p.needsUpdate = true;
      if (soft) geo.computeVertexNormals();
    }
    geo.computeBoundingBox();
    geo.computeBoundingSphere();
    g.add(K.partMesh(geo, material, part));
  }
  return K.finishModel(g);
}

// ---------------------------------------------------------------------------------------------------------------
// Throws

/** Fabric thickness by kind (m). */
const THROW_T = { knit: 0.009, teddy: 0.012, boucle: 0.007, wool: 0.006, woven: 0.005, linen: 0.003, cotton: 0.004, velvet: 0.004, velour: 0.005, felt: 0.005, leather: 0.002 };

/** Effective drape of a throw from params (new `drape`, or the legacy `folded` / `draped` flags). */
function throwDrape(P) {
  if (['folded', 'over-arm', 'over-back', 'flat'].includes(P.drape)) return P.drape;
  if (P.draped) return /back|rygg/i.test(String(P.draped)) ? 'over-back' : 'over-arm';
  if (P.folded === false) return 'flat';
  return 'folded';
}

/**
 * Thick fabric sheet from a centre-line grid P[(nu+1)(nv+1)] (i along the drape, j across): top and bottom
 * surfaces offset by ±t/2 along the local normal, plus the four edge strips. UVs in metres (arc length × across).
 * @returns {THREE.BufferGeometry}
 */
function thickSheet(P, nu, nv, t, us, vs) {
  const n = (nu + 1) * (nv + 1);
  const N = new Float32Array(n * 3);
  const at = (i, j) => (j * (nu + 1) + i) * 3;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (let j = 0; j <= nv; j++) {
    for (let i = 0; i <= nu; i++) {
      const i0 = Math.max(0, i - 1), i1 = Math.min(nu, i + 1), j0 = Math.max(0, j - 1), j1 = Math.min(nv, j + 1);
      a.set(P[at(i1, j)] - P[at(i0, j)], P[at(i1, j) + 1] - P[at(i0, j) + 1], P[at(i1, j) + 2] - P[at(i0, j) + 2]);
      b.set(P[at(i, j1)] - P[at(i, j0)], P[at(i, j1) + 1] - P[at(i, j0) + 1], P[at(i, j1) + 2] - P[at(i, j0) + 2]);
      c.crossVectors(b, a).normalize();
      N.set([c.x, c.y, c.z], at(i, j));
    }
  }
  const pos = [], uv = [], idx = [];
  const push = (x, y, z, u, v) => {
    pos.push(x, y, z);
    uv.push(u, v);
    return pos.length / 3 - 1;
  };
  // top (+n) and bottom (−n)
  for (const side of [1, -1]) {
    const o = pos.length / 3;
    for (let j = 0; j <= nv; j++) {
      for (let i = 0; i <= nu; i++) {
        const k = at(i, j);
        push(P[k] + N[k] * side * t / 2, P[k + 1] + N[k + 1] * side * t / 2, P[k + 2] + N[k + 2] * side * t / 2, us[i], side * vs[j]);
      }
    }
    for (let j = 0; j < nv; j++) {
      for (let i = 0; i < nu; i++) {
        const A = o + j * (nu + 1) + i, B = A + 1, Cc = A + nu + 1, D = Cc + 1;
        if (side > 0) idx.push(A, Cc, B, B, Cc, D);
        else idx.push(A, B, Cc, B, D, Cc);
      }
    }
  }
  // edges: strips along the four borders, winding checked against the outward direction
  const edge = (list) => {
    const o = pos.length / 3;
    let acc = 0;
    for (let k = 0; k < list.length; k++) {
      const [i, j] = list[k];
      const q = at(i, j);
      if (k) {
        const [pi, pj] = list[k - 1];
        const pq = at(pi, pj);
        acc += Math.hypot(P[q] - P[pq], P[q + 1] - P[pq + 1], P[q + 2] - P[pq + 2]);
      }
      push(P[q] + N[q] * t / 2, P[q + 1] + N[q + 1] * t / 2, P[q + 2] + N[q + 2] * t / 2, acc, t / 2);
      push(P[q] - N[q] * t / 2, P[q + 1] - N[q + 1] * t / 2, P[q + 2] - N[q + 2] * t / 2, acc, -t / 2);
    }
    // outward = from the neighbouring interior point toward the edge point
    const [i0, j0] = list[0], [i1, j1] = list[1];
    const ii = clamp(i0 + (i0 === 0 ? 1 : i0 === nu ? -1 : 0), 0, nu), jj = clamp(j0 + (j0 === 0 ? 1 : j0 === nv ? -1 : 0), 0, nv);
    const out = new THREE.Vector3(P[at(i0, j0)] - P[at(ii, jj)], P[at(i0, j0) + 1] - P[at(ii, jj) + 1], P[at(i0, j0) + 2] - P[at(ii, jj) + 2]);
    const along = new THREE.Vector3(P[at(i1, j1)] - P[at(i0, j0)], P[at(i1, j1) + 1] - P[at(i0, j0) + 1], P[at(i1, j1) + 2] - P[at(i0, j0) + 2]);
    const nrm = new THREE.Vector3(N[at(i0, j0)], N[at(i0, j0) + 1], N[at(i0, j0) + 2]);
    // quad (top0, bot0, top1): face normal = (bot0 − top0) × (top1 − top0) = (−n) × along
    const fn = nrm.clone().negate().cross(along);
    const flip = fn.dot(out) < 0;
    for (let k = 0; k < list.length - 1; k++) {
      const T0 = o + k * 2, B0 = T0 + 1, T1 = T0 + 2, B1 = T0 + 3;
      if (!flip) idx.push(T0, B0, T1, T1, B0, B1);
      else idx.push(T0, T1, B0, T1, B1, B0);
    }
  };
  const L = (fn, n2) => Array.from({ length: n2 }, (_, k) => fn(k));
  edge(L((k) => [k, 0], nu + 1));
  edge(L((k) => [k, nv], nu + 1));
  edge(L((k) => [0, k], nv + 1));
  edge(L((k) => [nu, k], nv + 1));
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/**
 * Centre-line of a band draped over a support with a rounded top, in the (a, y) plane, densely sampled.
 * The support spans a ∈ [A0, A1] and rises to y = top. start: { kind: 'seat', len } lies on y = 0 on the −a side
 * and folds up the inner face, or { kind: 'hang', depth } hangs down the −a face; endDepth = hang below the top on
 * the +a face. Returns [{ a, y, r: region }] with region 'seat' | 'fold' | 'side' | 'top' | 'hang'.
 */
function drapeProfile({ A0, A1, top, rr, t, start, endDepth, flare }) {
  const pts = [];
  const add = (a, y, r) => pts.push({ a, y, r });
  const arc = (cx, cy, R, a0, a1, n, r) => {
    for (let k = 1; k <= n; k++) {
      const f = a0 + ((a1 - a0) * k) / n;
      add(cx + R * Math.cos(f), cy + R * Math.sin(f), r);
    }
  };
  const ai = A0 - t / 2;
  const R = rr + t / 2;
  if (start.kind === 'seat') {
    const fr = Math.min(0.035, Math.max(0.01, (top - rr) * 0.4));
    const x0 = ai - fr - Math.max(0.02, start.len);
    const steps = Math.max(2, Math.round(start.len / 0.03));
    for (let k = 0; k <= steps; k++) add(x0 + ((ai - fr - x0) * k) / steps, t / 2, 'seat');
    arc(ai - fr, t / 2 + fr, fr, -Math.PI / 2, 0, 6, 'fold');
    const y0 = t / 2 + fr, y1 = top - rr;
    const n = Math.max(1, Math.round((y1 - y0) / 0.03));
    for (let k = 1; k <= n; k++) add(ai, y0 + ((y1 - y0) * k) / n, 'side');
  } else {
    const d = Math.max(0.02, start.depth);
    const y0 = top - d, y1 = top - rr;
    const n = Math.max(2, Math.round((y1 - y0) / 0.03));
    for (let k = 0; k <= n; k++) {
      const f = k / n;
      add(ai - flare * (1 - f) ** 2, y0 + (y1 - y0) * f, 'hang');
    }
  }
  arc(A0 + rr, top - rr, R, Math.PI, Math.PI / 2, 8, 'top');
  const topLen = A1 - A0 - 2 * rr;
  if (topLen > 0.02) {
    const n = Math.max(1, Math.round(topLen / 0.03));
    for (let k = 1; k <= n; k++) add(A0 + rr + (topLen * k) / n, top + t / 2, 'top');
  }
  arc(A1 - rr, top - rr, R, Math.PI / 2, 0, 8, 'top');
  const y0 = top - rr, y1 = top - Math.max(rr + 0.02, endDepth);
  const n = Math.max(2, Math.round((y0 - y1) / 0.03));
  for (let k = 1; k <= n; k++) {
    const f = k / n;
    add(A1 + t / 2 + flare * f * f, y0 + (y1 - y0) * f, 'hang');
  }
  return pts;
}

/** Resamples a profile polyline to n + 1 points at equal arc length; returns { a, y, s, region, len }. */
function resampleProfile(pts, n) {
  const cum = [0];
  for (let k = 1; k < pts.length; k++) cum.push(cum[k - 1] + Math.hypot(pts[k].a - pts[k - 1].a, pts[k].y - pts[k - 1].y));
  const len = cum[cum.length - 1];
  const out = [];
  let k = 1;
  for (let i = 0; i <= n; i++) {
    const s = (len * i) / n;
    while (k < pts.length - 1 && cum[k] < s) k++;
    const f = clamp((s - cum[k - 1]) / Math.max(1e-6, cum[k] - cum[k - 1]));
    out.push({ a: pts[k - 1].a + (pts[k].a - pts[k - 1].a) * f, y: pts[k - 1].y + (pts[k].y - pts[k - 1].y) * f, s, region: f < 0.5 ? pts[k - 1].r : pts[k].r });
  }
  return { pts: out, len };
}

/**
 * Draped band (over an arm or a back) as a thick sheet + optional fringes. Built in (a, y, z) with the support at +a
 * and the band along z; the caller rotates it for over-back.
 */
function drapedBand({ A0, A1, top, rr, t, start, endDepth, bandW, rnd, seg, fringe, flare = 0.04 }) {
  const prof = drapeProfile({ A0, A1, top, rr, t, start, endDepth, flare });
  const { pts } = resampleProfile(prof, Math.max(Math.round(30 * seg), Math.round((len0(prof) / 0.018) * seg)));
  const NU = pts.length - 1;
  const NV = Math.max(6, Math.round((bandW / 0.025) * seg));
  const P = new Float32Array((NU + 1) * (NV + 1) * 3);
  const ph = [rnd() * 6.28, rnd() * 6.28, rnd() * 6.28];
  const lam1 = 0.13 + rnd() * 0.05, lam2 = 0.06 + rnd() * 0.02;
  // smoothed region weights along the drape
  const smoothArr = (arr, n) => {
    for (let pass = 0; pass < n; pass++) for (let i = 1; i < NU; i++) arr[i] = (arr[i - 1] + arr[i] * 2 + arr[i + 1]) / 4;
    return arr;
  };
  const seatW = smoothArr(pts.map((p) => (p.region === 'seat' ? 1 : p.region === 'fold' ? 0.6 : 0)), 4);
  const foldW = smoothArr(pts.map((p) => (p.region === 'fold' ? 1 : 0)), 5);
  const hangIdx = pts.map((p, i) => (p.region === 'hang' && i > NU * 0.3 ? i : -1)).filter((i) => i >= 0);
  const h0 = hangIdx.length ? hangIdx[0] : NU + 1;
  const hangW = smoothArr(pts.map((p, i) => (i >= h0 ? 0.5 + 0.5 * ((i - h0) / Math.max(1, NU - h0)) ** 1.3 : 0)), 3);
  const frontHang = start.kind === 'hang';
  const fh1 = frontHang ? pts.findIndex((p) => p.region !== 'hang') : -1;
  const frontW = pts.map((p, i) => (frontHang && i < fh1 ? 0.5 + 0.5 * (1 - i / Math.max(1, fh1)) ** 1.3 : 0));
  const seatEnd = pts.reduce((m, p, i) => (p.region === 'seat' ? i : m), -1);
  const lam3 = 0.2 + rnd() * 0.06;
  for (let i = 0; i <= NU; i++) {
    const p = pts[i];
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[Math.min(NU, i + 1)];
    let ta = p1.a - p0.a, ty = p1.y - p0.y;
    const tl = Math.hypot(ta, ty) || 1;
    ta /= tl;
    ty /= tl;
    const na = -ty, ny = ta; // normal: away from the support / up from the seat
    const sw = seatW[i], fw = foldW[i], hw = Math.max(hangW[i], frontW[i]), tw = p.region === 'top' ? 1 : 0;
    for (let j = 0; j <= NV; j++) {
      const z = -bandW / 2 + (bandW * j) / NV;
      const zs = (2 * Math.PI * z);
      // on the seat: soft bunches (only upward), bigger where the fabric is pushed against the arm
      let w = 0;
      if (sw > 0) {
        const bunch = 0.5 + 0.5 * Math.sin(zs / lam3 + ph[0] + p.s * 4.1);
        const ripple = Math.abs(Math.sin(zs / lam1 + ph[1] - p.s * 7.3));
        w += sw * (0.016 * bunch * (0.6 + 0.4 * Math.sin(p.s * 5.3 + ph[2])) + 0.006 * ripple);
      }
      if (fw > 0) w += fw * 0.014 * (0.6 + 0.4 * Math.sin(zs / lam2 + ph[2]));
      if (tw) w += 0.002 * Math.abs(Math.sin(zs / lam1 + ph[0]));
      // hanging parts: vertical folds that deepen toward the hem
      if (hw > 0) w += hw * (0.02 * Math.sin(zs / lam1 + ph[0] + p.s * 1.1) + 0.008 * Math.sin(zs / lam2 + ph[1]));
      w += 0.0025 * Math.sin(p.s * 9 + ph[2] + z * 7) * (1 - tw);
      // folded band edges roll under a little
      const edgeF = smooth(bandW * 0.38, bandW * 0.5, Math.abs(z));
      w -= edgeF * 0.004 * (sw > 0.5 || tw ? 0.5 : 1);
      if (sw > 0.5 || tw) w = Math.max(w, -0.002);
      const k = (j * (NU + 1) + i) * 3;
      let aa = p.a + na * w;
      // the end lying on the seat is not cut straight: stretch/shrink the seat part per z
      if (seatEnd > 0 && i <= seatEnd) aa += (p.a - pts[seatEnd].a) * 0.12 * Math.sin(z * 9.5 + ph[1]);
      P[k] = aa;
      P[k + 1] = p.y + ny * w;
      P[k + 2] = z;
    }
  }
  const us = pts.map((p) => p.s);
  const vs = Array.from({ length: NV + 1 }, (_, j) => -bandW / 2 + (bandW * j) / NV);
  const geo = thickSheet(P, NU, NV, t, us, vs);
  const out = { geo, fringes: [] };
  if (fringe) {
    // hem at the hanging end: fringes continue downward
    const end = [], endDirs = [];
    for (let j = 0; j <= NV; j++) {
      const k = (j * (NU + 1) + NU) * 3, k0 = (j * (NU + 1) + NU - 1) * 3;
      const d = new THREE.Vector3(P[k] - P[k0], P[k + 1] - P[k0 + 1], 0).normalize();
      end.push(new THREE.Vector3(P[k], P[k + 1], P[k + 2]));
      endDirs.push(d);
    }
    out.fringes.push({ pts: end, dirs: endDirs, bend: new THREE.Vector3(0, -1, 0) });
    if (start.kind === 'seat') {
      const st = [], dirs = [];
      for (let j = 0; j <= NV; j++) {
        const k = (j * (NU + 1)) * 3;
        st.push(new THREE.Vector3(P[k], P[k + 1] - t * 0.3, P[k + 2]));
        dirs.push(new THREE.Vector3(-1, 0, 0));
      }
      out.fringes.push({ pts: st, dirs, floorY: 0.002 });
    } else {
      const st = [], dirs = [];
      for (let j = 0; j <= NV; j++) {
        const k = (j * (NU + 1)) * 3, k1 = (j * (NU + 1) + 1) * 3;
        st.push(new THREE.Vector3(P[k], P[k + 1], P[k + 2]));
        dirs.push(new THREE.Vector3(P[k] - P[k1], P[k + 1] - P[k1 + 1], 0).normalize());
      }
      out.fringes.push({ pts: st, dirs, bend: new THREE.Vector3(0, -1, 0) });
    }
  }
  return out;
}

function len0(prof) {
  let s = 0;
  for (let k = 1; k < prof.length; k++) s += Math.hypot(prof[k].a - prof[k - 1].a, prof[k].y - prof[k - 1].y);
  return s;
}

/** A throw lying spread out (bed / floor): thick sheet with soft low ridges, fringes lying flat on the short ends. */
function flatThrow(w, d, t, { rnd, seg, fringe }) {
  const nu = Math.max(10, Math.round((w / 0.035) * seg)), nv = Math.max(10, Math.round((d / 0.035) * seg));
  const P = new Float32Array((nu + 1) * (nv + 1) * 3);
  const N = new TileableNoise(Math.floor(rnd() * 1000) + 1);
  for (let j = 0; j <= nv; j++) {
    for (let i = 0; i <= nu; i++) {
      const x = -w / 2 + (w * i) / nu, z = -d / 2 + (d * j) / nv;
      const r = N.noise(x * 3.1 + 7, z * 3.1 + 3, 64) * 0.6 + N.noise(x * 7 + 1, z * 1.7, 64) * 0.4;
      const ridge = Math.max(0, r - 0.15) * 0.012;
      const edge = Math.min(1, Math.min(w / 2 - Math.abs(x), d / 2 - Math.abs(z)) / 0.06);
      const k = (j * (nu + 1) + i) * 3;
      P[k] = x;
      P[k + 1] = t / 2 + ridge * edge;
      P[k + 2] = z;
    }
  }
  const us = Array.from({ length: nu + 1 }, (_, i) => -w / 2 + (w * i) / nu);
  const vs = Array.from({ length: nv + 1 }, (_, j) => -d / 2 + (d * j) / nv);
  const geo = thickSheet(P, nu, nv, t, us, vs);
  const fringes = [];
  if (fringe) {
    const along = d >= w ? 'x' : 'z';
    for (const s of [-1, 1]) {
      const pts = [], dirs = [];
      const n = 24;
      for (let k = 0; k <= n; k++) {
        const f = -0.5 + k / n;
        if (along === 'x') {
          pts.push(new THREE.Vector3(f * (w - 0.01), 0.003, s * d / 2));
          dirs.push(new THREE.Vector3(0, 0, s));
        } else {
          pts.push(new THREE.Vector3(s * w / 2, 0.003, f * (d - 0.01)));
          dirs.push(new THREE.Vector3(s, 0, 0));
        }
      }
      fringes.push({ pts, dirs, floorY: 0.002 });
    }
  }
  return { geo, fringes };
}

/**
 * A folded throw as one soft block: rounded fold edges on ±z, the stacked layer edges (soft grooves) on ±x, a domed
 * top with a faint crease, drooping corners. Bottom at y = 0.
 */
function foldedBlock(W, H, D, { rnd, seg, layers }) {
  const nx = Math.max(10, Math.round(18 * seg)), ny = Math.max(8, Math.round(4 * layers * Math.min(1.3, seg))), nz = Math.max(10, Math.round(16 * seg));
  const g = new THREE.BoxGeometry(W, H, D, nx, ny, nz);
  const p = g.attributes.position;
  const half = [W / 2, H / 2, D / 2];
  const R = Math.min(H * 0.48, 0.035);
  const inner = half.map((h) => Math.max(0, h - R));
  const ph = [rnd() * 6.28, rnd() * 6.28, rnd() * 6.28];
  const P = [0, 0, 0], c = [0, 0, 0];
  for (let i = 0; i < p.count; i++) {
    // cluster the grid toward the edges (more vertices in the rounded zones)
    P[0] = half[0] * Math.sin((p.getX(i) / half[0]) * (Math.PI / 2));
    P[1] = half[1] * Math.sin((p.getY(i) / half[1]) * (Math.PI / 2));
    P[2] = half[2] * Math.sin((p.getZ(i) / half[2]) * (Math.PI / 2));
    for (let k = 0; k < 3; k++) c[k] = Math.max(-inner[k], Math.min(inner[k], P[k]));
    const ox = P[0] - c[0], oy = P[1] - c[1], oz = P[2] - c[2];
    const len = Math.hypot(ox, oy, oz);
    if (len > 1e-9) {
      P[0] = c[0] + (ox / len) * R;
      P[1] = c[1] + (oy / len) * R;
      P[2] = c[2] + (oz / len) * R;
    }
    const qx = P[0] / half[0], qy = P[1] / half[1], qz = P[2] / half[2];
    const up = (qy + 1) / 2;
    // domed top, drooping corners, a soft diagonal crease
    P[1] += H * 0.1 * (1 - qx * qx) * (1 - qz * qz) * up;
    P[1] -= 0.008 * qx * qx * qz * qz * up;
    const cr = qx * 0.7 + qz * 0.5 + 0.1;
    P[1] -= 0.004 * Math.exp(-(cr * cr) / 0.015) * (1 - qx ** 4) * (1 - qz ** 4) * up ** 4;
    // stacked layer edges on the ±x sides: soft grooves between the layers
    const sideX = smooth(0.8, 0.98, Math.abs(qx));
    if (sideX > 0) {
      const k = up * layers;
      const groove = 0.5 - 0.5 * Math.cos(2 * Math.PI * k);
      P[0] -= Math.sign(qx) * sideX * 0.007 * (1 - groove) * (1 - Math.abs(qy) ** 6);
    }
    // the fabric is not cut straight: gentle waves along the edges, a lumpy top
    P[0] += 0.007 * Math.sin(qz * 3.3 + ph[0] + up * 1.5) * Math.abs(qx) ** 4;
    P[2] += 0.007 * Math.sin(qx * 2.9 + ph[1]) * Math.abs(qz) ** 4;
    P[1] += 0.004 * Math.sin(qx * 2.2 + qz * 1.7 + ph[2]) * Math.sin(qz * 3.1 - ph[0]) * up ** 3;
    p.setXYZ(i, P[0], P[1] + H / 2, P[2]);
  }
  K.smoothNormals(g);
  K.worldUV(g, 1, { grain: 'x' });
  return g;
}

/** A folded throw (one soft folded block, slightly askew), with an optional fringe row hanging down one side. */
function foldedThrow(W, D, H, { rnd, seg, fringe }) {
  const layers = H > 0.04 ? 3 : 2;
  const g = foldedBlock(W, H, D, { rnd, seg, layers });
  g.rotateY((rnd() - 0.5) * 3 * DEG);
  const geos = [g];
  const fringes = [];
  if (fringe) {
    const pts = [], dirs = [];
    const n = 20;
    for (let k = 0; k <= n; k++) {
      const f = -0.5 + k / n;
      pts.push(new THREE.Vector3(-W / 2 - 0.002, H * 0.62, f * (D - 0.03)));
      dirs.push(new THREE.Vector3(-0.25, -1, 0).normalize());
    }
    fringes.push({ pts, dirs, floorY: 0.002, bend: new THREE.Vector3(-1, 0, 0) });
  }
  return { geos, fringes };
}

function buildThrow(spec) {
  const { dims, params: P, colors: C, materials: M } = spec;
  const q = spec.quality || 'medium';
  const seg = SEG_OF[q] ?? 1, res = RES_OF[q] ?? 1;
  const kind = fabricKind(M.fabric, P.texture, 'wool');
  const relief = P.pattern === 'waffle' || P.texture === 'waffle' ? 'waffle' : isBobble(P.texture) ? 'bobble' : null;
  const pattern = PATTERNED.has(P.pattern) ? P.pattern : null;
  const hex = C.fabric || '#a7b89c';
  const fab = fabricMaterial(kind, hex, { relief, pattern, patternColor: P.patternColor, scale: kind === 'knit' ? 1.2 : 1, res });
  const fringeHex = P.fringeColor || hex;
  const drape = throwDrape(P);
  // Catalogue throws give the fabric size (w × d) and its thickness (h). The room-spec throws (legacy folded /
  // draped flags, h > 2 cm) give the visible bounds instead: used as they are for their own drape, converted to a
  // plausible fabric size when the drape is changed.
  const legacy = P.folded === true || !!P.draped;
  const origDrape = P.draped ? 'over-arm' : 'folded';
  const pkg = legacy && dims.h > 0.02;
  const fabricDims = !(pkg && drape === origDrape);
  let FW = dims.w, FD = dims.d;
  if (pkg && fabricDims) {
    FW = origDrape === 'folded' ? dims.w * 3 : dims.d * 3;
    FD = origDrape === 'folded' ? dims.d * 3 : 2 * (dims.w + 0.35);
  }
  const tFab = pkg ? THROW_T[kind] ?? 0.006 : clamp(dims.h, 0.002, 0.02);
  const rnd = K.rng(seedOf('throw', dims.w, dims.d, dims.h, drape, kind, P.seed ?? 0));
  const fringe = !!P.fringe;
  const g = new THREE.Group();
  const addFringes = (list, root = g) => {
    for (const f of list) {
      const geo = fringeGeometry(f.pts, f.dirs, P.fringeLength ?? 0.07, { bend: f.bend, floorY: f.floorY, seed: `${hex}${f.pts.length}` });
      root.add(fringeMesh(geo, fringeHex, res));
    }
  };

  if (drape === 'flat') {
    const { geo, fringes } = flatThrow(FW, FD, tFab, { rnd, seg, fringe });
    g.add(K.partMesh(geo, fab, 'fabric'));
    addFringes(fringes);
    return K.finishModel(g);
  }
  if (drape === 'folded') {
    const W = fabricDims ? FW / 3 : dims.w, D = fabricDims ? FD / 3 : dims.d;
    const H = fabricDims ? clamp(tFab * 9 * 0.85, 0.025, 0.12) : dims.h;
    const { geos, fringes } = foldedThrow(W, D, H, { rnd, seg, fringe });
    for (const geo of geos) g.add(K.partMesh(geo, fab, 'fabric'));
    addFringes(fringes);
    return K.finishModel(g);
  }

  // draped over an arm (support at +x) or a back (support at −z): build in (a, y, z) with the support at +a
  const t = fabricDims ? Math.min(0.02, tFab * 2.5) : clamp(tFab * 2.6, 0.008, 0.022);
  const overBack = drape === 'over-back';
  const supW = overBack ? clamp(P.backT ?? 0.2, 0.05, 0.5) : clamp(P.armW ?? 0.22, 0.05, 0.5);
  const top = overBack ? clamp(P.backH ?? 0.4, 0.1, 1) : clamp(P.armH ?? 0.15, 0.05, 0.8);
  const rr = Math.min(supW / 2, overBack ? 0.06 : supW / 2);
  const hang = clamp(P.hang ?? (overBack ? 0.28 : 0.32), 0.05, 1.2);
  let bandW, A0, A1, start;
  if (overBack) {
    // footprint along a = d (front hang + back + rear hang), band along x = w
    const depth = fabricDims ? Math.max(0.3, FD * 0.55) : dims.d;
    bandW = fabricDims ? FW * 0.5 : dims.w;
    const sw = Math.min(supW, depth - 2 * t - 0.06);
    A1 = sw / 2;
    A0 = -sw / 2;
    start = { kind: 'hang', depth: Math.min(top - 0.02, overBack ? top * 0.85 : top) };
    if (fabricDims) start.depth = Math.min(top - 0.02, Math.max(0.1, FD * 0.5 - hang - supW - 2 * rr));
  } else {
    bandW = fabricDims ? FW / 3 : dims.d;
    if (fabricDims) {
      // path length = half the fabric length (folded once); what does not go over the arm lies on the seat
      const wrap = Math.PI * 0.75 * rr + (top - rr) + (supW - 2 * rr) + hang;
      const seatLen = Math.max(0.08, FD / 2 - wrap);
      A0 = 0;
      A1 = supW;
      start = { kind: 'seat', len: seatLen };
    } else {
      const w = Math.max(dims.w, supW + 0.1);
      const sw = Math.min(supW, w * 0.6);
      A1 = w / 2 - Math.min(0.1, w * 0.17); // room for the fabric hanging round the outside
      A0 = A1 - sw;
      start = { kind: 'seat', len: Math.max(0.03, A0 - t / 2 - 0.035 - (-w / 2)) };
    }
  }
  const band = drapedBand({ A0, A1, top, rr, t, start, endDepth: hang, bandW, rnd, seg, fringe, flare: fabricDims ? 0.03 : 0.05 });
  const inner = new THREE.Group();
  inner.add(K.partMesh(band.geo, fab, 'fabric'));
  addFringes(band.fringes, inner);
  // centre the footprint along a (over-arm keeps the seat level at y = 0)
  band.geo.computeBoundingBox();
  const bb = band.geo.boundingBox;
  const ca = (bb.min.x + bb.max.x) / 2;
  inner.position.x = -ca;
  if (overBack) {
    const wrap = new THREE.Group();
    wrap.add(inner);
    wrap.rotation.y = Math.PI / 2; // +a → −z (the back is behind), band along z → along x
    g.add(wrap);
  } else g.add(inner);
  return K.finishModel(g);
}

// ---------------------------------------------------------------------------------------------------------------
// Poufs

function buildPouf(spec) {
  const { dims, params: P, colors: C, materials: M } = spec;
  const q = spec.quality || 'medium';
  const seg = SEG_OF[q] ?? 1, res = RES_OF[q] ?? 1;
  const shape = ['round', 'square', 'cylinder'].includes(P.shape) ? P.shape : 'round';
  const kind = fabricKind(M.fabric, P.texture, 'boucle');
  const relief = isBobble(P.texture) ? 'bobble' : P.pattern === 'waffle' ? 'waffle' : null;
  const knitScale = kind === 'knit' ? (P.texture === 'chunky' || P.chunky ? 3.2 : 2.2) : 1;
  const hex = C.fabric || '#ece7dd';
  const fab = fabricMaterial(kind, hex, { relief, pattern: PATTERNED.has(P.pattern) ? P.pattern : null, patternColor: P.patternColor, scale: knitScale, res });
  const pipKind = fabricKind(M.piping, null, kind);
  const pipe = mat(pipKind, C.piping || hex, pipKind === 'knit' ? { scale: knitScale } : undefined);
  const legsKind = M.legs, legsHex = C.legs || '#c9a978';
  const legs = ['none', 'wood', 'plinth'].includes(P.legs) ? P.legs : 'none';
  const legH = legs === 'none' ? 0 : clamp(P.legHeight ?? (legs === 'plinth' ? 0.03 : 0.1), 0.01, dims.h * 0.5);
  const W = dims.w, D = dims.d, Hb = Math.max(0.08, dims.h - legH);
  const g = new THREE.Group();
  const R = Math.min(W, D) / 2;
  let topY = dims.h;

  if (shape === 'square') {
    const geo = K.cushion(W, Hb, D, { axis: 'y', puff: 0.06, round: 0.55, top: 1, bottom: 0.25, sides: 0.35, pinch: 0.08, seg: Math.max(8, Math.round(16 * seg)), bottomOrigin: true, grain: 'x' });
    geo.translate(0, legH, 0);
    g.add(K.partMesh(geo, fab, 'fabric'));
    if (P.piping) {
      const r = Math.min(0.03, Hb * 0.15);
      const pts = K.roundedRectShape(W - r * 0.6, D - r * 0.6, r * 1.4).getPoints(6).map((p) => new THREE.Vector3(p.x, legH + Hb - r * 0.35, p.y));
      if (pts.length > 2 && pts[0].distanceTo(pts[pts.length - 1]) < 1e-6) pts.pop();
      g.add(K.partMesh(K.tube(pts, 0.0045, { radial: 6, closed: true, curve: 'catmull' }), pipe, 'piping'));
    }
  } else {
    const cyl = shape === 'cylinder';
    const rcTop = cyl ? Math.min(0.025, Hb * 0.12) : Math.min(0.09, Hb * 0.3, R * 0.35);
    const rcBot = cyl ? 0.008 : Math.min(0.035, Hb * 0.12);
    const bulge = cyl ? 0.004 : R * 0.035;
    const dome = cyl ? 0.004 : Math.min(0.018, Hb * 0.05);
    const prof = [[0.001, 0]];
    const arcN = Math.max(4, Math.round(7 * seg));
    for (let k = 0; k <= arcN; k++) {
      const f = (k / arcN) * (Math.PI / 2);
      prof.push([R - rcBot + rcBot * Math.sin(f) - 0.004 * (1 - Math.sin(f)), rcBot - rcBot * Math.cos(f)]);
    }
    const sideN = Math.max(4, Math.round(8 * seg));
    const seamY = P.storage ? Hb - Math.min(0.07, Hb * 0.18) : null;
    for (let k = 1; k < sideN; k++) {
      const f = k / sideN;
      const y = rcBot + (Hb - rcTop - rcBot) * f;
      let r = R + bulge * Math.sin(f * Math.PI);
      if (seamY != null && Math.abs(y - seamY) < 0.012) r -= 0.004 * (1 - Math.abs(y - seamY) / 0.012);
      prof.push([r, y]);
    }
    if (seamY != null) {
      // lid seam: a crisp little groove
      prof.push([R - 0.005, seamY - 0.002], [R - 0.005, seamY + 0.002]);
      prof.sort((a, b) => a[1] - b[1]);
    }
    for (let k = 0; k <= arcN; k++) {
      const f = (k / arcN) * (Math.PI / 2);
      prof.push([R - rcTop + rcTop * Math.cos(f), Hb - rcTop + rcTop * Math.sin(f)]);
    }
    const topN = Math.max(3, Math.round(5 * seg));
    for (let k = 1; k <= topN; k++) {
      const f = k / topN;
      prof.push([(R - rcTop) * (1 - f) + 0.001 * f, Hb + dome * Math.sin((f * Math.PI) / 2)]);
    }
    const nStitch = 9;
    const around = P.stitchedLines ? nStitch * Math.max(6, Math.round(10 * seg)) : Math.max(24, Math.round(48 * seg));
    const geo = K.lathe(prof, { seg: around });
    if (P.stitchedLines) {
      // vertical stitched channels (Olea-style): narrow grooves around the side
      const p = geo.attributes.position, n = nStitch;
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
        const r = Math.hypot(x, z);
        if (r < R * 0.6) continue;
        const a = Math.atan2(z, x);
        const d = Math.abs(fract((a / (Math.PI * 2)) * n) - 0.5) * 2; // 0 at a groove
        const sideW = smooth(0.02, 0.18, y) * (1 - smooth(Hb - rcTop * 0.8, Hb, y));
        const f = 1 - 0.05 * Math.exp(-((d / 0.1) ** 2)) * sideW + 0.01 * Math.sin(Math.PI * d) * sideW;
        p.setXYZ(i, x * f, y, z * f);
      }
    }
    geo.computeVertexNormals();
    geo.translate(0, legH, 0);
    g.add(K.partMesh(geo, fab, 'fabric'));
    topY = legH + Hb + dome;
    if (P.piping) {
      const pr = R - rcTop * 0.3, py = legH + Hb - rcTop * 0.3;
      g.add(K.partMesh(K.torus(pr, 0.0045, { radial: 6, tubular: 96 }).rotateX(Math.PI / 2).translate(0, py, 0), pipe, 'piping'));
    }
  }

  if (legs === 'wood') {
    const lm = legMaterial(legsKind, legsHex);
    const n = shape === 'square' ? 4 : 3;
    for (let k = 0; k < n; k++) {
      const a = shape === 'square' ? Math.PI / 4 + (k * Math.PI) / 2 : Math.PI / 2 + (k * Math.PI * 2) / n;
      const rx = shape === 'square' ? (W / 2 - 0.05) * Math.SQRT2 : R * 0.68;
      const rz = shape === 'square' ? (D / 2 - 0.05) * Math.SQRT2 : R * 0.68;
      const leg = K.taperLeg(legH + 0.012, 0.016, 0.011, { seg: 10 });
      const m = K.partMesh(leg, lm, 'legs', { position: [Math.cos(a) * rx * 0.72, 0, Math.sin(a) * rz * 0.72] });
      // a little splay outward
      m.rotation.set(Math.sin(a) * 7 * DEG, 0, -Math.cos(a) * 7 * DEG);
      g.add(m);
    }
  } else if (legs === 'plinth') {
    const lm = legMaterial(legsKind, legsHex);
    if (shape === 'square') g.add(K.partMesh(K.roundedBox(W - 0.06, legH, D - 0.06, 0.004, 2, { bottom: true, grain: 'x' }), lm, 'legs'));
    else g.add(K.partMesh(K.cylinder(R * 0.86, R * 0.86, legH, { seg: Math.max(24, Math.round(40 * seg)) }), mat(WOOD_KINDS.has(legsKind) ? legsKind : 'oak', legsHex), 'legs'));
  }
  const top = shape === 'square' ? Math.min(W, D) * 0.75 : R * 1.3;
  return K.finishModel(g, { seatY: topY, surfaces: [{ y: topY, w: top, d: top, center: [0, 0] }] });
}

// ---------------------------------------------------------------------------------------------------------------
// Rugs

/** Pile → edge radius factor and sheen. */
const PILE = {
  flat: { edge: 0.3, sheen: 0.22, ns: 1.0 },
  low: { edge: 0.45, sheen: 0.42, ns: 1.0 },
  medium: { edge: 0.6, sheen: 0.5, ns: 1.1 },
  high: { edge: 0.75, sheen: 0.6, ns: 1.2 },
  shaggy: { edge: 0.85, sheen: 0.7, ns: 1.3 },
};

/** Rug detail surfaces: tiled maps with r = shade, g/b = accent/accent2 fleck weights (+ a normal map). */
function rugDetail(type, res) {
  const r2 = (x) => Math.max(16, Math.round(x * res));
  const C = {};
  switch (type) {
    case 'pebble': {
      // felted wool balls ≈ 13 mm, close packed, deep crevices
      const N = new TileableNoise(401);
      const n = 34;
      return genSet(`rug-pebble@${res}`, { w: r2(512), h: r2(512), tile: [0.45, 0.45], normal: 4.2, data: true, res, pixel(u, v, o) {
        cellNoise(u, v, n, n, 41, 0.62, C, 0.86);
        const R = 0.5 + 0.08 * C.r2;
        const dome = Math.sqrt(clamp(1 - (C.f1 / R) ** 2));
        const crease = 1 - smooth(0.0, 0.14, C.f2 - C.f1); // where two balls press together
        const fz = nz(N, u, v, 192) * 0.5 + nz(N, u, v, 96) * 0.5;
        o.r = (0.3 + 0.7 * dome ** 0.55) * (1 - 0.3 * crease) * (0.95 + 0.05 * fz) * (0.95 + 0.1 * C.r2);
        o.g = C.r1 < 0.13 ? 1 : 0;
        o.b = C.r1 > 0.84 ? 1 : 0;
        o.h = dome * (1 - 0.35 * crease) + 0.04 * fz;
      } });
    }
    case 'loop':
    case 'knotted': {
      // berber loops (rows of little rings), knotted = chunkier
      const big = type === 'knotted';
      const N = new TileableNoise(403);
      const rows = big ? 12 : 16, per = big ? 10 : 14;
      return genSet(`rug-${type}@${res}`, { w: r2(256), h: r2(256), tile: big ? [0.13, 0.13] : [0.09, 0.09], normal: big ? 3.4 : 2.8, data: true, res, pixel(u, v, o) {
        const wav = nz(N, u, v, 6, 4) * 0.25;
        const gy = v * rows + wav, row = Math.floor(gy);
        const rr0 = ((row % rows) + rows) % rows;
        const gx = u * per + (row & 1) * 0.5 + (hash2(rr0, 1, 63) - 0.5) * 0.6 + nz(N, u, v, 3, 8) * 0.3, col = Math.floor(gx);
        const cc0 = ((col % per) + per) % per;
        const sz = 0.85 + 0.3 * hash2(cc0, rr0, 65);
        const fx = (fract(gx) - 0.5 + (hash2(cc0, rr0, 67) - 0.5) * 0.2) / sz, fy = (fract(gy) - 0.5) / sz;
        const d = Math.hypot(fx / 0.46, fy / 0.52);
        const ring = Math.exp(-(((d - 0.55) / 0.22) ** 2));
        const blob = 0.55 * Math.exp(-(d * d) / 0.3);
        const hh = Math.max(ring, blob) * (d < 1.05 ? 1 : 0.4);
        const id1 = hash2(((col % per) + per) % per, ((row % rows) + rows) % rows, 61);
        const fz = nz(N, u, v, 128);
        o.r = (0.5 + 0.5 * hh) * (0.95 + 0.05 * fz);
        o.g = id1 < (big ? 0.1 : 0.07) ? 1 : 0;
        o.b = id1 > 0.9 ? 1 : 0;
        o.h = hh + 0.08 * fz;
      } });
    }
    case 'flat': {
      // weft-faced flat weave: picks ≈ 3 mm tall passing over warps every ≈ 4 mm; heathered yarn segments
      const N = new TileableNoise(405);
      const rows = 22, warps = 18;
      return genSet(`rug-flat@${res}`, { w: r2(256), h: r2(256), tile: [0.072, 0.072], normal: 2.4, data: true, res, pixel(u, v, o) {
        const gy = v * rows, row = Math.floor(gy), fy = fract(gy);
        const gx = u * warps + (row & 1) * 0.5, fx = fract(gx);
        const pick = Math.sin(Math.PI * fy) ** 0.6;
        const bump = 0.75 + 0.25 * Math.sin(Math.PI * fx);
        const rr = ((row % rows) + rows) % rows;
        const segs = 5, sg = Math.floor(fract(u + hash2(rr, 3, 5)) * segs);
        const id = hash2(rr, sg, 67);
        const fz = nz(N, u, v, 128, 32);
        o.r = (0.55 + 0.45 * pick * bump) * (0.95 + 0.05 * fz) * (0.96 + 0.08 * hash2(rr, sg, 71));
        o.g = id < 0.14 ? 1 : 0;
        o.b = id > 0.86 ? 1 : 0;
        o.h = pick * bump + 0.06 * fz;
      } });
    }
    case 'braided': {
      // braided strands (chevrons) in bands; u runs along the braids
      const N = new TileableNoise(407);
      const bands = 4, period = 16;
      return genSet(`rug-braided@${res}`, { w: r2(256), h: r2(256), tile: [0.064, 0.064], normal: 2.6, data: true, res, pixel(u, v, o) {
        const gy = v * bands, band = Math.floor(gy), fy = fract(gy);
        const across = Math.abs(fy - 0.5) * 2;
        const phase = u * period + across * 1.3 * (band & 1 ? 1 : -1);
        const strand = 0.5 + 0.5 * Math.cos(Math.PI * 2 * phase);
        const hh = strand * Math.sin(Math.PI * fy) ** 0.5;
        const id = hash2(((band % bands) + bands) % bands, Math.floor(phase) & 15, 73);
        const fz = nz(N, u, v, 96);
        o.r = (0.5 + 0.5 * hh) * (0.95 + 0.05 * fz);
        o.g = id < 0.22 ? 1 : 0;
        o.b = id > 0.78 ? 1 : 0;
        o.h = hh + 0.05 * fz;
      } });
    }
    case 'shag': {
      // long pile: clumps ≈ 9 mm with strands laid in a random direction
      const N = new TileableNoise(409);
      const n = 18;
      return genSet(`rug-shag@${res}`, { w: r2(256), h: r2(256), tile: [0.16, 0.16], normal: 3.2, data: true, res, pixel(u, v, o) {
        cellNoise(u, v, n, n, 47, 0.9, C);
        const a = C.r2 * Math.PI * 2;
        const across = C.dx * Math.sin(a) - C.dy * Math.cos(a);
        const strands = 0.5 + 0.5 * Math.sin(across * 38 + nz(N, u, v, 24) * 3);
        const clump = clamp(1 - C.f1 / 0.85) ** 0.6;
        const fz = nz(N, u, v, 128);
        o.r = (0.42 + 0.58 * clump) * (0.85 + 0.15 * strands) * (0.95 + 0.05 * fz);
        o.g = C.r1 < 0.11 ? 1 : 0;
        o.b = C.r1 > 0.89 ? 1 : 0;
        o.h = clump * 0.8 + 0.25 * strands * clump + 0.05 * fz;
      } });
    }
    case 'cut-medium':
    case 'cut':
    default: {
      // cut pile: tufts (3–4.5 mm) with fine fibre noise
      const med = type === 'cut-medium';
      const N = new TileableNoise(med ? 411 : 413);
      const n = med ? 24 : 28;
      return genSet(`rug-${med ? 'cutm' : 'cut'}@${res}`, { w: r2(256), h: r2(256), tile: med ? [0.105, 0.105] : [0.085, 0.085], normal: med ? 2.6 : 2.2, data: true, res, pixel(u, v, o) {
        cellNoise(u, v, n, n, med ? 49 : 51, 0.9, C);
        const tuft = Math.sqrt(clamp(1 - (C.f1 / 0.8) ** 2));
        // twisted yarn: a short curl across each tuft (frisé look)
        const a = C.r2 * Math.PI;
        const curl = 0.5 + 0.5 * Math.sin((C.dx * Math.cos(a) + C.dy * Math.sin(a)) * 11 + C.r1 * 6);
        const fib = nz(N, u, v, n * 4) * 0.6 + nz(N, u, v, n * 2) * 0.4;
        o.r = (0.5 + 0.5 * tuft) * (0.88 + 0.12 * curl) * (0.94 + 0.06 * fib) * (0.94 + 0.12 * C.r2);
        o.g = C.r1 < 0.09 ? 1 : 0;
        o.b = C.r1 > 0.91 ? 1 : 0;
        o.h = tuft * (0.7 + 0.3 * C.r2) + 0.18 * curl * tuft + 0.12 * fib;
      } });
    }
  }
}

/** Surface type of a rug from its params. */
function rugSurface(P) {
  const pattern = P.pattern, weave = P.weave, pile = P.pile;
  if (pattern === 'pebble' || weave === 'felted') return 'pebble';
  if (pattern === 'wool-knotted') return weave === 'hand-tufted' ? 'loop' : 'knotted';
  if (weave === 'braided') return 'braided';
  if (pile === 'flat' || weave === 'flatweave') return 'flat';
  if (pile === 'high' || pile === 'shaggy') return 'shag';
  if (pile === 'medium') return 'cut-medium';
  return 'cut';
}

/** Fleck strength per pattern (how much the yarn's accent/accent2 flecks show). */
const FLECK = { melange: 0.75, pebble: 0.5, 'wool-knotted': 1, solid: 0.35, border: 0.35, stripes: 0.3, geometric: 0.12, abstract: 0.25 };

/**
 * Rug outline in the (x, z) plane, closed (no repeated last point).
 * @returns {THREE.Vector2[]} (x → .x, z → .y)
 */
function rugOutline(shape, w, d, seg, seed) {
  const pts = [];
  if (shape === 'round' || shape === 'oval') {
    const n = Math.max(48, Math.round(96 * seg));
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      pts.push(new THREE.Vector2((Math.cos(a) * w) / 2, (Math.sin(a) * d) / 2));
    }
    return pts;
  }
  if (shape === 'organic') {
    const r = K.rng(`organic${seed}`);
    const ph = [r() * 6.28, r() * 6.28, r() * 6.28, r() * 6.28];
    const n = Math.max(64, Math.round(120 * seg));
    const raw = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const k = 1 + 0.07 * Math.sin(2 * a + ph[0]) + 0.05 * Math.sin(3 * a + ph[1]) + 0.025 * Math.sin(5 * a + ph[2]) + 0.012 * Math.sin(7 * a + ph[3]);
      // superellipse base (a soft «pebble» rather than an ellipse)
      const c = Math.cos(a), s = Math.sin(a);
      const se = 1 / ((Math.abs(c) ** 2.6 + Math.abs(s) ** 2.6) ** (1 / 2.6));
      raw.push(new THREE.Vector2(c * se * k, s * se * k));
    }
    const box = new THREE.Box2().setFromPoints(raw);
    const cx = (box.min.x + box.max.x) / 2, cy = (box.min.y + box.max.y) / 2;
    const sx = w / (box.max.x - box.min.x), sy = d / (box.max.y - box.min.y);
    return raw.map((p) => new THREE.Vector2((p.x - cx) * sx, (p.y - cy) * sy));
  }
  // rectangle with slightly rounded corners
  const rc = Math.min(0.02, w / 6, d / 6);
  const cn = Math.max(3, Math.round(5 * seg));
  const corners = [[w / 2 - rc, d / 2 - rc, 0], [-w / 2 + rc, d / 2 - rc, Math.PI / 2], [-w / 2 + rc, -d / 2 + rc, Math.PI], [w / 2 - rc, -d / 2 + rc, Math.PI * 1.5]];
  for (const [cx, cy, a0] of corners) {
    for (let k = 0; k <= cn; k++) {
      const a = a0 + (k / cn) * (Math.PI / 2);
      pts.push(new THREE.Vector2(cx + rc * Math.cos(a), cy + rc * Math.sin(a)));
    }
  }
  return pts;
}

/**
 * Rug slab: top rings (scaled toward the centre), a rounded edge and the side down to the floor; no bottom.
 * UVs in metres: top planar (x, −z) or polar (braids running around), edge/side = arc length × profile length.
 */
function rugGeometry(outline, t, edgeR, { polar = false, tileU = 0.064 } = {}) {
  const n = outline.length;
  // outward normals (centroid test makes it independent of the winding)
  const cen = new THREE.Vector2();
  for (const p of outline) cen.add(p);
  cen.multiplyScalar(1 / n);
  const nrm = outline.map((p, i) => {
    const a = outline[(i - 1 + n) % n], b = outline[(i + 1) % n];
    const v = new THREE.Vector2(b.y - a.y, -(b.x - a.x)).normalize();
    if (v.dot(new THREE.Vector2().subVectors(p, cen)) < 0) v.negate();
    return v;
  });
  const cum = [0];
  for (let i = 1; i <= n; i++) cum.push(cum[i - 1] + outline[i % n].distanceTo(outline[i - 1]));
  const L = cum[n];
  const pos = [], nor = [], uv = [], idx = [];
  const v3 = new THREE.Vector3();
  const add = (x, y, z, nx, ny, nz, u, v) => {
    pos.push(x, y, z);
    nor.push(nx, ny, nz);
    uv.push(u, v);
    return pos.length / 3 - 1;
  };
  // triangle with the winding that matches the expected normal
  const tri = (a, b, c, ex, ey, ez) => {
    const ax = pos[a * 3], ay = pos[a * 3 + 1], az = pos[a * 3 + 2];
    const ux = pos[b * 3] - ax, uy = pos[b * 3 + 1] - ay, uz = pos[b * 3 + 2] - az;
    const wx = pos[c * 3] - ax, wy = pos[c * 3 + 1] - ay, wz = pos[c * 3 + 2] - az;
    v3.set(uy * wz - uz * wy, uz * wx - ux * wz, ux * wy - uy * wx);
    if (v3.x * ex + v3.y * ey + v3.z * ez >= 0) idx.push(a, b, c);
    else idx.push(a, c, b);
  };
  const inset = outline.map((p, i) => new THREE.Vector2(p.x - nrm[i].x * edgeR, p.y - nrm[i].y * edgeR));
  // top: rings scaled toward the centroid
  const scales = polar ? [1, 0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 0.2, 0.1] : [1, 0.86, 0.62, 0.36, 0.14];
  const rMean = L / (Math.PI * 2);
  const rings = scales.map((s) => {
    const ring = [];
    const reps = Math.max(1, Math.round((L * s) / tileU));
    for (let i = 0; i <= n; i++) {
      const p = inset[i % n];
      const x = cen.x + (p.x - cen.x) * s, z = cen.y + (p.y - cen.y) * s;
      const u = polar ? (cum[i] / L) * reps * tileU : x;
      const v = polar ? (1 - s) * rMean : -z;
      ring.push(add(x, t, z, 0, 1, 0, u, v));
    }
    return ring;
  });
  for (let k = 0; k < rings.length - 1; k++) {
    for (let i = 0; i < n; i++) {
      const a = rings[k][i], b = rings[k][i + 1], c = rings[k + 1][i], d = rings[k + 1][i + 1];
      tri(a, b, c, 0, 1, 0);
      tri(b, d, c, 0, 1, 0);
    }
  }
  const last = rings[rings.length - 1];
  for (let i = 0; i < n; i++) {
    const c = add(cen.x, t, cen.y, 0, 1, 0, polar ? (uv[last[i] * 2] + uv[last[i + 1] * 2]) / 2 : cen.x, polar ? rMean : -cen.y);
    tri(last[i], last[i + 1], c, 0, 1, 0);
  }
  // rounded edge + side
  const prof = [];
  const en = 4;
  for (let k = 0; k <= en; k++) {
    const f = (k / en) * (Math.PI / 2);
    prof.push({ o: edgeR * (1 - Math.sin(f)), y: t - edgeR * (1 - Math.cos(f)), ns: Math.sin(f), ny: Math.cos(f) });
  }
  prof.push({ o: 0, y: 0, ns: 1, ny: 0 });
  const profLen = [0];
  for (let k = 1; k < prof.length; k++) profLen.push(profLen[k - 1] + Math.hypot(prof[k].o - prof[k - 1].o, prof[k].y - prof[k - 1].y));
  const eRings = prof.map((pr, k) => {
    const ring = [];
    for (let i = 0; i <= n; i++) {
      const p = outline[i % n], nn = nrm[i % n];
      ring.push(add(p.x - nn.x * pr.o, pr.y, p.y - nn.y * pr.o, nn.x * pr.ns, pr.ny, nn.y * pr.ns, cum[i], -profLen[k]));
    }
    return ring;
  });
  for (let k = 0; k < eRings.length - 1; k++) {
    for (let i = 0; i < n; i++) {
      const nn = nrm[i];
      const pr = prof[k];
      const ex = nn.x * (pr.ns + 0.3), ey = pr.ny + 0.01, ez = nn.y * (pr.ns + 0.3);
      const a = eRings[k][i], b = eRings[k][i + 1], c = eRings[k + 1][i], d = eRings[k + 1][i + 1];
      tri(a, b, c, ex, ey, ez);
      tri(b, d, c, ex, ey, ez);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

// ---- rug pattern maps: RGBA = weights of accent, accent2, accent3 and the border (DataTexture, linear)

const _rugPatterns = new TexLRU(16);
const _flatPattern = (() => {
  let t = null;
  return () => {
    if (!t) {
      t = new THREE.DataTexture(new Uint8Array(4 * 4 * 4), 4, 4, THREE.RGBAFormat);
      t.needsUpdate = true;
      t.userData.shared = true;
    }
    return t;
  };
})();

/** Integer lattice hash → [0, 1). */
function ihash(a, b, seed) {
  let n = (Math.imul(a, 374761393) + Math.imul(b, 668265263) + Math.imul(seed, 1442695041)) | 0;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

/** Fast hash-based value noise (non-tiling), roughly [-1, 1]. */
function vnoise(x, y, seed) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const a = ihash(ix, iy, seed), b = ihash(ix + 1, iy, seed), c = ihash(ix, iy + 1, seed), d = ihash(ix + 1, iy + 1, seed);
  return (a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v) * 2 - 1;
}

/** Signed distance (m, positive inside) from (x, z) to the rug outline – exact for rect, approximate otherwise. */
function edgeDistance(shape, w, d, outlineR) {
  if (shape === 'rect' || !shape) return (x, z) => Math.min(w / 2 - Math.abs(x), d / 2 - Math.abs(z));
  if (shape === 'organic') {
    return (x, z) => {
      const a = Math.atan2(z, x);
      return outlineR(a) - Math.hypot(x, z);
    };
  }
  const a = w / 2, b = d / 2;
  return (x, z) => (1 - Math.hypot(x / a, z / b)) * Math.min(a, b);
}

/**
 * Pattern weights of a rug. Returns { tex, flat } – flat when the pattern has no regions (solid/melange/pebble …
 * without a border): then a 4×4 zero texture is shared.
 */
function rugPattern({ pattern, shape, w, d, seed, border, res, outlineR }) {
  const regions = ['border', 'stripes', 'geometric', 'abstract'].includes(pattern);
  if (!regions && !border) return { tex: _flatPattern(), flat: true };
  const key = `${pattern}|${shape}|${w.toFixed(3)}|${d.toFixed(3)}|${seed}|${border ? 1 : 0}|${res}`;
  return _rugPatterns.get(key, () => {
    // pinstripes (2 cm pitch) need ≥ 4 px per period; the other patterns have coarse features
    const pxm = (pattern === 'geometric' ? 400 : 240) * clamp(res, 0.5, 1.2);
    let W = Math.round(w * pxm), H = Math.round(d * pxm);
    const cap = 1024 / Math.max(W, H);
    if (cap < 1) {
      W = Math.round(W * cap);
      H = Math.round(H * cap);
    }
    W = Math.max(16, W);
    H = Math.max(16, H);
    const data = new Uint8Array(W * H * 4);
    const dist = edgeDistance(shape, w, d, outlineR);
    const fn = rugRegionFn(pattern, w, d, seed, dist);
    const bw = border ? Math.min(0.018, Math.min(w, d) * 0.02) : 0;
    const out = [0, 0, 0];
    for (let j = 0; j < H; j++) {
      const z = ((j + 0.5) / H) * d - d / 2;
      for (let i = 0; i < W; i++) {
        const x = ((i + 0.5) / W) * w - w / 2;
        // fuzzy boundaries: tufts do not follow vector lines
        const fx = x + 0.0045 * vnoise(x * 190, z * 190, 3);
        const fz = z + 0.0045 * vnoise(x * 190 + 40, z * 190, 7);
        out[0] = out[1] = out[2] = 0;
        if (fn) fn(fx, fz, out, x, z);
        const k = (j * W + i) * 4;
        data[k] = clamp(out[0]) * 255;
        data[k + 1] = clamp(out[1]) * 255;
        data[k + 2] = clamp(out[2]) * 255;
        if (bw) {
          const e = dist(fx, fz);
          data[k + 3] = (1 - smooth(bw * 0.75, bw * 1.25, e)) * 255;
        }
      }
    }
    const tex = new THREE.DataTexture(data, W, H, THREE.RGBAFormat);
    tex.colorSpace = THREE.NoColorSpace;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.anisotropy = 8;
    tex.needsUpdate = true;
    tex.userData.shared = true;
    return { tex, flat: false };
  });
}

/**
 * Region weights of a rug pattern at (x, z) metres (rug centred on the origin): out = [accent, accent2, accent3].
 * Later shapes paint over earlier ones (each assignment resets the others).
 */
function rugRegionFn(pattern, w, d, seed, dist) {
  const r = K.rng(`rugpat${pattern}${seed}`);
  const set = (out, a, b, c) => {
    out[0] = a;
    out[1] = b;
    out[2] = c;
  };
  const blend = (out, t, a, b, c) => {
    out[0] += (a - out[0]) * t;
    out[1] += (b - out[1]) * t;
    out[2] += (c - out[2]) * t;
  };
  if (pattern === 'border') {
    const inset = Math.min(0.12, Math.min(w, d) * 0.06), band = Math.min(0.05, Math.min(w, d) * 0.025);
    return (x, z, out) => {
      const e = dist(x, z);
      if (e < inset) set(out, 1, 0, 0);
      else if (e < inset + band * 0.35) set(out, 0, 0, 0);
      else if (e < inset + band) set(out, 0, 1, 0);
    };
  }
  if (pattern === 'stripes') {
    // bands across the long side, rhythm from the seed: wide base, narrow accent/accent2 pairs
    const along = d >= w ? 'z' : 'x';
    const len = Math.max(w, d);
    const bands = [];
    let p = -len / 2 + 0.06 + r() * 0.08;
    while (p < len / 2) {
      const gap = 0.16 + r() * 0.22;
      const k = r() < 0.5 ? 0 : 1;
      bands.push([p, p + 0.012 + r() * 0.03, k]);
      if (r() < 0.6) bands.push([p + 0.045, p + 0.052 + r() * 0.012, 1 - k]);
      p += gap;
    }
    return (x, z, out) => {
      const s = along === 'z' ? z : x;
      for (const [a, b, k] of bands) if (s >= a && s < b) set(out, k === 0 ? 1 : 0, k === 1 ? 1 : 0, 0);
    };
  }
  if (pattern === 'abstract') {
    const ox = r() * 50, oz = r() * 50;
    return (x, z, out) => {
      const n = vnoise(x * 1.6 + ox, z * 1.6 + oz, 13) * 0.65 + vnoise(x * 3.7 + oz, z * 3.7 + ox, 17) * 0.35;
      const m = vnoise(x * 2.3 + 11, z * 2.3 + ox, 19);
      if (n > 0.28) set(out, smooth(0.28, 0.33, n), 0, 0);
      else if (m < -0.42) set(out, 0, smooth(-0.42, -0.47, m), 0);
      // thin contour lines in accent3
      const line = 1 - smooth(0.0, 0.012, Math.abs(n - 0.05));
      if (line > 0) blend(out, line, 0, 0, 1);
    };
  }
  if (pattern === 'geometric') {
    // The TV-stue rug, traced from photos 082726 / 082736 / 082806 rectified onto the rug plane: a light cool-grey
    // field (base) with two large charcoal lenses («halvmåner»), a dark band of fine off-white pinstripes along one
    // long edge, a narrow band of charcoal pinstripes, a mid-grey L-shaped block and a mid-grey wedge (accent2), an
    // off-white block (accent3), a carved light block with faint ribs and a narrow off-white binding. Reference
    // layout in metres on the real 2.3 × 1.6 m rug, u along the long side, v across it (u = 0 / v = 0 is the −x / −z
    // corner of a landscape rug); other sizes stretch the layout, stripes keep their 2 cm pitch. seed 2–4 mirror it.
    const landscape = w >= d;
    const LU = landscape ? w : d, LV = landscape ? d : w;
    const su = LU / 2.3, sv = LV / 1.6;
    const variant = (((Math.round(Number(seed) || 1) - 1) % 4) + 4) % 4;
    const flipU = (variant & 1) === 1, flipV = (variant & 2) === 2;
    const inRect = (U, V, u0, u1, v0, v1) => U >= u0 && U < u1 && V >= v0 && V < v1;
    const inDisc = (U, V, cu, cv, r) => (U - cu) * (U - cu) + (V - cv) * (V - cv) < r * r;
    // lenses = intersections of two discs (tips at (0.35, 0.44)–(0.92, 1.50) and (1.36, 1.29)–(1.94, 0.79))
    const lens = (U, V) =>
      (inDisc(U, V, 0.72, 0.92, 0.61) && inDisc(U, V, -0.4, 1.53, 1.32)) ||
      (inDisc(U, V, 1.607, 0.992, 0.389) && inDisc(U, V, 2.138, 1.603, 0.838));
    const PITCH = 0.02;
    /** 1 on a stripe that covers `duty` of each 2 cm pitch (≈ 1 texel soft edges), 0 between. */
    const stripe = (s, duty) => {
      const ph = fract(s / PITCH);
      return smooth(0, 0.1, ph) * (1 - smooth(duty, duty + 0.1, ph));
    };
    const BIND = 0.009;
    return (x, z, out, x0 = x, z0 = z) => {
      let U = ((landscape ? x : z) + LU / 2) / su, V = ((landscape ? z : -x) + LV / 2) / sv;
      if (flipU) U = 2.3 - U;
      if (flipV) V = 1.6 - V;
      // stripes follow the weave rows (unjittered position, metres), with a slight hand-tufted wobble
      const ua = (landscape ? x0 : z0) + LU / 2, va = (landscape ? z0 : -x0) + LV / 2;
      const s = ua + 0.0012 * vnoise(ua * 40, va * 9, 23);
      // carved light block: faint ribs
      if (inRect(U, V, 0.62, 1.4, 0.45, 1.22)) set(out, 0, 0.22 * stripe(s, 0.45), 0);
      // mid-grey wedge (its slanted edge meets the narrow pinstripe band)
      const slant = 1.18 + 0.42 * V;
      if (U >= 0.85 && U < slant && V < 0.44) set(out, 0, 1, 0);
      // narrow band: charcoal pinstripes on the light field
      if (V >= 0.1 && V < 0.85 && U < 1.48 && U >= (V < 0.44 ? slant : 1.37)) set(out, stripe(s, 0.5), 0, 0);
      // wide band along the long edge: charcoal with off-white pinstripes
      if (U < 1.05 && V >= 1.235) {
        const t = stripe(s, 0.34);
        set(out, 1 - t, 0, t);
      }
      if (inRect(U, V, 1.05, 1.38, 1.22, 1.61)) set(out, 0, 0, 1); // off-white block
      if (inRect(U, V, 1.38, 2.31, 1.3, 1.61) || inRect(U, V, 1.97, 2.31, 0.83, 1.61)) set(out, 0, 1, 0); // mid-grey L
      if (lens(U, V)) set(out, 1, 0, 0);
      // narrow off-white binding all round
      if (dist(x0, z0) < BIND) set(out, 0, 0, 1);
    };
  }
  return null;
}

/** Shader chunks for rugs (shared program; per-rug uniforms). */
function rugShader(m, U) {
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform vec2 rugDetRep;\nvarying vec3 vRugPos;\nvarying vec2 vRugUv;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\n\tvRugPos = position;\n\tvRugUv = uv * rugDetRep;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
uniform sampler2D rugPattern;
uniform sampler2D rugDetail;
uniform vec4 rugRect;
uniform vec3 rugBase;
uniform vec3 rugAcc;
uniform vec3 rugAcc2;
uniform vec3 rugAcc3;
uniform vec3 rugBorder;
uniform float rugFleck;
uniform float rugShade;
varying vec3 vRugPos;
varying vec2 vRugUv;
float rugHash( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }
float rugNoise( vec2 p ) {
	vec2 i = floor( p ), f = fract( p );
	f = f * f * ( 3.0 - 2.0 * f );
	return mix( mix( rugHash( i ), rugHash( i + vec2( 1.0, 0.0 ) ), f.x ), mix( rugHash( i + vec2( 0.0, 1.0 ) ), rugHash( i + vec2( 1.0, 1.0 ) ), f.x ), f.y );
}`)
      .replace('#include <map_fragment>', `#include <map_fragment>
	vec4 rw = texture2D( rugPattern, ( vRugPos.xz - rugRect.xy ) * rugRect.zw );
	vec3 rc = rugBase * max( 0.0, 1.0 - rw.r - rw.g - rw.b ) + rugAcc * rw.r + rugAcc2 * rw.g + rugAcc3 * rw.b;
	rc = mix( rc, rugBorder, rw.a );
	vec4 rd = texture2D( rugDetail, vRugUv );
	rc = mix( rc, rugAcc, rd.g * rugFleck * ( 1.0 - rw.a ) );
	rc = mix( rc, rugAcc2, rd.b * rugFleck * ( 1.0 - rw.a ) );
	float rugMot = ( rugNoise( vRugPos.xz * 2.3 ) - 0.5 ) * 0.07 + ( rugNoise( vRugPos.xz * 6.1 + 3.7 ) - 0.5 ) * 0.035;
	diffuseColor.rgb *= rc * ( rd.r * rugShade ) * ( 1.0 + rugMot );`)
      // the pile's sheen follows the yarn under it (as before for mid/light yarn: colour lifted 35 % toward white),
      // but fades on dark yarn – a base-coloured sheen over the charcoal regions washed them out to mid-grey at
      // grazing angles (material.sheenColor = white × sheen; rc = pattern colour, linear)
      .replace('#include <lights_physical_fragment>', `#include <lights_physical_fragment>
	#ifdef USE_SHEEN
	material.sheenColor *= mix( rc, vec3( 1.0 ), 0.35 ) * max( 0.12, smoothstep( 0.0, 0.25, dot( rc, vec3( 0.2126, 0.7152, 0.0722 ) ) ) );
	#endif`);
  };
  m.customProgramCacheKey = () => 'textile-rug-2';
}

function buildRug(spec) {
  const { dims, params: P, colors: C, materials: M } = spec;
  const q = spec.quality || 'medium';
  const seg = SEG_OF[q] ?? 1, res = RES_OF[q] ?? 1;
  const shape = ['rect', 'round', 'oval', 'organic'].includes(P.shape) ? P.shape : 'rect';
  const w = Math.max(0.2, dims.w), d = Math.max(0.2, dims.d);
  const t = clamp(dims.h, 0.003, 0.06);
  const pile = PILE[P.pile] ? P.pile : 'low';
  const pattern = P.pattern || 'melange';
  const seed = P.seed ?? 1;
  const surf = rugSurface({ ...P, pile, pattern });
  const det = rugDetail(surf, Math.min(res, 1.5));
  const outline = rugOutline(shape, w, d, seg, seed);
  // polar radius lookup for the organic edge distance
  const outlineR = (() => {
    const n = outline.length;
    const ang = outline.map((p) => Math.atan2(p.y, p.x));
    const rad = outline.map((p) => Math.hypot(p.x, p.y));
    return (a) => {
      let best = 0, bd = 9;
      for (let i = 0; i < n; i++) {
        let dd = Math.abs(ang[i] - a);
        if (dd > Math.PI) dd = Math.PI * 2 - dd;
        if (dd < bd) {
          bd = dd;
          best = i;
        }
      }
      return rad[best];
    };
  })();
  const pat = rugPattern({ pattern, shape, w, d, seed, border: !!P.border, res, outlineR });
  const base = hexOf(C.base, '#9c9ea2');
  const acc = hexOf(C.accent, shadeHex(base, 0.78));
  const acc2 = hexOf(C.accent2, shadeHex(base, 1.15));
  const acc3 = hexOf(P.accent3Color, shadeHex(base, 1.12));
  const borderHex = hexOf(P.borderColor, '#ece9e2');
  const kind = M.base && FABRIC_KINDS.has(M.base) ? M.base : 'wool';
  const physical = mat('wool', '#808080').isMeshPhysicalMaterial;
  const pl = PILE[pile];
  const sheenCol = new THREE.Color(1, 1, 1); // tinted per fragment by the pattern colour (rugShader)
  const params = {
    color: new THREE.Color(1, 1, 1),
    roughness: kind === 'cotton' || surf === 'flat' ? 0.92 : 0.98,
    metalness: 0,
    normalMap: det.normalMap,
    normalScale: new THREE.Vector2(pl.ns, pl.ns),
  };
  const m = physical
    ? new THREE.MeshPhysicalMaterial({ ...params, sheen: surf === 'flat' ? 0.25 : pl.sheen, sheenRoughness: 0.8, sheenColor: sheenCol })
    : new THREE.MeshStandardMaterial(params);
  const U = {
    rugPattern: { value: pat.tex },
    rugDetail: { value: det.map },
    rugDetRep: { value: new THREE.Vector2(1 / det.tile[0], 1 / det.tile[1]) },
    rugRect: { value: new THREE.Vector4(-w / 2, -d / 2, 1 / w, 1 / d) },
    rugBase: { value: linColor(base) },
    rugAcc: { value: linColor(acc) },
    rugAcc2: { value: linColor(acc2) },
    rugAcc3: { value: linColor(acc3) },
    rugBorder: { value: linColor(borderHex) },
    rugFleck: { value: FLECK[pattern] ?? 0.4 },
    rugShade: { value: 1 / det.ref },
  };
  rugShader(m, U);
  m.name = `rug ${pattern} ${base}`;
  m.userData = { kind, hex: base, rug: true };
  const edgeR = clamp(t * pl.edge, 0.0015, Math.min(0.02, t * 0.9));
  const polar = surf === 'braided' && shape !== 'rect';
  const geo = rugGeometry(outline, t, edgeR, { polar, tileU: det.tile[0] });
  const g = new THREE.Group();
  const mesh = K.partMesh(geo, m, 'base');
  g.add(mesh);
  if (P.fringe && shape === 'rect') {
    const fringeHex = M.accent2 === 'cotton' ? acc2 : shadeHex(base, 1.25);
    const along = d >= w ? 'x' : 'z';
    const span = along === 'x' ? w : d;
    const n = Math.max(12, Math.round((span / 0.04) * seg));
    for (const s of [-1, 1]) {
      const pts = [], dirs = [];
      for (let k = 0; k <= n; k++) {
        const f = -0.5 + k / n;
        if (along === 'x') {
          pts.push(new THREE.Vector3(f * (span - 0.03), 0.0018, s * (d / 2 - 0.004)));
          dirs.push(new THREE.Vector3(0, 0, s));
        } else {
          pts.push(new THREE.Vector3(s * (w / 2 - 0.004), 0.0018, f * (span - 0.03)));
          dirs.push(new THREE.Vector3(s, 0, 0));
        }
      }
      const fg = fringeGeometry(pts, dirs, P.fringeLength ?? 0.07, { floorY: 0.0018, seed: `rug${s}${w}${d}` });
      g.add(fringeMesh(fg, fringeHex, res, 'accent2'));
    }
  }
  const recolor = (part, hex, kindNew) => {
    if (part === 'base' && kindNew && kindNew !== kind) return false;
    const h = hexOf(hex);
    if (part === 'base') {
      U.rugBase.value.copy(linColor(h));
      return true;
    }
    if (part === 'accent') {
      U.rugAcc.value.copy(linColor(h));
      return true;
    }
    if (part === 'accent2') {
      if (P.fringe) return false; // fringe colour follows accent2 → rebuild
      U.rugAcc2.value.copy(linColor(h));
      return true;
    }
    return false;
  };
  return K.finishModel(g, { recolor, merge: false });
}

// ---------------------------------------------------------------------------------------------------------------
// Archetype definitions

const NUM = (min, max, step, label, unit = '') => ({ type: 'number', min, max, step, label, unit });
const ENUM = (options, label, def) => ({ type: 'enum', options, label, default: def });
const BOOL = (label, def = false) => ({ type: 'bool', label, default: def });
const COLOR = (label) => ({ type: 'color', label, palette: 'materials' });

const TEXTURE_OPTIONS = [
  ['boucle', 'Bouclé'], ['velvet', 'Fløyel'], ['velour', 'Velur'], ['knit', 'Strikk'], ['linen', 'Lin'], ['teddy', 'Teddy'],
  ['woven', 'Vevd'], ['wool', 'Ull'], ['cotton', 'Bomull'], ['leather', 'Skinn'], ['bobble', 'Popcorn (dusker)'],
];
const FABRIC_PATTERNS = [
  ['solid', 'Ensfarget'], ['check', 'Ruter'], ['houndstooth', 'Hanefot'], ['herringbone', 'Fiskebein'], ['zigzag', 'Sikksakk'],
  ['stripes', 'Striper'], ['waffle', 'Vaffel'],
];

/** Def from the shared schema (label, mount, parts, partLabels) + defaults, params, dimsRange and the builder. */
function def(id, { defaults, params, dimsRange, parts: extraParts = [], build }) {
  const a = schema.archetypes[id];
  const fam = schema.families[a.family];
  const parts = [...(a.parts || fam.parts), ...extraParts.filter((p) => !(a.parts || fam.parts).includes(p))];
  return {
    label: a.label,
    mount: a.mount,
    parts,
    partLabels: Object.fromEntries(parts.map((p) => [p, fam.partLabels[p] || p])),
    defaults: { params: {}, ...defaults },
    params,
    dimsRange,
    build,
  };
}

const fab = (hex, kind) => ({ colors: { fabric: hex, piping: hex }, materials: { fabric: kind, piping: kind } });

export const archetypes = {
  cushion: def('cushion', {
    defaults: { dims: { w: 0.5, d: 0.15, h: 0.5 }, params: { shape: 'square', lean: 70, texture: 'boucle', pattern: 'solid', flange: 0, piping: false }, ...fab('#cfc6b8', 'boucle') },
    params: {
      shape: ENUM([['square', 'Kvadratisk'], ['lumbar', 'Avlang (ryggpute)'], ['round', 'Rund'], ['bolster', 'Pølsepute']], 'Form', 'square'),
      texture: ENUM(TEXTURE_OPTIONS, 'Overflate', 'boucle'),
      pattern: ENUM(FABRIC_PATTERNS, 'Mønster', 'solid'),
      patternColor: COLOR('Mønsterfarge'),
      lean: NUM(0, 90, 5, 'Helning (°, 90 = står rett opp)'),
      flange: NUM(0, 0.04, 0.005, 'Flens/ramme', ' m'),
      piping: BOOL('Kantbånd (piping)'),
    },
    dimsRange: { w: [0.25, 1.0], d: [0.06, 0.3], h: [0.2, 0.8] },
    build: buildCushion,
  }),
  throw: def('throw', {
    defaults: { dims: { w: 1.3, d: 1.7, h: 0.008 }, params: { texture: 'wool', pattern: 'solid', fringe: false, armH: 0.15, armW: 0.22, hang: 0.32, backH: 0.4, backT: 0.2 }, ...fab('#a7b89c', 'wool') },
    params: {
      drape: ENUM([['folded', 'Brettet'], ['over-arm', 'Over armlenet'], ['over-back', 'Over ryggen'], ['flat', 'Utbredt']], 'Plassering', 'folded'),
      texture: ENUM(TEXTURE_OPTIONS, 'Overflate', 'wool'),
      pattern: ENUM(FABRIC_PATTERNS, 'Mønster', 'solid'),
      patternColor: COLOR('Mønsterfarge'),
      fringe: BOOL('Frynser'),
      fringeColor: COLOR('Frynsefarge'),
      armH: NUM(0.05, 0.6, 0.01, 'Armlenets høyde over setet', ' m'),
      armW: NUM(0.06, 0.4, 0.01, 'Armlenets bredde', ' m'),
      backH: NUM(0.15, 0.8, 0.01, 'Ryggens høyde over setet', ' m'),
      backT: NUM(0.06, 0.4, 0.01, 'Ryggens tykkelse', ' m'),
      hang: NUM(0.05, 0.9, 0.01, 'Henger ned', ' m'),
    },
    dimsRange: { w: [0.3, 2.6], d: [0.3, 2.8], h: [0.003, 0.08] },
    build: buildThrow,
  }),
  pouf: def('pouf', {
    parts: ['legs'],
    defaults: {
      dims: { w: 0.55, d: 0.55, h: 0.38 },
      params: { shape: 'round', texture: 'teddy', legs: 'none', legHeight: 0.1, stitchedLines: false, storage: false, piping: false },
      colors: { fabric: '#ece7dd', piping: '#ece7dd', legs: '#c9a978' },
      materials: { fabric: 'teddy', piping: 'teddy', legs: 'oak' },
    },
    params: {
      shape: ENUM([['round', 'Rund'], ['cylinder', 'Sylinder'], ['square', 'Firkantet']], 'Form', 'round'),
      texture: ENUM(TEXTURE_OPTIONS, 'Overflate', 'teddy'),
      legs: ENUM([['none', 'Ingen ben'], ['wood', 'Treben'], ['plinth', 'Sokkel']], 'Understell', 'none'),
      legHeight: NUM(0.01, 0.2, 0.01, 'Benhøyde', ' m'),
      stitchedLines: BOOL('Stikninger (kanaler)'),
      storage: BOOL('Oppbevaring (lokk)'),
      piping: BOOL('Kantbånd (piping)'),
    },
    dimsRange: { w: [0.3, 1.0], d: [0.3, 1.0], h: [0.2, 0.6] },
    build: buildPouf,
  }),
  rug: def('rug', {
    defaults: {
      dims: { w: 2.0, d: 3.0, h: 0.015 },
      params: { shape: 'rect', pile: 'low', pattern: 'melange', weave: 'hand-tufted', fringe: false, border: false, seed: 1 },
      colors: { base: '#9c9ea2', accent: '#6f7077', accent2: '#d8d8d8' },
      materials: { base: 'wool', accent: 'wool', accent2: 'wool' },
    },
    params: {
      shape: ENUM([['rect', 'Rektangulært'], ['round', 'Rundt'], ['oval', 'Ovalt'], ['organic', 'Organisk']], 'Form', 'rect'),
      pile: ENUM([['flat', 'Flatvevd'], ['low', 'Lav luv'], ['medium', 'Middels luv'], ['high', 'Høy luv'], ['shaggy', 'Shaggy (lang luv)']], 'Luv', 'low'),
      pattern: ENUM([['solid', 'Ensfarget'], ['melange', 'Melert'], ['border', 'Bord/ramme'], ['stripes', 'Striper'], ['geometric', 'Geometrisk'], ['abstract', 'Abstrakt'], ['wool-knotted', 'Knyttet ull (berber)'], ['pebble', 'Filtede ullkuler']], 'Mønster', 'melange'),
      weave: ENUM([['hand-tufted', 'Håndtuftet'], ['handwoven', 'Håndvevd'], ['machine-woven', 'Maskinvevd'], ['flatweave', 'Flatvev'], ['braided', 'Flettet'], ['felted', 'Filtet']], 'Teknikk', 'hand-tufted'),
      fringe: BOOL('Frynser'),
      border: BOOL('Kantbånd'),
      borderColor: COLOR('Kantfarge'),
      seed: NUM(1, 20, 1, 'Variant av mønsteret'),
    },
    dimsRange: { w: [0.6, 4], d: [0.6, 5], h: [0.004, 0.04] },
    build: buildRug,
  }),
};
