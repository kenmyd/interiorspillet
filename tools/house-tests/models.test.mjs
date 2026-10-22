#!/usr/bin/env node
/**
 * Everything builds, sizes are honest (design/furniture.md §7 merged with design/qa.md §3.3; MASTER §2.2–§2.5, D29,
 * D38, D39, D42). Node only, no renderer; builders are called directly (`def.build(mergeSpec(def, spec))`, so the
 * registry's warn-once cannot hide a repeat failure):
 *   1 «Register og skjema»        every archetypes.json id (not shading) has a builder; mount, parts, declared params,
 *                                 defaults and dimsRange agree with the schema; the round's contract (§2.3/§2.4)
 *   2 «Alle arketyper bygger»     the default spec of every archetype: no throw, no grey box, finite geometry, the
 *                                 mount's origin convention, parts, seatY/surfaces/lights, triangle budget; spot
 *                                 fittings: §2.5 light entries and «Geometry checks» G1/G3 in model space
 *   3 «Alle valg bygger»          every declared enum option, bool and number min/max (low quality): on its own for the
 *                                 round's new/extended archetypes, packed into a few combined specs for the older ones
 *                                 (a failing combination is rebuilt option by option); default values come from section 2
 *   4 «Ytterpunkter»              all-min and all-max dims (dimsRange)
 *   5 «Alle produkter bygger»     every catalogue product (default variant; new products also the last variant):
 *                                 no grey box, bbox vs dims (a wall lamp's plug cord excluded), seat height, lights,
 *                                 declared numbers in range, the family contracts (seatY/surfaces), triangle budgets
 *   6 «Samme resultat to ganger»  5 specs per new archetype built twice (no Math.random)
 *   7 «Omfarging»                 model.recolor(part, hex, kind) of the new archetypes
 *
 * Builds that need a canvas or the DOM (art, rugs, plants … in Node) are skipped and counted, never failed.
 * QA_PARTIAL=1 softens only what the round has not delivered yet: a NEW archetype without a builder (and its
 * products), a contract option a builder does not declare yet. Everything else is strict.
 *
 *   node tools/house-tests/models.test.mjs [--arch=a,b] [--verbose]
 */
const L = await import(new URL(import.meta.dirname.endsWith('wip') ? '../_lib.mjs' : './_lib.mjs', import.meta.url));
const { ROOT, imp, check, done } = L;
/** section() that also records how long the previous section took (printed in «Rapport»; MASTER risk 15: ≤ 8 s). */
const TIMES = [];
let secT = 0, secName = null;
const section = (name) => {
  const t = performance.now();
  if (secName) TIMES.push([secName.split(' ')[0], (t - secT) / 1000]);
  else TIMES.t0 = (t - T0) / 1000;
  secName = name;
  secT = t;
  L.section(name);
};
const Q = await import(new URL(import.meta.dirname.endsWith('wip') ? '../_qa.mjs' : './_qa.mjs', import.meta.url));
import path from 'node:path';
import { pathToFileURL } from 'node:url';

Q.cssHook();
const T0 = performance.now();
const args = process.argv.slice(2);
const VERBOSE = args.includes('--verbose');
const ONLY = (args.find((a) => a.startsWith('--arch=')) || '').slice(7).split(',').filter(Boolean);
const THREE = await Q.three();
(await imp('src/home/materials.js')).configureMaterials({ textureRes: 0.125 });
const reg = await imp('src/models/registry.js');
const cat = await imp('src/catalog/index.js');
const RR = await import(pathToFileURL(path.join(ROOT, 'tools', 'lib', 'research-rules.mjs')).href);
const GRID = await imp('src/design/grid.js');
const schema = Q.SCHEMA;

const CANVAS = /document is not defined|window is not defined|OffscreenCanvas|getContext|createElement|Image is not defined/i;
/** Archetypes that need a canvas in Node for their default build (qa §3.3 A) – any other canvas need is a regression. */
const BROWSER_ONLY = new Set(['rug', 'cushion', 'throw', 'acoustic-art', 'plant-floor', 'plant-small', 'art-frame', 'art-set', 'speaker']);
const SPOTS = new Set(RR.SPOT_ARCHETYPES);
/** furniture.md §7 BUDGET (medium triangles); everything else 30 000. */
const BUDGET = { 'coffee-table': 7000, desk: 8000, chair: 4000, 'shell-chair': 6000, stool: 3000, 'office-chair': 10000, 'bar-stool': 9000, bench: 4000, pouf: 6000,
  'table-shade': 4000, 'table-task': 4000, 'wall-arm': 3500, 'wall-sconce': 3500, 'wall-shelf': 2000, downlight: 3000, 'downlight-surface': 3000, 'spot-ceiling': 3000,
  'spot-track': 12000, 'spot-wall': 6000, 'picture-light': 6000 };
