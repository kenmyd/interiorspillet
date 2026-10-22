import * as THREE from 'three';
import {
  TileableNoise, createCanvas, canvasTexture, heightToNormalCanvas, cached, mulberry32, hash2, clamp, smoothstep, hexToRgb,
} from './proctex.js';

/**
 * Procedural, tileable surface texture sets for architecture (copied unchanged from Kraftverkspillet).
 *
 * Every generator returns { map, normalMap?, roughnessMap?, tile: [w, h] } where `tile` is the size in metres one
 * texture repeat covers. The textures already have repeat = 1 / tile, so they work directly on geometry with UVs in
 * metres (see buildKit.js). Results are memoized per parameter set (proctex.cached), so materials can share them.
 *
 * `res` (0.5 / 1 / 1.5) scales the canvas resolution – pass a lower value on low quality.
 */

/**
 * Shared generator: evaluates `pixel(x, y, u, v, out)` once per texel. out = { r, g, b (0..255 sRGB),
 * h (height, any scale), rough (0..1) }. Builds colour / normal / roughness maps from it.
 */
function makeSurface(w, h, pixel, { normalStrength = 0, roughness = false, tile = [1, 1] } = {}) {
  const color = createCanvas(w, h);
  const cctx = color.getContext('2d', { willReadFrequently: true });
  const img = cctx.createImageData(w, h);
  const d = img.data;
  const heights = normalStrength ? new Float32Array(w * h) : null;
  let rough = null, rdata = null, rimg = null, rctx = null;
  if (roughness) {
    rough = createCanvas(w, h);
    rctx = rough.getContext('2d', { willReadFrequently: true });
    rimg = rctx.createImageData(w, h);
    rdata = rimg.data;
  }
  const out = { r: 0, g: 0, b: 0, h: 0, rough: 1 };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      out.h = 0;
      out.rough = 1;
      pixel(x, y, x / w, y / h, out);
      const i = (y * w + x) * 4;
      d[i] = out.r;
      d[i + 1] = out.g;
      d[i + 2] = out.b;
      d[i + 3] = 255;
      if (heights) heights[y * w + x] = out.h;
      if (rdata) {
        const r = clamp(out.rough) * 255;
        rdata[i] = r;
        rdata[i + 1] = r;
        rdata[i + 2] = 0;
        rdata[i + 3] = 255;
      }
    }
  }
  cctx.putImageData(img, 0, 0);
  if (rctx) rctx.putImageData(rimg, 0, 0);
  const repeat = [1 / tile[0], 1 / tile[1]];
  const set = { map: canvasTexture(color, { repeat, srgb: true }), tile };
  if (heights) set.normalMap = canvasTexture(heightToNormalCanvas(heights, w, h, normalStrength), { repeat, srgb: false });
  if (rough) set.roughnessMap = canvasTexture(rough, { repeat, srgb: false });
  return set;
}

const rgb = (c) => (Array.isArray(c) ? c : hexToRgb(c));
const sz = (n, res) => Math.max(32, Math.round((n * res) / 32) * 32);

/**
 * Vertical board-and-batten wood cladding ("tømmermannskledning"): wide under-boards with narrow battens over the
 * joints, wood grain, per-board tone variation, a few knots. UV u = across boards, v = up.
 */
export function woodCladding({ color = '#6e3d25', boardCC = 0.2, battenW = 0.072, tileW = 1.2, tileH = 2.4, seed = 7, res = 1 } = {}) {
  return cached(`surf:cladding:${color}:${boardCC}:${battenW}:${tileW}:${tileH}:${seed}:${res}`, () => {
    const w = sz(512, res), h = sz(1024, res);
    const n = Math.round(tileW / boardCC);
    const cc = tileW / n;
    const half = battenW / 2;
    const noise = new TileableNoise(seed);
    const rnd = mulberry32(seed * 31 + 5);
    const boardTone = Array.from({ length: n }, () => 0.84 + rnd() * 0.24);
    const battenTone = Array.from({ length: n }, () => 0.92 + rnd() * 0.2);
    const boardShift = Array.from({ length: n }, () => Math.floor(rnd() * 64));
    const knots = Array.from({ length: 3 }, () => ({ u: rnd(), v: rnd(), r: 0.005 + rnd() * 0.006 }));
    const [cr, cg, cb] = rgb(color);
    return makeSurface(w, h, (x, y, u, v, out) => {
      const fx = u * n;
      const k = Math.floor(fx);
      const f = fx - k;
      const dB = Math.min(f, 1 - f) * cc; // metres to the nearest joint (batten centre line)
      const isBatten = dB < half;
      const idx = isBatten ? (f < 0.5 ? k : (k + 1) % n) : k;
      // grain: long vertical streaks, offset per board so neighbours differ
      const gx = isBatten ? 37 + idx * 5 : boardShift[idx];
      const g1 = noise.noise(u * 160 + gx, v * 3, 160, 3);
      const g2 = noise.noise(u * 480 + gx * 3, v * 9, 480, 9);
      const mott = noise.noise(u * 6, v * 3, 6, 3);
      let tone = isBatten ? battenTone[idx] * 1.04 : boardTone[idx];
      tone *= 1 + 0.13 * g1 + 0.06 * g2 + 0.05 * mott;
      let height = 0;
      if (isBatten) {
        height = 1 - smoothstep(half - 0.006, half, dB); // bevelled batten edges
        tone *= 1 - 0.18 * (1 - height); // darker bevel
      } else {
        const ao = 1 - 0.4 * (1 - smoothstep(half, half + 0.022, dB));
        tone *= ao;
      }
      // knots
      for (const kn of knots) {
        let du = Math.abs(u - kn.u);
        du = Math.min(du, 1 - du) * tileW;
        let dv = Math.abs(v - kn.v);
        dv = Math.min(dv, 1 - dv) * tileH * 0.55;
        const dd = Math.hypot(du, dv) / kn.r;
        if (dd < 1.6) tone *= 0.84 + 0.16 * smoothstep(0.4, 1.6, dd);
      }
      out.r = clamp(cr * tone, 0, 255);
      out.g = clamp(cg * tone * 0.985, 0, 255);
      out.b = clamp(cb * tone * 0.97, 0, 255);
      out.h = height * 0.6 + g2 * 0.04 + g1 * 0.03;
    }, { normalStrength: 2.2, tile: [tileW, tileH] });
  });
}

/**
 * Plain painted/stained wood (trims, fascia, barge boards): fine grain along u (boards run along their length).
 * `boards` > 0 adds tongue-and-groove joints every `boards` metres across v (soffit panelling).
 */
export function woodPlain({ color = '#5c3420', tile = 1.2, boards = 0, seed = 11, res = 1 } = {}) {
  return cached(`surf:woodplain:${color}:${tile}:${boards}:${seed}:${res}`, () => {
    const w = sz(256, res), h = sz(256, res);
    const noise = new TileableNoise(seed);
    const [cr, cg, cb] = rgb(color);
    const nb = boards > 0 ? Math.round(tile / boards) : 0;
    return makeSurface(w, h, (x, y, u, v, out) => {
      const g1 = noise.noise(u * 3, v * 60, 3, 60);
      const g2 = noise.noise(u * 8, v * 160, 8, 160);
      let tone = 1 + 0.09 * g1 + 0.05 * g2;
      let height = g2 * 0.05;
      if (nb) {
        const fv = v * nb;
        const dj = Math.min(fv - Math.floor(fv), Math.ceil(fv) - fv) * (tile / nb);
        if (dj < 0.004) {
          tone *= 0.55;
          height -= 0.6;
        }
        tone *= 0.94 + 0.12 * hash2(Math.floor(fv), 3, seed);
      }
      out.r = clamp(cr * tone, 0, 255);
      out.g = clamp(cg * tone, 0, 255);
      out.b = clamp(cb * tone, 0, 255);
      out.h = height;
    }, { normalStrength: 2, tile: [tile, tile] });
  });
}

