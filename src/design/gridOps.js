/**
 * Grid operations of «Antall og rutenett» (design/lighting.md §5.1; MASTER §2.6, D3, D44). Pure: no THREE, no DOM –
 * imports only design/grid.js and DesignState's LIMITS, so lightbudget.test and the Inspector bind to the same code.
 *
 *   distributeGrid(item, layout, { rows, cols, scale })
 *     «Fordel jevnt i rommet»: rows × cols fittings spread over the item's zone (the open living room: kjøkken,
 *     spisestue, stue, tv-stue) or room, in the grid's own axes (its rotationDeg); wall distance = EDGE + spacing / 2
 *     (LIGHT §5.1: the spacing is the span minus 2 × EDGE over the count, see EDGE below). A grid square to the walls
 *     uses the largest rectangle of the area that keeps off the holes in its ceiling (the notch of an L-shaped zone,
 *     the stairwell over the basement hall), not the area's bounding box.
 *     → { patch: { params, dims, position }, area: { id, name, minX, maxX, minZ, maxZ } } | { error }   (Norwegian error)
 *   gridClearance(item, layout) → { ok, min, need }
 *     whether every head keeps half the spacing from the edges of its zone / room and off the holes in its ceiling
 *     («Fordel jevnt» tries a smaller spread when not)
 *   splitGrid(item, { itemCount })
 *     «Del opp i enkeltspotter»: one item spec per cell (the same look, params without grid*, the head's dims, the
 *     cell's world position) → { specs } | { error } when the design would get more than LIMITS.items things.
 *   gridArea(item, layout) → the zone / room a grid item is spread over (null outside every room)
 */
import { GRIDABLE, GRID_DEFAULT_SPACING, GRID_LIMITS, gridOf, gridSpec, gridCells, cellWorld } from './grid.js';
import { LIMITS } from './DesignState.js';

const DEG = Math.PI / 180;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const r3 = (v) => Math.round(v * 1000) / 1000;
const clone = (v) => (v == null ? v : JSON.parse(JSON.stringify(v)));
/**
 * Distance kept from the walls before the spacing rule (m): the usable span is the area minus this on each side
 * (LIGHT §5.1 «usable span = extent − 2 × 0.05»), so the outer fittings sit EDGE + spacing / 2 from the wall – 5 cm
 * more than the plain «spacing / 2» rule. Kept on purpose: whenever the count fits the span at ≥ 0.3 m spacing it
 * leaves ≥ 5 cm between the grid's extent and the walls even when a head is as wide as the spacing (0.3 m heads at
 * 0.3 m), so Placement.constrain (resolveWalls with the baseboard gap, footprintIssue) does not push or block a grid
 * «Fordel jevnt» just placed. lightbudget.test F4 accepts spacing / 2 … spacing / 2 + 6 cm for this.
 */
const EDGE = 0.05;
/** Spacing a 1 × 1 item's new grid aims for when no count is given (m). */
const AUTO_SPACING = 1.2;
/** How much closer than half the spacing a head may come to an edge before gridClearance says no (m). */
const CLEAR_TOL = 0.02;

/**
 * Level id of an item (the same rule as SceneSync.itemLevel, which this pure module may not import): item.level when
 * the layout knows it, else the level its y lies in (a ceiling item hangs just under its ceiling), else 'hoved'.
 */
function levelOf(item, layout) {
  const lv = typeof item?.level === 'string' && item.level ? item.level : null;
  const known = layout?.house?.levelsById;
  if (lv && (!known || known[lv])) return lv;
  const h = layout?.house;
  if (typeof h?.levelAt !== 'function') return lv ?? 'hoved';
  const y = Number(item?.position?.[1]) || 0;
  return h.levelAt(item?.mount === 'ceiling' ? y - 0.1 : y + 0.05)?.id ?? 'hoved';
}

/** World y of a level's floor (SceneSync.levelFloorY). */
function floorOf(layout, levelId) {
  const h = layout?.house;
  const lv = h?.levelsById?.[levelId] ?? h?.level?.(levelId) ?? null;
  return Number.isFinite(lv?.floorY) ? lv.floorY : 0;
}

/**
 * The area a grid item is spread over: on the first floor the living room's zone under it (the open-plan room is one
 * room with four zones), else the room of its level under it. null outside every room.
 */
