#!/usr/bin/env node
/**
 * Node test for the roof details (notes/tak.md: halvvalm, pulttaksark i ytterveggen, piper; notes/vindusmodeller.md:
 * vinduer med skrå overkant):
 *   node tools/house-tests/takdetaljer.test.mjs        (from the project root; exit code 1 on failure)
 *
 * Builds the test houses of dev/takdetaljer.html (src/dev/takdetaljer-hus.js) with buildLayout + buildRooms and checks:
 *   • the half-hip: its planes (the hips hipHeight under the ridge at the gables, the ridge hipDepth in from them), the
 *     gable wall's top inside capped by the hip, the cladding up to the hip outside, no gutter on the small hips, the
 *     defaults and the validator's errors;
 *   • the shed dormer with its front in the wall (hus1): an ark, its roof falling to the front and meeting the main roof
 *     in a valley, the wall under it up to its roof inside and out (clad), the door and windows in it, the balcony;
 *   • the chimneys: where they stand and how high (the default 0.8 over the roof), a box per level inside with a
 *     collider each (the player's capsule is pushed out), the part over the roof hidden with the roofs, the crown, the
 *     rain cap, the flashing on the covering (on both planes of a ridge), the ridge cap stopped at it, the validator;
 *   • the windows with a sloped top: 'follow-roof' parallel to the wall's top, degrees, the hole in the wall and in
 *     the cladding following the slope, the glass a trapezoid, fields under a transom rectangles, the validator;
 *   • no holes (rays up from every room hit a ceiling, rays down onto every roof the roof or a chimney), no two faces
 *     facing the same way overlapping in one plane, the owner's house without any of it.
 */
import { imp, check, section, near, done, coplanarOverlaps } from './_lib.mjs';

const THREE = await import('three');
const { Capsule } = await import('three/addons/math/Capsule.js');
(await imp('src/home/materials.js')).configureMaterials({ textureRes: 0.125 });
const { buildLayout, layout: ownerLayout } = await imp('src/home/layout.js');
const { buildRooms } = await imp('src/home/rooms.js');
const { createHouseRoots } = await imp('src/home/index.js');
const { planeY } = await imp('src/home/roofgeom.js');
const { CollisionWorld } = await imp('src/core/Collision.js');
const { takdetaljerHus, takdetaljerSpec } = await imp('src/dev/takdetaljer-hus.js');
const house = await imp('src/data/scripts/house.mjs');

const DEG = Math.PI / 180;
const raw = takdetaljerHus();
const built = {};
let ms = 0;
for (const h of raw) {
  const layout = buildLayout(takdetaljerSpec(h.house), undefined, { devWarnings: false });
  const roots = createHouseRoots(layout, [new THREE.Group()]);
  const t0 = Date.now();
  const R = buildRooms({ scene: new THREE.Scene(), quality: {}, roots }, layout, null);
  ms = Math.max(ms, Date.now() - t0);
  const all = new THREE.Group();
  for (const g of Object.values(roots.levels)) all.add(g);
  if (R.group) all.add(R.group);
  all.updateMatrixWorld(true);
  built[h.key] = { ...h, layout, H: layout.house, R, roots, all };
}
const A = built.A, B = built.B, C = built.C, D = built.D;
const part = (k, id) => built[k].H.roofs.find((p) => p.id === id);
const meshes = (k, re) => {
  const out = [];
  built[k].all.traverse((m) => m.isMesh && re.test(m.name) && out.push(m));
  return out;
};
const nameOf = (o) => {
  for (let x = o; x; x = x.parent) if (x.name) return x.name;
  return '';
};
const rc = new THREE.Raycaster();
/** The first visible thing hit from o along d (null: nothing). */
const first = (k, o, d) => {
  rc.set(new THREE.Vector3(...o), new THREE.Vector3(...d).normalize());
  rc.far = 60;
  return rc.intersectObject(built[k].all, true).find((h) => h.object.visible) ?? null;
};
const worldVerts = (m) => {
  const p = m.geometry.attributes.position;
  const v = [];
  for (let i = 0; i < p.count; i++) v.push(new THREE.Vector3().fromBufferAttribute(p, i).applyMatrix4(m.matrixWorld));
  return v;
};

