#!/usr/bin/env node
/**
 * Node test for the furnishing of generated houses (notes/moblering-genererte-hus.md):
 *   node tools/house-tests/moblering.test.mjs        (from the project root; exit code 1 on failure)
 *
 *   • the format (furnishgeom.js resolveFurnishing): defaults, issues, a room's use from its setting / name / kind;
 *   • the rules on plain rooms (furnishRoom): the bed's size after the room, nothing in a door's way (the hole and the
 *     game's DOOR_CLEARANCE in front, the leaf's sweep), nothing but rugs in front of a window to the floor, nothing
 *     taller than a window's sill under it, nothing under a ceiling too low for it (a sloped ceiling), a hint's piece
 *     where the plan drew it, a fixture hint's floor kept free, a narrow hall with nothing on its floor, the same
 *     result every time;
 *   • the test house (src/dev/moblering-hus.js: a planbygger document exported by the planbygger) with `furnishing`:
 *     validateHouse accepts it, every room is furnished after its use, the hints are followed;
 *   • in 3D (buildLayout + buildRooms, as the planbygger's view): one model per item in its room's contents, no grey
 *     fallback box, the colliders; then the walk: the player's capsule (config.js PLAYER, lifted by the step height as
 *     tools/walkmap.mjs does) on a 10 cm grid in the game's CollisionWorld with every collider of the house – the
 *     furniture's included – reaches every room and every door from the front door, as it does without furniture;
 *   • the game: the same items are original design items (existing.js furnishedItems, DesignState);
 *   • the owner's house has no furnishing: nothing of it changes (its fingerprint printed: owner-fingerprint.mjs).
 */
import { registerHooks } from 'node:module';
import { imp, check, section, done } from './_lib.mjs';

// Placement (the game's door sweep) → Selection → panelKit imports a stylesheet: nothing to load in Node
registerHooks({
  load(url, context, nextLoad) {
    if (url.startsWith('file:') && url.endsWith('.css')) return { format: 'module', source: '', shortCircuit: true };
    return nextLoad(url, context);
  },
});

const THREE = await import('three');
const { Capsule } = await import('three/addons/math/Capsule.js');
(await imp('src/home/materials.js')).configureMaterials({ textureRes: 0.125 });
const FG = await imp('src/home/furnishgeom.js');
const { buildLayout, layout: ownerLayout } = await imp('src/home/layout.js');
const { buildRooms } = await imp('src/home/rooms.js');
const { createHouseRoots } = await imp('src/home/index.js');
const { CollisionWorld } = await imp('src/core/Collision.js');
const { PLAYER } = await imp('src/config.js');
const cat = await imp('src/catalog/index.js');
const { furnishedItems, originalItems } = await imp('src/home/existing.js');
const { DesignState } = await imp('src/design/DesignState.js');
const { swingBox } = await imp('src/design/Placement.js');
const { mobleringHus, mobleringSpec } = await imp('src/dev/moblering-hus.js');
const E = await imp('src/planbygger/export.js');
const { validateGenerated } = await imp('tools/planbygger-lib.mjs');
const { ownerFingerprint } = await imp('tools/house-tests/owner-fingerprint.mjs');

const CAT = { products: cat.allProducts(), toSpec: cat.productToItemSpec };
const products = CAT.products;
const f2 = (v) => v.toFixed(2);
/** the game's free floor in front of a door (Placement.js DOOR_CLEARANCE) */
const DOOR_CLEARANCE = 0.6;

// ---------------------------------------------------------------------------------------------------------------
// plain rooms

/**
 * A rectangular room W × D (x 0…W, z 0…D) with holes per wall ('s' z = 0, 'e' x = W, 'n' z = D, 'w' x = 0, u from the
 * wall's start: s from x 0, e from z 0, n from x W, w from z D).
 */
