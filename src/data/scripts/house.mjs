#!/usr/bin/env node
/**
 * Hele huset (notes/hele-huset-design.md §1.7): merges research/house/NN-*.json into the room-spec and validates the
 * whole house. normalize-data.mjs runs
 *
 *   fixRoomSpec(mergeHouse(readJson('research/room-spec.json'), RESEARCH))  →  validateHouse(spec)  →  src/data/room-spec.json
 *
 * and writes the measuring list (every `estimated` field, sorted by room) into research/room-spec-notes.md.
 *
 * mergeHouse(spec, researchDir, { files?, registry?, log? }) → a new spec (the input is not changed)
 *   - reads every research/house/NN-name.json in sorted order; 00-ids.json is the id register and is NOT merged;
 *   - `levelId` / `roomId` set on the file are stamped on the entries that lack them;
 *   - arrays are replaced or extended by id (photoCameras by their file name), `kitchen.items` by id, `outside`,
 *     `outsideHouse` and other objects are deep-merged (null removes a key);
 *   - `wallOpenings: [{ wallId, openings }]` patches the openings of an existing wall without copying the wall: an
 *     opening with an id that is already there is deep-merged, a new one is appended;
 *   - new top-level keys go last, in the order of the register's schema.topLevel, so the key order is stable;
 *   - meta, floor, baseboard and highWall cannot be changed from the house files (the living room is photo-measured);
 *   - replacing a frozen (photo-measured) entry by id prints a console warning – the validator cannot see it afterwards.
 *
 * validateHouse(spec, { registry?, archetypes?, throw? }) → report; throws (like mapArchetype) when there are errors.
 *   Integrity is always an error: ids (unique per namespace, syntax, prefixes, the frozen ids still there, levels /
 *   rooms / light groups registered in 00-ids.json), the schema, references, wall loops that close the room polygon
 *   with the normal inwards, overlapping rooms (with wall thickness), double walls, backOf pairs, openings that fit
 *   their wall, the door format, connects / opensInto against swing, holes inside their room, known (canonical, not
 *   alias) archetypes, a roomId on every new wall / zone / ceiling / bulkhead / light / furniture / fixture / photo
 *   camera (without one it lands in the living room; only the frozen ids may lack it), and the
 *   free width (≥ 0,75 m) between an open door leaf and railings / walls (D6: the opening angle is a modelling choice,
 *   so a leaf that cuts a passage is always fixable in the data, however uncertain the measurements around it are).
 *   The plausibility checks – stair numbers (§1.6; riser = −floorY / risers, going = walk line / (risers − 1), nothing
 *   hard-codes a number of risers), headroom, the stair footprint, doors over the stair, a door over a hole, the tread
 *   edges (with nosing) and the stringer foot at least DOOR_FRAME_CLEARANCE from every door frame (avstemming V17, §2.4)
 *   – are errors for measured values and warnings when a value involved is listed in `estimated` (§8.6). Control
 *   areas (> 10 %) and door heights under the stair (an opening under a tread, not one beside the foot) are always
 *   warnings. A room or light group that is registered in 00-ids.json but not modelled yet (another step's house file
 *   brings it – the steps are built in parallel) is one warning per id instead of an error; an id that is not
 *   registered stays an error.
 *
 * Pure Node (no three.js); stairWalk() is the same walk line the validator measures the going on: for a half-turn
 * stair the line of avstemming V13 (the middle of the free width, quarter arcs around the well's two far corners).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveRoofs, roofField, ceilingSurface, surfaceProfile, insideHalfPlanes as insideHalfPlanesOf } from '../../home/roofgeom.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../..');
export const RESEARCH_DIR = path.join(ROOT, 'research');
export const HOUSE_FILE = /^\d\d-.+\.json$/;
export const REGISTRY_FILE = '00-ids.json';
export const STUE = 'stue-kjokken';
export const HOVED = 'hoved';

/** Minimum free width past an open door leaf (§1.7). */
export const FREE_WIDTH = 0.75;
/** Headroom along the nosing line: warning below 2.0, game limit 1.95 (§1.6). */
export const HEADROOM_WARN = 2.0;
export const HEADROOM_MIN = 1.95;
/** Control areas: more than 10 % off gives a warning. */
export const AREA_TOLERANCE = 0.1;
/** The field in front of the lowest tread that no door may swing over. */
export const FOOT_FIELD = 0.9;
/** Stair norms (§1.6). */
export const RISER_RANGE = [0.15, 0.22];
export const STEP_RANGE = [0.6, 0.64];
export const MIN_GOING = 0.22;
/** Tread edges (with nosing) and the stringer foot keep at least this from every door frame (avstemming V17, §2.4). */
export const DOOR_FRAME_CLEARANCE = 0.05;

const TOL = 0.005; // 5 mm: points, distances between faces
const AREA_EPS = 0.002; // m²: overlaps below this are rounding

const DEFAULT_PROTECTED = ['meta', 'floor', 'baseboard', 'highWall'];
/** Collections whose entries get the file's roomId / levelId. */
const ROOM_STAMPED = new Set(['walls', 'ceilings', 'bulkheads', 'builtInLights', 'fixtures', 'furniture', 'builtIns', 'photoCameras', 'lightGroups', 'zones', 'floorOpenings']);
const LEVEL_STAMPED = new Set(['rooms', 'floorOpenings']);

// ---------------------------------------------------------------------------------------------------------------
// Small helpers

const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const arr = (v) => (Array.isArray(v) ? v : []);
const num = (v) => typeof v === 'number' && Number.isFinite(v);
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const isPoint = (p) => Array.isArray(p) && p.length === 2 && p.every(num);

/** Norwegian number: 0.182 → «0,182». */
export function fmt(n, d = 2) {
  if (!num(n)) return String(n);
  const v = Math.abs(n) < 0.5 * 10 ** -d ? 0 : n;
  return v.toFixed(d).replace('.', ',');
}

/** Value at a dotted path («door.leaf.w», «handrails[0].led»). */
export function getPath(obj, p) {
  let cur = obj;
  for (const k of String(p).replace(/\[(\d+)\]/g, '.$1').split('.')) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = cur[k];
  }
  return cur;
}

/** True when one of the fields (or a part of / the whole of it) is listed in the entry's `estimated`. */
export function isEst(e, ...fields) {
  const est = Array.isArray(e?.estimated) ? e.estimated : [];
  if (!est.length) return false;
  if (est.includes('*') || !fields.length) return true;
  const covers = (a, b) => a === b || b.startsWith(`${a}.`) || b.startsWith(`${a}[`);
  return fields.some((f) => est.some((x) => covers(x, f) || covers(f, x)));
}

export function photoCameraId(c) {
  if (c?.id) return String(c.id);
  return String(c?.file ?? '').split('/').pop().replace(/\.[a-z]+$/i, '');
}
const entryId = (key, e) => (key === 'photoCameras' ? photoCameraId(e) : e?.id);

// ---------------------------------------------------------------------------------------------------------------
// Plan geometry: points are [x, z]. A polygon with positive signedArea (Σ x_i·z_{i+1} − x_{i+1}·z_i) has the room to
// the right of every edge seen from above (the room-spec convention), i.e. the inward normal of an edge d is (−d.z, d.x).

const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
const mul = (a, k) => [a[0] * k, a[1] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
const cross = (a, b) => a[0] * b[1] - a[1] * b[0];
const len = (a) => Math.hypot(a[0], a[1]);
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const neg = (a) => [-a[0], -a[1]];
const unitv = (a) => {
  const l = len(a);
  return l > 0 ? [a[0] / l, a[1] / l] : [0, 0];
};
const lerp = (a, b, t) => a + (b - a) * t;

export function signedArea(poly) {
  let a = 0;
  for (let i = 0, n = poly.length; i < n; i++) a += cross(poly[i], poly[(i + 1) % n]);
  return a / 2;
}
export const polygonArea = (poly) => Math.abs(signedArea(poly));

export function pointInPolygon(p, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

export function distPointSeg(p, a, b) {
  const d = sub(b, a);
  const l2 = dot(d, d);
  const t = l2 > 0 ? Math.max(0, Math.min(1, dot(sub(p, a), d) / l2)) : 0;
  return dist(p, add(a, mul(d, t)));
}

const edges = (poly) => poly.map((p, i) => [p, poly[(i + 1) % poly.length]]);
const boundaryDist = (p, poly) => Math.min(...edges(poly).map(([a, b]) => distPointSeg(p, a, b)));
const inOrOn = (p, poly, tol = TOL) => pointInPolygon(p, poly) || boundaryDist(p, poly) <= tol;
const strictlyIn = (p, poly, tol = 0.01) => pointInPolygon(p, poly) && boundaryDist(p, poly) > tol;

function segmentsCross(a, b, c, d) {
  const o1 = cross(sub(b, a), sub(c, a));
  const o2 = cross(sub(b, a), sub(d, a));
  const o3 = cross(sub(d, c), sub(a, c));
  const o4 = cross(sub(d, c), sub(b, c));
  return o1 * o2 < -1e-12 && o3 * o4 < -1e-12;
}

function distSegSeg(a, b, c, d) {
  if (segmentsCross(a, b, c, d)) return 0;
  return Math.min(distPointSeg(a, c, d), distPointSeg(b, c, d), distPointSeg(c, a, b), distPointSeg(d, a, b));
}

export function isSimplePolygon(poly) {
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      if (segmentsCross(poly[i], poly[(i + 1) % n], poly[j], poly[(j + 1) % n])) return false;
    }
  }
  for (let i = 0; i < n; i++) if (dist(poly[i], poly[(i + 1) % n]) < 1e-9) return false;
  return true;
}

/** Drops repeated points and points on a straight line between their neighbours. */
export function simplifyPolygon(poly, tol = TOL) {
  let pts = poly.filter((p, i) => dist(p, poly[(i + 1) % poly.length]) > tol);
  let changed = true;
  while (changed && pts.length > 3) {
    changed = false;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[(i + pts.length - 1) % pts.length];
      const b = pts[i];
      const c = pts[(i + 1) % pts.length];
      if (distPointSeg(b, a, c) < tol * 0.2 && dot(sub(b, a), sub(c, b)) > 0) {
        pts = pts.filter((_, k) => k !== i);
        changed = true;
        break;
      }
    }
  }
  return pts;
}

/** Same polygon (same vertices in the same cyclic order, collinear points ignored). */
export function samePolygon(a, b, tol = TOL) {
  const sa = simplifyPolygon(a, tol);
  const sb = simplifyPolygon(b, tol);
  if (sa.length !== sb.length) return false;
  for (let k = 0; k < sb.length; k++) if (sa.every((p, i) => dist(p, sb[(i + k) % sb.length]) <= tol)) return true;
  return false;
}

function pointInTriangle(p, a, b, c) {
  const e = -1e-12;
  return cross(sub(b, a), sub(p, a)) >= e && cross(sub(c, b), sub(p, b)) >= e && cross(sub(a, c), sub(p, c)) >= e;
}

/** Ear clipping of a simple polygon → positive triangles. */
export function triangulate(poly) {
  let pts = simplifyPolygon(poly, 1e-9);
  if (signedArea(pts) < 0) pts = [...pts].reverse();
  const idx = pts.map((_, i) => i);
  const tris = [];
  let guard = 0;
  while (idx.length > 3 && guard++ < 10000) {
    let clipped = false;
    for (let k = 0; k < idx.length; k++) {
      const ia = idx[(k + idx.length - 1) % idx.length];
      const ib = idx[k];
      const ic = idx[(k + 1) % idx.length];
      const [a, b, c] = [pts[ia], pts[ib], pts[ic]];
      if (cross(sub(b, a), sub(c, b)) <= 1e-12) continue;
      if (idx.some((j) => j !== ia && j !== ib && j !== ic && pointInTriangle(pts[j], a, b, c))) continue;
      tris.push([a, b, c]);
      idx.splice(k, 1);
      clipped = true;
      break;
    }
    if (!clipped) break;
  }
  if (idx.length === 3) tris.push(idx.map((i) => pts[i]));
  return tris;
}

/** Sutherland–Hodgman: subject clipped by a positive convex polygon. */
function clipConvex(subject, clip) {
  let out = subject;
  for (let i = 0; i < clip.length && out.length; i++) {
    const a = clip[i];
    const b = clip[(i + 1) % clip.length];
    const inside = (p) => cross(sub(b, a), sub(p, a)) >= -1e-12;
    const input = out;
    out = [];
    for (let k = 0; k < input.length; k++) {
      const p = input[k];
      const q = input[(k + 1) % input.length];
      const pin = inside(p);
      const qin = inside(q);
      if (pin) out.push(p);
      if (pin !== qin) {
        // p + d·t on the clip line: cross(b − a, p + d·t − a) = 0
        const d = sub(q, p);
        const t = cross(sub(b, a), sub(a, p)) / cross(sub(b, a), d);
        out.push(add(p, mul(d, t)));
      }
    }
  }
  return out;
}

const boundsOf = (poly) => ({
  minX: Math.min(...poly.map((p) => p[0])),
  maxX: Math.max(...poly.map((p) => p[0])),
  minZ: Math.min(...poly.map((p) => p[1])),
  maxZ: Math.max(...poly.map((p) => p[1])),
});
const boxesOverlap = (a, b) => a.minX < b.maxX && b.minX < a.maxX && a.minZ < b.maxZ && b.minZ < a.maxZ;

/** Area of the intersection of two simple polygons (any orientation, convex or not). */
export function overlapArea(a, b) {
  if (!boxesOverlap(boundsOf(a), boundsOf(b))) return 0;
  const ta = triangulate(a);
  const tb = triangulate(b);
  let s = 0;
  for (const t1 of ta) {
    const b1 = boundsOf(t1);
    for (const t2 of tb) {
      if (!boxesOverlap(b1, boundsOf(t2))) continue;
      const c = clipConvex(t1, t2);
      if (c.length >= 3) s += polygonArea(c);
    }
  }
  return s;
}

const polygonInside = (inner, outer) => polygonArea(inner) - overlapArea(inner, outer) <= 1e-3;

// ---------------------------------------------------------------------------------------------------------------
// Window models (notes/vindusmodeller.md)

