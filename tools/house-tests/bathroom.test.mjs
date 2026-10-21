#!/usr/bin/env node
/**
 * Node test of the wet-room fittings (notes/hele-huset-design.md §6 steg 10 A4 + 24b, §2.3, §2.7; avstemming V38–V45,
 * V58–V60):
 *   node tools/house-tests/bathroom.test.mjs        (from the project root; exit code 1 on failure)
 *
 *   • every builtIns type builds (bathroom.js / laundry.js through builtins.js buildBuiltIn): vertices within a budget,
 *     fewer on «lav», the geometry's box where the photos put it (WC bowl front, vanity, mirror, the shower's glass);
 *   • the shower outlines: the five-sided one of the bathroom exactly V43's corners, the laundry's glass V59's lines;
 *   • colliders: per entry (none for the drain), the pentagon's staircase covers the inside and stays off the room;
 *   • the LED ring of the mirror is a built-in light of group «bad» (3000 K, 400 lm) with its own dimmable materials;
 *   • buildBuiltIns(ctx, layout) puts everything in roots.rooms[roomId].contents (the returned group stays empty),
 *     inside the room, and the WC's cistern box follows its wall's paint (setPaint / reset);
 *   • no new shader programs: every material is a MeshStandardMaterial with the same map set (map, normalMap,
 *     roughnessMap) as the textured kinds – or the kitchen sink's back-face set-up – without vertex colours, clearcoat
 *     or transmission; the finishes of surfaces.js average to their colour;
 *   • fittings.js: the worktop / sink / tap helpers the kitchen uses build the same parts every time.
 * The bathroom of 1. etasje has no builtIns in the data yet (steg 12): its entries come from
 * tools/house-tests/fixtures/bad-builtins.json, the laundry's from room-spec.json (30-kjeller.json).
 */
import { imp, readJson, check, section, near, done } from './_lib.mjs';

const THREE = await import('three');
const { buildLayout } = await imp('src/home/layout.js');
const { buildBuiltIns, buildBuiltIn, builtInFrame, BUILDERS } = await imp('src/home/builtins.js');
const { showerOutline, loft, roundedRectXZ } = await imp('src/home/bathroom.js');
const { createHouseRoots } = await imp('src/home/index.js');
const S = await imp('src/world/surfaces.js');
const { MeshBatcher } = await imp('src/world/buildKit.js');
const fittings = await imp('src/home/fittings.js');

const spec = readJson('src/data/room-spec.json');
const palette = readJson('src/data/palette.json');
const bad = readJson('tools/house-tests/fixtures/bad-builtins.json');
const full = structuredClone(spec);
full.builtIns = [...(full.builtIns || []).filter((b) => !bad.builtIns.some((x) => x.id === b.id)), ...bad.builtIns];
const quiet = (fn) => {
  const warns = [];
  const orig = console.warn;
  console.warn = (...a) => warns.push(a.join(' '));
  try {
    return [fn(), warns];
  } finally {
    console.warn = orig;
  }
};
const [layout] = quiet(() => buildLayout(full, palette));
const H = layout.house;
const byId = Object.fromEntries(H.builtIns.map((b) => [b.id, b]));
const roomOf = (id) => H.rooms.find((r) => r.id === id);

/** Triangles of everything under obj (merged batches may be welded into indexed geometry). */
const vertsOf = (obj) => {
  let n = 0;
  obj.traverse((o) => {
    if (o.isMesh) n += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3;
  });
  return n;
};
const boxOf = (obj, filter = () => true) => {
  const box = new THREE.Box3();
  obj.updateMatrixWorld(true);
  obj.traverse((o) => {
    if (!o.isMesh || !filter(o)) return;
    o.geometry.computeBoundingBox();
    box.union(o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld));
  });
  return box;
};
const fmt = (b) => `${b.min.toArray().map((v) => v.toFixed(3))} → ${b.max.toArray().map((v) => v.toFixed(3))}`;

