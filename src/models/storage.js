import * as THREE from 'three';
import schema from '../data/archetypes.json';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import * as K from './kit.js';
import { mat, emissive, kindGroup, isTransparentKind } from '../home/materials.js';
import { buildCabinet, vitrineDecor, decorMaterial, recolorer, P_CABINET } from './tables.js';

/**
 * Storage furniture for the rest of the house (ARCHITECTURE §5, parts §13 storage/table: body, front, top, legs,
 * handle):
 *
 *   wardrobe        garderobeskap: tall cabinet (hinged or sliding doors, mirror doors, drawers under the doors)
 *   dresser         kommode: drawer columns (graduated or even), legs/plinth
 *   bedside-table   nattbord: drawer(s) over an open shelf, a door, or a floating wall nightstand
 *   shoe-cabinet    skoskap: tilt-out compartments (fronts `flip:N`)
 *   wall-cabinet    veggskap (bathroom/hall): a cabinet hung on the wall (wall origin)
 *   mirror-cabinet  speilskap: mirror doors, optional LED light bar and open shelf (wall origin)
 *   bookcase        bokhylle: closed / open-back / ladder / frame shelves with books and objects, optional doors
 *
 * The cabinet archetypes share tables.js `buildCabinet` (fronts per column `door|mirror|glass|open|drawers:N|flip:N`,
 * a full-width drawer row on top or at the bottom, legs/plinth/wall base, handles, front styles), so their fronts,
 * gaps and handles look the same as the sideboards'. Every model measures itself from spec.dims.
 */

const num = (v, fb) => (typeof v === 'number' && Number.isFinite(v) ? v : fb);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const qSeg = (spec, n) => Math.max(3, Math.round(n * (spec.quality === 'low' ? 0.5 : spec.quality === 'high' ? 1.5 : 1)));

/** Def from the shared schema (label, mount, parts, partLabels incl. the archetype's own) + defaults/params/builder. */
function def(id, { defaults, params = {}, dimsRange, build }) {
  const a = schema.archetypes[id];
  const fam = schema.families[a.family];
  const parts = a.parts || fam.parts;
  return {
    label: a.label,
    mount: a.mount,
    parts: [...parts],
    partLabels: Object.fromEntries(parts.map((p) => [p, a.partLabels?.[p] || fam.partLabels[p] || p])),
    defaults: { params: {}, ...defaults },
    params,
    dimsRange,
    build,
  };
}

/** body/front/top/legs/handle colours and materials. */
const finish = (body, bodyKind, { front = body, frontKind = bodyKind, top = body, topKind = bodyKind, legs = body, legKind = bodyKind, handle = '#1c1c1c', handleKind = 'black-metal' } = {}) => ({
  colors: { body, front, top, legs, handle },
  materials: { body: bodyKind, front: frontKind, top: topKind, legs: legKind, handle: handleKind },
});

function add(g, geo, material, part, x = 0, y = 0, z = 0, rot) {
  const m = K.partMesh(geo, material, part, { position: [x, y, z], rotation: rot });
  g.add(m);
  return m;
}

const pm = (spec, part, fallbackKind, opts) => mat(spec.materials?.[part] || fallbackKind, spec.colors?.[part], opts);

/**
 * Re-origins a cabinet built on the floor (base 'wall', no lift) to the wall convention: back at z = 0, y = the
 * vertical middle. Surfaces move with it; wall items have no floor collider.
 */
function toWallOrigin(inner, { h, d }) {
  const g = new THREE.Group();
  inner.position.set(0, -h / 2, d / 2);
  g.add(inner);
  const m = inner.userData.model || {};
  g.userData.model = {
    ...m,
    surfaces: (m.surfaces || []).map((s) => ({ ...s, y: +(s.y - h / 2).toFixed(4), center: [s.center?.[0] ?? 0, +((s.center?.[1] ?? 0) + d / 2).toFixed(4)] })),
    colliders: undefined,
  };
  delete g.userData.model.colliders;
  return g;
}

// ---------------------------------------------------------------------------------------------------------------
// Param schemas

