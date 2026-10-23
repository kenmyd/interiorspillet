#!/usr/bin/env node
/**
 * Tests for src/planbygger/align.js (alignLevelTo: levels on top of each other, notes/planbygger-runde1-design.md).
 *
 *   node tools/test-planbygger-align.mjs [--only=eier,hus3,hus4,hus1,stort] [--quick] [--verbose]
 *
 *   1. synthetic levels: the outline finds a known shift with the outer faces flush; an outline with two equal peaks
 *      falls back to the corner; detect.stairs boxes (pixels) and model rects become metre boxes; paired boxes without
 *      the images give the shift
 *   2. the fallback stair finder on drawn plans: a straight flight is found, a tile grid and floor hatching are not;
 *      the drawing match finds a stair moved between two drawings to 1 cm
 *   3. the real houses against hand-measured answers (tools/fixtures/align/houses.json): the owner's ground floor over
 *      the basement (avstemming V1: bod 1 at 0.13, 0.13 m, as in tools/test-planbygger.mjs §9), hus3, hus4 and hus1 –
 *      detect.stairs with the images (the design's flow), the fallback finder alone, the hand-measured stair boxes
 *      without images, the finder's true and false boxes without images (never a confident answer metres off), and
 *      the outline alone; a big sheet (hus6) on itself under 6 s
 *
 * --quick skips section 3 (the detection of eight plans and the big sheet take about half a minute).
 */
import { ROOT, imp, readJson, check, section, done, KJELLER_PLAN } from './planbygger-lib.mjs';
import path from 'node:path';
import fs from 'node:fs';
import { readPng } from './planbygger-png.mjs';

const args = process.argv.slice(2);
const flag = (k) => args.find((a) => a.startsWith(`--${k}=`))?.split('=').slice(1).join('=');
const only = flag('only')?.split(',') ?? null;
const quick = args.includes('--quick');
const verbose = args.includes('--verbose');

const A = await imp('src/planbygger/align.js');
const M = await imp('src/planbygger/model.js');
const E = await imp('src/planbygger/export.js');

/** detect.js is being worked on by others: an import that throws is retried a few times. */
async function importDetect() {
  for (let k = 0; k < 6; k++) {
    try {
      return await imp(`src/planbygger/detect.js${k ? `?retry=${k}` : ''}`);
    } catch (e) {
      console.log(`  (detect.js lot seg ikke laste: ${e.message.split('\n')[0]} – prøver igjen om 20 s)`);
      await new Promise((r) => setTimeout(r, 20000));
    }
  }
  throw new Error('detect.js kan ikke lastes');
}

const cm = (v) => `${(v * 100).toFixed(1)} cm`;
const f3 = (p) => (p ? p.map((v) => v.toFixed(3)).join(', ') : '–');
const err = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]);

/** A rectangle of four walls (centre lines) with thickness t, outer faces at x0, y0, x1, y1. */
const box = (x0, y0, x1, y1, t, id = 'w') => {
  const h = t / 2;
  return [
    { id: `${id}n`, a: [x0 + h, y0 + h], b: [x1 - h, y0 + h], t },
    { id: `${id}e`, a: [x1 - h, y0 + h], b: [x1 - h, y1 - h], t },
    { id: `${id}s`, a: [x1 - h, y1 - h], b: [x0 + h, y1 - h], t },
    { id: `${id}w`, a: [x0 + h, y1 - h], b: [x0 + h, y0 + h], t },
  ];
};
const shifted = (walls, d) => walls.map((w) => ({ ...w, a: [w.a[0] + d[0], w.a[1] + d[1]], b: [w.b[0] + d[0], w.b[1] + d[1]] }));
const lvl = (walls, ppm = 50) => ({ walls, offset: [0, 0], image: { pxPerM: ppm } });

