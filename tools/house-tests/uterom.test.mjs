#!/usr/bin/env node
/**
 * Node test for the outdoor rooms (notes/uterom.md: rooms[].outdoor – a carport, an open garage, a porch):
 *   node tools/house-tests/uterom.test.mjs        (from the project root; exit code 1 on failure)
 *
 * Builds the test house of dev/uterom.html (src/dev/uterom-hus.js: a carport under a terrace and a porch under the
 * upper floor) with buildLayout + buildRooms and checks:
 *   • the model (layout.js): the rooms' outdoor kind, the outer doors (also through a wall that is no exterior wall,
 *     and the one owned by the carport, seen from the bod), the lamps (a plafond in an outdoor room is a downlight,
 *     their groups on in the evening), a cladding zone on the carport's wall;
 *   • in 3D: rays inside the carport and the porch hit facade (the zone's grey panels on the bod front, the default
 *     boards on the house's walls), the indoor sides stay painted, no painted face of the outdoor rooms, the soffits,
 *     the floors (concrete, paving), no skirting or ceiling trim, the turned door's frame (its outer face toward the
 *     carport), the footsteps;
 *   • no two faces facing the same way overlap in one plane (the cladding inside, its boards, the decks);
 *   • the acoustics: the outdoor rooms count as outside;
 *   • validateHouse knows the field (the enum, the floor, the soffit, a way out, a plafond) and the house validates;
 *   • the owner's house is unchanged (owner-fingerprint.mjs).
 */
import { imp, check, section, near, done, coplanarOverlaps } from './_lib.mjs';

const THREE = await import('three');
(await imp('src/home/materials.js')).configureMaterials({ textureRes: 0.125 });
const { buildLayout, layout: ownerLayout } = await imp('src/home/layout.js');
const { buildRooms } = await imp('src/home/rooms.js');
const { createHouseRoots } = await imp('src/home/index.js');
const { uteromHus, uteromSpec } = await imp('src/dev/uterom-hus.js');
const { itemRoomId, computeAcoustics } = await imp('src/design/Acoustics.js');
const house = await imp('src/data/scripts/house.mjs');
const { ownerFingerprint } = await imp('tools/house-tests/owner-fingerprint.mjs');

const GREY = '#6f7377';
const BROWN = '#8a6a4f';
const h = uteromHus();
const spec = uteromSpec(h.house);
const layout = buildLayout(spec, undefined, { devWarnings: false });
const H = layout.house;
const zones = [];
const roots = createHouseRoots(layout, [new THREE.Group()]);
const R = buildRooms({ scene: new THREE.Scene(), quality: {}, roots, collision: { addSurfaceZone: (box, s) => zones.push({ box, s }), addDynamicBox: (b) => ({ box: b }), removeDynamic() {} } }, layout, null);
const all = new THREE.Group();
for (const g of Object.values(roots.levels)) all.add(g);
if (R.group) all.add(R.group);
all.updateMatrixWorld(true);
const meshes = [];
all.traverse((m) => m.isMesh && m.visible && meshes.push(m));

/** The first hit of a ray from `from` along `dir` among the house's visible meshes, with its material. */
function hit(from, dir) {
  const rc = new THREE.Raycaster(new THREE.Vector3(...from), new THREE.Vector3(...dir).normalize(), 0, 30);
  const x = rc.intersectObjects(meshes, false)[0] ?? null;
  if (!x) return null;
  const m = Array.isArray(x.object.material) ? x.object.material[x.face?.materialIndex ?? 0] : x.object.material;
  return { ...x, mat: m, kind: m?.userData?.kind ?? m?.name ?? '', hex: m?.userData?.hex ?? (m?.color ? `#${m.color.getHexString()}` : '') };
}
const desc = (x) => (x ? `${x.object.name} ${x.kind} ${x.hex} @${x.distance.toFixed(3)}` : 'ingenting');
const named = (re) => meshes.filter((m) => re.test(m.name));

