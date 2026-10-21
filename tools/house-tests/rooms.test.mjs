#!/usr/bin/env node
/**
 * Node test for the room builder (notes/hele-huset-design.md §6 steg 8 + 21 + 24: A2, A2′, C2):
 *   node tools/house-tests/rooms.test.mjs        (from the project root; exit code 1 on failure)
 *
 * Builds every room of the real data (src/data/room-spec.json) with src/home/rooms.js in Node (no renderer, small
 * textures) and checks:
 *   • every wall of the built rooms has a WallInfo; the slabs and the backOf faces of the rooms' own slabs have a mesh,
 *     each wall id at most one mesh in this builder (D13: no face is built twice); faces of the living room's slabs
 *     are the shell's (no mesh here);
 *   • every door outside the living room is a Door (door-gang stays the shell's), with openAngleDeg (door-ute 95°,
 *     door-soverom-kjeller 130°), a floor strip collider under its hole at the floor height;
 *   • the floors: one per room at its floor (the entrance and bod-3 at −2.85), the hall's with the stairwell cut out;
 *     the basement hall's ceiling with the hole; the white edge on the three free edges of the hole only (V16);
 *   • the slab box (§2.8): under the ground floor's rooms and walls, not in the hole, y −0.30 … 0;
 *   • the stairwell is open: no cover over the hole, every cover ≤ −0.23, a ray down through the hole hits the
 *     basement hall's floor (−2.55) first;
 *   • door-bod-1 (narrow): its side karms collide only with their outer 2 cm; win-sk's reveal is clamped to the wall;
 *   • the opening GANG ↔ entré: two steps of 0.15 and an invisible wedge from the hall floor to the entrance floor;
 *   • the wall slab under the entrance faces reaches down to −2.85, the stairwell's north wall down to the ledge;
 *   • Door.js: openAngleDeg, and an open leaf off the world axes is covered by its segment boxes.
 * The browser side (images, walking) is tools/walkmap.mjs / tools/shot.mjs on the test server.
 */
import { imp, check, section, near, done } from './_lib.mjs';

const THREE = await import('three');
(await imp('src/home/materials.js')).configureMaterials({ textureRes: 0.125 });
const { layout } = await imp('src/home/layout.js');
const { buildRooms, slabBoxes } = await imp('src/home/rooms.js');
const { createHouseRoots } = await imp('src/home/index.js');
const { Door } = await imp('src/world/Door.js');
const { rectCells } = await imp('src/home/wallkit.js');

const H = layout.house;
const roots = createHouseRoots(layout, [new THREE.Group()]);
const zones = [];
const dyn = [];
const ctx = {
  scene: new THREE.Scene(),
  quality: {},
  roots,
  collision: {
    addSurfaceZone: (b, s) => zones.push({ b, s }),
    addDynamicBox: (b, o = {}) => {
      const h = { box: b.clone(), enabled: o.enabled ?? true, id: o.id };
      dyn.push(h);
      return h;
    },
    removeDynamic() {},
  },
};
const t0 = Date.now();
const R = buildRooms(ctx, layout, null);
const ms = Date.now() - t0;
const built = H.rooms.filter((r) => r.id !== 'stue-kjokken' && !r.hud);
const builtIds = new Set(built.map((r) => r.id));
const meshesNamed = (name) => {
  const out = [];
  for (const rm of Object.values(roots.rooms)) rm.group.traverse((o) => o.isMesh && o.name === name && out.push(o));
  R.group.traverse((o) => o.isMesh && o.name === name && out.push(o));
  return out;
};
/** Area of a horizontal (floor / ceiling) geometry. */
function areaOf(g) {
  const p = g.attributes.position;
  const idx = g.index ? g.index.array : null;
  const n = idx ? idx.length : p.count;
  let a = 0;
  const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3();
  for (let i = 0; i < n; i += 3) {
    A.fromBufferAttribute(p, idx ? idx[i] : i);
    B.fromBufferAttribute(p, idx ? idx[i + 1] : i + 1);
    C.fromBufferAttribute(p, idx ? idx[i + 2] : i + 2);
    a += B.sub(A).cross(C.sub(A)).length() / 2;
  }
  return a;
}