/** Hinge sides of an opening sash, seen from the room (src/home/wallkit.js). */
export const SASH_HINGES = ['top', 'bottom', 'left', 'right'];
/** Most panes along one side of a sash (wallkit MAX_PANES). */
const MAX_PANES = 12;

/**
 * The window model of a window or a roof window of w × h m (the hole): sashes (fields that tile the window), panes,
 * bars, frame.mullion, revealFloor. Pure – the planbygger can call it on its own entries.
 * @returns {{ errors: string[], warnings: string[] }} messages without the entry's name
 */
export function windowModelIssues(o, w = o?.width, h = o?.height) {
  const errors = [];
  const warnings = [];
  if (!isObj(o) || !num(w) || !num(h) || w <= 0 || h <= 0) return { errors, warnings };
  const fw = num(o.frame?.width) ? o.frame.width : 0.07;
  const panesOk = (p) => Array.isArray(p) && p.length === 2 && p.every((n) => Number.isInteger(n) && n >= 1 && n <= MAX_PANES);
  if (o.panes != null && !panesOk(o.panes)) errors.push(`panes må være [kolonner, rader], hele tall 1–${MAX_PANES}`);
  if (o.bars != null) {
    if (!isObj(o.bars)) errors.push('bars må være et objekt { width, color }');
    else if (o.bars.width != null && !(num(o.bars.width) && o.bars.width >= 0.005 && o.bars.width <= 0.08)) errors.push('bars.width må være 0,005–0,08 m');
  }
  if (o.frame?.mullion != null && !(num(o.frame.mullion) && o.frame.mullion >= 0.01 && o.frame.mullion <= 0.2)) errors.push('frame.mullion må være 0,01–0,2 m');
  if (o.revealFloor != null && typeof o.revealFloor !== 'boolean') errors.push('revealFloor må være true eller false');
  if (o.revealFloor === true && num(o.sill) && o.sill > 0.005) warnings.push('revealFloor gjelder bare vinduer som står på gulvet (sill 0) – det blir ikke noe gulv her');
  if (o.sashes != null && !Array.isArray(o.sashes)) {
    errors.push('sashes må være en liste med felt');
    return { errors, warnings };
  }
  const list = arr(o.sashes);
  const fields = [];
  list.forEach((s, i) => {
    const at = `sashes[${i}]`;
    if (!isObj(s)) return errors.push(`${at} må være et objekt`);
    const f = {};
    for (const [k, d] of [['from', 0], ['to', 1], ['bottom', 0], ['top', 1]]) {
      if (s[k] != null && !(num(s[k]) && s[k] >= -1e-9 && s[k] <= 1 + 1e-9)) errors.push(`${at}.${k} må være en brøk 0–1`);
      f[k] = num(s[k]) ? s[k] : d;
    }
    if (f.from >= f.to - 1e-9) errors.push(`${at}: from (${fmt(f.from)}) må være mindre enn to (${fmt(f.to)})`);
    if (f.bottom >= f.top - 1e-9) errors.push(`${at}: bottom (${fmt(f.bottom)}) må være mindre enn top (${fmt(f.top)})`);
    if (s.opening != null && typeof s.opening !== 'boolean') errors.push(`${at}.opening må være true eller false`);
    if (s.hinge != null && !SASH_HINGES.includes(s.hinge)) errors.push(`${at}.hinge må være en av ${SASH_HINGES.join(', ')}`);
    if (s.panes != null && !panesOk(s.panes)) errors.push(`${at}.panes må være [kolonner, rader], hele tall 1–${MAX_PANES}`);
    fields.push({ ...f, at, panes: panesOk(s.panes) ? s.panes : panesOk(o.panes) ? o.panes : [1, 1] });
  });
  if (!fields.length) fields.push({ from: 0, to: 1, bottom: 0, top: 1, at: 'vinduet', panes: panesOk(o.panes) ? o.panes : [1, 1] });
  // the fields tile the window: no overlaps, no holes (a part without a field would be an open hole in the wall)
  let area = 0;
  for (let i = 0; i < fields.length; i++) {
    const a = fields[i];
    area += Math.max(0, a.to - a.from) * Math.max(0, a.top - a.bottom);
    for (let j = i + 1; j < fields.length; j++) {
      const b = fields[j];
      const ov = Math.max(0, Math.min(a.to, b.to) - Math.max(a.from, b.from)) * Math.max(0, Math.min(a.top, b.top) - Math.max(a.bottom, b.bottom));
      if (ov > 1e-4) errors.push(`${a.at} og ${b.at} overlapper`);
    }
  }
  if (list.length && area < 1 - 1e-3) errors.push(`feltene i sashes dekker bare ${fmt(area * 100, 1)} % av vinduet – resten blir et åpent hull`);
  // sizes: the glass that is left inside the frame, and per pane between the bars
  for (const f of fields) {
    const fwid = (f.to - f.from) * w;
    const fhei = (f.top - f.bottom) * h;
    const gw = fwid - 2 * fw;
    const gh = fhei - 2 * fw;
    if (gw < 0.05 || gh < 0.05) warnings.push(`${f.at}: ${fmt(fwid)} × ${fmt(fhei)} m er så lite at rammen (${fmt(fw)}) tar nesten alt glasset`);
    else if (gw / f.panes[0] < 0.06 || gh / f.panes[1] < 0.06) warnings.push(`${f.at}: rutene blir under 6 cm (${f.panes[0]} × ${f.panes[1]} ruter i ${fmt(gw)} × ${fmt(gh)} m glass)`);
  }
  return { errors, warnings };
}

/** Is the polygon a rectangle (4 corners, right angles within ~1°)? */
const isRectangle = (p) => p.length === 4 && p.every((a, i) => {
  const b = p[(i + 1) % 4], c = p[(i + 2) % 4];
  const u = [b[0] - a[0], b[1] - a[1]], v = [c[0] - b[0], c[1] - b[1]];
  const lu = Math.hypot(...u), lv = Math.hypot(...v);
  return lu > 1e-6 && lv > 1e-6 && Math.abs((u[0] * v[0] + u[1] * v[1]) / (lu * lv)) < 0.02;
});

// ---------------------------------------------------------------------------------------------------------------
// Merge

export function deepMerge(target, patch) {
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) delete target[k];
    else if (isObj(v)) target[k] = deepMerge(isObj(target[k]) ? target[k] : {}, v);
    else target[k] = clone(v);
  }
  return target;
}

function withKeyAfter(obj, after, key, value) {
  if (!(after in obj)) return { [key]: value, ...obj };
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    out[k] = v;
    if (k === after) out[key] = value;
  }
  return out;
}

function stampEntry(key, entry, fileRoom, fileLevel) {
  let e = entry;
  if (fileRoom != null && ROOM_STAMPED.has(key) && e.roomId == null) e = withKeyAfter(e, key === 'photoCameras' ? 'file' : 'id', 'roomId', fileRoom);
  if (fileLevel != null && LEVEL_STAMPED.has(key) && e.levelId == null) e = withKeyAfter(e, 'id', 'levelId', fileLevel);
  return e;
}

function mergeById(list, entries, key, where, log, frozen = null) {
  const seen = new Set();
  for (const e of entries) {
    if (!isObj(e)) throw new Error(`${where}: ${key}: hver oppføring må være et objekt`);
    const id = entryId(key, e);
    if (!id) throw new Error(`${where}: ${key}: en oppføring mangler id`);
    if (seen.has(id)) throw new Error(`${where}: ${key}: id-en «${id}» står to ganger i samme fil`);
    seen.add(id);
    const i = list.findIndex((x) => entryId(key, x) === id);
    if (i >= 0) {
      list[i] = e;
      log(`${where}: ${key} «${id}» erstattet`);
      // a photo-measured living-room entry replaced from a house file: the validator cannot see it afterwards, so say it
      // here (only L1, L2 and C3 may change the living room, §0; door-gang is patched with wallOpenings, never replaced)
      if (frozen?.has(id)) console.warn(`[house] ${where}: ${key} «${id}» erstatter den fotomålte oppføringen i stua – bare L1, L2 og C3 kan endre stua (§0); bruk wallOpenings for åpninger`);
    } else list.push(e);
  }
}

function patchWallOpenings(out, patches, where, log) {
  if (!Array.isArray(patches)) throw new Error(`${where}: wallOpenings må være en liste av { wallId, openings }`);
  for (const p of patches) {
    const wall = arr(out.walls).find((w) => w.id === p?.wallId);
    if (!wall) throw new Error(`${where}: wallOpenings: veggen «${p?.wallId}» finnes ikke`);
    if (!Array.isArray(p.openings)) throw new Error(`${where}: wallOpenings ${wall.id}: openings må være en liste`);
    if (!Array.isArray(wall.openings)) wall.openings = [];
    for (const o of p.openings) {
      if (!isObj(o) || !o.id) throw new Error(`${where}: wallOpenings ${wall.id}: en åpning mangler id`);
      const existing = wall.openings.find((x) => x.id === o.id);
      if (existing) {
        deepMerge(existing, o);
        log(`${where}: åpningen «${o.id}» på ${wall.id} lappet`);
        continue;
      }
      const other = arr(out.walls).find((w) => w !== wall && arr(w.openings).some((x) => x.id === o.id));
      if (other) throw new Error(`${where}: wallOpenings: åpningen «${o.id}» står allerede på ${other.id}`);
      wall.openings.push(deepMerge({}, o));
    }
  }
}

/** research/house/NN-name.json (sorted, without the id register) → [{ name, data }]. */
export function houseFiles(researchDir = RESEARCH_DIR) {
  const dir = path.join(researchDir, 'house');
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => HOUSE_FILE.test(f) && f !== REGISTRY_FILE)
    .sort()
    .map((name) => ({ name, data: readJson(path.join(dir, name)) }));
}

/** research/house/00-ids.json, or null. */
export function loadRegistry(researchDir = RESEARCH_DIR) {
  const file = path.join(researchDir, 'house', REGISTRY_FILE);
  return fs.existsSync(file) ? readJson(file) : null;
}

/**
 * The room-spec with every house file merged in (see the header).
 * @param {object} spec  research/room-spec.json (not changed)
 * @param {string} [researchDir]  the research folder (research/house/ is read from it)
 * @param {{ files?: {name: string, data: object}[], registry?: object|null, log?: (s: string) => void }} [opts]
 */
export function mergeHouse(spec, researchDir = RESEARCH_DIR, opts = {}) {
  const files = opts.files ?? houseFiles(researchDir);
  const registry = opts.registry !== undefined ? opts.registry : loadRegistry(researchDir);
  const log = opts.log ?? (() => {});
  const out = clone(spec);
  const baseKeys = Object.keys(out);
  const protectedKeys = new Set(registry?.schema?.protected ?? DEFAULT_PROTECTED);
  const frozenOf = (coll) => new Set(arr(registry?.frozen?.[coll]));
  for (const { name, data } of files) {
    const where = `research/house/${name}`;
    if (!isObj(data)) throw new Error(`${where}: fila må være et JSON-objekt`);
    for (const [key, value] of Object.entries(data)) {
      if (key.startsWith('$') || key === 'levelId' || key === 'roomId') continue;
      if (key === 'wallOpenings') {
        patchWallOpenings(out, value, where, log);
        continue;
      }
      if (protectedKeys.has(key) && key in out) throw new Error(`${where}: «${key}» kan ikke endres fra hus-filene (stua er fotomålt – rett research/room-spec.json)`);
      if (Array.isArray(value)) {
        if (out[key] === undefined) out[key] = [];
        if (!Array.isArray(out[key])) throw new Error(`${where}: «${key}» er en liste her, men ikke i room-spec`);
        // only objects are stamped; anything else reaches mergeById, which names the file
        mergeById(out[key], value.map((e) => (isObj(e) ? stampEntry(key, clone(e), data.roomId, data.levelId) : e)), key, where, log, frozenOf(key));
      } else if (isObj(value)) {
        if (out[key] === undefined) out[key] = {};
        if (!isObj(out[key])) throw new Error(`${where}: «${key}» er et objekt her, men ikke i room-spec`);
        if (key === 'kitchen') {
          const { items, ...rest } = value;
          if (items !== undefined) {
            if (!Array.isArray(items)) throw new Error(`${where}: kitchen.items må være en liste`);
            if (!Array.isArray(out.kitchen.items)) out.kitchen.items = [];
            mergeById(out.kitchen.items, items.map(clone), 'kitchen.items', where, log, frozenOf('kitchenItems'));
          }
          deepMerge(out.kitchen, rest);
        } else deepMerge(out[key], value);
        log(`${where}: ${key} flettet`);
      } else throw new Error(`${where}: «${key}» må være en liste eller et objekt`);
    }
  }
  // stable key order: today's keys as they are, the new ones last in the register's order (unknown ones after them)
  const order = arr(registry?.schema?.topLevel);
  const rank = (k) => (order.includes(k) ? order.indexOf(k) : Infinity);
  const added = Object.keys(out).filter((k) => !baseKeys.includes(k));
  const sorted = added.map((k, i) => [k, i]).sort((a, b) => (rank(a[0]) === rank(b[0]) ? a[1] - b[1] : rank(a[0]) < rank(b[0]) ? -1 : 1));
  const result = {};
  for (const k of baseKeys) result[k] = out[k];
  for (const [k] of sorted) result[k] = out[k];
  return result;
}

// ---------------------------------------------------------------------------------------------------------------
// Stairs: the walk line (§1.6)

/** First hit (t > 0) of the ray o + t·dir with the edges of a polygon, or null. */
function rayHit(o, dir, poly) {
  let best = null;
  for (const [a, b] of edges(poly)) {
    const e = sub(b, a);
    const den = cross(dir, e);
    if (Math.abs(den) < 1e-12) continue;
    const ao = sub(a, o);
    const t = cross(ao, e) / den;
    const s = cross(ao, dir) / den;
    if (t > 1e-6 && s >= -1e-9 && s <= 1 + 1e-9 && (best === null || t < best)) best = t;
  }
  return best === null ? null : add(o, mul(dir, best));
}

