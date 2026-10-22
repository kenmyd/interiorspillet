#!/usr/bin/env node
/**
 * Spots and downlights in the LightManager (design/lighting.md §4, §7.1; MASTER §2.5, D4, D5, D29). Node only, no
 * renderer:
 *   0  «Uendret uten nye lamper»: the original design (built-ins + today's item lamps through SceneSync) gives exactly
 *      tools/house-tests/fixtures/lighting-baseline.json at all three quality levels (byte equality)
 *   1–11  fixed light pools, pooled downlights per room / zone, the per-room seat cap, stable slots, «remove all = as
 *      before», other rooms keep their lights, basement ceilings, rail heads merged, tilted spots, glow per head
 *   12 SceneSync sends the room and the quantity (a 3 × 3 grid = 9 × the store's lumens; a basement item's room)
 *   13 «Plassplan»: planSpotSeats unit tests and the seat invariant I1–I4 (MASTER §2.5) at the living room with
 *      door-gang open and in the overview, 21:00, medium and low
 *
 *   node tools/house-tests/downlights.test.mjs [--section=0[,13]] [--write-fixture]
 *     --section       only these sections (section 0 alone takes < 2 s)
 *     --write-fixture rewrites the lighting fixture – refused unless QA_INTEGRATION=1 (and then it MUST be explained
 *                     in notes/)
 */
const L = await import(new URL(import.meta.dirname.endsWith('wip') ? '../_lib.mjs' : './_lib.mjs', import.meta.url));
const { ROOT, imp, check, section, done } = L;
import fs from 'node:fs';
import path from 'node:path';
import { registerHooks } from 'node:module';

registerHooks({
  load(url, context, nextLoad) {
    if (url.startsWith('file:') && url.endsWith('.css')) return { format: 'module', source: '', shortCircuit: true };
    return nextLoad(url, context);
  },
});

const args = process.argv.slice(2);
const only = (() => {
  const a = args.find((x) => x.startsWith('--section='));
  return a ? new Set(a.slice(10).split(',').map((s) => Number(s.trim())).filter(Number.isFinite)) : null;
})();
const want = (n) => !only || only.has(n);
const FIXTURE = path.join(ROOT, 'tools/house-tests/fixtures/lighting-baseline.json');

const THREE = await import('three');
const quiet = (fn) => {
  const w = console.warn;
  console.warn = () => {};
  try {
    return fn();
  } finally {
    console.warn = w;
  }
};
(await imp('src/home/materials.js')).configureMaterials({ textureRes: 0.125 });
const { layout } = await imp('src/home/layout.js');
const { LightManager, LIGHT_BUDGET } = await imp('src/home/lighting.js');
const { planSpotSeats, splitClusters } = await imp('src/home/lightclusters.js');
const { DesignState } = await imp('src/design/DesignState.js');
const { SceneSync } = await imp('src/design/SceneSync.js');

const DEG = Math.PI / 180;
const LIVING = 'stue-kjokken';
const POOLS = { low: { point: 2, spot: 8, rect: 3 }, medium: { point: 2, spot: 12, rect: 4 }, high: { point: 4, spot: 14, rect: 8 } };
const r12 = (v) => (typeof v === 'number' ? +v.toPrecision(12) : v);

