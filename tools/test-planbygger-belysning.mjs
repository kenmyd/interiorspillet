/**
 * The lighting of generated houses (notes/belysning-genererte-hus.md) on the planbygger's test set: every house of
 * tools/test-planbygger-build3d.mjs generated (src/planbygger/generate.js, the recorded AI answers or none, every
 * question's default taken), exported (export.js) and then given what the planbygger should send for the lighting – its
 * one ceiling lamp per room and its per-room groups left out, `lighting: { level }` in – and built with the game's
 * builders (buildLayout, buildRooms) in Node:
 *
 *   node tools/test-planbygger-belysning.mjs [--quick] [--only hus1,hus2] [--mode ai|noai|both] [--level standard]
 *                                            [--json file]                     (--quick: hus1, hus2 and hus4)
 *
 * Checked per house: 0 errors in the game's validator; every room of 1 m² or more lit; every outer door with a lamp
 * outside (or a note why not); every stair between two levels with step lights or a lamp over it; every ceiling fitting
 * on its room's ceiling and every wall fitting on a wall face off its windows and doors; a fitting and a glowing mesh
 * for every light; the spawn point of the planbygger's 3D view (viewer.js spawnPoint: the largest room's first light)
 * still at least a player's radius from the room's edges; the doors and windows built as without the lighting.
 * Measured: lights per type, groups, the lamp rig's candidates, lamp meshes (draw calls), build time with and without.
 */
import fs from 'node:fs';
import { imp, check, section, done } from './planbygger-lib.mjs';
import { fixtureAi } from './planbygger-ai-fixtures.mjs';
import { HOUSES, houseInputs } from './planbygger-measure-all.mjs';

const THREE = await import('three');
const G = await imp('src/planbygger/generate.js');
const Q = await imp('src/planbygger/questions.js');
const E = await imp('src/planbygger/export.js');
const HS = await imp('src/data/scripts/house.mjs');
const { buildLayout } = await imp('src/home/layout.js');
const { buildRooms } = await imp('src/home/rooms.js');
const { createHouseRoots } = await imp('src/home/index.js');
const { candidatesOf } = await imp('src/home/lamprig.js');
const { PLAYER } = await imp('src/config.js');

const args = process.argv.slice(2);
const opt = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const quick = args.includes('--quick');
const only = opt('only', null)?.split(',');
const mode = opt('mode', 'ai');
const level = opt('level', 'standard');
const houses = only ?? (quick ? ['hus1', 'hus2', 'hus4'] : HOUSES);
const modes = mode === 'both' ? [true, false] : [mode !== 'noai'];

