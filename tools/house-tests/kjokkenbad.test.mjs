#!/usr/bin/env node
/**
 * Node test of the kitchens, bathrooms and laundries of generated houses (notes/kjokken-bad-genererte-hus.md):
 *   node tools/house-tests/kjokkenbad.test.mjs        (from the project root; exit code 1 on failure)
 *
 *   • the validator knows the fields: the test house (tools/kjokkenbad/testhus.mjs) has no errors and no warnings,
 *     and broken entries are reported (unknown type, a wall-hung type on the floor, bad wallTiles, a slot outside a
 *     bench, the shower's options);
 *   • the plan pass (home/builtinplan.js): the appliances become slots of their bench / island, the machines gaps in the
 *     laundry bench, the showers get their glass, door, set and drains from the walls, the tile zones (to the ceiling in
 *     the bathroom and in the showers, 1.2 m in the laundry, the backsplash up to the wall cabinets) and the wall-hung
 *     entries on tiles stand out by TILE_T;
 *   • the tiles' geometry: TILE_T in front of the wall, up to the wall's top (also under the laundry's sloping ceiling),
 *     never inside a door or window;
 *   • everything builds (buildBuiltIns, the room batches), with colliders where you cannot walk, none for the open
 *     shower and the drains;
 *   • the owner's house passes the plan pass untouched (the same entry objects, no tiles) – and its fingerprint is
 *     printed (notes/kjokken-bad-genererte-hus.md has the values before and after).
 */
import { imp, readJson, check, section, near, done } from './_lib.mjs';

const THREE = await import('three');
(await imp('src/home/materials.js')).configureMaterials({ textureRes: 0.125 });
const { buildLayout } = await imp('src/home/layout.js');
const { buildBuiltIns, BUILDERS } = await imp('src/home/builtins.js');
const { planBuiltIns, hostOf, TILE_T, BUILT_IN_DEFAULTS, PLAN_SYMBOLS } = await imp('src/home/builtinplan.js');
const { benchUnits } = await imp('src/home/kitchenkit.js');
const { createHouseRoots } = await imp('src/home/index.js');
const { profileAt } = await imp('src/home/wallkit.js');
const V = await imp('src/data/scripts/house.mjs');
const { testHouse, testHouseSpec } = await imp('tools/kjokkenbad/testhus.mjs');
const { ownerFingerprint } = await imp('tools/house-tests/owner-fingerprint.mjs');
const { layout: ownerLayout } = await imp('src/home/layout.js');

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
const f2 = (v) => (Number.isFinite(v) ? v.toFixed(3) : String(v));

