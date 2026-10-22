import * as THREE from 'three';
import schema from '../data/archetypes.json';
import * as K from './kit.js';
import { mat, emissive, resolveColor } from '../home/materials.js';
import { createCanvas, canvasTexture, heightToNormalCanvas, cached, TileableNoise, clamp } from '../world/proctex.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ART_MOTIFS, ART_MOTIF_OPTIONS, LEGACY_MOTIFS, paintArt, motifOptsKey } from './artmotifs.js';
import {
  artLayout, quantAspect, artResFor, canvasSize, PAPER_WHITE, HANGER_Z, FRAME_OPTIONS, LAYOUT_OPTIONS, DEFAULT_SET_MOTIFS,
  galleryLayout, fitSet, spanRects, packAtlas, atlasUvRect, PPM, ATLAS_MAX,
} from './artlayout.js';
import { ArtCache, ART_BUDGET_PX } from './artcache.js';
import { isImageId } from './artImages.js';
import { customPrintTexture, useCustomTexture, customImageStats, CUSTOM_EDGE_HEX, CUSTOM_MAX_RES } from './artcustom.js';

// where art builders get uploaded pictures from (home/index.js calls it with the ImageStore; design/upload.md §9)
export { setArtImageSource } from './artImages.js';

/**
 * Decor and acoustic products (ARCHITECTURE §5, parts §13): plants, vases (with flowers), art, mirrors, candles,
 * baskets, TV, speakers, slat panels, fabric panels, acoustic art, felt shapes and ceiling absorbers.
 *
 * Every builder follows the model contract: METRE dimensions/UVs, origin per mount (floor/surface: bottom centre;
 * wall: centre of the back face, back in z = 0, object along +z; ceiling: attachment point, hangs along −y), front
 * toward +z, deterministic randomness (K.rng), canonical part names, and userData.model.recolor so SceneSync can
 * recolour without a rebuild (custom materials carry userData.decorRecolor(hex, kind) → material).
 *
 * Shared resources (cached for the page lifetime, never disposed per model – userData.shared):
 *   leaf atlas   one RGBA texture: R = leaf albedo detail, G = pale-vein mask, A = leaf outline (alpha-tested with
 *                coverage-preserving mipmaps) + a vein normal map; FoliageMaterial tints it with the part colour and
 *                vertex colours (gentle per-leaf variation, darker toward the plant centre).
 *   motif art    procedural canvas «paintings»: the six legacy painters of this file (misty-trees, abstract, landscape,
 *                botanical, line-art, photo – never changed) and the motifs of models/artmotifs.js; textures in
 *                ArtCaches (models/artcache.js) that never dispose what a live material samples; gallery-wall atlases;
 *                uploaded pictures through models/artcustom.js. Geometry numbers come from models/artlayout.js.
 *   bark, grille, TV screen materials.
 *
 * Params (all optional – see each Def.params for the Inspector schema):
 *   plant-floor / plant-small: species, potStyle, potD, potH, spread, pedestal {w,d,h,color}, stand {d,h,color}, seed
 *         (no spread / spread ≤ footprint: the leaves are fitted into dims.w × dims.d – catalogue footprints; a spread
 *         wider than the footprint, as the room plants have it, keeps the radial fit to that spread)
 *   vase: shape, flowers ('hydrangea'|'pampas'|'eucalyptus'|'sprig'|null), h, d (vase body when it has flowers),
 *         mat {d, color} (round jute mat under it), seed
 *   art-frame: motif (a legacy key, an artmotifs.js key or 'custom' + imageId), frame (FRAME_PROFILES: none, thin,
 *         black, oak, white, box, floater, alu, ornate, hanger), frameW, mat, matW, matH (over/under, else matW), glass,
 *         texture, seed; hidden: palette, motifOpts, depth (legacy; else dims.d), edge, edgeHex, matColor, imageId,
 *         imageAspect, fit, focus, cord
 *   art-set: layout (LAYOUT_OPTIONS), gap, frame, mat, glass, mirror, seed; hidden: frames (layout 'custom'), motifs,
 *         motif, palette, motifOpts, span, frameW, matW, matH, matColor, texture, edge, rise, overlap
 *   mirror: shape ('round'|'rect'|'organic'|'arch'), frameW, frameDepth, mullions, mullionCols, mullionRows
 *   candle-holder: kind ('lantern'|'tealight'|'candlestick'|'pillar'), count, spacing, glass, lit, candleColor
 *   basket: shape ('cylinder'|'oval'|'rect'|'pedal-bin' (rectangular)|'pedal-bin-round'|'stack'), weave ('rattan'|'rope'|'foam'|'none'),
 *           handles, lidColor (pedal bins)
 *   tv: screen ('off'|'on'), bezel, wallMount   speaker: style ('in-wall'|'box'|'soundbar'), inWall
 *   slat-panel: slatW, slatD, gap, orientation   fabric-panel: edge   acoustic-art: motif, frame, thickness
 *   felt-shape: shape, thickness   ceiling-absorber: shape ('baffle'|'round'|'circle'|'rect'), thickness, drop
 */

// ---------------------------------------------------------------------------------------------------------------
// Small helpers

const TAU = Math.PI * 2;
const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const UPV = Object.freeze(new THREE.Vector3(0, 1, 0));
const lerp = (a, b, t) => a + (b - a) * t;
const num = (v, fb) => (typeof v === 'number' && Number.isFinite(v) ? v : fb);
const QF = { low: 0.55, medium: 1, high: 1.3 };
/** Detail factor of a spec's quality (low 0.55, medium 1, high 1.3). */
const qOf = (spec) => QF[spec?.quality] ?? 1;
/** Segment count scaled by quality. */
const segN = (spec, n, min = 6) => Math.max(min, Math.round(n * (spec?.quality === 'low' ? 0.6 : spec?.quality === 'high' ? 1.25 : 1)));
const atlasRes = (spec) => (spec?.quality === 'low' ? 512 : 1024);
const artRes = (spec) => (spec?.quality === 'low' ? 512 : spec?.quality === 'high' ? 1536 : 1024);

const _c1 = new THREE.Color();
const _c2 = new THREE.Color();
const hexOf = (c, fb = '#9a9a9a') => resolveColor(c, fb);
/** Linear-space mix of two colours → '#rrggbb'. */
function mixHex(a, b, t) {
  _c1.set(hexOf(a));
  _c2.set(hexOf(b));
  return `#${_c1.lerp(_c2, t).getHexString()}`;
}
/** Colour × factor (linear) → '#rrggbb'. */
function scaleHex(a, f) {
  _c1.set(hexOf(a)).multiplyScalar(f);
  return `#${_c1.getHexString()}`;
}

function dirAz(az) {
  return V3(Math.cos(az), 0, Math.sin(az));
}
/** Unit vector at elevation `el` (rad above the horizontal) toward the horizontal unit vector `out`. */
function dirEl(out, el) {
  return V3(out.x * Math.cos(el), Math.sin(el), out.z * Math.cos(el));
}
/** Any unit vector perpendicular to v. */
function perp(v, out = V3()) {
  if (Math.abs(v.y) < 0.9) out.crossVectors(v, UPV);
  else out.set(1, 0, 0).cross(v);
  return out.normalize();
}
function curve(points) {
  return new THREE.CatmullRomCurve3(points.map((p) => p.clone()), false, 'catmullrom', 0.5);
}

// ---------------------------------------------------------------------------------------------------------------
// Geometry: vertex-coloured mesher, bent leaf cards, tapered tubes, revolved surfaces

/** Accumulates positions, UVs and vertex colours (tint multipliers) into one indexed geometry. */
class Mesher {
  constructor() {
    this.pos = [];
    this.uv = [];
    this.col = [];
    this.idx = [];
    this.count = 0;
  }

  v(p, u, v, c) {
    this.pos.push(p.x, p.y, p.z);
    this.uv.push(u, v);
    this.col.push(c[0], c[1], c[2]);
    return this.count++;
  }

  /** Applies a matrix to every vertex added so far (from vertex `from`). */
  transform(m4, from = 0) {
    const p = V3();
    for (let i = from; i < this.count; i++) {
      p.set(this.pos[i * 3], this.pos[i * 3 + 1], this.pos[i * 3 + 2]).applyMatrix4(m4);
      this.pos[i * 3] = p.x;
      this.pos[i * 3 + 1] = p.y;
      this.pos[i * 3 + 2] = p.z;
    }
  }

  get triangles() {
    return this.idx.length / 3;
  }

  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.idx);
    g.computeVertexNormals();
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return g;
  }
}

const _T = V3();
const _N = V3();
const _B = V3();
const _P = V3();
const _Q = V3();
const _O = V3();

/**
 * Adds a bent, folded leaf card (a (cols × seg) grid) to a mesher. The card starts at `base` (minus offset × len),
 * runs along `dir`, its upper face looks along `up` (front face – the FoliageMaterial pales the back face). The atlas
 * cell maps across (u) and along (v, base → tip).
 * @param {Mesher} m
 * @param {object} o  base, dir, up, len, width, cell [u0,v0,u1,v1], seg, cols, bend (rad, tip curls toward −up),
 *                    gravity (pull toward −y along the card), fold (V fold, + = edges up), cup, twist (rad), tint
 *                    [r,g,b] multipliers, baseShade (vertex shade at the base), offset (fraction of len behind base)
 */
function leafCard(m, o) {
  const seg = Math.max(1, o.seg ?? 4);
  const cols = Math.max(1, o.cols ?? 2);
  const T = _T.copy(o.dir).normalize();
  const N = _N.copy(o.up ?? UPV);
  N.addScaledVector(T, -N.dot(T));
  if (N.lengthSq() < 1e-8) perp(T, N);
  N.normalize();
  const B = _B.crossVectors(T, N).normalize();
  const P = _P.copy(o.base).addScaledVector(T, -(o.offset ?? 0) * o.len);
  const [u0, v0, u1, v1] = o.cell;
  const half = o.width / 2;
  const ds = o.len / seg;
  const fold = o.fold ?? 0, cup = o.cup ?? 0;
  const bend = (o.bend ?? 0) / seg, grav = (o.gravity ?? 0) / seg, twist = (o.twist ?? 0) / seg;
  const tint = o.tint ?? [1, 1, 1];
  const bs = o.baseShade ?? 0.82;
  const first = m.count;
  const c = [0, 0, 0];
  for (let j = 0; j <= seg; j++) {
    const t = j / seg;
    const sh = bs + (1 - bs) * Math.min(1, t * 1.6);
    c[0] = tint[0] * sh;
    c[1] = tint[1] * sh;
    c[2] = tint[2] * sh;
    for (let i = 0; i <= cols; i++) {
      const a = (i / cols) * 2 - 1;
      _Q.copy(P).addScaledVector(B, a * half).addScaledVector(N, (fold * Math.abs(a) + cup * a * a) * half);
      m.v(_Q, u0 + ((u1 - u0) * (a + 1)) / 2, v0 + (v1 - v0) * t, c);
    }
    if (j === seg) break;
    P.addScaledVector(T, ds);
    if (bend) {
      const cs = Math.cos(bend), sn = Math.sin(bend);
      _O.copy(T);
      T.multiplyScalar(cs).addScaledVector(N, -sn);
      N.multiplyScalar(cs).addScaledVector(_O, sn);
    }
    if (grav) {
      T.y -= grav;
      T.normalize();
      N.addScaledVector(T, -N.dot(T));
      if (N.lengthSq() < 1e-8) N.crossVectors(B, T);
      N.normalize();
      B.crossVectors(T, N).normalize();
    }
    if (twist) {
      const cs = Math.cos(twist), sn = Math.sin(twist);
      N.multiplyScalar(cs).addScaledVector(B, sn).normalize();
      B.crossVectors(T, N).normalize();
    }
  }
  for (let j = 0; j < seg; j++) {
    for (let i = 0; i < cols; i++) {
      const a = first + j * (cols + 1) + i;
      m.idx.push(a, a + 1, a + cols + 2, a, a + cols + 2, a + cols + 1);
    }
  }
}

/**
 * Smooth tube with a radius tapering from r0 to r1 (stems, canes, trunks). UVs in metres: u along, v around.
 * @param {THREE.Vector3[]} points
 * @param {number} r0 @param {number} r1
 * @param {{ radial?: number, seg?: number }} [o]
 */
function taperTube(points, r0, r1, { radial = 6, seg } = {}) {
  const cv = curve(points);
  const L = cv.getLength();
  const tub = seg ?? Math.max(3, Math.min(40, Math.round(L * 28)));
  const g = new THREE.TubeGeometry(cv, tub, 1, radial, false);
  const pos = g.attributes.position;
  const uv = g.attributes.uv;
  const c = V3();
  for (let i = 0; i <= tub; i++) {
    cv.getPointAt(i / tub, c);
    const r = lerp(r0, r1, i / tub);
    for (let j = 0; j <= radial; j++) {
      const k = i * (radial + 1) + j;
      pos.setXYZ(k, c.x + (pos.getX(k) - c.x) * r, c.y + (pos.getY(k) - c.y) * r, c.z + (pos.getZ(k) - c.z) * r);
      uv.setXY(k, (i / tub) * L, (j / radial) * TAU * r);
    }
  }
  pos.needsUpdate = true;
  g.computeBoundingSphere();
  return g;
}

/**
 * Surface of revolution with an angular modulation: radius = rFn(theta, t) at height t·H (t 0..1). Outer surface
 * only (open top/bottom); UVs in metres (u around at the mean radius, v up).
 * @param {(theta: number, t: number) => number} rFn
 * @param {number} H @param {number} nTheta @param {number} nY
 */
