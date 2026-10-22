#!/usr/bin/env node
/**
 * Tests for the round 1 detection (src/planbygger/detect.js, notes/planbygger-runde1-design.md): door variants
 * (single / double / sliding), skylights, stairs, the things that must not become walls, and the hall / storage room
 * of hus1 that used to merge. No browser:
 *
 *   node tools/test-planbygger-detect.mjs        (exit code 1 when a check fails; under a minute)
 *
 *   1. synthetic plans with a known answer (tools/planbygger-synth.mjs variantPlans) at 40–120 px/m, with noise and
 *      skewed: walls, doors per variant, windows, skylights, stairs; a dashed roof edge, a tile grid and floor boards
 *      give no walls
 *   2. the plans of v1 (samplePlans, the owner's plan): no variants, skylights or stairs where there are none
 *   3. hus1 (plantegninger/hus1, fasit.json): both levels – rooms and areas, the hall and the storage room apart,
 *      doors per variant, windows, skylights, the stair
 *   4. not walls on the real plans: terrace tiles and parasols (hus2, hus3), the dashed roof edge (hus1 2. etasje)
 *   5. the house file: double doors as two doors, sliding doors as passages, skylights on the ceilings, validateHouse;
 *      the symbols survive the worker's postMessage
 *   6. more styles against the fasit, door by door and window by window: hus8 (estate agent, 32–36 px/m: the
 *      outer doors with weak arcs over a window-like band, the terrace door's short leaf), hus4 (light grey walls,
 *      wood-floor hatching) and hus9 (hobby render) with clean: true; the time on the largest sheets (hus7, hus6)
 *   7. room separators (the dash-dot beam between open zones): a synthetic open plan at 35–120 px/m (never a wall),
 *      hus4 1. etasje (hall / TV room),
 *      and none where a dash-dot line is a beam over a room, a section line or a wardrobe front (hus4 2. etasje, hus2,
 *      hus6 and the others); a U stair; the split rooms in regions.js
 *   8. after the round 1 follow-up: whole flights (hus3, the dashed part over the cut line), the stairs of hus1 2. etasje,
 *      hus6 and hus8, the sliding door between STUE 2 and SPISESTUE on hus6 (was a wall), the windows of hus9's lower
 *      floor (light grey walls: the frame line of a white window is no wall); hus9 at the scale «Generer» uses (50 px/m):
 *      a rug's border is no wall and no sliding door, no door in a window by a flowered rug, no sliding leaf under 35 cm
 *   9. stairs that wind round a narrow newel (every tread a winder, hus4): the synthetic U (tools/planbygger-synth.mjs
 *      'newel', solid and with its left half dashed) at 50–120 px/m, hus4 1. and 2. etasje; no such stair from a word,
 *      diagonal lines or a rotated armchair (hus2, hus5)
 */
import { ROOT, imp, readJson, check, section, done, planPipeline, validateGenerated } from './planbygger-lib.mjs';
import path from 'node:path';
import { readPng } from './planbygger-png.mjs';
import { renderPlan, samplePlans, variantPlans } from './planbygger-synth.mjs';

/** detect.js may be mid-edit by its owner: an import that throws is retried a few times. */
async function importDetect() {
  for (let k = 0; k < 4; k++) {
    try {
      return await imp(`src/planbygger/detect.js${k ? `?retry=${k}` : ''}`);
    } catch (e) {
      if (k === 3) throw e;
      await new Promise((r) => setTimeout(r, 15000));
    }
  }
}
const D = await importDetect();
const I = await imp('src/planbygger/image.js');
const M = await imp('src/planbygger/model.js');
const E = await imp('src/planbygger/export.js');
const { findRooms, levelRooms } = await imp('src/planbygger/regions.js');

const f1 = (v) => v.toFixed(1);
const f2 = (v) => v.toFixed(2);
const iou = (a, b) => {
  const ix = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0]));
  const iy = Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
  const u = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - ix * iy;
  return u > 0 ? (ix * iy) / u : 0;
};
const variantOf = (o) => (o.type === 'door' ? o.variant ?? 'single' : o.type);
const countBy = (det) => {
  const c = { single: 0, double: 0, sliding: 0, window: 0, opening: 0 };
  for (const o of det.openings) c[variantOf(o)]++;
  return c;
};

/**
 * A synthetic plan against its detection: walls (centre within 3 cm, 90 % of the length), every opening (centre within
 * 12 cm on the matched wall, width within 15 cm) with its type and variant, double doors on the right side, skylights
 * and stairs by overlap.
 */
function compareSynthetic(plan, det, ppm, origin) {
  const toPx = (p) => [p[0] * ppm + origin[0], p[1] * ppm + origin[1]];
  const map = new Map();
  plan.walls.forEach((tw, ti) => {
    const a = toPx(tw.a);
    const b = toPx(tw.b);
    const horiz = Math.abs(a[1] - b[1]) < 1e-6;
    let best = null;
    det.walls.forEach((w, wi) => {
      if ((w.axis === 'h') !== horiz) return;
      const off = horiz ? Math.abs(w.a[1] - a[1]) : Math.abs(w.a[0] - a[0]);
      const [t0, t1] = horiz ? [Math.min(a[0], b[0]), Math.max(a[0], b[0])] : [Math.min(a[1], b[1]), Math.max(a[1], b[1])];
      const [s0, s1] = horiz ? [w.a[0], w.b[0]] : [w.a[1], w.b[1]];
      const ov = Math.min(t1, s1) - Math.max(t0, s0);
      if (ov < 0.9 * (t1 - t0) || off > 0.03 * ppm || Math.abs(w.t - tw.t * ppm) > 0.03 * ppm) return;
      if (!best || off < best.off) best = { wi, off, horiz };
    });
    if (best) map.set(ti, best);
  });
  const ops = { found: 0, typed: 0, sided: 0, doubles: 0, total: plan.openings.length, misses: [] };
  for (const o of plan.openings) {
    const m = map.get(o.wall);
    const tw = plan.walls[o.wall];
    const L = Math.hypot(tw.b[0] - tw.a[0], tw.b[1] - tw.a[1]);
    const u = [(tw.b[0] - tw.a[0]) / L, (tw.b[1] - tw.a[1]) / L];
    const c = toPx([tw.a[0] + u[0] * o.at, tw.a[1] + u[1] * o.at]);
    const want = o.type === 'door' ? o.variant ?? 'single' : o.type;
    if (!m) {
      ops.misses.push(`${want} (veggen mangler)`);
      continue;
    }
    const w = det.walls[m.wi];
    const cand = det.openings
      .filter((x) => x.wall === m.wi)
      .map((x) => {
        const mid = (x.from + x.to) / 2;
        const p = m.horiz ? [w.a[0] + mid, w.a[1]] : [w.a[0], w.a[1] + mid];
        return { x, d: Math.hypot(p[0] - c[0], p[1] - c[1]), width: (x.to - x.from) / ppm };
      })
      .sort((p, q) => p.d - q.d)[0];
    if (!cand || cand.d > 0.12 * ppm || Math.abs(cand.width - o.width) > 0.15) {
      ops.misses.push(`${want} ${f2(o.width)} m`);
      continue;
    }
    ops.found++;
    if (variantOf(cand.x) === want) ops.typed++;
    else ops.misses.push(`${want} → ${variantOf(cand.x)}`);
    if (want === 'double' && variantOf(cand.x) === 'double') {
      ops.doubles++;
      // the swing side in the image: the truth's normal (−u.y, u.x)·side against the detected wall normal
      const tn = [-u[1] * o.side, u[0] * o.side];
      const wd = m.horiz ? [Math.sign(w.b[0] - w.a[0]), 0] : [0, Math.sign(w.b[1] - w.a[1])];
      const gn = [-wd[1] * cand.x.side, wd[0] * cand.x.side];
      if (tn[0] * gn[0] + tn[1] * gn[1] > 0.5 && Math.abs(cand.x.leaf / ppm - o.width / 2) < 0.12) ops.sided++;
    }
  }
  const skyTruth = (plan.skylights || []).map((s) => [...toPx([s.x0, s.y0]), ...toPx([s.x1, s.y1])]);
  const skyFound = skyTruth.filter((t) => det.skylights.some((s) => iou(t, [s.x0, s.y0, s.x1, s.y1]) >= 0.6)).length;
  const stairTruth = (plan.stairs || []).map((s) => ({ ...s, box: [...toPx(s.rect[0]), ...toPx(s.rect[1])] }));
  const stairs = stairTruth.map((t) => {
    const best = det.stairs.map((s) => ({ s, iou: iou(t.box, s.bbox) })).sort((a, b) => b.iou - a.iou)[0];
    return { t, s: best?.s ?? null, iou: best?.iou ?? 0 };
  });
  return {
    walls: map.size,
    extraWalls: det.walls.length - map.size,
    ops,
    skyFound,
    skyExtra: det.skylights.length - skyFound,
    stairs,
    stairExtra: det.stairs.length - stairs.filter((x) => x.iou >= 0.5).length,
  };
}