section('Modellen (layout.js)');
{
  const kinds = Object.fromEntries(H.rooms.filter((r) => !r.hud).map((r) => [r.id, r.outdoor]));
  check('rooms[].outdoor: the porch and the carport are outside, the other rooms are not', kinds['f-port'] === 'porch' && kinds['f-carport'] === 'carport' && ['f-stue', 'f-gang', 'f-bod', 'f-sov'].every((id) => kinds[id] === null), JSON.stringify(kinds));
  const door = (a, b) => H.doors.find((d) => d.connects.includes(a) && d.connects.includes(b));
  const st = door('f-stue', 'f-carport'), bd = door('f-carport', 'f-bod'), fr = door('f-gang', 'f-port'), inner = door('f-stue', 'f-gang'), ter = door('f-sov', 'ute');
  check('a door between an outdoor and an indoor room is an outer door, in a wall that is no exterior wall', st.outer === true && bd.outer === true && fr.outer === true && !H.wallsById[st.wallId].exterior && !H.wallsById[bd.wallId].exterior);
  check('… its outer face is the owner\'s front only when the owner is the outdoor room (the bod door, owned by the carport)', bd.outsideFront === true && st.outsideFront === false && fr.outsideFront === false);
  check('other doors keep the wall rule (outer null): stue ↔ gang, and the terrace door in its exterior wall', inner.outer === null && ter.outer === null);
  const l = Object.fromEntries(H.builtInLights.map((x) => [x.id, x]));
  check('a plafond in the carport is a downlight in its soffit (350–800 lm); the plafonds indoors stay', l['l-f-carport-2'].type === 'downlight' && l['l-f-carport-2'].lumens === 800 && near(l['l-f-carport-2'].position.y, 2.3, 1e-9) && l['l-f-bod'].type === 'plafond' && l['l-f-stue'].type === 'plafond');
  const g = Object.fromEntries(H.lightGroups.map((x) => [x.id, x]));
  check('the outdoor rooms\' lamps are outdoor lights: their groups default to auto «evening», the indoor ones not', g['f-carport'].auto === 'evening' && g['f-port'].auto === 'evening' && g['f-bod'].auto === null && g['f-stue'].auto === null);
  check('the cladding zone on the carport\'s wall (the bod front) is accepted, the soffits are kept', H.cladding.zones[0].walls.includes('w-f-carport-n') && H.roomsById['f-port'].soffit?.color === '#ece9e3' && H.roomsById['f-carport'].soffit === null);
}

section('Kledning, ikke maling (rooms.js + cladding.js)');
{
  // the carport: x 7.0–12.7, z 0.3–5.35, floor 0, soffit 2.3; the bod front at z 5.35 (its door x 9.8–10.7)
  const front = hit([8.4, 1.2, 2.5], [0, 0, 1]);
  check(`the bod front seen from the carport is the zone's grey facade panels (${desc(front)})`, front?.kind === 'facade-panels' && front.hex === GREY && near(front.point.z, 5.35, 0.003));
  const house_ = hit([9.5, 1.2, 2.5], [-1, 0, 0]);
  check(`the house's wall seen from the carport (the back of the stue's slab, the carport's backOf face) is the default boards (${desc(house_)})`, house_?.kind === 'facade-wood' && house_.hex === BROWN && near(house_.point.x, 7.0, 0.003));
  const east = hit([9.5, 1.2, 2.5], [1, 0, 0]);
  check(`the carport's own exterior wall inside is boards too (${desc(east)})`, east?.kind === 'facade-wood' && near(east.point.x, 12.7, 0.003));
  const beam = hit([9.5, 2.2, 2.5], [0, 0, -1]);
  check(`over the carport's open side: the beam's inside is boards (${desc(beam)})`, beam?.kind === 'facade-wood' && near(beam.point.z, 0.3, 0.003));
  const jamb = hit([12.5, 1.0, 0.15], [1, 0, 0]);
  const jambOut = hit([12.5, 1.0, 0.02], [1, 0, 0]);
  check(`the open side's reveal (the jamb, inner and outer layer) is in the trim colour, not painted (${desc(jamb)} / ${desc(jambOut)})`, jamb?.hex === '#3a3633' && jambOut?.hex === '#3a3633' && near(jamb.point.x, 12.69, 0.003));
  const bodIn = hit([8.4, 1.2, 6.6], [0, 0, -1]);
  check(`the bod front seen from the bod is painted (its own face, ${desc(bodIn)})`, /^wall:w-f-bod-s$/.test(bodIn?.object.name ?? '') && !/^facade-/.test(bodIn.kind));
  const stueIn = hit([5.5, 1.2, 2.5], [1, 0, 0]);
  check(`the stue's wall to the carport is painted inside the stue (${desc(stueIn)})`, stueIn?.object.name === 'wall:w-f-stue-o');
  const porch = hit([0.7, 1.2, 1.0], [0, 0, 1]);
  check(`the porch: the hall's front wall (the hall's slab, the porch's backOf face) is boards (${desc(porch)})`, porch?.kind === 'facade-wood' && near(porch.point.z, 1.8, 0.003));
  const porchE = hit([1.6, 1.2, 1.0], [1, 0, 0]);
  check(`the porch: the stue's wall is boards (${desc(porchE)})`, porchE?.kind === 'facade-wood' && near(porchE.point.x, 3.0, 0.003));
  const painted = ['w-f-carport-n', 'w-f-carport-v', 'w-f-carport-o', 'w-f-carport-s', 'w-f-port-n', 'w-f-port-o', 'w-f-port-s', 'w-f-port-v'].filter((id) => named(new RegExp(`^wall:${id}$`)).length);
  check('no painted wall face in the outdoor rooms (no wall:<id> mesh, nothing to repaint)', !painted.length, painted.join(', '));
  // the plinth band at the foot of the bod front (ground −0.15 + 0.3)
  const foot = hit([8.4, 0.08, 2.5], [0, 0, 1]);
  check(`the plinth runs along the foot of the bod front (${desc(foot)})`, foot?.kind === 'facade-concrete' || /plinth|concrete/.test(foot?.kind ?? ''));
  // the surround round the bod door in the door's own frame colour (grey), in front of the panels
  const sur = hit([10.75, 1.0, 2.5], [0, 0, 1]);
  check(`the bod door's surround is grey (its frame colour), 22 mm in front of the panels (${desc(sur)})`, sur?.hex === GREY && near(sur.point.z, 5.35 - 0.022, 0.003));
}

