import { Box3, Vector2, Vector3 } from 'three';
import roomSpec from '../data/room-spec.json';
import paletteData from '../data/palette.json';
import { isPlanType, isQuarterTurn, stairPlan, stairRisers, rampKnots, rampAt } from './stairtypes.js';

/**
 * Room layout: reads data/room-spec.json and derives typed, world-space values for every module (shell, lighting,
 * placement, acoustics …). ALL room measurements live here – no magic room numbers anywhere else.
 *
 * Coordinates (ARCHITECTURE §1): metres, +x = south (big windows), +z = west (TV-stue), +y = up, origin = floor at
 * the top-left interior corner of the plan. Plan points are Vector2(x, z). The exported object is deep-frozen
 * (vectors included): clone before mutating (`layout.highWall.origin.clone().add(…)`).
 *
 * The whole house (notes/hele-huset-design.md §1.8):
 *   • The OLD top-level fields (walls, wallsById, openings, windows, doors, ceilings, bulkheads, builtInLights,
 *     fixtures, furniture, zones, photoCameras, floor, floorArea, volume, bounds, highWall, isInside,
 *     ceilingHeightAt(x, z)) only take entries without `roomId` or with roomId 'stue-kjokken' – the living room /
 *     kitchen / TV-stue, exactly as before. Every consumer of today reads them unfiltered, so data for a new room can
 *     never change the living room before the step that owns the consumer switches to `house`.
 *   • `layout.house` is the whole house: levels, rooms, every wall / opening / ceiling / light / fixture / built-in,
 *     floor openings, stairs, light groups and the level-aware queries (levelAt, roomAt, floorYAt, isInside,
 *     ceilingHeightAt(x, z, y)). See the house typedef below.
 *   • y in the spec is LOCAL: measured from the floor of the entry's room (level floorY + room.floorOffset; entries
 *     without a room: the floor of their level). Only this file adds the floor height – every derived Vector3 here
 *     (opening corners, light positions, fixtures, cameras, built-ins …) is world space, and `wall.pointAt(u, v)`
 *     takes v above the wall's floor. Exception: `outside` / `outsideHouse` are world y. Furniture stays raw spec data
 *     (level-local y) – design items carry their own level (§5.5).
 *   • ceilingHeightAt(x, z) with two arguments keeps returning the living room's value; with a third argument (y) it
 *     is house.ceilingHeightAt(x, z, y) – a WORLD y. In dev a 2-argument call for a point inside another room warns
 *     once per call site.
 *
 * @typedef {'window'|'terrace-door'|'door'} OpeningType
 *
 * @typedef {Object} OpeningLayout
 * @property {string} id
 * @property {OpeningType} type
 * @property {string} name
 * @property {string} wallId
 * @property {string} roomId      room of the owner wall
 * @property {string} levelId
 * @property {number} floorY      world y of the owner wall's floor
 * @property {number} offset      distance along the wall from its start to the near edge of the hole
 * @property {number} width
 * @property {number} height
 * @property {number} sill        bottom of the hole (= top of the sill board), above the wall's floor
 * @property {number} top         sill + height
 * @property {number} u0          = offset
 * @property {number} u1          = offset + width
 * @property {number} area        width × height (m²)
 * @property {Vector3} center     middle of the hole in the wall's room-side plane
 * @property {Vector3} topCenter  middle of the top edge (room-side plane) – origin of a window's shading anchor
 * @property {Vector3} bottomCenter
 * @property {Vector3} normal     into the room
 * @property {Vector3} right      along the wall, to the right seen from the room (= wall direction)
 * @property {Vector3[]} corners  [bottom-left, bottom-right, top-right, top-left] seen from the room
 * @property {Box3} rect          flat box of the hole on the room-side face
 * @property {Box3} hole          box of the hole through the whole wall thickness
 * @property {number} revealDepth depth of the reveal from the wall face to the frame
 * @property {Object|null} frame
 * @property {Object|null} reveal
 * @property {Object|null} sillBoard
 * @property {Object[]} sashes
 * @property {Object|null} door
 * @property {Object|null} handle
 * @property {string|null} outsideView
 * @property {string} confidence
 * @property {string[]} connects  rooms on the two sides (data, else derived: owner room + rooms of backOf faces)
 * @property {boolean} interactive  door the player can open (default: a door between two modelled rooms)
 * @property {boolean} locked
 * @property {boolean} frosted    window
 * @property {number|null} skyView      window (0–1, basement windows), null = lighting default
 * @property {number|null} obstruction  window, null = lighting default (OBSTRUCTION)
 *
 * @typedef {Object} WallLayout
 * @property {string} id
 * @property {string} name
 * @property {string} roomId       'stue-kjokken' when the spec entry has none
 * @property {string} levelId
 * @property {number} floorY       world y of the floor the wall stands on
 * @property {Vector2} start       plan point (x, z) on the room-side face
 * @property {Vector2} end
 * @property {Vector2} dir         unit vector start → end
 * @property {Vector2} normal      into the room
 * @property {Vector3} dir3
 * @property {Vector3} normal3
 * @property {number} length
 * @property {number} thickness    the wall extends this far OUTWARD from the room-side face (0 for a backOf face)
 * @property {string[]|null} backOf  the existing slab(s) this face is the back of (D13: no own geometry)
 * @property {string} material     'paint' | 'stone-panel' | 'wetroom-paint' | 'dark-panel'
 * @property {string} paint        'sand' | 'marrakesh' | '#hex'
 * @property {string} paintHex
 * @property {boolean} exterior
 * @property {boolean} isHigh
 * @property {boolean} hiddenBehindCabinets
 * @property {number} height       highest point of the top edge (above the wall's floor)
 * @property {Array<[number, number]>} topProfile  [[u, height], …] along the wall (always present)
 * @property {(u: number) => number} heightAt     top edge height at u (above the wall's floor)
 * @property {(u: number, v?: number, out?: Vector3) => Vector3} pointAt  world point on the room-side face, v above the wall's floor
 * @property {OpeningLayout[]} openings  the openings this wall OWNS (each opening is defined once, on its owner wall)
 * @property {Object[]} holes      every hole in this face: its own openings + those of its backOf partners, in this
 *                                 wall's u: { openingId, ownerWallId, type, u0, u1, sill, top, door }
 * @property {string|null} prevId  previous / next wall of the room's clockwise loop
 * @property {string|null} nextId
 * @property {string} [notes]
 *
 * @typedef {Object} HouseLayout  layout.house – every entry carries roomId, levelId and floorY (world y of its floor)
 * @property {Object[]} levels            top → bottom: { id, name, floorY, slabThickness, bottomY, ceilingDefault, plan, roomIds, aboveId, belowId }
 * @property {(y: number, previousId?: string) => Object} levelAt   level at a world y (pass the body centre); hysteresis with previousId
 * @property {Object[]} rooms             { id, name, levelId, levelName, kind, hud, floorY, floorOffset, polygon, area, netArea, centroid, bounds,
 *                                          floor, holeIds, ceilingIds, wallIds (loop order), volume, ceilingTop, yRange (hud), acoustic,
 *                                          contains(x, z), containsPoint(x, y, z) }
 * @property {(x: number, y: number, z: number, opts?: { physical?: boolean, levelId?: string, previousLevelId?: string }) => Object|null} roomAt
 * @property {WallLayout[]} walls         + wallsById, wall(id), backFacesOf(id)
 * @property {OpeningLayout[]} openings   + openingsById, opening(id), windows, doors (+ openAngleDeg, opensInto, casing), thresholds
 * @property {Object[]} ceilings          + heightAt (above the room floor), topAt (world), holes (stairwell cut-outs)
 * @property {Object[]} lightGroups       the six living-room groups + the data groups { id, label, roomId (null: several rooms or none, e.g. boder, ute), dimmer (start level), dimmable, auto }
 * @property {Object[]} floorOpenings     { id, levelId, roomId, stairId, polygon, area, contains(x, z) (strict) }
 * @property {Object[]} stairs            { …data, fromLevel, toLevel, risers, rise, riser, topY, bottomY, footprint, wellPolygon, walkLine,
 *                                          walkLength, going, contains(x, z), surfaceY(x, z) }
 * @property {(x: number, z: number, y?: number) => number|null} floorYAt      floor (world y) under a point, stair surfaces included
 * @property {(x: number, z: number, y?: number, previousLevelId?: string) => boolean} isInside
 * @property {(x: number, z: number, y?: number) => number} ceilingHeightAt    world y; in a hole the ceiling of the level above
 * @property {Object} bounds              { minX, maxX, minZ, maxZ, minY, maxY } of every level; levelBounds(id) per level
 * @property {Object[]} walkRects         one per level, inset 5 cm, { levelId, minX, maxX, minZ, maxZ, minY, maxY } (y = feet band)
 */

const DEG = Math.PI / 180;
const EPS = 1e-6;
const ZONE_BOX_TOP = 3.1;

