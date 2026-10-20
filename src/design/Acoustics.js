import { layout as defaultLayout } from '../home/layout.js';
import { originalItems, RUG_ALPHA, parsePile } from '../home/existing.js';
import { getProduct } from '../catalog/index.js';
import schema from '../data/archetypes.json';
import wallData from '../data/wall-proposals.json';

/**
 * Reverberation time (Sabine) for the open living room – ARCHITECTURE §7.
 *
 *   RT60 = 0.161 · V / A        V = air volume from home/layout.js (the ceiling integrated over the floor, ≈ 138.6 m³)
 *   A    = A_room + Σ items + high wall + window shading          (Sabine m² at 500–1000 Hz)
 *
 * A_room (walls, ceiling, floor, glass, air, built-ins) is calibrated so that the ORIGINAL design (today's furniture
 * from existing.js, no wall proposal, no shading) gives the measured/estimated 0.86 s. Everything the user adds,
 * removes or changes is counted relative to that:
 * - items: `item.acoustic = { m2, ref }` (from the catalogue product or the existing.js estimate) scaled by the
 *   item's size relative to `ref` (rugs by footprint, wall/ceiling panels by face area, furniture by surface);
 *   without it: catalogue lookup, then a per-archetype estimate. Hidden items count 0.
 * - the high wall: the proposal's `sabineAdded`; when the user has edited the elements: Σ area × alpha.
 * - shading: fabric alpha (product absorption ÷ product area) × covered area × how closed it is (stacked curtains
 *   still absorb ~40 %).
 * Labels in the result are Norwegian.
 */

export const BASELINE_RT60 = 0.86;
export const TARGET_RT60 = Object.freeze([0.4, 0.6]);
const SABINE_K = 0.161;

const PROPOSALS = new Map((wallData.proposals || []).map((p) => [p.id, p]));

/** Default alpha per wall element type (wallFacts.absorptionGuide), used when an element has no `alpha`. */
const ELEMENT_ALPHA = {
  slats: 0.76, panel: 0.94, art: 0.56, tapestry: 0.45, checker: 0.77, circles: 0.8, hexagons: 0.45, curtain: 0.45,
  moss: 0.47, shelf: 0, 'sideboard-floating': 0, hooks: 0, led: 0, 'lamp-wall': 0, 'paint-block': 0, plant: 0,
};

/** Fabric alpha (m² Sabine per m² of covered window) when a shading spec has no catalogue product. */
const SHADING_ALPHA = {
  curtain: 0.35, vertical: 0.08, roman: 0.12, roller: 0.05, 'duo-roller': 0.06, pleated: 0.1, venetian: 0.02, 'exterior-screen': 0,
};
/** Shading that hangs floor-length beside/over the window (and still absorbs when drawn aside). */
const DRAPED = new Set(['curtain', 'vertical']);

const num = (v, fb = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : fb);
const round = (v, d = 3) => Math.round(v * 10 ** d) / 10 ** d;

// ---------------------------------------------------------------------------------------------------------------
// Items

function scaleArea(archetype, dims) {
  const { w = 0, d = 0, h = 0 } = dims || {};
  const family = schema.archetypes[archetype]?.family;
  if (archetype === 'rug') return w * d;
  if (archetype === 'ceiling-absorber') return w * Math.max(d, h);
  if (family === 'acoustic' || family === 'framed') return w * h;
  return w * d + w * h + d * h; // furniture: proportional to the upholstered surface
}

/** Absorption estimate at the item's current dims when no data is available. */
function estimateAbsorption(item) {
  const { w = 0, d = 0, h = 0 } = item.dims || {};
  const a = item.archetype;
  const family = schema.archetypes[a]?.family;
  if (a === 'rug') return (RUG_ALPHA[parsePile(item.params?.pile)] ?? RUG_ALPHA.low) * w * d;
  if (a?.startsWith('sofa-')) return 1.05 * w;
  if (a === 'dining-chair') return 0.25;
  if (a === 'bar-stool') return 0.15;
  // a recliner (high upholstered back, headrest, footstool or footrest) ≈ 0.7–0.9 m², more with a footstool
  if (a === 'recliner') return Math.min(1.2, (item.params?.footstool ? 0.85 : 0.75) * Math.max(0.6, Math.min(1.6, (w * d) / 0.65)));
  if (family === 'seating') return 0.6 * Math.min(2, (w * d) / 0.56);
  // cabinets, vitrines, tables: hard wood/glass surfaces – no extra absorption
  if (family === 'storage' || family === 'table') return 0;
  if (a === 'cushion') return 0.4 * w * h;
  if (a === 'throw') return 0.18 * w * d;
  if (a === 'pouf') return 0.25;
  if (a === 'slat-panel') return 0.76 * w * h;
  if (a === 'fabric-panel') return 0.9 * w * h;
  if (a === 'acoustic-art') return 0.8 * w * h;
  if (a === 'felt-shape') return 0.6 * w * h;
  if (a === 'ceiling-absorber') return 0.8 * w * Math.max(d, h);
  if (family === 'plant') return 0.05;
  return 0;
}