// ---------------------------------------------------------------------------------------------------------------
section('1. Syntetiske etasjer: omriss, hjørne og trappebokser');
{
  // the ground floor: 9 × 7 m, 0.30 m exterior walls, two interior walls
  const ref = lvl([...box(1, 1, 10, 8, 0.3), { id: 'i1', a: [5, 1.15], b: [5, 7.85], t: 0.1 }, { id: 'i2', a: [1.15, 4], b: [5, 4], t: 0.1 }]);
  // the floor above in its own frame: the same outline with 0.20 m walls (the outer faces flush), other rooms
  const d = [-1.23, 0.57];
  const up = lvl(shifted([...box(1, 1, 10, 8, 0.2), { id: 'j1', a: [7, 1.1], b: [7, 7.9], t: 0.1 }], d));
  const r = A.alignLevelTo(up, ref);
  const want = [-d[0], -d[1]];
  check('omriss: kjent forskyvning med ytterflatene i flukt (± 1 cm)', r.method === 'outline' && err(r.offset, want) <= 0.011, `${r.method} ${f3(r.offset)} (fasit ${f3(want)}, ${cm(err(r.offset, want))}), score ${r.score}`);
  // the reference itself moved: its offset is kept
  const ref2 = { ...ref, offset: [0.5, -0.25] };
  const r2 = A.alignLevelTo(up, ref2);
  check('omriss: referansens offset kommer i tillegg', err(r2.offset, [want[0] + 0.5, want[1] - 0.25]) <= 0.011, f3(r2.offset));
  check('alignLevelTo endrer ikke etasjene', up.offset[0] === 0 && up.offset[1] === 0 && ref2.offset[0] === 0.5);

  // two equal outline peaks (the upper floor 0.4 m shorter): the corner decides, the north-east one by default
  const long = lvl(box(0, 0, 6, 10, 0.3));
  const short = lvl(box(0, 0, 6, 9.6, 0.3));
  const rc = A.alignLevelTo(short, long, { north: 0 });
  // north up: NE = the top right corner, so the top faces flush (offset 0, 0)
  check('to like topper i omrisset → hjørnet (NØ som standard)', rc.method === 'corner' && rc.detail.corner === 'ne' && err(rc.offset, [0, 0]) <= 0.011, `${rc.method} ${rc.detail.corner} ${f3(rc.offset)}, andre topp ${rc.detail.outline?.second}`);
  const rs = A.alignLevelTo(short, long, { north: 0, corner: 'sw' });
  check('hjørnet kan velges (SV: bunnflatene i flukt)', rs.method === 'corner' && err(rs.offset, [0, 0.4]) <= 0.011, f3(rs.offset));
  check('uten vegger: hjørnet med score 0', A.alignLevelTo(lvl([]), long).score === 0);

  // the stair boxes: detect.stairs (pixels) and model rects (metres)
  const bs = A.stairBoxes({ image: { pxPerM: 50 } }, [{ bbox: [100, 50, 150, 200], axis: 'y', treads: 12, kind: 'straight' }, { rect: [[3, 2], [1, 1]] }]);
  check('trappebokser: piksler → meter, rect i meter', bs.length === 2 && err(bs[0].box, [2, 1]) < 1e-9 && err(bs[0].box.slice(2), [3, 4]) < 1e-9 && err(bs[1].box, [1, 1]) < 1e-9, JSON.stringify(bs.map((b) => b.box)));
  check('trappebokser: [] betyr ingen (ingen leting)', A.stairBoxes({ image: { pxPerM: 50 } }, [], null).length === 0);

  // paired boxes without the images: the centres give the shift, the walls near the stair refine it
  const shaft = (o) => [
    { id: 's1', a: [3 + o[0], 2 + o[1]], b: [3 + o[0], 5.5 + o[1]], t: 0.1 },
    { id: 's2', a: [4.2 + o[0], 2 + o[1]], b: [4.2 + o[0], 5.5 + o[1]], t: 0.1 },
  ];
  const g = lvl([...box(1, 1, 10, 8, 0.3), ...shaft([0, 0])]);
  const dd = [0.84, -0.31];
  const u = lvl([...shifted(box(1, 1, 10, 8, 0.3), dd), ...shaft(dd)]);
  // the boxes as a detector would give them: the upper one 6 cm off and a little shorter
  const upBox = { bbox: [(3.05 + dd[0] + 0.06) * 50, (2.1 + dd[1]) * 50, (4.15 + dd[0] + 0.06) * 50, (5.3 + dd[1]) * 50] };
  const refBox = { bbox: [3.05 * 50, 2 * 50, 4.15 * 50, 5.5 * 50] };
  const rb = A.alignLevelTo(u, g, { stairs: [upBox], refStairs: [refBox] });
  check('trappeboksene uten bilder: paret stemmer med omrisset → trapp, ytterflatene gir cm (± 1 cm)', rb.method === 'stair' && rb.detail.stair?.how === 'boxes + outline' && err(rb.offset, [-dd[0], -dd[1]]) <= 0.011, `${rb.method} (${rb.detail.stair?.how}) ${f3(rb.offset)}, fasit ${f3([-dd[0], -dd[1]])}, score ${rb.score}`);
  // a false box on each floor, the same size, metres apart: a clear outline turns the pair down
  const falseUp = { bbox: [(6.5 + dd[0]) * 50, (3.5 + dd[1]) * 50, (7.6 + dd[0]) * 50, (7 + dd[1]) * 50] };
  const rf = A.alignLevelTo(u, g, { stairs: [falseUp], refStairs: [refBox] });
  check('falsk trappeboks: et klart omriss avviser paret, omrisset vinner (± 1 cm)', rf.method === 'outline' && err(rf.offset, [-dd[0], -dd[1]]) <= 0.011 && rf.detail.stair?.candidates?.length === 1, `${rf.method} ${f3(rf.offset)}, kandidater ${JSON.stringify(rf.detail.stair?.candidates?.map((c) => ({ t: f3(c.t), fit: c.score, omriss: c.outline })))}`);
  // the false box fits the reference box better than the true one does: the pair the outline backs still wins
  const rf2 = A.alignLevelTo(u, g, { stairs: [falseUp, upBox], refStairs: [refBox] });
  check('ekte + falsk boks: paret omrisset støtter vinner, ikke det som passer best i størrelse', rf2.method === 'stair' && err(rf2.offset, [-dd[0], -dd[1]]) <= 0.011, `${rf2.method} (${rf2.detail.stair?.how}) ${f3(rf2.offset)}, score ${rf2.score}`);

  // an outline with two equal peaks (the floor above 0.4 m shorter): the stair picks the one it lands on
  const stairLong = { bbox: [1 * 50, 5 * 50, 2 * 50, 8.5 * 50] };
  const stairShort = { bbox: [1 * 50, 4.6 * 50, 2 * 50, 8.1 * 50] };
  const ra = A.alignLevelTo(short, long, { north: 0, stairs: [stairShort], refStairs: [stairLong] });
  check('to like topper + trappeboksene: trappa velger toppen (bunnflatene i flukt, ± 1 cm)', ra.method === 'stair' && ra.detail.stair?.how === 'boxes + outline' && err(ra.offset, [0, 0.4]) <= 0.011, `${ra.method} (${ra.detail.stair?.how}) ${f3(ra.offset)}, score ${ra.score}`);

  // no outline to go by: the upper floor has only the stair shaft and a wall just past its foot (a partial plan, whose
  // few walls lie on the house's outer band at some shift by chance); the walls near the stair decide
  const part = lvl([...shaft(dd), { id: 'p1', a: [3.05 + dd[0], 5.8 + dd[1]], b: [6 + dd[0], 5.8 + dd[1]], t: 0.1 }]);
  const gp = lvl([...box(1, 1, 10, 8, 0.3), ...shaft([0, 0]), { id: 'p1', a: [3.05, 5.8], b: [6, 5.8], t: 0.1 }]);
  const rw = A.alignLevelTo(part, gp, { stairs: [upBox], refStairs: [refBox] });
  check('uten brukbart omriss: veggene ved trappa forfiner paret (± 1 cm)', rw.method === 'stair' && /walls|outline/.test(rw.detail.stair?.how) && err(rw.offset, [-dd[0], -dd[1]]) <= 0.011, `${rw.method} (${rw.detail.stair?.how}) ${f3(rw.offset)}, omriss andel ${rw.detail.outline?.share}, dekning ${rw.detail.outline?.coverage}, andre ${rw.detail.outline?.second}, score ${rw.score}`);

  // nothing but the boxes: one pair alone is taken with a low score, two rival pairs are not
  const bare = lvl([]);
  const r1 = A.alignLevelTo(bare, lvl([]), { stairs: [{ bbox: [100, 100, 150, 275] }], refStairs: [{ bbox: [130, 80, 181, 255] }] });
  check('bare boksene, ett par: trapp med lav score', r1.method === 'stair' && r1.detail.stair?.how === 'boxes' && err(r1.offset, [0.61, -0.4]) <= 0.011 && r1.score <= 0.4, `${r1.method} (${r1.detail.stair?.how}) ${f3(r1.offset)}, score ${r1.score}`);
  const r2b = A.alignLevelTo(bare, lvl([]), { stairs: [{ bbox: [100, 100, 150, 275] }], refStairs: [{ bbox: [130, 80, 181, 255] }, { bbox: [300, 200, 349, 374] }] });
  check('bare boksene, to rivaler: ingen trapp', r2b.method === 'corner' && r2b.score === 0, `${r2b.method}, kandidater ${r2b.detail.stair?.candidates?.length}`);
}