// ---------------------------------------------------------------------------------------------------------------
section('Every type builds (bathroom.js, laundry.js)');
const TYPES = ['wc', 'vanity', 'shower', 'mirror-round', 'floor-drain', 'towel-radiator', 'laundry-bench', 'cabinet-row', 'washer', 'dryer', 'wardrobe-sliding'];
check('builtins.js dispatches every type of 00-ids.json (+ water-heater)', TYPES.every((t) => typeof BUILDERS[t] === 'function') && typeof BUILDERS['water-heater'] === 'function', Object.keys(BUILDERS).join());
const BUDGET = { wc: 2500, vanity: 2500, shower: 4000, 'mirror-round': 1200, 'floor-drain': 600, 'towel-radiator': 600, 'laundry-bench': 2500, 'cabinet-row': 1200, washer: 1200, dryer: 1200, 'wardrobe-sliding': 600 };
const built = {};
for (const b of H.builtIns) {
  const [r, warns] = quiet(() => buildBuiltIn(b, layout));
  const [rl] = quiet(() => buildBuiltIn(b, layout, { low: true }));
  built[b.id] = r;
  const v = r ? vertsOf(r.group) : 0;
  const vl = rl ? vertsOf(rl.group) : 0;
  check(`${b.id} (${b.type}): builds without warnings, ${v} triangles ≤ ${BUDGET[b.type]}, «lav» ${vl} ≤`, r && !warns.length && v > 0 && v <= BUDGET[b.type] && vl <= v, warns.join(' | '));
}
check('the bathroom of 1. etasje (fixture) and the laundry (data) are all there', ['bi-bad-dusj', 'bi-bad-sluk', 'bi-bad-wc', 'bi-bad-servant', 'bi-bad-speil', 'bi-vask-dusj', 'bi-vask-sluk', 'bi-vask-wc', 'bi-vask-handkletorker', 'bi-vask-benk', 'bi-vask-skaprad', 'bi-vask-vaskemaskin', 'bi-vask-torketrommel', 'bi-entre-garderobe'].every((id) => built[id]));

// ---------------------------------------------------------------------------------------------------------------
section('Where the photos put them (world boxes)');
const near3 = (a, b, tol) => a.every((v, i) => Math.abs(v - b[i]) <= tol);
{
  const wc = boxOf(built['bi-bad-wc'].group);
  check('bad WC: box on the north wall z 1,50–2,15, bowl front on x 0,74, top 1,10 (V44)', near(wc.min.x, 0, 0.005) && near(wc.max.x, 0.74, 0.015) && near(wc.min.z, 1.5, 0.01) && near(wc.max.z, 2.16, 0.01) && near(wc.max.y, 1.1, 0.01) && wc.min.y >= -0.001, fmt(wc));
  const bowl = boxOf(built['bi-bad-wc'].group, (m) => /ceramic/.test(m.material.name));
  check('bad WC: rim (lid) at 0,42–0,46, the bowl hangs free of the floor', bowl.max.y > 0.44 && bowl.max.y < 0.47 && bowl.min.y > 0.05, fmt(bowl));
  const v = boxOf(built['bi-bad-servant'].group);
  check('bad vanity: x 1,50–2,30 on the east wall, 0,46 deep, underside 0,35, top 0,85 + the tap (V38)', near(v.min.x, 1.5, 0.005) && near(v.max.x, 2.3, 0.005) && near(v.min.z, 0, 0.005) && near(v.max.z, 0.46, 0.006) && near(v.min.y, 0.35, 0.005) && v.max.y > 0.95 && v.max.y < 1.05, fmt(v));
  const m = boxOf(built['bi-bad-speil'].group, (o) => !/halo/.test(o.name));
  check('bad mirror: Ø 0,80 round x 1,90, underside 1,08, on the wall (V39)', near(m.min.x, 1.5, 0.005) && near(m.max.x, 2.3, 0.005) && near(m.min.y, 1.08, 0.005) && near(m.max.y, 1.88, 0.005) && m.min.z >= -0.001 && m.max.z <= 0.042, fmt(m));
  const sh = boxOf(built['bi-bad-dusj'].group);
  check('bad shower: in the NE corner x 0–0,95, z 0–0,90, glass 2,0 high, the overhead shower under 2,40', sh.min.x >= -0.001 && sh.max.x <= 0.98 && sh.min.z >= -0.001 && sh.max.z <= 0.93 && sh.max.y > 2.0 && sh.max.y < 2.36, fmt(sh));
  const vs = boxOf(built['bi-vask-dusj'].group);
  check('laundry shower: x 0,13–1,21, z 4,55–5,72, floor −2,55, dark panels up to the ceiling −0,30 (V59)', vs.min.x >= 0.129 && vs.max.x <= 1.25 && vs.min.z >= 4.549 && vs.max.z <= 5.76 && near(vs.min.y, -2.55, 0.002) && near(vs.max.y, -0.30, 0.01), fmt(vs));
  const panels = boxOf(built['bi-vask-dusj'].group, (o) => /dark-panel/.test(o.material.name));
  check('laundry shower: the dark panels cover the north and east wall inside the shower only', near(panels.min.x, 0.13, 0.01) && near(panels.max.x, 1.21, 0.01) && near(panels.min.z, 4.55, 0.01) && near(panels.max.z, 5.72, 0.01), fmt(panels));
  const tr = boxOf(built['bi-vask-handkletorker'].group);
  check('laundry towel radiator: one tube at x 1,31 on the east wall, h 0,05–1,80 (+ hook) (V60)', near((tr.min.x + tr.max.x) / 2, 1.31, 0.03) && tr.max.x - tr.min.x < 0.06 && near(tr.min.y, -2.5, 0.01) && tr.max.y > -0.76 && tr.max.y < -0.68 && tr.min.z >= 4.549, fmt(tr));
  const be = boxOf(built['bi-vask-benk'].group);
  check('laundry bench: x 0,13–2,76 on the west wall z 7,83–8,45, top 0,90 + the tap', near(be.min.x, 0.13, 0.005) && near(be.max.x, 2.76, 0.005) && near(be.min.z, 7.83, 0.04) && near(be.max.z, 8.45, 0.005) && be.max.y > -1.65 && be.max.y < -1.25, fmt(be));
  const row = boxOf(built['bi-vask-skaprad'].group);
  check('laundry cabinet row: fronts on x 2,17, z 6,05–8,45, floor to ceiling', near(row.min.x, 2.17, 0.06) && near(row.max.x, 2.76, 0.005) && near(row.min.z, 6.05, 0.005) && near(row.max.z, 8.45, 0.005) && near(row.max.y, -0.3, 0.005) && near(row.min.y, -2.55, 0.005), fmt(row));
  const wa = boxOf(built['bi-vask-vaskemaskin'].group), dr = boxOf(built['bi-vask-torketrommel'].group);
  check('washer on the floor, dryer stacked on it (topp ≈ 1,72) – no overlap', near(wa.min.y, -2.55 + 0.01, 0.005) && wa.max.y <= dr.min.y + 1e-3 && near(dr.max.y, -2.55 + 1.73, 0.03), `${fmt(wa)} / ${fmt(dr)}`);
}

