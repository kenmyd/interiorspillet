// The plan pass of the built-ins (notes/kjokken-bad-genererte-hus.md): between layout.house.builtIns and the builders
// of builtins.js. A generated house (the planbygger) sends one entry per symbol on the plan – type, position,
// rotationDeg, dims, wallId – and this pass works out what the symbols mean together, on copies (layout.house stays
// as it is):
//   • kitchen appliances standing in a bench or an island (sink, dishwasher, hob, oven, an under-counter fridge or
//     freezer) become its slots (host.slots: local x ranges); one without a host is built as a short bench of its own;
//     a washer or dryer under a laundry bench leaves a gap in the bench's carcass (host.gaps);
//   • a shower that names neither `corner`, `points` nor `glass` gets them from the walls round its footprint: glass on
//     the open sides with a door on the longest, the shower set on a wall, a drain when none lies inside, and its walls
//     tiled to the ceiling;
//   • the wall tiles (rooms[].wallTiles, a bench's params.backsplash, the shower's walls) as zones per wall face, and
//     the wall-hung entries on a tiled part of a wall stand out by the tiles' thickness (TILE_T); in a tiled room the
//     WC's cistern box and a built-in bathtub's apron get the tiles (b.tileFinish).
// The owner's house has none of this (its showers name their corner, no room has wallTiles): planBuiltIns returns its
// entries as the same objects, in the same order.

/** Thickness of wall tiles with their adhesive: the tiled face stands this far in front of the wall. */
export const TILE_T = 0.008;

/**
 * Standard sizes of what the planbygger sends, per type: mount, dims { w, d, h } (w along the front), y (height of the
 * underside over the floor: position[1]) and params a generated house starts from. The planbygger takes the size it
 * measures on the plan and these for the rest (notes/kjokken-bad-genererte-hus.md has the table with the symbols).
 */
export const BUILT_IN_DEFAULTS = Object.freeze({
  // kitchen (kitchenkit.js)
  'kitchen-bench': { mount: 'wall', dims: { w: 2.4, d: 0.6, h: 0.9 }, y: 0 },
  'kitchen-island': { mount: 'floor', dims: { w: 2.4, d: 0.9, h: 0.9 }, y: 0 },
  'wall-cabinets': { mount: 'wall', dims: { w: 1.8, d: 0.35, h: 0.7 }, y: 1.45 },
  hood: { mount: 'wall', dims: { w: 0.6, d: 0.48, h: 0.5 }, y: 1.55 },
  'tall-cabinet': { mount: 'wall', dims: { w: 0.6, d: 0.6, h: 2.1 }, y: 0 },
  fridge: { mount: 'wall', dims: { w: 0.6, d: 0.6, h: 2.1 }, y: 0 },
  freezer: { mount: 'wall', dims: { w: 0.6, d: 0.6, h: 2.1 }, y: 0 },
  'fridge-freezer': { mount: 'wall', dims: { w: 0.6, d: 0.6, h: 2.1 }, y: 0 },
  'oven-tower': { mount: 'wall', dims: { w: 0.6, d: 0.6, h: 2.1 }, y: 0 },
  sink: { mount: 'floor', dims: { w: 0.6, d: 0.5, h: 0.9 }, y: 0 },
  dishwasher: { mount: 'floor', dims: { w: 0.6, d: 0.6, h: 0.9 }, y: 0 },
  hob: { mount: 'floor', dims: { w: 0.6, d: 0.52, h: 0.9 }, y: 0 },
  oven: { mount: 'floor', dims: { w: 0.6, d: 0.6, h: 0.9 }, y: 0 },
  // bathroom (bathroom.js)
  wc: { mount: 'wall', dims: { w: 0.6, d: 0.2, h: 1.1 }, y: 0 },
  vanity: { mount: 'wall', dims: { w: 0.6, d: 0.46, h: 0.5 }, y: 0.35 },
  shower: { mount: 'floor', dims: { w: 0.9, d: 0.9, h: 2 }, y: 0 },
  bathtub: { mount: 'floor', dims: { w: 1.7, d: 0.75, h: 0.58 }, y: 0 },
  mirror: { mount: 'wall', dims: { w: 0.6, d: 0.03, h: 0.8 }, y: 1.1 },
  'mirror-round': { mount: 'wall', dims: { w: 0.6, d: 0.04, h: 0.6 }, y: 1.15 },
  'towel-radiator': { mount: 'wall', dims: { w: 0.5, d: 0.08, h: 1.2 }, y: 0.2, params: { form: 'ladder' } },
  'floor-drain': { mount: 'floor', dims: { w: 0.15, d: 0.15, h: 0.005 }, y: 0, params: { shape: 'square' } },
  // laundry (laundry.js)
  washer: { mount: 'floor', dims: { w: 0.6, d: 0.6, h: 0.85 }, y: 0 },
  dryer: { mount: 'floor', dims: { w: 0.6, d: 0.6, h: 0.85 }, y: 0 },
  'laundry-bench': { mount: 'wall', dims: { w: 1.2, d: 0.6, h: 0.9 }, y: 0 },
  'utility-sink': { mount: 'wall', dims: { w: 0.6, d: 0.5, h: 0.9 }, y: 0 },
  'water-heater': { mount: 'floor', dims: { w: 0.55, d: 0.55, h: 1.3 }, y: 0 },
});

