// Procedural lamps and light fittings (ARCHITECTURE §5, parts §13): every pendant, ceiling lamp, floor lamp, table
// lamp and wall lamp of the game, the existing «molecule» chandelier and the built-in kitchen / TV-stue fixtures.
import * as THREE from 'three';
import schema from '../data/archetypes.json';
import * as K from './kit.js';
import { mat, emissive, shadeMaterial, resolveColor, defaultColor } from '../home/materials.js';
import { layout as roomLayout } from '../home/layout.js';

/**
 * Lamps – `archetypes` for models/registry.js plus `buildBuiltInFixture()` for the shell's built-in lights.
 *
 * Origins (ARCHITECTURE §5): ceiling lamps hang from the attachment point along −y and `params.drop` is the
 * distance ceiling → lowest point of the lamp (canopy and cord/rod follow the drop; catalogue pendants give
 * `params.dropDefault`, which is used until the user sets `drop`, and `params.maxDrop` = cable length, which caps
 * it). Floor/table lamps stand on y = 0 with the front toward +z, wall lamps have their back in z = 0 and the
 * vertical middle at y = 0.
 *
 * Parts (§13): shade (outside of the shade / glass / diffuser), inner (inside of the shade, LED faces, gold
 * reflectors), base (foot, canopy, wall plate), metal (pole, arms, frame, rods), cord.
 *
 * Lights (userData.model.lights, local coordinates): downlights in opaque domes/cylinders/tiers are spots along −y,
 * globes, translucent shades and open weaves are point lights at the bulb, uplighters are spots along +y. lumens and
 * colorK come from params.lumens / params.colorK (SceneSync overrides them with item.light) – defaults per archetype.
 * The glowing parts (bulbs, LED diffusers, translucent shades, lit shade insides) use their own emissive materials
 * (materials.emissive / shadeMaterial) and are listed in the first light's `emissiveMeshes`, so the LightManager
 * dims them with the lamp. Translucent shades (fabric, paper, opal glass, rattan) glow with the light colour times
 * the shade colour, scaled by `params.translucent` (0..1, else a default per material kind).
 *
 * Glow hue: the LightManager writes `emissive = light colour × white balance` into every lamp glow material each
 * time it recomputes, so a colour baked into `emissive` is lost in the game. The surface hue (brass insides glow gold,
 * rattan amber) and the warmth of the bulbs therefore ride in a shader multiplier (`lampGlowTint`, luminance 1 –
 * brightness stays the LightManager's – except dark fabric/paper shades, which glow less: Lamp.darkGlow), and the base
 * `emissive` carries the rest for pages without a LightManager.
 *
 * Ceiling lamps follow the ceiling: the canopy (and the cords that hang off-centre from it, e.g. long bar pendants)
 * tilt to the local slope of `home/layout.js` ceilingHeightAt wherever the lamp hangs from the room's ceiling – the
 * hanging part stays level. The model watches its own world transform (see `followCeiling`), so SceneSync,
 * Placement and its ghosts need no extra calls; off the room's ceiling (galleries) nothing tilts.
 */

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;
const UP = new THREE.Vector3(0, 1, 0);
/** Canopies and wall plates reach this far into the ceiling/wall, so sloping ceilings show no gap. */
const EMBED = 0.012;

const SEG = {
  low: { lathe: 20, rod: 6, sph: [14, 10], tube: 3, ribs: 0.6 },
  medium: { lathe: 32, rod: 8, sph: [22, 14], tube: 4, ribs: 1 },
  high: { lathe: 48, rod: 12, sph: [30, 20], tube: 6, ribs: 1.25 },
};

/** Default glow share per shade material kind (light let through), when the product gives no `translucent`. */
const TRANSLUCENCY = {
  linen: 0.5, cotton: 0.5, paper: 0.7, 'glass-opal': 0.9, 'glass-clear': 0.3, 'glass-smoked': 0.25, woven: 0.25,
  rattan: 0.3, felt: 0.12, wool: 0.2, knit: 0.25, boucle: 0.1, teddy: 0.1, velvet: 0.03, velour: 0.05, plastic: 0.45,
};
const GLASS = new Set(['glass-clear', 'glass-opal', 'glass-smoked']);
/** Powder-coated / lacquered kinds: the orange-peel texture reads as hammered metal at lamp scale → smooth. */
const SMOOTH = new Set(['black-metal', 'painted', 'plastic', 'lacquer']);
const DEFAULT_KIND = { shade: 'linen', inner: 'painted', base: 'black-metal', metal: 'black-metal', cord: 'cotton' };

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const num = (v, fb) => (typeof v === 'number' && Number.isFinite(v) ? v : fb);
const v3 = (p) => (p.isVector3 ? p.clone() : new THREE.Vector3(p[0], p[1], p[2]));

// ---------------------------------------------------------------------------------------------------------------
// Colour

/** Black-body colour of a colour temperature as sRGB [r, g, b] in 0..1. */
function kelvinRGB(k) {
  const t = clamp(k, 1000, 12000) / 100;
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
  return [r, g, b].map((v) => clamp(v / 255, 0, 1));
}

const toHex = (rgb) => `#${rgb.map((v) => Math.round(clamp(v, 0, 1) * 255).toString(16).padStart(2, '0')).join('')}`;
const fromHex = (hex) => {
  const s = resolveColor(hex, '#ffffff');
  return [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16) / 255);
};

/** Linear-sRGB [r, g, b] of a colour ('#hex' or a palette name). */
function linearRGB(hex) {
  const c = new THREE.Color(resolveColor(hex, '#ffffff'));
  return [c.r, c.g, c.b];
}
const lum709 = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

/**
 * Hue of a linear colour at luminance 1: `sat` = share of its saturation kept (in log space, 1 = all of it).
 * Greys and blacks give white (no tint).
 */
function hueOf(c, sat = 1) {
  const L = lum709(c);
  if (!(L > 0.003)) return [1, 1, 1];
  const n = c.map((v) => Math.max(0.02, v / L) ** sat);
  const k = 1 / lum709(n);
  return n.map((v) => v * k);
}

/** Saturation kept by the glow of a surface: metals reflect their own colour, fabrics/glass scatter toward white. */
const METAL_HUE = new Set(['brass', 'bronze', 'copper']);
const GLOW_SAT = { metal: 1, other: 0.6 };
/** Linear luminance from which a translucent shade glows fully (≈ sRGB #959595); darker ones glow less (darkGlow). */
const DARK_GLOW_LUM = 0.3;
/** Warmth kept by visible bulbs/LED faces under the game's white balance (share of the colour temperature's hue). */
const BULB_WARMTH = 0.45;

/**
 * Multiplies a glow material's emitted light by a colour in the shader (after the emissive map). The LightManager
 * overwrites `material.emissive` with the light colour, so this is where a surface hue (and a dark shade's lower
 * level, Lamp.glowHue) survives. One program for all
 * tinted lamp glows (shared cache key), the colour is a per-material uniform.
 */
function tintGlow(m, rgb) {
  if (!m || !rgb || rgb.every((v) => Math.abs(v - 1) < 0.04)) return m; // near-white: no extra program variant
  const u = { value: new THREE.Color(rgb[0], rgb[1], rgb[2]) };
  m.userData.glowTint = u.value;
  m.onBeforeCompile = (sh) => {
    sh.uniforms.lampGlowTint = u;
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 lampGlowTint;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n\ttotalEmissiveRadiance *= lampGlowTint;');
  };
  m.customProgramCacheKey = () => 'lamp-glow-tint-v1';
  return m;
}

// ---------------------------------------------------------------------------------------------------------------
// Geometry helpers (all in metres, metre UVs from the kit)

const _m4 = new THREE.Matrix4();
const _q = new THREE.Quaternion();

/** Bakes a transform into a geometry. p = position, q = quaternion or [rx, ry, rz], s = number | [sx, sy, sz]. */
function xf(geo, p = [0, 0, 0], q = null, s = null) {
  const quat = q == null ? new THREE.Quaternion() : q.isQuaternion ? q : new THREE.Quaternion().setFromEuler(new THREE.Euler(q[0], q[1], q[2]));
  const scale = s == null ? new THREE.Vector3(1, 1, 1) : Array.isArray(s) ? new THREE.Vector3(s[0], s[1], s[2]) : new THREE.Vector3(s, s, s);
  geo.applyMatrix4(_m4.compose(v3(p), quat, scale));
  return geo;
}

/** Quaternion turning +y into dir. */
function aim(dir) {
  return new THREE.Quaternion().setFromUnitVectors(UP, v3(dir).normalize());
}

/** Cylinder from a to b (radius r, or r → rb). */
function rod(a, b, r, seg = 8, rb = r) {
  const A = v3(a), B = v3(b);
  const dir = B.clone().sub(A);
  const len = Math.max(1e-4, dir.length());
  const g = K.cylinder(rb, r, len, { seg, center: true });
  return xf(g, A.add(B).multiplyScalar(0.5), aim(dir));
}

/** Flat bar (box) from a to b: width along `side` (made perpendicular), thickness across. */
function bar(a, b, width, thick, side = [1, 0, 0]) {
  const A = v3(a), B = v3(b);
  const y = B.clone().sub(A);
  const len = Math.max(1e-4, y.length());
  y.normalize();
  const x = v3(side).addScaledVector(y, -v3(side).dot(y));
  if (x.lengthSq() < 1e-8) x.set(1, 0, 0).addScaledVector(y, -y.x);
  x.normalize();
  const z = new THREE.Vector3().crossVectors(x, y).normalize();
  const g = K.box(width, len, thick, { grain: 'y' });
  _m4.makeBasis(x, y, z).setPosition(A.add(B).multiplyScalar(0.5));
  return g.applyMatrix4(_m4);
}

/** Profile offset inward (against the lathe's outward normal) by t. */
function offsetProfile(prof, t) {
  const n = prof.length;
  return prof.map((p, i) => {
    const a = prof[Math.max(0, i - 1)], b = prof[Math.min(n - 1, i + 1)];
    const dr = b[0] - a[0], dy = b[1] - a[1];
    const len = Math.hypot(dr, dy) || 1;
    return [Math.max(0, p[0] - (dy / len) * t), p[1] + (dr / len) * t];
  });
}

/**
 * Thin shell of revolution: outer surface (normals out), inner surface (normals in) and rims at the open ends.
 * prof = [[r, y], …] bottom → top. mod(phi, y) → radial factor (flutes, pleats, lobes).
 */
function shell(prof, t, seg, { phiStart = 0, phiLength = TAU, rimBottom = true, rimTop = true, mod = null } = {}) {
  const o = { seg, phiStart, phiLength };
  const inner = offsetProfile(prof, t);
  const out = { outer: K.lathe(prof, o), inner: K.lathe([...inner].reverse(), o), rims: [] };
  const n = prof.length - 1;
  if (rimBottom && prof[0][0] > 2e-3) out.rims.push(K.lathe([inner[0], prof[0]], o));
  if (rimTop && prof[n][0] > 2e-3) out.rims.push(K.lathe([prof[n], inner[n]], o));
  if (mod) for (const g of [out.outer, out.inner, ...out.rims]) modulate(g, mod);
  return out;
}

/** Radial modulation of a lathe-like geometry around y: r *= fn(phi, y). */
function modulate(geo, fn) {
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const f = fn(Math.atan2(x, z), pos.getY(i));
    pos.setXYZ(i, x * f, pos.getY(i), z * f);
  }
  pos.needsUpdate = true;
  K.smoothNormals(geo);
  return geo;
}

/** Rounded disc (canopy / foot) of diameter d and height h, from y = y0 up. */
function discGeo(d, h, seg, { y0 = 0, round = 0.004, top = true } = {}) {
  const r = d / 2, e = Math.min(round, h / 2, r / 3);
  const prof = [[0.0005, y0], [r - e, y0], [r - e * 0.3, y0 + e * 0.3], [r, y0 + e], [r, y0 + h - e]];
  if (top) prof.push([r - e * 0.3, y0 + h - e * 0.3], [r - e, y0 + h], [0.0005, y0 + h]);
  else prof.push([r, y0 + h]);
  return K.lathe(prof, { seg });
}

/** Points of a cubic Bézier in 2D/3D. */
function bezier(p0, p1, p2, p3, n) {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, u = 1 - t;
    const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
    out.push(p0.map((_, k) => a * p0[k] + b * p1[k] + c * p2[k] + d * p3[k]));
  }
  return out;
}

/**
 * Scale f and centre m along axis a so that the balls ({ p: [x,y,z], r }) placed at (p − m)·f span exactly `size`
 * between their outer surfaces. A few rounds: the outermost balls can change with f.
 */
function fitBalls(balls, a, size, bd) {
  let f = Math.max(0.01, size / 2 - bd / 2), m = 0;
  for (let it = 0; it < 4; it++) {
    let hi = null, lo = null;
    for (const b of balls) {
      if (!hi || b.p[a] * f + b.r > hi.p[a] * f + hi.r) hi = b;
      if (!lo || b.p[a] * f - b.r < lo.p[a] * f - lo.r) lo = b;
    }
    const span = hi.p[a] - lo.p[a];
    if (span < 1e-6) return { f: 1, m: hi.p[a] };
    f = Math.max(0.005, (size - hi.r - lo.r) / span);
    m = hi.p[a] - (size / 2 - hi.r) / f;
  }
  return { f, m };
}

/** Evenly spread directions on a sphere (Fibonacci). */
function fibonacci(n) {
  const out = [];
  const g = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - (2 * (i + 0.5)) / n;
    const r = Math.sqrt(1 - y * y);
    out.push([Math.cos(g * i) * r, y, Math.sin(g * i) * r]);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Build context

/** Per-build helper: parts → materials, glow materials, meshes, lights, finishing. */
class Lamp {
  constructor(id, spec) {
    this.id = id;
    this.spec = spec;
    this.dims = spec.dims;
    this.P = spec.params || {};
    this.C = spec.colors || {};
    this.M = spec.materials || {};
    this.q = SEG[spec.quality] || SEG.medium;
    this.g = new THREE.Group();
    this.g.name = id;
    this.glowRoot = new THREE.Group();
    this.lights = [];
    this.colliders = [];
    this.colorK = num(this.P.colorK, 2700);
    this.kc = kelvinRGB(this.colorK);
    this._mats = new Map();
    this._castMats = new Set();
    /** Ceiling lamps: the canopy's group (tilted to the ceiling slope) and the cords that hang off-centre from it. */
    this.canopyRoot = null;
    this.hangers = [];
    /** Glowing pools on the ceiling (in the canopy group; dimmed with the lamp, shown only under the room's ceiling). */
    this.ceilingDecals = [];
  }

  /** Group the canopy meshes go into (created on first use; kept out of the model-wide merge so it can tilt). */
  canopyGroup() {
    if (!this.canopyRoot) {
      this.canopyRoot = new THREE.Group();
      this.canopyRoot.name = 'canopy';
      this.canopyRoot.userData.noMerge = true;
      this.g.add(this.canopyRoot);
    }
    return this.canopyRoot;
  }

  /**
   * Hue a part's glow takes on (its surface colour, linear), at luminance 1 – or less for a dark fabric/paper shade:
   * black cloth lets little light through and reflects little inside, so a lit black shade stays dark instead of
   * glowing as bright as a white one (the LightManager sets the level from the lumens alone).
   */
  glowHue(part) {
    const sat = METAL_HUE.has(this.kind(part)) ? GLOW_SAT.metal : GLOW_SAT.other;
    const hue = hueOf(linearRGB(this.hex(part)), sat);
    const f = this.darkGlow(part);
    return f < 1 ? hue.map((v) => v * f) : hue;
  }

  /**
   * Glow share of a dark translucent (fabric, paper, rattan …) part: the light it passes / reflects follows its albedo,
   * so 1 from light-mid tones up (linear luminance ≥ DARK_GLOW_LUM), ≈ 0.4 for brown linen, ≈ 0.06 for black.
   */
  darkGlow(part) {
    const k = this.kind(part);
    if (!(k in TRANSLUCENCY) || GLASS.has(k)) return 1;
    return clamp(lum709(linearRGB(this.hex(part))) / DARK_GLOW_LUM, 0.04, 1);
  }

  kind(part) {
    return this.M[part] || DEFAULT_KIND[part] || 'plastic';
  }

  hex(part) {
    return resolveColor(this.C[part], defaultColor(this.kind(part)));
  }

  isGlass(part) {
    return GLASS.has(this.kind(part));
  }

  /** Cached material of a part. */
  mat(part, opts) {
    return mat(this.kind(part), this.hex(part), this.kindOpts(part, opts));
  }

  /** Per-kind options: smooth lacquer, more opaque tinted glass. */
  kindOpts(part, opts) {
    const k = this.kind(part);
    if (k === 'black-metal') return { flat: true, roughness: 0.62, ...(opts || {}) };
    if (SMOOTH.has(k)) return { flat: true, ...(opts || {}) };
    return this.glassOpts(part, opts);
  }

  /** Tinted clear glass reads too pale at the stock opacity: more opacity for coloured glass. */
  glassOpts(part, opts) {
    const k = this.kind(part);
    if (k !== 'glass-clear') return opts;
    const [r, g, b] = fromHex(this.hex(part));
    const lum = 0.3 * r + 0.55 * g + 0.15 * b;
    const sat = Math.max(r, g, b) - Math.min(r, g, b);
    if (lum > 0.82 && sat < 0.08) return opts;
    return { opacity: +clamp(0.22 + 0.32 * (1 - lum) + 0.25 * sat, 0.25, 0.6).toFixed(2), ...(opts || {}) };
  }

  /** Light share the shade lets through (0..1). */
  translucency(part = 'shade') {
    if (part === 'shade' && this.P.translucent != null) return clamp(num(this.P.translucent, 0), 0, 1);
    return TRANSLUCENCY[this.kind(part)] ?? 0;
  }

  /** Light colour after passing through / bouncing off a part ('#hex'). */
  tint(part) {
    const c = fromHex(this.hex(part));
    // light colour × surface colour, renormalised a little so mid-tone shades still glow warm
    const lum = 0.3 * c[0] + 0.55 * c[1] + 0.15 * c[2];
    const boost = lum > 0.05 ? Math.min(1.6, 0.75 / lum) ** 0.35 : 1;
    // a lit shade looks warm white in the middle, not orange: the light colour is lifted toward white
    return toHex(this.kc.map((k, i) => (k * 0.5 + 0.5) * c[i] * boost));
  }

  /** New glowing material of a part (shared within this build). */
  glow(part, intensity, opts = {}) {
    const key = `${part}|${intensity.toFixed(3)}|${JSON.stringify(opts)}`;
    let m = this._mats.get(key);
    if (!m) {
      m = shadeMaterial(this.kind(part), this.hex(part), { glow: this.tint(part), intensity, ...this.kindOpts(part, opts) });
      this.hueGlow(m, this.glowHue(part));
      this._mats.set(key, m);
    }
    return m;
  }

  /**
   * Moves the hue of a glow material's emissive into the shader tint (survives the LightManager, which sets the
   * emissive colour itself); the base emissive keeps the rest, so the look without a LightManager is unchanged.
   */
  hueGlow(m, hue) {
    if (!m?.emissive || hue.every((v) => Math.abs(v - 1) < 0.04)) return m;
    m.emissive.setRGB(...[m.emissive.r, m.emissive.g, m.emissive.b].map((v, i) => v / hue[i]));
    return tintGlow(m, hue);
  }

  /** Glow of the shade outside: translucency × gain (0 → the plain cached material, nothing glows). */
  shadeMat(part = 'shade', gain = 1.4, opts) {
    const t = this.translucency(part);
    return t > 0.02 ? this.glow(part, t * gain, opts) : this.mat(part, opts);
  }

  /** Inside of a shade: lit by the bulb (reflection), plus transmission for translucent shades. */
  innerMat(part = 'inner', base = 0.55, opts) {
    const t = this.translucency(part === 'inner' ? 'shade' : part);
    return this.glow(part, base + t * 0.9, opts);
  }

  /** Bulb / LED material (one per build, dimmed by the LightManager). */
  bulbMat(intensity = 4, warmth = BULB_WARMTH) {
    const key = `bulb|${intensity}|${warmth}`;
    let m = this._mats.get(key);
    if (!m) {
      const k = this.kc;
      m = emissive(toHex(k.map((v) => v * 0.55 + 0.45)), intensity, { color: '#f4efe6' });
      // a visible 2700 K bulb reads amber in the photos, not the white the room's white balance would make of it
      tintGlow(m, hueOf(linearRGB(toHex(k)), warmth));
      this._mats.set(key, m);
    }
    return m;
  }

  /** Normal mesh (merged by material + part in finish()). */
  add(geo, material, part, o) {
    const m = K.partMesh(geo, material, part, o);
    this.g.add(m);
    return m;
  }

  /** Glowing mesh: dimmed with the lamp, merged per material in finish(). castShadow: fabric shades still cast. */
  glowAdd(geo, material, part, { castShadow = false, ...o } = {}) {
    const m = K.partMesh(geo, material, part, o);
    if (castShadow) this._castMats.add(material);
    this.glowRoot.add(m);
    return m;
  }

  /** Adds a part mesh that glows when its material is a glow material. */
  auto(geo, material, part, o = {}) {
    return material.userData?.kind === 'emissive' ? this.glowAdd(geo, material, part, { castShadow: !material.transparent, ...o }) : this.add(geo, material, part, o);
  }

  /** Glowing bulb: 'globe' (opal), 'filament' (clear glass + glowing filament), 'led' (flat disc facing `dir`). */
  bulb(type, pos, size = 0.03, { dir = [0, -1, 0], intensity, warmth } = {}) {
    const [w, h] = this.q.sph;
    const p = v3(pos);
    if (type === 'led') {
      const g = new THREE.CircleGeometry(size, Math.max(12, w));
      // CircleGeometry faces +z: turn it to face dir
      g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), v3(dir).normalize()));
      g.translate(p.x, p.y, p.z);
      return this.glowAdd(g, this.bulbMat(intensity ?? 3, warmth), null);
    }
    if (type === 'filament') {
      this.add(xf(K.sphere(size, { wSeg: w, hSeg: h }), p), mat('glass-clear', '#ffffff'), null);
      const f = rod([p.x, p.y - size * 0.45, p.z], [p.x, p.y + size * 0.45, p.z], Math.max(0.0015, size * 0.07), 6);
      this.glowAdd(f, this.bulbMat(intensity ?? 7, warmth), null);
      return this.glowAdd(xf(K.sphere(size * 0.22, { wSeg: 10, hSeg: 6 }), p, null, [1, 2.2, 1]), this.bulbMat(intensity ?? 7, warmth), null);
    }
    const [bw, bh] = size < 0.035 ? [Math.min(w, 14), Math.min(h, 10)] : [w, h];
    return this.glowAdd(xf(K.sphere(size, { wSeg: bw, hSeg: bh }), p), this.bulbMat(intensity ?? 4, warmth), null);
  }

  /** Socket (lamp holder) above a bulb: a small cylinder from y0 up to y1. */
  socket(x, y0, y1, z = 0, r = 0.015, part = 'metal') {
    if (y1 - y0 > 1e-3) this.add(K.cylinder(r, r, y1 - y0, { seg: this.q.rod + 4 }).translate(x, y0, z), this.mat(part), part);
  }

  point(pos, lumens, extra) {
    this.lights.push({ ...K.pointLight(pos, { lumens, colorK: this.colorK }), ...extra });
  }

  spot(pos, dir, lumens, angle = 0.8, penumbra = 0.7) {
    this.lights.push(K.spotLight(pos, dir, { angle: clamp(angle, 0.15, 1.45), penumbra, lumens, colorK: this.colorK }));
  }

  /** params.lumens or a default. */
  lumens(def) {
    return Math.max(1, num(this.P.lumens, def));
  }

  /** Merges, finishes and returns the model group. */
  finish() {
    K.mergeSameMaterial(this.glowRoot);
    const glowing = [...this.glowRoot.children];
    for (const m of glowing) {
      m.userData.noMerge = true;
      this.g.add(m);
    }
    if (this.lights.length) this.lights[0].emissiveMeshes = [...glowing, ...this.ceilingDecals];
    K.finishModel(this.g, { lights: this.lights, colliders: this.colliders.length ? this.colliders : undefined, recolor: () => false });
    // translucent fabric/paper shades glow but are still solid: they cast shadows in the sun
    for (const m of glowing) {
      if (this._castMats.has(m.material) && !m.material.transparent) m.castShadow = true;
    }
    if (this.canopyRoot && this.P.followCeiling !== false) followCeiling(this);
    return this.g;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Ceiling slope

/** Steepest ceiling slope a canopy follows (tan 25°); steeper one-sided differences are steps (bulkheads). */
const MAX_SLOPE = 0.47;

/**
 * The room's ceiling at a lamp's attachment point: null when the point is not on it (the lamp is shown elsewhere,
 * e.g. in the model gallery), else { slope: [dh/dx, dh/dz] } (0, 0 where flat). One-sided differences, the gentler
 * side wins, so the edge of a bulkhead does not read as a slope.
 */
function ceilingAt(x, y, z) {
  const hc = roomLayout?.ceilingHeightAt;
  if (typeof hc !== 'function') return null;
  // the ceiling of the level the lamp hangs in (a point half a metre under its attachment picks the level, §1.8):
  // with the y argument layout.ceilingHeightAt answers for the whole house (world y), the living room as before
  const yq = y - 0.5;
  const h = (px, pz) => hc(px, pz, yq);
  const h0 = h(x, z);
  if (!Number.isFinite(h0) || Math.abs(y - h0) > 0.03) return null;
  const e = 0.1;
  const pick = (a, b) => {
    const s = Math.abs(a) <= Math.abs(b) ? a : b;
    return Number.isFinite(s) && Math.abs(s) <= MAX_SLOPE && Math.abs(s) > 1e-4 ? s : 0;
  };
  return { slope: [pick((h(x + e, z) - h0) / e, (h0 - h(x - e, z)) / e), pick((h(x, z + e) - h0) / e, (h0 - h(x, z - e)) / e)] };
}

/**
 * Keeps a ceiling lamp's canopy flush with a sloping ceiling: whenever the model's world transform changes
 * (SceneSync.placeObject, Placement ghosts, drags), the canopy group is turned onto the local ceiling plane and the
 * off-centre cords (L.hangers) are re-cut to reach the tilted canopy's underside. The hanging part stays level.
 * Glow decals on the ceiling (L.ceilingDecals, in the canopy group) show only while the lamp hangs from the room's
 * ceiling. Implemented as an override of the root's updateMatrixWorld (runs in every scene update, but only does
 * work when the root moved or turned); `userData.model.ceilingTilt` = { su, sv } = slope along local x / z.
 */
function followCeiling(L) {
  const g = L.g, root = L.canopyRoot, hangers = L.hangers, decals = L.ceilingDecals;
  const base = THREE.Object3D.prototype.updateMatrixWorld;
  const last = [NaN, NaN, NaN, NaN, NaN];
  const n = new THREE.Vector3();
  let tilted = false;
  g.userData.model.ceilingTilt = { su: 0, sv: 0 };
  g.updateMatrixWorld = function updateMatrixWorld(force) {
    base.call(this, force);
    const e = this.matrixWorld.elements;
    const key = [e[12], e[13], e[14], e[0], e[2]];
    if (key.every((v, i) => v === last[i])) return;
    key.forEach((v, i) => (last[i] = v));
    let su = 0, sv = 0;
    const c = ceilingAt(e[12], e[13], e[14]);
    // no pools on Placement's translucent ghost (SceneSync.buildGhost marks it), only on the hung lamp
    for (const d of decals) d.visible = !!c && !this.userData.ghost;
    if (c) {
      // local x and z axes in the plan
      const s = c.slope;
      const lx = Math.hypot(e[0], e[2]) || 1, lz = Math.hypot(e[8], e[10]) || 1;
      su = (s[0] * e[0] + s[1] * e[2]) / lx;
      sv = (s[0] * e[8] + s[1] * e[10]) / lz;
    }
    if (!tilted && su === 0 && sv === 0) return;
    tilted = su !== 0 || sv !== 0;
    // canopy top on the plane y = su·x + sv·z (local), its underside offset by ch along the plane's normal
    root.quaternion.setFromUnitVectors(UP, n.set(-su, 1, -sv).normalize());
    root.updateMatrixWorld(true);
    const N = Math.hypot(1, su, sv);
    for (const hg of hangers) {
      const top = su * hg.x + sv * hg.z - hg.ch * N;
      hg.mesh.scale.y = Math.max(1e-3, top - hg.yBottom);
      hg.mesh.updateMatrixWorld(true);
    }
    this.userData.model.ceilingTilt = { su, sv };
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Shared pieces

/**
 * Ceiling drop: params.drop (or the catalogue's dropDefault while drop is still the archetype default), capped by
 * params.maxDrop (cable length) and at least `min`.
 */
function dropOf(L, defDrop, min) {
  const P = L.P;
  let d = num(P.drop, NaN);
  if (num(P.dropDefault, NaN) > 0 && (!Number.isFinite(d) || Math.abs(d - defDrop) < 1e-6)) d = P.dropDefault;
  if (!Number.isFinite(d)) d = defDrop;
  if (num(P.maxDrop, 0) > 0) d = Math.min(d, P.maxDrop);
  return Math.max(min, d);
}

/** Ceiling canopy at y = 0 (part base): 'disc' | 'cone' | 'bar' | 'track' (adapter under a ceiling track). Returns its height. */
function canopy(L, { shape = 'disc', d = 0.1, h = 0.025, len = 0.3, part = 'base' } = {}) {
  const seg = L.q.lathe;
  const m = L.mat(part);
  if (shape === 'track') {
    // adapter clipped into a 35 mm surface track (the track itself belongs to the shell; it does not tilt)
    L.add(K.roundedBox(0.03, 0.022, 0.028, 0.003, 1).translate(0, -0.035 - 0.011, 0), m, part);
    return 0.057;
  }
  if (shape === 'none') return 0;
  // the canopy sits in its own group, so it can be tilted onto a sloping ceiling (followCeiling)
  const add = (geo) => L.canopyGroup().add(K.partMesh(geo, m, part));
  if (shape === 'cone') add(K.lathe([[0.006, -h], [d * 0.12, -h], [d / 2, -0.004], [d / 2, EMBED]], { seg }));
  else if (shape === 'bar') add(K.roundedBox(len, h + EMBED, d, Math.min(0.004, h / 3), 2, { grain: 'x' }).translate(0, (EMBED - h) / 2, 0));
  else add(discGeo(d, h + EMBED, seg, { y0: -h }));
  return h;
}

/** Soft round falloff (1 in the middle → 0 at the rim) as a texture, shared by every ceiling pool. */
let _poolTex = null;
function poolTexture() {
  if (_poolTex) return _poolTex;
  const n = 64;
  const data = new Uint8Array(n * n * 4);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const dx = (i + 0.5) / n * 2 - 1, dy = (j + 0.5) / n * 2 - 1;
      const r2 = Math.min(1, dx * dx + dy * dy);
      // a lit pool: gaussian core with a long soft tail that reaches 0 at the rim (no visible decal edge)
      const v = Math.round(255 * Math.max(0, (Math.exp(-4.5 * r2) - Math.exp(-4.5)) / (1 - Math.exp(-4.5))));
      data.set([v, v, v, 255], (j * n + i) * 4);
    }
  }
  _poolTex = new THREE.DataTexture(data, n, n, THREE.RGBAFormat);
  _poolTex.colorSpace = THREE.NoColorSpace;
  _poolTex.magFilter = THREE.LinearFilter;
  _poolTex.minFilter = THREE.LinearFilter;
  _poolTex.needsUpdate = true;
  _poolTex.userData.shared = true;
  return _poolTex;
}

/**
 * The material of a light decal (a ceiling pool, a picture light's wash on the wall): light on a surface, not a
 * surface. `kc` = the lamp's light colour (sRGB [r, g, b] in 0..1, Lamp.kc), `nits` = nominal luminance in the middle
 * of `map` for a lamp of `lumens` (the fixture total: the LightManager scales glows by it). Every decal shares one
 * program (customProgramCacheKey 'lamp-ceiling-pool-v1') whatever its map.
 */
function lightDecalMaterial(kc, nits, lumens, map = poolTexture()) {
  const m = emissive(toHex(kc), nits / (EMISSIVE_NITS * clamp(Math.sqrt(lumens / 800), 0.6, 2.2)), { color: '#000000' });
  m.emissiveMap = map;
  m.roughness = 1;
  m.envMapIntensity = 0;
  m.transparent = true;
  m.depthWrite = false;
  // more light on the ceiling = the ceiling's own colour × (1 + pool): result = dst · src + dst (the pool tints it warm)
  m.blending = THREE.CustomBlending;
  m.blendEquation = THREE.AddEquation;
  m.blendSrc = THREE.DstColorFactor;
  m.blendDst = THREE.OneFactor;
  m.polygonOffset = true;
  m.polygonOffsetFactor = -2;
  // The decal must change nothing outside the pool: unlit (only the emission) and not tone-mapped (AgX lifts black a
  // little, which drew the decal's disc). The LightManager drives it linearly with the lamp's dimmer (no glow floor,
  // no √ curve: it is light on the ceiling, not a bulb), × 1.6 for the map; the level is set in the shader (POOL_GAIN,
  // matched to 082806 / 083012).
  const gain = { value: POOL_GAIN };
  m.toneMapped = false;
  m.onBeforeCompile = (sh) => {
    sh.uniforms.lampPoolGain = gain;
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float lampPoolGain;')
      .replace('#include <opaque_fragment>', 'outgoingLight = totalEmissiveRadiance * lampPoolGain;\n#include <opaque_fragment>');
  };
  m.customProgramCacheKey = () => 'lamp-ceiling-pool-v1';
  m.userData.poolGain = gain;
  return m;
}

/**
 * Warm pool of light on the ceiling around (x, z) (local, ceiling plane y = 0): a glow decal in the canopy group (so it
 * lies on a sloping ceiling too) that brightens the ceiling under it, dimmed with the lamp by the LightManager.
 * `nits` = nominal luminance in the middle for a lamp of `lumens` (the fixture total: the LightManager scales glows by
 * it). A budget-free stand-in for an upward spot (item lights compete for a few light slots and lose them from a
 * distance).
 */
function ceilingPool(L, x, z, R, nits, lumens) {
  const m = lightDecalMaterial(L.kc, nits, lumens);
  const g = new THREE.CircleGeometry(R, 40).rotateX(Math.PI / 2).translate(x, -0.002, z); // faces down
  g.computeBoundingSphere(); // frustum culling: the real extent
  // the pool is light, not part of the fixture: not in its bounds (SceneSync.objectBounds, Placement), not clickable,
  // not outlined on hover
  g.boundingBox = new THREE.Box3(new THREE.Vector3(), new THREE.Vector3());
  const mesh = K.partMesh(g, m, null, { name: 'ceiling-pool' });
  mesh.raycast = () => {};
  mesh.userData.noHighlight = true;
  mesh.userData.noCollide = true;
  mesh.userData.noShadow = true;
  mesh.visible = false; // followCeiling shows it under the room's ceiling
  L.canopyGroup().add(mesh);
  L.ceilingDecals.push(mesh);
  return mesh;
}
/** LightManager: glow `baseIntensity` 1 ≈ this many nits for an 800 lm lamp (EMISSIVE_NITS_PER_UNIT there). */
const EMISSIVE_NITS = 150;
/** Level of the ceiling pools against their nominal luminance (see ceilingPool). */
const POOL_GAIN = 0.06;

/** Cord (or rod) from y1 down to y0 at (x, z). */
function cord(L, x, z, yTop, yBottom, { r = 0.0028, part = 'cord' } = {}) {
  if (yTop - yBottom < 1e-3) return;
  L.add(K.cylinder(r, r, yTop - yBottom, { seg: L.q.rod }).translate(x, yBottom, z), L.mat(part), part);
}

/**
 * Cord hanging off-centre from a canopy of height `ch` (bar canopies): its top follows the canopy when that tilts
 * onto a sloping ceiling (followCeiling re-cuts it), so it never starts in the ceiling or in mid-air. Unit-height
 * cylinder scaled along y, kept out of the merge.
 */
function hanger(L, x, z, ch, yBottom, { r = 0.0028, part = 'cord' } = {}) {
  const len = -ch - yBottom;
  if (len < 1e-3) return;
  const m = K.partMesh(K.cylinder(r, r, 1, { seg: L.q.rod }), L.mat(part), part, { position: [x, yBottom, z], scale: [1, len, 1], noMerge: true });
  L.g.add(m);
  L.hangers.push({ mesh: m, x, z, ch, yBottom });
}

/** Round foot on the floor/table (part base), returns its height. */
function footDisc(L, d, h = 0.025) {
  L.add(discGeo(d, h, L.q.lathe), L.mat('base'), 'base');
  return h;
}

/** Low dome foot (Valencia, Rocks Xo table). */
function footDome(L, d, h) {
  const r = d / 2;
  const prof = [[0.0005, 0], [r, 0], [r, h * 0.12]];
  for (let i = 1; i <= 8; i++) {
    const a = (i / 8) * (Math.PI / 2);
    prof.push([Math.max(0.006, r * Math.cos(a)), h * 0.12 + h * 0.88 * Math.sin(a)]);
  }
  L.add(K.lathe(prof, { seg: L.q.lathe }), L.mat('base'), 'base');
  return h;
}

/**
 * Drum / cylinder / cone shade (fabric or paper): outer + inner + rims + the wire spider at the top and a bulb.
 * `profile` ([[r, y], …] bottom → top, ending at (Rtop, yb + H)) replaces the straight taper (empire shades).
 * Returns the bulb position.
 */
function drumShade(L, { R, Rtop = R, H, yb, x = 0, z = 0, mod = null, seg = L.q.lathe, spider = true, closedTop = false, bulb = 'globe', bulbR = 0.03, profile = null }) {
  const t = 0.0025;
  const prof = profile ? profile.map((p) => [p[0], p[1]]) : [[R, yb]];
  // slight barrel for tall drums looks wrong – straight walls, two intermediate points for the taper
  if (!profile) prof.push([R + (Rtop - R) * 0.5, yb + H * 0.5], [Rtop, yb + H]);
  const s = shell(prof, t, seg, { mod });
  const o = L.shadeMat('shade', 1.1);
  const i = L.innerMat('inner', 0.45);
  for (const g of [s.outer, ...s.rims]) L.auto(g.translate(x, 0, z), o, 'shade');
  L.auto(s.inner.translate(x, 0, z), i, 'inner');
  if (closedTop) {
    // fabric lid: outside up, inside down (no glare from above)
    L.auto(new THREE.CircleGeometry(Rtop - 0.0005, seg).rotateX(-Math.PI / 2).translate(x, yb + H, z), o, 'shade');
    L.auto(new THREE.CircleGeometry(Rtop - t, seg).rotateX(Math.PI / 2).translate(x, yb + H - t, z), i, 'inner');
  }
  // wire rings that hold the fabric (visible at the edges) and the spider
  const ring = Math.max(0.0012, Math.min(0.002, R * 0.01));
  const wire = L.mat('metal');
  if (spider) {
    const yTop = yb + H - 0.004;
    const hub = 0.016;
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * TAU + 0.5;
      const rr = Rtop - t - 0.002;
      L.add(rod([x + Math.sin(a) * hub, yTop - 0.01, z + Math.cos(a) * hub], [x + Math.sin(a) * rr, yTop, z + Math.cos(a) * rr], ring, 4), wire, 'metal');
    }
    L.add(K.torus(hub, 0.0025, { radial: 6, tubular: 16 }).rotateX(Math.PI / 2).translate(x, yTop - 0.01, z), wire, 'metal');
  }
  const by = yb + H * 0.42;
  if (bulb) L.bulb(bulb, [x, by, z], Math.min(bulbR, R * 0.35));
  return [x, by, z];
}

