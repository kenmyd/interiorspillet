#!/usr/bin/env node
/**
 * Hele huset, steg 7 (A1): the data for bad, gang and soverom in 1. etasje (research/house/10-hoved-rom.json).
 *   node tools/house-tests/hoved-rom.test.mjs        (from anywhere; exit code 1 on failure – tools/test-house.mjs runs it)
 *
 * Built from research/room-spec.json + the 00-files + the 10-files only (later 11-/20-/30-… files cannot make it fail,
 * except where it says so), plus a check that the generated src/data/room-spec.json holds the same rooms:
 *   • the validator is green (no errors, no warnings); areas bad 5,62 / gang 6,58 / soverom 11,45 (±0,05, §7.2);
 *   • the living room is unchanged: every old layout field deep-equal to the living room alone (door-gang may only gain
 *     the derived / patched door fields), volume 138,57, floor 53,78, the six light groups;
 *   • roomAt: (1,2; 1,1) bad, (2,5; 3,2) gang, (1,5; 5,7) soverom (§7.2); wall loops of 4, backOf faces one thickness
 *     behind their slab with the partner's door holes; every door connects two rooms; no light group falls back to
 *     «kjokken»; the numbers of the reconciliation (V41–V54) for doors, windows, lights; facade segments;
 *   • with the stair of hele-huset-avstemming.md §2.4 (hole V16, rekkverk A/B/C) merged on top: door-gang at 180° keeps
 *     ≥ 0,75 m free width (D6, at 90° it does not), door-bad's clear opening stands on floor 0,09 from the hole edge,
 *     no door swings over the hole, the hole lies inside «gang».
 */
import { imp, readJson, check, section, near, done } from './_lib.mjs';

const house = await imp('src/data/scripts/house.mjs');
const { fixRoomSpec } = await imp('src/data/scripts/fixes.mjs');
const { buildLayout, LIVING_ROOM_ID } = await imp('src/home/layout.js');
const palette = readJson('src/data/palette.json');
const RESEARCH = house.RESEARCH_DIR;
const registry = house.loadRegistry(RESEARCH);
const base = readJson('research/room-spec.json');
const files = house.houseFiles(RESEARCH);
const own = files.filter((f) => /^(00|10)-/.test(f.name));
const living = files.filter((f) => /^00-/.test(f.name));
const clone = (v) => JSON.parse(JSON.stringify(v));
const merge = (list) => fixRoomSpec(house.mergeHouse(base, RESEARCH, { files: list, registry }));
const spec = merge(own);
const livingSpec = merge(living);
const show = (list) => list.slice(0, 4).join(' | ') || '(ingen)';

/** Captures console.warn while fn runs; returns [result, warnings]. */
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

const ROOMS = ['bad', 'gang', 'soverom'];
const file10 = own.find((f) => f.name === '10-hoved-rom.json');

