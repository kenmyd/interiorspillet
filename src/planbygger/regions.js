/**
 * Planbygger: rooms as the closed regions between the walls of a level (the editor's wall model, not the image).
 *
 *   findRooms(walls, { res = 0.02, separators = [], cutIslands = false }) → {
 *     rooms: [{ index, polygon: [[x, y], …], edges: [{ wall: wallId|null, side: 1|-1|0, separator?: id }], area,
 *               inside: [x, y] }],
 *     at(x, y) → room index | -1 (outside) | -2 (in a wall),
 *     raster: { w, h, x0, y0, res, labels },
 *     cuts: [{ id: 'cutN', a, b, cut: true }]   the island cuts (cutIslands), separators like the level's
 *   }
 *   levelRooms(level, opts) → findRooms(level.walls, { cutIslands: true, ...opts, separators: level.separators }): the
 *     rooms of a level as the editor and the house file should see them (with its separators, islands cut out)
 *
 * The walls are drawn into a raster (res metres per cell, the band of each wall extended by half its thickness at both
 * ends so corners close), the free cells are flood filled, the region touching the border is outside. Each room's outer
 * boundary is traced along the cell edges, simplified (Douglas–Peucker, so the staircase of a diagonal wall becomes
 * one edge) and every edge is snapped onto the face of the wall it runs along: the polygon is exact to the wall faces,
 * not to the raster. polygon is oriented with positive shoelace area in the plan frame (x right, y down): the room
 * lies to the right of each edge and the inward normal is perp(d) = (−d.y, d.x) – the room-spec convention.
 *
 * Openings do not matter here: a door is a hole in a wall, the wall still closes the room.
 *
 * Separators ([{ id, a, b }], plan metres: the dash-dot lines between open zones, detect.js separators, level.separators)
 * split a region like a wall of no thickness – a thin barrier in the raster, reaching into the walls at its ends – but
 * are no walls: an edge along one has wall null, side 0 and separator = its id, and both rooms share its line.
 */
import { sub, add, mul, dot, cross, dist, unit, perp, signedArea, simplifyRing, dropCollinear, lineIntersection, projectToSegment } from './geom.js';
import { distanceToMask } from './image.js';

const MIN_ROOM_AREA = 0.25; // m² – smaller regions are slivers between walls

/** Wall geometry: a, b, t → u (direction), n (left normal), L. */
export function wallFrame(w) {
  const d = sub(w.b, w.a);
  const L = Math.hypot(d[0], d[1]);
  const u = L > 0 ? [d[0] / L, d[1] / L] : [1, 0];
  return { u, n: perp(u), L };
}

/**
 * How far each end of a wall reaches past its end point: half the thickness of the thickest other wall whose centre
 * line passes through that point (an L corner closes, a T joint stops at the far face of the through wall, a free end
 * stops at its point). Returns { a, b } in metres.
 */
export function endExtensions(w, walls, tol = 0.02) {
  const ext = (p) => {
    let e = 0;
    for (const o of walls) {
      if (o === w || !(o.t > 0)) continue;
      if (projectToSegment(p, o.a, o.b).d <= tol) e = Math.max(e, o.t / 2);
    }
    return e;
  };
  return { a: ext(w.a), b: ext(w.b) };
}

/** The band of a wall as a polygon [a−, b−, b+, a+] with its end extensions (for drawing and rasterising). */
export function wallBand(w, walls) {
  const { u, n } = wallFrame(w);
  const e = endExtensions(w, walls);
  const A = add(w.a, mul(u, -e.a));
  const B = add(w.b, mul(u, e.b));
  const h = w.t / 2;
  return [add(A, mul(n, -h)), add(B, mul(n, -h)), add(B, mul(n, h)), add(A, mul(n, h))];
}

/**
 * The rooms of a level as the editor and the house file see them: with its separators (model.js level.separators), and
 * an island – a block of rooms standing free inside another room's region (hus2: WC/D and BOD in the open living room)
 * – cut out with two straight cuts (cutIslands), because a room of the house format is one simple polygon.
 */
export function levelRooms(level, opts = {}) {
  return findRooms(level.walls || [], { cutIslands: true, ...opts, separators: level.separators || [] });
}

/**
 * The rooms between the walls (see the top of the file). cutIslands: a region with an island of rooms inside it is
 * split by two straight cuts from the island to the walls around it (the shortest pair across the island, vertical or
 * horizontal), so every room is a simple polygon; the cuts are separators of no thickness with ids «cutN» and
 * `cut: true` (result.cuts), and an edge along one has separator = its id like any other.
 */