/**
 * drumShade options for a pleated (plissé) shade of `n` pleats: a zigzag around the shade, two lathe segments per pleat
 * (crest and fold), about 1 cm deep.
 */
function pleatOpts(L, n, R) {
  const amp = clamp(0.011 / Math.max(0.05, R), 0.02, 0.07);
  return {
    seg: Math.max(L.q.lathe, n * 2),
    mod: (phi) => {
      const u = (((n * phi) / TAU) % 1 + 1) % 1;
      return 1 + amp * (Math.abs(2 * u - 1) * 2 - 1);
    },
  };
}

/**
 * Woven rattan / wicker shade (drum or tapered, R → Rtop): one open-weave surface that glows where the light shines
 * through the gaps, with a hoop at each rim. Returns the bulb position.
 */
function wovenShade(L, { R, Rtop = R, H, yb }) {
  const seg = L.q.lathe;
  const prof = [[R, yb], [(R + Rtop) / 2 + Math.min(R, Rtop) * 0.03, yb + H * 0.5], [Rtop, yb + H]];
  const open = /woven|rattan/.test(L.kind('shade'));
  const kind = open ? 'rattan' : L.kind('shade');
  const opts = open ? { open: true, scale: 3.5, side: 'double' } : { side: 'double' };
  const t = L.translucency();
  const m = L.hueGlow(shadeMaterial(kind, L.hex('shade'), { glow: L.tint('shade'), intensity: 0.12 + t * 0.6, ...opts }), L.glowHue('shade'));
  L.glowAdd(K.lathe(prof, { seg }), m, 'shade', { castShadow: true });
  const band = L.mat('shade', { roughness: 0.6 });
  for (const [r, y] of [prof[0], prof[2]]) L.add(K.torus(r, 0.0045, { radial: 6, tubular: seg }).rotateX(Math.PI / 2).translate(0, y, 0), band, 'shade');
  const by = yb + H * 0.45;
  L.bulb('filament', [0, by, 0], 0.03);
  return [0, by, 0];
}

/**
 * Paper lantern (rice paper on a wire spiral, Akari-like): an ellipsoid Ø 2R × H from yb up with openings of radius
 * rBottom (the pole) and rTop, shallow horizontal ribs every ≈ 2.5 cm (or `ribs`). `organic` (Ferm Living Kurbis): a
 * pear shape, widest low, bulging more to one side, with crinkled paper. `stepsPerRib` / `seg` = profile points per rib
 * and segments around (small table lanterns use fewer). Returns the bulb position.
 */
function lanternShade(L, { R, H, yb, ribs = 0, rBottom = 0, rTop = 0, organic = false, stepsPerRib = 3, seg = Math.max(L.q.lathe, 36) }) {
  const n = ribs > 2 ? Math.round(ribs) : Math.max(6, Math.round(H / 0.025));
  const steps = n * stepsPerRib;
  const rOpen = clamp(rBottom || Math.min(0.045, R * 0.3), 0.01, R * 0.8);
  const a0 = Math.asin(rOpen / R), a1 = Math.PI - Math.asin(clamp(rTop || Math.min(0.035, R * 0.22), 0.01, R * 0.8) / R);
  const prof = [];
  for (let i = 0; i <= steps; i++) {
    const a = a0 + ((a1 - a0) * i) / steps;
    let r = R * Math.sin(a), u = (1 - Math.cos(a)) / 2;
    // pear: the widest part pulled down to ≈ 40 % of the height, the top narrower
    if (organic) r *= 1 - 0.22 * u ** 1.6 + 0.06 * Math.sin(Math.PI * u);
    prof.push([r, yb + H * u]);
  }
  const rnd = K.rng(`lantern:${n}`);
  const wob = organic ? Array.from({ length: 5 }, () => [rnd.range(0, TAU), rnd.range(0.004, 0.012)]) : [];
  // ribs: the paper bulges a little between the wires; organic: one side bulges more, crinkles between the ribs
  const mod = (phi, y) => {
    const u = (y - yb) / H;
    let f = 1 + 0.012 * Math.sin(Math.PI * n * u) ** 2;
    if (organic) {
      f += 0.05 * Math.cos(phi - 0.6) * Math.sin(Math.PI * u) ** 2;
      for (const [p, amp] of wob) f += amp * Math.sin(phi * 7 + p + u * 9) * Math.sin(Math.PI * n * u) ** 2;
    }
    return f;
  };
  const s = shell(prof, 0.0015, seg, { mod });
  const o = L.shadeMat('shade', 1.2);
  L.auto(s.outer, o, 'shade');
  for (const g of s.rims) L.auto(g, o, 'shade');
  L.auto(s.inner, L.innerMat('inner', 0.5), 'inner');
  const by = yb + H * 0.5;
  L.bulb('globe', [0, by, 0], Math.min(0.03, R * 0.3));
  return [0, by, 0];
}

/** Rectangular (box) fabric shade, open top and bottom. Returns the bulb position. */
function boxShade(L, { W, D, H, yb, x = 0, z = 0 }) {
  const t = 0.003;
  const o = L.shadeMat('shade', 1.1);
  const i = L.innerMat('inner', 0.45);
  const y = yb + H / 2;
  for (const s of [-1, 1]) {
    L.auto(K.box(W, H, t).translate(x, y, z + s * (D / 2 - t / 2)), o, 'shade');
    L.auto(K.box(t, H, D - 2 * t).translate(x + s * (W / 2 - t / 2), y, z), o, 'shade');
    // inner faces (slightly inside, facing in)
    L.auto(new THREE.PlaneGeometry(W - 2 * t, H).rotateY(s > 0 ? Math.PI : 0).translate(x, y, z + s * (D / 2 - t - 0.0006)), i, 'inner');
    L.auto(new THREE.PlaneGeometry(D - 2 * t, H).rotateY(s > 0 ? -Math.PI / 2 : Math.PI / 2).translate(x + s * (W / 2 - t - 0.0006), y, z), i, 'inner');
  }
  const by = yb + H * 0.45;
  L.bulb('globe', [x - W * 0.2, by, z], Math.min(0.028, D * 0.25));
  L.bulb('globe', [x + W * 0.2, by, z], Math.min(0.028, D * 0.25));
  return [x, by, z];
}

/** Mushroom cap (dome, open or closed underneath), outer = shade, underside = inner. Returns underside y. */
function mushroomCap(L, { R, H, yb, x = 0, z = 0, flat = false }) {
  const prof = [];
  const n = 10;
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * (Math.PI / 2);
    const r = R * Math.cos(a) ** (flat ? 0.6 : 0.85);
    prof.push([Math.max(0.0008, r), yb + H * Math.sin(a) ** (flat ? 1.6 : 1)]);
  }
  // the rim: a short vertical lip
  prof.unshift([R, yb - Math.min(0.006, H * 0.15)]);
  const s = shell(prof, Math.min(0.003, H * 0.1), L.q.lathe, { rimTop: false });
  const o = L.shadeMat('shade', 1.1);
  L.auto(s.outer.translate(x, 0, z), o, 'shade');
  for (const g of s.rims) L.auto(g.translate(x, 0, z), o, 'shade');
  L.auto(s.inner.translate(x, 0, z), L.innerMat('inner', 0.5), 'inner');
  return yb;
}

/**
 * Stacked conical tiers (PH-style). D = outer diameter, H = height, yTop = top of the stack. Returns { bottom,
 * bulb } (bulb inside the second tier). Outer surfaces = shade, undersides = inner.
 */
function tierStack(L, { D, H, yTop, tiers = 3, x = 0, z = 0, pins = false }) {
  const R = D / 2;
  const n = clamp(Math.round(tiers), 2, 7);
  // radius factors: grow to the largest (second last), the last is a smaller lower reflector
  const f = [];
  for (let i = 0; i < n - 1; i++) f.push(n === 2 ? 1 : 0.6 + (0.4 * i) / (n - 2));
  f.push(0.58);
  f[n - 2] = 1;
  // each tier in its own band (unit height 0 = top … −1 = bottom), overlapping the next one a little
  const capH = Math.min(H * 0.16, 0.045);
  const step = 1 / (n + 0.25);
  const raw = [];
  for (let i = 0; i < n; i++) {
    const ro = f[i] * R;
    const ri = Math.max(0.15 * R, 0.018);
    const top = -i * step;
    raw.push({ ro, ri, top, bottom: top - step * 1.25 });
  }
  const minY = Math.min(...raw.map((r) => r.bottom));
  const k = (H - capH) / Math.max(1e-3, -minY);
  const o = L.mat('shade');
  const t = Math.min(0.002, R * 0.01);
  const seg = L.q.lathe;
  const yt = yTop - capH;
  for (const r of raw) {
    // slightly concave (PH-like) cone from the outer edge up to the housing
    const prof = [[r.ro, yt + r.bottom * k], [r.ri + (r.ro - r.ri) * 0.5, yt + (r.bottom + (r.top - r.bottom) * 0.42) * k], [r.ri, yt + r.top * k]];
    const s = shell(prof, t, seg, { rimTop: false });
    L.add(s.outer.translate(x, 0, z), o, 'shade');
    for (const g of s.rims) L.add(g.translate(x, 0, z), o, 'shade');
    L.auto(s.inner.translate(x, 0, z), L.innerMat('inner', 0.5), 'inner');
  }
  // central housing + cap on top
  const hr = Math.max(0.018, R * 0.16);
  L.add(K.cylinder(hr, hr * 1.05, capH + 0.004, { seg }).translate(x, yt - 0.004, z), o, 'shade');
  L.add(discGeo(hr * 2.1, 0.008, seg, { y0: yTop - 0.002 }).translate(x, 0, z), L.mat('metal'), 'metal');
  if (pins) {
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * TAU;
      L.add(K.cylinder(0.003, 0.003, 0.016, { seg: 6 }).translate(x + Math.sin(a) * hr * 0.6, yTop, z + Math.cos(a) * hr * 0.6), L.mat('metal'), 'metal');
    }
  }
  const bottom = yt + minY * k;
  // a small diffuser under the bulb
  const b = raw[n - 1];
  L.glowAdd(new THREE.CircleGeometry(b.ri * 0.95, seg).rotateX(Math.PI / 2).translate(x, yt + b.top * k - 0.003, z), L.glow('inner', 1.1), 'inner');
  const by = yt + raw[Math.max(0, n - 2)].top * k - 0.01;
  L.bulb('globe', [x, by, z], Math.min(0.03, R * 0.2));
  return { bottom, bulb: [x, by, z] };
}

/** Opal / glass globe with an opening at the bottom or top (gallery). Returns the centre. */
function globeShade(L, { R, Ry = R, cy, x = 0, z = 0, open = 0.16, openAt = 'top', part = 'shade' }) {
  const [ws, hs] = L.q.sph;
  const a = Math.asin(clamp(open, 0, 0.95));
  const g = K.sphere(R, { wSeg: ws + 8, hSeg: hs + 4, thetaStart: openAt === 'top' ? a : 0, thetaLength: Math.PI - a });
  xf(g, [x, cy, z], null, [1, Ry / R, 1]);
  const m = L.shadeMat(part, 1.15, L.isGlass(part) ? { side: 'double' } : undefined);
  L.auto(g, m, part);
  return [x, cy, z];
}

/**
 * Metal dome shade (closed top, open underneath) Ø 2R × H from yb up, with a small knob on top (table, arc and wall
 * lamps). Outer = shade, inside = inner (lit). Returns { bulb, angle }: the bulb under the crown and the half-angle a
 * spot down needs to fill the opening.
 */
function domeShade(L, { R, H, yb, x = 0, z = 0 }) {
  const prof = [];
  const n = 10;
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * (Math.PI / 2);
    prof.push([Math.max(0.002, R * Math.cos(a) ** 0.7), yb + H * Math.sin(a) ** 1.1]);
  }
  const s = shell(prof, Math.min(0.0018, H * 0.05), L.q.lathe, { rimTop: false });
  const o = L.shadeMat('shade', 1.1);
  L.auto(s.outer.translate(x, 0, z), o, 'shade');
  for (const g of s.rims) L.auto(g.translate(x, 0, z), o, 'shade');
  L.auto(s.inner.translate(x, 0, z), L.innerMat('inner', 0.5), 'inner');
  const kr = clamp(R * 0.08, 0.005, 0.012);
  L.add(xf(K.sphere(kr, { wSeg: 12, hSeg: 8 }), [x, yb + H + kr * 0.6, z]), L.mat('metal'), 'metal');
  const by = yb + H * 0.55;
  L.bulb('globe', [x, by, z], clamp(Math.min(R * 0.25, H * 0.3), 0.008, 0.03));
  return { bulb: [x, by, z], angle: Math.atan2(R, Math.max(0.02, by - yb)) * 1.1 };
}

/**
 * Glass bell Ø 2R × H (wall arms, Sofia/Silvia): wide open rim, narrowing to a short collar. Hanging = rim at yb, collar
 * on top; `up` = the other way round (rim on top, on a holder). Returns the bulb position.
 */
function bellShade(L, { R, H, yb, x = 0, z = 0, up = false }) {
  const pts = [[1, 0], [0.97, 0.1], [0.86, 0.3], [0.66, 0.55], [0.44, 0.78], [0.28, 0.93], [0.24, 1]];
  const prof = (up ? pts.map(([r, v]) => [r, 1 - v]).reverse() : pts).map(([r, v]) => [Math.max(0.006, r * R), yb + v * H]);
  const s = shell(prof, 0.002, L.q.lathe + 8);
  const m = L.shadeMat('shade', 1.15, L.isGlass('shade') ? { side: 'double' } : undefined);
  for (const g of [s.outer, ...s.rims]) L.auto(g.translate(x, 0, z), m, 'shade');
  L.auto(s.inner.translate(x, 0, z), L.isGlass('shade') ? m : L.innerMat('inner', 0.5), L.isGlass('shade') ? 'shade' : 'inner');
  const by = yb + H * (up ? 0.45 : 0.55);
  L.bulb('globe', [x, by, z], clamp(Math.min(R * 0.3, H * 0.25), 0.008, 0.026), { intensity: 2.5 });
  return [x, by, z];
}

// ---------------------------------------------------------------------------------------------------------------
// Ceiling lamps

function buildPendantDome(spec) {
  const L = new Lamp('pendant-dome', spec);
  const { w, h } = L.dims;
  const P = L.P;
  const R = w / 2, seg = L.q.lathe;
  const ch = canopy(L, { shape: P.slats ? 'cone' : 'disc', d: Math.min(0.11, Math.max(0.07, w * 0.4)), h: P.slats ? 0.045 : 0.025 });
  const drop = dropOf(L, 0.8, h + ch + 0.05);
  const y0 = -drop;
  const lm = L.lumens(800);
  if (P.ribbed) {
    // fluted glass pear (Rocks Xo): black cap with a cross fitting on top
    const H = h * 0.86;
    const prof = [[0.72, 0], [0.9, 0.1], [0.99, 0.26], [1.0, 0.36], [0.95, 0.5], [0.8, 0.64], [0.56, 0.77], [0.34, 0.87], [0.24, 0.93], [0.2, 1.0]].map(([r, y]) => [r * R, y0 + y * H]);
    const n = Math.max(10, Math.round(14 * (w / 0.26)));
    const s = shell(prof, 0.003, Math.max(seg, n * 4), { mod: (phi) => 1 + 0.035 * Math.cos(n * phi), rimTop: false });
    const gm = L.shadeMat('shade', 0.5, { side: 'double' });
    L.auto(s.outer, gm, 'shade');
    for (const g of s.rims) L.auto(g, gm, 'shade');
    const capR = Math.max(0.022, R * 0.27);
    L.add(K.cylinder(capR, capR, h - H + 0.012, { seg }).translate(0, y0 + H - 0.012, 0), L.mat('metal'), 'metal');
    L.add(K.roundedBox(capR * 3.4, 0.016, 0.02, 0.004, 2).translate(0, y0 + H + (h - H) * 0.45, 0), L.mat('metal'), 'metal');
    cord(L, 0, 0, -ch, y0 + h);
    const by = y0 + H * 0.42;
    L.socket(0, by + 0.03, y0 + H, 0, 0.013);
    L.bulb('filament', [0, by, 0], Math.min(0.032, R * 0.3));
    L.point([0, by, 0], lm);
  } else if (P.slats) {
    // dome of separate veneer slats (Calyps): light leaks between them
    const prof = [[0.64, 0], [0.88, 0.16], [0.99, 0.38], [0.98, 0.5], [0.9, 0.66], [0.7, 0.81], [0.42, 0.93], [0.2, 1.0]].map(([r, y]) => [r * R, y0 + y * h]);
    const n = Math.max(12, Math.round((TAU * R) / 0.04));
    const len = (TAU / n) * 0.74;
    const o = L.mat('shade', { grain: 'v' });
    const im = L.innerMat('inner', 0.35, { grain: 'v' });
    for (let i = 0; i < n; i++) {
      const s = shell(prof, 0.003, 2, { phiStart: (i / n) * TAU, phiLength: len, rimTop: false });
      L.add(s.outer, o, 'shade');
      for (const g of s.rims) L.add(g, o, 'shade');
      L.auto(s.inner, im, 'inner');
    }
    // top ring that holds the slats
    L.add(K.cylinder(0.2 * R + 0.004, 0.2 * R + 0.004, 0.012, { seg }).translate(0, y0 + h - 0.012, 0), L.mat('metal'), 'metal');
    cord(L, 0, 0, -ch, y0 + h);
    const by = y0 + h * 0.5;
    L.socket(0, by + 0.035, y0 + h, 0, 0.016);
    L.bulb('globe', [0, by, 0], Math.min(0.03, R * 0.2));
    L.point([0, by, 0], lm);
  } else {
    // classic metal dome with a neck
    const neckR = Math.max(0.02, Math.min(0.04, R * 0.16));
    const Hd = h * 0.84;
    const prof = [];
    const n = 12;
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * (Math.PI / 2);
      const r = R * Math.cos(a) ** 0.75;
      if (r < neckR * 1.15) break;
      prof.push([r, y0 + Hd * Math.sin(a) ** 1.15]);
    }
    prof.push([neckR * 1.1, y0 + Hd], [neckR, y0 + Hd + 0.004]);
    const s = shell(prof, 0.0018, seg, { rimTop: false });
    const o = L.shadeMat('shade', 1.1);
    L.auto(s.outer, o, 'shade');
    for (const g of s.rims) L.auto(g, o, 'shade');
    L.auto(s.inner, L.innerMat('inner', 0.5), 'inner');
    L.add(K.cylinder(neckR, neckR, h - Hd, { seg }).translate(0, y0 + Hd, 0), o.userData.cached ? o : L.mat('shade'), 'shade');
    cord(L, 0, 0, -ch, y0 + h);
    const by = y0 + Hd * 0.5;
    L.socket(0, by + 0.03, y0 + Hd, 0, 0.015);
    L.bulb('globe', [0, by, 0], Math.min(0.03, R * 0.25));
    if (L.translucency() > 0.3) L.point([0, by, 0], lm);
    else L.spot([0, by, 0], [0, -1, 0], lm, Math.atan2(R, Math.max(0.02, by - y0)) * 1.15, 0.7);
  }
  return L.finish();
}

function buildPendantGlobe(spec) {
  const L = new Lamp('pendant-globe', spec);
  const { w, h } = L.dims;
  const R = w / 2, Ry = Math.min(h, w * 1.3) / 2;
  const ch = canopy(L, { d: Math.min(0.11, Math.max(0.07, w * 0.35)) });
  const drop = dropOf(L, 0.8, Ry * 2 + ch + 0.06);
  const y0 = -drop;
  const cy = y0 + Ry;
  globeShade(L, { R, Ry, cy, open: 0.18 });
  // gallery (holder) ring at the top
  const gr = R * 0.19 + 0.004;
  const top = cy + Ry * Math.cos(Math.asin(0.18));
  L.add(K.cylinder(gr, gr, 0.035, { seg: L.q.lathe }).translate(0, top - 0.012, 0), L.mat('metal'), 'metal');
  cord(L, 0, 0, -ch, top + 0.023);
  // E27 socket in the gallery, bulb just below it (a soft hot spot through the opal)
  const br = Math.min(0.03, R * 0.3);
  const by = Math.max(cy - Ry * 0.2, top - 0.05 - br);
  L.socket(0, by + br * 0.8, top, 0, 0.014);
  L.bulb('globe', [0, by, 0], br, { intensity: 2.5 });
  L.point([0, cy, 0], L.lumens(800));
  return L.finish();
}

function buildPendantCylinder(spec) {
  const L = new Lamp('pendant-cylinder', spec);
  const { w, h } = L.dims;
  const P = L.P;
  const R = w / 2, seg = Math.max(20, Math.round(L.q.lathe * 0.75));
  const ch = canopy(L, { shape: P.canopy || 'disc', d: Math.max(0.06, Math.min(0.1, w * 1.1)) });
  const drop = dropOf(L, 0.8, h + ch + 0.05);
  const y0 = -drop;
  const t = Math.min(0.0015, R * 0.05);
  const s = shell([[R, y0], [R, y0 + h * 0.5], [R, y0 + h]], t, seg, { rimTop: false });
  const o = L.mat('shade');
  L.add(s.outer, o, 'shade');
  for (const g of s.rims) L.add(g, o, 'shade');
  // top cap
  L.add(discGeo(2 * R, 0.004, seg, { y0: y0 + h - 0.004, round: 0.0015 }), o, 'shade');
  // inside: only the lower part shows; recessed LED lens with a reflector ring
  const lensY = y0 + Math.min(0.02, h * 0.1);
  const inner = K.lathe([[R - t, y0 + 0.001], [R - t, lensY + 0.002]].reverse(), { seg });
  L.auto(inner, L.innerMat('inner', 0.4), 'inner');
  L.add(new THREE.CircleGeometry(R - t, seg).rotateX(Math.PI / 2).translate(0, lensY + 0.0015, 0), L.mat('inner'), 'inner');
  L.bulb('led', [0, lensY, 0], (R - t) * 0.72, { dir: [0, -1, 0], intensity: 3.5 });
  cord(L, 0, 0, -ch, y0 + h);
  L.spot([0, lensY - 0.002, 0], [0, -1, 0], L.lumens(400), clamp(0.3 + R * 1.6, 0.3, 0.75), 0.55);
  return L.finish();
}

function buildPendantLinear(spec) {
  const L = new Lamp('pendant-linear', spec);
  const { w, d, h } = L.dims;
  const P = L.P;
  const canopyL = clamp(w * 0.3, 0.12, 0.6);
  const ch = canopy(L, { shape: 'bar', len: canopyL, d: Math.max(0.035, Math.min(0.06, d * 1.4)), h: 0.022 });
  const drop = dropOf(L, 0.9, h + ch + 0.1);
  const y0 = -drop;
  L.add(K.roundedBox(w, h, d, Math.min(0.004, h / 4, d / 4), 2, { grain: 'x' }).translate(0, y0 + h / 2, 0), L.mat('shade'), 'shade');
  const count = Math.max(1, Math.round(num(P.count, 1)));
  const diffW = Math.max(0.004, d - Math.min(0.012, d * 0.3));
  if (count <= 1) {
    // continuous opal diffuser in the underside
    L.glowAdd(K.box(w - 0.03, 0.002, diffW).translate(0, y0 - 0.0005, 0), L.glow('inner', 1.6), 'inner');
  } else {
    for (let i = 0; i < count; i++) {
      const x = (i - (count - 1) / 2) * ((w - 0.08) / Math.max(1, count - 1));
      L.glowAdd(K.box(0.03, 0.002, diffW).translate(x, y0 - 0.0005, 0), L.glow('inner', 2.2), 'inner');
    }
  }
  const wires = Math.max(1, Math.round(num(P.cordCount, 2)));
  const wx = canopyL / 2 - 0.015;
  for (let i = 0; i < wires; i++) {
    const x = wires === 1 ? 0 : -wx + (2 * wx * i) / (wires - 1);
    hanger(L, x, 0, ch, y0 + h, { r: 0.0008, part: 'cord' });
    L.add(K.cylinder(0.003, 0.003, 0.012, { seg: 8 }).translate(x, y0 + h, 0), L.mat('metal'), 'metal');
  }
  const lm = L.lumens(1500);
  L.spot([-w / 4, y0 - 0.002, 0], [0, -1, 0], lm / 2, 1.1, 0.9);
  L.spot([w / 4, y0 - 0.002, 0], [0, -1, 0], lm / 2, 1.1, 0.9);
  return L.finish();
}

/** Soft peaks of the felt landscape pendant: [x / w, z / d, base radius / w, height share]; wires end on 0, 2 and 3. */
const FELT_PEAKS = [[-0.34, 0.05, 0.16, 0.6], [-0.18, -0.08, 0.13, 0.42], [0, 0, 0.25, 1], [0.21, 0.07, 0.15, 0.68], [0.37, -0.05, 0.12, 0.45]];
const FELT_WIRES = [0, 2, 3];

/**
 * Felt «landscape» pendant (Lucande Beutlin): a wavy oval felt tray (part inner) with soft felt peaks on top (part
 * shade), hung from a long bar canopy (params.canopyL) on three wires that end on the peak tops; the LEDs shine down
 * through an opal panel in the tray's underside. dims: w = length, d = width, h = height of the highest peak over the
 * underside. The felt absorbs a little sound (catalogue `absorption`).
 */
function buildPendantFelt(spec) {
  const L = new Lamp('pendant-felt', spec);
  const { w, d, h } = L.dims;
  const canopyL = clamp(num(L.P.canopyL, w * 0.75), 0.2, w);
  const ch = canopy(L, { shape: 'bar', len: canopyL, d: 0.11, h: 0.037 });
  const drop = dropOf(L, 0.85, h + ch + 0.1);
  const y0 = -drop;
  const t = clamp(h * 0.16, 0.02, 0.05);
  // tray: an oval with a slow wave in its outline (the felt is cut, not turned)
  const rf = (a) => 1 + 0.05 * Math.sin(3 * a + 0.7) + 0.035 * Math.sin(5 * a + 2.1);
  const outline = (s) => {
    const pts = [];
    for (let i = 0; i < 96; i++) {
      const a = (i / 96) * TAU;
      pts.push(new THREE.Vector2(Math.cos(a) * (w / 2) * rf(a) * s / 1.06, Math.sin(a) * (d / 2) * rf(a) * s / 1.06));
    }
    return new THREE.Shape(pts);
  };
  const tray = K.extrudeShape(outline(1), t, { bevel: Math.min(0.006, t * 0.3), bevelSegments: 2, curveSegments: 8 });
  tray.rotateX(-Math.PI / 2);
  K.worldUV(tray);
  L.add(tray.translate(0, y0, 0), L.mat('inner'), 'inner');
  // opal LED panel in the underside, facing down
  const panel = new THREE.ShapeGeometry(outline(0.72), 4);
  panel.rotateX(Math.PI / 2);
  L.glowAdd(panel.translate(0, y0 - 0.0008, 0), L.bulbMat(1.3), null);
  // the peaks: soft turned felt hills with a rounded top, squeezed across the tray
  const prof = [[1, 0], [0.86, 0.07], [0.68, 0.19], [0.5, 0.36], [0.35, 0.56], [0.21, 0.77], [0.1, 0.92], [0, 1]];
  const ph = h - t;
  const tops = [];
  for (const [px, pz, pr, ps] of FELT_PEAKS) {
    const rx = pr * w, rz = Math.min(rx * 1.1, d / 2 - Math.abs(pz * d) - 0.015);
    const geo = K.lathe(prof, { seg: L.q.lathe });
    geo.scale(rx, ph * ps, rz);
    L.add(geo.translate(px * w, y0 + t - 0.002, pz * d), L.mat('shade'), 'shade');
    tops.push([px * w, y0 + t + ph * ps - 0.004, pz * d]);
  }
  for (const i of FELT_WIRES) {
    const [x, y, z] = tops[i];
    if (Math.abs(x) > canopyL / 2) continue;
    hanger(L, x, z, ch, y, { r: 0.0008, part: 'cord' });
  }
  const lm = L.lumens(950);
  L.spot([-w / 4, y0 - 0.002, 0], [0, -1, 0], lm / 2, 1.15, 0.9);
  L.spot([w / 4, y0 - 0.002, 0], [0, -1, 0], lm / 2, 1.15, 0.9);
  return L.finish();
}

