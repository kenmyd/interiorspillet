/**
 * Planbygger: rooms as the closed regions between the walls of a level (the editor's wall model, not the image).
 *
 *   findRooms(walls, { res = 0.02 }) → {
 *     rooms: [{ index, polygon: [[x, y], …], edges: [{ wall: wallId|null, side: 1|-1|0 }], area, inside: [x, y] }],
 *     at(x, y) → room index | -1 (outside) | -2 (in a wall),
 *     raster: { w, h, x0, y0, res, labels }
 *   }
 *
 * The walls are drawn into a raster (res metres per cell, the band of each wall extended by half its thickness at both
 * ends so corners close), the free cells are flood filled, the region touching the border is outside. Each room's outer
 * boundary is traced along the cell edges, simplified (Douglas–Peucker, so the staircase of a diagonal wall becomes
 * one edge) and every edge is snapped onto the face of the wall it runs along: the polygon is exact to the wall faces,
 * not to the raster. polygon is oriented with positive shoelace area in the plan frame (x right, y down): the room
 * lies to the right of each edge and the inward normal is perp(d) = (−d.y, d.x) – the room-spec convention.
 *
 * Openings do not matter here: a door is a hole in a wall, the wall still closes the room.
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

export function findRooms(walls, { res = 0.02, margin = 0.6 } = {}) {
  const good = walls.filter((w) => w && w.t > 0 && dist(w.a, w.b) > 1e-3);
  if (!good.length) return { rooms: [], at: () => -1, raster: null };
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

  // ---- walls into the raster
  const wallMask = new Uint8Array(W * H);
  const frames = good.map((w) => ({ w, ...wallFrame(w), ext: endExtensions(w, good) }));
  for (const { w, u, n, L, ext: E } of frames) {
    const corners = [
      add(add(w.a, mul(u, -E.a)), mul(n, w.t / 2)),
      add(add(w.a, mul(u, -E.a)), mul(n, -w.t / 2)),
      add(add(w.b, mul(u, E.b)), mul(n, w.t / 2)),
      add(add(w.b, mul(u, E.b)), mul(n, -w.t / 2)),
    ];
    const i0 = Math.max(0, Math.floor((Math.min(...corners.map((c) => c[0])) - x0) / res) - 1);
    const i1 = Math.min(W - 1, Math.ceil((Math.max(...corners.map((c) => c[0])) - x0) / res) + 1);
    const j0 = Math.max(0, Math.floor((Math.min(...corners.map((c) => c[1])) - y0) / res) - 1);
    const j1 = Math.min(H - 1, Math.ceil((Math.max(...corners.map((c) => c[1])) - y0) / res) + 1);
    const half = w.t / 2;
    for (let j = j0; j <= j1; j++) {
      const py = cellY(j);
      for (let i = i0; i <= i1; i++) {
        const q = [cellX(i) - w.a[0], py - w.a[1]];
        const s = dot(q, u);
        const o = dot(q, n);
        if (s >= -E.a && s <= L + E.b && o >= -half && o <= half) wallMask[j * W + i] = 1;
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
  const regionToRoom = new Map();
  for (const rg of regions) {
    if (rg.border) continue;
    const a = rg.count * res * res;
    if (a < MIN_ROOM_AREA) continue;
    const ring = traceOuter(labels, W, H, rg.id, rg.start);
    if (!ring || ring.length < 4) continue;
    const metres = ring.map(([i, j]) => [x0 + i * res, y0 + j * res]);
    const simple = dropCollinear(simplifyRing(dropCollinear(metres, 1e-9), res * 1.2), res * 0.05);
    const snapped = snapToFaces(simple, frames, res);
    if (!snapped || snapped.polygon.length < 3 || signedArea(snapped.polygon) <= 0) continue;
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
  return { rooms, at, raster: { w: W, h: H, x0, y0, res, labels, wallMask } };
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
        if (!best || off < best.off) best = { off, base, dir: f.u, wall: f.w.id ?? null, side };
      }
    }
    if (best) lines.push({ p: best.base, d: dot(best.dir, d) >= 0 ? best.dir : mul(best.dir, -1), wall: best.wall, side: best.side, raw: [p, q] });
    else lines.push({ p, d, wall: null, side: 0, raw: [p, q] });
  }
  const pts = [];
  const edges = [];
  for (let i = 0; i < n; i++) {
    const A = lines[(i + n - 1) % n];
    const B = lines[i];
    const X = lineIntersection(A.p, A.d, B.p, B.d);
    if (X && dist(X, ring[i]) < res * 6) {
      pts.push(X);
      edges.push({ wall: B.wall, side: B.side });
    } else {
      // parallel (or nearly): a jog – the raster vertex projected onto both lines
      const pa = add(A.p, mul(A.d, dot(sub(ring[i], A.p), A.d)));
      const pb = add(B.p, mul(B.d, dot(sub(ring[i], B.p), B.d)));
      if (dist(pa, pb) > 1e-6) {
        pts.push(pa);
        edges.push({ wall: null, side: 0 });
      }
      pts.push(pb);
      edges.push({ wall: B.wall, side: B.side });
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
      if (projectToSegment(b.p, a.p, c.p).d < 1e-4 && dot(sub(b.p, a.p), sub(c.p, b.p)) > 0 && a.e.wall === b.e.wall && a.e.side === b.e.side) {
        P = P.filter((_, k) => k !== i);
        changed = true;
        break;
      }
    }
  }
  return { polygon: P.map((x) => x.p), edges: P.map((x) => x.e) };
}
