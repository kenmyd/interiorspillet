// Kitchens of generated houses (notes/kjokken-bad-genererte-hus.md): the bench along a wall (benkerad), the island,
// the wall cabinets (overskap), the hood, the tall units (høyskap, kjøleskap, fryser, kombiskap, ovnsskap) and the
// appliances that stand in a bench – sink, dishwasher, hob, oven, an under-counter fridge or freezer – as its slots
// (builtinplan.js: b.slots, local x ranges). The owner's kitchen is kitchen.js's (layout.kitchen.items); these
// builders reuse the parts it shares with the wet rooms (fittings.js: the handle-less base run with its grip channels,
// the worktop with the sink cut-out, the inset sink, the tap) and the laundry's composite sink material.
//
// Same conventions as bathroom.js: build<Type>(F, b, k) in the built-in's local frame (origin = middle of the
// footprint on its underside, +z = front, dims.w along x, y = 0 the entry's position.y). Nothing here makes a canvas,
// so the kitchen builds in Node as well (tools/house-tests/kjokkenbad.test.mjs).
import * as THREE from 'three';
import { mat } from './materials.js';
import { surfaceFinish, cloudContrast } from '../world/surfaces.js';
import { FRONT_T, GAP, baseRun, makeWorktop, makeSink, makeTap } from './fittings.js';
import { sinkMaterial } from './laundry.js';
import { DARK } from './bathroom.js';

const PI = Math.PI;
const hexOr = (v, fb) => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v : fb);
const shade = (hex, f) => `#${new THREE.Color(hex).multiplyScalar(f).getHexString()}`;

/** Materials of a kitchen entry (b.colors: fronts, top, handles, sink, tap; params.top.clouds). All cached. */
function kitchenMaterials(b) {
  const C = b.colors || {};
  const P = b.params || {};
  const frontHex = hexOr(C.fronts, '#e8e6e1');
  const topHex = hexOr(C.top, '#8e8780');
  let top = null;
  try {
    top = surfaceFinish('laminate', topHex, { clouds: cloudContrast(topHex, P.top?.clouds, 'stone') ?? 1.4 });
  } catch {
    top = null; // no texture support
  }
  const sinkHex = hexOr(C.sink, '#1c1c1c');
  return {
    front: mat('painted', frontHex, { roughness: 0.55 }),
    channel: mat('painted', '#161617', { roughness: 0.85, flat: true }),
    plinth: mat('painted', shade(frontHex, 0.55), { roughness: 0.8 }),
    carcass: mat('painted', shade(frontHex, 0.8), { roughness: 0.7 }),
    top: top ?? mat('painted', topHex, { roughness: 0.5 }),
    handle: mat('black-metal', hexOr(C.handles, '#1a1a1a'), { roughness: 0.4 }),
    steel: mat('steel', '#b0b3b6'),
    tap: C.tap === 'steel' ? mat('steel', '#c4c6c8') : mat('black-metal', hexOr(C.tap, '#151515'), { roughness: 0.32 }),
    basin: sinkMaterial(sinkHex),
    sinkTop: mat('plastic', sinkHex, { roughness: 0.6 }),
    vent: mat('plastic', DARK, { roughness: 0.9, flat: true }),
    glass: mat('lacquer', '#0c0c0e', { roughness: 0.08 }),
    ring: mat('plastic', '#55585c', { roughness: 0.5 }),
  };
}

/** Grip channels of a base run whose worktop underside is at yT (the kitchen's, scaled to the bench's height). */
function channelsFor(yT, plinth = 0.1) {
  const mid = plinth + (yT - plinth) * 0.47;
  return { top: [yT - 0.04, yT], mid: [mid - 0.02, mid + 0.02], plinth };
}

/** Bar handle along x (horizontal) or y (vertical) on two short legs, standing off the front at zf. */
function barHandle(F, x, y, zf, len, vertical, M) {
  if (vertical) F.box(0.012, len, 0.012, x, y, zf + 0.024, M, { collide: false });
  else F.box(len, 0.012, 0.012, x, y, zf + 0.024, M, { collide: false });
  for (const s of [-1, 1]) {
    const dx = vertical ? 0 : s * (len / 2 - 0.015), dy = vertical ? s * (len / 2 - 0.015) : 0;
    F.box(0.01, 0.01, 0.024, x + dx, y + dy, zf + 0.012, M, { collide: false });
  }
}

