// «Spesialforslag» for the high wall (the owner's design, 2026-11-18): a wall-hung BESTÅ cabinet with one lamp and one
// plant on it, and canvasbutik.no sound-absorbing pictures over it. The cabinet (grunt / dypt / høyt), its width (180 /
// 240) and its doors (Hedeviken / Björköviken) are chosen once at the top of the panel and follow every proposal. The
// proposals are only pictures, in three kinds:
//   stort  one landscape picture 180 × 120 – every landscape motif in the Spesialkatalog (L1 …)
//   to     two equal pictures, 80 × 120 or 100 × 150 – 30 pairs (P1 … P30)
//   tre    three equal pictures, 70 × 100 or 80 × 120 – 30 trios (T1 … T30)
// These are ordinary catalogue items, so a picture can be clicked and switched between its store sizes afterwards.
//
// CONTRACT
//   SPECIAL_BENCHES, SPECIAL_WIDTHS, SPECIAL_FRONTS, SPECIAL_KINDS     the choices (keys, labels)
//   getSpecialSettings() / setSpecialSettings(patch)                    { bench, width, front, size2, size3, kind }
//   specialProposals(kind) → [{ id, kind, pictures: [slug] }]           the proposals of one kind, in browsing order
//   SPECIAL_PAIRS / SPECIAL_TRIOS / SPECIAL_LANDSCAPE                   the picture lists
//   layoutSpecialProposal(proposal, catalog, settings?) → [{ role, productId, variantIndex, u, v, w, h, d }]
//                                              wall coordinates (u from the niche corner, v up from the floor = bottom edge)
//   specialItemSpecs(proposal, catalog, highWall, settings?) → item specs for DesignState.add (uid «spf-…»)
//   specialProposalTotals(proposal, catalog, settings?) → { price, m2 }
//   applySpecialProposal(editor, id, settings?)  one undo step: removes the last special proposal and what hangs on the
//                                              high wall / stands against it, clears a wall design, adds the items
//   activeSpecialProposal(design) → id | null, activeSpecialSettings(design) → { bench, width, front } | null
//   specialProposalById(id), proposalName(proposal, catalog), isSpecialUid(uid)
//
// Units: metres. The high wall (layout.highWall): x = 3.22, u runs along −z from z = 8.34, 3.91 wide, 3.0 high. The
// cabinet hangs 25 cm over the floor (product params.base 'wall', mountHeight 0.25 – the model lifts itself, the item
// stands at y = 0), centred on the wall; the pictures start 25 cm over its top, bottom-aligned, 10 cm apart. The lamp
// and the plant are low (≤ 30 cm), so they fit under a picture and on the 22 cm deep top.

export const SPECIAL_PREFIX = 'spf-';
export const isSpecialUid = (uid) => typeof uid === 'string' && uid.startsWith(SPECIAL_PREFIX);

export const SPECIAL_BENCHES = Object.freeze([
  { key: 'grunt', label: 'Grunt', depth: '22 × 38', ids: { 180: 'ikea-besta-veggmontert-skapkombinasjon-180x22-mork', 240: 'ikea-besta-veggmontert-skapkombinasjon-240x22-mork' } },
  { key: 'dypt', label: 'Dypt', depth: '42 × 38', ids: { 180: 'ikea-besta-tv-benk-dorer-180x42-veggmontert', 240: 'ikea-besta-tv-benk-dorer-240x42-veggmontert' } },
  { key: 'hoyt', label: 'Høyt', depth: '42 × 64', ids: { 180: 'ikea-besta-veggmontert-skapkombinasjon-180x42x64-mork', 240: 'ikea-besta-veggmontert-skapkombinasjon-240x42x64-mork' } },
]);
export const SPECIAL_WIDTHS = Object.freeze([180, 240]);
/** Door variant index – the same in every cabinet product. */
export const SPECIAL_FRONTS = Object.freeze([{ v: 0, label: 'Hedeviken' }, { v: 1, label: 'Björköviken' }]);

// canvas size variants (tools/build-spesialkatalog.mjs SIZES): 0 = 50 × 70, 1 = 70 × 100, 2 = 80 × 120, 3 = 100 × 150,
// 4 = 120 × 180 (a landscape motif turns them: 180 × 120)
export const SIZE_NAMES = Object.freeze(['50 × 70', '70 × 100', '80 × 120', '100 × 150', '120 × 180']);
export const SPECIAL_KINDS = Object.freeze([
  { key: 'stort', label: 'Stort bilde', prefix: 'L', sizes: [4], sizeLabel: '180 × 120' },
  { key: 'to', label: 'To bilder', prefix: 'P', sizes: [2, 3] },
  { key: 'tre', label: 'Tre bilder', prefix: 'T', sizes: [1, 2] },
]);

