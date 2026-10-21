/**
 * Surface finishes – a slat panel («spiler» / «spilepanel») on a wall or a ceiling – as plain data and plan math, no
 * three.js (DesignState, Acoustics and the Inspector use it in Node and in the browser; models/surfaceslats.js turns
 * a region into boxes).
 *
 *   FINISH_TYPES                       ['slats']
 *   SLAT_LOOKS                         [{ id, label, kind, hex }] – material kind + colour; 'surface' = painted in the
 *                                      surface's own colour (hex null: the wall's / ceiling's paint)
 *   SLAT_SIZES                         { narrow, standard, wide: { label, slatW, gap, depth } } (metres)
 *   SLAT_BACKINGS                      [[id, label]]: 'felt' (black felt), 'felt-match' (felt in the slats' colour),
 *                                      'none' (straight on the surface – the paint shows in the gaps)
 *   FELT_T                             felt thickness (the high wall's slats: walldesigns.js FELT_T)
 *   surfaceKind(layout, id)            'wall' | 'ceiling' | null (bulkheads and the high wall: null – no slats there)
 *   finishSurfaceIds(layout)           Set of ids that may have a finish (null: unknown layout → every id)
 *   defaultFinish(kind)                a new slat finish with sensible defaults
 *   normaliseFinish(spec, kind)        tolerant copy (unknown fields dropped, numbers clamped) or null
 *   lookOf(spec)                       the SLAT_LOOKS entry · sizeOf(spec) → SLAT_SIZES key | 'custom'
 *   finishDepth(spec, base?)           metres from the surface to the slats' face
 *   finishRegion(layout, id, spec, { finishes })   the panel's outline in the surface's own frame (below)
 *   slatLayout(region)                 { slats: [{ c, runs }], strips: [{ c, runs }], area } – the slats and the
 *                                      backing strips, cut at the outline and its holes
 *   finishArea(layout, id, spec, o)    covered m² (the backing strips) – Acoustics
 *
 * Data model (DesignState.finishes[surfaceId]):
 *   { type: 'slats', look, slatW, gap, depth, backing,
 *     wall:    extent: 'full'|'section', u (left edge from the wall's left end as seen from the room, m), w (width, m),
 *              h (null = up to the ceiling / slope line, else metres over the floor),
 *     ceiling: direction: 'along'|'across' (the ceiling's long / short side in plan) }
 *
 * Region (finishRegion): { kind, surfaceId, frame: { origin, x, y, z } (world, plain [x, y, z]; z = out of the surface
 * into the room), poly: [[x, y]…], holes: [[[x, y]…]…] (frame-local metres), along: 'x'|'y' (the slats' length axis),
 * base (back of the slats over the surface: the backing's thickness, skirting/trim clearance), slatW, gap, depth, felt,
 * seed }. Walls: x = u along the wall (left → right from the room), y = up from the wall's floor, vertical slats.
 * Ceilings: the ceiling plane (a sloped one too): x = the slat direction, slats along x. Windows, doors and other
 * openings (+ a margin), sockets/switches/the heat pump (wall fixtures), the ceiling's spots, downlights and LED strips,
 * the stairwell holes are holes (plafonds and smoke detectors get a cut a little smaller than themselves; pendant
 * canopies, ring lamps and rails sit on the slats); a wall panel stops under the ceiling (and under a ceiling's own
 * slats), steps back for the slats of the wall before it in an inside corner, and stands off the skirting / ceiling trim.
 */

export const FINISH_TYPES = Object.freeze(['slats']);
/** Felt behind the slats (walldesigns.js FELT_T). */
export const FELT_T = 0.009;

/** Slat looks: material kind (home/materials.js) + colour. 'surface' takes the surface's paint. */
export const SLAT_LOOKS = Object.freeze([
  { id: 'oak', label: 'Eik', kind: 'oak', hex: '#b08b62' },
  { id: 'white-oak', label: 'Lys eik', kind: 'white-oak', hex: '#d9ccb6' },
  { id: 'smoked-oak', label: 'Røkt eik', kind: 'smoked-oak', hex: '#5f4936' },
  { id: 'walnut', label: 'Valnøtt', kind: 'walnut', hex: '#6b4a33' },
  { id: 'black', label: 'Sort', kind: 'black-oak', hex: '#2a2725' },
  { id: 'white', label: 'Hvit', kind: 'painted', hex: '#ece9e2' },
  { id: 'surface', label: 'Malt i samme farge', kind: 'painted', hex: null },
]);
const LOOK_IDS = new Set(SLAT_LOOKS.map((l) => l.id));