/**
 * Cast concrete: mottling, pores, optional formwork panel joints and tie holes.
 * @param {object} o
 * @param {number[]} [o.panel]  formwork panel size [w, h] in metres (joint lines), omit for none
 * @param {boolean} [o.ties]    tie-rod holes in the formwork panels
 * @param {number} [o.contrast] 0..2 multiplier on all variation
 */
export function concrete({ color = '#9a9b97', tile = 2.4, panel = null, ties = false, contrast = 1, seed = 3, res = 1 } = {}) {
  return cached(`surf:concrete:${color}:${tile}:${panel}:${ties}:${contrast}:${seed}:${res}`, () => {
    const w = sz(512, res), h = w;
    const noise = new TileableNoise(seed);
    const [cr, cg, cb] = rgb(color);
    const px = 1 / w;
    const pw = panel ? panel[0] / tile : 0, ph = panel ? panel[1] / tile : 0;
    const tieR = 0.011 / tile;
    return makeSurface(w, h, (x, y, u, v, out) => {
      const big = noise.fbm(u, v, 3, 4, 0.55);
      const fine = noise.noise(u * 96, v * 96, 96, 96);
      const pore = hash2(x, y, seed) < 0.012 ? -1 : 0;
      let tone = 1 + contrast * (0.07 * big + 0.025 * fine + 0.12 * pore * 0.5);
      let height = 0.3 * big + 0.15 * fine + pore * 0.6;
      if (panel) {
        const fu = u / pw, fv = v / ph;
        const du = Math.min(fu - Math.floor(fu), Math.ceil(fu) - fu) * pw;
        const dv = Math.min(fv - Math.floor(fv), Math.ceil(fv) - fv) * ph;
        const dj = Math.min(du, dv);
        if (dj < px * 1.2) {
          tone *= 1 - 0.1 * contrast;
          height -= 0.8;
        } else if (dj < px * 3) tone *= 1 - 0.03 * contrast;
        // per-panel tone (each pour/panel slightly different)
        tone *= 1 + contrast * 0.035 * (hash2(Math.floor(fu), Math.floor(fv), seed) - 0.5);
        if (ties) {
          // holes 0.3 m in from the panel edges, every 0.6 m
          const tu = (fu - Math.floor(fu)) * pw * tile, tv = (fv - Math.floor(fv)) * ph * tile;
          const gx = ((tu - 0.3) / 0.6) % 1, gy = ((tv - 0.3) / 0.6) % 1;
          const ddx = Math.min(Math.abs(gx), 1 - Math.abs(gx)) * 0.6 / tile;
          const ddy = Math.min(Math.abs(gy), 1 - Math.abs(gy)) * 0.6 / tile;
          const dd = Math.hypot(ddx, ddy);
          if (dd < tieR) {
            tone *= 1 - 0.28 * contrast;
            height -= 1.2;
          } else if (dd < tieR * 1.6) tone *= 1 - 0.06 * contrast;
        }
      }
      out.r = clamp(cr * tone, 0, 255);
      out.g = clamp(cg * tone, 0, 255);
      out.b = clamp(cb * tone, 0, 255);
      out.h = height;
    }, { normalStrength: 1.6, tile: [tile, tile] });
  });
}

/** Painted plaster / painted concrete wall: very subtle mottling and orange-peel relief. */
export function paintedWall({ color = '#e8e5de', tile = 2, variation = 1, panel = null, seed = 5, res = 1 } = {}) {
  return cached(`surf:paint:${color}:${tile}:${variation}:${panel}:${seed}:${res}`, () => {
    const w = sz(256, res), h = w;
    const noise = new TileableNoise(seed);
    const [cr, cg, cb] = rgb(color);
    const px = 1 / w;
    const pw = panel ? panel[0] / tile : 0, ph = panel ? panel[1] / tile : 0;
    return makeSurface(w, h, (x, y, u, v, out) => {
      const big = noise.fbm(u, v, 2, 3, 0.5);
      const fine = noise.noise(u * 64, v * 64, 64, 64);
      let tone = 1 + variation * (0.025 * big + 0.01 * fine);
      // keep the relief very subtle: painted walls should read flat with a faint orange peel
      let height = fine * 0.035 + big * 0.05;
      if (panel) {
        const fu = u / pw, fv = v / ph;
        const dj = Math.min(Math.min(fu - Math.floor(fu), Math.ceil(fu) - fu) * pw, Math.min(fv - Math.floor(fv), Math.ceil(fv) - fv) * ph);
        if (dj < px * 1.1) {
          tone *= 0.965;
          height -= 0.25;
        }
      }
      out.r = clamp(cr * tone, 0, 255);
      out.g = clamp(cg * tone, 0, 255);
      out.b = clamp(cb * tone, 0, 255);
      out.h = height;
    }, { normalStrength: 1, tile: [tile, tile] });
  });
}

/** Sheet vinyl flooring: fine multi-coloured flecks on a light base, faint seam at the tile edge. */
export function vinylFloor({ color = '#b9bcb8', tile = 2, seed = 21, res = 1 } = {}) {
  return cached(`surf:vinyl:${color}:${tile}:${seed}:${res}`, () => {
    const w = sz(512, res), h = w;
    const noise = new TileableNoise(seed);
    const [cr, cg, cb] = rgb(color);
    return makeSurface(w, h, (x, y, u, v, out) => {
      const big = noise.fbm(u, v, 3, 3, 0.5);
      const fleck = noise.noise(u * 140, v * 140, 140, 140);
      const fleck2 = noise.noise(u * 90 + 7, v * 90 + 3, 90, 90);
      let tone = 1 + 0.03 * big;
      let dr = 0, dg = 0, db = 0;
      if (fleck > 0.55) { tone *= 0.82; }
      else if (fleck < -0.6) { tone *= 1.08; }
      if (fleck2 > 0.62) { dr = -6; dg = -2; db = 6; }
      const seam = x === 0 || y === 0 ? 0.9 : 1;
      out.r = clamp(cr * tone * seam + dr, 0, 255);
      out.g = clamp(cg * tone * seam + dg, 0, 255);
      out.b = clamp(cb * tone * seam + db, 0, 255);
      out.h = (x === 0 || y === 0 ? -0.5 : 0) + 0.1 * fleck;
      out.rough = 0.55 + 0.1 * big;
    }, { normalStrength: 0.8, roughness: true, tile: [tile, tile] });
  });
}

/**
 * Painted floor (concrete with floor paint / epoxy): soft mottling, faint roller marks and scuffs.
 * `gloss` 0..1 lowers the roughness (epoxy ≈ 0.75 → roughness ≈ 0.35).
 */