section('Himling, gulv, lister, dører');
{
  const up = hit([9.5, 1.2, 2.5], [0, 1, 0]);
  check(`the carport's ceiling is a soffit: boards in the cladding's colour, at 2.3 (${desc(up)})`, up?.object.name === 'ceiling:c-f-carport' && up.kind === 'facade-wood' && up.hex === BROWN && near(up.point.y, 2.3, 1e-3));
  const upP = hit([1.6, 1.2, 1.0], [0, 1, 0]);
  check(`the porch's soffit under the upper floor: white boards (rooms[].soffit) at 2.5 (${desc(upP)})`, upP?.object.name === 'ceiling:c-f-port' && upP.kind === 'facade-wood' && upP.hex === '#ece9e3' && near(upP.point.y, 2.5, 1e-3));
  const down = hit([9.5, 1.2, 2.5], [0, -1, 0]);
  check(`the carport's floor is cast concrete (${desc(down)})`, down?.object.name === 'floor:f-carport' && down.kind === 'facade-concrete');
  const downP = hit([1.6, 1.2, 1.0], [0, -1, 0]);
  check(`the porch's floor is paving (${desc(downP)})`, downP?.object.name === 'floor:f-port' && downP.kind === 'tiles');
  const bodFloor = hit([9.5, 1.2, 6.6], [0, -1, 0]);
  check('the bod\'s concrete floor indoors is painted as before (no texture)', bodFloor?.object.name === 'floor:f-bod' && !/^facade-/.test(bodFloor.kind));
  // no skirting and no ceiling trim in the outdoor rooms: a ray along the bod front at skirting height hits nothing near
  const skirt = hit([8.0, 0.12, 5.344], [0, -1, 0]);
  check(`no skirting board along the bod front in the carport: straight down onto the floor (${desc(skirt)})`, skirt?.object.name === 'floor:f-carport');
  const skirtBod = hit([8.0, 0.3, 5.506], [0, -1, 0]);
  check(`… the bod has its skirting on the same wall (${desc(skirtBod)})`, !!skirtBod && skirtBod.object.name !== 'floor:f-bod' && near(skirtBod.point.y, 0.07, 0.005));
  // the doors: the bod door (owned by the carport's wall) is built from the bod's side, its outer face toward the carport
  const D = Object.fromEntries(R.doors.map((d) => [d.connects.slice().sort().join('|'), d]));
  const bd = D['f-bod|f-carport'];
  const e = bd.door.matrix.elements;
  check(`the bod door is turned: origin on the bod's face (z ${e[14].toFixed(3)}), z toward the bod – its outer face toward the carport`, near(e[14], 5.5, 1e-6) && near(e[10], 1, 1e-9) && bd.roomId === 'f-carport');
  const leaf = hit([10.25, 1.0, 2.5], [0, 0, 1]);
  check(`the bod door's leaf is grey (${desc(leaf)})`, leaf?.hex === GREY);
  check('the footsteps in the outdoor rooms sound like the paving outside (tile)', zones.filter((z) => z.s === 'tile').length >= 2 && zones.some((z) => z.s === 'tile' && z.box.containsPoint(new THREE.Vector3(9.5, 0.5, 2.5))) && zones.some((z) => z.s === 'tile' && z.box.containsPoint(new THREE.Vector3(1.6, 0.5, 1.0))));
  const lamps = R.builtInLights.filter((l) => l.roomId === 'f-carport');
  check('the carport has two downlights (fittings in the soffit), no plafond', lamps.length === 2 && lamps.every((l) => l.fitting === 'downlight'));
}