/** Slat sizes (Akupanel-like standard: 27 mm slats, 13 mm gaps, 12 mm deep on 9 mm felt). */
export const SLAT_SIZES = Object.freeze({
  narrow: { label: 'Smale', slatW: 0.02, gap: 0.01, depth: 0.012 },
  standard: { label: 'Standard', slatW: 0.027, gap: 0.013, depth: 0.012 },
  wide: { label: 'Brede', slatW: 0.045, gap: 0.02, depth: 0.018 },
});

export const SLAT_BACKINGS = Object.freeze([['felt', 'Sort filt'], ['felt-match', 'Filt i samme farge'], ['none', 'Ingen (rett på flaten)']]);
const BACKING_IDS = new Set(SLAT_BACKINGS.map(([id]) => id));

const LIMIT = { slatW: [0.01, 0.12], gap: [0.003, 0.1], depth: [0.006, 0.05], u: [0, 40], w: [0.1, 40], h: [0.2, 6] };
/** Space kept free around a window / door hole (m): sides and top, under a window's sill (its board). */
const HOLE_MARGIN = 0.015;
const SILL_MARGIN = 0.035;
/** A wall panel ends this far under the ceiling. */
const TOP_GAP = 0.003;
/** Runs shorter than this are dropped (slivers at a hole's corner). */
const MIN_RUN = 0.03;

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const num = (v, fb) => (typeof v === 'number' && Number.isFinite(v) ? v : fb);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const r4 = (v) => Math.round(v * 1e4) / 1e4;

// ---------------------------------------------------------------------------------------------------------------
// Surfaces

function wallOf(layout, id) {
  return layout?.house?.wallsById?.[id] ?? layout?.wallsById?.[id] ?? null;
}

function ceilingOf(layout, id) {
  const list = layout?.house?.ceilings ?? layout?.ceilings ?? [];
  return list.find((c) => c.id === id) ?? null;
}

/**
 * The kind of surface an id is: a wall of the house (not the high wall – it has the wall proposals) or a ceiling.
 * @param {object} layout  home/layout.js
 * @param {string} id
 * @returns {'wall'|'ceiling'|null}
 */
export function surfaceKind(layout, id) {
  if (!id) return null;
  if (ceilingOf(layout, id)) return 'ceiling';
  if (wallOf(layout, id) && id !== layout?.highWall?.wallId) return 'wall';
  return null;
}

/**
 * Ids that may carry a finish: every wall of the house but the high wall, every ceiling. null = unknown layout.
 * @param {object} layout
 * @returns {Set<string>|null}
 */
export function finishSurfaceIds(layout) {
  const walls = Object.keys(layout?.house?.wallsById ?? layout?.wallsById ?? {}).filter((id) => id !== layout?.highWall?.wallId);
  const ceilings = (layout?.house?.ceilings ?? layout?.ceilings ?? []).map((c) => c.id);
  const ids = [...walls, ...ceilings].filter(Boolean);
  return ids.length ? new Set(ids) : null;
}

/**
 * A new slat finish (oak, standard slats, black felt; a wall: the whole wall up to the ceiling; a ceiling: along).
 * @param {'wall'|'ceiling'} kind
 */
export function defaultFinish(kind = 'wall') {
  const s = SLAT_SIZES.standard;
  const base = { type: 'slats', look: 'oak', slatW: s.slatW, gap: s.gap, depth: s.depth, backing: 'felt' };
  return kind === 'ceiling' ? { ...base, direction: 'along' } : { ...base, extent: 'full', u: 0, w: 1.2, h: null };
}

/**
 * Tolerant copy of a finish spec. kind: the surface's kind ('wall' / 'ceiling'; null keeps both field sets).
 * @param {object} spec
 * @param {'wall'|'ceiling'|null} [kind]
 * @returns {object|null}
 */
