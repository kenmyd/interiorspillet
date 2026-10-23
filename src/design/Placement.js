// Placement – placing new items and moving placed ones (ARCHITECTURE §11, §14). Owned by INTERACT.
//
//   new Placement(editor)
//   start(itemSpec, { onDone })   a translucent ghost (SceneSync.buildGhost) follows the cursor on the right underlay
//                                 for its mount; left click places it (design.add in a transaction, then selects it;
//                                 Shift+click keeps placing copies), right click / Esc cancels, R / Shift+R rotates,
//                                 the mouse wheel sets the height of wall items
//   handleClick(ndc) → bool       canvas click while placing
//   beginDrag(uid, hit, event?) → bool    drag a placed item along its underlay (one undo step per drag)
//   beginRotate(uid, event?) → bool       drag the rotate handle or the outline (15° steps)
//   isActive (placing or dragging) · isPlacing · dragState ({ uid, status, message } | null)
//   cancel()                      ends placing / reverts the drag
//   constrain(item) → { position, rotationDeg, attach?, status, message }   keeps an item inside the room (nudges)
//   duplicateOffset(item) → [dx, dy, dz]   a free spot beside an item for «Dupliser»
//   grid · toggleGrid()           10 cm grid snapping (G), off by default
//   update(dt), dispose()
//
// Underlays per mount: floor / rug → the floor (rugs too); wall → the wall surface under the cursor (oriented by the
// wall's normal, height by the wheel); ceiling → the ceiling above the cursor (in walk mode the ceiling under the
// cursor, in the overview / plan the point above the floor under the cursor; y from home.ceilingHeightAt); surface →
// table / sideboard tops (userData.model.surfaces), window sills, the kitchen counter, else the floor; soft → any
// item or floor (cushions lean against a backrest when the cursor hits it near-vertically).
// Snapping (hold Alt to switch it off): the 10 cm grid (G), backs against a wall within 25 cm (rotation too), sides
// into corners, 15° rotation steps. Items never go through walls. Red = overlapping other furniture / in front of a
// door (can still be placed) or outside the room (cannot be placed).
//
// Floor items: the cursor on a wall (or a kitchen box) puts the item on the floor at its foot, facing away from it
// (the plain floor-plane hit would lie behind the wall, in the next room). Wall-type pieces (sideboards, TV benches,
// sofas) turn their back to a wall within 40 cm whatever their rotation. Pendants over a table line up
// with its long axis (linear ones), centre on it when close and get a drop that leaves ≈ 65 cm above the top.
// Overlap tests use the model's collision boxes (userData.model.colliders) when it has them, so the arm of an arc
// lamp may reach over a sofa. Surface / soft items stay on their support (table top, window board inside the
// reveal, kitchen counter, the shelves of the wall design) when nudged or duplicated, else drop to what is below.
// Wall panels taller than the wall (above the skirting) are cut to length (slat panels) or refused.
//
// The whole house (notes/hele-huset-design.md §5.3, steg 14 E1 + 28 E4): every operation works on ONE level – a new
// item on the editor's level (editor.level: the overview's / plan's, else the player's), a drag / nudge / constrain
// on the item's own (item.level). The level's plan (buildRoom) has the faces of all its rooms (backOf faces too, with
// the holes of the slab behind them), the room polygons with the stairwell as a hole (a footprint must lie in ONE room:
// «Utenfor rommet» / «Over trappehullet»), the kitchen, the built-ins and the stair's footprint on the lower level
// («I trappa», blocked), and per door a clearance on both sides (a warning, as before) and the swing of a door the
// player opens («I slaget til døra», blocked). Floors, ceilings, window boards and wall heights are the level's
// (the entrance's floor lies 0.30 lower). Positions are world space, as the design holds them in memory; a new item
// gets the item's `level` (DesignState v2 keeps it and saves y over the level's floor itself).
import * as THREE from 'three';
import { disposeModel } from '../models/kit.js';
import { getArchetype } from '../models/registry.js';
import { pickAt, cursorNDC, ndcFromClient, Footprint, hintUI, itemName, normDeg, underlayY, intersectFast, houseRoots, floorYAt, ROTATE_CURSOR } from './Selection.js';
import { MAIN_LEVEL, itemLevel, levelFloorY, levelAtY } from './SceneSync.js';
import { builtInFrame } from '../home/builtins.js';

const DEG = Math.PI / 180;
const GRID = 0.1;
const WALL_SNAP = 0.25;
const SIDE_SNAP = 0.15;
const CENTER_SNAP = 0.06;
const ROT_STEP = 15;
const DOOR_CLEARANCE = 0.6;
/**
 * Floor pieces that belong with their back to a wall: turned to face away from a wall within AUTO_FACE_DIST. (Not
 * arc lamps: beside a sofa against the wall their arm reaches sideways, along the wall, over the seat.) Floor vitrines
 * too – dropped by a wall with the default rotation they stood side-on to it (notes/add-storage.md).
 */
const AUTO_FACE = /^(sideboard|tv-bench|display-cabinet|sofa-modular-l|sofa-curved|sofa-straight)$/;
const AUTO_FACE_DIST = 0.4;
/** Pendants over a table: the shade's underside this far above the top (60–70 cm is usual over a dining table). */
const OVER_TABLE = 0.65;
const PENDANT = /^(pendant-|chandelier-)/;
/** Wall items that are cut to length when taller than the wall (above the skirting). */
const CUT_TO_LENGTH = new Set(['slat-panel']);

const autoFaces = (archetype) => AUTO_FACE.test(archetype || '');

/** Default height of the middle of wall items (m above the floor). */
const WALL_V = {
  'art-frame': 1.5, mirror: 1.5, 'acoustic-art': 1.5, 'fabric-panel': 1.5, 'felt-shape': 1.5, 'slat-panel': 1.3,
  'wall-sconce': 1.7, 'wall-arm': 1.55, tv: 1.15, speaker: 1.2, 'wall-shelf': 1.45,
};

const _ray = new THREE.Raycaster();
const _v2 = new THREE.Vector2();
const _v3 = new THREE.Vector3();
const _plane = new THREE.Plane();
const _box = new THREE.Box3();
const _m4 = new THREE.Matrix4();
const _down = new THREE.Vector3(0, -1, 0);

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const r3 = (v) => Math.round(v * 1000) / 1000;
const cm = (m) => Math.round(m * 100);
const snap = (v, step) => Math.round(v / step) * step;

// ---------------------------------------------------------------------------------------------------------------
// Room geometry (plan = x/z)

/**
 * The plan of one level for placing (notes/hele-huset-design.md §5.3): its walls (the room faces of every room of the
 * level, backOf faces included – each with its floor and the holes in it), its rooms (polygons; the stairwell as a
 * hole), the fixed boxes (the kitchen, the built-ins, the stair's footprint), the doors (a clearance in front of
 * both sides; the swing of a door the player opens), the window boards. Without house data: the living room as before.
 * @param {object} editor
 * @param {string} [levelId]
 */
export function buildRoom(editor, levelId = MAIN_LEVEL) {
  const layout = editor.layout;
  const home = editor.home;
  const H = layout.house;
  const main = levelId === MAIN_LEVEL;
  const floorY = levelFloorY(layout, levelId);
  const houseWall = (id) => H?.wallsById?.[id] ?? layout.wallsById?.[id] ?? null;
  const src = (home.walls?.length ? home.walls : layout.walls).filter((w) => (w.levelId ?? MAIN_LEVEL) === levelId);
  const walls = src.map((w) => {
    const sx = w.start.x, sz = w.start.y, ex = w.end.x, ez = w.end.y;
    const L = Math.hypot(ex - sx, ez - sz) || 1;
    const lw = houseWall(w.id);
    const fy = Number.isFinite(w.floorY) ? w.floorY : Number.isFinite(lw?.floorY) ? lw.floorY : floorY;
    return {
      id: w.id,
      name: w.name,
      sx, sz,
      dx: (ex - sx) / L,
      dz: (ez - sz) / L,
      nx: w.normal.x,
      nz: w.normal.y,
      L,
      fy,
      heightAt: w.heightAt || lw?.heightAt || (() => 2.4),
      // the holes in this face: its own openings, or (a backOf face) those of the slab it is the back of
      openings: (w.backOf?.length || lw?.backOf?.length ? lw?.holes : lw?.openings) || [],
    };
  });
  // the rooms of the level (physical ones), with the stairwell as a hole in the hall's floor
  const xz = (p) => ({ x: p.x, z: p.y });
  const holes = (H?.floorOpenings || []).filter((fo) => fo.levelId === levelId).map((fo) => fo.polygon.map(xz));
  const roomList = (H?.rooms || []).filter((r) => r.levelId === levelId && !r.hud && r.polygon?.length >= 3);
  const rooms = roomList.length
    ? roomList.map((r) => ({ id: r.id, name: r.name, floorY: r.floorY ?? floorY, poly: r.polygon.map(xz), holes }))
    : [{ id: 'stue-kjokken', name: 'Stue/kjøkken', floorY: 0, poly: layout.floor.polygon.map(xz), holes: [] }];
  const poly = rooms.find((r) => r.id === 'stue-kjokken')?.poly ?? rooms[0].poly;
  const fixed = [];
  if (main) {
    for (const k of layout.kitchen?.items || []) {
      const b = k.box;
      fixed.push({
        name: k.name, cx: (b.min.x + b.max.x) / 2, cz: (b.min.z + b.max.z) / 2, ax: [1, 0], az: [0, 1],
        hw: (b.max.x - b.min.x) / 2, hd: (b.max.z - b.min.z) / 2, y0: b.min.y, y1: b.max.y, floor: 0, kind: 'kitchen',
      });
    }
  }
  // the built-ins (WC, vanity, shower, the laundry's machines and bench …): their footprint box, axis-aligned
  for (const b of H?.builtIns || []) {
    if (b.levelId !== levelId || b.collide === false || !b.dims) continue;
    let f;
    try {
      f = builtInFrame(b);
    } catch {
      continue;
    }
    const c = Math.abs(Math.cos(f.yaw)), s = Math.abs(Math.sin(f.yaw));
    const hw = (b.dims.w * c + b.dims.d * s) / 2, hd = (b.dims.w * s + b.dims.d * c) / 2;
    const y0 = f.centre.y;
    fixed.push({
      name: (b.name || 'innredningen').toLowerCase(), cx: f.centre.x, cz: f.centre.z, ax: [1, 0], az: [0, 1], hw, hd,
      y0, y1: y0 + (b.dims.h || 0.5), floor: Number.isFinite(b.floorY) ? b.floorY : floorY, kind: 'builtin',
    });
  }
  // the stair's footprint on its lower level (the level above has the stairwell as a hole): no furniture in it
  const levelY = (id) => H?.levelsById?.[id]?.floorY ?? 0;
  for (const st of H?.stairs || []) {
    const lower = levelY(st.fromLevel) <= levelY(st.toLevel) ? st.fromLevel : st.toLevel;
    if (lower !== levelId) continue;
    for (const r of polygonRects((st.footprint || []).map(xz))) {
      fixed.push({ ...r, ax: [1, 0], az: [0, 1], y0: st.bottomY ?? floorY, y1: st.topY ?? floorY + 2.5, floor: st.bottomY ?? floorY, kind: 'stair', name: 'trappa', block: true });
    }
  }
  const doors = [];
  const doorList = (H?.doors?.length ? H.doors : layout.doors || []).filter((d) => (d.levelId ?? MAIN_LEVEL) === levelId);
  for (const d of doorList) {
    const n = d.normal, r = d.right;
    const fy = Number.isFinite(d.floorY) ? d.floorY : floorY;
    const name = d.type === 'terrace-door' || /terrasse/i.test(d.id) ? 'terrassedøra' : d.id === 'door-ute' ? 'ytterdøra' : 'døra';
    // the clearance in front of the door on its owner room's side (as before the house), and on the other side when
    // there is a room there
    doors.push({
      name, cx: d.bottomCenter.x + n.x * DOOR_CLEARANCE / 2, cz: d.bottomCenter.z + n.z * DOOR_CLEARANCE / 2,
      ax: [r.x, r.z], az: [n.x, n.z], hw: d.width / 2, hd: DOOR_CLEARANCE / 2, y0: fy, y1: fy + 2, kind: 'door',
    });
    {
      const t = houseWall(d.wallId)?.thickness ?? 0.1;
      const off = t + DOOR_CLEARANCE / 2;
      if ((d.connects || []).some((id) => id !== d.roomId && id !== 'ute')) {
        doors.push({
          name, cx: d.bottomCenter.x - n.x * off, cz: d.bottomCenter.z - n.z * off,
          ax: [r.x, r.z], az: [n.x, n.z], hw: d.width / 2, hd: DOOR_CLEARANCE / 2, y0: fy - 0.35, y1: fy + 2, kind: 'door',
        });
      }
    }
    // the leaf's swing (doors the player opens): blocked – the door would hit the furniture
    const sw = d.interactive ? swingBox(d, houseWall(d.wallId)?.thickness ?? 0.1) : null;
    if (sw) doors.push({ ...sw, name, y0: fy - 0.35, y1: fy + 2, kind: 'swing', block: true });
  }
  // window boards: from the frame (revealDepth behind the wall face) to the overhang into the room, inside the reveal
  const sills = [];
  const winList = (H?.windows?.length ? H.windows : layout.windows || []).filter((o) => (o.levelId ?? MAIN_LEVEL) === levelId);
  for (const o of winList) {
    if (!o.sillBoard || o.type !== 'window') continue;
    const b = o.bottomCenter;
    sills.push({
      id: o.id, name: o.name, x: b.x, z: b.z, y: b.y, rx: o.right.x, rz: o.right.z, nx: o.normal.x, nz: o.normal.z,
      W: o.width, back: -(o.revealDepth ?? 0.2), front: o.sillBoard.overhang ?? 0.01,
    });
  }
  return {
    level: levelId, floorY, walls, rooms, poly, holes, fixed, doors, sills,
    gap: layout.baseboard?.thickness ?? 0.012, skirting: layout.baseboard?.height ?? 0.07,
  };
}

