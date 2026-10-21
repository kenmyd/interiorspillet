import * as THREE from 'three';

/**
 * ROOMS – every room of the house except the living room / kitchen / TV-stue (notes/hele-huset-design.md §2.1, §2.3–2.8).
 *
 * STUB (steg 6, S0-stub): builds nothing yet and returns the empty build contract, so createHome (index.js) and the
 * living room are exactly as before. Steg 8 (A2) fills it in:
 *   • walls of each room at (0, floorY, 0), skirting, a floor per room with its holes, ceilings;
 *   • the lamp fittings of the types `plafond` and `downlight`;
 *   • doors (doors.js), facade segments, the slab box and the soffits (§2.8).
 *
 *   buildRooms(ctx, layout, M) → { group, walls, windows, doors, pickables, builtInLights, colliders, update, setPaint, dispose }
 *
 * ctx     the createHome ctx (scene, collision, interaction, quality …). ctx.roots holds the scene roots of the house:
 *         ctx.roots.levels[levelId] (THREE.Group per level) and ctx.roots.rooms[roomId] = { id, name, levelId, kind, hud,
 *         group, surfaces, contents } – a room's walls / floor / ceilings go in `surfaces`, its fittings and built-ins in
 *         `contents` (visibility.js hides those, §4.12). Everything put there is in the scene already (index.js adds the
 *         level groups); objects can also go in the returned `group`, which index.js adds to the scene when it has no
 *         parent. ctx.lighting does not exist yet while building (LightManager comes after) – read it when it is needed
 *         (Door.onChange → ctx.lighting?.requestShadowUpdate()).
 * layout  home/layout.js – the rooms to build are layout.house.rooms without 'stue-kjokken' and without hud rooms.
 * M       the shell's shared materials (index.js passes shell.materials; null until shell.js returns them).
 *
 * The contract (index.js merges it into home.*, see the top of index.js): walls / windows / doors in the shape of
 * shell.js's (WallInfo, WindowInfo with `anchor`, DoorInfo with `door`), pickables { floor, walls, ceilings, windows },
 * builtInLights (→ home.house.builtInLights, not yet the LightManager's list), colliders = static THREE.Object3D /
 * THREE.Box3 that index.js registers with ctx.collision (door leaves and surface zones the builder registers itself),
 * update(dt, state) every frame (doors), setPaint(id, color) for its own surfaces (ignore other ids), dispose().
 *
 * @param {object} ctx
 * @param {object} layout
 * @param {object|null} [M]
 */
export function buildRooms(ctx, layout, M = null) {
  const group = new THREE.Group();
  group.name = 'rooms';
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
