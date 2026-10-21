#!/usr/bin/env node
/**
 * Node test for the pure stair geometry (notes/hele-huset-design.md §6 steg 19 B2, §3.1, §3.3; the numbers are
 * notes/hele-huset-avstemming.md §2, V12–V23):
 *   node tools/house-tests/stair-geom.test.mjs        (from the project root; exit code 1 on failure)
 *
 *   • riser = −floorY / risers, risers × riser = the floor-to-floor height (nothing hard-codes 13 or 14);
 *   • the walk line is the validator's (stairWalk in src/data/scripts/house.mjs, V13): same length, monotonic, its
 *     parameter inverts it; 2r + g and the going as the validator reports them;
 *   • nosing k has its tread top at lowerY + k·riser; the foot's straight treads fill the foot flight, the winders share
 *     the rest (balanced: no inner going of zero), straight treads at both ends;
 *   • the treads are simple polygons inside the footprint, the hole and kjeller-gang, and do not overlap;
 *   • the wedge: the ramp from the upper floor at the top edge to the lower floor at the lowest nosing (it ends on the
 *     floor at the bottom riser, no bump in front of the stair), its triangles face outwards, its top is surfaceY,
 *     ≤ 49° (M1's snap) wherever the capsule can stand, and a capsule dropped on it stands on the ramp;
 *   • no tread edge (with nosing) or stringer foot within 0.05 of a door frame (V17); the door under the stair (bod-1)
 *     is reported against the stringer's underside (V20);
 *   • slabColliders: the slab under the upper level minus the hole, plus the guards A/B/C;
 *   • house-mini (no footprint: the hole is the footprint) gives a stair too.
 */
import { imp, readJson, check, section, near, done } from './_lib.mjs';

const THREE = await import('three');
const { buildLayout } = await imp('src/home/layout.js');
const { stairLayout, stairColliders, slabColliders, rectangles, pointInPolygon, distToPolygon, signedArea, STAIR } = await imp('src/home/stairs.js');
const { stairWalk } = await imp('src/data/scripts/house.mjs');
const { CollisionWorld } = await imp('src/core/Collision.js');
const { Capsule } = await import('three/addons/math/Capsule.js');

const quiet = (fn) => {
  const orig = console.warn;
  console.warn = () => {};
  try {
    return fn();
  } finally {
    console.warn = orig;
  }
};
const spec = readJson('src/data/room-spec.json');
const palette = readJson('src/data/palette.json');
const layout = quiet(() => buildLayout(structuredClone(spec), palette, { devWarnings: false }));
const H = layout.house;
const st = H.stairs.find((s) => s.id === 'trapp-kjeller');
const raw = spec.stairs.find((s) => s.id === 'trapp-kjeller');
const lo = H.levelsById[st.fromLevel];
const hi = H.levelsById[st.toLevel];
const lay = stairLayout(st, H.levels);
const P = (p) => (Array.isArray(p) ? p : [p.x, p.y]);
const hole = H.floorOpenings.find((h) => h.id === st.openingId).polygon.map(P);
const lowerRoom = H.roomsById[st.roomIds[0]];
const lowerPoly = lowerRoom.polygon.map(P);
const f3 = (v) => (typeof v === 'number' ? v.toFixed(3) : Array.isArray(v) ? `(${v.map(f3).join('; ')})` : String(v));
const inOrOn = (p, pl, tol = 1e-3) => pointInPolygon(p, pl) || distToPolygon(p, pl) <= tol;

