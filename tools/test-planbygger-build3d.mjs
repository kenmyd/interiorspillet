/**
 * «Generer» → a walkable 3D house: every house of the test set generated (src/planbygger/generate.js), exported
 * (export.js) and built in Node with the game's own builders, the way the planbygger's 3D view does it (viewer.js:
 * home/layout.js buildLayout, home/rooms.js buildRooms, home/stairs.js buildStairs with viewer.js's straight-stair
 * workaround). Plain Node, no browser, no AI key – the AI answers are the recordings (tools/planbygger-ai-fixtures.mjs):
 *
 *   node tools/test-planbygger-build3d.mjs [--quick] [--only hus1,hus2] [--mode ai|noai|both] [--json file]
 *                                          (--quick: hus1, hus2 and hus4)
 *
 * Per house, once with the recorded answers and once without AI, after the defaults of every question are taken (what
 * a customer gets who clicks «Neste» through the guide):
 *   - the house file is valid: 0 errors in the game's validateHouse
 *   - the builders build it without throwing, with as many doors and windows as the data has
 * and per level:
 *   - at least one room
 *   - a spawn point (viewer.js spawnPoint, for the level: the largest room at its freest point) inside that room, on its
 *     floor (layout floorYAt) and at least a player's radius (PLAYER_R) from the room's edges
 *   - colliders: wall meshes of the level the player collides with
 * and with two levels or more, for each pair of neighbouring levels: a stair from the lower to the upper one whose treads
 * and collision the game's stair builder makes (stairLayout, stairColliders), its top on the upper floor and its foot on
 * the lower (floorYAt), and that the player can walk:
 *   - its collision wedge (rise over the walk line, stairs.js) no steeper than the player walks up: ground steeper than
 *     acos(WALKABLE_NORMAL_Y) ≈ 51,7° (src/config.js) is a wall to PlayerController, and its step-up does not land on it;
 *   - the game's player (PlayerController in a CollisionWorld with every collider of the house, as viewer.js sets them
 *     up) walks it up from 0,8 m in front of its foot to 0,6 m beyond its top and ends on the upper floor, and down
 *     again to the lower floor, steering along the walk line – a wall across the flight or at a landing, or a stair too
 *     steep, stops it.
 * A level without a stair to the one above (none found, or one too steep for the house format, taken out and asked:
 * generate.js) fails the stair checks: the player cannot get there.
 * Measured, not checked: the share of a level's rooms the player reaches from the spawn room through doors, passages
 * and the stair (a door the detection missed leaves a room closed – the numbers say where), and the validator's stair
 * numbers (going on the walk line, 2·riser + going: it warns below 0,22 m going).
 */
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, imp, check, section, done, validateGenerated } from './planbygger-lib.mjs';
import { fixtureAi } from './planbygger-ai-fixtures.mjs';
import { HOUSES, AI_ONLY, houseInputs, walkStair, collisionWorld, straightStairFix, MAX_SLOPE } from './planbygger-measure-all.mjs';

const G = await imp('src/planbygger/generate.js');
const M = await imp('src/planbygger/model.js');
const R = await imp('src/planbygger/regions.js');
const Q = await imp('src/planbygger/questions.js');
const E = await imp('src/planbygger/export.js');
const { buildLayout } = await imp('src/home/layout.js');
const { buildRooms } = await imp('src/home/rooms.js');
const St = await imp('src/home/stairs.js');
const { PLAYER } = await imp('src/config.js');

/** The player's radius (src/player): the spawn point must be at least this far from the room's edges. */
const PLAYER_R = PLAYER.radius;

const args = process.argv.slice(2);
const opt = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const quick = args.includes('--quick');
const only = opt('only', null)?.split(',');
const mode = opt('mode', 'both');
const houses = only ?? (quick ? ['hus1', 'hus2', 'hus4'] : HOUSES);
const modes = mode === 'both' ? [true, false] : [mode === 'ai'];

/** Distance from a point to a polygon's boundary (layout polygon: Vector2 points). */
function edgeDistance(x, z, poly) {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const dx = b.x - a.x;
    const dz = b.y - a.y;
    const L2 = dx * dx + dz * dz || 1e-12;
    const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.y) * dz) / L2));
    best = Math.min(best, Math.hypot(x - (a.x + dx * t), z - (a.y + dz * t)));
  }
  return best;
}