export function paintedFloor({ color = '#8f9391', tile = 3, gloss = 0.3, scuffs = 1, seed = 13, res = 1 } = {}) {
  return cached(`surf:pfloor:${color}:${tile}:${gloss}:${scuffs}:${seed}:${res}`, () => {
    const w = sz(512, res), h = w;
    const noise = new TileableNoise(seed);
    const [cr, cg, cb] = rgb(color);
    const baseRough = 0.85 - gloss * 0.65;
    return makeSurface(w, h, (x, y, u, v, out) => {
      const big = noise.fbm(u, v, 2, 4, 0.55);
      const roller = noise.noise(u * 2, v * 40, 2, 40);
      const scuff = noise.fbm(u + 0.37, v + 0.71, 6, 3, 0.6);
      const fine = noise.noise(u * 200, v * 200, 200, 200);
      let tone = 1 + 0.035 * big + 0.012 * roller + 0.008 * fine;
      let rough = baseRough + 0.05 * big;
      if (scuffs && scuff > 0.32) {
        const s = smoothstep(0.32, 0.6, scuff) * scuffs;
        tone *= 1 - 0.07 * s;
        rough += 0.18 * s;
      }
      out.r = clamp(cr * tone, 0, 255);
      out.g = clamp(cg * tone, 0, 255);
      out.b = clamp(cb * tone, 0, 255);
      out.h = 0.15 * fine + 0.2 * big;
      out.rough = rough;
    }, { normalStrength: 0.7, roughness: true, tile: [tile, tile] });
  });
}

/**
 * Suspended ceiling (600×600 mm lay-in tiles) – covers 2×2 tiles (1.2 m). White T-bar grid with soft shadow lines
 * and fissured mineral-fibre tiles. Align geometry UVs to the grid (world metres, origin on a grid line).
 */
export function ceilingTiles({ module = 0.6, color = '#eeeeea', seed = 17, res = 1 } = {}) {
  return cached(`surf:ceiltiles:${module}:${color}:${seed}:${res}`, () => {
    const w = sz(512, res), h = w;
    const tile = module * 2;
    const noise = new TileableNoise(seed);
    const [cr, cg, cb] = rgb(color);
    const bar = 0.012 / tile; // half width of the T-bar face
    return makeSurface(w, h, (x, y, u, v, out) => {
      const fu = (u * 2) % 1, fv = (v * 2) % 1;
      const du = Math.min(fu, 1 - fu) / 2, dv = Math.min(fv, 1 - fv) / 2; // in texture units
      const d = Math.min(du, dv);
      let tone, height;
      if (d < bar) {
        tone = 1.02;
        height = 1;
      } else {
        const fis = noise.noise(u * 120, v * 120, 120, 120);
        const sp = hash2(x, y, seed) < 0.05 ? 0.93 : 1;
        tone = (0.97 + 0.02 * fis) * sp;
        if (d < bar * 2.2) tone *= 0.86; // shadow gap along the bar
        height = 0.1 * fis + (sp < 1 ? -0.3 : 0);
      }
      out.r = clamp(cr * tone, 0, 255);
      out.g = clamp(cg * tone, 0, 255);
      out.b = clamp(cb * tone, 0, 255);
      out.h = height;
    }, { normalStrength: 1.5, tile: [tile, tile] });
  });
}

/** Coated steel sheet (roofing, flashing): faint streaks along v and mottling. */
export function coatedSteel({ color = '#5a3c2b', tile = 2, seed = 23, res = 1 } = {}) {
  return cached(`surf:steel:${color}:${tile}:${seed}:${res}`, () => {
    const w = sz(256, res), h = w;
    const noise = new TileableNoise(seed);
    const [cr, cg, cb] = rgb(color);
    return makeSurface(w, h, (x, y, u, v, out) => {
      const streak = noise.noise(u * 24, v * 2, 24, 2);
      const big = noise.fbm(u, v, 2, 3, 0.5);
      const tone = 1 + 0.06 * streak + 0.05 * big;
      out.r = clamp(cr * tone, 0, 255);
      out.g = clamp(cg * tone, 0, 255);
      out.b = clamp(cb * tone, 0, 255);
      out.rough = 0.62 + 0.06 * streak + 0.05 * big;
    }, { roughness: true, tile: [tile, tile] });
  });
}

/**
 * One sectional-door panel (UV 0..1 over the whole panel): `grooves` shallow horizontal ribs ("micro-profile"),
 * tongue at the top edge, groove at the bottom edge. Colour is multiplied with the material colour.
 */
export function sectionalPanel({ grooves = 5, seed = 29, res = 1 } = {}) {
  return cached(`surf:sectional:${grooves}:${seed}:${res}`, () => {
    const w = sz(128, res), h = sz(256, res);
    const noise = new TileableNoise(seed);
    return makeSurface(w, h, (x, y, u, v, out) => {
      const fv = v * (grooves + 1);
      const f = fv - Math.floor(fv);
      const groove = Math.floor(fv) > 0 && f < 0.06 ? 1 : 0;
      const edge = v < 0.015 || v > 0.985 ? 1 : 0;
      const peel = noise.noise(u * 64, v * 64, 64, 64);
      const t = 236 * (1 - 0.18 * groove - 0.3 * edge) + 4 * peel;
      out.r = out.g = out.b = clamp(t, 0, 255);
      out.h = -0.6 * groove - edge + 0.05 * peel + (f > 0.06 && f < 0.12 && Math.floor(fv) > 0 ? 0.25 : 0);
    }, { normalStrength: 2.5, tile: [1, 1] });
  });
}

/** Fine orange-peel normal map (painted steel), neutral white colour map. */
export function paintedMetal({ tile = 0.25, seed = 31, res = 1 } = {}) {
  return cached(`surf:pmetal:${tile}:${seed}:${res}`, () => {
    const w = sz(128, res), h = w;
    const noise = new TileableNoise(seed);
    return makeSurface(w, h, (x, y, u, v, out) => {
      const n = noise.noise(u * 48, v * 48, 48, 48);
      const b = noise.fbm(u, v, 2, 2, 0.5);
      out.r = out.g = out.b = clamp(246 + 6 * b, 0, 255);
      out.h = n * 0.04;
    }, { normalStrength: 1, tile: [tile, tile] });
  });
}

/** Utility: a MeshStandardMaterial from a surface set. */
export function surfaceMaterial(set, params = {}) {
  const m = new THREE.MeshStandardMaterial({ map: set.map, ...params });
  if (set.normalMap) m.normalMap = set.normalMap;
  if (set.roughnessMap) m.roughnessMap = set.roughnessMap;
  return m;
}

/* ================================================================================================================
 * Wet-room and panel finishes of the house (notes/hele-huset-design.md §2.1, §2.3, §2.7, §4.16; avstemming V41)
 *
 * stonePanel / tiles / wetroom make COLOUR-NEUTRAL grey texture sets as DataTextures (no canvas: they also run in
 * Node, tools/house-tests/bathroom.test.mjs): { map, normalMap, roughnessMap, tile, ref, roughRef }. `ref` is the mean
 * linear luminance of the map - a material tinted with `color = hex / ref` has `hex` as its average colour, so one
 * set per pattern serves every colour. The sets are memoized per parameter set (proctex.cached).
 *
 * surfaceFinish(kind, hex, opts) gives the cached MeshStandardMaterial of a finish. It always carries map, normalMap
 * and roughnessMap (and no clearcoat / transmission / vertex colours), exactly the map set the textured kinds of
 * home/materials.js use - a finish never compiles a new shader program (§4.16).
 *
 * UVs: metres (u along the wall / x, v up / z), as everywhere in buildKit.js. Panel joints sit on u = k * size[0]; to
 * centre the joints on a wall, shift the geometry's u (panelUOffset), not texture.offset - the texture is shared.
 * ============================================================================================================== */

const _lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const dsz = (n, res) => Math.max(32, Math.round((n * res) / 32) * 32);

/** RGBA bytes -> a repeating, mip-mapped DataTexture (flipY like the canvas textures). */
function dataTex(data, w, h, repeat, srgb) {
  const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat[0], repeat[1]);
  t.anisotropy = 8;
  t.flipY = true;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