section('Halvvalm');
{
  const a = part('A', 'roof-a');
  const t = Math.tan(40 * DEG);
  check('A: a half-hip of four faces (two slopes, two hips)', a.type === 'half-hip' && a.faces.length === 4 && a.planes.map((p) => p.side).join() === 'v0,v1,u0,u1');
  check('A: hipHeight 1.2, the ridge 1.43 m in from the gables (hipHeight / tan 40°)', near(a.hipHeight, 1.2, 1e-9) && near(a.hipDepth, 1.2 / t, 1e-6), `${a.hipHeight}, ${a.hipDepth.toFixed(3)}`);
  const ridgeInner = a.eaveY + t * 4;
  const hip = a.planes.find((p) => p.side === 'u0');
  check('A: the west hip meets the gable wall\'s outer face 1.2 under the ridge (inner planes)', near(planeY(hip, 0, 4), ridgeInner - 1.2, 1e-6), `${planeY(hip, 0, 4).toFixed(3)} vs ${(ridgeInner - 1.2).toFixed(3)}`);
  // the ridge: the edge the two slopes share runs from x = hipDepth to 10 − hipDepth
  const sl = a.faces.filter((f) => a.planes[f.plane].side === 'v0' || a.planes[f.plane].side === 'v1');
  const ridgeXs = sl[0].poly.filter((q) => near(q[1], 4, 1e-6)).map((q) => q[0]);
  check('A: the ridge runs from x 1.43 to 8.57', near(Math.min(...ridgeXs), 1.2 / t, 1e-4) && near(Math.max(...ridgeXs), 10 - 1.2 / t, 1e-4), ridgeXs.map((x) => x.toFixed(3)).join(', '));
  check('A: the ridge height is the gable roof\'s (7.196, as tak.md\'s gable A with the same knee)', near(a.ridgeY, 7.196, 0.003), a.ridgeY.toFixed(3));
  // inside: the east gable of the open loft room is capped by the hip
  const ew = A.H.wallsById['w-a2o-o'];
  const capY = planeY(a.planes.find((p) => p.side === 'u1'), 9.69, 4) - 2.7;
  check(`A: the east gable inside reaches the hip, flat at ${capY.toFixed(3)} in the middle`, near(ew.height, capY, 0.005) && near(ew.heightAt(3.7), capY, 0.005), `${ew.height.toFixed(3)}, ${ew.heightAt(3.7).toFixed(3)}`);
  // outside: the cladding of the west gable reaches the hip (under its soffit), over it the roof
  const yHip = planeY(hip, -0.02, 4);
  // (from under the hip's overhang: the hip falls outward, its fascia hangs lower than the hip at the wall)
  const clad = first('A', [-0.25, yHip - 0.03, 4], [1, 0, 0]);
  check('A: the west gable is clad up to the hip (a ray just under the hip\'s soffit hits the cladding)', clad && /^room-outside:/.test(nameOf(clad.object)), clad ? nameOf(clad.object) : 'nothing');
  const over = first('A', [-4, yHip + 0.5, 4], [1, 0, 0]);
  check('A: over it the hip (a ray 0.5 higher hits the roof)', over && /^roof/.test(nameOf(over.object)), over ? nameOf(over.object) : 'nothing');
  // the gutters run along the long sides only (none on the small hips)
  const gutters = meshes('A', /^roof-gutter:roof-a$/);
  const along = gutters.map((m) => new THREE.Box3().setFromObject(m)).map((b) => b.max.x - b.min.x > b.max.z - b.min.z);
  check(`A: ${gutters.length} gutters, all along the eaves (none on the hips)`, gutters.length >= 2 && along.every(Boolean));
  check('A: ridge caps along the ridge and the hips', meshes('A', /^roof-ridge:roof-a$/).length === 1);
  const d = part('D', 'roof-d');
  check('D: hipDepth 0.7 with the hips at 50° gives hipHeight 0.834', near(d.hipDepth, 0.7, 1e-9) && near(d.hipHeight, 0.7 * Math.tan(50 * DEG), 1e-9) && d.pitchEnds === 50, `${d.hipHeight.toFixed(3)}`);
  // D's gable zone (panels) ends at the hip: a ray at the gable just under the hip hits the cladding
  const dh = d.planes.find((p) => p.side === 'u0');
  const dz = first('D', [43.75, planeY(dh, 43.98, 3) - 0.03, 3], [1, 0, 0]);
  check('D: the gable zone reaches the hip too', dz && /^room-outside:/.test(nameOf(dz.object)), dz ? nameOf(dz.object) : 'nothing');
}