// ---------------------------------------------------------------------------------------------------------------
section('Validatoren');
const ids = readJson('research/house/00-ids.json');
function validate(house) {
  const registry = { levels: { hoved: { name: 'Hovedetasje', floorY: 0 } }, rooms: Object.fromEntries(house.rooms.map((r) => [r.id, { levelId: r.levelId, kind: r.kind }])), pseudoRooms: ['ute'], lightGroups: {}, schema: ids.schema };
  const rep = V.validateHouse(testHouseSpec(house), { registry, archetypes: { archetypes: {}, archetypeAliases: {} }, throw: false });
  return { errors: rep.errors.filter((e) => !/rommet «stue-kjokken» mangler/.test(e)), warnings: rep.warnings };
}
{
  const rep = validate(testHouse());
  check('testhuset: ingen feil', rep.errors.length === 0, rep.errors.join(' | '));
  check('testhuset: ingen advarsler', rep.warnings.length === 0, rep.warnings.join(' | '));
  const types = ids.schema.collections.builtIns.enums.type;
  check('00-ids.json kjenner alle typene i BUILT_IN_DEFAULTS, og builtins.js bygger dem', Object.keys(BUILT_IN_DEFAULTS).every((t) => types.includes(t) && typeof BUILDERS[t] === 'function'), Object.keys(BUILT_IN_DEFAULTS).filter((t) => !types.includes(t) || !BUILDERS[t]).join());
  check('PLAN_SYMBOLS gir bare kjente typer', Object.values(PLAN_SYMBOLS).every((t) => types.includes(t)));
}
/** The test house with one change: the errors / warnings that match `re`. */
function broken(change) {
  const house = testHouse();
  change(house);
  return validate(house);
}
const bi = (h, id) => h.builtIns.find((b) => b.id === id);
const room = (h, id) => h.rooms.find((r) => r.id === id);
const BROKEN = [
  ['ukjent type', (h) => (bi(h, 'bi-kj-om').type = 'washing-up'), 'errors', /type «washing-up» er ikke en av/],
  ['overskap på gulvet', (h) => Object.assign(bi(h, 'bi-kj-overskap'), { mount: 'floor', wallId: undefined }), 'errors', /wall-cabinets henger på en vegg/],
  ['overskap for lavt', (h) => (bi(h, 'bi-kj-overskap').position[1] = 0.9), 'warnings', /underkanten står 0,90/],
  ['dims uten høyde', (h) => (bi(h, 'bi-bad-kar').dims.h = 0), 'errors', /dims må ha w, d og h over 0/],
  ['dusj med ukjent enclosure', (h) => (bi(h, 'bi-bad-dusj').params = { enclosure: 'curtain' }), 'errors', /params\.enclosure «curtain»/],
  ['badekar med ukjent stil', (h) => (bi(h, 'bi-bad-kar').params = { style: 'corner' }), 'errors', /params\.style «corner»/],
  ['koketopp utenfor benken', (h) => (bi(h, 'bi-kj-topp').position = [3.0, 0, 1.0]), 'warnings', /hob står ikke i en kitchen-bench/],
  ['wallTiles med feil høyde', (h) => (room(h, 'bad').wallTiles.height = 'tak'), 'errors', /wallTiles: height må være «ceiling»/],
  ['wallTiles from over height', (h) => Object.assign(room(h, 'vask').wallTiles, { from: 1.5 }), 'errors', /from \(1,50\) må være under height/],
  ['wallTiles på en vegg i et annet rom', (h) => (room(h, 'bad').wallTiles.wallIds = ['w-kj-nord']), 'errors', /veggen w-kj-nord er i rommet kjokken, ikke bad/],
  ['wallTiles u uten én vegg', (h) => (room(h, 'bad').wallTiles.u = [0, 1]), 'errors', /u gjelder én vegg/],
  ['wallTiles som tekst', (h) => (room(h, 'bad').wallTiles = 'ja'), 'errors', /wallTiles må være true/],
  ['gulvfliser med feil størrelse', (h) => (room(h, 'bad').floor.size = [30, 30]), 'errors', /floor\.size må være/],
];
for (const [name, change, kind, re] of BROKEN) {
  const rep = broken(change);
  check(`ødelagt: ${name}`, rep[kind].some((m) => re.test(m)), `${kind}: ${rep[kind].join(' | ') || '(ingen)'}`);
}

