import * as THREE from 'three';
import { rectilinearBoxes } from '../world/lightmask.js';
import { exteriorPlan } from './exterior.js';

/**
 * VISIBILITY – hides what the camera cannot see (notes/hele-huset-design.md §4.12–4.13, steg 29 Y1).
 *
 * The frustum does not stop at a floor or a wall, and three sorts opaque objects by material before depth
 * (WebGLRenderLists.js), so every hidden pixel of the basement, the bedroom behind a closed door or the garden behind
 * the hall's walls gets the whole shader. This module culls by PORTALS instead, from the camera's room:
 *
 *   • the graph   cells = the rooms of layout.house (physical) + OUTSIDE ('ute'); portals = every door and opening
 *                 (the opening's hole box through the wall), every window (always open – glass, frosted included), the
 *                 glazed terrace door, and the stairwell (the floor opening, gang ↔ kjeller-gang, a box through the
 *                 slab). A door is open as soon as its leaf moves (Door.t > 0 or isOpen).
 *   • the walk    from the camera's cell(s), depth-first through the OPEN portals: each portal's box is projected to a
 *                 screen rectangle and cut with the rectangle it is seen through (conservative: a box that straddles
 *                 the camera plane counts as the whole screen); a cell reached with a non-empty rectangle is seen.
 *                 Every portal also cuts the world: what lies behind it is only what is beyond its near face (an
 *                 axis-aligned half space), so a box (a room seen from outside, the next portal) is clipped to that
 *                 region before it is projected.
 *                 A portal is only passed from the side the camera is on (a straight ray crosses its plane once).
 *   • outside     reached through a window or an outer door, OUTSIDE shows the exterior (terrain, terrace, backdrops)
 *                 and the FACADE of every room whose geometry box (clipped as above) falls in the rectangle – the
 *                 outer walls of both levels belong to their rooms' surfaces; going on through that room's windows
 *                 shows its contents.
 *   • occluders   the floor of the upper level (its rooms' plans grown by an outer wall, minus the stairwell) joined
 *                 with the terrace deck (exteriorPlan): an eye above it never sees a box wholly under it – the box's
 *                 corners projected from the eye onto the deck plane must lie under the cover. So the living room's
 *                 windows do not show the entrance and the store room under the terrace.
 *   • what hides  per room: `roots.rooms[id].contents` (lamps, built-ins, decor) when the room is not seen;
 *                 `roots.rooms[id].surfaces` (walls, floor, ceilings, doors) when the room is not seen, its facade is
 *                 not seen and no seen room DEPENDS on it – a room depends on the rooms that own a slab one of its
 *                 faces is the back of (backOf, D13) and the rooms that own a door / opening of it (the leaf, the
 *                 karm and the reveal live with the owner wall) – and its neighbours on the level (plans within a
 *                 thick wall: cracks in corners, the gap under a shut door). A room of the camera's level whose
 *                 surfaces are shown ONLY as such a dependency keeps just the meshes within TRIM of the seen rooms'
 *                 plans that need it (their boundary, and THROUGH_DOOR into each of their doors); on the other level
 *                 (seen down / up the stairwell) the cracks between the basement walls and the slab show a
 *                 neighbour's far walls, so there the dependency is shown whole
 *                 – the others are hidden per mesh with the camera layer (mesh.layers bit 0), not .visible, because the
 *                 editor's overview cut toggles .visible of the same meshes; door roots are never trimmed (&vistrim=0
 *                 turns the trimming off). The living room: roots.shell is its surfaces,
 *                 roots.kitchen, the wall design (roots.wall) and its furniture are its contents. The stair (hud room
 *                 `trapp`) follows the hall and the basement hall it joins. A level whose rooms are all hidden is
 *                 hidden as a whole (roots.levels[id].visible), the exterior when OUTSIDE is not reached, a window's
 *                 shading anchor with its room's surfaces, a piece of furniture with the room(s) its bounding box lies
 *                 in (none: always shown).
 *   • overview    orbit, plan, photo and every camera that is not the player's (Game renders editor.activeCamera):
 *                 nothing is hidden (the editor cuts walls and ceilings and looks into every room). setOverview(true)
 *                 does the same on request. A render of the scene with any other camera than the one the visibility
 *                 was computed for (a wall thumbnail, …) gets everything back for that render (scene.onBeforeRender /
 *                 onAfterRender).
 *   • shadows     the shadow maps render with everything visible (renderer.shadowMap.render is wrapped: what this
 *                 module hid is shown for the shadow pass and hidden again), so a shadow never depends on where the
 *                 camera is – the upper floor still shades the basement windows, a hidden room still casts its
 *                 shadow – and a change of visibility needs no new shadow map (no sun pass while walking, §4.13; the
 *                 plan's requestShadowUpdate per change is not needed).
 *   • start       only after the first render of the full scene (Game._precompile + the first frame: renderer.compile
 *                 skips invisible objects, and a program compiled mid-game costs seconds on ANGLE). Every program and
 *                 buffer exists by then; showing a hidden object again is free.
 *   • where       the game (state.player given) is culled; dev/sandbox.js (no player) only with ?vis=1. ?vis=0 turns
 *                 it off in the game (comparisons: tools/perf.mjs).
 *
 *   createVisibility(home, layout) → vis = {
 *     enabled            true when the module culls (false without house data / with ?vis=0 / the sandbox)
 *     update(dt, state)  every frame from home.update (after the doors and the design, before the lights);
 *                        state = { camera, playerPosition, player, … } (Game.js; the sandbox: { camera })
 *     setOverview(on)    the editor's overview / plan: show everything (true) until called with false
 *     setEnabled(on)     turn the culling on / off at run time (off: everything shown)
 *     refresh()          recompute on the next update (a portal or the scene changed)
 *     levelVisible(id), contentsVisible(roomId), surfacesVisible(roomId)
 *     stats              { active, cells, seen, surfaces, outside, hidden, items, trimmed, visits, changes, updates,
 *                          ms }
 *     graph              visibilityGraph(layout, …) (cells, portals, deps)
 *     dispose()          shows everything again and removes the hooks
 *   }
 *
 * Pure (Node-testable): visibilityGraph(layout, { boxes }), cellsAt(graph, layout, eye), traverse(graph, camera,
 * { eye, starts, isOpen }), OUTSIDE.
 */

