#!/usr/bin/env node
/**
 * Many new spots and downlights, end to end at the SceneSync level (design/qa.md §3.1 B–G; MASTER §2.5, §2.6, D3–D6,
 * D29, D42). Real spots.js models of synthetic item specs (the six spot archetypes, no product ids) go through
 * DesignState → SceneSync → LightManager in Node (no renderer). downlights.test (P01) checks the LightManager level
 * with hand-made lights; this test checks what the game really sends.
 *
 * The stress set S (qa §3.1): G1 3 × 3 innfelt rund i TV-stua (flat 2,40) · G2 2 × 4 innfelt firkantet under skråtaket
 * over spisestua · G3 3 × 3 utenpåliggende på kjøkkenet · R1 4 vippbare innfelte (tilt 30°) i stua · T1 en skinne med
 * 4 hoder mot w-vest-stue · P1 2 bildelamper på w-vest-stue (over maleriet) · X1 en takspot · X2 en veggspot på
 * w-vest-tv = 38 lyshoder i ÉN transaksjon; G4 2 × 3 på soverommet; G5 2 × 3 i kjellerstua.
 *
 *   B «Faste lyspooler»        THREE lights per type and pool sizes = the lighting fixture's, after every step (all
 *                              levels); removal leaves exactly the original uids, no cluster, the same snapshot
 *   C «Stua kl. 21»            the seat invariant I1–I4 (MASTER §2.5, quoted below), pooled downlights per room/zone
 *                              (≤ maxDownlightSpots), flux conserved, off = gone, daytime windows/shadow slots, cost
 *   D «Andre rom»              gang (door shut/open), soverom and kjellerstua keep their own seats; G4/G5 rooms
 *   E «Skråtaket»              §2.5 «Geometry checks» G1–G3 on the world meshes and lights, D6 aim, wall fittings,
 *                              the picture light snapped over the painting (placementHooks.wallSnap)
 *   F «Rutenett og rekke»      one grid item = 9 fittings, one undo step, heads follow the slope, quantity 9,
 *                              gridOps.distributeGrid («Fordel jevnt») and splitGrid («Del opp») incl. the 300 limit
 *   G «Lagring»                toJSON → load into a fresh DesignState + SceneSync: params, light and the world lights
 *
 * MASTER §2.5 seat invariant (W = seats without the new fittings S, V = with S, same pose/hour/level):
 *   I1: per room, capped candidates seated in V ≤ itemSpots[level].
 *   I2: every candidate seated in W and not in V is non-capped, not wantsShadow, and has the room of a capped candidate
 *       seated in V; per room their number ≤ the capped candidates seated in V in that room.
 *   I3: on medium/high the wantsShadow candidates seated in W hold shadowed slots in V.
 *   I4: with S switched off or removed, the slot list (ids in slot-index order) equals W exactly.
 *
 *   node tools/house-tests/lightbudget.test.mjs [--section=B,C,D,E,F,G]
 * QA_PARTIAL=1: only what is not delivered yet is soft (spots.js still a stub, gridOps missing).
 */
const L = await import(new URL(import.meta.dirname.endsWith('wip') ? '../_lib.mjs' : './_lib.mjs', import.meta.url));
const { imp, readJson, check, section, done } = L;
const Q = await import(new URL(import.meta.dirname.endsWith('wip') ? '../_qa.mjs' : './_qa.mjs', import.meta.url));

Q.cssHook();
const T0 = performance.now();
const args = process.argv.slice(2);
const only = (() => {
  const a = args.find((x) => x.startsWith('--section='));
  return a ? new Set(a.slice(10).toUpperCase().split(',').map((s) => s.trim())) : null;
})();
const want = (s) => !only || only.has(s);
const THREE = await Q.three();
const reg = await imp('src/models/registry.js');
const GRID = await imp('src/design/grid.js');
const { LIGHT_BUDGET } = await imp('src/home/lighting.js');
const { LIMITS } = await imp('src/design/DesignState.js');
let OPS = null;
try {
  OPS = await imp('src/design/gridOps.js');
} catch {
  OPS = null;
}
const FIX = readJson('tools/house-tests/fixtures/lighting-baseline.json');
const DEG = Math.PI / 180;
const LIVING = 'stue-kjokken';
const EMBED_TOL = 0.012 + 0.002; // lamps.js EMBED + 2 mm (MASTER §2.5 G1, D42)
const show = (list, n = 5) => (list.length ? `${list.slice(0, n).join(' | ')}${list.length > n ? ` | … (${list.length})` : ''}` : '');
const f3 = (v) => (Number.isFinite(v) ? +v.toFixed(4) : v);

const POSE = {
  LIV: [[5, 1.6, 6], [4, 1.2, 9]],
  GANG: [[2.6, 1.6, 3.2], [0.5, 1.4, 3.2]],
  SOV: [[1.5, 1.6, 5.6], [1.5, 1.4, 8]],
  KS: [[3.5, -0.95, 6.2], [3.5, -1.2, 9]],
};

// spots.js delivered? (a stub exports no archetypes: everything here is pending then)
const missingSpots = Q.SPOT_ROLES && Object.values(Q.SPOT_ROLES).map((r) => r.archetype).filter((a, i, s) => s.indexOf(a) === i && !reg.getArchetype(a));
if (missingSpots.length) {
  section('Spotter');
  Q.pending('spots.js har bygger for de seks spotarketypene', `mangler ${missingSpots.join(', ')}`);
  done();
}

