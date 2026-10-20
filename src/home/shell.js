// The architecture of the home (owned by SHELL): walls with real thickness (exterior 0.30 m) and mitred corners, window
// and door openings with reveals, black aluminium window frames / sashes, glass, window boards, the black hall door
// and the glazed terrace door (world/Door.js), the oak floor, white skirting boards, flat + sloped ceilings, the
// bulkheads, LED coves, the four spots at the high wall, the TV-stue ceiling lamp, sockets / switches / smoke detectors,
// the heat pump, a small hall behind the hall door and the roof / eaves seen from the terrace.
//
// All measurements come from home/layout.js (room-spec.json). Wall-local frame used throughout: origin at the wall's
// start on the room-side face, +x along the wall, +y up, +z = room normal (into the room); the wall occupies
// z ∈ [−thickness, 0]. Opening-local frame: origin at the bottom centre of the hole on the room face (y = sill),
// +x = right seen from the room, +z = into the room.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { paint, mat, emissive } from './materials.js';
import { extrudeWall, basis, MeshBatcher, place, prismX } from '../world/buildKit.js';
import { woodCladding, surfaceMaterial } from '../world/surfaces.js';
import { createCanvas, canvasTexture, heightToNormalCanvas, mulberry32 } from '../world/proctex.js';
import { Door } from '../world/Door.js';
import { buildModel } from '../models/registry.js';

const UP = new THREE.Vector3(0, 1, 0);
const EPS = 1e-4;
const DEG = Math.PI / 180;

/** Look constants that are not room measurements (colours / profile sizes of products, not of the room). */
const LOOK = {
  frame: '#25272b', // window/door aluminium
  gasket: '#0b0b0c',
  sill: '#e6e2da', // window boards (white-ish painted)
  baseboard: '#e9e6df',
  reveal: 'sand', // reveals are painted SAND (also in the Marrakesh TV-stue)
  interiorBack: '#ddd7cc', // hidden faces of interior walls (bedroom / hall side) and the hall
  cladding: '#4a4642', // dark vertical boards (same as the annex)
  trim: '#2f2f31',
  roof: '#2e2d2c',
  led: '#ffd8a6',
  ledHousing: '#cfcfcc',
  threshold: '#cdbfae',
  hallDoor: '#1d1e21',
  fixture: '#1c1a19',
};

// ---------------------------------------------------------------------------------------------------------------
// Small helpers

const v2 = (x, y) => new THREE.Vector2(x, y);

/**
 * Fast tileable gradient noise for the canvas textures of the shell and the kitchen (floor, worktop, cabinets).
 * Returns n(x, y, px, py): std ≈ 1, range ≈ ±3, repeats every px × py lattice cells (integers ≤ 256).
 * @param {number} seed
 * @returns {(x: number, y: number, px: number, py: number) => number}
 */
export function periodicNoise(seed) {
  const rnd = mulberry32(seed);
  const G = new Float32Array(512);
  for (let i = 0; i < 256; i++) {
    const a = rnd() * Math.PI * 2;
    G[2 * i] = Math.cos(a);
    G[2 * i + 1] = Math.sin(a);
  }
  const p = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [p[i], p[j]] = [p[j], p[i]];
  }
  const P = new Uint16Array(512);
  for (let i = 0; i < 512; i++) P[i] = p[i & 255];
  return (x, y, px, py) => {
    const xf = Math.floor(x), yf = Math.floor(y);
    const fx = x - xf, fy = y - yf;
    let xi = xf % px, yi = yf % py;
    if (xi < 0) xi += px;
    if (yi < 0) yi += py;
    const xj = xi + 1 === px ? 0 : xi + 1;
    const yj = yi + 1 === py ? 0 : yi + 1;
    const a0 = P[xi], a1 = P[xj];
    const g00 = P[a0 + yi] << 1, g10 = P[a1 + yi] << 1, g01 = P[a0 + yj] << 1, g11 = P[a1 + yj] << 1;
    const n00 = G[g00] * fx + G[g00 + 1] * fy;
    const n10 = G[g10] * (fx - 1) + G[g10 + 1] * fy;
    const n01 = G[g01] * fx + G[g01 + 1] * (fy - 1);
    const n11 = G[g11] * (fx - 1) + G[g11 + 1] * (fy - 1);
    const u = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
    const v = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
    const nx0 = n00 + u * (n10 - n00);
    const nx1 = n01 + u * (n11 - n01);
    return (nx0 + v * (nx1 - nx0)) * 4.5;
  };
}

/**
 * Dark vertical board-and-batten cladding (outer walls, the annex, the terrace side): ONE neutral grey texture set
 * (world/surfaces.js woodCladding, cached), tinted per use through material.color – the shell and the exterior share
 * it instead of generating two colour variants. 256 × 512 px on «lav» / «middels» (≈ 200 px/m, it is only seen
 * through the windows and from the terrace), 512 × 1024 on «høy».
 * @param {string} hex   wanted mean colour, e.g. '#4a4642'
 * @param {object} quality  ctx.quality
 * @param {object} [params] extra MeshStandardMaterial params (roughness …)
 * @returns {THREE.MeshStandardMaterial} a new material (dispose it); the textures are cached/shared
 */
export function claddingMaterial(hex, quality = {}, params = {}) {
  const res = quality.level === 'high' ? 1 : 0.5;
  const GREY = '#808080';
  const set = woodCladding({ color: GREY, boardCC: 0.16, battenW: 0.05, tileW: 1.28, tileH: 2.4, seed: 19, res });
  const m = surfaceMaterial(set, { roughness: 0.9, ...params });
  const g = new THREE.Color(GREY);
  const c = new THREE.Color(hex);
  m.color.setRGB(c.r / g.r, c.g / g.g, c.b / g.b);
  m.name = `cladding:${hex}`;
  return m;
}

/** Bilinear, wrapping sample of a GW × GH Float32Array grid at grid coordinates (fx, fy). */
export function gridSample(arr, GW, GH, fx, fy) {
  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  const tx = fx - x0, ty = fy - y0;
  let xa = x0 % GW, ya = y0 % GH;
  if (xa < 0) xa += GW;
  if (ya < 0) ya += GH;
  const xb = xa + 1 === GW ? 0 : xa + 1, yb = ya + 1 === GH ? 0 : ya + 1;
  const a = arr[ya * GW + xa], b = arr[ya * GW + xb], c = arr[yb * GW + xa], d = arr[yb * GW + xb];
  return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
}

/** Right-handed frame: x = dir, y = up, z = dir × up (must equal the wanted normal; flip dir otherwise). */
function wallMatrix(w) {
  return basis(w.dir3, UP, w.normal3, new THREE.Vector3(w.start.x, 0, w.start.y));
}

function openingMatrix(o, y = null) {
  const origin = o.bottomCenter.clone();
  if (y != null) origin.y = y;
  return basis(o.right, UP, o.normal, origin);
}

/** Copy of one material group of a non-indexed geometry (null when empty). */
function groupGeometry(g, materialIndex) {
  const gr = g.groups.find((x) => x.materialIndex === materialIndex);
  if (!gr || !gr.count) return null;
  const sub = new THREE.BufferGeometry();
  for (const [name, attr] of Object.entries(g.attributes)) {
    const s = attr.itemSize;
    sub.setAttribute(name, new THREE.BufferAttribute(attr.array.slice(gr.start * s, (gr.start + gr.count) * s), s));
  }
  return sub;
}

/**
 * Extruded layer of a wall in wall-local coordinates with mitred ends.
 * @param {object} o
 * @param {number} o.L                       wall length
 * @param {number} o.bottom                  bottom edge height
 * @param {Array<[number, number]>} o.top    top edge [[u, y], …] from u = 0 to u = L (steps allowed)
 * @param {Array<{x0,x1,y1}>} o.notches      openings cut from the bottom edge (doors)
 * @param {Array<{x0,x1,y0,y1}>} o.holes     openings inside (windows)
 * @param {number} o.z0 @param {number} o.z1 layer depth range (z1 > z0, both ≤ 0)
 * @param {number} o.kStart @param {number} o.kEnd  mitre factors: x += ∓k·depth at the ends (see buildWalls)
 * @returns {THREE.BufferGeometry} groups 0 back (−z), 1 front (+z), 2 sides
 */
function wallLayer({ L, bottom, top, notches = [], holes = [], z0, z1, kStart = 0, kEnd = 0 }) {
  const pts = [];
  const push = (x, y) => {
    const p = pts[pts.length - 1];
    if (!p || Math.abs(p.x - x) > 1e-6 || Math.abs(p.y - y) > 1e-6) pts.push(v2(x, y));
  };
  const ns = notches.filter((n) => n.x1 > EPS && n.x0 < L - EPS).sort((a, b) => a.x0 - b.x0);
  let startNotch = null;
  let endNotch = null;
  if (ns.length && ns[0].x0 <= EPS) startNotch = ns.shift();
  if (ns.length && ns[ns.length - 1].x1 >= L - EPS) endNotch = ns.pop();
  if (startNotch) {
    push(0, startNotch.y1);
    push(startNotch.x1, startNotch.y1);
    push(startNotch.x1, bottom);
  } else push(0, bottom);
  for (const n of ns) {
    push(n.x0, bottom);
    push(n.x0, n.y1);
    push(n.x1, n.y1);
    push(n.x1, bottom);
  }
  if (endNotch) {
    push(endNotch.x0, bottom);
    push(endNotch.x0, endNotch.y1);
    push(L, endNotch.y1);
  } else push(L, bottom);
  for (let i = top.length - 1; i >= 0; i--) push(Math.max(0, Math.min(L, top[i][0])), top[i][1]);
  if (pts.length > 2 && pts[0].distanceTo(pts[pts.length - 1]) < 1e-6) pts.pop();
  const shape = new THREE.Shape(pts);
  for (const h of holes) shape.holes.push(new THREE.Path([v2(h.x0, h.y0), v2(h.x0, h.y1), v2(h.x1, h.y1), v2(h.x1, h.y0)]));
  const g = extrudeWall(shape, z1 - z0, z0);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const d = -pos.getZ(i);
    if (x < EPS) pos.setX(i, x - kStart * d);
    else if (x > L - EPS) pos.setX(i, x + kEnd * d);
  }
  pos.needsUpdate = true;
  g.computeVertexNormals();
  // UVs in metres from the (mitred) positions – the mitre shift would otherwise shear the caps' texture across
  // their long triangles: faces of the wall planes (u along the wall, v up), ends (depth, up), top/bottom (u, depth)
  const nrm = g.attributes.normal;
  const uv = g.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    const ax = Math.abs(nrm.getX(i)), ay = Math.abs(nrm.getY(i)), az = Math.abs(nrm.getZ(i));
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    if (az >= ax && az >= ay) uv.setXY(i, x, y);
    else if (ax >= ay) uv.setXY(i, -z, y);
    else uv.setXY(i, x, -z);
  }
  uv.needsUpdate = true;
  return g;
}

