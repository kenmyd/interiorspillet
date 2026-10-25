/**
 * Rows and grids of identical ceiling fittings (design/lighting.md §5.2; MASTER §2.6). Pure: no THREE, no DOM.
 *
 * One item of a GRIDABLE archetype may stand for rows × cols fittings: its params `gridRows`, `gridCols`, `gridDx`,
 * `gridDz` hold the grid and its `dims` the whole extent (so Placement, constrain, the footprint and the walls treat
 * it as one box). The models emit one light per head (models/spots.js), SceneSync multiplies the catalogue lumens by
 * itemQuantity(), the shopping list counts it, and «Antall og rutenett» (ui/inspector/gridSection.js) edits it.
 *
 *   GRIDABLE                       archetypes an item of which may be a row / grid
 *   GRID_LIMITS                    { rows, cols, spacing, maxCount, maxExtent }
 *   GRID_PARAMS                    Def.params entries gridRows/gridCols/gridDx/gridDz (section 'grid')
 *   GRID_HEAD_RANGE                per gridable archetype: ONE fitting's w/d/h slider ranges
 *   GRID_DEFAULT_SPACING           per gridable archetype: the spacing a new grid starts with (m)
 *   gridOf(item)                   { rows, cols, dx, dz, count, head: {w,d,h}, extent: {w,d,h} } (rounded + clamped)
 *   gridExtent(head, grid)         dims of a grid of `head` fittings (mm-rounded)
 *   gridSpec(head, grid)           { params: { gridRows, gridCols, gridDx, gridDz }, dims } (clamped to GRID_LIMITS)
 *   gridCells(g)                   [{ i, j, u, v }] row-major, cols along local x, rows along local z
 *   cellWorld(item, cell)          world [x, z] of a cell (Placement.axes / SceneSync.placeObject yaw convention)
 *   itemQuantity(item)             THE quantity helper: rows × cols for GRIDABLE, else 1
 */

/** Archetypes one item of which may be a row / grid of identical ceiling fittings (params gridRows × gridCols). */
export const GRIDABLE = new Set(['downlight', 'downlight-surface', 'spot-ceiling']);

export const GRID_LIMITS = Object.freeze({ rows: [1, 8], cols: [1, 10], spacing: [0.3, 3.0], maxCount: 48, maxExtent: 11 });

/** Def.params entries (section 'grid': edited in «Antall og rutenett», not in «Form og detaljer»). */
export const GRID_PARAMS = Object.freeze({
  gridRows: { type: 'number', min: 1, max: 8, step: 1, label: 'Rader', section: 'grid' },
  gridCols: { type: 'number', min: 1, max: 10, step: 1, label: 'Per rad', section: 'grid' },
  gridDx: { type: 'number', min: 0.3, max: 3, step: 0.05, unit: 'm', label: 'Avstand', section: 'grid' },
  gridDz: { type: 'number', min: 0.3, max: 3, step: 0.05, unit: 'm', label: 'Avstand mellom radene', section: 'grid' },
});

/** Slider ranges of ONE fitting (the Inspector's head size; dims hold the whole grid). Every dim ≥ 0.005 (D38). */
export const GRID_HEAD_RANGE = Object.freeze({
  downlight: Object.freeze({ w: [0.05, 0.3], d: [0.05, 0.3], h: [0.005, 0.04] }),
  'downlight-surface': Object.freeze({ w: [0.05, 0.25], d: [0.05, 0.25], h: [0.03, 0.3] }),
  'spot-ceiling': Object.freeze({ w: [0.05, 0.2], d: [0.05, 0.2], h: [0.08, 0.4] }),
});

/** Spacing (m) a grid starts with when the item has none yet (the archetypes' gridDx/gridDz defaults, MASTER §2.3). */
export const GRID_DEFAULT_SPACING = Object.freeze({ downlight: 1.2, 'downlight-surface': 1.2, 'spot-ceiling': 1.0 });

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const fin = (v) => typeof v === 'number' && Number.isFinite(v);
const r3 = (v) => Math.round(v * 1000) / 1000;
/** Smallest head a grid's dims leave for one fitting (m). */
const MIN_HEAD = 0.02;

/** rows, cols, dx, dz rounded and clamped to GRID_LIMITS (count ≤ maxCount: rows give way first). */
function clampGrid({ rows, cols, dx, dz } = {}, spacing = 1.2) {
  const L = GRID_LIMITS;
  let c = clamp(Math.round(fin(cols) ? cols : 1), L.cols[0], L.cols[1]);
  let r = clamp(Math.round(fin(rows) ? rows : 1), L.rows[0], L.rows[1]);
  if (r * c > L.maxCount) r = Math.max(1, Math.floor(L.maxCount / c));
  const x = r3(clamp(fin(dx) ? dx : spacing, L.spacing[0], L.spacing[1]));
  const z = r3(clamp(fin(dz) ? dz : x, L.spacing[0], L.spacing[1]));
  return { rows: r, cols: c, dx: x, dz: z };
}

