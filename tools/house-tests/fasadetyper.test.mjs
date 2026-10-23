#!/usr/bin/env node
/**
 * Node test for the facade types (notes/vindusmodeller.md: glassvegg, hjørnevindu, gavlvindu, trekantvindu, rundt vindu,
 * fransk balkong; notes/dortyper.md: garasjeport, ytterdør med sidefelt og overlys, dør i glassvegg):
 *   node tools/house-tests/fasadetyper.test.mjs        (from the project root; exit code 1 on failure)
 *
 * Builds the test houses of dev/fasadetyper.html (src/dev/fasadetyper-hus.js) with buildLayout + buildRooms and checks:
 *   • the validator: both houses without errors or warnings, and the errors / warnings it gives for broken entries;
 *   • the shaped windows: the outline (a gable window's slopes parallel to the roof, a triangle, a round window), the
 *     hole in the wall along it (rays through the glass reach outside, rays beside it hit the wall), the glass;
 *   • the corner window: the corner of the two walls cut out between sill and top, the corner post, glass on both walls;
 *   • the french balconies: the railing on the facade, the figure stopped by it at the open door;
 *   • the doors: a garage door, a front door with a top light, a door with three sidelights;
 *   • no two faces facing the same way overlapping in one plane, the owner's house without any of it.
 */
import { imp, check, section, near, done, coplanarOverlaps } from './_lib.mjs';

const THREE = await import('three');
(await imp('src/home/materials.js')).configureMaterials({ textureRes: 0.125 });
const { buildLayout, layout: ownerLayout } = await imp('src/home/layout.js');
const { buildRooms } = await imp('src/home/rooms.js');
const { createHouseRoots, addColliders } = await imp('src/home/index.js');
const { CollisionWorld } = await imp('src/core/Collision.js');
const { PlayerController } = await imp('src/player/PlayerController.js');
const { GarageDoor } = await imp('src/world/GarageDoor.js');
const { fasadetyperHus, fasadetyperSpec } = await imp('src/dev/fasadetyper-hus.js');
const { windowOutline, isConvex, spanAtX } = await imp('src/home/windowshape.js');
const house = await imp('src/data/scripts/house.mjs');

const DEG = Math.PI / 180;
const f2 = (v) => (Number.isFinite(v) ? v.toFixed(2) : String(v));
const raw = fasadetyperHus();
const built = {};
for (const h of raw) {
  const layout = buildLayout(fasadetyperSpec(h.house), undefined, { devWarnings: false });
  const roots = createHouseRoots(layout, [new THREE.Group()]);
  const collision = new CollisionWorld();
  const R = buildRooms({ scene: new THREE.Scene(), quality: {}, roots, collision }, layout, null);
  const all = new THREE.Group();
  for (const g of Object.values(roots.levels)) all.add(g);
  if (R.group) all.add(R.group);
  all.updateMatrixWorld(true);
  built[h.key] = { ...h, layout, H: layout.house, R, roots, all, collision };
}
const A = built.A, B = built.B;
const opening = (k, name) => {
  const o = built[k].house.walls.flatMap((w) => w.openings || []).find((x) => x.name === name);
  return o ? built[k].H.opening(o.id) : null;
};
const rc = new THREE.Raycaster();
/** The first visible thing hit from o along d (null: nothing). */
const first = (k, o, d, far = 3) => {
  rc.set(o.clone(), d.clone().normalize());
  rc.far = far;
  // (not the doors' invisible doorway targets)
  return rc.intersectObject(built[k].all, true).find((h) => h.object.visible && [].concat(h.object.material).every((m) => m?.visible !== false)) ?? null;
};
const nameOf = (o) => {
  for (let x = o; x; x = x.parent) if (x.name) return x.name;
  return '';
};
/** A point of an opening in its frame (x right seen from the room, y over the sill, z into the room) in world space. */
const at = (o, x, y, z) => o.bottomCenter.clone().addScaledVector(o.right, x).addScaledVector(o.normal, z).add(new THREE.Vector3(0, y, 0));

