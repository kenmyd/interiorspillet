#!/usr/bin/env node
/**
 * Node test for fireplaces and stoves (notes/peis-og-ovn.md):
 *   node tools/house-tests/peis.test.mjs        (from the project root; exit code 1 on failure)
 *
 * Builds the test houses of dev/peis.html (src/dev/peis-hus.js) with buildLayout + buildRooms and checks:
 *   • the format: the types and their defaults, against a wall / in a corner / in front of a chimney, the fit to the
 *     wall (a stove keeps its gap, a surround stands flush), the hearth plates (glass, stone, steel; rect, round,
 *     quarter), the outlet, the light group of each fire;
 *   • the chimney it names, given once: a steel chimney straight up from the stove's outlet (nothing on the floor
 *     under it – hus4), a masonry chimney inside its surround from the lowest floor (a box in the basement, its piece
 *     in the room starting at the surround's top), a stove's flue pipe into a masonry chimney behind it;
 *   • the 3D: the parts in the level's root, the glass in the window, the hearth on the floor, the flames following
 *     the embers' glow, a collider per fireplace (the player's capsule stops at its front, also at an angle);
 *   • the light: a 'fire' entry per fire in builtInLights; the LightManager makes it a flickering Lambertian spot in
 *     its group (on at night, off by day, the embers' glow with it); no flicker and no fire in the owner's house;
 *   • the validator's errors and warnings, the build time, no overlapping faces in one plane.
 */
import { imp, check, section, near, done, coplanarOverlaps } from './_lib.mjs';

const THREE = await import('three');
const { Capsule } = await import('three/addons/math/Capsule.js');
(await imp('src/home/materials.js')).configureMaterials({ textureRes: 0.125 });
const { buildLayout, layout: ownerLayout } = await imp('src/home/layout.js');
const { buildRooms } = await imp('src/home/rooms.js');
const { createHouseRoots } = await imp('src/home/index.js');
const { CollisionWorld } = await imp('src/core/Collision.js');
const { FIREPLACE_DEFAULTS } = await imp('src/home/fireplacegeom.js');
const { FLAME_FRAMES } = await imp('src/home/fireplace.js');
const { peisHus, peisSpec } = await imp('src/dev/peis-hus.js');
const house = await imp('src/data/scripts/house.mjs');
const { ownerFingerprint } = await imp('tools/house-tests/owner-fingerprint.mjs');