// ---------------------------------------------------------------------------------------------------------------
section('2. Trappefinneren og tegningssøket på tegnede planer');

/** A white RGBA canvas of w × h metres at ppm. */
function canvas(w, h, ppm) {
  const W = Math.round(w * ppm);
  const H = Math.round(h * ppm);
  const data = new Uint8ClampedArray(W * H * 4).fill(255);
  return { width: W, height: H, data, ppm };
}
/** A line from a to b (metres), `px` pixels wide, grey v; dashed: [on, off] in metres. */
function line(img, a, b, { px = 2, v = 30, dash = null } = {}) {
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]) * img.ppm;
  const n = Math.ceil(L * 2);
  for (let k = 0; k <= n; k++) {
    const s = k / n;
    if (dash) {
      const m = (s * L) / img.ppm;
      if (m % (dash[0] + dash[1]) > dash[0]) continue;
    }
    const x = (a[0] + (b[0] - a[0]) * s) * img.ppm;
    const y = (a[1] + (b[1] - a[1]) * s) * img.ppm;
    for (let dy = -px / 2; dy < px / 2; dy++) {
      for (let dx = -px / 2; dx < px / 2; dx++) {
        const xi = Math.round(x + dx);
        const yi = Math.round(y + dy);
        if (xi < 0 || yi < 0 || xi >= img.width || yi >= img.height) continue;
        const i = (yi * img.width + xi) * 4;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = Math.min(img.data[i], v);
      }
    }
  }
}
/** A filled dark rectangle (a wall). */
function wall(img, x0, y0, x1, y1) {
  for (let y = Math.round(y0 * img.ppm); y < Math.round(y1 * img.ppm); y++) {
    for (let x = Math.round(x0 * img.ppm); x < Math.round(x1 * img.ppm); x++) {
      const i = (y * img.width + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 20;
    }
  }
}
/** A straight flight at (x, y): width × n treads of `going`, the treads across x; the stringers along y. */
function flight(img, x, y, width, n, going, opts = {}) {
  for (let k = 0; k <= n; k++) line(img, [x, y + k * going], [x + width, y + k * going], opts);
  line(img, [x, y], [x, y + n * going]);
  line(img, [x + width, y], [x + width, y + n * going]);
}
/** The test plan: a house outline, a stair at (sx, sy), a tiled room, a hatched room. */
function drawnPlan(ppm, sx, sy, { tiles = true, hatch = true } = {}) {
  const img = canvas(14, 11, ppm);
  wall(img, 1, 1, 13, 1.25);
  wall(img, 1, 9.75, 13, 10);
  wall(img, 1, 1, 1.25, 10);
  wall(img, 12.75, 1, 13, 10);
  wall(img, 6, 1, 6.1, 10);
  flight(img, sx, sy, 1.0, 13, 0.25);
  if (tiles) for (let k = 0; k <= 8; k++) {
    line(img, [7 + k * 0.3, 2], [7 + k * 0.3, 4.4], { px: 1, v: 120 });
    line(img, [7, 2 + k * 0.3], [9.4, 2 + k * 0.3], { px: 1, v: 120 });
  }
  if (hatch) for (let k = 0; k <= 16; k++) line(img, [7, 5.5 + k * 0.14], [11.5, 5.5 + k * 0.14], { px: 1, v: 190 });
  return img;
}
{
  const ppm = 50;
  const img = drawnPlan(ppm, 2.5, 3);
  const st = A.findStairs(img, { pxPerM: ppm });
  const truth = [2.5, 3, 3.5, 3 + 13 * 0.25];
  const one = st.length === 1 ? st[0] : null;
  const bm = one ? one.bbox.map((v) => v / ppm) : null;
  check('en rett trapp funnet, ingen i flisene eller skravuren', st.length === 1, JSON.stringify(st.map((s) => ({ bbox: s.bbox.map((v) => +(v / ppm).toFixed(2)), kind: s.kind, treads: s.treads }))));
  check('trappeboksen innen 10 cm, rett trapp, opp langs y', one && Math.max(...bm.map((v, i) => Math.abs(v - truth[i]))) <= 0.1 && one.kind === 'straight' && one.axis === 'y', one ? `${f3(bm)} (fasit ${f3(truth)}), ${one.kind}, ${one.treads} trinn` : 'ingen');
  // the same stair dashed (seen from below, above the cut plane), at 97 px/m
  const img2 = canvas(8, 8, 97);
  wall(img2, 1, 1, 7, 1.25);
  flight(img2, 2, 2, 1.1, 12, 0.26, { dash: [0.1, 0.08], px: 2 });
  const st2 = A.findStairs(img2, { pxPerM: 97 });
  check('stiplet trapp ved 97 px/m', st2.length === 1 && Math.abs(st2[0].bbox[1] / 97 - 2) <= 0.1 && Math.abs(st2[0].bbox[3] / 97 - (2 + 12 * 0.26)) <= 0.12, JSON.stringify(st2.map((s) => s.bbox.map((v) => +(v / 97).toFixed(2)))));
  check('ingen trapp på en tom plan', A.findStairs(drawnPlan(ppm, -5, -5), { pxPerM: ppm }).length === 0);

  // two floors: the stair 0.62 m right and 0.37 m up on the floor above, other rooms; the drawing match finds it
  const lower = drawnPlan(ppm, 2.5, 3, { tiles: false });
  const upper = drawnPlan(ppm, 2.5 + 0.62, 3 - 0.37, { hatch: false });
  const t0 = Date.now();
  const r = A.alignLevelTo({ walls: [], offset: [0, 0], image: { pxPerM: ppm } }, { walls: [], offset: [0, 0], image: { pxPerM: ppm } }, { img: upper, refImg: lower });
  check('tegningssøket: trappa flyttet mellom etasjene, funnet innen 1 cm', r.method === 'stair' && err(r.offset, [-0.62, 0.37]) <= 0.011, `${r.method} ${f3(r.offset)} (fasit −0,620, 0,370), score ${r.score}, ${Date.now() - t0} ms`);
  // a sheet too big for the coarse lattice: the step grows, the detail says so, and the stair is still found
  const rg = A.alignLevelTo({ walls: [], offset: [0, 0], image: { pxPerM: ppm } }, { walls: [], offset: [0, 0], image: { pxPerM: ppm } }, { img: upper, refImg: lower, maxPositions: 2500 });
  check('grovere søk når arket er for stort: notat, og trappa innen 1 cm', rg.method === 'stair' && err(rg.offset, [-0.62, 0.37]) <= 0.011 && (rg.detail.stair?.notes ?? []).some((n) => /coarse/.test(n)), `${rg.method} ${f3(rg.offset)}, ${JSON.stringify(rg.detail.stair?.notes)}`);
}

// ---------------------------------------------------------------------------------------------------------------
section('3. De ekte husene mot håndmålte svar');
if (quick) console.log('  (hopper over: --quick)');
else {
  const D = await importDetect();
  const fx = readJson('tools/fixtures/align/houses.json').houses;
  const levelFrom = async (doc, id, file, ppm) => {
    const img = readPng(path.join(ROOT, file));
    const L = M.createLevel(doc, { id, image: { name: path.basename(file), width: img.width, height: img.height, pxPerM: ppm } });
    const det = D.detectPlan(img, { pxPerM: ppm });
    M.applyDetection(L, det, ppm, doc.settings);
    return { L, img, det };
  };
  const summary = [];

  // the owner's house: the basement under the ground floor, the known answer of avstemming V1
  if (!only || only.includes('eier')) {
    if (!KJELLER_PLAN || !fs.existsSync(KJELLER_PLAN)) console.log('  (hopper over eierens hus: kjellerplanen finnes ikke – bilder_hus/ er gitignorert)');
    else {
      const doc = M.createDoc('eier');
      doc.settings.north = 270;
      const g = await levelFrom(doc, 'hoved', 'plantegning.png', 628 / 12.21);
      const kImg = readPng(KJELLER_PLAN);
      const ppm = 633 / 10.5;
      const k = M.createLevel(doc, { id: 'kjeller', name: 'Kjeller', floorY: -2.55, image: { name: 'kjeller', width: kImg.width, height: kImg.height, pxPerM: ppm } });
      M.applyDetection(k, D.detectPlan(kImg, { pxPerM: ppm }), ppm, doc.settings);
      const t0 = Date.now();
      const r = A.alignLevelTo(k, g.L, { north: 270, img: kImg, refImg: g.img });
      const ms = Date.now() - t0;
      // the reference answer: export.js alignLevel with the NE corner (tools/test-planbygger.mjs §9)
      const copy = M.clone(k);
      E.alignLevel(doc, copy, g.L, 'ne');
      k.offset = r.offset;
      const ex = E.exportHouse(doc);
      const bod1 = ex.house.rooms.find((q) => q.levelId === 'kjeller' && q.polygon.some((p) => p[0] < 0.3 && p[1] < 0.3));
      const c = bod1 ? [Math.min(...bod1.polygon.map((p) => p[0])), Math.min(...bod1.polygon.map((p) => p[1]))] : null;
      check('eier: kjelleren under 1. etasje – bod 1 i 0,13, 0,13 m (± 2 cm)', c && Math.abs(c[0] - 0.13) <= 0.02 && Math.abs(c[1] - 0.13) <= 0.02, c ? `${f3(c)} via ${r.method}${r.detail.corner ? ` (${r.detail.corner})` : ''}` : 'fant ikke boden');
      check('eier: samme offset som alignLevel(NØ) i export.js (± 1 cm)', err(r.offset, copy.offset) <= 0.01, `${f3(r.offset)} mot ${f3(copy.offset)}`);
      check('eier: ingen trapp i 1. etasje (den er ikke tegnet), omrisset har to like topper', !r.detail.stair?.t && r.detail.outline?.ambiguous === true, `trapper ${JSON.stringify(r.detail.stair?.levelStairs ?? [])} / ${JSON.stringify(r.detail.stair?.refStairs ?? [])}, andre topp ${r.detail.outline?.second}`);
      summary.push(`eier: ${r.method} ${f3(r.offset)}, bod 1 ${f3(c)}, ${ms} ms`);
    }
  }

  for (const key of ['hus3', 'hus4', 'hus1']) {
    if (only && !only.includes(key)) continue;
    const H = fx[key];
    const doc = M.createDoc(key);
    const R = await levelFrom(doc, 'hoved', H.ref.file, H.ref.ppm);
    const U = await levelFrom(doc, 'etasje-2', H.level.file, H.level.ppm);
    const tol = 0.03;
    const stairsOf = (d) => JSON.stringify(d.stairs.map((q) => q.bbox.map(Math.round)));
    // a. the design's flow: detect.stairs and the images (a floor where detect.js found no stair is searched by the
    // fallback finder in align.js)
    let t0 = Date.now();
    const r = A.alignLevelTo(U.L, R.L, { img: U.img, refImg: R.img, stairs: U.det.stairs, refStairs: R.det.stairs });
    const ms = Date.now() - t0;
    const e = err(r.offset, H.truth);
    check(`${key}: detect.stairs + bildene – trappa, innen ${cm(tol)} av håndmålingen`, r.method === 'stair' && e <= tol, `${r.method} (${r.detail.stair?.how ?? '–'}) ${f3(r.offset)}, fasit ${f3(H.truth)} ± ${cm(H.uncertainty)}: ${cm(e)}, score ${r.score}, ${ms} ms; detect.stairs 2. etg ${stairsOf(U.det)}, 1. etg ${stairsOf(R.det)}`);
    check(`${key}: under 6 s`, ms < 6000, `${ms} ms`);
    // the same left out: the levels' stairHints (model.js) are used, with the same answer
    const rh = A.alignLevelTo(U.L, R.L, { img: U.img, refImg: R.img });
    check(`${key}: uten stairs – etasjenes stairHints gir det samme`, err(rh.offset, r.offset) <= 0.002 && rh.method === r.method, `${rh.method} ${f3(rh.offset)}`);
    // a2. the fallback finder alone on both floors ([] with an image is searched)
    const rf = A.alignLevelTo(U.L, R.L, { img: U.img, refImg: R.img, stairs: [], refStairs: [] });
    const ef = err(rf.offset, H.truth);
    check(`${key}: bare trappefinneren + bildene – innen ${cm(tol)}`, rf.method === 'stair' && ef <= tol, `${rf.method} (${rf.detail.stair?.how ?? '–'}) ${f3(rf.offset)}: ${cm(ef)}, score ${rf.score}`);
    // b. the hand-measured stair boxes as detect.stairs, no images: paired boxes + the walls near the stair
    t0 = Date.now();
    const rb = A.alignLevelTo(U.L, R.L, { stairs: [{ bbox: H.level.stair }], refStairs: [{ bbox: H.ref.stair }] });
    const eb = err(rb.offset, H.truth);
    const boxOnly = [(H.ref.stair[0] + H.ref.stair[2]) / 2 / H.ref.ppm - (H.level.stair[0] + H.level.stair[2]) / 2 / H.level.ppm, (H.ref.stair[1] + H.ref.stair[3]) / 2 / H.ref.ppm - (H.level.stair[1] + H.level.stair[3]) / 2 / H.level.ppm];
    check(`${key}: detect.stairs-bokser uten bilder – innen ${cm(tol)}`, rb.method === 'stair' && eb <= tol, `${rb.detail.stair?.how} ${f3(rb.offset)}: ${cm(eb)} (boksenes sentre alene ${cm(err(boxOnly, H.truth))}), ${Date.now() - t0} ms`);
    // b2. the finder's boxes, true and false, without the images (the boxes alone cannot tell them apart): within the
    // tolerance, or no stair answer and a low score – never a confident answer metres off
    const honest = (q, eq) => eq <= tol || (q.method !== 'stair' && q.score < 0.3);
    const fL = A.findStairs(U.img, { pxPerM: H.level.ppm });
    const fR = A.findStairs(R.img, { pxPerM: H.ref.ppm });
    const rx = A.alignLevelTo(U.L, R.L, { stairs: fL, refStairs: fR });
    const ex = err(rx.offset, H.truth);
    check(`${key}: finnerens bokser (ekte og falske) uten bilder – innen ${cm(tol)} eller ærlig lav score`, honest(rx, ex), `${rx.method} (${rx.detail.stair?.how ?? '–'}) ${f3(rx.offset)}: ${cm(ex)}, score ${rx.score}; ${fL.length} + ${fR.length} bokser, ${rx.detail.stair?.candidates?.length ?? 0} par`);
    // b3. the hand-measured box among the finder's false ones
    const ry = A.alignLevelTo(U.L, R.L, { stairs: [{ bbox: H.level.stair }, ...fL], refStairs: [{ bbox: H.ref.stair }, ...fR] });
    const ey = err(ry.offset, H.truth);
    check(`${key}: håndmålt boks + finnerens bokser uten bilder – innen ${cm(tol)} eller ærlig lav score`, honest(ry, ey), `${ry.method} (${ry.detail.stair?.how ?? '–'}) ${f3(ry.offset)}: ${cm(ey)}, score ${ry.score}`);
    // c. the outline alone (no stairs, no images)
    const ro = A.alignLevelTo(U.L, R.L, { stairs: [], refStairs: [] });
    const eo = err(ro.offset, H.truth);
    const outlineOk = key !== 'hus4';
    if (outlineOk) check(`${key}: omrisset alene – innen ${cm(tol)}`, ro.method === 'outline' && eo <= tol, `${ro.method} ${f3(ro.offset)}: ${cm(eo)}, andel ${ro.detail.outline?.share}, andre topp ${ro.detail.outline?.second}`);
    else console.log(`  info ${key}: omrisset alene gir ${ro.method} ${f3(ro.offset)}: ${cm(eo)} (2. etasje har nesten ingen vegger i gjenkjenningen: ${U.L.walls.length} vegger)`);
    // the fallback finder on both drawings, against the hand-measured boxes
    const iou = (p, q) => {
      const ix = Math.max(0, Math.min(p[2], q[2]) - Math.max(p[0], q[0]));
      const iy = Math.max(0, Math.min(p[3], q[3]) - Math.max(p[1], q[1]));
      return (ix * iy) / ((p[2] - p[0]) * (p[3] - p[1]) + (q[2] - q[0]) * (q[3] - q[1]) - ix * iy);
    };
    for (const [name, P, img] of [['1', H.ref, R.img], ['2', H.level, U.img]]) {
      const st = A.findStairs(img, { pxPerM: P.ppm });
      const best = st.map((s) => ({ s, iou: iou(s.bbox, P.stair) })).sort((p, q) => q.iou - p.iou)[0];
      console.log(`  info ${key} ${name}. etg: trappefinneren ${st.length} funn, beste IoU mot håndmålt trapp ${best ? (best.iou * 100).toFixed(0) : 0} %${best ? ` (${best.s.bbox.join(', ')}, ${best.s.kind})` : ''}, ${st.length - (best?.iou > 0.3 ? 1 : 0)} andre`);
    }
    if (verbose) console.log(JSON.stringify(r.detail, null, 1));
    summary.push(`${key}: trapp ${cm(e)} (bare finneren ${cm(ef)}), håndbokser ${cm(eb)}, finnerbokser ${cm(ex)} (${rx.method}), omriss ${cm(eo)} (${ro.method}), ${ms} ms`);
  }

  // a big sheet (hus6, 3309 × 2340 px, five boxes found, four of them false) on a copy of itself: the drawing search is
  // coarse to fine, the boxes per floor capped, both line caches cold
  if (!only || only.includes('stort')) {
    const big = readPng(path.join(ROOT, 'plantegninger/_png/hus6/plan-1etg-tilbygg.png'));
    const copy = { width: big.width, height: big.height, data: big.data.slice() };
    const ppm = 78.8;
    const t0 = Date.now();
    const r = A.alignLevelTo(lvl([], ppm), lvl([], ppm), { img: copy, refImg: big });
    const ms = Date.now() - t0;
    check('stort ark (hus6) på seg selv med bildene: 0 cm, under 6 s', r.method === 'stair' && err(r.offset, [0, 0]) <= 0.005 && ms < 6000, `${r.method} ${f3(r.offset)}, ${ms} ms (før: 9,0 s)`);
    check('stort ark: notatet sier at boksene er kappet', (r.detail.stair?.notes ?? []).some((n) => /searched the first/.test(n)), JSON.stringify(r.detail.stair?.notes));
    summary.push(`stort ark hus6: ${ms} ms`);
  }
  console.log('\n  ' + summary.join('\n  '));
}

done();