/** Four boxes forming a rectangular ring (outer size w × h centred on x = cx, bottom y0) in a batch frame. */
function ring(f, cx, y0, w, h, side, topW, bottomW, z0, z1, material, o = {}) {
  const d = z1 - z0;
  const zc = (z0 + z1) / 2;
  if (topW > 0) f.box(w, topW, d, cx, y0 + h - topW / 2, zc, material, o);
  if (bottomW > 0) f.box(w, bottomW, d, cx, y0 + bottomW / 2, zc, material, o);
  const hh = h - topW - bottomW;
  if (hh > 0 && side > 0) {
    f.box(side, hh, d, cx - w / 2 + side / 2, y0 + bottomW + hh / 2, zc, material, o);
    f.box(side, hh, d, cx + w / 2 - side / 2, y0 + bottomW + hh / 2, zc, material, o);
  }
}

/**
 * Window glass: only the specular (environment reflection with Fresnel + light highlights) is added to what lies
 * behind, which is dimmed by a constant, slightly green-grey transmission – reads as glass, costs one draw, no
 * transmission pass. Shared by every pane (do not dispose per window).
 * @returns {THREE.MeshStandardMaterial}
 */
export function glassMaterial() {
  if (glassMaterial._m) return glassMaterial._m;
  const m = new THREE.MeshStandardMaterial({
    color: 0x000000,
    roughness: 0.035,
    metalness: 0,
    envMapIntensity: 1.1,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusConstantColorFactor,
    blendSrcAlpha: THREE.ZeroFactor,
    blendDstAlpha: THREE.OneFactor,
  });
  // transmission ≈ (0.88, 0.91, 0.895): double glazing, faintly green-grey
  m.blendColor.setRGB(0.12, 0.09, 0.105);
  m.name = 'window-glass';
  m.userData = { cached: true, kind: 'glass-window' };
  glassMaterial._m = m;
  return m;
}

// ---------------------------------------------------------------------------------------------------------------
// Floor texture: wide, matt, white-washed oak planks (082829 / 083019 / 082909): soft cathedral grain, almost no
// fibre streaks, very subtle seams and only a slight tone difference between planks. Per-pixel (ImageData), tiles
// over 2 plank lengths × 6 planks, UVs in metres (u along the grain = world z).

function floorMaterial(floor, res) {
  const plankW = floor.plankWidth ?? 0.22;
  const plankL = floor.plankLength ?? 2.2;
  const rows = 6;
  const tileU = plankL * 2; // along the grain (world z)
  const tileV = plankW * rows; // across (world x)
  const ppm = Math.max(160, Math.min(360, Math.round(300 * res)));
  const W = Math.round((tileU * ppm) / 8) * 8;
  const H = Math.round((tileV * ppm) / 8) * 8;
  const rowH = H / rows;
  const lenPx = W / 2;
  const rnd = mulberry32(7331);
  const base = new THREE.Color(floor.color || '#b4a99c');
  const seam = new THREE.Color(floor.seamColor || '#8c8178');
  const contrast = floor.grainContrast ?? 0.06;
  const baseS = base.clone().convertLinearToSRGB();
  const seamS = seam.clone().convertLinearToSRGB();
  const N = periodicNoise(4711), N2 = periodicNoise(271);
  // planks: per row an end-joint offset, two planks per row in the tile
  const planks = [];
  for (let j = 0; j < rows; j++) {
    const off = rnd() * lenPx;
    const pl = [];
    for (let k = 0; k < 2; k++) {
      pl.push({
        tone: (rnd() - 0.5) * 2 * contrast * 0.35, // ± 2 % lightness between planks
        warm: (rnd() - 0.5) * 0.012,
        t0: 0.2 + rnd() * 0.6, // centre of the cathedral (across the plank)
        A: 3 + rnd() * 5, // arch curvature
        B: (0.8 + rnd() * 1.6) * (rnd() < 0.5 ? -1 : 1), // the arches run along the plank
        rings: 4 + rnd() * 4,
        ph: rnd(),
        cath: rnd() < 0.7 ? 1 : 0.35, // some planks are mostly straight grain
      });
    }
    planks.push({ off, pl });
  }
  // low-frequency fields (1/8 resolution): warp of the rings, soft mottling
  const QW = W >> 3, QH = H >> 3;
  const warp = new Float32Array(QW * QH), mott = new Float32Array(QW * QH);
  for (let y = 0; y < QH; y++) {
    for (let x = 0; x < QW; x++) {
      const u = x / QW, v = y / QH;
      warp[y * QW + x] = N(u * 6, v * 9, 6, 9) * 0.5 + N(u * 14, v * 24, 14, 24) * 0.25;
      mott[y * QW + x] = N2(u * 4, v * 6, 4, 6) * 0.6 + N2(u * 10, v * 15, 10, 15) * 0.4;
    }
  }
  // faint fibres along the grain: one profile across the rows (offset per plank)
  const fib = new Float32Array(H * 2);
  for (let y = 0; y < H * 2; y++) fib[y] = N2(0.5, (y / (H * 2)) * 220, 4, 220) * 0.6 + N(1.5, (y / (H * 2)) * 90, 4, 90) * 0.4;
  const color = createCanvas(W, H);
  const cx = color.getContext('2d', { willReadFrequently: true });
  const imgD = cx.createImageData(W, H);
  const px = imgD.data;
  for (let y = 0; y < H; y++) {
    const j = Math.min(rows - 1, Math.floor(y / rowH));
    const ty = (y - j * rowH) / rowH; // 0..1 across the plank
    const row = planks[j];
    const qy = (y / H) * QH;
    for (let x = 0; x < W; x++) {
      let xs = x - row.off;
      xs = ((xs % W) + W) % W;
      const k = xs < lenPx ? 0 : 1;
      const sAlong = (xs - k * lenPx) / lenPx; // 0..1 along the plank
      const p = row.pl[k];
      const qx = (x / W) * QW;
      const wv = gridSample(warp, QW, QH, qx, qy);
      // cathedral: iso-lines of a parabola in (s, t) → nested arches along the plank; flatter where cath < 1
      const dt = ty - p.t0;
      const F = p.cath * p.A * dt * dt + p.B * sAlong + 0.18 * wv + (1 - p.cath) * ty * 3;
      const ring = Math.cos((F * p.rings + p.ph) * Math.PI * 2);
      const late = ring > 0.3 ? (ring - 0.3) / 0.7 : 0; // narrower, darker late wood
      const l = 1 + p.tone - 0.04 * late * late + 0.009 * fib[(y * 2 + k * 517) % (H * 2)] + 0.02 * gridSample(mott, QW, QH, qx, qy);
      const o = (y * W + x) * 4;
      px[o] = baseS.r * l * (1 + p.warm + late * 0.012) * 255;
      px[o + 1] = baseS.g * l * 255;
      px[o + 2] = baseS.b * l * (1 - p.warm - late * 0.02) * 255;
      px[o + 3] = 255;
    }
  }
  // seams: very subtle darker lines (long seams between the rows incl. the tile wrap, end joints)
  const darken = (x, y, a) => {
    x = ((x % W) + W) % W;
    y = ((y % H) + H) % H;
    const o = (y * W + x) * 4;
    px[o] += (seamS.r * 255 - px[o]) * a;
    px[o + 1] += (seamS.g * 255 - px[o + 1]) * a;
    px[o + 2] += (seamS.b * 255 - px[o + 2]) * a;
  };
  for (let j = 0; j < rows; j++) {
    const y = Math.round(j * rowH);
    for (let x = 0; x < W; x++) {
      darken(x, y, 0.22);
      darken(x, y - 1, 0.08);
    }
    const y1 = Math.round((j + 1) * rowH);
    for (let k = 0; k < 2; k++) {
      const x = Math.round(planks[j].off + k * lenPx);
      for (let yy = y; yy < y1; yy++) {
        darken(x, yy, 0.24);
        darken(x + 1, yy, 0.07);
      }
    }
  }
  cx.putImageData(imgD, 0, 0);
  // height (half resolution): a soft V at the seams only – the micro-bevel catches a little light, no grain relief
  const HW = W >> 1, HH = H >> 1;
  const heights = new Float32Array(HW * HH);
  const hRow = HH / rows;
  for (let y = 0; y < HH; y++) {
    const j = Math.min(rows - 1, Math.floor(y / hRow));
    const dy = Math.min(y - j * hRow, (j + 1) * hRow - y);
    const offH = planks[j].off / 2;
    for (let x = 0; x < HW; x++) {
      let h = 0.6 + 0.4 * Math.min(1, dy / 1.5);
      for (let k = 0; k < 2; k++) {
        const e = (((x - (offH + (k * HW) / 2)) % HW) + HW * 1.5) % HW - HW / 2;
        h = Math.min(h, 0.6 + 0.4 * Math.min(1, Math.abs(e) / 1.5));
      }
      heights[y * HW + x] = h;
    }
  }
  const repeat = [1 / tileU, 1 / tileV];
  const map = canvasTexture(color, { repeat, srgb: true, anisotropy: 16 });
  const normalMap = canvasTexture(heightToNormalCanvas(heights, HW, HH, 1.2), { repeat, srgb: false, anisotropy: 16 });
  const m = new THREE.MeshStandardMaterial({
    map,
    normalMap,
    normalScale: new THREE.Vector2(0.35, 0.35),
    color: meanColor(px, base),
    roughness: 0.72,
    metalness: 0,
    envMapIntensity: 0.6,
  });
  m.name = 'floor-oak';
  return { material: m, textures: [map, normalMap] };
}