export function findRooms(walls, { res = 0.02, margin = 0.6, separators = [], cutIslands = false } = {}) {
  const good = walls.filter((w) => w && w.t > 0 && dist(w.a, w.b) > 1e-3);
  if (!good.length) return { rooms: [], at: () => -1, raster: null, cuts: [] };
  const base = (separators || []).filter((s) => s && s.a && s.b && dist(s.a, s.b) > 1e-3);
  let cuts = [];
  let out = roomsOnce(good, base, res, margin);
  // islands: cut, and again (a cut that ends on another island leaves that one to be cut too) – at most three rounds
  for (let round = 0; cutIslands && round < 3; round++) {
    const more = islandCuts(out, res, cuts.length);
    if (!more.length) break;
    cuts = [...cuts, ...more];
    out = roomsOnce(good, [...base, ...cuts], res, margin);
  }
  delete out.raster.rings;
  return { ...out, cuts };
}

/** One room search with the given separators (findRooms without the island cuts). */
function roomsOnce(good, seps, res, margin) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const w of good) {
    for (const p of [w.a, w.b]) {
      minX = Math.min(minX, p[0] - w.t);
      minY = Math.min(minY, p[1] - w.t);
      maxX = Math.max(maxX, p[0] + w.t);
      maxY = Math.max(maxY, p[1] + w.t);
    }
  }
  const x0 = minX - margin;
  const y0 = minY - margin;
  const W = Math.ceil((maxX - x0 + margin) / res) + 1;
  const H = Math.ceil((maxY - y0 + margin) / res) + 1;
  if (W * H > 12e6) throw new Error('planen er for stor for romsøket (maks ca. 70 × 70 m ved 2 cm)');
  const cellX = (i) => x0 + (i + 0.5) * res;
  const cellY = (j) => y0 + (j + 0.5) * res;

  // ---- walls into the raster (sepOnly: the cells only a separator blocks – where a room's edge runs along one)
  const wallMask = new Uint8Array(W * H);
  const sepOnly = seps.length ? new Uint8Array(W * H) : null;
  const frames = good.map((w) => ({ w, ...wallFrame(w), ext: endExtensions(w, good) }));
  // separators: a barrier two cells wide (no 4-connected leak past a diagonal one), into the walls at its ends; snapped
  // to as a face of no thickness
  const sepFrames = seps.map((s, i) => {
    const w = { id: s.id ?? `s${i + 1}`, a: s.a, b: s.b, t: 0 };
    const e = endExtensions(w, good);
    return { w, ...wallFrame(w), ext: { a: e.a + res, b: e.b + res }, half: res, sep: true };
  });
  for (const { w, u, n, L, ext: E, half: hb, sep } of [...frames, ...sepFrames]) {
    const hw = hb ?? w.t / 2;
    const corners = [
      add(add(w.a, mul(u, -E.a)), mul(n, hw)),
      add(add(w.a, mul(u, -E.a)), mul(n, -hw)),
      add(add(w.b, mul(u, E.b)), mul(n, hw)),
      add(add(w.b, mul(u, E.b)), mul(n, -hw)),
    ];
    const i0 = Math.max(0, Math.floor((Math.min(...corners.map((c) => c[0])) - x0) / res) - 1);
    const i1 = Math.min(W - 1, Math.ceil((Math.max(...corners.map((c) => c[0])) - x0) / res) + 1);
    const j0 = Math.max(0, Math.floor((Math.min(...corners.map((c) => c[1])) - y0) / res) - 1);
    const j1 = Math.min(H - 1, Math.ceil((Math.max(...corners.map((c) => c[1])) - y0) / res) + 1);
    const half = hb ?? w.t / 2;
    for (let j = j0; j <= j1; j++) {
      const py = cellY(j);
      for (let i = i0; i <= i1; i++) {
        const q = [cellX(i) - w.a[0], py - w.a[1]];
        const s = dot(q, u);
        const o = dot(q, n);
        if (s >= -E.a && s <= L + E.b && o >= -half && o <= half) {
          if (sep && !wallMask[j * W + i]) sepOnly[j * W + i] = 1;
          wallMask[j * W + i] = 1;
        }
      }
    }
  }

  // ---- flood fill of the free cells (4-connected); label 0 = outside (touches the border)
  const labels = new Int32Array(W * H).fill(-2);
  for (let k = 0; k < W * H; k++) if (!wallMask[k]) labels[k] = -1;
  const stack = new Int32Array(W * H);
  const regions = [];
  const fill = (start, id) => {
    let top = 0;
    stack[top++] = start;
    labels[start] = id;
    let count = 0;
    let border = false;
    while (top) {
      const k = stack[--top];
      count++;
      const i = k % W;
      const j = (k - i) / W;
      if (i === 0 || j === 0 || i === W - 1 || j === H - 1) border = true;
      if (i > 0 && labels[k - 1] === -1) (labels[k - 1] = id), (stack[top++] = k - 1);
      if (i < W - 1 && labels[k + 1] === -1) (labels[k + 1] = id), (stack[top++] = k + 1);
      if (j > 0 && labels[k - W] === -1) (labels[k - W] = id), (stack[top++] = k - W);
      if (j < H - 1 && labels[k + W] === -1) (labels[k + W] = id), (stack[top++] = k + W);
    }
    return { count, border, start };
  };
  for (let k = 0; k < W * H; k++) {
    if (labels[k] !== -1) continue;
    const id = regions.length;
    regions.push({ id, ...fill(k, id) });
  }

  // ---- the inside point of each room: the cell farthest from every wall
  const free = { w: W, h: H, data: wallMask };
  const dt = distanceToMask(free);

  // ---- per room: trace, simplify, snap
  const rooms = [];
  const rings = []; // per room: its region id and its outer ring in grid corners (the island search)
  const regionToRoom = new Map();
  for (const rg of regions) {
    if (rg.border) continue;
    const a = rg.count * res * res;
    if (a < MIN_ROOM_AREA) continue;
    const ring = traceOuter(labels, W, H, rg.id, rg.start);
    if (!ring || ring.length < 4) continue;
    // where the edge passes from a wall to a separator, the ring keeps its vertex: a separator that continues a wall
    // line (hus4) lies one cell from the wall's face, which the simplification would smooth into one edge
    const typed = sepOnly ? splitByOutside(ring, W, H, sepOnly) : null;
    const simple = typed?.keep.some(Boolean)
      ? simplifyKept(typed.pts.map(([i, j]) => [x0 + i * res, y0 + j * res]), typed.keep, res)
      : dropCollinear(simplifyRing(dropCollinear(ring.map(([i, j]) => [x0 + i * res, y0 + j * res]), 1e-9), res * 1.2), res * 0.05);
    const snapped = snapToFaces(alongSlanted(simple, frames, res), [...frames, ...sepFrames], res);
    if (!snapped || snapped.polygon.length < 3 || signedArea(snapped.polygon) <= 0) continue;
    rings.push({ id: rg.id, ring });
    let best = -1;
    let bestK = rg.start;
    for (let k = 0; k < W * H; k++) {
      if (labels[k] === rg.id && dt.data[k] > best) {
        best = dt.data[k];
        bestK = k;
      }
    }
    const bi = bestK % W;
    const bj = (bestK - bi) / W;
    const room = {
      index: rooms.length,
      polygon: snapped.polygon,
      edges: snapped.edges,
      area: signedArea(snapped.polygon),
      cellArea: a,
      inside: [cellX(bi), cellY(bj)],
      clearance: best * res,
    };
    regionToRoom.set(rg.id, room.index);
    rooms.push(room);
  }

  const at = (x, y) => {
    const i = Math.floor((x - x0) / res);
    const j = Math.floor((y - y0) / res);
    if (i < 0 || j < 0 || i >= W || j >= H) return -1;
    const l = labels[j * W + i];
    if (l === -2) return -2;
    return regionToRoom.has(l) ? regionToRoom.get(l) : -1;
  };
  return { rooms, at, raster: { w: W, h: H, x0, y0, res, labels, wallMask, rings } };
}

