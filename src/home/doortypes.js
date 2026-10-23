// DOOR TYPES – double doors, sliding doors, glazed leaves and sidelights (notes/dortyper.md): what a house from the
// planbygger needs beyond the plain hinged single door. doors.js buildDoor hands a door here when its `door` has a
// variant ('double' | 'sliding'), glass or sidelights; every other door is built by doors.js exactly as before.
//
//   buildDoorType(ctx, d, { layout, M, batch, batchers }) → { door, info, colliders }   (the contract of buildDoor)
//
// Hinged (a single door with glass or sidelights, a double door): world/Door.js in the leaf bay – the clear width
// between the jambs less the sidelights and their mullions. A double door's leaves are hinged on their own jamb and meet
// without a post; the active leaf has the handle and an astragal over the meeting edge, the other flush bolts.
// Sliding: world/SlidingDoor.js – 'surface' (one or two leaves on a rail in front of a wall face), 'pocket' (into the
// wall), 'patio' (a glass panel sliding in front of a fixed one in an aluminium frame, for an exterior wall). No swing.
// Glass (door.glass): stiles and rails around the glass, bars (sprosser) between the panes, glazing beads on both faces.
// Sidelights (door.sidelights): fixed glazed panels in the hole beside the leaf bay, glass down to the floor.
//
// No face shares a plane with another: the frame stays INSET inside the hole (never in the reveal's plane), bars are
// thinner than the leaf, beads stand proud of it, the glass lies inside the bars and the frame.
import * as THREE from 'three';
import { basis, MeshBatcher, place } from '../world/buildKit.js';
import { mat } from './materials.js';
import { ring, glassMaterial, frostedGlassMaterial } from './wallkit.js';
import { Door } from '../world/Door.js';
import { SlidingDoor } from '../world/SlidingDoor.js';
import { FoldingDoor } from '../world/FoldingDoor.js';
import { HALL_DOOR, roomLabel, hardwareMaterial, thresholdOf, thresholdMaterial, replaceLeaf } from './doors.js';

/** The frame stays this far inside the hole on every side (2.5 mm: none of its faces in the reveal's plane). */
const INSET = 0.0025;
/** world/Door.js unit: the leaf + 2 · (FRAME_FACE 0.05 − OVERLAP 0.012). */
const UNIT = 0.076;
/** A leaf bay narrower than this: its side karms collide only with their outer NARROW_KARM (as doors.js, D11). */
const NARROW_BAY = 0.71;
const NARROW_KARM = 0.02;
/** Default width of a sidelight (the panel between the jamb and the mullion). */
const SIDELIGHT_W = 0.4;

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const pos = (v) => (num(v) != null && v > 0 ? v : null);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/**
 * An outer door: in an exterior wall (at least 0.2 thick), or between an outdoor room and an indoor room (layout.js
 * d.outer, notes/uterom.md) – the anthracite frame and lining, the outer leaf, its outer face at −z.
 */
export function isOuterDoor(d, wall) {
  return d.outer ?? !!(wall?.exterior && (wall?.thickness ?? 0) >= 0.2);
}

/** Does this door need the door types (anything beyond doors.js's plain hinged single leaf)? */
export function isDoorType(d) {
  const s = d?.door;
  if (!s) return false;
  return VARIANTS.includes(s.variant) || !!s.glass || (Array.isArray(s.sidelights) && s.sidelights.length > 0);
}

/** The variants built here (a plain hinged single door is doors.js's, unless it has glass or sidelights). */
const VARIANTS = ['double', 'sliding', 'folding'];
/** A folding door's default panel width (the count is rounded to an even number per stack). */
const FOLD_PANEL = 0.3;

/** Panels per stack of a folding door: `door.panels` in all (default clear / FOLD_PANEL), even, at least 2. */
export function foldingPanels(ds, clear) {
  const stacks = ds.slide === 'both' ? 2 : 1;
  const total = pos(ds.panels) ?? clear / FOLD_PANEL;
  return Math.max(2, 2 * Math.round(total / stacks / 2));
}

/**
 * Glazing of a leaf or panel (floor coordinates: y from the floor), or null. `door.glass` is true or
 * { from, to, margin, cols, rows, bar, frosted }; the defaults come from the caller (leaf, sidelight, patio panel).
 */
function glassOf(g, y0, top, def) {
  if (!g) return null;
  const o = g === true ? {} : g;
  const margin = clamp(pos(o.margin) ?? def.margin, 0.03, 0.3);
  const from = clamp(pos(o.from) ?? def.from, y0 + 0.04, top - 0.25);
  const to = clamp(pos(o.to) ?? top - def.top, from + 0.1, top - 0.04);
  const n = (v) => clamp(Math.round(pos(v) ?? 1), 1, 8);
  return { margin, from, to, cols: n(o.cols), rows: n(o.rows), bar: clamp(pos(o.bar) ?? 0.03, 0.01, 0.08), frosted: !!o.frosted };
}

/** The sidelights of a door: [{ side: −1 ('from') | +1 ('to'), w, glass }] (one per side at most). */
function sidelightsOf(ds) {
  const out = [];
  for (const s of Array.isArray(ds.sidelights) ? ds.sidelights : []) {
    const side = s?.side === 'to' ? 1 : -1;
    if (out.some((x) => x.side === side)) continue;
    out.push({ side, w: pos(s?.w) ?? SIDELIGHT_W, glass: s?.glass ?? ds.glass ?? true });
  }
  return out;
}