/** One head of a multi pendant: 'globe' (glass), 'slatted' (wood bell), 'dome' (metal saucer). Returns bulb pos. */
function multiHead(L, shape, { D, H, yb }) {
  const R = D / 2, seg = L.q.lathe;
  if (shape === 'globe') {
    // apple-shaped mouth-blown globe with a metal cap
    const capH = Math.min(0.035, H * 0.2);
    const gH = H - capH * 0.5;
    const prof = [[0.12, 0], [0.55, 0.04], [0.86, 0.16], [0.99, 0.4], [0.97, 0.58], [0.82, 0.78], [0.5, 0.94], [0.24, 1]].map(([r, y]) => [r * R, yb + y * gH]);
    const gm = L.shadeMat('shade', 0.6, { side: 'double' });
    L.auto(K.lathe(prof, { seg }), gm, 'shade');
    const capR = 0.26 * R + 0.004;
    L.add(K.cylinder(capR * 0.9, capR, capH, { seg }).translate(0, yb + gH - capH * 0.4, 0), L.mat('metal'), 'metal');
    const by = yb + gH * 0.48;
    L.bulb('filament', [0, by, 0], Math.min(0.03, R * 0.28));
    L.socket(0, by + 0.03, yb + gH, 0, 0.013);
    return [0, by, 0];
  }
  if (shape === 'slatted') {
    const prof = [[0.5, 0], [0.49, 0.12], [0.45, 0.35], [0.36, 0.6], [0.24, 0.8], [0.12, 0.94], [0.07, 1]].map(([r, y]) => [r * D, yb + y * H]);
    const n = Math.max(12, Math.round((TAU * R) / 0.022));
    const len = (TAU / n) * 0.6;
    const o = L.mat('shade', { grain: 'v' });
    const im = L.innerMat('inner', 0.4, { grain: 'v' });
    for (let i = 0; i < n; i++) {
      const s = shell(prof, 0.0025, 1, { phiStart: (i / n) * TAU, phiLength: len, rimTop: false });
      L.add(s.outer, o, 'shade');
      for (const g of s.rims) L.add(g, o, 'shade');
      L.auto(s.inner, im, 'inner');
    }
    L.add(K.cylinder(0.08 * D, 0.08 * D, 0.012, { seg }).translate(0, yb + H - 0.01, 0), L.mat('metal'), 'metal');
    const by = yb + H * 0.4;
    L.bulb('globe', [0, by, 0], Math.min(0.028, R * 0.3));
    L.socket(0, by + 0.03, yb + H, 0, 0.014);
    return [0, by, 0];
  }
  // shallow saucer facing down (black outside, gold inside)
  const sh = Math.min(H, D * 0.32);
  yb += H - sh;
  H = sh;
  const prof = [[R, 0], [R * 0.86, H * 0.3], [R * 0.5, H * 0.78], [R * 0.2, H]].map(([r, y]) => [r, yb + y]);
  const s = shell(prof, 0.0015, seg, { rimTop: false });
  const o = L.mat('shade');
  L.add(s.outer, o, 'shade');
  for (const g of s.rims) L.add(g, o, 'shade');
  L.auto(s.inner, L.innerMat('inner', 0.55), 'inner');
  L.add(K.cylinder(R * 0.2, R * 0.2, 0.004, { seg }).translate(0, yb + H - 0.002, 0), o, 'shade');
  L.bulb('led', [0, yb + H * 0.55, 0], R * 0.3, { dir: [0, -1, 0] });
  return [0, yb + H * 0.5, 0];
}

function buildPendantMulti(spec) {
  const L = new Lamp('pendant-multi', spec);
  const { w, d, h } = L.dims;
  const P = L.P;
  const layout = P.layout || (d < w * 0.5 ? 'row' : 'branches');
  const count = clamp(Math.round(num(P.count ?? P.shades, layout === 'row' ? 3 : 8)), 1, 24);
  const lm = L.lumens(layout === 'row' ? 1400 : 900);
  if (layout === 'row') {
    const shape = P.shadeShape || 'dome';
    const D = Math.min(num(P.shadeD, d), d, w / count);
    const H = Math.min(num(P.shadeH, h), h);
    const ch = canopy(L, { shape: 'bar', len: w, d: 0.08, h: 0.025 });
    const drop = dropOf(L, 1.0, H + ch + 0.08);
    const y0 = -drop;
    const span = w - D;
    for (let i = 0; i < count; i++) {
      const x = count === 1 ? 0 : -span / 2 + (span * i) / (count - 1);
      const head = new Lamp(L.id, L.spec);
      // reuse the parent's materials (one set per lamp): delegate material calls
      head._mats = L._mats;
      const bp = multiHead(head, shape, { D, H, x, z: 0, yb: y0 });
      for (const m of [...head.g.children]) {
        m.geometry.translate(x, 0, 0);
        L.g.add(m);
      }
      for (const m of [...head.glowRoot.children]) {
        m.geometry.translate(x, 0, 0);
        L.glowRoot.add(m);
      }
      hanger(L, x, 0, ch, y0 + H);
      if (count <= 4) L.point([x, bp[1], 0], lm / count);
    }
    if (count > 4) L.point([0, y0 + H * 0.5, 0], lm);
    return L.finish();
  }
  if (layout === 'cluster') {
    // cloud of glass balls around one bulb
    const ch = canopy(L, { d: 0.1, h: 0.03 });
    const drop = dropOf(L, 1.0, h + ch + 0.08);
    const y0 = -drop;
    const bd = clamp(num(P.shadeD, w * 0.29), 0.04, Math.min(w, d, h) * 0.6);
    const cy = y0 + h / 2;
    const [ws, hs] = L.q.sph;
    const gm = L.mat('shade', { side: 'double' });
    const rnd = K.rng(`cluster:${count}`);
    const balls = fibonacci(count).map(([dx, dy, dz]) => {
      const r = (bd / 2) * rnd.range(0.85, 1.1);
      const k = rnd.range(0.8, 1.0);
      return { p: [dx * k, dy * k, dz * k], r };
    });
    // the catalogue size is the outline of the cloud: stretch the ball centres per axis so the outer balls touch it
    const fit = [fitBalls(balls, 0, w, bd), fitBalls(balls, 1, h, bd), fitBalls(balls, 2, d, bd)];
    const rx = fit[0].f, ry = fit[1].f;
    for (const b of balls) {
      const [x, y, z] = b.p.map((v, a) => (v - fit[a].m) * fit[a].f);
      L.add(xf(K.sphere(b.r, { wSeg: Math.max(12, ws - 6), hSeg: Math.max(8, hs - 4) }), [x, cy + y, z]), gm, 'shade');
    }
    // a faint glow on the glass balls when lit
    L.glowAdd(xf(K.sphere(Math.min(rx, ry) * 0.55, { wSeg: ws, hSeg: hs }), [0, cy, 0]), L.glow('inner', 0.35, { opacity: 0.25 }), 'inner');
    cord(L, 0, 0, -ch, y0 + h - bd * 0.3);
    L.socket(0, cy + 0.03, y0 + h - bd * 0.3, 0, 0.012);
    L.bulb('filament', [0, cy, 0], Math.min(0.03, bd * 0.3));
    L.point([0, cy, 0], lm);
    return L.finish();
  }
  // branches: central stem, arms in two tiers, small saucers facing down (Pelagia)
  const ch = canopy(L, { d: 0.11, h: 0.03 });
  const D = clamp(num(P.shadeD, 0.12), 0.05, w * 0.4);
  const H = clamp(num(P.shadeH, D * 0.6), 0.02, h);
  const drop = dropOf(L, 1.0, h + ch + 0.08);
  const y0 = -drop;
  const tierGap = Math.min(0.06, h * 0.2);
  const hubY = y0 + H + 0.04 + tierGap;
  cord(L, 0, 0, -ch, hubY + tierGap + 0.02, { r: 0.004, part: 'metal' });
  L.add(K.cylinder(0.012, 0.012, tierGap + 0.05, { seg: 12 }).translate(0, hubY - 0.03, 0), L.mat('metal'), 'metal');
  const Lout = Math.max(0.05, w / 2 - D / 2);
  const per = Math.ceil(count / 2);
  for (let i = 0; i < count; i++) {
    const tier = i % 2;
    const k = Math.floor(i / 2);
    const n = tier === 0 ? per : count - per;
    const a = (k / Math.max(1, n)) * TAU + (tier ? Math.PI / Math.max(1, n) : 0);
    const len = tier ? Lout * 0.72 : Lout;
    const ay = hubY + (tier ? 0 : tierGap);
    const ex = Math.sin(a) * len, ez = Math.cos(a) * len;
    L.add(rod([0, ay, 0], [ex, ay, ez], 0.004, L.q.rod), L.mat('metal'), 'metal');
    L.add(xf(K.sphere(0.008, { wSeg: 8, hSeg: 6 }), [ex, ay, ez]), L.mat('metal'), 'metal');
    const yb = ay - 0.03 - H;
    L.add(rod([ex, ay, ez], [ex, yb + H, ez], 0.003, 6), L.mat('metal'), 'metal');
    const head = new Lamp(L.id, L.spec);
    head._mats = L._mats;
    multiHead(head, 'dome', { D, H, x: 0, z: 0, yb });
    for (const m of [...head.g.children]) {
      m.geometry.translate(ex, 0, ez);
      L.g.add(m);
    }
    for (const m of [...head.glowRoot.children]) {
      m.geometry.translate(ex, 0, ez);
      L.glowRoot.add(m);
    }
  }
  L.spot([0, y0 + H * 0.5, 0], [0, -1, 0], lm, 1.3, 0.95);
  return L.finish();
}

function buildPendantTiered(spec) {
  const L = new Lamp('pendant-tiered', spec);
  const { w, h } = L.dims;
  const ch = canopy(L, { shape: 'cone', d: 0.1, h: 0.04 });
  const drop = dropOf(L, 0.8, h + ch + 0.05);
  const y0 = -drop;
  const t = tierStack(L, { D: w, H: h, yTop: y0 + h, tiers: num(L.P.tiers, 3) });
  cord(L, 0, 0, -ch, y0 + h);
  const lm = L.lumens(800);
  if (L.translucency() > 0.3) L.point(t.bulb, lm);
  else L.spot(t.bulb, [0, -1, 0], lm, 1.2, 0.9);
  return L.finish();
}

function buildPendantWoven(spec) {
  const L = new Lamp('pendant-woven', spec);
  const { w, h } = L.dims;
  const P = L.P;
  const R = w / 2, seg = L.q.lathe;
  const weave = P.weave || 'rattan';
  const lm = L.lumens(806);
  const chain = weave === 'linen' || P.chain === true;
  const ch = canopy(L, { shape: weave === 'fabric' || weave === 'bamboo' ? 'cone' : 'disc', d: 0.11, h: weave === 'fabric' || weave === 'bamboo' ? 0.05 : 0.025 });
  const drop = dropOf(L, 0.8, h + ch + 0.06);
  const y0 = -drop;
  let by = y0 + h * 0.45;
  let topY = y0 + h;
  if (weave === 'linen') {
    // drum with an outside frame and a chain (Verma)
    const H = h * 0.86, yb = y0 + (h - H) * 0.55;
    drumShade(L, { R: R * 0.97, H, yb, spider: false, bulb: null });
    const frame = L.mat('metal');
    const top = yb + H + 0.006;
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * TAU + Math.PI / 4;
      const x = Math.sin(a) * (R * 0.97 + 0.004), z = Math.cos(a) * (R * 0.97 + 0.004);
      L.add(bar([x, y0, z], [x, top, z], 0.012, 0.004, [Math.cos(a), 0, -Math.sin(a)]), frame, 'metal');
      L.add(bar([x * 0.02, top, z * 0.02], [x, top, z], 0.012, 0.004, [0, 0, 0].map((_, i) => (i === 1 ? 1 : 0))), frame, 'metal');
    }
    // four bulbs inside on a cluster holder
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * TAU;
      L.bulb('globe', [Math.sin(a) * R * 0.18, yb + H * 0.5, Math.cos(a) * R * 0.18], 0.028);
    }
    L.add(K.cylinder(0.02, 0.02, top - (yb + H * 0.5) - 0.02, { seg: 12 }).translate(0, yb + H * 0.5 + 0.02, 0), frame, 'metal');
    by = yb + H * 0.5;
    topY = top;
  } else if (weave === 'fabric') {
    // pleated organic lantern (Donna)
    const prof = [];
    const n = 12;
    for (let i = 0; i <= n; i++) {
      const a = -Math.PI / 2 + (i / n) * Math.PI;
      const r = R * (0.9 * Math.cos(a) ** 0.75 + 0.1);
      prof.push([Math.max(0.03, r), y0 + h * (0.5 + 0.5 * Math.sin(a))]);
    }
    prof[0][0] = Math.max(prof[0][0], R * 0.38);
    prof[n][0] = Math.max(0.025, R * 0.1);
    const lobes = Math.max(8, Math.round(14 * (w / 0.55)));
    // soft lobes between sewn-in ribs (the rib lines are the narrow creases)
    const s = shell(prof, 0.003, Math.max(seg, lobes * 4), { mod: (phi) => 1 - 0.035 * (1 - Math.abs(Math.sin((lobes * phi) / 2)) ** 0.5) });
    const o = L.shadeMat('shade', 1.15);
    L.auto(s.outer, o, 'shade');
    for (const g of s.rims) L.auto(g, o, 'shade');
    L.auto(s.inner, L.innerMat('inner', 0.45), 'inner');
    L.bulb('globe', [0, by, 0], 0.03);
    L.socket(0, by + 0.03, y0 + h, 0, 0.016);
  } else if (weave === 'bamboo') {
    // flat basket with an open lattice (Savanna)
    const prof = [[0.84, 0], [0.95, 0.12], [1.0, 0.45], [0.97, 0.8], [0.88, 0.96], [0.7, 1.0], [0.3, 1.0], [0.06, 1.0]].map(([r, y]) => [r * R, y0 + y * h]);
    const open = /woven|rattan/.test(L.kind('shade'));
    const kind = open ? 'rattan' : L.kind('shade');
    const opts = open ? { open: true, scale: 3.5, side: 'double' } : { side: 'double' };
    const t = L.translucency();
    const m = L.hueGlow(shadeMaterial(kind, L.hex('shade'), { glow: L.tint('shade'), intensity: 0.12 + t * 0.6, ...opts }), L.glowHue('shade'));
    L.glowAdd(K.lathe(prof, { seg }), m, 'shade', { castShadow: true });
    // rim hoops (bamboo bands)
    const band = L.mat('shade', { roughness: 0.6 });
    L.add(K.torus(prof[0][0], 0.004, { radial: 6, tubular: seg }).rotateX(Math.PI / 2).translate(0, y0, 0), band, 'shade');
    L.add(K.torus(R, 0.003, { radial: 6, tubular: seg }).rotateX(Math.PI / 2).translate(0, y0 + h * 0.45, 0), band, 'shade');
    by = y0 + h * 0.4;
    L.bulb('filament', [0, by, 0], 0.03);
    L.socket(0, by + 0.03, y0 + h, 0, 0.016);
  } else {
    // oblate sphere of rattan ribs (Zuri)
    const ribs = Math.max(20, Math.round(84 * (w / 0.61) * L.q.ribs));
    const prof = [];
    const n = Math.max(10, Math.round(16 * L.q.ribs));
    const a0 = Math.asin(0.34), a1 = Math.PI - Math.asin(0.12);
    for (let i = 0; i <= n; i++) {
      const a = a0 + ((a1 - a0) * i) / n;
      prof.push([R * Math.sin(a), y0 + (h / 2) * (1 - Math.cos(a))]);
    }
    const yb = prof[0][1];
    const lift = yb - y0;
    const rr = Math.max(0.002, R * 0.0085);
    const geos = [];
    for (let k = 0; k < ribs; k++) {
      const a = (k / ribs) * TAU;
      const pts = prof.map(([r, y]) => [Math.sin(a) * r, y - lift, Math.cos(a) * r]);
      // flat rattan strip: wider along the surface than across it
      const g = K.tube(pts, rr, { radial: 3, seg: n + 4 });
      geos.push(g);
    }
    const ribMat = L.shadeMat('shade', 0.4);
    for (const g of geos) L.auto(g, ribMat, 'shade');
    // horizontal hoops: bottom opening, equator, top opening
    const hoop = L.mat('shade', { roughness: 0.6 });
    for (const [r, y] of [prof[0], prof[Math.round(n * 0.5)], prof[n]]) {
      L.add(K.torus(r, rr * 1.8, { radial: 5, tubular: seg }).rotateX(Math.PI / 2).translate(0, y - lift, 0), hoop, 'shade');
    }
    by = y0 + h * 0.42;
    L.bulb('filament', [0, by, 0], 0.032);
    L.socket(0, by + 0.035, prof[n][1] - lift, 0, 0.016);
    topY = prof[n][1] - lift;
  }
  // suspension
  if (chain) {
    const linkL = 0.03, linkR = 0.0028;
    const top = -ch, bottom = topY + 0.01;
    const nLinks = Math.max(1, Math.floor((top - bottom) / (linkL * 0.82)));
    const lm2 = L.mat('metal');
    for (let i = 0; i < nLinks; i++) {
      const y = top - (i + 0.5) * ((top - bottom) / nLinks);
      const g = K.torus(0.0085, linkR, { radial: 4, tubular: 8 });
      xf(g, [0, y, 0], [0, i % 2 ? Math.PI / 2 : 0, 0], [1, 1.7, 1]);
      L.add(g, lm2, 'metal');
    }
  } else {
    cord(L, 0, 0, -ch, topY, { r: weave === 'rattan' ? 0.004 : 0.0028 });
  }
  L.point([0, by, 0], lm);
  return L.finish();
}

function buildPendantMushroom(spec) {
  const L = new Lamp('pendant-mushroom', spec);
  const { w, h } = L.dims;
  const R = w / 2;
  const ch = canopy(L, { d: 0.09 });
  const drop = dropOf(L, 0.8, h + ch + 0.05);
  const y0 = -drop;
  mushroomCap(L, { R, H: h * 0.85, yb: y0 + 0.006 });
  // stem on top
  const sr = Math.max(0.015, R * 0.1);
  L.add(K.cylinder(sr, sr, h * 0.15 + 0.004, { seg: L.q.lathe }).translate(0, y0 + h * 0.85, 0), L.mat('metal'), 'metal');
  cord(L, 0, 0, -ch, y0 + h);
  const by = y0 + h * 0.45;
  L.socket(0, by + 0.03, y0 + h * 0.85, 0, 0.015);
  L.bulb('globe', [0, by, 0], Math.min(0.03, R * 0.25));
  const lm = L.lumens(800);
  if (L.translucency() > 0.3) L.point([0, by, 0], lm);
  else L.spot([0, by, 0], [0, -1, 0], lm, Math.atan2(R, by - y0), 0.8);
  return L.finish();
}

// ---------------------------------------------------------------------------------------------------------------
// Wooden slat lanterns (Secto Design): «secto» = Secto 4200 / 4201 (closed neck, trumpet flare to an open rim),
// «octo» = Octo 4240 / 4241 (closed neck, quick shoulder, round belly widest at ≈ 70 % of the height, curving in to
// an open bottom). Every slat is one thin bent strip that follows the measured outline exactly, broad face outward;
// the strips keep their width, so they touch in the neck and the gaps open up toward the belly / rim.

/**
 * Outlines [metres down from the shade top, outer Ø] of the two families: Secto 4200 as in
 * research/catalog-new/taklampe-secto.json, Octo 4240 re-measured from the same cut-out photo through a camera calibrated
 * on the render (.shots/add-lamps/compare.mjs – the catalogue's points make the lower third ≈ 3 cm too narrow: rim
 * Ø0.36 → 0.39). A product's own `params.profilePoints` win; these serve the archetype defaults and the Inspector's
 * «Form» switch.
 */
const SLAT_PROFILES = {
  secto: {
    slats: 52,
    pts: [[0, 0.129], [0.19, 0.129], [0.21, 0.138], [0.24, 0.15], [0.27, 0.164], [0.3, 0.176], [0.36, 0.201], [0.42, 0.229], [0.48, 0.256], [0.54, 0.282], [0.6, 0.3]],
  },
  octo: {
    slats: 44,
    pts: [[0, 0.125], [0.17, 0.125], [0.187, 0.131], [0.204, 0.151], [0.221, 0.196], [0.238, 0.262], [0.255, 0.313], [0.272, 0.353], [0.306, 0.417], [0.34, 0.463], [0.374, 0.497], [0.408, 0.519], [0.442, 0.535], [0.469, 0.54], [0.51, 0.539], [0.544, 0.529], [0.578, 0.513], [0.612, 0.483], [0.646, 0.445], [0.663, 0.42], [0.68, 0.394]],
  },
};
/** Archetype default drop (ceiling → rim): the shops' 1.2–1.25 m, ≈ 70 cm over a dining table under a 2.65 m ceiling. */
const SLAT_DROP = 1.2;
/** Sampling of a slat along its length per quality: [max turn between two samples (deg), max sample spacing (m)]. */
const SLAT_STEP = { low: [9, 0.14], medium: [5, 0.08], high: [3, 0.05] };
/** Gap between the slats where they close up (the neck): a hairline, as in the photos. */
const SLAT_HAIRLINE = 0.0005;
/** Glow of the lit birch inside at full strength (LightManager units: × 150 nits for an 800 lm lamp) … */
const SLAT_GLOW = 1.4;
/** … what is left where no direct light reaches it (light bounced around inside) … */
const SLAT_GLOW_FLOOR = 0.15;
/** … and the distance from the bulb within which a face turned to it glows at full strength. */
const SLAT_GLOW_REF = 0.12;
/** Saturation of the glow's birch hue: light bounced around inside a wooden lantern takes on the wood's colour more
 * than once (≈ albedo²), so it glows golden, not white. */
const SLAT_GLOW_SAT = 1.6;

/** The item's measured outline ([[s, Ø], …], s increasing) or null when missing / malformed. */
function slatPoints(P) {
  const pts = P.profilePoints;
  if (!Array.isArray(pts) || pts.length < 3) return null;
  const ok = pts.every((p, i) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]) && p[1] > 0.005 && (i === 0 || p[0] > pts[i - 1][0]));
  return ok ? pts.map((p) => [p[0], p[1]]) : null;
}

/** 'octo' when an outline is widest well above its open bottom (flask), else 'secto' (flares out to the rim). */
function slatFamily(pts) {
  const maxD = Math.max(...pts.map((p) => p[1]));
  return pts[pts.length - 1][1] < maxD * 0.92 ? 'octo' : 'secto';
}

/** Depth where an outline's straight neck ends (Ø within 1 mm of the top). */
function slatNeck(pts) {
  let s = 0;
  for (const p of pts) {
    if (Math.abs(p[1] - pts[0][1]) > 0.001) break;
    s = p[0];
  }
  return s;
}

/**
 * A template outline given the item's own neck (params.neckD / neckH at the nominal size params.shadeD / shadeH):
 * the neck takes the new Ø and depth, the rest is stretched between it and the unchanged widest Ø / bottom.
 */
function remapNeck(pts, P, dims) {
  const H = pts[pts.length - 1][0], D = Math.max(...pts.map((p) => p[1]));
  const d0 = pts[0][1] / D, n0 = slatNeck(pts) / H;
  const dN = clamp(num(P.neckD, NaN) / num(P.shadeD, dims.w), 0.1, 0.9);
  const hN = clamp(num(P.neckH, NaN) / num(P.shadeH, dims.h), 0.05, 0.6);
  if (!Number.isFinite(dN) || !Number.isFinite(hN) || (Math.abs(dN - d0) < 0.01 && Math.abs(hN - n0) < 0.01) || n0 <= 0 || d0 >= 1) return pts;
  return pts.map(([s, d]) => {
    const sn = s / H;
    const s2 = sn <= n0 ? (sn * hN) / n0 : hN + ((sn - n0) * (1 - hN)) / (1 - n0);
    const d2 = dN + ((d / D - d0) * (1 - dN)) / (1 - d0);
    return [s2 * H, d2 * D];
  });
}

/** The outline to build: { pts: [[s, Ø]] (its own units), family, own } – see SLAT_PROFILES. */
function slatProfile(P, dims) {
  const own = slatPoints(P);
  const family = P.profile === 'octo' || P.profile === 'secto' ? P.profile : own ? slatFamily(own) : 'secto';
  if (own && slatFamily(own) === family) return { pts: own, family, own: true };
  const pts = SLAT_PROFILES[family].pts.map((p) => [...p]);
  // the item gives no measured outline: the template with its neck (switching «Form» keeps the template's own neck)
  return { pts: own ? pts : remapNeck(pts, P, dims), family, own: false };
}

/** Centripetal Catmull-Rom from p1 to p2 (2D), n points after p1 (Barry–Goldman). */
function catmullRom(p0, p1, p2, p3, n) {
  const dt = (a, b) => Math.max(1e-6, Math.hypot(b[0] - a[0], b[1] - a[1]) ** 0.5);
  const t0 = 0, t1 = t0 + dt(p0, p1), t2 = t1 + dt(p1, p2), t3 = t2 + dt(p2, p3);
  const out = [];
  for (let i = 1; i <= n; i++) {
    const t = t1 + ((t2 - t1) * i) / n;
    const lerp2 = (a, b, ta, tb) => [((tb - t) * a[0] + (t - ta) * b[0]) / (tb - ta), ((tb - t) * a[1] + (t - ta) * b[1]) / (tb - ta)];
    const A1 = lerp2(p0, p1, t0, t1), A2 = lerp2(p1, p2, t1, t2), A3 = lerp2(p2, p3, t2, t3);
    out.push(lerp2(lerp2(A1, A2, t0, t2), lerp2(A2, A3, t1, t3), t1, t2));
  }
  return out;
}

/**
 * Dense outline [[r, y]] (y = 0 at the shade top, negative downward) through every measured point: the straight neck
 * stays straight (subdivided every 2 cm), the curve leaves it tangentially (bent strips have no kink) and runs as a
 * centripetal Catmull-Rom through the rest.
 */
function slatOutline(pts, kr, ky) {
  const P = pts.map(([s, D]) => [(D / 2) * kr, -s * ky]);
  const n = P.length;
  const out = [P[0]];
  const straight = (i) => Math.abs(P[i][0] - P[i + 1][0]) < 5e-4 * kr;
  for (let i = 0; i < n - 1; i++) {
    const a = P[i], b = P[i + 1];
    if (straight(i) && (i === 0 || straight(i - 1))) {
      const k = Math.max(1, Math.ceil((a[1] - b[1]) / 0.02));
      for (let j = 1; j <= k; j++) out.push([a[0] + ((b[0] - a[0]) * j) / k, a[1] + ((b[1] - a[1]) * j) / k]);
      continue;
    }
    const p3 = i + 2 < n ? P[i + 2] : [2 * b[0] - a[0], 2 * b[1] - a[1]];
    if (i > 0 && straight(i - 1)) {
      // leaving the straight neck: a bent strip has no kink – it starts to curve a little above the measured end of the
      // neck (≤ 2.5 cm, as in the photos) and leaves it tangentially (Hermite curve; ≈ 1 mm off the point at a)
      const ab = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const dlt = Math.min(0.4 * (P[i - 1][1] - a[1]), 0.8 * ab, 0.025 * ky);
      while (out.length > 1 && out[out.length - 1][1] < a[1] + dlt - 1e-9) out.pop();
      const a2 = [a[0], a[1] + dlt];
      out.push(a2);
      const L2 = Math.hypot(b[0] - a2[0], b[1] - a2[1]);
      const tl = Math.hypot(p3[0] - a[0], p3[1] - a[1]) || 1;
      const m0 = [0, -L2], m1 = [((p3[0] - a[0]) / tl) * L2, ((p3[1] - a[1]) / tl) * L2];
      for (let j = 1; j <= 12; j++) {
        const t = j / 12, t2 = t * t, t3 = t2 * t;
        const h00 = 2 * t3 - 3 * t2 + 1, h10 = t3 - 2 * t2 + t, h01 = -2 * t3 + 3 * t2, h11 = t3 - t2;
        out.push([0, 1].map((k) => h00 * a2[k] + h10 * m0[k] + h01 * b[k] + h11 * m1[k]));
      }
      continue;
    }
    const p0 = i > 0 ? P[i - 1] : [2 * a[0] - b[0], 2 * a[1] - b[1]];
    out.push(...catmullRom(p0, a, b, p3, 10));
  }
  return out;
}

/**
 * Samples of a slat: the dense outline thinned where it runs straight (turn ≤ maxTurn and spacing ≤ maxLen between
 * kept points). Each: { r, y, tr, ty (unit tangent, downward along the slat), len (arc length from the top) }.
 */
function slatSamples(dense, maxTurn, maxLen) {
  const n = dense.length;
  const len = [0];
  for (let i = 1; i < n; i++) len.push(len[i - 1] + Math.hypot(dense[i][0] - dense[i - 1][0], dense[i][1] - dense[i - 1][1]));
  const segDir = (i) => Math.atan2(dense[i + 1][1] - dense[i][1], dense[i + 1][0] - dense[i][0]);
  const keep = [0];
  let acc = 0, last = 0;
  for (let i = 1; i < n - 1; i++) {
    let da = segDir(i) - segDir(i - 1);
    da = Math.abs(Math.atan2(Math.sin(da), Math.cos(da)));
    acc += da;
    if (acc >= maxTurn || len[i + 1] - len[last] > maxLen) {
      keep.push(i);
      acc = 0;
      last = i;
    }
  }
  keep.push(n - 1);
  return keep.map((i) => {
    const a = dense[Math.max(0, i - 1)], b = dense[Math.min(n - 1, i + 1)];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return { r: dense[i][0], y: dense[i][1], tr: (b[0] - a[0]) / l, ty: (b[1] - a[1]) / l, len: len[i] };
  });
}

/**
 * Indexed triangle soup with metre UVs (+ the per-vertex glow of the lit inside): `strip(A, B)` joins two equally
 * long rows of { p, n, uv } into quads, facing along the vertex normals.
 */
class SlatBuffer {
  constructor(glowAt = null) {
    this.pos = [];
    this.nor = [];
    this.uv = [];
    this.glowAt = glowAt;
    this.glow = glowAt ? [] : null;
    this.idx = [];
  }

  strip(A, B) {
    const base = this.pos.length / 3, m = A.length;
    for (const v of [...A, ...B]) {
      this.pos.push(v.p[0], v.p[1], v.p[2]);
      this.nor.push(v.n[0], v.n[1], v.n[2]);
      this.uv.push(v.uv[0], v.uv[1]);
      if (this.glow) this.glow.push(this.glowAt(v.p, v.n));
    }
    // winding from the first quad: (a, c, b) must face along a's normal
    const a = A[0].p, b = A[1].p, c = B[0].p;
    const e1 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]], e2 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const fn = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const flip = fn[0] * A[0].n[0] + fn[1] * A[0].n[1] + fn[2] * A[0].n[2] < 0;
    for (let j = 0; j < m - 1; j++) {
      const ia = base + j, ib = ia + 1, ic = base + m + j, id = ic + 1;
      if (flip) this.idx.push(ia, ib, ic, ib, id, ic);
      else this.idx.push(ia, ic, ib, ib, ic, id);
    }
  }

  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    if (this.glow) g.setAttribute('lampGlow', new THREE.Float32BufferAttribute(this.glow, 1));
    g.setIndex(this.pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return g;
  }
}

/**
 * Glow material of the slats' birch inside: brightness per vertex (attribute `lampGlow`, 0..1 – direct light from the
 * bulb in the neck) times the LightManager's level, surface hue in the shader (see tintGlow). One program for every
 * slat lantern. Its mesh is kept out of kit.mergeSameMaterial (that would drop the attribute): one mesh per lamp.
 */
function slatGlowMaterial(L) {
  const m = shadeMaterial(L.kind('inner'), L.hex('inner'), { glow: L.tint('inner'), intensity: SLAT_GLOW, ...(L.kindOpts('inner', { side: 'front' }) || {}) });
  const hue = hueOf(linearRGB(L.hex('inner')), SLAT_GLOW_SAT);
  m.emissive.setRGB(m.emissive.r / hue[0], m.emissive.g / hue[1], m.emissive.b / hue[2]);
  const u = { value: new THREE.Color(hue[0], hue[1], hue[2]) };
  m.userData.glowTint = u.value;
  m.onBeforeCompile = (sh) => {
    sh.uniforms.lampGlowTint = u;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float lampGlow;\nvarying float vLampGlow;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n\tvLampGlow = lampGlow;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 lampGlowTint;\nvarying float vLampGlow;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n\ttotalEmissiveRadiance *= lampGlowTint * vLampGlow;');
  };
  m.customProgramCacheKey = () => 'lamp-slat-glow-v1';
  return m;
}

/** r of a dense outline [[r, y]] (y decreasing) at height y, clamped to its ends. */
function outlineR(pts, y) {
  if (y >= pts[0][1]) return pts[0][0];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    if (y >= b[1]) return a[1] - b[1] < 1e-9 ? b[0] : a[0] + ((b[0] - a[0]) * (a[1] - y)) / (a[1] - b[1]);
  }
  return pts[pts.length - 1][0];
}

