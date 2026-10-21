// Fittings shared by the kitchen and the wet rooms (notes/hele-huset-design.md §2.1): the handle-less base-cabinet run,
// the worktop with a sink cut-out, the inset sink (an open box seen from inside) and the taps. Pulled out of the
// closures in kitchen.js unchanged – the kitchen builds exactly the same geometry in the same order as before (image
// diff 0, tools/refcheck.mjs) – and reused by laundry.js (the bench in the basement laundry) and bathroom.js (the
// basin tap of the vanity).
//
// Every helper adds parts to a MeshBatcher or a BatchFrame (world/buildKit.js) in the caller's frame: +z is the
// front (the side you stand on), y up, metres. Materials are passed in (no material is made here), so the helpers run
// in Node as well (tools/house-tests/bathroom.test.mjs).
import * as THREE from 'three';
import { place } from '../world/buildKit.js';
import { tube } from '../models/kit.js';

/** Gap between two fronts. */
export const GAP = 0.003;
/** Front (door / drawer) thickness. */
export const FRONT_T = 0.019;
/**
 * The kitchen's grip channels: L-channel under the worktop (top), C-channel between the drawer rows (mid), plinth
 * height (k-benk and the island).
 */
export const KITCHEN_CHANNELS = Object.freeze({ top: Object.freeze([0.85, 0.89]), mid: Object.freeze([0.49, 0.53]), plinth: 0.13 });

/**
 * One run of handle-less base fronts along +x in a frame whose +z is the front, x from x0 to x1, front plane at z = zf:
 * a dark carcass set 3 cm behind the fronts (the grip channels and gaps read as deep dark lines), the plinth recessed
 * 8 cm, and per unit one door or two drawer rows split by the C-channel.
 * @param {object} F       MeshBatcher | BatchFrame
 * @param {Array<[number, number, string]>} units  [[x0, x1, kind]] (kind 'dører' → one door, 'oppvaskmaskin' → one
 *                                                 integrated front, others → two rows)
 * @param {number} zf      front plane (the carcass front; the fronts stand FRONT_T in front of it)
 * @param {number} depth
 * @param {{ endPanels?: Array<[number, number]>, M: { front, channel, plinth }, ch?: { top: number[], mid: number[], plinth: number } }} o
 */