/**
 * The swing of a hinged door as a box on the side it opens to: leaf × leaf from the hinge (a door that opens past
 * 90° sweeps the half disc around its hinge). null when it has no leaf (a sliding / terrace door).
 */
export function swingBox(d, t) {
  const door = d.door;
  if (!door || d.type !== 'door' || door.variant === 'sliding' || door.variant === 'garage') return null; // a sliding / garage door has no swing
  if (door.variant === 'folding') {
    // the folds stand out one panel width (~0.3 m) over the whole hole on the side they fold to
    const side = door.swing === 'out' ? -1 : 1;
    const dc = (side > 0 ? 0 : t) + 0.15;
    const b = d.bottomCenter, n = d.normal, r = d.right;
    return { cx: b.x + n.x * side * dc, cz: b.z + n.z * side * dc, ax: [r.x, r.z], az: [n.x, n.z], hw: d.width / 2, hd: 0.15 };
  }
  const double = door.variant === 'double';
  // a double door: both leaves, the wider one's depth over the whole hole
  const leaf = double ? Math.max(door.leaf?.w ?? d.width / 2, door.leaf2?.w ?? door.leaf?.w ?? d.width / 2) : door.leaf?.w ?? d.width;
  const angle = d.openAngleDeg ?? 90;
  const n = d.normal, r = d.right;
  // 'in' opens into the owner room (normal side), 'out' to the other side (behind the wall's thickness)
  const side = door.swing === 'out' ? -1 : 1;
  const z0 = side > 0 ? 0 : t;
  const hu = door.hinge === 'to' ? d.width / 2 : -d.width / 2; // hinge along r from the middle of the hole
  const towards = door.hinge === 'to' ? -1 : 1;
  const u0 = double ? -d.width / 2 - (angle > 95 ? leaf : 0) : angle > 95 ? hu - leaf : Math.min(hu, hu + towards * leaf);
  const u1 = double ? d.width / 2 + (angle > 95 ? leaf : 0) : angle > 95 ? hu + leaf : Math.max(hu, hu + towards * leaf);
  const uc = (u0 + u1) / 2, dc = z0 + leaf / 2;
  const b = d.bottomCenter;
  return {
    cx: b.x + r.x * uc + n.x * side * dc, cz: b.z + r.z * uc + n.z * side * dc,
    ax: [r.x, r.z], az: [n.x, n.z], hw: (u1 - u0) / 2, hd: leaf / 2,
  };
}

/** An axis-aligned polygon ({ x, z } points) as rectangles { cx, cz, hw, hd } (cells of its own coordinates). */
function polygonRects(poly) {
  if (!poly || poly.length < 3) return [];
  const xs = [...new Set(poly.map((p) => +p.x.toFixed(4)))].sort((a, b) => a - b);
  const zs = [...new Set(poly.map((p) => +p.z.toFixed(4)))].sort((a, b) => a - b);
  const out = [];
  for (let i = 0; i + 1 < xs.length; i++) {
    let run = null;
    for (let k = 0; k + 1 < zs.length; k++) {
      const inside = pointInPoly(poly, (xs[i] + xs[i + 1]) / 2, (zs[k] + zs[k + 1]) / 2);
      if (inside && run) run.z1 = zs[k + 1];
      else if (inside) run = { x0: xs[i], x1: xs[i + 1], z0: zs[k], z1: zs[k + 1] };
      if (!inside && run) {
        out.push(run);
        run = null;
      }
    }
    if (run) out.push(run);
  }
  return out.map((q) => ({ cx: (q.x0 + q.x1) / 2, cz: (q.z0 + q.z1) / 2, hw: (q.x1 - q.x0) / 2, hd: (q.z1 - q.z0) / 2 }));
}

/** Axes of an item footprint (deg) projected on a unit direction: half extent of a w × d footprint along (ux, uz). */
function extentAlong(thetaDeg, dims, ux, uz) {
  const { ax, az } = axes(thetaDeg);
  return (dims.w / 2) * Math.abs(ax[0] * ux + ax[1] * uz) + (dims.d / 2) * Math.abs(az[0] * ux + az[1] * uz);
}

/**
 * Keeps an item footprint on a window board: inside the reveal along the wall, the back at the frame, the centre on
 * the board (deeper items overhang into the room). fits = false when it is wider than the opening or so deep that
 * its centre would leave the board.
 */
function clampToSill(s, x, z, thetaDeg, dims) {
  const eU = extentAlong(thetaDeg, dims, s.rx, s.rz);
  const eN = extentAlong(thetaDeg, dims, s.nx, s.nz);
  let u = (x - s.x) * s.rx + (z - s.z) * s.rz;
  let n = (x - s.x) * s.nx + (z - s.z) * s.nz;
  let fits = true;
  if (2 * eU > s.W - 0.01) {
    u = 0;
    fits = false;
  } else u = clamp(u, -s.W / 2 + eU + 0.005, s.W / 2 - eU - 0.005);
  const nMin = s.back + eN + 0.005, nMax = s.front - 0.01;
  if (nMin > nMax) {
    n = nMin;
    fits = false;
  } else n = clamp(n, nMin, nMax);
  return { x: s.x + s.rx * u + s.nx * n, y: s.y, z: s.z + s.rz * u + s.nz * n, fits };
}

/** The window board under a world point (null when none). */
function sillAt(room, p, tol = 0.06) {
  for (const s of room.sills) {
    if (Math.abs(p.y - s.y) > tol) continue;
    const u = (p.x - s.x) * s.rx + (p.z - s.z) * s.rz;
    const n = (p.x - s.x) * s.nx + (p.z - s.z) * s.nz;
    if (Math.abs(u) <= s.W / 2 + 0.03 && n >= s.back - 0.05 && n <= s.front + 0.04) return s;
  }
  return null;
}

/** The kitchen top (counter, island) under a world point: an axis-aligned box whose top is at the point. */
function kitchenTopAt(room, p, tol = 0.04) {
  let best = null;
  for (const b of room.fixed) {
    if (b.kind === 'stair' || Math.abs(p.y - b.y1) > tol) continue;
    if (Math.abs(p.x - b.cx) > b.hw + 0.02 || Math.abs(p.z - b.cz) > b.hd + 0.02) continue;
    if (!best || b.hw * b.hd > best.hw * best.hd) best = b;
  }
  return best;
}

/** Keeps a footprint on an axis-aligned kitchen top. */
function clampToBoxTop(b, x, z, thetaDeg, dims) {
  const ex = extentAlong(thetaDeg, dims, 1, 0), ez = extentAlong(thetaDeg, dims, 0, 1);
  const fits = ex < b.hw && ez < b.hd;
  const cx = ex < b.hw ? clamp(x, b.cx - b.hw + ex, b.cx + b.hw - ex) : b.cx;
  const cz = ez < b.hd ? clamp(z, b.cz - b.hd + ez, b.cz + b.hd - ez) : b.cz;
  return { x: cx, y: b.y1, z: cz, fits };
}

/** World footprints (OBB + height range) of model collision boxes ([{ min, max }] in model space). */
function colliderBoxes(colliders, cx, cz, thetaDeg, baseY) {
  const { ax, az } = axes(thetaDeg);
  return colliders.map((c) => {
    const lx = (c.min[0] + c.max[0]) / 2, lz = (c.min[2] + c.max[2]) / 2;
    return {
      cx: cx + ax[0] * lx + az[0] * lz, cz: cz + ax[1] * lx + az[1] * lz, ax, az,
      hw: Math.abs(c.max[0] - c.min[0]) / 2, hd: Math.abs(c.max[2] - c.min[2]) / 2, y0: baseY + c.min[1], y1: baseY + c.max[1],
    };
  });
}

/** True for pendants whose shade is a long bar (they line up with a table's long axis). */
function isLinear(archetype, dims) {
  return archetype === 'pendant-linear' || (!!dims && dims.w >= 0.6 && dims.w >= 2.5 * Math.max(0.01, dims.d));
}

function pointInPoly(poly, x, z) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if (a.z > z !== b.z > z && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}

/** Nearest point on the polygon boundary, nudged `inset` metres inward along that edge's normal. */
function nearestInside(room, x, z, inset = 0.02) {
  let best = null;
  for (const w of room.walls) {
    const t = clamp((x - w.sx) * w.dx + (z - w.sz) * w.dz, 0, w.L);
    const px = w.sx + w.dx * t, pz = w.sz + w.dz * t;
    const d = Math.hypot(px - x, pz - z);
    if (!best || d < best.d) best = { d, x: px + w.nx * inset, z: pz + w.nz * inset };
  }
  return best ? { x: best.x, z: best.z } : { x, z };
}

/** Axes of a footprint rotated by theta (deg): ax = local +x, az = local +z (front). */
function axes(thetaDeg) {
  const t = thetaDeg * DEG;
  return { ax: [Math.cos(t), -Math.sin(t)], az: [Math.sin(t), Math.cos(t)] };
}

/** Support (half extent) of a footprint along a unit direction. */
function support(fp, ux, uz) {
  return fp.hw * Math.abs(fp.ax[0] * ux + fp.ax[1] * uz) + fp.hd * Math.abs(fp.az[0] * ux + fp.az[1] * uz);
}

/** 2D separating-axis overlap of two oriented rectangles (tol: allowed interpenetration). */
function obbOverlap(a, b, tol = 0.01) {
  const dx = b.cx - a.cx, dz = b.cz - a.cz;
  for (const L of [a.ax, a.az, b.ax, b.az]) {
    const dist = Math.abs(dx * L[0] + dz * L[1]);
    if (dist >= support(a, L[0], L[1]) + support(b, L[0], L[1]) - tol) return false;
  }
  return true;
}

function corners(fp, shrink = 0) {
  const hw = Math.max(0, fp.hw - shrink), hd = Math.max(0, fp.hd - shrink);
  const out = [];
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    out.push({ x: fp.cx + fp.ax[0] * hw * sx + fp.az[0] * hd * sz, z: fp.cz + fp.ax[1] * hw * sx + fp.az[1] * hd * sz });
  }
  return out;
}

function insideFootprint(fp, x, z, shrink = 0.005) {
  const dx = x - fp.cx, dz = z - fp.cz;
  return Math.abs(dx * fp.ax[0] + dz * fp.ax[1]) < fp.hw - shrink && Math.abs(dx * fp.az[0] + dz * fp.az[1]) < fp.hd - shrink;
}

/** The room of the level whose floor holds a plan point (not over a hole – the stairwell), or null. */
function roomAtXZ(room, x, z) {
  for (const r of room.rooms) if (pointInPoly(r.poly, x, z) && !r.holes.some((hp) => pointInPoly(hp, x, z))) return r;
  return null;
}

/**
 * Why a footprint cannot stand where it is: null when it lies on the floor of ONE room (corners inside, no reflex
 * corner of the room or of the stairwell poking in), else 'Utenfor rommet' / 'Over trappehullet'.
 */
export function footprintIssue(room, fp) {
  const r = roomAtXZ(room, fp.cx, fp.cz);
  const overHole = (x, z) => room.holes.some((hp) => pointInPoly(hp, x, z));
  if (!r) return overHole(fp.cx, fp.cz) ? 'Over trappehullet' : 'Utenfor rommet';
  for (const c of corners(fp, 0.006)) {
    if (!pointInPoly(r.poly, c.x, c.z)) return 'Utenfor rommet';
    if (overHole(c.x, c.z)) return 'Over trappehullet';
  }
  for (const p of r.poly) if (insideFootprint(fp, p.x, p.z)) return 'Utenfor rommet';
  for (const hp of room.holes) for (const p of hp) if (insideFootprint(fp, p.x, p.z)) return 'Over trappehullet';
  return null;
}

/** True when the whole footprint lies on the floor of one room (see footprintIssue). */
function footprintInside(room, fp) {
  return !footprintIssue(room, fp);
}

/**
 * Pushes a footprint out of every wall it penetrates (smallest push first) and back inside the room when its centre
 * left it. Mutates fp.cx / fp.cz.
 */
export function resolveWalls(room, fp, gap = 0) {
  // (over the stairwell it stays where it is: the candidate says why it cannot stand there)
  if (!roomAtXZ(room, fp.cx, fp.cz) && !room.holes.some((hp) => pointInPoly(hp, fp.cx, fp.cz))) {
    const p = nearestInside(room, fp.cx, fp.cz, 0.02);
    fp.cx = p.x;
    fp.cz = p.z;
  }
  for (let iter = 0; iter < 4; iter++) {
    let best = null;
    for (const w of room.walls) {
      const along = (fp.cx - w.sx) * w.dx + (fp.cz - w.sz) * w.dz;
      const t = support(fp, w.dx, w.dz);
      if (along + t <= 0.01 || along - t >= w.L - 0.01) continue;
      const dist = (fp.cx - w.sx) * w.nx + (fp.cz - w.sz) * w.nz;
      const s = support(fp, w.nx, w.nz);
      if (dist < -0.02) continue; // centre behind this wall line: another wall bounds that side
      const pen = s + gap - dist;
      if (pen > 0.0005 && (!best || pen < best.pen)) best = { pen, w };
    }
    if (!best) break;
    fp.cx += best.w.nx * best.pen;
    fp.cz += best.w.nz * best.pen;
  }
}

/**
 * Wall snapping for floor items: back against a wall within 25 cm (rotation snapped to face away from it), then the
 * sides into a corner. Mutates fp (+ fp.theta). Returns a short Norwegian note or ''.
 */
