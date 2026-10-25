#!/usr/bin/env node
/**
 * bohus-probe.mjs – query Bohus' public Magento GraphQL (https://www.bohus.no/graphql) and print catalog-shaped JSON
 * (the research product shape of Interiørspillet, notes/katalog-hele-huset.md §2) for the research agents.
 *
 * Every request goes through tools/research/net.mjs politeFetch: a shared per-host throttle (≥ 2 s between requests to
 * bohus.no from ALL processes), a 60 s back-off on HTTP 429 (no retry loop) and a 12 h response cache under
 * .shots/net/ (the same query twice makes one request). One GraphQL request per page (+1 for --stock).
 *
 *   node tools/research/bohus-probe.mjs "spisestol"                         # Magento full-text search (expired items filtered)
 *   node tools/research/bohus-probe.mjs --category=bord/sofabord --size=20  # browse a category by url_path (productapis.md §2.7)
 *   node tools/research/bohus-probe.mjs --sku=298379,321373                 # exact SKUs (varenr.)
 *   node tools/research/bohus-probe.mjs --url=https://www.bohus.no/stoler/spisestoler/rocco-spisestol-2
 *   options: --key=<catalog category key> --sub=<subcategory> (default: the guess below) --size=10 --page=1 --pages=1..5
 *            --sort=is_bestseller|price_asc|news_from_date   (category browsing + is_bestseller = best way to find live products)
 *            --include-expiring  (keep «Expiring» clearance items; default: dropped)  --include-expired (keep «Utløpt»)
 *            --stock (one extra request: stockByProximityV2 per SKU, postcode --postcode=0150)
 *            --group (merge colour SKUs of one model into one product with variants; default on, --no-group to disable)
 *            --no-cache (skip the 12 h response cache – fresh data, still throttled)
 *            --debug (keep _bohus raw fields in the output – strip them before saving a research file!)
 *
 * The category / subcategory / archetype / mount / light kind are only a GUESS from Bohus' «Type» and the name, pointing
 * to the runde-3 table (design MASTER §2.1): check them against the photo and the rules before saving.
 *
 * stdout: JSON array. stderr: diagnostics (network lines, GraphQL partial errors, dropped items).
 */
import { politeFetch } from './net.mjs';

const ENDPOINT = 'https://www.bohus.no/graphql';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Interiorspillet-research/1.0';
const today = new Date().toISOString().slice(0, 10);

const args = process.argv.slice(2);
const opt = (name, dflt = null) => {
  const a = args.find((x) => x === `--${name}` || x.startsWith(`--${name}=`));
  if (!a) return dflt;
  return a.includes('=') ? a.slice(a.indexOf('=') + 1) : true;
};
const term = args.find((a) => !a.startsWith('--')) || null;
const size = Math.min(Number(opt('size', 10)) || 10, 50);
const page = Number(opt('page', 1)) || 1;
const group = !args.includes('--no-group');
const debug = !!opt('debug');
const warn = (...m) => console.error('[bohus-probe]', ...m);

