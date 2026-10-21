// The outside (owned by SHELL): the photo backdrops (img/utsikt/backdrops.json – curved billboards at the distance
// of their main subject, the south view cross-fading to the blue-hour variant), the terrace with its dark deck,
// horizontal-slat railing, the stair down to the concrete landing, the annex that closes the terrace to the east,
// the white foundation, terrace furniture, and a strip of lawn below the deck that only exists for viewers outside.
//
// Hele huset (steg 25, C3): with layout.house.outsideHouse (research/house/35-ute.json) exteriorPlan() merges the
// entrance into the outside: forecourt, landing, path and walk at the entrance level (−2.87) with gravel, slate and
// concrete slabs, the terrace stair with 16 risers (walkable: an invisible wedge, §3.11), the deck out to x 10.35 over
// rom 3,70 and the niche, the niche soffit with its downlight fittings, the fill behind the door wall, the entrance
// pillar and a corner pier, the soffit under the overhangs, a plastered wall under the annex, ground colliders outside
// the basement, a ground patch west of the house and the walking bounds. The walls, the door element and the
// facades' cladding/plaster are rooms.js's (facadeSegments, C2).
//
// setDaylight(level 0..1, skyHex?, light?) dims/tints the backdrops and sets the sky colour (LightManager calls it);
// light = { sky, ground: THREE.Color (display radiance), envSize } lights the 3D exterior with its own
// sky environment instead of the room's (add-lighting).
//
// Loading: the photos are decoded off the main thread (ImageBitmapLoader) and uploaded as soon as they arrive (during
// the loading screen, not in the first frame). `ready` waits for the day photos at most READY_CAP_MS – on a slow line
// the room starts with the sky colour and the photos fade in when they arrive. The evening photo is only fetched when
// the daylight first drops toward the blue hour. «Lav» uses the small files for everything, «middels» for all but the
// main south view.
import * as THREE from 'three';
import { mat, assetUrl } from './materials.js';
import { MeshBatcher, place } from '../world/buildKit.js';
import { concrete, surfaceMaterial } from '../world/surfaces.js';
import { claddingMaterial } from './shell.js';

const UP = new THREE.Vector3(0, 1, 0);
const smooth = (a, b, x) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const lerp = (a, b, t) => a + (b - a) * t;
const READY_CAP_MS = 2500;
const FADE_S = 0.6;

/**
 * room-spec's terrace is a low-confidence sketch (outside.confidence 'low'). These values are measured in the photos
 * through the living-room windows: 082852 / 082850 with the solved camera of the south backdrop (backdrops.json, sor
 * cameraRotations) and 082841 with a camera solved from its window frame, points triangulated between them (see
 * notes/fix-shell.md). The terrace's west edge is at z ≈ 6.75 (not 7.4); the stair runs SOUTH along that edge, from
 * the facade under win-s1 down to a pale concrete landing at y ≈ −1.72 (not west along x = 9.3 down to −2.7), with a
 * concrete path along its outer side; the lawn next to it is at about the landing's level. Applied only while
 * room-spec still holds the old sketch (stair.from = [9.3, 7.4]); once these numbers are moved into room-spec
 * (research/room-spec.json + src/data/room-spec.json) this is a no-op.
 */
const TERRACE_FIT = {
  oldStairFrom: [9.3, 7.4],
  oldWestZ: 7.4,
  westZ: 6.75,
  railingLines: [
    [[9.8, 0], [9.8, 6.75]],
    [[7.65, 6.75], [9.8, 6.75]],
  ],
  stair: {
    // a level top step from the facade to x 7.62 (the guard runs level there: the long diagonal rail seen steeply
    // from above in 082841), then 9 risers down to the landing; 0.75 m wide between the terrace's west face and the guard
    from: [7.62, 7.125],
    to: [9.55, 7.125],
    width: 0.75,
    topY: -0.03,
    bottomY: -1.72,
    guards: 'outer',
    guardHeight: 0.85,
    landing: { polygon: [[9.55, 6.75], [10.5, 6.75], [10.5, 8.1], [9.55, 8.1]], y: -1.72 },
    path: { polygon: [[7.22, 7.5], [9.55, 7.5], [9.55, 8.1], [7.22, 8.1]], y: -1.72 },
    // …and on along the foundation under the living-room windows (pale concrete below win-s2 in 082829 / 082852)
    walk: { polygon: [[7.22, 8.1], [8.0, 8.1], [8.0, 11.6], [7.22, 11.6]], y: -1.72 },
  },
  nearGroundY: -1.75,
  nearGroundToX: 10.6,
};

/**
 * Hele huset (steg 25, C3; notes/hele-huset-design.md §2.9, avstemmingen V25–V36): what the house data
 * (research/house/35-ute.json → layout.house.outsideHouse, world y) changes outside. The photo projection
 * (tools/house-tests/ute-foto.test.mjs, 082841 + 082852 with the fix-shell cameras) decided:
 *   - the landing / forecourt level: the landing's SW corner triangulates to y −2.63 (rays 0.20 m apart); with
 *     y −2.87 the two rays miss by 0.39 m (38 / 31 px), with TERRACE_FIT's −1.72 by 0.67 m (93 / 107 px) → −2.87
 *     (entranceLevelY), and the stair gets 16 risers (V33);
 *   - the terrace edge: the far top corner of the slatted screen triangulates to x 10.77, z 6.59; the deck edge at
 *     x 10.35 reprojects 53 / 56 px off, TERRACE_FIT's 9.80 53 / 180 px → 9.80 does not fit best, so the deck goes out
 *     to x 10.35 (V9) – over the whole width to the west edge (z 6.75), since the screen runs on to that corner;
 *   - the white pillar in the living-room photos is NOT the entrance pillar (V30, x 10.0–10.35 · z 5.65–6.0 is hidden
 *     behind the terrace's clad west face from both cameras); its NE edge triangulates to (10.33; 6.32) with the rays
 *     0.06 m apart, under the deck's SW corner → a second, corner pier (CORNER_PIER, flagged).
 */
const HOUSE_FIT = {
  /** the slatted screen along the west edge starts 0.73 m from the facade (was 7.65): room for the capsule (Ø 0.6) */
  screenFromX: 7.95,
  /** the corner pier under the deck's SW corner (0.30 × 0.30), spritputs like the entrance pillar */
  cornerPier: { size: 0.3, color: '#a8a9aa' },
  /** the deck's south edge railing returns to the annex's south face at the deck's east end (z −0.30) */
  railReturn: true,
};
/** Set false to drop the corner pier (if the owner says there is only the entrance pillar). */
const CORNER_PIER = true;

const num = (v, d) => (Number.isFinite(v) ? v : d);
const rectOf = (poly) => {
  const xs = poly.map((p) => p[0]), zs = poly.map((p) => p[1]);
  return { x0: Math.min(...xs), x1: Math.max(...xs), z0: Math.min(...zs), z1: Math.max(...zs) };
};

/**
 * Plain numbers for the exterior of the whole house: the terrace (TERRACE_FIT + V9), the entrance level, the stair
 * (wedge for walking, §3.11), the forecourt and its paving, the niche (soffit, fill, pillars), the ground colliders
 * (never inside the basement: §0 / steg 25) and the walking bounds. Pure (THREE only for Vector2s) – the builder
 * below and tools/house-tests/ute.test.mjs both use it. Without layout.house.outsideHouse it returns { house: false }
 * plus the living-room-era terrace, and the builder behaves as before.
 * @param {object} layout
 */
