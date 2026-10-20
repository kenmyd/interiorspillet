import { BasePanel, section, button, emptyState, fmtNok } from './panelKit.js';
import { h, svg, fmtNumber } from './dom.js';
import { ICONS } from './icons.js';
import { thumbnail, cachedThumbnail, priceInfo, EXTRA_ICONS } from './CatalogPanel.js';
import * as shadingModule from '../models/shading.js';
import { describeElement, elementBounds, ELEMENT_TYPES } from '../models/walldesigns.js';
import wallData from '../data/wall-proposals.json';

/**
 * Shopping list (I) – ARCHITECTURE §12: every new catalogue item in the current design grouped by store, with
 * variant, quantity, price (sale prices highlighted) and a link; the high wall (price range and material list –
 * also for an edited proposal and a saved «Mitt forslag»); window shading estimated for each window's size; what
 * leaves the room; the total; «Kopier liste», «Last ned CSV» and «Skriv ut».
 *
 *   new ShoppingPanel(editor) – open() / close() / toggle() / isOpen / update() / dispose()
 *   list() → { stores, wall, shading, removed, total: { min, max }, count }   (the data behind the panel)
 *
 * Module exports (also for other panels):
 *   wallEstimate(design, { customProposal }) → the high wall's price and materials (see below), null = bare wall
 *   shadingEstimate(catalog, product, spec, win, { estimate }) → the same estimate the window panel shows
 *
 * High wall: a built-in proposal is listed with its own price and material list. When the elements differ from
 * the proposal in quantity (fewer checker tiles, a slat panel removed, an element added …) the price is scaled per
 * element type (tiles, m², pieces – weighted by the proposal's area share) and the material list is worked out from
 * the current elements; both are marked «ca., regnet om fra forslaget». A saved «Mitt forslag» (proposalId
 * 'mitt-…', stored by WallPanel) is priced from the proposal it was made from (custom.basedOn / baseId, the «basert
 * på forslag X» description, or the built-in proposal with the same elements).
 *
 * Shading: one estimator for the window panel and the list – models/shading.js `estimateShading` when SHADING
 * exports it, else WindowPanel's own `_estimate` (what the user saw when picking the product), else the same
 * algorithm here (shadingSize + productSizing). Its lines and warnings are printed in the list.
 */

const S = (body) => `<svg class="kv-icon" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const IC = {
  copy: S('<rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M15.5 8.5V6.5a2 2 0 0 0-2-2h-7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2"/>'),
  csv: S('<path d="M6.5 3.5h7l4 4v12a1 1 0 0 1-1 1h-10a1 1 0 0 1-1-1v-15a1 1 0 0 1 1-1z"/><path d="M13.5 3.5v4h4M8.5 12.5h7M8.5 15.5h7M12 11v7"/>'),
  print: S('<path d="M7 8.5V4h10v4.5"/><rect x="4" y="8.5" width="16" height="7.5" rx="1.5"/><path d="M7 13.5h10V20H7z"/>'),
  bag: S('<path d="M5.2 8h13.6l-1.1 11.1a2 2 0 0 1-2 1.8H8.3a2 2 0 0 1-2-1.8z"/><path d="M9 10.5V7a3 3 0 0 1 6 0v3.5"/>'),
  wall: S('<rect x="4" y="3.5" width="16" height="17" rx="1.4"/><path d="M8 3.5v17M12 3.5v17M16 3.5v17"/>'),
};

const CSS = `
.iph-panel .ip-panel__body { padding-top: 0.9em; }
.iph-total { display: flex; align-items: baseline; justify-content: space-between; gap: 0.6em; padding: 0.75em 0.9em; border-radius: var(--kv-r);
  background: var(--kv-accent-soft); border: 1px solid rgba(255, 181, 46, 0.35); margin-bottom: 1.1em; }
.iph-total span { color: var(--kv-ink-2); font-weight: 600; }
.iph-total span small { display: block; font-weight: 500; font-size: 0.78em; color: var(--kv-ink-3); }
.iph-total b { font: 760 1.45em/1.1 var(--kv-font-display); color: var(--kv-accent-2); font-variant-numeric: tabular-nums; white-space: nowrap; }
.iph-store { margin-bottom: 1em; }
.iph-store__head { display: flex; align-items: baseline; justify-content: space-between; gap: 0.5em; margin: 0 0 0.45em; }
.iph-store__head h3 { margin: 0; font-size: 0.78em; font-weight: 760; letter-spacing: 0.09em; text-transform: uppercase; color: var(--kv-ink-2); }
.iph-store__head span { font-size: 0.82em; color: var(--kv-ink-3); font-variant-numeric: tabular-nums; }
.iph-rows { display: flex; flex-direction: column; gap: 0.35em; }
.iph-row { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: 0.65em; align-items: center; padding: 0.45em 0.5em; border-radius: var(--kv-r-sm);
  background: var(--kv-surface); border: 1px solid var(--kv-line); }