/** An oven (or microwave) front x0..x1 × y0..y1 at the front plane zf: black glass, a steel handle, the display. */
function ovenFront(F, x0, x1, y0, y1, zf, M, { microwave = false } = {}) {
  const w = x1 - x0 - GAP, h = y1 - y0 - GAP, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  F.box(w, h, FRONT_T + 0.004, cx, cy, zf + (FRONT_T + 0.004) / 2, M.glass);
  // the window (darker) and the control strip over it
  const strip = Math.min(0.08, h * 0.18);
  F.box(w - 0.12, h - strip - 0.1, 0.002, cx - (microwave ? 0.06 : 0), cy - strip / 2 - 0.02, zf + FRONT_T + 0.005, M.vent, { collide: false, castShadow: false });
  F.box(0.08, 0.018, 0.002, cx + w / 2 - 0.12, y1 - strip / 2 - GAP, zf + FRONT_T + 0.005, M.ring, { collide: false, castShadow: false });
  if (microwave) barHandle(F, x1 - 0.06, cy, zf + FRONT_T, Math.min(0.24, h - 0.08), true, M.steel);
  else barHandle(F, cx, y1 - strip - 0.03, zf + FRONT_T, w - 0.12, false, M.steel);
}

// ---------------------------------------------------------------------------------------------------------------
// Bench and island

/**
 * The base units of a bench of width w: the slots' units (oven, dishwasher, sink → a door, an under-counter fridge /
 * freezer → one integrated front, a hob over drawers unless it stands over an oven) and the rest filled with drawer
 * units of about 0.6 m. Returns [{ x0, x1, kind }] sorted, kind 'drawers' | 'door' | 'integrated' | 'oven'.
 */
export function benchUnits(w, slots = [], end = 0.016) {
  const lo = -w / 2 + end, hi = w / 2 - end;
  const KIND = { oven: 'oven', dishwasher: 'integrated', fridge: 'integrated', freezer: 'integrated', sink: 'door' };
  const fixed = [];
  for (const s of [...slots].sort((a, b) => a.x0 - b.x0)) {
    const kind = KIND[s.type];
    if (!kind) continue;
    const prev = fixed[fixed.length - 1];
    let x0 = Math.max(lo, s.x0), x1 = Math.min(hi, s.x1);
    if (prev && x0 < prev.x1) {
      // the oven under the hob, the sink over a door: one unit; else the later moves on
      if (Math.min(prev.x1, x1) - x0 > 0.5 * (x1 - x0)) {
        if (kind === 'oven') prev.kind = 'oven';
        continue;
      }
      x0 = prev.x1;
    }
    if (x1 - x0 > 0.15) fixed.push({ x0, x1, kind, slot: s.id });
  }
  for (const s of slots) {
    if (s.type !== 'hob') continue;
    if (fixed.some((u) => Math.min(u.x1, s.x1) - Math.max(u.x0, s.x0) > 0.1)) continue;
    const x0 = Math.max(lo, s.x0), x1 = Math.min(hi, s.x1);
    if (x1 - x0 > 0.15 && !fixed.some((u) => x0 < u.x1 - 1e-6 && x1 > u.x0 + 1e-6)) fixed.push({ x0, x1, kind: 'drawers', slot: s.id });
  }
  fixed.sort((a, b) => a.x0 - b.x0);
  const units = [];
  let x = lo;
  const fill = (a, b) => {
    if (b - a < 0.05) {
      // a sliver: widen the neighbour
      if (units.length) units[units.length - 1].x1 = b;
      return;
    }
    const n = Math.max(1, Math.round((b - a) / 0.6));
    for (let i = 0; i < n; i++) units.push({ x0: a + ((b - a) * i) / n, x1: a + ((b - a) * (i + 1)) / n, kind: (b - a) / n < 0.42 ? 'door' : 'drawers' });
  };
  for (const u of fixed) {
    if (u.x0 > x) fill(x, u.x0);
    units.push({ ...u });
    x = Math.max(x, u.x1);
  }
  if (hi > x) fill(x, hi);
  return units;
}

/**
 * Kitchen bench (benkerad, mount 'wall') or island (type 'kitchen-island', mount 'floor'): base units from the slots,
 * end panels, the worktop (with the sink's cut-out), the sink and tap, the hob on the worktop. The island's units face
 * +z and take params.depth (0.6) of its depth; the rest is the overhang on the back (seats), closed by a back panel.
 * params: plinth (0.1), top { thickness (0.03), clouds }, depth (island cabinets), backsplash (builtinplan.js).
 * @param {object} F @param {object} b @param {object} k
 */