// ---------------------------------------------------------------------------------------------------------------
section('1. Syntetiske planer med dobbeltdører, skyvedører, takvinduer og trapper');
{
  const plans = variantPlans();
  for (const [ppm, noise] of [[40, 0], [60, 0], [90, 5], [120, 8]]) {
    const plan = plans.varianter;
    const r = renderPlan(plan, { pxPerM: ppm, noise, seed: ppm });
    const t0 = Date.now();
    const det = D.detectPlan(r.img, { pxPerM: ppm });
    const ms = Date.now() - t0;
    const c = compareSynthetic(plan, det, ppm, r.origin);
    const tag = `varianter ${ppm} px/m${noise ? `, støy ±${noise}` : ''}`;
    const cnt = countBy(det);
    check(`${tag}: alle ${plan.walls.length} vegger, ingen ekstra (stiplet takkant, terrassefliser og gulvbord er ikke vegger)`, c.walls === plan.walls.length && c.extraWalls === 0, `${c.walls}/${plan.walls.length}, ${c.extraWalls} ekstra, ${ms} ms`);
    // at 40 px/m the two leaves of the sliding door (0,1 m wall = 4 px) lie 1 px apart and read as one window line: a
    // passage is the honest answer there
    const lowRes = ppm < 50;
    const typedOk = c.ops.typed === c.ops.total || (lowRes && c.ops.typed === c.ops.total - 1 && c.ops.misses.every((m) => m === 'sliding → opening'));
    check(`${tag}: alle ${c.ops.total} åpninger med riktig type og variant${lowRes ? ' (skyvedøra kan bli en åpning)' : ''}`, c.ops.found === c.ops.total && typedOk, `${c.ops.found} funnet, ${c.ops.typed} riktig; enkel/dobbel/skyve/vindu ${cnt.single}/${cnt.double}/${cnt.sliding}/${cnt.window}${c.ops.misses.length ? `; ${c.ops.misses.join(', ')}` : ''}`);
    check(`${tag}: dobbeltdørene slår riktig vei, bladene er halve hullet`, c.ops.sided === 2, `${c.ops.sided}/2`);
    check(`${tag}: begge takvinduene (overlapp ≥ 60 %), ingen ekstra`, c.skyFound === 2 && c.skyExtra === 0, `${c.skyFound}/2, ${c.skyExtra} ekstra`);
    const st = c.stairs[0];
    check(`${tag}: rett trapp (overlapp ≥ 50 %, akse y, 12 ± 2 inntrinn), ingen ekstra`, st.s && st.iou >= 0.5 && st.s.kind === 'straight' && st.s.axis === 'y' && Math.abs(st.s.treads - 12) <= 2 && c.stairExtra === 0, st.s ? `${(st.iou * 100).toFixed(0)} %, ${st.s.kind}, ${st.s.axis}, ${st.s.treads} inntrinn, ${c.stairExtra} ekstra` : 'ingen');
  }
  for (const ppm of [50, 80]) {
    // (no random furniture: a grey block drawn over the treads hides them, as it would on a real plan)
    const plan = plans.kvarttrapp;
    const r = renderPlan(plan, { pxPerM: ppm, seed: ppm + 1, furniture: false });
    const det = D.detectPlan(r.img, { pxPerM: ppm });
    const c = compareSynthetic(plan, det, ppm, r.origin);
    const st = c.stairs[0];
    check(`kvarttrapp ${ppm} px/m: L-trapp med svingtrinn (quarter-turn, overlapp ≥ 50 %, minst 3 svingtrinn)`, st.s && st.iou >= 0.5 && st.s.kind === 'quarter-turn' && st.s.winders >= 3 && st.s.flights === 2, st.s ? `${(st.iou * 100).toFixed(0)} %, ${st.s.kind}, ${st.s.flights} løp, ${st.s.winders} svingtrinn, ${st.s.treads} i alt` : 'ingen');
    check(`kvarttrapp ${ppm} px/m: vegger og åpninger som før, ingen takvinduer`, c.walls === plan.walls.length && c.extraWalls === 0 && c.ops.typed === c.ops.total && !det.skylights.length, `${c.walls} vegger, ${c.ops.typed}/${c.ops.total} åpninger, ${det.skylights.length} takvinduer`);
  }
  // skewed 3° (a scan): the same answer in the straightened frame. At 100 px/m: at 70 px/m the two bilinear turns blur
  // the 0,1 m walls (7 px) under the automatic dark threshold (it falls from 29 to 17) and they are lost – a weakness of
  // the threshold, not of the symbols (notes/planbygger.md)
  const plan = plans.varianter;
  const r = renderPlan(plan, { pxPerM: 100, noise: 3, seed: 9 });
  const rot = I.rotateImage(r.img, 3);
  const est = D.estimateSkew(rot);
  const det = D.detectPlan(rot, { pxPerM: 100, rotate: est });
  const c = compareSynthetic(plan, det, 100, r.origin);
  check('varianter 100 px/m 3° skjev: vinkelen, alle vegger, åpninger med variant, takvinduer og trappa', Math.abs(est - 3) < 0.1 && c.walls === plan.walls.length && c.ops.typed === c.ops.total && c.skyFound === 2 && c.stairs[0].iou >= 0.5, `${est}°, ${c.walls} vegger, ${c.ops.typed}/${c.ops.total} åpninger${c.ops.misses.length ? ` (${c.ops.misses.join(', ')})` : ''}, ${c.skyFound} takvinduer, trapp ${(c.stairs[0].iou * 100).toFixed(0)} %`);
}

// ---------------------------------------------------------------------------------------------------------------
section('2. Planene fra v1: ingen varianter, takvinduer eller trapper som ikke finnes');
{
  for (const [name, plan] of Object.entries(samplePlans())) {
    const r = renderPlan(plan, { pxPerM: 50, seed: 50 });
    const det = D.detectPlan(r.img, { pxPerM: 50 });
    const cnt = countBy(det);
    check(`${name}: alle dørene er enkle, ingen takvinduer eller trapper`, cnt.double === 0 && cnt.sliding === 0 && !det.skylights.length && !det.stairs.length, `${cnt.double} doble, ${cnt.sliding} skyve, ${det.skylights.length} takvinduer, ${det.stairs.length} trapper`);
  }
  const img = readPng(path.join(ROOT, 'plantegning.png'));
  const det = D.detectPlan(img, { pxPerM: 628 / 12.21 });
  const cnt = countBy(det);
  check('eierens 1. etasje: 11 vegger, 3 enkle dører, 7 vinduer, 1 åpning, ingen takvinduer eller trapper', det.walls.length === 11 && cnt.single === 3 && cnt.double + cnt.sliding === 0 && cnt.window === 7 && cnt.opening === 1 && !det.skylights.length && !det.stairs.length, `${det.walls.length} vegger, ${JSON.stringify(cnt)}, ${det.skylights.length} takvinduer, ${det.stairs.length} trapper`);
}