export const OUTSIDE = 'ute';
/** Screen rectangles are in NDC: [x0, y0, x1, y1]. */
const FULL = Object.freeze([-1, -1, 1, 1]);
/** NDC margin around every projected portal (anti-aliasing, a cracked door's edge). */
const MARGIN = 0.02;
/** How many portals deep the walk goes (a window seen through a door seen through a door …). */
const MAX_DEPTH = 7;
/** Safety net: a walk longer than this shows everything. */
const MAX_VISITS = 3000;
/** A camera this close to a portal box (doorway, reveal, the slab of the stairwell) is in both of its cells. */
const IN_PORTAL = 0.15;
/** Without a room under the eye (inside a wall's thickness): rooms of the level whose plan is this close. */
const NEAR_ROOM = 0.45;
/** Plan bounds of a room → its box when the scene gives none: walls (0.30 outer) and slabs around it. */
const ROOM_PAD = 0.4;
/** A dependency-only room keeps the meshes within this of a seen room's plan (its faces, karms, the slab between). */
const TRIM = 0.06;
/** Rooms whose plans are this close are neighbours (the thickest wall is 0.30). */
const NEIGHBOUR = 0.35;
/** A seen room's trim region reaches this far through each of its doors (the gap under a shut leaf, the threshold). */
const THROUGH_DOOR = 0.6;
const EPS = 1e-4;

const INF = Object.freeze({ min: [-Infinity, -Infinity, -Infinity], max: [Infinity, Infinity, Infinity] });

/** {min:[3], max:[3]} from a THREE.Box3. */
const boxOf = (b) => ({ min: [b.min.x, b.min.y, b.min.z], max: [b.max.x, b.max.y, b.max.z] });
/** Intersection of two {min,max} boxes (null when empty). */
function clipBox(a, b) {
  const min = [Math.max(a.min[0], b.min[0]), Math.max(a.min[1], b.min[1]), Math.max(a.min[2], b.min[2])];
  const max = [Math.min(a.max[0], b.max[0]), Math.min(a.max[1], b.max[1]), Math.min(a.max[2], b.max[2])];
  if (min[0] > max[0] + EPS || min[1] > max[1] + EPS || min[2] > max[2] + EPS) return null;
  return { min, max };
}
/** Do two {min,max} boxes overlap (no allocation)? */
const touches = (a, b) =>
  a.min[0] <= b.max[0] + EPS && b.min[0] <= a.max[0] + EPS && a.min[1] <= b.max[1] + EPS && b.min[1] <= a.max[1] + EPS && a.min[2] <= b.max[2] + EPS && b.min[2] <= a.max[2] + EPS;
function unionBox(a, b) {
  if (!a) return b;
  if (!b) return a;
  return {
    min: [Math.min(a.min[0], b.min[0]), Math.min(a.min[1], b.min[1]), Math.min(a.min[2], b.min[2])],
    max: [Math.max(a.max[0], b.max[0]), Math.max(a.max[1], b.max[1]), Math.max(a.max[2], b.max[2])],
  };
}
const inBox = (b, p, pad = 0) =>
  p.x >= b.min[0] - pad && p.x <= b.max[0] + pad && p.y >= b.min[1] - pad && p.y <= b.max[1] + pad && p.z >= b.min[2] - pad && p.z <= b.max[2] + pad;
const rectAnd = (a, b) => {
  const r = [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.min(a[2], b[2]), Math.min(a[3], b[3])];
  return r[0] < r[2] && r[1] < r[3] ? r : null;
};

/** Point in polygon ([{x, y}] plan points, y = z). */
function inPoly(x, z, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if (a.y > z !== b.y > z && x < ((b.x - a.x) * (z - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
/** Distance from a plan point to a polygon's outline (0 inside). */
function distPoly(x, z, poly) {
  if (inPoly(x, z, poly)) return 0;
  let best = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[j], b = poly[i];
    const dx = b.x - a.x, dz = b.y - a.y;
    const L = dx * dx + dz * dz;
    const t = L > 0 ? Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.y) * dz) / L)) : 0;
    best = Math.min(best, Math.hypot(x - (a.x + t * dx), z - (a.y + t * dz)));
  }
  return best;
}

/**
 * The portal graph of the house. Pure.
 * @param {object} layout  home/layout.js
 * @param {{ boxes?: Object<string, THREE.Box3|{min:number[],max:number[]}> }} [o]  world boxes of each room's geometry
 *        (the scene's; merged with the plan's own box)
 * @returns {null | { rooms: object[], ids: Set<string>, portals: object[], byCell: Map<string, object[]>,
 *   deps: Map<string, Set<string>>, hudLinks: Map<string, string[]>, boxes: Map<string, {min,max}> }}
 */