function snapToWalls(room, fp, dims, { autoFace = false } = {}) {
  const gap = room.gap;
  let back = null;
  for (const w of room.walls) {
    // back (or front: nobody wants a sideboard facing the wall) within ~50° of the wall's direction; wall-type pieces
    // (sideboards, sofas …) whatever their rotation, within 40 cm of the wall when turned to it
    const facing = fp.az[0] * w.nx + fp.az[1] * w.nz;
    if (!autoFace && Math.abs(facing) < 0.64) continue;
    const dist = (fp.cx - w.sx) * w.nx + (fp.cz - w.sz) * w.nz;
    const g = dist - dims.d / 2;
    if (g > (autoFace ? AUTO_FACE_DIST : WALL_SNAP) || dist < -0.05 || (!autoFace && g < -WALL_SNAP)) continue;
    const along = (fp.cx - w.sx) * w.dx + (fp.cz - w.sz) * w.dz;
    if (along + dims.w / 2 < 0.05 || along - dims.w / 2 > w.L - 0.05) continue;
    // in a corner, the wall the piece already backs onto wins (R picks the wall)
    const score = Math.abs(g) + (autoFace ? 0.12 * (1 - facing) : 0);
    if (!back || score < back.score) back = { w, g, dist, score };
  }
  let note = '';
  if (back) {
    const w = back.w;
    fp.theta = normDeg(Math.atan2(w.nx, w.nz) / DEG);
    Object.assign(fp, axes(fp.theta));
    const push = dims.d / 2 + gap - back.dist;
    fp.cx += w.nx * push;
    fp.cz += w.nz * push;
    note = 'inntil veggen';
  }
  // sides: only when the item is square to the walls
  for (const w of room.walls) {
    const side = fp.ax[0] * w.nx + fp.ax[1] * w.nz;
    if (Math.abs(side) < 0.985) continue;
    const dist = (fp.cx - w.sx) * w.nx + (fp.cz - w.sz) * w.nz;
    const s = support(fp, w.nx, w.nz);
    const g = dist - s;
    if (g > SIDE_SNAP || g < -0.05) continue;
    const along = (fp.cx - w.sx) * w.dx + (fp.cz - w.sz) * w.dz;
    const t = support(fp, w.dx, w.dz);
    if (along + t < 0.05 || along - t > w.L - 0.05) continue;
    const push = s + gap - dist;
    fp.cx += w.nx * push;
    fp.cz += w.nz * push;
    note = back ? 'i hjørnet' : 'inntil veggen';
    break;
  }
  return note;
}

/** Distance from a footprint to the nearest wall (m), for the hint. */
function nearestWallGap(room, fp) {
  let best = Infinity;
  for (const w of room.walls) {
    const along = (fp.cx - w.sx) * w.dx + (fp.cz - w.sz) * w.dz;
    const t = support(fp, w.dx, w.dz);
    if (along + t < 0 || along - t > w.L) continue;
    const dist = (fp.cx - w.sx) * w.nx + (fp.cz - w.sz) * w.nz;
    if (dist < 0) continue;
    best = Math.min(best, dist - support(fp, w.nx, w.nz));
  }
  return best;
}

// ---------------------------------------------------------------------------------------------------------------

export class Placement {
  /** @param {import('./Editor.js').Editor} editor */
  constructor(editor) {
    this.editor = editor;
    this.hint = hintUI(editor);
    this.footprint = new Footprint(editor, { name: 'ix-placement' });
    this.grid = false;
    this.spec = null;
    this.ghost = null;
    this.onDone = null;
    this.rotationDeg = 0;
    this.wallHeight = 1.5;
    this.target = null; // last candidate { mount, position, rotationDeg, attach?, status, message, note }
    this._drag = null;
    this._rooms = new Map(); // levelId → buildRoom
    this._lv = MAIN_LEVEL; // the level the current operation works on (see _inLevel)
    this._obstacles = null;
    this._mods = { shift: false, alt: false, ctrl: false };
    this._ndc = new THREE.Vector2();
    this._lastCam = new THREE.Matrix4();
    this._right = null;

    this._onKey = (e) => this._key(e);
    this._onKeyUp = (e) => this._setMods(e);
    this._onWheel = (e) => this._wheel(e);
    this._onPtrDown = (e) => this._ptrDown(e);
    this._onPtrMove = (e) => this._ptrMove(e);
    this._onPtrUp = (e) => this._ptrUp(e);
    this._onBlur = () => {
      this._mods = { shift: false, alt: false, ctrl: false };
      if (this._drag) this._endDrag(true); // the button-up will never come (alt-tab)
    };
    window.addEventListener('keydown', this._onKey);
    window.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('wheel', this._onWheel, { capture: true, passive: false });
    window.addEventListener('pointerdown', this._onPtrDown, true);
    window.addEventListener('pointermove', this._onPtrMove, true);
    window.addEventListener('pointerup', this._onPtrUp, true);
    window.addEventListener('blur', this._onBlur);
    this._offChange = editor.design.on('change', (p) => {
      if (!this._drag || p?.uid !== this._drag.uid) this._obstacles = null;
    });
    // a loaded design or an undo/redo in the middle of a drag closes its transaction: drop the drag quietly
    this._offLoad = editor.design.on('load', () => this._abortDrag());
    this._offHistory = editor.design.on('history', () => this._abortDrag());
  }

  get isActive() {
    return !!this.spec || !!this._drag;
  }

  get isPlacing() {
    return !!this.spec;
  }

  /** The running drag ({ uid, kind, status, message }) or null. */
  get dragState() {
    const d = this._drag;
    return d ? { uid: d.uid, kind: d.kind, status: d.status, message: d.message } : null;
  }

  /** Plan of the level the current operation works on (built on first use, one per level). */
  get room() {
    return this.roomOf(this._lv);
  }

  /** Plan of a level (buildRoom), cached. */
  roomOf(levelId = MAIN_LEVEL) {
    let r = this._rooms.get(levelId);
    if (!r) {
      r = buildRoom(this.editor, levelId);
      this._rooms.set(levelId, r);
    }
    return r;
  }

  /** Runs fn with `levelId` as the level of the operation (this.room, the floor, the obstacles). */
  _inLevel(levelId, fn) {
    const prev = this._lv;
    this._lv = levelId || MAIN_LEVEL;
    try {
      return fn();
    } finally {
      this._lv = prev;
    }
  }

  /** World y of the floor of the operation's level under (x, z) (the entrance: 0.30 under the basement's). */
  _floorAt(x, z) {
    return floorYAt(this.editor.layout, x, z, this._lv);
  }

  /** An item's position (world space, DesignState v2) as a copy. */
  _world(item) {
    const p = item.position || [0, 0, 0];
    return [p[0], p[1] || 0, p[2]];
  }

  // ---- placing a new item ------------------------------------------------------------------------------------

  /**
   * Starts placing a new item.
   * @param {object} itemSpec  catalog productToItemSpec(…) or any item spec (position is set here)
   * @param {{ onDone?: (uid: string|null) => void }} [opts]
   */
  start(itemSpec, { onDone } = {}) {
    this.cancel();
    if (!itemSpec) return;
    const e = this.editor;
    this.spec = { ...itemSpec };
    delete this.spec.uid;
    this.onDone = onDone || null;
    this.rotationDeg = normDeg(itemSpec.rotationDeg || 0);
    let ghost = null;
    try {
      ghost = e.sync.buildGhost(this.spec);
    } catch (err) {
      console.error('[placement] ghost failed', err);
    }
    if (!ghost) {
      this.spec = null;
      return;
    }
    this.ghost = ghost;
    ghost.userData.isGhost = true; // left out of «Bilde» (P) screenshots
    this.mount = ghost.userData.mount || this.spec.mount || 'floor';
    this.spec.mount = this.mount;
    this.ghost.visible = false;
    e.scene.add(this.ghost);
    // vertical extent of the model relative to its origin (overlap tests)
    this.ghost.updateMatrixWorld(true);
    _box.setFromObject(this.ghost);
    this._yRel = Number.isFinite(_box.min.y) ? [_box.min.y, _box.max.y] : [0, this.spec.dims?.h ?? 0.5];
    const h = this.spec.dims?.h ?? 0.5;
    // a wall cabinet with the shop's suggested bottom height (BESTÅ: params.mountHeight 1.2) starts there – the same
    // height the Inspector's floor → wall swap uses
    const mh = Number(this.spec.params?.mountHeight);
    const wallV = WALL_V[this.spec.archetype] ?? (this.mount === 'wall' && mh > 0 ? mh + h / 2 : Math.max(1.45, h / 2 + 0.1));
    this.wallHeight = Array.isArray(itemSpec.position) && itemSpec.position[1] > 0 && this.mount === 'wall' ? itemSpec.position[1] : wallV;
    this.target = null;
    this._obstacles = null;
    this._aimKey = '';
    this._patchKey = '';
    e.select(null);
    e.events.emit('placing', { active: true, spec: this.spec });
  }

  /** The spec with a spot's overrides (target.patch: { dims?, params? } – cut length, suggested drop). */
  _patched(patch) {
    if (!patch) return this.spec;
    return {
      ...this.spec,
      dims: patch.dims ? { ...this.spec.dims, ...patch.dims } : this.spec.dims,
      params: patch.params ? { ...(this.spec.params || {}), ...patch.params } : this.spec.params,
    };
  }

  /** Rebuilds the ghost for a spot that changes the model (a panel cut to length, a pendant's drop). */
  _setGhostPatch(patch) {
    const key = patch ? JSON.stringify(patch) : '';
    if (key === this._patchKey) return;
    this._patchKey = key;
    let ghost = null;
    try {
      ghost = this.editor.sync.buildGhost(this._patched(patch));
    } catch (err) {
      console.error('[placement] ghost failed', err);
    }
    if (!ghost) return;
    if (this.ghost) {
      this.ghost.removeFromParent();
      disposeModel(this.ghost);
    }
    ghost.userData.isGhost = true;
    ghost.visible = false;
    this.ghost = ghost;
    this.editor.scene.add(ghost);
    ghost.updateMatrixWorld(true);
    _box.setFromObject(ghost);
    if (Number.isFinite(_box.min.y)) this._yRel = [_box.min.y, _box.max.y];
  }

  /** A canvas click while placing: places the item (Shift: keep placing). @returns {boolean} */
  handleClick(ndc) {
    if (!this.spec) return false;
    const e = this.editor;
    if (ndc) this._aim(ndc);
    const t = this.target;
    if (!t || t.status === 'blocked') {
      e.events.emit('toast', { text: t?.message ? `Kan ikke plasseres: ${t.message.toLowerCase()}` : 'Pek på et sted i rommet', seconds: 2 });
      e.events.emit('sfx', { name: 'door-locked', volume: 0.4 });
      return true;
    }
    // the item stands on the level the candidate was found on (DesignState v2 keeps `level`; positions are world)
    const level = t.level ?? MAIN_LEVEL;
    const spec = { ...this._patched(t.patch), level, position: t.position.map(r3), rotationDeg: t.rotationDeg };
    if (t.attach) spec.attach = t.attach;
    else delete spec.attach;
    const name = itemName(spec);
    const uid = e.design.transaction(`Plasser ${name}`, (d) => d.add(spec));
    e.events.emit('sfx', { name: 'place' });
    const cut = t.patch?.dims?.h != null && this.spec.dims && t.patch.dims.h < this.spec.dims.h ? cm(t.patch.dims.h) : null;
    if (t.status === 'overlap') {
      e.events.emit('toast', { text: `${name} er plassert${cut ? ` og kappet til ${cut} cm` : ''} – obs: ${t.message.toLowerCase()}`, seconds: 3.5 });
    } else if (cut) {
      e.events.emit('toast', { text: `${name} er kappet til ${cut} cm så det passer mellom gulvlisten og taket`, seconds: 3.5 });
    }
    const up = this._upShift;
    if (this._mods.shift || (up?.shift && performance.now() - up.t < 400)) {
      // keep placing copies; the new one is in the room already
      this._obstacles = null;
      this.onDone?.(uid);
      return true;
    }
    const done = this.onDone;
    this._endPlacing();
    e.select({ kind: 'item', uid });
    done?.(uid);
    return true;
  }

  /** Ends placing (callback with null) or reverts a running drag. */
  cancel() {
    if (this._drag) {
      this._endDrag(false);
      return;
    }
    if (!this.spec) return;
    const done = this.onDone;
    this._endPlacing();
    done?.(null);
  }

  _endPlacing() {
    if (this.ghost) {
      this.ghost.removeFromParent();
      disposeModel(this.ghost);
    }
    this.ghost = null;
    this.spec = null;
    this.onDone = null;
    this.target = null;
    this.footprint.hide();
    this.editor.hud?.setCursor?.('default');
    this.editor.events.emit('placing', { active: false });
  }

  /** Aims the ghost at a point in NDC (updates this.target). */
  _aim(ndc) {
    const e = this.editor;
    // the level the editor works on (the overview's / plan's, else the player's): new items stand on it
    this._lv = e.level ?? MAIN_LEVEL;
    const res = this._solveFor(this.mount, ndc, {
      dims: this.spec.dims,
      theta: this.rotationDeg,
      yRel: this._yRel,
      archetype: this.spec.archetype,
      params: this.spec.params,
      colliders: this.ghost?.userData?.model?.colliders,
      v: this.wallHeight,
      snap: !this._mods.alt,
    });
    if (!res) {
      this.ghost.visible = false;
      this.footprint.hide();
      this.target = null;
      return;
    }
    res.level = this._lv;
    this.target = res;
    this._setGhostPatch(res.patch || null);
    const dims = res.patch?.dims ? { ...this.spec.dims, ...res.patch.dims } : this.spec.dims;
    const item = { mount: this.mount, archetype: this.spec.archetype, dims, level: this._lv, position: res.position, rotationDeg: res.rotationDeg, attach: res.attach };
    e.sync.placeObject(this.ghost, item);
    e.sync.ghostTint(this.ghost, res.status === 'ok');
    this.ghost.visible = true;
    this.footprint.show(item, { tone: res.status === 'ok' ? 'ghost' : res.status === 'blocked' ? 'blocked' : 'warn', handles: this.mount !== 'wall', rotateHandle: false, object: this.ghost });
  }

