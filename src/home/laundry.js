// The basement laundry / bathroom (notes/hele-huset-design.md §2.7, avstemming V58–V60; notes/hus-foto/vaskerom.md):
// the bench on the west wall (worktop in a warm grey concrete look, black composite sink and kitchen tap, greige
// fronts with black bar handles), the built-in cabinet row on the south wall (hamper with tilt fronts, a tall cabinet
// – the water heater stands behind it, unseen –, the machine column with the washer and the dryer stacked under a
// wall cabinet, the bench corner with a niche and a wall cabinet, a top panel to the ceiling), the washer and the
// dryer themselves, a water heater (only when the data asks for one: type 'water-heater') and the sliding wardrobe of
// the entrance (`wardrobe-sliding`). The WC, the shower with its dark panels, the towel radiator and the drain are
// bathroom.js's (the same types upstairs).
//
// Same conventions as bathroom.js: build<Type>(F, b, k) in the built-in's local frame (origin = middle of the
// footprint on its underside, +z = front, dims.w along x). Module ranges in the data (params.modules[].x / .z) are
// WORLD coordinates (they follow the walls); k.toLocal turns them into the frame.
import * as THREE from 'three';
import { mat } from './materials.js';
import { FRONT_T, GAP, makeWorktop, makeSink, makeTap } from './fittings.js';
import { surfaceFinish, cloudContrast } from '../world/surfaces.js';
import { DARK } from './bathroom.js';

const PI = Math.PI;
const hexOr = (v, fb) => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v : fb);

const _sinks = new Map();
/**
 * Inset sink seen from inside: the same material set-up as the kitchen's basin (back faces, no maps), so it shares
 * the kitchen sink's shader program. Cached per colour.
 */
function sinkMaterial(hex) {
  let m = _sinks.get(hex);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color: hex, roughness: 0.62, side: THREE.BackSide });
    m.name = `sink ${hex}`;
    m.userData = { cached: true, kind: 'sink', hex };
    _sinks.set(hex, m);
  }
  return m;
}

/** A darker shade of a '#hex' (plinths, carcass edges). */
function shade(hex, f) {
  const c = new THREE.Color(hex);
  c.multiplyScalar(f);
  return `#${c.getHexString()}`;
}

/** Black bar handle on a front (local frame of the front: x along the front, y up, z = the front's face). */
function barHandle(F, x, y, z, len, vertical, material) {
  const t = 0.012;
  if (vertical) {
    F.box(t, len, t, x, y, z + 0.03, material, { collide: false });
    for (const s of [-1, 1]) F.box(0.009, 0.009, 0.03, x, y + s * (len / 2 - 0.012), z + 0.015, material, { collide: false });
  } else {
    F.box(len, t, t, x, y, z + 0.03, material, { collide: false });
    for (const s of [-1, 1]) F.box(0.009, 0.009, 0.03, x + s * (len / 2 - 0.012), y, z + 0.015, material, { collide: false });
  }
}

/** Local x range [a, b] (sorted) of a module given in world x (bench) or world z (cabinet row). */
function localRange(k, b, axis, range) {
  const c = b.position;
  const p = axis === 'x' ? [k.toLocal(range[0], c.z).x, k.toLocal(range[1], c.z).x] : [k.toLocal(c.x, range[0]).x, k.toLocal(c.x, range[1]).x];
  return p[0] <= p[1] ? p : [p[1], p[0]];
}

// ---------------------------------------------------------------------------------------------------------------
// Bench: carcass, recessed plinth, fronts per module (drawers / sink drawers / a door / a blind corner), worktop with
// the sink cut-out, the black composite sink and a black kitchen tap

