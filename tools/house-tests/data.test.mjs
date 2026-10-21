#!/usr/bin/env node
/**
 * Hele huset, steg 3 (S0-data): the normaliser's house merge and the validator (src/data/scripts/house.mjs).
 *   node tools/house-tests/data.test.mjs        (from anywhere; exit code 1 on failure – tools/test-house.mjs runs it)
 *
 * - re-running the normaliser reproduces src/data/room-spec.json and the generated «Målelista» byte for byte, and the
 *   real room-spec has no validator errors (warnings are allowed), keeps its key order and the living room's counts;
 * - step 3's own house files (research/house/00-*.json) change nothing in the living room (only `levels` and `rooms`
 *   are added) and validate without errors or warnings. These checks – and the plan house below – are built from the
 *   00-files alone, so they keep holding when later steps add 10-/20-/30-… files (they own only those);
 * - mergeHouse: stamping, replace / extend by id, kitchen.items, deep merge, wallOpenings, key order, protected keys,
 *   which files are read;
 * - validateHouse is green on a «plan house» built from notes/hele-huset-design.md §1.4–§1.6 on top of the 00-files
 *   (bad, gang, soverom, trappa, kjellergang, bod-1): stair numbers, warnings for estimated values;
 * - bad fixtures fail: door format, overlapping rooms, unknown or alias archetype, a new entry without roomId, kjeller
 *   on another floorY than 00-ids.json, an open door leaf against the railing, plus
 *   renamed ids, wall loops, backOf, double walls, swing/opensInto, lights, holes, doors over the hole.
 * Pure Node: house.mjs reads JSON with fs, so no JSON import hook is needed.
 */
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const RESEARCH = path.join(ROOT, 'research');
const imp = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);
const house = await imp('src/data/scripts/house.mjs');
const { fixRoomSpec } = await imp('src/data/scripts/fixes.mjs');

let failures = 0;
let passes = 0;
const section = (name) => console.log(`\n— ${name}`);
function check(name, ok, detail = '') {
  if (ok) {
    passes++;
    console.log(`  ok   ${name}`);
  } else {
    failures++;
    console.log(`  FAIL ${name}${detail ? `  → ${detail}` : ''}`);
  }
}
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const clone = (v) => JSON.parse(JSON.stringify(v));
const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
const base = readJson('research/room-spec.json');
const registry = house.loadRegistry(RESEARCH);
const realFiles = house.houseFiles(RESEARCH);
// step 3 owns only research/house/00-*.json; the rest of the house comes in later 10-/20-/30-… files
const own = realFiles.filter((f) => /^00-/.test(f.name));
const ownSpec = fixRoomSpec(house.mergeHouse(base, RESEARCH, { files: own, registry }));
const validate = (spec) => house.validateHouse(spec, { registry, throw: false });
const has = (list, re) => list.some((m) => re.test(m));
const show = (list) => list.slice(0, 4).join(' | ') || '(ingen)';

// ---------------------------------------------------------------------------------------------------------------
section('Normaliser: one regeneration, then byte-identical');
{
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'ip-house-'));
  const run = spawnSync(process.execPath, [path.join(ROOT, 'src/data/scripts/normalize-data.mjs'), '--only=room-spec', `--out=${out}`], { cwd: ROOT, encoding: 'utf8' });
  const same = (a, b) => fs.existsSync(a) && fs.readFileSync(a, 'utf8') === fs.readFileSync(b, 'utf8');
  check('normalize-data.mjs --only=room-spec runs (validator green)', run.status === 0, (run.stderr || run.stdout || '').slice(0, 400));
  check('…and reproduces src/data/room-spec.json byte for byte', same(path.join(out, 'room-spec.json'), path.join(ROOT, 'src/data/room-spec.json')));
  check('…and the generated «Målelista» in research/room-spec-notes.md', same(path.join(out, 'room-spec-notes.md'), path.join(ROOT, 'research/room-spec-notes.md')));
  check('…and writes nothing else', fs.readdirSync(out).sort().join() === 'room-spec-notes.md,room-spec.json', fs.readdirSync(out).join());
  fs.rmSync(out, { recursive: true, force: true });
}
const spec = readJson('src/data/room-spec.json');
const inStue = (e) => !e.roomId || e.roomId === house.STUE;
const stueOnly = (s) => {
  const c = clone(s);
  delete c.levels;
  delete c.rooms;
  return c;
};

// ---------------------------------------------------------------------------------------------------------------
// Only what step 3 guarantees for the whole house: later steps add their own files and the counts grow.
section('src/data/room-spec.json (whatever house files there are)');
{
  const keys = Object.keys(spec);
  const baseKeys = Object.keys(base);
  const order = registry.schema.topLevel;
  const added = keys.slice(baseKeys.length);
  check('room-spec keeps its keys in order, the new ones appended in schema.topLevel order', keys.slice(0, baseKeys.length).join() === baseKeys.join()
    && added.every((k) => order.includes(k)) && added.every((k, i) => i === 0 || order.indexOf(added[i - 1]) < order.indexOf(k)), keys.join());
  const fixedBase = fixRoomSpec(clone(base));
  check('meta, floor, baseboard and highWall are still the living room\'s (protected)', ['meta', 'floor', 'baseboard', 'highWall'].every((k) => JSON.stringify(spec[k]) === JSON.stringify(fixedBase[k])));
  check('the living room: 12 walls, 62 furniture', spec.walls.filter(inStue).length === 12 && spec.furniture.filter(inStue).length === 62,
    `walls ${spec.walls.filter(inStue).length}, furniture ${spec.furniture.filter(inStue).length}`);
  const r = validate(spec);
  check('the validator has no errors (warnings are allowed)', !r.errors.length, show(r.errors));
  if (r.warnings.length) console.log(`  (${r.warnings.length} advarsler: ${show(r.warnings)})`);
  // integrator W1: the «registered, not modelled yet» leniency (pending) is for a branch that lacks another step's file;
  // once 10-hoved-rom.json (A1) and 20-/30-/35-*.json (B1+C1) are merged, nothing the real set refers to may be pending
  const merged = ['10-', '20-', '30-'].every((p) => realFiles.some((f) => f.name.startsWith(p)));
  if (merged) check('the merged house: no room or light group is pending (registered but not modelled)', !r.pending.length, JSON.stringify(r.pending));
  check('no open door leaf cuts a passage (D6)', r.doors.every((d) => d.blocked !== true), JSON.stringify(r.doors.filter((d) => d.blocked)));
  const notes = fs.readFileSync(path.join(ROOT, 'research/room-spec-notes.md'), 'utf8');
  check('room-spec-notes.md: the generated section sits between the markers, the hand-written notes are kept', notes.includes(house.NOTES_START) && notes.includes(house.NOTES_END)
    && notes.startsWith('# Romspesifikasjon – notater') && notes.includes('### Forkastet') && /\| Stue\/kjøkken \(`stue-kjokken`\) \| 1\. etasje \| living \| 53,78 m²/.test(notes));
}