/**
 * Glazed body of a leaf or panel in kit space (a MeshBatcher or a BatchFrame): stiles and rails (ring) around the glass,
 * bars between the panes (1.2 cm thinner than the body), glazing beads on both faces (1 mm into the face, 5 mm proud,
 * 3 mm over the glass). The glass itself is returned as a rect for the caller (a mesh of its own, or in a batch).
 */
function glazedBody(kit, { cx, y0, w, h, z0, T, mat: m, glass: g, collide = false }) {
  const o = { collide };
  const margin = Math.min(g.margin, w / 2 - 0.05);
  const yA = g.from;
  const yB = g.to;
  ring(kit, cx, y0, w, h, margin, y0 + h - yB, yA - y0, z0, z0 + T, m, o);
  const gw = w - 2 * margin;
  const gh = yB - yA;
  const zc = z0 + T / 2;
  const bt = T - 0.012;
  for (let i = 1; i < g.cols; i++) kit.box(g.bar, gh + 0.004, bt, cx - gw / 2 + (gw * i) / g.cols, yA + gh / 2, zc, m, o);
  for (let j = 1; j < g.rows; j++) kit.box(gw + 0.004, g.bar, bt - 0.002, cx, yA + (gh * j) / g.rows, zc, m, o);
  for (const side of [1, -1]) {
    const face = side > 0 ? z0 + T : z0;
    const za = side > 0 ? face - 0.001 : face - 0.005;
    ring(kit, cx, yA - 0.011, gw + 0.022, gh + 0.022, 0.014, 0.014, 0.014, za, za + 0.006, m, { collide: false, castShadow: false });
  }
  return { x: cx, y: yA + gh / 2, w: gw + 0.016, h: gh + 0.016, z: zc };
}

/** Plain body of a leaf: the slab, and on an interior leaf the routed groove ~11 cm in (as doors.js interiorLeaf). */
function plainBody(kit, { cx, y0, w, h, z0, T, mat: m, groove }) {
  kit.box(w, h, T, cx, y0 + h / 2, z0 + T / 2, m, { collide: false });
  if (!groove) return;
  const inset = 0.11;
  for (const side of [1, -1]) {
    const fz = side > 0 ? z0 + T + 0.0004 : z0 - 0.0004;
    ring(kit, cx, y0 + inset, w - 2 * inset, h - 2 * inset, 0.004, 0.004, 0.004, fz - 0.0003, fz + 0.0003, groove, { collide: false, castShadow: false });
  }
}

/** Glass panes of a leaf (meshes of their own in the leaf group, like the shell's terrace door). */
function addGlass(group, rect, material, id) {
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(rect.w, rect.h), material);
  glass.name = `glass:${id}`;
  glass.position.set(rect.x, rect.y, rect.z);
  glass.renderOrder = 2;
  glass.castShadow = false;
  glass.userData.noCollide = true;
  glass.userData.noHighlight = true; // the hover glow on the frame only: a glowing pane tinted the view through it
  group.add(glass);
  return glass.geometry;
}

/**
 * Builds a door of the door types (see the file header). The karm, the threshold and the walkable floor strip as
 * doors.js; the karm INSET inside the hole.
 * @param {object} ctx  createHome ctx
 * @param {object} d    layout.house.doors entry (door.variant, door.glass, door.sidelights …)
 * @param {{ layout: object, M: object, batch: MeshBatcher, batchers: Array }} o
 * @returns {{ door: Door|SlidingDoor, info: object, colliders: THREE.Box3[] }}
 */
