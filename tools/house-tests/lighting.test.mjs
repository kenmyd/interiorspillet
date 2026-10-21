/**
 * Steg 13 + 27 (L1 + L2): light per room (notes/hele-huset-design.md §4). Node only, no renderer:
 *   • the living room's light is unchanged: a LightManager on today's layout (the living room alone) and one on the
 *     whole house give identical Lkey, exposure, white balance, info numbers and light slots for the 8 photo cameras at
 *     08:30, 12, 20 and 23 (doors shut);
 *   • lightmask's room table: the living room's L = 4 boxes, room boxes of different rooms never overlap (the margin
 *     stays inside the walls), every room's centroid lies in one of its boxes, door holes belong to both rooms;
 *   • per room: downlights grouped (≤ 2 spots per room and group), the auto rules (on / dark / evening / off), a dark
 *     basement hall at night with every lamp off (Lkey at its floor, not more), the hall not black at noon with the
 *     lamps off and door-gang open, the sun's shadow box per level (hoved exactly as before).
 */
import { ROOT, imp, check, section, done } from './_lib.mjs';
import fs from 'node:fs';
import path from 'node:path';

const THREE = await import('three');
const readJson = (abs) => JSON.parse(fs.readFileSync(abs, 'utf8'));
const quiet = (fn) => {
  const w = console.warn;
  console.warn = () => {};
  try {
    return fn();
  } finally {
    console.warn = w;
  }
};

const { buildLayout, layout } = await imp('src/home/layout.js');
const houseData = await imp('src/data/scripts/house.mjs');
const { fixRoomSpec } = await imp('src/data/scripts/fixes.mjs');
const RESEARCH = path.join(ROOT, 'research');
const todaySpec = fixRoomSpec(houseData.mergeHouse(readJson(path.join(RESEARCH, 'room-spec.json')), RESEARCH, {
  files: houseData.houseFiles(RESEARCH).filter((f) => /^00-/.test(f.name)),
}));
const palette = readJson(path.join(ROOT, 'src/data/palette.json'));
const today = quiet(() => buildLayout(structuredClone(todaySpec), palette));
const { LightManager } = await imp('src/home/lighting.js');
const lm = await imp('src/world/lightmask.js');

const makeHome = (L, doors = []) => {
  const lights = L.builtInLights.map((l) => ({ ...l }));
  return { layout: L, builtInLights: lights, house: { builtInLights: [...lights] }, doors };
};
const manager = (L, doors) => quiet(() => new LightManager({ scene: new THREE.Scene(), home: makeHome(L, doors), quality: { level: 'medium' } }));
const cam = new THREE.PerspectiveCamera();
const at = (M, hour, pos, dir = null) => {
  M.setTime({ hour, month: 10, day: 18 });
  cam.position.copy(pos);
  if (dir) cam.lookAt(dir);
  cam.updateMatrixWorld(true);
  M._selectAt = -1e9;
  M.update(0, cam);
  M.update(1 / 60, cam);
  return M;
};
const snap = (M) => ({
  Lkey: M._Lkey, S: M._Starget, wb: M._wbTarget.toArray(), wbK: M._wbK, amb: M._ambTarget,
  info: (({ effective, indoorDaylightLux, outdoorLux, lampsOnByDefault, lampLumens, sunInRoom }) => ({ effective, indoorDaylightLux, outdoorLux, lampsOnByDefault, lampLumens, sunInRoom }))(M.info()),
  slots: ['point', 'spot', 'rect'].map((k) => M._pool[k].map((s) => s.cand?.id ?? null).join(',')).join('|'),
});