/**
 * The marks on Norwegian floor plans and the type each gives (notes/kjokken-bad-genererte-hus.md). Symbols without
 * letters (the WC bowl, a basin, the shower's square with a cross, the bathtub, a drain) are in the note.
 */
export const PLAN_SYMBOLS = Object.freeze({
  KV: 'sink', OM: 'dishwasher', KT: 'hob', ST: 'oven', HS: 'tall-cabinet', K: 'fridge', F: 'freezer', KF: 'fridge-freezer',
  'K/F': 'fridge-freezer', 'M/O': 'oven-tower', 'O/M': 'oven-tower', V: 'hood', VM: 'washer', TT: 'dryer', VVB: 'water-heater',
  VB: 'water-heater', SK: 'utility-sink',
});

/** Types that stand in a kitchen bench or island (its slots). */
export const SLOT_TYPES = Object.freeze(['sink', 'dishwasher', 'hob', 'oven', 'fridge', 'freezer']);
/** Types that hold slots. */
export const HOST_TYPES = Object.freeze(['kitchen-bench', 'kitchen-island']);
/** Under-counter fridges / freezers: a fridge or freezer this low in a bench is a slot, a taller one a tall unit. */
const UNDER_COUNTER_H = 1.0;
const DEG = Math.PI / 180;

/** Plan frame of an entry (as builtins.js builtInFrame, without THREE): centre of the footprint, yaw, toLocal. */
function frameOf(b) {
  const yaw = (b.rotationDeg ?? 0) * DEG;
  const s = Math.sin(yaw), c = Math.cos(yaw);
  const p = b.position?.isVector3 ? [b.position.x, b.position.z] : [b.position?.[0] ?? 0, b.position?.[2] ?? 0];
  const d = b.dims?.d ?? 0;
  const cx = b.mount === 'wall' ? p[0] + s * (d / 2) : p[0];
  const cz = b.mount === 'wall' ? p[1] + c * (d / 2) : p[1];
  return {
    cx, cz, yaw,
    // local x = (cos, −sin), local z = front (sin, cos)
    toLocal: (x, z) => ({ x: (x - cx) * c - (z - cz) * s, z: (x - cx) * s + (z - cz) * c }),
    toWorld: (x, z) => ({ x: cx + x * c + z * s, z: cz - x * s + z * c }),
  };
}

/** World AABB of an entry's footprint in plan (x, z). */
function footprintOf(b) {
  const f = frameOf(b);
  const { w, d } = b.dims;
  const pts = [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]].map(([x, z]) => f.toWorld(x, z));
  return {
    minX: Math.min(...pts.map((p) => p.x)), maxX: Math.max(...pts.map((p) => p.x)),
    minZ: Math.min(...pts.map((p) => p.z)), maxZ: Math.max(...pts.map((p) => p.z)),
  };
}

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const hasDims = (b) => isObj(b?.dims) && [b.dims.w, b.dims.d, b.dims.h].every((v) => Number.isFinite(v) && v > 0);

/**
 * @param {object} H  layout.house
 * @returns {{ list: object[], tiles: Map<string, Array<{ wall: object, zones: object[] }>> }}  the entries to build
 *   (hosted slots left out, derived drains added) and the tile zones per room
 */