// ---------------------------------------------------------------------------------------------------------------
section('Shower outlines (V43, V59)');
{
  const pent = showerOutline(byId['bi-bad-dusj']);
  const want = [[0, 0.9], [0.37, 0.9], [0.95, 0.37], [0.95, 0]];
  check('pentagon: (0; 0,90) → (0,37; 0,90) → (0,95; 0,37) → (0,95; 0), walls\' corner (0; 0)', pent.points.length === 4 && pent.points.every((p, i) => near3(p, want[i], 1e-9)) && near3(pent.corner, [0, 0], 1e-9), JSON.stringify(pent));
  const rect = byId['bi-vask-dusj'].params.glass;
  check('laundry: the glass follows the data – front x 1,21 (fixed + sliding), side z 5,72 (fixed)', rect[0].line[0][0] === 1.21 && rect[0].panels.map((p) => p.kind).join() === 'fixed,sliding' && rect[1].line[0][1] === 5.72);
  const glass = boxOf(built['bi-vask-dusj'].group, (o) => /glass/.test(o.material.name));
  check('laundry: the glass panes stand on the two lines (x ≤ 1,21 + the sliding leaf\'s track, z ≤ 5,72)', near(glass.max.x, 1.21, 0.01) && near(glass.max.z, 5.72, 0.01) && near(glass.min.x, 0.13, 0.02) && near(glass.min.z, 4.55, 0.02), fmt(glass));
  const pg = boxOf(built['bi-bad-dusj'].group, (o) => /glass/.test(o.material.name));
  check('pentagon: the glass spans the corner points (no top rail, 2,0 high)', near(pg.max.x, 0.95, 0.01) && near(pg.max.z, 0.9, 0.01) && near(pg.max.y - pg.min.y, 2.0, 0.01), fmt(pg));
}

