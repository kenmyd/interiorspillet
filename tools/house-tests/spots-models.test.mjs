#!/usr/bin/env node
/**
 * Spot and downlight models (design/lighting.md §7.2 with MASTER §2.5 «Geometry checks»; package P02):
 *   1 every spot archetype builds (lights, cluster/fitting, thumbView, no InstancedMesh, glow programs, noShadow,
 *     trims, every declared option builds)
 *   2 a grid is one mesh per part with one light per head
 *   3 the heads follow the sloping living-room ceiling (G1–G3), rebake only when the ceiling under them changes
 *   4 the picture light's wash (a light decal, shown only on a house wall, never on the ghost)
 *   5 tracks, plates and wall spots aim their heads
 *   6 the pure grid helpers (grid.js) and a grid item through DesignState save/load
 *   7 the catalogue's spotter products build (soft until the research lands) and the «Fakta» rows
 *
 *   node tools/house-tests/wip/spots-models.test.mjs        (later: node tools/test-house.mjs spots-models)
 */
const L = await import(new URL(import.meta.dirname.endsWith('wip') ? '../_lib.mjs' : './_lib.mjs', import.meta.url));
const { imp, check, section, near, done } = L;

const t0 = Date.now();
const THREE = await import('three');
(await imp('src/home/materials.js')).configureMaterials({ textureRes: 0.125 });
const reg = await imp('src/models/registry.js');
const cat = await imp('src/catalog/index.js');
const G = await imp('src/design/grid.js');
const { layout } = await imp('src/home/layout.js');
const { DesignState } = await imp('src/design/DesignState.js');
const { spotFacts } = await imp('src/catalog/spotfacts.js');
const schema = L.readJson('src/data/archetypes.json');

const DEG = Math.PI / 180;
const IDS = ['downlight', 'downlight-surface', 'spot-ceiling', 'spot-track', 'spot-wall', 'picture-light'];
const CEILING = new Set(['downlight', 'downlight-surface', 'spot-ceiling', 'spot-track']);
const TABLE = {
  downlight: { cluster: 'downlight', fitting: 'recessed', view: 'below' },
  'downlight-surface': { cluster: 'downlight', fitting: 'surface', view: 'below' },
  'spot-ceiling': { cluster: 'downlight', fitting: 'spot', view: 'under' },
  'spot-track': { cluster: 'fixture', fitting: 'track', view: 'under' },
  'spot-wall': { cluster: 'fixture', fitting: 'wall-spot', view: 'under' },
  'picture-light': { cluster: undefined, fitting: 'picture', view: 'under' },
};
const EMBED = 0.012;
const KEYS = new Set(['lamp-glow-tint-v1', 'lamp-ceiling-pool-v1']);
const defaultKey = (m) => m.onBeforeCompile === THREE.Material.prototype.onBeforeCompile;
const box = (o) => {
  o.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(o);
};
const meshes = (o) => {
  const out = [];
  o.traverse((m) => m.isMesh && out.push(m));
  return out;
};
const unit = (d) => Math.abs(Math.hypot(d[0], d[1], d[2]) - 1) < 1e-6;
const build = (spec) => reg.buildModel({ quality: 'medium', ...spec });
const ceil = (x, z, y = 1) => layout.ceilingHeightAt(x, z, y);
const worldLights = (g) => {
  g.updateMatrixWorld(true);
  return g.userData.model.lights.map((l) => ({
    p: new THREE.Vector3(...l.position).applyMatrix4(g.matrixWorld),
    d: new THREE.Vector3(...l.direction).transformDirection(g.matrixWorld),
    l,
  }));
};
/** Places a model like SceneSync.placeObject does for a ceiling item (main level). */
const hang = (g, x, z, rotDeg = 0) => {
  g.position.set(x, ceil(x, z), z);
  g.rotation.set(0, rotDeg * DEG, 0, 'YXZ');
  g.updateMatrixWorld(true);
  return g;
};
const lensMesh = (g) => meshes(g).find((m) => m.name === 'lens');