export function planBuiltIns(H) {
  const src = H?.builtIns || [];
  const wallsById = H?.wallsById || {};
  const roomsById = Object.fromEntries((H?.rooms || []).map((r) => [r.id, r]));
  const out = src.map((b) => b);
  const copy = (i) => {
    if (out[i] === src[i]) out[i] = { ...src[i], params: { ...(src[i].params || {}) } };
    return out[i];
  };
  const drop = new Set();
  const extra = [];

  // ---- slots: kitchen appliances in a bench / island, machines under a laundry bench
  const index = new Map(src.map((b, i) => [b, i]));
  src.forEach((s, i) => {
    const found = hostOf(s, src);
    if (!found) return;
    const host = copy(index.get(found.host));
    if (found.machine) {
      host.gaps = [...(host.gaps || []), [found.x0, found.x1]]; // the machine is built on its own, under the worktop
      return;
    }
    host.slots = [...(host.slots || []), { id: s.id, type: s.type, x0: found.x0, x1: found.x1, z: found.z, params: s.params || {}, colors: s.colors || {} }];
    drop.add(i);
  });

  // ---- showers: glass, set and drain from the walls round them
  const showerSides = []; // { roomId, wallId, u0, u1 } – tiled to the ceiling
  src.forEach((b, i) => {
    if (b.type !== 'shower' || !hasDims(b)) return;
    const P = b.params || {};
    if (P.corner != null || P.points || P.glass) return; // the owner's, or a shower that says it all
    const room = roomsById[b.roomId];
    if (!room) return;
    const sh = autoShower(b, room, wallsById, src);
    const e = copy(i);
    Object.assign(e.params, sh.params);
    if (sh.collide === false) e.collide = false;
    showerSides.push(...sh.sides.map((s) => ({ roomId: b.roomId, ...s })));
    if (sh.drain) extra.push(sh.drain);
  });

  // ---- wall tiles: zones per wall face
  const zonesByWall = new Map(); // wallId → zones
  const addZone = (wall, z) => {
    if (!wall || (!(wall.thickness > 0) && !wall.backOf)) return; // an open boundary (no surface)
    const L = wall.length;
    const u0 = Math.max(0, Math.min(L, z.u0 ?? 0)), u1 = Math.max(0, Math.min(L, z.u1 ?? L));
    if (u1 - u0 < 0.01) return;
    if (!zonesByWall.has(wall.id)) zonesByWall.set(wall.id, []);
    zonesByWall.get(wall.id).push({ ...z, u0, u1 });
  };
  const finishOf = (r, t) => ({
    color: hexOr(t?.color, r?.kind === 'laundry' ? '#e4e2dd' : '#ecebe7'),
    size: Array.isArray(t?.size) && t.size.length === 2 && t.size.every((v) => v > 0) ? [t.size[0], t.size[1]] : [0.3, 0.6],
    grout: Number.isFinite(t?.grout) ? t.grout : 0.003,
    groutColor: hexOr(t?.groutColor, null),
  });
  for (const r of H?.rooms || []) {
    const list = tileSpecs(r.wallTiles);
    for (const t of list) {
      const ids = Array.isArray(t.wallIds) && t.wallIds.length ? t.wallIds : r.wallIds || [];
      for (const id of ids) {
        const w = wallsById[id];
        if (!w || w.roomId !== r.id) continue;
        const u = Array.isArray(t.u) && t.u.length === 2 ? t.u : [0, w.length];
        addZone(w, { u0: Math.min(u[0], u[1]), u1: Math.max(u[0], u[1]), from: Number.isFinite(t.from) ? Math.max(0, t.from) : 0, top: t.height === 'ceiling' || t.height == null ? 'ceiling' : t.height, finish: finishOf(r, t), roomId: r.id });
      }
    }
  }
  // the walls of an auto shower: to the ceiling over the shower's width, in the room's tiles (or white)
  for (const s of showerSides) {
    const r = roomsById[s.roomId];
    const t = tileSpecs(r?.wallTiles)[0] ?? null;
    addZone(wallsById[s.wallId], { u0: s.u0, u1: s.u1, from: 0, top: 'ceiling', finish: finishOf(r, t), roomId: s.roomId, shower: true });
  }
  // a bench's backsplash: from the worktop to the wall cabinets over it (else 0.6 up)
  src.forEach((b) => {
    const bs = b.params?.backsplash;
    if (!bs || b.mount !== 'wall' || !hasDims(b)) return;
    const w = wallsById[b.wallId];
    if (!w) return;
    const [u0, u1] = spanOnWall(b, w);
    const y0 = (b.localPosition?.[1] ?? 0) + b.dims.h;
    const above = src.filter((c) => c.type === 'wall-cabinets' && c.wallId === b.wallId && hasDims(c)).filter((c) => {
      const [a, z] = spanOnWall(c, w);
      return Math.min(z, u1) - Math.max(a, u0) > 0.05;
    });
    const top = above.length ? Math.min(...above.map((c) => c.localPosition?.[1] ?? 1.45)) : y0 + (Number.isFinite(bs.height) ? bs.height : 0.6);
    if (top - y0 < 0.05) return;
    addZone(w, { u0, u1, from: y0, top, finish: finishOf(roomsById[b.roomId], isObj(bs) ? bs : null), roomId: b.roomId, backsplash: b.id });
  });

  // ---- wall-hung entries on a tiled part of their wall stand out by the tiles
  out.forEach((b, i) => {
    if (drop.has(i) || b.mount !== 'wall' || !b.wallId || !hasDims(b)) return;
    const zones = zonesByWall.get(b.wallId);
    const w = wallsById[b.wallId];
    if (!zones || !w) return;
    const [u0, u1] = spanOnWall(b, w);
    const y0 = b.localPosition?.[1] ?? 0, y1 = y0 + b.dims.h;
    const hit = zones.some((z) => Math.min(u1, z.u1) - Math.max(u0, z.u0) > 0.005 && Math.min(y1, z.top === 'ceiling' ? Infinity : z.top) - Math.max(y0, z.from) > 0.005);
    if (!hit) return;
    const e = copy(i);
    e.position = b.position.clone().add({ x: w.normal.x * TILE_T, y: 0, z: w.normal.y * TILE_T });
    if (e.localPosition) e.localPosition = [e.localPosition[0] + w.normal.x * TILE_T, e.localPosition[1], e.localPosition[2] + w.normal.y * TILE_T];
  });
  // in a tiled room the WC's cistern box and a built-in bathtub's apron are tiled too (b.tileFinish)
  out.forEach((b, i) => {
    if (drop.has(i) || !(b.type === 'wc' || (b.type === 'bathtub' && b.params?.style !== 'freestanding')) || b.tileFinish) return;
    const r = roomsById[b.roomId];
    const t = tileSpecs(r?.wallTiles)[0];
    if (!t || (b.type === 'wc' && !zonesByWall.has(b.wallId))) return;
    copy(i).tileFinish = finishOf(r, t);
  });
  // the shower set on a tiled wall
  out.forEach((b, i) => {
    const set = b.type === 'shower' ? b.params?.set : null;
    if (!isObj(set) || !set.wall || !zonesByWall.has(set.wall) || set.standoff != null) return;
    copy(i).params.set = { ...set, standoff: TILE_T };
  });

  const list = [...out.filter((_, i) => !drop.has(i)), ...extra];
  const tiles = new Map();
  for (const [wallId, zones] of zonesByWall) {
    const w = wallsById[wallId];
    if (!tiles.has(w.roomId)) tiles.set(w.roomId, []);
    tiles.get(w.roomId).push({ wall: w, zones });
  }
  return { list, tiles };
}