/** A home with the original design, the door-gang leaf `door` and every light the SceneSync sends recorded. */
async function home(level = 'medium', door = { t: 0 }) {
  const H = await Q.syncedHome({ level, doors: [{ id: 'door-gang', door }] });
  H.door = door;
  H.sent = new Map();
  const orig = H.M.setItemLights.bind(H.M);
  H.M.setItemLights = (uid, lights) => {
    if (lights?.length) H.sent.set(uid, lights);
    else H.sent.delete(uid);
    return orig(uid, lights);
  };
  for (const e of H.sync._entries.values()) if (e.hadLights) H.sync._lights(e); // record the original lamps too
  H.ceil = (x, z, floorY = 0) => Q.ceilAt(H.layout, x, z, floorY + 1);
  H.view = (pose, hour) => H.at(hour, ...POSE[pose]);
  return H;
}

/** Ceiling-mounted spec at (x, z): y = the ceiling there (the Placement convention). */
const onCeiling = (H, role, x, z, o = {}) => {
  const fy = o.level === 'kjeller' ? -2.55 : 0;
  return Q.spotSpec(role, { ...o, position: [x, H.ceil(x, z, fy), z] });
};
/** A grid item (one item, rows × cols fittings) centred at (x, z). */
const gridItem = (H, role, x, z, rows, cols, dx, dz, o = {}) => {
  const head = Q.SPOT_ROLES[role].dims;
  const g = GRID.gridSpec(head, { rows, cols, dx, dz });
  return onCeiling(H, role, x, z, { ...o, dims: g.dims, params: { ...(Q.SPOT_ROLES[role].params || {}), ...(o.params || {}), ...g.params } });
};
const wallItem = (role, wallId, x, y, z, o = {}) => Q.spotSpec(role, { ...o, position: [x, y, z], rotationDeg: 180, attach: { wallId, normal: [0, 0, -1] } });

/** The stress set S (qa §3.1), G4 and G5 as { key: spec }. */
function stressSet(H) {
  const S = {
    G1: gridItem(H, 'recessedRound', 1.6, 10.1, 3, 3, 1.0, 1.0),
    G2: gridItem(H, 'recessedSquare', 5.1, 5.8, 2, 4, 0.8, 1.2),
    G3: gridItem(H, 'surface', 4.5, 1.7, 3, 3, 1.1, 0.9),
    ...Object.fromEntries([3.8, 4.6, 5.4, 6.2].map((x, i) => [`R1-${i}`, onCeiling(H, 'recessedTilt', x, 10.9, { params: { tilt: 30 } })])),
    T1: onCeiling(H, 'rail', 5.1, 11.2, { params: { heads: 4, tilt: 25 } }),
    'P1-a': wallItem('pictureLight', 'w-vest-stue', 5.35, 2.05, 11.93),
    'P1-b': wallItem('pictureLight', 'w-vest-stue', 4.0, 1.95, 11.93),
    X1: onCeiling(H, 'spotSingle', 6.0, 9.5),
    X2: wallItem('wallSpot', 'w-vest-tv', 2.9, 2.0, 11.93),
  };
  const others = {
    G4: gridItem(H, 'recessedRound', 1.56, 6.37, 2, 3, 0.9, 0.9),
    G5: gridItem(H, 'recessedRound', 4.75, 8.35, 2, 3, 1.0, 1.0, { level: 'kjeller' }),
  };
  return { S, others };
}

/** Adds specs in ONE transaction; → { key: uid }. */
function addAll(H, specs, label = 'QA: mange spotter') {
  const out = {};
  H.design.transaction(label, () => {
    for (const [k, s] of Object.entries(specs)) out[k] = H.design.add({ ...s, name: `QA ${k}` });
  });
  H.flush();
  return out;
}
const removeAll = (H, uids) => {
  H.design.transaction('QA: fjern', () => {
    for (const u of uids) H.design.remove(u);
  });
  H.flush();
};
const setLight = (H, uids, patch) => {
  H.design.transaction('QA: lys', () => {
    for (const u of uids) H.design.update(u, { light: patch });
  });
  H.flush();
};
/** Candidates of the spot pool's slots, by slot index. */
const seated = (H) => H.M._pool.spot.map((s) => s.cand).filter(Boolean);
const slotIds = (H) => H.M._pool.spot.map((s) => s.cand?.id ?? null);
/** Item candidate ids of a set of uids (incl. merged rail candidates) and the clusters made of their heads. */
function derived(H, uids) {
  const set = new Set(uids);
  const items = [...H.M._items.entries()].filter(([u]) => set.has(u)).flatMap(([, l]) => l);
  const ids = new Set(items.map((c) => c.id));
  const clusters = (H.M._clusters || []).filter((k) => k.members.some((m) => ids.has(m)));
  return { items, ids, clusters, has: (c) => !!c && (ids.has(c.id) || (c.source === 'cluster' && c.members.some((m) => ids.has(m)))) };
}
const roomOf = (c) => c.roomId ?? LIVING;