const raw = peisHus();
const built = {};
let ms = 0;
const warnings = [];
const w0 = console.warn;
console.warn = (...a) => warnings.push(a.join(' '));
for (const h of raw) {
  const layout = buildLayout(peisSpec(h.house), undefined, { devWarnings: false });
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
console.warn = w0;
const A = built.A, B = built.B, C = built.C, D = built.D;
const fp = (k, id) => built[k].H.fireplaces.find((f) => f.id === id);
const ch = (k, id) => built[k].H.chimneys.find((c) => c.id === id);
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
/** The first visible thing hit from o along d (null: nothing); skip(name) leaves things out. */
const first = (k, o, d, skip = () => false) => {
  rc.set(new THREE.Vector3(...o), new THREE.Vector3(...d).normalize());
  rc.far = 60;
  return rc.intersectObject(built[k].all, true).find((h) => h.object.visible && !skip(h.object.name)) ?? null;
};
const dist2 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
/** The smallest distance from a footprint to a wall face (along its normal; negative: into the wall). */
const clearance = (H, f, wallId) => {
  const w = H.walls.find((x) => x.id === wallId);
  return Math.min(...f.footprint.map((q) => (q[0] - w.start.x) * w.normal.x + (q[1] - w.start.y) * w.normal.y));
};

section('Formatet');
{
  check('the test houses build without layout warnings', !warnings.length, warnings.slice(0, 4).join('\n         '));
  const a = fp('A', 'ovn-a');
  check('A (hus4): a round wood stove (Ø0.5, 1.05 high) against the bedroom wall, facing into the room', a.type === 'stove' && a.shape === 'round' && a.placement === 'wall' && a.wallIds.join() === 'w-a2o-v' && a.facing.join() === '1,0' && a.size.join() === '0.5,0.5,1.05');
  check('A: it stays where it is drawn (0.35 from the wall, more than its gap of 0.1)', near(clearance(A.H, a, 'w-a2o-v'), 0.35, 1e-6) && a.at.join() === '4.2,5.9', `${clearance(A.H, a, 'w-a2o-v')}`);
  check('A: a glass plate under it, to the wall and 0.3 in front (it stands on it: base 8 mm up)', a.hearth.material === 'glass' && a.hearth.shape === 'rect' && a.hearth.under && near(a.baseY, 2.7 + 0.008, 1e-9)
    && near(Math.min(...a.hearth.polygon.map((p) => p[0])), 3.6, 1e-6) && near(Math.max(...a.hearth.polygon.map((p) => p[0])), 4.2 + 0.25 + 0.3, 1e-6));
  check('A: the outlet on top in the middle (round)', a.outlet.kind === 'top' && near(a.outlet.at[0], 4.2, 1e-9) && near(a.outlet.at[2], 5.9, 1e-9) && near(a.outlet.at[1], 2.708 + 1.05, 1e-9));
  check('A: its light group – «Vedovn i stua», lit in the evening', A.H.lightGroups.some((g) => g.id === 'fire-ovn-a' && g.label === 'Vedovn i stua' && g.roomId === 'a-stue' && g.auto === 'evening'));
  const pb = fp('B', 'peis-b');
  const o = FIREPLACE_DEFAULTS.opening.open;
  check('B: an open fireplace on the north wall (offset 4.2), its surround flush against it and up to the ceiling (2.5)', pb.type === 'open' && pb.placement === 'wall' && pb.facing.join() === '0,-1' && near(pb.at[0], 18.5, 1e-9) && near(pb.at[1] + pb.size[1] / 2, 7.7, 1e-9) && near(pb.size[2], 2.5, 1e-9));
  check('B: the opening, the mantel over it and a stone hearth over the width in front (0.5 deep)', pb.opening.width === o.width && pb.mantel && near(pb.mantel.y, o.sill + o.height + 0.28, 1e-9) && pb.hearth.material === 'stone' && !pb.hearth.under
    && near(Math.min(...pb.hearth.polygon.map((p) => p[1])), 7.7 - 0.65 - 0.5, 1e-6) && near(Math.max(...pb.hearth.polygon.map((p) => p[0])) - Math.min(...pb.hearth.polygon.map((p) => p[0])), Math.max(1.3, o.width + 0.6), 1e-6));
  const pv = fp('B', 'peisovn-b');
  check('B: a fireplace stove in the south-west corner, turned 45° out of it', pv.type === 'fireplace-stove' && pv.placement === 'corner' && [...pv.wallIds].sort().join() === 'w-b1-s,w-b1-v' && near(pv.facing[0], Math.SQRT1_2, 1e-6) && near(pv.facing[1], Math.SQRT1_2, 1e-6));
  check('B: its back at least its gap (0.1) from both walls, a log store under the firebox', clearance(B.H, pv, 'w-b1-s') >= 0.1 - 1e-6 && clearance(B.H, pv, 'w-b1-v') >= 0.1 - 1e-6 && pv.logStore && pv.window.sill > pv.logStore.y1);
  check('B: a quarter glass plate from the corner', pv.hearth.shape === 'quarter' && pv.hearth.material === 'glass' && pv.hearth.polygon.some((p) => dist2(p, pv.cornerAt) < 1e-6) && dist2(pv.cornerAt, [14.3, 0.3]) < 1e-6);
  const pc = fp('C', 'peis-c');
  check('C: an insert in a rendered surround against the west wall, in its middle, up to the ceiling', pc.type === 'insert' && pc.surround.kind === 'masonry' && pc.surround.material === 'render' && pc.placement === 'wall' && near(pc.at[1], 3.5, 1e-9) && near(pc.at[0] - pc.size[1] / 2, 28.3, 1e-9) && near(pc.size[2], 2.4, 1e-9));
  const pd = fp('D', 'peis-d'), od = fp('D', 'ovn-d');
  check('D: an insert in a white panel surround (2.2 high, not to the roof)', pd.surround.kind === 'panel' && pd.surround.color === '#f2f0eb' && near(pd.size[2], 2.2, 1e-9) && pd.facing.join() === '-1,0');
  check('D: a box stove in front of the brick chimney (0.25 from its face), facing away from it', od.inFront && od.facing.join() === '0,-1' && near(od.at[1] + od.size[1] / 2, 6.45 - 0.25 - FIREPLACE_DEFAULTS.flueGap, 1e-9) && near(od.at[0], 44.6, 1e-9));
  check('D: a steel plate under it, back to the chimney', od.hearth.material === 'steel' && near(Math.max(...od.hearth.polygon.map((p) => p[1])), 6.2, 1e-6));
  check('every fire is a light group of its room (six)', raw.every((h) => built[h.key].H.fireplaces.every((f) => built[h.key].H.lightGroups.some((g) => g.id === f.lightGroup && g.roomId === f.roomId))) && Object.values(built).reduce((s, b) => s + b.H.fireplaces.length, 0) === 6);
}

section('Pipa, én gang');
{
  const a = fp('A', 'ovn-a'), ca = ch('A', 'pipe-a');
  check('A: the steel chimney has no at of its own – it stands on the stove\'s outlet', !raw[0].house.chimneys[0].at && ca.at.join() === `${a.outlet.at[0]},${a.outlet.at[2]}` && ca.fireplaceIds.join() === 'ovn-a');
  check('A: it goes from the stove\'s top up through the roof, upstairs only (nothing on the ground floor under it)', near(ca.bottomY, a.outlet.at[1], 1e-9) && ca.pieces.length === 1 && ca.pieces[0].levelId === 'etasje2' && near(ca.pieces[0].y0, a.outlet.at[1], 1e-9) && ca.topY > ca.coverMax + 0.5);
  const pipeDown = first('A', [4.2, 1.2, 1.0], [0, 0, 1]);
  check('A: on the ground floor a ray across under the stove meets no chimney', !pipeDown || !/^chimney/.test(nameOf(pipeDown.object)), pipeDown ? nameOf(pipeDown.object) : 'nothing');
  const up = first('A', [4.2 + 0.6, a.outlet.at[1] + 0.6, 5.9], [-1, 0, 0]);
  check('A: over the stove the steel pipe (r 0.1)', up && up.object.name === 'chimney-inside:pipe-a:etasje2' && near(up.point.x, 4.3, 0.01), up ? `${up.object.name} ${up.point.x.toFixed(3)}` : 'nothing');
  const cb = ch('B', 'pipe-b1'), pb = fp('B', 'peis-b');
  check('B: the brick chimney inside the surround at its back, from the floor; in the room it starts at the surround\'s top', near(cb.at[0], 18.5, 1e-9) && near(cb.at[1], 7.45, 1e-9) && cb.bottomY === 0 && cb.pieces.length === 1 && near(cb.pieces[0].y0, pb.floorY + pb.size[2], 1e-9));
  check('B: the steel chimney of the fireplace stove starts at its outlet', near(ch('B', 'pipe-b2').bottomY, fp('B', 'peisovn-b').outlet.at[1], 1e-9) && ch('B', 'pipe-b2').at.join() === `${fp('B', 'peisovn-b').outlet.at[0]},${fp('B', 'peisovn-b').outlet.at[2]}`);
  const cc = ch('C', 'pipe-c'), pc = fp('C', 'peis-c');
  check('C: the rendered chimney stands on the basement floor and goes through the basement (a box there)', near(cc.bottomY, -2.55, 1e-9) && cc.pieces[0].levelId === 'kjeller' && near(cc.pieces[0].y0, -2.55, 1e-9) && meshes('C', /^chimney-inside:pipe-c:kjeller$/).length === 1);
  check('C: on the ground floor nothing of it shows under the surround\'s top (the surround reaches the ceiling)', cc.pieces.every((p) => p.levelId !== 'hoved' || p.y0 >= pc.floorY + pc.size[2] - 1e-9) && cc.inHouse);
  const side = first('C', [28.55, 1.2, 1.2], [0, 0, 1]);
  check('C: from the side at 1.2 m the surround, not the chimney', side && /^fireplace-surround:peis-c$/.test(side.object.name), side ? side.object.name : 'nothing');
  const d1 = ch('D', 'pipe-d1'), pd = fp('D', 'peis-d');
  check('D: the steel chimney goes up from the top of the panel surround', near(d1.bottomY, pd.floorY + 2.2, 1e-9) && d1.at.join() === pd.at.join());
  const od = fp('D', 'ovn-d'), d2 = ch('D', 'pipe-d2');
  check('D: the stove\'s flue pipe: up 0.35 from its outlet, then level into the chimney\'s face', od.flue.points.length === 3 && near(od.flue.points[1][1] - od.outlet.at[1], 0.35, 1e-9) && near(od.flue.points[2][2], 6.2, 1e-9) && near(od.flue.points[2][1], od.flue.points[1][1], 1e-9) && d2.fireplaceIds.join() === 'ovn-d');
  check('D: the brick chimney is untouched by it (from the floor, one piece)', d2.bottomY === 0 && d2.pieces.length === 1 && d2.pieces[0].y0 === 0);
  const pipe = meshes('D', /^fireplace-flue:ovn-d$/)[0];
  pipe?.geometry.computeBoundingBox();
  check('D: the flue pipe mesh reaches the chimney\'s face', pipe && near(pipe.geometry.boundingBox.max.z, 6.2, 0.01), pipe ? pipe.geometry.boundingBox.max.z.toFixed(3) : 'none');
}

section('3D');
{
  for (const k of Object.keys(built)) {
    for (const f of built[k].H.fireplaces) {
      const root = built[k].roots.levels[f.levelId].children.find((g) => g.name === `fireplace:${f.id}`);
      const parts = root ? root.children.map((m) => m.name.split(':')[0]) : [];
      const want = f.masonry ? ['fireplace-surround', 'fireplace-firebox', 'fireplace-embers', 'fireplace-logs'] : ['fireplace-body', 'fireplace-trim', 'fireplace-firebox', 'fireplace-glass', 'fireplace-embers', 'fireplace-logs'];
      if (f.type === 'insert') want.push('fireplace-glass', 'fireplace-trim');
      if (f.mantel) want.push('fireplace-mantel');
      if (f.logStore) want.push('fireplace-logstore');
      check(`${k}: ${f.id} – its parts in the level's root (${f.levelId})`, root && want.every((n) => parts.includes(n)) && parts.filter((n) => n === 'fireplace-flame').length === 3, parts.join(' '));
    }
  }
  const a = fp('A', 'ovn-a');
  const win = first('A', [5.6, a.baseY + a.window.sill + 0.2, 5.9], [-1, 0, 0]);
  check('A: through the window of the stove the glass first', win && win.object.name === 'fireplace-glass:ovn-a' && near(win.point.x, 4.2 + 0.25 - 0.015, 0.01), win ? `${win.object.name} ${win.point.x.toFixed(3)}` : 'nothing');
  const inside = first('A', [5.6, a.baseY + a.window.sill + 0.2, 5.9], [-1, 0, 0], (n) => /glass|flame/.test(n));
  check('A: behind the glass the fire (logs, embers) or the firebox, not the body', inside && /^fireplace-(logs|embers|firebox):ovn-a$/.test(inside.object.name), inside ? inside.object.name : 'nothing');
  const body = first('A', [5.6, a.baseY + 0.75 + 0.15, 5.9], [-1, 0, 0]);
  check('A: over the window its body', body && body.object.name === 'fireplace-body:ovn-a' && near(body.point.x, 4.45, 0.01), body ? `${body.object.name} ${body.point.x.toFixed(3)}` : 'nothing');
  const plate = first('A', [4.2 + 0.4, 5, 5.9], [0, -1, 0], (n) => /^(ceiling|roof|chimney)/.test(n));
  check('A: in front of it, from above, the glass plate 8 mm over the floor', plate && plate.object.name === 'fireplace-hearth:ovn-a' && near(plate.point.y, 2.708, 1e-4), plate ? `${plate.object.name} ${plate.point.y.toFixed(4)}` : 'nothing');
  const top = first('A', [4.32, a.baseY + 1.05 + 0.3, 5.9], [0, -1, 0], (n) => /^chimney/.test(n));
  check('A: from above beside the pipe its top plate', top && top.object.name === 'fireplace-body:ovn-a' && near(top.point.y, a.baseY + 1.05, 1e-4), top ? `${top.object.name} ${top.point.y.toFixed(4)}` : 'nothing');
  const pb = fp('B', 'peis-b');
  const op = first('B', [18.5, pb.opening.sill + 0.3, 5], [0, 0, 1], (n) => /flame/.test(n));
  check('B: the open fireplace is open: from the room into its firebox (no glass)', op && /^fireplace-(logs|embers|firebox):peis-b$/.test(op.object.name) && !meshes('B', /^fireplace-glass:peis-b$/).length, op ? op.object.name : 'nothing');
  const br = first('B', [18.5, 1.8, 5], [0, 0, 1]);
  check('B: over the opening its brick surround, 0.65 out from the wall', br && br.object.name === 'fireplace-surround:peis-b' && near(br.point.z, 7.7 - 0.65, 1e-4) && /facade-brick|painted/.test(`${br.object.material.userData?.kind} ${br.object.material.name}`), br ? `${br.object.name} ${br.point.z.toFixed(4)}` : 'nothing');
  const pv = fp('B', 'peisovn-b');
  const dv = first('B', [pv.at[0] + pv.facing[0] * 1.5, pv.baseY + pv.window.sill + 0.25, pv.at[1] + pv.facing[1] * 1.5], [-pv.facing[0], 0, -pv.facing[1]]);
  check('B: the fireplace stove\'s door glass, turned with it', dv && dv.object.name === 'fireplace-glass:peisovn-b', dv ? dv.object.name : 'nothing');
  // the flames follow the embers' glow (off: hidden), and run through their frames
  const fire = B.R.builtInLights.find((l) => l.id === 'fire-peis-b');
  const embers = fire.emissiveMeshes[0].material;
  const flames = meshes('B', /^fireplace-flame:peis-b:/);
  const g0 = embers.emissiveIntensity;
  const offs = new Set();
  for (let i = 0; i < 12; i++) {
    B.R.update(0.05, {});
    offs.add(flames[0].material.map.offset.x);
  }
  const on = flames.every((m) => m.visible) && flames[0].material.color.r > 1;
  embers.emissiveIntensity = 0;
  B.R.update(0.05, {});
  const off = flames.every((m) => !m.visible);
  embers.emissiveIntensity = g0;
  B.R.update(0.05, {});
  check(`the flames burn with the embers (${flames.length} sprites, ${offs.size} of ${FLAME_FRAMES} frames in 0.6 s) and go out with them`, on && off && flames.every((m) => m.visible) && offs.size >= 3);
  check('the flames are additive and cast no shadow; the embers carry the fire\'s glow', flames.every((m) => m.material.blending === THREE.AdditiveBlending && !m.material.depthWrite && !m.castShadow) && embers.emissiveMap && embers.userData.baseIntensity > 0);
}

section('Kollisjon');
{
  const r = 0.3;
  for (const k of Object.keys(built)) {
    const world = new CollisionWorld();
    for (const c of built[k].R.colliders) (c.isBox3 ? world.addStaticBox(c) : world.addStatic(c));
    world.build();
    for (const f of built[k].H.fireplaces) {
      // a capsule standing 0.15 into the fireplace's front is pushed back out to it
      const front = f.shape === 'round' ? f.size[0] / 2 : f.size[1] / 2;
      const x = f.at[0] + f.facing[0] * (front + 0.15), z = f.at[1] + f.facing[1] * (front + 0.15);
      const cap = new Capsule(new THREE.Vector3(x, f.floorY + r + 0.05, z), new THREE.Vector3(x, f.floorY + 1.8 - r, z), r);
      for (let i = 0; i < 10; i++) world.resolveCapsule(cap);
      const along = (cap.start.x - f.at[0]) * f.facing[0] + (cap.start.z - f.at[1]) * f.facing[1];
      // a round stove's box collider is its square (the corners lie 0.07 outside the circle)
      check(`${k}: ${f.id} (${f.placement}) – the player is pushed out of it at its front (${(along - front).toFixed(3)} m from it)`, along - front > r - 0.02, `${along.toFixed(3)} vs front ${front}`);
    }
  }
  const pv = fp('B', 'peisovn-b');
  check('B: the turned fireplace stove collides as a turned box (a mesh, not its bounding box)', B.R.colliders.some((c) => c.isMesh && c.name === 'fireplace-collider:peisovn-b' && !c.parent) && !B.R.colliders.some((c) => c.isBox3 && c.containsPoint(new THREE.Vector3(pv.cornerAt[0] + 0.05, 1, pv.cornerAt[1] + 0.05)) && c.max.x - c.min.x < 2));
}

section('Lys og glød');
{
  const all = Object.values(built).flatMap((b) => b.R.builtInLights.filter((l) => l.type === 'fire'));
  check('one fire light per fireplace, in its group, id without «:» (lighting.js groups a fixture by the id before one)', all.length === 6 && all.every((l) => l.id === l.group && /^fire-/.test(l.id) && !l.id.includes(':')));
  const a = fp('A', 'ovn-a');
  const la = all.find((l) => l.id === 'fire-ovn-a');
  check('A: 250 lm at 1900 K, in front of the window, out of the front (a little down), flickering', la.lumens === 250 && la.colorK === 1900 && la.flicker && la.direction.x > 0.9 && la.direction.y < 0 && near(la.position.x, 4.2 + 0.25 + 0.12, 1e-6) && la.position.y > a.baseY + a.window.sill && la.position.y < a.baseY + a.window.sill + a.window.height);
  check('the open fireplace gives 500 lm, the inserts and the fireplace stove 350, the stoves 250', all.map((l) => `${l.fitting}:${l.lumens}`).sort().join() === 'fireplace-stove:350,insert:350,insert:350,open:500,stove:250,stove:250');

  // the LightManager (the game's): the owner's house with a fire in one of its rooms (its own rooms have none)
  const { LightManager } = await imp('src/home/lighting.js');
  const quiet = (fn) => {
    const w = console.warn;
    console.warn = () => {};
    try {
      return fn();
    } finally {
      console.warn = w;
    }
  };
  const living = ownerLayout.builtInLights.map((l) => ({ ...l }));
  const plain = quiet(() => new LightManager({ scene: new THREE.Scene(), home: { layout: ownerLayout, builtInLights: living, house: { builtInLights: [...living] }, doors: [] }, quality: { level: 'medium' } }));
  check('the owner\'s house: no fire, nothing flickers', !(plain._flickers || []).length && !plain._houseLamps.some((c) => /fire/.test(c.id)));
  const room = ownerLayout.house.rooms.filter((r) => r.levelId === 'hoved' && !r.hud && r.id !== 'stue-kjokken' && r.area > 6).sort((x, y) => y.area - x.area)[0];
  const ember = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.02, 0.2), fire0());
  function fire0() {
    const m = new THREE.MeshStandardMaterial({ color: '#1f120c', emissive: '#ff8a3a', emissiveIntensity: 1.2 });
    m.userData = { cached: false, kind: 'emissive', baseIntensity: 1.2 };
    return m;
  }
  const pos = new THREE.Vector3(room.centroid.x, room.floorY + 0.45, room.centroid.y);
  const entry = { id: 'fire-test', group: 'fire-test', type: 'fire', roomId: room.id, levelId: 'hoved', position: pos, direction: new THREE.Vector3(1, -0.26, 0).normalize(), colorK: 1900, lumens: 300, emissiveMeshes: [ember], flicker: true };
  const M = quiet(() => new LightManager({ scene: new THREE.Scene(), home: { layout: ownerLayout, builtInLights: living, house: { builtInLights: [...living, entry] }, doors: [] }, quality: { level: 'medium' } }));
  const c = M._houseLamps.find((x) => x.id === 'builtin:fire-test');
  check(`a fire in «${room.id}» is a Lambertian spot out of its front (85°), no shadow, flickering`, c && c.kind === 'spot' && c.lambert && near(c.angle, (85 * Math.PI) / 180, 1e-9) && c.noShadow && c.flicker && M._flickers.includes(c) && c.direction.x > 0.9);
  const cam = new THREE.PerspectiveCamera();
  cam.position.set(room.centroid.x + 1.2, room.floorY + 1.6, room.centroid.y);
  cam.lookAt(pos);
  cam.updateMatrixWorld(true);
  const run = (mode, frames = 1) => {
    M.setMode(mode);
    M._selectAt = -1e9;
    M.update(0, cam);
    const out = [];
    for (let i = 0; i < frames; i++) {
      M.update(1 / 60, cam);
      out.push(c.slot && c.slot.cand === c ? c.slot.light.intensity : null);
    }
    return out;
  };
  const night = run('night', 40);
  const lit = ember.material.emissiveIntensity;
  const vals = night.filter((v) => v != null);
  const base = c.phys * M._S * (c.fade ?? 1);
  const mean = vals.reduce((s, v) => s + v, 0) / Math.max(1, vals.length);
  check(`at night it burns (on, in a light slot) and its embers glow (${lit.toFixed(2)})`, c.on && vals.length > 30 && lit > 0.1, `on ${c.on}, slot frames ${vals.length}`);
  check(`… and its light flickers round its base (${Math.min(...vals).toFixed(3)}–${Math.max(...vals).toFixed(3)}, base ${base.toFixed(3)})`, vals.length > 30 && Math.max(...vals) / Math.min(...vals) > 1.05 && Math.max(...vals) / Math.min(...vals) < 1.5 && Math.abs(mean / base - 1) < 0.15);
  run('day', 2);
  check('by day it is out: no light, no glow', !c.on && ember.material.emissiveIntensity === 0);
  M.setBuiltIn('fire-test', { on: true, dimmer: 1 });
  run('day', 2);
  check('lit by hand in the light panel it burns by day too', c.on && ember.material.emissiveIntensity > 0);
}