/** The rooms reached from a start room through every door / passage (connects) and the stairs (roomIds). */
function reachable(house, start) {
  const adj = new Map();
  const link = (a, b) => {
    if (!a || !b || a === b) return;
    if (!adj.has(a)) adj.set(a, new Set());
    if (!adj.has(b)) adj.set(b, new Set());
    adj.get(a).add(b);
    adj.get(b).add(a);
  };
  for (const w of house.walls) for (const o of w.openings || []) if (o.type !== 'window' && Array.isArray(o.connects)) link(o.connects[0], o.connects[1]);
  for (const s of house.stairs || []) link(s.roomIds?.[0], s.roomIds?.[1]);
  const seen = new Set([start]);
  const todo = [start];
  while (todo.length) for (const n of adj.get(todo.pop()) ?? []) if (!seen.has(n)) (seen.add(n), todo.push(n));
  return seen;
}

// ---------------------------------------------------------------------------------------------------------------
section('0. En åpen plan med en øy og en skillelinje (bygd for hånd): rom uten vegger mellom seg');
{
  // 10 × 6 m inside 0,25 m outer walls; a WC (2 × 1,6 m, 0,1 m walls, a door west) stands free in the open area; a
  // separator (the dash-dot line of two zones) runs north–south at x = 7. The format's rooms are simple polygons: the
  // area around the WC is cut in two (regions.js levelRooms, cutIslands), the separator splits off the east zone, and
  // the export makes neither a wall – a wall of no thickness with one passage over it all (export.js)
  const doc = M.createDoc('Øy og skillelinje');
  const lv = M.createLevel(doc, { id: 'hoved', image: { name: 'syntetisk', width: 1, height: 1, pxPerM: 100 } });
  lv.walls = [
    { id: 'n', a: [0, 0], b: [10, 0], t: 0.25 },
    { id: 'e', a: [10, 0], b: [10, 6], t: 0.25 },
    { id: 's', a: [10, 6], b: [0, 6], t: 0.25 },
    { id: 'w', a: [0, 6], b: [0, 0], t: 0.25 },
    { id: 'i1', a: [3, 2], b: [5, 2], t: 0.1 },
    { id: 'i2', a: [5, 2], b: [5, 3.6], t: 0.1 },
    { id: 'i3', a: [5, 3.6], b: [3, 3.6], t: 0.1 },
    { id: 'i4', a: [3, 3.6], b: [3, 2], t: 0.1 },
  ];
  lv.openings = [
    { id: 'o1', wall: 'i4', type: 'door', at: 0.8, width: 0.8, hinge: 'start', side: 1 },
    { id: 'o2', wall: 'w', type: 'door', at: 3, width: 0.9, hinge: 'start', side: 1 },
    { id: 'o3', wall: 's', type: 'window', at: 2, width: 1.2, sill: 0.9, height: 1.2 },
    { id: 'o4', wall: 'n', type: 'window', at: 8.5, width: 1.2, sill: 0.9, height: 1.2 },
  ];
  lv.separators = [{ id: 's1', a: [7, 0], b: [7, 6] }];
  const found = R.levelRooms(lv);
  check('levelRooms: fire rom – WC-en, området rundt den i to, og sonen øst for skillelinja – og to kutt', found.rooms.length === 4 && found.cuts.length === 2, `${found.rooms.length} rom (${found.rooms.map((r) => r.area.toFixed(2)).join(', ')}), ${found.cuts.length} kutt`);
  check('levelRooms: hvert rom er ett enkelt polygon, og arealene går opp (9,75 × 5,75 − WC-blokka 2,1 × 1,7)', Math.abs(found.rooms.reduce((s, r) => s + r.area, 0) - (9.75 * 5.75 - 2.1 * 1.7 + 1.9 * 1.5)) < 0.05, found.rooms.reduce((s, r) => s + r.area, 0).toFixed(3));
  const ex = E.exportHouse(doc);
  const v = await validateGenerated(ex);
  check('eksporten: 0 feil i spillets validator', v.errors.length === 0, v.errors.slice(0, 3).join(' | '));
  const open = ex.house.walls.filter((w) => w.thickness === 0);
  check(`eksporten: tre åpne romgrenser (to kutt og skillelinja), hver en vegg uten tykkelse med én åpning over hele lengden (${ex.report.counts.openBoundaries})`, ex.report.counts.openBoundaries === 3 && open.length === 3 && open.every((w) => w.openings?.length === 1 && w.openings[0].type === 'opening' && Math.abs(w.openings[0].width - Math.hypot(w.to[0] - w.from[0], w.to[1] - w.from[1])) < 0.002 && w.openings[0].height === w.height));
  check('eksporten: den andre siden av hver åpne romgrense er backOf den', open.every((w) => ex.house.walls.some((b) => [].concat(b.backOf ?? []).includes(w.id))));
  let built = null;
  let err = null;
  try {
    built = buildRooms({ quality: { level: 'low' } }, buildLayout(E.mergeOnto(E.baseSpec(), ex.house), undefined, { devWarnings: false }), null);
  } catch (e) {
    err = e;
  }
  check('spillets byggere bygger huset; veggene uten tykkelse får ingen flater', !!built && !err && built.walls.filter((w) => open.some((o) => o.id === w.id)).every((w) => !w.meshes?.length), err ? String(err.stack ?? err).split('\n').slice(0, 2).join(' | ') : '');
  const seen = reachable(ex.house, ex.house.rooms[0].id);
  check('alle fire rommene henger sammen gjennom døra og de åpne romgrensene', ex.house.rooms.every((r) => seen.has(r.id)), [...seen].join(', '));
  built?.dispose?.();
}