const CAB = P_CABINET;
const FRONTS_HINT = { type: 'number', min: 1, max: 6, step: 1, label: 'Antall kolonner' };
const P_WARDROBE = {
  base: { type: 'enum', label: 'Understell', options: [['plinth', 'Sokkel'], ['legs', 'Ben'], ['none', 'Rett på gulvet']] },
  legStyle: CAB.legStyle,
  legH: CAB.legH,
  doors: { ...FRONTS_HINT, label: 'Antall dører' },
  slidingDoors: { type: 'bool', label: 'Skyvedører' },
  doorFrame: { type: 'enum', label: 'Skyvedørene', options: [['none', 'Uten ramme'], ['alu', 'Aluminiumsramme']], default: 'none' },
  slidingPanels: { type: 'number', min: 1, max: 5, step: 1, label: 'Felt per skyvedør', default: 1 },
  frontStyle: CAB.frontStyle,
  handle: CAB.handle,
  handleLen: { type: 'number', min: 0.08, max: 1.2, step: 0.01, label: 'Håndtakslengde (m)', default: 0.3 },
  handleY: { type: 'number', min: 0.6, max: 1.6, step: 0.01, label: 'Håndtakshøyde (m)', default: 1.05 },
  drawerRow: { ...CAB.drawerRow, label: 'Skuffer under dørene' },
  drawerH: { type: 'number', min: 0.1, max: 0.5, step: 0.01, label: 'Skuffehøyde (m)', default: 0.2 },
  cornice: { type: 'bool', label: 'Gesims på toppen', default: false },
};
const P_DRESSER = {
  base: CAB.base,
  legStyle: CAB.legStyle,
  legH: CAB.legH,
  doors: FRONTS_HINT,
  drawerRow: CAB.drawerRow,
  drawerRowPos: CAB.drawerRowPos,
  graduated: { type: 'bool', label: 'Høyere skuffer nederst', default: false },
  frontStyle: CAB.frontStyle,
  handle: CAB.handle,
  top: CAB.top,
  corners: CAB.corners,
};
const P_NIGHT = {
  base: CAB.base,
  mountHeight: { ...CAB.mountHeight, label: 'Høyde over gulv når den henger (m)' },
  legStyle: CAB.legStyle,
  legH: CAB.legH,
  drawerRow: { ...CAB.drawerRow, label: 'Skuffer øverst' },
  drawerH: { type: 'number', min: 0.06, max: 0.4, step: 0.01, label: 'Skuffehøyde (m)', default: 0.12 },
  frontStyle: CAB.frontStyle,
  handle: CAB.handle,
  top: CAB.top,
  corners: CAB.corners,
};
const P_SHOE = {
  base: CAB.base,
  mountHeight: CAB.mountHeight,
  legStyle: CAB.legStyle,
  legH: CAB.legH,
  doors: FRONTS_HINT,
  frontStyle: CAB.frontStyle,
  handle: CAB.handle,
  top: CAB.top,
};
const P_WALLCAB = {
  doors: FRONTS_HINT,
  frontStyle: CAB.frontStyle,
  handle: CAB.handle,
  corners: CAB.corners,
  mountHeight: { type: 'number', min: 0.3, max: 2, step: 0.01, label: 'Underkant over gulv (m)', default: 1.2 },
};

// ---------------------------------------------------------------------------------------------------------------
// Cabinet-based builders

function buildWardrobe(spec) {
  const P = { ...spec.params };
  if (P.base !== 'legs' && P.base !== 'none') {
    P.base = 'plinth';
    if (typeof P.legH !== 'number') P.legH = 0.06;
  }
  return buildCabinet({ ...spec, params: P }, 'wardrobe');
}

function buildWallCabinet(spec) {
  const { h, d } = spec.dims;
  const inner = buildCabinet({ ...spec, params: { ...spec.params, base: 'wall', mountHeight: 0, frontFit: spec.params.frontFit || 'overlay' } }, 'wall-cabinet');
  return toWallOrigin(inner, { h, d });
}

// ---------------------------------------------------------------------------------------------------------------
// Mirror cabinet (speilskap): carcass, mirror doors (part front), LED bar, open shelf

