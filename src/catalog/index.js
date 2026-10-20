import schema from '../data/archetypes.json';
import lenestol from '../data/catalog/lenestol.json';
import skjenk from '../data/catalog/skjenk.json';
import vitrineskap from '../data/catalog/vitrineskap.json';
import taklampe from '../data/catalog/taklampe.json';
import smalamper from '../data/catalog/smalamper.json';
import tekstil from '../data/catalog/tekstil.json';
import teppe from '../data/catalog/teppe.json';
import solskjerming from '../data/catalog/solskjerming.json';
import akustikk from '../data/catalog/akustikk.json';
import smatt from '../data/catalog/smatt.json';

/**
 * Product catalogue (ARCHITECTURE §6). Products come from data/catalog/<key>.json, already normalised by
 * data/scripts/normalize-data.mjs (canonical part names, valid archetypes/materials, mount, dims in metres).
 *
 * Product = { id, category, subcategory?, name, brand, store, url, priceNok, salePriceNok?, priceFromNok?, priceNote,
 *             priceConfidence ('checked'|'check'|'estimate'), dims, archetype, mount, params,
 *             variants: [{ name, colors, materials, priceNok?, salePriceNok?, priceConfidence?, url?, params? }],
 *             defaultVariant, absorption, absorptionNote?, light?, description, why, imageUrl, verified,
 *             requiredExtras?: [{ name, priceNok|null, store, perUnit }] (e.g. the inner cushion of a cover),
 *             packSize?, packPriceNok? (sold in packs only), shippingNok? (fixed freight per order) }
 *
 * Prices (data/scripts/fixes.mjs explains the campaign rule): a variant with its own priceNok has its own list price
 * and is only on sale with its own salePriceNok; other variants use the product's priceNok / salePriceNok.
 */