// ---------------------------------------------------------------------------------------------------------------
section('3. hus1 mot fasiten');
const hus1 = readJson('plantegninger/hus1/fasit.json');
/** The rooms of a detection (model + regions.js) and the room under a pixel. */
function roomsOf(det, ppm) {
  const doc = M.createDoc('x');
  const lv = M.createLevel(doc, { id: 'hoved', image: { name: 'x', width: 1, height: 1, pxPerM: ppm } });
  M.applyDetection(lv, det, ppm, doc.settings);
  const f = findRooms(lv.walls);
  return { f, at: (px) => f.at(px[0] / ppm, px[1] / ppm), area: (i) => f.rooms.find((r) => r.index === i)?.area ?? NaN };
}
{
  const L = hus1.levels[0];
  const ppm = L.scale.pxPerM;
  const t0 = Date.now();
  const det = D.detectPlan(readPng(path.join(ROOT, 'plantegninger/hus1/1etg.png')), { pxPerM: ppm });
  const ms = Date.now() - t0;
  const R = roomsOf(det, ppm);
  const cnt = countBy(det);
  check(`hus1 1. etasje: 6 rom (fasit 6 etiketter)`, R.f.rooms.length === 6, `${R.f.rooms.length}: ${R.f.rooms.map((r) => f1(r.area)).join(', ')}`);
  // the labels' rooms: the label point of each room (pixels, read off the plan) → its area against the label
  const labels = [['SOV', [290, 380], 14.8], ['HALL/TRAPP', [655, 300], 15.9], ['BOD', [1050, 120], 4.4], ['VASK', [1020, 300], 5.5], ['STUE', [590, 690], 29.1], ['KJØKKEN', [960, 645], 16.9]];
  const ids = labels.map(([, p]) => R.at(p));
  const errs = labels.map(([, , a], i) => (R.area(ids[i]) / a - 1) * 100);
  check('hus1 1. etasje: hver etikett i sitt eget rom, arealene innen ±3 % av etikettene', new Set(ids).size === 6 && ids.every((i) => i >= 0) && errs.every((e) => Math.abs(e) <= 3), labels.map(([n], i) => `${n} ${f1(R.area(ids[i]))} (${errs[i] >= 0 ? '+' : ''}${f1(errs[i])} %)`).join(', '));
  check('hus1 1. etasje: HALL/TRAPP og BOD er to rom (el-skapet i veggen er ikke en åpning)', ids[1] !== ids[2] && Math.abs(R.area(ids[2]) - 4.4) < 0.3, `hall ${ids[1]}, bod ${ids[2]} ${f2(R.area(ids[2]))} m²`);
  check(`hus1 1. etasje: dører ${L.doors.single} enkle, ${L.doors.double} doble, ${L.doors.sliding} skyvedør`, cnt.single === L.doors.single && cnt.double === L.doors.double && cnt.sliding === L.doors.sliding, `${cnt.single}/${cnt.double}/${cnt.sliding}`);
  check(`hus1 1. etasje: ${L.windows} vinduer, ingen åpninger uten dør, ingen takvinduer`, cnt.window === L.windows && cnt.opening === 0 && !det.skylights.length, `${cnt.window} vinduer, ${cnt.opening} åpninger, ${det.skylights.length} takvinduer`);
  const st = det.stairs[0];
  check('hus1 1. etasje: kvartsvingt trapp i HALL/TRAPP (fasit x 415–628, y 120–357 px), 14 ± 2 inntrinn (fasit 14)', det.stairs.length === 1 && st.kind === 'quarter-turn' && iou(st.bbox, [415, 120, 628, 357]) >= 0.8 && Math.abs(st.treads - 14) <= 2, st ? `${st.kind}, ${(iou(st.bbox, [415, 120, 628, 357]) * 100).toFixed(0)} %, ${st.treads} inntrinn (${st.flights} løp, ${st.winders} svingtrinn)` : 'ingen');
  check('hus1 1. etasje: under 3 s', ms < 3000, `${ms} ms`);
}
{
  const L = hus1.levels[1];
  const ppm = L.scale.pxPerM;
  const det = D.detectPlan(readPng(path.join(ROOT, 'plantegninger/hus1/2etg.png')), { pxPerM: ppm });
  const R = roomsOf(det, ppm);
  const cnt = countBy(det);
  check('hus1 2. etasje: 6 lukkede rom (GANG/TRAPP og LOFTSTUE er ett)', R.f.rooms.length === 6, `${R.f.rooms.length}: ${R.f.rooms.map((r) => f1(r.area)).join(', ')}`);
  check(`hus1 2. etasje: ${L.doors.single} enkle dører, ${L.windows} vinduer, ingen åpninger`, cnt.single === L.doors.single && cnt.double + cnt.sliding === 0 && cnt.window === L.windows && cnt.opening === 0, JSON.stringify(cnt));
  // the four «Takvindu» boxes of the fasit notes (pixels)
  const truth = [[295, 200, 345, 290], [860, 205, 912, 270], [295, 665, 345, 750], [860, 665, 910, 750]];
  const hit = truth.filter((t) => det.skylights.some((s) => iou(t, [s.x0, s.y0, s.x1, s.y1]) >= 0.5));
  const extra = det.skylights.filter((s) => !truth.some((t) => iou(t, [s.x0, s.y0, s.x1, s.y1]) >= 0.5));
  check('hus1 2. etasje: minst 3 av 4 takvinduer (overlapp ≥ 50 %), ingen ekstra', hit.length >= 3 && !extra.length, `${hit.length}/4 funnet, ${extra.length} ekstra`);
  const st = det.stairs[0];
  check('hus1 2. etasje: kvartsvingt trapp i GANG/TRAPP (fasit x 427–630, y 140–367 px), overlapp ≥ 70 % (svingtrinnene ved begge løpene)', det.stairs.length === 1 && st.kind === 'quarter-turn' && iou(st.bbox, [427, 140, 630, 367]) >= 0.7, st ? `${st.kind}, ${(iou(st.bbox, [427, 140, 630, 367]) * 100).toFixed(0)} %, ${st.treads} inntrinn` : 'ingen');
  // the dashed roof edge round the drawing is no wall
  const nearEdge = det.walls.filter((w) => Math.max(w.a[0], w.b[0]) < 30 || Math.min(w.a[0], w.b[0]) > 1180 || Math.max(w.a[1], w.b[1]) < 25);
  check('hus1 2. etasje: den stiplede takkanten gir ingen vegger', !nearEdge.length, `${nearEdge.length}`);
}

// ---------------------------------------------------------------------------------------------------------------
section('4. Ikke vegger på de ekte planene: fliser, parasoller og takkanter');
{
  // walls whose middle lies in a box (pixels)
  const inBox = (det, b) => det.walls.filter((w) => {
    const m = [(w.a[0] + w.b[0]) / 2, (w.a[1] + w.b[1]) / 2];
    return m[0] > b[0] && m[0] < b[2] && m[1] > b[1] && m[1] < b[3];
  });
  const h2 = D.detectPlan(readPng(path.join(ROOT, 'plantegninger/hus2/1etg.png')), { pxPerM: 55.6 });
  check('hus2: ingen vegger i terrassen med fliser og parasoll (nordøst)', inBox(h2, [470, 40, 870, 400]).length === 0, `${inBox(h2, [470, 40, 870, 400]).length}`);
  check('hus2: ingen vegger i flisene sør for huset', inBox(h2, [455, 840, 900, 975]).length === 0, `${inBox(h2, [455, 840, 900, 975]).length}`);
  const h3 = D.detectPlan(readPng(path.join(ROOT, 'plantegninger/hus3/1etg.png')), { pxPerM: 47.9 });
  check('hus3 1. etasje: ingen vegger i terrassen med fliser og parasoll (vest)', inBox(h3, [80, 300, 300, 950]).length === 0, `${inBox(h3, [80, 300, 300, 950]).length}`);
  check('hus3 1. etasje: ingen takvinduer og én rett trapp eller ingen', !h3.skylights.length && h3.stairs.every((s) => s.kind === 'straight'), `${h3.skylights.length} takvinduer, ${h3.stairs.map((s) => s.kind).join(', ') || 'ingen trapp'}`);
  const h5 = D.detectPlan(readPng(path.join(ROOT, 'plantegninger/_png/hus5/1etg.png')), { pxPerM: 46.9 });
  check('hus5: ingen takvinduer (stiplet dusj, badekar og takkant er ikke takvinduer), ingen trapp', !h5.skylights.length && !h5.stairs.length, `${h5.skylights.length} takvinduer, ${h5.stairs.length} trapper`);

  // the counts of the fasit (hus4, hus8 and hus9 door by door in section 6)
  const c2 = countBy(h2);
  check('hus2: 10 enkle dører og 5 skyvedører (åpning med pil og én bladlinje), 12 vinduer', c2.single === 10 && c2.sliding === 5 && c2.double === 0 && c2.window === 12, JSON.stringify(c2));
  const c5 = countBy(h5);
  const r5 = roomsOf(h5, 46.9).f.rooms.length;
  check('hus5: 10 enkle dører og 4 skyvedører, minst 14 av 15 vinduer, 11 lukkede rom (fasit)', c5.single === 10 && c5.sliding === 4 && c5.double === 0 && c5.window >= 14 && r5 === 11, `${JSON.stringify(c5)}, ${r5} rom`);
  const h32 = D.detectPlan(readPng(path.join(ROOT, 'plantegninger/hus3/2etg.png')), { pxPerM: 47.8 });
  const c32 = countBy(h32);
  check('hus3 2. etasje: 3 skyvedører til soverommene, 6 vinduer, én rett trapp', c32.sliding === 3 && c32.window === 6 && h32.stairs.length === 1 && h32.stairs[0].kind === 'straight', `${JSON.stringify(c32)}, trapp ${h32.stairs.map((s) => s.kind).join(', ') || 'ingen'}`);
  check('hus3 1. etasje: hele den rette trappa, også de stiplede trinnene over snittlinja (fasit y 385–546 px), 13 ± 2 inntrinn', h3.stairs.length === 1 && h3.stairs[0].kind === 'straight' && iou(h3.stairs[0].bbox, [540, 385, 590, 546]) >= 0.8 && Math.abs(h3.stairs[0].treads - 13) <= 2, h3.stairs[0] ? `${(iou(h3.stairs[0].bbox, [540, 385, 590, 546]) * 100).toFixed(0)} % av trapperommet, ${h3.stairs[0].treads} inntrinn` : 'ingen');
  check('hus3 2. etasje: hele trappa (fasit y 384–544 px), 14 ± 2 trinnlinjer', h32.stairs.length === 1 && iou(h32.stairs[0].bbox, [291, 384, 341, 544]) >= 0.8 && Math.abs(h32.stairs[0].treads - 14) <= 2, h32.stairs[0] ? `${(iou(h32.stairs[0].bbox, [291, 384, 341, 544]) * 100).toFixed(0)} %, ${h32.stairs[0].treads}` : 'ingen');
}