/**
 * The walk line of a half-turn stair after hele-huset-avstemming.md V13: in the middle of the free width all the way –
 * straight down the top flight to the far edge of the well, a quarter arc around the well's corner there (radius from
 * half the top flight's width to half the free width between the well and the far shaft wall), straight along the
 * far edge of the well, a quarter arc around its other corner (to half the lower flight's width) and straight down the
 * lower flight. The cross-section in an arc is radial, from the well corner out to the shaft walls (`bound`, the stair
 * footprint); on the straight parts it is the flight's width. null when the well has no far edge (one far point).
 */
function halfTurnWalk({ P0, P3, d1, d2, w1, w2, well, bound }) {
  const proj = well.map((p) => dot(p, d1));
  const far = Math.max(...proj);
  const farPts = well.filter((p, i) => Math.abs(proj[i] - far) < 1e-6);
  const off = (p, P, d) => Math.abs(cross(d, sub(p, P)));
  const nearest = (P, d) => farPts.reduce((best, p) => (off(p, P, d) < off(best, P, d) - 1e-9 ? p : best), farPts[0]);
  const A = nearest(P0, d1);
  const B = nearest(P3, d2);
  if (farPts.length < 2 || dist(A, B) < 1e-6) return null;
  const r1 = off(A, P0, d1);
  const r3 = off(B, P3, d2);
  // the far shaft wall: the footprint's extent beyond the well (without one the flights' mean half width)
  const r2 = bound ? (Math.max(...bound.map((p) => dot(p, d1))) - far) / 2 : (r1 + r3) / 2;
  const L1 = far - dot(P0, d1);
  const L3 = dot(sub(P3, B), d2);
  if (L1 < -TOL || L3 < -TOL) throw new Error('top/foot passer ikke med kjernen (well): løpene må gå mot og fra svingen');
  const P1 = add(P0, mul(d1, Math.max(0, L1)));
  const P2 = sub(P3, mul(d2, Math.max(0, L3)));
  const line = (a, d, l, hw) => ({ kind: 'line', a, d, len: Math.max(0, l), hw });
  const arc = (C, from, to, rs, re) => {
    const a0 = Math.atan2(from[1], from[0]);
    const da = Math.atan2(cross(from, to), dot(from, to));
    return { kind: 'arc', C, a0, da, rs, re, len: (Math.abs(da) * (rs + re)) / 2 };
  };
  const e = unitv(sub(B, A));
  const segs = [
    line(P0, d1, L1, w1 / 2),
    arc(A, unitv(sub(P1, A)), d1, r1, r2),
    line(add(A, mul(d1, r2)), e, dist(A, B), r2),
    arc(B, d1, unitv(sub(P2, B)), r2, r3),
    line(P2, d2, L3, w2 / 2),
  ];
  let s0 = 0;
  for (const g of segs) {
    g.s0 = s0;
    s0 += g.len;
  }
  const length = s0;
  const sideOf = (p, perp, hw) => [add(p, mul(perp, hw)), add(p, mul(perp, -hw))];
  const at = (u) => {
    // beyond the ends the first / last flight goes on straight (headroom in front of the foot, like the old line)
    const uu = Math.max(0, Math.min(length, u));
    const g = u > length ? segs[segs.length - 1] : u < 0 ? segs[0] : segs.find((x) => uu <= x.s0 + x.len + 1e-12 && x.len > 0) ?? segs[segs.length - 1];
    const t = g.len > 0 ? Math.max(0, Math.min(1, (uu - g.s0) / g.len)) : 0;
    if (g.kind === 'line') {
      const p = add(g.a, mul(g.d, t * g.len + (u > length ? u - length : u < 0 ? u : 0)));
      const perp = [-g.d[1], g.d[0]];
      return { p, dir: g.d, halfWidth: g.hw, section: sideOf(p, perp, g.hw) };
    }
    const ang = g.a0 + g.da * t;
    const radial = [Math.cos(ang), Math.sin(ang)];
    const r = lerp(g.rs, g.re, t);
    const p = add(g.C, mul(radial, r));
    const s = Math.sign(g.da) || 1;
    const dir = [s * -radial[1], s * radial[0]];
    const perp = [-dir[1], dir[0]];
    const outer = (bound && rayHit(g.C, radial, bound)) || add(g.C, mul(radial, 2 * r));
    const section = dot(perp, radial) > 0 ? [outer, g.C] : [g.C, outer];
    return { p, dir, halfWidth: r, section };
  };
  return { length, at, P0, P1, P2, P3, A, B, r1, r2, r3, d1, d2, segments: segs.map(({ kind, s0: start, len: l }) => ({ kind, start, length: l })) };
}

/**
 * Walk line of a stair, from the top nosing (the edge of the upper floor, u = 0) to the lowest nosing (u = length).
 * A half-turn stair around a well with a far edge follows V13 (halfTurnWalk: the middle of the free width, quarter arcs
 * around the well's two far corners); other winders keep an arc around the far end of the well whose radius goes from
 * the top flight's to the bottom flight's. going = length / (risers − 1).
 * @param {object} stair
 * @param {{ bound?: number[][] }} [opts]  the polygon of the shaft walls (default stair.footprint)
 * @returns {{ length: number, at: (u: number) => { p: number[], dir: number[], halfWidth: number, section?: number[][] }, P0: number[], P3: number[] }}
 */
export function stairWalk(stair, opts = {}) {
  const { top, foot } = stair;
  if (!top?.edge || !foot?.edge || !isPoint(top.edge[0]) || !isPoint(top.edge[1]) || !isPoint(foot.edge[0]) || !isPoint(foot.edge[1])) {
    throw new Error('top.edge og foot.edge må være to punkter hver');
  }
  const mid = (e) => mul(add(e[0], e[1]), 0.5);
  const P0 = mid(top.edge);
  const P3 = mid(foot.edge);
  const w1 = dist(top.edge[0], top.edge[1]);
  const w2 = dist(foot.edge[0], foot.edge[1]);
  const d1 = unitv(top.down || [0, 0]);
  const d2 = unitv(foot.down || [0, 0]);
  if (!len(d1) || !len(d2)) throw new Error('top.down og foot.down må være retninger');
  if (stair.type === 'straight') {
    const L = dist(P0, P3);
    if (dot(sub(P3, P0), d1) < L - 0.01) throw new Error('en rett trapp må gå fra top.edge til foot.edge langs top.down');
    const at = (u) => ({ p: add(P0, mul(d1, u)), dir: d1, halfWidth: lerp(w1, w2, Math.max(0, Math.min(1, u / L))) / 2 });
    return { length: L, at, P0, P3, d1, d2 };
  }
  const well = stair.well?.polygon;
  if (!Array.isArray(well) || well.length < 3 || !well.every(isPoint)) throw new Error('en svingt trapp må ha well.polygon');
  const boundRaw = opts.bound ?? stair.footprint ?? null;
  const bound = Array.isArray(boundRaw) && boundRaw.length >= 3 && boundRaw.every(isPoint) ? boundRaw : null;
  if (dot(d1, d2) < -0.9) {
    const v13 = halfTurnWalk({ P0, P3, d1, d2, w1, w2, well, bound });
    if (v13) return v13;
  }
  const proj = well.map((p) => dot(p, d1));
  const far = Math.max(...proj);
  const end = well.filter((p, i) => Math.abs(proj[i] - far) < 1e-6);
  const C = mul(end.reduce((s, p) => add(s, p), [0, 0]), 1 / end.length);
  const L1 = dot(sub(C, P0), d1);
  const L3 = dot(sub(P3, C), d2);
  if (L1 < -TOL || L3 < -TOL) throw new Error('top/foot passer ikke med kjernen (well): løpene må gå mot og fra svingen');
  const P1 = add(P0, mul(d1, Math.max(0, L1)));
  const P2 = sub(P3, mul(d2, Math.max(0, L3)));
  const r1 = dist(P1, C);
  const r2 = dist(P2, C);
  const turn = Math.acos(Math.max(-1, Math.min(1, dot(d1, d2))));
  const sweep = (cross(d1, sub(C, P1)) >= 0 ? 1 : -1) * turn;
  const a1 = Math.atan2(P1[1] - C[1], P1[0] - C[0]);
  const La = turn * ((r1 + r2) / 2);
  const l1 = Math.max(0, L1);
  const l3 = Math.max(0, L3);
  const at = (u) => {
    if (u <= l1) return { p: add(P0, mul(d1, u)), dir: d1, halfWidth: w1 / 2 };
    if (u <= l1 + La && La > 0) {
      const t = (u - l1) / La;
      const ang = a1 + sweep * t;
      const r = lerp(r1, r2, t);
      const s = Math.sign(sweep) || 1;
      return { p: add(C, [r * Math.cos(ang), r * Math.sin(ang)]), dir: [s * -Math.sin(ang), s * Math.cos(ang)], halfWidth: lerp(w1, w2, t) / 2 };
    }
    return { p: add(P2, mul(d2, u - l1 - La)), dir: d2, halfWidth: w2 / 2 };
  };
  return { length: l1 + La + l3, at, P0, P1, P2, P3, C, r1, r2, sweep, d1, d2 };
}

// ---------------------------------------------------------------------------------------------------------------
// Doors

/** Plan geometry of a door in its wall: hinge point, closed / swing directions, leaf width and the open leaf. */
function doorGeometry(w, o) {
  const f = w.from;
  const L = dist(w.from, w.to);
  const d = unitv(sub(w.to, w.from));
  const n = [-d[1], d[0]];
  const t = num(w.thickness) ? w.thickness : 0.1;
  const fw = num(o.frame?.width) ? o.frame.width : 0.05;
  const u0 = o.offset;
  const u1 = o.offset + o.width;
  const leafW = num(o.door?.leaf?.w) ? o.door.leaf.w : o.width - 2 * fw;
  const hingeFrom = (o.door?.hinge ?? 'from') === 'from';
  const swingIn = (o.door?.swing ?? 'in') === 'in';
  const uh = hingeFrom ? u0 + fw : u1 - fw;
  const H = add(add(f, mul(d, uh)), mul(n, swingIn ? 0 : -t));
  const c = hingeFrom ? d : neg(d);
  const s = swingIn ? n : neg(n);
  const angleDeg = num(o.door?.openAngleDeg) ? o.door.openAngleDeg : 90;
  const angle = (angleDeg * Math.PI) / 180;
  const dirAt = (a) => add(mul(c, Math.cos(a)), mul(s, Math.sin(a)));
  const leaf = [H, add(H, mul(dirAt(angle), leafW))];
  /** Points of the area the leaf sweeps from closed to open. */
  const sweepPoints = () => {
    const pts = [];
    const steps = Math.max(2, Math.ceil(angleDeg / 5));
    for (let i = 0; i <= steps; i++) {
      const dir = dirAt((angle * i) / steps);
      for (const k of [0.2, 0.4, 0.6, 0.8, 1]) pts.push(add(H, mul(dir, leafW * k)));
    }
    return pts;
  };
  /** Floor points of the clear opening through the wall, with 5 cm on each side. */
  const clearPoints = () => {
    const pts = [];
    const a = u0 + fw;
    const b = u1 - fw;
    for (let u = a; u <= b + 1e-9; u += Math.max(0.01, (b - a) / 20)) {
      for (const k of [0.05, 0, -t / 2, -t, -t - 0.05]) pts.push(add(add(f, mul(d, u)), mul(n, k)));
    }
    return pts;
  };
  return { L, d, n, t, fw, u0, u1, leafW, H, c, s, angleDeg, leaf, sweepPoints, clearPoints, swingIn };
}

/**
 * Plan rectangles of a door's two jambs (frame.width inside the hole, room-spec convention), across the wall with the
 * frame's depth proud of both faces. wi = the wall info of the owner wall (from, d, n, t).
 */
function doorJambs(wi, o) {
  const fw = num(o.frame?.width) ? o.frame.width : 0.05;
  const fd = num(o.frame?.depth) ? o.frame.depth : 0.02;
  const P = (u, k) => add(add(wi.w.from, mul(wi.d, u)), mul(wi.n, k));
  const u0 = o.offset;
  const u1 = o.offset + o.width;
  return [[u0, u0 + fw], [u1 - fw, u1]].map(([a, b]) => [P(a, fd), P(b, fd), P(b, -(wi.t + fd)), P(a, -(wi.t + fd))]);
}

/** Distance from a segment (or a point: a = b) to a polygon (0 when it touches or enters it). */
function distSegPoly(a, b, poly) {
  if (pointInPolygon(a, poly) || pointInPolygon(b, poly)) return 0;
  return Math.min(...edges(poly).map(([c, d]) => distSegSeg(a, b, c, d)));
}

/**
 * Does the open leaf cut the free floor of a room (polygon minus holes, railings as obstacles) into parts that were
 * connected with `FREE_WIDTH` clearance before? Grid flood fill on the floor eroded by FREE_WIDTH / 2.
 */