section('Pulttaksark med front i ytterveggen (hus1)');
{
  const a = part('A', 'roof-a');
  const ark = a.dormers[0];
  check('A: the shed dormer stands on the wall (an ark: its front is the wall under it)', ark.type === 'shed' && ark.ark && ark.setback < 0.01 && !ark.frontWall);
  const pl = ark.planes[0];
  check('A: its roof falls to the front at 15° (low at the wall, high toward the ridge)', planeY(pl, 5.8, 0) < planeY(pl, 5.8, 2) && near(planeY(pl, 5.8, 1) - planeY(pl, 5.8, 0), Math.tan(15 * DEG), 1e-6) && near(planeY(pl, 5.8, 0), 2.7 + 2.4, 1e-6));
  // the valley: where the dormer meets the main slope (3.448 + tan40·z = 5.1 + tan15·z)
  const zv = (5.1 - a.eaveY) / (Math.tan(40 * DEG) - Math.tan(15 * DEG));
  const R = ark.R.map((q) => q[1]);
  check(`A: it runs back into the main roof, the valley at z ${zv.toFixed(2)}`, near(Math.max(...R), zv, 0.01), Math.max(...R).toFixed(3));
  const wall = A.H.wallsById['w-a2o-s'];
  const prof = wall.topProfile;
  check('A: the wall under it steps up at its sides to its roof (2.48 at the room face), a knee wall beside it', near(wall.heightAt(1.0), 2.4 + 0.3 * Math.tan(15 * DEG), 0.01) && wall.heightAt(0.2) < 1.1 && wall.heightAt(5.5) < 1.1, JSON.stringify(prof.map((p) => p.map((x) => +x.toFixed(2)))));
  const opns = wall.openings.map((o) => `${o.type}:${o.top.toFixed(2)}`);
  check('A: the balcony door and the two windows stand in the wall under it', wall.openings.length === 3 && wall.openings.every((o) => o.top < wall.heightAt((o.u0 + o.u1) / 2)), opns.join(', '));
  const yFront = planeY(pl, 5.0, -0.02);
  const fr = first('A', [5.0, yFront - 0.04, -0.3], [0, 0, 1]);
  check('A: the front is clad up to the dormer\'s roof (a ray from the south just under its soffit hits the cladding)', fr && /^room-outside:/.test(nameOf(fr.object)), fr ? nameOf(fr.object) : 'nothing');
  // (over the main roof's covering, 4.34, under the dormer's side fascia, 5.27)
  const cheek = first('A', [2, 4.8, 0.6], [1, 0, 0]);
  check('A: the dormer\'s side is clad (a ray from the west over the main roof hits the cheek)', cheek && /^roof-cheeks:/.test(nameOf(cheek.object)), cheek ? nameOf(cheek.object) : 'nothing');
  // the main roof's eave is cut between the dormer's sides: down at z −0.45 (under the main eave, past the dormer's
  // 0.35 overhang) there is no roof, at x 3 there is
  const cut = first('A', [5.8, 20, -0.45], [0, -1, 0]);
  const eave = first('A', [3.0, 20, -0.45], [0, -1, 0]);
  check('A: the eave is cut in front of the dormer (the balcony under the sky), not beside it', cut && !/^roof/.test(nameOf(cut.object)) && eave && /^roof/.test(nameOf(eave.object)), `${cut ? nameOf(cut.object) : 'nothing'} / ${eave ? nameOf(eave.object) : 'nothing'}`);
  const bal = A.H.decks.find((x) => x.id === 'a-balkong');
  check('A: the balcony in front of it at the loft floor', bal && bal.kind === 'balcony' && near(bal.top, 2.68, 1e-6));
}