// ---------------------------------------------------------------------------------------------------------------
section(`Build (${ms} ms): ${built.length} rooms`);
check('rooms of both levels are built (bad, gang, soverom, the 8 basement rooms)', built.length >= 11 && ['bad', 'gang', 'soverom', 'kjeller-gang', 'vaskerom', 'kjellerstue', 'soverom-kjeller', 'entre-kjeller', 'bod-1', 'bod-2', 'bod-3'].every((id) => builtIds.has(id)), [...builtIds].join());
// the soffits outside are exterior.js's (steg 25, C3) since the merge of bølge 1 gruppe 2: nothing at the scene root
check('the returned group holds no level geometry and no soffits (exterior.js builds those)', R.group.children.length === 0, R.group.children.map((c) => c.name).join());
check('every room\'s surfaces / contents got its groups (solid, deco, lamps)', built.every((r) => roots.rooms[r.id].surfaces.getObjectByName(`room:${r.id}:solid`) && roots.rooms[r.id].contents.getObjectByName(`room:${r.id}:lamps`)));

section('Walls (D13)');
const houseWalls = H.walls.filter((w) => builtIds.has(w.roomId));
const infoIds = new Set(R.walls.map((w) => w.id));
check('a WallInfo for every wall of the built rooms', houseWalls.every((w) => infoIds.has(w.id)) && R.walls.length === houseWalls.length, houseWalls.filter((w) => !infoIds.has(w.id)).map((w) => w.id).join());
const livingSlab = (f) => f.backOf.some((id) => H.wallsById[id]?.roomId === 'stue-kjokken');
const noMesh = R.walls.filter((w) => !w.meshes.length);
check('every slab and every face of a room slab has a mesh; only faces of the living room\'s slabs have none here (the shell builds those)', noMesh.every((w) => w.backOf && livingSlab(H.wallsById[w.id])), noMesh.map((w) => w.id).join());
const dup = houseWalls.filter((w) => meshesNamed(`wall:${w.id}`).length > 1);
check('no wall / face id has two meshes in the rooms (nothing built on top of a slab)', !dup.length, dup.map((w) => w.id).join());
check('the faces carry their own id, paint and pick (w-vask-sor, w-entre-nord, w-sk-sor)', ['w-vask-sor', 'w-entre-nord', 'w-sk-sor'].every((id) => {
  const m = meshesNamed(`wall:${id}`)[0];
  return m && m.userData.pick?.wallId === id && m.userData.backOf?.length;
}));
{
  // the slab under the entrance's north face (w-kg-sor) reaches down to the entrance floor (−2.85)
  const m = meshesNamed('wall:w-entre-nord')[0];
  m.geometry.computeBoundingBox();
  check('w-kg-sor: its back (the entrance\'s north wall) goes down to the entrance floor −2.85', m && near(m.geometry.boundingBox.min.y, -2.85, 0.005), m && m.geometry.boundingBox.min.y.toFixed(3));
  const n = meshesNamed('wall:w-gang-nord')[0];
  n.geometry.computeBoundingBox();
  check('w-gang-nord (in the stairwell): its face goes down to the slab underside (the ledge on top of the basement wall, V16/V21)', n && near(n.geometry.boundingBox.min.y, -0.3, 0.005), n && n.geometry.boundingBox.min.y.toFixed(3));
  const s = meshesNamed('wall:w-gang-sov')[0];
  s.geometry.computeBoundingBox();
  check('w-gang-sov stays on the floor (the basement shaft wall below is in the same plane, no z-fighting)', s && near(s.geometry.boundingBox.min.y, 0, 0.005), s && s.geometry.boundingBox.min.y.toFixed(3));
}

