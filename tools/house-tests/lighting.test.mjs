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

section('Andre rom sett gjennom døra, ute, sol per nivå, oversikt (rettinger etter gjennomgangen)');
{
  const door = { t: 0, isOpen: false };
  const G = manager(layout, [{ id: 'door-gang', door }]);
  const spots = (M) => M._pool.spot.filter((s) => s.cand?.on).map((s) => s.cand.id);
  const stue = new THREE.Vector3(5, 1.6, 6), mot = new THREE.Vector3(2, 1.2, 3);
  at(G, 20, stue, mot);
  const own = spots(G).filter((id) => !/l-(gang|kg|bad|sov|entre|ute)/.test(id)).sort().join();
  door.t = 1;
  door.isOpen = true;
  at(G, 20, stue, mot);
  const tak = G._allLampCandidates().find((c) => c.id === 'builtin:l-gang-tak');
  const col = tak ? G.slotColor(tak) : null;
  check('door-gang åpen kl. 20, sett fra stua: gangens plafond (3800 K) i nær sin egen hvitbalanse, b/r ≤ 1,2 (ikke lavendel)',
    !!col && col.b / col.r <= 1.2, col ? `b/r ${(col.b / col.r).toFixed(2)}` : 'ingen l-gang-tak');
  const pend = G._allLampCandidates().find((c) => c.id === 'builtin:pendel-oy-1');
  const pc = G.slotColor(pend), pr = pend.color.clone().multiply(G._wb);
  check('stuas egne lamper har uendret farge', Math.abs(pc.r - pr.r) + Math.abs(pc.g - pr.g) + Math.abs(pc.b - pr.b) < 1e-9);
  check('døra åpen: stuas egne lamper beholder alle lysplassene sine (kjøkkenøya mister ingen)',
    spots(G).filter((id) => !/l-(gang|kg|bad|sov|entre|ute)/.test(id)).sort().join() === own, `${own} → ${spots(G).join()}`);
  check('lysplasser bare ett rom unna (kjellergangen bak trappehullet konkurrerer ikke fra stua)', !spots(G).some((id) => /l-kg-/.test(id)), spots(G).join());
  check('synligheten når fortsatt to rom unna (kjellergangen)', G._reachable().has('kjeller-gang'));
  const f = lm.lightMask.uniforms.lmRoomF.value, gi = G._table.byId.gang.index * 4;
  const fr = f[gi + 2] / f[gi], fg = f[gi + 1] / f[gi];
  check('gangen sett fra stua får sin egen flate irradians (w ≥ 2), ikke stuas retningsavhengige kart',
    f[gi + 3] >= 2 && f[gi] > 0, [...f.slice(gi, gi + 4)].map((v) => v.toFixed(2)).join('/'));
  check('gangens flate irradians er nøytral til varm (b/r ≤ 1,05, g/r ≥ b/r): veggen blir sand, ikke lavendel',
    fr <= 1.05 && fg >= fr, `g/r ${fg.toFixed(3)} b/r ${fr.toFixed(3)}`);
  const li = G._table.byId['stue-kjokken'].index * 4;
  check('stua (kamerarommet) og ute er som før (w = 1 / 0), kamerarommet står i lmSun.w',
    f[li + 3] === 1 && f[G._table.outside * 4 + 3] === 0 && lm.lightMask.uniforms.lmSun.value[3] === G._table.byId['stue-kjokken'].index + 1);
  check('maskene er på med døra åpen', G._masksWanted());
  // the (slot, portal) pairs: every slot of the hall gets the portals of the hall, the living room's slots door-gang
  lm.lightMask.flush(G._table.byId['stue-kjokken'].bit);
  const pairs = lm.lightMask.pairs, pv = lm.lightMask.uniforms.lmPortal.value;
  const slotOf = (id) => {
    for (const kind of ['point', 'spot', 'rect']) {
      const s = G._pool[kind].find((x) => x.cand?.id === id);
      if (s) return { point: 0, spot: lm.MAX_SLOTS.point, rect: lm.MAX_SLOTS.point + lm.MAX_SLOTS.spot }[kind] + s.shaderIndex;
    }
    return -1;
  };
  const gs = slotOf('builtin:l-gang-tak'), ps = slotOf('builtin:pendel-oy-1');
  const gangBit = G._table.byId.gang.bit, livBit = G._table.byId['stue-kjokken'].bit;
  const bitsOfPortal = (p) => pv[p * 12 + 3];
  check('par: gangens plafond får alle portalene til gangen, stuas pendel bare door-gang',
    gs >= 0 && ps >= 0 && pairs.filter((q) => q.slot === gs).every((q) => bitsOfPortal(q.portal) & gangBit) && pairs.some((q) => q.slot === gs && (bitsOfPortal(q.portal) & livBit))
    && pairs.filter((q) => q.slot === ps).length >= 1 && pairs.filter((q) => q.slot === ps).every((q) => (bitsOfPortal(q.portal) & livBit) && (bitsOfPortal(q.portal) & gangBit)),
    `${gs}/${ps}: ${pairs.length} par`);
  check(`par innenfor taket (${pairs.length} ≤ ${lm.MAX_PAIRS})`, pairs.length > 0 && pairs.length <= lm.MAX_PAIRS);

  // a door swing: the rooms are solved per step of the opening, not every frame, and once more when it stops
  at(G, 20, new THREE.Vector3(4.2, 1.6, 4.0));
  door.t = 0;
  door.isOpen = false;
  G.update(1 / 60, cam);
  G.update(1 / 60, cam);
  check('stua med alle dører lukket: maskene er av (de endrer ingenting synlig, sparer bildetid)', G.cameraRoomId === 'stue-kjokken' && !G._masksWanted());
  const r0 = G.stats.recomputes;
  for (let i = 0; i < 30; i++) {
    door.t = (i + 1) / 30;
    door.isOpen = true;
    G.update(1 / 60, cam);
  }
  G.update(1 / 60, cam);
  G.update(1 / 60, cam);
  const n = G.stats.recomputes - r0;
  const lkSwing = G._worlds.get('gang').Lkey;
  G._markDirty();
  G.update(1 / 60, cam);
  check(`dørsving over 30 bilder: ${n} omregninger (≤ 8), sluttilstanden som en ny løsning`, n <= 8 && Math.abs(G._worlds.get('gang').Lkey - lkSwing) < 1e-9, `${n} / ${lkSwing}`);

  // outside: the outdoor lamps get light slots on the forecourt; inside the living room 'ute' is not reached
  at(G, 23, new THREE.Vector3(12.2, -1.27, 4.6), new THREE.Vector3(9.5, -1.3, 4.6));
  check('forplassen kl. 23: kameraet er ute, en av lampene i himlingen (l-ute-*) har en spotplass',
    G._camOutside && spots(G).some((id) => /^builtin:l-ute-/.test(id)), `${G._camOutside} ${spots(G).join()}`);
  at(G, 23, stue, mot);
  check('i stua kl. 23: «ute» er ikke blant rommene som konkurrerer om lysplassene', !G._camOutside && !G._reachWeights(1).has('ute') && !spots(G).some((id) => /l-ute-/.test(id)));
  at(G, 20, new THREE.Vector3(3.5, 15, -6), new THREE.Vector3(3.5, 0, 6));
  check('oversikten over taket regnes ikke som «ute»', !G._camOutside);

  // the sun lights only the rooms of the level its shadow box covers (+ outside)
  const t = G._table;
  const bitsOf = (lv) => t.rooms.filter((r) => r.levelId === lv).reduce((s, r) => s | r.bit, 0);
  at(G, 12, stue, mot);
  check('sola i 1. etasje: stua, gangen, bad og soverom + ute, ingen kjellerrom', G._sunBits === (bitsOf('hoved') | t.outsideBit) && (G._sunBits & bitsOf('kjeller')) === 0, G._sunBits);
  at(G, 12, new THREE.Vector3(3.5, -0.95, 3.8));
  check('sola i kjelleren: bare kjellerrommene + ute (gangen sett gjennom trappehullet får ikke usett sol)', G._camLevelId === 'kjeller' && G._sunBits === (bitsOf('kjeller') | t.outsideBit), G._sunBits);
  const hole = t.boxes.find((b) => /^trappehull/.test(b.roomId));
  check('trappehullets boks hører til begge nivåene (sola slipper til fra begge)', !!hole && (hole.bits & t.byId.gang.bit) && (hole.bits & t.byId['kjeller-gang'].bit));

  // the overviews (steg 28): one value per level
  G.setOverviewLevel('kjeller');
  at(G, 20, new THREE.Vector3(3.5, 15, -6), new THREE.Vector3(3.5, 0, 6));
  const rooms = new Set(G._pool.spot.filter((s) => s.cand?.on).map((s) => s.cand.roomId));
  check('setOverviewLevel(kjeller): kjellerens skyggeboks, kjellerrom i lysplassene, ingen fra 1. etasje',
    G.overviewLevel === 'kjeller' && G._camLevelId === 'kjeller' && Math.abs(G._shadowBox.min.y + 2.9) < 1e-9 && rooms.size >= 3
    && ![...rooms].some((r) => ['stue-kjokken', 'gang', 'bad', 'soverom'].includes(r)), [...rooms].join());
  const agg = G._levelAggregate('kjeller');
  check('oversikten eksponerer for nivåets samlede Lkey', Math.abs(G._Lkey - agg.Lkey) < 1e-9 && G.info().overview === 'kjeller', `${G._Lkey} / ${agg.Lkey}`);
  G.setOverviewLevel(null);
  at(G, 20, new THREE.Vector3(4.2, 1.6, 4.0));
  check('setOverviewLevel(null): tilbake til kameraets rom og nivå', G.overviewLevel === null && G.cameraRoomId === 'stue-kjokken' && G._camLevelId === 'hoved');
}