/**
 * Sabine absorption (m²) of one design item.
 * @param {Object} item DesignState item
 * @returns {number}
 */
export function itemAbsorption(item) {
  if (!item || item.hidden) return 0;
  let m2 = item.acoustic?.m2;
  let ref = item.acoustic?.ref;
  if (typeof m2 !== 'number' && item.source === 'catalog') {
    const p = getProduct(item.refId);
    if (p) {
      m2 = p.absorption || 0;
      ref = p.dims;
    }
  }
  if (typeof m2 !== 'number') return estimateAbsorption(item);
  if (!m2) return 0;
  const a0 = scaleArea(item.archetype, ref || item.dims);
  const a1 = scaleArea(item.archetype, item.dims);
  const ratio = a0 > 0 ? Math.max(0.05, Math.min(20, a1 / a0)) : 1;
  return m2 * ratio;
}

// ---------------------------------------------------------------------------------------------------------------
// High wall

/**
 * Absorption (m²) of one wall-proposal element: area × alpha (circles: Σ πr², hexagons: n × hex area,
 * curtain: width × (top − bottom)).
 * @param {Object} el
 * @returns {number}
 */
export function elementAbsorption(el) {
  if (!el) return 0;
  const alpha = typeof el.alpha === 'number' ? el.alpha : ELEMENT_ALPHA[el.type] ?? 0;
  if (!alpha) return 0;
  let area = 0;
  if (el.type === 'circles') {
    const items = Array.isArray(el.items) ? el.items : [];
    area = items.reduce((s, c) => s + Math.PI * num(c.r, num(c.d, 0) / 2) ** 2, 0);
    if (!items.length && el.r) area = Math.PI * el.r ** 2 * num(el.count, 1);
  } else if (el.type === 'hexagons' && Array.isArray(el.items) && el.items.length) {
    const size = num(el.size, 0.5); // flat-to-flat
    area = el.items.length * (Math.sqrt(3) / 2) * size * size;
  } else if (el.type === 'curtain') {
    const top = num(el.top, num(el.v, 0) + num(el.h, 0));
    const bottom = num(el.bottom, num(el.v, 0));
    area = num(el.w, 0) * Math.max(0, (num(el.h, 0) || top - bottom));
  } else {
    area = num(el.w, 0) * num(el.h, 0) * Math.max(1, num(el.count, 1));
  }
  return area * alpha;
}

/**
 * Absorption added by the high wall: the proposal's sabineAdded, or Σ elementAbsorption when edited.
 * @param {{ proposalId?: string|null, elements?: Object[]|null, edited?: boolean }} wall
 * @returns {{ m2: number, label: string, proposal: Object|null }}
 */
export function wallAbsorption(wall) {
  if (!wall) return { m2: 0, label: '', proposal: null };
  const proposal = wall.proposalId != null ? PROPOSALS.get(String(wall.proposalId)) || null : null;
  let m2;
  if (proposal && !wall.edited) m2 = num(proposal.sabineAdded, 0);
  else m2 = (wall.elements || []).reduce((s, el) => s + elementAbsorption(el), 0);
  const name = proposal ? `Veggforslag ${proposal.code} – ${proposal.name}` : 'Egen vegg';
  return { m2, label: wall.edited ? `${name} (endret)` : name, proposal };
}

// ---------------------------------------------------------------------------------------------------------------
// Window shading

/**
 * Absorption (m²) of the shading on one window.
 * @param {Object} win    layout window (width, height, top, center)
 * @param {Object} spec   ShadingSpec
 * @param {Object} [layout]
 * @returns {number}
 */
export function shadingAbsorption(win, spec, layout = defaultLayout) {
  if (!win || !spec) return 0;
  const a = spec.archetype;
  if (a === 'exterior-screen') return 0;
  let alpha = SHADING_ALPHA[a] ?? 0.05;
  const product = spec.productId ? getProduct(spec.productId) : null;
  if (product && product.dims?.w > 0 && product.dims?.h > 0) alpha = (product.absorption || 0) / (product.dims.w * product.dims.h);
  const open = Math.max(0, Math.min(1, num(spec.open, 1)));
  let area;
  let closed;
  if (DRAPED.has(a)) {
    const width = num(spec.params?.width, win.width + 0.3);
    const ceiling = layout?.ceilingHeightAt ? layout.ceilingHeightAt(win.center.x, win.center.z) : win.top + 0.3;
    const height = num(spec.params?.height, spec.params?.track === 'ceiling' || spec.mount === 'ceiling' ? ceiling - 0.02 : Math.min(ceiling, win.top + 0.15));
    area = width * height;
    closed = 0.4 + 0.6 * (1 - open);
  } else {
    const pad = spec.mount === 'wall' || spec.mount === 'ceiling' ? 0.1 : 0;
    area = (win.width + pad) * (win.height + pad);
    closed = 0.03 + 0.97 * (1 - open);
  }
  return alpha * area * closed;
}

// ---------------------------------------------------------------------------------------------------------------
// Whole design

const BASE_CACHE = new WeakMap();