// ---------------------------------------------------------------------------------------------------------------
section('Step 3\'s own house files (research/house/00-*.json)');
{
  check('the 00-files include 00-hus.json (the id register is not one of them)', own.some((f) => f.name === '00-hus.json') && !own.some((f) => f.name === '00-ids.json'), own.map((f) => f.name).join());
  check('they only append levels and rooms to the keys', Object.keys(ownSpec).join() === [...Object.keys(base), 'levels', 'rooms'].join(), Object.keys(ownSpec).join());
  check('they change nothing in the living room (= fixRoomSpec(research/room-spec.json))', JSON.stringify(stueOnly(ownSpec)) === JSON.stringify(fixRoomSpec(clone(base))));
  const r = validate(ownSpec);
  check('green: no errors, no warnings', !r.errors.length && !r.warnings.length, `${show(r.errors)} / ${show(r.warnings)}`);
  check('one level (hoved, floorY 0) and one room (stue-kjokken, 53,78 m², 12 walls)', r.levels.length === 1 && r.levels[0].id === 'hoved' && r.levels[0].floorY === 0
    && r.rooms.length === 1 && r.rooms[0].id === 'stue-kjokken' && near(r.rooms[0].area, 53.78, 0.005) && r.rooms[0].walls === 12);
  check('the measuring list has the estimated level fields', r.measureList.length === 1 && r.measureList[0].id === 'hoved' && r.measureList[0].fields.join() === 'slabThickness,ceilingDefault');
  check('…and its markdown names them under «Nivåer»', /- \*\*Nivåer\*\*\n {2}- 1\. etasje \(`levels\/hoved`\): `slabThickness`, `ceilingDefault`/.test(house.measureListMarkdown(r)));
  let threw = null;
  const bad = clone(ownSpec);
  bad.walls.find((w) => w.id === 'w-hoy').id = 'w-hoy-ny';
  try {
    house.validateHouse(bad, { registry });
  } catch (err) {
    threw = err;
  }
  check('throws (with the report) when there are errors', threw && /validateHouse: \d+ feil/.test(threw.message) && Array.isArray(threw.report?.errors));
}

// ---------------------------------------------------------------------------------------------------------------
section('mergeHouse');
{
  const names = realFiles.map((f) => f.name);
  check('houseFiles: research/house/NN-*.json sorted, 00-hus.json first, without the id register', names[0] === '00-hus.json' && names.join() === [...names].sort().join()
    && names.every((n) => house.HOUSE_FILE.test(n)) && !names.includes(house.REGISTRY_FILE), names.join());
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ip-house-files-'));
  fs.mkdirSync(path.join(tmp, 'house'));
  for (const f of ['10-a.json', '05-b.json', 'notes.json', 'x-10.json', '00-ids.json', '1-c.json']) fs.writeFileSync(path.join(tmp, 'house', f), '{}');
  check('…only names like 05-b.json are read (00-ids.json, notes.json, x-10.json, 1-c.json are not)', house.houseFiles(tmp).map((f) => f.name).join() === '05-b.json,10-a.json');
  check('…a research folder without house/ gives no files', house.houseFiles(path.join(tmp, 'house')).length === 0);
  fs.rmSync(tmp, { recursive: true, force: true });

  const before = JSON.stringify(base);
  const files = [
    { name: '40-test.json', data: {
      $comment: 'ignored',
      roomId: 'bad',
      levelId: 'hoved',
      outsideHouse: { entranceLevelY: -2.87 },
      walls: [{ id: 'w-test', from: [0, 0], to: [1, 0] }, { id: 'w-test-2', roomId: 'gang', from: [0, 0], to: [1, 0] }],
      rooms: [{ id: 'bad', name: 'Bad' }],
      floorOpenings: [{ id: 'hull-test', polygon: [] }],
      photoCameras: [{ file: 'bilder_hus/x/20261020_225413.jpg', pos: [1, 1.5, 1] }],
      kitchen: { notes: 'ny', items: [{ id: 'k-oy', position: [0, 0, 0], dims: { w: 1, d: 1, h: 1 } }, { id: 'k-ny', position: [1, 1, 1], dims: { w: 1, d: 1, h: 1 } }] },
      outside: { terrace: { floorY: -0.05 }, groundBelowY: null },
      wallOpenings: [{ wallId: 'w-gang', openings: [{ id: 'door-gang', connects: ['stue-kjokken', 'gang'], door: { openAngleDeg: 180, casing: { back: false } } }] }],
    } },
    { name: '41-test.json', data: { levels: [{ id: 'kjeller', name: 'Kjeller' }], walls: [{ id: 'w-hoy', roomId: 'stue-kjokken', from: [3.22, 8.34], to: [3.22, 4.43] }] } },
  ];
  const m = house.mergeHouse(base, RESEARCH, { files, registry });
  check('the input spec is not changed', JSON.stringify(base) === before);
  const wt = m.walls.find((w) => w.id === 'w-test');
  check('file-level roomId is stamped after the id; an explicit roomId is kept', wt.roomId === 'bad' && Object.keys(wt).join() === 'id,roomId,from,to'
    && m.walls.find((w) => w.id === 'w-test-2').roomId === 'gang');
  check('file-level levelId is stamped on rooms and floor openings (id, levelId, roomId)', m.rooms[0].levelId === 'hoved' && Object.keys(m.floorOpenings[0]).slice(0, 3).join() === 'id,levelId,roomId');
  check('photo cameras get the room after «file» and are matched by their file name', m.photoCameras.at(-1).roomId === 'bad' && Object.keys(m.photoCameras.at(-1))[1] === 'roomId');
  const hoyIndex = base.walls.findIndex((w) => w.id === 'w-hoy');
  check('an entry with an existing id is replaced in place, new ones are appended', m.walls[hoyIndex].id === 'w-hoy' && !('thickness' in m.walls[hoyIndex]) && m.walls.length === base.walls.length + 2);
  check('kitchen.items merged by id, the rest of kitchen deep-merged', m.kitchen.items.length === base.kitchen.items.length + 1 && m.kitchen.items.find((k) => k.id === 'k-oy').dims.w === 1
    && m.kitchen.items.at(-1).id === 'k-ny' && m.kitchen.notes === 'ny');
  check('outside is deep-merged (null removes a key)', m.outside.terrace.floorY === -0.05 && m.outside.terrace.deck?.color === base.outside.terrace.deck.color && !('groundBelowY' in m.outside));
  const dg = m.walls.find((w) => w.id === 'w-gang').openings.find((o) => o.id === 'door-gang');
  check('wallOpenings patches an existing opening (deep merge) without copying the wall', dg.door.openAngleDeg === 180 && dg.door.casing.back === false && dg.door.leaf.w === 0.93
    && dg.door.hinge === 'to' && dg.connects.join() === 'stue-kjokken,gang' && dg.width === 1.07);
  check('new top-level keys go last in the register order (levels, rooms, floorOpenings … outsideHouse), file keys are not merged', Object.keys(m).slice(Object.keys(base).length).join() === 'levels,rooms,floorOpenings,outsideHouse'
    && !('roomId' in m) && !('levelId' in m) && !('$comment' in m) && !('wallOpenings' in m));
  check('deterministic: the same files give the same JSON', JSON.stringify(house.mergeHouse(base, RESEARCH, { files, registry })) === JSON.stringify(m));
  const throws = (data, re) => {
    try {
      house.mergeHouse(base, RESEARCH, { files: [{ name: '50-x.json', data }], registry });
    } catch (err) {
      return re.test(err.message);
    }
    return false;
  };
  check('floor / meta / highWall cannot be changed from a house file', throws({ floor: { color: '#000000' } }, /floor.*kan ikke endres/) && throws({ meta: { version: 2 } }, /meta/) && throws({ highWall: {} }, /highWall/));
  check('wallOpenings on an unknown wall throws', throws({ wallOpenings: [{ wallId: 'w-finnes-ikke', openings: [] }] }, /finnes ikke/));
  check('a new opening whose id is on another wall throws', throws({ wallOpenings: [{ wallId: 'w-hoy', openings: [{ id: 'door-gang' }] }] }, /står allerede på w-gang/));
  check('an entry without id, or the same id twice in one file, throws', throws({ walls: [{ from: [0, 0] }] }, /mangler id/) && throws({ walls: [{ id: 'w-a' }, { id: 'w-a' }] }, /to ganger/));
  check('a list where room-spec has an object (and the other way) throws', throws({ outside: [] }, /liste her/) && throws({ walls: {} }, /objekt her/));
}

// ---------------------------------------------------------------------------------------------------------------
// The plan house (notes/hele-huset-design.md §1.4–§1.6): bad, gang, soverom, the stair, kjeller-gang and bod-1.