export function buildKitchenBench(F, b, k) {
  const { w, d, h } = b.dims;
  const P = b.params || {};
  const island = b.type === 'kitchen-island' || P.island === true;
  const M = kitchenMaterials(b);
  const t = P.top?.thickness ?? 0.03;
  const yT = h - t;
  const ch = channelsFor(yT, P.plinth ?? 0.1);
  const over = 0.02; // worktop over the fronts
  const zFace = d / 2 - over; // fronts' face
  const depth = island ? Math.min(P.depth ?? 0.6, d - over) : d - over; // carcass + fronts
  const zf = zFace - FRONT_T; // carcass front plane (fittings.baseRun)
  const zBack = zFace - depth;
  const endT = 0.016;
  const slots = b.slots || [];
  const units = benchUnits(w, slots, endT);
  // runs of plain units through baseRun; the oven's unit on its own
  const plainKind = { drawers: 'skuffer', door: 'dører', integrated: 'oppvaskmaskin' };
  let run = [];
  const flush = () => {
    if (run.length) baseRun(F, run, zf, depth, { M, ch });
    run = [];
  };
  for (const u of units) {
    if (u.kind !== 'oven') {
      run.push([u.x0, u.x1, plainKind[u.kind]]);
      continue;
    }
    flush();
    // the oven unit: the carcass and plinth as baseRun's, the oven at the top, a drawer under it
    const L = u.x1 - u.x0, xm = (u.x0 + u.x1) / 2;
    const cd = depth - FRONT_T - 0.03;
    F.box(L, ch.top[1] - ch.plinth, cd, xm, ch.plinth + (ch.top[1] - ch.plinth) / 2, zf - 0.03 - cd / 2, M.channel);
    F.box(L, ch.plinth, depth - 0.08, xm, ch.plinth / 2, zf + FRONT_T - 0.08 - (depth - 0.08) / 2, M.plinth);
    const oy1 = ch.top[0], oy0 = Math.max(ch.plinth + 0.18, oy1 - 0.6);
    ovenFront(F, u.x0, u.x1, oy0, oy1, zf, M);
    if (oy0 - ch.plinth > 0.06) F.box(L - GAP, oy0 - ch.plinth - GAP, FRONT_T, xm, (oy0 + ch.plinth) / 2, zf + FRONT_T / 2, M.front);
  }
  flush();
  // end panels (front colour, the carcass depth, to the worktop)
  for (const s of [-1, 1]) F.box(endT, yT, depth, s * (w / 2 - endT / 2), yT / 2, zFace - depth / 2, M.front);
  if (island) {
    // the island's back: a panel behind the cabinets, the overhang open under the worktop
    F.box(w, yT, FRONT_T, 0, yT / 2, zBack - FRONT_T / 2, M.front);
  }
  // worktop with the sink's cut-out
  const sink = slots.find((s) => s.type === 'sink');
  const zc = zFace - depth / 2 + 0.02; // middle of the cabinets (a little toward the front)
  let hole = null;
  if (sink) {
    const double = sink.params?.bowls === 2 || sink.params?.double === true;
    const sw = Math.min(sink.x1 - sink.x0 - 0.04, sink.params?.w ?? (double ? 0.78 : 0.5));
    const sd = Math.min(depth - 0.16, sink.params?.d ?? 0.42);
    hole = { x: (sink.x0 + sink.x1) / 2, z: zc, w: sw, d: sd, r: 0.02, double };
  }
  makeWorktop(F, { x0: -w / 2, x1: w / 2, z0: -d / 2, z1: d / 2, y0: yT, t }, M.top, { hole });
  if (hole) {
    const basins = hole.double ? [[hole.x - hole.w / 4, hole.w / 2 - 0.012], [hole.x + hole.w / 4, hole.w / 2 - 0.012]] : [[hole.x, hole.w]];
    for (const [x, bw] of basins) makeSink(F, { x, z: hole.z, w: bw, d: hole.d, h: 0.19, topY: h }, { basin: M.basin, steel: M.steel, vent: M.vent });
    if (hole.double) F.box(0.026, 0.012, hole.d, hole.x, h - 0.006, hole.z, M.sinkTop, { collide: false });
    makeTap(F, { x: hole.x, z: hole.z - hole.d / 2 - 0.035, topY: h, h: 0.33 }, M.tap, { low: k.low });
  }
  for (const s of slots) if (s.type === 'hob') buildHob(F, (s.x0 + s.x1) / 2, h, zc, Math.min(s.x1 - s.x0 - 0.02, 0.58), Math.min(depth - 0.08, 0.51), M, k.low);
}

