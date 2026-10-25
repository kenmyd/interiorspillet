/**
 * Kinds of high-wall proposals for the proposal browser (WallPanel): what the wall is mostly made of – slats, felt and
 * fabric, pictures, a combination, or something else. Pure (no DOM, no three.js), so the Node tests can use it.
 *
 *   classifyProposal(p) → { category, tags }   category = one of WALL_CATEGORIES (the section the card sits in),
 *                                              tags = every chip that lists it (category, the other materials that
 *                                              cover a fair part of the wall, 'sekskanter' when it has hexagons)
 *
 * Derived from the elements (so «Mine forslag» are sorted too): each element's face area counts for its family,
 * accessories (shelves, sideboards, lamps, LED, plants, hooks, mirrors) count for nothing, and paint and mouldings only
 * when there is nothing else (a painted niche in a slat wall is still a slat wall). A proposal may set `category` /
 * `tags` itself where the elements say something else than the idea.
 */

export const WALL_CATEGORIES = Object.freeze([
  { id: 'spiler', label: 'Spiler' },
  { id: 'filt', label: 'Filt og stoff' },
  { id: 'bilder', label: 'Bilder' },
  { id: 'kombinert', label: 'Kombinert' },
  { id: 'diverse', label: 'Diverse' },
]);

/** The filter chips, in order (a proposal can be in several). */
export const WALL_TAGS = Object.freeze([
  { id: 'spiler', label: 'Spiler' },
  { id: 'filt', label: 'Filt og stoff' },
  { id: 'sekskanter', label: 'Sekskanter' },
  { id: 'bilder', label: 'Bilder' },
  { id: 'kombinert', label: 'Kombinert' },
  { id: 'diverse', label: 'Diverse' },
]);

const SOFT = new Set(['fabric', 'felt', 'linen', 'velvet', 'wool', 'boucle', 'cotton', 'velour', 'woven']);
const WOOD = new Set(['oak', 'white-oak', 'smoked-oak', 'walnut', 'black-oak', 'teak', 'ash']);
const HEX_AREA = Math.sqrt(3) / 2;
/** Share of the covered area a material needs to count as part of the idea (pictures are small next to a slat wall). */
const PRESENT = { spiler: 0.12, filt: 0.12, bilder: 0.08, diverse: 0.15 };

const num = (v, fb = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : fb);

/** [family, m², extra tag?] for one element (empty for accessories). */
function parts(el) {
  const rect = () => num(el.w) * num(el.h);
  switch (el?.type) {
    case 'slats':
      // filtlameller are felt that looks like slats: under «Filt og stoff», and also listed with the slats
      return el.wood === 'felt' ? [['filt', rect(), 'spiler']] : [['spiler', rect()]];
    case 'checker': {
      const tile = num(el.tile, 0.6);
      const a = el.cols && el.rows ? el.cols * el.rows * tile * tile : rect();
      if (el.fill === 'felt') return [['filt', a]];
      if (el.fill === 'wood-felt') return [['spiler', a / 2], ['filt', a / 2]];
      return [['spiler', a]];
    }
    case 'panel': {
      const s = el.surface || 'fabric';
      if (SOFT.has(s)) return [['filt', rect()]];
      return s === 'cork' ? [['diverse', rect()]] : [];
    }
    case 'circles': {
      const a = (el.items || []).reduce((s, c) => s + Math.PI * num(c.r, 0.4) ** 2, 0);
      return [[SOFT.has(el.surface || 'felt') ? 'filt' : 'diverse', a]];
    }
    case 'hexagons': {
      const one = HEX_AREA * num(el.size, 0.52) ** 2;
      const items = Array.isArray(el.items) && el.items.length ? el.items : null;
      // wooden tiles are accents in a felt or moss honeycomb: they only count when the whole honeycomb is wood
      const fam = (s) => (SOFT.has(s) ? 'filt' : WOOD.has(s) ? 'flat' : 'diverse');
      if (!items) return [[fam(el.surface), one * Math.max(1, num(el.count, 12))]];
      return items.map((it) => [fam(it.surface || el.surface), one]);
    }
    case 'art':
      return [['bilder', rect()]];
    case 'ledge':
      return [['bilder', num(el.w) * (el.items || []).reduce((s, it) => Math.max(s, num(it.h, 0.5)), 0.3)]];
    case 'curtain':
      return [['diverse', num(el.w) * Math.max(0, num(el.top, 3) - num(el.bottom, 0))]];
    case 'tapestry':
    case 'moss':
    case 'wallpaper':
    case 'bookcase':
      return [['diverse', rect()]];
    case 'paint-block':
    case 'moulding':
      return [['flat', rect()]];
    default:
      return [];
  }
}

/**
 * @param {{ elements?: object[], category?: string, tags?: string[] }} p
 * @returns {{ category: string, tags: string[] }}
 */
export function classifyProposal(p) {
  const area = { spiler: 0, filt: 0, bilder: 0, diverse: 0 };
  let hex = false, flat = 0;
  const extra = new Set();
  for (const el of p?.elements || []) {
    if (el?.type === 'hexagons') hex = true;
    for (const [f, a, tag] of parts(el)) {
      if (f === 'flat') flat += a;
      else area[f] += a;
      if (tag && a > 0) extra.add(tag);
    }
  }
  if (!Object.values(area).some((a) => a > 0)) area.diverse = flat;
  const total = Object.values(area).reduce((s, a) => s + a, 0);
  let category = 'diverse';
  const tags = new Set();
  if (total > 0) {
    const share = Object.fromEntries(Object.entries(area).map(([f, a]) => [f, a / total]));
    const present = Object.keys(area).filter((f) => share[f] >= PRESENT[f]);
    const top = Object.keys(area).reduce((a, b) => (share[b] > share[a] ? b : a));
    const mixed = present.length >= 2 && share[top] < 0.85 && (present.includes('spiler') || (present.includes('filt') && present.includes('bilder')));
    category = mixed ? 'kombinert' : top;
    for (const f of present) tags.add(f);
  }
  if (p?.category) category = p.category;
  tags.add(category);
  if (hex) tags.add('sekskanter');
  for (const t of [...extra, ...(p?.tags || [])]) tags.add(t);
  return { category, tags: WALL_TAGS.map((t) => t.id).filter((id) => tags.has(id)) };
}