const LAMP = { id: 'bohus-sindig-tiller-oppladbar-bordlampe-o18', v: 0 }; // Tiller, lin natur – 23,5 cm, Ø 18
const PLANT = { id: 'bohus-mr-plant-gullranke-l70', v: 1 }; // gullranke i hvit potte Ø 14 – henger ned over kanten
const ART = (slug) => `canvasbutik-lyddempende-bilde-${slug}`;

/** Every landscape motif in the Spesialkatalog (tools/test-design.mjs checks the list is complete). */
export const SPECIAL_LANDSCAPE = Object.freeze([
  'petal', 'amber-waves', 'whispers-of-earth', 'serene-waterdrop', 'cattle-on-field',
  'brown-layers', 'amber-flow', 'abstract-in-brown', 'circles-in-brown', 'brown-forms',
]);

/** Two equal pictures – one style per pair, grouped so similar pairs sit together. */
export const SPECIAL_PAIRS = Object.freeze([
  // tørkede blader
  ['whispering-leaves', 'rust'], ['rust', 'gaiety'], ['whispering-leaves', 'gaiety'], ['gaiety', 'inflorescence'],
  // beige naturfoto
  ['nature-petals', 'beige-botanics'], ['natures-quiet-elegance', 'nature-petals'], ['central-flower', 'natures-quiet-elegance'],
  ['beigeblossom', 'central-flower'], ['serenebeige', 'beigeflor'], ['beigeblossom', 'serenebeige'],
  ['blissful-meadow', 'grass-in-light'], ['burdocks', 'sunlight-in-the-mountains'], ['beige-botanics', 'burdocks'],
  ['fall-flowers', 'inflorescence'], ['finery', 'boho-flower'], ['boho-flower', 'inflorescence'],
  // malte fjell
  ['golden-horizons', 'timeless-peaks'],
  // blekk og marmor
  ['sands-of-time', 'rust-and-flow'], ['veins-of-terra', 'sands-of-time'], ['veins-of-terra', 'rust-and-flow'],
  // landskapsfoto
  ['hazy-mountains', 'colorful-autumn'], ['above-the-clouds', 'hazy-mountains'], ['secrecy', 'connection'], ['dolomites', 'secrecy'],
  // grafisk
  ['nature-graphic-no1', 'nature-graphic-no2'], ['graphic-art-no1', 'graphic-art-no2'],
  // akvarell
  ['soft-leaves', 'earth-leaves'], ['ethereal-strata', 'framed-stillness'], ['abstract-oval', 'brown-balance'], ['brown-circles', 'brown-shapes'],
]);

/** Three equal pictures – the middle one carries the wall. */
export const SPECIAL_TRIOS = Object.freeze([
  // tørkede blader
  ['rust', 'whispering-leaves', 'gaiety'], ['inflorescence', 'whispering-leaves', 'rust'], ['gaiety', 'rust', 'beige-botanics'],
  ['gaiety', 'inflorescence', 'boho-flower'],
  // beige naturfoto
  ['nature-petals', 'beige-botanics', 'beigeflor'], ['burdocks', 'grass-in-light', 'sunlight-in-the-mountains'],
  ['fall-flowers', 'finery', 'inflorescence'], ['beigeflor', 'serenebeige', 'beigeblossom'],
  ['central-flower', 'nature-petals', 'natures-quiet-elegance'], ['blissful-meadow', 'beige-botanics', 'burdocks'],
  ['boho-flower', 'finery', 'fall-flowers'], ['serenebeige', 'central-flower', 'beigeflor'],
  ['grass-in-light', 'blissful-meadow', 'sunlight-in-the-mountains'], ['inflorescence', 'boho-flower', 'finery'],
  ['beige-botanics', 'natures-quiet-elegance', 'blissful-meadow'], ['nature-petals', 'beigeblossom', 'central-flower'],
  ['sunlight-in-the-mountains', 'fall-flowers', 'burdocks'], ['beigeflor', 'grass-in-light', 'serenebeige'],
  ['beige-botanics', 'burdocks', 'sunlight-in-the-mountains'], ['central-flower', 'beigeblossom', 'natures-quiet-elegance'],
  ['boho-flower', 'serenebeige', 'finery'],
  // malte lag, blekk, landskap
  ['timeless-peaks', 'ethereal-strata', 'golden-horizons'], ['sands-of-time', 'veins-of-terra', 'rust-and-flow'],
  ['hazy-mountains', 'above-the-clouds', 'colorful-autumn'], ['secrecy', 'dolomites', 'connection'],
  // grafisk
  ['graphic-art-no1', 'nature-graphic-no1', 'graphic-art-no2'], ['nature-graphic-no1', 'nature-graphic-no2', 'nature-graphic-no3'],
  // akvarell
  ['brown-circles', 'brown-shapes', 'brown-balance'], ['earth-leaves', 'soft-leaves', 'ethereal-strata'],
  ['framed-stillness', 'abstract-oval', 'brown-shapes'],
]);