section('Validatoren');
const full = house.loadRegistry();
const reg = { schema: full.schema, pseudoRooms: full.pseudoRooms };
const v = (spec) => house.validateHouse(spec, { registry: reg, throw: false });
const errs = (r) => r.errors.filter((m) => !/rommet «stue-kjokken» mangler/.test(m));
{
  const res = raw.map((h) => ({ key: h.key, r: v(fasadetyperSpec(h.house)) }));
  check('begge testhusene validerer (ingen feil, ingen advarsler)', res.every(({ r }) => !errs(r).length && !r.warnings.length), res.flatMap(({ key, r }) => [...errs(r), ...r.warnings].map((m) => `${key}: ${m}`)).slice(0, 12).join('\n         '));
  /** The house k with the opening named `name` changed: its messages (errors or warnings) that mention the opening. */
  const broken = (k, name, f, kind = 'errors') => {
    const h = JSON.parse(JSON.stringify(raw.find((x) => x.key === k).house));
    const o = h.walls.flatMap((w) => w.openings || []).find((x) => x.name === name);
    f(o, h);
    const r = v(fasadetyperSpec(h));
    return (kind === 'errors' ? errs(r) : r.warnings).filter((m) => m.includes(o.id));
  };
  const CASES = [
    ['ukjent form', 'A', 'Rundt vindu', (o) => (o.shape = 'oval'), /shape må være/],
    ['rundt vindu på gulvet', 'A', 'Rundt vindu', (o) => (o.sill = 0), /rundt vindu kan ikke stå på gulvet/],
    ['polygon som ikke er konveks', 'A', 'Rundt vindu', (o) => Object.assign(o, { shape: 'polygon', points: [[0, 0], [1, 0], [0.5, 0.3], [1, 1], [0, 1]] }), /konvekst omriss/],
    ['gavlvinduet over veggen', 'A', 'Gavlvindu (femkant langs taket)', (o) => (o.height = 5.0), /formen .* er over veggen/],
    ['trekanten over gavlen', 'A', 'Trekantvindu i gavlen', (o) => (o.sill = 3.9), /formen .* er over veggen/],
    ['hjørnevindu uten vindu på den andre veggen', 'A', 'Hjørnevindu (sør)', (o, h) => delete h.walls.find((w) => w.id === 'w-a-o').openings[0].corner, /trenger et vindu med corner «from» i w-a-o/],
    ['hjørnevindu som ikke når hjørnet', 'A', 'Hjørnevindu (sør)', (o) => (o.width = 1.0), /må gå helt til veggens ende/],
    ['hjørnevinduene med ulik høyde', 'A', 'Hjørnevindu (sør)', (o) => (o.height = 1.2), /samme sill og height/],
    ['hjørnevindu med form', 'A', 'Hjørnevindu (sør)', (o) => (o.shape = 'round'), /formet vindu .* kan ikke være et hjørnevindu/],
    ['fransk balkong: døra slår ut', 'B', 'Dobbeltdør med fransk balkong (glass)', (o) => (o.door.swing = 'out'), /må slå inn/],
    ['fransk balkong: ukjent stil', 'B', 'Vindu til gulvet med fransk balkong (stål)', (o) => (o.frenchBalcony = { style: 'wood' }), /frenchBalcony\.style/],
    ['fransk balkong: for lavt rekkverk', 'B', 'Vindu til gulvet med fransk balkong (stål)', (o) => (o.frenchBalcony = { height: 0.6 }), /frenchBalcony\.height/],
  ];
  for (const [name, k, op, f, re] of CASES) {
    const m = broken(k, op, f);
    check(`feil: ${name}`, m.some((x) => re.test(x)), m.join(' | ') || '(ingen feil)');
  }
  const w1 = broken('B', 'Vindu til gulvet med fransk balkong (stål)', (o) => Object.assign(o, { sill: 0.9, height: 1.2 }), 'warnings');
  check('advarsel: fransk balkong foran et vindu med høy brystning', w1.some((x) => /brystningen er 0,90/.test(x)), w1.join(' | '));
  const w2 = broken('A', 'Gavlvindu (femkant langs taket)', (o) => (o.sashes = [{ to: 0.5, opening: true }, { from: 0.5 }]), 'warnings');
  check('advarsel: et formet vindu bygges fast', w2.some((x) => /bygges fast/.test(x)), w2.join(' | '));
}