// ---------------------------------------------------------------------------------------------------------------
section('Colliders');
{
  const inAny = (boxes, x, y, z) => boxes.some((b) => b.containsPoint(new THREE.Vector3(x, y, z)));
  const c = built['bi-bad-dusj'].colliders;
  const inside = [[0.2, 0.2], [0.1, 0.8], [0.8, 0.1], [0.5, 0.5], [0.3, 0.6]];
  const outside = [[0.85, 0.75], [0.7, 0.85], [0.95, 0.6], [1.1, 0.2], [0.3, 1.0]];
  check('pentagon: the boxes cover the inside of the glass', inside.every(([x, z]) => inAny(c, x, 1, z)), JSON.stringify(inside.filter(([x, z]) => !inAny(c, x, 1, z))));
  check('pentagon: and leave the room in front of the diagonal free (≤ half a step past it)', outside.every(([x, z]) => !inAny(c, x, 1, z)), JSON.stringify(outside.filter(([x, z]) => inAny(c, x, 1, z))));
  check('the drain and the mirror have no collider (collide: false)', built['bi-bad-sluk'].colliders.length === 0 && built['bi-bad-speil'].colliders.length === 0);
  const wc = built['bi-bad-wc'].colliders;
  check('WC: the cistern box and the bowl', wc.length === 2 && inAny(wc, 0.5, 0.3, 1.83) && inAny(wc, 0.1, 1.0, 1.83) && !inAny(wc, 0.9, 0.3, 1.83));
  const row = built['bi-vask-skaprad'].colliders;
  check('cabinet row: one box over its footprint, floor to ceiling', row.length === 1 && near(row[0].min.x, 2.17, 0.005) && near(row[0].max.y, -0.3, 0.005));
}

// ---------------------------------------------------------------------------------------------------------------
section('The LED ring of the mirror (a built-in light, group bad)');
{
  const L = built['bi-bad-speil'].lights;
  const l = L[0];
  check('one light: group bad, 3000 K, 400 lm, in front of the mirror, facing the room', L.length === 1 && l.group === 'bad' && l.colorK === 3000 && l.lumens === 400 && l.position.z > 0.05 && near(l.position.x, 1.9, 1e-6) && near(l.position.y, 1.48, 1e-6) && l.direction.z > 0.99, JSON.stringify(l));
  check('its band and halo glow with own (dimmable, not cached) materials', l.emissiveMeshes.length === 2 && l.emissiveMeshes.every((m) => m.isMesh && m.material.userData.cached === false && m.material.userData.baseIntensity > 0 && m.material.emissive.r > 0));
}

