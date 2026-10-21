#!/usr/bin/env node
/**
 * Node test for the level / room API of src/home/layout.js (notes/hele-huset-design.md §1.8, step 4 S0-layout):
 *   node tools/house-tests/layout.test.mjs        (from the project root; exit code 1 on failure)
 *
 * Builds the layout of today's living room (research/room-spec.json + the 00-files) and of house-mini (the fixture overlay merged onto it: a bathroom and hall
 * with backOf faces, doors, a frosted window, the stair hole + stair, a hud room, the basement level at −2.55 and an
 * entrance 0.30 lower) and checks:
 *   • the living room is unchanged: every old top-level field deep-equal (only the door's derived connects /
 *     interactive / opensInto may change when a neighbour room appears), volume 138.57, floor 53.78, 12 walls,
 *     6 windows, the six light groups, ceilingHeightAt(x, z) = house.ceilingHeightAt(x, z, 0) in the living room;
 *   • the old fields never see another room; layout.house sees every entry, the living room's by identity;
 *   • levels (synthesised ground floor, levelAt with hysteresis), rooms (areas, roomAt physical / HUD), wall loops,
 *     backOf faces and their holes, connects / interactive, world y on the basement, ceilings through the stairwell,
 *     floorYAt over the stair, isInside, bounds / walkRects, light groups (unknown group warns), fixtures, built-ins,
 *     photo cameras, the dev warning of 2-argument ceilingHeightAt, deep freeze;
 *   • DesignState keeps saved shading / paint on surfaces of the whole house (windowIds / paintIds read house.*).
 */
import { registerHooks } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