const LISTS = { stort: SPECIAL_LANDSCAPE.map((s) => [s]), to: SPECIAL_PAIRS, tre: SPECIAL_TRIOS };
const kindOf = (key) => SPECIAL_KINDS.find((k) => k.key === key) || SPECIAL_KINDS[0];
const PROPOSALS = Object.fromEntries(SPECIAL_KINDS.map((k) => [k.key, Object.freeze(LISTS[k.key].map((pictures, i) => Object.freeze({ id: `${k.prefix}${i + 1}`, kind: k.key, pictures })))]));

/** The proposals of one kind, in browsing order. */
export const specialProposals = (kind) => PROPOSALS[kindOf(kind).key];
export const specialProposalById = (id) => SPECIAL_KINDS.map((k) => PROPOSALS[k.key]).flat().find((p) => p.id === id) || null;

// ---- the choices (module state; the panel remembers them per viewer) ------------------------------------------------

const DEFAULTS = Object.freeze({ bench: 'grunt', width: 180, front: 0, size2: 2, size3: 1, kind: 'to' });
let _settings = { ...DEFAULTS };

function clean(s) {
  const out = { ...DEFAULTS, ...s };
  if (!SPECIAL_BENCHES.some((b) => b.key === out.bench)) out.bench = DEFAULTS.bench;
  out.width = Number(out.width);
  if (!SPECIAL_WIDTHS.includes(out.width)) out.width = DEFAULTS.width;
  out.front = Number(out.front);
  if (!SPECIAL_FRONTS.some((f) => f.v === out.front)) out.front = DEFAULTS.front;
  out.size2 = Number(out.size2);
  if (!kindOf('to').sizes.includes(out.size2)) out.size2 = DEFAULTS.size2;
  out.size3 = Number(out.size3);
  if (!kindOf('tre').sizes.includes(out.size3)) out.size3 = DEFAULTS.size3;
  out.kind = kindOf(out.kind).key;
  return out;
}
export const getSpecialSettings = () => ({ ..._settings });
export function setSpecialSettings(patch = {}) {
  _settings = clean({ ..._settings, ...patch });
  return getSpecialSettings();
}

/** The cabinet product of a choice. */
export const benchProductId = (s = _settings) => (SPECIAL_BENCHES.find((b) => b.key === s.bench) || SPECIAL_BENCHES[0]).ids[s.width] || SPECIAL_BENCHES[0].ids[180];
/** The picture size (variant index) a proposal kind uses with these choices. */
export const pictureSize = (kind, s = _settings) => (kind === 'stort' ? 4 : kind === 'tre' ? s.size3 : s.size2);

// ---------------------------------------------------------------------------------------------------------------

const WALL_W = 3.91;
const WALL_H = 3.0;
const PIC_TOP_MAX = WALL_H - 0.25; // a picture's top edge stays 25 cm under the ceiling
const BENCH_U = 1.95; // the middle of the wall
const BENCH_Y = 0.25; // wall-hung, 25 cm over the floor
const PIC_GAP_OVER = 0.25; // from the cabinet top to the pictures
const PIC_GAP = 0.1; // between the pictures
const r3 = (x) => Math.round(x * 1000) / 1000;

function dimsOf(catalog, id, v) {
  const p = catalog.getProduct(id);
  if (!p) throw new Error(`[specialProposals] ukjent produkt ${id}`);
  const vv = p.variants?.[v];
  return { product: p, dims: vv?.dims ? { ...p.dims, ...vv.dims } : p.dims };
}