export function normaliseFinish(spec, kind = null) {
  if (!isObj(spec)) return null;
  const type = FINISH_TYPES.includes(spec.type) ? spec.type : 'slats';
  const d = defaultFinish(kind === 'ceiling' ? 'ceiling' : 'wall');
  const out = {
    type,
    look: LOOK_IDS.has(spec.look) ? spec.look : d.look,
    slatW: r4(clamp(num(spec.slatW, d.slatW), ...LIMIT.slatW)),
    gap: r4(clamp(num(spec.gap, d.gap), ...LIMIT.gap)),
    depth: r4(clamp(num(spec.depth, d.depth), ...LIMIT.depth)),
    backing: BACKING_IDS.has(spec.backing) ? spec.backing : d.backing,
  };
  if (kind !== 'ceiling') {
    out.extent = spec.extent === 'section' ? 'section' : 'full';
    out.u = r4(clamp(num(spec.u, 0), ...LIMIT.u));
    out.w = r4(clamp(num(spec.w, 1.2), ...LIMIT.w));
    out.h = spec.h == null || !Number.isFinite(Number(spec.h)) ? null : r4(clamp(Number(spec.h), ...LIMIT.h));
  }
  if (kind !== 'wall') out.direction = spec.direction === 'across' ? 'across' : 'along';
  return out;
}

/** The SLAT_LOOKS entry of a spec. */
export function lookOf(spec) {
  return SLAT_LOOKS.find((l) => l.id === spec?.look) ?? SLAT_LOOKS[0];
}

/** SLAT_SIZES key whose slats a spec has, or 'custom'. */
export function sizeOf(spec) {
  for (const [k, s] of Object.entries(SLAT_SIZES)) {
    if (Math.abs(s.slatW - spec?.slatW) < 5e-4 && Math.abs(s.gap - spec?.gap) < 5e-4) return k;
  }
  return 'custom';
}

/** True when the slats have felt behind them (sound absorbing). */
export function hasFelt(spec) {
  return !!spec && spec.backing !== 'none';
}

/**
 * Metres from the surface to the face of the slats.
 * @param {object} spec
 * @param {number} [base]  the back of the slats (default: the felt, or 0)
 */
export function finishDepth(spec, base = null) {
  if (!spec) return 0;
  return (base ?? (hasFelt(spec) ? FELT_T : 0)) + num(spec.depth, 0.012);
}

// ---------------------------------------------------------------------------------------------------------------
// Plan helpers (points as { x, y } Vector2-likes or [x, y])

const px = (p) => (Array.isArray(p) ? p[0] : p.x);
const py = (p) => (Array.isArray(p) ? p[1] : p.y);

function inPoly(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const ax = px(poly[i]), ay = py(poly[i]), bx = px(poly[j]), by = py(poly[j]);
    if (ay > y !== by > y && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) inside = !inside;
  }
  return inside;
}

function polyArea(poly) {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    a += px(p) * py(q) - px(q) * py(p);
  }
  return Math.abs(a) / 2;
}

/** Axis-aligned rectangle as a polygon. */
const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];

