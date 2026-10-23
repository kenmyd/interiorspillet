import * as THREE from 'three';
import { MeshBatcher } from '../world/buildKit.js';
import { paint } from './materials.js';
import { wallFinish, surfaceFinish } from '../world/surfaces.js';
import { BATHROOM_BUILDERS } from './bathroom.js';
import { LAUNDRY_BUILDERS } from './laundry.js';
import { KITCHEN_BUILDERS } from './kitchenkit.js';
import { planBuiltIns } from './builtinplan.js';
import { addWallTiles } from './walltiles.js';

/**
 * BUILT-INS – fixed fittings of the house that cannot be moved (notes/hele-huset-design.md §1.2 `builtIns[]`, §2.1):
 * wc, vanity, shower, mirror-round, mirror, bathtub, floor-drain, towel-radiator (bathroom.js), laundry-bench,
 * utility-sink, cabinet-row, washer, dryer, water-heater, wardrobe-sliding (laundry.js), and the kitchens of generated
 * houses: kitchen-bench, kitchen-island, wall-cabinets, hood, tall-cabinet, fridge, freezer, fridge-freezer, oven-tower
 * and the appliances in a bench – sink, dishwasher, hob, oven (kitchenkit.js; notes/kjokken-bad-genererte-hus.md).
 * Before building, builtinplan.js planBuiltIns works out what the symbols of a generated house mean together (the
 * appliances become slots of their bench, a shower its glass and drain from the walls round it) and the wall tiles of
 * the rooms (rooms[].wallTiles …), built here into the room's batch (walltiles.js). The owner's house passes through
 * it unchanged.
 *
 *   buildBuiltIns(ctx, layout) → { group, walls, windows, doors, pickables, builtInLights, colliders, update, setPaint, dispose }
 *
 * For every entry of layout.house.builtIns (world space, with roomId / levelId / floorY) the builder of its `type`
 * runs in the entry's local frame (builtInFrame: origin = middle of the footprint on its underside, +z = the front
 * from rotationDeg, dims.w along x – a wall-mounted entry's position is the middle of its back on the wall, so the
 * frame's origin is d/2 in front of it). The static parts of all entries of a room are merged per material into one
 * MeshBatcher ('built-ins:<roomId>'); own meshes (the LED ring of the mirror, a cistern box that follows its wall's
 * paint) stay separate. Everything goes into ctx.roots.rooms[roomId].contents (hidden with the room's contents, §4.12)
 * – the returned `group` stays empty unless the context has no roots (tests, dev pages).
 *
 * Collision: static THREE.Box3s in `colliders` (index.js registers them, like kitchen.js's boxes): the builder's own
 * boxes, else one box of the entry's dims; none for `collide: false` (the drain). The meshes themselves never collide
 * (userData.noCollide). Lights of the built-ins (the mirror's LED ring) go to builtInLights → home.house.builtInLights
 * (not yet in the LightManager, steg 13). setPaint(wallId, colour) repaints the parts that follow a wall (the WC
 * cistern box is clad like its wall). An unknown type or a builder that throws is skipped with one warning (its parts
 * are rolled back); the rest of the house is built.
 *
 * @param {object} ctx     createHome ctx (+ ctx.roots); ctx.quality.level 'low' = fewer segments
 * @param {object} layout  home/layout.js
 */
export function buildBuiltIns(ctx, layout) {
  const group = new THREE.Group();
  group.name = 'built-ins';
  group.userData.noCollide = true;
  const result = {
    group,
    walls: [],
    windows: [],
    doors: [],
    pickables: { floor: [], walls: [], ceilings: [], windows: [] },
    builtInLights: [],
    colliders: [],
    wallTiles: [], // { roomId, wallId, zones, triangles }
    update() {},
    setPaint() {},
    dispose() {
      group.removeFromParent();
    },
  };
  const H = layout?.house;
  const plan = planBuiltIns(H);
  const list = plan.list;
  if (!list.length && !plan.tiles.size) return result;

  const low = ctx?.quality?.level === 'low';
  const roots = ctx?.roots;
  const wallsById = H.wallsById || {};
  const groupLabel = Object.fromEntries((H.lightGroups || layout.lightGroups || []).map((g) => [g.id, g.label]));
  const batchers = new Map(); // roomId → MeshBatcher
  const own = []; // own meshes (disposed with the result)
  const followers = []; // { wallId, mesh, base }
  const roomGroups = [];
  const containerOf = (roomId) => roots?.rooms?.[roomId]?.contents ?? group;

  for (const b of list) {
    let batch = batchers.get(b.roomId);
    if (!batch) batchers.set(b.roomId, (batch = new MeshBatcher(`built-ins:${b.roomId}`)));
    const built = buildEntry(b, batch, H, wallsById, low);
    if (!built) continue;
    const { mine, frame } = built;
    const target = containerOf(b.roomId);
    for (const m of mine.meshes) {
      m.userData.noCollide = true;
      m.userData.builtIn = b.id;
      target.add(m);
      own.push(m);
    }
    followers.push(...mine.followers);
    for (const l of mine.lights) result.builtInLights.push({ ...l, label: groupLabel[l.group] ?? b.name ?? b.id, roomId: b.roomId, levelId: b.levelId });
    result.colliders.push(...worldColliders(b, mine, frame));
  }
  // the wall tiles of each room, in its batch (one merged mesh per tile finish)
  for (const [roomId, walls] of plan.tiles) {
    let batch = batchers.get(roomId);
    if (!batch) batchers.set(roomId, (batch = new MeshBatcher(`built-ins:${roomId}`)));
    for (const { wall, zones } of walls) {
      const triangles = addWallTiles(batch, wall, zones, tileMaterial);
      result.wallTiles.push({ roomId, wallId: wall.id, zones, triangles });
    }
  }

  const geometries = [];
  for (const [roomId, batch] of batchers) {
    const g = batch.build();
    g.userData.noCollide = true;
    g.userData.roomId = roomId;
    containerOf(roomId).add(g);
    roomGroups.push(g);
    geometries.push(...batch.geometries);
  }

  result.setPaint = (id, color) => {
    for (const f of followers) {
      if (f.wallId !== id) continue;
      f.mesh.material = color ? wallMaterialOf(wallsById[id], color) : f.base;
    }
  };
  result.dispose = () => {
    group.removeFromParent();
    for (const g of roomGroups) g.removeFromParent();
    for (const g of geometries) g.dispose();
    for (const m of own) {
      m.removeFromParent();
      disposeMesh(m);
    }
  };
  return result;
}