// ---------------------------------------------------------------------------------------------------------------
section('Opptrinn, inntrinn og ganglinja');
const rise = hi.floorY - lo.floorY;
check(`opptrinnet er −floorY / risers (${f3(lay.riser)} = ${f3(rise)} / ${raw.risers})`, near(lay.riser, rise / raw.risers, 1e-12) && lay.risers === raw.risers);
check(`risers × opptrinn = etasjehøyden ${f3(rise)} (${lay.risers} × ${f3(lay.riser)})`, near(lay.risers * lay.riser, rise, 1e-9) && near(rise, -lo.floorY, 1e-12));
check(`opptrinnet ${f3(lay.riser)} er innenfor 0,15–0,22`, lay.riser >= 0.15 && lay.riser <= 0.22);
const vWalk = stairWalk(raw, { bound: raw.footprint });
check(`ganglinja er validatorens (V13): ${f3(lay.walk.length)} = stairWalk ${f3(vWalk.length)} (≈ 2,87)`, near(lay.walk.length, vWalk.length, 1e-6) && near(lay.walk.length, 2.87, 0.02));
let maxDev = 0;
for (let u = 0; u <= lay.walk.length; u += 0.05) maxDev = Math.max(maxDev, Math.hypot(lay.walk.at(u).p[0] - vWalk.at(u).p[0], lay.walk.at(u).p[1] - vWalk.at(u).p[1]));
check(`… og samme punkter langs hele lengden (største avvik ${f3(maxDev)} m)`, maxDev < 1e-6);
const going = lay.walk.length / (lay.risers - 1);
const twoRG = 2 * lay.riser + going;
check(`inntrinn ${f3(going)} ≥ 0,22 og 2r + g ${f3(twoRG)} i 0,60–0,64 (validatorens tall)`, going >= 0.22 && twoRG >= 0.6 && twoRG <= 0.64 && near(lay.going, going, 1e-12));
{
  let ok = true;
  let worst = 0;
  let prev = null;
  for (let u = 0; u <= lay.walk.length + 1e-9; u += 0.01) {
    const a = lay.walk.at(u);
    const back = lay.walk.param(a.p);
    worst = Math.max(worst, Math.abs(back - u));
    if (prev) {
      const step = Math.hypot(a.p[0] - prev.p[0], a.p[1] - prev.p[1]);
      const fwd = (a.p[0] - prev.p[0]) * prev.dir[0] + (a.p[1] - prev.p[1]) * prev.dir[1];
      if (!(step > 0.005 && step < 0.015 && fwd > 0)) ok = false;
    }
    prev = a;
  }
  check(`ganglinja er monoton (fram langs retningen i hvert steg) og param() inverterer den (største avvik ${f3(worst)})`, ok && worst < 0.002);
}

// ---------------------------------------------------------------------------------------------------------------
section('Neselinjer og trinn');
const N = lay.nosings;
check(`${lay.risers} neselinjer (${lay.risers - 1} trinn + gulvkanten), topp lowerY + k·opptrinn`, N.length === lay.risers && N.every((ns, i) => ns.k === i + 1 && near(ns.y, lo.floorY + (i + 1) * lay.riser, 1e-9)));
check('gulvkanten (siste) ligger på u 0 og øvre gulv, nesa på trinn 1 på u = lengden', near(N[N.length - 1].u, 0, 1e-9) && near(N[N.length - 1].y, hi.floorY, 1e-9) && near(N[0].u, lay.walk.length, 1e-9));
check('u minker strengt oppover trappa (ganglinja monoton gjennom trinnene)', N.every((ns, i) => i === 0 || ns.u < N[i - 1].u - 0.1));
const nf = raw.foot.straightTreads;
const nt = raw.top.straightTreads;
check(`nesa på trinn 1 på x ${f3(raw.foot.edge[0][0])} (V17) og de ${nf} rette nederst med inntrinn ${f3(lay.goingFoot)} (V14: 0,23)`, near(N[0].walk[0], raw.foot.edge[0][0], 1e-9) && near(lay.goingFoot, 0.23, 0.002)
  && lay.treads.slice(0, nf).every((t) => t.kind === 'straight' && near(t.going, lay.goingFoot, 1e-9) && near(t.innerGoing, t.going, 1e-6) && near(t.outerGoing, t.going, 1e-6)));
