import * as THREE from 'three';

/**
 * STAIRS – the stair between the levels (notes/hele-huset-design.md §1.6, §2.6, §3.1, §3.3).
 *
 * STUB (steg 6, S0-stub): builds nothing yet and returns the empty build contract, so createHome (index.js) and the
 * living room are exactly as before. Steg 19 (B2) fills it in, first the pure part (Node-testable, no scene / ctx):
 *   stairLayout(stair, levels)    treads (straight + winders around the newel), nosing line, stringers, guards and
 *                                 handrails of one layout.house.stairs entry, in world space;
 *   stairColliders(lay)           the invisible closed wedge along the nosing line (it ends on the lower floor at the
 *                                 bottom riser, §3.1) – the visible treads / stringers / balusters get collide:false;
 *   slabColliders(layout, levelId) the slab box under a level minus its holes, the guards and the stringer sides at
 *                                 0.9–1.0 m (§2.8, §3.3);
 * then buildStairs (§2.6): oak treads, open risers, black stringers, balusters A/B/C, the well guard, the handrail with
 * its LED strip (§4.11), the ledge and the decor.
 *
 * The colliders are THREE.Box3 / THREE.Object3D (meshes), the same list `colliders` of the build contract: index.js
 * registers them with ctx.collision (addStaticBox / addStatic), tools/test-stairs.mjs (steg 20) puts them in its own
 * CollisionWorld.
 *
 *   buildStairs(ctx, layout) → { group, walls, windows, doors, pickables, builtInLights, colliders, update, setPaint, dispose }
 *
 * The stair spans two levels: its meshes go in ctx.roots.rooms['trapp'] (surfaces / contents) or, split per level,
 * in ctx.roots.levels[id] (see rooms.js for ctx.roots). The returned `group` sits at the scene root outside every
 * level, so Y1 (§4.12) cannot hide it with a level: use it only for what must show from both levels. The LED strip of
 * the handrail goes in builtInLights → home.house.builtInLights (group 'gang', §4.10–4.11). The lists are read once
 * when buildStairs returns: fill them before returning.
 */

/**
 * Geometry of one stair (STUB: no treads yet).
 * @param {object} stair   a layout.house.stairs entry
 * @param {object[]} [levels]  layout.house.levels
 * @returns {{ id: string|null, stair: object, levelIds: string[], treads: object[] }}
 */
export function stairLayout(stair, levels = []) {
  return { id: stair?.id ?? null, stair, levelIds: levels.map((l) => l.id), treads: [] };
}

/**
 * Static colliders of a stair (STUB: none yet).
 * @param {object} lay  stairLayout(…)
 * @returns {Array<THREE.Box3|THREE.Object3D>}
 */
export function stairColliders(lay) {
  return [];
}

/**
 * Static colliders of a level's slab, guards and stringer sides (STUB: none yet).
 * @param {object} layout   home/layout.js
 * @param {string} levelId
 * @returns {Array<THREE.Box3|THREE.Object3D>}
 */
export function slabColliders(layout, levelId) {
  return [];
}

/**
 * Builds every stair of layout.house.stairs (STUB: nothing yet).
 * @param {object} ctx     createHome ctx (+ ctx.roots)
 * @param {object} layout  home/layout.js
 */
export function buildStairs(ctx, layout) {
  const group = new THREE.Group();
  group.name = 'stairs';
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