/**
 * Builds one entry of layout.house.builtIns into `batch` (its parts) and returns what else it made, or null (unknown
 * type, no dims, a builder that threw – rolled back, one warning).
 * @returns {{ mine: { meshes: THREE.Mesh[], lights: object[], colliders: THREE.Box3[], followers: object[] }, frame: object }|null}
 */
function buildEntry(b, batch, H, wallsById, low) {
  const build = BUILDERS[b.type];
  if (!build) {
    warnOnce(`type:${b.type}`, `[builtins] ${b.id}: unknown type «${b.type}» – skipped`);
    return null;
  }
  if (!b.dims || !b.position) {
    warnOnce(`dims:${b.id}`, `[builtins] ${b.id}: no dims / position – skipped`);
    return null;
  }
  const frame = builtInFrame(b);
  const mark = batch.mark();
  const mine = { meshes: [], lights: [], colliders: [], followers: [] };
  const k = makeKit(b, frame, H, wallsById, low, mine);
  try {
    build(new StaticFrame(batch.frame(frame.matrix)), b, k);
  } catch (err) {
    batch.rollback(mark);
    for (const m of mine.meshes) disposeMesh(m);
    warnOnce(`build:${b.id}`, `[builtins] ${b.id} (${b.type}): the builder failed – skipped`, err);
    return null;
  }
  return { mine, frame };
}

/** World collision boxes of a built entry: the builder's own, else one box of its dims; none for collide: false. */
function worldColliders(b, mine, frame) {
  if (b.collide === false) return [];
  const boxes = mine.colliders.length ? mine.colliders : [new THREE.Box3(new THREE.Vector3(-b.dims.w / 2, 0, -b.dims.d / 2), new THREE.Vector3(b.dims.w / 2, b.dims.h, b.dims.d / 2))];
  return boxes.map((bx) => {
    const wb = bx.clone().applyMatrix4(frame.matrix);
    wb.builtInId = b.id;
    return wb;
  });
}

/**
 * One built-in on its own (tests, dev pages): its parts merged in a Group (world space), its colliders and lights.
 * @param {object} b       an entry of layout.house.builtIns
 * @param {object} layout  home/layout.js
 * @param {{ low?: boolean }} [o]
 * @returns {{ group: THREE.Group, colliders: THREE.Box3[], lights: object[], meshes: THREE.Mesh[], dispose: () => void }|null}
 */
export function buildBuiltIn(b, layout, { low = false } = {}) {
  const H = layout?.house || {};
  const batch = new MeshBatcher(`built-in:${b.id}`);
  const built = buildEntry(b, batch, H, H.wallsById || {}, low);
  if (!built) return null;
  const group = batch.build();
  for (const m of built.mine.meshes) group.add(m);
  return {
    group,
    colliders: worldColliders(b, built.mine, built.frame),
    lights: built.mine.lights,
    meshes: built.mine.meshes,
    dispose() {
      group.removeFromParent();
      for (const g of batch.geometries) g.dispose();
      for (const m of built.mine.meshes) disposeMesh(m);
    },
  };
}

/** Batch flags of a part: never colliding, casting a shadow unless transparent (one merged mesh per material). */
const flags = (material, o) => ({ ...o, collide: false, castShadow: !material?.transparent, receiveShadow: material?.transparent ? false : o.receiveShadow ?? true });

/**
 * A BatchFrame whose parts never collide (the collision of the built-ins is their boxes): every part of a material
 * then lands in one merged mesh instead of a colliding and a non-colliding one.
 */
class StaticFrame {
  constructor(frame) {
    this.frame0 = frame;
    this.matrix = frame.matrix;
  }