// ---------------------------------------------------------------------------------------------------------------
section('buildBuiltIns: rooms, contents, paint');
{
  const roots = createHouseRoots(layout);
  const ctx = { scene: new THREE.Scene(), quality: {}, roots };
  const [r, warns] = quiet(() => buildBuiltIns(ctx, layout));
  check('no warnings; the returned group stays empty, nothing at the scene root', !warns.length && !r.group.children.length && !ctx.scene.children.length, warns.join(' | '));
  const rooms = new Set(H.builtIns.map((b) => b.roomId));
  check(`meshes in roots.rooms[…].contents of ${[...rooms].join(', ')} only`, [...rooms].every((id) => roots.rooms[id].contents.children.length > 0) && Object.values(roots.rooms).every((rm) => rooms.has(rm.id) || !rm.contents.children.length) && Object.values(roots.rooms).every((rm) => !rm.surfaces.children.length));
  for (const id of rooms) {
    const room = roomOf(id);
    const bb = boxOf(roots.rooms[id].contents);
    const rb = room.bounds;
    check(`${id}: everything inside the room (plan ${rb.minX.toFixed(2)}–${rb.maxX.toFixed(2)} × ${rb.minZ.toFixed(2)}–${rb.maxZ.toFixed(2)}, floor to ceiling; ≤ 6 mm into a wall)`, bb.min.x >= rb.minX - 0.006 && bb.max.x <= rb.maxX + 0.006 && bb.min.z >= rb.minZ - 0.006 && bb.max.z <= rb.maxZ + 0.006 && bb.min.y >= room.floorY - 0.001 && bb.max.y <= room.ceilingTop + 0.001, fmt(bb));
  }
  const nColl = H.builtIns.reduce((s, b) => s + (b.collide === false ? 0 : (built[b.id]?.colliders.length ?? 0)), 0);
  check(`colliders: ${nColl} static boxes (the same as one by one), world space`, r.colliders.length === nColl && r.colliders.every((b) => b.isBox3 && !b.isEmpty()));
  check('builtInLights: the mirror ring, labelled with its group', r.builtInLights.length === 1 && r.builtInLights[0].id === 'bi-bad-speil' && r.builtInLights[0].label === (H.lightGroups.find((g) => g.id === 'bad')?.label ?? 'Bad'));
  let meshes = 0;
  for (const id of rooms) roots.rooms[id].contents.traverse((o) => o.isMesh && meshes++);
  check(`draw calls stay low: ${meshes} meshes for ${H.builtIns.length} built-ins in ${rooms.size} rooms (≤ 60)`, meshes <= 60);
  const boxMesh = [];
  roots.rooms.vaskerom.contents.traverse((o) => o.isMesh && o.userData.builtIn === 'bi-vask-wc' && boxMesh.push(o));
  const before = boxMesh[0]?.material;
  r.setPaint('w-vask-nord', '#aa3322');
  const after = boxMesh[0]?.material;
  r.setPaint('w-vask-nord', null);
  check('the laundry WC box follows w-vask-nord\'s paint (setPaint) and goes back (null)', boxMesh.length === 2 && after !== before && after.color && boxMesh[0].material === before);
  const badBox = [];
  roots.rooms.bad.contents.traverse((o) => o.isMesh && o.userData.builtIn === 'bi-bad-wc' && badBox.push(o));
  check('the bathroom WC box is clad with the stone panels of w-bad-nord', badBox.length === 2 && /stone-panel/.test(badBox[0].material.name), badBox[0]?.material?.name);
  r.dispose();
  check('dispose takes the meshes out of the rooms', [...rooms].every((id) => !roots.rooms[id].contents.children.length));
  const [empty] = quiet(() => buildBuiltIns({}, buildLayout(structuredClone({ ...spec, builtIns: [] }), palette)));
  check('a house without builtIns: the empty contract (no roots needed)', empty.colliders.length === 0 && !empty.group.children.length && typeof empty.setPaint === 'function');
  const odd = structuredClone(full);
  odd.builtIns.push({ id: 'bi-x', roomId: 'bad', type: 'sauna', mount: 'floor', position: [1, 0, 1], dims: { w: 1, d: 1, h: 2 } });
  const [L2] = quiet(() => buildLayout(odd, palette));
  const [r2, w2] = quiet(() => buildBuiltIns({ quality: {}, roots: createHouseRoots(L2) }, L2));
  check('an unknown type is skipped with a warning, the rest is built', w2.some((w) => /bi-x/.test(w)) && r2.colliders.length === nColl);
}

// ---------------------------------------------------------------------------------------------------------------
section('No new shader programs (§4.16)');
{
  const sig = (m) => [m.type, m.transparent ? 'T' : 'O', m.side, !!m.map, !!m.normalMap, !!m.roughnessMap, !!m.emissiveMap, !!m.alphaMap, !!m.vertexColors].join('|');
  const ALLOWED = new Set([
    'MeshStandardMaterial|O|0|true|true|true|false|false|false', // every opaque material of materials.js
    'MeshStandardMaterial|T|0|true|true|true|false|false|false', // glass (and the mirror halo)
    'MeshStandardMaterial|O|1|false|false|false|false|false|false', // the kitchen sink's basin (back faces)
  ]);
  const seen = new Map();
  for (const r of Object.values(built)) {
    r.group.traverse((o) => {
      if (!o.isMesh) return;
      for (const m of [].concat(o.material)) seen.set(m, sig(m));
    });
  }
  const bad2 = [...seen].filter(([, s]) => !ALLOWED.has(s)).map(([m, s]) => `${m.name}: ${s}`);
  check(`${seen.size} materials, all in the existing program set (standard + maps, glass, sink)`, !bad2.length, bad2.join(' | '));
  check('no MeshPhysicalMaterial, clearcoat or transmission', [...seen.keys()].every((m) => !m.isMeshPhysicalMaterial && !m.clearcoat && !m.transmission));
}