function rect(W, D, { holes = {}, use = 'bedroom', ceilingAt = null, hints = [], swings = [], keepOut = [], name = '' } = {}) {
  const walls = [
    { id: 's', a: [0, 0], b: [W, 0], n: [0, 1] },
    { id: 'e', a: [W, 0], b: [W, D], n: [-1, 0] },
    { id: 'n', a: [W, D], b: [0, D], n: [0, -1] },
    { id: 'w', a: [0, D], b: [0, 0], n: [1, 0] },
  ].map((w) => ({ ...w, holes: (holes[w.id] || []).map((h, i) => ({ id: `${w.id}${i}`, top: (h.sill ?? 0) + (h.height ?? 2.1), sill: 0, type: 'door', ...h })) }));
  return { id: `rom-${W}x${D}-${use}`, levelId: 'hoved', use, name, polygon: [[0, 0], [W, 0], [W, D], [0, D]], walls, swings, keepOut, hints, ...(ceilingAt ? { ceilingAt } : {}) };
}
const door = (u0, w = 0.8) => ({ u0, u1: u0 + w, sill: 0, type: 'door' });
const win = (u0, w, sill = 0.9, height = 1.2) => ({ u0, u1: u0 + w, sill, top: sill + height, type: 'window' });
const role = (res, r) => res.items.filter((i) => i.role === r);
const feet = (it) => FG.box(it.at[0], it.at[1], it.rotationDeg, it.dims.w, it.dims.d);
const floorPieces = (res) => res.items.filter((i) => i.mount === 'floor');
/** the free floor in front of every hole the player walks through, on the room's side (DOOR_CLEARANCE deep) */
function doorZones(room) {
  const out = [];
  for (const w of room.walls) {
    const L = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);
    const t = [(w.b[0] - w.a[0]) / L, (w.b[1] - w.a[1]) / L];
    for (const h of w.holes) {
      if (h.type === 'window') continue;
      const mid = (h.u0 + h.u1) / 2;
      const c = [w.a[0] + t[0] * mid + w.n[0] * DOOR_CLEARANCE / 2, w.a[1] + t[1] * mid + w.n[1] * DOOR_CLEARANCE / 2];
      out.push(FG.box(c[0], c[1], (Math.atan2(w.n[0], w.n[1]) * 180) / Math.PI, h.u1 - h.u0, DOOR_CLEARANCE));
    }
  }
  return out;
}

section('Formatet (furnishgeom.js resolveFurnishing, roomUse)');
{
  check('uten furnishing: null', FG.resolveFurnishing(undefined).furnishing === null);
  const r = FG.resolveFurnishing({}, { roomIds: ['a'] });
  check('{} gir standardene: auto, ingen rom, ingen hint', r.furnishing.auto === true && Object.keys(r.furnishing.rooms).length === 0 && r.furnishing.hints.length === 0 && r.issues.length === 0, JSON.stringify(r));
  const bad = FG.resolveFurnishing({ rooms: { x: { use: 'disco' } }, hints: [{ kind: 'bed' }, { kind: 'flygel', at: [1, 1] }, { kind: 'sofa', at: [1, 2], roomId: 'y' }], color: 1 }, { roomIds: ['a'] });
  const msgs = bad.issues.map((i) => `${i.level}: ${i.msg}`);
  check('feil: ukjent rom, ukjent bruk, hint uten punkt, hint i et ukjent rom', ['«x» finnes ikke', 'ukjent bruk «disco»', 'mangler punktet', 'rommet «y» finnes ikke'].every((s) => msgs.some((m) => m.startsWith('error') && m.includes(s))), msgs.join(' | '));
  check('advarsler: ukjent møbel, ukjent felt', msgs.some((m) => m.startsWith('warn') && m.includes('«flygel»')) && msgs.some((m) => m.startsWith('warn') && m.includes('«color»')), msgs.join(' | '));
  check('et ukjent møbel brukes ikke', bad.furnishing.hints.every((h) => h.kind !== 'flygel'));
  const use = (name, kind, rooms) => FG.roomUse({ id: 'r', name, kind }, rooms ? { rooms: { r: rooms } } : null);
  check('bruken: navnet først (Kontor, Kjøkken, Spisestue, WC, Stue/kjøkken)', use('Kontor', 'bedroom') === 'office' && use('Kjøkken', 'living') === 'kitchen' && use('Spisestue', 'living') === 'dining' && use('WC', 'bathroom') === 'wc' && use('Stue/kjøkken', 'living') === 'living');
  check('bruken: så typen, så «other»; furnishing.rooms[id].use vinner', use('Rom 3', 'bedroom') === 'bedroom' && use('', 'hall') === 'hall' && use('', 'garage') === 'garage' && use('', 'xyz') === 'other' && use('Soverom', 'bedroom', { use: 'office' }) === 'office');
}