function revolveGeometry(rFn, H, nTheta, nY) {
  const pos = [], uv = [], idx = [];
  let rSum = 0;
  for (let j = 0; j <= nY; j++) rSum += rFn(0, j / nY);
  const rMean = rSum / (nY + 1);
  for (let j = 0; j <= nY; j++) {
    const t = j / nY;
    for (let i = 0; i <= nTheta; i++) {
      const th = (i / nTheta) * TAU;
      const r = rFn(i === nTheta ? 0 : th, t);
      pos.push(r * Math.sin(th), t * H, r * Math.cos(th));
      uv.push(th * rMean, t * H);
    }
  }
  for (let j = 0; j < nY; j++) {
    for (let i = 0; i < nTheta; i++) {
      const a = j * (nTheta + 1) + i;
      const b = a + 1, c = a + nTheta + 2, d = a + nTheta + 1;
      idx.push(a, b, c, a, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  // weld the seam normals
  const n = g.attributes.normal;
  for (let j = 0; j <= nY; j++) {
    const a = j * (nTheta + 1), b = a + nTheta;
    const x = n.getX(a) + n.getX(b), y = n.getY(a) + n.getY(b), z = n.getZ(a) + n.getZ(b);
    const l = Math.hypot(x, y, z) || 1;
    n.setXYZ(a, x / l, y / l, z / l);
    n.setXYZ(b, x / l, y / l, z / l);
  }
  return g;
}

/** Samples a smooth radius profile [[t, r], …] (t 0..1) at n + 1 points → [[r, t], …]. */
function sampleProfile(pts, n) {
  const cv = new THREE.SplineCurve(pts.map(([t, r]) => new THREE.Vector2(t, r)));
  const out = [];
  for (let i = 0; i <= n; i++) {
    const p = cv.getPoint(i / n);
    out.push([Math.max(0.001, p.y), clamp(p.x, 0, 1)]);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Recolouring (SceneSync calls userData.model.recolor(part, hex, kind))

/**
 * Recolour function for a model: cached materials.js materials are swapped for mat(kind, hex, opts); custom
 * materials provide userData.decorRecolor(hex, kind). Returns false (→ rebuild) when a mesh cannot be recoloured.
 * @param {THREE.Group} group
 * @param {{ [part: string]: (kind: string, oldKind: string) => string }} [kindMap]
 * @param {{ [part: string]: (kind: string, oldOpts: object|undefined) => object|undefined }} [optsMap]  mat() options
 *   of a part by its (new) kind – the art frames' fine orange peel must not follow the frame onto wood
 */
function makeRecolor(group, kindMap = {}, optsMap = {}) {
  return (part, hex, kind) => {
    const meshes = group.userData.model?.parts?.[part];
    if (!meshes?.length) return true;
    const swap = new Map();
    for (const m of meshes) {
      const cur = m.material;
      if (!cur || Array.isArray(cur)) return false;
      let next = swap.get(cur);
      if (!next) {
        const ud = cur.userData || {};
        if (ud.decorRecolor) next = ud.decorRecolor(hex, kind);
        else if (ud.cached && ud.kind && ud.kind !== 'paint' && ud.kind !== 'emissive') {
          const k = kindMap[part] ? kindMap[part](kind, ud.kind) : kind || ud.kind;
          next = mat(k, hex || ud.hex, optsMap[part] ? optsMap[part](k, ud.opts) : ud.opts);
        }
        if (!next) return false;
        swap.set(cur, next);
      }
      m.material = next;
    }
    for (const m of meshes) K.setShadows(m, !m.userData.noShadow, true);
    return true;
  };
}

/** finishModel with the decor recolour function. */
function finish(g, o = {}) {
  return K.finishModel(g, { ...o, recolor: makeRecolor(g, o.kindMap, o.optsMap) });
}

// ---------------------------------------------------------------------------------------------------------------
// Leaf atlas: 4 × 4 cells of leaf / flower shapes (Canvas2D), packed as R = albedo detail, G = vein mask, A = alpha

const CELL_LAYOUT = {
  heart: [0, 0, 1, 1], heartVein: [1, 0, 1, 1], monstera: [2, 0, 1, 1], fiddle: [3, 0, 1, 1],
  paddle: [0, 1, 1, 1], lance: [1, 1, 1, 1], round: [2, 1, 1, 1], serrate: [3, 1, 1, 1],
  floret: [0, 2, 1, 1], fern: [1, 2, 1, 1], blade: [2, 2, 1, 1], plume: [3, 2, 1, 2],
  sprig: [0, 3, 1, 1], ovate: [1, 3, 1, 1], leaflet: [2, 3, 1, 1],
};

const gray = (v) => {
  const c = Math.round(clamp(v) * 255);
  return `rgb(${c},${c},${c})`;
};

/** Outline from a half-width function hw(t) (t 0 base → 1 tip; widths in cell units), optional margin jag(t, side). */
function outlinePath(hw, { n = 48, y0 = 0, y1 = 1, jag = null } = {}) {
  const p = new Path2D();
  p.moveTo(0.5, y0);
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    p.lineTo(0.5 + Math.max(0, hw(t) + (jag ? jag(t, 1) : 0)), y0 + (y1 - y0) * t);
  }
  for (let i = n - 1; i >= 1; i--) {
    const t = i / n;
    p.lineTo(0.5 - Math.max(0, hw(t) + (jag ? jag(t, -1) : 0)), y0 + (y1 - y0) * t);
  }
  p.closePath();
  return p;
}

function strokePts(c, pts, w, style) {
  if (pts.length < 2) return;
  c.strokeStyle = style;
  c.lineWidth = w;
  c.lineCap = 'round';
  c.lineJoin = 'round';
  c.beginPath();
  c.moveTo(pts[0][0], pts[0][1]);
  if (pts.length === 2) c.lineTo(pts[1][0], pts[1][1]);
  else {
    for (let i = 1; i < pts.length - 1; i++) {
      const mx = (pts[i][0] + pts[i + 1][0]) / 2, my = (pts[i][1] + pts[i + 1][1]) / 2;
      c.quadraticCurveTo(pts[i][0], pts[i][1], mx, my);
    }
    const l = pts[pts.length - 1];
    c.lineTo(l[0], l[1]);
  }
  c.stroke();
}

/**
 * Paints one leaf into a layer. o: path, veins [{ pts, w, lum?, mask?, depth? }], cuts [{ pts, w }], holes [{ x, y,
 * rx, ry, rot }], lum (blade), edge (margin tone), veinLum, mottle.
 */
function paintLeaf(c, L, R, o) {
  if (L === 'a') {
    c.fillStyle = '#fff';
    c.fill(o.path);
    for (const k of o.cuts || []) strokePts(c, k.pts, k.w, '#000');
    c.fillStyle = '#000';
    for (const h of o.holes || []) {
      c.beginPath();
      c.ellipse(h.x, h.y, h.rx, h.ry, h.rot || 0, 0, TAU);
      c.fill();
    }
    return;
  }
  if (L === 'l') {
    c.fillStyle = gray(o.lum);
    c.fillRect(-0.05, -0.05, 1.1, 2.1);
    c.save();
    c.clip(o.path);
    // darker margin, lighter centre
    c.strokeStyle = gray(o.edge ?? o.lum * 0.88);
    c.lineWidth = 0.07;
    c.globalAlpha = 0.6;
    c.stroke(o.path);
    c.lineWidth = 0.025;
    c.globalAlpha = 0.8;
    c.stroke(o.path);
    c.globalAlpha = 1;
    // mottling
    const mot = o.mottle ?? 0.06;
    for (let i = 0; i < 70; i++) {
      c.globalAlpha = 0.25;
      c.fillStyle = gray(o.lum + R.range(-mot, mot));
      c.beginPath();
      c.ellipse(R(), R() * (o.aspect ?? 1), R.range(0.02, 0.08), R.range(0.01, 0.05), R() * TAU, 0, TAU);
      c.fill();
    }
    c.globalAlpha = 1;
    for (const v of o.veins || []) strokePts(c, v.pts, v.w, gray(v.lum ?? o.veinLum ?? o.lum * 1.15));
    c.restore();
    return;
  }
  if (L === 'v') {
    for (const v of o.veins || []) if (v.mask) strokePts(c, v.pts, v.w, gray(v.mask));
    return;
  }
  // height: veins are grooves, the blade bulges a little between them
  c.save();
  c.clip(o.path);
  c.fillStyle = gray(0.55);
  c.fillRect(-0.05, -0.05, 1.1, 2.1);
  for (const v of o.veins || []) strokePts(c, v.pts, v.w * 1.4, gray(0.55 - (v.depth ?? 0.12)));
  c.restore();
}

/** Lateral veins from the midrib (x 0.5) at t → toward the margin, n per side. */
function laterals(n, hw, { t0 = 0.12, t1 = 0.85, rise = 0.12, reach = 0.85, w = 0.01, lum, mask = 0, depth = 0.1, both = true } = {}) {
  const out = [];
  for (let k = 0; k < n; k++) {
    const t = t0 + ((t1 - t0) * k) / Math.max(1, n - 1);
    for (const s of both ? [-1, 1] : [1]) {
      const x = hw(Math.min(1, t + rise)) * reach;
      out.push({ pts: [[0.5 + s * 0.018, t + 0.01], [0.5 + s * x * 0.55, t + rise * 0.55], [0.5 + s * x, t + rise]], w, lum, mask, depth });
    }
  }
  return out;
}

const heartHW = (lw) => (t) => lw * Math.pow(Math.sin(Math.PI * Math.min(1, 0.18 + t * 0.85)), 0.85);

function heartPath(lw) {
  const p = new Path2D();
  p.moveTo(0.5, 0.1);
  p.bezierCurveTo(0.42, -0.01, 0.5 - lw, -0.02, 0.5 - lw - 0.005, 0.2);
  p.bezierCurveTo(0.5 - lw, 0.45, 0.3, 0.74, 0.5, 0.995);
  p.bezierCurveTo(0.7, 0.74, 0.5 + lw, 0.45, 0.5 + lw + 0.005, 0.2);
  p.bezierCurveTo(0.5 + lw, -0.02, 0.58, -0.01, 0.5, 0.1);
  p.closePath();
  return p;
}

const CELL_PAINTERS = {
  heart(c, L, R) {
    const hw = heartHW(0.44);
    const veins = [{ pts: [[0.5, 0.1], [0.5, 0.55], [0.5, 0.97]], w: 0.016, lum: 0.86, mask: 0.18, depth: 0.14 }];
    for (const s of [-1, 1]) {
      veins.push({ pts: [[0.5, 0.1], [0.5 + s * 0.3, 0.12], [0.5 + s * 0.36, 0.3], [0.5 + s * 0.2, 0.7]], w: 0.008, lum: 0.82, depth: 0.08 });
      for (let k = 0; k < 4; k++) {
        const t = 0.22 + k * 0.15;
        veins.push({ pts: [[0.5, t], [0.5 + s * hw(t) * 0.5, t + 0.08], [0.5 + s * hw(t + 0.15) * 0.8, t + 0.2]], w: 0.007, lum: 0.81, depth: 0.08 });
      }
    }
    paintLeaf(c, L, R, { path: heartPath(0.44), veins, lum: 0.72, mottle: 0.07 });
  },
  heartVein(c, L, R) {
    // satin / velvet anthurium: dark blade, broad pale veins
    const veins = [{ pts: [[0.5, 0.1], [0.5, 0.55], [0.5, 0.97]], w: 0.03, lum: 0.95, mask: 0.95, depth: 0.16 }];
    for (const s of [-1, 1]) {
      veins.push({ pts: [[0.5, 0.1], [0.5 + s * 0.28, 0.16], [0.5 + s * 0.33, 0.42], [0.5 + s * 0.2, 0.75], [0.5, 0.97]], w: 0.022, lum: 0.92, mask: 0.9, depth: 0.15 });
      veins.push({ pts: [[0.5, 0.1], [0.5 + s * 0.4, 0.1], [0.5 + s * 0.42, 0.25], [0.5 + s * 0.36, 0.45]], w: 0.016, lum: 0.9, mask: 0.82, depth: 0.12 });
      for (let k = 0; k < 4; k++) {
        const t = 0.25 + k * 0.15;
        veins.push({ pts: [[0.5, t], [0.5 + s * 0.12, t + 0.03], [0.5 + s * 0.26 * (1 - k * 0.15), t + 0.08]], w: 0.011, lum: 0.88, mask: 0.7, depth: 0.1 });
      }
    }
    paintLeaf(c, L, R, { path: heartPath(0.47), veins, lum: 0.62, edge: 0.6, mottle: 0.05 });
  },
  monstera(c, L, R) {
    const hw = (t) => 0.47 * Math.pow(Math.sin(Math.PI * (0.1 + 0.9 * t)), 0.6);
    const p = new Path2D();
    p.moveTo(0.5, 0.12);
    p.bezierCurveTo(0.42, -0.01, 0.04, -0.02, 0.03, 0.3);
    p.bezierCurveTo(0.01, 0.62, 0.22, 0.9, 0.5, 0.995);
    p.bezierCurveTo(0.78, 0.9, 0.99, 0.62, 0.97, 0.3);
    p.bezierCurveTo(0.96, -0.02, 0.58, -0.01, 0.5, 0.12);
    p.closePath();
    const cuts = [], holes = [];
    const veins = [{ pts: [[0.5, 0.12], [0.5, 0.55], [0.5, 0.96]], w: 0.024, lum: 0.86, mask: 0.15, depth: 0.15 }];
    for (const s of [-1, 1]) {
      for (let k = 0; k < 6; k++) {
        const t = 0.2 + k * 0.125 + R.range(-0.015, 0.015);
        const xm = 0.5 + s * (hw(t) + 0.08);
        const xi = 0.5 + s * R.range(0.12, 0.17);
        if (k < 5) cuts.push({ pts: [[xm, t + 0.03], [0.5 + s * 0.3, t], [xi, t - 0.05]], w: R.range(0.022, 0.034) });
        if (k > 0 && k < 5) holes.push({ x: 0.5 + s * R.range(0.15, 0.2), y: t - 0.06, rx: R.range(0.022, 0.035), ry: R.range(0.012, 0.018), rot: s * 0.5 });
        const tv = t - 0.055;
        veins.push({ pts: [[0.5, tv - 0.04], [0.5 + s * 0.2, tv - 0.01], [0.5 + s * hw(tv) * 0.95, tv + 0.05]], w: 0.009, lum: 0.82, depth: 0.08 });
      }
    }
    paintLeaf(c, L, R, { path: p, veins, cuts, holes, lum: 0.7, mottle: 0.05 });
  },
  fiddle(c, L, R) {
    const hw = (t) => (0.07 + 0.41 * Math.pow(Math.sin(Math.PI * Math.min(1, t * 0.97 + 0.02)), 0.45) * (0.5 + 0.5 * t)) - 0.035 * Math.exp(-(((t - 0.5) / 0.12) ** 2));
    const jag = (t, s) => 0.009 * Math.sin(t * 13 + (s > 0 ? 0 : 1.7));
    const veins = [{ pts: [[0.5, 0.0], [0.5, 0.5], [0.5, 0.95]], w: 0.03, lum: 0.94, mask: 0.3, depth: 0.16 }, ...laterals(9, hw, { t0: 0.1, t1: 0.86, rise: 0.11, reach: 0.9, w: 0.011, lum: 0.86, mask: 0.12, depth: 0.12 })];
    paintLeaf(c, L, R, { path: outlinePath(hw, { y0: 0.0, y1: 0.995, jag }), veins, lum: 0.64, mottle: 0.05 });
  },
  paddle(c, L, R) {
    const hw = (t) => 0.42 * Math.pow(Math.sin(Math.PI * (0.03 + 0.95 * t)), 0.5) * (t < 0.1 ? 0.45 + 5.5 * t : 1);
    const cuts = [];
    for (let k = 0; k < 3; k++) {
      const s = k % 2 ? 1 : -1, t = R.range(0.3, 0.85);
      const x = hw(t);
      cuts.push({ pts: [[0.5 + s * (x + 0.06), t + 0.07], [0.5 + s * x * R.range(0.45, 0.7), t + 0.01]], w: 0.005 });
    }
    const veins = [{ pts: [[0.5, 0], [0.5, 0.5], [0.5, 0.99]], w: 0.045, lum: 0.9, mask: 0.35, depth: 0.12 }];
    for (let t = 0.06; t < 0.95; t += 0.03) {
      for (const s of [-1, 1]) veins.push({ pts: [[0.5 + s * 0.026, t + 0.004], [0.5 + s * hw(t + 0.08) * 0.97, t + 0.08]], w: 0.004, lum: 0.8, depth: 0.05 });
    }
    paintLeaf(c, L, R, { path: outlinePath(hw, { y0: 0, y1: 1 }), veins, cuts, lum: 0.7, mottle: 0.05 });
  },
  lance(c, L, R) {
    const hw = (t) => 0.46 * Math.pow(Math.sin(Math.PI * t), 0.7) * (1 - 0.3 * t);
    paintLeaf(c, L, R, { path: outlinePath(hw), veins: [{ pts: [[0.5, 0], [0.5, 0.98]], w: 0.03, lum: 0.86, mask: 0.12, depth: 0.1 }], lum: 0.74, mottle: 0.05 });
  },
  leaflet(c, L, R) {
    const hw = (t) => 0.47 * Math.pow(Math.sin(Math.PI * Math.min(1, t)), 0.45) * (1 - 0.55 * t * t);
    const veins = [{ pts: [[0.5, 0], [0.5, 1]], w: 0.06, lum: 0.86, mask: 0.1, depth: 0.16 }];
    for (const x of [0.3, 0.7]) veins.push({ pts: [[x, 0.05], [x + (0.5 - x) * 0.4, 0.6], [0.5, 0.98]], w: 0.012, lum: 0.78, depth: 0.05 });
    paintLeaf(c, L, R, { path: outlinePath(hw), veins, lum: 0.74, mottle: 0.04 });
  },
  round(c, L, R) {
    const hw = (t) => 0.48 * Math.sqrt(Math.max(0, 1 - (2 * t - 1) ** 2)) * (t < 0.08 ? 0.6 + t * 5 : 1);
    paintLeaf(c, L, R, { path: outlinePath(hw, { y0: 0.02, y1: 0.99 }), veins: [{ pts: [[0.5, 0.02], [0.5, 0.75]], w: 0.012, lum: 0.88, depth: 0.05 }, ...laterals(4, hw, { t0: 0.15, t1: 0.65, rise: 0.15, reach: 0.7, w: 0.006, lum: 0.86, depth: 0.04 })], lum: 0.8, mottle: 0.05 });
  },
  serrate(c, L, R) {
    const hw = (t) => 0.42 * Math.pow(Math.sin(Math.PI * Math.pow(t, 0.8)), 0.8);
    const jag = (t) => (t > 0.15 && t < 0.95 ? 0.016 * ((t * 26) % 1) : 0);
    const veins = [{ pts: [[0.5, 0], [0.5, 0.97]], w: 0.022, lum: 0.88, mask: 0.15, depth: 0.14 }, ...laterals(7, hw, { t0: 0.1, t1: 0.8, rise: 0.12, reach: 0.9, w: 0.009, lum: 0.84, depth: 0.12 })];
    paintLeaf(c, L, R, { path: outlinePath(hw, { jag }), veins, lum: 0.72, mottle: 0.06 });
  },
  ovate(c, L, R) {
    const hw = (t) => 0.45 * Math.pow(Math.sin(Math.PI * Math.pow(t, 0.85)), 0.75);
    paintLeaf(c, L, R, { path: outlinePath(hw), veins: [{ pts: [[0.5, 0], [0.5, 0.97]], w: 0.02, lum: 0.88, mask: 0.12, depth: 0.12 }, ...laterals(6, hw, { t0: 0.12, t1: 0.78, rise: 0.12, reach: 0.85, w: 0.008, lum: 0.84, depth: 0.1 })], lum: 0.74, mottle: 0.06 });
  },
  blade(c, L, R) {
    const hw = (t) => 0.45 * (1 - Math.pow(t, 2.2)) * Math.min(1, t * 10 + 0.4);
    const veins = [{ pts: [[0.5, 0], [0.5, 1]], w: 0.05, lum: 0.86, depth: 0.12 }];
    for (const x of [0.25, 0.75]) veins.push({ pts: [[x, 0.02], [x + (0.5 - x) * 0.5, 0.6], [0.5, 0.99]], w: 0.015, lum: 0.8, depth: 0.06 });
    paintLeaf(c, L, R, { path: outlinePath(hw), veins, lum: 0.75, mottle: 0.04 });
  },
  floret(c, L, R) {
    // hydrangea floret: four broad sepals around a small dark eye
    const petals = [];
    const a0 = R.range(0, 0.4);
    for (let k = 0; k < 4; k++) {
      const a = a0 + (k * Math.PI) / 2 + R.range(-0.12, 0.12);
      petals.push({ x: 0.5 + Math.cos(a) * 0.215, y: 0.5 + Math.sin(a) * 0.215, rx: 0.205, ry: 0.175, rot: a });
    }
    if (L === 'a') {
      c.fillStyle = '#fff';
      for (const p of petals) {
        c.beginPath();
        c.ellipse(p.x, p.y, p.rx, p.ry, p.rot, 0, TAU);
        c.fill();
      }
      return;
    }
    if (L === 'l') {
      c.fillStyle = gray(0.86);
      c.fillRect(-0.05, -0.05, 1.1, 1.1);
      for (const p of petals) {
        const g = c.createRadialGradient(0.5, 0.5, 0.02, 0.5, 0.5, 0.45);
        g.addColorStop(0, gray(0.66));
        g.addColorStop(0.45, gray(0.9));
        g.addColorStop(1, gray(0.97));
        c.fillStyle = g;
        c.beginPath();
        c.ellipse(p.x, p.y, p.rx, p.ry, p.rot, 0, TAU);
        c.fill();
        c.strokeStyle = gray(0.8);
        c.lineWidth = 0.012;
        c.stroke();
      }
      c.fillStyle = gray(0.45);
      c.beginPath();
      c.arc(0.5, 0.5, 0.045, 0, TAU);
      c.fill();
      return;
    }
    if (L === 'h') {
      for (const p of petals) {
        c.fillStyle = gray(0.62);
        c.beginPath();
        c.ellipse(p.x, p.y, p.rx * 0.9, p.ry * 0.85, p.rot, 0, TAU);
        c.fill();
      }
    }
  },
  fern(c, L, R) {
    // asparagus fern frond: rachis with feathery side branchlets
    const strokes = [];
    strokes.push({ pts: [[0.5, 0], [0.49, 0.5], [0.5, 0.98]], w: 0.012, lum: 0.7 });
    for (let y = 0.04; y < 0.96; y += 0.032) {
      for (const s of [-1, 1]) {
        const len = 0.44 * (1 - y * 0.8) * R.range(0.8, 1.05);
        const ang = R.range(0.85, 1.05);
        const ex = 0.5 + s * Math.sin(ang) * len, ey = y + Math.cos(ang) * len;
        strokes.push({ pts: [[0.5, y], [ex, ey]], w: 0.006, lum: R.range(0.72, 0.86) });
        for (let k = 1; k <= 6; k++) {
          const f = k / 7;
          const px = 0.5 + (ex - 0.5) * f, py = y + (ey - y) * f;
          for (const s2 of [-1, 1]) strokes.push({ pts: [[px, py], [px + s * 0.03 * (1 - f * 0.5) + s2 * 0.018, py + 0.035 * (1 - f * 0.3)]], w: 0.007, lum: R.range(0.7, 0.92) });
        }
      }
    }
    if (L === 'a') for (const s of strokes) strokePts(c, s.pts, s.w * 1.25, '#fff');
    else if (L === 'l') {
      c.fillStyle = gray(0.78);
      c.fillRect(-0.05, -0.05, 1.1, 1.1);
      for (const s of strokes) strokePts(c, s.pts, s.w * 1.25, gray(s.lum));
    }
  },
  sprig(c, L, R) {
    // rosemary-like twig: dense narrow needles along a stem
    const strokes = [{ pts: [[0.5, 0], [0.5, 0.99]], w: 0.02, lum: 0.62 }];
    for (let y = 0.03; y < 0.97; y += 0.022) {
      const s = R.sign();
      const len = R.range(0.14, 0.24) * (1 - y * 0.35);
      const a = R.range(0.5, 0.9);
      strokes.push({ pts: [[0.5, y], [0.5 + s * Math.sin(a) * len, y + Math.cos(a) * len]], w: 0.03, lum: R.range(0.72, 0.9) });
    }
    if (L === 'a') for (const s of strokes) strokePts(c, s.pts, s.w, '#fff');
    else if (L === 'l') {
      c.fillStyle = gray(0.78);
      c.fillRect(-0.05, -0.05, 1.1, 1.1);
      for (const s of strokes) strokePts(c, s.pts, s.w, gray(s.lum));
    } else if (L === 'h') for (const s of strokes) strokePts(c, s.pts, s.w * 0.6, gray(0.62));
  },
  plume(c, L, R, { aspect }) {
    // pampas plume: hundreds of silky strands leaning toward the tip
    const top = aspect;
    const env = (y) => 0.47 * Math.pow(Math.sin(Math.PI * clamp((y - 0.04) / (top - 0.06))), 0.75);
    const strands = [];
    const n = 900;
    for (let i = 0; i < n; i++) {
      const y = 0.06 + R() * (top - 0.12);
      const s = R.sign();
      const len = env(y) * R.range(0.55, 1.08);
      const lean = R.range(0.35, 0.75);
      const ex = 0.5 + s * len * Math.cos(lean), ey = y + len * Math.sin(lean) * 1.25;
      strands.push({ pts: [[0.5 + s * 0.01, y], [0.5 + s * len * 0.45, y + len * 0.4], [ex, ey]], w: R.range(0.005, 0.011), lum: R.range(0.78, 1.0) });
    }
    if (L === 'a') {
      c.fillStyle = '#fff';
      c.beginPath();
      for (let i = 0; i <= 40; i++) {
        const y = 0.05 + ((top - 0.1) * i) / 40;
        c.lineTo(0.5 + env(y) * 0.38, y + 0.03);
      }
      for (let i = 40; i >= 0; i--) {
        const y = 0.05 + ((top - 0.1) * i) / 40;
        c.lineTo(0.5 - env(y) * 0.38, y + 0.03);
      }
      c.fill();
      for (const s of strands) strokePts(c, s.pts, s.w, '#fff');
    } else if (L === 'l') {
      c.fillStyle = gray(0.86);
      c.fillRect(-0.05, -0.05, 1.1, top + 0.1);
      for (const s of strands) strokePts(c, s.pts, s.w, gray(s.lum));
      strokePts(c, [[0.5, 0], [0.5, top * 0.9]], 0.012, gray(0.62));
    } else if (L === 'h') {
      for (const s of strands) strokePts(c, s.pts, s.w, gray(0.5 + R.range(0, 0.15)));
    }
  },
};

/**
 * Alpha histogram of a rect of an RGBA mip level, as a coverage function: cov(s) = fraction of texels with
 * alpha · s ≥ ref (one pass over the texels, then O(1) per query – the coverage search below asks ~9 times per cell).
 */
function coverageFn(d, size, r, ref = 127.5) {
  const hist = new Uint32Array(257);
  for (let y = r[1]; y < r[1] + r[3]; y++) {
    for (let x = r[0], i = (y * size + x) * 4 + 3; x < r[0] + r[2]; x++, i += 4) hist[d[i]]++;
  }
  const n = r[2] * r[3];
  for (let a = 254; a >= 0; a--) hist[a] += hist[a + 1]; // hist[a] = texels with alpha ≥ a
  return (s) => (n ? hist[Math.min(256, Math.max(0, Math.ceil(ref / s - 1e-9)))] / n : 0);
}

/** Mip chain with the alpha-test coverage of every cell preserved (leaves do not thin out with distance). */
function buildMips(base, S, rects) {
  const levels = [{ data: base, width: S, height: S }];
  const target = rects.map((r) => coverageFn(base, S, r)(1));
  let raw = base, size = S, scale = 1;
  while (size > 1) {
    const ns = size >> 1;
    scale *= 2;
    const out = new Uint8Array(ns * ns * 4);
    for (let y = 0; y < ns; y++) {
      for (let x = 0; x < ns; x++) {
        const o = (y * ns + x) * 4, a = (2 * y * size + 2 * x) * 4, b = a + 4, c = a + size * 4, d = c + 4;
        for (let k = 0; k < 4; k++) out[o + k] = (raw[a + k] + raw[b + k] + raw[c + k] + raw[d + k] + 2) >> 2;
      }
    }
    const boosted = out.slice();
    rects.forEach((r, ci) => {
      const rr = [Math.floor(r[0] / scale), Math.floor(r[1] / scale), Math.floor(r[2] / scale), Math.floor(r[3] / scale)];
      if (rr[2] < 2 || rr[3] < 2) return;
      const cov = coverageFn(out, ns, rr);
      if (cov(1) >= target[ci]) return;
      let lo = 1, hi = 4;
      for (let it = 0; it < 8; it++) {
        const mid = (lo + hi) / 2;
        if (cov(mid) < target[ci]) lo = mid;
        else hi = mid;
      }
      for (let y = rr[1]; y < rr[1] + rr[3]; y++) {
        for (let x = rr[0]; x < rr[0] + rr[2]; x++) {
          const i = (y * ns + x) * 4 + 3;
          boosted[i] = Math.min(255, Math.round(out[i] * hi));
        }
      }
    });
    levels.push({ data: boosted, width: ns, height: ns });
    raw = out;
    size = ns;
  }
  return levels;
}

function buildLeafAtlas(S) {
  const cellPx = S / 4;
  const pad = Math.max(2, Math.round(cellPx / 48));
  const layers = ['a', 'l', 'v', 'h'];
  const ctx = {};
  for (const L of layers) {
    const cv = createCanvas(S, S);
    const c = cv.getContext('2d', { willReadFrequently: true });
    c.fillStyle = L === 'l' ? gray(0.74) : L === 'h' ? gray(0.55) : '#000';
    c.fillRect(0, 0, S, S);
    ctx[L] = c;
  }
  const cells = {};
  const rects = [];
  for (const [name, [col, row, cw, ch]] of Object.entries(CELL_LAYOUT)) {
    const x0 = col * cellPx + pad, y0 = row * cellPx + pad;
    const wpx = cw * cellPx - 2 * pad, hpx = ch * cellPx - 2 * pad;
    cells[name] = [x0 / S, y0 / S, (x0 + wpx) / S, (y0 + hpx) / S];
    rects.push([col * cellPx, row * cellPx, cw * cellPx, ch * cellPx]);
    for (const L of layers) {
      const c = ctx[L];
      c.save();
      c.beginPath();
      c.rect(x0 - pad + 1, y0 - pad + 1, wpx + 2 * pad - 2, hpx + 2 * pad - 2);
      c.clip();
      c.setTransform(wpx, 0, 0, wpx, x0, y0);
      CELL_PAINTERS[name](c, L, K.rng(`cell:${name}`), { aspect: hpx / wpx });
      c.restore();
    }
  }
  const A = ctx.a.getImageData(0, 0, S, S).data;
  const Lm = ctx.l.getImageData(0, 0, S, S).data;
  const Vn = ctx.v.getImageData(0, 0, S, S).data;
  const Hh = ctx.h.getImageData(0, 0, S, S).data;
  const data = new Uint8Array(S * S * 4);
  const nrm = new Uint8Array(S * S * 4);
  for (let i = 0; i < S * S; i++) {
    data[i * 4] = Lm[i * 4];
    data[i * 4 + 1] = Vn[i * 4];
    data[i * 4 + 2] = 0;
    data[i * 4 + 3] = A[i * 4];
  }
  // tangent-space normals from the height layer (rows = +v because the texture is not flipped); clamped edges
  const k = ((2.2 * S) / 1024) * (8 / 255);
  for (let y = 0; y < S; y++) {
    const row = y * S, up = (y > 0 ? y - 1 : 0) * S, dn = (y < S - 1 ? y + 1 : S - 1) * S;
    for (let x = 0; x < S; x++) {
      const xl = x > 0 ? x - 1 : 0, xr = x < S - 1 ? x + 1 : S - 1;
      const nx = -(Hh[(row + xr) * 4] - Hh[(row + xl) * 4]) * k, ny = -(Hh[(dn + x) * 4] - Hh[(up + x) * 4]) * k;
      const f = 127.5 / Math.sqrt(nx * nx + ny * ny + 1);
      const o = (row + x) * 4;
      nrm[o] = nx * f + 127.5;
      nrm[o + 1] = ny * f + 127.5;
      nrm[o + 2] = f + 127.5;
      nrm[o + 3] = 255;
    }
  }
  const map = new THREE.DataTexture(data, S, S, THREE.RGBAFormat, THREE.UnsignedByteType);
  map.mipmaps = buildMips(data, S, rects);
  map.generateMipmaps = false;
  map.minFilter = THREE.LinearMipmapLinearFilter;
  map.magFilter = THREE.LinearFilter;
  map.colorSpace = THREE.NoColorSpace;
  map.flipY = false;
  map.anisotropy = 4;
  map.needsUpdate = true;
  const normalMap = new THREE.DataTexture(nrm, S, S, THREE.RGBAFormat, THREE.UnsignedByteType);
  normalMap.generateMipmaps = true;
  normalMap.minFilter = THREE.LinearMipmapLinearFilter;
  normalMap.magFilter = THREE.LinearFilter;
  normalMap.colorSpace = THREE.NoColorSpace;
  normalMap.flipY = false;
  normalMap.needsUpdate = true;
  return { map, normalMap, cells, size: S };
}

/** The shared leaf atlas ({ map, normalMap, cells }) at a resolution (generated once). */
function leafAtlas(res) {
  return cached(`decor:leafAtlas:${res}`, () => buildLeafAtlas(res));
}

/**
 * Standard material for foliage: the atlas R channel scales the colour (× lumGain so the mean albedo ≈ colour), G
 * mixes toward the vein colour, vertex colours tint each leaf, and back faces turn toward a paler underside colour.
 * Alpha-tested (alpha to coverage with MSAA), double-sided, casts leaf-shaped shadows.
 */
class FoliageMaterial extends THREE.MeshStandardMaterial {
  constructor(params) {
    super();
    this.veinColor = new THREE.Color('#e2ead2');
    this.backColor = new THREE.Color('#b8c49a');
    this.backMix = 0.3;
    this.lumGain = 1.32;
    this.setValues(params);
  }

  copy(src) {
    super.copy(src);
    if (src.veinColor) this.veinColor.copy(src.veinColor);
    if (src.backColor) this.backColor.copy(src.backColor);
    this.backMix = src.backMix ?? this.backMix;
    this.lumGain = src.lumGain ?? this.lumGain;
    return this;
  }

  onBeforeCompile(shader) {
    shader.uniforms.uVein = { value: this.veinColor };
    shader.uniforms.uBack = { value: this.backColor };
    shader.uniforms.uBackMix = { value: this.backMix };
    shader.uniforms.uLumGain = { value: this.lumGain };
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uVein;\nuniform vec3 uBack;\nuniform float uBackMix;\nuniform float uLumGain;')
      .replace(
        '#include <map_fragment>',
        `float leafVein = 0.0;
#ifdef USE_MAP
  vec4 leafTex = texture2D( map, vMapUv );
  diffuseColor.rgb *= leafTex.r * uLumGain;
  diffuseColor.a *= leafTex.a;
  leafVein = leafTex.g;
#endif`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
  diffuseColor.rgb = mix( diffuseColor.rgb, uVein, leafVein );
  if ( ! gl_FrontFacing ) diffuseColor.rgb = mix( diffuseColor.rgb, uBack, uBackMix );`,
      );
  }

  customProgramCacheKey() {
    return 'decor-foliage-1';
  }
}

/** Leaf looks: roughness, underside colour/mix, vein colour (null = pale version of the leaf colour). */
const LOOKS = {
  default: { rough: 0.6, backMix: 0.3 },
  palm: { rough: 0.55, backMix: 0.28 },
  pothos: { rough: 0.48, backMix: 0.3 },
  anthurium: { rough: 0.78, vein: '#cbd8bf', backMix: 0.35 },
  monstera: { rough: 0.45, backMix: 0.25 },
  ficus: { rough: 0.36, backMix: 0.3 },
  olive: { rough: 0.62, back: '#b8bfae', backMix: 0.62 },
  eucalyptus: { rough: 0.72, back: '#c3cdc7', backMix: 0.4 },
  flower: { rough: 0.8, backMix: 0.12 },
  plume: { rough: 0.92, backMix: 0.05 },
};

/**
 * Cached foliage material of a look and colour (shared between models; recolour swaps to another cached one).
 * @param {string} lookId @param {string} hex @param {number} res
 */
function foliageMaterial(lookId, hex, res) {
  const look = LOOKS[lookId] || LOOKS.default;
  const h = hexOf(hex, '#4f6b3a');
  return cached(`decor:fol:${lookId}:${h}:${res}`, () => {
    const atlas = leafAtlas(res);
    const m = new FoliageMaterial({
      map: atlas.map,
      normalMap: atlas.normalMap,
      normalScale: new THREE.Vector2(0.6, 0.6),
      color: h,
      roughness: look.rough,
      metalness: 0,
      side: THREE.DoubleSide,
      alphaTest: 0.5,
      alphaToCoverage: true,
      vertexColors: true,
    });
    m.veinColor.set(look.vein ?? mixHex(h, '#eef2d6', 0.5));
    m.backColor.set(look.back ? mixHex(look.back, h, 0.25) : mixHex(h, '#d9dfb4', 0.32));
    m.backMix = look.backMix ?? 0.3;
    m.name = `foliage ${lookId} ${h}`;
    m.userData = { shared: true, kind: 'plant-leaf', hex: h, decorRecolor: (nh) => foliageMaterial(lookId, nh, res) };
    return m;
  });
}

/** Bark texture set (tube UVs: u along the trunk, v around). */
function barkSet() {
  return cached('decor:barkTex', () => {
    const w = 256, h = 128;
    const cv = createCanvas(w, h);
    const c = cv.getContext('2d');
    const img = c.createImageData(w, h);
    const heights = new Float32Array(w * h);
    const N = new TileableNoise(77);
    let sum = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const u = x / w, v = y / h;
        const fis = 1 - Math.abs(N.noise(u * 3, v * 9, 3, 9));
        const ridge = Math.pow(fis, 5);
        const fine = N.noise(u * 16, v * 32, 16, 32) * 0.5 + 0.5;
        const l = clamp(0.62 + 0.3 * (1 - ridge) * (0.7 + 0.3 * fine) - 0.25 * ridge);
        const i = (y * w + x) * 4;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = l * 255;
        img.data[i + 3] = 255;
        heights[y * w + x] = 1 - ridge * 0.8 + fine * 0.1;
        sum += Math.pow(l, 2.2);
      }
    }
    c.putImageData(img, 0, 0);
    const repeat = [1 / 0.18, 1 / 0.045];
    return {
      map: canvasTexture(cv, { repeat }),
      normalMap: canvasTexture(heightToNormalCanvas(heights, w, h, 3), { repeat, srgb: false }),
      ref: sum / (w * h),
    };
  });
}

/** Cached bark material (woody trunks and branches). */
function barkMaterial(hex) {
  const h = hexOf(hex, '#6b5a48');
  return cached(`decor:bark:${h}`, () => {
    const set = barkSet();
    const m = new THREE.MeshStandardMaterial({
      map: set.map,
      normalMap: set.normalMap,
      normalScale: new THREE.Vector2(0.9, 0.9),
      roughness: 0.9,
      color: new THREE.Color(h).multiplyScalar(1 / Math.max(0.05, set.ref)),
    });
    m.name = `bark ${h}`;
    m.userData = { shared: true, kind: 'bark', hex: h, decorRecolor: (nh, kind) => (WOOD_KINDS.has(kind) ? mat(kind, nh, { grain: 'v' }) : barkMaterial(nh)) };
    return m;
  });
}
const WOOD_KINDS = new Set(['oak', 'white-oak', 'smoked-oak', 'walnut', 'black-oak', 'teak', 'ash']);

// ---------------------------------------------------------------------------------------------------------------
// Plants: pots, supports, species

const POT_SHAPES = {
  cylinder: (t) => 0.9 + 0.1 * t,
  ribbed: (t) => 0.9 + 0.08 * Math.sin(Math.min(1, t * 1.04) * Math.PI * 0.85) - 0.03 * smooth01((t - 0.9) / 0.1),
  belly: (t) => 0.72 + 0.28 * Math.sin(Math.PI * (0.14 + 0.72 * t)),
  taper: (t) => 0.74 + 0.26 * t,
  bowl: (t) => 0.6 + 0.4 * Math.sin((t * Math.PI) / 2),
};
function smooth01(x) {
  const t = clamp(x);
  return t * t * (3 - 2 * t);
}
const POT_RINGS = [0.1, 0.17, 0.74, 0.8, 0.86];

/**
 * Plant pot as one lathe (outer wall, rounded rim, inner wall down to the soil) + a soil mound.
 * @returns {{ meshes: THREE.Mesh[], rimY: number, rimR: number, innerR: number, soilY: number }}
 */
function buildPot(style, d, h, y0, potMat, spec) {
  const R = d / 2;
  const f = POT_SHAPES[style] || POT_SHAPES.cylinder;
  const wall = clamp(d * 0.035, 0.004, 0.012);
  const prof = [[0, 0]];
  const r0 = R * f(0);
  prof.push([Math.max(0.001, r0 - 0.008), 0], [r0 - 0.002, 0.0015], [r0, 0.007]);
  const ribbed = style === 'ribbed';
  const n = ribbed ? Math.round(40 * Math.min(1.2, qOf(spec))) : 14;
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    let r = R * f(t);
    if (ribbed) for (const tk of POT_RINGS) r -= R * 0.018 * Math.exp(-(((t - tk) / 0.014) ** 2));
    prof.push([r, Math.max(0.008, t * (h - 0.005))]);
  }
  const rTop = R * f(1);
  prof.push([rTop - wall * 0.15, h - 0.0015], [rTop - wall * 0.55, h], [rTop - wall * 0.95, h - 0.002]);
  const soilY = h - Math.min(0.035, h * 0.14);
  prof.push([rTop - wall, h - 0.008], [rTop - wall - 0.002, soilY - 0.012]);
  const geo = K.lathe(prof, { seg: segN(spec, 32, 16) });
  const meshes = [K.partMesh(geo, potMat, 'pot', { position: [0, y0, 0] })];
  const ir = rTop - wall - 0.001;
  const soil = K.lathe([[ir, soilY], [ir * 0.6, soilY + 0.005], [0.001, soilY + 0.007]], { seg: segN(spec, 24, 10) });
  meshes.push(K.partMesh(soil, mat('soil', '#3b2c22'), null, { position: [0, y0, 0] }));
  return { meshes, rimY: y0 + h, rimR: rTop, innerR: ir, soilY: y0 + soilY + 0.004 };
}

/** Black wire plant stand (cylinder of rods with rings). */
function buildWireStand(g, st, spec) {
  const R = (st.d ?? 0.24) / 2, H = st.h ?? 0.6;
  const m = mat('black-metal', st.color || '#1a1a1a');
  const rods = segN(spec, 12, 8);
  for (let i = 0; i < rods; i++) {
    const a = (i / rods) * TAU;
    g.add(K.partMesh(K.cylinder(0.0022, 0.0022, H, { seg: 5 }), m, null, { position: [Math.cos(a) * R, 0, Math.sin(a) * R] }));
  }
  for (const y of [0.01, H * 0.5, H - 0.004]) g.add(K.partMesh(K.torus(R, 0.0035, { radial: 5, tubular: 40 }), m, null, { position: [0, y, 0], rotation: [Math.PI / 2, 0, 0] }));
  return { top: H, clearance: () => R + 0.006, collide: R };
}

/** Pedestal / plinth box under a plant. */
function buildPedestal(g, ped) {
  const w = ped.w ?? 0.3, d = ped.d ?? ped.w ?? 0.3, h = ped.h ?? 0.4;
  g.add(K.partMesh(K.roundedBox(w, h, d, 0.004, 2, { bottom: true }), mat('lacquer', ped.color || '#1a1a1a'), null));
  return {
    top: h,
    clearance: (az) => {
      const c = Math.abs(Math.cos(az)), s = Math.abs(Math.sin(az));
      return Math.min(c > 1e-3 ? w / 2 / c : 9, s > 1e-3 ? d / 2 / s : 9);
    },
    collide: Math.max(w, d) / 2,
  };
}

/**
 * Scales everything built so far in the plant context about its base to the target top and spread.
 * - `box` ({ hw, hd }, half footprint – the catalogue dims): the plant is first turned about its stem to the angle
 *   where its reach fits the footprint best, then x and z are scaled separately so the leaves end inside ±hw / ±hd
 *   (the bounding box the editor, collision and overlap checks use is then the product's footprint). `minXZ` /
 *   `maxXZ` limit the horizontal scale relative to the vertical one (default 0.45–1.25 in this mode).
 * - otherwise (room plants with an explicit `params.spread`): radial fit of the widest reach to spread / 2 (0.8–1.25).
 * `dry: true` only measures: returns { sy, sx, sz, rot } (sx / sz relative to sy, before the clamp) and changes nothing.
 */
function fitPlant(c, { from = 0, stemsFrom = 0, top = c.top, spread = c.spread, box = c.box, minXZ, maxXZ = 1.25, shrinkOnly = false, dry = false } = {}) {
  const bx = c.base.x, by = c.base.y, bz = c.base.z;
  let maxY = -Infinity, maxR = 0, n = 0;
  const L = c.leaves;
  const xs = [], zs = [];
  const add = (x, y, z) => {
    maxY = Math.max(maxY, y);
    xs[n] = x - bx;
    zs[n++] = z - bz;
    maxR = Math.max(maxR, Math.hypot(x - bx, z - bz));
  };
  const scanMesher = (m, start) => {
    for (let i = start; i < m.count; i++) add(m.pos[i * 3], m.pos[i * 3 + 1], m.pos[i * 3 + 2]);
  };
  scanMesher(L, from);
  for (const m of Object.values(c.extra)) scanMesher(m, m.fitFrom ?? 0);
  for (let i = stemsFrom; i < c.stems.length; i++) {
    const pos = c.stems[i].geo.attributes.position;
    for (let k = 0; k < pos.count; k++) add(pos.getX(k), pos.getY(k), pos.getZ(k));
  }
  if (!Number.isFinite(maxY) || maxY <= by + 1e-3) return null;
  const sy = (top - by) / (maxY - by);
  if (shrinkOnly && sy >= 1) return null;
  let sx, sz, rot = 0;
  if (box && box.hw > 1e-3 && box.hd > 1e-3) {
    const lo = (minXZ ?? 0.45) * sy, hi = maxXZ * sy;
    // turn about the stem: the angle (of 12 over a half turn) whose x/z reach needs the least squeezing; another angle
    // must beat the unturned plant by 3 % (so a plant does not spin while its size slider is dragged)
    let best = -Infinity, mxB = 1, mzB = 1;
    for (let k = 0; k < 12; k++) {
      const th = (k / 12) * Math.PI, co = Math.cos(th), si = Math.sin(th);
      let mx = 1e-4, mz = 1e-4;
      for (let i = 0; i < n; i++) {
        const x = xs[i], z = zs[i];
        const rx = Math.abs(co * x + si * z), rz = Math.abs(co * z - si * x);
        if (rx > mx) mx = rx;
        if (rz > mz) mz = rz;
      }
      const fx = box.hw / mx, fz = box.hd / mz;
      const score = Math.min(fx, fz) + 0.01 * (fx + fz);
      if (k === 0 || score > best * 1.03) {
        best = score;
        rot = th;
        mxB = mx;
        mzB = mz;
      }
    }
    if (dry) return { sy, sx: box.hw / mxB / sy, sz: box.hd / mzB / sy, rot };
    sx = clamp(box.hw / mxB, lo, hi);
    sz = clamp(box.hd / mzB, lo, hi);
  } else {
    if (dry) return { sy, sx: maxR > 1e-3 ? spread / 2 / maxR / sy : 1, sz: maxR > 1e-3 ? spread / 2 / maxR / sy : 1, rot: 0 };
    sx = sz = clamp(maxR > 1e-3 ? spread / 2 / maxR : 1, (minXZ ?? 0.8) * sy, maxXZ * sy);
  }
  const m4 = new THREE.Matrix4()
    .makeTranslation(bx, by, bz)
    .multiply(new THREE.Matrix4().makeScale(sx, sy, sz))
    .multiply(new THREE.Matrix4().makeRotationY(rot))
    .multiply(new THREE.Matrix4().makeTranslation(-bx, -by, -bz));
  L.transform(m4, from);
  for (const m of Object.values(c.extra)) m.transform(m4, m.fitFrom ?? 0);
  for (let i = stemsFrom; i < c.stems.length; i++) c.stems[i].geo.applyMatrix4(m4);
  return { sy, sx: sx / sy, sz: sz / sy, rot };
}

function tintOf(R, a = 0.06) {
  const k = R.range(1 - a, 1 + a);
  return [k * R.range(0.97, 1.03), k * R.range(0.97, 1.03), k * R.range(0.94, 1.03)];
}

/** Palm (areca / mountain palm) or kentia. `c.open` < 1 (narrow catalogue footprint) raises the canes and fronds. */
function buildPalm(c, kentia) {
  const { R, q, base, cells } = c;
  const H = Math.max(0.2, c.top - base.y);
  const open = clamp(num(c.open, 1), 0.15, 1);
  const n = Math.max(4, Math.round(clamp((kentia ? 4.5 : 7) + H * 2, 4, 13) * Math.sqrt(q)));
  for (let i = 0; i < n; i++) {
    const az = (i / n) * TAU + R.range(-0.35, 0.35);
    const young = i % 3 === 1;
    const out = dirAz(az);
    const side = V3(-out.z, 0, out.x);
    const tilt = (young ? R.range(0.05, 0.15) : R.range(0.2, 0.45)) * open;
    const caneLen = H * (young ? R.range(0.45, 0.6) : R.range(0.3, 0.5)) * (kentia ? 1.1 : 1);
    const frondLen = H * (young ? R.range(0.4, 0.5) : R.range(0.45, 0.62));
    const b0 = base.clone().add(V3(R.range(-1, 1) * 0.012, 0, R.range(-1, 1) * 0.012));
    const d0 = V3(Math.sin(tilt) * out.x, Math.cos(tilt), Math.sin(tilt) * out.z);
    const top = b0.clone().addScaledVector(d0, caneLen);
    const rachis = [top.clone()];
    const steps = 10;
    const arch = (young ? R.range(0.7, 1.1) : R.range(1.3, 2.0)) * lerp(0.45, 1, open);
    const p = top.clone();
    for (let s = 1; s <= steps; s++) {
      const th = tilt + arch * Math.pow(s / steps, 1.3);
      p.addScaledVector(V3(Math.sin(th) * out.x, Math.cos(th), Math.sin(th) * out.z), frondLen / steps);
      rachis.push(p.clone());
    }
    const mid = b0.clone().addScaledVector(d0, caneLen * 0.5).addScaledVector(out, caneLen * 0.02);
    c.stems.push({ geo: taperTube([b0, mid, ...rachis], 0.0065 * Math.sqrt(H / 1.5), 0.0012, { radial: q < 0.7 ? 4 : 5 }), role: 'green' });
    const cv = curve(rachis);
    const pairs = Math.round(clamp(frondLen * 38, 10, 40) * q);
    const ft = tintOf(R, 0.07);
    if (!young && R() < 0.5) ft[2] *= 0.9;
    const wid = (kentia ? 0.03 : 0.024) * Math.sqrt(H / 1.6);
    for (let k = 0; k < pairs; k++) {
      const u = 0.04 + 0.94 * (k / Math.max(1, pairs - 1));
      const P = cv.getPointAt(u), T = cv.getTangentAt(u);
      const N = V3().crossVectors(side, T).normalize();
      const len = frondLen * (kentia ? 0.36 : 0.3) * Math.pow(Math.sin(Math.PI * (0.1 + 0.85 * u)), 0.7) * R.range(0.88, 1.08);
      const alpha = lerp(1.15, 0.6, u) + R.range(-0.08, 0.08);
      const beta = kentia ? -0.1 : 0.3;
      for (const sg of [-1, 1]) {
        const dir = T.clone().multiplyScalar(Math.cos(alpha)).addScaledVector(side, sg * Math.sin(alpha));
        dir.multiplyScalar(Math.cos(beta)).addScaledVector(N, Math.sin(beta)).normalize();
        const tt = R.range(0.95, 1.05);
        leafCard(c.leaves, {
          base: P, dir, up: N, len, width: wid * R.range(0.85, 1.1), cell: cells.leaflet, seg: q < 0.7 ? 3 : 4, cols: 2,
          fold: 0.32, gravity: (kentia ? 1.1 : 0.7) * R.range(0.8, 1.2), tint: [ft[0] * tt, ft[1] * tt, ft[2] * tt], baseShade: 0.8,
        });
      }
    }
  }
}

/** Monstera. `c.open` < 1 (narrow or tall catalogue footprint) raises the petioles and tips the blades up. */
function buildMonstera(c) {
  const { R, q, base, cells } = c;
  const H = Math.max(0.1, c.top - base.y);
  const open = clamp(num(c.open, 1), 0.15, 1);
  const n = Math.max(4, Math.round(clamp(6 + c.spread * 6, 5, 13) * Math.sqrt(q)));
  for (let i = 0; i < n; i++) {
    const az = i * 2.39996 + R.range(-0.3, 0.3);
    const out = dirAz(az);
    const rank = i / Math.max(1, n - 1);
    const elev = Math.PI / 2 - (Math.PI / 2 - (lerp(1.35, 0.55, rank) + R.range(-0.12, 0.12))) * open;
    const petLen = H * R.range(0.55, 0.85) * lerp(0.9, 1.1, rank);
    const b0 = base.clone().add(V3(R.range(-1, 1) * 0.02, 0, R.range(-1, 1) * 0.02));
    const p1 = b0.clone().addScaledVector(dirEl(out, Math.min(1.5, elev + 0.25)), petLen * 0.5);
    const p2 = p1.clone().addScaledVector(dirEl(out, elev), petLen * 0.5);
    c.stems.push({ geo: taperTube([b0, p1, p2], 0.0055, 0.004, { radial: 5 }), role: 'green' });
    const L = R.range(0.26, 0.36) * Math.pow(Math.max(0.2, c.spread) / 0.8, 0.5) * lerp(0.75, 1.05, rank);
    const dir = dirEl(out, elev - R.range(0.75, 1.15) * lerp(0.55, 1, open)).applyAxisAngle(UPV, R.range(-0.3, 0.3));
    const up = UPV.clone().addScaledVector(out, R.range(-0.2, 0.3));
    leafCard(c.leaves, {
      base: p2, dir, up, len: L, width: L * 0.95, cell: cells.monstera, seg: q < 0.7 ? 4 : 6, cols: 4,
      fold: 0.04, cup: -0.08, bend: 0.3, gravity: 0.2, twist: R.range(-0.25, 0.25), offset: 0.11, tint: tintOf(R, 0.06),
    });
  }
}

function buildOlive(c) {
  const { R, q, base, cells } = c;
  const H = Math.max(0.2, c.top - base.y);
  const s = H / 1.2;
  const rc = Math.max(0.15, c.spread / 2) * 1.1;
  const trunkH = H * R.range(0.38, 0.46);
  const trunks = [];
  for (let t = 0; t < 2; t++) {
    const b0 = base.clone().add(V3((t - 0.5) * 0.018 * s, 0, R.range(-0.008, 0.008)));
    const pts = [b0];
    for (let k = 1; k <= 4; k++) {
      pts.push(b0.clone().add(V3(Math.sin(k * 1.7 + t * 2.3) * 0.018 * s, ((trunkH * k) / 4) * R.range(0.96, 1.04), Math.cos(k * 1.3 + t) * 0.018 * s)));
    }
    c.stems.push({ geo: taperTube(pts, 0.012 * s, 0.007 * s, { radial: 6 }), role: 'wood' });
    trunks.push(curve(pts));
  }
  // branches toward points spread through an ellipsoidal crown
  const crown = base.clone().add(V3(0, H * 0.66, 0));
  const branches = [];
  const nB = Math.round(9 * Math.sqrt(q)) + 3;
  for (let b = 0; b < nB; b++) {
    const start = trunks[b % trunks.length].getPointAt(R.range(0.72, 1));
    const az = (b / nB) * TAU + R.range(-0.35, 0.35);
    const el = R.range(-0.75, 0.8);
    const target = crown.clone().add(V3(Math.cos(az) * Math.cos(el) * rc * R.range(0.65, 1), Math.sin(el) * H * 0.3, Math.sin(az) * Math.cos(el) * rc * R.range(0.65, 1)));
    const mid = start.clone().lerp(target, 0.45).add(V3(0, H * 0.04, 0));
    const pts = [start, mid, target];
    c.stems.push({ geo: taperTube(pts, 0.006 * s, 0.0018 * s, { radial: 4 }), role: 'wood' });
    branches.push(pts);
    const cb = curve(pts);
    const nTw = R.int(4, 6);
    for (let k = 0; k < nTw; k++) {
      const u = R.range(0.35, 0.95);
      const sp = cb.getPointAt(u);
      const td = cb.getTangentAt(u).applyAxisAngle(UPV, R.sign() * R.range(0.5, 1.4));
      td.y += R.range(-0.45, 0.35);
      td.normalize();
      const tl = H * R.range(0.05, 0.11);
      const tp = [sp, sp.clone().addScaledVector(td, tl * 0.5), sp.clone().addScaledVector(td, tl).add(V3(0, tl * 0.12, 0))];
      c.stems.push({ geo: taperTube(tp, 0.0022 * s, 0.001 * s, { radial: 3 }), role: 'wood' });
      branches.push(tp);
    }
  }
  const spacing = (0.014 * s) / Math.sqrt(q);
  for (const pts of branches) {
    const cv = curve(pts);
    const len = cv.getLength();
    const u0 = len > H * 0.15 ? 0.45 : 0.15;
    const nodes = Math.max(2, Math.floor((len * (1 - u0)) / (spacing * 0.5)));
    for (let k = 0; k <= nodes; k++) {
      const u = Math.min(1, u0 + (1 - u0) * (k / nodes) + R.range(-0.015, 0.015));
      const P = cv.getPointAt(u), T = cv.getTangentAt(u);
      const sideA = perp(T).applyAxisAngle(T, k * 2.39996 + R.range(-0.4, 0.4));
      for (const sg of [1]) {
        const sv = sideA.clone().multiplyScalar(sg);
        const ang = R.range(0.5, 1.05);
        const dir = k === nodes ? T.clone() : T.clone().multiplyScalar(Math.cos(ang)).addScaledVector(sv, Math.sin(ang)).normalize();
        const l = 0.068 * Math.sqrt(s) * R.range(0.8, 1.2);
        leafCard(c.leaves, {
          base: P, dir, up: UPV.clone().addScaledVector(sv, 0.3), len: l, width: l * 0.27, cell: cells.lance, seg: 2, cols: 2,
          fold: 0.25, gravity: R.range(0.1, 0.45), bend: 0.12, twist: R.range(-0.6, 0.6), tint: tintOf(R, 0.09), baseShade: 0.9,
        });
      }
    }
  }
}

function buildFicus(c) {
  const { R, q, base, cells } = c;
  const H = Math.max(0.2, c.top - base.y);
  const s = H / 1.5;
  const pts = [base.clone()];
  for (let k = 1; k <= 5; k++) pts.push(base.clone().add(V3(Math.sin(k * 1.4) * 0.025 * s, (H * 0.88 * k) / 5, Math.cos(k * 1.1) * 0.02 * s)));
  c.stems.push({ geo: taperTube(pts, 0.017 * s, 0.007 * s, { radial: 7 }), role: 'wood' });
  const axes = [{ cv: curve(pts), u0: 0.32, n: Math.round(clamp(18 + H * 8, 12, 32) * Math.sqrt(q)) }];
  // a side shoot or two for fullness
  const tc = axes[0].cv;
  for (let b = 0; b < (q < 0.7 ? 1 : 2); b++) {
    const st = tc.getPointAt(R.range(0.45, 0.65));
    const out = dirAz(R.range(0, TAU));
    const bl = H * R.range(0.25, 0.35);
    const bp = [st, st.clone().addScaledVector(dirEl(out, 0.7), bl * 0.5), st.clone().addScaledVector(dirEl(out, 1.0), bl)];
    c.stems.push({ geo: taperTube(bp, 0.008 * s, 0.004 * s, { radial: 5 }), role: 'wood' });
    axes.push({ cv: curve(bp), u0: 0.35, n: Math.round(6 * Math.sqrt(q)) + 2 });
  }
  let k = 0;
  for (const ax of axes) {
    for (let i = 0; i < ax.n; i++, k++) {
      const u = ax.u0 + (1 - ax.u0) * (i / Math.max(1, ax.n - 1));
      const P = ax.cv.getPointAt(Math.min(1, u));
      const out = dirAz(k * 2.39996 + R.range(-0.2, 0.2));
      const el = lerp(0.25, 0.95, u) + R.range(-0.15, 0.15);
      const p2 = P.clone().addScaledVector(dirEl(out, el + 0.25), 0.035 * s);
      c.stems.push({ geo: taperTube([P, p2], 0.0032 * s, 0.0026 * s, { radial: 4, seg: 2 }), role: 'wood' });
      const L = (0.24 + 0.1 * Math.sin(Math.PI * u)) * Math.pow(s, 0.6) * (u > 0.94 ? 0.6 : 1) * R.range(0.88, 1.1);
      leafCard(c.leaves, {
        base: p2, dir: dirEl(out, el), up: out.clone().multiplyScalar(0.75).add(V3(0, 0.65, 0)), len: L, width: L * 0.8, cell: cells.fiddle,
        seg: q < 0.7 ? 4 : 5, cols: 4, fold: 0.1, cup: -0.08, bend: 0.25, gravity: 0.1, twist: R.range(-0.3, 0.3), offset: 0.02, tint: tintOf(R, 0.06),
      });
    }
  }
}

/** Strelitzia / banana plant. `c.open` < 1 (narrow catalogue footprint) stands the petioles and blades up. */
function buildStrelitzia(c) {
  const { R, q, base, cells } = c;
  const H = Math.max(0.2, c.top - base.y);
  const open = clamp(num(c.open, 1), 0.15, 1);
  const n = Math.max(5, Math.round(clamp(8 + c.spread * 5, 7, 14) * Math.sqrt(q)));
  for (let i = 0; i < n; i++) {
    const rank = i / Math.max(1, n - 1);
    const out = dirAz(i * 2.39996 + R.range(-0.25, 0.25));
    const el = Math.PI / 2 - (Math.PI / 2 - (lerp(1.45, 0.85, rank) + R.range(-0.1, 0.1))) * open;
    const petLen = H * R.range(0.32, 0.5) * lerp(0.8, 1, rank);
    const b0 = base.clone().add(V3(R.range(-1, 1) * 0.02, 0, R.range(-1, 1) * 0.02));
    const p1 = b0.clone().addScaledVector(dirEl(out, el), petLen * 0.5);
    const p2 = p1.clone().addScaledVector(dirEl(out, el - 0.12 * open), petLen * 0.5);
    c.stems.push({ geo: taperTube([b0, p1, p2], 0.012, 0.006, { radial: 5 }), role: 'green' });
    const L = H * R.range(0.4, 0.55) * lerp(0.7, 1, rank);
    const dir = dirEl(out, el - 0.2 * open);
    leafCard(c.leaves, {
      base: p2, dir, up: out.clone().multiplyScalar(0.8).add(V3(0, 0.6, 0)), len: L, width: L * 0.42, cell: cells.paddle, seg: q < 0.7 ? 5 : 7, cols: 4,
      fold: 0.16, gravity: lerp(0.15, 0.6, rank) * lerp(0.6, 1, open), bend: 0.2, twist: R.range(-0.5, 0.5), offset: 0.03, tint: tintOf(R, 0.06),
    });
  }
}

/** Pampas plumes (crossed alpha cards along the top of thin stems) fanned from an origin. */
function addPlumes(c, mesher, { origin, count, top, fan = 0.7, widthF = 1, lenF = 0.6 }) {
  const { R, cells } = c;
  for (let i = 0; i < count; i++) {
    const t = count > 1 ? i / (count - 1) - 0.5 : 0;
    const lean = t * 2 * fan + R.range(-0.08, 0.08);
    const dir = V3(Math.sin(lean), Math.cos(lean), R.range(-0.28, 0.28)).normalize();
    const L = ((top - origin.y) / Math.max(0.5, dir.y)) * R.range(0.86, 1.0);
    const o = origin.clone().add(V3(R.range(-1, 1) * 0.006, 0, R.range(-1, 1) * 0.006));
    const pts = [o, o.clone().addScaledVector(dir, L * 0.5), o.clone().addScaledVector(dir, L).add(V3(0, -L * 0.05 * (1 - dir.y), 0))];
    c.stems.push({ geo: taperTube(pts, 0.0028, 0.0016, { radial: 4 }), role: 'plume' });
    const cv = curve(pts);
    const P = cv.getPointAt(0.42), T = cv.getTangentAt(0.42);
    const up1 = V3().crossVectors(T, UPV);
    if (up1.lengthSq() < 1e-6) up1.set(1, 0, 0);
    up1.normalize();
    const up2 = V3().crossVectors(T, up1).normalize();
    const pl = L * lenF, pw = clamp(0.1 + L * 0.08, 0.08, 0.2) * widthF;
    const tint = tintOf(R, 0.05);
    for (const up of [up1, up2]) {
      leafCard(mesher, { base: P, dir: T, up, len: pl, width: pw, cell: cells.plume, seg: 5, cols: 2, gravity: 0.25 * (1 - T.y) + 0.04, tint, baseShade: 0.9 });
    }
  }
}

function buildPampasPlant(c) {
  const { R, q, base, cells } = c;
  const H = Math.max(0.2, c.top - base.y);
  const nb = Math.round(28 * q);
  for (let i = 0; i < nb; i++) {
    const out = dirAz(R.range(0, TAU));
    leafCard(c.leaves, {
      base: base.clone().add(V3(R.range(-1, 1) * 0.02, 0, R.range(-1, 1) * 0.02)), dir: dirEl(out, R.range(0.9, 1.45)), up: out.clone().negate(),
      len: H * R.range(0.3, 0.55), width: 0.012, cell: cells.blade, seg: 5, cols: 2, fold: 0.35, gravity: 1.0, tint: tintOf(R, 0.08),
    });
  }
  const pm = (c.extra.plume ||= new Mesher());
  addPlumes(c, pm, { origin: base, count: Math.round(6 + q * 2), top: c.top, fan: 0.5 });
}

/** Trailing plants (pothos, satin pothos / anthurium): a crown on top and vines hanging over the pot and support. */
function buildTrailing(c, cellName) {
  const { R, q, base, cells } = c;
  const anth = cellName === 'heartVein';
  const cell = cells[cellName];
  const leafL = (anth ? 0.11 : 0.085) * clamp(c.spread / 0.45, 0.75, 1.4);
  const nc = Math.round((anth ? 13 : 26) * Math.sqrt(q));
  const Hc = Math.max(0.05, c.top - base.y);
  for (let i = 0; i < nc; i++) {
    const out = dirAz(i * 2.39996 + R.range(-0.3, 0.3));
    const tall = anth ? i % 3 !== 2 : i % 3 === 0;
    const el = tall ? R.range(1.05, 1.4) : R.range(0.45, 0.95);
    const L = leafL * R.range(0.8, 1.15);
    const pl = clamp((tall ? Hc * R.range(0.55, 0.95) : Hc * R.range(0.2, 0.45)) - L * 0.45, 0.03, 0.6) / Math.sin(el);
    const b0 = base.clone().add(V3(R.range(-1, 1) * c.rimR * 0.4, 0, R.range(-1, 1) * c.rimR * 0.4));
    const p1 = b0.clone().addScaledVector(dirEl(out, Math.min(1.5, el + 0.15)), pl * 0.5);
    const p2 = p1.clone().addScaledVector(dirEl(out, el - 0.15), pl * 0.5);
    c.stems.push({ geo: taperTube([b0, p1, p2], 0.0026, 0.002, { radial: 4 }), role: 'green' });
    leafCard(c.leaves, {
      base: p2, dir: dirEl(out, el - R.range(0.9, 1.4)), up: UPV.clone().addScaledVector(out, 0.5), len: L, width: L * (anth ? 0.82 : 0.74),
      cell, seg: 4, cols: 4, fold: 0.12, cup: -0.05, bend: 0.25, gravity: 0.25, offset: 0.1, tint: tintOf(R, 0.07),
    });
  }
  fitPlant(c, { top: c.top, spread: c.spread, box: null, minXZ: 1, maxXZ: 1, shrinkOnly: true });
  const nv = Math.round((anth ? 7 : 14) * Math.sqrt(q));
  const floorY = 0.05;
  for (let i = 0; i < nv; i++) {
    const az = (i / nv) * TAU + R.range(-0.3, 0.3);
    const out = dirAz(az);
    const r0 = c.rimR * 0.85;
    const p0 = V3(out.x * r0, c.rimY + 0.006, out.z * r0);
    const clear = Math.max(c.rimR + 0.012, c.clearance(az) + 0.014);
    const edgeY = c.supportTop > 0.02 ? Math.min(c.rimY - 0.005, c.supportTop + 0.014) : c.rimY - 0.03;
    const pts = [p0];
    if (clear > c.rimR + 0.06) pts.push(V3(out.x * (r0 + clear) * 0.5, Math.max(edgeY + 0.012, c.rimY - 0.04), out.z * (r0 + clear) * 0.5));
    pts.push(V3(out.x * clear, edgeY + 0.006, out.z * clear));
    const drop = Math.max(0.05, edgeY - floorY) * R.range(0.35, 1.0);
    for (let k = 1; k <= 4; k++) {
      const f = k / 4;
      const r = clear + 0.01 + f * R.range(0, 0.05);
      const a2 = az + R.range(-0.12, 0.12);
      pts.push(V3(Math.cos(a2) * r, edgeY - drop * f, Math.sin(a2) * r));
    }
    c.stems.push({ geo: taperTube(pts, 0.0024, 0.0016, { radial: 4 }), role: 'green' });
    const cv = curve(pts);
    const Lv = cv.getLength();
    const nl = Math.max(2, Math.floor((Lv / (anth ? 0.085 : 0.05)) * Math.sqrt(q)));
    for (let k = 0; k < nl; k++) {
      const u = (k + 0.5) / nl;
      const P = cv.getPointAt(u);
      const o2 = V3(P.x, 0, P.z).normalize();
      const sv = V3().crossVectors(UPV, o2).multiplyScalar(k % 2 ? 1 : -1);
      const L = leafL * lerp(1.0, 0.55, u) * R.range(0.85, 1.1);
      leafCard(c.leaves, {
        base: P.clone().addScaledVector(o2, 0.008), dir: o2.clone().multiplyScalar(0.55).add(V3(0, -0.75, 0)).addScaledVector(sv, 0.45).normalize(),
        up: o2.clone().add(V3(0, 0.35, 0)), len: L, width: L * (anth ? 0.82 : 0.74), cell, seg: 4, cols: 2, fold: 0.15, bend: 0.15, gravity: 0.2, offset: 0.1, tint: tintOf(R, 0.08),
      });
    }
  }
}

function buildHerb(c) {
  const { R, q, base, cells } = c;
  const H = Math.max(0.05, c.top - base.y);
  const ns = Math.round(7 * Math.sqrt(q)) + 2;
  for (let i = 0; i < ns; i++) {
    const out = dirAz(R.range(0, TAU));
    const len = H * R.range(0.55, 0.95);
    const b0 = base.clone().add(V3(R.range(-1, 1) * c.rimR * 0.4, 0, R.range(-1, 1) * c.rimR * 0.4));
    const d = dirEl(out, R.range(1.0, 1.45));
    const pts = [b0, b0.clone().addScaledVector(d, len * 0.5).add(V3(R.range(-1, 1) * 0.01, 0, R.range(-1, 1) * 0.01)), b0.clone().addScaledVector(d, len)];
    c.stems.push({ geo: taperTube(pts, 0.002, 0.0012, { radial: 4 }), role: 'green' });
    const cv = curve(pts);
    for (let k = 0; k < 4; k++) {
      const u = 0.3 + (0.7 * k) / 3;
      const P = cv.getPointAt(u), T = cv.getTangentAt(u);
      const sv = perp(T).applyAxisAngle(T, (k * Math.PI) / 2);
      for (const sg of [-1, 1]) {
        const L = H * 0.24 * lerp(1, 0.7, u) * R.range(0.85, 1.1);
        leafCard(c.leaves, {
          base: P, dir: T.clone().multiplyScalar(0.35).addScaledVector(sv, sg * 0.9).normalize(), up: UPV, len: L, width: L * 0.62,
          cell: cells.ovate, seg: 3, cols: 2, fold: 0.2, gravity: 0.25, tint: tintOf(R, 0.07),
        });
      }
    }
  }
}

function buildFern(c) {
  const { R, q, base, cells } = c;
  const H = Math.max(0.05, c.top - base.y);
  const nf = Math.round(13 * Math.sqrt(q)) + 3;
  for (let i = 0; i < nf; i++) {
    const out = dirAz(i * 2.39996 + R.range(-0.3, 0.3));
    const dir = dirEl(out, R.range(0.35, 1.3));
    const len = H * R.range(0.8, 1.15) * 1.2;
    const up1 = UPV.clone().addScaledVector(dir, -dir.y).normalize();
    const up2 = V3().crossVectors(dir, up1).normalize();
    const b0 = base.clone().add(V3(R.range(-1, 1) * c.rimR * 0.3, 0, R.range(-1, 1) * c.rimR * 0.3));
    const tint = tintOf(R, 0.07);
    leafCard(c.leaves, { base: b0, dir, up: up1, len, width: len * 0.55, cell: cells.fern, seg: 4, cols: 2, gravity: 0.6, tint });
    leafCard(c.leaves, { base: b0, dir, up: up2, len: len * 0.95, width: len * 0.4, cell: cells.fern, seg: 4, cols: 2, gravity: 0.6, tint });
  }
}

/**
 * Stems with leaves in opposite pairs (eucalyptus, sprigs) fanned from an origin.
 * @param {object} c plant/flower context  @param {Mesher} mesher
 */
function addLeafyStems(c, mesher, { origin, count, top, fan = 0.5, cell, leafLen, spacing, widthF = 0.95, alternate = false, role = 'flower-stem', stemR = 0.0022 }) {
  const { R } = c;
  for (let i = 0; i < count; i++) {
    const t = count > 1 ? i / (count - 1) - 0.5 : 0;
    const lean = t * 2 * fan + R.range(-0.1, 0.1);
    const phi = R.range(-0.5, 0.5);
    const dir = V3(Math.sin(lean) * Math.cos(phi), Math.cos(lean), Math.sin(lean) * Math.sin(phi) + R.range(-0.15, 0.15)).normalize();
    const L = ((top - origin.y) / Math.max(0.4, dir.y)) * R.range(0.82, 1.0);
    const o = origin.clone().add(V3(R.range(-1, 1) * 0.005, 0, R.range(-1, 1) * 0.005));
    const pts = [o, o.clone().addScaledVector(dir, L * 0.5).add(V3(R.range(-1, 1) * 0.015, 0, R.range(-1, 1) * 0.015)), o.clone().addScaledVector(dir, L).add(V3(0, -L * 0.04, 0))];
    c.stems.push({ geo: taperTube(pts, stemR, stemR * 0.55, { radial: 4 }), role });
    const cv = curve(pts);
    const nn = Math.max(2, Math.floor((L * 0.85) / spacing));
    for (let k = 0; k <= nn; k++) {
      const u = 0.15 + 0.85 * (k / nn);
      const P = cv.getPointAt(Math.min(1, u)), T = cv.getTangentAt(Math.min(1, u));
      const sv = perp(T).applyAxisAngle(T, (k * Math.PI) / 2 + R.range(-0.25, 0.25));
      const sides = alternate ? [k % 2 ? 1 : -1] : [-1, 1];
      for (const sg of sides) {
        const s = sv.clone().multiplyScalar(sg);
        const l = leafLen * lerp(1, 0.6, u) * R.range(0.85, 1.12);
        const ldir = s.clone().multiplyScalar(0.85).addScaledVector(T, 0.45).normalize();
        leafCard(mesher, {
          base: P, dir: ldir, up: V3().crossVectors(ldir, T).applyAxisAngle(ldir, R.range(-0.6, 0.6)), len: l, width: l * widthF, cell,
          seg: 2, cols: 2, fold: 0.1, gravity: 0.15, offset: 0.04, tint: tintOf(R, 0.06), baseShade: 0.9,
        });
      }
    }
  }
}

function buildEucalyptusPlant(c) {
  addLeafyStems(c, c.leaves, { origin: c.base, count: Math.round(5 * Math.sqrt(c.q)) + 1, top: c.top, fan: 0.55, cell: c.cells.round, leafLen: 0.038, spacing: 0.045, role: 'green' });
}

const SPECIES = {
  palm: { look: 'palm', pot: 'ribbed', build: (c) => buildPalm(c, false), fit: true, open: true },
  kentia: { look: 'palm', pot: 'cylinder', build: (c) => buildPalm(c, true), fit: true, open: true },
  monstera: { look: 'monstera', pot: 'belly', build: buildMonstera, fit: true, open: true },
  olive: { look: 'olive', pot: 'belly', build: buildOlive, fit: true, woody: true },
  'ficus-lyrata': { look: 'ficus', pot: 'cylinder', build: buildFicus, fit: true, woody: true },
  strelitzia: { look: 'monstera', pot: 'taper', build: buildStrelitzia, fit: true, open: true },
  pampas: { look: 'palm', pot: 'cylinder', build: buildPampasPlant, fit: true },
  pothos: { look: 'pothos', pot: 'cylinder', build: (c) => buildTrailing(c, 'heart'), fit: false },
  anthurium: { look: 'anthurium', pot: 'belly', build: (c) => buildTrailing(c, 'heartVein'), fit: false },
  herb: { look: 'default', pot: 'cylinder', build: buildHerb, fit: true },
  fern: { look: 'default', pot: 'cylinder', build: buildFern, fit: true },
  eucalyptus: { look: 'eucalyptus', pot: 'cylinder', build: buildEucalyptusPlant, fit: true },
};
const SPECIES_ALIASES = { areca: 'palm', 'kentia-palm': 'kentia', ficus: 'ficus-lyrata', fiolfiken: 'ficus-lyrata', banana: 'strelitzia', bananplante: 'strelitzia', gullranke: 'pothos', rosemary: 'fern', asparagus: 'fern', succulent: 'herb' };

/**
 * Narrow footprint (e.g. a 1.4 m palm sold as 70 × 70 cm): rebuilds the same plant (same seed) with raised canes /
 * petioles (`c.open` < 1) instead of squeezing a wide crown flat, so the final fitPlant only has a small correction
 * left. `need` = horizontal scale the footprint asks for relative to the vertical one; the openness is found with one
 * guess and one secant step on log(need) ∝ −b·log(open). At most two extra builds (palm ≈ 10 ms, strelitzia ≈ 5 ms).
 */
function narrowPlant(S, c, context) {
  const T = 0.85;
  const needOf = (cc) => {
    const m = fitPlant(cc, { dry: true });
    return m ? Math.min(m.sx, m.sz) : 1;
  };
  const n0 = needOf(c);
  if (!(n0 < T - 0.05)) return c;
  const rebuild = (open) => {
    for (const st of c.stems) st.geo.dispose();
    const cc = context(clamp(open, 0.15, 1));
    S.build(cc);
    return cc;
  };
  const o1 = clamp(Math.pow(n0 / T, 1.4), 0.15, 1);
  c = rebuild(o1);
  const n1 = needOf(c);
  if (Math.abs(Math.log(n1 / T)) > Math.log(1.1) && o1 < 0.999) {
    const b = Math.log(n1 / n0) / -Math.log(o1);
    if (b > 0.05) {
      c = rebuild(Math.exp(Math.log(n0 / T) / b));
    }
  }
  return c;
}

/** Builds plant-floor / plant-small. */
function buildPlant(spec) {
  const P = spec.params, C = spec.colors, M = spec.materials;
  const { w, d, h } = spec.dims;
  const sid = SPECIES[P.species] ? P.species : SPECIES_ALIASES[P.species] || (spec.archetype === 'plant-small' ? 'herb' : 'olive');
  const S = SPECIES[sid];
  const q = qOf(spec);
  const g = new THREE.Group();
  const seedKey = `plant:${sid}:${P.seed ?? 1}:${Math.round(h * 100)}:${Math.round(Math.max(w, d) * 100)}`;
  // support
  let support = { top: 0, clearance: () => 0, collide: 0 };
  if (P.pedestal && typeof P.pedestal === 'object') support = buildPedestal(g, P.pedestal);
  else if (P.stand && typeof P.stand === 'object') support = buildWireStand(g, P.stand, spec);
  // An explicit params.spread wider than the footprint (room plants: dims = pot, spread = leaves) keeps the radial fit;
  // otherwise dims ARE the plant (catalogue products) and the leaves are fitted into the w × d footprint.
  const ownSpread = num(P.spread, 0) > Math.max(w, d) + 1e-6;
  const spread = Math.max(num(P.spread, 0), w, d);
  const potD = clamp(num(P.potD, Math.min(w, d) * 0.7), 0.05, 0.9);
  const potH = clamp(num(P.potH, potD * 0.9), 0.04, Math.max(0.05, h * 0.75));
  const style = P.potStyle && P.potStyle !== 'auto' && POT_SHAPES[P.potStyle] ? P.potStyle : S.pot;
  const potY = P.stand ? Math.max(0, support.top - potH * 0.4) : support.top;
  const pot = buildPot(style, potD, potH, potY, mat(M.pot || 'ceramic', C.pot), spec);
  for (const m of pot.meshes) g.add(m);
  const res = atlasRes(spec);
  const cells = leafAtlas(res).cells;
  const context = (open) => ({
    R: K.rng(seedKey), q, cells, spread, top: Math.max(h, pot.rimY + 0.04), box: ownSpread ? null : { hw: w / 2, hd: d / 2 },
    base: V3(0, pot.soilY, 0), rimR: pot.rimR, rimY: pot.rimY,
    supportTop: support.top, clearance: support.clearance,
    leaves: new Mesher(), extra: {}, stems: [], open,
  });
  let c = context(1);
  S.build(c);
  if (S.fit && S.open && c.box) c = narrowPlant(S, c, context);
  if (S.fit) fitPlant(c);
  // meshes
  const leafHex = C.leaves || '#4f6b3a';
  if (c.leaves.count) {
    g.add(K.partMesh(c.leaves.build(), foliageMaterial(S.look, leafHex, res), 'leaves', { noMerge: true }));
  }
  if (c.extra.plume?.count) {
    g.add(K.partMesh(c.extra.plume.build(), foliageMaterial('plume', P.plumeColor || C.flowers || '#e3d8cc', res), null, { noMerge: true }));
  }
  const greenStem = mat('plant-leaf', mixHex(scaleHex(leafHex, 0.8), '#7a7a3a', 0.25));
  const trunkKind = M.trunk;
  const woodMat = WOOD_KINDS.has(trunkKind) ? mat(trunkKind, C.trunk, { grain: 'v' }) : barkMaterial(C.trunk || '#6b5a48');
  for (const s of c.stems) {
    if (s.role === 'wood') g.add(K.partMesh(s.geo, woodMat, spec.archetype === 'plant-floor' ? 'trunk' : null));
    else if (s.role === 'plume') g.add(K.partMesh(s.geo, mat('plant-leaf', '#9c7e5e'), null));
    else g.add(K.partMesh(s.geo, greenStem, null));
  }
  const cr = Math.max(pot.rimR, support.collide);
  const colliders = [{ min: [-cr, 0, -cr], max: [cr, Math.max(pot.rimY, support.top), cr] }];
  return finish(g, { colliders });
}

// ---------------------------------------------------------------------------------------------------------------
// Vases (with flowers)

const VASE_PROFILES = {
  round: [[0, 0.62], [0.08, 0.86], [0.25, 0.99], [0.42, 1.0], [0.62, 0.9], [0.8, 0.62], [0.9, 0.46], [0.96, 0.44], [1, 0.5]],
  ribbed: [[0, 0.6], [0.1, 0.86], [0.3, 1.0], [0.5, 0.92], [0.72, 0.62], [0.86, 0.44], [0.94, 0.42], [1, 0.5]],
  bottle: [[0, 0.8], [0.12, 0.98], [0.3, 1.0], [0.42, 0.86], [0.52, 0.42], [0.6, 0.28], [0.9, 0.25], [1, 0.31]],
  bubble: [[0, 0.45], [0.08, 0.8], [0.3, 1.0], [0.55, 0.93], [0.72, 0.56], [0.8, 0.31], [0.95, 0.28], [1, 0.33]],
  bud: [[0, 0.7], [0.15, 0.95], [0.35, 1.0], [0.55, 0.72], [0.7, 0.38], [0.92, 0.33], [1, 0.4]],
  cylinder: [[0, 0.98], [0.5, 1.0], [1, 0.99]],
  wave: [[0, 0.62], [0.15, 0.88], [0.4, 1.0], [0.6, 0.95], [0.8, 0.68], [0.92, 0.42], [1, 0.38]],
  sculptural: [[0, 0.58], [0.15, 0.84], [0.38, 1.0], [0.6, 0.88], [0.78, 0.6], [0.9, 0.46], [1, 0.44]],
};

/** Vase body geometry list for a shape; returns { geos, neckR, height }. */
function vaseGeometry(shape, D, H, spec, P) {
  const R = D / 2;
  const prof = (VASE_PROFILES[shape] || VASE_PROFILES.round).map((p) => [...p]);
  if (P.neckD && (shape === 'sculptural' || shape === 'wave')) prof[prof.length - 1][1] = clamp(P.neckD / D, 0.15, 1);
  const glass = shape === 'bubble';
  const wall = glass ? clamp(R * 0.05, 0.002, 0.004) : clamp(R * 0.08, 0.003, 0.008);
  const geos = [];
  const rTop = R * prof[prof.length - 1][1];
  const innerDepth = glass ? H - 0.006 : Math.min(H * 0.25, 0.08);
  if (shape === 'wave' || shape === 'sculptural') {
    const S = sampleProfile(prof, 40);
    const rAt = (t) => {
      const i = Math.min(S.length - 2, Math.floor(t * (S.length - 1)));
      const f = t * (S.length - 1) - i;
      return lerp(S[i][0], S[i + 1][0], f) * R;
    };
    const env = (t) => smooth01(t / 0.12) * (1 - smooth01((t - 0.82) / 0.14));
    const wave = shape === 'wave';
    const ribs = num(P.ribs, 7);
    const ph = (spec.params.seed ?? 1) * 1.7;
    const fn = wave
      ? (th, t) => rAt(t) * (1 + 0.16 * env(t) * Math.sin(ribs * th + (t * 1.4 + 0.3 * Math.sin(t * 9)) * TAU * 0.5))
      : (th, t) => rAt(t) * (1 + env(t) * (0.08 * Math.sin(2 * th + t * 4 + ph) + 0.05 * Math.sin(3 * th - t * 6 + ph * 2)));
    geos.push(revolveGeometry(fn, H, segN(spec, wave ? 84 : 56, 28), segN(spec, 44, 20)));
    geos.push(K.lathe([[rTop, H - 0.0005], [rTop * 0.97, H + 0.002], [rTop - wall, H - 0.002], [rTop - wall, H - innerDepth], [0.001, H - innerDepth]], { seg: segN(spec, 32, 12) }));
    const bottom = K.lathe([[0.001, 0], [rAt(0), 0.0005]], { seg: segN(spec, 32, 12) });
    geos.push(bottom);
    return { geos, neckR: rTop - wall, height: H };
  }
  // lathe vases
  const ribbed = shape === 'ribbed';
  let samples = ribbed ? 0 : 36;
  let pitch = 0;
  if (ribbed) {
    pitch = clamp(H / 36, 0.008, 0.02);
    samples = Math.round((H / pitch) * (spec.quality === 'low' ? 2 : 3));
  }
  const S = sampleProfile(prof, samples);
  const pts = [[0.001, 0], [S[0][0] * R * 0.92, 0], [S[0][0] * R, 0.004]];
  for (let i = 1; i < S.length; i++) {
    const [r, t] = S[i];
    let rr = r * R;
    const y = Math.max(0.005, t * H);
    if (ribbed && t > 0.03 && t < 0.92) rr *= 1 - 0.035 * (0.5 - 0.5 * Math.cos((y / pitch) * TAU));
    pts.push([rr, y]);
  }
  pts.push([rTop * 0.97, H + 0.002], [rTop - wall, H - 0.002]);
  if (glass) {
    // inner surface of the glass, offset inward all the way down
    for (let i = S.length - 2; i >= 1; i--) pts.push([Math.max(0.001, S[i][0] * R - wall), Math.max(wall * 1.5, S[i][1] * H)]);
    pts.push([0.001, wall * 1.5]);
  } else {
    pts.push([rTop - wall, H - innerDepth], [0.001, H - innerDepth]);
  }
  geos.push(K.lathe(pts, { seg: segN(spec, ribbed ? 36 : 40, 14) }));
  return { geos, neckR: rTop - wall, height: H };
}

function buildKnifeBlock(spec) {
  const { w, d, h } = spec.dims, C = spec.colors, M = spec.materials;
  const g = new THREE.Group();
  const shape = [[-d / 2, 0], [d / 2, 0], [d / 2, h * 0.72], [-d / 2, h]];
  const geo = K.extrudeShape(shape, w, { bevel: 0.003, center: true });
  geo.rotateY(Math.PI / 2);
  K.worldUV(geo, 1, { grain: 'y' });
  g.add(K.partMesh(geo, mat(M.body || 'plastic', C.body), 'body'));
  const hm = mat('plastic', '#0d0d0d', { roughness: 0.35 });
  const n = Math.max(3, Math.round(w / 0.025));
  for (let i = 0; i < n; i++) {
    const x = (i - (n - 1) / 2) * (w / n) * 0.85;
    const t = (i % 2) * 0.25 + 0.35;
    const z = lerp(d / 2, -d / 2, t);
    const y = lerp(h * 0.72, h, t);
    const len = 0.09 + (i % 3) * 0.015;
    const handle = K.partMesh(K.roundedBox(0.016, len, 0.024, 0.006, 2, { bottom: true }), hm, null, { position: [x, y - 0.01, z], rotation: [-0.6, 0, 0] });
    g.add(handle);
  }
  return finish(g);
}

/** Flowers in a vase; adds meshes to g. */
function addVaseFlowers(g, spec, kind, { neckY, neckR, top }) {
  const P = spec.params, C = spec.colors;
  const q = qOf(spec);
  const res = atlasRes(spec);
  const cells = leafAtlas(res).cells;
  const R = K.rng(`flowers:${kind}:${P.seed ?? 1}:${Math.round(top * 100)}`);
  const c = { R, q, cells, stems: [], leaves: new Mesher(), extra: {} };
  const fl = new Mesher();
  const origin = V3(0, neckY - 0.02, 0);
  const span = Math.max(0.05, top - origin.y);
  const flowerHex = C.flowers || (kind === 'pampas' ? '#e3d8cc' : kind === 'hydrangea' ? '#9fb8d8' : '#8fa39a');
  let flowerLook = 'flower', leafHex = '#5c8746';
  if (kind === 'hydrangea') {
    const heads = clamp(Math.round(num(P.heads, span / 0.12)), 1, 6);
    for (let k = 0; k < heads; k++) {
      const az = k * 2.4 + R.range(-0.4, 0.4);
      const hr = clamp(span * 0.2, 0.05, 0.1) * R.range(0.85, 1.1);
      const off = (heads > 1 ? R.range(0.05, 0.11) : 0.01) * Math.min(1.4, span / 0.35);
      const cy = top - hr * 0.9 - (k === 0 ? 0 : R.range(0.02, 0.14) * span);
      const ctr = V3(Math.cos(az) * off, cy, Math.sin(az) * off);
      const o = origin.clone().add(V3(R.range(-1, 1) * neckR * 0.4, 0, R.range(-1, 1) * neckR * 0.4));
      const stemTop = ctr.clone().add(V3(0, -hr * 0.55, 0));
      const mid = o.clone().lerp(stemTop, 0.5).add(V3(Math.cos(az) * 0.01, 0, Math.sin(az) * 0.01));
      c.stems.push({ geo: taperTube([o, mid, stemTop], 0.0042, 0.003, { radial: 5 }), role: 'flower-stem' });
      // the flower head: a dark core + cupped four-petal florets over the upper ~2/3 of a sphere
      const coreStart = fl.count;
      const sph = new THREE.SphereGeometry(hr * 0.66, 10, 7);
      const cp = sph.attributes.position;
      const fc = cells.floret;
      const cu = (fc[0] + fc[2]) / 2 + (fc[2] - fc[0]) * 0.2, cvv = (fc[1] + fc[3]) / 2;
      for (let i = 0; i < cp.count; i++) fl.v(V3(cp.getX(i) + ctr.x, cp.getY(i) + ctr.y, cp.getZ(i) + ctr.z), cu, cvv, [0.42, 0.45, 0.5]);
      const si = sph.index;
      for (let i = 0; i < si.count; i += 3) fl.idx.push(coreStart + si.getX(i), coreStart + si.getX(i + 1), coreStart + si.getX(i + 2));
      sph.dispose();
      const nF = Math.round(clamp(120 * (hr / 0.07) ** 2, 40, 180) * Math.min(1.2, q));
      for (let i = 0; i < nF; i++) {
        const f = (i + 0.5) / nF;
        const pol = Math.acos(1 - f * 1.55);
        const azi = i * 2.39996;
        const n = V3(Math.sin(pol) * Math.cos(azi), Math.cos(pol), Math.sin(pol) * Math.sin(azi));
        const p = ctr.clone().addScaledVector(n, hr * R.range(0.72, 1.0));
        const s = hr * R.range(0.42, 0.6);
        const tilt = perp(n).applyAxisAngle(n, R.range(0, TAU));
        n.applyAxisAngle(tilt, R.range(-0.6, 0.6)).normalize();
        const tdir = perp(n).applyAxisAngle(n, R.range(0, TAU));
        const light = R.range(0.9, 1.1) * lerp(1.05, 0.82, pol / 2);
        leafCard(fl, { base: p, dir: tdir, up: n, len: s, width: s, cell: cells.floret, seg: 2, cols: 2, cup: 0.25, offset: 0.5, tint: [light * R.range(0.95, 1.08), light * R.range(0.96, 1.04), light * R.range(0.98, 1.04)], baseShade: 1 });
      }
      // big serrated leaves along the stem
      const sc = curve([o, mid, stemTop]);
      const nl = R.int(3, 4);
      for (let j = 0; j < nl; j++) {
        const u = R.range(0.45, 0.85);
        const P0 = sc.getPointAt(u), T0 = sc.getTangentAt(u);
        const out = dirAz(az + R.range(-1.2, 1.2) + j * 2);
        const L = R.range(0.1, 0.15) * Math.min(1.3, span / 0.35);
        leafCard(c.leaves, { base: P0, dir: out.clone().multiplyScalar(0.8).addScaledVector(T0, 0.4).normalize(), up: UPV, len: L, width: L * 0.68, cell: cells.serrate, seg: 4, cols: 2, fold: 0.2, gravity: 0.5, bend: 0.2, tint: tintOf(R, 0.06) });
      }
    }
  } else if (kind === 'pampas') {
    flowerLook = 'plume';
    addPlumes(c, fl, { origin, count: clamp(Math.round(num(P.plumes ?? P.stems, 7)), 1, 14), top, fan: num(P.plumeFan, 0.75), widthF: num(P.plumeWidth, 1), lenF: num(P.plumeLength, 0.6) });
  } else if (kind === 'eucalyptus') {
    flowerLook = 'eucalyptus';
    addLeafyStems(c, fl, { origin, count: R.int(4, 5), top, fan: 0.5, cell: cells.round, leafLen: clamp(span * 0.13, 0.02, 0.045), spacing: clamp(span * 0.09, 0.02, 0.04), stemR: 0.0016 });
  } else {
    // a green sprig / twig
    flowerLook = 'default';
    addLeafyStems(c, fl, { origin, count: R.int(1, 2), top, fan: 0.25, cell: cells.ovate, leafLen: clamp(span * 0.18, 0.012, 0.045), spacing: clamp(span * 0.07, 0.008, 0.025), widthF: 0.6, stemR: 0.001 });
  }
  if (fl.count) g.add(K.partMesh(fl.build(), foliageMaterial(flowerLook, flowerHex, res), 'flowers', { noMerge: true }));
  if (c.leaves.count) g.add(K.partMesh(c.leaves.build(), foliageMaterial('default', leafHex, res), null, { noMerge: true }));
  const stemMat = mat('plant-leaf', kind === 'pampas' ? '#9c7e5e' : kind === 'eucalyptus' ? '#7d6a58' : '#5f7d45');
  for (const s of c.stems) g.add(K.partMesh(s.geo, s.role === 'plume' ? mat('plant-leaf', '#9c7e5e') : stemMat, null));
}

function buildVase(spec) {
  const P = spec.params, C = spec.colors, M = spec.materials;
  const { w, d, h } = spec.dims;
  const shape = VASE_PROFILES[P.shape] || P.shape === 'block' ? P.shape || 'round' : 'round';
  if (shape === 'block') return buildKnifeBlock(spec);
  const flowers = P.flowers && P.flowers !== 'none' ? P.flowers : null;
  const g = new THREE.Group();
  let y0 = 0;
  if (P.mat && typeof P.mat === 'object') {
    const md = num(P.mat.d, Math.min(w, d));
    const ringR = md / 2;
    const prof = [[ringR, 0], [ringR, 0.004]];
    const rings = Math.round(ringR / 0.008);
    for (let i = rings; i >= 0; i--) {
      const r = (i / rings) * ringR;
      prof.push([Math.max(0.001, r + 0.002), 0.0055], [Math.max(0.001, r), 0.0045 + (i % 2) * 0.0008]);
    }
    g.add(K.partMesh(K.lathe(prof, { seg: segN(spec, 40, 16) }), mat('rattan', P.mat.color || '#b89a70', { scale: 0.6 }), null));
    y0 = 0.0055;
  }
  const vh = flowers ? clamp(num(P.h, h * 0.45), 0.04, h) : Math.max(0.02, h - y0);
  const vd = flowers ? clamp(num(P.d, Math.min(w, d)), 0.03, 1.2) : clamp(Math.min(w, d), 0.02, 1.5);
  const kind = M.body || (shape === 'bubble' ? 'glass-clear' : 'ceramic');
  const { geos, neckR, height } = vaseGeometry(shape, vd, vh, spec, P);
  const bm = mat(kind, C.body);
  for (const geo of geos) g.add(K.partMesh(geo, bm, 'body', { position: [0, y0, 0] }));
  if (flowers) addVaseFlowers(g, spec, flowers, { neckY: y0 + height, neckR, top: h });
  const r = vd / 2;
  return finish(g, { colliders: [{ min: [-r, 0, -r], max: [r, y0 + vh, r] }] });
}

// ---------------------------------------------------------------------------------------------------------------
// Art: procedural motifs on canvas

/** Five-tone palette from a base colour (or the given palette). */
function motifPalette(hex, palette) {
  if (Array.isArray(palette) && palette.length >= 3 && palette.every((p) => /^#[0-9a-f]{6}$/i.test(p))) {
    const p = [...palette];
    while (p.length < 5) p.push(mixHex(p[p.length - 1], '#ffffff', 0.3));
    return p;
  }
  return [mixHex(hex, '#f2f0ea', 0.6), hex, mixHex(hex, '#7f9180', 0.55), mixHex(hex, '#3b4545', 0.72), mixHex(hex, '#b7c4ca', 0.55)];
}

function ell(c, x, y, rx, ry, rot = 0) {
  c.beginPath();
  c.ellipse(x, y, Math.max(0.1, rx), Math.max(0.1, ry), rot, 0, TAU);
  c.fill();
}

/** Ridge line y(x) from a few random sines (landscape layers). */
function ridge(R, base, amp) {
  const k = [R.range(1, 2.5), R.range(3, 6), R.range(8, 14)];
  const ph = [R() * TAU, R() * TAU, R() * TAU];
  return (x) => base + amp * (0.55 * Math.sin(x * k[0] + ph[0]) + 0.3 * Math.sin(x * k[1] + ph[1]) + 0.15 * Math.sin(x * k[2] + ph[2]));
}

function grain(c, W, H, R, a = 0.05) {
  const n = createCanvas(128, 128);
  const nc = n.getContext('2d');
  const img = nc.createImageData(128, 128);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = R() * 255;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  nc.putImageData(img, 0, 0);
  c.save();
  c.globalAlpha = a;
  c.globalCompositeOperation = 'overlay';
  c.fillStyle = c.createPattern(n, 'repeat');
  c.fillRect(0, 0, W, H);
  c.restore();
}

const MOTIF_PAINTERS = {
  'misty-trees'(c, W, H, R, p) {
    // painterly: short leaning brush strokes everywhere (painted sharp on scratch canvases, blurred once on
    // compositing – a canvas blur per stroke is very slow)
    const layer = () => {
      const cv = createCanvas(W, H);
      return { cv, x: cv.getContext('2d') };
    };
    const blurOnto = (l, px, alpha = 1) => {
      c.save();
      c.globalAlpha = alpha;
      c.filter = `blur(${Math.max(0.5, px).toFixed(1)}px)`;
      c.drawImage(l.cv, 0, 0);
      c.restore();
    };
    const stroke = (x, cx, cy, len, wid, ang, col, a) => {
      x.globalAlpha = a;
      x.strokeStyle = col;
      x.lineWidth = wid;
      x.lineCap = 'round';
      x.beginPath();
      x.moveTo(cx - Math.sin(ang) * len * 0.5, cy - Math.cos(ang) * len * 0.5);
      x.lineTo(cx + Math.sin(ang) * len * 0.5, cy + Math.cos(ang) * len * 0.5);
      x.stroke();
    };
    const lean = 0.18; // wind: strokes and trunks lean to the right
    const g = c.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, mixHex(p[0], p[1], 0.55));
    g.addColorStop(0.5, mixHex(p[0], p[1], 0.3));
    g.addColorStop(0.72, mixHex(p[1], p[4], 0.3));
    g.addColorStop(1, mixHex(p[4], p[0], 0.5));
    c.fillStyle = g;
    c.fillRect(0, 0, W, H);
    const hy = H * R.range(0.7, 0.74);
    // background brushwork
    const bg = layer();
    for (let i = 0; i < 900; i++) {
      const y = R() * hy;
      stroke(bg.x, R() * W, y, H * R.range(0.02, 0.07), W * R.range(0.006, 0.02), lean + R.range(-0.2, 0.25), R.pick([p[0], p[1], '#ffffff', p[4], mixHex(p[1], p[2], 0.5), mixHex(p[1], p[3], 0.3)]), R.range(0.08, 0.22));
    }
    blurOnto(bg, W * 0.002);
    // trees: canopy behind, trunk, canopy in front
    const n = R.int(8, 11);
    const trees = [];
    for (let i = 0; i < n; i++) {
      const x0 = (0.04 + (0.92 * (i + R.range(0.1, 0.9))) / n) * W;
      trees.push({ x0, top: hy - H * R.range(0.38, 0.62), w: W * R.range(0.005, 0.009), lean: R.range(0.08, 0.2) });
    }
    const canopy = (l, t, count, dark) => {
      const fh = hy - t.top;
      for (let k = 0; k < count; k++) {
        const f = Math.pow(R(), 0.8);
        const y = t.top - fh * 0.12 + f * fh * 0.62;
        const spread = W * (0.035 + 0.035 * (1 - f));
        const cx = t.x0 + Math.tan(t.lean) * (hy - y) + R.range(-1, 1) * spread;
        const col = dark ? R.pick([p[3], mixHex(p[3], p[2], 0.4), mixHex(p[3], '#2a2e2c', 0.4)]) : R.pick([p[2], mixHex(p[2], p[1], 0.5), mixHex(p[2], p[3], 0.35), p[1]]);
        stroke(l.x, cx, y, H * R.range(0.015, 0.055), W * R.range(0.004, 0.013), lean + R.range(-0.25, 0.3), col, dark ? R.range(0.15, 0.42) : R.range(0.1, 0.3));
      }
    };
    // soft underpainting of each crown, then the strokes on top
    const under = layer();
    for (const t of trees) {
      const fh = hy - t.top;
      for (let k = 0; k < 9; k++) {
        const y = t.top + fh * R.range(0, 0.45);
        under.x.globalAlpha = R.range(0.16, 0.34);
        under.x.fillStyle = R.pick([p[2], mixHex(p[2], p[3], 0.4), p[1]]);
        ell(under.x, t.x0 + Math.tan(t.lean) * (hy - y) + R.range(-1, 1) * W * 0.03, y, W * R.range(0.025, 0.055), H * R.range(0.05, 0.12), R.range(-0.3, 0.3));
      }
    }
    blurOnto(under, W * 0.012);
    const back = layer();
    for (const t of trees) canopy(back, t, 260, false);
    blurOnto(back, W * 0.0028);
    for (const t of trees) {
      const fh = hy - t.top;
      const tx = (y) => t.x0 + Math.tan(t.lean) * (hy - y);
      // the trunk as a tapering filled ribbon (no beads where strokes overlap), then a dry-brush pass
      c.globalAlpha = 0.72;
      c.fillStyle = mixHex(p[3], '#2b2d2c', 0.25);
      c.beginPath();
      for (let s = 0; s <= 16; s++) {
        const y = hy + H * 0.008 - ((fh * 0.9 + H * 0.008) * s) / 16;
        c.lineTo(tx(y) - (t.w / 2) * (1 - (s / 16) * 0.65), y);
      }
      for (let s = 16; s >= 0; s--) {
        const y = hy + H * 0.008 - ((fh * 0.9 + H * 0.008) * s) / 16;
        c.lineTo(tx(y) + (t.w / 2) * (1 - (s / 16) * 0.65), y);
      }
      c.fill();
      for (let s = 0; s < 10; s++) {
        const y = hy - fh * R.range(0.05, 0.95);
        c.globalAlpha = R.range(0.15, 0.35);
        c.fillStyle = R() < 0.5 ? p[1] : p[0];
        c.fillRect(tx(y) - t.w * 0.4, y, t.w * R.range(0.2, 0.6), H * R.range(0.005, 0.02));
      }
      // a fork or two near the top
      for (let b = 0; b < R.int(0, 2); b++) {
        const yb = t.top + fh * R.range(0.2, 0.42);
        const s = R.sign();
        c.globalAlpha = 0.55;
        c.strokeStyle = mixHex(p[3], '#2b2d2c', 0.35);
        c.lineCap = 'round';
        c.lineWidth = t.w * 0.35;
        c.beginPath();
        c.moveTo(tx(yb), yb);
        c.quadraticCurveTo(tx(yb) + s * W * 0.006, yb - fh * 0.08, tx(yb) + s * W * R.range(0.012, 0.025), yb - fh * R.range(0.12, 0.2));
        c.stroke();
      }
    }
    const front = layer();
    for (const t of trees) canopy(front, t, 90, true);
    blurOnto(front, W * 0.0016, 0.9);
    // shoreline band of grassy bushes and its reflection
    const band = layer();
    const dark = mixHex(p[3], '#232726', 0.45);
    for (let i = 0; i < 1400; i++) {
      const x = R() * W;
      const y = hy + H * R.range(-0.035, 0.012) * (0.5 + 0.5 * Math.sin(x * 0.02 + 1.3));
      stroke(band.x, x, y, H * R.range(0.008, 0.035), W * R.range(0.002, 0.006), R.range(-0.3, 0.3), R() < 0.6 ? dark : p[3], R.range(0.3, 0.75));
    }
    for (let i = 0; i < 600; i++) {
      const x = R() * W;
      stroke(band.x, x, hy + H * R.range(0.02, 0.12), H * R.range(0.02, 0.07), W * R.range(0.002, 0.008), R.range(-0.05, 0.05), R.pick([p[3], p[1], dark]), R.range(0.04, 0.18));
    }
    blurOnto(band, W * 0.0012);
    // pale water and mist
    const water = layer();
    for (let i = 0; i < 260; i++) {
      stroke(water.x, R() * W, R.range(hy + H * 0.03, H), H * R.range(0.02, 0.06), W * R.range(0.008, 0.02), R.range(-0.08, 0.08), R.pick(['#ffffff', p[0], p[4]]), R.range(0.1, 0.3));
    }
    blurOnto(water, W * 0.002);
    const m = c.createLinearGradient(0, hy - H * 0.3, 0, hy);
    m.addColorStop(0, 'rgba(255,255,255,0)');
    m.addColorStop(0.65, 'rgba(255,255,255,0.18)');
    m.addColorStop(1, 'rgba(255,255,255,0.03)');
    c.globalAlpha = 1;
    c.fillStyle = m;
    c.fillRect(0, 0, W, hy);
    grain(c, W, H, R, 0.06);
  },
  abstract(c, W, H, R, p, hc) {
    const base = p[1];
    // relief pieces stay tonal (the structure carries them); painted ones get a small earthy palette
    const tones = p.mono
      ? [mixHex(base, '#ffffff', 0.07), mixHex(base, '#000000', 0.18), mixHex(base, '#ffffff', 0.03), mixHex(base, '#000000', 0.08), mixHex(base, '#ffffff', 0.12)]
      : [mixHex(base, '#f5f1ea', 0.5), mixHex(base, '#141210', 0.5), mixHex(base, '#b0784e', 0.4), mixHex(base, '#7d8a86', 0.4), mixHex(base, '#ffffff', 0.75)];
    const both = (fn) => {
      fn(c, false);
      if (hc) fn(hc, true);
    };
    both((x, isH) => {
      x.fillStyle = isH ? gray(0.4) : base;
      x.fillRect(0, 0, W, H);
    });
    // brushy background
    for (let i = 0; i < 280; i++) {
      const col = R.pick([tones[0], tones[1], base, tones[4]]);
      const x = R() * W, y = R() * H, l = W * R.range(0.05, 0.2), a = R.range(-0.35, 0.35) + (R() < 0.5 ? 0 : Math.PI / 2);
      const lw = W * R.range(0.006, 0.022), al = R.range(0.025, 0.06);
      both((cx, isH) => {
        cx.lineCap = 'round';
        cx.globalAlpha = isH ? al * 2.5 : al;
        cx.strokeStyle = isH ? gray(R() < 0.5 ? 0.5 : 0.3) : col;
        cx.lineWidth = lw;
        cx.beginPath();
        cx.moveTo(x, y);
        cx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
        cx.stroke();
      });
    }
    const shapes = R.int(3, 5);
    for (let s = 0; s < shapes; s++) {
      const type = R.pick(['arch', 'circle', 'half', 'blob', 'slab']);
      const col = R.pick(tones.slice(0, 4));
      const cx0 = R.range(0.2, 0.8) * W, cy0 = R.range(0.2, 0.8) * H, r = R.range(0.12, 0.3) * Math.min(W, H);
      const hv = R.range(0.65, 0.95);
      const draw = (x, isH) => {
        x.globalAlpha = isH ? 1 : R.range(0.75, 0.95);
        x.fillStyle = isH ? gray(hv) : col;
        x.strokeStyle = x.fillStyle;
        x.beginPath();
        if (type === 'arch') {
          x.lineWidth = r * 0.45;
          x.lineCap = 'butt';
          x.arc(cx0, cy0 + r * 0.4, r, Math.PI, TAU);
          x.stroke();
          return;
        }
        if (type === 'circle') x.arc(cx0, cy0, r * 0.7, 0, TAU);
        else if (type === 'half') x.arc(cx0, cy0, r, Math.PI, TAU);
        else if (type === 'slab') x.roundRect(cx0 - r * 0.35, cy0 - r, r * 0.7, r * 2, r * 0.35);
        else {
          for (let k = 0; k <= 8; k++) {
            const a = (k / 8) * TAU, rr = r * (0.7 + 0.3 * Math.sin(a * 3 + s));
            if (k === 0) x.moveTo(cx0 + Math.cos(a) * rr, cy0 + Math.sin(a) * rr);
            else x.quadraticCurveTo(cx0 + Math.cos(a - 0.4) * rr * 1.15, cy0 + Math.sin(a - 0.4) * rr * 1.15, cx0 + Math.cos(a) * rr, cy0 + Math.sin(a) * rr);
          }
        }
        x.fill();
      };
      both(draw);
      // dry-brush texture inside the shape
      for (let k = 0; k < 26; k++) {
        const x = cx0 + R.range(-1, 1) * r, y = cy0 + R.range(-1, 1) * r;
        const tcol = mixHex(col, R() < 0.5 ? '#ffffff' : '#000000', 0.12);
        const lw = W * R.range(0.004, 0.012);
        both((cx, isH) => {
          cx.lineCap = 'round';
          cx.globalAlpha = isH ? 0.14 : 0.07;
          cx.strokeStyle = isH ? gray(hv + 0.08) : tcol;
          cx.lineWidth = lw;
          cx.beginPath();
          cx.moveTo(x, y);
          cx.lineTo(x + W * 0.05, y + R.range(-1, 1) * W * 0.01);
          cx.stroke();
        });
      }
    }
    // a couple of fine lines
    c.globalAlpha = 0.8;
    c.strokeStyle = tones[1];
    c.lineWidth = W * 0.003;
    for (let i = 0; i < 2; i++) {
      c.beginPath();
      const y = R.range(0.2, 0.8) * H;
      c.moveTo(R.range(0, 0.3) * W, y);
      c.bezierCurveTo(W * 0.4, y + R.range(-0.2, 0.2) * H, W * 0.6, y + R.range(-0.2, 0.2) * H, R.range(0.7, 1) * W, y + R.range(-0.1, 0.1) * H);
      c.stroke();
    }
    c.globalAlpha = 1;
    if (hc) hc.globalAlpha = 1;
    grain(c, W, H, R, 0.05);
  },
  landscape(c, W, H, R, p) {
    const sky = c.createLinearGradient(0, 0, 0, H * 0.7);
    sky.addColorStop(0, mixHex(p[1], '#9fb3c3', 0.5));
    sky.addColorStop(1, mixHex(p[1], '#f1e9dc', 0.65));
    c.fillStyle = sky;
    c.fillRect(0, 0, W, H);
    c.filter = `blur(${Math.round(W * 0.01)}px)`;
    c.globalAlpha = 0.8;
    c.fillStyle = mixHex(p[1], '#f6e6c8', 0.7);
    ell(c, R.range(0.25, 0.75) * W, H * R.range(0.2, 0.35), W * 0.06, W * 0.06);
    c.filter = 'none';
    const layers = 4;
    for (let l = 0; l < layers; l++) {
      const t = l / (layers - 1);
      const y0 = H * lerp(0.42, 0.78, t);
      const f = ridge(R, y0, H * lerp(0.08, 0.04, t));
      c.globalAlpha = 1;
      c.fillStyle = mixHex(mixHex(p[1], '#a9b6c0', 0.5), mixHex(p[1], '#3c463f', 0.6), t);
      c.beginPath();
      c.moveTo(0, H);
      for (let x = 0; x <= W; x += W / 80) c.lineTo(x, f((x / W) * 6));
      c.lineTo(W, H);
      c.fill();
      const mist = c.createLinearGradient(0, y0 - H * 0.05, 0, y0 + H * 0.12);
      mist.addColorStop(0, 'rgba(255,255,255,0)');
      mist.addColorStop(0.55, 'rgba(255,255,255,0.22)');
      mist.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = mist;
      c.fillRect(0, y0 - H * 0.05, W, H * 0.17);
    }
    grain(c, W, H, R, 0.05);
  },
  botanical(c, W, H, R, p) {
    c.fillStyle = mixHex(p[1], '#f4efe6', 0.7);
    c.fillRect(0, 0, W, H);
    const ink = mixHex('#5d6b4a', p[1], 0.15);
    const stem = [[0.5 * W, 0.9 * H], [0.47 * W, 0.6 * H], [0.53 * W, 0.35 * H], [0.49 * W, 0.12 * H]];
    c.strokeStyle = ink;
    c.lineWidth = W * 0.006;
    c.lineCap = 'round';
    c.beginPath();
    c.moveTo(...stem[0]);
    c.bezierCurveTo(...stem[1], ...stem[2], ...stem[3]);
    c.stroke();
    const n = R.int(9, 13);
    for (let i = 0; i < n; i++) {
      const t = 0.12 + (0.82 * i) / n;
      const y = lerp(0.88, 0.14, t) * H;
      const x = (0.5 + 0.02 * Math.sin(t * 7)) * W;
      const s = i % 2 ? 1 : -1;
      const L = W * R.range(0.12, 0.2) * (1 - t * 0.4);
      const a = s * R.range(0.5, 0.9) - Math.PI / 2;
      c.save();
      c.translate(x, y);
      c.rotate(a + Math.PI / 2);
      c.globalAlpha = R.range(0.75, 0.95);
      c.fillStyle = R() < 0.3 ? mixHex(ink, '#a4ae8a', 0.5) : mixHex(ink, '#7f8f63', 0.3);
      c.beginPath();
      c.moveTo(0, 0);
      c.quadraticCurveTo(L * 0.35 * s, -L * 0.5, 0, -L);
      c.quadraticCurveTo(-L * 0.12 * s, -L * 0.5, 0, 0);
      c.fill();
      c.strokeStyle = mixHex(ink, '#2a3020', 0.4);
      c.lineWidth = W * 0.0015;
      c.beginPath();
      c.moveTo(0, 0);
      c.lineTo(0.03 * L * s, -L * 0.95);
      c.stroke();
      c.restore();
    }
    c.globalAlpha = 1;
    grain(c, W, H, R, 0.04);
  },
  'line-art'(c, W, H, R, p) {
    c.fillStyle = mixHex(p[1], '#efe8dc', 0.6);
    c.fillRect(0, 0, W, H);
    c.globalAlpha = 0.9;
    c.fillStyle = mixHex('#c08a6a', p[1], 0.3);
    ell(c, R.range(0.35, 0.65) * W, R.range(0.35, 0.6) * H, Math.min(W, H) * 0.2, Math.min(W, H) * 0.2);
    c.globalAlpha = 1;
    const pts = [];
    for (let i = 0; i < 14; i++) pts.push([R.range(0.2, 0.8) * W, R.range(0.15, 0.85) * H]);
    c.strokeStyle = '#1c1a18';
    c.lineWidth = Math.min(W, H) * 0.0045;
    c.lineCap = 'round';
    c.beginPath();
    c.moveTo(...pts[0]);
    for (let i = 1; i < pts.length - 1; i++) c.quadraticCurveTo(...pts[i], (pts[i][0] + pts[i + 1][0]) / 2, (pts[i][1] + pts[i + 1][1]) / 2);
    c.stroke();
    grain(c, W, H, R, 0.04);
  },
  photo(c, W, H, R, p) {
    const sky = c.createLinearGradient(0, 0, 0, H * 0.55);
    sky.addColorStop(0, mixHex('#9fb2c2', p[1], 0.25));
    sky.addColorStop(1, mixHex('#eef0ee', p[1], 0.15));
    c.fillStyle = sky;
    c.fillRect(0, 0, W, H);
    const hz = H * R.range(0.5, 0.58);
    for (let l = 0; l < 2; l++) {
      const f = ridge(R, hz - H * (0.04 + 0.04 * (1 - l)), H * 0.07);
      c.fillStyle = l ? mixHex('#4f5d66', p[1], 0.2) : mixHex('#7d8c96', p[1], 0.2);
      c.beginPath();
      c.moveTo(0, hz);
      for (let x = 0; x <= W; x += W / 100) c.lineTo(x, f((x / W) * 5));
      c.lineTo(W, hz);
      c.fill();
    }
    const water = c.createLinearGradient(0, hz, 0, H);
    water.addColorStop(0, mixHex('#8e9ea8', p[1], 0.2));
    water.addColorStop(1, mixHex('#3f4b52', p[1], 0.2));
    c.fillStyle = water;
    c.fillRect(0, hz, W, H - hz);
    c.fillStyle = '#ffffff';
    for (let i = 0; i < 40; i++) {
      c.globalAlpha = R.range(0.05, 0.2);
      c.fillRect(R() * W, R.range(hz, H), W * R.range(0.05, 0.25), Math.max(1, H * 0.003));
    }
    c.globalAlpha = 1;
    c.fillStyle = mixHex('#2c2f2e', p[1], 0.1);
    for (const sx of [-1, 1]) {
      c.beginPath();
      const x0 = sx < 0 ? 0 : W;
      c.moveTo(x0, H);
      c.lineTo(x0, H * R.range(0.68, 0.8));
      c.quadraticCurveTo(x0 - sx * W * 0.2, H * R.range(0.72, 0.85), x0 - sx * W * R.range(0.3, 0.42), H);
      c.fill();
    }
    grain(c, W, H, R, 0.09);
  },
};
MOTIF_PAINTERS.custom = MOTIF_PAINTERS.photo;

/** Averages a canvas border strip → '#rrggbb'. */
/**
 * Mean colour of the outer band of a motif canvas (wrapped canvas edges, fabric sides). Reading border strips of the
 * full-size canvas needed a CPU-backed (willReadFrequently) canvas, i.e. a software rasterisation of every painting,
 * with the flush of all its strokes and blurs landing in that readback. Now the motif canvas stays GPU-backed and
 * only a 32 × 32 filtered copy is read (4 KB): its ring of outer texels ≈ the outer 3 % of the picture (within ±2
 * levels of the old strip average for every motif).
 */
function borderColor(cv) {
  const n = 32;
  const s = createCanvas(n, n);
  const sc = s.getContext('2d', { willReadFrequently: true });
  sc.imageSmoothingEnabled = true;
  sc.imageSmoothingQuality = 'high';
  sc.drawImage(cv, 0, 0, n, n);
  const d = sc.getImageData(0, 0, n, n).data;
  let r = 0, g = 0, b = 0, k = 0;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (x > 0 && x < n - 1 && y > 0 && y < n - 1) continue;
      const i = (y * n + x) * 4;
      r += d[i];
      g += d[i + 1];
      b += d[i + 2];
      k++;
    }
  }
  const hx = (v) => Math.round(v / k).toString(16).padStart(2, '0');
  return `#${hx(r)}${hx(g)}${hx(b)}`;
}

/**
 * Small LRU of print materials (one per motif × colour × size × surface). Eviction only drops the reference (the
 * PRINTS dispose is a no-op): a material still on a mesh keeps working, its shader program is shared by every print,
 * and it is garbage-collected later – disposing it released the shared program and stalled the next picture on a
 * recompile. Textures live in ArtCaches (models/artcache.js), which never dispose what a live material samples.
 */
class Lru {
  constructor(limit, dispose) {
    this.limit = limit;
    this.dispose = dispose;
    this.map = new Map();
  }

  get(key, make) {
    let v = this.map.get(key);
    if (v !== undefined) {
      this.map.delete(key);
      this.map.set(key, v);
      return v;
    }
    v = make();
    this.map.set(key, v);
    while (this.map.size > this.limit) {
      const [k0, v0] = this.map.entries().next().value;
      this.map.delete(k0);
      try {
        this.dispose(v0);
      } catch {
        /* ignore */
      }
    }
    return v;
  }
}
/** Motif canvases (+ relief normal maps), by motif × seed × colour × palette × aspect × size × relief × motifOpts. */
const MOTIFS = new ArtCache({
  budgetPx: ART_BUDGET_PX.medium,
  dispose: (a) => {
    a.map?.dispose();
    a.normalMap?.dispose();
  },
});
/** Gallery-wall atlases (art-set: every generated print of a set in one texture). */
const ATLAS = new ArtCache({ budgetPx: ART_BUDGET_PX.medium, maxEntries: 32, dispose: (a) => a.map?.dispose() });
const PRINTS = new Lru(48, () => {});
/** The art caches keep the pixel budget of the highest render quality requested so far. */
function artBudget(spec) {
  const b = ART_BUDGET_PX[spec?.quality] ?? ART_BUDGET_PX.medium;
  MOTIFS.raiseBudget(b);
  ATLAS.raiseBudget(b);
}

/** Debug / test hook (tools/artcheck.mjs): cache statistics of the motif, atlas and uploaded-picture textures. */
export const _artDebug = Object.freeze({
  stats: () => ({ motifs: MOTIFS.stats(), atlas: ATLAS.stats(), custom: customImageStats(), prints: PRINTS.map.size }),
});

/** Default colors.print of art-frame / art-set: a motif keeps its own palette until the print colour is changed. */
const DEFAULT_PRINT = '#c9cfcd';
const HEX6 = /^#[0-9a-f]{6}$/i;
/** A palette motifPalette accepts (≥ 3 '#rrggbb'). */
const validPalette = (p) => Array.isArray(p) && p.length >= 3 && p.every((x) => typeof x === 'string' && HEX6.test(x));
/** A motif of models/artmotifs.js (not one of the six legacy painters of this file, which never change). */
const isNewMotif = (motif) => typeof motif === 'string' && Object.hasOwn(ART_MOTIFS, motif) && !LEGACY_MOTIFS.includes(motif);
const clampInt = (v, a, b, fb) => Math.round(clamp(num(Number(v), fb), a, b));

/**
 * Five tones for a motif (design/art.md §2.6): the item's palette (main = the print colour), else the motif's own
 * palette (main = the print colour once it differs from the default), else derived from the print colour (legacy).
 */
function artPalette(motif, hex, palette) {
  if (validPalette(palette)) {
    const p = motifPalette(hex, palette);
    p[1] = hex;
    return p;
  }
  const def = isNewMotif(motif) ? ART_MOTIFS[motif] : null;
  if (def && validPalette(def.palette)) {
    const p = motifPalette(def.palette[1], def.palette);
    if (String(hex).toLowerCase() !== DEFAULT_PRINT) p[1] = hex;
    return p;
  }
  return motifPalette(hex, null);
}

const _artWarned = new Set();
/**
 * Paints `motif` into c (W × H): a legacy painter of this file, else a models/artmotifs.js painter. An unknown key
 * paints 'abstract' (same rng key, as before); a new painter that throws is logged once and replaced by 'abstract'.
 */
function paintMotif(c, W, H, motif, seed, pal, hc, opts) {
  const rngKey = `motif:${motif}:${seed}`;
  if (isNewMotif(motif)) {
    try {
      if (paintArt(c, W, H, motif, K.rng(rngKey), pal, { hc, opts })) return;
    } catch (err) {
      if (!_artWarned.has(motif)) {
        _artWarned.add(motif);
        console.warn(`[art] motif «${motif}» failed – painting 'abstract' instead`, err);
      }
      c.fillStyle = pal[0];
      c.fillRect(0, 0, W, H);
    }
  }
  (MOTIF_PAINTERS[motif] || MOTIF_PAINTERS.abstract)(c, W, H, K.rng(rngKey), pal, hc);
}

/** Motif artwork (canvas texture + border colour + optional relief normal map), cached in MOTIFS (an ArtCache entry:
 * the caller registers its material with MOTIFS.use right away). */
function motifArt({ motif, seed, hex, palette, aspect, res, relief, opts }) {
  const a = quantAspect(aspect);
  const ok = isNewMotif(motif) ? motifOptsKey(motif, opts) : '';
  const key = `${motif}|${seed}|${hex}|${Array.isArray(palette) ? palette.join(',') : ''}|${a.toFixed(3)}|${res}|${relief || ''}${ok ? `|${ok}` : ''}`;
  const hit = MOTIFS.get(key);
  if (hit) return hit;
  const W = a >= 1 ? res : Math.round(res * a), H = a >= 1 ? Math.round(res / a) : res;
  const cv = createCanvas(W, H);
  const c = cv.getContext('2d'); // GPU-backed: nothing reads it back at full size (see borderColor)
  let hcv = null, hc = null;
  // a height canvas for 'relief': the legacy painters always draw one; a new motif only when it paints heights (the
  // others take their relief from the colour luminance instead of a blank height canvas)
  if (relief === 'relief' && (!isNewMotif(motif) || ART_MOTIFS[motif].relief)) {
    hcv = createCanvas(W, H);
    hc = hcv.getContext('2d');
  }
  const pal = artPalette(motif, hexOf(hex), palette);
  pal.mono = relief === 'relief';
  paintMotif(c, W, H, motif, seed, pal, hc, opts);
  const out = { map: canvasTexture(cv, { wrap: false }), edgeHex: borderColor(cv), normalMap: null };
  if (relief) {
    const sw = Math.max(64, Math.round(W / 2)), sh = Math.max(64, Math.round(H / 2));
    const small = createCanvas(sw, sh);
    const sc = small.getContext('2d', { willReadFrequently: true });
    sc.filter = 'blur(1px)';
    sc.drawImage(hcv || cv, 0, 0, sw, sh);
    const d = sc.getImageData(0, 0, sw, sh).data;
    const heights = new Float32Array(sw * sh);
    const R = K.rng(`relief:${key}`);
    for (let i = 0; i < sw * sh; i++) heights[i] = (d[i * 4] * 0.3 + d[i * 4 + 1] * 0.59 + d[i * 4 + 2] * 0.11) / 255 + R.range(-0.015, 0.015);
    out.normalMap = canvasTexture(heightToNormalCanvas(heights, sw, sh, relief === 'relief' ? 7 : 3), { wrap: false, srgb: false });
  }
  return MOTIFS.set(key, out, W * H + (out.normalMap ? (Math.max(64, Math.round(W / 2)) * Math.max(64, Math.round(H / 2))) : 0));
}

/** Normal map of a fabric/paper kind with UV channel 1 (metre UVs next to the 0..1 motif UVs). */
function surfaceNormal(kind) {
  return cached(`decor:surfN:${kind}`, () => {
    const base = mat(kind).normalMap;
    if (!base) return null;
    const t = base.clone();
    t.channel = 1;
    return t;
  });
}

/**
 * Material parameters of a flat print (no relief): the picture map on 0..1 UVs and the paper / fabric weave normals on
 * UV channel 1. Generated prints, gallery-wall atlases and uploaded pictures share this layout – one shader program.
 */
function flatPrintParams(map, texture, fabric) {
  const p = { map, roughness: 0.86, metalness: 0 };
  const n = surfaceNormal(texture === 'paper' || texture === 'photo' ? 'paper' : fabric || 'linen');
  if (n) {
    p.normalMap = n;
    p.normalScale = new THREE.Vector2(texture === 'photo' ? 0.15 : 0.45, texture === 'photo' ? 0.15 : 0.45);
  }
  if (texture === 'photo') p.roughness = 0.5;
  return p;
}

/** Picture behind glass (params.glass): uniforms only – the same program as without glass. */
function glassy(p) {
  p.roughness = 0.22;
  if (p.normalScale) p.normalScale.set(0.04, 0.04);
  p.envMapIntensity = 0.9;
  return p;
}

/**
 * Print / painting surface material (motif map on 0..1 UVs, canvas weave / relief normals), cached; recolour makes
 * the motif in the new base colour.
 */
function printMaterial(o) {
  const hex = hexOf(o.hex, DEFAULT_PRINT);
  const texture = o.texture || 'canvas';
  const ok = isNewMotif(o.motif) ? motifOptsKey(o.motif, o.opts) : '';
  const key = `${o.motif}|${o.seed}|${hex}|${Array.isArray(o.palette) ? o.palette.join(',') : ''}|${quantAspect(o.aspect).toFixed(3)}|${o.res}|${texture}|${o.fabric || ''}${ok ? `|${ok}` : ''}${o.glass ? '|g' : ''}`;
  return PRINTS.get(key, () => {
    const relief = texture === 'relief' ? 'relief' : texture === 'painted' ? 'painted' : null;
    const art = motifArt({ motif: o.motif, seed: o.seed, hex, palette: o.palette, aspect: o.aspect, res: o.res, relief, opts: o.opts });
    let p;
    if (relief) {
      p = { map: art.map, roughness: 0.86, metalness: 0 };
      p.normalMap = art.normalMap;
      p.normalScale = new THREE.Vector2(relief === 'relief' ? 1.1 : 0.6, relief === 'relief' ? 1.1 : 0.6);
      p.roughness = relief === 'relief' ? 0.8 : 0.72;
    } else p = flatPrintParams(art.map, texture, o.fabric);
    if (o.glass) glassy(p);
    const m = new THREE.MeshStandardMaterial(p);
    m.name = `print ${o.motif} ${hex}`;
    m.userData = { shared: true, kind: 'print', hex, edgeHex: art.edgeHex, decorRecolor: (nh) => printMaterial({ ...o, hex: nh }) };
    MOTIFS.use(art, m);
    return m;
  });
}

/**
 * Material of an uploaded picture (models/artcustom.js entry): exactly the layout of a flat printMaterial (map + weave
 * normals on UV channel 1), so no new shader program; recolouring a photo is a no-op.
 */
function customPrintMaterial(entry, { texture = 'photo', fabric = null, glass = false } = {}) {
  const tex = texture === 'relief' || texture === 'painted' ? 'canvas' : texture;
  const key = `custom|${entry.key}|${tex}|${fabric || ''}|${glass ? 'g' : ''}`;
  const m = PRINTS.get(key, () => {
    const p = flatPrintParams(entry.map, tex, fabric);
    if (glass) glassy(p);
    const mm = new THREE.MeshStandardMaterial(p);
    mm.name = `print custom ${entry.key}`;
    mm.userData = { shared: true, kind: 'print', hex: '#e6e2da', edgeHex: entry.edgeHex, decorRecolor: () => mm };
    return mm;
  });
  // (again on every use: a new entry under the same key after the old one was swept gets its user registered)
  useCustomTexture(entry, m);
  return m;
}

/** Plane with 0..1 UVs (motif; or the sub-rectangle uvRect [u0, v0, u1, v1] of an atlas / a span) and metre UVs in
 * uv1 (surface normals). */
function printPlane(w, h, uvRect = null) {
  const g = new THREE.PlaneGeometry(w, h);
  const pos = g.attributes.position;
  const uv1 = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    uv1[i * 2] = pos.getX(i);
    uv1[i * 2 + 1] = pos.getY(i);
  }
  g.setAttribute('uv1', new THREE.BufferAttribute(uv1, 2));
  if (uvRect) {
    const [u0, v0, u1, v1] = uvRect;
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + uv.getX(i) * (u1 - u0), v0 + uv.getY(i) * (v1 - v0));
  }
  return g;
}

/**
 * mat() options of a picture frame by kind: painted and powder-coated bars ('painted', 'black-metal' – the 'peel'
 * texture, a 12 cm tile made for furniture panels) get it at 0.3 × (3.6 cm), so a 1 cm bar seen close reads smooth
 * matte instead of hammered. Other kinds keep their texture (wood grain, brushed alu). Also the recolour rule of the
 * art builders' 'frame' part (finish optsMap), so the fine peel never follows the frame onto wood.
 */
const FINE_PEEL = Object.freeze({ scale: 0.3 });
const frameOpts = (kind) => (kind === 'painted' || kind === 'black-metal' ? FINE_PEEL : undefined);
/** Frame material (see frameOpts). */
const frameMaterial = (kind, hex) => mat(kind, hex, frameOpts(kind));
/** finish() options of the art builders: the 'frame' part recolours with frameOpts. */
const FRAME_FINISH = Object.freeze({ optsMap: Object.freeze({ frame: frameOpts }) });

/**
 * Four frame bars around (w × h), `depth` deep from z0; optional inner step for wooden frames (step) and rounded bars
 * (round = edge radius, the aluminium profile). Adds to g with part `part` (null = a fixed finish, not recoloured).
 */
function addFrameBars(g, w, h, fw, depth, m, { step = 0, z0 = 0, round = 0, part = 'frame' } = {}) {
  const bar = (bw, bh, bd, grain) => (round > 0 ? K.roundedBox(bw, bh, bd, round, 1, { grain }) : K.box(bw, bh, bd, { grain }));
  const bars = [
    [bar(w, fw, depth, 'x'), 0, h / 2 - fw / 2],
    [bar(w, fw, depth, 'x'), 0, -h / 2 + fw / 2],
    [bar(fw, h - 2 * fw, depth, 'y'), -w / 2 + fw / 2, 0],
    [bar(fw, h - 2 * fw, depth, 'y'), w / 2 - fw / 2, 0],
  ];
  for (const [geo, x, y] of bars) g.add(K.partMesh(geo, m, part, { position: [x, y, z0 + depth / 2] }));
  if (step > 0) {
    const sw = fw * 0.35, sd = depth * 0.8;
    const iw = w - 2 * fw, ih = h - 2 * fw;
    const inner = [
      [K.box(iw, sw, sd, { grain: 'x' }), 0, ih / 2 - sw / 2],
      [K.box(iw, sw, sd, { grain: 'x' }), 0, -ih / 2 + sw / 2],
      [K.box(sw, ih - 2 * sw, sd, { grain: 'y' }), -iw / 2 + sw / 2, 0],
      [K.box(sw, ih - 2 * sw, sd, { grain: 'y' }), iw / 2 - sw / 2, 0],
    ];
    for (const [geo, x, y] of inner) g.add(K.partMesh(geo, m, part, { position: [x, y, z0 + sd / 2] }));
  }
}

/**
 * The frame of a picture of outer size w × h by profile (models/artlayout.js FRAME_PROFILES; the legacy profiles keep
 * their exact round-1 geometry):
 *   thin/black/floater 4 bars · oak/white 4 bars + inner step · alu 4 rounded bars · box 4 bars + a front lip inside
 *   them · ornate 3 stepped rings (one material) · hanger 2 battens (front and back strip) + an optional cord
 */
function addFrame(g, L, w, h, m, part = 'frame', cord = true) {
  const { fw, depth } = L;
  switch (L.frame) {
    case 'hanger': {
      const bw = w + 0.01, t = 0.006;
      for (const y of [h / 2 - fw / 2, -h / 2 + fw / 2]) {
        for (const z of [t / 2, HANGER_Z + t / 2]) g.add(K.partMesh(K.box(bw, fw, t, { grain: 'x' }), m, part, { position: [0, y, z] }));
      }
      if (cord) {
        // a cord from the top batten's ends to a nail 12 cm above the poster (fixed black, not recoloured)
        const cm = mat('black-metal', '#2a2a2a');
        const top = h / 2 + 0.12;
        for (const s of [-1, 1]) {
          const x0 = s * (bw / 2 - 0.012), y0 = h / 2;
          const len = Math.hypot(x0, top - y0);
          g.add(K.partMesh(K.box(len, 0.002, 0.002), cm, null, { position: [x0 / 2, (y0 + top) / 2, t / 2], rotation: [0, 0, Math.atan2(top - y0, -x0)] }));
        }
      }
      return;
    }
    case 'alu':
      addFrameBars(g, w, h, fw, depth, m, { round: Math.min(0.0015, fw / 3), part });
      return;
    case 'ornate':
      addFrameBars(g, w, h, fw * 0.45, depth, m, { part });
      addFrameBars(g, w - 0.9 * fw, h - 0.9 * fw, fw * 0.35, depth * 0.8, m, { part });
      addFrameBars(g, w - 1.6 * fw, h - 1.6 * fw, fw * 0.2, depth * 0.9, m, { part });
      return;
    case 'box': {
      addFrameBars(g, w, h, fw, depth, m, { part });
      const ld = Math.min(0.006, depth);
      if (L.lipW > 0) addFrameBars(g, w - 2 * fw, h - 2 * fw, L.lipW, ld, m, { z0: depth - ld, part });
      return;
    }
    default:
      addFrameBars(g, w, h, fw, depth, m, { step: L.step, part });
  }
}

/** Side colour of a stretched canvas: params.edge 'wrap' (the picture's border colour), 'white' or 'dark'. */
function canvasEdgeHex(P, base, custom = false) {
  const mode = P?.edge || (custom ? 'white' : 'wrap');
  const b = typeof P?.edgeHex === 'string' && HEX6.test(P.edgeHex) ? P.edgeHex : base;
  return mode === 'dark' ? mixHex(b, '#2f3534', 0.65) : mode === 'white' ? '#ece9e2' : b;
}

/**
 * One picture of outer size w × h (back at z 0, centred) into g from its artLayout L: the stretched canvas body (or
 * the backing board and the passepartout of a paper print) and the frame. Returns the print plane geometry, already
 * at its z – the caller adds it (art-frame) or merges it with the other prints of a set (art-set).
 * @param {THREE.Group} g
 * @param {{ L: object, w: number, h: number, edgeHex: string, frameMat: THREE.Material|null, framePart?: string|null,
 *   matColor?: string, cord?: boolean, uvRect?: number[]|null }} o
 */
function addArtPiece(g, { L, w, h, edgeHex, frameMat, framePart = 'frame', matColor, cord = true, uvRect = null }) {
  const bw = w - 2 * L.fw, bh = h - 2 * L.fw; // inside the bars (the box lip sits inside them)
  if (!L.paperPrint) {
    // stretched canvas (alone, or floating in the frame)
    const { cd, z0 } = L;
    g.add(K.partMesh(K.roundedBox(L.openW, L.openH, cd, Math.min(0.002, cd / 4), 1), mat('cotton', edgeHex), null, { position: [0, 0, z0 + cd / 2] }));
    // shadow-gap backing behind the floating canvas
    if (L.framed) g.add(K.partMesh(K.box(bw, bh, 0.004), mat('black-metal', '#141414'), null, { position: [0, 0, 0.002] }));
  } else if (L.frame !== 'hanger') {
    g.add(K.partMesh(K.box(bw, bh, 0.004), mat('painted', '#3a3836'), null, { position: [0, 0, 0.002] }));
    if (L.matW > 0) {
      const s = K.roundedRectShape(bw, bh, 0);
      s.holes.push(new THREE.Path(K.roundedRectShape(L.picW, L.picH, 0).getPoints()));
      const geo = K.extrudeShape(s, 0.002);
      K.worldUV(geo);
      g.add(K.partMesh(geo, mat('paper', typeof matColor === 'string' && HEX6.test(matColor) ? matColor : '#f3f0e9'), null, { position: [0, 0, L.printZ + 0.0004] }));
    }
  }
  if (L.framed && frameMat) addFrame(g, L, w, h, frameMat, framePart, cord);
  return printPlane(L.planeW, L.planeH, uvRect).translate(0, 0, L.printZ);
}

/** Composition seed from the size, so different products get different pictures (until the user picks one). */
const defaultSeed = (w, h) => 1 + (Math.round(w * 100) * 31 + Math.round(h * 100) * 17) % 97;

/** Texture size of a print: the legacy motifs keep today's artRes (byte-identical); new motifs follow the print's size. */
const motifRes = (spec, motif, pw, ph) => (isNewMotif(motif) ? artResFor(spec?.quality, pw, ph) : artRes(spec));

function buildArt(spec) {
  const P = spec.params, C = spec.colors, M = spec.materials;
  const { w, h } = spec.dims;
  artBudget(spec);
  const L = artLayout(spec.dims, P);
  const custom = P.motif === 'custom' && isImageId(P.imageId);
  const motif = P.motif || 'abstract';
  const fabric = M.print === 'cotton' || M.print === 'linen' ? M.print : null;
  const g = new THREE.Group();
  let pm, edgeBase;
  if (custom) {
    const entry = customPrintTexture(P.imageId, { aspect: L.picW / L.picH, res: Math.min(artResFor(spec.quality, L.picW, L.picH), CUSTOM_MAX_RES), fit: L.draw, bg: PAPER_WHITE, focus: P.focus });
    pm = customPrintMaterial(entry, { texture: L.texture, fabric, glass: P.glass === true });
    edgeBase = entry.state === 'ready' ? entry.edgeHex : CUSTOM_EDGE_HEX;
  } else {
    const seed = P.seed == null ? defaultSeed(w, h) : clampInt(P.seed, 1, 20, 1);
    pm = printMaterial({ motif, seed, hex: C.print, palette: P.palette, aspect: L.picW / L.picH, res: motifRes(spec, motif, L.picW, L.picH), texture: L.texture, fabric, opts: P.motifOpts, glass: P.glass === true });
    edgeBase = pm.userData.edgeHex;
  }
  const frameMat = L.framed ? frameMaterial(M.frame || L.kind, C.frame) : null;
  const plane = addArtPiece(g, { L, w, h, edgeHex: canvasEdgeHex(P, edgeBase, custom), frameMat, matColor: P.matColor, cord: P.cord !== false });
  g.add(K.partMesh(plane, pm, 'print'));
  return finish(g, FRAME_FINISH);
}

// ---------------------------------------------------------------------------------------------------------------
// Gallery walls (art-set, design/art.md §4): one item and one price; the pieces of a layout (models/artlayout.js)
// scaled uniformly into dims; every generated print of the set painted into ONE atlas texture (one material, one
// merged print mesh that keeps uv1 – kit.mergeSameMaterial would drop it); uploaded pictures are separate meshes.

/** params.frames[i].finish → a fixed frame material (not part-tagged, so recolouring the set leaves it alone). */
const SET_FINISHES = Object.freeze({
  black: ['black-metal', '#151515'], white: ['painted', '#f1efea'], oak: ['oak', '#c39b6e'],
  walnut: ['walnut', '#5f4332'], gold: ['brass', '#c8a463'], alu: ['steel', '#b9bcbf'],
});
/** Gutter around each atlas cell (px; the cell's edge pixels are bled into it against mip bleeding). */
const ATLAS_PAD = 6;
/** Relief is not supported in sets: 'relief' / 'painted' map to 'canvas'. */
const setTexture = (t) => (t === 'canvas' || t === 'paper' || t === 'photo' ? t : t === 'relief' || t === 'painted' ? 'canvas' : 'paper');

/**
 * Motif of set frame i (design/art.md §4.3): params.frames[i] fields, else params.motifs[i % n], else params.motif,
 * else DEFAULT_SET_MOTIFS[(i + seed − 1) % 9]; seed defaults to params.seed + i. `palette` is the frame's own palette
 * (null = it inherits the set palette and follows the print colour).
 */
function setMotif(P, i, data = {}) {
  const seed0 = clampInt(P.seed ?? 1, 1, 20, 1);
  const list = Array.isArray(P.motifs) ? P.motifs.filter((m) => m && typeof m === 'object' && typeof m.motif === 'string' && m.motif !== 'custom') : [];
  const m = list.length ? list[i % list.length] : null;
  const own = typeof data.motif === 'string' && data.motif !== 'custom' ? data.motif : null;
  const setLevel = typeof P.motif === 'string' && P.motif && P.motif !== 'custom' ? P.motif : null;
  const motif = own ?? m?.motif ?? setLevel ?? DEFAULT_SET_MOTIFS[(i + seed0 - 1) % DEFAULT_SET_MOTIFS.length];
  const seed = clampInt(data.seed ?? m?.seed ?? seed0 + i, 1, 99, seed0 + i);
  const palette = validPalette(data.palette) ? data.palette : validPalette(m?.palette) ? m.palette : null;
  const opts = data.motifOpts ?? m?.motifOpts ?? (!own && !m && setLevel ? P.motifOpts : null) ?? null;
  return { motif, seed, palette, opts };
}

/** Cache key of a set atlas: its cells (rects in px, motif, seed, own palette, opts), the print colour and palette. */
function atlasKey(plan) {
  const cells = plan.cells.map((c) => `${c.x},${c.y},${c.w},${c.h}:${c.motif}:${c.seed}:${c.palette ? c.palette.join(',') : ''}:${isNewMotif(c.motif) ? motifOptsKey(c.motif, c.opts) : ''}`);
  return `set|${plan.W}x${plan.H}|${plan.hex}|${plan.palette ? plan.palette.join(',') : ''}|${cells.join(';')}`;
}

/** The atlas canvas of a set: each cell painted on its own canvas (any painter works), copied in and bled 6 px out. */
function atlasArt(plan, key = atlasKey(plan)) {
  const hit = ATLAS.get(key);
  if (hit) return hit;
  const cv = createCanvas(plan.W, plan.H);
  const x = cv.getContext('2d');
  x.fillStyle = '#9a968f';
  x.fillRect(0, 0, plan.W, plan.H);
  x.imageSmoothingEnabled = true;
  const p = ATLAS_PAD;
  let r = 0, g = 0, b = 0;
  for (const cell of plan.cells) {
    const { w, h } = cell;
    const cc = createCanvas(w, h);
    const c = cc.getContext('2d');
    const pal = cell.palette ? artPalette(cell.motif, hexOf(cell.palette[1]), cell.palette) : artPalette(cell.motif, plan.hex, plan.palette);
    pal.mono = false;
    paintMotif(c, w, h, cell.motif, cell.seed, pal, null, cell.opts);
    x.drawImage(cc, cell.x, cell.y);
    x.drawImage(cc, 0, 0, w, 1, cell.x, cell.y - p, w, p);
    x.drawImage(cc, 0, h - 1, w, 1, cell.x, cell.y + h, w, p);
    x.drawImage(cc, 0, 0, 1, h, cell.x - p, cell.y, p, h);
    x.drawImage(cc, w - 1, 0, 1, h, cell.x + w, cell.y, p, h);
    x.drawImage(cc, 0, 0, 1, 1, cell.x - p, cell.y - p, p, p);
    x.drawImage(cc, w - 1, 0, 1, 1, cell.x + w, cell.y - p, p, p);
    x.drawImage(cc, 0, h - 1, 1, 1, cell.x - p, cell.y + h, p, p);
    x.drawImage(cc, w - 1, h - 1, 1, 1, cell.x + w, cell.y + h, p, p);
    const e = borderColor(cc);
    r += parseInt(e.slice(1, 3), 16);
    g += parseInt(e.slice(3, 5), 16);
    b += parseInt(e.slice(5, 7), 16);
  }
  const n = Math.max(1, plan.cells.length);
  const hx = (v) => Math.round(v / n).toString(16).padStart(2, '0');
  const out = { map: canvasTexture(cv, { wrap: false }), edgeHex: plan.cells.length ? `#${hx(r)}${hx(g)}${hx(b)}` : '#ece9e2' };
  out.map.name = 'art-set atlas';
  return ATLAS.set(key, out, plan.W * plan.H);
}

/** The print material of a set's atlas (flat print layout, glass support); recolour repaints the inheriting frames. */
function setPrintMaterial(plan, look) {
  const akey = atlasKey(plan);
  const key = `${akey}|${look.texture}|${look.fabric || ''}|${look.glass ? 'g' : ''}`;
  return PRINTS.get(key, () => {
    const art = atlasArt(plan, akey);
    const p = flatPrintParams(art.map, look.texture, look.fabric);
    if (look.glass) glassy(p);
    const m = new THREE.MeshStandardMaterial(p);
    m.name = `print set ${plan.hex}`;
    m.userData = { shared: true, kind: 'print', hex: plan.hex, edgeHex: art.edgeHex, decorRecolor: (nh) => setPrintMaterial({ ...plan, hex: hexOf(nh, plan.hex) }, look) };
    ATLAS.use(art, m);
    return m;
  });
}

/** Matrix of a set piece: centre (x, y) on the wall, or leaning – rotated about its bottom edge, which stands z out. */
function pieceMatrix(f) {
  const m = new THREE.Matrix4().makeTranslation(f.x, f.y - f.h / 2, f.z || 0);
  if (f.tilt) m.multiply(new THREE.Matrix4().makeRotationX(-f.tilt));
  return m.multiply(new THREE.Matrix4().makeTranslation(0, f.h / 2, 0));
}

function buildArtSet(spec) {
  const P = spec.params, C = spec.colors, M = spec.materials;
  const q = spec.quality === 'low' || spec.quality === 'high' ? spec.quality : 'medium';
  artBudget(spec);
  const lay = galleryLayout(typeof P.layout === 'string' ? P.layout : 'salon-5', { gap: P.gap, rise: P.rise, overlap: P.overlap, mirror: P.mirror === true, frames: P.frames });
  const { frames, ledge } = fitSet(lay.frames, lay.ledge, spec.dims);
  const D = num(P.depth, spec.dims.d);
  const pieceD = clamp(ledge ? Math.min(0.025, D) : D, 0.005, 0.06);
  const hex = hexOf(C.print, DEFAULT_PRINT);
  const setPal = validPalette(P.palette) ? P.palette : null;
  const look = { texture: setTexture(P.texture), fabric: M.print === 'cotton' || M.print === 'linen' ? M.print : null, glass: P.glass === true };
  const pieces = frames.map((f, i) => {
    const data = f.data && typeof f.data === 'object' ? f.data : {};
    const custom = isImageId(data.imageId);
    const Pi = {
      frame: typeof data.frame === 'string' ? data.frame : typeof P.frame === 'string' ? P.frame : 'thin',
      frameW: num(data.frameW, P.frameW), mat: typeof data.mat === 'boolean' ? data.mat : P.mat !== false,
      matW: num(data.matW, P.matW), matH: num(data.matH, P.matH), texture: setTexture(data.texture ?? P.texture), depth: pieceD,
    };
    if (custom) Object.assign(Pi, { motif: 'custom', imageId: data.imageId, imageAspect: data.imageAspect, fit: data.fit });
    return {
      f, data, custom, mo: setMotif(P, i, data), L: artLayout({ w: f.w, h: f.h, d: pieceD }, Pi),
      matColor: data.matColor ?? P.matColor, finish: Object.hasOwn(SET_FINISHES, data.finish ?? '') ? data.finish : null, uvRect: null,
    };
  });
  const gen = pieces.filter((p) => !p.custom);
  let pm = null;
  if (gen.length && lay.span) {
    // one motif across all panels (triptych): painted at the bounding box of the print planes, each plane its share
    const sp = spanRects(gen.map((p) => ({ x: p.f.x, y: p.f.y, w: p.L.planeW, h: p.L.planeH })));
    const mo = setMotif(P, 0, {});
    pm = printMaterial({ motif: mo.motif, seed: mo.seed, hex: mo.palette ? mo.palette[1] : hex, palette: mo.palette ?? setPal, aspect: sp.aspect, res: motifRes(spec, mo.motif, sp.w, sp.h), texture: look.texture, fabric: look.fabric, opts: mo.opts, glass: look.glass });
    gen.forEach((p, i) => (p.uvRect = sp.rects[i]));
  } else if (gen.length) {
    // cell sizes from the quantised print aspect (~4 % steps, as single pictures) and the long side in 32 px steps:
    // resizing a set reuses its atlas until a step is crossed (the stretch stays ≤ 2 %)
    const ppm = PPM[q] ?? 1000;
    const cell = (L) => {
      const c = canvasSize(quantAspect(L.picW / L.picH), Math.max(32, Math.round((Math.max(L.picW, L.picH) * ppm) / 32) * 32), 8);
      return { w: c.W, h: c.H };
    };
    const packed = packAtlas(gen.map((p) => cell(p.L)), ATLAS_MAX[q] ?? 2048, ATLAS_PAD);
    if (!packed) throw new Error('art-set: the prints do not fit into one atlas');
    const plan = { W: packed.W, H: packed.H, hex, palette: setPal, cells: gen.map((p, i) => ({ ...packed.rects[i], motif: p.mo.motif, seed: p.mo.seed, palette: p.mo.palette, opts: p.mo.opts })) };
    pm = setPrintMaterial(plan, look);
    gen.forEach((p, i) => (p.uvRect = atlasUvRect(packed.rects[i], packed.W, packed.H)));
  }
  const setEdge = canvasEdgeHex(P, pm ? pm.userData.edgeHex : CUSTOM_EDGE_HEX);
  const g = new THREE.Group();
  const planes = [];
  for (const p of pieces) {
    const pg = new THREE.Group();
    const fm = !p.L.framed ? null : p.finish ? frameMaterial(...SET_FINISHES[p.finish]) : frameMaterial(M.frame || p.L.kind, C.frame);
    let cm = null, edge = setEdge;
    if (p.custom) {
      const entry = customPrintTexture(p.data.imageId, { aspect: p.L.picW / p.L.picH, res: Math.min(artResFor(q, p.L.picW, p.L.picH), CUSTOM_MAX_RES), fit: p.L.draw, bg: PAPER_WHITE, focus: p.data.focus });
      cm = customPrintMaterial(entry, { texture: p.L.texture, fabric: look.fabric, glass: look.glass });
      edge = canvasEdgeHex(p.data, entry.state === 'ready' ? entry.edgeHex : CUSTOM_EDGE_HEX, true);
    }
    const plane = addArtPiece(pg, { L: p.L, w: p.f.w, h: p.f.h, edgeHex: edge, frameMat: fm, framePart: p.finish ? null : 'frame', matColor: p.matColor, cord: false, uvRect: p.uvRect });
    const mtx = pieceMatrix(p.f);
    if (p.custom) pg.add(K.partMesh(plane, cm, 'print', { noMerge: true }));
    else planes.push(plane.applyMatrix4(mtx));
    pg.applyMatrix4(mtx);
    g.add(pg);
  }
  if (planes.length) {
    const geo = mergeGeometries(planes, false);
    for (const pl of planes) pl.dispose();
    if (!geo) throw new Error('art-set: could not merge the print planes');
    g.add(K.partMesh(geo, pm, 'print', { noMerge: true }));
  }
  if (ledge) {
    // the picture ledge (layout 'ledge'): a board under the frames with a front lip, in the frame material
    const lm = frameMaterial(M.frame || 'oak', C.frame);
    g.add(K.partMesh(K.box(ledge.w, ledge.t, ledge.d, { grain: 'x' }), lm, 'frame', { position: [ledge.x, ledge.y - ledge.t / 2, ledge.d / 2] }));
    g.add(K.partMesh(K.box(ledge.w, ledge.lip + ledge.t, 0.008, { grain: 'x' }), lm, 'frame', { position: [ledge.x, ledge.y + ledge.lip / 2 - ledge.t / 2, ledge.d - 0.004] }));
  }
  return finish(g, FRAME_FINISH);
}

// ---------------------------------------------------------------------------------------------------------------
// Mirrors

/** Outline points of a mirror shape, inset by `inset` (for the glass / inner frame edge). */
function mirrorOutline(shape, w, h, inset, n = 96) {
  const pts = [];
  if (shape === 'round') {
    const a = w / 2 - inset, b = h / 2 - inset;
    for (let i = 0; i < n; i++) {
      const t = (i / n) * TAU;
      pts.push(new THREE.Vector2(Math.cos(t) * a, Math.sin(t) * b));
    }
  } else if (shape === 'organic') {
    const rf = (t) => 1 + 0.07 * Math.sin(2 * t + 0.7) + 0.045 * Math.sin(3 * t + 2.1) + 0.03 * Math.sin(5 * t + 0.4);
    const raw = [];
    let mx = 0, my = 0;
    for (let i = 0; i < n; i++) {
      const t = (i / n) * TAU;
      const p = new THREE.Vector2(Math.cos(t) * rf(t), Math.sin(t) * rf(t));
      raw.push(p);
      mx = Math.max(mx, Math.abs(p.x));
      my = Math.max(my, Math.abs(p.y));
    }
    for (const p of raw) p.set((p.x / mx) * (w / 2), (p.y / my) * (h / 2));
    for (let i = 0; i < n; i++) {
      const a = raw[(i + n - 1) % n], b = raw[(i + 1) % n];
      const tx = b.x - a.x, ty = b.y - a.y;
      const l = Math.hypot(tx, ty) || 1;
      pts.push(new THREE.Vector2(raw[i].x - (ty / l) * inset, raw[i].y + (tx / l) * inset));
    }
  } else if (shape === 'arch') {
    const r = w / 2 - inset;
    const yc = h / 2 - w / 2;
    const yb = -h / 2 + inset;
    pts.push(new THREE.Vector2(-r, yb), new THREE.Vector2(r, yb));
    const m = Math.round(n / 2);
    for (let i = 0; i <= m; i++) {
      const t = (i / m) * Math.PI;
      pts.push(new THREE.Vector2(Math.cos(t) * r, yc + Math.sin(t) * r));
    }
  } else {
    const rr = Math.max(0.002, (shape === 'rounded' ? Math.min(w, h) * 0.22 : Math.min(w, h) * 0.03) - inset * 0.5);
    const s = K.roundedRectShape(w - 2 * inset, h - 2 * inset, rr);
    return s.getPoints(shape === 'rounded' ? 12 : 6);
  }
  return pts;
}

export function buildMirror(spec) {
  const P = spec.params, C = spec.colors, M = spec.materials;
  const { w, h } = spec.dims;
  const shape = ['round', 'rect', 'organic', 'arch', 'rounded'].includes(P.shape) ? P.shape : 'rect';
  const depth = Math.max(0.006, num(P.frameDepth, spec.dims.d));
  const fw = clamp(num(P.frameW, 0.03), 0, Math.min(w, h) * 0.2);
  const g = new THREE.Group();
  const glassMat = mat(M.print || 'mirror', C.print);
  const frameMat = mat(M.frame || 'black-metal', C.frame);
  if (fw > 0.002) {
    const s = new THREE.Shape(mirrorOutline(shape, w, h, 0));
    s.holes.push(new THREE.Path(mirrorOutline(shape, w, h, fw)));
    const geo = K.extrudeShape(s, depth, { bevel: Math.min(0.003, fw / 4, depth / 4), curveSegments: 12 });
    K.worldUV(geo, 1, { grain: 'x' });
    g.add(K.partMesh(geo, frameMat, 'frame'));
    const glass = new THREE.ShapeGeometry(new THREE.Shape(mirrorOutline(shape, w, h, fw * 0.4)));
    K.planarUV(glass, 'z');
    g.add(K.partMesh(glass, glassMat, 'print', { position: [0, 0, depth * 0.45] }));
  } else {
    const geo = K.extrudeShape(new THREE.Shape(mirrorOutline(shape, w, h, 0)), Math.min(depth, 0.008), { bevel: 0.003, curveSegments: 12 });
    K.planarUV(geo, 'z');
    g.add(K.partMesh(geo, glassMat, 'print'));
  }
  if (P.mullions && P.mullionLayout === 'border') {
    // bars inset from the edge all round (Manhattan): a big middle pane and narrow border panes
    const b = clamp(num(P.borderW, Math.min(w, h) * 0.13), 0.04, Math.min(w, h) * 0.3);
    const mw = Math.max(0.008, fw * 0.5), md = depth * 0.7;
    for (const sx of [-1, 1]) g.add(K.partMesh(K.box(mw, h - 2 * fw, md), frameMat, 'frame', { position: [sx * (w / 2 - fw - b), 0, md / 2] }));
    for (const sy of [-1, 1]) g.add(K.partMesh(K.box(w - 2 * fw, mw, md), frameMat, 'frame', { position: [0, sy * (h / 2 - fw - b), md / 2] }));
  } else if (P.mullions) {
    const cols = clamp(Math.round(num(P.mullionCols, 2)), 1, 8), rows = clamp(Math.round(num(P.mullionRows, 3)), 1, 10);
    const iw = w - 2 * fw, ih = h - 2 * fw;
    const mw = Math.max(0.008, fw * 0.5), md = depth * 0.7;
    const r = iw / 2, yc = h / 2 - w / 2, yb = -h / 2 + fw;
    const topAt = (x) => (shape === 'arch' ? yc + Math.sqrt(Math.max(0, r * r - x * x)) : h / 2 - fw);
    const halfAt = (y) => (shape === 'arch' && y > yc ? Math.sqrt(Math.max(0, r * r - (y - yc) ** 2)) : iw / 2);
    for (let i = 1; i < cols; i++) {
      const x = -iw / 2 + (iw * i) / cols;
      const t = topAt(x);
      g.add(K.partMesh(K.box(mw, t - yb, md), frameMat, 'frame', { position: [x, (t + yb) / 2, md / 2] }));
    }
    for (let j = 1; j < rows; j++) {
      const y = yb + (ih * j) / rows;
      const hw = halfAt(y);
      if (hw > mw) g.add(K.partMesh(K.box(hw * 2, mw, md), frameMat, 'frame', { position: [0, y, md / 2] }));
    }
  }
  const surfaces = [];
  if (P.shelf === true) {
    // a shelf board across the lower part of the mirror (Lazio), the frame colour
    const sy = -h / 2 + h * clamp(num(P.shelfAt, 0.2), 0.05, 0.9);
    const sd = clamp(num(P.shelfD, 0.1), 0.05, 0.25);
    g.add(K.partMesh(K.roundedBox(w * 1.04, 0.018, sd, 0.003, 1, { grain: 'x' }), frameMat, 'frame', { position: [0, sy, sd / 2] }));
    surfaces.push({ y: +(sy + 0.009).toFixed(4), w: +(w - 0.04).toFixed(3), d: +(sd - 0.02).toFixed(3), center: [0, +(sd / 2).toFixed(4)] });
  }
  return finish(g, surfaces.length ? { surfaces } : {});
}

// ---------------------------------------------------------------------------------------------------------------
// Candles and holders

function flameMeshes(g, x, y, z, s = 1) {
  const outer = K.lathe([[0.0001, 0], [0.0036 * s, 0.003 * s], [0.0042 * s, 0.0075 * s], [0.0024 * s, 0.015 * s], [0.0001, 0.022 * s]], { seg: 10 });
  const inner = K.lathe([[0.0001, 0.0005], [0.002 * s, 0.003 * s], [0.0022 * s, 0.006 * s], [0.0001, 0.011 * s]], { seg: 8 });
  const a = K.partMesh(outer, emissive('#ffae55', 2.6, { color: '#2a1d12' }), null, { position: [x, y, z], noMerge: true });
  const b = K.partMesh(inner, emissive('#fff4d6', 4.0, { color: '#2a1d12' }), null, { position: [x, y, z], noMerge: true });
  for (const m of [a, b]) {
    m.userData.noShadow = true;
    g.add(m);
  }
  return [a, b];
}

/** Candle with wax top, wick and (when lit) a flame; returns the flame meshes. */
function addCandle(g, { x = 0, y = 0, z = 0, r, h, hex, lit, taper = false }) {
  const wax = mat('candle', hex);
  if (taper) {
    g.add(K.partMesh(K.lathe([[0.001, 0], [r, 0], [r * 0.86, h - r * 0.4], [r * 0.5, h], [0.001, h]], { seg: 16 }), wax, null, { position: [x, y, z] }));
  } else {
    g.add(K.partMesh(K.lathe([[0.001, 0], [r, 0], [r, h - 0.003], [r * 0.92, h], [r * 0.6, h - 0.004], [0.001, h - 0.005]], { seg: 24 }), wax, null, { position: [x, y, z] }));
  }
  const top = taper ? h : h - 0.005;
  g.add(K.partMesh(K.cylinder(0.0007, 0.0006, 0.008, { seg: 4 }), mat('plastic', '#1a1410', { flat: true }), null, { position: [x, y + top, z] }));
  return lit ? flameMeshes(g, x, y + top + 0.006, z) : [];
}

/** Thick glass cup (tealight / votive holder). */
function glassCup(R, H, gm, spec) {
  const wall = clamp(R * 0.12, 0.003, 0.007), base = clamp(H * 0.18, 0.006, 0.02);
  return K.lathe([[0.001, 0], [R * 0.9, 0], [R, 0.006], [R, H - 0.003], [R - wall * 0.5, H], [R - wall, H - 0.003], [R - wall, base + 0.004], [R - wall - 0.004, base], [0.001, base]], { seg: segN(spec, 32, 14) });
}

function buildCandleHolder(spec) {
  const P = spec.params, C = spec.colors, M = spec.materials;
  const { w, d, h } = spec.dims;
  const kind = P.kind || 'lantern';
  const lit = P.lit !== false;
  const g = new THREE.Group();
  const bodyKind = M.body || 'glass-smoked';
  const glassy = String(bodyKind).startsWith('glass');
  const bm = mat(bodyKind, C.body);
  const candleHex = P.candleColor || '#f2efe8';
  const flames = [];
  if (kind === 'tealight') {
    const n = clamp(Math.round(num(P.count, 1)), 1, 12);
    const sp = num(P.spacing, w / n);
    const D = Math.min(sp * 0.98, d, w / n);
    for (let i = 0; i < n; i++) {
      const x = (i - (n - 1) / 2) * sp;
      if (glassy) g.add(K.partMesh(glassCup(D / 2, h, bm, spec), bm, 'body', { position: [x, 0, 0] }));
      else g.add(K.partMesh(K.lathe([[0.001, 0], [D / 2, 0], [D / 2, h], [D / 2 - 0.004, h], [D / 2 - 0.004, 0.008], [0.001, 0.008]], { seg: segN(spec, 28, 12) }), bm, 'body', { position: [x, 0, 0] }));
      const by = glassy ? clamp(h * 0.18, 0.006, 0.02) : 0.008;
      const tr = Math.min(0.019, D / 2 - 0.008);
      g.add(K.partMesh(K.cylinder(tr, tr, 0.016, { seg: 20, open: true }), mat('steel', '#c9ccd0'), null, { position: [x, by, 0] }));
      flames.push(...addCandle(g, { x, y: by + 0.001, r: tr - 0.0008, h: 0.014, hex: candleHex, lit }));
    }
  } else if (kind === 'candlestick') {
    const baseR = num(P.baseD, Math.min(w, d)) / 2;
    const H = h;
    const prof = [[0.001, 0], [baseR, 0], [baseR, 0.008], [baseR * 0.8, 0.014], [baseR * 0.35, 0.03]];
    const n = 28;
    const R = K.rng(`stick:${P.seed ?? 1}`);
    const ph = R() * TAU, k = R.range(2.5, 3.6);
    for (let i = 1; i <= n; i++) {
      const t = i / (n + 1);
      const r = P.organic ? 0.0105 + 0.0095 * Math.pow(Math.abs(Math.sin(t * Math.PI * k + ph)), 0.8) : 0.011;
      prof.push([r, 0.03 + (H - 0.06) * t]);
    }
    prof.push([0.012, H - 0.02], [0.018, H - 0.004], [0.018, H], [0.0125, H], [0.0125, H - 0.012], [0.001, H - 0.012]);
    g.add(K.partMesh(K.lathe(prof, { seg: segN(spec, 28, 12) }), bm, 'body'));
    flames.push(...addCandle(g, { y: H - 0.012, r: 0.0105, h: num(P.candleH, 0.24), hex: candleHex, lit, taper: true }));
  } else if (kind === 'pillar') {
    const n = clamp(Math.round(num(P.count, 1)), 1, 5);
    g.add(K.partMesh(K.cylinder(w / 2, w / 2, 0.008, { seg: 32 }), bm, 'body'));
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU;
      const off = n > 1 ? w * 0.22 : 0;
      flames.push(...addCandle(g, { x: Math.cos(a) * off, y: 0.008, z: Math.sin(a) * off, r: Math.min(0.035, w / (n > 1 ? 4.5 : 2.4)), h: h * (1 - i * 0.18) - 0.008, hex: candleHex, lit }));
    }
  } else {
    // lantern: all-glass hurricane, or a metal frame with clear glass
    const R = Math.min(w, d) / 2;
    const cd = Math.min(0.075, R * 1.25), ch = Math.min(0.1, h * 0.5);
    if (glassy) {
      g.add(K.partMesh(K.lathe([[0.001, 0], [R * 0.94, 0], [R, 0.01], [R, h - 0.003], [R - 0.002, h], [R - 0.004, h - 0.003], [R - 0.004, 0.016], [0.001, 0.016]], { seg: segN(spec, 36, 16) }), bm, 'body'));
      flames.push(...addCandle(g, { y: 0.016, r: cd / 2, h: ch, hex: candleHex, lit }));
    } else {
      const gk = P.glass === 'smoked' ? 'glass-smoked' : 'glass-clear';
      g.add(K.partMesh(K.cylinder(R, R, 0.022, { seg: 32 }), bm, 'body'));
      g.add(K.partMesh(K.torus(R * 0.97, 0.004, { radial: 6, tubular: 40 }), bm, 'body', { position: [0, h - 0.06, 0], rotation: [Math.PI / 2, 0, 0] }));
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * TAU + Math.PI / 4;
        g.add(K.partMesh(K.cylinder(0.003, 0.003, h - 0.08, { seg: 6 }), bm, 'body', { position: [Math.cos(a) * R * 0.97, 0.02, Math.sin(a) * R * 0.97] }));
      }
      g.add(K.partMesh(K.torus(R * 0.45, 0.0035, { radial: 6, tubular: 24, arc: Math.PI }), bm, 'body', { position: [0, h - 0.06, 0] }));
      g.add(K.partMesh(K.cylinder(R * 0.9, R * 0.9, h - 0.09, { seg: 32, open: true }), mat(gk), null, { position: [0, 0.022, 0] }));
      flames.push(...addCandle(g, { y: 0.022, r: cd / 2, h: ch, hex: candleHex, lit }));
    }
  }
  const lights = [];
  if (flames.length) {
    const c = V3();
    let n = 0;
    for (const f of flames) {
      c.add(f.position);
      n++;
    }
    c.multiplyScalar(1 / n);
    lights.push(K.pointLight([c.x, c.y + 0.012, c.z], { lumens: 11 * (n / 2), colorK: 1850, emissiveMeshes: flames }));
  }
  return finish(g, { lights });
}

// ---------------------------------------------------------------------------------------------------------------
// Baskets, foam roller, pedal bin, magazine stack

function buildBasket(spec) {
  const P = spec.params, C = spec.colors, M = spec.materials;
  const { w, d } = spec.dims;
  // a lid (laundry baskets) takes the top of dims.h
  const lidH = P.lid === true ? clamp(spec.dims.h * 0.06, 0.015, 0.035) : 0;
  const h = spec.dims.h - lidH;
  const shape = P.shape || 'cylinder';
  const kind = M.body || 'rattan';
  const weave = P.weave || (kind === 'rattan' ? 'rattan' : 'none');
  if (shape === 'pedal-bin' || shape === 'pedal-bin-round') return buildPedalBin(spec);
  if (weave === 'foam') return buildFoamRoller(spec);
  if (shape === 'stack' || (weave === 'none' && kind === 'paper')) return buildMagazines(spec);
  const g = new THREE.Group();
  const R = w / 2;
  const rope = weave === 'rope';
  const bm = weave === 'rattan' ? mat('woven', C.body, { scale: 7, roughness: 0.8 }) : mat(kind, C.body, rope ? { scale: 1.6 } : undefined);
  if (shape === 'rect') {
    const t = 0.008;
    const outer = K.roundedBox(w, h, d, Math.min(0.02, h / 4), 3, { bottom: true });
    g.add(K.partMesh(outer, bm, 'body'));
    if (lidH) g.add(K.partMesh(K.roundedBox(w + 0.008, lidH, d + 0.008, Math.min(0.012, lidH / 2), 2, { bottom: true }), bm, 'body', { position: [0, h, 0] }));
    else g.add(K.partMesh(K.box(w - 2 * t, 0.002, d - 2 * t), mat(kind, scaleHex(C.body, 0.7)), null, { position: [0, h - 0.004, 0] }));
    return finish(g);
  }
  const wall = clamp(R * 0.04, 0.005, 0.012);
  const prof = [[0.001, 0], [R * 0.85, 0], [R * 0.87, 0.008]];
  const n = rope ? Math.max(8, Math.round(h / 0.011) * 3) : 12;
  const ropeD = rope ? h / Math.round(h / 0.011) : 1;
  for (let i = 1; i <= n; i++) {
    const t = i / n, y = Math.max(0.01, t * (h - 0.006));
    let r = R * (0.87 + 0.13 * Math.sin((t * Math.PI) / 2));
    if (rope) r += 0.004 * Math.abs(Math.sin((Math.PI * y) / ropeD)) - 0.002;
    prof.push([r, y]);
  }
  prof.push([R + 0.004, h - 0.003], [R, h + 0.003], [R - wall, h], [R - wall, h - 0.01], [R * 0.85 - wall, 0.012], [0.001, 0.012]);
  const geo = K.lathe(prof, { seg: segN(spec, 44, 18) });
  if (shape === 'oval' && Math.abs(d - w) > 0.005) geo.scale(1, 1, d / w);
  g.add(K.partMesh(geo, bm, 'body'));
  if (lidH) {
    // a low domed lid with a small knob
    const lid = K.lathe([[0.001, 0], [R + 0.006, 0], [R + 0.006, lidH * 0.45], [R * 0.7, lidH * 0.9], [R * 0.12, lidH], [R * 0.12, lidH + 0.012], [0.001, lidH + 0.014]], { seg: segN(spec, 44, 18) });
    if (shape === 'oval' && Math.abs(d - w) > 0.005) lid.scale(1, 1, d / w);
    g.add(K.partMesh(lid, bm, 'body', { position: [0, h, 0] }));
  }
  if (P.handles) {
    for (const s of [-1, 1]) g.add(K.partMesh(K.roundedBox(0.012, 0.03, 0.09, 0.005, 2), mat('leather', '#6b4a33'), null, { position: [s * (R + 0.003), h - 0.04, 0] }));
  }
  return finish(g);
}

function buildFoamRoller(spec) {
  const C = spec.colors;
  const { w, h } = spec.dims;
  const R = w / 2;
  const g = new THREE.Group();
  const m = mat('plastic', C.body || '#1a1a1a', { roughness: 0.92 });
  const pitch = 0.024;
  const around = Math.max(8, Math.round((TAU * R) / pitch));
  const rows = Math.max(4, Math.round(h / pitch));
  const k = spec.quality === 'low' ? 2 : 3;
  const fn = (th, t) => {
    const y = t * rows;
    const edge = smooth01(t / 0.03) * smooth01((1 - t) / 0.03);
    const bump = Math.pow(Math.max(0, Math.cos(th * around + (Math.floor(y) % 2) * Math.PI) * Math.cos((y - Math.floor(y) - 0.5) * Math.PI)), 0.6);
    return R * (0.88 + 0.1 * bump * edge);
  };
  g.add(K.partMesh(revolveGeometry(fn, h, around * k, rows * k), m, 'body'));
  const ri = R * 0.36;
  g.add(K.partMesh(K.cylinder(ri, ri, h, { seg: 20, open: true }), mat('plastic', '#0d0d0d', { roughness: 0.95, side: 'double' }), null));
  for (const y of [0, h]) {
    const ring = new THREE.RingGeometry(ri, R * 0.88, 32, 1);
    ring.rotateX(y ? -Math.PI / 2 : Math.PI / 2);
    K.planarUV(ring, 'y');
    g.add(K.partMesh(ring, m, 'body', { position: [0, y, 0] }));
  }
  return finish(g);
}

/** Pedal bin: `shape: 'pedal-bin'` = the rectangular stainless kitchen bin (f-avfallsbotte), 'pedal-bin-round' = round. */
function buildPedalBin(spec) {
  return spec.params.shape === 'pedal-bin-round' ? buildPedalBinRound(spec) : buildPedalBinRect(spec);
}

/** Vertical prism of a rounded rectangle (w along x, d along z) from y0 to y0 + hgt; optional bevelled top/bottom edge. */
function roundedPrism(w, d, hgt, r, { y0 = 0, z0 = 0, bevel = 0, curveSegments = 6 } = {}) {
  const geo = K.extrudeShape(K.roundedRectShape(w, d, r), hgt, { bevel, bevelSegments: bevel ? 3 : 1, curveSegments });
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, y0, z0);
  return geo;
}

/**
 * Rectangular stainless pedal bin (the kitchen one in photo 082950): black plastic plinth with the pedal in front,
 * brushed-steel body with rounded vertical corners, black lid with soft top edges and a hinge block at the back.
 * The pedal sits inside dims.d (the body is set back by the pedal depth).
 */
function buildPedalBinRect(spec) {
  const P = spec.params, C = spec.colors, M = spec.materials;
  const { w, d, h } = spec.dims;
  const g = new THREE.Group();
  const cs = segN(spec, 6, 3);
  const pedD = clamp(d * 0.09, 0.01, 0.03);
  const bd = d - pedD, z0 = -pedD / 2;
  const r = clamp(Math.min(w, bd) * 0.09, 0.004, 0.03);
  const baseH = clamp(h * 0.075, 0.012, 0.04);
  const lidH = clamp(h * 0.1, 0.015, 0.055);
  const bodyTop = h - lidH;
  const inset = Math.min(0.004, Math.min(w, bd) * 0.02);
  const black = mat('plastic', P.lidColor || '#151515', { roughness: 0.45 });
  const steel = mat(M.body || 'steel', C.body, { grain: 'v' });
  // plinth (black), body (steel, a hair inside the plinth and lid), lid (black, bevelled top)
  g.add(K.partMesh(roundedPrism(w, bd, baseH, r, { z0, curveSegments: cs }), black, null));
  g.add(K.partMesh(roundedPrism(w - 2 * inset, bd - 2 * inset, bodyTop - baseH + 0.002, Math.max(0.002, r - inset), { y0: baseH - 0.001, z0, curveSegments: cs }), steel, 'body'));
  g.add(K.partMesh(roundedPrism(w, bd, lidH, r, { y0: bodyTop, z0, bevel: Math.min(0.008, lidH * 0.3, r * 0.8), curveSegments: cs }), black, null));
  // thin shadow line under the lid rim
  g.add(K.partMesh(roundedPrism(w - 2 * inset - 0.002, bd - 2 * inset - 0.002, 0.004, Math.max(0.002, r - inset), { y0: bodyTop - 0.004, z0, curveSegments: cs }), mat('plastic', '#0a0a0a', { roughness: 0.8 }), null));
  // pedal (front, in the plinth) and hinge block (back, under the lid)
  const pw = Math.min(w * 0.42, 0.14);
  g.add(K.partMesh(K.roundedBox(pw, Math.min(0.014, baseH * 0.6), pedD + 0.03, 0.004, 2), black, null, { position: [0, baseH * 0.45, d / 2 - (pedD + 0.03) / 2] }));
  g.add(K.partMesh(K.roundedBox(Math.min(0.08, w * 0.3), Math.min(0.03, lidH * 0.8), 0.016, 0.004, 2), black, null, { position: [0, bodyTop - Math.min(0.03, lidH * 0.8) / 2 + 0.004, z0 - bd / 2 - 0.004] }));
  return finish(g);
}

function buildPedalBinRound(spec) {
  const P = spec.params, C = spec.colors, M = spec.materials;
  const { w, d, h } = spec.dims;
  const R = Math.min(w, d) / 2;
  const g = new THREE.Group();
  const lidH = Math.min(0.05, h * 0.12);
  const bodyH = h - lidH;
  const steel = mat(M.body || 'steel', C.body, { grain: 'v' });
  g.add(K.partMesh(K.lathe([[0.001, 0.012], [R * 0.95, 0.012], [R * 0.97, 0.02], [R, 0.04], [R, bodyH - 0.006], [R * 0.99, bodyH]], { seg: segN(spec, 40, 16) }), steel, 'body'));
  const black = mat('plastic', P.lidColor || '#151515', { roughness: 0.4 });
  g.add(K.partMesh(K.lathe([[0.001, 0], [R * 0.95, 0], [R * 0.97, 0.012], [0.001, 0.012]], { seg: 24 }), black, null));
  g.add(K.partMesh(K.lathe([[R * 1.005, 0], [R * 1.01, lidH * 0.35], [R * 0.8, lidH * 0.85], [0.001, lidH]], { seg: segN(spec, 40, 16) }), black, null, { position: [0, bodyH, 0] }));
  g.add(K.partMesh(K.roundedBox(R * 0.5, 0.012, 0.06, 0.004, 2), steel, 'body', { position: [0, 0.018, R + 0.02] }));
  g.add(K.partMesh(K.roundedBox(0.06, 0.03, 0.02, 0.004, 2), black, null, { position: [0, bodyH - 0.005, -R - 0.005] }));
  return finish(g);
}

function buildMagazines(spec) {
  const C = spec.colors;
  const { w, d, h } = spec.dims;
  const g = new THREE.Group();
  const R = K.rng(`mags:${spec.params.seed ?? 1}:${Math.round(w * 100)}`);
  const n = Math.max(2, Math.round(h / 0.006));
  const th = h / n;
  const covers = [C.body, '#f1eee8', '#c9c2b6', '#8a8f94', '#b07a5a', '#d8d4cc', '#5f6a70'];
  for (let i = 0; i < n; i++) {
    const mw = w * R.range(0.82, 0.98), md = d * R.range(0.84, 0.98);
    const m = K.partMesh(K.roundedBox(mw, th * 0.96, md, 0.001, 1), mat('paper', i === n - 1 ? C.body : R.pick(covers)), i === n - 1 ? 'body' : null, {
      position: [R.range(-1, 1) * (w - mw) * 0.4, i * th + th * 0.48, R.range(-1, 1) * (d - md) * 0.4],
      rotation: [0, R.range(-0.08, 0.08), 0],
    });
    g.add(m);
  }
  return finish(g);
}

// ---------------------------------------------------------------------------------------------------------------
// TV and speakers

/** Screen of a TV that is off: deep black glass with reflections (or on: an emissive picture). */
function screenMaterial(on, res) {
  return cached(`decor:screen:${on ? 'on' : 'off'}:${res}`, () => {
    let m;
    if (on) {
      const art = motifArt({ motif: 'photo', seed: 3, hex: '#8fa6b8', aspect: 16 / 9, res });
      m = new THREE.MeshStandardMaterial({ color: '#050505', emissive: '#ffffff', emissiveMap: art.map, emissiveIntensity: 1.25, roughness: 0.22, metalness: 0 });
      MOTIFS.use(art, m); // the screen keeps its picture (this material is cached for the page lifetime)
    } else {
      m = new THREE.MeshPhysicalMaterial({ color: '#040405', roughness: 0.2, metalness: 0, clearcoat: 0.85, clearcoatRoughness: 0.06, envMapIntensity: 0.9 });
    }
    m.name = `tv screen ${on ? 'on' : 'off'}`;
    m.userData = { shared: true, kind: 'screen' };
    return m;
  });
}

function buildTV(spec) {
  const P = spec.params, C = spec.colors, M = spec.materials;
  const { w, h, d } = spec.dims;
  const g = new THREE.Group();
  const panelT = Math.min(0.009, Math.max(0.004, d * 0.4));
  const bodyD = clamp(d - panelT - 0.006, 0, 0.032);
  const gap = Math.max(0, d - panelT - bodyD);
  const kindOf = (k) => (!k || String(k).startsWith('glass') ? 'black-metal' : k);
  const fm = mat(kindOf(M.body), C.body, { roughness: 0.4 });
  g.add(K.partMesh(K.roundedBox(w, h, panelT, Math.min(0.002, panelT / 3), 1), fm, 'body', { position: [0, 0, d - panelT / 2] }));
  if (bodyD > 0.003) g.add(K.partMesh(K.roundedBox(w * 0.62, h * 0.5, bodyD, 0.004, 1), fm, 'body', { position: [0, -h * 0.08, gap + bodyD / 2] }));
  if (gap > 0.003 && P.wallMount !== false) {
    const bm = mat('black-metal', '#111111');
    g.add(K.partMesh(K.box(w * 0.32, h * 0.26, 0.004), bm, null, { position: [0, -h * 0.05, 0.002] }));
    for (const s of [-1, 1]) g.add(K.partMesh(K.box(0.03, h * 0.36, Math.max(0.004, gap)), bm, null, { position: [s * w * 0.14, -h * 0.05, gap / 2] }));
  }
  const bezel = clamp(num(P.bezel, 0.005), 0, Math.min(w, h) * 0.1);
  const screen = K.partMesh(new THREE.PlaneGeometry(w - 2 * bezel, h - 2 * bezel), screenMaterial(P.screen === 'on', artRes(spec)), null, { position: [0, 0, d + 0.0004] });
  g.add(screen);
  return finish(g, { kindMap: { body: (k) => kindOf(k) } });
}

/** Perforated speaker grille texture (dots on a hex grid), cached. */
function grilleSet() {
  return cached('decor:grilleTex', () => {
    const S = 64;
    const cv = createCanvas(S, S);
    const c = cv.getContext('2d');
    c.fillStyle = gray(0.97);
    c.fillRect(0, 0, S, S);
    const heights = new Float32Array(S * S).fill(1);
    const holes = [];
    for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) holes.push([(i + (j % 2) * 0.5) * (S / 4), (j + 0.5) * (S / 4)]);
    for (const [x, y] of holes) {
      for (const [ox, oy] of [[0, 0], [S, 0], [-S, 0], [0, S], [0, -S]]) {
        c.fillStyle = gray(0.78);
        c.beginPath();
        c.arc(x + ox, y + oy, S * 0.07, 0, TAU);
        c.fill();
      }
    }
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        for (const [hx, hy] of holes) {
          let dx = Math.abs(x - hx), dy = Math.abs(y - hy);
          dx = Math.min(dx, S - dx);
          dy = Math.min(dy, S - dy);
          if (Math.hypot(dx, dy) < S * 0.075) heights[y * S + x] = 0.3;
        }
      }
    }
    const repeat = [1 / 0.012, 1 / 0.012];
    return { map: canvasTexture(cv, { repeat }), normalMap: canvasTexture(heightToNormalCanvas(heights, S, S, 1.5), { repeat, srgb: false }), ref: 0.86 };
  });
}