function buildPendantSlatted(spec) {
  const L = new Lamp('pendant-slatted', spec);
  const { w, d, h } = L.dims;
  const P = L.P;
  const prof = slatProfile(P, L.dims);
  const H0 = prof.pts[prof.pts.length - 1][0], D0 = Math.max(...prof.pts.map((p) => p[1]));
  const kr = Math.min(w, d) / D0, ky = h / H0;
  // tall soft-lacquer ceiling cup (Ø12.2 × 11.2 cm) in the metal colour, textile cord to the closed top
  const ch = canopy(L, { d: clamp(num(P.canopyD, 0.122), 0.06, 0.2), h: clamp(num(P.canopyH, 0.112), 0.02, 0.16), part: 'metal' });
  const drop = dropOf(L, SLAT_DROP, h + ch + 0.05);
  const yTop = -drop + h;
  const [turn, maxLen] = SLAT_STEP[spec.quality] || SLAT_STEP.medium;
  const dense = slatOutline(prof.pts, kr, ky); // [[r, y]], y relative to the top
  const S = slatSamples(dense, turn * DEG, maxLen);
  const t = clamp(num(P.slatT, 0.0025), 0.001, 0.008);
  // inside of the strips (the outline is the outer face) – dense, for the rings and the light
  const inner = dense.map((p, i) => {
    const a = dense[Math.max(0, i - 1)], b = dense[Math.min(dense.length - 1, i + 1)];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const nr = -(b[1] - a[1]) / l, ny = (b[0] - a[0]) / l; // outward normal = tangent turned
    return [p[0] - t * nr, p[1] - t * ny];
  });
  const rNeck = dense[0][0];
  const neckY = -slatNeck(prof.pts) * ky;
  // slats: `slats` strips tile the product's own neck (params.neckD, else the outline's), so the strip width stays
  // when the lamp is scaled or switched to the other family (more / fewer strips); a closed neck is tiled edge to edge
  // (hairline gaps), so fewer slats from the slider get wider and still hide the bulb
  const slats0 = Math.max(4, num(P.slats, SLAT_PROFILES[prof.family].slats));
  const tile = (Math.PI * clamp(num(P.neckD, prof.pts[0][1]), 0.03, 0.6)) / slats0;
  const N = clamp(Math.round((TAU * rNeck) / tile), 8, 160);
  const chord = 2 * rNeck * Math.sin(Math.PI / N);
  const sw = P.closedTop === false ? Math.min(num(P.slatW, 0.008), chord - SLAT_HAIRLINE) : chord - SLAT_HAIRLINE;
  const hw = Math.max(0.0015, sw) / 2;

  // the bulb sits in the closed neck; its direct light leaves through the neck's lower end
  const rIn = inner[0][0];
  const bulbR = clamp(rIn - 0.012, 0.012, 0.03);
  const yBulb = yTop - clamp(num(P.bulbAt, 0.1) * ky, bulbR + 0.006, Math.max(bulbR + 0.006, -neckY - bulbR - 0.004));
  const yExit = yTop + neckY, rExit = outlineR(inner, neckY);
  /** Direct light of the bulb on a point of the inside (0..1, plus what bounces around). */
  const glowAt = (p, n) => {
    const dx = -p[0], dy = yBulb - p[1], dz = -p[2];
    const dist = Math.hypot(dx, dy, dz) || 1e-3;
    let vis = 1;
    if (p[1] < yExit - 1e-4) {
      // below the neck: lit only where the ray from the bulb passes the neck's lower end
      const rho = dy > 1e-4 ? (Math.hypot(p[0], p[2]) * (yBulb - yExit)) / dy : Infinity;
      vis = clamp(1 - (rho - rExit) / 0.012, 0, 1);
    }
    const cos = Math.max(0, (n[0] * dx + n[1] * dy + n[2] * dz) / dist);
    const e = vis * cos * (SLAT_GLOW_REF / Math.max(dist, 0.03)) ** 2;
    // compressed (the light bounces between the strips, so the inside glows more evenly than direct light alone)
    return SLAT_GLOW_FLOOR + (1 - SLAT_GLOW_FLOOR) * Math.min(1, e) ** 0.4;
  };

  const outer = new SlatBuffer();
  const lit = new SlatBuffer(glowAt);
  const rnd = K.rng(`slats:${N}:${prof.family}`);
  for (let k = 0; k < N; k++) {
    const phi = ((k + 0.5) / N) * TAU;
    const sp = Math.sin(phi), cp = Math.cos(phi);
    const et = [cp, 0, -sp];
    // each strip its own piece of the veneer (texture offset), grain along the strip (u = length)
    const u0 = rnd.range(0, 0.8), v0 = rnd.range(0, 0.4);
    const OL = [], OR = [], QL = [], QR = [], SLo = [], SLi = [], SRo = [], SRi = [];
    for (const s of S) {
      const nr = -s.ty, ny = s.tr; // outward normal in the (r, y) plane
      const N3 = [nr * sp, ny, nr * cp];
      const In = [-N3[0], -N3[1], -N3[2]];
      const o = [s.r * sp, yTop + s.y, s.r * cp];
      const q = [(s.r - t * nr) * sp, yTop + s.y - t * ny, (s.r - t * nr) * cp];
      const at = (c, f) => [c[0] + et[0] * f, c[1], c[2] + et[2] * f];
      const u = s.len + u0;
      OL.push({ p: at(o, -hw), n: N3, uv: [u, v0] });
      OR.push({ p: at(o, hw), n: N3, uv: [u, v0 + 2 * hw] });
      QL.push({ p: at(q, -hw), n: In, uv: [u, v0] });
      QR.push({ p: at(q, hw), n: In, uv: [u, v0 + 2 * hw] });
      const nl = [-et[0], 0, -et[2]];
      SLo.push({ p: at(o, -hw), n: nl, uv: [u, 0] });
      SLi.push({ p: at(q, -hw), n: nl, uv: [u, t] });
      SRo.push({ p: at(o, hw), n: et, uv: [u, 0] });
      SRi.push({ p: at(q, hw), n: et, uv: [u, t] });
    }
    outer.strip(OL, OR);
    lit.strip(QL, QR);
    lit.strip(SLo, SLi);
    lit.strip(SRo, SRi);
    // end grain at the top and the bottom rim
    for (const [i, sgn] of [[0, -1], [S.length - 1, 1]]) {
      const s = S[i];
      const n = [s.tr * sp * sgn, s.ty * sgn, s.tr * cp * sgn];
      const e = (v) => ({ p: v.p, n, uv: [v.uv[1], 0] });
      lit.strip([e(OL[i]), e(QL[i])], [e(OR[i]), e(QR[i])]);
    }
  }
  L.add(outer.geometry(), L.mat('shade'), 'shade');

  // thin plywood rings inside the strips: bottom rim, neck base, top (under the cap), extra ones down the belly
  const nRings = clamp(Math.round(num(P.rings, 3)), 0, 8);
  const ringT = 0.004;
  const yBottom = dense[dense.length - 1][1];
  const levels = [];
  if (nRings >= 1) levels.push({ y: yBottom + 0.002 + ringT / 2, w: 0.009 });
  if (nRings >= 2) levels.push({ y: neckY, w: 0.007 });
  if (nRings >= 3) levels.push({ y: -0.006 - ringT / 2, w: 0.007 });
  for (let i = 3; i < nRings; i++) levels.push({ y: neckY + ((yBottom - neckY) * (i - 2)) / (nRings - 2), w: 0.007 });
  const rseg = Math.max(L.q.lathe, Math.min(96, N * 2));
  for (const lv of levels) {
    const yb = lv.y - ringT / 2, yt = lv.y + ringT / 2;
    const ro = Math.min(outlineR(inner, yb), outlineR(inner, yt)) - 0.0004;
    const ri = Math.max(0.005, ro - lv.w);
    const ring = (r, y, n) => {
      const row = [];
      for (let j = 0; j <= rseg; j++) {
        const a = (j / rseg) * TAU;
        const nn = n === 'out' ? [Math.sin(a), 0, Math.cos(a)] : n === 'in' ? [-Math.sin(a), 0, -Math.cos(a)] : n;
        row.push({ p: [Math.sin(a) * r, yTop + y, Math.cos(a) * r], n: nn, uv: [a * r, y] });
      }
      return row;
    };
    lit.strip(ring(ri, yt, [0, 1, 0]), ring(ro, yt, [0, 1, 0]));
    lit.strip(ring(ri, yb, [0, -1, 0]), ring(ro, yb, [0, -1, 0]));
    lit.strip(ring(ri, yt, 'in'), ring(ri, yb, 'in'));
    lit.strip(ring(ro, yt, 'out'), ring(ro, yb, 'out'));
  }
  L.glowAdd(lit.geometry(), slatGlowMaterial(L), 'inner', { castShadow: true });

  // closed top: a cap inside the neck, flush with the strip ends; cord grip, socket and the bulb hidden in the neck
  const capR = rIn - 0.0003;
  L.add(discGeo(2 * capR, 0.004, L.q.lathe, { y0: yTop - 0.004, round: 0.0008 }), L.mat('shade'), 'shade');
  L.add(K.cylinder(0.0055, 0.006, 0.012, { seg: L.q.rod + 2 }).translate(0, yTop, 0), L.mat('cord'), 'cord');
  hanger(L, 0, 0, ch, yTop + 0.012, { r: 0.0028, part: 'cord' });
  L.socket(0, yBulb + bulbR * 0.8, yTop - 0.004, 0, Math.min(0.018, rIn - 0.01), 'metal');
  L.bulb('globe', [0, yBulb, 0], bulbR, { intensity: 3 });

  // light: a warm downlight through the open bottom (the cone the neck lets out, softened by the strips) and the
  // soft spill the lit birch sends out between the strips
  const lm = L.lumens(806);
  const cone = Math.atan2(rExit, Math.max(0.02, yBulb - yExit));
  L.spot([0, yBulb - 0.01, 0], [0, -1, 0], lm * 0.7, cone, 0.65);
  const yMid = yTop + neckY + (yBottom - neckY) * 0.5;
  L.point([0, yMid, 0], lm * 0.3);
  return L.finish();
}

/** Flat LED ring (rectangular section): body = metal part, bottom LED face = glowing `ledPart`. */
function ledRing(L, { R, yb, x = 0, z = 0, wid = 0.03, hgt = 0.022, innerFace = null, ledPart = 'shade' }) {
  const seg = Math.max(L.q.lathe, 40);
  const ro = R, ri = R - wid;
  const body = L.mat('metal');
  // outer wall + top + inner wall (inner wall in its own part when innerFace)
  L.add(K.lathe([[ro, yb], [ro, yb + hgt]], { seg }).translate(x, 0, z), body, 'metal');
  L.add(K.lathe([[ro, yb + hgt], [ri, yb + hgt]], { seg }).translate(x, 0, z), body, 'metal');
  const inWall = K.lathe([[ri, yb + hgt], [ri, yb]], { seg }).translate(x, 0, z);
  if (innerFace) L.auto(inWall, innerFace, 'inner');
  else L.add(inWall, body, 'metal');
  // LED diffuser underneath (slightly inset)
  L.glowAdd(K.lathe([[ri + 0.002, yb + 0.001], [ro - 0.002, yb + 0.001]], { seg }).translate(x, 0, z), L.glow(ledPart, 1.8), ledPart);
  L.add(K.lathe([[ri, yb + 0.0015], [ri + 0.002, yb + 0.0015]], { seg }).translate(x, 0, z), body, 'metal');
  L.add(K.lathe([[ro - 0.002, yb + 0.0015], [ro, yb + 0.0015]], { seg }).translate(x, 0, z), body, 'metal');
}

function buildCeilingRing(spec) {
  const L = new Lamp('ceiling-ring', spec);
  const { w, d, h } = L.dims;
  const P = L.P;
  const style = P.style || (Array.isArray(P.rings) ? 'multi' : P.rods ? 'crown' : P.arm ? 'arm' : 'halo');
  const lm = L.lumens(style === 'multi' ? 3000 : 2000);
  const R = w / 2;
  if (style === 'arm') {
    // kitchen: horizontal LED ring on a cranked flat arm from a small cup
    const ch = canopy(L, { d: 0.1, h: 0.03 });
    const drop = dropOf(L, 0.15, 0.06 + ch);
    const hgt = 0.022, yb = -drop;
    ledRing(L, { R, yb, wid: 0.028, hgt, ledPart: 'inner' });
    const side = [0, 0, 1];
    const a = [0, -ch + 0.004, 0], b = [-0.035, -ch - 0.012, 0], c = [-R + 0.014, yb + hgt + 0.004, 0];
    L.add(bar(a, b, 0.026, 0.006, side), L.mat('metal'), 'metal');
    L.add(bar(b, c, 0.026, 0.006, side), L.mat('metal'), 'metal');
    L.add(bar(c, [-R + 0.014, yb + hgt - 0.002, 0], 0.026, 0.006, side), L.mat('metal'), 'metal');
    L.spot([0, yb, 0], [0, -1, 0], lm, 1.25, 1);
    return L.finish();
  }
  if (style === 'multi') {
    // overlapping rings (TV-stue): black band, gold inside, LED underneath, gold hub with rods
    const ch = canopy(L, { d: 0.14, h: 0.02 });
    const drop = dropOf(L, 0.1, 0.06 + ch);
    const rings = (Array.isArray(P.rings) && P.rings.length ? P.rings : [0.45, 0.4, 0.3]).map((x) => clamp(num(x, 0.4), 0.1, Math.max(w, d)));
    const layout = ringLayout(rings, w, d);
    const gold = L.innerMat('inner', 0.35);
    const hgt = 0.028, wid = 0.034;
    layout.forEach((c, i) => {
      const yb = -drop + c.lift;
      ledRing(L, { R: c.r, yb, x: c.x, z: c.z, wid, hgt, innerFace: gold, ledPart: 'shade' });
      // rod from the hub to the ring's nearest point
      const dx = -c.x, dz = -c.z;
      const dl = Math.hypot(dx, dz) || 1;
      const px = c.x + (dx / dl) * (c.r - wid / 2), pz = c.z + (dz / dl) * (c.r - wid / 2);
      L.add(rod([px * 0.35, -ch - 0.03, pz * 0.35], [px, yb + hgt, pz], 0.0025, 6), L.mat('inner'), 'inner');
      if (i === 0) L.add(K.cylinder(0.05, 0.05, 0.032, { seg: L.q.lathe }).translate(0, -ch - 0.035, 0), L.mat('inner'), 'inner');
    });
    L.spot([0, -drop, 0], [0, -1, 0], lm, 1.3, 1);
    return L.finish();
  }
  if (style === 'crown') {
    // ring of hanging glass rods on a black band, LED ring inside, three wires to the canopy (Bliss)
    const ch = canopy(L, { d: 0.12, h: 0.03 });
    const rodL = clamp(h * 0.35, 0.05, 0.14);
    const drop = dropOf(L, 1.0, rodL + 0.08 + ch);
    const yb = -drop;
    const bandH = 0.022;
    const yBand = yb + rodL - bandH * 0.6;
    const seg = Math.max(L.q.lathe, 40);
    const body = L.mat('metal');
    L.add(K.cylinder(R - 0.006, R - 0.006, bandH, { seg, open: true }).translate(0, yBand, 0), L.mat('metal', { side: 'double' }), 'metal');
    L.add(K.lathe([[R - 0.006, yBand + bandH], [R - 0.02, yBand + bandH]], { seg }), body, 'metal');
    L.glowAdd(K.lathe([[R - 0.02, yBand + 0.002], [R - 0.008, yBand + 0.002]], { seg }), L.glow('inner', 1.8), 'inner');
    const n = clamp(Math.round(num(P.rods, 36)), 8, 120);
    const gm = L.isGlass('shade') ? L.glow('shade', 0.3, { opacity: 0.42, envMapIntensity: 2 }) : L.shadeMat('shade', 0.5);
    const rnd = K.rng(`crown:${n}`);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU;
      const len = rodL * (i % 2 ? 0.86 : 1) * rnd.range(0.97, 1.03);
      const g = K.box(0.012, len, 0.012, { grain: 'y' });
      xf(g, [Math.sin(a) * R, yb + rodL - len / 2, Math.cos(a) * R], [0, a, 0]);
      L.auto(g, gm, 'shade');
      L.add(K.box(0.014, 0.008, 0.014).rotateY(a).translate(Math.sin(a) * R, yb + rodL - 0.002, Math.cos(a) * R), body, 'metal');
    }
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * TAU;
      L.add(rod([0, -ch, 0], [Math.sin(a) * (R - 0.012), yBand + bandH, Math.cos(a) * (R - 0.012)], 0.0007, 4), L.mat('cord'), 'cord');
    }
    L.point([0, yBand - 0.02, 0], lm);
    return L.finish();
  }
  // halo: one LED ring on three wires
  const ch = canopy(L, { d: 0.1, h: 0.025 });
  const drop = dropOf(L, 0.3, 0.05 + ch);
  const yb = -drop;
  ledRing(L, { R, yb, wid: clamp(w * 0.06, 0.02, 0.05), hgt: 0.024, ledPart: 'shade' });
  if (drop > ch + 0.06) {
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * TAU;
      L.add(rod([0, -ch, 0], [Math.sin(a) * (R - 0.012), yb + 0.024, Math.cos(a) * (R - 0.012)], 0.0007, 4), L.mat('cord'), 'cord');
    }
  }
  L.spot([0, yb, 0], [0, -1, 0], lm, 1.3, 1);
  return L.finish();
}

/**
 * Positions of 1–5 overlapping rings inside a w × d footprint, as the TV-stue lamp hangs (photo 082726, looking
 * west): largest toward −x (north) and +z, the second toward +x, the smallest lowest toward −z.
 */
function ringLayout(rings, w, d) {
  const sorted = rings.map((d0, i) => ({ r: d0 / 2, i })).sort((a, b) => b.r - a.r);
  const out = [];
  if (sorted.length === 1) return [{ ...sorted[0], x: 0, z: 0, lift: 0 }];
  const big = sorted[0], mid = sorted[1], small = sorted[2];
  out.push({ r: big.r, x: -(w / 2 - big.r), z: d / 2 - big.r, lift: 0.022 });
  out.push({ r: mid.r, x: w / 2 - mid.r, z: small ? (d / 2 - big.r) * 0.25 : -(d / 2 - mid.r), lift: 0.012 });
  if (small) out.push({ r: small.r, x: (out[0].x + out[1].x) / 2 - (big.r - mid.r), z: -(d / 2 - small.r), lift: 0 });
  for (let k = 3; k < sorted.length; k++) out.push({ r: sorted[k].r, x: 0, z: 0, lift: 0.032 + k * 0.01 });
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// The «molecule» chandelier (existing, over the sitting area): 8 near-spherical shades in two sizes on black rods
// with knuckle joints, two main arms from a ball hub, measured from photos 083006 / 083012 / 082809.

/**
 * Template (w = 1 m, y relative to the hub, x = south and z = west as it hangs today): nodes, rods, shades { from,
 * at, big, dir } (dir = opening). Reconstructed from the two calibrated photos 082806 (from the TV-stue, nearly
 * orthographic: z and height) and 083012 (from the sofa: rays → x), matched by height (≈ 2 cm apart on average);
 * openings from which photo shows them lit, knuckles read off 082806. Two main arms with two knuckles each, two
 * shades per knuckle, 4 large + 4 small (room-spec says Ø20 / Ø13; against the span the photos 083012 / 083006 give
 * ≈ Ø16 / Ø10.5, the archetype default).
 */
const MOLECULE = {
  nodes: {
    H: [0, 0, 0],
    K1: [0.05, -0.12, -0.07], K2: [0.13, -0.155, -0.18],
    K3: [-0.05, -0.04, 0.1], K4: [0.13, -0.165, 0.2],
  },
  rods: [['H', 'K1'], ['K1', 'K2'], ['H', 'K3'], ['K3', 'K4']],
  // order = priority when fewer shades are asked for; big: true = the large size
  shades: [
    { from: 'K2', at: [0.4, -0.1, -0.33], big: true, dir: [-0.3, -0.8, 0.4] },
    { from: 'K3', at: [-0.19, 0.0, 0.275], big: true, dir: [0.3, -0.2, 0.9] },
    { from: 'K3', at: [-0.375, -0.195, 0.08], big: true, dir: [-0.9, -0.2, -0.3] },
    { from: 'K1', at: [0.2, -0.06, -0.27], big: true, dir: [0.1, 0.9, -0.3] },
    { from: 'K4', at: [0.13, -0.116, 0.38], big: false, dir: [-0.3, -0.6, 0.6] },
    { from: 'K1', at: [-0.12, -0.2, -0.02], big: false, dir: [0.3, -0.4, -0.85] },
    { from: 'K2', at: [-0.045, -0.286, -0.22], big: false, dir: [0.25, -0.35, -0.9] },
    { from: 'K4', at: [0.305, -0.315, 0.22], big: false, dir: [0.6, -0.7, 0.3] },
  ],
};

function buildChandelierMolecule(spec) {
  const L = new Lamp('chandelier-molecule', spec);
  const { w, d } = L.dims;
  const P = L.P;
  const [ws, hs] = L.q.sph;
  const canopyD = clamp(num(P.canopyD, 0.12), 0.06, 0.3);
  const ch = canopy(L, { d: canopyD, h: 0.045, part: 'base' });
  const drop = dropOf(L, 0.79, 0.25);
  const hubDrop = clamp(num(P.hubDrop, num(P.rod, 0.42)), ch + 0.03, drop - 0.12);
  const n = clamp(Math.round(num(P.shades, 8)), 3, 12);
  const sizes = Array.isArray(P.shadeD) ? P.shadeD : null;
  const big = num(sizes ? Math.max(...sizes) : P.shadeD, 0.16);
  const small = num(sizes ? Math.min(...sizes) : P.shadeD, big * 0.65);
  // shade list: the template, plus extra ones on the main knuckles for n > 8
  const list = MOLECULE.shades.slice(0, Math.min(n, 8)).map((s) => ({ ...s }));
  const rnd = K.rng(`molecule:${n}`);
  for (let i = 8; i < n; i++) {
    const side = i % 2 ? 1 : -1;
    const at = [-side * rnd.range(0.15, 0.3), rnd.range(-0.25, -0.05), rnd.range(-0.3, 0.3)];
    list.push({ from: side < 0 ? 'K2' : 'K4', at, big: i % 3 === 0, dir: [at[0], -0.3, at[2]] });
  }
  // sizes in the order of the existing spec (4 large, then 4 small)
  let bi = 0, si = 0;
  const bigs = sizes ? sizes.filter((v) => v >= (big + small) / 2) : [];
  const smalls = sizes ? sizes.filter((v) => v < (big + small) / 2) : [];
  for (const s of list) s.r = (s.big ? bigs[bi++] ?? big : smalls[si++] ?? small) / 2;
  // scale the template: x extent → w, z by the same factor (capped by d), y so the lowest shade ends at drop
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const s of list) {
    minX = Math.min(minX, s.at[0] - s.r);
    maxX = Math.max(maxX, s.at[0] + s.r);
    minZ = Math.min(minZ, s.at[2] - s.r);
    maxZ = Math.max(maxZ, s.at[2] + s.r);
  }
  const rMax = Math.max(...list.map((s) => s.r));
  const sx = Math.max(0.3, (w - 2 * rMax) / Math.max(0.1, maxX - minX - 2 * rMax));
  const sz = Math.min(sx, Math.max(0.3, (d - 2 * rMax) / Math.max(0.1, maxZ - minZ - 2 * rMax)));
  // every shade bottom must end at or above the drop; the lowest one exactly there
  const span = drop - hubDrop;
  let sy = Infinity;
  for (const s of list) if (s.at[1] < -0.02) sy = Math.min(sy, (span - s.r) / -s.at[1]);
  sy = clamp(Number.isFinite(sy) ? sy : 1, 0.3, 4);
  const hubY = -hubDrop;
  const P3 = (p) => new THREE.Vector3(p[0] * sx, hubY + p[1] * sy, p[2] * sz);
  const nodes = Object.fromEntries(Object.entries(MOLECULE.nodes).map(([k, p]) => [k, P3(p)]));
  const metal = L.mat('metal');
  const rodR = 0.0055;
  // stem from the canopy to the hub (textile-wrapped)
  cord(L, 0, 0, -ch, hubY + 0.01, { r: 0.0045, part: 'cord' });
  L.add(K.cylinder(0.008, 0.008, 0.03, { seg: 10 }).translate(0, hubY + 0.008, 0), metal, 'metal');
  L.add(xf(K.sphere(0.017, { wSeg: 14, hSeg: 10 }), nodes.H), metal, 'metal');
  for (const [a, b] of MOLECULE.rods) {
    L.add(rod(nodes[a], nodes[b], rodR, L.q.rod), metal, 'metal');
  }
  // knuckles: short cylinders across the incoming rod
  for (const [a, b] of MOLECULE.rods) {
    const dir = nodes[b].clone().sub(nodes[a]).normalize();
    const g = K.cylinder(0.011, 0.011, 0.026, { seg: 12, center: true });
    L.add(xf(g, nodes[b], aim(new THREE.Vector3(-dir.z, 0.15, dir.x))), metal, 'metal');
  }
  // shades: ~3/4 spheres (opening half-angle 42°), rod into the back, socket neck, visible bulb
  const alpha = 42 * DEG;
  const shadeM = L.mat('shade');
  // brass insides lit by the bulb: kept below white-out, so they read gold/amber as in 083012 (the bulbs stay hot)
  const innerM = L.innerMat('inner', 0.1);
  const bulbs = [];
  for (const s of list) {
    const from = nodes[s.from];
    const c = P3(s.at);
    const dir = s.dir ? v3(s.dir).normalize() : c.clone().sub(from).normalize();
    const q = aim(dir);
    const r = s.r, t = 0.0018;
    const outer = K.sphere(r, { wSeg: ws, hSeg: hs, thetaStart: alpha, thetaLength: Math.PI - alpha });
    const inner = K.sphere(r - t, { wSeg: ws, hSeg: hs, thetaStart: alpha, thetaLength: Math.PI - alpha });
    flip(inner);
    const rim = K.lathe([[r * Math.sin(alpha), r * Math.cos(alpha)], [(r - t) * Math.sin(alpha), (r - t) * Math.cos(alpha)]], { seg: ws });
    L.add(xf(outer, c, q), shadeM, 'shade');
    L.add(xf(rim, c, q), shadeM, 'shade');
    L.auto(xf(inner, c, q), innerM, 'inner');
    // neck at the back and the rod from the knuckle
    const back = c.clone().addScaledVector(dir, -r * 0.96);
    const neckEnd = c.clone().addScaledVector(dir, -r - 0.022);
    L.add(rod(back, neckEnd, 0.012, 12, 0.014), metal, 'metal');
    L.add(rod(from, neckEnd, rodR, L.q.rod), metal, 'metal');
    // ball joint where the rod meets the socket (the shades are adjustable)
    L.add(xf(K.sphere(0.0105, { wSeg: 10, hSeg: 8 }), neckEnd), metal, 'metal');
    const bp = c.clone().addScaledVector(dir, r * 0.12);
    bulbs.push({ p: bp, dir });
    L.bulb('globe', bp, r * 0.3, { intensity: 1, warmth: 0.6 });
  }
  // Light. The room gets one point light for all bulbs, just under the shades: inside the fixture it would
  // floodlight its own black arms and shells (item lights cast no shadows), the openings carry the look through their
  // glow. The shades that open upward or sideways throw warm pools on the ceiling (082806, 083006, 083012): the two
  // with the most light above the horizon (≈ 15 % of the flux; the room keeps the full point light) get a pool where
  // the brightest part of it meets the ceiling – decals, not spots: item spots compete for a handful of light slots
  // and lose them as soon as the camera is a few metres away, so the pools would come and go.
  const total = L.lumens(2000);
  const per = total / bulbs.length;
  const ups = [];
  for (const b of bulbs) {
    const e = Math.asin(clamp(b.dir.y, -1, 1));
    const hi = e + MOLECULE_SPILL;
    if (hi < 25 * DEG) continue;
    const lo = Math.max(0, e - MOLECULE_SPILL);
    ups.push({ ...b, e, lo, hi, share: clamp((hi - lo) / (2 * MOLECULE_SPILL), 0, 1) });
  }
  ups.sort((a, b) => b.share - a.share);
  const ctr = bulbs.reduce((a, b) => a.add(b.p), new THREE.Vector3()).multiplyScalar(1 / bulbs.length);
  L.point([ctr.x, -drop + 0.06, ctr.z], total);
  for (const u of ups.slice(0, 2)) {
    // a sideways shade lights the ceiling with the upper part of its beam, brightest near the top edge (steepest)
    const up = u.e >= MOLECULE_SPILL;
    const el = up ? u.e : u.hi - (u.hi - u.lo) * 0.3;
    const az = Math.atan2(u.dir.x, u.dir.z);
    const a = up ? u.dir : new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
    const t = -u.p.y / Math.max(0.2, a.y); // along the ray to the ceiling plane (y = 0)
    if (!(t > 0)) continue;
    const half = clamp((u.hi - u.lo) / 2, 0.3, MOLECULE_BEAM);
    const cd = (per * u.share) / (TAU * (1 - Math.cos(half)));
    const lux = (cd * a.y) / (t * t);
    // luminance from the beam's illuminance on a white ceiling (reflectance 0.8); size: footprint plus its soft edge
    ceilingPool(L, u.p.x + a.x * t, u.p.z + a.z * t, clamp(t * Math.tan(half) * 1.8, 0.35, 0.95), (0.8 * lux) / Math.PI, total);
  }
  return L.finish();
}

/** Half-angle of the direct light leaving a molecule shade (3/4 sphere, 42° opening, bulb 0.12 r toward it). */
const MOLECULE_BEAM = 47 * DEG;
/** … and of the light the brass inside scatters out of it (what reaches the ceiling from a sideways shade). */
const MOLECULE_SPILL = 60 * DEG;

/** Inverts a geometry's faces and normals (inner surfaces seen from inside). */
function flip(geo) {
  const idx = geo.index;
  if (idx) {
    for (let i = 0; i < idx.count; i += 3) {
      const t = idx.getX(i + 1);
      idx.setX(i + 1, idx.getX(i + 2));
      idx.setX(i + 2, t);
    }
    idx.needsUpdate = true;
  }
  const n = geo.attributes.normal;
  for (let i = 0; i < n.count; i++) n.setXYZ(i, -n.getX(i), -n.getY(i), -n.getZ(i));
  n.needsUpdate = true;
  return geo;
}

// ---------------------------------------------------------------------------------------------------------------
// Floor lamps

/** Horizontal scale factor: dims.w against the natural width from the params (1 at the catalogue size). */
function kScale(L, natW) {
  return natW > 0 ? clamp(L.dims.w / natW, 0.3, 4) : 1;
}

/**
 * Foot by shape: 'disc' | 'rect' | 'dome' | 'cylinder' | 'bullet' | 'cone' | 'stacked-pebbles' | 'vase' | 'wavy-column' |
 * 'candlestick' (turned stem with beads) | 'ball' (a sphere of Ø D on a small disc; H is not used).
 * Returns its top y.
 */
function foot(L, shape, { D, H, W, Dd, sph = null }) {
  const seg = L.q.lathe;
  const m = L.mat('base');
  switch (shape) {
    case 'candlestick': {
      // turned candlestick: a round base disc, a slim stem with two or three beads, a collar under the socket
      const r = D / 2;
      const rs = clamp(D * 0.09, 0.007, 0.016);
      const rb = clamp(D * 0.15, rs * 1.5, 0.026);
      const base = clamp(H * 0.06, 0.008, 0.02);
      const prof = [[0.0005, 0], [r, 0], [r, base * 0.55], [r * 0.82, base], [rs * 1.7, base + 0.012], [rs, base + 0.026]];
      const y0 = base + 0.03, y1 = H - 0.022;
      const beads = clamp(Math.floor((y1 - y0) / (rb * 3.2)), 0, 3);
      for (let i = 0; i < beads; i++) {
        // beads spread over the stem, the lowest one heaviest
        const yc = y0 + ((y1 - y0) * (i + 0.5)) / beads;
        const rr = rb * (1 - i * 0.12);
        prof.push([rs, yc - rr * 1.15], [rr * 0.8, yc - rr * 0.6], [rr, yc], [rr * 0.8, yc + rr * 0.6], [rs, yc + rr * 1.15]);
      }
      prof.push([rs, Math.max(y0, H - 0.014)], [rs * 1.6, H - 0.009], [rs * 1.6, H], [0.0005, H]);
      L.add(K.lathe(prof, { seg }), L.mat('base', woodGrain(L)), 'base');
      return H;
    }
    case 'ball': {
      // a ball resting on a small round foot (the foot hides in the ball's shadow)
      const r = D / 2;
      const [ws, hs] = L.q.sph;
      L.add(discGeo(Math.min(D * 0.55, 0.12), 0.01, seg, { round: 0.003 }), m, 'base');
      L.add(xf(K.sphere(r, { wSeg: ws + 8, hSeg: hs + 4 }), [0, r, 0]), m, 'base');
      return r * 1.94;
    }
    case 'bullet': {
      // tall cylinder with a half-round top (Globen Torrano's travertine foot)
      const r = D / 2;
      const prof = [[0.0005, 0], [r - 0.003, 0], [r, 0.003], [r, Math.max(0.004, H - r)]];
      for (let i = 1; i <= 8; i++) {
        const a = (i / 8) * (Math.PI / 2);
        prof.push([Math.max(0.0005, r * Math.cos(a)), Math.max(0.004, H - r) + r * Math.sin(a)]);
      }
      L.add(K.lathe(prof, { seg }), m, 'base');
      return Math.max(0.004, H - r) + r;
    }
    case 'rect':
      L.add(K.roundedBox(W, H, Dd, Math.min(0.004, H / 3), 2).translate(0, H / 2, 0), m, 'base');
      return H;
    case 'dome':
      return footDome(L, D, H);
    case 'cylinder':
      L.add(discGeo(D, H, seg, { round: Math.min(0.006, D * 0.05) }), L.mat('base', woodGrain(L)), 'base');
      return H;
    case 'cone': {
      const r = D / 2;
      L.add(K.lathe([[0.0005, 0], [r, 0], [r * 0.98, 0.006], [r * 0.52, H], [0.0005, H]], { seg }), m, 'base');
      return H;
    }
    case 'stacked-pebbles': {
      const rnd = K.rng(`pebbles:${D.toFixed(3)}:${H.toFixed(3)}`);
      const nP = 6;
      const hs = [];
      for (let i = 0; i < nP; i++) hs.push(rnd.range(0.85, 1.15) * (1 - i * 0.04));
      const sum = hs.reduce((a, b) => a + b, 0);
      let y = 0;
      const [ws, hs2] = sph || L.q.sph;
      for (let i = 0; i < nP; i++) {
        const ph = (hs[i] / sum) * H;
        const rx = (D / 2) * rnd.range(0.78, 1.0) * (1 - i * 0.03);
        const g = K.sphere(1, { wSeg: ws, hSeg: hs2 });
        xf(g, [rnd.range(-0.006, 0.006), y + ph / 2, rnd.range(-0.006, 0.006)], [0, rnd.range(0, 3), rnd.range(-0.04, 0.04)], [rx, ph / 2 * 1.06, rx * rnd.range(0.85, 1)]);
        L.add(g, m, 'base');
        y += ph;
      }
      return H;
    }
    case 'vase': {
      const r = D / 2;
      const prof = [[0.0005, 0], [r * 0.62, 0], [r * 0.66, 0.03 * H], [r * 0.62, 0.07 * H], [r * 0.9, 0.18 * H], [r, 0.32 * H], [r * 0.93, 0.5 * H], [r * 0.66, 0.72 * H], [r * 0.5, 0.86 * H], [r * 0.54, 0.95 * H], [r * 0.5, H], [0.012, H]];
      L.add(K.lathe(prof, { seg }), L.mat('base', { roughness: 0.85 }), 'base');
      return H;
    }
    case 'wavy-column': {
      const r = D / 2;
      const g = K.lathe([[0.0005, 0], [r, 0], [r, H * 0.5], [r, H], [0.0005, H]], { seg: Math.max(seg, 48) });
      modulate(g, (phi) => 1 - 0.24 * Math.abs(Math.sin(2 * phi)) ** 1.6);
      L.add(g, m, 'base');
      return H;
    }
    default:
      return footDisc(L, D, H || 0.025);
  }
}