// ---------------------------------------------------------------------------------------------------------------
section('1. Hver spot-arketype bygger');
for (const id of IDS) {
  const g = build({ archetype: id });
  const m = g.userData.model;
  const lights = m.lights || [];
  const b = box(g);
  check(`${id}: bygger uten reservemodell`, !m.fallback);
  check(`${id}: ≥ 1 spotlys med enhetsretning`, lights.length >= 1 && lights.every((l) => l.type === 'spot' && unit(l.direction)), JSON.stringify(lights.map((l) => l.direction)));
  check(`${id}: lights[0].emissiveMeshes ≥ 1`, (lights[0]?.emissiveMeshes?.length ?? 0) >= 1);
  if (CEILING.has(id)) {
    check(`${id}: G1 box.max.y ≤ 0.014`, b.max.y <= EMBED + 0.002 + 1e-9, b.max.y.toFixed(4));
    check(`${id}: alle lys ≥ 5 mm under taket`, lights.every((l) => l.position[1] <= -0.005 + 1e-9), lights.map((l) => l.position[1].toFixed(4)).join(','));
  } else {
    check(`${id}: veggen: box.min.z ≥ −0.014`, b.min.z >= -(EMBED + 0.002) - 1e-9, b.min.z.toFixed(4));
    check(`${id}: veggen: midt i høyden ≈ 0 (±0,02)`, Math.abs((b.min.y + b.max.y) / 2) <= 0.02, ((b.min.y + b.max.y) / 2).toFixed(4));
  }
  const T = TABLE[id];
  check(`${id}: cluster ${T.cluster} / fitting ${T.fitting}`, lights.every((l) => l.cluster === T.cluster && l.fitting === T.fitting), lights.map((l) => `${l.cluster}/${l.fitting}`).join(','));
  check(`${id}: thumbView ${T.view}`, m.thumbView === T.view, m.thumbView);
  const all = meshes(g);
  check(`${id}: ingen InstancedMesh`, all.every((x) => !x.isInstancedMesh));
  check(`${id}: hver mesh har noShadow og kaster ikke skygge`, all.every((x) => x.userData.noShadow && !x.castShadow));
  const glows = lights[0]?.emissiveMeshes || [];
  check(`${id}: glødeprogrammer er kjente (standard, lamp-glow-tint-v1, lamp-ceiling-pool-v1)`, glows.every((x) => defaultKey(x.material) || KEYS.has(x.material.customProgramCacheKey?.())), glows.map((x) => x.material.customProgramCacheKey?.()).join(','));
  check(`${id}: glødematerialer har emitters = antall lys`, glows.every((x) => x.material.userData.emitters === lights.length));
  const def = reg.getArchetype(id);
  check(`${id}: delenavn fra archetypes.json`, Object.entries(schema.archetypes[id].partLabels).every(([k, v]) => def.partLabels[k] === v));
  check(`${id}: deler ⊆ arketypens`, Object.keys(m.parts).every((p) => def.parts.includes(p)), Object.keys(m.parts).join(','));
  if (id === 'downlight') check('downlight: kanten er merket userData.trim', all.some((x) => x.userData.trim));
}
// every declared option, bool and number extreme builds (the models.test sweep, here for the six)
{
  const bad = [];
  let n = 0;
  for (const id of IDS) {
    const def = reg.getArchetype(id);
    for (const [k, s] of Object.entries(def.params)) {
      const vals = s.type === 'enum' ? s.options.map((o) => o[0]) : s.type === 'bool' ? [false, true] : s.type === 'number' ? [s.min, s.max] : [];
      for (const v of vals) {
        for (const q of ['low', 'high']) {
          const g = reg.buildModel({ archetype: id, quality: q, params: { [k]: v, ...(k === 'tilt' ? { tiltable: true } : {}) } });
          n++;
          if (g.userData.model.fallback || !g.userData.model.lights.length) bad.push(`${id}.${k}=${v}@${q}`);
        }
      }
    }
    for (const lo of [true, false]) {
      const r = def.dimsRange;
      const dims = { w: lo ? r.w[0] : Math.min(r.w[1], 3), d: lo ? r.d[0] : Math.min(r.d[1], 3), h: lo ? r.h[0] : r.h[1] };
      const g = reg.buildModel({ archetype: id, dims });
      n++;
      if (g.userData.model.fallback) bad.push(`${id} dims ${JSON.stringify(dims)}`);
    }
  }
  check(`alle ${n} valg / ytterverdier bygger`, bad.length === 0, bad.join('; '));
}
{
  const a = reg.buildModel({ archetype: 'spot-track', params: { heads: 5, aim: 'fan', spread: 60 } });
  const b = reg.buildModel({ archetype: 'spot-track', params: { heads: 5, aim: 'fan', spread: 60 } });
  const tri = (g) => meshes(g).reduce((s, m) => s + m.geometry.index.count, 0);
  check('samme spesifikasjon gir samme modell (ingen tilfeldighet)', tri(a) === tri(b) && box(a).equals(box(b)));
  const w = reg.buildModel({ archetype: 'spot-track', params: { heads: 99, tilt: 500, beamDeg: 1 } });
  check('parametre utenfor området klemmes (8 hoder, ≤ 90°)', w.userData.model.lights.length === 8 && w.userData.model.lights.every((l) => l.direction[1] <= 1e-9 && l.angle >= 0.15));
}

// ---------------------------------------------------------------------------------------------------------------
section('2. Rutenett');
{
  const head = { w: 0.09, d: 0.09, h: 0.008 };
  const grid = { rows: 3, cols: 4, dx: 1, dz: 0.8 };
  const spec = { archetype: 'downlight', params: { gridRows: 3, gridCols: 4, gridDx: 1, gridDz: 0.8 }, dims: G.gridExtent(head, grid) };
  const g = build(spec);
  const one = build({ archetype: 'downlight' });
  const lights = g.userData.model.lights;
  const cells = G.gridCells(G.gridOf(spec));
  check('12 lys', lights.length === 12, `${lights.length}`);
  check('lysene står på gridCells (±1 mm)', cells.every((c, i) => near(lights[i].position[0], c.u, 0.001) && near(lights[i].position[2], c.v, 0.001)));
  const lens = meshes(g).filter((m) => m.name === 'lens');
  check('linsene er ÉN mesh med 12 × hodets hjørner', lens.length === 1 && lens[0].geometry.attributes.position.count === 12 * lensMesh(one).geometry.attributes.position.count);
  check('like mange tegnekall som én downlight', meshes(g).length === meshes(one).length, `${meshes(g).length} vs ${meshes(one).length}`);
  const b = box(g);
  check('bredden følger dims.w (±1 cm)', near(b.max.x - b.min.x, spec.dims.w, 0.01), `${(b.max.x - b.min.x).toFixed(3)} vs ${spec.dims.w}`);
  check('glødematerialene har emitters = 12', lights[0].emissiveMeshes.every((m) => m.material.userData.emitters === 12));
  check('hvert hode har hele armaturens lumen', lights.every((l) => l.lumens === 450));
}