/** Max model lights per archetype (furniture.md §7: 2 for furniture lamps; spot fittings one per head). */
const LIGHTS_MAX = { 'spot-track': 8, 'spot-wall': 2, downlight: 48, 'downlight-surface': 48, 'spot-ceiling': 48 };
/** EMBED (lamps.js) + 2 mm: how far a ceiling/wall fitting may reach into the ceiling/wall (MASTER §2.5 G1, D42). */
const EMBED_TOL = 0.012 + 0.002;
const NEW = new Set(Q.NEW_ARCHETYPES);
/** §2.4 lists these new values in the «hidden» column: the builder accepts them without declaring them. */
const HIDDEN_VALUES = { 'floor-arc': ['shadeShape'], 'floor-reading': ['headShape'] };
const EXT = new Set(Object.keys(RR.EXTENSIONS));
const BASE_IDS = new Set(Object.values(Q.BASE.products).flat());
const want = (id) => !ONLY.length || ONLY.includes(id);
const fmt = (v) => (typeof v === 'number' ? +v.toFixed(3) : v);
const SHOWN = process.env.QA_SHOW ? 999 : 0;
const show = (list, n = 6) => {
  const k = Math.max(n, SHOWN);
  return list.length ? `${list.slice(0, k).join(' | ')}${list.length > k ? ` | … (${list.length})` : ''}` : '';
};
const hidden = (o) => {
  for (let p = o; p; p = p.parent) if (p.visible === false) return true;
  return false;
};

/** Builds through the Def; { g } | { canvas } | { err } | { missing }. */
function build(id, spec = {}) {
  const def = reg.getArchetype(id);
  if (!def) return { missing: true };
  const warns = [];
  const ow = console.warn;
  console.warn = (...a) => warns.push(a.map((x) => (x instanceof Error ? x.message : String(x))).join(' '));
  const t = performance.now();
  try {
    const g = def.build(reg.mergeSpec(def, { ...spec, archetype: id }));
    if (!g?.isObject3D) throw new Error('byggeren returnerte ikke et Object3D');
    return { g, def, warns, ms: performance.now() - t };
  } catch (e) {
    const msg = String(e?.message ?? e);
    if (CANVAS.test(`${msg}\n${e?.stack ?? ''}`)) return { canvas: true, def };
    return { err: msg.split('\n')[0].slice(0, 160), def };
  } finally {
    console.warn = ow;
  }
}

/**
 * bbox (without light decals / ceiling pools / hidden helpers), triangles, meshes, NaN check. skipCord: a wall lamp's
 * visible plug cord (params.plug, part 'cord' 45 cm down the wall) counts for triangles but not for the bbox – dims.h is
 * the lamp (check-research measures the same way).
 */
function measure(g, { skipCord = false } = {}) {
  g.updateMatrixWorld(true);
  const box = new THREE.Box3();
  const part = new THREE.Box3();
  let tris = 0, meshes = 0, nan = false;
  g.traverse((o) => {
    if (!o.isMesh || !o.geometry) return;
    if (o.userData?.lightDecal || o.name === 'ceiling-pool' || o.parent?.userData?.lightDecal || hidden(o)) return;
    meshes++;
    const geo = o.geometry;
    tris += (geo.index ? geo.index.count : geo.attributes.position?.count ?? 0) / 3;
    const pos = geo.attributes.position?.array;
    if (pos) for (let i = 0; i < pos.length; i += 7) if (!Number.isFinite(pos[i])) nan = true;
    if (!geo.boundingBox) geo.computeBoundingBox();
    if (skipCord && o.userData?.part === 'cord') return;
    if (geo.boundingBox && !geo.boundingBox.isEmpty()) box.union(part.copy(geo.boundingBox).applyMatrix4(o.matrixWorld));
  });
  const size = box.isEmpty() ? new THREE.Vector3() : box.getSize(new THREE.Vector3());
  const center = box.isEmpty() ? new THREE.Vector3() : box.getCenter(new THREE.Vector3());
  return { box, size: { w: size.x, d: size.z, h: size.y }, center, tris: Math.round(tris), meshes, nan, empty: box.isEmpty() };
}

const dispose = (g) => g?.traverse((o) => {
  if (o.geometry && !o.geometry.userData?.shared) o.geometry.dispose();
});

/** Light entries of a model, checked against §2.5 (and qa §3.3 B): [problem strings]. */
function lightProblems(id, g) {
  const out = [];
  const lights = g.userData.model?.lights || [];
  lights.forEach((l, i) => {
    const tag = `lys ${i}`;
    if (!['spot', 'point'].includes(l.type)) out.push(`${tag}: type ${l.type}`);
    if (!(l.position?.length === 3 && l.position.every(Number.isFinite))) out.push(`${tag}: posisjon ${JSON.stringify(l.position)}`);
    if (!(l.lumens > 0)) out.push(`${tag}: lumens ${l.lumens}`);
    if (l.type === 'spot') {
      const n = Math.hypot(...(l.direction || [NaN]));
      if (!(Math.abs(n - 1) <= 1e-6)) out.push(`${tag}: |retning| ${fmt(n)}`);
      if (!(l.angle >= 0.15 && l.angle <= 1.45)) out.push(`${tag}: vinkel ${fmt(l.angle)}`);
    }
    for (const m of l.emissiveMeshes || []) {
      if (!m?.isMesh) out.push(`${tag}: emissiveMeshes har et ikke-Mesh`);
      else if ((Array.isArray(m.material) ? m.material : [m.material]).some((x) => x?.userData?.cached)) out.push(`${tag}: glødende mesh med delt (cached) materiale`);
      else if (SPOTS.has(id) && l.type === 'point' && (Array.isArray(m.material) ? m.material : [m.material]).some((x) => x?.blending === THREE.CustomBlending)) out.push(`${tag}: punktlys med CustomBlending-mesh`);
    }
    if (SPOTS.has(id)) {
      if (l.type !== 'spot') out.push(`${tag}: spotter skal bare ha spotlys (har ${l.type})`);
      const cluster = { downlight: 'downlight', 'downlight-surface': 'downlight', 'spot-ceiling': 'downlight', 'spot-track': 'fixture', 'spot-wall': 'fixture', 'picture-light': undefined }[id];
      if (l.cluster !== cluster) out.push(`${tag}: cluster ${l.cluster} (kontrakt: ${cluster})`);
      if (!l.fitting) out.push(`${tag}: mangler fitting`);
    }
  });
  return out;
}

