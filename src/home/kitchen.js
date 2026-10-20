// The kitchen (owned by SHELL): graphite wood-grain tall cabinets with the integrated fridge, ovens and coffee machine,
// handle-less matt anthracite base cabinets with grip channels, the dark stone-look worktop with soft cloudy marbling
// (waterfall end on the island), the black tambour in the corner unit, the black composite sink and tap, the induction hob with downdraft, the smoked-glass wall
// cabinet with dimly visible glasses and LED underneath, and the built-in kitchen lights: the LED cove in front of the
// tall cabinets, the track with three black cylinder pendants over the island and the two ring lamps
// (registry.buildModel → the LAMPS models).
//
// Positions/dimensions come from layout.kitchen.items (box centres) – front/unit/appliance layouts from their
// `fronts` / `units` fields.
import * as THREE from 'three';
import { mat, emissive } from './materials.js';
import { MeshBatcher, place, prismX } from '../world/buildKit.js';
import { createCanvas, canvasTexture, heightToNormalCanvas } from '../world/proctex.js';
import { tube, lathe } from '../models/kit.js';
import { buildModel } from '../models/registry.js';
import { ledStrip, periodicNoise, gridSample } from './shell.js';

const UP = new THREE.Vector3(0, 1, 0);
const DEG = Math.PI / 180;
const GAP = 0.003; // gap between fronts
const FRONT_T = 0.019;

/** Black ceramic glass of the hob: zone outlines, the downdraft slot area, control dots (canvas). */
function hobTexture(w, d) {
  const px = 640;
  const W = px;
  const H = Math.round((px * d) / w);
  const c = createCanvas(W, H);
  const g = c.getContext('2d');
  g.fillStyle = '#0c0c0e';
  g.fillRect(0, 0, W, H);
  const s = W / w; // px per metre
  g.strokeStyle = 'rgba(120,120,124,0.75)';
  g.lineWidth = Math.max(1, s * 0.0012);
  const zone = (x0, y0, zw, zh) => g.strokeRect(x0 * s, y0 * s, zw * s, zh * s);
  // two flex zones each side of the central vent (Siemens-style squares)
  const m = 0.04;
  const vent = 0.11;
  const zw = (w - 2 * m - vent - 0.04) / 2;
  const zh = (d - 2 * m - 0.02) / 2;
  for (const xs of [m, w - m - zw]) {
    zone(xs, m, zw, zh);
    zone(xs, m + zh + 0.02, zw, zh);
    // centre crosses
    for (const ys of [m + zh / 2, m + zh * 1.5 + 0.02]) {
      g.fillStyle = 'rgba(140,140,144,0.6)';
      g.fillRect((xs + zw / 2) * s - 1, ys * s - 1, 3, 3);
    }
  }
  // control dots along the front edge (y = d side)
  g.fillStyle = 'rgba(150,150,154,0.55)';
  for (let i = 0; i < 9; i++) g.fillRect((w / 2 - 0.16 + i * 0.04) * s, (d - 0.022) * s, 2, 2);
  const tex = canvasTexture(c, { repeat: [1, 1], wrap: false, srgb: true });
  return tex;
}

/** sRGB 0..255 → linear 0..1 */
const lin255 = (x) => {
  x /= 255;
  return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
};

/** Material colour that makes the (sRGB) pixel buffer's mean linear albedo equal `hex` (every `step`-th pixel). */
function meanCorrection(data, hex, step = 7, cap = 1.6) {
  let sr = 0, sg = 0, sb = 0, n = 0;
  for (let i = 0; i < data.length; i += 4 * step) {
    sr += lin255(data[i]);
    sg += lin255(data[i + 1]);
    sb += lin255(data[i + 2]);
    n++;
  }
  const t = new THREE.Color(hex);
  return new THREE.Color(Math.min(cap, t.r / (sr / n || 1)), Math.min(cap, t.g / (sg / n || 1)), Math.min(cap, t.b / (sb / n || 1)));
}

/**
 * Dark stone-look worktop (sintered stone like the real one, 082941 / 082950 / 082937): a warm dark brown-grey with
 * soft, low-contrast lighter «clouds» and layered bands flowing roughly along the length (domain-warped fbm), and only
 * a few short, wispy light veins inside the lighter bands – no crisp straight lines. Per-pixel tileable noise (tiles
 * over 1.6 × 0.8 m, UVs in metres, u along the worktop); mean colour normalised to `base`.
 * @param {string} base  '#hex' (room-spec worktop colour, ≈ #3b3633)
 * @param {string} vein  '#hex' colour of the light wisps
 * @param {number} res   texture resolution factor
 * @returns {{ material: THREE.MeshStandardMaterial, textures: THREE.Texture[] }}
 */
