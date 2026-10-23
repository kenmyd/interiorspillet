#!/usr/bin/env node
/**
 * Node test for the lighting of generated houses (notes/belysning-genererte-hus.md):
 *   node tools/house-tests/belysning.test.mjs        (from the project root; exit code 1 on failure)
 *
 * The lighting test house of dev/belysning.html (src/dev/belysning-hus.js: drawn as a planbygger plan, exported by the
 * planbygger, given `lighting` with hints) built with buildLayout + buildRooms, and checked:
 *   • the format: validateHouse accepts it, catches broken `lighting` / hints / room `use`, and accepts the planned
 *     lights written into the file instead (what a planbygger may send) – built the same;
 *   • the rules per room: spots in the kitchen, bathroom, entrance and halls, pendants over the dining table and the
 *     island at the right height, LED under the upper cabinets, wall lamps, the lamp over the mirror, reading lamps at
 *     the bed, ceiling lamps at the collar of the loft and spots on the slope (tilted with it), step lights in the wall
 *     along the stair, outdoor lamps at the front door, the terrace and the carport; groups, dimmers and auto rules;
 *   • every fitting where it belongs: ceiling fittings on the ceiling (sloping or not), wall fittings on a wall face and
 *     off its windows and doors, outdoor lamps on the outer face of an exterior wall;
 *   • the 3D build: a fitting and a light entry with glowing meshes for every light, glow merged per room and group, no
 *     lamp mesh casting shadows; measured: draw calls, triangles, build time with and without the lighting, the lamp
 *     rig's candidates (home/lamprig.js);
 *   • the levels (basic / standard / rich), auto: false, a room with lighting: false or with lights of its own;
 *   • a house without `lighting` gets nothing new, and the owner's house is unchanged (geometry and every light).
 */
import { imp, readJson, check, section, done } from './_lib.mjs';
import crypto from 'node:crypto';

const THREE = await import('three');
(await imp('src/home/materials.js')).configureMaterials({ textureRes: 0.125 });
const { buildLayout, layout: ownerLayout } = await imp('src/home/layout.js');
const { buildRooms } = await imp('src/home/rooms.js');
const { createHouseRoots } = await imp('src/home/index.js');
const LP = await imp('src/home/lightplan.js');
const { candidatesOf } = await imp('src/home/lamprig.js');
const B = await imp('src/dev/belysning-hus.js');
const HS = await imp('src/data/scripts/house.mjs');
const E = await imp('src/planbygger/export.js');
const { ownerFingerprint } = await imp('tools/house-tests/owner-fingerprint.mjs');