// ---------------------------------------------------------------------------------------------------------------
section('research/house/10-hoved-rom.json');
check('the file is there and is read by mergeHouse', !!file10 && file10.data.levelId === 'hoved');
const report = house.validateHouse(spec, { registry, throw: false });
check('validator green: no errors', !report.errors.length, show(report.errors));
check('…and no warnings', !report.warnings.length, show(report.warnings));
const area = (id) => report.rooms.find((r) => r.id === id)?.area;
check('areas: bad 5,62, gang 6,58, soverom 11,45 (±0,05)', near(area('bad'), 5.62, 0.05) && near(area('gang'), 6.58, 0.05) && near(area('soverom'), 11.45, 0.05), ROOMS.map(area).join(', '));
check('control areas (owner) within 10 %: bad 5,62, gang 6,44, soverom 11,48', ROOMS.every((id) => Math.abs(report.rooms.find((r) => r.id === id).deviation) < 0.1));
check('the rooms are in the register with kind and level (bathroom, hall, bedroom on hoved)', ROOMS.every((id) => {
  const r = spec.rooms.find((x) => x.id === id);
  return r && r.levelId === 'hoved' && r.kind === registry.rooms[id].kind && registry.rooms[id].levelId === 'hoved';
}));
check('only the 10-file adds walls with roomId bad / gang / soverom (12 walls, 4 per room)', ROOMS.every((id) => spec.walls.filter((w) => w.roomId === id).length === 4));
check('every new entry carries roomId (bad, gang or soverom)', ['walls', 'ceilings', 'builtInLights', 'fixtures', 'lightGroups'].every((k) => file10.data[k].every((e) => ROOMS.includes(e.roomId))));
check('the measuring list has the estimated fields of the three rooms', ROOMS.every((id) => report.measureList.some((m) => m.room === id)) && report.measureList.some((m) => m.id === 'door-gang' && m.fields.includes('door.openAngleDeg')));
const real = readJson('src/data/room-spec.json');
check('the generated src/data/room-spec.json has the three rooms and their 12 walls as in the file', ROOMS.every((id) => JSON.stringify(real.rooms.find((r) => r.id === id)) === JSON.stringify(spec.rooms.find((r) => r.id === id)))
  && file10.data.walls.every((w) => JSON.stringify(real.walls.find((x) => x.id === w.id)) === JSON.stringify(spec.walls.find((x) => x.id === w.id))));

// ---------------------------------------------------------------------------------------------------------------
section('The living room is unchanged');
const [L, warns] = quiet(() => buildLayout(clone(spec), palette));
const [B, bwarns] = quiet(() => buildLayout(clone(livingSpec), palette));
const H = L.house;
check('no warnings while building the layout (no unknown light group, wall, room)', !warns.length && !bwarns.length, [...warns, ...bwarns].join(' | '));
/** Plain, comparable form (vectors → arrays, functions dropped); on door-gang the fields this step adds are skipped. */
const DOOR_GANG_ADDED = new Set(['connects', 'interactive', 'opensInto', 'openAngleDeg', 'casing', 'hardware', 'estimated', 'source']);
function plain(v, skip = null) {
  if (v === null || v === undefined) return v ?? null;
  if (typeof v === 'function') return undefined;
  if (typeof v === 'number') return Object.is(v, -0) ? 0 : v;
  if (typeof v !== 'object') return v;
  if (v.isVector2) return [v.x, v.y];
  if (v.isVector3) return [v.x, v.y, v.z];
  if (v.isBox3) return [[v.min.x, v.min.y, v.min.z], [v.max.x, v.max.y, v.max.z]];
  if (Array.isArray(v)) return v.map((x) => plain(x, skip));
  const s = v.id === 'door-gang' ? DOOR_GANG_ADDED : skip;
  const o = {};
  for (const k of Object.keys(v)) {
    if (s?.has(k)) continue;
    const p = plain(v[k], s);
    if (p !== undefined) o[k] = p;
  }
  return o;
}
const OLD_FIELDS = ['meta', 'paints', 'walls', 'wallsById', 'openings', 'openingsById', 'windows', 'doors', 'floor', 'baseboard', 'zones', 'ceilings',
  'bulkheads', 'highWall', 'builtInLights', 'lightGroups', 'kitchen', 'fixtures', 'furniture', 'outside', 'photoCameras', 'bounds', 'floorArea', 'volume'];
const diffs = OLD_FIELDS.filter((k) => JSON.stringify(plain(L[k])) !== JSON.stringify(plain(B[k])));
check('every old layout field deep-equal to the living room alone (door-gang: only the new door fields differ)', !diffs.length, diffs.join());
check('volume 138,57, floor 53,78, 12 walls, 6 windows, 2 doors, 3 ceilings, 4 zones', near(L.volume, 138.57, 0.01) && near(L.floorArea, 53.78, 0.01) && L.walls.length === 12
  && L.windows.length === 6 && L.doors.length === 2 && L.ceilings.length === 3 && L.zones.length === 4);