/** §2.5 «Geometry checks» in model space for the spot fittings: [problem strings]. */
function spotGeometry(id, g, m) {
  const out = [];
  const mount = schema.archetypes[id]?.mount;
  if (mount === 'ceiling') {
    if (m.box.max.y > EMBED_TOL + 1e-9) out.push(`G1: høyeste punkt ${fmt(m.box.max.y)} over taket (maks ${EMBED_TOL})`);
    for (const l of g.userData.model?.lights || []) {
      const y = l.position?.[1];
      if (!(y <= -0.004 + 1e-9)) out.push(`G3: lyset ${fmt(y)} m – minst 4 mm under taket`);
      if (l.fitting === 'recessed' && !(y >= -0.012 - 1e-9)) out.push(`G3: innfelt lys ${fmt(y)} m – maks 12 mm under taket`);
    }
  } else if (mount === 'wall' && m.box.min.z < -EMBED_TOL - 1e-9) out.push(`vegg: ${fmt(m.box.min.z)} m inn i veggen (maks ${EMBED_TOL})`);
  let noShadow = true, trims = 0;
  g.traverse((o) => {
    if (o.isMesh && !o.userData?.noShadow) noShadow = false;
    if (o.isMesh && o.userData?.trim) trims++;
  });
  if (!noShadow) out.push('et mesh uten userData.noShadow');
  if (id === 'downlight' && !trims) out.push('ingen kant med userData.trim');
  const tv = g.userData.model?.thumbView;
  const wantTv = id === 'downlight' || id === 'downlight-surface' ? 'below' : 'under';
  if (tv !== wantTv) out.push(`thumbView ${tv} (kontrakt: ${wantTv})`);
  return out;
}

/** The mount's origin convention (furniture.md §7.2, MASTER D42): [problem strings]. */
/** Origin habits measured identical at c28070d (not this round's): the recliner's footrest, the towel rail hangs under its bracket. */
const ORIGIN_KNOWN = { recliner: 'z', 'towel-rail': 'y' };
function mountProblems(id, mount, m, dims) {
  const out = [];
  if (mount === 'floor' || mount === 'surface') {
    if (Math.abs(m.box.min.y) > 0.02) out.push(`underkant y ${fmt(m.box.min.y)} (skal være 0 ± 0,02)`);
    if (ORIGIN_KNOWN[id] !== 'z' && (Math.abs(m.center.x) > Math.max(0.08, dims.w * 0.25) || Math.abs(m.center.z) > Math.max(0.08, dims.d * 0.25))) out.push(`midten (${fmt(m.center.x)}, ${fmt(m.center.z)}) langt fra origo`);
  } else if (mount === 'wall') {
    if (m.box.min.z < -(SPOTS.has(id) ? EMBED_TOL : 0.02)) out.push(`bakkant z ${fmt(m.box.min.z)} (skal være ≥ −0,02)`);
    if (ORIGIN_KNOWN[id] !== 'y' && Math.abs(m.center.y) > Math.max(0.02, 0.1 * dims.h) + 0.02) out.push(`midten y ${fmt(m.center.y)} (skal være ≈ 0)`);
  } else if (mount === 'ceiling') {
    if (m.box.max.y > (SPOTS.has(id) ? EMBED_TOL : 0.02) + 1e-9) out.push(`toppen y ${fmt(m.box.max.y)} (skal henge fra origo)`);
  }
  return out;
}

const families = schema.families;
const ids = Object.keys(schema.archetypes).filter((id) => schema.archetypes[id].family !== 'shading' && want(id));
const stats = new Map(); // id → { min, max, ms, n }
const stat = (id, tris, ms) => {
  const s = stats.get(id) || { min: Infinity, max: 0, ms: 0, n: 0 };
  s.min = Math.min(s.min, tris);
  s.max = Math.max(s.max, tris);
  s.ms += ms || 0;
  s.n++;
  stats.set(id, s);
};
let canvasSkips = 0;

