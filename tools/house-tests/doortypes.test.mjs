#!/usr/bin/env node
/**
 * Dørtypene (notes/dortyper.md): dobbeltdør, skyvedør (på skinne, inn i veggen, patio av glass), glassfelt og sidefelt.
 *   node tools/house-tests/doortypes.test.mjs        (from the project root; exit code 1 on failure)
 *
 * Also foldedør (variant 'folding', world/FoldingDoor.js). On the test house (tools/dortyper/testhus.mjs), in Node (no renderer): the validator (no error but the owner-only
 * «stue-kjokken», and the errors it must give for broken door types); the builder (home/doors.js → home/doortypes.js:
 * the right class and number of leaves per door, the bay of a door with sidelights); the figure (PlayerController,
 * radius 0.3, the real CollisionWorld) walks through every open door both ways and is stopped by every closed one; a
 * sliding leaf and a double door closing on the figure in the doorway stop against it and close once it has gone.
 * The owner's house: none of its doors goes to doortypes.js (its look is checked by the other tests).
 */
import { imp, readJson, check, section, near, done } from './_lib.mjs';

const THREE = await import('three');
(await imp('src/home/materials.js')).configureMaterials({ textureRes: 0.125 });
const { buildLayout, layout: ownerLayout } = await imp('src/home/layout.js');
const { buildRooms } = await imp('src/home/rooms.js');
const { createHouseRoots, addColliders } = await imp('src/home/index.js');
const { isDoorType } = await imp('src/home/doortypes.js');
const { Door } = await imp('src/world/Door.js');
const { SlidingDoor } = await imp('src/world/SlidingDoor.js');
const { FoldingDoor } = await imp('src/world/FoldingDoor.js');
const { CollisionWorld } = await imp('src/core/Collision.js');
const { PlayerController } = await imp('src/player/PlayerController.js');
const { PLAYER } = await imp('src/config.js');
const H = await imp('src/data/scripts/house.mjs');
const { testHouse, testHouseSpec, DOORS } = await imp('tools/dortyper/testhus.mjs');

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const f2 = (v) => (Number.isFinite(v) ? v.toFixed(2) : String(v));

// ---------------------------------------------------------------------------------------------------------------
section('Validatoren');
const ids = readJson('research/house/00-ids.json');
function validate(house) {
  const registry = { levels: { hoved: { name: 'Hovedetasje', floorY: 0 } }, rooms: Object.fromEntries(house.rooms.map((r) => [r.id, { levelId: r.levelId, kind: r.kind }])), pseudoRooms: ['ute'], lightGroups: {}, schema: ids.schema };
  const rep = H.validateHouse(testHouseSpec(house), { registry, archetypes: { archetypes: {}, archetypeAliases: {} }, throw: false });
  return { errors: rep.errors.filter((e) => !/rommet «stue-kjokken» mangler/.test(e)), warnings: rep.warnings };
}
{
  const rep = validate(testHouse());
  check('testhuset: ingen feil', rep.errors.length === 0, rep.errors.join(' | '));
  check('testhuset: ingen advarsler', rep.warnings.length === 0, rep.warnings.join(' | '));
}
/** The test house with one opening's door changed (or the opening itself): the errors that mention it. */
function broken(id, change) {
  const house = testHouse();
  for (const w of house.walls) for (const o of w.openings || []) if (o.id === id) change(o);
  const rep = validate(house);
  return { errors: rep.errors.filter((e) => e.includes(id)), warnings: rep.warnings.filter((e) => e.includes(id)) };
}
const BROKEN = [
  ['ukjent variant', 'door-glass', (o) => (o.door.variant = 'revolving'), /variant må være/],
  ['patio med slide «both»', 'door-patio', (o) => (o.door.slide = 'both'), /patio/],
  ['ukjent mount', 'door-skyve', (o) => (o.door.mount = 'ceiling'), /mount må være/],
  ['lomme over en annen åpning', 'door-lomme', (o) => (o.door.slide = 'from'), /lommen i veggen.*går over door-skyve/],
  ['lomme forbi veggens ende', 'door-glass', (o) => Object.assign(o.door, { variant: 'sliding', mount: 'pocket', slide: 'from' }), /lommen i veggen trenger/],
  ['for smal for figuren (sidefelt)', 'door-terrasse', (o) => (o.door.sidelights = [{ side: 'to', w: 0.7 }]), /figuren/],
  ['for smal skyvedør', 'door-skyve', (o) => (o.width = 0.7), /figuren/],
  ['to sidefelt på samme side', 'door-inngang', (o) => (o.door.sidelights = [{ side: 'from' }, { side: 'from' }]), /to sidefelt/],
  ['glass.rows ikke heltall', 'door-glass', (o) => (o.door.glass = { rows: 2.5 }), /glass\.rows/],
  ['active 3', 'door-dobbel-ulik', (o) => (o.door.active = 3), /active må være/],
  ['foldedør med 1 ledd', 'door-folde', (o) => (o.door.panels = 1), /panels må være/],
  ['for smal foldedør', 'door-folde', (o) => (o.width = 0.7), /figuren/],
];
for (const [name, id, change, re] of BROKEN) {
  const r = broken(id, change);
  check(`feil: ${name}`, r.errors.some((e) => re.test(e)), r.errors.join(' | ') || '(ingen feil)');
}
{
  const r = broken('door-skyve', (o) => (o.door.slide = 'to'));
  check('advarsel: skyvedør på skinne parkerer over en annen dør', r.warnings.some((e) => /det åpne bladet.*går over/.test(e)) && !r.errors.length, [...r.errors, ...r.warnings].join(' | '));
  const s = broken('door-skyve', (o) => delete o.door.hinge);
  check('skyvedør uten hinge er gyldig', !s.errors.length, s.errors.join(' | '));
}

