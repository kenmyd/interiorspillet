/**
 * Hele huset steg 25 (C3): the photo projection test of notes/hele-huset-design.md §6 (steg 25) and
 * notes/hele-huset-avstemming.md §6 (steg 25). Points picked by hand in the living-room photos 082841 and 082852
 * (bilder_stue/, 4000 × 3000 px) are cast through the cameras solved from the window frames (notes/fix-shell.md,
 * «Terrace photo fit»: 1280 × 960 frame, vfov 86.3°) and compared with the model's hypotheses:
 *   1. the landing / forecourt level: −2.87 (avstemmingen V25, outsideHouse.entranceLevelY) vs −1.72 (TERRACE_FIT);
 *   2. the terrace's south edge: x 10.35 (V9) vs 9.80 (TERRACE_FIT);
 *   3. whether the white pillar seen from the living room can be the entrance pillar (V30).
 * The errors in pixels (4000-px frame) are printed; the checks state which hypothesis fits better. Runs without the
 * photos (the picks are written here) and without a browser.
 */
import { imp, check, section, done } from './_lib.mjs';

const THREE = await import('three');
const { exteriorPlan } = await imp('src/home/exterior.js');
const { layout } = await imp('src/home/layout.js');

const D = Math.PI / 180;
const CAMS = {
  '082841': { pos: [6.126, 1.604, 7.92], yaw: 91.59, pitch: -11.35, roll: -2.24 },
  '082852': { pos: [6.576, 1.649, 10.729], yaw: 132.03, pitch: -10.71, roll: -1.68 },
};
const cam = (c) => {
  const k = new THREE.PerspectiveCamera(86.3, 4 / 3, 0.05, 100);
  k.position.set(...c.pos);
  k.rotation.set(c.pitch * D, (c.yaw + 180) * D, c.roll * D, 'YXZ');
  k.updateMatrixWorld(true);
  k.updateProjectionMatrix();
  return k;
};
const C = Object.fromEntries(Object.entries(CAMS).map(([k, v]) => [k, cam(v)]));
const S = 0.32; // 4000-px photo → 1280-px camera frame
const ray = (c, px) => new THREE.Vector3(((px[0] * S) / 1280) * 2 - 1, 1 - ((px[1] * S) / 960) * 2, 0.5).unproject(c).sub(c.position).normalize();
const project = (c, w) => {
  const v = new THREE.Vector3(...w).project(c);
  return [(((v.x + 1) / 2) * 1280) / S, (((1 - v.y) / 2) * 960) / S];
};
const err = (c, w, px) => {
  const p = project(c, w);
  return Math.hypot(p[0] - px[0], p[1] - px[1]);
};
const onPlaneY = (c, px, y) => {
  const d = ray(c, px);
  return c.position.clone().addScaledVector(d, (y - c.position.y) / d.y);
};
function triangulate(pa, pb) {
  const A = C['082841'], B = C['082852'];
  const d1 = ray(A, pa), d2 = ray(B, pb);
  const w0 = A.position.clone().sub(B.position);
  const a = d1.dot(d1), b = d1.dot(d2), c = d2.dot(d2), d = d1.dot(w0), e = d2.dot(w0);
  const den = a * c - b * b;
  const p1 = A.position.clone().addScaledVector(d1, (b * e - c * d) / den);
  const p2 = B.position.clone().addScaledVector(d2, (a * e - b * d) / den);
  return { p: p1.clone().add(p2).multiplyScalar(0.5), gap: p1.distanceTo(p2) };
}
const f2 = (v) => v.toFixed(2);

// hand-picked pixels (4000 × 3000), see .shots/hus/c3-ute/ for the crops
const PICK = {
  landingSW: { '082841': [2138, 2277], '082852': [2445, 2262] }, // the pale landing's far outer corner (with kerb)
  screenTop: { '082841': [1592, 1468], '082852': [1925, 1400] }, // far top corner of the slatted screen (west edge)
  pillarNE: { '082841': [1513, 2080], '082852': [1814, 1870] }, // left (NE) edge of the white pillar, mid-height
};

const P = exteriorPlan(layout);
check('outsideHouse is merged (plan.house)', P.house === true);

