#!/usr/bin/env node
/**
 * Hele huset, steg 18 + 23 (B1 + C1): the data of the basement, the stair, the hole and outside
 * (research/house/20-trapp.json, 30-kjeller.json, 35-ute.json) against notes/hele-huset-avstemming.md (V1–V70):
 *   node tools/house-tests/kjeller.test.mjs                       (tools/test-house.mjs runs it)
 *   HOUSE_EXTRA=<file>[;<file>…] node tools/house-tests/kjeller.test.mjs
 *       also merges other house files (e.g. A1's 10-hoved-rom.json from its worktree) to check that the merge is green
 *
 * - the validator: no errors; only the expected warnings (the two documented door holes past a back face, rooms /
 *   groups another file brings); the stair numbers of V12–V13 (13 × 0,196, going ≈ 0,24, 2r + g ≈ 0,63, headroom);
 *   the door frames ≥ 0,05 from the tread edge and the stringer foot (V17);
 * - the rooms of §1.1 (areas, levels, floors −2,55 / −2,85, ceilings −0,30 / −0,50), the walls (one owner per wall,
 *   backOf faces), the doors of §5.1 (holes, leaves = hole − 2 × frame, hinges, swing, angles, closed stores), the
 *   exterior door (V27: interactive, out, 95°, element 2,0 with two sidelights), the opening with two steps (V24);
 * - lights in their rooms and groups, built-ins of the laundry (V58–V60), no loose furniture;
 * - the layout of the real room-spec: roomAt / floorYAt / ceilingHeightAt at the §7.4 points;
 * - outsideHouse: entranceLevelY derived, the forecourt, the terrace stair, the spawn derived from the door (V32).
 */
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, imp, readJson, check, section, near, done } from './_lib.mjs';

const house = await imp('src/data/scripts/house.mjs');
const { fixRoomSpec } = await imp('src/data/scripts/fixes.mjs');
const { buildLayout } = await imp('src/home/layout.js');
const RESEARCH = path.join(ROOT, 'research');
const registry = house.loadRegistry(RESEARCH);
const palette = readJson('src/data/palette.json');
const show = (list) => list.slice(0, 5).join(' | ') || '(ingen)';
const has = (list, re) => list.some((m) => re.test(m));

const extra = (process.env.HOUSE_EXTRA || '').split(';').filter(Boolean).map((f) => ({ name: path.basename(f), data: JSON.parse(fs.readFileSync(f, 'utf8')) }));
const files = [...house.houseFiles(RESEARCH).filter((f) => !extra.some((x) => x.name === f.name)), ...extra].sort((a, b) => (a.name < b.name ? -1 : 1));
if (extra.length) console.log(`  (med ${extra.map((f) => f.name).join(', ')} fra HOUSE_EXTRA)`);
const spec = fixRoomSpec(house.mergeHouse(readJson('research/room-spec.json'), RESEARCH, { files, registry }));
const report = house.validateHouse(spec, { registry, throw: false });
const own = Object.fromEntries(['20-trapp.json', '30-kjeller.json', '35-ute.json'].map((n) => [n.slice(0, 2), readJson(`research/house/${n}`)]));

// ---------------------------------------------------------------------------------------------------------------
section('The validator');
{
  check('no errors', !report.errors.length, show(report.errors));
  const expected = [
    /^openings\/door-bod-1 \(w-kg-nisje\): hullet havner ikke helt innenfor baksideflaten\(e\) w-b1-vest$/, // Kontrollert (1): 0,06 past bod-1
    /^openings\/door-bod-3 \(w-entre-ost\): hullet havner ikke helt innenfor baksideflaten\(e\) w-b3-vest$/, // Kontrollert (1): 0,04 before rom 3,70
    /er registrert i research\/house\/00-ids\.json, men ikke modellert ennå/, // a file another step owns (A1: gang)
  ];
  const other = report.warnings.filter((w) => !expected.some((re) => re.test(w)));
  check('only the expected warnings (two door holes past a back face, rooms / groups another house file brings)', !other.length, show(other));
  if (report.pending.length) console.log(`  (venter på: ${report.pending.map((p) => `${p.kind} ${p.id}`).join(', ')})`);
  if (extra.length) check('with HOUSE_EXTRA: nothing is pending any more', !report.pending.length, JSON.stringify(report.pending));
}