/** Spacing that keeps n heads of size `head` within maxExtent (never under the minimum spacing). */
function fitSpacing(s, n, head) {
  if (n <= 1) return s;
  const max = (GRID_LIMITS.maxExtent - head) / (n - 1);
  return r3(Math.max(GRID_LIMITS.spacing[0], Math.min(s, max)));
}

/**
 * The grid an item stands for. 1 × 1 (head = dims) for every other archetype.
 * DesignState only bounds params to a wide band, so the params are rounded and clamped here.
 * @param {{ archetype?: string, dims?: {w:number,d:number,h:number}, params?: Object }} item
 * @returns {{ rows: number, cols: number, dx: number, dz: number, count: number, head: {w:number,d:number,h:number}, extent: {w:number,d:number,h:number} }}
 */
export function gridOf(item) {
  const dims = item?.dims || {};
  const extent = { w: fin(dims.w) ? dims.w : 0, d: fin(dims.d) ? dims.d : 0, h: fin(dims.h) ? dims.h : 0 };
  const a = item?.archetype;
  if (!GRIDABLE.has(a)) {
    const s = 1.2;
    return { rows: 1, cols: 1, dx: s, dz: s, count: 1, head: { ...extent }, extent };
  }
  const P = item.params || {};
  const g = clampGrid({ rows: P.gridRows, cols: P.gridCols, dx: P.gridDx, dz: P.gridDz }, GRID_DEFAULT_SPACING[a] ?? 1.2);
  const head = {
    w: g.cols > 1 ? Math.max(MIN_HEAD, r3(extent.w - (g.cols - 1) * g.dx)) : extent.w,
    d: g.rows > 1 ? Math.max(MIN_HEAD, r3(extent.d - (g.rows - 1) * g.dz)) : extent.d,
    h: extent.h,
  };
  return { ...g, count: g.rows * g.cols, head, extent };
}

/**
 * dims of a grid of `head` fittings (rounded to mm).
 * @param {{w:number,d:number,h:number}} head
 * @param {{ rows?: number, cols?: number, dx?: number, dz?: number }} grid
 */
export function gridExtent(head, { rows = 1, cols = 1, dx = 0, dz = 0 } = {}) {
  return {
    w: r3(head.w + (Math.max(1, cols) - 1) * dx),
    d: r3(head.d + (Math.max(1, rows) - 1) * dz),
    h: r3(head.h),
  };
}

/**
 * Params and dims for a grid of `head` fittings, clamped to GRID_LIMITS (count ≤ maxCount, extent ≤ maxExtent).
 * @returns {{ params: { gridRows: number, gridCols: number, gridDx: number, gridDz: number }, dims: {w:number,d:number,h:number} }}
 */
export function gridSpec(head, grid = {}) {
  const g = clampGrid(grid);
  g.dx = fitSpacing(g.dx, g.cols, head.w);
  g.dz = fitSpacing(g.dz, g.rows, head.d);
  return { params: { gridRows: g.rows, gridCols: g.cols, gridDx: g.dx, gridDz: g.dz }, dims: gridExtent(head, g) };
}

/**
 * Cells, row-major: { i (row), j (column), u, v } – local offsets from the item's centre (cols along local x, rows
 * along local z).
 * @param {{ rows: number, cols: number, dx: number, dz: number }} g  e.g. gridOf(item)
 */
export function gridCells(g) {
  const rows = Math.max(1, g?.rows || 1), cols = Math.max(1, g?.cols || 1);
  const dx = g?.dx || 0, dz = g?.dz || 0;
  const out = [];
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      out.push({ i, j, u: r3((j - (cols - 1) / 2) * dx), v: r3((i - (rows - 1) / 2) * dz) });
    }
  }
  return out;
}

/**
 * World [x, z] of a cell (same yaw convention as SceneSync.placeObject / Placement.axes:
 * x = cx + u·cos + v·sin, z = cz − u·sin + v·cos).
 */
export function cellWorld(item, cell) {
  const p = item?.position || [0, 0, 0];
  const t = ((item?.rotationDeg || 0) * Math.PI) / 180;
  const c = Math.cos(t), s = Math.sin(t);
  return [p[0] + cell.u * c + cell.v * s, p[2] - cell.u * s + cell.v * c];
}

/** Number of fittings an item stands for (the shopping list, lumens, LightPanel): rows × cols, else 1. */
export function itemQuantity(item) {
  if (!item || !GRIDABLE.has(item.archetype)) return 1;
  return gridOf(item).count;
}