export function baseRun(F, units, zf, depth, { endPanels = [], M, ch = KITCHEN_CHANNELS } = {}) {
  const CH = ch;
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

/**
 * Worktop slab x0..x1 × z0..z1, from y0 up by t, with an optional rounded sink cut-out; UVs in metres of the frame
 * (worktopUV: the veins along x). Same construction as the kitchen's (a Shape in (x, −z) extruded and laid flat).
 * @param {object} kb        MeshBatcher | BatchFrame
 * @param {{ x0: number, x1: number, z0: number, z1: number, y0: number, t: number }} box
 * @param {THREE.Material} material
 * @param {{ hole?: { x: number, z: number, w: number, d: number, r?: number }|null, curveSegments?: number }} [o]
 */
export function makeWorktop(kb, { x0, x1, z0, z1, y0, t }, material, { hole = null, curveSegments = 6 } = {}) {
  const shape = new THREE.Shape([new THREE.Vector2(x0, -z0), new THREE.Vector2(x1, -z0), new THREE.Vector2(x1, -z1), new THREE.Vector2(x0, -z1)]);
  if (hole) {
    const p = new THREE.Path();
    roundRect(p, hole.x - hole.w / 2, -(hole.z + hole.d / 2), hole.w, hole.d, hole.r ?? 0.03);
    shape.holes.push(p);
  }
  const g = new THREE.ExtrudeGeometry(shape, { depth: t, bevelEnabled: false, curveSegments });
  g.rotateX(-Math.PI / 2);
  g.translate(0, y0, 0);
  worktopUV(g);
  kb.add(g, material, { collide: false });
  g.dispose();
}

/**
 * Inset sink: an open box seen from inside (its material should render the back faces, like the kitchen's basin) under
 * the worktop surface at topY, with a steel drain and its dark centre a quarter of the width toward +x.
 * @param {object} kb   MeshBatcher | BatchFrame
 * @param {{ x: number, z: number, w: number, d: number, h: number, topY: number }} s  centre (x, z), outer size, depth
 * @param {{ basin: THREE.Material, steel: THREE.Material, vent: THREE.Material }} M
 */
export function makeSink(kb, { x, z, w, d, h, topY }, M) {
  const sw = w - 0.004, sd = d - 0.004, sh = h;
  const bg = new THREE.BoxGeometry(sw, sh, sd);
  kb.add(bg, M.basin, { matrix: place(x, topY - sh / 2 - 0.0005, z), collide: false, boxUV: true });
  bg.dispose();
  kb.cylinder(0.04, 0.04, 0.003, x + sw / 4, topY - sh + 0.002, z, M.steel, { segments: 20, collide: false, castShadow: false });
  kb.cylinder(0.02, 0.02, 0.004, x + sw / 4, topY - sh + 0.003, z, M.vent, { segments: 16, collide: false, castShadow: false });
}

/**
 * Single-lever tap standing on a surface at (x, topY, z), the spout reaching toward +z.
 *   style 'kitchen' (default): round base, high J-spout of height h (≈ 0.35), lever on the +x side (the kitchen's tap);
 *   style 'basin': a short straight body with a short spout and a lever on top (a basin mixer, h ≈ 0.16).
 * @param {object} kb   MeshBatcher | BatchFrame
 * @param {{ x: number, z: number, topY: number, h?: number, style?: 'kitchen'|'basin' }} p
 * @param {THREE.Material} material
 * @param {{ low?: boolean }} [o]
 */
export function makeTap(kb, { x, z, topY, h, style = 'kitchen' }, material, { low = false } = {}) {
  const ty = topY;
  if (style === 'basin') {
    const bh = h ?? 0.16;
    const r = 0.022;
    kb.cylinder(r, r + 0.002, bh, x, ty + bh / 2, z, material, { segments: low ? 12 : 20, collide: false });
    // spout: a short flat-ish tube out of the front, slightly down
    const spout = tube([[x, ty + bh - 0.035, z], [x, ty + bh - 0.04, z + 0.06], [x, ty + bh - 0.055, z + 0.11]], 0.011, { radial: low ? 8 : 12, seg: low ? 6 : 10, curve: 'line' });
    kb.add(spout, material, { collide: false });
    spout.dispose();
    // lever on top, pointing back
    kb.box(0.016, 0.012, 0.06, x, ty + bh + 0.006, z - 0.018, material, { rot: [0.12, 0, 0], collide: false });
    return;
  }
  const th = h ?? 0.35;
  kb.cylinder(0.024, 0.026, 0.035, x, ty + 0.0175, z, material, { segments: 20, collide: false });
  const spout = tube([
    [x, ty + 0.03, z],
    [x, ty + th - 0.06, z],
    [x, ty + th - 0.005, z + 0.03],
    [x, ty + th - 0.02, z + 0.13],
    [x, ty + th - 0.09, z + 0.2],
    [x, ty + th - 0.13, z + 0.205],
  ], 0.012, { radial: low ? 8 : 14, seg: low ? 24 : 48 });
  kb.add(spout, material, { collide: false });
  spout.dispose();
  kb.box(0.012, 0.012, 0.075, x + 0.03, ty + 0.11, z + 0.012, material, { rot: [-0.35, 0, 0], collide: false });
  kb.cylinder(0.014, 0.014, 0.03, x + 0.03, ty + 0.1, z, material, { rot: [0, 0, Math.PI / 2], segments: 14, collide: false });
}

/** Rounded rectangle path (x, y = lower-left corner). */
export function roundRect(p, x, y, w, h, r) {
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

/** Worktop UVs in metres: top/bottom (x, z) with the veins along x, edges (along, y). */
export function worktopUV(g) {
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