.iph-row__img { width: 3.8em; aspect-ratio: 4 / 3; border-radius: 0.35em; background: linear-gradient(180deg, #f4f2ee, #ddd8cf) center / cover; overflow: hidden; display: grid; place-items: center; color: rgba(40,34,28,0.35); }
.iph-row__img img { width: 100%; height: 100%; object-fit: cover; display: block; }
.iph-row__img .kv-icon { width: 1.6em; height: 1.6em; }
.iph-row__main { min-width: 0; }
.iph-row__name { font-weight: 640; font-size: 0.9em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.iph-row__sub { font-size: 0.76em; color: var(--kv-ink-3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.iph-row__sub.is-warn { color: #ffd98a; white-space: normal; }
.iph-row__right { display: flex; flex-direction: column; align-items: flex-end; gap: 0.2em; }
.iph-row__price { font-weight: 720; font-variant-numeric: tabular-nums; white-space: nowrap; font-size: 0.92em; }
.iph-row__price.is-sale { color: #ff8a73; }
.iph-row__price s { display: block; text-align: right; font-weight: 500; font-size: 0.78em; color: var(--kv-ink-4); }
.iph-row__qty { font-size: 0.74em; color: var(--kv-ink-3); white-space: nowrap; }
.iph-link { display: inline-flex; align-items: center; gap: 0.25em; font-size: 0.76em; font-weight: 640; color: var(--kv-accent-2); text-decoration: none; white-space: nowrap; }
.iph-link:hover { text-decoration: underline; }
.iph-link .kv-icon { width: 0.95em; height: 0.95em; }
.iph-wall { padding: 0.6em 0.75em; border-radius: var(--kv-r); background: var(--kv-surface); border: 1px solid var(--kv-line); }
.iph-wall__head { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 0.2em 0.6em; align-items: baseline; }
.iph-wall__head .iph-row__price { white-space: normal; text-align: right; margin-left: auto; }
.iph-wall__name { font-weight: 650; font-size: 0.92em; flex: 1 1 12em; min-width: 0; }
.iph-wall ul { margin: 0.45em 0 0; padding-left: 1.1em; font-size: 0.8em; color: var(--kv-ink-2); line-height: 1.45; }
.iph-wall > .iph-row__sub { margin-top: 0.15em; white-space: normal; }
.iph-wall__note { color: #ffd98a; }
.iph-wall__lh { margin-top: 0.5em; font-size: 0.7em; font-weight: 750; letter-spacing: 0.08em; text-transform: uppercase; color: var(--kv-ink-3); }
.iph-wall__lh + ul { margin-top: 0.2em; }
.iph-wall__orig { margin-top: 0.45em; font-size: 0.8em; color: var(--kv-ink-3); }
.iph-wall__orig summary { cursor: pointer; }
.iph-wall__orig ul { font-size: 1em; color: var(--kv-ink-3); }
.iph-row__price.is-unknown { color: var(--kv-ink-3); font-weight: 600; }
.iph-row__sub.iph-row__lines { white-space: normal; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
.iph-removed { margin: 0; padding-left: 1.1em; font-size: 0.84em; color: var(--kv-ink-2); line-height: 1.5; }
.iph-foot-note { font-size: 0.76em; color: var(--kv-ink-4); line-height: 1.45; margin: 0.4em 0 0; }
.iph-panel .ip-panel__foot { justify-content: space-between; }
.iph-panel .ip-panel__foot .kv-btn { padding: 0 0.75em; }
.iph-panel .ip-panel__foot .kv-btn .kv-icon { width: 1.05em; height: 1.05em; }
`;

function injectCss(id, css) {
  if (typeof document === 'undefined') return;
  let el = document.getElementById(id);
  if (!el) {
    el = document.createElement('style');
    el.id = id;
    document.head.append(el);
  }
  if (el.textContent !== css) el.textContent = css;
}

const pad = (n) => String(n).padStart(2, '0');
const cm = (v) => fmtNumber(Math.round(v * 100), 0);
const today = () => {
  const d = new Date();
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
};
const round10 = (v) => Math.round(v / 10) * 10;
const rangeText = (min, max) => (Math.abs(max - min) < 1 ? fmtNok(min) : `${fmtNok(min).replace(' kr', '')}–${fmtNok(max)}`);

const cmT = (v) => `${cm(v)} cm`;

/**
 * The window panel's price estimate (WindowPanel._estimate), ported 1:1 for when no shared estimator is available:
 * ready-made pieces × price (shadingSize decides how many lengths/pieces fit), made to measure scaled from the
 * reference size in the catalogue (the «Fra-pris» in the price note is the minimum).
 * @returns {{ total: number|null, totalList: number|null, onSale: boolean, lines: string[], warns: { text: string, short: string }[] }}
 */
function estimateLocal(catalog, product, vi, spec, info) {
  const out = { total: null, totalList: null, onSale: false, lines: [], warns: [] };
  const sizing = shadingModule.productSizing;
  const sizeOf = shadingModule.shadingSize;
  if (!product || !spec || !info || typeof sizing !== 'function' || typeof sizeOf !== 'function') return out;
  const pr = catalog.priceOf ? catalog.priceOf(product, vi) : priceInfo(catalog, product, vi);
  const sz = sizing(product);
  const size = sizeOf(info, spec);
  if (!size || !sz) return out;
  const unit = pr.price;
  const list = pr.listPrice;
  out.onSale = pr.onSale;
  const note = product.priceNote || '';
  const fromM = note.match(/fra-pris\s*([\d\s ]+)\s*kr/i);
  const from = fromM ? Number(fromM[1].replace(/\D/g, '')) : 0;
  const curtain = product.archetype === 'curtain';
  if (unit == null) {
    out.lines.push('Butikken oppgir ingen pris.');
    return out;
  }
  if (sz.custom) {
    let f;
    if (curtain) {
      f = (size.track / sz.w) * Math.max(1, size.drop / sz.h);
      out.lines.push(`Sydd på mål for ${cmT(size.track)} skinne og ${cmT(size.drop)} høyde (regnet om fra ${fmtNok(unit)} for ${cm(sz.w)} × ${cmT(sz.h)}).`);
    } else {
      f = (size.width * size.drop) / (sz.w * sz.h);
      out.lines.push(`Måltilpasset til ${cm(size.width)} × ${cmT(size.drop)} (regnet om fra ${fmtNok(unit)} for ${cm(sz.w)} × ${cmT(sz.h)}).`);
    }
    let n = 1;
    if (sz.maxSize && (size.width > sz.maxSize[0] + 0.005 || size.drop > sz.maxSize[1] + 0.005)) {
      n = Math.ceil(size.width / sz.maxSize[0]);
      out.warns.push({ text: `Større enn maksmålet ${cm(sz.maxSize[0])} × ${cmT(sz.maxSize[1])} – må deles i ${n} stk.`, short: 'Over maksmål' });
    }
    out.total = Math.max(from * n, unit * f);
    if (list != null && list > unit) out.totalList = Math.max(from * n, list * f);
  } else {
    const n = size.pieces || 1;
    out.total = unit * n;
    if (list != null && list > unit) out.totalList = list * n;
    if (curtain) {
      const what = sz.pair
        ? `${n} par (${n * 2} lengder à ${cm(sz.w / 2)} × ${cmT(sz.h)})`
        : `${n} ${n === 1 ? 'lengde' : 'lengder'} à ${cm(sz.w)} × ${cmT(sz.h)}`;
      out.lines.push(`${what} gir ${fmtNumber(size.fullness, 1)} × fylde på ${cmT(size.track)} skinne.`);
      if (size.fullness < 1.4) out.warns.push({ text: 'Lite fylde: gardinen blir nesten flat når den er trukket for. Vurder flere lengder.', short: 'Lite fylde' });
      if (size.drop < size.needDrop - 0.01) out.warns.push({ text: `${cmT(size.needDrop - size.drop)} for kort – når ikke ned (trenger ${cmT(size.needDrop)}).`, short: 'For kort' });
      else if (sz.h > size.needDrop + 0.03) out.lines.push(`Legges opp til ca. ${cmT(size.needDrop)}.`);
    } else {
      out.lines.push(n > 1
        ? `Ferdigmål ${cm(sz.w)} × ${cmT(sz.h)}: ${n} stk. side om side (hver ca. ${cmT(size.pieceWidth)}).`
        : `Ferdigmål ${cm(sz.w)} × ${cmT(sz.h)}.`);
      if (size.short > 0.005) out.warns.push({ text: `${cmT(size.short)} for kort – vinduet trenger ${cmT(size.drop)}.`, short: 'For kort' });
      if (!sz.cuttable && size.mount === 'recess' && n === 1 && sz.w > size.width + 0.005) out.warns.push({ text: `${cmT(sz.w)} er bredere enn lysningen (${cmT(size.width)}). Velg en smalere størrelse.`, short: 'For bred' });
      if (n > 1 && !sz.cuttable) out.lines.push('Kan ikke kappes: velg bredder som til sammen passer.');
    }
  }
  const ship = note.match(/(?:fast frakt|frakt)\s*([\d\s ]+)\s*kr/i);
  if (ship) out.lines.push(`Frakt ca. ${fmtNok(Number(ship[1].replace(/\D/g, '')))} kommer i tillegg.`);
  if (/montering og elektriker/i.test(note)) out.lines.push('Montering og elektriker kommer i tillegg.');
  const ml = shadingModule.MOUNT_LABELS?.[size.mount];
  out.lines.push(`Mål: ${cm(size.width)} × ${cmT(size.drop)}, ${ml ? ml.toLowerCase() : size.mount}. Mål vinduet før du bestiller.`);
  return out;
}

/**
 * Estimated price and quantity of a shading product for one window – the SAME estimate the window panel shows.
 * @param {object} catalog catalog/index.js
 * @param {object} product
 * @param {object} spec    ShadingSpec
 * @param {object} win     WindowInfo (home.windows[] entry)
 * @param {{ estimate?: Function }} [o] estimator (product, variantIndex, spec, windowInfo) → { total, totalList, onSale, lines, warns }
 * @returns {{ qty: number, unit: number|null, total: number|null, listTotal: number|null, onSale: boolean, note: string, lines: string[], warn: string|null, warns: string[], madeToMeasure: boolean }}
 */
export function shadingEstimate(catalog, product, spec, win, { estimate } = {}) {
  const vi = Number.isInteger(spec?.variantIndex) ? spec.variantIndex : product.defaultVariant ?? 0;
  let est = null;
  const shared = typeof shadingModule.estimateShading === 'function' ? shadingModule.estimateShading : null;
  try {
    if (shared) est = shared(product, vi, spec, win);
    else if (typeof estimate === 'function') est = estimate(product, vi, spec, win);
  } catch (err) {
    console.warn('[shopping] shading estimate failed', product?.id, err);
    est = null;
  }
  if (!est || !Array.isArray(est.lines)) est = estimateLocal(catalog, product, vi, spec, win);
  const sz = shadingModule.productSizing?.(product) || null;
  let size = null;
  try {
    size = win && shadingModule.shadingSize ? shadingModule.shadingSize(win, spec) : null;
  } catch {
    size = null;
  }
  const mtm = !!sz?.custom;
  let qty = 1;
  if (!mtm) qty = Math.max(1, size?.pieces || 1);
  else if (sz?.maxSize && size && (size.width > sz.maxSize[0] + 0.005 || size.drop > sz.maxSize[1] + 0.005)) qty = Math.ceil(size.width / sz.maxSize[0]);
  const r = (v) => (mtm ? round10(v) : Math.round(v));
  const total = est.total != null ? r(est.total) : null;
  const listTotal = est.totalList != null && est.total != null && est.totalList > est.total ? r(est.totalList) : null;
  const warns = (est.warns || []).map((w) => (typeof w === 'string' ? w : w?.text)).filter(Boolean);
  const lines = (est.lines || []).filter(Boolean);
  return {
    qty,
    unit: total != null ? (mtm ? total : priceInfo(catalog, product, vi).price) : null,
    total,
    listTotal,
    onSale: !!est.onSale,
    madeToMeasure: mtm,
    // «ca.» unless it is exactly one ready-made piece at the store price
    approx: mtm || qty > 1,
    note: lines[0] || (total == null ? 'Pris ukjent' : ''),
    lines,
    warn: warns.length ? warns.join(' ') : null,
    warns,
    pair: !!sz?.pair && product.archetype === 'curtain',
  };
}

// ---------------------------------------------------------------------------------------------------------------
// The high wall

const PROPOSALS = wallData.proposals || [];

const stable = (v) => JSON.stringify(v, (k, x) => (typeof x === 'number' ? Math.round(x * 1000) / 1000 : x));

/** Quantity of an element in its own unit: tiles, pieces, metres or m². */
function elementMeasure(el) {
  const num = (v, fb) => (typeof v === 'number' && Number.isFinite(v) ? v : fb);
  switch (el?.type) {
    case 'checker': return { unit: 'stk', value: num(el.cols, 6) * num(el.rows, 3) };
    case 'circles':
    case 'hooks': return { unit: 'stk', value: (el.items || []).length || 1 };
    case 'hexagons': return { unit: 'stk', value: (el.items || []).length || num(el.count, 12) };
    case 'lamp-wall':
    case 'plant':
    case 'sideboard-floating': return { unit: 'stk', value: 1 };
    case 'led':
    case 'shelf': return { unit: 'm', value: num(el.w, 1) };
    default: {
      const b = elementBounds(el);
      return { unit: 'm²', value: b ? Math.max(0, (b.u1 - b.u0) * (b.v1 - b.v0)) : 0 };
    }
  }
}

/** Area of an element on the wall (m²) – weights the price share of each element type. */
function elementArea(el) {
  const b = elementBounds(el);
  return b ? Math.max(0.05, (b.u1 - b.u0) * (b.v1 - b.v0)) : 0.05;
}

/** { [type]: { measure, area, count } } for a list of elements. */
function byType(elements) {
  const out = {};
  for (const el of elements || []) {
    if (!el?.type) continue;
    const m = elementMeasure(el);
    const o = (out[el.type] ||= { measure: 0, unit: m.unit, area: 0, count: 0 });
    o.measure += m.value;
    o.area += elementArea(el);
    o.count++;
  }
  return out;
}

/** The material list worked out from the elements (identical elements grouped). */
function materialLines(elements) {
  const groups = new Map();
  for (const el of elements || []) {
    let text = describeElement(el);
    const m = elementMeasure(el);
    if (el.type === 'checker') text += ` = ${m.value} fliser`;
    else if (el.type === 'slats') {
      const b = elementBounds(el);
      const w = b ? b.u1 - b.u0 : el.w || 0;
      const hh = b ? b.v1 - b.v0 : el.h || 0;
      const cols = Math.max(1, Math.ceil(w / 0.6 - 0.05));
      text += ` – ca. ${fmtNumber(m.value, 1)} m² (≈ ${cols} akupanel${cols === 1 ? '' : 'er'} à 60 cm bredde, ${cm(hh)} cm lange)`;
    } else if (m.unit === 'm²' && !['paint-block', 'plant'].includes(el.type)) text += ` (${fmtNumber(m.value, 1)} m²)`;
    else if (el.type === 'paint-block') text += ` (ca. ${fmtNumber(m.value, 1)} m² maling)`;
    groups.set(text, (groups.get(text) || 0) + 1);
  }
  return [...groups.entries()].map(([t, n]) => (n > 1 ? `${n} × ${t}` : t));
}

/**
 * The built-in proposal a custom («Mitt forslag») or edited wall was made from.
 * @param {object} design DesignState (design.proposal(id) knows the built-in proposals)
 * @param {object|null} custom WallPanel custom entry
 * @param {object[]} elements current elements
 */
function baseProposal(design, custom, elements) {
  const byId = (id) => (id != null ? design.proposal?.(String(id)) || null : null);
  if (custom) {
    const b = custom.basedOn;
    const fromB = typeof b === 'string' ? byId(b) : b?.id ? byId(b.id) || (b.priceMin != null ? b : null) : null;
    if (fromB) return fromB;
    if (custom.baseId) {
      const p = byId(custom.baseId);
      if (p) return p;
    }
    // «Egen variant basert på forslag K – …» (WallPanel's description)
    const m = String(custom.description || '').match(/basert på forslag\s+([A-Za-z0-9]+)\s+–/);
    if (m) {
      const p = PROPOSALS.find((x) => x.code === m[1]) || byId(m[1]);
      if (p) return p;
    }
  }
  // same element types (and closest quantities) as a built-in proposal
  const cur = byType(elements);
  const keys = Object.keys(cur).sort().join(',');
  if (!keys) return null;
  let best = null;
  for (const p of PROPOSALS) {
    if (!p || String(p.id) === '0' || p.priceMin == null || !p.elements?.length) continue;
    const bt = byType(p.elements);
    if (Object.keys(bt).sort().join(',') !== keys) continue;
    let d = 0;
    for (const k of Object.keys(cur)) d += Math.abs(Math.log((cur[k].measure + 0.01) / (bt[k].measure + 0.01)));
    if (!best || d < best.d) best = { p, d };
  }
  return best && best.d < 1.2 ? best.p : null;
}

/**
 * Price and materials of the high wall as it is in the design.
 * @param {object} design DesignState
 * @param {{ customProposal?: (id: string) => object|null }} [o] lookup for «Mitt forslag» (WallPanel.proposal)
 * @returns {null | { kind: 'proposal'|'custom'|'own', proposal: object|null, base: object|null, custom: object|null,
 *   name: string, code: string, min: number, max: number, known: boolean, text: string, products: string[],
 *   baseProducts: string[], changed: boolean, edited: boolean, note: string|null, elements: number }}
 */
export function wallEstimate(design, { customProposal } = {}) {
  const w = design?.wall || {};
  const elements = Array.isArray(w.elements) ? w.elements : [];
  const pid = w.proposalId != null ? String(w.proposalId) : null;
  const builtIn = pid ? design.proposal?.(pid) || null : null;
  if (!elements.length && (!builtIn || String(builtIn.id) === '0' || !(builtIn.elements || []).length)) return null;
  if (builtIn && String(builtIn.id) === '0' && !elements.length) return null;
  let custom = null;
  if (!builtIn && pid) {
    try {
      custom = customProposal?.(pid) || null;
    } catch {
      custom = null;
    }
  }
  const base = builtIn && String(builtIn.id) !== '0' ? builtIn : baseProposal(design, custom, elements);
  const kind = builtIn && String(builtIn.id) !== '0' ? 'proposal' : custom || (pid && pid.startsWith('mitt-')) ? 'custom' : 'own';
  const baseEls = base?.elements || [];
  const same = !!base && stable(elements) === stable(baseEls);
  const cur = byType(elements);
  const ref = base ? byType(baseEls) : {};
  const types = new Set([...Object.keys(cur), ...Object.keys(ref)]);
  const qtySame = !!base && [...types].every((k) => cur[k] && ref[k] && Math.abs(cur[k].measure - ref[k].measure) < 0.005 * Math.max(1, ref[k].measure));
  const known = !!base && base.priceMin != null && Number.isFinite(Number(base.priceMin));
  const bMin = known ? Number(base.priceMin) || 0 : 0;
  const bMax = known ? Number(base.priceMax ?? base.priceMin) || bMin : 0;
  let min = bMin;
  let max = bMax;
  let text = base?.priceText || '';
  const notes = [];
  const added = [];
  if (base && !qtySame) {
    // scale per element type, weighted by the type's share of the proposal's area
    const totalArea = Object.values(ref).reduce((s, x) => s + x.area, 0) || 1;
    let factor = 0;
    for (const [k, r] of Object.entries(ref)) factor += (r.area / totalArea) * ((cur[k]?.measure || 0) / (r.measure || 1));
    for (const k of Object.keys(cur)) if (!ref[k]) added.push(ELEMENT_TYPES[k]?.label || k);
    const round100 = (v) => Math.round(v / 100) * 100;
    min = round100(bMin * factor);
    max = round100(bMax * factor);
    if (known) {
      const r = Math.abs(max - min) < 1 ? fmtNok(min) : `${fmtNok(min).replace(' kr', '')}–${fmtNok(max)}`;
      const orig = Math.abs(bMax - bMin) < 1 ? fmtNok(bMin) : `${fmtNok(bMin).replace(' kr', '')}–${fmtNok(bMax)}`;
      text = `ca. ${r}${added.length ? ' + det du har lagt til' : ''}, regnet om fra forslaget (${base.code}: ca. ${orig})`;
      notes.push(`Prisen er regnet om fra forslaget etter hvor mye som er på veggen nå (fliser, m², stk.)${added.length ? `. ${added.join(', ')} er ikke med i prisen` : ''}.`);
    } else {
      text = base.priceText || 'pris ukjent';
    }
  } else if (base && !same && (w.edited || kind !== 'proposal')) {
    notes.push('Du har endret farger eller plassering – mengdene og prisen er som i forslaget.');
  }
  if (!base) {
    min = 0;
    max = 0;
    text = 'pris ukjent';
    notes.push('Veggen er ikke et av forslagene, så prisen er ukjent – materialene under er regnet ut fra elementene.');
  }
  const changed = !!base && !qtySame;
  let products = changed || !base ? materialLines(elements) : Array.isArray(base.products) ? base.products : [];
  if (changed) {
    // a checker wall keeps the store's product line with the new tile count («Akupixel … – 12 stk (4 × 3)»)
    const ch = elements.filter((el) => el.type === 'checker');
    const re = /(\d+)\s*stk\s*\((\d+)\s*×\s*(\d+)\)/;
    const line = ch.length === 1 && (base.products || []).find((t) => re.test(t));
    if (line) {
      const c = ch[0];
      const cols = Number(c.cols) || 6;
      const rows = Number(c.rows) || 3;
      const was = line.match(re)[1];
      const i = products.findIndex((t) => t.startsWith(ELEMENT_TYPES.checker.label));
      const next = `${line.replace(re, `${cols * rows} stk (${cols} × ${rows})`)} – forslaget hadde ${was} stk`;
      if (i >= 0) products = [...products.slice(0, i), next, ...products.slice(i + 1)];
    }
  }
  const name = kind === 'custom'
    ? custom?.name ? `Mitt forslag «${custom.name}»` : 'Mitt forslag'
    : kind === 'own' ? 'Egen vegg' : `Forslag ${base.code} – ${base.name}`;
  const sub = kind !== 'proposal' && base ? `basert på forslag ${base.code} – ${base.name}` : null;
  return {
    kind,
    proposal: builtIn && String(builtIn.id) !== '0' ? builtIn : custom || base || null,
    base,
    custom,
    name,
    sub,
    code: kind === 'custom' ? custom?.code || 'M' : base?.code || '',
    min: known ? min : 0,
    max: known ? max : 0,
    known,
    text,
    products,
    baseProducts: changed && Array.isArray(base?.products) ? base.products : [],
    changed,
    edited: !!w.edited || kind !== 'proposal',
    note: notes.join(' ') || null,
    elements: elements.length,
  };
}

/** «2 par», «3 stk», «på mål». */
function shadingQty(est) {
  if (!est) return '';
  if (est.madeToMeasure) return est.qty > 1 ? `${est.qty} stk på mål` : 'på mål';
  return `${est.qty} ${est.pair ? 'par' : 'stk'}`;
}

const csvCell = (v) => {
  const s = v == null ? '' : String(v);
  return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

export class ShoppingPanel extends BasePanel {
  /** @param {import('../design/Editor.js').Editor} editor */
  constructor(editor) {
    super(editor, { id: 'shopping', title: 'Handleliste', side: 'right', width: 27, className: 'iph-panel' });
    injectCss('iph-css', CSS);
    // the same bag as the toolbar button (ui/icons.js has no bag icon)
    this.el.querySelector('.ip-panel__head')?.prepend(h('span.ip-panel__icon', {}, svg(IC.bag)));
    this._dirty = false;
    this._off = editor.design.on('change', (e) => {
      if (e?.type !== 'meta') this._dirty = true;
    });
    const copy = button({ label: 'Kopier liste', size: 'sm', title: 'Kopier listen som tekst', onClick: () => this.copy() });
    copy.prepend(svg(IC.copy));
    const csv = button({ label: 'Last ned CSV', size: 'sm', title: 'Last ned listen som regneark (CSV)', onClick: () => this.downloadCsv() });
    csv.prepend(svg(IC.csv));
    const print = button({ label: 'Skriv ut', size: 'sm', title: 'Skriv ut handlelisten', onClick: () => this.print() });
    print.prepend(svg(IC.print));
    this.foot.append(copy, csv, print);
  }

  onOpen() {
    this.editor.ui?.toolbar?.exitCompare?.({ quiet: true });
    this._render();
  }

  update() {
    if (this._dirty && this.isOpen) {
      this._dirty = false;
      this._render();
    }
  }

  /**
   * The shopping list as data.
   * @returns {{ stores: Array<{ store: string, rows: object[], total: number }>, wall: object|null, shading: object[], removed: object[], total: { min: number, max: number }, count: number, unknown: number }}
   */
  list() {
    const e = this.editor;
    const cat = e.catalog;
    const d = e.design;
    // catalogue items, merged per product + variant + colours/materials/size
    const groups = new Map();
    for (const it of d.list()) {
      if (it.source !== 'catalog' || it.hidden) continue;
      const p = cat.getProduct(it.refId);
      if (!p) continue;
      const key = JSON.stringify([p.id, it.variantIndex, it.colors, it.materials, it.dims]);
      const g = groups.get(key);
      if (g) g.qty++;
      else groups.set(key, { product: p, item: it, qty: 1 });
    }
    const byStore = new Map();
    let total = 0;
    let unknown = 0;
    let count = 0;
    for (const g of groups.values()) {
      const p = g.product;
      const vi = g.item.variantIndex ?? p.defaultVariant ?? 0;
      const info = priceInfo(cat, p, vi);
      const v = p.variants?.[vi];
      const custom = v && (Object.entries(g.item.colors || {}).some(([k, c]) => v.colors?.[k] && String(v.colors[k]).toLowerCase() !== String(c).toLowerCase())
        || Object.entries(g.item.materials || {}).some(([k, m]) => v.materials?.[k] && v.materials[k] !== m));
      const customDims = ['w', 'd', 'h'].some((k) => Math.abs((g.item.dims?.[k] ?? 0) - (p.dims?.[k] ?? 0)) > 0.005);
      const row = {
        product: p,
        variantIndex: vi,
        variant: v?.name || '',
        qty: g.qty,
        unit: info.price,
        listUnit: info.onSale ? info.listPrice : null,
        sum: info.price != null ? info.price * g.qty : null,
        onSale: info.onSale,
        from: info.from,
        url: v?.url || p.url,
        custom: !!custom,
        customDims,
        category: p.category,
        categoryLabel: cat.categoryLabel?.(p.category) || '',
      };
      if (row.sum != null) total += row.sum;
      else unknown++;
      count += g.qty;
      const st = p.store || 'Annet';
      if (!byStore.has(st)) byStore.set(st, []);
      byStore.get(st).push(row);
    }
    // inside a store: grouped by catalogue category (Lenestoler, Skjenker, Vitrineskap, Taklamper …), then by name
    const catOrder = (key) => {
      const i = (cat.CATEGORIES || []).findIndex((c) => c.key === key);
      return i < 0 ? 99 : i;
    };
    for (const rows of byStore.values()) rows.sort((a, b) => catOrder(a.product.category) - catOrder(b.product.category) || String(a.product.name).localeCompare(String(b.product.name), 'nb'));
    const stores = [...byStore.entries()].map(([store, rows]) => ({ store, rows, total: rows.reduce((s, r) => s + (r.sum || 0), 0) }))
      .sort((a, b) => b.total - a.total);

    // the high wall (built-in proposal, edited proposal, «Mitt forslag» or own elements)
    let wall = null;
    try {
      wall = wallEstimate(d, { customProposal: (id) => e.ui?.wall?.proposal?.(id) || null });
    } catch (err) {
      console.warn('[shopping] wall estimate failed', err);
      wall = null;
    }

    // window shading (the window panel's own estimate)
    const shading = [];
    const wp = e.ui?.window;
    const estimate = typeof wp?._estimate === 'function' ? (p, vi, spec, win) => wp._estimate(p, vi, spec, win) : undefined;
    for (const [winId, spec] of Object.entries(d.windows || {})) {
      if (!spec) continue;
      const p = spec.productId ? cat.getProduct(spec.productId) : null;
      const win = (e.home?.windows || []).find((w) => w.id === winId) || (e.layout?.windows || []).find((w) => w.id === winId);
      if (!p) {
        shading.push({ window: win, windowId: winId, product: null, est: null, label: 'Egen solskjerming (ikke fra katalogen)' });
        continue;
      }
      const vi = Number.isInteger(spec.variantIndex) ? spec.variantIndex : p.defaultVariant ?? 0;
      const est = shadingEstimate(cat, p, spec, win, { estimate });
      shading.push({ window: win, windowId: winId, product: p, est, variantIndex: vi, variant: p.variants?.[vi]?.name || '', url: p.variants?.[vi]?.url || p.url || '' });
    }
    const shadingTotal = shading.reduce((s, x) => s + (x.est?.total || 0), 0);

    // what leaves the room (today's furniture that is gone or swapped)
    const removed = [];
    try {
      for (const o of d.originalJSON().items) {
        const cur = d.get(o.uid);
        if (!cur) removed.push({ name: o.name, how: 'fjernet' });
        else if (cur.source === 'catalog') removed.push({ name: o.name, how: `byttet ut med ${cur.name}` });
      }
    } catch {
      /* optional */
    }

    const min = total + shadingTotal + (wall?.min || 0);
    const max = total + shadingTotal + (wall?.max || 0);
    return { stores, wall, shading, shadingTotal, removed, total: { min, max }, count, unknown };
  }

  _render() {
    const data = this.list();
    const scroll = this.body.scrollTop;
    const kids = [];
    const nothing = !data.stores.length && !data.wall && !data.shading.length;
    if (nothing) {
      kids.push(emptyState('Ingenting nytt i designet ennå. Legg til møbler, lamper og tekstiler fra katalogen (K), velg et veggforslag (V) eller solskjerming (B) – så havner de her med pris og lenke.', 'info'));
      const b = button({ label: 'Åpne katalogen', variant: 'primary', size: 'sm', onClick: () => this.editor.ui.catalog?.open?.() });
      kids.push(h('div', { style: { display: 'flex', justifyContent: 'center' } }, b));
      this.body.replaceChildren(...kids);
      this.foot.hidden = true;
      return;
    }
    this.foot.hidden = false;
    const approx = data.wall || data.shading.some((s) => s.est?.approx) ? 'ca. ' : '';
    const wallUnknown = data.wall && !data.wall.known;
    kids.push(h('div.iph-total', {},
      h('span', {}, 'Totalt', h('small', { text: `${data.count} ${data.count === 1 ? 'vare' : 'varer'}${data.wall ? wallUnknown ? ' + vegg (pris ukjent)' : ' + vegg' : ''}${data.shading.length ? ` + solskjerming på ${data.shading.length} ${data.shading.length === 1 ? 'vindu' : 'vinduer'}` : ''}` })),
      h('b', { text: `${approx}${rangeText(data.total.min, data.total.max)}` })));

    for (const st of data.stores) {
      kids.push(h('div.iph-store', {},
        h('div.iph-store__head', {}, h('h3', { text: st.store }), h('span', { text: `${st.rows.reduce((s, r) => s + r.qty, 0)} stk · ${fmtNok(st.total)}` })),
        h('div.iph-rows', {}, st.rows.map((r) => this._row(r)))));
    }

    if (data.wall) {
      const w = data.wall;
      const priceText = w.known ? w.text || rangeText(w.min, w.max) : w.text || 'pris ukjent';
      kids.push(section('Den høye veggen', h('div.iph-wall', {},
        h('div.iph-wall__head', {}, h('span.iph-wall__name', { text: w.name }), h(`span.iph-row__price${w.known ? '' : '.is-unknown'}`, { text: priceText })),
        w.sub ? h('div.iph-row__sub', { text: w.sub, title: w.sub }) : null,
        w.note ? h('p.iph-foot-note.iph-wall__note', { text: w.note }) : null,
        w.products.length ? h('div.iph-wall__list', {}, w.changed || !w.base ? h('div.iph-wall__lh', { text: 'Materialer slik veggen er nå' }) : null,
          h('ul', {}, w.products.map((t) => h('li', { text: t })))) : null,
        w.baseProducts.length ? h('details.iph-wall__orig', {}, h('summary', { text: `Materialliste for forslag ${w.base.code} slik det var` }),
          h('ul', {}, w.baseProducts.map((t) => h('li', { text: t })))) : null)));
    }

    if (data.shading.length) {
      kids.push(section('Solskjerming', h('div.iph-rows', {}, data.shading.map((s) => this._shadingRow(s)))));
    }

    if (data.removed.length) {
      kids.push(section('Ut av stua', h('ul.iph-removed', {}, data.removed.slice(0, 12).map((r) => h('li', { text: `${r.name} – ${r.how}` }))),
        data.removed.length > 12 ? h('p.iph-foot-note', { text: `… og ${data.removed.length - 12} til` }) : null));
    }
    kids.push(h('p.iph-foot-note', { text: `Prisene er hentet fra butikkenes nettsider i oktober 2026${data.unknown ? `; ${data.unknown} vare(r) mangler pris` : ''}. Sjekk pris og lagerstatus hos butikken før du bestiller.` }));
    this.body.replaceChildren(...kids);
    this.body.scrollTop = scroll;
  }

  _row(r) {
    const p = r.product;
    const imgBox = h('div.iph-row__img');
    const url = cachedThumbnail(p, r.variantIndex, { w: 160, h: 120 });
    if (url) imgBox.append(h('img', { src: url, alt: '' }));
    else {
      const icon = this.editor.catalog?.CATEGORIES?.find((c) => c.key === p.category)?.icon;
      imgBox.append(svg(ICONS[icon] || ICONS.sofa));
      thumbnail(p, r.variantIndex, { w: 160, h: 120 }).then((u) => {
        if (u) imgBox.replaceChildren(h('img', { src: u, alt: '' }));
      });
    }
    const sub = [r.variant, r.custom ? 'egen farge' : null, r.customDims ? 'egne mål' : null].filter(Boolean).join(' · ');
    const price = r.sum != null
      ? h(`span.iph-row__price${r.onSale ? '.is-sale' : ''}`, {}, `${r.from ? 'fra ' : ''}${fmtNok(r.sum)}`, r.listUnit ? h('s', { text: fmtNok(r.listUnit * r.qty) }) : null)
      : h('span.iph-row__price', { text: 'Pris ukjent' });
    return h('div.iph-row', {},
      imgBox,
      h('div.iph-row__main', {},
        h('div.iph-row__name', { text: p.name, title: r.categoryLabel ? `${p.name} (${r.categoryLabel})` : p.name }),
        h(`div.iph-row__sub${r.custom || r.customDims ? '.is-warn' : ''}`, { text: sub || p.brand || '', title: r.custom || r.customDims ? 'Du har endret farge/mål – sjekk at butikken har det' : sub })),
      h('div.iph-row__right', {},
        price,
        h('span.iph-row__qty', { text: r.qty > 1 ? `${r.qty} × ${fmtNok(r.unit)}` : '1 stk' }),
        r.url ? h('a.iph-link', { href: r.url, target: '_blank', rel: 'noopener noreferrer', title: `Åpne hos ${p.store}` }, 'Åpne', svg(EXTRA_ICONS.link)) : null));
  }

  _shadingRow(s) {
    const winName = s.window?.name || s.windowId;
    if (!s.product) {
      return h('div.iph-row', {}, h('div.iph-row__img', {}, svg(ICONS.blinds)),
        h('div.iph-row__main', {}, h('div.iph-row__name', { text: winName }), h('div.iph-row__sub', { text: s.label })), h('div.iph-row__right'));
    }
    const p = s.product;
    const est = s.est;
    const price = est.total != null
      ? h(`span.iph-row__price${est.onSale ? '.is-sale' : ''}`, {}, `${est.approx ? 'ca. ' : ''}${fmtNok(est.total)}`, est.listTotal ? h('s', { text: fmtNok(est.listTotal) }) : null)
      : h('span.iph-row__price', { text: 'Pris ukjent' });
    const imgBox = h('div.iph-row__img');
    const url = cachedThumbnail(p, s.variantIndex, { w: 160, h: 120 });
    if (url) imgBox.append(h('img', { src: url, alt: '' }));
    else {
      imgBox.append(svg(ICONS.blinds));
      thumbnail(p, s.variantIndex, { w: 160, h: 120 }).then((u) => {
        if (u) imgBox.replaceChildren(h('img', { src: u, alt: '' }));
      });
    }
    const all = est.lines.join(' ');
    return h('div.iph-row', {},
      imgBox,
      h('div.iph-row__main', {},
        h('div.iph-row__name', { text: `${winName}: ${p.name}`, title: `${winName}: ${p.name}` }),
        h('div.iph-row__sub', { text: `${p.store}${s.variant ? ` · ${s.variant}` : ''}`, title: s.variant }),
        est.lines.length ? h('div.iph-row__sub.iph-row__lines', { text: all, title: all }) : null,
        est.warn ? h('div.iph-row__sub.is-warn', { text: est.warn }) : null),
      h('div.iph-row__right', {},
        price,
        h('span.iph-row__qty', { text: !est.madeToMeasure && est.qty > 1 ? `${shadingQty(est)} × ${fmtNok(est.unit)}` : shadingQty(est) }),
        s.url ? h('a.iph-link', { href: s.url, target: '_blank', rel: 'noopener noreferrer', title: `Åpne hos ${p.store}` }, 'Åpne', svg(EXTRA_ICONS.link)) : null));
  }

  // ---- export --------------------------------------------------------------------------------------------------

  /** The list as plain text (for the clipboard). */
  text() {
    const data = this.list();
    const name = this.editor.design.meta?.name;
    const lines = [`Handleliste – ${name && name !== 'Original' ? name : 'stua'} (${today()})`, ''];
    for (const st of data.stores) {
      lines.push(st.store.toUpperCase());
      for (const r of st.rows) {
        lines.push(`- ${r.product.name}${r.variant ? ` (${r.variant})` : ''} – ${r.qty} stk – ${r.sum != null ? fmtNok(r.sum) : 'pris ukjent'}${r.onSale ? ' (tilbud)' : ''}`);
        if (r.url) lines.push(`  ${r.url}`);
      }
      lines.push('');
    }
    if (data.wall) {
      const w = data.wall;
      lines.push(`DEN HØYE VEGGEN: ${w.name}${w.sub ? ` (${w.sub})` : ''}: ${w.known ? w.text || rangeText(w.min, w.max) : w.text || 'pris ukjent'}`);
      if (w.note) lines.push(`  ${w.note}`);
      for (const t of w.products) lines.push(`  • ${t}`);
      lines.push('');
    }
    if (data.shading.length) {
      lines.push('SOLSKJERMING');
      for (const s of data.shading) {
        const w = s.window?.name || s.windowId;
        if (!s.product) lines.push(`- ${w}: egen solskjerming`);
        else {
          const e = s.est;
          lines.push(`- ${w}: ${s.product.name}${s.variant ? ` (${s.variant})` : ''}, ${s.product.store} – ${shadingQty(e)} – ${e.total != null ? `${e.approx ? 'ca. ' : ''}${fmtNok(e.total)}` : 'pris ukjent'}`);
          for (const l of e.lines) lines.push(`  ${l}`);
          for (const x of e.warns) lines.push(`  OBS: ${x}`);
          if (s.url) lines.push(`  ${s.url}`);
        }
      }
      lines.push('');
    }
    lines.push(`TOTALT: ca. ${rangeText(data.total.min, data.total.max)}`);
    lines.push('Prisene er hentet i oktober 2026 – sjekk hos butikken før du bestiller.');
    return lines.join('\n');
  }

  /** Copies the list to the clipboard. */
  async copy() {
    const text = this.text();
    let ok = false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        ok = true;
      }
    } catch {
      ok = false;
    }
    if (!ok) {
      try {
        const ta = h('textarea', { style: { position: 'fixed', left: '-9999px', top: '0' } });
        ta.value = text;
        document.body.append(ta);
        ta.select();
        ok = document.execCommand('copy');
        ta.remove();
      } catch {
        ok = false;
      }
    }
    this.editor.events.emit('toast', { text: ok ? 'Handlelisten er kopiert' : 'Klarte ikke å kopiere – prøv «Last ned CSV».', seconds: 2.5 });
    return ok;
  }

  /** The list as CSV (semicolon separated, for Norwegian Excel). */
  csv() {
    const data = this.list();
    const rows = [['Butikk', 'Produkt', 'Variant', 'Antall', 'Stykkpris', 'Sum', 'Merknad', 'Lenke']];
    for (const st of data.stores) {
      for (const r of st.rows) rows.push([st.store, r.product.name, r.variant, r.qty, r.unit ?? '', r.sum ?? '', [r.onSale ? 'tilbud' : '', r.custom ? 'egen farge' : '', r.customDims ? 'egne mål' : ''].filter(Boolean).join(', '), r.url || '']);
    }
    if (data.wall) {
      const w = data.wall;
      rows.push(['Den høye veggen', `${w.name}${w.sub ? ` (${w.sub})` : ''}`, '', 1, w.known ? w.min : '', w.known ? (w.min === w.max ? w.max : `${w.min}–${w.max}`) : '', [w.text, w.note].filter(Boolean).join(' – '), '']);
      for (const t of w.products) rows.push(['', `• ${t}`, '', '', '', '', '', '']);
    }
    for (const s of data.shading) {
      if (!s.product) continue;
      const e = s.est;
      rows.push([s.product.store, `${s.window?.name || s.windowId}: ${s.product.name}`, s.variant, shadingQty(e), e.madeToMeasure ? '' : e.unit ?? '', e.total ?? '', [e.approx ? 'ca.' : '', ...e.lines, ...e.warns.map((x) => `OBS: ${x}`)].filter(Boolean).join(' '), s.url || '']);
    }
    rows.push(['', 'Totalt', '', '', '', data.total.min === data.total.max ? data.total.min : `${data.total.min}–${data.total.max}`, '', '']);
    return `﻿${rows.map((r) => r.map(csvCell).join(';')).join('\r\n')}`;
  }

  /** Downloads «handleliste-YYYY-MM-DD.csv». */
  downloadCsv() {
    try {
      const d = new Date();
      const name = `handleliste-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.csv`;
      const blob = new Blob([this.csv()], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = h('a', { href: url, download: name, style: { display: 'none' } });
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      this.editor.events.emit('toast', { text: `Lastet ned ${name}`, seconds: 2.5 });
    } catch (err) {
      console.warn('[shopping] csv failed', err);
      this.editor.events.emit('toast', { text: 'Klarte ikke å lage CSV-filen.', seconds: 3 });
    }
  }

  /** Prints the list (a clean page in a hidden frame). */
  print() {
    const data = this.list();
    const name = this.editor.design.meta?.name;
    const row = (cells) => `<tr>${cells.map((c, i) => `<td${i >= 2 ? ' class="n"' : ''}>${c}</td>`).join('')}</tr>`;
    let body = '';
    for (const st of data.stores) {
      body += `<h2>${esc(st.store)}</h2><table>${st.rows.map((r) => row([
        `<b>${esc(r.product.name)}</b>${r.variant ? `<br><small>${esc(r.variant)}</small>` : ''}${r.url ? `<br><small class="u">${esc(r.url)}</small>` : ''}`,
        r.custom || r.customDims ? '<small>egen farge/mål</small>' : '',
        `${r.qty} stk`,
        r.sum != null ? esc(fmtNok(r.sum)) + (r.onSale ? ' <small>(tilbud)</small>' : '') : 'pris ukjent',
      ])).join('')}</table>`;
    }
    if (data.wall) {
      const w = data.wall;
      body += `<h2>Den høye veggen</h2><p><b>${esc(w.name)}</b>${w.sub ? ` <small>(${esc(w.sub)})</small>` : ''}: ${esc(w.known ? w.text || rangeText(w.min, w.max) : w.text || 'pris ukjent')}</p>${w.note ? `<p><small>${esc(w.note)}</small></p>` : ''}${w.products.length ? `<ul>${w.products.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}`;
    }
    if (data.shading.length) {
      body += `<h2>Solskjerming</h2><table>${data.shading.filter((s) => s.product).map((s) => row([
        `<b>${esc(s.window?.name || s.windowId)}: ${esc(s.product.name)}</b><br><small>${esc(s.product.store)}${s.variant ? ` · ${esc(s.variant)}` : ''} – ${esc(s.est.lines.join(' '))}</small>${s.est.warns.length ? `<br><small><b>OBS:</b> ${esc(s.est.warns.join(' '))}</small>` : ''}${s.url ? `<br><small class="u">${esc(s.url)}</small>` : ''}`,
        '',
        shadingQty(s.est),
        s.est.total != null ? `${s.est.approx ? 'ca. ' : ''}${esc(fmtNok(s.est.total))}` : 'pris ukjent',
      ])).join('')}</table>`;
    }
    const html = `<!doctype html><html lang="nb"><head><meta charset="utf-8"><title>Handleliste</title><style>
      body { font: 11pt/1.4 'Segoe UI', system-ui, sans-serif; color: #111; margin: 18mm; }
      h1 { font-size: 18pt; margin: 0 0 2mm; } .sub { color: #666; margin: 0 0 6mm; }
      h2 { font-size: 11pt; text-transform: uppercase; letter-spacing: .08em; border-bottom: 1px solid #ccc; padding-bottom: 1mm; margin: 6mm 0 2mm; }
      table { width: 100%; border-collapse: collapse; } td { padding: 1.6mm 0; border-bottom: 1px solid #eee; vertical-align: top; }
      td.n { text-align: right; white-space: nowrap; padding-left: 4mm; } small { color: #666; } .u { color: #888; word-break: break-all; }
      .total { margin-top: 8mm; font-size: 14pt; text-align: right; } .note { color: #777; font-size: 9pt; margin-top: 6mm; }
    </style></head><body><h1>Handleliste</h1><p class="sub">${esc(name && name !== 'Original' ? name : 'Stua')} · ${today()}</p>${body}
      <p class="total">Totalt: <b>ca. ${esc(rangeText(data.total.min, data.total.max))}</b></p>
      <p class="note">Prisene er hentet fra butikkenes nettsider i oktober 2026. Sjekk pris og lagerstatus før du bestiller.</p></body></html>`;
    try {
      const frame = h('iframe', { style: { position: 'fixed', width: '0', height: '0', border: '0', right: '0', bottom: '0' }, 'aria-hidden': 'true' });
      document.body.append(frame);
      const doc = frame.contentDocument;
      doc.open();
      doc.write(html);
      doc.close();
      setTimeout(() => {
        try {
          frame.contentWindow.focus();
          frame.contentWindow.print();
        } finally {
          setTimeout(() => frame.remove(), 1500);
        }
      }, 150);
    } catch (err) {
      console.warn('[shopping] print failed', err);
      this.editor.events.emit('toast', { text: 'Klarte ikke å skrive ut.', seconds: 3 });
    }
  }

  dispose() {
    this._off?.();
    super.dispose();
  }
}

export default ShoppingPanel;