function leafBlocksPassage({ region, holes, guards, leaf, r = FREE_WIDTH / 2, h = 0.02, minPiece = 0.04 }) {
  const b = boundsOf(region);
  const nx = Math.max(1, Math.ceil((b.maxX - b.minX) / h));
  const nz = Math.max(1, Math.ceil((b.maxZ - b.minZ) / h));
  const segs = [...edges(region), ...holes.flatMap(edges), ...guards];
  const before = new Uint8Array(nx * nz);
  const after = new Uint8Array(nx * nz);
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < nz; j++) {
      const p = [b.minX + (i + 0.5) * h, b.minZ + (j + 0.5) * h];
      if (!pointInPolygon(p, region) || holes.some((hp) => pointInPolygon(p, hp))) continue;
      if (segs.some(([a, c]) => distPointSeg(p, a, c) < r)) continue;
      before[i * nz + j] = 1;
      if (distPointSeg(p, leaf[0], leaf[1]) >= r) after[i * nz + j] = 1;
    }
  }
  const label = (mask) => {
    const lab = new Int32Array(nx * nz).fill(-1);
    const sizes = [];
    const queue = new Int32Array(nx * nz);
    for (let s = 0; s < nx * nz; s++) {
      if (!mask[s] || lab[s] >= 0) continue;
      const id = sizes.length;
      let head = 0;
      let tail = 0;
      queue[tail++] = s;
      lab[s] = id;
      let size = 0;
      while (head < tail) {
        const c = queue[head++];
        size++;
        const ci = Math.floor(c / nz);
        const cj = c % nz;
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const ni = ci + di;
          const nj = cj + dj;
          if (ni < 0 || nj < 0 || ni >= nx || nj >= nz) continue;
          const k = ni * nz + nj;
          if (mask[k] && lab[k] < 0) {
            lab[k] = id;
            queue[tail++] = k;
          }
        }
      }
      sizes.push(size);
    }
    return { lab, sizes };
  };
  const B = label(before);
  const A = label(after);
  const minCells = minPiece / (h * h);
  const pieces = new Map();
  for (let s = 0; s < nx * nz; s++) {
    const a = A.lab[s];
    if (a < 0 || A.sizes[a] < minCells) continue;
    const bl = B.lab[s];
    if (!pieces.has(bl)) pieces.set(bl, new Set());
    pieces.get(bl).add(a);
  }
  const blocked = [...pieces.values()].some((set) => set.size > 1);
  const minGuard = guards.length ? Math.min(...guards.map(([a, c]) => distSegSeg(leaf[0], leaf[1], a, c))) : null;
  return { blocked, minGuard };
}

// ---------------------------------------------------------------------------------------------------------------
// Validation

const FORBIDDEN_HINT = {
  openings: 'dørfeltene (hinge, swing, leaf, closed, opensInto, openAngleDeg, casing …) skal ligge i door:{…}, slik door-gang har dem – layout.js gjenkjenner en dør bare når o.door finnes',
  builtInLights: 'bruk lightColorK og dims – layout.js leser ikke kelvin, diameter eller colorK, så de ville blitt ignorert stille',
};