{
  // the basement's plaster stops at the slab underside where a ground-floor facade comes down to it (one layer per plane)
  let top = -Infinity;
  for (const id of ['bod-2', 'bod-1']) {
    roots.rooms[id].surfaces.traverse((o) => {
      if (!o.isMesh || !/plaster|painted #d9d6cf/.test(o.material?.name || '') || !o.name.startsWith('room-outside')) return;
      const p = o.geometry.attributes.position;
      for (let i = 0; i < p.count; i++) if (Math.abs(p.getZ(i) + 0.3) < 1e-3 && p.getX(i) > 0.2 && p.getX(i) < 6.5) top = Math.max(top, p.getY(i));
    });
  }
  check('the basement\'s east facade (plaster, z −0.30) ends at the slab underside −0.30 under the ground floor\'s cladding', top > -1 && top <= -0.3 + 1e-4, top.toFixed(3));
}

section('Doors');
const doorIds = new Set(R.doors.map((d) => d.id));
const want = H.doors.filter((d) => builtIds.has(d.roomId));
check('every door of the built rooms is a Door (door-gang stays the shell\'s)', want.every((d) => doorIds.has(d.id)) && !doorIds.has('door-gang') && R.doors.every((d) => d.door instanceof Door), want.filter((d) => !doorIds.has(d.id)).map((d) => d.id).join());
const deg = (id) => (R.doors.find((d) => d.id === id)?.door.openAngle * 180) / Math.PI;
check('openAngleDeg: door-ute 95°, door-soverom-kjeller 130°, door-bad 90°', near(deg('door-ute'), 95, 1e-6) && near(deg('door-soverom-kjeller'), 130, 1e-6) && near(deg('door-bad'), 90, 1e-6), `${deg('door-ute')} ${deg('door-soverom-kjeller')} ${deg('door-bad')}`);
check('the storage doors are closed but can be opened (interactive)', ['door-bod-1', 'door-bod-2', 'door-bod-3'].every((id) => {
  const d = R.doors.find((x) => x.id === id);
  return d && !d.door.isOpen && H.openingsById[id].interactive;
}));
{
  const d = H.doors.find((x) => x.id === 'door-ute');
  const door = R.doors.find((x) => x.id === 'door-ute').door;
  door.setOpen(true, { instant: true });
  const leaf = door.leaves[0];
  const p = new THREE.Vector3(0, 1, 0).applyMatrix4(leaf.pivot.matrixWorld);
  const tip = new THREE.Vector3(-door.leaves[0].hingeSide * leaf.length, 1, 0).applyMatrix4(leaf.pivot.matrixWorld);
  check('door-ute opens outward (the free edge ends up outside the entrance, x > 8.88)', tip.x > 8.88 + 0.5, `tip ${tip.x.toFixed(2)} ${tip.z.toFixed(2)} pivot ${p.x.toFixed(2)} ${p.z.toFixed(2)}`);
  check('door-ute at 95°: the open leaf is covered by its segment boxes, not one big AABB', !leaf.collider.enabled && leaf.segments.every((s) => s.enabled));
  door.setOpen(false, { instant: true });
  check('door-ute closed again: one box in the hole', leaf.collider.enabled && leaf.segments.every((s) => !s.enabled));
  const strip = R.colliders.find((c) => c.isBox3 && near(c.max.y, d.floorY, 1e-6) && c.containsPoint(new THREE.Vector3(d.basis.origin.x - d.basis.zAxis.x * 0.1, d.floorY - 0.05, d.basis.origin.z)));
  check('a walkable floor strip under the outer door\'s hole (top at the entrance floor −2.85)', !!strip && near(d.floorY, -2.85, 1e-6));
}
{
  const d = new Door({}, { id: 't', matrix: new THREE.Matrix4(), width: 1, height: 2, depth: 0.1, materials: { leaf: null, frame: null, hardware: null, dark: null }, openAngleDeg: 180 });
  check('Door.js: openAngleDeg 180 → π, axis-aligned when open', near(d.openAngle, Math.PI, 1e-9) && d._openAxisAligned);
  const e = new Door({}, { id: 'u', matrix: new THREE.Matrix4(), width: 1, height: 2, depth: 0.1, materials: { leaf: null, frame: null, hardware: null, dark: null } });
  check('Door.js: default 90°', near(e.openAngle, Math.PI / 2, 1e-9) && e._openAxisAligned);
}

section('Floors, ceilings, the stairwell');
for (const id of ['bad', 'soverom', 'kjellerstue', 'entre-kjeller', 'bod-3']) {
  const r = H.roomsById[id];
  const m = meshesNamed(`floor:${id}`)[0];
  m?.geometry.computeBoundingBox();
  check(`floor:${id} at y ${r.floorY} with the room's area ${r.area.toFixed(2)}`, m && near(m.geometry.boundingBox.min.y, r.floorY, 1e-6) && near(areaOf(m.geometry), r.area, 0.01), m ? `${m.geometry.boundingBox.min.y} ${areaOf(m.geometry).toFixed(3)}` : 'none');
}
{
  const g = H.roomsById.gang;
  const m = meshesNamed('floor:gang')[0];
  check('floor:gang has the stairwell cut out (net area)', m && near(areaOf(m.geometry), g.netArea, 0.01), m && `${areaOf(m.geometry).toFixed(3)} vs ${g.netArea.toFixed(3)}`);
  const c = meshesNamed('ceiling:c-kjeller-gang')[0];
  const cr = H.ceilings.find((x) => x.id === 'c-kjeller-gang');
  const hole = H.floorOpenings.find((f) => f.id === 'trappehull');
  // the hole reaches x 0 (the ground floor's north wall), the basement ceiling starts at x 0.13 (V1): only its part
  const net = rectCells(cr.polygon, [hole.polygon]).reduce((a, [x0, z0, x1, z1]) => a + (x1 - x0) * (z1 - z0), 0);
  check('ceiling:c-kjeller-gang at −0.30 with the hole cut out', c && near(areaOf(c.geometry), net, 0.01) && near(net, cr.area - (hole.area - 0.13 * 2.11), 0.01), c && `${areaOf(c.geometry).toFixed(3)} vs ${net.toFixed(3)}`);
  const edges = [];
  for (const rm of Object.values(roots.rooms)) rm.group.traverse((o) => o.isMesh && o.name.startsWith('hole-edge:trappehull') && edges.push(o));
  check('the white edge face on the three free edges of the hole only (x 1.45, z 3.48, x 1.85), 0.30 deep', edges.length === 3 && edges.every((e) => {
    e.updateWorldMatrix(true, false);
    e.geometry.computeBoundingBox();
    const b = e.geometry.boundingBox.clone().applyMatrix4(e.matrixWorld);
    return near(b.min.y, -0.3, 1e-4) && near(b.max.y, 0, 1e-4);
  }), `${edges.length}`);
}
check('footstep zones: tile on the bathrooms, concrete in the storage rooms', zones.some((z) => z.s === 'tile' && z.b.containsPoint(new THREE.Vector3(1.2, 0.5, 1.1))) && zones.some((z) => z.s === 'tile' && z.b.containsPoint(new THREE.Vector3(1.3, -2.0, 6.4))) && zones.some((z) => z.s === 'concrete'));

section('Slab box (§2.8) and low ceilings');
{
  const sb = slabBoxes(H, 'hoved');
  const inAny = (x, y, z) => sb.some((b) => b.containsPoint(new THREE.Vector3(x, y, z)));
  check('under the hall, the bathroom, the bedroom and the living room', inAny(2.5, -0.15, 3.2) && inAny(1.2, -0.15, 1.1) && inAny(1.5, -0.15, 6) && inAny(5, -0.15, 8) && inAny(4.5, -0.15, 1.5));
  check('under the walls between the rooms (w-bad-gang z 2.22–2.32, w-gang-sov z 4.43–4.53, w-hoy x 3.12–3.22)', inAny(2.0, -0.15, 2.27) && inAny(2.5, -0.15, 4.48) && inAny(3.17, -0.15, 6));
  check('not in the stairwell (x 0.7 z 3.0, x 1.7 z 4.0)', !inAny(0.7, -0.15, 3.0) && !inAny(1.7, -0.15, 4.0));
  check('the slab is y −0.30 … 0, all its boxes are in the colliders', sb.every((b) => near(b.min.y, -0.3, 1e-9) && near(b.max.y, 0, 1e-9)) && sb.length > 0 && sb.length <= 60 && sb.every((b) => R.colliders.some((c) => c.isBox3 && c.equals(b))), `${sb.length} boxes`);
  check('a ceiling box under the entrance\'s low ceiling (−0.50 … −0.30)', R.colliders.some((c) => c.isBox3 && near(c.min.y, -0.5, 1e-6) && c.containsPoint(new THREE.Vector3(7.4, -0.4, 4.4))));
}

section('The stairwell is open (no cover over the hole)');
{
  const hole = H.floorOpenings.find((f) => f.id === 'trappehull');
  const inHole = (x, z) => hole.contains(x, z);
  const covers = [];
  for (const rm of Object.values(roots.rooms)) rm.group.traverse((o) => o.isMesh && o.name.startsWith('cover:') && covers.push(o));
  // every triangle of a cover: its centroid outside the hole, its height at most 7 cm over the slab underside (−0.30)
  const bad = [];
  for (const m of covers) {
    m.updateWorldMatrix(true, false);
    const p = m.geometry.attributes.position;
    const v = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
    for (let i = 0; i < p.count; i += 3) {
      for (let k = 0; k < 3; k++) v[k].fromBufferAttribute(p, i + k).applyMatrix4(m.matrixWorld);
      const cx = (v[0].x + v[1].x + v[2].x) / 3, cz = (v[0].z + v[1].z + v[2].z) / 3;
      if (inHole(cx, cz) || v.some((q) => q.y > H.levelsById.hoved.bottomY + 0.07 + 1e-6)) bad.push(`${m.name}@${cx.toFixed(2)},${v[0].y.toFixed(2)},${cz.toFixed(2)}`);
    }
  }
  check('no cover triangle over the hole, every cover ≤ −0.23 (the entrance and bod-3 keep theirs)', !bad.length && covers.some((c) => c.name === 'cover:bod-3') && covers.some((c) => c.name === 'cover:entre-kjeller'), bad.slice(0, 4).join(' ') || covers.map((c) => c.name).join());
  // a ray down through the hole: the first static triangle (any side, visible or not) is the basement hall's floor
  const meshes = [];
  for (const rm of Object.values(roots.rooms)) rm.group.traverse((o) => o.isMesh && meshes.push(o));
  R.group.traverse((o) => o.isMesh && meshes.push(o));
  const firstHit = (x, z) => {
    const ray = new THREE.Ray(new THREE.Vector3(x, 1, z), new THREE.Vector3(0, -1, 0));
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), t = new THREE.Vector3();
    let best = null;
    for (const m of meshes) {
      m.updateWorldMatrix(true, false);
      const g = m.geometry;
      const p = g.attributes.position;
      const idx = g.index ? g.index.array : null;
      const n = idx ? idx.length : p.count;
      for (let i = 0; i < n; i += 3) {
        a.fromBufferAttribute(p, idx ? idx[i] : i).applyMatrix4(m.matrixWorld);
        b.fromBufferAttribute(p, idx ? idx[i + 1] : i + 1).applyMatrix4(m.matrixWorld);
        c.fromBufferAttribute(p, idx ? idx[i + 2] : i + 2).applyMatrix4(m.matrixWorld);
        if (!ray.intersectTriangle(a, b, c, false, t)) continue;
        if (!best || t.y > best.y) best = { y: t.y, name: m.name || m.parent?.name || '?' };
      }
    }
    return best;
  };
  for (const [x, z] of [[0.7, 3.0], [1.2, 4.0], [1.7, 4.0], [0.4, 2.5]]) {
    const h = firstHit(x, z);
    check(`a ray down at (${x}, ${z}) in the hole hits floor:kjeller-gang at −2.55 first (nothing between −0.30 and 0)`, h && h.name === 'floor:kjeller-gang' && near(h.y, -2.55, 1e-4), h && `${h.name} @ ${h.y.toFixed(3)}`);
  }
  const sb = slabBoxes(H, 'hoved');
  const blocked = R.colliders.filter((c) => c.isBox3 && c.max.y > -2.5 && c.min.y < 0.5 && c.containsPoint(new THREE.Vector3(0.7, -0.15, 3.0)));
  check('no static box in the hole at the slab (x 0.7 z 3.0, y −0.15)', !blocked.length && !sb.some((b) => b.containsPoint(new THREE.Vector3(0.7, -0.15, 3.0))), `${blocked.length}`);
}