/** I1–I3 between the seats W (without S) and V (with S); → problems. */
function invariant(W, V, level) {
  const out = [];
  const cap = LIGHT_BUDGET.itemSpots[level];
  const Vids = new Set(V.map((c) => c.id));
  const cappedBy = new Map();
  for (const c of V) if (c.capped) cappedBy.set(roomOf(c), (cappedBy.get(roomOf(c)) ?? 0) + 1);
  for (const [r, n] of cappedBy) if (n > cap) out.push(`I1 ${r}: ${n} > ${cap}`);
  const lost = W.filter((c) => !Vids.has(c.id));
  const lostBy = new Map();
  for (const c of lost) {
    lostBy.set(roomOf(c), (lostBy.get(roomOf(c)) ?? 0) + 1);
    if (c.capped || c.wantsShadow || !cappedBy.has(roomOf(c))) out.push(`I2 ${c.id} (${roomOf(c)}) mistet plassen`);
  }
  for (const [r, n] of lostBy) if (n > (cappedBy.get(r) ?? 0)) out.push(`I2 ${r}: ${n} mistet, ${cappedBy.get(r) ?? 0} nye`);
  if (level !== 'low') {
    for (const c of W.filter((x) => x.wantsShadow)) {
      const v = V.find((x) => x.id === c.id);
      if (!v?.slot?.shadowed) out.push(`I3 ${c.id} har ikke skyggeplass`);
    }
  }
  return { out, cappedBy, lost };
}
const fixture = (level) => FIX.levels[level];
const poolsOk = (H) => JSON.stringify(H.lightCount()) === JSON.stringify(fixture(H.level).lightCount) && JSON.stringify(H.pools()) === JSON.stringify(fixture(H.level).pool);

// ---------------------------------------------------------------------------------------------------------------
if (want('B')) {
  section('B Faste lyspooler (alle kvalitetsnivåer)');
  for (const level of ['low', 'medium', 'high']) {
    const H = await home(level);
    const W = {};
    for (const p of ['LIV', 'GANG', 'SOV', 'KS']) W[p] = JSON.stringify((H.view(p, 21), H.snap()));
    const steps = [];
    const { S, others } = stressSet(H);
    const uids = addAll(H, { ...S, ...others });
    const all = Object.values(uids);
    H.view('LIV', 21);
    steps.push(['lagt til', poolsOk(H)]);
    setLight(H, all, { on: false });
    H.view('LIV', 21);
    steps.push(['alle av', poolsOk(H)]);
    setLight(H, all, { on: true });
    H.view('LIV', 21);
    steps.push(['alle på', poolsOk(H)]);
    setLight(H, all, { dimmer: 0.1 });
    H.view('LIV', 21);
    steps.push(['dimmer 0,1', poolsOk(H)]);
    setLight(H, [uids.G1], { colorK: 4000 });
    H.view('LIV', 21);
    steps.push(['4000 K på G1', poolsOk(H)]);
    removeAll(H, all);
    for (const p of ['LIV', 'GANG', 'SOV', 'KS']) H.view(p, 21);
    steps.push(['fjernet', poolsOk(H)]);
    check(`B1 ${level}: lys per type og poolstørrelser som fiksturen etter hvert steg`, steps.every(([, ok]) => ok), steps.filter(([, ok]) => !ok).map(([n]) => n).join(', '));
    const items = [...H.M._items.keys()].filter((u) => u !== '__wall').sort();
    const orig = H.design.list().filter((it) => H.sent.has(it.uid) || H.M._items.has(it.uid)).map((it) => it.uid).sort();
    check(`B2 ${level}: etter fjerning bare de opprinnelige lampene (${items.join(', ')}), ingen klynger`, JSON.stringify(items) === JSON.stringify(orig) && !(H.M._clusters?.length), `klynger ${H.M._clusters?.length ?? 0}`);
    const diff = ['LIV', 'GANG', 'SOV', 'KS'].filter((p) => JSON.stringify((H.view(p, 21), H.snap())) !== W[p]);
    check(`B3 ${level}: øyeblikksbildet er det samme som før (ingenting lekker)`, !diff.length, diff.join(', '));
  }
}

// ---------------------------------------------------------------------------------------------------------------
let MED = null; // the medium home with S added (C, D, E reuse it)
async function medium() {
  if (MED) return MED;
  const H = await home('medium');
  const W = { LIV21: (H.view('LIV', 21), { seats: seated(H), ids: slotIds(H), snap: H.snap() }) };
  for (const [k, pose, hour] of [['LIV8', 'LIV', 8.5], ['LIV12', 'LIV', 12], ['GANG20', 'GANG', 20], ['GANG23', 'GANG', 23], ['SOV23', 'SOV', 23], ['KS23', 'KS', 23]]) {
    H.view(pose, hour);
    W[k] = { seats: seated(H), ids: slotIds(H), rect: H.M._pool.rect.map((s) => s.cand?.id ?? null), snap: H.snap() };
  }
  const { S, others } = stressSet(H);
  const t = performance.now();
  const uids = addAll(H, { ...S, ...others });
  const addMs = performance.now() - t;
  H.W = W;
  H.uids = uids;
  H.S = Object.keys(S).map((k) => uids[k]);
  H.addMs = addMs;
  MED = H;
  return H;
}

