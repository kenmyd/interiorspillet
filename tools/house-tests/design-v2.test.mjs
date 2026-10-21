#!/usr/bin/env node
/**
 * Steg 16 (E3): acoustics per room and design version 2 (notes/hele-huset-design.md §5.4, §5.5, §7.2 row 16).
 *   - the original design holds the original furniture of every room (living room first, uid 'ex-<spec id>');
 *   - version 2 saves y LEVEL-LOCAL with `level`; in memory y is world y; a piece on level 'kjeller' at y 0 survives
 *     loading (also the entrance 0.30 below the level's floor); LIMITS.y is level-local;
 *   - the v1 fixture loads (w-hoy paint, win-s1 curtain, every saved item at its place, RT60 0.8254 in the living room)
 *     and gets the other rooms' originals;
 *   - meta.originalRooms adds the originals of rooms a save has not had, never brings back removed pieces;
 *   - meta.specRevision: an original the user never changed follows the data, a changed one stays;
 *   - Saves copies stored version 1 designs to interiorspillet.designs.v1.backup before the first write (once);
 *   - acoustics per room: the living room 0.86 s with exactly its own originals, the other rooms estimated from their
 *     surfaces, pieces and shading count in their own room only.
 */
import { imp, readJson, check, section, near, done } from './_lib.mjs';

const { DesignState, LIMITS, DESIGN_VERSION } = await imp('src/design/DesignState.js');
const { Saves, STORAGE_KEY, BACKUP_KEY } = await imp('src/design/Saves.js');
const { layout, buildLayout } = await imp('src/home/layout.js');
const { originalItems } = await imp('src/home/existing.js');
const A = await imp('src/design/Acoustics.js');
const catalog = await imp('src/catalog/index.js');

const H = layout.house;
const KJ = H.levelsById.kjeller.floorY;
const living = originalItems(layout);
const otherRooms = [...new Set(H.furniture.map((f) => f.roomId).filter((r) => r && r !== 'stue-kjokken'))];
const others = originalItems(layout, { rooms: otherRooms });

// ---------------------------------------------------------------------------------------------------------------
section('The original design: the whole house');
const d0 = new DesignState({ layout });
const keys = [...d0.items.keys()];
check(`version ${DESIGN_VERSION}`, DESIGN_VERSION === 2);
check(`${living.length} living-room originals first, then ${others.length} of ${otherRooms.length} other rooms`, d0.items.size === living.length + others.length
  && living.every((o, i) => keys[i] === o.uid) && others.every((o) => d0.items.has(o.uid)), `${d0.items.size} items`);
check('every other-room original has its room\'s level', others.every((o) => d0.get(o.uid).level === H.roomsById[o.roomId].levelId));
const stol = d0.get('ex-f-ks-stol-a');
check('a basement piece stands at world y (−2.55) in memory', stol?.level === 'kjeller' && stol.position[1] === KJ, JSON.stringify(stol?.position));
// the data's y is over the room's floor: the entrance lies 0.30 below the basement level (floorOffset)
const offRooms = others.filter((o) => H.roomsById[o.roomId].floorOffset);
check(`every other-room original stands at its ROOM's floor + its y (${offRooms.length} in the entrance / under the terrace)`, offRooms.length > 0
  && others.every((o) => near(d0.get(o.uid).position[1], H.roomsById[o.roomId].floorY + o.position[1], 1e-9)),
  others.filter((o) => !near(d0.get(o.uid).position[1], H.roomsById[o.roomId].floorY + o.position[1], 1e-9)).map((o) => `${o.uid} ${d0.get(o.uid).position[1]}`).join(', '));
check('living-room originals keep their y and get level hoved', living.every((o) => d0.get(o.uid).level === 'hoved' && d0.get(o.uid).position[1] === o.position[1]));
check('meta.originalRooms: the living room and every room with furniture', ['stue-kjokken', ...otherRooms].every((r) => d0.meta.originalRooms.includes(r)), d0.meta.originalRooms.join(','));
const optional = others.filter((o) => o.optional);
check('optional decor is a hidden original', optional.length > 0 && optional.every((o) => d0.get(o.uid).hidden === true));

