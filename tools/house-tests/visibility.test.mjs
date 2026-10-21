// Visibility (steg 29 Y1, notes/hele-huset-design.md §4.12): the portal graph of the house and the walk from the
// camera's cell, in Node with the real layout (src/data/room-spec.json) and a real PerspectiveCamera. The browser
// side (what is hidden, the pixel check culled vs. full) is tools/perf.mjs --only=check.
import { imp, check, section, done } from './_lib.mjs';

const THREE = await import('three');
const { layout } = await imp('src/home/layout.js');
const V = await imp('src/home/visibility.js');
const { createHouseRoots } = await imp('src/home/index.js');

const DEG = Math.PI / 180;
const g = V.visibilityGraph(layout);

section('Graph');
check('graph built', !!g);
const ids = new Set(g.portals.map((p) => p.id));
for (const id of ['door-gang', 'door-bad', 'door-soverom', 'open-entre', 'door-ute', 'win-s1', 'win-ks-1']) check(`portal ${id}`, ids.has(id));
const holes = g.portals.filter((p) => p.kind === 'hole');
check('the stairwell is a portal gang ↔ kjeller-gang', holes.length >= 1 && holes.every((p) => [p.a, p.b].sort().join() === 'gang,kjeller-gang'), JSON.stringify(holes.map((p) => [p.a, p.b])));
check('door-terrasse (glazed) is always open glass', g.portals.find((p) => p.id === 'door-terrasse')?.kind === 'glass');
check('windows lead outside', g.portals.filter((p) => p.kind === 'window').every((p) => p.a === V.OUTSIDE || p.b === V.OUTSIDE));
check('every portal knows both sides', g.portals.every((p) => p.side && p.side[p.a] && p.side[p.b] && p.side[p.a] === -p.side[p.b]), g.portals.filter((p) => !(p.side?.[p.a] && p.side?.[p.b])).map((p) => p.id).join());
check('the hall depends on the living room (w-gang, door-gang)', g.deps.get('gang')?.has('stue-kjokken'));
check('the living room depends only on its neighbours (bad, gang, soverom)', [...(g.deps.get('stue-kjokken') || [])].sort().join() === 'bad,gang,soverom', [...(g.deps.get('stue-kjokken') || [])].join());
check('no dependency across levels', [...g.deps].every(([a, s]) => [...s].every((b) => layout.house.roomsById[a].levelId === layout.house.roomsById[b].levelId)));
check('the stair follows gang and kjeller-gang only', JSON.stringify(g.hudLinks.get('trapp')) === JSON.stringify(['gang', 'kjeller-gang']), JSON.stringify(g.hudLinks.get('trapp')));

function cam(x, feet, z, yaw, pitch = 0) {
  const c = new THREE.PerspectiveCamera(70, 4 / 3, 0.05, 200);
  c.rotation.order = 'YXZ';
  c.position.set(x, feet + 1.66, z);
  c.rotation.set(pitch * DEG, yaw * DEG, 0);
  c.updateMatrixWorld();
  return c;
}
const walk = (c, open = () => false) => {
  const starts = V.cellsAt(g, layout, c.position);
  return { starts, ...V.traverse(g, c, { eye: c.position, starts, isOpen: (p) => p.kind !== 'door' || open(p) }) };
};

section('Cells');
check('dining area → stue-kjokken', JSON.stringify(V.cellsAt(g, layout, new THREE.Vector3(4.2, 1.66, 4.0))) === '["stue-kjokken"]');
check('hall → gang', JSON.stringify(V.cellsAt(g, layout, new THREE.Vector3(2.6, 1.66, 3.2))) === '["gang"]');
check('basement hall → kjeller-gang', JSON.stringify(V.cellsAt(g, layout, new THREE.Vector3(3.5, -0.89, 3.8))) === '["kjeller-gang"]');
const dg = layout.house.openingsById['door-gang'];
const inDoor = V.cellsAt(g, layout, dg.center.clone().setY(1.5));
check('in the doorway of door-gang → both rooms', inDoor?.length === 2 && inDoor.includes('gang') && inDoor.includes('stue-kjokken'), JSON.stringify(inDoor));
check('in the stairwell slab → both halls', (V.cellsAt(g, layout, new THREE.Vector3(0.9, -0.15, 3.3)) || []).sort().join() === 'gang,kjeller-gang');
check('the forecourt → outside', JSON.stringify(V.cellsAt(g, layout, new THREE.Vector3(12.2, -1.2, 4.6))) === JSON.stringify([V.OUTSIDE]));
check('above the house (overview) → null', V.cellsAt(g, layout, new THREE.Vector3(3, 9, 5)) === null);