section('Ingen flater i samme plan');
{
  const skip = (m) => /^(cover:|room-walls:|leaf:)/.test(m.name);
  const r = await coplanarOverlaps(all, { skip, minArea: 2e-6 });
  check(`no overlapping faces in one plane among ${r.triangles} triangles (the cladding inside, its boards, the soffits, the deck)`, !r.bad.length, r.bad.slice(0, 12).join('\n         '));
}

section('Akustikk');
{
  check('an item in the carport or the porch counts nowhere (outside)', itemRoomId({ position: [9.5, 0, 2.5], level: 'hoved' }, layout) === null && itemRoomId({ position: [1.6, 0, 1.0], level: 'hoved' }, layout) === null);
  check('… an item in the bod counts in the bod', itemRoomId({ position: [9.5, 0, 6.6], level: 'hoved' }, layout) === 'f-bod');
  check('the carport has no acoustics of its own (as outside: the living room\'s)', computeAcoustics({ items: [] }, layout, { roomId: 'f-carport' }).roomId !== 'f-carport');
}

section('Validatoren');
{
  const full = house.loadRegistry();
  const reg = { schema: full.schema, pseudoRooms: full.pseudoRooms };
  const v = (s) => house.validateHouse(s, { registry: reg, throw: false });
  const errs = (r) => r.errors.filter((m) => !/rommet «stue-kjokken» mangler/.test(m));
  const r0 = v(spec);
  const plafond = r0.warnings.filter((m) => /builtInLights\/l-f-carport-2: en taklampe i uterommet/.test(m));
  check('the test house validates: no errors, one warning (the plafond in the carport)', !errs(r0).length && plafond.length === 1 && r0.warnings.length === 1, [...errs(r0), ...r0.warnings].slice(0, 8).join('\n         '));
  const withH = (f) => {
    const s = uteromSpec(JSON.parse(JSON.stringify(h.house)));
    f(s);
    return v(s);
  };
  const room = (s, id) => s.rooms.find((x) => x.id === id);
  const has = (r, re, kind = 'errors') => (kind === 'errors' ? errs(r) : r.warnings).some((m) => re.test(m));
  check('an unknown outdoor kind is an error (the schema\'s enum)', has(withH((s) => (room(s, 'f-carport').outdoor = 'garden')), /rooms\/f-carport: outdoor «garden» er ikke en av carport, garage, porch/));
  check('an outdoor room with a wooden floor is a warning', has(withH((s) => (room(s, 'f-carport').floor = { material: 'oak-plank', color: '#b8a48c' })), /rooms\/f-carport: uterommet har gulvet «oak-plank»/, 'warnings'));
  check('a bad soffit is an error (type, colour)', has(withH((s) => (room(s, 'f-port').soffit = { type: 'gips' })), /soffit.type «gips»/) && has(withH((s) => (room(s, 'f-port').soffit = { color: 'hvit' })), /soffit.color må være #rrggbb/));
  check('a soffit on an indoor room is a warning (not used)', has(withH((s) => (room(s, 'f-bod').soffit = { type: 'boards' })), /rooms\/f-bod: soffit gjelder bare uterom/, 'warnings'));
  check('an outdoor room with no way out is a warning', has(withH((s) => s.walls.find((w) => w.id === 'w-f-carport-s').openings.splice(0)), /rooms\/f-carport: uterommet har ingen åpning eller dør ut/, 'warnings'));
  check('a cladding zone on an inner wall that faces no outdoor room is still an error', has(withH((s) => s.cladding.zones.push({ id: 'inne', walls: ['w-f-stue-v'], type: 'panels' })), /w-f-stue-v er ikke en yttervegg/));
}

section('Eierens hus');
{
  const OH = ownerLayout.house;
  check('the owner\'s house has no outdoor rooms and no outer doors from them', OH.rooms.every((r) => r.outdoor === null) && OH.doors.every((d) => d.outer === null && d.outsideFront === false));
  const fp = ownerFingerprint();
  console.log(`       fingeravtrykk: layout ${fp.layout}, rooms ${fp.rooms} (${fp.meshes} mesher)`);
  check('the owner\'s fingerprint is as before (layout 9fd8f7a355b0f410, rooms a7cf211c026c6559, 301 meshes)', fp.layout === '9fd8f7a355b0f410' && fp.rooms === 'a7cf211c026c6559' && fp.meshes === 301);
}

done();