section('Piper');
{
  const ca = A.H.chimneys.find((c) => c.id === 'pipe-a');
  check('A: the brick chimney stands on the living room floor and goes up through both levels', ca.material === 'brick' && ca.bottomY === 0 && ca.pieces.map((p) => `${p.levelId}:${p.y0}-${p.y1}`).join() === 'hoved:0-2.7,loft:2.7-null', JSON.stringify(ca.pieces));
  check(`A: without top it ends 0.8 over the roof round it (${ca.coverMax.toFixed(2)} + 0.8 → ${ca.topY})`, near(ca.topY, Math.ceil((ca.coverMax + 0.8) * 20 - 1e-6) / 20, 1e-9) && ca.topY > part('A', 'roof-a').ridgeY);
  const inside = meshes('A', /^chimney-inside:pipe-a:/);
  check('A: a box inside on each level (in that level\'s root)', inside.map((m) => m.name).sort().join() === 'chimney-inside:pipe-a:hoved,chimney-inside:pipe-a:loft' && inside.every((m) => m.parent === A.roots.levels[m.name.split(':')[2]]), inside.map((m) => `${m.name} in ${m.parent?.name}`).join(', '));
  const pick = new Set(A.R.pickables.ceilings);
  const outs = meshes('A', /^chimney(-cap|-flue|-flashing)?:pipe-a$/);
  check(`A: the part over the roof (${outs.length} meshes) is hidden with the roofs; the boxes inside are not`, outs.length === 4 && outs.every((m) => pick.has(m) && m.userData.noCollide) && meshes('A', /^chimney-inside:/).every((m) => !pick.has(m)));
  const boxes = A.R.colliders.filter((c) => c.isBox3 && near(c.max.x - c.min.x, 0.5, 1e-6) && near(c.max.z - c.min.z, 0.5, 1e-6));
  check('A: a collider per level, the chimney\'s footprint, from its floor up', boxes.length === 2 && boxes.some((b) => near(b.min.y, 0, 1e-6) && near(b.max.y, 2.7, 1e-6)) && boxes.some((b) => near(b.min.y, 2.7, 1e-6) && b.max.y > 6));
  // the player's capsule against the chimney (the game's CollisionWorld with the rooms' colliders)
  const world = new CollisionWorld();
  for (const c of A.R.colliders) (c.isBox3 ? world.addStaticBox(c) : world.addStatic(c));
  world.build();
  const r = 0.3;
  const push = (x, y, z) => {
    const cap = new Capsule(new THREE.Vector3(x, y + r + 0.05, z), new THREE.Vector3(x, y + 1.8 - r, z), r);
    for (let i = 0; i < 8; i++) world.resolveCapsule(cap);
    return cap.start;
  };
  const p1 = push(2.2 + 0.25 + 0.2, 0, 4.7);
  const p2 = push(2.2, 2.7, 4.7 - 0.25 - 0.2);
  check(`A: the player is pushed out of the chimney, in the living room (x ${p1.x.toFixed(3)}) and on the loft (z ${p2.z.toFixed(3)})`, p1.x > 2.2 + 0.25 + r - 0.01 && p2.z < 4.7 - 0.25 - r + 0.01);
  const top = first('A', [2.2, 20, 4.7], [0, -1, 0]);
  check('A: from above the crown and the flue liner', top && /^chimney-(cap|flue):pipe-a$/.test(top.object.name) && near(top.point.y, ca.topY + 0.1, 0.01), top ? `${top.object.name} ${top.point.y.toFixed(3)}` : 'nothing');
  const side = first('A', [2.2, ca.topY - 0.3, 9], [0, 0, -1]);
  check('A: over the roof its brick sides', side && side.object.name === 'chimney:pipe-a' && near(side.point.z, 4.95, 1e-3), side ? side.object.name : 'nothing');
  // the flashing lies on the covering round it (a band and an apron, 0–15 cm over the covering)
  const field = A.H.roofFieldOf('loft');
  const fl = meshes('A', /^chimney-flashing:pipe-a$/)[0];
  const off = worldVerts(fl).map((v) => {
    const p = field.planeAt(v.x, v.z);
    return v.y - (planeY(p, v.x, v.z) + p.tv);
  });
  check(`A: the flashing follows the covering (${Math.min(...off).toFixed(3)} … ${Math.max(...off).toFixed(3)} over it)`, Math.min(...off) > -0.025 && Math.max(...off) < 0.16);
  // C: rendered, from the roof, on the ridge
  const cc = C.H.chimneys[0];
  check('C: the rendered chimney starts in the roof (nothing inside, no collider)', cc.from === 'roof' && !cc.pieces.length && !meshes('C', /^chimney-inside:/).length && !C.R.colliders.some((c) => c.isBox3) && near(cc.bottomY, cc.innerMin, 1e-9));
  const fc = meshes('C', /^chimney-flashing:pipe-c$/)[0];
  const fieldC = C.H.roofFieldOf('hoved');
  const sides = new Set();
  const offC = worldVerts(fc).map((v) => {
    const p = fieldC.planeAt(v.x, v.z);
    sides.add(p.side);
    return v.y - (planeY(p, v.x, v.z) + p.tv);
  });
  check('C: on the ridge its flashing follows both slopes', sides.size === 2 && Math.min(...offC) > -0.025 && Math.max(...offC) < 0.16, [...sides].join(', '));
  const caps = meshes('C', /^roof-ridge:roof-c$/)[0];
  const inFoot = worldVerts(caps).filter((v) => v.x > 34.3 + 0.03 && v.x < 34.9 - 0.03 && v.z > 3.775 && v.z < 4.225);
  check('C: the ridge cap stops at the chimney', inFoot.length === 0 && first('C', [35.2, 20, 4.0], [0, -1, 0])?.object.name === 'roof-ridge:roof-c', `${inFoot.length} vertices inside`);
  // B: a round steel chimney
  const cb = B.H.chimneys[0];
  check('B: the steel chimney is round (0.2), from the floor, its top 0.8 over the roof', cb.round && near(cb.size[0], 0.2, 1e-9) && cb.pieces.length === 1 && near(cb.topY, Math.ceil((cb.coverMax + 0.8) * 20 - 1e-6) / 20, 1e-9));
  const hat = first('B', [19.4, 20, 4.3], [0, -1, 0]);
  check('B: a rain cap on it', hat && hat.object.name === 'chimney-cap:pipe-b' && hat.point.y > cb.topY, hat ? `${hat.object.name} ${hat.point.y.toFixed(3)}` : 'nothing');
  const pipe = first('B', [19.4, 1.2, 0.5], [0, 0, 1]);
  check('B: in the room a steel pipe (r 0.1)', pipe && pipe.object.name === 'chimney-inside:pipe-b:hoved' && near(pipe.point.z, 4.2, 0.01), pipe ? `${pipe.object.name} ${pipe.point.z.toFixed(3)}` : 'nothing');
}

