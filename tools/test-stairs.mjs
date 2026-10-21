#!/usr/bin/env node
/**
 * M2 – the stair walk test (notes/hele-huset-design.md §7.3, steg 20; numbers from notes/hele-huset-avstemming.md
 * V12–V23 / §2.1–2.4 through room-spec.json). Node, no browser: the real CollisionWorld and PlayerController (both
 * DOM-free) driven with fake input at a fixed frame rate, on the stair of layout.house.
 *
 *   node tools/test-stairs.mjs            (from anywhere; exit code 1 on failure)
 *   node tools/test-stairs.mjs --verbose  (one line per run with all the numbers)
 *   node tools/test-stairs.mjs --stairs=<path>   another stairs module for stairLayout / stairColliders /
 *                                         slabColliders (e.g. the pure commit of steg 19 before it is merged)
 *
 * The world: the stair's colliders (src/home/stairs.js stairColliders(stairLayout(…)) and slabColliders(layout,
 * 'hoved')) – while those are still the stubs of steg 6 (they return []), the test's own copy below: the invisible
 * closed wedge of §3.1 along the walk line of house.mjs stairWalk (V13), from the top nosing (y 0) to the basement floor
 * at the lowest nosing (the last segment ends on the floor), the winders a helicoid (level along the radials from the
 * well corners) on a 2.5 cm grid, vertical sides; the slab y −0.30…0 under the ground floor minus the hole, guards
 * A/B/C and the well (eye) column up to 1.0. Always added: the basement floor (−2.55), the shaft walls (north x 0 above
 * the ledge −0.27 and x 0.13 below, east z 2.22–2.32 with the niche, west z 4.43–4.55), the hall's ceiling (2.40) and
 * the living room's floor.
 *
 * Scenarios (each at 30, 60 and 144 Hz): down from the top and up from the bottom (walking, running, crouched), an
 * oblique entry (30°) at the top and at the foot, stopping in the stair (5 places, no sliding for 2 s), jumping on the
 * stair and under the slab in front of the foot. The player steers along the walk line (pure pursuit 0.3 m ahead plus
 * the cross-track error). The control runs (printed, not counted) walk the same stair with CollisionWorld.faceGround
 * off – the summed octree normal of before steg 20, which shoves on the winders and stalls walking up.
 * Requirements (§7.3):
 *   - end y −2.55 ± 0.02 going down, 0 ± 0.02 going up;
 *   - |Δy| per frame ≤ 1.3 · v · dt · tan θ + 4 mm (v = the gait's speed; θ = the validator's slope, or the wedge's
 *     own 41.6° when steeper – see THETA; the 4 mm is one resolve's rounding, it only matters at 144 Hz);
 *   - airborne in < 2 % of the frames, no 'land' event over 1.5 m/s, no respawn toast;
 *   - the head never above the slab's underside outside the hole (no capsule point of the upper half within the
 *     radius − 2 cm of the slab region);
 *   - the time from the top nosing to the lowest one within 0.7–1.3 × walk length / (v × 0.78).
 * Then the levels (§3.4–3.5, §3.7): Game._setupLevels (walkable rectangles per level and the forecourt, the floor
 * field), isWalkable / groundHeight on −2.55 / −2.85 / −2.87, the safe point kept in the basement, respawn after a
 * fall, the reserve spawns, and Game._freeFloor on every level – in the living room identical to the old code.
 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { imp, readJson, near } from './house-tests/_lib.mjs';

const VERBOSE = process.argv.includes('--verbose');
const THREE = await import('three');
const { CollisionWorld } = await imp('src/core/Collision.js');
const { PlayerController, MOVE } = await imp('src/player/PlayerController.js');
const { PLAYER } = await imp('src/config.js');
const { layout } = await imp('src/home/layout.js');
const house = await imp('src/data/scripts/house.mjs');
const stairsArg = process.argv.find((a) => a.startsWith('--stairs='))?.slice('--stairs='.length);
const stairsMod = await (stairsArg ? import(pathToFileURL(path.resolve(stairsArg)).href) : imp('src/home/stairs.js'));
if (stairsArg) console.log(`(trappemodul: ${stairsArg})`);
const { Game } = await imp('src/core/Game.js');

let passes = 0;
let failures = 0;
const section = (name) => console.log(`\n— ${name}`);
function check(name, ok, detail = '') {
  if (ok) passes++;
  else failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `  (${detail})` : ''}`);
  return !!ok;
}
const f2 = (v) => (Number.isFinite(v) ? v.toFixed(2) : String(v));
const f3 = (v) => (Number.isFinite(v) ? v.toFixed(3) : String(v));
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const box = (x0, y0, z0, x1, y1, z1) => new THREE.Box3(V(x0, y0, z0), V(x1, y1, z1));
const RATES = [30, 60, 144];

// ---------------------------------------------------------------------------------------------------------------
// data: the stair, its levels and hole, the validator's numbers

const H = layout.house;
const spec = readJson('src/data/room-spec.json');
const specStair = (spec.stairs || [])[0];
const stair = H.stairs.find((s) => s.id === specStair?.id);
if (!specStair || !stair) {
  console.log('FAIL: ingen trapp i room-spec.json / layout.house.stairs');
  process.exit(1);
}
const upper = H.levelsById[stair.toLevel];
const lower = H.levelsById[stair.fromLevel];
const hole = H.floorOpenings.find((fo) => fo.id === stair.openingId);
const holePoly = hole.polygon.map((p) => [p.x, p.y]);
const slabUnder = upper.floorY - upper.slabThickness; // −0.30
const TOP = upper.floorY;
const BOTTOM = lower.floorY;
const RISE = TOP - BOTTOM;
const report = house.validateHouse(spec, { registry: house.loadRegistry(), throw: false });
const vStair = report.stairs.find((s) => s.id === stair.id);
const walk = house.stairWalk(specStair, { bound: specStair.footprint });
const L = walk.length;
/**
 * θ of the |Δy| bound (§7.3: «θ fra validatoren»): the validator's riser / going (39.3°), or the wedge's own slope when
 * that is steeper – the wedge ends on the floor at the lowest nosing, so it falls 13 risers over 12 goings (41.6°).
 */