// ---------------------------------------------------------------------------------------------------------------
section('0b. Et rom som går rundt en vegg (bygd for hånd): veggen får sin egen tykkelse, døra i den kan gås gjennom');
{
  // 10 × 6 m; two walls stand into the room from the north wall and end free: a stub (0,1 m, 2,5 m long) and a wall
  // with a door (0,12 m, 4 m long) – the room goes round both, so the same room is on both sides of each. The export
  // made two exterior walls of 0,25 m out from each face of such a wall (overlapping, 0,4 m thick, with facade cladding
  // over the floor above): hus3's closet front under the stair stood 0,11 m into the stair's top
  const doc = M.createDoc('Rom rundt en vegg');
  const lv = M.createLevel(doc, { id: 'hoved', image: { name: 'syntetisk', width: 1, height: 1, pxPerM: 100 } });
  lv.walls = [
    { id: 'n', a: [0, 0], b: [10, 0], t: 0.25 },
    { id: 'e', a: [10, 0], b: [10, 6], t: 0.25 },
    { id: 's', a: [10, 6], b: [0, 6], t: 0.25 },
    { id: 'w', a: [0, 6], b: [0, 0], t: 0.25 },
    { id: 'stub', a: [3, 0], b: [3, 2.5], t: 0.1 },
    { id: 'skille', a: [7, 0], b: [7, 4], t: 0.12 },
  ];
  lv.openings = [
    { id: 'o1', wall: 'skille', type: 'door', at: 1.5, width: 0.9, hinge: 'start', side: 1 },
    { id: 'o2', wall: 'w', type: 'door', at: 3, width: 0.9, hinge: 'start', side: 1 },
  ];
  const ex = E.exportHouse(doc);
  const v = await validateGenerated(ex);
  check('eksporten: 0 feil i spillets validator', v.errors.length === 0, v.errors.slice(0, 3).join(' | '));
  const W = ex.house.walls;
  const len = (w) => Math.hypot(w.to[0] - w.from[0], w.to[1] - w.from[1]);
  // the two sides of each: a solid inner wall and, antiparallel one thickness behind it over the same stretch, a wall of
  // no thickness
  const twinOf = (w) => W.find((v) => v !== w && v.backOf == null && v.thickness === 0 && Math.abs(v.normal[0] + w.normal[0]) < 1e-6 && Math.abs(v.normal[1] + w.normal[1]) < 1e-6 && Math.abs((v.from[0] - w.from[0]) * w.normal[0] + (v.from[1] - w.from[1]) * w.normal[1] + w.thickness) < 0.006 && Math.abs(len(v) - len(w)) < 0.01);
  const pairs = W.filter((w) => w.thickness > 0 && !w.exterior && w.backOf == null).map((w) => [w, twinOf(w)]).filter(([, v]) => v);
  const stubSides = pairs.find(([w]) => Math.abs(w.thickness - 0.1) < 0.006) ?? [];
  const wallSides = pairs.find(([w]) => Math.abs(w.thickness - 0.12) < 0.006) ?? [];
  check(`stubben: én side eier veggen med tegningens tykkelse (0,1 m), den andre har ingen (${stubSides.map((w) => `${w.id} ${w.thickness}`).join(' / ') || 'ikke funnet'})`, stubSides.length === 2, JSON.stringify(W.map((w) => [w.id, w.thickness ?? 'backOf', w.exterior ?? false])));
  check(`skilleveggen med døra: det samme, 0,12 m (${wallSides.map((w) => `${w.id} ${w.thickness}`).join(' / ') || 'ikke funnet'})`, wallSides.length === 2);
  const ends = W.filter((w) => len(w) < 0.13 && w.thickness != null);
  check(`endene av veggene stikker ikke ut i rommet (${ends.map((w) => w.thickness).join(', ')} m), og ingen av veggene i rommet er yttervegg`, ends.length >= 2 && ends.every((w) => w.thickness <= 0.01) && [...stubSides, ...wallSides, ...ends].every((w) => !w.exterior));
  const door = W.flatMap((w) => w.openings || []).find((o) => o.type === 'door' && wallSides.some((w) => (w.openings || []).includes(o)));
  check(`døra i skilleveggen står på eierveggen og kobler rommet til «ute» (formatet vil ha to rom) – ${door ? JSON.stringify(door.connects) : 'ingen dør'}`, !!door && door.connects?.[1] === 'ute' && /samme rom på begge sider/.test(door.source ?? ''));
  // the player walks through that door: from 0,6 m before it to 0,6 m beyond it
  const layout = buildLayout(E.mergeOnto(E.baseSpec(), ex.house), undefined, { devWarnings: false });
  const built = buildRooms({ quality: { level: 'low' } }, layout, null);
  const col = collisionWorld(layout, [built]);
  const owner = wallSides.find((w) => w.thickness > 0);
  const d = [owner.to[0] - owner.from[0], owner.to[1] - owner.from[1]].map((c) => c / len(owner));
  const mid = [owner.from[0] + d[0] * (door.offset + door.width / 2), owner.from[1] + d[1] * (door.offset + door.width / 2)];
  const n = owner.normal;
  const line = { at: (u) => ({ p: [mid[0] + n[0] * (0.7 - u), mid[1] + n[1] * (0.7 - u)], dir: [-n[0], -n[1]] }), length: 1.4 };
  const through = walkStair(col, line, line.length, { up: false, startY: 0, endY: 0 });
  check(`spilleren går gjennom døra (stoppet ved ${through.u} av ${line.length + 0.6} m)`, through.ok);
  built.dispose?.();
}