const makeHome = (doors = []) => {
  const lights = layout.builtInLights.map((l) => ({ ...l }));
  return { layout, builtInLights: lights, house: { builtInLights: [...lights] }, doors };
};
const manager = (level = 'medium', doors = []) => quiet(() => new LightManager({ scene: new THREE.Scene(), home: makeHome(doors), quality: { level } }));
const cam = new THREE.PerspectiveCamera();
const at = (M, hour, pos, look) => {
  M.setTime({ hour, month: 10, day: 18 });
  cam.position.copy(pos);
  if (look) cam.lookAt(look);
  cam.updateMatrixWorld(true);
  M._selectAt = -1e9;
  M.update(0, cam);
  M.update(1 / 60, cam);
  return M;
};
const snap = (M) => JSON.stringify({
  Lkey: M._Lkey, S: M._Starget, wb: M._wbTarget.toArray(), wbK: M._wbK, amb: M._ambTarget,
  info: (({ effective, lampsOnByDefault, lampLumens }) => ({ effective, lampsOnByDefault, lampLumens }))(M.info()),
  slots: ['point', 'spot', 'rect'].map((k) => M._pool[k].map((s) => s.cand?.id ?? null).join(',')).join('|'),
});
const own = layout.ceilingHeightAt, houseCeil = layout.house?.ceilingHeightAt;
/** Ceiling height (world y) over (x, z) on the level whose floor is under y. */
const ceilAt = (x, z, y = 1) => (houseCeil && own.length < 3 ? houseCeil(x, z, y) : own(x, z, y));
/** A recessed downlight's world light 7 mm under the ceiling (SceneSync output). */
const dl = (x, z, o = {}) => ({
  type: 'spot', position: new THREE.Vector3(x, o.y ?? ceilAt(x, z, (o.floorY ?? 0) + 1) - 0.007, z),
  direction: o.dir ?? new THREE.Vector3(0, -1, 0), angle: 0.47, penumbra: 0.5, colorK: 2700, lumens: o.lm ?? 450, on: o.on ?? true,
  dimmer: o.dimmer ?? 0.4, emissiveMeshes: o.emissive ?? [], cluster: o.cluster === undefined ? 'downlight' : o.cluster,
  fitting: o.fitting ?? 'recessed', ...(o.roomId ? { roomId: o.roomId } : {}),
});
const counts = (M) => {
  const c = {};
  M.scene.traverse((o) => {
    if (o.isLight) c[o.type] = (c[o.type] || 0) + 1;
  });
  return c;
};
const slotIds = (M) => M._pool.spot.map((s) => s.cand?.id ?? null);
const NIGHT = [21, new THREE.Vector3(5, 1.6, 6), new THREE.Vector3(4, 1.2, 9)];
/** 20 singles in a 4 × 5 grid (x 3.6…6.3, z 5.6…10.4) and one 12-light grid item (3 × 4, x 4.2…5.8, z 9.0…10.6). */
function addScene(M) {
  const uids = [];
  for (let i = 0; i < 20; i++) {
    const x = 3.6 + (i % 4) * 0.9, z = 5.6 + Math.floor(i / 4) * 1.2;
    M.setItemLights(`dl${i}`, [dl(x, z)]);
    uids.push(`dl${i}`);
  }
  const grid = [];
  for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) grid.push(dl(4.2 + (c * 1.6) / 3, 9.0 + r * 0.8));
  M.setItemLights('grid', grid);
  uids.push('grid');
  return uids;
}
const members = (M) => [...M._items.values()].flat().filter((c) => c.cluster === 'downlight');
const clusterKey = (id) => id.slice('cluster:'.length, id.lastIndexOf(':'));

// ---- 0 ------------------------------------------------------------------------------------------------------------

/** The make-lighting-baseline snapshot of the current tree (same poses, hours and rounding). */
function fixtureSnapshot() {
  const out = { note: 'LightManager snapshot of the ORIGINAL design (built-ins + original item lamps via SceneSync), Node, no renderer', levels: {} };
  for (const level of ['low', 'medium', 'high']) {
    const lights = layout.builtInLights.map((l) => ({ ...l }));
    const scene = new THREE.Scene();
    const M = quiet(() => new LightManager({ scene, home: { layout, builtInLights: lights, house: { builtInLights: [...lights] }, doors: [] }, quality: { level } }));
    const items = new THREE.Group();
    scene.add(items);
    const home = { roots: { items }, layout, walls: layout.walls, windows: layout.windows, ceilingHeightAt: (!houseCeil || own.length >= 3) ? own : (x, z, y) => (y == null ? own(x, z) : houseCeil(x, z, y)) };
    const design = new DesignState();
    const sync = new SceneSync({ home, design, lighting: M });
    sync.gating = false;
    for (const it of design.list()) sync._queue.add(it.uid);
    quiet(() => sync.flush());
    const c = new THREE.PerspectiveCamera();
    const lightCount = {};
    scene.traverse((o) => {
      if (o.isLight) lightCount[o.type] = (lightCount[o.type] || 0) + 1;
    });
    const snaps = {};
    const poses = [...layout.photoCameras.map((pc) => [pc.id, pc.pos, pc.lookAt]),
      ['soverom', new THREE.Vector3(1.5, 1.6, 5.6), new THREE.Vector3(1.5, 1.4, 8)],
      ['gang', new THREE.Vector3(2.6, 1.6, 3.2), new THREE.Vector3(0.5, 1.4, 3.2)],
      ['kjellerstue', new THREE.Vector3(3.5, -0.95, 6.2), new THREE.Vector3(3.5, -1.2, 9)]];
    for (const [id, pos, look] of poses) {
      for (const hour of [8.5, 12, 20, 23]) {
        M.setTime({ hour, month: 10, day: 18 });
        c.position.copy(pos);
        c.lookAt(look);
        c.updateMatrixWorld(true);
        M._selectAt = -1e9;
        M.update(0, c);
        M.update(1 / 60, c);
        const info = M.info();
        snaps[`${id}@${hour}`] = {
          room: M.cameraRoomId, Lkey: r12(M._Lkey), S: r12(M._Starget), wb: M._wbTarget.toArray().map(r12), wbK: r12(M._wbK), amb: r12(M._ambTarget),
          info: { effective: info.effective, lampsOnByDefault: info.lampsOnByDefault, lampLumens: r12(info.lampLumens) },
          slots: ['point', 'spot', 'rect'].map((k) => M._pool[k].map((s) => s.cand?.id ?? null).join(',')).join('|'),
        };
      }
    }
    out.levels[level] = { lightCount, pool: Object.fromEntries(['point', 'spot', 'rect'].map((k) => [k, M._pool[k].length])), snaps };
  }
  return out;
}