// ---------------------------------------------------------------------------------------------------------------
section('3. Følger skråtaket');
{
  const spec = { archetype: 'downlight', params: { gridRows: 3, gridCols: 3, gridDx: 1, gridDz: 1 }, dims: G.gridExtent({ w: 0.09, d: 0.09, h: 0.008 }, { rows: 3, cols: 3, dx: 1, dz: 1 }) };
  const g = hang(build(spec), 5, 9);
  let W = worldLights(g);
  check('hvert lys 5,5 mm under sitt eget tak (±2 mm)', W.every((w) => near(w.p.y, ceil(w.p.x, w.p.z) - 0.0055, 0.002)), W.map((w) => (ceil(w.p.x, w.p.z) - w.p.y).toFixed(4)).join(','));
  const east = W.filter((w) => w.p.x > 5.5), west = W.filter((w) => w.p.x < 4.5);
  check('hodene mot sør (+x) henger lavere', east.every((e) => west.every((v) => e.p.y < v.p.y - 0.1)));
  const sx = (ceil(5.1, 9) - ceil(4.9, 9)) / 0.2;
  const nrm = new THREE.Vector3(sx, -1, 0).normalize();
  check(`faste downlights lyser langs takets normal (helning ${sx.toFixed(4)})`, W.every((w) => w.d.dot(nrm) > 0.9995), W.map((w) => w.d.dot(nrm).toFixed(5)).join(','));
  const lens = lensMesh(g);
  const v0 = lens.geometry.attributes.position.version;
  g.position.z += 0.5;
  g.position.y = ceil(5, 9.5);
  g.updateMatrixWorld(true);
  check('flytt langs et plant tak: ingen ny baking', lens.geometry.attributes.position.version === v0);
  W = worldLights(g);
  check('… og lysene følger med', W.every((w) => near(w.p.y, ceil(w.p.x, w.p.z) - 0.0055, 0.002)));
  hang(g, 1.5, 9);
  W = worldLights(g);
  check('over på flatt tak (tv-stua): bakt på nytt, alle like høyt', lens.geometry.attributes.position.version !== v0 && W.every((w) => near(w.p.y, 2.4 - 0.0055, 0.001) && near(w.d.y, -1, 1e-9)));
  hang(g, 5, 9, 90);
  W = worldLights(g);
  const item = { archetype: 'downlight', position: [5, 0, 9], rotationDeg: 90, dims: spec.dims, params: spec.params };
  const cells = G.gridCells(G.gridOf(item));
  check('rotert 90°: hodene står på cellWorld', cells.every((c, i) => {
    const [x, z] = G.cellWorld(item, c);
    return near(W[i].p.x, x, 0.001) && near(W[i].p.z, z, 0.001);
  }));
  const t = hang(build({ archetype: 'downlight', params: { tiltable: true, tilt: 20 } }), 5, 9, 30);
  const tw = worldLights(t)[0];
  check('vippbar 20°: lodd-referert (dir.y = −cos 20°)', near(tw.d.y, -Math.cos(20 * DEG), 1e-3), tw.d.y.toFixed(5));
  check('vippbar: lyset 4–12 mm under taket', ceil(tw.p.x, tw.p.z) - tw.p.y >= 0.004 && ceil(tw.p.x, tw.p.z) - tw.p.y <= 0.012, (ceil(tw.p.x, tw.p.z) - tw.p.y).toFixed(4));
  // G1–G3 for every ceiling archetype on the slope, turned 30°
  for (const id of CEILING) {
    const s = id === 'spot-track' ? { archetype: id, params: { trackShape: 'L', heads: 5 }, dims: { w: 1.2, d: 0.8, h: 0.16 } } : { archetype: id, params: { gridRows: 2, gridCols: 3, gridDx: 0.9, gridDz: 0.9 }, dims: G.gridExtent(reg.getArchetype(id).defaults.dims, { rows: 2, cols: 3, dx: 0.9, dz: 0.9 }) };
    const m = hang(build(s), 4.6, 7.5, 30);
    const head = G.gridOf(s).head;
    let g1 = -Infinity, g2 = [Infinity, -Infinity];
    const v = new THREE.Vector3();
    for (const x of meshes(m)) {
      if (!x.visible) continue;
      const pos = x.geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(x.matrixWorld);
        const dc = ceil(v.x, v.z) - v.y;
        g1 = Math.max(g1, -dc);
        if (x.userData.trim) g2 = [Math.min(g2[0], dc), Math.max(g2[1], dc)];
      }
    }
    check(`${id}: G1 ingen hjørner over taket + 14 mm`, g1 <= EMBED + 0.002 + 1e-6, g1.toFixed(4));
    if (id === 'downlight') check('downlight: G2 kanten ligger flatt mot skråtaket', g2[0] >= -(EMBED + 0.002) && g2[1] <= head.h + 0.002, g2.map((x) => x.toFixed(4)).join('…'));
    const ws = worldLights(m);
    const gaps = ws.map((w) => ceil(w.p.x, w.p.z) - w.p.y);
    const max = id === 'downlight' ? 0.012 : (id === 'spot-track' ? s.dims.h : head.h) + 0.01;
    check(`${id}: G3 lysene 4 mm – ${(max * 1000).toFixed(0)} mm under taket`, gaps.every((d) => d >= 0.004 && d <= max), gaps.map((d) => d.toFixed(4)).join(','));
  }
  // the basement: a downlight under the kjellerstue ceiling (y −0.30)
  const kj = layout.house.levelsById.kjeller.floorY;
  const ks = layout.house.roomsById.kjellerstue.centroid;
  const b = build({ archetype: 'downlight' });
  b.position.set(ks.x, layout.ceilingHeightAt(ks.x, ks.y, kj + 1), ks.y);
  const bw = worldLights(b)[0];
  check('kjelleren: lyset ligger lavere enn −0,305', bw.p.y <= -0.305, bw.p.y.toFixed(4));
}