/**
 * The cuts that take the islands out of the rooms of one room search: per room, the cells inside its outer ring that
 * are not its own form islands (4-connected); an island holding another room (a region of the search, not a free-
 * standing wall – that one is left as it is) gets two straight cuts, from its top and bottom (or its left and right)
 * out to the first wall, at the column (row) where the two together are shortest – the middle of the near-shortest
 * ones. → [{ id: 'cutN', a, b, cut: true }] in plan metres, each from the island's face cell to the wall cell it reaches.
 */
function islandCuts(found, res, n0 = 0) {
  const { raster } = found;
  if (!raster?.rings?.length) return [];
  const { w: W, h: H, x0, y0, labels, rings } = raster;
  const roomRegions = new Set(rings.map((r) => r.id));
  const stamp = new Int32Array(W * H);
  let tag = 0;
  const cuts = [];
  const cellX = (i) => x0 + (i + 0.5) * res;
  const cellY = (j) => y0 + (j + 0.5) * res;
  for (const { id, ring } of rings) {
    // the cells inside the outer ring (its edges run on the cell corners): scan the rows between the vertical edges
    tag++;
    const inside = tag;
    let jMin = Infinity;
    let jMax = -Infinity;
    for (const [, j] of ring) {
      jMin = Math.min(jMin, j);
      jMax = Math.max(jMax, j);
    }
    const holes = [];
    for (let j = jMin; j < jMax; j++) {
      const xs = [];
      for (let k = 0; k < ring.length; k++) {
        const p = ring[k];
        const q = ring[(k + 1) % ring.length];
        if (p[0] !== q[0]) continue;
        const lo = Math.min(p[1], q[1]);
        const hi = Math.max(p[1], q[1]);
        if (j + 0.5 > lo && j + 0.5 < hi) xs.push(p[0]);
      }
      xs.sort((p, q) => p - q);
      for (let m = 0; m + 1 < xs.length; m += 2) {
        for (let i = xs[m]; i < xs[m + 1]; i++) {
          const k = j * W + i;
          stamp[k] = inside;
          if (labels[k] !== id) holes.push(k);
        }
      }
    }
    if (holes.length * res * res < 0.05) continue;
    // the islands: 4-connected hole cells; only those that hold a room
    for (const start of holes) {
      if (stamp[start] !== inside) continue;
      tag++;
      const comp = tag;
      stamp[start] = comp;
      const stack = [start];
      let hasRoom = false;
      let ci0 = Infinity;
      let ci1 = -Infinity;
      let cj0 = Infinity;
      let cj1 = -Infinity;
      while (stack.length) {
        const k = stack.pop();
        const i = k % W;
        const j = (k - i) / W;
        ci0 = Math.min(ci0, i);
        ci1 = Math.max(ci1, i);
        cj0 = Math.min(cj0, j);
        cj1 = Math.max(cj1, j);
        if (roomRegions.has(labels[k])) hasRoom = true;
        for (const nb of [i > 0 ? k - 1 : -1, i < W - 1 ? k + 1 : -1, j > 0 ? k - W : -1, j < H - 1 ? k + W : -1]) {
          if (nb >= 0 && stamp[nb] === inside && labels[nb] !== id) {
            stamp[nb] = comp;
            stack.push(nb);
          }
        }
      }
      if (!hasRoom) continue;
      // per column (vertical cuts) and per row (horizontal): the island's first and last cell there, and how far the
      // room reaches beyond them to the next wall
      const cands = [];
      const walk = (k, step, n) => {
        let len = 0;
        for (let c = 0; c < n; c++) {
          k += step;
          if (labels[k] !== id) return { len, end: k };
          len++;
        }
        return null;
      };
      for (let i = ci0; i <= ci1; i++) {
        let a = -1;
        let b = -1;
        for (let j = cj0; j <= cj1; j++) {
          if (stamp[j * W + i] !== comp) continue;
          if (a < 0) a = j;
          b = j;
        }
        if (a < 0) continue;
        const up = walk(a * W + i, -W, a);
        const down = walk(b * W + i, W, H - 1 - b);
        if (up?.len > 0 && down?.len > 0) cands.push({ axis: 'v', pos: i, len: up.len + down.len, from: [a * W + i, b * W + i], to: [up.end, down.end] });
      }
      for (let j = cj0; j <= cj1; j++) {
        let a = -1;
        let b = -1;
        for (let i = ci0; i <= ci1; i++) {
          if (stamp[j * W + i] !== comp) continue;
          if (a < 0) a = i;
          b = i;
        }
        if (a < 0) continue;
        const left = walk(j * W + a, -1, a);
        const right = walk(j * W + b, 1, W - 1 - b);
        if (left?.len > 0 && right?.len > 0) cands.push({ axis: 'h', pos: j, len: left.len + right.len, from: [j * W + a, j * W + b], to: [left.end, right.end] });
      }
      if (!cands.length) continue;
      const min = Math.min(...cands.map((c) => c.len));
      const near = cands.filter((c) => c.len <= min + 2);
      const axis = near.filter((c) => c.axis === 'v').length >= near.filter((c) => c.axis === 'h').length ? 'v' : 'h';
      const list = near.filter((c) => c.axis === axis).sort((p, q) => p.pos - q.pos);
      const best = list[list.length >> 1];
      const pt = (k) => [cellX(k % W), cellY(Math.floor(k / W))];
      for (let s = 0; s < 2; s++) cuts.push({ id: `cut${n0 + cuts.length + 1}`, a: pt(best.from[s]), b: pt(best.to[s]), cut: true });
    }
  }
  return cuts;
}