export function visibilityGraph(layout, { boxes = null } = {}) {
  const h = layout?.house;
  const all = (h?.rooms || []).filter((r) => r.polygon?.length >= 3);
  const rooms = all.filter((r) => !r.hud);
  if (!rooms.length) return null;
  const ids = new Set(rooms.map((r) => r.id));
  const portals = [];
  const cellOf = (id) => (ids.has(id) ? id : OUTSIDE);

  for (const o of h.openings || []) {
    const hole = o.hole;
    if (!hole || hole.isEmpty?.()) continue;
    const conn = [...new Set((o.connects || []).filter(Boolean).map(cellOf))];
    if (conn.length === 1) conn.push(OUTSIDE); // a window / the terrace door of one room: outside on the other side
    if (conn.length !== 2) continue;
    const box = boxOf(hole);
    const sx = box.max[0] - box.min[0], sz = box.max[2] - box.min[2];
    const glass = o.type === 'window' || !!o.door?.glazed;
    portals.push({
      id: o.id, kind: o.type === 'window' ? 'window' : o.door ? (glass ? 'glass' : 'door') : 'opening',
      a: conn[0], b: conn[1], box, axis: sx <= sz ? 0 : 2, owner: cellOf(o.roomId),
    });
  }
  for (const fo of h.floorOpenings || []) {
    const st = (h.stairs || []).find((s) => s.id === fo.stairId || s.openingId === fo.id);
    const lv = h.levelsById?.[fo.levelId] ?? (h.levels || []).find((l) => l.id === fo.levelId);
    const below = st ? rooms.find((r) => st.roomIds?.includes(r.id) && r.levelId !== fo.levelId) : null;
    if (!below || !lv || !ids.has(fo.roomId)) continue;
    const y1 = lv.floorY, y0 = lv.floorY - (lv.slabThickness ?? 0.3);
    rectilinearBoxes(fo.polygon).forEach((b, i) => {
      portals.push({ id: `${fo.id}:${i}`, kind: 'hole', a: fo.roomId, b: below.id, box: { min: [b.minX, y0, b.minZ], max: [b.maxX, y1, b.maxZ] }, axis: 1, owner: null });
    });
  }
  // which side of each portal a cell lies on, along the portal's thin axis (−1 / +1; 0 unknown): a ray from the camera
  // crosses a portal's plane once, so a portal is passed only from the side the camera is on (traverse)
  const byId = new Map(rooms.map((r) => [r.id, r]));
  for (const p of portals) {
    const k = p.axis;
    const c = [(p.box.min[0] + p.box.max[0]) / 2, (p.box.min[1] + p.box.max[1]) / 2, (p.box.min[2] + p.box.max[2]) / 2];
    const reach = (p.box.max[k] - p.box.min[k]) / 2 + 0.12;
    const sideOf = (id) => {
      if (id === OUTSIDE) return 0;
      const r = byId.get(id);
      if (k === 1) return r.floorY > c[1] ? 1 : -1;
      const q = (d) => (k === 0 ? inPoly(c[0] + d, c[2], r.polygon) : inPoly(c[0], c[2] + d, r.polygon));
      const up = q(reach), down = q(-reach);
      return up && !down ? 1 : down && !up ? -1 : 0;
    };
    let sa = sideOf(p.a), sb = sideOf(p.b);
    if (p.a === OUTSIDE) sa = -sb;
    if (p.b === OUTSIDE) sb = -sa;
    if (sa && sa === sb) sa = sb = 0;
    p.side = { [p.a]: sa, [p.b]: sb };
  }
  const byCell = new Map([[OUTSIDE, []], ...rooms.map((r) => [r.id, []])]);
  for (const p of portals) {
    byCell.get(p.a)?.push(p);
    byCell.get(p.b)?.push(p);
  }

  // a seen room needs the rooms that own its boundary: the slabs its backOf faces are the back of, its doors' owners
  const deps = new Map(rooms.map((r) => [r.id, new Set()]));
  const dep = (a, b) => {
    if (a !== b && ids.has(a) && ids.has(b)) deps.get(a).add(b);
  };
  for (const w of h.walls || []) for (const id of w.backOf || []) dep(w.roomId, h.wallsById?.[id]?.roomId);
  for (const p of portals) {
    if (!p.owner || p.owner === OUTSIDE) continue;
    dep(p.a, p.owner);
    dep(p.b, p.owner);
  }
  // … and its neighbours on the level (plans within a thick wall): a crack in a corner, the gap under a shut door and
  // a reveal show a little of the room next door (trimmed to the seen room's boundary, see createVisibility)
  const near = (a, b) => a.some((x) => b.some((y) => x.minX < y.maxX + NEIGHBOUR && x.maxX > y.minX - NEIGHBOUR && x.minZ < y.maxZ + NEIGHBOUR && x.maxZ > y.minZ - NEIGHBOUR));
  const planBoxes = new Map(rooms.map((r) => [r.id, rectilinearBoxes(r.polygon)]));
  for (const a of rooms) for (const b of rooms) if (a !== b && a.levelId === b.levelId && near(planBoxes.get(a.id), planBoxes.get(b.id))) dep(a.id, b.id);

  // hud rooms (the stair) follow the physical rooms their plan overlaps (the hall above, the basement hall below)
  const hudLinks = new Map();
  const overlaps = (a, b) => a.some((x) => b.some((y) => x.minX < y.maxX - 0.01 && x.maxX > y.minX + 0.01 && x.minZ < y.maxZ - 0.01 && x.maxZ > y.minZ + 0.01));
  for (const r of all.filter((x) => x.hud)) {
    const rb = rectilinearBoxes(r.polygon);
    hudLinks.set(r.id, rooms.filter((q) => overlaps(rb, rectilinearBoxes(q.polygon))).map((q) => q.id));
  }

  // horizontal occluders: the floor of every level that has one below (its rooms' plans grown by an outer wall's
  // thickness – the walls stand on the slab – minus the stairwell), joined with the terrace deck in front of the house
  // (outsideHouse.deck), cut at the deck's top. An eye above it never sees a box that lies wholly under it through it
  const occluders = [];
  for (const lv of h.levels || []) {
    if (!lv.belowId) continue;
    const cover = rooms.filter((r) => r.levelId === lv.id).flatMap((r) => rectilinearBoxes(r.polygon)).map((b) => ({ minX: b.minX - 0.3, maxX: b.maxX + 0.3, minZ: b.minZ - 0.3, maxZ: b.maxZ + 0.3 }));
    const holes = (h.floorOpenings || []).filter((fo) => fo.levelId === lv.id).flatMap((fo) => rectilinearBoxes(fo.polygon)).map((b) => ({ minX: b.minX - 0.05, maxX: b.maxX + 0.05, minZ: b.minZ - 0.05, maxZ: b.maxZ + 0.05 }));
    let y = lv.floorY;
    // the terrace deck as the exterior builds it (exteriorPlan: TERRACE_FIT + V9, out to x 10.35 and z 6.75)
    if (lv.id === h.levels[0]?.id && cover.length) {
      let plan = null;
      try {
        plan = exteriorPlan(layout);
      } catch {
        plan = null;
      }
      const poly = plan?.house ? plan.t?.polygonV : null;
      if (poly?.length >= 3 && Number.isFinite(plan.deckY)) {
        cover.push(...rectilinearBoxes(poly));
        y = Math.min(y, plan.deckY);
      }
    }
    if (cover.length) occluders.push({ levelId: lv.id, y, cover, holes });
  }

  // each room's box: its plan + walls and slabs, and what the scene says its geometry spans
  const roomBoxes = new Map();
  for (const r of rooms) {
    const b = r.bounds;
    let box = { min: [b.minX - ROOM_PAD, r.floorY - ROOM_PAD, b.minZ - ROOM_PAD], max: [b.maxX + ROOM_PAD, (r.ceilingTop ?? r.floorY + 2.4) + ROOM_PAD, b.maxZ + ROOM_PAD] };
    const g = boxes?.[r.id];
    if (g && !(g.isBox3 && g.isEmpty())) box = unionBox(box, g.isBox3 ? boxOf(g) : g);
    roomBoxes.set(r.id, box);
  }
  return { rooms, ids, portals, byCell, deps, hudLinks, boxes: roomBoxes, occluders };
}

