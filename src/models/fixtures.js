import * as THREE from 'three';
import schema from '../data/archetypes.json';
import * as K from './kit.js';
import { mat, kindGroup } from '../home/materials.js';
import { recolorer } from './tables.js';
import { buildMirror } from './decor.js';

/**
 * Bathroom and hall fittings (ARCHITECTURE §5):
 *
 *   mirror-floor    gulvspeil (framed: print = mirror glass, frame): leaning, on feet, on an easel leg or in a cheval
 *                   frame – the wall mirror's shapes and mullions (decor.js buildMirror)
 *   towel           håndklær (textile, soft): a folded stack or rolls, an optional border stripe (part piping)
 *   towel-ladder    håndklestige (fixture: body, fabric = the towels shown on it): leaning, on a base or on feet
 *   towel-rail      håndklestang (wall): bars, a ring or hooks, with towels hanging
 *   bath-accessory  badetilbehør (surface): soap pump, tumbler, toothbrush holder, soap dish, tray or the set
 *   coat-rack       knaggrekke (wall): a rail with hooks, separate pegs or a hat shelf, with coats hanging
 *   coat-stand      stumtjener (floor): a pole with hooks, a tripod or a clothes rail, with coats
 *
 * Floor/surface items stand on y = 0 with the front toward +z; wall items have the back at z = 0 and y = the vertical
 * middle of dims.h (towels and coats hang below the fitting, outside dims).
 */

const num = (v, fb) => (typeof v === 'number' && Number.isFinite(v) ? v : fb);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const DEG = Math.PI / 180;
const QF = { low: 0.6, medium: 1, high: 1.5 };
const seg = (spec, n) => Math.max(4, Math.round(n * (QF[spec.quality] ?? 1)));
const _UP = new THREE.Vector3(0, 1, 0);
const WHITE = new THREE.Color(1, 1, 1);

function tone(hex, f) {
  const c = new THREE.Color(hex || '#808080');
  if (f <= 1) c.multiplyScalar(f);
  else c.lerp(WHITE, Math.min(1, f - 1));
  return `#${c.getHexString()}`;
}

function add(g, geo, material, part, x = 0, y = 0, z = 0, rot) {
  const m = K.partMesh(geo, material, part, { position: [x, y, z], rotation: rot });
  g.add(m);
  return m;
}

function stick(g, material, part, a, b, r0, r1 = r0, { square = false, n = 10 } = {}) {
  const dir = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const len = dir.length();
  if (len < 0.003) return null;
  dir.normalize();
  const m = K.partMesh(K.taperLeg(len, r1, r0, { seg: n, square }), material, part, { position: a });
  m.quaternion.setFromUnitVectors(_UP, dir);
  g.add(m);
  return m;
}

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

/** Material of a part with wood grain along `grain` when the kind is a wood. */
function partMat(spec, part, fallbackKind, grain = 'y') {
  const kind = spec.materials?.[part] || fallbackKind;
  return mat(kind, spec.colors?.[part], kindGroup(kind) === 'wood' ? { grain } : undefined);
}

// ---------------------------------------------------------------------------------------------------------------
// Draped textiles

/** A towel hanging over a horizontal bar (axis x) at (x, y, z): front and back drops joined by a soft roll. */
function drapedTowel(g, m, part, { x, y, z, tw, drop, r = 0.012, t = 0.012, front = 1, back = 0.8 }) {
  const roll = K.cylinder(r + t, r + t, tw, { seg: 12, center: true, thetaStart: Math.PI / 2, thetaLength: Math.PI });
  roll.rotateZ(Math.PI / 2);
  add(g, roll, m, part, x, y, z);
  const df = drop * front, db = drop * back;
  add(g, K.cushion(tw, df, t, { axis: 'z', puff: 0.25, round: 0.9, sides: 0.1, seg: 10 }), m, part, x, y - df / 2, z + r + t / 2);
  add(g, K.cushion(tw, db, t, { axis: 'z', puff: 0.25, round: 0.9, sides: 0.1, seg: 10 }), m, part, x, y - db / 2, z - r - t / 2);
}

/** A coat hanging from a hook at (x, y, z): a soft tapered body, shoulders at the top, front toward +z. */
function coat(g, m, { x, y, z, cw = 0.42, ch = 0.85, ct = 0.11, seed = 0 }) {
  const body = K.cushion(cw, ch, ct, { axis: 'z', puff: 0.25, round: 0.6, sides: 0.15, seg: 14 });
  // shoulders slope down from the collar, then a straight body that widens a little toward the hem
  const pos = body.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const v = (pos.getY(i) + ch / 2) / ch; // 0 = hem, 1 = collar
    const x = pos.getX(i), ax = Math.abs(x) / (cw / 2);
    const aLine = 0.9 + 0.1 * (1 - v);
    pos.setX(i, x * aLine);
    if (v > 0.8) pos.setY(i, pos.getY(i) - ax * ax * (v - 0.8) / 0.2 * ch * 0.09);
  }
  pos.needsUpdate = true;
  body.computeVertexNormals();
  add(g, body, m, 'fabric', x, y - 0.05 - ch / 2, z + ct / 2 + 0.01, [0, (seed % 2 ? 1 : -1) * 4 * DEG, 0]);
  // collar
  add(g, K.torus(0.06, 0.018, { radial: 6, tubular: 14 }), m, 'fabric', x, y - 0.06, z + ct / 2 + 0.01, [Math.PI / 2, 0, 0]);
}

// ---------------------------------------------------------------------------------------------------------------
// Floor mirror