section('Stua er uendret (8 foto-kameraer × 4 klokkeslett, dørene lukket)');
{
  const A = manager(today), B = manager(layout);
  let diff = null;
  for (const pc of layout.photoCameras) {
    for (const hour of [8.5, 12, 20, 23]) {
      const a = snap(at(A, hour, pc.pos, pc.lookAt)), b = snap(at(B, hour, pc.pos, pc.lookAt));
      const ja = JSON.stringify(a), jb = JSON.stringify(b);
      if (ja !== jb && !diff) diff = `${pc.id} ${hour}: ${ja.slice(0, 300)} ≠ ${jb.slice(0, 300)}`;
    }
  }
  check('Lkey, S, hvitbalanse, ambient, info og lysplasser identiske (i dag mot hele huset)', !diff, diff ?? '');
  check('kamerarommet er stua', B.cameraRoomId === 'stue-kjokken', B.cameraRoomId);
  check('stuas seks grupper først, i samme rekkefølge', B.builtInGroups.slice(0, 6).map((g) => g.id).join() === A.builtInGroups.map((g) => g.id).join(), B.builtInGroups.map((g) => g.id).join());
  check('skyggeboksen i 1. etasje er som før', B._shadowBox.equals(A._shadowBox));
}

section('Romtabell og portaler (lightmask.js)');
{
  const boxes = lm.rectilinearBoxes(layout.floor.polygon);
  const area = boxes.reduce((s, b) => s + (b.maxX - b.minX) * (b.maxZ - b.minZ), 0);
  check('stuas L med nisje = 4 bokser med stuas areal', boxes.length === 4 && Math.abs(area - layout.floorArea) < 1e-6, `${boxes.length} / ${area}`);
  const t = lm.buildRoomTable(layout);
  check(`alle bokser får plass (${t.boxes.length} ≤ ${lm.MAX_BOXES})`, t.boxes.length <= lm.MAX_BOXES);
  check('stua har indeks 0, ute er siste', t.byId['stue-kjokken'].index === 0 && t.outside === t.rooms.length, `${t.outside}`);
  const roomBoxes = t.boxes.filter((b) => t.byId[b.roomId]);
  let overlap = null;
  for (const a of roomBoxes) for (const b of roomBoxes) {
    if (a.roomId >= b.roomId) continue;
    const ov = [0, 1, 2].map((k) => Math.min(a.max[k], b.max[k]) - Math.max(a.min[k], b.min[k]));
    if (ov.every((v) => v > 1e-6) && !overlap) overlap = `${a.roomId} × ${b.roomId}: ${ov.map((v) => v.toFixed(3))}`;
  }
  check('romboksene til to ulike rom overlapper aldri (marginen blir inne i veggen)', !overlap, overlap ?? '');
  const inBox = (bx, x, y, z) => x >= bx.min[0] && x <= bx.max[0] && y >= bx.min[1] && y <= bx.max[1] && z >= bx.min[2] && z <= bx.max[2];
  const miss = layout.house.rooms.filter((r) => !r.hud && r.contains(r.centroid.x, r.centroid.y))
    .filter((r) => !roomBoxes.some((b) => b.roomId === r.id && inBox(b, r.centroid.x, r.floorY + 1, r.centroid.y))).map((r) => r.id);
  check('hvert roms midtpunkt (1 m over gulvet) ligger i en av rommets bokser', !miss.length, miss.join());
  const gangBit = t.byId.gang.bit, livBit = t.byId['stue-kjokken'].bit;
  const doorBox = t.boxes.find((b) => b.roomId === 'door-gang');
  check('hullet til door-gang tilhører både stua og gangen', !!doorBox && doorBox.bits === (gangBit | livBit), doorBox?.bits);
  check('kjellertaket (y −0,30) ligger ikke i noen boks i 1. etasje', !roomBoxes.some((b) => t.byId[b.roomId].levelId === 'hoved' && b.min[1] <= -0.3));
  const portals = lm.portalRects(layout);
  check('portaler: door-gang (stue ↔ gang) og trappehullet (gang ↔ kjeller-gang) i to rektangler',
    portals.some((q) => q.id === 'door-gang' && q.connects.includes('gang') && q.connects.includes('stue-kjokken'))
    && portals.filter((q) => q.kind === 'hole' && q.connects.join() === 'gang,kjeller-gang').length === 2, portals.map((q) => q.id).join());
}

