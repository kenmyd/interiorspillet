#!/usr/bin/env node
/**
 * Hele huset, steg 3 (S0-data): the normaliser's house merge and the validator (src/data/scripts/house.mjs).
 *   node tools/house-tests/data.test.mjs        (from anywhere; exit code 1 on failure – tools/test-house.mjs runs it)
 *
 * - re-running the normaliser reproduces src/data/room-spec.json and the generated «Målelista» byte for byte, and the
 *   house files change nothing in the living room (only `levels` and `rooms` are added);
 * - mergeHouse: stamping, replace / extend by id, kitchen.items, deep merge, wallOpenings, key order, protected keys,
 *   which files are read;
 * - validateHouse is green on today's data and on a «plan house» built from notes/hele-huset-design.md §1.4–§1.6
 *   (bad, gang, soverom, trappa, kjellergang, bod-1): stair numbers, warnings for estimated values;
 * - bad fixtures fail: door format, overlapping rooms, unknown archetype, an open door leaf against the railing, plus
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
{
  const keys = Object.keys(spec);
  check('room-spec keeps its keys in order, levels and rooms appended', keys.join() === [...Object.keys(base), 'levels', 'rooms'].join(), keys.join());
  const stueOnly = clone(spec);
  delete stueOnly.levels;
  delete stueOnly.rooms;
  check('the house files change nothing in the living room (= fixRoomSpec(research/room-spec.json))', JSON.stringify(stueOnly) === JSON.stringify(fixRoomSpec(clone(base))));
  const inStue = (e) => !e.roomId || e.roomId === house.STUE;
  check('the living room: 12 walls, 62 furniture', spec.walls.filter(inStue).length === 12 && spec.furniture.filter(inStue).length === 62);
  const notes = fs.readFileSync(path.join(ROOT, 'research/room-spec-notes.md'), 'utf8');
  check('room-spec-notes.md: the generated section sits between the markers, the hand-written notes are kept', notes.includes(house.NOTES_START) && notes.includes(house.NOTES_END)
    && notes.startsWith('# Romspesifikasjon – notater') && notes.includes('### Forkastet') && /\| Stue\/kjøkken \(`stue-kjokken`\) \| 1\. etasje \| living \| 53,78 m²/.test(notes)
    && /`slabThickness`, `ceilingDefault`/.test(notes));
}

// ---------------------------------------------------------------------------------------------------------------
section('Validator: today\'s data');
{
  const r = validate(spec);
  check('green: no errors, no warnings', !r.errors.length && !r.warnings.length, `${show(r.errors)} / ${show(r.warnings)}`);
  check('one level (hoved, floorY 0) and one room (stue-kjokken, 53,78 m², 12 walls)', r.levels.length === 1 && r.levels[0].id === 'hoved' && r.levels[0].floorY === 0
    && r.rooms.length === 1 && r.rooms[0].id === 'stue-kjokken' && near(r.rooms[0].area, 53.78, 0.005) && r.rooms[0].walls === 12);
  check('the measuring list has the estimated level fields', r.measureList.length === 1 && r.measureList[0].id === 'hoved' && r.measureList[0].fields.join() === 'slabThickness,ceilingDefault');
  let threw = null;
  const bad = clone(spec);
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
  check('houseFiles: research/house/NN-*.json sorted, without the id register', realFiles.map((f) => f.name).join() === '00-hus.json');
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
const HOLE = [[0, 2.32], [1.5, 2.32], [1.5, 3.48], [1.85, 3.48], [1.85, 4.43], [0, 4.43]];
const KG = [[0, 2.32], [1.75, 2.32], [1.75, 2.56], [5.6, 2.56], [5.6, 5.36], [2.91, 5.36], [2.91, 4.43], [0, 4.43]];
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
        openings: [DOOR('door-bad', 0.08, 0.93, 2.15, { hinge: 'from', swing: 'in', opensInto: 'bad', leaf: { w: 0.79, h: 2.08 } }, ['bad', 'gang'], { estimated: ['width', 'height', 'door.leaf'] })] }),
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
    $comment: '20-trapp.json etter §1.6, med en forenklet kjellergang',
    levels: [{ id: 'kjeller', name: 'Kjeller', floorY: -2.55, slabThickness: 0.3, ceilingDefault: 2.25, plan: { file: 'bilder_hus/plantegning_kjeller.png', pxPerM: [60.3, 56.8], originPx: [127, 120] }, estimated: ['floorY', 'ceilingDefault', 'plan.pxPerM'], source: 'D2, D3' }],
    rooms: [
      { id: 'trapp', name: 'Trappa', levelId: 'hoved', kind: 'hud', polygon: HOLE },
      { id: 'kjeller-gang', name: 'Gang (kjeller)', levelId: 'kjeller', kind: 'hall', polygon: KG, floor: { material: 'oak-plank', color: '#cbbfb0', boards: 'x' }, ceilingIds: [], acoustic: { mode: 'estimate' }, estimated: ['*'] },
    ],
    walls: [
      wall('w-kg-nisje', 'kjeller-gang', [0, 2.32], [1.75, 2.32], { thickness: 0.1, height: 2.25, estimated: ['*'] }),
      wall('w-kg-nisje-side', 'kjeller-gang', [1.75, 2.32], [1.75, 2.56], { thickness: 0.1, height: 2.25, estimated: ['*'] }),
      wall('w-kg-ost', 'kjeller-gang', [1.75, 2.56], [5.6, 2.56], { thickness: 0.1, height: 2.25, estimated: ['*'] }),
      wall('w-kg-sor', 'kjeller-gang', [5.6, 2.56], [5.6, 5.36], { thickness: 0.41, height: 2.25, estimated: ['*'] }),
      wall('w-kg-vest-sor', 'kjeller-gang', [5.6, 5.36], [2.91, 5.36], { thickness: 0.1, height: 2.25, estimated: ['*'] }),
      wall('w-kg-sorvest', 'kjeller-gang', [2.91, 5.36], [2.91, 4.43], { thickness: 0.1, height: 2.25, estimated: ['*'] }),
      wall('w-kg-vest', 'kjeller-gang', [2.91, 4.43], [0, 4.43], { thickness: 0.12, height: 2.25, estimated: ['*'] }),
      wall('w-kg-nord', 'kjeller-gang', [0, 4.43], [0, 2.32], { thickness: 0.3, exterior: true, height: 2.25, estimated: ['*'] }),
    ],
    floorOpenings: [{ id: 'trappehull', levelId: 'hoved', roomId: 'gang', stairId: 'trapp-kjeller', polygon: HOLE, edgeBand: { color: '#f2efe8', depth: 0.3 }, estimated: ['polygon'], source: 'gang-1etg.md' }],
    stairs: [{
      id: 'trapp-kjeller', name: 'Trappa', type: 'half-turn-winder', fromLevel: 'kjeller', toLevel: 'hoved', openingId: 'trappehull', roomIds: ['kjeller-gang', 'gang'],
      risers: 14,
      top: { edge: [[1.5, 2.32], [1.5, 3.1]], down: [-1, 0], straightTreads: 1 },
      foot: { edge: [[1.6, 3.48], [1.6, 4.43]], down: [1, 0], straightTreads: 3 },
      well: { polygon: [[1.2, 3.1], [1.5, 3.1], [1.5, 3.48], [1.2, 3.48]], newel: [1.5, 3.1] },
      walkLine: 'flight-centre', going: null,
      tread: { thickness: 0.045, nosing: 0.02, material: 'oak', color: '#bfab9b' },
      openRisers: true,
      stringers: { color: '#1d1e21', thickness: 0.05, depth: 0.28 },
      guards: [
        { id: 'rekk-a', level: 'hoved', line: [[1.85, 4.43], [1.85, 3.48]] },
        { id: 'rekk-b', level: 'hoved', line: [[1.85, 3.48], [1.5, 3.48]] },
        { id: 'rekk-c', level: 'hoved', line: [[1.5, 3.48], [1.5, 3.1]] },
        { id: 'rekk-oye', on: 'well' },
      ],
      handrails: [{ side: 'outer', start: [1.4, 2.32], walls: ['øst', 'nord', 'vest'], height: 0.9, led: { walls: ['øst', 'nord'], lumensPerM: 120, lightColorK: 2900, group: 'gang' } }],
      estimated: ['risers', 'top', 'foot', 'well', 'tread.color', 'guards', 'handrails[0].led'],
      source: 'gang-1etg.md, entre-gang-kjeller.md',
    }],
    lightGroups: [{ id: 'kjeller-gang', label: 'Kjellergang', roomId: 'kjeller-gang', dimmer: true, defaultDimmer: 0.5 }],
  };
  const kjeller = {
    $comment: '30-kjeller.json (utdrag): bod-1 med døra i nisjeveggen under trappa',
    levelId: 'kjeller',
    rooms: [{ id: 'bod-1', name: 'Bod', kind: 'storage', polygon: [[0, 0], [1.68, 0], [1.68, 2.22], [0, 2.22]], floor: { material: 'concrete', color: '#8a8580' }, ceilingIds: [], acoustic: { mode: 'estimate' }, closed: true, estimated: ['*'] }],
    walls: [
      wall('w-b1-ost', 'bod-1', [0, 0], [1.68, 0], { thickness: 0.3, exterior: true, height: 2.25, estimated: ['*'] }),
      wall('w-b1-sor', 'bod-1', [1.68, 0], [1.68, 2.22], { thickness: 0.2, height: 2.25, estimated: ['*'] }),
      wall('w-b1-vest', 'bod-1', [1.68, 2.22], [0, 2.22], { backOf: 'w-kg-nisje', estimated: ['*'] }),
      wall('w-b1-nord', 'bod-1', [0, 2.22], [0, 0], { thickness: 0.3, exterior: true, height: 2.25, estimated: ['*'] }),
    ],
    wallOpenings: [{ wallId: 'w-kg-nisje', openings: [DOOR('door-bod-1', 0.84, 0.79, 2.1, { hinge: 'from', swing: 'out', opensInto: 'bod-1' }, ['kjeller-gang', 'bod-1'], { estimated: ['*'] })] }],
    lightGroups: [{ id: 'boder', label: 'Boder', roomId: null, dimmer: false, defaultDimmer: 0 }],
    builtInLights: [{ id: 'l-bod-1', roomId: 'bod-1', group: 'boder', type: 'plafond', position: [0.84, 2.25, 1.11], dims: { d: 0.2, h: 0.1 }, lumens: 400, lightColorK: 2700, estimated: ['*'] }],
  };
  return [{ name: '10-hoved-rom.json', data: hoved }, { name: '20-trapp.json', data: trapp }, { name: '30-kjeller.json', data: kjeller }];
}

/** Plan house spec; `edit(files)` may change the house files before the merge, `after(spec)` the merged spec. */
function planHouse(edit, after) {
  const files = planFiles();
  if (edit) edit(Object.fromEntries(files.map((f) => [f.name.slice(0, 2), f.data])));
  const s = fixRoomSpec(house.mergeHouse(base, RESEARCH, { files: [...realFiles, ...files], registry }));
  if (after) after(s);
  return s;
}
const opening = (s, id) => s.walls.flatMap((w) => w.openings || []).find((o) => o.id === id);
const stairOf = (s) => s.stairs.find((x) => x.id === 'trapp-kjeller');

