// Wall tiles of a room (notes/kjokken-bad-genererte-hus.md): the zones of builtinplan.js (rooms[].wallTiles, a
// bench's backsplash, the walls of a shower) as a tiled skin TILE_T in front of the wall face – from `from` up to
// `top` (a height over the floor, or 'ceiling': the wall's top edge, so the tiles follow a sloping ceiling and never
// poke through it), cut round every hole in the face (doors, windows, the openings of the room behind), with the edge
// faces where the tiles stop (their top, round a hole, at the end of a zone inside the wall). The joints are centred
// on the wall and the rows start at the floor. One geometry per wall in the room's built-in batch; the tiles never
// collide (the wall does).
import * as THREE from 'three';
import { wallMatrix, profileAt } from './wallkit.js';
import { TILE_T } from './builtinplan.js';

const UNDER_CEILING = 0.002; // the tiles stop this far under the wall's top edge (the ceiling's face)

/**
 * The tile geometry of one wall face (wall-local: x = u along the face from its start, y up from its floor, z out of
 * the face), or null when nothing is left. Quads are split at the zone's ends, the holes' sides and the top
 * profile's corners (and where a level top crosses it), so each piece has a straight bottom and top.
 * @param {object} wall   a layout.house wall (length, topProfile, holes)
 * @param {object} zone   { u0, u1, from, top: number|'ceiling' }
 * @param {{ size?: number[] }} [o]  tile size (the joints' centring)
 * @returns {THREE.BufferGeometry|null}
 */
export function wallTileGeometry(wall, zone, { size = [0.3, 0.6] } = {}) {
  const L = wall.length;
  const prof = wall.topProfile?.length ? wall.topProfile : [[0, wall.height ?? 2.4], [L, wall.height ?? 2.4]];
  const ceil = (u) => profileAt(prof, u) - UNDER_CEILING;
  const level = zone.top === 'ceiling' ? Infinity : zone.top;
  const topAt = (u) => Math.min(level, ceil(u));
  const from = zone.from ?? 0;
  const u0 = zone.u0, u1 = zone.u1;
  const holes = (wall.holes || []).filter((h) => h.u1 > u0 + 1e-4 && h.u0 < u1 - 1e-4);
  // cuts: zone ends, hole sides, profile corners, where the level top meets the ceiling
  const cuts = new Set([u0, u1]);
  for (const h of holes) for (const u of [h.u0, h.u1]) if (u > u0 && u < u1) cuts.add(u);
  for (let i = 0; i < prof.length; i++) {
    const [u] = prof[i];
    if (u > u0 && u < u1) cuts.add(u);
    if (Number.isFinite(level) && i < prof.length - 1) {
      const [ua, ha] = prof[i], [ub, hb] = prof[i + 1];
      const a = ha - UNDER_CEILING - level, b = hb - UNDER_CEILING - level;
      if (a * b < 0) {
        const u = ua + ((ub - ua) * a) / (a - b);
        if (u > u0 && u < u1) cuts.add(u);
      }
    }
  }
  const us = [...cuts].sort((a, b) => a - b);
  const pos = [], nrm = [], uv = [];
  const uOff = centreOffset(L, size[0]);
  const quad = (p, n) => {
    // p: four [x, y, z] corners counter-clockwise seen from the side n points to
    for (const i of [0, 1, 2, 0, 2, 3]) {
      pos.push(...p[i]);
      nrm.push(...n);
      // UVs in metres: the face (u, y); an edge (its length, its depth)
      if (n[2] > 0.5) uv.push(p[i][0] + uOff, p[i][1]);
      else if (Math.abs(n[1]) > 0.5) uv.push(p[i][0] + uOff, p[i][2]);
      else uv.push(p[i][2], p[i][1]);
    }
  };
  const T = TILE_T;
  for (let i = 0; i < us.length - 1; i++) {
    const a = us[i], b = us[i + 1];
    if (b - a < 1e-4) continue;
    const mid = (a + b) / 2;
    const ta = topAt(a), tb = topAt(b);
    // the vertical pieces: from → top minus the holes over this interval (holes are rectangles)
    const cut = holes.filter((h) => h.u0 <= mid && h.u1 >= mid).map((h) => [Math.max(from, h.door ? 0 : h.sill ?? 0), h.top]).sort((p, q) => p[0] - q[0]);
    let y0 = from;
    const pieces = [];
    for (const [s, t] of cut) {
      if (s > y0 + 1e-4) pieces.push([y0, s, false]);
      y0 = Math.max(y0, t);
    }
    pieces.push([y0, null, true]); // up to the top
    for (const [ya, yb0, toTop] of pieces) {
      const ya0 = ya, yb = ya;
      const za = toTop ? ta : Math.min(yb0, ta), zb = toTop ? tb : Math.min(yb0, tb);
      if (za - ya0 < 1e-4 && zb - yb < 1e-4) continue;
      const top0 = Math.max(ya0, za), top1 = Math.max(yb, zb);
      quad([[a, ya0, T], [b, yb, T], [b, top1, T], [a, top0, T]], [0, 0, 1]);
      // the top edge where the tiles stop under the ceiling / at a level top / under a window
      const atCeiling = toTop && Math.abs(ta - ceil(a)) < 1e-4 && Math.abs(tb - ceil(b)) < 1e-4;
      if (!atCeiling) {
        const d = new THREE.Vector2(b - a, top1 - top0).normalize();
        quad([[a, top0, T], [b, top1, T], [b, top1, 0], [a, top0, 0]], [-d.y, d.x, 0]);
      }
      // the bottom edge over a hole (the lintel side) or at a zone that starts above the floor
      if (ya0 > 0.005) quad([[a, ya0, 0], [b, yb, 0], [b, yb, T], [a, ya0, T]], [0, -1, 0]);
    }
  }
  // the side edges: at the zone's ends inside the wall and at the holes' sides
  const sideEdge = (u, facing) => {
    const t = topAt(u);
    const ranges = [];
    let y0 = from;
    const cut = holes.filter((h) => h.u0 < u - 1e-4 && h.u1 > u + 1e-4).map((h) => [Math.max(from, h.door ? 0 : h.sill ?? 0), h.top]).sort((p, q) => p[0] - q[0]);
    for (const [s, e] of cut) {
      if (s > y0) ranges.push([y0, Math.min(s, t)]);
      y0 = Math.max(y0, e);
    }
    if (t > y0) ranges.push([y0, t]);
    for (const [a, b] of ranges) {
      if (b - a < 1e-4) continue;
      if (facing > 0) quad([[u, a, T], [u, a, 0], [u, b, 0], [u, b, T]], [1, 0, 0]);
      else quad([[u, a, 0], [u, a, T], [u, b, T], [u, b, 0]], [-1, 0, 0]);
    }
  };
  if (u0 > 0.001) sideEdge(u0, -1);
  if (u1 < L - 0.001) sideEdge(u1, 1);
  for (const h of holes) {
    // a hole's side: the tiles beside it end there, facing into the hole
    const lo = Math.max(from, h.door ? 0 : h.sill ?? 0), hi = h.top;
    for (const [u, facing] of [[h.u0, 1], [h.u1, -1]]) {
      if (u <= u0 + 1e-4 || u >= u1 - 1e-4) continue;
      const a = lo, b = Math.min(hi, topAt(u));
      if (b - a < 1e-4) continue;
      if (facing > 0) quad([[u, a, T], [u, a, 0], [u, b, 0], [u, b, T]], [1, 0, 0]);
      else quad([[u, a, 0], [u, a, T], [u, b, T], [u, b, 0]], [-1, 0, 0]);
    }
  }
  if (!pos.length) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return g;
}

