#!/usr/bin/env node
/**
 * Tests for the planbygger (src/planbygger, notes/planbygger.md). No browser:
 *
 *   node tools/test-planbygger.mjs            (exit code 1 when a check fails)
 *
 *   1. raster operations (image.js)
 *   2. rooms from walls (regions.js): exact faces, areas, T and L joints
 *   3. export → validateHouse for plans built by hand (export.js, the game's validator)
 *   4. detection on synthetic plans with a known answer (tools/planbygger-synth.mjs) at 35–120 px/m, with and without
 *      noise: walls, doors (hinge and swing side), windows
 *   5. the two real plans against the owner's hand-built house (tools/planbygger-truth.mjs): thresholds
 *   6. the scale help (scale.js)
 *   7. the 3D build in Node: the game's buildLayout + buildRooms on a generated house
 *   8. the corrections of tools/planbygger-corrections.mjs keep the house valid
 *   9. two levels: a straight stair (export, validator, the game's stair builder), and the owner's whole house with the
 *      basement aligned by its outer corner (avstemming V1)
 *  10. crooked plans (a scan or a photo): the skew is found (estimateSkew) and the plan straightened before detection
 */
import { ROOT, imp, readJson, check, section, done, planPipeline, validateGenerated, KJELLER_PLAN } from './planbygger-lib.mjs';
import path from 'node:path';
import fs from 'node:fs';
import { readPng } from './planbygger-png.mjs';
import { renderPlan, samplePlans } from './planbygger-synth.mjs';
import { truthLevel, generatedLevel, compare } from './planbygger-truth.mjs';
import { CORRECTIONS } from './planbygger-corrections.mjs';

const I = await imp('src/planbygger/image.js');
const R = await imp('src/planbygger/regions.js');
const M = await imp('src/planbygger/model.js');
const E = await imp('src/planbygger/export.js');
const D = await imp('src/planbygger/detect.js');
const S = await imp('src/planbygger/scale.js');
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const f2 = (v) => (Number.isFinite(v) ? v.toFixed(3) : String(v));

// ---------------------------------------------------------------------------------------------------------------
section('1. Rasteroperasjoner');
{
  const m = I.raster(7, 5);
  // a 5 × 3 block with a 1 px spur
  for (let y = 1; y <= 3; y++) for (let x = 1; x <= 5; x++) m.data[y * 7 + x] = 1;
  m.data[0 * 7 + 3] = 1;
  const e = I.erode(m, 1);
  check('erosjon 3×3 lar bare midtraden stå', [...e.data].filter(Boolean).length === 3 && e.data[2 * 7 + 3] === 1);
  const o = I.open(m, 1);
  check('åpning fjerner piggen og beholder blokka', o.data[0 * 7 + 3] === 0 && [...o.data].filter(Boolean).length === 15);
  const rl = I.runLengths(m, 'h');
  check('løpelengde langs x', rl.data[2 * 7 + 1] === 5 && rl.data[0 * 7 + 3] === 1);
  const { comps } = I.components(m, 4);
  check('sammenhengende komponenter', comps.length === 1 && comps[0].area === 16);
  const dt = I.distanceToMask(m);
  check('avstandskart', dt.data[2 * 7 + 3] === 0 && near(dt.data[2 * 7 + 6], 1, 1e-6));
}

// ---------------------------------------------------------------------------------------------------------------
section('2. Rom fra vegger');
{
  // 6 × 4 m inside two exterior 0.3 walls, split by a 0.1 wall at x = 3.05 (centre)
  const walls = [
    { id: 'n', a: [0, 0], b: [6.3, 0], t: 0.3 },
    { id: 'e', a: [6.3, 0], b: [6.3, 4.3], t: 0.3 },
    { id: 's', a: [6.3, 4.3], b: [0, 4.3], t: 0.3 },
    { id: 'w', a: [0, 4.3], b: [0, 0], t: 0.3 },
    { id: 'm', a: [3.05, 0], b: [3.05, 4.3], t: 0.1 },
  ];
  const f = R.findRooms(walls);
  check('to rom', f.rooms.length === 2, `${f.rooms.length}`);
  const areas = f.rooms.map((r) => r.area).sort((a, b) => a - b);
  check('arealene er eksakte på veggflatene (2,85 × 4 og 3,05 × 4)', near(areas[0], 2.85 * 4, 1e-6) && near(areas[1], 3.05 * 4, 1e-6), areas.map(f2).join(', '));
  const left = f.rooms.find((r) => r.polygon.some((p) => near(p[0], 0.15, 1e-9)));
  check('venstre rom ligger på flatene 0,15 … 3,0 × 0,15 … 4,15', !!left && left.polygon.every((p) => [0.15, 3].some((x) => near(p[0], x, 1e-9)) && [0.15, 4.15].some((y) => near(p[1], y, 1e-9))));
  check('hver kant vet hvilken vegg den ligger på', f.rooms.every((r) => r.edges.every((e) => e.wall)));
  check('punktoppslag', f.at(1, 1) >= 0 && f.at(-1, -1) === -1 && f.at(3.05, 2) === -2);
  // a T joint where a thick wall ends on a thin one: no notch in the room on the other side
  const t = R.findRooms([...walls.slice(0, 4), { id: 'h', a: [0, 2.0], b: [6.3, 2.0], t: 0.1 }, { id: 'v', a: [3.0, 0], b: [3.0, 2.0], t: 0.3 }]);
  const below = t.rooms.find((r) => r.polygon.every((p) => p[1] >= 2.04));
  check('T-skjøt: tykk vegg stopper ved den tynne veggens flate', !!below && below.polygon.length === 4, below ? JSON.stringify(below.polygon) : 'fant ikke rommet');
  // a diagonal wall
  const dg = R.findRooms([...walls.slice(0, 4), { id: 'd', a: [0, 4.3], b: [4.3, 0], t: 0.1 }]);
  check('skrå vegg: to rom, og den skrå flaten er rett', dg.rooms.length === 2 && dg.rooms.every((r) => r.polygon.length <= 6), dg.rooms.map((r) => r.polygon.length).join(', '));
}

// ---------------------------------------------------------------------------------------------------------------
section('3. Eksport og spillets validator (planer bygd for hånd)');
const docFromPlan = (plan, name) => {
  const doc = M.createDoc(name);
  const lv = M.createLevel(doc, { id: 'hoved', image: { name, width: 1, height: 1, pxPerM: 100 } });
  lv.walls = plan.walls.map((w, i) => ({ id: `w${i}`, a: w.a, b: w.b, t: w.t }));
  lv.openings = plan.openings.map((o, i) => ({ id: `o${i}`, wall: `w${o.wall}`, type: o.type, at: o.at, width: o.width, hinge: o.hinge, side: o.side, sill: o.type === 'window' ? 0.9 : undefined, height: o.type === 'window' ? 1.2 : undefined }));
  return doc;
};
for (const [name, plan] of Object.entries(samplePlans())) {
  const doc = docFromPlan(plan, name);
  const ex = E.exportHouse(doc);
  const v = await validateGenerated(ex);
  const doors = plan.openings.filter((o) => o.type === 'door').length;
  const windows = plan.openings.filter((o) => o.type === 'window').length;
  check(`${name}: 0 feil i validateHouse`, v.errors.length === 0, v.errors.slice(0, 3).join(' | '));
  check(`${name}: alle dører og vinduer kom med`, ex.report.counts.doors === doors && ex.report.counts.windows === windows, `${ex.report.counts.doors}/${doors} dører, ${ex.report.counts.windows}/${windows} vinduer`);
  check(`${name}: skillevegger er backOf-par`, ex.house.walls.some((w) => w.backOf) && ex.house.walls.filter((w) => w.backOf).every((w) => ex.house.walls.some((o) => [].concat(w.backOf).includes(o.id))));
  check(`${name}: ingen advarsler fra eksporten`, !ex.report.warnings.length, ex.report.warnings.join(' | '));
}
{
  // north: the same plan with north up and north left gives the same rooms, rotated (+x = south)
  const plan = samplePlans().leilighet;
  const up = E.exportHouse(docFromPlan(plan, 'opp')).house;
  const docL = docFromPlan(plan, 'venstre');
  docL.settings.north = 270;
  const left = E.exportHouse(docL).house;
  const bb = (h) => {
    const p = h.rooms.flatMap((r) => r.polygon);
    return [Math.max(...p.map((q) => q[0])), Math.max(...p.map((q) => q[1]))];
  };
  check('nordretningen dreier huset (nord opp: x = ned i planen; nord til venstre: x = høyre)', near(bb(up)[0], 6.75, 0.01) && near(bb(left)[0], 8.75, 0.01), `${bb(up)} / ${bb(left)}`);
}

// ---------------------------------------------------------------------------------------------------------------
section('4. Gjenkjenning på syntetiske planer');
function matchSynthetic(plan, det, pxPerM, origin) {
  const toM = (p) => [(p[0] - origin[0]) / pxPerM, (p[1] - origin[1]) / pxPerM];
  const walls = det.walls.map((w) => ({ a: toM(w.a), b: toM(w.b), t: w.t / pxPerM }));
  let wallsOk = 0;
  let worst = 0;
  const map = new Map();
  plan.walls.forEach((tw, ti) => {
    const d = [tw.b[0] - tw.a[0], tw.b[1] - tw.a[1]];
    const L = Math.hypot(d[0], d[1]);
    const u = [d[0] / L, d[1] / L];
    const n = [-u[1], u[0]];
    let best = null;
    walls.forEach((w, wi) => {
      const du = [w.b[0] - w.a[0], w.b[1] - w.a[1]];
      const wl = Math.hypot(du[0], du[1]);
      if (Math.abs(du[0] * u[1] - du[1] * u[0]) / wl > 0.02) return;
      const off = Math.abs((w.a[0] - tw.a[0]) * n[0] + (w.a[1] - tw.a[1]) * n[1]);
      const s0 = (w.a[0] - tw.a[0]) * u[0] + (w.a[1] - tw.a[1]) * u[1];
      const s1 = (w.b[0] - tw.a[0]) * u[0] + (w.b[1] - tw.a[1]) * u[1];
      const ov = Math.min(Math.max(s0, s1), L) - Math.max(Math.min(s0, s1), 0);
      if (ov < 0.9 * L) return;
      if (!best || off < best.off) best = { wi, off, dt: Math.abs(w.t - tw.t), flip: s1 < s0 };
    });
    if (best && best.off <= 0.03 && best.dt <= 0.03) {
      wallsOk++;
      worst = Math.max(worst, best.off);
      map.set(ti, best);
    }
  });
  // openings: centre within 10 cm on the matched wall, the right type, doors hung and swinging the same way
  let found = 0;
  let typed = 0;
  let oriented = 0;
  const doors = plan.openings.filter((o) => o.type === 'door').length;
  for (const o of plan.openings) {
    const m = map.get(o.wall);
    if (!m) continue;
    const tw = plan.walls[o.wall];
    const w = walls[m.wi];
    const L = Math.hypot(tw.b[0] - tw.a[0], tw.b[1] - tw.a[1]);
    const u = [(tw.b[0] - tw.a[0]) / L, (tw.b[1] - tw.a[1]) / L];
    const c = [tw.a[0] + u[0] * o.at, tw.a[1] + u[1] * o.at];
    const wu = [(w.b[0] - w.a[0]) / Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]), (w.b[1] - w.a[1]) / Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1])];
    const cand = det.openings.filter((x) => x.wall === m.wi).map((x) => {
      const mid = ((x.from + x.to) / 2) / pxPerM;
      const p = [w.a[0] + wu[0] * mid, w.a[1] + wu[1] * mid];
      return { x, d: Math.hypot(p[0] - c[0], p[1] - c[1]), width: (x.to - x.from) / pxPerM };
    }).sort((a, b) => a.d - b.d)[0];
    if (!cand || cand.d > 0.1 || Math.abs(cand.width - o.width) > 0.15) continue;
    found++;
    if (cand.x.type === o.type) typed++;
    if (o.type === 'door' && cand.x.type === 'door') {
      // hinge point and swing side in metres
      const th = o.hinge === 'end' ? o.at + o.width / 2 : o.at - o.width / 2;
      const tH = [tw.a[0] + u[0] * th, tw.a[1] + u[1] * th];
      const tS = [-u[1] * o.side, u[0] * o.side];
      const gs = cand.x.hinge === 'end' ? cand.x.to : cand.x.from;
      const gH = [w.a[0] + (wu[0] * gs) / pxPerM, w.a[1] + (wu[1] * gs) / pxPerM];
      const gS = [-wu[1] * cand.x.side, wu[0] * cand.x.side];
      if (Math.hypot(gH[0] - tH[0], gH[1] - tH[1]) < 0.15 && gS[0] * tS[0] + gS[1] * tS[1] > 0.5) oriented++;
    }
  }
  return { walls: wallsOk, worst, found, typed, oriented, doors, extraWalls: walls.length - wallsOk };
}
for (const [name, plan] of Object.entries(samplePlans())) {
  for (const [ppm, noise] of [[35, 0], [50, 0], [80, 6], [120, 10]]) {
    const r = renderPlan(plan, { pxPerM: ppm, noise, seed: ppm });
    const det = D.detectPlan(r.img, { pxPerM: ppm });
    const m = matchSynthetic(plan, det, ppm, r.origin);
    const tag = `${name} ${ppm} px/m${noise ? `, støy ±${noise}` : ''}`;
    check(`${tag}: alle ${plan.walls.length} vegger (≤ 3 cm)`, m.walls === plan.walls.length, `${m.walls}/${plan.walls.length}, verste ${(m.worst * 100).toFixed(1)} cm, ${m.extraWalls} ekstra`);
    check(`${tag}: alle ${plan.openings.length} åpninger med riktig type`, m.found === plan.openings.length && m.typed === plan.openings.length, `${m.found} funnet, ${m.typed} riktig type`);
    check(`${tag}: dørene henger og slår riktig vei`, m.oriented === m.doors, `${m.oriented}/${m.doors}`);
  }
}