/**
 * The bench an entry stands in: a kitchen slot type (sink, dishwasher, hob, oven, an under-counter fridge / freezer)
 * in a kitchen-bench or kitchen-island, a washer or dryer under a laundry-bench – same room, the entry's centre
 * inside the host's footprint. Works on spec entries (position [x, y, z]) and layout entries (Vector3) alike.
 * @returns {{ host: object, x0: number, x1: number, z: number, machine: boolean }|null}  x0..x1: the entry's width
 *   along the host in its local frame (clamped to it), z: its local depth position
 */
export function hostOf(s, list) {
  const kitchenSlot = SLOT_TYPES.includes(s?.type) && !((s.type === 'fridge' || s.type === 'freezer') && (s.dims?.h ?? 0) > UNDER_COUNTER_H);
  const machine = s?.type === 'washer' || s?.type === 'dryer';
  if ((!kitchenSlot && !machine) || !hasDims(s) || !s.position) return null;
  const sf = frameOf(s);
  for (const h of list) {
    if (h === s || !hasDims(h) || h.roomId !== s.roomId) continue;
    if (machine ? h.type !== 'laundry-bench' : !HOST_TYPES.includes(h.type)) continue;
    const hf = frameOf(h);
    const l = hf.toLocal(sf.cx, sf.cz);
    if (Math.abs(l.x) > h.dims.w / 2 + 0.02 || Math.abs(l.z) > h.dims.d / 2 + 0.05) continue;
    // the entry's extent along the host (a symbol may be drawn turned)
    const dy = (s.rotationDeg ?? 0) * DEG - hf.yaw;
    const ext = Math.abs(s.dims.w * Math.cos(dy)) + Math.abs(s.dims.d * Math.sin(dy));
    return { host: h, x0: Math.max(-h.dims.w / 2, l.x - ext / 2), x1: Math.min(h.dims.w / 2, l.x + ext / 2), z: l.z, machine };
  }
  return null;
}