/** u shift that centres the vertical joints on a wall of length L. */
function centreOffset(L, w) {
  const rest = ((L % w) + w) % w;
  return rest < 1e-6 ? 0 : (w - rest) / 2;
}

/**
 * Adds the tiles of one wall's zones to a MeshBatcher (world space via the wall's frame).
 * @param {object} batch     MeshBatcher of the room
 * @param {object} wall      layout.house wall
 * @param {object[]} zones   builtinplan.js zones of this wall ({ u0, u1, from, top, finish })
 * @param {(finish: object) => THREE.Material} materialOf
 * @returns {number} triangles added
 */
export function addWallTiles(batch, wall, zones, materialOf) {
  const m = wallMatrix(wall, wall.floorY ?? 0);
  let tris = 0;
  for (const z of mergeZones(zones)) {
    const g = wallTileGeometry(wall, z, { size: z.finish?.size });
    if (!g) continue;
    tris += g.attributes.position.count / 3;
    batch.add(g, materialOf(z.finish), { matrix: m, collide: false, castShadow: false, receiveShadow: true });
    g.dispose();
  }
  return tris;
}

/**
 * Zones of one wall without overlaps (two zones on the same wall would put two tile faces in one plane): a higher
 * zone (the shower's to the ceiling) wins over a lower one where they overlap; the lower keeps the rest of its width.
 * Zones with different finishes stay apart.
 */
export function mergeZones(zones) {
  const rank = (z) => (z.top === 'ceiling' ? Infinity : z.top);
  const sorted = [...zones].sort((a, b) => rank(b) - rank(a) || a.from - b.from);
  const out = [];
  for (const z of sorted) {
    // the parts of z's width not already covered by a zone that covers its height
    let parts = [[z.u0, z.u1]];
    for (const o of out) {
      if (!(rank(o) >= rank(z) && o.from <= z.from + 1e-4)) continue;
      parts = parts.flatMap(([a, b]) => {
        if (o.u1 <= a || o.u0 >= b) return [[a, b]];
        const r = [];
        if (o.u0 > a) r.push([a, o.u0]);
        if (o.u1 < b) r.push([o.u1, b]);
        return r;
      });
    }
    for (const [a, b] of parts) if (b - a > 0.01) out.push({ ...z, u0: a, u1: b });
  }
  return out.sort((a, b) => a.u0 - b.u0);
}