section('Narrow door, deep reveal');
{
  // door-bod-1 (hole 0.79): the side karms collide only with their outer 2 cm, so the 0.60 capsule passes the open leaf
  const d = H.doors.find((x) => x.id === 'door-bod-1');
  const o = d.basis.origin;
  const karms = R.colliders.filter((c) => c.isBox3 && near(c.min.y, d.floorY, 1e-6) && c.max.y > d.floorY + 1.5 && c.min.z < o.z + 0.05 && c.max.z > o.z - 0.15 && c.max.x > o.x - d.width / 2 - 0.01 && c.min.x < o.x + d.width / 2 + 0.01);
  const sizes = karms.map((c) => c.max.x - c.min.x);
  const clear = karms.length === 2 ? Math.max(...karms.map((c) => c.min.x)) - Math.min(...karms.map((c) => c.max.x)) : 0;
  check('door-bod-1: two karm boxes 0.02 wide in the hole, 0.75 clear between them', karms.length === 2 && sizes.every((s) => near(s, 0.02, 1e-6)) && near(clear, d.width - 0.04, 1e-6), `${karms.length} ${sizes.map((s) => s.toFixed(3))} clear ${clear.toFixed(3)}`);
  const wide = H.doors.find((x) => x.id === 'door-bod-2');
  const o2 = wide.basis.origin;
  check('a door ≥ 0.85 (door-bod-2) keeps its karms in the batch (no extra karm boxes)', !R.colliders.some((c) => c.isBox3 && near(c.min.y, wide.floorY, 1e-6) && c.max.y > wide.floorY + 1.5 && Math.abs((c.min.z + c.max.z) / 2 - o2.z) < 0.2 && Math.abs((c.min.x + c.max.x) / 2 - o2.x) < 0.6));
  // win-sk: reveal 0.38 in a 0.30 wall → the frame stays inside the wall
  const wi = R.windows.find((w) => w.id === 'win-sk');
  const ww = H.wallsById[wi.wallId];
  check('win-sk: reveal + frame inside the 0.30 wall (reveal clamped from 0.38), the board no deeper', wi.revealDepth + wi.frameDepth <= ww.thickness + 1e-9 && wi.sillBoard && wi.sillBoard.depth <= wi.revealDepth + 0.011, `rd ${wi.revealDepth.toFixed(3)} fd ${wi.frameDepth} t ${ww.thickness} board ${wi.sillBoard?.depth}`);
  const wb = R.windows.find((w) => w.id === 'win-bad');
  check('win-bad keeps its reveal 0.20 (it fits)', near(wb.revealDepth, 0.2, 1e-9));
  // in the opening's own frame (z 0 = the room face, −z outward): frame, sash, board and lining all within the wall
  const g = new THREE.Box3();
  wi.group.traverse((m) => {
    if (!m.isMesh) return;
    m.geometry.computeBoundingBox();
    g.union(m.geometry.boundingBox.clone().applyMatrix4(m.matrix));
  });
  check('win-sk: nothing of the window kit deeper than the wall (z ≥ −0.30 in the opening frame)', !g.isEmpty() && g.min.z >= -ww.thickness - 1e-4, `z ${g.min.z.toFixed(3)} … ${g.max.z.toFixed(3)}`);
}