/**
 * Grey texture set from `pixel(x, y, u, v, o)`: o.l = grey 0..1 (sRGB), o.h = height, o.rough = roughness 0..1.
 * Always makes all three maps (map, normalMap, roughnessMap). Not cached here - callers wrap it in cached().
 */
function greySet({ w, h, tile, pixel, normal = 1 }) {
  const n = w * h;
  const color = new Uint8Array(n * 4);
  const rough = new Uint8Array(n * 4);
  const heights = new Float32Array(n);
  const o = { l: 0.8, h: 0, rough: 0.6 };
  let sum = 0, rsum = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      o.l = 0.8;
      o.h = 0;
      o.rough = 0.6;
      pixel(x, y, x / w, y / h, o);
      const l = clamp(o.l), r = clamp(o.rough);
      const i = y * w + x;
      const k = i * 4;
      color[k] = color[k + 1] = color[k + 2] = l * 255;
      color[k + 3] = 255;
      rough[k] = rough[k + 1] = rough[k + 2] = r * 255;
      rough[k + 3] = 255;
      heights[i] = o.h;
      sum += _lin(Math.round(l * 255) / 255);
      rsum += Math.round(r * 255) / 255;
    }
  }
  const nrm = new Uint8Array(n * 4);
  const H = (x, y) => heights[((y + h) % h) * w + ((x + w) % w)];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (H(x + 1, y) - H(x - 1, y)) * normal;
      const dy = (H(x, y + 1) - H(x, y - 1)) * normal;
      const nx = -dx, ny = dy;
      const len = Math.hypot(nx, ny, 1);
      const k = (y * w + x) * 4;
      nrm[k] = ((nx / len) * 0.5 + 0.5) * 255;
      nrm[k + 1] = ((ny / len) * 0.5 + 0.5) * 255;
      nrm[k + 2] = ((1 / len) * 0.5 + 0.5) * 255;
      nrm[k + 3] = 255;
    }
  }
  const repeat = [1 / tile[0], 1 / tile[1]];
  return {
    map: dataTex(color, w, h, repeat, true),
    normalMap: dataTex(nrm, w, h, repeat, false),
    roughnessMap: dataTex(rough, w, h, repeat, false),
    tile: [tile[0], tile[1]],
    ref: Math.max(0.02, sum / n),
    roughRef: Math.max(0.05, rsum / n),
    size: [w, h],
  };
}

/**
 * Stone-look wet-room wall panels (the bathroom of 1. etasje, V41: #c8c5bf, joint #bcb9b3, vertical joints every
 * 0.60, no horizontal joint; the dark shower panels of the laundry #5a5657 with clouds #77726f / #3f3c3c): soft cloudy
 * stone mottling, a faint per-panel tone shift and a thin recessed joint. The set covers two panels across
 * (2 * size[0]) and as much up when there are no horizontal joints, else size[1].
 * @param {object} [o]
 * @param {number[]} [o.size=[0.6, 2.4]]   panel width x height (m)
 * @param {boolean} [o.horizontalJoints=false]
 * @param {boolean} [o.joints=true]        false: no joints at all (one big slab look)
 * @param {number} [o.jointTone=0.87]      joint brightness relative to the panel (linear luminance joint / face)
 * @param {number} [o.jointWidth=0.003]    m
 * @param {number} [o.clouds=1]            contrast of the cloudy mottling (1 = about +-7 %, the beige bathroom; 3.5 = the dark panels)
 * @param {number} [o.seed=51] @param {number} [o.res=1]
 */
export function stonePanel({ size = [0.6, 2.4], horizontalJoints = false, joints = true, jointTone = 0.87, jointWidth = 0.003, clouds = 1, seed = 51, res = 1 } = {}) {
  const pw = size[0], ph = size[1];
  const tileU = pw * 2;
  const tileV = horizontalJoints ? ph : tileU;
  const key = `surf:stonepanel:${pw}:${ph}:${horizontalJoints}:${joints}:${jointTone}:${jointWidth}:${clouds}:${seed}:${res}`;
  return cached(key, () => {
    const w = dsz(640, res);
    const h = dsz(640 * (tileV / tileU), res);
    const noise = new TileableNoise(seed);
    const rnd = mulberry32(seed * 7 + 3);
    const panelTone = [1 + (rnd() - 0.5) * 0.03, 1 + (rnd() - 0.5) * 0.03];
    const pxU = tileU / w, pxV = tileV / h;
    const half = jointWidth / 2;
    // the map is sRGB: a linear ratio r is about an sRGB ratio of r^(1/2.2); the square root is close and keeps joints soft
    const jt = Math.sqrt(jointTone);
    const cyc = Math.max(1, Math.round(tileV / tileU));
    return greySet({ w, h, tile: [tileU, tileV], normal: 1.2, pixel(x, y, u, v, o) {
      // soft stone clouds (big blotches + mid mottling + fine grain), tileable in both directions
      const big = noise.noise(u * 3, v * 3 * cyc, 3, 3 * cyc);
      const mid = noise.noise(u * 9 + 11, v * 9 * cyc + 5, 9, 9 * cyc);
      const fine = noise.noise(u * 48 + 3, v * 48 * cyc + 9, 48, 48 * cyc);
      const speck = hash2(x, y, seed) < 0.01 ? -0.6 : 0;
      let t = 1 + clouds * (0.045 * big + 0.03 * mid + 0.008 * fine + 0.01 * speck);
      t *= panelTone[u < 0.5 ? 0 : 1];
      let hh = 0.25 * mid + 0.08 * fine;
      if (joints) {
        // vertical joints at u = 0 and 0.5 (every panel width), horizontal at v = 0 when asked
        let d = Math.min(u % 0.5, 0.5 - (u % 0.5)) * tileU;
        if (horizontalJoints) d = Math.min(d, Math.min(v, 1 - v) * tileV);
        const px = Math.min(pxU, pxV);
        if (d < half + px) {
          const a = smoothstep(half + px, half - px * 0.5, d);
          t *= 1 - (1 - jt) * a;
          hh -= 1.2 * a;
        }
      }
      o.l = 0.88 * t;
      o.h = hh;
      o.rough = 0.62 + 0.04 * mid;
    } });
  });
}

/**
 * Ceramic tiles: a grid of size[0] x size[1] tiles with grout lines, per-tile tone variation and a slight bevel. The
 * set covers 2 x 2 tiles. Colour-neutral (tint with the tile colour).
 * @param {object} [o]
 * @param {number[]} [o.size=[0.3, 0.3]] @param {number} [o.grout=0.003] (m) @param {number} [o.groutTone=0.72]
 * @param {number} [o.clouds=0.5] @param {number} [o.gloss=0.4] (0..1, lower roughness)
 * @param {number} [o.seed=61] @param {number} [o.res=1]
 */