/**
 * The cell(s) an eye is in. In a doorway, a reveal or the slab of the stairwell: the two cells of that portal. Above
 * the ceiling of its room (an overview camera): null (show everything). Pure.
 * @param {object} graph   visibilityGraph
 * @param {object} layout
 * @param {{x:number, y:number, z:number}} eye  world
 * @returns {string[]|null}
 */
export function cellsAt(graph, layout, eye) {
  const h = layout?.house;
  if (!graph || !h) return null;
  const hit = new Set();
  for (const p of graph.portals) if (p.kind !== 'window' && inBox(p.box, eye, IN_PORTAL)) hit.add(p.a).add(p.b);
  if (hit.size) return [...hit];
  const lv = h.levelAt ? h.levelAt(eye.y) : null;
  const room = lv ? graph.rooms.find((r) => r.levelId === lv.id && inPoly(eye.x, eye.z, r.polygon)) : null;
  if (room) return eye.y > (room.ceilingTop ?? room.floorY + 2.4) + 0.3 ? null : [room.id];
  // in the thickness of a wall, between two plans: the rooms of the level close by
  const near = lv ? graph.rooms.filter((r) => r.levelId === lv.id && distPoly(eye.x, eye.z, r.polygon) <= NEAR_ROOM) : [];
  if (near.length) return near.map((r) => r.id);
  return [OUTSIDE];
}

const _v4 = new THREE.Vector4();
/**
 * Screen rectangle (NDC) of a box seen by a camera (view-projection `vp`): null when it is behind the camera, the
 * whole screen when it straddles the camera plane or holds the eye.
 */
function projectBox(box, vp, eye) {
  if (inBox(box, eye, 0.05)) return FULL;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, front = 0;
  const e = vp.elements;
  for (let i = 0; i < 8; i++) {
    const x = i & 1 ? box.max[0] : box.min[0];
    const y = i & 2 ? box.max[1] : box.min[1];
    const z = i & 4 ? box.max[2] : box.min[2];
    _v4.set(x, y, z, 1);
    const w = e[3] * x + e[7] * y + e[11] * z + e[15];
    if (w <= 1e-3) continue;
    front++;
    const px = (e[0] * x + e[4] * y + e[8] * z + e[12]) / w;
    const py = (e[1] * x + e[5] * y + e[9] * z + e[13]) / w;
    if (px < x0) x0 = px;
    if (px > x1) x1 = px;
    if (py < y0) y0 = py;
    if (py > y1) y1 = py;
  }
  if (!front) return null;
  if (front < 8) return FULL;
  return [x0 - MARGIN, y0 - MARGIN, x1 + MARGIN, y1 + MARGIN];
}

/** Is the plan rectangle [x0, z0, x1, z1] inside the occluder's cover (union of rectangles) and clear of its holes? */
function covered(oc, q) {
  const xs = [q[0], q[2]], zs = [q[1], q[3]];
  for (const r of [...oc.cover, ...oc.holes]) {
    if (r.minX > q[0] && r.minX < q[2]) xs.push(r.minX);
    if (r.maxX > q[0] && r.maxX < q[2]) xs.push(r.maxX);
    if (r.minZ > q[1] && r.minZ < q[3]) zs.push(r.minZ);
    if (r.maxZ > q[1] && r.maxZ < q[3]) zs.push(r.maxZ);
  }
  xs.sort((a, b) => a - b);
  zs.sort((a, b) => a - b);
  const inR = (r, x, z, pad) => x >= r.minX - pad && x <= r.maxX + pad && z >= r.minZ - pad && z <= r.maxZ + pad;
  // every cell of the grid the rectangles' edges make inside q – its corners and its middle – is under the cover
  for (let i = 0; i < xs.length; i++) {
    for (let j = 0; j < zs.length; j++) {
      const pts = [[xs[i], zs[j]]];
      if (i + 1 < xs.length && j + 1 < zs.length) pts.push([(xs[i] + xs[i + 1]) / 2, (zs[j] + zs[j + 1]) / 2]);
      for (const [x, z] of pts) {
        if (!oc.cover.some((r) => inR(r, x, z, 1e-6))) return false;
        if (oc.holes.some((r) => inR(r, x, z, 1e-6))) return false;
      }
    }
  }
  return true;
}