/** Material colour that makes the (sRGB) pixel buffer's mean linear albedo equal `target` (THREE.Color). */
function meanColor(px, target, step = 7) {
  const lin = (v) => {
    v /= 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  let sr = 0, sg = 0, sb = 0, n = 0;
  for (let i = 0; i < px.length; i += 4 * step) {
    sr += lin(px[i]);
    sg += lin(px[i + 1]);
    sb += lin(px[i + 2]);
    n++;
  }
  return new THREE.Color(target.r / (sr / n || 1), target.g / (sg / n || 1), target.b / (sb / n || 1));
}

/** Floor (x, z polygon) → horizontal ShapeGeometry with UVs u = z (along the planks), v = x, in metres. */
function floorGeometry(poly, y = 0) {
  const shape = new THREE.Shape(poly.map((p) => v2(p.x ?? p[0], -(p.y ?? p[1]))));
  const g = new THREE.ShapeGeometry(shape);
  g.rotateX(-Math.PI / 2);
  g.translate(0, y, 0);
  const pos = g.attributes.position;
  const uv = g.attributes.uv;
  for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getZ(i), pos.getX(i));
  return g;
}

/** Ceiling polygon → downward-facing geometry, y from heightAt(x, z), UVs (x, z) metres. */
function ceilingGeometry(poly, heightAt) {
  const shape = new THREE.Shape(poly.map((p) => v2(p.x ?? p[0], p.y ?? p[1])));
  const g = new THREE.ShapeGeometry(shape);
  g.rotateX(Math.PI / 2);
  const pos = g.attributes.position;
  const uv = g.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    pos.setY(i, heightAt(x, z));
    uv.setXY(i, x, z);
  }
  g.computeVertexNormals();
  return g;
}

// ---------------------------------------------------------------------------------------------------------------

/**
 * Builds the shell of the room from the layout (ARCHITECTURE §4, §15).
 * @param {object} ctx     createHome ctx (scene, collision, interaction, quality …)
 * @param {object} layout  home/layout.js
 * @returns {{ group: THREE.Group, walls: object[], windows: object[], doors: object[], highWall: object,
 *   pickables: { floor: THREE.Mesh[], walls: THREE.Mesh[], ceilings: THREE.Mesh[], windows: THREE.Mesh[] },
 *   ceilingHeightAt: (x: number, z: number) => number, builtInLights: object[], setPaint: (id: string, color: string|null) => void,
 *   update: (dt: number, state: object) => void, dispose: () => void }}
 */
