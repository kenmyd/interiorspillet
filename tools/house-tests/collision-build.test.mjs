#!/usr/bin/env node
/**
 * The collision octree of the whole house builds in reasonable time (integrator, bølge 1 gruppe 2). three's Octree
 * splits to level 16 wherever more than 8 triangles share an edge or a plane; with every room, the stair and the
 * built-ins merged, Collision.build() never finished and the game hung at «Møblerer». CollisionWorld now stops at a
 * smallest cell and skips zero-area triangles.
 *   node tools/house-tests/collision-build.test.mjs
 */
import { imp, check, section, done } from './_lib.mjs';

const THREE = await import('three');
(await imp('src/home/materials.js')).configureMaterials({ textureRes: 0.125 });
const { layout } = await imp('src/home/layout.js');
const { buildRooms } = await imp('src/home/rooms.js');
const { buildStairs } = await imp('src/home/stairs.js');
const { buildBuiltIns } = await imp('src/home/builtins.js');
const { createHouseRoots } = await imp('src/home/index.js');
const { CollisionWorld } = await imp('src/core/Collision.js');

const warn = console.warn;
console.warn = () => {};
const roots = createHouseRoots(layout, [new THREE.Group()]);
const ctx = {
  scene: new THREE.Scene(),
  quality: {},
  roots,
  collision: {
    addSurfaceZone() {},
    addDynamicBox: (b, o = {}) => ({ box: b.clone(), enabled: o.enabled ?? true, id: o.id }),
    removeDynamic() {},
  },
};
const parts = [buildRooms(ctx, layout, null), buildStairs(ctx, layout), buildBuiltIns(ctx, layout)];
console.warn = warn;

section('Collision.build() with the whole house (rooms, stair, built-ins)');
const col = new CollisionWorld();
for (const p of parts) for (const c of p.colliders || []) (c.isBox3 ? col.addStaticBox(c) : col.addStatic(c));
const t0 = Date.now();
col.build();
const ms = Date.now() - t0;
check(`builds in under 3 s (${ms} ms, ${col.triangleCount} triangles)`, ms < 3000);
const ray = new THREE.Ray(new THREE.Vector3(3.5, -1.0, 3.8), new THREE.Vector3(0, -1, 0));
const hit = col.raycast(ray, 5, { includeDynamic: false });
check('a ray down in the basement hall hits its floor (−2.55)', hit && Math.abs(hit.point.y + 2.55) < 0.02, hit ? hit.point.y.toFixed(3) : 'no hit');

section('Pathological geometry stays cheap');
{
  // 24 triangles fanning out of one edge, plus 12 zero-area slivers on it
  const g = new THREE.BufferGeometry();
  const pos = [];
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    pos.push(0, 0, 0, 0, 2, 0, Math.cos(a), 1, Math.sin(a));
  }
  for (let i = 0; i < 12; i++) pos.push(0, 0, 0, 0, 2, 0, 0, 2, 0);
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const w = new CollisionWorld();
  const grp = new THREE.Group();
  grp.add(new THREE.Mesh(g));
  w.addStatic(grp);
  const t1 = Date.now();
  w.build();
  const ms2 = Date.now() - t1;
  check(`24 triangles on one edge build in under 0.5 s (${ms2} ms); the 12 slivers are skipped`, ms2 < 500 && w.triangleCount === 24, `${w.triangleCount} triangles`);
}

done();