// ---------------------------------------------------------------------------------------------------------------
section('Level-local y in a save');
const j0 = d0.toJSON();
const sj = j0.items.find((it) => it.uid === 'ex-f-ks-stol-a');
check('toJSON: version 2, the basement chair at y 0 on level kjeller', j0.version === 2 && sj.level === 'kjeller' && sj.position[1] === 0, JSON.stringify(sj?.position));
const tv = j0.items.find((it) => it.uid === 'ex-f-ks-tv');
const tvSpec = others.find((o) => o.uid === 'ex-f-ks-tv');
check('toJSON: a basement wall piece keeps its spec height (level-local)', tv.position[1] === tvSpec.position[1], `${tv.position[1]} vs ${tvSpec.position[1]}`);
const d1 = new DesignState({ layout, original: false });
d1.load(JSON.stringify(j0));
check('save → load round trip is identical', JSON.stringify(d1.toJSON()) === JSON.stringify(j0));
check('… and the basement chair is back at −2.55', d1.get('ex-f-ks-stol-a').position[1] === KJ);
// a piece on level 'kjeller' at y 0 (the plan's test) and one in the entrance 0.30 below the level's floor
const piece = { uid: 'it-kjeller-1', source: 'catalog', archetype: 'rug', name: 'Teppe i kjellerstua', mount: 'rug', position: [3.5, 0, 7.5], level: 'kjeller', dims: { w: 2, d: 1.4, h: 0.01 } };
const entre = { uid: 'it-entre-1', source: 'custom', archetype: 'plant-floor', name: 'Plante i entréen', mount: 'floor', position: [7.4, -0.3, 4.4], level: 'kjeller', dims: { w: 0.4, d: 0.4, h: 1 } };
const withPieces = { ...j0, items: [...j0.items, piece, entre] };
const d2 = new DesignState({ layout, original: false });
d2.load(withPieces);
check('a piece on level kjeller at y 0 survives loading (world y −2.55)', d2.get('it-kjeller-1')?.level === 'kjeller' && d2.get('it-kjeller-1').position[1] === KJ, JSON.stringify(d2.get('it-kjeller-1')?.position));
check('the entrance piece (y −0.30, under the level floor) survives (world −2.85)', d2.get('it-entre-1')?.position[1] === round9(KJ - 0.3), JSON.stringify(d2.get('it-entre-1')?.position));
const j2 = d2.toJSON();
check('… and is saved at y 0 / −0.30 again', j2.items.find((it) => it.uid === 'it-kjeller-1').position[1] === 0 && j2.items.find((it) => it.uid === 'it-entre-1').position[1] === -0.3);
check('LIMITS.y is level-local [−0.5, 4]', LIMITS.y[0] === -0.5 && LIMITS.y[1] === 4);
const d3 = new DesignState({ layout, original: false });
d3.load({ version: 2, meta: { originalRooms: ['stue-kjokken', ...otherRooms] }, items: [{ ...piece, position: [3.5, 9, 7.5] }, { ...piece, uid: 'it-x', level: 'loftet', position: [3.5, 0.2, 7.5] }] });
check('a saved y above the limit is cut to 4 over its floor; an unknown level → hoved', d3.get('it-kjeller-1').position[1] === round9(KJ + 4) && d3.get('it-x').level === 'hoved' && d3.get('it-x').position[1] === 0.2);
// live specs (Placement, duplicate): world y, the level follows the y when it is missing or does not fit
const d4 = new DesignState({ layout });
const u4 = d4.add({ archetype: 'pouf', name: 'Puff', position: [4.0, KJ, 8.0] });
check('add() of a live spec at world y −2.55 without level → level kjeller', d4.get(u4).level === 'kjeller' && d4.get(u4).position[1] === KJ);
const sofaUid = 'ex-f-buet-sofa';
d4.update(sofaUid, { position: [4.0, KJ, 8.0] });
check('a living-room piece carried down without a new level gets level kjeller (not clamped)', d4.get(sofaUid).level === 'kjeller' && d4.get(sofaUid).position[1] === KJ);
d4.update(sofaUid, { position: [4.0, 0, 8.0], level: 'hoved' });
check('… and back up with level hoved', d4.get(sofaUid).level === 'hoved' && d4.get(sofaUid).position[1] === 0);
const lamp = d4.add({ archetype: 'pendant-dome', name: 'Pendel', mount: 'ceiling', position: [3.5, -0.3, 8.0] });
check('a ceiling piece at the basement ceiling (−0.30) → level kjeller', d4.get(lamp).level === 'kjeller');
const dup = d4.duplicate('ex-f-ks-stol-a');
check('duplicate keeps the level and the world y', d4.get(dup).level === 'kjeller' && near(d4.get(dup).position[1], KJ, 1e-9));