// ---------------------------------------------------------------------------------------------------------------
section('5. Husfila: dobbeltdør, skyvedør og takvindu i formatet');
{
  const plan = variantPlans().varianter;
  const r = renderPlan(plan, { pxPerM: 60, seed: 60 });
  const det = D.detectPlan(r.img, { pxPerM: 60 });
  const doc = M.createDoc('varianter');
  const lv = M.createLevel(doc, { id: 'hoved', image: { name: 'varianter', width: r.img.width, height: r.img.height, pxPerM: 60 } });
  M.applyDetection(lv, det, 60, doc.settings);
  check('modellen: variantene, bladene og takvinduene kommer med', lv.openings.filter((o) => o.variant === 'double' && o.leaf2 > 0).length === 2 && lv.openings.filter((o) => o.variant === 'sliding').length === 1 && lv.skylights.length === 2 && lv.stairHints.length === 1, `${lv.openings.filter((o) => o.variant).length} varianter, ${lv.skylights.length} takvinduer, ${lv.stairHints.length} trappehint`);
  // a sliding door has no hinged leaf; the type menu's kinds change type and variant together
  const sl = lv.openings.find((o) => o.variant === 'sliding');
  const asSingle = M.setOpeningKind(M.clone(sl), 'single');
  const asDouble = M.setOpeningKind(M.clone(sl), 'double');
  const asWindow = M.setOpeningKind(M.clone(sl), 'window');
  const back = M.setOpeningKind(M.clone(asDouble), 'single');
  check('modellen: skyvedøra uten slagblad; setOpeningKind gjør den til slagdør, dobbeltdør og vindu', sl.leaf == null && M.openingKind(sl) === 'sliding' && M.openingKind(asSingle) === 'single' && asSingle.variant == null && asSingle.leaf == null && M.openingKind(asDouble) === 'double' && asDouble.leaf2 === asDouble.leaf && M.openingKind(asWindow) === 'window' && asWindow.variant == null && asWindow.sill > 0 && M.openingKind(back) === 'single' && back.leaf == null && back.leaf2 == null, `${JSON.stringify(asSingle)} | ${JSON.stringify(asDouble)}`);
  const ex = E.exportHouse(doc);
  const v = await validateGenerated(ex);
  const all = ex.house.walls.flatMap((w) => w.openings || []);
  const leaves = all.filter((o) => /dobbeltdør/.test(o.source ?? ''));
  const slide = all.filter((o) => /skyvedør/.test(o.source ?? ''));
  const sky = ex.house.ceilings.flatMap((c) => c.skylights || []);
  check('eksport: 0 feil i validateHouse', v.errors.length === 0, v.errors.slice(0, 3).join(' | '));
  check('eksport: hver dobbeltdør er to dører side om side, hengslet i hver sin karm, samme slagretning', ex.report.counts.doubleDoors === 2 && leaves.length === 4 && leaves.every((o) => o.type === 'door') && [0, 2].every((k) => leaves[k].door.swing === leaves[k + 1].door.swing && leaves[k].door.hinge !== leaves[k + 1].door.hinge), `${ex.report.counts.doubleDoors} doble, ${leaves.length} blad`);
  check('eksport: skyvedøra er en åpning (formatet har ingen skyvedør)', ex.report.counts.slidingDoors === 1 && slide.length === 1 && slide[0].type === 'opening', `${slide.map((o) => o.type).join(', ')}`);
  check('eksport: takvinduene ligger på himlingen i rommet sitt', ex.report.counts.skylights === 2 && sky.length === 2 && sky.every((s) => s.polygon.length === 4), `${sky.length}`);
  const { buildLayout } = await imp('src/home/layout.js');
  let err = null;
  try {
    buildLayout(E.mergeOnto(E.baseSpec(), ex.house), undefined, { devWarnings: false });
  } catch (e) {
    err = e;
  }
  check('eksport: spillets buildLayout tar huset', !err, err?.message);
  for (const L of hus1.levels) {
    const { doc: d } = await planPipeline(path.join(ROOT, 'plantegninger/hus1', L.file), { pxPerM: L.scale.pxPerM, north: 0 });
    const e2 = E.exportHouse(d);
    const v2 = await validateGenerated(e2);
    const c = e2.report.counts;
    check(`hus1 ${L.name}: 0 feil i validateHouse, ${L.doors.double} doble og ${L.doors.sliding} skyvedører i husfila`, v2.errors.length === 0 && c.doubleDoors === L.doors.double && c.slidingDoors === L.doors.sliding, `${v2.errors.length} feil (${v2.errors.slice(0, 2).join(' | ')}), ${c.doubleDoors} doble, ${c.slidingDoors} skyve, ${c.skylights} takvinduer`);
  }
  // the worker posts the result with postMessage: the symbols are plain data, and clean: true is a boolean
  let cloneErr = null;
  try {
    structuredClone({ skylights: det.skylights, stairs: det.stairs, opts: { pxPerM: 60, clean: true } });
  } catch (e) {
    cloneErr = e;
  }
  check('takvinduer og trapper tåler postMessage (structuredClone), og det gjør clean: true også', !cloneErr, cloneErr?.message);
}