/** «Rust + Whispering Leaves» – the motif titles of a proposal. */
export function proposalName(proposal, catalog) {
  return proposal.pictures.map((s) => (catalog.getProduct(ART(s))?.name || s).replace(/^Lyddempende bilde\s*[–-]\s*/, '')).join(' + ');
}

/**
 * Wall coordinates of everything in a proposal (v = bottom edge, u = centre).
 * @param {{ pictures: string[], kind: string }} proposal
 * @param {{ getProduct: (id: string) => object }} catalog  catalog/index.js
 * @param {object} [settings]  getSpecialSettings() shape (default: the current choices)
 */
export function layoutSpecialProposal(proposal, catalog, settings = _settings) {
  const s = clean(settings);
  const out = [];
  const b = dimsOf(catalog, benchProductId(s), s.front);
  const top = BENCH_Y + b.dims.h;
  out.push({ role: 'bench', productId: b.product.id, variantIndex: s.front, u: BENCH_U, v: BENCH_Y, w: b.dims.w, h: b.dims.h, d: b.dims.d });

  const base = top + PIC_GAP_OVER;
  const size = pictureSize(proposal.kind, s);
  const pics = proposal.pictures.map((slug) => {
    let v = size, x = dimsOf(catalog, ART(slug), v);
    // safety: never closer than 25 cm to the ceiling (the sizes on offer all fit today)
    while (v > 0 && base + x.dims.h > PIC_TOP_MAX + 1e-9) x = dimsOf(catalog, ART(slug), --v);
    return { v, ...x };
  });
  const total = pics.reduce((t, x) => t + x.dims.w, 0) + PIC_GAP * (pics.length - 1);
  let u = BENCH_U - total / 2;
  for (const x of pics) {
    out.push({ role: 'picture', productId: x.product.id, variantIndex: x.v, u: r3(u + x.dims.w / 2), v: r3(base), w: x.dims.w, h: x.dims.h, d: x.dims.d });
    u += x.dims.w + PIC_GAP;
  }

  // the lamp at the niche end, the plant at the door end
  for (const [d, at] of [[LAMP, -0.85], [PLANT, 0.85]]) {
    const x = dimsOf(catalog, d.id, d.v);
    const half = b.dims.w / 2 - x.dims.w / 2 - 0.04;
    out.push({ role: 'decor', productId: x.product.id, variantIndex: d.v, u: r3(BENCH_U + at * half), v: r3(top), w: x.dims.w, h: x.dims.h, d: x.dims.d, benchD: b.dims.d });
  }
  return out;
}

/** Distance from the wall to the centre of an item (m). */
function outOf(e) {
  if (e.role === 'picture') return 0;
  if (e.role === 'bench') return e.d / 2;
  // decor: in the middle of the cabinet top, a wide plant a little forward so its leaves clear the wall
  return Math.max(e.benchD / 2, Math.min(e.d / 2, e.benchD / 2 + 0.03));
}

/**
 * Item specs (world positions) for DesignState.add.
 * @param {object} proposal
 * @param {object} catalog  catalog/index.js (getProduct, productToItemSpec)
 * @param {{ wallId: string, origin: {x:number,z:number}, uDir: {x:number,z:number}, normal: {x:number,z:number} }} hw  layout.highWall
 * @param {object} [settings]
 */
export function specialItemSpecs(proposal, catalog, hw, settings = _settings) {
  const n = [hw.normal.x, 0, hw.normal.z];
  const yaw = Math.round((Math.atan2(n[0], n[2]) * 180) / Math.PI);
  const at = (u, out) => [r3(hw.origin.x + hw.uDir.x * u + n[0] * out), null, r3(hw.origin.z + hw.uDir.z * u + n[2] * out)];
  const name = proposalName(proposal, catalog);
  return layoutSpecialProposal(proposal, catalog, settings).map((e, i) => {
    const spec = catalog.productToItemSpec(e.productId, e.variantIndex);
    const pos = at(e.u, outOf(e));
    // wall items: origin at the back centre, vertical middle; surface items: bottom centre (models/kit.js).
    // The wall-hung cabinet (params.base 'wall') lifts itself by its mountHeight, so it stands that much lower.
    const lift = e.role === 'bench' && spec.params?.base === 'wall' ? Number(spec.params.mountHeight) || 0 : 0;
    pos[1] = r3(e.role === 'picture' ? e.v + e.h / 2 : e.v - lift);
    const extra = e.role === 'picture' ? { attach: { wallId: hw.wallId, normal: n } } : {};
    const note = { bench: 'Vegghengt 25 cm over gulvet.', decor: 'På skapet.' }[e.role] || '';
    return {
      ...spec, ...extra, uid: `${SPECIAL_PREFIX}${proposal.id.toLowerCase()}-${i + 1}`, position: pos, rotationDeg: yaw, level: 'hoved',
      notes: `Spesialforslag ${proposal.id}: ${name}.${note ? ` ${note}` : ''}`,
    };
  });
}