// ---------------------------------------------------------------------------------------------------------------
section('4. Bildebelysning');
{
  const g = build({ archetype: 'picture-light' });
  const l = g.userData.model.lights;
  // the light on the picture is the wash; the spot is the picture's light back into the room (never onto the canvas)
  const edge = l[0] ? Math.atan2(l[0].direction[2], -l[0].direction[1]) - l[0].angle : -1;
  check('ett spotlys ned og ut i rommet, kjeglen når ikke veggen', l.length === 1 && l[0].direction[1] < 0 && l[0].direction[2] > 0 && edge >= -1e-9, `${JSON.stringify(l[0]?.direction)} edge ${edge}`);
  const wash = (l[0]?.emissiveMeshes || []).find((m) => m.userData.lightDecal);
  check('vasket på bildet er et lysdekal (CustomBlending, lamp-ceiling-pool-v1)', !!wash && wash.material.blending === THREE.CustomBlending && wash.material.customProgramCacheKey() === 'lamp-ceiling-pool-v1');
  const b = box(g);
  check('vasket teller ikke i armaturens mål', b.min.y > -0.1, b.min.y.toFixed(3));
  check('ikke vasket i galleriet (ikke på en vegg)', wash && !wash.visible);
  // on the living room's west wall (w-vest-stue), facing into the room
  const wall = layout.house.walls.find((w) => w.id === 'w-vest-stue');
  const u = wall.length / 2;
  g.position.set(wall.start.x + wall.dir.x * u, 1.95, wall.start.y + wall.dir.y * u);
  g.rotation.set(0, Math.atan2(wall.normal.x, wall.normal.y), 0, 'YXZ');
  g.updateMatrixWorld(true);
  check('på husets vegg vises vasket', wash.visible);
  g.userData.ghost = true;
  g.position.x += 0.2;
  g.updateMatrixWorld(true);
  check('ikke på Placement-spøkelset', !wash.visible);
  g.userData.ghost = false;
  g.position.z += 0.3;
  g.updateMatrixWorld(true);
  check('ikke midt i rommet', !wash.visible);
  const washOf = (o) => o.userData.model.lights[0].emissiveMeshes.find((m) => m.userData.lightDecal);
  const w60 = washOf(build({ archetype: 'picture-light', params: { tilt: 60 } }));
  check('vinkel 60°: mer lys på bildet enn 40°', w60.material.userData.baseIntensity > wash.material.userData.baseIntensity);
  const pa = wash.geometry.attributes.position.array;
  let wy = -Infinity, wz = 0;
  for (let i = 0; i < pa.length; i += 3) if (pa[i + 1] > wy) [wy, wz] = [pa[i + 1], pa[i + 2]];
  const ly = build({ archetype: 'picture-light' }).userData.model.lights[0].position[1];
  check('vasket starter like under lysbjelken, foran bildet', wy < ly && wy > ly - 0.05 && near(wz, 0.044, 1e-6), `${wy.toFixed(3)} / ${ly.toFixed(3)} z ${wz}`);
}