  // ---- dragging placed items ---------------------------------------------------------------------------------

  /**
   * Starts dragging a placed item (the press already hit it). One undo step per drag.
   * @param {string} uid
   * @param {object} [hit]  pickAt hit on the item (grab point)
   * @param {MouseEvent|PointerEvent} [ev]  the event that started the drag (cursor position)
   * @returns {boolean}
   */
  beginDrag(uid, hit, ev) {
    if (this.spec || this._drag) return false;
    const e = this.editor;
    const item = e.design.get(uid);
    const obj = e.sync.getObject(uid);
    if (!item || !obj || item.locked) return false;
    const ndc = ev ? ndcFromClient(e.renderer.domElement, ev.clientX, ev.clientY, new THREE.Vector2()) : cursorNDC(e, new THREE.Vector2());
    if (!ndc) return false;
    obj.updateMatrixWorld(true);
    _box.setFromObject(obj);
    const oy = obj.position.y;
    // the drag stays on the item's level (its plan, its floor)
    this._lv = itemLevel(item, e.layout);
    const d = {
      uid, kind: 'move', mount: item.mount, name: itemName(item), dims: { ...item.dims }, archetype: item.archetype, params: item.params,
      theta: item.rotationDeg || 0, yRel: [_box.min.y - oy, _box.max.y - oy], status: 'ok', message: '', note: '',
      ndc: ndc.clone(), offset: [0, 0], planeY: this.room.floorY, wallId: item.attach?.wallId ?? null, colliders: obj.userData.model?.colliders,
      level: this._lv,
    };
    const p = this._world(item);
    const grab = hit?.point ?? new THREE.Vector3(p[0], oy, p[2]);
    if (d.mount === 'floor' || d.mount === 'rug' || d.mount === 'ceiling') {
      d.planeY = this._dragPlaneY(grab.y);
      // grab offset from the ray of the press (the cursor has already moved a few pixels by now)
      const P = hit?.ray ? hit.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -d.planeY), new THREE.Vector3()) : this._rayPlane(ndc, d.planeY);
      if (P) d.offset = [p[0] - P.x, p[2] - P.z];
    } else if (d.mount === 'wall') {
      const w = this._wallFor(item);
      if (w) {
        d.wallId = w.id;
        const u = (grab.x - w.sx) * w.dx + (grab.z - w.sz) * w.dz;
        const uc = (p[0] - w.sx) * w.dx + (p[2] - w.sz) * w.dz;
        d.offset = [uc - u, oy - grab.y];
      }
    }
    e.design.begin(`Flytt ${d.name}`);
    this._drag = d;
    this._obstacles = null;
    this._listenDrag(true);
    e.hud?.setCursor?.('grabbing');
    e.events.emit('sfx', { name: 'pick', volume: 0.7 });
    this._dragStep(); // catch up with the pixels moved before the drag started
    return true;
  }

  /**
   * Starts rotating an item with the rotate handle or its outline (15° steps, Alt: free).
   * @param {string} uid
   * @param {MouseEvent|PointerEvent} [ev]
   * @returns {boolean}
   */
  beginRotate(uid, ev) {
    if (this.spec || this._drag) return false;
    const e = this.editor;
    const item = e.design.get(uid);
    if (!item || item.locked || item.mount === 'wall') return false;
    const ndc = ev ? ndcFromClient(e.renderer.domElement, ev.clientX, ev.clientY, new THREE.Vector2()) : cursorNDC(e, new THREE.Vector2());
    this._lv = itemLevel(item, e.layout);
    const fpY = e.selection?.footprint?.group?.position?.y ?? this.room.floorY;
    const P = ndc ? this._rayPlane(ndc, fpY) : null;
    if (!P) return false;
    const p = item.position;
    this._drag = {
      uid, kind: 'rotate', mount: item.mount, name: itemName(item), dims: { ...item.dims }, archetype: item.archetype,
      theta0: item.rotationDeg || 0, theta: item.rotationDeg || 0, a0: Math.atan2(P.x - p[0], P.z - p[2]), planeY: fpY,
      status: 'ok', message: '', note: '', ndc: ndc.clone(), yRel: [0, item.dims.h], level: this._lv,
    };
    e.design.begin(`Roter ${itemName(item)}`);
    this._listenDrag(true);
    e.hud?.setCursor?.(ROTATE_CURSOR);
    return true;
  }

  _listenDrag(on) {
    const fn = on ? 'addEventListener' : 'removeEventListener';
    window[fn]('pointermove', this._onDragMove ||= (ev) => this._dragPointer(ev), true);
    window[fn]('mousemove', this._onDragMove, true);
    window[fn]('pointerup', this._onDragUp ||= (ev) => {
      if (ev.button === 0) this._endDrag(true);
    }, true);
    window[fn]('mouseup', this._onDragUp, true);
  }

  _dragPointer(ev) {
    const d = this._drag;
    if (!d) return;
    this._setMods(ev);
    ndcFromClient(this.editor.renderer.domElement, ev.clientX, ev.clientY, d.ndc);
    this._dragStep();
  }

  /** Applies the drag for the current cursor (d.ndc). */
  _dragStep() {
    const e = this.editor;
    const d = this._drag;
    const item = e.design.get(d.uid);
    if (!item) {
      this._endDrag(false);
      return;
    }
    this._lv = d.level ?? itemLevel(item, e.layout);
    if (d.kind === 'rotate') {
      const P = this._rayPlane(d.ndc, d.planeY);
      if (!P) return;
      const a = Math.atan2(P.x - item.position[0], P.z - item.position[2]);
      let theta = d.theta0 + (a - d.a0) / DEG;
      theta = this._mods.alt ? Math.round(theta) : snap(theta, ROT_STEP);
      theta = normDeg(theta);
      const fixed = this.constrain({ ...item, rotationDeg: theta });
      d.theta = theta;
      d.status = fixed.status === 'blocked' ? 'warn' : fixed.status;
      d.message = fixed.message;
      d.note = `${Math.round(theta)}°`;
      if (fixed.status !== 'blocked') this._apply(item, { rotationDeg: theta, position: fixed.position });
      return;
    }
    const res = this._solveFor(d.mount, d.ndc, {
      dims: d.dims, theta: d.theta, yRel: d.yRel, archetype: d.archetype, params: d.params, uid: d.uid, drag: d, snap: !this._mods.alt, colliders: d.colliders,
    });
    if (!res) return;
    d.status = res.status;
    d.message = res.message;
    d.note = res.note;
    if (res.status === 'blocked') return;
    const patch = { position: res.position.map(r3) };
    if (Math.abs((res.rotationDeg ?? d.theta) - (item.rotationDeg || 0)) > 1e-3) patch.rotationDeg = res.rotationDeg;
    if (res.attach) patch.attach = res.attach;
    if (res.rotationDeg != null && d.mount !== 'wall') d.theta = res.rotationDeg;
    this._apply(item, patch);
  }

  _apply(item, patch) {
    const p = patch.position;
    const same = (!p || p.every((v, i) => Math.abs(v - item.position[i]) < 5e-4))
      && (patch.rotationDeg == null || Math.abs(patch.rotationDeg - (item.rotationDeg || 0)) < 1e-3)
      && (!patch.attach || JSON.stringify(patch.attach) === JSON.stringify(item.attach));
    if (!same) this.editor.design.update(item.uid, patch);
  }

  /** Forgets a running drag without touching the design (its transaction was closed elsewhere). */
  _abortDrag() {
    if (!this._drag || this._ending) return;
    this._drag = null;
    this._listenDrag(false);
    this._obstacles = null;
    this.editor.hud?.setCursor?.('default');
  }

  _endDrag(commit) {
    const d = this._drag;
    if (!d) return;
    this._drag = null;
    this._listenDrag(false);
    const e = this.editor;
    this._ending = true;
    try {
      if (commit) e.design.end();
      else e.design.cancel();
    } finally {
      this._ending = false;
    }
    if (commit) {
      e.events.emit('sfx', { name: 'place', volume: 0.8 });
      if (d.status === 'overlap' && d.message) e.events.emit('toast', { text: `Obs: ${d.message.toLowerCase()}`, seconds: 2.5 });
    }
    this._obstacles = null;
    e.hud?.setCursor?.('default');
  }

  // ---- solving a candidate -----------------------------------------------------------------------------------

  /**
   * Where an item of a mount would go for the cursor at ndc.
   * @returns {{ mount, position: number[], rotationDeg: number, attach?: object, status: 'ok'|'overlap'|'blocked', message: string, note: string }|null}
   */
  _solveFor(mount, ndc, o) {
    switch (mount) {
      case 'wall':
        return this._solveWall(ndc, o);
      case 'ceiling':
        return this._solveCeiling(ndc, o);
      case 'surface':
        return this._solveSurface(ndc, o);
      case 'soft':
        return this._solveSoft(ndc, o);
      default:
        return this._solveFloor(ndc, mount, o);
    }
  }

  _solveFloor(ndc, mount, o) {
    const d = o.drag;
    let P = this._rayPlane(ndc, d ? d.planeY : this.room.floorY);
    // a room whose floor lies lower than its level's (the entrance): the cursor on that floor
    if (P && !d) {
      const fy = this._floorAt(P.x, P.z);
      if (Math.abs(fy - this.room.floorY) > 0.01) P = this._rayPlane(ndc, fy) ?? P;
    }
    const ray = this._cameraRay(ndc);
    // the floor point would lie behind the wall (or kitchen box) under the cursor – in the next room or outside: use
    // the floor at the foot of that wall instead, the piece turned to face away from it
    const block = this._rayBlocker(ray, P ? P.distanceTo(ray.origin) : 80);
    const dims = o.dims || { w: 0.5, d: 0.5, h: 0.5 };
    let theta = o.theta;
    let x, z;
    if (block) {
      const away = normDeg(Math.atan2(block.nx, block.nz) / DEG);
      if (o.snap && autoFaces(o.archetype)) theta = away;
      else if (o.snap && !d) theta = normDeg(away + o.theta); // R turns it relative to the wall
      const s = extentAlong(theta, dims, block.nx, block.nz);
      x = block.x + block.nx * (s + this.room.gap);
      z = block.z + block.nz * (s + this.room.gap);
    } else {
      if (!P) return null;
      x = P.x + (d?.offset[0] ?? 0);
      z = P.z + (d?.offset[1] ?? 0);
      if (o.snap && this.grid) {
        x = snap(x, GRID);
        z = snap(z, GRID);
      }
    }
    return this._finishFlat(mount, x, z, theta, o, { wallSnap: o.snap });
  }

  /** World ray from the active camera through ndc (a copy). */
  _cameraRay(ndc) {
    const cam = this.editor.activeCamera;
    cam.updateMatrixWorld();
    _ray.setFromCamera(_v2.set(ndc.x, ndc.y), cam);
    return _ray.ray.clone();
  }

  /**
   * The first room wall (seen from the room side) or floor-standing kitchen box a camera ray meets before tMax:
   * { t, x, y, z, nx, nz, name } – the point on its face and the face normal into the room – or null. Walls the
   * overview cuts away do not count (the camera looks through them).
   */
  _rayBlocker(ray, tMax) {
    const room = this.room;
    const O = ray.origin, D = ray.direction;
    if (Math.hypot(D.x, D.z) < 1e-5) return null;
    const hidden = this.editor.views?.hiddenWalls;
    let best = null;
    for (const w of room.walls) {
      if (hidden?.has(w.id)) continue;
      const f0 = (O.x - w.sx) * w.nx + (O.z - w.sz) * w.nz;
      const dn = D.x * w.nx + D.z * w.nz;
      if (f0 < -0.05 || dn > -1e-6) continue; // behind the wall's line, or moving away from it
      const t = Math.max(0, f0) / -dn;
      if (t >= tMax || (best && t >= best.t)) continue;
      const px = O.x + D.x * t, py = O.y + D.y * t, pz = O.z + D.z * t;
      const u = (px - w.sx) * w.dx + (pz - w.sz) * w.dz;
      if (u < -0.02 || u > w.L + 0.02) continue;
      if (py - w.fy < -0.02 || py - w.fy > w.heightAt(clamp(u, 0, w.L)) + 0.02) continue;
      best = { t, x: px, y: py, z: pz, nx: w.nx, nz: w.nz, name: w.name };
    }
    for (const b of room.fixed) {
      if (b.y0 - (b.floor ?? 0) > 0.3) continue; // wall cabinets: the floor below them is free
      const hit = rayBoxXZ(O, D, b);
      if (hit && hit.t < tMax && (!best || hit.t < best.t)) best = { ...hit, name: b.name };
    }
    return best;
  }

  _solveCeiling(ndc, o) {
    const e = this.editor;
    const d = o.drag;
    const walking = e.views?.mode === 'walk' || e.views?.mode === 'photo';
    let x, z;
    const ceil = walking && !d ? pickAt(e, ndc, { want: new Set(['ceiling']), pass: new Set(['item']), exclude: o.uid }) : null;
    if (d) {
      const P = this._rayPlane(ndc, d.planeY);
      if (!P) return null;
      x = P.x + d.offset[0];
      z = P.z + d.offset[1];
    } else if (ceil) {
      x = ceil.point.x;
      z = ceil.point.z;
    } else {
      // the cursor on a table / the floor, or the view from above: hang it over what is under the cursor (the table
      // top, not the floor behind it)
      const hit = pickAt(e, ndc, { want: new Set(['item', 'floor', 'other', 'wall', 'window']), pass: new Set(['ceiling']), exclude: o.uid });
      const P = hit?.point ?? this._rayPlane(ndc, this.room.floorY + (walking ? 2.4 : 0));
      if (!P) return null;
      x = P.x;
      z = P.z;
    }
    if (o.snap && this.grid) {
      x = snap(x, GRID);
      z = snap(z, GRID);
    }
    let theta = o.theta;
    let table = null;
    let centred = false;
    if (!d && o.snap && PENDANT.test(o.archetype || '')) {
      table = this._tableUnder(x, z, o.uid);
      if (table) ({ x, z, theta, centred } = this._overTable(table, x, z, theta, o));
    }
    const res = this._finishFlat('ceiling', x, z, theta, o, { wallSnap: false });
    if (table) {
      const drop = this._dropOver(table, res.position[1], o);
      if (drop) {
        res.patch = { params: { drop: drop.drop } };
        const name = (table.item.name || 'bordet').toLowerCase();
        res.note = `${cm(drop.above)} cm over ${name}${centred ? ' · midt over' : ''}`;
      }
    }
    return res;
  }

  /**
   * The table top under a plan point (an item with a flat top 55–110 cm up): { item, obj, s (surface), topY, lx, lz
   * (point in the table's frame) } or null.
   */
  _tableUnder(x, z, excludeUid) {
    const e = this.editor;
    let best = null;
    const floor = this.room.floorY;
    for (const it of e.design.list()) {
      if (it.hidden || it.uid === excludeUid || it.mount !== 'floor' || itemLevel(it, e.layout) !== this._lv) continue;
      const obj = e.sync.getObject(it.uid);
      const surfaces = obj?.userData?.model?.surfaces;
      if (!surfaces?.length) continue;
      obj.updateMatrixWorld(true);
      const lp = new THREE.Vector3(x, obj.position.y, z).applyMatrix4(_m4.copy(obj.matrixWorld).invert());
      for (const s of surfaces) {
        const topY = obj.position.y + s.y;
        if (topY - floor < 0.55 || topY - floor > 1.1) continue;
        const [cx, cz] = s.center || [0, 0];
        if (Math.abs(lp.x - cx) > s.w / 2 + 0.05 || Math.abs(lp.z - cz) > s.d / 2 + 0.05) continue;
        if (!best || s.w * s.d > best.s.w * best.s.d) best = { item: it, obj, s, topY, lx: lp.x, lz: lp.z };
      }
    }
    return best;
  }

  /** A pendant over a table: linear ones along the long axis (on the axis line), any one centred when close. */
  _overTable(table, x, z, theta, o) {
    const { obj, s } = table;
    const [scx, scz] = s.center || [0, 0];
    const longX = s.w >= s.d;
    let lx = table.lx, lz = table.lz;
    if (isLinear(o.archetype, o.dims)) {
      let th = normDeg(yawOf(obj) + (longX ? 0 : 90));
      if (Math.abs(normDeg(th - theta)) > 90) th = normDeg(th + 180);
      theta = th;
      if (longX) lz = scz;
      else lx = scx;
    }
    let centred = false;
    if (Math.abs(lx - scx) < 0.12 && Math.abs(lz - scz) < 0.12) {
      lx = scx;
      lz = scz;
      centred = true;
    }
    const wp = new THREE.Vector3(lx, s.y, lz).applyMatrix4(obj.matrixWorld);
    return { x: wp.x, z: wp.z, theta, centred };
  }

  /** Suggested drop (ceiling → underside) for a pendant over a table top: ≈ 65 cm above it, within the cable. */
  _dropOver(table, ceilY, o) {
    const def = getArchetype(o.archetype);
    const schema = def?.params?.drop;
    if (!schema && o.params?.drop == null) return null;
    const maxDrop = Number(o.params?.maxDrop) > 0 ? Number(o.params.maxDrop) : Infinity;
    let drop = clamp(ceilY - table.topY - OVER_TABLE, schema?.min ?? 0.05, Math.min(schema?.max ?? 3, maxDrop));
    drop = Math.round(drop * 100) / 100;
    // lamps.js reads the archetype's default drop as «use the catalogue's dropDefault»
    const archDefault = def?.defaults?.params?.drop;
    if (archDefault != null && Math.abs(drop - archDefault) < 1e-6) drop += 0.001;
    return { drop, above: ceilY - drop - table.topY };
  }

  /** Floor / rug / ceiling candidate from a centre: snapping, walls, validity. */
  _finishFlat(mount, x, z, theta, o, { wallSnap }) {
    const room = this.room;
    const dims = o.dims || { w: 0.5, d: 0.5, h: 0.5 };
    const fp = { cx: x, cz: z, hw: dims.w / 2, hd: dims.d / 2, theta: normDeg(theta), ...axes(theta) };
    let note = '';
    if (wallSnap && (mount === 'floor' || mount === 'rug')) note = snapToWalls(room, fp, dims, { autoFace: mount === 'floor' && autoFaces(o.archetype) });
    resolveWalls(room, fp, mount === 'rug' ? 0 : room.gap * 0.5);
    let status = 'ok';
    let message = '';
    const issue = footprintIssue(room, fp);
    if (issue) {
      status = 'blocked';
      message = issue;
    }
    // the floor of the room it stands in (world y), the ceiling of its level there
    const floor = this._floorAt(fp.cx, fp.cz);
    const ceilY = mount === 'ceiling' ? this.editor.home.ceilingHeightAt?.(fp.cx, fp.cz, room.floorY + 1) ?? floor + 2.4 : 0;
    // furniture stands ON a rug (1.5–2 cm), not sunk into it
    const baseY = mount === 'ceiling' ? ceilY : mount === 'floor' ? r3(underlayY(this.editor, fp.cx, fp.cz, o.uid ?? null, 'floor', this._lv)) : floor;
    if (status === 'ok') {
      // the model's collision boxes when it has them (an arc lamp's arm may reach over the sofa)
      const boxes = o.colliders?.length && mount !== 'ceiling' ? colliderBoxes(o.colliders, fp.cx, fp.cz, fp.theta, baseY) : null;
      const yRel = o.yRel || [0, dims.h];
      const hit = this._overlap({ ...fp, y0: baseY + yRel[0], y1: baseY + yRel[1], boxes }, mount, o.uid);
      if (hit) {
        status = hit.block ? 'blocked' : 'overlap';
        message = hit.kind === 'door' ? `Står foran ${hit.name}` : hit.kind === 'swing' ? `I slaget til ${hit.name}` : hit.kind === 'stair' ? 'I trappa' : `Overlapper med ${hit.name}`;
      }
    }
    if (!note && mount !== 'ceiling') {
      const g = nearestWallGap(room, fp);
      if (Number.isFinite(g) && g < 1.2) note = g < 0.02 ? 'inntil veggen' : `${cm(g)} cm til veggen`;
    }
    if (mount === 'ceiling') note = `${cm(ceilY - floor)} cm takhøyde`;
    if (o.snap && this.grid && !note) note = 'rutenett 10 cm';
    return { mount, position: [fp.cx, baseY, fp.cz], rotationDeg: fp.theta, status, message, note };
  }

  /**
   * How a wall item of height h fits under a wall top: { h (possibly cut), cut, blocked, minBottom }. Items sit above
   * the skirting when they fit there; slat panels taller than that are cut to length, anything else taller than the
   * wall is refused.
   */
  _fitHeight(h, top, archetype) {
    const sk = this.room.skirting;
    const avail = top - sk - 0.015;
    if (CUT_TO_LENGTH.has(archetype) && h > avail + 0.002) return { h: Math.max(0.2, Math.floor(avail * 100) / 100), cut: true, blocked: false, minBottom: sk + 0.005 };
    if (h > top - 0.02) return { h, cut: false, blocked: true, minBottom: 0.01 };
    return { h, cut: false, blocked: false, minBottom: h <= avail ? sk + 0.005 : 0.01 };
  }

  _solveWall(ndc, o) {
    const e = this.editor;
    const room = this.room;
    const d = o.drag;
    const hit = pickAt(e, ndc, { want: new Set(['wall']), pass: new Set(['item']), exclude: o.uid });
    let w = hit ? room.walls.find((x) => x.id === hit.wallId) : null;
    let u, v; // v: height above the wall's floor
    if (w && (!d || w.id !== d.wallId || !d.wallId)) {
      u = (hit.point.x - w.sx) * w.dx + (hit.point.z - w.sz) * w.dz;
      v = hit.point.y - w.fy;
      if (d) {
        if (d.wallId && w.id !== d.wallId) d.offset[0] = 0; // moved onto another wall: centre under the cursor
        d.wallId = w.id;
      }
    } else if (d?.wallId) {
      w = room.walls.find((x) => x.id === d.wallId);
      if (!w) return null;
      // keep following on the plane of the current wall
      _ray.setFromCamera(_v2.set(ndc.x, ndc.y), e.activeCamera);
      _plane.setFromNormalAndCoplanarPoint(_v3.set(w.nx, 0, w.nz), new THREE.Vector3(w.sx, 0, w.sz));
      const P = _ray.ray.intersectPlane(_plane, new THREE.Vector3());
      if (!P) return null;
      u = (P.x - w.sx) * w.dx + (P.z - w.sz) * w.dz;
      v = P.y - w.fy;
    } else return null;
    const dims = o.dims || { w: 0.5, d: 0.05, h: 0.5 };
    if (d) {
      u += d.offset[0];
      v += d.offset[1];
    } else v = o.v ?? 1.5;
    if (o.snap && this.grid) {
      u = snap(u, GRID);
      v = snap(v, GRID / 2);
    }
    let note = '';
    // centre on the wall when close
    if (o.snap && Math.abs(u - w.L / 2) < CENTER_SNAP && w.L > dims.w + 0.1) {
      u = w.L / 2;
      note = 'midt på veggen';
    }
    // keep it on the wall
    const hw = dims.w / 2;
    let status = 'ok';
    let message = '';
    if (dims.w > w.L - 0.02) {
      status = 'blocked';
      message = 'For bred for veggen';
    }
    u = clamp(u, Math.min(hw + 0.005, w.L / 2), Math.max(w.L - hw - 0.005, w.L / 2));
    const top = Math.min(w.heightAt(clamp(u - hw, 0, w.L)), w.heightAt(u), w.heightAt(clamp(u + hw, 0, w.L)));
    // taller than the wall: slat panels are cut to length (the ghost shows the cut panel), the rest cannot hang here
    const fit = this._fitHeight(dims.h, top, o.archetype);
    let patch = null;
    let cutNote = '';
    if (fit.blocked && status === 'ok') {
      status = 'blocked';
      message = 'For høy for veggen';
    } else if (fit.cut) {
      if (!d) {
        patch = { dims: { h: fit.h } };
        cutNote = `kappes til ${cm(fit.h)} cm`;
      } else if (status === 'ok') {
        status = 'overlap';
        message = `Høyere enn veggen – kappes til ${cm(fit.h)} cm`;
      }
    }
    const hh = (fit.cut ? fit.h : dims.h) / 2;
    v = clamp(v, fit.minBottom + hh, Math.max(fit.minBottom + hh, top - hh - 0.01));
    if (status === 'ok' && v + hh > top + 0.005) {
      status = 'blocked';
      message = 'For høy for veggen';
    }
    // openings on the wall (windows, doors) cannot carry anything
    if (status === 'ok') {
      for (const op of w.openings) {
        if (u + hw > op.u0 + 0.01 && u - hw < op.u1 - 0.01 && v + hh > op.sill + 0.01 && v - hh < op.top - 0.01) {
          status = 'blocked';
          message = op.type === 'door' ? 'Over døra' : op.type === 'terrace-door' ? 'Over terrassedøra' : 'Over vinduet';
          break;
        }
      }
    }
    const x = w.sx + w.dx * u, z = w.sz + w.dz * u;
    const theta = normDeg(Math.atan2(w.nx, w.nz) / DEG);
    if (status === 'ok') {
      const fp = { cx: x + w.nx * dims.d / 2, cz: z + w.nz * dims.d / 2, ax: [w.dx, w.dz], az: [w.nx, w.nz], hw, hd: dims.d / 2 };
      const hit2 = this._overlap({ ...fp, y0: w.fy + v - hh, y1: w.fy + v + hh }, 'wall', o.uid);
      if (hit2) {
        status = 'overlap';
        message = `Overlapper med ${hit2.name}`;
      }
    }
    if (!note) note = `midt ${cm(v)} cm · underkant ${cm(v - hh)} cm`;
    if (cutNote) note = `${cutNote} · ${note}`;
    const res = { mount: 'wall', position: [x, w.fy + v, z], rotationDeg: theta, attach: { wallId: w.id, normal: [r3(w.nx), 0, r3(w.nz)] }, status, message, note };
    if (patch) res.patch = patch;
    return res;
  }

  _solveSurface(ndc, o) {
    const e = this.editor;
    const room = this.room;
    const dims = o.dims || { w: 0.2, d: 0.2, h: 0.3 };
    const hit = pickAt(e, ndc, {
      want: new Set(['item', 'floor', 'other', 'window', 'wall']),
      exclude: o.uid,
      // the sideboard / shelves of the high-wall design carry things too; any other wall only hides what is behind it;
      // the side of a small thing without a top (a candle on the sill) is looked through
      accept: (h) => {
        if (h.kind === 'wall') return !!h.design && !!this._designSurface(h.point, h.normal, o.theta, dims);
        if (h.kind === 'item') return h.normal.y > 0.7 || !!this._surfaceOf(h.uid, h.point, o.theta, dims, h.normal);
        return h.normal.y > 0.7;
      },
    });
    if (!hit) return null;
    let x = hit.point.x, z = hit.point.z, y = hit.point.y;
    if (o.snap && this.grid) {
      x = snap(x, GRID);
      z = snap(z, GRID);
    }
    let note = '';
    let status = 'ok';
    let message = '';
    let supportUid = null;
    const onTop = (top, what) => {
      const c = top.clampXZ(x, z);
      x = c.x;
      y = c.y;
      z = c.z;
      if (!c.fits) {
        status = 'overlap';
        message = `For stor for ${what}`;
      }
    };
    if (hit.kind === 'item') {
      const sup = e.design.get(hit.uid);
      const name = (sup?.name || 'bordet').toLowerCase();
      const top = this._surfaceOf(hit.uid, hit.point, o.theta, dims, hit.normal);
      supportUid = hit.uid;
      if (top) onTop(top, name);
      else if (hit.normal.y <= 0.7) return null;
      note = `på ${name}`;
    } else if (hit.kind === 'wall') {
      onTop(this._designSurface(hit.point, hit.normal, o.theta, dims), 'hylla');
      note = 'på den høye veggen';
    } else {
      const sill = sillAt(room, hit.point, hit.kind === 'window' ? 0.08 : 0.03);
      const k = sill ? null : kitchenTopAt(room, hit.point);
      if (sill) {
        const c = clampToSill(sill, x, z, o.theta, dims);
        x = c.x;
        y = c.y;
        z = c.z;
        note = 'i vinduskarmen';
        if (!c.fits) {
          status = 'overlap';
          message = 'For stor for vinduskarmen';
        }
      } else if (k) {
        const c = clampToBoxTop(k, x, z, o.theta, dims);
        x = c.x;
        y = c.y;
        z = c.z;
        note = k.kind === 'builtin' ? `på ${k.name}` : /øy/i.test(k.name || '') ? 'på kjøkkenøya' : 'på kjøkkenbenken';
        if (!c.fits) {
          status = 'overlap';
          message = 'For stor for benken';
        }
      } else if (hit.kind === 'window') return null; // the glass / a frame part that is not the board
      else if (hit.kind === 'other' && e.home.roots.kitchen && isUnder(hit.object, e.home.roots.kitchen)) note = 'på kjøkkenbenken';
      else if (hit.kind === 'floor') {
        note = 'på gulvet';
        const fp = { cx: x, cz: z, hw: dims.w / 2, hd: dims.d / 2, ...axes(o.theta) };
        resolveWalls(room, fp, room.gap * 0.5);
        x = fp.cx;
        z = fp.cz;
        const issue = footprintIssue(room, fp);
        if (issue) {
          status = 'blocked';
          message = issue;
        }
      }
    }
    if (status !== 'blocked') {
      const fp = { cx: x, cz: z, hw: dims.w / 2, hd: dims.d / 2, ...axes(o.theta) };
      const yRel = o.yRel || [0, dims.h];
      const boxes = o.colliders?.length ? colliderBoxes(o.colliders, x, z, o.theta, y) : null;
      // the table it stands on is not an obstacle (nesting tables: its bounds reach above the lower top)
      const over = this._overlap({ ...fp, y0: y + yRel[0], y1: y + yRel[1], boxes }, 'surface', o.uid, supportUid);
      if (over && status === 'ok') {
        status = 'overlap';
        message = `Overlapper med ${over.name}`;
      }
    }
    return { mount: 'surface', position: [x, y, z], rotationDeg: normDeg(o.theta), status, message, note };
  }

  /**
   * The flat top (userData.model.surfaces) of an item under a world point, with a clamp that keeps a footprint on it.
   * @returns {{ y: number, clampXZ: (x: number, z: number) => { x, y, z, fits } }|null}
   */
  _surfaceOf(uid, point, thetaDeg, dims, normal = null) {
    const obj = this.editor.sync.getObject(uid);
    return this._surfaceOn(obj, obj?.userData?.model?.surfaces, point, thetaDeg, dims, normal);
  }

  /** The shelf / sideboard top of the high-wall design under a world point (like _surfaceOf). */
  _designSurface(point, normal, thetaDeg, dims) {
    const wd = this.editor.home.highWall?.anchor?.userData?.wallDesign;
    return this._surfaceOn(wd, wd?.userData?.model?.surfaces, point, thetaDeg, dims, normal);
  }

  /**
   * A top among `surfaces` (in obj's frame) for a world point: the highest one at or below the point – or, when the
   * point is on a front / side face, the lowest one just above it (pointing at the doors of a sideboard means its
   * top). The clamp keeps a w × d footprint at thetaDeg on it (fits = false when it is larger than the top).
   */
  _surfaceOn(obj, surfaces, point, thetaDeg, dims, normal = null) {
    if (!obj || !surfaces?.length) return null;
    obj.updateMatrixWorld(true);
    const m = obj.matrixWorld;
    const inv = new THREE.Matrix4().copy(m).invert();
    const lp = point.clone().applyMatrix4(inv);
    const side = !!normal && Math.abs(normal.y) < 0.5;
    let best = null;
    for (const s of surfaces) {
      const [cx, cz] = s.center || [0, 0];
      if (Math.abs(lp.x - cx) > s.w / 2 + 0.03 || Math.abs(lp.z - cz) > s.d / 2 + 0.03) continue;
      if (side) {
        if (s.y < lp.y - 0.06 || s.y > lp.y + 0.5) continue;
        if (!best || s.y < best.y) best = s;
      } else {
        if (s.y > lp.y + 0.06) continue;
        if (!best || s.y > best.y) best = s;
      }
    }
    if (!best) return null;
    const s = best;
    const [cx, cz] = s.center || [0, 0];
    const dth = (thetaDeg - yawOf(obj)) * DEG;
    const ex = Math.abs(Math.cos(dth)) * dims.w / 2 + Math.abs(Math.sin(dth)) * dims.d / 2;
    const ez = Math.abs(Math.sin(dth)) * dims.w / 2 + Math.abs(Math.cos(dth)) * dims.d / 2;
    return {
      y: new THREE.Vector3(cx, s.y, cz).applyMatrix4(m).y,
      clampXZ: (x, z) => {
        const l = new THREE.Vector3(x, s.y, z).applyMatrix4(inv);
        const lx = s.w / 2 > ex ? clamp(l.x, cx - s.w / 2 + ex, cx + s.w / 2 - ex) : cx;
        const lz = s.d / 2 > ez ? clamp(l.z, cz - s.d / 2 + ez, cz + s.d / 2 - ez) : cz;
        const wp = new THREE.Vector3(lx, s.y, lz).applyMatrix4(m);
        return { x: wp.x, y: wp.y, z: wp.z, fits: s.w / 2 + 0.01 >= ex && s.d / 2 + 0.01 >= ez };
      },
    };
  }

  _solveSoft(ndc, o) {
    const e = this.editor;
    const hit = pickAt(e, ndc, {
      want: new Set(['item', 'floor', 'other', 'wall']),
      exclude: o.uid,
      // the top of the wall design's sideboard / shelves carries cushions too; other walls only hide what is behind
      accept: (h) => h.kind !== 'wall' || (!!h.design && h.normal.y > 0.55),
    });
    if (!hit) return null;
    const dims = o.dims || { w: 0.45, d: 0.15, h: 0.45 };
    let theta = o.theta;
    let x = hit.point.x, y = hit.point.y, z = hit.point.z;
    let note = hit.kind === 'floor' ? 'på gulvet' : hit.kind === 'wall' ? 'på den høye veggen' : '';
    const leaned = this._leanOnSeat(hit, o, dims);
    if (leaned) return leaned;
    if (hit.normal.y < 0.55) {
      if (hit.kind !== 'item' || Math.abs(hit.normal.y) > 0.6) return null;
      // lean against a backrest: front along the hit normal, standing on the seat below
      const nx = hit.normal.x, nz = hit.normal.z;
      const len = Math.hypot(nx, nz) || 1;
      theta = normDeg(Math.atan2(nx / len, nz / len) / DEG);
      const lean = leanDepth(o, dims) + 0.005;
      x = hit.point.x + (nx / len) * lean;
      z = hit.point.z + (nz / len) * lean;
      const below = this._dropY(x, hit.point.y + 0.02, z, o.uid);
      if (below == null || below < hit.point.y - 1.2) return null;
      y = below;
      note = 'lent mot ryggen';
    }
    if (hit.kind === 'item' && !note) {
      const sup = e.design.get(hit.uid);
      note = `på ${(sup?.name || 'møbelet').toLowerCase()}`;
    }
    if (hit.kind === 'floor') {
      // on the floor: not into the wall
      const fp = { cx: x, cz: z, hw: dims.w / 2, hd: dims.d / 2, ...axes(theta) };
      resolveWalls(this.room, fp, 0.005);
      x = fp.cx;
      z = fp.cz;
    }
    return { mount: 'soft', position: [x, y, z], rotationDeg: theta, status: 'ok', message: '', note };
  }

  /**
   * Cushions on a sofa / armchair: a hit on the top of the backrest or an armrest (above the seat) stands the cushion
   * on the seat leaning against it – facing forward from the back, inward from an arm.
   * @returns {object|null} candidate
   */
  _leanOnSeat(hit, o, dims) {
    if (hit.kind !== 'item') return null;
    const sup = this.editor.sync.getObject(hit.uid);
    const seatY = sup?.userData?.model?.seatY;
    if (seatY == null || o.archetype === 'throw') return null;
    sup.updateMatrixWorld(true);
    const seatWorld = sup.position.y + seatY;
    if (hit.point.y < seatWorld + 0.1) return null;
    const it = this.editor.design.get(hit.uid);
    const sd = it?.dims || { w: 1, d: 1 };
    const inv = new THREE.Matrix4().copy(sup.matrixWorld).invert();
    const lp = hit.point.clone().applyMatrix4(inv);
    const t = sup.rotation.y;
    let fx, fz;
    const nearSide = Math.abs(lp.x) > sd.w / 2 - Math.min(0.28, sd.w * 0.2) && lp.z > -sd.d / 2 + Math.min(0.3, sd.d * 0.3);
    if (nearSide) {
      // armrest: face inward along the seat's x axis
      const s = lp.x > 0 ? -1 : 1;
      fx = Math.cos(t) * s;
      fz = -Math.sin(t) * s;
    } else if (Math.abs(hit.normal.y) > 0.55) {
      fx = Math.sin(t);
      fz = Math.cos(t);
    } else return null; // a vertical face: the normal-based lean below handles it
    // find the front face of the backrest / arm (where the seat starts below), then stand the cushion against it
    let face = null;
    for (let k = 0; k <= 25; k++) {
      const px = hit.point.x + fx * k * 0.02, pz = hit.point.z + fz * k * 0.02;
      const yy = this._dropY(px, hit.point.y + 0.02, pz, o.uid);
      if (yy < hit.point.y - 0.08) {
        face = k * 0.02;
        break;
      }
    }
    if (face == null) return null;
    const lean = face + leanDepth(o, dims) + 0.005;
    const x = hit.point.x + fx * lean, z = hit.point.z + fz * lean;
    const y = this._dropY(x, hit.point.y + 0.02, z, o.uid);
    if (y < seatWorld - 0.25) return null;
    const theta = normDeg(Math.atan2(fx, fz) / DEG);
    return { mount: 'soft', position: [x, y, z], rotationDeg: theta, status: 'ok', message: '', note: nearSide ? 'lent mot armlenet' : 'lent mot ryggen' };
  }

  /**
   * Height of the first surface straight below a point (items, shell, kitchen, the wall design; 0 = floor), ignoring
   * one item.
   * @returns {number}
   */
  dropY(x, y, z, excludeUid) {
    return this._dropY(x, y, z, excludeUid);
  }

  _dropY(x, y, z, excludeUid) {
    // nothing below: the floor of the level the point is on
    return this._dropHit(x, y, z, excludeUid)?.point.y ?? floorYAt(this.editor.layout, x, z, levelAtY(this.editor.layout, y));
  }

  /**
   * The first visible surface straight below a point ({ point, object } | null), ignoring one item; hits above maxY
   * (things that overlap an item rather than carry it) are passed through.
   */
  _dropHit(x, y, z, excludeUid, maxY = Infinity) {
    const e = this.editor;
    _ray.set(new THREE.Vector3(x, y, z), _down);
    _ray.far = 3;
    const roots = [];
    const skip = excludeUid instanceof Set ? excludeUid : null;
    for (const ob of e.sync.objects()) if (ob.visible && (skip ? !skip.has(ob.userData.uid) : ob.userData.uid !== excludeUid)) roots.push(ob);
    for (const k of ['shell', 'kitchen', 'wall']) if (e.home.roots?.[k]) roots.push(e.home.roots[k]);
    roots.push(...houseRoots(e.home)); // the other rooms' floors, built-ins (the vanity top, the laundry bench …)
    for (const r of e.views?.pickRoots?.() || []) roots.push(r);
    for (const hit of intersectFast(roots, _ray)) {
      const o = hit.object;
      if (!o.isMesh || o.userData.isHighlight || o.userData.ghost || e.views?.isConcealed?.(o)) continue;
      // a level / a room's contents that visibility.js hides (§4.12) carries nothing
      if (!visibleChain(o)) continue;
      let m = o.material;
      if (Array.isArray(m)) m = m[hit.face?.materialIndex ?? 0];
      if (!m || m.visible === false || m.colorWrite === false || (m.transparent && m.opacity < 0.04)) continue;
      if (hit.point.y > maxY) continue;
      // the underside of something (double-sided paper, a thing standing on the same board): nothing to rest on
      if (hit.face && _v3.copy(hit.face.normal).transformDirection(o.matrixWorld).y < -0.2) continue;
      return { point: hit.point, object: o };
    }
    return null;
  }

  /**
   * What stands below a point: { kind: 'item'|'design'|'sill'|'kitchen'|'floor'|'other', name, y, clamp?(x, z) →
   * { x, y, z, fits } } – clamp keeps a footprint (thetaDeg, dims) on a flat top (table, sideboard, window board,
   * kitchen counter, the shelves of the wall design).
   */
  _supportAt(x, y, z, excludeUid, thetaDeg, dims, maxY = Infinity, depth = 0) {
    const e = this.editor;
    const room = this.room;
    const hit = this._dropHit(x, y, z, excludeUid, maxY);
    if (!hit) return { kind: 'floor', name: 'gulvet', y: underlayY(e, x, z, excludeUid, 'floor', this._lv) };
    const p = hit.point;
    let uid = null;
    for (let o = hit.object; o; o = o.parent) {
      if (o.userData?.pick?.kind === 'item') {
        uid = o.userData.pick.uid;
        break;
      }
    }
    if (uid) {
      const it = e.design.get(uid);
      const name = (it?.name || 'møbelet').toLowerCase();
      const top = this._surfaceOf(uid, p, thetaDeg, dims);
      if (!top && depth < 3 && (it?.mount === 'surface' || it?.mount === 'soft')) {
        // a stack of books / a tray on the window board: stand on it, but keep within what it stands on
        const ex = new Set(excludeUid instanceof Set ? excludeUid : excludeUid ? [excludeUid] : []);
        ex.add(uid);
        const under = this._supportAt(x, y, z, ex, thetaDeg, dims, maxY, depth + 1);
        if (under.clamp) {
          return {
            kind: under.kind, name: under.name, y: p.y,
            clamp: (cx, cz) => {
              const c = under.clamp(cx, cz);
              // still on the thing it stands on there? else down onto the board / table
              const below = this._dropHit(c.x, p.y + 0.05, c.z, excludeUid, p.y + 0.02);
              return { ...c, y: below && below.point.y > c.y + 0.003 ? below.point.y : c.y };
            },
          };
        }
      }
      return { kind: 'item', name, y: p.y, clamp: top ? (cx, cz) => top.clampXZ(cx, cz) : null };
    }
    const anchor = e.home.highWall?.anchor;
    if (anchor && isUnder(hit.object, anchor)) {
      const top = this._designSurface(p, null, thetaDeg, dims);
      return { kind: 'design', name: 'hylla', y: p.y, clamp: top ? (cx, cz) => top.clampXZ(cx, cz) : null };
    }
    const sill = sillAt(room, p);
    if (sill) return { kind: 'sill', name: 'vinduskarmen', y: sill.y, clamp: (cx, cz) => clampToSill(sill, cx, cz, thetaDeg, dims) };
    const k = kitchenTopAt(room, p);
    if (k) return { kind: 'kitchen', name: 'benken', y: k.y1, clamp: (cx, cz) => clampToBoxTop(k, cx, cz, thetaDeg, dims) };
    return { kind: p.y - this._floorAt(p.x, p.z) < 0.05 ? 'floor' : 'other', name: 'gulvet', y: p.y };
  }

  // ---- overlap -----------------------------------------------------------------------------------------------

  /** Footprints of everything a candidate could collide with (cached until the design changes). */
  _obstacleList() {
    if (this._obstacles && this._obstacles.level === this._lv) return this._obstacles;
    const e = this.editor;
    const list = [];
    for (const it of e.design.list()) {
      // the furniture of the operation's level only (the basement lies under the first floor, at the same x/z)
      if (it.hidden || itemLevel(it, e.layout) !== this._lv) continue;
      const b = e.sync.objectBounds(it.uid, new THREE.Box3());
      if (!b || !Number.isFinite(b.min.y)) continue;
      const p = it.position;
      const dims = it.dims;
      let fp;
      let boxes = null;
      if (it.mount === 'wall') {
        const n = it.attach?.normal || [Math.sin((it.rotationDeg || 0) * DEG), 0, Math.cos((it.rotationDeg || 0) * DEG)];
        fp = { cx: p[0] + n[0] * dims.d / 2, cz: p[2] + n[2] * dims.d / 2, ax: [n[2], -n[0]], az: [n[0], n[2]], hw: dims.w / 2, hd: dims.d / 2 };
      } else {
        fp = { cx: p[0], cz: p[2], hw: dims.w / 2, hd: dims.d / 2, ...axes(it.rotationDeg || 0) };
        // the model's own collision boxes (the base and the shade of an arc lamp, the two legs of a corner sofa …)
        const obj = it.mount !== 'ceiling' ? e.sync.getObject(it.uid) : null;
        const col = obj?.userData?.model?.colliders;
        if (col?.length) boxes = colliderBoxes(col, p[0], p[2], it.rotationDeg || 0, obj.position.y);
      }
      list.push({ ...fp, y0: b.min.y, y1: b.max.y, boxes, name: it.name || 'et møbel', uid: it.uid, mount: it.mount, kind: 'item' });
    }
    const room = this.room;
    this._obstacles = { level: this._lv, items: list, fixed: room.fixed, doors: room.doors };
    return this._obstacles;
  }

  /**
   * The first thing a candidate footprint overlaps (null = free). c: { cx, cz, ax, az, hw, hd, y0, y1, boxes? } –
   * boxes (collision boxes of the model) replace the single footprint when given, on both sides.
   */
  _overlap(c, mount, selfUid, supportUid = null) {
    if (mount === 'soft') return null;
    const obs = this._obstacleList();
    const cand = c.boxes?.length ? c.boxes : [c];
    const hits = (o, tol) => {
      const other = o.boxes?.length ? o.boxes : [o];
      for (const a of cand) {
        for (const b of other) if (Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0) > 0.01 && obbOverlap(a, b, tol)) return true;
      }
      return false;
    };
    // what cannot be placed at all first (the stair, the swing of a door the player opens), then the rest; things on
    // the wall or under the ceiling may hang over the stair
    const standing = mount !== 'wall' && mount !== 'ceiling';
    if (standing) for (const o of obs.fixed) if (o.block && hits(o)) return o;
    if (mount === 'floor') for (const o of obs.doors) if (o.block && hits(o, 0.03)) return o;
    for (const o of obs.items) {
      if (o.uid === selfUid || o.uid === supportUid || o.mount === 'soft') continue;
      if ((mount === 'rug') !== (o.mount === 'rug')) continue;
      if (hits(o)) return o;
    }
    for (const o of obs.fixed) if (!o.block && hits(o)) return o;
    if (mount === 'floor') for (const o of obs.doors) if (!o.block && hits(o, 0.03)) return o;
    return null;
  }

  // ---- helpers for Selection ---------------------------------------------------------------------------------

  /**
   * Keeps an item inside the room after a nudge / rotation (no snapping): floor-like items are pushed out of the
   * walls, wall items stay on their wall (and under its top), surface items stay on the top they stand on (table,
   * window board inside the reveal, kitchen counter, shelf), cushions / throws rest on what is below them.
   * @param {object} item  item-like ({ mount, position, rotationDeg, dims, attach, uid }); `_from` / `_exclude`:
   *   the original's position / uid when the item is a copy (Dupliser)
   * @returns {{ position: number[], rotationDeg: number, attach?: object, status: string, message: string, dims? }}
   *   dims: the size it would need (a slat panel taller than the wall, cut to length)
   */
  constrain(item) {
    // on the item's own level (its plan, its floor); positions are world space
    return this._inLevel(itemLevel(item, this.editor.layout), () => this._constrainWorld(item));
  }

  /** constrain() with world positions (on the operation's level). */
  _constrainWorld(item) {
    const p = item.position || [0, 0, 0];
    const dims = item.dims || { w: 0.5, d: 0.5, h: 0.5 };
    const ref = item.uid ?? item._exclude ?? null;
    const obj = ref ? this.editor.sync.getObject(ref) : null;
    let yRel = [0, dims.h];
    if (obj) {
      obj.updateMatrixWorld(true);
      _box.setFromObject(obj);
      if (Number.isFinite(_box.min.y)) yRel = [_box.min.y - obj.position.y, _box.max.y - obj.position.y];
    }
    const o = { dims, yRel, uid: item.uid, snap: false, archetype: item.archetype, colliders: obj?.userData?.model?.colliders };
    if (item.mount === 'floor' || item.mount === 'rug' || item.mount === 'ceiling') {
      const r = this._finishFlat(item.mount, p[0], p[2], item.rotationDeg || 0, o, { wallSnap: false });
      if (item.mount !== 'floor') r.position[1] = p[1];
      return r;
    }
    if (item.mount === 'wall') {
      const w = this._wallFor(item);
      if (!w) return { position: p, rotationDeg: item.rotationDeg || 0, status: 'ok', message: '' };
      const hw = dims.w / 2;
      let u = (p[0] - w.sx) * w.dx + (p[2] - w.sz) * w.dz;
      u = clamp(u, Math.min(hw, w.L / 2), Math.max(w.L - hw, w.L / 2));
      const top = Math.min(w.heightAt(clamp(u - hw, 0, w.L)), w.heightAt(u), w.heightAt(clamp(u + hw, 0, w.L)));
      const fit = this._fitHeight(dims.h, top, item.archetype);
      const hh = (fit.cut ? fit.h : dims.h) / 2;
      // v: above the wall's floor
      const v = clamp(p[1] - w.fy, fit.minBottom + hh, Math.max(fit.minBottom + hh, top - hh - 0.01));
      let status = 'ok';
      let message = '';
      if (fit.blocked) {
        status = 'blocked';
        message = 'For høy for veggen';
      } else if (fit.cut) {
        status = 'overlap';
        message = `Høyere enn veggen – kappes til ${cm(fit.h)} cm`;
      }
      if (status !== 'blocked') {
        for (const op of w.openings) {
          if (u + hw > op.u0 + 0.01 && u - hw < op.u1 - 0.01 && v + hh > op.sill + 0.01 && v - hh < op.top - 0.01) {
            status = 'blocked';
            message = op.type === 'door' ? 'Over døra' : 'Over vinduet';
          }
        }
      }
      const out = {
        position: [w.sx + w.dx * u, w.fy + v, w.sz + w.dz * u],
        rotationDeg: normDeg(Math.atan2(w.nx, w.nz) / DEG),
        attach: { ...(item.attach || {}), wallId: w.id, normal: [r3(w.nx), 0, r3(w.nz)] },
        status,
        message,
      };
      if (fit.cut) out.dims = { ...dims, h: fit.h };
      return out;
    }
    if (item.mount === 'surface' || item.mount === 'soft') return this._constrainOnSupport(item, dims);
    return { position: p, rotationDeg: item.rotationDeg || 0, status: 'ok', message: '' };
  }

  /** constrain() for surface / soft items: stay on the support it stands on, else rest on what is below, in the room. */
  _constrainOnSupport(item, dims) {
    const e = this.editor;
    const room = this.room;
    const p = item.position || [0, 0, 0];
    const theta = item.rotationDeg || 0;
    const exclude = item.uid ?? item._exclude ?? null;
    const stored = item.uid ? e.design.get(item.uid) : null;
    const from = item._from ?? (stored ? this._world(stored) : null) ?? p;
    let x = p[0], y = p[1], z = p[2];
    let status = 'ok';
    let message = '';
    // a lamp / vase stays on the top it stands on (the table edge stops it); cushions and throws may fall off
    const sup = item.mount === 'surface' ? this._supportAt(from[0], from[1] + 0.05, from[2], exclude, theta, dims, from[1] + 0.02) : null;
    if (sup?.clamp) {
      const c = sup.clamp(x, z);
      x = c.x;
      y = c.y;
      z = c.z;
      if (!c.fits) {
        status = 'overlap';
        message = `For stor for ${sup.name}`;
      }
    } else {
      // what is below the new spot: another top (stay on it), the floor or a seat (rest on it) – inside the room
      const start = Math.max(p[1], from[1]) + (item.mount === 'soft' ? 0.1 : 0.05);
      let below = this._supportAt(x, start, z, exclude, theta, dims);
      if (below.clamp && item.mount === 'surface') {
        const c = below.clamp(x, z);
        x = c.x;
        y = c.y;
        z = c.z;
      } else {
        // cushions lean back past their footprint: a little more room from the wall
        const fp = { cx: x, cz: z, hw: dims.w / 2, hd: dims.d / 2, ...axes(theta) };
        resolveWalls(room, fp, item.mount === 'soft' ? 0.03 : room.gap * 0.5);
        if (Math.hypot(fp.cx - x, fp.cz - z) > 1e-4) {
          x = fp.cx;
          z = fp.cz;
          below = this._supportAt(x, start, z, exclude, theta, dims);
        }
        y = below.kind === 'floor' ? underlayY(e, x, z, exclude, 'floor', this._lv) : below.y;
        const issue = footprintIssue(room, fp);
        if (issue) {
          status = 'blocked';
          message = issue;
        }
      }
    }
    return { position: [x, y, z], rotationDeg: theta, status, message };
  }

  /**
   * Offset for a duplicate: beside the original (right, left, in front, behind), on a free spot inside the room (on
   * the same table / window board for surface items).
   * @returns {number[]} [dx, dy, dz]
   */
  duplicateOffset(item) {
    const p = item.position;
    const dims = item.dims || { w: 0.5, d: 0.5, h: 0.5 };
    const tries = [];
    if (item.mount === 'wall') {
      const n = item.attach?.normal || [Math.sin((item.rotationDeg || 0) * DEG), 0, Math.cos((item.rotationDeg || 0) * DEG)];
      const rx = n[2], rz = -n[0];
      const s = dims.w + 0.1;
      tries.push([rx * s, 0, rz * s], [-rx * s, 0, -rz * s], [0, dims.h + 0.1, 0], [0, -(dims.h + 0.1), 0]);
    } else {
      const { ax, az } = axes(item.rotationDeg || 0);
      const small = item.mount === 'surface' || item.mount === 'soft';
      const gap = small ? 0.04 : 0.1;
      const sw = dims.w + gap, sd = dims.d + gap;
      tries.push([ax[0] * sw, 0, ax[1] * sw], [-ax[0] * sw, 0, -ax[1] * sw], [az[0] * sd, 0, az[1] * sd], [-az[0] * sd, 0, -az[1] * sd]);
      // a crowded window board / table: one step further along it
      if (small) tries.push([ax[0] * sw * 2, 0, ax[1] * sw * 2], [-ax[0] * sw * 2, 0, -ax[1] * sw * 2]);
    }
    let fallback = null;
    for (const t of tries) {
      const cand = { ...item, uid: undefined, _from: p, _exclude: item.uid, position: [p[0] + t[0], p[1] + t[1], p[2] + t[2]] };
      const r = this.constrain(cand);
      if (r.status === 'blocked') continue;
      const off = [r.position[0] - p[0], r.position[1] - p[1], r.position[2] - p[2]];
      if (Math.hypot(off[0], off[1], off[2]) < 0.05) continue;
      // a copy that only fits on top of the original (no room beside it on the table) is no free spot
      if ((item.mount === 'surface' || item.mount === 'soft') && Math.abs(off[0]) < dims.w * 0.6 && Math.abs(off[2]) < dims.d * 0.6) continue;
      if (r.status === 'ok' && this._overlapFor(item, r.position) == null) return off.map(r3);
      fallback ||= off.map(r3);
    }
    return fallback || [0.3, 0, 0.3];
  }

  /** What an item would overlap at a position (world), on its level. */
  _overlapFor(item, position) {
    const dims = item.dims;
    if (item.mount === 'wall' || item.mount === 'soft') return null;
    return this._inLevel(itemLevel(item, this.editor.layout), () => {
      const base = this.room.floorY;
      const fp = { cx: position[0], cz: position[2], hw: dims.w / 2, hd: dims.d / 2, ...axes(item.rotationDeg || 0) };
      const y = item.mount === 'ceiling' ? (this.editor.home.ceilingHeightAt?.(position[0], position[2], base + 1) ?? base + 2.4) - dims.h : position[1];
      const obj = item.mount !== 'ceiling' && item.uid ? this.editor.sync.getObject(item.uid) : null;
      const col = obj?.userData?.model?.colliders;
      const boxes = col?.length ? colliderBoxes(col, position[0], position[2], item.rotationDeg || 0, y) : null;
      return this._overlap({ ...fp, y0: y, y1: y + dims.h, boxes }, item.mount, null);
    });
  }

  /** The room wall an item hangs on (attach.wallId, else the nearest wall facing its front). */
  _wallFor(item) {
    const room = this.room;
    if (item.attach?.wallId) {
      const w = room.walls.find((x) => x.id === item.attach.wallId);
      if (w) return w;
    }
    const p = item.position;
    let best = null;
    for (const w of room.walls) {
      const along = (p[0] - w.sx) * w.dx + (p[2] - w.sz) * w.dz;
      if (along < -0.1 || along > w.L + 0.1) continue;
      const dist = Math.abs((p[0] - w.sx) * w.nx + (p[2] - w.sz) * w.nz);
      if (!best || dist < best.dist) best = { w, dist };
    }
    return best?.w ?? null;
  }

  /** Height of the drag plane: the grab point, but never close to the eye height (a grazing plane is useless). */
  _dragPlaneY(y) {
    const cam = this.editor.activeCamera;
    cam.updateMatrixWorld();
    const cy = _v3.setFromMatrixPosition(cam.matrixWorld).y;
    if (cam.isOrthographicCamera) return y;
    if (Math.abs(cy - y) < 0.35) return Math.max(this.room.floorY, cy - 0.6);
    return y;
  }

  /** Ray from the active camera through ndc → point on the horizontal plane at y (null when (nearly) parallel/behind). */
  _rayPlane(ndc, y) {
    const cam = this.editor.activeCamera;
    cam.updateMatrixWorld();
    _ray.setFromCamera(_v2.set(ndc.x, ndc.y), cam);
    const dir = _ray.ray.direction;
    if (Math.abs(dir.y) < 1e-4) return null;
    const t = (y - _ray.ray.origin.y) / dir.y;
    if (t <= 0 || t > 80) return null;
    return new THREE.Vector3().copy(_ray.ray.origin).addScaledVector(dir, t);
  }

  // ---- per frame ---------------------------------------------------------------------------------------------

  update(dt) {
    const e = this.editor;
    if (this.spec) {
      const ndc = cursorNDC(e, this._ndc);
      const cam = e.activeCamera;
      cam.updateMatrixWorld();
      this._aimAge = (this._aimAge || 0) + (dt || 0);
      // aiming picks the scene (≈ 1 ms): only when the cursor, the camera or the settings changed
      const key = ndc ? `${ndc.x.toFixed(4)},${ndc.y.toFixed(4)}|${this.rotationDeg}|${this.wallHeight}|${this.grid}|${this._mods.alt}` : '';
      const changed = key !== this._aimKey || !cam.matrixWorld.equals(this._lastCam) || this._aimAge > 0.3;
      if (ndc && changed) {
        this._aimKey = key;
        this._lastCam.copy(cam.matrixWorld);
        this._aimAge = 0;
        this._aim(ndc);
      } else if (!ndc) {
        this.ghost.visible = false;
        this.footprint.hide();
      }
      const t = this.target;
      const name = itemName(this.spec);
      if (t && ndc) {
        this.hint.tip({ text: name, sub: t.status === 'ok' ? t.note : t.message, tone: t.status === 'ok' ? undefined : 'warn' }, 5);
        e.hud?.setCursor?.(t.status === 'blocked' ? 'not-allowed' : 'pointer');
      }
      const items = [[['Klikk'], 'plasser'], [['Shift'], '+ klikk: flere']];
      if (this.mount !== 'wall') items.push([['R'], 'roter']);
      else items.push([['Hjul'], 'høyde']);
      items.push([['G'], this.grid ? 'rutenett på' : 'rutenett av'], [['Alt'], 'uten festing'], [['Esc'], 'avbryt']);
      this.hint.keys({ title: `Plasser ${name}`, items }, 5);
    } else if (this._drag) {
      const d = this._drag;
      const cam = e.activeCamera;
      cam.updateMatrixWorld();
      if (!cam.matrixWorld.equals(this._lastCam)) {
        this._lastCam.copy(cam.matrixWorld);
        this._dragStep();
      }
      if (!this._drag) return;
      this.hint.tip({ text: d.name, sub: d.status === 'ok' ? d.note : d.message || d.note, tone: d.status === 'ok' ? 'ok' : 'warn' }, 5);
      e.hud?.setCursor?.(d.kind === 'rotate' ? ROTATE_CURSOR : 'grabbing');
      const items = [[['Slipp'], 'ferdig']];
      if (d.kind === 'move' && d.mount !== 'wall') items.push([['R'], 'roter']);
      items.push([['Alt'], d.kind === 'rotate' ? 'fri vinkel' : 'uten festing'], [['Esc'], 'angre']);
      this.hint.keys({ title: d.kind === 'rotate' ? `Roter ${d.name}` : `Flytt ${d.name}`, items }, 5);
    } else this.footprint.hide();
  }

  // ---- input -------------------------------------------------------------------------------------------------

  _setMods(e) {
    this._mods.shift = !!e.shiftKey;
    this._mods.alt = !!e.altKey;
    this._mods.ctrl = !!(e.ctrlKey || e.metaKey);
  }

  _key(e) {
    this._setMods(e);
    const ed = this.editor;
    if ((this.spec || this._drag) && (e.key === 'Alt' || e.code === 'AltLeft' || e.code === 'AltRight')) e.preventDefault(); // no browser menu
    if (e.repeat || !ed.keysActive() || e.ctrlKey || e.metaKey) return;
    if (e.code === 'KeyG' && !e.altKey) {
      e.preventDefault();
      this.toggleGrid();
      return;
    }
    if (e.code !== 'KeyR' || e.altKey) return;
    if (this.spec && this.mount !== 'wall') {
      e.preventDefault();
      this.rotationDeg = normDeg(e.shiftKey ? Math.ceil(this.rotationDeg / ROT_STEP - 1e-6) * ROT_STEP - ROT_STEP : Math.floor(this.rotationDeg / ROT_STEP + 1e-6) * ROT_STEP + ROT_STEP);
    } else if (this._drag?.kind === 'move' && this._drag.mount !== 'wall') {
      e.preventDefault();
      const d = this._drag;
      d.theta = normDeg(e.shiftKey ? Math.ceil(d.theta / ROT_STEP - 1e-6) * ROT_STEP - ROT_STEP : Math.floor(d.theta / ROT_STEP + 1e-6) * ROT_STEP + ROT_STEP);
      this._dragStep();
    }
  }

  /** G: the 10 cm grid on/off. */
  toggleGrid() {
    this.grid = !this.grid;
    this.editor.events.emit('toast', { text: this.grid ? 'Rutenett 10 cm: på' : 'Rutenett 10 cm: av', seconds: 1.6 });
  }

  _overCanvas(e) {
    const c = this.editor.renderer.domElement;
    return e.target === c;
  }

  _wheel(e) {
    if (!this._overCanvas(e)) return;
    const wallPlace = this.spec && this.mount === 'wall';
    const wallDrag = this._drag?.kind === 'move' && this._drag.mount === 'wall';
    if (!wallPlace && !wallDrag) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    const step = (e.shiftKey ? 0.01 : 0.05) * (e.deltaY > 0 ? -1 : 1);
    if (wallPlace) this.wallHeight = clamp(this.wallHeight + step, 0.1, 3.2);
    else {
      this._drag.offset[1] += step;
      this._dragStep();
    }
  }

  /** Right click (press + release without dragging) cancels placing / the drag. */
  _ptrDown(e) {
    this._setMods(e);
    if (e.button === 2 && this.isActive && this._overCanvas(e)) this._right = { x: e.clientX, y: e.clientY, t: performance.now(), travel: 0 };
  }

  _ptrMove(e) {
    this._setMods(e);
    if (this._right) this._right.travel += Math.abs(e.movementX || 0) + Math.abs(e.movementY || 0);
  }

  _ptrUp(e) {
    // remember Shift at the release: the click is handled in the next frame, maybe after Shift is already up
    if (e.button === 0) this._upShift = { shift: !!e.shiftKey, t: performance.now() };
    const r = this._right;
    if (!r || e.button !== 2) return;
    this._right = null;
    const moved = Math.max(r.travel, Math.hypot(e.clientX - r.x, e.clientY - r.y));
    if (moved < 6 && performance.now() - r.t < 600 && this.isActive) this.cancel();
  }

  dispose() {
    this.cancel();
    if (this._drag) this._endDrag(false);
    window.removeEventListener('keydown', this._onKey);
    window.removeEventListener('keyup', this._onKeyUp);
    window.removeEventListener('wheel', this._onWheel, { capture: true });
    window.removeEventListener('pointerdown', this._onPtrDown, true);
    window.removeEventListener('pointermove', this._onPtrMove, true);
    window.removeEventListener('pointerup', this._onPtrUp, true);
    window.removeEventListener('blur', this._onBlur);
    this._offChange?.();
    this._offLoad?.();
    this._offHistory?.();
    this.footprint.dispose();
  }
}