section('Reglene på enkle rom (furnishRoom)');
{
  // the bed after the room: 3.6 × 4.0 → 180, 2.8 × 3.4 → at least 140, 2.0 × 3.6 → 120
  const big = FG.furnishRoom(rect(4.0, 3.6, { holes: { s: [door(0.3)] } }), products);
  const mid = FG.furnishRoom(rect(2.8, 3.4, { holes: { s: [door(0.2)] } }), products);
  const small = FG.furnishRoom(rect(2.0, 3.6, { holes: { s: [door(0.2)] } }), products);
  const width = (res) => products.find((p) => p.id === role(res, 'bed')[0]?.product)?.params?.mattressW ?? null;
  check(`stort soverom (14,4 m²): 180-seng (${width(big)})`, width(big) === 1.8);
  check(`mellomstort (9,5 m²): minst 140 (${width(mid)})`, width(mid) >= 1.4);
  check(`smalt (2,0 m bredt): 120 (${width(small)})`, width(small) === 1.2);
  check('stort soverom: nattbord på begge sider, garderobe, kommode og teppe', role(big, 'nightstand').length === 2 && role(big, 'wardrobe').length === 1 && role(big, 'dresser').length === 1 && role(big, 'rug').length === 1, big.items.map((i) => i.role).join(' '));

  // doors: nothing (but rugs) in the hole's DOOR_CLEARANCE, nothing in a leaf's sweep
  const swing = FG.box(0.7, 0.45, 0, 0.8, 0.8);
  const room = rect(3.4, 3.0, { use: 'office', holes: { s: [door(0.3)], w: [door(1.0, 0.9)] }, swings: [swing] });
  const res = FG.furnishRoom(room, products);
  const zones = doorZones(room);
  const inDoor = floorPieces(res).filter((it) => zones.some((z) => FG.overlaps(feet(it), z, -0.005)));
  check(`kontoret er møblert (${res.items.map((i) => i.role).join(' ')})`, role(res, 'desk').length === 1 && role(res, 'chair').length === 1);
  check('ingenting står i en døråpning eller rett foran den', inDoor.length === 0, inDoor.map((i) => i.role).join(', '));
  check('ingenting står der dørbladet slår', floorPieces(res).every((it) => !FG.overlaps(feet(it), swing, -0.005)));

  // a window to the floor: only rugs in front of it; an ordinary window: nothing taller than its sill under it
  const winRoom = rect(4.0, 3.6, { use: 'bedroom', holes: { s: [door(0.3)], n: [win(1.2, 1.6, 0.05, 2.0)], e: [win(1.0, 1.4, 0.9)] } });
  const wr = FG.furnishRoom(winRoom, products);
  const floorWin = FG.box(4.0 - 2.0, 3.6 - 0.3, 180, 1.6, 0.6);
  const eastWin = FG.box(4.0 - 0.15, 1.7, -90, 1.4, 0.3);
  check('foran vinduet ned til gulvet står ingenting (et teppe går)', wr.items.filter((i) => i.mount === 'floor').every((it) => !FG.overlaps(feet(it), floorWin, -0.005)), wr.items.map((i) => `${i.role}@${i.at.map(f2)}`).join(' '));
  check('under et vanlig vindu står bare det som er lavere enn brystningen (0,9)', floorPieces(wr).every((it) => it.dims.h <= 0.88 || !FG.overlaps(feet(it), eastWin, -0.005)));

  // a sloped ceiling: 1.0 m at the west wall, 2.6 m at the east wall: the tall pieces stand where they fit
  const slope = (x) => 1.0 + (1.6 * x) / 4.0;
  const sr = FG.furnishRoom(rect(4.0, 3.6, { holes: { s: [door(2.8)] }, ceilingAt: (x) => slope(x) }), products);
  const under = sr.items.filter((it) => it.mount === 'floor').filter((it) => FG.corners(feet(it)).some(([x]) => slope(x) < it.dims.h + 0.05));
  check(`skrå himling: alt står der det får plass under himlingen (${sr.items.map((i) => i.role).join(' ')})`, under.length === 0 && role(sr, 'bed').length === 1, under.map((i) => `${i.role} h ${i.dims.h}`).join(', '));
  const ward = role(sr, 'wardrobe')[0];
  check('skrå himling: garderoben (2 m) står ved den høye veggen', !ward || ward.at[0] > 2.5, ward ? f2(ward.at[0]) : 'ingen garderobe');

  // hints: the bed where the plan drew it; a fixture's floor kept free
  const hinted = FG.furnishRoom(rect(4.0, 3.6, { holes: { s: [door(0.3)] }, hints: [{ kind: 'bed', at: [3.0, 1.8] }] }), products);
  const bed = role(hinted, 'bed')[0];
  check(`hint: senga der planen tegnet den (${bed ? bed.at.map(f2) : '–'}, mot østveggen)`, !!bed && Math.hypot(bed.at[0] - 3.0, bed.at[1] - 1.8) < 0.6 && Math.abs(Math.abs(bed.rotationDeg) - 90) < 1);
  const bath = FG.furnishRoom(rect(2.4, 2.8, { use: 'bathroom', holes: { s: [door(0.2)] }, hints: [{ kind: 'toilet', at: [2.1, 1.4] }, { kind: 'shower', at: [0.45, 2.35] }] }), products);
  const fixtures = bath.reserved.map((r) => r.box);
  check(`bad: bare løst inventar (${bath.items.map((i) => i.role).join(' ')})`, bath.items.length >= 2 && bath.items.every((i) => ['bathMat', 'laundryBasket', 'towelLadder'].includes(i.role)));
  check('bad: toalettet og dusjen (hint) holdes fri', fixtures.length === 2 && bath.items.every((it) => fixtures.every((z) => !FG.overlaps(feet(it), z, -0.005))));

  // a narrow hall: only the runner on the floor, hooks and a mirror on the walls
  const hall = FG.furnishRoom(rect(5.0, 1.1, { use: 'hall', holes: { s: [door(0.5), door(3.0)], n: [door(1.5)], w: [{ u0: 0.15, u1: 0.95, sill: 0, type: 'opening' }] } }), products);
  check(`smal gang (1,1 m): ingenting på gulvet som stenger (${hall.items.map((i) => i.role).join(' ')})`, hall.items.filter((i) => i.mount === 'floor').length === 0 && hall.items.some((i) => i.mount === 'wall'));

  // the same room gives the same furniture
  const again = FG.furnishRoom(rect(4.0, 3.6, { holes: { s: [door(0.3)] } }), products);
  check('det samme rommet gir de samme møblene', JSON.stringify(again.items) === JSON.stringify(big.items));
}

