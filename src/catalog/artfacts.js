import { FRAME_PROFILES, LAYOUT_OPTIONS, artLayout, galleryLayout } from '../models/artlayout.js';

/**
 * Extra «Fakta» rows of kunst products (design/art.md, MASTER §4.2 P04): «Ramme», «Passepartout», «Glass»,
 * «Selges uten ramme», «Selges tom» (legg inn ditt eget bilde), and for gallery walls «Bildevegg».
 *   artFacts(product, params, { catalog, vi }) → Array<[label, value]> (Norwegian)
 * `params` are the product's params with the variant's on top (ui/CatalogPanel.js typeFacts). Pure (no DOM, no three).
 */

/** Norwegian names of frame materials (materials.frame of the variant). */
const FRAME_KINDS = {
  'black-metal': 'sort metall', steel: 'aluminium', brass: 'messing / gull', painted: 'malt',
  oak: 'eik', 'white-oak': 'lys eik', 'smoked-oak': 'røkt eik', 'black-oak': 'sortbeiset eik', walnut: 'valnøtt',
  ash: 'ask', teak: 'teak', pine: 'furu', plastic: 'plast',
};

/** «2,2 cm» (Norwegian decimal comma, at most one decimal). */
const cm = (m) => `${String(Math.round(m * 1000) / 10).replace('.', ',')} cm`;

/** «Treramme, eik, 2,2 cm» – the profile label, the frame material and the frame width. */
function frameText(P, kind, fw) {
  const prof = Object.hasOwn(FRAME_PROFILES, P.frame ?? 'black') ? FRAME_PROFILES[P.frame ?? 'black'] : null;
  const bits = [prof ? prof.label : 'Ramme'];
  if (kind && FRAME_KINDS[kind]) bits.push(FRAME_KINDS[kind]);
  if (fw > 0.001 && P.frame !== 'hanger') bits.push(cm(fw));
  return bits.join(', ');
}

/**
 * @param {Object} p  product
 * @param {Object} P  the product's params with the variant's on top
 * @param {{ catalog?: Object, vi?: number }} [ctx]
 * @returns {Array<[string, string]>}
 */
export function artFacts(p, P = {}, ctx = {}) {
  if (!p || (p.archetype !== 'art-frame' && p.archetype !== 'art-set')) return [];
  P = P || {};
  const v = p.variants?.[ctx?.vi ?? p.defaultVariant ?? 0] || p.variants?.[0] || {};
  const kind = v.materials?.frame || null;
  const out = [];
  if (p.archetype === 'art-set') {
    const lay = galleryLayout(P.layout, { frames: P.frames, gap: P.gap });
    const n = lay.frames.length;
    const name = (LAYOUT_OPTIONS.find(([k]) => k === (P.layout === 'custom' ? null : lay.layout)) || [])[1];
    out.push(['Bildevegg', `${n} ${n === 1 ? 'bilde' : 'bilder'}${name ? ` (${name.toLowerCase()})` : ''}`]);
    if ((P.frame ?? 'thin') !== 'none') out.push(['Ramme', frameText({ frame: P.frame ?? 'thin' }, kind, 0)]);
    if (P.mat !== false) out.push(['Passepartout', 'Ja']);
    if (P.glass) out.push(['Glass', 'Ja']);
    return out;
  }
  const L = artLayout(p.dims || {}, P);
  const poster = !L.framed && (L.texture === 'paper' || L.texture === 'photo');
  if (P.acceptsImage) out.push(['Selges tom', 'Ja – legg inn ditt eget bilde (Last opp eget bilde)']);
  if (poster) out.push(['Selges uten ramme', 'Ja – rammen kjøpes separat']);
  else if (!L.framed) out.push(['Ramme', 'Uten ramme – lerret på blindramme']);
  else out.push(['Ramme', frameText(P, kind, L.fw)]);
  if (L.matW > 0) {
    // a wider mat over and under (params.matH): both widths and the window it leaves («åpning 40 × 50 cm»)
    out.push(['Passepartout', Math.abs(L.matH - L.matW) < 0.0005 ? `Ja, ${cm(L.matW)}`
      : `Ja, ${cm(L.matW)} på sidene og ${cm(L.matH)} over og under (åpning ${cm(L.picW).replace(' cm', '')} × ${cm(L.picH)})`]);
  }
  if (P.glass && L.framed) out.push(['Glass', 'Ja']);
  return out;
}