  add(geometry, material, o = {}) {
    this.frame0.add(geometry, material, flags(material, o));
    return this;
  }

  box(w, h, d, x, y, z, material, o = {}) {
    this.frame0.box(w, h, d, x, y, z, material, flags(material, o));
    return this;
  }

  cylinder(rTop, rBottom, h, x, y, z, material, o = {}) {
    this.frame0.cylinder(rTop, rBottom, h, x, y, z, material, flags(material, o));
    return this;
  }

  frame(matrix) {
    return new StaticFrame(this.frame0.frame(matrix));
  }

  point(x, y, z, target) {
    return this.frame0.point(x, y, z, target);
  }
}

/** Builders by builtIns type. */
export const BUILDERS = Object.freeze({ ...BATHROOM_BUILDERS, ...LAUNDRY_BUILDERS, ...KITCHEN_BUILDERS });

/** Material of a tile finish { color, size, grout, groutColor } (cached by surfaces.js; matt paint without textures). */
function tileMaterial(f) {
  try {
    return surfaceFinish('tiles', f.color, { size: f.size, grout: f.grout, groutColor: f.groutColor ?? undefined }) ?? paint(f.color);
  } catch {
    return paint(f.color);
  }
}

const UP = new THREE.Vector3(0, 1, 0);
const DEG = Math.PI / 180;

/**
 * The local frame of a built-in (see the top of this file): { matrix (local → world), inverse, yaw, centre, front }.
 * @param {{ position: THREE.Vector3|number[], rotationDeg?: number, mount?: string, dims: { d: number } }} b
 */
export function builtInFrame(b) {
  const yaw = (b.rotationDeg ?? 0) * DEG;
  const front = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
  const p = b.position?.isVector3 ? b.position.clone() : new THREE.Vector3(...b.position);
  const centre = b.mount === 'wall' ? p.addScaledVector(front, (b.dims?.d ?? 0) / 2) : p;
  const matrix = new THREE.Matrix4().compose(centre, new THREE.Quaternion().setFromAxisAngle(UP, yaw), new THREE.Vector3(1, 1, 1));
  return { matrix, inverse: matrix.clone().invert(), yaw, centre, front };
}

/** The kit a type builder gets (bathroom.js documents it). */
function makeKit(b, frame, H, wallsById, low, mine) {
  const { matrix, inverse, yaw, centre } = frame;
  const floorWorld = b.floorY ?? 0;
  let ceilWorld = null;
  try {
    ceilWorld = H.ceilingHeightAt?.(centre.x, centre.z, floorWorld + 1.0) ?? null;
  } catch {
    ceilWorld = null;
  }
  if (!Number.isFinite(ceilWorld)) ceilWorld = floorWorld + 2.4;
  const c = Math.cos(-yaw), s = Math.sin(-yaw);
  const k = {
    low,
    floorY: floorWorld - centre.y,
    ceilingY: ceilWorld - centre.y,
    toLocal: (x, z) => new THREE.Vector3(x, centre.y, z).applyMatrix4(inverse).setY(0),
    dirToLocal: (x, z) => new THREE.Vector3(x * c + z * s, 0, -x * s + z * c),
    wall: (id) => (id ? wallsById[id] ?? null : null),
    wallMaterial: (wallId, hex) => (hex ? paint(hex) : wallMaterialOf(wallsById[wallId], null)),
    tileMaterial,
    surface(geometry, material, { wallId = null, follow = false } = {}) {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = `built-in:${b.id}:surface`;
      mesh.applyMatrix4(matrix);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mine.meshes.push(mesh);
      if (follow && wallId && wallsById[wallId]) mine.followers.push({ wallId, mesh, base: material });
      return mesh;
    },
    mesh(mesh) {
      mesh.applyMatrix4(matrix);
      mine.meshes.push(mesh);
      return mesh;
    },
    light(entry) {
      const out = { ...entry };
      if (entry.position) out.position = entry.position.clone().applyMatrix4(matrix);
      if (entry.direction) out.direction = entry.direction.clone().transformDirection(matrix);
      if (entry.from) out.from = entry.from.clone().applyMatrix4(matrix);
      if (entry.to) out.to = entry.to.clone().applyMatrix4(matrix);
      mine.lights.push(out);
      return out;
    },
    collider(box) {
      mine.colliders.push(box);
    },
  };
  return k;
}

/** Material of a wall's surface in a colour: its textured finish (stone panels …) or matt paint. */
function wallMaterialOf(wall, color) {
  if (!wall) return paint(color || '#cfc5b4');
  return wallFinish(wall, color || undefined) ?? paint(color || wall.paintHex || wall.paint || 'sand');
}

function disposeMesh(m) {
  m.geometry?.dispose?.();
  const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
  for (const x of mats) if (!x.userData?.cached) x.dispose?.();
}

const _warned = new Set();
function warnOnce(key, msg, err) {
  if (_warned.has(key)) return;
  _warned.add(key);
  if (err) console.warn(msg, err);
  else console.warn(msg);
}
