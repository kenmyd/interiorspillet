#!/usr/bin/env node
/**
 * The round's catalogue (design/qa.md §3.4; MASTER §2.1, §4.3, D36, D43, D45, D46, D50):
 *   A «Forskningsfiler»  every research file of the round (research/runde3/*.json and the research/catalog-new files that
 *                        are not in the c28070d list) through tools/check-research.mjs (the rules library, the
 *                        normaliser in a temp folder, duplicates): info lines under QA_PARTIAL=1, 0 FAIL at integration
 *   B «Mål for runden»   MASTER §4.3 minimums over the new products (the catalogue's + research/runde3 products not
 *                        promoted yet): totals, subcategories, spotter roles, kunst variety, new types, stores, every
 *                        new archetype used, bildebelysning ≥ 2 (hard unless WAIVERS – D43). Soft under QA_PARTIAL=1
 *   C «Katalogen»        strict: labels for every subcategory, the moved art, search hits (soft under QA_PARTIAL),
 *                        spotter specs, the tidy house (81 original items, nothing auto-inserted), mountsCompatible,
 *                        category hints, D46 tidy shelves
 *
 *   node tools/house-tests/catalog-round.test.mjs                full run
 *   node tools/house-tests/catalog-round.test.mjs --file=<f>     lint one research file (section A only, strict)
 */
const L = await import(new URL(import.meta.dirname.endsWith('wip') ? '../_lib.mjs' : './_lib.mjs', import.meta.url));
const { ROOT, imp, check, section, done } = L;
const Q = await import(new URL(import.meta.dirname.endsWith('wip') ? '../_qa.mjs' : './_qa.mjs', import.meta.url));
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

Q.cssHook();
const args = process.argv.slice(2);
const FILE = (args.find((a) => a.startsWith('--file=')) || '').slice(7) || null;
const show = (list, n = 6) => (list.length ? `${list.slice(0, n).join(' | ')}${list.length > n ? ` | … (${list.length})` : ''}` : '');
const CR = await import(pathToFileURL(path.join(ROOT, 'tools', 'check-research.mjs')).href);
const RUNDE3 = path.join(ROOT, 'research', 'runde3');
const CATALOG_NEW = path.join(ROOT, 'research', 'catalog-new');
const listJson = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.json')).sort() : []);
// the round's files: not the pre-round ones, not the ones added after the round (research-rules AFTER_ROUND_FILES)
const { AFTER_ROUND_FILES } = await import(pathToFileURL(path.join(ROOT, 'tools', 'lib', 'research-rules.mjs')).href);
const baseFiles = new Set([...Q.BASE.researchNewFiles, ...AFTER_ROUND_FILES].map((f) => f.toLowerCase()));

// ---------------------------------------------------------------------------------------------------------------
section(`A Forskningsfiler${FILE ? ` (${FILE})` : ''}`);
{
  const files = FILE ? [FILE] : [
    ...listJson(RUNDE3).map((f) => path.join(RUNDE3, f)),
    ...listJson(CATALOG_NEW).filter((f) => !baseFiles.has(f.toLowerCase())).map((f) => path.join(CATALOG_NEW, f)),
  ];
  if (!files.length) {
    Q.soft('rundens forskningsfiler finnes', false, 'ingen filer i research/runde3 eller nye filer i research/catalog-new ennå');
  } else {
    let res = null;
    try {
      res = await CR.checkResearch(files, { cwd: ROOT, strict: true });
    } catch (e) {
      check('check-research kjører', false, String(e.message).split('\n')[0]);
    }
    if (res) {
      const strictA = !!FILE || !Q.PARTIAL;
      for (const r of res.files) {
        const fails = [...r.findings.filter((f) => f.level === 'FAIL').map((f) => `[${f.rule}] ${f.msg}`),
          ...r.products.flatMap((p) => p.findings.filter((f) => f.level === 'FAIL').map((f) => `${p.id} [${f.rule}] ${f.msg.slice(0, 140)}`))];
        const warns = r.products.reduce((n, p) => n + p.findings.filter((f) => f.level === 'WARN').length, 0);
        const name = `${r.rel}: ${r.products.length} produkter uten FAIL (${warns} WARN)`;
        if (strictA) check(name, !fails.length, show(fails, 4));
        else if (fails.length) console.log(`  info ${name.replace(' uten FAIL', '')} – ${fails.length} FAIL (QA_PARTIAL: bare info): ${show(fails, 3)}`);
        else check(name, true);
      }
    }
  }
  if (FILE) done();
}