if (want('C')) {
  section('C Stua kl. 21 med 38 nye lyshoder (middels)');
  const H = await medium();
  const all = Object.values(H.uids);
  const heads = H.S.reduce((n, u) => n + (H.sent.get(u)?.length ?? 0), 0);
  check(`S gir ${heads} lyshoder i SceneSync (38 forventet)`, heads === 38, `${heads}`);
  check(`S ble lagt til som ÉN angrebar endring (${Math.round(H.addMs)} ms for bygg + lys)`, H.design._undo.at(-1)?.label === 'QA: mange spotter');
  H.view('LIV', 21);
  const V = seated(H);
  const { out, cappedBy, lost } = invariant(H.W.LIV21.seats, V, 'medium');
  check(`I1–I3 stua: ≤ ${LIGHT_BUDGET.itemSpots.medium} nye per rom (${[...cappedBy].map(([r, n]) => `${r} ${n}`).join(', ') || 'ingen'}), bare samme roms lys viker (${lost.map((c) => c.id).join(', ') || 'ingen'})`, !out.length, show(out));
  const d = derived(H, H.S);
  const newInLiving = V.filter((c) => d.has(c) && roomOf(c) === LIVING).length;
  check(`C3 nye lys med plass i stua: ${newInLiving} ≤ ${LIGHT_BUDGET.itemSpots.medium}`, newInLiving <= LIGHT_BUDGET.itemSpots.medium);
  const dl = derived(H, [H.uids.G1, H.uids.G2, H.uids.G3, ...[0, 1, 2, 3].map((i) => H.uids[`R1-${i}`])]);
  const byKey = new Map();
  for (const k of dl.clusters) {
    const key = k.id.slice(8, k.id.lastIndexOf(':'));
    byKey.set(key, (byKey.get(key) ?? 0) + 1);
  }
  check(`C4 downlightklynger per rom/sone ≤ ${LIGHT_BUDGET.maxDownlightSpots} (${[...byKey].map(([k, n]) => `${k} ${n}`).join(', ')})`, byKey.size > 0 && [...byKey.values()].every((n) => n <= LIGHT_BUDGET.maxDownlightSpots));
  const plumb = dl.items.filter((c) => c.direction.y <= -0.93);
  const loose = plumb.filter((c) => c.cluster !== 'downlight' || !dl.clusters.some((k) => k.members.includes(c.id)));
  check(`C4 alle ${plumb.length} loddrette downlighthoder er med i en klynge`, !loose.length, show(loose.map((c) => c.id)));
  const memberSeated = V.filter((c) => c.source === 'item' && c.cluster === 'downlight' && dl.ids.has(c.id));
  check('C4 ingen klyngemedlemmer har egen plass', !memberSeated.length, show(memberSeated.map((c) => c.id)));
  // flux: SceneSync sends lumens × quantity × share; the clusters pool their members' flux
  const want = H.S.reduce((s, u) => {
    const it = H.design.get(u);
    return s + (it.light.lumens ?? 0) * GRID.itemQuantity(it) * it.light.dimmer;
  }, 0);
  const got = derived(H, H.S).items.reduce((s, c) => s + (c.flux ?? 0), 0);
  check(`C5 lysmengden er bevart: ${Math.round(got)} lm = Σ lumen × antall × dimmer (${Math.round(want)} lm)`, Math.abs(got - want) <= 1e-9 * Math.max(1, want), `${got} / ${want}`);
  const clusterFlux = dl.clusters.reduce((s, k) => s + k.flux, 0);
  const memberFlux = dl.items.filter((c) => dl.clusters.some((k) => k.members.includes(c.id))).reduce((s, c) => s + c.flux, 0);
  check(`C5 klyngene bærer medlemmenes lys (${Math.round(clusterFlux)} lm)`, Math.abs(clusterFlux - memberFlux) <= 1e-9 * Math.max(1, memberFlux), `${clusterFlux} / ${memberFlux}`);
  // I4 / C6: off = gone
  setLight(H, all, { on: false });
  H.view('LIV', 21);
  const offIds = slotIds(H);
  const sorted = (l) => JSON.stringify(l.filter(Boolean).sort());
  check('I4 alle nye slått av → de samme lysene har plass som uten dem', sorted(offIds) === sorted(H.W.LIV21.ids), `${H.W.LIV21.ids.join()} → ${offIds.join()}`);
  // the slot ORDER too (MASTER §2.5 I4: ids in slot-index order) – strict since the integration (P01's final seat plan
  // reseats a returning lamp in its old slot)
  check('I4 … og i samme plassrekkefølge', JSON.stringify(offIds) === JSON.stringify(H.W.LIV21.ids), `${H.W.LIV21.ids.join()} → ${offIds.join()}`);
  const sOff = H.snap(), sW = H.W.LIV21.snap;
  check('C6 slått av: Lkey, S, hvitbalanse og omgivelseslys nøyaktig som uten dem', JSON.stringify({ ...sOff, slots: 0 }) === JSON.stringify({ ...sW, slots: 0 }), JSON.stringify({ W: { S: sW.S, wb: sW.wb, wbK: sW.wbK }, off: { S: sOff.S, wb: sOff.wb, wbK: sOff.wbK } }));
  setLight(H, all, { on: true });
  // C7: daytime – no shadow built-in loses its slot, the windows' rect slots unchanged
  for (const [k, hour] of [['LIV8', 8.5], ['LIV12', 12]]) {
    H.view('LIV', hour);
    const Vd = seated(H);
    const sh = H.W[k].seats.filter((c) => c.wantsShadow && !Vd.some((v) => v.id === c.id));
    const rect = H.M._pool.rect.map((s) => s.cand?.id ?? null);
    check(`C7 kl. ${hour}: høyveggens skyggespotter og vinduenes plasser er uendret`, !sh.length && JSON.stringify(rect) === JSON.stringify(H.W[k].rect), `${sh.map((c) => c.id).join()} ${H.W[k].rect.join()} → ${rect.join()}`);
  }
  // C8: cost
  const median = (fn) => {
    const t = [];
    for (let i = 0; i < 10; i++) {
      const a = performance.now();
      fn();
      t.push(performance.now() - a);
    }
    return t.sort((a, b) => a - b)[5];
  };
  const recompute = () => median(() => {
    H.M._markDirty();
    H.view('LIV', 21);
  });
  let ms = recompute();
  if (ms > 15) ms = Math.min(ms, recompute()); // a busy machine: measure once more before failing
  check(`C8 omregning + lysbudsjett med 38 hoder: median ${ms.toFixed(1)} ms ≤ 15 ms`, ms <= 15);
  const entries = H.S.map((u) => H.sync._entries.get(u)).filter(Boolean);
  let round = median(() => {
    for (const e of entries) H.sync._lights(e);
  });
  if (round > 5) round = Math.min(round, median(() => {
    for (const e of entries) H.sync._lights(e);
  }));
  check(`C8 én setItemLights-runde for alle hodene: median ${round.toFixed(1)} ms ≤ 5 ms`, round <= 5);
}