/** rooms[].wallTiles as a list of specs: true → [{}], an object → [it], a list → its objects. */
export function tileSpecs(v) {
  if (v === true) return [{}];
  if (isObj(v)) return [v];
  if (Array.isArray(v)) return v.filter(isObj);
  return [];
}

/** [u0, u1] of an entry's width along a wall (its footprint projected on the wall's line). */
function spanOnWall(b, w) {
  const f = frameOf(b);
  const half = b.dims.w / 2;
  const a = f.toWorld(-half, 0), c = f.toWorld(half, 0);
  const u = (p) => (p.x - w.start.x) * w.dir.x + (p.z - w.start.y) * w.dir.y;
  const ua = u(a), uc = u(c);
  return [Math.min(ua, uc), Math.max(ua, uc)];
}

// ---------------------------------------------------------------------------------------------------------------
// Showers

// the footprint's sides in loop order (N → W → S → E), each from corner to corner: N = −x, W = +z, S = +x, E = −z
const SIDES = [
  { key: 'N', name: 'north', at: (f) => [[f.minX, f.minZ], [f.minX, f.maxZ]], n: [1, 0] },
  { key: 'W', name: 'west', at: (f) => [[f.minX, f.maxZ], [f.maxX, f.maxZ]], n: [0, -1] },
  { key: 'S', name: 'south', at: (f) => [[f.maxX, f.maxZ], [f.maxX, f.minZ]], n: [-1, 0] },
  { key: 'E', name: 'east', at: (f) => [[f.maxX, f.minZ], [f.minX, f.minZ]], n: [0, 1] },
];

/**
 * The glass, set, corner and drain of a shower from the walls of its room (see the top of the file).
 * params.enclosure: 'glass' (default: glass walls on the open sides) | 'none' (dusj uten vegger: no glass, walk in);
 * params.door: 'auto' | 'sliding' | 'swing' | 'none'; params.drain: true (default: a square drain in the middle) |
 * 'linear' (a channel along the wall with the set) | false. A drain entry inside the footprint counts as its drain.
 */
