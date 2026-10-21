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
// just out of door-ute (hole x 8.67–8.88): past IN_PORTAL but within NEAR_ROOM of the entrance's plan – the outside too
const outDoor = V.cellsAt(g, layout, new THREE.Vector3(9.1, -1.19, 4.31)) || [];
check('just out of door-ute → the entrance and outside', outDoor.includes(V.OUTSIDE) && outDoor.includes('entre-kjeller'), JSON.stringify(outDoor));
for (const x of [8.95, 9.04, 9.08, 9.12, 9.2]) {
  const cs = V.cellsAt(g, layout, new THREE.Vector3(x, -1.2, 4.31)) || [];
  check(`eye x ${x} in front of door-ute → outside is a start`, cs.includes(V.OUTSIDE), JSON.stringify(cs));
}
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

section('The swing of an outer door belongs to its room');
// a stand-in for world/Door.js: root in the door's frame (x along the wall, z into the owner room), one leaf on a pivot
// at the hinge turning to −z (out) by 95°, like door-ute (V27: opens outward)
function fakeDoor(id) {
  const d = layout.house.doors.find((x) => x.id === id);
  const root = new THREE.Group();
  root.matrixAutoUpdate = false;
  root.matrix.makeBasis(d.basis.xAxis, d.basis.yAxis, d.basis.zAxis).setPosition(d.basis.origin);
  const pivot = new THREE.Group();
  const depth = 0.21;
  pivot.position.set(-d.width / 2, 0, -depth);
  const lw = d.leaf?.w ?? d.width - 0.1;
  const leafMesh = new THREE.Mesh(new THREE.BoxGeometry(lw, 2.05, 0.05));
  leafMesh.position.set(lw / 2, 1.03, 0.025);
  pivot.add(leafMesh);
  root.add(pivot);
  root.updateMatrixWorld(true); // as world/Door.js does (matrixAutoUpdate off)
  const door = { t: 0, isOpen: false, root, leaves: [{ pivot, hingeSide: 1 }], openAngle: (95 * Math.PI) / 180, swing: 1, _angleFor: (leaf, t) => t * (95 * Math.PI) / 180 };
  return door;
}
const ute = fakeDoor('door-ute');
const sweep = V.sweptLeafBox(ute);
check('sweptLeafBox: the open leaf reaches a metre out of the wall (x > 9.7)', sweep && sweep.max.x > 9.7, sweep && sweep.max.x.toFixed(2));
check('sweptLeafBox leaves the leaf where it was', Math.abs(ute.leaves[0].pivot.rotation.y) < 1e-9);
const roots2 = createHouseRoots(layout);
roots2.rooms['entre-kjeller'].surfaces.add(ute.root);
roots2.rooms['entre-kjeller'].surfaces.updateWorldMatrix(true, true);
const doors2 = (layout.house.doors || []).map((d) => ({ id: d.id, door: d.id === 'door-ute' ? ute : { t: 0, isOpen: false, root: null } }));
const vis2 = V.createVisibility({ roots: { ...roots2, shell: null, kitchen: null, exterior: null }, doors: doors2, windows: [] }, layout);
const eb = vis2.graph.boxes.get('entre-kjeller');
check("the entrance's box holds door-ute's open leaf", eb && eb.max[0] > 9.7, eb && eb.max[0].toFixed(2));
// standing just past the open door looking south (+x), away from the house: the leaf beside the eye is in view, so
// the entrance is a facade (its surfaces – the leaf – drawn)
ute.t = 1;
ute.isOpen = true;
for (const x of [9.15, 9.25, 9.32]) {
  const c2 = cam(x, -2.86, 4.31, -90);
  const st = V.cellsAt(vis2.graph, layout, c2.position);
  const r2 = V.traverse(vis2.graph, c2, { eye: c2.position, starts: st, isOpen: () => true });
  check(`out of door-ute at x ${x} facing away: the entrance is shown (seen or facade)`, r2.seen.has('entre-kjeller') || r2.facade.has('entre-kjeller'), `starts ${JSON.stringify(st)} seen ${[...r2.seen].join()} facade ${[...r2.facade].join()}`);
}
vis2.dispose();

done();