function buildMirrorFloor(spec) {
  const { w, d, h } = spec.dims;
  const P = spec.params;
  const g = new THREE.Group();
  const stand = ['lean', 'feet', 'easel', 'cheval'].includes(P.stand) ? P.stand : 'lean';
  const depth = clamp(num(P.frameDepth, d), 0.006, 0.08);
  const inner = buildMirror({ ...spec, params: { ...P, frameDepth: depth }, dims: { w, d: depth, h } });
  const frameMat = partMat(spec, 'frame', 'black-metal', 'y');
  const lift = stand === 'feet' ? 0.03 : stand === 'cheval' ? 0.1 : 0;
  const pivot = new THREE.Group();
  g.add(pivot);
  pivot.add(inner);
  inner.position.set(0, h / 2, -depth / 2);
  let lean = 0;
  if (stand === 'lean' || stand === 'easel') lean = clamp(num(P.tilt, stand === 'easel' ? 10 : 7), 0, 20) * DEG;
  else if (stand === 'cheval') lean = clamp(num(P.tilt, 4), 0, 15) * DEG;
  // tilt back about the bottom front edge; centre the footprint on the origin
  const foot = depth + h * Math.sin(lean);
  pivot.position.set(0, lift, foot / 2);
  pivot.rotation.x = -lean;
  if (stand === 'feet') {
    for (const sx of [-1, 1]) add(g, K.roundedBox(0.04, lift + 0.03, 0.16, 0.006, 1, { bottom: true }), frameMat, 'frame', sx * (w / 2 - 0.08), 0, foot / 2 - depth / 2);
  } else if (stand === 'easel') {
    const top = [0, h * 0.75 * Math.cos(lean), foot / 2 - depth - h * 0.75 * Math.sin(lean)];
    stick(g, frameMat, 'frame', top, [0, 0, top[2] - h * 0.32], 0.012, 0.012, { n: 8 });
  } else if (stand === 'cheval') {
    const py = lift + h * 0.55;
    for (const sx of [-1, 1]) {
      const x = sx * (w / 2 + 0.035);
      add(g, K.roundedBox(0.03, py + 0.04, 0.03, 0.004, 1, { bottom: true, grain: 'y' }), frameMat, 'frame', x, 0, foot / 2 - depth / 2);
      add(g, K.roundedBox(0.035, 0.025, 0.32, 0.004, 1, { grain: 'z' }), frameMat, 'frame', x, 0.0125, foot / 2 - depth / 2);
      add(g, K.cylinder(0.012, 0.012, 0.035, { seg: 10, center: true }), mat('brass', '#b08d57'), null, sx * (w / 2 + 0.017), py, foot / 2 - depth / 2, [0, 0, Math.PI / 2]);
    }
  }
  g.name = 'mirror-floor';
  return K.finishModel(g, { recolor: recolorer(g, (part, kind) => !!kind && part === 'frame') });
}

// ---------------------------------------------------------------------------------------------------------------
// Towels (folded stack / rolls)

function buildTowel(spec) {
  const { w, d, h } = spec.dims;
  const P = spec.params;
  const C = spec.colors || {}, M = spec.materials || {};
  const g = new THREE.Group();
  const kind = M.fabric || 'cotton';
  const fm = mat(kind, C.fabric || '#ece7df');
  const stripe = P.stripe === true;
  const pm = mat(M.piping || kind, C.piping || tone(C.fabric, 0.8));
  const n = clamp(Math.round(num(P.count, 3)), 1, 6);
  const rnd = K.rng(`towel|${n}|${Math.round(w * 100)}|${Math.round(h * 100)}`);
  if (P.fold === 'roll') {
    // rolls side by side (a pyramid from four)
    const rows = n >= 4 ? [n - Math.floor(n / 2), Math.floor(n / 2)] : [n];
    const r = Math.min(h / (rows.length > 1 ? 1.85 : 1) / 2, w / rows[0] / 2);
    rows.forEach((cnt, ri) => {
      for (let k = 0; k < cnt; k++) {
        const x = (k - (cnt - 1) / 2) * 2 * r;
        const y = r + ri * r * 1.7;
        const geo = K.cylinder(r * 0.98, r * 0.98, d, { seg: 16, center: true });
        geo.rotateX(Math.PI / 2);
        add(g, geo, fm, 'fabric', x, y, 0);
        // the spiral end: a darker ring on the front face
        add(g, K.torus(r * 0.55, 0.003, { radial: 4, tubular: 16 }), mat(kind, tone(C.fabric, 0.85)), 'fabric', x, y, d / 2 + 0.001);
        if (stripe) {
          const sg = K.cylinder(r + 0.001, r + 0.001, 0.025, { seg: 16, center: true });
          sg.rotateX(Math.PI / 2);
          add(g, sg, pm, 'piping', x, y, d / 2 - 0.05);
        }
      }
    });
  } else {
    const t = h / n;
    for (let k = 0; k < n; k++) {
      const jx = (rnd() - 0.5) * 0.012, jz = (rnd() - 0.5) * 0.012, rot = (rnd() - 0.5) * 3 * DEG;
      const y = k * t + t / 2;
      // the folded edge toward the front is fuller than the open edges
      add(g, K.cushion(w - 0.01, t * 0.98, d - 0.01, { axis: 'y', puff: 0.15, round: 1, sides: 0.35, seg: 10 }), fm, 'fabric', jx, y, jz, [0, rot, 0]);
      if (stripe) add(g, K.box(0.03, t * 0.92, d - 0.008), pm, 'piping', jx + w / 2 - 0.07, y, jz, [0, rot, 0]);
      if (P.texture === 'ribbed' || P.texture === 'waffle') {
        const rm = mat(kind, tone(C.fabric, 0.9));
        for (let r = 1; r < 6; r++) add(g, K.box(w - 0.03, 0.002, 0.002), rm, 'fabric', jx, y, jz + d / 2 - 0.005 - r * 0.0, [0, rot, 0]).position.y = k * t + (r * t) / 6;
      }
    }
  }
  g.name = 'towel';
  return K.finishModel(g, { surfaces: [{ y: +h.toFixed(4), w: +(w * 0.8).toFixed(3), d: +(d * 0.8).toFixed(3), center: [0, 0] }] });
}