section('Formene');
{
  const tri = windowOutline({ shape: 'triangle', width: 1.5, height: 1.05 });
  const round = windowOutline({ shape: 'round', width: 0.7, height: 0.7 });
  const flat = windowOutline({ shape: 'gable', width: 2, height: 2 });
  check('trekant: tre hjørner, toppen midt på', tri.length === 3 && near(tri[2][0], 0, 1e-9) && near(tri[2][1], 1.05, 1e-9));
  check('rundt: 40 hjørner, konvekst, innenfor 0,7 × 0,7', round.length === 40 && isConvex(round) && round.every(([x, y]) => Math.abs(x) <= 0.35 + 1e-9 && y >= -1e-9 && y <= 0.7 + 1e-9));
  check('gavl uten tak over: 35° fra toppen', flat.length === 5 && near(flat[2][1], 2 - Math.tan(35 * DEG), 1e-9));
  // A's west gable: the five-sided window's slopes are the roof's (35°), its peak under the ridge
  const g = opening('A', 'Gavlvindu (femkant langs taket)');
  const P = g.outline;
  const peak = P.reduce((a, q) => (q[1] > a[1] ? q : a));
  const kL = (peak[1] - P[4][1]) / (peak[0] - P[4][0]), kR = (peak[1] - P[2][1]) / (P[2][0] - peak[0]);
  check('gavlvinduet følger takfallet (35°) på begge sider, toppen under mønet', P.length === 5 && near(kL, Math.tan(35 * DEG), 0.01) && near(kR, Math.tan(35 * DEG), 0.01) && near(peak[0], 0, 0.01), `${f2(kL)} / ${f2(kR)}, topp x ${f2(peak[0])}`);
  // rays from the room out through the glass, and through the corner of the box round the shape (the wall)
  const hit = (k, o, x, y) => {
    const h = first(k, at(o, x, y, 0.5), o.normal.clone().negate(), 1.5);
    return h ? nameOf(h.object) : '';
  };
  const W = g.width, H = g.height;
  // (the corner point over the outline but under the wall's top, which runs 0.75 m over it)
  const xc = -W / 2 + 0.1;
  const mid = hit('A', g, 0.2, H - 0.4), corner = hit('A', g, xc, spanAtX(P, xc)[1] + 0.3);
  check('gavlvinduet: glass midt i, vegg i hjørnet av boksen rundt', /^glass:/.test(mid) && /^wall:/.test(corner), `${mid} / ${corner}`);
  const r = opening('A', 'Rundt vindu');
  const rMid = hit('A', r, 0.12, 0.2), rCorner = hit('A', r, 0.3, 0.66);
  check('rundt vindu: glass midt i, vegg i hjørnet', /^glass:/.test(rMid) && /^wall:/.test(rCorner), `${rMid} / ${rCorner}`);
  const t = opening('A', 'Trekantvindu i gavlen');
  const tMid = hit('A', t, 0, 0.3), tCorner = hit('A', t, -0.65, 0.9);
  check('trekantvinduet: glass nede i midten, vegg ved siden av toppen', /^glass:/.test(tMid) && /^wall:/.test(tCorner), `${tMid} / ${tCorner}`);
}

section('Hjørnevinduet');
{
  const s = opening('A', 'Hjørnevindu (sør)');
  const e = opening('A', 'Hjørnevindu (øst)');
  // the room's corner at (9.7, 0.3); a ray from inside out across the corner, diagonally
  const from = (y) => new THREE.Vector3(9.2, y, 0.8);
  const dir = new THREE.Vector3(1, 0, -1);
  const low = first('A', from(s.sill + s.height / 2), dir, 2);
  const over = first('A', from(s.sill + s.height + 0.3), dir, 2);
  check('hjørnet er åpent mellom brystning og topp: hjørneposten, ikke veggen', low && /^window:/.test(nameOf(low.object)), low ? nameOf(low.object) : 'ingenting');
  check('over vinduet er hjørnet vegg', over && /^wall:/.test(nameOf(over.object)), over ? nameOf(over.object) : 'ingenting');
  // glass on both walls, reaching the post: the south pane's end past the room's corner by the reveal depth
  const gs = A.all.getObjectByName(`glass:${s.id}`), ge = A.all.getObjectByName(`glass:${e.id}`);
  check('glass i begge veggene', !!gs && !!ge);
  gs.geometry.computeBoundingBox();
  const bb = gs.geometry.boundingBox.clone().applyMatrix4(gs.matrixWorld);
  check('det sørlige glasset går forbi rommets hjørne (x 9,7) inn mot hjørneposten', bb.max.x > 9.7 + 0.12 && bb.max.x < 9.7 + 0.2 + 0.001, f2(bb.max.x));
}