if (want(0)) {
  section('0 Uendret uten nye lamper (lysfiksturen, alle tre kvalitetsnivåer)');
  const got = fixtureSnapshot();
  const text = JSON.stringify(got, null, 1);
  if (args.includes('--write-fixture')) {
    if (process.env.QA_INTEGRATION !== '1') {
      check('--write-fixture er nektet (bare med QA_INTEGRATION=1)', false, 'sett QA_INTEGRATION=1 – og forklar endringen i notes/');
    } else {
      fs.writeFileSync(FIXTURE, text);
      console.log(`  skrev ${path.relative(ROOT, FIXTURE)} – MÅ begrunnes i notes/`);
    }
  }
  const have = fs.readFileSync(FIXTURE, 'utf8');
  const fx = JSON.parse(have);
  const diffs = [];
  for (const level of ['low', 'medium', 'high']) {
    const a = fx.levels?.[level], b = got.levels[level];
    if (!a) {
      diffs.push(`${level}: mangler i fiksturen`);
      continue;
    }
    if (JSON.stringify(a.lightCount) !== JSON.stringify(b.lightCount)) diffs.push(`${level} lys: ${JSON.stringify(a.lightCount)} → ${JSON.stringify(b.lightCount)}`);
    if (JSON.stringify(a.pool) !== JSON.stringify(b.pool)) diffs.push(`${level} pool: ${JSON.stringify(a.pool)} → ${JSON.stringify(b.pool)}`);
    for (const k of Object.keys(a.snaps)) {
      const x = a.snaps[k], y = b.snaps[k];
      if (!y) {
        diffs.push(`${level} ${k}: mangler`);
        continue;
      }
      if (x.slots !== y.slots) {
        const xs = x.slots.split(/[|,]/), ys = y.slots.split(/[|,]/);
        const moved = xs.map((id, i) => (id !== ys[i] ? `#${i} ${id} → ${ys[i]}` : null)).filter(Boolean);
        diffs.push(`${level} ${k} plasser: ${moved.slice(0, 6).join('; ')}`);
      } else if (JSON.stringify(x) !== JSON.stringify(y)) {
        const keys = Object.keys(x).filter((q) => JSON.stringify(x[q]) !== JSON.stringify(y[q]));
        diffs.push(`${level} ${k}: ${keys.join(', ')}`);
      }
    }
  }
  check('øyeblikksbildet er byte-likt fixtures/lighting-baseline.json', text === have, diffs.slice(0, 8).join(' | ') || 'formatet avviker');
  check('ingen forskjell i plasser, lys eller tall', !diffs.length, diffs.slice(0, 8).join(' | '));
}

// ---- 1, 2, 5, 6 -----------------------------------------------------------------------------------------------------