/** The open-plan living room / kitchen / TV-stue (D12): spec entries without a roomId belong to it. */
export const LIVING_ROOM_ID = 'stue-kjokken';
/** The ground floor; entries without a room or level are on it. */
export const MAIN_LEVEL_ID = 'hoved';
/** Default slab (floor deck) thickness under a level (D2: y −0.30 … 0 under the ground floor). */
const DEFAULT_SLAB = 0.3;
/** levelAt(y, previous): the level only changes once y is this far past the boundary (§1.8). */
export const LEVEL_HYSTERESIS = 0.15;
/** floorYAt(x, z, y): the highest surface at most this far above y counts as the floor under y. */
const STEP_UP = 0.35;
/** Non-window openings whose sill is at most this high are walk-through (door thresholds). */
const THRESHOLD_SILL = 0.05;
/** The hud room of a stair reaches this far above the upper floor (§1.4: «1. etasjes gulv + 1 m»). */
const STAIR_HUD_TOP = 1.0;

const DEV = !!import.meta.env?.DEV;

/** Contract light groups (ARCHITECTURE §15) with Norwegian labels and the dimmer they start at (the levels the owner
 *  uses in the evening; on/off still follows the time of day until the group is switched by hand). The light panel
 *  shows dimmer × 100 %: the owner's change list 2026-10-21 set the island pendants to 6 % and the high-wall spots to
 *  5 %. 'overskap' is the LED strip under the glass cabinet and the LED strips inside its three sections (kitchen.js). */
const LIGHT_GROUPS = [
  { id: 'led', label: 'LED-lister', dimmer: 0.15 },
  { id: 'spots', label: 'Spotter ved den høye veggen', dimmer: 0.05 },
  { id: 'kjokken', label: 'Kjøkkenlys', dimmer: 0.3 },
  { id: 'pendler', label: 'Pendler over kjøkkenøya', dimmer: 0.06 },
  { id: 'overskap', label: 'Lys i og under glasskapet', dimmer: 0.16 },
  { id: 'tvstue', label: 'Taklampe i TV-stua', dimmer: 0.35 },
];
const LIGHT_GROUP_IDS = new Set(LIGHT_GROUPS.map((g) => g.id));
const SPEC_GROUP_TO_GROUP = { 'led-lister': 'led', 'spotter-hoyvegg': 'spots', 'taklampe-tvstue': 'tvstue', kjokkenlys: 'kjokken' };

/**
 * Group of a room-spec light: the strip under the glass cabinet and the island pendants have their own switch; the
 * living room's spec groups map to the contract groups; any other group must be a contract group or one of the data
 * light groups (`groups`). An unknown group is no longer silently 'kjokken': it warns and falls back to `fallback`.
 * @param {Object} l  room-spec light ({ id, type, group })
 * @param {{ groups?: Set<string>|null, fallback?: string }} [opts]
 * @returns {string}
 */
export function lightGroupOf(l, { groups = null, fallback = 'kjokken' } = {}) {
  if (l.id === 'led-overskap') return 'overskap';
  if (l.type === 'pendant-cylinder' && l.group === 'kjokkenlys') return 'pendler';
  if (SPEC_GROUP_TO_GROUP[l.group]) return SPEC_GROUP_TO_GROUP[l.group];
  if (l.group && (LIGHT_GROUP_IDS.has(l.group) || groups?.has(l.group))) return l.group;
  console.warn(`[layout] light ${l.id}: unknown light group ${JSON.stringify(l.group ?? null)} → '${fallback}'`);
  return fallback;
}

// ---------------------------------------------------------------------------------------------------------------
// Geometry helpers (plan = x/z)

/** Shoelace area of a polygon of Vector2 (absolute value). */
function polygonArea(poly) {
  let a = 0;
  for (let i = 0, n = poly.length; i < n; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % n];
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a) / 2;
}

/** Area centroid of a simple polygon. */
function polygonCentroid(poly) {
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0, n = poly.length; i < n; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % n];
    const cross = p.x * q.y - q.x * p.y;
    a += cross;
    cx += (p.x + q.x) * cross;
    cy += (p.y + q.y) * cross;
  }
  if (Math.abs(a) < EPS) return poly[0].clone();
  return new Vector2(cx / (3 * a), cy / (3 * a));
}

function distToSegment(x, z, a, b) {
  const dx = b.x - a.x;
  const dz = b.y - a.y;
  const len2 = dx * dx + dz * dz;
  let t = len2 > 0 ? ((x - a.x) * dx + (z - a.y) * dz) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const px = a.x + dx * t - x;
  const pz = a.y + dz * t - z;
  return Math.sqrt(px * px + pz * pz);
}