// ---------------------------------------------------------------------------------------------------------------
const cat = await imp('src/catalog/index.js');
const reg = await imp('src/models/registry.js');
const BASE_IDS = new Set(Object.values(Q.BASE.products).flat());
const inCatalogue = new Set(cat.allProducts().map((p) => p.id));
/** New products: the catalogue's (not in c28070d) + research/runde3 products not promoted yet (raw, as written). */
const fresh = [
  ...cat.allProducts().filter((p) => !BASE_IDS.has(p.id)).map((p) => ({ ...p, _from: 'katalogen' })),
  ...listJson(RUNDE3).flatMap((f) => {
    try {
      const list = JSON.parse(fs.readFileSync(path.join(RUNDE3, f), 'utf8').replace(/^﻿/, ''));
      return Array.isArray(list) ? list.filter((p) => p && typeof p.id === 'string' && !inCatalogue.has(p.id)).map((p) => ({ ...p, _from: `runde3/${f}` })) : [];
    } catch {
      return []; // a broken file is section A's business
    }
  }),
];
const sub = (p) => p.subcategory ?? '-';
const count = (fn) => fresh.filter(fn).length;
const isBohus = (p) => /^bohus$/i.test(String(p.store || '').trim());

section(`B Mål for runden (${fresh.length} nye produkter: ${fresh.filter((p) => p._from === 'katalogen').length} i katalogen, ${fresh.filter((p) => p._from !== 'katalogen').length} i research/runde3)`);
{
  const waived = (key) => {
    const w = Q.WAIVERS[key];
    if (w) console.log(`  info «${key}» er frafalt av integratoren: ${w}`);
    return !!w;
  };
  const total = (k) => Q.BASE.counts[k] ?? 0;
  const now = (k) => (cat.products(k).length) + fresh.filter((p) => p._from !== 'katalogen' && p.category === k).length;
  // final totals (§4.3; «doubling» rows are hard minimums) – catalogue + not yet promoted research
  const TOTALS = { sofa: 22, stoler: 23, bord: 28, tvbenk: 14, vitrineskap: 10, hylle: 22, kommode: 20, nattbord: 20, spotter: 30, kunst: 40, smalamper: 52 };
  for (const [k, min] of Object.entries(TOTALS)) Q.soft(`${k}: minst ${min} (før runden ${total(k)})`, now(k) >= min, `har ${now(k)}`);
  // per package minimums (§4.3 «min»)
  const SUBS = [
    ['sofa', null, 11], ['bord', 'sofabord', 5], ['bord', 'sidebord', 3], ['bord', 'skrivebord', 3],
    ['stoler', 'spisestol', 6], ['stoler', 'barkrakk', 3], ['stoler', 'krakk', 1], ['stoler', 'kontorstol', 3], ['stoler', 'spisebenk', 1],
    ['tekstil', 'puff', 5], ['gang', 'benk', 2], ['tvbenk', null, 7], ['vitrineskap', null, 5], ['hylle', 'bokhylle', 7], ['hylle', 'vegghylle', 4],
    ['kommode', null, 10], ['nattbord', null, 10], ['smalamper', 'bordlampe', 4], ['smalamper', 'arbeidslampe', 2], ['smalamper', 'gulvlampe', 3],
    ['smalamper', 'vegglampe', 6], ['spotter', 'innfelt', 11], ['spotter', 'utenpaliggende', 5], ['spotter', 'takspot', 5], ['spotter', 'skinne', 4],
    ['spotter', 'veggspot', 3], ['kunst', null, 36],
  ];
  for (const [c, s, min] of SUBS) {
    const n = count((p) => p.category === c && (!s || p.subcategory === s));
    Q.soft(`nye ${c}${s ? `/${s}` : ''}: minst ${min}`, n >= min, `har ${n}`);
  }
  const benches = count((p) => (p.category === 'gang' && p.subcategory === 'benk') || (p.category === 'stoler' && p.subcategory === 'spisebenk'));
  Q.soft('spisebenk + gangbenk: minst 3', benches >= 3, `har ${benches}`);
  // new types: ≥ 3 new products each (qa §3.4 B)
  for (const [c, s] of [['bord', 'sofabord'], ['bord', 'sidebord'], ['stoler', 'spisestol'], ['bord', 'skrivebord'], ['stoler', 'kontorstol'], ['stoler', 'barkrakk'], ['tekstil', 'puff'], ['smalamper', 'bordlampe'], ['smalamper', 'gulvlampe'], ['smalamper', 'vegglampe']]) {
    const n = count((p) => p.category === c && p.subcategory === s);
    Q.soft(`ny type ${s}: minst 3 nye`, n >= 3, `har ${n}`);
  }
  const benk = count((p) => p.archetype === 'bench');
  Q.soft('ny type benk: minst 3 nye', benk >= 3, `har ${benk}`);
  // spotter roles (§4.3 RF)
  const sp = fresh.filter((p) => p.category === 'spotter');
  const P = (p) => p.params || {};
  const roles = [
    ['innfelt rund fast ≥ 4', (p) => p.archetype === 'downlight' && P(p).shape !== 'square' && !P(p).tiltable, 4],
    ['innfelt rund fast med IP44 ≥ 1', (p) => p.archetype === 'downlight' && P(p).shape !== 'square' && !P(p).tiltable && Number(P(p).ip) >= 44, 1],
    ['innfelt rund vippbar ≥ 3', (p) => p.archetype === 'downlight' && P(p).shape !== 'square' && P(p).tiltable === true, 3],
    ['innfelt firkantet ≥ 2', (p) => p.archetype === 'downlight' && P(p).shape === 'square', 2],
    ['innfelt i pakke ≥ 1', (p) => p.archetype === 'downlight' && Number(p.packSize) > 1, 1],
    ['takspot enkel (spot-ceiling) ≥ 2', (p) => p.archetype === 'spot-ceiling', 2],
    ['takspot plate/stang (spot-track) ≥ 2', (p) => p.subcategory === 'takspot' && p.archetype === 'spot-track' && ['plate', 'bar'].includes(P(p).railKind), 2],
    ['skinne med 3–4 hoder ≥ 2', (p) => p.subcategory === 'skinne' && (P(p).heads ?? 3) >= 3 && (P(p).heads ?? 3) <= 4, 2],
  ];
  for (const [name, fn, min] of roles) Q.soft(`spotter: ${name}`, sp.filter(fn).length >= min, `har ${sp.filter(fn).length}`);
  const pl = sp.filter((p) => p.archetype === 'picture-light').length;
  if (!waived('bildebelysning>=2')) Q.soft('bildebelysning: minst 2 (D43 – hard minimum)', pl >= 2, `har ${pl}`);
  const spStores = new Set(sp.map((p) => String(p.store || '')));
  Q.soft('spotter: Elektroimportøren eller Lampehuset er med', [...spStores].some((s) => /elektroimport|lampehuset/i.test(s)), [...spStores].join(', ') || 'ingen spotter');
  for (const [store, min] of [['Elektroimportøren', 7], ['Lampehuset', 5], ['Bohus', 6], ['IKEA', 3]]) {
    const n = sp.filter((p) => String(p.store || '').toLowerCase() === store.toLowerCase()).length;
    if (sp.length && n < min) console.log(`  merk spotter fra ${store}: ${n} (mål ${min})`);
  }
  // kunst variety (§4.3 RG, qa §3.4 B)
  const art = fresh.filter((p) => p.category === 'kunst');
  const motifs = new Set(art.flatMap((p) => [P(p).motif, ...(P(p).motifs || []).map((m) => m?.motif), ...(P(p).frames || []).map((m) => m?.motif)]).filter((m) => m && m !== 'custom'));
  const pairs = new Set(art.filter((p) => P(p).motif && P(p).motif !== 'custom').map((p) => `${P(p).motif}|${P(p).seed ?? 1}`));
  const frames = new Set(art.map((p) => P(p).frame).filter(Boolean));
  const longSides = art.map((p) => Math.max(p.dims?.w ?? 0, p.dims?.h ?? 0)).filter((v) => v > 0);
  const ar = (p) => (p.dims?.w ?? 1) / (p.dims?.h ?? 1);
  const orient = { portrett: art.some((p) => ar(p) < 0.9), landskap: art.some((p) => ar(p) > 1.1 && ar(p) < 2), kvadrat: art.some((p) => ar(p) >= 0.9 && ar(p) <= 1.1), panorama: art.some((p) => ar(p) >= 2) };
  Q.soft('kunst: minst 20 ulike motiver', motifs.size >= 20, `har ${motifs.size}`);
  Q.soft('kunst: minst 30 ulike (motiv, seed)', pairs.size >= 30, `har ${pairs.size}`);
  Q.soft('kunst: minst 3 rammetyper', frames.size >= 3, `har ${[...frames].join(', ') || 'ingen'}`);
  Q.soft('kunst: minst 2 bildevegger/sett', art.filter((p) => p.archetype === 'art-set').length >= 2, `har ${art.filter((p) => p.archetype === 'art-set').length}`);
  Q.soft('kunst: minst 5 rammer (tomme, acceptsImage)', art.filter((p) => p.subcategory === 'ramme').length >= 5, `har ${art.filter((p) => p.subcategory === 'ramme').length}`);
  Q.soft('kunst: minste langside ≤ 0,35 m og største ≥ 1,2 m', longSides.length && Math.min(...longSides) <= 0.35 && Math.max(...longSides) >= 1.2, longSides.length ? `${Math.min(...longSides)}–${Math.max(...longSides)} m` : 'ingen');
  Q.soft('kunst: portrett, landskap, kvadrat og panorama', Object.values(orient).every(Boolean), Object.entries(orient).filter(([, v]) => !v).map(([k]) => `mangler ${k}`).join(', '));
  // stores among the new products
  const stores = new Set(fresh.map((p) => String(p.store || '?')));
  const bohus = fresh.filter(isBohus).length;
  Q.soft('Bohus minst 35 % av de nye produktene', fresh.length && bohus / fresh.length >= 0.35, `${bohus} av ${fresh.length}`);
  Q.soft('minst 5 butikker blant de nye produktene', stores.size >= 5, [...stores].join(', '));
  for (const [c, s] of [['sofa'], ['stoler'], ['bord'], ['tvbenk'], ['vitrineskap'], ['hylle'], ['kommode'], ['nattbord'], ['tekstil', 'puff'], ['gang', 'benk']]) {
    const list = fresh.filter((p) => p.category === c && (!s || p.subcategory === s));
    if (list.length && list.filter(isBohus).length / list.length < 0.5) console.log(`  merk ${c}${s ? `/${s}` : ''}: Bohus ${list.filter(isBohus).length} av ${list.length} (under 50 %)`);
  }
  // every new archetype used (D43), RB ≥ 1 shell-chair
  const used = new Set(fresh.map((p) => p.archetype));
  const unused = Q.NEW_ARCHETYPES.filter((a) => !used.has(a) && !waived(`${a} brukt`));
  Q.soft('hver ny arketype brukes av minst ett produkt', !unused.length, `ubrukt: ${unused.join(', ')}`);
}