function grilleMaterial(hex) {
  const h = hexOf(hex, '#d6d6d4');
  return cached(`decor:grille:${h}`, () => {
    const set = grilleSet();
    const m = new THREE.MeshStandardMaterial({ map: set.map, normalMap: set.normalMap, normalScale: new THREE.Vector2(0.5, 0.5), roughness: 0.55, color: new THREE.Color(h).multiplyScalar(1 / set.ref) });
    m.name = `grille ${h}`;
    m.userData = { shared: true, kind: 'grille', hex: h, decorRecolor: (nh) => grilleMaterial(nh) };
    return m;
  });
}

/** Plane with metre UVs (x, y). */
function metrePlane(w, h) {
  const g = new THREE.PlaneGeometry(w, h);
  K.planarUV(g, 'z');
  return g;
}

function buildSpeaker(spec) {
  const P = spec.params, C = spec.colors, M = spec.materials;
  const { w, h, d } = spec.dims;
  const style = P.style || (P.inWall === false ? 'box' : 'in-wall');
  const g = new THREE.Group();
  if (style === 'in-wall') {
    const t = Math.max(0.003, Math.min(d, 0.012) * 0.6);
    const b = Math.min(0.009, Math.min(w, h) * 0.08);
    g.add(K.partMesh(K.roundedBox(w, h, t, Math.min(0.0015, t / 3), 1), mat(M.body || 'painted', C.body), 'body', { position: [0, 0, t / 2] }));
    g.add(K.partMesh(metrePlane(w - 2 * b, h - 2 * b), grilleMaterial(C.body), 'body', { position: [0, 0, t + 0.0004] }));
  } else if (style === 'soundbar') {
    g.add(K.partMesh(K.roundedBox(w, h, d, Math.min(h, d) * 0.3, 3), mat(M.body || 'black-metal', C.body), 'body', { position: [0, 0, d / 2] }));
    g.add(K.partMesh(metrePlane(w - 0.02, h * 0.7), mat('woven', '#2b2b2b'), null, { position: [0, 0, d + 0.0005] }));
  } else {
    g.add(K.partMesh(K.roundedBox(w, h, d, 0.008, 2), mat(M.body || 'painted', C.body), 'body', { position: [0, 0, d / 2] }));
    g.add(K.partMesh(K.roundedBox(w - 0.012, h - 0.012, 0.006, 0.004, 2), mat('woven', '#2a2a2a'), null, { position: [0, 0, d + 0.002] }));
  }
  return finish(g);
}