check('the six light groups of the living room, no new one among them', L.lightGroups.map((g) => g.id).join() === 'led,spots,kjokken,pendler,overskap,tvstue');
const grid = [];
for (let x = -0.4; x < 7.4; x += 0.23) for (let z = -0.4; z < 12.4; z += 0.29) grid.push([x, z]);
check('ceilingHeightAt(x, z) / isInside / zoneAt identical on a grid', grid.every(([x, z]) => L.ceilingHeightAt(x, z) === B.ceilingHeightAt(x, z) && L.isInside(x, z) === B.isInside(x, z)
  && (L.zoneAt(x, z)?.id ?? null) === (B.zoneAt(x, z)?.id ?? null)));
check('the frozen walls are untouched in the data (only door-gang on w-gang is patched)', registry.frozen.walls.every((id) => {
  const a = clone(spec.walls.find((w) => w.id === id));
  const b = clone(livingSpec.walls.find((w) => w.id === id));
  if (id === 'w-gang') {
    const pa = a.openings.find((o) => o.id === 'door-gang');
    for (const k of ['connects', 'interactive', 'estimated', 'source']) delete pa[k];
    for (const k of ['opensInto', 'openAngleDeg', 'casing', 'hardware']) delete pa.door[k];
  }
  return JSON.stringify(a) === JSON.stringify(b);
}));

// ---------------------------------------------------------------------------------------------------------------
section('Rooms, walls and backOf faces in layout.house');
const at = (x, z, y = 0.9) => H.roomAt(x, y, z)?.id ?? null;
check('roomAt: (1,2; 1,1) bad, (2,5; 3,2) gang, (1,5; 5,7) soverom, (4,5; 1,5) stue-kjokken', at(1.2, 1.1) === 'bad' && at(2.5, 3.2) === 'gang' && at(1.5, 5.7) === 'soverom' && at(4.5, 1.5) === LIVING_ROOM_ID);
check('hoved has stue-kjokken, bad, gang, soverom (in this order)', H.level('hoved').roomIds.slice(0, 4).join() === 'stue-kjokken,bad,gang,soverom', H.level('hoved').roomIds);
check('each room: a closed clockwise loop of 4 walls (prev/next set)', ROOMS.every((id) => {
  const r = H.room(id);
  return r.wallIds.length === 4 && r.wallIds.every((wid, i) => H.wall(wid).nextId === r.wallIds[(i + 1) % 4] && H.wall(wid).prevId === r.wallIds[(i + 3) % 4]);
}));
const BACK = { 'w-bad-sor': ['w-nisje-bak'], 'w-gang-ost': ['w-bad-gang', 'w-nisje-side'], 'w-gang-hall': ['w-gang'], 'w-sov-ost': ['w-gang-sov'], 'w-sov-sor': ['w-hoy'], 'w-sov-vest': ['w-sov-tv'] };
check('the backOf faces (D13): w-bad-sor, w-gang-ost, w-gang-hall, w-sov-ost, w-sov-sor, w-sov-vest – thickness 0, no openings of their own',
  Object.entries(BACK).every(([id, ids]) => H.wall(id).backOf?.join() === ids.join() && H.wall(id).thickness === 0 && H.wall(id).openings.length === 0)
  && H.walls.filter((w) => ROOMS.includes(w.roomId) && w.backOf).length === 6);
check('…each lies exactly one slab thickness behind its partner\'s room face, antiparallel', Object.entries(BACK).every(([id, ids]) => ids.every((pid) => {
  const f = H.wall(id);
  const p = H.wall(pid);
  const off = (f.start.x - p.start.x) * p.normal.x + (f.start.y - p.start.y) * p.normal.y;
  return near(off, -p.thickness, 1e-9) && near(f.dir.dot(p.dir), -1, 1e-9);
})));
check('backFacesOf: w-bad-gang → w-gang-ost, w-gang → w-gang-hall, w-gang-sov → w-sov-ost, w-hoy → w-sov-sor', H.backFacesOf('w-bad-gang').join() === 'w-gang-ost'
  && H.backFacesOf('w-gang').join() === 'w-gang-hall' && H.backFacesOf('w-gang-sov').join() === 'w-sov-ost' && H.backFacesOf('w-hoy').join() === 'w-sov-sor');