// ---------------------------------------------------------------------------------------------------------------
section('6. Flere stiler mot fasiten: hus8 (megler), hus4 (lysegrå vegger, tregulv) og hus9 (hobby, teksturer)');
/** The centre of a detected opening, pixels. */
function centreOf(det, o) {
  const w = det.walls[o.wall];
  const m = (o.from + o.to) / 2;
  return w.axis === 'h' ? [w.a[0] + m, w.a[1]] : [w.a[0], w.a[1] + m];
}
/** The opening of a detection nearest to a point (pixels): { kind, d (px), width (m) } or null. */
function openingAt(det, p, ppm) {
  let best = null;
  for (const o of det.openings) {
    const c = centreOf(det, o);
    const d = Math.hypot(c[0] - p[0], c[1] - p[1]);
    if (!best || d < best.d) best = { kind: variantOf(o), d, width: (o.to - o.from) / ppm };
  }
  return best;
}
/** Points (pixels, from the fasit) that should be openings of a kind, within 30 cm: the ones that are not, as text. */
function missing(det, ppm, kind, points) {
  return points
    .map((p) => [p, openingAt(det, p, ppm)])
    .filter(([, o]) => !o || o.d > 0.3 * ppm || o.kind !== kind)
    .map(([p, o]) => `${p.join(',')}${o && o.d <= 0.3 * ppm ? ` → ${o.kind}` : ' → ingen'}`);
}
/** Labelled rooms (fasit points, pixels) found as rooms of their own, the area within ±15 % of the label. */
function labelledRooms(det, ppm, labels) {
  const R = roomsOf(det, ppm);
  const ids = labels.map(([, pts]) => pts.map((p) => R.at(p)));
  const ok = labels.filter(([, , area], j) => {
    const id = ids[j][0];
    if (id < 0 || ids[j].some((x) => x !== id) || ids.some((other, k) => k !== j && other.includes(id))) return false;
    return area == null || Math.abs(R.area(id) / area - 1) <= 0.15;
  });
  return { ok: ok.length, total: labels.length, names: ok.map(([n]) => n), rooms: R.f.rooms.length };
}
const wallsIn = (det, b) => det.walls.filter((w) => {
  const m = [(w.a[0] + w.b[0]) / 2, (w.a[1] + w.b[1]) / 2];
  return m[0] > b[0] && m[0] < b[2] && m[1] > b[1] && m[1] < b[3];
});
{
  // hus8, 1. etasje (FINN, no scale: 34 px/m from the doors and the worktop, ±6 %). The door bands are drawn like the
  // windows (a grey bar in the band), and the two outer doors have weak arcs: the terrace door's leaf line is drawn off
  // its hinge, the entrance's arc is light grey on grey steps. The stair door has no hole in a wall line (the stair is
  // open to the hall), and the three sliding doors are drawn as a window and two grey filled leaves: not found
  const doors = [[395, 626], [357, 648], [357, 734], [449, 715], [517, 742], [247, 650]];
  const windows = [[247, 574], [247, 732], [517, 590], [517, 679], [517, 856], [517, 989]];
  const img = readPng(path.join(ROOT, 'plantegninger/_png/hus8/plantegning-3.png'));
  for (const ppm of [36, 34, 32]) {
    const det = D.detectPlan(img, { pxPerM: ppm });
    const md = missing(det, ppm, 'single', doors);
    const mw = missing(det, ppm, 'window', windows);
    // the house's outer faces x 242–521, y 533–1063 (the garage beside it has a door of its own)
    const inHouse = det.openings.filter((o) => {
      const c = centreOf(det, o);
      return variantOf(o) === 'single' && c[0] > 236 && c[0] < 527 && c[1] > 527 && c[1] < 1069;
    }).length;
    check(`hus8 1. etasje ${ppm} px/m: alle 6 tegnede slagdører (også terrassedøra og inngangsdøra), ingen ekstra i huset`, !md.length && inHouse === 6, `${md.length ? `mangler ${md.join('; ')}` : 'alle'}, ${inHouse} enkle i huset`);
    check(`hus8 1. etasje ${ppm} px/m: de 6 vinduene er vinduer`, !mw.length, mw.join('; ') || 'alle');
  }
  const k = readPng(path.join(ROOT, 'plantegninger/_png/hus8/plantegning-2.png'));
  const dk = D.detectPlan(k, { pxPerM: 34 });
  const miss = [
    ...missing(dk, 34, 'single', [[537, 708], [537, 791], [579, 706], [579, 771], [557, 844]]),
    ...missing(dk, 34, 'opening', [[607, 640], [614, 913]]),
    ...missing(dk, 34, 'window', [[499, 543], [697, 590], [697, 847], [697, 979]]),
  ];
  const ck = countBy(dk);
  check('hus8 kjeller: 5 slagdører, 2 åpninger og 4 vinduer på plass, ingen ekstra', !miss.length && ck.single === 5 && ck.opening === 2 && ck.window === 4 && ck.double + ck.sliding === 0, `${miss.join('; ') || 'alle på plass'}, ${JSON.stringify(ck)}`);
}
{
  // hus4: light grey walls with black outlines, wood-floor hatching every 15 cm, coloured furniture. Without the
  // cleaner the dark wardrobes and the stair become walls (notes/planbygger.md); with clean: true (clean.js) the walls
  // are right. Measured at 120.5 px/m (the fasit's areas)
  const ppm = 120.5;
  const img = readPng(path.join(ROOT, 'plantegninger/_png/hus4/1etg.png'));
  const det = D.detectPlan(img, { pxPerM: ppm, clean: true });
  // the hatched floors: the hall, the TV room, two bedrooms – boxes clear of walls and furniture
  const floors = [[440, 490, 1075, 600], [530, 640, 650, 1000], [960, 850, 1270, 1000], [205, 640, 355, 900]];
  const raw = D.detectPlan(img, { pxPerM: ppm });
  const onFloor = (d) => floors.reduce((s, b) => s + wallsIn(d, b).length, 0);
  check('hus4 1. etasje: tregulv-skravuren gir ingen vegger (med og uten rydding)', onFloor(det) === 0 && onFloor(raw) === 0, `${onFloor(det)} med, ${onFloor(raw)} uten rydding`);
  check('hus4 1. etasje: ryddingen er brukt (clean: true)', det.stats.cleaned === true && !raw.stats.cleaned, `${det.stats.cleaned}`);
  const md = missing(det, ppm, 'single', [[504, 205], [418, 362], [1013, 462], [1092, 595], [1009, 727], [485, 692], [1640, 975], [1379, 377]]);
  const c = countBy(det);
  // Vask → carport (1379, 377) is drawn in a 0,6 m hole between two window-like jambs: it is found as a window
  check('hus4 1. etasje med rydding: minst 7 av 8 slagdører på plass, skyvedøra til terrassen, ingen andre skyvedører', md.length <= 1 && !missing(det, ppm, 'sliding', [[752, 1033]]).length && c.sliding === 1 && c.single === 8 - md.length, `mangler ${md.join('; ') || 'ingen'}; ${JSON.stringify(c)}`);
  const mw = missing(det, ppm, 'window', [[243, 205], [1194, 205], [112, 421], [112, 818], [280, 1033], [1142, 1033]]);
  check('hus4 1. etasje med rydding: de 6 vinduene', !mw.length, mw.join('; ') || 'alle');
  const lr = labelledRooms(det, ppm, [['Sov 7,5', [[215, 425]], 7.5], ['Entré + gang + TV-stue', [[508, 395], [698, 700]], null], ['Vask', [[1137, 395]], 6.4], ['Bad', [[1195, 630]], 4.3], ['Sov 9,3', [[297, 775]], 9.3], ['Sov 8,1', [[1052, 925]], 8.1], ['Sportsbod', [[1500, 1100]], 5.7]]);
  check('hus4 1. etasje med rydding: alle 7 rom med etikett er egne rom med riktig areal (±15 %)', lr.ok === lr.total, `${lr.ok}/${lr.total}: ${lr.names.join(', ')} (${lr.rooms} rom i alt)`);

  const img2 = readPng(path.join(ROOT, 'plantegninger/_png/hus4/2etg.png'));
  const d2 = D.detectPlan(img2, { pxPerM: ppm, clean: true });
  const m2 = [...missing(d2, ppm, 'single', [[482, 458], [456, 615], [284, 1027], [1381, 670]]), ...missing(d2, ppm, 'window', [[247, 198], [478, 198], [810, 198], [1381, 377], [1381, 963], [757, 1027], [1074, 1027], [1196, 1027], [1317, 1027]])];
  const c2 = countBy(d2);
  // known: a winder of the U stair over the hall reads as a 0,67 m door (786, 458), and the stair itself is not found
  check('hus4 2. etasje med rydding: de 4 slagdørene og de 9 vinduene på plass', !m2.length, `${m2.join('; ') || 'alle'}; ${JSON.stringify(c2)}`);
  check('hus4 2. etasje med rydding: hyllene i W.I.C er ikke en trapp', !d2.stairs.some((s) => s.bbox[0] < 230 && s.bbox[2] < 320), d2.stairs.map((s) => `${s.kind} [${s.bbox.map(Math.round)}]`).join(', ') || 'ingen trapp');
}
{
  // hus9: a hobby tool's render (JPEG, low resolution, light grey walls, wood textures, coloured furniture). Without
  // the cleaner nothing is found; with it the outer walls and some rooms. Doors are thin light grey arcs, often too
  // faint; the windows of the lower floor are white gaps with no line and stay wall
  const o = D.detectPlan(readPng(path.join(ROOT, 'plantegninger/_png/hus9/ovre-etasje.png')), { pxPerM: 45.4, clean: true });
  const mo = [...missing(o, 45.4, 'single', [[294, 58], [516, 59]]), ...missing(o, 45.4, 'window', [[138, 59], [332, 58], [553, 98], [554, 373], [108, 467], [460, 468], [23, 410], [23, 428]])];
  check('hus9 øvre etasje med rydding: begge ytterdørene og alle 8 vinduene', !mo.length, `${mo.join('; ') || 'alle'}; ${JSON.stringify(countBy(o))}`);
  const lo = labelledRooms(o, 45.4, [['Stue', [[205, 300]], 56.38], ['Hall', [[298, 160]], 9.07], ['Bad', [[418, 135]], 5.44], ['Vask', [[517, 95]], 5.45], ['Kjøkken', [[475, 265]], 14.48]]);
  check('hus9 øvre etasje med rydding: minst 3 av 5 rom med etikett (Stue og Hall er åpne mot hverandre)', lo.ok >= 3, `${lo.ok}/${lo.total}: ${lo.names.join(', ')}`);
  const u = D.detectPlan(readPng(path.join(ROOT, 'plantegninger/_png/hus9/underetasje.png')), { pxPerM: 54.1, clean: true });
  const ext = u.walls.filter((w) => w.exterior);
  const box = [Math.min(...ext.map((w) => Math.min(w.a[0], w.b[0]) - w.t / 2)), Math.min(...ext.map((w) => Math.min(w.a[1], w.b[1]) - w.t / 2)), Math.max(...ext.map((w) => Math.max(w.a[0], w.b[0]) + w.t / 2)), Math.max(...ext.map((w) => Math.max(w.a[1], w.b[1]) + w.t / 2))];
  const off = Math.max(...[10, 6, 662, 512].map((v, i) => Math.abs(v - box[i]))) / 54.1;
  const mu = [...missing(u, 54.1, 'single', [[573, 317], [652, 279]]), ...missing(u, 54.1, 'opening', [[336, 193], [368, 274]])];
  check('hus9 underetasje med rydding: ytterveggene (omrisset innen 25 cm), Voksensov-døra, ytterdøra og de 2 åpningene', off <= 0.25 && !mu.length, `omriss ${(off * 100).toFixed(0)} cm unna; ${mu.join('; ') || 'alle'}; ${JSON.stringify(countBy(u))}`);
  const lu = labelledRooms(u, 54.1, [['Stue', [[235, 215]], 28.91], ['Bod', [[390, 105]], 9.3], ['Bad', [[560, 108]], 8.94], ['Sone', [[505, 268]], 10.78], ['Barnesov v', [[130, 410]], 10.62], ['Barnesov ø', [[305, 420]], 10.56], ['Voksensov', [[555, 440]], 13.71]]);
  check('hus9 underetasje med rydding: minst 5 av 7 rom med etikett', lu.ok >= 5, `${lu.ok}/${lu.total}: ${lu.names.join(', ')}`);
}
{
  // the time on the largest sheets (the round 1 symbols cost ~1–2 s there before they were limited to the rooms): the
  // best of three runs, so another process on the machine does not decide it (hus7 measured 1.7–4.2 s in one minute
  // while other suites ran)
  for (const [name, file, ppm, limit] of [['hus7 (4771 × 3332)', 'plantegninger/_png/hus7/garasje-plan-snitt-fasade.png', 117.4, 3000], ['hus6 (3309 × 2340)', 'plantegninger/_png/hus6/plan-1etg-tilbygg.png', 78.8, 1600]]) {
    const img = readPng(path.join(ROOT, file));
    const ms = [];
    for (let k = 0; k < 3; k++) {
      const t0 = Date.now();
      D.detectPlan(img, { pxPerM: ppm });
      ms.push(Date.now() - t0);
    }
    check(`${name}: gjenkjenningen under ${limit / 1000} s`, Math.min(...ms) < limit, `${ms.join(' / ')} ms`);
  }
}