// ---------------------------------------------------------------------------------------------------------------
section('The level, the hole and the stair (V1–V2, V12–V23)');
const st = report.stairs.find((s) => s.id === 'trapp-kjeller');
const S = spec.stairs.find((s) => s.id === 'trapp-kjeller');
const level = spec.levels.find((l) => l.id === 'kjeller');
{
  check('kjeller: floorY −2,55, slab 0,30, ceiling 2,25, plan 60,25 px/m with origin (119,2; 112,1)', level && level.floorY === -2.55 && level.slabThickness === 0.3 && level.ceilingDefault === 2.25
    && level.plan.pxPerM === 60.25 && level.plan.originPx.join() === '119.2,112.1');
  check('13 risers: riser = −floorY / risers = 0,196 (nothing hard-coded)', st && S.risers === 13 && near(st.riser, -level.floorY / S.risers, 1e-12) && near(st.riser, 0.196, 0.0005), st && st.riser);
  check('V13: walk line ≈ 2,87, going ≈ 0,24, 2r + g ≈ 0,63, slope 39–40°, headroom 2,25 (capsule 1,97–1,98)', st && near(st.walkLength, 2.874, 0.01) && near(st.going, 0.24, 0.005) && near(st.twoRG, 0.632, 0.005)
    && st.slopeDeg >= 39 && st.slopeDeg <= 40 && near(st.minHeadroom, 2.25, 0.01) && st.capsuleHeadroom > 1.96 && st.capsuleHeadroom < 1.99, st && JSON.stringify({ ...st, doorClearance: undefined }));
  check('no warning on the stair (norms, footprint, headroom, doors over the stair, door heights)', !has(report.warnings, /stairs\/trapp-kjeller: |dørhøyden|slår inn over/), show(report.warnings));
  const dv = st?.doorClearance.find((d) => d.door === 'door-vaskerom');
  check('V17: the stringer foot (x 1,79) and the nosing of tread 1 (x 1,76) stay ≥ 0,05 from the laundry door\'s north jamb (x 1,84)', dv && dv.dist >= 0.05 - 1e-6 && near(dv.dist, 0.05, 1e-6), JSON.stringify(st?.doorClearance));
  check('top / foot / well / hole / footprint as §2.4 and V19', S.top.edge.flat().join() === '1.45,2.32,1.45,3.1' && S.foot.edge.flat().join() === '1.73,3.48,1.73,4.43'
    && S.well.polygon.flat().join() === '1.04,3.1,1.45,3.1,1.45,3.48,1.04,3.48' && S.footprint.length === 8 && near(S.foot.edge[0][0] + S.stringers.footCut, 1.79, 1e-9)
    && S.tread.nosing === 0.03 && S.tread.color === '#ada396' && S.ledge.top === -0.27 && S.handrails[0].startHeight === 0.7);
  const hole = spec.floorOpenings.find((h) => h.id === 'trappehull');
  check('the hole: 3,44 m², in gang on hoved, rekkverk A/B/C on its free edges', hole && near(house.polygonArea(hole.polygon), 3.44, 0.005) && hole.levelId === 'hoved' && hole.roomId === 'gang'
    && S.guards.filter((g) => g.line).every((g) => g.line.every(([x, z]) => house.pointInPolygon([x, z], hole.polygon) || hole.polygon.some((p, i) => house.distPointSeg([x, z], p, hole.polygon[(i + 1) % hole.polygon.length]) < 1e-9))));
  const trapp = spec.rooms.find((r) => r.id === 'trapp');
  check('the HUD room «trapp» uses the footprint (inside the hole and kjeller-gang)', trapp?.kind === 'hud' && JSON.stringify(trapp.polygon) === JSON.stringify(S.footprint)
    && house.overlapArea(S.footprint, hole.polygon) > house.polygonArea(S.footprint) - 1e-6
    && house.overlapArea(S.footprint, spec.rooms.find((r) => r.id === 'kjeller-gang').polygon) > house.polygonArea(S.footprint) - 1e-6);
}