const hole = (wid, oid) => H.wall(wid).holes.find((h) => h.openingId === oid);
check('the door holes reach the backOf faces: door-bad in w-gang-ost (x 1,54–2,45), door-gang in w-gang-hall (z 3,36–4,43), door-soverom in w-sov-ost (x 2,11–3,06)',
  near(hole('w-gang-ost', 'door-bad')?.u0, 1.54, 1e-9) && near(hole('w-gang-ost', 'door-bad')?.u1, 2.45, 1e-9)
  && near(hole('w-gang-hall', 'door-gang')?.u0, 3.36 - 2.32, 1e-9) && near(hole('w-gang-hall', 'door-gang')?.u1, 4.43 - 2.32, 1e-9)
  && near(hole('w-sov-ost', 'door-soverom')?.u0, 2.11, 1e-9) && near(hole('w-sov-ost', 'door-soverom')?.u1, 3.06, 1e-9));
check('walls: the bad in stone panels #c8c5bf (V41), gang SAND, soverom #50575c; exterior 0,30, partitions 0,10', ['w-bad-ost', 'w-bad-sor', 'w-bad-gang', 'w-bad-nord'].every((id) => H.wall(id).material === 'stone-panel' && H.wall(id).paintHex === '#c8c5bf')
  && H.walls.filter((w) => w.roomId === 'gang').every((w) => w.paint === 'sand') && H.walls.filter((w) => w.roomId === 'soverom').every((w) => w.paintHex === '#50575c')
  && ['w-bad-ost', 'w-bad-nord', 'w-gang-nord', 'w-sov-nord'].every((id) => H.wall(id).exterior && H.wall(id).thickness === 0.3) && ['w-bad-gang', 'w-gang-sov'].every((id) => H.wall(id).thickness === 0.1 && !H.wall(id).exterior));
check('per-room skirting: the bad a dark 0,04 upstand, gang and soverom #ada291 (V42, V50)', file10.data.rooms[0].baseboard.color === '#2a2a2c' && file10.data.rooms[0].baseboard.height === 0.04
  && file10.data.rooms.slice(1).every((r) => r.baseboard.color === '#ada291') && H.room('bad').floor.material === 'vinyl' && H.room('gang').floor.material === 'oak-plank');
check('ceilings: one flat 2,40 per room, covering the room exactly (house.ceilingHeightAt 2,40 in all three)', ROOMS.every((id) => {
  const r = H.room(id);
  const c = H.ceilings.filter((x) => x.roomId === id);
  return c.length === 1 && r.ceilingIds.join() === c[0].id && c[0].heightAt(0, 0) === 2.4 && near(c[0].area, r.area, 1e-9) && near(r.volume, r.area * 2.4, 1e-9);
}) && [[1.2, 1.1], [2.5, 3.2], [1.5, 5.7], [0.7, 3.0]].every(([x, z]) => H.ceilingHeightAt(x, z, 0.9) === 2.4));

// ---------------------------------------------------------------------------------------------------------------
section('Doors and windows (V47–V51, V54–V55)');
const door = (id) => H.doors.find((d) => d.id === id);
check('every door of the house connects two different rooms and is interactive', H.doors.filter((d) => d.type === 'door').every((d) => d.connects.length === 2 && d.connects[0] !== d.connects[1] && d.interactive));
check('door-gang: [stue-kjokken, gang], opens into gang, 180°, casing.back false (D6)', door('door-gang').connects.join() === 'stue-kjokken,gang' && door('door-gang').opensInto === 'gang'
  && door('door-gang').openAngleDeg === 180 && door('door-gang').casing.back === false && door('door-gang').casing.front === true && door('door-gang').width === 1.07 && door('door-gang').leaf.w === 0.93);