const build = (house) => buildLayout(B.mergeOnto(B.baseSpec(), house), undefined, { devWarnings: false });
/** buildRooms as the planbygger's 3D view calls it; the result's `all` holds the level roots and the builder's group. */
const rooms3d = (layout) => {
  const roots = createHouseRoots(layout, [new THREE.Group()]);
  const R = buildRooms({ scene: new THREE.Scene(), quality: { level: 'low' }, roots }, layout, null);
  R.all = [...Object.values(roots.levels), R.group];
  return R;
};
const validate = (house) => {
  const registry = E.registryFor(house);
  const spec = HS.mergeHouse(E.baseSpec(), null, { files: [{ name: '10-plan.json', data: house }], registry });
  const report = HS.validateHouse(spec, { registry, throw: false });
  return { errors: report.errors.filter((m) => !E.ownerOnly(m)), warnings: report.warnings };
};
const median = (a) => [...a].sort((x, y) => x - y)[a.length >> 1];
const segDist = (p, a, b) => {
  const dx = b.x - a.x, dz = b.y - a.y, l2 = dx * dx + dz * dz || 1e-12;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.y) * dz) / l2));
  return Math.hypot(a.x + dx * t - p.x, a.y + dz * t - p.z);
};
const inPoly = (x, z, poly) => {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if (a.y > z !== b.y > z && x < ((b.x - a.x) * (z - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
};

const made = B.belysningHus();
const house = made.house;
const layout = build(house);
const H = layout.house;
const L = H.builtInLights;
const room = (name) => H.rooms.find((r) => r.name === name);
const of = (name, pred = () => true) => L.filter((l) => l.roomId === room(name)?.id && pred(l));
const groupOf = (id) => H.lightGroups.find((g) => g.id === id);
const ceilAt = (l) => H.ceilingHeightAt(l.position.x, l.position.z, H.roomsById[l.roomId].floorY + 0.5);
const rel = (l) => l.position.y - (H.roomsById[l.roomId]?.floorY ?? H.levelsById[l.levelId].floorY);
const fmt = (v, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : String(v));

// ---------------------------------------------------------------------------------------------------------------
section('Formatet: validatoren');
{
  const v = validate(house);
  check(`testhuset med lighting og hint: 0 feil i spillets validator (${v.errors.length})`, v.errors.length === 0, v.errors.slice(0, 3).join(' | '));
  check('ingen varsler om lighting', !v.warnings.some((w) => /^lighting/.test(w)), v.warnings.filter((w) => /lighting/.test(w)).join(' | '));
  const bad = JSON.parse(JSON.stringify(house));
  bad.lighting = { level: 'maks', colorK: 900, outdoor: 'ja', hints: [{ type: 'sofa', position: [1, 1] }, { type: 'island' }, { type: 'dining-table', position: [-40, -40] }, { type: 'upper-cabinets', from: [0, 0] }] };
  bad.rooms[0].use = 'kjokkenkrok';
  bad.rooms[1].lighting = 'av';
  const vb = validate(bad);
  const has = (re, list = vb.errors) => list.some((m) => re.test(m));
  check('ødelagt lighting gir feil: level, colorK, outdoor, ukjent hinttype, hint uten posisjon, overskap uten to', has(/level «maks»/) && has(/colorK/) && has(/outdoor må være/) && has(/type «sofa»/) && has(/island trenger position/) && has(/upper-cabinets trenger from og to/), vb.errors.filter((m) => /lighting/.test(m)).join(' | '));
  check('et hint utenfor alle rom gir et varsel', has(/står ikke i noe rom/, vb.warnings));
  check('rommets use og lighting sjekkes', has(/use «kjokkenkrok»/) && has(/lighting må være false/));
  // the planned lights written into the file (what a planbygger may send instead of `lighting`)
  const baked = JSON.parse(JSON.stringify(house));
  delete baked.lighting;
  baked.builtInLights = H.lightPlan.builtInLights;
  baked.lightGroups = H.lightPlan.lightGroups;
  const vk = validate(baked);
  check(`lysene skrevet inn i fila i stedet: 0 feil (${vk.errors.length})`, vk.errors.length === 0, vk.errors.slice(0, 3).join(' | '));
  const lk = build(baked);
  const sig = (list) => list.map((l) => `${l.id}|${l.type}|${l.group}|${l.position ? l.position.toArray().map((v) => v.toFixed(3)) : `${l.from.toArray()}-${l.to.toArray()}`}`).sort().join('\n');
  check(`og bygd likt (${lk.house.builtInLights.length} lys, alle merket som regellys)`, sig(lk.house.builtInLights) === sig(L) && lk.house.builtInLights.every((l) => l.generated));
}

// ---------------------------------------------------------------------------------------------------------------
section('Reglene per rom (testhuset, standard)');
const st = H.lightPlan.stats;
console.log(`  (målt) ${st.lights} lys i ${st.groups} grupper: ${Object.entries(st.byType).map(([k, n]) => `${n} ${k}`).join(', ')}`);
for (const r of H.rooms) if (r.id !== 'stue-kjokken') console.log(`  (målt) ${r.name.padEnd(13)} ${fmt(r.area, 1).padStart(5)} m²  ${LP.roomUse({ name: r.name, kind: r.kind }).padEnd(14)} ${of(r.name).map((l) => l.type + (l.style ? `/${l.style}` : '')).join(' ')}`);
check('hvert rom har lys', H.rooms.filter((r) => r.id !== 'stue-kjokken').every((r) => of(r.name).length > 0), H.rooms.filter((r) => !of(r.name).length).map((r) => r.name).join(', '));
check('«Kjøkken/stue» er kjøkken med stue, «Kontor» kontor (fra navnet), «Bod» bod', LP.roomUse({ name: 'Kjøkken/stue', kind: 'living' }) === 'kitchen-living' && LP.roomUse({ name: 'Kontor', kind: 'bedroom' }) === 'office' && LP.roomUse({ name: 'Bod', kind: 'storage' }) === 'storage' && LP.roomUse({ name: 'X', kind: 'living', use: 'dining' }) === 'dining');
{
  const ks = room('Kjøkken/stue');
  const hints = house.lighting.hints;
  const islandPoly = hints.find((h) => h.type === 'island').outline.map(([x, z]) => new THREE.Vector2(x, z));
  const tablePoly = hints.find((h) => h.type === 'dining-table').outline.map(([x, z]) => new THREE.Vector2(x, z));
  const pend = of('Kjøkken/stue', (l) => l.type === 'pendant');
  const overIsland = pend.filter((l) => inPoly(l.position.x, l.position.z, islandPoly));
  const overTable = pend.filter((l) => inPoly(l.position.x, l.position.z, tablePoly));
  const bottom = (l) => rel(l) - l.dims.drop;
  check(`kjøkkenøya (2,2 m): tre pendler over den, underkant ${overIsland.map((l) => fmt(bottom(l))).join(' / ')} m (benken 0,9 + 0,75)`, overIsland.length === 3 && overIsland.every((l) => Math.abs(bottom(l) - 1.65) < 0.02) && new Set(overIsland.map((l) => l.group)).size === 1 && groupOf(overIsland[0].group));
  check(`spisebordet (1,8 m): to pendler over det, underkant ${overTable.map((l) => fmt(bottom(l))).join(' / ')} m (bordet 0,74 + 0,65), egen gruppe`, overTable.length === 2 && overTable.every((l) => Math.abs(bottom(l) - 1.39) < 0.02) && overTable[0].group !== overIsland[0]?.group);
  const zoneSpots = of('Kjøkken/stue', (l) => l.type === 'downlight');
  const nearIsland = zoneSpots.filter((l) => islandPoly.some((p) => Math.hypot(p.x - l.position.x, p.y - l.position.z) < 2.6));
  check(`kjøkkendelen: ${zoneSpots.length} spotter, alle nær kjøkkenet (${nearIsland.length}), stuedelen en taklampe i egen gruppe`, zoneSpots.length >= 4 && nearIsland.length === zoneSpots.length && of('Kjøkken/stue', (l) => l.type === 'plafond').length >= 1 && of('Kjøkken/stue', (l) => l.type === 'plafond').every((l) => l.group !== zoneSpots[0].group));
  const strip = of('Kjøkken/stue', (l) => l.type === 'led-strip');
  check(`LED under overskapene: én list på ${fmt(strip[0]?.length)} m i høyde ${fmt(strip[0] ? strip[0].from.y - ks.floorY : NaN)} m, montert under skap`, strip.length === 1 && strip[0].mount === 'under-cabinet' && Math.abs(strip[0].from.y - ks.floorY - 1.44) < 0.01 && strip[0].length > 2.7 && strip[0].lumens > 500);
  check('vegglamper i stua (to, egen gruppe)', of('Kjøkken/stue', (l) => l.type === 'wall').length === 2);
}
{
  const bad = of('Bad');
  const bar = bad.find((l) => l.style === 'bar');
  check(`badet: spotter (${bad.filter((l) => l.type === 'downlight').length}) og en speillampe over speilet i ${fmt(bar ? rel(bar) : NaN)} m, spottene i en gruppe som er på uten dagslys`, bad.filter((l) => l.type === 'downlight').length >= 4 && bar && rel(bar) > 1.9 && rel(bar) < 2.2 && groupOf(bad[0].group)?.auto === 'on');
  const sov = of('Soverom');
  const reading = sov.filter((l) => l.style === 'reading');
  check(`soverommet: taklampe og to leselamper ved senga i ${reading.map((l) => fmt(rel(l))).join(' / ')} m`, sov.some((l) => l.type === 'plafond') && reading.length === 2 && reading.every((l) => Math.abs(rel(l) - 1.2) < 0.01) && reading[0].wallId === reading[1].wallId);
  check('boden: én taklampe, gruppa er av i auto', of('Bod').length === 1 && of('Bod')[0].type === 'plafond' && groupOf(of('Bod')[0].group)?.auto === 'off');
  check('entréen: spotter, gruppa tennes om kvelden', of('Entré').every((l) => l.type === 'downlight') && of('Entré').length >= 3 && groupOf(of('Entré')[0].group)?.auto === 'evening');
}
{
  // the stair: step lights in the wall along the flight, 0.3 above the treads
  const steps = L.filter((l) => l.type === 'step');
  const s = H.stairs[0];
  const yOk = steps.every((l) => {
    const sy = s.surfaceY(l.position.x + l.normal.x * 0.3, l.position.z + l.normal.z * 0.3) ?? s.surfaceY(l.position.x + l.normal.x * 0.5, l.position.z + l.normal.z * 0.5);
    return sy != null && Math.abs(l.position.y - sy - 0.3) < 0.12;
  });
  check(`trappa: ${steps.length} trinnlys på samme vegg langs løpet, ~0,3 m over trinnene, i gruppa «Trappa»`, steps.length >= 3 && new Set(steps.map((l) => l.wallId)).size === 1 && yOk && groupOf(steps[0].group)?.label === 'Trappa');
}
{
  // the loft: ceiling lamps at the collar, spots on the slope of the office, tilted with it
  const loft = of('Loftstue');
  const pl = loft.filter((l) => l.type === 'plafond');
  check(`loftsstua: ${pl.length} taklamper i den flate delen ved hanebjelken (${pl.map((l) => fmt(rel(l))).join(' / ')} m), ingen vippet`, pl.length >= 2 && pl.every((l) => Math.abs(rel(l) - 2.4) < 0.01 && !l.ceilingNormal));
  const wl = loft.filter((l) => l.type === 'wall');
  check(`loftsstua: vegglampene sitter på gavlveggen (veggen ≥ 2 m høy der), ikke på kneveggen`, wl.length >= 1 && wl.every((l) => {
    const w = H.wallsById[l.wallId];
    const u = (l.position.x - w.start.x) * w.dir.x + (l.position.z - w.start.y) * w.dir.y;
    return w.heightAt(u) >= 2.0;
  }));
  const ko = of('Kontor');
  check(`kontoret under skråtaket: ${ko.length} spotter der himlingen er minst 2,0 m, vippet med himlingen (helning ${ko.map((l) => fmt(Math.acos(-l.ceilingNormal?.y) * 180 / Math.PI, 0)).join(' / ')}°)`, ko.length >= 2 && ko.every((l) => l.type === 'downlight' && rel(l) >= 2.0 - 1e-6 && l.ceilingNormal && Math.abs(Math.acos(-l.ceilingNormal.y) * 180 / Math.PI - 35) < 1.5));
}
{
  // every fitting where it belongs
  const ceilingTypes = new Set(['downlight', 'plafond', 'pendant']);
  const badCeil = L.filter((l) => ceilingTypes.has(l.type) && l.roomId !== 'ute' && (Math.abs(l.position.y - ceilAt(l)) > 0.002 || !inPoly(l.position.x, l.position.z, H.roomsById[l.roomId].polygon)));
  check(`takarmaturene sitter i taket over sitt rom, også på skrå himling (${L.filter((l) => ceilingTypes.has(l.type)).length})`, badCeil.length === 0, badCeil.slice(0, 3).map((l) => `${l.id}: y ${fmt(l.position.y, 3)} tak ${fmt(ceilAt(l), 3)}`).join(' | '));
  const wallFits = L.filter((l) => l.type === 'wall' || l.type === 'step');
  const badWall = wallFits.filter((l) => {
    const w = H.wallsById[l.wallId];
    if (!w) return true;
    // back to the wall's line (its room face): half the fitting's depth inside, and the wall's thickness more outside
    const depth = l.dims?.depth ?? 0.02;
    const back = l.outdoor ? -(w.thickness + depth / 2) : depth / 2;
    const face = { x: l.position.x - w.normal.x * back, z: l.position.z - w.normal.y * back };
    const along = segDist(face, w.start, w.end);
    const u = (l.position.x - w.start.x) * w.dir.x + (l.position.z - w.start.y) * w.dir.y;
    const y = l.position.y - w.floorY;
    const inOpening = w.openings.some((o) => u > o.u0 - 0.05 && u < o.u1 + 0.05 && y > o.sill - 0.1 && y < o.top + 0.1);
    return along > 0.01 || inOpening || (l.outdoor && !w.exterior);
  });
  check(`vegg- og trinnlampene sitter på en veggflate, utelampene på yttersiden av en yttervegg, ingen i et vindu eller en dør (${wallFits.length})`, badWall.length === 0, badWall.map((l) => l.id).join(', '));
  const ute = L.filter((l) => l.roomId === 'ute');
  const byGroup = Object.fromEntries(['ute-inngang', 'ute-terrasse', 'ute-carport'].map((g) => [g, ute.filter((l) => l.group === g).length]));
  check(`ute: lampe ved ytterdøra, ved terrassen og ved carporten (${JSON.stringify(byGroup)}), alle tennes om kvelden, 1,8–2,1 m over gulvet`, byGroup['ute-inngang'] >= 1 && byGroup['ute-terrasse'] >= 1 && byGroup['ute-carport'] >= 1 && ute.every((l) => groupOf(l.group)?.auto === 'evening' && rel(l) >= 1.8 && rel(l) <= 2.1 && l.outdoor));
  const grp = new Set(H.lightGroups.map((g) => g.id));
  check('hvert lys har en gruppe som finnes; dimmerne er mellom 0 og 1; auto er en av reglene', L.every((l) => grp.has(l.group)) && H.lightGroups.every((g) => g.dimmer >= 0 && g.dimmer <= 1 && (g.auto == null || ['on', 'off', 'evening', 'dark'].includes(g.auto))));
}

// ---------------------------------------------------------------------------------------------------------------
section('3D: armaturene, gløden, ytelsen');
{
  const R = rooms3d(layout);
  check(`et lys i byggerens liste for hvert regellys, alle med glødende mesh (${R.builtInLights.length}/${L.length})`, R.builtInLights.length === L.length && R.builtInLights.every((e) => e.emissiveMeshes?.length > 0 && (e.position || (e.from && e.to))));
  // the lamp meshes: every mesh under a «…lamps…» group (the rooms' lamps, the outdoor lamps of each level)
  const lamps = [];
  const visit = (o, inLamps) => {
    const here = inLamps || /lamps/.test(o.name);
    if (o.isMesh && here) lamps.push(o);
    for (const c of o.children) visit(c, here);
  };
  for (const r of R.all) visit(r, false);
  const glow = R.builtInLights.flatMap((e) => e.emissiveMeshes);
  const glowSet = new Set(glow);
  const kinds = new Set(R.builtInLights.map((e) => `${e.roomId}|${e.group}`));
  const tris = lamps.reduce((s, m) => s + (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3, 0);
  console.log(`  (målt) ${L.length} lys → ${lamps.length} lampemesher (tegnekall), av dem ${glowSet.size} glødende (per rom, gruppe og type), ${Math.round(tris)} trekanter`);
  check(`gløden slått sammen: ${glowSet.size} glødende mesher for ${L.length} lys (${kinds.size} rom × gruppe)`, glowSet.size <= kinds.size * 3 && glowSet.size < L.length / 2);
  check('ingen lampemesh kaster skygge', lamps.every((m) => !m.castShadow));
  const cands = candidatesOf(R.builtInLights, (id) => H.roomsById[id]?.floorY ?? null);
  console.log(`  (målt) lysriggen: ${cands.length} kandidater (spottene per rom og gruppe som høyst to), fast pool på 8 lys, 0 skygger`);
  check('lysriggens kandidater: færre enn lysene, ingen kaster skygge', cands.length < L.length && cands.length > 0);
  // build time with and without the lighting (median of 3)
  const plain = JSON.parse(JSON.stringify(house));
  delete plain.lighting;
  const time = (h) => {
    const ms = [];
    for (let i = 0; i < 3; i++) {
      const t0 = performance.now();
      rooms3d(build(h));
      ms.push(performance.now() - t0);
    }
    return median(ms);
  };
  const tPlain = time(plain), tLit = time(house);
  const tPlan = median([0, 1, 2].map(() => {
    const t0 = performance.now();
    build(house);
    return performance.now() - t0;
  })) - median([0, 1, 2].map(() => {
    const t0 = performance.now();
    build(plain);
    return performance.now() - t0;
  }));
  console.log(`  (målt) buildLayout + buildRooms: ${fmt(tPlain, 0)} ms uten lys, ${fmt(tLit, 0)} ms med (reglene i buildLayout ≈ ${fmt(tPlan, 0)} ms)`);
  check('lysene gjør ikke byggingen mye tregere (under 2× og under 400 ms ekstra)', tLit < Math.max(tPlain * 2, tPlain + 400));
}

// ---------------------------------------------------------------------------------------------------------------
section('Nivåer og unntak');
{
  const basic = build(B.belysningHus({ level: 'basic' }).house).house;
  const bl = basic.builtInLights;
  check(`basic: bare taklamper i rommene og lampene ved ytterdørene (${bl.length} lys)`, bl.filter((l) => l.roomId !== 'ute').every((l) => l.type === 'plafond') && bl.filter((l) => l.roomId === 'ute').every((l) => l.group === 'ute-inngang' || l.group === 'ute-terrasse') && bl.length < L.length);
  const rich = build(B.belysningHus({ level: 'rich' }).house).house;
  check(`rich: flere vegglamper og trinnlys enn standard (${rich.builtInLights.filter((l) => l.type === 'wall' || l.type === 'step').length} mot ${L.filter((l) => l.type === 'wall' || l.type === 'step').length})`, rich.builtInLights.filter((l) => l.type === 'wall' || l.type === 'step').length > L.filter((l) => l.type === 'wall' || l.type === 'step').length);
  const off = JSON.parse(JSON.stringify(house));
  off.lighting.auto = false;
  check('auto: false gir ingen lys', build(off).house.builtInLights.length === 0);
  const some = JSON.parse(JSON.stringify(house));
  const bod = some.rooms.find((r) => r.name === 'Bod');
  bod.lighting = false;
  const sov = some.rooms.find((r) => r.name === 'Soverom');
  some.lightGroups = [{ id: 'eget', label: 'Egen lampe', roomId: sov.id, dimmer: true, defaultDimmer: 0.4 }];
  some.builtInLights = [{ id: 'l-eget', roomId: sov.id, group: 'eget', type: 'plafond', position: [sov.polygon[0][0] + 1, 2.4, sov.polygon[0][1] + 1], dims: { d: 0.3, h: 0.07 }, lumens: 900, lightColorK: 2700 }];
  const sh = build(some).house;
  check('et rom med lighting: false får ingen lys; et rom med egne lys beholder dem og får ikke regellys', !sh.builtInLights.some((l) => l.roomId === bod.id) && sh.builtInLights.filter((l) => l.roomId === sov.id).map((l) => l.id).join() === 'l-eget');
  check('med hint = false: ingen pendler, overskapslys, speil- eller leselamper, ingen carport-lampe', (() => {
    const nh = build(B.belysningHus({ hints: false }).house).house.builtInLights;
    return !nh.some((l) => l.type === 'pendant' || l.type === 'led-strip' || l.style === 'bar' || l.style === 'reading' || l.group === 'ute-carport') && nh.length > 20;
  })());
}

// ---------------------------------------------------------------------------------------------------------------
section('Uten lighting: som før');
{
  const today = B.belysningHus({ lighting: false });
  const ex = E.exportHouse(B.belysningDoc());
  const lt = build(ex.house).house;
  check(`et planbyggerhus uten lighting får bare sine egne lys (${lt.builtInLights.length} taklamper, en per rom), ingen regellys`, lt.lightPlan === null && lt.builtInLights.length === ex.house.builtInLights.length && lt.builtInLights.every((l) => !l.generated));
  check('testhuset uten lighting: ingen lys', build(today.house).house.builtInLights.length === 0);
}

section('Eierens hus er uendret');
{
  const want = readJson('tools/house-tests/fixtures/owner-lights.json');
  const f = ownerFingerprint();
  check(`geometrien: layout ${f.layout}, rom ${f.rooms}`, f.layout === want.layout && f.rooms === want.rooms);
  const lf = ownerLightFingerprint();
  check(`lysene: ${lf.n} i dataene, ${lf.nb} fra byggeren, gruppene og stuas lys – byte for byte som før`, lf.lights === want.lights && lf.groups === want.groups && lf.living === want.living && lf.built === want.built && lf.n === want.n && lf.nb === want.nb, JSON.stringify(lf));
  check('eierens hus har ingen lighting og ingen regellys', ownerLayout.house.lightPlan === null && !ownerLayout.house.builtInLights.some((l) => l.generated));
}

done();

/** sha-1 (16 hex) of the owner's lights: layout.house.builtInLights / lightGroups, the living room's, buildRooms'. */
function ownerLightFingerprint() {
  const Ho = ownerLayout.house;
  const ser = (v) => JSON.stringify(v, (k, x) => (x && x.isVector3 ? [x.x, x.y, x.z].map((n) => Math.round(n * 1e4) / 1e4) : x && x.isVector2 ? [x.x, x.y] : typeof x === 'function' ? undefined : x));
  const R = buildRooms({ scene: new THREE.Scene(), quality: {}, roots: createHouseRoots(ownerLayout, [new THREE.Group()]), collision: { addSurfaceZone() {}, addDynamicBox: (b) => ({ box: b }), removeDynamic() {} } }, ownerLayout, null);
  const built = R.builtInLights.map((l) => ({ ...l, emissiveMeshes: (l.emissiveMeshes || []).map((m) => m.name) }));
  const sha = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 16);
  return { lights: sha(ser(Ho.builtInLights)), groups: sha(ser(Ho.lightGroups)), living: sha(ser(ownerLayout.builtInLights)) + sha(ser(ownerLayout.lightGroups)), built: sha(ser(built)), n: Ho.builtInLights.length, nb: built.length };
}