export function gridArea(item, layout) {
  const p = item?.position || [0, 0, 0];
  const lv = levelOf(item, layout);
  const fy = floorOf(layout, lv);
  const zone = lv === 'hoved' ? layout?.zoneAt?.(p[0], p[2]) ?? null : null;
  if (zone?.polygon?.length >= 3) return zone;
  const room = layout?.house?.roomAt?.(p[0], fy + 1, p[2], { levelId: lv }) ?? null;
  return room?.polygon?.length >= 3 ? room : null;
}

/** Point in a polygon of { x, y } points (y = world z). */
function inPoly(poly, x, z) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if (a.y > z !== b.y > z && x < ((b.x - a.x) * (z - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Distance from a point to the nearest edge of a polygon of { x, y } points. */
function edgeDist(poly, x, z) {
  let best = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[j], b = poly[i];
    const ex = b.x - a.x, ez = b.y - a.y;
    const L2 = ex * ex + ez * ez;
    const t = L2 > 0 ? clamp(((x - a.x) * ex + (z - a.y) * ez) / L2, 0, 1) : 0;
    best = Math.min(best, Math.hypot(x - a.x - t * ex, z - a.y - t * ez));
  }
  return best;
}

/**
 * The holes in an area's ceiling a grid keeps off (polygons of { x, y }): the openings in the floor of the level above
 * (the stairwell seen from the basement hall: no ceiling there) and in the level's own floor (Placement does not hang
 * a ceiling item over the stairwell either) – those that reach into the area's bounds.
 */
function ceilingHoles(area, layout, levelId) {
  const H = layout?.house;
  const above = H?.levelsById?.[levelId]?.aboveId ?? H?.level?.(levelId)?.aboveId ?? null;
  const b = area.bounds;
  const reaches = (poly) => {
    if (!b || !Number.isFinite(b.minX)) return true;
    const xs = poly.map((q) => q.x), zs = poly.map((q) => q.y);
    return Math.min(...xs) < b.maxX - 1e-6 && Math.max(...xs) > b.minX + 1e-6 && Math.min(...zs) < b.maxZ - 1e-6 && Math.max(...zs) > b.minZ + 1e-6;
  };
  return (H?.floorOpenings || [])
    .filter((fo) => fo.levelId === levelId || (above && fo.levelId === above))
    .map((fo) => fo.polygon)
    .filter((poly) => poly?.length >= 3 && reaches(poly));
}

/**
 * The largest rectangle of an area that keeps off its holes, in the grid's axes round c (u along the rows, v across):
 * { u0, u1, v0, v1 } – or null when the area or a hole is not square to those axes (a grid turned 30°: the caller
 * uses the bounding box). Exact for rectilinear polygons: the cells between their own coordinates are wholly in or
 * out, and every rectangle of free cells is tried (a dozen coordinates per axis).
 */
function usableRect(poly, holes, c, cos, sin) {
  const uv = (q) => {
    const dx = q.x - c.x, dz = q.y - c.z;
    return { u: dx * cos - dz * sin, v: dx * sin + dz * cos };
  };
  const P = poly.map(uv);
  const Hs = holes.map((hp) => hp.map(uv));
  const square = (pts) => pts.every((a, i) => {
    const b = pts[(i + 1) % pts.length];
    return Math.abs(a.u - b.u) < 1e-6 || Math.abs(a.v - b.v) < 1e-6;
  });
  if (!square(P) || !Hs.every(square)) return null;
  const inUV = (pts, u, v) => inPoly(pts.map((q) => ({ x: q.u, y: q.v })), u, v);
  const coords = (k) => {
    const lo = Math.min(...P.map((q) => q[k])), hi = Math.max(...P.map((q) => q[k]));
    const all = [...P, ...Hs.flat()].map((q) => Math.round(q[k] * 1e5) / 1e5).filter((x) => x >= lo - 1e-5 && x <= hi + 1e-5);
    return [...new Set(all)].sort((a, b) => a - b);
  };
  const us = coords('u'), vs = coords('v');
  const nu = us.length - 1, nv = vs.length - 1;
  if (nu < 1 || nv < 1) return null;
  const free = [];
  for (let i = 0; i < nu; i++) {
    free.push([]);
    for (let j = 0; j < nv; j++) {
      const mu = (us[i] + us[i + 1]) / 2, mv = (vs[j] + vs[j + 1]) / 2;
      free[i].push(inUV(P, mu, mv) && !Hs.some((hp) => inUV(hp, mu, mv)));
    }
  }
  // every rectangle of free cells with its corner cell at (i0, j0): widen column by column, the height shrinking to
  // what every column so far leaves free
  let best = null;
  for (let i0 = 0; i0 < nu; i0++) {
    for (let j0 = 0; j0 < nv; j0++) {
      let top = nv;
      for (let i1 = i0; i1 < nu && free[i1][j0]; i1++) {
        let j1 = j0;
        while (j1 + 1 < top && free[i1][j1 + 1]) j1++;
        top = j1 + 1;
        const a = (us[i1 + 1] - us[i0]) * (vs[top] - vs[j0]);
        if (!best || a > best.a + 1e-6) best = { a, u0: us[i0], u1: us[i1 + 1], v0: vs[j0], v1: vs[top] };
      }
    }
  }
  return best;
}

/**
 * «Fordel jevnt i rommet»: rows × cols over the item's zone or room rectangle in the grid's axes, the wall distance
 * EDGE + half the spacing. The rectangle: for a grid square to the area's walls the largest one inside the area that
 * keeps off the holes in its ceiling (an L-shaped zone: its larger leg; the basement hall: beside the stairwell), else
 * the area's bounding box. A 1 × 1 item without counts gets ≈ 1.2 m spacing (≤ 8 rows, ≤ 10 per row). `scale` < 1
 * shrinks the used span around the rectangle's middle (the bounding box: around the area's centroid, so the notch of
 * an L stays out; the caller retries at 0.85 and 0.7 when the full one does not fit or a head lands at a wall).
 * @param {object} item  a GRIDABLE ceiling item (archetype, dims, params, position, rotationDeg, mount, level?)
 * @param {object} layout  home/layout.js
 * @param {{ rows?: number, cols?: number, scale?: number }} [o]
 * @returns {{ patch: { params: object, dims: object, position: number[] }, area: { id: string, name: string, minX: number, maxX: number, minZ: number, maxZ: number } } | { error: string }}
 */
export function distributeGrid(item, layout, { rows, cols, scale = 1 } = {}) {
  if (!item || !GRIDABLE.has(item.archetype)) return { error: 'Bare innfelte downlights og takspotter kan fordeles i et rutenett.' };
  if (item.mount && item.mount !== 'ceiling') return { error: 'Rutenettet fordeles bare i taket.' };
  const area = gridArea(item, layout);
  if (!area) return { error: 'Fant ikke rommet lampen henger i – flytt den inn i et rom først.' };
  const poly = area.polygon;
  const t = (item.rotationDeg || 0) * DEG;
  const cos = Math.cos(t), sin = Math.sin(t);
  // the area in the grid's axes (Placement.axes: x = cx + u·cos + v·sin, z = cz − u·sin + v·cos), round its centroid
  let cx = 0, cz = 0;
  for (const q of poly) {
    cx += q.x;
    cz += q.y;
  }
  cx /= poly.length;
  cz /= poly.length;
  const c = area.centroid && Number.isFinite(area.centroid.x) ? { x: area.centroid.x, z: area.centroid.y } : { x: cx, z: cz };
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
  for (const q of poly) {
    const dx = q.x - c.x, dz = q.y - c.z;
    const u = dx * cos - dz * sin, v = dx * sin + dz * cos;
    u0 = Math.min(u0, u);
    u1 = Math.max(u1, u);
    v0 = Math.min(v0, v);
    v1 = Math.max(v1, v);
  }
  // square to the walls: the largest rectangle that keeps off the notch of an L and the holes in the ceiling
  const rect = usableRect(poly, ceilingHoles(area, layout, levelOf(item, layout)), c, cos, sin);
  if (rect) ({ u0, u1, v0, v1 } = rect);
  const k = clamp(Number.isFinite(scale) ? scale : 1, 0.2, 1);
  let Lu = Math.max(0, (u1 - u0) * k - 2 * EDGE), Lv = Math.max(0, (v1 - v0) * k - 2 * EDGE);
  // the centre: the rectangle's middle; the bounding box's middle, or the centroid when shrunk (the notch of an L
  // stays out)
  const mu = rect || k === 1 ? (u0 + u1) / 2 : 0, mv = rect || k === 1 ? (v0 + v1) / 2 : 0;
  const g = gridOf(item);
  let nr = Number.isFinite(rows) ? rows : g.rows, nc = Number.isFinite(cols) ? cols : g.cols;
  if (!Number.isFinite(rows) && !Number.isFinite(cols) && g.count === 1) {
    // (+1e-6: a 3.0 m span is 2.5 spacings whatever the float noise of the walls' coordinates – always 3)
    nc = Math.round(Lu / AUTO_SPACING + 1e-6);
    nr = Math.round(Lv / AUTO_SPACING + 1e-6);
  }
  nc = clamp(Math.round(nc) || 1, GRID_LIMITS.cols[0], GRID_LIMITS.cols[1]);
  nr = clamp(Math.round(nr) || 1, GRID_LIMITS.rows[0], GRID_LIMITS.rows[1]);
  if (nr * nc > GRID_LIMITS.maxCount) nr = Math.max(1, Math.floor(GRID_LIMITS.maxCount / nc));
  const [s0, s1] = GRID_LIMITS.spacing;
  const def = GRID_DEFAULT_SPACING[item.archetype] ?? AUTO_SPACING;
  // a single fitting along an axis keeps the grid's spacing there (it does not matter for the look, only for later)
  const dx = r3(nc > 1 ? clamp(Lu / nc, s0, s1) : clamp(g.dx || def, s0, s1));
  const dz = r3(nr > 1 ? clamp(Lv / nr, s0, s1) : clamp(g.dz || dx, s0, s1));
  const spec = gridSpec(g.head, { rows: nr, cols: nc, dx, dz });
  const y = item.position?.[1] ?? 0;
  const position = [r3(c.x + mu * cos + mv * sin), y, r3(c.z - mu * sin + mv * cos)];
  const b = area.bounds || {};
  return {
    patch: { params: spec.params, dims: spec.dims, position },
    area: { id: area.id, name: area.name ?? area.id, minX: b.minX, maxX: b.maxX, minZ: b.minZ, maxZ: b.maxZ },
  };
}

/**
 * How far the heads of a grid keep from the edges of its zone / room and of the holes in its ceiling (the stairwell).
 * min: the smallest distance of a head to such an edge (negative when a head is outside the area or under a hole);
 * need: half the smallest spacing between heads (0 for one fitting). ok when min ≥ need − 2 cm: «Fordel jevnt» then
 * tries a smaller spread instead of leaving a row 5 cm from a wall (an L whose notch the grid's extent box just misses).
 * @param {object} item  a grid item (archetype, dims, params, position, rotationDeg, level?)
 * @param {object} layout  home/layout.js
 * @returns {{ ok: boolean, min: number, need: number }}
 */
export function gridClearance(item, layout) {
  const area = gridArea(item, layout);
  if (!area) return { ok: false, min: -Infinity, need: 0 };
  const g = gridOf(item);
  const step = Math.min(g.cols > 1 ? g.dx : Infinity, g.rows > 1 ? g.dz : Infinity);
  const need = Number.isFinite(step) ? step / 2 : 0;
  const holes = ceilingHoles(area, layout, levelOf(item, layout));
  let min = Infinity;
  for (const cell of gridCells(g)) {
    const [x, z] = cellWorld(item, cell);
    let d = edgeDist(area.polygon, x, z) * (inPoly(area.polygon, x, z) ? 1 : -1);
    for (const hp of holes) d = Math.min(d, edgeDist(hp, x, z) * (inPoly(hp, x, z) ? -1 : 1));
    min = Math.min(min, d);
  }
  return { ok: min >= Math.max(0, need - CLEAR_TOL), min: r3(min), need: r3(need) };
}

/**
 * «Del opp i enkeltspotter»: one spec per cell – the same product, look and light, params without grid*, the head's
 * dims, the cell's world position (y as the grid's: SceneSync hangs it under its
 * ceiling). The caller removes the grid item and adds the specs in one transaction.
 * @param {object} item
 * @param {{ itemCount?: number }} [o]  the design's current number of items (LIMITS.items caps the result)
 * @returns {{ specs: object[] } | { error: string }}
 */
export function splitGrid(item, { itemCount = 0 } = {}) {
  if (!item || !GRIDABLE.has(item.archetype)) return { error: 'Dette er ikke et rutenett av spotter.' };
  const g = gridOf(item);
  if (g.count <= 1) return { error: 'Det er bare én spot – ingenting å dele opp.' };
  if (itemCount - 1 + g.count > LIMITS.items) {
    return { error: `For mange ting i designet – ${g.count} spotter får ikke plass (høyst ${LIMITS.items} ting).` };
  }
  const base = clone(item);
  delete base.uid;
  const y = item.position?.[1] ?? 0;
  // a single fitting: no grid params (its archetype's defaults are 1 × 1)
  const single = Object.fromEntries(Object.entries(clone(item.params) || {}).filter(([k]) => !/^grid[A-Z]/.test(k)));
  const specs = gridCells(g).map((cell) => {
    const [x, z] = cellWorld(item, cell);
    return {
      ...clone(base),
      position: [r3(x), y, r3(z)],
      dims: { ...g.head },
      params: { ...single },
    };
  });
  return { specs };
}