/**
 * Is a box hidden from the eye by a horizontal occluder (a floor slab with the deck)? Only for an eye above the
 * occluder and a box wholly under it (a few cm of tolerance for the slab's own thickness): the box's corners are
 * projected from the eye onto the occluder's plane, and the rectangle around them must lie under the cover.
 */
function occluded(graph, box, eye) {
  for (const oc of graph.occluders || []) {
    if (eye.y <= oc.y + 0.05 || box.max[1] > oc.y + 0.035) continue;
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (let i = 0; i < 8; i++) {
      const x = i & 1 ? box.max[0] : box.min[0];
      const y = Math.min(i & 2 ? box.max[1] : box.min[1], oc.y);
      const z = i & 4 ? box.max[2] : box.min[2];
      const t = (eye.y - oc.y) / Math.max(1e-6, eye.y - y);
      const qx = eye.x + (x - eye.x) * t, qz = eye.z + (z - eye.z) * t;
      if (qx < x0) x0 = qx;
      if (qx > x1) x1 = qx;
      if (qz < z0) z0 = qz;
      if (qz > z1) z1 = qz;
    }
    if (covered(oc, [x0, z0, x1, z1])) return true;
  }
  return false;
}

/** The region behind portal p seen from the eye: beyond its near face along its thin axis (none: eye inside it). */
function beyond(clip, p, eye) {
  const k = p.axis;
  const c = k === 0 ? eye.x : k === 1 ? eye.y : eye.z;
  const lo = p.box.min[k], hi = p.box.max[k];
  if (c >= lo - EPS && c <= hi + EPS) return clip;
  const half = { min: [-Infinity, -Infinity, -Infinity], max: [Infinity, Infinity, Infinity] };
  if (c < lo) half.min[k] = lo;
  else half.max[k] = hi;
  return clipBox(clip, half) ?? clip;
}

/**
 * Walks the portal graph from the start cells. Pure.
 * @param {object} graph   visibilityGraph
 * @param {THREE.Camera} camera  (matrixWorld / projection up to date)
 * @param {{ eye: {x,y,z}, starts: string[], isOpen: (portal) => boolean }} o
 * @returns {{ all: boolean, seen: Set<string>, facade: Set<string>, outside: boolean, visits: number }}
 */
export function traverse(graph, camera, { eye, starts, isOpen = () => true }) {
  const vp = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  const seen = new Set(), facade = new Set();
  let outside = false, visits = 0;
  const stack = starts.map((cell) => ({ cell, rect: FULL, clip: INF, depth: 0, path: [cell] }));
  while (stack.length) {
    const s = stack.pop();
    if (++visits > MAX_VISITS) return { all: true, seen, facade, outside: true, visits };
    if (s.cell === OUTSIDE) {
      outside = true;
      // the facades in this view of the outside: every room whose geometry (behind the portals so far) is in it
      for (const [id, box] of graph.boxes) {
        if (facade.has(id) || s.path.includes(id)) continue;
        const b = clipBox(box, s.clip);
        const r = b && !occluded(graph, b, eye) && projectBox(b, vp, eye);
        if (r && rectAnd(r, s.rect)) facade.add(id);
      }
    } else seen.add(s.cell);
    if (s.depth >= MAX_DEPTH) continue;
    for (const p of graph.byCell.get(s.cell) || []) {
      const other = p.a === s.cell ? p.b : p.a;
      if (s.path.includes(other) || !isOpen(p)) continue;
      // only from the camera's side of the portal (or with the camera in its thickness)
      const side = p.side?.[s.cell] ?? 0;
      const ck = p.axis === 0 ? eye.x : p.axis === 1 ? eye.y : eye.z;
      if ((side < 0 && ck > p.box.max[p.axis] + EPS) || (side > 0 && ck < p.box.min[p.axis] - EPS)) continue;
      const pb = clipBox(p.box, s.clip);
      if (!pb || occluded(graph, pb, eye)) continue;
      const pr = projectBox(pb, vp, eye);
      const rect = pr && rectAnd(pr, s.rect);
      if (!rect) continue;
      stack.push({ cell: other, rect, clip: beyond(s.clip, p, eye), depth: s.depth + 1, path: [...s.path, other] });
    }
  }
  return { all: false, seen, facade, outside, visits };
}

/**
 * @param {object} home    createHome result (roots, doors, windows, sync, design, lighting)
 * @param {object} layout  home/layout.js
 */