/** Point in polygon (even-odd) – points on an edge count as inside. */
function pointInPolygon(x, z, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (distToSegment(x, z, a, b) < 1e-5) return true;
    if (a.y > z !== b.y > z && x < ((b.x - a.x) * (z - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Strictly inside (points on an edge do NOT count) – holes and wells, so their rim stays floor. */
function pointStrictlyInPolygon(x, z, poly) {
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) if (distToSegment(x, z, poly[i], poly[j]) < 1e-5) return false;
  return pointInPolygon(x, z, poly);
}

function distToPolygon(x, z, poly) {
  if (pointInPolygon(x, z, poly)) return 0;
  let d = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) d = Math.min(d, distToSegment(x, z, poly[i], poly[j]));
  return d;
}

/** True when two polygons share area or touch (a vertex of one inside the other). Enough for axis-aligned rooms. */
function polygonsTouch(a, b) {
  return a.some((p) => pointInPolygon(p.x, p.y, b)) || b.some((p) => pointInPolygon(p.x, p.y, a));
}

const v2 = (p) => new Vector2(p[0], p[1]);
const v3 = (p) => new Vector3(p[0], p[1], p[2]);
const toPoly = (arr) => (arr || []).map(v2);
/** Vector3 from a spec [x, y, z] with y lifted onto the floor at floorY (no-op on the ground floor). */
const v3At = (p, floorY) => new Vector3(p[0], floorY ? p[1] + floorY : p[1], p[2]);

function boundsOf(poly) {
  const b = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
  for (const p of poly) {
    b.minX = Math.min(b.minX, p.x);
    b.maxX = Math.max(b.maxX, p.x);
    b.minZ = Math.min(b.minZ, p.y);
    b.maxZ = Math.max(b.maxZ, p.y);
  }
  return b;
}

/** Piecewise-linear [[u, h], …] lookup; steps (two points with the same u) take the left segment's value at the step. */
function profileAt(profile, u) {
  if (!profile.length) return 0;
  if (u <= profile[0][0]) return profile[0][1];
  for (let i = 0; i < profile.length - 1; i++) {
    const [u0, h0] = profile[i];
    const [u1, h1] = profile[i + 1];
    if (u1 - u0 < EPS) continue;
    if (u <= u1 + EPS) return h0 + ((h1 - h0) * (u - u0)) / (u1 - u0);
  }
  return profile[profile.length - 1][1];
}

/** Deep-freezes plain objects, arrays and three.js value objects (vectors, boxes). */
function deepFreeze(obj, seen = new Set()) {
  if (obj === null || typeof obj !== 'object' || seen.has(obj)) return obj;
  seen.add(obj);
  for (const key of Object.keys(obj)) deepFreeze(obj[key], seen);
  return Object.freeze(obj);
}

function deepClone(v) {
  return v === undefined ? undefined : JSON.parse(JSON.stringify(v));
}

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const NONE = Object.freeze([]);
/** { levelId: entries[] } of a list of entries with levelId (precomputed, so the queries allocate nothing). */
function groupByLevel(list) {
  const out = {};
  for (const e of list) (out[e.levelId] ||= []).push(e);
  return out;
}

/** Call site of the function that called the caller of this one (dev warnings: once per call site). */
function callSite() {
  const lines = String(new Error().stack || '').split('\n').map((s) => s.trim()).filter(Boolean);
  // [0] 'Error' (V8) / callSite (Firefox), then callSite, ceilingHeightAt, the caller
  const i = lines[0] === 'Error' ? 3 : 2;
  return lines[i] || lines[lines.length - 1] || '?';
}

// ---------------------------------------------------------------------------------------------------------------
// Stairs: the walking surface (a ramp along the walk line, §3.1) as a function of the plan point

/**
 * Walk line and surface of a stair. The surface runs from the upper floor at the top nosing line to the lower floor at
 * the bottom nosing line (the collision wedge ends on the floor at the lowest riser, §3.1). Straight stairs project on
 * the line top → foot; half-turn stairs around a well (top.down = −foot.down) follow the upper flight's centre line to
 * the far end of the well, a half ellipse around it through the middle of the turn, and the lower flight's centre
 * line – in the turn the height follows the angle around the well (radial winders).
 * @returns {{ walkLine: Vector2[], length: number, param: (x: number, z: number) => number }}
 */
function stairWalk(st, footprint, well) {
  const mid = (edge) => v2(edge[0]).add(v2(edge[1])).multiplyScalar(0.5);
  const T = mid(st.top.edge);
  const F = mid(st.foot.edge);
  const dT = v2(st.top.down).normalize();
  const dF = v2(st.foot.down).normalize();
  const along = (p, o, d) => (p.x - o.x) * d.x + (p.y - o.y) * d.y;
  if (well.length >= 3 && dT.dot(dF) < -0.9) {
    const farD = Math.max(0, ...well.map((p) => along(p, T, dT)));
    const maxD = Math.max(farD + 0.1, ...footprint.map((p) => along(p, T, dT)));
    const A = T.clone().addScaledVector(dT, farD);
    const B = F.clone().addScaledVector(dF, -(farD - along(F, T, dT)));
    const K = A.clone().add(B).multiplyScalar(0.5);
    const eAB = B.clone().sub(A);
    const a = Math.max(0.05, eAB.length() / 2);
    eAB.normalize();
    const b = Math.max(0.05, (maxD - farD) / 2);
    const N = 32;
    const arc = [];
    for (let i = 0; i <= N; i++) {
      const phi = (Math.PI * i) / N;
      arc.push(K.clone().addScaledVector(eAB, -a * Math.cos(phi)).addScaledVector(dT, b * Math.sin(phi)));
    }
    const arcCum = [0];
    for (let i = 1; i <= N; i++) arcCum.push(arcCum[i - 1] + arc[i].distanceTo(arc[i - 1]));
    const sA = T.distanceTo(A);
    const sB = sA + arcCum[N];
    const lenFB = F.distanceTo(B);
    const length = sB + lenFB;
    const param = (x, z) => {
      const p = new Vector2(x, z);
      const v = along(p, K, dT);
      if (v > 0) {
        const u = -along(p, K, eAB);
        const phi = clamp(Math.atan2(v / b, u / a), 0, Math.PI);
        const f = (phi / Math.PI) * N;
        const i = Math.min(N - 1, Math.floor(f));
        return sA + arcCum[i] + (arcCum[i + 1] - arcCum[i]) * (f - i);
      }
      if (along(p, K, eAB) < 0) return clamp(along(p, T, dT), 0, sA);
      return sB + clamp(along(p, B, dF), 0, lenFB);
    };
    return { walkLine: [T, A, ...arc.slice(1, N), B, F], length, param };
  }
  const length = Math.max(EPS, T.distanceTo(F));
  const d = F.clone().sub(T).normalize();
  return { walkLine: [T, F], length, param: (x, z) => clamp(along(new Vector2(x, z), T, d), 0, length) };
}

/** The walk of a plan stair (stairtypes.js stairPlan) in stairWalk's form. */
function planWalk(plan) {
  const L = plan.length;
  const us = [];
  for (let u = 0; u < L; u += 0.1) us.push(u);
  us.push(L);
  return { walkLine: us.map((u) => v2(plan.at(u).p)), length: L, param: (x, z) => clamp(plan.param([x, z]), 0, L) };
}

// ---------------------------------------------------------------------------------------------------------------

/**
 * Builds the layout object from a room spec (default: data/room-spec.json).
 * @param {Object} [spec]
 * @param {Object} [palette]
 * @param {{ devWarnings?: boolean }} [opts]  devWarnings: warn about 2-argument ceilingHeightAt calls in other
 *                                            rooms (default: Vite dev)
 * @returns {Readonly<Object>} the frozen layout (see the typedefs above and the fields at the end of this function)
 */
export function buildLayout(spec = roomSpec, palette = paletteData, { devWarnings = DEV } = {}) {
  const paints = {};
  for (const [key, p] of Object.entries(spec.meta?.paints || {})) paints[key] = palette?.walls?.[key]?.hex || p.hex;
  for (const [key, p] of Object.entries(palette?.walls || {})) if (!paints[key]) paints[key] = p.hex;

  /**
   * Resolves a paint name ('sand', 'marrakesh', a palette paint id/name) or '#hex' to '#rrggbb'.
   * @param {string} colorOrName
   * @returns {string}
   */
  function resolvePaint(colorOrName) {
    const s = String(colorOrName || '').trim();
    if (/^#[0-9a-f]{6}$/i.test(s)) return s.toLowerCase();
    const key = s.toLowerCase();
    if (paints[key]) return paints[key];
    const p = (palette?.paints || []).find((x) => x.id === s || String(x.name).toLowerCase() === key || x.code === s);
    return p ? p.hex : paints.sand || '#cfc5b4';
  }

  // ---- levels (top → bottom). Without spec.levels the ground floor is synthesised from meta (plan alias).
  const meta = spec.meta || {};
  const levelsRaw = [...(spec.levels || [])];
  if (!levelsRaw.some((l) => l.id === MAIN_LEVEL_ID)) levelsRaw.unshift({ id: MAIN_LEVEL_ID, name: '1. etasje', floorY: 0, slabThickness: DEFAULT_SLAB, ceilingDefault: 2.4 });
  const levels = levelsRaw
    .map((l) => {
      const mainPlan = l.id === MAIN_LEVEL_ID && meta.planFile ? { file: meta.planFile, pxPerM: meta.planPxPerM, originPx: meta.planOriginPx } : null;
      const plan = deepClone(l.plan) ?? deepClone(mainPlan) ?? null;
      if (plan) plan.pxPerMXZ = Array.isArray(plan.pxPerM) ? [...plan.pxPerM] : [plan.pxPerM, plan.pxPerM];
      const floorY = l.floorY ?? 0;
      const slabThickness = l.slabThickness ?? DEFAULT_SLAB;
      return {
        id: l.id,
        name: l.name ?? l.id,
        floorY,
        slabThickness,
        /** underside of the slab under this level = the boundary to the level below */
        bottomY: floorY - slabThickness,
        ceilingDefault: l.ceilingDefault ?? 2.4,
        plan,
        estimated: deepClone(l.estimated) ?? [],
        source: l.source ?? '',
      };
    })
    .sort((a, b) => b.floorY - a.floorY);
  levels.forEach((l, i) => {
    l.index = i;
    l.aboveId = i > 0 ? levels[i - 1].id : null;
    l.belowId = i < levels.length - 1 ? levels[i + 1].id : null;
  });
  const levelsById = Object.fromEntries(levels.map((l) => [l.id, l]));
  const mainLevel = levelsById[MAIN_LEVEL_ID];

  /**
   * Level at a height. Bands: a level reaches down to the underside of its slab (bottomY); the lowest level takes
   * everything below, the top level everything above. With `previousId` the level only changes once y is
   * LEVEL_HYSTERESIS past the band (pass the body centre, feet + 0.9: the top of the stair stays on the upper level).
   * @param {number} y  world y
   * @param {string|null} [previousId]
   * @returns {Object} the level
   */
  function levelAt(y, previousId = null) {
    let i = 0;
    while (i < levels.length - 1 && y < levels[i].bottomY) i++;
    const prev = previousId ? levelsById[previousId] : null;
    if (prev && prev.index !== i) {
      const top = prev.index > 0 ? levels[prev.index - 1].bottomY : Infinity;
      const bottom = prev.index < levels.length - 1 ? prev.bottomY : -Infinity;
      if (y >= bottom - LEVEL_HYSTERESIS && y < top + LEVEL_HYSTERESIS) return prev;
    }
    return levels[i];
  }

  // ---- rooms, base info (level + floor height); the full room objects are made at the end
  const roomsRaw = [...(spec.rooms || [])];
  if (!roomsRaw.some((r) => r.id === LIVING_ROOM_ID)) {
    roomsRaw.unshift({ id: LIVING_ROOM_ID, name: 'Stue/kjøkken', levelId: MAIN_LEVEL_ID, kind: 'living', acoustic: { mode: 'calibrated' } });
  }
  const roomBase = {};
  for (const r of roomsRaw) {
    let lv = levelsById[r.levelId ?? MAIN_LEVEL_ID];
    if (!lv) {
      console.warn(`[layout] room ${r.id}: unknown level ${r.levelId} → '${MAIN_LEVEL_ID}'`);
      lv = mainLevel;
    }
    const floorOffset = r.floorOffset ?? 0;
    roomBase[r.id] = { levelId: lv.id, floorOffset, floorY: lv.floorY + floorOffset };
  }
  const warnedRooms = new Set();
  /** Room, level and floor height (world y) of a spec entry: its room's; without a room the living room's. */
  function placeOf(e) {
    const roomId = e?.roomId ?? LIVING_ROOM_ID;
    const rb = roomBase[roomId];
    if (rb) return { roomId, levelId: rb.levelId, floorY: rb.floorY };
    if (!warnedRooms.has(roomId)) {
      warnedRooms.add(roomId);
      console.warn(`[layout] ${e?.id ?? '?'}: unknown room ${roomId}`);
    }
    const lv = levelsById[e?.levelId] ?? mainLevel;
    return { roomId, levelId: lv.id, floorY: lv.floorY };
  }
  const isLiving = (x) => x.roomId === LIVING_ROOM_ID;

  // ---- walls + openings (all of the house; `walls` = the living room's)
  const allWalls = (spec.walls || []).map((w) => {
    const { roomId, levelId, floorY } = placeOf(w);
    const start = v2(w.from);
    const end = v2(w.to);
    const length = start.distanceTo(end);
    const dir = end.clone().sub(start).normalize();
    const normal = new Vector2(-dir.y, dir.x); // room on the right of start → end
    if (w.normal && (Math.abs(w.normal[0] - normal.x) > 1e-3 || Math.abs(w.normal[1] - normal.y) > 1e-3)) {
      console.warn(`[layout] wall ${w.id}: normal in spec ${w.normal} differs from derived ${normal.toArray()}`);
    }
    const dir3 = new Vector3(dir.x, 0, dir.y);
    const normal3 = new Vector3(normal.x, 0, normal.y);
    const topProfile = Array.isArray(w.topProfile) && w.topProfile.length
      ? w.topProfile.map(([u, h]) => [u, h])
      : [[0, w.height ?? 2.4], [length, w.height ?? 2.4]];
    const height = Math.max(...topProfile.map((p) => p[1]));
    const pointAt = (u, y = 0, out = new Vector3()) => out.set(start.x + dir.x * u, floorY ? y + floorY : y, start.y + dir.y * u);
    const backOf = w.backOf == null ? null : [].concat(w.backOf);
    const thickness = backOf ? 0 : (w.thickness ?? 0.1);

    const openings = (w.openings || []).map((o) => {
      const u0 = o.offset;
      const u1 = o.offset + o.width;
      const uc = (u0 + u1) / 2;
      const sill = o.sill ?? 0;
      const top = sill + o.height;
      const corners = [pointAt(u0, sill), pointAt(u1, sill), pointAt(u1, top), pointAt(u0, top)];
      const rect = new Box3().setFromPoints(corners);
      const back = normal3.clone().multiplyScalar(-(w.thickness ?? 0.1));
      const hole = rect.clone().union(new Box3().setFromPoints(corners.map((c) => c.clone().add(back))));
      return {
        id: o.id,
        type: o.type,
        name: o.name,
        wallId: w.id,
        roomId,
        levelId,
        floorY,
        offset: o.offset,
        width: o.width,
        height: o.height,
        sill,
        top,
        u0,
        u1,
        area: o.width * o.height,
        center: pointAt(uc, (sill + top) / 2),
        topCenter: pointAt(uc, top),
        bottomCenter: pointAt(uc, sill),
        normal: normal3.clone(),
        right: dir3.clone(),
        corners,
        rect,
        hole,
        revealDepth: o.reveal?.depth ?? w.thickness ?? 0.2,
        frame: deepClone(o.frame) ?? null,
        reveal: deepClone(o.reveal) ?? null,
        sillBoard: deepClone(o.sillBoard) ?? null,
        sashes: deepClone(o.sashes) ?? [],
        door: deepClone(o.door) ?? null,
        handle: deepClone(o.handle) ?? null,
        outsideView: o.outsideView ?? null,
        confidence: o.confidence ?? 'med',
        // filled in below, once every wall (and every backOf face) is known
        connects: Array.isArray(o.connects) ? [...o.connects] : null,
        interactive: typeof o.interactive === 'boolean' ? o.interactive : null,
        locked: !!o.locked,
        frosted: !!o.frosted,
        skyView: o.skyView ?? null,
        obstruction: o.obstruction ?? null,
        estimated: deepClone(o.estimated) ?? [],
        source: o.source ?? '',
      };
    });

    return {
      id: w.id,
      name: w.name,
      roomId,
      levelId,
      floorY,
      start,
      end,
      dir,
      normal,
      dir3,
      normal3,
      length,
      thickness,
      backOf,
      material: w.material ?? 'paint',
      paint: w.paint ?? w.color ?? 'sand',
      paintHex: resolvePaint(w.paint ?? w.color ?? 'sand'),
      exterior: !!w.exterior,
      isHigh: !!w.isHigh,
      hiddenBehindCabinets: !!w.hiddenBehindCabinets,
      height,
      topProfile,
      heightAt: (u) => profileAt(topProfile, u),
      pointAt,
      openings,
      holes: [],
      prevId: null,
      nextId: null,
      estimated: deepClone(w.estimated) ?? [],
      source: w.source ?? '',
      notes: w.notes ?? '',
    };
  });
  const houseWallsById = Object.fromEntries(allWalls.map((w) => [w.id, w]));

  // the clockwise loop of every room: previous / next wall = the one ending where this one starts / starting where it ends
  const wallsOfRoom = {};
  for (const w of allWalls) (wallsOfRoom[w.roomId] ||= []).push(w);
  for (const list of Object.values(wallsOfRoom)) {
    for (const w of list) {
      w.prevId = list.find((o) => o !== w && o.end.distanceTo(w.start) < 1e-3)?.id ?? null;
      w.nextId = list.find((o) => o !== w && o.start.distanceTo(w.end) < 1e-3)?.id ?? null;
    }
  }

  // holes: a wall's own openings, plus (on a backOf face) the openings of its partner slab mapped into the face's u
  const backFacesOf = {}; // owner wall id → ids of the faces that are its back
  for (const w of allWalls) {
    w.holes = w.openings.map((o) => ({ openingId: o.id, ownerWallId: w.id, type: o.type, u0: o.u0, u1: o.u1, sill: o.sill, top: o.top, door: !!o.door }));
  }
  for (const f of allWalls) {
    if (!f.backOf) continue;
    for (const pid of f.backOf) {
      const p = houseWallsById[pid];
      if (!p) {
        console.warn(`[layout] wall ${f.id}: backOf ${pid} does not exist`);
        continue;
      }
      (backFacesOf[pid] ||= []).push(f.id);
      const onFace = (pt) => (pt.x - f.start.x) * f.dir.x + (pt.z - f.start.y) * f.dir.y;
      for (const o of p.openings) {
        const a = onFace(p.pointAt(o.u0));
        const b = onFace(p.pointAt(o.u1));
        const u0 = Math.max(0, Math.min(a, b));
        const u1 = Math.min(f.length, Math.max(a, b));
        if (u1 - u0 < 1e-3) continue;
        const dy = p.floorY - f.floorY;
        f.holes.push({ openingId: o.id, ownerWallId: p.id, type: o.type, u0, u1, sill: o.sill + dy, top: o.top + dy, door: !!o.door });
      }
    }
    f.holes.sort((a, b) => a.u0 - b.u0);
  }

  const allOpenings = allWalls.flatMap((w) => w.openings);
  for (const o of allOpenings) {
    if (!o.connects) {
      const faces = (backFacesOf[o.wallId] || []).map((id) => houseWallsById[id]).filter((f) => f.holes.some((h) => h.openingId === o.id));
      o.connects = [...new Set([o.roomId, ...faces.map((f) => f.roomId)])];
    }
    if (o.interactive === null) o.interactive = !!o.door && o.connects.length === 2 && o.connects[0] !== o.connects[1] && o.connects.every((id) => !!roomBase[id]);
  }
  const houseOpeningsById = Object.fromEntries(allOpenings.map((o) => [o.id, o]));
  const isWindow = (o) => o.type === 'window' || o.type === 'terrace-door';
  const allDoors = allOpenings
    .filter((o) => o.door)
    .map((o) => {
      const swing = o.door.swing ?? 'in';
      const other = o.connects.find((id) => id !== o.roomId) ?? null;
      return {
        ...o,
        hinge: o.door.hinge ?? 'from',
        swing,
        leaf: o.door.leaf ?? { w: o.width - 2 * (o.frame?.width ?? 0.05), h: o.height - (o.frame?.width ?? 0.05) },
        openAngleDeg: o.door.openAngleDeg ?? 90,
        opensInto: o.door.opensInto ?? (swing === 'in' ? o.roomId : other),
        casing: { front: o.door.casing?.front !== false, back: o.door.casing?.back !== false },
        // Door.js frame: origin = bottom centre on the wall's room-side face, x = right, y = up, z = into the room.
        basis: { origin: o.bottomCenter.clone(), xAxis: o.right.clone(), yAxis: new Vector3(0, 1, 0), zAxis: o.normal.clone() },
      };
    });

  const walls = allWalls.filter(isLiving);
  const wallsById = Object.fromEntries(walls.map((w) => [w.id, w]));
  const openings = walls.flatMap((w) => w.openings);
  const openingsById = Object.fromEntries(openings.map((o) => [o.id, o]));
  const windows = openings.filter(isWindow);
  const doors = allDoors.filter(isLiving);

  // ---- floor + zones
  const floorPoly = toPoly(spec.floor?.polygon);
  const floorBounds = boundsOf(floorPoly);
  const floor = {
    ...deepClone(spec.floor),
    polygon: floorPoly,
    area: polygonArea(floorPoly),
    centroid: polygonCentroid(floorPoly),
    bounds: floorBounds,
    contains: (x, z) => pointInPolygon(x, z, floorPoly),
  };
  const allZones = (spec.zones || []).map((zn) => {
    const { roomId, levelId, floorY } = placeOf(zn);
    const polygon = toPoly(zn.polygon);
    const b = boundsOf(polygon);
    return {
      id: zn.id,
      name: zn.name,
      roomId,
      levelId,
      floorY,
      polygon,
      area: polygonArea(polygon),
      centroid: polygonCentroid(polygon),
      bounds: b,
      box: new Box3(new Vector3(b.minX, floorY, b.minZ), new Vector3(b.maxX, floorY + ZONE_BOX_TOP, b.maxZ)),
      contains: (x, z) => pointInPolygon(x, z, polygon),
    };
  });
  const zones = allZones.filter(isLiving);
  const zoneAt = (x, z) => zones.find((zn) => zn.contains(x, z)) || null;

  // ---- ceilings (heightAt = above the room's floor, topAt = world y)
  const allCeilings = (spec.ceilings || []).map((c) => {
    const { roomId, levelId, floorY } = placeOf(c);
    const polygon = toPoly(c.polygon);
    let heightAt;
    let slope = 0;
    if (c.type === 'slope' && c.highLine && c.lowLine) {
      const h0 = v2(c.highLine[0]);
      const h1 = v2(c.highLine[1]);
      const along = h1.clone().sub(h0).normalize();
      const across = new Vector2(-along.y, along.x);
      const lowPoint = v2(c.lowLine[0]);
      if (across.dot(lowPoint.clone().sub(h0)) < 0) across.negate();
      const span = across.dot(lowPoint.clone().sub(h0));
      slope = (c.highHeight - c.lowHeight) / span;
      const lo = Math.min(c.highHeight, c.lowHeight);
      const hi = Math.max(c.highHeight, c.lowHeight);
      heightAt = (x, z) => {
        const d = across.x * (x - h0.x) + across.y * (z - h0.y);
        return Math.max(lo, Math.min(hi, c.highHeight - slope * d));
      };
    } else {
      const h = c.height ?? levelsById[levelId]?.ceilingDefault ?? 2.4;
      heightAt = () => h;
    }
    const area = polygonArea(polygon);
    const centroid = polygonCentroid(polygon);
    return {
      id: c.id,
      name: c.name,
      roomId,
      levelId,
      floorY,
      type: c.type ?? 'flat',
      paint: c.paint ?? c.color ?? 'sand',
      paintHex: resolvePaint(c.paint ?? c.color ?? 'sand'),
      trim: c.trim ?? null,
      polygon,
      area,
      centroid,
      height: c.height ?? null,
      highHeight: c.highHeight ?? null,
      lowHeight: c.lowHeight ?? null,
      slope,
      formula: c.formula ?? null,
      heightAt,
      topAt: (x, z) => floorY + heightAt(x, z),
      /** floor openings of the level above that cut this ceiling (Vector2 polygons; filled in below) */
      holes: [],
      estimated: deepClone(c.estimated) ?? [],
      source: c.source ?? '',
      // A plane ceiling's mean height is its height at the area centroid, so this is exact for flat + sloped.
      volume: area * heightAt(centroid.x, centroid.y),
    };
  });
  const ceilings = allCeilings.filter(isLiving);

  // ---- bulkheads (vertical drops in the ceiling)
  const allBulkheads = (spec.bulkheads || []).map((b) => {
    const { roomId, levelId, floorY } = placeOf(b);
    const start = v2(b.from);
    const end = v2(b.to);
    const length = start.distanceTo(end);
    const faces = v2(b.faces || [1, 0]).normalize();
    const depth = b.depth ?? 0.1;
    const top = b.top ?? 3;
    const topAtTo = b.topAtTo ?? top;
    // The face lies on the from → to line; the bulkhead's depth extends behind it (against faceNormal).
    const fb = boundsOf([start, end, start.clone().addScaledVector(faces, -depth), end.clone().addScaledVector(faces, -depth)]);
    return {
      id: b.id,
      name: b.name,
      roomId,
      levelId,
      floorY,
      start,
      end,
      length,
      faceNormal: new Vector3(faces.x, 0, faces.y),
      depth,
      bottom: b.bottom ?? 2.4,
      top,
      topAtTo,
      topFollows: b.topFollows ?? null,
      paint: b.paint ?? 'sand',
      paintHex: resolvePaint(b.paint ?? 'sand'),
      footprint: fb,
      /** Top edge height at t ∈ [0, 1] from start to end. */
      topAt: (t) => top + (topAtTo - top) * Math.max(0, Math.min(1, t)),
      notes: b.notes ?? '',
    };
  });
  const bulkheads = allBulkheads.filter(isLiving);
  const ceilingsByLevel = groupByLevel(allCeilings);
  const bulkheadsByLevel = groupByLevel(allBulkheads);

  /** Ceiling height of one ceiling list at a plan point, lowered under the bulkheads (null: no ceiling at all). */
  function ceilingIn(list, bulks, x, z) {
    let ceiling = list.find((c) => pointInPolygon(x, z, c.polygon));
    if (!ceiling) {
      let best = Infinity;
      for (const c of list) {
        const d = distToPolygon(x, z, c.polygon);
        if (d < best) {
          best = d;
          ceiling = c;
        }
      }
    }
    let h = ceiling ? ceiling.heightAt(x, z) : 2.4;
    for (const b of bulks) {
      const f = b.footprint;
      if (x > f.minX + EPS && x < f.maxX - EPS && z > f.minZ + EPS && z < f.maxZ - EPS) h = Math.min(h, b.bottom);
    }
    return { ceiling, h };
  }

  let house = null; // set below; ceilingHeightAt(x, z, y) delegates to it
  const warnedSites = new Set();
  // new Error().stack is costly on hot paths (lamps.js ceilingAt, Placement drags every frame): the first 32 checks
  // always run, after that at most one per 250 ms – still one warning per call site
  let siteChecks = 0;
  let lastSiteCheck = 0;
  /**
   * Ceiling height at a plan point: flat 2.40 in the kitchen and TV-stue, the slope y = 3.00 − 0.16216·(x − 3.22)
   * over dining/living, lowered under bulkheads. Points outside every ceiling use the nearest one. Always the living
   * room's ceilings – pass y (world) for the house: ceilingHeightAt(x, z, y) = house.ceilingHeightAt(x, z, y).
   * @param {number} x
   * @param {number} z
   * @param {number} [y]  world y (any height in the room); given → the house's ceiling there, as world y
   * @returns {number}
   */
  function ceilingHeightAt(x, z, y) {
    if (y !== undefined && y !== null) return house.ceilingHeightAt(x, z, y);
    if (devWarnings && otherRooms.length && !floor.contains(x, z)) {
      const r = otherRooms.find((rm) => rm.contains(x, z));
      const now = r ? Date.now() : 0;
      if (r && (siteChecks < 32 || now - lastSiteCheck >= 250)) {
        siteChecks++;
        lastSiteCheck = now;
        const site = callSite();
        if (!warnedSites.has(site)) {
          warnedSites.add(site);
          console.warn(`[layout] ceilingHeightAt(${x.toFixed(2)}, ${z.toFixed(2)}) without y lies in «${r.name}» – this gives the living room's ceiling; pass y for the house (${site})`);
        }
      }
    }
    return ceilingIn(ceilings, bulkheads, x, z).h;
  }

  const volume = ceilings.reduce((s, c) => s + c.volume, 0);

  // ---- the high wall
  const hw = spec.highWall;
  const hwWall = wallsById[hw.wallId];
  const hwOrigin = new Vector3(hw.start[0], 0, hw.start[1]);
  const uDir = new Vector3(hw.uDir[0], 0, hw.uDir[1]).normalize();
  const hwNormal = new Vector3(hw.normal[0], 0, hw.normal[1]).normalize();
  const toWorld = (u, v, out = new Vector3()) => out.copy(hwOrigin).addScaledVector(uDir, u).setY(v);
  const highWall = {
    wallId: hw.wallId,
    name: hw.name,
    origin: hwOrigin,
    uDir,
    vDir: new Vector3(0, 1, 0),
    normal: hwNormal,
    width: hw.width,
    height: hw.height,
    area: hw.width * hw.height,
    start: v2(hw.start),
    end: v2(hw.end),
    paint: hw.paint ?? hwWall?.paint ?? 'sand',
    paintHex: resolvePaint(hw.paint ?? hwWall?.paint ?? 'sand'),
    rt60Today: hw.rt60Today ?? 0.86,
    rt60Target: deepClone(hw.rt60Target) ?? [0.4, 0.6],
    existing: hw.existing ?? '',
    obstacles: (hw.obstacles || []).map((o) => {
      const out = deepClone(o);
      if (typeof o.u === 'number' && typeof o.v === 'number') out.world = toWorld(o.u, o.v);
      if (Array.isArray(o.u)) out.world = o.u.map((u) => toWorld(u, hw.height));
      return out;
    }),
    /** World point for wall coordinates (u along uDir from the niche corner, v up from the floor). */
    toWorld,
    /** Wall coordinates { u, v, w } of a world point (w = distance in front of the wall). */
    toUV: (p) => {
      const dx = p.x - hwOrigin.x;
      const dz = p.z - hwOrigin.z;
      return { u: dx * uDir.x + dz * uDir.z, v: p.y, w: dx * hwNormal.x + dz * hwNormal.z };
    },
  };

  // ---- light groups: the six contract groups of the living room (code) + the house's groups (data, §4.10)
  const dataGroups = [];
  for (const g of spec.lightGroups || []) {
    if (LIGHT_GROUP_IDS.has(g.id) || dataGroups.some((d) => d.id === g.id)) {
      console.warn(`[layout] light group ${g.id} is defined twice – the first one is kept`);
      continue;
    }
    // a group with roomId null spans several rooms or none (boder, ute): it keeps null instead of becoming the living
    // room's (placeOf's default), so a lighting step that picks groups by room does not count it as stue-kjokken
    const { roomId, levelId } = g.roomId === null ? { roomId: null, levelId: levelsById[g.levelId]?.id ?? null } : placeOf(g);
    dataGroups.push({
      ...deepClone(g),
      id: g.id,
      label: g.label ?? g.id,
      roomId,
      levelId,
      // data: dimmer = dimmable (bool), defaultDimmer = the level it starts at; layout: dimmer = the start level
      dimmer: typeof g.defaultDimmer === 'number' ? g.defaultDimmer : typeof g.dimmer === 'number' ? g.dimmer : 1,
      dimmable: g.dimmer !== false,
      auto: g.auto ?? null,
    });
  }
  const dataGroupIds = new Set(dataGroups.map((g) => g.id));
  /** Light group of a light outside the living room that names none / an unknown one: its room's first group. */
  const roomGroupFallback = (roomId) => dataGroups.find((g) => g.roomId === roomId)?.id ?? roomId;

  // ---- built-in lights (stay in the shell; LightManager drives them)
  const allBuiltInLights = (spec.builtInLights || []).map((l) => {
    const { roomId, levelId, floorY } = placeOf(l);
    if (l.lightColorK == null && l.kelvin != null) console.warn(`[layout] light ${l.id}: use lightColorK, not kelvin (ignored)`);
    if (l.dims == null && l.diameter != null) console.warn(`[layout] light ${l.id}: use dims.d, not diameter (ignored)`);
    const group = lightGroupOf(l, { groups: dataGroupIds, fallback: roomId === LIVING_ROOM_ID ? 'kjokken' : roomGroupFallback(roomId) });
    const out = {
      id: l.id,
      roomId,
      levelId,
      floorY,
      group,
      specGroup: l.group,
      type: l.type,
      name: l.name,
      color: l.color ?? '#151515',
      accent: l.accent ?? null,
      colorK: l.lightColorK ?? 2700,
      dims: deepClone(l.dims) ?? {},
      notes: l.notes ?? '',
      emits: l.type !== 'track',
    };
    if (l.from && l.to) {
      out.from = v3At(l.from, floorY);
      out.to = v3At(l.to, floorY);
      out.length = out.from.distanceTo(out.to);
      out.lumensPerM = l.lumensPerM ?? 0;
      out.lumens = (l.lumensPerM ?? 0) * out.length;
    }
    if (l.position) {
      out.position = v3At(l.position, floorY);
      out.lumens = l.lumens ?? out.lumens ?? 0;
    }
    if (l.aimAt && l.position) {
      out.aimAt = v3At(l.aimAt, floorY);
      out.direction = out.aimAt.clone().sub(out.position).normalize();
      out.beamDeg = l.beamDeg ?? 36;
    }
    if (l.dims?.bottomY != null && l.position) out.bottom = new Vector3(l.position[0], floorY ? l.dims.bottomY + floorY : l.dims.bottomY, l.position[2]);
    if (!out.direction && out.position) out.direction = new Vector3(0, -1, 0);
    if (out.lumens == null) out.lumens = 0;
    return out;
  });
  const builtInLights = allBuiltInLights.filter(isLiving);
  const lightGroups = LIGHT_GROUPS.filter((g) => builtInLights.some((l) => l.group === g.id));

  // ---- kitchen (positions are box centres)
  const kitchen = {
    notes: spec.kitchen?.notes ?? '',
    items: (spec.kitchen?.items || []).map((k) => {
      const position = v3(k.position);
      const quarter = Math.round((k.rotationDeg ?? 0) / 90) % 2 !== 0;
      const sx = (quarter ? k.dims.d : k.dims.w) / 2;
      const sz = (quarter ? k.dims.w : k.dims.d) / 2;
      const sy = k.dims.h / 2;
      return {
        ...deepClone(k),
        position,
        box: new Box3(new Vector3(position.x - sx, position.y - sy, position.z - sz), new Vector3(position.x + sx, position.y + sy, position.z + sz)),
      };
    }),
  };

  // ---- fixtures (sockets, switches, smoke detectors, heat pump); `mount` from the data wins
  const allFixtures = (spec.fixtures || []).map((f) => {
    const { roomId, levelId, floorY } = placeOf(f);
    const wall = f.wallId ? houseWallsById[f.wallId] : null;
    return {
      ...deepClone(f),
      roomId,
      levelId,
      floorY,
      position: v3At(f.position, floorY),
      normal: wall ? wall.normal3.clone() : new Vector3(0, -1, 0),
      mount: f.mount ?? (wall ? 'wall' : 'ceiling'),
    };
  });
  const fixtures = allFixtures.filter(isLiving);

  // ---- furniture: raw spec entries (level-local y); the house's copies carry roomId + levelId
  const furniture = deepClone((spec.furniture || []).filter((f) => (f.roomId ?? LIVING_ROOM_ID) === LIVING_ROOM_ID)) || [];
  const allFurniture = (spec.furniture || []).map((f) => {
    const { roomId, levelId } = placeOf(f);
    return { ...deepClone(f), roomId, levelId };
  });

  // ---- built-ins (bathroom / laundry fittings, §1.2): furniture conventions, world position
  const allBuiltIns = (spec.builtIns || []).map((b) => {
    const { roomId, levelId, floorY } = placeOf(b);
    const wall = b.wallId ? houseWallsById[b.wallId] : null;
    if (b.wallId && !wall) console.warn(`[layout] built-in ${b.id}: wall ${b.wallId} does not exist`);
    return {
      ...deepClone(b),
      roomId,
      levelId,
      floorY,
      localPosition: [...(b.position || [0, 0, 0])],
      position: v3At(b.position || [0, 0, 0], floorY),
      rotationDeg: b.rotationDeg ?? 0,
      mount: b.mount ?? (wall ? 'wall' : 'floor'),
      normal: wall ? wall.normal3.clone() : null,
      collide: b.collide !== false,
    };
  });

  // ---- outside
  const outsideRaw = deepClone(spec.outside) || {};
  const outside = {
    ...outsideRaw,
    terrace: outsideRaw.terrace
      ? {
          ...outsideRaw.terrace,
          polygonV: toPoly(outsideRaw.terrace.polygon),
          annex: outsideRaw.terrace.annex ? { ...outsideRaw.terrace.annex, polygonV: toPoly(outsideRaw.terrace.annex.polygon) } : null,
          railingLinesV: (outsideRaw.terrace.railingLines || []).map((line) => line.map(v2)),
        }
      : null,
  };

  // ---- photo cameras (camera.rotation.order 'YXZ': y = yawDeg + 180, x = pitch, z = roll)
  const allPhotoCameras = (spec.photoCameras || []).map((c) => {
    const { roomId, levelId, floorY } = placeOf(c);
    const fileName = String(c.file).split('/').pop();
    const photoRect = c.photoRect ?? [0, 0, c.imageSize[0], c.imageSize[1]];
    return {
      id: fileName.replace(/\.[a-z]+$/i, ''),
      roomId,
      levelId,
      floorY,
      file: c.file,
      fileName,
      montage: c.file.startsWith('stue_hoy_vegg_forslag/'),
      pos: v3At(c.pos, floorY),
      lookAt: v3At(c.lookAt, floorY),
      yawDeg: c.yawDeg,
      pitchDeg: c.pitchDeg,
      rollDeg: c.rollDeg ?? 0,
      rotation: { x: c.pitchDeg * DEG, y: (c.yawDeg + 180) * DEG, z: (c.rollDeg ?? 0) * DEG, order: 'YXZ' },
      vfovDeg: c.vfovDeg,
      focalPx: c.focalPx,
      imageSize: [...c.imageSize],
      photoRect: [...photoRect],
      aspect: photoRect[2] / photoRect[3],
      k1: c.k1 ?? 0,
      confidence: c.confidence ?? 'med',
      source: c.source ?? '',
      notes: c.notes ?? '',
    };
  });
  const photoCameras = allPhotoCameras.filter(isLiving);
  const findCamera = (list) => (id) => list.find((c) => c.id === id || c.file === id || c.fileName === id) || null;

  // ---- floor openings (holes in a level's floor + slab, cut from the ceiling of the level below)
  const floorOpenings = (spec.floorOpenings || []).map((fo) => {
    const { roomId, levelId, floorY } = placeOf(fo);
    const polygon = toPoly(fo.polygon);
    return {
      ...deepClone(fo),
      roomId,
      levelId: fo.levelId ?? levelId,
      floorY,
      polygon,
      area: polygonArea(polygon),
      centroid: polygonCentroid(polygon),
      bounds: boundsOf(polygon),
      /** strictly inside: the rim of the hole is still floor */
      contains: (x, z) => pointStrictlyInPolygon(x, z, polygon),
    };
  });
  const floorOpeningsById = Object.fromEntries(floorOpenings.map((fo) => [fo.id, fo]));
  const holesByLevel = groupByLevel(floorOpenings);
  const holesOnLevel = (levelId) => holesByLevel[levelId] || NONE;
  for (const c of allCeilings) {
    const above = levelsById[c.levelId]?.aboveId;
    if (above) c.holes = holesOnLevel(above).filter((fo) => polygonsTouch(fo.polygon, c.polygon)).map((fo) => fo.polygon);
  }

  // ---- stairs (no absolute y in the data: the rise is the floorY difference of the two levels)
  const stairs = (spec.stairs || []).map((st) => {
    const lower = levelsById[st.fromLevel] ?? levels[levels.length - 1];
    const upper = levelsById[st.toLevel] ?? mainLevel;
    const opening = floorOpeningsById[st.openingId] ?? null;
    if (st.openingId && !opening) console.warn(`[layout] stair ${st.id}: floor opening ${st.openingId} does not exist`);
    // the stair types (notes/trapper.md, stairtypes.js): an L without its own footprint gets the L, not the hole (its
    // lower flight may run on under the floor)
    let plan = null;
    if (isPlanType(st.type) && st.top?.edge && st.foot?.edge) {
      try {
        plan = stairPlan(st);
      } catch (err) {
        console.warn(`[layout] stair ${st.id}: ${err.message}`);
      }
    }
    const footprint = st.footprint?.length ? toPoly(st.footprint) : plan && isQuarterTurn(st.type) ? toPoly(plan.footprint) : opening ? opening.polygon.map((p) => p.clone()) : [];
    const wellPolygon = toPoly(st.well?.polygon);
    const topY = upper.floorY;
    const bottomY = lower.floorY;
    const rise = topY - bottomY;
    const risers = st.risers ?? (plan ? stairRisers(rise, plan) : Math.max(1, Math.round(rise / 0.18)));
    const walk = plan ? planWalk(plan) : st.top?.edge && st.foot?.edge && !isPlanType(st.type) ? stairWalk(st, footprint, wellPolygon) : null;
    const knots = plan ? rampKnots(plan, risers, topY, bottomY, st) : null;
    const contains = (x, z) => footprint.length >= 3 && pointInPolygon(x, z, footprint) && !(wellPolygon.length >= 3 && pointStrictlyInPolygon(x, z, wellPolygon));
    return {
      ...deepClone(st),
      ...(plan ? { holePolygon: opening ? opening.polygon.map((p) => [p.x, p.y]) : null } : {}),
      fromLevel: lower.id,
      toLevel: upper.id,
      roomIds: [...(st.roomIds || [])],
      risers,
      rise,
      riser: rise / risers,
      topY,
      bottomY,
      footprint,
      wellPolygon,
      walkLine: walk ? walk.walkLine : [],
      walkLength: walk ? walk.length : 0,
      /** mean going on the walk line (its length over risers − 1); the stair builder has the exact treads */
      going: walk && risers > 1 ? walk.length / (risers - 1) : null,
      contains,
      /** World y of the walking surface (ramp along the walk line) at a plan point; null outside the footprint. */
      surfaceY: (x, z) => {
        if (!walk || !contains(x, z)) return null;
        if (knots) return rampAt(knots, walk.param(x, z));
        return topY - (rise * walk.param(x, z)) / walk.length;
      },
    };
  });
  const stairsById = Object.fromEntries(stairs.map((s) => [s.id, s]));
  const stairsByLevel = Object.fromEntries(levels.map((lv) => [lv.id, stairs.filter((s) => s.fromLevel === lv.id || s.toLevel === lv.id)]));
  const stairsOnLevel = (levelId) => stairsByLevel[levelId] || NONE;

  // ---- door thresholds: floor-level openings, across the owner wall's thickness (walkable, §3.10)
  const thresholds = allOpenings
    .filter((o) => !isWindow(o) || o.type === 'terrace-door')
    .filter((o) => o.sill <= THRESHOLD_SILL)
    .map((o) => {
      const w = houseWallsById[o.wallId];
      const t = w.backOf ? 0 : w.thickness;
      const a = w.start.clone().addScaledVector(w.dir, o.u0);
      const b = w.start.clone().addScaledVector(w.dir, o.u1);
      const polygon = [a, b, b.clone().addScaledVector(w.normal, -t), a.clone().addScaledVector(w.normal, -t)];
      return { openingId: o.id, wallId: w.id, levelId: o.levelId, floorY: o.floorY + o.sill, polygon, contains: (x, z) => pointInPolygon(x, z, polygon) };
    });
  const thresholdsByLevel = groupByLevel(thresholds);

  // ---- rooms (full objects)
  const rooms = roomsRaw.map((r) => {
    const base = roomBase[r.id];
    const level = levelsById[base.levelId];
    const living = r.id === LIVING_ROOM_ID;
    const hud = r.kind === 'hud';
    const opening = r.openingId ? floorOpeningsById[r.openingId] : null;
    const polygon = r.polygon ? toPoly(r.polygon) : living ? floorPoly.map((p) => p.clone()) : opening ? opening.polygon.map((p) => p.clone()) : [];
    const area = polygonArea(polygon);
    const holes = hud ? [] : floorOpenings.filter((fo) => fo.levelId === base.levelId && fo.roomId === r.id);
    const ceilingIds = Array.isArray(r.ceilingIds) ? [...r.ceilingIds] : allCeilings.filter((c) => c.roomId === r.id).map((c) => c.id);
    const roomCeilings = allCeilings.filter((c) => ceilingIds.includes(c.id));
    const vol = roomCeilings.length ? roomCeilings.reduce((s, c) => s + c.volume, 0) : area * level.ceilingDefault;
    const ceilingTop = roomCeilings.length
      ? Math.max(...roomCeilings.map((c) => c.floorY + Math.max(c.highHeight ?? 0, c.lowHeight ?? 0, c.height ?? 0, c.heightAt(c.centroid.x, c.centroid.y))))
      : base.floorY + level.ceilingDefault;
    // the clockwise loop, starting at the first wall of the spec
    const list = wallsOfRoom[r.id] || [];
    const wallIds = [];
    for (let w = list[0]; w && !wallIds.includes(w.id); w = houseWallsById[w.nextId]) wallIds.push(w.id);
    for (const w of list) if (!wallIds.includes(w.id)) wallIds.push(w.id);
    let yRange = null;
    if (Array.isArray(r.yRange)) yRange = [base.floorY + r.yRange[0], base.floorY + r.yRange[1]];
    else if (hud) {
      const st = stairsById[r.stairId] ?? stairsById[opening?.stairId] ?? null;
      yRange = st ? [st.bottomY, st.topY + STAIR_HUD_TOP] : [base.floorY, base.floorY + level.ceilingDefault];
    }
    const contains = (x, z) => polygon.length >= 3 && pointInPolygon(x, z, polygon);
    return {
      id: r.id,
      name: r.name ?? r.id,
      levelId: base.levelId,
      levelName: level.name,
      kind: r.kind ?? (living ? 'living' : 'room'),
      hud,
      floorOffset: base.floorOffset,
      floorY: base.floorY,
      polygon,
      area,
      /** floor area without the holes in it (the stairwell of the hall) */
      netArea: area - holes.reduce((s, fo) => s + fo.area, 0),
      centroid: polygon.length ? polygonCentroid(polygon) : new Vector2(),
      bounds: boundsOf(polygon),
      // the living room's floor is the spec's `floor` (material, colour, planks …) unless its room entry has its own
      floor: living ? { ...deepClone(spec.floor), ...deepClone(r.floor) } : deepClone(r.floor) ?? null,
      holeIds: holes.map((fo) => fo.id),
      ceilingIds,
      wallIds,
      volume: living ? volume : vol,
      ceilingTop,
      yRange,
      acoustic: deepClone(r.acoustic) ?? { mode: living ? 'calibrated' : 'estimate' },
      autoLight: r.autoLight ?? null,
      closed: !!r.closed,
      estimated: deepClone(r.estimated) ?? [],
      source: r.source ?? '',
      /** plan test */
      contains,
      /** 3D test: plan + the room's level band (levelAt), or for a hud room its yRange (world) */
      containsPoint: (x, y, z) => contains(x, z) && (hud ? y >= yRange[0] && y <= yRange[1] : levelAt(y).id === base.levelId),
    };
  });
  for (const rm of rooms) if (rm.floor && 'polygon' in rm.floor) delete rm.floor.polygon;
  const roomsById = Object.fromEntries(rooms.map((rm) => [rm.id, rm]));
  const physicalRooms = rooms.filter((rm) => !rm.hud && rm.polygon.length >= 3);
  const hudRooms = rooms.filter((rm) => rm.hud && rm.polygon.length >= 3);
  const otherRooms = physicalRooms.filter((rm) => rm.id !== LIVING_ROOM_ID);
  const roomsByLevel = groupByLevel(physicalRooms);
  for (const lv of levels) lv.roomIds = rooms.filter((rm) => rm.levelId === lv.id).map((rm) => rm.id);

  /**
   * Room at a point. physical (default): the room of the level at y whose plan contains (x, z) – lighting and
   * acoustics never see hud rooms. physical:false (the HUD banner): hud rooms (the stair) are tested first, by their
   * world yRange. Pass the body centre (feet + 0.9) and the previous level for hysteresis.
   * @param {number} x
   * @param {number} y  world y
   * @param {number} z
   * @param {{ physical?: boolean, levelId?: string, previousLevelId?: string }} [opts]
   */
  function roomAt(x, y, z, { physical = true, levelId = null, previousLevelId = null } = {}) {
    const yy = y ?? 0;
    if (!physical) for (const rm of hudRooms) if (rm.containsPoint(x, yy, z)) return rm;
    const lv = levelId ? levelsById[levelId] : levelAt(yy, previousLevelId);
    if (!lv) return null;
    return (roomsByLevel[lv.id] || NONE).find((rm) => rm.contains(x, z)) || null;
  }

  /**
   * World y of the floor under (or just above, ≤ STEP_UP) a point: room floors (minus holes), stair surfaces and door
   * thresholds; the highest one that is at most STEP_UP above y. Without y the highest surface there. null when the
   * point is on no floor of the house (outside, inside a wall, over the well).
   * @param {number} x
   * @param {number} z
   * @param {number} [y]  world y (feet)
   * @returns {number|null}
   */
  function floorYAt(x, z, y) {
    const lim = y == null ? Infinity : y + STEP_UP;
    let best = null;
    const take = (h) => {
      if (h <= lim + EPS && (best === null || h > best)) best = h;
    };
    for (const rm of physicalRooms) if (rm.contains(x, z) && !holesOnLevel(rm.levelId).some((fo) => fo.contains(x, z))) take(rm.floorY);
    for (const st of stairs) {
      const h = st.surfaceY(x, z);
      if (h !== null) take(h);
    }
    for (const t of thresholds) if (t.contains(x, z)) take(t.floorY);
    return best;
  }

  /**
   * Inside the house on the level at y: the union of the level's rooms, plus door thresholds and stair footprints,
   * minus the holes in its floor.
   * @param {number} x
   * @param {number} z
   * @param {number} [y=0]  world y (feet)
   * @param {string|null} [previousLevelId]  hysteresis (see levelAt)
   */
  function isInsideHouse(x, z, y = 0, previousLevelId = null) {
    const lv = levelAt(y, previousLevelId);
    if ((roomsByLevel[lv.id] || NONE).some((rm) => rm.contains(x, z)) && !holesOnLevel(lv.id).some((fo) => fo.contains(x, z))) return true;
    if (stairsOnLevel(lv.id).some((st) => st.contains(x, z))) return true;
    return (thresholdsByLevel[lv.id] || NONE).some((t) => t.contains(x, z));
  }

  /**
   * Ceiling at a point of the house, as WORLD y: the ceilings of the level at y (nearest one outside them), lowered
   * under its bulkheads. Inside a hole of the level above (the stairwell) the ceiling of that level counts.
   * @param {number} x
   * @param {number} z
   * @param {number} [y=0]  world y
   * @returns {number}
   */
  function houseCeilingHeightAt(x, z, y = 0) {
    let lv = levelAt(y);
    for (let guard = 0; guard < levels.length && lv.aboveId && holesOnLevel(lv.aboveId).some((fo) => fo.contains(x, z)); guard++) lv = levelsById[lv.aboveId];
    const list = ceilingsByLevel[lv.id] || NONE;
    if (!list.length) return lv.floorY + lv.ceilingDefault;
    const { ceiling, h } = ceilingIn(list, bulkheadsByLevel[lv.id] || NONE, x, z);
    return (ceiling ? ceiling.floorY : lv.floorY) + h;
  }

  // ---- bounds per level (rooms + stairs), the whole house, and the walk rectangles for the collision bounds
  const levelBoundsById = {};
  for (const lv of levels) {
    const rs = physicalRooms.filter((rm) => rm.levelId === lv.id);
    const pts = [...rs.flatMap((rm) => rm.polygon), ...stairsOnLevel(lv.id).flatMap((st) => st.footprint)];
    const b = pts.length ? boundsOf(pts) : { minX: 0, maxX: 0, minZ: 0, maxZ: 0 };
    b.minY = rs.length ? Math.min(...rs.map((rm) => rm.floorY)) : lv.floorY;
    b.maxY = rs.length ? Math.max(...rs.map((rm) => rm.ceilingTop)) : lv.floorY + lv.ceilingDefault;
    levelBoundsById[lv.id] = b;
  }
  const houseBounds = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity, minY: Infinity, maxY: -Infinity };
  for (const b of Object.values(levelBoundsById)) {
    houseBounds.minX = Math.min(houseBounds.minX, b.minX);
    houseBounds.maxX = Math.max(houseBounds.maxX, b.maxX);
    houseBounds.minZ = Math.min(houseBounds.minZ, b.minZ);
    houseBounds.maxZ = Math.max(houseBounds.maxZ, b.maxZ);
    houseBounds.minY = Math.min(houseBounds.minY, b.minY);
    houseBounds.maxY = Math.max(houseBounds.maxY, b.maxY);
  }
  // one rectangle per level (inset 5 cm like the old setBounds); y = the level's band for the feet
  const walkRects = levels.map((lv, i) => {
    const b = levelBoundsById[lv.id];
    return {
      levelId: lv.id,
      minX: b.minX + 0.05,
      maxX: b.maxX - 0.05,
      minZ: b.minZ + 0.05,
      maxZ: b.maxZ - 0.05,
      minY: i < levels.length - 1 ? lv.bottomY : -Infinity,
      maxY: i > 0 ? levels[i - 1].bottomY : Infinity,
    };
  });

  /**
   * The whole house (§1.8). Lists hold every entry (the living room's included, same objects as the old fields);
   * each entry has roomId, levelId and floorY.
   */
  house = {
    levels,
    levelsById,
    level: (id) => levelsById[id] || null,
    levelAt,
    rooms,
    roomsById,
    room: (id) => roomsById[id] || null,
    roomAt,
    walls: allWalls,
    wallsById: houseWallsById,
    wall: (id) => houseWallsById[id] || null,
    /** ids of the backOf faces of a wall (the faces whose `backOf` names it) */
    backFacesOf: (id) => backFacesOf[id] || [],
    openings: allOpenings,
    openingsById: houseOpeningsById,
    opening: (id) => houseOpeningsById[id] || null,
    windows: allOpenings.filter(isWindow),
    doors: allDoors,
    thresholds,
    zones: allZones,
    ceilings: allCeilings,
    bulkheads: allBulkheads,
    builtInLights: allBuiltInLights,
    lightGroups: [...lightGroups.map((g) => ({ ...g, roomId: LIVING_ROOM_ID, levelId: MAIN_LEVEL_ID, dimmable: true, auto: null })), ...dataGroups],
    fixtures: allFixtures,
    furniture: allFurniture,
    builtIns: allBuiltIns,
    photoCameras: allPhotoCameras,
    photoCamera: findCamera(allPhotoCameras),
    floorOpenings,
    stairs,
    outsideHouse: deepClone(spec.outsideHouse) ?? null,
    floorYAt,
    isInside: isInsideHouse,
    ceilingHeightAt: houseCeilingHeightAt,
    bounds: houseBounds,
    levelBounds: (id) => levelBoundsById[id] || null,
    walkRects,
  };

  const layout = {
    spec,
    meta: deepClone(spec.meta),
    paints,
    resolvePaint,
    walls,
    wallsById,
    wall: (id) => wallsById[id] || null,
    openings,
    openingsById,
    opening: (id) => openingsById[id] || null,
    windows,
    doors,
    floor,
    baseboard: deepClone(spec.baseboard) ?? { height: 0.07, thickness: 0.012, color: '#e9e6df' },
    zones,
    zoneAt,
    ceilings,
    ceilingHeightAt,
    bulkheads,
    highWall,
    builtInLights,
    lightGroups,
    kitchen,
    fixtures,
    furniture,
    outside,
    photoCameras,
    photoCamera: findCamera(photoCameras),
    /** Interior bounding rectangle of the floor (plan). */
    bounds: floorBounds,
    floorArea: floor.area,
    /** Air volume: the ceiling integrated over the floor polygon (≈ 138.6 m³). */
    volume,
    isInside: floor.contains,
    /** The whole house: levels, rooms, every surface, stairs and the level-aware queries (§1.8). */
    house,
  };
  return deepFreeze(layout);
}

/** The layout of the real room (data/room-spec.json). */
export const layout = buildLayout();
export default layout;