check(`${nt} rett trinn øverst, de andre deler resten av ganglinja (${f3(lay.goingRest)} ≈ 0,243, V13)`, lay.treads.slice(-nt).every((t) => t.kind === 'straight' && near(t.innerGoing, t.going, 1e-6))
  && lay.treads.slice(nf).every((t) => near(t.going, lay.goingRest, 1e-9)) && near(lay.goingRest, 0.243, 0.003));
const winders = lay.treads.filter((t) => t.kind === 'winder');
check(`vangetrinnene er balanserte: innerste inntrinn ${f3(Math.min(...winders.map((t) => t.innerGoing)))} > 0,05, ytre ${f3(Math.min(...winders.map((t) => t.outerGoing)))}–${f3(Math.max(...winders.map((t) => t.outerGoing)))} > ganglinja`,
  winders.length === lay.risers - 1 - nf - nt && winders.every((t) => t.innerGoing > 0.05 && t.outerGoing > t.going));
check(`${lay.risers - 1} trinn, hvert et enkelt polygon (mot klokka) med areal > 0,15 m²`, lay.treads.length === lay.risers - 1
  && lay.treads.every((t) => signedArea(t.polygon) > 0.15 && signedArea(t.plate) > signedArea(t.polygon) && simple(t.polygon) && simple(t.plate)),
  lay.treads.map((t) => `${t.k}:${f3(signedArea(t.polygon))}`).join(' '));
const outsideHole = lay.treads.flatMap((t) => t.plate).filter((p) => !inOrOn(p, hole));
check('ingen trinn (med nese) ligger utenfor hullet', !outsideHole.length, outsideHole.map(f3).join(' '));
const outsideFoot = lay.treads.flatMap((t) => t.plate).filter((p) => !inOrOn(p, lay.footprint));
check('ingen trinn utenfor fotavtrykket (V19)', !outsideFoot.length, outsideFoot.map(f3).join(' '));
const outsideRoom = lay.treads.flatMap((t) => t.plate).filter((p) => !inOrOn(p, lowerPoly));
check(`ingen trinn utenfor ${lowerRoom.id}`, !outsideRoom.length, outsideRoom.map(f3).join(' '));
{
  // grid over the footprint: no point is on two treads (without the nose), and the treads cover the flights
  let both = 0;
  let free = 0;
  let total = 0;
  const b = bounds(lay.footprint);
  for (let x = b.minX + 0.005; x < b.maxX; x += 0.01) {
    for (let z = b.minZ + 0.005; z < b.maxZ; z += 0.01) {
      const p = [x, z];
      if (!pointInPolygon(p, lay.footprint) || pointInPolygon(p, lay.well)) continue;
      if (distToPolygon(p, lay.footprint) < STAIR.treadInset + 0.002 || distToPolygon(p, lay.well) < STAIR.treadInset + 0.002) continue;
      total++;
      const n = lay.treads.filter((t) => pointInPolygon(p, t.polygon)).length;
      if (n > 1) both++;
      if (n === 0) free++;
    }
  }
  check(`trinnene overlapper ikke og dekker løpene (${total} punkter: ${both} på to trinn, ${free} uten trinn)`, both === 0 && free / total < 0.01);
}