// ---------------------------------------------------------------------------------------------------------------
section('Testhuset (eksportert av planbyggeren, src/dev/moblering-hus.js)');
const T = mobleringHus();
const layout = buildLayout(mobleringSpec(T.house), undefined, { devWarnings: false });
const H = layout.house;
const F = FG.furnishHouse(layout, CAT);
{
  const v = await validateGenerated({ house: T.house, registry: E.registryFor(T.house) });
  const errs = v.errors;
  check(`validateHouse: 0 feil (${errs.length})`, errs.length === 0, errs.slice(0, 3).join(' | '));
  const vb = await validateGenerated({ house: { ...T.house, furnishing: { rooms: { ingen: {} }, hints: [{ kind: 'bed', at: [50, 50] }] } }, registry: E.registryFor(T.house) });
  check('validateHouse: et ukjent rom er en feil, et hint utenfor alle rom en advarsel', vb.errors.some((m) => m.includes('«ingen» finnes ikke')) && vb.warnings.some((m) => m.includes('står ikke i noe rom')), [...vb.errors, ...vb.warnings].filter((m) => /furnishing/.test(m)).join(' | '));
  check('layout.house.furnishing har hintene', H.furnishing?.hints?.length === T.hints.length);
  const R = F.rooms;
  const has = (id, ...roles) => roles.every((r) => R[id]?.items.some((i) => i.role === r));
  check(`stua: sofa, sofabord, teppe, TV-benk, spisebord med stoler (${R['stue-kjøkken']?.items.map((i) => i.role).join(' ')})`, has('stue-kjøkken', 'sofa', 'coffeeTable', 'rug', 'tvBench', 'diningTable', 'chair'));
  check('stua: kjøkkenet (hint) er holdt fritt', R['stue-kjøkken']?.reserved.some((r) => r.kind === 'kitchen'));
  const bedW = (id) => products.find((p) => p.id === R[id]?.items.find((i) => i.role === 'bed')?.product)?.params?.mattressW;
  check(`soverommene: senger etter rommet (${['soverom-1', 'soverom-2', 'soverom-3'].map((id) => `${id} ${bedW(id)}`).join(', ')})`, bedW('soverom-1') === 1.8 && bedW('soverom-3') === 1.2 && bedW('soverom-2') >= 1.2);
  check('kontoret (navnet, typen er soverom): skrivebord og stol', R.kontor?.use === 'office' && has('kontor', 'desk', 'chair'));
  check('entréen: knagger, speil, sko eller benk', has('entre', 'coatRack', 'mirror') && (has('entre', 'bench') || has('entre', 'shoeCabinet')));
  check('badet og vaskerommet: bare løst inventar', ['bad', 'vaskerom'].every((id) => R[id]?.items.every((i) => ['bathMat', 'laundryBasket', 'towelLadder'].includes(i.role))));
  const near = (id, r, hint) => {
    const it = R[id]?.items.find((i) => i.role === r);
    const h = T.hints.find((x) => x.kind === hint);
    return it && h ? Math.hypot(it.at[0] - h.at[0], it.at[1] - h.at[1]) : Infinity;
  };
  check(`hintene: senga i Soverom 1 (${f2(near('soverom-1', 'bed', 'bed'))} m) og skrivebordet (${f2(near('kontor', 'desk', 'desk'))} m) der planen tegnet dem`, near('soverom-1', 'bed', 'bed') < 0.5 && near('kontor', 'desk', 'desk') < 0.5);
  // the game's own rules on every piece: Placement.swingBox (the leaves that open), the hole's DOOR_CLEARANCE on both
  // sides, the floor in front of a window to the floor
  const blocks = [];
  for (const d of H.doors) {
    const sb = swingBox(d, H.wall(d.wallId)?.thickness ?? 0.1);
    if (sb) blocks.push({ ...sb, what: `slaget til ${d.id}`, levelId: d.levelId });
  }
  for (const o of H.openings) {
    const walk = o.type !== 'window' && o.sill <= 0.05;
    const floorWin = (o.type === 'window' || o.type === 'terrace-door') && o.sill < 0.3;
    if (!walk && !floorWin) continue;
    const t = H.wall(o.wallId)?.backOf ? 0 : H.wall(o.wallId)?.thickness ?? 0.1;
    const n = o.normal, r = o.right, b = o.bottomCenter;
    const deep = walk ? DOOR_CLEARANCE : 0.6;
    for (const side of [1, -1]) {
      const off = side > 0 ? deep / 2 : -(t + deep / 2);
      blocks.push({ cx: b.x + n.x * off, cz: b.z + n.z * off, ax: [r.x, r.z], az: [n.x, n.z], hw: o.width / 2, hd: deep / 2, what: `${walk ? 'døra' : 'vinduet'} ${o.id}`, levelId: o.levelId, window: floorWin && !walk });
    }
  }
  const hit = [];
  for (const it of F.items) {
    if (it.mount === 'wall') continue;
    const fb = FG.box(it.position[0], it.position[2], it.rotationDeg, it.dims.w, it.dims.d);
    for (const z of blocks) {
      if (it.mount === 'rug' && !z.what.startsWith('slaget')) continue;
      if (FG.overlaps(fb, z, -0.01)) hit.push(`${it.uid} (${it.refId}) i ${z.what}`);
    }
  }
  check(`ingen møbler i en døråpning, i et dørslag eller foran et vindu ned til gulvet (${F.items.length} møbler)`, hit.length === 0, hit.slice(0, 4).join(' | '));
  const outside = F.items.filter((it) => !H.room(it.roomId).contains(it.position[0], it.position[2]));
  check('hvert møbel står i sitt eget rom', outside.length === 0, outside.map((i) => i.uid).join(', '));
}