section('Validatoren');
{
  const full = house.loadRegistry();
  const reg = { schema: full.schema, pseudoRooms: full.pseudoRooms };
  const v = (spec) => house.validateHouse(spec, { registry: reg, throw: false });
  const errs = (r) => r.errors.filter((m) => !/rommet «stue-kjokken» mangler/.test(m));
  const res = raw.map((h) => ({ key: h.key, r: v(peisSpec(h.house)) }));
  check('the four test houses validate (no errors, no warnings)', res.every(({ r }) => !errs(r).length && !r.warnings.length), res.flatMap(({ key, r }) => [...errs(r), ...r.warnings].map((m) => `${key}: ${m}`)).slice(0, 8).join('\n         '));
  const withK = (k) => (f) => {
    const spec = peisSpec(JSON.parse(JSON.stringify(raw[k].house)));
    f(spec);
    return v(spec);
  };
  const withA = withK(0), withB = withK(1), withD = withK(3);
  const has = (r, re, kind = 'errors') => (kind === 'errors' ? errs(r) : r.warnings).some((m) => re.test(m));
  check('fireplaces is a top-level key of the schema', !has(withA(() => {}), /ukjent toppnøkkel «fireplaces»/));
  check('an unknown type is an error', has(withA((h) => (h.fireplaces[0].type = 'kamin')), /fireplaces\/ovn-a: type «kamin»/));
  check('a chimney that does not exist is an error', has(withA((h) => (h.fireplaces[0].chimney = 'pipe-x')), /fireplaces\/ovn-a: pipa «pipe-x» finnes ikke/));
  check('a chimney without at that no fireplace names is an error', has(withA((h) => delete h.fireplaces[0].chimney), /chimneys\/pipe-a: at må være/));
  check('no chimney is a warning', has(withA((h) => { delete h.fireplaces[0].chimney; h.chimneys = []; }), /fireplaces\/ovn-a: ildstedet har ingen pipe/, 'warnings'));
  check('a steel chimney with two fireplaces is an error', has(withB((h) => (h.fireplaces[0].chimney = 'pipe-b2')), /stålpipa «pipe-b2» har allerede et ildsted/));
  check('a steel chimney far from the outlet is an error, near it a warning (moved)', has(withA((h) => (h.chimneys[0].at = [5.4, 5.9])), /stålpipa «pipe-a» står 1\.20 m fra røykstussen/) && has(withA((h) => (h.chimneys[0].at = [4.3, 5.9])), /stålpipa «pipe-a» er flyttet 0\.10 m/, 'warnings'));
  check('a fireplace outside its room, or outside every room, is an error', has(withA((h) => (h.fireplaces[0].at = [20, 20])), /fireplaces\/ovn-a: ildstedet .* står ikke i rommet «a-stue»/) && has(withA((h) => Object.assign(h.fireplaces[0], { roomId: undefined, at: [20, 20] })), /fireplaces\/ovn-a: ildstedet .* står ikke i et rom/));
  check('a quarter plate away from a corner is an error', has(withA((h) => (h.fireplaces[0].hearth = { material: 'glass', shape: 'quarter' })), /quarter» passer bare i et hjørne/));
  check('an unknown hearth material is an error', has(withA((h) => (h.fireplaces[0].hearth = { material: 'tre' })), /hearth.material «tre»/));
  check('an opening wider than the surround is an error', has(withB((h) => (h.fireplaces[0].opening = { width: 1.4 })), /åpningen \(1\.4 m\) får ikke plass/));
  check('a stove before a masonry chimney without at, not against a wall, is an error', has(withD((h) => {
    delete h.chimneys[1].at;
    h.fireplaces[1].at = [46, 3.5];
  }), /pipa «pipe-d2» har ingen at, og ovnen står ikke inntil en vegg/));
  check('a chimney from the roof under a fireplace is an error', has(withD((h) => (h.chimneys[1].from = 'roof')), /begynner i taket/));
  check('an id used twice among the fireplaces is an error', has(withB((h) => (h.fireplaces[1].id = 'peis-b')), /peis-b/));
}