// ---------------------------------------------------------------------------------------------------------------
section('Byggingen');
const layout = buildLayout(testHouseSpec(), undefined, { devWarnings: false });
const collision = new CollisionWorld();
const roots = createHouseRoots(layout, [new THREE.Group()]);
const ctx = { scene: new THREE.Scene(), quality: {}, roots, collision };
const R = buildRooms(ctx, layout, null);
const byId = new Map(R.doors.map((d) => [d.id, d]));
const EXPECT = {
  'door-inngang': [Door, 1], 'door-glass': [Door, 1], 'door-dobbel-glass': [Door, 2], 'door-skyve': [SlidingDoor, 1], 'door-lomme': [SlidingDoor, 1],
  'door-skyve-dobbel': [SlidingDoor, 2], 'door-dobbel-ulik': [Door, 2], 'door-patio': [SlidingDoor, 1], 'door-terrasse': [Door, 1], 'door-terrasse-dobbel': [Door, 2],
  'door-folde': [FoldingDoor, 8], 'door-folde-glass': [FoldingDoor, 8],
};
check('alle dørene i testhuset er bygd', DOORS.every((id) => byId.has(id)), DOORS.filter((id) => !byId.has(id)).join(', '));
for (const [id, [cls, n]] of Object.entries(EXPECT)) {
  const d = byId.get(id)?.door;
  check(`${id}: ${cls.name} med ${n} blad`, d instanceof cls && d.leaves.length === n, d ? `${d.constructor.name}, ${d.leaves.length}` : 'mangler');
}
{
  const u = byId.get('door-dobbel-ulik').door;
  const ls = u.leaves.map((l) => l.length).sort((a, b) => a - b);
  check('ulike blad: forholdet 0,4 : 0,8 i hele bredden mellom karmene', near(ls[1] / ls[0], 2, 0.03) && near(ls[0] + ls[1], 1.3 - 0.12 - 0.002, 0.003), ls.map(f2).join(' / '));
  const t = byId.get('door-terrasse').door;
  check('terrassedør med sidefelt: bladet fyller bukta (1,45 − 2·0,05 − 0,4 − 0,05)', near(t.leaves[0].length, 0.9, 0.002), f2(t.leaves[0].length));
}
check('eierens hus: ingen dør går til doortypes.js', ownerLayout.house.doors.every((d) => !isDoorType(d)), ownerLayout.house.doors.filter(isDoorType).map((d) => d.id).join(', '));

// ---------------------------------------------------------------------------------------------------------------
section('Figuren (r 0,3) gjennom åpne dører, stoppet av lukkede');
addColliders(collision, R.colliders);
// the ground outside at the floor's height: this Node set-up does not step up from a lower ground, an old plain door no
// more than the door types (the planbygger viewer's 0.15 step, F13, is the browser's) – the test is about the doors
collision.addStaticBox(new THREE.Box3(V(-6, -0.3, -6), V(20, 0, 13)));
collision.build();
const b = layout.house.bounds;
collision.setBounds?.(b.minX - 6, b.maxX + 6, b.minZ - 6, b.maxZ + 6);
if (collision.setFloorField && layout.house.floorYAt) collision.setFloorField((x, z, y) => layout.house.floorYAt(x, z, y));

