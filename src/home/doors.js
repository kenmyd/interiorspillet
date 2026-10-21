// DOORS – the hinged doors of the house (notes/hele-huset-design.md §2.1, §3.9–3.10; hele-huset-avstemming.md V27,
// V47–V49, §5.1), generalised from the shell's hall door (shell.js): world/Door.js does the swing, the collision and the
// interaction; this file gives each door its own leaf, karm (reveal lining + casing), door stops, hardware, threshold
// and the walkable floor strip in the hole.
//
//   buildDoor(ctx, d, { layout, M, batch, batchers }) → { door, info, colliders }
//
// d        a layout.house.doors entry (owner wall's opening with door:{…}: hinge, swing, leaf, openAngleDeg, casing,
//          connects, interactive, basis …). Door frame: origin = bottom centre of the hole on the owner wall's room
//          face, x = right (along the wall), y = up, z = into the owner room ('front'); the wall is z ∈ [−depth, 0].
// M        the shell's shared materials (hallDoor, hallDoorGroove, hardware, gasket, threshold …)
// batch    MeshBatcher for the static karm (merged with the builder's walls, collides like them)
// batchers the builder's list of { geometries } to dispose (the leaf kits are pushed here)
//
// Leaf styles (from the data): the black interior doors – a flat leaf with one routed panel groove ~11 cm in, round
// roses only (door-gang, door.hardware.type 'rose-only') or a lever on a round / oblong rose (V47) with an optional
// WC turn or key escutcheon; the outer door (an exterior wall, door-ute) – a smooth flat anthracite leaf with levers,
// the keypad lock plate outside and three steel hinges (V27).
// The labels of the prompt are the room names of `connects` (frontLabel: the room behind the door seen from the
// front = the other room, backLabel: the owner room). The floor strip (§3.10) is a static box under the hole across
// the wall's thickness, top flush with the floor – without it the capsule sinks into the gap of a thick wall.
// Door.onChange asks the LightManager for a new shadow map (§4.17) – four times per swing at most.
import * as THREE from 'three';
import { basis, MeshBatcher } from '../world/buildKit.js';
import { mat } from './materials.js';
import { ring } from './wallkit.js';
import { Door } from '../world/Door.js';

const HALL_DOOR = '#1d1e21';
/** Holes narrower than this get side karms that collide only with their outer NARROW_KARM (D11: bod-1 can be entered). */
const NARROW_DOOR = 0.85;
const NARROW_KARM = 0.02;

/** Name of a room for the door prompt ('ute' and unknown ids: «Ute»). */
function roomLabel(layout, id) {
  if (!id) return null;
  if (id === 'ute') return 'Ute';
  return layout?.house?.roomsById?.[id]?.name ?? null;
}