// ---------------------------------------------------------------------------------------------------------------
section('I 3D (buildLayout + buildRooms, som planbyggerens visning)');
const warn = console.warn;
const fallbacks = [];
// a builder that draws its texture on a canvas (rugs, pictures) has none in Node: that grey box is Node's, not the house's
console.warn = (...a) => (String(a[0]).includes('[registry]') && !/document is not defined/.test(String(a[1])) ? fallbacks.push(String(a[0])) : null);
const roots = createHouseRoots(layout, [new THREE.Group()]);
const built = buildRooms({ scene: new THREE.Scene(), quality: {}, roots }, layout, null);
console.warn = warn;
{
  const fu = built.furniture;
  check(`én modell per møbel (${fu?.objects.length} / ${F.items.length})`, fu?.objects.length === F.items.length);
  check('hver modell står i sitt roms innhold (room:<id>:contents)', fu.objects.every((o) => o.parent?.name === `room:${o.userData.item.roomId}:contents`));
  check('ingen grå reserveboks (en ukjent arketype, en bygger som feiler – utenom canvas-teksturene Node ikke har)', fallbacks.length === 0, fallbacks.slice(0, 2).join(' | '));
  const want = F.items.filter((i) => i.mount === 'floor' && i.dims.h > FG.COLLIDE_H).length;
  check(`kollidere for gulvmøbler over 0,3 m (${fu.colliders.length} bokser for ${want} møbler), alle i built.colliders`, fu.colliders.length >= want && fu.colliders.every((c) => built.colliders.includes(c)));
  const wallOk = fu.objects.filter((o) => o.userData.item.mount === 'wall').every((o) => {
    const it = o.userData.item;
    const n = it.attach.normal;
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(o.quaternion);
    return fwd.x * n[0] + fwd.z * n[2] > 0.999;
  });
  check('veggmøblene (bilder, speil, knagger, TV) vender ut i rommet', wallOk);
}