// ---------------------------------------------------------------------------------------------------------------
section('7. Skillelinjer mellom åpne soner (strek-prikk), og en U-trapp');
/** Rooms with and without the level's separators (model + regions.js). */
function roomsWithSeparators(det, ppm) {
  const doc = M.createDoc('x');
  const lv = M.createLevel(doc, { id: 'hoved', image: { name: 'x', width: 1, height: 1, pxPerM: ppm } });
  M.applyDetection(lv, det, ppm, doc.settings);
  const without = findRooms(lv.walls);
  const withSep = findRooms(lv.walls, { separators: lv.separators });
  return { lv, without, withSep, at: (px) => withSep.at(px[0] / ppm, px[1] / ppm), area: (i) => withSep.rooms.find((r) => r.index === i)?.area ?? NaN };
}
{
  const plan = variantPlans().apen;
  // every scale strictly: under ~90 px/m the dash-dot gaps are 1–3 px (the band's column profile finds them), under
  // 50 px/m the plan is read on an upsampled copy where the dashes merge in the thin ink (the dashed gap left open is
  // the candidate)
  for (const ppm of [35, 40, 50, 60, 70, 80, 90, 120]) {
    const r = renderPlan(plan, { pxPerM: ppm, noise: ppm > 60 ? 5 : 0, seed: ppm + 3, furniture: false });
    const det = D.detectPlan(r.img, { pxPerM: ppm });
    const c = compareSynthetic(plan, det, ppm, r.origin);
    const R = roomsWithSeparators(det, ppm);
    const toM = (p) => [(p[0] - r.origin[0]) / ppm, (p[1] - r.origin[1]) / ppm];
    const sep = det.separators.map((s) => [toM(s.a), toM(s.b)]);
    const truth = plan.separators[0];
    const hit = sep.filter(([a, b]) => Math.hypot(a[0] - truth.a[0], a[1] - truth.a[1]) <= 0.1 && Math.hypot(b[0] - truth.b[0], b[1] - truth.b[1]) <= 0.1);
    // the TV room (south-west) and the hall (north-west)
    const tv = R.at([2.5 * ppm + r.origin[0], 6.2 * ppm + r.origin[1]]);
    const hall = R.at([2.5 * ppm + r.origin[0], 2.2 * ppm + r.origin[1]]);
    const tag = `åpen plan ${ppm} px/m`;
    const onLine = det.walls.filter((w) => w.axis === 'h' && Math.abs(toM(w.a)[1] - 4.5) < 0.15 && Math.min(toM(w.a)[0], toM(w.b)[0]) < 4.8 && Math.max(toM(w.a)[0], toM(w.b)[0]) > 2.7);
    check(`${tag}: alle ${plan.walls.length} vegger, ingen ekstra, og ingen vegg langs skillelinja (bjelken og skillelinja er ikke vegger)`, c.walls === plan.walls.length && c.extraWalls === 0 && !onLine.length, `${c.walls}/${plan.walls.length}, ${c.extraWalls} ekstra, ${onLine.length} på skillelinja`);
    check(`${tag}: skillelinja mellom gangen og TV-stua (innen 10 cm), og bare den (bjelken over soverommet er ingen)`, hit.length === 1 && det.separators.length === 1, sep.map(([a, b]) => `(${a.map(f2)}) → (${b.map(f2)})`).join('; ') || 'ingen');
    // the TV room: from the west wall's face (0.125) to the east wall's (4.95), from the separator (4.5) to the south
    // wall's face (7.875)
    check(`${tag}: rommene: 2 uten skillelinja, 3 med; TV-stua ${f1(4.825 * 3.375)} m² (± 0,3)`, R.without.rooms.length === 2 && R.withSep.rooms.length === 3 && tv >= 0 && hall >= 0 && tv !== hall && Math.abs(R.area(tv) - 4.825 * 3.375) < 0.3, `${R.without.rooms.length} → ${R.withSep.rooms.length} rom, TV-stua ${f2(R.area(tv))} m²`);
    const tvRoom = R.withSep.rooms.find((x) => x.index === tv);
    check(`${tag}: TV-stuas kant mot gangen er skillelinja (ingen vegg)`, !!tvRoom && tvRoom.edges.some((e) => e.separator && e.wall == null), tvRoom ? tvRoom.edges.map((e) => e.separator ?? e.wall ?? '–').join(',') : 'ingen TV-stue');
    check(`${tag}: alle ${c.ops.total} åpninger med riktig type`, c.ops.found === c.ops.total && c.ops.typed === c.ops.total, `${c.ops.found} funnet, ${c.ops.typed} riktig${c.ops.misses.length ? `; ${c.ops.misses.join(", ")}` : ""}`);
    const st = c.stairs[0];
    check(`${tag}: U-trappa med øye (half-turn, overlapp ≥ 40 %: reposet øverst er ikke med), ingen andre`, st.s && st.s.kind === 'half-turn' && st.iou >= 0.4 && det.stairs.length === 1, st.s ? `${st.s.kind}, ${(st.iou * 100).toFixed(0)} %, ${st.s.treads} inntrinn` : 'ingen');
  }
  // regions.js on its own: a separator splits a rectangle, its edge has no wall, the rest stays as it was
  const walls = [
    { id: 'n', a: [0, 0], b: [6, 0], t: 0.2 },
    { id: 'e', a: [6, 0], b: [6, 4], t: 0.2 },
    { id: 's', a: [6, 4], b: [0, 4], t: 0.2 },
    { id: 'w', a: [0, 4], b: [0, 0], t: 0.2 },
  ];
  const one = findRooms(walls);
  const two = findRooms(walls, { separators: [{ id: 'sk', a: [3, 0], b: [3, 4] }] });
  const areas = two.rooms.map((x) => x.area).sort((p, q) => p - q);
  check('regions.js: en skillelinje deler et rom i to like store, kanten langs den har ingen vegg', one.rooms.length === 1 && two.rooms.length === 2 && Math.abs(areas[0] - areas[1]) < 0.02 && Math.abs(areas[0] + areas[1] - one.rooms[0].area) < 0.02 && two.rooms.every((x) => x.edges.filter((e) => e.separator === 'sk' && e.wall == null && e.side === 0).length === 1), `${one.rooms.length} → ${two.rooms.length} rom, ${areas.map(f2).join(' + ')} m² (${f2(one.rooms[0].area)})`);
  const sk = M.createDoc('x');
  const lv = M.createLevel(sk, { id: 'hoved', image: { name: 'x', width: 1, height: 1, pxPerM: 50 } });
  M.applyDetection(lv, { walls: [], openings: [], separators: [{ a: [100, 50], b: [100, 250] }] }, 50);
  M.rescaleLevel(lv, 100);
  check('modellen: skillelinjene i meter, og de følger en ny skala', lv.separators.length === 1 && lv.separators[0].a[0] === 1 && lv.separators[0].b[1] === 2.5, JSON.stringify(lv.separators));
}
{
  // hus4 1. etasje: the dash-dot beam between the hall and the TV room (y ≈ 618 px, from the post at the end of the wall
  // to Sov 9,3 to the top of the TV room's east wall) – with it the TV room is a room of its own, 12.1 m² inside its
  // walls by the fasit (its label 15.7 takes in part of the hall)
  const ppm = 120.5;
  const det = D.detectPlan(readPng(path.join(ROOT, 'plantegninger/_png/hus4/1etg.png')), { pxPerM: ppm, clean: true });
  const R = roomsWithSeparators(det, ppm);
  const s = det.separators[0];
  check('hus4 1. etasje: skillelinja mellom gangen og TV-stua (x 485–935, y 618 px ± 10), ingen andre', det.separators.length === 1 && Math.abs(s.a[1] - 618) <= 10 && Math.abs(s.b[1] - 618) <= 10 && Math.abs(s.a[0] - 485) <= 15 && Math.abs(s.b[0] - 935) <= 15, det.separators.map((x) => `(${x.a.map(Math.round)}) → (${x.b.map(Math.round)})`).join('; ') || 'ingen');
  const tv = R.at([698, 700]);
  const entre = R.at([508, 395]);
  const lr = levelRooms(R.lv);
  check('regions.js levelRooms(level): rommene med etasjens skillelinjer, som findRooms med dem', lr.rooms.length === R.withSep.rooms.length && lr.at(698 / ppm, 700 / ppm) === tv, `${lr.rooms.length} rom (${R.withSep.rooms.length} med, ${R.without.rooms.length} uten)`);
  check('hus4 1. etasje: med skillelinja er TV-stua et eget rom (12,1 m² innenfor veggene ±10 %), Entré + gangen et annet', tv >= 0 && entre >= 0 && tv !== entre && Math.abs(R.area(tv) / 12.1 - 1) <= 0.1 && R.withSep.rooms.length === R.without.rooms.length + 1, `TV-stua ${f2(R.area(tv))} m², Entré + gang ${f2(R.area(entre))} m², ${R.without.rooms.length} → ${R.withSep.rooms.length} rom`);
  // dash-dot lines that are no separators: the beam across hus4's 2nd floor (wall face to wall face), the front of the
  // wardrobe in hus2's entrance (a niche, 0.6 m deep), hus6's section line A–A and the beams along its walls
  const none = [
    ['hus4 2. etasje (bjelken tvers over huset)', 'plantegninger/_png/hus4/2etg.png', 120.5, true],
    ['hus2 (garderobefronten i entreen)', 'plantegninger/hus2/1etg.png', 55.6, false],
    ['hus6 (snittlinja A–A, strek-prikk langs veggene)', 'tools/fixtures/clean/hus6-plan-farge.png', 78.8, true],
    ['hus1 1. etasje', 'plantegninger/hus1/1etg.png', 97.4, false],
    ['hus1 2. etasje (den stiplede takkanten)', 'plantegninger/hus1/2etg.png', 94, false],
    ['hus3 1. etasje («ÅPENT OPP»)', 'plantegninger/hus3/1etg.png', 47.9, false],
    ['hus5 (skråhimlingslinjene)', 'plantegninger/_png/hus5/1etg.png', 46.9, false],
  ];
  for (const [name, file, p, clean] of none) {
    const d = D.detectPlan(readPng(path.join(ROOT, file)), { pxPerM: p, clean });
    check(`${name}: ingen skillelinjer`, d.separators.length === 0, d.separators.map((x) => `(${x.a.map(Math.round)}) → (${x.b.map(Math.round)})`).join('; ') || `0 av ${d.debug.separatorLines.length} stiplede linjer`);
  }
  let cloneErr = null;
  try {
    structuredClone({ separators: det.separators });
  } catch (e) {
    cloneErr = e;
  }
  check('skillelinjene tåler postMessage (structuredClone)', !cloneErr, cloneErr?.message);
}