export function exteriorPlan(layout) {
  const out = layout.outside || {};
  const fit = fitTerrace(out.terrace);
  const oh = layout.house?.outsideHouse || null;
  const plan = { house: !!oh, fitted: fit.fitted, t: fit.t, oh };
  if (!oh || !fit.t) return plan;
  const t0 = fit.t;
  const deckY = t0.floorY ?? -0.03;
  const entranceY = num(oh.entranceLevelY, -2.87);
  const groundY = num(oh.groundBelowY, num(oh.terrain?.nearHouseY, entranceY - 0.08));
  const nearGroundY = num(oh.nearGround?.y, groundY);
  const nearGroundToX = num(oh.nearGround?.toX, 12.8);
  const polyV = t0.polygonV || [];
  const xS = Math.max(...polyV.map((p) => p.x)); // the fitted south edge (9.80)
  const zA = Math.min(...polyV.map((p) => p.y)); // east end of the deck (0)
  const westZ = Math.max(...polyV.map((p) => p.y)); // the fitted west edge (6.75)
  const an = t0.annex?.polygonV?.length ? rectOf(t0.annex.polygonV.map((p) => [p.x, p.y])) : null;
  // ---- V9: the deck out to x 10.35 (the outer face of rom 3,70), from z −0.30 (its east face) to the west edge
  const xE = Math.max(xS, num(oh.deck?.extendToX, xS));
  const zE = Math.min(zA, num(oh.deck?.z?.[0], zA));
  const ax1 = an && Math.abs(an.z1 - zA) < 1e-3 ? an.x1 : null;
  const polygon = [];
  for (const p of polyV) {
    if (Math.abs(p.x - xS) < 1e-3 && Math.abs(p.y - zA) < 1e-3 && xE > xS + 1e-3) {
      if (ax1 != null && ax1 < xE - 1e-3 && zE < zA - 1e-3) polygon.push([ax1, zA], [ax1, zE], [xE, zE]);
      else polygon.push([xE, zA]);
    } else if (Math.abs(p.x - xS) < 1e-3) polygon.push([xE, p.y]);
    else polygon.push([p.x, p.y]);
  }
  const railingLines = [];
  if (HOUSE_FIT.railReturn && ax1 != null && ax1 < xE - 1e-3 && zE < zA - 1e-3) railingLines.push([[ax1, zE], [xE, zE]]);
  railingLines.push([[xE, ax1 != null && zE < zA ? zE : zA], [xE, westZ]]);
  railingLines.push([[HOUSE_FIT.screenFromX, westZ], [xE, westZ]]);
  const ts = oh.terraceStair || {};
  const stair = {
    ...(t0.stair || {}),
    from: ts.from ?? t0.stair?.from,
    to: ts.to ?? t0.stair?.to,
    width: ts.width ?? t0.stair?.width ?? 0.75,
    topY: num(ts.topY, deckY),
    bottomY: num(ts.bottomY, entranceY),
    risers: ts.risers ?? null,
    guards: ts.guards ?? 'outer',
    guardHeight: t0.stair?.guardHeight ?? 0.85,
    closedSideFromX: num(ts.closedSideFromX, xS),
    landing: oh.landing ?? null,
    path: oh.path ?? null,
    walk: oh.walk ?? null,
  };
  const t = {
    ...t0,
    polygonV: polygon.map(([x, z]) => new THREE.Vector2(x, z)),
    railingLinesV: railingLines.map((line) => line.map(([x, z]) => new THREE.Vector2(x, z))),
    stair,
  };
  // ---- the stair as a closed wedge (§3.1, §3.11): from the top nosing to the foot of the last riser
  const a = stair.from, b = stair.to;
  const nR = Math.max(2, stair.risers ?? Math.round((stair.topY - stair.bottomY) / 0.18));
  const w = stair.width;
  const zc = a[1];
  const wedge = {
    x0: a[0], x1: b[0], y0: stair.topY, y1: stair.bottomY, z0: zc - w / 2 + 0.02, z1: zc + w / 2 - 0.02, bottomY: groundY - 0.2,
    risers: nR, rise: (stair.topY - stair.bottomY) / nR, going: (b[0] - a[0]) / (nR - 1),
  };
  // ---- static colliders (Box3 as {min,max} arrays): ground, paving, niche, pillars, stair top step and guards
  const solids = [];
  const box = (kind, x0, x1, y0, y1, z0, z1) => solids.push({ kind, min: [x0, y0, z0], max: [x1, y1, z1] });
  // the basement's outer faces seen from outside (avstemmingen §1.2): never put a collider behind them
  const fillR = oh.fill ? { x0: oh.fill.x[0], x1: oh.fill.x[1], z0: oh.fill.z[0], z1: oh.fill.z[1] } : null;
  const fc = oh.forecourt?.polygon ? rectOf(oh.forecourt.polygon) : { x0: 8.88, x1: 12.6, z0: 3.18, z1: 6.75 };
  const bodSouth = num(oh.deck?.extendToX, 10.35); // rom 3,70's south face (10.34) ≈ the deck edge
  const southFace = fillR ? fillR.x0 : 6.75; // kjellerstuas sørvegg (V6)
  const lawnTop = groundY;
  const lawnBot = groundY - 0.25;
  const outer = oh.walkRects?.[0] || { minX: southFace, maxX: 14, minZ: -0.2, maxZ: 9 };
  const zMaxLawn = Math.max(outer.maxZ, layout.bounds?.maxZ ?? 0);
  // lawn: east of the forecourt in front of rom 3,70 / beside it / west of the niche (the stair, path, walk)
  box('lawn', bodSouth + 0.01, outer.maxX, lawnBot, lawnTop, outer.minZ, fc.z0);
  box('lawn', fc.x1, outer.maxX, lawnBot, lawnTop, fc.z0, fc.z1);
  box('lawn', southFace + 0.01, outer.maxX, lawnBot, lawnTop, fc.z1, zMaxLawn);
  // paving at the entrance level (forecourt incl. the covered niche, the landing, the path, the walk)
  const pave = (kind, poly) => {
    if (!poly) return;
    const r = rectOf(poly);
    box(kind, r.x0, r.x1, entranceY - 0.2, entranceY, r.z0, r.z1);
  };
  pave('forecourt', oh.forecourt?.polygon ?? [[fc.x0, fc.z0], [fc.x1, fc.z1]]);
  pave('landing', stair.landing?.polygon);
  pave('path', stair.path?.polygon);
  pave('walk', stair.walk?.polygon);
  // the stair's level top step (facade → first riser) at deck level
  const fx = layout.wallsById?.['w-sor'] ? layout.wallsById['w-sor'].start.x + 0.3 : a[0] - 0.4;
  if (a[0] - fx > 0.02) box('topstep', fx, a[0], stair.topY - 0.2, stair.topY, zc - w / 2, zc + w / 2);
  // the clad west face of the terrace (z = westZ) from the facade (or the fill) to the old corner (closedSideFromX)
  const cladX0 = fillR ? fillR.x0 + 0.01 : fx;
  const clad = { x0: cladX0, x1: stair.closedSideFromX, z: westZ, y0: nearGroundY - 0.05, y1: deckY - 0.2 };
  box('clad', clad.x0, clad.x1, clad.y0, clad.y1, westZ - 0.035, westZ);
  // the fill behind the door wall's cladding (V31): 1–4 cm inside every neighbour face (no coplanar faces)
  const fill = fillR ? { x0: fillR.x0 + 0.01, x1: fillR.x1 - 0.02, z0: fillR.z0 + 0.01, z1: Math.min(fillR.z1, westZ - 0.035) - 0.005, y0: groundY - 0.05, y1: deckY - 0.2, color: oh.fill.cladding?.color ?? '#4a4642', id: oh.fill.id } : null;
  if (fill) box('fill', fill.x0, fill.x1, fill.y0, fill.y1, fill.z0, fill.z1);
  // the entrance pillar (V30) – both pillars stop at the niche soffit's underside (5 mm below its data y, see soffits)
  const nicheS = (oh.soffits || []).find((s) => s.id === oh.covered?.soffitId || s.id === 'himling-nisje');
  const nicheUnder = nicheS ? num(nicheS.y, -0.5) - 0.005 : deckY - 0.2;
  const pl = oh.pillar ? { ...oh.pillar, x0: oh.pillar.x[0], x1: oh.pillar.x[1], z0: oh.pillar.z[0], z1: oh.pillar.z[1], y0: groundY - 0.05, y1: Math.min(num(oh.pillar.y?.[1], -0.5), nicheUnder) } : null;
  if (pl) box('pillar', pl.x0, pl.x1, pl.y0, pl.y1, pl.z0, pl.z1);
  // the corner pier under the deck's SW corner (seen from the living room, see HOUSE_FIT)
  const cp = CORNER_PIER ? { x0: xE - HOUSE_FIT.cornerPier.size, x1: xE, z0: westZ - HOUSE_FIT.cornerPier.size, z1: westZ, y0: groundY - 0.05, y1: nicheUnder, color: HOUSE_FIT.cornerPier.color } : null;
  if (cp) box('pier', cp.x0, cp.x1, cp.y0, cp.y1, cp.z0, cp.z1);
  // guards of the walkable stair: outer side (z1) all along, inner side (z0) where the clad face ends
  const guardTop = (x) => stair.topY + ((stair.bottomY - stair.topY) * (x - a[0])) / (b[0] - a[0]) + 1.0;
  const guards = [
    { side: 'outer', x0: a[0], x1: b[0], z0: zc + w / 2 - 0.02, z1: zc + w / 2 + 0.02 },
    { side: 'inner', x0: Math.max(a[0], stair.closedSideFromX), x1: b[0], z0: zc - w / 2 - 0.02, z1: zc - w / 2 + 0.02 },
  ].map((g) => ({ ...g, yTop0: guardTop(g.x0), yTop1: guardTop(g.x1) }));
  // ---- the niche soffit (V28) and the soffit under the overhangs (V4, V6): one flat plate each, deck underside down
  const soffits = (oh.soffits || []).map((s) => {
    let rects;
    if (s.id === oh.covered?.soffitId || s.id === 'himling-nisje') {
      // the deck now covers the whole niche to its SW corner (the data's notch at x 9.80 · z 6.0–6.75
      // was the old deck edge); west of the clad face's end it stops at the clad face (no coplanar faces)
      const r = rectOf(s.polygon);
      const xc = Math.min(Math.max(r.x0, stair.closedSideFromX), Math.max(r.x1, xE));
      rects = [
        { x0: r.x0, x1: xc, z0: r.z0, z1: Math.max(r.z1, westZ) - 0.035 },
        { x0: xc, x1: Math.max(r.x1, xE), z0: r.z0, z1: Math.max(r.z1, westZ) },
      ].filter((q) => q.x1 - q.x0 > 0.01);
    } else rects = decomposeL(s.polygon);
    const niche = s.id === 'himling-nisje' || s.id === oh.covered?.soffitId;
    // 5 mm under the data's y: if rooms.js (C2) also builds a plate at y, this one shows and nothing z-fights
    return { id: s.id, niche, y: num(s.y, -0.5) - 0.005, color: s.color ?? '#4a4642', rects, top: niche ? deckY - 0.2 : num(s.y, -0.3) - 0.001 }; // (overhang: a 4 mm plate just under the cladding's foot at −0.30)
  });
  // ---- walking bounds: the house's rectangles plus the outside one (V26)
  const rects = [{ minX: outer.minX + 0.0, maxX: outer.maxX - 0.05, minZ: outer.minZ + 0.05, maxZ: outer.maxZ - 0.05, minY: num(outer.minY, -Infinity), maxY: num(outer.maxY, Infinity), levelId: 'ute' }];
  // …and the terrace (deck + the stair's upper part, above the outside band's top): for Collision.setBoundsList (M2)
  const dk = rectOf(polygon);
  rects.push({ minX: dk.x0 + 0.05, maxX: dk.x1 - 0.05, minZ: Math.max(dk.z0, outer.minZ) + 0.05, maxZ: zc + w / 2 - 0.05, minY: num(outer.maxY, -0.3) - 0.05, maxY: Infinity, levelId: 'terrasse' });
  const lb = layout.bounds || { minX: 0, maxX: 0, minZ: 0, maxZ: 0 };
  const hb = layout.house?.bounds || lb;
  const union = {
    minX: Math.min(lb.minX + 0.05, hb.minX + 0.05, rects[0].minX),
    maxX: Math.max(lb.maxX - 0.05, rects[0].maxX, xE - 0.05),
    minZ: Math.min(Math.max(lb.minZ, zE) + 0.05, rects[0].minZ),
    maxZ: Math.max(lb.maxZ - 0.05, rects[0].maxZ),
  };
  return Object.assign(plan, {
    t, deckY, entranceY, groundY, nearGroundY, nearGroundToX, westZ, xS, xE, zE,
    stair, wedge, solids, clad, fill, pillar: pl, cornerPier: cp, guards, soffits, forecourt: fc,
    removeFoundation: new Set((oh.removeFoundationBoxes || []).map((r) => r.under)),
    removeColumns: Array.isArray(oh.deck?.removeColumnsAtZ),
    walkRects: rects, bounds: union,
    paving: oh.paving || {},
    lights: oh.lights || [],
    fixtures: oh.fixtures || [],
    spawn: oh.spawnOutside || null,
  });
}

/**
 * An invisible closed prism for the collision octree: a convex (x, y) profile extruded along z from z0 to z1
 * (ExtrudeGeometry: the faces point outward, as Octree's one-sided capsule test needs). Never added to the scene.
 */
function prismZ(profile, z0, z1, name) {
  const shape = new THREE.Shape(profile.map(([x, y]) => new THREE.Vector2(x, y)));
  const g = new THREE.ExtrudeGeometry(shape, { depth: z1 - z0, bevelEnabled: false });
  g.translate(0, 0, z0);
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ visible: false }));
  m.name = name;
  return m;
}