if (want(1) || want(2) || want(5) || want(6)) {
  const M = manager('medium');
  at(M, ...NIGHT);
  const base = counts(M), baseSlots = slotIds(M), baseSnap = snap(M);
  const uids = addScene(M);
  at(M, ...NIGHT);
  if (want(1)) {
    section('1 Fast lysbudsjett (ingen omkompilering)');
    check('like mange lys av hver type i scenen med 32 downlights', JSON.stringify(counts(M)) === JSON.stringify(base), `${JSON.stringify(base)} → ${JSON.stringify(counts(M))}`);
    check('poolene er 12 spot, 2 punkt, 4 flate (middels)', M._pool.spot.length === 12 && M._pool.point.length === 2 && M._pool.rect.length === 4,
      `${M._pool.spot.length}/${M._pool.point.length}/${M._pool.rect.length}`);
  }
  if (want(2)) {
    section('2 Downlights samles per rom og sone');
    const byKey = new Map();
    for (const c of M._clusters) byKey.set(clusterKey(c.id), (byKey.get(clusterKey(c.id)) ?? 0) + 1);
    check(`≤ ${LIGHT_BUDGET.maxDownlightSpots} samlede spotter per rom og sone (${[...byKey].map(([k, n]) => `${k} ${n}`).join(', ')})`,
      byKey.size > 0 && [...byKey.values()].every((n) => n <= LIGHT_BUDGET.maxDownlightSpots));
    const ms = members(M);
    const fm = ms.reduce((s, c) => s + (c.on ? c.flux : 0), 0), fc = M._clusters.reduce((s, c) => s + c.flux, 0);
    check('samlet lysstrøm = summen av medlemmenes', Math.abs(fm - fc) < 1e-6 && fm > 0, `${fm} / ${fc}`);
    check('ingen medlem har en lysplass selv', ms.every((c) => !c.slot));
    const seen = new Map();
    for (const c of M._clusters) for (const id of c.members) seen.set(id, (seen.get(id) ?? 0) + 1);
    check('hvert medlem står i nøyaktig én samling', ms.length === 32 && ms.every((c) => seen.get(c.id) === 1) && seen.size === ms.length, `${ms.length} medlemmer, ${seen.size} i samlinger`);
    check('samlinger med flere medlemmer kaster ikke skygge', M._clusters.filter((c) => c.members.length > 1).every((c) => c.noShadow));
    const row = (n, d, x0 = 3.8) => Array.from({ length: n }, (_, i) => ({ id: `r${i}`, position: { x: x0 + i * d, z: 5 } }));
    check('fire på rad med 0,8 m (2,4 m) er én samling, fem (3,2 m) blir to',
      splitClusters(row(4, 0.8), { maxParts: 2 }).length === 1 && splitClusters(row(5, 0.8), { maxParts: 2 }).length === 2);
    check('et mellomrom over 2 m deler', splitClusters([...row(2, 0.5), ...row(2, 0.5, 6.0).map((c) => ({ ...c, id: `s${c.id}` }))], { maxParts: 2 }).map((p) => p.length).join() === '2,2');
    check('itemLightState: en downlight i en samling med plass = «slot», ukjent uid = null',
      uids.some((u) => M.itemLightState(u) === 'slot') && M.itemLightState('finnes-ikke') === null);
  }
  if (want(5)) {
    section('5 Stabile plasser');
    const before = new Map();
    M._pool.spot.forEach((s, i) => {
      if (s.cand?.id?.startsWith('cluster:')) before.set(s.cand.id, i);
    });
    M.setItemLights('dl3', [dl(3.6 + 3 * 0.9 + 0.05, 5.6)]);
    at(M, ...NIGHT);
    const after = new Map();
    M._pool.spot.forEach((s, i) => {
      if (s.cand?.id?.startsWith('cluster:')) after.set(s.cand.id, i);
    });
    check(`samme samlinger på samme plasser etter at dl3 er flyttet 5 cm (${before.size})`,
      before.size > 0 && JSON.stringify([...before].sort()) === JSON.stringify([...after].sort()), `${JSON.stringify([...before])} → ${JSON.stringify([...after])}`);
  }
  if (want(6)) {
    section('6 Fjern alt = som før');
    for (const u of uids) M.setItemLights(u, null);
    at(M, ...NIGHT);
    check('ingen samlinger igjen', M._clusters.length === 0, `${M._clusters.length}`);
    check('spotplassene er som før', JSON.stringify(slotIds(M)) === JSON.stringify(baseSlots), `${baseSlots.join()} → ${slotIds(M).join()}`);
    check('Lkey, eksponering, hvitbalanse, ambient, info og alle plasser er som før', snap(M) === baseSnap);
  }
}

// ---- 3 --------------------------------------------------------------------------------------------------------------

if (want(3)) {
  section('3 Taket per kvalitet');
  for (const level of ['low', 'medium', 'high']) {
    const M = manager(level);
    // 32 downlights over kjøkken, spisestue and stue
    let i = 0;
    for (const [x0, z0] of [[3.4, 0.6], [3.6, 4.0], [3.6, 8.8]]) {
      for (let k = 0; k < (i < 20 ? 10 : 12) && i < 32; k++, i++) M.setItemLights(`q${i}`, [dl(x0 + (k % 4) * 0.8, z0 + Math.floor(k / 4) * 0.9)]);
    }
    at(M, ...NIGHT);
    const capped = M._pool.spot.filter((s) => s.cand?.capped && s.cand.roomId === LIVING).length;
    check(`${level}: spotterkategorien har ${capped} ≤ ${LIGHT_BUDGET.itemSpots[level]} plasser i stua`, capped <= LIGHT_BUDGET.itemSpots[level] && capped > 0);
    check(`${level}: spot-poolen er ${POOLS[level].spot}`, M._pool.spot.length === POOLS[level].spot, `${M._pool.spot.length}`);
  }
}

// ---- 4 --------------------------------------------------------------------------------------------------------------

if (want(4)) {
  section('4 Ett rutenett tar ikke stuas egne lys (middels)');
  const M = manager('medium');
  at(M, ...NIGHT);
  const base = M._pool.spot.map((s) => s.cand);
  const free = base.filter((c) => !c).length;
  const builtIns = base.filter((c) => c?.source === 'builtin' || c?.wantsShadow).map((c) => c.id);
  const shadowWant = M._pool.spot.filter((s) => s.cand?.wantsShadow).map((s) => s.cand.id);
  const grid = [];
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) grid.push(dl(4.4 + c * 1.1, 9.0 + r * 1.0));
  M.setItemLights('grid', grid);
  at(M, ...NIGHT);
  const now = new Set(slotIds(M));
  check(`${free} ledige spotplasser før rutenettet (≥ 2)`, free >= 2);
  check('alle stuas egne lys i plassene har fortsatt plass', builtIns.every((id) => now.has(id)), builtIns.filter((id) => !now.has(id)).join());
  check(`≤ 2 samlinger (${M._clusters.length}), og de har plass`, M._clusters.length <= 2 && M._clusters.length > 0 && M._clusters.every((c) => c.slot));
  const shadowNow = M._pool.spot.filter((s) => s.shadowed && s.cand?.wantsShadow).map((s) => s.cand.id);
  check(`høyveggens spotter (${shadowWant.length}) har fortsatt skyggeplass`, shadowWant.every((id) => shadowNow.includes(id)), `${shadowWant.join()} / ${shadowNow.join()}`);
}