function buildMirrorCabinet(spec) {
  const { w, d, h } = spec.dims;
  const P = spec.params;
  const C = spec.colors || {}, M = spec.materials || {};
  const g = new THREE.Group();
  const body = pm(spec, 'body', 'painted');
  const frontKind = M.front || 'mirror';
  const mirrorMat = mat(frontKind, C.front || '#c9cfd0');
  const handleMat = pm(spec, 'handle', 'chrome');
  const T = 0.016;
  const y0 = -h / 2, y1 = h / 2;
  const shelfMode = ['bottom', 'side'].includes(P.openShelf) ? P.openShelf : 'none';
  const led = ['top', 'sides'].includes(P.led) ? P.led : 'none';
  const ledH = led === 'top' ? clamp(h * 0.07, 0.035, 0.06) : 0;
  // the door part: below the LED bar, above a bottom shelf, beside a side shelf
  const shelfH = shelfMode === 'bottom' ? clamp(h * 0.18, 0.08, 0.16) : 0;
  const sideW = shelfMode === 'side' ? clamp(w * 0.22, 0.12, 0.25) : 0;
  const dy0 = y0 + shelfH, dy1 = y1 - ledH;
  const dx0 = -w / 2, dx1 = w / 2 - sideW;
  const cabD = d - 0.02; // the doors (2 cm) sit in front of the carcass
  // carcass (closed box behind the doors) + gables
  add(g, K.box(dx1 - dx0, dy1 - dy0, cabD, { grain: 'x' }), body, 'body', (dx0 + dx1) / 2, (dy0 + dy1) / 2, cabD / 2);
  const mirrorSides = P.mirrorSides === true;
  if (mirrorSides) {
    for (const sx of [-1, 1]) {
      const x = sx < 0 ? dx0 - 0.0015 : dx1 + 0.0015;
      if (sx > 0 && sideW) continue;
      add(g, K.box(0.003, dy1 - dy0 - 0.004, cabD - 0.004), mirrorMat, 'front', x, (dy0 + dy1) / 2, cabD / 2);
    }
  }
  // doors: mirror panels with a hair gap, each on a thin backing in the body colour
  const n = clamp(Math.round(num(P.doors, w > 0.9 ? 3 : w > 0.55 ? 2 : 1)), 1, 4);
  const gap = 0.003;
  const dw = (dx1 - dx0 - gap * (n - 1)) / n;
  const doorT = 0.018;
  for (let i = 0; i < n; i++) {
    const x0 = dx0 + i * (dw + gap);
    const cx = x0 + dw / 2;
    add(g, K.box(dw, dy1 - dy0 - 0.004, doorT - 0.004, { grain: 'y' }), body, 'body', cx, (dy0 + dy1) / 2, cabD + (doorT - 0.004) / 2);
    if (P.doorFrame === true) {
      // a painted frame round each mirror pane, the mirror set in
      const fw = Math.min(0.06, dw * 0.12), dh = dy1 - dy0 - 0.004, cy = (dy0 + dy1) / 2;
      for (const s of [-1, 1]) add(g, K.box(fw, dh, 0.018, { grain: 'y' }), body, 'body', cx + s * (dw / 2 - fw / 2), cy, cabD + doorT + 0.005);
      for (const s of [-1, 1]) add(g, K.box(dw - 2 * fw, fw, 0.018, { grain: 'x' }), body, 'body', cx, cy + s * (dh / 2 - fw / 2), cabD + doorT + 0.005);
      add(g, K.box(dw - 2 * fw + 0.004, dh - 2 * fw + 0.004, 0.004), mirrorMat, 'front', cx, cy, cabD + doorT + 0.002);
    } else add(g, K.roundedBox(dw - 0.002, dy1 - dy0 - 0.006, 0.004, 0.0015, 1), mirrorMat, 'front', cx, (dy0 + dy1) / 2, cabD + doorT - 0.002);
    if (P.handle === 'bar' || P.handle === 'knob') {
      const side = n === 1 ? 1 : i < n / 2 ? 1 : -1;
      const hx = side > 0 ? x0 + dw - 0.03 : x0 + 0.03;
      const hy = dy0 + 0.05 + (P.handle === 'bar' ? 0.06 : 0);
      if (P.handle === 'bar') add(g, K.roundedBox(0.012, 0.12, 0.014, 0.004, 1, { grain: 'y' }), handleMat, 'handle', hx, hy, cabD + doorT + 0.012);
      else add(g, K.cylinder(0.009, 0.011, 0.02, { seg: qSeg(spec, 12) }), handleMat, 'handle', hx, hy, cabD + doorT, [Math.PI / 2, 0, 0]);
    }
  }
  // open shelf under the cabinet (glass or the body colour) / open side column with shelves
  const surfaces = [];
  if (shelfMode === 'bottom') {
    const st = 0.012;
    add(g, K.box(w, st, d * 0.85, { grain: 'x' }), body, 'body', 0, y0 + st / 2, (d * 0.85) / 2);
    for (const sx of [-1, 1]) add(g, K.box(T, shelfH, d * 0.85, { grain: 'y' }), body, 'body', sx * (w / 2 - T / 2), y0 + shelfH / 2, (d * 0.85) / 2);
    add(g, K.box(w - 2 * T, shelfH, 0.006), body, 'body', 0, y0 + shelfH / 2, 0.003);
    surfaces.push({ y: +(y0 + st).toFixed(4), w: +(w - 2 * T - 0.01).toFixed(3), d: +(d * 0.8).toFixed(3), center: [0, +((d * 0.85) / 2).toFixed(4)] });
  } else if (shelfMode === 'side') {
    const sx0 = dx1 + gap, sx1 = w / 2;
    add(g, K.box(T, dy1 - dy0, cabD, { grain: 'y' }), body, 'body', sx1 - T / 2, (dy0 + dy1) / 2, cabD / 2);
    add(g, K.box(sx1 - sx0, dy1 - dy0, 0.006), body, 'body', (sx0 + sx1) / 2, (dy0 + dy1) / 2, 0.003);
    const nS = Math.max(2, Math.round((dy1 - dy0) / 0.2) + 1);
    for (let k = 0; k < nS; k++) {
      const y = dy0 + (k * (dy1 - dy0 - T)) / (nS - 1);
      add(g, K.box(sx1 - sx0 - T, T, cabD, { grain: 'x' }), body, 'body', (sx0 + sx1 - T) / 2, y + T / 2, cabD / 2);
      if (k < nS - 1) surfaces.push({ y: +(y + T).toFixed(4), w: +(sx1 - sx0 - T - 0.01).toFixed(3), d: +(cabD - 0.01).toFixed(3), center: [+((sx0 + sx1 - T) / 2).toFixed(4), +(cabD / 2).toFixed(4)] });
    }
  }
  // LED light: a bar on top (aluminium housing, glowing underside) or two strips beside the doors
  const lights = [];
  const colorK = 4000;
  if (led === 'top') {
    const housing = mat('steel', '#c9cbcc');
    add(g, K.roundedBox(w, ledH, d + 0.015, 0.004, 1, { grain: 'x' }), housing, null, 0, y1 - ledH / 2, (d + 0.015) / 2);
    const strip = K.partMesh(K.box(w - 0.04, 0.004, 0.03), emissive('#fff6e8', 1.2), null, { position: [0, y1 - ledH - 0.0015, d - 0.012] });
    strip.userData.noMerge = true;
    g.add(strip);
    lights.push({ type: 'spot', position: [0, y1 - ledH - 0.01, d + 0.02], direction: [0, -1, 0.35], angle: 1.1, penumbra: 0.8, colorK, lumens: 350, emissiveMeshes: [strip] });
  } else if (led === 'sides') {
    const strips = [];
    for (const sx of [-1, 1]) {
      const s = K.partMesh(K.box(0.012, (dy1 - dy0) * 0.8, 0.006), emissive('#fff6e8', 1.1), null, { position: [sx < 0 ? dx0 + 0.02 : dx1 - 0.02, (dy0 + dy1) / 2, cabD + doorT + 0.002] });
      s.userData.noMerge = true;
      g.add(s);
      strips.push(s);
    }
    lights.push({ type: 'point', position: [0, (dy0 + dy1) / 2, d + 0.12], colorK, lumens: 300, emissiveMeshes: strips });
  }
  if (P.cornice === true && led !== 'top') add(g, K.roundedBox(w + 0.03, 0.035, d + 0.03, 0.004, 1, { grain: 'x' }), body, 'body', 0, y1 + 0.0175, (d + 0.03) / 2 - 0.0);
  // the top of the cabinet is a narrow shelf
  surfaces.unshift({ y: +y1.toFixed(4), w: +(w - 0.02).toFixed(3), d: +(d - 0.03).toFixed(3), center: [0, +(d / 2).toFixed(4)] });
  const rc = recolorer(g, (part, kind) => part === 'front' && !!kind && (isTransparentKind(kind) || kindGroup(kind) !== kindGroup(frontKind)));
  g.name = 'mirror-cabinet';
  return K.finishModel(g, { surfaces, lights, recolor: rc });
}

