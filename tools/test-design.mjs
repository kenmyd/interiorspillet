#!/usr/bin/env node
/**
 * Node test for the data layer and the design model (no browser):
 *   node tools/test-design.mjs            (from the project root; exit code 1 on failure)
 *
 * Checks: data files load (counts), catalogue normalisation (archetype, mount, part colours, materials, numbers),
 * the newest research round (research/catalog-new: prices, variant prices, notes, image URLs, the vitrineskap
 * category, the pendant-slatted / display-cabinet archetypes, re-running the normaliser reproduces the files),
 * layout derived values, existing furniture → items, DesignState (add/update/remove, undo/redo, transactions,
 * history limit, events, toJSON → load round trip, tolerant load, resetToOriginal), Acoustics (original ≈ 0.86 s,
 * proposal B ≈ 0.68 s, edits, rugs, shading) and Saves (with an in-memory storage).
 *
 * Vite imports JSON natively; Node needs import attributes, so a small in-thread loader hook turns *.json into
 * modules. three.js itself runs in Node (layout.js only uses vectors/boxes).
 */
import { registerHooks } from 'node:module';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

registerHooks({
  load(url, context, nextLoad) {
    if (url.startsWith('file:') && url.endsWith('.json')) {
      const text = fs.readFileSync(fileURLToPath(url), 'utf8');
      return { format: 'module', source: `export default ${text};`, shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const imp = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);

let failures = 0;
let passes = 0;
const section = (name) => console.log(`\n— ${name}`);
function check(name, ok, detail = '') {
  if (ok) {
    passes++;
    console.log(`  ok   ${name}`);
  } else {
    failures++;
    console.log(`  FAIL ${name}${detail ? `  → ${detail}` : ''}`);
  }
}
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const HEX = /^#[0-9a-f]{6}$/;

// ---------------------------------------------------------------------------------------------------------------
section('Data files');
const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
const spec = readJson('src/data/room-spec.json');
const palette = readJson('src/data/palette.json');
const walls = readJson('src/data/wall-proposals.json');
const schema = readJson('src/data/archetypes.json');
check('room-spec.json loads', spec.walls.length === 12 && spec.furniture.length === 62, `walls ${spec.walls.length}, furniture ${spec.furniture.length}`);
check('palette.json loads (walls sand + marrakesh)', palette.walls.sand.hex === '#cfc5b4' && palette.walls.marrakesh.hex === '#aea191');
check('wall-proposals.json: 60 proposals, existing first then N1…N39 (runde 3 = N20–N39)', walls.proposals.length === 60 && walls.proposals[0].id === '0' && walls.proposals[21].id === 'N1' && walls.proposals[39].id === 'N19' && walls.proposals[59].id === 'N39',
  walls.proposals.map((p) => p.id).join(','));
check('wall-proposals.json: acousticModel at top level', walls.acousticModel?.k === 22.7 && walls.acousticModel?.baseAbsorption === 26.4);
const withImage = walls.proposals.filter((p) => p.image);
check('proposal images → img/forslag/<CODE>.jpg + thumb', withImage.length === 21 && withImage.every((p) => p.image === `img/forslag/${p.code}.jpg` && p.thumb === `img/forslag/thumb/${p.code}.jpg`));
check('new proposals N* have image null', walls.proposals.filter((p) => /^N/.test(p.id)).every((p) => p.image === null && p.thumb === null));
const ELEMENT_TYPES = ['slats', 'panel', 'art', 'tapestry', 'checker', 'circles', 'hexagons', 'curtain', 'moss', 'shelf', 'sideboard-floating', 'hooks', 'led', 'lamp-wall', 'paint-block', 'plant', 'wallpaper', 'moulding', 'bookcase', 'ledge'];
const badEls = walls.proposals.flatMap((p) => p.elements.filter((e) => !ELEMENT_TYPES.includes(e.type)).map((e) => `${p.id}:${e.type}`));
check('every wall element type is known (§9)', !badEls.length, badEls.join(' '));

// ---------------------------------------------------------------------------------------------------------------
section('Catalogue normalisation');
const catalog = await imp('src/catalog/index.js');
const VALID_MATERIALS = new Set(Object.values(schema.materials).flat());
const MOUNTS = ['floor', 'wall', 'ceiling', 'surface', 'soft', 'rug', 'window'];
const counts = Object.fromEntries(catalog.CATEGORIES.map((c) => [c.key, catalog.products(c.key).length]));
console.log('  counts', JSON.stringify(counts), 'total', catalog.allProducts().length);
const CAT_LABELS = 'Sofaer|Lenestoler|Bord|Spisestoler|Skjenker|TV-benker|Vitrineskap|Hyller|Senger|Nattbord|Kommoder|Garderobeskap|Speil|Bad|Gang|Taklamper|Små lamper|Puter og pledd|Tepper|Solskjerming|Akustikk|Smått';
check('22 categories with Norwegian labels (the living room first, then bedroom, bath, hall, lamps, textiles …)', catalog.CATEGORIES.length === 22 && catalog.CATEGORIES.map((c) => c.label).join('|') === CAT_LABELS,
  catalog.CATEGORIES.map((c) => c.label).join('|'));
const { ICONS } = await imp('src/ui/icons.js');
check('every category has an icon in ui/icons.js and a drawn category icon', catalog.CATEGORIES.every((c) => ICONS[c.icon] && /^<svg/.test(c.iconSvg || '')),
  catalog.CATEGORIES.filter((c) => !ICONS[c.icon] || !c.iconSvg).map((c) => c.key).join(','));
const problems = [];
const ids = new Set();
for (const p of catalog.allProducts()) {
  const where = `${p.category}/${p.id}`;
  if (ids.has(p.id)) problems.push(`${where}: duplicate id`);
  ids.add(p.id);
  const a = schema.archetypes[p.archetype];
  if (!a) {
    problems.push(`${where}: archetype ${p.archetype}`);
    continue;
  }
  if (!MOUNTS.includes(p.mount)) problems.push(`${where}: mount ${p.mount}`);
  if (p.mount !== a.mount && !(p.archetype === 'vase' && p.mount === 'floor') && !(a.mounts || []).includes(p.mount)) problems.push(`${where}: mount ${p.mount} ≠ ${a.mount}`);
  for (const k of ['w', 'd', 'h']) if (typeof p.dims[k] !== 'number' || p.dims[k] <= 0 || p.dims[k] > 6) problems.push(`${where}: dims.${k}=${p.dims[k]}`);
  for (const f of ['priceNok', 'salePriceNok', 'absorption']) if (p[f] != null && typeof p[f] !== 'number') problems.push(`${where}: ${f} not a number`);
  if (!(p.defaultVariant >= 0 && p.defaultVariant < p.variants.length)) problems.push(`${where}: defaultVariant`);
  const required = a.parts || schema.families[a.family].parts;
  p.variants.forEach((v, i) => {
    for (const part of required) {
      if (!HEX.test(v.colors?.[part] || '')) problems.push(`${where}#${i}: colour ${part}=${v.colors?.[part]}`);
      if (!VALID_MATERIALS.has(v.materials?.[part])) problems.push(`${where}#${i}: material ${part}=${v.materials?.[part]}`);
    }
    const allowed = new Set([...required, ...schema.families[a.family].parts, ...(schema.families[a.family].optionalParts || [])]);
    for (const part of Object.keys(v.colors || {})) if (!allowed.has(part)) problems.push(`${where}#${i}: non-canonical part ${part}`);
    for (const m of Object.values(v.materials || {})) if (!VALID_MATERIALS.has(m)) problems.push(`${where}#${i}: material ${m}`);
  });
  const item = catalog.productToItemSpec(p);
  if (!item || item.archetype !== p.archetype || item.mount !== p.mount || item.source !== 'catalog' || item.refId !== p.id) problems.push(`${where}: productToItemSpec`);
  if (p.light && !(item.light?.lumens > 0)) problems.push(`${where}: light lumens`);
}
check('every product: valid archetype, mount, part colours + materials, numbers', !problems.length, `${problems.length} problems: ${problems.slice(0, 8).join(' | ')}`);
check('getProduct / search', catalog.getProduct('woodupp-akupanel-240x60')?.archetype === 'slat-panel' && catalog.search('plisse').length >= 3 && catalog.search('boucle lenestol').length >= 1,
  `plisse ${catalog.search('plisse').length}`);
const shade = catalog.productToShadingSpec('ikea-sanela-gardiner-1-par-140x250');
check('productToShadingSpec (curtain)', shade?.archetype === 'curtain' && shade.mount === 'ceiling' && shade.open === 1 && shade.colors.fabric && shade.colors.rail);

// ---------------------------------------------------------------------------------------------------------------
section('New products (research/catalog-new)');
check('archetype pendant-slatted: lamp, ceiling, «Spilelampe (tre)», parts without a base', schema.archetypes['pendant-slatted']?.family === 'lamp'
  && schema.archetypes['pendant-slatted'].mount === 'ceiling' && schema.archetypes['pendant-slatted'].label === 'Spilelampe (tre)'
  && schema.archetypes['pendant-slatted'].parts.join() === 'shade,inner,metal,cord' && catalog.archetypeInfo('pendant-slatted').partLabels.shade === 'Spiler');
check('archetype display-cabinet: storage family, floor (or wall), «Vitrineskap», canonical parts', schema.archetypes['display-cabinet']?.family === 'storage'
  && schema.archetypes['display-cabinet'].mount === 'floor' && schema.archetypes['display-cabinet'].mounts.join() === 'floor,wall'
  && schema.archetypes['display-cabinet'].label === 'Vitrineskap' && schema.families.storage?.parts.join() === 'body,front,top,legs,handle'
  && Object.keys(schema.families.storage.partLabels).length === 5);
check('mountsCompatible: vitrineskap floor ↔ wall, nothing else across mounts', catalog.mountsCompatible('display-cabinet', 'floor', 'display-cabinet', 'wall')
  && !catalog.mountsCompatible('sideboard', 'floor', 'wall-shelf', 'wall') && !catalog.mountsCompatible('art-frame', 'wall', 'art-frame', 'floor'));
// round 1 + catalog-new (lenestoler, Secto, gulvlamper, vitrineskap) + hele huset (152 new products incl. Skeidar and Jysk,
// the 3 mirrors moved to Speil) + 34 lenestoler (24 hvilestoler) from Bohus, Skeidar, Fagmøbler, Møbelringen, Jysk, IKEA and Mio
const COUNTS = { sofa: 11, lenestol: 55, bord: 10, stoler: 8, skjenk: 14, tvbenk: 7, vitrineskap: 5, hylle: 11, seng: 20, nattbord: 10, kommode: 10, garderobe: 9, speil: 13, bad: 19, gang: 14, taklampe: 19, smalamper: 34, tekstil: 24, teppe: 19, solskjerming: 22, akustikk: 16, smatt: 22 };
check('counts per category – 372 products', Object.entries(COUNTS).every(([k, n]) => counts[k] === n) && catalog.allProducts().length === 372, JSON.stringify(counts));
const NEW_DIR = path.join(ROOT, 'research', 'catalog-new');
const fresh = fs.readdirSync(NEW_DIR).filter((f) => f.endsWith('.json')).flatMap((f) => readJson(`research/catalog-new/${f}`));
const KEEP = ['category', 'subcategory', 'name', 'brand', 'store', 'url', 'priceNok', 'salePriceNok', 'priceNote', 'priceConfidence', 'archetype', 'defaultVariant', 'description', 'why', 'imageUrl', 'verified', 'verifiedNote', 'light'];
const freshProblems = [];
// measured dims / model params set in src/data/scripts/fixes.mjs win over the research values
const { PRODUCTS: FIXES } = await imp('src/data/scripts/fixes.mjs');
for (const src of fresh) {
  const p = catalog.getProduct(src.id);
  const fx = FIXES[src.id] || {};
  if (!p) {
    freshProblems.push(`${src.id}: missing`);
    continue;
  }
  for (const k of KEEP) if (JSON.stringify(p[k]) !== JSON.stringify(src[k])) freshProblems.push(`${src.id}: ${k}`);
  for (const k of ['w', 'd', 'h']) if (!near(p.dims[k], fx.dims?.[k] ?? src.dims[k], 1e-9)) freshProblems.push(`${src.id}: dims.${k}`);
  if (p.mount !== src.mount) freshProblems.push(`${src.id}: mount ${p.mount} ≠ research ${src.mount}`);
  // (a fix of null removes the key)
  for (const [k, v] of Object.entries(src.params || {})) if (JSON.stringify(p.params[k]) !== JSON.stringify(fx.params && k in fx.params ? fx.params[k] ?? undefined : v)) freshProblems.push(`${src.id}: params.${k}`);
  if (p.variants.length !== src.variants.length) freshProblems.push(`${src.id}: variants`);
  src.variants.forEach((v, i) => {
    const pv = p.variants[i];
    for (const k of ['name', 'priceNok', 'salePriceNok', 'priceConfidence', 'url', 'paramsOverride']) if (JSON.stringify(pv?.[k]) !== JSON.stringify(v[k])) freshProblems.push(`${src.id}#${i}: ${k}`);
    for (const [part, hex] of Object.entries(v.colors)) if (pv?.colors?.[part] !== hex || pv?.materials?.[part] !== v.materials[part]) freshProblems.push(`${src.id}#${i}: ${part}`);
  });
}
check(`all ${fresh.length} new products kept: prices, sale prices, variant prices/urls, notes, image URLs, params (shape notes, profilePoints)`, fresh.length === 212 && !freshProblems.length,
  freshProblems.slice(0, 8).join(' | '));
const pr = (id, vi) => {
  const x = catalog.priceOf(catalog.getProduct(id), vi);
  return `${x.price}/${x.listPrice}/${x.onSale ? 'sale' : '-'}`;
};
const PRICES = [
  ['christiania-belysning-secto-design-secto-4200-taklampe', 0, '7495/7495/-'], ['christiania-belysning-secto-design-secto-4200-taklampe', 1, '8090/8090/-'],
  // the Secto -20 % campaign ended (checked 2026-10-21)
  ['christiania-belysning-secto-design-secto-4201-small-taklampe', 0, '6765/6765/-'], ['christiania-belysning-secto-design-secto-4201-small-taklampe', 1, '7345/7345/-'],
  ['christiania-belysning-secto-design-octo-4240-taklampe-o54', 3, '11395/11395/-'], ['christiania-belysning-secto-design-octo-4241-small-taklampe-o45', 1, '10920/10920/-'],
  ['bohus-actona-chicago-hvilestol-med-fotskammel', 0, '7999/7999/-'], ['bohus-actona-chicago-hvilestol-med-fotskammel', 1, '6999/8999/sale'],
  ['bohus-conform-timeout-hvilestol-med-fotskammel', 0, '20298/31498/sale'], ['bohus-conform-timeout-hvilestol-med-fotskammel', 1, '31498/31498/-'],
  ['bohus-conform-timeout-hvilestol-med-fotskammel', 6, '33998/42498/sale'], ['bohus-castle-mark-zermatt-hvilestol-med-fotskammel', 0, '23330/23330/-'],
  ['bohus-castle-mark-grande-hvilestol-med-fothviler', 1, '10999/18332/sale'], ['bohus-img-taycan-hvilestol-med-fothviler', 2, '29379/48965/sale'],
  ['bohus-sagene-vitrineskap-med-lys-90x40', 0, '7799/12999/sale'], ['bohus-sagene-vitrineskap-med-lys-90x40', 1, '13999/13999/-'],
  ['bohus-scandi-vitrineskap-med-lys-60x40', 0, '20599/20599/-'], ['bohus-scandi-vitrineskap-med-lys-60x40', 1, '14399/20699/sale'],
  ['bohus-belfort-vitrineskap-med-lys-120x40', 1, '16799/20999/sale'], ['bohus-signature-1860-vitrineskap-90x40', 0, '12799/18299/sale'],
  ['ikea-besta-veggmontert-60x42x64-glassvik-rokfarget', 0, '1495/1695/sale'], ['ikea-besta-veggmontert-60x42x64-glassvik-rokfarget', 1, '1495/1695/sale'],
];
const badPrices = PRICES.filter(([id, vi, want]) => pr(id, vi) !== want).map(([id, vi, want]) => `${id}#${vi} ${pr(id, vi)} ≠ ${want}`);
check('priceOf: sale / regular / per-variant prices of the new products', !badPrices.length, badPrices.join(' | '));
check('Sagene brown variant: its own price, confirmed on the product data (2026-10-21)', catalog.priceOf(catalog.getProduct('bohus-sagene-vitrineskap-med-lys-90x40'), 1).confidence === 'checked');
const besta = catalog.productToItemSpec('ikea-besta-veggmontert-60x42x64-glassvik-rokfarget', 1);
check('BESTÅ vitrine: wall-hung item, variant «klart glass» overrides doorStyle', besta.mount === 'wall' && besta.params.doorStyle === 'glass-framed' && besta.params.base === 'wall'
  && catalog.productToItemSpec('ikea-besta-veggmontert-60x42x64-glassvik-rokfarget', 0).params.doorStyle === 'glass-smoked');
check('the four other vitrines stand on the floor', catalog.products('vitrineskap').filter((p) => p.mount === 'floor').length === 4);
const secto = catalog.productToItemSpec('christiania-belysning-secto-design-octo-4240-taklampe-o54');
// a placed lamp starts at NEW_LAMP (2700 K, 40 %); the shop's 3000 K stays in the product facts
check('Secto/Octo pendants: ceiling, drop = the shop cable default, 806 lm (shop 3000 K, placed at NEW_LAMP), profilePoints kept', secto.mount === 'ceiling' && secto.params.drop === 1.2 && secto.light.lumens === 806
  && catalog.getProduct('christiania-belysning-secto-design-octo-4240-taklampe-o54').light.colorK === 3000
  && secto.light.colorK === catalog.NEW_LAMP.colorK && secto.light.dimmer === catalog.NEW_LAMP.dimmer
  && secto.params.profilePoints.length === 21 && secto.params.profilePoints[13][1] === 0.54);
check('subcategories: every recliner «hvilestol» (32), every pendant «pendel» (18)', catalog.products('lenestol').filter((p) => p.subcategory === 'hvilestol').length === 32
  && catalog.products('lenestol').filter((p) => p.archetype === 'recliner').every((p) => p.subcategory === 'hvilestol')
  && catalog.products('taklampe').filter((p) => p.subcategory === 'pendel').length === 18 && catalog.SUBCATEGORY_LABELS.hvilestol === 'Hvilestoler');
check('search finds the new products', catalog.products('vitrineskap').every((p) => catalog.search('vitrineskap').includes(p)) && catalog.search('secto').length === 4 && catalog.search('hvilestol fotskammel').length >= 4
  && catalog.search('octo').length === 2, `vitrine ${catalog.search('vitrineskap').length}, secto ${catalog.search('secto').length}, octo ${catalog.search('octo').length}`);
const floorLamps = catalog.products('smalamper').filter((p) => p.subcategory === 'gulvlampe');
const oslo = catalog.productToItemSpec('nordicnest-northern-oslo-wood-gulvlampe');
check('22 gulvlamper on the floor (12 new: globe, reading, pleated, lantern, slats, cage, tripods); Oslo Wood = tiltable cone', floorLamps.length === 22
  && floorLamps.every((p) => p.mount === 'floor' && p.archetype.startsWith('floor-'))
  && new Set(floorLamps.map((p) => p.params?.shadeShape || p.params?.armShape || p.archetype)).size >= 12
  && oslo.params.shadeShape === 'cone' && oslo.params.tilt === 15 && oslo.params.tiltable === true && oslo.params.shadeBottomD === 0.13,
  `${floorLamps.length} floor lamps`);
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ip-norm-'));
const run = spawnSync(process.execPath, [path.join(ROOT, 'src/data/scripts/normalize-data.mjs'), '--only=catalog', `--out=${outDir}`], { cwd: ROOT, encoding: 'utf8' });
const same = (key) => fs.readFileSync(path.join(outDir, 'catalog', `${key}.json`), 'utf8') === fs.readFileSync(path.join(ROOT, 'src/data/catalog', `${key}.json`), 'utf8');
const reDiff = run.status === 0 ? catalog.CATEGORIES.filter((c) => !same(c.key)).map((c) => c.key) : ['run failed'];
check('re-running the normaliser (research + catalog-new + fixes) reproduces src/data/catalog exactly, room-spec untouched', run.status === 0 && !reDiff.length && !fs.existsSync(path.join(outDir, 'room-spec.json')),
  `${reDiff.join(',')} ${(run.stderr || '').slice(0, 200)}`);
fs.rmSync(outDir, { recursive: true, force: true });

// ---------------------------------------------------------------------------------------------------------------
section('Hele huset (research/catalog-new/*-hele-huset.json)');
const NEW_CATS = ['sofa', 'bord', 'stoler', 'tvbenk', 'hylle', 'seng', 'nattbord', 'kommode', 'garderobe', 'speil', 'bad', 'gang'];
check('12 new categories with a drawn icon, an ui/icons.js icon and rooms', NEW_CATS.every((k) => {
  const c = catalog.CATEGORIES.find((x) => x.key === k);
  return c && /^<svg/.test(c.iconSvg || '') && ICONS[c.icon] && Array.isArray(c.rooms) && c.rooms.length;
}) && catalog.CATEGORIES.every((c) => Array.isArray(c.rooms) && c.rooms.length));
check('sofa, bord, stoler and hylle are catalogue categories now (existing furniture swaps with products); EXTRA keeps elektronikk', Object.keys(catalog.EXTRA_CATEGORIES).join() === 'elektronikk'
  && catalog.categoryLabel('sofa') === 'Sofaer' && catalog.categoryLabel('stoler') === 'Spisestoler' && catalog.categoryLabel('elektronikk') === 'TV og lyd');
const NEW_ARCH = ['bed', 'headboard', 'bench', 'chair', 'wardrobe', 'dresser', 'bedside-table', 'bookcase', 'shoe-cabinet', 'wall-cabinet', 'mirror-cabinet', 'mirror-floor', 'towel', 'towel-ladder', 'towel-rail', 'bath-accessory', 'coat-rack', 'coat-stand'];
check('18 new archetypes in archetypes.json (families bed and fixture), each used by a product', NEW_ARCH.every((a) => schema.archetypes[a]) && schema.families.bed?.parts.join() === 'frame,headboard,legs,bedding'
  && schema.families.fixture?.parts.join() === 'body,accent' && NEW_ARCH.every((a) => catalog.allProducts().some((p) => p.archetype === a)),
  NEW_ARCH.filter((a) => !catalog.allProducts().some((p) => p.archetype === a)).join(','));
const MODEL_FILES = ['beds', 'storage', 'chairs', 'fixtures'].map((m) => fs.readFileSync(path.join(ROOT, 'src/models', `${m}.js`), 'utf8')).join('\n');
check('every new archetype has a builder in models/beds|storage|chairs|fixtures.js and registry.js loads those files', NEW_ARCH.every((a) => MODEL_FILES.includes(`'${a}': def('${a}'`) || MODEL_FILES.includes(`  ${a}: def('${a}'`))
  && ['beds', 'storage', 'chairs', 'fixtures'].every((m) => fs.readFileSync(path.join(ROOT, 'src/models/registry.js'), 'utf8').includes(`from './${m}.js'`)));
const huset = fs.readdirSync(NEW_DIR).filter((f) => f.endsWith('-hele-huset.json')).flatMap((f) => readJson(`research/catalog-new/${f}`));
const husetProblems = [];
for (const src of huset) {
  const p = catalog.getProduct(src.id);
  if (!p) {
    husetProblems.push(`${src.id}: missing`);
    continue;
  }
  if (!p.verified || !/2026-10-2[01]/.test(p.priceNote) || !/^https:\/\//.test(p.url) || !/^https:\/\//.test(p.imageUrl)) husetProblems.push(`${p.id}: verified/date/url/image`);
  if (!(typeof p.priceNok === 'number' && p.priceNok > 0) || typeof p.absorption !== 'number') husetProblems.push(`${p.id}: price/absorption`);
  if (p.subcategory && !catalog.SUBCATEGORY_LABELS[p.subcategory]) husetProblems.push(`${p.id}: subcategory ${p.subcategory} has no label`);
  if (!p.description || !p.why || !p.verifiedNote) husetProblems.push(`${p.id}: texts`);
}
const byStore = huset.reduce((m, p) => ({ ...m, [p.store]: (m[p.store] || 0) + 1 }), {});
console.log('  hele huset per store', JSON.stringify(byStore));
check(`all ${huset.length} hele-huset products: verified 2026-10-20/21, url + image, price, absorption, texts, subcategory labels`, huset.length === 152 && !husetProblems.length, husetProblems.slice(0, 6).join(' | '));
check('Bohus first (more than half), then IKEA, Skeidar, Jysk', (byStore.Bohus || 0) > huset.length / 2 && byStore.IKEA > 0 && byStore.Skeidar > 0 && byStore.Jysk > 0, JSON.stringify(byStore));
const HUSET_PRICES = [
  ['bohus-sando-kontinentalseng-180x200', 0, '25999/51998/sale'], ['bohus-sando-kontinentalseng-180x200', 1, '51998/51998/-'],
  ['bohus-madrid-kommode-160x39', 0, '6499/6499/-'], ['bohus-madrid-kommode-160x39', 2, '3249/6499/sale'],
  ['ikea-kivik-3-seters-sofa', 0, '5995/7995/sale'], ['ikea-kivik-3-seters-sofa', 1, '6995/8495/sale'],
];
const badHuset = HUSET_PRICES.filter(([id, vi, want]) => pr(id, vi) !== want).map(([id, vi, want]) => `${id}#${vi} ${pr(id, vi)} ≠ ${want}`);
check('priceOf: campaign / ordinary / variant prices of hele-huset products', !badHuset.length, badHuset.join(' | '));
check('the three round-1 mirrors moved from Smått to Speil (subcategory veggspeil)', ['bohus-applewood-speil-o90', 'bohus-othilie-speil-90x93', 'bohus-holmen-cape-speil-med-sprosser-h200']
  .every((id) => catalog.getProduct(id)?.category === 'speil' && catalog.getProduct(id).subcategory === 'veggspeil') && !catalog.products('smatt').some((p) => p.archetype === 'mirror'));
const fax = catalog.productToItemSpec('ikea-faxalven-speilskap-med-integrert-belysning-60x95');
check('mirror cabinet with LED: wall item with a lamp (Inspector light controls), mountHeight for Placement', fax.mount === 'wall' && fax.light?.lumens === 1370 && fax.params.mountHeight > 1);
const madridMirror = catalog.productToItemSpec('bohus-madrid-garderobeskap-103x60', catalog.getProduct('bohus-madrid-garderobeskap-103x60').variants.findIndex((v) => /speil/i.test(v.name)));
check('wardrobe variant with a mirror door over drawers (paramsOverride fronts)', madridMirror.params.fronts.join() === 'mirror,door+drawers:2' && madridMirror.params.cellDrawerH === 0.43);
check('beds: the bed family parts, seatY-ready params, headboards and benches in Senger', catalog.products('seng').filter((p) => p.archetype === 'bed').length === 11
  && catalog.products('seng').filter((p) => p.subcategory === 'sengegavl').length === 6 && catalog.products('seng').every((p) => p.archetype !== 'bed' || p.variants.every((v) => v.colors.bedding && v.colors.frame)));
check('search: «seng 180», «speilskap», «skoskap», «håndkle», «garderobe»', catalog.search('kontinentalseng 180').length >= 3 && catalog.search('speilskap').length >= 3
  && catalog.search('skoskap').length >= 4 && catalog.search('håndkle').length >= 3 && catalog.search('garderobe').length >= 8);

// ---------------------------------------------------------------------------------------------------------------
section('Lenestoler and real colours (research/catalog-new/lenestol-*.json)');
const ARM_FILES = ['lenestol-bohus-hvilestoler', 'lenestol-bohus-lenestoler', 'lenestol-skeidar', 'lenestol-fagmobler-mobelringen', 'lenestol-jysk-ikea-mio'];
const arms = ARM_FILES.flatMap((n) => readJson(`research/catalog-new/${n}.json`));
const armStores = arms.reduce((m, p) => ({ ...m, [p.store]: (m[p.store] || 0) + 1 }), {});
console.log('  lenestoler per store', JSON.stringify(armStores));
const armProblems = arms.filter((p) => !p.verified || !/2026-10-21/.test(p.priceNote) || !/^https:\/\//.test(p.url) || !/^https:\/\//.test(p.imageUrl) || !p.variants.length).map((p) => p.id);
check(`${arms.length} more lenestoler, verified 2026-10-21 with url + image + variants, from ${Object.keys(armStores).length} stores (Bohus first)`, arms.length === 34 && !armProblems.length
  && Object.keys(armStores).length >= 5 && armStores.Bohus === Math.max(...Object.values(armStores)), armProblems.join(', '));
check('25 of them are hvilestoler (recline / footstool) in subcategory «hvilestol»', arms.filter((p) => catalog.getProduct(p.id)?.subcategory === 'hvilestol').length === 25);
check('Zermatt hvilestol med fothviler (the owner\'s photo): 9 999 / 16 665, beige and grey Breeze, black star base', pr('bohus-castle-mark-zermatt-hvilestol-med-fothviler', 0) === '9999/16665/sale'
  && catalog.getProduct('bohus-castle-mark-zermatt-hvilestol-med-fothviler').variants.map((v) => v.name.split(',')[0]).join() === 'Breeze 120 Beige,Breeze 453 Grå');
// every reference in fixes.mjs still hits its product and variants after the colour audit renamed variants
const fixRefs = [];
for (const [id, fx] of Object.entries(FIXES)) {
  const p = catalog.getProduct(id);
  if (!p) {
    fixRefs.push(`${id}: no product`);
    continue;
  }
  for (const [match] of fx.variants || []) if (!p.variants.some((v) => v.name.includes(match))) fixRefs.push(`${id}: variant «${match}»`);
  if (typeof fx.defaultVariant === 'string' && !p.variants.some((v) => v.name.includes(fx.defaultVariant))) fixRefs.push(`${id}: default «${fx.defaultVariant}»`);
}
check('fixes.mjs: every product id, variant match and default variant still hits the catalogue', !fixRefs.length, fixRefs.join(' | '));
const allProducts = catalog.allProducts();
check('variants are the stores\' own: unique names per product, no «utgående» / «tilbud» / own colours left in the names', allProducts.every((p) => new Set(p.variants.map((v) => v.name)).size === p.variants.length
  && p.variants.every((v) => v.name && !/utgående|\(tilbud\)|egen farge/i.test(v.name))));
check('propParts: bedding on a bed, towels and coats only dress the model (free colour); everything else follows the variants', catalog.archetypeInfo('bed').propParts.join() === 'bedding,throw'
  && ['towel-ladder', 'towel-rail', 'coat-rack', 'coat-stand'].every((a) => catalog.archetypeInfo(a).propParts.join() === 'fabric')
  && catalog.archetypeInfo('recliner').propParts.length === 0 && catalog.archetypeInfo('sofa-straight').propParts.length === 0);

// ---------------------------------------------------------------------------------------------------------------
section('Layout');
const { layout } = await imp('src/home/layout.js');
console.log(`  volume ${layout.volume.toFixed(2)} m³, floor ${layout.floorArea.toFixed(2)} m², walls ${layout.walls.length}, windows ${layout.windows.length}, doors ${layout.doors.length}`);
check('volume ≈ 138.6 m³ (ceiling integrated over the floor)', near(layout.volume, 138.57, 0.1), layout.volume);
check('floor area ≈ 53.8 m²', near(layout.floorArea, 53.78, 0.05), layout.floorArea);
check('ceiling: TV-stue 2.40, kitchen 2.40', layout.ceilingHeightAt(1.5, 10) === 2.4 && layout.ceilingHeightAt(4.5, 1.5) === 2.4);
check('ceiling: slope 3.00 at the high wall, 2.40 at the windows, 2.65 over the dining table',
  near(layout.ceilingHeightAt(3.22, 6), 3, 1e-9) && near(layout.ceilingHeightAt(6.92, 9), 2.4, 1e-9) && near(layout.ceilingHeightAt(5.37, 6.81), 3 - 0.16216 * (5.37 - 3.22), 1e-3));
const hw = layout.highWall;
check('highWall exactly as the spec', hw.origin.x === 3.22 && hw.origin.z === 8.34 && hw.uDir.z === -1 && hw.normal.x === 1 && hw.width === 3.91 && hw.height === 3);
const s1 = layout.windows.find((w) => w.id === 'win-s1');
check('win-s1 centre/normal/right in world space', near(s1.center.x, 6.92, 1e-9) && near(s1.center.z, 7.72, 1e-9) && near(s1.center.y, 1.195, 1e-9) && s1.normal.x === -1 && s1.right.z === 1 && s1.revealDepth === 0.2);
check('windows include the terrace door', layout.windows.some((w) => w.type === 'terrace-door'));
check('layout is frozen', Object.isFrozen(layout) && Object.isFrozen(layout.highWall.origin));
check('zones with Box3 0…3.1', layout.zones.length === 4 && layout.zones.every((z) => z.box.max.y === 3.1) && layout.zoneAt(5.4, 6.8)?.id === 'spisestue');

// ---------------------------------------------------------------------------------------------------------------
section('Existing furniture');
const existing = await imp('src/home/existing.js');
const originals = existing.originalItems(layout);
check('every room-spec furniture entry → item (decor group split into 5)', originals.length === spec.furniture.length - 1 + 5, originals.length);
const exProblems = [];
for (const it of originals) {
  const a = schema.archetypes[it.archetype];
  if (!a) exProblems.push(`${it.refId}: archetype ${it.archetype}`);
  if (it.source !== 'existing') exProblems.push(`${it.refId}: source`);
  if (!MOUNTS.includes(it.mount)) exProblems.push(`${it.refId}: mount ${it.mount}`);
  const required = a ? a.parts || schema.families[a.family].parts : [];
  for (const part of required) if (!HEX.test(it.colors[part] || '')) exProblems.push(`${it.refId}: colour ${part}`);
  for (const m of Object.values(it.materials)) if (!VALID_MATERIALS.has(m)) exProblems.push(`${it.refId}: material ${m}`);
  for (const [k, v] of Object.entries(it.params)) if (typeof v === 'string' && /\s/.test(v)) exProblems.push(`${it.refId}: text param ${k}`);
}
check('existing items: valid archetype/mount/parts/materials, no text params', !exProblems.length, exProblems.slice(0, 8).join(' | '));
const chandelier = originals.find((i) => i.refId === 'f-pendel-stue');
check('molecule chandelier is an item with a light', chandelier?.archetype === 'chandelier-molecule' && chandelier.mount === 'ceiling' && chandelier.light?.lumens === 800); // add-lighting: 2000 → 800 lm
const tv = originals.find((i) => i.refId === 'f-tv');
check('wall items use the vertical middle and attach to their wall', tv.position[1] === 1.055 && tv.attach?.wallId === 'w-vest-tv' && tv.attach.normal[2] === -1);
check('swivel chairs mapped armchair-tub-swivel → tub-swivel', originals.filter((i) => i.archetype === 'tub-swivel').length === 2);
console.log(`  original furniture absorption ${existing.originalAbsorption(layout).toFixed(2)} m²`);

// ---------------------------------------------------------------------------------------------------------------
section('DesignState');
const { DesignState, MAX_HISTORY } = await imp('src/design/DesignState.js');
const d = new DesignState();
check('starts with the original design and no history', d.items.size === originals.length && !d.canUndo && d.wall.proposalId === '0');
const events = [];
for (const ev of ['item:add', 'item:update', 'item:remove', 'wall', 'window', 'paint', 'env', 'load', 'change', 'history']) d.on(ev, (p) => events.push(ev));
const chairSpec = { ...catalog.productToItemSpec('bohus-scapa-vilde-loungestol'), position: [4.0, 0, 9.8] };
const vildeFabric = catalog.getProduct('bohus-scapa-vilde-loungestol').variants[0].colors.upholstery;
const uid = d.add(chairSpec);
check('add → events item:add, change, history', events.join(',') === 'item:add,change,history', events.join(','));
check('add stores a normalised item', d.get(uid)?.archetype === 'tub-swivel' && d.get(uid).colors.upholstery === vildeFabric && d.get(uid).position[0] === 4);
d.update(uid, { position: { x: 4.2, y: 0, z: 9.9 }, colors: { legs: '#ffffff' } });
check('update merges colours, accepts {x,y,z}', d.get(uid).position[0] === 4.2 && d.get(uid).colors.legs === '#ffffff' && d.get(uid).colors.upholstery === vildeFabric);
d.undo();
check('undo update', d.get(uid).position[0] === 4 && d.get(uid).colors.legs === '#1c1c1c');
d.redo();
check('redo update', d.get(uid).position[0] === 4.2);
d.remove(uid);
check('remove', !d.get(uid) && d.items.size === originals.length);
d.undo();
check('undo remove restores the item', d.get(uid)?.position[0] === 4.2);
d.undo();
d.undo();
check('undo add removes the item', !d.get(uid) && !d.canUndo && d.canRedo);
d.redo();
check('redo add', !!d.get(uid));
const before = d.historySize;
const beforeTx = JSON.stringify(d.get(uid));
events.length = 0;
d.transaction('Flytt Vilde loungestol', () => {
  for (let i = 0; i < 30; i++) d.update(uid, { position: [4 + i * 0.01, 0, 9.8] });
  d.update(uid, { rotationDeg: 45 });
});
check('transaction = one undo step with its label', d.historySize === before + 1 && d.undoLabel === 'Flytt Vilde loungestol');
check('history emitted once, after the transaction', events.filter((e) => e === 'history').length === 1 && events[events.length - 1] === 'history');
d.undo();
check('undo transaction reverts all of it', JSON.stringify(d.get(uid)) === beforeTx);
const drag = d.transaction('Dra', () => new Promise((resolve) => setTimeout(resolve, 5)));
d.update(uid, { position: [5, 0, 10] });
d.update(uid, { position: [5.1, 0, 10] });
await drag;
check('async transaction (promise) groups updates until it settles', d.undoLabel === 'Dra');
d.begin('Plasser');
d.update(uid, { position: [5.5, 0, 10] });
d.cancel();
check('cancel reverts an open transaction without a step', d.get(uid).position[0] === 5.1 && d.undoLabel === 'Dra');
const small = new DesignState({ maxHistory: MAX_HISTORY });
const u2 = small.add({ archetype: 'cushion', name: 'Pute', position: [1, 0.45, 9] });
for (let i = 0; i < 250; i++) small.update(u2, { rotationDeg: i });
check(`history keeps max ${MAX_HISTORY} steps`, small.historySize === MAX_HISTORY);
small.setEnv({ hour: 18 });
small.setEnv({ hour: 19 });
small.setEnv({ hour: 20, builtIn: { led: { on: false } } });
check('setEnv calls within 1 s coalesce into one step', small.undoLabel === 'Endre lys og tid' && small.env.hour === 20 && small.env.builtIn.led.on === false);
small.undo();
check('…and undo restores the env before the first call', small.env.hour === 13 && !small.env.builtIn.led);

d.setWallProposal('B');
d.setWindow('win-s1', catalog.productToShadingSpec('bohus-rebell-sondre-gardinlengde-140x220'));
d.setPaint('w-vest-stue', 'sand');
d.setEnv({ mode: 'evening', exposure: 1.2 });
const json = d.toJSON();
check('toJSON has version 1', json.version === 1 && Array.isArray(json.items) && json.wall.proposalId === 'B');
const d2 = new DesignState({ original: false });
d2.load(JSON.stringify(json));
check('toJSON → load round trip is identical', JSON.stringify(d2.toJSON()) === JSON.stringify(json));
const d3 = new DesignState({ original: false });
d3.load({ items: [{ archetype: 'rug', dims: { w: 2 }, foo: 1, position: [1, 0] }], wall: { proposalId: 'C', bar: 2 }, env: { hour: 'x' }, unknown: true });
const rug = d3.list()[0];
check('tolerant load: unknown fields ignored, missing ones defaulted', d3.items.size === 1 && !('foo' in rug) && rug.dims.w === 2 && rug.dims.d === 0.5 && rug.position[2] === 0
  && rug.mount === 'rug' && d3.env.hour === 13 && d3.wall.proposalId === 'C' && !('bar' in d3.wall) && d3.meta.name === 'Uten navn');
let threw = false;
try {
  d3.load('{not json');
} catch (err) {
  threw = /gyldig/.test(err.message);
}
check('load of broken JSON throws a Norwegian error', threw);
// a design saved before add-lighting's lumen change keeps its dimmer/colour, but the existing lamp's lumens follow the room-spec
const old = new DesignState().toJSON();
const oldCh = old.items.find((i) => i.refId === 'f-pendel-stue');
oldCh.light = { ...oldCh.light, lumens: 2000, dimmer: 0.5, colorK: 3000 };
const d4 = new DesignState({ original: false });
d4.load(old);
const ch4 = d4.list().find((i) => i.refId === 'f-pendel-stue');
check('old save: existing lamp lumens from the room-spec, dimmer/colour kept', ch4.light.lumens === 800 && ch4.light.dimmer === 0.5 && ch4.light.colorK === 3000);
// an Oslo Wood placed before 2026-10-20 (drum shade) gets the tiltable cone; its other params and a set tilt stay
const osloOld = { ...catalog.productToItemSpec('nordicnest-northern-oslo-wood-gulvlampe'), position: [4, 0, 6] };
osloOld.params = { ...osloOld.params, shadeShape: 'drum', shadeH: 0.22, translucent: 0.42 };
delete osloOld.params.tilt;
delete osloOld.params.tiltable;
const d5 = new DesignState({ original: false });
d5.load({ items: [osloOld] });
const o5 = d5.list()[0];
const d6 = new DesignState({ original: false });
d6.load({ items: [{ ...osloOld, params: { ...o5.params, tilt: 40 } }] });
check('old save: Oslo Wood with a drum shade → tiltable cone (translucent kept), a cone keeps its tilt', o5.params.shadeShape === 'cone' && o5.params.shadeH === 0.3
  && o5.params.tilt === 15 && o5.params.tiltable === true && o5.params.translucent === 0.42 && d6.list()[0].params.tilt === 40);
d.resetToOriginal();
check('resetToOriginal (undoable)', d.items.size === originals.length && d.wall.proposalId === '0' && !Object.keys(d.windows).length && d.canUndo);
d.undo();
check('…undo brings the design back', d.wall.proposalId === 'B' && !!d.windows['win-s1'] && !!d.get(uid));

// ---------------------------------------------------------------------------------------------------------------
section('Acoustics');
const ac = await imp('src/design/Acoustics.js');
const orig = new DesignState();
const r0 = ac.computeAcoustics(orig, { layout });
console.log(`  original: RT60 ${r0.rt60.toFixed(3)} s, A ${r0.absorption.toFixed(2)} m², room ${r0.roomAbsorption.toFixed(2)} m², V ${r0.volume.toFixed(1)} m³`);
check('original design RT60 ≈ 0.86 s', near(r0.rt60, 0.86, 0.005), r0.rt60);
check('breakdown labels in Norwegian', r0.breakdown[0].label.startsWith('Rommet') && r0.breakdown.some((b) => b.label === 'Sofaer og stoler') && r0.label === 'Etterklang ≈ 0,86 s', r0.label);
orig.setWallProposal('B');
const rB = ac.computeAcoustics(orig, { layout });
check('proposal B lowers it to ≈ 0.68 s', near(rB.rt60, 0.68, 0.01), rB.rt60);
check('…and the change is listed', rB.changes.some((c) => c.label.startsWith('Veggforslag B') && near(c.m2, 7, 0.01)));
for (const code of ['E', 'A', 'C', 'N1', 'N19']) {
  orig.setWallProposal(code);
  const r = ac.computeAcoustics(orig, { layout });
  const expected = orig.proposal().rt60;
  check(`proposal ${code}: ${r.rt60.toFixed(3)} s ≈ research ${expected}`, near(r.rt60, expected, 0.015));
}
orig.setWallProposal('C');
const elementsSum = orig.wall.elements.reduce((s, e) => s + ac.elementAbsorption(e), 0);
check('element absorption matches sabineAdded (C curtain)', near(elementsSum, 5.5, 0.1), elementsSum);
orig.setWall({ elements: orig.wall.elements.map((e) => ({ ...e, w: e.w / 2 })) });
const rEdited = ac.computeAcoustics(orig, { layout });
check('edited wall uses Σ area × alpha (half curtain ≈ +2.8 m²)', orig.wall.edited && near(rEdited.absorption - r0.absorption, elementsSum / 2, 0.05));
orig.setWallProposal('0');
const sofa = orig.get('ex-f-hjornesofa');
orig.remove('ex-f-hjornesofa');
const rNoSofa = ac.computeAcoustics(orig, { layout });
check('removing the corner sofa raises RT60', rNoSofa.rt60 > r0.rt60 + 0.05 && rNoSofa.changes.some((c) => c.label === 'Fjernet: Hjørnesofa'));
orig.add(sofa);
const rugUid = orig.add({ ...catalog.productToItemSpec('bohus-frigg-teppe-200x290'), position: [5, 0, 5] });
const rRug = ac.computeAcoustics(orig, { layout });
check('adding a 200×290 rug adds its absorption (1.45 m²)', near(rRug.absorption - r0.absorption, 1.45, 0.01));
orig.update(rugUid, { dims: { w: 4, d: 2.9 } });
check('resizing a rug scales by footprint', near(ac.computeAcoustics(orig, { layout }).absorption - r0.absorption, 2.9, 0.01));
orig.remove(rugUid);
const curtain = catalog.productToShadingSpec('ikea-sanela-gardiner-1-par-140x250');
orig.setWindow('win-s2', { ...curtain, open: 0 });
const closed = ac.computeAcoustics(orig, { layout }).absorption - r0.absorption;
orig.setWindow('win-s2', { ...curtain, open: 1 });
const opened = ac.computeAcoustics(orig, { layout }).absorption - r0.absorption;
check(`curtains absorb by area and closedness (closed ${closed.toFixed(2)} m², open ${opened.toFixed(2)} m²)`, closed > 2 && closed < 3.5 && near(opened, closed * 0.4, 0.05));
orig.setWindow('win-s2', null);
check('back to the original → 0.86 s', near(ac.computeAcoustics(orig, { layout }).rt60, 0.86, 0.005));
const recl = catalog.products('lenestol').filter((p) => readJson('research/catalog-new/lenestol-ny.json').some((f) => f.id === p.id));
const reclAbs = recl.map((p) => ac.itemAbsorption(catalog.productToItemSpec(p)));
check(`new hvilestoler absorb 0.7–0.9 m² (${reclAbs.map((v) => v.toFixed(2)).join(', ')})`, recl.length === 5 && reclAbs.every((v) => v >= 0.7 - 1e-9 && v <= 0.9 + 1e-9));
// the 34 lenestoler of the second round: small lounge chairs ~0.5 m², big upholstered recliners up to 0.9 m²
const arm2 = fresh.filter((f) => f.category === 'lenestol' && !readJson('research/catalog-new/lenestol-ny.json').some((x) => x.id === f.id));
const arm2Abs = arm2.map((f) => ac.itemAbsorption(catalog.productToItemSpec(f.id)));
check(`${arm2.length} more lenestoler absorb 0.45–0.95 m² (min ${Math.min(...arm2Abs).toFixed(2)}, max ${Math.max(...arm2Abs).toFixed(2)})`, arm2.length === 34 && arm2Abs.every((v) => v >= 0.45 && v <= 0.95));
const vitAbs = catalog.products('vitrineskap').map((p) => ac.itemAbsorption(catalog.productToItemSpec(p)));
check('vitrineskap absorb ≈ 0 (also without catalogue data)', vitAbs.every((v) => v === 0) && ac.itemAbsorption({ archetype: 'display-cabinet', dims: { w: 0.9, d: 0.4, h: 1.8 } }) === 0);
const est = (footstool) => ac.itemAbsorption({ archetype: 'recliner', dims: { w: 0.8, d: 0.85, h: 1.05 }, params: { footstool } });
check(`recliner without data: estimate 0.7–0.9 m² (${est(true).toFixed(2)} / ${est(false).toFixed(2)})`, est(true) >= 0.7 && est(true) <= 0.95 && est(false) >= 0.7 && est(false) < est(true));
const zUid = orig.add({ ...catalog.productToItemSpec('bohus-castle-mark-zermatt-hvilestol-med-fotskammel'), position: [3.8, 0, 9.8] });
const rZ = ac.computeAcoustics(orig, { layout });
const vUid = orig.add({ ...catalog.productToItemSpec('bohus-sagene-vitrineskap-med-lys-90x40'), position: [5, 0, 1.5] });
const rV = ac.computeAcoustics(orig, { layout });
check(`adding Zermatt lowers RT60 (${r0.rt60.toFixed(3)} → ${rZ.rt60.toFixed(3)} s), a vitrine changes nothing`, near(rZ.absorption - r0.absorption, 0.9, 0.005) && rZ.rt60 < r0.rt60 - 0.01
  && near(rV.rt60, rZ.rt60, 1e-9) && rZ.changes.some((c) => c.label.startsWith('Lagt til: Zermatt')));
orig.remove(vUid);
orig.remove(zUid);

// ---------------------------------------------------------------------------------------------------------------
section('Saves');
const { Saves, STORAGE_KEY } = await imp('src/design/Saves.js');
const mem = new Map();
const storage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
const ds = new DesignState();
const saves = new Saves(ds, { storage, autosave: false });
ds.setWallProposal('P2');
check('save under a name', saves.save('Sjakkbrett') === 'Sjakkbrett' && mem.has(STORAGE_KEY));
check('list: Original first, then saved', saves.list()[0].name === 'Original' && saves.list()[1].name === 'Sjakkbrett' && saves.list()[1].active);
saves.loadOriginal();
check('load Original', ds.wall.proposalId === '0');
check('load saved design', saves.load('Sjakkbrett') && ds.wall.proposalId === 'P2' && ds.meta.name === 'Sjakkbrett');
check('«Original» is saved as a copy', saves.save('Original') === 'Original (kopi)');
check('rename', saves.rename('Original (kopi)', 'Kopi') === 'Kopi' && saves.has('Kopi') && !saves.has('Original (kopi)'));
check('remove', saves.remove('Kopi') && !saves.has('Kopi') && !saves.remove('Original'));
const text = saves.exportText();
const ds2 = new DesignState();
const saves2 = new Saves(ds2, { storage: { getItem: () => null, setItem: () => {}, removeItem: () => {} }, autosave: false });
check('export → import round trip', saves2.importText(text) && ds2.wall.proposalId === 'P2' && ds2.items.size === ds.items.size);
let importErr = '';
try {
  saves2.importText('{"hello":1}');
} catch (err) {
  importErr = err.message;
}
check('import of a non-design throws a Norwegian error', /Interiørspillet/.test(importErr), importErr);
const warn = console.warn;
console.warn = () => {};
const broken = new Saves(new DesignState(), { storage: { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); }, removeItem: () => {} }, autosave: false });
check('blocked storage does not throw', broken.save('X') === null && broken.list().length === 1 && !broken.available);
console.warn = warn;
saves.load('Sjakkbrett');
saves.enableAutosave();
ds.setPaint('w-hoy', '#55665b');
saves.autosaveNow();
check('autosave writes the active design', JSON.parse(mem.get(STORAGE_KEY)).designs.Sjakkbrett.paints['w-hoy'] === '#55665b');
saves.dispose();
check('fileName is ASCII-safe', saves.fileName('Høy vegg – røkt eik').startsWith('interiorspillet-hoy-vegg-rokt-eik-'));

// ---------------------------------------------------------------------------------------------------------------
console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