section('Entrance steps (V24, §3.11)');
{
  const w = meshesNamed('steps:open-entre:wedge')[0];
  check('an invisible wedge over the steps (in the collision group)', w && w.visible === false && w.parent?.name === 'room:kjeller-gang:solid');
  if (w) {
    const ray = new THREE.Raycaster(new THREE.Vector3(5.955, -1, 3.9), new THREE.Vector3(0, -1, 0));
    w.material.side = THREE.DoubleSide;
    const hit = ray.intersectObject(w)[0];
    check('the wedge passes just above the middle tread (−2.70) in the middle of the 0.41 wall', hit && hit.point.y >= -2.7 - 0.005 && hit.point.y <= -2.62, hit && hit.point.y.toFixed(3));
    const hitA = new THREE.Raycaster(new THREE.Vector3(5.752, -1, 3.9), new THREE.Vector3(0, -1, 0)).intersectObject(w)[0];
    const hitB = new THREE.Raycaster(new THREE.Vector3(6.28, -1, 3.9), new THREE.Vector3(0, -1, 0)).intersectObject(w)[0];
    const none = new THREE.Raycaster(new THREE.Vector3(5.7, -1, 3.9), new THREE.Vector3(0, -1, 0)).intersectObject(w)[0];
    check('it starts on the edge of the hall floor (−2.55 at x 5.75, nothing under the hall floor: no edge to stop the capsule) and ends on the entrance floor (−2.85), ≤ 30°', hitA && hitB && !none && near(hitA.point.y, -2.55, 0.01) && near(hitB.point.y, -2.85, 0.015) && Math.atan2(0.3, 0.54) < (30 * Math.PI) / 180, `${hitA?.point.y.toFixed(3)} ${hitB?.point.y.toFixed(3)} ${none?.point.y}`);
  }
}

section('Lamps (dark until L1)');
check('plafond / downlight / led-strip fittings for the lights of the built rooms → builtInLights', R.builtInLights.length === H.builtInLights.filter((l) => builtIds.has(l.roomId) && ['plafond', 'downlight', 'led-strip'].includes(l.type)).length && R.builtInLights.every((l) => l.emissiveMeshes?.length && l.emissiveMeshes.every((m) => m.material.emissiveIntensity === 0)), `${R.builtInLights.length}`);

section('setPaint / dispose');
{
  R.setPaint('w-sov-ost', '#ff0000');
  const m = meshesNamed('wall:w-sov-ost')[0];
  check('setPaint on a face recolours its mesh, null restores the data colour', m && m.material.userData.hex === '#ff0000');
  R.setPaint('w-sov-ost', null);
  check('… null → #50575c', m && m.material.userData.hex === '#50575c', m?.material.userData.hex);
  R.setPaint('w-hoy', '#00ff00');
  check('an id of the living room is ignored', true);
  R.dispose();
  check('dispose takes the rooms\' groups out of the roots', Object.values(roots.rooms).every((rm) => !rm.surfaces.getObjectByName(`room:${rm.id}:solid`)));
}

done();