export function buildShell(ctx, layout) {
  const quality = ctx.quality || {};
  const res = quality.textureRes ?? 1;
  const low = quality.level === 'low';
  const group = new THREE.Group();
  group.name = 'shell';
  const solid = new THREE.Group(); // registered as static collision
  solid.name = 'shell-solid';
  group.add(solid);
  const deco = new THREE.Group(); // no collision
  deco.name = 'shell-deco';
  deco.userData.noCollide = true;
  group.add(deco);
  const pickables = { floor: [], walls: [], ceilings: [], windows: [] };
  const owned = []; // geometries + non-cached materials/textures to dispose
  const keep = (x) => (owned.push(x), x);
  const batchers = [];
  const lampObjects = []; // built-in lamp models (disposed with the shell)
  const newBatch = (name) => {
    const b = new MeshBatcher(name);
    batchers.push(b);
    return b;
  };

  // shared materials
  const M = {
    reveal: paint(LOOK.reveal),
    back: paint(LOOK.interiorBack),
    trim: mat('painted', LOOK.trim, { roughness: 0.6 }),
    frame: mat('black-metal', LOOK.frame, { roughness: 0.42 }),
    gasket: mat('plastic', LOOK.gasket, { roughness: 0.75, flat: true }),
    sill: paint(LOOK.sill, { roughness: 0.42 }),
    baseboard: paint(LOOK.baseboard, { roughness: 0.48 }),
    threshold: mat('oak', LOOK.threshold, { roughness: 0.55 }),
    hallDoor: mat('painted', LOOK.hallDoor, { roughness: 0.4 }),
    hallDoorGroove: mat('painted', '#0e0f10', { roughness: 0.85, flat: true }),
    hardware: mat('black-metal', '#1a1a1a', { roughness: 0.35 }),
    roof: mat('painted', LOOK.roof, { roughness: 0.85 }),
    alu: mat('painted', LOOK.ledHousing, { roughness: 0.32, metalness: 0.45 }),
    spot: mat('black-metal', '#141414', { roughness: 0.5 }),
    spotInner: mat('plastic', '#060606', { roughness: 0.9, flat: true, side: 'double' }),
    fixture: mat('plastic', LOOK.fixture, { roughness: 0.5 }),
    fixtureDark: mat('plastic', '#070707', { roughness: 0.8, flat: true }),
    // black glass switch panel (082924 / 082922: #0a090c next to a #a0a2a2 wall): only a faint, soft highlight – the
    // sharp, full-strength reflection of the bright windows in the environment map made it read light blue-grey
    // (physical: a low specular intensity also tames the highlights of the windows' area lights, not only the env map)
    switchGlass: (() => {
      const m = new THREE.MeshPhysicalMaterial({ color: '#08080a', roughness: 0.42, metalness: 0, specularIntensity: 0.3, envMapIntensity: 0.05 });
      m.name = 'switch-glass';
      return keep(m);
    })(),
    // ordinary (non-glass) switches: matt dark plastic (082924: #2f313b)
    switchPlastic: mat('plastic', '#1d1e22', { roughness: 0.6, envMapIntensity: 0.3 }),
    heatPump: mat('plastic', '#151515', { roughness: 0.38 }),
    glass: glassMaterial(),
  };
  M.cladding = keep(claddingMaterial(LOOK.cladding, quality, { roughness: 0.88 }));

  // ---- floor
  const floorM = floorMaterial(layout.floor, res);
  owned.push(floorM.material, ...floorM.textures);
  const floor = new THREE.Mesh(keep(floorGeometry(layout.floor.polygon)), floorM.material);
  floor.name = 'floor';
  floor.receiveShadow = true;
  floor.userData.pick = { kind: 'floor' };
  solid.add(floor);
  pickables.floor.push(floor);

  // ---- walls
  const ceilingSlope = layout.ceilings.find((c) => c.type === 'slope');
  const slope = ceilingSlope?.slope ?? 0.16216;
  const highX = ceilingSlope ? ceilingSlope.polygon.reduce((m, p) => Math.min(m, p.x), Infinity) : 3.22;
  const highH = ceilingSlope?.highHeight ?? 3.0;
  /** Underside of the roof deck above a plan x (the ceiling plane continued + 0.30 m of roof structure). */
  const roofUnder = (x) => Math.min(highH, highH - slope * (x - highX)) + 0.3;
  const SLAB = 0.3; // floor slab edge below the outer cladding

  const walls = [];
  const wallMeshes = new Map();
  const revealBatch = newBatch('shell-walls');
  const nW = layout.walls.length;
  const cross = (a, b) => a.x * b.y - a.y * b.x;
  for (let i = 0; i < nW; i++) {
    const w = layout.walls[i];
    const prev = layout.walls[(i - 1 + nW) % nW];
    const next = layout.walls[(i + 1) % nW];
    const L = w.length;
    const t = w.thickness;
    // mitre factors (convex room corner → the wall extends, reflex → it is cut back); collinear → 0
    let kStart = 0;
    let kEnd = 0;
    if (prev.end.distanceTo(w.start) < 1e-3) {
      const c = cross(prev.dir, w.dir);
      kStart = Math.abs(c) < 1e-6 ? 0 : (c > 0 ? 1 : -1) * (prev.thickness / t);
    }
    if (w.end.distanceTo(next.start) < 1e-3) {
      const c = cross(w.dir, next.dir);
      kEnd = Math.abs(c) < 1e-6 ? 0 : (c > 0 ? 1 : -1) * (next.thickness / t);
    }
    const exterior = w.exterior && t >= 0.2;
    const rd = exterior ? Math.min(t - 0.05, Math.max(0.2, ...w.openings.map((o) => o.revealDepth || 0))) : t;
    const top = w.topProfile.map(([u, h]) => [u, h]);
    const notches = [];
    const holes = [];
    const outerHoles = [];
    for (const o of w.openings) {
      const y0 = o.sill - (o.sillBoard ? o.sillBoard.thickness ?? 0.025 : 0);
      if (o.sill <= EPS) notches.push({ x0: o.u0, x1: o.u1, y1: o.top });
      else holes.push({ x0: o.u0, x1: o.u1, y0, y1: o.top });
      outerHoles.push({ x0: o.u0, x1: o.u1, y0: Math.max(0, y0), y1: o.top });
    }
    const M4 = wallMatrix(w);
    // inner layer: room face (pickable, paintable) + reveals
    const gIn = wallLayer({ L, bottom: 0, top, notches, holes, z0: -rd, z1: 0, kStart, kEnd });
    gIn.applyMatrix4(M4);
    const face = groupGeometry(gIn, 1);
    const sides = groupGeometry(gIn, 2);
    const back = groupGeometry(gIn, 0);
    gIn.dispose();
    const faceMesh = new THREE.Mesh(keep(face), paint(w.paint));
    faceMesh.name = `wall:${w.id}`;
    faceMesh.castShadow = true;
    faceMesh.receiveShadow = true;
    faceMesh.userData.pick = { kind: 'wall', wallId: w.id };
    solid.add(faceMesh);
    pickables.walls.push(faceMesh);
    wallMeshes.set(w.id, faceMesh);
    if (sides) revealBatch.add(sides, exterior ? M.reveal : M.back);
    if (back && !exterior) revealBatch.add(back, M.back);
    sides?.dispose();
    back?.dispose();
    if (exterior) {
      // outer layer: cladding from the slab edge up under the roof, dark trim in the outer reveals
      const xs = [0, L];
      if (Math.abs(w.dir.x) > 1e-3) {
        const uHigh = (highX - w.start.x) / w.dir.x;
        if (uHigh > 0 && uHigh < L) xs.push(uHigh);
      }
      xs.sort((a, b) => a - b);
      const outerTop = xs.map((u) => {
        const p = w.pointAt(u).addScaledVector(w.normal3, -t);
        return [u, Math.max(w.heightAt(u) + 0.25, roofUnder(p.x) + 0.05)];
      });
      const gOut = wallLayer({ L, bottom: -SLAB, top: outerTop, holes: outerHoles, z0: -t, z1: -rd, kStart, kEnd });
      gOut.applyMatrix4(M4);
      const clad = groupGeometry(gOut, 0);
      const trim = groupGeometry(gOut, 2);
      gOut.dispose();
      if (clad) revealBatch.add(clad, M.cladding);
      if (trim) revealBatch.add(trim, M.trim);
      clad?.dispose();
      trim?.dispose();
    }
    walls.push({
      id: w.id,
      name: w.name,
      start: w.start.clone(),
      end: w.end.clone(),
      normal: w.normal.clone(),
      normal3: w.normal3.clone(),
      dir3: w.dir3.clone(),
      length: L,
      thickness: t,
      paint: w.paint,
      meshes: [faceMesh],
      heightAt: w.heightAt,
      isHigh: w.isHigh,
      exterior: w.exterior,
      revealDepth: rd,
    });
  }

  // ---- ceilings (face down; sloped ones follow layout heightAt) + bulkheads
  const ceilingMeshes = new Map();
  for (const c of layout.ceilings) {
    const mesh = new THREE.Mesh(keep(ceilingGeometry(c.polygon, c.heightAt)), paint(c.paint));
    mesh.name = `ceiling:${c.id}`;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.pick = { kind: 'ceiling', ceilingId: c.id };
    mesh.userData.noCollide = true;
    group.add(mesh);
    pickables.ceilings.push(mesh);
    ceilingMeshes.set(c.id, mesh);
  }
  const bulkheadMeshes = new Map();
  for (const b of layout.bulkheads) {
    let start = new THREE.Vector3(b.start.x, 0, b.start.y);
    let end = new THREE.Vector3(b.end.x, 0, b.end.y);
    let topA = b.top;
    let topB = b.topAtTo;
    let dir = end.clone().sub(start).normalize();
    if (dir.clone().cross(UP).dot(b.faceNormal) < 0) {
      [start, end] = [end, start];
      [topA, topB] = [topB, topA];
      dir.negate();
    }
    const len = start.distanceTo(end);
    // top follows the (sloped) ceiling + 1 cm into it; no bottom face (the flat ceiling behind covers the footprint)
    const shape = new THREE.Shape([v2(0, b.bottom), v2(len, b.bottom), v2(len, topB + 0.01), v2(0, topA + 0.01)]);
    let g = extrudeWall(shape, b.depth, -b.depth);
    g.applyMatrix4(basis(dir, UP, b.faceNormal, start));
    const g2 = withoutDownFaces(g);
    g.dispose();
    g = g2;
    const mesh = new THREE.Mesh(keep(g), paint(b.paint));
    mesh.name = `bulkhead:${b.id}`;
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.userData.noCollide = true;
    mesh.userData.pick = { kind: 'ceiling', ceilingId: b.id };
    group.add(mesh);
    pickables.ceilings.push(mesh);
    bulkheadMeshes.set(b.id, mesh);
  }

  // ---- roof (closes the shell for shadows and for the view from the terrace; hidden with the ceilings)
  {
    const b = layout.bounds;
    const xN = b.minX - 0.35;
    const zE = b.minZ - 0.35;
    const zW = b.maxZ + 0.35;
    const knekk = layout.wallsById['w-knekk'];
    const zSplit = knekk ? knekk.start.y - 0.3 : b.minZ;
    const kitchenOuter = layout.wallsById['w-kjokken-sor'] ? layout.wallsById['w-kjokken-sor'].start.x + 0.3 : b.maxX;
    const parts = [
      { z0: zE, z1: zSplit, eave: kitchenOuter + 0.5 },
      { z0: zSplit, z1: zW, eave: b.maxX + 0.3 + 0.55 },
    ];
    const roofParts = [];
    for (const p of parts) {
      const T = 0.26;
      const pts = [[xN, roofUnder(xN)], [highX, roofUnder(highX)], [p.eave, roofUnder(p.eave)], [p.eave, roofUnder(p.eave) + T], [highX, roofUnder(highX) + T], [xN, roofUnder(xN) + T]];
      const shape = new THREE.Shape(pts.map(([x, y]) => v2(x, y)));
      const g = new THREE.ExtrudeGeometry(shape, { depth: p.z1 - p.z0, bevelEnabled: false });
      g.translate(0, 0, p.z0);
      roofParts.push(g);
    }
    const roofGeo = keep(mergeGeometries(roofParts, false));
    for (const g of roofParts) g.dispose();
    const roof = new THREE.Mesh(roofGeo, M.roof);
    roof.name = 'roof';
    roof.castShadow = true;
    roof.receiveShadow = true;
    roof.userData.noCollide = true;
    group.add(roof);
    pickables.ceilings.push(roof); // hidden by ViewModes together with the ceilings (no pick → never selected)
    // gutter along the living-room eave
    const eave = parts[1].eave;
    const gy = roofUnder(eave) - 0.02;
    // half-round gutter open at the top (theta −90…90° → z ≥ 0 → below the axis after rotating x by 90°)
    const gutter = new THREE.Mesh(keep(new THREE.CylinderGeometry(0.06, 0.06, parts[1].z1 - parts[1].z0, 12, 1, true, -Math.PI / 2, Math.PI)), mat('painted', '#2b2b2b', { roughness: 0.5, side: 'double' }));
    gutter.rotation.set(Math.PI / 2, 0, 0);
    gutter.position.set(eave + 0.06, gy, (parts[1].z0 + parts[1].z1) / 2);
    gutter.userData.noCollide = true;
    gutter.castShadow = true;
    group.add(gutter);
    pickables.ceilings.push(gutter);
  }

  // ---- windows + terrace door frame (frame inside the reveal, glass, window boards, shading anchor)
  const windows = [];
  const exteriorBatch = newBatch('shell-window-outside');
  const doorDefs = new Map(layout.doors.map((d) => [d.id, d]));
  for (const o of layout.windows) {
    const isDoor = o.type === 'terrace-door';
    const win = buildWindow(o, isDoor);
    win.group.userData.pick = { kind: 'window', windowId: o.id };
    deco.add(win.group);
    for (const m of win.pickMeshes) pickables.windows.push(m);
    if (win.glass) {
      solid.add(win.glass); // glass blocks the player
      pickables.windows.push(win.glass);
    }
    // shading anchor: top middle of the opening on the room face; x = right, −y = down, z = into the room
    const anchor = new THREE.Group();
    anchor.name = `window-anchor:${o.id}`;
    anchor.userData.noCollide = true;
    anchor.matrixAutoUpdate = false;
    anchor.matrix.copy(basis(o.right, UP, o.normal, o.topCenter));
    group.add(anchor);
    windows.push({
      id: o.id,
      name: o.name,
      wallId: o.wallId,
      type: o.type,
      width: o.width,
      height: o.height,
      sill: o.sill,
      center: o.center.clone(),
      normal: o.normal.clone(),
      right: o.right.clone(),
      revealDepth: o.revealDepth,
      frameDepth: o.frame?.depth ?? 0.07,
      frameWidth: o.frame?.width ?? 0.07,
      opening: !!o.sashes?.some((s) => s.opening),
      anchor,
      glass: win.glass ? [win.glass] : [],
      group: win.group,
      sillBoard: win.sillY != null ? { y: win.sillY, depth: (o.sillBoard?.depth ?? o.revealDepth) + (o.sillBoard?.overhang ?? 0.01) } : null,
    });
  }

  /**
   * Builds the frame/sash/glass/board of one opening in its local frame (origin bottom centre of the hole on the
   * room face at y = sill). Returns { group, glass, pickMeshes, sillY }.
   */
  function buildWindow(o, isDoor) {
    const kit = new MeshBatcher(`window:${o.id}`);
    const f = kit.frame(new THREE.Matrix4());
    const W = o.width;
    const H = o.height;
    const rd = o.revealDepth;
    const fd = o.frame?.depth ?? 0.07;
    const fw = o.frame?.width ?? 0.07;
    const zF = -rd; // room-side face of the frame
    const zB = -rd - fd; // outside face
    const opening = !isDoor && o.sashes?.some((s) => s.opening);
    let glass = null;
    let glassRect = null;
    const nf = { collide: false };
    const gk = { collide: false, castShadow: false };
    if (isDoor) {
      // karm (jambs + head) around the door leaf; the leaf itself is built on the Door's pivot
      const fk = 0.055;
      f.box(fk, H, fd, -W / 2 + fk / 2, H / 2, (zF + zB) / 2, M.frame, nf);
      f.box(fk, H, fd, W / 2 - fk / 2, H / 2, (zF + zB) / 2, M.frame, nf);
      f.box(W - 2 * fk, fk, fd, 0, H - fk / 2, (zF + zB) / 2, M.frame, nf);
      // aluminium threshold sill under the leaf and the light oak threshold across the reveal floor
      f.box(W, 0.018, fd + 0.03, 0, 0.009, zB + (fd + 0.03) / 2, M.frame, nf);
      f.box(W, 0.012, rd, 0, 0.006, -rd / 2, M.threshold, nf);
    } else if (opening) {
      // top-hung window: outer frame (karm) + sash with a shadow gap and a heavier bottom rail, handle on the rail
      const fk = Math.max(0.025, fw * 0.42);
      const gap = 0.004;
      const fs = Math.max(0.03, fw - fk - gap);
      const fsB = fs + 0.012;
      ring(f, 0, 0, W, H, fk, fk, fk, zB, zF, M.frame, nf);
      ring(f, 0, fk, W - 2 * fk, H - 2 * fk, gap, gap, gap, zB + 0.03, zF - 0.012, M.gasket, gk);
      const sw = W - 2 * fk - 2 * gap;
      const sh = H - 2 * fk - 2 * gap;
      const sy = fk + gap;
      ring(f, 0, sy, sw, sh, fs, fs, fsB, zB + 0.012, zF + 0.002, M.frame, nf);
      ring(f, 0, sy + fsB, sw - 2 * fs, sh - fs - fsB, 0.004, 0.004, 0.004, zB + 0.03, zF - 0.008, M.gasket, gk);
      glassRect = { w: sw - 2 * fs + 0.01, h: sh - fs - fsB + 0.01, y: sy + fsB + (sh - fs - fsB) / 2, z: zF - 0.035 };
      // handle: rose + horizontal lever in the middle of the bottom rail
      const hy = sy + fsB / 2;
      f.box(0.034, 0.07, 0.012, 0, hy + 0.005, zF + 0.008, M.hardware, nf);
      f.box(0.12, 0.018, 0.02, 0.045, hy + 0.012, zF + 0.026, M.hardware, nf);
    } else {
      // fixed glazing: karm + glazing bead, glass set ~4 cm into the frame
      const fk = Math.max(0.03, fw * 0.62);
      const fb = Math.max(0.015, fw - fk);
      ring(f, 0, 0, W, H, fk, fk, fk, zB, zF, M.frame, nf);
      ring(f, 0, fk, W - 2 * fk, H - 2 * fk, fb, fb, fb, zF - 0.034, zF - 0.007, M.frame, nf);
      ring(f, 0, fw, W - 2 * fw, H - 2 * fw, 0.004, 0.004, 0.004, zF - 0.04, zF - 0.032, M.gasket, gk);
      glassRect = { w: W - 2 * fw + 0.01, h: H - 2 * fw + 0.01, y: H / 2, z: zF - 0.04 };
    }
    let sillY = null;
    if (o.sillBoard && !isDoor) {
      const st = o.sillBoard.thickness ?? 0.025;
      const over = o.sillBoard.overhang ?? 0.01;
      const depth = rd + over;
      const g = new THREE.BoxGeometry(W, st, depth);
      f.add(g, M.sill, { matrix: place(0, -st / 2, -rd + depth / 2), collide: false, boxUV: true });
      g.dispose();
      sillY = o.sill;
      // exterior window sill (vannbrett), sloping outward
      exteriorBatch.frame(openingMatrix(o)).box(W, 0.012, 0.075, 0, -0.012, zB - 0.025, M.trim, { rot: [0.14, 0, 0], collide: false, castShadow: false });
    }
    const built = kit.build();
    batchers.push({ geometries: kit.geometries });
    built.name = `window:${o.id}`;
    built.matrixAutoUpdate = false;
    built.matrix.copy(openingMatrix(o));
    const pickMeshes = [];
    built.traverse((m) => {
      if (!m.isMesh) return;
      m.matrixAutoUpdate = false;
      if (m.material !== M.sill) pickMeshes.push(m);
    });
    if (glassRect) {
      glass = new THREE.Mesh(keep(new THREE.PlaneGeometry(glassRect.w, glassRect.h)), M.glass);
      glass.name = `glass:${o.id}`;
      glass.position.set(0, glassRect.y, glassRect.z);
      glass.updateMatrix();
      glass.applyMatrix4(openingMatrix(o));
      glass.castShadow = false;
      glass.receiveShadow = false;
      glass.renderOrder = 2;
      glass.userData.pick = { kind: 'window', windowId: o.id };
    }
    return { group: built, glass, pickMeshes, sillY };
  }

  // ---- doors: the black hall door (opens into the hall) and the glazed terrace door (opens out), both world/Door.js
  const doors = [];
  const doorBatch = newBatch('shell-doors');
  for (const d of layout.doors) {
    const wall = layout.wallsById[d.wallId];
    const isTerrace = d.type === 'terrace-door';
    const hinge = d.hinge === 'to' ? 1 : -1;
    const swing = d.swing === 'in' ? 1 : -1;
    let door;
    const dm = { leaf: M.hallDoor, frame: M.hallDoor, hardware: M.hardware, dark: M.gasket };
    const matrix = basis(d.basis.xAxis, d.basis.yAxis, d.basis.zAxis, d.basis.origin);
    if (isTerrace) {
      const fk = 0.055;
      const lw = d.width - 2 * fk + 0.02; // leaf overlaps the karm by 1 cm on each side
      const lh = d.height - fk + 0.01 - 0.008;
      const depth = d.revealDepth + (d.frame?.depth ?? 0.07); // pivot at the outer face of the karm
      door = new Door(ctx, {
        id: d.id,
        matrix,
        width: lw + 0.076,
        height: lh + 0.046,
        depth,
        materials: dm,
        hingeSide: hinge,
        swing,
        frontLabel: 'Terrassen',
        backLabel: 'Stua',
        threshold: false,
        duration: 0.9,
      });
      replaceLeaf(door, terraceLeaf(d, lw, lh, swing));
    } else {
      const fw = d.frame?.width ?? 0.07;
      const lw = d.leaf?.w ?? d.width - 2 * fw;
      const lh = (d.leaf?.h ?? d.height - fw) - 0.008;
      const depth = wall?.thickness ?? 0.1;
      door = new Door(ctx, {
        id: d.id,
        matrix,
        width: lw + 0.076,
        height: lh + 0.046,
        depth,
        materials: dm,
        hingeSide: hinge,
        swing,
        frontLabel: 'Gangen',
        backLabel: 'Stua',
        threshold: false,
      });
      replaceLeaf(door, hallLeaf(d, lw, lh, swing));
      // karm: black lining of the reveal, 2 cm proud on the room side, door stop on the room side of the leaf
      const f = doorBatch.frame(matrix);
      const z0 = -depth - 0.006;
      const z1 = 0.02;
      const zc = (z0 + z1) / 2;
      const W = d.width;
      const H = d.height;
      f.box(fw, H, z1 - z0, -W / 2 + fw / 2, H / 2, zc, M.hallDoor);
      f.box(fw, H, z1 - z0, W / 2 - fw / 2, H / 2, zc, M.hallDoor);
      f.box(W - 2 * fw, fw, z1 - z0, 0, H - fw / 2, zc, M.hallDoor);
      const stopZ = swing < 0 ? -depth + 0.054 : -0.054;
      f.box(0.012, H - fw, 0.016, -W / 2 + fw + 0.006, (H - fw) / 2, stopZ + 0.008 * Math.sign(-swing), M.hallDoor, { collide: false });
      f.box(0.012, H - fw, 0.016, W / 2 - fw - 0.006, (H - fw) / 2, stopZ + 0.008 * Math.sign(-swing), M.hallDoor, { collide: false });
      f.box(W - 2 * fw, 0.012, 0.016, 0, H - fw - 0.006, stopZ + 0.008 * Math.sign(-swing), M.hallDoor, { collide: false });
      f.box(W - 2 * fw, 0.008, depth, 0, 0.004, -depth / 2, M.threshold, { collide: false });
    }
    if (d.door?.closed === false) door.setOpen(true, { instant: true });
    door.frameGroup?.removeFromParent(); // our own frame replaces the Door's steel one
    group.add(door.root);
    const info = { id: d.id, name: d.name, wallId: d.wallId, width: d.width, height: d.height, type: d.type, door };
    if (isTerrace) {
      const glass = door.root.getObjectByName(`glass:${d.id}`);
      const w = windows.find((x) => x.id === d.id);
      if (glass && w) {
        w.glass.push(glass);
        w.door = door;
        pickables.windows.push(glass);
      }
    }
    doors.push(info);
  }

  /** Swaps the Door's generic leaf meshes for our own geometry (pivot space; collisions/animation stay Door's). */
  function replaceLeaf(door, leafGroup) {
    const leaf = door.leaves[0];
    for (const c of [...leaf.pivot.children]) leaf.pivot.remove(c);
    leaf.pivot.add(leafGroup);
  }

  /** Glazed aluminium leaf of the terrace door (pivot space: x ∈ [−lw, 0], z ∈ [0, 0.05] for swing −1). */
  function terraceLeaf(d, lw, lh, swing) {
    const kit = new MeshBatcher(`leaf:${d.id}`);
    const T = 0.05;
    const z0 = swing < 0 ? 0 : -T;
    const zc = z0 + T / 2;
    const y0 = 0.008;
    const st = 0.075;
    const glassFrom = d.door?.glassFrom ?? 0.25;
    const glassTo = d.door?.glassTo ?? 1.95;
    const bottom = glassFrom - y0;
    const topR = y0 + lh - glassTo;
    const cx = -lw / 2;
    ring(kit, cx, y0, lw, lh, st, topR, bottom, z0, z0 + T, M.frame, { collide: false });
    // glazing beads (room side) + gaskets on both sides
    const gw = lw - 2 * st;
    const gh = glassTo - glassFrom;
    const roomZ = swing < 0 ? z0 + T : z0;
    const out = swing < 0 ? 1 : -1;
    ring(kit, cx, glassFrom, gw, gh, 0.014, 0.014, 0.014, roomZ - out * 0.02, roomZ + out * 0.004, M.frame, { collide: false });
    ring(kit, cx, glassFrom + 0.014, gw - 0.028, gh - 0.028, 0.004, 0.004, 0.004, zc - 0.012, zc + 0.012, M.gasket, { collide: false, castShadow: false });
    // handles: lever on both faces near the free edge, pointing to the hinge side; lock cylinder outside
    const hx = -lw + 0.045;
    const hy = d.door?.handleHeight ?? 1.05;
    for (const side of [1, -1]) {
      const fz = side > 0 ? z0 + T : z0;
      kit.cylinder(0.021, 0.021, 0.012, hx, hy, fz + side * 0.006, M.hardware, { rot: [Math.PI / 2, 0, 0], segments: 18, collide: false });
      kit.cylinder(0.008, 0.008, 0.05, hx, hy, fz + side * 0.03, M.hardware, { rot: [Math.PI / 2, 0, 0], segments: 10, collide: false });
      kit.box(0.13, 0.019, 0.018, hx + 0.058, hy, fz + side * 0.055, M.hardware, { collide: false });
      kit.cylinder(0.015, 0.015, 0.01, hx, hy - 0.09, fz + side * 0.005, M.hardware, { rot: [Math.PI / 2, 0, 0], segments: 14, collide: false });
    }
    const g = kit.build();
    batchers.push({ geometries: kit.geometries });
    const glass = new THREE.Mesh(keep(new THREE.PlaneGeometry(gw - 0.02, gh - 0.02)), M.glass);
    glass.name = `glass:${d.id}`;
    glass.position.set(cx, glassFrom + gh / 2, zc);
    glass.renderOrder = 2;
    glass.castShadow = false;
    glass.userData.pick = { kind: 'window', windowId: d.id };
    g.add(glass);
    return g;
  }

  /** Flat black hall-door leaf with one routed panel groove ~11 cm in, round roses only (no lever). */
  function hallLeaf(d, lw, lh, swing) {
    const kit = new MeshBatcher(`leaf:${d.id}`);
    const T = 0.04;
    const z0 = swing < 0 ? 0.005 : -0.045;
    const y0 = 0.008;
    const cx = -lw / 2;
    kit.box(lw, lh, T, cx, y0 + lh / 2, z0 + T / 2, M.hallDoor, { collide: false });
    const inset = 0.11;
    for (const side of [1, -1]) {
      const fz = side > 0 ? z0 + T + 0.0004 : z0 - 0.0004;
      ring(kit, cx, y0 + inset, lw - 2 * inset, lh - 2 * inset, 0.004, 0.004, 0.004, fz - 0.0003, fz + 0.0003, M.hallDoorGroove, { collide: false, castShadow: false });
      const hx = -lw + 0.07;
      const hy = d.door?.handleHeight ?? 1.08;
      const sz = side > 0 ? z0 + T : z0;
      kit.cylinder(0.025, 0.025, 0.009, hx, hy, sz + side * 0.0045, M.hardware, { rot: [Math.PI / 2, 0, 0], segments: 20, collide: false });
      kit.box(0.008, 0.008, 0.003, hx, hy, sz + side * 0.0095, M.gasket, { collide: false, castShadow: false });
      kit.cylinder(0.018, 0.018, 0.008, hx, hy - 0.085, sz + side * 0.004, M.hardware, { rot: [Math.PI / 2, 0, 0], segments: 18, collide: false });
      kit.box(0.003, 0.01, 0.003, hx, hy - 0.085, sz + side * 0.0085, M.gasket, { collide: false, castShadow: false });
    }
    // hinges on the hinge edge (visible in the hall / when open)
    for (const y of [0.22, lh / 2 + 0.1, lh - 0.22]) kit.cylinder(0.008, 0.008, 0.1, 0.002, y, swing < 0 ? 0.002 : -0.002, M.hardware, { segments: 10, collide: false });
    const g = kit.build();
    batchers.push({ geometries: kit.geometries });
    return g;
  }

  // ---- skirting boards (gulvlist): every wall except openings, the tall-cabinet niche and behind the kitchen
  {
    const bb = layout.baseboard || {};
    const bh = bb.height ?? 0.07;
    const bt = bb.thickness ?? 0.012;
    const prof = [[0, 0], [bt, 0], [bt, bh - 0.004], [bt - 0.004, bh], [0, bh]];
    const kitchenBoxes = layout.kitchen.items.map((k) => k.box);
    const bbBatch = newBatch('shell-baseboards');
    for (let i = 0; i < nW; i++) {
      const w = layout.walls[i];
      if (w.hiddenBehindCabinets) continue;
      const next = layout.walls[(i + 1) % nW];
      const cEnd = cross(w.dir, next.dir);
      const blocked = [];
      for (const o of w.openings) if (o.sill <= 0.05) blocked.push([o.u0, o.u1]);
      for (const box of kitchenBoxes) {
        // a kitchen box standing against this wall hides the skirting
        const corners = [[box.min.x, box.min.z], [box.max.x, box.min.z], [box.min.x, box.max.z], [box.max.x, box.max.z]];
        let dMin = Infinity, u0 = Infinity, u1 = -Infinity;
        for (const [x, z] of corners) {
          const dx = x - w.start.x, dz = z - w.start.y;
          dMin = Math.min(dMin, dx * w.normal.x + dz * w.normal.y);
          const u = dx * w.dir.x + dz * w.dir.y;
          u0 = Math.min(u0, u);
          u1 = Math.max(u1, u);
        }
        if (dMin < 0.06 && dMin > -0.05 && u1 > 0 && u0 < w.length && box.min.y < 0.1) blocked.push([u0, u1]);
      }
      blocked.sort((a, b) => a[0] - b[0]);
      // free intervals (start at 0; a convex end stops short of the next board, a reflex end wraps the corner)
      let s0 = 0;
      const sEnd = cEnd > 1e-6 ? w.length - bt : cEnd < -1e-6 ? w.length + bt : w.length;
      const free = [];
      for (const [a, b] of blocked) {
        if (b <= s0) continue;
        if (a > s0) free.push([s0, Math.min(a, sEnd)]);
        s0 = Math.max(s0, b);
      }
      if (s0 < sEnd) free.push([s0, sEnd]);
      const Mw = wallMatrix(w);
      for (const [a, b] of free) {
        if (b - a < 0.02) continue;
        const g = prismX(prof, a, b);
        bbBatch.add(g, M.baseboard, { matrix: Mw, collide: false, castShadow: false, boxUV: true });
        g.dispose();
      }
    }
  }

  // ---- LED coves, spots, TV-stue ceiling lamp (built-in lights of the shell)
  const builtInLights = [];
  const lightRoot = new THREE.Group();
  lightRoot.name = 'built-in-lights';
  lightRoot.userData.noCollide = true;
  group.add(lightRoot);
  const groupLabel = Object.fromEntries((layout.lightGroups || []).map((g) => [g.id, g.label]));
  const fixBatch = newBatch('shell-fixtures');
  const spotLensGeos = [];
  const spotDefs = [];
  const spotLights = [];
  for (const l of layout.builtInLights) {
    if (l.group === 'kjokken' || l.group === 'overskap') continue; // kitchen.js
    if (l.type === 'led-strip' && l.from && l.to) {
      const strip = ledStrip(l, layout.ceilingHeightAt, fixBatch, M.alu);
      owned.push(strip.mesh.geometry, strip.mesh.material);
      lightRoot.add(strip.mesh);
      builtInLights.push({
        id: l.id,
        group: l.group,
        label: groupLabel[l.group] || l.name,
        type: 'led-strip',
        from: strip.from,
        to: strip.to,
        direction: new THREE.Vector3(0, -1, 0),
        colorK: l.colorK,
        lumens: l.lumens,
        emissiveMeshes: [strip.mesh],
      });
    } else if (l.type === 'spot' && l.position) {
      spotDefs.push(l);
    } else if (l.position && l.type === 'ceiling-ring') {
      const lamp = builtInLamp(l, 'ceiling-ring', {
        dims: { w: l.dims?.w ?? 0.85, d: l.dims?.d ?? 0.55, h: l.dims?.drop ?? 0.1 },
        params: { drop: l.dims?.drop ?? 0.1, rings: l.dims?.rings ?? [0.45, 0.4, 0.3], count: (l.dims?.rings || [1, 1, 1]).length, style: 'multi' },
        colors: { shade: l.color, inner: l.accent || '#f4efe6', base: l.accent || l.color, metal: l.color, cord: l.color },
        materials: { shade: 'black-metal', inner: l.accent ? 'brass' : 'glass-opal', base: l.accent ? 'brass' : 'black-metal', metal: 'black-metal', cord: 'cotton' },
      });
      lightRoot.add(lamp.object);
      builtInLights.push(...lamp.lights.map((x) => ({ ...x, label: groupLabel[l.group] || l.name })));
    }
  }
  // the four adjustable spots in the sloped ceiling in front of the high wall: canopy, knuckle, tilted can, lens
  if (spotDefs.length) {
    const lensMat = keep(emissive(LOOK.led, 3.2));
    for (const l of spotDefs) {
      const r = (l.dims?.d ?? 0.06) / 2;
      const len = l.dims?.l ?? 0.13;
      const p = l.position;
      // downward ceiling normal at the attachment (sloped ceiling)
      const hx = layout.ceilingHeightAt(p.x + 0.05, p.z) - layout.ceilingHeightAt(p.x - 0.05, p.z);
      const hz = layout.ceilingHeightAt(p.x, p.z + 0.05) - layout.ceilingHeightAt(p.x, p.z - 0.05);
      const nDown = new THREE.Vector3(hx / 0.1, -1, hz / 0.1).normalize();
      const dir = (l.direction || new THREE.Vector3(0, -1, 0)).clone().normalize();
      const qCan = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, -1, 0), nDown);
      const canopy = new THREE.Matrix4().compose(p.clone().addScaledVector(nDown, 0.006), qCan, new THREE.Vector3(1, 1, 1));
      fixBatch.add(tmpGeo(new THREE.CylinderGeometry(r * 0.92, r * 0.92, 0.01, low ? 12 : 24)), M.spot, { matrix: canopy, collide: false });
      const knuckle = p.clone().addScaledVector(nDown, 0.018);
      fixBatch.add(tmpGeo(new THREE.SphereGeometry(0.009, 10, 8)), M.spot, { matrix: new THREE.Matrix4().makeTranslation(knuckle.x, knuckle.y, knuckle.z), collide: false });
      const qDir = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir);
      const canStart = knuckle.clone().addScaledVector(dir, 0.008);
      const canCenter = canStart.clone().addScaledVector(dir, len / 2);
      const S1 = new THREE.Vector3(1, 1, 1);
      fixBatch.add(tmpGeo(new THREE.CylinderGeometry(r, r, len, low ? 14 : 28, 1, true)), M.spot, { matrix: new THREE.Matrix4().compose(canCenter, qDir, S1), collide: false });
      // closed top of the can
      fixBatch.add(tmpGeo(new THREE.CircleGeometry(r, low ? 14 : 28).rotateX(-Math.PI / 2).translate(0, len / 2, 0)), M.spot, { matrix: new THREE.Matrix4().compose(canCenter, qDir, S1), collide: false });
      // anti-glare tube inside the mouth and the lens recessed 1 cm
      fixBatch.add(tmpGeo(new THREE.CylinderGeometry(r * 0.86, r * 0.86, 0.012, low ? 12 : 24, 1, true).translate(0, -len / 2 + 0.006, 0)), M.spotInner, { matrix: new THREE.Matrix4().compose(canCenter, qDir, S1), collide: false, castShadow: false });
      const lensPos = canStart.clone().addScaledVector(dir, len - 0.01);
      const lens = new THREE.CircleGeometry(r * 0.8, low ? 12 : 24);
      lens.rotateX(Math.PI / 2); // faces −y
      lens.applyMatrix4(new THREE.Matrix4().compose(lensPos, qDir, S1));
      spotLensGeos.push(lens);
      spotLights.push({ l, lensPos, dir });
    }
    const lensMesh = new THREE.Mesh(keep(mergeGeometries(spotLensGeos, false)), lensMat);
    for (const g of spotLensGeos) g.dispose();
    lensMesh.name = 'spot-lenses';
    lensMesh.castShadow = false;
    lightRoot.add(lensMesh);
    for (const { l, lensPos, dir } of spotLights) {
      builtInLights.push({
        id: l.id,
        group: l.group,
        label: groupLabel[l.group] || l.name,
        type: 'spot',
        position: lensPos.clone(),
        direction: dir.clone(),
        angle: ((l.beamDeg ?? 36) * DEG) / 2,
        penumbra: 0.45,
        colorK: l.colorK,
        lumens: l.lumens,
        emissiveMeshes: [lensMesh],
      });
    }
  }

  /** Disposable temporary geometry for a batcher (the batcher copies it). */
  function tmpGeo(g) {
    tmpGeo.list ??= [];
    tmpGeo.list.push(g);
    return g;
  }

  /**
   * A built-in lamp from the LAMPS models (registry.buildModel) hung at a ceiling point; returns the object and its
   * light entries in world coordinates (§15). Falls back to one point light below the lamp when the model has none.
   */
  function builtInLamp(l, archetype, spec) {
    const object = buildModel({ archetype, ...spec });
    object.name = `built-in:${l.id}`;
    object.position.copy(l.position);
    object.userData.noCollide = true;
    object.userData.builtIn = l.id;
    object.traverse((m) => {
      if (m.isMesh) m.userData.noCollide = true;
    });
    object.updateMatrixWorld(true);
    const ml = object.userData.model?.lights || [];
    const total = ml.reduce((s, x) => s + (x.lumens || 0), 0) || 1;
    const lights = ml.map((x, i) => ({
      id: ml.length > 1 ? `${l.id}:${i}` : l.id,
      group: l.group,
      type: l.type === 'pendant-cylinder' ? 'pendant' : 'ceiling',
      lightType: x.type || 'point',
      position: new THREE.Vector3(...(x.position || [0, -0.1, 0])).applyMatrix4(object.matrixWorld),
      direction: x.direction ? new THREE.Vector3(...x.direction).transformDirection(object.matrixWorld) : new THREE.Vector3(0, -1, 0),
      angle: x.angle,
      penumbra: x.penumbra,
      colorK: l.colorK ?? x.colorK ?? 2700,
      lumens: ((l.lumens || 0) * (x.lumens || 0)) / total || l.lumens,
      emissiveMeshes: x.emissiveMeshes || [],
    }));
    if (!lights.length) {
      lights.push({
        id: l.id,
        group: l.group,
        type: 'ceiling',
        lightType: 'point',
        position: l.position.clone().add(new THREE.Vector3(0, -(spec.params?.drop ?? 0.1) - 0.05, 0)),
        direction: new THREE.Vector3(0, -1, 0),
        colorK: l.colorK ?? 2700,
        lumens: l.lumens,
        emissiveMeshes: [],
      });
    }
    lampObjects.push(object);
    return { object, lights };
  }

  // ---- fixtures: sockets, switches, smoke detectors, sensor, heat pump
  for (const fx of layout.fixtures) {
    const p = fx.position;
    if (fx.type === 'heat-pump') {
      const w = fx.dims.w, h = fx.dims.h, d = fx.dims.d;
      const rot = (fx.rotationDeg ?? 0) * DEG;
      const fm = new THREE.Matrix4().compose(p, new THREE.Quaternion().setFromAxisAngle(UP, rot), new THREE.Vector3(1, 1, 1));
      const f = fixBatch.frame(fm);
      // local: x along the wall, z = front; body rounded toward the front, outlet flap underneath, intake grille on top
      const body = new THREE.Shape();
      body.moveTo(-d / 2, -h / 2 + 0.05);
      body.lineTo(-d / 2, h / 2);
      body.lineTo(d / 2 - 0.03, h / 2);
      body.quadraticCurveTo(d / 2, h / 2, d / 2, h / 2 - 0.04);
      body.lineTo(d / 2, -h / 2 + 0.08);
      body.quadraticCurveTo(d / 2, -h / 2 + 0.02, d / 2 - 0.06, -h / 2);
      body.lineTo(-d / 2 + 0.04, -h / 2);
      body.lineTo(-d / 2, -h / 2 + 0.05);
      const bg = new THREE.ExtrudeGeometry(body, { depth: w, bevelEnabled: false, curveSegments: 6 });
      bg.translate(0, 0, -w / 2);
      bg.rotateY(-Math.PI / 2); // profile (z, y) → extruded along x
      f.add(bg, M.heatPump, { collide: false });
      bg.dispose();
      // front seam line and the louvre slot
      f.box(w - 0.02, 0.003, 0.002, 0, h / 2 - 0.07, d / 2 + 0.0008, M.fixtureDark, { collide: false, castShadow: false });
      f.box(w - 0.12, 0.035, 0.06, 0, -h / 2 + 0.03, d / 2 - 0.07, M.fixtureDark, { collide: false, castShadow: false });
      f.box(w - 0.13, 0.008, 0.07, 0, -h / 2 + 0.018, d / 2 - 0.05, M.heatPump, { rot: [-0.5, 0, 0], collide: false });
      for (let k = 0; k < 18; k++) f.box(0.006, 0.003, d * 0.6, -w / 2 + 0.06 + (k * (w - 0.12)) / 17, h / 2 + 0.0015, -0.01, M.fixtureDark, { collide: false, castShadow: false });
      continue;
    }
    if (fx.mount === 'wall') {
      const n = fx.normal;
      const right = UP.clone().cross(n).normalize();
      const fm = basis(right, UP, n, p);
      const f = fixBatch.frame(fm);
      const w = fx.dims.w ?? 0.084, h = fx.dims.h ?? 0.084;
      if (fx.type === 'socket') {
        const units = Math.max(1, Math.round(w / 0.075));
        f.box(w, h, 0.01, 0, 0, 0.005, M.fixture, { collide: false, castShadow: false });
        for (let k = 0; k < units; k++) {
          const x = -w / 2 + (w / units) * (k + 0.5);
          f.cylinder(0.022, 0.022, 0.004, x, 0, 0.0095, M.fixtureDark, { rot: [Math.PI / 2, 0, 0], segments: 16, collide: false, castShadow: false });
          f.cylinder(0.019, 0.019, 0.004, x, 0, 0.0105, M.fixture, { rot: [Math.PI / 2, 0, 0], segments: 16, collide: false, castShadow: false });
          for (const s of [-1, 1]) f.cylinder(0.0025, 0.0025, 0.002, x + s * 0.0095, 0, 0.0125, M.fixtureDark, { rot: [Math.PI / 2, 0, 0], segments: 6, collide: false, castShadow: false });
        }
      } else {
        const glassy = /glass/i.test(fx.name || '') || w > 0.12;
        f.box(w, h, 0.009, 0, 0, 0.0045, glassy ? M.switchGlass : M.switchPlastic, { collide: false, castShadow: false });
        const rockers = w > 0.12 ? 2 : 1;
        for (let k = 0; k < rockers; k++) {
          const x = -w / 2 + (w / rockers) * (k + 0.5);
          f.box(0.002, h * 0.55, 0.001, x + (w / rockers) * 0.5 - 0.001, 0, 0.0095, M.fixtureDark, { collide: false, castShadow: false });
          f.box(0.012, 0.0015, 0.001, x, -h * 0.28, 0.0095, M.fixtureDark, { collide: false, castShadow: false });
        }
      }
    } else {
      // ceiling devices: smoke detectors and the small sensor (round, black)
      const d = fx.dims.d ?? 0.12, h = fx.dims.h ?? 0.03;
      const y = layout.ceilingHeightAt(p.x, p.z);
      fixBatch.cylinder(d / 2, d / 2 * 0.92, h, p.x, y - h / 2, p.z, M.fixture, { segments: low ? 12 : 24, collide: false });
      fixBatch.cylinder(d / 2 * 0.45, d / 2 * 0.45, 0.004, p.x, y - h - 0.001, p.z, M.fixtureDark, { segments: 16, collide: false, castShadow: false });
    }
  }

  // ---- the hall behind the hall door (small, dim, closed doors to bath and bedroom)
  const hall = buildHall();

  function buildHall() {
    const gd = layout.doors.find((d) => d.type !== 'terrace-door');
    const gw = gd ? layout.wallsById[gd.wallId] : null;
    if (!gw) return null;
    const xBack = gw.start.x - gw.thickness; // hall side face of the wall (3.12)
    const nis = layout.wallsById['w-nisje-side'];
    const z0 = nis ? nis.start.y + nis.thickness : gw.end.y + 0.1;
    const z1 = gw.start.y + 0.1; // a little past the high-wall end of the door
    const x0 = xBack - 1.62;
    const hb = newBatch('shell-hall');
    const T = 0.1;
    const H = 2.4;
    const nisBack = layout.wallsById['w-nisje-bak'];
    const xNiche = nisBack ? nisBack.start.x - nisBack.thickness : x0;
    // walls (boxes behind the hall faces)
    hb.box(xNiche - (x0 - T), H, T, (x0 - T + xNiche) / 2, H / 2, z0 - T / 2, M.back, { boxUV: true });
    hb.box(T, H, z1 - z0 + 2 * T, x0 - T / 2, H / 2, (z0 + z1) / 2, M.back, { boxUV: true });
    hb.box(xBack - x0 + T, H, T, (x0 - T + xBack) / 2, H / 2, z1 + T / 2, M.back, { boxUV: true });
    // ceiling + floor
    const ceil = new THREE.Mesh(keep(new THREE.PlaneGeometry(xBack - x0, z1 - z0).rotateX(Math.PI / 2)), M.back);
    ceil.position.set((x0 + xBack) / 2, H, (z0 + z1) / 2);
    ceil.userData.noCollide = true;
    ceil.receiveShadow = true;
    group.add(ceil);
    pickables.ceilings.push(ceil);
    const fl = new THREE.Mesh(keep(floorGeometry([[x0, z0], [xBack, z0], [xBack, z1], [x0, z1]])), floorM.material);
    fl.receiveShadow = true;
    fl.name = 'hall-floor';
    solid.add(fl);
    // two closed black doors (bath on the far wall, bedroom on the north wall) with frames
    const doorAt = (m, w) => {
      const f = hb.frame(m);
      f.box(w + 0.14, 2.15, 0.02, 0, 1.075, 0.01, M.hallDoor, { collide: false });
      f.box(w, 2.08, 0.012, 0, 1.048, 0.026, M.hallDoor, { collide: false });
      ring(f, 0, 0.12, w - 0.22, 2.08 - 0.23, 0.004, 0.004, 0.004, 0.0322, 0.0328, M.hallDoorGroove, { collide: false, castShadow: false });
      f.cylinder(0.025, 0.025, 0.009, -w / 2 + 0.07, 1.08, 0.036, M.hardware, { rot: [Math.PI / 2, 0, 0], segments: 18, collide: false });
      f.box(0.13, 0.019, 0.018, -w / 2 + 0.07 + 0.055, 1.08, 0.06, M.hardware, { collide: false });
    };
    doorAt(basis(new THREE.Vector3(0, 0, -1), UP, new THREE.Vector3(1, 0, 0), new THREE.Vector3(x0, 0, (z0 + z1) / 2)), 0.83);
    doorAt(basis(new THREE.Vector3(-1, 0, 0), UP, new THREE.Vector3(0, 0, -1), new THREE.Vector3(x0 + 0.65, 0, z1)), 0.83);
    // skirting
    const bt = 0.012, bh = 0.07;
    hb.box(xBack - x0, bh, bt, (x0 + xBack) / 2, bh / 2, z0 + bt / 2, M.baseboard, { collide: false, castShadow: false });
    hb.box(bt, bh, z1 - z0, x0 + bt / 2, bh / 2, (z0 + z1) / 2, M.baseboard, { collide: false, castShadow: false });
    return { x0, x1: xBack, z0, z1 };
  }

  // ---- merge the batches
  for (const b of batchers) {
    if (!(b instanceof MeshBatcher)) continue;
    const g = b.build();
    if (b === fixBatch || b === exteriorBatch) {
      g.userData.noCollide = true;
      deco.add(g);
    } else solid.add(g);
  }
  for (const g of tmpGeo.list || []) g.dispose();

  ctx.collision?.addStatic(solid);
  const bnd = layout.bounds;
  ctx.collision?.setBounds(bnd.minX + 0.05, bnd.maxX - 0.05, bnd.minZ + 0.05, bnd.maxZ - 0.05);

  // ---- the high wall
  const hw = layout.highWall;
  const hwAnchor = new THREE.Group();
  hwAnchor.name = 'high-wall-anchor';
  hwAnchor.userData.noCollide = true;
  hwAnchor.matrixAutoUpdate = false;
  hwAnchor.matrix.copy(basis(hw.uDir, UP, hw.normal, hw.origin));
  group.add(hwAnchor);
  const highWall = {
    wallId: hw.wallId,
    origin: hw.origin.clone(),
    uDir: hw.uDir.clone(),
    normal: hw.normal.clone(),
    width: hw.width,
    height: hw.height,
    anchor: hwAnchor,
  };

  // Walls that continue the plane of the high wall past the hall door (w-gang: above and beside the door up to the
  // corner) follow its paint unless they have a colour of their own – a painter paints the whole plane, and montage H
  // shows the grey-green around the door. Derived from the layout: same line, joined end → start.
  const paintLinks = new Map(); // wallId → wallId it follows
  {
    const hw0 = layout.wallsById[layout.highWall?.wallId];
    let cur = hw0;
    for (let guard = 0; cur && guard < 4; guard++) {
      const nxt = layout.walls.find((w) => w !== cur && w.start.distanceTo(cur.end) < 1e-3 && w.dir.dot(cur.dir) > 0.999);
      if (!nxt || nxt === hw0) break;
      paintLinks.set(nxt.id, hw0.id);
      cur = nxt;
    }
  }
  const ownPaint = new Map(); // wallId → colour set through setPaint (null = room-spec)
  const applyWallPaint = (id) => {
    const wm = wallMeshes.get(id);
    if (!wm) return;
    const link = paintLinks.get(id);
    wm.material = paint(ownPaint.get(id) || (link && ownPaint.get(link)) || layout.wallsById[id].paint);
  };

  /**
   * Paint a wall, a ceiling or a bulkhead: 'sand' | 'marrakesh' | '#hex'; null = the room-spec colour. Painting the
   * high wall also paints the walls that continue its plane (paintLinks) while they have no colour of their own.
   */
  function setPaint(id, color) {
    if (wallMeshes.has(id)) {
      ownPaint.set(id, color || null);
      applyWallPaint(id);
      for (const [k, v] of paintLinks) if (v === id) applyWallPaint(k);
      return;
    }
    const cm = ceilingMeshes.get(id);
    if (cm) {
      cm.material = paint(color || layout.ceilings.find((c) => c.id === id)?.paint || 'sand');
      return;
    }
    const bm = bulkheadMeshes.get(id);
    if (bm) bm.material = paint(color || layout.bulkheads.find((b) => b.id === id)?.paint || 'sand');
  }

  return {
    group,
    walls,
    windows,
    doors,
    highWall,
    hall,
    pickables,
    ceilingHeightAt: layout.ceilingHeightAt,
    builtInLights,
    setPaint,
    update(dt, state) {
      for (const d of doors) d.door?.update(dt, state);
    },
    dispose() {
      for (const d of doors) d.door?.dispose();
      for (const o of lampObjects) disposeObject(o);
      group.removeFromParent();
      for (const b of batchers) for (const g of b.geometries || []) g.dispose();
      for (const o of owned) o.dispose?.();
    },
  };
}