async function gql(query, variables = {}) {
  const res = await politeFetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': UA, Accept: 'application/json' },
    body: JSON.stringify({ query, variables }),
  }, { cache: !args.includes('--no-cache') });
  if (res.status === 429) throw new Error(`HTTP 429 (rate limited) – retry-after ${res.headers.get('retry-after')}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const j = await res.json();
  // Bohus returns partial errors ("Internal server error" on single attribute values); data is still usable
  for (const e of j.errors || []) warn('graphql error:', e.message, JSON.stringify(e.path || []));
  return j.data;
}

const FIELDS = `
  __typename name sku canonical_url url_key
  brand_info { title }
  price_range { minimum_price { regular_price { value currency } final_price { value } discount { percent_off amount_off } } }
  image { url label }
  campaign { group_name message sale_price_effective_date }
  attrs: catalog_product_page_attributes { code label value }
`;

function buildQuery() {
  const sort = opt('sort');
  const sortArg = sort ? `, sort:{ ${sort === 'price_asc' ? 'price:ASC' : sort + ':DESC'} }` : '';
  const cat = opt('category');
  const sku = opt('sku');
  const url = opt('url');
  let filter = null;
  if (cat) filter = `{ category_url_path:{ eq:${JSON.stringify(cat)} } }`;
  else if (sku) filter = `{ sku:{ in:${JSON.stringify(String(sku).split(','))} } }`;
  else if (url) filter = `{ url_key:{ eq:${JSON.stringify(new URL(url).pathname.split('/').filter(Boolean).pop())} } }`;
  // NB: search + filter together returns 0 on Bohus – use one or the other
  const what = filter ? `filter:${filter}` : `search:${JSON.stringify(term || '')}`;
  return `{ products(${what}, pageSize:${size}, currentPage:${page}${sortArg}) { total_count page_info { total_pages } items { ${FIELDS} } } }`;
}

const num = (v) => {
  if (v == null || v === '') return null;
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};
const slug = (s) => String(s).toLowerCase()
  .replace(/æ/g, 'ae').replace(/[øö]/g, 'o').replace(/[åä]/g, 'a').replace(/é/g, 'e').replace(/ü/g, 'u')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const strip = (html) => String(html || '').replace(/<\/li>/gi, '. ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')
  .replace(/\s+\./g, '.').replace(/\.(\s*\.)+/g, '.').trim();

/** Bohus dims (cm) → catalog dims (m): w = front width / long side, d = depth, h = height. See productapis.md §1.5. */
function dimsOf(a) {
  const W = num(a.width), L = num(a.length), D = num(a.depth), H = num(a.height), Ø = num(a.diameter);
  let w = null, d = null;
  if (Ø != null && W == null && L == null) { w = Ø; d = D ?? Ø; }
  else if (L != null) { w = Math.max(L, W ?? 0); d = D ?? (W != null ? Math.min(L, W) : null); }
  else { w = W; d = D ?? Ø; }
  const m = (v) => (v == null ? null : Math.round(v * 100) / 10000);
  return { w: m(w), d: m(d), h: m(H) };
}

/**
 * composition («Type») + name → a GUESS of { archetype, mount, light kind, category, subcategory, params hints }, pointing
 * to the runde-3 table «Where every type lives» (design MASTER §2.1; light kinds §2.5). Only a hint – check it against the
 * photo. First match wins, so the specific patterns come first. Function entries get (attrs, name).
 * Rows: [pattern, archetype, mount, light kind, category, subcategory, params]
 */
const bulbs = (a) => num(a.lighting_numberlightbulbs) || 1;
const seats = (a, name) => {
  const m = String(name).match(/(\d)\s*(?:[,.]\s*5)?\s*-?\s*seter/i);
  const n = m ? Number(m[1]) : null;
  return n >= 2 && n <= 4 ? `${n}-seter` : undefined;
};
const GUESS = [
  // spotter og downlights
  [/galleribelysning|bildebelysning|bildelampe|picture.?light/i, 'picture-light', 'wall', 'picture', 'spotter', 'bildebelysning'],
  [/veggspot/i, 'spot-wall', 'wall', 'wall-spot', 'spotter', 'veggspot'],
  [/spotskinne|takskinne|skinnesystem|skinnespot/i, 'spot-track', 'ceiling', 'track', 'spotter', 'skinne'],
  [/downlight|innfelt/i, (a, n) => (/utenp[åa]liggende|p[åa]bygg/i.test(n) ? 'downlight-surface' : 'downlight'), 'ceiling', 'downlight',
    'spotter', (a, n) => (/utenp[åa]liggende|p[åa]bygg/i.test(n) ? 'utenpaliggende' : 'innfelt')],
  // a takspot with several heads on one canopy = spot-track with railKind 'plate' (round) or 'bar' (long), MASTER D2
  [/takspot|spotlight|\bspot\b/i, (a) => (bulbs(a) > 1 ? 'spot-track' : 'spot-ceiling'), 'ceiling', 'spot', 'spotter', 'takspot',
    (a) => (bulbs(a) > 1 ? { railKind: num(a.diameter) && !num(a.length) ? 'plate' : 'bar', heads: Math.min(8, bulbs(a)) } : {})],
  // små lamper
  [/arbeidslampe|skrivebordslampe|arkitektlampe/i, 'table-task', 'surface', 'table', 'smalamper', 'arbeidslampe'],
  [/vegglampe/i, (a, n) => (/arm|sving/i.test(n) ? 'wall-arm' : 'wall-sconce'), 'wall', 'wall', 'smalamper', 'vegglampe'],
  [/gulvlampe|leselampe/i, 'floor-pole-shade', 'floor', 'floor', 'smalamper', 'gulvlampe'],
  [/oppladbar/i, 'table-portable', 'surface', 'table', 'smalamper', 'bordlampe'],
  [/bordlampe|nattbordslampe/i, 'table-shade', 'surface', 'table', 'smalamper', 'bordlampe'],
  // taklamper
  [/plafond/i, 'ceiling-ring', 'ceiling', 'pendant', 'taklampe', undefined],
  [/pendel|taklampe|lysekrone/i, 'pendant-dome', 'ceiling', 'pendant', 'taklampe', 'pendel'],
  // bord (sidebord, konsollbord, salongbord and round nightstands use the flexible coffee-table, MASTER D9)
  [/sofabord|salongbord/i, 'coffee-table', 'floor', null, 'bord', 'sofabord', (a) => (num(a.diameter) ? { shape: 'round' } : {})],
  [/konsollbord/i, 'coffee-table', 'floor', null, 'bord', 'konsollbord'],
  [/sidebord|pidestall|settbord|lampebord/i, 'coffee-table', 'floor', null, 'bord', 'sidebord', (a) => (num(a.diameter) ? { shape: 'round' } : {})],
  [/skrivebord|hjemmekontor/i, 'desk', 'floor', null, 'bord', 'skrivebord'],
  [/spisebord/i, 'dining-table-oval', 'floor', null, 'bord', 'spisebord'],
  [/nattbord/i, (a) => (num(a.diameter) ? 'coffee-table' : 'bedside-table'), 'floor', null, 'nattbord',
    (a, n) => (/vegghengt/i.test(n) ? 'vegghengt' : undefined), (a) => (num(a.diameter) ? { shape: 'round', base: 'drum' } : {})],
  // stoler og krakker
  [/kontorstol|skrivebordsstol|gamingstol/i, 'office-chair', 'floor', null, 'stoler', 'kontorstol'],
  [/barstol|barkrakk/i, 'bar-stool', 'floor', null, 'stoler', 'barkrakk'],
  [/krakk/i, 'stool', 'floor', null, 'stoler', 'krakk'],
  [/spisestol|stol med armlene|kjøkkenstol/i, 'dining-chair', 'floor', null, 'stoler', 'spisestol'],
  [/hvilestol/i, 'recliner', 'floor', null, 'lenestol', 'hvilestol'],
  [/lenestol|loungestol/i, 'shell-legs', 'floor', null, 'lenestol', undefined],
  // oppbevaring
  [/tv-benk|tv benk|tv-møbel/i, 'tv-bench', 'floor', null, 'tvbenk', undefined],
  [/vitrine/i, 'display-cabinet', 'floor', null, 'vitrineskap', undefined],
  [/kommode/i, 'dresser', 'floor', null, 'kommode', undefined],
  [/vegghylle/i, 'wall-shelf', 'wall', null, 'hylle', 'vegghylle'],
  [/bokhylle|reol/i, 'bookcase', 'floor', null, 'hylle', 'bokhylle'],
  // benker, sofaer, puffer
  [/spisebenk/i, 'bench', 'floor', null, 'stoler', 'spisebenk'],
  [/sengebenk/i, 'bench', 'floor', null, 'seng', 'sengebenk'],
  [/benk/i, 'bench', 'floor', null, 'gang', 'benk'],
  [/hjørnesofa|hjornesofa/i, 'sofa-modular-l', 'floor', null, 'sofa', 'hjornesofa'],
  [/sjeselong/i, 'sofa-modular-l', 'floor', null, 'sofa', 'sjeselong'],
  [/sovesofa/i, 'sofa-straight', 'floor', null, 'sofa', 'sovesofa'],
  [/sofa|seter/i, 'sofa-straight', 'floor', null, 'sofa', seats],
  [/puff|fotskammel/i, 'pouf', 'floor', null, 'tekstil', 'puff'],
  // kunst og bilder (posters are unframed paper, MASTER D18; empty frames take the owner's own pictures)
  [/bilderamme|fotoramme|galleriramme/i, 'art-frame', 'wall', null, 'kunst', 'ramme', () => ({ acceptsImage: true })],
  [/poster|plakat/i, 'art-frame', 'wall', null, 'kunst', 'plakat', () => ({ frame: 'none', texture: 'paper', edge: 'white' })],
  [/bildevegg|bildesett|bilder?\b.{0,24}\b\d+\s*stk/i, 'art-set', 'wall', null, 'kunst', 'bildevegg'],
  [/bilde|kunst|maleri|lerret|canvas/i, 'art-frame', 'wall', null, 'kunst',
    (a) => (/med ramme/i.test(a.mirror_specification || '') && !/canvas|lerret/i.test(a.materials || '') ? 'innrammet' : 'lerret')],
  // speil
  [/gulvspeil/i, 'mirror-floor', 'floor', null, 'speil', 'gulvspeil'],
  [/speil/i, 'mirror', 'wall', null, 'speil', 'veggspeil'],
];
function guess(a, name) {
  const key = `${a.composition || ''} ${name}`;
  const val = (v) => (typeof v === 'function' ? v(a, name) : v);
  for (const [re, arch, mount, lightKind, category, sub, params] of GUESS) {
    if (re.test(key)) return { archetype: val(arch), mount, lightKind, category, sub: val(sub), params: val(params) || {} };
  }
  return { archetype: null, mount: 'floor', lightKind: null, category: undefined, sub: undefined, params: {} };
}

function lightOf(a, kind) {
  if (!Object.keys(a).some((k) => k.startsWith('lighting_'))) return undefined;
  const n = num(a.lighting_numberlightbulbs) || 1;
  const included = /integrert|ja|inkl/i.test(a.lighting_lightbulbincluded || '');
  const bulb = [
    a.lighting_sockettype ? `${n} x ${a.lighting_sockettype}` : (included ? 'integrert LED' : null),
    a.lighting_maxwatt ? `maks ${a.lighting_maxwatt} W` : null,
    a.lighting_lightbulbincluded
      ? (/^nei/i.test(a.lighting_lightbulbincluded) ? '(lyspære ikke inkludert)' : `(${a.lighting_lightbulbincluded.toLowerCase()})`)
      : null,
  ].filter(Boolean).join(' ');
  return {
    lumens: num(a.lighting_lumen),          // null = Bohus gives none → estimate from bulb (e.g. GU10 LED ≈ 345 lm) and say so
    colorK: num(a.lighting_kelvin),         // null → 2700 is the usual assumption; say so in verifiedNote
    dimmable: a.lighting_dimable ? /^dimbar/i.test(a.lighting_dimable) : undefined,
    kind: kind || undefined,
    bulb: bulb || undefined,
  };
}

const colourName = (a) => {
  // display_color: "Grå - (Aragon 80 Light grey)" → "Aragon 80 Light grey"; plain "Hvit" stays
  const dc = a.display_color || '';
  const m = dc.match(/\(\s*([^)]+?)\s*\)\s*$/);
  return (m ? m[1] : dc || a.supplier_color || '').trim();
};

function toProduct(it, stock) {
  const a = Object.fromEntries((it.attrs || []).map((x) => [x.code, x.value]));
  const reg = it.price_range?.minimum_price?.regular_price?.value ?? null;
  const fin = it.price_range?.minimum_price?.final_price?.value ?? null;
  const sale = fin != null && reg != null && fin < reg ? fin : undefined;
  const dims = dimsOf(a);
  const g = guess(a, it.name);
  const status = a.expiration_status || 'ukjent';
  const img = it.image?.url || '';
  const placeholder = /placeholder|Bilde_mangler/i.test(img);
  const brand = it.brand_info?.title || a.brand || 'Bohus';
  const url = `https://www.bohus.no/${it.canonical_url || it.url_key}`;
  // two SKUs can share the fabric colour and differ only in legs (leg_color) – keep both in the variant name
  const colour = [colourName(a), a.leg_color ? `${a.leg_color.toLowerCase()} ben` : ''].filter(Boolean).join(' / ');
  const campaignEnd = it.campaign?.sale_price_effective_date ? it.campaign.sale_price_effective_date.slice(0, 10) : null;
  const dimTxt = [a.width && `B${a.width}`, a.length && `L${a.length}`, a.depth && `D${a.depth}`, a.diameter && `Ø${a.diameter}`, a.height && `H${a.height}`].filter(Boolean).join(' ');
  const stockTxt = stock ? `; lager: ${stock.total_stock_qty} i butikk, ${stock.total_online_qty} på nett` : '';
  const expiring = /expiring/i.test(status) ? ' Utgående serie (Bohus-data «Expiring») – begrenset lager.' : '';
  const missing = [
    reg == null && 'pris', placeholder && 'produktbilde', dims.w == null && 'bredde', dims.d == null && 'dybde', dims.h == null && 'høyde',
    /utløpt/i.test(status) && 'utgått vare',
  ].filter(Boolean);
  const category = opt('key') || g.category || undefined;
  const p = {
    id: `bohus-${slug(it.name)}`,
    category,
    subcategory: opt('sub') || (category === g.category ? g.sub : undefined) || undefined,
    name: it.name,
    brand,
    store: 'Bohus',
    url,
    priceNok: reg,
    salePriceNok: sale,
    priceNote: `Pris sjekket ${today} på produktsiden (bohus.no-produktdata, varenr. ${it.sku}${colour ? `, ${colour}` : ''}): ${fin} kr` +
      (sale ? ` (før ${reg} kr${it.campaign?.group_name ? `, kampanje «${it.campaign.group_name}»` : ''}${campaignEnd ? ` til ${campaignEnd}` : ''})` : '') +
      `.${expiring}`,
    priceConfidence: 'checked',
    dims,
    archetype: g.archetype,
    mount: g.mount,
    params: { ...g.params, notes: `Bohus: ${a.product_details_description || it.name}. Mål fra bohus.no: ${dimTxt || 'ikke oppgitt'} cm.` },
    variants: [{ name: colour || 'Standard', colors: {}, materials: {}, priceNok: reg, salePriceNok: sale, priceConfidence: 'checked', url }],
    defaultVariant: 0,
    absorption: 0,
    light: lightOf(a, g.lightKind),
    description: strip(a.highlights) || a.product_details_description || '',
    why: '',
    imageUrl: placeholder ? '' : img,
    verified: missing.length === 0,
    verifiedNote: `Bekreftet på bohus.no ${today} (produktdata): ${fin} kr${sale ? ` (før ${reg})` : ''}, ${dimTxt || 'mål mangler'} cm` +
      `${a.materials ? `, ${a.materials}` : ''}${colour ? `, farge ${colour}` : ''}, status ${status} (sortiment ${a.assortment_code || '?'})${stockTxt}.` +
      (missing.length ? ` IKKE verifisert: mangler ${missing.join(', ')}.` : '') +
      ' Farger (hex) må settes fra produktbildet; arketype/params må kontrolleres.',
  };
  if (debug) p._bohus = { sku: it.sku, status, assortment: a.assortment_code, series: a.series, composition: a.composition, compositionSize: a.composition_size, attrs: a, stock };
  p._groupKey = a.composition_size || it.name;
  p._sku = it.sku;
  p._status = status;
  return p;
}