// ---------------------------------------------------------------------------------------------------------------
// Bookcase (bokhylle)

/** Batches the vitrine decor pieces (books/ceramics vertex-coloured, glass as is) into a few meshes on `g`. */
function decorBatch(g) {
  const batch = { ceramic: [], book: [] };
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _one = new THREE.Vector3(1, 1, 1), _v = new THREE.Vector3();
  const _col = new THREE.Color();
  const put = (geo, material, x, y, z, rot) => {
    if (!material?.decor) {
      const m = K.partMesh(geo, material, null, { position: [x, y, z], rotation: rot });
      m.userData.noShadow = true;
      g.add(m);
      return;
    }
    _q.setFromEuler(_e.set(...(rot || [0, 0, 0])));
    geo.applyMatrix4(_m.compose(_v.set(x, y, z), _q, _one));
    _col.set(material.hex);
    const n = geo.attributes.position.count;
    const c = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) c.set([_col.r, _col.g, _col.b], i * 3);
    geo.setAttribute('color', new THREE.BufferAttribute(c, 3));
    for (const k of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(k)) geo.deleteAttribute(k);
    batch[material.decor].push(geo.index ? geo : geo.toNonIndexed());
  };
  const finish = () => {
    for (const [kind, list] of Object.entries(batch)) {
      if (!list.length) continue;
      const geo = mergeGeometries(list, false);
      for (const x of list) x.dispose();
      if (!geo) continue;
      const m = new THREE.Mesh(geo, decorMaterial(kind));
      m.name = `shelf-decor-${kind}`;
      m.userData.noMerge = true;
      m.userData.noShadow = true;
      g.add(m);
    }
  };
  return { put, finish };
}