// ---------------------------------------------------------------------------------------------------------------
// Acoustic products

/** Felt-backed wooden slat panel: felt board + slats as InstancedMeshes (a few grain variants, per-slat tone). */
function buildSlatPanel(spec) {
  const P = spec.params, C = spec.colors, M = spec.materials;
  const { w, h, d } = spec.dims;
  const vertical = P.orientation !== 'horizontal';
  const L = vertical ? h : w, span = vertical ? w : h;
  const slatW = clamp(num(P.slatW, 0.027), 0.008, 0.2);
  const gap = clamp(num(P.gap, 0.013), 0.002, 0.2);
  const slatD = clamp(num(P.slatD, d * 0.6), 0.003, Math.max(0.004, d - 0.003));
  const backT = Math.max(0.003, d - slatD);
  const g = new THREE.Group();
  g.add(K.partMesh(K.box(w, h, backT), mat(M.backing || 'felt', C.backing), 'backing', { position: [0, 0, backT / 2] }));
  const n = Math.max(1, Math.floor((span + gap) / (slatW + gap)));
  const x0 = -((n - 1) * (slatW + gap)) / 2;
  const variants = spec.quality === 'low' ? 1 : spec.quality === 'high' ? 4 : 3;
  const R = K.rng(`slats:${n}:${Math.round(L * 100)}:${P.seed ?? 1}`);
  const sm = mat(M.slats || 'oak', C.slats);
  const geos = [];
  for (let v = 0; v < variants; v++) {
    const geo = new THREE.BoxGeometry(slatW, L, slatD);
    K.worldUV(geo, 1, { grain: 'y', offset: [R.range(0, 0.8), R.range(0, 0.4)] });
    geos.push(geo);
  }
  const which = [];
  for (let i = 0; i < n; i++) which.push(R.int(0, variants - 1));
  const m4 = new THREE.Matrix4();
  const rot = new THREE.Matrix4().makeRotationZ(vertical ? 0 : Math.PI / 2);
  const col = new THREE.Color();
  for (let v = 0; v < variants; v++) {
    const idx = which.map((x, i) => (x === v ? i : -1)).filter((i) => i >= 0);
    if (!idx.length) {
      geos[v].dispose();
      continue;
    }
    const im = new THREE.InstancedMesh(geos[v], sm, idx.length);
    idx.forEach((i, k) => {
      const pos = x0 + i * (slatW + gap);
      m4.makeTranslation(vertical ? pos : 0, vertical ? 0 : pos, backT + slatD / 2).multiply(rot);
      im.setMatrixAt(k, m4);
      im.setColorAt(k, col.setScalar(R.range(0.9, 1.08)));
    });
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    im.computeBoundingBox();
    im.computeBoundingSphere();
    K.tagPart(im, 'slats');
    g.add(im);
  }
  return finish(g);
}

