import { Box3, Vector2, Vector3 } from 'three';
import roomSpec from '../data/room-spec.json';
import paletteData from '../data/palette.json';

/**
 * Room layout: reads data/room-spec.json and derives typed, world-space values for every module (shell, lighting,
 * placement, acoustics …). ALL room measurements live here – no magic room numbers anywhere else.
 *
 * Coordinates (ARCHITECTURE §1): metres, +x = south (big windows), +z = west (TV-stue), +y = up, origin = floor at
 * the top-left interior corner of the plan. Plan points are Vector2(x, z). The exported object is deep-frozen
 * (vectors included): clone before mutating (`layout.highWall.origin.clone().add(…)`).
 *
 * @typedef {'window'|'terrace-door'|'door'} OpeningType
 *
 * @typedef {Object} OpeningLayout
 * @property {string} id
 * @property {OpeningType} type
 * @property {string} name
 * @property {string} wallId
 * @property {number} offset      distance along the wall from its start to the near edge of the hole
 * @property {number} width
 * @property {number} height
 * @property {number} sill        bottom of the hole (= top of the sill board)
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
 *
 * @typedef {Object} WallLayout
 * @property {string} id
 * @property {string} name
 * @property {Vector2} start       plan point (x, z) on the room-side face
 * @property {Vector2} end
 * @property {Vector2} dir         unit vector start → end
 * @property {Vector2} normal      into the room
 * @property {Vector3} dir3
 * @property {Vector3} normal3
 * @property {number} length
 * @property {number} thickness    the wall extends this far OUTWARD from the room-side face
 * @property {string} paint        'sand' | 'marrakesh' | '#hex'
 * @property {string} paintHex
 * @property {boolean} exterior
 * @property {boolean} isHigh
 * @property {boolean} hiddenBehindCabinets
 * @property {number} height       highest point of the top edge
 * @property {Array<[number, number]>} topProfile  [[u, height], …] along the wall (always present)
 * @property {(u: number) => number} heightAt     top edge height at u
 * @property {(u: number, y?: number, out?: Vector3) => Vector3} pointAt  world point on the room-side face
 * @property {OpeningLayout[]} openings
 * @property {string} [notes]
 */

const DEG = Math.PI / 180;
const EPS = 1e-6;
const ZONE_BOX_TOP = 3.1;

/** Contract light groups (ARCHITECTURE §15) with Norwegian labels and the dimmer they start at (the levels the owner
 *  uses in the evening; on/off still follows the time of day until the group is switched by hand). */
const LIGHT_GROUPS = [
  { id: 'led', label: 'LED-lister', dimmer: 0.15 },
  { id: 'spots', label: 'Spotter ved den høye veggen', dimmer: 0.07 },
  { id: 'kjokken', label: 'Kjøkkenlys', dimmer: 0.3 },
  { id: 'pendler', label: 'Pendler over kjøkkenøya', dimmer: 0.3 },
  { id: 'overskap', label: 'Lys under overskapet', dimmer: 0.16 },
  { id: 'tvstue', label: 'Taklampe i TV-stua', dimmer: 0.35 },
];
const SPEC_GROUP_TO_GROUP = { 'led-lister': 'led', 'spotter-hoyvegg': 'spots', 'taklampe-tvstue': 'tvstue', kjokkenlys: 'kjokken' };

/** Group of a room-spec light: the strip under the glass cabinet and the island pendants have their own switch. */
function lightGroupOf(l) {
  if (l.id === 'led-overskap') return 'overskap';
  if (l.type === 'pendant-cylinder' && l.group === 'kjokkenlys') return 'pendler';
  return SPEC_GROUP_TO_GROUP[l.group] || 'kjokken';
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

function distToPolygon(x, z, poly) {
  if (pointInPolygon(x, z, poly)) return 0;
  let d = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) d = Math.min(d, distToSegment(x, z, poly[i], poly[j]));
  return d;
}