/** A plan polygon shrunk by d (convex-safe enough for room outlines: each edge moved inward, corners re-intersected). */
function inset(poly, d) {
  if (!d || poly.length < 3) return poly.map((p) => [px(p), py(p)]);
  const pts = poly.map((p) => [px(p), py(p)]);
  // orientation: positive area = counter-clockwise
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    s += p[0] * q[1] - q[0] * p[1];
  }
  const sign = s > 0 ? 1 : -1;
  const lines = pts.map((p, i) => {
    const q = pts[(i + 1) % pts.length];
    const dx = q[0] - p[0], dy = q[1] - p[1];
    const l = Math.hypot(dx, dy) || 1;
    const nx = (-dy / l) * sign, ny = (dx / l) * sign; // inward normal
    return { p: [p[0] + nx * d, p[1] + ny * d], dx, dy };
  });
  return lines.map((a, i) => {
    const b = lines[(i - 1 + lines.length) % lines.length];
    const den = b.dx * a.dy - b.dy * a.dx;
    if (Math.abs(den) < 1e-9) return a.p;
    const t = ((a.p[0] - b.p[0]) * a.dy - (a.p[1] - b.p[1]) * a.dx) / den;
    return [b.p[0] + b.dx * t, b.p[1] + b.dy * t];
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Regions

/** The skirting of a room (layout.baseboard for the living room, the room data's baseboard elsewhere). */
function skirtingOf(layout, roomId) {
  const raw = (layout?.spec?.rooms || []).find((r) => r.id === roomId)?.baseboard;
  if (raw) return raw;
  return !roomId || roomId === 'stue-kjokken' ? layout?.baseboard ?? null : null;
}

/** The ceilings of a wall's room it runs under (a point 5 cm into the room at every 25 cm). */
function ceilingsOverWall(layout, w) {
  const list = (layout?.house?.ceilings ?? layout?.ceilings ?? []).filter((c) => !w.levelId || !c.levelId || c.levelId === w.levelId);
  const out = new Set();
  const n = Math.max(2, Math.ceil(w.length / 0.25));
  for (let i = 0; i <= n; i++) {
    const u = (w.length * i) / n;
    const x = w.start.x + w.dir.x * u + w.normal.x * 0.05;
    const z = w.start.y + w.dir.y * u + w.normal.y * 0.05;
    for (const c of list) if (inPoly(x, z, c.polygon)) out.add(c);
  }
  return [...out];
}

/** Profile [[u, h]…] clipped to [a, b] (steps kept), capped at cap (crossings inserted). */
function clipProfile(profile, a, b, cap = Infinity) {
  const P = profile.length ? profile : [[0, 2.4], [1, 2.4]];
  const at = (u) => {
    if (u <= P[0][0]) return P[0][1];
    for (let i = 0; i < P.length - 1; i++) {
      const [u0, h0] = P[i], [u1, h1] = P[i + 1];
      if (u >= u0 && u <= u1) return u1 - u0 < 1e-9 ? h1 : h0 + ((h1 - h0) * (u - u0)) / (u1 - u0);
    }
    return P[P.length - 1][1];
  };
  const pts = [[a, at(a + 1e-9)]];
  for (const [u, h] of P) if (u > a + 1e-9 && u < b - 1e-9) pts.push([u, h]);
  pts.push([b, at(b - 1e-9)]);
  if (!Number.isFinite(cap)) return pts;
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    if (i > 0) {
      const q = pts[i - 1];
      if ((q[1] - cap) * (p[1] - cap) < 0 && Math.abs(p[0] - q[0]) > 1e-9) {
        const t = (cap - q[1]) / (p[1] - q[1]);
        out.push([q[0] + (p[0] - q[0]) * t, cap]);
      }
    }
    out.push([p[0], Math.min(p[1], cap)]);
  }
  return out;
}

/** Is wall b (the one before a) across a's start – an inside corner, where a's slats would run into b's? */
function insideCorner(a, b) {
  if (!b) return false;
  return b.normal.x * a.dir.x + b.normal.y * a.dir.y > 0.5;
}

/** Common slat fields of a region. */
function slatFields(spec, base) {
  return { base, slatW: spec.slatW, gap: spec.gap, depth: spec.depth, felt: hasFelt(spec) };
}

function wallRegion(layout, id, spec, finishes) {
  const w = wallOf(layout, id);
  if (!w || !(w.length > 0.05)) return null;
  const L = w.length;
  const H = layout.house;
  // inside corners with a finished neighbour: leave room for its slats
  const nb = (wid) => (wid && finishes?.[wid] && surfaceKind(layout, wid) === 'wall' ? wallOf(layout, wid) : null);
  const prev = nb(w.prevId);
  const skirt = skirtingOf(layout, w.roomId);
  const ceilings = ceilingsOverWall(layout, w);
  const trim = ceilings.some((c) => c.trim);
  const base = Math.max(hasFelt(spec) ? FELT_T : 0, skirt ? num(skirt.thickness, 0.012) + 0.002 : 0, trim ? 0.014 : 0);
  const cornerGap = (o) => finishDepth(finishes[o.id], Math.max(FELT_T, 0.014)) + 0.002;
  // (only the wall that starts at the corner steps back: the two panels butt, no gap and no overlap)
  let ua = prev && insideCorner(w, prev) ? cornerGap(prev) : 0;
  let ub = L;
  if (spec.extent === 'section') {
    const s0 = clamp(num(spec.u, 0), 0, L - 0.1);
    const s1 = clamp(s0 + num(spec.w, 1.2), s0 + 0.1, L);
    ua = Math.max(ua, s0);
    ub = Math.min(ub, s1);
  }
  if (ub - ua < 0.05) return null;
  // the top: the wall's top line (slope, steps) under the ceiling – and under the ceiling's own slats
  const ceilDepth = Math.max(0, ...ceilings.map((c) => (finishes?.[c.id] ? finishDepth(finishes[c.id]) : 0)));
  const drop = TOP_GAP + ceilDepth;
  const prof = (w.topProfile?.length ? w.topProfile : [[0, w.height ?? 2.4], [L, w.height ?? 2.4]]).map(([u, h]) => [u, h - drop]);
  const top = clipProfile(prof, ua, ub, spec.h == null ? Infinity : spec.h);
  if (top.every(([, v]) => v < 0.1)) return null;
  const poly = [[ua, 0], [ub, 0], ...top.reverse().map(([u, v]) => [u, Math.max(0.05, v)])];
  // holes: openings (the wall's own and its back's), wall fixtures
  const holes = [];
  for (const o of w.holes || w.openings || []) {
    const sill = num(o.sill, 0);
    const y0 = sill <= 0.01 ? -1 : sill - SILL_MARGIN;
    holes.push(rect(num(o.u0, 0) - HOLE_MARGIN, y0, num(o.u1, 0) + HOLE_MARGIN, num(o.top, 2.1) + HOLE_MARGIN));
  }
  const fy = num(w.floorY, 0);
  for (const f of H?.fixtures ?? layout.fixtures ?? []) {
    if (f.wallId !== id || !f.position) continue;
    const p = f.position;
    const u = (p.x - w.start.x) * w.dir.x + (p.z - w.start.y) * w.dir.y;
    const v = p.y - fy;
    const hw = num(f.dims?.w, 0.09) / 2 + 0.01, hh = num(f.dims?.h, 0.09) / 2 + 0.01;
    holes.push(rect(u - hw, v - hh, u + hw, v + hh));
  }
  return {
    kind: 'wall',
    surfaceId: id,
    roomId: w.roomId ?? null,
    frame: {
      origin: [w.start.x, fy, w.start.y],
      x: [w.dir3.x, w.dir3.y, w.dir3.z],
      y: [0, 1, 0],
      z: [w.normal3.x, w.normal3.y, w.normal3.z],
    },
    poly,
    holes,
    along: 'y',
    ...slatFields(spec, base),
    seed: `finish:${id}`,
  };
}

function ceilingRegion(layout, id, spec) {
  const c = ceilingOf(layout, id);
  if (!c || !(c.polygon?.length >= 3)) return null;
  const top = typeof c.topAt === 'function' ? c.topAt : (x, z) => num(c.floorY, 0) + c.heightAt(x, z);
  const cx = c.centroid?.x ?? c.polygon.reduce((s, p) => s + px(p), 0) / c.polygon.length;
  const cz = c.centroid?.y ?? c.polygon.reduce((s, p) => s + py(p), 0) / c.polygon.length;
  const e = 0.05;
  const oy = top(cx, cz);
  const a = (top(cx + e, cz) - top(cx - e, cz)) / (2 * e);
  const b = (top(cx, cz + e) - top(cx, cz - e)) / (2 * e);
  const plane = (x, z) => oy + a * (x - cx) + b * (z - cz);
  // slat direction in plan: along the ceiling's long side, or across it
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const p of c.polygon) {
    x0 = Math.min(x0, px(p));
    x1 = Math.max(x1, px(p));
    z0 = Math.min(z0, py(p));
    z1 = Math.max(z1, py(p));
  }
  const longX = x1 - x0 >= z1 - z0;
  const alongX = spec.direction === 'across' ? !longX : longX;
  const d = alongX ? [1, 0] : [0, 1];
  const norm = (v) => {
    const l = Math.hypot(v[0], v[1], v[2]) || 1;
    return [v[0] / l, v[1] / l, v[2] / l];
  };
  const U = norm([d[0], a * d[0] + b * d[1], d[1]]);
  const N = norm([a, -1, b]); // down, into the room
  const V = [N[1] * U[2] - N[2] * U[1], N[2] * U[0] - N[0] * U[2], N[0] * U[1] - N[1] * U[0]];
  const O = [cx, oy, cz];
  const local = (x, z) => {
    const P = [x - O[0], plane(x, z) - O[1], z - O[2]];
    return [P[0] * U[0] + P[1] * U[1] + P[2] * U[2], P[0] * V[0] + P[1] * V[1] + P[2] * V[2]];
  };
  // edges: clear of the walls (and of a ceiling trim)
  const edge = c.trim ? 0.014 : 0.004;
  const poly = inset(c.polygon, edge).map(([x, z]) => local(x, z));
  const holes = [];
  for (const hp of c.holes || []) if (hp?.length >= 3) holes.push(inset(hp, -0.01).map(([x, z]) => local(x, z)));
  // the ceiling's lamps (spots, downlights, LED strips, rails, pendant canopies) and ceiling fixtures (smoke detectors)
  const H = layout.house;
  const lights = H?.builtInLights ?? layout.builtInLights ?? [];
  // round fixtures get a round cut (16-gon): a spot / downlight a little wider than itself, a surface-mounted plafond or
  // smoke detector a little narrower – it covers the cut and sits on the slats; pendant canopies, ring lamps and rails
  // simply sit on the slats
  const circ = (x, z, d) => Array.from({ length: 16 }, (_, i) => {
    const a = (i / 16) * Math.PI * 2;
    return local(x + (Math.cos(a) * d) / 2, z + (Math.sin(a) * d) / 2);
  });
  const near = (p) => p && Math.abs(p.y - top(p.x, p.z)) < 0.6;
  const inside = (p) => p && inPoly(p.x, p.z, c.polygon);
  for (const l of lights) {
    if (c.levelId && l.levelId && l.levelId !== c.levelId) continue;
    const dims = l.dims || {};
    if (l.from && l.to) {
      if (!(inside(l.from) || inside(l.to)) || !near(l.from)) continue;
      const dx = l.to.x - l.from.x, dz = l.to.z - l.from.z;
      const len = Math.hypot(dx, dz) || 1;
      const ux = dx / len, uz = dz / len;
      const hw = num(dims.w, 0.03) / 2 + 0.02;
      const pts = [[-0.02, -hw], [len + 0.02, -hw], [len + 0.02, hw], [-0.02, hw]].map(([s, t]) => [l.from.x + ux * s - uz * t, l.from.z + uz * s + ux * t]);
      holes.push(pts.map(([hx, hz]) => local(hx, hz)));
      continue;
    }
    const p = l.position;
    if (!inside(p) || !near(p)) continue;
    const t = l.type || '';
    if (t === 'spot' || t === 'downlight') holes.push(circ(p.x, p.z, num(dims.d, 0.08) + 0.03));
    else if (t === 'plafond') holes.push(circ(p.x, p.z, Math.max(0.05, num(dims.d, 0.3) - 0.04)));
  }
  for (const f of H?.fixtures ?? layout.fixtures ?? []) {
    if (f.mount !== 'ceiling' || !f.position || !inside(f.position)) continue;
    if (c.levelId && f.levelId && f.levelId !== c.levelId) continue;
    holes.push(circ(f.position.x, f.position.z, Math.max(0.04, Math.max(num(f.dims?.w, 0.1), num(f.dims?.d, 0.1)) - 0.02)));
  }
  return {
    kind: 'ceiling',
    surfaceId: id,
    roomId: c.roomId ?? null,
    frame: { origin: O, x: U, y: V, z: N },
    poly,
    holes,
    along: 'x',
    ...slatFields(spec, hasFelt(spec) ? FELT_T : 0),
    seed: `finish:${id}`,
  };
}