// ---------------------------------------------------------------------------------------------------------------
section('Version 1: the fixture');
const fx = readJson('tools/house-tests/fixtures/design-v1.json');
const dv1 = new DesignState({ layout, original: false });
dv1.load(JSON.stringify(fx));
check('w-hoy keeps its paint, win-s1 its curtain', dv1.paints['w-hoy'] === '#7d8a80' && dv1.windows['win-s1']?.productId === 'bohus-rebell-sondre-gardinlengde-140x220');
check('every saved item is there, at its saved position', fx.items.every((it) => dv1.get(it.uid) && dv1.get(it.uid).position.every((v, i) => v === it.position[i])));
check('the other rooms\' originals are added', others.every((o) => dv1.items.has(o.uid)) && dv1.items.size === fx.items.length + others.length, `${dv1.items.size}`);
check('meta.originalRooms now lists every room', ['stue-kjokken', ...otherRooms].every((r) => dv1.meta.originalRooms.includes(r)));
check('living-room RT60 of the fixture still 0.8254 s', near(A.computeAcoustics(dv1, { layout }).rt60, 0.8254, 0.002), A.computeAcoustics(dv1, { layout }).rt60);
const v1json = dv1.toJSON();
check('saved again as version 2 with level on every item', v1json.version === 2 && v1json.items.every((it) => typeof it.level === 'string'));

// ---------------------------------------------------------------------------------------------------------------
section('meta.originalRooms');
const d5 = new DesignState({ layout });
d5.remove('ex-f-hjornesofa');
d5.remove('ex-f-sov-seng');
const j5 = d5.toJSON();
const d6 = new DesignState({ layout, original: false });
d6.load(j5);
check('removed pieces (living room and bedroom) stay removed', !d6.get('ex-f-hjornesofa') && !d6.get('ex-f-sov-seng') && d6.items.size === d0.items.size - 2);
const j5b = { ...j5, meta: { ...j5.meta, originalRooms: j5.meta.originalRooms.filter((r) => r !== 'soverom') } };
const d7 = new DesignState({ layout, original: false });
d7.load(j5b);
const sovOrig = others.filter((o) => o.roomId === 'soverom').map((o) => o.uid);
check('a room missing from the list gets its originals (the bed is back), the living room\'s removed sofa does not come back',
  !!d7.get('ex-f-sov-seng') && sovOrig.every((u) => d7.items.has(u)) && !d7.get('ex-f-hjornesofa') && d7.meta.originalRooms.includes('soverom'));
const fxNoSofa = { ...fx, items: fx.items.filter((it) => it.uid !== 'ex-f-hjornesofa') };
const d8 = new DesignState({ layout, original: false });
d8.load(fxNoSofa);
check('a version 1 save without the corner sofa: no sofa, but the bedroom is furnished', !d8.get('ex-f-hjornesofa') && !!d8.get('ex-f-sov-seng'));
const dm = new DesignState({ layout, original: false });
dm.load({ version: 2, meta: { name: 'Tom', originalRooms: ['stue-kjokken', ...otherRooms] }, items: [] });
check('an empty version 2 design that has had every room stays empty', dm.items.size === 0);

// ---------------------------------------------------------------------------------------------------------------
section('meta.specRevision');
// layout B: the data moved the bedside table (as a photo-fit step would); the user moved the wardrobe in design A
const specB = JSON.parse(JSON.stringify(readJson('src/data/room-spec.json')));
const nb = specB.furniture.find((f) => f.id === 'f-sov-nattbord');
nb.position = [nb.position[0] - 0.1, nb.position[1], nb.position[2] + 0.05];
const gb = specB.furniture.find((f) => f.id === 'f-sov-garderobe');
gb.position = [gb.position[0] + 0.05, gb.position[1], gb.position[2]];
const layoutB = buildLayout(specB, undefined, { devWarnings: false });
const dA = new DesignState({ layout });
const movedByUser = [...dA.get('ex-f-sov-garderobe').position];
movedByUser[2] += 0.2;
dA.update('ex-f-sov-garderobe', { position: movedByUser });
const jA = JSON.parse(JSON.stringify(dA.toJSON()));
const dB = new DesignState({ layout: layoutB, original: false });
dB.load(jA);
const nbB = dB.get('ex-f-sov-nattbord').position;
check('an original the user never changed follows the new data', near(nbB[0], nb.position[0], 1e-9) && near(nbB[2], nb.position[2], 1e-9), JSON.stringify(nbB));
check('an original the user moved keeps the user\'s place', near(dB.get('ex-f-sov-garderobe').position[2], movedByUser[2], 1e-9));
check('every saved original has a revision', Object.keys(jA.meta.specRevision).length === jA.items.filter((it) => it.source === 'existing').length);