// ---------------------------------------------------------------------------------------------------------------
section('5. Skinne, takplate og veggspot');
{
  const dirs = (g) => new Set(g.userData.model.lights.map((l) => l.direction.map((v) => v.toFixed(4)).join(',')));
  const alt = build({ archetype: 'spot-track', params: { heads: 4, aim: 'alternate' } });
  check('skinne, 4 hoder annenhver vei: 4 lys, 2 retninger', alt.userData.model.lights.length === 4 && dirs(alt).size === 2);
  const par = build({ archetype: 'spot-track', params: { heads: 4, aim: 'parallel' } });
  check('samme vei: 1 retning, lumen delt på hodene', dirs(par).size === 1 && par.userData.model.lights.every((l) => near(l.lumens, 225, 1e-9)));
  const fan = build({ archetype: 'spot-track', params: { heads: 3, aim: 'fan', spread: 60 } });
  const fl = fan.userData.model.lights;
  check('vifte: ytterhodene vris ±30°', near(Math.atan2(fl[0].direction[0], fl[0].direction[2]), -30 * DEG, 1e-6) && near(Math.atan2(fl[2].direction[0], fl[2].direction[2]), 30 * DEG, 1e-6));
  const lt = build({ archetype: 'spot-track', params: { trackShape: 'L', heads: 4 }, dims: { w: 1, d: 0.6, h: 0.16 } });
  const zs = lt.userData.model.lights.map((l) => l.position[2]);
  check('L-form: hoder på begge beina', zs.some((z) => z > 0.1) && zs.some((z) => z < -0.1), zs.map((z) => z.toFixed(3)).join(','));
  const plate = build({ archetype: 'spot-track', params: { railKind: 'plate', heads: 3, aim: 'fan', spread: 90 }, dims: { w: 0.25, d: 0.25, h: 0.14 } });
  const pl = plate.userData.model.lights;
  const r = pl.map((l) => Math.hypot(l.position[0], l.position[2]));
  check('takplate: 3 hoder på en ring, hver heller 45° utover', pl.length === 3 && dirs(plate).size === 3 && pl.every((l) => near(l.direction[1], -Math.cos(45 * DEG), 1e-6) && l.position[0] * l.direction[0] + l.position[2] * l.direction[2] > 0) && Math.max(...r) - Math.min(...r) < 0.02);
  const pw = box(plate);
  check('takplate: innenfor ca. platens mål', pw.max.x - pw.min.x < 0.4, (pw.max.x - pw.min.x).toFixed(3));
  const ud = build({ archetype: 'spot-wall', params: { heads: 2, layout: 'updown' } });
  const ul = ud.userData.model.lights;
  check('veggspot opp og ned: ett lys ned, ett opp', ul.length === 2 && ul.some((l) => l.direction[1] < 0) && ul.some((l) => l.direction[1] > 0));
  const yw = build({ archetype: 'spot-wall', params: { aimYaw: 40, tilt: 90 } }).userData.model.lights[0];
  check('veggspot 90° og 40° sidelengs: vannrett ut, vridd mot +x', near(yw.direction[1], 0, 1e-6) && yw.direction[0] > 0.6 && yw.direction[2] > 0);
  const st = build({ archetype: 'spot-ceiling', params: { tilt: 90 } }).userData.model.lights[0];
  check('takspot 90°: vannrett mot forsiden', near(st.direction[1], 0, 1e-6) && near(st.direction[2], 1, 1e-6));
}

// ---------------------------------------------------------------------------------------------------------------
section('6. Rene hjelpere (grid.js) og lagring');
{
  const head = { w: 0.09, d: 0.09, h: 0.008 };
  const sp = G.gridSpec(head, { rows: 2, cols: 5, dx: 1.1, dz: 0.9 });
  const it = { archetype: 'downlight', dims: sp.dims, params: sp.params };
  const g = G.gridOf(it);
  check('gridOf ↔ gridExtent rundtur', near(g.head.w, 0.09, 1e-9) && near(g.head.d, 0.09, 1e-9) && g.count === 10 && JSON.stringify(G.gridExtent(g.head, g)) === JSON.stringify(sp.dims));
  check('ikke rutenett-arketype → 1', G.itemQuantity({ archetype: 'spot-track', params: { gridRows: 3, gridCols: 3 } }) === 1 && G.gridOf({ archetype: 'spot-wall', dims: { w: 1, d: 1, h: 1 } }).count === 1);
  check('gridCols 99 → 10', G.gridOf({ archetype: 'downlight', dims: { w: 9, d: 0.09, h: 0.008 }, params: { gridCols: 99 } }).cols === 10);
  check('itemQuantity = rader × kolonner', G.itemQuantity(it) === 10);
  // Placement.axes (Placement.js): ax = [cos t, −sin t], az = [sin t, cos t]
  const axes = (deg) => ({ ax: [Math.cos(deg * DEG), -Math.sin(deg * DEG)], az: [Math.sin(deg * DEG), Math.cos(deg * DEG)] });
  let ok = true;
  for (const deg of [0, 90, -30]) {
    const item = { ...it, position: [4, 2.5, 7], rotationDeg: deg };
    const { ax, az } = axes(deg);
    for (const c of G.gridCells(g)) {
      const [x, z] = G.cellWorld(item, c);
      ok &&= near(x, 4 + ax[0] * c.u + az[0] * c.v, 1e-9) && near(z, 7 + ax[1] * c.u + az[1] * c.v, 1e-9);
    }
  }
  check('cellWorld = Placement.axes ved 0 / 90 / −30°', ok);
  const d = new DesignState({ layout });
  const uid = d.add({ source: 'custom', name: 'Downlights', category: 'spotter', archetype: 'downlight', mount: 'ceiling', position: [4.2, 2.6, 8], dims: sp.dims, params: { ...sp.params, tiltable: true, tilt: 15 }, light: { on: true, dimmer: 0.4, colorK: 2700, lumens: 450 } });
  const d2 = new DesignState({ layout });
  d2.load(JSON.stringify(d.toJSON()));
  const back = d2.get(uid);
  check('et rutenett overlever lagre → laste (params, dims, lys)', !!back && JSON.stringify(back.params) === JSON.stringify(d.get(uid).params) && JSON.stringify(back.dims) === JSON.stringify(sp.dims) && back.light?.lumens === 450, JSON.stringify(back?.params));
}