/** Wood kinds get the grain along the height of turned parts. */
function woodGrain(L, part = 'base') {
  return /oak|walnut|teak|ash/.test(L.kind(part)) ? { grain: 'v' } : undefined;
}

/** Collider boxes for a floor lamp: foot + pole column + shade. */
function floorColliders(L, footR, shade) {
  L.colliders.push({ min: [-footR, 0, -footR], max: [footR, L.dims.h * 0.9, footR] });
  if (shade) L.colliders.push(shade);
}

/** Default top Ø / bottom Ø of the tapered shade shapes (params.shadeTopD overrides). */
const SHADE_TAPER = { cone: 0.6, pleated: 0.8, empire: 0.55 };

/**
 * The shade of a lamp on a foot (floor-pole-shade, table-shade), bottom at yb, Ø 2R at the bottom → 2Rtop at the top
 * (cone, pleated, empire), height H: 'drum' | 'cylinder' | 'cone' | 'pleated' (P.pleats) | 'wavy' | 'empire' (bell-curved
 * taper) | 'woven' | 'lantern' (P.ribs, openingBottomD/TopD, asymmetric; `lantern` = extra lanternShade options) |
 * 'rect' (`depth` deep) | 'tiered-slats' | 'dome' (opaque metal). Returns { bulb, angle? } – `angle` only for the dome,
 * whose light is a spot down.
 */
function poleShade(L, shape, { R, Rtop = R, H, yb, depth = 2 * R, P = L.P, k = 1, h = L.dims.h, bulbR = 0.03, closedTop = false, spider = true, lantern = null }) {
  if (shape === 'rect') return { bulb: boxShade(L, { W: 2 * R, D: depth, H, yb }) };
  if (shape === 'woven') return { bulb: wovenShade(L, { R, Rtop, H, yb }) };
  if (shape === 'lantern') return { bulb: lanternShade(L, { R, H, yb, ribs: num(P.ribs, 0), rBottom: num(P.openingBottomD, 0) * k / 2, rTop: num(P.openingTopD, 0) * k / 2, organic: !!P.asymmetric, ...(lantern || {}) }) };
  if (shape === 'tiered-slats') return { bulb: slatTiers(L, { P, k, yb, h }) };
  if (shape === 'dome') return domeShade(L, { R, H, yb });
  const pleats = shape === 'pleated' ? clamp(Math.round(num(P.pleats, 40)), 12, 120) : 0;
  const taper = shape === 'cone' || shape === 'pleated' || shape === 'empire';
  const o = { R, Rtop: taper ? Rtop : R, H, yb, bulbR, closedTop, spider, ...(pleats ? pleatOpts(L, pleats, R) : {}) };
  if (shape === 'wavy') o.mod = (phi) => 1 - 0.2 * Math.abs(Math.sin(2 * phi)) ** 1.6;
  // empire: nearly upright at the rim, curving in toward the top
  if (shape === 'empire') o.profile = [0, 0.2, 0.45, 0.7, 1].map((u) => [R + (o.Rtop - R) * u ** 1.25, yb + H * u]);
  return { bulb: drumShade(L, o) };
}

/**
 * Foot + pole + shade. params: shadeShape 'drum' | 'cylinder' | 'cone' | 'pleated' | 'woven' | 'lantern' | 'rect' |
 * 'tiered-slats' (see the shade helpers), shadeD / shadeTopD / shadeH, shadeBottomAt (shade bottom above the floor –
 * else the shade sits at the top), closedTop, capD / capH / finialH (pointed metal cap on top), finialD (knob on top),
 * baseShape (foot()) or 'tripod' (wooden legs to a hub at baseH, the pole above it), baseD / baseH, poleCount (0 = no
 * pole: the shade stands on its column/plinth), poleD, frame 'cage' (four flat bars around the shade instead of a pole).
 */
function buildFloorPoleShade(spec) {
  const L = new Lamp('floor-pole-shade', spec);
  const { w, d, h } = L.dims;
  const P = L.P;
  const shape = P.shadeShape || 'drum';
  const baseShape = P.baseShape || 'disc';
  const cage = P.frame === 'cage';
  const sD0 = num(P.shadeD, w), bD0 = num(P.baseD, Math.min(0.28, w * 0.7));
  const k = kScale(L, Math.max(sD0, bD0, cage ? num(P.frameD, 0) : 0));
  const sD = sD0 * k, bD = bD0 * k;
  const atY = num(P.shadeBottomAt, NaN);
  const sH = Number.isFinite(atY) ? Math.min(num(P.shadeH, sD0 * 0.7) * k, h - Math.min(atY, h * 0.9) - (cage ? num(P.frameTopH, 0.09) : 0)) : Math.min(num(P.shadeH, sD0 * 0.7) * k, h * 0.55);
  const sDepth = shape === 'rect' ? Math.min(d, num(P.shadeDepth, d * 0.75) * k) : sD;
  const yb = Number.isFinite(atY) ? clamp(atY, 0, h - sH) : h - sH;
  const metal = L.mat('metal');
  let baseTop;
  const baseH = num(P.baseH, 0);
  // a tall ceramic vase / column foot (Myers H59) is a plinth like the cylinder; a low one stays a flat foot
  const tallFoot = baseH > 0.06 && (baseShape === 'vase' || baseShape === 'wavy-column' || baseShape === 'dome');
  if (baseShape === 'tripod') {
    baseTop = tripodFoot(L, { D: bD, H: clamp(baseH > 0 ? baseH : yb * 0.6, 0.2, yb - 0.05), legs: num(P.legCount, 3), legW: num(P.legW, 0.03), hubD: num(P.hubD, 0.12), hubH: num(P.hubH, 0.04) });
  } else if (baseShape === 'cone' || baseShape === 'stacked-pebbles' || baseShape === 'cylinder' || baseShape === 'bullet' || tallFoot) {
    // a plinth narrower than the shade may reach up into it (Watt & Veke Alba), else it ends under the shade
    const bh = Math.min(baseH > 0 ? baseH : h * 0.4, bD < sD * 0.9 ? yb + sH * 0.3 : Math.max(0.01, yb - 0.01));
    const pd = baseShape === 'stacked-pebbles' ? Math.min(bD, sD * 0.34) : bD;
    baseTop = foot(L, baseShape, { D: pd, H: bh });
  } else if (baseShape === 'rect') {
    const poles = Math.max(1, Math.round(num(P.poleCount, 2)));
    const W = Math.max(bD, poles > 1 ? sD * 0.5 + 0.06 : bD);
    // the foot plate gives the lamp its depth (Turner: shade 15 cm deep on a 20 cm deep foot = dims.d)
    baseTop = foot(L, 'rect', { W, Dd: Math.max(0.1, sDepth, Math.min(d, num(P.baseDepth, d))), H: 0.02 });
  } else baseTop = foot(L, baseShape, { D: bD, H: baseH > 0 ? Math.min(baseH, 0.06) : 0.025 });
  // pole(s) up into the shade (none with a cage frame or poleCount 0)
  const poles = cage ? 0 : Math.max(0, Math.round(num(P.poleCount, 1)));
  const poleTop = shape === 'cylinder' && baseShape === 'cone' ? yb + 0.02 : shape === 'tiered-slats' ? yb + sH * 0.15 : yb + sH * 0.3;
  const poleR = Number.isFinite(P.poleD) ? clamp(P.poleD / 2, 0.005, 0.02) : poles > 1 ? 0.007 : 0.0095;
  for (let i = 0; i < poles; i++) {
    const x = poles === 1 ? 0 : (i / (poles - 1) - 0.5) * sD * 0.5;
    if (poleTop - baseTop > 0.01) L.add(K.cylinder(poleR, poleR, poleTop - baseTop + 0.005, { seg: L.q.rod + 2 }).translate(x, baseTop - 0.005, 0), L.mat(baseShape === 'tripod' ? 'base' : 'metal', baseShape === 'tripod' ? woodGrain(L) : undefined), baseShape === 'tripod' ? 'base' : 'metal');
  }
  // the socket comes up from the pole top – or from the plinth when there is no pole; a cage hangs it from the top
  const sockFrom = poles ? poleTop : Math.max(baseTop, yb);
  // tapered shapes: shadeD = Ø at the bottom, shadeTopD = Ø at the top
  const Rtop = (num(P.shadeTopD, sD0 * (SHADE_TAPER[shape] ?? 1)) * k) / 2;
  const closed = !!P.closedTop;
  const res = poleShade(L, shape, { R: sD / 2, Rtop, H: sH, yb, depth: sDepth, P, k, h, bulbR: 0.03, closedTop: closed, spider: !closed && !cage });
  const bulb = res.bulb;
  if (shape === 'rect' && poles > 1) L.add(K.box(sD * 0.5, 0.008, 0.012).translate(0, yb + sH * 0.3, 0), metal, 'metal');
  if (!cage && shape !== 'rect') L.socket(0, sockFrom, bulb[1] - 0.03, 0, 0.016);
  // pointed metal cap over a shallow (parasol) shade, knob on a closed top
  const top = yb + sH;
  if (num(P.capD, 0) > 0) {
    const cR = (P.capD * k) / 2, cH = num(P.capH, 0.05) * k, fH = num(P.finialH, 0) * k;
    const c = L.q.lathe;
    L.add(K.lathe([[0.004, top - cH * 0.9], [cR, top - cH * 0.9], [cR * 0.98, top - cH * 0.82], [cR * 0.22, top + cH * 0.1], [0.004, top + cH * 0.12]], { seg: c }), metal, 'metal');
    if (fH > 0) L.add(K.lathe([[0.0005, top + cH * 0.08], [0.009, top + cH * 0.08], [0.0005, top + cH * 0.08 + fH]], { seg: 12 }), metal, 'metal');
  }
  if (num(P.finialD, 0) > 0) {
    const r = (P.finialD * k) / 2;
    L.add(xf(K.sphere(r, { wSeg: 14, hSeg: 10 }), [0, top + r * 0.8, 0]), L.mat('base', woodGrain(L)), 'base');
  }
  if (cage) cageFrame(L, { R: (num(P.frameD, sD0 + 0.02) * k) / 2, yb, top, plateY: baseTop, barW: num(P.barW, 0.012), topH: num(P.frameTopH, 0.09), bulb });
  if (res.angle) L.spot(bulb, [0, -1, 0], L.lumens(806), res.angle, 0.8);
  else L.point(bulb, L.lumens(806));
  const sR = Math.max(sD / 2, shape === 'tiered-slats' ? (Math.max(...(P.tierD || [sD0])) * k) / 2 : 0);
  floorColliders(L, Math.max(0.05, bD / 2), { min: [-sR, yb, -Math.max(sR, sDepth / 2)], max: [sR, h, Math.max(sR, sDepth / 2)] });
  return L.finish();
}

/**
 * Wooden tripod under a pole (IKEA LAUTERS): `legs` square legs (legW) from a circle of Ø D on the floor up to the
 * underside of a round hub (hubD × hubH) whose top is at H. Returns H.
 */
function tripodFoot(L, { D, H, legs = 3, legW = 0.03, hubD = 0.12, hubH = 0.04 }) {
  const m = L.mat('base', woodGrain(L));
  const n = clamp(Math.round(legs), 3, 5);
  const fr = D / 2 - legW / 2;
  const hr = hubD / 2 - legW * 0.6;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + Math.PI;
    const s = [Math.sin(a), 0, Math.cos(a)];
    L.add(bar([s[0] * fr, 0, s[2] * fr], [s[0] * hr, H - hubH * 0.5, s[2] * hr], legW, legW, [Math.cos(a), 0, -Math.sin(a)]), m, 'base');
  }
  L.add(discGeo(hubD, hubH, L.q.lathe, { y0: H - hubH, round: 0.006 }), m, 'base');
  return H;
}

/**
 * Four flat bars around a cylinder shade (Aneta Ronda): on a circle of radius R at 45°, from the foot plate (where they
 * turn in and cross) straight up past the shade and over its top (topH above it) where they turn in to an X with a
 * knob. The socket hangs from the X down to the bulb.
 */
function cageFrame(L, { R, yb, top, plateY, barW, topH, bulb }) {
  const m = L.mat('metal');
  const t = Math.max(0.003, barW * 0.3);
  const yTop = top + topH, rc = Math.min(0.035, R * 0.25);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * TAU + Math.PI / 4;
    const s = [Math.sin(a), Math.cos(a)];
    const at = (r, y) => [s[0] * r, y, s[1] * r];
    // flat side faces outward: width along the tangent
    const tan = [Math.cos(a), 0, -Math.sin(a)];
    L.add(bar(at(R, plateY + rc), at(R, yTop - rc), barW, t, tan), m, 'metal');
    L.add(bar(at(R, yTop - rc), at(R - rc * 0.3, yTop - rc * 0.3), barW, t, tan), m, 'metal');
    L.add(bar(at(R - rc * 0.3, yTop - rc * 0.3), at(0, yTop), barW, t, tan), m, 'metal');
    L.add(bar(at(R, plateY + rc), at(R - rc, plateY + t / 2), barW, t, tan), m, 'metal');
    L.add(bar(at(R - rc, plateY + t / 2), at(0, plateY + t / 2), barW, t, tan), m, 'metal');
  }
  L.add(xf(K.sphere(0.011, { wSeg: 12, hSeg: 8 }), [0, yTop + 0.004, 0], null, [1, 0.7, 1]), m, 'metal');
  // rod from the X to the socket, cord from the socket down to the plate
  L.add(K.cylinder(0.004, 0.004, yTop - bulb[1] - 0.06, { seg: 8 }).translate(0, bulb[1] + 0.06, 0), m, 'metal');
  L.socket(0, bulb[1] + 0.025, bulb[1] + 0.065, 0, 0.016);
}

/**
 * Tiers of loose hanging wooden slats (Halvor Bakke Cape Town): per tier a thin ring at the top and `slatsPerTier`
 * flat slats (slatW × slatT, broad face out) hanging from it, each a little different in length. tierD = Ø per tier
 * (top tier first), tierBottomAt = bottom of each tier above the floor, slatLength per tier. Returns the bulb position.
 */
function slatTiers(L, { P, k, yb, h }) {
  const tierD = Array.isArray(P.tierD) && P.tierD.length ? P.tierD : [0.5, 0.4, 0.3];
  const n = tierD.length;
  const lens = tierD.map((_, i) => num(Array.isArray(P.slatLength) ? P.slatLength[i] : P.slatLength, 0.2) * k);
  const bottoms = tierD.map((_, i) => num(Array.isArray(P.tierBottomAt) ? P.tierBottomAt[i] : NaN, NaN));
  // without measured tiers: stack them down from the top, each 70 % into the one above
  for (let i = 0; i < n; i++) if (!Number.isFinite(bottoms[i])) bottoms[i] = i === 0 ? h - lens[0] : bottoms[i - 1] - lens[i] * 0.7;
  const scaleY = (y) => yb + ((y - bottoms[n - 1]) * (h - yb)) / Math.max(0.05, h - bottoms[n - 1]);
  const sw = num(P.slatW, 0.022) * k, st = num(P.slatT, 0.006) * k;
  const wood = L.mat('shade', { grain: 'v' });
  const ring = L.mat('metal');
  const rnd = K.rng(`slats:${tierD.join(',')}`);
  for (let i = 0; i < n; i++) {
    const R = (tierD[i] * k) / 2;
    const yTop = scaleY(bottoms[i] + lens[i]), yBot = scaleY(bottoms[i]);
    const count = clamp(Math.round(num(Array.isArray(P.slatsPerTier) ? P.slatsPerTier[i] : NaN, (TAU * R) / (sw * 1.9))), 8, 140);
    for (let j = 0; j < count; j++) {
      const a = ((j + rnd.range(-0.15, 0.15)) / count) * TAU;
      const len = (yTop - yBot) * rnd.range(0.9, 1.04);
      const r = R - st / 2;
      const g = K.box(sw, len, st, { grain: 'y' });
      xf(g, [Math.sin(a) * r, yTop - len / 2 - 0.004, Math.cos(a) * r], [rnd.range(-0.03, 0.03), a, 0]);
      L.add(g, wood, 'shade');
    }
    L.add(K.torus(R - st, 0.003, { radial: 5, tubular: Math.max(24, L.q.lathe) }).rotateX(Math.PI / 2).translate(0, yTop - 0.008, 0), ring, 'metal');
    // spokes from the pole to the ring
    for (let s = 0; s < 3; s++) {
      const a = (s / 3) * TAU + i;
      L.add(rod([0, yTop - 0.012, 0], [Math.sin(a) * (R - st), yTop - 0.008, Math.cos(a) * (R - st)], 0.0022, 5), ring, 'metal');
    }
  }
  const by = scaleY(bottoms[n - 1] + lens[n - 1] * 0.9);
  L.bulb('globe', [0, by, 0], 0.03);
  // thin rod from the bulb up through the tiers: the rings' spokes meet it
  const yMax = Math.max(...tierD.map((_, i) => scaleY(bottoms[i] + lens[i])));
  L.add(K.cylinder(0.005, 0.005, yMax - by - 0.03, { seg: 8 }).translate(0, by + 0.03, 0), ring, 'metal');
  return [0, by, 0];
}

function buildFloorArc(spec) {
  const L = new Lamp('floor-arc', spec);
  const { w, d, h } = L.dims;
  const P = L.P;
  const alongZ = d > w;
  const U = Math.max(w, d), V = Math.min(w, d);
  const sD = Math.min(num(P.shadeD, V * 0.9), V);
  const sH = Math.min(num(P.shadeH, sD * 0.6), h * 0.3);
  const bD = Math.min(num(P.baseD, Math.min(0.3, V)), V);
  // u axis = the reach direction (+z when deep, else +x); foot at −u, shade at +u
  const uB = -U / 2 + bD / 2, uS = U / 2 - sD / 2;
  const at = (u, y, v = 0) => (alongZ ? [v, y, u] : [u, y, v]);
  // foot (hidden baseShape): round disc, flat square plate, or a marble block (baseH tall); moved under the pole
  const n0 = L.g.children.length;
  const footShape = P.baseShape || 'disc';
  let footH;
  if (footShape === 'block') footH = foot(L, 'rect', { W: bD, Dd: bD, H: clamp(num(P.baseH, 0.12), 0.03, h * 0.35) });
  else if (footShape === 'rect') footH = foot(L, 'rect', { W: bD, Dd: bD, H: clamp(num(P.baseH, 0.025), 0.01, 0.06) });
  // a round column with a half-round top (Arum arched's heavy foot)
  else if (footShape === 'bullet') footH = foot(L, 'bullet', { D: bD, H: clamp(num(P.baseH, 0.26), 0.05, h * 0.35) });
  else footH = footDisc(L, bD, 0.028);
  for (const c of L.g.children.slice(n0)) c.geometry.translate(...at(uB, 0));
  const metal = L.mat('metal');
  let shadeTop;
  if (P.armShape === 'angular') {
    const top = h - 0.012;
    L.add(K.cylinder(0.0095, 0.0095, top - footH, { seg: L.q.rod + 2 }).translate(...at(uB, footH)), metal, 'metal');
    L.add(rod(at(uB, top), at(uS, top), 0.0095, L.q.rod + 2), metal, 'metal');
    L.add(xf(K.sphere(0.0105, { wSeg: 10, hSeg: 8 }), at(uB, top)), metal, 'metal');
    shadeTop = top - 0.03;
    L.add(rod(at(uS, top), at(uS, shadeTop), 0.004, 6), metal, 'metal');
  } else {
    // tall pole that bends over in one smooth arc and ends pointing down above the shade (a tall block foot lifts the
    // start of the bend)
    const y1 = Math.max(h * 0.42, footH + 0.15);
    const tip = h - Math.min(0.18, h * 0.08);
    const Y = (h - 0.125 * (y1 + tip)) / 0.75;
    const pts = [[uB, footH], [uB, Math.max(y1 * 0.5, footH + 0.04)], ...bezier([uB, y1], [uB, Y], [uS, Y], [uS, tip], 28)];
    const pts3 = pts.map(([u, y]) => at(u, y));
    L.add(K.tube(pts3, 0.011, { radial: L.q.rod, seg: 80 }), metal, 'metal');
    shadeTop = tip - 0.06;
    cord(L, ...[alongZ ? 0 : uS, alongZ ? uS : 0], tip, shadeTop);
  }
  const yb = shadeTop - sH;
  const [sx, , sz] = at(uS, 0);
  const lm = L.lumens(806);
  if (P.shadeShape === 'dome') {
    // opaque metal dome (Arum): the light is a spot down
    const dome = domeShade(L, { R: sD / 2, H: sH, yb, x: sx, z: sz });
    L.socket(sx, dome.bulb[1] + 0.02, shadeTop, sz, 0.012);
    L.spot(dome.bulb, [0, -1, 0], lm, dome.angle, 0.8);
  } else {
    const taper = P.armShape === 'angular' ? 1 : 0.8;
    const bulb = drumShade(L, { R: sD / 2, Rtop: (sD / 2) * taper, H: sH, yb, x: sx, z: sz });
    L.socket(sx, bulb[1] + 0.03, shadeTop, sz, 0.015);
    if (L.translucency() > 0.25) L.point(bulb, lm);
    else L.spot(bulb, [0, -1, 0], lm, 0.9, 0.8);
  }
  const fb = at(uB, 0);
  L.colliders.push({ min: [fb[0] - bD / 2, 0, fb[2] - bD / 2], max: [fb[0] + bD / 2, h, fb[2] + bD / 2] });
  L.colliders.push({ min: [sx - sD / 2, yb, sz - sD / 2], max: [sx + sD / 2, shadeTop, sz + sD / 2] });
  return L.finish();
}

/**
 * Tripod floor lamp: `legCount` legs from a circle of Ø params.baseD up to a hub under the shade. shadeShape 'drum'
 * (default) sits on the hub; 'cone' is the Northern Oslo Wood: see tripodCone.
 */
function buildFloorTripod(spec) {
  if (spec.params?.shadeShape === 'cone') return tripodCone(spec);
  if (spec.params?.shadeShape === 'woven') return tripodBasket(spec);
  const L = new Lamp('floor-tripod', spec);
  const { w, d, h } = L.dims;
  const P = L.P;
  const legs = clamp(Math.round(num(P.legCount, 3)), 3, 5);
  const sD = Math.min(num(P.shadeD, 0.4), Math.min(w, d) * 0.95);
  const sH = Math.min(num(P.shadeH, sD * 0.8), h * 0.35);
  const yb = h - sH;
  const apexY = yb + sH * 0.28;
  // feet on a circle (params.baseD = its diameter, at most the footprint): equal legs 360°/n apart, like the real
  // tripods – three legs on a Ø60 circle span 0.52 × 0.45 m in plan, that is geometry, not a shortfall
  const footR = Math.min(num(P.baseD, Math.min(w, d)), w, d) / 2 - 0.012;
  const m = L.mat('base', woodGrain(L));
  const hubY = apexY - 0.06;
  for (let i = 0; i < legs; i++) {
    const a = (i / legs) * TAU + Math.PI;
    const foot = [Math.sin(a) * footR, 0, Math.cos(a) * footR];
    const top = [Math.sin(a) * 0.016, hubY, Math.cos(a) * 0.016];
    L.add(rod(foot, top, 0.008, L.q.rod + 2, 0.0065), m, 'base');
    L.add(xf(K.sphere(0.009, { wSeg: 8, hSeg: 6 }), foot, null, [1, 0.5, 1]), m, 'base');
  }
  L.add(K.cylinder(0.022, 0.024, 0.05, { seg: 16 }).translate(0, hubY - 0.02, 0), L.mat('metal'), 'metal');
  L.add(K.cylinder(0.006, 0.006, apexY - hubY, { seg: 8 }).translate(0, hubY + 0.03, 0), L.mat('metal'), 'metal');
  const bulb = drumShade(L, { R: sD / 2, H: sH, yb });
  L.socket(0, apexY, bulb[1] - 0.03, 0, 0.016);
  L.point(bulb, L.lumens(806));
  L.colliders.push({ min: [-footR, 0, -footR], max: [footR, h, footR] });
  return L.finish();
}

/**
 * Tripod with a rattan cage lantern standing on the legs (Lindby Canyana): thin legs from a circle of Ø baseD meet in a
 * small plate under the lantern, a triangular brace braceAt above the floor; the lantern is a barrel of `ribs` vertical
 * canes (Ø shadeD in the middle, shadeBottomD / shadeTopD at the ends, rounded shoulders) with `rings` hoops and a
 * closed top. The bulb hangs free inside.
 */
function tripodBasket(spec) {
  const L = new Lamp('floor-tripod', spec);
  const { w, d, h } = L.dims;
  const P = L.P;
  const legs = clamp(Math.round(num(P.legCount, 3)), 3, 5);
  const sD = Math.min(num(P.shadeD, 0.32), Math.min(w, d) * 0.95);
  const sH = Math.min(num(P.shadeH, sD * 1.6), h * 0.5);
  const R = sD / 2;
  const rB = Math.min(num(P.shadeBottomD, sD * 0.8), sD) / 2, rT = Math.min(num(P.shadeTopD, sD * 0.8), sD) / 2;
  const yb = h - sH;
  const footR = Math.min(num(P.baseD, Math.min(w, d)), w, d) / 2 - 0.012;
  const legR = clamp(num(P.legD, 0.016), 0.008, 0.03) / 2;
  const legM = L.mat('base', woodGrain(L));
  const metal = L.mat('metal');
  const plateY = yb - 0.006;
  const ends = [];
  for (let i = 0; i < legs; i++) {
    const a = (i / legs) * TAU + Math.PI;
    const foot = [Math.sin(a) * footR, 0, Math.cos(a) * footR];
    const top = [Math.sin(a) * 0.035, plateY - 0.004, Math.cos(a) * 0.035];
    L.add(rod(foot, top, legR, L.q.rod + 2), legM, 'base');
    L.add(xf(K.sphere(legR * 1.1, { wSeg: 8, hSeg: 6 }), foot, null, [1, 0.5, 1]), legM, 'base');
    ends.push([foot, top]);
  }
  // brace between the legs
  const braceY = num(P.braceAt, 0);
  if (braceY > 0.05 && braceY < plateY - 0.1) {
    const at = ([f, t]) => f.map((v, k) => v + ((t[k] - v) * braceY) / (plateY - 0.004));
    for (let i = 0; i < legs; i++) L.add(rod(at(ends[i]), at(ends[(i + 1) % legs]), 0.004, 6), legM, 'base');
  }
  L.add(discGeo(Math.max(0.09, rB * 1.1), 0.008, L.q.lathe, { y0: plateY - 0.002 }), metal, 'metal');
  // barrel outline (r, y) bottom → top: the ends' radii blend into the belly with rounded shoulders
  const N = 14;
  const prof = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const rEnd = rB + (rT - rB) * t;
    prof.push([rEnd + (R - rEnd) * Math.sin(Math.PI * t) ** 0.6, yb + 0.004 + t * (sH - 0.008)]);
  }
  const ribs = clamp(Math.round(num(P.ribs, 40)), 12, 96);
  const rr = Math.max(0.0022, R * 0.012);
  const cane = L.shadeMat('shade', 0.4);
  for (let k = 0; k < ribs; k++) {
    const a = (k / ribs) * TAU;
    L.auto(K.tube(prof.map(([r, y]) => [Math.sin(a) * r, y, Math.cos(a) * r]), rr, { radial: 4, seg: N + 6 }), cane, 'shade');
  }
  const hoop = L.mat('shade', { roughness: 0.6 });
  const rings = clamp(Math.round(num(P.rings, 3)), 2, 8);
  for (let i = 0; i < rings; i++) {
    const p = prof[Math.round((i / (rings - 1)) * N)];
    L.add(K.torus(p[0], rr * 1.5, { radial: 5, tubular: L.q.lathe }).rotateX(Math.PI / 2).translate(0, p[1], 0), hoop, 'shade');
  }
  // closed top: a woven lid
  const top = prof[N];
  L.add(new THREE.CircleGeometry(top[0], L.q.lathe).rotateX(-Math.PI / 2).translate(0, top[1] + rr, 0), L.mat('shade', { side: 'double' }), 'shade');
  const by = yb + sH * 0.45;
  L.socket(0, plateY, by - 0.03, 0, 0.016);
  L.bulb('filament', [0, by, 0], 0.03);
  L.point([0, by, 0], L.lumens(806));
  L.colliders.push({ min: [-footR, 0, -footR], max: [footR, yb, footR] });
  L.colliders.push({ min: [-R, yb, -R], max: [R, h, R] });
  return L.finish();
}

/** Steepest shade tilt of a tiltable tripod (degrees): the cone lies almost on its side. */
const MAX_TILT = 80;

/**
 * Tripod with a tiltable cone shade (Northern Oslo Wood): thin steel legs meet in a small hub, a fork on the hub holds a
 * gimbal ring at the narrow end of the shade, and the shade (Ø shadeBottomD → Ø shadeD, wide end up, height shadeH)
 * turns about the fork's pins – params.tilt degrees toward the front (+z); the whole lamp turns for another direction.
 * Socket and bulb tilt with the shade.
 */
function tripodCone(spec) {
  const L = new Lamp('floor-tripod', spec);
  const { w, d, h } = L.dims;
  const P = L.P;
  const legs = clamp(Math.round(num(P.legCount, 3)), 3, 5);
  const sD = Math.min(num(P.shadeD, 0.26), Math.min(w, d) * 0.95);
  const sDb = clamp(num(P.shadeBottomD, sD * 0.5), 0.06, sD);
  const sH = Math.min(num(P.shadeH, sD * 1.15), h * 0.4);
  const tilt = clamp(num(P.tilt, 0), 0, MAX_TILT) * DEG;
  // pivot (gimbal pins) a little above the shade's lower rim, so the rim hides the ring when the shade stands upright
  const lip = 0.015;
  const py = h - sH + lip;
  const pivot = new THREE.Vector3(0, py, 0);
  const M = new THREE.Matrix4().compose(pivot, new THREE.Quaternion().setFromEuler(new THREE.Euler(tilt, 0, 0)), new THREE.Vector3(1, 1, 1));
  const T = (geo) => geo.applyMatrix4(M);
  const at = (x, y, z) => new THREE.Vector3(x, y, z).applyMatrix4(M);

  // legs: feet on a circle (params.baseD), tops into the hub under the fork
  const footR = Math.min(num(P.baseD, Math.min(w, d)), w, d) / 2 - 0.012;
  const hubTop = py - 0.04, hubH = 0.045;
  const legM = L.mat('base', woodGrain(L));
  for (let i = 0; i < legs; i++) {
    const a = (i / legs) * TAU + Math.PI;
    const foot = [Math.sin(a) * footR, 0, Math.cos(a) * footR];
    const top = [Math.sin(a) * 0.013, hubTop - hubH * 0.45, Math.cos(a) * 0.013];
    L.add(rod(foot, top, 0.0068, L.q.rod + 2, 0.006), legM, 'base');
    L.add(xf(K.sphere(0.0085, { wSeg: 8, hSeg: 6 }), foot, null, [1, 0.6, 1]), legM, 'base');
  }
  const metal = L.mat('metal');
  L.add(K.cylinder(0.016, 0.017, hubH, { seg: 16 }).translate(0, hubTop - hubH, 0), metal, 'metal');
  // fork: two prongs from the hub up to the pins on the tilt axis (x), the ring between them
  const ringR = 0.024, pinX = 0.031;
  for (const s of [-1, 1]) {
    L.add(rod([s * 0.009, hubTop - 0.004, 0], [s * pinX, py, 0], 0.0032, 6), metal, 'metal');
    L.add(rod([s * (ringR - 0.002), py, 0], [s * (pinX + 0.004), py, 0], 0.0035, 8), metal, 'metal');
  }
  // gimbal ring around the socket and the socket itself: they turn with the shade
  L.add(T(K.torus(ringR, 0.0028, { radial: 6, tubular: 28 }).rotateX(Math.PI / 2)), metal, 'metal');
  for (const s of [-1, 1]) L.add(T(rod([s * 0.016, 0, 0], [s * (ringR - 0.001), 0, 0], 0.0025, 6)), metal, 'metal');
  const bulbY = sH * 0.32 - lip;
  L.add(T(K.cylinder(0.0165, 0.0165, bulbY - 0.03 + 0.012, { seg: L.q.rod + 6 }).translate(0, -0.012, 0)), metal, 'metal');

  // the shade: a straight cone open at both ends, narrow end down (nylon thread wound on two wire rings)
  const rB = sDb / 2, rT = sD / 2;
  const y0 = -lip;
  const s = shell([[rB, y0], [(rB + rT) / 2, y0 + sH / 2], [rT, y0 + sH]], 0.002, Math.max(L.q.lathe, 40));
  const o = L.shadeMat('shade', 1.1);
  for (const g of [s.outer, ...s.rims]) L.auto(T(g), o, 'shade');
  L.auto(T(s.inner), L.innerMat('inner', 0.45), 'inner');
  // the wire rings show as a slightly thicker edge at both ends
  for (const [r, y] of [[rB, y0], [rT, y0 + sH]]) L.auto(T(K.torus(r - 0.001, 0.0022, { radial: 5, tubular: Math.max(L.q.lathe, 40) }).rotateX(Math.PI / 2).translate(0, y, 0)), o, 'shade');
  const bulb = at(0, bulbY, 0);
  L.bulb('globe', bulb, 0.03);
  L.point(bulb.toArray(), L.lumens(806));

  // colliders: the legs' column, and the tilted shade's box (rim points)
  L.colliders.push({ min: [-footR, 0, -footR], max: [footR, py, footR] });
  const box = new THREE.Box3();
  for (let k = 0; k < 16; k++) {
    const phi = (k / 16) * TAU;
    for (const [r, y] of [[rB, y0], [rT, y0 + sH]]) box.expandByPoint(at(Math.sin(phi) * r, y, Math.cos(phi) * r));
  }
  L.colliders.push({ min: box.min.toArray(), max: box.max.toArray() });
  return L.finish();
}