const THETA = Math.max((vStair.slopeDeg * Math.PI) / 180, Math.atan2(RISE, L));
/** Plus 4 mm per frame: one resolve's rounding at the foot and the top (it is 1.0–1.2× the bound at 144 Hz only). */
const DY_EPS = 0.004;

section('Trappa og tallene fra validatoren');
console.log(`  ${stair.id}: ${vStair.risers} opptrinn à ${f3(vStair.riser)}, inntrinn ${f3(vStair.going)} (ganglinje ${f3(L)} m), 2r+g ${f3(vStair.twoRG)}, θ ${vStair.slopeDeg.toFixed(1)}°`);
console.log(`  fri høyde: minst ${f2(vStair.minHeadroom)} (validatoren), kapselen trenger ${f3(vStair.capsuleHeadroom)} (1,2 + 0,6/cos θ); kilen har ${(Math.atan2(RISE, L) * 180 / Math.PI).toFixed(1)}° (${f2(RISE)} over ${f3(L)})`);
check('opptrinn × antall = etasjehøyden', near(vStair.riser * vStair.risers, RISE, 1e-9), `${vStair.risers} × ${f3(vStair.riser)} = ${f3(vStair.riser * vStair.risers)}`);
check('kapselen får plass under dekket (fri høyde ≥ det kapselen trenger)', vStair.minHeadroom >= vStair.capsuleHeadroom, `${f2(vStair.minHeadroom)} ≥ ${f3(vStair.capsuleHeadroom)}`);
check('house.ceilingHeightAt(3.5, 3.8, −2.55) = −0,30 (kjellertaket er dekkets underside)', near(H.ceilingHeightAt(3.5, 3.8, -2.55), slabUnder, 1e-6), f3(H.ceilingHeightAt(3.5, 3.8, -2.55)));

// ---------------------------------------------------------------------------------------------------------------
// the test's own copy of stairColliders / slabColliders (used while src/home/stairs.js is the steg-6 stub)

const add2 = (a, b) => [a[0] + b[0], a[1] + b[1]];
const mul2 = (a, k) => [a[0] * k, a[1] * k];
const inPoly = (p, poly) => house.pointInPolygon(p, poly);

/**
 * Height of the wedge along the walk line (§3.1): from the top nosing on the upper floor straight down to the lowest
 * nosing on the lower floor (the last step ends on the floor), 13 risers over 12 goings: 41.6°.
 */
const wedgeY = (u) => TOP - RISE * Math.min(1, Math.max(0, u / L));

/**
 * Walk-line parameter u of a plan point of the stair: the cross-section of the V13 walk line through it (the flights:
 * square to the flight; the winders: the radial from the well corner – the height is a function of the angle; the
 * strip over the north end: square to it). null in the well.
 */
const walkParamAt = (() => {
  const seg = walk.segments;
  const sub2 = (a, b) => [a[0] - b[0], a[1] - b[1]];
  const dot2 = (a, b) => a[0] * b[0] + a[1] * b[1];
  const cross2 = (a, b) => a[0] * b[1] - a[1] * b[0];
  const unit2 = (a) => mul2(a, 1 / Math.hypot(a[0], a[1]));
  if (!walk.A || seg?.length !== 5) {
    // straight stair (or another walk line): along the line from the top nosing
    return (x, z) => Math.max(0, Math.min(L, dot2(sub2([x, z], walk.P0), walk.d1)));
  }
  const { A, B, P0, P1, P2, d1, d2, r1, r2, r3 } = walk;
  const e = unit2(sub2(B, A));
  const f1 = unit2(sub2(P1, A));
  const f3 = unit2(sub2(P2, B));
  const da1 = Math.atan2(cross2(f1, d1), dot2(f1, d1));
  const da3 = Math.atan2(cross2(d1, f3), dot2(d1, f3));
  const perp = (d) => [-d[1], d[0]];
  const E = 1e-6;
  // a straight part: along its line within the flight's half width (the first one also beyond the top nosing, the
  // last one beyond the lowest)
  const line = (o, d, hw, s, open0, open1) => (p) => {
    const q = sub2(p, o);
    if (Math.abs(dot2(q, perp(d))) > hw + 0.02) return null;
    const t = dot2(q, d) / s.length;
    return (t >= -E || open0) && (t <= 1 + E || open1) ? t : null;
  };
  const arc = (C, from, da, s) => (p) => {
    const q = sub2(p, C);
    const t = Math.atan2(cross2(from, q), dot2(from, q)) / da;
    return t >= -E && t <= 1 + E ? t : null;
  };
  const parts = [
    [line(P0, d1, r1, seg[0], true, false), seg[0]],
    [arc(A, f1, da1, seg[1]), seg[1]],
    [line(add2(A, mul2(d1, r2)), e, r2, seg[2], false, false), seg[2]],
    [arc(B, d1, da3, seg[3]), seg[3]],
    [line(P2, d2, r3, seg[4], false, true), seg[4]],
  ];
  return (x, z) => {
    for (const [f, s] of parts) {
      const t = f([x, z]);
      if (t !== null) return s.start + Math.max(0, Math.min(1, t)) * s.length;
    }
    return null;
  };
})();

/**
 * The closed invisible wedge (§3.1) as one mesh: the top surface y = wedgeY(walkParamAt(x, z)) on a 2.5 cm grid whose
 * lines hold every corner of the footprint (so each cell is inside or outside it), vertical sides down to the lower
 * floor along the footprint's edges (the back under the top nosing, the well, the open side of the lower flight).
 */
