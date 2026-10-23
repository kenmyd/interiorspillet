/**
 * Planbygger: the kitchen, bathroom and laundry fittings of a generated house (notes/kjokken-bad-genererte-hus.md) from
 * the symbols the AI saw on the plan (generate.js level.furniture: kitchen, stove, fridge, toilet, washbasin, shower,
 * bathtub, washer), as the house format's builtIns – one entry per fitting, against the nearest wall of its room; the
 * engine (src/home/builtinplan.js) joins the sink and the hob into the bench, puts glass on a shower's open sides and
 * tiles the walls.
 *
 *   fittingsOf(room, symbols, { walls, openings }) → { builtIns: [...], hints: [...] }
 *     room      { id, polygon (game [x, z], clockwise: the room on the right of each edge), lightUse }
 *     symbols   [{ kind, g: [x, z] }] of the level (the room's are picked here)
 *     walls     the house walls of the room (from, to, normal inward, id)
 *     openings  the level's openings as segments: [{ a, b, type, sill, height }] (game metres, on any wall line)
 *     hints     the lighting rules' hints: 'upper-cabinets' under the wall cabinets, 'mirror' over a basin
 *
 * The kitchen symbol is a counter along a wall: the bench runs along the wall from where the symbol is, between the
 * doors and the low windows, at most 3,6 m, with a fridge-freezer at one end, the sink under a window (else near the
 * other end), the hob at the stove symbol (else away from the sink), a dishwasher beside the sink, a hood over the hob
 * and wall cabinets over the rest where there is no window. In a laundry the symbol is the laundry's bench (with a
 * utility sink; a washer under it becomes a slot in it), in a bathroom nothing. A kitchen the room's name or use says
 * (room.lightUse kitchen or kitchen-living) without a counter on the plan gets one along the longest free stretch of
 * wall; a bathroom or WC without a basin gets one with its mirror. A shower, a bath or a washer near a corner goes
 * into it.
 */
import { sub, add, mul, dot, dist, perp, round, pointInPolygon, projectToSegment } from './geom.js';

const R = (v) => round(v, 3);
const DEG = 180 / Math.PI;
/** the depth of a counter (and of the floor in front of it, where a symbol drawn on the counter lies) */
const COUNTER = 0.6;
const BENCH_MAX = 3.6;
const BENCH_MIN = 1.2;
/** a window lower than this over the counter's top is in the counter's way (a low one: none there) */
const WINDOW_OVER_COUNTER = 0.95;

/** The room's edges with their inward normals and whether each end is an inner corner of the room. */
function edgesOf(poly) {
  const n = poly.length;
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % n];
    const L = dist(a, b);
    if (L < 0.05) continue;
    const d = mul(sub(b, a), 1 / L);
    out.push({ i, a, b, L, d, n: perp(d) });
  }
  // an end is a corner the room turns inward at (the next edge goes along the normal): a fitting may stand into it
  out.forEach((e, k) => {
    const next = out[(k + 1) % out.length];
    const prev = out[(k - 1 + out.length) % out.length];
    e.cornerEnd = dot(next.d, e.n) > 0.7;
    e.cornerStart = dot(mul(prev.d, -1), e.n) > 0.7;
  });
  return out;
}

/** The nearest edge to p: { e, u (along it), d }. */
function nearestEdge(edges, p) {
  let best = null;
  for (const e of edges) {
    const pr = projectToSegment(p, e.a, e.b);
    if (!best || pr.d < best.d) best = { e, u: pr.t * e.L, d: pr.d };
  }
  return best;
}

/** The openings on an edge's line (within a wall's thickness behind it), as [u0, u1] with their type and sill. */
function openingsOn(e, openings) {
  const out = [];
  for (const o of openings) {
    const da = dot(sub(o.a, e.a), e.n);
    const db = dot(sub(o.b, e.a), e.n);
    if (Math.abs(da - db) > 0.02 || da > 0.02 || da < -0.7) continue;
    const ua = dot(sub(o.a, e.a), e.d);
    const ub = dot(sub(o.b, e.a), e.d);
    const u0 = Math.max(0, Math.min(ua, ub));
    const u1 = Math.min(e.L, Math.max(ua, ub));
    if (u1 - u0 > 0.05) out.push({ ...o, u0, u1 });
  }
  return out;
}