function buildFabricPanel(spec) {
  const P = spec.params, C = spec.colors, M = spec.materials;
  const { w, h, d } = spec.dims;
  const t = Math.max(0.006, num(P.thickness, d));
  const kind = M.panel || 'felt';
  const g = new THREE.Group();
  if (kind === 'moss') {
    const backT = Math.min(0.009, t * 0.45);
    g.add(K.partMesh(K.box(w, h, backT), mat(M.backing || 'felt', C.backing), 'backing', { position: [0, 0, backT / 2] }));
    const nx = Math.max(8, Math.round(w / 0.022)), ny = Math.max(8, Math.round(h / 0.022));
    const geo = new THREE.PlaneGeometry(w - 0.004, h - 0.004, nx, ny);
    const R = K.rng(`moss:${P.seed ?? 1}:${nx}:${ny}`);
    const bumps = [];
    for (let i = 0; i < Math.round((w * h) / 0.004) + 6; i++) bumps.push([R.range(-w / 2, w / 2), R.range(-h / 2, h / 2), R.range(0.02, 0.06), R.range(0.5, 1)]);
    const pos = geo.attributes.position;
    const amp = t - backT;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i);
      let z = 0;
      for (const [bx, by, br, bh] of bumps) {
        const q = ((x - bx) ** 2 + (y - by) ** 2) / (br * br);
        if (q < 4) z = Math.max(z, bh * Math.exp(-q));
      }
      const edge = smooth01((w / 2 - Math.abs(x)) / 0.02) * smooth01((h / 2 - Math.abs(y)) / 0.02);
      pos.setZ(i, backT + amp * (0.35 + 0.65 * z) * (0.4 + 0.6 * edge));
    }
    geo.computeVertexNormals();
    K.planarUV(geo, 'z');
    g.add(K.partMesh(geo, mat('moss', C.panel), 'panel'));
    return finish(g);
  }
  const edge = P.edge || 'square';
  const r = edge === 'rounded' ? Math.min(0.015, t / 2.2) : edge === 'bevel' ? Math.min(0.008, t / 3) : Math.min(0.004, t / 4);
  g.add(K.partMesh(K.roundedBox(w, h, t, r, edge === 'rounded' ? 4 : 2), mat(kind, C.panel), 'panel', { position: [0, 0, t / 2] }));
  return finish(g);
}