const dBad = door('door-bad');
const dSov = door('door-soverom');
const xOf = (d, u) => H.wall(d.wallId).pointAt(u).x;
check('door-bad: hole x 1,54–2,45 × 2,15, leaf 0,77 × 2,08, hinge south, swings into bad (V49)', near(xOf(dBad, dBad.u1), 1.54, 1e-9) && near(xOf(dBad, dBad.u0), 2.45, 1e-9) && dBad.height === 2.15
  && dBad.leaf.w === 0.77 && dBad.leaf.h === 2.08 && dBad.hinge === 'from' && dBad.swing === 'in' && dBad.opensInto === 'bad' && dBad.connects.join() === 'bad,gang');
check('door-bad: lever with WC turn on 1,03, two-part threshold (V47, V48)', dBad.door.hardware.type === 'lever' && dBad.door.hardware.wcTurn === true && dBad.door.handleHeight === 1.03
  && dBad.door.threshold.top === '#2a2a2c' && dBad.door.threshold.front === '#cdbfae');
check('door-soverom: hole x 2,11–3,06 × 2,12, leaf 0,81 × 2,05, hinge south, swings into soverom, lever on 1,05, metal threshold', near(xOf(dSov, dSov.u1), 2.11, 1e-9) && near(xOf(dSov, dSov.u0), 3.06, 1e-9)
  && dSov.height === 2.12 && dSov.leaf.w === 0.81 && dSov.leaf.h === 2.05 && dSov.hinge === 'from' && dSov.swing === 'out' && dSov.opensInto === 'soverom' && dSov.door.handleHeight === 1.05
  && dSov.door.handleSide === 'to' && dSov.door.threshold.top === '#2b2b2d');
check('leaves = hole − 2 × frame 0,07 and hole − 0,07 (no gap under the head)', [dBad, dSov].every((d) => near(d.leaf.w, d.width - 2 * d.frame.width, 1e-9) && near(d.leaf.h, d.height - d.frame.width, 1e-9)));
check('thresholds: the three doors have walkable thresholds across their owner wall', ['door-gang', 'door-bad', 'door-soverom'].every((id) => H.thresholds.some((t) => t.openingId === id)));
const win = (id) => H.windows.find((w) => w.id === id);
const zOf = (w, u) => H.wall(w.wallId).pointAt(u).z;
check('win-bad: z 0,99–1,47, 0,48 × 1,17, sill 0,88 (top 2,05), frosted', near(zOf(win('win-bad'), win('win-bad').u1), 0.99, 1e-9) && near(zOf(win('win-bad'), win('win-bad').u0), 1.47, 1e-9)
  && win('win-bad').sill === 0.88 && near(win('win-bad').top, 2.05, 1e-9) && win('win-bad').frosted === true);
check('win-sov: z 6,11–7,28, 1,17 × 1,17, sill 0,92 (top 2,09), not frosted, blackout roller noted (V51)', near(zOf(win('win-sov'), win('win-sov').u1), 6.11, 1e-9) && near(zOf(win('win-sov'), win('win-sov').u0), 7.28, 1e-9)
  && win('win-sov').sill === 0.92 && near(win('win-sov').top, 2.09, 1e-9) && !win('win-sov').frosted
  && spec.walls.find((w) => w.id === 'w-sov-nord').openings[0].existingShading?.color === '#2a2b2d');
check('the house has the two new windows, the living room still its six', H.windows.length === 8 && L.windows.length === 6);