// ---------------------------------------------------------------------------------------------------------------
section('8. Oppfølgingen etter fase A: trapper, skyvedøra i hus6, vinduene i hus9');
{
  // hus6 (the colour original, as the browser gets it, with clean: true): the four black leaves between STUE 2 and
  // SPISESTUE (x 960–1228) are a sliding door – before, the wall was joined across the opening with nothing in it
  const ppm = 78.8;
  const det = D.detectPlan(readPng(path.join(ROOT, 'tools/fixtures/clean/hus6-plan-farge.png')), { pxPerM: ppm, clean: true });
  const o = openingAt(det, [1094, 1065], ppm);
  check('hus6: STUE 2 – SPISESTUE er en skyvedør på ca. 3,4 m (fire blader), ikke en vegg', o && o.kind === 'sliding' && o.d < 0.3 * ppm && o.width >= 3.2 && o.width <= 3.8, o ? `${o.kind}, ${f2(o.width)} m, ${f1(o.d)} px unna` : 'ingen');
  const st = det.stairs.map((x) => ({ x, iou: iou(x.bbox, [1360, 1858, 1690, 1960]) })).sort((a, b) => b.iou - a.iou)[0];
  // a quarter turn of winders at each end of the straight flight (2 × 90°): the right-hand winders are 1 px lines aliased
  // into dots (the broken segments find them), and the three of them meet in one point over two vote cells
  check('hus6: trappa i ENTRE (fasit x 1360–1690, y 1858–1960 px), halvsvingt (svingtrinn i begge ender), overlapp ≥ 75 %', st && st.x.kind === 'half-turn' && st.iou >= 0.75, st ? `${st.x.kind}, ${(st.iou * 100).toFixed(0)} %, ${st.x.treads} inntrinn` : 'ingen');
}
{
  // hus8 1. etasje: the straight flight of six faint tread lines (6 px apart at 34 px/m, JPEG) between its walls
  const det = D.detectPlan(readPng(path.join(ROOT, 'plantegninger/_png/hus8/plantegning-3.png')), { pxPerM: 34, clean: true });
  const st = det.stairs.map((x) => ({ x, iou: iou(x.bbox, [360, 572, 392, 604]) })).sort((a, b) => b.iou - a.iou)[0];
  check('hus8 1. etasje: det rette løpet (trinnlinjene y 572–604, x 360–392 px), overlapp ≥ 50 %, ingen andre trapper', st && st.x.kind === 'straight' && st.iou >= 0.5 && det.stairs.length === 1, st ? `${st.x.kind}, ${(st.iou * 100).toFixed(0)} %, ${st.x.treads} trinnlinjer, ${det.stairs.length} trapper` : 'ingen');
}
{
  // hus9 lower floor: the windows are white bars between the grey wall's outlines; the band of a light grey wall reaches
  // both outlines (its thickness integrated against its own fill, not the middle of the grey band), so the frame line
  // is part of the window, not a thin wall beside the gap
  const ppm = 54.1;
  const det = D.detectPlan(readPng(path.join(ROOT, 'plantegninger/_png/hus9/underetasje.png')), { pxPerM: ppm, clean: true });
  const win = [[21, 226], [21, 382], [165, 502], [319, 502], [485, 502]];
  const mw = missing(det, ppm, 'window', win);
  const frame = det.walls.filter((w) => w.axis === 'v' && Math.abs(w.a[0] - 31.5) < 3 && w.t < 4);
  check('hus9 underetasje: 5 av 6 vinduer (de to stuevinduene med felles ramme blir ett), ingen tynn vegg langs vindusrammene', !mw.length && !frame.length, `${mw.join('; ') || 'alle'}, ${countBy(det).window} vinduer, ${frame.length} rammevegger`);
}