section('Validator: the plan house (§1.4–§1.6)');
const plan = validate(planHouse());
{
  check('green: no errors', !plan.errors.length, show(plan.errors));
  const area = (id) => plan.rooms.find((r) => r.id === id)?.area;
  check('areas: bad 5,62, gang 6,58, soverom 11,45 (±0,05), kjeller-gang 13,4', near(area('bad'), 5.62, 0.05) && near(area('gang'), 6.58, 0.05) && near(area('soverom'), 11.45, 0.05) && near(area('kjeller-gang'), 13.39, 0.05),
    ['bad', 'gang', 'soverom', 'kjeller-gang'].map(area).join(', '));
  check('the HUD room «trapp» overlaps the gang without an error, and has no area', plan.rooms.find((r) => r.id === 'trapp')?.area === null);
  const st = plan.stairs[0];
  console.log(`  trapp: opptrinn ${st?.riser.toFixed(4)}, inntrinn ${st?.going.toFixed(4)}, ganglinje ${st?.walkLength.toFixed(3)}, 2r+g ${st?.twoRG.toFixed(4)}, ${st?.slopeDeg.toFixed(1)}°, fri høyde ${st?.minHeadroom.toFixed(3)}, kapselen ${st?.capsuleHeadroom.toFixed(3)}`);
  check('stair: 14 risers of 0,182 (14 × riser = 2,55)', st && near(st.riser, 0.182, 0.0005) && near(st.riser * st.risers, 2.55, 1e-9));
  check('stair: going from the walk line ≈ 0,20–0,23, slope ≈ 38–42°', st && st.going >= 0.195 && st.going <= 0.23 && st.slopeDeg >= 38 && st.slopeDeg <= 43, st && st.going);
  check('stair: headroom ≥ 1,95 everywhere (2,25 under the slab edge in front of the foot)', st && near(st.minHeadroom, 2.25, 0.01));
  check('estimated stair: 2r+g outside 0,60–0,64 and the going under 0,22 are warnings', has(plan.warnings, /trapp-kjeller: 2·opptrinn \+ inntrinn = 0,5\d\d.*anslått/) && has(plan.warnings, /trapp-kjeller: inntrinnet på ganglinja.*under 0,22.*anslått/));
  check('bod-1: the door height under the stair is a warning (the builder cuts it)', has(plan.warnings, /door-bod-1: dørhøyden.*trappeundersiden.*kutter/), show(plan.warnings));
  check('door-gang opened 180° keeps ≥ 0,75 m free width (D6)', plan.doors.find((d) => d.id === 'door-gang')?.blocked === false && plan.doors.find((d) => d.id === 'door-gang')?.leafRoom === 'gang');
  check('door-bad, door-soverom and door-bod-1 swing into their rooms without blocking', ['door-bad', 'door-soverom', 'door-bod-1'].every((id) => plan.doors.find((d) => d.id === id)?.blocked === false)
    && plan.doors.find((d) => d.id === 'door-soverom').leafRoom === 'soverom', JSON.stringify(plan.doors));
  check('no other warnings', plan.warnings.length === 3, show(plan.warnings));
  const ml = plan.measureList;
  check('measuring list: sorted by room (levels first), stair entries under «trapp»', ml[0].room === '$levels' && ml.some((m) => m.room === 'trapp' && m.id === 'trapp-kjeller')
    && ml.some((m) => m.room === 'bad' && m.coll === 'openings' && m.id === 'door-bad') && ml.findIndex((m) => m.room === 'bad') < ml.findIndex((m) => m.room === 'kjeller-gang'));
  const md = house.measureListMarkdown(plan);
  check('measuring list markdown: room table, stairs, estimated fields per room', /\| Bad \(`bad`\) \| 1\. etasje \| bathroom \| 5,62 m² \| 5,62 m² \|/.test(md) && /`trapp-kjeller`: 14 opptrinn à 0,182 m/.test(md)
    && /- \*\*Trappa \(`trapp`\)\*\*/.test(md) && /`stairs\/trapp-kjeller`: `risers`, `top`/.test(md));
  const walk = house.stairWalk(stairOf(planHouse()));
  check('stairWalk: from the top nosing (1,50; 2,71) round the well to the lowest nosing (1,60; 3,955)', near(walk.at(0).p[0], 1.5, 1e-9) && near(walk.at(0).p[1], 2.71, 1e-9)
    && near(walk.at(walk.length).p[0], 1.6, 1e-9) && near(walk.at(walk.length).p[1], 3.955, 1e-9) && walk.at(walk.length / 2).p[0] < 0.7);
  const straight = house.stairWalk({ type: 'straight', top: { edge: [[0, 0], [0, 1]], down: [1, 0] }, foot: { edge: [[3, 0], [3, 1]], down: [1, 0] } });
  check('stairWalk: a straight stair', near(straight.length, 3, 1e-9) && near(straight.at(1.5).p[0], 1.5, 1e-9));
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
    f['30'].rooms.push({ id: 'bod-2', name: 'Bod (grå)', kind: 'storage', polygon: [[x0, 0], [6.22, 0], [6.22, 2.46], [x0, 2.46]], floor: { material: 'concrete', color: '#8a8580' }, ceilingIds: [], acoustic: { mode: 'estimate' } });
    f['30'].walls.push(...rect('bod-2', 'b2', x0, 6.22, 0, 2.46, 0.1));
  };
  fails('overlapping rooms', planHouse(bod2(1.5)), /rommene bod-1 og bod-2 overlapper/);
  fails('rooms that only overlap through a wall thickness (bod-1\'s 0,20 wall vs bod-2 starting at 1,70)', planHouse(bod2(1.7)), /walls\/w-b1-sor \(bod-1, 0,20 tykk\) står inne i rommet bod-2/);
}
fails('unknown archetype (instead of becoming a vase)', planHouse((f) => {
  f['10'].furniture = [{ id: 'f-seng', roomId: 'soverom', name: 'Seng', archetype: 'flying-bed', position: [1.55, 0, 7.2], rotationDeg: 90, dims: { w: 1.8, d: 2, h: 0.62 } }];
}), /furniture\/f-seng: arketypen «flying-bed» finnes ikke/);
{
  const at90 = (f) => {
    f['10'].wallOpenings[0].openings[0].door.openAngleDeg = 90;
  };
  fails('an open door leaf against the railing: door-gang at 90° leaves 0,34 m to rekkverk A (D6)', planHouse((f) => {
    at90(f);
    measured(f);
  }), /door-gang \(w-gang\): det åpne dørbladet \(90°\) gir under 0,75 m fri bredde.*gang \(0,34 m til rekkverket\)/);
  const r = validate(planHouse(at90));
  check('…with estimated railings it is a warning, not an error', !r.errors.length && has(r.warnings, /door-gang.*90°.*fri bredde.*anslått/), show(r.errors));
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
  o.offset = 0.25;
  delete o.estimated;
}), /door-bad.*den frie åpningen står over hullet trappehull/);
fails('a door that swings over the stair hole (measured)', planHouse((f) => {
  // door-bad moved 0,17 m north (x 1,35–2,28) and swinging out into the gang: the leaf sweeps x 1,42–2,21
  measured(f);
  const o = f['10'].walls.find((x) => x.id === 'w-bad-gang').openings[0];
  o.offset = 0.25;
  Object.assign(o.door, { swing: 'out', opensInto: 'gang' });
  delete o.estimated;
}), /door-bad: døra slår inn over trappehullet trappehull/);
{
  const r = fails('a measured stair outside the norms (2r+g, going) is an error', planHouse(measured), /trapp-kjeller: 2·opptrinn \+ inntrinn = 0,5\d\d er utenfor 0,60–0,64$/);
  check('…and so is the going under 0,22', has(r.errors, /trapp-kjeller: inntrinnet på ganglinja er 0,2\d\d, under 0,22$/));
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