/**
 * The outline of a finish in its surface's frame (see the top of the file), or null when nothing fits.
 * @param {object} layout
 * @param {string} id  surface id
 * @param {object} spec  the (normalised) finish
 * @param {{ finishes?: object }} [o]  the design's finishes (neighbouring walls, the ceiling's slats)
 */
export function finishRegion(layout, id, spec, { finishes = {} } = {}) {
  const kind = surfaceKind(layout, id);
  const s = normaliseFinish(spec, kind);
  if (!s) return null;
  if (kind === 'wall') return wallRegion(layout, id, s, finishes);
  if (kind === 'ceiling') return ceilingRegion(layout, id, s);
  return null;
}

// ---------------------------------------------------------------------------------------------------------------
// Slat layout: scanlines over the outline minus its holes

/** Sorted inside-intervals of a polygon along x at height y (even-odd). */
function scan(poly, y) {
  const xs = [];
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if (a[1] > y !== b[1] > y) xs.push(a[0] + ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]));
  }
  xs.sort((p, q) => p - q);
  const out = [];
  for (let i = 0; i + 1 < xs.length; i += 2) if (xs[i + 1] > xs[i]) out.push([xs[i], xs[i + 1]]);
  return out;
}

function union(list) {
  const s = [...list].sort((a, b) => a[0] - b[0]);
  const out = [];
  for (const iv of s) {
    const last = out[out.length - 1];
    if (last && iv[0] <= last[1]) last[1] = Math.max(last[1], iv[1]);
    else out.push([iv[0], iv[1]]);
  }
  return out;
}