// ---------------------------------------------------------------------------------------------------------------
// Towel ladder / stand

function buildTowelLadder(spec) {
  const { w, d, h } = spec.dims;
  const P = spec.params;
  const g = new THREE.Group();
  const body = partMat(spec, 'body', 'oak', 'y');
  const towelM = partMat(spec, 'fabric', 'cotton');
  const stand = ['lean', 'base', 'feet'].includes(P.stand) ? P.stand : 'lean';
  const metal = kindGroup(spec.materials?.body || 'oak') === 'metal';
  const railR = metal ? 0.011 : 0.016;
  const n = clamp(Math.round(num(P.rungs, 5)), 2, 8);
  const towels = clamp(Math.round(num(P.towels, 1)), 0, 3);
  const rungR = metal ? 0.008 : 0.012;
  let zAt = () => 0;
  let y0 = 0.08;
  const sq = !metal;
  if (stand === 'lean') {
    const zB = d / 2 - railR, zT = -d / 2 + railR;
    zAt = (y) => zB + (zT - zB) * (y / h);
    for (const sx of [-1, 1]) stick(g, body, 'body', [sx * (w / 2 - railR), 0, zB], [sx * (w / 2 - railR), h, zT], railR, railR * 0.9, { square: sq, n: 10 });
    y0 = 0.25;
  } else {
    for (const sx of [-1, 1]) stick(g, body, 'body', [sx * (w / 2 - railR), stand === 'base' ? 0.02 : 0.03, 0], [sx * (w / 2 - railR), h, 0], railR, railR, { square: sq, n: 10 });
    if (stand === 'base') add(g, K.roundedBox(w, 0.02, d, 0.006, 1, { grain: 'x', bottom: true }), body, 'body', 0, 0, 0);
    else for (const sx of [-1, 1]) add(g, K.roundedBox(0.035, 0.03, d, 0.005, 1, { grain: 'z', bottom: true }), body, 'body', sx * (w / 2 - railR), 0, 0);
    y0 = 0.3;
  }
  const ys = [];
  for (let k = 0; k < n; k++) ys.push(y0 + (k * (h - 0.06 - y0)) / Math.max(1, n - 1));
  for (const y of ys) {
    const geo = K.cylinder(rungR, rungR, w - 2 * railR, { seg: 10, center: true });
    geo.rotateZ(Math.PI / 2);
    add(g, geo, body, 'body', 0, y, zAt(y));
  }
  // towels over the upper rungs, the lowest one longest
  for (let k = 0; k < towels; k++) {
    const y = ys[ys.length - 1 - k * 2] ?? ys[0];
    drapedTowel(g, towelM, 'fabric', { x: 0, y, z: zAt(y), tw: w - 2 * railR - 0.04, drop: Math.min(0.42, y - 0.05), r: rungR, front: 0.9 - k * 0.15, back: 0.7 });
  }
  g.name = 'towel-ladder';
  return K.finishModel(g, { recolor: recolorer(g, (part, kind) => !!kind && part === 'body') });
}

// ---------------------------------------------------------------------------------------------------------------
// Towel rail / ring / hooks (wall)

function buildTowelRail(spec) {
  const { w, d, h } = spec.dims;
  const P = spec.params;
  const g = new THREE.Group();
  const body = partMat(spec, 'body', 'chrome', 'x');
  const towelM = partMat(spec, 'fabric', 'cotton');
  const style = ['bar', 'ring', 'hooks'].includes(P.style) ? P.style : 'bar';
  const towels = clamp(Math.round(num(P.towels, 1)), 0, 3);
  const r = 0.009;
  if (style === 'bar') {
    const bars = clamp(Math.round(num(P.bars, 1)), 1, 3);
    const zBar = Math.max(0.05, d - 0.015);
    for (const sx of [-1, 1]) {
      add(g, K.cylinder(0.022, 0.022, 0.012, { seg: 14, center: true }), body, 'body', sx * (w / 2 - 0.03), 0, 0.006, [Math.PI / 2, 0, 0]);
      add(g, K.cylinder(0.007, 0.007, zBar, { seg: 8, center: true }), body, 'body', sx * (w / 2 - 0.03), 0, zBar / 2, [Math.PI / 2, 0, 0]);
    }
    for (let b = 0; b < bars; b++) {
      const zb = zBar - b * 0.06, yb = -b * 0.0;
      const geo = K.cylinder(r, r, w - 0.03, { seg: 12, center: true });
      geo.rotateZ(Math.PI / 2);
      add(g, geo, body, 'body', 0, yb, zb);
      if (b < towels) drapedTowel(g, towelM, 'fabric', { x: 0, y: yb, z: zb, tw: Math.min(0.5, w - 0.12), drop: 0.36 - b * 0.06, r, front: 1, back: 0.85 });
    }
  } else if (style === 'ring') {
    const R = Math.min(w, h) / 2 - 0.01;
    add(g, K.cylinder(0.02, 0.02, 0.012, { seg: 14, center: true }), body, 'body', 0, h / 2 - 0.02, 0.006, [Math.PI / 2, 0, 0]);
    add(g, K.cylinder(0.007, 0.007, d * 0.6, { seg: 8, center: true }), body, 'body', 0, h / 2 - 0.02, d * 0.3, [Math.PI / 2, 0, 0]);
    add(g, K.torus(R, 0.007, { radial: 8, tubular: 32 }), body, 'body', 0, h / 2 - 0.02 - R, d * 0.6);
    if (towels) drapedTowel(g, towelM, 'fabric', { x: 0, y: h / 2 - 0.02 - 2 * R + 0.01, z: d * 0.6, tw: R * 1.4, drop: 0.3, r: 0.007 });
  } else {
    const nH = clamp(Math.round(num(P.hooks, 2)), 1, 5);
    for (let k = 0; k < nH; k++) {
      const x = (k - (nH - 1) / 2) * Math.min(0.2, (w - 0.06) / Math.max(1, nH - 1));
      add(g, K.cylinder(0.018, 0.018, 0.01, { seg: 12, center: true }), body, 'body', x, 0, 0.005, [Math.PI / 2, 0, 0]);
      g.add(K.partMesh(K.tube([[x, 0, 0.01], [x, -0.005, d * 0.6], [x, 0.02, d * 0.9], [x, 0.035, d * 0.85]], 0.006, { radial: 6 }), body, 'body'));
      if (k < towels) drapedTowel(g, towelM, 'fabric', { x, y: -0.002, z: d * 0.6, tw: 0.22, drop: 0.45, r: 0.006, front: 1, back: 0.9 });
    }
  }
  g.name = 'towel-rail';
  return K.finishModel(g, { recolor: recolorer(g, (part, kind) => !!kind && part === 'body') });
}

