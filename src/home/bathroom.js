// Bathroom fittings of the house (notes/hele-huset-design.md §1.2 `builtIns`, §2.1, §2.3; avstemming V38–V45, V59–V60;
// notes/hus-foto/bad-1etg.md, vaskerom.md): the wall-hung WC with its cistern box, the wall-hung vanity with an
// integrated basin, the shower (five-sided with two swing doors – the bathroom of 1. etasje – or rectangular with a
// fixed + sliding front and a fixed side panel – the basement laundry), the round LED mirror, the towel radiator and
// the floor drain.
//
// Every builder works in the built-in's LOCAL frame, set up by builtins.js: origin at the middle of the footprint on
// its underside (y = 0 is the entry's position.y; a wall-mounted entry's back face is z = −d/2 on the wall), +z the
// front, dims.w along x, dims.d along z. Signature: build<Type>(F, b, k)
//   F  BatchFrame (world/buildKit.js) in that frame – static parts are batched per room;
//   b  the layout.house.builtIns entry (dims, params, colors …; position etc. are world space);
//   k  the kit from builtins.js: { low, floorY (local y of the room floor), ceilingY (local y of the ceiling over the
//      footprint), toLocal(x, z) → Vector3, dirToLocal(x, z) → Vector3, wall(id), wallMaterial(wallId, hex),
//      surface(geometry, material, { wallId, follow }) (an own mesh that follows a wall's paint), mesh(mesh) (an own
//      mesh in the local frame), light(entry) (local position / direction), collider(Box3 local) }.
// A builder that pushes no collider gets one box of its dims when the entry collides (builtins.js).
//
// Materials: mat() (cached, shared shader programs), surfaces.js finishes and – for the LED ring of the mirror – an
// own emissive material per mirror (the LightManager dims it). Nothing here compiles a new shader program: every
// material carries the same map set as the textured kinds (§4.16).
import * as THREE from 'three';
import { mat, emissive } from './materials.js';
import { place, applyBoxUV } from '../world/buildKit.js';
import { tube, smoothNormals } from '../models/kit.js';
import { makeTap, FRONT_T, GAP } from './fittings.js';
import { surfaceFinish, cloudContrast } from '../world/surfaces.js';

const PI = Math.PI;
/** The one near-black of slots, gaps and drains (shared with laundry.js: one material, one draw call). */
export const DARK = '#0b0b0c';
const V2 = (x, y) => new THREE.Vector2(x, y);

// ---------------------------------------------------------------------------------------------------------------
// Geometry helpers

/**
 * Rounded rectangle outline in (x, z): x ∈ [−w/2, w/2], z ∈ [z0, z0 + d], back corners (z0) radius rB, front corners
 * radius rF. Counter-clockwise in (x, z).
 */
export function roundedRectXZ(w, d, rB, rF, seg = 6, z0 = 0) {
  const pts = [];
  const arc = (cx, cz, r, a0, a1) => {
    if (r < 1e-4) {
      pts.push(V2(cx, cz));
      return;
    }
    for (let i = 0; i <= seg; i++) {
      const a = a0 + ((a1 - a0) * i) / seg;
      pts.push(V2(cx + Math.cos(a) * r, cz + Math.sin(a) * r));
    }
  };
  arc(w / 2 - rB, z0 + rB, rB, -PI / 2, 0);
  arc(w / 2 - rF, z0 + d - rF, rF, 0, PI / 2);
  arc(-w / 2 + rF, z0 + d - rF, rF, PI / 2, PI);
  arc(-w / 2 + rB, z0 + rB, rB, PI, 1.5 * PI);
  return pts;
}

const _ta = new THREE.Vector3(), _tb = new THREE.Vector3(), _tc = new THREE.Vector3();
/** three.js face normal of triangle (a, b, c): (c − b) × (a − b). */
function faceNormal(a, b, c, out) {
  _tb.subVectors(c, b);
  _tc.subVectors(a, b);
  return out.crossVectors(_tb, _tc);
}

/**
 * Loft: a closed outline (Vector2 in (x, z)) swept through sections { y, sx = 1, sz = 1, ox = 0, oz = 0 } (bottom → top;
 * x·sx + ox, z·sz + oz). Smooth sides (crease 50°), flat caps. inward = every face turned inward (a basin seen from
 * above). UVs in metres (u along the outline, v up).
 * @returns {THREE.BufferGeometry} non-indexed
 */
export function loft(outline, sections, { capBottom = true, capTop = true, inward = false, crease = 50 } = {}) {
  let area = 0;
  for (let i = 0; i < outline.length; i++) {
    const p = outline[i], q = outline[(i + 1) % outline.length];
    area += p.x * q.y - q.x * p.y;
  }
  const pts = area < 0 ? outline.slice().reverse() : outline;
  const n = pts.length;
  const along = [0];
  for (let i = 1; i <= n; i++) along.push(along[i - 1] + pts[i % n].distanceTo(pts[i - 1]));
  const rings = sections.map((s) => pts.map((p) => new THREE.Vector3(p.x * (s.sx ?? 1) + (s.ox ?? 0), s.y, p.y * (s.sz ?? 1) + (s.oz ?? 0))));
  const pos = [];
  const uvs = [];
  const nrm = new THREE.Vector3();
  const push = (a, b, c, ua, ub, uc) => {
    pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    uvs.push(ua[0], ua[1], ub[0], ub[1], uc[0], uc[1]);
  };
  // which winding faces outward: test the first quad against the direction away from the ring's centre
  let flipSide = false;
  if (rings.length > 1) {
    const r0 = rings[0], r1 = rings[1];
    const cx = r0.reduce((s, p) => s + p.x, 0) / n, cz = r0.reduce((s, p) => s + p.z, 0) / n;
    faceNormal(r0[0], r1[0], r0[1], nrm);
    const mx = (r0[0].x + r0[1].x) / 2 - cx, mz = (r0[0].z + r0[1].z) / 2 - cz;
    flipSide = nrm.x * mx + nrm.z * mz < 0;
  }
  if (inward) flipSide = !flipSide;
  for (let j = 0; j < rings.length - 1; j++) {
    const ra = rings[j], rb = rings[j + 1];
    const va = sections[j].y, vb = sections[j + 1].y;
    for (let i = 0; i < n; i++) {
      const i2 = (i + 1) % n;
      const a = ra[i], b = rb[i], a2 = ra[i2], b2 = rb[i2];
      const u0 = along[i], u1 = along[i + 1];
      if (flipSide) {
        push(a, a2, b, [u0, va], [u1, va], [u0, vb]);
        push(a2, b2, b, [u1, va], [u1, vb], [u0, vb]);
      } else {
        push(a, b, a2, [u0, va], [u0, vb], [u1, va]);
        push(a2, b, b2, [u1, va], [u0, vb], [u1, vb]);
      }
    }
  }
  const faces = THREE.ShapeUtils.triangulateShape(pts, []);
  const cap = (ring, up) => {
    for (const [i, j, l] of faces) {
      let a = ring[i], b = ring[j], c = ring[l];
      faceNormal(a, b, c, nrm);
      if ((nrm.y > 0) !== up) [b, c] = [c, b];
      push(a, b, c, [a.x, a.z], [b.x, b.z], [c.x, c.z]);
    }
  };
  if (capBottom) cap(rings[0], inward);
  if (capTop) cap(rings[rings.length - 1], !inward);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  smoothNormals(g, 1e4, crease);
  return g;
}