// ---------------------------------------------------------------------------------------------------------------
section('The rooms (§1.1)');
const R = Object.fromEntries(report.rooms.map((r) => [r.id, r]));
{
  const areas = { 'kjeller-gang': 13.08, vaskerom: 10.26, 'soverom-kjeller': 7.44, kjellerstue: 20.6, 'entre-kjeller': 6.87, 'bod-1': 3.47, 'bod-2': 9.91, 'bod-3': 10.54 };
  for (const [id, a] of Object.entries(areas)) check(`${id}: ${String(a).replace('.', ',')} m² (§1.1), within ±10 % of the control area`, R[id] && near(R[id].area, a, 0.01) && Math.abs(R[id].deviation) <= 0.1, R[id] && `${R[id].area} ${R[id].deviation}`);
  const room = (id) => spec.rooms.find((r) => r.id === id);
  check('every basement room is on kjeller; the entrance and bod-3 have floorOffset −0,30 (floor −2,85), the rest none', Object.keys(areas).every((id) => room(id).levelId === 'kjeller')
    && room('entre-kjeller').floorOffset === -0.3 && room('bod-3').floorOffset === -0.3 && Object.keys(areas).filter((id) => !['entre-kjeller', 'bod-3'].includes(id)).every((id) => room(id).floorOffset == null));
  check('the three stores are closed (D11, fakta), the other rooms are not', ['bod-1', 'bod-2', 'bod-3'].every((id) => room(id).closed === true) && !['kjeller-gang', 'vaskerom', 'kjellerstue', 'soverom-kjeller', 'entre-kjeller'].some((id) => room(id).closed));
  check('floors: white-pigmented oak #cbbfb0 (boards N–S in the hall and the entrance, E–W in the living room and the bedroom), grey vinyl in the laundry',
    ['kjeller-gang', 'entre-kjeller'].every((id) => room(id).floor.color === '#cbbfb0' && room(id).floor.boards === 'x') && ['kjellerstue', 'soverom-kjeller'].every((id) => room(id).floor.boards === 'z')
    && room('vaskerom').floor.material === 'vinyl' && room('vaskerom').floor.color === '#8c8789');
}

// ---------------------------------------------------------------------------------------------------------------
section('Walls');
const W = Object.fromEntries(spec.walls.map((w) => [w.id, w]));
const ownWalls = own['30'].walls;
{
  check('every wall of 30-kjeller.json has a room on the basement and a correct normal (room on the right)', ownWalls.every((w) => {
    const d = [w.to[0] - w.from[0], w.to[1] - w.from[1]];
    const l = Math.hypot(d[0], d[1]);
    return spec.rooms.find((r) => r.id === w.roomId)?.levelId === 'kjeller' && near(w.normal[0], -d[1] / l, 1e-9) && near(w.normal[1], d[0] / l, 1e-9);
  }));
  check('shaft walls (V3, V16, V21): nisje on z 2,32 up to 2,55 for x ≤ 1,45, badveggen on z 4,43 up to 2,55 for x ≤ 1,85, the north wall up to the ledge (−0,27)',
    W['w-kg-nisje'].from[1] === 2.32 && W['w-kg-nisje'].topProfile[1].join() === '1.32,2.55' && W['w-kg-vest'].from[1] === 4.43 && W['w-kg-vest'].topProfile[2].join() === '1.2,2.55'
    && near(level.floorY + W['w-kg-nord'].height, S.ledge.top, 1e-9) && W['w-kg-nord'].from[0] === 0.13);
  check('outer faces (§1.2): north / east −0,30, west 11,68, the living room\'s south 6,75, the entrance\'s south 8,88 / west 6,26, rom 3,70 south 10,34 / west 3,18', [
    ['w-kg-nord', -0.3, 0], ['w-b1-ost', -0.3, 1], ['w-b3-ost', -0.3, 1], ['w-sk-vest', 11.68, 1], ['w-ks-vest', 11.68, 1], ['w-ks-sor', 6.75, 0], ['w-entre-sor', 8.88, 0], ['w-entre-vest', 6.26, 1],
    ['w-b3-sor', 10.34, 0], ['w-b3-vest-ute', 3.18, 1],
  ].every(([id, outer, ax]) => near(W[id].from[ax] - W[id].normal[ax] * W[id].thickness, outer, 1e-9)));
  check('the entrance\'s column is the living room\'s SE corner (V7): back faces of w-ks-sor and w-ks-ost, the north wall the back of w-kg-sor', W['w-entre-soyle-sor'].backOf === 'w-ks-sor'
    && W['w-entre-soyle-ost'].backOf === 'w-ks-ost' && W['w-entre-nord'].backOf === 'w-kg-sor');
  check('the pocket x 6,16–6,33 · z 2,56–2,97 is filled (w-b3-nord-a, 0,28)', near(W['w-b3-nord-a'].from[0] - W['w-b3-nord-a'].thickness, 6.16, 1e-9) && W['w-b3-nord-a'].to[1] === 2.56 && W['w-b3-nord-a'].from[1] === 2.97);
}

