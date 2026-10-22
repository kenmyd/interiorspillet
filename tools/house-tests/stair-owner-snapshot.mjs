#!/usr/bin/env node
/**
 * Fingerprint of the owner's stair (research/house/20-trapp.json through room-spec.json): every number stairLayout
 * gives, the geometry buildStairs makes (positions, normals, uvs per mesh), the colliders, the layout's surface and the
 * validator's stair report – hashed. The stair types (notes/trapper.md) must leave all of it unchanged.
 *
 *   node tools/house-tests/stair-owner-snapshot.mjs            prints the hashes
 *   node tools/house-tests/stair-owner-snapshot.mjs --write    writes tools/house-tests/fixtures/stair-owner.json
 *
 * tools/house-tests/stairtypes.test.mjs compares against the fixture.
 */
import { ROOT, imp, readJson } from './_lib.mjs';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export async function ownerFingerprint() {
  const THREE = await import('three');
  const { buildLayout } = await imp('src/home/layout.js');
  const { createHouseRoots } = await imp('src/home/index.js');
  const { stairLayout, stairColliders, slabColliders, buildStairs } = await imp('src/home/stairs.js');
  const house = await imp('src/data/scripts/house.mjs');
  const spec = readJson('src/data/room-spec.json');
  const palette = readJson('src/data/palette.json');
  const quiet = (fn) => {
    const w = console.warn;
    console.warn = () => {};
    try {
      return fn();
    } finally {
      console.warn = w;
    }
  };
  const layout = quiet(() => buildLayout(spec, palette, { devWarnings: false }));
  const H = layout.house;
  const st = H.stairs[0];
  const hash = (v) => crypto.createHash('sha256').update(typeof v === 'string' ? v : JSON.stringify(v)).digest('hex').slice(0, 16);
  // numbers rounded to 1e-9 (the same code gives the same bits; this only hides -0 vs 0)
  const round = (v) => JSON.parse(JSON.stringify(v, (k, x) => (typeof x === 'number' ? Math.round(x * 1e9) / 1e9 : typeof x === 'function' ? undefined : x)));
  const lay = stairLayout(st, H.levels);
  const out = {};
  const pick = (o, keys) => Object.fromEntries(keys.map((k) => [k, o[k]]));
  out.layoutNumbers = hash(round(pick(lay, ['bottomY', 'topY', 'rise', 'risers', 'riser', 'slab', 'going', 'goingFoot', 'goingRest', 'rampDeg', 'slopeDeg', 'nosing', 'treadThickness', 'batten', 'footprint', 'well', 'footIn', 'footOut'])));
  out.nosings = hash(round(lay.nosings));
  out.treads = hash(round(lay.treads));
  out.sections = hash(round(lay.sections));
  out.stringers = hash(round({ outer: lay.stringers.outer.samples, inner: lay.stringers.inner.samples, t: lay.stringers.thickness }));
  out.wellGuard = hash(round(lay.wellGuard));
  out.guards = hash(round(lay.guards));
  out.handrails = hash(round(lay.handrails));
  out.nosingList = hash(round(lay.nosingList));
  out.chains = hash(round({ inner: lay.inner.pts, outer: lay.outer.pts, innerOff: lay.innerOff.pts, outerOff: lay.outerOff.pts }));
  out.walk = hash(round({ L: lay.walk.length, segs: lay.walk.segments, s: [0, 0.3, 0.9, 1.7, 2.4, lay.walk.length].map((u) => lay.walk.at(u).p) }));
  const grid = [];
  for (let x = -0.1; x <= 2.0; x += 0.07) for (let z = 2.2; z <= 4.6; z += 0.07) grid.push([lay.surfaceY(x, z), lay.undersideAt(x, z)]);
  out.surface = hash(round(grid));
  const coll = (list) =>
    list.map((c) => (c.isBox3 ? ['box', c.min.toArray(), c.max.toArray()] : ['mesh', c.name, Array.from(c.geometry.attributes.position.array)]));
  out.stairColliders = hash(round(coll(stairColliders(lay))));
  out.slabColliders = hash(round(coll(slabColliders(layout, st.toLevel))));
  const lgrid = [];
  for (let x = -0.1; x <= 2.0; x += 0.07) for (let z = 2.2; z <= 4.6; z += 0.07) lgrid.push([st.surfaceY(x, z), H.floorYAt(x, z, -1.2), H.floorYAt(x, z)]);
  out.layoutSurface = hash(round(lgrid));
  out.layoutStair = hash(round(pick(st, ['risers', 'rise', 'riser', 'topY', 'bottomY', 'walkLength', 'going', 'walkLine', 'footprint', 'wellPolygon'])));
  const ctx = { scene: new THREE.Scene(), collision: null, quality: {}, roots: createHouseRoots(layout) };
  const r = quiet(() => buildStairs(ctx, layout));
  const meshes = [];
  ctx.roots.rooms.trapp.surfaces.traverse((o) => {
    if (!o.isMesh) return;
    const g = o.geometry;
    meshes.push([o.name, o.material?.color?.getHexString?.() ?? null, ...['position', 'normal', 'uv'].map((a) => hash(round(Array.from(g.attributes[a]?.array ?? []))))]);
  });
  ctx.roots.rooms.trapp.contents.traverse((o) => {
    if (o.isMesh) meshes.push([o.name, hash(round(Array.from(o.geometry.attributes.position.array)))]);
  });
  out.meshes = meshes;
  out.builtInLights = hash(round(r.builtInLights.map((l) => ({ ...l, emissiveMeshes: undefined, from: l.from.toArray(), to: l.to.toArray(), direction: l.direction.toArray() }))));
  out.buildColliders = hash(round(coll(r.colliders)));
  r.dispose();
  const report = house.validateHouse ? quiet(() => house.validateHouse(spec)) : null;
  out.validatorStairs = report ? hash(round(report.stairs)) : null;
  out.validatorMessages = report ? hash([...report.errors, ...report.warnings].filter((m) => /trapp|stairs|guards|rekk/i.test(m))) : null;
  const walk = house.stairWalk(spec.stairs[0]);
  out.validatorWalk = hash(round({ L: walk.length, pts: [0, 0.5, 1, 1.5, 2, 2.5, walk.length].map((u) => walk.at(u)) }));
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  const fp = await ownerFingerprint();
  console.log(JSON.stringify(fp, null, 1));
  if (process.argv.includes('--write')) {
    const file = path.join(ROOT, 'tools/house-tests/fixtures/stair-owner.json');
    fs.writeFileSync(file, `${JSON.stringify(fp, null, 1)}\n`);
    console.log(`skrev ${path.relative(ROOT, file)}`);
  }
}