function buildAcousticArt(spec) {
  const P = spec.params, C = spec.colors, M = spec.materials;
  const { w, h, d } = spec.dims;
  const t = Math.max(0.01, num(P.thickness, d));
  const framed = P.frame && P.frame !== 'none';
  const fw = framed ? clamp(num(P.frameW, 0.015), 0.005, 0.05) : 0;
  // 'custom' with an uploaded picture (params.imageId) prints it; 'custom' without one keeps the fjord photo
  const custom = P.motif === 'custom' && isImageId(P.imageId);
  const motif = !P.motif || P.motif === 'custom' ? 'photo' : P.motif;
  const g = new THREE.Group();
  const pw = w - 2 * fw, ph = h - 2 * fw;
  const fabric = M.panel === 'paper' ? null : M.panel === 'cotton' || M.panel === 'linen' ? M.panel : 'woven';
  const texture = M.panel === 'paper' ? 'photo' : 'canvas';
  artBudget(spec);
  let pm, edgeHex;
  if (custom) {
    const entry = customPrintTexture(P.imageId, { aspect: pw / ph, res: Math.min(artResFor(spec.quality, pw, ph), CUSTOM_MAX_RES), fit: P.fit === 'contain' ? 'contain' : 'cover', bg: PAPER_WHITE, focus: P.focus });
    pm = customPrintMaterial(entry, { texture, fabric });
    edgeHex = entry.state === 'ready' ? entry.edgeHex : CUSTOM_EDGE_HEX;
  } else {
    pm = printMaterial({ motif, seed: P.seed ?? 1, hex: C.panel, palette: P.palette, aspect: pw / ph, res: motifRes(spec, motif, pw, ph), texture, fabric, opts: P.motifOpts });
    edgeHex = pm.userData.edgeHex;
  }
  g.add(K.partMesh(K.box(pw * 0.98, ph * 0.98, 0.004), mat('felt', C.backing), 'backing', { position: [0, 0, 0.002] }));
  g.add(K.partMesh(K.roundedBox(pw, ph, t - 0.002, Math.min(0.006, t / 3), 2), mat(fabric || 'cotton', edgeHex), null, { position: [0, 0, 0.002 + (t - 0.002) / 2] }));
  g.add(K.partMesh(printPlane(pw - Math.min(0.012, t / 1.5), ph - Math.min(0.012, t / 1.5)), pm, 'panel', { position: [0, 0, t + 0.0006] }));
  if (framed) addFrameBars(g, w, h, fw, t + 0.004, frameMaterial(M.frame === 'cotton' || M.frame === 'woven' ? 'black-metal' : M.frame || 'black-metal', C.frame));
  return finish(g, FRAME_FINISH);
}