function groupVariants(list) {
  // Bohus sells each colour as its own SKU: one product per composition_size (model + size), colours become variants.
  // A variant keeps priceNok/salePriceNok only where they differ from the product's (catalog convention).
  const out = new Map();
  for (const p of list) {
    const k = p._groupKey;
    if (!out.has(k)) { out.set(k, p); continue; }
    const base = out.get(k);
    base.variants.push(...p.variants);
    base.verified = base.verified && p.verified;
    base.verifiedNote += ` Variant ${p.variants[0].name}: varenr. ${p._sku}, ${p.salePriceNok ?? p.priceNok} kr` +
      `${p.salePriceNok ? ` (før ${p.priceNok})` : ''}.`;
  }
  for (const p of out.values()) {
    for (const v of p.variants) {
      if (v.priceNok === p.priceNok && v.salePriceNok === p.salePriceNok) { delete v.priceNok; delete v.salePriceNok; }
      if (v.salePriceNok === undefined) delete v.salePriceNok;
    }
  }
  return [...out.values()];
}

async function stockFor(skus) {
  if (!skus.length) return {};
  const pc = opt('postcode', '0150');
  const q = `{ ${skus.map((s, i) => `s${i}: stockByProximityV2(products:[{sku:${JSON.stringify(s)},qty:1}], postcode:${JSON.stringify(pc)}, pageSize:1){ total_online_qty total_stock_qty non_existing_products }`).join(' ')} }`;
  const d = await gql(q);
  return Object.fromEntries(skus.map((s, i) => [s, d?.[`s${i}`] || null]));
}