export function buildDoorType(ctx, d, { layout, M, batch, batchers }) {
  const H = layout.house;
  const wall = H?.wallsById?.[d.wallId] ?? layout.wallsById?.[d.wallId] ?? null;
  const ds = d.door ?? {};
  const outer = isOuterDoor(d, wall);
  const leafColor = ds.leafColor ?? HALL_DOOR;
  const leafMat = leafColor.toLowerCase() === HALL_DOOR ? M.hallDoor : mat('painted', leafColor, { roughness: outer ? 0.6 : 0.4 });
  const frameColor = d.frame?.color ?? leafColor;
  const frameMat = frameColor.toLowerCase() === HALL_DOOR ? M.hallDoor : mat('painted', frameColor, { roughness: 0.45 });
  const dm = { leaf: leafMat, frame: frameMat, hardware: hardwareMaterial(M, ds.hardware), dark: M.gasket };
  const matrix = basis(d.basis.xAxis, d.basis.yAxis, d.basis.zAxis, d.basis.origin);
  const fw = d.frame?.width ?? 0.07;
  const depth = wall?.thickness || 0.1;
  const casing = d.casing ?? { front: true, back: true };
  const z0 = -depth - (casing.back === false || outer ? 0.006 : 0.02);
  const z1 = casing.front === false ? 0.006 : 0.02;
  const other = (d.connects || []).find((id) => id !== d.roomId) ?? null;
  const c = {
    ctx, d, ds, M, batchers, outer, dm, fw, depth, z0, z1, matrix,
    W: d.width,
    Hh: d.height,
    f: batch.frame(matrix),
    kMat: outer ? mat('painted', ds.lining?.color ?? HALL_DOOR, { roughness: 0.5 }) : frameMat,
    glassMat: (g) => (g?.frosted ? frostedGlassMaterial() : M.glass ?? glassMaterial()),
    labels: { frontLabel: roomLabel(layout, other), backLabel: roomLabel(layout, d.roomId) },
    colliders: [],
    disposables: [],
  };
  const built = ds.variant === 'sliding' ? buildSliding(c) : ds.variant === 'folding' ? buildFolding(c) : buildHinged(c);
  const door = built.door;
  if (built.threshold !== false) buildThreshold(c, built.threshold ?? {});
  if (ds.closed === false) door.setOpen(true, { instant: true });
  door.frameGroup?.removeFromParent(); // our own frame replaces the Door's steel one
  door.onChange(() => ctx.lighting?.requestShadowUpdate?.());
  if (c.disposables.length) batchers.push({ geometries: c.disposables });

  // walkable floor strip in the hole (§3.10), as doors.js
  {
    const r = d.basis.xAxis, n = d.basis.zAxis, o0 = d.basis.origin;
    const half = c.W / 2 - 0.005;
    const pts = [-half, half].flatMap((x) => [0, -depth].map((z) => o0.clone().addScaledVector(r, x).addScaledVector(n, z)));
    const box = new THREE.Box3().setFromPoints(pts);
    box.min.y = o0.y - 0.3;
    box.max.y = o0.y;
    c.colliders.unshift(box);
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
    variant: VARIANTS.includes(ds.variant) ? ds.variant : 'single',
    door,
  };
  return { door, info, colliders: c.colliders };
}

/* ------------------------------------------------------------------ hinged: single with glass / sidelights, double */

function buildHinged(c) {
  const { ctx, d, ds, f, matrix, outer, dm, kMat, fw, W, Hh, depth, z0, z1 } = c;
  const kd = z1 - z0;
  const zc = (z0 + z1) / 2;
  const swing = d.swing === 'in' ? 1 : -1;
  const hingeTo = d.hinge === 'to';
  const double = ds.variant === 'double';
  const lights = sidelightsOf(ds);

  // across the hole: jamb | sidelight | mullion | leaf bay | mullion | sidelight | jamb
  let xa = -W / 2 + fw;
  let xb = W / 2 - fw;
  const posts = [];
  for (const s of lights.filter((x) => x.side < 0)) {
    s.x0 = xa;
    s.x1 = xa + s.w;
    posts.push(s.x1);
    xa = s.x1 + fw;
  }
  for (const s of lights.filter((x) => x.side > 0)) {
    s.x1 = xb;
    s.x0 = xb - s.w;
    posts.push(s.x0 - fw);
    xb = s.x0 - fw;
  }
  const bw = xb - xa;
  const bc = (xa + xb) / 2;
  const lh = (d.leaf?.h ?? Hh - fw) - 0.008;
  // a plain single door keeps its leaf width from the data (as doors.js); in a bay the leaves fill it
  const lw = lights.length || double ? bw : d.leaf?.w ?? W - 2 * fw;

  let splitX = 0;
  let activeLeaf = 1;
  if (double) {
    // `leaf` hangs on the `hinge` jamb, `leaf2` on the other: their widths split the bay (the leaves always fill it)
    const w1 = pos(ds.leaf?.w) ?? bw / 2;
    const w2 = pos(ds.leaf2?.w) ?? w1;
    const wMinus = hingeTo ? w2 : w1;
    const wPlus = hingeTo ? w1 : w2;
    splitX = clamp(-bw / 2 + (bw * wMinus) / (wMinus + wPlus), -bw / 2 + 0.2, bw / 2 - 0.2);
    const active = ds.active === 2 ? 2 : ds.active === 1 ? 1 : w2 > w1 + 1e-6 ? 2 : 1;
    activeLeaf = (active === 1) === !hingeTo ? 0 : 1;
  }

  const door = new Door(ctx, {
    id: d.id,
    matrix: matrix.clone().multiply(new THREE.Matrix4().makeTranslation(bc, 0, 0)),
    width: lw + UNIT,
    height: lh + 0.046,
    depth,
    materials: dm,
    hingeSide: hingeTo ? 1 : -1,
    swing,
    double,
    splitX,
    activeLeaf,
    openAngleDeg: d.openAngleDeg ?? ds.openAngleDeg ?? 90,
    ...c.labels,
    threshold: false,
    locked: !!d.locked,
    interactive: d.interactive !== false,
    duration: outer ? 0.9 : 0.7,
  });
  door.leaves.forEach((leaf, i) => {
    const g = hingedLeaf(c, { lw: leaf.length, lh, hs: leaf.hingeSide, swing, passive: double && i !== activeLeaf, astragal: double && i === activeLeaf, name: `leaf:${d.id}:${i}` });
    replaceLeaf(door, g, i);
  });

  // karm: jambs and head INSET inside the hole, mullions beside the sidelights, door stops around the leaf bay
  const narrow = bw < NARROW_BAY;
  const jw = fw - INSET;
  for (const s of [-1, 1]) {
    const bayJamb = !lights.some((x) => x.side === s);
    f.box(jw, Hh - INSET, kd, s * (W / 2 - INSET - jw / 2), (Hh - INSET) / 2, zc, kMat, narrow && bayJamb ? { collide: false } : undefined);
    if (narrow && bayJamb) narrowKarm(c, s);
  }
  f.box(W - 2 * fw, fw - INSET, kd, 0, Hh - fw + (fw - INSET) / 2, zc, kMat);
  for (const x of posts) f.box(fw, Hh - fw, kd, x + fw / 2, (Hh - fw) / 2, zc, kMat, narrow ? { collide: false } : undefined);
  const stopZ = (swing < 0 ? -depth + 0.054 : -0.054) + 0.008 * Math.sign(-swing);
  f.box(0.012, Hh - fw, 0.016, xa + 0.006, (Hh - fw) / 2, stopZ, kMat, { collide: false });
  f.box(0.012, Hh - fw, 0.016, xb - 0.006, (Hh - fw) / 2, stopZ, kMat, { collide: false });
  f.box(bw - 0.024, 0.012, 0.016, bc, Hh - fw - 0.006, stopZ, kMat, { collide: false });

  // sidelights: a fixed glazed panel in the leaf's plane, glass down to the floor
  const T = outer ? 0.05 : 0.04;
  const pz0 = swing > 0 ? (outer ? -0.058 : -0.049) : -depth + (outer ? 0.008 : 0.009);
  for (const s of lights) {
    const x0 = s.x0 + 0.001;
    const x1 = s.x1 - 0.001;
    const y0 = 0.008;
    const top = Hh - fw - 0.001;
    const g = glassOf(s.glass, y0, top, { margin: 0.05, from: 0.1, top: 0.05 });
    const pm = outer ? dm.frame : dm.leaf;
    if (!g) {
      f.box(x1 - x0, top - y0, T, (x0 + x1) / 2, (y0 + top) / 2, pz0 + T / 2, pm);
      continue;
    }
    const rect = glazedBody(f, { cx: (x0 + x1) / 2, y0, w: x1 - x0, h: top - y0, z0: pz0, T, mat: pm, glass: g, collide: true });
    const pg = new THREE.PlaneGeometry(rect.w, rect.h);
    f.add(pg, c.glassMat(g), { matrix: place(rect.x, rect.y, rect.z), collide: true, castShadow: false });
    pg.dispose();
  }

  if (outer) outerElement(c, posts);
  return { door };
}