// ---------------------------------------------------------------------------------------------------------------
section('1 Register og skjema');
{
  const noDef = [], noDefNew = [], mountBad = [], partsBad = [], paramBad = [], defaultsBad = [], rangeBad = [], stubs = [], contractMissing = [];
  for (const id of ids) {
    const info = schema.archetypes[id];
    const def = reg.getArchetype(id);
    if (!def) {
      (NEW.has(id) ? noDefNew : noDef).push(id);
      continue;
    }
    if (def.stub) stubs.push(id);
    if (def.mount && def.mount !== info.mount) mountBad.push(`${id}: ${def.mount} ≠ ${info.mount}`);
    const need = info.parts || families[info.family]?.parts || [];
    const missing = need.filter((p) => !(def.parts || []).includes(p));
    if (missing.length) partsBad.push(`${id}: mangler ${missing.join(',')}`);
    for (const [k, s] of Object.entries(def.params || {})) {
      if (s.type === 'enum') {
        const opts = s.options || [];
        if (opts.length < 2) paramBad.push(`${id}.${k}: < 2 valg`);
        if (opts.some((o) => !Array.isArray(o) || typeof o[1] !== 'string' || !o[1])) paramBad.push(`${id}.${k}: valg uten norsk etikett`);
      } else if (s.type === 'number') {
        if (!(s.min < s.max) || !(s.step > 0)) paramBad.push(`${id}.${k}: min ${s.min} max ${s.max} step ${s.step}`);
      }
      const dv = def.defaults?.params?.[k];
      if (dv === undefined) continue;
      if (s.type === 'enum' && !(s.options || []).some((o) => (Array.isArray(o) ? o[0] : o) === dv)) defaultsBad.push(`${id}.${k} = ${dv}`);
      if (s.type === 'number' && typeof dv === 'number' && (dv < s.min - 1e-9 || dv > s.max + 1e-9)) defaultsBad.push(`${id}.${k} = ${dv} (${s.min}–${s.max})`);
    }
    const dr = def.dimsRange || info.dimsRange;
    const dd = def.defaults?.dims;
    if (dr) {
      for (const k of ['w', 'd', 'h']) {
        const r = dr[k];
        if (!r) continue;
        if (!(r[0] < r[1])) rangeBad.push(`${id}.${k}: [${r}]`);
        else if (dd?.[k] != null && (dd[k] < r[0] - 1e-9 || dd[k] > r[1] + 1e-9)) rangeBad.push(`${id}: standard ${k} ${dd[k]} utenfor [${r}]`);
        if (NEW.has(id) && r[0] < 0.005 - 1e-12) rangeBad.push(`${id}.${k}: minimum ${r[0]} < 0,005 (D38)`);
      }
    }
    // the round's contract (§2.3 new, §2.4 extended): every contract option is declared by the builder
    const C = NEW.has(id) ? RR.CONTRACT[id]?.declared : EXT.has(id) ? { ...(RR.EXTENSIONS[id].declared || {}), ...Object.fromEntries(Object.entries(RR.EXTENSIONS[id].add || {}).map(([k, o]) => [k, { t: 'enum', o }])) } : null;
    for (const [k, c] of Object.entries(C || {})) {
      if (['frame', 'layout'].includes(c.t)) continue; // FRAME/LAYOUT options are checked by art.test
      if (HIDDEN_VALUES[id]?.includes(k)) continue;
      const s = def.params?.[k];
      if (!s) {
        contractMissing.push(`${id}.${k}`);
        continue;
      }
      if (c.t === 'enum') {
        const have = new Set((s.options || []).map((o) => (Array.isArray(o) ? o[0] : o)));
        const miss = c.o.filter((v) => !have.has(v) && !(k === 'armStyle' && v === 'auto'));
        if (miss.length) contractMissing.push(`${id}.${k}: ${miss.join(',')}`);
      }
    }
  }
  check('hver arketype (utenom solskjerming) fra før runden har en bygger', !noDef.length, noDef.join(', '));
  if (noDefNew.length) Q.soft('nye arketyper har bygger', false, `ingen bygger ennå: ${noDefNew.join(', ')}`);
  else check('nye arketyper har bygger', true);
  check('alle byggere er i archetypes.json', Object.keys(reg.ARCHETYPES).every((id) => schema.archetypes[id]), Object.keys(reg.ARCHETYPES).filter((id) => !schema.archetypes[id]).join(', '));
  check('montering som i skjemaet', !mountBad.length, show(mountBad));
  check('deler ⊇ skjemaets deler', !partsBad.length, show(partsBad));
  check('deklarerte valg: ≥ 2 med norsk etikett, tall med min < maks og steg', !paramBad.length, show(paramBad));
  check('standardverdier ligger i sine valg/områder', !defaultsBad.length, show(defaultsBad));
  check('dimsRange: min < maks, standardmål innenfor, nye arketyper ≥ 0,005 m (D38)', !rangeBad.length, show(rangeBad));
  Q.soft('ingen stub-byggere', !stubs.length, stubs.join(', '));
  Q.soft('rundens kontrakt (§2.3/§2.4): alle valg er deklarert', !contractMissing.length, show(contractMissing, 10));
}