// ---------------------------------------------------------------------------------------------------------------
section('Kilen (kollisjon)');
const cols = stairColliders(lay);
const wedge = cols.find((c) => c.isMesh);
check('stairColliders: én kile (THREE.Mesh, usynlig) og Box3-er for vangesidene og hjørnene', !!wedge && !wedge.visible && cols.filter((c) => c.isBox3).length >= 10 && cols.every((c) => c.isMesh || c.isBox3));
const secs = lay.sections;
check(`kilen går fra øvre gulv i toppkanten (y ${f3(secs[0].yTop)}) til kjellergulvet ved nederste opptrinn`, near(secs[0].yTop, hi.floorY, 1e-9) && near(lay.surfaceY(...N[0].walk), lo.floorY, 1e-9)
  && secs.filter((s) => s.u >= lay.walk.length - 1e-9).every((s) => near(s.yTop, lo.floorY, 1e-9)));
{
  // nothing of the wedge above the floor in front of the lowest nosing (no invisible bump, §3.1), nothing outside the footprint
  const pos = wedge.geometry.attributes.position;
  let bump = 0;
  let outside = 0;
  const foot = N[0];
  for (let i = 0; i < pos.count; i++) {
    const p = [pos.getX(i), pos.getZ(i)];
    const ahead = (p[0] - foot.walk[0]) * lay.walk.at(lay.walk.length).dir[0] + (p[1] - foot.walk[1]) * lay.walk.at(lay.walk.length).dir[1];
    if (ahead > 1e-6 && pos.getY(i) > lo.floorY + 1e-6) bump++;
    if (!inOrOn(p, lay.footprint, 1e-4)) outside++;
  }
  check(`ingen kul foran trappa (${bump} punkter over gulvet foran nesa på trinn 1) og ingen punkter utenfor fotavtrykket (${outside})`, bump === 0 && outside === 0);
}
{
  // triangles face outwards: a point just in front of each lies outside the solid, a point just behind lies inside
  const pos = wedge.geometry.attributes.position;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const n = new THREE.Vector3();
  const m = new THREE.Vector3();
  const inside = (x, y, z) => {
    const top = lay.surfaceY(x, z);
    if (top === null) return false;
    return y < top - 1e-4 && y > Math.max(lo.floorY, top - STAIR.wedgeDepth) + 1e-4;
  };
  let bad = 0;
  let tested = 0;
  for (let i = 0; i < pos.count; i += 3) {
    a.fromBufferAttribute(pos, i);
    b.fromBufferAttribute(pos, i + 1);
    c.fromBufferAttribute(pos, i + 2);
    n.subVectors(b, a).cross(m.subVectors(c, a)).normalize();
    m.copy(a).add(b).add(c).multiplyScalar(1 / 3);
    const out = m.clone().addScaledVector(n, 0.004);
    const inn = m.clone().addScaledVector(n, -0.004);
    // skip slivers at the well's corners and faces lying on the floor
    if (Math.min(Math.hypot(m.x - lay.walk.corners[0][0], m.z - lay.walk.corners[0][1]), Math.hypot(m.x - lay.walk.corners[1][0], m.z - lay.walk.corners[1][1])) < 0.025) continue;
    if (n.y < -0.99 && near(m.y, lo.floorY, 1e-6)) continue;
    tested++;
    if (inside(out.x, out.y, out.z) || !inside(inn.x, inn.y, inn.z)) bad++;
  }
  check(`kilens trekanter vender utover (${bad} av ${tested} feil)`, bad === 0 && tested > 300);
}
{
  // the wedge's top is surfaceY (raycast down)
  const ray = new THREE.Raycaster();
  wedge.updateMatrixWorld(true);
  let worst = 0;
  let n = 0;
  const b = bounds(lay.footprint);
  for (let x = b.minX + 0.03; x < b.maxX; x += 0.07) {
    for (let z = b.minZ + 0.03; z < b.maxZ; z += 0.07) {
      const y = lay.surfaceY(x, z);
      if (y === null || distToPolygon([x, z], lay.well) < 0.12) continue;
      ray.set(new THREE.Vector3(x, 5, z), new THREE.Vector3(0, -1, 0));
      const hit = ray.intersectObject(wedge, false)[0];
      if (!hit) {
        worst = Infinity;
        continue;
      }
      worst = Math.max(worst, Math.abs(hit.point.y - y));
      n++;
    }
  }
  check(`kilens topp er surfaceY (${n} punkter, største avvik ${f3(worst)} m)`, n > 100 && worst < 0.01);
}
{
  // slope: along the walk line rise / length, and ≤ 49° wherever the capsule (r 0.30) can stand: ≥ 0.30 from the
  // inner line and the walls, ≥ 0.40 from the well's corners (the corner blocks, STAIR.cornerClear)
  const limit = Math.tan((49 * Math.PI) / 180);
  let worst = 0;
  let at = null;
  const b = bounds(lay.footprint);
  const h = 0.01;
  for (let x = b.minX; x < b.maxX; x += 0.02) {
    for (let z = b.minZ; z < b.maxZ; z += 0.02) {
      const p = [x, z];
      if (lay.surfaceY(x, z) === null) continue;
      if (distToPolygon(p, lay.footprint) < 0.3 || distToPolygon(p, lay.well) < 0.3) continue;
      if (lay.walk.corners.some((c) => Math.hypot(x - c[0], z - c[1]) < 0.3 + STAIR.cornerClear)) continue;
      const ys = [[x + h, z], [x - h, z], [x, z + h], [x, z - h]].map(([a, c]) => lay.surfaceY(a, c));
      if (ys.some((y) => y === null)) continue;
      const g = Math.hypot((ys[0] - ys[1]) / (2 * h), (ys[2] - ys[3]) / (2 * h));
      if (g > worst) {
        worst = g;
        at = p;
      }
    }
  }
  const deg = (Math.atan(worst) * 180) / Math.PI;
  check(`kilen er ${f3(lay.rampDeg)}° langs ganglinja og høyst ${deg.toFixed(1)}° der kapselen kan stå (≤ 49°, M1) – brattest ved ${f3(at)}`, lay.rampDeg < 45 && worst <= limit);
}
{
  // a capsule dropped on the stair stands on the ramp (static octree with the stair's colliders + a floor)
  const world = new CollisionWorld();
  for (const c of cols) (c.isBox3 ? world.addStaticBox(c) : world.addStatic(c));
  world.addStaticBox(new THREE.Box3(new THREE.Vector3(-1, lo.floorY - 0.2, 0), new THREE.Vector3(8, lo.floorY, 8)));
  world.build();
  const r = 0.3;
  let bad = [];
  for (const u of [0.15, 0.45, 0.8, 1.2, 1.45, 1.8, 2.1, 2.4, 2.7]) {
    const p = lay.walk.at(u).p;
    const y = lay.rampY(u);
    const cap = new Capsule(new THREE.Vector3(p[0], y + r + 0.05, p[1]), new THREE.Vector3(p[0], y + 1.8 - r + 0.05, p[1]), r);
    let res = null;
    for (let i = 0; i < 60; i++) {
      cap.translate(new THREE.Vector3(0, -0.01, 0));
      res = world.resolveCapsule(cap);
    }
    // the push-out slides the sphere down the slope: compare with the ramp under where it ended
    const feet = cap.start.y - r;
    const yEnd = lay.surfaceY(cap.start.x, cap.start.z) ?? lo.floorY;
    // a sphere on a slope rests at most r·(1/cos θ − 1) above the surface under its centre
    const slack = r * (1 / Math.cos((lay.rampDeg * Math.PI) / 180) - 1) + 0.02;
    if (!res.onGround || res.groundNormal.y < 0.62 || yEnd === null || feet < yEnd - 0.02 || feet > yEnd + slack) bad.push(`u ${u}: føttene ${f3(feet)} / rampa ${f3(yEnd)} / bakke ${res.onGround} ${f3(res.groundNormal.y)}`);
  }
  check('en kapsel som slippes på ganglinja, står på rampa (onGround, ikke gjennom og ikke svevende)', !bad.length, bad.join(' | '));
}