function buildFloorMushroom(spec) {
  const L = new Lamp('floor-mushroom', spec);
  const { w, h } = L.dims;
  const P = L.P;
  const sD0 = num(P.shadeD, w), bD0 = num(P.baseD, w * 0.6);
  const k = kScale(L, Math.max(sD0, bD0));
  const sD = sD0 * k, bD = bD0 * k;
  const sH = Math.min(num(P.shadeH, sD * 0.5) * k, h * 0.3);
  const baseShape = P.baseShape || 'disc';
  const bh = baseShape === 'cylinder' ? Math.min(num(P.baseH, 0.15), h * 0.3) : baseShape === 'dome' ? Math.min(0.06, bD * 0.22) : 0.025;
  const baseTop = foot(L, baseShape, { D: bD, H: bh });
  const tiers = num(P.tiers, 0);
  const yb = h - sH;
  let bulb;
  if (tiers >= 2) {
    const t = tierStack(L, { D: sD, H: sH, yTop: h, tiers, pins: true });
    bulb = t.bulb;
    L.add(K.cylinder(0.0075, 0.0075, t.bottom + sH * 0.6 - baseTop, { seg: L.q.rod + 2 }).translate(0, baseTop - 0.004, 0), L.mat('metal'), 'metal');
  } else {
    mushroomCap(L, { R: sD / 2, H: sH, yb });
    L.add(K.cylinder(0.0075, 0.0075, yb + sH * 0.5 - baseTop, { seg: L.q.rod + 2 }).translate(0, baseTop - 0.004, 0), L.mat('metal'), 'metal');
    bulb = [0, yb + sH * 0.35, 0];
    L.bulb('globe', bulb, Math.min(0.028, sH * 0.4));
  }
  const lm = L.lumens(806);
  if (L.translucency() > 0.3) L.point(bulb, lm);
  else L.spot(bulb, [0, -1, 0], lm, 1.15, 0.85);
  floorColliders(L, Math.max(0.05, bD / 2), { min: [-sD / 2, yb, -sD / 2], max: [sD / 2, h, sD / 2] });
  return L.finish();
}

function buildFloorUplight(spec) {
  const L = new Lamp('floor-uplight', spec);
  const { w, h } = L.dims;
  const P = L.P;
  const bD = num(P.baseD, 0.25);
  const sD = num(P.shadeD, 0.3), sH = num(P.shadeH, 0.07);
  const reading = P.readingArm !== false && (P.readingArm || num(P.armReach, 0) > 0);
  const reach = reading ? num(P.armReach, 0.28) : 0;
  // the foot sits so that foot + reading arm fill w
  const xb = reading ? -w / 2 + bD / 2 : 0;
  const footH = footDisc(L, bD, 0.03);
  L.g.children[L.g.children.length - 1].geometry.translate(xb, 0, 0);
  const metal = L.mat('metal');
  const yb = h - sH;
  L.add(K.cylinder(0.011, 0.011, yb - footH + 0.01, { seg: L.q.rod + 2 }).translate(xb, footH - 0.005, 0), metal, 'metal');
  // shallow bowl opening up
  const R = sD / 2;
  const prof = [[0.08 * R, yb], [0.42 * R, yb + 0.16 * sH], [0.82 * R, yb + 0.6 * sH], [R, yb + sH]];
  const s = shell(prof, 0.0018, L.q.lathe, { rimBottom: false });
  L.add(s.outer.translate(xb, 0, 0), L.mat('shade'), 'shade');
  for (const g of s.rims) L.add(g.translate(xb, 0, 0), L.mat('shade'), 'shade');
  L.auto(s.inner.translate(xb, 0, 0), L.innerMat('inner', 0.6), 'inner');
  L.glowAdd(new THREE.CircleGeometry(R * 0.55, L.q.lathe).rotateX(-Math.PI / 2).translate(xb, yb + sH * 0.32, 0), L.glow('inner', 1.6), 'inner');
  const lm = L.lumens(1600);
  L.spot([xb, yb + sH * 0.4, 0], [0, 1, 0], reading ? lm * 0.8 : lm, 1.2, 1);
  if (reading) {
    // flexible reading arm with a small head pointing down and out
    const y0 = h * 0.68;
    const pts = [[xb, y0, 0], [xb + reach * 0.15, y0 + 0.06, 0], [xb + reach * 0.55, y0 + 0.16, 0], [xb + reach * 0.88, y0 + 0.19, 0]];
    L.add(K.tube(pts, 0.006, { radial: L.q.rod, seg: 24 }), metal, 'metal');
    L.add(K.cylinder(0.014, 0.014, 0.05, { seg: 12, center: true }).translate(xb, y0, 0), metal, 'metal');
    const hp = new THREE.Vector3(xb + reach, y0 + 0.16, 0);
    const dir = new THREE.Vector3(0.45, -1, 0).normalize();
    const head = K.lathe([[0.034, -0.05], [0.026, -0.02], [0.015, 0.012], [0.006, 0.02]], { seg: 20 });
    L.add(xf(head, hp, aim(dir.clone().negate())), L.mat('shade'), 'shade');
    const lens = new THREE.CircleGeometry(0.028, 16).rotateX(Math.PI / 2);
    L.glowAdd(xf(lens, hp.clone().addScaledVector(dir, 0.044), aim(dir.clone().negate())), L.bulbMat(3), null);
    L.spot(hp.clone().addScaledVector(dir, 0.05).toArray(), dir.toArray(), lm * 0.2, 0.5, 0.6);
  }
  floorColliders(L, bD / 2, null);
  L.colliders[0].min[0] += xb;
  L.colliders[0].max[0] += xb;
  return L.finish();
}

/**
 * Opal glass globe on a pole. params: shadeD (glass Ø), shadeH (< shadeD: a flattened, closed dome – Aneta August),
 * cupD / cupH (metal cup the glass rests in; else a small holder), baseShape 'disc' | foot() shapes ('bullet': Globen
 * Torrano), baseD / baseH, collarD / collarH (thicker sleeve at the pole's foot), poleD, pullChain (ball chain with a
 * handle hanging from the cup).
 */
function buildFloorGlobe(spec) {
  const L = new Lamp('floor-globe', spec);
  const { w, h } = L.dims;
  const P = L.P;
  const sD = Math.min(num(P.shadeD, w * 0.9), w);
  const R = sD / 2;
  const Ry = clamp(num(P.shadeH, sD), sD * 0.3, sD) / 2;
  const bD = Math.min(num(P.baseD, Math.min(0.26, w * 0.75)), w);
  const baseShape = P.baseShape || 'disc';
  const footH = baseShape === 'disc' ? footDisc(L, bD, clamp(num(P.baseH, 0.025), 0.008, 0.06)) : foot(L, baseShape, { D: bD, H: Math.min(num(P.baseH, 0.3), h * 0.4) });
  const metal = L.mat('metal');
  const poleR = clamp(num(P.poleD, 0.018), 0.008, 0.04) / 2;
  const cy = h - Ry;
  const glassBottom = cy - Ry;
  let poleTop;
  if (num(P.cupD, 0) > 0) {
    // the glass rests in a shallow cup: its rim meets the glass where the glass is cupD wide
    const cr = Math.min(P.cupD / 2, R * 0.9);
    const rimY = cy - Ry * Math.sqrt(Math.max(0, 1 - (cr / R) ** 2));
    const cH = Math.max(0.008, num(P.cupH, 0.015));
    const y0 = Math.min(rimY - cH, glassBottom - 0.004);
    L.add(K.lathe([[0.0005, y0], [cr * 0.35, y0], [cr * 0.8, y0 + (rimY - y0) * 0.45], [cr, rimY], [cr - 0.0025, rimY + 0.001]], { seg: L.q.lathe }), metal, 'metal');
    L.add(K.cylinder(poleR * 1.5, poleR * 1.5, 0.02, { seg: L.q.rod + 4 }).translate(0, y0 - 0.02, 0), metal, 'metal');
    poleTop = y0 - 0.019;
    if (P.pullChain) {
      // ball chain from the cup's underside, a small cylinder handle at its end
      const x = cr * 0.7, len = 0.15, n = Math.round(len / 0.0045);
      for (let i = 0; i < n; i++) L.add(xf(K.sphere(0.0017, { wSeg: 6, hSeg: 4 }), [x, y0 + (rimY - y0) * 0.2 - i * 0.0045, 0]), metal, 'metal');
      L.add(K.cylinder(0.006, 0.006, 0.06, { seg: 10 }).translate(x, y0 - len - 0.06, 0), metal, 'metal');
    }
  } else {
    L.add(K.cylinder(R * 0.2, R * 0.22, 0.03, { seg: L.q.lathe }).translate(0, glassBottom + R * 0.02 - 0.012, 0), metal, 'metal');
    poleTop = glassBottom + R * 0.1;
  }
  L.add(K.cylinder(poleR, poleR, poleTop - footH + 0.004, { seg: L.q.rod + 2 }).translate(0, footH - 0.004, 0), metal, 'metal');
  if (num(P.collarD, 0) > 0) {
    const ch = Math.min(num(P.collarH, 0.08), (poleTop - footH) * 0.3);
    L.add(K.cylinder(P.collarD / 2, P.collarD / 2, ch, { seg: L.q.lathe }).translate(0, footH - 0.002, 0), metal, 'metal');
  }
  globeShade(L, { R, Ry, cy, open: num(P.cupD, 0) > 0 ? 0 : 0.18, openAt: 'bottom' });
  L.bulb('globe', [0, cy - Ry * 0.15, 0], Math.min(0.03, R * 0.3, Ry * 0.5), { intensity: 2.5 });
  L.point([0, cy, 0], L.lumens(806));
  floorColliders(L, bD / 2, { min: [-R, glassBottom, -R], max: [R, h, R] });
  return L.finish();
}

/**
 * Reading lamp: foot + pole + an arm to a small shade aimed down and forward (+z). armShape: default = straight arm
 * from a ball joint; 'hook' (Aneta Coni) = the pole bends over in a half circle and the shade hangs straight down;
 * 'balance' (Northern Birdy) = an arm balanced on the pole with a counterweight behind.
 */
function buildFloorReading(spec) {
  const shape = spec.params?.armShape;
  if (shape === 'hook') return readingHook(spec);
  if (shape === 'balance') return readingBalance(spec);
  const L = new Lamp('floor-reading', spec);
  const { w, d, h } = L.dims;
  const P = L.P;
  const bD = Math.min(num(P.baseD, 0.26), w);
  const footH = footDisc(L, bD, 0.025);
  const metal = L.mat('metal');
  const zb = -d / 2 + bD / 2;
  L.g.children[L.g.children.length - 1].geometry.translate(0, 0, zb);
  const poleTop = h * 0.78;
  L.add(K.cylinder(0.009, 0.009, poleTop - footH, { seg: L.q.rod + 2 }).translate(0, footH - 0.004, zb), metal, 'metal');
  L.add(xf(K.sphere(0.014, { wSeg: 12, hSeg: 8 }), [0, poleTop, zb]), metal, 'metal');
  const reach = Math.max(0.1, d - bD / 2 - 0.06);
  const armEnd = new THREE.Vector3(0, h - 0.06, zb + reach);
  L.add(rod([0, poleTop, zb], armEnd, 0.007, L.q.rod), metal, 'metal');
  const dir = new THREE.Vector3(0, -1, 0.55).normalize();
  const sD = Math.min(num(P.shadeD, 0.14), w);
  const q = aim(dir.clone().negate());
  // hidden headShape 'cylinder' (Bohus Sylinder, Juno, Baton): a straight tube head, closed at the back
  const cyl = P.headShape === 'cylinder';
  const sL = cyl ? clamp(num(P.shadeH, sD * 1.3), 0.05, 0.35) : 0;
  const prof = cyl ? [[sD / 2, -sL], [sD / 2, -sL * 0.5], [sD / 2, -0.006], [sD / 2 - 0.006, 0], [0.004, 0]] : [[sD / 2, -sD * 0.75], [sD * 0.42, -sD * 0.45], [sD * 0.22, -sD * 0.08], [0.012, 0]];
  const s = shell(prof, 0.0015, L.q.lathe, { rimTop: false });
  L.add(xf(s.outer, armEnd, q), L.mat('shade'), 'shade');
  for (const g of s.rims) L.add(xf(g, armEnd, q), L.mat('shade'), 'shade');
  L.auto(xf(s.inner, armEnd, q), L.innerMat('inner', 0.55), 'inner');
  const bp = armEnd.clone().addScaledVector(dir, cyl ? sL * 0.45 : sD * 0.35);
  L.bulb('globe', bp, Math.min(0.025, sD * 0.18));
  L.spot(bp.toArray(), dir.toArray(), L.lumens(600), 0.65, 0.6);
  L.colliders.push({ min: [-bD / 2, 0, zb - bD / 2], max: [bD / 2, h * 0.9, zb + bD / 2] });
  return L.finish();
}

/** Foot of a reading lamp at z = zb: disc (baseH ≤ 6 cm) or a foot() shape. Returns its top. */
function readingFoot(L, bD, zb) {
  const P = L.P;
  const shape = P.baseShape || 'disc';
  const H = num(P.baseH, 0.025);
  const n = L.g.children.length;
  const top = shape === 'disc' ? footDisc(L, bD, clamp(H, 0.008, 0.06)) : foot(L, shape, { D: bD, H });
  for (const c of L.g.children.slice(n)) c.geometry.translate(0, 0, zb);
  return top;
}

/**
 * Hook reading lamp (Aneta Coni): straight pole, a half-circle bend of radius hookR at the top, a short drop and an
 * hourglass shade (Ø shadeTopD at the top, waist Ø waistD at waistAt below the top, opening Ø shadeD) hanging straight
 * down, its top shadeTopBelowHook under the top of the bend. All in one powder-coated colour.
 */
function readingHook(spec) {
  const L = new Lamp('floor-reading', spec);
  const { w, d, h } = L.dims;
  const P = L.P;
  const bD = Math.min(num(P.baseD, 0.22), w);
  const hookR = clamp(num(P.hookR, num(P.armReach, 0.17) / 2), 0.04, 0.2);
  const sD = Math.min(num(P.shadeD, 0.2), w), sH = clamp(num(P.shadeH, sD), 0.08, h * 0.3);
  const reach = 2 * hookR;
  // centre the whole lamp (foot back, shade front) in its depth
  const span = bD / 2 + reach + sD / 2;
  const zb = -span / 2 + bD / 2, zs = zb + reach;
  const footTop = readingFoot(L, bD, zb);
  const top = h - num(P.shadeTopBelowHook, 0.17);
  const cy = h - hookR;
  const pts = [[0, footTop - 0.004, zb], [0, cy, zb]];
  for (let i = 1; i < 16; i++) {
    const a = Math.PI - (i / 16) * Math.PI;
    pts.push([0, cy + Math.sin(a) * hookR, zb + hookR + Math.cos(a) * hookR]);
  }
  pts.push([0, cy, zs], [0, top + 0.012, zs]);
  const poleR = clamp(num(P.poleD, 0.016), 0.008, 0.03) / 2;
  L.add(K.tube(pts, poleR, { radial: L.q.rod + 2, seg: 60, curve: 'line' }), L.mat('metal'), 'metal');
  // hourglass: small inverted cone down to the waist, then the wide cone to the opening
  const rT = Math.min(num(P.shadeTopD, sD * 0.6), sD) / 2, rW = Math.min(num(P.waistD, sD * 0.32), 2 * rT) / 2;
  const wy = top - clamp(num(P.waistAt, sH * 0.3), 0.02, sH * 0.6);
  const yb = top - sH;
  const prof = [[sD / 2, yb], [sD * 0.44, yb + (wy - yb) * 0.35], [rW * 1.15, wy - 0.006], [rW, wy], [rW * 1.15, wy + 0.006], [rT, top]];
  const s = shell(prof, 0.0015, L.q.lathe);
  for (const g of [s.outer, ...s.rims]) L.add(g.translate(0, 0, zs), L.mat('shade'), 'shade');
  L.auto(s.inner.translate(0, 0, zs), L.innerMat('inner', 0.55), 'inner');
  const bp = [0, wy - 0.035, zs];
  L.socket(0, wy - 0.01, top, zs, 0.014);
  L.bulb('globe', bp, Math.min(0.025, rW * 0.9));
  L.spot(bp, [0, -1, 0], L.lumens(470), Math.atan2(sD / 2, bp[1] - yb) + 0.25, 0.7);
  L.colliders.push({ min: [-bD / 2, 0, zb - bD / 2], max: [bD / 2, h * 0.9, zb + bD / 2] });
  L.colliders.push({ min: [-sD / 2, yb, zs - sD / 2], max: [sD / 2, top, zs + sD / 2] });
  return L.finish();
}

/**
 * Balance-arm reading lamp (Northern Birdy): a pole to a joint at pivotH, a long thin arm through it rising armAngle°
 * toward the front – armFront to the shade, armBack to a teardrop counterweight – and a long truncated cone shade
 * (shadeL, Ø shadeTopD → shadeD, the opening cut at a slant), its back resting on the arm's tip at shadeAttach (share of
 * its length from the narrow end), axis shadeTilt° from the vertical, opening down and forward. counterweightL = length
 * of the teardrop. The arm lengths shrink to fit dims.d.
 */
function readingBalance(spec) {
  const L = new Lamp('floor-reading', spec);
  const { w, d, h } = L.dims;
  const P = L.P;
  const bD = Math.min(num(P.baseD, 0.22), w);
  const sD = Math.min(num(P.shadeD, 0.16), w), sL = clamp(num(P.shadeL, 0.3), 0.08, 0.6);
  const rT = Math.min(num(P.shadeTopD, sD * 0.55), sD) / 2;
  const tilt = clamp(num(P.shadeTilt, 30), 0, 80) * DEG;
  const ang = clamp(num(P.armAngle, 30), -20, 70) * DEG;
  const cw = clamp(num(P.counterweightL, 0.08), 0.03, 0.2);
  const att = clamp(num(P.shadeAttach, 0.35), 0, 0.9);
  let front = num(P.armFront, 0.32), back = num(P.armBack, 0.11);
  // horizontal span: counterweight end … shade rim
  const ax = (Math.cos(ang)), dir = new THREE.Vector3(0, -Math.cos(tilt), Math.sin(tilt));
  const shadeFwd = sL * (1 - att) * Math.sin(tilt) + (sD / 2) * Math.cos(tilt);
  const span = (back + cw) * ax + front * ax + shadeFwd;
  if (span > d) {
    const f = Math.max(0.5, (d - shadeFwd) / ((back + cw + front) * ax));
    front *= f;
    back *= f;
  }
  // centre the lamp in its depth: counterweight end … shade rim
  const rearExt = (back + cw) * ax, frontExt = front * ax + shadeFwd;
  const zb = -(rearExt + frontExt) / 2 + rearExt;
  const footTop = readingFoot(L, bD, zb);
  const metal = L.mat('metal');
  const py = clamp(num(P.pivotH, h * 0.68), footTop + 0.2, h - 0.1);
  const poleR = clamp(num(P.poleD, 0.016), 0.008, 0.03) / 2;
  L.add(K.cylinder(poleR, poleR, py - footTop + 0.004, { seg: L.q.rod + 2 }).translate(0, footTop - 0.004, zb), metal, 'metal');
  // joint: a short horizontal hub across the arm
  L.add(K.cylinder(0.013, 0.013, 0.03, { seg: 14, center: true }).rotateZ(Math.PI / 2).translate(0, py, zb), metal, 'metal');
  const u = new THREE.Vector3(0, Math.sin(ang), Math.cos(ang));
  const piv = new THREE.Vector3(0, py, zb);
  const tip = piv.clone().addScaledVector(u, front);
  const rear = piv.clone().addScaledVector(u, -back);
  L.add(rod(rear.toArray(), tip.toArray(), 0.006, L.q.rod), metal, 'metal');
  // teardrop counterweight behind the arm's end (round end at the back), the cord hangs from it
  const tear = [];
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    tear.push([Math.max(0.0005, 0.0175 * Math.sin(Math.PI * t ** 0.7) * (1 - 0.55 * t)), t * cw]);
  }
  const tq = aim(u.clone().negate());
  L.add(xf(K.lathe([[0.0005, 0], ...tear.slice(1)], { seg: 16 }), rear, tq), metal, 'metal');
  const cwEnd = rear.clone().addScaledVector(u, -cw * 0.75);
  L.add(rod(cwEnd.toArray(), [0, 0.002, cwEnd.z], 0.0025, 5), L.mat('cord'), 'cord');
  // the shade: axis `dir`, its back surface on the arm's tip at `att` of its length; base = centre of the narrow end
  const q = aim(dir.clone().negate());
  const prof = [[sD / 2, -sL], [sD / 2 - (sD / 2 - rT) * 0.5, -sL * 0.5], [rT, 0]];
  const s = shell(prof, 0.0015, L.q.lathe);
  // slanted opening: the rim's front edge reaches further than its back edge
  const slant = P.obliqueCut === false ? 0 : Math.tan(18 * DEG);
  for (const g of [s.outer, s.inner, ...s.rims]) {
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i);
      if (y < -sL * 0.5) p.setY(i, y - slant * p.getZ(i) * ((-y - sL * 0.5) / (sL * 0.5)));
    }
    p.needsUpdate = true;
    K.smoothNormals(g);
  }
  const away = u.clone().addScaledVector(dir, -u.dot(dir)).normalize();
  const rAt = rT + (sD / 2 - rT) * att;
  const base = tip.clone().addScaledVector(away, rAt).addScaledVector(dir, -sL * att);
  // a small clamp ring around the shade where the arm holds it
  L.add(xf(K.torus(rAt + 0.002, 0.0028, { radial: 6, tubular: 24 }).rotateX(Math.PI / 2), base.clone().addScaledVector(dir, sL * att), q), metal, 'metal');
  for (const g of [s.outer, ...s.rims]) L.add(xf(g, base, q), L.mat('shade'), 'shade');
  L.auto(xf(s.inner, base, q), L.innerMat('inner', 0.55), 'inner');
  L.add(xf(K.cylinder(rT * 0.95, rT * 0.95, 0.012, { seg: 16 }), base.clone().addScaledVector(dir, -0.002), q), L.mat('shade'), 'shade');
  const bp = base.clone().addScaledVector(dir, sL * 0.35);
  L.add(xf(K.cylinder(0.014, 0.014, sL * 0.3, { seg: 12 }).translate(0, -sL * 0.3, 0), base, q), metal, 'metal');
  L.bulb('globe', bp, Math.min(0.025, sD * 0.16));
  L.spot(bp.toArray(), dir.toArray(), L.lumens(470), Math.atan2(sD / 2, sL * 0.65) + 0.3, 0.6);
  L.colliders.push({ min: [-bD / 2, 0, zb - bD / 2], max: [bD / 2, py, zb + bD / 2] });
  return L.finish();
}

// ---------------------------------------------------------------------------------------------------------------
// Table lamps

function buildTableMushroom(spec) {
  const L = new Lamp('table-mushroom', spec);
  const { w, h } = L.dims;
  const P = L.P;
  const sD = Math.min(num(P.shadeD, w), w) * kScale(L, Math.max(num(P.shadeD, w), num(P.baseD, 0)));
  const capH = clamp(num(P.shadeH, sD * 0.25), 0.02, h * 0.4);
  const bD = Math.min(num(P.baseD, sD * 0.55), sD);
  const yb = h - capH;
  const joint = 0.012;
  const coneTop = yb - joint * 1.6;
  const baseShape = P.baseShape || 'cone';
  if (baseShape === 'cone') {
    L.add(K.lathe([[0.0005, 0], [bD / 2, 0], [bD / 2 * 0.98, 0.004], [0.011, coneTop], [0.0005, coneTop]], { seg: L.q.lathe }), L.mat('base'), 'base');
  } else if (baseShape === 'cylinder') {
    // a thick glass / ceramic cylinder straight up into the cap (Noor); glass glows like the cap
    const bm = L.isGlass('base') ? L.shadeMat('base', 1.2) : L.mat('base');
    L.auto(K.cylinder(bD / 2, bD / 2, yb + 0.004, { seg: L.q.lathe }), bm, 'base');
  } else {
    const ft = footDisc(L, bD, 0.02);
    L.add(K.cylinder(0.006, 0.006, coneTop - ft, { seg: 10 }).translate(0, ft, 0), L.mat('base'), 'base');
  }
  if (baseShape !== 'cylinder') L.add(xf(K.sphere(joint, { wSeg: 14, hSeg: 10 }), [0, coneTop + joint * 0.7, 0]), L.mat('metal'), 'metal');
  // flat cap: domed top, flat diffuser underneath
  const R = sD / 2;
  const prof = [[R, yb], [R * 0.995, yb + capH * 0.35], [R * 0.9, yb + capH * 0.7], [R * 0.6, yb + capH * 0.94], [0.001, yb + capH]];
  L.add(K.lathe(prof, { seg: L.q.lathe }), L.mat('shade'), 'shade');
  L.add(K.lathe([[R * 0.82, yb + 0.003], [R, yb]], { seg: L.q.lathe }), L.mat('shade'), 'shade');
  L.glowAdd(new THREE.CircleGeometry(R * 0.82, L.q.lathe).rotateX(Math.PI / 2).translate(0, yb + 0.003, 0), L.glow('inner', 1.4), 'inner');
  L.spot([0, yb, 0], [0, -1, 0], L.lumens(300), 1.25, 1);
  return L.finish();
}

/**
 * Table lamp: a foot (baseShape = the foot() shapes incl. 'candlestick' and 'ball'; baseD / baseH, baseDepth for 'rect')
 * with a neck up to the socket and a shade (shadeShape = poleShade: 'drum' | 'wavy' | 'cone' | 'pleated' | 'empire' |
 * 'rect' | 'woven' | 'lantern' | 'dome'; shadeD / shadeH, shadeTopD for the tapered ones, shadeDepth for 'rect', pleats,
 * ribs). portable = a charging port on the foot. Translucent shades light as a point at the bulb, the metal dome as a
 * spot down.
 */
function buildTableShade(spec) {
  const L = new Lamp('table-shade', spec);
  const { w, d, h } = L.dims;
  const P = L.P;
  const shape = P.shadeShape || 'drum';
  const sD0 = num(P.shadeD, w), bD0 = num(P.baseD, w * 0.5);
  const k = kScale(L, Math.max(sD0, bD0));
  const sD = sD0 * k, bD = bD0 * k;
  // a paper lantern is most of the lamp (Ishida); the other shades take at most 60 % of the height
  const sH = Math.min(num(P.shadeH, sD * 0.75) * k, h * (shape === 'lantern' ? 0.94 : 0.6));
  const yb = h - sH;
  const baseShape = P.baseShape || 'vase';
  const bh = Math.min(num(P.baseH, h * 0.5) * k, yb);
  let top;
  if (baseShape === 'rect') top = foot(L, 'rect', { W: bD, Dd: Math.min(d, num(P.baseDepth, bD0) * k), H: bh });
  else if (baseShape === 'ball') top = foot(L, 'ball', { D: Math.min(bD, Math.max(0.03, bh / 0.97)) });
  else top = foot(L, baseShape, { D: bD, H: bh, sph: [14, 10] });
  const Rtop = (num(P.shadeTopD, sD0 * (SHADE_TAPER[shape] ?? 1)) * k) / 2;
  const depth = shape === 'rect' ? Math.min(d, P.shadeDepth != null ? num(P.shadeDepth, d) * k : d) : sD;
  // small lanterns: fewer profile points (the triangle budget of a table lamp)
  const lantern = { ribs: num(P.ribs, Math.max(6, Math.round(sH / 0.035))), stepsPerRib: 2, seg: Math.max(24, L.q.lathe - 8) };
  const res = poleShade(L, shape, { R: sD / 2, Rtop, H: sH, yb, depth, P, k, h, bulbR: 0.028, lantern });
  const bulb = res.bulb;
  // neck from the base to the socket
  const neckTop = bulb[1] - 0.028;
  if (neckTop - top > 0.005) L.add(K.cylinder(0.008, 0.008, neckTop - top + 0.004, { seg: 10 }).translate(0, top - 0.004, 0), L.mat('metal'), 'metal');
  L.socket(0, Math.max(top, neckTop - 0.035), neckTop, 0, 0.015);
  if (P.portable) L.add(K.cylinder(0.006, 0.006, 0.004, { seg: 12 }).rotateX(Math.PI / 2).translate(0, bh * 0.3, bD / 2 + 0.001), L.mat('metal'), 'metal');
  if (res.angle) L.spot(bulb, [0, -1, 0], L.lumens(470), res.angle, 0.8);
  else L.point(bulb, L.lumens(470));
  return L.finish();
}

function buildTableGlobe(spec) {
  const L = new Lamp('table-globe', spec);
  const { w, h } = L.dims;
  const P = L.P;
  const shape = P.shadeShape || 'globe';
  const lm = L.lumens(470);
  if (shape === 'fluted-bulb') {
    const bD = Math.min(num(P.baseD, w * 0.8), w);
    const bH = Math.min(0.04, h * 0.17);
    footDome(L, bD, bH);
    const R = Math.min(num(P.shadeD, w), w) / 2;
    const H = h - bH * 0.6;
    const y0 = bH * 0.6;
    const prof = [[0.56, 0], [0.88, 0.16], [0.99, 0.36], [0.97, 0.5], [0.86, 0.64], [0.66, 0.78], [0.4, 0.91], [0.16, 0.99], [0.02, 1]].map(([r, y]) => [r * R, y0 + y * H]);
    const n = Math.max(10, Math.round(16 * (R / 0.1)));
    const g = K.lathe(prof, { seg: Math.max(L.q.lathe, n * 4) });
    modulate(g, (phi) => 1 + 0.04 * Math.cos(n * phi));
    L.auto(g, L.shadeMat('shade', 0.45, { side: 'double' }), 'shade');
    const by = y0 + H * 0.42;
    L.socket(0, y0 - 0.002, by - 0.03, 0, 0.016, 'base');
    L.bulb('filament', [0, by, 0], Math.min(0.032, R * 0.32));
    L.point([0, by, 0], lm);
    return L.finish();
  }
  // opal globe on a small foot (Fado)
  const bD = Math.min(num(P.baseD, w * 0.4), w);
  const bH = Math.min(0.03, h * 0.12);
  L.add(discGeo(bD, bH, L.q.lathe, { round: 0.006 }), L.mat('base'), 'base');
  const R = Math.min(w / 2, (h - bH * 0.4) / 2);
  const cy = h - R;
  globeShade(L, { R, cy, open: 0.32, openAt: 'bottom' });
  L.bulb('globe', [0, cy - R * 0.1, 0], Math.min(0.03, R * 0.3), { intensity: 2.5 });
  L.point([0, cy, 0], lm);
  return L.finish();
}

function buildTablePortable(spec) {
  const L = new Lamp('table-portable', spec);
  const { w, h } = L.dims;
  const P = L.P;
  const sD = Math.min(num(P.shadeD, w), w);
  const R = sD / 2;
  const sH = Math.min(num(P.shadeH, R), h * 0.4);
  const bD = Math.min(num(P.baseD, sD * 0.6), sD);
  const br = bD / 2, bh = Math.min(br, h * 0.25);
  // hemisphere base
  const bp = [[0.0005, 0], [br, 0]];
  for (let i = 1; i <= 8; i++) {
    const a = (i / 8) * (Math.PI / 2);
    bp.push([Math.max(0.004, br * Math.cos(a)), bh * Math.sin(a)]);
  }
  L.add(K.lathe(bp, { seg: L.q.lathe }), L.mat('base'), 'base');
  const yb = h - sH;
  L.add(K.cylinder(0.006, 0.006, yb - bh + 0.02, { seg: 10 }).translate(0, bh - 0.004, 0), L.mat('metal'), 'metal');
  // hemisphere shade, open underneath, with an inner diffuser dome
  const prof = [];
  for (let i = 0; i <= 10; i++) {
    const a = (i / 10) * (Math.PI / 2);
    prof.push([Math.max(0.001, R * Math.cos(a)), yb + sH * Math.sin(a)]);
  }
  const s = shell(prof, 0.002, L.q.lathe, { rimTop: false });
  L.add(s.outer, L.mat('shade'), 'shade');
  for (const g of s.rims) L.add(g, L.mat('shade'), 'shade');
  L.auto(s.inner, L.innerMat('inner', 0.55), 'inner');
  const ir = R * 0.55;
  const dp = [];
  for (let i = 0; i <= 8; i++) {
    const a = (i / 8) * (Math.PI / 2);
    dp.push([Math.max(0.001, ir * Math.cos(a)), yb + sH * 0.15 + ir * 0.8 * Math.sin(a)]);
  }
  L.glowAdd(flip(K.lathe(dp, { seg: L.q.lathe })), L.glow('inner', 1.3), 'inner');
  L.spot([0, yb + sH * 0.2, 0], [0, -1, 0], L.lumens(100), 1.2, 1);
  return L.finish();
}