// ---------------------------------------------------------------------------------------------------------------
section('2 Alle arketyper bygger (standardspesifikasjon, kvalitet middels)');
const DEFAULT = new Map(); // id → { m, model }
{
  const fails = [], canvasBad = [], geo = [], mountBad = [], partBad = [], seat = [], surf = [], lightBad = [], budget = [], spotBad = [];
  for (const id of ids) {
    const info = schema.archetypes[id];
    const r = build(id, { quality: 'medium' });
    if (r.missing) continue; // section 1
    if (r.canvas) {
      canvasSkips++;
      if (!BROWSER_ONLY.has(id)) canvasBad.push(id);
      continue;
    }
    if (r.err) {
      fails.push(`${id}: ${r.err}`);
      continue;
    }
    const g = r.g;
    const model = g.userData.model || {};
    if (model.fallback) {
      fails.push(`${id}: grå boks`);
      continue;
    }
    const m = measure(g);
    stat(id, m.tris, r.ms);
    DEFAULT.set(id, { m, model, dims: r.def.defaults?.dims || { w: 0.5, d: 0.5, h: 0.5 } });
    if (m.nan || m.empty) geo.push(`${id}: ${m.nan ? 'NaN i posisjoner' : 'tom geometri'}`);
    const dims = reg.mergeSpec(r.def, { archetype: id }).dims;
    for (const p of mountProblems(id, info.mount, m, dims)) mountBad.push(`${id}: ${p}`);
    const fam = families[info.family] || {};
    const allowed = new Set([...(r.def.parts || []), ...(fam.optionalParts || [])]);
    const got = Object.keys(model.parts || {});
    if (!got.some((p) => (r.def.parts || []).includes(p))) partBad.push(`${id}: ingen kjente deler (${got.join(',') || '–'})`);
    const extra = got.filter((p) => !allowed.has(p));
    if (extra.length) partBad.push(`${id}: ukjente deler ${extra.join(',')}`);
    if (info.family === 'seating' && info.mount === 'floor' && !(model.seatY >= 0.2 && model.seatY <= 0.95)) seat.push(`${id}: seatY ${fmt(model.seatY)}`);
    if (info.family === 'table' && id !== 'wall-shelf' && !(model.surfaces?.length >= 1)) surf.push(id);
    if (info.family === 'lamp') {
      const n = model.lights?.length ?? 0;
      if (!(n >= 1 && n <= (LIGHTS_MAX[id] ?? 2))) lightBad.push(`${id}: ${n} lys`);
      for (const p of lightProblems(id, g)) lightBad.push(`${id}: ${p}`);
    }
    if (m.tris > (BUDGET[id] ?? 30000)) budget.push(`${id}: ${m.tris} trekanter (maks ${BUDGET[id] ?? 30000})`);
    if (SPOTS.has(id)) {
      for (const p of spotGeometry(id, g, m)) spotBad.push(`${id}: ${p}`);
      if ((id === 'downlight' || id === 'downlight-surface') && m.meshes > 4) spotBad.push(`${id}: ${m.meshes} mesh for én downlight (maks 4)`);
    }
    dispose(g);
  }
  check('ingen byggefeil eller grå boks', !fails.length, show(fails));
  check(`bare ${[...BROWSER_ONLY].join('/')} trenger canvas i Node`, !canvasBad.length, canvasBad.join(', '));
  check('endelig geometri uten NaN', !geo.length, show(geo));
  check('origo etter monteringen (gulv: underkant 0, vegg: bak z ≥ 0 og midt y 0, tak: henger fra 0)', !mountBad.length, show(mountBad, 8));
  check('deler: minst én kjent, ingen ukjente', !partBad.length, show(partBad));
  check('sittemøbler på gulvet: seatY 0,2–0,95', !seat.length, show(seat));
  check('bord har en flate (surfaces)', !surf.length, surf.join(', '));
  check('lamper: 1–2 lys (spotter ett per hode), gyldige lysdata (MASTER §2.5)', !lightBad.length, show(lightBad, 8));
  check('trekantbudsjett (middels)', !budget.length, show(budget));
  check('spotter: tak G1/G3, vegg, noShadow, trim, thumbView, downlight ≤ 4 mesh (MASTER §2.5, qa §3.3 E)', !spotBad.length, show(spotBad, 8));
}

// ---------------------------------------------------------------------------------------------------------------
section('3 Alle valg bygger (kvalitet lav: rundens nye/utvidede arketyper hvert valg alene, eldre samlet)');
{
  // MASTER risk 15 (models ≤ 8 s): the round's new and extended archetypes build every option alone; the pre-round
  // archetypes pack their options into a few combined specs (spec i takes every param's i-th value), and a failing
  // combination is rebuilt option by option so the report still names the option (or the combination) that fails.
  // The default value of a param is the default spec, which section 2 already built (medium).
  const ALONE = new Set([...NEW, ...EXT]);
  const fails = [];
  let builds = 0, options = 0, skips = 0, asDefault = 0;
  /** null = ok · 'canvas' · problem string */
  const tryBuild = (id, params) => {
    const r = build(id, { quality: 'low', params });
    if (r.canvas) return 'canvas';
    builds++;
    if (r.err) return r.err;
    let bad = null;
    if (r.g.userData.model?.fallback) bad = 'grå boks';
    else {
      const m = measure(r.g);
      if (m.nan || m.empty) bad = m.nan ? 'NaN' : 'tom geometri';
    }
    dispose(r.g);
    return bad;
  };
  const label = (params) => Object.entries(params).map(([k, v]) => `${k}=${v}`).join(' ');
  for (const id of ids) {
    const def = reg.getArchetype(id);
    if (!def) continue;
    const lists = [];
    for (const [k, s] of Object.entries(def.params || {})) {
      const all = s.type === 'enum' ? (s.options || []).map((o) => (Array.isArray(o) ? o[0] : o))
        : s.type === 'bool' ? [true, false]
          : s.type === 'number' ? [s.min, s.max].filter(Number.isFinite) : [];
      const values = all.filter((v) => !(v === def.defaults?.params?.[k] && DEFAULT.has(id)));
      asDefault += all.length - values.length;
      options += values.length;
      if (values.length) lists.push([k, values]);
    }
    const alone = (k, v) => {
      const bad = tryBuild(id, { [k]: v });
      if (bad === 'canvas') skips++;
      else if (bad) fails.push(`${id} ${k}=${v}: ${bad}`);
      return bad && bad !== 'canvas';
    };
    if (ALONE.has(id)) {
      for (const [k, values] of lists) for (const v of values) alone(k, v);
      continue;
    }
    const n = Math.max(0, ...lists.map(([, v]) => v.length));
    for (let i = 0; i < n; i++) {
      const params = Object.fromEntries(lists.filter(([, v]) => i < v.length).map(([k, v]) => [k, v[i]]));
      const bad = tryBuild(id, params);
      if (bad === 'canvas') {
        skips += Object.keys(params).length;
        continue;
      }
      if (!bad) continue;
      // attribute the failure: each option of the combination alone, else the combination itself is the bug
      let named = false;
      for (const [k, v] of Object.entries(params)) named = alone(k, v) || named;
      if (!named) fails.push(`${id} kombinasjonen ${label(params)}: ${bad} (hvert valg alene bygger)`);
    }
  }
  canvasSkips += skips;
  check(`alle ${options} valg bygger uten feil eller grå boks (${builds} bygg; ${skips} trenger canvas, ${asDefault} er standardvalget fra del 2)`, !fails.length, show(fails, 8));
}