/** @param {object} F @param {object} b @param {object} k */
export function buildLaundryBench(F, b, k) {
  const { w, d, h } = b.dims;
  const P = b.params || {};
  const C = b.colors || {};
  const frontHex = hexOr(C.fronts, '#b0a89f');
  const front = mat('painted', frontHex, { roughness: 0.6 });
  const carcass = mat('painted', shade(frontHex, 0.82), { roughness: 0.7 });
  const plinthM = mat('painted', shade(frontHex, 0.7), { roughness: 0.75 });
  const handle = mat('black-metal', hexOr(C.handles, '#1a1a1a'), { roughness: 0.4 });
  const topHex = hexOr(C.top, '#938b85');
  const topM = surfaceFinish('laminate', topHex, { clouds: cloudContrast(topHex, P.top?.clouds, 'stone') ?? 1.6 }) || mat('painted', topHex);
  const yF = k.floorY ?? 0;
  const t = P.top?.thickness ?? 0.03;
  const ph = P.plinth ?? 0.08;
  const yT = h - t; // underside of the worktop
  const zf = d / 2 - 0.012; // face of the fronts, the worktop overhangs a little
  // carcass behind the fronts, plinth recessed 6 cm
  F.box(w, yT - ph, d - 0.012 - FRONT_T, 0, ph + (yT - ph) / 2, -d / 2 + (d - 0.012 - FRONT_T) / 2, carcass);
  F.box(w, ph, d - 0.08, 0, yF + ph / 2, -d / 2 + (d - 0.08) / 2, plinthM, { castShadow: false });
  const mods = (P.modules || []).map((m) => ({ ...m, lx: localRange(k, b, 'x', m.x) }));
  const fronts = mods.length ? mods : [{ kind: 'door', lx: [-w / 2, w / 2] }];
  const fh = yT - ph - GAP; // front height
  const fy0 = ph + GAP / 2;
  for (const m of fronts) {
    const [a, c] = m.lx;
    const fw = c - a - GAP, cx = (a + c) / 2;
    if (m.kind === 'corner') continue; // blind corner under the cabinet row: the worktop covers it, no front
    if (m.kind === 'door') {
      F.box(fw, fh, FRONT_T, cx, fy0 + fh / 2, zf - FRONT_T / 2, front);
      // vertical handle at the top of the free edge (hinge 'south' / 'north' = that world end of the module)
      const hingeX = m.hinge ? k.toLocal(m.hinge === 'south' ? Math.max(...m.x) : Math.min(...m.x), b.position.z).x : a;
      const freeX = Math.abs(hingeX - a) < Math.abs(hingeX - c) ? c - 0.05 : a + 0.05;
      barHandle(F, freeX, fy0 + fh - 0.13, zf, 0.16, true, handle);
      continue;
    }
    const n = Math.max(1, m.count ?? 2);
    // two drawers: a lower top drawer on the wide modules (225501), even on the narrow one
    const split = n === 2 && c - a > 0.4 ? [0.42, 0.58] : Array.from({ length: n }, () => 1 / n);
    let top = fy0 + fh;
    for (const f of split) {
      const hh = fh * f - GAP;
      F.box(fw, hh, FRONT_T, cx, top - GAP / 2 - hh / 2, zf - FRONT_T / 2, front);
      barHandle(F, cx, top - 0.045, zf, Math.min(0.18, fw - 0.1), false, handle);
      top -= fh * f;
    }
  }
  // worktop with the sink cut-out, the sink and the tap
  const S = P.sink;
  let hole = null, sx = 0, sz = 0.02;
  if (S) {
    sx = Number.isFinite(S.centerX) ? k.toLocal(S.centerX, b.position.z).x : 0;
    hole = { x: sx, z: sz, w: S.w ?? 0.5, d: S.d ?? 0.42, r: 0.02 };
  }
  makeWorktop(F, { x0: -w / 2, x1: w / 2, z0: -d / 2, z1: d / 2, y0: yT, t }, topM, { hole });
  if (S) {
    const sinkHex = hexOr(C.sink, '#1a1a1a');
    makeSink(F, { x: sx, z: sz, w: hole.w, d: hole.d, h: 0.19, topY: h }, { basin: sinkMaterial(sinkHex), steel: mat('steel', '#b0b3b6'), vent: mat('plastic', DARK, { roughness: 0.9, flat: true }) });
    const tapMat = mat('black-metal', '#151515', { roughness: 0.32 });
    makeTap(F, { x: sx, z: sz - hole.d / 2 - 0.035, topY: h, h: 0.33 }, tapMat, { low: k.low });
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Cabinet row: modules along local x (world z), fronts on local +z, a top panel to the ceiling, a side panel at the
// open end

/** @param {object} F @param {object} b @param {object} k */
export function buildCabinetRow(F, b, k) {
  const { w, d } = b.dims;
  const P = b.params || {};
  const C = b.colors || {};
  const frontHex = hexOr(C.fronts, '#b0a89f');
  const front = mat('painted', frontHex, { roughness: 0.6 });
  const carcass = mat('painted', shade(frontHex, 0.82), { roughness: 0.7 });
  const plinthM = mat('painted', shade(frontHex, 0.7), { roughness: 0.75 });
  const inside = mat('painted', shade(frontHex, 0.55), { roughness: 0.85, flat: true });
  const handle = mat('black-metal', hexOr(C.handles, '#1a1a1a'), { roughness: 0.4 });
  const yF = k.floorY ?? 0;
  const hEff = Math.min(b.dims.h, k.ceilingY ?? b.dims.h) - 0.002;
  const tp = Math.min(hEff - 0.02, (P.topPanelFrom ?? 2.13) + yF);
  const ph = (P.plinth ?? 0.08) + yF;
  const zf = d / 2; // front face
  const cd = d - FRONT_T; // carcass depth behind the fronts
  const zc = -d / 2 + cd / 2;
  // the east end (toward the room): the end of the row with the lower local x when the world east is −x local …
  // generic: the end that is not against a wall – the one whose world point lies inside the room away from the walls
  const eastLocal = k.dirToLocal(0, -1).x; // world east (−z) in local x
  const openEndX = eastLocal < 0 ? -w / 2 : w / 2;
  // top panel over the full length (flush with the fronts) and its carcass
  F.box(w, hEff - tp, FRONT_T, 0, (tp + hEff) / 2, zf - FRONT_T / 2, front);
  F.box(w, hEff - tp, cd, 0, (tp + hEff) / 2, zc, carcass, { castShadow: false });
  // side panel at the open end, floor to ceiling
  F.box(FRONT_T, hEff - yF, d, openEndX - Math.sign(openEndX) * (FRONT_T / 2), (yF + hEff) / 2, 0, front);
  const wallCab = (a, c, wc) => {
    const y0 = (wc.from ?? 1.8) + yF, y1 = Math.min(tp, (wc.to ?? 2.13) + yF);
    F.box(c - a, y1 - y0, cd, (a + c) / 2, (y0 + y1) / 2, zc, carcass);
    F.box(c - a - GAP, y1 - y0 - GAP, FRONT_T, (a + c) / 2, (y0 + y1) / 2, zf - FRONT_T / 2, front);
    // vertical bar handle low at the east edge of the door
    const hx = eastLocal < 0 ? a + 0.04 : c - 0.04;
    barHandle(F, hx, y0 + 0.1, zf, 0.16, true, handle);
    // underside of the cabinet (seen from below)
    F.box(c - a, 0.012, cd, (a + c) / 2, y0 - 0.006, zc, inside, { collide: false, castShadow: false });
  };
  for (const m of P.modules || []) {
    const [a, c] = localRange(k, b, 'z', m.z);
    const cx = (a + c) / 2, mw = c - a;
    if (m.kind === 'hamper' || m.kind === 'tall') {
      F.box(mw, tp - ph, cd, cx, (ph + tp) / 2, zc, carcass);
      F.box(mw, ph - yF, d - 0.06, cx, (yF + ph) / 2, -d / 2 + (d - 0.06) / 2, plinthM, { castShadow: false });
      if (m.kind === 'tall') {
        F.box(mw - GAP, tp - ph - GAP, FRONT_T, cx, (ph + tp) / 2, zf - FRONT_T / 2, front);
        continue;
      }
      // hamper: a fixed panel on top, tilt fronts under it (closed, push-to-open: no handles)
      const top = m.topPanel ?? 0.3;
      F.box(mw - GAP, top - GAP, FRONT_T, cx, tp - top / 2, zf - FRONT_T / 2, front);
      const n = Math.max(1, m.tiltFronts ?? 3);
      const span = tp - top - ph;
      for (let i = 0; i < n; i++) {
        const y0 = ph + (i * span) / n, y1 = ph + ((i + 1) * span) / n;
        F.box(mw - GAP, y1 - y0 - GAP, FRONT_T, cx, (y0 + y1) / 2, zf - FRONT_T / 2, front);
      }
      continue;
    }
    if (m.kind === 'machine-column' || m.kind === 'bench-corner') {
      if (m.wallCabinet) wallCab(a, c, m.wallCabinet);
      if (m.kind === 'machine-column') {
        // partition toward the bench corner, floor up to the wall cabinet (the bench's end hides the lower part)
        const px = eastLocal < 0 ? c : a;
        const y1 = ((m.wallCabinet?.from ?? 1.8) + yF);
        F.box(FRONT_T, y1 - yF, d, px - Math.sign(px - cx) * (FRONT_T / 2), (yF + y1) / 2, 0, front);
      }
      continue;
    }
    // unknown module: a plain closed cabinet
    F.box(mw, tp - ph, cd, cx, (ph + tp) / 2, zc, carcass);
    F.box(mw - GAP, tp - ph - GAP, FRONT_T, cx, (ph + tp) / 2, zf - FRONT_T / 2, front);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Washer and dryer (white front loaders; the door of the washer closed, as the room is tidy)

function applianceBody(F, b, k, bodyHex) {
  const { w, d, h } = b.dims;
  const body = mat('plastic', bodyHex, { roughness: 0.38 });
  const yF = k.floorY ?? 0;
  const y0 = Math.max(0, yF) + 0.01; // small feet gap
  F.box(w - 0.006, h - 0.012, d - 0.01, 0, y0 + (h - 0.012) / 2, -0.005, body);
  F.box(w - 0.002, 0.012, d - 0.004, 0, y0 + h - 0.006, -0.002, body); // top
  return { body, y0, w, d, h };
}

/** @param {object} F @param {object} b @param {object} k */
export function buildWasher(F, b, k) {
  const bodyHex = hexOr(b.colors?.body, '#e6e2dc');
  const { body, y0, w, d, h } = applianceBody(F, b, k, bodyHex);
  const zf = d / 2;
  const seg = k.low ? 24 : 40;
  const panel = body;
  const dark = mat('plastic', DARK, { roughness: 0.9, flat: true });
  const grey = mat('plastic', '#b9bbbd', { roughness: 0.35 });
  const glass = mat('glass-smoked', '#2b2e31', { opacity: 0.8 });
  // control panel: detergent drawer (left), display, programme knob (right)
  const cy = y0 + h - 0.075;
  F.box(w - 0.02, 0.11, 0.012, 0, cy, zf, panel, { collide: false });
  F.box(0.2, 0.075, 0.006, -w / 2 + 0.13, cy, zf + 0.008, body, { collide: false });
  F.box(0.08, 0.008, 0.004, -w / 2 + 0.13, cy - 0.025, zf + 0.012, dark, { collide: false, castShadow: false });
  F.box(0.09, 0.03, 0.003, 0.03, cy + 0.01, zf + 0.0075, dark, { collide: false, castShadow: false });
  F.cylinder(0.03, 0.032, 0.025, w / 2 - 0.12, cy, zf + 0.0125, grey, { rot: [PI / 2, 0, 0], segments: 20, collide: false });
  // porthole door (closed): a white ring with its rim, a grey bezel, the smoked glass set in, the dark drum behind
  const dy = y0 + 0.42;
  const R = 0.19;
  const at = (z) => new THREE.Matrix4().makeTranslation(0, dy, z);
  const ring = new THREE.RingGeometry(R * 0.84, R, seg, 1);
  F.add(ring, body, { matrix: at(zf + 0.028), collide: false });
  ring.dispose();
  F.cylinder(R, R, 0.028, 0, dy, zf + 0.014, body, { rot: [PI / 2, 0, 0], segments: seg, openEnded: true, collide: false });
  const bez = new THREE.RingGeometry(R * 0.7, R * 0.84, seg, 1);
  F.add(bez, grey, { matrix: at(zf + 0.0285), collide: false, castShadow: false });
  bez.dispose();
  const disc = new THREE.CircleGeometry(R * 0.7, seg);
  F.add(disc, glass, { matrix: at(zf + 0.02), collide: false, castShadow: false });
  disc.dispose();
  const drum = new THREE.CircleGeometry(R * 0.68, seg);
  F.add(drum, dark, { matrix: at(zf + 0.001), collide: false, castShadow: false });
  drum.dispose();
  // handle at the door's right edge, service flap low right
  F.box(0.025, 0.07, 0.02, R - 0.01, dy, zf + 0.03, grey, { collide: false });
  F.box(0.16, 0.08, 0.003, w / 2 - 0.12, y0 + 0.07, zf + 0.0015, panel, { collide: false, castShadow: false });
}

/** @param {object} F @param {object} b @param {object} k */
export function buildDryer(F, b, k) {
  const bodyHex = hexOr(b.colors?.body, '#eceeef');
  const { body, y0, w, d, h } = applianceBody(F, b, k, bodyHex);
  const zf = d / 2;
  const seg = k.low ? 24 : 48;
  const panel = body;
  const dark = mat('plastic', DARK, { roughness: 0.9, flat: true });
  const grey = mat('plastic', '#b9bbbd', { roughness: 0.35 });
  // control panel with display (right) and programme knob (centre-left), a water tank drawer (left)
  const cy = y0 + h - 0.06;
  F.box(w - 0.02, 0.1, 0.012, 0, cy, zf, panel, { collide: false });
  F.box(0.17, 0.06, 0.006, -w / 2 + 0.11, cy, zf + 0.008, body, { collide: false });
  F.box(0.11, 0.035, 0.003, w / 2 - 0.13, cy + 0.008, zf + 0.0075, dark, { collide: false, castShadow: false });
  F.cylinder(0.026, 0.028, 0.02, 0.0, cy, zf + 0.012, grey, { rot: [PI / 2, 0, 0], segments: 20, collide: false });
  // big round door (white, slightly domed) with its embossed ring and handle recess
  const dy = y0 + 0.46;
  const R = 0.2;
  F.cylinder(R, R, 0.022, 0, dy, zf + 0.011, body, { rot: [PI / 2, 0, 0], segments: seg, collide: false });
  F.cylinder(R * 0.82, R * 0.9, 0.012, 0, dy, zf + 0.028, body, { rot: [PI / 2, 0, 0], segments: seg, collide: false });
  const emb = new THREE.RingGeometry(R * 0.24, R * 0.3, seg, 1);
  F.add(emb, grey, { matrix: new THREE.Matrix4().makeTranslation(0, dy, zf + 0.0345), collide: false, castShadow: false });
  emb.dispose();
  F.box(0.12, 0.02, 0.01, -R * 0.35, dy + R * 0.72, zf + 0.026, grey, { rot: [0, 0, 0.5], collide: false, castShadow: false });
  // condenser hatch below with a round grille
  F.box(w - 0.06, 0.16, 0.004, 0, y0 + 0.1, zf + 0.002, panel, { collide: false, castShadow: false });
  F.cylinder(0.045, 0.045, 0.003, w / 2 - 0.12, y0 + 0.1, zf + 0.0045, grey, { rot: [PI / 2, 0, 0], segments: 20, collide: false, castShadow: false });
}

/** Water heater (VB): a white cylinder with a grey top cap – built only when the data has a 'water-heater'. */
export function buildWaterHeater(F, b, k) {
  const { w, h } = b.dims;
  const white = mat('plastic', hexOr(b.colors?.body, '#efefec'), { roughness: 0.35 });
  const grey = mat('plastic', '#8d9093', { roughness: 0.5 });
  const r = w / 2;
  F.cylinder(r, r, h - 0.06, 0, (h - 0.06) / 2, 0, white, { segments: k.low ? 20 : 36 });
  F.cylinder(r * 0.97, r, 0.06, 0, h - 0.03, 0, grey, { segments: k.low ? 20 : 36, collide: false });
}

// ---------------------------------------------------------------------------------------------------------------
// Sliding wardrobe (the entrance): carcass with a dark inside, two mirror doors in black frames on two tracks, top and
// bottom rails

/** @param {object} F @param {object} b @param {object} k */
export function buildSlidingWardrobe(F, b, k) {
  const { w, d } = b.dims;
  const P = b.params || {};
  const C = b.colors || {};
  const yF = k.floorY ?? 0;
  const hEff = Math.min(b.dims.h, (k.ceilingY ?? b.dims.h) - 0.002);
  const prof = mat('black-metal', hexOr(C.profiles, '#1a1a1a'), { roughness: 0.45 });
  const inside = mat('painted', hexOr(C.inside, '#262626'), { roughness: 0.8 });
  const doorMat = C.doors === 'mirror' || !C.doors ? mat('mirror', '#e7e9e8', { roughness: 0.08 }) : mat('painted', hexOr(C.doors, '#d8d6d0'));
  // carcass: back, sides, top (dark inside)
  F.box(w, hEff - yF, 0.016, 0, (yF + hEff) / 2, -d / 2 + 0.008, inside, { castShadow: false });
  for (const s of [-1, 1]) F.box(0.019, hEff - yF, d, s * (w / 2 - 0.0095), (yF + hEff) / 2, 0, inside);
  // rails
  const railH = P.topRail === false ? 0 : 0.055;
  const botH = P.bottomRail === false ? 0 : 0.025;
  if (railH) F.box(w, railH, 0.09, 0, hEff - railH / 2, d / 2 - 0.045, prof, { collide: false });
  if (botH) F.box(w, botH, 0.09, 0, yF + botH / 2, d / 2 - 0.045, prof, { collide: false });
  // doors: n leaves on alternate tracks, overlapping 3 cm, closed
  const n = Math.max(1, P.doors ?? 2);
  const ov = 0.03;
  const dw = (w - 0.04 + ov * (n - 1)) / n;
  const dh = hEff - railH - botH - 0.006;
  const fr = 0.022;
  for (let i = 0; i < n; i++) {
    const x0 = -w / 2 + 0.02 + i * (dw - ov);
    const cx = x0 + dw / 2;
    const z = d / 2 - (i % 2 === 0 ? 0.025 : 0.06);
    const cy = yF + botH + 0.003 + dh / 2;
    F.box(dw - 2 * fr, dh - 2 * fr, 0.006, cx, cy, z, doorMat, { collide: false });
    F.box(dw, fr, 0.02, cx, cy + dh / 2 - fr / 2, z, prof, { collide: false });
    F.box(dw, fr, 0.02, cx, cy - dh / 2 + fr / 2, z, prof, { collide: false });
    for (const s of [-1, 1]) F.box(fr, dh, 0.02, cx + s * (dw / 2 - fr / 2), cy, z, prof, { collide: false });
  }
}

/** Builders of this module by builtIns type (builtins.js dispatches on them). */
export const LAUNDRY_BUILDERS = Object.freeze({
  'laundry-bench': buildLaundryBench,
  'cabinet-row': buildCabinetRow,
  washer: buildWasher,
  dryer: buildDryer,
  'water-heater': buildWaterHeater,
  'wardrobe-sliding': buildSlidingWardrobe,
});