export function tiles({ size = [0.3, 0.3], grout = 0.003, groutTone = 0.72, clouds = 0.5, gloss = 0.4, seed = 61, res = 1 } = {}) {
  const key = `surf:tiles:${size[0]}:${size[1]}:${grout}:${groutTone}:${clouds}:${gloss}:${seed}:${res}`;
  return cached(key, () => {
    const tileU = size[0] * 2, tileV = size[1] * 2;
    const w = dsz(512, res);
    const h = dsz(512 * (tileV / tileU), res);
    const noise = new TileableNoise(seed);
    const px = Math.max(tileU / w, tileV / h);
    const half = grout / 2;
    const baseRough = 0.7 - gloss * 0.5;
    return greySet({ w, h, tile: [tileU, tileV], normal: 1.5, pixel(x, y, u, v, o) {
      const iu = u < 0.5 ? 0 : 1, iv = v < 0.5 ? 0 : 1;
      const du = Math.min(u % 0.5, 0.5 - (u % 0.5)) * tileU;
      const dv = Math.min(v % 0.5, 0.5 - (v % 0.5)) * tileV;
      const d = Math.min(du, dv);
      const mott = noise.noise(u * 6, v * 6, 6, 6);
      const tileTone = 1 + 0.03 * (hash2(iu, iv, seed) - 0.5);
      let t = tileTone * (1 + clouds * 0.04 * mott);
      let hh = 0;
      let rough = baseRough + 0.03 * mott;
      if (d < half + px) {
        const a = smoothstep(half + px, half - px * 0.5, d);
        t *= 1 - (1 - groutTone) * a;
        hh = -1 * a;
        rough += (0.92 - rough) * a;
      } else if (d < half + 0.004) {
        hh = -0.35 * (1 - (d - half) / 0.004); // bevelled tile edge
      }
      o.l = 0.92 * t;
      o.h = hh;
      o.rough = rough;
    } });
  });
}

/**
 * Wet-room vinyl (the bathroom floors, cloudy concrete look): seamless, big soft dark / light clouds, a fine grain
 * and a low satin sheen - no joints. clouds 1 = the dark grey bathroom floor of 1. etasje (#5a5759, clouds
 * #4d4b4d-#6e6c6e, about +-12 %); the laundry floor (#8c8789, clouds #737072 / #a3a0a1) is about the same.
 * @param {object} [o] @param {number} [o.clouds=1] @param {number} [o.tile=1.6] (m) @param {number} [o.seed=71] @param {number} [o.res=1]
 */
export function wetroom({ clouds = 1, tile = 1.6, seed = 71, res = 1 } = {}) {
  const key = `surf:wetroom:${clouds}:${tile}:${seed}:${res}`;
  return cached(key, () => {
    const w = dsz(512, res), h = w;
    const noise = new TileableNoise(seed);
    return greySet({ w, h, tile: [tile, tile], normal: 0.6, pixel(x, y, u, v, o) {
      const big = noise.fbm(u, v, 2, 3, 0.55);
      const mid = noise.noise(u * 7 + 2, v * 7 + 5, 7, 7);
      const streak = noise.noise(u * 16 + 9, v * 5 + 1, 16, 5);
      const fine = noise.noise(u * 90, v * 90, 90, 90);
      const t = 1 + clouds * (0.1 * big + 0.045 * mid + 0.02 * streak + 0.012 * fine);
      o.l = 0.62 * t;
      o.h = 0.2 * mid + 0.1 * fine;
      o.rough = 0.5 + 0.06 * big;
    } });
  });
}

/**
 * Roof coverings (notes/tak.md), colour-neutral grey sets like the panels above (DataTextures, also in Node). UVs in
 * metres: u across the slope (along the eave), v DOWN the slope (home/roof.js). Kinds:
 *   'tile'   takstein: concrete double-S tiles 0.30 wide in courses of 0.34, the lip of each course in shadow
 *   'slate'  skifer: slates 0.30 wide, 0.20 courses, every other course shifted half a slate, dark gaps
 *   'felt'   papp: a matt sheet with laps every 1 m across the slope
 *   'steel'  stålplater: trapezoid ribs every 0.2 m down the slope
 * @param {{ kind: 'tile'|'slate'|'felt'|'steel', seed?: number, res?: number }} o
 */
export function roofCovering({ kind = 'tile', seed = 81, res = 1 } = {}) {
  const key = `surf:roof:${kind}:${seed}:${res}`;
  return cached(key, () => {
    const noise = new TileableNoise(seed);
    if (kind === 'tile') {
      const tw = 0.3, course = 0.34;
      const tileU = tw * 4, tileV = course * 4;
      const w = dsz(512, res), h = dsz(512 * (tileV / tileU), res);
      return greySet({ w, h, tile: [tileU, tileV], normal: 2.2, pixel(x, y, u, v, o) {
        const fu = (u * 4) % 1; // across one tile
        const fv = (v * 4) % 1; // down one course: 0 under the lap of the course above, 1 at this course's lip
        const iu = Math.floor(u * 4), iv = Math.floor(v * 4);
        // the double-S: a roll and a pan per tile
        const wave = 0.5 - 0.5 * Math.cos(fu * Math.PI * 2);
        const lip = smoothstep(0.86, 1, fv);
        const lap = 1 - smoothstep(0, 0.08, fv);
        const tone = 1 + 0.06 * (hash2(iu, iv, seed) - 0.5) + 0.05 * noise.noise(u * 8, v * 8, 8, 8);
        o.l = 0.62 * tone * (0.82 + 0.18 * wave) * (1 - 0.45 * lap) * (1 - 0.12 * lip);
        o.h = 0.55 * wave + 0.5 * fv - 0.6 * lip + 0.03 * noise.noise(u * 40, v * 40, 40, 40);
        o.rough = 0.72 + 0.06 * noise.noise(u * 6 + 3, v * 6, 6, 6);
      } });
    }
    if (kind === 'slate') {
      const sw = 0.3, course = 0.2;
      const tileU = sw * 4, tileV = course * 4;
      const w = dsz(512, res), h = dsz(512 * (tileV / tileU), res);
      const px = tileU / w;
      return greySet({ w, h, tile: [tileU, tileV], normal: 1.6, pixel(x, y, u, v, o) {
        const iv = Math.floor(v * 4);
        const fv = (v * 4) % 1;
        const su = u * 4 + (iv % 2 ? 0.5 : 0);
        const iu = Math.floor(su);
        const fu = su - iu;
        const du = Math.min(fu, 1 - fu) * sw; // m to the slate's side
        const gap = 1 - smoothstep(0.002, 0.002 + 2 * px, du);
        const lip = smoothstep(0.9, 1, fv);
        const lap = 1 - smoothstep(0, 0.06, fv);
        const tone = 1 + 0.12 * (hash2(iu & 3, iv, seed) - 0.5) + 0.06 * noise.noise(u * 12, v * 12, 12, 12) + 0.03 * noise.noise(u * 60, v * 60, 60, 60);
        o.l = 0.55 * tone * (1 - 0.55 * gap) * (1 - 0.35 * lap) * (1 - 0.1 * lip);
        o.h = 0.4 * fv - 0.5 * gap - 0.4 * lip + 0.04 * noise.noise(u * 50, v * 50, 50, 50);
        o.rough = 0.6 + 0.08 * noise.noise(u * 9, v * 9 + 2, 9, 9);
      } });
    }
    if (kind === 'steel') {
      const pitch = 0.2;
      const tileU = pitch * 6, tileV = 2.4;
      const w = dsz(512, res), h = dsz(256, res);
      return greySet({ w, h, tile: [tileU, tileV], normal: 3, pixel(x, y, u, v, o) {
        const fu = (u * 6) % 1;
        // trapezoid rib: flat pan, a 3 cm wide crown, sloped flanks
        const d = Math.abs(fu - 0.5) * pitch; // m from the rib's middle
        const rib = 1 - smoothstep(0.015, 0.035, d);
        o.l = 0.7 * (1 + 0.025 * noise.noise(u * 3, v * 2, 3, 2)) * (0.92 + 0.08 * rib);
        o.h = rib + 0.02 * noise.noise(u * 30, v * 8, 30, 8);
        o.rough = 0.42 + 0.05 * noise.noise(u * 4, v * 3, 4, 3);
      } });
    }
    // felt
    const tileU = 2, tileV = 2;
    const w = dsz(256, res), h = w;
    return greySet({ w, h, tile: [tileU, tileV], normal: 1.2, pixel(x, y, u, v, o) {
      const fv = (v * 2) % 1;
      const lap = 1 - smoothstep(0, 0.012, Math.min(fv, 1 - fv));
      const grit = noise.noise(u * 120, v * 120, 120, 120);
      o.l = 0.55 * (1 + 0.04 * noise.noise(u * 4, v * 4, 4, 4) + 0.03 * grit) * (1 - 0.18 * lap);
      o.h = 0.25 * grit - 0.6 * lap;
      o.rough = 0.88;
    } });
  });
}