const unit = (a, b) => {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const l = Math.hypot(dx, dz);
  return [dx / l, dz / l];
};
const wall = (id, roomId, from, to, extra = {}) => {
  const d = unit(from, to);
  return { id, roomId, from, to, normal: [d[1] === 0 ? 0 : -d[1], d[0] === 0 ? 0 : d[0]], ...extra };
};
// the reconciled plan (notes/hele-huset-avstemming.md V1–V23, §2.4): hole with the top nosing on x 1,45, the basement
// hall after V57, the stair footprint after V19
const HOLE = [[0, 2.32], [1.45, 2.32], [1.45, 3.48], [1.85, 3.48], [1.85, 4.43], [0, 4.43]];
const KG = [[0.13, 2.32], [1.85, 2.32], [1.85, 2.56], [5.75, 2.56], [5.75, 5.23], [3.05, 5.23], [3.05, 4.43], [0.13, 4.43]];
const FOOTPRINT = [[0.13, 2.32], [1.45, 2.32], [1.45, 3.1], [1.04, 3.1], [1.04, 3.48], [1.76, 3.48], [1.76, 4.43], [0.13, 4.43]];
const DOOR = (id, offset, width, height, door, connects, extra = {}) => ({
  id, type: 'door', offset, width, height, sill: 0,
  frame: { color: '#1d1e21', width: 0.07, depth: 0.02 }, reveal: { depth: 0.1, color: '#1d1e21' },
  door: { leafColor: '#1d1e21', handleSide: 'to', handleHeight: 1.05, closed: true, ...door }, connects, interactive: true, ...extra,
});