// ---------------------------------------------------------------------------------------------------------------
section('4 Ytterpunkter (dimsRange min og maks)');
{
  const fails = [], ratio = [];
  for (const id of ids) {
    const def = reg.getArchetype(id);
    const dr = def?.dimsRange || schema.archetypes[id]?.dimsRange;
    if (!def || !dr) continue;
    for (const end of [0, 1]) {
      const dims = { ...reg.mergeSpec(def, { archetype: id }).dims };
      // gridable fittings: dims are the grid's extent; ONE fitting's range is GRID_HEAD_RANGE (§2.3)
      const range = GRID.GRID_HEAD_RANGE?.[id] || dr;
      for (const k of ['w', 'd', 'h']) if (range[k]) dims[k] = range[k][end];
      const r = build(id, { quality: 'low', dims });
      if (r.canvas) {
        canvasSkips++;
        continue;
      }
      if (r.err || r.g.userData.model?.fallback) {
        fails.push(`${id} ${end ? 'maks' : 'min'}: ${r.err || 'grå boks'}`);
        continue;
      }
      // the size check binds the round's new and extended archetypes (older ones have their own measured habits)
      // (spot fittings: their sizes follow params and §2.3's dims conventions – spots-models.test and section 5 judge them)
      if ((NEW.has(id) && !SPOTS.has(id)) || RR.EXTENSIONS[id]?.dims) {
        const m = measure(r.g);
        const axes = schema.archetypes[id].mount === 'ceiling' ? ['w', 'd'] : ['w', 'd', 'h'];
        for (const k of axes) {
          if (id === 'spot-track' && k !== 'w') continue; // d = head Ø, h = drop (§2.3)
          const q = m.size[k] / dims[k];
          if (!(q >= 0.5 && q <= 1.8)) ratio.push(`${id} ${end ? 'maks' : 'min'} ${k}: ${fmt(m.size[k])} / ${fmt(dims[k])}`);
        }
      }
      dispose(r.g);
    }
  }
  check('bygger i begge ender av dimsRange', !fails.length, show(fails));
  check('nye møbelarketyper (og nye dimsRange): modellen følger målene (0,5–1,8 ×) i begge ender', !ratio.length, show(ratio, 8));
}