/** Validates the merged room-spec (see the header). */
export function validateHouse(spec, opts = {}) {
  const registry = opts.registry !== undefined ? opts.registry : loadRegistry(opts.researchDir ?? RESEARCH_DIR);
  const archetypes = opts.archetypes ?? readJson(path.join(ROOT, 'src', 'data', 'archetypes.json'));
  const reg = registry || {};
  const schema = reg.schema || {};
  const errors = [];
  const warnings = [];
  const error = (m) => errors.push(m);
  const warn = (m) => warnings.push(m);
  const judge = (estimated, m) => (estimated ? warn(`${m} (anslått, så bare en advarsel)`) : error(m));

  // the checks read only object entries; a broken entry is reported once, from the raw list (below)
  const objs = (v) => arr(v).filter(isObj);
  const levels = objs(spec.levels);
  const rooms = objs(spec.rooms);
  const walls = objs(spec.walls);
  const ceilings = objs(spec.ceilings);
  const floorOpenings = objs(spec.floorOpenings);
  const stairs = objs(spec.stairs);
  const lightGroups = objs(spec.lightGroups);
  const pseudoRooms = new Set(arr(reg.pseudoRooms));
  const levelsById = new Map(levels.map((l) => [l.id, l]));
  const roomsById = new Map(rooms.map((r) => [r.id, r]));
  const wallsById = new Map(walls.map((w) => [w.id, w]));
  const roomOf = (e) => e?.roomId ?? STUE;
  const levelOf = (roomId) => roomsById.get(roomId)?.levelId ?? null;
  const physical = (r) => r && r.kind !== 'hud' && Array.isArray(r.polygon) && r.polygon.length >= 3 && r.polygon.every(isPoint);
  const goodRooms = new Set();
  const report = { errors, warnings, levels: [], rooms: [], stairs: [], doors: [], measureList: [] };

  // ---- top-level keys
  if (schema.topLevel) for (const k of Object.keys(spec)) if (!schema.topLevel.includes(k)) error(`ukjent toppnøkkel «${k}» (ikke i schema.topLevel i research/house/00-ids.json)`);

  // ---- every entry with an id, per collection
  const entries = [];
  const push = (coll, list, extra = {}) => list.forEach((e) => entries.push({ coll, e, id: coll === 'photoCameras' ? photoCameraId(e) : e?.id, ...extra }));
  push('levels', arr(spec.levels));
  push('rooms', arr(spec.rooms));
  push('walls', arr(spec.walls));
  for (const w of walls) push('openings', arr(w.openings), { wall: w });
  push('zones', arr(spec.zones));
  push('ceilings', arr(spec.ceilings));
  push('bulkheads', arr(spec.bulkheads));
  push('builtInLights', arr(spec.builtInLights));
  push('kitchenItems', arr(spec.kitchen?.items));
  push('furniture', arr(spec.furniture));
  push('fixtures', arr(spec.fixtures));
  push('photoCameras', arr(spec.photoCameras));
  push('builtIns', arr(spec.builtIns));
  push('lightGroups', arr(spec.lightGroups));
  push('floorOpenings', arr(spec.floorOpenings));
  push('stairs', arr(spec.stairs));
  for (const s of stairs) push('guards', arr(s.guards), { stair: s });
  push('facadeSegments', arr(spec.facadeSegments));

  const frozen = reg.frozen || {};
  const isFrozen = (coll, id) => arr(frozen[coll]).includes(id);
  const idSyntax = schema.idSyntax ? new RegExp(schema.idSyntax) : null;
  const NAMESPACE = { levels: 'level', rooms: 'room', zones: 'room', lightGroups: 'lightGroup' };
  const seen = { level: new Map(), room: new Map(), lightGroup: new Map(), entity: new Map() };
  for (const p of pseudoRooms) seen.room.set(p, 'pseudoRooms');
  for (const g of [...arr(reg.legacyLightGroups?.spec), ...arr(reg.legacyLightGroups?.layout)]) seen.lightGroup.set(g, 'stuas lysgrupper (layout.js)');

  for (const x of entries) {
    const where = `${x.coll}/${x.id ?? '?'}`;
    x.where = where;
    if (!isObj(x.e)) {
      error(`${x.coll}: en oppføring er ikke et objekt`);
      continue;
    }
    if (!x.id) {
      error(`${x.coll}: en oppføring mangler id`);
      continue;
    }
    const ns = NAMESPACE[x.coll] ?? 'entity';
    if (seen[ns].has(x.id)) error(`id-en «${x.id}» brukes to ganger (${seen[ns].get(x.id)} og ${where})`);
    else seen[ns].set(x.id, where);
    if (idSyntax && !idSyntax.test(x.id)) error(`${where}: id-en må følge ${schema.idSyntax}`);
    const sc = schema.collections?.[x.coll];
    if (!sc) continue;
    for (const f of arr(sc.required)) if (getPath(x.e, f) == null) error(`${where}: mangler «${f}»`);
    // rooms: a HUD room (kind «hud», the stair) has no floor, ceiling or acoustics of its own
    if (x.e.kind !== 'hud') for (const f of arr(sc.requiredPhysical)) if (getPath(x.e, f) == null) error(`${where}: mangler «${f}»`);
    for (const [f, allowed] of Object.entries(sc.enums || {})) {
      const v = getPath(x.e, f);
      if (v != null && !allowed.includes(v)) error(`${where}: ${f} «${v}» er ikke en av ${allowed.join(', ')}`);
    }
    for (const f of arr(sc.numbers)) {
      const v = getPath(x.e, f);
      if (v != null && !num(v)) error(`${where}: ${f} må være et tall (${JSON.stringify(v)})`);
    }
    const bad = arr(sc.forbidden).filter((f) => x.e[f] !== undefined);
    if (bad.length) error(`${where}: ${bad.join(', ')} hører ikke hjemme her – ${FORBIDDEN_HINT[x.coll] ?? 'se schema i research/house/00-ids.json'}`);
    for (const f of arr(sc.points2)) if (x.e[f] != null && !isPoint(x.e[f])) error(`${where}: ${f} må være [x, z]`);
    for (const f of arr(sc.points3)) if (x.e[f] != null && !(Array.isArray(x.e[f]) && x.e[f].length === 3 && x.e[f].every(num))) error(`${where}: ${f} må være [x, y, z]`);
    for (const f of arr(sc.polygons)) if (x.e[f] != null && !(Array.isArray(x.e[f]) && x.e[f].length >= 3 && x.e[f].every(isPoint))) error(`${where}: ${f} må være minst tre punkter [x, z]`);
    if (sc.idPattern && !isFrozen(x.coll, x.id) && !new RegExp(sc.idPattern).test(x.id)) error(`${where}: nye id-er her skal matche ${sc.idPattern}`);
    if (x.e.estimated !== undefined) {
      if (!Array.isArray(x.e.estimated) || !x.e.estimated.every((f) => typeof f === 'string' && f)) error(`${where}: estimated må være en liste av feltnavn (eller ["*"])`);
      else for (const f of x.e.estimated) if (f !== '*' && getPath(x.e, f) === undefined) warn(`${where}: estimated nevner «${f}», som ikke finnes`);
    }
    if (x.e.source !== undefined && typeof x.e.source !== 'string') error(`${where}: source må være tekst`);
  }

  // ---- the frozen ids are still there (existing ids never get a new name)
  for (const [coll, ids] of Object.entries(frozen)) {
    const have = new Set(entries.filter((x) => x.coll === coll).map((x) => x.id));
    for (const id of arr(ids)) if (!have.has(id)) error(`${coll}/${id} finnes ikke lenger – eksisterende id-er får aldri nytt navn (lagrede design peker på dem)`);
  }

  // ---- a new entry without roomId lands in the living room (layout.js puts every entry without one there, also one
  //      with levelId «kjeller»): only the photo-measured (frozen) ids may lack it. A new living-room entry names
  //      roomId «stue-kjokken» explicitly (and only L1, L2 and C3 may add one, §0).
  if (reg.frozen) {
    const NEEDS_ROOM = new Set(['walls', 'zones', 'ceilings', 'bulkheads', 'builtInLights', 'furniture', 'fixtures', 'photoCameras']);
    for (const x of entries) {
      if (!x.id || !isObj(x.e) || !NEEDS_ROOM.has(x.coll) || x.e.roomId != null || isFrozen(x.coll, x.id)) continue;
      error(`${x.coll}/${x.id}: mangler roomId – uten roomId havner den i stua (layout.js)${x.e.levelId != null ? `, selv med levelId «${x.e.levelId}»` : ''}; sett roomId på oppføringen eller i fila (eller «${STUE}» hvis den virkelig hører til stua, §0)`);
    }
  }

  // ---- levels
  if (!levelsById.has(HOVED)) error('nivået «hoved» mangler (research/house/00-hus.json)');
  for (const l of levels) {
    const r = reg.levels?.[l.id];
    if (reg.levels && !r) error(`levels/${l.id}: nivået står ikke i research/house/00-ids.json`);
    if (r?.floorY != null && l.floorY !== r.floorY) error(`levels/${l.id}: floorY ${l.floorY} ≠ ${r.floorY} i 00-ids.json`);
    if (num(l.slabThickness) && l.slabThickness < 0) error(`levels/${l.id}: slabThickness kan ikke være negativ`);
    if (num(l.ceilingDefault) && l.ceilingDefault <= 0) error(`levels/${l.id}: ceilingDefault må være over 0`);
    report.levels.push({ id: l.id, name: l.name, floorY: l.floorY, slabThickness: l.slabThickness, ceilingDefault: l.ceilingDefault });
  }
  const hoved = levelsById.get(HOVED);
  if (hoved) {
    if (hoved.floorY !== 0) error(`levels/hoved: floorY må være 0 (stua ligger på 0)`);
    const m = spec.meta || {};
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    if (hoved.plan && (hoved.plan.file !== m.planFile || !same(hoved.plan.pxPerM, m.planPxPerM) || !same(hoved.plan.originPx, m.planOriginPx))) {
      error('levels/hoved.plan må være lik meta.planFile, planPxPerM og planOriginPx (de beholdes som alias)');
    }
  }

  // ---- rooms
  if (!roomsById.has(STUE)) error('rommet «stue-kjokken» mangler (research/house/00-hus.json)');
  for (const r of rooms) {
    const where = `rooms/${r.id}`;
    const rr = reg.rooms?.[r.id];
    if (reg.rooms && !rr) error(`${where}: rommet står ikke i research/house/00-ids.json`);
    if (rr?.levelId && r.levelId !== rr.levelId) error(`${where}: levelId «${r.levelId}» ≠ «${rr.levelId}» i 00-ids.json`);
    if (rr?.kind && r.kind !== rr.kind) error(`${where}: kind «${r.kind}» ≠ «${rr.kind}» i 00-ids.json`);
    if (r.levelId != null && !levelsById.has(r.levelId)) error(`${where}: nivået «${r.levelId}» finnes ikke`);
    const poly = r.polygon;
    if (!Array.isArray(poly) || poly.length < 3 || !poly.every(isPoint)) continue;
    let ok = true;
    if (!isSimplePolygon(poly)) {
      error(`${where}: polygonet krysser seg selv eller har doble punkter`);
      ok = false;
    } else if (signedArea(poly) <= 0) {
      error(`${where}: polygonet må ha positivt areal (shoelace i x, z) – rommet til høyre for kantene`);
      ok = false;
    }
    if (ok) goodRooms.add(r.id);
    for (const cid of arr(r.ceilingIds)) {
      const c = ceilings.find((x) => x.id === cid);
      if (!c) error(`${where}: taket «${cid}» finnes ikke`);
      else if (roomOf(c) !== r.id) error(`${where}: taket «${cid}» hører til rommet «${roomOf(c)}»`);
    }
    if (r.id === STUE) {
      const f = spec.floor || {};
      if (JSON.stringify(r.polygon) !== JSON.stringify(f.polygon)) error(`${where}: polygonet må være floor.polygon fra research/room-spec.json`);
      if (r.floor?.material !== f.material || r.floor?.color !== f.color) error(`${where}: floor.material/color må være floor.material/color fra research/room-spec.json`);
    }
  }

  // ---- references to rooms and levels
  const roomExists = (id) => roomsById.has(id) || pseudoRooms.has(id);
  // a room or light group that is registered in 00-ids.json but not modelled yet comes from another house file (the
  // steps are built in parallel, e.g. the stair hole in the hall of A1): one warning per id, not an error – an id that is
  // not registered at all stays an error
  const pendingSeen = new Set();
  const pending = (kind, id, where) => {
    const registered = kind === 'room' ? reg.rooms?.[id] : reg.lightGroups?.[id];
    const there = kind === 'room' ? roomExists(id) : lightGroups.some((g) => g.id === id);
    if (!registered || there) return false;
    if (!pendingSeen.has(`${kind}:${id}`)) {
      pendingSeen.add(`${kind}:${id}`);
      report.pending.push({ kind, id, where });
      warn(`${kind === 'room' ? 'rommet' : 'lysgruppa'} «${id}» er registrert i research/house/00-ids.json, men ikke modellert ennå (${where} venter på fila som eier ${kind === 'room' ? 'rommet' : 'gruppa'})`);
    }
    return true;
  };
  report.pending = [];
  for (const x of entries) {
    if (!isObj(x.e)) continue;
    if (x.e.roomId != null && x.coll !== 'rooms' && !roomExists(x.e.roomId) && !pending('room', x.e.roomId, x.where)) error(`${x.where}: rommet «${x.e.roomId}» finnes ikke`);
    if (x.e.levelId != null && !levelsById.has(x.e.levelId)) error(`${x.where}: nivået «${x.e.levelId}» finnes ikke`);
  }

  // ---- walls: geometry per wall, loops per room
  const wallInfo = new Map();
  for (const w of walls) {
    if (!isPoint(w.from) || !isPoint(w.to)) continue;
    const L = dist(w.from, w.to);
    if (L < 0.01) {
      error(`walls/${w.id}: from og to er samme punkt`);
      continue;
    }
    const d = unitv(sub(w.to, w.from));
    const n = [-d[1], d[0]];
    if (!isPoint(w.normal) || dist(unitv(w.normal), n) > 1e-3 || Math.abs(len(w.normal) - 1) > 1e-3) {
      error(`walls/${w.id}: normal ${JSON.stringify(w.normal)} skal være [${fmt(n[0], 3)}, ${fmt(n[1], 3)}] – rommet ligger til høyre for from→to, normalen peker inn`);
    }
    if (num(w.length) && Math.abs(w.length - L) > 0.01) error(`walls/${w.id}: length ${fmt(w.length)} ≠ avstanden fra from til to (${fmt(L, 3)})`);
    const t = w.backOf != null ? 0 : num(w.thickness) ? w.thickness : 0.1;
    if (t < 0) error(`walls/${w.id}: thickness kan ikke være negativ`);
    const slab = t > 0 ? [w.from, w.to, add(w.to, mul(n, -t)), add(w.from, mul(n, -t))] : null;
    wallInfo.set(w.id, { w, L, d, n, t, slab, room: roomOf(w), level: levelOf(roomOf(w)) });
  }
  const wallsOfRoom = (rid) => walls.filter((w) => roomOf(w) === rid);
  for (const r of rooms) {
    const ws = wallsOfRoom(r.id);
    if (r.kind === 'hud') {
      if (ws.length) error(`rooms/${r.id}: et HUD-rom (kind «hud») har ingen vegger`);
      continue;
    }
    if (!goodRooms.has(r.id)) continue;
    if (!ws.length) {
      error(`rooms/${r.id}: rommet har ingen vegger`);
      continue;
    }
    if (!ws.every((w) => wallInfo.has(w.id))) continue;
    const gaps = [];
    ws.forEach((a, i) => {
      const b = ws[(i + 1) % ws.length];
      if (dist(a.to, b.from) > TOL) gaps.push(`${a.id}.to ${JSON.stringify(a.to)} → ${b.id}.from ${JSON.stringify(b.from)}`);
    });
    if (gaps.length) error(`rooms/${r.id}: veggene lukker ikke sløyfen i rekkefølge (med klokka, rommet til høyre): ${gaps.join('; ')}`);
    else {
      const loop = ws.map((w) => w.from);
      if (signedArea(loop) <= 0) error(`rooms/${r.id}: veggsløyfen går feil vei (rommet skal ligge til høyre for hver vegg)`);
      else if (!samePolygon(loop, r.polygon)) error(`rooms/${r.id}: veggsløyfen følger ikke rompolygonet`);
    }
  }

  // ---- backOf pairs: parallel, opposite, exactly one thickness apart, overlapping
  for (const w of walls) {
    if (w.backOf == null) continue;
    const where = `walls/${w.id}`;
    const ids = Array.isArray(w.backOf) ? w.backOf : [w.backOf];
    if (num(w.thickness) && w.thickness > 0) error(`${where}: en backOf-flate har ingen egen tykkelse (thickness ${w.thickness})`);
    if (arr(w.openings).length) error(`${where}: en backOf-flate har ingen egne åpninger – de defineres én gang, på eierveggen (${ids.join(', ')})`);
    const wi = wallInfo.get(w.id);
    for (const pid of ids) {
      const p = wallsById.get(pid);
      if (!p) {
        error(`${where}: backOf «${pid}» finnes ikke`);
        continue;
      }
      if (p.backOf != null) error(`${where}: backOf «${pid}» er selv en backOf-flate`);
      const pi = wallInfo.get(pid);
      if (!wi || !pi) continue;
      if (pi.room === wi.room) error(`${where}: backOf «${pid}» er i samme rom`);
      if (pi.level !== wi.level) error(`${where}: backOf «${pid}» er på et annet nivå`);
      if (dot(wi.d, pi.d) > -1 + 1e-4) {
        error(`${where}: backOf «${pid}» er ikke parallell og motsatt rettet (begge sløyfer går med klokka)`);
        continue;
      }
      const off = dot(sub(w.from, p.from), pi.n);
      const t = num(p.thickness) ? p.thickness : 0.1;
      if (Math.abs(off + t) > TOL) error(`${where}: ligger ${fmt(-off, 3)} m bak ${pid}, men ${pid} er ${fmt(t, 3)} tykk – et backOf-par skal ligge nøyaktig én tykkelse fra hverandre`);
      const a = dot(sub(w.from, p.from), pi.d);
      const b = dot(sub(w.to, p.from), pi.d);
      const ov = Math.min(Math.max(a, b), pi.L) - Math.max(Math.min(a, b), 0);
      if (ov < 0.01) error(`${where}: overlapper ikke ${pid} langs veggen`);
    }
  }

  // ---- double walls (D13): a face on the back of another room's wall must be a backOf face; slabs must not overlap
  const solid = [...wallInfo.values()].filter((x) => x.w.backOf == null && x.level != null);
  for (let i = 0; i < solid.length; i++) {
    for (let j = i + 1; j < solid.length; j++) {
      const A = solid[i];
      const B = solid[j];
      if (A.room === B.room || A.level !== B.level) continue;
      if (A.slab && B.slab && overlapArea(A.slab, B.slab) > AREA_EPS) error(`walls/${A.w.id} og walls/${B.w.id} overlapper (to vegger i samme rom i veggen)`);
      for (const [X, Y] of [[A, B], [B, A]]) {
        if (!X.slab || dot(X.d, Y.d) > -1 + 1e-4) continue;
        const off = dot(sub(Y.w.from, X.w.from), X.n);
        if (Math.abs(off + X.t) > TOL) continue;
        const a = dot(sub(Y.w.from, X.w.from), X.d);
        const b = dot(sub(Y.w.to, X.w.from), X.d);
        const ov = Math.min(Math.max(a, b), X.L) - Math.max(Math.min(a, b), 0);
        if (ov > 0.05) error(`walls/${Y.w.id} ligger på baksiden av walls/${X.w.id} – bruk backOf: "${X.w.id}" (D13), ellers blir det z-fighting og dobbel kollisjon`);
      }
    }
  }

  // ---- rooms (with wall thickness) do not overlap
  const phys = rooms.filter((r) => goodRooms.has(r.id) && physical(r));
  for (let i = 0; i < phys.length; i++) {
    for (let j = i + 1; j < phys.length; j++) {
      const A = phys[i];
      const B = phys[j];
      if (A.levelId !== B.levelId) continue;
      const a = overlapArea(A.polygon, B.polygon);
      if (a > AREA_EPS) error(`rommene ${A.id} og ${B.id} overlapper (${fmt(a, 3)} m²)`);
    }
  }
  for (const x of wallInfo.values()) {
    if (!x.slab) continue;
    for (const r of phys) {
      if (r.id === x.room || r.levelId !== x.level) continue;
      const a = overlapArea(x.slab, r.polygon);
      if (a > AREA_EPS) error(`walls/${x.w.id} (${x.room}, ${fmt(x.t)} tykk) står inne i rommet ${r.id} (${fmt(a, 3)} m²)`);
    }
  }

  // ---- ceilings inside their room
  for (const c of ceilings) {
    const r = roomsById.get(roomOf(c));
    if (!r || !goodRooms.has(r.id) || !Array.isArray(c.polygon) || !c.polygon.every(isPoint) || c.polygon.length < 3) continue;
    const out = polygonArea(c.polygon) - overlapArea(c.polygon, r.polygon);
    if (out > 0.01) warn(`ceilings/${c.id}: ${fmt(out, 2)} m² av taket ligger utenfor rommet ${r.id}`);
  }

  // ---- roof windows (ceilings[].skylights, notes/vindusmodeller.md): rectangles inside their ceiling, nothing above
  const skylightIds = new Set();
  for (const c of ceilings) {
    if (c.skylights == null) continue;
    if (!Array.isArray(c.skylights)) {
      error(`ceilings/${c.id}: skylights må være en liste`);
      continue;
    }
    const lv = levelsById.get(levelOf(roomOf(c)));
    const above = lv && num(lv.floorY) ? levels.filter((l) => num(l.floorY) && l.floorY > lv.floorY + 0.5).sort((a, b) => a.floorY - b.floorY)[0] : null;
    c.skylights.forEach((s, i) => {
      const where = `ceilings/${c.id}/skylights/${s?.id ?? i}`;
      if (!isObj(s)) return error(`${where}: må være et objekt { id, polygon }`);
      if (typeof s.id !== 'string' || !s.id) error(`${where}: mangler id`);
      else if (skylightIds.has(s.id)) error(`${where}: id-en er brukt av et annet takvindu`);
      else skylightIds.add(s.id);
      if (!Array.isArray(s.polygon) || !s.polygon.every(isPoint) || !isRectangle(s.polygon)) return error(`${where}: polygon må være et rektangel med 4 hjørner [[x, z], …]`);
      const est = isEst(s, 'polygon');
      const [p0, p1, p2] = s.polygon;
      const w = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
      const h = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
      if (Math.min(w, h) < 0.2) warn(`${where}: ${fmt(w)} × ${fmt(h)} m er veldig lite for et takvindu`);
      if (Array.isArray(c.polygon) && c.polygon.length >= 3 && c.polygon.every(isPoint) && !polygonInside(s.polygon, c.polygon)) judge(est, `${where}: takvinduet ligger ikke inne i taket ${c.id}`);
      if (s.depth != null && !(num(s.depth) && s.depth >= 0.05 && s.depth <= 2)) error(`${where}: depth må være 0,05–2 m`);
      if (s.opening != null && typeof s.opening !== 'boolean') error(`${where}: opening må være true eller false`);
      const wm = windowModelIssues({ ...s, revealFloor: undefined }, w, h);
      for (const m of wm.errors) judge(isEst(s, 'sashes', 'panes', 'bars', 'frame'), `${where}: ${m}`);
      for (const m of wm.warnings) warn(`${where}: ${m}`);
      if (above) {
        const mid = [(p0[0] + p2[0]) / 2, (p0[1] + p2[1]) / 2];
        const over = rooms.find((r) => r.levelId === above.id && physical(r) && inOrOn(mid, r.polygon, 0));
        if (over) judge(est, `${where}: rommet ${over.id} i etasjen over ligger over takvinduet`);
      }
    });
  }

  // ---- floor openings
  const holesOfLevel = (lid) => floorOpenings.filter((h) => h.levelId === lid && Array.isArray(h.polygon) && h.polygon.length >= 3 && h.polygon.every(isPoint));
  for (const h of floorOpenings) {
    const where = `floorOpenings/${h.id}`;
    const r = roomsById.get(h.roomId);
    if (!Array.isArray(h.polygon) || h.polygon.length < 3 || !h.polygon.every(isPoint)) continue;
    if (!isSimplePolygon(h.polygon) || signedArea(h.polygon) <= 0) error(`${where}: polygonet må være enkelt og ha positivt areal`);
    else if (r && goodRooms.has(r.id)) {
      if (r.levelId !== h.levelId) error(`${where}: rommet ${r.id} er ikke på nivået ${h.levelId}`);
      if (!polygonInside(h.polygon, r.polygon)) error(`${where}: hullet ligger ikke inne i rommet ${r.id}`);
    }
    if (h.stairId != null) {
      const s = stairs.find((x) => x.id === h.stairId);
      if (!s) error(`${where}: trappa «${h.stairId}» finnes ikke`);
      else if (s.openingId !== h.id) error(`${where}: trappa ${s.id} peker på hullet «${s.openingId}»`);
    }
  }

  // ---- roofs (notes/tak.md, home/roofgeom.js): the format and the dormers, the walls they cover, the ceilings that
  //      follow them, and the tops of the walls under them (a wall without topProfile reaches its room's ceiling – a
  //      window in a knee wall must stay under it)
  const roofLevels = levels.filter((l) => typeof l.id === 'string' && num(l.floorY)).map((l) => ({ id: l.id, floorY: l.floorY, ceilingDefault: num(l.ceilingDefault) ? l.ceilingDefault : 2.4 }));
  const roomFloorY = (rid) => (levelsById.get(levelOf(rid))?.floorY ?? 0) + (num(roomsById.get(rid)?.floorOffset) ? roomsById.get(rid).floorOffset : 0);
  const roofRes = spec.roofs != null
    ? resolveRoofs(spec.roofs, {
      levels: roofLevels,
      walls: walls.filter((w) => wallInfo.has(w.id)).map((w) => ({
        levelId: levelOf(roomOf(w)), exterior: !!w.exterior, thickness: wallInfo.get(w.id).t, from: w.from, to: w.to, backOf: w.backOf ?? null,
        height: Array.isArray(w.topProfile) && w.topProfile.length ? Math.max(...w.topProfile.map((q) => q[1])) : num(w.height) ? w.height : undefined,
      })),
    })
    : { parts: [], issues: [] };
  for (const i of roofRes.issues) (i.level === 'error' ? error : warn)(`${i.where}: ${i.msg}`);
  const roofIds = new Set();
  for (const r of arr(spec.roofs)) {
    if (!isObj(r) || r.id == null) continue;
    if (roofIds.has(r.id)) error(`roofs/${r.id}: id-en er brukt av et annet tak`);
    roofIds.add(r.id);
  }
  const roofFieldOf = {};
  for (const part of roofRes.parts) (roofFieldOf[part.levelId] ||= []).push(part);
  for (const [lid, list] of Object.entries(roofFieldOf)) roofFieldOf[lid] = roofField(list);
  // the exterior walls of a roof's level stand under a roof (its outline, 5 cm slack) – unless a floor above covers them
  for (const [lid, field] of Object.entries(roofFieldOf)) {
    const fy = levelsById.get(lid)?.floorY ?? 0;
    const upper = rooms.filter((r) => physical(r) && (levelsById.get(r.levelId)?.floorY ?? -Infinity) > fy + 0.5);
    for (const [id, wi] of wallInfo) {
      if (wi.level !== lid || !wi.w.exterior || !(wi.t > 0)) continue;
      const outer = [add(wi.w.from, mul(wi.n, -wi.t)), add(wi.w.to, mul(wi.n, -wi.t))];
      if (outer.every((q) => upper.some((r) => inOrOn(q, r.polygon, wi.t + 0.05)))) continue;
      const free = outer.filter((q) => !field.parts.some((part) => insideHalfPlanesOf(part.outline).every((hp) => hp.a * q[0] + hp.b * q[1] + hp.c <= 0.05)));
      if (free.length) warn(`walls/${id}: står utenfor taket over ${lid} (${free.map((q) => `[${fmt(q[0])}, ${fmt(q[1])}]`).join(', ')}) – utvid roofs[].outline eller legg til en takdel`);
    }
  }
  // ceilings that follow a roof
  for (const c of ceilings) {
    const where = `ceilings/${c.id}`;
    if (c.type != null && !['flat', 'slope', 'roof'].includes(c.type)) error(`${where}: type «${c.type}» er ikke en av flat, slope, roof`);
    const field = roofFieldOf[levelOf(roomOf(c))];
    if (c.type === 'roof' && !field) error(`${where}: type 'roof' uten tak over nivået «${levelOf(roomOf(c))}» (roofs[].levelId)`);
    else if (c.type === 'roof' && Array.isArray(c.polygon) && c.polygon.length >= 3 && c.polygon.every(isPoint)) {
      const mid = c.polygon.reduce((m, q) => [m[0] + q[0] / c.polygon.length, m[1] + q[1] / c.polygon.length], [0, 0]);
      const bare = c.polygon.map((q) => add(q, mul(unitv(sub(mid, q)), 0.01))).filter((q) => !field.planeAt(q[0], q[1]));
      if (bare.length) error(`${where}: type 'roof', men intet tak over ${bare.length === c.polygon.length ? 'himlingen' : 'deler av himlingen'} (roofs[].outline)`);
    }
    if (c.type === 'roof' && c.height != null && !(num(c.height) && c.height >= 1.5)) error(`${where}: height (hanebjelkehøyden) må være minst 1,5 m`);
  }
  /** a room's ceiling under its level's roof (roofgeom ceilingSurface), null without one */
  const roomSurface = (rid) => {
    const lid = levelOf(rid);
    const field = roofFieldOf[lid];
    if (!field) return null;
    const c = ceilings.find((x) => roomOf(x) === rid);
    if (c?.type === 'slope') return null;
    const def = levelsById.get(lid)?.ceilingDefault;
    const flat = c?.type === 'roof' ? (num(c.height) ? c.height : Infinity) : num(c?.height) ? c.height : num(def) ? def : 2.4;
    return ceilingSurface(field, roomFloorY(rid) + flat);
  };
  const derivedTop = new Map();
  for (const [id, wi] of wallInfo) {
    if (wi.w.backOf != null || !roofFieldOf[wi.level] || (Array.isArray(wi.w.topProfile) && wi.w.topProfile.length)) continue;
    const surf = roomSurface(wi.room);
    if (!surf) continue;
    derivedTop.set(id, surfaceProfile(wi.w.from, wi.w.to, [{ ...surf, shift: mul(wi.n, 0.01) }], roomFloorY(wi.room), num(wi.w.height) ? wi.w.height : 2.4));
  }
  // roof windows on a sloped ceiling lie in one plane of the roof, with their sides along and across the slope
  for (const c of ceilings) {
    const field = roofFieldOf[levelOf(roomOf(c))];
    if (!field) continue;
    for (const s of arr(c.skylights)) {
      if (!isObj(s) || !Array.isArray(s.polygon) || s.polygon.length !== 4 || !s.polygon.every(isPoint)) continue;
      const where = `ceilings/${c.id}/skylights/${s.id}`;
      const mid = s.polygon.reduce((m, q) => [m[0] + q[0] / 4, m[1] + q[1] / 4], [0, 0]);
      const inset = s.polygon.map((q) => add(q, mul(unitv(sub(mid, q)), 0.01)));
      const planes = inset.map((q) => field.planeAt(q[0], q[1]));
      if (planes.some((pl) => !pl)) {
        warn(`${where}: takvinduet ligger delvis utenfor taket`);
        continue;
      }
      if (planes.some((pl) => pl !== planes[0])) warn(`${where}: takvinduet ligger over en knekk i taket (møne, grat eller ark) – flytt det inn på én takflate`);
      const g = [planes[0].a, planes[0].b];
      if (len(g) > 1e-3) {
        const e = unitv(sub(s.polygon[1], s.polygon[0]));
        const k = Math.abs(dot(e, unitv(g)));
        if (k > 0.03 && k < 0.97) warn(`${where}: sidene følger ikke takfallet (kant 0 står ${fmt((Math.acos(Math.min(1, k)) * 180) / Math.PI, 0)}° på det) – vinduet blir skjevt i takflaten`);
      }
    }
  }

  // ---- openings
  const heightAt = (w, u) => {
    const prof = derivedTop.get(w.id) ?? (Array.isArray(w.topProfile) && w.topProfile.length ? w.topProfile : null);
    if (!prof) return num(w.height) ? w.height : 2.4;
    if (u <= prof[0][0]) return prof[0][1];
    for (let i = 1; i < prof.length; i++) {
      if (u <= prof[i][0]) {
        const [u0, h0] = prof[i - 1];
        const [u1, h1] = prof[i];
        return u1 > u0 ? lerp(h0, h1, (u - u0) / (u1 - u0)) : h1;
      }
    }
    return prof[prof.length - 1][1];
  };
  const minHeight = (w, a, b) => {
    const us = [a, b, ...arr(derivedTop.get(w.id) ?? w.topProfile).map((p) => p[0]).filter((u) => u > a && u < b)];
    return Math.min(...us.map((u) => heightAt(w, u)));
  };
  const guardsOfLevel = (lid) => stairs.flatMap((s) => objs(s.guards).filter((g) => Array.isArray(g.line) && g.line.length >= 2 && g.line.every(isPoint) && (g.level ?? s.toLevel) === lid)
    .flatMap((g) => g.line.slice(1).map((p, i) => [g.line[i], p])));
  const roomAtPoint = (p, lid, except) => rooms.find((r) => r.id !== except && goodRooms.has(r.id) && physical(r) && r.levelId === lid && inOrOn(p, r.polygon, 0.02));

  for (const w of walls) {
    const wi = wallInfo.get(w.id);
    if (!wi) continue;
    const list = arr(w.openings).filter((o) => isObj(o) && num(o.offset) && num(o.width) && num(o.height));
    const sorted = [...list].sort((a, b) => a.offset - b.offset);
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].offset < sorted[i - 1].offset + sorted[i - 1].width - TOL) error(`openings/${sorted[i].id} overlapper ${sorted[i - 1].id} i veggen ${w.id}`);
    }
    for (const o of list) {
      const where = `openings/${o.id} (${w.id})`;
      const sill = num(o.sill) ? o.sill : 0;
      if (o.width <= 0 || o.height <= 0) error(`${where}: bredde og høyde må være over 0`);
      if (o.offset < -TOL || o.offset + o.width > wi.L + TOL) error(`${where}: går utenfor veggen (u ${fmt(o.offset)}–${fmt(o.offset + o.width)} av ${fmt(wi.L)})`);
      if (sill < -TOL) error(`${where}: sill kan ikke være under gulvet`);
      if (w.backOf == null) {
        const top = sill + o.height;
        const hmin = minHeight(w, Math.max(0, o.offset), Math.min(wi.L, o.offset + o.width));
        if (top > hmin + TOL) error(`${where}: toppen ${fmt(top)} er over veggen (${fmt(hmin)})`);
      }
      if (o.type === 'door' && !isObj(o.door)) error(`${where}: en dør må ha door:{ hinge, swing, leaf, … } (formatet til door-gang) – uten o.door blir det et hull uten dør`);
      if (o.type === 'window') {
        const wm = windowModelIssues(o);
        const est = isEst(o, 'sashes', 'panes', 'bars', 'frame', 'revealFloor');
        for (const m of wm.errors) judge(est, `${where}: ${m}`);
        for (const m of wm.warnings) warn(`${where}: ${m}`);
      }
      // the hole through a backOf face of this wall
      const backs = walls.filter((b) => b.backOf != null && (Array.isArray(b.backOf) ? b.backOf : [b.backOf]).includes(w.id) && wallInfo.has(b.id));
      if (backs.length) {
        const p0 = add(w.from, mul(wi.d, o.offset));
        const p1 = add(w.from, mul(wi.d, o.offset + o.width));
        const span = (b) => {
          const bi = wallInfo.get(b.id);
          const a = dot(sub(p0, b.from), bi.d);
          const c = dot(sub(p1, b.from), bi.d);
          return { lo: Math.min(a, c), hi: Math.max(a, c), L: bi.L };
        };
        // only the faces the hole reaches: an opening in a part of the wall with nothing modelled behind it (an
        // exterior stretch beyond a short back face) has no face to fit
        const reached = backs.filter((b) => {
          const s = span(b);
          return Math.min(s.hi, s.L) - Math.max(s.lo, 0) > TOL;
        });
        const fits = reached.some((b) => {
          const s = span(b);
          return s.lo >= -TOL && s.hi <= s.L + TOL;
        });
        if (reached.length && !fits) warn(`${where}: hullet havner ikke helt innenfor baksideflaten(e) ${reached.map((b) => b.id).join(', ')}`);
      }

      const ownerRoom = wi.room;
      const isDoorLike = isObj(o.door) || o.type === 'opening';
      if (!isDoorLike) continue;
      let other = null;
      if (o.connects != null) {
        const c = o.connects;
        if (!Array.isArray(c) || c.length !== 2 || c[0] === c[1]) error(`${where}: connects må være [rom, rom] (to forskjellige)`);
        else {
          for (const id of c) if (!roomExists(id) && !pending('room', id, where)) error(`${where}: connects: rommet «${id}» finnes ikke`);
          if (!c.includes(ownerRoom)) error(`${where}: connects ${JSON.stringify(c)} mangler eierveggens rom «${ownerRoom}»`);
          other = c.find((id) => id !== ownerRoom) ?? null;
        }
      } else if (ownerRoom !== STUE) error(`${where}: mangler connects: [rom, rom]`);
      // what lies behind the wall: must be the other room when it is modelled on the same level
      const mid = add(add(w.from, mul(wi.d, o.offset + o.width / 2)), mul(wi.n, -(wi.t + 0.05)));
      const behind = roomAtPoint(mid, wi.level, ownerRoom);
      if (other && roomsById.has(other) && levelOf(other) === wi.level && physical(roomsById.get(other)) && behind?.id !== other) {
        error(`${where}: connects sier «${other}», men bak veggen ligger ${behind ? `«${behind.id}»` : 'ikke noe rom'}`);
      }
      if (!other && behind) other = behind.id;
      if (!isObj(o.door)) continue;
      const door = o.door;
      if (!door.hinge || !door.swing) error(`${where}: door må ha hinge («from»/«to») og swing («in»/«out»)`);
      if (door.openAngleDeg != null && !(door.openAngleDeg > 0 && door.openAngleDeg <= 180)) error(`${where}: openAngleDeg må være mellom 0 og 180`);
      if (door.opensInto != null) {
        if (Array.isArray(o.connects) && !o.connects.includes(door.opensInto)) error(`${where}: opensInto «${door.opensInto}» står ikke i connects`);
        if (door.swing === 'in' && door.opensInto !== ownerRoom) error(`${where}: swing «in» slår inn i eierveggens rom «${ownerRoom}», men opensInto er «${door.opensInto}»`);
        if (door.swing === 'out' && door.opensInto === ownerRoom) error(`${where}: swing «out» slår bort fra «${ownerRoom}», men opensInto er «${door.opensInto}»`);
      }
      const g = doorGeometry(w, o);
      if (g.leafW > o.width + TOL) error(`${where}: dørbladet (${fmt(g.leafW)}) er bredere enn hullet (${fmt(o.width)})`);
      if (num(door.leaf?.h) && door.leaf.h > o.height + TOL) error(`${where}: dørbladet (${fmt(door.leaf.h)}) er høyere enn hullet (${fmt(o.height)})`);
      const doorEst = isEst(o, 'offset', 'width', 'door');
      // the clear opening stands on floor, not over a hole (on both sides of the wall)
      const holes = holesOfLevel(wi.level);
      const over = holes.find((h) => g.clearPoints().some((p) => strictlyIn(p, h.polygon, 0.005)));
      if (over) judge(doorEst || isEst(over, 'polygon'), `${where}: den frie åpningen står over hullet ${over.id}`);
      // free width past the open leaf (D6): always an error – the fix (openAngleDeg, hinge, swing) is in the data
      const leafRoomId = g.swingIn ? ownerRoom : (door.opensInto ?? other);
      const leafRoom = roomsById.get(leafRoomId);
      const info = { id: o.id, wallId: w.id, room: ownerRoom, leafRoom: leafRoomId ?? null, angle: g.angleDeg, blocked: null, minGuard: null };
      if (leafRoom && goodRooms.has(leafRoom.id) && physical(leafRoom)) {
        const lid = leafRoom.levelId;
        const res = leafBlocksPassage({ region: leafRoom.polygon, holes: holes.map((h) => h.polygon), guards: guardsOfLevel(lid), leaf: g.leaf });
        info.blocked = res.blocked;
        info.minGuard = res.minGuard;
        if (res.blocked) {
          const gap = res.minGuard != null && res.minGuard < FREE_WIDTH ? ` (${fmt(res.minGuard)} m til rekkverket)` : '';
          error(`${where}: det åpne dørbladet (${fmt(g.angleDeg, 0)}°) gir under ${fmt(FREE_WIDTH)} m fri bredde mot rekkverk eller vegg i ${leafRoom.id}${gap} – endre openAngleDeg, hinge eller swing`);
        }
      }
      report.doors.push(info);
    }
  }

  // ---- stairs (§1.6)
  for (const s of stairs) {
    const where = `stairs/${s.id}`;
    const lo = levelsById.get(s.fromLevel);
    const hi = levelsById.get(s.toLevel);
    if (!lo) error(`${where}: fromLevel «${s.fromLevel}» finnes ikke`);
    if (!hi) error(`${where}: toLevel «${s.toLevel}» finnes ikke`);
    const hole = floorOpenings.find((h) => h.id === s.openingId);
    if (!hole) error(`${where}: hullet «${s.openingId}» finnes ikke`);
    else if (hi && hole.levelId !== hi.id) error(`${where}: hullet ${hole.id} er ikke i ${hi.id}`);
    const [lowerId, upperId] = arr(s.roomIds);
    const lower = roomsById.get(lowerId);
    const upper = roomsById.get(upperId);
    if (s.roomIds != null && (!lower || !upper)) {
      const ids = arr(s.roomIds);
      const missing = ids.filter((id) => !roomsById.has(id));
      if (ids.length !== 2 || !missing.every((id) => pending('room', id, where))) error(`${where}: roomIds må være [rommet nede, rommet oppe] og finnes`);
    }
    if (lower && lo && lower.levelId !== lo.id) error(`${where}: ${lower.id} er ikke på ${lo.id}`);
    if (upper && hi && upper.levelId !== hi.id) error(`${where}: ${upper.id} er ikke på ${hi.id}`);
    if (!Number.isInteger(s.risers) || s.risers < 2) error(`${where}: risers må være et heltall ≥ 2`);
    if (!lo || !hi || !Number.isInteger(s.risers) || s.risers < 2) continue;
    if (!num(lo.floorY) || !num(hi.floorY) || hi.floorY <= lo.floorY) {
      error(`${where}: toLevel må ligge over fromLevel`);
      continue;
    }
    let walk;
    try {
      // the shaft walls: the stair's own footprint, else the room at its foot, else its hole
      const holeOf = hole && Array.isArray(hole.polygon) && hole.polygon.length >= 3 && hole.polygon.every(isPoint) ? hole.polygon : undefined;
      const lowerOf = lower && goodRooms.has(lower.id) && physical(lower) ? lower.polygon : undefined;
      walk = stairWalk(s, { bound: Array.isArray(s.footprint) ? s.footprint : lowerOf ?? holeOf });
    } catch (err) {
      error(`${where}: ${err.message}`);
      continue;
    }
    const rise = hi.floorY - lo.floorY;
    const riser = rise / s.risers;
    const going = num(s.going) ? s.going : walk.length / (s.risers - 1);
    const estRiser = isEst(s, 'risers') || isEst(lo, 'floorY') || isEst(hi, 'floorY');
    const estGeom = estRiser || isEst(s, 'top', 'foot', 'well', 'going', 'type');
    const twoRG = 2 * riser + going;
    const slopeDeg = (Math.atan2(riser, going) * 180) / Math.PI;
    if (riser < RISER_RANGE[0] || riser > RISER_RANGE[1]) judge(estRiser, `${where}: opptrinnet ${fmt(riser, 3)} er utenfor ${fmt(RISER_RANGE[0])}–${fmt(RISER_RANGE[1])}`);
    if (twoRG < STEP_RANGE[0] || twoRG > STEP_RANGE[1]) judge(estGeom, `${where}: 2·opptrinn + inntrinn = ${fmt(twoRG, 3)} er utenfor ${fmt(STEP_RANGE[0])}–${fmt(STEP_RANGE[1])}`);
    if (going < MIN_GOING) judge(estGeom, `${where}: inntrinnet på ganglinja er ${fmt(going, 3)}, under ${fmt(MIN_GOING)}`);
    // heights along the walk line (u from the top nosing): the top nosing is the upper floor, the lowest one riser up
    const yAt = (u) => (u > walk.length + 1e-9 ? lo.floorY : Math.max(lo.floorY, hi.floorY - (u / going) * riser));
    const surfaceAt = (u) => (u <= 0 ? hi.floorY : hi.floorY - Math.min(s.risers - 1, Math.ceil(u / going - 1e-9)) * riser);
    const step = 0.02;
    const samples = [];
    for (let u = 0; u <= walk.length + FOOT_FIELD + 1e-9; u += step) samples.push(u);
    const holePoly = hole && Array.isArray(hole.polygon) && hole.polygon.every(isPoint) ? hole.polygon : null;
    const estHole = hole ? isEst(hole, 'polygon') : false;
    // headroom: under the slab edges outside the hole, under the upper ceiling inside it
    const upperCeiling = (p) => {
      const c = ceilings.find((x) => levelOf(roomOf(x)) === hi.id && Array.isArray(x.polygon) && x.polygon.every(isPoint) && inOrOn(p, x.polygon));
      return hi.floorY + (num(c?.height) ? c.height : num(hi.ceilingDefault) ? hi.ceilingDefault : 2.4);
    };
    const slabUnder = hi.floorY - (num(hi.slabThickness) ? hi.slabThickness : 0.3);
    let minHead = Infinity;
    let minHeadAt = null;
    for (const u of samples) {
      const a = walk.at(Math.min(u, walk.length + FOOT_FIELD));
      const perp = [-a.dir[1], a.dir[0]];
      for (const k of [0, -0.8, 0.8]) {
        const p = add(a.p, mul(perp, a.halfWidth * k));
        const ceil = holePoly && inOrOn(p, holePoly, 0.001) ? upperCeiling(p) : slabUnder;
        const head = ceil - yAt(u);
        if (head < minHead) {
          minHead = head;
          minHeadAt = p;
        }
      }
    }
    if (minHead < HEADROOM_MIN) judge(estGeom || estHole, `${where}: fri høyde ${fmt(minHead)} ved (${fmt(minHeadAt[0])}; ${fmt(minHeadAt[1])}) er under spillgrensa ${fmt(HEADROOM_MIN)}`);
    else if (minHead < HEADROOM_WARN) warn(`${where}: fri høyde ${fmt(minHead)} ved (${fmt(minHeadAt[0])}; ${fmt(minHeadAt[1])}) er under ${fmt(HEADROOM_WARN)}`);
    // footprint: tread cross-sections every 5 cm, inside the hole and inside the lower room
    const quads = [];
    let prev = null;
    for (let u = 0; u <= walk.length + 1e-9; u += 0.05) {
      const a = walk.at(Math.min(u, walk.length));
      const perp = [-a.dir[1], a.dir[0]];
      // the tread cross-section: radial from the well corner to the shaft walls in a winder arc (V13), else the flight
      const sec = a.section ? [a.section[0], a.section[1], u] : [add(a.p, mul(perp, a.halfWidth)), add(a.p, mul(perp, -a.halfWidth)), u];
      if (prev) quads.push({ poly: [prev[0], prev[1], sec[1], sec[0]], u: (prev[2] + u) / 2 });
      prev = sec;
    }
    const corners = quads.flatMap((q) => q.poly);
    if (holePoly) {
      const outside = corners.find((p) => !inOrOn(p, holePoly, 0.02));
      if (outside) judge(estGeom || estHole, `${where}: trinnene går utenfor hullet ${hole.id} ved (${fmt(outside[0])}; ${fmt(outside[1])})`);
    }
    if (lower && goodRooms.has(lower.id)) {
      const outside = corners.find((p) => !inOrOn(p, lower.polygon, 0.02));
      if (outside) judge(estGeom || isEst(lower, 'polygon'), `${where}: trinnene går utenfor ${lower.id} ved (${fmt(outside[0])}; ${fmt(outside[1])})`);
    }
    const inQuad = (p) => quads.find((q) => pointInPolygon(p, q.poly));
    const fe = s.foot.edge;
    const d2 = unitv(s.foot.down);
    const footField = [fe[0], fe[1], add(fe[1], mul(d2, FOOT_FIELD)), add(fe[0], mul(d2, FOOT_FIELD))];
    if (signedArea(footField) < 0) footField.reverse();
    // doors: none swings over the hole (upper level) or over the stair / the field in front of the lowest tread
    // (lower level); a door under the stair is cut by the builder (warning)
    const treadT = num(s.tread?.thickness) ? s.tread.thickness : 0.045;
    for (const w of walls) {
      const wi = wallInfo.get(w.id);
      if (!wi || (wi.level !== hi.id && wi.level !== lo.id)) continue;
      for (const o of objs(w.openings)) {
        if (!isObj(o.door) || !num(o.offset) || !num(o.width) || !num(o.height)) continue;
        const g = doorGeometry(w, o);
        const est = estGeom || isEst(o, 'offset', 'width', 'door');
        if (wi.level === hi.id && holePoly) {
          if (g.sweepPoints().some((p) => strictlyIn(p, holePoly))) judge(est || estHole, `openings/${o.id}: døra slår inn over trappehullet ${hole.id}`);
        }
        if (wi.level === lo.id) {
          const doorH = num(o.door.leaf?.h) ? o.door.leaf.h : o.height;
          const hit = g.sweepPoints().find((p) => {
            if (strictlyIn(p, footField)) return true;
            const q = inQuad(p);
            return q && surfaceAt(q.u) - lo.floorY < doorH + 0.05;
          });
          if (hit) judge(est, `openings/${o.id}: døra slår inn over trappa eller feltet ${fmt(FOOT_FIELD, 1)} m foran nederste trinn`);
          if (holePoly) {
            const top = lo.floorY + (num(o.sill) ? o.sill : 0) + o.height;
            let lowest = Infinity;
            for (let k = 0; k <= 10; k++) {
              const u = o.offset + (o.width * k) / 10;
              // the door's opening just in front of both faces: under a tread of the stair (inside a cross-section
              // quad), not merely next to the stair – a door beside the foot (the laundry door) is not cut
              for (const off of [0.02, -wi.t - 0.02]) {
                const p = add(add(w.from, mul(wi.d, u)), mul(wi.n, off));
                if (!inOrOn(p, holePoly, 0.02)) continue;
                const q = inQuad(p);
                if (!q) continue;
                lowest = Math.min(lowest, surfaceAt(q.u) - treadT);
              }
            }
            if (top > lowest - 0.05) {
              warn(`openings/${o.id}: dørhøyden (topp ${fmt(top)}) går opp i trappeundersiden (${fmt(lowest)}); builderen kutter den til ${fmt(Math.min(o.height, lowest - 0.05 - lo.floorY - (o.sill ?? 0)))}`);
            }
          }
        }
      }
    }
    // door frames (V17, avstemming §2.4): the tread edges with their nosing – the lowest one on the lower level, the
    // floor edge at the top on the upper one – and the foot of the stringers (cut vertically `stringers.footCut` past
    // the lowest nosing line) stay at least DOOR_FRAME_CLEARANCE from every door frame (jambs with their depth)
    const nosing = num(s.tread?.nosing) ? s.tread.nosing : 0.02;
    const footCut = num(s.stringers?.footCut) ? s.stringers.footCut : nosing;
    const te = s.top.edge;
    const d1 = unitv(s.top.down);
    const features = [
      { level: lo.id, what: 'nederste trinnkant (med nesa)', seg: [add(fe[0], mul(d2, nosing)), add(fe[1], mul(d2, nosing))] },
      { level: lo.id, what: 'vangefoten', seg: [add(fe[0], mul(d2, footCut)), add(fe[0], mul(d2, footCut))] },
      { level: lo.id, what: 'vangefoten', seg: [add(fe[1], mul(d2, footCut)), add(fe[1], mul(d2, footCut))] },
      { level: hi.id, what: 'øverste trinnkant', seg: [te[0], te[1]] },
      { level: hi.id, what: 'øverste trinnkant (med nesa)', seg: [add(te[0], mul(d1, nosing)), add(te[1], mul(d1, nosing))] },
    ];
    const clearances = [];
    for (const w of walls) {
      const wi = wallInfo.get(w.id);
      if (!wi || (wi.level !== hi.id && wi.level !== lo.id)) continue;
      for (const o of objs(w.openings)) {
        if (!isObj(o.door) || !num(o.offset) || !num(o.width)) continue;
        const jambs = doorJambs(wi, o);
        let worst = null;
        for (const f of features) {
          if (f.level !== wi.level) continue;
          const d = Math.min(...jambs.map((j) => distSegPoly(f.seg[0], f.seg[1], j)));
          if (worst === null || d < worst.dist) worst = { what: f.what, dist: d };
        }
        if (!worst || worst.dist > 1.0) continue;
        clearances.push({ door: o.id, what: worst.what, dist: worst.dist });
        if (worst.dist < DOOR_FRAME_CLEARANCE - 1e-6) {
          judge(estGeom || isEst(o, 'offset', 'width', 'frame'), `${where}: ${worst.what} står ${fmt(worst.dist, 3)} fra karmen til ${o.id} (minst ${fmt(DOOR_FRAME_CLEARANCE)})`);
        }
      }
    }
    const capsule = 1.2 + 0.6 / Math.cos(Math.atan2(riser, going));
    report.stairs.push({ id: s.id, risers: s.risers, riser, going, walkLength: walk.length, twoRG, slopeDeg, minHeadroom: minHead, capsuleHeadroom: capsule, doorClearance: clearances, estimated: estGeom });
  }

  // ---- light groups
  const groupIds = new Set(lightGroups.map((g) => g.id));
  for (const g of lightGroups) {
    const where = `lightGroups/${g.id}`;
    const rg = reg.lightGroups?.[g.id];
    if (reg.lightGroups && !rg) error(`${where}: gruppa står ikke i research/house/00-ids.json`);
    if (rg && rg.roomId !== undefined && (g.roomId ?? null) !== rg.roomId) error(`${where}: roomId «${g.roomId ?? null}» ≠ «${rg.roomId}» i 00-ids.json`);
    if (num(g.defaultDimmer) && (g.defaultDimmer < 0 || g.defaultDimmer > 1)) error(`${where}: defaultDimmer må være mellom 0 og 1`);
  }
  for (const s of stairs) {
    for (const h of arr(s.handrails)) if (h?.led?.group != null && !groupIds.has(h.led.group) && !pending('group', h.led.group, `stairs/${s.id}`)) error(`stairs/${s.id}: LED-lista i håndløperen er i gruppa «${h.led.group}», som ikke finnes i lightGroups`);
  }
  const legacySpecGroups = new Set(arr(reg.legacyLightGroups?.spec));
  for (const l of objs(spec.builtInLights)) {
    const where = `builtInLights/${l.id}`;
    if (roomOf(l) === STUE && l.roomId == null) {
      if (reg.legacyLightGroups && !legacySpecGroups.has(l.group)) error(`${where}: gruppa «${l.group}» er ikke en av stuas (${[...legacySpecGroups].join(', ')})`);
    } else if (!groupIds.has(l.group)) error(`${where}: gruppa «${l.group}» finnes ikke i lightGroups (layout.js faller ikke lenger tilbake til «kjokken»)`);
  }

  // ---- built-ins, fixtures, furniture
  // only canonical names: existing.js (originalItems) resolves an alias through f.kind, never through f.archetype, so
  // { archetype: 'sofa' } without a matching kind would silently become a vase
  for (const f of objs(spec.furniture)) {
    if (!(f.archetype && archetypes.archetypes?.[f.archetype])) {
      const alias = f.archetype ? archetypes.archetypeAliases?.[f.archetype] : null;
      if (alias) error(`furniture/${f.id}: arketypen «${f.archetype}» er et alias – bruk «${alias}» (existing.js slår ikke opp alias i archetype, så den blir ellers stille en vase)`);
      else error(`furniture/${f.id}: arketypen «${f.archetype}» finnes ikke i src/data/archetypes.json (ellers blir den stille en vase)`);
    }
    if (f.roomId != null && goodRooms.has(f.roomId) && Array.isArray(f.position) && f.position.length === 3) {
      const r = roomsById.get(f.roomId);
      if (physical(r) && !inOrOn([f.position[0], f.position[2]], r.polygon, 0.05)) warn(`furniture/${f.id}: står utenfor rommet ${r.id}`);
    }
  }
  for (const b of objs(spec.builtIns)) {
    const where = `builtIns/${b.id}`;
    if (b.mount === 'wall') {
      const w = wallsById.get(b.wallId);
      if (!w) error(`${where}: veggen «${b.wallId}» finnes ikke`);
      else if (roomOf(w) !== b.roomId) error(`${where}: veggen ${w.id} er i rommet ${roomOf(w)}, ikke ${b.roomId}`);
    }
    if (b.light?.group != null && !groupIds.has(b.light.group)) error(`${where}: lysgruppa «${b.light.group}» finnes ikke`);
    const r = roomsById.get(b.roomId);
    if (r && goodRooms.has(r.id) && physical(r) && Array.isArray(b.position) && b.position.length === 3 && !inOrOn([b.position[0], b.position[2]], r.polygon, 0.05)) {
      warn(`${where}: står utenfor rommet ${r.id}`);
    }
  }
  for (const f of objs(spec.fixtures)) {
    if (f.wallId == null) continue;
    const w = wallsById.get(f.wallId);
    if (!w) error(`fixtures/${f.id}: veggen «${f.wallId}» finnes ikke`);
    else if (f.roomId != null && roomOf(w) !== f.roomId) warn(`fixtures/${f.id}: veggen ${w.id} er i rommet ${roomOf(w)}, ikke ${f.roomId}`);
  }
  for (const fs_ of objs(spec.facadeSegments)) {
    for (const id of arr(fs_.wallIds)) {
      const w = wallsById.get(id);
      if (!w) error(`facadeSegments/${fs_.id}: veggen «${id}» finnes ikke`);
      else if (!w.exterior) error(`facadeSegments/${fs_.id}: ${id} er ikke en yttervegg`);
      else if (isFrozen('walls', id)) error(`facadeSegments/${fs_.id}: ${id} er en av stuas fotomålte yttervegger – bare nye yttervegger får fasadesegment`);
    }
    for (const k of ['joinStart', 'joinEnd']) if (fs_[k] != null && !wallsById.has(fs_[k])) error(`facadeSegments/${fs_.id}: ${k} «${fs_[k]}» finnes ikke`);
  }

  // ---- room table and control areas
  for (const r of rooms) {
    const area = goodRooms.has(r.id) && physical(r) ? polygonArea(r.polygon) : null;
    const control = reg.rooms?.[r.id]?.control ?? null;
    const dev = area != null && num(control?.area) ? (area - control.area) / control.area : null;
    if (dev != null && Math.abs(dev) > AREA_TOLERANCE) warn(`rooms/${r.id}: arealet ${fmt(area)} m² avviker ${fmt(dev * 100, 1)} % fra kontrollarealet ${fmt(control.area)} m² (${control.source ?? '00-ids.json'})`);
    const lvl = levelsById.get(r.levelId);
    report.rooms.push({ id: r.id, name: r.name, levelId: r.levelId ?? null, levelName: lvl?.name ?? r.levelId ?? '', kind: r.kind, area, control: control?.area ?? null, deviation: dev, walls: wallsOfRoom(r.id).length });
  }

  // ---- the measuring list: every estimated field, sorted by room
  const stairRoom = (s) => (roomsById.get('trapp') ? 'trapp' : arr(s.roomIds)[1] ?? STUE);
  const listRoom = (x) => {
    if (x.coll === 'levels') return '$levels';
    if (x.coll === 'rooms') return x.e.id;
    if (x.coll === 'openings') return roomOf(x.wall);
    if (x.coll === 'stairs') return stairRoom(x.e);
    if (x.coll === 'guards') return stairRoom(x.stair);
    if (x.coll === 'lightGroups') return x.e.roomId ?? '$other';
    if (x.coll === 'facadeSegments') return roomOf(wallsById.get(arr(x.e.wallIds)[0]));
    return roomOf(x.e);
  };
  for (const x of entries) {
    if (!isObj(x.e) || !Array.isArray(x.e.estimated) || !x.e.estimated.length) continue;
    report.measureList.push({ room: listRoom(x), coll: x.coll, id: x.id, fields: [...x.e.estimated], source: typeof x.e.source === 'string' ? x.e.source : '' });
  }
  for (const key of ['outsideHouse']) {
    const o = spec[key];
    if (isObj(o) && Array.isArray(o.estimated) && o.estimated.length) report.measureList.push({ room: 'ute', coll: key, id: key, fields: [...o.estimated], source: o.source ?? '' });
  }
  const roomOrder = ['$levels', ...rooms.map((r) => r.id), 'ute', '$other'];
  const rank = (id) => (roomOrder.includes(id) ? roomOrder.indexOf(id) : roomOrder.length);
  report.measureList.sort((a, b) => rank(a.room) - rank(b.room) || (a.room < b.room ? -1 : a.room > b.room ? 1 : 0));

  if (errors.length && opts.throw !== false) {
    const e = new Error(`validateHouse: ${errors.length} feil i hele huset\n  - ${errors.join('\n  - ')}`);
    e.report = report;
    throw e;
  }
  return report;
}