section('0c. En åpning langs veggene til to rom (bygd for hånd): den åpner begge');
{
  // 10 × 6 m with a wall across at y = 3; the north half is two rooms (a wall at x = 5); a 5 m passage x 3–8 in the wall
  // across opens to both of them (hus4: a 4,5 m passage along the stair well and the room beside it opened only the
  // room it overlapped most – the stair came up against a wall)
  const doc = M.createDoc('Åpning langs to rom');
  const lv = M.createLevel(doc, { id: 'hoved', image: { name: 'syntetisk', width: 1, height: 1, pxPerM: 100 } });
  lv.walls = [
    { id: 'n', a: [0, 0], b: [10, 0], t: 0.25 },
    { id: 'e', a: [10, 0], b: [10, 6], t: 0.25 },
    { id: 's', a: [10, 6], b: [0, 6], t: 0.25 },
    { id: 'w', a: [0, 6], b: [0, 0], t: 0.25 },
    { id: 'tvers', a: [0, 3], b: [10, 3], t: 0.15 },
    { id: 'midt', a: [5, 0], b: [5, 3], t: 0.1 },
  ];
  lv.openings = [{ id: 'o1', wall: 'tvers', type: 'opening', at: 5.5, width: 5 }];
  const ex = E.exportHouse(doc);
  const v = await validateGenerated(ex);
  check('eksporten: 0 feil i spillets validator', v.errors.length === 0, v.errors.slice(0, 3).join(' | '));
  const ops = ex.house.walls.flatMap((w) => (w.openings || []).filter((o) => o.type === 'opening'));
  const total = ops.reduce((s, o) => s + o.width, 0);
  const seen = reachable(ex.house, ex.house.rooms[0].id);
  check(`alle tre rommene henger sammen gjennom åpningen (${ops.length} deler, ${total.toFixed(2)} m til sammen av 5 m)`, ex.house.rooms.length === 3 && ex.house.rooms.every((r) => seen.has(r.id)) && total > 4.8, JSON.stringify(ops.map((o) => [o.connects, o.width])));
}