// ---- 7 --------------------------------------------------------------------------------------------------------------

if (want(7)) {
  section('7 Andre rom beholder sine lys');
  const rooms = layout.house.rooms;
  for (const id of ['soverom', 'kjellerstue']) {
    const rm = rooms.find((r) => r.id === id);
    const pos = new THREE.Vector3(rm.centroid.x, rm.floorY + 1.6, rm.centroid.y);
    const look = pos.clone().add(new THREE.Vector3(1, -0.3, 0));
    const M = manager('medium');
    at(M, 21, pos, look);
    const before = slotIds(M);
    for (let i = 0; i < 20; i++) M.setItemLights(`dl${i}`, [dl(3.6 + (i % 4) * 0.9, 5.6 + Math.floor(i / 4) * 1.2)]);
    at(M, 21, pos, look);
    check(`${rm.name.toLowerCase()} (${id}): spotplassene er uendret med 20 downlights i stua`, JSON.stringify(slotIds(M)) === JSON.stringify(before), `${before.join()} → ${slotIds(M).join()}`);
    check(`${id}: ingen samling fra stua har plass`, !M._pool.spot.some((s) => String(s.cand?.id ?? '').startsWith(`cluster:${LIVING}`)));
  }
}

// ---- 8 --------------------------------------------------------------------------------------------------------------

if (want(8)) {
  section('8 Kjellertak: riktig rom');
  const rm = layout.house.rooms.find((r) => r.id === 'kjellerstue');
  const M = manager('medium');
  M.setItemLights('kj', [dl(rm.centroid.x, rm.centroid.y, { y: -0.3, roomId: 'kjellerstue' })]);
  at(M, ...NIGHT);
  const c = M._items.get('kj')[0];
  check('med roomId fra SceneSync: kandidaten er kjellerstuas', c.roomId === 'kjellerstue', c.roomId);
  check('med kameraet i stua får den aldri plass', !M._pool.spot.some((s) => s.cand?.id === c.id || s.cand?.members?.includes(c.id)));
  M.setItemLights('kj2', [dl(rm.centroid.x, rm.centroid.y, { y: -0.295 })]);
  at(M, ...NIGHT);
  check('uten roomId på y = −0,295 regnes den som stuas (den gamle feilen SceneSync nå unngår)', M._items.get('kj2')[0].roomId === LIVING, M._items.get('kj2')[0].roomId);
}

// ---- 9, 10 ------------------------------------------------------------------------------------------------------------

if (want(9)) {
  section('9 Skinne: hoder slås sammen');
  const M = manager('medium');
  const s = Math.sin(30 * DEG), c = Math.cos(30 * DEG);
  const head = (x, sx) => dl(x, 2.0, { cluster: 'fixture', fitting: 'track', lm: 300, dir: new THREE.Vector3(sx * s, -c, 0) });
  M.setItemLights('rail', [head(4.0, 1), head(4.4, 1), head(4.8, -1), head(5.2, -1)]);
  at(M, ...NIGHT);
  const list = M._items.get('rail');
  check('4 hoder i to retninger → 2 kandidater', list.length === 2, `${list.length}`);
  check('Σ lumen = 1200', Math.abs(list.reduce((t, x) => t + x.lumens, 0) - 1200) < 1e-6);
  check('hver sammenslått kjegle ≥ 0,47 rad', list.every((x) => x.angle >= 0.47 - 1e-9 && x.merged === 2), list.map((x) => x.angle.toFixed(3)).join());
  check('id-ene er item:rail:m0 og m1', list.map((x) => x.id).join() === 'item:rail:m0,item:rail:m1');
  M.setItemLights('rail', [head(4.0, 1), head(4.4, 1), head(4.8, 1), head(5.2, 1)]);
  check('4 hoder samme vei → 1 kandidat', M._items.get('rail').length === 1);
  M.setItemLights('rail2', [head(4.0, 1), head(4.4, -1)]);
  check('2 hoder forblir 2', M._items.get('rail2').length === 2 && M._items.get('rail2').every((x) => !x.merged));
}