function layoutOf(design, home) {
  if (home?.layout?.volume) return home.layout;
  if (home?.volume && home?.windows) return home;
  if (design?.layout?.volume) return design.layout;
  return defaultLayout;
}

/** Original items' absorption per uid + the calibrated room absorption for a layout. */
function calibration(layout) {
  let cal = BASE_CACHE.get(layout);
  if (cal) return cal;
  const originals = originalItems(layout);
  const byUid = new Map(originals.map((it) => [it.uid, { item: it, m2: itemAbsorption(it) }]));
  const furniture = [...byUid.values()].reduce((s, x) => s + x.m2, 0);
  const total = (SABINE_K * layout.volume) / BASELINE_RT60;
  cal = { byUid, furniture, total, room: Math.max(1, total - furniture) };
  BASE_CACHE.set(layout, cal);
  return cal;
}

/** Breakdown groups (archetype family → group; families without their own group – tables, storage/vitrines, lamps,
 * plants, art – count as «other»). */
const GROUPS = [
  { key: 'seating', label: 'Sofaer og stoler' },
  { key: 'textile', label: 'Puter, pledd og puffer' },
  { key: 'rug', label: 'Tepper' },
  { key: 'acoustic', label: 'Akustikkprodukter' },
  { key: 'other', label: 'Planter, bilder og annet' },
];

/**
 * Reverberation time of a design.
 * @param {Object} design  DesignState (or its toJSON(): items may be an array)
 * @param {Object} [home]  the home (uses home.layout) or a layout; default: design.layout / the real room
 * @returns {{ rt60: number, absorption: number, volume: number, baseline: number, roomAbsorption: number,
 *   target: number[], level: 'green'|'yellow'|'red', label: string,
 *   breakdown: Array<{ label: string, m2: number }>, changes: Array<{ label: string, m2: number }> }}
 */
export function computeAcoustics(design, home) {
  const layout = layoutOf(design, home);
  const cal = calibration(layout);
  const items = design?.items instanceof Map ? [...design.items.values()] : Array.isArray(design?.items) ? design.items : [];

  const groups = Object.fromEntries(GROUPS.map((g) => [g.key, 0]));
  const changes = [];
  const seen = new Set();
  for (const it of items) {
    const m2 = itemAbsorption(it);
    const family = schema.archetypes[it.archetype]?.family;
    const key = family === 'textile' ? 'textile' : family in groups ? family : 'other';
    groups[key] += m2;
    const orig = cal.byUid.get(it.uid);
    if (orig) {
      seen.add(it.uid);
      if (Math.abs(m2 - orig.m2) > 0.005) changes.push({ label: `Endret: ${it.name}`, m2: round(m2 - orig.m2) });
    } else if (m2 > 0.005) changes.push({ label: `Lagt til: ${it.name}`, m2: round(m2) });
  }
  for (const [uid, orig] of cal.byUid) {
    if (!seen.has(uid) && orig.m2 > 0.005) changes.push({ label: `Fjernet: ${orig.item.name}`, m2: round(-orig.m2) });
  }

  const wall = wallAbsorption(design?.wall);
  if (wall.m2 > 0.005) changes.push({ label: wall.label, m2: round(wall.m2) });

  let shading = 0;
  for (const [windowId, spec] of Object.entries(design?.windows || {})) {
    const win = layout.windows.find((w) => w.id === windowId);
    const m2 = shadingAbsorption(win, spec, layout);
    shading += m2;
    if (m2 > 0.005) changes.push({ label: `Solskjerming: ${win?.name || windowId}`, m2: round(m2) });
  }

  const absorption = cal.room + Object.values(groups).reduce((s, v) => s + v, 0) + wall.m2 + shading;
  const rt60 = (SABINE_K * layout.volume) / Math.max(0.5, absorption);

  const breakdown = [{ label: 'Rommet (vegger, tak, gulv, vinduer og luft)', m2: round(cal.room, 2) }];
  for (const g of GROUPS) if (groups[g.key] > 0.005) breakdown.push({ label: g.label, m2: round(groups[g.key], 2) });
  if (wall.m2 > 0.005) breakdown.push({ label: 'Den høye veggen', m2: round(wall.m2, 2) });
  if (shading > 0.005) breakdown.push({ label: 'Gardiner og solskjerming', m2: round(shading, 2) });
  changes.sort((a, b) => Math.abs(b.m2) - Math.abs(a.m2));

  const level = rt60 <= TARGET_RT60[1] + 1e-9 ? 'green' : rt60 <= 0.7 + 1e-9 ? 'yellow' : 'red';
  return {
    rt60,
    absorption,
    volume: layout.volume,
    baseline: BASELINE_RT60,
    roomAbsorption: cal.room,
    target: [...TARGET_RT60],
    level,
    label: `Etterklang ≈ ${rt60.toFixed(2).replace('.', ',')} s`,
    breakdown,
    changes,
  };
}

/**
 * RT60 for a total absorption (m²) in a volume (m³).
 * @param {number} absorption
 * @param {number} [volume]
 */
export function rt60For(absorption, volume = defaultLayout.volume) {
  return (SABINE_K * volume) / Math.max(0.5, absorption);
}