// ---------------------------------------------------------------------------------------------------------------
section('Planen: benker, dusjer, fliser');
const [layout, layoutWarns] = quiet(() => buildLayout(testHouseSpec(), undefined, { devWarnings: false }));
const H = layout.house;
check('layout uten advarsler', layoutWarns.length === 0, layoutWarns.join(' | '));
check('rommene har wallTiles fra dataene', H.rooms.find((r) => r.id === 'bad')?.wallTiles?.height === 'ceiling' && H.rooms.find((r) => r.id === 'kjokken')?.wallTiles === null);
const plan = planBuiltIns(H);
const P = Object.fromEntries(plan.list.map((b) => [b.id, b]));
{
  const bench = P['bi-kj-benk'];
  const kinds = (bench?.slots || []).map((s) => s.type).sort().join();
  check('benken har kummen, oppvaskmaskinen, koketoppen og ovnen som slots', kinds === 'dishwasher,hob,oven,sink', kinds);
  check('slottene bygges ikke for seg', ['bi-kj-kum', 'bi-kj-om', 'bi-kj-topp', 'bi-kj-ovn', 'bi-kj-oykum'].every((id) => !P[id]));
  check('øya har sin kum', P['bi-kj-oy']?.slots?.length === 1 && P['bi-kj-oy'].slots[0].type === 'sink');
  const sink = bench.slots.find((s) => s.type === 'sink');
  check('kummen ligger 0,8 m bred der symbolet står (lokal x 0,7–1,5)', near(sink.x0, 0.7, 1e-6) && near(sink.x1, 1.5, 1e-6), `${f2(sink.x0)}–${f2(sink.x1)}`);
  const units = benchUnits(bench.dims.w, bench.slots);
  const kindsAt = units.map((u) => u.kind).join(',');
  check('enhetene: ovnen under koketoppen, oppvaskmaskinen, døra under kummen, skuffer ellers', units.some((u) => u.kind === 'oven' && u.slot === 'bi-kj-ovn') && units.some((u) => u.kind === 'integrated' && u.slot === 'bi-kj-om') && units.some((u) => u.kind === 'door' && u.slot === 'bi-kj-kum') && units.filter((u) => u.kind === 'drawers').length >= 2, kindsAt);
  const cover = units.reduce((s, u) => s + (u.x1 - u.x0), 0);
  check('enhetene fyller benken mellom endepanelene uten hull eller overlapp', near(cover, bench.dims.w - 0.032, 1e-6) && units.every((u, i) => i === 0 || near(u.x0, units[i - 1].x1, 1e-6)), `${f2(cover)}`);
  const lb = P['bi-vask-benk'];
  check('vaskebenken får to hull for vaskemaskinen og tørketrommelen', lb?.gaps?.length === 2 && P['bi-vask-vm'] && P['bi-vask-tt'], JSON.stringify(lb?.gaps));
  check('hostOf virker på spesifikasjonen (validatoren)', hostOf(bi(testHouse(), 'bi-kj-om'), testHouse().builtIns)?.host.id === 'bi-kj-benk' && hostOf(bi(testHouse(), 'bi-kj-k'), testHouse().builtIns) === null);
}
{
  const sh = P['bi-bad-dusj'];
  const g = sh?.params?.glass || [];
  check('baddusjen: hjørnet NW, glass på de to åpne sidene', sh?.params?.corner === 'NW' && g.length === 2 && g.map((x) => x.side).join() === 'south,east', `${sh?.params?.corner} ${g.map((x) => x.side)}`);
  check('baddusjen: en slagdør på glasset (0,9 m)', g.some((x) => x.panels.some((p) => p.kind === 'swing')));
  check('baddusjen: dusjsettet på nordveggen, midt på', sh?.params?.set?.wall === 'w-bad-nord' && near(sh.params.set.at[1], 8.05, 1e-6) && near(sh.params.set.standoff, TILE_T, 1e-9));
  const drain = P['bi-bad-dusj-sluk'];
  check('baddusjen: et firkantet sluk midt i dusjen', drain?.type === 'floor-drain' && drain.params.shape === 'square' && near(drain.position.x, 0.45, 1e-6) && near(drain.position.z, 8.05, 1e-6) && drain.collide === false);
  const open = P['bi-vask-dusj'];
  check('vaskeromsdusjen uten vegger: intet glass, ingen kollisjon', open?.params?.enclosure === 'none' && open.collide === false && !open.params.glass);
  const lin = P['bi-vask-dusj-sluk'];
  check('vaskeromsdusjen: rennesluk langs veggen med dusjsettet (sørveggen)', lin?.params?.shape === 'linear' && near(lin.position.x, 3.9, 1e-6) && near(lin.dims.w, 0.7, 1e-6) && lin.rotationDeg === 90, JSON.stringify(lin && { x: lin.position.x, w: lin.dims.w }));
  check('sluket midt i vaskerommet er sitt eget (ikke i dusjen)', !!P['bi-vask-sluk']);
  // a five-sided shower (the plan's quarter circle / diagonal) and a lone dishwasher: built without warnings
  const h2 = testHouse();
  bi(h2, 'bi-bad-dusj').params = { shape: 'pentagon' };
  h2.builtIns.push({ id: 'bi-kj-om2', roomId: 'kjokken', type: 'dishwasher', mount: 'floor', position: [3.6, 0, 1.0], rotationDeg: -90, dims: { w: 0.6, d: 0.6, h: 0.9 } });
  const [l2] = quiet(() => buildLayout(testHouseSpec(h2), undefined, { devWarnings: false }));
  const p2 = planBuiltIns(l2.house);
  const pent = p2.list.find((b) => b.id === 'bi-bad-dusj');
  const [b2, w2] = quiet(() => buildBuiltIns({ quality: {}, roots: createHouseRoots(l2, [new THREE.Group()]) }, l2));
  check('femkantet dusj: hjørnet NW fra veggene, bygd uten advarsler', pent?.params.corner === 'NW' && pent.params.shape === 'pentagon' && w2.length === 0 && b2.colliders.some((c) => c.builtInId === 'bi-bad-dusj'), w2.join(' | '));
  check('en oppvaskmaskin uten benk bygges som en kort benk av sin egen', p2.list.some((b) => b.id === 'bi-kj-om2') && b2.colliders.some((c) => c.builtInId === 'bi-kj-om2'));
}
const zones = new Map();
for (const [, walls] of plan.tiles) for (const { wall, zones: z } of walls) zones.set(wall.id, z);
{
  check('badet: alle fire veggene flislagt til taket', ['w-bad-kj', 'w-bad-sor', 'w-bad-vask', 'w-bad-nord'].every((id) => zones.get(id)?.some((z) => z.top === 'ceiling' && z.from === 0 && near(z.u1 - z.u0, H.wallsById[id].length, 1e-6))));
  check('vaskerommet: 1,2 m på alle veggene', ['w-vask-bad', 'w-vask-sor', 'w-vask-vest', 'w-vask-nord'].every((id) => zones.get(id)?.some((z) => z.top === 1.2)));
  const sor = zones.get('w-vask-sor');
  check('vaskerommet: dusjveggene til taket over dusjens bredde', sor?.some((z) => z.top === 'ceiling' && z.shower && near(z.u0, 0, 1e-6) && near(z.u1, 0.9, 1e-6)) && zones.get('w-vask-bad')?.some((z) => z.top === 'ceiling' && near(z.u1 - z.u0, 0.9, 1e-6)));
  const bs = zones.get('w-kj-nord');
  check('kjøkkenet: flis bak benken fra benkeplata (0,9) til overskapene (1,45)', bs?.length === 1 && bs[0].from === 0.9 && bs[0].top === 1.45 && near(bs[0].u0, 1.8, 1e-6) && near(bs[0].u1, 5.4, 1e-6), JSON.stringify(bs?.map((z) => [z.u0, z.u1, z.from, z.top])));
  check('ingen andre kjøkkenvegger har flis', [...zones.keys()].filter((id) => id.startsWith('w-kj-')).join() === 'w-kj-nord');
}
{
  const moved = (id) => {
    const a = H.builtIns.find((b) => b.id === id), b = P[id];
    return a && b ? a.position.distanceTo(b.position) : NaN;
  };
  check('det som henger på flis står TILE_T ut (WC, servant, speil, håndkletørker, skyllekar)', ['bi-bad-wc', 'bi-bad-servant', 'bi-bad-speil', 'bi-bad-hk', 'bi-vask-skyllekar'].every((id) => near(moved(id), TILE_T, 1e-9)), ['bi-bad-wc', 'bi-bad-servant', 'bi-bad-speil', 'bi-bad-hk', 'bi-vask-skyllekar'].map((id) => `${id} ${f2(moved(id))}`).join(', '));
  check('benken, overskapene og ventilatoren står på veggen (flisa er mellom dem)', ['bi-kj-benk', 'bi-kj-overskap', 'bi-kj-vent'].every((id) => moved(id) === 0));
}