// ---------------------------------------------------------------------------------------------------------------
section('C Katalogen');
{
  const all = cat.allProducts();
  const noLabel = [...new Set(all.filter((p) => p.subcategory && !cat.SUBCATEGORY_LABELS[p.subcategory]).map((p) => `${p.category}/${p.subcategory}`))];
  check('hver underkategori har en etikett (SUBCATEGORY_LABELS)', !noLabel.length, noLabel.join(', '));
  const moved = ['bohus-holmen-gustin-strukturbilde-80x100', 'bohus-labyrint-strukturbilde-80x120', 'bohus-ramor-canvas-bilde-90x120', 'bohus-holmen-mara-canvas-bilde-120x60'];
  check('de 4 Bohus-bildene ligger i «Kunst og bilder» (D12)', moved.every((id) => cat.getProduct(id)?.category === 'kunst'), moved.map((id) => `${id}: ${cat.getProduct(id)?.category}`).join(', '));
  const leftInSmatt = cat.products('smatt').filter((p) => p.archetype === 'art-frame' || p.archetype === 'art-set');
  check('ingen art-frame/art-set igjen i Smått', !leftInSmatt.length, leftInSmatt.map((p) => p.id).join(', '));
  const sideMoved = all.filter((p) => ['side-table-round', 'side-table-c', 'side-table-nesting'].includes(p.archetype) && p.category !== 'bord');
  check('småbordene ligger i Bord (D12)', !sideMoved.length, sideMoved.map((p) => `${p.id}: ${p.category}`).join(', '));
  check('kategorihint for spotter og smått (D45)', cat.CATEGORY_HINTS?.spotter?.goto === 'smalamper' && cat.CATEGORY_HINTS?.smatt?.goto === 'kunst');
  for (const [q, min] of [['downlight', 8], ['spot', 10], ['plakat', 8], ['salongbord', 3], ['skrivebord', 3], ['kontorstol', 2], ['barkrakk', 2]]) {
    const n = cat.search(q).length;
    Q.soft(`søk «${q}» gir minst ${min} treff`, n >= min, `${n} treff`);
  }
  const spotBad = [];
  for (const p of cat.products('spotter')) {
    const s = cat.productToItemSpec(p);
    if (!(s?.light?.lumens > 0)) spotBad.push(`${p.id}: ingen lumen`);
    if (!['ceiling', 'wall'].includes(s?.mount)) spotBad.push(`${p.id}: montering ${s?.mount}`);
    const want = { innfelt: ['downlight'], utenpaliggende: ['downlight-surface'], takspot: ['spot-ceiling', 'spot-track'], skinne: ['spot-track'], veggspot: ['spot-wall'], bildebelysning: ['picture-light'] }[p.subcategory];
    if (!want?.includes(p.archetype)) spotBad.push(`${p.id}: ${p.subcategory}/${p.archetype} (MASTER §2.1)`);
  }
  check(`spotter (${cat.products('spotter').length}): lys med lumen, tak eller vegg, riktig arketype per underkategori`, !spotBad.length, show(spotBad));
  // D46: tidy shelves – new hylle/tvbenk with a decor param write decor:false, new vitrineskap decor:true
  const decorBad = all.filter((p) => !BASE_IDS.has(p.id)).filter((p) => {
    const declares = !!reg.getArchetype(p.archetype)?.params?.decor;
    if (!declares) return false;
    if (p.category === 'vitrineskap') return p.params?.decor !== true;
    if (p.category === 'hylle' || p.category === 'tvbenk') return p.params?.decor !== false;
    return false;
  });
  check('ryddige hyller: nye hyller/TV-benker uten pynt, nye vitrineskap med (D46)', !decorBad.length, show(decorBad.map((p) => `${p.id}: decor ${p.params?.decor}`)));
  // the tidy house: nothing auto-inserted
  const { DesignState } = await imp('src/design/DesignState.js');
  const ds = new DesignState();
  const uids = ds.list().map((it) => it.uid);
  check(`«Ryddig hus»: originaldesignet har nøyaktig de ${Q.BASE.originalItems.length} tingene fra før`, JSON.stringify(uids) === JSON.stringify(Q.BASE.originalItems),
    `${uids.length} ting; nye: ${uids.filter((u) => !Q.BASE.originalItems.includes(u)).join(', ') || '–'}; borte: ${Q.BASE.originalItems.filter((u) => !uids.includes(u)).join(', ') || '–'}`);
  check('ex-f-maleri beholder motivet «misty-trees»', ds.get('ex-f-maleri')?.params?.motif === 'misty-trees', ds.get('ex-f-maleri')?.params?.motif);
  // review fixes: ALEX is on sale (førpris 1 695 kr), Gustin stays black/white like the shop's photo
  const alex = cat.getProduct('ikea-alex-skrivebord-100x48');
  const ap = alex ? cat.priceOf(alex, 0) : null;
  check('ALEX skrivebord: 1 495 kr på tilbud (førpris 1 695 kr)', ap?.price === 1495 && ap?.listPrice === 1695 && ap?.onSale === true, JSON.stringify(ap));
  const gus = cat.getProduct('bohus-holmen-gustin-strukturbilde-80x100');
  const gp = gus?.params || {};
  check('Gustin: svart/hvitt som bildet hos Bohus (trykkfarge = palett[1], malt overflate, hvit kant)',
    gus?.variants?.[0]?.colors?.print === '#151515' && gp.palette?.[1] === '#151515' && gp.texture === 'painted' && gp.edge === 'white',
    JSON.stringify({ print: gus?.variants?.[0]?.colors?.print, palette1: gp.palette?.[1], texture: gp.texture, edge: gp.edge }));
  check('bytte: art-frame (vegg) ↔ art-set (vegg) er lov', cat.mountsCompatible('art-frame', 'wall', 'art-set', 'wall') === true);
  const both = (a) => (cat.archetypeInfo(a)?.mounts || []).length > 1;
  check('bytte: downlight (tak) ↔ veggspot (vegg) er ikke lov', cat.mountsCompatible('downlight', 'ceiling', 'spot-wall', 'wall') === (both('downlight') && both('spot-wall') && false));
  check('bytte: downlight (tak) ↔ takspot (tak) er lov', cat.mountsCompatible('downlight', 'ceiling', 'spot-ceiling', 'ceiling') === true);
}

done();