function buildBookcase(spec) {
  const { w, d, h } = spec.dims;
  const P = spec.params;
  const g = new THREE.Group();
  const style = ['closed', 'open-back', 'ladder', 'frame'].includes(P.style) ? P.style : 'closed';
  const body = pm(spec, 'body', 'oak', { grain: 'x' });
  const bodyV = pm(spec, 'body', 'oak', { grain: 'y' });
  const topMat = pm(spec, 'top', spec.materials?.body || 'oak');
  const legsMat = pm(spec, 'legs', spec.materials?.body || 'oak');
  const frontMat = pm(spec, 'front', spec.materials?.body || 'oak');
  const handleMat = pm(spec, 'handle', 'black-metal');
  const cols = clamp(Math.round(num(P.cols, Math.max(1, Math.round(w / 0.8)))), 1, 6);
  const rows = clamp(Math.round(num(P.rows, Math.max(2, Math.round(h / 0.36)))), 1, 10);
  const decorOn = P.decor !== false;
  const seg = qSeg(spec, 10);
  const surfaces = [];
  const levels = []; // decor slots { x0, x1, y, clear, z0, z1 }
  const dec = decorOn ? decorBatch(g) : null;

  if (style === 'ladder') {
    // leaning ladder shelf: two side rails from the floor at the front to the wall at the top, shelves get shallower
    const railT = 0.032, railW = 0.045;
    const zB = d / 2 - railW / 2, zT = -d / 2 + railW / 2; // rail centre line: front foot → top at the wall
    const len = Math.hypot(h, zB - zT);
    for (const sx of [-1, 1]) {
      const m = add(g, K.box(railT, len, railW, { grain: 'y' }), bodyV, 'body', sx * (w / 2 - railT / 2), h / 2, (zB + zT) / 2);
      m.rotation.x = Math.atan2(zT - zB, h);
    }
    const zAt = (y) => zB + (zT - zB) * (y / h); // front rail line
    for (let k = 0; k < rows; k++) {
      const y = 0.08 + (k * (h - 0.18)) / Math.max(1, rows - 1);
      const zF = zAt(y) + railW * 0.4;
      const sd = Math.max(0.1, zF + d / 2 - 0.005);
      add(g, K.box(w - 2 * railT, 0.02, sd, { grain: 'x' }), k === rows - 1 ? topMat : body, k === rows - 1 ? 'top' : 'body', 0, y, -d / 2 + 0.005 + sd / 2);
      surfaces.push({ y: +(y + 0.01).toFixed(4), w: +(w - 2 * railT - 0.02).toFixed(3), d: +(sd - 0.02).toFixed(3), center: [0, +(-d / 2 + 0.005 + sd / 2).toFixed(4)] });
      const next = k < rows - 1 ? 0.08 + ((k + 1) * (h - 0.18)) / Math.max(1, rows - 1) : h;
      levels.push({ x0: -w / 2 + railT, x1: w / 2 - railT, y: y + 0.01, clear: Math.min(0.32, next - y - 0.04), z0: -d / 2 + 0.01, z1: -d / 2 + sd - 0.02, bay: 0 });
    }
  } else {
    const T = 0.018;
    const base = ['plinth', 'legs', 'none'].includes(P.base) ? P.base : style === 'frame' ? 'none' : 'plinth';
    const legH = base === 'none' ? 0 : clamp(num(P.legH, base === 'plinth' ? 0.06 : 0.12), 0, h * 0.3);
    const yb = legH;
    const frame = style === 'frame';
    const postW = frame ? clamp(num(P.postW, 0.025), 0.012, 0.05) : T;
    // sides / posts
    if (frame) {
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) add(g, K.box(postW, h, postW, { grain: 'y' }), legsMat, 'legs', sx * (w / 2 - postW / 2), h / 2, sz * (d / 2 - postW / 2));
      // a light X brace across the back
      const bl = Math.hypot(w - 2 * postW, h - yb);
      for (const s of [-1, 1]) {
        const m = add(g, K.box(0.006, bl, 0.006), legsMat, 'legs', 0, (h + yb) / 2, -d / 2 + 0.004);
        m.rotation.z = s * Math.atan2(w - 2 * postW, h - yb);
      }
    } else {
      for (const sx of [-1, 1]) add(g, K.box(T, h - (base === 'legs' ? yb : 0), d, { grain: 'y' }), bodyV, 'body', sx * (w / 2 - T / 2), (h + (base === 'legs' ? yb : 0)) / 2, 0);
      if (style === 'closed') add(g, K.box(w - 2 * T, h - yb - T, 0.006, { grain: 'y' }), bodyV, 'body', 0, (h + yb - T) / 2, -d / 2 + 0.006);
    }
    const ix0 = -w / 2 + postW, ix1 = w / 2 - postW;
    // top + bottom
    add(g, K.box(frame ? w : w - 2 * T, T, frame ? d : d, { grain: 'x' }), topMat, 'top', 0, h - T / 2, 0);
    add(g, K.box(ix1 - ix0, T, d - 0.005, { grain: 'x' }), body, 'body', 0, yb + T / 2, 0.0025);
    surfaces.push({ y: +h.toFixed(4), w: +(w - 0.02).toFixed(3), d: +(d - 0.02).toFixed(3), center: [0, 0] });
    if (base === 'plinth' && legH > 0.005) add(g, K.box(ix1 - ix0, legH, 0.018, { grain: 'x' }), legsMat, 'legs', 0, legH / 2, d / 2 - 0.03);
    else if (base === 'legs' && legH > 0.005 && !frame) {
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) add(g, K.cylinder(0.016, 0.013, legH, { seg: qSeg(spec, 12) }), legsMat, 'legs', sx * (w / 2 - 0.04), 0, sz * (d / 2 - 0.04));
    }
    // columns and shelves
    const colW = (ix1 - ix0 - (cols - 1) * T) / cols;
    const iy0 = yb + T, iy1 = h - T;
    const rowH = (iy1 - iy0 - (rows - 1) * T) / rows;
    const doorRows = clamp(Math.round(num(P.doorRows, 0)), 0, rows);
    const doorStyle = ['flat', 'glass', 'framed'].includes(P.doorStyle) ? P.doorStyle : 'flat';
    for (let c = 0; c < cols; c++) {
      const x0 = ix0 + c * (colW + T), x1 = x0 + colW;
      if (c > 0) add(g, K.box(T, iy1 - iy0, d - 0.01, { grain: 'y' }), bodyV, 'body', x0 - T / 2, (iy0 + iy1) / 2, 0.003);
      for (let r = 0; r < rows; r++) {
        const y = iy0 + r * (rowH + T);
        if (r > 0) add(g, K.box(colW, T, d - 0.015, { grain: 'x' }), body, 'body', (x0 + x1) / 2, y - T / 2, 0.004);
        const door = r < doorRows;
        if (door) {
          const nd = colW > 0.62 ? 2 : 1;
          const dw = (colW - 0.004 - (nd - 1) * 0.003) / nd;
          for (let k = 0; k < nd; k++) {
            const dx0 = x0 + 0.002 + k * (dw + 0.003), cx = dx0 + dw / 2;
            const dy0 = y + (r === 0 ? 0.002 : -T / 2 + 0.002), dy1 = y + rowH + (r === doorRows - 1 ? -0.002 : T / 2 - 0.002);
            const dh = dy1 - dy0, cy = (dy0 + dy1) / 2, zF = d / 2;
            if (doorStyle === 'flat') add(g, K.box(dw, dh, 0.018, { grain: 'y' }), frontMat, 'front', cx, cy, zF - 0.009);
            else {
              const fw = Math.min(0.06, dw * 0.16);
              for (const s of [-1, 1]) add(g, K.box(fw, dh, 0.018, { grain: 'y' }), frontMat, 'front', cx + s * (dw / 2 - fw / 2), cy, zF - 0.009);
              for (const s of [-1, 1]) add(g, K.box(dw - 2 * fw, fw, 0.018, { grain: 'x' }), frontMat, 'front', cx, cy + s * (dh / 2 - fw / 2), zF - 0.009);
              if (doorStyle === 'glass') add(g, K.box(dw - 2 * fw + 0.006, dh - 2 * fw + 0.006, 0.004), mat('glass-clear', '#f2f6f4'), null, cx, cy, zF - 0.009);
              else add(g, K.box(dw - 2 * fw + 0.006, dh - 2 * fw + 0.006, 0.01, { grain: 'y' }), frontMat, 'front', cx, cy, zF - 0.012);
            }
            if (P.handle === 'knob' || P.handle === 'bar') {
              const side = nd === 1 ? 1 : k === 0 ? 1 : -1;
              const hx = side > 0 ? dx0 + dw - 0.035 : dx0 + 0.035;
              if (P.handle === 'knob') add(g, K.cylinder(0.011, 0.013, 0.022, { seg: qSeg(spec, 12) }), handleMat, 'handle', hx, dy1 - 0.06, zF, [Math.PI / 2, 0, 0]);
              else add(g, K.box(0.011, Math.min(0.12, dh * 0.4), 0.011, { grain: 'y' }), handleMat, 'handle', hx, dy1 - 0.04 - Math.min(0.12, dh * 0.4) / 2, zF + 0.02);
            }
          }
          if (doorStyle !== 'glass') continue;
        }
        surfaces.push({ y: +y.toFixed(4), w: +(colW - 0.01).toFixed(3), d: +(d - 0.04).toFixed(3), center: [+((x0 + x1) / 2).toFixed(4), 0] });
        levels.push({ x0, x1, y, clear: rowH - 0.01, z0: -d / 2 + (style === 'closed' ? 0.012 : 0.02), z1: d / 2 - (door ? 0.03 : 0.015), bay: c });
      }
    }
  }
  // books and a few objects on the open shelves (deterministic per size and level)
  if (dec) {
    levels.forEach((lv, li) => {
      const rnd = K.rng(`bookcase|${Math.round(w * 100)}|${Math.round(h * 100)}|${lv.bay}|${li}|${style}`);
      vitrineDecor(dec.put, { x0: lv.x0, x1: lv.x1, y: lv.y, clear: lv.clear, z0: lv.z0, z1: Math.max(lv.z0 + 0.05, lv.z1) }, rnd, seg);
    });
    dec.finish();
  }
  g.name = 'bookcase';
  // free-standing tall shelves: collide with the carcass only (not the books)
  return K.finishModel(g, { surfaces: surfaces.slice(0, 24), recolor: recolorer(g, (part, kind) => !!kind && part === 'front') });
}

