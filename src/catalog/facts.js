import { spotFacts } from './spotfacts.js';
import { artFacts } from './artfacts.js';

/**
 * Extra «Fakta» rows of a product by archetype family (the catalogue detail view, ui/CatalogPanel.js typeFacts):
 * spots and downlights (spotfacts.js) and art (artfacts.js). Each source owns its rows; one that fails is left out
 * (logged), so the detail view always opens.
 * @param {Object} p  product
 * @param {Object} P  the product's params with the variant's on top
 * @param {{ catalog?: Object, vi?: number }} [ctx]
 * @returns {Array<[string, string]>} Norwegian [label, value] rows
 */
export function extraFacts(p, P, ctx = {}) {
  const out = [];
  for (const facts of [spotFacts, artFacts]) {
    try {
      const rows = facts(p, P, ctx);
      if (Array.isArray(rows)) out.push(...rows);
    } catch (err) {
      console.warn('[catalog] facts failed', p?.id, err);
    }
  }
  return out;
}