section('Vinduer med skrå overkant');
{
  const o = (k, id) => built[k].H.walls.flatMap((w) => w.openings).find((x) => x.id === id);
  const t40 = Math.tan(40 * DEG), t15 = Math.tan(15 * DEG), t35 = Math.tan(35 * DEG);
  const west = A.H.wallsById['w-a2v-v'];
  const sl = west.openings.filter((x) => x.topSlope);
  check('A: the two loft windows under the slopes follow the roof (±40°), the one between them is level', sl.length === 2 && near(sl[0].topSlope, t40, 1e-3) && near(sl[1].topSlope, -t40, 1e-3) && west.openings.filter((x) => !x.topSlope).length === 1, sl.map((x) => x.topSlope.toFixed(3)).join(', '));
  const w1 = sl[0];
  check('A: the high end at sill + height (2.0), the low end 0.8 · tan 40 lower', near(w1.topU1, 2.0, 1e-9) && near(w1.topU0, 2.0 - 0.8 * t40, 1e-3) && w1.top === 2.0);
  check('A: parallel to the wall\'s top over it (the same rise per metre)', near((west.heightAt(w1.u1) - west.heightAt(w1.u0)) / w1.width, w1.topSlope, 1e-5));
  check('B: topSlope 15 rises 15° to the right seen from the room; the top light over the door follows the roof', near(o('B', 'win-td-24').topSlope, t15, 1e-9) && near(o('B', 'win-td-23').topSlope, t15, 1e-3) && near(o('B', 'win-td-21').topSlope, -t15, 1e-3));
  check('C: the gable windows mirror each other (±35°)', near(o('C', 'win-td-28').topSlope, t35, 1e-3) && near(o('C', 'win-td-29').topSlope, -t35, 1e-3));
  // the hole in the wall follows the slope: from inside, just over the sloped top the wall, just under it the window
  const u = (w1.u0 + w1.u1) / 2;
  const yTop = 2.7 + w1.topU0 + (w1.topU1 - w1.topU0) / 2;
  const z = west.start.y + west.dir.y * u;
  const above = first('A', [1.5, yTop + 0.04, z], [-1, 0, 0]);
  const below = first('A', [1.5, yTop - 0.15, z], [-1, 0, 0]);
  check('A: the hole in the wall follows the slope (inside: the wall 4 cm over the top line, the window 15 cm under it)', above && /^wall:w-a2v-v$/.test(above.object.name) && below && /^(window|glass):win-td-10$/.test(nameOf(below.object)), `${above ? nameOf(above.object) : '-'} / ${below ? nameOf(below.object) : '-'}`);
  const outAbove = first('A', [-3, yTop + 0.04, z], [1, 0, 0]);
  check('A: so does the hole in the cladding (outside: a board or the cladding over the top line, not the window)', outAbove && /^room-outside:/.test(nameOf(outAbove.object)), outAbove ? nameOf(outAbove.object) : '-');
  // the glass is a trapezoid: its top 0.8 · tan 40 lower at the low end (u0, north) than at the high end
  const g = meshes('A', /^glass:win-td-10$/)[0];
  const vs = worldVerts(g);
  const zs = vs.map((v) => v.z);
  const hiAt = (zz) => Math.max(...vs.filter((v) => Math.abs(v.z - zz) < 0.01).map((v) => v.y));
  const drop = hiAt(Math.max(...zs)) - hiAt(Math.min(...zs));
  check(`A: the glass is a trapezoid (its top ${drop.toFixed(3)} lower at the north end)`, near(drop, -(Math.max(...zs) - Math.min(...zs)) * t40, 0.01) || near(-drop, (Math.max(...zs) - Math.min(...zs)) * t40, 0.01), drop.toFixed(3));
  // hus5's window: the lower fields (under the transom at 0.7) are rectangles, the upper ones follow the slope
  const big = meshes('B', /^glass:win-td-21$/)[0];
  const bv = worldVerts(big);
  check('B: four fields, the upper two under the slope, the lower two level', bv.length > 12 && bv.some((v) => v.y > 0.4 + 0.7 * 3 + 0.3));
}