section('Fransk balkong');
{
  const d = opening('B', 'Dobbeltdør med fransk balkong (glass)');
  const rail = first('B', at(d, 0, 0.6, -0.15), d.normal.clone().negate(), 0.5);
  check('rekkverket står utenfor døra, på fasaden', rail && /^room-outside:/.test(nameOf(rail.object)) && near(rail.distance, 0.15 + 0.07 - 0.0 - 0.0 + 0.0, 0.06), rail ? `${nameOf(rail.object)} ${f2(rail.distance)}` : 'ingenting');
  // the figure walks out of the open door and is stopped by the railing (without it, it walks out and falls)
  const walkOut = (house) => {
    const layout = buildLayout(fasadetyperSpec(house), undefined, { devWarnings: false });
    const roots = createHouseRoots(layout, [new THREE.Group()]);
    const collision = new CollisionWorld();
    const R = buildRooms({ scene: new THREE.Scene(), quality: {}, roots, collision }, layout, null);
    addColliders(collision, R.colliders);
    collision.build();
    const b = layout.house.bounds;
    collision.setBounds?.(b.minX - 6, b.maxX + 6, b.minZ - 6, b.maxZ + 6);
    if (collision.setFloorField && layout.house.floorYAt) collision.setFloorField((x, z, y) => layout.house.floorYAt(x, z, y));
    for (const x of R.doors) x.door.setOpen(true, { instant: true });
    const input = { move: { forward: 0, right: 0 }, running: false, crouch: false, jumpPressed: false, lookDelta: { x: 0, y: 0 }, turn: 0 };
    const player = new PlayerController({ camera: new THREE.PerspectiveCamera(), collision, input, settings: { get: () => undefined }, events: { emit() {} } });
    const start = at(d, 0, -d.sill, 1.2).setY(2.9);
    player.teleport(start, Math.atan2(d.normal.x, d.normal.z), 0);
    for (let i = 0; i < 10; i++) player.update(1 / 60);
    input.move.forward = 1;
    // the furthest out it got (one that falls out of the house is put back by the player's own safety net)
    let out = start.z;
    for (let i = 0; i < 180; i++) {
      player.update(1 / 60);
      out = Math.min(out, player.position.z);
    }
    return { z: out };
  };
  // (fresh house files: the builders keep parts of the ones built above)
  const fresh = () => fasadetyperHus().find((x) => x.key === 'B').house;
  const stopped = walkOut(fresh());
  const hb = fresh();
  const free = walkOut({ ...hb, walls: hb.walls.map((w) => ({ ...w, openings: (w.openings || []).map((o) => (o.frenchBalcony ? { ...o, frenchBalcony: undefined } : o)) })) });
  // the facade of the south wall at z 0 (the room's face at z 0.3)
  check('figuren stopper ved rekkverket i den åpne døra', stopped.z > 0.1 && stopped.z < 0.6, `z ${f2(stopped.z)}`);
  check('uten rekkverket går figuren ut', free.z < -0.3, `z ${f2(free.z)}`);
}

section('Dørene');
{
  const doorOf = (k, name) => built[k].R.doors.find((x) => x.id === opening(k, name)?.id)?.door;
  const g = doorOf('B', 'Leddport');
  check('leddporten er en GarageDoor med 4 seksjoner', g instanceof GarageDoor && g.leaves.length === 4, g ? `${g.constructor.name} ${g.leaves.length}` : 'mangler');
  const fd = doorOf('B', 'Ytterdør med sidefelt og overlys');
  check('ytterdøra med overlys: bladet under losholtet (2,45 − 0,05 − 0,4 − 0,05)', fd && near(fd.height, 1.95 - 0.008 + 0.046, 0.002), fd ? f2(fd.height) : 'mangler');
  const gd = doorOf('A', 'Dør i glassvegg (tre sidefelt)');
  check('døra i glassveggen: bladet fyller bukta mellom tre sidefelt (0,86 m)', gd && near(gd.leaves[0].length, 0.86, 0.003), gd ? f2(gd.leaves[0].length) : 'mangler');
}

section('Flater i samme plan');
for (const k of ['A', 'B']) {
  // leaf: the doors' own parts (doors.js / doortypes.js, checked by doortypes.test.mjs)
  const r = await coplanarOverlaps(built[k].all, { skip: (m) => /^(leaf:|cover:)|^room-walls:.*(#1d1e21|oak #cdbfae)/.test(m.name), minArea: 2e-6 });
  check(`${k}: ingen overlappende flater i samme plan blant ${r.triangles} trekanter`, !r.bad.length, r.bad.slice(0, 10).join('\n         '));
}

section('Eierens hus');
{
  const ops = ownerLayout.house.walls.flatMap((w) => w.openings);
  check('eierens hus har ingen formede vinduer, hjørnevinduer eller franske balkonger', ops.every((o) => !o.shape && !o.corner && !o.outline));
  const doors = ownerLayout.house.doors;
  check('eierens hus har ingen garasjeport, overlys eller flere sidefelt', doors.every((d) => d.door?.variant !== 'garage' && !d.door?.transom));
}

done();