// ---------------------------------------------------------------------------------------------------------------
section('5 Alle produkter bygger');
{
  const isNewProduct = (p) => !BASE_IDS.has(p.id);
  /** Baseline products measured outside 0.6–1.9 × at c28070d already (unchanged; mirrors lean or are flat: any d). */
  const KNOWN_SIZE = { 'ikea-skogsviken-handklestang-60': 'h', 'lampemesteren-lucande-stakato-6-led-pendellampe-l120-black': 'd' };
  /** bbox/dims band per axis: new products [0.85, 1.15] with the furniture.md §7 / qa §3.3 C exceptions. */
  const band = (p, k) => {
    if (!isNewProduct(p)) return KNOWN_SIZE[p.id] === k || ((p.archetype === 'mirror' || p.archetype === 'mirror-floor') && k === 'd') ? [0, Infinity] : [0.6, 1.9];
    const P = p.params || {};
    let [lo, hi] = [0.85, 1.15];
    if (/fotskammel|fothviler/.test(p.id) && k === 'd') hi = 1.8;
    if ((p.archetype === 'recliner' || p.archetype === 'wingback') && P.footstool && k === 'd') hi = 1.8;
    if (p.archetype === 'bed' && k === 'h') hi = 1.45;
    if (p.archetype === 'bedside-table' && P.gallery && k === 'h') hi = 1.2;
    if ((/settbord|sofabordsett|nesting/.test(p.id) || p.archetype === 'coffee-table-round-nesting') && k !== 'h') hi = 1.5;
    if (p.archetype === 'coffee-table' && Array.isArray(P.set) && k !== 'h') hi = 2.0;
    if (p.archetype === 'chair' && P.arms && k === 'w') hi = 1.2;
    // integration (P07): the padded back «pad» is ~9 cm wider than the seat (KRYLBO, Zed)
    if (p.archetype === 'chair' && P.back === 'pad' && k === 'w') hi = 1.25;
    // integration (P06): a desk's hutch stands on the top, so its bbox reaches h + hutchH
    if (p.archetype === 'desk' && P.hutch && P.hutch !== 'none' && k === 'h') hi = 1.15 + Math.min(Math.max(Number(P.hutchH ?? 0.3), 0.1), 0.6) / p.dims.h;
    // integration (P02/RF): a trimless plaster downlight shows only its opening; dims are the plaster body in the ceiling
    if (p.archetype === 'downlight' && P.trim === 'flush' && k !== 'h') lo = 0.6;
    if (p.archetype === 'wall-sconce' && k === 'd') hi = 1.3;
    if (['floor-tripod', 'floor-reading', 'floor-pole-shade'].includes(p.archetype) && k !== 'h') lo = 0.78;
    if (p.archetype === 'table-task' && k === 'd') lo = 0.75;
    if (p.archetype === 'spot-track') [lo, hi] = k === 'w' ? [0.9, 1.1] : [0, Infinity];
    return [lo, hi];
  };
  const fails = [], soft = [], sizeBad = [], seatBad = [], lightBad = [], rangeBad = [], rangeWarn = [], famBad = [], budget = [];
  const famBase = new Map(); // archetype → { seat, surf } seen on baseline products
  const famNew = [];
  let built = 0, skipped = 0, newCount = 0;
  for (const p of cat.allProducts()) {
    if (!want(p.archetype) || p.mount === 'window' || p.category === 'solskjerming' || schema.archetypes[p.archetype]?.family === 'shading') continue;
    const fresh = isNewProduct(p);
    if (fresh) newCount++;
    const def = reg.getArchetype(p.archetype);
    if (!def) {
      if (NEW.has(p.archetype)) soft.push(`${p.id} (${p.archetype})`);
      else fails.push(`${p.id}: ingen bygger for ${p.archetype}`);
      continue;
    }
    const vis = [...new Set([p.defaultVariant ?? 0, ...(fresh ? [p.variants.length - 1] : [])])];
    for (const vi of vis) {
      const spec = cat.productToItemSpec(p, vi);
      // only a new product's default variant is measured (medium); its last variant just has to build (low)
      const r = build(p.archetype, { ...spec, quality: fresh && vi === (p.defaultVariant ?? 0) ? 'medium' : 'low' });
      if (r.canvas) {
        skipped++;
        continue;
      }
      built++;
      if (r.err || r.g.userData.model?.fallback) {
        fails.push(`${p.id} v${vi}: ${r.err || 'grå boks'}`);
        continue;
      }
      const g = r.g;
      const model = g.userData.model || {};
      if (vi !== (p.defaultVariant ?? 0)) {
        dispose(g);
        continue;
      }
      const m = measure(g, { skipCord: p.mount === 'wall' && !!spec.params?.plug });
      stat(p.archetype, m.tris, r.ms);
      const ceiling = p.mount === 'ceiling';
      for (const k of ['w', 'd', 'h']) {
        if (ceiling && k === 'h') {
          // recessed/surface spot fittings: the visible height ≤ dims.h + 0.02 (dims.h may be the mounting depth)
          if (fresh && (p.archetype === 'downlight' || p.archetype === 'downlight-surface') && m.size.h > p.dims.h + 0.02) sizeBad.push(`${p.id} h ${fmt(m.size.h)} > ${p.dims.h} + 0,02`);
          continue;
        }
        const [lo, hi] = band(p, k);
        const q = m.size[k] / p.dims[k];
        if (!(q >= lo && q <= hi)) sizeBad.push(`${p.id} ${k}: ${fmt(m.size[k])} m / dims ${p.dims[k]} (${lo}–${hi})`);
      }
      if (typeof p.params?.seatH === 'number' && model.seatY != null && fresh && Math.abs(model.seatY - p.params.seatH) > 0.03) seatBad.push(`${p.id}: seatY ${fmt(model.seatY)}, seatH ${p.params.seatH}`);
      if (p.light && !(model.lights?.length >= 1)) lightBad.push(`${p.id}: ingen lys`);
      if (p.light) for (const x of lightProblems(p.archetype, g)) lightBad.push(`${p.id}: ${x}`);
      // declared numbers inside their range: FAIL for the round's new/extended archetypes, a warning list otherwise
      for (const [k, s] of Object.entries(def.params || {})) {
        const v = spec.params?.[k];
        if (s.type !== 'number' || typeof v !== 'number') continue;
        if (v < s.min - 1e-9 || v > s.max + 1e-9) (fresh && (NEW.has(p.archetype) || EXT.has(p.archetype)) ? rangeBad : rangeWarn).push(`${p.id}.${k} = ${v} (${s.min}–${s.max})`);
      }
      const f = famBase.get(p.archetype) || { seat: false, surf: false };
      if (!fresh) {
        if (model.seatY != null) f.seat = true;
        if (model.surfaces?.length) f.surf = true;
        famBase.set(p.archetype, f);
      } else famNew.push({ p, seat: model.seatY != null, surf: !!model.surfaces?.length });
      if (fresh) {
        const max = p.archetype === 'spot-track' ? 12000 : ['downlight', 'downlight-surface', 'spot-ceiling'].includes(p.archetype) ? 3000 * Math.max(1, (p.params?.gridRows ?? 1) * (p.params?.gridCols ?? 1)) : 40000;
        if (m.tris > max) budget.push(`${p.id}: ${m.tris} trekanter (maks ${max})`);
      }
      dispose(g);
    }
  }
  for (const { p, seat, surf } of famNew) {
    const f = famBase.get(p.archetype);
    const fam = schema.archetypes[p.archetype]?.family;
    if ((f?.seat || (NEW.has(p.archetype) && fam === 'seating')) && !seat) famBad.push(`${p.id}: mangler seatY`);
    if ((f?.surf || (NEW.has(p.archetype) && fam === 'table')) && !surf) famBad.push(`${p.id}: mangler surfaces`);
  }
  canvasSkips += skipped;
  check(`${built} produktvarianter bygger uten grå boks (${skipped} trenger canvas, ${newCount} nye produkter)`, !fails.length, show(fails, 8));
  if (soft.length) Q.soft('nye produkter på nye arketyper har bygger', false, `${soft.length} venter: ${show(soft, 4)}`);
  check('mål: nye produkter 0,85–1,15 × dims (unntak etter §7), eldre 0,6–1,9 ×', !sizeBad.length, show(sizeBad, 8));
  check('nye sittemøbler: seatY = params.seatH ± 0,03', !seatBad.length, show(seatBad));
  check('lamper har lys med gyldige data', !lightBad.length, show(lightBad, 8));
  check('nye produkter på nye/utvidede arketyper: deklarerte tall innenfor min–maks', !rangeBad.length, show(rangeBad, 8));
  if (rangeWarn.length) console.log(`  merk ${rangeWarn.length} eldre produkter har tall utenfor byggerens glidebryter: ${show(rangeWarn, 4)}`);
  check('familiekontrakt: seatY/surfaces som produktene fra før', !famBad.length, show(famBad));
  check('nye produkter: trekantbudsjett (40 000, downlight 3 000 per hode, skinne 12 000)', !budget.length, show(budget));
}