section('Ingen hull');
{
  const bad = [];
  let n = 0;
  for (const k of Object.keys(built)) {
    const H = built[k].H;
    for (const r of H.rooms) {
      if (r.hud || r.area < 1 || r.id === 'stue-kjokken') continue;
      const b = r.bounds;
      for (let x = b.minX + 0.3; x < b.maxX - 0.25; x += 0.5) for (let z = b.minZ + 0.3; z < b.maxZ - 0.25; z += 0.5) {
        if (!r.contains(x, z)) continue;
        if (H.chimneys.some((c) => Math.abs(x - c.at[0]) < c.size[0] / 2 + 0.02 && Math.abs(z - c.at[1]) < c.size[1] / 2 + 0.02)) continue;
        n++;
        const h = first(k, [x, r.floorY + 0.5, z], [0, 1, 0]);
        if (!h || !/^(ceiling:|chimney-inside)/.test(nameOf(h.object))) bad.push(`${k} ${r.id} (${x.toFixed(2)}, ${z.toFixed(2)}): ${h ? nameOf(h.object) : 'sky'}`);
      }
    }
  }
  check(`${n} rays up from inside the rooms hit a ceiling`, !bad.length, bad.slice(0, 8).join('\n         '));
  const bad2 = [];
  let n2 = 0;
  for (const k of Object.keys(built)) {
    for (const p of built[k].H.roofs) {
      const xs = p.outline.map((q) => q[0]), zs = p.outline.map((q) => q[1]);
      for (let x = Math.min(...xs) + 0.2; x < Math.max(...xs); x += 0.5) for (let z = Math.min(...zs) + 0.2; z < Math.max(...zs); z += 0.5) {
        n2++;
        const h = first(k, [x, 25, z], [0, -1, 0]);
        if (!h || !/^(roof|chimney)/.test(nameOf(h.object))) bad2.push(`${k} ${p.id} (${x.toFixed(2)}, ${z.toFixed(2)}): ${h ? nameOf(h.object) : 'nothing'}`);
      }
    }
  }
  check(`${n2} rays down onto the roofs hit the roof or a chimney`, !bad2.length, bad2.slice(0, 8).join('\n         '));
}

