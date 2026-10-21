import * as THREE from 'three';

/**
 * BUILT-INS – fixed fittings of the house that cannot be moved (notes/hele-huset-design.md §1.2 `builtIns[]`, §2.1):
 * wc, vanity, shower, mirror-round, floor-drain, towel-radiator, laundry-bench, cabinet-row, washer, dryer,
 * wardrobe-sliding.
 *
 * STUB (steg 6, S0-stub): builds nothing yet and returns the empty build contract (see rooms.js and the top of
 * index.js). Steg 10 (A4) makes it dispatch on `type` (bathroom.js, later laundry.js in steg 24) and add static
 * collision boxes like kitchen.js:645-657 – returned in `colliders` (THREE.Box3), index.js registers them.
 *
 *   buildBuiltIns(ctx, layout) → { group, walls, windows, doors, pickables, builtInLights, colliders, update, setPaint, dispose }
 *
 * The entries are layout.house.builtIns (world space, each with roomId / levelId / floorY). A built-in's meshes go in
 * ctx.roots.rooms[roomId].contents (hidden with the room's contents, §4.12) or in the returned `group`. Its light
 * (`light`, e.g. the LED ring of the round mirror) goes in builtInLights → home.house.builtInLights.
 *
 * @param {object} ctx     createHome ctx (+ ctx.roots)
 * @param {object} layout  home/layout.js
 */
export function buildBuiltIns(ctx, layout) {
  const group = new THREE.Group();
  group.name = 'built-ins';
  return {
    group,
    walls: [],
    windows: [],
    doors: [],
    pickables: { floor: [], walls: [], ceilings: [], windows: [] },
    builtInLights: [],
    colliders: [],
    update() {},
    setPaint() {},
    dispose() {
      group.removeFromParent();
    },
  };
}