/** The front direction of a fitting facing along n, as the format's rotationDeg (0 = +z, 90 = +x). */
const rotationOf = (n) => R(Math.atan2(n[0], n[1]) * DEG) || 0;

export function fittingsOf(room, symbols, { walls = [], openings = [] } = {}) {
  const builtIns = [];
  const hints = [];
  const poly = room.polygon;
  const mine = symbols.filter((s) => pointInPolygon(s.g, poly));
  const use = room.lightUse;
  const kitchenRoom = ['kitchen', 'kitchen-living'].includes(use);
  const bathRoom = ['bathroom', 'wc'].includes(use);
  if (!mine.length && !kitchenRoom && !bathRoom) return { builtIns, hints };
  const edges = edgesOf(poly);
  // what the fittings take along each edge ([u0, u1]): the defaults below go where nothing is
  const occ = new Map();
  const take = (e, u0, u1) => (occ.get(e) ?? occ.set(e, []).get(e)).push([u0, u1]);
  /** a footprint w × d out from edge e at u takes every wall it stands against (a shower in a corner takes both) */
  const takeFootprint = (e, u, w, d) => {
    const corners = [[-w / 2, 0], [w / 2, 0], [w / 2, d], [-w / 2, d]].map(([s, t]) => add(add(e.a, mul(e.d, u + s)), mul(e.n, t)));
    for (const e2 of edges) {
      const close = corners.filter((c) => {
        const off = dot(sub(c, e2.a), e2.n);
        return off > -0.05 && off < 0.1;
      });
      if (close.length < 2) continue;
      const us = close.map((c) => dot(sub(c, e2.a), e2.d));
      if (Math.max(...us) > 0 && Math.min(...us) < e2.L) take(e2, Math.min(...us), Math.max(...us));
    }
  };
  const taken = (e, u0, u1) => (occ.get(e) ?? []).some(([x0, x1]) => x1 > u0 + 0.01 && x0 < u1 - 0.01);
  const at = (e, u, off = 0) => add(add(e.a, mul(e.d, u)), mul(e.n, off));
  // the house wall of the room under a point of an edge (wall fittings need one)
  const wallAt = (e, u) => {
    const p = at(e, u);
    let best = null;
    for (const w of walls) {
      const pr = projectToSegment(p, w.from, w.to);
      if (pr.d < 0.02 && (!best || pr.d < best.d)) best = { w, d: pr.d };
    }
    return best?.w.id ?? null;
  };
  let k = 0;
  const id = (what) => `bi-${room.id}-${what}-${++k}`;
  const push = (b) => builtIns.push({ ...b, roomId: room.id, estimated: ['position', 'dims'], source: `planbyggeren: ${b.source ?? 'symbolet KI-en så på planen'}` });
  const wallItem = (type, e, u, { w, d, h, y, name, params, source }) => {
    const wallId = wallAt(e, u);
    if (!wallId) return null;
    const p = at(e, u);
    const b = { id: id(type), type, mount: 'wall', wallId, position: [R(p[0]), y, R(p[1])], rotationDeg: rotationOf(e.n), dims: { w: R(w), d, h }, ...(name ? { name } : {}), ...(params ? { params } : {}), source };
    push(b);
    if (y < 1.2) takeFootprint(e, u, w, d);
    return b;
  };
  const floorItem = (type, e, u, { w, d, h, name, params, source }) => {
    const p = at(e, u, d / 2);
    const b = { id: id(type), type, mount: 'floor', position: [R(p[0]), 0, R(p[1])], rotationDeg: rotationOf(e.n), dims: { w: R(w), d, h }, ...(name ? { name } : {}), ...(params ? { params } : {}), source };
    push(b);
    takeFootprint(e, u, w, d);
    return b;
  };
  /** u along e for a fitting of width w at u0: into the corner when the symbol is within `snap` of it, inside the edge */
  const place = (e, u0, w, snap) => {
    if (e.cornerStart && u0 - w / 2 < snap) return w / 2;
    if (e.cornerEnd && e.L - u0 - w / 2 < snap) return e.L - w / 2;
    return Math.max(w / 2, Math.min(e.L - w / 2, u0));
  };
  /** whether [u0, u1] of e is clear of the doors, passages and windows lower than `sill` */
  const clear = (e, u0, u1, sill = Infinity) => !openingsOn(e, openings).some((o) => o.u1 > u0 + 0.01 && o.u0 < u1 - 0.01 && (o.type !== 'window' || o.sill < sill));

  const vanity = (e, uu, source) => {
    if (!wallItem('vanity', e, uu, { w: 0.6, d: 0.46, h: 0.5, y: 0.35, name: 'Servant', source })) return false;
    // the mirror over it (and its lamp), where no window is
    if (clear(e, uu - 0.3, uu + 0.3, 2.0)) {
      wallItem('mirror', e, uu, { w: 0.6, d: 0.03, h: 0.8, y: 1.1, name: 'Speil', source });
      const p = at(e, uu);
      hints.push({ type: 'mirror', position: [R(p[0]), R(p[1])], height: 1.5 });
    }
    return true;
  };
  // the counters first (the fittings beside them see what they take), then the rest
  const order = (s) => (s.kind === 'kitchen' ? 0 : 1);
  let counters = 0;
  let basins = 0;
  for (const s of [...mine].sort((p, q) => order(p) - order(q))) {
    const ne = nearestEdge(edges, s.g);
    if (!ne || ne.d > 1.6) continue;
    const { e, u } = ne;
    if (s.kind === 'toilet') {
      wallItem('wc', e, place(e, u, 0.6, 0.35), { w: 0.6, d: 0.2, h: 1.1, y: 0, name: 'WC' });
    } else if (s.kind === 'washbasin') {
      if (vanity(e, place(e, u, 0.6, 0.2))) basins++;
    } else if (s.kind === 'shower') {
      floorItem('shower', e, place(e, u, 0.9, 0.6), { w: 0.9, d: 0.9, h: 2, name: 'Dusj' });
    } else if (s.kind === 'bathtub') {
      floorItem('bathtub', e, place(e, u, 1.7, 0.9), { w: 1.7, d: 0.75, h: 0.58, name: 'Badekar' });
    } else if (s.kind === 'washer') {
      floorItem('washer', e, place(e, u, 0.6, 0.4), { w: 0.6, d: 0.6, h: 0.85, name: 'Vaskemaskin' });
    } else if (s.kind === 'fridge' && !mine.some((x) => x.kind === 'kitchen' && dist(x.g, s.g) < 1.2)) {
      wallItem('fridge-freezer', e, place(e, u, 0.6, 0.4), { w: 0.6, d: 0.6, h: 2.1, y: 0, name: 'Kjøleskap' });
    } else if (s.kind === 'kitchen') {
      // a counter in a laundry is the laundry's bench (the AI calls any counter a kitchen); in a bathroom none
      if (use === 'laundry') counters += laundryBench(e, u) ? 1 : 0;
      else if (!bathRoom) counters += kitchen(e, u) ? 1 : 0;
    }
  }
  // a kitchen the plan names without the AI seeing its counter (hus4's «Stue/Kjøkken»): the bench along the longest
  // stretch of wall clear of doors and low windows (where the furnishing keeps the floor free for it)
  if (kitchenRoom && !counters) {
    const best = longestFree(WINDOW_OVER_COUNTER, 1.8);
    if (best) kitchen(best.e, (best.u0 + best.u1) / 2, 'kjøkkenet planen viser, benken langs den lengste ledige veggen');
  }
  // a bathroom without a basin on the plan: one, with its mirror, on the longest free stretch of wall
  if (bathRoom && !basins) {
    const best = longestFree(2.0, 0.7);
    if (best) vanity(best.e, (best.u0 + best.u1) / 2, 'servanten på badet, på den lengste ledige veggen');
  }
  return { builtIns, hints };

  /** The longest stretch of an edge clear of the doors, the windows lower than `sill` and the fittings, ≥ min. */
  function longestFree(sill, min) {
    let best = null;
    for (const e of edges) {
      const cuts = [
        ...openingsOn(e, openings).filter((o) => o.type !== 'window' || o.sill < sill).map((o) => [o.u0 - 0.1, o.u1 + 0.1]),
        ...(occ.get(e) ?? []),
      ].sort((p, q) => p[0] - q[0]);
      let from = 0;
      for (const [x0, x1] of [...cuts, [e.L, e.L]]) {
        const to = Math.min(e.L, x0);
        if (to - from >= min && (!best || to - from > best.u1 - best.u0)) best = { e, u0: from, u1: to };
        from = Math.max(from, x1);
      }
    }
    return best;
  }

  /** A laundry's bench along edge e round u0 (at most 2,4 m) with a utility sink at one end; a washer under it. */
  function laundryBench(e, u0) {
    const span = freeSpan(e, u0, WINDOW_OVER_COUNTER, 2.4);
    if (!span || span[1] - span[0] < 1.2) return false;
    const [a, b] = span;
    const L = b - a;
    const ok = wallItem('laundry-bench', e, (a + b) / 2, { w: L, d: 0.6, h: 0.9, y: 0, name: 'Benk i vaskerommet', params: { sink: { at: R(L / 2 - 0.4), w: 0.5, d: 0.4 } }, source: 'benken KI-en så i vaskerommet' });
    if (ok) take(e, a, b);
    return !!ok;
  }

  /** The span along e round u0 clear of the doors, passages, windows lower than `sill` and fittings, at most max. */
  function freeSpan(e, u0, sill, max) {
    const blocks = [
      ...openingsOn(e, openings).filter((o) => o.type !== 'window' || o.sill < sill).map((o) => [o.u0 - 0.05, o.u1 + 0.05]),
      ...(occ.get(e) ?? []),
    ];
    let a = 0;
    let b = e.L;
    for (const [x0, x1] of blocks) {
      if (x1 <= u0) a = Math.max(a, x1);
      else if (x0 >= u0) b = Math.min(b, x0);
      else if (u0 - x0 < x1 - u0) a = Math.max(a, x1);
      else b = Math.min(b, x0);
    }
    if (b <= a) return null;
    if (b - a > max) {
      const c = Math.max(a + max / 2, Math.min(b - max / 2, u0));
      [a, b] = [c - max / 2, c + max / 2];
    }
    return [a, b];
  }

  /** The counter along edge e from u0: the free span round it (doors, low windows), the units in it. */
  function kitchen(e, u0, source = 'kjøkkenbenken KI-en så på planen') {
    const ops = openingsOn(e, openings);
    const span = freeSpan(e, u0, WINDOW_OVER_COUNTER, BENCH_MAX);
    if (!span || span[1] - span[0] < BENCH_MIN) return false;
    let [a, b] = span;
    take(e, a, b);
    // the fridge-freezer at the end away from the window (or at the start), unless the plan has its own
    const fridgeSym = mine.some((x) => x.kind === 'fridge' && dist(x.g, at(e, Math.max(a, Math.min(b, dot(sub(x.g, e.a), e.d))))) < 1.2);
    const win = ops.filter((o) => o.type === 'window' && o.u1 > a && o.u0 < b).sort((p, q) => Math.abs((p.u0 + p.u1) / 2 - u0) - Math.abs((q.u0 + q.u1) / 2 - u0))[0];
    const winU = win ? (Math.max(a, win.u0) + Math.min(b, win.u1)) / 2 : null;
    if (!fridgeSym && b - a >= 2.4) {
      const atEnd = winU != null && winU < (a + b) / 2;
      const fu = atEnd ? b - 0.3 : a + 0.3;
      if (wallItem('fridge-freezer', e, fu, { w: 0.6, d: 0.6, h: 2.1, y: 0, name: 'Kjøleskap', source: 'kjøleskapet ved enden av benken' })) {
        if (atEnd) b -= 0.6;
        else a += 0.6;
      }
    }
    const L = b - a;
    const bench = wallItem('kitchen-bench', e, (a + b) / 2, { w: L, d: 0.6, h: 0.9, y: 0, name: 'Kjøkkenbenk', params: { backsplash: true }, source });
    if (!bench) return false;
    // the hob at the stove symbol, the sink under the window (else at the other end); a metre apart at least
    const stove = mine.find((x) => x.kind === 'stove' && Math.abs(dot(sub(x.g, e.a), e.n)) < 1.0);
    const inSpan = (v, w) => Math.max(a + w / 2, Math.min(b - w / 2, v));
    let sinkU = inSpan(winU ?? a + 0.45, 0.8);
    let hobU = inSpan(stove ? dot(sub(stove.g, e.a), e.d) : sinkU < (a + b) / 2 ? b - 0.45 : a + 0.45, 0.6);
    if (Math.abs(hobU - sinkU) < 1.0) hobU = inSpan(sinkU < (a + b) / 2 ? sinkU + 1.2 : sinkU - 1.2, 0.6);
    if (Math.abs(hobU - sinkU) < 0.9) {
      // too short for both apart: the sink at one end, the hob at the other
      sinkU = a + 0.4;
      hobU = b - 0.3;
    }
    floorItem('sink', e, sinkU, { w: 0.8, d: 0.5, h: 0.9, name: 'Kjøkkenvask', params: { bowls: 2 } });
    floorItem('hob', e, hobU, { w: 0.6, d: 0.52, h: 0.9, name: 'Koketopp' });
    floorItem('oven', e, hobU, { w: 0.6, d: 0.6, h: 0.9, name: 'Stekeovn' });
    // the dishwasher beside the sink: away from the hob, else toward it when it fits between them
    const away = hobU > sinkU ? -1 : 1;
    const dwU = [sinkU + away * 0.7, sinkU - away * 0.7].find((u) => u - 0.3 >= a - 1e-6 && u + 0.3 <= b + 1e-6 && Math.abs(u - hobU) >= 0.6 - 1e-6);
    if (dwU != null) floorItem('dishwasher', e, dwU, { w: 0.6, d: 0.6, h: 0.9, name: 'Oppvaskmaskin' });
    // over the counter: the hood over the hob, wall cabinets where there is wall (no window, not the hood)
    const hoodFree = clear(e, hobU - 0.3, hobU + 0.3, 2.3);
    if (hoodFree) wallItem('hood', e, hobU, { w: 0.6, d: 0.48, h: 0.5, y: 1.55, name: 'Ventilator' });
    const cut = ops.filter((o) => o.u1 > a && o.u0 < b && (o.type !== 'window' || o.sill + o.height > 1.45)).map((o) => [o.u0 - 0.05, o.u1 + 0.05]);
    if (hoodFree) cut.push([hobU - 0.32, hobU + 0.32]);
    cut.sort((p, q) => p[0] - q[0]);
    let from = a;
    for (const [x0, x1] of [...cut, [b, b]]) {
      const to = Math.min(b, x0);
      if (to - from >= 0.6) {
        const c = wallItem('wall-cabinets', e, (from + to) / 2, { w: to - from, d: 0.35, h: 0.7, y: 1.45, name: 'Overskap' });
        if (c) {
          const p0 = at(e, from);
          const p1 = at(e, to);
          hints.push({ type: 'upper-cabinets', from: [R(p0[0]), R(p0[1])], to: [R(p1[0]), R(p1[1])] });
        }
      }
      from = Math.max(from, x1);
    }
    return true;
  }
}
