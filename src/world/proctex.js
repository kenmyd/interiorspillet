import * as THREE from 'three';

/**
 * Procedural texture & noise toolkit shared by all world builders.
 * Everything is generated at load time on <canvas> – the game ships no texture files.
 */

/* ------------------------------------------------------------------ random */

/** Deterministic PRNG. Returns a function producing floats in [0,1). */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Cheap integer hash → [0,1). Handy for per-cell randomness without state. */
export function hash2(x, y, seed = 0) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed | 0, 2147483647)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};

/* ------------------------------------------------------------------ simplex noise (non-tiling) */

const F2 = 0.5 * (Math.sqrt(3) - 1);
const G2 = (3 - Math.sqrt(3)) / 6;
const F3 = 1 / 3;
const G3 = 1 / 6;
const GRAD3 = new Float32Array([
  1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1, 0, 1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, -1, 0, 1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1,
]);

function buildPerm(seed) {
  const rnd = mulberry32(seed);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const t = p[i];
    p[i] = p[j];
    p[j] = t;
  }
  const perm = new Uint8Array(512);
  const permMod12 = new Uint8Array(512);
  for (let i = 0; i < 512; i++) {
    perm[i] = p[i & 255];
    permMod12[i] = perm[i] % 12;
  }
  return { perm, permMod12 };
}

/** 2D simplex noise, output roughly in [-1, 1]. */
export function createNoise2D(seed = 1) {
  const { perm, permMod12 } = buildPerm(seed);
  return function noise2D(x, y) {
    let n0 = 0, n1 = 0, n2 = 0;
    const s = (x + y) * F2;
    const i = Math.floor(x + s);
    const j = Math.floor(y + s);
    const t = (i + j) * G2;
    const x0 = x - (i - t);
    const y0 = y - (j - t);
    const i1 = x0 > y0 ? 1 : 0;
    const j1 = x0 > y0 ? 0 : 1;
    const x1 = x0 - i1 + G2, y1 = y0 - j1 + G2;
    const x2 = x0 - 1 + 2 * G2, y2 = y0 - 1 + 2 * G2;
    const ii = i & 255, jj = j & 255;
    let t0 = 0.5 - x0 * x0 - y0 * y0;
    if (t0 >= 0) {
      const gi = permMod12[ii + perm[jj]] * 3;
      t0 *= t0;
      n0 = t0 * t0 * (GRAD3[gi] * x0 + GRAD3[gi + 1] * y0);
    }
    let t1 = 0.5 - x1 * x1 - y1 * y1;
    if (t1 >= 0) {
      const gi = permMod12[ii + i1 + perm[jj + j1]] * 3;
      t1 *= t1;
      n1 = t1 * t1 * (GRAD3[gi] * x1 + GRAD3[gi + 1] * y1);
    }
    let t2 = 0.5 - x2 * x2 - y2 * y2;
    if (t2 >= 0) {
      const gi = permMod12[ii + 1 + perm[jj + 1]] * 3;
      t2 *= t2;
      n2 = t2 * t2 * (GRAD3[gi] * x2 + GRAD3[gi + 1] * y2);
    }
    return 70 * (n0 + n1 + n2);
  };
}