section('Gangtesten: spillerens kapsel i CollisionWorld med alle kolliderne');
{
  const R_ = PLAYER.radius, STEP_UP = 0.3, CELL = 0.1;
  const world = (withFurniture) => {
    const col = new CollisionWorld();
    for (const c of built.colliders) {
      if (!withFurniture && c?.userData?.furniture) continue;
      if (c?.isBox3) col.addStaticBox(c);
      else if (c) col.addStatic(c);
    }
    col.build();
    return col;
  };
  const b = H.bounds;
  const nx = Math.ceil((b.maxX - b.minX) / CELL), nz = Math.ceil((b.maxZ - b.minZ) / CELL);
  const cap = new Capsule();
  /** free cells of the main floor (y 0), the way tools/walkmap.mjs tests them */
  function grid(col) {
    const free = new Uint8Array(nx * nz);
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const x = b.minX + (i + 0.5) * CELL, z = b.minZ + (j + 0.5) * CELL;
      if (!H.rooms.some((r) => !r.hud && r.contains(x, z)) && !H.thresholds.some((t) => t.contains(x, z))) continue;
      cap.start.set(x, STEP_UP + R_, z);
      cap.end.set(x, PLAYER.height - R_, z);
      cap.radius = R_;
      const hitc = col.octree.capsuleIntersect(cap);
      if (hitc && hitc.depth > 0.01) continue;
      if (col._staticBoxes.some((bx) => x > bx.min.x && x < bx.max.x && z > bx.min.z && z < bx.max.z && bx.max.y > STEP_UP && bx.min.y < PLAYER.height)) continue;
      free[j * nx + i] = 1;
    }
    return free;
  }
  const cellOf = (x, z) => Math.floor((z - b.minZ) / CELL) * nx + Math.floor((x - b.minX) / CELL);
  function flood(free, start) {
    const seen = new Uint8Array(nx * nz);
    const q = [start];
    seen[start] = 1;
    while (q.length) {
      const k = q.pop();
      const i = k % nx;
      for (const n of [i > 0 ? k - 1 : -1, i < nx - 1 ? k + 1 : -1, k - nx, k + nx]) if (n >= 0 && n < free.length && free[n] && !seen[n]) (seen[n] = 1), q.push(n);
    }
    return seen;
  }
  // the start: inside the front door
  const outerOf = (o) => (o.connects || []).includes('ute') || (o.connects || []).length < 2;
  const front = H.doors.find((d) => outerOf(d) && d.type === 'door');
  const startAt = [front.bottomCenter.x + front.normal.x * 0.5, front.bottomCenter.z + front.normal.z * 0.5];
  const report = (free) => {
    let s = cellOf(...startAt);
    if (!free[s]) for (let d = 1; d < 5 && !free[s]; d++) for (const k of [s - d, s + d, s - d * nx, s + d * nx]) if (free[k]) s = k;
    const seen = flood(free, s);
    const rooms = {};
    for (const r of H.rooms) {
      // the planbygger's base has the owner's living room as a zero-area placeholder (export.js mergeOnto)
      if (r.hud || r.area < 0.5) continue;
      let n = 0, m = 0;
      for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
        const x = b.minX + (i + 0.5) * CELL, z = b.minZ + (j + 0.5) * CELL;
        if (!r.contains(x, z)) continue;
        const k = j * nx + i;
        if (free[k]) (m++, (n += seen[k] ? 1 : 0));
      }
      rooms[r.id] = { reached: n, free: m };
    }
    // every walk-through opening: a reached cell in its hole
    const holes = H.openings.filter((o) => o.type !== 'window' && o.sill <= 0.05).map((o) => {
      const w = H.wall(o.wallId);
      const t = w.backOf ? 0.02 : w.thickness;
      let ok = false;
      for (let u = o.u0 + 0.05; u <= o.u1 - 0.05 && !ok; u += 0.05) {
        for (let k = 0.0; k <= t + 1e-6 && !ok; k += 0.05) {
          const p = w.pointAt(u, 0);
          const c = cellOf(p.x - w.normal.x * k, p.z - w.normal.y * k);
          if (seen[c]) ok = true;
        }
      }
      return { id: o.id, ok, outer: outerOf(o) };
    });
    return { rooms, holes, start: s };
  };
  const t0 = Date.now();
  const empty = report(grid(world(false)));
  const furnished = report(grid(world(true)));
  const ms = Date.now() - t0;
  const ids = Object.keys(furnished.rooms);
  const lost = ids.filter((id) => empty.rooms[id].reached > 0 && furnished.rooms[id].reached === 0);
  check(`uten møbler når spilleren alle rommene fra ytterdøra (${ids.filter((id) => empty.rooms[id].reached > 0).length}/${ids.length})`, ids.every((id) => empty.rooms[id].reached > 0), ids.filter((id) => !empty.rooms[id].reached).join(', '));
  check(`med møblene: alle rommene fortsatt (${ids.filter((id) => furnished.rooms[id].reached > 0).length}/${ids.length})`, lost.length === 0 && ids.every((id) => furnished.rooms[id].reached > 0), lost.join(', '));
  const shut = furnished.holes.filter((h) => !h.ok && !h.outer);
  check(`med møblene: hver dør og passasje inne kan gås gjennom (${furnished.holes.filter((h) => h.ok).length}/${furnished.holes.length})`, shut.length === 0, shut.map((h) => h.id).join(', '));
  // the furniture's colliders do stop the capsule: the free floor shrinks in every room with furniture that collides
  const colliding = new Set(F.items.filter((i) => i.mount === 'floor' && i.dims.h > FG.COLLIDE_H).map((i) => i.roomId));
  const notShrunk = [...colliding].filter((id) => !(furnished.rooms[id].free < empty.rooms[id].free));
  check(`møblene stenger: mindre fritt gulv i hvert rom med møbler som kolliderer (${[...colliding].map((id) => `${id} ${empty.rooms[id].free}→${furnished.rooms[id].free}`).join(', ')})`, notShrunk.length === 0, notShrunk.join(', '));
  const share = (r) => (r.free ? r.reached / r.free : 0);
  const worst = ids.map((id) => [id, share(furnished.rooms[id])]).sort((a, x) => a[1] - x[1]);
  check(`med møblene: det meste av det åpne gulvet nås i hvert rom (minst ${f2(worst[0][1])} i ${worst[0][0]})`, worst[0][1] >= 0.85, worst.slice(0, 3).map(([id, s]) => `${id} ${f2(s)}`).join(', '));
  console.log(`  (gangtesten: ${nx} × ${nz} celler à ${CELL} m, ${ms} ms; per rom nådd/fritt: ${ids.map((id) => `${id} ${furnished.rooms[id].reached}/${furnished.rooms[id].free}`).join(', ')})`);
}