// ---------------------------------------------------------------------------------------------------------------
section('Dørkarmer og døra under trappa (V17, V20)');
{
  const jambsOf = (o) => {
    const w = H.wallsById[o.wallId];
    const s = P(w.start);
    const d = P(w.dir);
    const nn = P(w.normal);
    const t = w.thickness ?? 0.1;
    const fw = o.frame?.width ?? 0.05;
    const fd = o.frame?.depth ?? 0.02;
    const Q = (u, k) => [s[0] + d[0] * u + nn[0] * k, s[1] + d[1] * u + nn[1] * k];
    return [[o.offset, o.offset + fw], [o.offset + o.width - fw, o.offset + o.width]].map(([a, b]) => [Q(a, fd), Q(b, fd), Q(b, -(t + fd)), Q(a, -(t + fd))]);
  };
  const segDistPoly = (a, b, pl) => {
    let d = Infinity;
    for (let i = 0; i <= 20; i++) {
      const p = [a[0] + ((b[0] - a[0]) * i) / 20, a[1] + ((b[1] - a[1]) * i) / 20];
      d = Math.min(d, pointInPolygon(p, pl) ? 0 : distToPolygon(p, pl));
    }
    return d;
  };
  const t1 = lay.treads[0];
  const features = [
    { what: 'nederste trinnkant (med nesa)', seg: t1.front },
    { what: 'veggvangens fot', seg: [lay.stringers.outer.samples[0].p, lay.stringers.outer.samples[0].p] },
    { what: 'innervangens fot', seg: [lay.stringers.inner.samples[0].p, lay.stringers.inner.samples[0].p] },
  ];
  const doors = H.openings.filter((o) => o.door && H.wallsById[o.wallId]?.levelId === lo.id);
  const near1 = [];
  let worst = Infinity;
  for (const o of doors) {
    for (const f of features) {
      const d = Math.min(...jambsOf(o).map((j) => segDistPoly(f.seg[0], f.seg[1], j)));
      if (d < 1.0) near1.push(`${o.id}/${f.what} ${f3(d)}`);
      worst = Math.min(worst, d);
    }
  }
  check(`trinnkanten og vangeføttene står minst 0,05 fra hver dørkarm i ${lo.id} (nærmest ${f3(worst)}: ${near1.join(', ')})`, worst >= 0.05 - 1e-6);
  check(`veggvangen kappes loddrett senest på x 1,79 (V17): foten på x ${f3(lay.stringers.outer.samples[0].p[0])}`, lay.stringers.outer.samples[0].p[0] <= 1.79 + 1e-6 && near(lay.stringers.outer.samples[0].bottom, lo.floorY, 1e-9));
  const bod = H.openings.find((o) => o.id === 'door-bod-1');
  if (bod) {
    const w = H.wallsById[bod.wallId];
    const s = P(w.start);
    const d = P(w.dir);
    const nn = P(w.normal);
    let low = Infinity;
    for (let i = 0; i <= 20; i++) {
      const u = bod.offset + (bod.width * i) / 20;
      const p = [s[0] + d[0] * u + nn[0] * 0.02, s[1] + d[1] * u + nn[1] * 0.02];
      const y = lay.undersideAt(p[0], p[1]);
      if (y !== null) low = Math.min(low, y);
    }
    const clear = low - lo.floorY;
    const doorH = Math.min(bod.height, clear - 0.05);
    console.log(`  info trappeundersiden over door-bod-1: ${f3(clear)} over gulvet → dørhøyde min(${f3(bod.height)}, ${f3(clear)} − 0,05) = ${f3(doorH)} (V20 ventet 2,05–2,10)`);
    check('undersideAt gir vangens underside over døra under trappa (1,8–2,2 over kjellergulvet)', Number.isFinite(clear) && clear > 1.8 && clear < 2.2);
  }
}

