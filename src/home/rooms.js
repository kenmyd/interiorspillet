import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { paint, mat, emissive } from './materials.js';
import { basis, MeshBatcher, prismX } from '../world/buildKit.js';
import {
  UP, wallMatrix, openingMatrix, groupGeometry, wallLayer, mergeNotches, profileAt, profileSlice, floorGeometry,
  ceilingGeometry, glassMaterial, frostedGlassMaterial, buildWindow, rectCells, FRAME_INSET,
} from './wallkit.js';
import { buildDoor } from './doors.js';
import { claddingMaterial, ledStrip } from './shell.js';
import { buildRoofs } from './roof.js';
import { surfaceProfile, planeY, CLADDING_INTO_ROOF } from './roofgeom.js';
import { wallFinish, floorFinish } from '../world/surfaces.js';

/**
 * ROOMS – every room of the house except the living room / kitchen / TV-stue (notes/hele-huset-design.md §2.1,
 * §2.3–2.8; hele-huset-avstemming.md V1–V70 overrides it), steps 8 + 21 + 24 (A2, A2′, C2):
 *   • the walls of each room loop at their floor (level floorY + room floorOffset), mitred per loop like the shell, with
 *     paint, the room's own skirting (rooms[].baseboard: a board, the bathroom's dark upstand, the laundry's upturn)
 *     and windows (frame, glass – frosted on the bathroom –, board, a lining when the reveal has its own colour; the
 *     fields, glazing bars and the floor out to the frame of a window on the floor – notes/vindusmodeller.md);
 *   • D13: a wall's back that is another room's face (`backOf`) is that face: the slab is cut at the faces' ends and
 *     each piece's back becomes a mesh with the face's id, paint and pick – nothing is built twice. A slab whose face
 *     has a lower floor (the entrance, bod-3: floorOffset −0.30) reaches down to it;
 *   • exterior walls get the outer layer of their facade segment (facadeSegments: cladding on the ground floor and the
 *     floors above, plaster on the basement), up under the roof on the ground floor (as the shell; with roofs –
 *     notes/tak.md – up into the house's own roof, else 0.3 over the wall), up to the cladding of the floor above where
 *     its facade stands on this one, and up to the slab underside under a ground-floor facade on the basement (no two
 *     layers in one plane);
 *   • the roofs (roof.js, layout.house.roofs): over their level, hidden with the ceilings; a ceiling under a roof is
 *     its surface (cut along the folds, with the vertical faces at a dormer's sides); a roof window under a roof lies in
 *     the roof plane;
 *   • a floor per room (oak shared with the living room / tinted for the basement, vinyl, concrete, parquet) with the
 *     stairwell cut out, the ceilings (the basement's with the hole; roof windows in ceilings[].skylights: hole, shaft
 *     and window), black ceiling trims, the white edge face on the
 *     free edges of the hole (V16), the stairwell walls (topProfile in the data), the ledge (V21) and its two corner
 *     fillers (the soffits under the overhangs and in the entrance niche are exterior.js's, steg 25);
 *   • the doors (doors.js: openAngleDeg, the storage doors closed but openable, the outer door opening outwards) with
 *     the walkable floor strip in each hole, the two entrance steps of 0.15 in the opening GANG ↔ entré (visible
 *     treads, an invisible wedge collides – §3.11);
 *   • the lamp fittings `plafond`, `downlight`, `led-strip` (dark – their light comes with L1, steg 13), returned in
 *     builtInLights → home.house.builtInLights;
 *   • static collision: the room surfaces, the slab box y −0.30 … 0 under the whole ground floor minus the hole (§2.8 –
 *     the floors are one-sided, a head from below would pass), ceiling boxes under the low ceilings (−0.50).
 * Not here: the stair (stairs.js), built-ins / bathroom (builtins.js), the lights themselves (lighting.js), the
 * terrain / forecourt / pillar (exterior.js), sockets and switches (fixtures).
 *
 *   buildRooms(ctx, layout, M) → { group, walls, windows, doors, pickables, builtInLights, colliders, update, setPaint, dispose }
 *
 * ctx     the createHome ctx (scene, collision, interaction, quality …). ctx.roots holds the scene roots of the house:
 *         ctx.roots.levels[levelId] and ctx.roots.rooms[roomId] = { id, name, levelId, kind, hud, group, surfaces,
 *         contents } – a room's walls / floor / ceilings / doors go in `surfaces`, its lamp fittings in `contents`.
 *         The returned `group` (scene root) holds only fallback room roots (no ctx.roots). ctx.lighting does not
 *         exist yet while building – Door.onChange reads it later.
 * layout  home/layout.js – the rooms built are layout.house.rooms without 'stue-kjokken' and without hud rooms.
 * M       the shell's shared materials (shell.materials: trim, reveal, baseboard, threshold, hallDoor, hardware,
 *         cladding, floorOak …). Read-only: never disposed here. Without M (Node tests) own fallbacks are made.
 */

const LIVING = 'stue-kjokken';
const EPS = 1e-4;
/** Look constants that are not measurements of a room. */
const LOOK = {
  back: '#ddd7cc',
  plaster: '#d9d6cf',
  cladding: '#4a4642',
  trim: '#2f2f31',
  frame: '#25272b',
  sill: '#e6e2da',
  edge: '#f2efe8',
  nosing: '#1a1a1a',
  led: '#ffd8a6',
};
/** Outer layer of a basement wall: this far below its floor (the ground outside is ≈ 0.4 lower, V33). */
const BASEMENT_FOOT = 0.6;
/** Outer layer of a ground-floor wall: down over the slab edge (as the shell's SLAB). */
const SLAB = 0.3;

const v2 = (x, y) => new THREE.Vector2(x, y);
const cross = (a, b) => a.x * b.y - a.y * b.x;
const sameHex = (a, b) => String(a || '').toLowerCase() === String(b || '').toLowerCase();