section('Walk');
const spawnYaw = Math.atan2(-(6.2 - 4.2), -(10.3 - 4.0)) / DEG;
let r = walk(cam(4.2, 0, 4.0, spawnYaw, -3));
check('spawn, doors shut: only the living room is seen', [...r.seen].join() === 'stue-kjokken', [...r.seen].join());
check('spawn: the outside is seen through the windows', r.outside);
check('spawn: the basement rooms under the deck are at most facades', ![...r.seen].some((id) => layout.house.roomsById[id].levelId === 'kjeller'));
r = walk(cam(2.6, 0, 3.2, 90));
check('hall looking north: hall + basement hall (stairwell), not the living room', r.seen.has('gang') && r.seen.has('kjeller-gang') && !r.seen.has('stue-kjokken'), [...r.seen].join());
check('hall looking north, doors shut: no outside', !r.outside);
r = walk(cam(2.6, 0, 3.2, -90));
check('hall looking south (door-gang shut): the stairwell is behind → no basement', !r.seen.has('kjeller-gang'), [...r.seen].join());
r = walk(cam(2.6, 0, 3.2, -90), () => true);
check('hall looking south, doors open: living room and bedroom', r.seen.has('stue-kjokken') && r.seen.has('soverom'), [...r.seen].join());
r = walk(cam(3.6, 0, 3.9, 90, -20), () => true);
check('living room through the open door-gang: the hall', r.seen.has('gang'), [...r.seen].join());
r = walk(cam(3.5, -2.55, 3.8, 90, 8));
check('basement hall: up the stairwell into the hall', r.seen.has('gang'), [...r.seen].join());
r = walk(cam(12.2, -2.87, 4.6, 85, -6));
check('forecourt: the front of the house is seen, the bedroom behind the north wall is not', r.outside && r.facade.has('entre-kjeller') && !r.seen.has('soverom'), `seen ${[...r.seen].join()} facade ${[...r.facade].join()}`);
check('forecourt: a portal is never passed from its far side (no room behind the north wall)', !r.seen.has('bad'), [...r.seen].join());

section('createVisibility without a scene');
const roots = createHouseRoots(layout);
// every door shut (a door the module does not know counts as open)
const doors = (layout.house.doors || []).map((d) => ({ id: d.id, door: { t: 0, isOpen: false, root: null } }));
const vis = V.createVisibility({ roots: { ...roots, shell: null, kitchen: null, exterior: null }, doors, windows: [] }, layout);
check('enabled with house data', vis.enabled === true);
const c = cam(4.2, 0, 4.0, spawnYaw, -3);
vis.update(1 / 60, { camera: c }); // no player: the sandbox – nothing hidden without ?vis=1
check('no player → nothing hidden', Object.values(roots.levels).every((l) => l.visible) && Object.values(roots.rooms).every((x) => x.contents.visible && x.surfaces.visible));
vis.update(1 / 60, { camera: c, player: {} });
check('player in the dining area → the bedroom contents hidden', roots.rooms.soverom.contents.visible === false && vis.contentsVisible('soverom') === false);
check('player in the dining area → the living room shown', vis.contentsVisible('stue-kjokken') && roots.levels.hoved.visible);
check('player in the dining area → the basement level hidden unless a facade is seen', roots.levels.kjeller.visible === Object.values(roots.rooms).some((x) => x.levelId === 'kjeller' && x.surfaces.visible));
vis.setOverview(true);
vis.update(1 / 60, { camera: c, player: {} });
check('overview → everything shown', Object.values(roots.levels).every((l) => l.visible) && Object.values(roots.rooms).every((x) => x.contents.visible && x.surfaces.visible));
vis.setOverview(false);
vis.update(1 / 60, { camera: cam(3.5, -2.55, 6.2, 180), player: {} });
check('player in the basement living room → the bathroom contents hidden', roots.rooms.bad.contents.visible === false);
vis.dispose();
check('dispose shows everything again', Object.values(roots.levels).every((l) => l.visible) && Object.values(roots.rooms).every((x) => x.contents.visible && x.surfaces.visible));

done();