/** Induction hob on the worktop: a black glass slab with four zone rings and the control strip at the front. */
function buildHob(F, x, topY, z, w, d, M, low) {
  F.box(w, 0.006, d, x, topY + 0.003, z, M.glass, { collide: false });
  const seg = low ? 32 : 56;
  const y = topY + 0.0062;
  const zones = [[-w / 4, -d / 4 + 0.01, 0.085], [w / 4, -d / 4 + 0.01, 0.075], [-w / 4, d / 4 - 0.02, 0.075], [w / 4, d / 4 - 0.02, 0.1]];
  for (const [dx, dz, r] of zones) {
    const ring = new THREE.RingGeometry(r - 0.004, r, seg, 1);
    ring.rotateX(-PI / 2);
    F.add(ring, M.ring, { matrix: new THREE.Matrix4().makeTranslation(x + dx, y, z + dz), collide: false, castShadow: false });
    ring.dispose();
  }
  F.box(w * 0.5, 0.0004, 0.03, x, y, z + d / 2 - 0.03, M.ring, { collide: false, castShadow: false });
}

/** A slot type without a bench round it (a dishwasher drawn alone …): a short bench of its own with it in it. */
export function buildSlotAlone(F, b, k) {
  const w = b.dims.w;
  buildKitchenBench(F, { ...b, type: 'kitchen-bench', dims: { ...b.dims, h: Math.max(0.85, b.dims.h || 0.9) }, slots: [{ id: b.id, type: b.type, x0: -w / 2, x1: w / 2, params: b.params || {} }] }, k);
}

// ---------------------------------------------------------------------------------------------------------------
// Wall cabinets and hood

/**
 * Wall cabinets (overskap, mount 'wall', position y = underside): carcass, doors of about 0.6 (params.doors), a
 * short grip rail under each door unless params.handles === false, a filler to the ceiling with params.toCeiling.
 * @param {object} F @param {object} b @param {object} k
 */
export function buildWallCabinets(F, b, k) {
  const { w, d, h } = b.dims;
  const P = b.params || {};
  const M = kitchenMaterials(b);
  const zf = d / 2 - FRONT_T;
  F.box(w - 0.002, h, d - FRONT_T, 0, h / 2, -d / 2 + (d - FRONT_T) / 2, M.carcass);
  const n = Math.max(1, P.doors ?? Math.round(w / 0.6));
  const dw = w / n;
  for (let i = 0; i < n; i++) {
    const cx = -w / 2 + dw * (i + 0.5);
    F.box(dw - GAP, h - GAP, FRONT_T, cx, h / 2, zf + FRONT_T / 2, M.front);
    if (P.handles !== false) F.box(Math.min(0.2, dw - 0.12), 0.01, 0.014, cx, 0.035, zf + FRONT_T + 0.007, M.handle, { collide: false });
  }
  const ceil = k.ceilingY;
  if (P.toCeiling && Number.isFinite(ceil) && ceil - h > 0.02) F.box(w, ceil - h - 0.002, d, 0, h + (ceil - h - 0.002) / 2, 0, M.front, { collide: false });
}

/**
 * Hood (ventilator, mount 'wall', position y = underside): a slim canopy and its chimney to the ceiling, in steel
 * (colors.body: a colour → painted).
 * @param {object} F @param {object} b @param {object} k
 */
export function buildHood(F, b, k) {
  const { w, d, h } = b.dims;
  const body = b.colors?.body ? mat('painted', hexOr(b.colors.body, '#2a2a2b'), { roughness: 0.5 }) : mat('steel', '#b8bbbe');
  const dark = mat('plastic', DARK, { roughness: 0.9, flat: true });
  const ct = 0.05;
  F.box(w, ct, d, 0, ct / 2, 0, body);
  F.box(w - 0.04, 0.002, d - 0.06, 0, -0.001, 0.01, dark, { collide: false, castShadow: false }); // the filter
  const top = Number.isFinite(k.ceilingY) ? Math.max(h, k.ceilingY - 0.002) : h;
  const cw = Math.min(0.3, w * 0.5), cdp = Math.min(0.26, d * 0.6);
  F.box(cw, top - ct, cdp, 0, ct + (top - ct) / 2, -d / 2 + cdp / 2, body);
}