/** Disposes geometries and non-cached materials below root. */
function disposeObject(root) {
  root.traverse((o) => {
    if (o.geometry && !o.geometry.userData?.shared) o.geometry.dispose();
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of mats) if (!m.userData?.cached && !m.userData?.shared) m.dispose();
  });
}

/** Copy of a geometry without its downward faces (non-indexed). */
function withoutDownFaces(geometry) {
  const src = geometry.index ? geometry.toNonIndexed() : geometry;
  const pos = src.attributes.position;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3(), e = new THREE.Vector3();
  const keepTri = [];
  for (let i = 0; i < pos.count; i += 3) {
    a.fromBufferAttribute(pos, i);
    b.fromBufferAttribute(pos, i + 1);
    c.fromBufferAttribute(pos, i + 2);
    n.subVectors(c, b).cross(e.subVectors(a, b)).normalize();
    if (n.y > -0.9) keepTri.push(i);
  }
  const out = new THREE.BufferGeometry();
  for (const [name, attr] of Object.entries(src.attributes)) {
    const s = attr.itemSize;
    const arr = new attr.array.constructor(keepTri.length * 3 * s);
    keepTri.forEach((i, k) => arr.set(attr.array.subarray(i * s, (i + 3) * s), k * 3 * s));
    out.setAttribute(name, new THREE.BufferAttribute(arr, s));
  }
  if (src !== geometry) src.dispose();
  return out;
}