if (want(10)) {
  section('10 Vippet spot er egen spot');
  const M = manager('medium');
  M.setItemLights('tilt', [dl(5, 6, { dir: new THREE.Vector3(0.5, -0.866, 0).normalize(), fitting: 'spot' })]);
  const c = M._items.get('tilt')[0];
  check('30° vippet: ingen samling, men i spotterkategorien', c.cluster === null && c.capped === true && c.kind === 'spot');
  M.setItemLights('tilt20', [dl(5, 6, { dir: new THREE.Vector3(Math.sin(20 * DEG), -Math.cos(20 * DEG), 0), fitting: 'spot' })]);
  check('20° (standard takspot) samles fortsatt (minDown 0,93)', M._items.get('tilt20')[0].cluster === 'downlight');
}

// ---- 11 -------------------------------------------------------------------------------------------------------------

if (want(11)) {
  section('11 Glød per hode');
  const M = manager('medium');
  const geo = new THREE.CircleGeometry(0.03, 12);
  const m12 = new THREE.MeshStandardMaterial({ emissive: new THREE.Color(1, 1, 1), emissiveIntensity: 0 });
  m12.userData = { baseIntensity: 3, emitters: 12 };
  const m1 = new THREE.MeshStandardMaterial({ emissive: new THREE.Color(1, 1, 1), emissiveIntensity: 0 });
  m1.userData = { baseIntensity: 3 };
  const g12 = [];
  for (let i = 0; i < 12; i++) g12.push(dl(4.2 + (i % 4) * 0.5, 9 + Math.floor(i / 4) * 0.5, { emissive: i === 0 ? [new THREE.Mesh(geo, m12)] : [] }));
  M.setItemLights('g12', g12);
  M.setItemLights('g1', [dl(3.6, 6, { emissive: [new THREE.Mesh(geo, m1)] })]);
  at(M, ...NIGHT);
  const a = m12.emissiveIntensity, b = m1.emissiveIntensity;
  check(`linsene i et 12-rutenett lyser som én downlight (${a.toFixed(3)} / ${b.toFixed(3)})`, b > 0 && Math.abs(a / b - 1) < 0.01);
}

// ---- 12 -------------------------------------------------------------------------------------------------------------

if (want(12)) {
  section('12 SceneSync sender rom og antall');
  const rec = new Map();
  const lighting = { setItemLights: (uid, l) => rec.set(uid, l) };
  const items = new THREE.Group();
  const home = { roots: { items }, layout, walls: layout.walls, windows: layout.windows, ceilingHeightAt: (!houseCeil || own.length >= 3) ? own : (x, z, y) => (y == null ? own(x, z) : houseCeil(x, z, y)) };
  const design = new DesignState();
  const sync = new SceneSync({ home, design, lighting });
  sync.gating = false;
  const spec = (o) => ({ source: 'custom', name: 'Testspot', category: 'spotter', archetype: 'downlight', mount: 'ceiling', colors: {}, materials: {},
    light: { on: true, dimmer: 1, colorK: 2700, lumens: 450 }, ...o });
  const gridUid = design.add(spec({ level: 'hoved', position: [5.0, 2.4, 10.0], dims: { w: 2.49, d: 2.49, h: 0.008 }, params: { gridRows: 3, gridCols: 3, gridDx: 1.2, gridDz: 1.2 } }));
  const rm = layout.house.rooms.find((r) => r.id === 'kjellerstue');
  const kjUid = design.add(spec({ level: 'kjeller', position: [rm.centroid.x, -0.3, rm.centroid.y], dims: { w: 0.09, d: 0.09, h: 0.008 }, params: {} }));
  sync._queue.add(gridUid);
  sync._queue.add(kjUid);
  quiet(() => sync.flush());
  const synth = (n) => Array.from({ length: n }, (_, i) => ({ type: 'spot', position: [(i % 3 - 1) * 1.2, -0.0055, (Math.floor(i / 3) - 1) * 1.2], direction: [0, -1, 0],
    angle: 0.35, penumbra: 0.5, lumens: 450, colorK: 2700, cluster: 'downlight', fitting: 'recessed', emissiveMeshes: [] }));
  const send = (uid, n) => {
    const e = sync._entries.get(uid);
    e.object.userData.model = { ...(e.object.userData.model || {}), lights: synth(n) };
    sync._lights(e);
    return rec.get(uid) || [];
  };
  const g = send(gridUid, 9);
  const total = g.reduce((s, l) => s + l.lumens, 0);
  check(`3 × 3-rutenett: 9 lys, ${Math.round(total)} lumen = 9 × 450`, g.length === 9 && Math.abs(total - 9 * 450) < 1e-6);
  check('rutenettet: rom stue-kjokken, cluster og fitting sendt med', g.every((l) => l.roomId === LIVING && l.cluster === 'downlight' && l.fitting === 'recessed'));
  const k = send(kjUid, 1);
  check('kjellerlampen: roomId kjellerstue', k.length === 1 && k[0].roomId === 'kjellerstue', k[0]?.roomId);
}

