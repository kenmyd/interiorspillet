#!/usr/bin/env node
/**
 * Node test for the module skeleton of the house (notes/hele-huset-design.md §2.1, §6 steg 6 S0-stub):
 *   node tools/house-tests/stub.test.mjs        (from the project root; exit code 1 on failure)
 *
 *   • the stubs buildRooms / buildStairs / buildBuiltIns return the build contract { group, walls, windows, doors,
 *     pickables, builtInLights, colliders, update, setPaint, dispose } – empty, so the living room is unchanged;
 *     stairLayout / stairColliders / slabColliders exist; createVisibility hides nothing;
 *   • createHouseRoots: one group per level, one entry per room (group → surfaces + contents) in its level, the
 *     living room's shell and kitchen first in their level – for today's room-spec and for house-mini;
 *   • mergeHouseParts: empty builders leave the shell's own arrays (identity); real lists are appended after the
 *     shell's, pickables per key, builtInLights only in the house list;
 *   • addColliders: Box3 → addStaticBox, Object3D → addStatic;
 *   • home.ceilingHeightAt (homeCeilingHeightAt) passes y on to layout.house and keeps the 2-argument value.
 * createHome itself needs a browser (materials, renderer): the living room's images and dump are checked by
 * tools/refcheck.mjs.
 */
import { imp, readJson, check, section, near, done } from './_lib.mjs';

const THREE = await import('three');
const { buildLayout, LIVING_ROOM_ID } = await imp('src/home/layout.js');
const { buildRooms } = await imp('src/home/rooms.js');
const { buildStairs, stairLayout, stairColliders, slabColliders } = await imp('src/home/stairs.js');
const { buildBuiltIns } = await imp('src/home/builtins.js');
const { createVisibility } = await imp('src/home/visibility.js');
const { createHouseRoots, mergeHouseParts, addColliders, homeCeilingHeightAt } = await imp('src/home/index.js');

/** Merges an overlay onto a spec by id (as tools/house-tests/layout.test.mjs does with house-mini). */
function overlay(base, extra) {
  const out = structuredClone(base);
  for (const [k, v] of Object.entries(extra)) {
    if (k.startsWith('$')) continue;
    if (Array.isArray(v)) {
      const list = Array.isArray(out[k]) ? out[k] : (out[k] = []);
      for (const e of v) {
        const i = e && e.id != null ? list.findIndex((x) => x.id === e.id) : -1;
        if (i >= 0) list[i] = structuredClone(e);
        else list.push(structuredClone(e));
      }
    } else out[k] = structuredClone(v);
  }
  return out;
}
/** Runs fn with console.warn captured; returns [result, warnings]. */
function quiet(fn) {
  const warns = [];
  const orig = console.warn;
  console.warn = (...a) => warns.push(a.join(' '));
  try {
    return [fn(), warns];
  } finally {
    console.warn = orig;
  }
}

const spec = readJson('src/data/room-spec.json');
const palette = readJson('src/data/palette.json');
const mini = readJson('tools/house-tests/fixtures/house-mini.json');
const [today] = quiet(() => buildLayout(structuredClone(spec), palette));
const [house] = quiet(() => buildLayout(overlay(spec, mini), palette));

// ---------------------------------------------------------------------------------------------------------------
section('The build contract of the stubs');
const PICK_KEYS = ['floor', 'walls', 'ceilings', 'windows'];
const LISTS = ['walls', 'windows', 'doors', 'builtInLights', 'colliders'];
const fakeCtx = () => ({ scene: new THREE.Scene(), collision: null, quality: {}, roots: createHouseRoots(house) });
function contractProblems(r, name) {
  const bad = [];
  if (!r || typeof r !== 'object') return [`${name}: no result`];
  if (!r.group?.isGroup) bad.push(`${name}.group is not a THREE.Group`);
  if (r.group?.children?.length) bad.push(`${name}.group is not empty`);
  if (r.group?.parent) bad.push(`${name}.group already has a parent`);
  for (const k of LISTS) if (!Array.isArray(r[k]) || r[k].length) bad.push(`${name}.${k} is not an empty array`);
  if (!r.pickables || PICK_KEYS.some((k) => !Array.isArray(r.pickables[k]) || r.pickables[k].length)) bad.push(`${name}.pickables is not { floor, walls, ceilings, windows } (empty)`);
  for (const k of ['update', 'setPaint', 'dispose']) if (typeof r[k] !== 'function') bad.push(`${name}.${k} is not a function`);
  return bad;
}
for (const [name, build] of [
  ['buildRooms', (ctx, L) => buildRooms(ctx, L, null)],
  ['buildStairs', buildStairs],
  ['buildBuiltIns', buildBuiltIns],
]) {
  for (const [lname, L] of [['today', today], ['house-mini', house]]) {
    const ctx = fakeCtx();
    const [r, warns] = quiet(() => build(ctx, L));
    const bad = contractProblems(r, name);
    check(`${name}(${lname}): empty build contract, nothing added to the scene or the roots`, !bad.length && !warns.length && ctx.scene.children.length === 0
      && Object.values(ctx.roots.rooms).every((rm) => !rm.surfaces.children.length && !rm.contents.children.length), [...bad, ...warns].join(' | '));
    const g = r.group;
    ctx.scene.add(g);
    r.update(1 / 60, {});
    r.setPaint('w-hoy', '#ffffff');
    r.dispose();
    check(`${name}(${lname}): update / setPaint are no-ops, dispose takes the group out of the scene`, !g.parent);
  }
}
const st = house.house.stairs[0];
const lay = stairLayout(st, house.house.levels);
check('stairLayout / stairColliders / slabColliders exist (stub: no treads, no colliders yet)', lay.id === st.id && lay.stair === st && Array.isArray(lay.treads)
  && Array.isArray(stairColliders(lay)) && Array.isArray(slabColliders(house, 'hoved')), JSON.stringify({ id: lay.id }));