/** 3D simplex noise, output roughly in [-1, 1]. */
export function createNoise3D(seed = 1) {
  const { perm, permMod12 } = buildPerm(seed);
  return function noise3D(x, y, z) {
    let n0, n1, n2, n3;
    const s = (x + y + z) * F3;
    const i = Math.floor(x + s), j = Math.floor(y + s), k = Math.floor(z + s);
    const t = (i + j + k) * G3;
    const x0 = x - (i - t), y0 = y - (j - t), z0 = z - (k - t);
    let i1, j1, k1, i2, j2, k2;
    if (x0 >= y0) {
      if (y0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
      else if (x0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 0; k2 = 1; }
      else { i1 = 0; j1 = 0; k1 = 1; i2 = 1; j2 = 0; k2 = 1; }
    } else {
      if (y0 < z0) { i1 = 0; j1 = 0; k1 = 1; i2 = 0; j2 = 1; k2 = 1; }
      else if (x0 < z0) { i1 = 0; j1 = 1; k1 = 0; i2 = 0; j2 = 1; k2 = 1; }
      else { i1 = 0; j1 = 1; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
    }
    const x1 = x0 - i1 + G3, y1 = y0 - j1 + G3, z1 = z0 - k1 + G3;
    const x2 = x0 - i2 + 2 * G3, y2 = y0 - j2 + 2 * G3, z2 = z0 - k2 + 2 * G3;
    const x3 = x0 - 1 + 3 * G3, y3 = y0 - 1 + 3 * G3, z3 = z0 - 1 + 3 * G3;
    const ii = i & 255, jj = j & 255, kk = k & 255;
    let t0 = 0.6 - x0 * x0 - y0 * y0 - z0 * z0;
    if (t0 < 0) n0 = 0;
    else {
      const gi = permMod12[ii + perm[jj + perm[kk]]] * 3;
      t0 *= t0;
      n0 = t0 * t0 * (GRAD3[gi] * x0 + GRAD3[gi + 1] * y0 + GRAD3[gi + 2] * z0);
    }
    let t1 = 0.6 - x1 * x1 - y1 * y1 - z1 * z1;
    if (t1 < 0) n1 = 0;
    else {
      const gi = permMod12[ii + i1 + perm[jj + j1 + perm[kk + k1]]] * 3;
      t1 *= t1;
      n1 = t1 * t1 * (GRAD3[gi] * x1 + GRAD3[gi + 1] * y1 + GRAD3[gi + 2] * z1);
    }
    let t2 = 0.6 - x2 * x2 - y2 * y2 - z2 * z2;
    if (t2 < 0) n2 = 0;
    else {
      const gi = permMod12[ii + i2 + perm[jj + j2 + perm[kk + k2]]] * 3;
      t2 *= t2;
      n2 = t2 * t2 * (GRAD3[gi] * x2 + GRAD3[gi + 1] * y2 + GRAD3[gi + 2] * z2);
    }
    let t3 = 0.6 - x3 * x3 - y3 * y3 - z3 * z3;
    if (t3 < 0) n3 = 0;
    else {
      const gi = permMod12[ii + 1 + perm[jj + 1 + perm[kk + 1]]] * 3;
      t3 *= t3;
      n3 = t3 * t3 * (GRAD3[gi] * x3 + GRAD3[gi + 1] * y3 + GRAD3[gi + 2] * z3);
    }
    return 32 * (n0 + n1 + n2 + n3);
  };
}

/** Fractal sum of a 2D noise function. */
export function fbm2D(noise2D, x, y, octaves = 5, lacunarity = 2, gain = 0.5) {
  let sum = 0, amp = 1, freq = 1, norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * noise2D(x * freq, y * freq);
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum / norm;
}

/** Ridged multifractal (sharp crests), output in [0,1]. */
export function ridged2D(noise2D, x, y, octaves = 5, lacunarity = 2, gain = 0.5) {
  let sum = 0, amp = 1, freq = 1, norm = 0;
  for (let i = 0; i < octaves; i++) {
    const n = 1 - Math.abs(noise2D(x * freq, y * freq));
    sum += amp * n * n;
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum / norm;
}

/* ------------------------------------------------------------------ tileable noise (for textures) */

/**
 * Tileable 2D gradient noise. Coordinates are in lattice cells; the pattern repeats every `period` cells.
 * Use fbm() with integer lacunarity to keep tiling across octaves.
 */
export class TileableNoise {
  constructor(seed = 1) {
    const rnd = mulberry32(seed);
    this.gx = new Float32Array(256);
    this.gy = new Float32Array(256);
    for (let i = 0; i < 256; i++) {
      const a = rnd() * Math.PI * 2;
      this.gx[i] = Math.cos(a);
      this.gy[i] = Math.sin(a);
    }
    this.perm = buildPerm(seed ^ 0x9e3779b9).perm;
  }

  _grad(ix, iy, px, py, dx, dy) {
    const h = this.perm[(this.perm[((ix % px) + px) % px & 255] + (((iy % py) + py) % py)) & 255];
    return this.gx[h] * dx + this.gy[h] * dy;
  }

  /** Noise in roughly [-1,1]; repeats every periodX × periodY cells. */
  noise(x, y, periodX, periodY = periodX) {
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const fx = x - x0, fy = y - y0;
    const u = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
    const v = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
    const n00 = this._grad(x0, y0, periodX, periodY, fx, fy);
    const n10 = this._grad(x0 + 1, y0, periodX, periodY, fx - 1, fy);
    const n01 = this._grad(x0, y0 + 1, periodX, periodY, fx, fy - 1);
    const n11 = this._grad(x0 + 1, y0 + 1, periodX, periodY, fx - 1, fy - 1);
    const nx0 = n00 + u * (n10 - n00);
    const nx1 = n01 + u * (n11 - n01);
    return (nx0 + v * (nx1 - nx0)) * 1.41;
  }

  /**
   * Fractal tileable noise sampled at normalized texture coords (u,v ∈ [0,1)).
   * baseFreq = number of lattice cells across the texture for the first octave (integer!).
   */
  fbm(u, v, baseFreq = 4, octaves = 4, gain = 0.5, lacunarity = 2) {
    let sum = 0, amp = 1, norm = 0, f = baseFreq;
    for (let i = 0; i < octaves; i++) {
      sum += amp * this.noise(u * f, v * f, f, f);
      norm += amp;
      amp *= gain;
      f *= lacunarity;
    }
    return sum / norm;
  }
}

/* ------------------------------------------------------------------ canvas helpers */

export function createCanvas(w, h = w) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/**
 * Fill every pixel with fn(x, y, u, v, out) where out is a 4-element array [r,g,b,a] (0..255) to write into.
 * Returns the canvas.
 */
export function fillPixels(canvas, fn) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const { width: w, height: h } = canvas;
  const img = ctx.createImageData(w, h);
  const d = img.data;
  const out = [0, 0, 0, 255];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      out[3] = 255;
      fn(x, y, x / w, y / h, out);
      const i = (y * w + x) * 4;
      d[i] = out[0];
      d[i + 1] = out[1];
      d[i + 2] = out[2];
      d[i + 3] = out[3];
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

let _maxAniso = 8;
/** Called once by the renderer owner so textures can use the GPU's max anisotropy. */
export function setMaxAnisotropy(v) {
  _maxAniso = Math.max(1, v | 0);
}

/**
 * Wrap a canvas in a texture.
 * @param {HTMLCanvasElement} canvas
 * @param {{repeat?:[number,number], srgb?:boolean, anisotropy?:number, wrap?:boolean, flipY?:boolean}} opts
 *   srgb: true for colour maps, false for data maps (normal/roughness/AO).
 */
export function canvasTexture(canvas, { repeat = [1, 1], srgb = true, anisotropy = 8, wrap = true, flipY = true } = {}) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  if (wrap) {
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
  }
  tex.repeat.set(repeat[0], repeat[1]);
  tex.anisotropy = Math.min(anisotropy, _maxAniso);
  tex.flipY = flipY;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Turn a height field (Float32Array, w*h, values ~0..1) into a tangent-space normal map canvas.
 * Sampling wraps around the edges so tileable heights give tileable normals.
 */
export function heightToNormalCanvas(heights, w, h, strength = 2) {
  const canvas = createCanvas(w, h);
  const H = (x, y) => heights[((y + h) % h) * w + ((x + w) % w)];
  fillPixels(canvas, (x, y, u, v, out) => {
    const dx = (H(x + 1, y) - H(x - 1, y)) * strength;
    const dy = (H(x, y + 1) - H(x, y - 1)) * strength;
    let nx = -dx, ny = dy, nz = 1; // canvas y goes down; OpenGL normal maps expect +y up
    const len = Math.hypot(nx, ny, nz);
    nx /= len; ny /= len; nz /= len;
    out[0] = (nx * 0.5 + 0.5) * 255;
    out[1] = (ny * 0.5 + 0.5) * 255;
    out[2] = (nz * 0.5 + 0.5) * 255;
  });
  return canvas;
}

/** Build a Float32 height array by evaluating fn(u,v) on a w×h grid. */
export function makeHeights(w, h, fn) {
  const a = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) a[y * w + x] = fn(x / w, y / h, x, y);
  return a;
}

/** Draw text on a canvas (for signs). Returns the canvas. */
export function textCanvas(w, h, draw) {
  const c = createCanvas(w, h);
  const ctx = c.getContext('2d');
  draw(ctx, w, h);
  return c;
}

/* ------------------------------------------------------------------ caching */

const _cache = new Map();

/** Memoize expensive generated assets (textures, materials, geometries) by key for the page lifetime. */
export function cached(key, factory) {
  if (!_cache.has(key)) _cache.set(key, factory());
  return _cache.get(key);
}

export function clearCache() {
  for (const v of _cache.values()) v?.dispose?.();
  _cache.clear();
}

/** Parse '#rrggbb' to [r,g,b] 0..255. */
export function hexToRgb(hex) {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