{
  // grey walls (lighter than the black text): found automatically (autoWallTone), and with a sampled tone
  const plan = samplePlans().leilighet;
  for (const g of [70, 115, 150]) {
    const r = renderPlan(plan, { pxPerM: 60, wallGrey: g, seed: 4 });
    const det = D.detectPlan(r.img, { pxPerM: 60 });
    const m = matchSynthetic(plan, det, 60, r.origin);
    check(`grå vegger (${g}) finnes automatisk: alle vegger og åpninger`, m.walls === plan.walls.length && m.found === plan.openings.length && m.typed === plan.openings.length, `${m.walls}/${plan.walls.length} vegger, ${m.typed}/${plan.openings.length} åpninger, tone ${JSON.stringify(det.stats.autoWallTone ?? null)}`);
  }
  const r = renderPlan(plan, { pxPerM: 60, wallGrey: 150, seed: 4 });
  const det = D.detectPlan(r.img, { pxPerM: 60, wallTone: [125, 170] });
  const m = matchSynthetic(plan, det, 60, r.origin);
  check('grå vegger med prøvd veggfarge (150 → 125–170)', m.walls === plan.walls.length && m.typed === plan.openings.length, `${m.walls} vegger, ${m.typed} åpninger`);
}
{
  // the same plan at 2× and 4× the resolution (a scan): the same walls, doors and windows
  const img = readPng(path.join(ROOT, 'plantegning.png'));
  for (const f of [2, 4]) {
    const t0 = Date.now();
    const det = D.detectPlan(D.upsample(img, f), { pxPerM: (628 / 12.21) * f });
    const ms = Date.now() - t0;
    const c = (t) => det.openings.filter((o) => o.type === t).length;
    check(`1. etasje i ${f}× oppløsning: 11 vegger, 3 dører, 7 vinduer, 1 åpning`, det.walls.length === 11 && c('door') === 3 && c('window') === 7 && c('opening') === 1, `${det.walls.length} vegger, ${c('door')} dører, ${c('window')} vinduer, ${c('opening')} åpninger, ${ms} ms`);
  }
}

// ---------------------------------------------------------------------------------------------------------------
section('5. De ekte planene mot eierens hus');
const spec = readJson('src/data/room-spec.json');
const real = [
  { key: 'hoved', file: path.join(ROOT, 'plantegning.png'), level: 'hoved', ppm: 628 / 12.21, wallMean: 2.0, coverage: 0.98, doors: 4, windows: 7 },
  { key: 'kjeller', file: KJELLER_PLAN, level: 'kjeller', ppm: 633 / 10.5, wallMean: 1.5, coverage: 0.85, doors: 6, windows: 6 },
];
const bestShift = (T, G) => {
  // the median offset along x and z of the nearest faces (the basement's data are 0,13 m out, avstemming V1)
  const ex = [];
  const ez = [];
  for (const t of T.walls) {
    const p = [(t.a[0] + t.b[0]) / 2, (t.a[1] + t.b[1]) / 2];
    let best = null;
    for (const g of G.walls) {
      if (Math.abs(g.d[0] * t.d[1] - g.d[1] * t.d[0]) > 0.05 || g.n[0] * t.n[0] + g.n[1] * t.n[1] < 0.9) continue;
      const u = (p[0] - g.a[0]) * g.d[0] + (p[1] - g.a[1]) * g.d[1];
      if (u < 0 || u > g.L) continue;
      const e = (p[0] - g.a[0]) * g.n[0] + (p[1] - g.a[1]) * g.n[1];
      if (Math.abs(e) < 0.2 && (!best || Math.abs(e) < Math.abs(best.e))) best = { e, n: g.n };
    }
    if (best && Math.abs(best.n[0]) > 0.9) ex.push(best.e * Math.sign(best.n[0]));
    if (best && Math.abs(best.n[1]) > 0.9) ez.push(best.e * Math.sign(best.n[1]));
  }
  const med = (a) => (a.length ? [...a].sort((x, y) => x - y)[a.length >> 1] : 0);
  return [med(ex), med(ez)];
};
for (const P of real) {
  if (!P.file || !fs.existsSync(P.file)) {
    console.log(`  (hopper over ${P.key}: planen finnes ikke – bilder_hus/ er gitignorert)`);
    continue;
  }
  const t0 = Date.now();
  const { doc } = await planPipeline(P.file, { pxPerM: P.ppm, north: 270 });
  const ms = Date.now() - t0;
  const ex = E.exportHouse(doc);
  const v = await validateGenerated(ex);
  check(`${P.key}: 0 feil i validateHouse`, v.errors.length === 0, v.errors.slice(0, 3).join(' | '));
  const T = truthLevel(spec, P.level);
  const G0 = generatedLevel(ex.house, 'hoved');
  const s = bestShift(T, G0);
  const G = { walls: G0.walls.map((w) => ({ ...w, a: [w.a[0] + s[0], w.a[1] + s[1]], b: [w.b[0] + s[0], w.b[1] + s[1]] })), openings: G0.openings.map((o) => ({ ...o, centre: [o.centre[0] + s[0], o.centre[1] + s[1]] })), rooms: G0.rooms.map((r) => ({ ...r, polygon: r.polygon.map((p) => [p[0] + s[0], p[1] + s[1]]) })) };
  const c = compare(T, G);
  check(`${P.key}: veggflatene funnet (≥ ${P.coverage * 100} % av lengden innen 15 cm)`, c.walls.coverage >= P.coverage, `${(c.walls.coverage * 100).toFixed(1)} %`);
  check(`${P.key}: snittavvik på veggflatene ≤ ${P.wallMean} cm`, c.walls.meanCm <= P.wallMean, `${c.walls.meanCm.toFixed(2)} cm (median ${c.walls.medianCm.toFixed(2)})`);
  check(`${P.key}: ${P.doors} dører funnet`, c.openings.byType.door.found >= P.doors, `${c.openings.byType.door.found} av ${c.openings.byType.door.truth}`);
  check(`${P.key}: ${P.windows} vinduer funnet`, c.openings.byType.window.found >= P.windows && c.openings.byType.window.typeOk >= P.windows, `${c.openings.byType.window.found} av ${c.openings.byType.window.truth}`);
  check(`${P.key}: ingen ekstra åpninger`, c.openings.extra.length === 0, c.openings.extra.map((x) => x.id).join(', '));
  check(`${P.key}: alle rommene funnet (overlapp ≥ 85 %)`, c.rooms.every((r) => r.iou >= 0.85), c.rooms.map((r) => `${r.id} ${(r.iou * 100).toFixed(0)}`).join(', '));
  check(`${P.key}: gjenkjenningen tar under 3 s`, ms < 3000, `${ms} ms`);
  // ---- 8. the corrections keep it valid
  const fixed = JSON.parse(JSON.stringify(doc));
  const edits = CORRECTIONS[P.key](fixed);
  const ex2 = E.exportHouse(fixed);
  const v2 = await validateGenerated(ex2);
  check(`${P.key}: etter ${edits.length} rettinger fortsatt 0 feil`, v2.errors.length === 0, v2.errors.slice(0, 3).join(' | '));
  const c2 = compare(T, { ...generatedLevel(ex2.house, 'hoved'), walls: G.walls, rooms: G.rooms, openings: generatedLevel(ex2.house, 'hoved').openings.map((o) => ({ ...o, centre: [o.centre[0] + s[0], o.centre[1] + s[1]], hinge: o.hinge ? [o.hinge[0] + s[0], o.hinge[1] + s[1]] : null })) });
  check(`${P.key}: etter rettingene er alle dørene der og slår riktig vei`, c2.openings.byType.door.found === c2.openings.byType.door.truth && c2.openings.byType.door.oriented === c2.openings.byType.door.truth, `${c2.openings.byType.door.found}/${c2.openings.byType.door.truth} funnet, ${c2.openings.byType.door.oriented} riktig vei`);
}

// ---------------------------------------------------------------------------------------------------------------
section('6. Skala');
{
  const img = readPng(path.join(ROOT, 'plantegning.png'));
  const s = S.suggestScale(img);
  check('skalaforslag for 1. etasje innen 5 %', s && Math.abs(s.pxPerM / 51.3 - 1) < 0.05, s ? `${s.pxPerM.toFixed(2)} px/m fra ${s.from}` : 'ingen');
  const grey = I.luma(img);
  const t = S.traceLine(grey, 150, 76);
  check('klikk på målelinja «2.53 m» gir linja mellom veggflatene', t && near(t.length / 2.53, 51.3, 51.3 * 0.02), t ? `${t.length} px → ${(t.length / 2.53).toFixed(2)} px/m` : 'ingen');
  const long = S.traceLine(grey, 540, 300);
  check('den lange målelinja «12.21 m» gir skalaen innen 0,5 %', long && Math.abs(long.length / 12.21 / 51.3 - 1) < 0.005, long ? `${long.length} px → ${(long.length / 12.21).toFixed(2)} px/m` : 'ingen');
  if (KJELLER_PLAN) {
    const k = S.suggestScale(readPng(KJELLER_PLAN));
    check('skalaforslag for kjelleren innen 5 %', k && Math.abs(k.pxPerM / 60.25 - 1) < 0.05, k ? `${k.pxPerM.toFixed(2)} px/m fra ${k.from}` : 'ingen');
  }
  for (const ppm of [40, 90]) {
    const r = renderPlan(samplePlans().leilighet, { pxPerM: ppm, seed: 3 });
    const g = S.suggestScale(r.img);
    check(`skalaforslag på en syntetisk plan (${ppm} px/m) innen 10 %`, g && Math.abs(g.pxPerM / ppm - 1) < 0.1, g ? `${g.pxPerM.toFixed(1)} fra ${g.from}` : 'ingen');
  }
}

// ---------------------------------------------------------------------------------------------------------------
section('7. 3D-bygget i Node (spillets buildLayout + buildRooms)');
{
  const { buildLayout } = await imp('src/home/layout.js');
  const { buildRooms } = await imp('src/home/rooms.js');
  const { doc } = await planPipeline(path.join(ROOT, 'plantegning.png'), { pxPerM: 628 / 12.21, north: 270 });
  const ex = E.exportHouse(doc);
  const layout = buildLayout(E.mergeOnto(E.baseSpec(), ex.house), undefined, { devWarnings: false });
  const rooms = layout.house.rooms.filter((r) => r.id !== 'stue-kjokken' && !r.hud);
  check('layout: alle rommene', rooms.length === ex.house.rooms.length, `${rooms.length}`);
  check('layout: dørene er dører (door:{…})', layout.house.doors.length === ex.report.counts.doors, `${layout.house.doors.length}`);
  let built = null;
  let err = null;
  try {
    built = buildRooms({ quality: { level: 'low' } }, layout, null);
  } catch (e) {
    err = e;
  }
  check('buildRooms bygger huset uten feil', !!built && !err, err?.message);
  if (built) {
    check('buildRooms: en dør per dør i dataene', built.doors.length === ex.report.counts.doors, `${built.doors.length}`);
    check('buildRooms: vinduer og vegger', built.windows.length === ex.report.counts.windows && built.walls.length >= ex.house.walls.length * 0.9, `${built.windows.length} vinduer, ${built.walls.length} vegger`);
    check('buildRooms: kollisjon for veggene', built.colliders.length > 0);
    built.dispose();
  }
}