function worktopMaterial(base, vein, res = 1) {
  const tileU = 1.6, tileV = 0.8;
  const ppm = Math.max(240, Math.min(520, Math.round(360 * res))); // ≈ 2.8 mm/px: the marbling is soft anyway
  const W = Math.round((tileU * ppm) / 8) * 8;
  const H = Math.round((tileV * ppm) / 8) * 8;
  const c = createCanvas(W, H);
  const g = c.getContext('2d', { willReadFrequently: true });
  const img = g.createImageData(W, H);
  const px = img.data;
  const N = periodicNoise(9173), N2 = periodicNoise(311), N3 = periodicNoise(77), N4 = periodicNoise(1301);
  // tones (sRGB 0..1): dark warm base, lighter grey-brown clouds, the pale wisps (the room-spec vein colour)
  const dark = [0.2, 0.178, 0.163];
  const light = [0.43, 0.405, 0.38];
  const v = new THREE.Color(vein).convertLinearToSRGB();
  const wisp = [v.r, v.g, v.b];
  const sm = (a, b, x) => {
    const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };
  // quarter resolution: domain warp (the layers meander, mostly across the length), big soft clouds, wisp mask
  const QW = W >> 2, QH = H >> 2;
  const warpU = new Float32Array(QW * QH), warpV = new Float32Array(QW * QH), cloud = new Float32Array(QW * QH), mask = new Float32Array(QW * QH);
  for (let y = 0; y < QH; y++) {
    for (let x = 0; x < QW; x++) {
      const u = x / QW, w = y / QH, i = y * QW + x;
      warpV[i] = 0.05 * (N(u * 2, w * 2, 2, 2) + 0.4 * N(u * 5, w * 4, 5, 4));
      warpU[i] = 0.025 * N2(u * 2, w * 2, 2, 2);
      cloud[i] = (N2(u * 2 + 0.37, w * 2, 2, 2) + 0.5 * N2(u * 4, w * 4 + 0.21, 4, 4) + 0.25 * N(u * 8, w * 8, 8, 8)) / 1.15;
      mask[i] = N3(u * 3, w * 3, 3, 3) + 0.4 * N3(u * 7, w * 6, 7, 6);
    }
  }
  // half resolution: the flow bands (long along u, short across) and the ridge field of the wisps (both warped), the
  // coarse octave of the fibres and the break-up of the wisps
  const HW = W >> 1, HH = H >> 1;
  const flowA = new Float32Array(HW * HH), ridgeA = new Float32Array(HW * HH), fibA = new Float32Array(HW * HH), brkA = new Float32Array(HW * HH);
  for (let y = 0; y < HH; y++) {
    const gy = (y / HH) * QH;
    for (let x = 0; x < HW; x++) {
      const gx = (x / HW) * QW;
      const u = x / HW + gridSample(warpU, QW, QH, gx, gy);
      const w = y / HH + gridSample(warpV, QW, QH, gx, gy);
      const i = y * HW + x;
      const flow = (N(u * 2, w * 8, 2, 8) + 0.5 * N2(u * 4, w * 16, 4, 16) + 0.25 * N(u * 8, w * 32, 8, 32)) / 1.15;
      flowA[i] = flow;
      ridgeA[i] = N3(u * 5, w * 24, 5, 24) + 0.45 * N2(u * 11, w * 50, 11, 50);
      const u4 = x / HW, w4 = y / HH + flow * 0.004;
      fibA[i] = N4(u4 * 20, w4 * 80, 20, 80) * 0.7;
      brkA[i] = N4(u4 * 9 + 0.3, (y / HH) * 20 + 0.7, 9, 20);
    }
  }
  let seed = 4242;
  for (let y = 0; y < H; y++) {
    const qy = (y / H) * QH, hy = (y / H) * HH;
    for (let x = 0; x < W; x++) {
      const qx = (x / W) * QW, hx = (x / W) * HW;
      const flow = gridSample(flowA, HW, HH, hx, hy);
      const cl = gridSample(cloud, QW, QH, qx, qy);
      // soft, wide lighter bands where flow and clouds agree
      const band = sm(0.2, 1.4, flow * 0.75 + cl * 0.45);
      // fibrous detail along the flow (≈ 8 × 1 cm, fine octave at full resolution): breaks the bands into cloudy
      // streaks instead of smooth silk
      const fib = gridSample(fibA, HW, HH, hx, hy) + N4((x / W) * 48 + 0.5, (y / H + flow * 0.004) * 160, 48, 160) * 0.3;
      let t = 0.29 + 0.07 * cl + 0.06 * flow + 0.28 * band * (0.6 + 0.4 * fib) + 0.035 * fib;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      // a few short, broken, thin light wisps – only inside the lighter bands and where the mask allows
      const r = gridSample(ridgeA, HW, HH, hx, hy);
      const ridge = Math.max(0, 1 - Math.abs(r) * 1.45);
      const m = sm(-1.0, 0.6, gridSample(mask, QW, QH, qx, qy)) * band * sm(-0.5, 0.7, gridSample(brkA, HW, HH, hx, hy));
      const r2 = ridge * ridge;
      const wv = r2 * r2 * r2 * m * 0.8;
      seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
      const grain = (seed / 4294967296 - 0.5) * 0.03;
      const o = (y * W + x) * 4;
      for (let k = 0; k < 3; k++) {
        let s = dark[k] + (light[k] - dark[k]) * t;
        s += (wisp[k] - s) * wv;
        px[o + k] = (s + grain) * 255;
      }
      px[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const map = canvasTexture(c, { repeat: [1 / tileU, 1 / tileV], srgb: true, anisotropy: 16 });
  const m = new THREE.MeshStandardMaterial({
    map,
    color: meanCorrection(px, base, 9),
    roughness: 0.38,
    metalness: 0,
    envMapIntensity: 0.8,
  });
  m.name = 'worktop-stone';
  return { material: m, textures: [map] };
}

/**
 * Graphite-stained oak for the tall cabinets (082937): a dark graphite grey with a fine, low-contrast straight oak
 * grain running vertically (v; box UVs put v up on the fronts) and a faint matching relief – not the brushed-metal
 * look of the generic oak. Tiles over 0.6 × 2.4 m. The mean albedo becomes `hex` pulled slightly toward a warm grey of
 * the same lightness (the oak showing through the grey stain).
 * @returns {{ material: THREE.MeshStandardMaterial, textures: THREE.Texture[] }}
 */
function graphiteOakMaterial(hex, res = 1) {
  const tileU = 0.6, tileV = 2.4;
  const ppmU = Math.max(200, Math.min(600, Math.round(420 * res)));
  const W = Math.round((tileU * ppmU) / 8) * 8;
  const H = Math.max(256, Math.round((tileV * ppmU * 0.4) / 8) * 8); // grain is long: fewer rows are enough
  const c = createCanvas(W, H);
  const g = c.getContext('2d', { willReadFrequently: true });
  const img = g.createImageData(W, H);
  const px = img.data;
  const heights = new Float32Array(W * H);
  const N = periodicNoise(5521);
  // per-column grain profile (several scales of fine lines) + a slow lateral meander per row band
  const prof = new Float32Array(W * 4);
  for (let x = 0; x < W * 4; x++) {
    const u = x / (W * 4);
    prof[x] = 0.5 * N(u * 48, 0.5, 48, 4) + 0.3 * N(u * 140, 1.5, 140, 4) + 0.2 * N(u * 32 * 7, 2.5, 224, 4);
  }
  for (let y = 0; y < H; y++) {
    const w = y / H;
    for (let x = 0; x < W; x++) {
      const u = x / W;
      const meander = 0.004 * N(u * 3, w * 6, 3, 6) + 0.0013 * N(u * 8, w * 20, 8, 20);
      let pu = (u + meander) * W * 4;
      pu = ((pu % (W * 4)) + W * 4) % (W * 4);
      const i0 = Math.floor(pu), f = pu - i0;
      const gr = prof[i0] + (prof[(i0 + 1) % (W * 4)] - prof[i0]) * f;
      const mott = 0.5 * N(u * 2, w * 4, 2, 4) + 0.5 * N(u * 24, w * 60, 24, 60);
      const t = 1 + 0.014 * gr + 0.014 * mott; // ≈ ±1.5 % fine grain (std), ±1.5 % fine mottling
      const o = (y * W + x) * 4;
      // grey base with the darker grain lines a touch warmer
      const warm = gr < 0 ? Math.min(0.02, -gr * 0.008) : 0;
      px[o] = Math.min(255, 128 * t * (1 + warm));
      px[o + 1] = Math.min(255, 126 * t);
      px[o + 2] = Math.min(255, 124 * t * (1 - warm));
      px[o + 3] = 255;
      heights[y * W + x] = 0.5 + 0.12 * gr;
    }
  }
  g.putImageData(img, 0, 0);
  // target: the spec colour pulled a little toward a warm grey of the same luminance – the full 082937 photo shows the
  // fronts as a neutral grey next to the wall (#716e6f vs #b4bab1), only the warm room light makes them look warm
  const spec = new THREE.Color(hex);
  const L = 0.2126 * spec.r + 0.7152 * spec.g + 0.0722 * spec.b;
  const warmGrey = new THREE.Color(1.08, 0.985, 0.93); // linear, luminance ≈ 1
  const lw = 0.2126 * warmGrey.r + 0.7152 * warmGrey.g + 0.0722 * warmGrey.b;
  warmGrey.multiplyScalar(L / lw);
  const target = spec.clone().lerp(warmGrey, 0.12);
  const repeat = [1 / tileU, 1 / tileV];
  const map = canvasTexture(c, { repeat, srgb: true, anisotropy: 8 });
  const normalMap = canvasTexture(heightToNormalCanvas(heights, W, H, 0.6), { repeat, srgb: false, anisotropy: 8 });
  const m = new THREE.MeshStandardMaterial({
    map,
    normalMap,
    normalScale: new THREE.Vector2(0.12, 0.12),
    color: meanCorrection(px, target, 5),
    roughness: 0.72,
    metalness: 0,
    envMapIntensity: 0.45,
  });
  m.name = 'graphite-oak';
  return { material: m, textures: [map, normalMap] };
}

/**
 * Black tambour (roller shutter) of the corner unit: a tiny canvas with one slat (dark joint, light upper edge, body
 * shading toward the lower facet), repeated every `pitch` metres up from `y0` (box UVs: v = world y).
 */
function tambourMaterial(pitch, y0) {
  const c = createCanvas(4, 32);
  const g = c.getContext('2d');
  const rows = [
    [0, 3, '#040405'], // joint (top of the slat = canvas top, flipY)
    [3, 6, '#5c5c61'], // highlight on the rounded upper edge
    [6, 10, '#3b3b3f'],
    [10, 22, '#2a2a2d'],
    [22, 28, '#1d1d20'],
    [28, 32, '#0e0e10'], // lower facet into the next joint
  ];
  for (const [a, b, col] of rows) {
    g.fillStyle = col;
    g.fillRect(0, a, 4, b - a);
  }
  const map = canvasTexture(c, { repeat: [1, 1 / pitch], srgb: true, anisotropy: 8 });
  map.offset.set(0, -y0 / pitch);
  map.magFilter = THREE.LinearFilter;
  const m = new THREE.MeshStandardMaterial({ map, roughness: 0.45, metalness: 0, envMapIntensity: 0.5 });
  m.name = 'tambour';
  m.userData.textures = [map];
  return m;
}

/**
 * Builds the kitchen.
 * @param {object} ctx
 * @param {object} layout home/layout.js
 * @returns {{ group: THREE.Group, builtInLights: object[], surfaces: object[], dispose: () => void }}
 */
export function buildKitchen(ctx, layout) {
  const quality = ctx.quality || {};
  const low = quality.level === 'low';
  const group = new THREE.Group();
  group.name = 'kitchen';
  group.userData.noCollide = true; // collision uses boxes (below)
  const owned = [];
  const keep = (x) => (owned.push(x), x);
  const items = Object.fromEntries(layout.kitchen.items.map((k) => [k.id, k]));
  const kb = new MeshBatcher('kitchen');
  const lampObjects = [];

  const graphiteOak = graphiteOakMaterial(items['k-hoyskap-kjol']?.color || '#55575a', Math.min(1, quality.textureRes ?? 1));
  owned.push(graphiteOak.material, ...graphiteOak.textures);
  const M = {
    graphite: graphiteOak.material,
    front: mat('painted', items['k-benk']?.color || '#2a2b2d', { roughness: 0.72 }),
    plinth: mat('painted', '#121212', { roughness: 0.8 }),
    channel: mat('painted', '#0d0d0e', { roughness: 0.9, flat: true }),
    carcass: mat('painted', '#1b1b1c', { roughness: 0.8, flat: true }),
    handle: mat('black-metal', '#141414', { roughness: 0.35 }),
    steel: mat('steel', '#a3a6aa'),
    tap: mat('black-metal', items['k-vask']?.tap?.color || '#151515', { roughness: 0.32 }),
    vent: mat('plastic', '#060606', { roughness: 0.9, flat: true }),
    alu: mat('painted', '#cfcfcc', { roughness: 0.32, metalness: 0.45 }),
    frameBlack: mat('black-metal', items['k-overskap']?.color || '#1c1c1c', { roughness: 0.4 }),
    smoked: mat('glass-smoked', items['k-overskap']?.glass || '#3a3632', { opacity: 0.62 }),
    shelfGlass: mat('glass-clear', '#e8efec', { opacity: 0.25 }),
    wineGlass: mat('glass-clear', '#ffffff', { opacity: 0.22 }),
    bowl: mat('ceramic', '#e9e5dc'),
    shutterGap: mat('plastic', '#050505', { roughness: 0.9, flat: true }),
  };
  // black glass of the appliances and the hob (reflective, not transparent)
  const blackGlass = keep(new THREE.MeshStandardMaterial({ color: '#0b0b0d', roughness: 0.07, metalness: 0, envMapIntensity: 1.2 }));
  blackGlass.name = 'appliance-glass';
  const display = keep(emissive('#7fd0ff', 0.25, { color: '#0b0b0d' }));
  M.blackGlass = blackGlass;
  const wtSpec = items['k-benkeplate'];
  const stone = worktopMaterial(wtSpec?.color || '#3b3633', wtSpec?.veins || '#b5b0aa', Math.min(1, quality.textureRes ?? 1));
  owned.push(stone.material, ...stone.textures);
  M.top = stone.material;
  // basin: an open box seen from inside (back faces)
  M.sink = keep(new THREE.MeshStandardMaterial({ color: items['k-vask']?.color || '#1c1c1c', roughness: 0.62, side: THREE.BackSide }));

  // ---------------------------------------------------------------------------------------------------------------
  // Tall cabinets (in the niche, fronts toward the room): build each in its own frame (origin bottom centre, front +z)
  const ceilY = (x, z) => layout.ceilingHeightAt(x, z);
  for (const k of layout.kitchen.items) {
    if (k.type !== 'tall-cabinet') continue;
    const { w, d, h } = k.dims;
    const yaw = (k.rotationDeg || 0) * DEG;
    const base = new THREE.Vector3(k.position.x, 0, k.position.z);
    const F = kb.frame(new THREE.Matrix4().compose(base, new THREE.Quaternion().setFromAxisAngle(UP, yaw), new THREE.Vector3(1, 1, 1)));
    const zf = d / 2 - FRONT_T; // carcass front plane
    const top = Math.min(ceilY(k.position.x, k.position.z), h + 0.03);
    if (k.id === 'k-endepanel') {
      F.box(w, top, d, 0, top / 2, 0, M.graphite);
      continue;
    }
    // carcass (dark), plinth recessed 5 cm (counter-height base front: the bench's 13 cm plinth), graphite top filler
    const ph = (k.fronts || []).some((f) => /underskap/.test(String(f[2] || ''))) ? 0.13 : 0.07;
    F.box(w - 0.002, top - ph, d - FRONT_T, 0, ph + (top - ph) / 2, -FRONT_T / 2, M.carcass);
    F.box(w - 0.004, ph, d - 0.07, 0, ph / 2, -0.035, M.plinth);
    if (top > h + 0.002) F.box(w - 0.002, top - h, FRONT_T, 0, h + (top - h) / 2, zf + FRONT_T / 2 - 0.004, M.graphite, { collide: false });
    const fronts = k.fronts || [[0.07, h]];
    const fw = w - 2 * GAP;
    const zc = zf + FRONT_T / 2;
    const handle = (y, x = 0) => {
      // slim black bar handle (0.25 m) on two short legs
      F.box(0.25, 0.012, 0.012, x, y, d / 2 + 0.024, M.handle, { collide: false });
      for (const s of [-1, 1]) F.box(0.01, 0.01, 0.024, x + s * 0.11, y, d / 2 + 0.012, M.handle, { collide: false });
    };
    for (let i = 0; i < fronts.length; i++) {
      const [y0, y1, label = ''] = fronts[i];
      const fy0 = y0 + GAP / 2;
      const fy1 = y1 - GAP / 2;
      const fh = fy1 - fy0;
      const yc = (fy0 + fy1) / 2;
      const lab = String(label);
      if (k.id === 'k-hoyskap-ovn' && /ovn|kaffe|mikro/.test(lab)) {
        appliance(F, lab, fw, fy0, fy1, zf, d);
        continue;
      }
      if (/jalusi/.test(lab)) {
        // open «garage» with a black roller shutter, set back ≈ 1.5 cm behind the fronts; the worktop runs into it. (It used
        // to sit 2 cm behind the carcass face – i.e. inside the carcass box, so only its plain dark front showed.)
        // tambour slats: each a rounded face (lower facet tilted down, upper facet up, so the ceiling light picks out a
        // thin highlight per slat) with a dark V-groove between them – reads as horizontal slats like in 082937
        const sh = fy1 - fy0;
        const ribs = Math.round(sh / 0.021);
        const p = sh / ribs;
        const pts = [[0, 0]];
        for (let r = 0; r < ribs; r++) {
          const y = r * p;
          pts.push([0.0022, y + p * 0.08], [0.0056, y + p * 0.3], [0.0064, y + p * 0.52], [0.0057, y + p * 0.74], [0.0024, y + p * 0.93], [0, y + p]);
        }
        pts.push([-0.006, sh], [-0.006, 0]);
        const g = prismX(pts, -fw / 2, fw / 2);
        // the slats are also painted into the map (light upper edge, dark joint): the garage is in the shade of the
        // cabinet above, where the facets alone hardly catch any light
        const tm = keep(tambourMaterial(p, fy0));
        owned.push(...tm.userData.textures);
        F.add(g, tm, { matrix: place(0, fy0, zf + 0.0005), collide: false, boxUV: true });
        g.dispose();
        // the dark gaps at the sides of the tambour (guide channels)
        for (const s of [-1, 1]) F.box(0.008, sh, 0.008, s * (fw / 2 - 0.004), yc, zf + 0.004, M.shutterGap, { collide: false, castShadow: false });
        // inner side walls of the garage in graphite
        for (const s of [-1, 1]) F.box(0.018, sh, 0.02, s * (w / 2 - 0.009), yc, zf - 0.01 + FRONT_T / 2, M.graphite, { collide: false });
        continue;
      }
      const isBase = /underskap/.test(lab);
      F.box(fw, fh, FRONT_T, 0, yc, zc, isBase ? M.front : M.graphite);
      if (k.id === 'k-hoyskap-ovn' && /skuff/.test(lab)) handle(fy1 - 0.05);
      if ((k.id === 'k-hoyskap-kjol' || k.id === 'k-hoyskap-smalt') && fronts.length === 2) {
        if (i === 0) handle(fy1 - 0.045);
        else handle(fy0 + 0.045);
      }
    }
    if (k.id === 'k-hoyskap-kjol') {
      // ventilation grilles: top of the column and in the plinth
      for (let i = 0; i < 26; i++) F.box(0.003, 0.03, 0.003, -fw / 2 + 0.05 + (i * (fw - 0.1)) / 25, h - 0.025, d / 2 + 0.0015, M.vent, { collide: false, castShadow: false });
      F.box(fw - 0.06, 0.04, 0.004, 0, 0.035, d / 2 - 0.05, M.vent, { collide: false, castShadow: false });
    }
    if (k.id === 'k-hjorneskap') {
      // the corner unit's base part is counter height: its front face is part of the bench row (see k-benk)
    }
  }

  /** Built-in appliance front in the oven column (black glass with control strip / niche). */
  function appliance(F, label, fw, y0, y1, zf, d) {
    const h = y1 - y0;
    const zc = zf + FRONT_T / 2;
    const iw = fw - 0.03; // graphite cabinet sides frame the appliance
    F.box(fw, h, 0.004, 0, (y0 + y1) / 2, zf - 0.002, M.carcass, { collide: false });
    if (/stekeovn/.test(label)) {
      const strip = 0.075;
      F.box(iw, strip, FRONT_T, 0, y1 - strip / 2, zc, M.blackGlass);
      F.box(0.07, 0.022, 0.002, 0, y1 - strip / 2, zc + FRONT_T / 2 + 0.001, display, { collide: false, castShadow: false });
      F.box(iw, h - strip - 0.004, FRONT_T + 0.004, 0, y0 + (h - strip - 0.004) / 2, zc + 0.002, M.blackGlass);
      F.box(iw - 0.08, 0.016, 0.016, 0, y1 - strip - 0.05, d / 2 + 0.03, M.steel, { collide: false });
      for (const s of [-1, 1]) F.box(0.012, 0.012, 0.03, s * (iw / 2 - 0.06), y1 - strip - 0.05, d / 2 + 0.012, M.steel, { collide: false });
    } else if (/kaffe/.test(label)) {
      F.box(iw, h, FRONT_T, 0, (y0 + y1) / 2, zc, M.blackGlass);
      F.box(0.11, 0.025, 0.002, 0, y1 - 0.05, zc + FRONT_T / 2 + 0.001, display, { collide: false, castShadow: false });
      // cup niche with the spout
      const nw = 0.2, nh = 0.2, ny = y0 + 0.03 + nh / 2;
      F.box(nw, nh, 0.002, 0, ny, zc + FRONT_T / 2 + 0.0005, M.vent, { collide: false, castShadow: false });
      F.box(nw - 0.02, 0.012, 0.06, 0, y0 + 0.036, zc + 0.02, M.steel, { collide: false });
      F.box(0.05, 0.03, 0.04, 0, ny + nh / 2 - 0.03, zc + 0.02, M.steel, { collide: false });
    } else {
      // compact oven / microwave: glass door with a control strip at the bottom
      const strip = 0.06;
      F.box(iw, strip, FRONT_T, 0, y0 + strip / 2, zc, M.blackGlass);
      F.box(0.06, 0.018, 0.002, 0, y0 + strip / 2, zc + FRONT_T / 2 + 0.001, display, { collide: false, castShadow: false });
      F.box(iw, h - strip - 0.004, FRONT_T + 0.004, 0, y0 + strip + 0.004 + (h - strip - 0.004) / 2, zc + 0.002, M.blackGlass);
    }
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Handle-less base cabinets: plinth, fronts with an L-channel under the worktop and a C-channel at `channelY`
  const CH = { top: [0.85, 0.89], mid: [0.49, 0.53], plinth: 0.13 };
  /**
   * One run of base fronts along +x in a frame whose +z is the front, x from x0 to x1, front plane at z = zf.
   * units: [[x0, x1, kind]] (kind 'dører' → one door, 'oppvaskmaskin' → one integrated front, others → two rows).
   */
  function baseRun(F, units, zf, depth, { endPanels = [] } = {}) {
    const xa = Math.min(...units.map((u) => u[0]));
    const xb = Math.max(...units.map((u) => u[1]));
    const L = xb - xa;
    const xm = (xa + xb) / 2;
    // dark carcass set 3 cm behind the fronts (the grip channels and gaps read as deep dark lines), plinth recessed 8 cm
    const cd = depth - FRONT_T - 0.03;
    F.box(L, CH.top[1] - CH.plinth, cd, xm, CH.plinth + (CH.top[1] - CH.plinth) / 2, zf - 0.03 - cd / 2, M.channel);
    F.box(L, CH.plinth, depth - 0.08, xm, CH.plinth / 2, zf + FRONT_T - 0.08 - (depth - 0.08) / 2, M.plinth);
    for (const [a, b, kind] of units) {
      const two = !/dør|oppvask/.test(kind);
      const fx0 = a + GAP / 2, fx1 = b - GAP / 2;
      const fw = fx1 - fx0, cx = (fx0 + fx1) / 2;
      const zc = zf + FRONT_T / 2;
      if (two) {
        F.box(fw, CH.top[0] - CH.mid[1] - GAP, FRONT_T, cx, (CH.top[0] + CH.mid[1]) / 2, zc, M.front);
        F.box(fw, CH.mid[0] - CH.plinth - GAP, FRONT_T, cx, (CH.mid[0] + CH.plinth) / 2, zc, M.front);
      } else {
        F.box(fw, CH.top[0] - CH.plinth - GAP, FRONT_T, cx, (CH.top[0] + CH.plinth) / 2, zc, M.front);
      }
    }
    for (const [a, b] of endPanels) F.box(b - a, CH.top[1], depth, (a + b) / 2, CH.top[1] / 2, zf + FRONT_T - depth / 2, M.front);
  }

  // bench row along the east wall (front toward +z)
  const benk = items['k-benk'];
  if (benk) {
    const d = benk.dims.d;
    const units = (benk.units || []).map((u) => [...u]);
    const F = kb.frame(new THREE.Matrix4());
    const zf = benk.box.max.z - FRONT_T;
    const lastX = Math.max(...units.map((u) => u[1]));
    baseRun(F, units, zf, d, { endPanels: lastX < benk.box.max.x - 1e-3 ? [[lastX, benk.box.max.x]] : [] });
  }

  // worktop along the east wall with the sink cut-out (stone, 2 cm)
  const wt = items['k-benkeplate'];
  const sink = items['k-vask'];
  if (wt) {
    const b = wt.box;
    const y0 = b.min.y;
    const t = b.max.y - b.min.y;
    const shape = new THREE.Shape([new THREE.Vector2(b.min.x, -b.min.z), new THREE.Vector2(b.max.x, -b.min.z), new THREE.Vector2(b.max.x, -b.max.z), new THREE.Vector2(b.min.x, -b.max.z)]);
    if (sink) {
      const sw = sink.dims.w, sd = sink.dims.d, r = 0.03;
      const sx = sink.position.x, sz = sink.position.z;
      const hole = new THREE.Path();
      roundRect(hole, sx - sw / 2, -(sz + sd / 2), sw, sd, r);
      shape.holes.push(hole);
    }
    const g = new THREE.ExtrudeGeometry(shape, { depth: t, bevelEnabled: false, curveSegments: 6 });
    g.rotateX(-Math.PI / 2);
    g.translate(0, y0, 0);
    worktopUV(g);
    kb.add(g, M.top, { collide: false });
    g.dispose();
    if (sink) {
      // black composite basin (open box seen from inside) with a steel drain
      const sw = sink.dims.w - 0.004, sd = sink.dims.d - 0.004, sh = sink.dims.h;
      const bg = new THREE.BoxGeometry(sw, sh, sd);
      kb.add(bg, M.sink, { matrix: place(sink.position.x, b.max.y - sh / 2 - 0.0005, sink.position.z), collide: false, boxUV: true });
      bg.dispose();
      kb.cylinder(0.04, 0.04, 0.003, sink.position.x + sw / 4, b.max.y - sh + 0.002, sink.position.z, M.steel, { segments: 20, collide: false, castShadow: false });
      kb.cylinder(0.02, 0.02, 0.004, sink.position.x + sw / 4, b.max.y - sh + 0.003, sink.position.z, M.vent, { segments: 16, collide: false, castShadow: false });
      // tap: base, high J-spout, lever
      const tp = sink.tap?.position ? new THREE.Vector3(...sink.tap.position) : new THREE.Vector3(sink.position.x, b.max.y, b.min.z + 0.08);
      const th = sink.tap?.h ?? 0.35;
      const ty = b.max.y;
      kb.cylinder(0.024, 0.026, 0.035, tp.x, ty + 0.0175, tp.z, M.tap, { segments: 20, collide: false });
      const spout = tube([
        [tp.x, ty + 0.03, tp.z],
        [tp.x, ty + th - 0.06, tp.z],
        [tp.x, ty + th - 0.005, tp.z + 0.03],
        [tp.x, ty + th - 0.02, tp.z + 0.13],
        [tp.x, ty + th - 0.09, tp.z + 0.2],
        [tp.x, ty + th - 0.13, tp.z + 0.205],
      ], 0.012, { radial: low ? 8 : 14, seg: low ? 24 : 48 });
      kb.add(spout, M.tap, { collide: false });
      spout.dispose();
      kb.box(0.012, 0.012, 0.075, tp.x + 0.03, ty + 0.11, tp.z + 0.012, M.tap, { rot: [-0.35, 0, 0], collide: false });
      kb.cylinder(0.014, 0.014, 0.03, tp.x + 0.03, ty + 0.1, tp.z, M.tap, { rot: [0, 0, Math.PI / 2], segments: 14, collide: false });
    }
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Island: body with drawers toward −z (cooking side), flat back toward the bar stools, worktop with a 0.30 m
  // overhang on +z and a waterfall end at x-min down to the floor, induction hob with downdraft
  const oy = items['k-oy'];
  if (oy) {
    const ext = oy.extent || { x: [oy.box.min.x, oy.box.max.x], z: [oy.box.min.z, oy.box.max.z] };
    const [x0, x1] = ext.x;
    const [z0, z1] = ext.z;
    const tt = oy.top?.thickness ?? 0.02;
    const topY = oy.box.max.y;
    const over = oy.overhang?.depth ?? 0.3;
    const zBack = z1 - over; // back panel plane
    const xw = x0 + tt; // body starts after the waterfall slab
    // fronts: three columns (the middle one under the hob), frame with front plane at z0 (+FRONT_T), facing −z
    const hob = items['k-platetopp'];
    const hx0 = hob ? hob.position.x - hob.dims.w / 2 - 0.04 : (xw + x1) / 2 - 0.45;
    const hx1 = hob ? hob.position.x + hob.dims.w / 2 + 0.04 : (xw + x1) / 2 + 0.45;
    // in a frame facing −z, local x runs toward −x world: map world x → local x = −(x − 0)
    const F = kb.frame(new THREE.Matrix4().makeRotationY(Math.PI));
    const L = (wx) => -wx;
    const units = [[L(x1), L(hx1), 'skuffer'], [L(hx1), L(hx0), 'skuffer'], [L(hx0), L(xw), 'skuffer']];
    baseRun(F, units, -z0 - FRONT_T, zBack - z0 - 0.019);
    // back panel under the overhang (bar side) and the end at the window wall
    kb.box(x1 - xw, topY - tt, 0.019, (xw + x1) / 2, (topY - tt) / 2, zBack - 0.0095, M.front);
    // worktop + waterfall
    const top = new THREE.BoxGeometry(x1 - x0, tt, z1 - z0);
    kb.add(worldBoxUV(top, (x0 + x1) / 2, topY - tt / 2, (z0 + z1) / 2), M.top, { matrix: place((x0 + x1) / 2, topY - tt / 2, (z0 + z1) / 2), collide: false });
    top.dispose();
    const wf = new THREE.BoxGeometry(tt, topY - tt, z1 - z0);
    kb.add(worldBoxUV(wf, x0 + tt / 2, (topY - tt) / 2, (z0 + z1) / 2, true), M.top, { matrix: place(x0 + tt / 2, (topY - tt) / 2, (z0 + z1) / 2), collide: false });
    wf.dispose();
    if (hob) {
      const hw = hob.dims.w, hd = hob.dims.d;
      const tex = keep(hobTexture(hw, hd));
      const hm = keep(new THREE.MeshStandardMaterial({ map: tex, roughness: 0.06, metalness: 0, envMapIntensity: 1.25 }));
      hm.name = 'hob-glass';
      const hg = new THREE.BoxGeometry(hw, 0.005, hd);
      // top face uv: canvas x = hob width, canvas y = depth (front edge at the cook side, −z)
      const uv = hg.attributes.uv;
      const pos = hg.attributes.position;
      for (let i = 0; i < pos.count; i++) uv.setXY(i, 0.5 - pos.getX(i) / hw, 0.5 + pos.getZ(i) / hd);
      const hobMesh = new THREE.Mesh(keep(hg), hm);
      hobMesh.position.set(hob.position.x, topY + 0.0025, hob.position.z);
      hobMesh.castShadow = false;
      hobMesh.receiveShadow = true;
      hobMesh.name = 'hob';
      group.add(hobMesh);
      // downdraft: steel-framed slot across the middle with a dark grille
      const vw = 0.09, vd = hd - 0.06;
      kb.box(vw, 0.004, vd, hob.position.x, topY + 0.006, hob.position.z, M.steel, { collide: false, castShadow: false });
      kb.box(vw - 0.012, 0.0045, vd - 0.012, hob.position.x, topY + 0.0062, hob.position.z, M.vent, { collide: false, castShadow: false });
      for (let i = 0; i < 9; i++) kb.box(0.003, 0.0048, vd - 0.016, hob.position.x - vw / 2 + 0.012 + i * ((vw - 0.024) / 8), topY + 0.0064, hob.position.z, M.steel, { collide: false, castShadow: false });
    }
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Glass wall cabinet: black aluminium carcass, three smoked-glass doors, a glass shelf, glasses + bowls, warm
  // light inside (an emissive back panel that dims with the «overskap» group) and the LED strip underneath
  const ov = items['k-overskap'];
  const overskapEmissive = [];
  if (ov) {
    const b = ov.box;
    const w = b.max.x - b.min.x, h = b.max.y - b.min.y, d = b.max.z - b.min.z;
    const cx = (b.min.x + b.max.x) / 2, cy = (b.min.y + b.max.y) / 2;
    const T = 0.018;
    kb.box(w, T, d, cx, b.max.y - T / 2, b.min.z + d / 2, M.frameBlack, { collide: false });
    kb.box(w, T, d, cx, b.min.y + T / 2, b.min.z + d / 2, M.frameBlack, { collide: false });
    for (const s of [-1, 1]) kb.box(T, h - 2 * T, d, cx + s * (w / 2 - T / 2), cy, b.min.z + d / 2, M.frameBlack, { collide: false });
    const doorsN = ov.doors || 3;
    for (let i = 1; i < doorsN; i++) kb.box(0.012, h - 2 * T, d - 0.02, b.min.x + (i * w) / doorsN, cy, b.min.z + d / 2 - 0.01, M.frameBlack, { collide: false });
    // shelf + contents
    const shelfY = cy;
    const shelf = new THREE.BoxGeometry(w - 2 * T, 0.008, d - 0.05);
    kb.add(shelf, M.shelfGlass, { matrix: place(cx, shelfY, b.min.z + (d - 0.05) / 2 + 0.01), collide: false, castShadow: false });
    shelf.dispose();
    const glassProfile = [[0.001, 0], [0.03, 0], [0.031, 0.003], [0.004, 0.006], [0.0035, 0.06], [0.011, 0.074], [0.035, 0.105], [0.038, 0.15], [0.036, 0.168], [0.034, 0.168], [0.035, 0.15], [0.032, 0.107], [0.001, 0.083]];
    const wineGeo = lathe(glassProfile, { seg: low ? 10 : 16 });
    const bowlGeo = lathe([[0.001, 0], [0.05, 0], [0.085, 0.03], [0.1, 0.07], [0.095, 0.07], [0.08, 0.034], [0.045, 0.006], [0.001, 0.006]], { seg: low ? 14 : 24 });
    const nG = Math.floor((w - 0.1) / 0.11);
    for (let i = 0; i < nG; i++) {
      const gx = b.min.x + 0.07 + i * 0.11 + (i % 2) * 0.01;
      const gz = b.min.z + 0.12 + (i % 3) * 0.06;
      kb.add(wineGeo, M.wineGlass, { matrix: place(gx, b.min.y + T, gz), collide: false, castShadow: false });
    }
    for (let i = 0; i < 4; i++) kb.add(bowlGeo, M.bowl, { matrix: place(b.min.x + 0.25 + i * 0.12 + (i > 1 ? 0.7 : 0), shelfY + 0.004 + i * 0.006 * 0, b.min.z + 0.17), collide: false });
    wineGeo.dispose();
    bowlGeo.dispose();
    // lit back panel
    const backMat = keep(emissive('#ffcf9a', 0.22, { color: '#2a2622' }));
    const back = new THREE.Mesh(keep(new THREE.PlaneGeometry(w - 2 * T, h - 2 * T)), backMat);
    back.position.set(cx, cy, b.min.z + 0.004);
    back.name = 'overskap-back';
    back.castShadow = false;
    group.add(back);
    overskapEmissive.push(back);
    // doors: thin black frames + smoked glass
    for (let i = 0; i < doorsN; i++) {
      const dw = w / doorsN - 0.004;
      const dx = b.min.x + (i + 0.5) * (w / doorsN);
      const dz = b.max.z + 0.01;
      const fr = 0.02;
      kb.box(dw, fr, 0.02, dx, b.max.y - fr / 2, dz, M.frameBlack, { collide: false });
      kb.box(dw, fr, 0.02, dx, b.min.y + fr / 2, dz, M.frameBlack, { collide: false });
      for (const s of [-1, 1]) kb.box(fr, h - 2 * fr, 0.02, dx + s * (dw / 2 - fr / 2), cy, dz, M.frameBlack, { collide: false });
      const pane = new THREE.PlaneGeometry(dw - 2 * fr + 0.004, h - 2 * fr + 0.004);
      kb.add(pane, M.smoked, { matrix: place(dx, cy, dz), collide: false, castShadow: false, receiveShadow: false });
      pane.dispose();
    }
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Collision: simple boxes (cheaper and smoother than the detailed triangles)
  if (ctx.collision) {
    const boxes = [];
    const tall = layout.kitchen.items.filter((k) => k.type === 'tall-cabinet').map((k) => k.box);
    if (tall.length) boxes.push(tall.reduce((a, b) => a.clone().union(b)));
    if (benk) boxes.push(benk.box.clone().union(wt ? wt.box : benk.box));
    if (oy) boxes.push(new THREE.Box3(new THREE.Vector3(oy.box.min.x, 0, oy.box.min.z), new THREE.Vector3(oy.box.max.x, oy.box.max.y, oy.box.max.z)));
    if (ov) boxes.push(ov.box.clone());
    for (const b of boxes) ctx.collision.addStaticBox(b);
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Built-in lights: LED cove before the tall cabinets, LED under the glass cabinet, track + pendants, ring lamps
  const builtInLights = [];
  const groupLabel = Object.fromEntries((layout.lightGroups || []).map((g) => [g.id, g.label]));
  const lights = new THREE.Group();
  lights.name = 'kitchen-lights';
  lights.userData.noCollide = true;
  group.add(lights);
  const lb = new MeshBatcher('kitchen-light-fittings');
  for (const l of layout.builtInLights) {
    if (l.group !== 'kjokken' && l.group !== 'overskap') continue;
    const label = groupLabel[l.group] || l.name;
    if (l.type === 'track' && l.from && l.to) {
      const len = l.from.distanceTo(l.to);
      const th = l.dims?.h ?? 0.035, tw = l.dims?.w ?? 0.035;
      const dir = l.to.clone().sub(l.from).normalize();
      const mid = l.from.clone().add(l.to).multiplyScalar(0.5);
      const y = ceilY(mid.x, mid.z);
      lb.box(len, th, tw, mid.x, y - th / 2, mid.z, M.handle, { rot: [0, -Math.atan2(dir.z, dir.x), 0], collide: false });
      continue;
    }
    if (l.type === 'led-strip' && l.from && l.to) {
      const under = l.id === 'led-overskap' || l.group === 'overskap';
      const strip = under
        ? ledStrip({ ...l, from: l.from, to: l.to }, null, lb, M.alu, { housingW: 0.02, below: -0.01 })
        : ledStrip(l, layout.ceilingHeightAt, lb, M.alu);
      owned.push(strip.mesh.geometry, strip.mesh.material);
      lights.add(strip.mesh);
      builtInLights.push({
        id: l.id,
        group: l.group,
        label,
        type: 'led-strip',
        from: under ? l.from.clone().setY(l.from.y - 0.01) : strip.from,
        to: under ? l.to.clone().setY(l.to.y - 0.01) : strip.to,
        direction: new THREE.Vector3(0, -1, 0),
        colorK: l.colorK,
        lumens: l.lumens,
        emissiveMeshes: under ? [strip.mesh, ...overskapEmissive] : [strip.mesh],
      });
      continue;
    }
    if (!l.position) continue;
    if (l.type === 'pendant-cylinder') {
      // hangs from an adapter under the track
      const track = layout.builtInLights.find((t) => t.type === 'track');
      const trackH = track?.dims?.h ?? 0.035;
      const attachY = ceilY(l.position.x, l.position.z) - (track ? trackH + 0.012 : 0);
      if (track) lb.box(0.028, 0.012, 0.03, l.position.x, attachY + 0.006, l.position.z, M.handle, { collide: false });
      const bottom = l.dims?.bottomY ?? 1.7;
      const len = l.dims?.l ?? 0.3;
      const dia = l.dims?.d ?? 0.07;
      const lamp = lampModel(l, 'pendant-cylinder', {
        dims: { w: dia, d: dia, h: len },
        params: { drop: Math.max(len, attachY - bottom) },
        colors: { shade: l.color, inner: '#1a1a1a', base: l.color, metal: l.color, cord: l.color },
        materials: { shade: 'black-metal', inner: 'black-metal', base: 'black-metal', metal: 'black-metal', cord: 'cotton' },
      }, new THREE.Vector3(l.position.x, attachY, l.position.z), 'pendant', bottom);
      lights.add(lamp.object);
      builtInLights.push(...lamp.lights.map((x) => ({ ...x, label })));
    } else if (l.type === 'ceiling-ring') {
      const lamp = lampModel(l, 'ceiling-ring', {
        dims: { w: l.dims?.w ?? 0.4, d: l.dims?.d ?? l.dims?.w ?? 0.4, h: l.dims?.drop ?? 0.15 },
        params: { drop: l.dims?.drop ?? 0.15, rings: [l.dims?.w ?? 0.4], count: 1, arm: true, style: 'arm' },
        colors: { shade: l.color, inner: '#f4efe6', base: l.color, metal: l.color, cord: l.color },
        materials: { shade: 'black-metal', inner: 'glass-opal', base: 'black-metal', metal: 'black-metal', cord: 'cotton' },
      }, new THREE.Vector3(l.position.x, ceilY(l.position.x, l.position.z), l.position.z), 'ceiling', null);
      lights.add(lamp.object);
      builtInLights.push(...lamp.lights.map((x) => ({ ...x, label })));
    }
  }

  /** LAMPS model hung at `at`; light entries in world space (fallback: one light at the lamp's bottom). */
  function lampModel(l, archetype, spec, at, type, bottomY) {
    const object = buildModel({ archetype, ...spec });
    object.name = `built-in:${l.id}`;
    object.position.copy(at);
    object.userData.noCollide = true;
    object.userData.builtIn = l.id;
    object.updateMatrixWorld(true);
    lampObjects.push(object);
    const ml = object.userData.model?.lights || [];
    const total = ml.reduce((s, x) => s + (x.lumens || 0), 0) || 1;
    const out = ml.map((x, i) => ({
      id: ml.length > 1 ? `${l.id}:${i}` : l.id,
      group: l.group,
      type,
      lightType: x.type || 'point',
      position: new THREE.Vector3(...(x.position || [0, -(spec.params?.drop ?? 0.2), 0])).applyMatrix4(object.matrixWorld),
      direction: x.direction ? new THREE.Vector3(...x.direction).transformDirection(object.matrixWorld) : new THREE.Vector3(0, -1, 0),
      angle: x.angle,
      penumbra: x.penumbra,
      colorK: l.colorK ?? x.colorK ?? 2700,
      lumens: ((l.lumens || 0) * (x.lumens || 0)) / total || l.lumens,
      emissiveMeshes: x.emissiveMeshes || [],
    }));
    if (!out.length) {
      out.push({
        id: l.id,
        group: l.group,
        type,
        lightType: type === 'pendant' ? 'spot' : 'point',
        position: new THREE.Vector3(at.x, bottomY ?? at.y - (spec.params?.drop ?? 0.15) - 0.03, at.z),
        direction: new THREE.Vector3(0, -1, 0),
        angle: type === 'pendant' ? 0.7 : undefined,
        colorK: l.colorK ?? 2700,
        lumens: l.lumens,
        emissiveMeshes: [],
      });
    }
    return { object, lights: out };
  }

  const built = kb.build();
  group.add(built);
  const fittings = lb.build();
  lights.add(fittings);
  fittings.traverse((m) => {
    if (m.isMesh) m.castShadow = false;
  });

  // worktop surfaces (Placement can put small things on them)
  const surfaces = [];
  if (wt) surfaces.push({ id: 'benk', y: wt.box.max.y, box: wt.box.clone() });
  if (oy) surfaces.push({ id: 'oy', y: oy.box.max.y, box: oy.box.clone() });

  return {
    group,
    builtInLights,
    surfaces,
    dispose() {
      group.removeFromParent();
      for (const g of kb.geometries) g.dispose();
      for (const g of lb.geometries) g.dispose();
      for (const o of lampObjects) {
        o.traverse((m) => {
          if (m.geometry && !m.geometry.userData?.shared) m.geometry.dispose();
          const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
          for (const x of mats) if (!x.userData?.cached && !x.userData?.shared) x.dispose();
        });
      }
      for (const o of owned) o.dispose?.();
    },
  };
}

/** Rounded rectangle path (x, y = lower-left corner). */
function roundRect(p, x, y, w, h, r) {
  p.moveTo(x + r, y);
  p.lineTo(x + w - r, y);
  p.quadraticCurveTo(x + w, y, x + w, y + r);
  p.lineTo(x + w, y + h - r);
  p.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  p.lineTo(x + r, y + h);
  p.quadraticCurveTo(x, y + h, x, y + h - r);
  p.lineTo(x, y + r);
  p.quadraticCurveTo(x, y, x + r, y);
}

/** Worktop UVs in world metres: top/bottom (x, z) with the veins along x, edges (along, y). */
function worktopUV(g) {
  const pos = g.attributes.position;
  const nrm = g.attributes.normal;
  const uv = g.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const ny = Math.abs(nrm.getY(i));
    if (ny > 0.5) uv.setXY(i, x, z);
    else if (Math.abs(nrm.getX(i)) > 0.5) uv.setXY(i, z, y);
    else uv.setXY(i, x, y);
  }
  uv.needsUpdate = true;
}

/** BoxGeometry UVs as world metres around a centre (top: x/z, sides: along/y); `vertical` = waterfall slab. */
function worldBoxUV(g, cx, cy, cz, vertical = false) {
  const pos = g.attributes.position;
  const nrm = g.attributes.normal;
  const uv = g.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) + cx, y = pos.getY(i) + cy, z = pos.getZ(i) + cz;
    const nx = Math.abs(nrm.getX(i)), ny = Math.abs(nrm.getY(i));
    // the waterfall continues the top's veins: its big faces use (y, z) so the pattern runs down from the edge
    if (ny > 0.5) uv.setXY(i, x, z);
    else if (nx > 0.5) uv.setXY(i, vertical ? 4.38 - y : z, vertical ? z : y);
    else uv.setXY(i, x, y);
  }
  uv.needsUpdate = true;
  return g;
}