section('0c2. En skrå vegg (bygd for hånd): én romkant og én vegg, med hele skyvedøra');
{
  // a room closed on one side by a wall at 29° (hus6's glazed wall, its direction and thickness): the raster staircase
  // along it deviates a little more than the ring simplification's tolerance, so it stayed short steps – in hus6 30
  // edges, 30 walls in the export, and its 4,4 m sliding door cut to 0,5 m (here one extra corner without the fix)
  const doc = M.createDoc('Skrå vegg');
  const lv = M.createLevel(doc, { id: 'hoved', image: { name: 'syntetisk', width: 1, height: 1, pxPerM: 100 } });
  const A = [1.0292, 3.7292];
  const B = [5.8024, 1.0657];
  lv.walls = [
    { id: 'skra', a: A, b: B, t: 0.3 },
    { id: 'e', a: B, b: [B[0], 7.5], t: 0.25 },
    { id: 's', a: [B[0], 7.5], b: [A[0], 7.5], t: 0.25 },
    { id: 'w', a: [A[0], 7.5], b: A, t: 0.25 },
  ];
  const skra = Math.hypot(B[0] - A[0], B[1] - A[1]);
  lv.openings = [
    { id: 'o1', wall: 'skra', type: 'door', variant: 'sliding', at: skra / 2, width: 3 },
    { id: 'o2', wall: 'w', type: 'door', at: 1.5, width: 0.9, hinge: 'start', side: 1 },
  ];
  const found = R.levelRooms(lv);
  const room = found.rooms[0];
  check(`rommet har én kant langs den skrå veggen (${room?.polygon.length ?? 0} hjørner, kanter på «skra»: ${room?.edges.filter((e) => e.wall === 'skra').length ?? 0})`, found.rooms.length === 1 && room.polygon.length === 4 && room.edges.filter((e) => e.wall === 'skra').length === 1);
  const ex = E.exportHouse(doc);
  const v = await validateGenerated(ex);
  const slant = ex.house.walls.filter((w) => Math.abs(w.from[0] - w.to[0]) > 0.05 && Math.abs(w.from[1] - w.to[1]) > 0.05);
  const door = slant.flatMap((w) => w.openings || [])[0];
  check(`eksporten: 0 feil, den skrå veggen er én vegg med hele skyvedøra (${slant.length} skrå vegger, åpning ${door?.width ?? 'ingen'} m av 3)`, v.errors.length === 0 && slant.length === 1 && Math.abs((door?.width ?? 0) - 3) < 0.01, v.errors.slice(0, 2).join(' | '));
}