// ---------------------------------------------------------------------------------------------------------------
section('9. Etasjer og trapp');
{
  const { buildLayout } = await imp('src/home/layout.js');
  const St = await imp('src/home/stairs.js');
  const doc = M.createDoc('Testhus');
  doc.settings.north = 270;
  const box = (lv) => {
    lv.walls = [
      { id: 'n', a: [0, 0], b: [8, 0], t: 0.25 },
      { id: 'e', a: [8, 0], b: [8, 6], t: 0.25 },
      { id: 's', a: [8, 6], b: [0, 6], t: 0.25 },
      { id: 'w', a: [0, 6], b: [0, 0], t: 0.25 },
      { id: 'm', a: [5.5, 0], b: [5.5, 6], t: 0.1 },
    ];
    lv.openings = [{ id: 'd1', wall: 'm', type: 'door', at: 4.5, width: 0.9, hinge: 'start', side: 1 }];
  };
  box(M.createLevel(doc, { id: 'hoved', floorY: 0 }));
  box(M.createLevel(doc, { id: 'kjeller', name: 'Kjeller', floorY: -2.6 }));
  M.addStair(doc.levels[0], [1.0, 1.5], [4.6, 2.5]);
  const ex = E.exportHouse(doc);
  const v = await validateGenerated(ex);
  check('trapp: et hull og en trapp i husfila', ex.house.floorOpenings?.length === 1 && ex.house.stairs?.length === 1);
  const st = ex.house.stairs[0];
  check('trapp: 14 opptrinn à 0,186 (2,6 m), fra kjelleren til 1. etasje', st.risers === 14 && st.fromLevel === 'kjeller' && st.toLevel === 'hoved', `${st.risers}, ${st.fromLevel} → ${st.toLevel}`);
  check('trapp: rekkverk på de tre frie sidene', st.guards.length === 3, `${st.guards.length}`);
  check('trapp: 0 feil i validateHouse', v.errors.length === 0, v.errors.slice(0, 3).join(' | '));
  const layout = buildLayout(E.mergeOnto(E.baseSpec(), ex.house), undefined, { devWarnings: false });
  const H = layout.house;
  const ls = H.stairs[0];
  check('layout: trappeflaten går fra 0 til −2,6', near(ls.surfaceY(0.9, 1.9) ?? NaN, 0, 0.05) && near(ls.surfaceY(4.45, 1.9) ?? NaN, -2.6, 0.05), `${ls.surfaceY(0.9, 1.9)} … ${ls.surfaceY(4.45, 1.9)}`);
  // the game's stair builder on a straight stair with the hole as its footprint: treads and collision (chains() took the
  // wrong side until the stair work fixed it – the viewer's workaround straightStairFix is gone)
  const raw = St.stairLayout(ls, H.levels);
  check('stairs.js: en rett trapp med hullet som fotavtrykk får 13 trinn og kollisjon', raw.treads.length === 13 && St.stairColliders(raw).length > 0, `${raw.treads.length} trinn`);
}
{
  // a U stair (half-turn with winders, «half-turn-winder»): export, validator, the game's stair builder
  const { buildLayout } = await imp('src/home/layout.js');
  const St = await imp('src/home/stairs.js');
  const doc = M.createDoc('U-trapp');
  doc.settings.north = 270;
  const box = (lv) => {
    lv.walls = [
      { id: 'n', a: [0, 0], b: [8, 0], t: 0.25 },
      { id: 'e', a: [8, 0], b: [8, 6], t: 0.25 },
      { id: 's', a: [8, 6], b: [0, 6], t: 0.25 },
      { id: 'w', a: [0, 6], b: [0, 0], t: 0.25 },
    ];
    lv.openings = [];
  };
  box(M.createLevel(doc, { id: 'hoved', floorY: 0 }));
  box(M.createLevel(doc, { id: 'kjeller', name: 'Kjeller', floorY: -2.6 }));
  const st = M.addStair(doc.levels[0], [3.0, 1.0], [0.6, 3.2]);
  st.kind = 'u';
  const ex = E.exportHouse(doc);
  const v = await validateGenerated(ex);
  const s = ex.house.stairs?.[0];
  check('U-trapp: half-turn-winder med øye og to løp som går hver sin vei', s?.type === 'half-turn-winder' && s.well?.polygon?.length === 4 && s.top.down[0] === -s.foot.down[0], JSON.stringify(s?.top));
  check('U-trapp: rekkverk rundt øyet og hullet', s.guards.some((g) => g.on === 'well') && s.guards.filter((g) => g.line).length >= 3, `${s.guards.length} rekkverk`);
  check('U-trapp: 0 feil i validateHouse', v.errors.length === 0, v.errors.slice(0, 3).join(' | '));
  const layout = buildLayout(E.mergeOnto(E.baseSpec(), ex.house), undefined, { devWarnings: false });
  const lay = St.stairLayout(layout.house.stairs[0], layout.house.levels);
  check('U-trapp: stairs.js bygger 13 trinn med svingtrinn og kollisjon', lay.treads.length === 13 && lay.treads.some((x) => x.kind === 'winder') && St.stairColliders(lay).length > 0, `${lay.treads.length} trinn, ${lay.treads.filter((x) => x.kind === 'winder').length} svingtrinn`);
}
if (KJELLER_PLAN) {
  // the owner's whole house: the basement under the ground floor, aligned by the NE outer corner
  const { doc } = await planPipeline(path.join(ROOT, 'plantegning.png'), { pxPerM: 628 / 12.21, north: 270 });
  const img = readPng(KJELLER_PLAN);
  const ppm = 633 / 10.5;
  const kj = M.createLevel(doc, { id: 'kjeller', name: 'Kjeller', floorY: -2.55, image: { name: 'kjeller', width: img.width, height: img.height, pxPerM: ppm } });
  M.applyDetection(kj, D.detectPlan(img, { pxPerM: ppm }), ppm, doc.settings);
  E.alignLevel(doc, kj, doc.levels[0], 'ne');
  const ex = E.exportHouse(doc);
  const v = await validateGenerated(ex);
  check('hele huset: 0 feil i validateHouse', v.errors.length === 0, v.errors.slice(0, 3).join(' | '));
  const bod1 = ex.house.rooms.find((r) => r.levelId === 'kjeller' && r.polygon.some((p) => p[0] < 0.3 && p[1] < 0.3));
  const c = bod1 ? [Math.min(...bod1.polygon.map((p) => p[0])), Math.min(...bod1.polygon.map((p) => p[1]))] : null;
  check('hele huset: ytterhjørnet legger kjelleren 0,13 m inn, som avstemming V1 (± 2 cm)', c && near(c[0], 0.13, 0.02) && near(c[1], 0.13, 0.02), c ? c.map((x) => x.toFixed(3)).join(', ') : 'fant ikke boden');
}

section('10. Skjeve planer: vinkelen finnes, planen rettes opp');
{
  const img = readPng(path.join(ROOT, 'plantegning.png'));
  const ppm = 628 / 12.21;
  const base = D.detectPlan(img, { pxPerM: ppm });
  const kinds = (det) => ['door', 'window', 'opening'].map((t) => det.openings.filter((o) => o.type === t).length).join('/');
  // the largest distance from a wall of the straight plan to its nearest twin in the straightened one, in cm
  const drift = (det) => {
    let worst = 0;
    for (const w of base.walls) {
      let best = Infinity;
      for (const v of det.walls) {
        const d1 = Math.max(Math.hypot(w.a[0] - v.a[0], w.a[1] - v.a[1]), Math.hypot(w.b[0] - v.b[0], w.b[1] - v.b[1]));
        const d2 = Math.max(Math.hypot(w.a[0] - v.b[0], w.a[1] - v.b[1]), Math.hypot(w.b[0] - v.a[0], w.b[1] - v.a[1]));
        best = Math.min(best, d1, d2);
      }
      worst = Math.max(worst, best);
    }
    return (worst / ppm) * 100;
  };
  check('den rette planen: vinkelen er 0', Math.abs(D.estimateSkew(img)) < 0.05, `${D.estimateSkew(img)}°`);
  for (const deg of [1.5, -3.2, 6]) {
    const r = I.rotateImage(img, deg);
    const est = D.estimateSkew(r);
    check(`1. etasje ${deg}° skjev: vinkelen finnes (± 0,1°)`, near(est, deg, 0.1), `${est}°`);
    const det = D.detectPlan(r, { pxPerM: ppm, rotate: est });
    const dr = drift(det);
    check(`1. etasje ${deg}° skjev: de samme ${base.walls.length} veggene og ${kinds(base)} dører/vinduer/åpninger, ≤ 3 cm fra den rette`, det.walls.length === base.walls.length && kinds(det) === kinds(base) && dr <= 3, `${det.walls.length} vegger, ${kinds(det)}, ${dr.toFixed(1)} cm`);
  }
  if (KJELLER_PLAN) {
    const k = readPng(KJELLER_PLAN);
    const kb = D.detectPlan(k, { pxPerM: 633 / 10.5 });
    const r = I.rotateImage(k, 2.2);
    const est = D.estimateSkew(r);
    const det = D.detectPlan(r, { pxPerM: 633 / 10.5, rotate: est });
    check('kjelleren 2,2° skjev: vinkelen, og de samme veggene, dørene og vinduene', near(est, 2.2, 0.1) && det.walls.length === kb.walls.length && kinds(det) === kinds(kb), `${est}°, ${det.walls.length}/${kb.walls.length} vegger, ${kinds(det)} mot ${kinds(kb)}`);
  }
  // a synthetic plan with a known answer, 4° skew, 80 px/m with noise: all walls and openings in the straightened frame
  const plan = samplePlans().lhus;
  const rr = renderPlan(plan, { pxPerM: 80, noise: 6, seed: 8 });
  const rot = I.rotateImage(rr.img, -4);
  const est = D.estimateSkew(rot);
  const m = matchSynthetic(plan, D.detectPlan(rot, { pxPerM: 80, rotate: est }), 80, rr.origin);
  check('syntetisk plan −4° skjev: vinkelen, alle vegger (≤ 3 cm) og åpninger med riktig type', near(est, -4, 0.1) && m.walls === plan.walls.length && m.typed === plan.openings.length, `${est}°, ${m.walls}/${plan.walls.length} vegger, ${m.typed}/${plan.openings.length} åpninger, verste ${(m.worst * 100).toFixed(1)} cm`);
}


section('11. Fasadesjekken: fasadene fra planen');
{
  // 8 × 6 m, north up: one window on each side, a door to the south, walls drawn clockwise and counter-clockwise
  const F = await imp('src/planbygger/facadecheck.js');
  const doc = M.createDoc('Fasader');
  const lv = M.createLevel(doc, { id: 'hoved', image: { name: 'syntetisk', width: 1, height: 1, pxPerM: 100 } });
  lv.walls = [
    { id: 'n', a: [0, 0], b: [8, 0], t: 0.3, exterior: true },
    { id: 'e', a: [8, 6], b: [8, 0], t: 0.3, exterior: true },
    { id: 's', a: [8, 6], b: [0, 6], t: 0.3, exterior: true },
    { id: 'w', a: [0, 0], b: [0, 6], t: 0.3, exterior: true },
  ];
  lv.openings = [
    { id: 'vn', wall: 'n', type: 'window', at: 2, width: 1, sill: 0.9, height: 1.2 },
    { id: 've', wall: 'e', type: 'window', at: 3, width: 0.6, sill: 0.9, height: 1.2 },
    { id: 'vs', wall: 's', type: 'window', at: 6, width: 2, sill: 0, height: 2.1 },
    { id: 'vw', wall: 'w', type: 'window', at: 3, width: 1.2, sill: 0.9, height: 1.2 },
    { id: 'ds', wall: 's', type: 'door', at: 2, width: 0.9 },
  ];
  const fs = F.buildFacades(doc);
  const side = (id) => fs.find((x) => x.openings.some((o) => o.id === id))?.key;
  check('fire fasader, og hvert vindu på sin side (nord, øst, sør, vest)', fs.length === 4 && side('vn') === 'N' && side('ve') === 'E' && side('vs') === 'S' && side('vw') === 'W' && side('ds') === 'S', fs.map((x) => `${x.key}:${x.openings.map((o) => o.id).join('+')}`).join(' '));
  // sett utenfra fra sør står døra (x 2) til høyre for det store vinduet (x 6)
  const S = fs.find((x) => x.key === 'S');
  const at = (id) => S.openings.find((o) => o.id === id).s0;
  check('sett utenfra: på sørfasaden står døra (vest) til høyre for vinduet (øst)', at('ds') > at('vs'), `dør ${at('ds').toFixed(2)}, vindu ${at('vs').toFixed(2)}`);
  // valgene fra fasadesjekken går gjennom eksporten og validatoren
  lv.openings[0].style = 'transom';
  lv.openings[0].panes = [2, 3];
  F.setDoorType(lv.openings[4], 'folding');
  const ex = E.exportHouse(doc);
  const v = await validateGenerated(ex);
  const all = ex.house.walls.flatMap((w) => w.openings || []);
  const vn = all.find((o) => o.type === 'window' && o.width === 1);
  check('vindustype og sprosser, og foldedør, bygges og godtas av validatoren', v.errors.length === 0 && vn?.sashes.length === 3 && vn?.panes?.join('x') === '2x3' && all.some((o) => o.door?.variant === 'folding'), v.errors.slice(0, 2).join(' | '));
}