// ---------------------------------------------------------------------------------------------------------------
section('Doors and openings (§5.1, V27, V24)');
const ops = Object.fromEntries(spec.walls.flatMap((w) => (w.openings || []).map((o) => [o.id, { ...o, wall: w }])));
/** Absolute hole edges along the wall's running axis. */
const edgesOf = (o) => {
  const w = o.wall;
  const ax = w.to[0] !== w.from[0] ? 0 : 1;
  const s = Math.sign(w.to[ax] - w.from[ax]);
  const a = w.from[ax] + s * o.offset;
  const b = w.from[ax] + s * (o.offset + o.width);
  return [Math.min(a, b), Math.max(a, b)];
};
{
  const table = [
    ['door-vaskerom', 'w-kg-vest', 1.84, 2.71, 2.15, [0.73, 2.08], 'vaskerom'],
    ['door-kjellerstue', 'w-ks-ost', 3.21, 4.1, 2.1, [0.75, 2.03], 'kjellerstue'],
    ['door-soverom-kjeller', 'w-ks-nord', 10.01, 10.89, 2.12, [0.74, 2.05], 'soverom-kjeller'],
    ['door-bod-1', 'w-kg-nisje', 1.06, 1.85, 2.05, [0.65, 1.98], 'bod-1'],
    ['door-bod-2', 'w-kg-ost', 4.73, 5.68, 2.1, [0.81, 2.03], 'bod-2'],
    ['door-bod-3', 'w-entre-ost', 6.4, 7.4, 2.1, [0.86, 2.03], 'bod-3'],
  ];
  for (const [id, wallId, a, b, h, leaf, into] of table) {
    const o = ops[id];
    const [e0, e1] = o ? edgesOf(o) : [];
    check(`${id}: hole ${a}–${b} × ${h} in ${wallId}, leaf ${leaf.join(' × ')} (= hole − 2 × 0,07, − 0,07), opens into ${into}`, o && o.wall.id === wallId && near(e0, a, 1e-9) && near(e1, b, 1e-9) && o.height === h
      && near(o.door.leaf.w, o.width - 2 * o.frame.width, 1e-9) && near(o.door.leaf.h, o.height - o.frame.width, 1e-9) && o.door.leaf.w === leaf[0] && o.door.leaf.h === leaf[1]
      && o.door.opensInto === into && o.interactive === true && o.door.closed === true, o && JSON.stringify({ e0, e1, leaf: o.door.leaf }));
  }
  const hinge = (id) => {
    const o = ops[id];
    const [e0, e1] = edgesOf(o);
    const ax = o.wall.to[0] !== o.wall.from[0] ? 0 : 1;
    const fromEnd = Math.abs(o.wall.from[ax] - e0) < Math.abs(o.wall.from[ax] - e1) ? e0 : e1;
    return o.door.hinge === 'from' ? fromEnd : fromEnd === e0 ? e1 : e0;
  };
  check('hinges (§5.1): vaskerom south (x 2,71), kjellerstue north (x 3,21), soverom west (z 10,89), bod-1 south (1,85), bod-2 south (5,68), bod-3 north (6,40)', hinge('door-vaskerom') === 2.71
    && hinge('door-kjellerstue') === 3.21 && hinge('door-soverom-kjeller') === 10.89 && hinge('door-bod-1') === 1.85 && hinge('door-bod-2') === 5.68 && hinge('door-bod-3') === 6.4);
  check('the bedroom door opens 130° (V62), the others 90° (default)', ops['door-soverom-kjeller'].door.openAngleDeg === 130 && ['door-vaskerom', 'door-kjellerstue', 'door-bod-1', 'door-bod-2', 'door-bod-3'].every((id) => ops[id].door.openAngleDeg == null));
  const ute = ops['door-ute'];
  const [u0, u1] = edgesOf(ute);
  check('the exterior door (V27): in the entrance\'s south wall, leaf 1,0 × 2,05 on z 3,81–4,81, hinges east, opens OUT into «ute» 95°, interactive', ute.wall.id === 'w-entre-sor'
    && near(u0 + ute.frame.width, 3.81, 1e-9) && near(u1 - ute.frame.width, 4.81, 1e-9) && ute.door.leaf.w === 1.0 && ute.door.leaf.h === 2.05 && hinge('door-ute') === u0
    && ute.door.swing === 'out' && ute.door.opensInto === 'ute' && ute.door.openAngleDeg === 95 && ute.interactive === true && ute.connects.join() === 'entre-kjeller,ute');
  const sl = ['win-ute-ost', 'win-ute-vest'].map((id) => edgesOf(ops[id]));
  check('…the element 2,0 × 2,1 on z 3,31–5,31: two clear sidelights of 0,50 with the post (V27)', near(sl[0][0], 3.31, 1e-9) && near(sl[0][1], u0, 1e-9) && near(sl[1][0], u1, 1e-9) && near(sl[1][1], 5.31, 1e-9)
    && ute.element.from === 3.31 && ute.element.to === 5.31 && ['win-ute-ost', 'win-ute-vest'].every((id) => ops[id].type === 'window' && ops[id].height === 2.1));
  const oe = ops['open-entre'];
  const [o0, o1] = edgesOf(oe);
  const entre = spec.rooms.find((r) => r.id === 'entre-kjeller');
  const riser = (0 - entre.floorOffset) / oe.steps.count;
  check('the opening hall ↔ entrance (§5.1, V24): z 3,42–4,35 in the 0,41 wall, no door, top y −0,50, two steps of (−2,55 − −2,85) / 2 = 0,15', oe.type === 'opening' && !oe.door && near(o0, 3.42, 1e-9)
    && near(o1, 4.35, 1e-9) && oe.wall.thickness === 0.41 && near(level.floorY + oe.height, -0.5, 1e-9) && oe.steps.count === 2 && near(riser, 0.15, 1e-9) && oe.connects.join() === 'kjeller-gang,entre-kjeller');
  check('no door swings into the hall or over the stair (all leaves go into the rooms they open)', report.doors.filter((d) => d.room === 'kjeller-gang').every((d) => d.leafRoom !== 'kjeller-gang' && d.blocked === false));
}