// ---------------------------------------------------------------------------------------------------------------
section('Lights, fixtures and light groups');
const lights = H.builtInLights.filter((l) => ROOMS.includes(l.roomId));
check('five lights: l-bad-tak, l-bad-spot, l-gang-tak, l-sov-tak (plafond / downlight), l-sov-garderobe', lights.map((l) => l.id).join() === 'l-bad-tak,l-bad-spot,l-gang-tak,l-sov-tak,l-sov-garderobe');
check('…each in its own room\'s group, none fell back to «kjokken»', lights.every((l) => l.group === l.roomId && l.group !== 'kjokken'));
const lt = (id) => H.builtInLights.find((l) => l.id === id);
check('l-gang-tak: Ø 0,38 on (1,2; 2,40; 3,1), 3500–4000 K (V46)', lt('l-gang-tak').position.toArray().join() === '1.2,2.4,3.1' && lt('l-gang-tak').dims.d === 0.38
  && lt('l-gang-tak').colorK >= 3500 && lt('l-gang-tak').colorK <= 4000 && lt('l-gang-tak').type === 'plafond');
check('l-bad-tak: dark rim, 1500 lm; l-bad-spot: downlight on (2,20; 2,40; 1,85), d 0,08 (V45)', lt('l-bad-tak').lumens === 1500 && lt('l-bad-tak').color === '#3a3a3c'
  && lt('l-bad-spot').position.toArray().join() === '2.2,2.4,1.85' && lt('l-bad-spot').dims.d === 0.08 && lt('l-bad-spot').type === 'downlight');
check('lights use lightColorK and dims (not kelvin / diameter), and hang at the ceiling (2,40)', file10.data.builtInLights.every((l) => l.lightColorK && l.dims && !('kelvin' in l) && !('diameter' in l))
  && lights.filter((l) => l.position).every((l) => l.position.y === 2.4) && lights.every((l) => l.lumens > 0));
const fx = (id) => H.fixtures.find((f) => f.id === id);
check('P1 / P2 in the gang ceiling are fixtures, not lights (V46)', fx('fx-takpunkt-gang-p1')?.mount === 'ceiling' && fx('fx-takpunkt-gang-p2')?.position.toArray().join() === '2.4,2.4,3.1'
  && !H.builtInLights.some((l) => /p1|p2|takpunkt/.test(l.id)));
check('wall fixtures sit on a wall of their own room', H.fixtures.filter((f) => ROOMS.includes(f.roomId) && f.wallId).every((f) => H.wall(f.wallId).roomId === f.roomId));
const groups = H.lightGroups.filter((g) => ROOMS.includes(g.id));
check('light groups gang 0,5, bad 0,6, soverom 0,5 – dimmable, as in 00-ids.json; gang is on in auto (no window)', groups.length === 3 && groups.every((g) => g.roomId === g.id && g.dimmable
  && g.dimmer === registry.lightGroups[g.id].defaultDimmer && g.label === registry.lightGroups[g.id].label) && groups.find((g) => g.id === 'gang').auto === 'on');

// ---------------------------------------------------------------------------------------------------------------
section('Facade segments');
const segs = spec.facadeSegments;
check('f-nord-hoved: w-bad-nord, w-gang-nord, w-sov-nord – joins w-bad-ost and w-nord-tv; f-ost-bad: w-bad-ost – joins w-bad-nord and w-kjokken-ost', segs.length === 2
  && segs[0].id === 'f-nord-hoved' && segs[0].wallIds.join() === 'w-bad-nord,w-gang-nord,w-sov-nord' && segs[0].joinStart === 'w-bad-ost' && segs[0].joinEnd === 'w-nord-tv'
  && segs[1].id === 'f-ost-bad' && segs[1].wallIds.join() === 'w-bad-ost' && segs[1].joinStart === 'w-bad-nord' && segs[1].joinEnd === 'w-kjokken-ost' && segs.every((s) => s.material === 'cladding'));
{
  // the north facade on x = −0,30: z 0 → 8,20, the gaps between the wall slabs only the 0,10 partitions; w-nord-tv's
  // mitre with w-sov-tv (0,14) ends its cladding on z 8,20, and w-kjokken-ost's with w-nisje-bak (0,10) on x 2,53
  const north = segs[0].wallIds.map((id) => H.wall(id)).map((w) => [Math.min(w.start.y, w.end.y), Math.max(w.start.y, w.end.y)]).sort((a, b) => a[0] - b[0]);
  const gaps = north.slice(1).map((s, i) => s[0] - north[i][1]);
  check('north: the walls run z 0 → 8,20 on x 0 (outer face −0,30), gaps 0,10 = the partitions w-bad-gang and w-gang-sov', near(north[0][0], 0, 1e-9) && near(north.at(-1)[1], 8.2, 1e-9)
    && gaps.length === 2 && gaps.every((g) => near(g, 0.1, 1e-9)) && segs[0].wallIds.every((id) => near(H.wall(id).start.x, 0, 1e-9)));
  const tv = H.wall('w-nord-tv');
  const stv = H.wall('w-sov-tv');
  check('…and w-nord-tv\'s cladding (mitred against w-sov-tv) starts where w-sov-nord ends (z 8,20)', near(tv.end.y - stv.thickness, H.wall('w-sov-nord').start.y, 1e-9));
  const ko = H.wall('w-kjokken-ost');
  check('east: w-bad-ost ends on x 2,53, where w-kjokken-ost\'s mitre with w-nisje-bak begins', near(H.wall('w-bad-ost').end.x, ko.start.x - H.wall('w-nisje-bak').thickness, 1e-9) && near(H.wall('w-bad-ost').end.y, ko.start.y, 1e-9));
}