export function createVisibility(home, layout) {
  const roots = home?.roots;
  const h = layout?.house;
  let params = null;
  try {
    params = typeof location !== 'undefined' ? new URLSearchParams(location.search) : null;
  } catch {
    params = null;
  }
  const flag = params?.get('vis') ?? null;
  // &vistrim=0: no per-mesh trimming of dependency-only rooms (comparisons)
  const trimOn = params?.get('vistrim') !== '0';

  const stats = { active: false, cells: null, seen: [], surfaces: [], outside: true, hidden: 0, items: 0, visits: 0, changes: 0, updates: 0, ms: 0 };
  const vis = {
    enabled: false,
    home,
    layout,
    graph: null,
    stats,
    update() {},
    setOverview() {},
    setEnabled() {},
    refresh() {},
    levelVisible: () => true,
    contentsVisible: () => true,
    surfacesVisible: () => true,
    dispose() {
      vis.home = null;
      vis.layout = null;
    },
  };
  if (!h?.rooms?.length || !roots?.levels || !roots.rooms || flag === '0') return vis;

  // ---- units: what one room shows and hides
  const units = new Map(); // roomId → { surfaces: Object3D[], contents: Object3D[] }
  for (const [id, r] of Object.entries(roots.rooms)) units.set(id, { surfaces: [r.surfaces], contents: [r.contents] });
  const LIVING = 'stue-kjokken';
  const living = units.get(LIVING);
  if (living) {
    if (roots.shell) living.surfaces.push(roots.shell);
    if (roots.kitchen) living.contents.push(roots.kitchen);
    if (roots.wall) living.contents.push(roots.wall);
  }

  // room geometry boxes for the facade test (the scene's world matrices are up to date: createHome ran
  // scene.updateMatrixWorld before the lights and the furniture)
  const geomBoxes = {};
  const tmp = new THREE.Box3();
  for (const [id, u] of units) {
    const b = new THREE.Box3();
    for (const o of u.surfaces) {
      o.updateWorldMatrix?.(true, true);
      b.union(tmp.setFromObject(o));
    }
    if (!b.isEmpty()) geomBoxes[id] = b;
  }
  const graph = visibilityGraph(layout, { boxes: geomBoxes });
  if (!graph) return vis;
  vis.graph = graph;

  // the doors' real owners in the scene (the room group a leaf hangs in) – a dependency of both rooms it joins
  const ownerOf = (o) => {
    for (let p = o; p; p = p.parent) {
      if (p === roots.shell || p === roots.kitchen) return LIVING;
      if (p.userData?.roomId && units.has(p.userData.roomId)) return p.userData.roomId;
    }
    return null;
  };
  const doorsById = new Map();
  for (const d of home.doors || []) {
    if (!d?.door) continue;
    doorsById.set(d.id, d.door);
    const owner = ownerOf(d.door.root);
    const conn = h.openingsById?.[d.id]?.connects || d.connects || [];
    for (const c of conn) if (owner && c !== owner && graph.deps.has(c)) graph.deps.get(c).add(owner);
  }

  // the meshes of each room's surfaces with their world boxes: a room shown only because a seen room depends on it
  // keeps just the meshes on that seen room's boundary (its plan grown by TRIM) – the rest is hidden per mesh with
  // the camera layer (layers, not .visible: the editor's cut toggles .visible of these meshes in an overview). Door
  // roots are never trimmed (their leaves swing).
  const doorRoots = new Set([...doorsById.values()].map((d) => d.root).filter(Boolean));
  const meshesOf = new Map();
  for (const [id, u] of units) {
    const list = [];
    const walk = (o) => {
      if (doorRoots.has(o)) return;
      if ((o.isMesh || o.isLine || o.isPoints) && o.geometry && (o.layers.mask & 1)) {
        const b = new THREE.Box3().setFromObject(o);
        if (!b.isEmpty()) list.push({ mesh: o, box: boxOf(b) });
      }
      for (const c of o.children) walk(c);
    };
    for (const o of u.surfaces) walk(o);
    meshesOf.set(id, list);
  }
  const regionsOf = new Map(
    graph.rooms.map((r) => {
      const y0 = r.floorY - 0.35, y1 = (r.ceilingTop ?? r.floorY + 2.4) + 0.35;
      const list = rectilinearBoxes(r.polygon).map((b) => ({ min: [b.minX - TRIM, y0, b.minZ - TRIM], max: [b.maxX + TRIM, y1, b.maxZ + TRIM] }));
      // through each door / opening of the room a little way into the next room
      for (const p of graph.byCell.get(r.id) || []) {
        if (p.kind === 'window' || p.kind === 'hole') continue;
        const min = [...p.box.min], max = [...p.box.max];
        for (let k = 0; k < 3; k++) {
          const d = k === p.axis ? THROUGH_DOOR : 0.05;
          min[k] -= d;
          max[k] += d;
        }
        list.push({ min, max });
      }
      return [r.id, list];
    }),
  );

  // window shading anchors (roots.shading) follow their room's surfaces
  const anchors = [];
  for (const w of home.windows || []) {
    const rid = h.openingsById?.[w.id]?.roomId ?? w.roomId ?? LIVING;
    if (w.anchor && units.has(rid)) anchors.push({ obj: w.anchor, roomId: rid });
  }

  // ---- furniture: the rooms its bounding box lies in (recomputed when SceneSync builds / moves / removes one)
  const itemRooms = new Map(); // object → string[] (empty: always shown)
  let itemsDirty = true;
  const sync = home.sync;
  const offs = [];
  if (sync?.on) for (const ev of ['built', 'moved', 'removed']) offs.push(sync.on(ev, () => ((itemsDirty = true), (dirty = true))));
  const roomsForBox = (b) => {
    const out = [];
    for (const r of graph.rooms) {
      const rb = r.bounds;
      const top = (r.ceilingTop ?? r.floorY + 2.4) + 0.1;
      if (b.max.x < rb.minX - 0.15 || b.min.x > rb.maxX + 0.15 || b.max.z < rb.minZ - 0.15 || b.min.z > rb.maxZ + 0.15) continue;
      if (b.max.y < r.floorY - 0.35 || b.min.y > top) continue;
      out.push(r.id);
    }
    return out;
  };
  // a piece that reaches out of its rooms' plans (a sill ornament in the window reveal, a plant through a wall) is also
  // seen from outside with its room's facade
  const planRects = new Map(graph.rooms.map((r) => [r.id, rectilinearBoxes(r.polygon)]));
  const inPlans = (ids, x, z) => ids.some((id) => (planRects.get(id) || []).some((b) => x >= b.minX - 0.02 && x <= b.maxX + 0.02 && z >= b.minZ - 0.02 && z <= b.maxZ + 0.02));
  const mapItems = () => {
    itemsDirty = false;
    itemRooms.clear();
    for (const o of sync?.objects?.() || []) {
      o.updateWorldMatrix?.(true, true);
      const b = tmp.setFromObject(o);
      const rooms = b.isEmpty() ? [] : roomsForBox(b);
      const pokes = rooms.length > 0 && ![[b.min.x, b.min.z], [b.min.x, b.max.z], [b.max.x, b.min.z], [b.max.x, b.max.z]].every(([x, z]) => inPlans(rooms, x, z));
      itemRooms.set(o, { rooms, pokes });
    }
  };

  // ---- hiding: only what this module hid is ever shown again by it
  const hidden = new Set(); // structural groups (levels, room surfaces / contents, shell, kitchen, exterior, anchors)
  const hiddenItems = new Map(); // item root → uid
  const setUnit = (o, on) => {
    if (!o) return;
    if (on) {
      if (hidden.delete(o)) {
        o.visible = true;
        stats.changes++;
      }
    } else if (o.visible && !hidden.has(o)) {
      o.visible = false;
      hidden.add(o);
      stats.changes++;
    }
  };
  const setItem = (o, on) => {
    if (on) {
      if (hiddenItems.has(o)) {
        const uid = hiddenItems.get(o);
        hiddenItems.delete(o);
        o.visible = !home.design?.get?.(uid)?.hidden;
        stats.changes++;
      }
    } else if (o.visible && !hiddenItems.has(o)) {
      hiddenItems.set(o, o.userData?.uid ?? null);
      o.visible = false;
      stats.changes++;
    }
  };
  const showAll = () => {
    for (const o of [...hidden]) setUnit(o, true);
    for (const o of [...hiddenItems.keys()]) setItem(o, true);
    for (const m of [...trimmed]) setTrim(m, false);
    state.seen = null;
    state.surfaces = null;
    state.outside = true;
  };
  // the shadow pass and foreign cameras see the full scene: reveal() / conceal() flip only what is hidden now
  let revealed = 0;
  const reveal = () => {
    if (revealed++) return;
    for (const o of hidden) o.visible = true;
    for (const o of hiddenItems.keys()) o.visible = true;
    for (const m of trimmed) m.layers.enable(0);
  };
  const conceal = () => {
    if (--revealed > 0) return;
    revealed = 0;
    for (const o of hidden) o.visible = false;
    for (const o of hiddenItems.keys()) o.visible = false;
    for (const m of trimmed) m.layers.disable(0);
  };
  const trimmed = new Set(); // meshes hidden with the camera layer (dependency-only rooms)
  const setTrim = (m, hide) => {
    if (hide) {
      if (!trimmed.has(m)) {
        m.layers.disable(0);
        trimmed.add(m);
        stats.changes++;
      }
    } else if (trimmed.delete(m)) {
      m.layers.enable(0);
      stats.changes++;
    }
  };
  const anyHidden = () => hidden.size > 0 || hiddenItems.size > 0 || trimmed.size > 0;

  const renderer = home.lighting?.renderer ?? null;
  const sm = renderer?.shadowMap ?? null;
  const ownRender = sm && Object.prototype.hasOwnProperty.call(sm, 'render') ? sm.render : null;
  if (sm && ownRender) {
    sm.render = function shadowWithEverything(lights, scene, camera) {
      if (!anyHidden() || sm.enabled === false || (sm.autoUpdate === false && sm.needsUpdate === false) || !lights?.length) return ownRender.call(this, lights, scene, camera);
      reveal();
      try {
        return ownRender.call(this, lights, scene, camera);
      } finally {
        conceal();
      }
    };
  }
  const scene = home.lighting?.scene ?? null;
  const prevBefore = scene ? scene.onBeforeRender : null;
  const prevAfter = scene ? scene.onAfterRender : null;
  let foreign = false;
  let lastCamera = null;
  if (scene) {
    scene.onBeforeRender = function (r, s, camera, target) {
      prevBefore?.call(this, r, s, camera, target);
      if (!target) lastCamera = camera;
      foreign = !!camera && !!state.camera && camera !== state.camera && anyHidden();
      if (foreign) reveal();
    };
    scene.onAfterRender = function (r, s, camera) {
      if (foreign) {
        foreign = false;
        conceal();
      }
      prevAfter?.call(this, r, s, camera);
    };
  }

  // ---- state
  const state = { camera: null, seen: null, surfaces: null, outside: true, key: '', doorKey: '' };
  let dirty = true;
  let overview = false;
  let on = true;
  let started = false;
  const eye = new THREE.Vector3();
  const isOpen = (p) => {
    if (p.kind !== 'door') return true;
    const d = doorsById.get(p.id);
    return !d || d.isOpen || (d.t ?? 0) > 1e-3;
  };
  const doorKey = () => {
    let k = '';
    for (const d of doorsById.values()) k += d.isOpen || (d.t ?? 0) > 1e-3 ? '1' : '0';
    return k;
  };
  const levelOf = new Map(graph.rooms.map((r) => [r.id, r.levelId]));
  for (const [id, r] of Object.entries(roots.rooms)) if (!levelOf.has(id)) levelOf.set(id, r.levelId);

  function apply(seen, surfaces, outside, facade = new Set(), eyeLevel = null) {
    state.seen = seen;
    state.surfaces = surfaces;
    state.outside = outside;
    const levelOn = new Map(Object.keys(roots.levels).map((id) => [id, false]));
    for (const [id, u] of units) {
      const links = graph.hudLinks.get(id);
      const sOn = links ? links.some((x) => surfaces.has(x)) : surfaces.has(id);
      const cOn = links ? links.some((x) => seen.has(x)) : seen.has(id);
      for (const o of u.surfaces) setUnit(o, sOn);
      for (const o of u.contents) setUnit(o, cOn);
      if (sOn || cOn) levelOn.set(levelOf.get(id), true);
    }
    for (const [id, g] of Object.entries(roots.levels)) setUnit(g, levelOn.get(id) !== false);
    // dependency-only rooms: the meshes on the boundary of the seen rooms that need them
    for (const [id, list] of meshesOf) {
      // only on the camera's own level: a room of the other level is seen down (or up) the stairwell, and there the
      // horizontal cracks between the basement walls and the slab show a neighbour's far walls (steg 29 check)
      const trim = trimOn && surfaces.has(id) && !seen.has(id) && !facade.has(id) && levelOf.get(id) === eyeLevel;
      if (!trim) {
        for (const e of list) if (trimmed.has(e.mesh)) setTrim(e.mesh, false);
        continue;
      }
      const regions = [];
      for (const s of seen) if (graph.deps.get(s)?.has(id)) regions.push(...(regionsOf.get(s) || []));
      for (const e of list) setTrim(e.mesh, !regions.some((r) => touches(r, e.box)));
    }
    setUnit(roots.exterior, outside);
    for (const a of anchors) setUnit(a.obj, surfaces.has(a.roomId));
    if (itemsDirty) mapItems();
    for (const [o, it] of itemRooms) {
      if (!o.parent) continue;
      const rs = it.rooms;
      setItem(o, !rs.length || rs.some((x) => seen.has(x)) || (it.pokes && rs.some((x) => surfaces.has(x))));
    }
    for (const o of [...hiddenItems.keys()]) if (!o.parent) hiddenItems.delete(o);
  }

  vis.enabled = true;
  vis.update = (dt, st = {}) => {
    const cam = st.camera ?? null;
    state.camera = cam;
    const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
    // the sandbox (no player) only with ?vis=1; never before the full scene has been rendered once (precompile)
    const wanted = on && !overview && !!cam?.isPerspectiveCamera && (st.player || flag === '1');
    const rendered = (renderer?.info?.render?.frame ?? 1) >= 1;
    const viewOverview = !!lastCamera && lastCamera !== cam;
    if (!wanted || !rendered || viewOverview) {
      if (stats.active || anyHidden()) showAll();
      stats.active = false;
      dirty = true;
      return;
    }
    started = true;
    cam.updateMatrixWorld();
    cam.getWorldPosition(eye);
    const e = cam.matrixWorld.elements;
    const key = `${eye.x.toFixed(3)},${eye.y.toFixed(3)},${eye.z.toFixed(3)},${e[8].toFixed(4)},${e[9].toFixed(4)},${e[10].toFixed(4)},${e[4].toFixed(3)},${cam.fov},${cam.aspect.toFixed(4)},${cam.zoom}`;
    const dk = doorKey();
    if (!dirty && !itemsDirty && key === state.key && dk === state.doorKey) return;
    dirty = false;
    state.key = key;
    state.doorKey = dk;
    stats.updates++;
    const starts = cellsAt(graph, layout, eye);
    if (!starts) {
      showAll();
      stats.active = false;
      stats.cells = null;
      return;
    }
    const res = traverse(graph, cam, { eye, starts, isOpen });
    if (res.all) {
      showAll();
      stats.active = false;
      return;
    }
    // a seen room needs its boundary's owners; a facade (seen from outside only) is the room's own outer walls
    const surfaces = new Set([...res.seen, ...res.facade]);
    for (const id of res.seen) for (const d of graph.deps.get(id) || []) surfaces.add(d);
    apply(res.seen, surfaces, res.outside, res.facade, layout.house.levelAt?.(eye.y)?.id ?? null);
    stats.active = true;
    stats.cells = starts;
    stats.seen = [...res.seen];
    stats.surfaces = [...surfaces];
    stats.outside = res.outside;
    stats.hidden = hidden.size;
    stats.items = hiddenItems.size;
    stats.trimmed = trimmed.size;
    stats.visits = res.visits;
    stats.ms = (typeof performance !== 'undefined' ? performance.now() : 0) - t0;
  };
  vis.setOverview = (v) => {
    overview = !!v;
    if (overview) showAll();
    dirty = true;
  };
  vis.setEnabled = (v) => {
    on = !!v;
    if (!on) showAll();
    stats.active = false;
    dirty = true;
  };
  vis.refresh = () => {
    dirty = true;
    itemsDirty = true;
  };
  vis.levelVisible = (id) => roots.levels[id]?.visible !== false;
  vis.contentsVisible = (roomId) => !state.seen || state.seen.has(roomId) || (graph.hudLinks.get(roomId) || []).some((x) => state.seen.has(x));
  vis.surfacesVisible = (roomId) => !state.surfaces || state.surfaces.has(roomId) || (graph.hudLinks.get(roomId) || []).some((x) => state.surfaces.has(x));
  /** Whether the module has hidden anything (tests). */
  vis.started = () => started;
  /**
   * What is hidden now (diagnosis, tools/perf.mjs --only=check): [{ name, kind: 'group'|'item'|'mesh', show(), hide() }]
   * – show()/hide() flip one entry for a test render without touching the module's own bookkeeping.
   */
  vis.hiddenObjects = () => [
    ...[...hidden].map((o) => ({ name: o.name || o.type, kind: 'group', show: () => (o.visible = true), hide: () => (o.visible = false) })),
    ...[...hiddenItems.keys()].map((o) => ({ name: o.name || o.type, kind: 'item', show: () => (o.visible = true), hide: () => (o.visible = false) })),
    ...[...trimmed].map((m) => ({ name: `${m.parent?.name ?? '?'} › ${m.name || m.type}`, kind: 'mesh', show: () => m.layers.enable(0), hide: () => m.layers.disable(0) })),
  ];
  vis.dispose = () => {
    showAll();
    for (const off of offs) off?.();
    if (sm && ownRender) sm.render = ownRender;
    if (scene) {
      scene.onBeforeRender = prevBefore;
      scene.onAfterRender = prevAfter;
    }
    vis.home = null;
    vis.layout = null;
  };
  return vis;
}
