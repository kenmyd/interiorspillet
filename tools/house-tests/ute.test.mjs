/**
 * Hele huset steg 25 (C3): the exterior plan (src/home/exterior.js exteriorPlan) against the house data – no exterior
 * collider inside the basement, a walkable way from the outdoor spawn to the front door, the terrace stair as a
 * walkable wedge (16 × 0.1775) from the deck to the landing, and walking bounds that hold the house and the outside.
 */
import { imp, check, section, done, near } from './_lib.mjs';

const { exteriorPlan } = await imp('src/home/exterior.js');
const { layout } = await imp('src/home/layout.js');
const { WALKABLE_NORMAL_Y, PLAYER } = await imp('src/config.js').then((m) => ({ WALKABLE_NORMAL_Y: m.WALKABLE_NORMAL_Y, PLAYER: m.PLAYER ?? m.MOVE ?? {} }));

const P = exteriorPlan(layout);
const oh = layout.house.outsideHouse;
const R = Number(PLAYER.radius ?? 0.3);
const inPoly = (x, z, poly) => {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
};
const boxHitsPoly = (b, poly, inset = 0.01) => {
  // sample the box's footprint (inset) on a 5 cm grid
  for (let x = b.min[0] + inset; x <= b.max[0] - inset; x += 0.05)
    for (let z = b.min[2] + inset; z <= b.max[2] - inset; z += 0.05) if (inPoly(x, z, poly)) return [x, z];
  return null;
};

section('Data merged');
check('outsideHouse in the layout and merged by exteriorPlan', !!oh && P.house);
check('entrance level −2.87 = entrance floor − 0.02 (V25)', near(P.entranceY, -2.87, 1e-6));
check('ground near the house −2.95 (V33)', near(P.groundY, -2.95, 1e-6) && near(P.nearGroundY, -2.95, 1e-6) && near(P.nearGroundToX, 12.8, 1e-6));

section('No exterior collider inside the basement');
const cellar = layout.house.rooms.filter((r) => r.levelId === 'kjeller' && r.kind !== 'hud');
check('the basement has rooms (C1 data)', cellar.length >= 8, `${cellar.length}`);
for (const s of P.solids) {
  let hit = null;
  for (const r of cellar) {
    const h = boxHitsPoly(s, r.polygon);
    if (h) {
      hit = `${r.id} at (${h[0].toFixed(2)}; ${h[1].toFixed(2)})`;
      break;
    }
  }
  check(`${s.kind} [${s.min.map((v) => v.toFixed(2))}]→[${s.max.map((v) => v.toFixed(2))}] stays outside the basement rooms`, !hit, hit);
}
// and outside the basement's outer faces (avstemmingen §1.2): rom 3,70 to x 10.34 / z 3.18, the entrance to x 8.88
const faces = [
  { id: 'rom 3,70 (outer)', poly: [[6.44, -0.3], [10.34, -0.3], [10.34, 3.18], [6.44, 3.18]] },
  { id: 'entré (outer)', poly: [[6.16, 3.12], [8.88, 3.12], [8.88, 6.26], [6.16, 6.26]] },
  { id: 'kjellerstue (outer)', poly: [[3.05, 5.32], [6.75, 5.32], [6.75, 11.68], [3.05, 11.68]] },
];
for (const s of P.solids.filter((q) => ['lawn', 'forecourt', 'landing', 'path', 'walk'].includes(q.kind))) {
  const hit = faces.find((f) => boxHitsPoly(s, f.poly, 0.012));
  check(`${s.kind} ground does not reach behind ${hit?.id ?? 'the outer faces'}`, !hit);
}