/** Total price (sale prices) and absorption of a proposal. */
export function specialProposalTotals(proposal, catalog, settings = _settings) {
  let price = 0, m2 = 0;
  for (const e of layoutSpecialProposal(proposal, catalog, settings)) {
    const p = catalog.getProduct(e.productId);
    price += catalog.priceOf ? (catalog.priceOf(p, e.variantIndex)?.price ?? 0) : (p.variants?.[e.variantIndex]?.salePriceNok ?? p.salePriceNok ?? p.priceNok ?? 0);
    if (e.role === 'picture') m2 += p.variants?.[e.variantIndex]?.absorption ?? p.absorption ?? 0;
  }
  return { price, m2: Math.round(m2 * 100) / 100 };
}

/** Does an item hang on the high wall or stand / sit against it (what a new special proposal replaces)? */
function againstHighWall(item, hw) {
  if (item.locked || (item.level && item.level !== 'hoved')) return false;
  if (item.attach?.wallId === hw.wallId) return true;
  if (!(item.mount === 'floor' || item.mount === 'surface')) return false;
  if (!['tvbenk', 'skjenk', 'kommode', 'smalamper', 'smatt', 'kunst'].includes(item.category)) return false;
  const p = item.position;
  const out = (p[0] - hw.origin.x) * hw.normal.x + (p[2] - hw.origin.z) * hw.normal.z;
  const u = (p[0] - hw.origin.x) * hw.uDir.x + (p[2] - hw.origin.z) * hw.uDir.z;
  // floor: only sideboards in a 60 cm strip; surface: things up to 60 cm out (on the sideboard)
  if (item.mount === 'floor' && !['tvbenk', 'skjenk', 'kommode'].includes(item.category)) return false;
  return out > -0.01 && out < 0.6 && u > -0.05 && u < hw.width + 0.05;
}

/**
 * Applies a special proposal as one undo step.
 * @param {object} editor  design/Editor.js (design, catalog, home)
 * @param {string} id  L1 … / P1 … / T1 …
 * @param {object} [settings]
 * @returns {string[]} the new uids
 */
export function applySpecialProposal(editor, id, settings = _settings) {
  const proposal = specialProposalById(id);
  const design = editor.design;
  const catalog = editor.catalog;
  const hw = editor.home?.layout?.highWall ?? editor.home?.highWall;
  if (!proposal || !design || !catalog || !hw) return [];
  const specs = specialItemSpecs(proposal, catalog, hw, settings);
  const uids = [];
  design.transaction(`Spesialforslag ${proposal.id}`, () => {
    for (const item of design.list()) if (isSpecialUid(item.uid) || againstHighWall(item, hw)) design.remove(item.uid);
    if (design.wall?.elements?.length) design.setWallProposal('0');
    for (const s of specs) uids.push(design.add(s));
  });
  return uids;
}

/** The proposal currently in the design (its items still there), or null. */
export function activeSpecialProposal(design) {
  for (const item of design?.list?.() || []) {
    const m = isSpecialUid(item.uid) && /^spf-([lpt]\d+)-\d+$/.exec(item.uid);
    if (m && specialProposalById(m[1].toUpperCase())) return m[1].toUpperCase();
  }
  return null;
}

/** The cabinet choices of the proposal in the design ({ bench, width, front }), or null. */
export function activeSpecialSettings(design) {
  for (const item of design?.list?.() || []) {
    if (!isSpecialUid(item.uid)) continue;
    for (const b of SPECIAL_BENCHES) {
      for (const w of SPECIAL_WIDTHS) if (b.ids[w] === item.refId) return { bench: b.key, width: w, front: item.variantIndex ?? 0 };
    }
  }
  return null;
}

export const SPECIAL_WALL = { width: WALL_W, height: WALL_H };