const fakeHome = { roots: createHouseRoots(house), doors: [], lighting: null };
const vis = createVisibility(fakeHome, house);
const visKeys = ['update', 'setOverview', 'refresh', 'levelVisible', 'contentsVisible', 'dispose'];
vis.update(1 / 60, { camera: new THREE.PerspectiveCamera(), playerPosition: new THREE.Vector3(1.3, -2.55, 6.4) });
vis.setOverview(true);
vis.refresh();
check('createVisibility: the API, hides nothing (every level and room content stays visible)', visKeys.every((k) => typeof vis[k] === 'function') && vis.enabled === false
  && house.house.levels.every((lv) => vis.levelVisible(lv.id)) && house.house.rooms.every((rm) => vis.contentsVisible(rm.id))
  && Object.values(fakeHome.roots.levels).every((g) => g.visible) && Object.values(fakeHome.roots.rooms).every((rm) => rm.group.visible && rm.contents.visible));
vis.dispose();

// ---------------------------------------------------------------------------------------------------------------
section('roots.levels / roots.rooms (createHouseRoots)');
{
  const shellG = new THREE.Group();
  const kitchenG = new THREE.Group();
  const R = createHouseRoots(today, [shellG, kitchenG]);
  const hoved = R.levels.hoved;
  const room = R.rooms[LIVING_ROOM_ID];
  check('today: one level «hoved», one room «stue-kjokken»', Object.keys(R.levels).join() === 'hoved' && Object.keys(R.rooms).join() === LIVING_ROOM_ID, `${Object.keys(R.levels)} / ${Object.keys(R.rooms)}`);
  check('today: hoved = [shell, kitchen, room:stue-kjokken] in this order (the scene is traversed as before)', hoved.children.length === 3 && hoved.children[0] === shellG && hoved.children[1] === kitchenG && hoved.children[2] === room.group);
  check('today: room:stue-kjokken → surfaces + contents, empty, names and userData', room.group.name === 'room:stue-kjokken' && room.group.children[0] === room.surfaces && room.group.children[1] === room.contents
    && room.surfaces.name === 'room:stue-kjokken:surfaces' && room.contents.name === 'room:stue-kjokken:contents' && !room.surfaces.children.length && !room.contents.children.length
    && room.group.userData.roomId === LIVING_ROOM_ID && hoved.userData.levelId === 'hoved' && hoved.name === 'level:hoved' && room.levelId === 'hoved' && room.kind === 'living' && room.hud === false);
  check('today: identity transforms (no world offset for anything put in a root)', [hoved, room.group, room.surfaces, room.contents].every((g) => g.position.lengthSq() === 0 && g.quaternion.w === 1 && g.scale.x === 1));
}
{
  const R = createHouseRoots(house, [new THREE.Group()]);
  const H = house.house;
  check('house-mini: a group per level, top → bottom', Object.keys(R.levels).join() === H.levels.map((l) => l.id).join() && H.levels.length === 2, Object.keys(R.levels).join());
  check('house-mini: an entry per room (hud rooms included), each in its level', H.rooms.every((rm) => R.rooms[rm.id]?.group.parent === R.levels[rm.levelId] && R.rooms[rm.id].levelId === rm.levelId && R.rooms[rm.id].name === rm.name)
    && Object.keys(R.rooms).length === H.rooms.length, Object.keys(R.rooms).join());
  check('house-mini: the hud room (trapp) is flagged, the basement rooms are in level:kjeller', R.rooms.trapp?.hud === true && R.rooms['kjeller-gang']?.group.parent === R.levels.kjeller && R.rooms.bad?.kind === 'bathroom');
  check('house-mini: the lead object is the first child of the living room\'s level', R.levels.hoved.children[0].isGroup && !R.levels.hoved.children[0].name && R.levels.kjeller.children.every((c) => c.name.startsWith('room:')));
}
{
  const R = createHouseRoots({ ceilingHeightAt: () => 2.4 }, [new THREE.Group()]);
  check('a layout without house: hoved + stue-kjokken', Object.keys(R.levels).join() === 'hoved' && Object.keys(R.rooms).join() === LIVING_ROOM_ID && R.levels.hoved.children.length === 2);
}