section('0d. En rett trapp (bygd for hånd): gangbar når den er lang nok, for bratt når den er kort');
for (const [name, len, walkable] of [['3,3 m', 3.3, true], ['1,3 m', 1.3, false]]) {
  // two levels of one 6 × 6 m room; a straight stair 1 m wide down along y from y = 1,2
  const doc = M.createDoc(`Trapp ${name}`);
  for (const [id, floorY] of [['hoved', 0], ['etasje-2', 2.7]]) {
    const lv = M.createLevel(doc, { id, floorY, image: { name: id, width: 1, height: 1, pxPerM: 100 } });
    lv.walls = [
      { id: `${id}-n`, a: [0, 0], b: [6, 0], t: 0.25 },
      { id: `${id}-e`, a: [6, 0], b: [6, 6], t: 0.25 },
      { id: `${id}-s`, a: [6, 6], b: [0, 6], t: 0.25 },
      { id: `${id}-w`, a: [0, 6], b: [0, 0], t: 0.25 },
    ];
    lv.openings = id === 'hoved' ? [{ id: 'o1', wall: 'hoved-w', type: 'door', at: 3, width: 0.9, hinge: 'start', side: 1 }] : [];
  }
  doc.levels[1].stairs = [{ id: 't1', rect: [[1, 1.2], [2, 1.2 + len]], axis: 'y', down: 1 }];
  const ex = E.exportHouse(doc);
  const v = await validateGenerated(ex);
  const steep = ex.report.warnings.find((w) => /for bratt/.test(w));
  check(`${name}: 0 feil i validatoren, og eksporten ${walkable ? 'varsler ikke' : 'varsler'} om at den er for bratt`, v.errors.length === 0 && !!steep === !walkable, `${v.errors.slice(0, 2).join(' | ')} ${steep ?? ''}`);
  const layout = buildLayout(E.mergeOnto(E.baseSpec(), ex.house), undefined, { devWarnings: false });
  const built = buildRooms({ quality: { level: 'low' } }, layout, null);
  const st = layout.house.stairs[0];
  const sb = St.buildStairs({ quality: { level: 'low' } }, { ...layout, house: { ...layout.house, stairs: layout.house.stairs.map(straightStairFix) } });
  const col = collisionWorld(layout, [built, sb]);
  const lay = St.stairLayout(straightStairFix(st), layout.house.levels);
  const slope = (Math.atan2(2.7, lay.walk.length) * 180) / Math.PI;
  const upW = walkStair(col, lay.walk, lay.walk.length, { up: true, startY: 0, endY: 2.7 });
  const downW = walkStair(col, lay.walk, lay.walk.length, { up: false, startY: 2.7, endY: 0 });
  check(`${name}: ${slope.toFixed(1)}° – spilleren går den ${walkable ? 'opp og ned' : 'ikke opp'} (opp: u ${upW.u}, y ${upW.y}; ned: u ${downW.u}, y ${downW.y})`, walkable ? slope <= MAX_SLOPE && upW.ok && downW.ok : slope > MAX_SLOPE && !upW.ok);
  built.dispose?.();
  sb.dispose?.();
}

