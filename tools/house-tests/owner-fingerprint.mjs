#!/usr/bin/env node
/**
 * Fingerprint of the owner's house as the builders make it in Node (not a test of its own: tools/test-house.mjs only
 * runs *.test.mjs). Used by tak.test.mjs to show that the roof work (notes/tak.md) leaves the owner's house exactly as
 * it was:
 *
 *   node tools/house-tests/owner-fingerprint.mjs            prints { layout, rooms } (sha-1 per part)
 *   node tools/house-tests/owner-fingerprint.mjs --detail   also the per-mesh hashes (to find what changed)
 *
 * layout: every wall's top profile, height and openings, every ceiling's height on a 0.25 m grid over its polygon, the
 * volumes, the rooms' ceilingTop. rooms: every mesh of buildRooms (name, material name, positions rounded to 0.1 mm,
 * world matrix), sorted by name.
 */
import { imp } from './_lib.mjs';
import crypto from 'node:crypto';

const THREE = await import('three');
(await imp('src/home/materials.js')).configureMaterials({ textureRes: 0.125 });
const { layout } = await imp('src/home/layout.js');
const { buildRooms } = await imp('src/home/rooms.js');
const { createHouseRoots } = await imp('src/home/index.js');

const sha = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 16);
const r4 = (v) => Math.round(v * 1e4) / 1e4;

export function ownerFingerprint({ detail = false } = {}) {
  const H = layout.house;
  const L = [];
  for (const w of H.walls) L.push(`w ${w.id} ${w.height} ${JSON.stringify(w.topProfile.map(([u, h]) => [r4(u), r4(h)]))} ${w.openings.map((o) => `${o.id}:${r4(o.top)}`).join(',')}`);
  for (const c of H.ceilings) {
    const xs = c.polygon.map((p) => p.x), zs = c.polygon.map((p) => p.y);
    const hs = [];
    for (let x = Math.min(...xs); x <= Math.max(...xs) + 1e-9; x += 0.25) for (let z = Math.min(...zs); z <= Math.max(...zs) + 1e-9; z += 0.25) hs.push(r4(c.heightAt(x, z)));
    L.push(`c ${c.id} ${r4(c.volume)} ${hs.join(',')}`);
  }
  for (const r of H.rooms) L.push(`r ${r.id} ${r4(r.volume ?? 0)} ${r4(r.ceilingTop ?? 0)}`);
  L.push(`v ${r4(layout.volume)}`);
  const roots = createHouseRoots(layout, [new THREE.Group()]);
  const ctx = { scene: new THREE.Scene(), quality: {}, roots, collision: { addSurfaceZone() {}, addDynamicBox: (b) => ({ box: b }), removeDynamic() {} } };
  const R = buildRooms(ctx, layout, null);
  const meshes = [];
  const all = new THREE.Group();
  for (const g of Object.values(roots.levels)) all.add(g);
  if (R.group) all.add(R.group);
  all.updateMatrixWorld(true);
  all.traverse((m) => {
    if (!m.isMesh) return;
    const p = m.geometry.attributes.position;
    const a = [];
    for (let i = 0; i < p.count; i++) a.push(r4(p.getX(i)), r4(p.getY(i)), r4(p.getZ(i)));
    const idx = m.geometry.index ? Array.from(m.geometry.index.array).join(',') : '';
    const mats = [].concat(m.material).map((x) => x?.name ?? '').join('+');
    meshes.push(`${m.name}|${mats}|${m.visible}|${m.matrixWorld.elements.map(r4).join(',')}|${sha(a.join(','))}|${sha(idx)}`);
  });
  meshes.sort();
  const out = { layout: sha(L.join('\n')), rooms: sha(meshes.join('\n')), meshes: meshes.length, pickCeilings: R.pickables.ceilings.length };
  if (detail) out.detail = { layout: L, meshes };
  return out;
}

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}` || process.argv[1]?.endsWith('owner-fingerprint.mjs')) {
  const f = ownerFingerprint({ detail: process.argv.includes('--detail') });
  console.log(JSON.stringify(f, null, process.argv.includes('--detail') ? 1 : 0));
}