/** The outer slice NARROW_KARM of a side karm (side −1 / +1) as a static collider (the visible karm does not collide). */
function narrowKarm(c, s) {
  const { d, W, Hh, fw, z0, z1 } = c;
  const r = d.basis.xAxis, n = d.basis.zAxis, o0 = d.basis.origin;
  const k = Math.min(fw, NARROW_KARM);
  const xa = s * (W / 2 - INSET);
  const xb = s * (W / 2 - INSET - k);
  const q = [xa, xb].flatMap((x) => [z0, z1].map((z) => o0.clone().addScaledVector(r, x).addScaledVector(n, z)));
  const kb = new THREE.Box3().setFromPoints(q);
  kb.min.y = o0.y;
  kb.max.y = o0.y + Hh;
  c.colliders.push(kb);
}

/**
 * An exterior door's element frame (anthracite aluminium) at the outer face, 3 mm into the opening past the lining
 * (never in the lining's planes), with a post at each mullion.
 */
function outerElement(c, posts = []) {
  const { d, f, dm, fw, W, Hh, depth } = c;
  const fd = d.frame?.depth ?? 0.06;
  const rw = W - 2 * INSET - 0.002;
  const rh = Hh - INSET - 0.001;
  const side = (rw - (W - 2 * fw - 0.006)) / 2;
  const top = rh - (Hh - fw - 0.003);
  ring(f, 0, 0, rw, rh, side, top, 0, -depth - 0.004, -depth + fd, dm.frame, { collide: false });
  for (const x of posts) f.box(fw + 0.006, Hh - fw - 0.003, fd + 0.004, x + fw / 2, (Hh - fw - 0.003) / 2, -depth - 0.004 + (fd + 0.004) / 2, dm.frame, { collide: false });
}

/**
 * A hinged leaf in pivot space (hinge edge at x = 0, the leaf toward −hs; Door.js turns it): plain (with the groove on
 * an interior leaf) or glazed, a lever (or the roses only, hardware.type 'rose-only'), or flush bolts on a passive
 * leaf, an astragal over the meeting edge on the active leaf of a double door, hinges.
 */