const v2 = (p) => new Vector2(p[0], p[1]);
const v3 = (p) => new Vector3(p[0], p[1], p[2]);
const toPoly = (arr) => (arr || []).map(v2);

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

// ---------------------------------------------------------------------------------------------------------------

/**
 * Builds the layout object from a room spec (default: data/room-spec.json).
 * @param {Object} [spec]
 * @param {Object} [palette]
 * @returns {Readonly<Object>} the frozen layout (see the typedefs above and the fields at the end of this function)
 */
export function buildLayout(spec = roomSpec, palette = paletteData) {
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

  // ---- walls + openings
  const walls = (spec.walls || []).map((w) => {
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
    const pointAt = (u, y = 0, out = new Vector3()) => out.set(start.x + dir.x * u, y, start.y + dir.y * u);

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
      };
    });

    return {
      id: w.id,
      name: w.name,
      start,
      end,
      dir,
      normal,
      dir3,
      normal3,
      length,
      thickness: w.thickness ?? 0.1,
      paint: w.paint ?? 'sand',
      paintHex: resolvePaint(w.paint ?? 'sand'),
      exterior: !!w.exterior,
      isHigh: !!w.isHigh,
      hiddenBehindCabinets: !!w.hiddenBehindCabinets,
      height,
      topProfile,
      heightAt: (u) => profileAt(topProfile, u),
      pointAt,
      openings,
      notes: w.notes ?? '',
    };
  });
  const wallsById = Object.fromEntries(walls.map((w) => [w.id, w]));
  const openings = walls.flatMap((w) => w.openings);
  const openingsById = Object.fromEntries(openings.map((o) => [o.id, o]));
  const windows = openings.filter((o) => o.type === 'window' || o.type === 'terrace-door');
  const doors = openings
    .filter((o) => o.door)
    .map((o) => ({
      ...o,
      hinge: o.door.hinge ?? 'from',
      swing: o.door.swing ?? 'in',
      leaf: o.door.leaf ?? { w: o.width - 2 * (o.frame?.width ?? 0.05), h: o.height - (o.frame?.width ?? 0.05) },
      // Door.js frame: origin = bottom centre on the wall's room-side face, x = right, y = up, z = into the room.
      basis: { origin: o.bottomCenter.clone(), xAxis: o.right.clone(), yAxis: new Vector3(0, 1, 0), zAxis: o.normal.clone() },
    }));

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
  const zones = (spec.zones || []).map((zn) => {
    const polygon = toPoly(zn.polygon);
    const b = boundsOf(polygon);
    return {
      id: zn.id,
      name: zn.name,
      polygon,
      area: polygonArea(polygon),
      centroid: polygonCentroid(polygon),
      bounds: b,
      box: new Box3(new Vector3(b.minX, 0, b.minZ), new Vector3(b.maxX, ZONE_BOX_TOP, b.maxZ)),
      contains: (x, z) => pointInPolygon(x, z, polygon),
    };
  });
  const zoneAt = (x, z) => zones.find((zn) => zn.contains(x, z)) || null;

  // ---- ceilings
  const ceilings = (spec.ceilings || []).map((c) => {
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
      const h = c.height ?? 2.4;
      heightAt = () => h;
    }
    const area = polygonArea(polygon);
    const centroid = polygonCentroid(polygon);
    return {
      id: c.id,
      name: c.name,
      type: c.type ?? 'flat',
      paint: c.paint ?? 'sand',
      paintHex: resolvePaint(c.paint ?? 'sand'),
      polygon,
      area,
      centroid,
      height: c.height ?? null,
      highHeight: c.highHeight ?? null,
      lowHeight: c.lowHeight ?? null,
      slope,
      formula: c.formula ?? null,
      heightAt,
      // A plane ceiling's mean height is its height at the area centroid, so this is exact for flat + sloped.
      volume: area * heightAt(centroid.x, centroid.y),
    };
  });

  // ---- bulkheads (vertical drops in the ceiling)
  const bulkheads = (spec.bulkheads || []).map((b) => {
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

  /**
   * Ceiling height at a plan point: flat 2.40 in the kitchen and TV-stue, the slope y = 3.00 − 0.16216·(x − 3.22)
   * over dining/living, lowered under bulkheads. Points outside every ceiling use the nearest one.
   * @param {number} x
   * @param {number} z
   * @returns {number}
   */
  function ceilingHeightAt(x, z) {
    let ceiling = ceilings.find((c) => pointInPolygon(x, z, c.polygon));
    if (!ceiling) {
      let best = Infinity;
      for (const c of ceilings) {
        const d = distToPolygon(x, z, c.polygon);
        if (d < best) {
          best = d;
          ceiling = c;
        }
      }
    }
    let h = ceiling ? ceiling.heightAt(x, z) : 2.4;
    for (const b of bulkheads) {
      const f = b.footprint;
      if (x > f.minX + EPS && x < f.maxX - EPS && z > f.minZ + EPS && z < f.maxZ - EPS) h = Math.min(h, b.bottom);
    }
    return h;
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

  // ---- built-in lights (stay in the shell; LightManager drives them)
  const builtInLights = (spec.builtInLights || []).map((l) => {
    const group = lightGroupOf(l);
    const out = {
      id: l.id,
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
      out.from = v3(l.from);
      out.to = v3(l.to);
      out.length = out.from.distanceTo(out.to);
      out.lumensPerM = l.lumensPerM ?? 0;
      out.lumens = (l.lumensPerM ?? 0) * out.length;
    }
    if (l.position) {
      out.position = v3(l.position);
      out.lumens = l.lumens ?? out.lumens ?? 0;
    }
    if (l.aimAt && l.position) {
      out.aimAt = v3(l.aimAt);
      out.direction = out.aimAt.clone().sub(out.position).normalize();
      out.beamDeg = l.beamDeg ?? 36;
    }
    if (l.dims?.bottomY != null && l.position) out.bottom = new Vector3(l.position[0], l.dims.bottomY, l.position[2]);
    if (!out.direction && out.position) out.direction = new Vector3(0, -1, 0);
    if (out.lumens == null) out.lumens = 0;
    return out;
  });

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

  // ---- fixtures (sockets, switches, smoke detectors, heat pump)
  const fixtures = (spec.fixtures || []).map((f) => {
    const wall = f.wallId ? wallsById[f.wallId] : null;
    return {
      ...deepClone(f),
      position: v3(f.position),
      normal: wall ? wall.normal3.clone() : new Vector3(0, -1, 0),
      mount: wall ? 'wall' : 'ceiling',
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
  const photoCameras = (spec.photoCameras || []).map((c) => {
    const fileName = String(c.file).split('/').pop();
    const photoRect = c.photoRect ?? [0, 0, c.imageSize[0], c.imageSize[1]];
    return {
      id: fileName.replace(/\.[a-z]+$/i, ''),
      file: c.file,
      fileName,
      montage: c.file.startsWith('stue_hoy_vegg_forslag/'),
      pos: v3(c.pos),
      lookAt: v3(c.lookAt),
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
    lightGroups: LIGHT_GROUPS.filter((g) => builtInLights.some((l) => l.group === g.id)),
    kitchen,
    fixtures,
    furniture: deepClone(spec.furniture) || [],
    outside,
    photoCameras,
    photoCamera: (id) => photoCameras.find((c) => c.id === id || c.file === id || c.fileName === id) || null,
    /** Interior bounding rectangle of the floor (plan). */
    bounds: floorBounds,
    floorArea: floor.area,
    /** Air volume: the ceiling integrated over the floor polygon (≈ 138.6 m³). */
    volume,
    isInside: floor.contains,
  };
  return deepFreeze(layout);
}

/** The layout of the real room (data/room-spec.json). */
export const layout = buildLayout();
export default layout;