// --pages=N fetches up to N consecutive pages (politeFetch spaces them) – search results are full of expired items, so
// one page can come back empty after filtering
const maxPages = Math.min(Number(opt('pages', 1)) || 1, 5);
let items = [];
for (let pg = page; pg < page + maxPages; pg++) {
  const data = await gql(buildQuery().replace(`currentPage:${page}`, `currentPage:${pg}`));
  const res = data?.products;
  if (!res) { warn('no data'); process.exit(1); }
  warn(`page ${pg}: total_count ${res.total_count}, pages ${res.page_info?.total_pages}, got ${res.items.length}`);
  items.push(...res.items.filter(Boolean));
  if (pg >= (res.page_info?.total_pages || 1)) break;
}
items = items.filter((it) => {
  const st = (it.attrs || []).find((x) => x.code === 'expiration_status')?.value || '';
  if (/utløpt|expired/i.test(st) && !/not expired/i.test(st) && !opt('include-expired')) { warn(`drop ${it.sku} ${it.name}: ${st}`); return false; }
  if (/expiring/i.test(st) && !opt('include-expiring')) { warn(`drop ${it.sku} ${it.name}: Expiring (clearance)`); return false; }
  return true;
});
const stock = opt('stock') ? await stockFor(items.map((i) => i.sku)) : {};
let products = items.map((it) => toProduct(it, stock[it.sku]));
if (group) products = groupVariants(products);
for (const p of products) { delete p._groupKey; if (!debug) { delete p._sku; delete p._status; } }
console.log(JSON.stringify(products, null, 2));