/**
 * The outline of the union of some polygons (rooms + wall slabs of a level): rasterised at `res`, the outside flood
 * filled from the border, the boundary of the largest remaining part traced and simplified. Points [x, y] (or [x, z]).
 * The 3D view cuts the ground with it over a basement.
 */
export function footprint(polys, { res = 0.05 } = {}) {
  const pts = polys.flat();
  if (!pts.length) return [];
  const minX = Math.min(...pts.map((p) => p[0])) - 2 * res;
  const minY = Math.min(...pts.map((p) => p[1])) - 2 * res;
  const W = Math.ceil((Math.max(...pts.map((p) => p[0])) - minX) / res) + 3;
  const H = Math.ceil((Math.max(...pts.map((p) => p[1])) - minY) / res) + 3;
  const inside = new Uint8Array(W * H);
  for (const P of polys) {
    if (P.length < 3) continue;
    const ys = P.map((p) => p[1]);
    const j0 = Math.max(0, Math.floor((Math.min(...ys) - minY) / res));
    const j1 = Math.min(H - 1, Math.ceil((Math.max(...ys) - minY) / res));
    for (let j = j0; j <= j1; j++) {
      const y = minY + (j + 0.5) * res;
      const xs = [];
      for (let i = 0, k = P.length - 1; i < P.length; k = i++) {
        const a = P[i];
        const b = P[k];
        if (a[1] > y !== b[1] > y) xs.push(a[0] + ((y - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
      }
      xs.sort((p, q) => p - q);
      for (let m = 0; m + 1 < xs.length; m += 2) {
        const i0 = Math.max(0, Math.round((xs[m] - minX) / res));
        const i1 = Math.min(W - 1, Math.round((xs[m + 1] - minX) / res) - 1);
        for (let i = i0; i <= i1; i++) inside[j * W + i] = 1;
      }
    }
  }
  // close hairline gaps between neighbouring polygons (rounding): one dilation + erosion
  const grow = new Uint8Array(W * H);
  for (let j = 1; j < H - 1; j++) for (let i = 1; i < W - 1; i++) {
    const k = j * W + i;
    grow[k] = inside[k] || inside[k - 1] || inside[k + 1] || inside[k - W] || inside[k + W] ? 1 : 0;
  }
  const solid = new Uint8Array(W * H);
  for (let j = 1; j < H - 1; j++) for (let i = 1; i < W - 1; i++) {
    const k = j * W + i;
    solid[k] = grow[k] && grow[k - 1] && grow[k + 1] && grow[k - W] && grow[k + W] ? 1 : 0;
  }
  // the outside from the border; everything else is the house (inner courtyards would be filled – fine for a hole)
  const labels = new Int32Array(W * H).fill(1);
  const stack = [];
  const push = (k) => {
    if (labels[k] === 1 && !solid[k]) {
      labels[k] = 0;
      stack.push(k);
    }
  };
  for (let i = 0; i < W; i++) {
    push(i);
    push((H - 1) * W + i);
  }
  for (let j = 0; j < H; j++) {
    push(j * W);
    push(j * W + W - 1);
  }
  while (stack.length) {
    const k = stack.pop();
    const i = k % W;
    if (i > 0) push(k - 1);
    if (i < W - 1) push(k + 1);
    if (k >= W) push(k - W);
    if (k < W * (H - 1)) push(k + W);
  }
  const start = labels.indexOf(1);
  if (start < 0) return [];
  const ring = traceOuter(labels, W, H, 1, start);
  if (!ring) return [];
  return dropCollinear(simplifyRing(ring.map(([i, j]) => [minX + i * res, minY + j * res]), res * 1.1), res * 0.05);
}

/**
 * A traced ring (grid corners, the region on the right) with a vertex wherever the cell across its edge changes between
 * a wall and a separator (sepOnly), those vertices marked keep. → { pts, keep }
 */
function splitByOutside(ring, W, H, sepOnly) {
  const DX = [1, 0, -1, 0];
  const DY = [0, 1, 0, -1];
  const leftCell = (x, y, d) => [[x, y - 1], [x, y], [x - 1, y], [x - 1, y - 1]][d];
  const typeOf = (x, y, d) => {
    const [i, j] = leftCell(x, y, d);
    return i >= 0 && j >= 0 && i < W && j < H && sepOnly[j * W + i] ? 1 : 0;
  };
  const steps = [];
  for (let k = 0; k < ring.length; k++) {
    const [ax, ay] = ring[k];
    const [bx, by] = ring[(k + 1) % ring.length];
    const d = bx > ax ? 0 : by > ay ? 1 : bx < ax ? 2 : 3;
    const n = Math.abs(bx - ax) + Math.abs(by - ay);
    for (let s = 0; s < n; s++) steps.push({ x: ax + DX[d] * s, y: ay + DY[d] * s, t: typeOf(ax + DX[d] * s, ay + DY[d] * s, d), corner: s === 0 });
  }
  const pts = [];
  const keep = [];
  for (let k = 0; k < steps.length; k++) {
    const prev = steps[(k + steps.length - 1) % steps.length];
    const st = steps[k];
    const change = prev.t !== st.t;
    if (st.corner || change) {
      pts.push([st.x, st.y]);
      keep.push(change);
    }
  }
  return { pts, keep };
}

/**
 * simplifyRing for a ring with vertices that must stay (keep): Douglas–Peucker between them (tolerance 1.2 cells),
 * then the collinear and repeated points dropped – except the kept ones.
 */
function simplifyKept(pts, keep, res) {
  const tol = res * 1.2;
  const start = keep.indexOf(true);
  const n = pts.length;
  const order = [...Array(n).keys()].map((k) => (k + start) % n);
  const dp = (list) => {
    if (list.length <= 2) return list;
    const a = pts[list[0]];
    const b = pts[list[list.length - 1]];
    let idx = -1;
    let dmax = 0;
    for (let i = 1; i < list.length - 1; i++) {
      const d = projectToSegment(pts[list[i]], a, b).d;
      if (d > dmax) {
        dmax = d;
        idx = i;
      }
    }
    if (dmax <= tol) return [list[0], list[list.length - 1]];
    return [...dp(list.slice(0, idx + 1)).slice(0, -1), ...dp(list.slice(idx))];
  };
  const out = [];
  let chain = [order[0]];
  for (let k = 1; k <= n; k++) {
    const idx = order[k % n];
    chain.push(idx);
    if (keep[idx] || k === n) {
      out.push(...dp(chain).slice(0, -1));
      chain = [idx];
    }
  }
  // collinear / repeated points go, the kept stay
  let P = out.map((i) => ({ p: pts[i], keep: keep[i] }));
  let changed = true;
  while (changed && P.length > 3) {
    changed = false;
    for (let i = 0; i < P.length; i++) {
      const a = P[(i + P.length - 1) % P.length];
      const b = P[i];
      const c = P[(i + 1) % P.length];
      if (b.keep) continue;
      if (dist(a.p, b.p) < 1e-9 || (projectToSegment(b.p, a.p, c.p).d < res * 0.05 && dot(sub(b.p, a.p), sub(c.p, b.p)) > 0)) {
        P = P.filter((_, k) => k !== i);
        changed = true;
        break;
      }
    }
  }
  return P.map((x) => x.p);
}

/**
 * Outer boundary of a 4-connected region along the cell edges, with the region on the right (screen: clockwise,
 * positive shoelace in the y-down frame). Vertices are grid corners [i, j]. At a corner where the region only touches
 * itself diagonally the walk turns right (toward the region), so a pinch never joins two loops.
 */
function traceOuter(labels, W, H, id, start) {
  const inR = (i, j) => i >= 0 && j >= 0 && i < W && j < H && labels[j * W + i] === id;
  // the top-left cell of the region (the first in scan order) has its top edge on the outer boundary
  const si = start % W;
  const sj = (start - si) / W;
  // directions: 0 = +x, 1 = +y, 2 = −x, 3 = −y; walking along an edge with the region on the right
  const DX = [1, 0, -1, 0];
  const DY = [0, 1, 0, -1];
  // the cell on the right of the edge leaving vertex (x, y) in direction d, and the one on the left
  const rightCell = (x, y, d) => [[x, y], [x - 1, y], [x - 1, y - 1], [x, y - 1]][d];
  const leftCell = (x, y, d) => [[x, y - 1], [x, y], [x - 1, y], [x - 1, y - 1]][d];
  const isEdge = (x, y, d) => {
    const r = rightCell(x, y, d);
    const l = leftCell(x, y, d);
    return inR(r[0], r[1]) && !inR(l[0], l[1]);
  };
  let x = si;
  let y = sj;
  let d = 0;
  if (!isEdge(x, y, d)) return null;
  const ring = [[x, y]];
  const limit = 4 * W * H;
  for (let guard = 0; guard < limit; guard++) {
    x += DX[d];
    y += DY[d];
    if (x === si && y === sj) break;
    // try right turn, straight, left turn
    const order = [(d + 1) % 4, d, (d + 3) % 4];
    let nd = -1;
    for (const c of order) {
      if (isEdge(x, y, c)) {
        nd = c;
        break;
      }
    }
    if (nd < 0) return null;
    if (nd !== d) ring.push([x, y]);
    d = nd;
  }
  return ring;
}

/**
 * A slanted wall's face in a simplified ring: the raster staircase along it deviates a little more than the
 * simplification's 1.2 cells, so it stays a chain of short steps none of which runs along the face (hus6: 30 edges, 30
 * walls in the export, and the sliding door on it cut to 0,52 m of 4,42). A run of three or more consecutive vertices
 * within 1.6 cells of the face of a wall that is not axis-parallel, inside its length, becomes one edge (its first and
 * last vertex), which snapToFaces then lays on the face. Rings along axis-parallel walls only are not changed.
 */
function alongSlanted(ring, frames, res) {
  const slanted = frames.filter((f) => !f.sep && Math.abs(f.u[0]) > 0.052 && Math.abs(f.u[1]) > 0.052);
  if (!slanted.length || ring.length < 4) return ring;
  let pts = ring;
  for (const f of slanted) {
    for (const side of [1, -1]) {
      const base = add(f.w.a, mul(f.n, (side * f.w.t) / 2));
      const ext = f.w.t / 2 + res;
      const on = pts.map((p) => {
        const s = dot(sub(p, base), f.u);
        return Math.abs(dot(sub(p, base), f.n)) <= res * 1.6 && s >= -ext && s <= f.L + ext;
      });
      const n = pts.length;
      if (on.every(Boolean) || on.filter(Boolean).length < 3) continue;
      // the runs, starting after a vertex that is not on the face (the ring is closed)
      const start = on.indexOf(false);
      const drop = new Set();
      let run = [];
      for (let k = 1; k <= n; k++) {
        const i = (start + k) % n;
        if (on[i]) run.push(i);
        if (!on[i] || k === n) {
          if (run.length >= 3) for (const r of run.slice(1, -1)) drop.add(r);
          run = [];
        }
      }
      if (drop.size) pts = pts.filter((_, i) => !drop.has(i));
    }
  }
  return pts;
}

/**
 * Snaps the edges of a traced ring onto the wall faces they run along: per edge the nearest face (parallel within 3°,
 * within 1.6 raster cells, overlapping it) becomes the edge's line; the vertices are the intersections of consecutive
 * lines (a short jog where two consecutive lines are parallel but offset).
 */
function snapToFaces(ring, frames, res) {
  const n = ring.length;
  const lines = [];
  const sinTol = Math.sin((3 * Math.PI) / 180);
  for (let i = 0; i < n; i++) {
    const p = ring[i];
    const q = ring[(i + 1) % n];
    const d = unit(sub(q, p));
    const m = mul(add(p, q), 0.5);
    let best = null;
    let bestSep = null;
    const len = dist(p, q);
    for (const f of frames) {
      if (Math.abs(cross(d, f.u)) > sinTol) continue;
      for (const side of [1, -1]) {
        const base = add(f.w.a, mul(f.n, (side * f.w.t) / 2));
        const off = Math.abs(dot(sub(m, base), f.n));
        if (off > res * 1.6) continue;
        // overlap along the wall (with the end extensions)
        const sp = dot(sub(p, base), f.u);
        const sq = dot(sub(q, base), f.u);
        const ext = f.w.t / 2 + res;
        if (Math.max(sp, sq) < -ext || Math.min(sp, sq) > f.L + ext) continue;
        const cover = len > 0 ? (Math.min(Math.max(sp, sq), f.L + ext) - Math.max(Math.min(sp, sq), -ext)) / len : 1;
        const c = f.sep ? { off, base, dir: f.u, wall: null, side: 0, separator: f.w.id, cover } : { off, base, dir: f.u, wall: f.w.id ?? null, side, cover };
        if (f.sep) {
          if (!bestSep || off < bestSep.off) bestSep = c;
        } else if (!best || off < best.off) best = c;
      }
    }
    // a separator that continues a wall line (a dash-dot line from a wall's end, hus4): the edge along it lies nearer the
    // wall's face than the line, but runs along the separator – the one that covers more of the edge wins
    if (bestSep && (!best || bestSep.cover > best.cover + 0.05 || (best.cover <= bestSep.cover + 0.05 && bestSep.off < best.off))) best = bestSep;
    if (best) lines.push({ p: best.base, d: dot(best.dir, d) >= 0 ? best.dir : mul(best.dir, -1), wall: best.wall, side: best.side, separator: best.separator, raw: [p, q] });
    else lines.push({ p, d, wall: null, side: 0, raw: [p, q] });
  }
  // two consecutive faces that run the same way less than MIN_JOG apart (collinear walls whose thickness differs by a
  // few mm, a photo's wobble) would leave a jog the house format cannot hold – a wall under 1 cm (hus3-foto: 9 mm): the
  // shorter edge goes onto the longer one's line
  const MIN_JOG = 0.012;
  for (let i = 0; i < n; i++) {
    const A = lines[(i + n - 1) % n];
    const B = lines[i];
    if (Math.abs(cross(A.d, B.d)) > 1e-3 || dot(A.d, B.d) <= 0) continue;
    const off = Math.abs(cross(sub(B.p, A.p), A.d));
    if (off < 1e-6 || off >= MIN_JOG) continue;
    if (dist(...A.raw) >= dist(...B.raw)) B.p = A.p;
    else A.p = B.p;
  }
  const pts = [];
  const edges = [];
  for (let i = 0; i < n; i++) {
    const A = lines[(i + n - 1) % n];
    const B = lines[i];
    const X = lineIntersection(A.p, A.d, B.p, B.d);
    const edgeOf = (E) => (E.separator != null ? { wall: null, side: 0, separator: E.separator } : { wall: E.wall, side: E.side });
    if (X && dist(X, ring[i]) < res * 6) {
      pts.push(X);
      edges.push(edgeOf(B));
    } else {
      // parallel (or nearly): a jog – the raster vertex projected onto both lines
      let pa = add(A.p, mul(A.d, dot(sub(ring[i], A.p), A.d)));
      let pb = add(B.p, mul(B.d, dot(sub(ring[i], B.p), B.d)));
      let jog = { wall: null, side: 0 };
      // a jog between a wall face and a separator (the separator continues a wall that ends at another one's side, hus4):
      // it runs along that other wall's face – onto it, with its wall
      if ((A.separator != null) !== (B.separator != null) && dist(pa, pb) > 1e-6) {
        const v = unit(sub(pb, pa));
        for (const f of frames) {
          if (f.sep || Math.abs(cross(v, f.u)) > sinTol) continue;
          for (const side of [1, -1]) {
            const base = add(f.w.a, mul(f.n, (side * f.w.t) / 2));
            if (Math.abs(dot(sub(ring[i], base), f.n)) > res * 0.6) continue;
            const ext = f.w.t / 2 + res;
            const sa = dot(sub(pa, base), f.u);
            const sb = dot(sub(pb, base), f.u);
            if (Math.min(sa, sb) < -ext || Math.max(sa, sb) > f.L + ext) continue;
            const qa = lineIntersection(A.p, A.d, base, f.u);
            const qb = lineIntersection(B.p, B.d, base, f.u);
            if (!qa || !qb) continue;
            pa = qa;
            pb = qb;
            jog = { wall: f.w.id ?? null, side };
            break;
          }
          if (jog.wall) break;
        }
      }
      if (dist(pa, pb) > 1e-6) {
        pts.push(pa);
        edges.push(jog);
      }
      pts.push(pb);
      edges.push(edgeOf(B));
    }
  }
  // drop zero-length edges and collinear vertices (keeping the edge wall references)
  let P = pts.map((p, i) => ({ p, e: edges[i] }));
  let changed = true;
  while (changed && P.length > 3) {
    changed = false;
    for (let i = 0; i < P.length; i++) {
      const a = P[(i + P.length - 1) % P.length];
      const b = P[i];
      const c = P[(i + 1) % P.length];
      if (dist(a.p, b.p) < 1e-4) {
        P = P.filter((_, k) => k !== i);
        changed = true;
        break;
      }
      // b on the line a–c and the two edges on the same wall face (or both free): b goes
      if (projectToSegment(b.p, a.p, c.p).d < 1e-4 && dot(sub(b.p, a.p), sub(c.p, b.p)) > 0 && a.e.wall === b.e.wall && a.e.side === b.e.side && a.e.separator === b.e.separator) {
        P = P.filter((_, k) => k !== i);
        changed = true;
        break;
      }
    }
  }
  return { polygon: P.map((x) => x.p), edges: P.map((x) => x.e) };
}