section('Ingen flater i samme plan');
for (const k of Object.keys(built)) {
  // cover: rooms.js's dark deck; leaf: and the dark leaf / the oak threshold in room-walls: the doors' own parts (doors.js)
  const r = await coplanarOverlaps(built[k].all, { skip: (m) => /^(cover:|leaf:)|^room-walls:.*(#1d1e21|oak #cdbfae)/.test(m.name), minArea: 2e-6 });
  check(`${k}: no overlapping faces in one plane among ${r.triangles} triangles`, !r.bad.length, r.bad.slice(0, 10).join('\n         '));
}
check(`built in ${ms} ms (< 3 s)`, ms < 3000);

section('Validatoren');
{
  const full = house.loadRegistry();
  const reg = { schema: full.schema, pseudoRooms: full.pseudoRooms };
  const v = (spec) => house.validateHouse(spec, { registry: reg, throw: false });
  const errs = (r) => r.errors.filter((m) => !/rommet «stue-kjokken» mangler/.test(m));
  const res = raw.map((h) => ({ key: h.key, r: v(takdetaljerSpec(h.house)) }));
  check('the four test houses validate (schema.topLevel has chimneys; no errors, no warnings)', res.every(({ r }) => !errs(r).length && !r.warnings.length), res.flatMap(({ key, r }) => [...errs(r), ...r.warnings].map((m) => `${key}: ${m}`)).slice(0, 8).join('\n         '));
  const withK = (k) => (f) => {
    const spec = takdetaljerSpec(JSON.parse(JSON.stringify(raw[k].house)));
    f(spec);
    return v(spec);
  };
  const withA = withK(0), withB = withK(1), withC = withK(2);
  const has = (r, re, kind = 'errors') => (kind === 'errors' ? errs(r) : r.warnings).some((m) => re.test(m));
  check('half-hip: a hip reaching down to the eave is an error (that is a hip roof)', has(withA((h) => (h.roofs[0].hipHeight = 3.3)), /roofs\/roof-a: hipHeight må være/));
  check('half-hip: both hipHeight and hipDepth is a warning', has(withA((h) => (h.roofs[0].hipDepth = 1.0)), /roofs\/roof-a: både hipHeight og hipDepth/, 'warnings'));
  check('half-hip: hips that meet over a short house are an error', has(withA((h) => Object.assign(h.roofs[0], { hipHeight: undefined, hipDepth: 4.9 })), /roofs\/roof-a: (valmene|hipHeight)/));
  check('chimney: a top under the roof is an error', has(withA((h) => (h.chimneys[0].top = 6.0)), /chimneys\/pipe-a: toppen .* når ikke 0,3 m over taket/));
  check('chimney: an unknown material is an error', has(withA((h) => (h.chimneys[0].material = 'stone')), /chimneys\/pipe-a: material «stone»/));
  check('chimney: from the roof without a roof over it is an error', has(withA((h) => Object.assign(h.chimneys[0], { at: [-3, 4], from: 'roof' })), /chimneys\/pipe-a: from: 'roof', men intet tak/));
  check('chimney: one standing in a wall is a warning', has(withA((h) => (h.chimneys[0].at = [3.5, 4.0])), /chimneys\/pipe-a: pipa står i veggen w-a2v-o/, 'warnings'));
  check('chimney: chimneys is a top-level key of the schema', !has(withA(() => {}), /ukjent toppnøkkel «chimneys»/));
  check('sloped top: one going over the wall is an error', has(withA((h) => (h.walls.find((w) => w.id === 'w-a2v-v').openings[0].sill = 1.0)), /win-td-10 \(w-a2v-v\): den skrå toppen .* er over veggen/));
  check('sloped top: a low end under the sill is an error', has(withB((h) => (h.walls.find((w) => w.id === 'w-b1-o').openings[2].topSlope = 70)), /win-td-24 .*: den lave enden av den skrå overkanten/));
  check('sloped top: a transom over the sloped top is an error', has(withB((h) => {
    const big = h.walls.find((w) => w.id === 'w-b1-v').openings[0];
    big.sashes = [{ to: 0.5, top: 0.9 }, { from: 0.5, top: 0.9 }, { to: 0.5, bottom: 0.9 }, { from: 0.5, bottom: 0.9 }];
  }), /win-td-21 .*: feltet 0,50–1,00 slutter i 2,70 m, over den skrå overkanten \(2,46 m\)/));
  check('sloped top: a bad value is an error, on a door a warning', has(withC((h) => (h.walls.find((w) => w.id === 'w-c1-v').openings[0].topSlope = 'roof')), /topSlope må være grader/) && has(withB((h) => (h.walls.find((w) => w.id === 'w-b1-o').openings[0].topSlope = 10)), /door-td-22 .*: topSlope brukes bare på vinduer/, 'warnings'));
  check('a top light over a door is not an overlap (one over the other)', !has(withB(() => {}), /overlapper/) && has(withB((h) => (h.walls.find((w) => w.id === 'w-b1-o').openings[1].sill = 1.9)), /win-td-23 overlapper door-td-22/));
}

section('Eierens hus');
{
  const OH = ownerLayout.house;
  check('the owner\'s house has no chimneys, no half-hip and no sloped window tops', OH.chimneys.length === 0 && !OH.roofs.length && OH.walls.every((w) => w.openings.every((o) => o.topSlope === 0)));
}

done();