const S = (body) =>
  `<svg class="kv-icon" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

/**
 * Category icons drawn for the catalogue (24×24, stroke = currentColor, the style of ui/icons.js) – use with
 * dom.svg(c.iconSvg). `icon` stays the nearest key of ui/icons.js ICONS for code that only knows those.
 */
const CATEGORY_SVG = {
  lenestol: S('<path d="M6 11V7.5A2.5 2.5 0 0 1 8.5 5h7A2.5 2.5 0 0 1 18 7.5V11"/><path d="M4.5 11.5a1.5 1.5 0 0 1 3 0V14h9v-2.5a1.5 1.5 0 0 1 3 0V17h-15z"/><path d="M6 17v2M18 17v2"/>'),
  skjenk: S('<rect x="3" y="6" width="18" height="10" rx="1.5"/><path d="M9 6v10M15 6v10M5.5 16v3M18.5 16v3M7 11h.01M11 11h2M17 11h.01"/>'),
  vitrineskap: S('<rect x="5.5" y="2.5" width="13" height="17" rx="1.2"/><path d="M12 2.5v17M5.5 8.2h13M5.5 13.8h13M7.5 19.5v2M16.5 19.5v2M7.7 4.4l1.6 1.6M14 4.4l1.6 1.6"/>'),
  taklampe: S('<path d="M12 2.5v5"/><path d="M6 13a6 5.5 0 0 1 12 0z"/><path d="M10.2 16.2a1.9 1.9 0 0 0 3.6 0"/>'),
  smalamper: S('<path d="M8.5 4h7l2.5 7h-12z"/><path d="M12 11v8M8.5 20.5h7"/>'),
  tekstil: S('<path d="M5 6.5c3-1.6 11-1.6 14 0 1.6 3.4 1.6 7.6 0 11-3 1.6-11 1.6-14 0-1.6-3.4-1.6-7.6 0-11z"/><path d="M8.5 9.5c2.2 1 4.8 1 7 0M8.5 14.5c2.2-1 4.8-1 7 0"/>'),
  teppe: S('<rect x="4.5" y="5" width="15" height="14" rx="1"/><rect x="8" y="8.5" width="8" height="7" rx=".6"/><path d="M6.5 5V3M10 5V3M14 5V3M17.5 5V3M6.5 21v-2M10 21v-2M14 21v-2M17.5 21v-2"/>'),
  solskjerming: S('<rect x="4" y="3.5" width="16" height="2.5" rx="1"/><path d="M5 8.5h14M5 11.5h14M5 14.5h14M5 17.5h14M12 6v14"/>'),
  akustikk: S('<path d="M5 4v16M9 4v16M13 4v16M17 4v16"/><path d="M3 4h17v16H3"/>'),
  smatt: S('<path d="M9.5 3.5h5M10.5 3.5v3C8 8 6.5 10.5 6.5 13.5c0 3.6 2.5 6 5.5 6s5.5-2.4 5.5-6c0-3-1.5-5.5-4-7v-3"/>'),
};

/** Catalogue categories in toolbar order. `icon` is a key of ui/icons.js ICONS, `iconSvg` the drawn category icon. */
export const CATEGORIES = Object.freeze([
  { key: 'lenestol', label: 'Lenestoler', icon: 'sofa' },
  { key: 'skjenk', label: 'Skjenker', icon: 'home' },
  { key: 'vitrineskap', label: 'Vitrineskap', icon: 'cabinet' },
  { key: 'taklampe', label: 'Taklamper', icon: 'bulb' },
  { key: 'smalamper', label: 'Små lamper', icon: 'lamp' },
  { key: 'tekstil', label: 'Puter og pledd', icon: 'palette' },
  { key: 'teppe', label: 'Tepper', icon: 'sliders' },
  { key: 'solskjerming', label: 'Solskjerming', icon: 'blinds' },
  { key: 'akustikk', label: 'Akustikk', icon: 'volume' },
  { key: 'smatt', label: 'Smått', icon: 'pin' },
].map((c) => Object.freeze({ ...c, iconSvg: CATEGORY_SVG[c.key] })));

/** Categories used by the existing furniture that are not in the catalogue (Inspector / shopping list labels). */
export const EXTRA_CATEGORIES = Object.freeze({
  sofa: 'Sofaer',
  bord: 'Bord',
  stoler: 'Stoler',
  elektronikk: 'TV og lyd',
  hylle: 'Hyller',
});

/** Norwegian subcategory labels (product.subcategory → label). */
export const SUBCATEGORY_LABELS = Object.freeze({
  hvilestol: 'Hvilestoler',
  pendel: 'Pendler',
  gulvlampe: 'Gulvlamper',
  bordlampe: 'Bordlamper',
  vegglampe: 'Vegglamper',
  pute: 'Puter',
  pledd: 'Pledd',
  puff: 'Puffer',
  sidebord: 'Sidebord',
  plante: 'Planter',
  kunst: 'Bilder',
  speil: 'Speil',
  dekor: 'Pynt',
  gardin: 'Gardiner',
  persienne: 'Persienner',
  rullegardin: 'Rullegardiner',
  plissé: 'Plisségardiner',
  'duo-rullegardin': 'Duo-rullegardiner',
  lamellgardin: 'Lamellgardiner',
  liftgardin: 'Liftgardiner',
  'utvendig screen': 'Utvendig screen',
  spilepanel: 'Spilepaneler',
  tekstilpanel: 'Tekstilpaneler',
  akustikkbilde: 'Akustikkbilder',
  filtform: 'Filtformer',
  takabsorbent: 'Takabsorbenter',
});

const DATA = { lenestol, skjenk, vitrineskap, taklampe, smalamper, tekstil, teppe, solskjerming, akustikk, smatt };
const ALL = Object.freeze(CATEGORIES.flatMap((c) => DATA[c.key] || []));
const BY_ID = new Map(ALL.map((p) => [p.id, p]));

const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

/** Lowercase, accent-free text for searching («plissé» matches «plisse», «øre» stays «øre»). */
function fold(text) {
  return String(text ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9æøå]+/g, ' ')
    .trim();
}

const SEARCH_INDEX = new Map(
  ALL.map((p) => [
    p.id,
    fold(
      [
        p.name, p.brand, p.store, p.subcategory, SUBCATEGORY_LABELS[p.subcategory], categoryLabel(p.category),
        schema.archetypes[p.archetype]?.label, p.description, p.why, ...p.variants.map((v) => v.name),
      ].join(' '),
    ),
  ]),
);

/**
 * Products in a category (catalogue order). Unknown key → [].
 * @param {string} categoryKey
 * @returns {Object[]}
 */
export function products(categoryKey) {
  return DATA[categoryKey] ? [...DATA[categoryKey]] : [];
}

/** Every product in the catalogue. */
export function allProducts() {
  return [...ALL];
}

/**
 * @param {string} id
 * @returns {Object|null}
 */
export function getProduct(id) {
  return BY_ID.get(id) || null;
}

/**
 * Free-text search over name, brand, store, category, type, description and variant names. Every word must match
 * (accent-insensitive). Empty text → all products.
 * @param {string} text
 * @param {{ category?: string }} [opts]
 * @returns {Object[]}
 */
export function search(text, { category } = {}) {
  const words = fold(text).split(' ').filter(Boolean);
  return ALL.filter((p) => {
    if (category && p.category !== category) return false;
    const hay = SEARCH_INDEX.get(p.id);
    return words.every((w) => hay.includes(w));
  });
}

/**
 * Norwegian label of a category key (catalogue or extra furniture categories).
 * @param {string} key
 * @returns {string}
 */
export function categoryLabel(key) {
  return CATEGORIES.find((c) => c.key === key)?.label || EXTRA_CATEGORIES[key] || key || '';
}

/**
 * Archetype info from data/archetypes.json: { id, family, mount, mounts, label, parts, partLabels, ownPartLabels }
 * or null. `mount` is the default mount, `mounts` every mount a product of the archetype may have (a vitrineskap
 * stands on the floor or hangs on the wall); `partLabels` = the family's names with the archetype's own on top
 * (`ownPartLabels`, e.g. «Spiler» / «Takkopp» for a wooden slat pendant).
 */
export function archetypeInfo(archetype) {
  const a = schema.archetypes[archetype];
  if (!a) return null;
  const fam = schema.families[a.family] || { parts: [], partLabels: {} };
  return {
    id: archetype,
    family: a.family,
    mount: a.mount,
    mounts: Array.isArray(a.mounts) && a.mounts.length ? [...a.mounts] : [a.mount],
    label: a.label,
    parts: a.parts || fam.parts,
    partLabels: { ...(fam.partLabels || {}), ...(a.partLabels || {}) },
    ownPartLabels: { ...(a.partLabels || {}) },
  };
}

/**
 * Can an item of archetype `a` (mount `mountA`) be swapped for one of archetype `b` (mount `mountB`)? Same mount,
 * or the same multi-mount archetype (a floor vitrineskap ↔ the wall-hung one).
 */
export function mountsCompatible(a, mountA, b, mountB) {
  if (mountA === mountB) return true;
  if (a !== b) return false;
  const m = archetypeInfo(a)?.mounts || [];
  return m.includes(mountA) && m.includes(mountB);
}

/**
 * Price to show/pay for a product variant. A variant with its own priceNok has its own list price and is on sale only
 * with its own salePriceNok (the product's campaign does not cover it); other variants use the product's prices.
 * confidence: 'checked' | 'check' (sjekk prisen ved kjøp) | 'estimate' (ca.) – the variant's, else the product's.
 * @returns {{ price: number|null, listPrice: number|null, onSale: boolean, from: boolean, confidence: string, approx: boolean }}
 */
export function priceOf(product, variantIndex = product?.defaultVariant ?? 0) {
  if (!product) return { price: null, listPrice: null, onSale: false, from: false, confidence: 'estimate', approx: true };
  const v = product.variants?.[variantIndex];
  const own = typeof v?.priceNok === 'number';
  const list = own ? v.priceNok : product.priceNok ?? null;
  let sale = null;
  if (typeof v?.salePriceNok === 'number') sale = v.salePriceNok;
  else if (!own && v?.noSale !== true && typeof product.salePriceNok === 'number') sale = product.salePriceNok;
  if (sale != null && list != null && sale >= list) sale = null;
  const confidence = v?.priceConfidence || product.priceConfidence || (product.verified === false ? 'estimate' : 'checked');
  return {
    price: sale ?? list ?? product.priceFromNok ?? null,
    listPrice: list,
    onSale: sale != null && list != null,
    from: list == null && product.priceFromNok != null,
    confidence,
    approx: confidence === 'estimate',
  };
}

/**
 * What else must be bought with a product (e.g. the inner cushion of a cushion cover), per unit.
 * @returns {Array<{ name: string, priceNok: number|null, store: string, perUnit: number }>}
 */
export function extrasOf(product) {
  return Array.isArray(product?.requiredExtras) ? product.requiredExtras.map((e) => ({ perUnit: 1, ...e })) : [];
}

/**
 * Shopping-list line for `qty` units of a variant: whole packs for pack-only products (2-pakning: 3 panels = 2 packs),
 * the required extras, and the store's fixed freight (once per order – the shopping list adds it per store).
 * @returns {{ qty: number, packs: number|null, packSize: number, unitPrice: number|null, total: number|null,
 *   totalList: number|null, onSale: boolean, confidence: string, extras: Array<{ name, store, qty, priceNok, total }>,
 *   extrasTotal: number, shippingNok: number|null, store: string }}
 */
export function purchaseOf(product, variantIndex = product?.defaultVariant ?? 0, qty = 1) {
  const pr = priceOf(product, variantIndex);
  const n = Math.max(0, Math.round(Number(qty) || 0));
  const packSize = Number.isFinite(product?.packSize) && product.packSize > 1 ? product.packSize : 1;
  let total = pr.price != null ? pr.price * n : null;
  let totalList = pr.listPrice != null ? pr.listPrice * n : null;
  let packs = null;
  if (packSize > 1) {
    packs = Math.ceil(n / packSize);
    const packPrice = Number.isFinite(product.packPriceNok) ? product.packPriceNok : pr.price != null ? pr.price * packSize : null;
    total = packPrice != null ? packPrice * packs : null;
    totalList = pr.onSale && pr.listPrice != null ? pr.listPrice * packSize * packs : total;
  }
  const extras = extrasOf(product).map((e) => {
    const q = n * (e.perUnit || 1);
    return { name: e.name, store: e.store || product?.store || '', qty: q, priceNok: e.priceNok ?? null, total: e.priceNok != null ? e.priceNok * q : null };
  });
  return {
    qty: n,
    packs,
    packSize,
    unitPrice: pr.price,
    total,
    totalList,
    onSale: pr.onSale,
    confidence: pr.confidence,
    extras,
    extrasTotal: extras.reduce((s, e) => s + (e.total || 0), 0),
    shippingNok: Number.isFinite(product?.shippingNok) ? product.shippingNok : null,
    store: product?.store || '',
  };
}

/**
 * Item spec for DesignState.add() from a product variant (no position – Placement sets it).
 * @param {Object|string} product  product or product id
 * @param {number} [variantIndex]
 * @returns {Object|null}
 */
export function productToItemSpec(product, variantIndex) {
  const p = typeof product === 'string' ? getProduct(product) : product;
  if (!p) return null;
  const vi = clampVariant(p, variantIndex);
  const v = p.variants[vi] || { colors: {}, materials: {} };
  const spec = {
    source: 'catalog',
    refId: p.id,
    name: p.name,
    category: p.category,
    archetype: p.archetype,
    mount: p.mount,
    rotationDeg: 0,
    dims: { w: p.dims.w, d: p.dims.d, h: p.dims.h },
    // paramsOverride: variant-specific model params (e.g. BESTÅ front styles) win over the product's
    params: { ...clone(p.params), ...clone(v.params || {}), ...clone(v.paramsOverride || {}) },
    colors: clone(v.colors),
    materials: clone(v.materials),
    variantIndex: vi,
    acoustic: { m2: p.absorption || 0, ref: { w: p.dims.w, d: p.dims.d, h: p.dims.h } },
  };
  // pendants: start at the shop's default cable length, so the Inspector's «Avstand fra tak» shows the real drop
  if (p.mount === 'ceiling' && spec.params.drop == null && typeof spec.params.dropDefault === 'number') {
    spec.params.drop = typeof spec.params.maxDrop === 'number' ? Math.min(spec.params.dropDefault, spec.params.maxDrop) : spec.params.dropDefault;
  }
  if (p.light) {
    spec.light = { on: true, dimmer: 1, colorK: p.light.colorK ?? 2700, lumens: p.light.lumens ?? 800 };
  }
  return spec;
}

/** Default «open» per shading archetype for a newly hung product (1 = fully open/up). */
const SHADING_DEFAULT_OPEN = { curtain: 1, vertical: 1 };

/**
 * ShadingSpec for DesignState.setWindow() from a solskjerming product (ARCHITECTURE §7/§8).
 * `mount` is the installation (params.mount: 'recess' | 'frame' | 'wall' | 'ceiling').
 * @param {Object|string} product
 * @param {number} [variantIndex]
 * @returns {Object|null}
 */
export function productToShadingSpec(product, variantIndex) {
  const p = typeof product === 'string' ? getProduct(product) : product;
  if (!p) return null;
  const vi = clampVariant(p, variantIndex);
  const v = p.variants[vi] || { colors: {}, materials: {} };
  return {
    productId: p.id,
    variantIndex: vi,
    archetype: p.archetype,
    params: { ...clone(p.params), ...clone(v.params || {}) },
    colors: clone(v.colors),
    materials: clone(v.materials),
    open: SHADING_DEFAULT_OPEN[p.archetype] ?? 0.5,
    tilt: Number(p.params?.tilt) || 0,
    mount: p.params?.mount || 'recess',
  };
}

function clampVariant(p, variantIndex) {
  const n = p.variants?.length || 1;
  const vi = Number.isInteger(variantIndex) ? variantIndex : p.defaultVariant ?? 0;
  return Math.max(0, Math.min(n - 1, vi));
}