function buildTableDome(spec) {
  const L = new Lamp('table-dome', spec);
  const { w, h } = L.dims;
  const P = L.P;
  const sD = Math.min(num(P.shadeD, w), w);
  const sH = Math.min(num(P.shadeH, sD * 0.45), h * 0.4);
  const bD = Math.min(num(P.baseD, sD * 0.7), w);
  const tiers = num(P.tiers, 3);
  const bh = footDome(L, bD, Math.min(0.03, bD * 0.2));
  let bulb, bottom;
  if (tiers >= 2) {
    const t = tierStack(L, { D: sD, H: sH, yTop: h, tiers, pins: true });
    bulb = t.bulb;
    bottom = t.bottom;
  } else {
    bottom = mushroomCap(L, { R: sD / 2, H: sH, yb: h - sH });
    bulb = [0, h - sH * 0.6, 0];
    L.bulb('globe', bulb, Math.min(0.025, sH * 0.35));
  }
  L.add(K.cylinder(0.006, 0.006, bottom + sH * 0.5 - bh, { seg: 10 }).translate(0, bh - 0.003, 0), L.mat('metal'), 'metal');
  L.spot(bulb, [0, -1, 0], L.lumens(470), 1.15, 0.9);
  return L.finish();
}

// ---------------------------------------------------------------------------------------------------------------
// Wall lamps (back in z = 0, vertical middle at y = 0)

/** Round wall plate (part base) centred at (x, y), facing +z. */
function wallDisc(L, d, t, y = 0) {
  const g = discGeo(d, t + EMBED, L.q.lathe, { y0: -EMBED, round: Math.min(0.004, t / 2) });
  g.rotateX(Math.PI / 2).translate(0, y, 0);
  // lathe axis +y → after rotateX(π/2) the axis is +z (plate front toward the room)
  L.add(g, L.mat('base'), 'base');
  return t;
}

/** Rectangular wall plate W × H (part base) centred at (0, y), t thick in front of the wall plus `embed` into it. */
function wallRect(L, W, H, t, y = 0, part = 'base', embed = EMBED) {
  L.add(K.roundedBox(W, H, t + embed, Math.min(0.004, W / 6, H / 6), 2).translate(0, y, (t - embed) / 2), L.mat(part), part);
  return t;
}

/** Spot half-angle from params.beamDeg (hidden; full beam in degrees), else `fb` (radians). */
const beamOf = (L, fb) => (num(L.P.beamDeg, 0) > 0 ? clamp(L.P.beamDeg, 10, 120) * DEG / 2 : fb);

/**
 * Visible cord with a plug (params.plug, wall lamps without a wall box): from the bottom of the plate (x, yTop) down the
 * wall to 45 cm below the lamp, ending in the plug (part cord). Makes the model taller than dims.h on purpose.
 */
function plugCord(L, x, yTop) {
  const yEnd = -L.dims.h / 2 - 0.45;
  const pts = [[x, yTop, 0.008], [x + 0.004, yTop - 0.05, 0.011], [x + 0.012, yTop - 0.2, 0.009], [x + 0.016, yEnd + 0.12, 0.009], [x + 0.016, yEnd + 0.035, 0.01]];
  L.add(K.tube(pts, 0.0028, { radial: 6, seg: 24 }), L.mat('cord'), 'cord');
  L.add(K.roundedBox(0.032, 0.045, 0.02, 0.004, 1).translate(x + 0.016, yEnd + 0.0225, 0.012), L.mat('cord'), 'cord');
}

/** Wall sconce 'globe': an opal globe on a short neck in front of a round plate, or on an L-bracket when dims.h is taller. */
function sconceGlobe(L) {
  const { w, d, h } = L.dims;
  const P = L.P;
  const pt = 0.012;
  const R = Math.max(0.02, Math.min(num(P.shadeD, 0.94 * Math.min(w, h)) / 2, Math.min(w, h) / 2, (d - pt) / 2));
  const zc = Math.max(d - R, pt + R);
  const metal = L.mat('metal');
  const pD = clamp(num(P.baseD, Math.min(0.1, R * 1.4)), 0.04, Math.min(0.16, h));
  const onBracket = h - 2 * R > 0.03;
  const cy = onBracket ? h / 2 - R : 0;
  if (onBracket && P.plateShape === 'rect') {
    // a tall narrow plate (Milo, baseD wide, 3/4 of dims.h tall) with the globe in front of its top on a short neck
    const pW = clamp(num(P.baseD, 0.05), 0.02, Math.max(0.02, w));
    const pH = h * 0.75, yP = -h * 0.12;
    wallRect(L, pW, pH, pt, yP);
    const yN = Math.min(cy, yP + pH / 2 - Math.min(0.012, pW / 2));
    L.add(rod([0, yN, pt], [0, yN, zc - R * 0.8], Math.min(0.012, R * 0.25, pW * 0.35), L.q.lathe), metal, 'metal');
    L.add(K.cylinder(R * 0.3, R * 0.3, 0.016, { seg: L.q.lathe }).rotateX(Math.PI / 2).translate(0, yN, zc - R - 0.012), metal, 'metal');
    globeShade(L, { R, cy, z: zc, open: 0, openAt: 'top' });
  } else if (onBracket) {
    // plate low on the wall, an L-bracket out and up to the holder under the globe
    const yP = -h / 2 + pD / 2;
    wallDisc(L, pD, pt, yP);
    const yH = cy - R * 0.92;
    L.add(rod([0, yP, pt], [0, yP, zc], 0.0055, L.q.rod), metal, 'metal');
    L.add(xf(K.sphere(0.008, { wSeg: 10, hSeg: 8 }), [0, yP, zc]), metal, 'metal');
    L.add(rod([0, yP, zc], [0, yH - 0.018, zc], 0.0055, L.q.rod), metal, 'metal');
    L.add(K.cylinder(R * 0.4, R * 0.32, 0.022, { seg: L.q.lathe }).translate(0, yH - 0.02, zc), metal, 'metal');
    globeShade(L, { R, cy, z: zc, open: 0.34, openAt: 'bottom' });
  } else {
    // the globe straight in front of the plate on a short neck with a gallery ring
    wallDisc(L, pD, pt, 0);
    L.add(rod([0, 0, pt], [0, 0, zc - R * 0.8], Math.min(0.014, R * 0.3), L.q.lathe), metal, 'metal');
    L.add(K.cylinder(R * 0.3, R * 0.3, 0.016, { seg: L.q.lathe }).rotateX(Math.PI / 2).translate(0, 0, zc - R - 0.012), metal, 'metal');
    globeShade(L, { R, cy, z: zc, open: 0, openAt: 'top' });
  }
  const bp = [0, cy, zc];
  L.bulb('globe', bp, clamp(R * 0.3, 0.008, 0.025), { intensity: 2.5 });
  L.point(bp, L.lumens(400));
  return L.finish();
}

/** Wall sconce 'updown' (Stave, Abelone): an open glass / opal tube on a bracket, light out of both ends (2 spots). */
function sconceUpDown(L) {
  const { w, d, h } = L.dims;
  const P = L.P;
  const pt = 0.012;
  const H = clamp(num(P.shadeH, h), 0.04, h);
  // the tube fills w; it is flattened front-to-back when dims.d is shallower than its width
  const Rx = Math.max(0.015, Math.min(num(P.shadeD, w), w) / 2);
  const Rz = Math.max(0.012, Math.min(Rx, (d - pt - 0.006) / 2));
  const zc = Math.max(d - Rz, pt + 0.006 + Rz);
  const metal = L.mat('metal');
  wallRect(L, Math.min(0.05, w * 0.6), Math.min(0.12, H * 0.6), pt);
  L.add(rod([0, 0, pt], [0, 0, zc - Rz + 0.002], 0.006, L.q.rod), metal, 'metal');
  const glass = L.isGlass('shade');
  // glass panels hang from a thin metal rim along the top edge (Abelone); a fabric tube (Stave) needs no band
  if (glass) L.add(K.torus(Rx + 0.002, 0.0025, { radial: 6, tubular: L.q.lathe + 8 }).rotateX(Math.PI / 2).scale(1, 1, (Rz + 0.002) / (Rx + 0.002)).translate(0, H / 2 - 0.004, zc), metal, 'metal');
  const s = shell([[Rx, -H / 2], [Rx, 0], [Rx, H / 2]], 0.002, L.q.lathe + 8);
  // clear glass: frosted enough to read as a tube (the stock clear opacity all but disappears on a wall)
  const gOpts = glass ? { side: 'double', ...(L.kind('shade') === 'glass-clear' ? { opacity: Math.max(0.45, L.glassOpts('shade', {}).opacity ?? 0), roughness: 0.3 } : {}) } : undefined;
  const m = L.shadeMat('shade', 1.1, gOpts);
  for (const g of [s.outer, ...s.rims]) L.auto(g.scale(1, 1, Rz / Rx).translate(0, 0, zc), m, 'shade');
  L.auto(s.inner.scale(1, 1, Rz / Rx).translate(0, 0, zc), glass ? m : L.innerMat('inner', 0.45), glass ? 'shade' : 'inner');
  L.bulb('globe', [0, 0, zc], clamp(Math.min(Rx, Rz) * 0.45, 0.008, 0.025));
  const lm = L.lumens(400), a = beamOf(L, 0.35);
  L.spot([0, H / 2 - 0.01, zc], [0, 1, 0], lm / 2, a, 0.6);
  L.spot([0, -H / 2 + 0.01, zc], [0, -1, 0], lm / 2, a, 0.6);
  return L.finish();
}

/** Wall sconce 'flush' (Limotti): a glowing alabaster / opal panel on a wall plate, frontPlate = a metal plate in front. */
function sconceFlush(L) {
  const { w, d, h } = L.dims;
  const P = L.P;
  const pt = 0.012;
  const fp = !!P.frontPlate;
  const panelT = clamp(d - pt - (fp ? 0.006 : 0), 0.006, 0.05);
  const pw = Math.max(0.02, w - 0.02), ph = Math.max(0.02, h - 0.02);
  if (P.ends === 'round' || (P.ends !== 'square' && h > 1.8 * w)) {
    // pill (stadium) with fully rounded ends (Limotti): plate, glowing panel and a matte metal front plate with an LED
    // halo round it; the extrusions face +z
    const pill = (W, H, n = 16) => (H >= W ? K.stadiumShape(H, W, n) : K.stadiumShape(W, H, n));
    const up = (geo, W, H) => (H >= W ? geo.rotateZ(Math.PI / 2) : geo);
    L.add(up(K.extrudeShape(pill(w, h), pt + 0.004, { bevel: Math.min(0.002, pt / 4) }), w, h).translate(0, 0, -0.004), L.mat('base'), 'base');
    L.auto(up(K.extrudeShape(pill(pw, ph), panelT, { bevel: Math.min(0.004, panelT / 3) }), pw, ph).translate(0, 0, pt), L.shadeMat('shade', 1.2), 'shade');
    if (fp) {
      const fw = pw * 0.5, fh = ph * 0.86;
      L.add(up(K.extrudeShape(pill(fw, fh), 0.006, { bevel: 0.0015 }), fw, fh).translate(0, 0, pt + panelT), L.mat('metal', { flat: true, roughness: 0.45, metalness: 0.55 }), 'metal');
      // the LED light spilling out round the front plate: a thin glowing ring on the panel
      const g = 0.008;
      const ring = pill(fw + 2 * g, fh + 2 * g, 20);
      ring.holes.push(new THREE.Path(pill(fw - 0.002, fh - 0.002, 20).getPoints().reverse()));
      L.glowAdd(up(new THREE.ShapeGeometry(ring, 20), fw, fh).translate(0, 0, pt + panelT + 0.0006), L.bulbMat(1.6), null);
    }
  } else {
    // a flat plate the size of the lamp: only a little into the wall (its depth is a few cm)
    wallRect(L, w, h, pt, 0, 'base', 0.004);
    L.auto(K.roundedBox(pw, ph, panelT, Math.min(0.006, panelT / 2, pw / 4), 3).translate(0, 0, pt + panelT / 2), L.shadeMat('shade', 1.2), 'shade');
    if (fp) L.add(K.roundedBox(pw * 0.62, ph * 0.78, 0.006, 0.002, 2).translate(0, 0, pt + panelT + 0.003), L.mat('metal'), 'metal');
  }
  L.point([0, 0, d + 0.03], L.lumens(350));
  return L.finish();
}

/** Wall sconce 'bar' (Cargador): a slim housing along the wall, an up glow strip (indirect) and a down LED strip (reading). */
function sconceBar(L) {
  const { w, d, h } = L.dims;
  L.add(K.roundedBox(w, h, d + EMBED, Math.min(0.006, h / 4, d / 4), 3).translate(0, 0, (d - EMBED) / 2), L.mat('shade'), 'shade');
  const sw = Math.max(0.02, w - 0.03), sd = Math.max(0.006, d * 0.45);
  L.glowAdd(new THREE.PlaneGeometry(sw, sd).rotateX(-Math.PI / 2).translate(0, h / 2 + 0.0006, d * 0.55), L.bulbMat(1.5), null);
  L.glowAdd(new THREE.PlaneGeometry(sw, sd).rotateX(Math.PI / 2).translate(0, -h / 2 - 0.0006, d * 0.55), L.bulbMat(2.5), null);
  const lm = L.lumens(500);
  L.spot([0, h / 2 + 0.002, d * 0.55], [0, 1, 0], lm * 0.35, 1.2, 0.8);
  L.spot([0, -h / 2 - 0.002, d * 0.55], [0, -1, 0], lm * 0.65, beamOf(L, 0.7), 0.6);
  return L.finish();
}

/** Wall sconce 'shell' (Flora): a half cone against the wall, closed below and open on top; the light shines up. */
function sconceShell(L) {
  const { w, d, h } = L.dims;
  const P = L.P;
  const R = Math.max(0.03, Math.min(num(P.shadeD, w), w) / 2);
  const Rz = Math.max(0.02, Math.min(R, d - 0.004));
  const r0 = R * 0.32;
  const prof = [[0.002, -h / 2], [r0, -h / 2 + 0.002], ...[0.3, 0.65, 1].map((u) => [r0 + (R - r0) * u ** 0.8, -h / 2 + h * u])];
  const s = shell(prof, 0.003, L.q.lathe, { phiStart: -Math.PI / 2, phiLength: Math.PI });
  const o = L.shadeMat('shade', 1.1);
  for (const g of [s.outer, ...s.rims]) L.auto(g.scale(1, 1, Rz / R).translate(0, 0, 0.002), o, 'shade');
  L.auto(s.inner.scale(1, 1, Rz / R).translate(0, 0, 0.002), L.innerMat('inner', 0.5), 'inner');
  wallRect(L, Math.min(0.08, w * 0.4), Math.min(0.1, h * 0.4), 0.004, -h * 0.15);
  const z = Rz * 0.4;
  L.bulb('globe', [0, h * 0.05, z], clamp(Rz * 0.3, 0.008, 0.025));
  L.spot([0, h / 2 - 0.01, z], [0, 1, 0], L.lumens(400), beamOf(L, 1.0), 0.8);
  return L.finish();
}

const SCONCE = { globe: sconceGlobe, updown: sconceUpDown, flush: sconceFlush, bar: sconceBar, shell: sconceShell };

/**
 * Wall sconce: 'half-drum' (Lund, fabric half cylinder), 'spot' (Charge up/down head), 'globe', 'updown', 'flush'
 * (+ frontPlate), 'bar', 'shell' (see the sconce* helpers; beamDeg = their spot beam). At most 2 lights.
 */
function buildWallSconce(spec) {
  const L = new Lamp('wall-sconce', spec);
  const { w, d, h } = L.dims;
  const P = L.P;
  const shape = P.shadeShape || 'half-drum';
  if (SCONCE[shape]) return SCONCE[shape](L);
  if (shape === 'spot') {
    // compact up/down light on a slim magnetic wall plate (Charge, 8 × 5.4 × 10 cm): the head fills dims – w wide,
    // h tall, d deep from the wall with the plate – a flat back and a rounded front, the light out of the bottom
    // (a ribbed diffuser) and a little out of a slot in the top
    const pt = clamp(d * 0.12, 0.004, 0.012);
    const pD = Math.min(num(P.baseD, w * 0.85), w, h * 0.9);
    wallDisc(L, pD, pt, 0);
    const a = w / 2, b = Math.max(0.01, d - pt);
    const outline = (k, kz = k) => {
      // half superellipse (|x/a|^p + |z/b|^p = 1, p = 2.4), from the right wall corner round the front to the left
      const pts = [];
      const n = 24;
      for (let i = 0; i <= n; i++) {
        const t = (i / n) * Math.PI, c = Math.cos(t), s = Math.sin(t);
        pts.push([a * k * Math.sign(c) * Math.abs(c) ** (2 / 2.4), b * kz * s ** (2 / 2.4) + b * (1 - kz) * 0.5]);
      }
      return pts;
    };
    const plan = (geo) => geo.rotateX(Math.PI / 2); // shape (x, y) → plan (x, z); extrusion +z → −y
    const bevel = Math.min(0.006, h * 0.08, b * 0.25);
    const bh = h - 0.005; // the diffuser rings and the top slot fill the rest of dims.h
    L.add(plan(K.extrudeShape(outline(1), bh, { bevel, curveSegments: 6 })).translate(0, bh / 2, pt), L.mat('shade'), 'shade');
    // bottom: dark trim ring with the glowing ribbed diffuser inset
    const yb = -bh / 2;
    L.add(plan(new THREE.ShapeGeometry(new THREE.Shape(outline(0.9).map(([x, y]) => new THREE.Vector2(x, y))))).translate(0, yb - 0.0006, pt), L.mat('inner'), 'inner');
    const lens = plan(new THREE.ShapeGeometry(new THREE.Shape(outline(0.72).map(([x, y]) => new THREE.Vector2(x, y)))));
    L.glowAdd(lens.translate(0, yb - 0.0012, pt), L.bulbMat(2.5), null);
    for (let i = 1; i <= 2; i++) {
      const rr = Math.min(a, b / 2) * 0.33 * i;
      L.add(K.torus(rr, 0.0009, { radial: 4, tubular: 24 }).rotateX(Math.PI / 2).translate(0, yb - 0.0016, pt + b * 0.5), L.mat('inner'), 'inner');
    }
    // top: a narrow glowing slot (the «topplys»), facing up
    const slot = plan(new THREE.ShapeGeometry(new THREE.Shape(outline(0.7, 0.3).map(([x, y]) => new THREE.Vector2(x, y))))).rotateZ(Math.PI);
    L.glowAdd(slot.translate(0, bh / 2 + 0.0006, pt), L.bulbMat(1.5), null);
    const lm = L.lumens(200);
    L.spot([0, yb - 0.002, pt + b * 0.5], [0, -1, 0], lm * 0.75, 0.6, 0.6);
    L.spot([0, bh / 2 + 0.002, pt + b * 0.5], [0, 1, 0], lm * 0.25, 0.5, 0.6);
    return L.finish();
  }
  // half-drum fabric shade against the wall (Lund)
  const R = Math.min(w / 2, Math.max(d, 0.05));
  const t = 0.003;
  // tiers 2 (Trysil): the wide shade takes the top 65 %, a narrower one (R·0.7) below reaches up into it
  const tiers = num(P.tiers, 1) >= 2 ? 2 : 1;
  const bands = tiers === 2 ? [[R, h / 2 - 0.65 * h, h / 2], [R * 0.7, -h / 2, h / 2 - 0.65 * h + 0.012]] : [[R, -h / 2, h / 2]];
  const o = L.shadeMat('shade', 1.1);
  for (const [r, y0, y1] of bands) {
    const s = shell([[r, y0], [r, (y0 + y1) / 2], [r, y1]], t, Math.round(L.q.lathe * 0.6), { phiStart: -Math.PI / 2, phiLength: Math.PI });
    for (const g of [s.outer, ...s.rims]) L.auto(g.translate(0, 0, 0.004), o, 'shade');
    L.auto(s.inner.translate(0, 0, 0.004), L.innerMat('inner', 0.45), 'inner');
  }
  // back plate + bracket
  L.add(K.roundedBox(Math.min(0.1, w * 0.4), Math.min(0.12, h * 0.5), 0.012 + EMBED, 0.003, 1).translate(0, 0, (0.012 - EMBED) / 2), L.mat('metal'), 'metal');
  L.add(rod([0, -0.02, 0.012], [0, -0.02, R * 0.4], 0.006, 8), L.mat('metal'), 'metal');
  const bp = [0, -0.005, R * 0.45];
  L.socket(0, -0.045, bp[1] - 0.025, R * 0.45, 0.015);
  L.bulb('globe', bp, Math.min(0.028, R * 0.3));
  L.point(bp, L.lumens(470));
  return L.finish();
}

/**
 * Wall lamp on an arm with any shade (every shadeShape × armShape except the straight-arm originals below). Hanging
 * shades (drum, cone, dome, bell, globe, cylinder-spot) have their bottom at −h/2 and hang on a stem from the arm end;
 * standing ones (glass-mushroom, or bell / globe with shadeUp) sit on a holder with their top at h/2. armShape 'straight'
 * = horizontal from the plate, 'curved' = one smoothly bent tube (Sofia, ÅRSTID), 'swing' = pivot barrel + elbow, turned
 * swingDeg sideways (bedside swing arms). Hidden: baseD (plate Ø / width), plateShape 'disc' | 'rect' (swing: rect),
 * shadeD / shadeH / shadeTopD, shadeUp, swingDeg, plug. Exactly one light.
 */
function wallArmShade(L) {
  const { w, d, h } = L.dims;
  const P = L.P;
  const shape = P.shadeShape || 'glass-mushroom';
  const arm = P.armShape || 'straight';
  const metal = L.mat('metal');
  const standing = shape === 'glass-mushroom' || ((shape === 'bell' || shape === 'globe' || shape === 'drum') && !!P.shadeUp);
  // a drum standing on a socket cup (Torino: on a flat bracket straight out from a low plate)
  const drumUp = standing && shape === 'drum';
  const drumBar = drumUp && arm === 'straight';
  // pleated fabric (ÅRSTID): params.pleats = number of pleats (true = 40)
  const pleatN = P.pleats === true ? 40 : num(P.pleats, 0) > 0 ? clamp(Math.round(num(P.pleats, 40)), 12, 120) : 0;
  const sD = clamp(num(P.shadeD, w), 0.04, Math.max(0.04, w));
  const SHADE_H = { drum: 0.75, cone: 0.7, dome: 0.5, bell: 0.85, globe: 1, 'glass-mushroom': 0.72, 'cylinder-spot': 1.5 };
  const sH = clamp(num(P.shadeH, sD * (SHADE_H[shape] ?? 0.75)), 0.03, Math.max(0.03, h - 0.03));
  const R = shape === 'globe' ? Math.min(sD, sH) / 2 : sD / 2;
  // wall plate
  const plate = P.plateShape || (arm === 'swing' ? 'rect' : 'disc');
  const pt = 0.016;
  const pW = plate === 'rect' ? clamp(num(P.baseD, 0.06), 0.03, Math.max(0.03, Math.min(0.2, w))) : clamp(num(P.baseD, 0.1), 0.04, Math.max(0.04, Math.min(0.16, h)));
  const pH = plate === 'rect' ? clamp(num(P.plateH, 0.14), 0.04, h) : pW;
  // shade centre in plan: its front at dims.d (never into the wall); a swing arm turns it sideways round the pivot
  const z0 = pt + 0.014;
  let sx = 0, sz = Math.max(d - R, pt + R + 0.012);
  if (arm === 'swing') {
    const a = clamp(num(P.swingDeg, 0), -60, 60) * DEG;
    const reach = sz - z0;
    sx = clamp(Math.sin(a) * reach, -Math.max(0, w / 2 - R), Math.max(0, w / 2 - R));
    sz = z0 + Math.cos(a) * reach;
  }
  // heights: hanging shades from the bottom up, standing ones from the top down
  // tall boxes: a swing arm (Kalle) rises diagonally from a low plate to a knuckle at the top and the shade hangs just
  // under its end; a curved arm (Arum) runs up the wall from a low bracket and arches over, the shade at ≈ 3/4 height
  const highSwing = !standing && arm === 'swing' && h - sH > 0.15;
  const highCurve = !standing && arm === 'curved' && h - sH > 0.2;
  let yb = standing ? h / 2 - sH : -h / 2;
  if (highSwing) yb = h / 2 - 0.06 - sH;
  else if (highCurve) yb = h / 2 - 0.12 - sH;
  const yt = yb + sH;
  let yA, yP;
  if (highSwing) {
    yP = -h / 2 + pH / 2;
    yA = h / 2 - 0.02;
  } else if (highCurve) {
    yP = -h / 2 + pH / 2;
    yA = yt + 0.004;
  } else if (drumBar) {
    // the bracket just under the drum, on a low plate
    yA = yb - 0.03;
    yP = clamp(-h / 2 + pH / 2, yA - pH / 2 + 0.012, yA + pH / 2 - 0.012);
  } else if (standing) {
    yP = -h / 2 + pH / 2;
    yA = arm === 'swing' ? Math.max(yP, yb - 0.05) : yP;
  } else if (arm === 'curved') {
    yP = clamp(yt, -h / 2 + pH / 2, h / 2 - pH / 2);
    yA = yt + 0.004;
  } else if (arm === 'swing') {
    yA = Math.max(yt + 0.02, h / 2 - 0.03);
    yP = Math.min(yA, h / 2 - pH / 2);
  } else {
    yA = Math.max(yt + 0.015, h / 2 - pH / 2);
    yP = yA;
  }
  if (plate === 'rect') wallRect(L, pW, pH, pt, yP);
  else wallDisc(L, pW, pt, yP);
  // arm to the point above (hanging) or below (standing) the shade
  const yEnd = drumBar ? yA : standing ? yb - 0.026 : yA;
  if (highCurve) {
    // a rod straight up the wall from the bracket (a sleeve on the plate), an arch over the top and a short drop
    const zr = pt + 0.012, top = h / 2 - 0.007;
    const a = Math.max(0.01, (sz - zr) / 2), b = Math.min(a, 0.09);
    const pts = [[zr, yP - pH * 0.3]];
    if (top - b > yP - pH * 0.3 + 0.02) pts.push([zr, top - b]);
    for (let i = 1; i <= 16; i++) {
      const t = (i / 16) * Math.PI;
      pts.push([zr + a - a * Math.cos(t), top - b + b * Math.sin(t)]);
    }
    pts.push([sz, yt - 0.004]);
    L.add(K.tube(pts.map(([z, y]) => [0, y, z]), 0.006, { radial: L.q.rod, seg: 72, curve: 'line' }), metal, 'metal');
    // the swivel joint just above the shade
    L.add(K.cylinder(0.0085, 0.0085, 0.022, { seg: L.q.rod + 2 }).translate(0, yt + 0.006, sz), metal, 'metal');
    L.add(K.cylinder(0.0095, 0.0095, pH * 0.8, { seg: L.q.rod + 2 }).translate(0, yP - pH * 0.4, zr), metal, 'metal');
    L.add(K.box(0.012, pH * 0.6, zr - pt + 0.002).translate(0, yP, (pt + zr) / 2), metal, 'metal');
  } else if (highSwing) {
    // pivot barrel on the low plate, arm 1 diagonally up to a knuckle near the top, arm 2 out to the shade
    L.add(K.cylinder(0.012, 0.012, 0.06, { seg: L.q.rod + 4 }).translate(0, yP - 0.03, z0), metal, 'metal');
    for (const s of [-1, 1]) L.add(K.box(0.02, 0.008, z0 - pt + 0.004).translate(0, yP + s * 0.022, (pt + z0) / 2), metal, 'metal');
    const el = [sx * 0.55, yA, z0 + 0.55 * (sz - z0)];
    L.add(rod([0, yP, z0], el, 0.006, L.q.rod), metal, 'metal');
    L.add(xf(K.sphere(0.011, { wSeg: 12, hSeg: 8 }), el), metal, 'metal');
    L.add(rod(el, [sx, yA, sz], 0.006, L.q.rod), metal, 'metal');
    L.add(xf(K.sphere(0.008, { wSeg: 10, hSeg: 8 }), [sx, yA, sz]), metal, 'metal');
  } else if (drumBar) {
    // a flat bar out from the plate, a little past the socket cup
    const zE = sz + Math.min(R * 0.35, 0.03);
    L.add(K.roundedBox(0.018, 0.009, zE - pt + 0.002, 0.002, 1).translate(0, yA - 0.0045, (pt + zE) / 2), metal, 'metal');
  } else if (arm === 'curved') {
    const Lz = sz - pt;
    let pts;
    if (standing) {
      pts = bezier([pt, yP], [pt + 0.55 * Lz, yP], [sz, yP + 0.45 * (yEnd - yP)], [sz, yEnd], 24);
    } else {
      // swan neck: out of the plate, over a crest at the top of the box, straight down into the shade
      const top = h / 2 - 0.008, mz = pt + 0.62 * Lz;
      pts = [...bezier([pt, yP], [pt + 0.45 * (mz - pt), yP], [mz - 0.3 * (mz - pt), top], [mz, top], 14), ...bezier([mz, top], [mz + 0.55 * (sz - mz), top], [sz, yA + 0.55 * (top - yA)], [sz, yA], 14).slice(1)];
    }
    L.add(K.tube(pts.map(([z, y]) => [0, y, z]), 0.006, { radial: L.q.rod, seg: 40 }), metal, 'metal');
  } else if (arm === 'swing') {
    // pivot barrel on a bracket, arm 1 to an elbow at 0.55 of the reach, arm 2 to the shade
    L.add(K.cylinder(0.012, 0.012, 0.06, { seg: L.q.rod + 4 }).translate(0, yA - 0.03, z0), metal, 'metal');
    for (const s of [-1, 1]) L.add(K.box(0.02, 0.008, z0 - pt + 0.004).translate(0, yA + s * 0.022, (pt + z0) / 2), metal, 'metal');
    const el = [sx * 0.55, yA, z0 + (sz - z0) * 0.55];
    L.add(rod([0, yA, z0], el, 0.006, L.q.rod), metal, 'metal');
    L.add(xf(K.sphere(0.011, { wSeg: 12, hSeg: 8 }), el), metal, 'metal');
    L.add(rod(el, [sx, yA, sz], 0.006, L.q.rod), metal, 'metal');
    L.add(xf(K.sphere(0.008, { wSeg: 10, hSeg: 8 }), [sx, yA, sz]), metal, 'metal');
    if (standing) L.add(rod([sx, yA, sz], [sx, yEnd, sz], 0.0055, L.q.rod), metal, 'metal');
  } else {
    L.add(rod([0, yA, pt], [0, yA, sz], 0.0055, L.q.rod), metal, 'metal');
    L.add(xf(K.sphere(0.008, { wSeg: 10, hSeg: 8 }), [0, yA, sz]), metal, 'metal');
    if (standing) L.add(rod([0, yA, sz], [0, yEnd, sz], 0.0055, L.q.rod), metal, 'metal');
  }
  if (P.plug) plugCord(L, 0, yP - pH / 2);
  // the shade
  const lm = L.lumens(470);
  let bulb;
  if (drumUp) {
    // socket cup from the bracket up into the drum; the light out of both ends
    L.add(K.cylinder(R * 0.3, R * 0.3, yb + 0.025 - yEnd, { seg: L.q.lathe }).translate(sx, yEnd, sz), metal, 'metal');
    bulb = drumShade(L, { R, H: sH, yb, x: sx, z: sz, bulbR: 0.025, spider: false, ...(pleatN ? pleatOpts(L, pleatN, R) : {}) });
    L.point(bulb, lm);
    return L.finish();
  }
  if (standing) {
    L.add(K.cylinder(R * 0.32, R * 0.36, 0.022, { seg: L.q.lathe }).translate(sx, yb - 0.026, sz), metal, 'metal');
    if (shape === 'bell') bulb = bellShade(L, { R, H: sH, yb, x: sx, z: sz, up: true });
    else if (shape === 'globe') {
      globeShade(L, { R, cy: yb + R, x: sx, z: sz, open: 0.3, openAt: 'bottom' });
      bulb = [sx, yb + R, sz];
      L.bulb('globe', bulb, clamp(R * 0.3, 0.008, 0.022), { intensity: 2.5 });
    } else {
      // opal mushroom glass, as the August
      const prof = [[R * 0.3, yb], [R * 0.42, yb + sH * 0.08], [R * 0.86, yb + sH * 0.3], [R, yb + sH * 0.5], [R * 0.96, yb + sH * 0.66], [R * 0.78, yb + sH * 0.86], [R * 0.42, yb + sH * 0.98], [0.001, yt]];
      L.auto(K.lathe(prof, { seg: L.q.lathe + 8 }).translate(sx, 0, sz), L.shadeMat('shade', 1.15, L.isGlass('shade') ? { side: 'double' } : undefined), 'shade');
      bulb = [sx, yb + sH * 0.45, sz];
      L.bulb('globe', bulb, clamp(R * 0.3, 0.008, 0.022), { intensity: 2.5 });
    }
    L.point(bulb, lm);
    return L.finish();
  }
  // hanging: a stem from the arm end down to the top of the shade
  let top = yt;
  if (shape === 'dome') {
    const dome = domeShade(L, { R, H: sH, yb, x: sx, z: sz });
    bulb = dome.bulb;
    top = yt + 0.01;
    L.socket(sx, bulb[1] + 0.02, yt, sz, 0.012);
    L.spot(bulb, [0, -1, 0], lm, dome.angle, 0.8);
  } else if (shape === 'bell') {
    bulb = bellShade(L, { R, H: sH, yb, x: sx, z: sz });
    L.socket(sx, bulb[1] + 0.022, yt, sz, Math.min(0.014, R * 0.22));
    L.point(bulb, lm);
  } else if (shape === 'globe') {
    globeShade(L, { R, cy: yb + R, x: sx, z: sz, open: 0.22, openAt: 'top' });
    L.add(K.cylinder(R * 0.26, R * 0.3, 0.02, { seg: L.q.lathe }).translate(sx, yt - 0.016, sz), metal, 'metal');
    bulb = [sx, yb + R, sz];
    L.bulb('globe', bulb, clamp(R * 0.3, 0.008, 0.022), { intensity: 2.5 });
    L.point(bulb, lm);
  } else if (shape === 'cylinder-spot') {
    const s = shell([[R, yb], [R, yb + sH / 2], [R, yt]], 0.0015, L.q.lathe, { rimTop: false });
    for (const g of [s.outer, ...s.rims]) L.add(g.translate(sx, 0, sz), L.mat('shade'), 'shade');
    L.add(new THREE.CircleGeometry(R, L.q.lathe).rotateX(-Math.PI / 2).translate(sx, yt, sz), L.mat('shade'), 'shade');
    L.auto(s.inner.translate(sx, 0, sz), L.innerMat('inner', 0.4), 'inner');
    bulb = [sx, yb + 0.018, sz];
    L.bulb('led', [sx, yb + 0.02, sz], R * 0.7, { dir: [0, -1, 0], intensity: 3 });
    L.spot(bulb, [0, -1, 0], L.lumens(345), 0.45, 0.5);
  } else {
    // fabric drum / cone (cone: shadeTopD, default 60 % of the bottom)
    const Rt = shape === 'cone' ? clamp(num(P.shadeTopD, sD * 0.6) / 2, 0.006, R * 1.3) : R;
    bulb = drumShade(L, { R, Rtop: Rt, H: sH, yb, x: sx, z: sz, bulbR: 0.025, ...(pleatN ? pleatOpts(L, pleatN, R) : {}) });
    L.socket(sx, bulb[1] + 0.025, yt - 0.012, sz, 0.013);
    if (L.translucency() > 0.25) L.point(bulb, lm);
    else L.spot(bulb, [0, -1, 0], lm, Math.atan2(R, Math.max(0.02, bulb[1] - yb)) * 1.1, 0.8);
  }
  if (yA - top > 0.004) L.add(rod([sx, top - 0.004, sz], [sx, yA, sz], arm === 'curved' ? 0.006 : 0.0045, L.q.rod), metal, 'metal');
  return L.finish();
}

