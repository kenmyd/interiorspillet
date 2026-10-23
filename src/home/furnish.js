import * as THREE from 'three';
import { buildModel } from '../models/registry.js';
import { disposeModel } from '../models/kit.js';
import { allProducts, productToItemSpec } from '../catalog/index.js';
import { furnishHouse, COLLIDE_H } from './furnishgeom.js';

/**
 * The furniture of a generated house in 3D (notes/moblering-genererte-hus.md) where there is no design to build it: the
 * planbygger's 3D view and the dev pages (buildLayout + buildRooms). rooms.js calls it when the house has `furnishing`
 * and ctx has no design – in the game the same items are original design items (existing.js furnishedItems) that
 * SceneSync builds and collides, and this builder is not used.
 *
 *   buildFurnishing(ctx, layout) → { group, items, objects, colliders, dispose }
 *
 * items      the item specs (home/furnishgeom.js furnishHouse: catalogue items with position [x, y over the room's
 *            floor, z], rotationDeg, roomId, level, attach for wall items)
 * objects    one model per item (registry buildModel), in its room's `contents` (ctx.roots.rooms[roomId]) or in `group`;
 *            userData.item = the spec
 * colliders  Box3 per floor piece taller than COLLIDE_H (the model's own collider boxes where it has them, else its
 *            bounds), 2 cm smaller on each side like SceneSync's, from the room's floor up – static: nothing moves here
 */

/** The catalogue as furnishgeom.js reads it (one object: furnishHouse caches per layout and catalogue). */
const CATALOG = { products: allProducts(), toSpec: productToItemSpec };
const DEG = Math.PI / 180;

/** Material kinds the furniture of a house needs (for prepareMaterials before building). */
export function furnishingKinds(layout) {
  const kinds = new Set();
  for (const it of furnishHouse(layout, CATALOG).items) for (const k of Object.values(it.materials || {})) kinds.add(k);
  return [...kinds];
}

export function buildFurnishing(ctx, layout) {
  const H = layout.house;
  const { items, rooms } = furnishHouse(layout, CATALOG);
  const group = new THREE.Group();
  group.name = 'furnishing';
  const objects = [];
  const colliders = [];
  for (const it of items) {
    const room = H.room(it.roomId);
    if (!room) continue;
    const object = buildModel(it);
    object.name = `item:${it.uid}`;
    object.userData.item = it;
    const floor = room.floorY;
    object.position.set(it.position[0], floor + it.position[1], it.position[2]);
    const n = it.attach?.normal;
    const yaw = it.mount === 'wall' && n ? Math.atan2(n[0], n[2]) : (it.rotationDeg || 0) * DEG;
    object.rotation.set(0, yaw, 0, 'YXZ');
    (ctx.roots?.rooms?.[it.roomId]?.contents ?? group).add(object);
    object.updateMatrixWorld(true);
    objects.push(object);
    if (it.mount !== 'floor' || (it.dims?.h ?? 0) <= COLLIDE_H) continue;
    const own = object.userData.model?.colliders;
    const boxes = Array.isArray(own) && own.length
      ? own.map((c) => new THREE.Box3(new THREE.Vector3(...c.min), new THREE.Vector3(...c.max)).applyMatrix4(object.matrixWorld))
      : [new THREE.Box3().setFromObject(object)];
    for (const b of boxes) {
      b.expandByVector(new THREE.Vector3(-0.02, 0, -0.02));
      b.min.y = Math.max(b.min.y, floor);
      b.userData = { furniture: it.uid };
      colliders.push(b);
    }
  }
  return {
    group,
    items,
    rooms,
    objects,
    colliders,
    dispose() {
      for (const o of objects) {
        o.removeFromParent();
        disposeModel(o);
      }
    },
  };
}