/** An axis-aligned L / rectangle polygon ([x, z] points) → its rectangles (split at the inner corner). */
function decomposeL(poly) {
  const r = rectOf(poly);
  if (poly.length <= 4) return [r];
  const xs = [...new Set(poly.map((p) => p[0]))].sort((a, b) => a - b);
  const inside = (x, z) => {
    let c = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, zi] = poly[i], [xj, zj] = poly[j];
      if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
    }
    return c;
  };
  // vertical strips between consecutive x, each with its z extent (merged when equal)
  const strips = [];
  for (let i = 0; i < xs.length - 1; i++) {
    const xm = (xs[i] + xs[i + 1]) / 2;
    const zs = [...new Set(poly.map((p) => p[1]))].sort((a, b) => a - b);
    let z0 = null, z1 = null;
    for (let k = 0; k < zs.length - 1; k++) {
      const zm = (zs[k] + zs[k + 1]) / 2;
      if (inside(xm, zm)) {
        z0 = z0 ?? zs[k];
        z1 = zs[k + 1];
      }
    }
    if (z0 == null) continue;
    const last = strips[strips.length - 1];
    if (last && Math.abs(last.z0 - z0) < 1e-6 && Math.abs(last.z1 - z1) < 1e-6 && Math.abs(last.x1 - xs[i]) < 1e-6) last.x1 = xs[i + 1];
    else strips.push({ x0: xs[i], x1: xs[i + 1], z0, z1 });
  }
  return strips.length ? strips : [r];
}

/** The terrace spec with TERRACE_FIT applied (a copy; the layout stays untouched). */
function fitTerrace(t) {
  const st = t?.stair;
  const old = TERRACE_FIT.oldStairFrom;
  if (!st || !Array.isArray(st.from) || Math.abs(st.from[0] - old[0]) > 1e-3 || Math.abs(st.from[1] - old[1]) > 1e-3) return { t, fitted: false };
  const F = TERRACE_FIT;
  const polygonV = (t.polygonV || []).map((p) => new THREE.Vector2(p.x, Math.abs(p.y - F.oldWestZ) < 1e-3 ? F.westZ : p.y));
  return {
    fitted: true,
    t: {
      ...t,
      polygonV,
      railingLinesV: F.railingLines.map((line) => line.map(([x, z]) => new THREE.Vector2(x, z))),
      stair: { ...st, ...F.stair },
    },
  };
}