// ---------------------------------------------------------------------------------------------------------------
section('Merging into home.* (mergeHouseParts, addColliders)');
const fakeShell = () => ({
  walls: [{ id: 'w-hoy' }],
  windows: [{ id: 'win-s1', anchor: new THREE.Group() }],
  doors: [{ id: 'door-gang' }],
  pickables: { floor: [new THREE.Mesh()], walls: [new THREE.Mesh()], ceilings: [], windows: [] },
});
{
  const shell = fakeShell();
  const lights = [{ id: 'l1' }, { id: 'k1' }];
  const empty = [buildRooms({}, today), buildStairs({}, today), buildBuiltIns({}, today)];
  const m = mergeHouseParts(shell, empty, lights);
  check('empty builders: walls / windows / doors / pickables are the shell\'s own objects', m.walls === shell.walls && m.windows === shell.windows && m.doors === shell.doors && m.pickables === shell.pickables);
  check('empty builders: builtInLights = the living room\'s, colliders empty', m.builtInLights.length === 2 && m.builtInLights[0] === lights[0] && m.builtInLights !== lights && m.colliders.length === 0);
}
{
  const shell = fakeShell();
  const box = new THREE.Box3(new THREE.Vector3(0, -0.3, 0), new THREE.Vector3(3, 0, 4));
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
  const part = {
    walls: [{ id: 'w-bad-n' }],
    windows: [{ id: 'win-bad' }],
    doors: [{ id: 'door-bad' }],
    pickables: { floor: [new THREE.Mesh()], walls: [], ceilings: [new THREE.Mesh()], windows: [], builtIns: [new THREE.Mesh()] },
    builtInLights: [{ id: 'l-bad' }],
    colliders: [box, mesh],
  };
  const m = mergeHouseParts(shell, [part, { walls: [{ id: 'w-trapp' }] }], [{ id: 'l1' }]);
  check('real lists are appended after the shell\'s (shell arrays untouched)', m.walls.map((w) => w.id).join() === 'w-hoy,w-bad-n,w-trapp' && m.windows.map((w) => w.id).join() === 'win-s1,win-bad'
    && m.doors.map((d) => d.id).join() === 'door-gang,door-bad' && shell.walls.length === 1 && shell.windows.length === 1);
  check('pickables merged per key, new keys kept', m.pickables !== shell.pickables && m.pickables.floor.length === 2 && m.pickables.floor[0] === shell.pickables.floor[0] && m.pickables.ceilings.length === 1
    && m.pickables.walls.length === 1 && m.pickables.builtIns?.length === 1 && shell.pickables.floor.length === 1);
  check('builtInLights: the living room\'s first, then the builders\' (home.house only)', m.builtInLights.map((l) => l.id).join() === 'l1,l-bad');
  const calls = [];
  const fakeCollision = { addStatic: (o) => calls.push(['static', o]), addStaticBox: (b) => calls.push(['box', b]) };
  addColliders(fakeCollision, m.colliders);
  addColliders(null, m.colliders);
  addColliders(fakeCollision, undefined);
  addColliders(fakeCollision, null);
  check('addColliders: Box3 → addStaticBox, Object3D → addStatic, no collision world → nothing', calls.length === 2 && calls[0][0] === 'box' && calls[0][1] === box && calls[1][0] === 'static' && calls[1][1] === mesh);
}

// ---------------------------------------------------------------------------------------------------------------
section('home.ceilingHeightAt passes y on');
{
  const f = homeCeilingHeightAt(today);
  check('today: home.ceilingHeightAt is layout.ceilingHeightAt itself (dev warnings name the real call site)', f === today.ceilingHeightAt);
  const g = homeCeilingHeightAt(house);
  const H = house.house;
  const pts = [[4.5, 1.5], [3.0, 8.0], [6.0, 10.5]];
  check('2 arguments: the living room\'s ceiling, as before', pts.every(([x, z]) => g(x, z) === today.ceilingHeightAt(x, z)));
  check('3 arguments: layout.house.ceilingHeightAt (world y) – living room, bathroom, basement, stairwell', [[4.5, 0, 1.5], [1.2, 0.5, 1.1], [3.5, -1.5, 3.8], [0.8, -1.5, 3.0]].every(([x, y, z]) => g(x, z, y) === H.ceilingHeightAt(x, z, y))
    && near(g(4.5, 1.5, 0.5), today.ceilingHeightAt(4.5, 1.5), 1e-12) && g(3.5, 3.8, -2.0) < 0, `${g(3.5, 3.8, -2.0)}`);
  // an older layout whose ceilingHeightAt takes (x, z) only
  const old = { ceilingHeightAt: (x, z) => 2.4 + 0 * x * z, house: { ceilingHeightAt: (x, z, y) => y + 1 } };
  const w = homeCeilingHeightAt(old);
  check('a 2-argument layout function gets a wrapper: y → house, no y → the living room', w !== old.ceilingHeightAt && w(1, 1) === 2.4 && w(1, 1, null) === 2.4 && near(w(1, 1, -2.55), -1.55, 1e-12));
  check('a layout without house keeps its own function', homeCeilingHeightAt({ ceilingHeightAt: old.ceilingHeightAt }) === old.ceilingHeightAt);
}

done();