function hingedLeaf(c, { lw, lh, hs, swing, passive, astragal, name }) {
  const { d, ds, outer, dm, M, batchers } = c;
  const kit = new MeshBatcher(name);
  const T = outer ? 0.05 : 0.04;
  const z0 = outer ? (swing < 0 ? 0.004 : -0.054) : swing < 0 ? 0.005 : -0.045;
  const y0 = 0.008;
  const cx = -hs * (lw / 2);
  const glass = glassOf(ds.glass, y0, y0 + lh, outer ? { margin: 0.1, from: 0.25, top: 0.12 } : { margin: 0.12, from: 0.3, top: 0.15 });
  const rect = glass ? glazedBody(kit, { cx, y0, w: lw, h: lh, z0, T, mat: dm.leaf, glass }) : null;
  if (!glass) plainBody(kit, { cx, y0, w: lw, h: lh, z0, T, mat: dm.leaf, groove: outer ? null : M.hallDoorGroove });

  const hw = ds.hardware ?? {};
  const hx = -hs * (lw - (outer ? 0.075 : 0.07));
  const hy = ds.handleHeight ?? (outer ? 1.0 : 1.08);
  const rot = [Math.PI / 2, 0, 0];
  const o = { collide: false };
  for (const side of [1, -1]) {
    const sz = side > 0 ? z0 + T : z0;
    if (passive) {
      // flush bolt plates at the top and bottom of the meeting edge
      const bx = -hs * (lw - 0.03);
      kit.box(0.022, 0.16, 0.004, bx, y0 + lh - 0.25, sz + side * 0.002, dm.hardware, { ...o, castShadow: false });
      kit.box(0.022, 0.16, 0.004, bx, 0.25, sz + side * 0.002, dm.hardware, { ...o, castShadow: false });
      continue;
    }
    if (outer) {
      kit.box(0.04, 0.2, 0.01, hx, hy - 0.03, sz + side * 0.005, dm.hardware, o);
    } else if (hw.type === 'rose-only') {
      kit.cylinder(0.025, 0.025, 0.009, hx, hy, sz + side * 0.0045, dm.hardware, { ...o, rot, segments: 20 });
      kit.box(0.008, 0.008, 0.003, hx, hy, sz + side * 0.0095, M.gasket, { ...o, castShadow: false });
      continue;
    } else {
      kit.cylinder(0.026, 0.026, 0.009, hx, hy, sz + side * 0.0045, dm.hardware, { ...o, rot, segments: 20 });
      kit.cylinder(0.018, 0.018, 0.008, hx, hy - 0.085, sz + side * 0.004, dm.hardware, { ...o, rot, segments: 18 });
      kit.box(0.004, 0.012, 0.003, hx, hy - 0.085, sz + side * 0.0085, M.gasket, { ...o, castShadow: false });
    }
    kit.cylinder(0.009, 0.009, 0.05, hx, hy, sz + side * 0.03, dm.hardware, { ...o, rot, segments: 10 });
    kit.box(outer ? 0.14 : 0.13, 0.019, 0.018, hx + hs * 0.058, hy, sz + side * 0.055, dm.hardware, o);
  }
  if (outer && !passive && (hw.lock === 'keypad' || hw.lockPlate)) {
    // keypad lock outside (−z in the door frame), as doors.js outerLeaf
    const lp = hw.lockPlate ?? { w: 0.07, h: 0.3 };
    kit.box(lp.w ?? 0.07, lp.h ?? 0.3, 0.016, hx, hy + 0.08 + (lp.h ?? 0.3) / 2, z0 - 0.008, dm.dark, o);
  }
  if (astragal) {
    // cover strip over the meeting edge on the face the leaf opens toward (holds the passive leaf shut)
    const az = swing > 0 ? z0 + T + 0.001 + 0.003 : z0 - 0.001 - 0.003;
    kit.box(0.03, lh - 0.02, 0.006, -hs * lw, y0 + lh / 2, az, dm.leaf, o);
  }
  const hingeMat = outer ? mat('steel', ds.hinges?.color ?? '#b8b8b4', { roughness: 0.4 }) : dm.hardware;
  const hz = outer ? (swing < 0 ? 0.003 : -0.003) : swing < 0 ? 0.002 : -0.002;
  for (const y of [0.22, lh / 2 + 0.1, lh - 0.22]) kit.cylinder(outer ? 0.011 : 0.008, outer ? 0.011 : 0.008, outer ? 0.12 : 0.1, hs * (outer ? 0.003 : 0.002), y, hz, hingeMat, { ...o, segments: 10 });
  const g = kit.build();
  batchers.push({ geometries: kit.geometries });
  if (rect) c.disposables.push(addGlass(g, rect, c.glassMat(glass), d.id));
  return g;
}

/* ------------------------------------------------------------------ sliding */