const BACKDROP_VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vWorld;
void main() {
  vUv = uv;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

// Unlit photo: optional cross-fade to a second map, brightness/tint, the top rows fading into the sky colour and an
// optional «window clip»: the fragment is kept only when the ray camera → fragment passes through one of up to two
// rectangles in a plane x = planeX (the glass of the windows that backdrop belongs to).
const BACKDROP_FRAG = /* glsl */ `
uniform sampler2D map;
uniform sampler2D map2;
uniform float mixK;
uniform float bright1;
uniform float bright2;
uniform vec3 tint;
uniform vec3 sky;
uniform float skyFade;
uniform float clipOn;
uniform float planes[6];
uniform vec4 rects[6];
uniform float rectCount;
uniform float edgeFade;
uniform float horizonV;
uniform vec3 ground;
uniform vec4 maskRect;
uniform float maskOn;
uniform float maskBelowV;
uniform float maskRightU;
uniform float fade;
varying vec2 vUv;
varying vec3 vWorld;
void main() {
  // texels of things that are built in 3D (the annex in the kitchen photo: u < maskRect.y below v = maskRect.w) or only
  // a soft fill (below maskBelowV, right of maskRightU) fade out over a few per cent, so the 3D model / the south photo / the lawn behind
  // show through without a hard seam (this backdrop is then drawn blended, after the opaque ones)
  float aMask = 1.0;
  if (maskOn > 0.5) {
    float inU = 1.0 - smoothstep(maskRect.y, maskRect.y + 0.06, vUv.x);
    float inV = 1.0 - smoothstep(maskRect.w, maskRect.w + 0.04, vUv.y);
    aMask = (1.0 - inU * inV) * smoothstep(maskBelowV, maskBelowV + 0.015, vUv.y) * (1.0 - smoothstep(maskRightU, maskRightU + 0.06, vUv.x));
    if (aMask < 0.004) discard;
  }
  if (clipOn > 0.5) {
    vec3 d = vWorld - cameraPosition;
    bool ok = false;
    if (abs(d.x) > 1e-5) {
      // up to six window rectangles, each in the glass plane x = planes[i] of its wall (hele huset: the basement
      // windows of a view sit in another wall line than the living room's)
      for (int i = 0; i < 6; i++) {
        if (float(i) > rectCount - 0.5) break;
        float t = (planes[i] - cameraPosition.x) / d.x;
        if (t > 0.0 && t < 1.0) {
          vec3 p = cameraPosition + d * t;
          vec4 r = rects[i];
          if (p.z > r.x && p.z < r.y && p.y > r.z && p.y < r.w) ok = true;
        }
      }
    }
    if (!ok) discard;
  }
  vec3 a = texture2D(map, vUv).rgb * bright1;
  vec3 b = texture2D(map2, vUv).rgb * bright2;
  vec3 c = mix(a, b, mixK) * tint;
  // the left/right ends of the cylinder fade into the sky (above the horizon) / a dark foliage tone (below), so a
  // viewer outside never sees a hard edge where the photo ends
  float e = smoothstep(0.0, edgeFade, vUv.x) * (1.0 - smoothstep(1.0 - edgeFade, 1.0, vUv.x));
  vec3 edgeCol = mix(ground, sky, smoothstep(horizonV - 0.04, horizonV + 0.06, vUv.y));
  c = mix(edgeCol, c, e);
  c = mix(c, sky, smoothstep(1.0 - skyFade, 1.0, vUv.y));
  c = mix(sky, c, fade);
  gl_FragColor = vec4(c, aMask);
  #include <colorspace_fragment>
}`;

// The lawn: the south photo projected from its camera centre onto the 3D ground (same daylight uniforms as the photo).
// Ground points the photo does not cover – steeper than its bottom row (close to the facade, under the terrace and
// the stair) or beyond its sides – used to get the clamped edge texels smeared into long green/brown streaks. They
// fade to the photo's own lawn colour (mean of its bottom rows) with a soft world-space variation instead.
const GROUND_FRAG = /* glsl */ `
uniform sampler2D map;
uniform sampler2D map2;
uniform float mixK;
uniform float bright1;
uniform float bright2;
uniform vec3 tint;
uniform vec3 center;
uniform vec2 azRange;
uniform vec2 tanRange;
uniform vec3 lawn1;
uniform vec3 lawn2;
uniform vec3 sky;
uniform float fade;
varying vec2 vUv;
varying vec3 vWorld;
float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x), f.y);
}
void main() {
  vec3 d = vWorld - center;
  float a = atan(d.z, d.x);
  float uRaw = (a - azRange.x) / (azRange.y - azRange.x);
  float te = d.y / max(1e-3, length(d.xz));
  float vRaw = (te - tanRange.x) / (tanRange.y - tanRange.x);
  vec2 uv = vec2(clamp(uRaw, 0.001, 0.999), clamp(vRaw, 0.002, 0.998));
  vec3 c = mix(texture2D(map, uv).rgb * bright1, texture2D(map2, uv).rgb * bright2, mixK) * tint;
  float inside = smoothstep(0.0, 0.04, vRaw) * smoothstep(0.0, 0.03, uRaw) * smoothstep(0.0, 0.03, 1.0 - uRaw);
  float n = 0.62 * vnoise(vWorld.xz * 0.8) + 0.38 * vnoise(vWorld.xz * 3.1 + 7.0);
  vec3 lawnC = mix(lawn1 * bright1, lawn2 * bright2, mixK) * tint * (0.8 + 0.4 * n);
  c = mix(lawnC, c, inside);
  c = mix(sky, c, fade);
  gl_FragColor = vec4(c, 1.0);
  #include <colorspace_fragment>
}`;

/** Open cylinder segment around a vertical axis through b.center (exact reprojection of the photo from there). */
function backdropGeometry(b, R = b.suggestedDistance, N = 96) {
  const [a0, a1] = b.azimuthDeg.map(THREE.MathUtils.degToRad);
  const [t0, t1] = b.tanElevation;
  const [cx, cy, cz] = b.center;
  const pos = [];
  const uv = [];
  const idx = [];
  for (let i = 0; i <= N; i++) {
    const a = a0 + ((a1 - a0) * i) / N;
    const x = cx + R * Math.cos(a);
    const z = cz + R * Math.sin(a);
    pos.push(x, cy + R * t0, z, x, cy + R * t1, z);
    uv.push(i / N, 0, i / N, 1);
    if (i < N) idx.push(2 * i, 2 * i + 2, 2 * i + 1, 2 * i + 1, 2 * i + 2, 2 * i + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

/**
 * Builds the exterior.
 * @param {object} ctx
 * @param {object} layout
 * @returns {{ group: THREE.Group, setDaylight: (level: number, skyHex?: string) => void, ready: Promise<void>, dispose: () => void }}
 */
export function buildExterior(ctx, layout) {
  const quality = ctx.quality || {};
  const res = Math.min(1, quality.textureRes ?? 1);
  const low = quality.level === 'low';
  const group = new THREE.Group();
  group.name = 'exterior';
  const owned = [];
  const keep = (x) => (owned.push(x), x);
  const daySky = new THREE.Color('#c9d6e2');
  const eveSky = new THREE.Color('#33476e');
  const sky = daySky.clone();
  if (ctx.scene) ctx.scene.background = sky.clone();

  const out = layout.outside || {};
  // the whole house (outsideHouse, steg 25): the plan merges it into the terrace and the ground; without it, as before
  const P = exteriorPlan(layout);
  const H = P.house;
  const fit = { fitted: P.fitted };
  const t = P.t;
  const deckY = t?.floorY ?? -0.03;
  const groundY = H ? P.groundY : out.groundBelowY ?? out.terrain?.nearHouseY ?? -2.7;
  // lawn level next to the house (the stair's landing); further out the ground falls to groundY and on to the river
  const nearGroundY = H ? P.nearGroundY : out.nearGround?.y ?? (fit.fitted ? TERRACE_FIT.nearGroundY : groundY);
  const nearGroundToX = H ? P.nearGroundToX : out.nearGround?.toX ?? (fit.fitted ? TERRACE_FIT.nearGroundToX : 10.5);
  // the stair runs along the terrace's west edge (photo fit / new room-spec): clad west face, one guard, top step
  const alongEdge = t?.stair?.guards === 'outer';
  const westZ = t?.polygonV?.length ? Math.max(...t.polygonV.map((q) => q.y)) : 0;
  const kb = new MeshBatcher('exterior');
  const solidBoxes = [];

  // one neutral concrete texture set, tinted per use (material.color multiplies the baked grey)
  const CONCRETE_BASE = '#a0a0a0';
  // (half resolution below «høy»: the deck, landing and pillars are only seen through the windows / from the terrace)
  const concreteSet = concrete({ color: CONCRETE_BASE, tile: 3, contrast: 0.5, seed: 41, res: quality.level === 'high' ? res : Math.min(res, 0.5) });
  const tinted = (hex, rough, ns = 1) => {
    const m = keep(surfaceMaterial(concreteSet, { roughness: rough }));
    if (m.normalMap) m.normalScale.set(ns, ns);
    const b = new THREE.Color(CONCRETE_BASE);
    const c = new THREE.Color(hex);
    m.color.setRGB(c.r / b.r, c.g / b.g, c.b / b.b);
    return m;
  };
  // own instances of the cached mat() materials (same shader programs): the exterior gets its own sky environment
  // (setDaylight), which must not reach the furniture that shares the cached ones
  const own = (m) => keep(m.clone());
  const M = {
    // smooth painted/membrane deck: only a faint relief (the concrete's pores read as dark dots in the sun)
    deck: tinted(t?.deck?.color || '#5a5e64', 0.82, 0.25),
    deckEdge: own(mat('painted', '#3f4246', { roughness: 0.85 })),
    // weathered, grey-lazured boards (082841 in shade: grey-brown); a little rougher and less glossy than plain ash
    wood: own(mat('ash', t?.railingColor || '#7c776f', { roughness: 0.95, envMapIntensity: 0.4 })),
    woodV: own(mat('ash', t?.railingColor || '#7c776f', { roughness: 0.95, grain: 'v', envMapIntensity: 0.4 })),
    tread: own(mat('ash', '#615b55', { roughness: 0.95, envMapIntensity: 0.4 })),
    landing: tinted('#b9b6ae', 0.9),
    plaster: own(mat('painted', '#d9d6cf', { roughness: 0.95 })),
    pillar: tinted('#9c9b96', 0.95),
    annex: keep(claddingMaterial(t?.annex?.cladding?.match(/#[0-9a-f]{6}/i)?.[0] || '#4a4642', quality, { roughness: 0.9 })),
    turf: own(mat('moss', '#5e6b3e', { roughness: 1 })),
    fascia: own(mat('painted', '#3a3734', { roughness: 0.85 })),
    rattan: own(mat('rattan', '#8b8984')),
    cushion: own(mat('woven', '#7c7a76')),
    tableTop: own(mat('painted', '#e9e7e2', { roughness: 0.5 })),
  };
  if (H) {
    // the entrance (V30, V34): grey spritputs pillars, gravel, slate, concrete slabs, ground cover, black fittings
    M.spritputs = tinted(P.pillar?.color || '#a8a9aa', 0.98, 1.8);
    M.gravel = tinted(P.paving.gravelStrip?.color || '#aeafb0', 1, 1.4);
    M.slate = tinted(P.paving.slate?.color || '#9da4a8', 0.78, 0.5);
    M.slab = tinted(P.paving.concrete?.color || '#a7a49e', 0.92, 0.7);
    M.slab2 = tinted(new THREE.Color(P.paving.concrete?.color || '#a7a49e').multiplyScalar(0.94).getStyle(), 0.92, 0.7);
    M.cover = own(mat('moss', P.paving.groundCover?.color || '#4e6b3a', { roughness: 1 }));
    M.black = own(mat('painted', '#1a1a1a', { roughness: 0.6 }));
    M.ring = own(mat('painted', '#d9d9d6', { roughness: 0.35 }));
    M.lens = own(mat('painted', '#f4f1ea', { roughness: 0.2 }));
    M.soffit = keep(claddingMaterial(P.soffits[0]?.color || '#4a4642', quality, { roughness: 0.9 }));
  }
  const litMats = Object.values(M);
  // full sky light: the authored envMapIntensity (0.4 on the boards) only damped the room's bounce, which no longer lights them
  for (const m of litMats) m.userData.envBase = 1;

  // ---------------------------------------------------------------------------------------------------------------
  // Terrace deck (slab 0.2 m, top at deckY), edge fascia, pillars and the white foundation under the facade
  if (t?.polygonV?.length) {
    const shape = new THREE.Shape(t.polygonV.map((p) => new THREE.Vector2(p.x, -p.y)));
    const g = new THREE.ExtrudeGeometry(shape, { depth: 0.2, bevelEnabled: false });
    g.rotateX(-Math.PI / 2);
    g.translate(0, deckY - 0.2, 0);
    // uv: top in metres (x, z), sides along × height
    const pos = g.attributes.position, nrm = g.attributes.normal, uv = g.attributes.uv;
    for (let i = 0; i < pos.count; i++) {
      if (Math.abs(nrm.getY(i)) > 0.5) uv.setXY(i, pos.getX(i), pos.getZ(i));
      else uv.setXY(i, pos.getX(i) + pos.getZ(i), pos.getY(i));
    }
    kb.add(g, M.deck, { collide: true });
    g.dispose();
    // walkable boxes (deck) + footsteps
    const xs = t.polygonV.map((p) => p.x), zs = t.polygonV.map((p) => p.y);
    const bx = new THREE.Box3(new THREE.Vector3(Math.min(...xs), deckY - 0.2, Math.min(...zs)), new THREE.Vector3(Math.max(...xs), deckY, Math.max(...zs)));
    ctx.collision?.addSurfaceZone(new THREE.Box3(bx.min.clone(), bx.max.clone().setY(deckY + 2)), 'tile');
    // pillars under the outer edge
    const xo = Math.max(...xs);
    const zMax = Math.max(...zs);
    // (hele huset: the deck rests on rom 3,70, the pillars and the walls; the three columns go – avstemmingen V9)
    if (!(H && P.removeColumns)) for (const z of [0.25, zMax / 2, zMax - 0.2]) kb.box(0.25, deckY - 0.2 - groundY, 0.25, xo - 0.3, (deckY - 0.2 + groundY) / 2, z, M.pillar, { collide: false });
    if (H) {
      // the terrace's clad west face down to the ground (V33), the corner pier and the entrance pillar (V30)
      const c = P.clad;
      if (c.x1 - c.x0 > 0.02) kb.box(c.x1 - c.x0, c.y1 - c.y0, 0.035, (c.x0 + c.x1) / 2, (c.y0 + c.y1) / 2, c.z - 0.0175, M.annex, { collide: false });
      for (const q of [P.cornerPier, P.pillar]) {
        if (!q) continue;
        kb.box(q.x1 - q.x0, q.y1 - q.y0, q.z1 - q.z0, (q.x0 + q.x1) / 2, (q.y0 + q.y1) / 2, (q.z0 + q.z1) / 2, M.spritputs, { collide: false });
      }
      // the small black box on the entrance pillar's east face (switch or sensor, h 1.4 over the ground)
      const pb = P.pillar?.box;
      if (pb) kb.box(pb.w ?? 0.06, pb.height ?? 0.1, 0.03, (P.pillar.x0 + P.pillar.x1) / 2, P.entranceY + (pb.h ?? 1.4), P.pillar.z0 - 0.015, M.black, { collide: false });
    } else if (alongEdge) {
      // the terrace's west face below the deck (dark vertical boards, seen beside the stair in 082841) and the white
      // corner pier at its south-west corner (082850)
      const xa = Math.min(...t.polygonV.filter((q) => Math.abs(q.y - zMax) < 1e-3).map((q) => q.x));
      const hh = deckY - 0.2 - nearGroundY + 0.05;
      kb.box(xo - xa, hh, 0.035, (xa + xo) / 2, deckY - 0.2 - hh / 2, zMax - 0.0175, M.annex, { collide: false });
      kb.box(0.3, deckY - 0.2 - nearGroundY + 0.05, 0.3, xo - 0.15, (deckY - 0.2 + nearGroundY - 0.05) / 2, zMax - 0.15, M.plaster, { collide: false });
    }
  }
  // foundation (white plaster) under the south and west facades of the living part, the kitchen part under the deck
  {
    // (hele huset: the basement's walls, the fill and the soffits replace them – outsideHouse.removeFoundationBoxes)
    const gone = (id) => H && P.removeFoundation.has(id);
    const sor = gone('w-sor') ? null : layout.wallsById['w-sor'];
    const vest = gone('w-vest-stue') ? null : layout.wallsById['w-vest-stue'];
    const ks = gone('w-kjokken-sor') ? null : layout.wallsById['w-kjokken-sor'];
    const top = -0.3;
    const h = top - groundY + 0.05;
    if (sor) kb.box(0.25, h, sor.length + 0.6, sor.start.x + 0.3 - 0.125, top - h / 2, (sor.start.y + sor.end.y) / 2, M.plaster, { collide: false });
    if (vest) {
      const xa = layout.bounds.minX - 0.3, xb = layout.bounds.maxX + 0.3;
      kb.box(xb - xa, h, 0.25, (xa + xb) / 2, top - h / 2, vest.start.y + 0.3 - 0.125, M.plaster, { collide: false });
    }
    if (ks) kb.box(0.25, h, ks.length + 0.3, ks.start.x + 0.3 - 0.125, top - h / 2, (ks.start.y + ks.end.y) / 2 - 0.15, M.plaster, { collide: false });
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Railings: posts ~1.3 m c/c, horizontal 7 cm boards with 3 cm gaps on the outside, flat handrail
  const railH = t?.railingHeight ?? 1.05;
  const centroid = (() => {
    if (!t?.polygonV?.length) return new THREE.Vector2(8, 3);
    const c = new THREE.Vector2();
    for (const p of t.polygonV) c.add(p);
    return c.multiplyScalar(1 / t.polygonV.length);
  })();
  /** A straight slatted railing from a to b (plan Vector2) at floor y0, top following y0 (+ slope to y1). */
  function railing(a, b, y0, y1 = y0, { posts = true, outward = null, bottomPad = 0.04, height = railH } = {}) {
    const dir = b.clone().sub(a);
    const len = dir.length();
    dir.normalize();
    let n = new THREE.Vector2(-dir.y, dir.x);
    if (outward) n = outward.clone();
    else if (n.dot(a.clone().add(b).multiplyScalar(0.5).sub(centroid)) < 0) n.negate();
    const yaw = Math.atan2(-dir.y, dir.x); // rotation.y that maps local +x onto dir
    const rail = (u, off) => new THREE.Vector3(a.x + dir.x * u + n.x * off, 0, a.y + dir.y * u + n.y * off);
    const sloped = Math.abs(y1 - y0) > 1e-3;
    const yAt = (u) => y0 + ((y1 - y0) * u) / len;
    if (posts) {
      const nP = Math.max(1, Math.ceil(len / 1.3));
      for (let i = 0; i <= nP; i++) {
        const u = Math.min(len - 0.045, Math.max(0.045, (len * i) / nP));
        const p = rail(u, -0.045);
        const yb = yAt(u) - (sloped ? 0.15 : 0);
        kb.box(0.09, height + (sloped ? 0.15 : 0), 0.09, p.x, yb + (height + (sloped ? 0.15 : 0)) / 2, p.z, M.woodV, { rot: [0, yaw, 0], collide: false });
      }
    }
    if (!sloped) {
      for (let y = y0 + bottomPad; y + 0.07 <= y0 + height - 0.02; y += 0.1) {
        const p = rail(len / 2, 0.01);
        kb.box(len, 0.07, 0.02, p.x, y + 0.035, p.z, M.wood, { rot: [0, yaw, 0], collide: false });
      }
      const hp = rail(len / 2, -0.035);
      kb.box(len + 0.04, 0.032, 0.14, hp.x, y0 + height + 0.016, hp.z, M.wood, { rot: [0, yaw, 0], collide: false });
      // collision: a thin wall along the railing
      const c0 = rail(0, 0), c1 = rail(len, 0);
      solidBoxes.push(new THREE.Box3(new THREE.Vector3(Math.min(c0.x, c1.x) - 0.05, y0, Math.min(c0.z, c1.z) - 0.05), new THREE.Vector3(Math.max(c0.x, c1.x) + 0.05, y0 + height + 0.1, Math.max(c0.z, c1.z) + 0.05)));
    } else {
      // stair guard: horizontal boards cut to the sloping panel (bottom 0.15 below the stair line, top height above it)
      const lo = Math.min(y0, y1) - 0.15;
      const hi = Math.max(y0, y1) + height;
      for (let y = lo; y + 0.07 <= hi; y += 0.1) {
        // u where the panel exists at this height: yAt(u) − 0.15 ≤ y and y + 0.07 ≤ yAt(u) + height
        const ua = ((y + 0.07 - height - y0) / (y1 - y0)) * len;
        const ub = ((y + 0.15 - y0) / (y1 - y0)) * len;
        const u0 = Math.max(0, Math.min(ua, ub));
        const u1 = Math.min(len, Math.max(ua, ub));
        if (u1 - u0 < 0.05) continue;
        const p = rail((u0 + u1) / 2, 0.01);
        kb.box(u1 - u0, 0.07, 0.02, p.x, y + 0.035, p.z, M.wood, { rot: [0, yaw, 0], collide: false });
      }
      // sloped handrail
      const pitch = Math.atan2(y1 - y0, len);
      const hp = rail(len / 2, -0.035);
      kb.box(Math.hypot(len, y1 - y0) + 0.04, 0.032, 0.14, hp.x, (y0 + y1) / 2 + height + 0.016, hp.z, M.wood, { rot: [0, yaw, pitch], order: 'YXZ', collide: false });
    }
  }
  if (t) {
    for (const line of t.railingLinesV || []) railing(line[0], line[1], deckY);
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Stair down to the concrete landing (closed risers, side cheeks, slatted guard on the open side(s)). With the photo
  // fit (TERRACE_FIT) it runs south along the terrace's west edge, from a small top step at the facade under win-s1;
  // the inner side is the terrace's clad west face, so only the outer side has a guard.
  const st = t?.stair;
  if (st) {
    const a = new THREE.Vector2(...st.from), b = new THREE.Vector2(...st.to);
    const len = a.distanceTo(b);
    const dir = b.clone().sub(a).normalize();
    const side = new THREE.Vector2(-dir.y, dir.x);
    const w = st.width ?? 1;
    const top = st.topY ?? deckY, bot = st.bottomY ?? groundY;
    const nR = Math.max(2, st.risers ?? Math.round((top - bot) / 0.18));
    const rise = (top - bot) / nR;
    const nT = nR - 1;
    const run = len / nT;
    const yaw = Math.atan2(-dir.y, dir.x);
    const treadMat = alongEdge ? M.tread : M.deck;
    for (let i = 1; i <= nT; i++) {
      const u = (i - 0.5) * run;
      const p = new THREE.Vector2(a.x + dir.x * u, a.y + dir.y * u);
      const y = top - i * rise;
      kb.box(run + 0.025, 0.045, w - 0.04, p.x, y - 0.0225, p.y, treadMat, { rot: [0, yaw, 0], collide: false });
      // riser below the front of the previous tread
      const ur = (i - 1) * run;
      const pr = new THREE.Vector2(a.x + dir.x * ur, a.y + dir.y * ur);
      kb.box(0.02, rise, w - 0.06, pr.x + dir.x * 0.01, y + rise / 2 - 0.045, pr.y + dir.y * 0.01, M.deckEdge, { rot: [0, yaw, 0], collide: false });
    }
    // closed side cheeks under the treads
    const pitch = Math.atan2(top - bot, len);
    // which sides get a guard: 'outer' = only the side away from the terrace
    const sideOut = (sg) => new THREE.Vector2(a.x + b.x, a.y + b.y).multiplyScalar(0.5).addScaledVector(side, sg * w).distanceTo(centroid);
    const outer = sideOut(1) > sideOut(-1) ? 1 : -1;
    for (const sg of [-1, 1]) {
      const c = new THREE.Vector2(a.x + dir.x * (len / 2) + side.x * sg * (w / 2 - 0.02), a.y + dir.y * (len / 2) + side.y * sg * (w / 2 - 0.02));
      kb.box(Math.hypot(len, top - bot) + 0.2, 0.3, 0.04, c.x, (top + bot) / 2 - 0.2, c.y, M.deckEdge, { rot: [0, yaw, -pitch], order: 'YXZ', collide: false });
      if (st.guards === 'outer' && sg !== outer) {
        // hele huset: the inner side gets a guard too where it passes the corner (x > closedSideFromX, V33)
        if (H && st.closedSideFromX != null && st.closedSideFromX < b.x - 0.1) {
          const ua = Math.max(0, ((st.closedSideFromX - a.x) / (b.x - a.x)) * len);
          const ya = top + ((bot - top) * ua) / len;
          const ga = new THREE.Vector2(a.x + dir.x * ua + side.x * sg * (w / 2), a.y + dir.y * ua + side.y * sg * (w / 2));
          const gb = new THREE.Vector2(b.x + side.x * sg * (w / 2), b.y + side.y * sg * (w / 2));
          railing(ga, gb, ya, bot, { outward: side.clone().multiplyScalar(sg), height: st.guardHeight ?? railH });
        }
        continue;
      }
      const ga = new THREE.Vector2(a.x + side.x * sg * (w / 2), a.y + side.y * sg * (w / 2));
      const gb = new THREE.Vector2(b.x + side.x * sg * (w / 2), b.y + side.y * sg * (w / 2));
      railing(ga, gb, top, bot, { outward: side.clone().multiplyScalar(sg), height: st.guardHeight ?? railH });
      if (alongEdge) {
        // the guard continues level along the top step to the facade
        const fx0 = layout.wallsById['w-sor'] ? layout.wallsById['w-sor'].start.x + 0.3 : a.x - 0.4;
        const gt = new THREE.Vector2(fx0 + 0.02, ga.y);
        if (ga.x - gt.x > 0.1) railing(gt, ga, top, top, { outward: side.clone().multiplyScalar(sg), height: st.guardHeight ?? railH });
      }
    }
    if (alongEdge) {
      // top step at deck level between the facade and the first riser, and the opening in the terrace's west edge
      // closed for the player (the stair is not walkable: the player stays on the terrace)
      const fx = layout.wallsById['w-sor'] ? layout.wallsById['w-sor'].start.x + 0.3 : a.x - 0.18;
      if (a.x - fx > 0.02) kb.box(a.x - fx, 0.045, w - 0.04, (fx + a.x) / 2, top - 0.0225, a.y, treadMat, { collide: false });
      if (!H) {
        const rl = (t.railingLinesV || []).find((l) => l.every((q) => Math.abs(q.y - westZ) < 1e-3));
        const x1g = rl ? Math.min(...rl.map((q) => q.x)) : a.x + 0.25;
        solidBoxes.push(new THREE.Box3(new THREE.Vector3(fx, top, westZ - 0.03), new THREE.Vector3(x1g + 0.05, top + 1.2, westZ + 0.06)));
      }
      // (hele huset: the stair is walkable – an invisible wedge over the treads, colliders below)
    } else {
      const gate = new THREE.Vector2(a.x, a.y);
      solidBoxes.push(new THREE.Box3(new THREE.Vector3(gate.x - w / 2 - 0.05, top, gate.y - 0.04), new THREE.Vector3(gate.x + w / 2 + 0.05, top + 1.2, gate.y + 0.06)));
    }
    // the pale concrete landing at the bottom and (photo fit) the concrete path along the stair's outer side
    for (const ld of [st.landing, st.path, st.walk]) {
      if (!ld?.polygon) continue;
      const lx = ld.polygon.map((q) => q[0]), lz = ld.polygon.map((q) => q[1]);
      const x0 = Math.min(...lx), x1 = Math.max(...lx), z0 = Math.min(...lz), z1 = Math.max(...lz);
      kb.box(x1 - x0, 0.15, z1 - z0, (x0 + x1) / 2, (ld.y ?? bot) - 0.075, (z0 + z1) / 2, M.landing, { collide: false });
    }
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Hele huset (steg 25): the forecourt at the entrance level with its paving (V34), the niche's soffit with the three
  // downlights (V28, V35), the fill behind the door wall (V31), the doorbell, the soffit under the overhangs (V4, V6),
  // the plastered wall under the annex, and the colliders: ground and paving (never inside the basement), the stair
  // as a wedge with guards (§3.11), pillars, fill, clad face.
  const collideMeshes = [];
  if (H) {
    const E = P.entranceY;
    const fc = P.forecourt;
    const pv = P.paving || {};
    // gravel bed under the whole forecourt (the strip along the door wall and the joints show it)
    kb.box(fc.x1 - fc.x0, 0.12, fc.z1 - fc.z0, (fc.x0 + fc.x1) / 2, E - 0.012 - 0.06, (fc.z0 + fc.z1) / 2, M.gravel, { collide: false });
    const strip = pv.gravelStrip?.width ?? 0.2;
    const xs0 = fc.x0 + strip;
    // the low ground cover along the east side wall (rom 3,70's west face), from the strip out to the deck edge
    const bedW = 0.22;
    kb.box(Math.min(fc.x1, P.xE) - xs0, 0.03, bedW, (xs0 + Math.min(fc.x1, P.xE)) / 2, E - 0.005 - 0.015, fc.z0 + bedW / 2, M.cover, { collide: false });
    // the slate in front of the door (1.5 × 0.7, a hair above the slabs)
    const sl = pv.slate ? { x0: pv.slate.x[0], x1: pv.slate.x[1], z0: pv.slate.z[0], z1: pv.slate.z[1] } : null;
    if (sl) kb.box(sl.x1 - sl.x0, 0.03, sl.z1 - sl.z0, (sl.x0 + sl.x1) / 2, E + 0.002 - 0.015, (sl.z0 + sl.z1) / 2, M.slate, { collide: false });
    // concrete slabs (0.60 × 0.50, 3 cm gravel joints), cut at the strip, the bed, the slate and the pillars
    const blocked = [sl && { ...sl, x0: sl.x0 - 0.02, x1: sl.x1 + 0.02, z0: sl.z0 - 0.02, z1: sl.z1 + 0.02 }, P.pillar, P.cornerPier].filter(Boolean);
    const SX = 0.6, SZ = 0.5, J = 0.03;
    const zs0 = fc.z0 + bedW + 0.02;
    let k = 0;
    for (let x = xs0 + 0.01; x < fc.x1 - 0.05; x += SX + J) {
      for (let z = zs0; z < fc.z1 - 0.05; z += SZ + J) {
        const x1 = Math.min(x + SX, fc.x1 - 0.01), z1 = Math.min(z + SZ, fc.z1 - 0.01);
        if (x1 - x < 0.08 || z1 - z < 0.08) continue;
        if (blocked.some((r) => x < r.x1 && x1 > r.x0 && z < r.z1 && z1 > r.z0)) continue;
        const m = (Math.sin(k++ * 12.9898 + x * 78.233) * 43758.5453) % 1 > 0 ? M.slab : M.slab2;
        kb.box(x1 - x, 0.04, z1 - z, (x + x1) / 2, E - 0.02, (z + z1) / 2, m, { collide: false });
      }
    }
    // soffits: the niche (−0.50, boards; down from the deck's underside) and the overhangs (−0.30)
    for (const s of P.soffits) {
      for (const r of s.rects) {
        const x0 = r.x0 + 0.001, z0 = r.z0 + 0.001;
        kb.box(r.x1 - x0, s.top - s.y, r.z1 - z0, (x0 + r.x1) / 2, (s.y + s.top) / 2, (z0 + r.z1) / 2, M.soffit, { collide: false });
      }
    }
    // the three downlights in the niche soffit (fittings only; lighting.js owns the light, group «ute»)
    const ns = P.soffits.find((s) => s.niche);
    for (const l of P.lights) {
      const [lx, , lz] = l.position;
      const r = (l.dims?.d ?? 0.09) / 2;
      const y = (ns?.y ?? -0.505) - 0.004;
      kb.cylinder(r + 0.012, r + 0.012, 0.008, lx, y, lz, M.ring, { segments: 20, collide: false });
      kb.cylinder(r - 0.008, r - 0.008, 0.006, lx, y - 0.003, lz, M.lens, { segments: 20, collide: false });
    }
    // the doorbell on the cladding west of the door element (V35)
    for (const f of P.fixtures) {
      if (f.type !== 'doorbell') continue;
      const [fxp, fy, fz] = f.position;
      const r = (f.dims?.d ?? 0.03) / 2;
      kb.cylinder(r, r, 0.024, fxp + 0.012 * (f.normal?.[0] ?? 1), fy, fz, M.black, { segments: 16, rot: [0, 0, Math.PI / 2], collide: false });
    }
    // the fill behind the door wall's cladding west of the entrance (V31)
    const fl = P.fill;
    if (fl) kb.box(fl.x1 - fl.x0, fl.y1 - fl.y0, fl.z1 - fl.z0, (fl.x0 + fl.x1) / 2, (fl.y0 + fl.y1) / 2, (fl.z0 + fl.z1) / 2, M.annex, { collide: false });
    // a plastered wall under the annex down to the ground (§2.9: otherwise it floats 2.5 m over the forecourt)
    const an = t?.annex?.polygonV;
    if (an?.length) {
      const ax = an.map((p) => p.x), az = an.map((p) => p.y);
      const x0 = Math.min(...ax), x1 = Math.max(...ax), z0 = Math.min(...az), z1 = Math.min(Math.max(...az), P.zE - 0.01);
      const y0 = groundY - 0.05, y1 = deckY - 0.3;
      if (z1 > z0) kb.box(x1 - x0, y1 - y0, z1 - z0, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, M.plaster, { collide: false });
    }
    // ---- colliders
    for (const s of P.solids) solidBoxes.push(new THREE.Box3(new THREE.Vector3(...s.min), new THREE.Vector3(...s.max)));
    const wd = P.wedge;
    collideMeshes.push(prismZ([[wd.x0, wd.y0], [wd.x1, wd.y1], [wd.x1, wd.bottomY], [wd.x0, wd.bottomY]], wd.z0, wd.z1, 'terrace-stair-wedge'));
    for (const g of P.guards) {
      if (g.x1 - g.x0 < 0.05) continue;
      collideMeshes.push(prismZ([[g.x0, g.yTop0 - 1.1], [g.x1, g.yTop1 - 1.1], [g.x1, g.yTop1], [g.x0, g.yTop0]], g.z0, g.z1, `terrace-stair-guard-${g.side}`));
    }
    // footsteps: lawn soft, paving hard, the stair wooden (later zones win)
    if (ctx.collision) {
      for (const s of P.solids) {
        const surf = s.kind === 'lawn' ? 'rug' : ['forecourt', 'landing', 'path', 'walk'].includes(s.kind) ? 'tile' : null;
        if (surf) ctx.collision.addSurfaceZone(new THREE.Box3(new THREE.Vector3(s.min[0], s.max[1] - 0.3, s.min[2]), new THREE.Vector3(s.max[0], s.max[1] + 1.0, s.max[2])), surf);
      }
      ctx.collision.addSurfaceZone(new THREE.Box3(new THREE.Vector3(wd.x0 - 0.4, wd.y1 - 0.3, wd.z0 - 0.05), new THREE.Vector3(wd.x1, wd.y0 + 1.0, wd.z1 + 0.05)), 'wood');
    }
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Annex closing the terrace to the east: dark vertical boards and a turf roof. room-spec says «mønet langs x», but
  // the kitchen photo (ost.jpg) shows the GABLE facing the terrace: its verge runs from az −18°/e +13° down to
  // az −12°/e −3° seen from the island, i.e. from ≈ 2.6 m over the deck at x ≈ 8.6 down to ≈ 1.2 m at x ≈ 10.9 –
  // a low shed with the ridge along z (east–west) and eaves ≈ 1.3 m over the deck. Built that way.
  const an = t?.annex;
  if (an?.polygonV?.length) {
    const xs = an.polygonV.map((p) => p.x), zs = an.polygonV.map((p) => p.y);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs);
    const yb = deckY;
    const ridgeY = yb + Math.max(2.3, (an.height ?? 2.6) + 0.15);
    const over = 0.3;
    const cx = (x0 + x1) / 2;
    const half = (x1 - x0) / 2 + over;
    const eaveY = yb + 1.3;
    const pitch = Math.atan2(ridgeY - eaveY, half);
    const wallTop = (x) => ridgeY - (Math.abs(x - cx) / half) * (ridgeY - eaveY);
    // walls: a prism with the gable outline (profile in x/y) extruded along z
    const prof = [[x0, yb - 0.3], [x1, yb - 0.3], [x1, wallTop(x1)], [cx, ridgeY - 0.02], [x0, wallTop(x0)]];
    const sh = new THREE.Shape(prof.map(([x, y]) => new THREE.Vector2(x, y)));
    const wg = new THREE.ExtrudeGeometry(sh, { depth: z1 - z0, bevelEnabled: false });
    wg.translate(0, 0, z0);
    kb.add(wg, M.annex, { boxUV: true });
    wg.dispose();
    // turf roof planes (with the verge / fascia boards along the gables and the eaves)
    const len = Math.hypot(half, ridgeY - eaveY);
    const zl = z1 - z0 + 2 * over;
    for (const sgn of [-1, 1]) {
      const xc = cx + sgn * half / 2;
      const yc = (ridgeY + eaveY) / 2 + 0.09;
      kb.box(len, 0.18, zl, xc, yc, (z0 + z1) / 2, M.turf, { rot: [0, 0, -sgn * pitch], collide: false });
      for (const z of [z0 - over, z1 + over]) kb.box(len, 0.22, 0.035, xc, yc - 0.02, z, M.fascia, { rot: [0, 0, -sgn * pitch], collide: false });
      kb.box(0.035, 0.2, zl, cx + sgn * half, eaveY, (z0 + z1) / 2, M.fascia, { collide: false });
    }
    solidBoxes.push(new THREE.Box3(new THREE.Vector3(x0, yb, z0), new THREE.Vector3(x1, ridgeY, z1)));
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Terrace furniture in front of the kitchen window: grey rattan lounge chair and a small white table
  if (t?.polygonV?.length) {
    const cx = 7.35, cz = 1.05, yaw = -0.5;
    const F = kb.frame(new THREE.Matrix4().compose(new THREE.Vector3(cx, deckY, cz), new THREE.Quaternion().setFromAxisAngle(UP, yaw), new THREE.Vector3(1, 1, 1)));
    F.box(0.72, 0.36, 0.74, 0, 0.18, 0, M.rattan, { collide: false });
    F.box(0.72, 0.5, 0.12, 0, 0.58, -0.32, M.rattan, { rot: [-0.18, 0, 0], collide: false });
    for (const s of [-1, 1]) F.box(0.1, 0.24, 0.66, s * 0.31, 0.48, 0.02, M.rattan, { collide: false });
    F.box(0.54, 0.1, 0.6, 0, 0.41, 0.04, M.cushion, { collide: false });
    kb.cylinder(0.24, 0.24, 0.02, 7.45, deckY + 0.46, 2.05, M.tableTop, { segments: 28, collide: false });
    kb.cylinder(0.025, 0.025, 0.45, 7.45, deckY + 0.225, 2.05, M.tableTop, { segments: 12, collide: false });
    kb.cylinder(0.18, 0.18, 0.015, 7.45, deckY + 0.008, 2.05, M.tableTop, { segments: 24, collide: false });
    solidBoxes.push(new THREE.Box3(new THREE.Vector3(cx - 0.45, deckY, cz - 0.45), new THREE.Vector3(cx + 0.45, deckY + 0.8, cz + 0.45)));
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Ground: the lawn falling toward the river, textured by projecting the south photo from its camera centre
  // (a matte-painting projection: the same texels as the backdrop, so the two meet seamlessly from the centre, and
  // the lawn gets real depth/parallax for viewers elsewhere – in the room, on the terrace). Built once the photo is in.
  const terrain = out.terrain || {};
  const groundGeometry = () => {
    const x0 = 6.4, x1 = 64, z0 = -22, z1 = 42;
    const g = new THREE.PlaneGeometry(x1 - x0, z1 - z0, 58, 32);
    g.rotateX(-Math.PI / 2);
    g.translate((x0 + x1) / 2, 0, (z0 + z1) / 2);
    const pos = g.attributes.position;
    const yRiver = terrain.riverY ?? groundY - 2.8;
    const dBank = terrain.riverBankDistanceM ?? 60;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const t = Math.max(0, Math.min(1, (x - 10.5) / (dBank - 6)));
      const far = groundY + (yRiver - groundY + 0.4) * t * t * (3 - 2 * t);
      // next to the house the lawn is at the landing's level, then it drops to groundY within ≈ 3 m
      pos.setY(i, lerp(nearGroundY, far, smooth(nearGroundToX, nearGroundToX + 3, x)));
    }
    g.computeVertexNormals();
    return g;
  };
  // hele huset: a ground patch west of the house (z beyond the basement's west face), falling from just under the
  // basement bedroom's west window (sill y −1.68) to the lawn at x 6.4 – what win-sk sees instead of a photo
  const westGroundGeometry = () => {
    const x0 = -0.2, x1 = 6.4, z0 = 11.7, z1 = 42; // x ≥ −0.2: never in front of win-tv (glass at x −0.24)
    const g = new THREE.PlaneGeometry(x1 - x0, z1 - z0, 12, 16);
    g.rotateX(-Math.PI / 2);
    g.translate((x0 + x1) / 2, 0, (z0 + z1) / 2);
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) pos.setY(i, lerp(-1.95, nearGroundY, smooth(1.5, x1, pos.getX(i))));
    g.computeVertexNormals();
    return g;
  };

  const built = kb.build();
  group.add(built);
  built.traverse((m) => {
    if (m.isMesh) m.userData.noCollide = true;
  });
  for (const bx of solidBoxes) ctx.collision?.addStaticBox(bx);
  for (const m of collideMeshes) {
    owned.push(m.geometry, m.material);
    ctx.collision?.addStatic(m);
  }
  // deck walkable (static box) and bounds that include the terrace
  if (t?.polygonV?.length && ctx.collision) {
    const poly = t.polygonV;
    const xs = poly.map((p) => p.x), zs = poly.map((p) => p.y);
    // the polygon is an L: split at the knekk (two rectangles)
    const zK = layout.wallsById['w-knekk'] ? layout.wallsById['w-knekk'].start.y - 0.3 : Math.max(...zs);
    const xK = layout.wallsById['w-kjokken-sor'] ? layout.wallsById['w-kjokken-sor'].start.x + 0.3 : Math.min(...xs);
    const xL = layout.wallsById['w-sor'] ? layout.wallsById['w-sor'].start.x + 0.3 : xK;
    ctx.collision.addStaticBox(new THREE.Box3(new THREE.Vector3(xK, deckY - 0.2, Math.min(...zs)), new THREE.Vector3(Math.max(...xs), deckY, zK)));
    ctx.collision.addStaticBox(new THREE.Box3(new THREE.Vector3(xL, deckY - 0.2, zK), new THREE.Vector3(Math.max(...xs), deckY, Math.max(...zs))));
    if (H) {
      // (the two deck boxes above already reach the extension: the polygon goes to x 10.35 · z −0.30)
      // walking bounds: the house's rectangles + the outside one (V26). Until Collision has a list (steg 20, M2)
      // one rectangle around both; walls, the ground colliders and the paving keep the player where it can stand.
      if (typeof ctx.collision.setBoundsList === 'function') {
        const have = ctx.collision.boundsList ?? layout.house?.walkRects ?? [];
        ctx.collision.setBoundsList([...have, ...P.walkRects]);
      } else {
        const b = P.bounds;
        ctx.collision.setBounds(b.minX, b.maxX, b.minZ, b.maxZ);
      }
    } else {
      const lb = layout.bounds;
      ctx.collision.setBounds(lb.minX + 0.05, Math.max(lb.maxX, Math.max(...xs)) - 0.05, Math.max(lb.minZ, Math.min(...zs)) + 0.05, lb.maxZ - 0.05);
    }
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Photo backdrops
  const backdrops = {}; // id → { mesh, uniforms, def, ground? }
  let daylight = 1;
  let skyOverride = null;
  let disposed = false;
  let readyDone = false;
  const tmpC = new THREE.Color();
  const white = new THREE.Color(1, 1, 1);
  // decode off the main thread where possible (createImageBitmap); the bitmap is flipped at decode time
  const useBitmap = typeof createImageBitmap === 'function' && typeof THREE.ImageBitmapLoader === 'function';
  const bitmapLoader = useBitmap ? new THREE.ImageBitmapLoader().setOptions({ imageOrientation: 'flipY', premultiplyAlpha: 'none' }) : null;
  const imageLoader = useBitmap ? null : new THREE.TextureLoader();
  const high = quality.level === 'high';
  /** «lav»: the small files; «middels»: the small files except the main south view; «høy»: the full files. */
  const fileFor = (def, main) => (low || (!high && !main) ? def.fileLow || def.file : def.file);
  const loadTex = (file) =>
    new Promise((resolve) => {
      const done = (tex) => {
        if (!tex) return resolve(null);
        if (disposed) {
          tex.image?.close?.();
          tex.dispose();
          return resolve(null);
        }
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = 4;
        tex.wrapS = THREE.ClampToEdgeWrapping;
        tex.wrapT = THREE.ClampToEdgeWrapping;
        owned.push(tex);
        // upload now (during loading) instead of in the first frame that shows it
        try {
          ctx.renderer?.initTexture?.(tex);
        } catch {
          /* uploaded at first use instead */
        }
        resolve(tex);
      };
      const url = assetUrl(file);
      if (bitmapLoader) {
        bitmapLoader.load(
          url,
          (bmp) => {
            const tex = new THREE.Texture(bmp);
            tex.flipY = false; // already flipped by createImageBitmap
            tex.userData.rowsFlipped = true;
            tex.needsUpdate = true;
            done(tex);
          },
          undefined,
          () => done(null),
        );
      } else imageLoader.load(url, (tex) => done(tex), undefined, () => done(null));
    });
  /**
   * Average colour of a band of rows of a photo: 'top' = the sky where the backdrop fades out (top 6 %), 'bottom' =
   * the lawn just above the photo's bottom edge (6–19 % from the bottom: below that the terrace was painted out), for
   * the ground fallback. u0..u1 limits the columns.
   */
  const rowsColor = (tex, which = 'top', u0 = 0, u1 = 1) => {
    try {
      const c = document.createElement('canvas');
      c.width = 64;
      c.height = 32;
      const g = c.getContext('2d', { willReadFrequently: true });
      g.drawImage(tex.image, 0, 0, 64, 32);
      const fromTop = (which === 'top') !== !!tex.userData?.rowsFlipped;
      const x0 = Math.floor(u0 * 64), x1 = Math.max(x0 + 1, Math.ceil(u1 * 64));
      const top = which === 'top';
      const y0 = fromTop ? (top ? 0 : 2) : top ? 30 : 26;
      const d = g.getImageData(x0, y0, x1 - x0, top ? 2 : 4).data;
      let r = 0, gg = 0, bb = 0;
      for (let i = 0; i < d.length; i += 4) {
        r += d[i];
        gg += d[i + 1];
        bb += d[i + 2];
      }
      const n = d.length / 4;
      return new THREE.Color().setRGB(r / n / 255, gg / n / 255, bb / n / 255, THREE.SRGBColorSpace);
    } catch {
      return null;
    }
  };
  /** Fade a late photo in from the sky colour (only when it arrives after `ready`). */
  const fadeIn = (mesh, fadeUniform) => {
    if (!readyDone) {
      fadeUniform.value = 1;
      return;
    }
    const t0 = performance.now();
    fadeUniform.value = 0;
    mesh.onBeforeRender = () => {
      fadeUniform.value = Math.min(1, (performance.now() - t0) / (FADE_S * 1000));
      if (fadeUniform.value >= 1) mesh.onBeforeRender = () => {};
    };
  };

  // The kitchen photo (ost) leaves out the annex (built in 3D: ost u < 0.42–0.48 up to its roof), its soft green lower
  // part (only a fill for between the railing slats) and its soft, extended west end (u > 0.78 – beyond what k1 shows
  // from the island). Through k1/k2 the 3D annex, the south photo and the projected lawn behind show instead: k2
  // (looking SSE from the dining area) showed the annex gable where the river is, k1 seen from the bench a blur where
  // the trees west of the house are.
  const MASKS = { ost: { rect: new THREE.Vector4(0, 0.42, 0, 0.73), belowV: 0.42, rightU: 0.78 } };

  function makeBackdrop(def, tex, clip) {
    const mk = MASKS[def.id];
    const uniforms = {
      map: { value: tex },
      map2: { value: tex },
      mixK: { value: 0 },
      bright1: { value: 1 },
      bright2: { value: 1 },
      tint: { value: new THREE.Color(1, 1, 1) },
      sky: { value: sky.clone() },
      skyFade: { value: def.id === 'nord' ? 0.1 : 0.14 },
      clipOn: { value: clip ? 1 : 0 },
      planes: { value: Array.from({ length: 6 }, (_, i) => clip?.planes[i] ?? 0) },
      rects: { value: Array.from({ length: 6 }, (_, i) => clip?.rects[i] ?? new THREE.Vector4()) },
      rectCount: { value: clip?.rects.length ?? 0 },
      edgeFade: { value: clip ? 0.0001 : 0.06 },
      horizonV: { value: def.horizonV ?? 0.5 },
      ground: { value: new THREE.Color('#2f3a26') },
      maskOn: { value: mk ? 1 : 0 },
      maskRect: { value: mk ? mk.rect.clone() : new THREE.Vector4() },
      maskBelowV: { value: mk ? mk.belowV : -1 },
      maskRightU: { value: mk?.rightU ?? 2 },
      fade: { value: 1 },
    };
    const m = new THREE.ShaderMaterial({ uniforms, vertexShader: BACKDROP_VERT, fragmentShader: BACKDROP_FRAG, side: THREE.DoubleSide, depthWrite: !mk, transparent: !!mk, fog: false });
    m.name = `backdrop:${def.id}`;
    const mesh = new THREE.Mesh(keep(backdropGeometry(def, def.suggestedDistance, low ? 64 : 128)), keep(m));
    mesh.name = `backdrop:${def.id}`;
    mesh.userData.noCollide = true;
    mesh.frustumCulled = false;
    mesh.renderOrder = 1; // after the room (early-z hides most of it)
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    group.add(mesh);
    fadeIn(mesh, uniforms.fade);
    backdrops[def.id] = { mesh, uniforms, def };
    return backdrops[def.id];
  }

  let lawnDay = null;
  let lawnEve = null;
  /** The projected lawn (see GROUND_FRAG); shares the south backdrop's map/daylight/fade uniforms. */
  function makeGround(bd) {
    const u = bd.uniforms;
    const def = bd.def;
    const uniforms = {
      map: u.map, map2: u.map2, mixK: u.mixK, bright1: u.bright1, bright2: u.bright2, tint: u.tint, sky: u.sky, fade: u.fade,
      center: { value: new THREE.Vector3(...def.center) },
      azRange: { value: new THREE.Vector2(...def.azimuthDeg.map(THREE.MathUtils.degToRad)) },
      tanRange: { value: new THREE.Vector2(...def.tanElevation) },
      lawn1: { value: (lawnDay || new THREE.Color('#4d5a33')).clone() },
      lawn2: { value: (lawnEve || lawnDay || new THREE.Color('#1d2420')).clone() },
    };
    const m = keep(new THREE.ShaderMaterial({ uniforms, vertexShader: BACKDROP_VERT, fragmentShader: GROUND_FRAG }));
    m.name = 'ground-projected';
    const mesh = new THREE.Mesh(keep(groundGeometry()), m);
    mesh.name = 'ground';
    mesh.userData.noCollide = true;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.renderOrder = 1;
    group.add(mesh);
    bd.ground = { mesh, uniforms };
    if (H) {
      const west = new THREE.Mesh(keep(westGroundGeometry()), m);
      west.name = 'ground-west';
      west.userData.noCollide = true;
      west.castShadow = false;
      west.receiveShadow = false;
      west.renderOrder = 1;
      group.add(west);
    }
  }

  /**
   * Window clip for a backdrop: the glass planes of its windows (walls along z), up to six rectangles. Windows of
   * the whole house (layout.house, e.g. win-vask under win-tv in «nord») get the glass plane of their own wall line;
   * windows in the same line share the first one's plane (as before: the living room's views are unchanged).
   */
  function clipFor(def) {
    const ids = def.windows || [];
    const byId = layout.house?.openingsById || layout.openingsById;
    const ops = ids.map((id) => layout.openingsById[id] || byId[id]).filter(Boolean).slice(0, 6);
    if (!ops.length || ops.some((o) => Math.abs(o.normal.x) < 0.99)) return null;
    const lines = [];
    const planes = ops.map((o) => {
      const line = lines.find((l) => Math.abs(l.x - o.center.x) < 0.01 && Math.sign(l.n) === Math.sign(o.normal.x));
      if (line) return line.planeX;
      const planeX = o.center.x - o.normal.x * (o.revealDepth + 0.035);
      lines.push({ x: o.center.x, n: o.normal.x, planeX });
      return planeX;
    });
    const rects = ops.map((o) => {
      const zs = o.corners.map((c) => c.z), ys = o.corners.map((c) => c.y);
      return new THREE.Vector4(Math.min(...zs), Math.max(...zs), Math.min(...ys), Math.max(...ys));
    });
    return { planes, rects };
  }

  let skyFromPhotoDay = null;
  let skyFromPhotoEve = null;
  let eveDef = null;
  let eveRequested = false;
  /** The blue-hour photo is only fetched once the daylight gets near the cross-fade (≤ 0.55). */
  function maybeLoadEvening() {
    if (eveRequested || disposed || !eveDef || !backdrops.sor || daylight > 0.55) return;
    eveRequested = true;
    loadTex(fileFor(eveDef, false)).then((tex) => {
      const bd = backdrops.sor;
      if (!tex || !bd) return;
      bd.uniforms.map2.value = tex;
      skyFromPhotoEve = rowsColor(tex, 'top');
      lawnEve = rowsColor(tex, 'bottom', 0.3, 0.7);
      if (lawnEve && bd.ground) bd.ground.uniforms.lawn2.value.copy(lawnEve);
      applyDaylight();
    });
  }
  const dayPhotos = fetch(assetUrl('img/utsikt/backdrops.json'))
    .then((r) => (r.ok ? r.json() : null))
    .then(async (data) => {
      if (disposed) return;
      const list = data?.backdrops || [];
      const byId = Object.fromEntries(list.map((b) => [b.id, b]));
      eveDef = byId['sor-kveld'] || null;
      const jobs = [];
      for (const id of ['sor', 'ost', 'nord']) {
        const def = byId[id];
        if (!def) continue;
        const clip = id === 'sor' ? null : clipFor(def);
        if (id !== 'sor' && !clip) continue; // without a clip they would hang in front of the south view
        jobs.push(
          loadTex(fileFor(def, id === 'sor')).then((tex) => {
            if (!tex || disposed) return;
            const bd = makeBackdrop(def, tex, clip);
            if (id === 'sor') {
              skyFromPhotoDay = rowsColor(tex, 'top');
              lawnDay = rowsColor(tex, 'bottom', 0.3, 0.7);
              makeGround(bd);
            }
            applyDaylight();
            maybeLoadEvening();
          }),
        );
      }
      await Promise.all(jobs);
    })
    .catch((err) => console.warn('[exterior] backdrops not loaded', err));
  // createHome awaits this: the day photos, but never longer than READY_CAP_MS (late photos fade in when they arrive)
  const ready = Promise.race([dayPhotos, new Promise((r) => setTimeout(r, READY_CAP_MS))]).then(() => {
    readyDone = true;
  });

  // ---------------------------------------------------------------------------------------------------------------
  // Sky light for the 3D exterior (add-lighting): a two-colour dome (sky above, garden/deck below) turned into a PMREM
  // environment of the room environment's size (same shader programs), set as envMap on the exterior's own materials.
  // Its hue changes slowly (rebuilt only then); the level goes into envMapIntensity.
  const outdoor = { scene: null, sky: null, ground: null, cube: null, cam: null, rt: null, pmrem: null, size: 0, key: '' };
  const _hue = new THREE.Color();
  const _gnd = new THREE.Color();
  function applyOutdoor(light) {
    const r = ctx.renderer;
    if (!r || !light?.sky || disposed) return;
    const L = Math.max(1e-6, 0.2126 * light.sky.r + 0.7152 * light.sky.g + 0.0722 * light.sky.b);
    _hue.copy(light.sky).multiplyScalar(1 / L);
    _gnd.copy(light.ground || light.sky).multiplyScalar(1 / L);
    const q = (c) => [c.r, c.g, c.b].map((v) => Math.round(Math.log(Math.max(1e-4, v)) * 40)).join(',');
    const size = Math.max(16, light.envSize || 64);
    const key = `${size}|${q(_hue)}|${q(_gnd)}`;
    if (key !== outdoor.key) {
      try {
        if (!outdoor.scene) {
          outdoor.scene = new THREE.Scene();
          const half = (t0) => {
            const g = keep(new THREE.SphereGeometry(10, 24, 8, 0, Math.PI * 2, t0, Math.PI / 2));
            const m = keep(new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.DoubleSide, toneMapped: false }));
            outdoor.scene.add(new THREE.Mesh(g, m));
            return m;
          };
          outdoor.sky = half(0);
          outdoor.ground = half(Math.PI / 2);
        }
        if (outdoor.size !== size) {
          outdoor.cube?.dispose();
          outdoor.cube = new THREE.WebGLCubeRenderTarget(size, { type: THREE.HalfFloatType, generateMipmaps: false, depthBuffer: true });
          outdoor.cam = new THREE.CubeCamera(0.1, 50, outdoor.cube);
          outdoor.rt?.dispose();
          outdoor.rt = null;
          outdoor.size = size;
        }
        outdoor.sky.color.copy(_hue);
        outdoor.ground.color.copy(_gnd);
        outdoor.pmrem ??= new THREE.PMREMGenerator(r);
        const cc = r.getClearColor(tmpC).getHex(), ca = r.getClearAlpha(), tm = r.toneMapping, target = r.getRenderTarget();
        r.setClearColor(0x000000, 1);
        r.toneMapping = THREE.NoToneMapping;
        outdoor.cam.update(r, outdoor.scene);
        r.setClearColor(cc, ca);
        r.toneMapping = tm;
        outdoor.rt = outdoor.pmrem.fromCubemap(outdoor.cube.texture, outdoor.rt);
        r.setRenderTarget(target);
        for (const m of litMats) m.envMap = outdoor.rt.texture;
        outdoor.key = key;
      } catch (err) {
        console.warn('[exterior] sky environment failed', err);
        outdoor.key = key;
        return;
      }
    }
    for (const m of litMats) m.envMapIntensity = m.userData.envBase * L;
  }

  function applyDaylight() {
    const L = daylight;
    const k = 1 - smooth(0.22, 0.5, L); // 0 = day photo … 1 = blue-hour photo
    const b1 = lerp(0.5, 1.0, smooth(0.3, 0.9, L));
    const b2 = lerp(0.16, 1.0, smooth(0.02, 0.25, L));
    // sky colour behind/above the photos
    if (skyOverride) sky.copy(skyOverride);
    else {
      const d = (skyFromPhotoDay || daySky).clone().multiplyScalar(b1);
      const e = (skyFromPhotoEve || eveSky).clone().multiplyScalar(b2);
      sky.copy(d).lerp(e, k);
    }
    // a light tint from the sky colour (when given)
    const tint = white.clone();
    if (skyOverride) {
      tmpC.copy(skyOverride);
      const mx = Math.max(tmpC.r, tmpC.g, tmpC.b, 1e-4);
      tmpC.multiplyScalar(1 / mx);
      tint.lerp(tmpC, 0.12);
    }
    for (const bd of Object.values(backdrops)) {
      const u = bd.uniforms;
      u.sky.value.copy(sky);
      u.ground.value.setRGB(0.028, 0.04, 0.019).multiplyScalar(lerp(0.2, 1, smooth(0.05, 0.6, L)));
      if (bd.def.id === 'sor') {
        u.mixK.value = k;
        u.bright1.value = b1;
        u.bright2.value = b2;
        u.tint.value.copy(tint);
      } else {
        // no evening photo: darker and bluer toward the evening
        const b = lerp(0.12, 1.0, smooth(0.04, 0.75, L));
        u.mixK.value = 0;
        u.bright1.value = b;
        u.tint.value.copy(tint).lerp(new THREE.Color(0.62, 0.7, 0.95), k * 0.8);
      }
    }
    if (ctx.scene) {
      if (ctx.scene.background?.isColor) ctx.scene.background.copy(sky);
      else ctx.scene.background = sky.clone();
    }
  }

  return {
    group,
    ready,
    /**
     * Daylight 0..1 dims the photos and sets the sky: ≥ 0.5 the morning photo (full at ≥ 0.9), 0.5 → 0.22 cross-fade
     * to the blue-hour photo, below 0.25 it darkens toward night (× 0.16 at 0). skyHex (optional) sets the sky colour
     * and tints the photos slightly.
     * @param {number} level
     * @param {string} [skyHex]
     * @param {{ sky: THREE.Color, ground?: THREE.Color, envSize?: number }} [light]  sky light for the 3D exterior
     */
    setDaylight(level, skyHex, light) {
      daylight = Math.max(0, Math.min(1, Number.isFinite(level) ? level : 1));
      skyOverride = skyHex ? new THREE.Color(skyHex) : null;
      applyDaylight();
      maybeLoadEvening();
      if (light) applyOutdoor(light);
    },
    dispose() {
      disposed = true;
      outdoor.cube?.dispose();
      outdoor.rt?.dispose();
      outdoor.pmrem?.dispose();
      group.removeFromParent();
      for (const g of kb.geometries) g.dispose();
      for (const o of owned) {
        if (o.isTexture) o.image?.close?.();
        o.dispose?.();
      }
    },
  };
}