section('Uniformbudsjettet (lightmask.js)');
{
  check(`masken bruker ${lm.VECTORS} fragmentvektorer (≤ 200)`, lm.VECTORS <= 200);
  check('en GPU med 256 fragmentvektorer får vanlig lys (masker av), 1024 får maskene',
    !lm.lightMask.fits({ capabilities: { maxFragmentUniforms: 256 } }) && lm.lightMask.fits({ capabilities: { maxFragmentUniforms: 1024 } }));
  const src = THREE.ShaderChunk.lights_fragment_begin, pars = THREE.ShaderChunk.lights_pars_begin;
  // compile time (review 2): the slot factors are computed once per fragment (a mask loop + ONE flat pair loop, no loop
  // in a loop), the unrolled light sites only read two bits
  const sites = src.match(/\*= float\( \( lmLo >> uint\( \d+ \+ UNROLLED_LOOP_INDEX \) \) & 1u \) \* \( 1\.0 \/ 3\.0 \) \+ float\( \( lmHi >> uint\( \d+ \+ UNROLLED_LOOP_INDEX \) \) & 1u \) \* \( 2\.0 \/ 3\.0 \);/g) || [];
  check('soldelen er maskert, lyssetene (punkt, spot, flate) leser bare to biter', src.includes('lmSunLit()') && sites.length === 3 && !/lmLight\(/.test(src), `${sites.length}`);
  const loc = pars.slice(pars.indexOf('void lmLocate('), pars.indexOf('float lmSunLit'));
  const loops = (loc.match(/\bfor \(/g) || []).length;
  check('lmLocate har tre flate løkker (bokser, masker, par) med grenser fra uniformene, ingen løkke i løkke',
    loops === 3 && /int nq = min\( int\( lmSun\.z/.test(loc) && !/for \([^\n]*\n(?:[^\n]*\n){0,3}\t\tfor \(/.test(loc), `${loops}`);
  check('3 · ⅓ + ⅔ = nøyaktig 1 i float32 (stuas egne lamper er uendret når maskene er på)', Math.fround(Math.fround(1 / 3) + Math.fround(2 / 3)) === 1);
  const a = lm.lightMask.uniforms.lmSlot.value;
  const saved = a.slice();
  lm.lightMask.setSlot('spot', 3, 0b101, 0b100, { x: 1, y: 2, z: 3 });
  const i = (lm.MAX_SLOTS.point + 3) * 4;
  check('setSlot pakker posisjon og maske + 65536 · (hjemrom + 1)', a[i] === 1 && a[i + 1] === 2 && a[i + 2] === 3 && a[i + 3] === 5 + 65536 * 3, [...a.slice(i, i + 4)].join());
  a.set(saved);
}

section('Sol under himlingen over forplassen (sidefeltene ved ytterdøra)');
{
  const M = manager(layout);
  const side = M._roomWindows.find((w) => w.id === 'win-ute-ost');
  check('sidefeltet kjenner himlingen over seg', !!side && side.soffits?.length >= 1, side?.soffits?.length);
  if (side) {
    const dir = (elevDeg) => new THREE.Vector3(Math.cos(elevDeg * Math.PI / 180), Math.sin(elevDeg * Math.PI / 180), 0); // due south (+x)
    const low = M._soffitSun(side, dir(22)), high = M._soffitSun(side, dir(55));
    check(`lav oktobersol (22°) når det meste av glasset (${low.toFixed(2)}), høy sommersol (55°) stenges nesten ute (${high.toFixed(2)})`, low > 0.6 && high < 0.35 && high < low);
    const other = M._roomWindows.find((w) => !w.soffits?.length);
    check('vinduer uten himling over seg: uendret (1)', !other || M._soffitSun(other, dir(55)) === 1);
  }
}

done();