// ---------------------------------------------------------------------------------------------------------------
// Output: console report and the generated «Målelista» section of research/room-spec-notes.md

const pct = (v) => {
  if (v == null) return '–';
  const s = fmt(v * 100, 1);
  return `${v > 0 && s !== '0,0' ? '+' : ''}${s} %`;
};

/** Console text: summary, stair numbers, warnings; with verbose the room table and the measuring list. */
export function formatReport(report, { verbose = false } = {}) {
  const lines = [];
  lines.push(`hele huset: ${report.levels.length} nivå(er), ${report.rooms.length} rom, ${report.stairs.length} trapp(er) – validatoren: ${report.errors.length} feil, ${report.warnings.length} advarsler`);
  for (const s of report.stairs) {
    lines.push(`  trapp ${s.id}: ${s.risers} opptrinn à ${fmt(s.riser, 3)}, inntrinn ${fmt(s.going, 3)} (ganglinje ${fmt(s.walkLength)} m), 2r+g ${fmt(s.twoRG, 3)}, stigning ${fmt(s.slopeDeg, 1)}°, minste frie høyde ${fmt(s.minHeadroom)} (kapselen trenger ${fmt(s.capsuleHeadroom)})`);
  }
  for (const w of report.warnings) lines.push(`  advarsel: ${w}`);
  if (verbose) {
    lines.push('  rom:');
    for (const r of report.rooms) {
      lines.push(`    ${r.id.padEnd(16)} ${String(r.name ?? '').padEnd(18)} ${String(r.levelName).padEnd(10)} ${String(r.kind).padEnd(9)} ${r.area == null ? '–' : `${fmt(r.area)} m²`}  kontroll ${r.control == null ? '–' : `${fmt(r.control)} m²`} (${pct(r.deviation)}), ${r.walls} vegger`);
    }
    lines.push(`  målelista (${report.measureList.length}):`);
    for (const m of report.measureList) lines.push(`    ${m.room.padEnd(16)} ${m.coll}/${m.id}: ${m.fields.join(', ')}`);
  }
  return lines.join('\n');
}