// ---------------------------------------------------------------------------------------------------------------
// Bath accessories

function ribbedLathe(profile, ribs, depth, n) {
  const geo = K.lathe(profile, { seg: n });
  if (!ribs) return geo;
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const rr = Math.hypot(x, z);
    if (rr < 0.004) continue;
    const a = Math.atan2(z, x);
    const f = 1 - depth * (0.5 - 0.5 * Math.cos(a * ribs));
    pos.setX(i, x * f);
    pos.setZ(i, z * f);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

function buildBathAccessory(spec) {
  const { w, d, h } = spec.dims;
  const P = spec.params;
  const g = new THREE.Group();
  const body = partMat(spec, 'body', 'ceramic');
  const accent = partMat(spec, 'accent', 'chrome');
  const kind = ['dispenser', 'tumbler', 'toothbrush', 'soap-dish', 'tray', 'set'].includes(P.kind) ? P.kind : 'dispenser';
  const ribs = P.ribbed === true ? 24 : 0;
  const n = seg(spec, 28);
  const dispenser = (x, z, bh, br) => {
    if (P.squareBody === true) add(g, K.roundedBox(br * 1.8, bh, br * 1.8, Math.min(0.006, br * 0.2), 2, { bottom: true }), body, 'body', x, 0, z);
    else add(g, ribbedLathe([[0.001, 0], [br * 0.92, 0], [br, 0.006], [br, bh * 0.82], [br * 0.82, bh * 0.94], [br * 0.42, bh], [0.001, bh]], ribs, 0.06, n), body, 'body', x, 0, z);
    // pump: collar, stem, head with spout toward +z
    add(g, K.cylinder(br * 0.42, br * 0.45, 0.012, { seg: 16 }), accent, 'accent', x, bh, z);
    add(g, K.cylinder(0.005, 0.005, 0.03, { seg: 8 }), accent, 'accent', x, bh + 0.012, z);
    add(g, K.roundedBox(0.022, 0.016, 0.05, 0.006, 2), accent, 'accent', x, bh + 0.048, z + 0.012);
  };
  const tumbler = (x, z, th, tr, brushes = 0) => {
    add(g, ribbedLathe([[0.001, 0], [tr * 0.9, 0], [tr * 0.95, 0.004], [tr, th], [tr - 0.004, th], [tr * 0.9, 0.008], [0.001, 0.008]], ribs, 0.05, n), body, 'body', x, 0, z);
    const cols = ['#f2f2ee', '#9fb1a5'];
    for (let k = 0; k < brushes; k++) {
      const bm = mat('plastic', cols[k % 2]);
      stick(g, bm, null, [x + (k ? 0.006 : -0.006), 0.01, z], [x + (k ? 0.018 : -0.016), th + 0.09, z + (k ? -0.01 : 0.008)], 0.004, 0.004, { n: 6 });
    }
  };
  const dish = (x, z, dw, dd) => {
    add(g, K.roundedBox(dw, 0.018, dd, 0.008, 2, { bottom: true }), body, 'body', x, 0, z);
    add(g, K.roundedBox(dw * 0.62, 0.022, dd * 0.6, 0.01, 2, { bottom: true }), mat('ceramic', '#efe9de'), null, x, 0.016, z);
  };
  if (kind === 'dispenser') dispenser(0, 0, h - 0.06, Math.min(w, d) / 2);
  else if (kind === 'tumbler') tumbler(0, 0, h, Math.min(w, d) / 2, 0);
  else if (kind === 'toothbrush') tumbler(0, 0, Math.min(h, 0.12), Math.min(w, d) / 2, 2);
  else if (kind === 'soap-dish') dish(0, 0, w, d);
  else if (kind === 'tray') add(g, K.roundedBox(w, Math.max(0.015, h), d, Math.min(0.01, h / 2), 2, { bottom: true }), body, 'body', 0, 0, 0);
  else {
    // the set on a tray: pump left, tumbler right, soap dish in front
    add(g, K.roundedBox(w, 0.015, d, 0.006, 2, { bottom: true }), accent, 'accent', 0, 0, 0);
    const g2 = new THREE.Group();
    g2.position.y = 0.015;
    g.add(g2);
    const keep = g;
    // build onto the tray level
    const tmp = new THREE.Group();
    tmp.position.y = 0.015;
    keep.add(tmp);
    const br = Math.min(0.035, d * 0.3);
    const savedAdd = add;
    void savedAdd;
    const bh = Math.max(0.1, h - 0.075);
    tmp.add(K.partMesh(ribbedLathe([[0.001, 0], [br * 0.92, 0], [br, 0.006], [br, bh * 0.82], [br * 0.82, bh * 0.94], [br * 0.42, bh], [0.001, bh]], ribs, 0.06, n), body, 'body', { position: [-w * 0.28, 0, -d * 0.12] }));
    tmp.add(K.partMesh(K.cylinder(br * 0.42, br * 0.45, 0.012, { seg: 16 }), accent, 'accent', { position: [-w * 0.28, bh, -d * 0.12] }));
    tmp.add(K.partMesh(K.cylinder(0.005, 0.005, 0.03, { seg: 8 }), accent, 'accent', { position: [-w * 0.28, bh + 0.012, -d * 0.12] }));
    tmp.add(K.partMesh(K.roundedBox(0.022, 0.016, 0.05, 0.006, 2), accent, 'accent', { position: [-w * 0.28, bh + 0.048, -d * 0.12 + 0.012] }));
    const tr = Math.min(0.035, d * 0.3), th = Math.min(0.11, h * 0.6);
    tmp.add(K.partMesh(ribbedLathe([[0.001, 0], [tr * 0.9, 0], [tr * 0.95, 0.004], [tr, th], [tr - 0.004, th], [tr * 0.9, 0.008], [0.001, 0.008]], ribs, 0.05, n), body, 'body', { position: [w * 0.26, 0, -d * 0.12] }));
    tmp.add(K.partMesh(K.roundedBox(w * 0.32, 0.016, d * 0.32, 0.006, 2, { bottom: true }), body, 'body', { position: [0, 0, d * 0.28] }));
  }
  g.name = 'bath-accessory';
  return K.finishModel(g, { recolor: recolorer(g) });
}

// ---------------------------------------------------------------------------------------------------------------
// Coat rack (wall) and coat stand (floor)

/** One hook/peg at (x, y, z) on a surface facing +z. */
function hook(g, m, style, x, y, z, n, size = 0.09) {
  if (style === 'disc') {
    // a round disc (Ø size) on a short stem
    stick(g, m, 'accent', [x, y, z], [x, y, z + 0.06], 0.01, 0.01, { n: 8 });
    add(g, K.cylinder(size / 2, size / 2, 0.022, { seg: Math.max(16, n * 2), center: true }), m, 'accent', x, y, z + 0.07, [Math.PI / 2, 0, 0]);
    return;
  }
  if (style === 'peg') stick(g, m, 'accent', [x, y, z], [x, y + 0.02, z + 0.075], 0.013, 0.011, { n });
  else if (style === 'knob') {
    stick(g, m, 'accent', [x, y, z], [x, y, z + 0.04], 0.008, 0.008, { n: 8 });
    add(g, K.sphere(0.02, { wSeg: 12, hSeg: 8 }), m, 'accent', x, y, z + 0.05);
  } else if (style === 'double') {
    g.add(K.partMesh(K.tube([[x, y + 0.03, z], [x, y + 0.03, z + 0.05], [x, y + 0.05, z + 0.07]], 0.005, { radial: 6 }), m, 'accent'));
    g.add(K.partMesh(K.tube([[x, y - 0.01, z], [x, y - 0.02, z + 0.09], [x, y + 0.01, z + 0.11]], 0.005, { radial: 6 }), m, 'accent'));
    add(g, K.roundedBox(0.02, 0.07, 0.006, 0.002, 1), m, 'accent', x, y + 0.01, z + 0.003);
  } else {
    g.add(K.partMesh(K.tube([[x, y + 0.02, z], [x, y + 0.01, z + 0.05], [x, -0.005 + y, z + 0.07], [x, y + 0.02, z + 0.085]], 0.005, { radial: 6 }), m, 'accent'));
    add(g, K.roundedBox(0.018, 0.05, 0.006, 0.002, 1), m, 'accent', x, y + 0.015, z + 0.003);
  }
}

function buildCoatRack(spec) {
  const { w, d, h } = spec.dims;
  const P = spec.params;
  const g = new THREE.Group();
  const body = partMat(spec, 'body', 'oak', 'x');
  const acc = partMat(spec, 'accent', 'black-metal', 'y');
  const coatM = partMat(spec, 'fabric', 'wool');
  const style = ['rail', 'pegs', 'shelf'].includes(P.style) ? P.style : 'rail';
  const hookStyle = ['peg', 'hook', 'double', 'knob', 'disc'].includes(P.hookStyle) ? P.hookStyle : style === 'pegs' ? 'peg' : 'hook';
  const sizes = Array.isArray(P.sizes) ? P.sizes.filter((v) => typeof v === 'number' && v > 0.02 && v < 0.3) : [];
  const nH = clamp(Math.round(num(P.hooks, Math.max(2, Math.round(w / 0.15)))), 1, 12);
  const coats = clamp(Math.round(num(P.coats, 0)), 0, 3);
  const n = seg(spec, 10);
  const xs = [];
  for (let k = 0; k < nH; k++) xs.push(nH === 1 ? 0 : -w / 2 + 0.06 + (k * (w - 0.12)) / (nH - 1));
  let hookY = 0, hookZ = 0;
  const surfaces = [];
  if (style === 'rail') {
    const bt = 0.02;
    add(g, K.roundedBox(w, h, bt, 0.003, 1, { grain: 'x' }), body, 'body', 0, 0, bt / 2);
    hookZ = bt;
  } else if (style === 'pegs') {
    if (hookStyle !== 'disc') for (const x of xs) add(g, K.cylinder(0.025, 0.025, 0.012, { seg: n, center: true }), acc, 'accent', x, 0, 0.006, [Math.PI / 2, 0, 0]);
    hookZ = 0.012;
  } else {
    // hat shelf: a board on two brackets, the hooks on a rail under it
    const st = 0.022;
    add(g, K.roundedBox(w, st, d, 0.003, 1, { grain: 'x' }), body, 'body', 0, h / 2 - st / 2, d / 2);
    for (const x of [-w / 2 + 0.08, w / 2 - 0.08]) {
      const sh = [[0, 0], [0.012, 0], [0.012, h - st], [Math.min(d, 0.2), h - st], [Math.min(d, 0.2), h - st - 0.012], [0.012, 0.03]];
      const geo = K.extrudeShape(sh.map(([zz, yy]) => [zz, yy]), 0.012, { center: true });
      geo.rotateY(-Math.PI / 2);
      add(g, geo, acc, 'accent', x, -h / 2, 0);
    }
    add(g, K.roundedBox(w - 0.04, 0.06, 0.018, 0.003, 1, { grain: 'x' }), body, 'body', 0, -h / 2 + 0.03, 0.009);
    hookY = -h / 2 + 0.03;
    hookZ = 0.018;
    surfaces.push({ y: +(h / 2).toFixed(4), w: +(w - 0.04).toFixed(3), d: +(d - 0.03).toFixed(3), center: [0, +(d / 2).toFixed(4)] });
  }
  xs.forEach((x, k) => hook(g, acc, hookStyle, x, hookY, hookZ, n, sizes.length ? sizes[k % sizes.length] : 0.09));
  // coats on every other hook from the left
  for (let k = 0; k < coats && k * 2 < xs.length; k++) coat(g, coatM, { x: xs[k * 2], y: hookY + 0.01, z: hookZ + 0.03, seed: k, cw: 0.4, ch: 0.8 });
  g.name = 'coat-rack';
  return K.finishModel(g, { surfaces, recolor: recolorer(g, (part, kind) => !!kind && part !== 'fabric') });
}

function buildCoatStand(spec) {
  const { w, d, h } = spec.dims;
  const P = spec.params;
  const g = new THREE.Group();
  const body = partMat(spec, 'body', 'oak', 'y');
  const acc = partMat(spec, 'accent', spec.materials?.body || 'oak', 'y');
  const coatM = partMat(spec, 'fabric', 'wool');
  const style = ['tree', 'tripod', 'rail'].includes(P.style) ? P.style : 'tree';
  const coats = clamp(Math.round(num(P.coats, 1)), 0, 3);
  const n = seg(spec, 12);
  const metal = kindGroup(spec.materials?.body || 'oak') === 'metal';
  if (style === 'rail') {
    // clothes rail: two uprights on floor feet, a hanging bar on top, an optional low shelf, hangers with coats
    const r = metal ? 0.012 : 0.017;
    for (const sx of [-1, 1]) {
      const x = sx * (w / 2 - r);
      stick(g, body, 'body', [x, 0.02, 0], [x, h - r, 0], r, r, { square: !metal, n });
      add(g, K.roundedBox(metal ? 0.025 : 0.035, 0.025, d, 0.005, 1, { grain: 'z', bottom: true }), body, 'body', x, 0, 0);
    }
    const bar = K.cylinder(r, r, w, { seg: n, center: true });
    bar.rotateZ(Math.PI / 2);
    add(g, bar, body, 'body', 0, h - r, 0);
    if (P.shelf !== false) add(g, K.roundedBox(w - 2 * r, 0.02, d - 0.04, 0.004, 1, { grain: 'x' }), body, 'body', 0, 0.2, 0);
    const nC = Math.max(coats, 0);
    for (let k = 0; k < nC; k++) {
      const x = (k - (nC - 1) / 2) * Math.min(0.2, (w - 0.2) / Math.max(1, nC));
      g.add(K.partMesh(K.tube([[x - 0.2, h - 0.12, 0], [x, h - 0.06, 0], [x + 0.2, h - 0.12, 0]], 0.004, { radial: 5 }), acc, 'accent'));
      coat(g, coatM, { x, y: h - 0.06, z: -0.055, seed: k, cw: 0.44, ch: Math.min(0.95, h - 0.4), ct: 0.1 });
    }
    g.name = 'coat-stand';
    return K.finishModel(g, { recolor: recolorer(g, (part, kind) => !!kind && part !== 'fabric') });
  }
  const top = h - 0.06;
  if (style === 'tripod') {
    // three legs leaning together, crossing a little below the top
    const R = Math.min(w, d) / 2 - 0.02;
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2 + Math.PI / 2;
      const foot = [Math.cos(a) * R, 0, Math.sin(a) * R];
      const tip = [-Math.cos(a) * 0.06, h, -Math.sin(a) * 0.06];
      stick(g, body, 'body', foot, tip, 0.016, 0.012, { n });
    }
  } else {
    // pole with a base
    const r = metal ? 0.012 : 0.018;
    add(g, K.cylinder(r * 0.9, r, h - 0.02, { seg: n }), body, 'body', 0, 0.02, 0);
    const base = ['round', 'cross', 'tripod'].includes(P.base) ? P.base : 'round';
    const R = Math.min(w, d) / 2 - 0.01;
    if (base === 'round') add(g, K.cylinder(R, R, 0.02, { seg: seg(spec, 32) }), body, 'body', 0, 0, 0);
    else {
      const nl = base === 'cross' ? 4 : 3;
      for (let k = 0; k < nl; k++) {
        const a = (k / nl) * Math.PI * 2;
        stick(g, body, 'body', [0, 0.12, 0], [Math.cos(a) * R, 0.005, Math.sin(a) * R], r * 0.9, r * 0.75, { n: 8, square: !metal });
      }
    }
  }
  // pegs: a cluster round the top, or spread over `levels` down to ≈ 0,9 m (V pairs / alternating sides)
  const nH = clamp(Math.round(num(P.hooks, 6)), 2, 16);
  const levels = clamp(Math.round(num(P.levels, 1)), 1, 8);
  const flat = P.pegStyle === 'flat';
  const lowY = Math.min(top - 0.1, 0.9);
  for (let k = 0; k < nH; k++) {
    let a, lvl;
    if (levels === 1) {
      a = (k / nH) * Math.PI * 2 + 0.3;
      lvl = k % 2 ? top - 0.12 : top;
    } else {
      const li = k % levels;
      lvl = top - (li * (top - lowY)) / (levels - 1);
      // V pairs: two pegs per level pointing opposite ways; single pegs alternate sides level by level
      const per = Math.ceil(nH / levels);
      a = (per === 1 ? (li % 2 ? Math.PI : 0) : Math.floor(k / levels) % 2 ? Math.PI : 0) + 0.2;
    }
    const len = flat ? 0.1 : 0.12;
    const p0 = [Math.cos(a) * 0.02, lvl - (flat ? 0 : 0.04), Math.sin(a) * 0.02];
    const p1 = [Math.cos(a) * len, lvl + (flat ? 0 : 0.03), Math.sin(a) * len];
    stick(g, acc, 'accent', p0, p1, flat ? 0.006 : 0.008, flat ? 0.006 : 0.007, { n: 8 });
    if (flat) {
      const disc = add(g, K.cylinder(0.018, 0.018, 0.006, { seg: 14, center: true }), acc, 'accent', ...p1);
      disc.rotation.set(0, -a, Math.PI / 2);
    } else add(g, K.sphere(0.014, { wSeg: 10, hSeg: 8 }), acc, 'accent', ...p1);
  }
  for (let k = 0; k < coats; k++) {
    const a = (k / Math.max(1, coats)) * Math.PI * 2 + 0.3 + (k ? Math.PI / nH : 0);
    const x = Math.cos(a) * 0.12, z = Math.sin(a) * 0.12;
    const cg = new THREE.Group();
    cg.position.set(x, 0, z);
    cg.rotation.y = -a + Math.PI / 2;
    g.add(cg);
    coat(cg, coatM, { x: 0, y: top + 0.02, z: 0, seed: k, cw: 0.42, ch: Math.min(0.9, top - 0.5) });
  }
  g.name = 'coat-stand';
  return K.finishModel(g, { recolor: recolorer(g, (part, kind) => !!kind && part !== 'fabric') });
}