/** Hardware material of a door (black by default; «brushed-steel» → steel). */
function hardwareMaterial(M, hw) {
  const fin = String(hw?.finish ?? 'black');
  if (/steel|stål/i.test(fin)) return mat('steel', hw?.color ?? '#8e8e8c', { roughness: 0.35 });
  if (/^#/.test(fin) && fin.toLowerCase() !== '#1a1a1a') return mat('black-metal', fin, { roughness: 0.35 });
  return M.hardware;
}

/** Threshold colours { top, front, back, depth } from the data (a plain colour = top, V48). */
function thresholdOf(door) {
  const t = door?.threshold;
  if (!t) return { top: null };
  if (typeof t === 'string') return { top: t };
  return { top: t.top ?? null, front: t.front ?? null, back: t.back ?? null, depth: t.depth ?? null };
}

/** A threshold material: light / wood tones as oak (the hall door's), grey metal as steel, dark as painted. */
function thresholdMaterial(M, hex) {
  if (!hex) return M.threshold;
  const c = new THREE.Color(hex);
  const hsl = {};
  c.getHSL(hsl);
  if (hex.toLowerCase() === '#cdbfae') return M.threshold;
  if (hsl.l > 0.55 && hsl.s < 0.12) return mat('steel', hex, { roughness: 0.4 });
  if (hsl.l > 0.4) return mat('oak', hex, { roughness: 0.55 });
  return mat('painted', hex, { roughness: 0.5 });
}

/**
 * Builds one door.
 * @param {object} ctx  createHome ctx (collision, interaction, events, camera, lighting later)
 * @param {object} d    layout.house.doors entry
 * @param {{ layout: object, M: object, batch: MeshBatcher, batchers: Array }} o
 * @returns {{ door: Door, info: object, colliders: THREE.Box3[] }}
 */
export function buildDoor(ctx, d, { layout, M, batch, batchers }) {
  const H = layout.house;
  const wall = H?.wallsById?.[d.wallId] ?? layout.wallsById?.[d.wallId] ?? null;
  const hinge = d.hinge === 'to' ? 1 : -1;
  const swing = d.swing === 'in' ? 1 : -1;
  const outer = !!(wall?.exterior && (wall?.thickness ?? 0) >= 0.2);
  const leafColor = d.door?.leafColor ?? HALL_DOOR;
  const leafMat = leafColor.toLowerCase() === HALL_DOOR ? M.hallDoor : mat('painted', leafColor, { roughness: outer ? 0.6 : 0.4 });
  const frameColor = d.frame?.color ?? leafColor;
  const frameMat = frameColor.toLowerCase() === HALL_DOOR ? M.hallDoor : mat('painted', frameColor, { roughness: 0.45 });
  const hwMat = hardwareMaterial(M, d.door?.hardware);
  const dm = { leaf: leafMat, frame: frameMat, hardware: hwMat, dark: M.gasket };
  const matrix = basis(d.basis.xAxis, d.basis.yAxis, d.basis.zAxis, d.basis.origin);
  const fw = d.frame?.width ?? 0.07;
  const lw = d.leaf?.w ?? d.width - 2 * fw;
  const lh = (d.leaf?.h ?? d.height - fw) - 0.008;
  const depth = wall?.thickness || 0.1;
  const other = (d.connects || []).find((id) => id !== d.roomId) ?? null;
  const door = new Door(ctx, {
    id: d.id,
    matrix,
    width: lw + 0.076,
    height: lh + 0.046,
    depth,
    materials: dm,
    hingeSide: hinge,
    swing,
    openAngleDeg: d.openAngleDeg ?? d.door?.openAngleDeg ?? 90,
    frontLabel: roomLabel(layout, other),
    backLabel: roomLabel(layout, d.roomId),
    threshold: false,
    locked: !!d.locked,
    interactive: d.interactive !== false,
    duration: outer ? 0.9 : 0.7,
  });
  replaceLeaf(door, outer ? outerLeaf(d, lw, lh, swing, hinge, dm, batchers) : interiorLeaf(d, lw, lh, swing, hinge, M, dm, batchers));

  // karm: lining of the reveal (2 cm casing proud on the sides that have one), door stop on the side the leaf closes to
  const f = batch.frame(matrix);
  const casing = d.casing ?? { front: true, back: true };
  const z0 = -depth - (casing.back === false || outer ? 0.006 : 0.02);
  const z1 = casing.front === false ? 0.006 : 0.02;
  const zc = (z0 + z1) / 2;
  const W = d.width;
  const Hh = d.height;
  const kMat = outer ? mat('painted', d.door?.lining?.color ?? HALL_DOOR, { roughness: 0.5 }) : frameMat;
  // a narrow door (door-bod-1: 0.79 hole, 0.07 karms, an open leaf in it) would leave less than the body's 0.60: its side
  // karms collide only with their outer NARROW_KARM (static boxes below), so the capsule fits through
  const narrow = W < NARROW_DOOR;
  f.box(fw, Hh, z1 - z0, -W / 2 + fw / 2, Hh / 2, zc, kMat, narrow ? { collide: false } : undefined);
  f.box(fw, Hh, z1 - z0, W / 2 - fw / 2, Hh / 2, zc, kMat, narrow ? { collide: false } : undefined);
  f.box(W - 2 * fw, fw, z1 - z0, 0, Hh - fw / 2, zc, kMat);
  const stopZ = swing < 0 ? -depth + 0.054 : -0.054;
  f.box(0.012, Hh - fw, 0.016, -W / 2 + fw + 0.006, (Hh - fw) / 2, stopZ + 0.008 * Math.sign(-swing), kMat, { collide: false });
  f.box(0.012, Hh - fw, 0.016, W / 2 - fw - 0.006, (Hh - fw) / 2, stopZ + 0.008 * Math.sign(-swing), kMat, { collide: false });
  f.box(W - 2 * fw, 0.012, 0.016, 0, Hh - fw - 0.006, stopZ + 0.008 * Math.sign(-swing), kMat, { collide: false });
  if (outer) {
    // the element's frame (anthracite aluminium) around the leaf at the outer face
    const fd = d.frame?.depth ?? 0.06;
    const ff = Math.max(0.04, d.frame?.width ?? 0.05);
    ring(f, 0, 0, W, Hh, ff, ff, 0, -depth - 0.004, -depth + fd, frameMat, { collide: false });
  }
  // threshold (V48: dark top with a light front edge toward the other room; a narrow metal one …)
  const th = thresholdOf(d.door);
  const tDepth = Math.min(depth, th.depth ?? depth);
  const topMat = thresholdMaterial(M, th.top);
  if (th.front || th.back) {
    const edge = 0.02;
    const edgeMat = thresholdMaterial(M, th.front ?? th.back);
    // the light edge faces the other room (front colour: the side away from the owner room = −z)
    f.box(W - 2 * fw, 0.008, tDepth - edge, 0, 0.004, -(tDepth - edge) / 2, topMat, { collide: false });
    f.box(W - 2 * fw, 0.009, edge, 0, 0.0045, -tDepth + edge / 2, edgeMat, { collide: false });
  } else {
    f.box(W - 2 * fw, 0.008, depth, 0, 0.004, -depth / 2, topMat, { collide: false });
  }

  if (d.door?.closed === false) door.setOpen(true, { instant: true });
  door.frameGroup?.removeFromParent(); // our own frame replaces the Door's steel one
  // a new shadow map when the leaf starts / stops moving (ctx.lighting exists only after the builders ran)
  door.onChange(() => ctx.lighting?.requestShadowUpdate?.());

  // walkable floor strip in the hole (§3.10): a static box across the wall's thickness, top flush with the floor
  const colliders = [];
  {
    const r = d.basis.xAxis, n = d.basis.zAxis, o0 = d.basis.origin;
    const half = W / 2 - 0.005;
    const pts = [
      o0.clone().addScaledVector(r, -half),
      o0.clone().addScaledVector(r, half),
      o0.clone().addScaledVector(r, -half).addScaledVector(n, -depth),
      o0.clone().addScaledVector(r, half).addScaledVector(n, -depth),
    ];
    const box = new THREE.Box3().setFromPoints(pts);
    box.min.y = o0.y - 0.3;
    box.max.y = o0.y;
    colliders.push(box);
    if (narrow) {
      // the outer slice of each side karm (the visible karm does not collide, see above)
      const k = Math.min(fw, NARROW_KARM);
      for (const s of [-1, 1]) {
        const xa = s * (W / 2), xb = s * (W / 2 - k);
        const q = [xa, xb].flatMap((x) => [z0, z1].map((z) => o0.clone().addScaledVector(r, x).addScaledVector(n, z)));
        const kb = new THREE.Box3().setFromPoints(q);
        kb.min.y = o0.y;
        kb.max.y = o0.y + Hh;
        colliders.push(kb);
      }
    }
  }
  const info = {
    id: d.id,
    name: d.name,
    wallId: d.wallId,
    roomId: d.roomId,
    levelId: d.levelId,
    floorY: d.floorY ?? 0,
    connects: [...(d.connects || [])],
    width: d.width,
    height: d.height,
    type: d.type,
    door,
  };
  return { door, info, colliders };
}

/** Swaps the Door's generic leaf meshes for our own geometry (pivot space; collisions/animation stay Door's). */
export function replaceLeaf(door, leafGroup) {
  const leaf = door.leaves[0];
  for (const c of [...leaf.pivot.children]) leaf.pivot.remove(c);
  leaf.pivot.add(leafGroup);
}

/**
 * Flat black interior leaf with one routed panel groove ~11 cm in (pivot space: the leaf runs from the hinge edge at
 * x = 0 toward −x for hinge +1, +x for hinge −1). Hardware (V47): 'rose-only' = round roses only (door-gang, the
 * shell's hall door – unchanged); 'lever' = a lever on a round or oblong rose on both faces, with a WC turn
 * (wcTurn) or a key escutcheon below.
 */
function interiorLeaf(d, lw, lh, swing, hinge, M, dm, batchers) {
  const kit = new MeshBatcher(`leaf:${d.id}`);
  const T = 0.04;
  const z0 = swing < 0 ? 0.005 : -0.045;
  const y0 = 0.008;
  const hs = hinge;
  const cx = -hs * (lw / 2);
  const hw = d.door?.hardware ?? {};
  const lever = hw.type === 'lever';
  kit.box(lw, lh, T, cx, y0 + lh / 2, z0 + T / 2, dm.leaf, { collide: false });
  const inset = 0.11;
  for (const side of [1, -1]) {
    const fz = side > 0 ? z0 + T + 0.0004 : z0 - 0.0004;
    ring(kit, cx, y0 + inset, lw - 2 * inset, lh - 2 * inset, 0.004, 0.004, 0.004, fz - 0.0003, fz + 0.0003, M.hallDoorGroove, { collide: false, castShadow: false });
    const hx = -hs * (lw - 0.07);
    const hy = d.door?.handleHeight ?? 1.08;
    const sz = side > 0 ? z0 + T : z0;
    if (!lever) {
      // round roses only (the shell's hall door, door-gang)
      kit.cylinder(0.025, 0.025, 0.009, hx, hy, sz + side * 0.0045, dm.hardware, { rot: [Math.PI / 2, 0, 0], segments: 20, collide: false });
      kit.box(0.008, 0.008, 0.003, hx, hy, sz + side * 0.0095, M.gasket, { collide: false, castShadow: false });
      kit.cylinder(0.018, 0.018, 0.008, hx, hy - 0.085, sz + side * 0.004, dm.hardware, { rot: [Math.PI / 2, 0, 0], segments: 18, collide: false });
      kit.box(0.003, 0.01, 0.003, hx, hy - 0.085, sz + side * 0.0085, M.gasket, { collide: false, castShadow: false });
      continue;
    }
    // lever on a rose (round, or an oblong plate), pointing toward the hinge side
    if (hw.rose === 'oblong') kit.box(0.04, 0.16, 0.008, hx, hy - 0.04, sz + side * 0.004, dm.hardware, { collide: false });
    else kit.cylinder(0.026, 0.026, 0.009, hx, hy, sz + side * 0.0045, dm.hardware, { rot: [Math.PI / 2, 0, 0], segments: 20, collide: false });
    kit.cylinder(0.009, 0.009, 0.05, hx, hy, sz + side * 0.03, dm.hardware, { rot: [Math.PI / 2, 0, 0], segments: 10, collide: false });
    kit.box(0.13, 0.019, 0.018, hx + hs * 0.058, hy, sz + side * 0.055, dm.hardware, { collide: false });
    if (hw.wcTurn) {
      // WC turn (inside: a small knob, outside: the release slot with the red/white indicator as a dark dot)
      kit.cylinder(0.02, 0.02, 0.008, hx, hy - 0.11, sz + side * 0.004, dm.hardware, { rot: [Math.PI / 2, 0, 0], segments: 18, collide: false });
      kit.box(side > 0 ? 0.03 : 0.012, side > 0 ? 0.008 : 0.003, side > 0 ? 0.014 : 0.003, hx, hy - 0.11, sz + side * (side > 0 ? 0.015 : 0.009), side > 0 ? dm.hardware : M.gasket, { collide: false, castShadow: false });
    } else if (hw.escutcheon || hw.rose === 'oblong' || hw.type === 'lever') {
      // key escutcheon (round, or the oblong plate's keyhole)
      if (hw.rose !== 'oblong') kit.cylinder(0.018, 0.018, 0.008, hx, hy - 0.085, sz + side * 0.004, dm.hardware, { rot: [Math.PI / 2, 0, 0], segments: 18, collide: false });
      kit.box(0.004, 0.012, 0.003, hx, hy - 0.085, sz + side * (hw.rose === 'oblong' ? 0.0095 : 0.0085), M.gasket, { collide: false, castShadow: false });
    }
  }
  // hinges on the hinge edge (visible in the hall / when open)
  for (const y of [0.22, lh / 2 + 0.1, lh - 0.22]) kit.cylinder(0.008, 0.008, 0.1, hs * 0.002, y, swing < 0 ? 0.002 : -0.002, dm.hardware, { segments: 10, collide: false });
  const g = kit.build();
  batchers.push({ geometries: kit.geometries });
  return g;
}

/**
 * The outer door's leaf (V27): smooth flat anthracite, 6 cm, levers on both faces near the free edge, the keypad lock
 * plate above the lever outside (the back face, −z), three light steel hinges.
 */
function outerLeaf(d, lw, lh, swing, hinge, dm, batchers) {
  const kit = new MeshBatcher(`leaf:${d.id}`);
  const T = 0.05;
  const z0 = swing < 0 ? 0.004 : -0.054;
  const y0 = 0.008;
  const hs = hinge;
  const cx = -hs * (lw / 2);
  kit.box(lw, lh, T, cx, y0 + lh / 2, z0 + T / 2, dm.leaf, { collide: false });
  const hx = -hs * (lw - 0.075);
  const hy = d.door?.handleHeight ?? 1.0;
  for (const side of [1, -1]) {
    const sz = side > 0 ? z0 + T : z0;
    kit.box(0.04, 0.2, 0.01, hx, hy - 0.03, sz + side * 0.005, dm.hardware, { collide: false });
    kit.cylinder(0.009, 0.009, 0.05, hx, hy, sz + side * 0.03, dm.hardware, { rot: [Math.PI / 2, 0, 0], segments: 10, collide: false });
    kit.box(0.14, 0.02, 0.02, hx + hs * 0.062, hy, sz + side * 0.055, dm.hardware, { collide: false });
  }
  // keypad lock outside (the side away from the entrance, −z in the door frame)
  const lp = d.door?.hardware?.lockPlate ?? { w: 0.07, h: 0.3 };
  const out = -1;
  const oz = (out > 0 ? z0 + T : z0) + out * 0.008;
  kit.box(lp.w ?? 0.07, lp.h ?? 0.3, 0.016, hx, hy + 0.08 + (lp.h ?? 0.3) / 2, oz, dm.dark, { collide: false });
  const hingeMat = mat('steel', d.door?.hinges?.color ?? '#b8b8b4', { roughness: 0.4 });
  for (const y of [0.25, lh / 2, lh - 0.25]) kit.cylinder(0.011, 0.011, 0.12, hs * 0.003, y, swing < 0 ? 0.003 : -0.003, hingeMat, { segments: 10, collide: false });
  const g = kit.build();
  batchers.push({ geometries: kit.geometries });
  return g;
}
