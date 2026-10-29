#!/usr/bin/env node
/**
 * Node test for the data layer and the design model (no browser):
 *   node tools/test-design.mjs            (from the project root; exit code 1 on failure)
 *
 *   QA_PRINT_EXPECT=1 node tools/test-design.mjs   also prints the catalogue numbers as one `EXPECT {…}` line
 *
 * Checks: data files load (counts), catalogue normalisation (archetype, mount, part colours, materials, numbers),
 * the newest research round (research/catalog-new: prices, variant prices, notes, image URLs, the vitrineskap
 * category, the pendant-slatted / display-cabinet archetypes, re-running the normaliser reproduces the files),
 * layout derived values, existing furniture → items, DesignState (add/update/remove, undo/redo, transactions,
 * history limit, events, toJSON → load round trip, tolerant load, resetToOriginal), Acoustics (original ≈ 0.86 s,
 * proposal B ≈ 0.68 s, edits, rugs, shading) and Saves (with an in-memory storage).
 * Design version 2 (hele huset, steg 16): toJSON has version 2 and the original design holds every room's originals;
 * the rest (level-local y, originalRooms, specRevision, the v1 backup, acoustics per room) is tested in
 * tools/house-tests/design-v2.test.mjs.
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
// the catalogue before the møbler/lys/kunst round (c28070d; tools/house-tests/fixtures/make-catalog-baseline.mjs)
const BASE = readJson('tools/house-tests/fixtures/catalog-baseline.json');
// every catalogue number in one place: after a catalogue change paste the line `QA_PRINT_EXPECT=1 node tools/test-design.mjs`
// prints (runde 3 foundation: the 4 round-1 art frames Smått → Kunst og bilder, the 4 side tables Smått → Bord;
// runde 3 integration: + 225 research products from research/catalog-new/*-runde3*.json, 372 → 597; høy vegg runde 4:
// + the felt pendant and the Frigg ceiling plate, 597 → 599; Spesialkatalog 2026-10-29: + 2 lenestoler, 3 TV-benker,
// 2 lamper and 16 canvas pictures (Brown Balance replaced in place), 599 → 622)
const EXPECT = {
  counts: { sofa: 23, lenestol: 57, bord: 35, stoler: 30, skjenk: 14, tvbenk: 17, vitrineskap: 10, hylle: 22, seng: 20, nattbord: 22, kommode: 21, garderobe: 9, speil: 13, bad: 19, gang: 17, taklampe: 20, spotter: 37, smalamper: 63, tekstil: 31, teppe: 19, solskjerming: 22, akustikk: 33, kunst: 54, smatt: 14 },
  total: 622, floorLamps: 28, pendel: 19,
};
const spec = readJson('src/data/room-spec.json');
const palette = readJson('src/data/palette.json');
const walls = readJson('src/data/wall-proposals.json');
const schema = readJson('src/data/archetypes.json');
// hele huset: the living room's entries have no roomId (or 'stue-kjokken'); the other rooms add theirs with a roomId
const inStue = (e) => !e.roomId || e.roomId === 'stue-kjokken';
const stueWalls = spec.walls.filter(inStue).length;
const stueFurniture = spec.furniture.filter(inStue).length;
check('room-spec.json loads (the living room: 12 walls, 62 furniture)', stueWalls === 12 && stueFurniture === 62, `walls ${stueWalls}, furniture ${stueFurniture}`);
{
  // src/data/room-spec.json is generated (research/room-spec.json + research/house/NN-*.json + fixes.mjs, validated by
  // house.mjs): a fresh run must reproduce it byte for byte, and the generated «Målelista» in research/room-spec-notes.md
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'ip-spec-'));
  const res = spawnSync(process.execPath, [path.join(ROOT, 'src/data/scripts/normalize-data.mjs'), '--only=room-spec', `--out=${out}`], { cwd: ROOT, encoding: 'utf8' });
  const same = (a, b) => fs.existsSync(a) && fs.readFileSync(a, 'utf8') === fs.readFileSync(b, 'utf8');
  check('re-running the normaliser (room-spec + research/house + fixes, validated) reproduces src/data/room-spec.json and the measuring list exactly',
    res.status === 0 && same(path.join(out, 'room-spec.json'), path.join(ROOT, 'src/data/room-spec.json')) && same(path.join(out, 'room-spec-notes.md'), path.join(ROOT, 'research/room-spec-notes.md')),
    `${res.status} ${(res.stderr || '').slice(0, 300)}`);
  fs.rmSync(out, { recursive: true, force: true });
}
check('palette.json loads (walls sand + marrakesh)', palette.walls.sand.hex === '#cfc5b4' && palette.walls.marrakesh.hex === '#aea191');
check('wall-proposals.json: 73 proposals, existing first then N1…N52 (runde 3 = N20–N39, runde 4 = N40–N52)', walls.proposals.length === 73 && walls.proposals[0].id === '0' && walls.proposals[21].id === 'N1' && walls.proposals[39].id === 'N19' && walls.proposals[59].id === 'N39' && walls.proposals[72].id === 'N52',
  walls.proposals.map((p) => p.id).join(','));
{
  // the proposal browser's kinds (ui/wallCategories.js): every proposal has one, and the new round fills each kind
  const { classifyProposal, WALL_CATEGORIES } = await import(pathToFileURL(path.join(ROOT, 'src/ui/wallCategories.js')).href);
  const kinds = new Set(WALL_CATEGORIES.map((c) => c.id));
  const cls = Object.fromEntries(walls.proposals.map((p) => [p.id, classifyProposal(p)]));
  check('every wall proposal has a kind (spiler / filt / bilder / kombinert / diverse)', Object.values(cls).every((c) => kinds.has(c.category)));
  check('kinds: B spiler, N17 filt, N9 bilder, K kombinert, C diverse, N45 filtlameller under filt + spiler, N20 sekskanter',
    cls.B.category === 'spiler' && cls.N17.category === 'filt' && cls.N9.category === 'bilder' && cls.K.category === 'kombinert' && cls.C.category === 'diverse'
      && cls.N45.category === 'filt' && cls.N45.tags.includes('spiler') && cls.N20.tags.includes('sekskanter'),
    JSON.stringify({ B: cls.B, N17: cls.N17, N45: cls.N45 }));
  check('runde 4 (N40–N52): spiler, filt and kombinert, all marked «Ny»', ['spiler', 'filt', 'kombinert'].every((k) => walls.proposals.some((p) => /^N(4\d|5[0-2])$/.test(p.id) && cls[p.id].category === k))
    && walls.proposals.filter((p) => /^N(4\d|5[0-2])$/.test(p.id)).every((p) => p.badge === 'Ny'));
}
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
const CAT_LABELS = 'Sofaer|Lenestoler|Bord|Stoler og krakker|Skjenker|TV-benker|Vitrineskap|Hyller|Senger|Nattbord|Kommoder|Garderobeskap|Speil|Bad|Gang|Taklamper|Spotter og downlights|Små lamper|Puter, pledd og puffer|Tepper|Solskjerming|Akustikk|Kunst og bilder|Smått';
check('24 categories with Norwegian labels (the living room first, then bedroom, bath, hall, lamps, spots, textiles … art)', catalog.CATEGORIES.length === 24 && catalog.CATEGORIES.map((c) => c.label).join('|') === CAT_LABELS,
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
// the 3 mirrors moved to Speil) + 34 lenestoler (24 hvilestoler) from Bohus, Skeidar, Fagmøbler, Møbelringen, Jysk, IKEA and
// Mio; the numbers live in EXPECT (top of the file)
check(`counts per category – ${EXPECT.total} products`, catalog.CATEGORIES.length === Object.keys(EXPECT.counts).length
  && catalog.CATEGORIES.every((c) => counts[c.key] === EXPECT.counts[c.key]) && catalog.allProducts().length === EXPECT.total, JSON.stringify(counts));
const NEW_DIR = path.join(ROOT, 'research', 'catalog-new');
// KEEP (below) covers every research/catalog-new file – a new research file is protected the moment it lands …
const fresh = fs.readdirSync(NEW_DIR).filter((f) => f.endsWith('.json')).flatMap((f) => readJson(`research/catalog-new/${f}`));
// … while the count is pinned on the files that existed before this round (the fixture's list)
const freshBase = BASE.researchNewFiles.flatMap((f) => readJson(`research/catalog-new/${f}`));
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
check(`all ${fresh.length} new products kept: prices, sale prices, variant prices/urls, notes, image URLs, params (shape notes, profilePoints)`, freshBase.length === 212 && !freshProblems.length,
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
const FLOOR_VITRINES = ['bohus-sagene-vitrineskap-med-lys-90x40', 'bohus-scandi-vitrineskap-med-lys-60x40', 'bohus-belfort-vitrineskap-med-lys-120x40', 'bohus-signature-1860-vitrineskap-90x40'];
check('the four other vitrines stand on the floor; every vitrine stands on the floor or hangs on the wall', FLOOR_VITRINES.every((id) => catalog.getProduct(id)?.mount === 'floor')
  && catalog.products('vitrineskap').every((p) => p.mount === 'floor' || p.mount === 'wall'));
const secto = catalog.productToItemSpec('christiania-belysning-secto-design-octo-4240-taklampe-o54');
// a placed lamp starts at NEW_LAMP (2700 K, 40 %); the shop's 3000 K stays in the product facts
check('Secto/Octo pendants: ceiling, drop = the shop cable default, 806 lm (shop 3000 K, placed at NEW_LAMP), profilePoints kept', secto.mount === 'ceiling' && secto.params.drop === 1.2 && secto.light.lumens === 806
  && catalog.getProduct('christiania-belysning-secto-design-octo-4240-taklampe-o54').light.colorK === 3000
  && secto.light.colorK === catalog.NEW_LAMP.colorK && secto.light.dimmer === catalog.NEW_LAMP.dimmer
  && secto.params.profilePoints.length === 21 && secto.params.profilePoints[13][1] === 0.54);
const pendel = catalog.products('taklampe').filter((p) => p.subcategory === 'pendel').length;
check(`subcategories: every recliner «hvilestol» (34), every pendant «pendel» (${EXPECT.pendel})`, catalog.products('lenestol').filter((p) => p.subcategory === 'hvilestol').length === 34
  && catalog.products('lenestol').filter((p) => p.archetype === 'recliner').every((p) => p.subcategory === 'hvilestol')
  && pendel === EXPECT.pendel && catalog.SUBCATEGORY_LABELS.hvilestol === 'Hvilestoler');
check('search finds the new products', catalog.products('vitrineskap').every((p) => catalog.search('vitrineskap').includes(p)) && catalog.search('secto').length === 4 && catalog.search('hvilestol fotskammel').length >= 4
  && catalog.search('octo').length === 2, `vitrine ${catalog.search('vitrineskap').length}, secto ${catalog.search('secto').length}, octo ${catalog.search('octo').length}`);
const floorLamps = catalog.products('smalamper').filter((p) => p.subcategory === 'gulvlampe');
const oslo = catalog.productToItemSpec('nordicnest-northern-oslo-wood-gulvlampe');
check(`${EXPECT.floorLamps} gulvlamper on the floor (12 new: globe, reading, pleated, lantern, slats, cage, tripods); Oslo Wood = tiltable cone`, floorLamps.length === EXPECT.floorLamps
  && floorLamps.every((p) => p.mount === 'floor' && p.archetype.startsWith('floor-'))
  && new Set(floorLamps.map((p) => p.params?.shadeShape || p.params?.armShape || p.archetype)).size >= 12
  && oslo.params.shadeShape === 'cone' && oslo.params.tilt === 15 && oslo.params.tiltable === true && oslo.params.shadeBottomD === 0.13,
  `${floorLamps.length} floor lamps`);
if (process.env.QA_PRINT_EXPECT === '1') console.log(`EXPECT ${JSON.stringify({ counts, total: catalog.allProducts().length, floorLamps: floorLamps.length, pendel })}`);
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
  && catalog.categoryLabel('sofa') === 'Sofaer' && catalog.categoryLabel('stoler') === 'Stoler og krakker' && catalog.categoryLabel('elektronikk') === 'TV og lyd');
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
// runde 3 (foundation): the round-1 art and side tables left Smått; the 8 existing chairs are «spisestol»
// Mara: brush-abstract 'horizon' since the runde-3 review (its Bohus photo shows horizontal streaks, not a plaster relief)
const ART_MOVED = { 'bohus-ramor-canvas-bilde-90x120': 'brush-abstract', 'bohus-holmen-mara-canvas-bilde-120x60': 'brush-abstract',
  'bohus-holmen-gustin-strukturbilde-80x100': 'texture-plaster', 'bohus-labyrint-strukturbilde-80x120': 'texture-plaster' };
check('the four round-1 pictures moved from Smått to Kunst og bilder → Lerret (own motif, seed, palette with the print colour second)', Object.entries(ART_MOVED).every(([id, motif]) => {
  const p = catalog.getProduct(id);
  return p?.category === 'kunst' && p.subcategory === 'lerret' && p.archetype === 'art-frame' && p.params.motif === motif && Number.isInteger(p.params.seed)
    && p.params.palette?.[1] === p.variants[0].colors.print && !('w' in p.params) && !('h' in p.params) && !('orientation' in p.params);
}), Object.keys(ART_MOVED).map((id) => `${id}: ${catalog.getProduct(id)?.category}/${catalog.getProduct(id)?.subcategory}`).join(' | '));
const SIDE_MOVED = ['bohus-duett-sidebord-sett-o49', 'bohus-basoon-sidebord-o45', 'bohus-sindig-berg-sidebord-o40', 'bohus-seaford-sidebord-35x43'];
check('the four round-1 side tables moved from Smått to Bord → Sidebord', SIDE_MOVED.every((id) => catalog.getProduct(id)?.category === 'bord' && catalog.getProduct(id).subcategory === 'sidebord'));
check('nothing of art-frame / side-table-* left in Smått', !catalog.products('smatt').some((p) => p.archetype === 'art-frame' || p.archetype.startsWith('side-table-')),
  catalog.products('smatt').filter((p) => p.archetype === 'art-frame' || p.archetype.startsWith('side-table-')).map((p) => p.id).join(','));
check('the 8 existing chairs are in Stoler og krakker → Spisestoler', ['bohus-alice-spisestol'].every((id) => catalog.getProduct(id)?.subcategory === 'spisestol')
  && freshBase.filter((p) => p.category === 'stoler').every((p) => catalog.getProduct(p.id)?.subcategory === 'spisestol')
  && freshBase.filter((p) => p.category === 'stoler').length === 8 && catalog.SUBCATEGORY_LABELS.spisestol === 'Spisestoler');
const noLabel = [...new Set(catalog.allProducts().map((p) => p.subcategory).filter((sub) => sub && !catalog.SUBCATEGORY_LABELS[sub]))];
check('every product subcategory has a label (SUBCATEGORY_LABELS)', !noLabel.length, noLabel.join(','));
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
check('every room-spec furniture entry → item (decor group split into 5)', originals.length === stueFurniture - 1 + 5, originals.length);
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
// hele huset (steg 16): the original design holds the original furniture of every room – the living room's first
const HOUSE = d.originalJSON().items.length;
check('starts with the original design and no history (the living room first, then the other rooms)', d.items.size === HOUSE && HOUSE > originals.length
  && originals.every((o, i) => [...d.items.keys()][i] === o.uid) && !d.canUndo && d.wall.proposalId === '0', `${d.items.size} items, ${originals.length} in the living room`);
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
check('remove', !d.get(uid) && d.items.size === HOUSE);
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
check('toJSON has version 2 (level-local y, originalRooms)', json.version === 2 && Array.isArray(json.items) && json.wall.proposalId === 'B'
  && json.items.every((it) => typeof it.level === 'string') && json.meta.originalRooms.includes('stue-kjokken'));
const d2 = new DesignState({ original: false });
d2.load(JSON.stringify(json));
check('toJSON → load round trip is identical', JSON.stringify(d2.toJSON()) === JSON.stringify(json));
const d3 = new DesignState({ original: false });
d3.load({ items: [{ archetype: 'rug', dims: { w: 2 }, foo: 1, position: [1, 0] }], wall: { proposalId: 'C', bar: 2 }, env: { hour: 'x' }, unknown: true });
const rug = d3.list()[0];
// (no meta.originalRooms = a version 1 design: the rest of the house's originals are added after the saved items)
check('tolerant load: unknown fields ignored, missing ones defaulted', d3.items.size === 1 + HOUSE - originals.length && d3.list().filter((it) => it.source !== 'existing').length === 1 && !('foo' in rug) && rug.dims.w === 2 && rug.dims.d === 0.5 && rug.position[2] === 0
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
check('resetToOriginal (undoable)', d.items.size === HOUSE && d.wall.proposalId === '0' && !Object.keys(d.windows).length && d.canUndo);
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
check(`${arm2.length} more lenestoler absorb 0.45–0.95 m² (min ${Math.min(...arm2Abs).toFixed(2)}, max ${Math.max(...arm2Abs).toFixed(2)})`, arm2.length === 36 && arm2Abs.every((v) => v >= 0.45 && v <= 0.95));
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
section('Slat finishes (spiler på vegger og tak)');
const F = await imp('src/design/Finishes.js');
check('surface kinds: walls and ceilings; the high wall and the bulkheads get none', F.surfaceKind(layout, 'w-sor') === 'wall' && F.surfaceKind(layout, 'c-stue') === 'ceiling'
  && F.surfaceKind(layout, 'c-bad') === 'ceiling' && F.surfaceKind(layout, 'w-gang-ost') === 'wall' && F.surfaceKind(layout, 'w-hoy') === null && F.surfaceKind(layout, 'b-tvstue') === null);
const fd = new DesignState();
const fn0 = fd.historySize;
fd.setFinish('c-stue', { type: 'slats', look: 'oak' });
fd.setFinish('w-sor', { type: 'slats', look: 'walnut', slatW: 9, extent: 'section', u: 1, w: 2, h: 1.6, direction: 'across' });
check('setFinish normalises per kind (a wall: extent/u/w/h, a ceiling: direction; numbers clamped)', fd.finishes['c-stue'].direction === 'along' && !('extent' in fd.finishes['c-stue'])
  && fd.finishes['w-sor'].extent === 'section' && fd.finishes['w-sor'].h === 1.6 && fd.finishes['w-sor'].slatW === 0.12 && !('direction' in fd.finishes['w-sor']));
fd.setFinish('w-hoy', { type: 'slats' });
fd.setFinish('w-finnes-ikke', { type: 'slats' });
check('no finish on the high wall or an unknown surface', !fd.finishes['w-hoy'] && !fd.finishes['w-finnes-ikke']);
check('each setFinish is one undo step', fd.historySize === fn0 + 2 && fd.undoLabel === 'Legg inn spiler', `${fd.historySize - fn0} ${fd.undoLabel}`);
fd.setFinish('w-sor', { ...fd.finishes['w-sor'], gap: 0.02 }, { coalesce: 'gap' });
fd.setFinish('w-sor', { ...fd.finishes['w-sor'], gap: 0.025 }, { coalesce: 'gap' });
check('a slider drag (same coalesce key) is one step', fd.historySize === fn0 + 3 && fd.finishes['w-sor'].gap === 0.025 && fd.undoLabel === 'Endre spiler');
fd.undo();
check('undo restores the finish from before the drag', fd.finishes['w-sor'].gap === 0.013);
fd.redo();
let fev = null;
const offFev = fd.on('finish', (e) => (fev = e));
fd.setFinish('c-stue', null);
offFev();
check("removing emits 'finish' with spec null", fev?.surfaceId === 'c-stue' && fev.spec === null && !fd.finishes['c-stue']);
fd.undo();
check('undo brings the ceiling slats back', fd.finishes['c-stue']?.look === 'oak');
const fj = fd.toJSON();
const fd2 = new DesignState({ original: false });
fd2.load(JSON.stringify(fj));
check('toJSON → load keeps the finishes', JSON.stringify(fd2.finishes) === JSON.stringify(fd.finishes) && JSON.stringify(fd2.toJSON().finishes) === JSON.stringify(fj.finishes));
const { finishes: _noFinishes, ...fjOld } = fj;
const fd3 = new DesignState();
fd3.load(fjOld);
check('a design saved before the finishes loads with none', JSON.stringify(fd3.finishes) === '{}' && fd3.items.size === fd.items.size);
fd3.load({ ...fj, finishes: { 'w-hoy': { type: 'slats' }, 'w-x': { type: 'slats' }, 'c-bad': { look: 'nope', slatW: 'x' } } });
check('loading drops finishes on unknown surfaces / the high wall and fixes bad values', Object.keys(fd3.finishes).join() === 'c-bad' && fd3.finishes['c-bad'].look === 'oak' && fd3.finishes['c-bad'].slatW === 0.027);
fd3.load(fj);
fd3.load(new DesignState().originalJSON(), { keepHistory: true });
check('a load step (Original) removes the finishes, undo brings them back', !Object.keys(fd3.finishes).length && fd3.undo() && fd3.finishes['w-sor']?.look === 'walnut');
const savesF = new (await imp('src/design/Saves.js')).Saves(new DesignState(), { storage: null, autosave: false });
check('a design with only slats counts as work (Forrige økt)', savesF.isWork({ ...new DesignState().toJSON(), finishes: { 'c-stue': fd.finishes['c-stue'] } }) && !savesF.isWork(new DesignState().toJSON()));

// geometry: windows / doors stay free, slopes are followed, lamps are cut around
const rSor = F.finishRegion(layout, 'w-sor', F.defaultFinish('wall'));
const lSor = F.slatLayout(rSor);
const sorHoles = layout.wallsById['w-sor'].holes;
const overHole = lSor.slats.some((s) => s.runs.some(([a, b]) => sorHoles.some((o) => s.c + rSor.slatW / 2 > o.u0 && s.c - rSor.slatW / 2 < o.u1 && b > o.sill + 1e-3 && a < o.top)));
check(`w-sor: ${lSor.slats.length} slats, none over a window or the terrace door`, lSor.slats.length > 100 && !overHole);
const rVest = F.finishRegion(layout, 'w-vest-stue', F.defaultFinish('wall'));
const lVest = F.slatLayout(rVest);
const wVest = layout.wallsById['w-vest-stue'];
const slopeOk = lVest.slats.every((s) => {
  const top = s.runs[s.runs.length - 1][1];
  const under = Math.min(wVest.heightAt(s.c - rVest.slatW / 2), wVest.heightAt(s.c + rVest.slatW / 2));
  return top <= under && top > under - 0.02;
});
check(`w-vest-stue: ${lVest.slats.length} slats follow the sloped top (2.40 → 3.00 m) within 2 cm`, lVest.slats.length > 80 && slopeOk);
const rSec = F.finishRegion(layout, 'w-sor', fd.finishes['w-sor']);
const lSec = F.slatLayout(rSec);
check('a section: within u 1–3 m and under 1.60 m', lSec.slats.every((s) => s.c > 1 && s.c < 3 && s.runs.every(([, b]) => b <= 1.6 + 1e-9)));
const rCeil = F.finishRegion(layout, 'c-stue', F.defaultFinish('ceiling'));
const lCeil = F.slatLayout(rCeil);
const cStue = layout.ceilings.find((c) => c.id === 'c-stue');
const fr = rCeil.frame;
const world = (x, y, z) => [0, 1, 2].map((i) => fr.origin[i] + fr.x[i] * x + fr.y[i] * y + fr.z[i] * z);
const followsSlope = lCeil.slats.every((s) => s.runs.every(([a, b]) => [a, b].every((x) => {
  const p = world(x, s.c, rCeil.base + rCeil.depth);
  const gap = cStue.topAt(p[0], p[2]) - p[1];
  return gap > 0.015 && gap < 0.03;
})));
check(`c-stue: ${lCeil.slats.length} slats in the sloped ceiling plane (face 1.5–3 cm under it everywhere)`, lCeil.slats.length > 60 && followsSlope && Math.abs(fr.z[1]) < 0.999);
const spotsFree = layout.builtInLights.filter((l) => l.type === 'spot').every((l) => {
  const P = [l.position.x - fr.origin[0], cStue.topAt(l.position.x, l.position.z) - fr.origin[1], l.position.z - fr.origin[2]];
  const lx = P[0] * fr.x[0] + P[1] * fr.x[1] + P[2] * fr.x[2];
  const ly = P[0] * fr.y[0] + P[1] * fr.y[1] + P[2] * fr.y[2];
  return !lCeil.slats.some((s) => Math.abs(s.c - ly) < rCeil.slatW / 2 && s.runs.some(([a, b]) => lx > a && lx < b));
});
check('c-stue: the spots at the high wall are cut around', spotsFree && rCeil.holes.length >= 5);

// acoustics: felt-backed slats absorb like the high wall's slats (0.76), straight on the surface nothing
const fa = new DesignState();
const ra0 = ac.computeAcoustics(fa, { layout });
fa.setFinish('c-stue', { type: 'slats' });
const raC = ac.computeAcoustics(fa, { layout });
const areaC = F.finishArea(layout, 'c-stue', fa.finishes['c-stue']);
check(`ceiling slats on felt: +${(raC.absorption - ra0.absorption).toFixed(2)} m² (${areaC.toFixed(1)} m² × 0.76), RT60 ${ra0.rt60.toFixed(2)} → ${raC.rt60.toFixed(2)} s`,
  near(raC.absorption - ra0.absorption, areaC * 0.76, 1e-6) && areaC > 25 && areaC < 34 && raC.rt60 < 0.55 && raC.changes.some((c) => c.label.startsWith('Spiler: Skråtak')) && raC.breakdown.some((b) => b.label === 'Spiler på vegger og tak'));
fa.setFinish('c-stue', { type: 'slats', backing: 'none' });
check('slats without felt add nothing', near(ac.computeAcoustics(fa, { layout }).rt60, ra0.rt60, 1e-9));
fa.setFinish('c-stue', null);
fa.setFinish('c-bad', { type: 'slats' });
check('the bathroom ceiling counts in the bathroom, not the living room', near(ac.computeAcoustics(fa, { layout }).rt60, 0.86, 0.005)
  && ac.computeAcoustics(fa, { layout }, { roomId: 'bad' }).rt60 < ac.computeAcoustics(new DesignState(), { layout }, { roomId: 'bad' }).rt60 - 0.05);

// ---------------------------------------------------------------------------------------------------------------
section('Spesialforslag (design/specialProposals.js)');
{
  const SP = await imp('src/design/specialProposals.js');
  const hw = layout.highWall;
  check('20 special proposals, ids S1–S20', SP.SPECIAL_PROPOSALS.length === 20 && SP.SPECIAL_PROPOSALS.every((p, i) => p.id === `S${i + 1}`));
  const bad = [];
  for (const p of SP.SPECIAL_PROPOSALS) {
    const L = SP.layoutSpecialProposal(p, catalog);
    const pics = L.filter((e) => e.role === 'picture');
    const bench = L.find((e) => e.role === 'bench');
    const decor = L.filter((e) => e.role === 'decor');
    const inWall = L.every((e) => e.u - e.w / 2 >= 0.05 && e.u + e.w / 2 <= hw.width - 0.3);
    const overBench = pics.every((e) => e.v >= bench.v + bench.h + 0.2 && e.v + e.h <= hw.height - 0.25);
    const apart = pics.every((e, i) => i === 0 || pics[i - 1].u + pics[i - 1].w / 2 < e.u - e.w / 2);
    const onBench = decor.every((e) => Math.abs(e.u - bench.u) + e.w / 2 <= bench.w / 2 + 1e-6 && near(e.v, bench.v + bench.h, 1e-6));
    const ok = pics.length >= 1 && pics.length <= 3 && decor.length >= 1 && inWall && overBench && apart && onBench
      && pics.every((e) => catalog.getProduct(e.productId)?.archetype === 'acoustic-art');
    if (!ok) bad.push(p.id);
  }
  check('every proposal: one sideboard, 1–3 pictures over it, decor on it, all inside the wall (clear of the door switches)', !bad.length, bad.join(', '));
  const sd = new DesignState();
  const fakeEditor = { design: sd, catalog, home: { layout } };
  sd.add({ ...catalog.productToItemSpec('canvasbutik-lyddempende-bilde-soft-leaves', 2), uid: 'egen', position: [3.22, 1.5, 6.4], rotationDeg: 90, attach: { wallId: 'w-hoy', normal: [1, 0, 0] } });
  const h0 = sd.historySize;
  const u1 = SP.applySpecialProposal(fakeEditor, 'S4');
  const u2 = SP.applySpecialProposal(fakeEditor, 'S2');
  const spf = sd.list().filter((i) => SP.isSpecialUid(i.uid));
  check('applying replaces what hangs on the high wall and the previous proposal; one undo step each', u1.length === 6 && u2.length === 4 && spf.length === 4 && !sd.get('egen')
    && SP.activeSpecialProposal(sd) === 'S2' && sd.historySize === h0 + 2, `${u1.length}/${u2.length}/${spf.length}/${sd.historySize - h0}`);
  const pic = spf.find((i) => i.archetype === 'acoustic-art');
  check('the pictures hang on the high wall (attach w-hoy, facing the room) with their size variant', pic?.attach?.wallId === 'w-hoy' && pic.rotationDeg === 90 && pic.variantIndex === 4 && near(pic.dims.h, 1.8, 1e-9));
  sd.undo();
  check('undo brings S4 back', SP.activeSpecialProposal(sd) === 'S4' && sd.list().filter((i) => SP.isSpecialUid(i.uid)).length === 6);
}

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