{
  // hus9 lower floor at 50 px/m (the scale «Generer» takes from the standard measures): the dark border of the rug in
  // the middle Barnesov hangs on the house only through empty gaps to the exterior wall (now that its windows are found,
  // that wall runs through) – it stays a frame of its own and is dropped: no walls round the rug, no «sliding door»
  // from the rug's edge (a 20 cm leaf), none from the bath's edge by the east wall; the room count as measured (fasit 7:
  // Voksensov is cut by the bed and the wardrobe, and a sliver by the stair – both there before round 1)
  const ppm = 50;
  const det = D.detectPlan(readPng(path.join(ROOT, 'plantegninger/_png/hus9/underetasje.png')), { pxPerM: ppm, clean: true });
  const R = roomsOf(det, ppm);
  const k = (54.1 / ppm) ** 2;
  const rug = R.at([327, 462]);
  const mid = R.at([300, 380]);
  const area = R.area(mid);
  check('hus9 underetasje ved 50 px/m: teppet i Barnesov (midten) er ingen vegg – rommet er ett, 10,56 m² ved fasitskalaen ± 10 %', rug >= 0 && rug === mid && Math.abs(area / (10.56 * k) - 1) <= 0.1, `teppet i rom ${rug}, rommet ${mid}: ${f2(area)} m² (${f2(10.56 * k)})`);
  check('hus9 underetasje ved 50 px/m: ingen skyvedører (fasit 0), ingen dør i ytterveggen ved teppet', countBy(det).sliding === 0 && !(openingAt(det, [327, 472], ppm)?.d < 0.3 * ppm && openingAt(det, [327, 472], ppm)?.kind !== 'window'), `${countBy(det).sliding} skyvedører`);
  check('hus9 underetasje ved 50 px/m: høyst 9 rom (fasit 7; 8 før runde 1, da det ene barnerommet var åpent ut)', R.f.rooms.length <= 9, `${R.f.rooms.length} rom: ${R.f.rooms.map((x) => f1(x.area)).join(' ')}`);
}
{
  // hus9 alternative lower floor (54.1 px/m): the window of the left Barnesov (x 124–205) has its glass taken by the
  // cleaner, and the flowers of the rug in front of it make a 75 % arc with no leaf – no door there, a window
  const ppm = 54.1;
  const det = D.detectPlan(readPng(path.join(ROOT, 'plantegninger/_png/hus9/underetasje-alternativ.png')), { pxPerM: ppm, clean: true });
  const o = openingAt(det, [139, 502], ppm);
  check('hus9 alternativet: ingen dør i vinduet til Barnesov (blomstene på teppet er ingen dørbue)', !o || o.d > 0.3 * ppm || o.kind === 'window', o ? `${o.kind}, ${f2(o.width)} m, ${f1(o.d)} px unna` : 'ingen');
}
{
  // no sliding leaf under 35 cm (the true ones measured 0.41–1.31 m): hus6's open passage between KJØKKEN and STUE and
  // hus9's bath edge were sliding doors with 0.30–0.34 m «leaves»
  const ppm = 78.8;
  const det = D.detectPlan(readPng(path.join(ROOT, 'tools/fixtures/clean/hus6-plan-farge.png')), { pxPerM: ppm, clean: true });
  const short = det.openings.filter((o) => o.variant === 'sliding' && o.leaf < 0.35 * ppm);
  const o = openingAt(det, [1274, 1580], ppm);
  check('hus6: ingen skyvedør med blad under 35 cm, og passasjen KJØKKEN–STUE er ingen skyvedør', !short.length && !(o && o.d < 0.3 * ppm && o.kind === 'sliding'), `${short.length} korte, ${o ? `${o.kind} ${f2(o.width)} m` : 'ingen'} ved passasjen`);
}

// ---------------------------------------------------------------------------------------------------------------
section('9. Trapper som svinger rundt et smalt øye (hus4): den syntetiske U-trappa og hus4');
{
  const plans = variantPlans();
  for (const name of ['utrapp', 'utrappStiplet']) {
    for (const ppm of [50, 60, 90, 120]) {
      const plan = plans[name];
      const r = renderPlan(plan, { pxPerM: ppm, noise: ppm > 60 ? 5 : 0, seed: ppm + 3, furniture: false });
      const det = D.detectPlan(r.img, { pxPerM: ppm });
      const c = compareSynthetic(plan, det, ppm, r.origin);
      const st = c.stairs[0];
      const tag = `${name === 'utrapp' ? 'U-trapp rundt et øye' : 'U-trapp rundt et øye, venstre halvdel stiplet'} ${ppm} px/m`;
      check(`${tag}: halvsvingt (half-turn), overlapp ≥ 80 %, ingen andre trapper; alle vegger, ingen ekstra`, st.s && st.s.kind === 'half-turn' && st.iou >= 0.8 && det.stairs.length === 1 && c.walls === plan.walls.length && c.extraWalls === 0, st.s ? `${st.s.kind}, ${(st.iou * 100).toFixed(0)} %, ${st.s.winders} svingtrinn, ${det.stairs.length} trapper, ${c.walls}/${plan.walls.length} vegger, ${c.extraWalls} ekstra` : 'ingen');
    }
  }
  // hus4 (clean: true, as «Generer» detects): the half-turn that winds round its newel – on the 2nd floor every tread
  // drawn, on the 1st the left half dashed (above the cut plane) and the floor's hatching under it
  for (const [lvl, file, truth] of [['1. etasje', 'plantegninger/_png/hus4/1etg.png', [686, 222, 920, 465]], ['2. etasje', 'plantegninger/_png/hus4/2etg.png', [695, 220, 924, 461]]]) {
    const det = D.detectPlan(readPng(path.join(ROOT, file)), { pxPerM: 120.5, clean: true });
    const st = det.stairs.map((x) => ({ x, iou: iou(x.bbox, truth) })).sort((a, b) => b.iou - a.iou)[0];
    check(`hus4 ${lvl}: U-trappa rundt øyet (fasit x ${truth[0]}–${truth[2]}, y ${truth[1]}–${truth[3]} px), halvsvingt, overlapp ≥ 70 %, ingen andre`, st && st.x.kind === 'half-turn' && st.iou >= 0.7 && det.stairs.length === 1, st ? `${st.x.kind}, ${(st.iou * 100).toFixed(0)} %, ${st.x.winders} svingtrinn, ${det.stairs.length} trapper` : 'ingen');
  }
  // no winding stair from diagonal strokes that do not radiate from a newel: «PLAN HIMLING» and the lines by it (hus2),
  // a rotated armchair and the «Skråhiml.» line (hus5)
  for (const [name, file, ppm] of [['hus2', 'plantegninger/hus2/1etg.png', 55.6], ['hus5', 'plantegninger/_png/hus5/1etg.png', 46.9]]) {
    const det = D.detectPlan(readPng(path.join(ROOT, file)), { pxPerM: ppm, clean: true });
    check(`${name} med rydding: ingen trapp (skrå tekst, skrå streker og en skråstilt lenestol er ingen svingtrinn)`, !det.stairs.length, det.stairs.map((x) => `${x.kind} [${x.bbox.map(Math.round)}]`).join(', ') || 'ingen');
  }
}

done();