// ---------------------------------------------------------------------------------------------------------------
section('Flisene i 3D');
const roots = createHouseRoots(layout, [new THREE.Group()]);
const [B, buildWarns] = quiet(() => buildBuiltIns({ quality: {}, roots }, layout));
check('alt bygges uten advarsler', buildWarns.length === 0, buildWarns.join(' | '));
check('i det flislagte badet har WC-kassa og badekarets front flisene', P['bi-bad-wc']?.tileFinish?.color === '#ecebe7' && P['bi-bad-kar']?.tileFinish?.color === '#ecebe7');
const all = new THREE.Group();
for (const g of Object.values(roots.levels)) all.add(g);
all.updateMatrixWorld(true);
/** World vertices of the tile meshes of a room (the merged built-in mesh with the tile material). */
function tileVerts(roomId) {
  const out = [];
  roots.rooms[roomId].contents.traverse((m) => {
    if (!m.isMesh || ![].concat(m.material).some((x) => /^tiles /.test(x?.name ?? ''))) return;
    const p = m.geometry.attributes.position;
    const v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) out.push(v.fromBufferAttribute(p, i).applyMatrix4(m.matrixWorld).clone());
  });
  return out;
}
{
  const tri = B.wallTiles.reduce((s, t) => s + t.triangles, 0);
  check('flisene er bygd på 4 + 4 + 1 vegger', B.wallTiles.length === 9 && tri > 50 && tri < 4000, `${B.wallTiles.length} vegger, ${tri} trekanter`);
  const bad = tileVerts('bad');
  const top = Math.max(...bad.map((v) => v.y));
  check('badet: flisene når taket (2,398), ikke over', near(top, 2.398, 1e-4), f2(top));
  // the wall toward the kitchen (normal +z), west of the tub (its apron has the tiles too) and the WC box
  const face = bad.filter((v) => Math.abs(v.z - 6.1) < 0.02 && v.x > 0.3 && v.x < 3.2);
  check('badet: flisene står TILE_T foran veggen mot kjøkkenet', face.length > 0 && face.every((v) => v.z > 6.1 - 1e-6 && v.z < 6.1 + TILE_T + 1e-6) && face.some((v) => near(v.z, 6.1 + TILE_T, 1e-6)));
  // no tile face inside the door hole toward the kitchen (x 2.1–3.0, y < 2.1) or the window (z 7.85–8.35, y 1.2–2.0)
  const inDoor = face.filter((v) => near(v.z, 6.1 + TILE_T, 1e-6) && v.x > 2.1 + 1e-3 && v.x < 3.0 - 1e-3 && v.y < 2.1 - 1e-3);
  check('badet: ingen flis i døråpningen', inDoor.length === 0, `${inDoor.length}`);
  const win = bad.filter((v) => near(v.x, 4 - TILE_T, 1e-6) && v.z > 7.85 + 1e-3 && v.z < 8.35 - 1e-3 && v.y > 1.2 + 1e-3 && v.y < 2.0 - 1e-3);
  check('badet: ingen flis i vinduet', win.length === 0, `${win.length}`);
  const vask = tileVerts('vask');
  const sor = vask.filter((v) => near(v.x, 4 - TILE_T, 1e-6));
  const inShower = sor.filter((v) => v.z < 8.6 + 0.9 - 1e-3);
  const wall = H.wallsById['w-vask-sor'];
  const ceilAt = (z) => profileAt(wall.topProfile, z - 8.6) - 0.002;
  check('vaskerommet: i dusjen følger flisa det skrå taket', inShower.length > 0 && Math.abs(Math.max(...inShower.map((v) => v.y)) - ceilAt(8.6)) < 1e-4 && inShower.every((v) => v.y <= ceilAt(v.z) + 1e-4), f2(Math.max(...inShower.map((v) => v.y))));
  const outside = sor.filter((v) => v.z > 8.6 + 0.9 + 1e-3);
  check('vaskerommet: utenfor dusjen 1,2 m', outside.length > 0 && near(Math.max(...outside.map((v) => v.y)), 1.2, 1e-6), f2(Math.max(...outside.map((v) => v.y))));
  const kj = tileVerts('kjokken');
  check('kjøkkenet: flisa bak benken går fra 0,9 til 1,45', kj.length > 0 && near(Math.min(...kj.map((v) => v.y)), 0.9, 1e-6) && near(Math.max(...kj.map((v) => v.y)), 1.45, 1e-6));
}