// ---------------------------------------------------------------------------------------------------------------
section('Dekket og rekkverket (slabColliders)');
{
  const slab = slabColliders(layout, hi.id);
  const boxes = slab.filter((b) => near(b.max.y, hi.floorY, 1e-9) && near(b.min.y, hi.floorY - hi.slabThickness, 1e-9));
  const area = boxes.reduce((s, b) => s + (b.max.x - b.min.x) * (b.max.z - b.min.z), 0);
  const rooms = H.rooms.filter((r) => r.levelId === hi.id && r.kind !== 'hud');
  const roomArea = rooms.reduce((s, r) => s + Math.abs(signedArea(r.polygon.map(P))), 0);
  const holeArea = Math.abs(signedArea(hole));
  check(`dekkeboksen: ${boxes.length} bokser y ${f3(hi.floorY - hi.slabThickness)}–${f3(hi.floorY)}, ${f3(area)} m² = rommene ${f3(roomArea)} − hullet ${f3(holeArea)}`, near(area, roomArea - holeArea, 0.01));
  const inHole = boxes.filter((b) => pointInPolygon([(b.min.x + b.max.x) / 2, (b.min.z + b.max.z) / 2], hole));
  check('ingen dekkeboks i hullet', !inHole.length);
  const guards = slab.filter((b) => near(b.min.y, hi.floorY, 1e-9) && b.max.y > hi.floorY + 0.9);
  check(`rekkverk A/B/C: ${guards.length} bokser fra gulvet til ${f3(Math.max(...guards.map((b) => b.max.y)))} langs hullkanten`, guards.length === (raw.guards || []).filter((g) => g.line).length
    && guards.every((b) => b.max.y - b.min.y >= 0.95));
  check('slabColliders på et nivå uten noe under: bare rekkverk (ingen dekkeboks)', slabColliders(layout, lo.id).every((b) => b.min.y >= lo.floorY - 1e-9));
  const r = rectangles([[[0, 0], [4, 0], [4, 3], [2, 3], [2, 5], [0, 5]]], [[[1, 1], [2, 1], [2, 2], [1, 2]]]);
  const ra = r.reduce((s, [x0, x1, z0, z1]) => s + (x1 - x0) * (z1 - z0), 0);
  check(`rectangles(): L-form minus hull = ${r.length} rektangler, ${f3(ra)} m² (16 − 1 = 15)`, near(ra, 15, 1e-9));
}