/** Point in polygon (Vector2[], even-odd; points on an edge count as inside). */
function inPoly(x, z, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if (segDist(x, z, a, b) < 1e-5) return true;
    if (a.y > z !== b.y > z && x < ((b.x - a.x) * (z - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
function segDist(x, z, a, b) {
  const dx = b.x - a.x, dz = b.y - a.y;
  const l2 = dx * dx + dz * dz;
  let t = l2 > 0 ? ((x - a.x) * dx + (z - a.y) * dz) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(a.x + dx * t - x, a.y + dz * t - z);
}
/** Strictly inside (the rim of a hole is still floor). */
function inPolyStrict(x, z, poly) {
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) if (segDist(x, z, poly[i], poly[j]) < 1e-5) return false;
  return inPoly(x, z, poly);
}
/** Holes side by side with the same height merged into one (the outer door between its sidelights). */
function mergeHoles(holes) {
  const out = [];
  for (const h of [...holes].sort((a, b) => a.x0 - b.x0)) {
    const p = out[out.length - 1];
    if (p && h.x0 <= p.x1 + 1e-4 && Math.abs(h.y0 - p.y0) < 1e-4 && Math.abs(h.y1 - p.y1) < 1e-4) p.x1 = Math.max(p.x1, h.x1);
    else out.push({ ...h });
  }
  return out;
}

/** Does segment a–b lie on the boundary of poly (both ends and the middle on one edge)? */
function onBoundary(a, b, poly) {
  const m = v2((a.x + b.x) / 2, (a.y + b.y) / 2);
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    if (segDist(a.x, a.y, poly[i], poly[j]) < 1e-3 && segDist(b.x, b.y, poly[i], poly[j]) < 1e-3 && segDist(m.x, m.y, poly[i], poly[j]) < 1e-3) return true;
  }
  return false;
}

/**
 * Builds the rooms (see the top of this file).
 * @param {object} ctx
 * @param {object} layout
 * @param {object|null} [M]
 */
export function buildRooms(ctx, layout, M = null) {
  const group = new THREE.Group();
  group.name = 'rooms';
  const H = layout?.house;
  const rooms = (H?.rooms || []).filter((r) => r.id !== LIVING && !r.hud && r.polygon?.length >= 3);
  const walls = [];
  const windows = [];
  const doors = [];
  const pickables = { floor: [], walls: [], ceilings: [], windows: [] };
  const builtInLights = [];
  const colliders = [];
  const owned = []; // geometries + own materials to dispose (never M's, never the cached ones of materials.js)
  const batchers = [];
  const keep = (x) => (owned.push(x), x);
  const contract = (extra = {}) => ({
    group, walls, windows, doors, pickables, builtInLights, colliders,
    update(dt, state) {
      for (const d of doors) d.door?.update(dt, state);
    },
    setPaint() {},
    dispose() {
      for (const d of doors) d.door?.dispose();
      group.removeFromParent();
      for (const r of Object.values(roots)) r.removeFromParent();
      for (const b of batchers) for (const g of b.geometries || []) g.dispose();
      for (const o of owned) o.dispose?.();
    },
    ...extra,
  });
  const roots = {}; // what this builder put into ctx.roots (taken out on dispose)
  if (!rooms.length) return contract();

  const quality = ctx?.quality || {};
  const finishRes = quality.level === 'low' ? 0.5 : 1;
  const roomIds = new Set(rooms.map((r) => r.id));
  const spec = layout.spec || {};
  const rawWall = new Map((spec.walls || []).map((w) => [w.id, w]));
  const rawRoom = new Map((spec.rooms || []).map((r) => [r.id, r]));
  const rawOpening = new Map();
  for (const w of spec.walls || []) for (const o of w.openings || []) rawOpening.set(o.id, o);
  for (const p of spec.wallOpenings || []) for (const o of p.openings || []) if (!rawOpening.has(o.id)) rawOpening.set(o.id, o);

  // ---- materials (the shell's where it has them, so the rooms share its programs; own fallbacks for Node tests)
  const fb = {};
  const K = new Proxy(M || {}, {
    get(target, key) {
      if (target[key]) return target[key];
      if (fb[key]) return fb[key];
      const make = FALLBACK[key];
      if (!make) return undefined;
      fb[key] = make();
      return fb[key];
    },
  });
  const FALLBACK = {
    reveal: () => paint('sand'),
    back: () => paint(LOOK.back),
    trim: () => mat('painted', LOOK.trim, { roughness: 0.6 }),
    frame: () => mat('black-metal', LOOK.frame, { roughness: 0.42 }),
    gasket: () => mat('plastic', '#0b0b0c', { roughness: 0.75, flat: true }),
    sill: () => paint(LOOK.sill, { roughness: 0.42 }),
    baseboard: () => paint('#e9e6df', { roughness: 0.48 }),
    threshold: () => mat('oak', '#cdbfae', { roughness: 0.55 }),
    hallDoor: () => mat('painted', '#1d1e21', { roughness: 0.4 }),
    hallDoorGroove: () => mat('painted', '#0e0f10', { roughness: 0.85, flat: true }),
    hardware: () => mat('black-metal', '#1a1a1a', { roughness: 0.35 }),
    alu: () => mat('painted', '#cfcfcc', { roughness: 0.32, metalness: 0.45 }),
    glass: () => glassMaterial(),
    cladding: () => cladding(LOOK.cladding),
  };
  const claddings = new Map();
  /** Dark vertical board cladding in a colour (the shell's for #4a4642). */
  function cladding(hex) {
    if (sameHex(hex, LOOK.cladding) && M?.cladding) return M.cladding;
    if (!claddings.has(hex)) {
      let m;
      try {
        m = claddingMaterial(hex, quality, { roughness: 0.88 });
      } catch {
        m = mat('painted', hex, { roughness: 0.88 }); // no canvas (Node)
      }
      if (!m.userData?.cached) owned.push(m);
      claddings.set(hex, m);
    }
    return claddings.get(hex);
  }
  const plaster = (hex) => mat('painted', hex || LOOK.plaster, { roughness: 0.95 });
  const tintedFloors = new Map();
  /** Floor material of a room's floor entry. */
  function floorMaterial(floor) {
    const f = floor || {};
    const color = f.color || '#a59b8f';
    const kind = f.material || 'oak-plank';
    if (kind === 'oak-plank') {
      if (!M?.floorOak) return mat('white-oak', color, { roughness: 0.7 });
      if (sameHex(color, M.floorOakColor)) return M.floorOak;
      if (!tintedFloors.has(color)) {
        // the living room's oak (same textures) tinted to the wanted mean albedo
        const m = M.floorOak.clone();
        const want = new THREE.Color(color), base = new THREE.Color(M.floorOakColor || '#a59b8f');
        m.color.setRGB(m.color.r * (want.r / base.r), m.color.g * (want.g / base.g), m.color.b * (want.b / base.b));
        m.name = `floor-oak ${color}`;
        owned.push(m);
        tintedFloors.set(color, m);
      }
      return tintedFloors.get(color);
    }
    if (kind === 'vinyl') {
      // the wet-room vinyl of steg 10 (A4: surfaces.floorFinish – bathroom, laundry); paint without texture support
      let fin = null;
      try {
        fin = floorFinish(f, { res: finishRes });
      } catch {
        fin = null;
      }
      return fin ?? paint(color, { roughness: 0.5 });
    }
    if (kind === 'concrete') return paint(color, { roughness: 0.88 });
    if (kind === 'parquet') return mat('oak', color, { roughness: 0.5 });
    return paint(color);
  }
  const footstepOf = (floor) => floor?.surface ?? (floor?.material === 'vinyl' ? 'tile' : floor?.material === 'concrete' ? 'concrete' : null);

  // ---- scene roots per room: surfaces → solid (collision) + deco (no collision); contents (lamps)
  const R = {};
  for (const r of rooms) {
    let root = ctx?.roots?.rooms?.[r.id];
    if (!root) {
      const g = new THREE.Group();
      g.name = `room:${r.id}`;
      const surfaces = new THREE.Group();
      surfaces.name = `room:${r.id}:surfaces`;
      const contents = new THREE.Group();
      contents.name = `room:${r.id}:contents`;
      g.add(surfaces, contents);
      group.add(g);
      root = { group: g, surfaces, contents };
    }
    const solid = new THREE.Group();
    solid.name = `room:${r.id}:solid`;
    const deco = new THREE.Group();
    deco.name = `room:${r.id}:deco`;
    deco.userData.noCollide = true;
    root.surfaces.add(solid, deco);
    const lamps = new THREE.Group();
    lamps.name = `room:${r.id}:lamps`;
    lamps.userData.noCollide = true;
    root.contents.add(lamps);
    roots[`${r.id}:solid`] = solid;
    roots[`${r.id}:deco`] = deco;
    roots[`${r.id}:lamps`] = lamps;
    const batch = (name) => {
      const b = new MeshBatcher(`${name}:${r.id}`);
      batchers.push(b);
      return b;
    };
    R[r.id] = { room: r, solid, deco, lamps, walls: batch('room-walls'), trims: batch('room-trims'), fittings: batch('room-fittings'), outside: batch('room-outside') };
    colliders.push(solid);
  }
  const roomOf = (id) => R[id] ?? null;
  /** roomId → the floor strips in the reveals of its windows on the floor ([4 Vector3] each, filled by buildRoomWindow) */
  const revealFloors = new Map();

  // ---- the ground floor's roof line (the shell's formula: the outer cladding of a ground-floor wall reaches under it).
  //      A house with roofs (notes/tak.md) uses them instead; a house with neither (no sloping living-room ceiling)
  //      lets the cladding end 0.3 over the wall (planbygger request 4).
  const ceilingSlope = (layout.ceilings || []).find((c) => c.type === 'slope');
  const slope = ceilingSlope?.slope ?? 0.16216;
  const highX = ceilingSlope ? ceilingSlope.polygon.reduce((m, p) => Math.min(m, p.x), Infinity) : 3.22;
  const highH = ceilingSlope?.highHeight ?? 3.0;
  const roofUnder = (x) => Math.min(highH, highH - slope * (x - highX)) + 0.3;
  const legacyRoofLine = !!ceilingSlope && !H.roofs?.length;
  const mainId = H.levels.find((l) => l.id === 'hoved')?.id ?? H.levels[0]?.id;
  const mainFloorY = H.levelsById[mainId]?.floorY ?? 0;
  /**
   * The top of a wall's outer layer under its level's roof (notes/tak.md): the roof's inner plane at the wall's outer
   * face + CLADDING_INTO_ROOF, [[u, y], …] over the whole wall; where no roof is over it, the wall's top + 0.3. null
   * without a roof on the level.
   */
  function roofCladdingTop(w) {
    const field = H.roofFieldOf?.(w.levelId);
    if (!field) return null;
    const t = w.thickness;
    const prof = surfaceProfile([w.start.x, w.start.y], [w.end.x, w.end.y], [{ planeAt: field.planeAt, lines: field.lines, shift: [-w.normal.x * t, -w.normal.y * t] }], w.floorY, -Infinity);
    return prof.map(([u, y]) => [u, y === -Infinity ? profileAt(w.topProfile, u) + 0.3 : y + CLADDING_INTO_ROOF]);
  }
  /** A top profile set to y inside the ranges (steps at their ends): the cladding up to the facade above. */
  function fillProfile(profile, ranges, y, x0, x1) {
    if (!ranges.length) return profile;
    const cuts = new Set([x0, x1]);
    for (const p of profile) cuts.add(p[0]);
    for (const [a, b] of ranges) {
      if (a > x0 && a < x1) cuts.add(a);
      if (b > x0 && b < x1) cuts.add(b);
    }
    const us = [...cuts].sort((a, b) => a - b);
    const inside = (u) => ranges.some(([a, b]) => u > a - EPS && u < b + EPS);
    const out = [];
    for (let i = 0; i < us.length - 1; i++) {
      const a = us[i], b = us[i + 1];
      if (b - a < 1e-6) continue;
      const fill = inside((a + b) / 2);
      out.push([a, fill ? y : profileAt(profile, a + 1e-6)], [b, fill ? y : profileAt(profile, b - 1e-6)]);
    }
    return out;
  }

  // ---- facades of the exterior walls (facadeSegments)
  const facadeOf = new Map();
  for (const f of spec.facadeSegments || []) for (const id of f.wallIds || []) facadeOf.set(id, f);
  /** Material of a wall's outer layer: cladding on the main floor and the floors above it, plaster on the basement. */
  function facadeMaterial(w) {
    const f = facadeOf.get(w.id);
    const kind = f?.material ?? (w.levelId === mainId || w.floorY > mainFloorY + 0.5 ? 'cladding' : 'plaster');
    if (kind === 'cladding') return cladding(f?.color ?? LOOK.cladding);
    return plaster(f?.color ?? LOOK.plaster);
  }

  // ---- helpers on walls
  const uOn = (w, p) => (p.x - w.start.x) * w.dir.x + (p.y - w.start.y) * w.dir.y;
  const offOn = (w, p) => (p.x - w.start.x) * w.normal.x + (p.y - w.start.y) * w.normal.y;
  function mitre(w) {
    const prev = H.wallsById[w.prevId];
    const next = H.wallsById[w.nextId];
    let kStart = 0;
    let kEnd = 0;
    if (prev && prev.end.distanceTo(w.start) < 1e-3) {
      const c = cross(prev.dir, w.dir);
      kStart = Math.abs(c) < 1e-6 ? 0 : (c > 0 ? 1 : -1) * (prev.thickness / w.thickness);
    }
    if (next && w.end.distanceTo(next.start) < 1e-3) {
      const c = cross(w.dir, next.dir);
      kEnd = Math.abs(c) < 1e-6 ? 0 : (c > 0 ? 1 : -1) * (next.thickness / w.thickness);
    }
    return { kStart, kEnd };
  }
  /** The u-range of wall b's room face on wall a's line (null when not on it). */
  function rangeOn(a, b, offset = 0) {
    const ua = uOn(a, b.start), ub = uOn(a, b.end);
    if (Math.abs(offOn(a, b.start) - offset) > 0.02 || Math.abs(offOn(a, b.end) - offset) > 0.02) return null;
    return [Math.min(ua, ub), Math.max(ua, ub)];
  }
  const overlaps = (r, a, b) => r && r[1] > a + 1e-3 && r[0] < b - 1e-3;
  /**
   * Stairwell: a ground-floor wall whose face runs along a hole edge goes down to the slab underside – unless a wall of
   * the level below stands in the same plane there (the shaft walls go up to the floor themselves, topProfile).
   */
  function holeDrop(w) {
    const lv = H.levelsById[w.levelId];
    const below = lv?.belowId;
    if (!below) return 0;
    let touches = false;
    for (const fo of H.floorOpenings) {
      if (fo.levelId !== w.levelId) continue;
      const P = fo.polygon;
      for (let i = 0; i < P.length; i++) {
        const a = P[i], b = P[(i + 1) % P.length];
        if (Math.abs(offOn(w, a)) < 0.01 && Math.abs(offOn(w, b)) < 0.01) {
          const ua = uOn(w, a), ub = uOn(w, b);
          if (Math.max(ua, ub) > EPS && Math.min(ua, ub) < w.length - EPS) touches = true;
        }
      }
    }
    if (!touches) return 0;
    const coplanar = H.walls.some((o) => o.levelId === below && o.normal.dot(w.normal) > 0.99 && overlaps(rangeOn(w, o), 0, w.length));
    return coplanar ? 0 : lv.bottomY - lv.floorY;
  }
  /**
   * u-ranges of a basement wall's outer plane that a ground-floor exterior wall's outer layer covers (its cladding goes
   * down to the slab underside there): the basement's outer layer stops at the slab underside in them.
   */
  function underFacade(w) {
    const lv = H.levelsById[w.levelId];
    if (!lv?.aboveId) return [];
    const out = [];
    for (const o of H.walls) {
      if (o.levelId !== lv.aboveId || !o.exterior || o.thickness < 0.2) continue;
      if (o.normal.dot(w.normal) < 0.99) continue;
      // their outer plane (offOn − thickness) against w's (−w.thickness): the same plane → 0
      const shift = offOn(w, o.start) - o.thickness + w.thickness;
      if (Math.abs(shift) > 0.02) continue;
      const ua = uOn(w, o.start), ub = uOn(w, o.end);
      const a = Math.min(ua, ub) - o.thickness, b = Math.max(ua, ub) + o.thickness; // with their mitres
      if (b > -w.thickness && a < w.length + w.thickness) out.push([a, b]);
    }
    return out;
  }
  /** A top profile capped at yMax inside the ranges (steps at their ends). */
  function capProfile(profile, ranges, yMax, x0, x1) {
    if (!ranges.length) return profile;
    const cuts = new Set([x0, x1]);
    for (const p of profile) cuts.add(p[0]);
    for (const [a, b] of ranges) {
      if (a > x0 && a < x1) cuts.add(a);
      if (b > x0 && b < x1) cuts.add(b);
    }
    const us = [...cuts].sort((a, b) => a - b);
    const capped = (u) => ranges.some(([a, b]) => u > a - EPS && u < b + EPS);
    const out = [];
    for (let i = 0; i < us.length - 1; i++) {
      const a = us[i], b = us[i + 1];
      if (b - a < 1e-6) continue;
      const mid = (a + b) / 2;
      const cap = capped(mid);
      const ha = profileAt(profile, a + 1e-6), hb = profileAt(profile, b - 1e-6);
      out.push([a, cap ? Math.min(ha, yMax) : ha], [b, cap ? Math.min(hb, yMax) : hb]);
    }
    return out;
  }

  // ---- walls
  const wallFaceMeshes = new Map(); // wallId → [mesh] (own slabs' room faces and the backOf faces' pieces)
  const faceGeos = new Map(); // backOf face id → [geometry pieces] (merged into one mesh per face below)
  const paintOf = (w) => w.paint ?? 'sand';
  // the textured finishes of steg 10 (A4: stone panels, tiles …) for walls whose material is not paint; the painted
  // kinds ('paint', 'wetroom-paint') get paint() as before. The panel / clouds come from the raw data (layout's wall
  // does not carry them). A repaint keeps the finish in the new colour (wallFinish(wall, hex) ?? paint(hex)).
  const wallMat = (w, color) => {
    const hex = color ? layout.resolvePaint?.(color) ?? color : undefined;
    const raw = rawWall.get(w.id);
    let m = null;
    try {
      m = wallFinish({ ...w, panel: raw?.panel ?? w.panel, clouds: raw?.clouds ?? w.clouds }, hex, { res: finishRes });
    } catch {
      m = null; // no texture support (Node fixtures): paint
    }
    return m ?? paint(color || paintOf(w));
  };
  for (const w of H.walls) {
    if (!roomIds.has(w.roomId) || w.backOf || !(w.thickness > 0)) continue;
    const rr = roomOf(w.roomId);
    const L = w.length;
    const t = w.thickness;
    const { kStart, kEnd } = mitre(w);
    const exterior = w.exterior && t >= 0.2;
    const rd = exterior ? Math.min(t - 0.05, Math.max(0.2, ...w.openings.map((o) => o.revealDepth || 0))) : t;
    const faces = H.backFacesOf(w.id).map((id) => H.wallsById[id]).filter(Boolean);
    // the slab reaches down to the lowest floor of its faces (the entrance, bod-3) and into the stairwell
    let bottom = Math.min(0, ...faces.map((f) => f.floorY - w.floorY));
    bottom = Math.min(bottom, holeDrop(w));
    // an inner wall that reaches the floor of the level above (the stairwell walls: topProfile up to y 0) stops 2 mm
    // under that floor – its top face was coplanar with the floor above where it runs under it (floor:soverom over
    // w-kg-vest at z 4.53–4.55 flickered in front of the skirting). Integrator, bølge 1 gruppe 2.
    const lvTop = H.levelsById[w.levelId];
    // (an inner wall under its level's own roof – notes/tak.md – is not under the floor above: it reaches the roof)
    const underRoof = !!H.roofFieldOf?.(w.levelId)?.planeAt((w.start.x + w.end.x) / 2, (w.start.y + w.end.y) / 2);
    const aboveTop = lvTop?.aboveId && !w.exterior && !underRoof ? H.levelsById[lvTop.aboveId].floorY - w.floorY - 0.002 : Infinity;
    const top = w.topProfile.map(([u, h]) => [u, Math.min(h, aboveTop)]);
    const notchesAll = [];
    const holesAll = [];
    const outerAll = [];
    for (const o of w.openings) {
      const y0 = o.sill - (o.sillBoard ? o.sillBoard.thickness ?? 0.025 : 0);
      if (o.sill <= EPS) notchesAll.push({ x0: o.u0, x1: o.u1, y1: o.top });
      else holesAll.push({ x0: o.u0, x1: o.u1, y0, y1: o.top });
      outerAll.push({ x0: o.u0, x1: o.u1, y0: Math.max(o.sill <= EPS ? bottom : 0, y0), y1: o.top, door: o.sill <= EPS });
    }
    const notches = mergeNotches(notchesAll);
    // pieces: cut at the ends of the faces on the back (never inside an opening)
    const faceRanges = faces.map((f) => ({ f, r: [Math.min(uOn(w, f.start), uOn(w, f.end)), Math.max(uOn(w, f.start), uOn(w, f.end))] }));
    const cuts = new Set();
    const snap = (u) => {
      for (const o of w.openings) if (u > o.u0 - 0.01 && u < o.u1 + 0.01) return u - o.u0 < o.u1 - u ? o.u0 - 0.01 : o.u1 + 0.01;
      return u;
    };
    for (const { r } of faceRanges) for (const u of r) if (u > 0.02 && u < L - 0.02) cuts.add(Math.round(snap(u) * 1e4) / 1e4);
    const us = [0, ...[...cuts].filter((u) => u > 0.01 && u < L - 0.01).sort((a, b) => a - b), L];
    const faceAt = (u) => faceRanges.find(({ r }) => u > r[0] - 1e-3 && u < r[1] + 1e-3)?.f ?? null;
    const M4 = wallMatrix(w, w.floorY);
    const roomFace = [];
    const sideMat = paint(paintOf(w));
    const facade = exterior ? facadeMaterial(w) : null;
    const isMain = w.levelId === mainId;
    const lv = H.levelsById[w.levelId];
    const upper = !isMain && (lv?.floorY ?? 0) > mainFloorY + 0.5;
    // the u-ranges under a facade of the level above: the basement's outer layer stops at the slab underside there; on
    // the main level and up the cladding runs on up to it (where the cladding of the level above begins)
    const capRanges = exterior ? underFacade(w) : [];
    const capY = lv?.aboveId ? H.levelsById[lv.aboveId].bottomY - w.floorY : Infinity;
    const roofTop = exterior ? roofCladdingTop(w) : null;
    for (let i = 0; i < us.length - 1; i++) {
      const a = us[i], b = us[i + 1];
      if (b - a < 1e-3) continue;
      const kS = i === 0 ? kStart : 0;
      const kE = i === us.length - 2 ? kEnd : 0;
      const inPiece = (n) => n.x1 > a + EPS && n.x0 < b - EPS;
      const clip = (n) => ({ ...n, x0: Math.max(n.x0, a) - a, x1: Math.min(n.x1, b) - a });
      const pTop = profileSlice(top, a, b);
      const pNotches = notches.filter(inPiece).map(clip);
      const pHoles = holesAll.filter((h) => h.x0 >= a - EPS && h.x1 <= b + EPS).map(clip);
      const T = new THREE.Matrix4().makeTranslation(a, 0, 0).premultiply(M4);
      const mid = (a + b) / 2;
      const face = faceAt(mid);
      // inner layer: the room face + the reveals (+ the back of an interior wall)
      const gIn = wallLayer({ L: b - a, bottom, top: pTop, notches: pNotches, holes: pHoles, z0: -rd, z1: 0, kStart: kS, kEnd: kE });
      gIn.applyMatrix4(T);
      const front = groupGeometry(gIn, 1);
      const sides = groupGeometry(gIn, 2);
      const back = groupGeometry(gIn, 0);
      gIn.dispose();
      if (front) roomFace.push(front);
      if (sides) rr.walls.add(sides, sideMat);
      sides?.dispose();
      if (back && !exterior) {
        if (face) (faceGeos.get(face.id) ?? faceGeos.set(face.id, []).get(face.id)).push(back);
        else {
          rr.walls.add(back, K.back);
          back.dispose();
        }
      } else back?.dispose();
      if (exterior) {
        // outer layer: the facade (or a face of another room, the pillar in the entrance), dark trim in the reveals
        let oTop;
        let oBottom;
        if (isMain || upper) {
          if (roofTop) oTop = profileSlice(roofTop, a, b);
          else if (upper) oTop = pTop;
          else if (legacyRoofLine) {
            const xs = [0, b - a];
            if (Math.abs(w.dir.x) > 1e-3) {
              const uHigh = (highX - w.start.x) / w.dir.x - a;
              if (uHigh > 0 && uHigh < b - a) xs.push(uHigh);
            }
            xs.sort((p, q) => p - q);
            oTop = xs.map((u) => {
              const p = w.pointAt(u + a).addScaledVector(w.normal3, -t);
              return [u, Math.max(profileAt(top, u + a) + 0.25, roofUnder(p.x) + 0.05)];
            });
          } else oTop = pTop.map(([u, y]) => [u, y + 0.3]);
          // up to the cladding of the level above, where its facade stands on this one
          oTop = fillProfile(oTop, capRanges.map(([p, q]) => [p - a, q - a]), capY, 0, b - a);
          // the main floor's cladding goes down over the slab edge; a level above it meets the cladding below at its slab
          oBottom = upper ? (face ? bottom : Math.min(bottom, -(lv.slabThickness ?? SLAB))) : Math.min(bottom, -SLAB);
        } else {
          oTop = capProfile(pTop, capRanges.map(([p, q]) => [p - a, q - a]), capY, 0, b - a);
          oBottom = face ? bottom : Math.min(bottom, -BASEMENT_FOOT);
        }
        // the outer layer reaches below the floor: a door is a hole in it from the floor up (as in the shell), so the
        // facade stays closed under the threshold; only a layer that starts at the floor gets a notch
        const asHole = (h) => !h.door || oBottom < -EPS;
        const oHoles = mergeHoles(outerAll.filter((h) => asHole(h) && h.x0 >= a - EPS && h.x1 <= b + EPS).map((h) => clip({ ...h, y0: h.door ? 0 : h.y0 })));
        const oNotches = mergeNotches(outerAll.filter((h) => !asHole(h) && inPiece(h)).map((h) => ({ x0: h.x0, x1: h.x1, y1: h.y1 }))).map(clip);
        const gOut = wallLayer({ L: b - a, bottom: oBottom, top: oTop, notches: oNotches, holes: oHoles, z0: -t, z1: -rd, kStart: kS, kEnd: kE });
        gOut.applyMatrix4(T);
        const clad = groupGeometry(gOut, 0);
        const trim = groupGeometry(gOut, 2);
        gOut.dispose();
        if (clad) {
          if (face) (faceGeos.get(face.id) ?? faceGeos.set(face.id, []).get(face.id)).push(clad);
          else {
            rr.outside.add(clad, facade);
            clad.dispose();
          }
        }
        if (trim) rr.outside.add(trim, K.trim);
        trim?.dispose();
      }
    }
    const faceGeo = roomFace.length ? mergeGeometries(roomFace, false) : null;
    for (const g of roomFace) g.dispose();
    const meshes = [];
    if (faceGeo) {
      const fm = new THREE.Mesh(keep(faceGeo), wallMat(w));
      fm.name = `wall:${w.id}`;
      fm.castShadow = true;
      fm.receiveShadow = true;
      fm.userData.pick = { kind: 'wall', wallId: w.id };
      rr.solid.add(fm);
      pickables.walls.push(fm);
      meshes.push(fm);
    }
    wallFaceMeshes.set(w.id, meshes);
    walls.push(wallInfo(w, meshes, rd));

    // windows of the wall
    for (const o of w.openings) {
      if (o.type !== 'window') continue;
      buildRoomWindow(w, o, rr);
    }
    // the ledge on top of the wall (V21) and its two corner fillers up to the floor above
    const ledge = rawWall.get(w.id)?.ledge;
    if (ledge && lv?.aboveId) {
      const depth = Math.max(0.02, (ledge.x?.[1] ?? 0.13) - (ledge.x?.[0] ?? 0));
      const y0 = ledge.top ?? w.height;
      const y1 = H.levelsById[lv.aboveId].floorY - w.floorY;
      if (y1 > y0 + 0.01) {
        const f = rr.walls.frame(M4);
        const lm = paint(ledge.color ?? paintOf(w));
        for (const u of [-0.05, L + 0.05]) f.box(0.1, y1 - y0, depth, u, (y0 + y1) / 2, -depth / 2, lm);
      }
    }
  }
  // the backOf faces: one mesh per face from its pieces (on this builder's slabs) + the living room's slab backs (shell)
  const shellFaceMeshes = new Map();
  ctx?.roots?.shell?.traverse?.((o) => {
    if (o.isMesh && o.userData?.backOf && o.userData.pick?.wallId) {
      const id = o.userData.pick.wallId;
      if (!shellFaceMeshes.has(id)) shellFaceMeshes.set(id, []);
      shellFaceMeshes.get(id).push(o);
    }
  });
  for (const f of H.walls) {
    if (!roomIds.has(f.roomId) || !f.backOf) continue;
    const rr = roomOf(f.roomId);
    const meshes = [];
    const geos = faceGeos.get(f.id) || [];
    if (geos.length) {
      const g = mergeGeometries(geos, false);
      for (const x of geos) x.dispose();
      const fm = new THREE.Mesh(keep(g), wallMat(f));
      fm.name = `wall:${f.id}`;
      fm.castShadow = true;
      fm.receiveShadow = true;
      fm.userData.pick = { kind: 'wall', wallId: f.id };
      fm.userData.backOf = [...f.backOf];
      rr.solid.add(fm);
      pickables.walls.push(fm);
      meshes.push(fm);
    }
    wallFaceMeshes.set(f.id, meshes);
    walls.push(wallInfo(f, [...meshes, ...(shellFaceMeshes.get(f.id) || [])], 0));
  }

  function wallInfo(w, meshes, rd) {
    return {
      id: w.id,
      name: w.name,
      roomId: w.roomId,
      levelId: w.levelId,
      floorY: w.floorY,
      start: w.start.clone(),
      end: w.end.clone(),
      normal: w.normal.clone(),
      normal3: w.normal3.clone(),
      dir3: w.dir3.clone(),
      length: w.length,
      thickness: w.thickness,
      paint: w.paint,
      material: w.material,
      meshes,
      heightAt: w.heightAt,
      isHigh: false,
      exterior: w.exterior,
      revealDepth: rd,
      backOf: w.backOf ? [...w.backOf] : null,
    };
  }

  /** A window of a room wall: frame / sash / glass / board (wallkit), a lining in its reveal colour, the anchor. */
  function buildRoomWindow(w, o, rr) {
    // a reveal deeper than the wall leaves room for the frame (win-sk: reveal 0.38 (V63) in a 0.30 wall (V4) would put
    // the frame, the board and the lining 8–14 cm out of the facade; a window on the floor without reveal.depth got the
    // wall's thickness, the frame outside the facade – planbygger F6). Door elements (the sidelights) keep the door's depth.
    const element = !!rawOpening.get(o.id)?.element;
    const fdepth = o.frame?.depth ?? 0.07;
    const maxRd = w.thickness - fdepth - 0.005;
    if (!element && o.revealDepth > maxRd && maxRd > 0.02) {
      o = { ...o, revealDepth: maxRd, sillBoard: o.sillBoard ? { ...o.sillBoard, depth: Math.min(o.sillBoard.depth ?? maxRd, maxRd) } : o.sillBoard };
    }
    const sillHex = o.sillBoard?.color;
    const frameHex = o.frame?.color;
    const barsHex = o.bars?.color;
    const frameM = frameHex && !sameHex(frameHex, LOOK.frame) ? mat('black-metal', frameHex, { roughness: 0.42 }) : K.frame;
    const WM = {
      ...pickMats(),
      sill: sillHex ? paint(sillHex, { roughness: 0.42 }) : K.sill,
      frame: frameM,
      bars: barsHex && !sameHex(barsHex, frameHex || LOOK.frame) ? mat('black-metal', barsHex, { roughness: 0.42 }) : frameM,
      glass: o.frosted ? frostedGlassMaterial() : K.glass,
    };
    // a window on the floor: the room's floor runs out to the frame (planbygger F5, request 15) – a strip merged into
    // the room's floor mesh (its material and boards) where the floors are built
    const revealFloor = !element && (o.revealFloor ?? !o.sillBoard) && o.sill <= 0.005 && o.revealDepth > 0.005;
    if (revealFloor) {
      const m = openingMatrix(o, w.floorY);
      const hw = o.width / 2;
      const pts = [[-hw, 0], [hw, 0], [hw, -o.revealDepth], [-hw, -o.revealDepth]].map(([x, z]) => new THREE.Vector3(x, 0, z).applyMatrix4(m));
      (revealFloors.get(o.roomId) ?? revealFloors.set(o.roomId, []).get(o.roomId)).push(pts);
    }
    const win = buildWindow(o, false, { M: WM, exteriorBatch: rr.outside, batchers, keep });
    win.group.userData.pick = { kind: 'window', windowId: o.id };
    rr.deco.add(win.group);
    for (const m of win.pickMeshes) pickables.windows.push(m);
    if (win.glass) {
      rr.solid.add(win.glass); // glass blocks the player
      pickables.windows.push(win.glass);
    }
    // the reveal in its own colour (the basement's black niches, the outer door's lining): a 4 mm lining inside the hole
    const rev = o.reveal?.color;
    if (rev && !sameHex(layout.resolvePaint?.(rev) ?? rev, w.paintHex)) {
      const f = rr.trims.frame(openingMatrix(o));
      const lm = paint(rev, { roughness: 0.6 });
      const y0 = -(o.sillBoard ? o.sillBoard.thickness ?? 0.025 : 0);
      const W = o.width, Hh = o.height, d = o.revealDepth;
      const s = 0.004;
      f.box(s, Hh - y0, d, -W / 2 + s / 2, (y0 + Hh) / 2, -d / 2, lm, { collide: false });
      f.box(s, Hh - y0, d, W / 2 - s / 2, (y0 + Hh) / 2, -d / 2, lm, { collide: false });
      f.box(W - 2 * s, s, d, 0, Hh - s / 2, -d / 2, lm, { collide: false });
      if (!o.sillBoard && !revealFloor) f.box(W - 2 * s, s, d, 0, y0 + s / 2, -d / 2, lm, { collide: false });
    }
    const anchor = new THREE.Group();
    anchor.name = `window-anchor:${o.id}`;
    anchor.userData.noCollide = true;
    anchor.matrixAutoUpdate = false;
    anchor.matrix.copy(basis(o.right, UP, o.normal, o.topCenter));
    rr.deco.add(anchor);
    const raw = rawOpening.get(o.id) || {};
    windows.push({
      id: o.id,
      name: o.name,
      wallId: o.wallId,
      roomId: o.roomId,
      levelId: o.levelId,
      floorY: o.floorY,
      type: o.type,
      width: o.width,
      height: o.height,
      sill: o.sill,
      center: o.center.clone(),
      normal: o.normal.clone(),
      right: o.right.clone(),
      revealDepth: o.revealDepth,
      frameDepth: o.frame?.depth ?? 0.07,
      frameWidth: o.frame?.width ?? 0.07,
      opening: !!o.sashes?.some((s) => s.opening),
      frosted: !!o.frosted,
      existingShading: raw.existingShading ?? raw.blind ?? null,
      anchor,
      glass: win.glass ? [win.glass] : [],
      group: win.group,
      sillBoard: win.sillY != null ? { y: win.sillY, depth: (o.sillBoard?.depth ?? o.revealDepth) + (o.sillBoard?.overhang ?? 0.01) } : null,
    });
  }
  function pickMats() {
    return { frame: K.frame, gasket: K.gasket, hardware: K.hardware, threshold: K.threshold, sill: K.sill, trim: K.trim, glass: K.glass };
  }

  // ---- doors (doors.js) and the opening with steps (GANG ↔ entré)
  const doorDefs = new Map(H.doors.map((d) => [d.id, d]));
  const doorM = new Proxy({}, { get: (_, k) => K[k] });
  for (const w of H.walls) {
    if (!roomIds.has(w.roomId) || w.backOf) continue;
    const rr = roomOf(w.roomId);
    for (const o of w.openings) {
      const d = doorDefs.get(o.id);
      if (d) {
        const built = buildDoor(ctx, d, { layout, M: doorM, batch: rr.walls, batchers });
        rr.deco.add(built.door.root);
        colliders.push(...built.colliders);
        doors.push(built.info);
        continue;
      }
      if (o.type === 'opening') buildSteps(w, o, rr);
    }
  }

  /**
   * The steps in an opening between two floors (raw opening.steps: count, toRoom, nosing): the upper riser at the owner
   * room's face, (count − 1) treads across the wall's thickness, the last riser at the far face (V24: 2 × 0.15, the
   * middle tread fills the reveal). Visible parts do not collide; an invisible wedge over the steps does (§3.11).
   */
  function buildSteps(w, o, rr) {
    const st = rawOpening.get(o.id)?.steps;
    const to = st?.toRoom ? H.roomsById[st.toRoom] : null;
    if (!st || !to) return;
    const rise = w.floorY - to.floorY;
    const n = Math.max(1, st.count ?? 2);
    if (rise <= 0.02) return;
    const r = rise / n;
    const t = w.thickness;
    const W = o.width;
    const OM = openingMatrix(o); // origin: bottom centre on the owner face (owner floor), z into the owner room
    const f = rr.walls.frame(OM);
    const fm = floorMaterial(H.roomsById[w.roomId]?.floor);
    const nm = mat('black-metal', st.nosing?.color ?? LOOK.nosing, { roughness: 0.45 });
    const nd = st.nosing?.depth ?? 0.03;
    const treads = n - 1;
    const td = treads > 0 ? t / treads : t;
    // upper riser (below the owner floor's edge)
    f.box(W, r, 0.02, 0, -r / 2, 0.005, fm, { collide: false });
    // black nosing profiles: 2 mm proud of the tread (no shared plane with the floor), over the edge
    f.box(W, 0.012, nd, 0, -0.004, nd / 2 - 0.005, nm, { collide: false });
    for (let k = 1; k <= treads; k++) {
      const yTop = -k * r;
      const z1 = -(k - 1) * td, z0 = -k * td;
      const h = rise - k * r; // from the far floor up to this tread
      f.box(W, h, td, 0, yTop - h / 2, (z0 + z1) / 2, fm, { collide: false });
      f.box(W, 0.012, nd, 0, yTop - 0.004, z0 + nd / 2 - 0.005, nm, { collide: false });
    }
    // the wedge: from the owner floor's edge at the owner face to the far floor 0.13 beyond the far face. It must start
    // ON the owner floor: started inside the owner room (below its floor), the floor's edge would stand above the
    // wedge and stop the capsule on the way up like a wall
    const ext = 0.13;
    const zA = 0, zB = -t - ext;
    const prof = [[zA, 0], [zB, -rise], [zB, -rise - 0.03], [zA, -rise - 0.03]];
    const g = keep(prismX(prof, -W / 2 + 0.005, W / 2 - 0.005));
    g.applyMatrix4(OM);
    const wedge = new THREE.Mesh(g, K.back);
    wedge.name = `steps:${o.id}:wedge`;
    wedge.visible = false;
    wedge.castShadow = false;
    wedge.receiveShadow = false;
    rr.solid.add(wedge);
  }

  // ---- floors (+ footstep zones), ceilings (+ trims, roof windows), skirting
  const ceilingMeshes = new Map();
  const skylightLinings = []; // { ceilingId, mesh }: the shafts follow their ceiling's paint (setPaint)
  for (const r of rooms) {
    const rr = R[r.id];
    const holes = H.floorOpenings.filter((fo) => fo.levelId === r.levelId && fo.roomId === r.id).map((fo) => fo.polygon);
    const raw = rawRoom.get(r.id) || {};
    const floor = raw.floor ?? r.floor ?? {};
    const boards = floor.boards === 'x' ? 'x' : 'z';
    let fg = floorGeometry(r.polygon, r.floorY, { holes, boards });
    if (revealFloors.has(r.id)) fg = withRevealFloors(fg, revealFloors.get(r.id), boards);
    keep(fg);
    const fl = new THREE.Mesh(fg, floorMaterial(floor));
    fl.name = `floor:${r.id}`;
    fl.receiveShadow = true;
    fl.userData.pick = { kind: 'floor', roomId: r.id };
    rr.solid.add(fl);
    pickables.floor.push(fl);
    const surface = footstepOf(floor);
    if (surface && ctx?.collision?.addSurfaceZone) {
      const b = r.bounds;
      ctx.collision.addSurfaceZone(new THREE.Box3(new THREE.Vector3(b.minX, r.floorY - 0.2, b.minZ), new THREE.Vector3(b.maxX, r.floorY + 2.2, b.maxZ)), surface);
    }
    buildSkirting(r, raw.baseboard, holes);
  }
  for (const c of H.ceilings) {
    if (!roomIds.has(c.roomId)) continue;
    const rr = R[c.roomId];
    const sky = c.skylights || [];
    const g = keep(ceilingGeometry(c.polygon, (x, z) => c.topAt(x, z), sky.length ? [...(c.holes || []), ...sky.map((s) => s.polygon)] : c.holes || [], c.surface));
    const mesh = new THREE.Mesh(g, paint(c.paint));
    mesh.name = `ceiling:${c.id}`;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.pick = { kind: 'ceiling', ceilingId: c.id };
    mesh.userData.noCollide = true;
    rr.deco.add(mesh);
    pickables.ceilings.push(mesh);
    ceilingMeshes.set(c.id, mesh);
    const raw = (spec.ceilings || []).find((x) => x.id === c.id);
    if (c.trim) buildCeilingTrim(c, raw?.trimHeight ?? 0.035);
    for (const s of sky) buildSkylight(c, s, rr, mesh);
  }

  // ---- the roofs (notes/tak.md, roof.js): over their level, hidden with the ceilings; the roof windows cut through them
  if (H.roofs?.length) {
    const levelIds = new Set(rooms.map((r) => r.levelId));
    const skylights = [];
    for (const c of H.ceilings) for (const s of c.skylights || []) skylights.push({ id: s.id, levelId: c.levelId, polygon: s.polygon.map((p) => [p.x, p.y]) });
    const built = buildRoofs({ ...H, roofs: H.roofs.filter((p) => levelIds.has(p.levelId)) }, {
      roots: ctx?.roots?.levels,
      fallback: group,
      keep,
      batchers,
      quality,
      skylights,
      cladding: (levelId) => {
        const w = H.walls.find((x) => x.levelId === levelId && x.exterior && x.thickness >= 0.2 && roomIds.has(x.roomId));
        return w ? facadeMaterial(w) : cladding(LOOK.cladding);
      },
      lining: (levelId, x, z) => {
        const c = H.ceilings.find((k) => k.levelId === levelId && roomIds.has(k.roomId) && inPoly(x, z, k.polygon));
        return c ? { ceilingId: c.id, material: ceilingMeshes.get(c.id)?.material ?? paint(c.paint) } : null;
      },
      windowMaterials: () => pickMats(),
      exteriorBatch: (levelId, x, z) => {
        const r = rooms.find((k) => k.levelId === levelId && inPoly(x, z, k.polygon));
        return r ? R[r.id].outside : null;
      },
    });
    for (const m of built.meshes) {
      pickables.ceilings.push(m);
    }
    for (const l of built.linings) skylightLinings.push(l);
  }

  /** The floor geometry with the strips out to the frame of its windows on the floor (floorGeometry's UVs and normal). */
  function withRevealFloors(g, strips, boards) {
    const pos = [];
    for (const [a, b, c, d] of strips) {
      // facing up: (b − a) × (c − a) along +y, else the other winding
      const up = (b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z) > 0;
      for (const p of up ? [a, b, c, a, c, d] : [a, c, b, a, d, c]) pos.push(p.x, p.y, p.z);
    }
    const n = pos.length / 3;
    const uv = [];
    for (let i = 0; i < n; i++) {
      const x = pos[3 * i], z = pos[3 * i + 2];
      if (boards === 'x') uv.push(x, z);
      else uv.push(z, x);
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    sg.setAttribute('normal', new THREE.Float32BufferAttribute(Array.from({ length: n }, () => [0, 1, 0]).flat(), 3));
    sg.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    const base = g.index ? g.toNonIndexed() : g;
    const merged = mergeGeometries([base, sg], false);
    if (base !== g) base.dispose();
    g.dispose();
    sg.dispose();
    return merged ?? g;
  }

  /**
   * A roof window in a ceiling (ceilings[].skylights, notes/vindusmodeller.md): the hole (cut from the ceiling above), a
   * shaft lined in the ceiling's paint from a 12 mm lip under the ceiling up past the window, and the window itself –
   * wallkit's, lying flat `depth` (0.3) above the ceiling with its glass facing down: frame, fixed glazing or a sash,
   * panes. Its edge 0 (polygon[0] → polygon[1]) is the window's width. A flat ceiling (a sloped one: its highest
   * corner). Hidden with the ceilings (pickables.ceilings), no collision.
   */
  function buildSkylight(c, s, rr, ceilingMesh) {
    const P = s.polygon;
    const u = new THREE.Vector3(P[1].x - P[0].x, 0, P[1].y - P[0].y);
    if (u.lengthSq() < 1e-8) return;
    u.normalize();
    // v: across, with u × v = −y (the window's z points down into the room)
    const v = new THREE.Vector3(-u.z, 0, u.x);
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const p of P) {
      const du = (p.x - P[0].x) * u.x + (p.y - P[0].y) * u.z;
      const dv = (p.x - P[0].x) * v.x + (p.y - P[0].y) * v.z;
      u0 = Math.min(u0, du), u1 = Math.max(u1, du), v0 = Math.min(v0, dv), v1 = Math.max(v1, dv);
    }
    const W = u1 - u0;
    const L = v1 - v0;
    if (W < 0.1 || L < 0.1) return;
    const centre = new THREE.Vector3(P[0].x, 0, P[0].y).addScaledVector(u, (u0 + u1) / 2).addScaledVector(v, (v0 + v1) / 2);
    // under a roof (notes/tak.md): the window lies in the roof, the shaft runs up to it
    const rp = H.roofFieldOf?.(c.levelId)?.planeAt(centre.x, centre.z);
    if (rp) return buildRoofSkylight(c, s, rr, ceilingMesh, { u, v, W, L, centre, rp });
    const yC = Math.max(...P.map((p) => c.topAt(p.x, p.y)));
    const depth = Math.max(0.05, s.depth ?? 0.3);
    const fd = s.frame?.depth ?? 0.06;
    const pick = { kind: 'ceiling', ceilingId: c.id };
    const kit = new MeshBatcher(`skylight:${s.id}`);
    // shaft: four boards 2 cm thick outside the hole, the long ones over the corners
    const t = 0.02;
    const y0 = yC - 0.012;
    const y1 = yC + depth + fd + 0.03;
    const lm = ceilingMesh.material;
    const sf = kit.frame(basis(u, UP, v, centre.clone().setY(0)));
    sf.box(W + 2 * t, y1 - y0, t, 0, (y0 + y1) / 2, -L / 2 - t / 2, lm, { collide: false });
    sf.box(W + 2 * t, y1 - y0, t, 0, (y0 + y1) / 2, L / 2 + t / 2, lm, { collide: false });
    sf.box(t, y1 - y0, L, -W / 2 - t / 2, (y0 + y1) / 2, 0, lm, { collide: false });
    sf.box(t, y1 - y0, L, W / 2 + t / 2, (y0 + y1) / 2, 0, lm, { collide: false });
    const shaft = kit.build();
    batchers.push({ geometries: kit.geometries });
    shaft.name = `skylight-shaft:${s.id}`;
    // the window: an opening of W × L in the window frame (x = u, y = v, z = down), its bottom edge FRAME_INSET in from
    // the shaft so the frame stands free of it on every side
    const o = {
      id: s.id,
      width: W,
      height: L - FRAME_INSET,
      revealDepth: depth,
      frame: { width: 0.06, depth: fd, ...(s.frame || {}) },
      sashes: s.sashes ?? [{ opening: !!s.opening }],
      panes: s.panes ?? null,
      bars: s.bars ?? null,
      sillBoard: null,
    };
    const origin = centre.clone().setY(yC).addScaledVector(v, -L / 2 + FRAME_INSET);
    const frameHex = s.frame?.color;
    const frameM = frameHex && !sameHex(frameHex, LOOK.frame) ? mat('black-metal', frameHex, { roughness: 0.42 }) : K.frame;
    const WM = { ...pickMats(), frame: frameM, bars: s.bars?.color ? mat('black-metal', s.bars.color, { roughness: 0.42 }) : frameM };
    const win = buildWindow(o, false, { M: WM, exteriorBatch: rr.outside, batchers, keep, matrix: basis(u, v, new THREE.Vector3(0, -1, 0), origin) });
    win.group.name = `skylight:${s.id}`;
    const meshes = [...shaft.children, ...win.group.children, ...(win.glass ? [win.glass] : [])];
    for (const m of meshes) {
      m.userData.pick = pick;
      m.userData.noCollide = true;
      pickables.ceilings.push(m);
    }
    for (const m of shaft.children) skylightLinings.push({ ceilingId: c.id, mesh: m });
    rr.deco.add(shaft, win.group);
    if (win.glass) rr.deco.add(win.glass);
  }

  /**
   * A roof window under a roof (notes/tak.md): the window lies in the roof plane rp, its frame a few cm proud of the
   * covering; the shaft is four vertical boards 2 cm outside the hole (and 3 mm into it, under the frame) from 12 mm
   * under the ceiling (sloped or flat) up
   * to just under the covering (roof.js cuts the same hole in the roof). On a sloped ceiling under the same plane the
   * shaft is only the roof's thickness deep.
   */
  function buildRoofSkylight(c, s, rr, ceilingMesh, { u, v, W, L, centre, rp }) {
    const roofTop = (x, z) => planeY(rp, x, z) + rp.tv;
    const pick = { kind: 'ceiling', ceilingId: c.id };
    // the boards reach 3 mm into the hole, under the window's frame (it stands FRAME_INSET in from the hole's sides)
    const lip = 0.003;
    const t = 0.02 + lip;
    const corner = (a, b) => centre.clone().addScaledVector(u, (a * (W - 2 * lip)) / 2).addScaledVector(v, (b * (L - 2 * lip)) / 2);
    const pos = [];
    const uvs = [];
    const quad = (A, B, C, D) => {
      for (const p of [A, B, C, A, C, D]) pos.push(p.x, p.y, p.z);
      const w = A.distanceTo(B), h = A.distanceTo(D);
      uvs.push(0, 0, w, 0, w, h, 0, 0, w, h, 0, h);
    };
    const yb = (p) => c.topAt(p.x, p.z) - 0.012;
    const yt = (p) => roofTop(p.x, p.z) - 0.005;
    const at = (p, y) => new THREE.Vector3(p.x, y, p.z);
    // the boards along u (over the corners) and along v (between them), each a closed box with sloped top / bottom
    for (const [a0, b0, a1, b1, out, ext] of [[-1, -1, 1, -1, v.clone().negate(), true], [1, 1, -1, 1, v.clone(), true], [1, -1, 1, 1, u.clone(), false], [-1, 1, -1, -1, u.clone().negate(), false]]) {
      let A = corner(a0, b0), B = corner(a1, b1);
      if (ext) {
        const d = B.clone().sub(A).normalize();
        A = A.addScaledVector(d, -t);
        B = B.addScaledVector(d, t);
      }
      const A2 = A.clone().addScaledVector(out, t), B2 = B.clone().addScaledVector(out, t);
      // inner face (facing the hole: −out): seen from inside, A → B must run so that (B − A) × up = −out
      const fn = new THREE.Vector3().crossVectors(B.clone().sub(A), UP);
      const [p, q, p2, q2] = fn.dot(out) < 0 ? [A, B, A2, B2] : [B, A, B2, A2];
      quad(at(p, yb(p)), at(q, yb(q)), at(q, yt(q)), at(p, yt(p))); // inner
      quad(at(q2, yb(q2)), at(p2, yb(p2)), at(p2, yt(p2)), at(q2, yt(q2))); // outer
      quad(at(p, yt(p)), at(q, yt(q)), at(q2, yt(q2)), at(p2, yt(p2))); // top
      quad(at(p2, yb(p2)), at(q2, yb(q2)), at(q, yb(q)), at(p, yb(p))); // bottom
      quad(at(p2, yb(p2)), at(p, yb(p)), at(p, yt(p)), at(p2, yt(p2))); // ends
      quad(at(q, yb(q)), at(q2, yb(q2)), at(q2, yt(q2)), at(q, yt(q)));
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    sg.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    sg.computeVertexNormals();
    const shaft = new THREE.Mesh(keep(sg), ceilingMesh.material);
    shaft.name = `skylight-shaft:${s.id}`;
    shaft.castShadow = true;
    shaft.receiveShadow = true;
    // the window in the plane: x along u, y along v (both lifted onto the plane), z = u × v (down into the room)
    const lift = (d) => new THREE.Vector3(d.x, rp.a * d.x + rp.b * d.z, d.z);
    const u3 = lift(u);
    const lu = u3.length();
    u3.normalize();
    const v3r = lift(v);
    const lv = v3r.length();
    const v3 = v3r.clone().addScaledVector(u3, -v3r.dot(u3)).normalize();
    const z3 = new THREE.Vector3().crossVectors(u3, v3);
    const fd = s.frame?.depth ?? 0.06;
    const rd = 0.05;
    const Wp = W * lu, Lp = L * lv;
    // the frame's outside 4 cm over the covering: origin rd + fd − 0.04 below it along z3
    const top = new THREE.Vector3(centre.x, roofTop(centre.x, centre.z), centre.z);
    const origin = top.addScaledVector(z3, rd + fd - 0.04).addScaledVector(v3, -Lp / 2 + FRAME_INSET);
    const o = {
      id: s.id,
      width: Wp,
      height: Lp - FRAME_INSET,
      revealDepth: rd,
      frame: { width: 0.06, depth: fd, ...(s.frame || {}) },
      sashes: s.sashes ?? [{ opening: !!s.opening }],
      panes: s.panes ?? null,
      bars: s.bars ?? null,
      sillBoard: null,
    };
    const frameHex = s.frame?.color;
    const frameM = frameHex && !sameHex(frameHex, LOOK.frame) ? mat('black-metal', frameHex, { roughness: 0.42 }) : K.frame;
    const WM = { ...pickMats(), frame: frameM, bars: s.bars?.color ? mat('black-metal', s.bars.color, { roughness: 0.42 }) : frameM };
    const win = buildWindow(o, false, { M: WM, exteriorBatch: rr.outside, batchers, keep, matrix: basis(u3, v3, z3, origin) });
    win.group.name = `skylight:${s.id}`;
    const meshes = [shaft, ...win.group.children, ...(win.glass ? [win.glass] : [])];
    for (const m of meshes) {
      m.userData.pick = pick;
      m.userData.noCollide = true;
      pickables.ceilings.push(m);
    }
    skylightLinings.push({ ceilingId: c.id, mesh: shaft });
    rr.deco.add(shaft, win.group);
    if (win.glass) rr.deco.add(win.glass);
  }

  /** Skirting of a room: along each wall of its loop, gaps at door holes and over the stairwell. */
  function buildSkirting(r, bb, holes) {
    if (!bb) return;
    const rr = R[r.id];
    const bh = bb.height ?? 0.07;
    const bt = bb.thickness ?? 0.012;
    const prof = [[0, 0], [bt, 0], [bt, bh - Math.min(0.004, bt / 2)], [bt - Math.min(0.004, bt / 2), bh], [0, bh]];
    const bm = paint(bb.color ?? '#e9e6df', { roughness: 0.48 });
    const em = bb.edge ? mat('plastic', bb.edge, { roughness: 0.6 }) : null;
    for (const id of r.wallIds) {
      const w = H.wallsById[id];
      if (!w) continue;
      const next = H.wallsById[w.nextId];
      const cEnd = next ? cross(w.dir, next.dir) : 0;
      const blocked = [];
      for (const h of w.holes) if (h.door || h.sill <= 0.05) blocked.push([h.u0, h.u1]);
      // over a hole in the floor there is no floor to stand a board on
      if (holes.length) {
        const step = 0.05;
        let s0 = null;
        for (let u = 0; u <= w.length + 1e-6; u += step) {
          const p = w.start.clone().addScaledVector(w.dir, Math.min(u, w.length)).addScaledVector(w.normal, 0.03);
          const inHole = holes.some((P) => inPolyStrict(p.x, p.y, P));
          if (inHole && s0 === null) s0 = Math.max(0, u - step / 2);
          if (!inHole && s0 !== null) {
            blocked.push([s0, u - step / 2]);
            s0 = null;
          }
        }
        if (s0 !== null) blocked.push([s0, w.length + bt]);
      }
      blocked.sort((a, b) => a[0] - b[0]);
      let s0 = 0;
      const sEnd = cEnd > 1e-6 ? w.length - bt : cEnd < -1e-6 ? w.length + bt : w.length;
      const free = [];
      for (const [a, b] of blocked) {
        if (b <= s0) continue;
        if (a > s0) free.push([s0, Math.min(a, sEnd)]);
        s0 = Math.max(s0, b);
      }
      if (s0 < sEnd) free.push([s0, sEnd]);
      const Mw = wallMatrix(w, w.floorY);
      for (const [a, b] of free) {
        if (b - a < 0.02) continue;
        const g = prismX(prof, a, b);
        rr.trims.add(g, bm, { matrix: Mw, collide: false, castShadow: false, boxUV: true });
        g.dispose();
        if (em) {
          const e = prismX([[bt, bh - 0.004], [bt + 0.001, bh - 0.004], [bt + 0.001, bh], [bt, bh]], a, b);
          rr.trims.add(e, em, { matrix: Mw, collide: false, castShadow: false, boxUV: true });
          e.dispose();
        }
      }
    }
  }

  /** A thin dark trim (taklist) along every wall of the ceiling's room at the ceiling. */
  function buildCeilingTrim(c, th) {
    const room = H.roomsById[c.roomId];
    const rr = R[c.roomId];
    if (!room || !rr) return;
    const tm = mat('painted', c.trim, { roughness: 0.5 });
    const d = 0.012;
    for (const id of room.wallIds) {
      const w = H.wallsById[id];
      if (!w) continue;
      const mid = w.start.clone().addScaledVector(w.dir, w.length / 2).addScaledVector(w.normal, 0.05);
      const y = c.topAt(mid.x, mid.y) - w.floorY;
      const g = prismX([[0, y - th], [d, y - th], [d, y], [0, y]], -d, w.length + d);
      rr.trims.add(g, tm, { matrix: wallMatrix(w, w.floorY), collide: false, castShadow: false, boxUV: true });
      g.dispose();
    }
  }

  // ---- the stairwell: the white edge face on the free edges of a hole (V16)
  for (const fo of H.floorOpenings) {
    const room = H.roomsById[fo.roomId];
    if (!room || !roomIds.has(room.id)) continue;
    const rr = R[room.id];
    const lv = H.levelsById[fo.levelId];
    const raw = (spec.floorOpenings || []).find((x) => x.id === fo.id) || {};
    const band = raw.edgeBand || {};
    const depth = band.depth ?? lv.slabThickness ?? 0.3;
    const em = paint(band.color ?? LOOK.edge, { roughness: 0.6 });
    const P = fo.polygon;
    for (let i = 0; i < P.length; i++) {
      const a = P[i], b = P[(i + 1) % P.length];
      if (onBoundary(a, b, room.polygon)) continue; // a shaft wall runs through there in its own colour
      const len = a.distanceTo(b);
      if (len < 0.01) continue;
      const dir = b.clone().sub(a).normalize();
      let n = new THREE.Vector3(-dir.y, 0, dir.x);
      const mx = (a.x + b.x) / 2, mz = (a.y + b.y) / 2;
      if (!inPoly(mx + n.x * 0.02, mz + n.z * 0.02, P)) n.negate();
      const x = new THREE.Vector3().crossVectors(UP, n);
      const g = keep(new THREE.PlaneGeometry(len, depth));
      const m = new THREE.Mesh(g, em);
      m.applyMatrix4(basis(x, UP, n, new THREE.Vector3(mx, fo.floorY - depth / 2, mz)));
      m.name = `hole-edge:${fo.id}:${i}`;
      m.receiveShadow = true;
      m.castShadow = true;
      m.userData.noCollide = true;
      rr.deco.add(m);
    }
  }

  // ---- lamp fittings (their light comes with L1: dark until then, see the top)
  const groupLabel = Object.fromEntries((H.lightGroups || []).map((g) => [g.id, g.label]));
  for (const l of H.builtInLights) {
    if (!roomIds.has(l.roomId)) continue;
    const rr = R[l.roomId];
    const label = groupLabel[l.group] || l.name;
    if (l.type === 'plafond' && l.position) {
      const d = l.dims?.d ?? 0.4, h = l.dims?.h ?? 0.07;
      const p = l.position;
      rr.fittings.cylinder(d / 2, d / 2 - 0.006, h - 0.012, p.x, p.y - (h - 0.012) / 2, p.z, mat('plastic', l.color || '#eeeeec', { roughness: 0.5 }), { segments: 40, collide: false });
      const front = emissive(LOOK.led, 1.6, { color: l.accent || '#f2f2f0' });
      front.emissiveIntensity = 0;
      owned.push(front);
      const fg = keep(new THREE.CylinderGeometry(d / 2 - 0.02, d / 2 - 0.03, 0.012, 40));
      const fmesh = new THREE.Mesh(fg, front);
      fmesh.position.set(p.x, p.y - h + 0.006, p.z);
      fmesh.name = `lamp:${l.id}`;
      fmesh.castShadow = false;
      rr.lamps.add(fmesh);
      builtInLights.push({
        id: l.id, group: l.group, label, type: 'ceiling', lightType: 'point', fitting: 'plafond', roomId: l.roomId, levelId: l.levelId,
        position: p.clone().add(new THREE.Vector3(0, -h - 0.05, 0)), direction: new THREE.Vector3(0, -1, 0),
        colorK: l.colorK, lumens: l.lumens, emissiveMeshes: [fmesh],
      });
    } else if (l.type === 'downlight' && l.position) {
      const d = l.dims?.d ?? 0.08;
      const p = l.position;
      rr.fittings.cylinder(d / 2 + 0.012, d / 2 + 0.012, 0.006, p.x, p.y - 0.003, p.z, mat('plastic', l.color || '#151515', { roughness: 0.5 }), { segments: 28, collide: false });
      const lens = emissive(LOOK.led, 2.4, { color: '#e9e6e0' });
      lens.emissiveIntensity = 0;
      owned.push(lens);
      const lg = keep(new THREE.CircleGeometry(d / 2 - 0.004, 24).rotateX(Math.PI / 2));
      const lmesh = new THREE.Mesh(lg, lens);
      lmesh.position.set(p.x, p.y - 0.0065, p.z);
      lmesh.name = `lamp:${l.id}`;
      lmesh.castShadow = false;
      rr.lamps.add(lmesh);
      builtInLights.push({
        id: l.id, group: l.group, label, type: 'spot', lightType: 'spot', fitting: 'downlight', roomId: l.roomId, levelId: l.levelId,
        position: p.clone().add(new THREE.Vector3(0, -0.01, 0)), direction: new THREE.Vector3(0, -1, 0), angle: (45 * Math.PI) / 180, penumbra: 0.6,
        colorK: l.colorK, lumens: l.lumens, emissiveMeshes: [lmesh],
      });
    } else if (l.type === 'led-strip' && l.from && l.to) {
      const yRef = l.from.y - 0.1;
      const strip = ledStrip(l, (x, z) => H.ceilingHeightAt(x, z, yRef), rr.fittings, K.alu);
      strip.mesh.material.emissiveIntensity = 0;
      owned.push(strip.mesh.geometry, strip.mesh.material);
      rr.lamps.add(strip.mesh);
      builtInLights.push({
        id: l.id, group: l.group, label, type: 'led-strip', roomId: l.roomId, levelId: l.levelId,
        from: strip.from, to: strip.to, direction: new THREE.Vector3(0, -1, 0), colorK: l.colorK, lumens: l.lumens, emissiveMeshes: [strip.mesh],
      });
    }
  }

  // ---- soffits outside (outsideHouse.soffits: V4, V6, V28): built ONCE, by exterior.js (steg 25, C3) – its niche
  // soffit follows the deck out to its SW corner (x 10.35 · z 6.75) and has the tuned dark material (225543); a second
  // plate here was a double, near-coplanar draw (integrator, bølge 1 gruppe 2).

  // ---- static boxes: the slab under the ground floor minus its holes (§2.8), the low ceilings (−0.50)
  const mainSlab = slabBoxes(H, mainId);
  colliders.push(...mainSlab);
  // a basement room that reaches out beyond the ground floor (bod-3 past the terrace edge, until the deck goes out to
  // x 10.35, V9) is closed on top: a dark flat cover over the room and its own walls where no ground floor is above.
  // "Above" is the upper level's slab footprint WITH its floor openings: the stairwell is open, never lidded (the slab
  // boxes leave the hole out, so they alone would put a cover over the shaft at the floor above). The cover sits at
  // most 7 cm over the slab underside of the level above (never at or above its floor).
  // The slab of the level above decides (the main floor's over the basement); a room under its level's own roof
  // (notes/tak.md) is closed by the roof.
  {
    const slabOf = new Map([[mainId, mainSlab]]);
    const capMat = mat('painted', '#3a3734', { roughness: 0.9 });
    for (const r of rooms) {
      const lv = H.levelsById[r.levelId];
      if (!lv?.aboveId) continue;
      if (!slabOf.has(lv.aboveId)) slabOf.set(lv.aboveId, slabBoxes(H, lv.aboveId));
      const slab = slabOf.get(lv.aboveId);
      const roof = H.roofFieldOf?.(r.levelId);
      const covered = (x, z) => slab.some((b) => x > b.min.x - 1e-6 && x < b.max.x + 1e-6 && z > b.min.z - 1e-6 && z < b.max.z + 1e-6) || !!roof?.planeAt(x, z);
      const holesAbove = H.floorOpenings.filter((fo) => fo.levelId === lv.aboveId).map((fo) => fo.polygon);
      const inHoleAbove = (x, z) => holesAbove.some((P) => inPoly(x, z, P));
      const capY = H.levelsById[lv.aboveId].bottomY + 0.07;
      const own = H.walls.filter((w) => w.roomId === r.id && w.thickness > 0);
      const foots = own.map((w) => {
        const n = w.normal.clone().multiplyScalar(-w.thickness);
        return [w.start.clone(), w.end.clone(), w.end.clone().add(n), w.start.clone().add(n)];
      });
      // grid lines: the room, its walls, and (inside their range) the edges of the slab boxes and holes above, so every
      // cell is wholly in or out of each and its midpoint decides for the whole cell
      const pts = [...r.polygon, ...foots.flat()];
      const rx = [Math.min(...pts.map((q) => q.x)), Math.max(...pts.map((q) => q.x))];
      const rz = [Math.min(...pts.map((q) => q.y)), Math.max(...pts.map((q) => q.y))];
      const gx = [...pts.map((q) => q.x), ...slab.flatMap((b) => [b.min.x, b.max.x]), ...holesAbove.flat().map((q) => q.x)];
      const gz = [...pts.map((q) => q.y), ...slab.flatMap((b) => [b.min.z, b.max.z]), ...holesAbove.flat().map((q) => q.y)];
      const grid = (vals, [lo, hi]) => [...new Set(vals.filter((v) => v >= lo - 1e-6 && v <= hi + 1e-6).map((v) => Math.round(v * 1e4) / 1e4))].sort((a, b) => a - b);
      const xs = grid(gx, rx);
      const zs = grid(gz, rz);
      const top = Math.min(capY, Math.max(r.floorY + 2, ...own.map((w) => w.floorY + w.height)));
      const pos = [];
      for (let i = 0; i < xs.length - 1; i++) for (let j = 0; j < zs.length - 1; j++) {
        const x = (xs[i] + xs[i + 1]) / 2, z = (zs[j] + zs[j + 1]) / 2;
        if (covered(x, z) || inHoleAbove(x, z)) continue;
        if (!inPoly(x, z, r.polygon) && !foots.some((P) => inPoly(x, z, P))) continue;
        const a = [xs[i], top, zs[j]], b = [xs[i + 1], top, zs[j]], c = [xs[i + 1], top, zs[j + 1]], d = [xs[i], top, zs[j + 1]];
        pos.push(...a, ...d, ...c, ...a, ...c, ...b);
      }
      if (!pos.length) continue;
      const g = keep(new THREE.BufferGeometry());
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.computeVertexNormals();
      const m = new THREE.Mesh(g, capMat);
      m.name = `cover:${r.id}`;
      m.castShadow = true;
      m.receiveShadow = true;
      R[r.id].solid.add(m);
    }
  }
  for (const r of rooms) {
    const lv = H.levelsById[r.levelId];
    if (!lv?.aboveId) continue;
    const under = H.levelsById[lv.aboveId].bottomY;
    const cs = H.ceilings.filter((c) => c.roomId === r.id);
    if (!cs.length) continue;
    const top = Math.min(...cs.map((c) => c.topAt(c.centroid.x, c.centroid.y)));
    if (top > under - 0.05) continue;
    // one box per rectangle of the room's own outline (rectCells), not its bounds: the entrance's bounds hold the
    // pillar cut-out, where a box 0.20 under the visible ceiling stood in kjellerstue (the review of steg 8+21+24)
    const P = r.polygon || [];
    const axis = P.length >= 4 && P.every((a, i) => {
      const q = P[(i + 1) % P.length];
      return Math.abs((a.x ?? a[0]) - (q.x ?? q[0])) < 1e-6 || Math.abs((a.y ?? a[1]) - (q.y ?? q[1])) < 1e-6;
    });
    const b = r.bounds;
    const cells = axis ? rectCells(P) : [[b.minX, b.minZ, b.maxX, b.maxZ]];
    for (const [x0, z0, x1, z1] of cells) colliders.push(new THREE.Box3(new THREE.Vector3(x0, top, z0), new THREE.Vector3(x1, under, z1)));
  }

  // ---- merge the batches into their rooms
  for (const r of rooms) {
    const rr = R[r.id];
    rr.solid.add(rr.walls.build());
    const tg = rr.trims.build();
    tg.userData.noCollide = true;
    rr.deco.add(tg);
    const og = rr.outside.build();
    rr.solid.add(og);
    const fg = rr.fittings.build();
    fg.userData.noCollide = true;
    rr.lamps.add(fg);
  }
  for (const r of rooms) R[r.id].solid.updateMatrixWorld(true);

  /** Paint a wall / backOf face or a ceiling of these rooms ('sand' | 'marrakesh' | '#hex', null = the data's colour). */
  function setPaint(id, color) {
    const wm = wallFaceMeshes.get(id);
    if (wm?.length) {
      const w = H.wallsById[id];
      const m = w ? wallMat(w, color) : paint(color || 'sand');
      for (const x of wm) x.material = m;
      return;
    }
    const cm = ceilingMeshes.get(id);
    if (cm) {
      cm.material = paint(color || H.ceilings.find((c) => c.id === id)?.paint || 'sand');
      for (const l of skylightLinings) if (l.ceilingId === id) l.mesh.material = cm.material;
    }
  }

  return contract({ setPaint });
}

/**
 * The slab box under a level (y bottomY … floorY), minus its floor openings: one static Box3 per merged run of the grid
 * the level's room polygons, wall footprints and holes make (§2.8: the floors are one-sided, so a head from the level
 * below – a jump in the basement – would pass through them; the box is also the basement's ceiling collision).
 * Pure (Node-testable).
 * @param {object} H        layout.house
 * @param {string} levelId
 * @returns {THREE.Box3[]}
 */
export function slabBoxes(H, levelId) {
  const lv = H?.levelsById?.[levelId];
  if (!lv?.belowId) return [];
  const rooms = H.rooms.filter((r) => r.levelId === levelId && !r.hud && r.polygon?.length >= 3);
  const holes = H.floorOpenings.filter((fo) => fo.levelId === levelId).map((fo) => fo.polygon);
  const foots = H.walls
    .filter((w) => w.levelId === levelId && w.thickness > 0)
    .map((w) => {
      const n = w.normal.clone().multiplyScalar(-w.thickness);
      return [w.start.clone(), w.end.clone(), w.end.clone().add(n), w.start.clone().add(n)];
    });
  const xs = new Set();
  const zs = new Set();
  for (const P of [...rooms.map((r) => r.polygon), ...foots, ...holes]) for (const p of P) {
    xs.add(Math.round(p.x * 1e4) / 1e4);
    zs.add(Math.round(p.y * 1e4) / 1e4);
  }
  const X = [...xs].sort((a, b) => a - b);
  const Z = [...zs].sort((a, b) => a - b);
  const filled = (x, z) => !holes.some((P) => inPoly(x, z, P)) && (rooms.some((r) => inPoly(x, z, r.polygon)) || foots.some((P) => inPoly(x, z, P)));
  // runs along x per z band, then bands with the same runs merged
  const bands = [];
  for (let j = 0; j < Z.length - 1; j++) {
    const zc = (Z[j] + Z[j + 1]) / 2;
    const runs = [];
    let start = null;
    for (let i = 0; i < X.length - 1; i++) {
      const on = filled((X[i] + X[i + 1]) / 2, zc);
      if (on && start === null) start = X[i];
      if (!on && start !== null) {
        runs.push([start, X[i]]);
        start = null;
      }
    }
    if (start !== null) runs.push([start, X[X.length - 1]]);
    bands.push({ z0: Z[j], z1: Z[j + 1], runs });
  }
  const boxes = [];
  const key = (runs) => runs.map((r) => r.join(':')).join('|');
  for (let j = 0; j < bands.length; j++) {
    const b = bands[j];
    if (!b.runs.length) continue;
    let z1 = b.z1;
    while (j + 1 < bands.length && key(bands[j + 1].runs) === key(b.runs)) z1 = bands[++j].z1;
    for (const [x0, x1] of b.runs) boxes.push(new THREE.Box3(new THREE.Vector3(x0, lv.bottomY, b.z0), new THREE.Vector3(x1, lv.floorY, z1)));
  }
  return boxes;
}