function buildSliding(c) {
  const { ctx, d, ds, f, matrix, outer, fw, W, Hh, depth, z0, z1 } = c;
  const mount = ['surface', 'pocket', 'patio'].includes(ds.mount) ? ds.mount : outer ? 'patio' : 'surface';
  const slide = ['from', 'to', 'both'].includes(ds.slide) && !(mount === 'patio' && ds.slide === 'both') ? ds.slide : 'from';
  const cL = -W / 2 + fw;
  const cR = W / 2 - fw;
  const leaves = [];
  let clear = [cL, cR];
  let threshold = {};

  // a pocket door's jamb on its pocket side is split around the slot
  const pocketSides = mount === 'pocket' ? (slide === 'both' ? [-1, 1] : [slide === 'to' ? 1 : -1]) : [];
  const T = 0.04;
  slidingKarm(c, pocketSides, [-depth / 2 - T / 2 - 0.005, -depth / 2 + T / 2 + 0.005]);

  if (mount === 'surface') {
    // on a rail in front of the wall face `swing` points to ('in' = the owner room, the front): the leaf covers the
    // karm and 2 cm beyond it, 3 cm off the wall (1 cm clear of the casing), and slides past the jamb
    const side = d.swing === 'out' ? -1 : 1;
    const lz0 = side > 0 ? 0.03 : -depth - 0.03 - T;
    const y0 = 0.01;
    const y1 = Hh + 0.04;
    const spans = slide === 'both' ? [[-W / 2 - 0.02, -0.002, -1], [0.002, W / 2 + 0.02, 1]] : [[-W / 2 - 0.02, W / 2 + 0.02, slide === 'to' ? 1 : -1]];
    let ra = Infinity;
    let rb = -Infinity;
    for (const [a, b, dir] of spans) {
      const travel = dir > 0 ? cR + 0.01 - a : b - (cL - 0.01);
      leaves.push({ body: { x0: a, x1: b, y0, y1, z0: lz0, z1: lz0 + T, dir, travel }, build: (kit) => surfaceLeaf(c, kit, { a, b, y0, y1, z0: lz0, T, dir, side }) });
      ra = Math.min(ra, a, a + dir * travel);
      rb = Math.max(rb, b, b + dir * travel);
    }
    // the rail on the wall above the hole, over the closed and the open leaves
    const rz0 = side > 0 ? 0.004 : -depth - 0.004 - 0.08;
    f.box(rb - ra + 0.06, 0.05, 0.08, (ra + rb) / 2, Hh + 0.07, rz0 + 0.04, c.dm.hardware, { collide: false });
  } else if (mount === 'pocket') {
    // in the middle of the wall; it disappears into the wall up to 2.5 cm, through the slot in the jamb
    const lz0 = -depth / 2 - T / 2;
    const y0 = 0.01;
    const y1 = Hh - fw - 0.004;
    const spans =
      slide === 'both' ? [[cL - 0.03, -0.002, -1], [0.002, cR + 0.03, 1]] : slide === 'to' ? [[cL - 0.015, cR + 0.03, 1]] : [[cL - 0.03, cR + 0.015, -1]];
    for (const [a, b, dir] of spans) {
      const travel = dir < 0 ? b - (cL + 0.025) : cR - 0.025 - a;
      leaves.push({ body: { x0: a, x1: b, y0, y1, z0: lz0, z1: lz0 + T, dir, travel }, build: (kit) => pocketLeaf(c, kit, { a, b, y0, y1, z0: lz0, T, dir }) });
    }
  } else {
    const p = patio(c, slide);
    leaves.push(p.leaf);
    clear = p.clear;
    threshold = p.threshold;
  }

  const door = new SlidingDoor(ctx, {
    id: d.id,
    matrix,
    width: W,
    height: Hh,
    depth,
    leaves: leaves.map((l) => l.body),
    clear,
    ...c.labels,
    locked: !!d.locked,
    interactive: d.interactive !== false,
    duration: mount === 'patio' ? 1.1 : 0.9,
  });
  leaves.forEach((l, i) => {
    const kit = new MeshBatcher(`leaf:${d.id}:${i}`);
    const rect = l.build(kit);
    const g = kit.build();
    c.batchers.push({ geometries: kit.geometries });
    if (rect) c.disposables.push(addGlass(g, rect, c.glassMat(rect.glass), d.id));
    replaceLeaf(door, g, i);
  });
  return { door, threshold };
}

/**
 * Karm without door stops (sliding and folding doors): jambs + head INSET inside the hole; the jambs on `splitSides`
 * (−1 / +1) in two pieces around the slot z range `slot` (a pocket door's leaf runs through it).
 */
function slidingKarm(c, splitSides = [], slot = null) {
  const { f, fw, W, Hh, z0, z1 } = c;
  const kd = z1 - z0;
  const zc = (z0 + z1) / 2;
  const jw = fw - INSET;
  for (const s of [-1, 1]) {
    const x = s * (W / 2 - INSET - jw / 2);
    if (!splitSides.includes(s)) {
      f.box(jw, Hh - INSET, kd, x, (Hh - INSET) / 2, zc, c.kMat);
      continue;
    }
    f.box(jw, Hh - INSET, slot[0] - z0, x, (Hh - INSET) / 2, (z0 + slot[0]) / 2, c.kMat);
    f.box(jw, Hh - INSET, z1 - slot[1], x, (Hh - INSET) / 2, (slot[1] + z1) / 2, c.kMat);
  }
  f.box(W - 2 * fw, fw - INSET, kd, 0, Hh - fw + (fw - INSET) / 2, zc, c.kMat);
}

/* ------------------------------------------------------------------ folding */

/**
 * A folding door (foldedør / harmonikadør): one stack of narrow panels (two with slide 'both') hanging from a track
 * under the head, closed in a plane just inside the face `swing` points to; opening folds them in a zigzag toward
 * their jamb, the folds standing out toward that face (world/FoldingDoor.js). Panels plain or glazed (door.glass), a
 * pull on the free end.
 */