function intersect(A, B) {
  const out = [];
  let i = 0, j = 0;
  while (i < A.length && j < B.length) {
    const lo = Math.max(A[i][0], B[j][0]);
    const hi = Math.min(A[i][1], B[j][1]);
    if (hi > lo) out.push([lo, hi]);
    if (A[i][1] < B[j][1]) i++;
    else j++;
  }
  return out;
}

function subtract(A, B) {
  let cur = A.map((x) => [...x]);
  for (const [b0, b1] of B) {
    const next = [];
    for (const [a0, a1] of cur) {
      if (b1 <= a0 || b0 >= a1) next.push([a0, a1]);
      else {
        if (b0 > a0) next.push([a0, b0]);
        if (b1 < a1) next.push([b1, a1]);
      }
    }
    cur = next;
  }
  return cur;
}

/** Intervals along x inside the outline and outside every hole for the whole band y0…y1. */
function bandRuns(poly, holes, y0, y1, minRun) {
  const e = 1e-6;
  const ys = new Set([y0 + e, y1 - e, (y0 + y1) / 2]);
  for (const P of [poly, ...holes]) for (const p of P) if (p[1] > y0 && p[1] < y1) {
    ys.add(p[1] - e);
    ys.add(p[1] + e);
  }
  let runs = null;
  const holeRuns = (y) => union(holes.flatMap((h) => scan(h, y)));
  for (const y of ys) {
    const r = subtract(scan(poly, y), holeRuns(y));
    runs = runs ? intersect(runs, r) : r;
    if (!runs.length) return [];
  }
  return (runs || []).filter(([a, b]) => b - a >= minRun);
}