registerHooks({
  load(url, context, nextLoad) {
    if (url.startsWith('file:') && url.endsWith('.json')) {
      const text = fs.readFileSync(fileURLToPath(url), 'utf8');
      return { format: 'module', source: `export default ${text};`, shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const imp = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);
const readJson = (abs) => JSON.parse(fs.readFileSync(abs, 'utf8'));

let failures = 0;
let passes = 0;
const section = (name) => console.log(`\n— ${name}`);
function check(name, ok, detail = '') {
  if (ok) {
    passes++;
    console.log(`  ok   ${name}`);
  } else {
    failures++;
    console.log(`  FAIL ${name}${detail !== '' ? `  → ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`);
  }
}
const near = (a, b, tol = 1e-9) => Number.isFinite(a) && Math.abs(a - b) <= tol;

/** Captures console.warn while fn runs; returns [result, warnings]. */
function withWarnings(fn) {
  const warns = [];
  const orig = console.warn;
  console.warn = (...args) => warns.push(args.join(' '));
  try {
    return [fn(), warns];
  } finally {
    console.warn = orig;
  }
}

/** The fixture overlay onto a spec: arrays extended / replaced by id, other keys set ($-keys are comments). */
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

/** Plain, comparable form of layout values (vectors → arrays, functions dropped, some keys skipped). */
const DERIVED_NEIGHBOUR_KEYS = new Set(['connects', 'interactive', 'opensInto']);
function plain(v, skip = DERIVED_NEIGHBOUR_KEYS) {
  if (v === null || v === undefined) return v ?? null;
  if (typeof v === 'function') return undefined;
  if (typeof v === 'number') return Object.is(v, -0) ? 0 : v;
  if (typeof v !== 'object') return v;
  if (v.isVector2) return [v.x, v.y];
  if (v.isVector3) return [v.x, v.y, v.z];
  if (v.isBox3) return [[v.min.x, v.min.y, v.min.z], [v.max.x, v.max.y, v.max.z]];
  if (Array.isArray(v)) return v.map((x) => plain(x, skip));
  const o = {};
  for (const k of Object.keys(v)) {
    if (skip.has(k)) continue;
    const p = plain(v[k], skip);
    if (p !== undefined) o[k] = p;
  }
  return o;
}
/** First difference between two plain values (null = equal). */
function firstDiff(a, b, p = '') {
  if (a === b) return null;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return `${p}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`;
  if (Array.isArray(a) !== Array.isArray(b)) return `${p}: array vs object`;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    const d = firstDiff(a[k], b[k], `${p}.${k}`);
    if (d) return d;
  }
  return null;
}

/** The old top-level fields – the living room only (§1.8). */
const OLD_FIELDS = ['meta', 'paints', 'walls', 'wallsById', 'openings', 'openingsById', 'windows', 'doors', 'floor', 'baseboard', 'zones', 'ceilings',
  'bulkheads', 'highWall', 'builtInLights', 'lightGroups', 'kitchen', 'fixtures', 'furniture', 'outside', 'photoCameras', 'bounds', 'floorArea', 'volume'];
const livingSnapshot = (L) => Object.fromEntries(OLD_FIELDS.map((k) => [k, plain(L[k])]));

const { buildLayout, lightGroupOf, LIVING_ROOM_ID, LEVEL_HYSTERESIS } = await imp('src/home/layout.js');
// «today» = the living room alone: research/room-spec.json + research/house/00-*.json, built as normalize-data.mjs
// builds src/data/room-spec.json. The generated file itself grows with every house step (10-, 20-, 30-… files: steg 7
// adds bad, gang and soverom), so it is no longer «today» – house-mini (the overlay) is the house of this test.
const houseData = await imp('src/data/scripts/house.mjs');
const { fixRoomSpec } = await imp('src/data/scripts/fixes.mjs');
const RESEARCH = path.join(ROOT, 'research');
const specJson = fixRoomSpec(houseData.mergeHouse(readJson(path.join(RESEARCH, 'room-spec.json')), RESEARCH, {
  files: houseData.houseFiles(RESEARCH).filter((f) => /^00-/.test(f.name)),
}));
const palette = readJson(path.join(ROOT, 'src/data/palette.json'));
const mini = readJson(path.join(HERE, 'fixtures/house-mini.json'));

const [base, baseWarns] = withWarnings(() => buildLayout(structuredClone(specJson), palette));
const [L, miniWarns] = withWarnings(() => buildLayout(overlay(specJson, mini), palette));
const H = L.house;
// the ground floor and the living room stated explicitly (as research/house/00-hus.json does)
const explicitSpec = overlay(specJson, {
  levels: [{ id: 'hoved', name: '1. etasje', floorY: 0, slabThickness: 0.3, ceilingDefault: 2.4, plan: { file: 'plantegning.png', pxPerM: 51.3, originPx: [90.5, 51.5] } }],
  rooms: [{ id: 'stue-kjokken', name: 'Stue/kjøkken', levelId: 'hoved', kind: 'living', polygon: specJson.floor.polygon, ceilingIds: specJson.ceilings.map((c) => c.id), acoustic: { mode: 'calibrated' } }],
});
const [explicit] = withWarnings(() => buildLayout(explicitSpec, palette));

// living-room sample points (inside its floor polygon)
const livingPts = [];
for (let x = 0.05; x < 6.95; x += 0.11) for (let z = 0.05; z < 11.95; z += 0.13) if (base.floor.contains(x, z)) livingPts.push([x, z]);
const gridPts = [];
for (let x = -0.6; x < 7.6; x += 0.17) for (let z = -0.6; z < 12.6; z += 0.19) gridPts.push([x, z]);

// ---------------------------------------------------------------------------------------------------------------
section('The living room is unchanged');
check('no warnings while building today\'s layout and house-mini', !baseWarns.length && !miniWarns.length, [...baseWarns, ...miniWarns].join(' | '));
const snapBase = livingSnapshot(base);
const dMini = firstDiff(snapBase, livingSnapshot(L));
check('house-mini: every old field deep-equal to today (except derived connects/interactive/opensInto)', !dMini, dMini ?? '');
const dExplicit = firstDiff(snapBase, livingSnapshot(explicit));
check('explicit ground floor + living room entry: every old field deep-equal to today', !dExplicit, dExplicit ?? '');
for (const [name, X] of [['today', base], ['house-mini', L]]) {
  check(`${name}: volume 138.57, floor 53.78`, near(X.volume, 138.57, 0.01) && near(X.floorArea, 53.78, 0.01), `${X.volume} ${X.floorArea}`);
  check(`${name}: 12 walls, 6 windows, 2 doors, 3 ceilings, 4 zones`, X.walls.length === 12 && X.windows.length === 6 && X.doors.length === 2 && X.ceilings.length === 3 && X.zones.length === 4,
    `${X.walls.length} ${X.windows.length} ${X.doors.length} ${X.ceilings.length} ${X.zones.length}`);
  check(`${name}: the six light groups`, X.lightGroups.map((g) => g.id).join() === 'led,spots,kjokken,pendler,overskap,tvstue', X.lightGroups.map((g) => g.id).join());
  check(`${name}: ceilingHeightAt(x, z) = house.ceilingHeightAt(x, z, 0) at ${livingPts.length} points in the living room`,
    livingPts.every(([x, z]) => X.ceilingHeightAt(x, z) === X.house.ceilingHeightAt(x, z, 0)));
}
check('ceilingHeightAt / isInside / zoneAt identical on a grid (today vs house-mini vs explicit)', gridPts.every(([x, z]) =>
  base.ceilingHeightAt(x, z) === L.ceilingHeightAt(x, z) && base.ceilingHeightAt(x, z) === explicit.ceilingHeightAt(x, z)
  && base.isInside(x, z) === L.isInside(x, z) && (base.zoneAt(x, z)?.id ?? null) === (L.zoneAt(x, z)?.id ?? null)));
check('known ceiling values: TV-stue 2.40, kitchen 2.40, slope 3.00 at the high wall', base.ceilingHeightAt(1.5, 10) === 2.4 && base.ceilingHeightAt(4.5, 1.5) === 2.4 && near(base.ceilingHeightAt(3.22, 6), 3));
check('wall heightAt / pointAt identical (today vs house-mini)', base.walls.every((w, i) => [0, 0.7, w.length / 2, w.length].every((u) =>
  w.heightAt(u) === L.walls[i].heightAt(u) && w.pointAt(u, 1.2).equals(L.walls[i].pointAt(u, 1.2)))));
const gangBase = base.opening('door-gang');
const gangMini = L.opening('door-gang');
check('door-gang today: connects only the living room, not interactive (the hall is not modelled)', gangBase.connects.join() === LIVING_ROOM_ID && gangBase.interactive === false, gangBase.connects);
check('door-gang with the hall: connects [stue-kjokken, gang], interactive, opens into the hall (swing out)',
  gangMini.connects.join() === 'stue-kjokken,gang' && gangMini.interactive === true && L.doors.find((d) => d.id === 'door-gang').opensInto === 'gang', gangMini.connects);
check('door-gang: openAngleDeg 90 and both casings by default', L.doors.find((d) => d.id === 'door-gang').openAngleDeg === 90 && L.doors.find((d) => d.id === 'door-gang').casing.back === true);

// ---------------------------------------------------------------------------------------------------------------
section('Old fields = the living room; house = everything');
check('old fields never see another room', !L.wallsById['w-bad-ost'] && !L.wall('w-gang-hall') && !L.opening('win-bad') && !L.windows.some((w) => w.id === 'win-bad')
  && !L.ceilings.some((c) => c.id === 'c-bad') && !L.builtInLights.some((l) => l.id === 'l-bad-tak') && !L.fixtures.some((f) => f.roomId !== LIVING_ROOM_ID)
  && !L.furniture.some((f) => f.id === 'f-bad-hoyskap') && L.photoCameras.length === 8 && !L.zones.some((z) => z.id === 'z-entre'));
check('house lists hold every entry', H.walls.length === 12 + 10 && H.windows.length === 7 && H.doors.length === 2 + 3 && H.ceilings.length === 3 + 4
  && H.builtInLights.length === 15 + 3 && H.fixtures.length === 17 + 4 && H.furniture.length === 62 + 1 && H.builtIns.length === 1 && H.photoCameras.length === 9 && H.zones.length === 5,
  `${H.walls.length} ${H.windows.length} ${H.doors.length} ${H.ceilings.length} ${H.builtInLights.length} ${H.fixtures.length} ${H.furniture.length} ${H.photoCameras.length}`);
check('the living room\'s entries are the same objects in house', H.wallsById['w-gang'] === L.wallsById['w-gang'] && H.opening('win-s1') === L.opening('win-s1') && H.ceilings[0] === L.ceilings[0]);
check('every house entry has roomId + levelId', [...H.walls, ...H.openings, ...H.ceilings, ...H.builtInLights, ...H.fixtures, ...H.furniture, ...H.builtIns, ...H.photoCameras, ...H.zones]
  .every((e) => typeof e.roomId === 'string' && typeof e.levelId === 'string'));
check('furniture: the living room\'s raw entries untouched (no roomId stamped), the house copies have it', !L.furniture.some((f) => 'roomId' in f) && H.furniture.every((f) => f.roomId));

// ---------------------------------------------------------------------------------------------------------------
section('Levels');
check('today: one synthesised level «hoved» (1. etasje, floorY 0, slab 0.30, plan alias from meta)', base.house.levels.length === 1 && base.house.levels[0].id === 'hoved'
  && base.house.levels[0].name === '1. etasje' && base.house.levels[0].floorY === 0 && base.house.levels[0].slabThickness === 0.3 && base.house.levels[0].plan?.file === 'plantegning.png'
  && base.house.levels[0].plan.pxPerMXZ.join() === '51.3,51.3', base.house.levels[0]);
check('today: levelAt is always hoved', base.house.levelAt(-5).id === 'hoved' && base.house.levelAt(10).id === 'hoved');
check('house-mini: levels top → bottom [hoved, kjeller], kjeller −2.55, slab underside −0.30', H.levels.map((l) => l.id).join() === 'hoved,kjeller' && H.level('kjeller').floorY === -2.55
  && near(H.level('hoved').bottomY, -0.3) && H.level('kjeller').plan.pxPerMXZ.join() === '60.3,56.8');
check('levelAt(−1.0) = kjeller, levelAt(0) = hoved', H.levelAt(-1.0).id === 'kjeller' && H.levelAt(0).id === 'hoved');
// the two top treads: −riser and −2 × riser (13 × 0,196: −0,20 / −0,39, hele-huset-avstemming.md §2.1 and §7.2 row 4)
const topRiser = H.stairs[0]?.riser ?? 0;
check('top of the stair (feet −0.20 / −0.39 + 0.9, = −riser / −2 riser) = hoved', H.levelAt(-0.2 + 0.9).id === 'hoved' && H.levelAt(-0.39 + 0.9).id === 'hoved'
  && H.levelAt(-topRiser + 0.9).id === 'hoved' && H.levelAt(-2 * topRiser + 0.9).id === 'hoved', topRiser);
check('levelAt hysteresis: hoved stays until 0.15 below the boundary', LEVEL_HYSTERESIS === 0.15 && H.levelAt(-0.40, 'hoved').id === 'hoved' && H.levelAt(-0.40).id === 'kjeller'
  && H.levelAt(-0.46, 'hoved').id === 'kjeller');
check('levelAt hysteresis: kjeller stays until 0.15 above the boundary', H.levelAt(-0.20, 'kjeller').id === 'kjeller' && H.levelAt(-0.20).id === 'hoved' && H.levelAt(-0.14, 'kjeller').id === 'hoved');
check('level room lists', H.level('hoved').roomIds.join() === 'stue-kjokken,bad,gang,trapp' && H.level('kjeller').roomIds.join() === 'kjeller-gang,entre-kjeller', H.level('hoved').roomIds);

// ---------------------------------------------------------------------------------------------------------------
section('Rooms');
const R = H.roomsById;
check('rooms: the living room first (synthesised), then the data', H.rooms.map((r) => r.id).join() === 'stue-kjokken,bad,gang,trapp,kjeller-gang,entre-kjeller');
check('living room: «Stue/kjøkken», area = floorArea, volume = layout.volume, calibrated acoustics, its floor', R['stue-kjokken'].name === 'Stue/kjøkken' && R['stue-kjokken'].area === L.floorArea
  && R['stue-kjokken'].volume === L.volume && R['stue-kjokken'].acoustic.mode === 'calibrated' && R['stue-kjokken'].floor.material === 'oak-plank' && !('polygon' in R['stue-kjokken'].floor)
  && R['stue-kjokken'].ceilingIds.join() === 'c-kjokken,c-stue,c-tvstue');
check('areas: bad 5.62, gang 6.58 gross / net without the hole', near(R.bad.area, 5.62, 0.01) && near(R.gang.area, 6.58, 0.01) && near(R.gang.netArea, 6.583 - H.floorOpenings[0].area, 1e-3)
  && R.gang.holeIds.join() === 'trappehull', `${R.bad.area} ${R.gang.area} ${R.gang.netArea}`);
check('bad: volume 5.62 × 2.40, estimate acoustics, level name', near(R.bad.volume, 2.53 * 2.22 * 2.4, 1e-9) && R.bad.acoustic.mode === 'estimate' && R.bad.levelName === '1. etasje' && R.bad.kind === 'bathroom');
check('kjeller-gang: no ceiling ids given → its ceilings; level Kjeller; floor −2.55', R['kjeller-gang'].ceilingIds.join() === 'c-kjeller-gang' && R['kjeller-gang'].levelName === 'Kjeller' && R['kjeller-gang'].floorY === -2.55);
check('entré: floorOffset −0.30 → floor −2.85, ceiling top −0.45', near(R['entre-kjeller'].floorY, -2.85) && near(R['entre-kjeller'].ceilingTop, -0.45), `${R['entre-kjeller'].floorY} ${R['entre-kjeller'].ceilingTop}`);
check('trapp: hud room with the hole as polygon, yRange kjeller floor … hoved + 1 m', R.trapp.hud && R.trapp.polygon.length === 6 && near(R.trapp.yRange[0], -2.55) && near(R.trapp.yRange[1], 1.0));
const at = (x, y, z, o) => H.roomAt(x, y, z, o)?.id ?? null;
check('roomAt (body centre): bad, gang, living room, kjeller-gang, entré', at(1.2, 0.9, 1.1) === 'bad' && at(2.5, 0.9, 3.2) === 'gang' && at(4.2, 0.9, 4.0) === 'stue-kjokken'
  && at(3.5, -2.55 + 0.9, 3.8) === 'kjeller-gang' && at(7.4, -2.85 + 0.9, 4.4) === 'entre-kjeller', [at(1.2, 0.9, 1.1), at(2.5, 0.9, 3.2), at(3.5, -1.65, 3.8), at(7.4, -1.95, 4.4)]);
check('roomAt: physical never returns the hud room; HUD (physical:false) tests the stair first', at(1.0, -1.0, 3.0) === 'kjeller-gang' && at(1.0, -1.0, 3.0, { physical: false }) === 'trapp'
  && at(1.0, 0.9, 3.0) === 'gang' && at(1.0, 0.9, 3.0, { physical: false }) === 'trapp' && at(1.0, 1.5, 3.0, { physical: false }) === 'gang');
check('roomAt: no room (soverom not modelled, outside) → null; levelId option', at(1.5, 0.9, 5.7) === null && at(20, 0.9, 5) === null && at(3.5, 0.9, 3.8, { levelId: 'kjeller' }) === 'kjeller-gang');
check('roomAt hysteresis via previousLevelId', at(3.5, -0.4, 3.8, { previousLevelId: 'hoved' }) === 'stue-kjokken' && at(3.5, -0.4, 3.8) === 'kjeller-gang');
check('containsPoint: plan + level band', R.gang.containsPoint(2.5, 0.9, 3.2) && !R.gang.containsPoint(2.5, -1.65, 3.2) && R['kjeller-gang'].containsPoint(2.5, -1.65, 3.2));

// ---------------------------------------------------------------------------------------------------------------
section('Walls, backOf faces, openings');
const loopOk = (roomId, n) => {
  const ids = R[roomId].wallIds;
  if (ids.length !== n) return false;
  let w = H.wall(ids[0]);
  for (let i = 0; i < n; i++) {
    const next = H.wall(w.nextId);
    if (!next || next.prevId !== w.id) return false;
    w = next;
  }
  return w.id === ids[0];
};
check('clockwise loops close: living room 12, bad 4, gang 4 (prevId/nextId)', loopOk('stue-kjokken', 12) && loopOk('bad', 4) && loopOk('gang', 4));
check('living room loop order = spec order', R['stue-kjokken'].wallIds.join() === specJson.walls.map((w) => w.id).join());
const fBad = H.wall('w-bad-sor');
check('backOf face: thickness 0, backOf [w-nisje-bak], own id/paint/material', fBad.thickness === 0 && fBad.backOf.join() === 'w-nisje-bak' && fBad.material === 'stone-panel' && fBad.paintHex === '#c6c1b9');
check('backFacesOf: w-gang → [w-gang-hall], w-bad-gang → [w-gang-ost]', H.backFacesOf('w-gang').join() === 'w-gang-hall' && H.backFacesOf('w-bad-gang').join() === 'w-gang-ost' && H.backFacesOf('w-hoy').length === 0);
const hHall = H.wall('w-gang-hall').holes;
check('w-gang-hall gets the hole of door-gang (z 3.36–4.43 → u 1.04–2.11)', hHall.length === 1 && hHall[0].openingId === 'door-gang' && hHall[0].ownerWallId === 'w-gang'
  && near(hHall[0].u0, 1.04, 1e-6) && near(hHall[0].u1, 2.11, 1e-6) && hHall[0].door && near(hHall[0].top, 2.15), hHall);
const hOst = H.wall('w-gang-ost').holes;
check('w-gang-ost gets the hole of door-bad (x 1.52–2.45)', hOst.length === 1 && hOst[0].openingId === 'door-bad' && near(hOst[0].u0, 1.52, 1e-6) && near(hOst[0].u1, 2.45, 1e-6), hOst);
check('owner walls: holes = own openings', H.wall('w-gang').holes.map((h) => h.openingId).join() === 'door-gang' && H.wall('w-sor').holes.length === 3);
const doorBad = H.doors.find((d) => d.id === 'door-bad');
check('door-bad: connects from data, interactive (both rooms modelled), opensInto bad', doorBad.connects.join() === 'bad,gang' && doorBad.interactive === true && doorBad.opensInto === 'bad' && doorBad.hinge === 'from');
const doorSov = H.doors.find((d) => d.id === 'door-soverom');
check('door-soverom: soverom not modelled → not interactive', doorSov.connects.join() === 'gang,soverom' && doorSov.interactive === false && doorSov.opensInto === 'soverom');
const doorUte = H.doors.find((d) => d.id === 'door-ute');
check('door-ute: interactive from data, world y on the entrance floor (−2.85)', doorUte.interactive === true && doorUte.connects.join() === 'entre-kjeller'
  && near(doorUte.corners[0].y, -2.85) && near(doorUte.basis.origin.y, -2.85) && near(doorUte.rect.max.y, -2.85 + 2.1), doorUte.corners[0]);
const winBad = H.opening('win-bad');
check('win-bad: frosted, obstruction 0.8, sill 0.88 on the ground floor, estimated kept', winBad.frosted && winBad.obstruction === 0.8 && near(winBad.corners[0].y, 0.88) && winBad.estimated.join() === 'sill' && winBad.skyView === null);
check('basement wall: pointAt(u, v) is world (v above the wall\'s floor)', near(H.wall('w-kg-sor').pointAt(0, 1).y, -1.55) && H.wall('w-kg-sor').floorY === -2.55 && H.wall('w-kg-sor').heightAt(1) === 2.25);
check('paint from `color` when there is no `paint`', H.wall('w-bad-ost').paintHex === '#c6c1b9' && H.ceilings.find((c) => c.id === 'c-bad').paintHex === '#efefed' && H.ceilings.find((c) => c.id === 'c-bad').trim === '#1d1e21');

// ---------------------------------------------------------------------------------------------------------------
section('Ceilings, floor openings, stair');
check('house.ceilingHeightAt: bad 2.40, basement hall −0.30, entrance −0.45', near(H.ceilingHeightAt(1.2, 1.1, 0), 2.4) && near(H.ceilingHeightAt(3.5, 3.8, -2.55), -0.3)
  && near(H.ceilingHeightAt(7.4, 4.4, -2.85), -0.45), [H.ceilingHeightAt(1.2, 1.1, 0), H.ceilingHeightAt(3.5, 3.8, -2.55), H.ceilingHeightAt(7.4, 4.4, -2.85)]);
check('house.ceilingHeightAt in the stairwell (from the basement) = the hall ceiling above (2.40)', near(H.ceilingHeightAt(1.0, 3.0, -2.55), 2.4) && near(H.ceilingHeightAt(1.0, 3.0, -1.2), 2.4));
check('ceilingHeightAt(x, z, y) with y → the house (world y)', near(L.ceilingHeightAt(3.5, 3.8, -2.55), -0.3) && L.ceilingHeightAt(4.5, 1.5, 0) === 2.4);
const cKg = H.ceilings.find((c) => c.id === 'c-kjeller-gang');
check('basement hall ceiling: the stair hole is cut from it, topAt = world', cKg.holes.length === 1 && cKg.holes[0].length === 6 && near(cKg.topAt(3.5, 3.8), -0.3)
  && H.ceilings.find((c) => c.id === 'c-gang').holes.length === 0);
const st = H.stairs[0];
check('stair: riser = rise / risers from the data (13 → 0.196), rise 2.55, from kjeller to hoved', st.risers === mini.stairs[0].risers && near(st.rise, 2.55) && near(st.riser, 2.55 / st.risers, 1e-12)
  && near(st.riser, 0.196, 5e-4) && st.fromLevel === 'kjeller' && st.toLevel === 'hoved', `${st.risers} ${st.riser}`);
check('stair: mean going on the walk line 0.18–0.25 (validator has the exact number)', st.going > 0.18 && st.going < 0.25, st.going);
const ys = st.walkLine.map((p) => st.surfaceY(p.x, p.y));
check('stair surface along the walk line: 0 at the top nosing, −2.55 at the bottom nosing, never rising', near(ys[0], 0, 0.01) && near(ys[ys.length - 1], -2.55, 0.01)
  && ys.every((y, i) => y !== null && (i === 0 || y <= ys[i - 1] + 1e-9)), ys.map((y) => y?.toFixed(2)).join(' '));
check('stair: the well and points outside the footprint have no surface', st.surfaceY(1.35, 3.29) === null && st.surfaceY(2.5, 3.2) === null);

// ---------------------------------------------------------------------------------------------------------------
section('floorYAt, isInside, bounds');
check('floorYAt: living room 0, bad 0, basement hall −2.55, entrance −2.85', H.floorYAt(4.2, 4.0, 0) === 0 && H.floorYAt(1.2, 1.1, 0) === 0 && H.floorYAt(3.5, 3.8, -2.55) === -2.55
  && near(H.floorYAt(7.4, 4.4, -2.85), -2.85));
check('floorYAt under the upper flight from the basement = the basement floor', H.floorYAt(1.0, 2.7, -2.55) === -2.55);
const onStair = H.floorYAt(1.0, 2.7, 0);
check('floorYAt in the hole from above = the stair surface (between the floors)', onStair < -0.05 && onStair > -1.5, onStair);
check('floorYAt in the well = the basement floor; inside a wall / outside = null', H.floorYAt(1.35, 3.29, 0) === -2.55 && H.floorYAt(2.58, 1.0, 0) === null && H.floorYAt(20, 5, 0) === null);
check('floorYAt in the door-bad threshold = 0', H.floorYAt(2.0, 2.27, 0) === 0);
check('isInside: living room, bad, door thresholds (door-bad, door-gang)', H.isInside(4.2, 4.0, 0) && H.isInside(1.2, 1.1, 0) && H.isInside(2.0, 2.27, 0) && H.isInside(3.17, 3.9, 0));
check('isInside: not inside a wall, not in the well; the stair footprint counts', !H.isInside(2.58, 1.0, 0) && !H.isInside(1.35, 3.29, 0) && H.isInside(1.0, 3.0, 0));
check('isInside: basement hall yes, under the terrace outside the rooms no; the same plan point at y 0 is the living room', H.isInside(3.5, 3.8, -2.55) && !H.isInside(8.0, 1.0, -2.55)
  && H.isInside(3.5, 3.8, 0) && !H.isInside(1.0, 5.0, -2.55));
const bh = H.levelBounds('hoved');
check('levelBounds(hoved) = the living room\'s bounds, y 0 … 3.00', bh.minX === L.bounds.minX && bh.maxX === L.bounds.maxX && bh.minZ === L.bounds.minZ && bh.maxZ === L.bounds.maxZ
  && bh.minY === 0 && near(bh.maxY, 3.0, 1e-9), bh);
const bk = H.levelBounds('kjeller');
check('levelBounds(kjeller): x 0–8.51, z 2.32–6.03, y −2.85 … −0.30', near(bk.minX, 0) && near(bk.maxX, 8.51) && near(bk.minZ, 2.32) && near(bk.maxZ, 6.03) && near(bk.minY, -2.85) && near(bk.maxY, -0.3), bk);
check('house bounds = union', near(H.bounds.maxX, 8.51) && near(H.bounds.minY, -2.85) && near(H.bounds.maxY, 3.0));
const [wr0, wr1] = H.walkRects;
check('walkRects: hoved = the old setBounds rectangle (inset 5 cm), feet band −0.30 … ∞', H.walkRects.length === 2 && wr0.levelId === 'hoved' && wr0.minX === L.bounds.minX + 0.05 && wr0.maxX === L.bounds.maxX - 0.05
  && wr0.minZ === L.bounds.minZ + 0.05 && wr0.maxZ === L.bounds.maxZ - 0.05 && near(wr0.minY, -0.3) && wr0.maxY === Infinity);
check('walkRects: kjeller band −∞ … −0.30', wr1.levelId === 'kjeller' && wr1.minY === -Infinity && near(wr1.maxY, -0.3) && near(wr1.maxX, 8.46));
check('today: one walk rectangle = the old setBounds', base.house.walkRects.length === 1 && base.house.walkRects[0].minX === base.bounds.minX + 0.05 && base.house.walkRects[0].maxZ === base.bounds.maxZ - 0.05);

// ---------------------------------------------------------------------------------------------------------------
section('Light groups, lights, fixtures, built-ins, cameras, zones');
check('house light groups: the six + bad, gang, kjeller-gang', H.lightGroups.map((g) => g.id).join() === 'led,spots,kjokken,pendler,overskap,tvstue,bad,gang,kjeller-gang', H.lightGroups.map((g) => g.id).join());
const gBad = H.lightGroups.find((g) => g.id === 'bad');
check('data group: dimmer = defaultDimmer (start level), dimmable, roomId, auto', gBad.dimmer === 0.6 && gBad.dimmable === true && gBad.roomId === 'bad' && gBad.levelId === 'hoved'
  && H.lightGroups.find((g) => g.id === 'gang').auto === 'on' && H.lightGroups[0].roomId === LIVING_ROOM_ID);
check('no light outside the living room lands in «kjokken»', H.builtInLights.filter((l) => l.roomId !== LIVING_ROOM_ID).every((l) => l.group !== 'kjokken' && l.group === l.specGroup));
const lKg = H.builtInLights.find((l) => l.id === 'l-kg-1');
check('basement downlight: world position y −0.30, colour 3000 K, dims', near(lKg.position.y, -0.3) && lKg.colorK === 3000 && lKg.dims.d === 0.09 && lKg.type === 'downlight' && lKg.floorY === -2.55);
const [g1, w1] = withWarnings(() => lightGroupOf({ id: 'x', type: 'spot', group: 'finnes-ikke' }));
check('lightGroupOf: an unknown group warns (no silent «kjokken»)', g1 === 'kjokken' && w1.length === 1 && /unknown light group/.test(w1[0]), w1);
const [, w2] = withWarnings(() => [lightGroupOf({ id: 'a', type: 'spot', group: 'spotter-hoyvegg' }), lightGroupOf({ id: 'led-overskap', type: 'led-strip', group: 'kjokkenlys' }),
  lightGroupOf({ id: 'p', type: 'pendant-cylinder', group: 'kjokkenlys' }), lightGroupOf({ id: 'b', type: 'plafond', group: 'bad' }, { groups: new Set(['bad']) })]);
check('lightGroupOf: known groups do not warn', w2.length === 0, w2);
const [Lw, w3] = withWarnings(() => buildLayout(overlay(overlay(specJson, mini), { builtInLights: [
  { id: 'l-stue-ukjent', type: 'spot', group: 'finnes-ikke', position: [4, 2.4, 4] },
  { id: 'l-bad-ukjent', roomId: 'bad', type: 'downlight', group: 'finnes-ikke', position: [1, 2.4, 1] },
] }), palette));
check('buildLayout: unknown groups warn; living room → kjokken, other room → its first group', w3.length === 2 && Lw.house.builtInLights.find((l) => l.id === 'l-stue-ukjent').group === 'kjokken'
  && Lw.house.builtInLights.find((l) => l.id === 'l-bad-ukjent').group === 'bad', w3);
const fxBryter = H.fixtures.find((f) => f.id === 'fx-gang-bryter');
check('fixture on a backOf face: its normal (into the hall), mount wall', fxBryter.normal.x === -1 && fxBryter.mount === 'wall');
check('fixture: mount from the data is respected; basement socket world y', H.fixtures.find((f) => f.id === 'fx-bad-ventil').mount === 'wall' && near(H.fixtures.find((f) => f.id === 'fx-kg-stikk').position.y, 0.18 - 2.55)
  && L.fixtures.find((f) => f.id === 'fx-roykvarsler-tv').mount === 'ceiling');
const wc = H.builtIns[0];
check('built-in: world position, local position kept, wall normal, collide by default', wc.position.isVector3 && wc.localPosition.join() === '0,0,1.85' && wc.normal.x === 1 && wc.collide === true && wc.mount === 'wall');
const cam = H.photoCamera('20261020_225349');
check('photo camera in the basement: house only, world pos', !L.photoCamera('20261020_225349') && cam && near(cam.pos.y, 1.6 - 2.55) && near(cam.lookAt.y, 1.88 - 2.55) && cam.roomId === 'kjeller-gang');
const zE = H.zones.find((z) => z.id === 'z-entre');
check('zone box from the room floor: −2.85 … +3.1', near(zE.box.min.y, -2.85) && near(zE.box.max.y, -2.85 + 3.1) && L.zones.every((z) => z.box.min.y === 0 && z.box.max.y === 3.1));

// ---------------------------------------------------------------------------------------------------------------
section('Dev warning, freeze');
const [Ld] = withWarnings(() => buildLayout(overlay(specJson, mini), palette, { devWarnings: true }));
const [vals, wd] = withWarnings(() => {
  const out = [];
  for (let i = 0; i < 3; i++) out.push(Ld.ceilingHeightAt(1.2, 1.1)); // one call site, in the bathroom
  out.push(Ld.ceilingHeightAt(1.3, 1.0)); // a second call site
  out.push(Ld.ceilingHeightAt(4.5, 1.5)); // in the living room: no warning
  return out;
});
check('2-argument ceilingHeightAt in another room: the living room\'s value, one warning per call site', wd.length === 2 && vals[0] === base.ceilingHeightAt(1.2, 1.1) && vals[4] === 2.4 && /pass y/.test(wd[0]), wd);
const [, wq] = withWarnings(() => L.ceilingHeightAt(1.2, 1.1));
check('no dev warnings outside Vite dev (default off in Node)', wq.length === 0);
check('deep-frozen: house, levels, rooms, polygons, walkRects', Object.isFrozen(H) && Object.isFrozen(H.levels[1]) && Object.isFrozen(H.rooms[1].polygon[0]) && Object.isFrozen(H.walkRects[0]) && Object.isFrozen(H.stairs[0].walkLine));

// ---------------------------------------------------------------------------------------------------------------
section('The real room-spec (src/data/room-spec.json, every research/house file)');
{
  const realSpecJson = readJson(path.join(ROOT, 'src/data/room-spec.json'));
  const [Lr, warns] = withWarnings(() => buildLayout(structuredClone(realSpecJson), palette));
  // a room registered in 00-ids.json that another step's file brings (the hall «gang» of A1 for the stair hole) may
  // still be missing in a branch: its «unknown room» warning is allowed, nothing else
  const reg = houseData.loadRegistry(RESEARCH);
  const pending = (w) => {
    const m = /unknown room (\S+)$/.exec(w);
    return !!m && !!reg.rooms?.[m[1]] && !(realSpecJson.rooms || []).some((r) => r.id === m[1]);
  };
  check('builds without warnings (except a registered room that another house file brings)', warns.every(pending), warns.filter((w) => !pending(w)).join(' | '));
  // door-gang may also gain the door fields a house file patches onto it with wallOpenings (A1: 180°, casing,
  // hardware, estimated, source) – the same set as tools/house-tests/hoved-rom.test.mjs skips
  const PATCHED = new Set([...DERIVED_NEIGHBOUR_KEYS, 'openAngleDeg', 'casing', 'hardware', 'estimated', 'source']);
  const snap = (X) => Object.fromEntries(OLD_FIELDS.map((k) => [k, plain(X[k], PATCHED)]));
  const d = firstDiff(snap(base), snap(Lr));
  check('every old field (the living room) deep-equal to today (except derived connects/interactive/opensInto and door-gang\'s patched door fields)', !d, d ?? '');
  check('volume 138.57, floor 53.78, 12 walls, 6 windows, 2 doors, the six light groups', near(Lr.volume, 138.57, 0.01) && near(Lr.floorArea, 53.78, 0.01) && Lr.walls.length === 12
    && Lr.windows.length === 6 && Lr.doors.length === 2 && Lr.lightGroups.map((g) => g.id).join() === 'led,spots,kjokken,pendler,overskap,tvstue', `${Lr.volume} ${Lr.floorArea} ${Lr.walls.length}`);
  check('ceilingHeightAt(x, z) / isInside / zoneAt identical to today on a grid', gridPts.every(([x, z]) => base.ceilingHeightAt(x, z) === Lr.ceilingHeightAt(x, z)
    && base.isInside(x, z) === Lr.isInside(x, z) && (base.zoneAt(x, z)?.id ?? null) === (Lr.zoneAt(x, z)?.id ?? null)));
  check('house: the levels from the data, the living room first among the rooms', Lr.house.levels[0].id === 'hoved' && Lr.house.rooms[0].id === LIVING_ROOM_ID
    && Lr.house.levels.every((lv) => (realSpecJson.levels || []).some((l) => l.id === lv.id) || lv.id === 'hoved'));
}

// ---------------------------------------------------------------------------------------------------------------
section('DesignState keeps shading / paint of the whole house');
const { DesignState } = await imp('src/design/DesignState.js');
const saved = {
  version: 1, app: 'Interiørspillet', items: [],
  windows: { 'win-bad': { archetype: 'roller', open: 0.5 }, 'win-s1': { archetype: 'roller', open: 1 }, 'win-finnes-ikke': { archetype: 'roller' } },
  paints: { 'w-bad-gang': '#123456', 'w-gang-hall': 'marrakesh', 'c-bad': '#eeeeee', 'w-hoy': '#aabbcc', 'w-finnes-ikke': '#000000' },
};
const dMiniState = new DesignState({ layout: L, original: false });
dMiniState.load(structuredClone(saved));
check('house layout: shading on win-bad and win-s1 kept, unknown window dropped', !!dMiniState.windows['win-bad'] && !!dMiniState.windows['win-s1'] && !dMiniState.windows['win-finnes-ikke'], Object.keys(dMiniState.windows));
check('house layout: paint on a new wall, a backOf face, a new ceiling and w-hoy kept; unknown dropped', dMiniState.paints['w-bad-gang'] === '#123456' && dMiniState.paints['w-gang-hall'] === 'marrakesh'
  && dMiniState.paints['c-bad'] === '#eeeeee' && dMiniState.paints['w-hoy'] === '#aabbcc' && !dMiniState.paints['w-finnes-ikke'], dMiniState.paints);
const dBaseState = new DesignState({ layout: base, original: false });
dBaseState.load(structuredClone(saved));
check('today\'s layout: only the living room\'s ids survive (as before)', !dBaseState.windows['win-bad'] && !!dBaseState.windows['win-s1'] && !dBaseState.paints['w-bad-gang'] && dBaseState.paints['w-hoy'] === '#aabbcc');
const dPlain = new DesignState({ layout: { windows: [{ id: 'win-x' }], wallsById: { 'w-x': {} } }, original: false });
dPlain.load(structuredClone({ ...saved, windows: { 'win-x': { archetype: 'roller' }, 'win-s1': { archetype: 'roller' } }, paints: { 'w-x': '#111111', 'w-hoy': '#222222' } }));
check('a layout without house (plain object): its own lists, as before', !!dPlain.windows['win-x'] && !dPlain.windows['win-s1'] && dPlain.paints['w-x'] === '#111111' && !dPlain.paints['w-hoy']);

// ---------------------------------------------------------------------------------------------------------------
console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