const results = [];
for (const h of houses) {
  for (const ai of modes) {
    // (the newer houses are generated with the AI only: measure-all.mjs AI_ONLY)
    if (!ai && AI_ONLY.has(h)) continue;
    const tag = `${h} ${ai ? 'med KI' : 'uten KI'}`;
    section(tag);
    const t0 = Date.now();
    let res;
    try {
      res = await G.generate(houseInputs(h), { ai: ai ? fixtureAi({ house: h }) : null });
    } catch (err) {
      check(`${tag}: generate krasjer ikke`, false, String(err?.stack ?? err));
      continue;
    }
    // the guide with every default taken (as «Neste» through all the cards)
    const answers = Object.fromEntries(res.questions.filter((q) => q.default != null).map((q) => [q.id, q.default]));
    const doc = Q.applyAnswers(res.doc, res.questions, answers);
    const ex = E.exportHouse(doc);
    const v = await validateGenerated(ex);
    const row = { house: h, ai, ms: Date.now() - t0, errors: v.errors.length, levels: [], stairs: [] };
    results.push(row);
    check(`${tag}: 0 feil i spillets validator (${v.errors.length})`, v.errors.length === 0, v.errors.slice(0, 3).join(' | '));
    let layout = null;
    let built = null;
    let stairsBuilt = null;
    let err = null;
    try {
      layout = buildLayout(E.mergeOnto(E.baseSpec(), ex.house), undefined, { devWarnings: false });
      built = buildRooms({ quality: { level: 'low' } }, layout, null);
      const fixed = { ...layout, house: { ...layout.house, stairs: layout.house.stairs.map(straightStairFix) } };
      if (layout.house.stairs.length) stairsBuilt = St.buildStairs({ quality: { level: 'low' } }, fixed);
    } catch (e) {
      err = e;
    }
    check(`${tag}: spillets byggere bygger huset (buildLayout, buildRooms${layout?.house.stairs.length ? ', buildStairs' : ''})`, !!built && !err, err ? String(err.stack ?? err).split('\n').slice(0, 3).join(' | ') : '');
    if (!built) continue;
    check(`${tag}: dørene og vinduene i dataene er bygd (${built.doors.length}/${ex.report.counts.doors} dører, ${built.windows.length}/${ex.report.counts.windows} vinduer)`, built.doors.length === ex.report.counts.doors && built.windows.length === ex.report.counts.windows);
    const H = layout.house;
    const levels = [...H.levels].sort((a, b) => a.floorY - b.floorY);
    for (const lv of levels) {
      const rooms = H.rooms.filter((r) => r.levelId === lv.id && !r.hud && r.id !== 'stue-kjokken' && r.polygon.length >= 3);
      const where = `${tag} ${lv.name ?? lv.id}`;
      const lrow = { level: lv.id, name: lv.name, rooms: rooms.length };
      row.levels.push(lrow);
      check(`${where}: minst ett rom (${rooms.length})`, rooms.length >= 1);
      if (!rooms.length) continue;
      // the spawn point for this level as viewer.js spawnPoint takes it on the main level
      const r = [...rooms].sort((a, b) => b.area - a.area)[0];
      const light = H.builtInLights.find((l) => l.roomId === r.id && l.position);
      const p = light ? [light.position.x, light.position.z] : [r.centroid.x, r.centroid.y];
      const inRoom = r.contains(p[0], p[1]);
      const floorY = H.floorYAt(p[0], p[1], lv.floorY + 0.1);
      const clear = edgeDistance(p[0], p[1], r.polygon);
      Object.assign(lrow, { spawnRoom: r.id, clear: Math.round(clear * 100) / 100 });
      check(`${where}: startpunkt i ${r.id} (${r.area.toFixed(1)} m²) på gulvet (${floorY == null ? 'intet gulv' : floorY.toFixed(2)} mot ${lv.floorY.toFixed(2)}), ${clear.toFixed(2)} m fra kantene`, inRoom && floorY != null && Math.abs(floorY - lv.floorY) < 0.02 && clear >= PLAYER_R);
      // colliders: the level's wall meshes (each room's solid group collides), and the doors' own
      const wallMeshes = built.walls.filter((w) => w.levelId === lv.id).reduce((n, w) => n + (w.meshes?.length ?? 0), 0);
      lrow.wallMeshes = wallMeshes;
      check(`${where}: kollisjon for veggene (${wallMeshes} veggflater)`, wallMeshes > 0);
      // measured: the rooms the player reaches from the spawn room
      const seen = reachable(ex.house, r.id);
      const reach = rooms.filter((x) => seen.has(x.id)).length;
      lrow.reach = reach;
      console.log(`  (målt) ${where}: ${reach} av ${rooms.length} rom nås fra ${r.id} gjennom dører, åpninger og trapp${reach < rooms.length ? `; ikke: ${rooms.filter((x) => !seen.has(x.id)).map((x) => x.id).join(', ')}` : ''}`);
    }
    // the stairs between neighbouring levels
    const col = levels.length > 1 && H.stairs.length ? collisionWorld(layout, [built, stairsBuilt]) : null;
    for (let i = 1; i < levels.length; i++) {
      const lo = levels[i - 1];
      const hi = levels[i];
      const st = H.stairs.find((s) => s.fromLevel === lo.id && s.toLevel === hi.id);
      const where = `${tag}: trapp ${lo.name ?? lo.id} → ${hi.name ?? hi.id}`;
      if (!st) {
        check(`${where} finnes`, false, `trapper: ${H.stairs.map((s) => `${s.fromLevel}→${s.toLevel}`).join(', ') || 'ingen'}`);
        row.stairs.push({ from: lo.id, to: hi.id, ok: false });
        continue;
      }
      const lay = St.stairLayout(straightStairFix(st), H.levels);
      const cols = St.stairColliders(lay);
      // the landings: a step (0,3 m) out of the stair at its top, on the upper floor, and in front of the lowest tread,
      // on the lower floor
      const top = lay.walk?.at(0);
      const foot = lay.walk?.at(lay.walk.length);
      const pt = top ? [top.p[0] - top.dir[0] * 0.3, top.p[1] - top.dir[1] * 0.3] : null;
      const yTop = pt ? H.floorYAt(pt[0], pt[1], hi.floorY + 0.1) : null;
      const pf = foot ? [foot.p[0] + foot.dir[0] * 0.3, foot.p[1] + foot.dir[1] * 0.3] : null;
      const yFoot = pf ? H.floorYAt(pf[0], pf[1], lo.floorY + 0.1) : null;
      const built3d = lay.treads.length > 0 && cols.length > 0 && yTop != null && Math.abs(yTop - hi.floorY) < 0.05 && yFoot != null && Math.abs(yFoot - lo.floorY) < 0.05;
      check(`${where}: ${st.type}, ${lay.treads.length} trinn, ${cols.length} kolliderere, gulv ved toppen ${yTop == null ? 'ingen' : yTop.toFixed(2)} (${hi.floorY.toFixed(2)}), ved foten ${yFoot == null ? 'ingen' : yFoot.toFixed(2)} (${lo.floorY.toFixed(2)})`, built3d);
      // walkable: the wedge's slope against the player's limit, then the player itself up and down
      const L = lay.walk?.length ?? 0;
      const rise = hi.floorY - lo.floorY;
      const slope = (Math.atan2(rise, L) * 180) / Math.PI;
      check(`${where}: stigningen ${slope.toFixed(1)}° (${rise.toFixed(2)} m over ${L.toFixed(2)} m ganglinje) er ikke brattere enn spilleren går (${MAX_SLOPE.toFixed(1)}°)`, L > 0 && slope <= MAX_SLOPE);
      const upW = L > 0 ? walkStair(col, lay.walk, L, { up: true, startY: lo.floorY, endY: hi.floorY }) : { ok: false };
      const downW = L > 0 ? walkStair(col, lay.walk, L, { up: false, startY: hi.floorY, endY: lo.floorY }) : { ok: false };
      check(`${where}: spilleren går trappa opp (stoppet ved u ${upW.u} av ${L.toFixed(2)} m, føttene på ${upW.y} mot ${hi.floorY.toFixed(2)}, ${upW.t} s)`, upW.ok);
      check(`${where}: spilleren går trappa ned (stoppet ved u ${downW.u}, føttene på ${downW.y} mot ${lo.floorY.toFixed(2)}, ${downW.t} s)`, downW.ok);
      const vs = v.report?.stairs?.find((s) => s.id === st.id);
      if (vs) console.log(`  (målt) ${where}: inntrinn ${vs.going.toFixed(3)} m på ganglinja (validatoren varsler under 0,22), 2·opptrinn + inntrinn ${vs.twoRG.toFixed(3)} (0,60–0,64)`);
      const ok = built3d && slope <= MAX_SLOPE && upW.ok && downW.ok;
      row.stairs.push({ from: lo.id, to: hi.id, type: st.type, treads: lay.treads.length, colliders: cols.length, slope: Math.round(slope * 10) / 10, walk: Math.round(L * 100) / 100, up: upW.ok, down: downW.ok, going: vs ? Math.round(vs.going * 1000) / 1000 : null, ok });
    }
    built.dispose?.();
    stairsBuilt?.dispose?.();
  }
}

section('Oppsummert');
for (const r of results) {
  console.log(`  ${r.house.padEnd(10)} ${r.ai ? 'KI ' : 'uten'} ${(r.ms / 1000).toFixed(1).padStart(5)} s  ${r.errors} feil  ${r.levels.map((l) => `${l.level}: ${l.rooms} rom, ${l.reach ?? 0} nås, ${l.wallMeshes ?? 0} veggflater`).join(' · ')}${r.stairs.length ? `  trapp: ${r.stairs.map((s) => (s.ok ? `${s.type} ${s.treads} trinn, ${s.slope}°, gås opp og ned` : s.type ? `${s.type} ${s.slope}°, IKKE GANGBAR (opp ${s.up ? 'ja' : 'nei'}, ned ${s.down ? 'ja' : 'nei'})` : 'MANGLER')).join(', ')}` : ''}`);
}
const jsonOut = opt('json', null);
if (jsonOut) fs.writeFileSync(path.resolve(jsonOut), `${JSON.stringify(results, null, 1)}\n`);
done();