/**
 * Where the slats and the backing strips go: one slat per pitch across the outline (centred), each cut into runs
 * at the outline and the holes; one backing strip per slat over its whole pitch. Coordinates are the region's:
 * `c` across the slats, runs [a, b] along them (region.along = 'y': c is x, runs are y).
 * @param {object} region  finishRegion()
 * @returns {{ slats: Array<{ c: number, runs: number[][] }>, strips: Array<{ c: number, runs: number[][] }>, area: number, pitch: number }}
 */
export function slatLayout(region) {
  const empty = { slats: [], strips: [], area: 0, pitch: 0 };
  if (!region?.poly?.length) return empty;
  // work in (along, across) coordinates: slats run along x there
  const sw = region.along === 'y' ? (p) => [p[1], p[0]] : (p) => [p[0], p[1]];
  const poly = region.poly.map(sw);
  const holes = (region.holes || []).map((h) => h.map(sw));
  const slatW = region.slatW, gap = region.gap;
  const pitch = slatW + gap;
  let c0 = Infinity, c1 = -Infinity;
  for (const p of poly) {
    c0 = Math.min(c0, p[1]);
    c1 = Math.max(c1, p[1]);
  }
  const span = c1 - c0;
  const n = Math.floor((span + gap) / pitch + 1e-6);
  if (n < 1 || n > 4000) return empty;
  const first = c0 + (span - (n * pitch - gap)) / 2 + slatW / 2;
  const slats = [];
  const strips = [];
  let area = 0;
  for (let i = 0; i < n; i++) {
    const c = first + i * pitch;
    const runs = bandRuns(poly, holes, c - slatW / 2, c + slatW / 2, MIN_RUN);
    if (runs.length) slats.push({ c, runs });
    if (region.felt) {
      const s = bandRuns(poly, holes, c - pitch / 2, c + pitch / 2, 0.02);
      if (s.length) {
        strips.push({ c, runs: s });
        area += s.reduce((t, [a, b]) => t + (b - a), 0) * pitch;
      }
    }
  }
  return { slats, strips, area, pitch };
}

/**
 * Covered area (m²) of a finish: its backing strips (cut at the outline and the holes).
 * @param {object} layout
 * @param {string} id
 * @param {object} spec
 * @param {{ finishes?: object }} [o]
 */
export function finishArea(layout, id, spec, o = {}) {
  const region = finishRegion(layout, id, spec, o);
  if (!region) return 0;
  return slatLayout({ ...region, felt: true }).area;
}

/** Plain area of a polygon (tests). */
export { polyArea as _polyArea, inPoly as _inPoly };