// ---------------------------------------------------------------------------------------------------------------
section('Bygget');
{
  const byRoom = (id) => {
    let n = 0;
    roots.rooms[id].contents.traverse((m) => m.isMesh && n++);
    return n;
  };
  check('hvert rom har sine faste installasjoner i contents', ['kjokken', 'bad', 'vask'].every((id) => byRoom(id) > 0), ['kjokken', 'bad', 'vask'].map((id) => `${id} ${byRoom(id)}`).join(', '));
  check('den returnerte gruppa er tom (alt er i rommene)', B.group.children.length === 0);
  const ids = new Set(B.colliders.map((c) => c.builtInId));
  const want = ['bi-kj-benk', 'bi-kj-oy', 'bi-kj-hs', 'bi-kj-k', 'bi-kj-f', 'bi-kj-mo', 'bi-kj-overskap', 'bi-bad-dusj', 'bi-bad-kar', 'bi-bad-wc', 'bi-vask-benk', 'bi-vask-vm', 'bi-vask-tt', 'bi-vask-vvb', 'bi-vask-skyllekar'];
  check('kollisjon for benkene, øya, skapene, badekaret, dusjhjørnet og maskinene', want.every((id) => ids.has(id)), want.filter((id) => !ids.has(id)).join());
  check('ingen kollisjon for den åpne dusjen og slukene', !['bi-vask-dusj', 'bi-bad-dusj-sluk', 'bi-vask-dusj-sluk', 'bi-vask-sluk'].some((id) => ids.has(id)));
  // the colliders stay inside their rooms (5 cm) and stand on the floor
  const rooms = Object.fromEntries(H.rooms.map((r) => [r.id, r]));
  const outside = B.colliders.filter((c) => {
    const r = rooms[H.builtIns.find((b) => b.id === c.builtInId)?.roomId];
    const bb = r?.bounds;
    return !bb || c.min.x < bb.minX - 0.05 || c.max.x > bb.maxX + 0.05 || c.min.z < bb.minY - 0.05 || c.max.z > bb.maxY + 0.05 || c.min.y < -1e-6;
  });
  check('kollisjonsboksene står i rommene sine, på gulvet og opp', outside.length === 0, outside.map((c) => c.builtInId).join());
  // the island's worktop at 0.9, the tall units filled to the ceiling (2.4), the wall cabinets 1.45–2.15
  const boxOf = (id) => B.colliders.filter((c) => c.builtInId === id).reduce((a, c) => a.union(c), new THREE.Box3());
  check('øya: 0,9 høy, 2,4 × 0,9', near(boxOf('bi-kj-oy').max.y, 0.9, 1e-6) && near(boxOf('bi-kj-oy').max.z - boxOf('bi-kj-oy').min.z, 2.4, 1e-6));
  check('overskapene: 1,45–2,15', near(boxOf('bi-kj-overskap').min.y, 1.45, 1e-6) && near(boxOf('bi-kj-overskap').max.y, 2.15, 1e-6));
  let tris = 0;
  all.traverse((m) => m.isMesh && (tris += (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3));
  check('trekantbudsjett (alle tre rommene < 250 000)', tris > 1000 && tris < 250000, `${tris}`);
  const [low] = quiet(() => buildBuiltIns({ quality: { level: 'low' }, roots: createHouseRoots(layout, [new THREE.Group()]) }, layout));
  check('«lav» bygger også alt', low.colliders.length === B.colliders.length);
}

// ---------------------------------------------------------------------------------------------------------------
section('Eierens hus');
{
  const OH = ownerLayout.house;
  const op = planBuiltIns(OH);
  check('planen rører ikke eierens oppføringer (samme objekter, samme rekkefølge)', op.list.length === OH.builtIns.length && op.list.every((b, i) => b === OH.builtIns[i]));
  check('eierens hus har ingen fliser', op.tiles.size === 0 && OH.rooms.every((r) => r.wallTiles === null));
  const fp = ownerFingerprint();
  console.log(`       fingeravtrykk: layout ${fp.layout}, rooms ${fp.rooms} (${fp.meshes} mesher) – notes/kjokken-bad-genererte-hus.md har verdiene før og etter`);
}

done();