/** Flat plate geometry from a Shape in (x, −z), extruded upward from y0 by t (like fittings.makeWorktop). */
function plate(shape, y0, t, curveSegments = 8) {
  const g = new THREE.ExtrudeGeometry(shape, { depth: t, bevelEnabled: false, curveSegments });
  g.rotateX(-PI / 2);
  g.translate(0, y0, 0);
  return g;
}

/** Shape (x, −z) from an (x, z) outline. */
const shapeXZ = (pts) => new THREE.Shape(pts.map((p) => V2(p.x, -p.y)));
const pathXZ = (pts) => new THREE.Path(pts.slice().reverse().map((p) => V2(p.x, -p.y)));

const hexOr = (v, fb) => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v : fb);

/** Common materials of the wet rooms (cached mat()s). */
export function wetMaterials(b = {}) {
  const P = b.params || {};
  return {
    porcelain: mat('ceramic', hexOr(b.colors?.bowl ?? b.colors?.basin, '#f2f2f0'), { roughness: 0.14 }),
    black: mat('black-metal', hexOr(P.profile, '#1a1a1a'), { roughness: 0.55 }),
    glass: mat('glass-clear', '#e4ecea', { opacity: 0.14 }),
    steel: mat('steel', '#b0b3b6'),
    alu: mat('painted', hexOr(P.shelfEdge, '#a7a9a8'), { roughness: 0.35, metalness: 0.55 }),
    dark: mat('plastic', DARK, { roughness: 0.9, flat: true }),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// WC: cistern box (clad like the wall, or the given colour) with a light aluminium shelf edge, black flush plate, and a
// wall-hung rimless bowl with the lid closed

/** @param {object} F @param {object} b @param {object} k */
export function buildWC(F, b, k) {
  const { w, d, h } = b.dims;
  const P = b.params || {};
  const M = wetMaterials(b);
  const bowl = { w: 0.36, d: 0.54, rimH: 0.42, ...(P.bowl || {}) };
  const yF = k.floorY ?? 0; // local y of the floor
  // cistern box: own mesh in the wall's finish (a repaint of the wall repaints it) – or tiled like the wall in a tiled
  // room (b.tileFinish, builtinplan.js: UVs in metres, it does not follow the paint)
  const tiled = b.tileFinish && k.tileMaterial;
  const boxMat = tiled ? k.tileMaterial(b.tileFinish) : k.wallMaterial(b.wallId, b.colors?.box);
  const follow = !tiled && (!b.colors?.box || b.colors.box === k.wall(b.wallId)?.paintHex);
  // tiles want UVs in metres (applyBoxUV works on unindexed triangles)
  const metres = (g) => {
    if (!tiled) return g;
    const n = g.toNonIndexed();
    g.dispose();
    return applyBoxUV(n), n;
  };
  const box = new THREE.BoxGeometry(w, h - 0.012, d);
  box.translate(0, (h - 0.012) / 2, 0);
  k.surface(metres(box), boxMat, { wallId: b.wallId, follow });
  // top shelf (same finish) + aluminium edge profiles: along the top front and both top sides, down both front edges
  const shelf = new THREE.BoxGeometry(w + 0.004, 0.012, d + 0.004);
  shelf.translate(0, h - 0.006, 0.002);
  k.surface(metres(shelf), boxMat, { wallId: b.wallId, follow });
  const e = 0.012;
  F.box(w + 0.006, e, e, 0, h - e / 2 + 0.001, d / 2 + 0.004 - e / 2 + 0.001, M.alu, { collide: false });
  for (const s of [-1, 1]) {
    F.box(e, e, d + 0.004, s * (w / 2 + 0.003 - e / 2), h - e / 2 + 0.001, 0.002, M.alu, { collide: false });
    F.box(e, h - 0.012, e, s * (w / 2 + 0.003 - e / 2), (h - 0.012) / 2, d / 2 + 0.003 - e / 2, M.alu, { collide: false, castShadow: false });
  }
  // flush plate (two buttons)
  const fp = typeof P.flushPlate === 'object' && P.flushPlate ? P.flushPlate : { color: hexOr(P.flushPlate, '#1d1e21') };
  const fw = fp.w ?? 0.25, fh = fp.h ?? 0.16, fy = (fp.centerH ?? 0.95) + yF;
  const plateMat = mat('black-metal', hexOr(fp.color, '#1d1e21'), { roughness: 0.35 });
  F.box(fw, fh, 0.008, 0, fy, d / 2 + 0.004, plateMat, { collide: false });
  F.box(0.003, fh - 0.03, 0.002, 0.03, fy, d / 2 + 0.0085, M.dark, { collide: false, castShadow: false });
  F.box(fw - 0.03, 0.003, 0.002, 0, fy - fh / 2 + 0.015, d / 2 + 0.0085, M.dark, { collide: false, castShadow: false });
  // bowl: rimless, rounded front, tapering down to a rounded bottom; the back sits on the box
  const z0 = d / 2;
  const seg = k.low ? 4 : 7;
  const out = roundedRectXZ(bowl.w, bowl.d, 0.03, Math.min(bowl.w / 2 - 0.01, 0.15), seg, 0);
  const rim = bowl.rimH + yF;
  const bowlH = Math.min(0.34, rim - yF - 0.06);
  const S = [
    { y: rim - bowlH, sx: 0.6, sz: 0.62 },
    { y: rim - bowlH + 0.03, sx: 0.74, sz: 0.74 },
    { y: rim - bowlH * 0.55, sx: 0.9, sz: 0.88 },
    { y: rim - 0.06, sx: 0.985, sz: 0.98 },
    { y: rim - 0.01, sx: 1, sz: 1 },
    { y: rim, sx: 0.99, sz: 0.992 },
  ].map((s) => ({ ...s, oz: z0 }));
  const bg = loft(out, S, { capTop: true, capBottom: true });
  F.add(bg, M.porcelain, { collide: false });
  bg.dispose();
  // closed lid: a slightly smaller rounded slab with a soft top edge
  const lid = loft(out, [
    { y: rim + 0.004, sx: 0.985, sz: 0.985, oz: z0 + 0.004 },
    { y: rim + 0.026, sx: 0.985, sz: 0.985, oz: z0 + 0.004 },
    { y: rim + 0.036, sx: 0.955, sz: 0.955, oz: z0 + 0.012 },
  ]);
  F.add(lid, M.porcelain, { collide: false });
  lid.dispose();
  // a thin dark seam between bowl and lid (the seat ring's shadow line)
  const seam = loft(out, [{ y: rim, sx: 0.975, sz: 0.975, oz: z0 + 0.006 }, { y: rim + 0.004, sx: 0.975, sz: 0.975, oz: z0 + 0.006 }], { capTop: false, capBottom: false });
  F.add(seam, M.dark, { collide: false, castShadow: false });
  seam.dispose();
  // hinge bar at the back of the lid
  F.box(0.16, 0.012, 0.02, 0, rim + 0.012, z0 + 0.03, M.steel, { collide: false, castShadow: false });
  // colliders: the box and the bowl (to the rim)
  k.collider(new THREE.Box3(new THREE.Vector3(-w / 2, 0, -d / 2), new THREE.Vector3(w / 2, h, d / 2)));
  k.collider(new THREE.Box3(new THREE.Vector3(-bowl.w / 2, rim - bowlH, d / 2), new THREE.Vector3(bowl.w / 2, rim + 0.04, d / 2 + bowl.d)));
}

// ---------------------------------------------------------------------------------------------------------------
// Vanity: wall-hung cabinet with drawers and an integrated white basin top with a black (or chrome) basin mixer

/** @param {object} F @param {object} b @param {object} k */
export function buildVanity(F, b, k) {
  const { w, d, h } = b.dims;
  const P = b.params || {};
  const C = b.colors || {};
  const M = wetMaterials(b);
  const cab = mat('painted', hexOr(C.cabinet, '#1f1f22'), { roughness: 0.62 });
  const cabDark = mat('painted', '#0e0e10', { roughness: 0.9, flat: true });
  const basinMat = mat('ceramic', hexOr(C.basin, '#f2f2f0'), { roughness: 0.12 });
  const topT = P.topThickness ?? 0.045;
  const yTop = h; // basin rim (overkant)
  const bodyH = h - topT;
  const zf = d / 2 - 0.006; // drawer fronts' face, just behind the top's front edge
  // carcass: the body stops under the basin's bowl (which hangs into the top drawer), closed by sides and a back up
  // to the top slab; dark behind the fronts' gaps
  const depthB = Math.min(0.13, topT + 0.09);
  const cdp = d - 0.03 - FRONT_T;
  const bodyTop = Math.min(bodyH, yTop - depthB - 0.006);
  F.box(w - 0.036, bodyTop, cdp, 0, bodyTop / 2, -d / 2 + cdp / 2, cab);
  for (const sx of [-1, 1]) F.box(0.016, bodyH, cdp, sx * (w / 2 - 0.01), bodyH / 2, -d / 2 + cdp / 2, cab);
  F.box(w - 0.036, bodyH - bodyTop, 0.016, 0, (bodyH + bodyTop) / 2, -d / 2 + 0.008, cab);
  F.box(w - 0.01, bodyH - 0.01, 0.01, 0, bodyH / 2, zf - FRONT_T - 0.005, cabDark, { collide: false, castShadow: false });
  const n = Math.max(1, P.drawers ?? 2);
  const fh = (bodyH - GAP * (n + 1)) / n;
  for (let i = 0; i < n; i++) {
    const y0 = GAP + i * (fh + GAP);
    F.box(w - 2 * GAP, fh, FRONT_T, 0, y0 + fh / 2, zf - FRONT_T / 2, cab);
    // handle-less: a shallow grip groove along the top edge of each drawer
    F.box(w - 0.08, 0.012, 0.004, 0, y0 + fh - 0.012, zf + 0.0005, cabDark, { collide: false, castShadow: false });
  }
  // integrated top + basin: a slab with the basin opening, and the bowl lofted down inside it
  const seg = k.low ? 4 : 8;
  const topOut = roundedRectXZ(w, d, 0.002, 0.018, seg, -d / 2);
  const bw = Math.min(w - 0.2, P.basin?.w ?? w * 0.68), bd = Math.min(d - 0.12, P.basin?.d ?? 0.3);
  const bz = P.basin?.dz ?? 0.02;
  const hole = roundedRectXZ(bw, bd, 0.05, 0.07, seg, -bd / 2); // centred on z = 0, moved by bz below
  const shape = shapeXZ(topOut);
  shape.holes.push(pathXZ(hole.map((q) => V2(q.x, q.y + bz))));
  const slab = plate(shape, yTop - topT, topT, seg);
  F.add(slab, basinMat, { collide: false });
  slab.dispose();
  const depth = depthB;
  const bowl = loft(hole, [
    { y: yTop - depth, sx: 0.7, sz: 0.55, oz: bz },
    { y: yTop - depth + 0.03, sx: 0.82, sz: 0.72, oz: bz },
    { y: yTop - 0.04, sx: 0.95, sz: 0.93, oz: bz },
    { y: yTop - 0.001, sx: 1, sz: 1, oz: bz },
  ], { inward: true, capTop: false, capBottom: true });
  F.add(bowl, basinMat, { collide: false });
  bowl.dispose();
  // drain (black) in the bottom of the bowl
  const tapMat = mat('black-metal', P.tap === 'chrome' ? '#d8dadc' : '#151515', { roughness: 0.3 });
  F.cylinder(0.022, 0.022, 0.004, 0, yTop - depth + 0.002, bz + 0.02, tapMat, { segments: 16, collide: false, castShadow: false });
  // tap: basin mixer at the back edge of the basin
  makeTap(F, { x: 0, z: bz - bd / 2 - 0.04, topY: yTop, h: 0.15, style: 'basin' }, tapMat, { low: k.low });
}

// ---------------------------------------------------------------------------------------------------------------
// Shower

/**
 * Glass outline of a shower in WORLD plan coordinates [[x, z], …]: params.points, else from the footprint and
 * `corner` ('NE' | 'NW' | 'SE' | 'SW' – the corner against the walls) with the returns (pentagon) or the full sides
 * (rect).
 * @returns {{ points: number[][], footprint: { minX, maxX, minZ, maxZ }, corner: number[] }}  corner = the walls' corner [x, z]
 */
export function showerOutline(b) {
  const P = b.params || {};
  const yaw = ((b.rotationDeg ?? 0) * PI) / 180;
  const { w, d } = b.dims;
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const pos = b.position?.isVector3 ? [b.position.x, b.position.z] : [b.position[0], b.position[2]];
  // footprint centre (floor mount: position; wall mount: position + front · d/2)
  const fx = b.mount === 'wall' ? pos[0] + s * (d / 2) : pos[0];
  const fz = b.mount === 'wall' ? pos[1] + c * (d / 2) : pos[1];
  const corners = [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]].map(([x, z]) => [fx + x * c + z * s, fz - x * s + z * c]);
  const fp = {
    minX: Math.min(...corners.map((p) => p[0])), maxX: Math.max(...corners.map((p) => p[0])),
    minZ: Math.min(...corners.map((p) => p[1])), maxZ: Math.max(...corners.map((p) => p[1])),
  };
  const corner = String(P.corner || 'NE').toUpperCase();
  const sx = corner.includes('N') ? 1 : -1, sz = corner.includes('E') ? 1 : -1;
  const C = [sx > 0 ? fp.minX : fp.maxX, sz > 0 ? fp.minZ : fp.maxZ];
  if (Array.isArray(P.points) && P.points.length >= 2) return { points: P.points.map((p) => [p[0], p[1]]), footprint: fp, corner: C };
  const X = fp.maxX - fp.minX, Z = fp.maxZ - fp.minZ;
  if (P.shape === 'pentagon') {
    const r = P.returns ?? 0.37;
    return { points: [[C[0], C[1] + sz * Z], [C[0] + sx * r, C[1] + sz * Z], [C[0] + sx * X, C[1] + sz * r], [C[0] + sx * X, C[1]]], footprint: fp, corner: C };
  }
  return { points: [[C[0], C[1] + sz * Z], [C[0] + sx * X, C[1] + sz * Z], [C[0] + sx * X, C[1]]], footprint: fp, corner: C };
}

/** @param {object} F @param {object} b @param {object} k */
export function buildShower(F, b, k) {
  const P = b.params || {};
  const M = wetMaterials(b);
  const H = P.glassHeight ?? Math.min(b.dims.h ?? 2.0, 2.0);
  const prof = mat('black-metal', hexOr(P.profile, '#151515'), { roughness: 0.58 });
  const handleMat = prof;
  const glassT = 0.008;
  const pw = 0.015; // profile width
  const yF = k.floorY ?? 0;
  const { points: worldPts, footprint, corner: wallCornerW } = showerOutline(b);
  const pts = worldPts.map((p) => k.toLocal(p[0], p[1]));
  const centre = k.toLocal((footprint.minX + footprint.maxX) / 2, (footprint.minZ + footprint.maxZ) / 2);
  const pentagon = P.shape === 'pentagon';
  // glass runs: data (rect, world lines with panels) or the outline's segments
  let runs = [];
  if (!pentagon && Array.isArray(P.glass) && P.glass.length) {
    runs = P.glass.map((g) => ({ a: k.toLocal(g.line[0][0], g.line[0][1]), b: k.toLocal(g.line[1][0], g.line[1][1]), panels: g.panels?.length ? g.panels : [{ kind: 'fixed' }] }));
  } else if (pentagon) {
    runs = [
      { a: pts[0], b: pts[1], panels: [{ kind: 'fixed' }] },
      { a: pts[1], b: pts[2], panels: [{ kind: 'swing', hinge: 'a', handle: 'bar' }, { kind: 'swing', hinge: 'b', handle: 'd' }] },
      { a: pts[2], b: pts[3], panels: [{ kind: 'fixed' }] },
    ];
  } else {
    runs = [{ a: pts[0], b: pts[1], panels: [{ kind: 'fixed' }] }, { a: pts[1], b: pts[2], panels: [{ kind: 'fixed' }, { kind: 'sliding', handle: 'bar' }] }];
  }
  // a shower without walls (enclosure 'none', builtinplan.js): no glass, nothing to bump into – only the set
  const open = P.enclosure === 'none';
  if (open) runs = [];
  const y0 = yF + 0.012; // glass bottom
  const ym = y0 + H / 2;
  const up = new THREE.Vector3(0, 1, 0);
  const frameAt = (a, dir, inward) => {
    // run frame: x along the run, z toward the inside of the shower
    const z = inward.clone();
    const x = dir.clone();
    return new THREE.Matrix4().makeBasis(x, up, z).setPosition(a.x, 0, a.z);
  };
  for (const run0 of runs) {
    // the run frame must stay right-handed (x along, y up, z = x × y toward the inside): a run whose inside is on its
    // other side is walked backwards (panels reversed, hinges swapped) – a mirrored frame would turn the merged
    // faces inside out
    let run = run0;
    {
      const d0 = run0.b.clone().sub(run0.a);
      const mid0 = run0.a.clone().add(run0.b).multiplyScalar(0.5);
      if (new THREE.Vector3(-d0.z, 0, d0.x).dot(centre.clone().sub(mid0)) < 0) {
        run = { a: run0.b, b: run0.a, panels: run0.panels.slice().reverse().map((p) => (p.hinge ? { ...p, hinge: p.hinge === 'a' ? 'b' : 'a' } : p)) };
      }
    }
    const dir = run.b.clone().sub(run.a);
    const len = dir.length();
    if (len < 0.05) continue;
    dir.normalize();
    const nrm = new THREE.Vector3(-dir.z, 0, dir.x); // inward (the side of the centre)
    const R = frameAt(run.a, dir, nrm);
    const G = F.frame(R);
    const nP = run.panels.length;
    const sliding = run.panels.some((p) => p.kind === 'sliding');
    const overlap = sliding ? 0.05 : 0;
    const pl = (len + overlap * (nP - 1)) / nP;
    for (let i = 0; i < nP; i++) {
      const p = run.panels[i];
      const xa = i * (pl - overlap), xb = xa + pl;
      const zo = p.kind === 'sliding' ? 0.028 : 0; // the sliding leaf runs on the inner track
      const gl = xb - xa - (p.kind === 'swing' ? 0.008 : 0.004);
      const cx = (xa + xb) / 2;
      G.box(gl, H - 0.004, glassT, cx, ym, zo, M.glass, { collide: false, castShadow: false, receiveShadow: false });
      // vertical profiles at both edges of the pane (the photos: black edge profiles, no frame round the glass)
      for (const ex of [xa + pw / 2, xb - pw / 2]) G.box(pw, H, glassT + 0.005, ex, ym, zo, prof, { collide: false });
      if (p.kind === 'swing' || p.kind === 'sliding') {
        // handle at the free edge, on the outside (−z of the run frame), and a matching knob inside
        const free = p.kind === 'sliding' ? (i === 0 ? xb - 0.09 : xa + 0.09) : (p.hinge === 'a' ? xb - 0.06 : xa + 0.06);
        const hy = yF + 1.05;
        if (p.handle === 'd' || p.kind === 'sliding') {
          const bar = 0.26;
          G.box(0.016, bar, 0.016, free, hy, zo - 0.045, handleMat, { collide: false });
          for (const sy of [-1, 1]) G.box(0.012, 0.012, 0.04, free, hy + sy * (bar / 2 - 0.01), zo - 0.025, handleMat, { collide: false });
        } else {
          G.box(0.014, 0.3, 0.014, free, hy, zo - 0.03, handleMat, { collide: false });
          for (const sy of [-1, 1]) G.box(0.01, 0.01, 0.026, free, hy + sy * 0.12, zo - 0.017, handleMat, { collide: false });
        }
        G.box(0.012, 0.2, 0.012, free, hy, zo + 0.022, handleMat, { collide: false });
      }
    }
    if (sliding || P.topRail === true) {
      // rails over the top and along the floor (the rectangular shower of the laundry, 225450)
      G.box(len, 0.035, 0.05, len / 2, y0 + H + 0.0175, 0.014, prof, { collide: false });
      G.box(len, 0.014, 0.045, len / 2, yF + 0.007, 0.014, prof, { collide: false, castShadow: false });
    }
  }
  // U-profiles on the walls at the two outer ends of the glass
  const first = runs[0], last = runs[runs.length - 1];
  for (const [p, q] of runs.length ? [[first.a, first.b], [last.b, last.a]] : []) {
    const dir = q.clone().sub(p).normalize();
    const at = p.clone().addScaledVector(dir, 0.015); // the profile's back on the wall face
    F.box(0.03, H + 0.004, 0.022, 0, 0, 0, prof, { matrix: new THREE.Matrix4().makeBasis(dir, up, new THREE.Vector3(-dir.z, 0, dir.x)).setPosition(at.x, ym, at.z), collide: false });
  }
  // the shower set on its wall
  buildShowerSet(F, b, k, footprint);
  // dark wall panels inside the shower (the laundry: #5a5657 to the ceiling on the north and east walls)
  const wp = P.wallPanels;
  if (wp?.walls?.length) {
    const hex = hexOr(wp.color, '#5a5657');
    const panelMat = surfaceFinish('dark-panel', hex, { clouds: Math.min(4.5, cloudContrast(hex, wp.clouds, 'stone') ?? 3.5) });
    for (const id of wp.walls) {
      const wall = k.wall(id);
      if (!wall) continue;
      const alongX = Math.abs(wall.dir.x) > 0.5;
      const lo = alongX ? footprint.minX : footprint.minZ, hi = alongX ? footprint.maxX : footprint.maxZ;
      const top = wp.toCeiling ? k.ceilingY - 0.002 : y0 + H;
      const t = 0.008;
      const off = 0.002 + t / 2;
      // world centre of the panel, in front of the wall face
      const wx = alongX ? (lo + hi) / 2 : wall.start.x + wall.normal.x * off;
      const wz = alongX ? wall.start.y + wall.normal.y * off : (lo + hi) / 2;
      const c = k.toLocal(wx, wz);
      const dl = k.dirToLocal(wall.dir.x, wall.dir.y);
      const nl = k.dirToLocal(wall.normal.x, wall.normal.y);
      const m = new THREE.Matrix4().makeBasis(dl, up, nl).setPosition(c.x, (yF + top) / 2, c.z);
      F.box(hi - lo, top - yF, t, 0, 0, 0, panelMat, { matrix: m, collide: false });
    }
  }
  // colliders: rect → the footprint; pentagon → the two return strips and steps along the diagonal
  const yTop = y0 + H;
  if (open) {
    // walk in: no collider
  } else if (pentagon && pts.length === 4) {
    // boxes from the walls' corner to points along the diagonal: a staircase under the glass (≤ half a step past it)
    const C = k.toLocal(wallCornerW[0], wallCornerW[1]);
    const box = (q) => k.collider(new THREE.Box3(new THREE.Vector3(Math.min(C.x, q.x), yF, Math.min(C.z, q.z)), new THREE.Vector3(Math.max(C.x, q.x), yTop, Math.max(C.z, q.z))));
    const steps = 4;
    box(pts[1]);
    box(pts[2]);
    for (let i = 0; i < steps; i++) box(pts[1].clone().lerp(pts[2], (i + 0.5) / steps));
  } else {
    const loc = [k.toLocal(footprint.minX, footprint.minZ), k.toLocal(footprint.maxX, footprint.maxZ)];
    k.collider(new THREE.Box3(new THREE.Vector3(Math.min(loc[0].x, loc[1].x), yF, Math.min(loc[0].z, loc[1].z)), new THREE.Vector3(Math.max(loc[0].x, loc[1].x), yTop, Math.max(loc[0].z, loc[1].z))));
  }
}

/**
 * Thermostatic shower set in matt black on a wall: bar mixer with a small shelf, riser rail, square overhead shower
 * on an arm, hand shower in a slider with its hose. params.set { wall, z | x | at: [x, z] (world), thermostatH,
 * head: { shape, size, h }, handShower, shelf }; a string or nothing: on the wall behind the footprint's middle.
 */
function buildShowerSet(F, b, k, footprint) {
  const P = b.params || {};
  const s = typeof P.set === 'object' && P.set ? P.set : {};
  const black = mat('black-metal', hexOr(P.profile, '#151515'), { roughness: 0.58 });
  const yF = k.floorY ?? 0;
  const up = new THREE.Vector3(0, 1, 0);
  let origin, along, out;
  const wall = s.wall ? k.wall(s.wall) : null;
  if (wall) {
    const alongX = Math.abs(wall.dir.x) > 0.5;
    const ax = Array.isArray(s.at) ? s.at[0] : s.x ?? (footprint.minX + footprint.maxX) / 2;
    const az = Array.isArray(s.at) ? s.at[1] : s.z ?? (footprint.minZ + footprint.maxZ) / 2;
    origin = k.toLocal(alongX ? ax : wall.start.x, alongX ? wall.start.y : az);
    along = k.dirToLocal(wall.dir.x, wall.dir.y);
    out = k.dirToLocal(wall.normal.x, wall.normal.y);
  } else {
    origin = new THREE.Vector3(0, 0, -b.dims.d / 2);
    along = new THREE.Vector3(1, 0, 0);
    out = new THREE.Vector3(0, 0, 1);
  }
  // on a tiled wall the set stands on the tiles (s.standoff, builtinplan.js TILE_T)
  if (s.standoff) origin.addScaledVector(out, s.standoff);
  const W = F.frame(new THREE.Matrix4().makeBasis(along, up, out).setPosition(origin.x, yF, origin.z));
  const seg = k.low ? 10 : 16;
  const th = s.thermostatH ?? 1.0;
  const zo = 0.065;
  // bar mixer with end knobs and two wall connections
  W.cylinder(0.026, 0.026, 0.3, 0, th, zo, black, { rot: [0, 0, PI / 2], segments: seg, collide: false });
  for (const sx of [-1, 1]) W.cylinder(0.031, 0.031, 0.04, sx * 0.165, th, zo, black, { rot: [0, 0, PI / 2], segments: seg, collide: false });
  for (const sx of [-1, 1]) {
    W.cylinder(0.011, 0.011, zo, sx * 0.075, th, zo / 2, black, { rot: [PI / 2, 0, 0], segments: 10, collide: false });
    W.cylinder(0.026, 0.026, 0.006, sx * 0.075, th, 0.003, black, { rot: [PI / 2, 0, 0], segments: seg, collide: false });
  }
  if (s.shelf !== false) W.box(0.3, 0.01, 0.11, 0, th + 0.04, zo + 0.005, black, { collide: false });
  // riser rail up to the arm, arm out to the overhead shower
  const head = { shape: 'square', size: 0.25, h: 2.2, ...(s.head || {}) };
  const headY = Math.min(head.h, (k.ceilingY ?? 2.4) - 0.04);
  const armY = headY + 0.06;
  const reach = 0.32;
  const rail = tube([[0, th + 0.03, zo], [0, armY - 0.04, zo], [0, armY, zo + 0.04], [0, armY, zo + reach - 0.02]], 0.011, { radial: k.low ? 6 : 10, curve: 'catmull', seg: k.low ? 12 : 24 });
  W.add(rail, black, { collide: false });
  rail.dispose();
  W.cylinder(0.012, 0.012, armY - headY, 0, (armY + headY) / 2, zo + reach, black, { segments: 10, collide: false });
  if (head.shape === 'round') W.cylinder(head.size / 2, head.size / 2, 0.01, 0, headY, zo + reach, black, { segments: seg * 2, collide: false });
  else W.box(head.size, 0.01, head.size, 0, headY, zo + reach, black, { collide: false });
  // hand shower in its slider, hose down from the mixer
  if (s.handShower !== false) {
    const hy = Math.min(armY - 0.5, th + 0.55);
    W.box(0.04, 0.05, 0.045, 0, hy, zo + 0.02, black, { collide: false });
    W.cylinder(0.014, 0.011, 0.18, 0, hy - 0.02, zo + 0.06, black, { rot: [0.2, 0, 0], segments: 10, collide: false });
    W.box(0.075, 0.012, 0.075, 0, hy + 0.08, zo + 0.085, black, { rot: [-1.15, 0, 0], collide: false });
    const hose = tube([[0, th - 0.025, zo], [0.02, th - 0.25, zo + 0.02], [0.06, Math.max(yF + 0.35, th - 0.55), zo + 0.03], [0.03, th - 0.35, zo + 0.05], [0, hy - 0.11, zo + 0.065]], 0.007, { radial: 6, seg: k.low ? 16 : 32 });
    W.add(hose, black, { collide: false, castShadow: false });
    hose.dispose();
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Round LED mirror: a mirror disc on a thin backing, a frosted LED band round the edge (emissive, dimmable) and a soft
// halo of the backlight on the wall

let _haloTex = null;
let _neutral = null;
/** Radial fall-off (white, alpha 1 at the inner edge → 0 at the outer) for the halo ring (its UVs are planar). */
function haloTexture() {
  if (_haloTex) return _haloTex;
  const N = 64;
  const data = new Uint8Array(N * N * 4);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const dx = (x + 0.5) / N - 0.5, dy = (y + 0.5) / N - 0.5;
      const r = Math.hypot(dx, dy) * 2; // 0 centre → 1 edge of the square
      // the ring spans r ∈ [inner, 1]: bright near the mirror's edge, gone at the ring's outer edge
      const t = Math.max(0, Math.min(1, (r - 0.72) / 0.28));
      const a = (1 - t) ** 2.2;
      const i = (y * N + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = 255;
      data[i + 3] = Math.round(a * 255);
    }
  }
  const t = new THREE.DataTexture(data, N, N, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  _haloTex = t;
  return t;
}
/** 1×1 flat normal / white roughness maps: the halo carries the same map set as every other material (no new program). */
function neutralMaps() {
  const one = (r, g, b) => {
    const t = new THREE.DataTexture(new Uint8Array([r, g, b, 255]), 1, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
    t.needsUpdate = true;
    return t;
  };
  _neutral ||= { normal: one(128, 128, 255), rough: one(255, 255, 255) };
  return _neutral;
}

/** Warm white of a colour temperature (rough black-body fit, 2000–6500 K). */
export function kelvinHex(K = 3000) {
  const t = Math.max(1000, Math.min(12000, K)) / 100;
  const r = t <= 66 ? 255 : 329.7 * (t - 60) ** -0.1332;
  const g = t <= 66 ? 99.47 * Math.log(t) - 161.12 : 288.12 * (t - 60) ** -0.0755;
  const bl = t >= 66 ? 255 : t <= 19 ? 0 : 138.52 * Math.log(t - 10) - 305.04;
  const c = (v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(bl)}`;
}

/** @param {object} F @param {object} b @param {object} k */
export function buildRoundLedMirror(F, b, k) {
  const { w, d } = b.dims;
  const r = w / 2;
  const cy = (b.dims.h ?? w) / 2;
  const seg = k.low ? 40 : 72;
  const zFront = d / 2;
  const backing = mat('painted', '#2a2a2b', { roughness: 0.8 });
  const mirror = mat('mirror', '#e9ebea', { roughness: 0.1 });
  // backing (set back from the edge, so the mirror seems to float) and the mirror disc
  F.cylinder(r - 0.03, r - 0.03, d - 0.008, 0, cy, -0.004, backing, { rot: [PI / 2, 0, 0], segments: seg, collide: false });
  F.cylinder(r, r, 0.005, 0, cy, zFront - 0.0025, mirror, { rot: [PI / 2, 0, 0], segments: seg, collide: false });
  // LED band (frosted, emissive) and the halo on the wall: own meshes with own materials (dimmed per lamp)
  const K = b.light?.lightColorK ?? 3000;
  // the LED band reads warm white in the photos (a pale core), the halo on the wall carries the colour
  const glow = kelvinHex(K);
  const band = new THREE.Color(glow).lerp(new THREE.Color('#ffffff'), 0.55);
  const ringMat = emissive(`#${band.getHexString()}`, 1.6, { color: '#f3efe8' });
  const bandMesh = new THREE.Mesh(new THREE.RingGeometry(r - 0.028, r - 0.006, seg, 1), ringMat);
  bandMesh.position.set(0, cy, zFront + 0.0006);
  bandMesh.name = `built-in:${b.id}:led`;
  bandMesh.castShadow = false;
  k.mesh(bandMesh);
  const n = neutralMaps();
  const haloMat = new THREE.MeshStandardMaterial({
    color: '#000000',
    map: haloTexture(),
    normalMap: n.normal,
    normalScale: new THREE.Vector2(0, 0),
    roughnessMap: n.rough,
    roughness: 1,
    metalness: 0,
    emissive: new THREE.Color(glow).lerp(new THREE.Color('#ffffff'), 0.25),
    emissiveIntensity: 0.7,
    transparent: true,
    depthWrite: false,
  });
  haloMat.name = `mirror-halo ${glow}`;
  haloMat.userData = { cached: false, kind: 'emissive', hex: glow, baseIntensity: 0.25 };
  const haloR = r / 0.74; // the texture's bright inner edge (r 0.72 of the square) sits at the mirror's edge
  const halo = new THREE.Mesh(new THREE.PlaneGeometry(haloR * 2, haloR * 2), haloMat);
  halo.position.set(0, cy, -d / 2 + 0.0015);
  halo.name = `built-in:${b.id}:halo`;
  halo.castShadow = false;
  halo.receiveShadow = false;
  halo.renderOrder = 1;
  k.mesh(halo);
  if (b.light) {
    k.light({
      id: b.id,
      group: b.light.group,
      type: 'mirror-ring',
      lightType: 'point',
      position: new THREE.Vector3(0, cy, zFront + 0.12),
      direction: new THREE.Vector3(0, 0, 1),
      colorK: K,
      lumens: b.light.lumens ?? 400,
      emissiveMeshes: [bandMesh, halo],
    });
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Towel radiator: one vertical tube with a wall bracket and a hook on top (V60, params.form 'single-tube'), or a
// ladder (two rails and bars)

/** @param {object} F @param {object} b @param {object} k */
export function buildTowelRadiator(F, b, k) {
  const { w, d, h } = b.dims;
  const P = b.params || {};
  const M = mat('black-metal', hexOr(b.colors?.tube, '#1a1a1a'), { roughness: 0.55 });
  const r = (P.tubeD ?? 0.03) / 2;
  const seg = k.low ? 8 : 14;
  const zt = -d / 2 + Math.max(0.035, r + 0.02); // tube axis, standing off the wall
  const yB = (P.mountH ?? 0.3) + (k.floorY ?? 0);
  const bracket = (x, y) => {
    F.cylinder(0.008, 0.008, zt + d / 2, x, y, (zt - d / 2) / 2, M, { rot: [PI / 2, 0, 0], segments: 8, collide: false });
    F.cylinder(0.022, 0.022, 0.006, x, y, -d / 2 + 0.003, M, { rot: [PI / 2, 0, 0], segments: seg, collide: false });
  };
  if ((P.form ?? 'single-tube') === 'single-tube') {
    F.cylinder(r, r, h, 0, h / 2, zt, M, { segments: seg, collide: false });
    F.cylinder(r * 0.9, r, 0.01, 0, 0.005, zt, M, { segments: seg, collide: false });
    bracket(0, Math.max(0.05, yB));
    bracket(0, h - 0.08);
    if (P.hookTop !== false) {
      const hook = tube([[0, h - 0.01, zt], [0, h + 0.03, zt + 0.01], [0, h + 0.035, zt + 0.045], [0, h + 0.01, zt + 0.06]], r * 0.5, { radial: 8, seg: 12 });
      F.add(hook, M, { collide: false });
      hook.dispose();
    }
    return;
  }
  // ladder: two rails, bars every ~0.12
  const rw = Math.max(0.3, w);
  for (const sx of [-1, 1]) {
    F.cylinder(r, r, h, (sx * rw) / 2, h / 2, zt, M, { segments: seg, collide: false });
    bracket((sx * rw) / 2, Math.max(0.05, yB));
    bracket((sx * rw) / 2, h - 0.08);
  }
  const n = Math.max(3, Math.round((h - 0.15) / 0.12));
  for (let i = 0; i < n; i++) F.cylinder(0.01, 0.01, rw, 0, 0.1 + (i * (h - 0.2)) / (n - 1), zt, M, { rot: [0, 0, PI / 2], segments: 8, collide: false });
}

// ---------------------------------------------------------------------------------------------------------------
// Floor drain: a round (or square) brushed steel / white grate flush with the floor

/** @param {object} F @param {object} b @param {object} k */
export function buildFloorDrain(F, b, k) {
  const P = b.params || {};
  const size = b.dims?.w ?? 0.15;
  const finish = P.finish === 'white' ? mat('plastic', '#e9e8e4', { roughness: 0.4 }) : wetMaterials(b).steel;
  const dark = wetMaterials(b).dark;
  const y = (k.floorY ?? 0) + 0.0012;
  const seg = k.low ? 24 : 40;
  if (P.shape === 'linear') {
    // a channel drain along local x: a steel strip with a long dark slot down the middle (dims.w long, dims.d wide)
    const len = b.dims?.w ?? 0.8, wd = b.dims?.d ?? 0.07;
    F.box(len, 0.0024, wd, 0, y, 0, finish, { collide: false, castShadow: false });
    F.box(len - 0.03, 0.0026, Math.min(0.014, wd * 0.25), 0, y + 0.0002, 0, dark, { collide: false, castShadow: false });
    return;
  }
  if (P.shape === 'square') {
    F.box(size, 0.0024, size, 0, y, 0, finish, { collide: false, castShadow: false });
    for (let i = 0; i < 5; i++) F.box(size * 0.7, 0.0026, 0.006, 0, y + 0.0002, -size * 0.3 + (i * size * 0.6) / 4, dark, { collide: false, castShadow: false });
    return;
  }
  F.cylinder(size / 2, size / 2, 0.0024, 0, y, 0, finish, { segments: seg, collide: false, castShadow: false });
  // slots: concentric dark rings and a centre
  for (const [ro, ri] of [[size * 0.42, size * 0.39], [size * 0.31, size * 0.28], [size * 0.2, size * 0.17]]) {
    const ring = new THREE.RingGeometry(ri, ro, seg, 1);
    ring.rotateX(-PI / 2);
    F.add(ring, dark, { matrix: place(0, y + 0.0013, 0), collide: false, castShadow: false });
    ring.dispose();
  }
  F.cylinder(size * 0.07, size * 0.07, 0.0026, 0, y + 0.0002, 0, dark, { segments: 16, collide: false, castShadow: false });
}

// ---------------------------------------------------------------------------------------------------------------
// Bathtub: built in (params.style 'built-in', default: a white apron to the rim, the back and ends on the walls) or
// freestanding (an oval shell on the floor); the basin lofted down inside the rim, a drain and a mixer on the rim at
// the end params.tapEnd ('left' | 'right', default the left end seen from the front) – a freestanding tub gets a
// floor-standing spout

/** @param {object} F @param {object} b @param {object} k */
export function buildBathtub(F, b, k) {
  const { w, d, h } = b.dims;
  const P = b.params || {};
  const free = P.style === 'freestanding';
  const yF = k.floorY ?? 0;
  const seg = k.low ? 5 : 9;
  const enamel = mat('ceramic', hexOr(b.colors?.tub, '#f4f4f2'), { roughness: 0.12 });
  // a built-in tub's apron in the room's tiles (b.tileFinish, builtinplan.js), else enamel
  const apron = !free && b.tileFinish && k.tileMaterial ? k.tileMaterial(b.tileFinish) : enamel;
  const tapMat = P.tap === 'chrome' ? mat('chrome', '#dfe1e3') : mat('black-metal', '#151515', { roughness: 0.3 });
  const rim = free ? 0.045 : 0.07;
  const rOut = free ? Math.min(d * 0.48, w * 0.3) : 0.02;
  const out = roundedRectXZ(w, d, rOut, rOut, seg, -d / 2);
  const iw = w - 2 * rim, id = d - 2 * rim;
  const rIn = free ? Math.max(0.05, rOut - rim) : 0.12;
  const hole = roundedRectXZ(iw, id, rIn, rIn, seg, -id / 2);
  const topT = 0.02;
  if (free) {
    // the shell: narrower at the foot, a thin top edge
    const shell = loft(out, [
      { y: yF, sx: 0.84, sz: 0.8 },
      { y: yF + 0.06, sx: 0.88, sz: 0.85 },
      { y: yF + (h - yF) * 0.55, sx: 0.97, sz: 0.96 },
      { y: h - topT, sx: 1, sz: 1 },
    ], { capBottom: true, capTop: false });
    F.add(shell, enamel, { collide: false });
    shell.dispose();
  } else {
    // the apron and the back / ends as panels (a solid box would close the basin under the rim)
    const ah = h - topT - yF, ay = yF + ah / 2, pt = 0.02;
    for (const sz of [-1, 1]) F.box(w, ah, pt, 0, ay, sz * (d / 2 - pt / 2), apron);
    for (const sx of [-1, 1]) F.box(pt, ah, d - 2 * pt, sx * (w / 2 - pt / 2), ay, 0, apron);
  }
  // the rim with the basin's opening, and the basin
  const shape = shapeXZ(out);
  shape.holes.push(pathXZ(hole));
  const slab = plate(shape, h - topT, topT, seg);
  F.add(slab, enamel, { collide: false });
  slab.dispose();
  const depth = Math.min(0.45, h - yF - 0.08);
  const basin = loft(hole, [
    { y: h - depth, sx: 0.86, sz: 0.78 },
    { y: h - depth + 0.04, sx: 0.93, sz: 0.88 },
    { y: h - 0.06, sx: 0.99, sz: 0.98 },
    { y: h - 0.001, sx: 1, sz: 1 },
  ], { inward: true, capTop: false, capBottom: true });
  F.add(basin, enamel, { collide: false });
  basin.dispose();
  const sx = P.tapEnd === 'right' ? 1 : -1;
  F.cylinder(0.025, 0.025, 0.004, sx * (iw / 2 - 0.12), h - depth + 0.002, 0, tapMat, { segments: 16, collide: false, castShadow: false });
  if (free) {
    // floor-standing spout at the tap end
    const x = sx * (w / 2 + 0.09);
    F.cylinder(0.018, 0.022, h + 0.18 - yF, x, yF + (h + 0.18 - yF) / 2, 0, tapMat, { segments: 14, collide: false });
    const spout = tube([[x, h + 0.17, 0], [x - sx * 0.06, h + 0.2, 0], [x - sx * 0.16, h + 0.14, 0]], 0.012, { radial: 10, seg: 12 });
    F.add(spout, tapMat, { collide: false });
    spout.dispose();
  } else {
    makeTap(F, { x: sx * (w / 2 - rim / 2), z: -d / 2 + rim / 2 + 0.01, topY: h, h: 0.16, style: 'basin' }, tapMat, { low: k.low });
  }
  k.collider(new THREE.Box3(new THREE.Vector3(-w / 2, yF, -d / 2), new THREE.Vector3(w / 2, h, d / 2)));
}

// ---------------------------------------------------------------------------------------------------------------
// Rectangular mirror (mount 'wall', position y = underside): a mirror pane on a dark backing set back from its edge

/** @param {object} F @param {object} b @param {object} k */
export function buildMirror(F, b) {
  const { w, d, h } = b.dims;
  const backing = mat('painted', '#2a2a2b', { roughness: 0.8 });
  const mirror = mat('mirror', '#e9ebea', { roughness: 0.1 });
  F.box(Math.max(0.05, w - 0.06), Math.max(0.05, h - 0.06), d - 0.006, 0, h / 2, -0.003, backing, { collide: false });
  F.box(w, h, 0.005, 0, h / 2, d / 2 - 0.0025, mirror, { collide: false });
}

/** Builders of this module by builtIns type (builtins.js dispatches on them). */
export const BATHROOM_BUILDERS = Object.freeze({
  wc: buildWC,
  vanity: buildVanity,
  shower: buildShower,
  'mirror-round': buildRoundLedMirror,
  'towel-radiator': buildTowelRadiator,
  'floor-drain': buildFloorDrain,
  bathtub: buildBathtub,
  mirror: buildMirror,
});