function autoShower(b, room, wallsById, all) {
  const P = b.params || {};
  const fp = footprintOf(b);
  const walls = (room.wallIds || []).map((id) => wallsById[id]).filter(Boolean);
  const sides = SIDES.map((S) => {
    const [a, c] = S.at(fp);
    const len = Math.hypot(c[0] - a[0], c[1] - a[1]);
    // a wall face along this side, facing into the shower, covering at least half of it
    let best = null;
    for (const w of walls) {
      if (Math.abs(w.normal.x - S.n[0]) > 0.05 || Math.abs(w.normal.y - S.n[1]) > 0.05) continue;
      const off = (a[0] - w.start.x) * w.normal.x + (a[1] - w.start.y) * w.normal.y; // the side in front of the face
      if (Math.abs(off) > 0.08) continue;
      const u = (p) => (p[0] - w.start.x) * w.dir.x + (p[1] - w.start.y) * w.dir.y;
      const ua = u(a), uc = u(c);
      const lo = Math.max(0, Math.min(ua, uc)), hi = Math.min(w.length, Math.max(ua, uc));
      if (hi - lo < len * 0.5) continue;
      if (!best || hi - lo > best.hi - best.lo) best = { wall: w, lo, hi };
    }
    return { ...S, a, c, len, wall: best?.wall ?? null, u0: best?.lo ?? 0, u1: best?.hi ?? 0 };
  });
  const walled = sides.filter((s) => s.wall);
  const none = P.enclosure === 'none' || !walled.length;
  // the corner against the walls (pentagon outline, U-profiles): N/S from a wall at minX/maxX, E/W at minZ/maxZ
  const ns = sides[0].wall ? 'N' : sides[2].wall ? 'S' : 'N';
  const ew = sides[3].wall ? 'E' : sides[1].wall ? 'W' : 'E';
  const params = { corner: ns + ew, shape: P.shape === 'pentagon' ? 'pentagon' : 'rect' };
  if (none) params.enclosure = 'none';
  else if (params.shape === 'rect') {
    // the open sides as one chain from a wall, in loop order
    const start = sides.findIndex((s, i) => s.wall && !sides[(i + 1) % 4].wall);
    const chain = [];
    for (let k = 1; k <= 4 && start >= 0; k++) {
      const s = sides[(start + k) % 4];
      if (s.wall) break;
      chain.push(s);
    }
    const doorSide = P.door === 'none' ? null : chain.reduce((m, s) => (!m || s.len > m.len + 0.01 ? s : m), null);
    params.glass = chain.map((s) => {
      let panels = [{ kind: 'fixed' }];
      if (s === doorSide && s.len >= 0.6) {
        const sliding = P.door === 'sliding' || (P.door !== 'swing' && s.len >= 1.1);
        panels = sliding ? [{ kind: 'fixed' }, { kind: 'sliding', handle: 'bar' }] : [{ kind: 'swing', hinge: 'a', handle: 'bar' }];
      }
      return { side: s.name, line: [s.a, s.c], panels };
    });
  }
  // the set on the longest walled side (a tie: the first in N, W, S, E order), in its middle
  const setSide = walled.reduce((m, s) => (!m || s.u1 - s.u0 > m.u1 - m.u0 + 0.01 ? s : m), null);
  if (setSide && P.set == null) params.set = { wall: setSide.wall.id, at: [(setSide.a[0] + setSide.c[0]) / 2, (setSide.a[1] + setSide.c[1]) / 2] };
  // the drain: an entry inside, else one of our own
  let drain = null;
  const inside = all.some((d) => {
    if (d.type !== 'floor-drain' || d.roomId !== b.roomId || !d.position) return false;
    const x = d.position.isVector3 ? d.position.x : d.position[0], z = d.position.isVector3 ? d.position.z : d.position[2];
    return x > fp.minX - 0.02 && x < fp.maxX + 0.02 && z > fp.minZ - 0.02 && z < fp.maxZ + 0.02;
  });
  if (!inside && P.drain !== false) {
    const linear = P.drain === 'linear' && setSide;
    const cx = (fp.minX + fp.maxX) / 2, cz = (fp.minZ + fp.maxZ) / 2;
    let at = [cx, cz], rot = 0, dims = { w: 0.15, d: 0.15, h: 0.005 };
    if (linear) {
      const along = Math.abs(setSide.n[0]) > 0.5 ? 'z' : 'x';
      at = [(setSide.a[0] + setSide.c[0]) / 2 + setSide.n[0] * 0.1, (setSide.a[1] + setSide.c[1]) / 2 + setSide.n[1] * 0.1];
      rot = along === 'z' ? 90 : 0; // local x along the channel
      dims = { w: Math.max(0.3, setSide.len - 0.2), d: 0.07, h: 0.005 };
    }
    const y = b.position.isVector3 ? b.position.y : b.position[1];
    const pos = b.position.clone ? b.position.clone().set(at[0], y, at[1]) : [at[0], y, at[1]];
    drain = {
      id: `${b.id}-sluk`, roomId: b.roomId, levelId: b.levelId, floorY: b.floorY, type: 'floor-drain', name: 'Sluk', mount: 'floor',
      position: pos, localPosition: [at[0], b.localPosition?.[1] ?? 0, at[1]], rotationDeg: rot, dims,
      params: { shape: linear ? 'linear' : 'square', finish: 'steel' }, collide: false, derivedFrom: b.id,
    };
  }
  return {
    params,
    collide: none ? false : undefined,
    sides: walled.map((s) => ({ wallId: s.wall.id, u0: s.u0, u1: s.u1 })),
    drain,
  };
}

function hexOr(v, fb) {
  return typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v : fb;
}