export const NOTES_START = '<!-- målelista:start -->';
export const NOTES_END = '<!-- målelista:slutt -->';

/** Markdown for the generated section: the room table, the stairs and the estimated fields per room. */
export function measureListMarkdown(report) {
  const roomName = new Map(report.rooms.map((r) => [r.id, r.name]));
  const levelName = new Map(report.levels.map((l) => [l.id, l.name]));
  const out = [];
  out.push('_Generert av `node src/data/scripts/normalize-data.mjs` (validateHouse i `src/data/scripts/house.mjs`) fra `research/house/*.json`. Ikke rediger avsnittet for hånd. Når et mål kommer inn: fjern feltet fra `estimated`, sett `source` til «målt <dato>» og kjør normaliseren på nytt._');
  out.push('');
  out.push('**Rommene**');
  out.push('');
  out.push('| Rom | Nivå | Type | Areal i modellen | Kontrollareal | Avvik |');
  out.push('|---|---|---|---|---|---|');
  for (const r of report.rooms) {
    out.push(`| ${r.name} (\`${r.id}\`) | ${r.levelName} | ${r.kind} | ${r.area == null ? '–' : `${fmt(r.area)} m²`} | ${r.control == null ? '–' : `${fmt(r.control)} m²`} | ${pct(r.deviation)} |`);
  }
  if (report.stairs.length) {
    out.push('');
    out.push('**Trappene**');
    out.push('');
    for (const s of report.stairs) {
      out.push(`- \`${s.id}\`: ${s.risers} opptrinn à ${fmt(s.riser, 3)} m, inntrinn ${fmt(s.going, 3)} m på ganglinja (${fmt(s.walkLength)} m), 2r + g = ${fmt(s.twoRG, 3)}, stigning ${fmt(s.slopeDeg, 1)}°, minste frie høyde ${fmt(s.minHeadroom)} m.`);
    }
  }
  out.push('');
  out.push('**Anslått, sortert etter rom**');
  out.push('');
  if (!report.measureList.length) out.push('Ingenting er merket anslått.');
  let current = null;
  for (const m of report.measureList) {
    if (m.room !== current) {
      current = m.room;
      const title = m.room === '$levels' ? 'Nivåer' : m.room === '$other' ? 'Annet' : m.room === 'ute' ? 'Ute' : `${roomName.get(m.room) ?? m.room} (\`${m.room}\`)`;
      out.push(`- **${title}**`);
    }
    const name = m.coll === 'levels' ? `${levelName.get(m.id) ?? m.id} (\`levels/${m.id}\`)` : `\`${m.coll}/${m.id}\``;
    const fields = m.fields.map((f) => (f === '*' ? 'hele oppføringen' : `\`${f}\``)).join(', ');
    out.push(`  - ${name}: ${fields}${m.source ? `. Kilde: ${m.source.replace(/\s+/g, ' ').trim()}` : ''}`);
  }
  return out.join('\n');
}

/** The notes text with the generated section replaced (or appended under «## Målelista»). */
export function updateNotesSection(text, body) {
  const block = `${NOTES_START}\n${body}\n${NOTES_END}`;
  const i = text.indexOf(NOTES_START);
  const j = text.indexOf(NOTES_END);
  if (i >= 0 && j > i) return text.slice(0, i) + block + text.slice(j + NOTES_END.length);
  return `${text.replace(/\s*$/, '')}\n\n## Målelista\n\n${block}\n`;
}

/** Writes the notes file (source → target, default in place) with a fresh «Målelista»; only when it changed. */
export function writeMeasureList(report, sourceFile, targetFile = sourceFile) {
  const text = fs.existsSync(sourceFile) ? fs.readFileSync(sourceFile, 'utf8') : '# Romspesifikasjon – notater\n';
  const next = updateNotesSection(text, measureListMarkdown(report));
  if (targetFile === sourceFile && next === text) return false;
  fs.mkdirSync(path.dirname(targetFile), { recursive: true });
  fs.writeFileSync(targetFile, next, 'utf8');
  return true;
}