section('Lys per rom');
const doorGang = { t: 0, isOpen: false };
const H = manager(layout, [{ id: 'door-gang', door: doorGang }]);
{
  const per = new Map();
  for (const c of H._houseLamps) if (c.members) per.set(`${c.roomId}|${c.group}`, (per.get(`${c.roomId}|${c.group}`) || 0) + 1);
  check('downlights: høyst 2 spotter per rom og gruppe', [...per.values()].every((n) => n <= 2) && per.size > 0, JSON.stringify([...per]));
  const data = layout.house.builtInLights.filter((l) => l.roomId !== 'stue-kjokken' && l.type === 'downlight').reduce((s, l) => s + l.lumens, 0);
  const cand = H._houseLamps.filter((c) => c.members && c.roomId !== 'ute').reduce((s, c) => s + c.lumens, 0);
  check('downlightenes lumen er bevart i gruppene', Math.abs(data - cand) < 1e-6, `${data} / ${cand}`);
  check('plafond = lambertsk skive nedover, uten skyggeplass', H._houseLamps.filter((c) => /l-(bad|gang|sov)-tak/.test(c.id)).every((c) => c.lambert && c.noShadow && c.kind === 'spot'));
  check('LED-lister i husets rom har signatur 1', H._houseLamps.filter((c) => c.strip).every((c) => c.stripSignature === 1));
  check('alle rom unntatt stua har en egen lysmodell', layout.house.rooms.filter((r) => !r.hud && r.id !== 'stue-kjokken').every((r) => H._worlds.get(r.id)?.model?.patches.length >= 6));
}
{
  at(H, 12, new THREE.Vector3(4.2, 1.6, 4.0));
  check('kl. 12, auto: gangen og kjellergangen på (rom uten vindu), bodene av, entré og ute av',
    H.groupState('gang').on && H.groupState('kjeller-gang').on && !H.groupState('boder').on && !H.groupState('entre').on && !H.groupState('ute').on,
    ['gang', 'kjeller-gang', 'boder', 'entre', 'ute'].map((g) => `${g}:${H.groupState(g).on}`).join(' '));
  at(H, 23, new THREE.Vector3(4.2, 1.6, 4.0));
  check('kl. 23, auto: entré, ute, soverom og bad på, bodene fortsatt av',
    ['entre', 'ute', 'soverom', 'bad'].every((g) => H.groupState(g).on) && !H.groupState('boder').on);
  H.setMode('day');
  at(H, 12, new THREE.Vector3(4.2, 1.6, 4.0));
  check('«Dagslys»: også gangen av', !H.groupState('gang').on);
  H.setMode('auto');
}
{
  const off = () => { for (const g of H.builtInGroups) H.setBuiltIn(g.id, { on: false }); };
  off();
  at(H, 23, new THREE.Vector3(3.5, -0.95, 3.8));
  check('kjellergangen er kamerarommet på (3,5; −0,95; 3,8)', H.cameraRoomId === 'kjeller-gang', H.cameraRoomId);
  check('kjellergangen kl. 23 med alt av: mørk (Lkey på gulvet 0,02), ikke svart (ambient > 0)', H._Lkey <= 0.0201 && H.ambient && H._ambTarget > 0, `${H._Lkey} / ${H._ambTarget}`);
  check('skyggeboksen følger kjelleren (y −2,9…0)', H._camLevelId === 'kjeller' && Math.abs(H._shadowBox.min.y + 2.9) < 1e-9 && H._shadowBox.max.y === 0, `${H._camLevelId} ${H._shadowBox.min.y}`);
  at(H, 12, new THREE.Vector3(2.5, 1.6, 3.4));
  const closed = H._worlds.get('gang').Lkey;
  doorGang.t = 1;
  doorGang.isOpen = true;
  at(H, 12, new THREE.Vector3(2.5, 1.6, 3.4));
  const open = H._worlds.get('gang').Lkey;
  check('gangen kl. 12, lys av: ikke svart med door-gang åpen (portal fra stua)', H.cameraRoomId === 'gang' && open > 1 && open > 5 * closed, `lukket ${closed.toFixed(3)}, åpen ${open.toFixed(3)}`);
  check('med door-gang åpen kan stua nås fra gangen', H._reachable().has('stue-kjokken'));
  at(H, 12, new THREE.Vector3(4.2, 1.6, 4.0));
  check('tilbake i stua: skyggeboksen i 1. etasje er som før', H._camLevelId === 'hoved' && H._shadowBox.equals(manager(today)._shadowBox));
  for (const g of H.builtInGroups) H.setBuiltIn(g.id, null);
}

done();