section('From the outdoor spawn to the front door');
const sp = oh.spawnOutside;
const door = layout.house.openingsById?.['door-ute'];
const onPave = (x, z) => P.solids.find((s) => ['forecourt', 'landing', 'path', 'walk'].includes(s.kind) && x >= s.min[0] && x <= s.max[0] && z >= s.min[2] && z <= s.max[2]);
check('spawn (12.2; −2.87; 4.6) stands on the forecourt at the entrance level', !!onPave(sp.pos[0], sp.pos[2]) && near(onPave(sp.pos[0], sp.pos[2]).max[1], sp.pos[1], 0.005));
check('spawn is clear of the door swing x 8.88–9.88 · z 3.81–4.81 (V27)', !(sp.pos[0] - R < 9.88 && sp.pos[2] + R > 3.81 && sp.pos[2] - R < 4.81));
const tz = door ? door.center.z : 4.31;
const solidsBlock = P.solids.filter((s) => ['pillar', 'pier', 'fill', 'clad', 'topstep'].includes(s.kind));
let ok = true, why = '';
for (let i = 0; i <= 100; i++) {
  const x = sp.pos[0] + ((8.9 + R - sp.pos[0]) * i) / 100, z = sp.pos[2] + ((tz - sp.pos[2]) * i) / 100;
  if (!onPave(x, z)) {
    ok = false;
    why = `no paving at (${x.toFixed(2)}; ${z.toFixed(2)})`;
    break;
  }
  const b = solidsBlock.find((s) => x + R > s.min[0] && x - R < s.max[0] && z + R > s.min[2] && z - R < s.max[2] && s.max[1] > sp.pos[1] + 0.1);
  if (b) {
    ok = false;
    why = `${b.kind} in the way at (${x.toFixed(2)}; ${z.toFixed(2)})`;
    break;
  }
}
check(`a straight walk spawn → door (z ${tz.toFixed(2)}) is paved and free (capsule r ${R})`, ok, why);
check('the walking bounds hold the spawn and the door', P.bounds.minX < 8.88 && P.bounds.maxX > sp.pos[0] + R && P.bounds.minZ < 3.18 && P.bounds.maxZ > 6.75);
for (const w of layout.house.walkRects) check(`the bounds hold the ${w.levelId} rectangle`, P.bounds.minX <= w.minX + 1e-6 && P.bounds.maxX >= w.maxX - 1e-6 && P.bounds.minZ <= w.minZ + 1e-6 && P.bounds.maxZ >= w.maxZ - 1e-6);

section('Terrace stair (V33, §3.11)');
const W = P.wedge;
const slope = Math.atan2(W.y0 - W.y1, W.x1 - W.x0);
check('16 risers à 0.1775 from −0.03 to −2.87, 15 goings à 0.25', W.risers === 16 && near(W.rise, 0.1775, 1e-4) && near(W.going, 0.25, 1e-4) && near(W.y0, -0.03, 1e-6) && near(W.y1, -2.87, 1e-6));
check(`the wedge is walkable (${((slope * 180) / Math.PI).toFixed(1)}° < ${((Math.acos(WALKABLE_NORMAL_Y) * 180) / Math.PI).toFixed(1)}°)`, Math.cos(slope) > WALKABLE_NORMAL_Y);
const top = P.solids.find((s) => s.kind === 'topstep');
check('the wedge starts at the top step (deck level) and ends on the landing', !!top && near(top.max[0], W.x0, 1e-6) && near(top.max[1], W.y0, 1e-6) && P.solids.some((s) => s.kind === 'landing' && near(s.min[0], W.x1, 1e-6) && near(s.max[1], W.y1, 1e-6)));
const scr = P.t.railingLinesV.find((l) => l.every((q) => Math.abs(q.y - P.westZ) < 1e-6));
const fx = layout.wallsById['w-sor'].start.x + 0.3;
check('the opening from the deck to the top step is wide enough for the capsule', scr && Math.min(...scr.map((q) => q.x)) - fx >= 2 * R + 0.1, scr ? `${(Math.min(...scr.map((q) => q.x)) - fx).toFixed(2)} m` : 'no screen');
check("the stair has room for the capsule between its guards (0.71 free, capsule 0.60)", W.z1 - W.z0 >= 2 * R + 0.08, `${(W.z1 - W.z0).toFixed(2)}`);
check('the landing meets the forecourt (z 6.75) and the path', P.solids.some((s) => s.kind === 'landing' && near(s.min[2], P.forecourt.z1, 1e-6)) && P.solids.some((s) => s.kind === 'path' && near(s.max[0], W.x1, 1e-6)));

section('Niche, pillars, soffits (V28–V31)');
check('the entrance pillar 0.35 × 0.35 at x 10.0–10.35 · z 5.65–6.0 up to the soffit', P.pillar && near(P.pillar.x0, 10, 1e-6) && near(P.pillar.z1, 6, 1e-6) && near(P.pillar.y1, -0.505, 1e-6));
const ns = P.soffits.find((s) => s.niche);
check('the niche soffit covers x 8.88–10.35 · z 3.18–6.75 at −0.50 (5 mm below)', ns && near(ns.y, -0.505, 1e-6) && ns.rects.length === 2 && near(Math.max(...ns.rects.map((r) => r.x1)), 10.35, 1e-6) && near(Math.max(...ns.rects.map((r) => r.z1)), 6.75, 1e-6) && near(Math.min(...ns.rects.map((r) => r.x0)), 8.88, 1e-6));
check('the overhang soffit is two rectangles at −0.30', P.soffits.some((s) => !s.niche && s.rects.length === 2));
check('the fill sits behind every neighbour face (no coplanar faces)', P.fill && P.fill.x1 < 8.88 && P.fill.z0 > 6.26 && P.fill.z1 < 6.75 - 0.03);
check('the three foundation boxes go (V4, V6, V36)', ['w-sor', 'w-vest-stue', 'w-kjokken-sor'].every((id) => P.removeFoundation.has(id)));

done();