// ---------------------------------------------------------------------------------------------------------------
section('Windows, ceilings, lights, fixtures, built-ins');
{
  const win = (id) => ops[id];
  check('kjellerstue: V1 z 7,41–8,76 and V2 z 9,50–10,85, sill 0,85, top 2,15 (V64)', near(edgesOf(win('win-ks-1'))[0], 7.41, 1e-9) && near(edgesOf(win('win-ks-1'))[1], 8.76, 1e-9)
    && near(edgesOf(win('win-ks-2'))[0], 9.5, 1e-9) && near(edgesOf(win('win-ks-2'))[1], 10.85, 1e-9) && ['win-ks-1', 'win-ks-2'].every((id) => win(id).sill === 0.85 && near(win(id).sill + win(id).height, 2.15, 1e-9)));
  check('bedroom: x 0,76–2,06, sill 0,88, top 2,19 (V63); laundry: z 6,91–8,19 (V58)', near(edgesOf(win('win-sk'))[0], 0.76, 1e-9) && near(edgesOf(win('win-sk'))[1], 2.06, 1e-9) && win('win-sk').sill === 0.88
    && near(win('win-sk').sill + win('win-sk').height, 2.19, 1e-9) && near(edgesOf(win('win-vask'))[0], 6.91, 1e-9) && near(edgesOf(win('win-vask'))[1], 8.19, 1e-9));
  const C = Object.fromEntries(spec.ceilings.map((c) => [c.id, c]));
  const room = (id) => spec.rooms.find((r) => r.id === id);
  const ceilY = (cid) => level.floorY + (room(C[cid].roomId).floorOffset ?? 0) + C[cid].height;
  check('ceilings: −0,30 in the hall, laundry, living room, bedroom and bod 1–2, −0,50 in the entrance and bod-3 (V28, V56); SAND in the hall and the entrance (V67)',
    ['c-kjeller-gang', 'c-vaskerom', 'c-kjellerstue', 'c-soverom-kjeller', 'c-bod-1', 'c-bod-2'].every((c) => near(ceilY(c), -0.3, 1e-9)) && ['c-entre', 'c-bod-3'].every((c) => near(ceilY(c), -0.5, 1e-9))
    && C['c-kjeller-gang'].paint === 'sand' && C['c-entre'].paint === 'sand' && C['c-vaskerom'].paint === '#ebeae6');
  const lights = spec.builtInLights.filter((l) => own['30'].builtInLights.some((x) => x.id === l.id));
  const count = (room) => lights.filter((l) => l.roomId === room).length;
  check('downlights: hall 5, entrance 4, laundry 8, living room 10, bedroom 5 (V57, V58, notes), one bulb per store', count('kjeller-gang') === 5 && count('entre-kjeller') === 4 && count('vaskerom') === 8
    && count('kjellerstue') === 10 && count('soverom-kjeller') === 5 && ['bod-1', 'bod-2', 'bod-3'].every((r) => count(r) === 1));
  check('every light sits inside its room, under its ceiling, in a group of its room (the stores: «boder»)', lights.every((l) => {
    const r = room(l.roomId);
    const g = spec.lightGroups.find((x) => x.id === l.group);
    const c = spec.ceilings.find((x) => x.roomId === l.roomId);
    return house.pointInPolygon([l.position[0], l.position[2]], r.polygon) && near(l.position[1], c.height, 1e-9) && g && (g.roomId === l.roomId || (g.id === 'boder' && r.kind === 'storage'));
  }));
  check('light groups: auto «on» in the hall, «evening» in the entrance and outside, the stores off (§4.5, §4.10)', spec.lightGroups.find((g) => g.id === 'kjeller-gang').auto === 'on'
    && spec.lightGroups.find((g) => g.id === 'entre').auto === 'evening' && spec.lightGroups.find((g) => g.id === 'ute').auto === 'evening' && spec.lightGroups.find((g) => g.id === 'boder').defaultDimmer === 0);
  const bi = Object.fromEntries(spec.builtIns.map((b) => [b.id, b]));
  check('the laundry (V58–V60): shower x 0,13–1,21 · z 4,55–5,72, WC centred z 6,32 on the north wall, one-tube towel radiator on x 1,31, cabinet row z 6,05–8,45, bench z 7,83–8,45',
    near(bi['bi-vask-dusj'].position[0] - bi['bi-vask-dusj'].dims.w / 2, 0.13, 1e-9) && near(bi['bi-vask-dusj'].position[0] + bi['bi-vask-dusj'].dims.w / 2, 1.21, 1e-9)
    && near(bi['bi-vask-dusj'].position[2] + bi['bi-vask-dusj'].dims.d / 2, 5.72, 1e-9) && bi['bi-vask-wc'].position[2] === 6.32 && bi['bi-vask-wc'].wallId === 'w-vask-nord'
    && bi['bi-vask-handkletorker'].params.form === 'single-tube' && bi['bi-vask-handkletorker'].position[0] === 1.31
    && near(bi['bi-vask-skaprad'].position[2] - bi['bi-vask-skaprad'].dims.w / 2, 6.05, 1e-9) && near(bi['bi-vask-skaprad'].position[2] + bi['bi-vask-skaprad'].dims.w / 2, 8.45, 1e-9)
    && near(bi['bi-vask-benk'].position[2] - bi['bi-vask-benk'].dims.d, 7.83, 1e-9) && bi['bi-vask-benk'].dims.h === 0.9);
  check('the dryer stands on the washer in the machine column (z 7,25–7,85)', near(bi['bi-vask-torketrommel'].position[1], bi['bi-vask-vaskemaskin'].dims.h + 0.02, 1e-9) && bi['bi-vask-vaskemaskin'].position[2] === 7.55);
  check('no built-in, light or fixture outside its room (no validator warning)', !has(report.warnings, /står utenfor rommet/));
  check('no loose furniture in the step\'s files (31-kjeller-innredning.json comes later), no clutter', !own['20'].furniture && !own['30'].furniture && !own['35'].furniture);
}