// ---------------------------------------------------------------------------------------------------------------
section('surfaces.js: stonePanel / tiles / wetroom');
{
  const meanLin = (tex) => {
    const d = tex.image.data;
    let s = 0;
    const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    for (let i = 0; i < d.length; i += 4) s += lin(d[i] / 255);
    return s / (d.length / 4);
  };
  for (const [kind, hex, opts] of [['stone-panel', '#c8c5bf', { panel: { size: [0.6, 2.4], joint: '#bcb9b3' } }], ['dark-panel', '#5a5657', { clouds: 4 }], ['vinyl', '#5a5759', {}], ['tiles', '#e6e4df', {}], ['laminate', '#938b85', {}]]) {
    const m = S.surfaceFinish(kind, hex, opts);
    const want = new THREE.Color(hex);
    const lum = (c) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
    const got = lum(m.color) * meanLin(m.map);
    check(`${kind} ${hex}: DataTextures (map, normal, roughness), mean colour = the hex (${(got / lum(want)).toFixed(3)})`, m.map.isDataTexture && m.normalMap.isDataTexture && m.roughnessMap.isDataTexture && Math.abs(got / lum(want) - 1) < 0.03 && m.userData.cached === true && S.surfaceFinish(kind, hex, opts) === m);
  }
  const sp = S.stonePanel({ size: [0.6, 2.4] });
  const row = sp.size[0];
  const d = sp.map.image.data;
  // joints: the darkest column of the first row should sit at u = 0 or 0.5 (every 0.60 m)
  let minI = 0;
  for (let x = 0; x < row; x++) if (d[x * 4] < d[minI * 4]) minI = x;
  const u = minI / row;
  check('stone panel: vertical joints every 0,60 (tile 1,20, the darkest column on a joint), no horizontal joint', near(sp.tile[0], 1.2, 1e-9) && (u < 0.01 || Math.abs(u - 0.5) < 0.01 || u > 0.99), `u ${u}`);
  check('wallFinish / floorFinish: textured for stone-panel walls and vinyl floors, null for paint', S.wallFinish(H.wallsById['w-bad-ost'])?.userData.kind === 'stone-panel' && S.wallFinish(H.wallsById['w-vask-nord']) === null && S.floorFinish(roomOf('vaskerom').floor)?.userData.kind === 'vinyl' && S.floorFinish(roomOf('gang').floor) === null);
  check('panelUOffset centres the joints (2,53 → 0,235; 2,40 → 0)', near(S.panelUOffset(2.53), 0.235, 1e-9) && S.panelUOffset(2.4) === 0);
}

// ---------------------------------------------------------------------------------------------------------------
section('fittings.js (the kitchen\'s helpers) and the loft');
{
  const mk = () => {
    const kb = new MeshBatcher('t');
    const m = new THREE.MeshStandardMaterial();
    fittings.makeWorktop(kb, { x0: 0, x1: 2.5, z0: 0, z1: 0.62, y0: 0.87, t: 0.03 }, m, { hole: { x: 1, z: 0.3, w: 0.5, d: 0.42, r: 0.03 } });
    fittings.makeSink(kb, { x: 1, z: 0.3, w: 0.5, d: 0.42, h: 0.2, topY: 0.9 }, { basin: m, steel: m, vent: m });
    fittings.makeTap(kb, { x: 1, z: 0.08, topY: 0.9, h: 0.35 }, m);
    fittings.baseRun(kb, [[0, 0.6, 'skuffer'], [0.6, 1.2, 'dører']], 0.6, 0.62, { M: { front: m, channel: m, plinth: m } });
    return vertsOf(kb.build());
  };
  const a = mk(), b = mk();
  check(`worktop + sink + tap + base run: deterministic (${a} triangles)`, a > 0 && a === b);
  const g = loft(roundedRectXZ(0.36, 0.54, 0.03, 0.15, 6), [{ y: 0, sx: 0.6, sz: 0.6 }, { y: 0.3 }]);
  g.computeBoundingBox();
  const nrm = g.attributes.normal, pos = g.attributes.position;
  let outward = 0, total = 0;
  for (let i = 0; i < pos.count; i++) {
    if (Math.abs(nrm.getY(i)) > 0.9) continue;
    total++;
    if (nrm.getX(i) * pos.getX(i) + nrm.getZ(i) * (pos.getZ(i) - 0.27) > 0) outward++;
  }
  check('loft: closed, side normals point outward, size as given', outward / total > 0.97 && near(g.boundingBox.max.z, 0.54, 1e-6) && near(g.boundingBox.max.y, 0.3, 1e-6), `${outward}/${total}`);
  const f = builtInFrame({ position: [0.13, 0, 6.32], rotationDeg: 90, mount: 'wall', dims: { d: 0.2 } });
  check('builtInFrame: a wall-mounted entry\'s origin is d/2 in front of the wall, +z = the front', near(f.centre.x, 0.23, 1e-9) && near(f.front.x, 1, 1e-9));
}

done();