/**
 * The cached material of a roof covering in a colour (read-only, userData.cached): hex is the mean colour.
 * @param {'tile'|'slate'|'felt'|'steel'} kind @param {string} hex @param {{ res?: number }} [opts]
 * @returns {THREE.MeshStandardMaterial}
 */
export function roofFinish(kind, hex, { res = 1 } = {}) {
  const set = roofCovering({ kind, res });
  const key = `roof|${kind}|${hex}|${set.map.uuid}`;
  let m = _finishes.get(key);
  if (!m) {
    const color = new THREE.Color(hex).multiplyScalar(1 / set.ref);
    const mx = Math.max(color.r, color.g, color.b);
    if (mx > 1.05) color.multiplyScalar(1.05 / mx);
    const rough = { tile: 0.72, slate: 0.6, felt: 0.9, steel: 0.42 }[kind] ?? 0.7;
    const ns = { tile: 1, slate: 0.8, felt: 0.5, steel: 1 }[kind] ?? 1;
    m = new THREE.MeshStandardMaterial({
      color,
      map: set.map,
      normalMap: set.normalMap,
      normalScale: new THREE.Vector2(ns, ns),
      roughnessMap: set.roughnessMap,
      roughness: rough / set.roughRef,
      metalness: kind === 'steel' ? 0.25 : 0,
    });
    m.name = `roof-${kind} ${hex}`;
    m.userData = { cached: true, kind: `roof-${kind}`, hex, finish: true };
    _finishes.set(key, m);
  }
  return m;
}

/**
 * Facade claddings, plinths and deck surfaces (notes/kledning.md), colour-neutral grey sets like the roof coverings
 * (DataTextures, also in Node). UVs in metres: u along the wall (across the boards), v up (along the boards) – a
 * horizontal cladding swaps u and v in its geometry (home/rooms.js), the texture is never rotated. Kinds:
 *   'wood'         boards along v: profile 'board-batten' (tømmermannskledning, 0.148 under-boards with 0.048
 *                  battens), 'shiplap' (dobbeltfals, 0.128 cover, a stepped shadow line at the rebate), 'shadow'
 *                  (skyggepanel, 0.11 boards with a 10 mm deep groove), 'plain' (0.15 boards, tight joints)
 *   'panels'       fasadeplater: module [w, h] with 8 mm open joints, a faint fibre-cement mottling, ± 3 % per panel
 *   'render'       puss: a scraped, slightly coarse plaster
 *   'brick'        tegl: 228 × 62 mm bricks in running bond with 10 mm recessed, lighter joints
 *   'stone'        naturstein: courses of 0.12–0.26, stones 0.25–0.6 long, bulged faces, deep joints
 *   'concrete'     støpt betong (plinth, deck): mottling and pores
 *   'deck-boards'  terrassebord: 0.12 boards with 6 mm gaps and faint grooves, one butt joint per board
 * @param {{ kind: string, profile?: string, module?: number[], seed?: number, res?: number }} o
 */