// ---------------------------------------------------------------------------------------------------------------
// Archetypes

/**
 * Storage archetypes for models/registry.js.
 * @type {Record<string, object>}
 */
export const archetypes = {
  wardrobe: def('wardrobe', {
    defaults: {
      dims: { w: 1.0, d: 0.6, h: 2.0 },
      // no 'doors' default: products give 'fronts' (a default count would cut a three-door front list to two)
      params: { base: 'plinth', legH: 0.06, fronts: ['door', 'door'], frontStyle: 'flat', handle: 'bar', handleLen: 0.3, handleY: 1.05, top: 'same', corners: 'square', frontFit: 'inset' },
      ...finish('#efeee9', 'painted'),
    },
    params: P_WARDROBE,
    dimsRange: { w: [0.4, 3.2], d: [0.35, 0.7], h: [1.4, 2.5] },
    build: buildWardrobe,
  }),
  dresser: def('dresser', {
    defaults: {
      dims: { w: 0.8, d: 0.45, h: 0.95 },
      params: { base: 'legs', legStyle: 'wood-taper', legH: 0.14, fronts: ['drawers:4'], frontStyle: 'flat', handle: 'knob', top: 'same', corners: 'square' },
      ...finish('#c9a77f', 'oak', { handle: '#1c1c1c', handleKind: 'black-metal' }),
    },
    params: P_DRESSER,
    dimsRange: { w: [0.4, 2.2], d: [0.3, 0.6], h: [0.5, 1.5] },
    build: (spec) => buildCabinet(spec, 'dresser'),
  }),
  'bedside-table': def('bedside-table', {
    defaults: {
      dims: { w: 0.45, d: 0.38, h: 0.5 },
      // no drawer-row default: it would add a drawer on top of every product's own fronts
      params: { base: 'legs', legStyle: 'wood-taper', legH: 0.2, fronts: ['drawers:2'], frontStyle: 'flat', handle: 'none', top: 'same', corners: 'square' },
      ...finish('#c9a77f', 'oak'),
    },
    params: P_NIGHT,
    dimsRange: { w: [0.3, 0.8], d: [0.25, 0.55], h: [0.15, 0.8] },
    build: (spec) => buildCabinet(spec, 'bedside-table'),
  }),
  'shoe-cabinet': def('shoe-cabinet', {
    defaults: {
      dims: { w: 0.8, d: 0.3, h: 1.0 },
      params: { base: 'legs', legStyle: 'metal-thin', legH: 0.1, fronts: ['flip:2', 'flip:2'], frontStyle: 'flat', handle: 'knob', top: 'same', corners: 'square' },
      ...finish('#efeee9', 'painted'),
    },
    params: P_SHOE,
    dimsRange: { w: [0.4, 1.6], d: [0.15, 0.45], h: [0.3, 2.0] },
    build: (spec) => buildCabinet(spec, 'shoe-cabinet'),
  }),
  'wall-cabinet': def('wall-cabinet', {
    defaults: {
      dims: { w: 0.6, d: 0.25, h: 0.6 },
      params: { fronts: ['door', 'door'], frontStyle: 'flat', handle: 'bar', corners: 'square', mountHeight: 1.2 },
      ...finish('#efeee9', 'painted'),
    },
    params: P_WALLCAB,
    dimsRange: { w: [0.2, 1.6], d: [0.12, 0.45], h: [0.2, 1.4] },
    build: buildWallCabinet,
  }),
  'mirror-cabinet': def('mirror-cabinet', {
    defaults: {
      dims: { w: 0.6, d: 0.15, h: 0.7 },
      params: { doors: 2, led: 'none', openShelf: 'none', mirrorSides: false, handle: 'none', mountHeight: 1.2 },
      colors: { body: '#efeee9', front: '#c9cfd0', handle: '#c8c8c8' },
      materials: { body: 'painted', front: 'mirror', handle: 'chrome' },
    },
    params: {
      doors: { type: 'number', min: 1, max: 4, step: 1, label: 'Antall speildører' },
      led: { type: 'enum', label: 'Lys', options: [['none', 'Uten'], ['top', 'Lyslist over'], ['sides', 'Lys på sidene']] },
      openShelf: { type: 'enum', label: 'Åpen hylle', options: [['none', 'Ingen'], ['bottom', 'Under skapet'], ['side', 'Ved siden av']] },
      mirrorSides: { type: 'bool', label: 'Speil på sidene' },
      doorFrame: { type: 'bool', label: 'Ramme rundt speilene' },
      cornice: { type: 'bool', label: 'Gesims på toppen' },
      handle: { type: 'enum', label: 'Håndtak', options: [['none', 'Uten'], ['bar', 'Lite grep'], ['knob', 'Knott']] },
      mountHeight: { type: 'number', min: 0.8, max: 1.8, step: 0.01, label: 'Underkant over gulv (m)' },
    },
    dimsRange: { w: [0.3, 1.6], d: [0.08, 0.3], h: [0.35, 1.2] },
    build: buildMirrorCabinet,
  }),
  bookcase: def('bookcase', {
    defaults: {
      dims: { w: 0.8, d: 0.28, h: 2.0 },
      params: { style: 'closed', cols: 1, rows: 6, doorRows: 0, doorStyle: 'flat', base: 'plinth', legH: 0.06, decor: true, handle: 'knob' },
      ...finish('#efeee9', 'painted'),
    },
    params: {
      style: { type: 'enum', label: 'Type', options: [['closed', 'Lukket med rygg'], ['open-back', 'Uten rygg'], ['ladder', 'Stigehylle'], ['frame', 'Åpent stativ']] },
      cols: { type: 'number', min: 1, max: 6, step: 1, label: 'Kolonner' },
      rows: { type: 'number', min: 1, max: 10, step: 1, label: 'Hyllerader' },
      doorRows: { type: 'number', min: 0, max: 6, step: 1, label: 'Rader med dører (nederst)' },
      doorStyle: { type: 'enum', label: 'Dører', options: [['flat', 'Glatte'], ['framed', 'Rammedører'], ['glass', 'Glass']] },
      base: { type: 'enum', label: 'Understell', options: [['plinth', 'Sokkel'], ['legs', 'Ben'], ['none', 'Rett på gulvet']] },
      legH: { type: 'number', min: 0, max: 0.3, step: 0.01, label: 'Sokkel-/benhøyde (m)' },
      decor: { type: 'bool', label: 'Bøker og pynt', default: true },
      handle: { type: 'enum', label: 'Håndtak', options: [['none', 'Uten'], ['knob', 'Knott'], ['bar', 'Stanggrep']] },
    },
    dimsRange: { w: [0.3, 3.0], d: [0.18, 0.5], h: [0.6, 2.6] },
    build: buildBookcase,
  }),
};
