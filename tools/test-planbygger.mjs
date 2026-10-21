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
  // the game's stair builder on a straight stair: with the planbygger's two-point footprint (viewer.js) it has treads
  const raw = St.stairLayout(ls, H.levels);
  const a = ls.top.edge[0];
  const fixed = St.stairLayout({ ...ls, footprint: [a, ls.foot.edge.find((p) => Math.abs(p[1] - a[1]) < 1e-6 || Math.abs(p[0] - a[0]) < 1e-6)] }, H.levels);
  check('stairs.js: en rett trapp med hullet som fotavtrykk får ingen trinn (feil i chains(), meldt videre)', raw.treads.length === 0, `${raw.treads.length} trinn`);
  check('stairs.js: med planbyggerens omvei (fotavtrykk = én langside) får trappa 13 trinn og kollisjon', fixed.treads.length === 13 && St.stairColliders(fixed).length > 0, `${fixed.treads.length} trinn`);
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

done();