function ownStairColliders() {
  const footprint = specStair.footprint;
  const lines = (vals) => {
    const v = [...new Set(vals.map((a) => +a.toFixed(6)))].sort((a, b) => a - b);
    const out = [v[0]];
    for (let i = 0; i + 1 < v.length; i++) {
      const n = Math.max(1, Math.ceil((v[i + 1] - v[i]) / 0.025));
      for (let k = 1; k <= n; k++) out.push(v[i] + ((v[i + 1] - v[i]) * k) / n);
    }
    return out;
  };
  const xs = lines(footprint.map((p) => p[0]));
  const zs = lines(footprint.map((p) => p[1]));
  const inside = (i, j) => i >= 0 && j >= 0 && i < xs.length - 1 && j < zs.length - 1 && inPoly([(xs[i] + xs[i + 1]) / 2, (zs[j] + zs[j + 1]) / 2], footprint);
  const hY = xs.map((x) => zs.map((z) => {
    const u = walkParamAt(x, z);
    return u === null ? null : wedgeY(u);
  }));
  const pos = [];
  const tri = (p, q, r, want) => {
    const e1 = [q[0] - p[0], q[1] - p[1], q[2] - p[2]];
    const e2 = [r[0] - p[0], r[1] - p[1], r[2] - p[2]];
    const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const len = Math.hypot(...n);
    if (len < 1e-10) return;
    const dot = n[0] * want[0] + n[1] * want[1] + n[2] * want[2];
    if (dot < 0) pos.push(...p, ...r, ...q);
    else pos.push(...p, ...q, ...r);
  };
  const P = (i, j, y) => [xs[i], y ?? hY[i][j], zs[j]];
  // top surface (normals up)
  for (let i = 0; i < xs.length - 1; i++) {
    for (let j = 0; j < zs.length - 1; j++) {
      if (!inside(i, j)) continue;
      tri(P(i, j), P(i + 1, j), P(i + 1, j + 1), [0, 1, 0]);
      tri(P(i, j), P(i + 1, j + 1), P(i, j + 1), [0, 1, 0]);
    }
  }
  // vertical sides from the lower floor up to the surface on every grid edge between a cell inside and one outside,
  // facing out of the footprint
  const side = (i0, j0, i1, j1, out) => {
    const y0 = hY[i0][j0], y1 = hY[i1][j1];
    if (y0 - BOTTOM < 1e-6 && y1 - BOTTOM < 1e-6) return;
    tri(P(i0, j0, BOTTOM), P(i1, j1, BOTTOM), P(i1, j1), out);
    tri(P(i0, j0, BOTTOM), P(i1, j1), P(i0, j0), out);
  };
  for (let i = 0; i < xs.length - 1; i++) {
    for (let j = 0; j < zs.length; j++) {
      // the edge (i, j)–(i+1, j) between the cells (i, j−1) and (i, j)
      const a = inside(i, j - 1), b = inside(i, j);
      if (a !== b) side(i, j, i + 1, j, [0, 0, a ? 1 : -1]);
    }
  }
  for (let j = 0; j < zs.length - 1; j++) {
    for (let i = 0; i < xs.length; i++) {
      const a = inside(i - 1, j), b = inside(i, j);
      if (a !== b) side(i, j, i, j + 1, [a ? 1 : -1, 0, 0]);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const mesh = new THREE.Mesh(g);
  mesh.name = 'test-stair-wedge';
  return [mesh];
}

/** The slab under the upper level minus the hole (axis-aligned bands), the guards on the hole and the well column. */
function ownSlabColliders() {
  const out = [];
  const x0 = -0.3, x1 = 3.12, z0 = 0, z1 = 8.2; // around the stair: the bathroom, the hall and the bedroom
  const zs = [...new Set(holePoly.map((p) => p[1]))].sort((a, b) => a - b);
  const bands = [[z0, zs[0]], ...zs.slice(0, -1).map((z, i) => [z, zs[i + 1]]), [zs[zs.length - 1], z1]];
  for (const [za, zb] of bands) {
    if (zb - za < 1e-9) continue;
    const zm = (za + zb) / 2;
    // the hole's x intervals at zm (even-odd crossings)
    const xs = [];
    for (let i = 0, j = holePoly.length - 1; i < holePoly.length; j = i++) {
      const [ax, az] = holePoly[i], [bx, bz] = holePoly[j];
      if (az > zm !== bz > zm) xs.push(ax + ((zm - az) * (bx - ax)) / (bz - az));
    }
    xs.sort((a, b) => a - b);
    let x = x0;
    for (let k = 0; k + 1 < xs.length; k += 2) {
      if (xs[k] > x) out.push(box(x, slabUnder, za, xs[k], TOP, zb));
      x = Math.max(x, xs[k + 1]);
    }
    if (x1 > x) out.push(box(x, slabUnder, za, x1, TOP, zb));
  }
  const gs = specStair.guardStyle || {};
  const gh = gs.height ?? 1.0;
  for (const g of specStair.guards || []) {
    if (Array.isArray(g.line)) {
      const [[ax, az], [bx, bz]] = g.line;
      const t = 0.03;
      out.push(box(Math.min(ax, bx) - t, TOP, Math.min(az, bz) - t, Math.max(ax, bx) + t, TOP + gh, Math.max(az, bz) + t));
    } else if (g.on === 'well') {
      const w = specStair.well.polygon;
      out.push(box(Math.min(...w.map((p) => p[0])), BOTTOM, Math.min(...w.map((p) => p[1])), Math.max(...w.map((p) => p[0])), TOP + gh, Math.max(...w.map((p) => p[1]))));
    }
  }
  return out;
}

/** Shaft walls, the basement floor and the hall ceiling (the room builders are not Node-testable). */
function surroundings() {
  const ledgeTop = specStair.ledge?.top ?? -0.27;
  const ledgeX = specStair.ledge?.x?.[1] ?? 0.13;
  return [
    box(0.13, BOTTOM - 0.3, 0.13, 5.75, BOTTOM, 5.23), // the basement floor (kjeller-gang, bod-1, the niche)
    box(-0.3, ledgeTop, 0, 0, 2.4, 8.2), // north wall above the ledge (x 0)
    box(-0.3, BOTTOM - 0.3, 0, ledgeX, ledgeTop, 8.2), // north wall of the basement (x 0.13), its top is the ledge
    box(-0.3, slabUnder, 2.22, 3.12, 2.4, 2.32), // w-bad-gang (east side of the hall)
    box(ledgeX, BOTTOM - 0.3, 2.22, 1.85, slabUnder, 2.32), // the niche wall in the basement (z 2.32, x < 1.85)
    box(1.85, BOTTOM - 0.3, 2.22, 5.75, slabUnder, 2.56), // bod-2 side: the corridor's east wall z 2.56 for x ≥ 1.85
    box(-0.3, BOTTOM - 0.3, 4.43, 3.12, 2.4, 4.53), // the west wall of the shaft / w-gang-sov
    box(ledgeX, BOTTOM - 0.3, 4.43, 3.05, slabUnder, 4.55), // the laundry's wall in the basement (z 4.43–4.55)
    box(-0.3, 2.4, 2.22, 3.12, 2.7, 4.53), // the hall ceiling
    box(3.12, slabUnder, 0, 6.92, TOP, 11.93), // the living room's floor (past the hall's door)
  ];
}

const realLay = stairsMod.stairLayout(stair, H.levels);
const realStair = stairsMod.stairColliders(realLay) || [];
const realSlab = stairsMod.slabColliders(layout, upper.id) || [];
const useOwnStair = !realStair.length;
const useOwnSlab = !realSlab.length;
section('Kollisjonen');
console.log(`  trappekilen: ${useOwnStair ? 'testens egen kopi (stairs.js er fortsatt stubben fra steg 6)' : `${stairsArg ?? 'src/home/stairs.js'} stairColliders (${realStair.length})`}`);
console.log(`  dekke og rekkverk: ${useOwnSlab ? 'testens egen kopi (stairs.js slabColliders er stubben)' : `${stairsArg ?? 'src/home/stairs.js'} slabColliders (${realSlab.length})`}`);

function addColliders(col, list) {
  for (const c of list) {
    if (!c) continue;
    if (c.isBox3) col.addStaticBox(c);
    else col.addStatic(c);
  }
}

function stairWorld({ faceGround = true } = {}) {
  const col = new CollisionWorld();
  col.faceGround = faceGround;
  addColliders(col, useOwnStair ? ownStairColliders() : realStair);
  addColliders(col, useOwnSlab ? ownSlabColliders() : realSlab);
  addColliders(col, surroundings());
  col.build();
  return col;
}

const world = stairWorld();
console.log(`  ${world.triangleCount} trekanter`);
{
  // the wedge's surface along the walk line (raycast) against the height it should have
  const ray = new THREE.Ray(V(0, 0, 0), V(0, -1, 0));
  let worst = 0;
  for (let u = 0.02; u < L - 0.02; u += 0.05) {
    const p = walk.at(u).p;
    ray.origin.set(p[0], 1.5, p[1]);
    const hit = world.raycast(ray, 5, { includeDynamic: false });
    worst = Math.max(worst, hit ? Math.abs(hit.point.y - wedgeY(u)) : Infinity);
  }
  check('kileflaten følger ganglinja (y = −2,55 · u / lengden, ovenfra)', worst < 0.01 || !useOwnStair, `største avvik ${f3(worst)} m`);
}

// ---------------------------------------------------------------------------------------------------------------
// walking along the walk line

const SAMPLES = [];
for (let u = -2; u <= L + 2 + 1e-9; u += 0.005) SAMPLES.push({ u, p: walk.at(u).p });
function nearestU(x, z, around) {
  let best = null, bd = Infinity;
  for (const s of SAMPLES) {
    if (around != null && Math.abs(s.u - around) > 0.6) continue;
    const d = (s.p[0] - x) ** 2 + (s.p[1] - z) ** 2;
    if (d < bd) {
      bd = d;
      best = s.u;
    }
  }
  return best;
}
const yawToward = (dx, dz) => Math.atan2(-dx, -dz);

/**
 * Penetration of the capsule's upper half into the slab region (y slabUnder…TOP, outside the hole): the largest
 * (radius − distance) over sample points on the upper half of the axis. ≤ 0: clear.
 */
function headPenetration(cap) {
  let worst = -Infinity;
  const r = cap.radius;
  for (let k = 0; k <= 8; k++) {
    const t = 0.5 + k / 16;
    const c = cap.start.clone().lerp(cap.end, t);
    if (c.y > TOP + r || c.y < slabUnder - r) continue;
    const inHole = inPoly([c.x, c.z], holePoly);
    let dist;
    if (!inHole) {
      dist = c.y >= slabUnder && c.y <= TOP ? -1 : c.y < slabUnder ? slabUnder - c.y : c.y - TOP;
    } else {
      let dh = Infinity;
      for (let i = 0, j = holePoly.length - 1; i < holePoly.length; j = i++) dh = Math.min(dh, house.distPointSeg([c.x, c.z], holePoly[i], holePoly[j]));
      const dy = c.y < slabUnder ? slabUnder - c.y : c.y > TOP ? c.y - TOP : 0;
      dist = Math.hypot(dh, dy);
    }
    worst = Math.max(worst, r - dist);
  }
  return worst;
}

function makePlayer(col) {
  const input = { move: { forward: 0, right: 0 }, running: false, crouch: false, jumpPressed: false, lookDelta: { x: 0, y: 0 }, turn: 0 };
  const events = [];
  const player = new PlayerController({
    camera: new THREE.PerspectiveCamera(),
    collision: col,
    input,
    settings: { get: () => undefined },
    events: { emit: (name, data) => events.push({ name, data }) },
  });
  return { player, input, events };
}

/**
 * Walk the stair. dir 'down' starts on the hall floor in front of the top nosing, 'up' on the basement floor in front
 * of the foot. heading [dx, dz]: walk straight that way until `straightFor` metres of walk line past the flight's edge,
 * then steer. stopAtU: let go of W there and stand `hold` s. jumpAtU: press Space once there.
 */
function drive(col, { hz, dir = 'down', gait = 'walk', start, heading = null, straightFor = 0, stopAtU = null, hold = 2, jumpAtU = null, maxSeconds = 14 }) {
  const { player, input, events } = makePlayer(col);
  const down = dir === 'down';
  const sign = down ? 1 : -1;
  const running = gait === 'run';
  const crouch = gait === 'crouch';
  const speed = running ? PLAYER.runSpeed : crouch ? PLAYER.walkSpeed * MOVE.crouchSpeedFactor : PLAYER.walkSpeed;
  const startPos = start ?? (down ? [walk.at(-0.95).p[0], TOP, walk.at(-0.95).p[1]] : [walk.at(L + 0.8).p[0], BOTTOM, walk.at(L + 0.8).p[1]]);
  let u = nearestU(startPos[0], startPos[2]);
  const look = walk.at(u + sign * 0.3).p;
  const yaw0 = heading ? yawToward(heading[0], heading[1]) : yawToward(look[0] - startPos[0], look[1] - startPos[2]);
  player.teleport(V(...startPos), yaw0, 0);
  input.crouch = crouch;
  for (let i = 0; i < 12; i++) player.update(1 / hz); // settle (and crouch down)
  events.length = 0;
  input.running = running;
  input.move.forward = 1;
  const dt = 1 / hz;
  const frames = [];
  const edgeU = down ? 0 : L;
  let steering = !heading;
  let stopped = null;
  let jumped = false;
  let t0 = null, t1 = null;
  let maxPen = -Infinity;
  let maxHead = -Infinity;
  for (let i = 0; i < Math.round(maxSeconds * hz); i++) {
    const p0 = player.position.clone();
    u = nearestU(p0.x, p0.z, u);
    if (!steering && sign * (u - edgeU) >= straightFor) steering = true;
    if (steering && !stopped) {
      // pure pursuit 0.3 m ahead on the walk line, plus the cross-track error (it would cut the winders inside)
      const tgt = walk.at(u + sign * 0.3).p;
      const on = walk.at(u).p;
      player.yaw = yawToward(tgt[0] + (on[0] - p0.x) - p0.x, tgt[1] + (on[1] - p0.z) - p0.z);
    }
    if (stopAtU != null && !stopped && sign * (u - stopAtU) >= 0) {
      input.move.forward = 0;
      stopped = { i, u, pos: p0.clone() };
    }
    input.jumpPressed = jumpAtU != null && !jumped && sign * (u - jumpAtU) >= 0;
    if (input.jumpPressed) jumped = true;
    player.update(dt);
    const p = player.position;
    const uNow = nearestU(p.x, p.z, u);
    if (t0 === null && sign * (uNow - (down ? 0 : L)) >= 0) t0 = i * dt;
    if (t1 === null && sign * (uNow - (down ? L : 0)) >= 0) t1 = i * dt;
    maxPen = Math.max(maxPen, headPenetration(player.capsule));
    maxHead = Math.max(maxHead, player.capsule.end.y + player.capsule.radius);
    frames.push({ i, x: p.x, y: p.y, z: p.z, dx: p.x - p0.x, dy: p.y - p0.y, dz: p.z - p0.z, onGround: player.onGround, u: uNow });
    if (stopped && i - stopped.i >= Math.round(hold * hz)) break;
    if (!stopped && stopAtU == null && sign * (uNow - (down ? L + 0.6 : -0.6)) >= 0) {
      // a few more frames on the floor beyond the end
      if (!frames.endAt) frames.endAt = i;
      if (i - frames.endAt >= Math.round(0.25 * hz)) break;
    }
  }
  return { player, frames, events, speed, t0, t1, stopped, maxPen, maxHead, dt };
}

const lands = (r) => r.events.filter((e) => e.name === 'land');
const toasts = (r) => r.events.filter((e) => e.name === 'toast');

function judgeWalk(label, r, { endY, timing = true }) {
  const fr = r.frames;
  const last = fr[fr.length - 1];
  const bound = 1.3 * r.speed * r.dt * Math.tan(THETA) + DY_EPS;
  const maxDy = Math.max(...fr.map((f) => Math.abs(f.dy)));
  const air = fr.filter((f) => !f.onGround).length / fr.length;
  const hardLands = lands(r).filter((e) => (e.data?.speed ?? 0) > 1.5);
  const ts = toasts(r);
  const time = r.t0 != null && r.t1 != null ? r.t1 - r.t0 : null;
  const nominal = L / (r.speed * 0.78);
  const tRatio = time != null ? time / nominal : null;
  const ok = [
    near(last.y, endY, 0.02),
    maxDy <= bound,
    air < 0.02,
    !hardLands.length,
    !ts.length,
    r.maxPen <= 0.02,
    !timing || (tRatio != null && tRatio >= 0.7 && tRatio <= 1.3),
  ];
  const detail = `slutt-y ${f3(last.y)}, |Δy| ${f2(maxDy / bound)}× grensa, i lufta ${(air * 100).toFixed(1)} %, land>1,5 ${hardLands.length}, toast ${ts.length}, hode ${r.maxPen > -0.5 ? f3(r.maxPen) : '–'}${timing ? `, tid ${time != null ? f2(time) : '?'} s = ${tRatio != null ? f2(tRatio) : '?'}×` : ''}`;
  if (VERBOSE || !ok.every(Boolean)) console.log(`       ${label}: ${detail}`);
  const names = ['slutt-y', '|Δy|', 'lufta', 'land', 'toast', 'hodet', 'tid'];
  const bad = names.filter((_, i) => !ok[i]);
  return check(label, !bad.length, bad.length ? `feil: ${bad.join(', ')} – ${detail}` : detail);
}

section('Ned fra toppen og opp fra bunnen (gange, løp, huk)');
for (const hz of RATES) {
  for (const gait of ['walk', 'run', 'crouch']) {
    const name = { walk: 'gange', run: 'løp', crouch: 'huk' }[gait];
    judgeWalk(`${hz} Hz ${name}: ned`, drive(world, { hz, dir: 'down', gait }), { endY: BOTTOM });
    judgeWalk(`${hz} Hz ${name}: opp`, drive(world, { hz, dir: 'up', gait }), { endY: TOP });
  }
}

{
  section('Kontroll (telles ikke): uten faceGround i Collision.resolveCapsule (den summerte octree-normalen)');
  const pure = stairWorld({ faceGround: false });
  for (const hz of RATES) {
    for (const dir of ['down', 'up']) {
      const r = drive(pure, { hz, dir });
      const bound = 1.3 * r.speed * r.dt * Math.tan(THETA) + DY_EPS;
      const maxDy = Math.max(...r.frames.map((f) => Math.abs(f.dy)));
      const last = r.frames[r.frames.length - 1];
      const time = r.t0 != null && r.t1 != null ? r.t1 - r.t0 : null;
      console.log(`  info ${hz} Hz gange ${dir === 'down' ? 'ned' : 'opp'}: |Δy| ${f2(maxDy / bound)}× grensa, slutt-y ${f3(last.y)}, tid ${time != null ? f2(time / (L / (r.speed * 0.78))) + '×' : 'kom ikke fram'}`);
    }
  }
}

section('Skrå inngang (30°) øverst og ved foten');
for (const hz of RATES) {
  const c = Math.cos(Math.PI / 6), s = Math.sin(Math.PI / 6);
  // from the hall towards −x, 30° towards −z (the wall of the bathroom side) – crosses the top nosing at z ≈ 2.8
  judgeWalk(`${hz} Hz: ned, inn på skrå`, drive(world, { hz, dir: 'down', start: [2.3, TOP, 3.25], heading: [-c, -s], straightFor: 0.1 }), { endY: BOTTOM, timing: false });
  // from the basement towards −x, 30° towards +z – crosses the lowest nosing at z ≈ 4.0
  judgeWalk(`${hz} Hz: opp, inn på skrå`, drive(world, { hz, dir: 'up', start: [2.5, BOTTOM, 3.55], heading: [-c, s], straightFor: 0.1 }), { endY: TOP, timing: false });
}

section('Stopp i trappa (ingen gliding på 2 s)');
for (const hz of RATES) {
  for (const uStop of [0.25, 0.75, 1.25, 1.8, 2.5]) {
    const r = drive(world, { hz, dir: 'down', stopAtU: uStop, hold: 2 });
    const after = r.frames.filter((f) => f.i > r.stopped.i + Math.round(0.4 * hz)); // the braking first (friction)
    const a = after[0], b = after[after.length - 1];
    const drift = Math.hypot(b.x - a.x, b.z - a.z);
    const dy = Math.abs(b.y - a.y);
    const grounded = after.every((f) => f.onGround);
    check(`${hz} Hz: står på u ${f2(uStop)} (${f2(a.x)}; ${f2(a.z)}, y ${f2(a.y)})`, drift < 0.01 && dy < 0.01 && grounded && !toasts(r).length, `drift ${f3(drift)} m, Δy ${f3(dy)} m${grounded ? '' : ', i lufta'}`);
  }
}

section('Hopp i trappa og under dekket (ingen dytt gjennom dekket)');
for (const hz of RATES) {
  for (const uJ of [0.3, 1.25, 2.3, L - 0.05]) {
    const r = drive(world, { hz, dir: 'down', jumpAtU: uJ });
    const last = r.frames[r.frames.length - 1];
    check(`${hz} Hz: hopp på u ${f2(uJ)}, så videre ned`, near(last.y, BOTTOM, 0.02) && r.maxPen <= 0.02 && !toasts(r).length, `slutt-y ${f3(last.y)}, hode ${f3(r.maxPen)}, toast ${toasts(r).length}`);
  }
  // in front of the foot, under the slab edge (x 1.85) and fully under the slab
  for (const x of [1.95, 2.3]) {
    const { player, input, events } = makePlayer(world);
    player.teleport(V(x, BOTTOM, 3.955), Math.PI / 2, 0);
    for (let i = 0; i < 12; i++) player.update(1 / hz);
    let maxPen = -Infinity, maxHead = -Infinity;
    const p0 = player.position.clone();
    for (let i = 0; i < Math.round(1.5 * hz); i++) {
      input.jumpPressed = i === 0;
      player.update(1 / hz);
      maxPen = Math.max(maxPen, headPenetration(player.capsule));
      maxHead = Math.max(maxHead, player.capsule.end.y + player.capsule.radius);
    }
    const p = player.position;
    const shove = Math.hypot(p.x - p0.x, p.z - p0.z);
    const toast = events.filter((e) => e.name === 'toast').length;
    check(`${hz} Hz: hopp på kjellergulvet x ${f2(x)} (dekkekanten på x 1,85)`, maxPen <= 0.02 && near(p.y, BOTTOM, 0.02) && shove < 0.2 && !toast, `høyeste hode ${f3(maxHead)} (dekket ${f2(slabUnder)}), inn i dekket ${f3(maxPen)}, dytt ${f3(shove)} m`);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// levels: Game._setupLevels, isWalkable / groundHeight, safe points, respawn, reserve spawns, _freeFloor

section('Nivåene i kollisjonen (Game._setupLevels, §3.4)');
// the bounds the shell and the exterior set today (shell.js 1341, exterior.js 569: the living room + the terrace)
function levelWorld({ forecourt = true, extra = [] } = {}) {
  const col = new CollisionWorld();
  addColliders(col, useOwnStair ? ownStairColliders() : realStair);
  addColliders(col, useOwnSlab ? ownSlabColliders() : realSlab);
  addColliders(col, surroundings());
  // the rest of the ground floor and of the basement, the entrance (−2.85) and the forecourt (−2.87)
  col.addStaticBox(box(0, -0.3, 8.2, 3.12, 0, 11.93));
  col.addStaticBox(box(5.75, BOTTOM - 0.3, 0.13, 6.45, BOTTOM, 11.38));
  col.addStaticBox(box(0.13, BOTTOM - 0.3, 5.23, 5.75, BOTTOM, 11.38));
  col.addStaticBox(box(6.16, -3.15, 3.12, 8.67, -2.85, 6.05));
  if (forecourt) col.addStaticBox(box(8.67, -3.2, 3.18, 12.6, -2.87, 6.75));
  addColliders(col, extra);
  col.build();
  const lb = layout.bounds;
  const terraceX = Math.max(...layout.outside.terrace.polygon.map((p) => p[0]));
  col.setBounds(lb.minX + 0.05, Math.max(lb.maxX, terraceX) - 0.05, lb.minZ + 0.05, lb.maxZ - 0.05);
  return col;
}
const fakeGame = (col) => ({ collision: col, home: { layout, spawn: { position: V(4.2, 0, 4.0), yaw: 0.3, pitch: 0 } }, player: null });
{
  const col = levelWorld();
  const old = { ...col.bounds };
  const g = fakeGame(col);
  Game.prototype._setupLevels.call(g);
  const ids = (col.boundsList || []).map((r) => r.levelId);
  check('ett rektangel per nivå + forplassen', ids.includes('hoved') && ids.includes('kjeller') && ids.includes('ute'), ids.join(', '));
  const main = col.boundsList.find((r) => r.levelId === 'hoved' && r.maxX === old.maxX);
  check('1. etasje beholder rektangelet fra skallet og eksteriøret (med terrassen), for føtter over −0,30', !!main && main.minX === old.minX && main.minZ === old.minZ && main.maxZ === old.maxZ && main.minY === slabUnder, main ? `${f2(main.minX)}–${f2(main.maxX)} × ${f2(main.minZ)}–${f2(main.maxZ)}, y ≥ ${f2(main.minY)}` : 'mangler');
  const W = [
    ['stua (4,2; 0; 4,0)', 4.2, 4.0, 0, true],
    ['terrassen (8,0; −0,03; 3,0)', 8.0, 3.0, -0.03, true],
    ['kjellergangen (3,5; −2,55; 3,8)', 3.5, 3.8, -2.55, true],
    ['entréen (7,4; −2,85; 4,4)', 7.4, 4.4, -2.85, true],
    ['forplassen (12,2; −2,87; 4,6)', 12.2, 4.6, -2.87, true],
    ['terrassetrappa (9,0; −1,6; 7,1)', 9.0, 7.1, -1.6, true],
    ['over forplassen i 1. etasjes høyde (12,2; 0; 4,6)', 12.2, 4.6, 0, false],
    ['nord for huset i kjelleren (−1; −2,55; 3,8)', -1, 3.8, -2.55, false],
    ['vest for kjelleren (3,5; −2,55; 12,0)', 3.5, 12.0, -2.55, false],
  ];
  for (const [name, x, z, y, want] of W) check(`isWalkable ${name} = ${want}`, col.isWalkable(x, z, y) === want);
  check('isWalkable uten y: alle rektanglene teller (forplassen)', col.isWalkable(12.2, 4.6) === true);
  check('groundHeight faller tilbake til husets gulv: −2,55 / −2,85 / 0', near(col.groundHeight(3.5, 3.8, -2.55), -2.55, 1e-6) && near(col.groundHeight(7.4, 4.4, -2.85), -2.85, 1e-6) && near(col.groundHeight(4.2, 4.0, 0), 0, 1e-6), [col.groundHeight(3.5, 3.8, -2.55), col.groundHeight(7.4, 4.4, -2.85), col.groundHeight(4.2, 4.0, 0)].map(f3).join(' / '));
  check('groundHeight utenfor huset uten terreng: −∞', col.groundHeight(12.2, 4.6, -2.87) === -Infinity);
  check('outsideDistance: inne ≤ 0, nord for kjelleren 1,18 m ute', col.outsideDistance(3.5, 3.8, -2.55) <= 0 && near(col.outsideDistance(-1, 3.8, -2.55), 1.18, 1e-6), f3(col.outsideDistance(-1, 3.8, -2.55)));
  // a layout without levels and outside: the plain rectangle stays
  const col1 = new CollisionWorld();
  col1.setBounds(0, 1, 0, 1);
  Game.prototype._setupLevels.call({ collision: col1, home: { layout: { house: { levels: [{ id: 'hoved' }], walkRects: [{ levelId: 'hoved', minX: 0, maxX: 1, minZ: 0, maxZ: 1 }], outsideHouse: null } } } });
  check('ett nivå uten ute: det gamle rektangelet, ingen liste', col1.boundsList === null && col1.bounds.maxX === 1);
  col1.setBoundsList([{ minX: 0, maxX: 2, minZ: 0, maxZ: 2, minY: -1, maxY: 1 }]);
  col1.setBounds(0, 1, 0, 1);
  check('setBounds etter setBoundsList: ett rektangel igjen (siste kall gjelder)', col1.boundsList === null && col1.isWalkable(0.5, 0.5, -5) && !col1.isWalkable(1.5, 0.5, 0));
}

section('Trygt punkt og respawn på alle nivåer (§3.5)');
function levelPlayer(col, g) {
  const r = makePlayer(col);
  g.player = r.player;
  Game.prototype._setupRespawn.call(g);
  return r;
}
for (const hz of RATES) {
  const col = levelWorld();
  const g = fakeGame(col);
  Game.prototype._setupLevels.call(g);
  const { player, input, events } = levelPlayer(col, g);
  // walk in the basement corridor, then fall through a hole in the floor (a spot with no floor: x 6.6, z 4.0 is in
  // the gap between the corridor's floor box and the entrance – inside the basement rectangle)
  player.teleport(V(4.5, BOTTOM, 3.9), Math.PI / 2, 0);
  input.move.forward = 1;
  for (let i = 0; i < Math.round(1.0 * hz); i++) player.update(1 / hz);
  input.move.forward = 0;
  for (let i = 0; i < Math.round(0.6 * hz); i++) player.update(1 / hz);
  const safe = player._safe.clone();
  check(`${hz} Hz: det trygge punktet lagres i kjelleren`, player._hasSafe && near(safe.y, BOTTOM, 0.03) && col.isWalkable(safe.x, safe.z, safe.y), `(${f2(safe.x)}; ${f3(safe.y)}; ${f2(safe.z)})`);
  events.length = 0;
  player.teleport(V(8.0, BOTTOM, 1.5), 0, 0); // in the basement's rectangle over nothing (bod-3 has no floor here): not a safe spot
  check(`${hz} Hz: et punkt uten gulv under er ikke trygt (men innenfor kjellerens rektangel)`, !player._isSafeSpot(V(8.0, BOTTOM, 1.5)) && col.isWalkable(8.0, 1.5, BOTTOM) && near(player._safe.y, safe.y, 1e-9));
  let t = 0;
  while (t < 4 && !events.some((e) => e.name === 'toast')) {
    player.update(1 / hz);
    t += 1 / hz;
  }
  for (let i = 0; i < Math.round(0.5 * hz); i++) player.update(1 / hz);
  check(`${hz} Hz: fall ut av verden → tilbake til det trygge punktet i kjelleren`, events.some((e) => e.name === 'toast') && near(player.position.y, BOTTOM, 0.03) && Math.hypot(player.position.x - safe.x, player.position.z - safe.z) < 0.05, `etter ${f2(t)} s: (${f2(player.position.x)}; ${f3(player.position.y)}; ${f2(player.position.z)})`);
}
{
  // a ?pos= start over a floor that is not built: the reserve spawns (the forecourt, then the dining room)
  for (const forecourt of [true, false]) {
    const col = levelWorld({ forecourt });
    const g = fakeGame(col);
    Game.prototype._setupLevels.call(g);
    const { player, events } = makePlayer(col);
    player.teleport(V(8.0, BOTTOM, 1.5), 0, 0);
    g.player = player;
    Game.prototype._setupRespawn.call(g);
    let t = 0;
    while (t < 4 && !events.some((e) => e.name === 'toast')) {
      player.update(1 / 60);
      t += 1 / 60;
    }
    for (let i = 0; i < 30; i++) player.update(1 / 60);
    const p = player.position;
    const want = forecourt ? [12.2, -2.87, 4.6] : [4.2, 0, 4.0];
    check(`start over et gulv som ikke er bygd → reservespawn ${forecourt ? 'forplassen' : 'spisestua (forplassen har ikke gulv)'}`, near(p.x, want[0], 0.05) && near(p.y, want[1], 0.03) && near(p.z, want[2], 0.05), `(${f2(p.x)}; ${f3(p.y)}; ${f2(p.z)})`);
    if (forecourt) check('forplassen på −2,87 er et trygt punkt (respawnY −30)', player._isSafeSpot(V(12.2, -2.87, 4.6)) && MOVE.respawnY + 1 < -2.87);
  }
}

section('Game._freeFloor på alle nivåer (§3.7)');
/** The old _freeFloor (before steg 20), for the living-room comparison. */
function oldFreeFloor(pos) {
  const c = this.collision;
  const lay = this.home?.layout;
  if (!c?.raycast) return pos;
  const ray = new THREE.Ray(new THREE.Vector3(), new THREE.Vector3(0, -1, 0));
  const inside = (x, z) => !lay?.isInside || lay.isInside(x, z);
  const floorAt = (x, z) => {
    const top = (lay?.ceilingHeightAt?.(x, z) ?? 2.4) - 0.05;
    ray.origin.set(x, top, z);
    const hit = c.raycast(ray, top + 0.5);
    return hit ? hit.point.y : -Infinity;
  };
  const free = (x, z) => {
    if (!inside(x, z)) return false;
    const y = floorAt(x, z);
    return y > -0.2 && y < 0.3;
  };
  if (!inside(pos.x, pos.z) || free(pos.x, pos.z)) return pos;
  for (let r = 0.25; r <= 3; r += 0.25) {
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      const x = pos.x + Math.cos(a) * r, z = pos.z + Math.sin(a) * r;
      if (free(x, z)) return new THREE.Vector3(x, 0, z);
    }
  }
  return pos;
}
{
  // furniture: the kitchen island (a box 0.9 high), a tall cabinet (2.2) in the living room, a box in the corridor
  const furniture = [box(4.6, 0, 1.2, 5.6, 0.9, 3.0), box(5.8, 0, 9.0, 6.4, 2.2, 10.0), box(3.2, BOTTOM, 3.4, 4.0, BOTTOM + 0.75, 4.2)];
  const col = levelWorld({ extra: furniture });
  const g = fakeGame(col);
  Game.prototype._setupLevels.call(g);
  const warn = console.warn;
  console.warn = () => {};
  let same = 0, total = 0, moved = 0;
  const diffs = [];
  for (let x = 2.8; x <= 6.8; x += 0.35) {
    for (let z = 0.3; z <= 11.8; z += 0.45) {
      if (!layout.isInside(x, z)) continue;
      total++;
      const a = oldFreeFloor.call(g, V(x, 0, z));
      const b = Game.prototype._freeFloor.call(g, V(x, 0, z));
      if (a.distanceTo(b) < 1e-9) same++;
      else diffs.push(`(${f2(x)}; ${f2(z)}) → gammel (${f2(a.x)}; ${f2(a.y)}; ${f2(a.z)}), ny (${f2(b.x)}; ${f2(b.y)}; ${f2(b.z)})`);
      if (a.distanceTo(V(x, 0, z)) > 1e-9) moved++;
    }
  }
  check(`stua: samme resultat som før steg 20 (${total} punkter, ${moved} flyttet ut av møbler)`, same === total && moved > 0, diffs.slice(0, 3).join('; '));
  const p1 = Game.prototype._freeFloor.call(g, V(3.5, -2.55, 3.8));
  check('?pos=3.5,-2.55,3.8 i en kasse i kjellergangen → nærmeste frie gulv i kjellergangen', near(p1.y, BOTTOM, 1e-6) && H.roomAt(p1.x, p1.y + 0.9, p1.z)?.id === 'kjeller-gang' && !(p1.x > 3.2 && p1.x < 4.0 && p1.z > 3.4 && p1.z < 4.2), `(${f2(p1.x)}; ${f3(p1.y)}; ${f2(p1.z)})`);
  const p2 = Game.prototype._freeFloor.call(g, V(4.6, -2.55, 4.6));
  check('?pos= på fritt kjellergulv blir stående', p2.x === 4.6 && p2.y === -2.55 && p2.z === 4.6);
  const p3 = Game.prototype._freeFloor.call(g, V(12.2, -2.87, 4.6));
  check('?pos= ute (forplassen) tas som det er', p3.x === 12.2 && p3.y === -2.87 && p3.z === 4.6);
  const onStair = walk.at(2.5).p;
  const p4 = Game.prototype._freeFloor.call(g, V(onStair[0], wedgeY(2.5), onStair[1]));
  check('?pos= på trappa (nedre løp) blir stående', near(p4.y, wedgeY(2.5), 1e-9) && p4.x === onStair[0], `(${f2(p4.x)}; ${f3(p4.y)}; ${f2(p4.z)})`);
  console.warn = warn;
}

// ---------------------------------------------------------------------------------------------------------------
console.log(`\n${passes} bestått, ${failures} feilet  (${useOwnStair ? 'egen trappekile' : 'stairs.js'}, snapParts ${MOVE.snapParts}, θ ${((THETA * 180) / Math.PI).toFixed(1)}° i |Δy|-grensa)`);
process.exit(failures ? 1 : 0);