/** Walk from `start` along `dir` (x, z) for `seconds` at 60 Hz; the end position. */
function walk(start, dir, seconds = 3.5) {
  const input = { move: { forward: 0, right: 0 }, running: false, crouch: false, jumpPressed: false, lookDelta: { x: 0, y: 0 }, turn: 0 };
  const player = new PlayerController({ camera: new THREE.PerspectiveCamera(), collision, input, settings: { get: () => undefined }, events: { emit() {} } });
  player.teleport(start.clone(), Math.atan2(-dir.x, -dir.z), 0);
  for (let i = 0; i < 10; i++) player.update(1 / 60);
  input.move.forward = 1;
  for (let i = 0; i < seconds * 60; i++) player.update(1 / 60);
  return player.position.clone();
}
for (const id of DOORS) {
  const info = byId.get(id);
  const door = info.door;
  const d = layout.house.doors.find((x) => x.id === id);
  const n = d.basis.zAxis.clone().setY(0).normalize();
  const depth = layout.house.wallsById[d.wallId]?.thickness ?? 0.1;
  door.doorway.updateWorldMatrix(true, false);
  const mid = door.doorway.getWorldPosition(V(0, 0, 0)).setY(d.basis.origin.y);
  const face = d.basis.origin.clone();
  // signed distance in front of the wall's front face (+ = the owner room's side)
  const along = (p) => p.clone().sub(face).dot(n);
  const front = mid.clone().addScaledVector(n, 1.0);
  const back = mid.clone().addScaledVector(n, -depth - 1.0);
  door.setOpen(true, { instant: true });
  const through = walk(front, n.clone().negate());
  const backAgain = walk(back, n.clone());
  check(`${id}: åpen – fra forsiden gjennom`, along(through) < -depth - 0.5, `ender ${f2(along(through))} m foran veggen (bak: < ${f2(-depth - 0.5)})`);
  check(`${id}: åpen – fra baksiden gjennom`, along(backAgain) > 0.5, `ender ${f2(along(backAgain))} m foran veggen`);
  door.setOpen(false, { instant: true });
  // closed: the figure gets at most into the reveal up to the leaf (an outer door's leaf sits at the outer face)
  const stopped = walk(front, n.clone().negate(), 2.5);
  check(`${id}: lukket – figuren stopper foran bladet`, along(stopped) > 0, `ender ${f2(along(stopped))} m foran veggen`);
}

// ---------------------------------------------------------------------------------------------------------------
section('Bladene stopper mot figuren i døråpningen');
/** Close `id` while the figure stands in the doorway; then it walks away and the door closes. */
function closeOnFigure(id) {
  const door = byId.get(id).door;
  door.setOpen(true, { instant: true });
  door.doorway.updateWorldMatrix(true, false);
  const feet = door.doorway.getWorldPosition(V(0, 0, 0)).setY(0);
  door.close();
  for (let i = 0; i < 120; i++) door.update(1 / 60, { playerPosition: feet });
  const held = door.t;
  // no collider of the door inside the figure's circle (r 0.3 at the feet)
  const boxes = door.leaves.flatMap((l) => [l.collider, ...(l.segments || [])]).filter((h) => h?.enabled);
  const inside = boxes.some((h) => {
    const bx = h.box;
    if (bx.min.y > 1.7 || bx.max.y < 0.1) return false;
    const cx = THREE.MathUtils.clamp(feet.x, bx.min.x, bx.max.x);
    const cz = THREE.MathUtils.clamp(feet.z, bx.min.z, bx.max.z);
    return Math.hypot(cx - feet.x, cz - feet.z) < PLAYER.radius - 1e-3;
  });
  const away = feet.clone().addScaledVector(layout.house.doors.find((x) => x.id === id).basis.zAxis, 2);
  for (let i = 0; i < 120; i++) door.update(1 / 60, { playerPosition: away });
  return { held, inside, closed: door.t === 0 };
}
for (const id of ['door-skyve', 'door-lomme', 'door-skyve-dobbel', 'door-patio', 'door-dobbel-glass', 'door-dobbel-ulik', 'door-folde', 'door-folde-glass']) {
  const r = closeOnFigure(id);
  check(`${id}: holdes igjen av figuren`, r.held > 0.05 && !r.inside, `t ${f2(r.held)}${r.inside ? ', et blad står inni figuren' : ''}`);
  check(`${id}: lukkes når figuren har gått`, r.closed);
}

// ---------------------------------------------------------------------------------------------------------------
section('Pekeren over glasset (F102)');
{
  // every target of a sliding / folding door (the leaves and the invisible doorway in front of a patio's sliding panel)
  // makes the whole door glow, so aiming at the glass shows the door can be opened
  const regs = [];
  const fake = { ...ctx, interaction: { register: (object, opts) => (regs.push({ object, opts }), { unregister() {} }) } };
  const s = new SlidingDoor(fake, { id: 't-skyve', matrix: new THREE.Matrix4(), width: 1, height: 2.1, depth: 0.1, leaves: [{ x0: -0.5, x1: 0.5, y1: 2, z0: 0.03, z1: 0.07, dir: 1, travel: 0.9 }] });
  const f = new FoldingDoor(fake, { id: 't-folde', matrix: new THREE.Matrix4(), width: 1.2, height: 2.1, depth: 0.1, stacks: [{ anchor: -0.5, e: 1, span: 1, panels: 4, z0: -0.03, side: 1, T: 0.03, y0: 0.01, y1: 2 }] });
  for (const door of [s, f]) {
    const mine = regs.filter((r) => r.opts.id === door.id);
    const pivots = door.leaves.map((l) => l.pivot);
    const ok = mine.length === door.leaves.length + 1 && mine.every((r) => Array.isArray(r.opts.highlight) && pivots.every((p) => r.opts.highlight.includes(p)));
    check(`${door.constructor.name}: døråpningen og hvert blad lyser opp hele døra`, ok, `${mine.length} mål`);
  }
  const panes = [];
  for (const d of R.doors) d.door.root.traverse((o) => o.name.startsWith('glass:') && panes.push(o));
  check('glassrutene i dørene lyser ikke opp (bare rammen)', panes.length > 0 && panes.every((o) => o.userData.noHighlight === true), `${panes.length} ruter`);
}

done();