// ---------------------------------------------------------------------------------------------------------------
section('The layout of the merged room-spec (§7.4 points)');
{
  const warns = [];
  const orig = console.warn;
  console.warn = (...a) => warns.push(a.join(' '));
  let L;
  try {
    L = buildLayout(structuredClone(spec), palette);
  } finally {
    console.warn = orig;
  }
  const pending = new Set(report.pending.filter((p) => p.kind === 'room').map((p) => p.id));
  check('the layout builds without warnings (except rooms another house file brings)', warns.every((w) => [...pending].some((id) => w.endsWith(`unknown room ${id}`))), show(warns));
  const H = L.house;
  const at = (x, feet, z) => H.roomAt(x, feet + 0.9, z)?.id ?? null;
  const pts = [
    ['kjeller-gang', 3.5, -2.55, 3.8], ['kjellerstue', 3.5, -2.55, 6.2], ['vaskerom', 1.3, -2.55, 6.4], ['soverom-kjeller', 1.3, -2.55, 10.2], ['entre-kjeller', 7.4, -2.85, 4.4], ['entre-kjeller', 8.0, -2.85, 4.4],
    ['bod-1', 0.9, -2.55, 1.2], ['bod-2', 4.2, -2.55, 1.3], ['bod-3', 8.3, -2.85, 1.5],
  ];
  for (const [id, x, y, z] of pts) check(`roomAt(${x}, ${y} + 0,9, ${z}) = ${id}, floor ${y}`, at(x, y, z) === id && near(H.floorYAt(x, z, y), y, 1e-9), `${at(x, y, z)} ${H.floorYAt(x, z, y)}`);
  check('ceilingHeightAt (world y): hall −0,30, entrance −0,50, the stairwell from below = the ceiling of the floor above', near(H.ceilingHeightAt(3.5, 3.8, -2.55), -0.3, 1e-9) && near(H.ceilingHeightAt(7.4, 4.4, -2.85), -0.5, 1e-9)
    && H.ceilingHeightAt(1.0, 3.0, -2.55) > 2);
  const kg = H.ceilings.find((c) => c.id === 'c-kjeller-gang');
  check('the stair hole is cut from the hall ceiling (layout.js: floor openings of the level above)', kg.holes.length === 1);
  check('the stair surface runs from 0 at the top nosing to −2,55 at the bottom nosing', near(H.stairs[0].surfaceY(1.44, 2.71), 0, 0.02) && near(H.stairs[0].surfaceY(1.72, 3.955), -2.55, 0.02));
  check('the exterior door is interactive, the stores\' doors too (D7, D11)', ['door-ute', 'door-bod-1', 'door-bod-2', 'door-bod-3'].every((id) => H.doors.find((d) => d.id === id)?.interactive === true));
  check('no basement entry reaches the living room\'s old fields', !L.walls.some((w) => w.levelId === 'kjeller') && !L.builtInLights.some((l) => l.levelId === 'kjeller') && !L.ceilings.some((c) => c.levelId === 'kjeller'));
}