function buildFolding(c) {
  const { ctx, d, ds, f, matrix, fw, W, Hh, depth, dm } = c;
  const slide = ['from', 'to', 'both'].includes(ds.slide) ? ds.slide : 'from';
  const side = d.swing === 'out' ? -1 : 1;
  const cL = -W / 2 + fw;
  const cR = W / 2 - fw;
  const T = 0.03;
  slidingKarm(c);
  const zc = side > 0 ? -T / 2 - 0.012 : -depth + T / 2 + 0.012;
  // the track under the head (1 mm short of the jambs)
  f.box(cR - cL - 0.002, 0.02, 0.05, (cL + cR) / 2, Hh - fw - 0.01, zc, dm.hardware, { collide: false });
  const y0 = 0.012;
  const y1 = Hh - fw - 0.026;
  const n = foldingPanels(ds, cR - cL);
  const defs = slide === 'both' ? [[cL, 1, (cR - cL) / 2 - 0.002], [cR, -1, (cR - cL) / 2 - 0.002]] : slide === 'to' ? [[cR, -1, cR - cL]] : [[cL, 1, cR - cL]];
  const stacks = defs.map(([anchor, e, span]) => ({ anchor, e, span, panels: n, z0: zc, side, T, y0, y1 }));
  const door = new FoldingDoor(ctx, {
    id: d.id,
    matrix,
    width: W,
    height: Hh,
    depth,
    stacks,
    clear: [cL, cR],
    ...c.labels,
    locked: !!d.locked,
    interactive: d.interactive !== false,
    duration: 1.0,
  });
  const glass = glassOf(ds.glass, y0, y1, { margin: 0.06, from: 0.3, top: 0.15 });
  for (const leaf of door.leaves) {
    const st = leaf.stack;
    const w = st.p - 0.003; // a seam between the panels
    const kit = new MeshBatcher(`leaf:${d.id}:${leaf.index}`);
    const rect = glass ? glazedBody(kit, { cx: w / 2, y0, w, h: y1 - y0, z0: -T / 2, T, mat: dm.leaf, glass }) : null;
    if (!glass) kit.box(w, y1 - y0, T, w / 2, (y0 + y1) / 2, 0, dm.leaf, { collide: false });
    if (leaf.k === st.panels - 1) {
      // the pull on the free end, both faces
      const hy = ds.handleHeight ?? 1.05;
      for (const s of [1, -1]) kit.box(0.018, 0.22, 0.016, w - 0.04, hy, s * (T / 2 + 0.009), dm.hardware, { collide: false });
    }
    const g = kit.build();
    c.batchers.push({ geometries: kit.geometries });
    if (rect) c.disposables.push(addGlass(g, rect, c.glassMat(glass), d.id));
    replaceLeaf(door, g, leaf.index);
  }
  return { door };
}

/** Leaf body (plain or glazed) of a sliding leaf in door-local space; returns its glass rect (with .glass) or null. */
function slidingBody(c, kit, { a, b, y0, y1, z0, T }) {
  const glass = glassOf(c.ds.glass, y0, y1, { margin: 0.12, from: 0.3, top: 0.15 });
  const cx = (a + b) / 2;
  if (!glass) {
    plainBody(kit, { cx, y0, w: b - a, h: y1 - y0, z0, T, mat: c.dm.leaf, groove: c.outer ? null : c.M.hallDoorGroove });
    return null;
  }
  return { ...glazedBody(kit, { cx, y0, w: b - a, h: y1 - y0, z0, T, mat: c.dm.leaf, glass }), glass };
}

/** A leaf on the rail: body, two hangers up into the rail, a bar pull on the free face, a flush pull toward the wall. */
function surfaceLeaf(c, kit, { a, b, y0, y1, z0, T, dir, side }) {
  const hwm = c.dm.hardware;
  const o = { collide: false };
  const rect = slidingBody(c, kit, { a, b, y0, y1, z0, T });
  for (const x of [a + 0.1, b - 0.1]) kit.box(0.04, 0.11, T + 0.008, x, y1 - 0.025, z0 + T / 2, hwm, o);
  const hx = dir > 0 ? a + 0.08 : b - 0.08; // near the edge that closes against the jamb
  const hy = c.ds.handleHeight ?? 1.05;
  const free = side > 0 ? z0 + T : z0; // the face away from the wall
  kit.box(0.022, 0.32, 0.022, hx, hy, free + side * 0.042, hwm, o);
  for (const dy of [-0.13, 0.13]) kit.box(0.016, 0.016, 0.034, hx, hy + dy, free + side * 0.017, hwm, o);
  const wallFace = side > 0 ? z0 : z0 + T;
  kit.box(0.026, 0.14, 0.003, hx, hy, wallFace - side * 0.0015, c.M.gasket, { ...o, castShadow: false });
  return rect;
}

/** A pocket leaf: body and flush pulls on both faces near the edge that stays out of the wall. */
function pocketLeaf(c, kit, { a, b, y0, y1, z0, T, dir }) {
  const rect = slidingBody(c, kit, { a, b, y0, y1, z0, T });
  const hx = dir < 0 ? b - 0.06 : a + 0.06;
  const hy = c.ds.handleHeight ?? 1.0;
  for (const side of [1, -1]) {
    const face = side > 0 ? z0 + T : z0;
    kit.box(0.028, 0.12, 0.003, hx, hy, face + side * 0.0015, c.M.gasket, { collide: false, castShadow: false });
  }
  return rect;
}

