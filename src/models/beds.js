import * as THREE from 'three';
import schema from '../data/archetypes.json';
import * as K from './kit.js';
import { mat, kindGroup } from '../home/materials.js';
import { recolorer } from './tables.js';

/**
 * Beds, headboards and benches (ARCHITECTURE §5; bed family parts: frame, headboard, legs, bedding, throw – the bench
 * uses the seating parts upholstery, legs, frame):
 *
 *   bed        continental (fabric base on legs + top mattress), frame (side rails round a mattress, fabric or wood),
 *              storage (base with drawers), platform (low wide platform), adjustable – with an optional headboard
 *              (panel, channels, buttons, rounded, wings, wood, slats, loose cushions, cane), a foot end, and the bed
 *              made up (duvet with a turned-down fold, pillows, an optional runner/throw)
 *   headboard  sengegavl: the same headboard styles as a free-standing panel on feet
 *   bench      sengebenk / gangbenk / spisebenk: upholstered, wood, cushion or cord seat, legs/frames/end panels, an
 *              optional shoe shelf or baskets, or a lift-lid storage box
 *
 * Origin: floor, footprint centre; the foot end / front toward +z (the headboard at −z). Everything is measured from
 * spec.dims and the params (legs keep their section, cushions their radius, channels their pitch).
 */

const num = (v, fb) => (typeof v === 'number' && Number.isFinite(v) ? v : fb);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const QF = { low: 0.6, medium: 1, high: 1.5 };
const qf = (spec) => QF[spec.quality] ?? 1;
const seg = (spec, n) => Math.max(4, Math.round(n * qf(spec)));
const DEG = Math.PI / 180;
const WHITE = new THREE.Color(1, 1, 1);