section('1. Landing level: −2.87 (V25) or −1.72 (TERRACE_FIT)');
{
  const pk = PICK.landingSW;
  const tri = triangulate(pk['082841'], pk['082852']);
  console.log(`  free triangulation of the landing's SW corner: (${f2(tri.p.x)}, ${f2(tri.p.y)}, ${f2(tri.p.z)}), rays ${f2(tri.gap)} m apart`);
  const fitAt = (y) => {
    const a = onPlaneY(C['082841'], pk['082841'], y), b = onPlaneY(C['082852'], pk['082852'], y);
    const m = a.clone().add(b).multiplyScalar(0.5);
    const e1 = err(C['082841'], [m.x, m.y, m.z], pk['082841']), e2 = err(C['082852'], [m.x, m.y, m.z], pk['082852']);
    console.log(`  y ${y}: the rays meet the plane ${f2(a.distanceTo(b))} m apart; best common corner (${f2(m.x)}, ${f2(m.z)}) is ${e1.toFixed(0)} / ${e2.toFixed(0)} px off`);
    return { miss: a.distanceTo(b), px: e1 + e2 };
  };
  const lo = fitAt(-2.87), hi = fitAt(-1.72);
  const lp = P.stair.landing.polygon;
  const model = [Math.max(...lp.map((q) => q[0])), P.entranceY, Math.max(...lp.map((q) => q[1]))];
  const fitOld = [10.5, -1.72, 8.1];
  const em = [err(C['082841'], model, pk['082841']), err(C['082852'], model, pk['082852'])];
  const eo = [err(C['082841'], fitOld, pk['082841']), err(C['082852'], fitOld, pk['082852'])];
  console.log(`  model corner ${JSON.stringify(model)}: ${em.map((e) => e.toFixed(0)).join(' / ')} px; TERRACE_FIT ${JSON.stringify(fitOld)}: ${eo.map((e) => e.toFixed(0)).join(' / ')} px`);
  check('the triangulated corner lies nearer −2.87 than −1.72', Math.abs(tri.p.y + 2.87) < Math.abs(tri.p.y + 1.72), `y ${f2(tri.p.y)}`);
  check('at −2.87 the two photos agree better than at −1.72', lo.miss < hi.miss && lo.px < hi.px, `${f2(lo.miss)} m / ${lo.px.toFixed(0)} px vs ${f2(hi.miss)} m / ${hi.px.toFixed(0)} px`);
  check("the model's landing corner reprojects better than TERRACE_FIT's (sum of both photos)", em[0] + em[1] < eo[0] + eo[1], `${(em[0] + em[1]).toFixed(0)} vs ${(eo[0] + eo[1]).toFixed(0)} px`);
  check('plan: forecourt, landing, path at entranceLevelY −2.87, 16 risers à 0.1775', Math.abs(P.entranceY + 2.87) < 1e-6 && P.wedge.risers === 16 && Math.abs(P.wedge.rise - 0.1775) < 1e-4);
}

section('2. Terrace edge: x 10.35 (V9) or 9.80 (TERRACE_FIT)');
{
  const pk = PICK.screenTop;
  const tri = triangulate(pk['082841'], pk['082852']);
  console.log(`  free triangulation of the screen's far top corner: (${f2(tri.p.x)}, ${f2(tri.p.y)}, ${f2(tri.p.z)}), rays ${f2(tri.gap)} m apart`);
  const topY = (P.deckY ?? -0.03) + 1.05;
  const e = (x) => [err(C['082841'], [x, topY, P.westZ], pk['082841']), err(C['082852'], [x, topY, P.westZ], pk['082852'])];
  const a = e(10.35), b = e(9.8);
  console.log(`  corner at x 10.35: ${a.map((v) => v.toFixed(0)).join(' / ')} px; at x 9.80: ${b.map((v) => v.toFixed(0)).join(' / ')} px`);
  check('9.80 does not fit clearly best → the deck goes to 10.35 (V9)', a[0] + a[1] < b[0] + b[1], `${(a[0] + a[1]).toFixed(0)} vs ${(b[0] + b[1]).toFixed(0)} px`);
  check('plan: the deck polygon reaches x 10.35', Math.abs(P.xE - 10.35) < 1e-6 && P.t.polygonV.some((q) => Math.abs(q.x - 10.35) < 1e-6));
}

section('3. Is the white pillar in 082841/082852 the entrance pillar (V30)?');
{
  const pk = PICK.pillarNE;
  const tri = triangulate(pk['082841'], pk['082852']);
  console.log(`  free triangulation of its NE edge: (${f2(tri.p.x)}, ${f2(tri.p.y)}, ${f2(tri.p.z)}), rays ${f2(tri.gap)} m apart`);
  const pl = P.pillar;
  const ne = [pl.x0, tri.p.y, pl.z0];
  const e = [err(C['082841'], ne, pk['082841']), err(C['082852'], ne, pk['082852'])];
  console.log(`  the entrance pillar's NE edge (${pl.x0}; ${pl.z0}) would be ${e.map((v) => v.toFixed(0)).join(' / ')} px off`);
  // the entrance pillar is hidden behind the terrace's clad west face (z 6.75, x up to closedSideFromX) from both cameras
  const hidden = Object.values(C).every((c) => {
    const p = c.position;
    const t = (P.westZ - p.z) / (pl.z1 - p.z);
    const x = p.x + t * (pl.x0 - p.x);
    return t > 0 && t < 1 && x > P.clad.x0 && x < P.clad.x1;
  });
  check('the entrance pillar is hidden behind the clad west face from both living-room cameras', hidden);
  check('so the white pillar is a second (corner) pier – built, flagged (CORNER_PIER)', P.cornerPier != null && tri.gap < 0.2);
}

done();