function planFiles() {
  const hoved = {
    $comment: '10-hoved-rom.json etter §1.4 og §1.5',
    levelId: 'hoved',
    rooms: [
      { id: 'bad', name: 'Bad', kind: 'bathroom', polygon: [[0, 0], [2.53, 0], [2.53, 2.22], [0, 2.22]], floor: { material: 'vinyl', color: '#5a5759', pattern: 'cloudy' }, ceilingIds: ['c-bad'], acoustic: { mode: 'estimate' }, estimated: ['floor.color'], source: 'vaskerom.md (Tillegg)' },
      { id: 'gang', name: 'Gang', kind: 'hall', polygon: [[0, 2.32], [3.12, 2.32], [3.12, 4.43], [0, 4.43]], floor: { material: 'oak-plank', color: '#a59b8f', boards: 'z' }, ceilingIds: ['c-gang'], acoustic: { mode: 'estimate' } },
      { id: 'soverom', name: 'Soverom', kind: 'bedroom', polygon: [[0, 4.53], [3.12, 4.53], [3.12, 8.2], [0, 8.2]], floor: { material: 'oak-plank', color: '#a59b8f', boards: 'z' }, ceilingIds: ['c-soverom'], acoustic: { mode: 'estimate' } },
    ],
    walls: [
      wall('w-bad-ost', 'bad', [0, 0], [2.53, 0], { thickness: 0.3, exterior: true, height: 2.4, material: 'stone-panel', color: '#c6c1b9' }),
      wall('w-bad-sor', 'bad', [2.53, 0], [2.53, 2.22], { backOf: 'w-nisje-bak', material: 'stone-panel' }),
      wall('w-bad-gang', 'bad', [2.53, 2.22], [0, 2.22], { thickness: 0.1, height: 2.4, material: 'stone-panel',
        openings: [DOOR('door-bad', 0.08, 0.91, 2.15, { hinge: 'from', swing: 'in', opensInto: 'bad', leaf: { w: 0.77, h: 2.08 } }, ['bad', 'gang'], { estimated: ['width', 'height', 'door.leaf'] })] }),
      wall('w-bad-nord', 'bad', [0, 2.22], [0, 0], { thickness: 0.3, exterior: true, height: 2.4, material: 'stone-panel',
        openings: [{ id: 'win-bad', type: 'window', offset: 0.75, width: 0.48, height: 1.17, sill: 0.88, frosted: true, obstruction: 0.8, estimated: ['sill'] }] }),
      wall('w-gang-ost', 'gang', [0, 2.32], [3.12, 2.32], { backOf: ['w-bad-gang', 'w-nisje-side'] }),
      wall('w-gang-hall', 'gang', [3.12, 2.32], [3.12, 4.43], { backOf: 'w-gang' }),
      wall('w-gang-sov', 'gang', [3.12, 4.43], [0, 4.43], { thickness: 0.1, height: 2.4,
        openings: [DOOR('door-soverom', 0.06, 0.95, 2.12, { hinge: 'from', swing: 'out', opensInto: 'soverom' }, ['gang', 'soverom'])] }),
      wall('w-gang-nord', 'gang', [0, 4.43], [0, 2.32], { thickness: 0.3, exterior: true, height: 2.4 }),
      wall('w-sov-ost', 'soverom', [0, 4.53], [3.12, 4.53], { backOf: 'w-gang-sov' }),
      wall('w-sov-sor', 'soverom', [3.12, 4.53], [3.12, 8.2], { backOf: 'w-hoy' }),
      wall('w-sov-vest', 'soverom', [3.12, 8.2], [0, 8.2], { backOf: 'w-sov-tv' }),
      wall('w-sov-nord', 'soverom', [0, 8.2], [0, 4.53], { thickness: 0.3, exterior: true, height: 2.4,
        openings: [{ id: 'win-sov', type: 'window', offset: 0.94, width: 1.15, height: 1.1, sill: 0.95 }] }),
    ],
    wallOpenings: [{ wallId: 'w-gang', openings: [{ id: 'door-gang', connects: ['stue-kjokken', 'gang'], interactive: true, door: { openAngleDeg: 180, opensInto: 'gang', casing: { back: false } } }] }],
    ceilings: [
      { id: 'c-bad', roomId: 'bad', polygon: [[0, 0], [2.53, 0], [2.53, 2.22], [0, 2.22]], height: 2.4, estimated: ['height'] },
      { id: 'c-gang', roomId: 'gang', polygon: [[0, 2.32], [3.12, 2.32], [3.12, 4.43], [0, 4.43]], height: 2.4, estimated: ['height'] },
      { id: 'c-soverom', roomId: 'soverom', polygon: [[0, 4.53], [3.12, 4.53], [3.12, 8.2], [0, 8.2]], height: 2.4, estimated: ['height'] },
    ],
    lightGroups: [
      { id: 'bad', label: 'Bad', roomId: 'bad', dimmer: true, defaultDimmer: 0.6 },
      { id: 'gang', label: 'Gang og trapp', roomId: 'gang', dimmer: true, defaultDimmer: 0.5 },
      { id: 'soverom', label: 'Soverom', roomId: 'soverom', dimmer: true, defaultDimmer: 0.5 },
    ],
    builtInLights: [
      { id: 'l-bad-tak', roomId: 'bad', group: 'bad', type: 'plafond', position: [1.26, 2.4, 1.11], dims: { d: 0.42, h: 0.07 }, lumens: 1400, lightColorK: 4000, estimated: ['lumens', 'lightColorK'] },
      { id: 'l-gang-tak', roomId: 'gang', group: 'gang', type: 'plafond', position: [2.3, 2.4, 3.4], dims: { d: 0.3, h: 0.07 }, lumens: 1000, lightColorK: 3500, estimated: ['*'] },
      { id: 'l-sov-tak', roomId: 'soverom', group: 'soverom', type: 'plafond', position: [1.5, 2.4, 6.4], dims: { d: 0.4, h: 0.07 }, lumens: 1200, lightColorK: 4000, estimated: ['lumens'] },
    ],
    builtIns: [
      { id: 'bi-bad-dusj', roomId: 'bad', type: 'shower', mount: 'floor', position: [0.45, 0, 0.45], dims: { w: 0.9, d: 0.9, h: 2 }, rotationDeg: 0, params: { shape: 'pentagon', cut: 0.35, doors: 2 }, estimated: ['dims', 'params.cut'] },
      { id: 'bi-bad-wc', roomId: 'bad', type: 'wc', mount: 'wall', wallId: 'w-bad-nord', position: [0, 0, 1.85], dims: { w: 0.7, d: 0.2, h: 1.1 }, rotationDeg: 90, estimated: ['position', 'dims'] },
      { id: 'bi-bad-servant', roomId: 'bad', type: 'vanity', mount: 'wall', wallId: 'w-bad-ost', position: [1.75, 0.35, 0], dims: { w: 0.8, d: 0.46, h: 0.5 }, rotationDeg: 0, estimated: ['position'] },
      { id: 'bi-bad-speil', roomId: 'bad', type: 'mirror-round', mount: 'wall', wallId: 'w-bad-ost', position: [1.75, 1.05, 0], dims: { w: 0.7, d: 0.04, h: 0.7 }, light: { lumens: 300, lightColorK: 4000, group: 'bad' }, estimated: ['*'] },
    ],
  };
  const trapp = {
    $comment: '20-trapp.json etter avstemmingen §2.4 (V12–V23), med kjellergangen etter V57',
    levels: [{ id: 'kjeller', name: 'Kjeller', floorY: -2.55, slabThickness: 0.3, ceilingDefault: 2.25, plan: { file: 'bilder_hus/plantegning_kjeller.png', pxPerM: 60.25, originPx: [119.2, 112.1] }, estimated: ['floorY', 'ceilingDefault'], source: 'V1–V2, V12' }],
    rooms: [
      { id: 'trapp', name: 'Trappa', levelId: 'hoved', kind: 'hud', polygon: FOOTPRINT },
      { id: 'kjeller-gang', name: 'Gang', levelId: 'kjeller', kind: 'hall', polygon: KG, floor: { material: 'oak-plank', color: '#cbbfb0', boards: 'x' }, ceilingIds: [], acoustic: { mode: 'estimate' }, estimated: ['*'] },
    ],
    walls: [
      wall('w-kg-nisje', 'kjeller-gang', [0.13, 2.32], [1.85, 2.32], { thickness: 0.1, height: 2.25, topProfile: [[0, 2.55], [1.32, 2.55], [1.32, 2.25], [1.72, 2.25]], estimated: ['*'] }),
      wall('w-kg-nisje-side', 'kjeller-gang', [1.85, 2.32], [1.85, 2.56], { thickness: 0.21, height: 2.25, estimated: ['*'] }),
      wall('w-kg-ost', 'kjeller-gang', [1.85, 2.56], [5.75, 2.56], { thickness: 0.11, height: 2.25, estimated: ['*'] }),
      wall('w-kg-sor', 'kjeller-gang', [5.75, 2.56], [5.75, 5.23], { thickness: 0.41, height: 2.25, estimated: ['*'] }),
      wall('w-kg-vest-sor', 'kjeller-gang', [5.75, 5.23], [3.05, 5.23], { thickness: 0.09, height: 2.25, estimated: ['*'] }),
      wall('w-kg-sorvest', 'kjeller-gang', [3.05, 5.23], [3.05, 4.43], { thickness: 0.29, height: 2.25, estimated: ['*'] }),
      wall('w-kg-vest', 'kjeller-gang', [3.05, 4.43], [0.13, 4.43], { thickness: 0.12, height: 2.25, topProfile: [[0, 2.25], [1.2, 2.25], [1.2, 2.55], [2.92, 2.55]], estimated: ['*'],
        openings: [DOOR('door-vaskerom', 0.34, 0.87, 2.15, { hinge: 'from', swing: 'out', opensInto: 'vaskerom', leaf: { w: 0.73, h: 2.08 } }, ['kjeller-gang', 'vaskerom'], { estimated: ['height', 'door.leaf'] })] }),
      wall('w-kg-nord', 'kjeller-gang', [0.13, 4.43], [0.13, 2.32], { thickness: 0.43, exterior: true, height: 2.28, estimated: ['*'] }),
    ],
    floorOpenings: [{ id: 'trappehull', levelId: 'hoved', roomId: 'gang', stairId: 'trapp-kjeller', polygon: HOLE, edgeBand: { color: '#f2efe8', depth: 0.3 }, estimated: ['polygon'], source: 'V15–V16' }],
    stairs: [{
      id: 'trapp-kjeller', name: 'Trappa', type: 'half-turn-winder', fromLevel: 'kjeller', toLevel: 'hoved', openingId: 'trappehull', roomIds: ['kjeller-gang', 'gang'],
      risers: 13,
      top: { edge: [[1.45, 2.32], [1.45, 3.1]], down: [-1, 0], straightTreads: 1 },
      foot: { edge: [[1.73, 3.48], [1.73, 4.43]], down: [1, 0], straightTreads: 3 },
      well: { polygon: [[1.04, 3.1], [1.45, 3.1], [1.45, 3.48], [1.04, 3.48]], newel: [1.45, 3.1] },
      footprint: FOOTPRINT,
      walkLine: 'flight-centre', going: null, winders: 'balanced',
      tread: { thickness: 0.04, nosing: 0.03, batten: { h: 0.04, inset: 0.025 }, material: 'oak', color: '#ada396' },
      openRisers: true,
      stringers: { color: '#1d1e21', thickness: 0.05, depth: 0.28, footCut: 0.06 },
      ledge: { x: [0, 0.13], top: -0.27, color: 'sand' },
      guards: [
        { id: 'rekk-a', level: 'hoved', line: [[1.85, 4.43], [1.85, 3.48]] },
        { id: 'rekk-b', level: 'hoved', line: [[1.85, 3.48], [1.45, 3.48]] },
        { id: 'rekk-c', level: 'hoved', line: [[1.45, 3.48], [1.45, 3.1]] },
        { id: 'rekk-oye', on: 'well' },
      ],
      handrails: [{ side: 'outer', start: [1.4, 2.32], startHeight: 0.7, walls: ['øst', 'nord', 'vest'], height: 0.9, led: { walls: ['øst', 'nord'], lumensPerM: 120, lightColorK: 2900, group: 'gang' } }],
      estimated: ['risers', 'top', 'foot', 'well', 'footprint', 'tread', 'stringers.footCut', 'guards', 'handrails[0].startHeight', 'handrails[0].led', 'ledge'],
      source: 'hele-huset-avstemming.md V12–V23',
    }],
    lightGroups: [{ id: 'kjeller-gang', label: 'Kjellergang', roomId: 'kjeller-gang', dimmer: true, defaultDimmer: 0.5 }],
  };
  const kjeller = {
    $comment: '30-kjeller.json (utdrag): bod-1 med døra i nisjeveggen under trappa, og vaskerommet ved trappefoten',
    levelId: 'kjeller',
    rooms: [
      { id: 'bod-1', name: 'Bod', kind: 'storage', polygon: [[0.13, 0.13], [1.79, 0.13], [1.79, 2.22], [0.13, 2.22]], floor: { material: 'concrete', color: '#8a8580' }, ceilingIds: [], acoustic: { mode: 'estimate' }, closed: true, estimated: ['*'] },
      { id: 'vaskerom', name: 'Vaskerom', kind: 'laundry', polygon: [[0.13, 4.55], [2.76, 4.55], [2.76, 8.45], [0.13, 8.45]], floor: { material: 'vinyl', color: '#8c8789' }, ceilingIds: [], acoustic: { mode: 'estimate' }, estimated: ['*'] },
    ],
    walls: [
      wall('w-b1-ost', 'bod-1', [0.13, 0.13], [1.79, 0.13], { thickness: 0.43, exterior: true, height: 2.25, estimated: ['*'] }),
      wall('w-b1-sor', 'bod-1', [1.79, 0.13], [1.79, 2.22], { thickness: 0.27, height: 2.25, estimated: ['*'] }),
      wall('w-b1-vest', 'bod-1', [1.79, 2.22], [0.13, 2.22], { backOf: 'w-kg-nisje', estimated: ['*'] }),
      wall('w-b1-nord', 'bod-1', [0.13, 2.22], [0.13, 0.13], { thickness: 0.43, exterior: true, height: 2.25, estimated: ['*'] }),
      wall('w-vask-ost', 'vaskerom', [0.13, 4.55], [2.76, 4.55], { backOf: 'w-kg-vest' }),
      wall('w-vask-sor', 'vaskerom', [2.76, 4.55], [2.76, 8.45], { backOf: 'w-kg-sorvest' }),
      wall('w-vask-vest', 'vaskerom', [2.76, 8.45], [0.13, 8.45], { thickness: 0.1, height: 2.25, estimated: ['*'] }),
      wall('w-vask-nord', 'vaskerom', [0.13, 8.45], [0.13, 4.55], { thickness: 0.43, exterior: true, height: 2.25, estimated: ['*'] }),
    ],
    wallOpenings: [{ wallId: 'w-kg-nisje', openings: [DOOR('door-bod-1', 0.93, 0.79, 2.05, { hinge: 'to', swing: 'out', opensInto: 'bod-1', leaf: { w: 0.65, h: 1.98 } }, ['kjeller-gang', 'bod-1'], { estimated: ['*'] })] }],
    lightGroups: [{ id: 'boder', label: 'Boder', roomId: null, dimmer: false, defaultDimmer: 0 }],
    builtInLights: [{ id: 'l-bod-1', roomId: 'bod-1', group: 'boder', type: 'plafond', position: [0.96, 2.25, 1.175], dims: { d: 0.2, h: 0.1 }, lumens: 400, lightColorK: 2700, estimated: ['*'] }],
  };
  return [{ name: '10-hoved-rom.json', data: hoved }, { name: '20-trapp.json', data: trapp }, { name: '30-kjeller.json', data: kjeller }];
}