/** Darker (f < 1) or lighter (f > 1) version of a colour. */
function tone(hex, f) {
  const c = new THREE.Color(hex || '#808080');
  if (f <= 1) c.multiplyScalar(f);
  else c.lerp(WHITE, Math.min(1, f - 1));
  return `#${c.getHexString()}`;
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

function add(g, geo, material, part, x = 0, y = 0, z = 0, rot) {
  const m = K.partMesh(geo, material, part, { position: [x, y, z], rotation: rot });
  g.add(m);
  return m;
}

/** A soft slab: K.cushion with the thin axis along y (seat cushions, toppers, duvets). */
const softY = (w, h, d, o = {}) => K.cushion(w, h, d, { axis: 'y', puff: 0.12, round: 0.7, sides: 0.15, bottom: 0.2, seg: 12, ...o });
/** A soft panel facing +z (headboards, hanging duvet sides use axis x). */
const softZ = (w, h, d, o = {}) => K.cushion(w, h, d, { axis: 'z', puff: 0.08, round: 0.7, sides: 0.08, bottom: 0, seg: 12, ...o });

// ---------------------------------------------------------------------------------------------------------------
// Legs

const LEG_STYLES = ['block', 'round', 'taper', 'metal', 'plinth', 'skirt'];

/** Legs under a base whose underside is at y = legH, footprint half-size (hx, hz) centred at z = zc. */
function bedLegs(g, spec, legsMat, style, { hx, hz, zc = 0, legH, wide = false, long = false, frameMat }) {
  if (legH < 0.004) return;
  const inset = style === 'metal' ? 0.07 : 0.06;
  if (style === 'plinth') {
    add(g, K.box(2 * (hx - 0.06), legH, 2 * (hz - 0.06), { grain: 'x' }), legsMat, 'legs', 0, legH / 2, zc);
    return;
  }
  if (style === 'skirt') {
    // a fabric skirt (the frame fabric) from the base to just above the floor, with a few soft pleats
    const t = 0.012, hs = legH - 0.008;
    const skirtMat = frameMat;
    for (const sz of [-1, 1]) add(g, softZ(2 * hx + 0.006, hs, t, { puff: 0.4, seg: 18 }), skirtMat, 'frame', 0, 0.008 + hs / 2, zc + sz * (hz + 0.002));
    for (const sx of [-1, 1]) add(g, K.cushion(t, hs, 2 * hz + 0.006, { axis: 'x', puff: 0.4, round: 0.7, sides: 0.1, seg: 18 }), skirtMat, 'frame', sx * (hx + 0.002), 0.008 + hs / 2, zc);
    return;
  }
  const xs = wide ? [-1, 0, 1] : [-1, 1];
  const zs = long ? [-1, 0, 1] : [-1, 1];
  const n = seg(spec, 14);
  for (const sx of xs) {
    for (const sz of zs) {
      if (sx === 0 && sz === 0) continue;
      const x = sx * (hx - inset), z = zc + sz * (hz - inset);
      if (style === 'block') add(g, K.roundedBox(0.06, legH, 0.06, 0.004, 1, { grain: 'y', bottom: true }), legsMat, 'legs', x, 0, z);
      else if (style === 'round') add(g, K.cylinder(0.028, 0.028, legH, { seg: n }), legsMat, 'legs', x, 0, z);
      else if (style === 'metal') {
        add(g, K.cylinder(0.013, 0.011, legH, { seg: n }), legsMat, 'legs', x, 0, z);
        add(g, K.cylinder(0.03, 0.03, 0.004, { seg: n }), legsMat, 'legs', x, legH - 0.004, z);
      } else add(g, K.taperLeg(legH, 0.026, 0.017, { seg: n }), legsMat, 'legs', x, 0, z);
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Headboards

const HEAD_STYLES = ['panel', 'channel', 'tufted', 'rounded', 'wing', 'wood', 'slats', 'cushions', 'cane'];

/**
 * A headboard panel of width hw, thickness t from y0 to y1, its back at z = zb (front toward +z), in `hbMat` (part
 * headboard). Feet/posts from the floor to y0 in `legsMat` when y0 > 2 cm.
 */
function addHeadboard(g, spec, style, { hw, t, y0, y1, zb, hbMat, legsMat, P, posts = false }) {
  const hh = Math.max(0.05, y1 - y0);
  const cy = y0 + hh / 2;
  const zc = zb + t / 2;
  const C = spec.colors || {}, M = spec.materials || {};
  const wood = kindGroup(M.headboard || 'woven') !== 'fabric';
  const n = seg(spec, 12);
  // feet or posts down to the floor
  if (y0 > 0.02 || posts) {
    const pw = posts ? clamp(t, 0.045, 0.08) : 0.05;
    const topY = posts ? y1 : y0 + 0.04;
    for (const sx of [-1, 1]) {
      const x = posts ? sx * (hw / 2 - pw / 2) : sx * (hw / 2 - 0.12);
      if (posts) add(g, K.roundedBox(pw, topY, Math.max(t, pw), 0.004, 1, { grain: 'y', bottom: true }), legsMat, 'legs', x, 0, zc);
      else add(g, K.roundedBox(0.05, topY, Math.min(0.05, t), 0.003, 1, { grain: 'y', bottom: true }), legsMat, 'legs', x, 0, zb + Math.min(0.05, t) / 2);
    }
  }
  const innerW = posts ? hw - 2 * clamp(t, 0.045, 0.08) : hw;
  switch (style) {
    case 'channel': {
      const nC = clamp(Math.round(num(P.channels, innerW / 0.17)), 3, 30);
      const cw = (innerW - (nC - 1) * 0.003) / nC;
      add(g, K.box(innerW, hh * 0.98, t * 0.4), hbMat, 'headboard', 0, cy, zb + t * 0.2);
      for (let k = 0; k < nC; k++) {
        const x = -innerW / 2 + cw / 2 + k * (cw + 0.003);
        add(g, K.cushion(cw, hh, t * 0.75, { axis: 'z', puff: 0.22, round: 1, sides: 0.1, bottom: 0, seg: 10 }), hbMat, 'headboard', x, cy, zb + t * 0.4 + (t * 0.75) / 2 - 0.004);
      }
      break;
    }
    case 'tufted': {
      add(g, softZ(innerW, hh, t, { puff: 0.12 }), hbMat, 'headboard', 0, cy, zc);
      const rows = clamp(Math.round(num(P.buttonRows, Math.max(2, Math.round(hh / 0.2)))), 1, 8);
      const cols = Math.max(2, Math.round(innerW / 0.2));
      const bm = mat(M.headboard || 'velvet', tone(C.headboard, 0.82));
      const bGeo = K.sphere(0.009, { wSeg: 8, hSeg: 6 });
      const dGeo = K.cylinder(0.022, 0.022, 0.002, { seg: 10, center: true });
      const dimple = mat('painted', tone(C.headboard, 0.6), { flat: true, roughness: 0.95 });
      for (let r = 0; r < rows; r++) {
        const y = y0 + (hh * (r + 0.5)) / rows;
        const off = r % 2 ? 0.5 : 0; // diamond pattern: every other row shifted by half a step
        for (let c = 0; c <= cols; c++) {
          const x = -innerW / 2 + (innerW * (c + off)) / cols;
          if (Math.abs(x) > innerW / 2 - 0.05) continue;
          add(g, bGeo, bm, 'headboard', x, y, zb + t + t * 0.06);
          const dm = add(g, dGeo, dimple, null, x, y, zb + t + t * 0.06 - 0.004, [Math.PI / 2, 0, 0]);
          dm.userData.noShadow = true;
        }
      }
      break;
    }
    case 'rounded': {
      const r = Math.min(innerW / 2 - 0.01, hh * 0.45, 0.5);
      const pts = [[-innerW / 2, 0], [innerW / 2, 0], [innerW / 2, hh - r]];
      const nA = seg(spec, 10);
      for (let k = 0; k <= nA; k++) {
        const a = (k / nA) * (Math.PI / 2);
        pts.push([innerW / 2 - r + r * Math.cos(a), hh - r + r * Math.sin(a)]);
      }
      for (let k = 0; k <= nA; k++) {
        const a = Math.PI / 2 + (k / nA) * (Math.PI / 2);
        pts.push([-innerW / 2 + r + r * Math.cos(a), hh - r + r * Math.sin(a)]);
      }
      const bev = Math.min(0.025, t * 0.4);
      const geo = K.extrudeShape(pts, t, { bevel: bev, bevelSegments: 3 });
      K.worldUV(geo, 1, { grain: 'x' });
      add(g, geo, hbMat, 'headboard', 0, y0, zb);
      break;
    }
    case 'wing': {
      const wd = clamp(num(P.wings, 0.16), 0.05, 0.4);
      const wt = clamp(t * 0.9, 0.06, 0.14);
      add(g, softZ(innerW - 2 * wt + 0.02, hh * 0.97, t), hbMat, 'headboard', 0, y0 + (hh * 0.97) / 2, zc);
      for (const sx of [-1, 1]) add(g, K.cushion(wt, hh, t + wd, { axis: 'x', puff: 0.1, round: 0.8, sides: 0.1, seg: 12 }), hbMat, 'headboard', sx * (innerW / 2 - wt / 2), cy, zb + (t + wd) / 2);
      break;
    }
    case 'wood': {
      add(g, K.box(innerW, hh, t * 0.8, { grain: 'x' }), hbMat, 'headboard', 0, cy, zb + t * 0.4);
      // a capping board on top, a little proud
      add(g, K.roundedBox(hw + 0.01, 0.025, t + 0.012, 0.004, 1, { grain: 'x' }), hbMat, 'headboard', 0, y1 - 0.0125, zc);
      break;
    }
    case 'slats': {
      // slatPitch < 6 cm: dense slats on a dark felt backing (acoustic-panel look); else a framed slatted panel
      const sp = clamp(num(P.slatPitch, 0.075), 0.03, 0.15);
      const dense = sp < 0.06;
      const ft = dense ? 0 : 0.04;
      if (dense) add(g, K.box(innerW, hh, 0.008), mat('felt', '#1d1d1d'), null, 0, cy, zb + 0.004);
      else {
        add(g, K.box(innerW, ft, t, { grain: 'x' }), hbMat, 'headboard', 0, y1 - ft / 2, zc);
        add(g, K.box(innerW, ft, t, { grain: 'x' }), hbMat, 'headboard', 0, y0 + ft / 2, zc);
      }
      const sw = dense ? sp * 0.6 : 0.04;
      const nS = Math.max(3, Math.round((innerW - sw) / sp) + 1);
      const pitch = (innerW - sw) / (nS - 1);
      for (let k = 0; k < nS; k++) add(g, K.box(sw, hh - 2 * ft, dense ? t - 0.008 : t * 0.6, { grain: 'y' }), hbMat, 'headboard', -innerW / 2 + sw / 2 + k * pitch, cy, dense ? zb + 0.008 + (t - 0.008) / 2 : zc);
      break;
    }
    case 'cushions': {
      // loose cushions hanging on a rail (legs part)
      const nC = innerW > 1.5 ? 3 : 2;
      const gap = 0.02;
      const cw = (innerW - (nC - 1) * gap) / nC;
      const ch = Math.min(hh, 0.6);
      add(g, K.cylinder(0.012, 0.012, hw, { seg: 10, center: true }), legsMat, 'legs', 0, y1 - 0.02, zb + 0.02, [0, 0, Math.PI / 2]);
      for (let k = 0; k < nC; k++) {
        const x = -innerW / 2 + cw / 2 + k * (cw + gap);
        add(g, K.cushion(cw, ch, Math.max(0.1, t), { axis: 'z', puff: 0.3, round: 0.9, sides: 0.15, seg: 12 }), hbMat, 'headboard', x, y1 - 0.04 - ch / 2, zb + Math.max(0.1, t) / 2 + 0.01, [-6 * DEG, 0, 0]);
      }
      break;
    }
    case 'cane': {
      const fw = 0.05;
      for (const s of [-1, 1]) add(g, K.box(fw, hh, t, { grain: 'y' }), hbMat, 'headboard', s * (innerW / 2 - fw / 2), cy, zc);
      for (const s of [-1, 1]) add(g, K.box(innerW - 2 * fw, fw, t, { grain: 'x' }), hbMat, 'headboard', 0, s > 0 ? y1 - fw / 2 : y0 + fw / 2, zc);
      add(g, K.box(innerW - 2 * fw + 0.01, hh - 2 * fw + 0.01, 0.004), mat('rattan', wood ? tone(C.headboard, 1.25) : '#c7a777', { open: true }), null, 0, cy, zc);
      break;
    }
    default: // panel
      add(g, softZ(innerW, hh, t, { puff: wood ? 0 : 0.08 }), hbMat, 'headboard', 0, cy, zc);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Bedding

/**
 * The made-up bed on top of a lying surface at y = top over x ∈ ±bw/2, z ∈ [zHead, zFoot]: duvet with a turned-down
 * fold and side drops, pillows, an optional runner across the foot. `bedding` 'duvet' | 'bedspread' | 'none'.
 */
function addBedding(g, spec, { bw, top, zHead, zFoot, minY, footFree, lean = true }) {
  const P = spec.params;
  const C = spec.colors || {}, M = spec.materials || {};
  const mode = ['duvet', 'bedspread', 'none'].includes(P.bedding) ? P.bedding : 'duvet';
  if (mode === 'none') return 0;
  const bed = mat(M.bedding || 'cotton', C.bedding || '#f1eee8');
  const L = zFoot - zHead;
  const double = bw >= 1.3;
  const nP = clamp(Math.round(num(P.pillows, double ? 2 : 1)), 0, 4);
  const pillowZone = nP ? Math.min(0.55, L * 0.3) : 0.08;
  const spread = mode === 'bedspread';
  // duvet / bedspread: the top slab, side drops and the foot drop
  const dz0 = spread ? zHead + 0.02 : zHead + pillowZone;
  const dz1 = zFoot + 0.02;
  const dT = spread ? 0.045 : 0.07;
  const dl = dz1 - dz0;
  add(g, softY(bw + 0.05, dT, dl, { puff: spread ? 0.15 : 0.3, round: 0.9, sides: 0.2, seg: 16 }), bed, 'bedding', 0, top + dT / 2 - 0.012, (dz0 + dz1) / 2);
  // the duvet hangs just over the top mattress, so the bed's own fabric shows (as in the store photos)
  const drop = spread ? Math.max(0.05, top - minY - 0.03) : Math.min(0.13, Math.max(0.06, top - minY - 0.05));
  for (const sx of [-1, 1]) {
    add(g, K.cushion(0.03, drop, dl - 0.02, { axis: 'x', puff: 0.3, round: 0.8, sides: 0.15, seg: 14 }), bed, 'bedding', sx * (bw / 2 + 0.022), top - drop / 2 + 0.005, (dz0 + dz1) / 2);
  }
  if (footFree) add(g, K.cushion(bw + 0.06, drop, 0.03, { axis: 'z', puff: 0.3, round: 0.8, sides: 0.15, seg: 14 }), bed, 'bedding', 0, top - drop / 2 + 0.005, dz1 + 0.006);
  // the turned-down fold at the head end of the duvet
  if (!spread) add(g, softY(bw + 0.07, 0.05, 0.26, { puff: 0.35, round: 1, seg: 12 }), bed, 'bedding', 0, top + dT - 0.004, dz0 + 0.12);
  // pillows: side by side, leaning a little back toward the headboard; a second row in front when there are four
  if (nP) {
    const back = nP >= 4 ? 2 : nP;
    const pw = Math.min(0.7, (bw - 0.06) / back - 0.02);
    const pd = 0.48, pt = 0.17;
    const pGeo = K.cushion(pw, pt, pd, { axis: 'y', puff: 0.3, round: 1, sides: 0.25, pinch: 0.25, seg: 12 });
    // against a headboard they stand up and lean back; without one (the bed against a wall) they lie flatter
    const tilt = (lean ? 58 : 22) * DEG;
    const py = top + (spread ? dT : 0) + (pd / 2) * Math.sin(tilt) * 0.62 + (pt / 2) * Math.cos(tilt) - 0.02;
    for (let k = 0; k < back; k++) {
      const x = (k - (back - 1) / 2) * (pw + 0.02);
      add(g, pGeo, bed, 'bedding', x, py, zHead + 0.04 + (pd / 2) * Math.cos(tilt) + (pt / 2) * Math.sin(tilt), [-tilt, 0, 0]);
    }
    if (nP >= 4) {
      const fw = Math.min(0.6, pw * 0.9);
      const fGeo = K.cushion(fw, 0.13, 0.42, { axis: 'y', puff: 0.35, round: 0.95, sides: 0.2, pinch: 0.45, seg: 10 });
      for (let k = 0; k < 2; k++) add(g, fGeo, bed, 'bedding', (k - 0.5) * (fw + 0.02), top + 0.1 + (spread ? dT : 0), zHead + 0.38, [-48 * DEG, 0, 0]);
    }
  }
  // a runner / throw across the foot, and a small cushion in the same colour in front of the pillows
  if (P.throwRunner === true) {
    const th = mat(M.throw || 'knit', C.throw || '#9c8a74');
    const rz = zFoot - Math.min(0.42, L * 0.2);
    const rl = Math.min(0.5, L * 0.25);
    const ty = top + (spread ? 0.05 : dT) - 0.004;
    add(g, softY(bw + 0.07, 0.025, rl, { puff: 0.3, round: 1, seg: 12 }), th, 'throw', 0, ty + 0.0125, rz);
    for (const sx of [-1, 1]) add(g, K.cushion(0.02, 0.22, rl, { axis: 'x', puff: 0.3, round: 0.8, seg: 10 }), th, 'throw', sx * (bw / 2 + 0.04), ty - 0.1, rz);
    if (nP >= 2) add(g, K.cushion(0.45, 0.14, 0.3, { axis: 'y', puff: 0.4, round: 0.95, pinch: 0.5, seg: 10 }), th, 'throw', 0, top + 0.13, zHead + (nP >= 4 ? 0.5 : 0.42), [-55 * DEG, 0, 0]);
  }
  return dT;
}

// ---------------------------------------------------------------------------------------------------------------
// Bed

const BED_TYPES = ['continental', 'frame', 'storage', 'platform', 'adjustable'];

function buildBed(spec) {
  const { w, d, h } = spec.dims;
  const P = spec.params;
  const C = spec.colors || {}, M = spec.materials || {};
  const g = new THREE.Group();
  const type = BED_TYPES.includes(P.bedType) ? P.bedType : 'continental';
  const box = type === 'continental' || type === 'adjustable' || type === 'storage';
  const frameKind = M.frame || 'woven';
  const woodFrame = kindGroup(frameKind) === 'wood';
  const frameMat = mat(frameKind, C.frame, woodFrame ? { grain: 'z' } : undefined);
  const frameMatX = mat(frameKind, C.frame, woodFrame ? { grain: 'x' } : undefined);
  const legsKind = M.legs || 'oak';
  const legsMat = mat(legsKind, C.legs, kindGroup(legsKind) === 'wood' ? { grain: 'y' } : undefined);
  const hbMat = mat(M.headboard || frameKind, C.headboard || C.frame, kindGroup(M.headboard || frameKind) === 'wood' ? { grain: 'x' } : undefined);
  const mattress = mat('cotton', '#f3f1ec');

  // headboard / foot end
  const hbStyle = HEAD_STYLES.includes(P.headboard) ? P.headboard : 'none';
  const hbT = hbStyle === 'none' ? 0 : clamp(num(P.headboardT, hbStyle === 'wing' ? 0.12 : hbStyle === 'wood' || hbStyle === 'slats' || hbStyle === 'cane' ? 0.04 : 0.08), 0.02, 0.35);
  const foot = P.footboard === true;
  const fbT = foot ? clamp(num(P.footboardT, 0.04), 0.02, 0.1) : 0;
  // the bed body: mattress width + the frame round it
  const railT = type === 'frame' ? clamp(num(P.railT, woodFrame ? 0.03 : 0.06), 0.015, 0.15) : 0;
  const allow = type === 'frame' ? 2 * railT : type === 'platform' ? 0.14 : 0;
  const hbW = clamp(num(P.headboardW, w), 0.5, w);
  const bw = clamp(num(P.mattressW, Math.min(w, hbW) - allow) + allow, 0.5, w);
  const zHead = -d / 2 + hbT + (hbT ? 0.004 : 0);
  const zFoot = d / 2 - fbT - (foot ? 0.002 : 0);
  const bl = Math.max(0.6, zFoot - zHead);
  const zc = (zHead + zFoot) / 2;
  const seatDefault = { continental: 0.62, adjustable: 0.55, storage: 0.55, frame: 0.5, platform: 0.42 }[type];
  const seatH = clamp(num(P.seatH, Math.min(h, seatDefault)), 0.2, 0.95);
  const topperH = clamp(num(P.topperH, box ? 0.07 : 0), 0, 0.15);
  const legStyle = LEG_STYLES.includes(P.legStyle) ? P.legStyle : type === 'storage' || type === 'platform' ? 'plinth' : 'block';
  const legDefault = { continental: 0.14, adjustable: 0.12, storage: 0.03, frame: 0.16, platform: 0.04 }[type];
  const legH = clamp(num(P.legH, legDefault), 0, seatH * 0.6);
  const halves = (type === 'continental' || type === 'adjustable') && bw >= 1.3;
  let yRest = seatH - topperH; // top of the base / mattress under the topper

  if (box) {
    // fabric (or veneer) base box(es); two halves with a seam for double continental beds
    const bh = Math.max(0.05, yRest - legH);
    const parts = halves ? [[-bw / 4, bw / 2 - 0.002], [bw / 4, bw / 2 - 0.002]] : [[0, bw]];
    // a continental bed is a spring base + a mattress section in the same fabric: two soft boxes with a seam
    const stacked = type !== 'storage' && !woodFrame && bh > 0.22;
    const lowH = stacked ? bh * 0.48 : bh;
    for (const [cx, pw] of parts) {
      const soft = (hh, round) => softY(pw, hh, bl, { puff: 0.03, round, sides: 0.05, bottom: 0, seg: 10 });
      if (woodFrame) add(g, K.roundedBox(pw, bh, bl, 0.006, 1, { grain: 'z' }), frameMat, 'frame', cx, legH + bh / 2, zc);
      else if (stacked) {
        add(g, soft(lowH - 0.004, Math.min(1, 0.03 / lowH)), frameMat, 'frame', cx, legH + lowH / 2, zc);
        const upH = bh - lowH;
        add(g, softY(pw, upH, bl, { puff: 0.04, round: Math.min(1, 0.06 / upH), sides: 0.08, bottom: 0.05, seg: 10 }), frameMat, 'frame', cx, legH + lowH + upH / 2, zc);
      } else add(g, soft(bh, Math.min(1, 0.05 / bh)), frameMat, 'frame', cx, legH + bh / 2, zc);
    }
    if (type === 'storage') {
      // drawer fronts along both long sides (a thin shadow gap round each)
      const nD = clamp(Math.round(num(P.drawers, 2)), 0, 4);
      const gm = mat('painted', '#151210', { flat: true, roughness: 0.95 });
      const dh = Math.min(0.24, bh * 0.62);
      const dl = (bl - 0.3) / Math.max(1, nD);
      for (const sx of [-1, 1]) {
        for (let k = 0; k < nD; k++) {
          const z = zFoot - 0.15 - dl * (k + 0.5);
          const y = legH + bh * 0.45;
          add(g, K.box(0.003, dh + 0.006, dl - 0.012), gm, null, sx * (bw / 2 + 0.0002), y, z);
          add(g, K.roundedBox(0.012, dh, dl - 0.02, 0.003, 1, { grain: 'z' }), frameMat, 'frame', sx * (bw / 2 + 0.004), y, z);
        }
      }
    }
  } else if (type === 'frame') {
    // side and end rails round the mattress, the mattress top a little proud of the rails
    const railTop = clamp(num(P.railH, seatH - (woodFrame ? 0.12 : 0.09)), legH + 0.06, seatH);
    const rh = railTop - legH;
    const rail = (rw, rd, x, z, along) => {
      const geo = woodFrame ? K.roundedBox(rw, rh, rd, 0.004, 1, { grain: along }) : K.cushion(rw, rh, rd, { axis: along === 'x' ? 'z' : 'x', puff: 0.05, round: 0.8, sides: 0.06, seg: 10 });
      add(g, geo, along === 'x' ? frameMatX : frameMat, 'frame', x, legH + rh / 2, z);
    };
    for (const sx of [-1, 1]) rail(railT, bl, sx * (bw / 2 - railT / 2), zc, 'z');
    rail(bw - 2 * railT, railT, 0, zFoot - railT / 2, 'x');
    rail(bw - 2 * railT, railT, 0, zHead + railT / 2, 'x');
    const nD = clamp(Math.round(num(P.drawers, 0)), 0, 3);
    if (nD && legH > 0.12) {
      // drawer boxes under the bed between the legs, fronts flush with the side rails
      const dh = Math.min(0.17, legH - 0.04), dl = (bl - 0.3) / nD - 0.02;
      const inner = mat('painted', '#e8e2d6');
      for (const sx of [-1, 1]) {
        for (let k = 0; k < nD; k++) {
          const z = zHead + 0.15 + (k + 0.5) * (dl + 0.02);
          add(g, K.roundedBox(0.018, dh, dl, 0.003, 1, { grain: 'z' }), frameMat, 'frame', sx * (bw / 2 - railT / 2), 0.025 + dh / 2, z);
          add(g, K.box(0.004, 0.02, 0.12), mat('painted', '#151210', { flat: true }), null, sx * (bw / 2 - railT / 2 + 0.008), 0.025 + dh - 0.02, z);
          add(g, K.box(bw * 0.3, dh * 0.8, dl - 0.02), inner, null, sx * (bw / 2 - railT - bw * 0.15), 0.025 + dh * 0.4, z);
        }
      }
    }
    const mH = Math.max(0.12, yRest - (railTop - 0.14));
    add(g, softY(bw - 2 * railT - 0.006, mH, bl - 2 * railT - 0.006, { puff: 0.05, round: 0.35, sides: 0.05, bottom: 0, seg: 12 }), mattress, null, 0, yRest - mH / 2, zc);
  } else {
    // platform: a low wide box (frame part), the mattress on top
    const pTop = clamp(num(P.railH, seatH - 0.22), legH + 0.05, seatH - 0.08);
    add(g, K.roundedBox(bw, pTop - legH, bl, 0.008, 1, { grain: 'z' }), frameMat, 'frame', 0, legH + (pTop - legH) / 2, zc);
    const mw = bw - allow, ml = bl - 0.08;
    add(g, softY(mw, yRest - pTop, ml, { puff: 0.04, round: 0.4, sides: 0.05, bottom: 0, seg: 12 }), mattress, null, 0, (pTop + yRest) / 2, zc - 0.02);
  }
  // top mattress (overmadrass)
  if (topperH > 0.004) {
    const tw = type === 'frame' ? bw - 2 * railT - 0.01 : type === 'platform' ? bw - allow : bw - 0.004;
    add(g, softY(tw, topperH, (type === 'frame' ? bl - 2 * railT : bl) - 0.006, { puff: 0.08, round: 0.9, sides: 0.15, bottom: 0.1, seg: 12 }), mattress, null, 0, yRest + topperH / 2, type === 'platform' ? zc - 0.02 : zc);
  }
  bedLegs(g, spec, legsMat, legStyle, { hx: bw / 2, hz: bl / 2, zc, legH, wide: halves || bw >= 1.6, long: bl > 1.9 && box, frameMat });

  // headboard (behind the bed body) and foot end
  if (hbStyle !== 'none') {
    const hbTop = clamp(num(P.headboardH, h), seatH + 0.1, 2.4);
    const woodHb = hbStyle === 'wood' || hbStyle === 'slats' || hbStyle === 'cane';
    const y0 = clamp(num(P.headboardBottom, type === 'frame' || type === 'platform' ? (woodHb ? 0 : legH) : Math.min(0.1, legH)), 0, hbTop - 0.1);
    addHeadboard(g, spec, hbStyle, { hw: hbW, t: hbT, y0, y1: hbTop, zb: -d / 2, hbMat, legsMat, P, posts: woodHb && woodFrame && y0 < 0.01 });
  }
  if (foot) {
    const fH = clamp(num(P.footboardH, seatH + 0.05), legH + 0.1, 1.2);
    const fy0 = type === 'frame' ? 0 : legH;
    const fbMat = hbMat;
    add(g, K.roundedBox(bw, fH - fy0, fbT, 0.004, 1, { grain: 'x' }), fbMat, 'headboard', 0, fy0 + (fH - fy0) / 2, d / 2 - fbT / 2);
    add(g, K.roundedBox(bw + 0.01, 0.022, fbT + 0.01, 0.004, 1, { grain: 'x' }), fbMat, 'headboard', 0, fH - 0.011, d / 2 - fbT / 2);
  }

  const dT = addBedding(g, spec, { bw, top: seatH, zHead, zFoot, minY: legH, footFree: !foot, lean: hbStyle !== 'none' });
  const surfaces = [{ y: +(seatH + dT).toFixed(4), w: +(bw * 0.85).toFixed(3), d: +(bl * 0.7).toFixed(3), center: [0, +(zc + bl * 0.1).toFixed(4)] }];
  const rc = recolorer(g, (part, kind) => !!kind && ((part === 'frame' && kindGroup(kind) !== kindGroup(frameKind)) || part === 'headboard' || (part === 'legs' && kindGroup(kind) !== kindGroup(legsKind))));
  g.name = 'bed';
  return K.finishModel(g, { seatY: seatH, surfaces, recolor: rc });
}

// ---------------------------------------------------------------------------------------------------------------
// Headboard (sengegavl) as its own product

function buildHeadboardProduct(spec) {
  const { w, d, h } = spec.dims;
  const P = spec.params;
  const M = spec.materials || {}, C = spec.colors || {};
  const g = new THREE.Group();
  const style = HEAD_STYLES.includes(P.style) ? P.style : 'panel';
  const hbKind = M.headboard || 'woven';
  const hbMat = mat(hbKind, C.headboard, kindGroup(hbKind) === 'wood' ? { grain: 'x' } : undefined);
  const legsKind = M.legs || 'oak';
  const legsMat = mat(legsKind, C.legs, kindGroup(legsKind) === 'wood' ? { grain: 'y' } : undefined);
  const wings = style === 'wing' ? clamp(num(P.wings, Math.max(0.05, d - 0.1)), 0.05, Math.max(0.05, d - 0.04)) : 0;
  const t = style === 'wing' ? Math.max(0.04, d - wings) : d;
  const legH = clamp(num(P.legH, 0.08), 0, h * 0.5);
  addHeadboard(g, spec, style, { hw: w, t, y0: legH, y1: h, zb: -d / 2, hbMat, legsMat, P: { ...P, wings }, posts: false });
  const rc = recolorer(g, (part, kind) => !!kind && (part === 'headboard' || (part === 'legs' && kindGroup(kind) !== kindGroup(legsKind))));
  g.name = 'headboard';
  return K.finishModel(g, { recolor: rc });
}

// ---------------------------------------------------------------------------------------------------------------
// Bench (sengebenk / gangbenk / spisebenk)

const BENCH_LEGS = ['wood-taper', 'block', 'metal-thin', 'metal-frame', 'plinth', 'wood-frame'];

function buildBench(spec) {
  const { w, d, h } = spec.dims;
  const P = spec.params;
  const C = spec.colors || {}, M = spec.materials || {};
  const g = new THREE.Group();
  const seat = ['upholstered', 'wood', 'cushion', 'cord'].includes(P.seat) ? P.seat : 'upholstered';
  const upKind = M.upholstery || (seat === 'wood' ? 'oak' : 'boucle');
  const up = mat(upKind, C.upholstery, kindGroup(upKind) === 'wood' ? { grain: 'x' } : undefined);
  const frameKind = M.frame || M.legs || 'oak';
  const frame = mat(frameKind, C.frame || C.legs, kindGroup(frameKind) === 'wood' ? { grain: 'x' } : undefined);
  const frameV = mat(frameKind, C.frame || C.legs, kindGroup(frameKind) === 'wood' ? { grain: 'y' } : undefined);
  const legsKind = M.legs || 'oak';
  const legs = mat(legsKind, C.legs, kindGroup(legsKind) === 'wood' ? { grain: 'y' } : undefined);
  const seatH = clamp(num(P.seatH, h), 0.25, 0.9);
  const seatT = clamp(num(P.seatT, seat === 'upholstered' ? 0.1 : seat === 'cushion' ? 0.08 : 0.035), 0.015, 0.25);
  const style = BENCH_LEGS.includes(P.legStyle) ? P.legStyle : 'wood-taper';
  const storage = P.storage === true;
  const n = seg(spec, 12);
  // seat
  let underY = seatH - seatT; // underside of the seat
  if (seat === 'upholstered') {
    add(g, softY(w, seatT, d, { puff: 0.1, round: 0.6, sides: 0.12, bottom: 0.05, seg: 14 }), up, 'upholstery', 0, seatH - seatT / 2, 0);
    if (P.tufted === true) {
      const bm = mat(upKind, tone(C.upholstery, 0.82));
      const cols = Math.max(2, Math.round(w / 0.22));
      const bGeo = K.sphere(0.008, { wSeg: 8, hSeg: 6 });
      for (let r = 0; r < 2; r++) for (let c = 0; c < cols - r; c++) add(g, bGeo, bm, 'upholstery', -w / 2 + (w * (c + 0.5 + r * 0.5)) / cols, seatH + 0.006, (r - 0.5) * d * 0.4);
    }
  } else if (seat === 'cushion') {
    const bt = 0.03;
    add(g, K.roundedBox(w, bt, d, 0.004, 1, { grain: 'x' }), frame, 'frame', 0, seatH - seatT - bt / 2 + 0.002, 0);
    add(g, softY(w - 0.02, seatT, d - 0.02, { puff: 0.18, round: 0.8, sides: 0.15, seg: 14 }), up, 'upholstery', 0, seatH - seatT / 2, 0);
    underY = seatH - seatT - bt;
  } else if (seat === 'cord') {
    const ft = 0.035;
    for (const s of [-1, 1]) add(g, K.roundedBox(w, ft, ft, 0.004, 1, { grain: 'x' }), frame, 'frame', 0, seatH - ft / 2, s * (d / 2 - ft / 2));
    for (const s of [-1, 1]) add(g, K.roundedBox(ft, ft, d - 2 * ft, 0.004, 1, { grain: 'z' }), frame, 'frame', s * (w / 2 - ft / 2), seatH - ft / 2, 0);
    add(g, K.box(w - 2 * ft + 0.004, 0.012, d - 2 * ft + 0.004), up, 'upholstery', 0, seatH - 0.012, 0);
    underY = seatH - ft;
  } else {
    add(g, K.roundedBox(w, seatT, d, 0.004, 1, { grain: 'x' }), up, 'upholstery', 0, seatH - seatT / 2, 0);
  }
  // base
  if (storage) {
    // a lift-lid box: on a recessed plinth, or on legs when legH is given
    const sl = clamp(num(P.legH, 0.02), 0.02, underY - 0.15);
    add(g, K.roundedBox(w - 0.01, underY - sl, d - 0.01, 0.004, 1, { grain: 'x' }), frame, 'frame', 0, sl + (underY - sl) / 2, 0);
    if (sl <= 0.025) add(g, K.box(w - 0.08, 0.02, d - 0.08), legs, 'legs', 0, 0.01, 0);
    else for (const sx of [-1, 1]) for (const sz of [-1, 1]) add(g, K.taperLeg(sl + 0.002, 0.02, 0.014, { seg: n }), legs, 'legs', sx * (w / 2 - 0.06), 0, sz * (d / 2 - 0.06));
  } else if (style === 'plinth') {
    add(g, K.box(w - 0.08, underY, d - 0.08, { grain: 'x' }), legs, 'legs', 0, underY / 2, 0);
  } else if (style === 'wood-frame') {
    // solid end panels from the floor to the seat (shoe benches)
    const et = 0.025;
    for (const s of [-1, 1]) add(g, K.roundedBox(et, underY, d - 0.01, 0.003, 1, { grain: 'y' }), frameV, 'frame', s * (w / 2 - et / 2 - 0.005), underY / 2, 0);
  } else if (style === 'metal-frame') {
    // two flat-steel frames (U upside down with a floor rail) at the ends
    const ft = 0.02, fw = 0.04;
    for (const s of [-1, 1]) {
      const x = s * (w / 2 - 0.06);
      for (const sz of [-1, 1]) add(g, K.box(ft, underY, fw * 0.5, { grain: 'y' }), legs, 'legs', x, underY / 2, sz * (d / 2 - 0.05));
      add(g, K.box(ft, fw * 0.5, d - 0.1 + fw * 0.5), legs, 'legs', x, fw * 0.25, 0);
      add(g, K.box(ft, fw * 0.5, d - 0.1 + fw * 0.5), legs, 'legs', x, underY - fw * 0.25, 0);
    }
  } else {
    const inset = 0.05;
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const x = sx * (w / 2 - inset), z = sz * (d / 2 - inset);
        if (style === 'block') add(g, K.roundedBox(0.045, underY, 0.045, 0.003, 1, { grain: 'y', bottom: true }), legs, 'legs', x, 0, z);
        else if (style === 'metal-thin') add(g, K.cylinder(0.011, 0.009, underY, { seg: n }), legs, 'legs', x, 0, z);
        else {
          // splayed: the foot at the corner, the top leaning in under the seat
          const tilt = 7 * DEG;
          const m = add(g, K.taperLeg(underY / Math.cos(tilt), 0.022, 0.014, { seg: n }), legs, 'legs', x, 0, z);
          m.rotation.set(-sz * tilt * 0.6, 0, sx * tilt);
        }
      }
    }
    // a slim apron under the seat for wooden benches
    if (seat !== 'upholstered' && style !== 'metal-thin') for (const s of [-1, 1]) add(g, K.box(w - 0.12, 0.04, 0.018, { grain: 'x' }), frame, 'frame', 0, underY - 0.02, s * (d / 2 - 0.06));
  }
  // shoe shelf / baskets
  const shelf = ['board', 'slats', 'basket'].includes(P.shelf) ? P.shelf : 'none';
  if (shelf !== 'none' && !storage) {
    const sy = clamp(num(P.shelfH, Math.min(0.16, underY * 0.4)), 0.04, underY - 0.12);
    const sw = w - (style === 'wood-frame' ? 0.06 : 0.1), sd = d - 0.08;
    if (shelf === 'slats') {
      const nS = Math.max(3, Math.round(sd / 0.05));
      const pitch = sd / nS;
      for (let k = 0; k < nS; k++) add(g, K.roundedBox(sw, 0.016, pitch * 0.7, 0.003, 1, { grain: 'x' }), frame, 'frame', 0, sy, -sd / 2 + pitch * (k + 0.5));
    } else add(g, K.roundedBox(sw, 0.018, sd, 0.003, 1, { grain: 'x' }), frame, 'frame', 0, sy, 0);
    if (style !== 'wood-frame' && style !== 'metal-frame') for (const sx of [-1, 1]) for (const sz of [-1, 1]) add(g, K.box(0.012, 0.012, 0.012), frame, 'frame', sx * (sw / 2 - 0.006), sy - 0.012, sz * (sd / 2 - 0.006));
    if (shelf === 'basket') {
      const nB = w > 0.9 ? 2 : 1;
      const bw = Math.min(0.42, (sw - 0.04) / nB - 0.03);
      const bh = Math.min(0.2, underY - sy - 0.06);
      const bm = mat('rattan', '#b89a6e');
      for (let k = 0; k < nB; k++) add(g, K.roundedBox(bw, bh, sd - 0.04, 0.012, 2), bm, null, (k - (nB - 1) / 2) * (bw + 0.04), sy + 0.009 + bh / 2, 0);
    }
  }
  const rc = recolorer(g, (part, kind) => !!kind && kindGroup(kind) !== kindGroup(part === 'upholstery' ? upKind : part === 'legs' ? legsKind : frameKind));
  g.name = 'bench';
  return K.finishModel(g, { seatY: seatH, surfaces: [{ y: +seatH.toFixed(4), w: +(w * 0.9).toFixed(3), d: +(d * 0.8).toFixed(3), center: [0, 0] }], recolor: rc });
}

// ---------------------------------------------------------------------------------------------------------------
// Archetypes

const HB_OPTIONS = [['panel', 'Glatt polstret'], ['channel', 'Loddrette kanaler'], ['tufted', 'Knapper'], ['rounded', 'Avrundet topp'], ['wing', 'Med vinger'], ['wood', 'Heltre / finér'], ['slats', 'Spiler'], ['cushions', 'Løse puter på stang'], ['cane', 'Rotting i ramme']];

/** @type {Record<string, object>} */
export const archetypes = {
  bed: def('bed', {
    defaults: {
      dims: { w: 1.8, d: 2.0, h: 0.62 },
      params: { bedType: 'continental', mattressW: 1.8, mattressL: 2.0, seatH: 0.62, topperH: 0.07, legStyle: 'block', legH: 0.14, headboard: 'none', bedding: 'duvet', pillows: 2, throwRunner: false },
      colors: { frame: '#b8ab98', headboard: '#b8ab98', legs: '#7a5a3f', bedding: '#f1eee8', throw: '#9c8a74' },
      materials: { frame: 'woven', headboard: 'woven', legs: 'oak', bedding: 'cotton', throw: 'knit' },
    },
    params: {
      bedType: { type: 'enum', label: 'Type', options: [['continental', 'Kontinentalseng'], ['frame', 'Rammeseng'], ['storage', 'Med oppbevaring'], ['platform', 'Lav plattform'], ['adjustable', 'Regulerbar']] },
      seatH: { type: 'number', min: 0.25, max: 0.9, step: 0.01, label: 'Liggehøyde (m)' },
      topperH: { type: 'number', min: 0, max: 0.15, step: 0.01, label: 'Overmadrass (m)' },
      legStyle: { type: 'enum', label: 'Ben', options: [['block', 'Firkantede klosser'], ['round', 'Runde'], ['taper', 'Skrå/smalnende'], ['metal', 'Metall'], ['plinth', 'Sokkel'], ['skirt', 'Sengeskjørt']] },
      legH: { type: 'number', min: 0, max: 0.4, step: 0.01, label: 'Benhøyde (m)' },
      headboard: { type: 'enum', label: 'Hodegavl', options: [['none', 'Uten'], ...HB_OPTIONS] },
      headboardH: { type: 'number', min: 0.6, max: 2.0, step: 0.01, label: 'Gavlhøyde (m)' },
      drawers: { type: 'number', min: 0, max: 4, step: 1, label: 'Skuffer per side' },
      footboard: { type: 'bool', label: 'Fotgavl' },
      bedding: { type: 'enum', label: 'Sengetøy', options: [['duvet', 'Dyne og puter'], ['bedspread', 'Sengeteppe'], ['none', 'Uten']] },
      pillows: { type: 'number', min: 0, max: 4, step: 1, label: 'Puter' },
      throwRunner: { type: 'bool', label: 'Pledd over fotenden' },
    },
    dimsRange: { w: [0.7, 2.4], d: [1.8, 2.5], h: [0.25, 2.0] },
    build: buildBed,
  }),
  headboard: def('headboard', {
    defaults: {
      dims: { w: 1.85, d: 0.1, h: 1.35 },
      params: { style: 'panel', legH: 0.08 },
      colors: { headboard: '#b8ab98', legs: '#2a2522' },
      materials: { headboard: 'woven', legs: 'black-metal' },
    },
    params: {
      style: { type: 'enum', label: 'Type', options: HB_OPTIONS },
      legH: { type: 'number', min: 0, max: 0.5, step: 0.01, label: 'Føtter (m)' },
      channels: { type: 'number', min: 3, max: 30, step: 1, label: 'Kanaler' },
      buttonRows: { type: 'number', min: 1, max: 8, step: 1, label: 'Knapperader' },
      slatPitch: { type: 'number', min: 0.03, max: 0.15, step: 0.005, label: 'Spileavstand (m)' },
      wings: { type: 'number', min: 0.05, max: 0.4, step: 0.01, label: 'Vinger fram (m)' },
    },
    dimsRange: { w: [0.8, 2.6], d: [0.03, 0.4], h: [0.6, 2.0] },
    build: buildHeadboardProduct,
  }),
  bench: def('bench', {
    defaults: {
      dims: { w: 1.2, d: 0.4, h: 0.46 },
      params: { seat: 'upholstered', seatT: 0.1, legStyle: 'wood-taper', shelf: 'none', tufted: false, storage: false },
      colors: { upholstery: '#c9bfae', legs: '#8a6a4c', frame: '#8a6a4c' },
      materials: { upholstery: 'boucle', legs: 'oak', frame: 'oak' },
    },
    params: {
      seat: { type: 'enum', label: 'Sete', options: [['upholstered', 'Polstret'], ['wood', 'Tre'], ['cushion', 'Tre med pute'], ['cord', 'Flettet snor']] },
      seatT: { type: 'number', min: 0.02, max: 0.2, step: 0.01, label: 'Setetykkelse (m)' },
      legStyle: { type: 'enum', label: 'Understell', options: [['wood-taper', 'Skrå treben'], ['block', 'Rette ben'], ['metal-thin', 'Tynne metallben'], ['metal-frame', 'Metallrammer'], ['plinth', 'Sokkel'], ['wood-frame', 'Gavler i tre']] },
      shelf: { type: 'enum', label: 'Hylle under', options: [['none', 'Ingen'], ['board', 'Hylle'], ['slats', 'Spilehylle'], ['basket', 'Med kurver']] },
      tufted: { type: 'bool', label: 'Knapper i setet' },
      storage: { type: 'bool', label: 'Oppbevaring (løftelokk)' },
    },
    dimsRange: { w: [0.5, 2.2], d: [0.28, 0.6], h: [0.3, 0.6] },
    build: buildBench,
  }),
};