section('Ytelse og flater');
{
  check(`built in ${ms} ms (< 3 s)`, ms < 3000);
  for (const k of Object.keys(built)) {
    let tris = 0;
    for (const m of meshes(k, /^fireplace/)) tris += (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3;
    const n = built[k].H.fireplaces.length;
    check(`${k}: ${n} fireplace(s), ${tris} triangles (< 5000 each)`, tris / n < 5000);
  }
  for (const k of Object.keys(built)) {
    // cover: rooms.js's dark deck; leaf: the doors' own parts; the flames cross each other (additive sprites)
    const r = await coplanarOverlaps(built[k].all, { skip: (m) => /^(cover:|leaf:|fireplace-flame:)|^room-walls:.*(#1d1e21|oak #cdbfae)/.test(m.name), minArea: 2e-6 });
    check(`${k}: no overlapping faces in one plane among ${r.triangles} triangles`, !r.bad.length, r.bad.slice(0, 10).join('\n         '));
  }
}

section('Eierens hus');
{
  const OH = ownerLayout.house;
  check('the owner\'s house has no fireplaces, no fire groups and no fire lights', OH.fireplaces.length === 0 && !OH.lightGroups.some((g) => /^fire-/.test(g.id)) && OH.chimneys.length === 0);
  const f = ownerFingerprint();
  console.log(`       fingeravtrykk: layout ${f.layout}, rooms ${f.rooms} (${f.meshes} mesher) – notes/peis-og-ovn.md har verdiene før og etter`);
}

done();