// ---------------------------------------------------------------------------------------------------------------
// Tall units

/**
 * Tall unit (mount 'wall'): type 'tall-cabinet' (two doors), 'fridge' / 'freezer' (one integrated door), 'fridge-freezer'
 * (fridge door over the freezer's), 'oven-tower' (drawers, the oven at working height, the microwave over it, a door
 * to the top). Recessed plinth, bar handles, a filler to the ceiling when it is less than 0.4 m away (params.toCeiling
 * true / false decides).
 * @param {object} F @param {object} b @param {object} k
 */
export function buildTallUnit(F, b, k) {
  const { w, d } = b.dims;
  const P = b.params || {};
  const M = kitchenMaterials(b);
  const ceil = Number.isFinite(k.ceilingY) ? k.ceilingY : Infinity;
  const h = Math.min(b.dims.h, ceil - 0.002);
  const ph = P.plinth ?? 0.1;
  const zf = d / 2 - FRONT_T;
  F.box(w - 0.002, h - ph, d - FRONT_T, 0, ph + (h - ph) / 2, -FRONT_T / 2, M.carcass);
  F.box(w - 0.004, ph, d - 0.07, 0, ph / 2, -0.035, M.plinth, { castShadow: false });
  const fw = w - GAP;
  const door = (y0, y1, handleAt) => {
    F.box(fw, y1 - y0 - GAP, FRONT_T, 0, (y0 + y1) / 2, zf + FRONT_T / 2, M.front);
    if (handleAt != null) barHandle(F, w / 2 - 0.05, handleAt, zf + FRONT_T, Math.min(0.3, (y1 - y0) * 0.5), true, M.handle);
  };
  const kind = b.type;
  if (kind === 'oven-tower') {
    const o0 = Math.min(h - 0.8, 0.78), o1 = o0 + 0.6, m1 = Math.min(h - 0.12, o1 + 0.38);
    door(ph, o0, null);
    F.box(0.2, 0.012, 0.012, 0, o0 - 0.05, zf + FRONT_T + 0.024, M.handle, { collide: false });
    ovenFront(F, -w / 2, w / 2, o0, o1, zf, M);
    if (m1 - o1 > 0.2) ovenFront(F, -w / 2, w / 2, o1, m1, zf, M, { microwave: true });
    if (h - m1 > 0.1) door(m1, h, m1 + 0.06);
  } else if (kind === 'fridge-freezer') {
    const s = ph + (h - ph) * 0.42;
    door(ph, s, s - 0.12);
    door(s, h, s + 0.12);
  } else if (kind === 'fridge' || kind === 'freezer') {
    door(ph, h, ph + (h - ph) * 0.55);
    // the ventilation grille in the plinth
    F.box(w - 0.08, 0.03, 0.004, 0, ph / 2, d / 2 - 0.068, M.vent, { collide: false, castShadow: false });
  } else {
    const s = Math.min(h - 0.3, ph + 1.3);
    door(ph, s, s - 0.15);
    door(s, h, s + 0.15);
  }
  const fill = P.toCeiling ?? ceil - b.dims.h < 0.4;
  if (fill && Number.isFinite(ceil) && ceil - b.dims.h > 0.01) F.box(w, ceil - b.dims.h - 0.002, d, 0, b.dims.h + (ceil - b.dims.h - 0.002) / 2, 0, M.front, { collide: false });
}

/** Builders of this module by builtIns type (builtins.js dispatches on them). */
export const KITCHEN_BUILDERS = Object.freeze({
  'kitchen-bench': buildKitchenBench,
  'kitchen-island': buildKitchenBench,
  'wall-cabinets': buildWallCabinets,
  hood: buildHood,
  'tall-cabinet': buildTallUnit,
  fridge: (F, b, k) => ((b.dims?.h ?? 2) > 1.0 ? buildTallUnit(F, b, k) : buildSlotAlone(F, b, k)),
  freezer: (F, b, k) => ((b.dims?.h ?? 2) > 1.0 ? buildTallUnit(F, b, k) : buildSlotAlone(F, b, k)),
  'fridge-freezer': buildTallUnit,
  'oven-tower': buildTallUnit,
  sink: buildSlotAlone,
  dishwasher: buildSlotAlone,
  hob: buildSlotAlone,
  oven: buildSlotAlone,
});