// ---------------------------------------------------------------------------------------------------------------
section('house-mini (fotavtrykket er hullet)');
{
  const mini = readJson('tools/house-tests/fixtures/house-mini.json');
  const base = structuredClone(spec);
  for (const k of ['stairs', 'floorOpenings', 'levels']) base[k] = [];
  base.rooms = (base.rooms || []).filter((r) => r.id === 'stue-kjokken');
  for (const [k, v] of Object.entries(mini)) {
    if (k.startsWith('$') || !Array.isArray(v)) continue;
    const list = Array.isArray(base[k]) ? base[k] : (base[k] = []);
    for (const e of v) {
      const i = list.findIndex((x) => x.id === e.id);
      if (i >= 0) list[i] = structuredClone(e);
      else list.push(structuredClone(e));
    }
  }
  const L2 = quiet(() => buildLayout(base, palette, { devWarnings: false }));
  const s2 = L2.house.stairs[0];
  const lay2 = stairLayout(s2, L2.house.levels);
  const hole2 = L2.house.floorOpenings[0].polygon.map(P);
  check(`house-mini: ${lay2.treads.length} trinn, alle i hullet, kilen og ${stairColliders(lay2).length} kolliderere`, lay2.treads.length === s2.risers - 1
    && lay2.treads.every((t) => t.plate.every((p) => inOrOn(p, hole2))) && stairColliders(lay2).some((c) => c.isMesh));
  check('stairLayout på en spec-oppføring (ingen topY): nivåene fra levels, hoved = 0', stairLayout(raw, spec.levels).treads.length === raw.risers - 1);
}

done();

// ---------------------------------------------------------------------------------------------------------------
function bounds(pl) {
  return {
    minX: Math.min(...pl.map((p) => p[0])),
    maxX: Math.max(...pl.map((p) => p[0])),
    minZ: Math.min(...pl.map((p) => p[1])),
    maxZ: Math.max(...pl.map((p) => p[1])),
  };
}
function simple(pl) {
  const n = pl.length;
  const cr = (a, b, c, d) => {
    const o = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
    return o(a, b, c) * o(a, b, d) < -1e-12 && o(c, d, a) * o(c, d, b) < -1e-12;
  };
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      if (cr(pl[i], pl[(i + 1) % n], pl[j], pl[(j + 1) % n])) return false;
    }
  }
  return true;
}