section('12. Fasadetegningene på riktig side, og himlingene');
{
  const F = await imp('src/planbygger/facadecheck.js');
  const FM = await imp('src/planbygger/facadematch.js');
  const HR = await imp('src/planbygger/houseread.js');
  // the 8 × 6 m house of section 11, an inner wall at x 5 (two rooms)
  const make = () => {
    const doc = M.createDoc('Fasader');
    const lv = M.createLevel(doc, { id: 'hoved', image: { name: 'syntetisk', width: 1, height: 1, pxPerM: 100 } });
    lv.walls = [
      { id: 'n', a: [0, 0], b: [8, 0], t: 0.3, exterior: true },
      { id: 'e', a: [8, 6], b: [8, 0], t: 0.3, exterior: true },
      { id: 's', a: [8, 6], b: [0, 6], t: 0.3, exterior: true },
      { id: 'w', a: [0, 0], b: [0, 6], t: 0.3, exterior: true },
      { id: 'i', a: [5, 0], b: [5, 6], t: 0.1 },
    ];
    lv.openings = [
      { id: 'vn', wall: 'n', type: 'window', at: 2, width: 1, sill: 0.9, height: 1.2 },
      { id: 'vn2', wall: 'n', type: 'window', at: 6.5, width: 0.8, sill: 0.9, height: 1.2 },
      { id: 've', wall: 'e', type: 'window', at: 3, width: 0.6, sill: 0.9, height: 1.2 },
      { id: 'vs', wall: 's', type: 'window', at: 6, width: 2, sill: 0.9, height: 1.2 },
      { id: 'vw', wall: 'w', type: 'window', at: 3, width: 1.2, sill: 0.9, height: 1.2 },
      { id: 'ds', wall: 's', type: 'door', at: 2, width: 0.9 },
    ];
    lv.rooms = [{ id: 'a', seed: [2, 3], name: 'Stue', kind: 'living' }, { id: 'b', seed: [6.5, 3], name: 'Soverom', kind: 'bedroom' }];
    return { doc, lv };
  };
  check('fasadetitlene gir himmelretningen', FM.titleCompass('FASADE SØR') === 'S' && FM.titleCompass('Fasade mot nord') === 'N' && FM.titleCompass('ØST') === 'E' && FM.titleCompass('Vest') === 'W' && FM.titleCompass('Snitt A-A') === null && FM.titleCompass('FASADE NORDØST') === null);
  // a drawing of one side as facade.js reads it: 50 px/m, the wall foot at 400 px, the openings as the side shows them
  // (drawn sill and height: `over` replaces them for some openings)
  const drawingOf = (doc, key, over = {}) => {
    const S = F.buildFacades(doc).find((x) => x.key === key);
    const ppm = 50;
    const x = (s) => 100 + (s - S.sMin) * ppm;
    return {
      pxPerM: ppm,
      span: [x(S.sMin), x(S.sMax)],
      floorYs: [400],
      windows: S.openings.map((o) => {
        const sill = over[o.id]?.sill ?? o.sill;
        const height = over[o.id]?.height ?? o.height;
        return { x0: x(o.s0), x1: x(o.s1) - 1, y0: 400 - (sill + height) * ppm, y1: 400 - sill * ppm - 1, kind: o.win ? 'window' : 'door', storey: 0 };
      }),
    };
  };
  const { doc, lv } = make();
  const south = drawingOf(doc, 'S', { vs: { sill: 0.4, height: 1.7 } });
  const north = drawingOf(doc, 'N');
  const east = drawingOf(doc, 'E');
  const m1 = FM.matchFacades(doc, [{ reading: east, title: null }, { reading: south, title: null }, { reading: north, title: null }], { levelsByNo: { 0: 'hoved' } });
  check('uten titler: hver tegning på sin side (øst, sør, nord) etter vinduene og bredden', m1.drawings.map((d) => d.side).join('') === 'ESN' && m1.north === null, m1.drawings.map((d) => `${d.side}:${d.score}`).join(' '));
  const n = FM.applyFacadeMatch(doc, [{ reading: east }, { reading: south }, { reading: north }], m1);
  const vs = lv.openings.find((o) => o.id === 'vs');
  check('de fire vinduene på de tre fasadene får høyden fra tegningen, sørvinduet 0,4 og 1,7 m (og topp-høyden som tegnet)', n === 4 && Math.abs(vs.sill - 0.4) < 0.03 && Math.abs(vs.height - 1.7) < 0.03 && Math.abs(vs.facadeTop - 2.1) < 0.03, `${n} satt, ${vs.sill}/${vs.height}/${vs.facadeTop}`);
  // the drawing of the plan's bottom side titled «FASADE NORD»: north is down in the image
  const m2 = FM.matchFacades(make().doc, [{ reading: south, title: 'FASADE NORD' }, { reading: east, title: null }], { levelsByNo: { 0: 'hoved' } });
  check('«FASADE NORD» på planens nedre side: nord er ned i planen (180°), og den andre blir vest', m2.north === 180 && m2.drawings[0].side === 'N' && m2.drawings[1].side === 'W', `nord ${m2.north}, ${m2.drawings.map((d) => d.side).join(',')}`);

  // the ceilings: a text's points decide its rooms, without texts the level's rule
  const inA = (q) => q[0] < 5;
  const inB = (q) => q[0] > 5;
  const L1 = { ceilingMarks: [{ kind: 'sloped', points: [[2, 3]], from: 'ki' }] };
  check('«skrå himling» i stua: stua skrå, soverommet flatt (tegningen merket de skrå)', HR.ceilingSlope(L1, inA).slope && !HR.ceilingSlope(L1, inB).slope);
  const L2 = { ceilingMarks: [], ceilingRule: 'roof' };
  // a room the ridge line runs through is sloped (the open hall of hus2) – unless a flat text names it alone (PLANTAK)
  const L3 = { ceilingMarks: [{ kind: 'sloped', points: [[2, 3]], ridge: [[0.3, 3], [7.7, 3]], from: 'ki' }, { kind: 'flat', points: [[6, 3], [-20, 3], [-21, 3]], from: 'ki' }] };
  const L4 = { ceilingMarks: [L3.ceilingMarks[0], { kind: 'flat', points: [[6, 3]], from: 'ki' }] };
  check('mønelinja gjennom soverommet gjør det skrått mot en bred «PLAN HIMLING», men ikke mot «PLANTAK» over bare det', HR.ceilingSlope(L3, inB).slope && !HR.ceilingSlope(L4, inB).slope);
  check('uten tekst og med regelen «roof» (pulttak): alle rom skrå; brukerens valg vinner', HR.ceilingSlope(L2, inB).slope && !HR.ceilingSlope({ ...L2, ceilingMarks: [{ kind: 'flat', points: [[6, 3]], from: 'bruker' }] }, inB).slope);

  // the ridge line the AI read on hus2, along the line drawn: it gives x 0.50–0.93; the line (thin grey, dash-dot in the
  // kitchen) runs at y 0.631 from the hall's west wall (x 0.30) to the east wall – the hall is under the sloped ceiling
  // too (F139; the row of the WC core's wall, y 0.646, stopped it at the core)
  {
    const img = readPng(path.join(ROOT, 'plantegninger/hus2/1etg.png'));
    const r = HR.refineRidge(img, [0.5, 0.646, 0.93, 0.646], 55.7);
    check('hus2: mønelinja forlenget langs den tynne linja, fra gangens vestvegg (x 0,30) til østveggen (x 0,93)', Math.abs(r[0] - 0.304) < 0.01 && Math.abs(r[2] - 0.932) < 0.01 && Math.abs(r[1] - 0.631) < 0.005, r.map((v) => v.toFixed(3)).join(', '));
  }
  // the export: «SKRÅ HIMLING 24°» in the living room with its ridge along the middle → a gable roof, ridge along the
  // house, 24°, and the living room's ceiling up to the ridge; the bedroom flat
  {
    const { doc: d2, lv: l2 } = make();
    l2.ceilingMarks = [{ kind: 'sloped', degrees: 24, text: 'SKRÅ HIMLING 24°', points: [[2, 3]], ridge: [[0.3, 3], [4.7, 3]], from: 'ki' }];
    const ex = E.exportHouse(d2);
    const v = await validateGenerated(ex);
    const roof = ex.house.roofs?.[0];
    const along = ex.frame ? null : null;
    const byName = (nm) => ex.house.ceilings.find((c) => ex.house.rooms.find((r) => r.id === c.roomId)?.name === nm);
    const stue = byName('Stue');
    const sov = byName('Soverom');
    // the plan's x (east) is the game's −z with north up: the ridge runs along z
    check('mønelinja midt i huset: saltak med mønet langs huset, 24°, stua skrå opp til mønet og soverommet flatt, uten feil', ex.house.roofs.length === 1 && roof.type === 'gable' && Math.abs(Math.abs(roof.ridge?.[1] ?? 0) - 1) < 1e-6 && roof.pitch === 24 && stue?.type === 'roof' && stue.height == null && (sov?.type ?? 'flat') !== 'roof' && v.errors.length === 0, `${roof?.type} ${JSON.stringify(roof?.ridge)} ${roof?.pitch}°, stue ${stue?.type}/${stue?.height}, sov ${sov?.type ?? 'flat'}; ${v.errors.slice(0, 2).join(' | ')}`);
    void along;
    // the ridge line along the north wall: a mono-pitch roof high there, falling south (the game's +x)
    l2.ceilingMarks[0].ridge = [[0.3, 0.4], [4.7, 0.4]];
    const ex2 = E.exportHouse(d2);
    const r2 = ex2.house.roofs?.[0];
    check('mønelinja langs nordveggen: pulttak, høyt i nord og med fall mot sør', r2?.type === 'mono-pitch' && (r2.fall?.[0] ?? 0) > 0.9, `${r2?.type} fall ${JSON.stringify(r2?.fall)}`);
  }
  // the stair question offers a steep stair (trappestige), and the answer makes the found stair one
  {
    const Qm = await imp('src/planbygger/questions.js');
    const { doc: d4, lv: l4 } = make();
    l4.stairs = [{ id: 't1', rect: [[1, 1], [2.3, 2]], axis: 'x', down: 1 }];
    const q = Qm.stairQuestion({ level: 'hoved', levelName: '1. etasje', file: 'x.png', crop: null, value: 'none', why: '', stairId: 't1' });
    const out = Qm.applyAnswers(d4, [q], { [q.id]: 'steep' });
    check('trappespørsmålet har «Bratt trapp eller loftstige», og svaret gjør trappa bratt', q.options.some((o) => o.value === 'steep') && out.levels[0].stairs[0].kind === 'steep');
  }
  // the ticks and extension lines of a dimension inside a room, read as short walls (K15, F96, F97): they go; the inner
  // wall at x 5 (it runs wall to wall) stays
  {
    const Gm = await imp('src/planbygger/generate.js');
    const { lv: l6 } = make();
    l6.walls.push({ id: 'tick', a: [0.15, 3], b: [0.29, 3], t: 0.085 }, { id: 'ext', a: [7.5, 0.15], b: [7.5, 0.85], t: 0.085 }, { id: 'thick', a: [2, 0.15], b: [2, 0.8], t: 0.2 });
    const n = Gm.dropStubs(l6);
    check('korte, tynne veggbiter med en løs ende i et rom forsvinner; innerveggen og en tykk stubb blir', n === 2 && !l6.walls.some((w) => w.id === 'tick' || w.id === 'ext') && l6.walls.some((w) => w.id === 'i') && l6.walls.some((w) => w.id === 'thick'), l6.walls.map((w) => w.id).join(','));
    // the end of a dimension line in a corner with an «opening» over most of it, called exterior (hus7, F165, F166): it
    // goes with its opening; a stub with a narrow opening (a real one) stays
    const { lv: l7 } = make();
    l7.walls.push({ id: 'dim', a: [7.6, 0.15], b: [7.6, 0.86], t: 0.085, exterior: true }, { id: 'real', a: [6, 5.85], b: [6, 4.95], t: 0.085 });
    l7.openings.push({ id: 'od', wall: 'dim', type: 'opening', at: 0.4, width: 0.53 }, { id: 'or', wall: 'real', type: 'opening', at: 0.3, width: 0.3 });
    const n7 = Gm.dropStubs(l7);
    check('og en slik stubb med en «åpning» over det meste av seg går, med åpningen; en med en smal åpning blir', n7 === 1 && !l7.walls.some((w) => w.id === 'dim') && !l7.openings.some((o) => o.id === 'od') && l7.walls.some((w) => w.id === 'real'), JSON.stringify({ n7, walls: l7.walls.map((w) => w.id) }));
  }
  // a beam drawn as a double dash-dot line across a room, read as a wall (K14): it goes; a grey filled wall stays
  {
    const Gm = await imp('src/planbygger/generate.js');
    const { lv: l7 } = make();
    const ppm = 50;
    const W = 9 * ppm;
    const H = 7 * ppm;
    const img = { width: W, height: H, data: new Uint8ClampedArray(W * H * 4).fill(255) };
    const ink = (x, y, v) => {
      const i = (y * W + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    };
    // the beam at y 3,0 (0,17 m): two dash-dot edges, paper between
    for (const y of [Math.round(2.915 * ppm), Math.round(3.085 * ppm)]) for (let x = Math.round(5.1 * ppm); x < 7.9 * ppm; x++) if (x % 12 < 7 || x % 12 === 9) ink(x, y, 60);
    // a grey wall at x 5 (the inner wall of make(), 0,1 m)
    for (let y = Math.round(0.15 * ppm); y < 5.85 * ppm; y++) for (let x = Math.round(4.95 * ppm); x <= 5.05 * ppm; x++) ink(x, y, 150);
    l7.walls.push({ id: 'beam', a: [5.05, 3], b: [7.85, 3], t: 0.17 });
    const n = Gm.dropBeams(l7, img, ppm);
    check('en drager tegnet med stiplede kanter og uten fyll tas bort, den grå innerveggen blir', n === 1 && !l7.walls.some((w) => w.id === 'beam') && l7.walls.some((w) => w.id === 'i'), l7.walls.map((w) => w.id).join(','));
    // one «wall» that is a grey wall with a door (x 0,15–4,9) and a beam on from it (x 5,1–7,85), as on hus4: the
    // wall stays, with its door, and the beam goes
    const { lv: l8 } = make();
    l8.walls = l8.walls.filter((w) => w.id !== 'i');
    const img2 = { width: W, height: H, data: new Uint8ClampedArray(W * H * 4).fill(255) };
    const ink2 = (x, y, v) => {
      const i = (y * W + x) * 4;
      img2.data[i] = img2.data[i + 1] = img2.data[i + 2] = v;
    };
    for (let y = Math.round(3.415 * ppm); y <= 3.585 * ppm; y++) for (let x = Math.round(0.15 * ppm); x < 4.9 * ppm; x++) if (x < 1.5 * ppm || x > 2.4 * ppm) ink2(x, y, 150);
    for (const y of [Math.round(3.415 * ppm), Math.round(3.585 * ppm)]) for (let x = Math.round(5.1 * ppm); x < 7.85 * ppm; x++) if (x % 12 < 7 || x % 12 === 9) ink2(x, y, 60);
    l8.walls.push({ id: 'line', a: [0.15, 3.5], b: [7.85, 3.5], t: 0.17 });
    l8.openings.push({ id: 'dl', wall: 'line', type: 'door', at: 1.8, width: 0.9 });
    const n2 = Gm.dropBeams(l8, img2, ppm);
    const kept = l8.walls.find((w) => w.id === 'line-1');
    const door = l8.openings.find((o) => o.id === 'dl');
    check('en vegg med dør som går over i en drager: veggen og døra blir, drageren går', n2 === 1 && !!kept && Math.abs(kept.a[0] - 0.15) < 0.05 && Math.abs(kept.b[0] - 4.9) < 0.15 && door?.wall === 'line-1' && Math.abs(door.at - 1.8) < 0.05 && !l8.walls.some((w) => w.id !== 'line-1' && /^line/.test(w.id)), JSON.stringify({ kept, door }));
  }
  // a terrace drawn with boards outside the east wall: its outline from around the AI's point, on the wall's outer face
  {
    const DF = await imp('src/planbygger/deckfind.js');
    const R = await imp('src/planbygger/regions.js');
    const { lv: l5 } = make();
    const ppm = 50;
    const W = 14 * ppm;
    const H = 8 * ppm;
    const img = { width: W, height: H, data: new Uint8ClampedArray(W * H * 4).fill(255) };
    const ink = (x, y, v = 200) => {
      const i = (y * W + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    };
    // boards: thin grey lines every 0,1 m across x 8,15–11,5 m, y 1–5 m
    for (let y = Math.round(1 * ppm); y < 5 * ppm; y += 5) for (let x = Math.round(8.15 * ppm); x < 11.5 * ppm; x++) ink(x, y, 225);
    const r = DF.findDeck(img, ppm, l5, [9.8, 3], { found: R.levelRooms(l5) });
    const near = (a, b) => Math.abs(a - b) <= 0.15;
    check('terrassen av bord øst for huset: omrisset fra mønsteret, inntil veggens ytterside, og bord', !!r && near(r.outline[0][0], 8.15) && near(r.outline[1][0], 11.5) && near(r.outline[0][1], 1) && near(r.outline[2][1], 5) && r.against === 'e' && r.surface === 'boards', JSON.stringify(r));
    check('og ingen terrasse der det ikke er tegnet noe', DF.findDeck(img, ppm, l5, [3, 7.5], { found: R.levelRooms(l5) }) === null);
  }
  // the cladding the AI read → the house format's (notes/kledning.md; exported once the engine knows the key)
  {
    const cl = E.claddingOf({ levels: [], cladding: { main: { type: 'wood', direction: 'vertical', color: 'mørk grå' }, facades: [{ side: 'S', parts: [{ part: 'all', type: 'wood', direction: 'vertical', color: null }, { part: 'gable', type: 'panels', direction: null, color: 'hvit' }] }] } });
    check('kledningen: stående tømmermannskledning i mørk grå, plater i gavlen som sone, sokkel og hjørnekasser', cl.default.type === 'wood' && cl.default.profile === 'board-batten' && cl.default.color === '#4a4642' && cl.zones?.[0]?.gable === true && cl.zones[0].type === 'panels' && cl.zones[0].color === '#f2f0ea' && cl.plinth.height === 0.3 && cl.trim.corners && E.colorHex('NCS S 7502-B') === null && E.claddingOf({ levels: [] }) === null, JSON.stringify(cl));
  }
  // a lower part with no level over it (hus4's storage room): a flat roof of its own on the lower level
  {
    const { doc: d3, lv: main } = make();
    const up = M.createLevel(d3, { id: 'etasje-1', image: { name: 'syntetisk-2', width: 1, height: 1, pxPerM: 100 } });
    up.floorY = 2.7;
    up.walls = [
      { id: 'un', a: [0, 0], b: [5, 0], t: 0.3, exterior: true },
      { id: 'ue', a: [5, 6], b: [5, 0], t: 0.3, exterior: true },
      { id: 'us', a: [5, 6], b: [0, 6], t: 0.3, exterior: true },
      { id: 'uw', a: [0, 0], b: [0, 6], t: 0.3, exterior: true },
    ];
    up.openings = [];
    up.rooms = [{ id: 'u', seed: [2.5, 3], name: 'Loftstue', kind: 'living' }];
    void main;
    const ex = E.exportHouse(d3);
    const v = await validateGenerated(ex);
    const annex = (ex.house.roofs ?? []).filter((r) => r.levelId === 'hoved');
    const area = (o) => Math.abs(o.reduce((s, p, i) => s + p[0] * o[(i + 1) % o.length][1] - o[(i + 1) % o.length][0] * p[1], 0) / 2);
    check('den lave delen uten etasje over (3 × 6 m) får et flatt tak på sin egen etasje, og huset er uten feil', annex.length === 1 && annex[0].type === 'flat' && area(annex[0].outline) > 12 && area(annex[0].outline) < 22 && v.errors.length === 0, `${annex.length} tak, ${annex[0] ? area(annex[0].outline).toFixed(1) : '–'} m²; ${v.errors.slice(0, 2).join(' | ')}`);
  }
  // a loft's knee wall drawn as a thin line 1,3 m inside the north wall (hus1, F161): a wall of its own there, when
  // the roof over it stands a knee wall's height above the floor; none where no line is drawn
  {
    const Gm = await imp('src/planbygger/generate.js');
    const ppm = 50;
    const W = 9 * ppm;
    const H = 7 * ppm;
    const img = { width: W, height: H, data: new Uint8ClampedArray(W * H * 4).fill(255) };
    for (let x = Math.round(0.15 * ppm); x < 7.85 * ppm; x++) for (const y of [Math.round(1.45 * ppm), Math.round(1.45 * ppm) + 1]) {
      const k = (y * W + x) * 4;
      img.data[k] = img.data[k + 1] = img.data[k + 2] = 70;
    }
    const { lv: l9 } = make();
    const knees = Gm.addKneeWalls(l9, img, ppm, { eaveTop: 0.05, pitch: 44 });
    const kn = knees[0];
    check('kneveggen: den tynne linja 1,3 m innenfor nordveggen blir en vegg langs hele veggen, de andre veggene får ingen', knees.length === 1 && kn.id === 'knee-n' && kn.knee && Math.abs(kn.a[1] - 1.45) < 0.04 && Math.abs(kn.b[1] - 1.45) < 0.04 && Math.min(kn.a[0], kn.b[0]) < 0.05 && Math.max(kn.a[0], kn.b[0]) > 7.95, JSON.stringify(knees));
    const { lv: l10 } = make();
    check('og ingen knevegg der taket over linja står 2,7 m over gulvet (takfoten 1,5 m, 40°)', Gm.addKneeWalls(l10, img, ppm, { eaveTop: 1.5, pitch: 40 }).length === 0);
  }
  // a loft under a gable roof, the facades read: the eave 5 cm over the loft floor, the long sides' 2,9 m rise over the
  // 6 m depth (44°), shed dormers (hus1, F157–F159)
  {
    const { doc: d4 } = make();
    const up = M.createLevel(d4, { id: 'loft', name: 'Loft', image: { name: 'syntetisk-2', width: 1, height: 1, pxPerM: 100 } });
    up.floorY = 2.7;
    up.walls = [
      { id: 'un', a: [0, 0], b: [8, 0], t: 0.3, exterior: true },
      { id: 'ue', a: [8, 6], b: [8, 0], t: 0.3, exterior: true },
      { id: 'us', a: [8, 6], b: [0, 6], t: 0.3, exterior: true },
      { id: 'uw', a: [0, 0], b: [0, 6], t: 0.3, exterior: true },
    ];
    up.openings = [{ id: 'uv', wall: 'us', type: 'window', at: 4, width: 1, sill: 0.3, height: 1.4 }];
    up.rooms = [{ id: 'u', seed: [4, 3], name: 'Loftstue', kind: 'living' }];
    d4.roof = { type: 'gable', from: 'fasader', eaveTop: 0.05, riseFacades: 2.9, dormerType: 'shed' };
    const ex = E.exportHouse(d4);
    const v = await validateGenerated(ex);
    const r = (ex.house.roofs ?? []).find((x) => x.levelId === 'loft');
    check('loftet: takfoten 5 cm over gulvet, vinkelen fra fasadenes høyde (2,9 m over 6,3 m: 43°), og vinduet over takfoten får en pultark', !!r && r.type === 'gable' && r.eaveHeight === 0.05 && r.kneeHeight === undefined && r.pitch >= 42 && r.pitch <= 45 && r.dormers?.length === 1 && r.dormers[0].type === 'shed' && v.errors.length === 0, JSON.stringify({ r: r && { type: r.type, eave: r.eaveHeight, pitch: r.pitch, dormers: r.dormers }, errors: v.errors.slice(0, 2) }));
  }
  // a stair along an upper exterior wall (hus4, F152): the hole stays 6 cm off the wall's face, so the wall's bottom
  // edge never shows through the floor
  {
    const doc = M.createDoc('Trapp mot ytterveggen');
    const box = (lv) => {
      lv.walls = [
        { id: 'n', a: [0, 0], b: [8, 0], t: 0.25, exterior: true },
        { id: 'e', a: [8, 0], b: [8, 6], t: 0.25, exterior: true },
        { id: 's', a: [8, 6], b: [0, 6], t: 0.25, exterior: true },
        { id: 'w', a: [0, 6], b: [0, 0], t: 0.25, exterior: true },
      ];
      lv.openings = [];
    };
    box(M.createLevel(doc, { id: 'hoved', floorY: 0 }));
    box(M.createLevel(doc, { id: 'oppe', name: '2. etasje', floorY: 2.7 }));
    M.addStair(doc.levels[1], [1.0, 0.125], [4.6, 1.1]);
    const ex = E.exportHouse(doc);
    const v = await validateGenerated(ex);
    const hole = ex.house.floorOpenings?.[0]?.polygon ?? [];
    const lv = new Map(ex.house.rooms.map((r) => [r.id, r.levelId]));
    const ext = ex.house.walls.filter((w) => w.exterior && lv.get(w.roomId) === 'oppe');
    const off = (p, w) => {
      const d = [w.to[0] - w.from[0], w.to[1] - w.from[1]];
      const L = Math.hypot(d[0], d[1]);
      return Math.abs((p[0] - w.from[0]) * d[1] - (p[1] - w.from[1]) * d[0]) / L;
    };
    const gap = Math.min(...hole.map((p) => Math.min(...ext.map((w) => off(p, w)))));
    check('trappehullet langs ytterveggen oppe: minst 5 cm fra veggflaten, og huset er uten feil', hole.length >= 4 && gap >= 0.05 && gap < 0.2 && v.errors.length === 0, `${gap.toFixed(3)} m; ${v.errors.slice(0, 2).join(' | ')}`);
  }
  // a carport against the house, open to the north (hus4, F147, F150): closed there by a wall that is one passage, so
  // it is a room (its walls in the house, a concrete floor)
  {
    const Gm = await imp('src/planbygger/generate.js');
    const R = await imp('src/planbygger/regions.js');
    const { lv: lc } = make();
    lc.walls.push({ id: 'cs', a: [8, 6], b: [11.5, 6], t: 0.2, exterior: true }, { id: 'ce', a: [11.5, 0.5], b: [11.5, 6], t: 0.2, exterior: true });
    const how = Gm.closeAround(lc, [9.75, 3]);
    const w = lc.walls.find((x) => x.from === 'closed');
    const port = lc.openings.find((o) => o.wall === w?.id);
    const found = R.levelRooms(lc);
    const room = found.rooms.find((r) => r.index === found.at(9.75, 3));
    check('carporten åpen mot nord: lukket der den korteste sideveggen slutter, med én åpning, og et rom på 16–20 m²', !!how && !!w && Math.abs(w.a[1] - 0.5) < 0.01 && port?.type === 'opening' && port.width > 3 && !!room && room.area > 16 && room.area < 20, JSON.stringify({ how, w, port, area: room?.area }));
    const { lv: ld } = make();
    check('og ingenting å lukke midt i et rom med vegger på alle sider', Gm.closeAround(ld, [2, 3]) === null);
  }
  // a terrace over the low part (no level over it) and a balcony along the upper level touching it (hus4, F153, F150):
  // one deck, standing on the house, and no flat roof of its own under it
  {
    const { doc: d5 } = make();
    const up = M.createLevel(d5, { id: 'oppe', name: '2. etasje', image: { name: 'syntetisk-2', width: 1, height: 1, pxPerM: 100 } });
    up.floorY = 2.7;
    up.walls = [
      { id: 'un', a: [0, 0], b: [5, 0], t: 0.3, exterior: true },
      { id: 'ue', a: [5, 6], b: [5, 0], t: 0.3, exterior: true },
      { id: 'us', a: [5, 6], b: [0, 6], t: 0.3, exterior: true },
      { id: 'uw', a: [0, 0], b: [0, 6], t: 0.3, exterior: true },
    ];
    up.openings = [{ id: 'ud', wall: 'ue', type: 'door', at: 3, width: 0.9 }];
    up.rooms = [{ id: 'u', seed: [2.5, 3], name: 'Stue', kind: 'living' }];
    d5.decks = [
      { kind: 'terrace', level: 'oppe', railing: 'glass', outline: [[5.15, -0.15], [8.15, -0.15], [8.15, 6.15], [5.15, 6.15]], surface: 'tiles' },
      { kind: 'balcony', level: 'oppe', railing: 'glass', outline: [[0, 6.15], [8.15, 6.15], [8.15, 7.3], [0, 7.3]], surface: 'boards' },
    ];
    const ex = E.exportHouse(d5);
    const v = await validateGenerated(ex);
    const dk = ex.house.decks ?? [];
    const area = (o) => Math.abs(o.reduce((a, p, k) => a + p[0] * o[(k + 1) % o.length][1] - o[(k + 1) % o.length][0] * p[1], 0) / 2);
    const low = (ex.house.roofs ?? []).filter((r) => r.levelId === 'hoved');
    check('terrassen over den lave delen og balkongen langs etasjen: ett dekk, fliser, som står på huset, og ikke noe flatt tak under det', dk.length === 1 && Math.abs(area(dk[0].outline) - 28.3) < 0.8 && dk[0].surface === 'tiles' && dk[0].supports === 'none' && low.length === 0 && v.errors.length === 0, JSON.stringify({ decks: dk.map((x) => ({ area: area(x.outline).toFixed(1), surface: x.surface, supports: x.supports })), low: low.length, errors: v.errors.slice(0, 2) }));
    d5.decks[1].outline = [[0, 6.15], [8.15, 6.15], [8.15, 9.3], [0, 9.3]];
    const ex2 = E.exportHouse(d5);
    check('men et dekk som går 3 m ut over bakken, står på stolper', (ex2.house.decks ?? []).length === 1 && ex2.house.decks[0].supports === undefined);
  }
  // a living room open to the entrance along a line with no wall (hus4's beam line, F151): one floor, the living room's
  {
    const { doc: d6, lv: l6 } = make();
    l6.walls = l6.walls.filter((w) => w.id !== 'i');
    l6.openings = l6.openings.filter((o) => o.wall !== 'i');
    l6.separators = [{ id: 's-1', a: [5, 0], b: [5, 6] }];
    l6.rooms = [{ id: 'a', seed: [2, 3], name: 'Stue', kind: 'living' }, { id: 'b', seed: [6.5, 3], name: 'Entré', kind: 'entrance' }];
    const ex = E.exportHouse(d6);
    const fl = ex.house.rooms.map((r) => r.floor.material);
    check('stua og entréen uten vegg mellom: samme gulv (stuas eik)', fl.length === 2 && fl.every((m) => m === 'oak-plank'), fl.join(', '));
  }
  // the storeys' height from the facades' floor lines (hus4, F164): floor to floor, the median of the drawings
  {
    const drawings = [{ reading: { floorYs: [500, 213], storeys: 2, pxPerM: 100 } }, { reading: { floorYs: [800, 511], storeys: 2, pxPerM: 100 } }];
    const match = { drawings: [{ planSide: 'S', k: 1 }, { planSide: 'N', k: 1 }] };
    const rf = FM.roofFromFacades(drawings, match);
    check('etasjehøyden fra fasadenes gulvlinjer: 2,87 m fra gulv til gulv (medianen)', rf.storeyHeight === 2.87, JSON.stringify(rf));
  }
  // a loft by its eave, not by «Loftstue» (hus11, hus12: full upper floors with a «Loftstue» got knee walls and dormers)
  {
    const names = ['Loft', 'Loftet', 'Loftsrom', 'Loftetasje', 'Hems/loft'].every((n) => M.LOFT_NAME.test(n)) && !['Loftstue', 'Gang/trapp + Loftstue', 'Loftsgang', 'Stue'].some((n) => M.LOFT_NAME.test(n));
    const up = { floorY: 2.7, name: '2. etasje' };
    const lofts = [
      E.loftLevel({ roof: { eaveTop: 2.31 } }, up, ['Loftstue/Trapp']),
      E.loftLevel({ roof: { eaveTop: 0.92 } }, up, ['Stue']),
      E.loftLevel({ roof: {} }, up, ['Loftstue']),
      E.loftLevel({ roof: {} }, up, ['Loft']),
    ];
    check('loftet: «Loft» men ikke «Loftstue» i navnet, og med fasadenes takfot er takfoten det som avgjør (2,31 m: ikke loft, 0,92 m: loft)', names && lofts.join() === 'false,true,false,true', lofts.join());
    // the eave is read on the long sides only: an end's «eave» is the foot of the gable (hus11's ends gave 1,05 and −0,52)
    const rf = FM.roofFromFacades([{ reading: { floorYs: [765, 555], storeys: 2, pxPerM: 100, eaveY: 324, roofView: 'long' } }, { reading: { floorYs: [779, 532], storeys: 2, pxPerM: 100, eaveY: 427 } }], { drawings: [{ planSide: 'S', k: 1 }, { planSide: 'E', k: 1 }] });
    check('takfoten bare fra langsidene: 2,31 m, gavlens fot teller ikke', rf.eaveTop === 2.31, JSON.stringify(rf));
    // a window made a door loses the window's sill and height (a 1,2 m door in hus11's slanted wall)
    const o = { type: 'window', width: 0.9, sill: 0.9, height: 1.2, facadeTop: 2.1 };
    M.setOpeningKind(o, 'single');
    check('et vindu som blir dør, mister vinduets brystning og høyde', o.type === 'door' && o.sill === undefined && o.height === undefined && o.facadeTop === undefined, JSON.stringify(o));
  }
  // a window's sashes and bars from its panes in the facade drawing (F141, F144): at 100 px/m two sashes of 2 × 3
  // panes (bars of 3 cm, 11 cm between the sashes), a transom over two sashes, and nothing from a drawing too small
  {
    const Fc = await imp('src/planbygger/facade.js');
    const box = (x0, y0, x1, y1) => ({ x0, y0, x1, y1 });
    const panes = [];
    for (const [c0, c1] of [[0, 22], [26, 48], [60, 82], [86, 108]]) for (const [r0, r1] of [[0, 30], [34, 64], [68, 98]]) panes.push(box(c0, r0, c1, r1));
    const g1 = Fc.paneGrid(panes, 100, 99);
    const g2 = Fc.paneGrid([box(0, 0, 108, 25), box(0, 35, 48, 150), box(60, 35, 108, 150)], 100, 151);
    check('vinduet fra fasadetegningen: to rammer med 2 × 3 ruter, et overlys over to rammer, og ingenting fra en tegning på 10 px/m', g1?.sashes === 2 && !g1.transom && g1.panes[0] === 2 && g1.panes[1] === 3 && g2?.sashes === 2 && g2.transom === true && Fc.paneGrid(panes, 10, 99) === null, JSON.stringify({ g1, g2 }));
    // behind a balcony along the wall, the railing's rails are no bars
    const { doc: d8, lv: l8 } = make();
    d8.decks = [{ kind: 'balcony', level: 'hoved', outline: [[0, 6.15], [8, 6.15], [8, 7.4], [0, 7.4]] }];
    const FMb = await imp('src/planbygger/facadematch.js');
    check('og et vindu i veggen mot en balkong står bak rekkverket, et vindu i en annen vegg gjør ikke det', FMb.behindDeck(d8, l8, l8.openings.find((o) => o.id === 'vs')) && !FMb.behindDeck(d8, l8, l8.openings.find((o) => o.id === 'vn')));
  }
  // two wall stubs standing into one room from its north wall (hus2's living room, F140): each stub is built with its
  // thickness on one face, none paired with the other stub across the room
  {
    const { doc: d7, lv: l7 } = make();
    l7.walls.push({ id: 'st1', a: [1.5, 0.15], b: [1.5, 2.6], t: 0.15 }, { id: 'st2', a: [3.5, 0.15], b: [3.5, 2.2], t: 0.15 });
    const ex = E.exportHouse(d7);
    const v = await validateGenerated(ex);
    const len = (w) => Math.hypot(w.to[0] - w.from[0], w.to[1] - w.from[1]);
    // each stub's two long faces: 2.05 and 2.45 m (from the north wall's inner face to the stub's end)
    const built = [2.05, 2.45].map((L) => ex.house.walls.filter((w) => Math.abs(len(w) - L) < 0.03).map((w) => w.thickness ?? 0).sort((x, y) => y - x));
    check('to stubber inn i samme rom: hver bygd med 15 cm på én side, og huset er uten feil', built.every((ts) => ts.length === 2 && Math.abs(ts[0] - 0.15) < 0.01 && ts[1] === 0) && v.errors.length === 0, JSON.stringify({ built, errors: v.errors.slice(0, 2) }));
  }
}

// ---------------------------------------------------------------------------------------------------------------
section('13. Motorfunksjonene i «Generer»');
// the 8 × 6 m house of section 12 with a carport east of it, open to the east (closed by closeAround), a door from the
// bedroom into it; the facades read as hus4's: horizontal beige boards, and on the side looking into the carport an
// «other» part in grey (the store's front, F149)
const carportHouse = async () => {
  const Gm = await imp('src/planbygger/generate.js');
  const doc = M.createDoc('Carport');
  const lv = M.createLevel(doc, { id: 'hoved', image: { name: 'syntetisk', width: 1, height: 1, pxPerM: 100 } });
  lv.walls = [
    { id: 'n', a: [0, 0], b: [8, 0], t: 0.3, exterior: true },
    { id: 'e', a: [8, 6], b: [8, 0], t: 0.3, exterior: true },
    { id: 's', a: [8, 6], b: [0, 6], t: 0.3, exterior: true },
    { id: 'w', a: [0, 0], b: [0, 6], t: 0.3, exterior: true },
    { id: 'i', a: [5, 0], b: [5, 6], t: 0.1 },
    { id: 'cn', a: [8, 0], b: [11.5, 0], t: 0.2, exterior: true },
    { id: 'cs', a: [8, 6], b: [11.5, 6], t: 0.2, exterior: true },
  ];
  lv.openings = [
    { id: 'vn', wall: 'n', type: 'window', at: 2, width: 1, sill: 0.9, height: 1.2 },
    { id: 'ds', wall: 's', type: 'door', at: 2, width: 0.9 },
    { id: 'dc', wall: 'e', type: 'door', at: 3, width: 0.9 },
  ];
  const how = Gm.closeAround(lv, [9.75, 3]);
  lv.rooms = [{ id: 'a', seed: [2, 3], name: 'Stue', kind: 'living' }, { id: 'b', seed: [6.5, 3], name: 'Bod', kind: 'storage' }, { id: 'c', seed: [9.75, 3], name: 'Carport', kind: 'storage', outdoor: 'carport' }];
  const main = { type: 'wood', direction: 'horizontal', color: 'beige/brun' };
  doc.cladding = { main, facades: [{ side: 'E', parts: [{ part: 'all', ...main }, { part: 'other', type: 'render', direction: null, color: 'grå' }] }, { side: 'N', parts: [{ part: 'other', type: 'wood', direction: 'vertical', color: 'hvit' }] }] };
  return { doc, lv, how };
};
// 1. the carport is a room outside (notes/uterom.md): rooms[].outdoor, a cast floor, the soffit in the cladding's colour,
// a downlight; the front of the store inside it as the facade looking in shows it, its door grey too (F149)
{
  const { doc, how } = await carportHouse();
  const ex = E.exportHouse(doc);
  const v = await validateGenerated(ex);
  const car = ex.house.rooms.find((r) => r.name === 'Carport');
  const light = ex.house.builtInLights.find((l) => l.roomId === car?.id);
  const zone = ex.house.cladding?.zones?.find((z) => z.id === `front-${car?.id}`);
  const door = ex.house.walls.flatMap((w) => w.openings ?? []).find((o) => o.type === 'door' && o.connects?.includes(car?.id));
  check('carporten er et uterom: outdoor, betonggulv #a7a49e, himlingsbord i kledningens farge og en downlight', !!how && car?.outdoor === 'carport' && car.floor.material === 'concrete' && car.floor.color === '#a7a49e' && car.soffit?.type === 'boards' && car.soffit.color === '#b39e80' && light?.type === 'downlight' && light.lumens >= 350 && light.lumens <= 800, JSON.stringify({ how, car, light }));
  check('bodfronten inne i carporten (F149): grå plater som sone på carportens vegg mot boden, og døra grå i samme farge', zone?.type === 'panels' && zone.color === '#8b8b88' && zone.walls.length >= 1 && zone.walls.every((id) => ex.house.walls.find((w) => w.id === id)?.roomId === car.id) && door?.door?.leafColor === '#8b8b88' && door.door.lining?.color === '#8b8b88' && door.frame?.color === '#8b8b88', JSON.stringify({ zone, door }));
  check('og huset med carporten er uten feil i validatoren', v.errors.length === 0, v.errors.slice(0, 3).join(' | '));
  // without the «other» part on the side it is open to, no front zone, and the door is an outer door in the frame colour
  doc.cladding.facades[0].parts.pop();
  const ex2 = E.exportHouse(doc);
  const door2 = ex2.house.walls.flatMap((w) => w.openings ?? []).find((o) => o.type === 'door' && o.connects?.includes(car.id));
  check('uten et eget felt på fasaden inn mot carporten: ingen sone, og døra er en ytterdør (mørk karm, ikke glass)', !(ex2.house.cladding?.zones ?? []).some((z) => /^front-/.test(z.id)) && door2?.frame?.color === '#25272b' && !door2.door.glass && !door2.door.leafColor, JSON.stringify(door2));
}
// 2. the furniture (notes/moblering-genererte-hus.md): the AI's symbols as hints in the house's metres on their level, a
// room's use where its name says nothing (the AI read «Rom» as an office), none where it does («Kjøkken»)
{
  const { doc, lv } = await carportHouse();
  lv.rooms[0] = { ...lv.rooms[0], name: 'Rom', use: 'office' };
  lv.rooms[1] = { ...lv.rooms[1], name: 'Kjøkken', use: 'kitchen' };
  lv.furniture = [{ kind: 'sofa', at: [2, 3] }, { kind: 'bed', at: [6.5, 3] }, { kind: 'other', at: [1, 1] }];
  const ex = E.exportHouse(doc);
  const v = await validateGenerated(ex);
  const f = ex.house.furnishing;
  const g = ex.frame.toGame([2, 3], 'hoved');
  const rom = ex.house.rooms.find((r) => r.name === 'Rom');
  const kj = ex.house.rooms.find((r) => r.name === 'Kjøkken');
  check('møblene: KI-ens sofa og seng som hint i husets meter på etasjen, «other» utelatt; kontoret får bruken, kjøkkenet har den i navnet', f?.hints?.length === 2 && f.hints[0].kind === 'sofa' && Math.abs(f.hints[0].at[0] - g[0]) < 1e-3 && Math.abs(f.hints[0].at[1] - g[1]) < 1e-3 && f.hints[0].levelId === 'hoved' && f.rooms?.[rom.id]?.use === 'office' && !f.rooms?.[kj.id] && v.errors.length === 0, JSON.stringify({ f, errors: v.errors.slice(0, 2) }));
  M.rescaleLevel(lv, 50);
  check('og symbolene skaleres med etasjen når målestokken rettes', lv.furniture[0].at[0] === 4 && lv.furniture[0].at[1] === 6, JSON.stringify(lv.furniture[0]));
}
// 3. the light (notes/belysning-genererte-hus.md): `lighting` for the engine's rules instead of a ceiling lamp and a group
// per room (the carport keeps its downlight); a living room with the kitchen symbol in it is a kitchen-living room, a
// table away from the sofa a dining table with pendants (along the room), a table in front of the sofa a coffee table
{
  const { doc, lv } = await carportHouse();
  lv.furniture = [{ kind: 'kitchen', at: [0.6, 3] }, { kind: 'table', at: [3, 3] }, { kind: 'sofa', at: [7, 2] }, { kind: 'table', at: [7, 3] }];
  lv.rooms[1] = { ...lv.rooms[1], name: 'Rom', kind: 'living', use: 'office' };
  const ex = E.exportHouse(doc);
  const v = await validateGenerated(ex);
  const H = ex.house;
  const stue = H.rooms.find((r) => r.name === 'Stue');
  const rom = H.rooms.find((r) => r.name === 'Rom');
  const car = H.rooms.find((r) => r.outdoor);
  const dining = H.lighting?.hints?.filter((x) => x.type === 'dining-table') ?? [];
  const g = ex.frame.toGame([3, 3], 'hoved');
  check('lyset: lighting «standard», ingen taklampe eller gruppe per rom, carporten beholder downlighten', H.lighting?.level === 'standard' && H.builtInLights.length === 1 && H.builtInLights[0].roomId === car.id && H.lightGroups.length === 1 && v.errors.length === 0, JSON.stringify({ lights: H.builtInLights.map((l) => l.roomId), groups: H.lightGroups.map((x) => x.id), errors: v.errors.slice(0, 2) }));
  check('stua med kjøkkensymbolet er kjøkken/stue, «Rom» som KI-en leste som kontor er kontor', stue?.use === 'kitchen-living' && rom?.use === 'office', JSON.stringify({ stue: stue?.use, rom: rom?.use }));
  check('bordet i stua gir pendler over spisebordet (langs rommet), bordet foran sofaen er et sofabord og gir ingen', dining.length === 1 && Math.abs(dining[0].position[0] - g[0]) < 1e-3 && Math.abs(dining[0].position[1] - g[1]) < 1e-3 && [0, 90].includes(dining[0].angle) && H.furnishing.hints.filter((x) => x.kind === 'coffee-table').length === 1, JSON.stringify({ dining, hints: H.furnishing.hints }));
}
// 4. the stove and its chimney (notes/peis-og-ovn.md, F167): a stove symbol by a wall in the living room is a stove with a
// steel chimney (no floor over it); a stove by the kitchen symbol is the cooker; a fireplace symbol in a store is the
// chimney's foot (a masonry chimney there, no fireplace); the room with the fire keeps its own light group
{
  const { doc, lv } = await carportHouse();
  lv.furniture = [{ kind: 'stove', at: [0.6, 3] }, { kind: 'kitchen', at: [4.5, 1] }, { kind: 'stove', at: [4.5, 1.8] }, { kind: 'fireplace', at: [6.5, 5.5] }];
  const ex = E.exportHouse(doc);
  const v = await validateGenerated(ex);
  const H = ex.house;
  const stue = H.rooms.find((r) => r.name === 'Stue');
  const fp = H.fireplaces ?? [];
  const pipeOf = (id) => H.chimneys.find((c) => c.id === id);
  check('ovnen ved veggen i stua: en vedovn med stålpipe, ingen ovn ved kjøkkenet, pipefoten i boden uten ildsted', fp.length === 1 && fp[0].type === 'stove' && fp[0].roomId === stue.id && pipeOf(fp[0].chimney)?.material === 'steel' && H.chimneys.length === 2 && H.chimneys.some((c) => c.material === 'brick' && Array.isArray(c.at)), JSON.stringify({ fp, chimneys: H.chimneys }));
  check('stua med ilden har sin egen lysgruppe (ikke ildens), og huset er uten feil', H.lightGroups.some((x) => x.id === stue.id && x.roomId === stue.id) && v.errors.length === 0, JSON.stringify({ groups: H.lightGroups, errors: v.errors.slice(0, 3) }));
}
// 5. the kitchen and the bathroom (notes/kjokken-bad-genererte-hus.md): «Kjøkken» without a counter on the plan gets a
// bench along its longest free wall with the sink, the hob, the fridge and the wall cabinets; «Bad» with a WC and a
// shower symbol gets the WC on the nearest wall, the shower in the corner, a basin with its mirror, and tiles
{
  const { doc, lv } = await carportHouse();
  lv.rooms[0] = { ...lv.rooms[0], name: 'Kjøkken' };
  lv.rooms[1] = { ...lv.rooms[1], name: 'Bad', kind: 'bathroom' };
  lv.furniture = [{ kind: 'toilet', at: [6.5, 0.5] }, { kind: 'shower', at: [7.5, 5.4] }];
  const ex = E.exportHouse(doc);
  const v = await validateGenerated(ex);
  const H = ex.house;
  const kj = H.rooms.find((r) => r.name === 'Kjøkken');
  const bad = H.rooms.find((r) => r.name === 'Bad');
  const of = (room, type) => (H.builtIns ?? []).filter((b) => b.roomId === room.id && b.type === type);
  const types = (room) => (H.builtIns ?? []).filter((b) => b.roomId === room.id).map((b) => b.type).sort().join(',');
  const bench = of(kj, 'kitchen-bench')[0];
  const wallOf = (b) => H.walls.find((w) => w.id === b?.wallId);
  check('kjøkkenet uten benk på planen: benk langs den lengste ledige veggen med kum, koketopp, ovn, oppvaskmaskin, kjøleskap, ventilator og overskap', !!bench && bench.dims.w >= 1.8 && wallOf(bench)?.roomId === kj.id && ['sink', 'hob', 'oven', 'dishwasher', 'fridge-freezer', 'hood', 'wall-cabinets'].every((t) => of(kj, t).length >= 1), types(kj));
  const wc = of(bad, 'wc')[0];
  const shower = of(bad, 'shower')[0];
  const sp = shower ? ex.frame.toPlan([shower.position[0], shower.position[2]], 'hoved') : null;
  check('badet: WC-en på veggen, dusjen inn i hjørnet (0,45 m fra begge veggene), servant med speil, fliser på gulvet og veggene', wallOf(wc)?.roomId === bad.id && !!sp && Math.abs(sp[0] - (8 - 0.15 - 0.45)) < 0.02 && Math.abs(sp[1] - (6 - 0.15 - 0.45)) < 0.02 && of(bad, 'vanity').length === 1 && of(bad, 'mirror').length === 1 && bad.floor.material === 'tiles' && bad.wallTiles === true && H.lighting.hints.some((x) => x.type === 'mirror'), JSON.stringify({ types: types(bad), sp, floor: bad.floor, wallTiles: bad.wallTiles }));
  check('og huset med kjøkken og bad er uten feil i validatoren', v.errors.length === 0, v.errors.slice(0, 3).join(' | '));
}
// 6. the site (notes/uteomradet.md): the ground line of a facade drawing matched to the south side, 30 px under its
// floor line at 100 px/m, is a terrain line 0,3 m under the main floor along the south walls' outer face
{
  const { doc } = await carportHouse();
  doc.facades = [{ file: 'fasade.png', side: 'S', fit: { planSide: 'S', a: 0, k: 1, span0: 0, ppm: 100, floor0: 400, ground: 430 } }, { file: 'uten-bakke.png', side: 'N', fit: { planSide: 'N', a: 0, k: 1, span0: 0, ppm: 100, floor0: 400 } }];
  const ex = E.exportHouse(doc);
  const v = await validateGenerated(ex);
  const lines = ex.house.site?.terrain?.lines ?? [];
  const south = Math.max(...ex.house.walls.filter((w) => w.exterior && w.normal[0] < -0.9).map((w) => w.from[0] + w.thickness));
  check('tomta: én terrenglinje på sørsiden, 0,3 m under gulvet, langs ytterflaten; ingen der tegningen ikke har bakkelinje', lines.length === 1 && lines[0].side === 'S' && lines[0].points.every((p) => p[2] === -0.3 && Math.abs(p[0] - south) < 0.01) && v.errors.length === 0, JSON.stringify({ lines, south, errors: v.errors.slice(0, 2) }));
}
// 7. the roofs (notes/tak.md): hus1's long side seen in its facade drawing is a half-hip (the upper corners cut off), and
// a loft under a half-hip gets the type, the hips' height from the drawings and its dormer; a lower wing the AI gave a
// roof of its own gets that roof, not a flat one
{
  const Fc = await imp('src/planbygger/facade.js');
  const r1 = Fc.readFacade(readPng(path.join(ROOT, 'plantegninger/_png/hus1/fasade3.png')));
  const r2 = Fc.readFacade(readPng(path.join(ROOT, 'plantegninger/_png/hus5/fasade3.png')));
  check('hus1s langside: halvvalm (endene skrått opp til mønet), med hvor langt valmen går ned; hus5s langside (saltak) er ikke det', r1.roof === 'half-hip' && r1.roofHipDrop > 0 && r1.roofView === 'long' && r2.roofView === 'long' && r2.roof !== 'half-hip', JSON.stringify({ hus1: [r1.roof, r1.roofHipDrop], hus5: r2.roof }));
  const doc = M.createDoc('Halvvalm');
  const box = (lv) => {
    lv.walls = [
      { id: 'n', a: [0, 0], b: [8, 0], t: 0.3, exterior: true },
      { id: 'e', a: [8, 6], b: [8, 0], t: 0.3, exterior: true },
      { id: 's', a: [8, 6], b: [0, 6], t: 0.3, exterior: true },
      { id: 'w', a: [0, 0], b: [0, 6], t: 0.3, exterior: true },
    ];
    lv.openings = [];
  };
  box(M.createLevel(doc, { id: 'hoved', image: { name: 'syntetisk', width: 1, height: 1, pxPerM: 100 } }));
  const up = M.createLevel(doc, { id: 'loft', name: 'Loft', image: { name: 'syntetisk-2', width: 1, height: 1, pxPerM: 100 } });
  box(up);
  up.floorY = 2.7;
  up.openings = [{ id: 'uv', wall: 's', type: 'window', at: 4, width: 1, sill: 0.3, height: 1.4 }];
  up.rooms = [{ id: 'u', seed: [4, 3], name: 'Loftstue', kind: 'living' }];
  doc.roof = { type: 'half-hip', from: 'fasader', eaveTop: 0.05, riseFacades: 2.9, hipDrop: 1.3, dormerType: 'shed' };
  const ex = E.exportHouse(doc);
  const v = await validateGenerated(ex);
  const rf = ex.house.roofs.find((x) => x.levelId === 'loft');
  const want = 1.3 - 0.1 * Math.tan((rf?.pitch * Math.PI) / 180);
  check('loftet under halvvalm: typen, valmens høyde fra fasadene (ned til vannbordet, minus utstikket), arken, uten feil', rf?.type === 'half-hip' && Math.abs(rf.hipHeight - want) < 0.01 && rf.dormers?.length === 1 && v.errors.length === 0, JSON.stringify({ rf: rf && { type: rf.type, pitch: rf.pitch, hip: rf.hipHeight, dormers: rf.dormers?.length }, errors: v.errors.slice(0, 2) }));
  // a one-storey wing beside a two-storey part, its own mono-pitch roof (the AI's wing on the lower level)
  const d2 = M.createDoc('Fløy');
  box(M.createLevel(d2, { id: 'hoved', image: { name: 'syntetisk', width: 1, height: 1, pxPerM: 100 } }));
  d2.levels[0].walls.push({ id: 'i', a: [5, 0], b: [5, 6], t: 0.1 });
  d2.levels[0].rooms = [{ id: 'a', seed: [2, 3], name: 'Stue', kind: 'living' }, { id: 'b', seed: [6.5, 3], name: 'Garasje', kind: 'storage' }];
  const u2 = M.createLevel(d2, { id: 'oppe', name: '2. etasje', image: { name: 'syntetisk-2', width: 1, height: 1, pxPerM: 100 } });
  u2.floorY = 2.7;
  u2.walls = [
    { id: 'un', a: [0, 0], b: [5, 0], t: 0.3, exterior: true },
    { id: 'ue', a: [5, 6], b: [5, 0], t: 0.3, exterior: true },
    { id: 'us', a: [5, 6], b: [0, 6], t: 0.3, exterior: true },
    { id: 'uw', a: [0, 0], b: [0, 6], t: 0.3, exterior: true },
  ];
  u2.openings = [];
  u2.rooms = [{ id: 'u', seed: [2.5, 3], name: 'Sov', kind: 'bedroom' }];
  d2.roof = { type: 'gable', wings: [{ level: 'hoved', points: [[6.5, 3]], type: 'mono-pitch', ridge: null, fall: [1, 0] }] };
  const ex2 = E.exportHouse(d2);
  const v2 = await validateGenerated(ex2);
  const low = (ex2.house.roofs ?? []).filter((x) => x.levelId === 'hoved');
  const fall = ex2.frame.vecToGame([1, 0]);
  check('fløyen i én etasje får sitt eget pulttak fra KI-en (fallet bort fra huset), ikke flatt tak', low.length === 1 && low[0].type === 'mono-pitch' && Math.abs(low[0].fall[0] - fall[0]) < 1e-3 && Math.abs(low[0].fall[1] - fall[1]) < 1e-3 && v2.errors.length === 0, JSON.stringify({ low, errors: v2.errors.slice(0, 2) }));
  // a window drawn up under the roof in a gable end of an upper floor whose ceilings follow the roof (a gable roof: a
  // half-hip's hip cuts the gable wall's top off level, a loft's collar beam stops it): its top follows the roof, as
  // high as the facade draws it
  doc.roof = { type: 'gable', from: 'fasader', eaveTop: 1.8, riseFacades: 2.9 };
  doc.levels.find((l) => l.id === 'loft').name = 'Oppe';
  doc.levels.find((l) => l.id === 'loft').ceilingRule = 'roof';
  doc.levels.find((l) => l.id === 'loft').openings = [{ id: 'gv', wall: 'e', type: 'window', at: 2.4, width: 0.6, sill: 0.4, height: 1.2, facadeTop: 2.6 }, { id: 'gd', wall: 'n', type: 'door', at: 2, width: 0.9 }];
  const ex4 = E.exportHouse(doc);
  const v4 = await validateGenerated(ex4);
  const gw = ex4.house.walls.flatMap((w) => w.openings ?? []).find((o) => o.type === 'window' && o.topSlope);
  check('vinduet i gavlen som fasaden tegner opp under taket: overkanten følger taket, 2,2 m høyt, uten feil', gw?.topSlope === 'follow-roof' && Math.abs(gw.height - 2.2) < 0.01 && v4.errors.length === 0, JSON.stringify({ gw, errors: v4.errors.slice(0, 2) }));
}
// 8. the doors and windows from the facades (notes/dortyper.md, F138, F141, F144): a window down to the floor beside the
// front door is its sidelight; a door the facade shows as glass with two rows of panes and a transom gets them (and one
// drawn solid none, from a living room too); a wide opening out of a garage is a sectional door; a sliding door on a rail
// with too little wall beside it is telescopic
{
  const FMm = await imp('src/planbygger/facadematch.js');
  const { doc, lv } = await carportHouse();
  lv.openings.push({ id: 'sl', wall: 's', type: 'window', at: 2.7, width: 0.4, sill: 0, height: 2.1 });
  const n = FMm.joinSidelights(doc);
  const ds = lv.openings.find((o) => o.id === 'ds');
  check('vinduet ned til gulvet inntil ytterdøra blir sidefelt i dørkarmen: døra tar det med, vinduet går', n === 1 && !lv.openings.some((o) => o.id === 'sl') && ds.sidelights?.length === 1 && Math.abs(ds.width - 1.35) < 0.01, JSON.stringify(ds));
  // the facade's glass door with a transom, from the living room through the north wall
  lv.openings.push({ id: 'dn', wall: 'n', type: 'door', at: 4, width: 1.0, height: 2.5, facadeDoor: { glass: true, panes: [1, 2], transom: 0.4 } }, { id: 'dn2', wall: 'n', type: 'door', at: 2, width: 0.9, facadeDoor: { glass: false } });
  lv.openings = lv.openings.filter((o) => o.id !== 'vn');
  const ex = E.exportHouse(doc);
  const v = await validateGenerated(ex);
  const all = ex.house.walls.flatMap((w) => w.openings ?? []);
  const front = all.find((o) => o.door?.sidelights?.length);
  const glassDoor = all.find((o) => o.door?.transom);
  const solid = all.filter((o) => o.type === 'door' && o.connects?.includes('ute') && o.connects?.includes('stue') && !o.door.transom);
  check('sidefeltet i ytterdøra, glassdøra med to ruter over hverandre og overlys (0,4 m tegnet, så mye bladet tåler under himlingen), og den tette døra fra stua uten glass', front?.door.sidelights[0].w > 0.3 && glassDoor?.door.glass?.rows === 2 && glassDoor.door.transom.h >= 0.3 && glassDoor.door.transom.h <= 0.4 && solid.length === 1 && !solid[0].door.glass && v.errors.length === 0, JSON.stringify({ sl: front?.door.sidelights, glassDoor: glassDoor?.door, solid: solid.map((o) => o.door), errors: v.errors.slice(0, 2) }));
  // a garage closed on all sides, a 2,6 m opening out of it
  const { doc: dg, lv: lg } = await carportHouse();
  lg.rooms[2] = { ...lg.rooms[2], name: 'Garasje', outdoor: undefined };
  delete lg.rooms[2].outdoor;
  const close = lg.walls.find((w) => w.from === 'closed');
  lg.openings = lg.openings.filter((o) => o.wall !== close.id);
  lg.openings.push({ id: 'port', wall: close.id, type: 'opening', at: Math.hypot(close.b[0] - close.a[0], close.b[1] - close.a[1]) / 2, width: 2.6 });
  const exg = E.exportHouse(dg);
  const vg = await validateGenerated(exg);
  const port = exg.house.walls.flatMap((w) => w.openings ?? []).find((o) => o.door?.variant === 'garage');
  check('en bred åpning ut fra garasjen er en leddport som åpnes med E, uten feil', port?.door.style === 'sectional' && port.interactive === true && port.height >= 1.95 && vg.errors.length === 0, JSON.stringify({ port, errors: vg.errors.slice(0, 2) }));
  // an inner sliding door between two others on a short stretch of wall: telescopic
  const { doc: dt, lv: lt } = await carportHouse();
  lt.openings.push({ id: 'skyv', wall: 'i', type: 'door', variant: 'sliding', at: 0.8, width: 0.9, hinge: 'start' }, { id: 'd2', wall: 'i', type: 'door', at: 2.0, width: 0.8 });
  const ext = E.exportHouse(dt);
  const vt = await validateGenerated(ext);
  const sk = ext.house.walls.flatMap((w) => w.openings ?? []).find((o) => o.door?.variant === 'sliding');
  check('skyvedøra med for lite vegg ved siden av blir en teleskopdør, og validatoren har ikke noe å si om bladet', sk?.door.leaves >= 2 && !vt.warnings.some((m) => m.includes(sk.id) && /bladet/.test(m)) && vt.errors.length === 0, JSON.stringify({ door: sk?.door, warn: vt.warnings.filter((m) => m.includes(sk?.id)) }));
}

done();