/**
 * Plan house spec, merged on top of step 3's own 00-files only (never the real 10-/20-/30- files, which would replace
 * or duplicate the fixtures); `edit(files)` may change the house files before the merge, `after(spec)` the merged spec.
 */
function planHouse(edit, after, drop = []) {
  const files = planFiles().filter((f) => !drop.includes(f.name.slice(0, 2)));
  if (edit) edit(Object.fromEntries(files.map((f) => [f.name.slice(0, 2), f.data])));
  const s = fixRoomSpec(house.mergeHouse(base, RESEARCH, { files: [...own, ...files], registry }));
  if (after) after(s);
  return s;
}
const opening = (s, id) => s.walls.flatMap((w) => w.openings || []).find((o) => o.id === id);
const stairOf = (s) => s.stairs.find((x) => x.id === 'trapp-kjeller');

section('Validator: the plan house (§1.4–§1.6, with the reconciliation V1–V70)');
const plan = validate(planHouse());
{
  check('green: no errors', !plan.errors.length, show(plan.errors));
  const area = (id) => plan.rooms.find((r) => r.id === id)?.area;
  check('areas: bad 5,62, gang 6,58, soverom 11,45 (±0,05), kjeller-gang 13,08 (§1.1), vaskerom 10,26', near(area('bad'), 5.62, 0.05) && near(area('gang'), 6.58, 0.05) && near(area('soverom'), 11.45, 0.05)
    && near(area('kjeller-gang'), 13.08, 0.01) && near(area('vaskerom'), 10.26, 0.01), ['bad', 'gang', 'soverom', 'kjeller-gang', 'vaskerom'].map(area).join(', '));
  check('the HUD room «trapp» overlaps the gang without an error, and has no area', plan.rooms.find((r) => r.id === 'trapp')?.area === null);
  const st = plan.stairs[0];
  const s0 = stairOf(planHouse());
  console.log(`  trapp: opptrinn ${st?.riser.toFixed(4)}, inntrinn ${st?.going.toFixed(4)}, ganglinje ${st?.walkLength.toFixed(3)}, 2r+g ${st?.twoRG.toFixed(4)}, ${st?.slopeDeg.toFixed(1)}°, fri høyde ${st?.minHeadroom.toFixed(3)}, kapselen ${st?.capsuleHeadroom.toFixed(3)}`);
  // nothing hard-codes the number of risers: the riser is −floorY / risers, the going the walk line / (risers − 1)
  check('stair: riser = −floorY / risers (13 → 0,196), risers × riser = 2,55', st && near(st.riser, 2.55 / s0.risers, 1e-9) && near(st.riser, 0.196, 0.0005) && near(st.riser * st.risers, 2.55, 1e-9));
  check('stair: the V13 walk line ≈ 2,87 m, going = walk / (risers − 1) ≈ 0,24, 2r + g ≈ 0,63, slope 39–40°', st && near(st.walkLength, 2.874, 0.01) && near(st.going, st.walkLength / (s0.risers - 1), 1e-9)
    && near(st.going, 0.24, 0.005) && near(st.twoRG, 0.632, 0.005) && st.slopeDeg >= 39 && st.slopeDeg <= 40, st && `${st.walkLength} ${st.going} ${st.twoRG} ${st.slopeDeg}`);
  check('stair: headroom ≥ 1,95 everywhere (2,25 under the slab edge in front of the foot), the capsule needs 1,97–1,98', st && near(st.minHeadroom, 2.25, 0.01) && st.capsuleHeadroom > 1.96 && st.capsuleHeadroom < 1.99);
  check('stair: no warning on the norms (2r + g, going), the hole or kjeller-gang (V13: the cross-sections stay inside)', !has(plan.warnings, /trapp-kjeller: (2·opptrinn|inntrinnet|trinnene går utenfor|fri høyde)/), show(plan.warnings));
  const dv = st?.doorClearance?.find((d) => d.door === 'door-vaskerom');
  check('door frames: the stringer foot (x 1,79) is ≥ 0,05 from the laundry door\'s north jamb (x 1,84), no warning (V17)', dv && dv.what === 'vangefoten' && near(dv.dist, 0.05, 1e-6)
    && !has(plan.warnings, /fra karmen til/), JSON.stringify(st?.doorClearance));
  const db = st?.doorClearance?.find((d) => d.door === 'door-bad');
  check('door frames: the top edge (x 1,45) is 0,09 from door-bad\'s north jamb (x 1,54, V15)', db && near(db.dist, 0.09, 1e-6), JSON.stringify(st?.doorClearance));
  check('bod-1: the door (x 1,06–1,85, 2,05 high) is not cut by the stair (Kontrollert (1)); the laundry door beside the foot neither', !has(plan.warnings, /dørhøyden/), show(plan.warnings));
  check('bod-1: the hole runs 0,06 past bod-1\'s back face (x 1,79) – the documented warning', has(plan.warnings, /door-bod-1 \(w-kg-nisje\): hullet havner ikke helt innenfor baksideflaten\(e\) w-b1-vest/));
  check('door-gang opened 180° keeps ≥ 0,75 m free width (D6)', plan.doors.find((d) => d.id === 'door-gang')?.blocked === false && plan.doors.find((d) => d.id === 'door-gang')?.leafRoom === 'gang');
  check('door-bad, door-soverom, door-bod-1 and door-vaskerom swing into their rooms without blocking', ['door-bad', 'door-soverom', 'door-bod-1', 'door-vaskerom'].every((id) => plan.doors.find((d) => d.id === id)?.blocked === false)
    && plan.doors.find((d) => d.id === 'door-soverom').leafRoom === 'soverom' && plan.doors.find((d) => d.id === 'door-vaskerom').leafRoom === 'vaskerom', JSON.stringify(plan.doors));
  check('no other warnings', plan.warnings.length === 1, show(plan.warnings));
  const ml = plan.measureList;
  check('measuring list: sorted by room (levels first), stair entries under «trapp»', ml[0].room === '$levels' && ml.some((m) => m.room === 'trapp' && m.id === 'trapp-kjeller')
    && ml.some((m) => m.room === 'bad' && m.coll === 'openings' && m.id === 'door-bad') && ml.findIndex((m) => m.room === 'bad') < ml.findIndex((m) => m.room === 'kjeller-gang'));
  const md = house.measureListMarkdown(plan);
  check('measuring list markdown: room table, stairs, estimated fields per room', /\| Bad \(`bad`\) \| 1\. etasje \| bathroom \| 5,62 m² \| 5,62 m² \|/.test(md) && /`trapp-kjeller`: 13 opptrinn à 0,196 m/.test(md)
    && /- \*\*Trappa \(`trapp`\)\*\*/.test(md) && /`stairs\/trapp-kjeller`: `risers`, `top`/.test(md));
  const walk = house.stairWalk(s0);
  check('stairWalk (V13): from the top nosing (1,45; 2,71) round the well to the lowest nosing (1,73; 3,955)', near(walk.at(0).p[0], 1.45, 1e-9) && near(walk.at(0).p[1], 2.71, 1e-9)
    && near(walk.at(walk.length).p[0], 1.73, 1e-9) && near(walk.at(walk.length).p[1], 3.955, 1e-9));
  check('stairWalk (V13): 0,41 straight, a quarter arc round the well\'s NE corner, 0,38 straight on x 0,585, a quarter arc round the NW corner, 0,69 straight', walk.segments.map((g) => g.kind).join() === 'line,arc,line,arc,line'
    && near(walk.segments[0].length, 0.41, 1e-9) && near(walk.segments[2].length, 0.38, 1e-9) && near(walk.segments[4].length, 0.69, 1e-9) && near(walk.r2, 0.455, 1e-9)
    && near(walk.at(walk.segments[2].start + 0.19).p[0], 0.585, 1e-9) && near(walk.segments[1].length + walk.segments[2].length + walk.segments[3].length, 1.77, 0.01), JSON.stringify(walk.segments));
  const mid = walk.at(walk.segments[1].start + walk.segments[1].length / 2);
  check('stairWalk (V13): the cross-section in a winder arc runs from the well corner to the shaft walls (inside x ≥ 0,13, z 2,32–4,43)', mid.section.some((q) => near(q[0], 1.04, 1e-9) && near(q[1], 3.1, 1e-9))
    && mid.section.every((q) => q[0] >= 0.13 - 1e-9 && q[1] >= 2.32 - 1e-9 && q[1] <= 4.43 + 1e-9), JSON.stringify(mid.section));
  check('stairWalk: beyond the foot the lower flight goes on (headroom under the slab edge)', near(walk.at(walk.length + 0.5).p[0], 2.23, 1e-9) && near(walk.at(walk.length + 0.5).p[1], 3.955, 1e-9));
  const straight = house.stairWalk({ type: 'straight', top: { edge: [[0, 0], [0, 1]], down: [1, 0] }, foot: { edge: [[3, 0], [3, 1]], down: [1, 0] } });
  check('stairWalk: a straight stair', near(straight.length, 3, 1e-9) && near(straight.at(1.5).p[0], 1.5, 1e-9));
  const noFoot = house.stairWalk({ ...s0, footprint: undefined });
  check('stairWalk: without a footprint (or bound) the middle stretch keeps the flights\' mean half width', near(noFoot.r2, (0.39 + 0.475) / 2, 1e-9));
}