export function facadeCovering({ kind = 'wood', profile = 'board-batten', module = [1.2, 2.4], seed = 91, res = 1 } = {}) {
  const key = `surf:facade:${kind}:${kind === 'wood' ? profile : ''}:${kind === 'panels' ? module.join('x') : ''}:${seed}:${res}`;
  return cached(key, () => {
    const noise = new TileableNoise(seed);
    if (kind === 'wood' || kind === 'deck-boards') {
      const P = kind === 'deck-boards'
        ? { cc: 0.126, n: 6, gap: 0.006 }
        : { 'board-batten': { cc: 0.196, n: 6 }, shiplap: { cc: 0.128, n: 8 }, shadow: { cc: 0.11, n: 9 }, plain: { cc: 0.15, n: 7 } }[profile] ?? { cc: 0.15, n: 7 };
      const tileU = P.cc * P.n, tileV = 2.4;
      const w = dsz(256, res), h = dsz(512, res);
      const ends = Array.from({ length: P.n }, (_, k) => hash2(k, 7, seed)); // butt joint per board (deck boards)
      return greySet({ w, h, tile: [tileU, tileV], normal: kind === 'deck-boards' ? 2.4 : 2, pixel(x, y, u, v, o) {
        const fu = u * P.n;
        let k = Math.floor(fu);
        let f = fu - k; // 0..1 across the board (cc)
        const m = f * P.cc; // metres from the board's left joint
        let tone = 1;
        let hgt = 0;
        let battenK = -1;
        if (kind === 'deck-boards') {
          const gap = m < P.gap;
          const dv = Math.abs(((v - ends[k] + 1.5) % 1) - 0.5) * tileV; // m to the butt joint
          tone *= gap ? 0.18 : dv < 0.002 ? 0.35 : 1;
          hgt = gap ? -1 : dv < 0.002 ? -0.6 : 0.05 * Math.sin(m * Math.PI * 2 / 0.006);
        } else if (profile === 'board-batten') {
          // under-boards between battens: a 48 mm batten centred on every joint
          const d = Math.min(m, P.cc - m);
          if (d < 0.024) {
            battenK = m < P.cc / 2 ? k : (k + 1) % P.n;
            hgt = 1 - smoothstep(0.018, 0.024, d);
            tone *= 1.03 - 0.16 * (1 - hgt);
          } else tone *= 1 - 0.32 * (1 - smoothstep(0.024, 0.045, d));
        } else if (profile === 'shiplap') {
          // the rebate: a 5 mm dark line, then a 9 mm bevelled step up onto the board's face
          if (m < 0.005) {
            tone *= 0.3;
            hgt = -1;
          } else if (m < 0.014) {
            const t = (m - 0.005) / 0.009;
            tone *= 0.62 + 0.38 * t;
            hgt = -0.6 + 0.6 * t;
          } else hgt = -0.04 * smoothstep(0.85, 1, f);
        } else if (profile === 'shadow') {
          // a 10 mm square groove between the boards (deep shadow), sharp edges
          if (m < 0.01) {
            tone *= m < 0.002 || m > 0.008 ? 0.45 : 0.22;
            hgt = -1;
          }
        } else if (m < 0.0015 || P.cc - m < 0.0015) {
          tone *= 0.45;
          hgt = -0.5;
        }
        const idx = battenK >= 0 ? battenK + P.n : k;
        const shift = hash2(idx, 3, seed) * 64;
        const g1 = noise.noise(u * 160 + shift, v * 3, 160, 3);
        const g2 = noise.noise(u * 480 + shift * 3, v * 9, 480, 9);
        const mott = noise.noise(u * 6, v * 3, 6, 3);
        tone *= (0.9 + 0.2 * hash2(idx, 1, seed)) * (1 + 0.1 * g1 + 0.05 * g2 + 0.04 * mott);
        o.l = 0.62 * tone;
        o.h = hgt + 0.03 * g1 + 0.02 * g2;
        o.rough = 0.8 + 0.08 * g1;
      } });
    }
    if (kind === 'panels') {
      const [mw, mh] = module;
      const tileU = mw * 2, tileV = mh * 2;
      const w = dsz(384, res), h = dsz(384 * (tileV / tileU), res);
      return greySet({ w, h, tile: [tileU, tileV], normal: 1.4, pixel(x, y, u, v, o) {
        const iu = Math.floor(u * 2), iv = Math.floor(v * 2);
        const du = Math.min((u * 2) % 1, 1 - ((u * 2) % 1)) * mw;
        const dv = Math.min((v * 2) % 1, 1 - ((v * 2) % 1)) * mh;
        const d = Math.min(du, dv); // m to the nearest joint centre
        const joint = d < 0.004;
        const edge = !joint && d < 0.007;
        const tone = (1 + 0.06 * (hash2(iu, iv, seed) - 0.5)) * (1 + 0.025 * noise.noise(u * 8, v * 8, 8, 8) + 0.012 * noise.noise(u * 90, v * 90, 90, 90));
        o.l = 0.66 * tone * (joint ? 0.28 : edge ? 1.04 : 1);
        o.h = joint ? -1 : edge ? 0.15 : 0.02 * noise.noise(u * 60, v * 60, 60, 60);
        o.rough = 0.62 + 0.04 * noise.noise(u * 5 + 2, v * 5, 5, 5);
      } });
    }
    if (kind === 'render') {
      const tile = 2;
      const w = dsz(384, res), h = w;
      return greySet({ w, h, tile: [tile, tile], normal: 2.6, pixel(x, y, u, v, o) {
        const big = noise.fbm(u, v, 3, 3, 0.55);
        const grit = noise.noise(u * 220, v * 220, 220, 220);
        const scrape = noise.noise(u * 60, v * 60, 60, 60);
        o.l = 0.78 * (1 + 0.035 * big + 0.03 * grit);
        o.h = 0.5 * grit + 0.35 * scrape;
        o.rough = 0.9;
      } });
    }
    if (kind === 'brick') {
      const bw = 0.228, bh = 0.062, j = 0.01;
      const mu = bw + j, mv = bh + j;
      const nu = 4, nv = 8;
      const tileU = mu * nu, tileV = mv * nv;
      const w = dsz(512, res), h = dsz(512 * (tileV / tileU), res);
      return greySet({ w, h, tile: [tileU, tileV], normal: 2.2, pixel(x, y, u, v, o) {
        const row = Math.floor(v * nv);
        const fv = v * nv - row;
        const su = u * nu + (row % 2 ? 0.5 : 0);
        const col = Math.floor(su);
        const fu = su - col;
        const ju = Math.min(fu, 1 - fu) * mu, jv = Math.min(fv, 1 - fv) * mv; // m to the joint centres
        const mortar = ju < j / 2 || jv < j / 2;
        const tone = 1 + 0.24 * (hash2(col % nu, row, seed) - 0.5) + 0.06 * noise.noise(u * 40, v * 40, 40, 40) + 0.04 * noise.noise(u * 160, v * 160, 160, 160);
        const edge = mortar ? 0 : smoothstep(j / 2, j / 2 + 0.006, Math.min(ju, jv));
        o.l = mortar ? 0.82 * (1 + 0.05 * noise.noise(u * 120, v * 120, 120, 120)) : 0.5 * tone * (0.88 + 0.12 * edge);
        o.h = mortar ? -0.8 : 0.4 * edge + 0.08 * noise.noise(u * 90, v * 90, 90, 90);
        o.rough = mortar ? 0.95 : 0.85;
      } });
    }
    if (kind === 'stone') {
      const tileU = 1.6, tileV = 1.6;
      const rnd = mulberry32(seed * 7 + 3);
      // courses that add up to the tile, each with stones that add up to it (the layout wraps both ways)
      const rows = [];
      let vy = 0;
      while (vy < tileV - 1e-6) {
        let hh = 0.12 + rnd() * 0.14;
        if (tileV - vy - hh < 0.12) hh = tileV - vy;
        const stones = [];
        let ux = rnd() * 0.3;
        const start = ux;
        while (ux < start + tileU - 1e-6) {
          let ll = 0.25 + rnd() * 0.35;
          if (start + tileU - ux - ll < 0.22) ll = start + tileU - ux;
          stones.push({ u0: ux, u1: ux + ll, tone: 0.8 + rnd() * 0.36 });
          ux += ll;
        }
        rows.push({ v0: vy, v1: vy + hh, stones });
        vy += hh;
      }
      const w = dsz(512, res), h = w;
      const J = 0.012;
      return greySet({ w, h, tile: [tileU, tileV], normal: 3, pixel(x, y, u, v, o) {
        const mv = v * tileV;
        const r = rows.find((q) => mv >= q.v0 && mv < q.v1) ?? rows[rows.length - 1];
        let mu = u * tileU;
        if (mu < r.stones[0].u0) mu += tileU;
        const s = r.stones.find((q) => mu >= q.u0 && mu < q.u1) ?? r.stones[r.stones.length - 1];
        const d = Math.min(mu - s.u0, s.u1 - mu, mv - r.v0, r.v1 - mv);
        const joint = d < J / 2;
        const bulge = joint ? 0 : smoothstep(J / 2, J / 2 + 0.05, d);
        const n1 = noise.noise(u * 24, v * 24, 24, 24), n2 = noise.noise(u * 110, v * 110, 110, 110);
        o.l = joint ? 0.36 : 0.6 * s.tone * (0.87 + 0.13 * bulge) * (1 + 0.1 * n1 + 0.05 * n2);
        o.h = joint ? -1 : 0.7 * bulge + 0.15 * n1 + 0.06 * n2;
        o.rough = joint ? 0.95 : 0.82 + 0.06 * n1;
      } });
    }
    // concrete
    const tile = 2.4;
    const w = dsz(384, res), h = w;
    return greySet({ w, h, tile: [tile, tile], normal: 1.6, pixel(x, y, u, v, o) {
      const big = noise.fbm(u, v, 3, 4, 0.55);
      const fine = noise.noise(u * 96, v * 96, 96, 96);
      const pore = hash2(x, y, seed) < 0.01 ? -1 : 0;
      o.l = 0.7 * (1 + 0.06 * big + 0.025 * fine + 0.06 * pore);
      o.h = 0.3 * big + 0.15 * fine + 0.6 * pore;
      o.rough = 0.88;
    } });
  });
}

/**
 * The cached material of a facade covering in a colour (read-only, userData.cached): hex is the mean colour. See
 * facadeCovering for the kinds; opts.profile (wood), opts.module (panels).
 * @param {string} kind @param {string} hex @param {{ profile?: string, module?: number[], res?: number, roughness?: number }} [opts]
 * @returns {THREE.MeshStandardMaterial}
 */
export function facadeFinish(kind, hex, { profile = 'board-batten', module = [1.2, 2.4], res = 1, roughness } = {}) {
  const set = facadeCovering({ kind, profile, module, res });
  const rough = roughness ?? { wood: 0.85, 'deck-boards': 0.82, panels: 0.7, render: 0.95, brick: 0.9, stone: 0.85, concrete: 0.9 }[kind] ?? 0.85;
  const key = `facade|${kind}|${hex}|${set.map.uuid}|${rough}`;
  let m = _finishes.get(key);
  if (!m) {
    const color = new THREE.Color(hex).multiplyScalar(1 / set.ref);
    const mx = Math.max(color.r, color.g, color.b);
    if (mx > 1.05) color.multiplyScalar(1.05 / mx);
    const ns = { wood: 1, 'deck-boards': 1, panels: 0.6, render: 0.8, brick: 1.1, stone: 1.2, concrete: 0.6 }[kind] ?? 1;
    m = new THREE.MeshStandardMaterial({
      color,
      map: set.map,
      normalMap: set.normalMap,
      normalScale: new THREE.Vector2(ns, ns),
      roughnessMap: set.roughnessMap,
      roughness: rough / set.roughRef,
      metalness: 0,
    });
    m.name = `facade-${kind}${kind === 'wood' ? `-${profile}` : ''} ${hex}`;
    m.userData = { cached: true, kind: `facade-${kind}`, hex, finish: true, set: `${kind}|${kind === 'wood' ? profile : ''}|${kind === 'panels' ? module.join('x') : ''}|${res}` };
    _finishes.set(key, m);
  }
  return m;
}