// ---------------------------------------------------------------------------------------------------------------
section('Outside (outsideHouse, V25–V36)');
{
  const O = spec.outsideHouse;
  const entre = spec.rooms.find((r) => r.id === 'entre-kjeller');
  const derived = level.floorY + entre.floorOffset - O.entranceLevelFrom.below;
  check('entranceLevelY = kjeller floorY + the entrance\'s floorOffset − 0,02 = −2,87 (V25), and the forecourt, landing, path and walk lie on it', near(O.entranceLevelY, derived, 1e-9) && near(O.entranceLevelY, -2.87, 1e-9)
    && [O.forecourt, O.landing, O.path, O.walk].every((p) => p.y === O.entranceLevelY));
  check('the forecourt x 8,88–12,6 · z 3,18–6,75, walkRects x 6,75–14 · z −0,2 … 9 (V26)', O.forecourt.polygon.flat().join() === '8.88,3.18,12.6,3.18,12.6,6.75,8.88,6.75'
    && O.walkRects[0].minX === 6.75 && O.walkRects[0].maxX === 14 && O.walkRects[0].minZ === -0.2 && O.walkRects[0].maxZ === 9);
  const T = O.terraceStair;
  check('the terrace stair (V33): 16 risers of 0,1775 from −0,03, 15 goings of 0,25 from x 7,62 to 11,37, the landing begins there', T.risers === 16 && near((T.topY - T.bottomY) / T.risers, 0.1775, 1e-9)
    && near(T.from[0] + (T.risers - 1) * T.going, T.to[0], 1e-9) && T.to[0] === 11.37 && O.landing.polygon[0][0] === T.to[0] && O.path.polygon[1][0] === T.to[0]);
  check('the ground near the house −2,95, nearGround.toX 12,8 (V33)', O.groundBelowY === -2.95 && O.terrain.nearHouseY === -2.95 && O.nearGround.y === -2.95 && O.nearGround.toX === 12.8);
  const door = ops['door-ute'];
  const faceX = door.wall.from[0] - door.wall.normal[0] * door.wall.thickness;
  const [d0, d1] = edgesOf(door);
  const leafZ = (d0 + d1) / 2;
  const sp = O.spawnOutside;
  const dir = [faceX - sp.pos[0], leafZ - sp.pos[2]];
  const yaw = (Math.atan2(-dir[0], -dir[1]) * 180) / Math.PI;
  check('spawn (V32): 3,3 m out from the door face and 0,3 m west of the leaf centre, y = entranceLevelY, yaw towards the leaf centre ≈ 85°, pitch −6°', near(sp.pos[0], faceX + 3.3, 0.05)
    && near(sp.pos[2], leafZ + 0.3, 0.05) && sp.pos[1] === O.entranceLevelY && near(sp.yawDeg, yaw, 1) && sp.yawDeg === 85 && sp.pitchDeg === -6 && sp.pos.join() === '12.2,-2.87,4.6', JSON.stringify({ sp, faceX, leafZ, yaw }));
  const swing = [faceX, faceX + door.door.leaf.w, d0 + door.frame.width, d1 - door.frame.width];
  check('…on the forecourt, inside walkRects, clear of the door swing (x 8,88–9,88 · z 3,81–4,81) and the pillar', house.pointInPolygon([sp.pos[0], sp.pos[2]], O.forecourt.polygon)
    && sp.pos[0] > O.walkRects[0].minX && sp.pos[0] < O.walkRects[0].maxX && !(sp.pos[0] < swing[1] && sp.pos[2] > swing[2] && sp.pos[2] < swing[3])
    && !(sp.pos[0] >= O.pillar.x[0] && sp.pos[0] <= O.pillar.x[1] && sp.pos[2] >= O.pillar.z[0] && sp.pos[2] <= O.pillar.z[1]));
  check('the niche: soffit −0,50 in #4a4642 over the covered L (also behind the pillar), pillar x 10,0–10,35 · z 5,65–6,0 (V28, V30)', O.soffits.find((s) => s.id === 'himling-nisje').y === -0.5
    && O.soffits.find((s) => s.id === 'himling-nisje').color === '#4a4642' && house.polygonArea(O.covered.polygon) > 4.7 && O.pillar.x.join() === '10,10.35' && O.pillar.z.join() === '5.65,6');
  check('three downlights in the soffit in group «ute» (V35), the doorbell at h 1,05', O.lights.length === 3 && O.lights.every((l) => l.group === 'ute' && l.position[1] === -0.5 && l.position[0] === 9.46)
    && near(O.fixtures.find((f) => f.id === 'fx-ute-ringeklokke').position[1] - O.entranceLevelY, 1.05, 1e-9) && spec.lightGroups.some((g) => g.id === 'ute'));
}

done();