const segDist = (x, z, a, b) => {
  const dx = b.x - a.x, dz = b.y - a.y, l2 = dx * dx + dz * dz || 1e-12;
  const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.y) * dz) / l2));
  return Math.hypot(a.x + dx * t - x, a.y + dz * t - z);
};
const edgeDist = (x, z, poly) => Math.min(...poly.map((a, i) => segDist(x, z, a, poly[(i + 1) % poly.length])));
const inPoly = (x, z, poly) => {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if (a.y > z !== b.y > z && x < ((b.x - a.x) * (z - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
};
/** What the planbygger should send (notes/belysning-genererte-hus.md): no lamps of its own, `lighting`. */
function withLighting(house) {
  const h = JSON.parse(JSON.stringify(house));
  h.builtInLights = [];
  h.lightGroups = [];
  h.lighting = { level };
  return h;
}
const rooms3d = (layout) => {
  const roots = createHouseRoots(layout, [new THREE.Group()]);
  const R = buildRooms({ quality: { level: 'low' }, roots }, layout, null);
  R.all = [...Object.values(roots.levels), R.group];
  return R;
};
const validate = (house) => {
  const registry = E.registryFor(house);
  const spec = HS.mergeHouse(E.baseSpec(), null, { files: [{ name: '10-plan.json', data: house }], registry });
  return HS.validateHouse(spec, { registry, throw: false }).errors.filter((m) => !E.ownerOnly(m));
};

const results = [];
for (const h of houses) {
  for (const ai of modes) {
    const tag = `${h} ${ai ? 'med KI' : 'uten KI'}`;
    section(tag);
    let res;
    try {
      res = await G.generate(houseInputs(h), { ai: ai ? fixtureAi({ house: h }) : null });
    } catch (err) {
      check(`${tag}: generate krasjer ikke`, false, String(err?.stack ?? err));
      continue;
    }
    const answers = Object.fromEntries(res.questions.filter((q) => q.default != null).map((q) => [q.id, q.default]));
    const ex = E.exportHouse(Q.applyAnswers(res.doc, res.questions, answers));
    const house = withLighting(ex.house);
    const errors = validate(house);
    check(`${tag}: 0 feil i spillets validator med lighting (${errors.length})`, errors.length === 0, errors.slice(0, 3).join(' | '));
    let layout, built, plainMs, litMs;
    try {
      let t0 = performance.now();
      const plain = buildLayout(E.mergeOnto(E.baseSpec(), ex.house), undefined, { devWarnings: false });
      const pr = rooms3d(plain);
      plainMs = performance.now() - t0;
      t0 = performance.now();
      layout = buildLayout(E.mergeOnto(E.baseSpec(), house), undefined, { devWarnings: false });
      built = rooms3d(layout);
      litMs = performance.now() - t0;
      check(`${tag}: dørene og vinduene som uten lys (${built.doors.length}/${pr.doors.length} dører, ${built.windows.length}/${pr.windows.length} vinduer)`, built.doors.length === pr.doors.length && built.windows.length === pr.windows.length);
    } catch (err) {
      check(`${tag}: byggerne bygger huset med lys`, false, String(err?.stack ?? err).split('\n').slice(0, 3).join(' | '));
      continue;
    }
    const H = layout.house;
    const L = H.builtInLights;
    const rooms = H.rooms.filter((r) => !r.hud && r.id !== 'stue-kjokken' && r.polygon.length >= 3);
    const dark = rooms.filter((r) => r.area >= 1 && !L.some((l) => l.roomId === r.id));
    check(`${tag}: alle ${rooms.filter((r) => r.area >= 1).length} rom på 1 m² eller mer har lys`, dark.length === 0, dark.map((r) => `${r.name} ${r.area.toFixed(1)} m²`).join(', '));
    // outer doors: a lamp outside within 1,6 m, or a note about it
    const outer = [];
    for (const w of H.walls) for (const o of w.openings) if ((o.type === 'door' || o.type === 'terrace-door') && (o.connects?.includes('ute') ?? w.exterior) && w.thickness > 0) outer.push({ w, o });
    const ute = L.filter((l) => l.roomId === 'ute');
    const issues = H.lightPlan.issues.map((i) => `${i.where}: ${i.msg}`);
    const unlit = outer.filter(({ w, o }) => !ute.some((l) => l.wallId === w.id && Math.abs(((l.position.x - w.start.x) * w.dir.x + (l.position.z - w.start.y) * w.dir.y) - (o.u0 + o.u1) / 2) < (o.u1 - o.u0) / 2 + 1.6)
      && !issues.some((m) => m.includes(o.id)) && !ute.some((l) => l.position.distanceTo(o.center) < 1.6 + (o.u1 - o.u0) / 2));
    check(`${tag}: ${outer.length} ytterdører, ${ute.length} utelamper – hver dør har en lampe ved seg (eller et notat)`, unlit.length === 0, unlit.map(({ o }) => o.id).join(', '));
    const stairsLit = H.stairs.filter((s) => L.some((l) => l.group?.startsWith('trapp')));
    check(`${tag}: ${H.stairs.length} trapper, alle med trinnlys eller en lampe over (${L.filter((l) => l.type === 'step').length} trinnlys)`, stairsLit.length === H.stairs.length || issues.some((m) => /stairs\//.test(m)));
    // fittings where they belong
    const ceil = L.filter((l) => ['downlight', 'plafond', 'pendant'].includes(l.type) && l.roomId !== 'ute');
    const badCeil = ceil.filter((l) => {
      const r = H.roomsById[l.roomId];
      return Math.abs(l.position.y - H.ceilingHeightAt(l.position.x, l.position.z, r.floorY + 0.5)) > 0.002 || !inPoly(l.position.x, l.position.z, r.polygon);
    });
    check(`${tag}: ${ceil.length} takarmaturer i taket over sitt rom`, badCeil.length === 0, badCeil.slice(0, 3).map((l) => l.id).join(', '));
    const wallFits = L.filter((l) => l.type === 'wall' || l.type === 'step');
    const badWall = wallFits.filter((l) => {
      const w = H.wallsById[l.wallId];
      if (!w) return true;
      const depth = l.dims?.depth ?? 0.02;
      const back = l.outdoor ? -(w.thickness + depth / 2) : depth / 2;
      const fx = l.position.x - w.normal.x * back, fz = l.position.z - w.normal.y * back;
      const u = (l.position.x - w.start.x) * w.dir.x + (l.position.z - w.start.y) * w.dir.y;
      const y = l.position.y - w.floorY;
      return segDist(fx, fz, w.start, w.end) > 0.01 || w.openings.some((o) => u > o.u0 - 0.05 && u < o.u1 + 0.05 && y > o.sill - 0.1 && y < o.top + 0.1);
    });
    check(`${tag}: ${wallFits.length} vegg- og trinnlamper på en veggflate, ingen i et vindu eller en dør`, badWall.length === 0, badWall.slice(0, 3).map((l) => l.id).join(', '));
    check(`${tag}: et lys med glødende mesh i byggerens liste for hvert lys (${built.builtInLights.length}/${L.length})`, built.builtInLights.length === L.length && built.builtInLights.every((e) => e.emissiveMeshes?.length));
    // the spawn point of viewer.js: the largest room of the main level, at its first light
    const main = H.levelsById.hoved ?? H.levels[0];
    const big = rooms.filter((r) => r.levelId === main.id).sort((a, b) => b.area - a.area)[0];
    const first = L.find((l) => l.roomId === big?.id && l.position);
    const sp = first ? [first.position.x, first.position.z] : big ? [big.centroid.x, big.centroid.y] : null;
    check(`${tag}: viewer.js' startpunkt (første lys i ${big?.name}) er minst ${PLAYER.radius} m fra rommets kanter (${sp ? edgeDist(sp[0], sp[1], big.polygon).toFixed(2) : '–'})`, !big || (sp && inPoly(sp[0], sp[1], big.polygon) && edgeDist(sp[0], sp[1], big.polygon) >= PLAYER.radius));
    // measured
    const lampMeshes = [];
    const visit = (o, inLamps) => {
      const here = inLamps || /lamps/.test(o.name);
      if (o.isMesh && here) lampMeshes.push(o);
      for (const c of o.children) visit(c, here);
    };
    for (const r of built.all) visit(r, false);
    const cands = candidatesOf(built.builtInLights, (id) => H.roomsById[id]?.floorY ?? null);
    const st = H.lightPlan.stats;
    const row = { house: h, ai, rooms: rooms.length, area: Math.round(rooms.reduce((s, r) => s + r.area, 0)), lights: st.lights, groups: st.groups, byType: st.byType, candidates: cands.length, lampMeshes: lampMeshes.length, plainMs: Math.round(plainMs), litMs: Math.round(litMs), issues: issues.length };
    results.push(row);
    console.log(`  (målt) ${row.rooms} rom, ${row.area} m²: ${st.lights} lys (${Object.entries(st.byType).map(([k, n]) => `${n} ${k}`).join(', ')}), ${st.groups} grupper, ${cands.length} riggkandidater, ${lampMeshes.length} lampemesher; bygget ${row.plainMs} → ${row.litMs} ms${issues.length ? `; ${issues.length} notater: ${issues.slice(0, 2).join(' | ')}` : ''}`);
    built.dispose?.();
  }
}

section('Sammendrag');
for (const r of results) console.log(`  ${r.house.padEnd(10)} ${r.ai ? 'KI  ' : 'uten'}  ${String(r.rooms).padStart(2)} rom ${String(r.area).padStart(4)} m²  ${String(r.lights).padStart(3)} lys  ${String(r.groups).padStart(2)} grupper  ${String(r.candidates).padStart(3)} kandidater  ${String(r.lampMeshes).padStart(3)} lampemesher  ${String(r.plainMs).padStart(4)} → ${String(r.litMs).padStart(4)} ms`);
if (opt('json', null)) fs.writeFileSync(opt('json'), JSON.stringify(results, null, 2));
done();