// ---------------------------------------------------------------------------------------------------------------
section('Saves: the version 1 backup');
const mem = new Map();
const storage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
const v1Store = JSON.stringify({ version: 1, active: 'Gardin', designs: { Gardin: fx }, autosave: null });
mem.set(STORAGE_KEY, v1Store);
const ds = new DesignState({ layout });
const saves = new Saves(ds, { storage, autosave: false });
check('loading a version 1 design works', saves.load('Gardin') && ds.windows['win-s1']?.archetype === 'curtain' && !!ds.get('ex-f-sov-seng'));
check('the first write copied the version 1 store to the backup key, byte for byte', mem.get(BACKUP_KEY) === v1Store && saves.backupWritten);
ds.setPaint('w-sov-ost', '#8a9a8f');
saves.autosaveNow();
const stored = JSON.parse(mem.get(STORAGE_KEY));
check('the design is stored as version 2 (with the bedroom paint), the backup is unchanged', stored.designs.Gardin.version === 2 && stored.designs.Gardin.paints['w-sov-ost'] === '#8a9a8f' && mem.get(BACKUP_KEY) === v1Store);
const saves2 = new Saves(ds, { storage, autosave: false });
saves2.save('Ny');
check('a later session never overwrites the backup', mem.get(BACKUP_KEY) === v1Store);
const mem2 = new Map([[STORAGE_KEY, JSON.stringify({ version: 1, active: null, designs: { X: j0 }, autosave: null })]]);
const saves3 = new Saves(new DesignState({ layout }), { storage: { getItem: (k) => mem2.get(k) ?? null, setItem: (k, v) => mem2.set(k, String(v)), removeItem: (k) => mem2.delete(k) }, autosave: false });
saves3.save('Y');
check('no backup when only version 2 designs are stored', !mem2.has(BACKUP_KEY));
// today's room as version 1 wrote it: only the living room, no level, no originalRooms
const todayV1 = { ...j0, version: 1, meta: { name: 'Original' }, items: j0.items.filter((it) => living.some((o) => o.uid === it.uid)).map(({ level, ...it }) => it) };
check('an unchanged version 1 autosave is not «work», a changed one is', !saves.isWork(new DesignState({ layout }).toJSON()) && !saves.isWork(todayV1) && saves.isWork({ ...todayV1, paints: { 'w-hoy': '#7d8a80' } }));

// ---------------------------------------------------------------------------------------------------------------
section('Acoustics per room');
check('every living-room original counts in the living room', living.every((o) => A.itemRoomId(o, layout) === 'stue-kjokken'), living.filter((o) => A.itemRoomId(o, layout) !== 'stue-kjokken').map((o) => o.uid).join(','));
check('every other original counts in its own room', others.every((o) => A.itemRoomId(o, layout) === o.roomId), others.filter((o) => A.itemRoomId(o, layout) !== o.roomId).map((o) => `${o.uid}→${A.itemRoomId(o, layout)}`).join(','));
check('… also as design items (world y)', [...d0.items.values()].every((it) => A.itemRoomId(it, layout) === (others.find((o) => o.uid === it.uid)?.roomId ?? 'stue-kjokken')));
const rL = A.computeAcoustics(d0, { layout });
check('the living room: 0.86 s, V 138.57, A = 0.161·V/0.86 exactly as before', near(rL.rt60, 0.86, 1e-9) && near(rL.volume, 138.575, 0.001) && near(rL.absorption, (0.161 * layout.volume) / 0.86, 1e-9)
  && rL.roomId === 'stue-kjokken' && rL.mode === 'calibrated' && rL.label === 'Etterklang ≈ 0,86 s', `${rL.rt60} ${rL.absorption}`);
const rS = A.computeAcoustics(d0, { layout }, { roomId: 'soverom' });
check(`the bedroom: estimated, «i dag» = now (${rS.rt60.toFixed(2)} s), V ${rS.volume.toFixed(1)} m³`, rS.mode === 'estimate' && rS.estimated && near(rS.rt60, rS.baseline, 1e-12)
  && near(rS.volume, H.roomsById.soverom.volume, 1e-9) && rS.rt60 > 0.4 && rS.rt60 < 1.5 && rS.roomName === 'Soverom' && rS.surfaces.some((p) => p.key === 'floor'));