// ---------------------------------------------------------------------------------------------------------------
section('6 Samme resultat to ganger (nye arketyper)');
{
  const bad = [];
  let n = 0;
  for (const id of ids.filter((x) => NEW.has(x))) {
    const def = reg.getArchetype(id);
    if (!def) continue;
    const specs = [{}];
    for (const [k, s] of Object.entries(def.params || {})) {
      if (specs.length >= 5) break;
      if (s.type === 'enum' && s.options?.length > 1) specs.push({ params: { [k]: Array.isArray(s.options.at(-1)) ? s.options.at(-1)[0] : s.options.at(-1) } });
      else if (s.type === 'number') specs.push({ params: { [k]: s.max } });
    }
    for (const spec of specs) {
      const a = build(id, { quality: 'medium', ...spec });
      const b = build(id, { quality: 'medium', ...spec });
      if (!a.g || !b.g) continue;
      n++;
      const ma = measure(a.g), mb = measure(b.g);
      if (ma.tris !== mb.tris || !ma.box.equals(mb.box)) bad.push(`${id} ${JSON.stringify(spec.params || {})}: ${ma.tris}/${mb.tris} trekanter`);
      dispose(a.g);
      dispose(b.g);
    }
  }
  check(`${n} bygg er like to ganger (ingen Math.random)`, !bad.length, show(bad));
}

// ---------------------------------------------------------------------------------------------------------------
section('7 Omfarging (nye arketyper)');
{
  const bad = [];
  let n = 0;
  for (const id of ids.filter((x) => NEW.has(x))) {
    const r = build(id, { quality: 'low' });
    if (!r.g) continue;
    const model = r.g.userData.model || {};
    for (const part of r.def.parts || []) {
      if (!model.recolor) break;
      n++;
      try {
        const v = model.recolor(part, '#aa3322', r.def.defaults?.materials?.[part] ?? 'painted');
        if (typeof v !== 'boolean') bad.push(`${id}.${part}: returnerte ${typeof v}`);
      } catch (e) {
        bad.push(`${id}.${part}: kaster ${String(e.message).slice(0, 80)}`);
      }
    }
    dispose(r.g);
  }
  check(`recolor(del, farge, materiale) gir true/false og kaster ikke (${n} kall)`, !bad.length, show(bad));
}

// ---------------------------------------------------------------------------------------------------------------
section('Rapport');
{
  const total = (performance.now() - T0) / 1000;
  const rows = [...stats.entries()].filter(([id]) => VERBOSE || NEW.has(id)).sort(([a], [b]) => (a < b ? -1 : 1));
  for (const [id, s] of rows) console.log(`  ${id.padEnd(22)} ${String(s.min).padStart(6)}–${String(s.max).padEnd(6)} trekanter  ${(s.ms / s.n).toFixed(1)} ms/bygg (${s.n})`);
  console.log(`  ${canvasSkips} bygg hoppet over (trenger canvas)${Q.PARTIAL ? ', QA_PARTIAL=1' : ''}`);
  console.log(`  tid: oppstart ${(TIMES.t0 ?? 0).toFixed(1)} s, ${TIMES.map(([n, s]) => `${n} ${s.toFixed(1)} s`).join(', ')}`);
  check(`hele testen under 90 s (${total.toFixed(1)} s)`, total < 90);
  // MASTER risk 15 budgets models ≤ 8 s on a quiet machine: a note, not a failure (parallel agents slow every build)
  if (total > 8) console.log(`  merk ${total.toFixed(1)} s er over budsjettet på 8 s (MASTER risiko 15) – kjør igjen på en rolig maskin før noe trimmes`);
}
done();