/**
 * LED cove in the ceiling: a light aluminium profile flush with the ceiling and the glowing opal diffuser in it.
 * The housing goes into `batch` (merged); the diffuser is its own mesh (the LightManager dims its material).
 * @returns {{ mesh: THREE.Mesh, from: THREE.Vector3, to: THREE.Vector3 }}
 */
export function ledStrip(l, ceilingHeightAt, batch, housingMat, { housingW = 0.028, diffuserW = null, below = 0 } = {}) {
  const from = l.from.clone();
  const to = l.to.clone();
  const len = from.distanceTo(to);
  const dir = to.clone().sub(from).setY(0).normalize();
  const across = new THREE.Vector3(-dir.z, 0, dir.x);
  const mid = from.clone().add(to).multiplyScalar(0.5);
  let y;
  let tilt = 0;
  if (ceilingHeightAt) {
    y = ceilingHeightAt(mid.x, mid.z);
    const ya = ceilingHeightAt(mid.x + across.x * 0.05, mid.z + across.z * 0.05);
    const yb = ceilingHeightAt(mid.x - across.x * 0.05, mid.z - across.z * 0.05);
    tilt = Math.atan2(ya - yb, 0.1);
  } else y = mid.y;
  y -= below;
  const dw = diffuserW ?? Math.max(0.006, (l.dims?.w ?? 0.02) * 0.75);
  // frame: x along the strip, y = ceiling normal (tilted), z across
  const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(dir, UP, dir.clone().cross(UP)));
  const qt = new THREE.Quaternion().setFromAxisAngle(dir, -tilt);
  q.premultiply(qt);
  const m = new THREE.Matrix4().compose(new THREE.Vector3(mid.x, y, mid.z), q, new THREE.Vector3(1, 1, 1));
  if (batch && housingMat) {
    const hg = new THREE.BoxGeometry(len, 0.005, housingW);
    hg.translate(0, -0.0025, 0);
    batch.add(hg, housingMat, { matrix: m, collide: false, castShadow: false, boxUV: true });
    hg.dispose();
  }
  const g = new THREE.BoxGeometry(len - 0.01, 0.0015, dw);
  g.translate(0, -0.0055, 0);
  g.applyMatrix4(m);
  const mesh = new THREE.Mesh(g, emissive(LOOK.led, 2.8, { color: '#fff6ea' }));
  mesh.name = `led:${l.id}`;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.userData.noCollide = true;
  const sy = y - 0.012;
  return {
    mesh,
    from: new THREE.Vector3(from.x, sy, from.z),
    to: new THREE.Vector3(to.x, sy, to.z),
  };
}
