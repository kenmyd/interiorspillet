#!/usr/bin/env node
/**
 * Node test for the new roof types (notes/tak.md «Flere taktyper»):
 *   node tools/house-tests/taktyper.test.mjs        (from the project root; exit code 1 on failure)
 *
 * Builds the test houses of dev/taktyper.html (src/dev/taktyper-hus.js) with buildLayout + buildRooms and checks:
 *   • roofs that meet: a wing on the level under the main roof running into it (the kile, the valleys), an entry roof
 *     under the main eave, a wing running into the main roof and a higher one through it (a cross gable with its gable
 *     on the far facade), the field of a level without the roof of the level above, the valley flashings;
 *   • a gable with two pitches and two eave heights, a mansard (gable and hipped) with a kvist, a flat roof and a
 *     mono-pitch behind a parapet, a recessed roof terrace, a hipped ark, a takopplett with three windows, a V roof;
 *   • each with its eaves, verges and a ceiling that follows it inside (the walls under it up to it);
 *   • no holes (rays up from every room hit a ceiling, rays down onto every roof the roof, the terrace's deck), no two
 *     faces facing the same way overlapping in one plane;
 *   • the validator: the ten houses without errors and warnings, the new fields' errors;
 *   • the owner's house unchanged (its fingerprint as before the roof work, notes/tak.md).
 */
import { imp, check, section, near, done, coplanarOverlaps } from './_lib.mjs';

const THREE = await import('three');
(await imp('src/home/materials.js')).configureMaterials({ textureRes: 0.125 });
const { buildLayout, layout: ownerLayout } = await imp('src/home/layout.js');
const { buildRooms } = await imp('src/home/rooms.js');
const { createHouseRoots } = await imp('src/home/index.js');
const { planeY } = await imp('src/home/roofgeom.js');
const { taktyperHus, taktyperSpec } = await imp('src/dev/taktyper-hus.js');
const { ownerFingerprint } = await imp('tools/house-tests/owner-fingerprint.mjs');
const house = await imp('src/data/scripts/house.mjs');