/** Outline of a felt shape inside w × h. */
function feltOutline(shape, w, h) {
  const pts = [];
  const add = (x, y) => pts.push(new THREE.Vector2(x, y));
  if (shape === 'hexagon') {
    add(w / 2, 0);
    add(w / 4, h / 2);
    add(-w / 4, h / 2);
    add(-w / 2, 0);
    add(-w / 4, -h / 2);
    add(w / 4, -h / 2);
  } else if (shape === 'triangle') {
    add(0, h / 2);
    add(-w / 2, -h / 2);
    add(w / 2, -h / 2);
  } else if (shape === 'semicircle') {
    for (let i = 0; i <= 48; i++) {
      const a = (i / 48) * Math.PI;
      add(Math.cos(a) * (w / 2), -h / 2 + Math.sin(a) * h);
    }
  } else if (shape === 'square' || shape === 'rounded') {
    return K.roundedRectShape(w, h, shape === 'rounded' ? Math.min(w, h) * 0.2 : Math.min(w, h) * 0.02).getPoints(8);
  } else if (shape === 'cloud') {
    const rf = (a) => 1 + 0.12 * Math.max(0, Math.cos(5 * a)) ** 0.6;
    let mx = 0, my = 0;
    const raw = [];
    for (let i = 0; i < 120; i++) {
      const a = (i / 120) * TAU;
      const p = new THREE.Vector2(Math.cos(a) * rf(a), Math.sin(a) * rf(a));
      raw.push(p);
      mx = Math.max(mx, Math.abs(p.x));
      my = Math.max(my, Math.abs(p.y));
    }
    return raw.map((p) => p.set((p.x / mx) * (w / 2), (p.y / my) * (h / 2)));
  } else if (shape === 'leaf') {
    for (let i = 0; i <= 40; i++) {
      const t = i / 40;
      add(-w / 2 + t * w, Math.sin(Math.PI * t) * h * 0.5);
    }
    for (let i = 39; i >= 1; i--) {
      const t = i / 40;
      add(-w / 2 + t * w, -Math.sin(Math.PI * t) * h * 0.5);
    }
  } else {
    for (let i = 0; i < 64; i++) {
      const a = (i / 64) * TAU;
      add(Math.cos(a) * (w / 2), Math.sin(a) * (h / 2));
    }
  }
  return pts;
}