/**
 * Flexible reading wall lamp (armShape 'flex': Artic, Hugin, Juno): a slim back plate at the top, a gooseneck out and
 * down, a small cylinder (or 'cone') head aimed down and forward; one spot along the head.
 */
function wallArmFlex(L) {
  const { w, d, h } = L.dims;
  const P = L.P;
  const metal = L.mat('metal');
  const pH = clamp(Math.min(0.12, h * 0.6), 0.04, h);
  const yP = h / 2 - pH / 2;
  wallRect(L, Math.min(0.03, w), pH, 0.012, yP);
  const hD = clamp(num(P.shadeD, Math.min(0.06, w)), 0.025, Math.max(0.025, w));
  const hL = clamp(num(P.shadeH, hD * 1.4), 0.03, 0.2);
  const dir = new THREE.Vector3(0, -1, 0.6).normalize();
  // the head's opening lands at the front bottom of the box
  const E = new THREE.Vector3(0, -h / 2 + hD * 0.4 - dir.y * hL, d - hD * 0.4 - dir.z * hL);
  E.y = Math.min(E.y, yP - 0.02);
  E.z = Math.max(E.z, 0.06);
  const y0 = yP - pH * 0.2;
  const pts = [[0, y0, 0.012], [0, y0 + 0.015, 0.012 + 0.35 * (E.z - 0.012)], [0, E.y + 0.6 * (y0 - E.y), 0.012 + 0.75 * (E.z - 0.012)], E.clone().addScaledVector(dir, -0.03).toArray(), E.toArray()];
  L.add(K.tube(pts, 0.005, { radial: L.q.rod, seg: 40 }), metal, 'metal');
  const r = hD / 2;
  const prof = P.shadeShape === 'cone' ? [[r, -hL], [r * 0.72, -hL * 0.5], [r * 0.45, -0.006], [0.006, 0]] : [[r, -hL], [r, -hL * 0.5], [r, -0.004], [r - 0.004, 0], [0.003, 0]];
  const q = aim(dir.clone().negate());
  const s = shell(prof, 0.0015, L.q.lathe, { rimTop: false });
  for (const g of [s.outer, ...s.rims]) L.add(xf(g, E, q), L.mat('shade'), 'shade');
  L.auto(xf(s.inner, E, q), L.innerMat('inner', 0.5), 'inner');
  const bp = E.clone().addScaledVector(dir, hL - 0.006);
  L.bulb('led', bp, r * 0.75, { dir: dir.toArray(), intensity: 3 });
  L.spot(bp.toArray(), dir.toArray(), L.lumens(300), 0.55, 0.6);
  if (P.plug) plugCord(L, 0, yP - pH / 2);
  return L.finish();
}

/**
 * Wall lamp on an arm. The straight-arm originals keep their own code: 'glass-mushroom' (August: round plate, horizontal
 * arm, opal glass on a holder) and 'cylinder-spot' (Nymåne); every other shade / arm goes through wallArmShade, 'flex'
 * through wallArmFlex. plug adds a visible cord with a plug down the wall.
 */
function buildWallArm(spec) {
  const L = new Lamp('wall-arm', spec);
  const { w, d, h } = L.dims;
  const P = L.P;
  const shape = P.shadeShape || 'glass-mushroom';
  const arm = P.armShape || 'straight';
  if (arm === 'flex') return wallArmFlex(L);
  if (arm !== 'straight' || (shape !== 'glass-mushroom' && shape !== 'cylinder-spot')) return wallArmShade(L);
  const metal = L.mat('metal');
  if (shape === 'cylinder-spot') {
    // rectangular plate, short arm, cylinder head with the light pointing down (Nymåne)
    const pw = Math.min(w * 0.75, num(P.baseD, w));
    const pt = 0.025;
    L.add(K.roundedBox(pw, h, pt + EMBED, 0.004, 2).translate(0, 0, (pt - EMBED) / 2), L.mat('base'), 'base');
    const R = Math.min(num(P.shadeD, w), w) / 2;
    const cz = Math.max(pt + R + 0.02, d - R);
    const hh = Math.min(num(P.shadeH, h), h);
    L.add(K.box(0.014, 0.014, cz - R - pt + 0.004).translate(0, h * 0.3, pt + (cz - R - pt) / 2), metal, 'metal');
    const yb = -hh / 2;
    const s = shell([[R, yb], [R, 0], [R, yb + hh]], 0.0015, L.q.lathe, { rimTop: false });
    for (const g of [s.outer, ...s.rims]) L.add(g.translate(0, 0, cz), L.mat('shade'), 'shade');
    L.add(new THREE.CircleGeometry(R, L.q.lathe).rotateX(-Math.PI / 2).translate(0, yb + hh, cz), L.mat('shade'), 'shade');
    L.auto(s.inner.translate(0, 0, cz), L.innerMat('inner', 0.4), 'inner');
    L.bulb('led', [0, yb + 0.02, cz], R * 0.7, { dir: [0, -1, 0], intensity: 3 });
    L.spot([0, yb + 0.018, cz], [0, -1, 0], L.lumens(345), 0.45, 0.5);
    if (P.plug) plugCord(L, 0, -h / 2);
    return L.finish();
  }
  // round plate, horizontal arm, opal mushroom glass on a holder (August)
  const pD = Math.min(num(P.baseD, 0.1), h * 0.6);
  const sD = Math.min(num(P.shadeD, w), w);
  const R = sD / 2;
  const gH = Math.min(num(P.shadeH, sD * 0.72), h * 0.7);
  const armY = -h / 2 + pD / 2;
  wallDisc(L, pD, 0.016, armY);
  const cz = Math.max(0.05, d - R);
  L.add(rod([0, armY, 0.016], [0, armY, cz], 0.0055, 8), metal, 'metal');
  const gy0 = h / 2 - gH;
  L.add(rod([0, armY, cz], [0, gy0 + 0.012, cz], 0.0055, 8), metal, 'metal');
  L.add(K.cylinder(R * 0.32, R * 0.36, 0.022, { seg: L.q.lathe }).translate(0, gy0 - 0.004, cz), metal, 'metal');
  // mushroom glass: rounded dome on a narrower neck
  const prof = [[R * 0.3, gy0], [R * 0.42, gy0 + gH * 0.08], [R * 0.86, gy0 + gH * 0.3], [R, gy0 + gH * 0.5], [R * 0.96, gy0 + gH * 0.66], [R * 0.78, gy0 + gH * 0.86], [R * 0.42, gy0 + gH * 0.98], [0.001, gy0 + gH]];
  L.auto(K.lathe(prof, { seg: L.q.lathe + 8 }).translate(0, 0, cz), L.shadeMat('shade', 1.15, L.isGlass('shade') ? { side: 'double' } : undefined), 'shade');
  const bp = [0, gy0 + gH * 0.45, cz];
  L.bulb('globe', bp, Math.min(0.022, R * 0.3), { intensity: 2.5 });
  L.point(bp, L.lumens(470));
  if (P.plug) plugCord(L, 0, armY - pD / 2);
  return L.finish();
}

// ---------------------------------------------------------------------------------------------------------------
// Definitions

/** Archetypes of this file that data/archetypes.json does not list (yet) – same shape as its entries. */
const LOCAL_SCHEMA = {
  'pendant-slatted': { family: 'lamp', mount: 'ceiling', label: 'Spilelampe (tre)', parts: ['shade', 'inner', 'metal', 'cord'] },
};

function def(id, build, defaults, { params = {}, dimsRange, parts } = {}) {
  const a = schema.archetypes[id] || LOCAL_SCHEMA[id];
  const fam = schema.families[a.family];
  const list = parts || a.parts || fam.parts;
  const d = defaults.dims;
  return {
    label: a.label,
    mount: a.mount,
    parts: [...list],
    partLabels: Object.fromEntries(list.map((p) => [p, PART_LABELS[id]?.[p] || fam.partLabels[p] || p])),
    defaults: { params: {}, ...defaults },
    params,
    dimsRange: dimsRange || {
      w: [+(d.w * 0.5).toFixed(2), +(d.w * 2).toFixed(2)],
      d: [+(d.d * 0.5).toFixed(2), +(d.d * 2).toFixed(2)],
      h: [+(d.h * 0.5).toFixed(2), +(d.h * 1.6).toFixed(2)],
    },
    build,
  };
}

/** Archetype-specific Norwegian part names where the family's generic ones would mislead. */
const PART_LABELS = {
  'chandelier-molecule': { base: 'Takkopp', metal: 'Armer', cord: 'Stang' },
  'ceiling-ring': { shade: 'Lysflate / glass', inner: 'Innside / nav', base: 'Takkopp', metal: 'Ring og arm', cord: 'Oppheng' },
  'pendant-linear': { shade: 'Armatur', inner: 'Lysflate', base: 'Takkopp', cord: 'Oppheng' },
  'pendant-felt': { shade: 'Filt (toppene)', inner: 'Filt (bunnen)', base: 'Takfeste', metal: 'Beslag', cord: 'Wire' },
  'pendant-slatted': { shade: 'Spiler (utside)', inner: 'Spiler (innside)', metal: 'Takkopp', cord: 'Ledning' },
  'pendant-cylinder': { base: 'Takkopp', inner: 'Innside / linse' },
  'floor-tripod': { base: 'Stativ', metal: 'Beslag' },
  'wall-sconce': { base: 'Veggplate', metal: 'Brakett' },
  'wall-arm': { base: 'Veggplate', metal: 'Arm' },
};
for (const id of ['pendant-dome', 'pendant-globe', 'pendant-multi', 'pendant-tiered', 'pendant-woven', 'pendant-mushroom']) {
  PART_LABELS[id] = { base: 'Takkopp', metal: 'Metall / oppheng', ...(PART_LABELS[id] || {}) };
}

const look = (shade, shadeKind, metal = '#1a1a1a', metalKind = 'black-metal', inner = '#e8e4dc', innerKind = 'painted', cordHex = '#1a1a1a') => ({
  colors: { shade, inner, base: metal, metal, cord: cordHex },
  materials: { shade: shadeKind, inner: innerKind, base: metalKind, metal: metalKind, cord: 'cotton' },
});

const DROP = { drop: { type: 'number', min: 0.05, max: 2.0, step: 0.01, unit: 'm', label: 'Avstand fra tak til underkant' } };
const SHADE_GLOW = { translucent: { type: 'number', min: 0, max: 1, step: 0.05, label: 'Lys gjennom skjermen' } };

const C = (id, build, dims, params, l, extra = {}) =>
  def(id, build, { dims, params: { drop: 0.8, ...params }, ...l }, { ...extra, params: { ...DROP, ...(extra.params || {}) } });
const F = (id, build, dims, l, params = {}, extra = {}) => def(id, build, { dims, params, ...l }, extra);

export const archetypes = {
  'pendant-dome': C('pendant-dome', buildPendantDome, { w: 0.4, d: 0.4, h: 0.25 }, {}, look('#1a1a1a', 'black-metal', '#1a1a1a', 'black-metal', '#f2efe8', 'painted'), {
    params: {
      ribbed: { type: 'bool', label: 'Riflet glass' },
      slats: { type: 'bool', label: 'Spileskjerm' },
    },
    dimsRange: { w: [0.15, 0.8], d: [0.15, 0.8], h: [0.1, 0.5] },
  }),
  'pendant-globe': C('pendant-globe', buildPendantGlobe, { w: 0.3, d: 0.3, h: 0.3 }, {}, look('#f3f1ec', 'glass-opal', '#1a1a1a', 'black-metal'), {
    dimsRange: { w: [0.12, 0.6], d: [0.12, 0.6], h: [0.12, 0.7] },
  }),
  'pendant-cylinder': C('pendant-cylinder', buildPendantCylinder, { w: 0.08, d: 0.08, h: 0.3 }, {}, look('#1a1a1a', 'black-metal', '#1a1a1a', 'black-metal', '#1a1a1a', 'black-metal'), {
    dimsRange: { w: [0.04, 0.3], d: [0.04, 0.3], h: [0.08, 0.8] },
  }),
  'pendant-linear': C('pendant-linear', buildPendantLinear, { w: 1.0, d: 0.05, h: 0.05 }, { drop: 0.9 }, look('#1a1a1a', 'black-metal', '#1a1a1a', 'black-metal', '#f4efe6', 'glass-opal'), {
    params: { count: { type: 'number', min: 1, max: 12, step: 1, label: 'Antall lyspunkter' } },
    dimsRange: { w: [0.4, 2.0], d: [0.01, 0.15], h: [0.01, 0.12] },
  }),
  'pendant-felt': C('pendant-felt', buildPendantFelt, { w: 1.06, d: 0.52, h: 0.215 }, { drop: 0.85 }, look('#857a45', 'felt', '#e9e7e1', 'painted', '#6b5d40', 'felt', '#9a9a9a'), {
    dimsRange: { w: [0.5, 1.6], d: [0.25, 0.8], h: [0.1, 0.4] },
  }),
  'pendant-multi': C('pendant-multi', buildPendantMulti, { w: 0.84, d: 0.84, h: 0.3 }, { drop: 1.0, count: 8, layout: 'branches' }, look('#1a1a1a', 'black-metal', '#1a1a1a', 'black-metal', '#c9a14a', 'brass'), {
    params: {
      layout: { type: 'enum', options: [['branches', 'Armer'], ['row', 'På rekke'], ['cluster', 'Klase']], label: 'Oppbygning' },
      count: { type: 'number', min: 1, max: 16, step: 1, label: 'Antall skjermer' },
    },
    dimsRange: { w: [0.3, 1.6], d: [0.1, 1.6], h: [0.1, 0.6] },
  }),
  'pendant-tiered': C('pendant-tiered', buildPendantTiered, { w: 0.45, d: 0.45, h: 0.24 }, { tiers: 3 }, look('#cbb89b', 'painted', '#cbb89b', 'painted', '#efe6d6', 'painted'), {
    params: { tiers: { type: 'number', min: 2, max: 6, step: 1, label: 'Antall lag' } },
    dimsRange: { w: [0.2, 0.8], d: [0.2, 0.8], h: [0.1, 0.45] },
  }),
  'pendant-woven': C('pendant-woven', buildPendantWoven, { w: 0.5, d: 0.5, h: 0.28 }, { weave: 'rattan' }, look('#c29b63', 'rattan', '#e2dccf', 'painted', '#b8955f', 'rattan'), {
    params: {
      weave: { type: 'enum', options: [['rattan', 'Rotting (spiler)'], ['bamboo', 'Bambus (flettet)'], ['fabric', 'Stoff (plissert)'], ['linen', 'Lin (sylinder med ramme)']], label: 'Utførelse' },
      ...SHADE_GLOW,
    },
    dimsRange: { w: [0.25, 1.0], d: [0.25, 1.0], h: [0.12, 0.6] },
  }),
  'pendant-mushroom': C('pendant-mushroom', buildPendantMushroom, { w: 0.45, d: 0.45, h: 0.25 }, {}, look('#d8cdb9', 'glass-opal', '#1a1a1a', 'black-metal', '#f2efe8', 'glass-opal'), {
    params: SHADE_GLOW,
    dimsRange: { w: [0.2, 0.8], d: [0.2, 0.8], h: [0.1, 0.45] },
  }),
  // Secto 4200 in birch. Params (catalogue products bring their own): profile 'secto' | 'octo', profilePoints
  // [[m down from the top, outer Ø], …] (followed exactly; else SLAT_PROFILES), slats (count at the nominal neck),
  // slatW / slatT (strip width when the neck is open / thickness), rings, neckD / neckH (nominal neck – reshape a
  // template only when no profilePoints are given), shadeD / shadeH (nominal size), bulbAt (bulb below the top),
  // closedTop, openBottom (informational: the bottom is always open), canopyD / canopyH (ceiling cup), dropDefault /
  // maxDrop (shop cable), lumens, colorK.
  'pendant-slatted': C('pendant-slatted', buildPendantSlatted, { w: 0.3, d: 0.3, h: 0.6 }, {
    drop: SLAT_DROP, profile: 'secto', slats: 52, slatW: 0.0078, slatT: 0.0025, rings: 3, bulbAt: 0.1, closedTop: true,
    openBottom: true, canopyD: 0.122, canopyH: 0.112, lumens: 806, colorK: 3000,
  }, {
    colors: { shade: '#dcc6a2', inner: '#e4d3b6', metal: '#eeece8', cord: '#e8e6e1' },
    materials: { shade: 'ash', inner: 'ash', metal: 'painted', cord: 'cotton' },
  }, {
    parts: ['shade', 'inner', 'metal', 'cord'],
    params: {
      drop: { ...DROP.drop, max: 2.2 },
      profile: { type: 'enum', options: [['secto', 'Kjegle (Secto)'], ['octo', 'Kolbe (Octo)']], label: 'Form' },
      slats: { type: 'number', min: 16, max: 96, step: 1, label: 'Antall spiler' },
    },
    dimsRange: { w: [0.15, 0.8], d: [0.15, 0.8], h: [0.25, 1.0] },
  }),
  'ceiling-ring': C('ceiling-ring', buildCeilingRing, { w: 0.6, d: 0.6, h: 0.3 }, { drop: 0.3 }, look('#f3f1ec', 'glass-opal', '#1a1a1a', 'black-metal', '#f3efe6', 'glass-opal'), {
    params: {
      style: { type: 'enum', options: [['halo', 'Hengende ring'], ['crown', 'Ring med glasstaver'], ['arm', 'Ring på arm'], ['multi', 'Flere ringer']], label: 'Utførelse' },
    },
    dimsRange: { w: [0.25, 1.2], d: [0.25, 1.2], h: [0.02, 0.5] },
  }),
  'chandelier-molecule': C('chandelier-molecule', buildChandelierMolecule, { w: 1.0, d: 1.0, h: 0.8 }, { drop: 0.79, hubDrop: 0.42, shades: 8, shadeD: [0.16, 0.16, 0.16, 0.16, 0.105, 0.105, 0.105, 0.105], canopyD: 0.12 }, look('#1a1a1a', 'black-metal', '#1a1a1a', 'black-metal', '#b08a4a', 'brass'), {
    params: {
      hubDrop: { type: 'number', min: 0.1, max: 1.5, step: 0.01, unit: 'm', label: 'Stang fra tak til nav' },
      shades: { type: 'number', min: 3, max: 12, step: 1, label: 'Antall skjermer' },
    },
    dimsRange: { w: [0.5, 1.6], d: [0.4, 1.6], h: [0.4, 1.4] },
  }),
  'floor-arc': F('floor-arc', buildFloorArc, { w: 0.55, d: 0.4, h: 1.55 }, look('#e3ddd2', 'linen'), { armShape: 'angular' }, {
    params: {
      armShape: { type: 'enum', options: [['arc', 'Bue'], ['angular', 'Vinkel']], label: 'Arm' },
      ...SHADE_GLOW,
    },
    dimsRange: { w: [0.3, 2.0], d: [0.3, 2.0], h: [1.2, 2.3] },
  }),
  // shadeShape 'cone' (+ shadeBottomD) = Oslo Wood; `tilt` only on products with params.tiltable (Inspector: «Lys»)
  'floor-tripod': F('floor-tripod', buildFloorTripod, { w: 0.6, d: 0.6, h: 1.65 }, { ...look('#232323', 'cotton'), colors: { ...look('#232323', 'cotton').colors, base: '#1f1f1f' } }, { shadeD: 0.4, shadeH: 0.3 }, {
    params: {
      tilt: { type: 'number', min: 0, max: MAX_TILT, step: 1, unit: '°', label: 'Vinkel på skjermen', requires: 'tiltable' },
      ...SHADE_GLOW,
    },
    dimsRange: { w: [0.35, 0.9], d: [0.35, 0.9], h: [1.0, 2.0] },
  }),
  'floor-pole-shade': F('floor-pole-shade', buildFloorPoleShade, { w: 0.4, d: 0.4, h: 1.5 }, look('#ddd2bf', 'linen'), {}, {
    params: {
      shadeShape: { type: 'enum', options: [['drum', 'Sylinder'], ['cylinder', 'Høy sylinder'], ['cone', 'Kjegle'], ['pleated', 'Plissert'], ['woven', 'Flettet'], ['lantern', 'Rispapir (lykt)'], ['rect', 'Rektangulær']], label: 'Skjerm' },
      baseShape: { type: 'enum', options: [['disc', 'Rund plate'], ['cone', 'Kjegle'], ['cylinder', 'Sylinder'], ['bullet', 'Søyle med rund topp'], ['vase', 'Vase'], ['wavy-column', 'Bølget søyle'], ['stacked-pebbles', 'Stablede steiner'], ['rect', 'Rektangulær plate'], ['tripod', 'Trebent stativ']], label: 'Fot', default: 'disc' },
      ...SHADE_GLOW,
    },
    dimsRange: { w: [0.2, 0.8], d: [0.15, 0.8], h: [0.9, 2.0] },
  }),
  'floor-mushroom': F('floor-mushroom', buildFloorMushroom, { w: 0.32, d: 0.32, h: 1.43 }, look('#aaa592', 'painted', '#aaa592', 'painted', '#aaa592', 'painted'), {}, {
    dimsRange: { w: [0.2, 0.7], d: [0.2, 0.7], h: [0.9, 1.9] },
  }),
  'floor-uplight': F('floor-uplight', buildFloorUplight, { w: 0.3, d: 0.3, h: 1.79 }, look('#1e1e1e', 'black-metal', '#1e1e1e', 'black-metal', '#e8e4dc', 'painted'), { shadeD: 0.3 }, {
    params: { readingArm: { type: 'bool', label: 'Leselampe på armen' } },
    dimsRange: { w: [0.25, 0.7], d: [0.2, 0.6], h: [1.4, 2.0] },
  }),
  'floor-globe': F('floor-globe', buildFloorGlobe, { w: 0.35, d: 0.35, h: 1.3 }, look('#f3f1ec', 'glass-opal')),
  'floor-reading': F('floor-reading', buildFloorReading, { w: 0.35, d: 0.45, h: 1.4 }, look('#1e1e1e', 'black-metal', '#1e1e1e', 'black-metal', '#f2efe8', 'painted')),
  'table-mushroom': F('table-mushroom', buildTableMushroom, { w: 0.23, d: 0.23, h: 0.26 }, look('#b9ab98', 'painted', '#c0c0c0', 'chrome', '#f2efe8', 'glass-opal'), {}, {
    dimsRange: { w: [0.12, 0.5], d: [0.12, 0.5], h: [0.15, 0.6] },
  }),
  'table-shade': F('table-shade', buildTableShade, { w: 0.35, d: 0.35, h: 0.6 }, { ...look('#d8cdb9', 'linen'), colors: { ...look('#d8cdb9', 'linen').colors, base: '#cfc6b8' }, materials: { ...look('#d8cdb9', 'linen').materials, base: 'ceramic' } }, {}, {
    params: {
      shadeShape: { type: 'enum', options: [['drum', 'Sylinder'], ['wavy', 'Bølget'], ['cone', 'Kjegle'], ['pleated', 'Plissert'], ['empire', 'Empire'], ['rect', 'Rektangulær'], ['woven', 'Flettet'], ['lantern', 'Rispapir (lykt)'], ['dome', 'Kuppel (metall)']], label: 'Skjerm', default: 'drum' },
      baseShape: { type: 'enum', options: [['vase', 'Vase'], ['cylinder', 'Sylinder'], ['wavy-column', 'Bølget søyle'], ['disc', 'Flat fot'], ['cone', 'Kjegle'], ['bullet', 'Søyle med rund topp'], ['dome', 'Kuppel'], ['stacked-pebbles', 'Stablede steiner'], ['rect', 'Rektangulær'], ['candlestick', 'Dreid lysestake'], ['ball', 'Kule']], label: 'Fot', default: 'vase' },
      ...SHADE_GLOW,
    },
    dimsRange: { w: [0.15, 0.6], d: [0.15, 0.6], h: [0.2, 0.9] },
  }),
  'table-globe': F('table-globe', buildTableGlobe, { w: 0.25, d: 0.25, h: 0.24 }, look('#f3f1ec', 'glass-opal', '#f0f0ee', 'plastic'), {}, {
    params: { shadeShape: { type: 'enum', options: [['globe', 'Kule'], ['fluted-bulb', 'Riflet glass']], label: 'Skjerm' } },
    dimsRange: { w: [0.12, 0.5], d: [0.12, 0.5], h: [0.12, 0.55] },
  }),
  'table-portable': F('table-portable', buildTablePortable, { w: 0.16, d: 0.16, h: 0.3 }, look('#b9ad9c', 'painted', '#b9ad9c', 'painted', '#f2efe8', 'painted'), {}, {
    dimsRange: { w: [0.1, 0.35], d: [0.1, 0.35], h: [0.15, 0.6] },
  }),
  'table-dome': F('table-dome', buildTableDome, { w: 0.2, d: 0.2, h: 0.37 }, look('#1d1d1d', 'black-metal', '#1d1d1d', 'black-metal', '#1d1d1d', 'black-metal'), { tiers: 3 }, {
    params: { tiers: { type: 'number', min: 1, max: 5, step: 1, label: 'Antall lag' } },
  }),
  'wall-sconce': F('wall-sconce', buildWallSconce, { w: 0.25, d: 0.13, h: 0.23 }, look('#d3c9b8', 'linen', '#bfb8ab', 'painted'), {}, {
    params: {
      shadeShape: { type: 'enum', options: [['half-drum', 'Halv sylinder'], ['spot', 'Spot'], ['globe', 'Kule på plate'], ['updown', 'Opp og ned (sylinder)'], ['flush', 'Flat skjerm (alabast/opal)'], ['bar', 'Lyslist'], ['shell', 'Skjell']], label: 'Skjerm', default: 'half-drum' },
      ...SHADE_GLOW,
    },
    dimsRange: { w: [0.06, 0.5], d: [0.04, 0.3], h: [0.06, 0.5] },
  }),
  'wall-arm': F('wall-arm', buildWallArm, { w: 0.18, d: 0.22, h: 0.25 }, look('#f1ece2', 'glass-opal', '#1e1e1e', 'black-metal'), {}, {
    params: {
      shadeShape: { type: 'enum', options: [['glass-mushroom', 'Glass-sopp'], ['cylinder-spot', 'Sylinderspot'], ['drum', 'Tekstilskjerm'], ['cone', 'Kjegleskjerm'], ['globe', 'Glasskule'], ['bell', 'Glassklokke'], ['dome', 'Metallkuppel']], label: 'Skjerm', default: 'glass-mushroom' },
      armShape: { type: 'enum', options: [['straight', 'Rett arm'], ['swing', 'Svingarm med ledd'], ['curved', 'Buet arm'], ['flex', 'Fleksibel leselampe']], label: 'Arm', default: 'straight' },
      plug: { type: 'bool', label: 'Synlig ledning med støpsel' },
    },
    dimsRange: { w: [0.06, 0.4], d: [0.08, 0.8], h: [0.08, 0.6] },
  }),
};

// The «Leselampe på armen» toggle only means something for uplights that have one (Nice): keep catalogue default.
archetypes['floor-uplight'].defaults.params.readingArm = false;

// ---------------------------------------------------------------------------------------------------------------
// Built-in fixtures (shell / kitchen)

/**
 * Model of a built-in light fitting from `layout.builtInLights` (room-spec): the kitchen island pendants
 * (`pendant-cylinder`), the kitchen ring lamps on a cranked arm and the TV-stue triple-ring lamp (`ceiling-ring`).
 * The group's origin is the attachment point (put it at `l.position`, the ceiling); it hangs along −y.
 * `group.userData.model.lights` are local (one per fitting, with `emissiveMeshes`), so the shell can convert them
 * to world space for `builtInLights[].emissiveMeshes` / position / direction. Returns null for other types (strips,
 * spots, tracks).
 * @param {{ type: string, dims?: object, color?: string, accent?: string|null, colorK?: number, lumens?: number,
 *           position?: THREE.Vector3|number[] }} l
 * @param {{ quality?: 'low'|'medium'|'high' }} [o]
 * @returns {THREE.Group|null}
 */
export function buildBuiltInFixture(l, { quality } = {}) {
  if (!l) return null;
  const dims = l.dims || {};
  const y = Array.isArray(l.position) ? l.position[1] : l.position?.y ?? 2.4;
  const black = l.color || '#151515';
  // built-ins are placed by the shell at fixed spots of flat ceilings: no slope following
  const base = { quality, params: { colorK: l.colorK ?? 2700, lumens: l.lumens ?? 800, followCeiling: false } };
  let spec = null, build = null;
  if (l.type === 'pendant-cylinder') {
    const dd = dims.d ?? 0.07, len = dims.l ?? 0.3;
    const drop = Math.max(len + 0.08, y - (dims.bottomY ?? y - 0.7));
    spec = {
      ...base,
      dims: { w: dd, d: dd, h: len },
      params: { ...base.params, drop, canopy: 'track' },
      colors: { shade: black, inner: '#2a2826', base: black, metal: black, cord: black },
      materials: { shade: 'black-metal', inner: 'black-metal', base: 'black-metal', metal: 'black-metal', cord: 'cotton' },
    };
    build = buildPendantCylinder;
  } else if (l.type === 'ceiling-ring') {
    const rings = Array.isArray(dims.rings) && dims.rings.length > 1 ? dims.rings : null;
    const w = dims.w ?? (rings ? 0.85 : 0.4);
    spec = {
      ...base,
      dims: { w, d: dims.d ?? w, h: 0.03 },
      params: { ...base.params, drop: dims.drop ?? 0.15, style: rings ? 'multi' : 'arm', rings: rings || undefined },
      colors: rings
        ? { shade: '#f6f1e8', inner: l.accent || '#c8a46a', base: black, metal: black, cord: black }
        : { shade: black, inner: '#f6f1e8', base: black, metal: black, cord: black },
      materials: rings
        ? { shade: 'glass-opal', inner: 'brass', base: 'black-metal', metal: 'black-metal', cord: 'cotton' }
        : { shade: 'black-metal', inner: 'glass-opal', base: 'black-metal', metal: 'black-metal', cord: 'cotton' },
    };
    build = buildCeilingRing;
  }
  if (!build) return null;
  const g = build({ archetype: l.type, quality: 'medium', ...spec });
  g.userData.archetype = l.type;
  g.userData.builtIn = l.id || true;
  return g;
}

// Shared building blocks for the other lamp files (spots.js, tasklamps.js – MASTER D25: frozen surface, additions only).
export { Lamp, def, look, canopy, ceilingAt, followCeiling, poolTexture, ceilingPool, lightDecalMaterial, discGeo, rod, bar, xf, aim, shell, bezier, EMBED, num, clamp, kelvinRGB, toHex, foot, footDisc, footDome, drumShade, pleatOpts, wovenShade, lanternShade, boxShade, mushroomCap, globeShade, wallDisc, modulate, kScale, cord, SHADE_GLOW };