const DEG = Math.PI / 180;
const tan = (d) => Math.tan(d * DEG);
const raw = taktyperHus();
const built = {};
let ms = 0;
for (const h of raw) {
  const layout = buildLayout(taktyperSpec(h.house), undefined, { devWarnings: false });
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
const { A, B, C, D, E, F, G, H: HH, I, J } = built;
const part = (k, id) => built[k].H.roofs.find((p) => p.id === id);
const ceil = (k, id) => built[k].H.ceilings.find((c) => c.id === id);
const wall = (k, id) => built[k].H.wallsById[id];
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
/** The visible things hit from o along d, nearest first. */
const hits = (k, o, d) => {
  rc.set(new THREE.Vector3(...o), new THREE.Vector3(...d).normalize());
  rc.far = 60;
  return rc.intersectObject(built[k].all, true).filter((h) => h.object.visible);
};
const first = (k, o, d) => hits(k, o, d)[0] ?? null;
const hitName = (h) => (h ? nameOf(h.object) : 'nothing');
const worldVerts = (m) => {
  const p = m.geometry.attributes.position;
  const v = [];
  for (let i = 0; i < p.count; i++) v.push(new THREE.Vector3().fromBufferAttribute(p, i).applyMatrix4(m.matrixWorld));
  return v;
};
/** the surface of a roof part (its own planes) at x, z */

section('Tak som møtes: A – fløyer på etasjen under hovedtaket');
{
  const m = part('A', 'roof-a'), w = part('A', 'roof-a-floy'), vf = part('A', 'roof-a-vf');
  check('A: the wing (over hoved) runs into the main roof (over the loft) up to its ridge, z 4', near(Math.min(...w.over.map((q) => q[1])), 4, 1e-6) && near(Math.min(...w.core.map((q) => q[1])), 4, 1e-6), JSON.stringify(w.box));
  check('A: so does the entry\'s mono-pitch (its high side against the house)', near(Math.max(...vf.over.map((q) => q[1])), 4, 1e-6));
  check('A: the main roof keeps its eave over both (no run-in on a side it falls toward)', near(Math.max(...m.over.map((q) => q[1])), 8.5, 1e-6) && near(Math.min(...m.over.map((q) => q[1])), -0.5, 1e-6));
  const hoved = A.H.roofFieldOf('hoved');
  check('A: the field of the level under the loft has no roof inside the main house (the loft\'s floor covers it)', hoved.planeAt(5, 4) === null && hoved.planeAt(7.75, 7.8) === null && hoved.planeAt(7.75, 10) !== null && hoved.planeAt(5, -1) !== null);
  // the kile: the wing's ridge (3.70 inner) above the main eave (3.448) just inside the main house
  const cover = (o) => hits('A', o, [0, -1, 0]).map(hitName).find((n) => /^roof:/.test(n)) ?? 'nothing';
  const kile = cover([7.56, 25, 7.85]), beyond = cover([7.75, 25, 7.2]);
  check('A: the kile – just inside the main eave the wing\'s roof on top, further in the main roof', kile === 'roof:roof-a-floy' && beyond === 'roof:roof-a', `${kile} / ${beyond}`);
  // under the main roof's eave near the wing's eave the wing goes on (the main overhang over it)
  const under = hits('A', [5.8, 25, 8.25], [0, -1, 0]).map(hitName).filter((n) => /^roof:/.test(n));
  check('A: under the main eave the wing\'s roof goes on to the wall (both roofs, the main one on top)', under[0] === 'roof:roof-a' && under.includes('roof:roof-a-floy'), under.join(', '));
  const vfUnder = hits('A', [5, 25, -0.25], [0, -1, 0]).map(hitName).filter((n) => /^roof:/.test(n));
  check('A: the entry\'s roof goes on under the main eave to the wall', vfUnder[0] === 'roof:roof-a' && vfUnder[1] === 'roof:roof-a-vf', vfUnder.join(', '));
  const valleys = meshes('A', /^roof-valley:/);
  const vv = valleys.flatMap(worldVerts);
  check(`A: valley flashings where the wing meets the main roof (${vv.length} vertices, round x 7.75, z 7.7–8.5)`, valleys.length === 1 && vv.length > 0 && vv.every((v) => v.x > 6.2 && v.x < 9.3 && v.z > 7.4 && v.z < 8.8));
  // the wall between the main house and the wing stops under the loft floor
  check('A: the main house\'s wall to the wing stops under the loft floor (2.4)', wall('A', 'w-a1-n').height <= 2.4 + 1e-6, wall('A', 'w-a1-n').height.toFixed(3));
}

section('Tak som møtes: B – U-hus, smal fløy inn, bred fløy gjennom (kryssark)');
{
  const m = part('B', 'roof-b'), v = part('B', 'roof-b-v'), o = part('B', 'roof-b-o');
  check('B: the narrow wing runs into the main roof up to its ridge (z 3.5)', near(Math.min(...v.over.map((q) => q[1])), 3.5, 1e-6));
  check(`B: the wide, steep wing (ridge ${o.ridgeY.toFixed(2)} over the main ridge ${m.ridgeY.toFixed(2)}) runs through to the south facade and its verge beyond (z −0.3)`, o.ridgeY > m.ridgeY + 0.05 && near(Math.min(...o.over.map((q) => q[1])), -0.3, 1e-6) && near(Math.min(...o.core.map((q) => q[1])), 0, 1e-6));
  const ridgeIn = 2.4 + 2.5 * tan(42);
  check(`B: the room under the cross gable has its ceiling up to the wing's ridge (${ridgeIn.toFixed(3)})`, near(ceil('B', 'c-b-ost').heightAt(27.5, 1.0), ridgeIn, 0.002), ceil('B', 'c-b-ost').heightAt(27.5, 1.0).toFixed(3));
  const sw = wall('B', 'w-b2-s');
  check('B: its south wall rises into the cross gable (its top at the ridge position)', near(sw.heightAt(27.5 - sw.start.x), ridgeIn, 0.01), sw.heightAt(27.5 - sw.start.x).toFixed(3));
  const clad = first('B', [27.5, 4.3, -3], [0, 0, 1]);
  check('B: the gable on the south facade is clad (a ray at 4.3 m hits the cladding, not the roof)', /^room-outside:/.test(hitName(clad)) && near(clad.point.z, 0, 0.05), `${hitName(clad)} ${clad?.point.z.toFixed(3)}`);
  const main = first('B', [22, 4.3, -3], [0, 0, 1]);
  check('B: beside it, over the main eave, the main roof', /^roof/.test(hitName(main)), hitName(main));
  check('B: valley flashings where the wings meet the main roof', meshes('B', /^roof-valley:/).length >= 1);
}

section('Saltak med ulike takfall og takfot (C)');
{
  const c = part('C', 'roof-c');
  const split = (3.6 - 2.4 + 9 * tan(45)) / (tan(25) + tan(45));
  check(`C: the ridge ${split.toFixed(3)} m from the south (the long 25° slope), the 45° slope to the north`, near(c.split, split, 1e-9) && c.pitchBack === 45 && near(c.eaveYBack, 3.6, 1e-9), c.split.toFixed(3));
  const pv0 = c.planes.find((p) => p.side === 'v0'), pv1 = c.planes.find((p) => p.side === 'v1');
  check('C: the front plane 2.4 at the south outline rising 25°, the back 3.6 at the north outline rising 45°', near(planeY(pv0, 39, 0), 2.4, 1e-9) && near(planeY(pv0, 39, 1) - planeY(pv0, 39, 0), tan(25), 1e-9) && near(planeY(pv1, 39, 9), 3.6, 1e-9) && near(planeY(pv1, 39, 8) - planeY(pv1, 39, 9), 1, 1e-9));
  const ridgeIn = 2.4 + split * tan(25);
  check(`C: the open room\'s ceiling reaches the ridge (${ridgeIn.toFixed(3)}), the flat one stays at 2.4`, near(ceil('C', 'c-c-stue').maxHeight, ridgeIn, 0.002) && near(ceil('C', 'c-c-sov').maxHeight, 2.4, 1e-6), ceil('C', 'c-c-stue').maxHeight.toFixed(3));
  check('C: the north wall up to the high eave (3.91 at its room face), the south wall a low one (2.54)', near(wall('C', 'w-c1-n').heightAt(2), 3.6 + 0.31, 0.003) && near(wall('C', 'w-c1-s').heightAt(2), 2.4 + 0.31 * tan(25), 0.003), `${wall('C', 'w-c1-n').heightAt(2).toFixed(3)}, ${wall('C', 'w-c1-s').heightAt(2).toFixed(3)}`);
  check('C: the overhang at the back is overhangBack (0.3), at the front 0.5', near(c.box.v1 - c.frame.Lv, 0.3, 1e-9) && near(-c.box.v0, 0.5, 1e-9));
  check('C: gutters along both eaves, a ridge cap', meshes('C', /^roof-gutter:/).length === 2 && meshes('C', /^roof-ridge:/).length === 1);
  const gz = first('C', [30, 3.5, 7.5], [1, 0, 0]);
  check('C: the gable zone (horizontal boards) above the low eave on the west gable', gz && /shiplap|#c9b79c/.test(hitName(gz) + [].concat(gz.object.material).map((x) => x?.name).join()), hitName(gz));
}

section('Mansardtak (D, E)');
{
  const d = part('D', 'roof-d');
  check('D: a mansard of four faces: lower 65°, upper 25°, the break 1.2 m in', d.type === 'mansard' && d.faces.length === 4 && d.pitchUpper === 25 && d.breakDepth === 1.2 && d.planes.filter((p) => p.tier === 'upper').length === 2);
  const lo = d.planes.find((p) => p.side === 'v0' && p.tier === 'lower'), up = d.planes.find((p) => p.side === 'v0' && p.tier === 'upper');
  const kY = 2.7 + 0.3 + 1.2 * tan(65);
  check(`D: the break at ${kY.toFixed(3)} (both planes meet at z 1.2)`, near(planeY(lo, 53, 1.2), kY, 1e-9) && near(planeY(up, 53, 1.2), kY, 1e-9));
  const c = ceil('D', 'c-d-loft');
  check('D: the loft\'s ceiling follows the steep slope (2.44 at z 1.0) up to the collar beam (2.5)', near(c.heightAt(50, 1.0), 0.3 + tan(65), 0.002) && near(c.heightAt(50, 2.0), 2.5, 1e-6) && near(c.maxHeight, 2.5, 1e-6));
  check('D: the knee wall 0.97 at its room face, the gable up to the collar beam', near(wall('D', 'w-d2-s').heightAt(1.0), 0.3 + 0.31 * tan(65), 0.003) && near(wall('D', 'w-d2-v').height, 2.5, 0.005), `${wall('D', 'w-d2-s').heightAt(1.0).toFixed(3)}, ${wall('D', 'w-d2-v').height.toFixed(3)}`);
  const kv = d.dormers[0];
  check('D: the kvist in the steep slope: a gable dormer on the wall, ending under the break', kv.type === 'gable' && kv.ark && Math.max(...kv.R.map((q) => q[1])) < 1.2);
  const caps = meshes('D', /^roof-ridge:roof-d$/).flatMap(worldVerts).filter((v) => v.y > 6.5);
  const folds = meshes('D', /^roof-valley:roof-d$/).flatMap(worldVerts);
  check('D: a ridge cap on the ridge only; flashings on the breaks (and in the kvist\'s valleys)', caps.length > 0 && caps.every((v) => Math.abs(v.z - 4) < 0.2) && folds.some((v) => Math.abs(v.z - 1.2) < 0.25 && v.x < 51) && folds.some((v) => Math.abs(v.z - 6.8) < 0.25));
  check('D: gutters along both eaves', meshes('D', /^roof-gutter:roof-d$/).length >= 2);
  const e = part('E', 'roof-e');
  const eRidge = 2.4 + 0.8 * tan(60) + 2.7 * tan(22);
  check(`E: a hipped mansard of eight faces, its ridge ${eRidge.toFixed(3)} (1 m long: 8 − 7)`, e.hippedEnds && e.faces.length === 8 && near(ceil('E', 'c-e-stue').maxHeight, eRidge, 0.002));
  const eCaps = meshes('E', /^roof-ridge:/).flatMap(worldVerts);
  check('E: ridge caps on the upper hips and the ridge (all above the break)', eCaps.length > 0 && eCaps.every((v) => v.y > 2.4 + 0.8 * tan(60) + 0.25 - 0.06));
}

section('Flatt tak og pulttak med parapet (F, G)');
{
  const f = part('F', 'roof-f');
  check('F: the parapet 0.45 over the covering (5.85), the roof without overhang', near(f.parapet.topY, 5.4 + 0.45, 1e-9) && f.overhang === 0 && f.vergeOverhang === 0 && !f.gutters);
  const clad = first('F', [78, 5.75, -2], [0, 0, 1]);
  check('F: the render goes up the parapet (a ray at 5.75 hits the facade)', /^room-outside:/.test(hitName(clad)) && near(clad.point.z, 0, 0.05), `${hitName(clad)} ${clad?.point.z.toFixed(3)}`);
  const over = hits('F', [78, 5.9, -2], [0, 0, 1]).map(hitName);
  check('F: over the coping nothing (the roof hides behind the parapet)', !over.length, over.join(', '));
  const cop = first('F', [78, 10, 0.15], [0, -1, 0]);
  check('F: on top the coping (5.862)', hitName(cop) === 'roof-coping:roof-f' && near(cop.point.y, 5.862, 0.002), `${hitName(cop)} ${cop?.point.y.toFixed(3)}`);
  const lin = first('F', [78, 5.6, 3.5], [0, 0, -1]);
  check('F: inside, the parapet\'s lining at the wall\'s room face', hitName(lin) === 'roof-parapet:roof-f' && near(lin.point.z, 0.3, 0.01), `${hitName(lin)} ${lin?.point.z.toFixed(3)}`);
  check('F: no fascia (the cladding is there) and no gutters', !meshes('F', /^roof-(trim|gutter):/).length);
  const g = part('G', 'roof-g');
  check('G: a mono-pitch (4°, falling north) behind a level parapet at 3.6, gutters off', g.type === 'mono-pitch' && near(g.parapet.topY, 3.6, 1e-9) && g.parapet.height > 0.25 && !g.gutters);
  const gl = first('G', [89.5, 3.5, 8], [0, 0, -1]);
  check('G: its cladding up the parapet on the low (north) side too', /^room-outside:/.test(hitName(gl)) && near(gl.point.z, 6, 0.05), hitName(gl));
  check('G: the ceiling follows the roof (2.62 at the low north side, 3.0 at the south)', near(ceil('G', 'c-g-stue').heightAt(89, 5.7), 2.6 + 0.3 * tan(4), 0.002) && near(ceil('G', 'c-g-stue').heightAt(89, 0.3), 2.6 + 5.7 * tan(4), 0.002));
}

section('Innfelt takterrasse (H)');
{
  const h = part('H', 'roof-h');
  const t = h.terraces[0];
  check('H: a terrace 3 m wide, 2.2 m deep in the south slope', t && near(t.width, 3, 1e-9) && t.depth === 2.2);
  const field = HH.H.roofFieldOf('loft');
  check('H: no roof over it (the field is open), roof beside and behind it', field.planeAt(102, 1.0) === null && field.planeAt(99, 1.0) !== null && field.planeAt(102, 2.3) !== null);
  const down = first('H', [102, 25, 1.0], [0, -1, 0]);
  check('H: from above, down into it the deck (not a roof)', /^deck/.test(hitName(down)), hitName(down));
  const eaveCut = first('H', [102, 25, -0.3], [0, -1, 0]);
  const eave = first('H', [99, 25, -0.3], [0, -1, 0]);
  check('H: the eave is cut in front of it, not beside it', !/^roof/.test(hitName(eaveCut)) && /^roof/.test(hitName(eave)), `${hitName(eaveCut)} / ${hitName(eave)}`);
  const back = wall('H', 'w-h2m-s');
  const top = Math.min(2.3, planeY(h.planes.find((p) => p.side === 'v0'), 102, 2.51) - 2.7);
  check(`H: the back wall up to the room's ceiling (${top.toFixed(2)} m: the collar beam under the roof), the door fits`, near(back.heightAt(1.5), top, 0.01) && back.openings.every((o) => o.top < back.heightAt((o.u0 + o.u1) / 2)), back.heightAt(1.5).toFixed(3));
  const side = first('H', [102, 2.7 + 1.0, 1.2], [-1, 0, 0]);
  check('H: the side walls are clad (from the terrace)', /^room-outside:/.test(hitName(side)) && near(side.point.x, 100.5, 0.05), `${hitName(side)} ${side?.point.x.toFixed(3)}`);
  const yEdge = planeY(h.planes.find((p) => p.side === 'v0'), 100.55, 1.2);
  const fascia = first('H', [102, yEdge + 0.15, 1.2], [-1, 0, 0]);
  check('H: the roof\'s cut edge over the side wall has a fascia', hitName(fascia) === 'roof-trim:roof-h' && near(fascia.point.x, 100.55, 0.01), `${hitName(fascia)} ${fascia?.point.x.toFixed(3)}`);
  const gut = meshes('H', /^roof-gutter:roof-h$/).map((m) => new THREE.Box3().setFromObject(m)).filter((b) => b.max.z < 0);
  check('H: the south gutter stops at the terrace (two pieces)', gut.length === 2 && gut.every((b) => b.max.x < 100.6 || b.min.x > 103.4));
}

section('Ark med valm og takopplett med flere vinduer (I)');
{
  const ip = part('I', 'roof-i');
  const ark = ip.dormers.find((x) => x.id === 'ark-i'), opp = ip.dormers.find((x) => x.id === 'opp-i');
  check('I: the hipped ark has three planes (two sides and the front hip at 45°)', ark.type === 'hip' && ark.planes.map((p) => p.side).join() === 's0,s1,f' && ark.pitchFront === 45 && ark.faces.length === 3);
  const sw = wall('I', 'w-i2-s');
  check('I: the wall under it reaches the hip (2.3 at the front, + 0.31 at the room face)', near(sw.heightAt(115.5 - 111.3), 2.3 + 0.31 * tan(45), 0.01) && sw.openings.every((o) => o.top < sw.heightAt((o.u0 + o.u1) / 2)), sw.heightAt(4.2).toFixed(3));
  const front = first('I', [115.5, 2.7 + 2.3 - 0.35, -0.4], [0, 0, 1]);
  check('I: its front is clad up to the hip\'s eave', /^room-outside:/.test(hitName(front)), hitName(front));
  check('I: ridge caps on its ridge and hips', meshes('I', /^roof-ridge:roof-i$/).length === 1);
  check('I: the takopplett has three windows, spread evenly (offsets 1, 3, 5)', opp.frontWall.windows.length === 3 && opp.frontWall.windows.map((w) => w.offset.toFixed(2)).join() === '1.00,3.00,5.00');
  const groups = [];
  I.all.traverse((o) => o.name === 'roof-window:opp-i' && groups.push(o));
  check('I: three windows built in its front wall', groups.length === 3);
  const gl = first('I', [116, 2.7 + opp.frontWall.windows[1].sill + 0.4, 9.5], [0, 0, -1]);
  check('I: from the north, through the middle window\'s glass', /^(glass|window|roof-window)/.test(hitName(gl)) || /glass/.test(hitName(gl)), hitName(gl));
}

section('V-tak (J)');
{
  const j = part('J', 'roof-j');
  const split = (tan(14) * 7) / (tan(10) + tan(14));
  check(`J: a V roof – its two planes falling to the valley ${split.toFixed(3)} m from the south`, j.combine === 'max' && j.faces.length === 2 && near(j.split, split, 1e-9));
  const vY = 3.0 - split * tan(10);
  check(`J: the ceiling follows it, down to ${vY.toFixed(3)} in the valley, up to the high eaves`, near(ceil('J', 'c-j-stue').heightAt(129.5, split), vY, 0.002) && near(ceil('J', 'c-j-stue').heightAt(129.5, 0.3), 3.0 - 0.3 * tan(10), 0.002));
  check('J: no gutters at the high edges, no ridge cap, a flashing in the valley', !meshes('J', /^roof-gutter:/).length && !meshes('J', /^roof-ridge:/).length && meshes('J', /^roof-valley:roof-j$/).flatMap(worldVerts).every((v) => Math.abs(v.z - split) < 0.25));
  check('J: the gable walls are V-shaped (low in the valley)', near(wall('J', 'w-j1-v').heightAt(6.7 - split), vY, 0.005) && wall('J', 'w-j1-v').height > 2.9);
  check('J: the eaves and verges have fascias', meshes('J', /^roof-trim:roof-j$/).length === 1);
}

section('Ingen hull');
{
  const bad = [];
  let n = 0;
  for (const k of Object.keys(built)) {
    const Hk = built[k].H;
    for (const r of Hk.rooms) {
      if (r.hud || r.area < 1 || r.id === 'stue-kjokken') continue;
      const b = r.bounds;
      for (let x = b.minX + 0.3; x < b.maxX - 0.25; x += 0.5) for (let z = b.minZ + 0.3; z < b.maxZ - 0.25; z += 0.5) {
        if (!r.contains(x, z)) continue;
        n++;
        const h = first(k, [x, r.floorY + 0.5, z], [0, 1, 0]);
        if (!h || !/^ceiling:/.test(nameOf(h.object))) bad.push(`${k} ${r.id} (${x.toFixed(2)}, ${z.toFixed(2)}): ${hitName(h)}`);
      }
    }
  }
  check(`${n} rays up from inside the rooms hit a ceiling (nothing of a roof hangs into a room)`, !bad.length, bad.slice(0, 8).join('\n         '));
  const bad2 = [];
  let n2 = 0;
  for (const k of Object.keys(built)) {
    for (const p of built[k].H.roofs) {
      const xs = p.outline.map((q) => q[0]), zs = p.outline.map((q) => q[1]);
      for (let x = Math.min(...xs) + 0.2; x < Math.max(...xs); x += 0.5) for (let z = Math.min(...zs) + 0.2; z < Math.max(...zs); z += 0.5) {
        n2++;
        const h = first(k, [x, 25, z], [0, -1, 0]);
        const inTerrace = p.terraces.some((t) => t.hole && x > t.front[0][0] && x < t.front[1][0] && z < t.depth);
        if (!h || !(/^roof/.test(nameOf(h.object)) || (inTerrace && /deck|room-outside|wall:|window|door|glass/.test(nameOf(h.object))))) bad2.push(`${k} ${p.id} (${x.toFixed(2)}, ${z.toFixed(2)}): ${hitName(h)}`);
      }
    }
  }
  check(`${n2} rays down onto the roofs hit the roof (in the terrace: its deck)`, !bad2.length, bad2.slice(0, 8).join('\n         '));
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
  const res = raw.map((h) => ({ key: h.key, r: v(taktyperSpec(h.house)) }));
  check('the ten test houses validate (no errors, no warnings)', res.every(({ r }) => !errs(r).length && !r.warnings.length), res.flatMap(({ key, r }) => [...errs(r), ...r.warnings].map((m) => `${key}: ${m}`)).slice(0, 8).join('\n         '));
  const withK = (key) => (f) => {
    const spec = taktyperSpec(JSON.parse(JSON.stringify(raw.find((h) => h.key === key).house)));
    f(spec);
    return v(spec);
  };
  const has = (r, re, kind = 'errors') => (kind === 'errors' ? errs(r) : r.warnings).some((m) => re.test(m));
  check('two sides: a ridge outside the house is an error', has(withK('C')((h) => (h.roofs[0].eaveHeightBack = 12)), /roofs\/roof-c: mønet havner/));
  check('two sides: pitchBack on a hip roof is a warning', has(withK('C')((h) => Object.assign(h.roofs[0], { type: 'hip', eaveHeightBack: undefined, overhangBack: undefined })), /roofs\/roof-c: pitchBack brukes bare på saltak og V-tak/, 'warnings'));
  check('mansard: pitchUpper not shallower than pitch is an error', has(withK('D')((h) => (h.roofs[0].pitchUpper = 64)), /roofs\/roof-d: pitchUpper må være/));
  check('mansard: a break past the middle is an error', has(withK('D')((h) => (h.roofs[0].breakDepth = 3.9)), /roofs\/roof-d: knekken havner/));
  check('mansard: a kvist going past the break is an error', has(withK('D')((h) => (h.roofs[0].dormers[0].height = 2.6)), /roofs\/roof-d\/dormers\/kvist-d: arken går forbi knekken/));
  check('parapet: on a gable roof it is an error', has(withK('C')((h) => (h.roofs[0].parapet = { height: 0.3 })), /roofs\/roof-c: parapet \(attika\) brukes bare på flatt tak og pulttak/));
  check('parapet: a top under the covering is an error, an overhang with it a warning', has(withK('G')((h) => (h.roofs[0].parapet.top = 3.0)), /roofs\/roof-g: parapeten må stå/) && has(withK('F')((h) => (h.roofs[0].overhang = 0.4)), /roofs\/roof-f: parapet: overhang/, 'warnings'));
  check('terrace: a front off the eave is an error', has(withK('H')((h) => (h.roofs[0].terraces[0].front = [[100.5, 1.0], [103.5, 1.0]])), /roofs\/roof-h\/terraces\/terrasse-h: front må ligge på takfoten/));
  check('terrace: one too deep (at the ridge) is an error', has(withK('H')((h) => (h.roofs[0].terraces[0].depth = 3.9)), /terrasse-h: bakveggen står .* for nær mønet/));
  check('terrace: on a flat roof it is an error', has(withK('F')((h) => (h.roofs[0].terraces = [{ front: [[75, 0], [77, 0]], depth: 1 }])), /roofs\/roof-f: en innfelt takterrasse trenger et skrått tak/));
  check('hipped ark: pitchFront out of range is an error', has(withK('I')((h) => (h.roofs[0].dormers[0].pitchFront = 5)), /ark-i: pitchFront må være/));
  check('takopplett: overlapping windows and one beyond the front are errors', has(withK('I')((h) => (h.roofs[0].dormers[1].windows = [{ width: 1, height: 0.8, offset: 1 }, { width: 1, height: 0.8, offset: 1.5 }])), /opp-i: vindu 2 overlapper/) && has(withK('I')((h) => (h.roofs[0].dormers[1].windows = [{ width: 1, height: 0.8, offset: 6.5 }])), /opp-i: vindu 1 går utenfor forveggen/));
  check('V roof: dormers on it are an error, a valley under 1.5 m too', has(withK('J')((h) => (h.roofs[0].dormers = [{ front: [[127, 0], [129, 0]] }])), /roofs\/roof-j: arker på et V-tak/) && has(withK('J')((h) => Object.assign(h.roofs[0], { pitch: 30, pitchBack: 30 })), /roofs\/roof-j: dalen i V-taket er bare/));
  check('a gable zone on a V roof or a mansard is fine (they have gables)', !has(withK('J')(() => {}), /gable, men intet saltak/, 'warnings'));
}

section('Eierens hus');
{
  const OH = ownerLayout.house;
  check('the owner\'s house has no roofs', !OH.roofs.length && OH.roofFieldOf('hoved') === null);
  const fp = ownerFingerprint();
  // the values before the roof work (notes/tak.md): the owner's geometry is untouched
  check(`its fingerprint is as before the roof work (layout ${fp.layout}, rooms ${fp.rooms})`, fp.layout === '9fd8f7a355b0f410' && fp.rooms === 'a7cf211c026c6559');
}

done();