// ---- 13 -------------------------------------------------------------------------------------------------------------

if (want(13)) {
  section('13 Plassplan: planSpotSeats');
  const C = (id, score, roomId, o = {}) => ({ id, score, roomId, ...o });
  {
    const list = [C('a', 5, 'A'), C('b', 4, 'B')];
    check('uten spotterkategorien: null (dagens vei)', planSpotSeats(list, { slots: 4, shadowSlots: 0, cap: 2 }) === null);
  }
  {
    const list = [C('a', 5, 'A'), C('b', 4, 'B'), C('c', 3, 'A'), C('x', 0.1, 'A', { capped: true })];
    const p = planSpotSeats(list, { slots: 4, shadowSlots: 0, cap: 2 });
    check('ledige plasser først: ingen mister plassen', p.size === 4 && list.every((c) => p.has(c)));
  }
  {
    const a1 = C('a1', 10, 'A'), a2 = C('a2', 5, 'A'), a3 = C('a3', 7, 'A'), b1 = C('b1', 1, 'B'), x = C('x', 0.5, 'A', { capped: true });
    const p = planSpotSeats([a1, a2, a3, b1, x], { slots: 4, shadowSlots: 0, cap: 2 });
    check('fullt: den svakeste i eget rom viker, ikke det svakeste lyset i et annet rom', p.has(x) && !p.has(a2) && p.has(a1) && p.has(a3) && p.has(b1));
  }
  {
    const s1 = C('s1', 0.1, 'A', { wantsShadow: true }), a1 = C('a1', 3, 'A'), b1 = C('b1', 0.2, 'B'), x = C('x', 9, 'A', { capped: true });
    const p = planSpotSeats([s1, a1, b1, x], { slots: 3, shadowSlots: 1, cap: 2 });
    check('høyveggens spotter (wantsShadow) viker aldri', p.has(s1) && !p.has(a1) && p.has(x) && p.has(b1));
  }
  {
    const b1 = C('b1', 1, 'B'), b2 = C('b2', 2, 'B'), x = C('x', 9, 'A', { capped: true });
    const p = planSpotSeats([b1, b2, x], { slots: 2, shadowSlots: 0, cap: 2 });
    check('ingen plass og ingen i eget rom å ta fra: den nye lampen lyser som omgivelseslys', !p.has(x) && p.has(b1) && p.has(b2));
  }
  {
    const xs = [9, 8, 7, 6].map((s, i) => C(`x${i}`, s, 'A', { capped: true }));
    const p = planSpotSeats(xs, { slots: 8, shadowSlots: 0, cap: 2 });
    check('høyst cap per rom, de beste først', p.size === 2 && p.has(xs[0]) && p.has(xs[1]));
    const p3 = planSpotSeats(xs, { slots: 8, shadowSlots: 0, cap: 3 });
    check('«Høy» gir 3 per rom', p3.size === 3);
  }
  {
    const a = C('a', 2, 'A'), b = C('b', 2, 'A'), x = C('x', 1, 'A', { capped: true });
    const p = planSpotSeats([b, a, x], { slots: 2, shadowSlots: 0, cap: 2 });
    check('lik poengsum: id-rekkefølgen avgjør (stabilt)', p.has(a) && !p.has(b) && p.has(x));
  }

  section('13 Plassplan: invariantene I1–I4 (MASTER §2.5)');
  const door = { t: 1 };
  /** The new fittings S: a 3 × 3 grid in the stue zone, 6 singles in the spisestue, a 4-head rail in the kitchen, a
   *  picture light over the painting, a downlight in the hall (another room's capped candidate). */
  const addS = (M, on = true) => {
    const grid = [];
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) grid.push(dl(4.4 + c * 1.1, 9.0 + r * 1.0, { on }));
    M.setItemLights('S-grid', grid);
    for (let i = 0; i < 6; i++) M.setItemLights(`S-dl${i}`, [dl(3.8 + (i % 3) * 1.0, 4.4 + Math.floor(i / 3) * 1.6, { on })]);
    const sn = Math.sin(30 * DEG), cs = Math.cos(30 * DEG);
    M.setItemLights('S-rail', [0, 1, 2, 3].map((i) => dl(3.4 + i * 0.4, 1.4, { on, cluster: 'fixture', fitting: 'track', lm: 300, dir: new THREE.Vector3(i < 2 ? sn : -sn, -cs, 0) })));
    M.setItemLights('S-pic', [{ ...dl(5.35, 11.8, { on, cluster: null, fitting: 'picture', lm: 250, dir: new THREE.Vector3(0, -0.77, 0.64).normalize() }), position: new THREE.Vector3(5.35, 2.08, 11.75), angle: 0.95, penumbra: 0.8 }]);
    M.setItemLights('S-gang', [dl(1.6, 3.4, { on })]);
  };
  const S_UIDS = ['S-grid', ...Array.from({ length: 6 }, (_, i) => `S-dl${i}`), 'S-rail', 'S-pic', 'S-gang'];
  const seated = (M) => M._pool.spot.map((s) => s.cand).filter(Boolean);
  const poses = [
    ['stua, door-gang åpen', (M) => M.setOverviewLevel(null)],
    ['oversikt over 1. etasje', (M) => M.setOverviewLevel('hoved')],
  ];
  for (const level of ['medium', 'low']) {
    for (const [pose, setPose] of poses) {
      const M = manager(level, [{ id: 'door-gang', door }]);
      setPose(M);
      at(M, ...NIGHT);
      const W = seated(M), Wids = slotIds(M);
      addS(M);
      at(M, ...NIGHT);
      const V = seated(M), Vset = new Set(V);
      const cap = LIGHT_BUDGET.itemSpots[level];
      const cappedByRoom = new Map();
      for (const c of V) if (c.capped) cappedByRoom.set(c.roomId ?? LIVING, (cappedByRoom.get(c.roomId ?? LIVING) ?? 0) + 1);
      const tag = `${level}, ${pose}`;
      check(`I1 ${tag}: ≤ ${cap} av spotterkategorien per rom (${[...cappedByRoom].map(([r, n]) => `${r} ${n}`).join(', ') || 'ingen'})`,
        [...cappedByRoom.values()].every((n) => n <= cap) && cappedByRoom.size > 0);
      const lost = W.filter((c) => !Vset.has(c));
      const lostByRoom = new Map();
      for (const c of lost) lostByRoom.set(c.roomId ?? LIVING, (lostByRoom.get(c.roomId ?? LIVING) ?? 0) + 1);
      const okLost = lost.every((c) => !c.capped && !c.wantsShadow && cappedByRoom.has(c.roomId ?? LIVING))
        && [...lostByRoom].every(([r, n]) => n <= (cappedByRoom.get(r) ?? 0));
      check(`I2 ${tag}: bare lys i samme rom viker (${lost.map((c) => c.id).join(', ') || 'ingen'})`, okLost);
      if (level !== 'low') {
        const sh = W.filter((c) => c.wantsShadow);
        check(`I3 ${tag}: høyveggens ${sh.length} spotter har fortsatt skyggeplass`, sh.every((c) => c.slot?.shadowed && c.slot.cand === c));
      }
      // switched off, then removed: exactly the slot list without them
      for (const u of S_UIDS) M.setItemLights(u, null);
      addS(M, false);
      at(M, ...NIGHT);
      const off = slotIds(M);
      check(`I4 ${tag}: slått av → samme plassliste som uten dem`, JSON.stringify(off) === JSON.stringify(Wids), `${Wids.join()} → ${off.join()}`);
      for (const u of S_UIDS) M.setItemLights(u, null);
      addS(M);
      at(M, ...NIGHT);
      for (const u of S_UIDS) M.setItemLights(u, null);
      at(M, ...NIGHT);
      const rm = slotIds(M);
      check(`I4 ${tag}: fjernet → samme plassliste som uten dem`, JSON.stringify(rm) === JSON.stringify(Wids), `${Wids.join()} → ${rm.join()}`);
    }
  }
  {
    // I4 after a tour: the fittings arrive while the living room's lamps hold no slot (camera in the basement), so every
    // slot is assigned afresh with them – the others must still get exactly the slots they get without them
    const M = manager('medium', [{ id: 'door-gang', door: { t: 0 } }]);
    at(M, ...NIGHT);
    const W = slotIds(M);
    const ks = layout.house.rooms.find((r) => r.id === 'kjellerstue');
    at(M, 23, new THREE.Vector3(ks.centroid.x, ks.floorY + 1.6, ks.centroid.y), new THREE.Vector3(ks.centroid.x + 1, ks.floorY + 1.3, ks.centroid.y));
    addS(M);
    at(M, ...NIGHT);
    for (const u of S_UIDS) M.setItemLights(u, null);
    addS(M, false);
    at(M, ...NIGHT);
    check('I4 etter en runde i kjelleren: slått av → samme plassliste og rekkefølge som uten dem', JSON.stringify(slotIds(M)) === JSON.stringify(W), `${W.join()} → ${slotIds(M).join()}`);
  }
  {
    const M = manager('medium', [{ id: 'door-gang', door }]);
    at(M, ...NIGHT);
    addS(M);
    at(M, ...NIGHT);
    const st = ['S-grid', 'S-rail', 'S-pic', 'S-gang'].map((u) => M.itemLightState(u));
    check(`itemLightState for de nye lampene: ${st.join(', ')}`, st.every((s) => s === 'slot' || s === 'ambient'));
    M.setItemLights('S-off', [dl(5, 6, { on: false })]);
    at(M, ...NIGHT);
    check('itemLightState for en avslått lampe = «off»', M.itemLightState('S-off') === 'off');
  }
}

done();