/**
 * A glass sliding door in an exterior wall (patio): an aluminium frame at the outer face with a low sill, a fixed glass
 * panel on the outer track and a sliding one on the inner track (room side) that runs in front of it. slide 'from':
 * the panel at the 'to' end slides toward 'from'. Returns the sliding leaf, the clear passage and the threshold part.
 */
function patio(c, slide) {
  const { f, dm, fw, W, Hh, depth } = c;
  const E = Math.min(0.15, depth - 0.02); // depth of the element from the outer face
  const zo = -depth - 0.004;
  const rw = W - 2 * INSET - 0.002;
  const rh = Hh - INSET - 0.001;
  const fs = (rw - (W - 2 * fw - 0.006)) / 2;
  const top = rh - (Hh - fw - 0.003);
  ring(f, 0, 0, rw, rh, fs, top, 0, zo, -depth + E, dm.frame);
  const fa = -(W / 2 - fw - 0.003);
  const fb = W / 2 - fw - 0.003;
  f.box(fb - fa, 0.029, E + 0.004, 0, 0.0155, (zo - depth + E) / 2, dm.frame);
  const T = Math.min(0.045, (E - 0.036) / 2);
  const zOut = -depth + 0.012;
  const zIn = zOut + T + 0.012;
  const y0 = 0.034;
  const y1 = Hh - fw - 0.003 + 0.012;
  const A = [fa - 0.015, 0.035];
  const B = [-0.035, fb + 0.015];
  const moving = slide === 'to' ? A : B;
  const fixed = slide === 'to' ? B : A;
  const dir = slide === 'to' ? 1 : -1;
  const glass = glassOf(c.ds.glass ?? true, y0, y1, { margin: 0.06, from: y0 + 0.08, top: 0.06 });
  // the fixed panel (static, collides – glass too)
  const fixRect = panelBody(f, { a: fixed[0], b: fixed[1], y0, y1, z0: zOut, T, mat: dm.frame, glass, collide: true });
  if (fixRect) {
    const pg = new THREE.PlaneGeometry(fixRect.w, fixRect.h);
    f.add(pg, c.glassMat(glass), { matrix: place(fixRect.x, fixRect.y, fixRect.z), collide: true, castShadow: false });
    pg.dispose();
  }
  const travel = moving[1] - moving[0] - 0.07;
  const leaf = {
    body: { x0: moving[0], x1: moving[1], y0, y1, z0: zIn, z1: zIn + T, dir, travel },
    build: (kit) => {
      const rect = panelBody(kit, { a: moving[0], b: moving[1], y0, y1, z0: zIn, T, mat: dm.frame, glass });
      // pull on the stile that closes against the jamb: a bar on the room face, a small grip outside
      const hx = dir < 0 ? moving[1] - 0.045 : moving[0] + 0.045;
      const hy = c.ds.handleHeight ?? 1.05;
      kit.box(0.02, 0.3, 0.02, hx, hy, zIn + T + 0.03, dm.hardware, { collide: false });
      for (const dy of [-0.12, 0.12]) kit.box(0.014, 0.014, 0.022, hx, hy + dy, zIn + T + 0.011, dm.hardware, { collide: false });
      kit.box(0.02, 0.12, 0.004, hx, hy, zIn - 0.002, c.M.gasket, { collide: false, castShadow: false });
      return rect ? { ...rect, glass } : null;
    },
  };
  const open = dir < 0 ? [moving[1] - travel, fb] : [fa, moving[0] + travel];
  return { leaf, clear: open, threshold: { from: -depth + E - 0.002 } };
}

/** A patio panel: glazed (or plain without glass) aluminium body; returns the glass rect or null. */
function panelBody(kit, { a, b, y0, y1, z0, T, mat: m, glass, collide = false }) {
  const cx = (a + b) / 2;
  if (!glass) {
    kit.box(b - a, y1 - y0, T, cx, (y0 + y1) / 2, z0 + T / 2, m, { collide });
    return null;
  }
  return glazedBody(kit, { cx, y0, w: b - a, h: y1 - y0, z0, T, mat: m, glass, collide });
}

/* ------------------------------------------------------------------ threshold */

/**
 * Threshold across the wall (as doors.js, V48: a dark top with a light front edge toward the other room …), from
 * z = `from` (default the wall's back face) to the room face.
 */
function buildThreshold(c, { from = null } = {}) {
  const { d, f, M, W, fw, depth } = c;
  const th = thresholdOf(d.door);
  const topMat = thresholdMaterial(M, th.top);
  const tz0 = from ?? -depth;
  const tDepth = Math.min(-tz0, th.depth ?? -tz0);
  if ((th.front || th.back) && from == null) {
    const edge = 0.02;
    const edgeMat = thresholdMaterial(M, th.front ?? th.back);
    f.box(W - 2 * fw, 0.008, tDepth - edge, 0, 0.004, -(tDepth - edge) / 2, topMat, { collide: false });
    f.box(W - 2 * fw, 0.009, edge, 0, 0.0045, -tDepth + edge / 2, edgeMat, { collide: false });
  } else {
    f.box(W - 2 * fw, 0.008, -tz0, 0, 0.004, tz0 / 2, topMat, { collide: false });
  }
}