/**
 * Distance from a backrest to the centre of a leaning cushion's footprint: textiles.js leans cushions back by
 * (90° − params.lean) and centres the footprint (thickness·cos + height·sin) / 2; throws lie flat.
 */
function leanDepth(o, dims) {
  if (o.archetype === 'throw') return 0.05;
  const t = (90 - clamp(Number(o.params?.lean ?? 70), 0, 90)) * DEG;
  return (dims.d * Math.cos(t) + dims.h * Math.sin(t)) / 2;
}

function isUnder(object, root) {
  for (let o = object; o; o = o.parent) if (o === root) return true;
  return false;
}

function visibleChain(object) {
  for (let o = object; o; o = o.parent) if (!o.visible) return false;
  return true;
}

/** World yaw (deg) of an object (its local +z in the world, seen from above). */
function yawOf(obj) {
  const m = obj.matrixWorld.elements;
  return Math.atan2(m[8], m[10]) / DEG;
}

/**
 * A ray against an axis-aligned kitchen box (fixed: cx, cz, hw, hd, y0, y1): null, or { t (3D hit), x, y, z, nx, nz }
 * with the point where the ray crosses the side it comes in through, seen from above, and that side's normal.
 */
function rayBoxXZ(O, D, b) {
  let t0 = 0, t1 = Infinity;
  for (const [o, d, lo, hi] of [[O.x, D.x, b.cx - b.hw, b.cx + b.hw], [O.y, D.y, b.y0, b.y1], [O.z, D.z, b.cz - b.hd, b.cz + b.hd]]) {
    if (Math.abs(d) < 1e-9) {
      if (o < lo || o > hi) return null;
      continue;
    }
    let a = (lo - o) / d, c = (hi - o) / d;
    if (a > c) [a, c] = [c, a];
    t0 = Math.max(t0, a);
    t1 = Math.min(t1, c);
    if (t0 > t1) return null;
  }
  let te = -Infinity, nx = 0, nz = 0;
  if (Math.abs(D.x) > 1e-9) {
    const a = ((D.x > 0 ? b.cx - b.hw : b.cx + b.hw) - O.x) / D.x;
    if (a > te) {
      te = a;
      nx = D.x > 0 ? -1 : 1;
      nz = 0;
    }
  }
  if (Math.abs(D.z) > 1e-9) {
    const a = ((D.z > 0 ? b.cz - b.hd : b.cz + b.hd) - O.z) / D.z;
    if (a > te) {
      te = a;
      nx = 0;
      nz = D.z > 0 ? -1 : 1;
    }
  }
  if (!(te > 0)) return null; // the camera is above the box: no side to stand in front of
  return { t: t0, x: O.x + D.x * te, y: O.y + D.y * te, z: O.z + D.z * te, nx, nz };
}

export default Placement;