// ---------------------------------------------------------------------------------------------------------------
if (want('D')) {
  section('D Andre rom beholder lysplassene (middels og lav)');
  for (const level of ['medium', 'low']) {
    const H = level === 'medium' ? await medium() : await (async () => {
      const h = await home('low');
      const W = {};
      for (const [k, pose, hour] of [['GANG20', 'GANG', 20], ['GANG23', 'GANG', 23], ['SOV23', 'SOV', 23], ['KS23', 'KS', 23]]) {
        h.view(pose, hour);
        W[k] = { seats: seated(h), ids: slotIds(h) };
      }
      const { S, others } = stressSet(h);
      h.uids = addAll(h, { ...S, ...others });
      h.S = Object.keys(S).map((k) => h.uids[k]);
      h.W = W;
      return h;
    })();
    const all = Object.values(H.uids);
    const dS = () => derived(H, H.S);
    for (const [k, hour] of [['GANG20', 20], ['GANG23', 23]]) {
      H.view('GANG', hour);
      const gangW = H.W[k].seats.filter((c) => roomOf(c) === 'gang').map((c) => c.id).sort();
      const gangV = seated(H).filter((c) => roomOf(c) === 'gang').map((c) => c.id).sort();
      const sSeated = seated(H).filter((c) => derived(H, all).has(c));
      check(`D1 ${level} gangen kl. ${hour} (dør lukket): gangens plasser uendret, ingen nye lys har plass`, JSON.stringify(gangW) === JSON.stringify(gangV) && !sSeated.length, `${gangW} → ${gangV}; nye: ${sSeated.map((c) => c.id)}`);
    }
    {
      H.door.t = 1;
      H.M._markDirty();
      H.view('GANG', 23);
      const gangV = seated(H).filter((c) => roomOf(c) === 'gang').map((c) => c.id).sort();
      const gangW = H.W.GANG23.seats.filter((c) => roomOf(c) === 'gang').map((c) => c.id).sort();
      const n = seated(H).filter((c) => dS().has(c)).length;
      const cap = LIGHT_BUDGET.itemSpots[level];
      check(`D2 ${level} gangen med døra åpen: gangens plasser uendret, nye lys ${n} ≤ ${cap}`, JSON.stringify(gangW) === JSON.stringify(gangV) && n <= cap, `${gangW} → ${gangV}`);
      H.door.t = 0;
      H.M._markDirty();
    }
    {
      const g4 = derived(H, [H.uids.G4]);
      check(`D3 ${level} G4: alle lyskandidater har rom «soverom»`, g4.items.length > 0 && g4.items.every((c) => c.roomId === 'soverom'), show(g4.items.map((c) => `${c.id}:${c.roomId}`)));
      H.view('SOV', 23);
      const inv = invariant(H.W.SOV23.seats, seated(H), level);
      check(`D3 ${level} soverommet kl. 23: I1–I3 (andre roms lys beholder plassen)`, !inv.out.length, show(inv.out));
      H.view('LIV', 23);
      const g4Seated = seated(H).filter((c) => g4.has(c));
      check(`D3 ${level} fra stua (dør lukket): ingen G4-lys har plass`, !g4Seated.length, show(g4Seated.map((c) => c.id)));
    }
    {
      const g5 = derived(H, [H.uids.G5]);
      check(`D4 ${level} G5: rom «kjellerstue», aldri stua; lyset under −0,305`, g5.items.length > 0 && g5.items.every((c) => c.roomId === 'kjellerstue' && c.position.y <= -0.305), show(g5.items.map((c) => `${c.roomId} y ${f3(c.position.y)}`)));
      H.view('LIV', 23);
      check(`D4 ${level} fra stua: ingen G5-lys har plass`, !seated(H).some((c) => g5.has(c)));
      H.view('KS', 23);
      const inv = invariant(H.W.KS23.seats, seated(H), level);
      check(`D4 ${level} kjellerstua kl. 23: I1–I3`, !inv.out.length, show(inv.out));
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------
if (want('E')) {
  section('E Skråtaket og veggene (MASTER §2.5 «Geometry checks»)');
  const H = await medium();
  const ceilingKeys = Object.keys(H.uids).filter((k) => H.design.get(H.uids[k]).mount === 'ceiling');
  const g1 = [], g2 = [], g3 = [], aim = [], walls = [];
  const v = new THREE.Vector3();
  const normalAt = (x, z, fy) => {
    const e = 0.05;
    const dx = (H.ceil(x + e, z, fy) - H.ceil(x - e, z, fy)) / (2 * e), dz = (H.ceil(x, z + e, fy) - H.ceil(x, z - e, fy)) / (2 * e);
    return new THREE.Vector3(dx, -1, dz).normalize(); // pointing down, out of the ceiling
  };
  for (const k of ceilingKeys) {
    const uid = H.uids[k];
    const it = H.design.get(uid);
    const fy = it.level === 'kjeller' ? -2.55 : 0;
    const head = GRID.gridOf(it).head;
    const obj = H.sync._entries.get(uid)?.object;
    if (!obj) {
      g1.push(`${k}: ingen modell`);
      continue;
    }
    obj.updateMatrixWorld(true);
    let worstUp = -Infinity, trimBad = null;
    obj.traverse((o) => {
      if (!o.isMesh || !o.geometry?.attributes?.position || o.userData?.lightDecal || o.name === 'ceiling-pool') return;
      const pos = o.geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
        const c = H.ceil(v.x, v.z, fy);
        worstUp = Math.max(worstUp, v.y - c);
        if (o.userData?.trim) {
          const gap = c - v.y;
          if (gap < -EMBED_TOL - 1e-9 || gap > head.h + 0.002 + 1e-9) trimBad ??= `${k}: kant ${f3(gap)} m under taket ved (${f3(v.x)}, ${f3(v.z)})`;
        }
      }
    });
    if (worstUp > EMBED_TOL + 1e-9) g1.push(`${k}: ${f3(worstUp)} m over taket`);
    if (trimBad) g2.push(trimBad);
    for (const l of H.sent.get(uid) || []) {
      const c = H.ceil(l.position.x, l.position.z, fy);
      const gap = c - l.position.y;
      const max = l.fitting === 'recessed' ? 0.012 : head.h + 0.01;
      if (!(gap >= 0.004 - 1e-9 && gap <= max + 1e-9)) g3.push(`${k}: lys ${f3(gap)} m under taket (${l.fitting})`);
      if (fy < -1 && !(l.position.y <= -0.305)) g3.push(`${k}: kjellerlys y ${f3(l.position.y)}`);
      const d = l.direction;
      if (it.archetype === 'downlight' && !it.params.tiltable) {
        const n = normalAt(l.position.x, l.position.z, fy);
        const ang = Math.acos(Math.min(1, Math.max(-1, d.dot(n)))) / DEG;
        if (!(d.y <= -0.94) || ang > 2) aim.push(`${k}: ${f3(ang)}° fra takets normal, dir.y ${f3(d.y)}`);
      } else if (it.archetype === 'downlight' && it.params.tiltable) {
        const ang = Math.acos(-d.y) / DEG;
        if (Math.abs(ang - it.params.tilt) > 2) aim.push(`${k}: ${f3(ang)}° fra loddrett, tilt ${it.params.tilt}°`);
      }
    }
  }
  check('E1/G1 ingen del av takarmaturene stikker mer enn 14 mm opp i taket', !g1.length, show(g1));
  check('E2/G2 innfelte kanter følger skråtaket (0–hode.h under, maks 14 mm inn)', !g2.length, show(g2));
  check('E3/G3 lysene 4 mm–hode.h + 1 cm under taket (innfelt ≤ 12 mm), kjelleren under −0,305', !g3.length, show(g3));
  check('E4 faste innfelte peker langs takets normal (± 2°), vippbare = tilt ± 2° fra loddrett (D6)', !aim.length, show(aim));
  // wall fittings: picture lights aim at the wall, down; wall spots down; nothing deeper than EMBED into the wall
  for (const k of ['P1-a', 'P1-b', 'X2']) {
    const it = H.design.get(H.uids[k]);
    const n = new THREE.Vector3(...it.attach.normal);
    const obj = H.sync._entries.get(H.uids[k])?.object;
    obj?.updateMatrixWorld(true);
    const box = new THREE.Box3();
    obj?.traverse((o) => {
      if (!o.isMesh || o.userData?.lightDecal) return;
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
      box.union(o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld));
    });
    const wallZ = 11.93;
    if (box.max.z > wallZ + EMBED_TOL + 1e-9) walls.push(`${k}: ${f3(box.max.z - wallZ)} m inn i veggen`);
    for (const l of H.sent.get(H.uids[k]) || []) {
      if (!(l.direction.y < 0)) walls.push(`${k}: peker ikke nedover (dir.y ${f3(l.direction.y)})`);
      // picture light (spots.js, P02): the picture gets the wash decal; the spot is the light the picture gives back to
      // the room – down and out with its cone's wall-side edge along the wall. So the cone must reach the wall plane
      // (the outward tilt ≤ the cone angle) and the wash must be among the glowing meshes
      if (it.archetype === 'picture-light') {
        const out = Math.atan2(l.direction.dot(n), -l.direction.y);
        if (out > (l.angle ?? 0) + DEG) walls.push(`${k}: lyskjeglen når ikke veggen (${f3(out / DEG)}° ut, kjegle ${f3((l.angle ?? 0) / DEG)}°)`);
        if (!(l.emissiveMeshes || []).some((m) => m?.userData?.lightDecal || /wash/i.test(m?.name || ''))) walls.push(`${k}: ingen lysflate (wash) på veggen`);
      }
    }
  }
  check('E5 bildelamper lyser ned langs veggen med lysflate på bildet, veggspoten ned; ingenting mer enn 14 mm inn i veggen', !walls.length, show(walls));
  // the picture-light snap over ex-f-maleri (placementHooks.wallSnap, P01)
  let PH = null;
  try {
    PH = await imp('src/design/placementHooks.js');
  } catch {
    PH = null;
  }
  const w = H.layout.walls.find((x) => x.id === 'w-vest-stue');
  const art = H.design.get('ex-f-maleri');
  const snap = PH?.wallSnap?.({ editor: { design: H.design } }, {
    wall: { id: w.id, sx: w.start.x, sz: w.start.y, dx: w.dir.x, dz: w.dir.y, fy: w.floorY ?? 0 },
    u: (art.position[0] - w.start.x) * w.dir.x + (art.position[2] - w.start.y) * w.dir.y, v: 2.1,
    dims: Q.SPOT_ROLES.pictureLight.dims, archetype: 'picture-light', placing: true,
  });
  if (!snap) Q.pending('E5 bildelampen fester seg over maleriet (placementHooks.wallSnap)', 'wallSnap ga null');
  else {
    const above = snap.v - Q.SPOT_ROLES.pictureLight.dims.h / 2 - (art.position[1] + art.dims.h / 2);
    check(`E5 bildelampen fester seg over maleriet: underkant ${f3(above)} m over rammen (0,03–0,35)`, above >= 0.03 - 1e-6 && above <= 0.35, JSON.stringify(snap));
  }
}

// ---------------------------------------------------------------------------------------------------------------
if (want('F')) {
  section('F Rutenett og rekke');
  const H = await home('medium');
  const undo0 = H.design._undo.length;
  const spec = gridItem(H, 'recessedRound', 5.0, 6.0, 3, 3, 1.0, 1.0);
  const uid = H.design.add(spec);
  H.flush();
  const it = H.design.get(uid);
  const lights = H.sent.get(uid) || [];
  const room = H.layout.house.rooms.find((r) => r.id === LIVING);
  const pts = lights.map((l) => l.position);
  check(`F1 3 × 3-rutenett: ett element, ${lights.length} lys, antall ${GRID.itemQuantity(it)}`, lights.length === 9 && GRID.itemQuantity(it) === 9);
  const inside = pts.every((p) => room?.contains?.(p.x, p.z) ?? H.layout.isInside?.(p.x, p.z));
  const xs = [...new Set(pts.map((p) => +p.x.toFixed(3)))].sort((a, b) => a - b), zs = [...new Set(pts.map((p) => +p.z.toFixed(3)))].sort((a, b) => a - b);
  const steps = [...xs.slice(1).map((x, i) => x - xs[i]), ...zs.slice(1).map((z, i) => z - zs[i])];
  const minWall = Math.min(...pts.map((p) => Math.min(...H.layout.walls.filter((wl) => (wl.levelId ?? 'hoved') === 'hoved').map((wl) => {
    const ax = wl.start.x, az = wl.start.y, bx = wl.end.x, bz = wl.end.y;
    const t = Math.max(0, Math.min(1, ((p.x - ax) * (bx - ax) + (p.z - az) * (bz - az)) / ((bx - ax) ** 2 + (bz - az) ** 2 || 1)));
    return Math.hypot(p.x - (ax + t * (bx - ax)), p.z - (az + t * (bz - az)));
  }))));
  check(`F1 alle hodene i stua, ≥ 0,3 m fra veggene (${f3(minWall)} m), avstand 1,0 ± 1 mm`, inside && minWall >= 0.3 && xs.length === 3 && zs.length === 3 && steps.every((s) => Math.abs(s - 1) <= 0.001), `x ${xs} z ${zs}`);
  check('F1 ett angresteg', H.design._undo.length === undo0 + 1);
  H.design.undo();
  H.flush();
  const gone = !H.design.get(uid) && !H.sent.has(uid);
  H.design.redo();
  H.flush();
  check('F1 angre fjerner hele rutenettet, gjør om gir det tilbake', gone && !!H.design.get(uid) && (H.sent.get(uid)?.length ?? 0) === 9);
  const slope = (H.sent.get(uid) || []).map((l) => H.ceil(l.position.x, l.position.z) - l.position.y);
  check(`F2 hvert hode henger under sitt eget tak i skråtaket (${f3(Math.min(...slope))}–${f3(Math.max(...slope))} m)`, slope.length === 9 && slope.every((g) => Math.abs(g - 0.0055) <= 0.002), slope.map(f3).join(', '));
  const ys = (H.sent.get(uid) || []).map((l) => l.position.y);
  check('F2 hodene følger skråtaket (ulik høyde over spisestua)', Math.max(...ys) - Math.min(...ys) > 0.05, `${f3(Math.min(...ys))}–${f3(Math.max(...ys))}`);
  check('F3 handlelisten teller 9 (itemQuantity)', GRID.itemQuantity(H.design.get(uid)) === 9);
  if (!OPS?.distributeGrid || !OPS?.splitGrid) {
    Q.pending('F4/F5 «Fordel jevnt» og «Del opp» (src/design/gridOps.js)', 'gridOps.js mangler');
  } else {
    // F4: distribute 3 × 3 over the tv-stue zone: wall distance spacing / 2 (+ gridOps' 5 cm edge)
    const tv = H.layout.zones.find((z) => /tv/.test(z.id));
    const one = H.design.add(onCeiling(H, 'recessedRound', tv.centroid?.x ?? 1.6, tv.centroid?.y ?? 10.1));
    const r = OPS.distributeGrid(H.design.get(one), H.layout, { rows: 3, cols: 3 });
    if (r.error) check('F4 «Fordel jevnt» i TV-stua', false, r.error);
    else {
      const p = r.patch;
      const g = GRID.gridOf({ ...H.design.get(one), ...p, params: { ...H.design.get(one).params, ...p.params } });
      const ext = { x0: p.position[0] - ((g.cols - 1) * g.dx) / 2, x1: p.position[0] + ((g.cols - 1) * g.dx) / 2, z0: p.position[2] - ((g.rows - 1) * g.dz) / 2, z1: p.position[2] + ((g.rows - 1) * g.dz) / 2 };
      const a = r.area;
      const dists = [[ext.x0 - a.minX, g.dx], [a.maxX - ext.x1, g.dx], [ext.z0 - a.minZ, g.dz], [a.maxZ - ext.z1, g.dz]];
      const okD = dists.every(([d, s]) => d >= s / 2 - 0.01 && d <= s / 2 + 0.06);
      check(`F4 «Fordel jevnt» 3 × 3 i ${a.id}: veggavstand ≈ avstand/2 (${dists.map(([d, s]) => `${f3(d)}/${f3(s / 2)}`).join(', ')})`, g.count === 9 && okD);
      H.design.update(one, p);
      H.flush();
      check('F4 fordelt rutenett: 9 lys i SceneSync', (H.sent.get(one)?.length ?? 0) === 9);
    }
    // F5: splitting a grid past LIMITS.items is refused as a whole
    const before = JSON.stringify(H.design.list().map((x) => x.uid));
    const big = OPS.splitGrid(H.design.get(uid), { itemCount: LIMITS.items - 3 });
    check(`F5 «Del opp» som ville passert ${LIMITS.items} ting nektes (norsk feilmelding), designet er uendret`, !!big.error && !big.specs && JSON.stringify(H.design.list().map((x) => x.uid)) === before, big.error ?? 'ingen feil');
    const ok = OPS.splitGrid(H.design.get(uid), { itemCount: H.design.list().length });
    const okSpecs = ok.specs || [];
    check(`F5 «Del opp» innenfor grensen gir 9 enkeltspotter uten grid*-parametre`, okSpecs.length === 9 && okSpecs.every((s) => !Object.keys(s.params || {}).some((k) => k.startsWith('grid')) && GRID.itemQuantity(s) === 1));
  }
}

// ---------------------------------------------------------------------------------------------------------------
if (want('G')) {
  section('G Lagring');
  const H = await medium();
  const keys = [...Object.keys(H.uids).filter((k) => !k.startsWith('G5'))];
  const before = new Map(keys.map((k) => [k, (H.sent.get(H.uids[k]) || []).map((l) => [l.position.toArray(), l.direction?.toArray?.() ?? null])]));
  const json = JSON.parse(JSON.stringify(H.design.toJSON()));
  const H2 = await home('medium');
  H2.design.load(json);
  H2.flush();
  const bad = [];
  for (const k of keys) {
    const a = H.design.get(H.uids[k]), b = H2.design.get(H.uids[k]);
    if (!b) {
      bad.push(`${k}: mangler etter lasting`);
      continue;
    }
    for (const p of ['tilt', 'heads', 'gridRows', 'gridCols', 'gridDx', 'gridDz', 'shape', 'tiltable']) if (JSON.stringify(a.params[p]) !== JSON.stringify(b.params[p])) bad.push(`${k}.${p}: ${a.params[p]} → ${b.params[p]}`);
    for (const p of ['on', 'dimmer', 'colorK', 'lumens']) if (a.light?.[p] !== b.light?.[p]) bad.push(`${k}.light.${p}: ${a.light?.[p]} → ${b.light?.[p]}`);
    const l2 = (H2.sent.get(H.uids[k]) || []).map((l) => [l.position.toArray(), l.direction?.toArray?.() ?? null]);
    const l1 = before.get(k);
    if (l1.length !== l2.length) bad.push(`${k}: ${l1.length} → ${l2.length} lys`);
    else {
      l1.forEach(([p, d], i) => {
        const [q, e] = l2[i];
        if (p.some((x, j) => Math.abs(x - q[j]) > 1e-9) || (d && d.some((x, j) => Math.abs(x - e[j]) > 1e-9))) bad.push(`${k} lys ${i}: flyttet`);
      });
    }
  }
  check(`G1 S og G4 gjennom toJSON → load: parametre, lys og lysposisjoner/-retninger (1e-9) er like`, !bad.length, show(bad));
}

console.log(`\n  (${((performance.now() - T0) / 1000).toFixed(1)} s)`);
done();