function buildFeltShape(spec) {
  const P = spec.params, C = spec.colors, M = spec.materials;
  const { w, h, d } = spec.dims;
  const t = Math.max(0.004, num(P.thickness, d));
  const g = new THREE.Group();
  const geo = K.extrudeShape(new THREE.Shape(feltOutline(P.shape || 'hexagon', w, h)), t, { bevel: Math.min(0.006, t * 0.2), bevelSegments: 2, curveSegments: 24 });
  K.worldUV(geo);
  g.add(K.partMesh(geo, mat(M.panel || 'felt', C.panel), 'panel'));
  return finish(g);
}

function addWire(g, x, y0, y1, z) {
  const m = K.partMesh(K.cylinder(0.0009, 0.0009, y1 - y0, { seg: 4 }), mat('steel', '#b9bcbf', { flat: true }), null, { position: [x, y0, z] });
  m.userData.noShadow = true;
  g.add(m);
  g.add(K.partMesh(K.cylinder(0.012, 0.012, 0.008, { seg: 12 }), mat('steel', '#c9ccd0', { flat: true }), null, { position: [x, -0.008, z] }));
}

function buildCeilingAbsorber(spec) {
  const P = spec.params, C = spec.colors, M = spec.materials;
  const { w, d, h } = spec.dims;
  const shape = P.shape || 'baffle';
  const g = new THREE.Group();
  const pm = mat(M.panel || 'felt', C.panel);
  if (shape === 'baffle') {
    const t = Math.max(0.01, num(P.thickness, d));
    const drop = Math.max(num(P.drop, h + 0.12), h + 0.03);
    const yTop = -(drop - h);
    g.add(K.partMesh(K.roundedBox(w, h, t, Math.min(0.01, t / 3), 3), pm, 'panel', { position: [0, yTop - h / 2 - 0.006, 0] }));
    g.add(K.partMesh(K.box(w, 0.012, t + 0.004, { grain: 'x' }), mat(M.frame || 'ash', C.frame), 'frame', { position: [0, yTop - 0.006, 0] }));
    for (const s of [-1, 1]) addWire(g, s * w * 0.38, yTop, -0.006, 0);
    // a standing screen keeps the normal ceiling side view: the wires and the hanging read from there
    return finish(g);
  }
  const t = Math.max(0.01, num(P.thickness, h));
  const drop = Math.max(num(P.drop, 0.25), t + 0.03);
  const outline = shape === 'rect' ? K.roundedRectShape(w, d, Math.min(w, d) * 0.04) : shape === 'circle' ? new THREE.Shape(feltOutline('circle', Math.max(w, d), Math.max(w, d))) : new THREE.Shape(feltOutline('circle', w, d));
  const geo = K.extrudeShape(outline, t, { bevel: Math.min(0.008, t * 0.25), bevelSegments: 2, curveSegments: 32 });
  geo.rotateX(-Math.PI / 2);
  K.worldUV(geo);
  g.add(K.partMesh(geo, pm, 'panel', { position: [0, -drop, 0] }));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) addWire(g, sx * w * 0.3, -drop + t, -0.006, sz * d * 0.3);
  return thumbUnder(finish(g));
}

/**
 * Catalogue thumbnail of a flat raft: seen from below the front with no ceiling plate (ui/CatalogPanel.js thumbView
 * 'under'), so the underside and the wires read – straight from below, a white raft vanished against the plate.
 */
function thumbUnder(g) {
  g.userData.model.thumbView = 'under';
  return g;
}

// ---------------------------------------------------------------------------------------------------------------
// Archetype definitions (ARCHITECTURE §5)

function def(id, { parts, partLabels = {}, defaults, params = {}, dimsRange, build }) {
  const a = schema.archetypes[id];
  const fam = schema.families[a.family];
  const ps = parts || a.parts || fam.parts;
  const dd = defaults.dims;
  return {
    label: a.label,
    mount: a.mount,
    parts: [...ps],
    partLabels: Object.fromEntries(ps.map((p) => [p, partLabels[p] || fam.partLabels[p] || p])),
    defaults: { params: {}, ...defaults },
    params,
    dimsRange: dimsRange || {
      w: [+(dd.w * 0.4).toFixed(3), +(dd.w * 2.5).toFixed(3)],
      d: [+(dd.d * 0.4).toFixed(3), +(dd.d * 2.5).toFixed(3)],
      h: [+(dd.h * 0.4).toFixed(3), +(dd.h * 2.5).toFixed(3)],
    },
    build,
  };
}

const seedParam = { type: 'number', label: 'Variant', min: 1, max: 20, step: 1, default: 1 };
const POT_OPTIONS = [['auto', 'Som planten'], ['cylinder', 'Sylinder'], ['ribbed', 'Riflet krukke'], ['belly', 'Buet krukke'], ['taper', 'Konisk'], ['bowl', 'Skål']];
/** The six legacy motifs (labels only renamed), the motifs of models/artmotifs.js grouped, and an uploaded picture. */
const LEGACY_OPTIONS = [['misty-trees', 'Tåkete trær'], ['abstract', 'Abstrakt'], ['landscape', 'Landskap'],
  ['botanical', 'Botanisk (enkel)'], ['line-art', 'Strektegning (enkel)'], ['photo', 'Fjordfoto (klassisk)']];
const MOTIF_OPTIONS = [...LEGACY_OPTIONS, ...ART_MOTIF_OPTIONS, ['custom', 'Eget bilde']];
const plantParams = (species) => ({
  species: { type: 'enum', label: 'Plante', options: species },
  potStyle: { type: 'enum', label: 'Potte', options: POT_OPTIONS, default: 'auto' },
  potD: { type: 'number', label: 'Pottediameter', min: 0.06, max: 0.7, step: 0.01, unit: 'm' },
  potH: { type: 'number', label: 'Pottehøyde', min: 0.05, max: 0.8, step: 0.01, unit: 'm' },
  seed: seedParam,
});
const acoustic = (panel, slats, backing, frame, panelKind = 'felt', slatKind = 'oak', frameKind = slatKind) => ({
  colors: { panel, slats, backing, frame },
  materials: { panel: panelKind, slats: slatKind, backing: 'felt', frame: frameKind },
});

/** Decor and acoustic archetypes (merged into models/registry.js ARCHETYPES). */
export const archetypes = {
  'plant-floor': def('plant-floor', {
    parts: ['leaves', 'pot', 'trunk'],
    defaults: {
      dims: { w: 0.55, d: 0.55, h: 1.2 },
      params: { species: 'olive', potD: 0.3, potH: 0.26, potStyle: 'auto', seed: 1 },
      colors: { leaves: '#5d7349', pot: '#e8e4dc', trunk: '#6b5a48' },
      materials: { leaves: 'plant-leaf', pot: 'ceramic', trunk: 'plastic' },
    },
    params: plantParams([['palm', 'Palme (areca)'], ['kentia', 'Kentiapalme'], ['monstera', 'Monstera'], ['olive', 'Oliventre'], ['ficus-lyrata', 'Fiolfiken'], ['strelitzia', 'Paradisfugl / bananplante'], ['pampas', 'Pampasgress'], ['pothos', 'Gullranke (hengende)'], ['anthurium', 'Satengranke (hengende)']]),
    dimsRange: { w: [0.2, 2.0], d: [0.2, 2.0], h: [0.4, 2.6] },
    build: buildPlant,
  }),
  'plant-small': def('plant-small', {
    defaults: {
      dims: { w: 0.2, d: 0.2, h: 0.3 },
      params: { species: 'herb', potStyle: 'auto', seed: 1 },
      colors: { leaves: '#4f7a3a', pot: '#f0efea' },
      materials: { leaves: 'plant-leaf', pot: 'ceramic' },
    },
    params: plantParams([['herb', 'Urt / liten busk'], ['fern', 'Aspargesbregne'], ['eucalyptus', 'Eukalyptus'], ['pothos', 'Gullranke'], ['anthurium', 'Satengranke'], ['monstera', 'Monstera'], ['palm', 'Palme'], ['olive', 'Oliventre']]),
    dimsRange: { w: [0.08, 1.2], d: [0.08, 1.2], h: [0.1, 1.0] },
    build: buildPlant,
  }),
  vase: def('vase', {
    parts: ['body', 'flowers'],
    defaults: {
      dims: { w: 0.15, d: 0.15, h: 0.3 },
      params: { shape: 'round', flowers: 'none', seed: 1 },
      colors: { body: '#cfc6b8', flowers: '#8fa39a' },
      materials: { body: 'ceramic', flowers: 'plant-leaf' },
    },
    params: {
      shape: { type: 'enum', label: 'Form', options: [['round', 'Rund'], ['ribbed', 'Riflet'], ['wave', 'Bølget'], ['sculptural', 'Skulptural'], ['bottle', 'Flaske'], ['bud', 'Knoppvase'], ['bubble', 'Boble (glass)'], ['cylinder', 'Sylinder']] },
      flowers: { type: 'enum', label: 'Blomster', options: [['none', 'Ingen'], ['hydrangea', 'Hortensia'], ['pampas', 'Pampasgress'], ['eucalyptus', 'Eukalyptus'], ['sprig', 'Grønn kvist']] },
      h: { type: 'number', label: 'Vasehøyde (med blomster)', min: 0.05, max: 1.0, step: 0.01, unit: 'm', default: 0.3 },
      d: { type: 'number', label: 'Vasediameter (med blomster)', min: 0.04, max: 0.6, step: 0.01, unit: 'm', default: 0.15 },
      seed: seedParam,
    },
    dimsRange: { w: [0.04, 0.8], d: [0.04, 0.8], h: [0.05, 1.6] },
    build: buildVase,
  }),
  'art-frame': def('art-frame', {
    defaults: {
      dims: { w: 0.8, d: 0.04, h: 1.0 },
      // no default `depth`: the depth is params.depth (legacy data) or dims.d (design/art.md §3.5)
      params: { motif: 'abstract', frame: 'black', texture: 'canvas', seed: 1 },
      colors: { print: DEFAULT_PRINT, frame: '#151515' },
      materials: { print: 'cotton', frame: 'black-metal' },
    },
    params: {
      motif: { type: 'enum', label: 'Motiv', options: MOTIF_OPTIONS },
      frame: { type: 'enum', label: 'Ramme', options: FRAME_OPTIONS },
      frameW: { type: 'number', label: 'Rammebredde', min: 0.005, max: 0.08, step: 0.001, unit: 'm', default: 0.02 },
      texture: { type: 'enum', label: 'Overflate', options: [['canvas', 'Lerret'], ['painted', 'Malt (penselstrøk)'], ['relief', 'Struktur / relieff'], ['paper', 'Papirtrykk'], ['photo', 'Fotopapir']] },
      mat: { type: 'bool', label: 'Passepartout', default: false },
      matW: { type: 'number', label: 'Passepartoutbredde', min: 0.015, max: 0.15, step: 0.005, unit: 'm', default: 0.06, requires: 'mat' },
      // over and under the opening (models/artlayout.js); unset = matW all round (defaultFrom: a hint for the Inspector)
      matH: { type: 'number', label: 'Passepartout over og under', min: 0.015, max: 0.15, step: 0.005, unit: 'm', default: 0.06, requires: 'mat', defaultFrom: 'matW' },
      glass: { type: 'bool', label: 'Glass (refleks)', default: false },
      seed: seedParam,
    },
    dimsRange: { w: [0.1, 3.0], d: [0.005, 0.1], h: [0.1, 3.0] },
    build: buildArt,
  }),
  'art-set': def('art-set', {
    defaults: {
      dims: { w: 1.32, d: 0.025, h: 0.76 }, // = the natural size of 'salon-5' at gap 0.06 (real frame sizes)
      params: { layout: 'salon-5', gap: 0.06, frame: 'thin', frameW: 0.012, texture: 'paper', mat: true, matW: 0.035, glass: true, seed: 1 },
      colors: { print: DEFAULT_PRINT, frame: '#151515' },
      materials: { print: 'paper', frame: 'black-metal' },
    },
    params: {
      layout: { type: 'enum', label: 'Oppsett', options: LAYOUT_OPTIONS },
      gap: { type: 'number', label: 'Mellomrom', min: 0.02, max: 0.25, step: 0.005, unit: 'm', default: 0.06, hint: 'Settet holder målene: mer mellomrom gir litt mindre bilder.' },
      frame: { type: 'enum', label: 'Ramme', options: FRAME_OPTIONS },
      mat: { type: 'bool', label: 'Passepartout', default: true },
      glass: { type: 'bool', label: 'Glass (refleks)', default: true },
      mirror: { type: 'bool', label: 'Speilvend oppsettet', default: false },
      seed: { ...seedParam, hint: 'Nye motiver i alle rammene.' },
    },
    dimsRange: { w: [0.25, 3.6], d: [0.005, 0.12], h: [0.2, 2.4] },
    build: buildArtSet,
  }),
  mirror: def('mirror', {
    defaults: {
      dims: { w: 0.9, d: 0.03, h: 0.9 },
      params: { shape: 'round', frameW: 0.035, frameDepth: 0.03 },
      colors: { print: '#c9cfd0', frame: '#1b1b1b' },
      materials: { print: 'mirror', frame: 'painted' },
    },
    params: {
      shape: { type: 'enum', label: 'Form', options: [['round', 'Rund / oval'], ['rect', 'Rektangulær'], ['rounded', 'Avrundede hjørner'], ['organic', 'Organisk'], ['arch', 'Buet topp']] },
      frameW: { type: 'number', label: 'Rammebredde', min: 0, max: 0.1, step: 0.001, unit: 'm' },
      shelf: { type: 'bool', label: 'Hylle', default: false },
      mullions: { type: 'bool', label: 'Sprosser', default: false },
      mullionCols: { type: 'number', label: 'Sprosser – kolonner', min: 1, max: 6, step: 1, default: 2 },
      mullionRows: { type: 'number', label: 'Sprosser – rader', min: 1, max: 8, step: 1, default: 3 },
    },
    dimsRange: { w: [0.2, 2.0], d: [0.005, 0.08], h: [0.2, 2.4] },
    build: buildMirror,
  }),
  'candle-holder': def('candle-holder', {
    defaults: {
      dims: { w: 0.14, d: 0.14, h: 0.2 },
      params: { kind: 'lantern', lit: true },
      colors: { body: '#8e9094' },
      materials: { body: 'glass-smoked' },
    },
    params: {
      kind: { type: 'enum', label: 'Type', options: [['lantern', 'Lykt'], ['tealight', 'Telysglass'], ['candlestick', 'Lysestake'], ['pillar', 'Kubbelys']] },
      count: { type: 'number', label: 'Antall', min: 1, max: 8, step: 1, default: 1 },
      lit: { type: 'bool', label: 'Tent', default: true },
      candleColor: { type: 'color', label: 'Lysfarge', default: '#f2efe8' },
    },
    dimsRange: { w: [0.04, 0.8], d: [0.04, 0.5], h: [0.03, 0.9] },
    build: buildCandleHolder,
  }),
  basket: def('basket', {
    defaults: {
      dims: { w: 0.46, d: 0.46, h: 0.46 },
      params: { shape: 'cylinder', weave: 'rattan' },
      colors: { body: '#b89a6e' },
      materials: { body: 'rattan' },
    },
    params: {
      shape: { type: 'enum', label: 'Form', options: [['cylinder', 'Rund'], ['oval', 'Oval'], ['rect', 'Firkantet'], ['stack', 'Bunke (blader/bøker)'], ['pedal-bin', 'Pedalbøtte (firkantet)'], ['pedal-bin-round', 'Pedalbøtte (rund)']] },
      weave: { type: 'enum', label: 'Fletting', options: [['rattan', 'Rotting'], ['rope', 'Tau'], ['none', 'Glatt'], ['foam', 'Skum med knotter']] },
      handles: { type: 'bool', label: 'Håndtak', default: false },
      lid: { type: 'bool', label: 'Lokk', default: false },
    },
    dimsRange: { w: [0.08, 1.0], d: [0.05, 1.0], h: [0.02, 1.0] },
    build: buildBasket,
  }),
  tv: def('tv', {
    defaults: {
      dims: { w: 1.72, d: 0.05, h: 0.99 },
      params: { screen: 'off', bezel: 0.005, wallMount: true },
      colors: { body: '#100e0f' },
      materials: { body: 'black-metal' },
    },
    params: {
      screen: { type: 'enum', label: 'Skjerm', options: [['off', 'Av (speiling)'], ['on', 'På (bilde)']] },
      bezel: { type: 'number', label: 'Kant rundt skjermen', min: 0, max: 0.05, step: 0.001, unit: 'm' },
      wallMount: { type: 'bool', label: 'Veggfeste', default: true },
    },
    dimsRange: { w: [0.6, 2.6], d: [0.02, 0.12], h: [0.35, 1.5] },
    build: buildTV,
  }),
  speaker: def('speaker', {
    defaults: {
      dims: { w: 0.2, d: 0.01, h: 0.4 },
      params: { style: 'in-wall' },
      colors: { body: '#d6d6d4' },
      materials: { body: 'painted' },
    },
    params: {
      style: { type: 'enum', label: 'Type', options: [['in-wall', 'Innfelt i veggen'], ['box', 'Veggmontert kabinett'], ['soundbar', 'Lydplanke']] },
    },
    dimsRange: { w: [0.08, 1.4], d: [0.005, 0.25], h: [0.06, 1.2] },
    build: buildSpeaker,
  }),
  'slat-panel': def('slat-panel', {
    defaults: {
      dims: { w: 0.6, d: 0.022, h: 2.4 },
      params: { slatW: 0.027, slatD: 0.013, gap: 0.013, orientation: 'vertical' },
      ...acoustic('#1b1b1b', '#5b4434', '#1b1b1b', '#5b4434', 'felt', 'smoked-oak'),
    },
    params: {
      slatW: { type: 'number', label: 'Spilebredde', min: 0.01, max: 0.08, step: 0.001, unit: 'm' },
      gap: { type: 'number', label: 'Mellomrom', min: 0.004, max: 0.06, step: 0.001, unit: 'm' },
      slatD: { type: 'number', label: 'Spiletykkelse', min: 0.005, max: 0.04, step: 0.001, unit: 'm' },
      orientation: { type: 'enum', label: 'Retning', options: [['vertical', 'Stående spiler'], ['horizontal', 'Liggende spiler']] },
    },
    dimsRange: { w: [0.2, 3.0], d: [0.012, 0.05], h: [0.2, 3.2] },
    build: buildSlatPanel,
  }),
  'fabric-panel': def('fabric-panel', {
    defaults: {
      dims: { w: 0.6, d: 0.04, h: 0.6 },
      params: { edge: 'square' },
      ...acoustic('#9b9894', '#9b9894', '#5d5b59', '#9b9894', 'woven', 'woven'),
    },
    params: {
      edge: { type: 'enum', label: 'Kant', options: [['square', 'Rett'], ['bevel', 'Avfaset'], ['rounded', 'Avrundet']] },
    },
    dimsRange: { w: [0.2, 2.4], d: [0.01, 0.1], h: [0.2, 2.8] },
    build: buildFabricPanel,
  }),
  'acoustic-art': def('acoustic-art', {
    defaults: {
      dims: { w: 1.8, d: 0.04, h: 1.2 },
      params: { motif: 'photo', thickness: 0.04, frame: 'none', seed: 1 },
      ...acoustic('#8c8579', '#8c8579', '#545049', '#1c1c1c', 'woven', 'woven', 'black-metal'),
    },
    params: {
      motif: { type: 'enum', label: 'Motiv', options: MOTIF_OPTIONS },
      frame: { type: 'enum', label: 'Ramme', options: [['none', 'Uten ramme'], ['alu', 'Smal ramme']] },
      seed: seedParam,
    },
    dimsRange: { w: [0.3, 3.0], d: [0.015, 0.1], h: [0.3, 2.6] },
    build: buildAcousticArt,
  }),
  'felt-shape': def('felt-shape', {
    defaults: {
      dims: { w: 0.6, d: 0.04, h: 0.52 },
      params: { shape: 'hexagon' },
      ...acoustic('#c8bba5', '#c8bba5', '#787063', '#c8bba5', 'woven', 'woven'),
    },
    params: {
      shape: { type: 'enum', label: 'Form', options: [['hexagon', 'Sekskant'], ['circle', 'Sirkel / oval'], ['square', 'Firkant'], ['rounded', 'Avrundet firkant'], ['semicircle', 'Halvsirkel'], ['triangle', 'Trekant'], ['cloud', 'Sky'], ['leaf', 'Blad']] },
    },
    dimsRange: { w: [0.15, 1.6], d: [0.01, 0.08], h: [0.15, 1.6] },
    build: buildFeltShape,
  }),
  'ceiling-absorber': def('ceiling-absorber', {
    defaults: {
      dims: { w: 0.95, d: 0.08, h: 0.53 },
      params: { shape: 'baffle' },
      ...acoustic('#c9bba6', '#c9bba6', '#797064', '#d9c3a0', 'woven', 'woven', 'ash'),
    },
    params: {
      shape: { type: 'enum', label: 'Form', options: [['baffle', 'Hengende skjerm (stående)'], ['round', 'Flåte (oval)'], ['circle', 'Flåte (rund)'], ['rect', 'Flåte (rektangulær)']] },
      drop: { type: 'number', label: 'Avstand fra tak', min: 0.05, max: 1.5, step: 0.01, unit: 'm' },
    },
    dimsRange: { w: [0.3, 3.0], d: [0.02, 2.0], h: [0.02, 1.2] },
    build: buildCeilingAbsorber,
  }),
};