// ---------------------------------------------------------------------------------------------------------------
// Archetypes

/** @type {Record<string, object>} */
export const archetypes = {
  'mirror-floor': def('mirror-floor', {
    defaults: {
      dims: { w: 0.6, d: 0.03, h: 1.7 },
      params: { shape: 'rect', stand: 'lean', tilt: 7, frameW: 0.03, frameDepth: 0.03 },
      colors: { print: '#c9cfd0', frame: '#1b1b1b' },
      materials: { print: 'mirror', frame: 'black-metal' },
    },
    params: {
      shape: { type: 'enum', label: 'Form', options: [['rect', 'Rektangulær'], ['arch', 'Buet topp'], ['round', 'Oval'], ['organic', 'Organisk']] },
      stand: { type: 'enum', label: 'Står', options: [['lean', 'Lent mot veggen'], ['feet', 'På føtter'], ['easel', 'Med støtteben'], ['cheval', 'I svingramme']] },
      tilt: { type: 'number', min: 0, max: 15, step: 1, label: 'Helning (grader)' },
      frameW: { type: 'number', min: 0, max: 0.1, step: 0.002, label: 'Rammebredde (m)' },
      mullions: { type: 'bool', label: 'Sprosser', default: false },
      mullionCols: { type: 'number', label: 'Sprosser – kolonner', min: 1, max: 6, step: 1, default: 2 },
      mullionRows: { type: 'number', label: 'Sprosser – rader', min: 1, max: 8, step: 1, default: 3 },
    },
    dimsRange: { w: [0.3, 1.4], d: [0.01, 0.08], h: [1.0, 2.2] },
    build: buildMirrorFloor,
  }),
  towel: def('towel', {
    defaults: {
      dims: { w: 0.35, d: 0.25, h: 0.12 },
      params: { count: 3, size: 'bath', fold: 'stack', texture: 'terry', stripe: false },
      colors: { fabric: '#ece7df', piping: '#cfc6b8' },
      materials: { fabric: 'cotton', piping: 'cotton' },
    },
    params: {
      count: { type: 'number', min: 1, max: 6, step: 1, label: 'Antall i bunken' },
      fold: { type: 'enum', label: 'Brettet', options: [['stack', 'Bunke'], ['roll', 'Rullet']] },
      stripe: { type: 'bool', label: 'Stripe/bord' },
    },
    dimsRange: { w: [0.15, 0.6], d: [0.1, 0.5], h: [0.02, 0.4] },
    build: buildTowel,
  }),
  'towel-ladder': def('towel-ladder', {
    defaults: {
      dims: { w: 0.5, d: 0.35, h: 1.6 },
      params: { rungs: 5, stand: 'lean', towels: 2 },
      colors: { body: '#c9a77f', fabric: '#ece7df' },
      materials: { body: 'oak', fabric: 'cotton' },
    },
    params: {
      rungs: { type: 'number', min: 2, max: 8, step: 1, label: 'Trinn' },
      stand: { type: 'enum', label: 'Står', options: [['lean', 'Lent mot veggen'], ['base', 'På fotplate'], ['feet', 'På føtter']] },
      towels: { type: 'number', min: 0, max: 3, step: 1, label: 'Håndklær på' },
    },
    // d from 0.03: a ladder's dims.d is its rail depth (Bambus stige 50x160 is 0.04), not the leaning footprint
    dimsRange: { w: [0.3, 0.8], d: [0.03, 0.5], h: [0.8, 2.0] },
    build: buildTowelLadder,
  }),
  'towel-rail': def('towel-rail', {
    defaults: {
      dims: { w: 0.6, d: 0.08, h: 0.05 },
      params: { style: 'bar', bars: 1, towels: 1, mountHeight: 1.0 },
      colors: { body: '#c8c8c8', fabric: '#ece7df' },
      materials: { body: 'chrome', fabric: 'cotton' },
    },
    params: {
      style: { type: 'enum', label: 'Type', options: [['bar', 'Stang'], ['ring', 'Ring'], ['hooks', 'Kroker']] },
      bars: { type: 'number', min: 1, max: 3, step: 1, label: 'Stenger' },
      hooks: { type: 'number', min: 1, max: 5, step: 1, label: 'Kroker' },
      towels: { type: 'number', min: 0, max: 3, step: 1, label: 'Håndklær på' },
      mountHeight: { type: 'number', min: 0.5, max: 1.8, step: 0.01, label: 'Høyde over gulv (m)' },
    },
    dimsRange: { w: [0.1, 1.2], d: [0.03, 0.2], h: [0.02, 0.3] },
    build: buildTowelRail,
  }),
  'bath-accessory': def('bath-accessory', {
    defaults: {
      dims: { w: 0.08, d: 0.08, h: 0.19 },
      params: { kind: 'dispenser', ribbed: false },
      colors: { body: '#e9e5dd', accent: '#c8c8c8' },
      materials: { body: 'ceramic', accent: 'chrome' },
    },
    params: {
      kind: { type: 'enum', label: 'Type', options: [['dispenser', 'Såpepumpe'], ['tumbler', 'Tannglass'], ['toothbrush', 'Tannbørsteholder'], ['soap-dish', 'Såpeskål'], ['tray', 'Brett'], ['set', 'Sett på brett']] },
      ribbed: { type: 'bool', label: 'Riflet' },
      squareBody: { type: 'bool', label: 'Firkantet' },
    },
    dimsRange: { w: [0.04, 0.5], d: [0.04, 0.3], h: [0.01, 0.3] },
    build: buildBathAccessory,
  }),
  'coat-rack': def('coat-rack', {
    defaults: {
      dims: { w: 0.8, d: 0.08, h: 0.1 },
      params: { style: 'rail', hooks: 5, hookStyle: 'peg', coats: 0, mountHeight: 1.65 },
      colors: { body: '#c9a77f', accent: '#c9a77f', fabric: '#b89a78' },
      materials: { body: 'oak', accent: 'oak', fabric: 'wool' },
    },
    params: {
      style: { type: 'enum', label: 'Type', options: [['rail', 'List med knagger'], ['pegs', 'Enkeltknagger'], ['shelf', 'Hattehylle']] },
      hooks: { type: 'number', min: 1, max: 12, step: 1, label: 'Knagger' },
      hookStyle: { type: 'enum', label: 'Knaggene', options: [['peg', 'Treplugg'], ['hook', 'Krok'], ['double', 'Dobbel krok'], ['knob', 'Knott'], ['disc', 'Rund skive']] },
      coats: { type: 'number', min: 0, max: 3, step: 1, label: 'Klær på' },
      mountHeight: { type: 'number', min: 1.0, max: 2.0, step: 0.01, label: 'Høyde over gulv (m)' },
    },
    dimsRange: { w: [0.1, 2.0], d: [0.02, 0.4], h: [0.03, 0.4] },
    build: buildCoatRack,
  }),
  'coat-stand': def('coat-stand', {
    defaults: {
      dims: { w: 0.45, d: 0.45, h: 1.75 },
      params: { style: 'tree', hooks: 6, base: 'round', coats: 1 },
      colors: { body: '#1c1c1c', accent: '#1c1c1c', fabric: '#b89a78' },
      materials: { body: 'black-metal', accent: 'black-metal', fabric: 'wool' },
    },
    params: {
      style: { type: 'enum', label: 'Type', options: [['tree', 'Stolpe med knagger'], ['tripod', 'Tre ben'], ['rail', 'Klesstativ']] },
      hooks: { type: 'number', min: 2, max: 16, step: 1, label: 'Knagger' },
      levels: { type: 'number', min: 1, max: 8, step: 1, label: 'Knagger i nivåer' },
      pegStyle: { type: 'enum', label: 'Knaggene', options: [['angled', 'Skrå med kule'], ['flat', 'Rette med skive']], default: 'angled' },
      base: { type: 'enum', label: 'Fot', options: [['round', 'Rund plate'], ['cross', 'Kryss'], ['tripod', 'Tre ben']] },
      shelf: { type: 'bool', label: 'Hylle nederst', default: true },
      coats: { type: 'number', min: 0, max: 3, step: 1, label: 'Klær på' },
    },
    dimsRange: { w: [0.3, 1.6], d: [0.3, 0.6], h: [1.2, 2.0] },
    build: buildCoatStand,
  }),
};