{
  // the steps are built in parallel: without A1's file (bad, gang, soverom) the hole, the stair and the LED wait for
  // the hall – registered rooms / groups that are not modelled yet are warnings; an id that is not registered is not
  const r = validate(planHouse(null, null, ['10']));
  check('without 10-hoved-rom.json: no errors, «gang» (room and light group) is pending (one warning each)', !r.errors.length && r.pending.length === 2 && has(r.warnings, /rommet «gang» er registrert .* ikke modellert ennå/)
    && has(r.warnings, /lysgruppa «gang» er registrert .* ikke modellert ennå/), `${show(r.errors)} / ${show(r.warnings)}`);
  const r2 = validate(planHouse((f) => {
    f['20'].floorOpenings[0].roomId = 'gangen';
  }, null, ['10']));
  check('…but a room id that is not registered in 00-ids.json stays an error', has(r2.errors, /floorOpenings\/trappehull: rommet «gangen» finnes ikke/), show(r2.errors));
}

// ---------------------------------------------------------------------------------------------------------------
section('Validator: bad fixtures fail');
const fails = (name, s, re) => {
  const r = validate(s);
  check(name, has(r.errors, re), `errors: ${show(r.errors)}`);
  return r;
};
const measured = (f) => {
  delete f['20'].stairs[0].estimated;
  delete f['20'].floorOpenings[0].estimated;
  delete f['20'].levels[0].estimated;
};
fails('door in the wrong format (hinge/swing on the opening, no door:{…})', planHouse((f) => {
  const w = f['10'].walls.find((x) => x.id === 'w-bad-gang');
  const o = w.openings[0];
  w.openings[0] = { id: o.id, type: 'door', offset: o.offset, width: o.width, height: o.height, hinge: 'from', swing: 'in', leaf: { w: 0.79, h: 2.08 }, connects: o.connects };
}), /door-bad.*hinge, swing, leaf hører ikke hjemme her/);
fails('…and the missing door:{…} is named', planHouse((f) => {
  const w = f['10'].walls.find((x) => x.id === 'w-bad-gang');
  w.openings[0] = { id: 'door-bad', type: 'door', offset: 0.08, width: 0.93, height: 2.15, connects: ['bad', 'gang'] };
}), /door-bad.*en dør må ha door:\{/);
{
  // bod-2 (the grey store room) drawn over bod-1
  const rect = (roomId, p, x0, x1, z0, z1, t) => [
    wall(`w-${p}-ost`, roomId, [x0, z0], [x1, z0], { thickness: t }),
    wall(`w-${p}-sor`, roomId, [x1, z0], [x1, z1], { thickness: t }),
    wall(`w-${p}-vest`, roomId, [x1, z1], [x0, z1], { thickness: t }),
    wall(`w-${p}-nord`, roomId, [x0, z1], [x0, z0], { thickness: t }),
  ];
  const bod2 = (x0) => (f) => {
    f['30'].rooms.push({ id: 'bod-2', name: 'Bod (grå)', kind: 'storage', polygon: [[x0, 0.13], [6.33, 0.13], [6.33, 2.45], [x0, 2.45]], floor: { material: 'concrete', color: '#8a8580' }, ceilingIds: [], acoustic: { mode: 'estimate' } });
    f['30'].walls.push(...rect('bod-2', 'b2', x0, 6.33, 0.13, 2.45, 0.1));
  };
  fails('overlapping rooms', planHouse(bod2(1.5)), /rommene bod-1 og bod-2 overlapper/);
  fails('rooms that only overlap through a wall thickness (bod-1\'s 0,27 wall vs bod-2 starting at 1,90)', planHouse(bod2(1.9)), /walls\/w-b1-sor \(bod-1, 0,27 tykk\) står inne i rommet bod-2/);
}
fails('unknown archetype (instead of becoming a vase)', planHouse((f) => {
  f['10'].furniture = [{ id: 'f-seng', roomId: 'soverom', name: 'Seng', archetype: 'flying-bed', position: [1.55, 0, 7.2], rotationDeg: 90, dims: { w: 1.8, d: 2, h: 0.62 } }];
}), /furniture\/f-seng: arketypen «flying-bed» finnes ikke/);
fails('an alias as archetype (existing.js resolves aliases only through kind, so «sofa» would become a vase)', planHouse((f) => {
  f['10'].furniture = [{ id: 'f-sofa-sov', roomId: 'soverom', name: 'Sofa', archetype: 'sofa', position: [1.55, 0, 7.2], rotationDeg: 90, dims: { w: 1.8, d: 0.9, h: 0.8 } }];
}), /furniture\/f-sofa-sov: arketypen «sofa» er et alias – bruk «sofa-straight»/);
fails('a new entry without roomId lands in the living room – an error, also with levelId «kjeller»', planHouse((f) => {
  f['30'].walls.push({ id: 'w-x-kjeller', levelId: 'kjeller', from: [0.2, 0.2], to: [0.4, 0.2], normal: [0, 1], thickness: 0.1, height: 2.25 });
}), /walls\/w-x-kjeller: mangler roomId – uten roomId havner den i stua.*selv med levelId «kjeller»/);
fails('kjeller on another floorY than D2 (−2,55, in 00-ids.json)', planHouse((f) => {
  f['20'].levels[0].floorY = -2.7;
}), /levels\/kjeller: floorY -2\.7 ≠ -2\.55 i 00-ids\.json/);
{
  // replacing a photo-measured entry by id is invisible to the validator afterwards, so the merge warns
  const warned = [];
  const orig = console.warn;
  console.warn = (...m) => warned.push(m.join(' '));
  try {
    const tv = clone(base.furniture.find((x) => x.id === 'f-tv'));
    house.mergeHouse(base, RESEARCH, { files: [{ name: '50-x.json', data: { furniture: [{ ...tv, name: 'TV (flyttet)' }] } }], registry });
    house.mergeHouse(base, RESEARCH, { files: [{ name: '51-x.json', data: { roomId: 'soverom', furniture: [{ id: 'f-ny-stol', archetype: 'dining-chair', position: [1, 0, 6], dims: { w: 0.5, d: 0.5, h: 0.8 } }] } }], registry });
  } finally {
    console.warn = orig;
  }
  check('replacing a frozen living-room entry from a house file warns (only L1, L2 and C3 may, §0)', has(warned, /50-x\.json: furniture «f-tv» erstatter den fotomålte oppføringen/), show(warned));
  check('…and a new entry does not', !has(warned, /51-x\.json/), show(warned));
}
{
  const at90 = (f) => {
    f['10'].wallOpenings[0].openings[0].door.openAngleDeg = 90;
  };
  fails('an open door leaf against the railing: door-gang at 90° leaves 0,34 m to rekkverk A (D6)', planHouse((f) => {
    at90(f);
    measured(f);
  }), /door-gang \(w-gang\): det åpne dørbladet \(90°\) gir under 0,75 m fri bredde.*gang \(0,34 m til rekkverket\)/);
  // the opening angle is a modelling choice: estimated railings, hole or door never turn it into a warning
  const r = fails('…also with estimated railings and an estimated door (always an error, never a warning)', planHouse((f) => {
    at90(f);
    f['10'].wallOpenings[0].openings[0].estimated = ['offset', 'width', 'door'];
  }), /door-gang \(w-gang\): det åpne dørbladet \(90°\) gir under 0,75 m fri bredde.*0,34 m til rekkverket.*endre openAngleDeg/);
  check('…and it is not reported as a warning too', !has(r.warnings, /fri bredde/), show(r.warnings));
}
{
  // broken entries in a house file with a file-level roomId: the merge names the file instead of a raw TypeError
  const merr = (walls) => {
    try {
      house.mergeHouse(base, RESEARCH, { files: [{ name: '50-x.json', data: { roomId: 'bad', walls } }], registry });
    } catch (err) {
      return err;
    }
    return null;
  };
  const a = merr([null]);
  const b = merr([5]);
  check('mergeHouse: a null or number entry under a file-level roomId names the file (no TypeError)', a && !(a instanceof TypeError) && /research\/house\/50-x\.json: walls: hver oppføring må være et objekt/.test(a.message)
    && b && !(b instanceof TypeError) && /50-x\.json: walls: hver oppføring må være et objekt/.test(b.message), `${a?.message} / ${b?.message}`);
}
fails('a renamed id (w-hoy → w-hoyvegg)', planHouse(null, (s) => {
  s.walls.find((w) => w.id === 'w-hoy').id = 'w-hoyvegg';
  for (const w of s.walls) if (w.backOf === 'w-hoy') w.backOf = 'w-hoyvegg';
}), /walls\/w-hoy finnes ikke lenger/);
fails('a room that is not in 00-ids.json', planHouse((f) => {
  f['10'].rooms[0].id = 'kott';
}), /rooms\/kott: rommet står ikke i/);
fails('the same id twice (a wall id used for a ceiling)', planHouse((f) => {
  f['10'].ceilings[0].id = 'w-bad-ost';
}), /id-en «w-bad-ost» brukes to ganger/);
fails('an id with a wrong prefix', planHouse((f) => {
  f['10'].builtInLights[0].id = 'tak-bad';
}), /builtInLights\/tak-bad: nye id-er her skal matche \^l-/);
fails('a wall normal pointing out of the room', planHouse((f) => {
  f['10'].walls[0].normal = [0, -1];
}), /walls\/w-bad-ost: normal \[0,-1\] skal være \[0,000, 1,000\]/);
fails('walls that do not close the loop in order', planHouse((f) => {
  const ws = f['10'].walls;
  [ws[0], ws[1]] = [ws[1], ws[0]];
}), /rooms\/bad: veggene lukker ikke sløyfen/);
fails('a loop that does not follow the room polygon', planHouse((f) => {
  f['10'].rooms[0].polygon = [[0, 0], [2.6, 0], [2.6, 2.22], [0, 2.22]];
}), /rooms\/bad: veggsløyfen følger ikke rompolygonet/);
fails('a backOf face not exactly one thickness behind its wall', planHouse((f) => {
  const w = f['10'].walls.find((x) => x.id === 'w-sov-vest');
  w.from = [3.12, 8.22];
  w.to = [0, 8.22];
  f['10'].walls.find((x) => x.id === 'w-sov-sor').to = [3.12, 8.22];
  f['10'].walls.find((x) => x.id === 'w-sov-nord').from = [0, 8.22];
  f['10'].rooms[2].polygon = [[0, 4.53], [3.12, 4.53], [3.12, 8.22], [0, 8.22]];
}), /walls\/w-sov-vest: ligger 0,120 m bak w-sov-tv, men w-sov-tv er 0,140 tykk/);
fails('a double wall on the back of an existing one (no backOf, D13)', planHouse((f) => {
  const w = f['10'].walls.find((x) => x.id === 'w-bad-sor');
  delete w.backOf;
  w.thickness = 0.1;
}), /walls\/w-bad-sor ligger på baksiden av walls\/w-nisje-bak – bruk backOf/);
fails('swing «in» with opensInto the other room', planHouse((f) => {
  f['10'].walls.find((x) => x.id === 'w-gang-sov').openings[0].door.swing = 'in';
}), /door-soverom.*swing «in» slår inn i eierveggens rom «gang», men opensInto er «soverom»/);
fails('connects naming a room that is not behind the wall', planHouse((f) => {
  f['10'].walls.find((x) => x.id === 'w-bad-gang').openings[0].connects = ['bad', 'soverom'];
}), /door-bad.*connects sier «soverom», men bak veggen ligger «gang»/);
fails('a new door without connects', planHouse((f) => {
  delete f['10'].walls.find((x) => x.id === 'w-gang-sov').openings[0].connects;
}), /door-soverom.*mangler connects/);
fails('an opening that sticks out of its wall', planHouse((f) => {
  f['10'].walls.find((x) => x.id === 'w-bad-nord').openings[0].offset = 1.9;
}), /win-bad.*går utenfor veggen/);
fails('an opening on a backOf face', planHouse((f) => {
  f['10'].walls.find((x) => x.id === 'w-gang-hall').openings = [{ id: 'win-x', type: 'window', offset: 0.2, width: 0.5, height: 1, sill: 1 }];
}), /w-gang-hall: en backOf-flate har ingen egne åpninger/);
fails('a built-in light with kelvin/diameter (silently ignored by layout.js)', planHouse((f) => {
  f['10'].builtInLights[0].kelvin = 4000;
}), /l-bad-tak: kelvin hører ikke hjemme her – bruk lightColorK/);
fails('a light in a group that does not exist (no silent fallback to «kjokken»)', planHouse((f) => {
  f['10'].builtInLights[1].group = 'gangen';
}), /l-gang-tak: gruppa «gangen» finnes ikke/);
fails('the handrail LED in a light group that does not exist', planHouse((f) => {
  f['20'].stairs[0].handrails[0].led.group = 'trapp';
}), /trapp-kjeller: LED-lista i håndløperen er i gruppa «trapp»/);
fails('a light group that is not in 00-ids.json', planHouse((f) => {
  f['10'].lightGroups.push({ id: 'disco', label: 'Disco', roomId: 'gang' });
}), /lightGroups\/disco: gruppa står ikke i/);
fails('a hole outside its room', planHouse((f) => {
  f['20'].floorOpenings[0].roomId = 'bad';
}), /floorOpenings\/trappehull: hullet ligger ikke inne i rommet bad/);
fails('a door whose clear opening stands over the hole (measured)', planHouse((f) => {
  measured(f);
  const o = f['10'].walls.find((x) => x.id === 'w-bad-gang').openings[0];
  o.offset = 0.3;
  delete o.estimated;
}), /door-bad.*den frie åpningen står over hullet trappehull/);
fails('a door that swings over the stair hole (measured)', planHouse((f) => {
  // door-bad moved 0,22 m north (x 1,32–2,23) and swinging out into the gang: the leaf sweeps x 1,39–2,16
  measured(f);
  const o = f['10'].walls.find((x) => x.id === 'w-bad-gang').openings[0];
  o.offset = 0.3;
  Object.assign(o.door, { swing: 'out', opensInto: 'gang' });
  delete o.estimated;
}), /door-bad: døra slår inn over trappehullet trappehull/);
{
  // 15 risers (the photo notes' 15 × 0,17) on the same walk line: 2r + g 0,545, going 0,205 – only 13 fits (V12–V13)
  const r = fails('a measured stair outside the norms (2r+g, going) is an error', planHouse((f) => {
    measured(f);
    f['20'].stairs[0].risers = 15;
  }), /trapp-kjeller: 2·opptrinn \+ inntrinn = 0,5\d\d er utenfor 0,60–0,64$/);
  check('…and so is the going under 0,22', has(r.errors, /trapp-kjeller: inntrinnet på ganglinja er 0,2\d\d, under 0,22$/));
  const r14 = validate(planHouse((f) => {
    f['20'].stairs[0].risers = 14;
  }));
  check('…and 14 risers (the plan\'s 14 × 0,182) give 2r + g 0,585 – a warning while the stair is estimated', has(r14.warnings, /trapp-kjeller: 2·opptrinn \+ inntrinn = 0,58\d er utenfor.*anslått/) && !r14.errors.length, show(r14.warnings));
}
{
  // V17 / avstemming §2.4: the tread edge (with the nosing) and the stringer foot keep ≥ 0,05 from every door frame
  const laundry = (f) => f['20'].walls.find((x) => x.id === 'w-kg-vest').openings[0];
  fails('a measured tread edge 0,03 from a door frame (the laundry door moved 0,05 north: north jamb on x 1,79)', planHouse((f) => {
    measured(f);
    delete f['20'].stairs[0].stringers.footCut;
    laundry(f).offset = 0.39;
  }), /trapp-kjeller: nederste trinnkant \(med nesa\) står 0,030 fra karmen til door-vaskerom \(minst 0,05\)/);
  fails('a measured stringer foot 0,01 from a door frame (the wall stringer cut on x 1,83 instead of 1,79)', planHouse((f) => {
    measured(f);
    f['20'].stairs[0].stringers.footCut = 0.1;
  }), /trapp-kjeller: vangefoten står 0,010 fra karmen til door-vaskerom/);
  const r = validate(planHouse((f) => {
    f['20'].stairs[0].stringers.footCut = 0.1;
  }));
  check('…the same with an estimated stair is a warning', has(r.warnings, /trapp-kjeller: vangefoten står 0,010 fra karmen til door-vaskerom.*anslått/) && !r.errors.length, show(r.warnings));
  fails('a measured top edge 0,02 from door-bad\'s frame (the bathroom door moved 0,07 north)', planHouse((f) => {
    measured(f);
    const o = f['10'].walls.find((x) => x.id === 'w-bad-gang').openings[0];
    o.offset = 0.15;
    delete o.estimated;
  }), /trapp-kjeller: øverste trinnkant står 0,020 fra karmen til door-bad/);
}
fails('a stair that does not fit in its hole', planHouse((f) => {
  measured(f);
  f['20'].stairs[0].foot.edge = [[2.1, 3.48], [2.1, 4.43]];
}), /trapp-kjeller: trinnene går utenfor hullet trappehull/);
fails('a level whose floorY differs from 00-ids.json (hoved must be 0)', planHouse(null, (s) => {
  s.levels.find((l) => l.id === 'hoved').floorY = 0.1;
}), /levels\/hoved: floorY 0\.1 ≠ 0/);
fails('the living room polygon must stay floor.polygon', planHouse(null, (s) => {
  s.rooms.find((r) => r.id === 'stue-kjokken').polygon[0] = [2.6, 0];
}), /rooms\/stue-kjokken: polygonet må være floor\.polygon/);
fails('an unknown top-level key', planHouse((f) => {
  f['10'].builtins = [];
}), /ukjent toppnøkkel «builtins»/);
fails('a facade segment on a photo-measured wall of the living room', planHouse((f) => {
  f['10'].facadeSegments = [{ id: 'f-nord-hoved', wallIds: ['w-bad-nord', 'w-gang-nord', 'w-sov-nord', 'w-nord-tv'], material: 'cladding' }];
}), /facadeSegments\/f-nord-hoved: w-nord-tv er en av stuas fotomålte yttervegger/);
{
  // broken entries are reported, never a crash
  let r = null;
  let crash = '';
  try {
    r = validate(planHouse(null, (s) => {
      s.walls.push(null);
      s.rooms.push(null);
      s.furniture.push(null);
      s.walls[0].openings.push(null);
      s.stairs[0].guards.push(null);
      s.builtIns.push({ id: 'bi-x', roomId: 'bad', type: 'wc', mount: 'wall', wallId: 'w-bad-nord', position: 'midt på', dims: {} });
      s.floorOpenings.push({ id: 'hull-x', levelId: 'hoved', roomId: 'gang', polygon: [[0, 0]] });
    }));
  } catch (err) {
    crash = err.stack;
  }
  check('broken entries (null, bad positions, a one-point polygon) give errors, not a crash', r && has(r.errors, /walls: en oppføring er ikke et objekt/) && has(r.errors, /builtIns\/bi-x: position må være \[x, y, z\]/)
    && has(r.errors, /floorOpenings\/hull-x: polygon må være minst tre punkter/), crash.slice(0, 300) || show(r?.errors || []));
}
fails('a built-in on a wall of another room', planHouse((f) => {
  f['10'].builtIns[1].wallId = 'w-gang-nord';
}), /builtIns\/bi-bad-wc: veggen w-gang-nord er i rommet gang, ikke bad/);

// ---------------------------------------------------------------------------------------------------------------
console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