const rB = A.computeAcoustics(d0, { layout }, { roomId: 'bad' });
check(`the bathroom rings more than the bedroom (${rB.rt60.toFixed(2)} s)`, rB.rt60 > rS.rt60 && rB.rt60 < 3);
const rG = A.computeAcoustics(d0, { layout }, { roomId: 'gang' });
check('the hall counts its stairwell as an opening', rG.surfaces.some((p) => p.key === 'openings' && near(p.area, H.floorOpenings[0].area, 0.01)));
const rT = A.computeAcoustics(d0, { layout }, { roomId: 'trapp' });
check('the stair (hud room) → the living room', rT.roomId === 'stue-kjokken' && near(rT.rt60, 0.86, 1e-9));
for (const r of H.rooms.filter((rm) => !rm.hud)) {
  const a = A.computeAcoustics(d0, { layout }, { roomId: r.id });
  if (!(a.rt60 > 0.2 && a.rt60 < 3 && Number.isFinite(a.absorption))) check(`${r.id}: a sane RT60`, false, `${a.rt60}`);
}
check('every room has a sane RT60 (0.2–3 s)', true);
// moving pieces between rooms
const d9 = new DesignState({ layout });
d9.remove('ex-f-sov-seng');
const rS9 = A.computeAcoustics(d9, { layout }, { roomId: 'soverom' });
check('removing the bed raises the bedroom, the living room stays 0.86', rS9.rt60 > rS.rt60 + 0.1 && near(A.computeAcoustics(d9, { layout }).rt60, 0.86, 1e-9) && rS9.changes.some((c) => c.label === `Fjernet: ${d0.get('ex-f-sov-seng').name}`));
d9.update('ex-f-buet-sofa', { position: [1.5, 0, 6.5] });
const rS10 = A.computeAcoustics(d9, { layout }, { roomId: 'soverom' });
const rL10 = A.computeAcoustics(d9, { layout });
check('the curved sofa carried into the bedroom counts there, not in the living room', rS10.rt60 < rS9.rt60 && rL10.rt60 > 0.86 + 0.01 && rS10.changes.some((c) => c.label.startsWith('Lagt til: ')) && rL10.changes.some((c) => c.label.startsWith('Fjernet: ')));
d9.update('ex-f-buet-sofa', { position: [3.5, KJ, 8.0] });
check('… and in the basement living room, at the same plan position as the first floor', A.itemRoomId(d9.get('ex-f-buet-sofa'), layout) === 'kjellerstue');
const d10 = new DesignState({ layout });
d10.setWindow('win-sov', catalog.productToShadingSpec('bohus-rebell-sondre-gardinlengde-140x220'));
const rS11 = A.computeAcoustics(d10, { layout }, { roomId: 'soverom' });
check('a curtain on win-sov counts in the bedroom only', rS11.absorption > rS.absorption + 0.3 && near(A.computeAcoustics(d10, { layout }).rt60, 0.86, 1e-9) && rS11.changes.some((c) => c.label.startsWith('Solskjerming')));
d10.setWallProposal('B');
check('the high wall belongs to the living room only', near(A.computeAcoustics(d10, { layout }, { roomId: 'soverom' }).absorption, rS11.absorption, 1e-9) && A.computeAcoustics(d10, { layout }).rt60 < 0.75);
// the 3-argument ceiling for curtains is the living room's 2-argument value there
const curtain = catalog.productToShadingSpec('bohus-rebell-sondre-gardinlengde-140x220');
const viaHouse = layout.windows.map((w) => A.shadingAbsorption(w, { ...curtain, params: { ...curtain.params, height: undefined } }, layout));
const viaOld = layout.windows.map((w) => A.shadingAbsorption(w, { ...curtain, params: { ...curtain.params, height: undefined } }, { ceilingHeightAt: (x, z) => layout.ceilingHeightAt(x, z) }));
check('curtain heights in the living room unchanged by the 3-argument ceiling', viaHouse.every((v, i) => near(v, viaOld[i], 1e-12)), `${viaHouse} vs ${viaOld}`);
// the per-room cache follows design changes
const home = { layout };
const c1 = A.acousticsFor(d10, home, 'soverom');
check('acousticsFor caches per room', A.acousticsFor(d10, home, 'soverom') === c1 && A.acousticsFor(d10, home, 'bad') !== c1);
d10.remove('ex-f-sov-seng');
check('… and recomputes after a change', A.acousticsFor(d10, home, 'soverom') !== c1 && A.acousticsFor(d10, home, 'soverom').rt60 > c1.rt60);

done();

function round9(v) {
  return Math.round(v * 1e9) / 1e9;
}