/** Linear luminance of a '#hex' (sRGB). */
function hexLum(hex) {
  const c = new THREE.Color(hex);
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
}

/**
 * Cloud contrast for stonePanel / wetroom from a base colour and its light / dark clouds ([a, b] '#hex'), relative to
 * the stone panel's +-7.5 % (kind 'stone') or the vinyl's +-14 % (kind 'vinyl') at clouds = 1.
 * @param {string} hex @param {string[]} [cloudHexes] @param {'stone'|'vinyl'} [kind='stone']
 * @returns {number|null}  null without clouds
 */
export function cloudContrast(hex, cloudHexes, kind = 'stone') {
  if (!Array.isArray(cloudHexes) || !cloudHexes.length) return null;
  const base = hexLum(hex) || 1;
  const spread = Math.max(...cloudHexes.map((c) => Math.abs(hexLum(c) - base) / base));
  const unit = kind === 'vinyl' ? 0.14 : 0.075;
  return Math.round(Math.min(6, Math.max(0.2, spread / unit)) * 20) / 20;
}

const _finishes = new Map();

/** Finish kinds that are painted (home/materials.js paint() paints them, not this module). */
export const PAINT_FINISHES = Object.freeze(['paint', 'wetroom-paint']);

/**
 * The material of a textured finish, cached per (kind, colour, pattern): treat it as read-only and never dispose it
 * (userData.cached = true). Kinds:
 *   'stone-panel'  stonePanel (opts.panel: { size, joint '#hex', horizontalJoints }, opts.clouds)
 *   'dark-panel'   stonePanel with strong clouds (opts.clouds, default 3.5), no joints unless opts.panel is given
 *   'tiles'        tiles (opts.size, opts.grout, opts.groutColor '#hex')
 *   'vinyl' | 'wetroom'   wetroom (opts.clouds)
 *   'laminate'     stonePanel without joints, light clouds (worktops in a stone / concrete look)
 * Returns null for the painted kinds (PAINT_FINISHES) and unknown kinds - the caller paints those.
 * @param {string} kind
 * @param {string} hex      '#rrggbb' - the mean colour of the finished surface
 * @param {object} [opts]   pattern options (above) + { res, roughness }
 * @returns {THREE.MeshStandardMaterial|null}
 */
export function surfaceFinish(kind, hex, opts = {}) {
  const res = opts.res ?? 1;
  let set = null, ns = 0.6, rough = 0.62;
  const panel = opts.panel || {};
  if (kind === 'stone-panel') {
    const jointTone = panel.joint ? Math.min(1, hexLum(panel.joint) / (hexLum(hex) || 1)) : 0.87;
    set = stonePanel({ size: panel.size || [0.6, 2.4], horizontalJoints: !!panel.horizontalJoints, jointTone: Math.round(jointTone * 100) / 100, clouds: opts.clouds ?? 1, res });
    ns = 0.5;
    rough = 0.6;
  } else if (kind === 'dark-panel') {
    set = stonePanel({ size: panel.size || [0.6, 2.4], horizontalJoints: !!panel.horizontalJoints, joints: !!opts.panel, jointTone: 0.8, clouds: opts.clouds ?? 3.5, seed: 53, res });
    ns = 0.7;
    rough = 0.55;
  } else if (kind === 'tiles') {
    const groutTone = opts.groutColor ? Math.min(1, hexLum(opts.groutColor) / (hexLum(hex) || 1)) : 0.72;
    set = tiles({ size: opts.size || [0.3, 0.3], grout: opts.grout ?? 0.003, groutTone: Math.round(groutTone * 100) / 100, res });
    ns = 0.8;
    rough = 0.4;
  } else if (kind === 'vinyl' || kind === 'wetroom') {
    set = wetroom({ clouds: opts.clouds ?? 1, res });
    ns = 0.35;
    rough = 0.5;
  } else if (kind === 'laminate') {
    set = stonePanel({ joints: false, clouds: opts.clouds ?? 1.6, seed: 57, res });
    ns = 0.3;
    rough = 0.55;
  } else {
    return null;
  }
  const r = opts.roughness ?? rough;
  const key = `${kind}|${hex}|${set.map.uuid}|${r}`;
  let m = _finishes.get(key);
  if (!m) {
    const color = new THREE.Color(hex).multiplyScalar(1 / set.ref);
    const mx = Math.max(color.r, color.g, color.b);
    if (mx > 1.05) color.multiplyScalar(1.05 / mx);
    m = new THREE.MeshStandardMaterial({
      color,
      map: set.map,
      normalMap: set.normalMap,
      normalScale: new THREE.Vector2(ns, ns),
      roughnessMap: set.roughnessMap,
      roughness: r / set.roughRef,
      metalness: 0,
    });
    m.name = `${kind} ${hex}`;
    m.userData = { cached: true, kind, hex, finish: true };
    _finishes.set(key, m);
  }
  return m;
}

/**
 * The finish of a wall of layout.house (wall.material 'stone-panel' | 'dark-panel' | 'tiles' ..., colour
 * wall.paintHex, pattern from wall.panel / wall.clouds). null for painted walls ('paint', 'wetroom-paint'): paint
 * those with home/materials.js paint(wall.paintHex).
 * @param {{ material?: string, paintHex?: string, paint?: string, panel?: object, clouds?: string[] }} wall
 * @param {string} [hex]   colour override (a repaint, DesignState paints)
 * @param {{ res?: number }} [o]
 */
export function wallFinish(wall, hex, { res = 1 } = {}) {
  const kind = wall?.material || 'paint';
  if (PAINT_FINISHES.includes(kind)) return null;
  const c = hex || wall.paintHex || wall.paint || '#c8c5bf';
  if (!/^#[0-9a-f]{6}$/i.test(c)) return null;
  return surfaceFinish(kind, c, { panel: wall.panel, clouds: cloudContrast(c, wall.clouds, 'stone') ?? undefined, res });
}

/**
 * The finish of a room floor of layout.house (room.floor { material 'vinyl' | 'tiles' ..., color, clouds?: ['#a', '#b'] }).
 * null for other floor kinds (wood, concrete ...), which the room builder makes itself.
 * @param {{ material?: string, color?: string, clouds?: string[], size?: number[] }} floor
 * @param {{ res?: number }} [o]
 */
export function floorFinish(floor, { res = 1 } = {}) {
  const kind = floor?.material;
  if (kind !== 'vinyl' && kind !== 'tiles' && kind !== 'wetroom') return null;
  const hex = floor.color || '#8c8789';
  return surfaceFinish(kind, hex, { clouds: cloudContrast(hex, floor.clouds, 'vinyl') ?? undefined, size: floor.size, res });
}

/**
 * u shift that centres a panel layout on a wall of `length`: the joints then sit symmetric about the wall's middle
 * (add it to the wall geometry's u; never to texture.offset).
 * @param {number} length @param {number} [panelW=0.6]
 */
export function panelUOffset(length, panelW = 0.6) {
  const rest = ((length % panelW) + panelW) % panelW;
  return rest < 1e-6 ? 0 : (panelW - rest) / 2;
}