// ---------------------------------------------------------------------------------------------------------------
// The stair as hele-huset-avstemming.md §2.4 / §1.1 gives it (20-trapp.json comes from the basement step): the room
// id «gang», the hole and the railings must fit the doors of this file.
section('With the stair of the reconciliation (§2.4: hole V16, rekkverk A/B/C)');
const unit = (a, b) => {
  const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
  return [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
};
const loopWalls = (prefix, roomId, poly, extra) => poly.map((p, i) => {
  const q = poly[(i + 1) % poly.length];
  const d = unit(p, q);
  return { id: `${prefix}-${i + 1}`, roomId, from: p, to: q, normal: [d[1] === 0 ? 0 : -d[1], d[0] === 0 ? 0 : d[0]], thickness: 0.1, height: 2.25, estimated: ['*'], ...extra };
});
const HOLE = [[0, 2.32], [1.45, 2.32], [1.45, 3.48], [1.85, 3.48], [1.85, 4.43], [0, 4.43]];
const KG = [[0.13, 2.32], [1.85, 2.32], [1.85, 2.56], [5.75, 2.56], [5.75, 5.23], [3.05, 5.23], [3.05, 4.43], [0.13, 4.43]];
function stairFile(edit) {
  const data = {
    levels: [{ id: 'kjeller', name: 'Kjeller', floorY: -2.55, slabThickness: 0.3, ceilingDefault: 2.25, estimated: ['floorY', 'ceilingDefault'] }],
    rooms: [
      { id: 'trapp', name: 'Trappa', levelId: 'hoved', kind: 'hud', polygon: [[0.13, 2.32], [1.45, 2.32], [1.45, 3.1], [1.04, 3.1], [1.04, 3.48], [1.76, 3.48], [1.76, 4.43], [0.13, 4.43]] },
      { id: 'kjeller-gang', name: 'Gang', levelId: 'kjeller', kind: 'hall', polygon: KG, floor: { material: 'oak-plank', color: '#cbbfb0' }, ceilingIds: [], acoustic: { mode: 'estimate' }, estimated: ['*'] },
    ],
    walls: loopWalls('w-kgtest', 'kjeller-gang', KG),
    floorOpenings: [{ id: 'trappehull', levelId: 'hoved', roomId: 'gang', stairId: 'trapp-kjeller', polygon: HOLE, edgeBand: { color: '#f2efe8', depth: 0.3 }, estimated: ['polygon'] }],
    stairs: [{
      id: 'trapp-kjeller', name: 'Trappa', type: 'half-turn-winder', fromLevel: 'kjeller', toLevel: 'hoved', openingId: 'trappehull', roomIds: ['kjeller-gang', 'gang'],
      risers: 13,
      top: { edge: [[1.45, 2.32], [1.45, 3.1]], down: [-1, 0], straightTreads: 1 },
      foot: { edge: [[1.73, 3.48], [1.73, 4.43]], down: [1, 0], straightTreads: 3 },
      well: { polygon: [[1.04, 3.1], [1.45, 3.1], [1.45, 3.48], [1.04, 3.48]], newel: [1.45, 3.1] },
      walkLine: 'flight-centre', going: null, winders: 'balanced',
      tread: { thickness: 0.04, nosing: 0.03 },
      guards: [
        { id: 'rekk-a', level: 'hoved', line: [[1.85, 4.43], [1.85, 3.48]] },
        { id: 'rekk-b', level: 'hoved', line: [[1.85, 3.48], [1.45, 3.48]] },
        { id: 'rekk-c', level: 'hoved', line: [[1.45, 3.48], [1.45, 3.1]] },
        { id: 'rekk-oye', on: 'well' },
      ],
      handrails: [{ side: 'outer', start: [1.4, 2.32], startHeight: 0.7, walls: ['øst', 'nord', 'vest'], height: 0.9, led: { walls: ['øst', 'nord'], lumensPerM: 120, lightColorK: 2900, group: 'gang' } }],
      estimated: ['risers', 'top', 'foot', 'well', 'tread', 'guards', 'handrails[0].startHeight', 'handrails[0].led'],
    }],
  };
  if (edit) edit(data);
  return { name: '20-trapp.json', data };
}
const withStair = (edit) => house.validateHouse(merge([...own, stairFile(edit)]), { registry, throw: false });
const rs = withStair();
console.log(`  (trapp: ${rs.stairs.map((s) => `${s.risers} × ${s.riser.toFixed(3)}, inntrinn ${s.going.toFixed(3)}, 2r+g ${s.twoRG.toFixed(3)}`).join()}; dører: ${rs.doors.map((d) => `${d.id} ${d.angle}° ${d.blocked ? "sperrer" : "fri"}${d.minGuard != null ? ` (${d.minGuard.toFixed(2)} m til rekkverket)` : ""}`).join(", ")}; ${rs.warnings.length} advarsler)`);
check('no errors with the stair merged on top (warnings about the walk line are the stair step\'s, V13)', !rs.errors.length, show(rs.errors));
check('the hole lies inside «gang» (no error about it), the LED handrail finds the group «gang»', !rs.errors.some((m) => /trappehull|LED-lista/.test(m)));
const rd = (id) => rs.doors.find((d) => d.id === id);
check('door-gang at 180° keeps ≥ 0,75 m free width past rekkverk A/B (D6), its leaf lies in the gang', rd('door-gang')?.blocked === false && rd('door-gang')?.leafRoom === 'gang' && rd('door-gang')?.angle === 180);
check('door-bad and door-soverom swing into their rooms without blocking', rd('door-bad')?.blocked === false && rd('door-bad')?.leafRoom === 'bad' && rd('door-soverom')?.blocked === false && rd('door-soverom')?.leafRoom === 'soverom');
check('no door stands over the hole or swings over it', !rs.errors.concat(rs.warnings).some((m) => /står over hullet|slår inn over trappehullet/.test(m)), show(rs.warnings));
{
  const holeEdgeX = 1.45; // V15: the top nosing / east part of the hole
  const north = xOf(dBad, dBad.u1);
  check('door-bad\'s north jamb (x 1,54) stands 0,09 south of the hole edge (x 1,45), so the frame is on floor (V15, V49)', near(north - holeEdgeX, 0.09, 1e-9) && north - holeEdgeX >= 0.05);
}
const r90 = withStair((d) => {
  d.wallOpenings = [{ wallId: 'w-gang', openings: [{ id: 'door-gang', door: { openAngleDeg: 90 } }] }];
});
check('…while door-gang at 90° would cut the gang at rekkverk A (the reason for 180°)', r90.errors.some((m) => /door-gang.*fri bredde/.test(m)), show(r90.errors));

done();