// ---------------------------------------------------------------------------------------------------------------
section('Spillet: de samme møblene er originale designelementer');
{
  const fi = furnishedItems(layout);
  check(`existing.js furnishedItems: alle (${fi.length})`, fi.length === F.items.length && fi.every((i) => i.uid.startsWith('mb-') && i.source === 'catalog' && cat.getProduct(i.refId) || (i.archetype === 'tv' && i.source === 'custom')));
  const orig = originalItems(layout, { rooms: 'all' });
  check('originalItems(layout, { rooms: \'all\' }) har dem med', fi.every((i) => orig.some((o) => o.uid === i.uid)));
  const d = new DesignState({ layout });
  const list = d.list();
  const mine = list.filter((i) => i.uid.startsWith('mb-'));
  check(`DesignState: startdesignet har møblene (${mine.length}), på nivået sitt`, mine.length === F.items.length && mine.every((i) => i.level === 'hoved'), `${mine.length} av ${list.length}`);
}

section('Eierens hus er uendret');
{
  check('eierens hus har ingen furnishing', ownerLayout.house.furnishing === null);
  check('furnishedItems(eierens hus) = []', furnishedItems(ownerLayout).length === 0);
  const fp = ownerFingerprint();
  console.log(`  (fingeravtrykk: layout ${fp.layout}, rom ${fp.rooms}, ${fp.meshes} mesher – likt grenen under, se notes/moblering-genererte-hus.md)`);
  const R2 = buildRooms({ scene: new THREE.Scene(), quality: {}, roots: createHouseRoots(ownerLayout, [new THREE.Group()]) }, ownerLayout, null);
  check('buildRooms bygger ingen møbler i eierens hus', R2.furniture == null);
}

done();