// ---------------------------------------------------------------------------------------------------------------
section('7. Katalog og fakta');
{
  const list = cat.products('spotter');
  if (!list.length) check('spotter-produkter bygger', true, 'ingen produkter ennå');
  else {
    const bad = [];
    for (const p of list) {
      const n = p.variants?.length || 1;
      for (const vi of [0, n - 1]) {
        const spec = cat.productToItemSpec(p, vi);
        const g = reg.buildModel(spec);
        if (g.userData.model.fallback) bad.push(`${p.id}: reservemodell`);
        if (!(spec.light?.lumens > 0)) bad.push(`${p.id}: lumen`);
        if (reg.getArchetype(p.archetype)?.mount !== p.mount) bad.push(`${p.id}: montering ${p.mount}`);
        if (!g.userData.model.lights.length) bad.push(`${p.id}: ingen lys`);
      }
    }
    check(`alle ${list.length} spotter-produkter bygger med lys og riktig montering`, bad.length === 0, bad.slice(0, 8).join('; '));
  }
  const dl = { id: 'x', category: 'spotter', archetype: 'downlight', mount: 'ceiling', packSize: 3, light: { lumens: 450, bulb: 'Integrert LED' } };
  const rows = Object.fromEntries(spotFacts(dl, { shape: 'round', cutout: 0.075, recessDepth: 0.06, beamDeg: 40, tiltable: true, ip: 44, driver: 'integrated' }));
  check('fakta: innfelt downlight', rows.Montering?.startsWith('Innfelt') && rows.Hulltaking === 'Ø 75 mm' && rows.Innfellingsdybde === 'min. 6 cm' && rows.Spredning === '40°' && rows.Vippbar === 'Ja, ca. ±30°' && rows.Kapsling?.startsWith('IP44') && !!rows.Driver && rows.Selges?.startsWith('3-pakning'), JSON.stringify(rows));
  const sq = Object.fromEntries(spotFacts(dl, { shape: 'square', cutout: 0.083, recessDepth: 0.024 }));
  check('fakta: firkantet hulltaking og desimalkomma', sq.Hulltaking === '83 × 83 mm' && sq.Innfellingsdybde === 'min. 2,4 cm', JSON.stringify(sq));
  const tr = Object.fromEntries(spotFacts({ category: 'spotter', archetype: 'spot-track', light: { bulb: '3 × GU10 LED 345 lm (anbefalt, ikke inkludert)' } }, { heads: 3, railKind: 'plate', driver: 'socket' }));
  check('fakta: takplate med GU10-sokkel', tr.Montering === 'Rund takplate med 3 spotter' && tr.Lyskilde === 'GU10-sokkel – pære kjøpes separat', JSON.stringify(tr));
  check('fakta: ingenting for andre kategorier', spotFacts({ category: 'taklampe', archetype: 'pendant-dome' }, { beamDeg: 30 }).length === 0);
}

// ---------------------------------------------------------------------------------------------------------------
section('8. Finjustering (runde 3): reflektorer, firkantede, skinner, veggspot, bildelampe, tegnekall');
{
  const WHITE = { shade: '#f1f0ec', inner: '#e9e8e4', base: '#f1f0ec', metal: '#f1f0ec' };
  const PAINT = { shade: 'painted', inner: 'painted', base: 'painted', metal: 'painted' };
  const innerMesh = (g) => meshes(g).find((m) => (m.userData.parts || [m.userData.part]).includes('inner'));
  const lumOf = (m) => 0.2126 * m.color.r + 0.7152 * m.color.g + 0.0722 * m.color.b;
  const glowing = (g, m) => (g.userData.model.lights[0]?.emissiveMeshes || []).includes(m);
  // the deep reflector: the product's own inner colour, a white one glows a little, a metal one never
  const deepW = build({ archetype: 'downlight', params: { reflector: 'deep' }, colors: WHITE, materials: PAINT });
  const dm = innerMesh(deepW);
  check('dyp hvit reflektor: hvit (ikke svart ring) og gløder litt', !!dm && lumOf(dm.material) > 0.5 && glowing(deepW, dm) && dm.material.userData.baseIntensity < 0.45, dm && `${lumOf(dm.material).toFixed(2)} glow ${glowing(deepW, dm)}`);
  for (const refl of ['deep', 'smooth']) {
    const g = build({ archetype: 'downlight', params: { reflector: refl }, colors: { ...WHITE, inner: '#c4c6c8' }, materials: { ...PAINT, inner: 'chrome' } });
    const m = innerMesh(g);
    check(`${refl === 'deep' ? 'dyp' : 'glatt'} krom-reflektor: krom, gløder ikke (ingen bronsering)`, !!m && m.material.metalness >= 0.5 && !glowing(g, m) && m.material.userData.kind !== 'emissive');
  }
  const deepB = build({ archetype: 'downlight', params: { reflector: 'deep' }, colors: { ...WHITE, inner: '#2b2622' }, materials: { ...PAINT, inner: 'black-metal' } });
  check('dyp mørk reflektor beholder sin egen mørke farge', lumOf(innerMesh(deepB).material) < 0.05);
  // square trims round a round opening (default lensShape 'round')
  const radii = (m) => {
    const p = m.geometry.attributes.position;
    let lo = Infinity, hi = 0;
    for (let i = 0; i < p.count; i++) {
      const r = Math.hypot(p.getX(i), p.getZ(i));
      if (r > 1e-4) [lo, hi] = [Math.min(lo, r), Math.max(hi, r)];
    }
    return [lo, hi];
  };
  const trimOf = (g) => meshes(g).find((m) => m.userData.trim);
  const sq = build({ archetype: 'downlight', dims: { w: 0.09, d: 0.09, h: 0.006 }, params: { shape: 'square' } });
  const [, lensMax] = radii(lensMesh(sq));
  const [trimMin, trimMax] = radii(trimOf(sq));
  check('firkantet downlight: rund linse i firkantet kant', lensMax <= 0.7 * 0.045 + 1e-4 && near(trimMin, 0.7 * 0.045, 1e-4) && trimMax > 1.2 * 0.045, `linse ${lensMax.toFixed(4)} kant ${trimMin.toFixed(4)}–${trimMax.toFixed(4)}`);
  const sqL = build({ archetype: 'downlight', dims: { w: 0.09, d: 0.09, h: 0.006 }, params: { shape: 'square', lensShape: 'square' } });
  check('lensShape square: linsen blir firkantet', radii(lensMesh(sqL))[1] > 1.2 * radii(lensMesh(sq))[1]);
  const sqTilt = build({ archetype: 'downlight', dims: { w: 0.115, d: 0.115, h: 0.006 }, params: { shape: 'square', tiltable: true, tilt: 20 } });
  check('firkantet vippbar (GU10): rund kardangring – bare kanten er firkantet', radii(lensMesh(sqTilt))[1] < 0.7 * 0.0575 && meshes(sqTilt).filter((m) => !m.userData.trim).every((m) => radii(m)[1] <= 0.0575 * 0.7 * 1.2));
  const pl = build({ archetype: 'downlight', dims: { w: 0.13, d: 0.13, h: 0.005 }, params: { shape: 'square', trim: 'flush', aperture: 0.45 } });
  const plb = box(pl);
  check('kantløs firkantet (gips): et rundt hull i en flat gipsflate så bred som armaturen', near(radii(trimOf(pl))[0], 0.45 * 0.065, 1e-4) && radii(lensMesh(pl))[1] <= 0.45 * 0.065 && near(plb.max.x - plb.min.x, 0.13, 0.002) && plb.min.y >= -0.0016, `${radii(trimOf(pl)).map((x) => x.toFixed(4)).join('…')} bredde ${(plb.max.x - plb.min.x).toFixed(3)} y ${plb.min.y.toFixed(4)}`);
  // a surface downlight with a small ceiling cup (Valerie)
  const val = build({ archetype: 'downlight-surface', dims: { w: 0.185, d: 0.185, h: 0.2 }, params: { plateD: 0.09, plateH: 0.035, lensDepth: 0 }, colors: { ...WHITE, shade: '#eef0ed' }, materials: { ...PAINT, shade: 'glass-opal' } });
  const vb = box(val);
  const cupM = meshes(val).find((m) => m.userData.part === 'base' && !m.userData.parts);
  const cupR = cupM ? radii(cupM)[1] : Infinity;
  check('takkopp smalere enn sylinderen (plateD 0,09)', near(vb.max.x - vb.min.x, 0.185, 0.002) && cupR <= 0.045 + 1e-4 && vb.max.y <= EMBED + 0.002 && vb.min.y >= -0.2 - 0.001, `bredde ${(vb.max.x - vb.min.x).toFixed(3)} kopp r ${cupR.toFixed(4)} y ${vb.min.y.toFixed(3)}…${vb.max.y.toFixed(3)}`);
  // tracks: a round rod under a central canopy, rail section, stem length
  const lowY = (g) => Math.min(...g.userData.model.lights.map((l) => l.position[1]));
  /** Top of the rail away from the middle (|x| > 0.2): EMBED when it sits on the ceiling. */
  const railTop = (g) => {
    let y = -Infinity;
    for (const m of meshes(g)) {
      if (!(m.userData.parts || [m.userData.part]).includes('base')) continue;
      const p = m.geometry.attributes.position;
      for (let i = 0; i < p.count; i++) if (Math.abs(p.getX(i)) > 0.2) y = Math.max(y, p.getY(i));
    }
    return y;
  };
  const colors = { shade: '#1c1c1c', base: '#f1f0ec', metal: '#bfbfbf', inner: '#d8d5cf' };
  const materials = { shade: 'black-metal', base: 'painted', metal: 'steel', inner: 'chrome' };
  const hug = build({ archetype: 'spot-track', dims: { w: 0.75, d: 0.12, h: 0.2 }, params: { railKind: 'bar', barShape: 'round', canopyD: 0.12, canopyH: 0.035, heads: 4, tilt: 45 }, colors, materials });
  const hb = box(hug);
  check('Hugin-stang: takkopp Ø 12 cm, rund stang 3,5 cm under taket', near(railTop(hug), -0.035, 0.002) && hb.max.z - hb.min.z >= 0.12 - 1e-3 && hug.userData.model.lights.length === 4, `stang ${railTop(hug).toFixed(4)} dybde ${(hb.max.z - hb.min.z).toFixed(3)}`);
  const ny = build({ archetype: 'spot-track', dims: { w: 0.73, d: 0.07, h: 0.2 }, params: { railKind: 'bar', railW: 0.07, railH: 0.015, stemLen: 0, heads: 4, tilt: 20 }, colors, materials });
  const nyDef = build({ archetype: 'spot-track', dims: { w: 0.73, d: 0.07, h: 0.2 }, params: { railKind: 'bar', heads: 4, tilt: 20 }, colors, materials });
  const nb = box(ny);
  check('NYMÅNE-plate: 7 cm bred stang, hodene rett under (stemLen 0)', nb.max.z - nb.min.z >= 0.07 - 1e-3 && near(railTop(ny), EMBED, 0.001) && lowY(ny) > lowY(nyDef) + 0.05, `dybde ${(nb.max.z - nb.min.z).toFixed(3)} lys ${lowY(ny).toFixed(3)} vs ${lowY(nyDef).toFixed(3)}`);
  // wall spots follow dims unless the product states the sizes
  const ws = (dims, params = {}) => box(build({ archetype: 'spot-wall', dims, params }));
  const a = ws({ w: 0.08, d: 0.16, h: 0.12 }), b2 = ws({ w: 0.12, d: 0.26, h: 0.2 });
  check('veggspot uten egne mål følger dims (dybde og høyde ± 6 mm)', near(a.max.z, 0.16, 0.006) && near(a.max.y - a.min.y, 0.12, 0.006) && near(b2.max.z, 0.26, 0.006) && near(b2.max.y - b2.min.y, 0.2, 0.006) && b2.max.x - b2.min.x > a.max.x - a.min.x + 0.02, `${a.max.z.toFixed(3)}/${(a.max.y - a.min.y).toFixed(3)} · ${b2.max.z.toFixed(3)}/${(b2.max.y - b2.min.y).toFixed(3)}`);
  const own = { headD: 0.06, headL: 0.1, armLen: 0.05, plateD: 0.08 };
  const o1 = ws({ w: 0.08, d: 0.15, h: 0.14 }, own), o2 = ws({ w: 0.08, d: 0.3, h: 0.14 }, own);
  check('veggspot med produktets egne mål beholder dem', o1.max.z === o2.max.z);
  const two = ws({ w: 0.3, d: 0.13, h: 0.08 }, { heads: 2, tilt: 65 });
  check('to spotter uten egne mål: innenfor bredden', two.max.x - two.min.x <= 0.3 + 1e-6 && two.max.x - two.min.x > 0.25);
  // picture lights: the room spot is a wide cone out of the wall; one central plate with armGap
  const pic = build({ archetype: 'picture-light' }).userData.model.lights[0];
  const out = Math.atan2(pic.direction[2], -pic.direction[1]);
  check('bildelampe: vid kjegle (≥ 50°) ut av veggen, aksen 25–40° under vannrett, kanten langs veggen', pic.angle >= 50 * DEG && near(out, pic.angle, 1e-6) && out >= 50 * DEG && out <= 65 * DEG, `kjegle ${(pic.angle / DEG).toFixed(0)}° ut ${(out / DEG).toFixed(0)}°`);
  const PC = { colors: { shade: '#b08a4a', base: '#f1f0ec', metal: '#1c1c1c', inner: '#f4efe6' }, materials: { shade: 'brass', base: 'painted', metal: 'black-metal', inner: 'glass-opal' } };
  const plates = (g) => meshes(g).filter((m) => (m.userData.parts || [m.userData.part]).includes('base'));
  const gapG = build({ archetype: 'picture-light', dims: { w: 0.69, d: 0.15, h: 0.115 }, params: { armGap: 0.05, armShape: 'swan' }, ...PC });
  const gb = box(plates(gapG)[0]);
  check('armGap 5 cm: én veggplate 13 cm bred midt på', plates(gapG).length === 1 && near(gb.max.x - gb.min.x, 0.13, 0.002) && near(gb.max.x + gb.min.x, 0, 1e-6), `${(gb.max.x - gb.min.x).toFixed(3)}`);
  const noGap = box(plates(build({ archetype: 'picture-light', dims: { w: 0.69, d: 0.15, h: 0.115 }, params: { armShape: 'swan' }, ...PC }))[0]);
  check('uten armGap: to plater ved ±w/4 som før', noGap.max.x - noGap.min.x > 0.69 / 2);
  // draw calls (QA §5.2): one mesh per material – a fitting in one colour is shell + reflector + lens
  const draws = (g) => meshes(g).filter((m) => !m.userData.lightDecal).length;
  const mono = { colors: { shade: '#f2f2f0', base: '#f2f2f0', metal: '#f2f2f0', inner: '#d8d8d4' }, materials: { shade: 'painted', base: 'painted', metal: 'painted', inner: 'chrome' } };
  const dc = Object.fromEntries(IDS.map((id) => [id, draws(build({ archetype: id, ...mono }))]));
  check('ensfarget armatur: ≤ 3 tegnekall (skall, reflektor, linse; 3-faseskinnen + sporet)', Object.entries(dc).every(([id, n]) => n <= (id === 'spot-track' ? 4 : 3)), JSON.stringify(dc));
  const mixed = build({ archetype: 'spot-ceiling', ...mono, colors: { ...mono.colors, metal: '#bfbfbf' }, materials: { ...mono.materials, metal: 'steel' } });
  const mp = mixed.userData.model.parts;
  check('sammenslått mesh står under hver del i model.parts', ['shade', 'base', 'metal', 'inner'].every((p) => mp[p]?.length === 1) && mp.shade[0] === mp.base[0] && mp.metal[0] !== mp.base[0]);
}

console.log(`\n(${Date.now() - t0} ms)`);
done();
