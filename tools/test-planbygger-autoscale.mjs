/**
 * Tests for src/planbygger/autoscale.js – the scale in layers (notes/planbygger-runde1-design.md). Plain Node, no
 * browser, no AI key:
 *
 *   node tools/test-planbygger-autoscale.mjs
 *
 * The AI answers are hand-made readPlan answers in tools/fixtures/planbygger-autoscale/<hus>-<fil>.readPlan.json, in
 * the exact shape of the readPlan task (server/planbygger-ai/prompts.mjs): the texts as read from the drawings by
 * hand, their positions normalised to the image. No room marks were drawn when they were read, so – as the prompt
 * says for that case – rooms is empty and every room label is in labels; autoscale ties them to the detected rooms by
 * point in polygon. Where recorded AI answers exist (tools/fixtures/planbygger-ai/), they are run too.
 *
 * The flow per plan is the design's (generate step 5): standardScale → detectPlan + findRooms at that ppm0 →
 * estimateScale. The truth per plan, and where it comes from (measured by hand on grey-value profiles across the
 * walls, independent of the detection; plantegninger/<hus>/fasit.json says the same):
 *   hus1 1etg  97.4   inner rectangles: SOV 348 × 403 px = 14.8 m² → 97.34; KJØKKEN 348 × 462 = 16.9 → 97.54;
 *                     BOD 348 × 119 = 4.4 → 97.0 (area-weighted 97.39)
 *   hus1 2etg  94.0   NOT the scale of 1etg: the loft is drawn at 0.965 of it in an image of the same height. Outer
 *                     outline 1113 × 831 px against 1etg's 1154 × 861 (0.9645 / 0.9652), the stair 202 px against 210;
 *                     the fasit's areas inside the knee walls give 93.7–94.2. Inheriting 97.4 makes the loft 3.6 % small
 *   hus2       55.65  outer faces: «15.44» = 859 px (55.63), «7.35» = 409 px (55.65), «7.78» = 434 px (55.78)
 *   hus3 1etg  47.88  outer faces 294 × 717 px for 6.15 × 14.95 m (47.80 / 47.96)
 *   hus3 2etg  47.82  outer faces 294 × 715 px for the same 6.15 × 14.95 m (47.80 / 47.83)
 *   hus4 1etg  120.5  the fasit's inner rectangles: Bad 120.0, Sov 7,5 120.7, Vask. 120.8–122.3, Carport 120.5,
 *                     Sportsbod 119.3 (no dimensions or scale printed; grey walls with thin dark outlines)
 *   hus5       46.8   inner rectangles: SOV 11.9 148 × 177 px → 46.92; BAD 7.7 148 × 114 → 46.81; SPORTSBOD 5.0
 *                     100 × 109 → 46.69; GARD/BOD 3.0 45 × 145 → 46.64 (area-weighted 46.82)
 *   hus6       78.8   1:100 on A3 at 200 dpi = 78.79; «9815» between its extension lines 772.5 px → 78.71
 *   hus7       117.4  the fasit: 5700 = 669–670 px, 5500 = 645–646 px, the level ruler 1 m = 117.4 px. The sheet is
 *                     300 dpi (4771 px / 1145.04 pt), so 1:100 on the page gives 118.11 (+0.6 %: the drawing is not
 *                     exactly 1:100 on its page)
 *   hus8       –      nothing printed («Plantegningen er ikke målbar»): no truth, only plausibility (~34 by the doors)
 *   plantegning 51.43 the dimension line «12.21 m» is 628 px (notes/planbygger.md)
 */
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, imp, check, section, done } from './planbygger-lib.mjs';
import { readPng } from './planbygger-png.mjs';

const A = await imp('src/planbygger/autoscale.js');
const { detectPlan } = await imp('src/planbygger/detect.js');
const { suggestScale } = await imp('src/planbygger/scale.js');
const M = await imp('src/planbygger/model.js');
const R = await imp('src/planbygger/regions.js');
const AI = await imp('src/planbygger/ai.js');

const FIX = path.join(ROOT, 'tools/fixtures/planbygger-autoscale');
const readFixture = (key) => JSON.parse(fs.readFileSync(path.join(FIX, `${key}.readPlan.json`), 'utf8'));
const pct = (v, t) => ((v / t - 1) * 100).toFixed(2);
const err = (v, t) => Math.abs(v / t - 1);
const cand = (r, method) => r.candidates.find((c) => c.method === method) ?? null;
const readRecorded = (rel) => {
  const f = path.join(ROOT, 'tools/fixtures/planbygger-ai', rel);
  if (!fs.existsSync(f)) return null;
  const rec = JSON.parse(fs.readFileSync(f, 'utf8'));
  return AI.tidyResponse('readPlan', rec.response, rec.marks);
};

/** The PDF page size from the file itself (the /MediaBox of its page; plain-text PDF objects). */
function pdfMediaBox(file) {
  const text = fs.readFileSync(file).toString('latin1');
  const m = text.match(/\/MediaBox\s*\[\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s*\]/);
  if (!m) return null;
  const [x0, y0, x1, y1] = m.slice(1).map(Number);
  return { widthPt: x1 - x0, heightPt: y1 - y0 };
}

/** A crop of an RGBA image (what sheet.js cropImage gives, without the padding). */
function crop(img, x, y, w, h) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let j = 0; j < h; j++) data.set(img.data.subarray(((y + j) * img.width + x) * 4, ((y + j) * img.width + x + w) * 4), j * w * 4);
  return { width: w, height: h, data };
}

const HOUSES = {
  'hus1-1etg': { file: 'plantegninger/hus1/1etg.png', truth: 97.4 },
  'hus1-2etg': { file: 'plantegninger/hus1/2etg.png', truth: 94.0 },
  'hus2-1etg': { file: 'plantegninger/hus2/1etg.png', truth: 55.65 },
  'hus3-1etg': { file: 'plantegninger/hus3/1etg.png', truth: 47.88 },
  'hus3-2etg': { file: 'plantegninger/hus3/2etg.png', truth: 47.82 },
  'hus4-1etg': { file: 'plantegninger/_png/hus4/1etg.png', truth: 120.5, fixture: false },
  'hus5-1etg': { file: 'plantegninger/_png/hus5/1etg.png', truth: 46.8 },
  'hus6-plan-1etg-tilbygg': { file: 'plantegninger/_png/hus6/plan-1etg-tilbygg.png', truth: 78.8, pdf: 'plantegninger/hus6/plan-1etg-tilbygg.pdf' },
  'hus7-plan-crop': { file: 'plantegninger/_png/hus7/garasje-plan-snitt-fasade.png', truth: 117.4, crop: [400, 2350, 1000, 950], pdf: 'plantegninger/hus7/garasje-plan-snitt-fasade.pdf' },
  'hus8-plantegning-3': { file: 'plantegninger/_png/hus8/plantegning-3.png', truth: null },
  'hus8-plantegning-2': { file: 'plantegninger/_png/hus8/plantegning-2.png', truth: null, fixture: false },
  plantegning: { file: 'plantegning.png', truth: 51.43 },
};

/** standardScale → detection + rooms at ppm0 (cached per plan; the variants reuse them). */
const prepared = new Map();
function prepare(key, ppm0Factor = 1) {
  const id = `${key}@${ppm0Factor}`;
  if (prepared.has(id)) return prepared.get(id);
  const h = HOUSES[key];
  const base = ppm0Factor === 1 ? null : prepare(key);
  let img = base?.img;
  if (!img) {
    img = readPng(path.join(ROOT, h.file));
    if (h.crop) img = crop(img, ...h.crop);
  }
  const t0 = Date.now();
  const std = base?.std ?? A.standardScale(img);
  const tStd = base?.tStd ?? Date.now() - t0;
  const ppm0 = std.pxPerM * ppm0Factor;
  const det0 = detectPlan(img, { pxPerM: ppm0 });
  const level = M.applyDetection({}, det0, ppm0);
  const rooms0 = R.findRooms(level.walls);
  const p = { img, std, tStd, ppm0, det0, rooms0 };
  prepared.set(id, p);
  return p;
}
const run = (key, extra = {}, ai = readFixture(key)) => {
  const p = prepare(key);
  return A.estimateScale({ img: p.img, det0: p.det0, rooms0: p.rooms0, ppm0: p.ppm0, ai, ...extra });
};
const table = [];
const row = (house, r, truth, note = '') => {
  table.push({ house, method: r.method, ppm: r.pxPerM, truth, conf: r.confidence, note });
  return r;
};

// ---------------------------------------------------------------------------------------------------------------
section('Tekst: målestokk, mål og loft');
check('«Målestokk: 1:100» → 100', A.parseScaleText('Målestokk: 1:100') === 100);
check('«M 1 : 50» → 50', A.parseScaleText('M 1 : 50') === 50);
check('«12.21 m» er ingen målestokk', A.parseScaleText('12.21 m') === null);
check('«9815» (mm) → 9,815 m', Math.abs(A.dimensionMetres(9815, '9815') - 9.815) < 1e-9);
check('«12.21 m» → 12,21 m', A.dimensionMetres(12.21, '12.21 m') === 12.21);
check('«735 cm» → 7,35 m', Math.abs(A.dimensionMetres(735, '735 cm') - 7.35) < 1e-9);
check('«9815» som 9,815 (KI-en regnet om selv) → 9,815 m', Math.abs(A.dimensionMetres(9.815, '9815') - 9.815) < 1e-9);
check('takvinduer → loft', A.isLoft(readFixture('hus1-2etg')) && !A.isLoft(readFixture('hus1-1etg')));
check('«SKRÅ HIMLING» alene er ikke loft (hus2 har én etasje)', !A.isLoft(readFixture('hus2-1etg')));

// ---------------------------------------------------------------------------------------------------------------
section('PDF-sidene (hus6, hus7)');
const page6 = pdfMediaBox(path.join(ROOT, HOUSES['hus6-plan-1etg-tilbygg'].pdf));
check('hus6: MediaBox lest fra PDF-en', page6 && Math.abs(page6.widthPt - 1985.4) < 0.01 && Math.abs(page6.heightPt - 1404) < 0.01, page6 ? `${page6.widthPt} × ${page6.heightPt} pt = ${((page6.widthPt * 25.4) / 72).toFixed(1)} × ${((page6.heightPt * 25.4) / 72).toFixed(1)} mm` : 'ingen');
HOUSES['hus6-plan-1etg-tilbygg'].pdfPage = page6;
const page7 = pdfMediaBox(path.join(ROOT, HOUSES['hus7-plan-crop'].pdf));
check('hus7: MediaBox lest fra PDF-en', page7 && Math.abs(page7.widthPt - 1145.04) < 0.01 && Math.abs(page7.heightPt - 799.68) < 0.01, page7 ? `${page7.widthPt} × ${page7.heightPt} pt = ${((page7.widthPt * 25.4) / 72).toFixed(1)} × ${((page7.heightPt * 25.4) / 72).toFixed(1)} mm` : 'ingen');

// ---------------------------------------------------------------------------------------------------------------
section('Veggtykkelser og samme kilde');
{
  const m1 = A.wallModes(readPng(path.join(ROOT, HOUSES['hus1-1etg'].file)));
  const walls = m1.filter((m) => m.px >= 3);
  check('hus1 1etg: innervegg og yttervegg funnet som tykkelser', walls.length >= 2 && Math.abs(walls[0].px - 11) < 1.5 && walls.some((m) => Math.abs(m.px - 20.5) < 1.5), walls.map((m) => `${m.px.toFixed(1)} px (${(m.share * 100).toFixed(0)} %)`).join(', '));
  const img = (k) => readPng(path.join(ROOT, HOUSES[k].file));
  const m4 = A.wallModes(img('hus4-1etg')).filter((m) => m.px >= 3);
  check('hus4 1etg (grå vegger med tynne svarte konturer): veggtykkelser fra det grå båndet', m4.some((m) => m.px >= 8), m4.map((m) => `${m.px.toFixed(1)} px (${(m.share * 100).toFixed(0)} %)`).join(', ') || 'ingen');
  check('hus1 1etg og 2etg er samme kilde', A.similarSource(img('hus1-1etg'), img('hus1-2etg')));
  check('hus3 1etg og 2etg er ikke samme bildestørrelse', !A.similarSource(img('hus3-1etg'), img('hus3-2etg')));
  check('hus8 kjeller og 1. etasje er samme kilde', A.similarSource(img('hus8-plantegning-3'), img('hus8-plantegning-2')));
  check('hus1 og hus2 er ikke samme kilde', !A.similarSource(img('hus1-1etg'), img('hus2-1etg')));
}

// ---------------------------------------------------------------------------------------------------------------
section('Standardmål: foreløpig skala uten KI (dører 0,93 m, tynneste vegg 0,12 m)');
{
  const old = suggestScale(prepare('hus1-1etg').img);
  for (const [key, h] of Object.entries(HOUSES)) {
    const p = prepare(key);
    const s = p.std;
    const detail = `${s.pxPerM.toFixed(2)} px/m fra ${s.from}${s.n ? ` (${s.n} dører)` : ''}${h.truth ? `, ${pct(s.pxPerM, h.truth)} %` : ''}, ${p.tStd} ms`;
    if (key.startsWith('hus8')) {
      // nothing printed: the house is 280 px wide; 25–40 px/m makes it 7–11 m
      check(`${key}: standard gir et rimelig hus (25–40 px/m)`, s.pxPerM > 25 && s.pxPerM < 40 && s.from === 'dører', detail);
    } else if (key === 'hus6-plan-1etg-tilbygg') {
      check(`${key}: ingen dører funnet (vegger som konturlinjer) – bare vegger, lav sikkerhet`, s.confidence === 'low', detail);
    } else if (key === 'hus7-plan-crop') {
      // a garage: no doors with arcs, walls as double thin lines – no standard size to go by
      check(`${key}: en skala, lav sikkerhet (ingen dører med bue)`, s.pxPerM > 0 && s.confidence === 'low', detail);
    } else if (key === 'hus1-2etg' || key === 'hus3-2etg') {
      check(`${key}: standard innen 20 %`, err(s.pxPerM, h.truth) < 0.2, detail);
    } else {
      check(`${key}: standard innen 5 %`, err(s.pxPerM, h.truth) < 0.05, detail);
    }
  }
  const s1 = prepare('hus1-1etg').std;
  check('hus1 1etg: bedre enn suggestScale (31 px/m i dag)', err(s1.pxPerM, 97.4) < 0.05 && old && err(old.pxPerM, 97.4) > err(s1.pxPerM, 97.4), `suggestScale ${old?.pxPerM.toFixed(1)}, standardScale ${s1.pxPerM.toFixed(1)}`);
  // hus4's loft: the grey band has only a 6 px mode (5 cm at the truth), the detection there finds no doors – still a
  // scale (it used to be null), honestly low
  const img42 = readPng(path.join(ROOT, 'plantegninger/_png/hus4/2etg.png'));
  const t0 = Date.now();
  const s42 = A.standardScale(img42);
  check('hus4 2etg: standardScale gir en skala (ikke null), lav sikkerhet', s42 && s42.pxPerM > 0 && s42.confidence === 'low', s42 ? `${s42.pxPerM.toFixed(2)} px/m fra ${s42.from}, ${pct(s42.pxPerM, 120.5)} % mot ~120,5, ${Date.now() - t0} ms` : 'null');
  check('hus6 (7,7 MP, ingen dører): standardScale under 6 s (oppskaleringen hoppes over)', prepare('hus6-plan-1etg-tilbygg').tStd < 6000, `${prepare('hus6-plan-1etg-tilbygg').tStd} ms (9,6 s før)`);
}

// ---------------------------------------------------------------------------------------------------------------
section('Arealer: hus1 1. etasje');
const r11 = row('hus1 1etg', run('hus1-1etg'), 97.4);
{
  const a = cand(r11, 'areas');
  check('arealene vinner', r11.method === 'areas', a?.detail);
  check('innen 2 %', err(r11.pxPerM, 97.4) < 0.02, `${r11.pxPerM.toFixed(2)} px/m, ${pct(r11.pxPerM, 97.4)} %`);
  check('høy sikkerhet', r11.confidence === 'high', `${r11.confidence}, n ${r11.n}, spredning ${(r11.spread * 100).toFixed(1)} %`);
  // when the detector merges hall and store into one polygon the two labels are summed (it does not any more)
  const merged = a?.detail.includes('+');
  check('to etiketter i ett rom summeres (eller rommene er skilt)', a && (merged ? /HALL\/TRAPP\+BOD|BOD\+HALL\/TRAPP/.test(a.detail) : r11.n >= 5), merged ? 'hall + bod i ett rom' : `${r11.n} rom hver for seg`);
  check('resultatet har omrisset (for samme kilde)', r11.outline && r11.outline.w > 1100 && r11.outline.h > 800, r11.outline ? `${r11.outline.w.toFixed(1)} × ${r11.outline.h.toFixed(1)} px` : 'ingen');
}
{
  // two labels in one polygon (a wall the detector missed): summed. A synthetic plan at 50 px/m, 1000 × 1000 px: a
  // 5 × 4 m polygon holding HALL 12 m² and BOD 8 m², a 3 × 3 m one holding SOV 9 m², and a label outside every room
  const rooms0 = {
    rooms: [
      { polygon: [[2, 2], [7, 2], [7, 6], [2, 6]], area: 20 },
      { polygon: [[8, 2], [11, 2], [11, 5], [8, 5]], area: 9 },
    ],
  };
  const lab = (text, area, x, y) => ({ text, area, kind: 'other', at: [(x * 50) / 1000, (y * 50) / 1000] });
  const ai = { ...readFixture('hus8-plantegning-3'), labels: [lab('HALL', 12, 3, 3), lab('BOD', 8, 6, 5), lab('SOV', 9, 9.5, 3.5), lab('TERRASSE', 15, 14, 14)] };
  const img = { width: 1000, height: 1000, data: null };
  const r = A.estimateScale({ img, det0: { walls: [], openings: [] }, rooms0, ppm0: 50, ai });
  check('to etiketter i ett rom summeres (HALL + BOD = 20 m²)', r.method === 'areas' && Math.abs(r.pxPerM - 50) < 1e-9 && /HALL\+BOD 20/.test(cand(r, 'areas').detail), `${r.pxPerM} – ${cand(r, 'areas').detail}`);
  const ai2 = { ...ai, labels: [lab('HALL', 10, 3, 3), lab('BOD', 8, 6, 5)] };
  const r2 = A.estimateScale({ img, det0: { walls: [], openings: [] }, rooms0, ppm0: 50, ai: ai2 });
  check('og målestokken følger summen: 50 · √(20 / 18)', Math.abs(r2.pxPerM - 50 * Math.sqrt(20 / 18)) < 1e-9, r2.pxPerM.toFixed(3));
  const ai3 = { ...ai, labels: [lab('Brutto tilbygg', 25, 4, 4), lab('SOV', 9, 9.5, 3.5)] };
  const r3 = A.estimateScale({ img, det0: { walls: [], openings: [] }, rooms0, ppm0: 50, ai: ai3 });
  check('«Brutto …» er ikke et romareal', cand(r3, 'areas') && !/Brutto/.test(cand(r3, 'areas').detail), cand(r3, 'areas')?.detail);
}

// ---------------------------------------------------------------------------------------------------------------
section('Loft: hus1 2. etasje (tegnet i 0,965 av 1. etasjes målestokk)');
const T12 = HOUSES['hus1-2etg'].truth;
{
  const alone = run('hus1-2etg');
  const a = cand(alone, 'areas');
  check('loftets arealer gir for stor skala (etikettene er mindre enn gulvet)', a && a.pxPerM > T12 * 1.05, a ? `${a.pxPerM.toFixed(2)} px/m, ${pct(a.pxPerM, T12)} %` : 'ingen');
  check('alene: loftets arealer vinner ikke over dørene', alone.method !== 'areas' && alone.confidence === 'low', `${alone.method} ${alone.pxPerM.toFixed(2)} (${pct(alone.pxPerM, T12)} %), ${alone.confidence}`);
  row('hus1 2etg (alene)', alone, T12, 'uten samme kilde');
  check('1. etasjes skala uendret ville vært over 3 % for stor', err(r11.pxPerM, T12) > 0.03, `${r11.pxPerM.toFixed(2)} = ${pct(r11.pxPerM, T12)} %`);
  const r = row('hus1 2etg', run('hus1-2etg', { sameSource: [r11] }), T12, 'arver fra 1etg, skalert med omrisset');
  const s = cand(r, 'sameSource');
  check('samme kilde fra 1. etasje vinner', r.method === 'sameSource', s?.detail);
  const k = r.pxPerM / r11.pxPerM;
  check('skalert med omrisset: × 0,960–0,970', k > 0.96 && k < 0.97 && /annen målestokk/.test(s?.detail ?? ''), `× ${k.toFixed(4)}`);
  check('innen 2 %', err(r.pxPerM, T12) < 0.02, `${r.pxPerM.toFixed(2)} px/m, ${pct(r.pxPerM, T12)} %`);
  check('middels sikkerhet (omskalert arv, ikke høy)', r.confidence === 'medium', r.confidence);
}

// ---------------------------------------------------------------------------------------------------------------
section('Ytre mål: hus2');
{
  const r = row('hus2 1etg', run('hus2-1etg'), 55.65);
  check('målene vinner', r.method === 'dimensions', cand(r, 'dimensions')?.detail);
  check('innen 2 %', err(r.pxPerM, 55.65) < 0.02, `${r.pxPerM.toFixed(2)} px/m, ${pct(r.pxPerM, 55.65)} %`);
  check('minst 6 av 9 mål stemmer', r.n >= 6, `${r.n}`);
  check('høy sikkerhet (arealene stemmer)', r.confidence === 'high', r.confidence);
  const ai = readFixture('hus2-1etg');
  const onlyDims = run('hus2-1etg', {}, { ...ai, labels: [] });
  check('bare målene: innen 2 %, høy sikkerhet', onlyDims.method === 'dimensions' && err(onlyDims.pxPerM, 55.65) < 0.02 && onlyDims.confidence === 'high', `${onlyDims.pxPerM.toFixed(2)}, ${pct(onlyDims.pxPerM, 55.65)} %, ${onlyDims.confidence}`);
  const onlyAreas = row('hus2 1etg (bare arealer)', run('hus2-1etg', {}, { ...ai, dimensions: [] }), 55.65);
  check('bare arealene: innen 2 %', onlyAreas.method === 'areas' && err(onlyAreas.pxPerM, 55.65) < 0.02, `${onlyAreas.pxPerM.toFixed(2)}, ${pct(onlyAreas.pxPerM, 55.65)} %`);
  const one = run('hus2-1etg', {}, { ...ai, labels: [], dimensions: ai.dimensions.filter((d) => d.text === '15.44') });
  check('bare «15.44» (husets ytre utstrekning): innen 2 %, ikke høy sikkerhet', err(one.pxPerM, 55.65) < 0.02 && one.confidence !== 'high', `${one.method} ${one.pxPerM.toFixed(2)}, ${pct(one.pxPerM, 55.65)} %, ${one.confidence} – ${cand(one, 'dimensions')?.detail}`);
}

// ---------------------------------------------------------------------------------------------------------------
section('Ytre mål 6,15 × 14,95: hus3');
let r31;
{
  r31 = row('hus3 1etg', run('hus3-1etg'), 47.88);
  check('1etg: målene vinner', r31.method === 'dimensions', cand(r31, 'dimensions')?.detail);
  check('1etg: innen 2 %', err(r31.pxPerM, 47.88) < 0.02, `${r31.pxPerM.toFixed(2)} px/m, ${pct(r31.pxPerM, 47.88)} %`);
  check('1etg: begge målene stemmer, høy sikkerhet', r31.n === 2 && r31.confidence === 'high', `n ${r31.n}, ${r31.confidence}`);
  const r = row('hus3 2etg', run('hus3-2etg'), 47.82, 'ingen mål på tegningen');
  check('2etg (ingen mål trykt): arealene, innen 2 %', r.method === 'areas' && err(r.pxPerM, 47.82) < 0.02, `${r.pxPerM.toFixed(2)} px/m, ${pct(r.pxPerM, 47.82)} %`);
  const rs = run('hus3-2etg', { sameSource: [r31] });
  check('2etg med 1etg som samme kilde: innen 2 %, høy sikkerhet', err(rs.pxPerM, 47.82) < 0.02 && rs.confidence === 'high', `${rs.method} ${rs.pxPerM.toFixed(2)}, ${rs.confidence}`);
  const s = cand(rs, 'sameSource');
  check('2etg: samme omriss som 1etg (294 × 717 mot 295 × 716 px) – arvet uendret', s && s.pxPerM === r31.pxPerM && /samme omriss/.test(s.detail), s?.detail);
}
{
  // a provisional scale 20 % too low breaks the walls of hus3: autoScale detects again at the estimate
  const p = prepare('hus3-1etg');
  const a = A.autoScale(p.img, { ai: readFixture('hus3-1etg'), ppm0: p.std.pxPerM * 0.8 });
  check('autoScale: foreløpig skala 20 % for lav → riktig etter ny gjenkjenning', a && err(a.result.pxPerM, 47.88) < 0.02 && a.passes >= 2, a ? `${a.passes} runder, ${a.result.method} ${a.result.pxPerM.toFixed(2)} (${pct(a.result.pxPerM, 47.88)} %)` : 'ingen');
}

// ---------------------------------------------------------------------------------------------------------------
section('Samme kilde med et annet omriss: hus8 kjeller under 1. etasje med garasje');
{
  const r1 = run('hus8-plantegning-3', { bra: 140 });
  const p = prepare('hus8-plantegning-2');
  const r = A.estimateScale({ img: p.img, det0: p.det0, rooms0: p.rooms0, ppm0: p.ppm0, ai: null, sameSource: [r1] });
  const s = cand(r, 'sameSource');
  check('omrisset er et annet (garasjen er med i 1. etasje): arvet uendret, ett hakk mindre sikker', s && s.pxPerM === r1.pxPerM && /annet omriss/.test(s.detail) && r1.confidence === 'medium' && s.weight === 0.25, s ? `${s.pxPerM.toFixed(2)} (${s.weight}) – ${s.detail}` : 'ingen');
  row('hus8 kjeller (arv)', r, null, 'ingen fasit');
}

// ---------------------------------------------------------------------------------------------------------------
section('Arealer med skråhimling: hus5');
{
  const r = row('hus5 1etg', run('hus5-1etg'), 46.8);
  check('arealene vinner', r.method === 'areas', cand(r, 'areas')?.detail);
  check('innen 2 %', err(r.pxPerM, 46.8) < 0.02, `${r.pxPerM.toFixed(2)} px/m, ${pct(r.pxPerM, 46.8)} %`);
  check('høy sikkerhet', r.confidence === 'high', r.confidence);
}

// ---------------------------------------------------------------------------------------------------------------
section('Målestokk og papir: hus6 (1:100, skannet PDF)');
{
  const pdfPage = HOUSES['hus6-plan-1etg-tilbygg'].pdfPage;
  const r = row('hus6', run('hus6-plan-1etg-tilbygg', { pdfPage }), 78.8);
  check('innen 2 %', err(r.pxPerM, 78.8) < 0.02, `${r.method} ${r.pxPerM.toFixed(2)} px/m, ${pct(r.pxPerM, 78.8)} %`);
  const paper = cand(r, 'paper');
  check('papirlaget: 1:100 på A3 (200 dpi), innen 2 %', paper && err(paper.pxPerM, 78.8) < 0.02 && /A3/.test(paper.detail), paper ? `${paper.pxPerM.toFixed(2)} – ${paper.detail}` : 'ingen');
  const direct = r.candidates.find((c) => c.method === 'paper' && /PDF-siden/.test(c.detail));
  check('PDF-sidens egen størrelse (700 × 495 mm, ingen standard) er med, men tapte', direct && /ingen standardstørrelse/.test(direct.detail) && err(direct.pxPerM, 78.8) > 0.3, direct ? `${direct.pxPerM.toFixed(2)} – ${direct.detail}` : 'ingen');
  check('papir og mål er enige: høy sikkerhet', r.confidence === 'high', `${r.confidence} – ${cand(r, 'dimensions')?.detail}`);
  const ai = readFixture('hus6-plan-1etg-tilbygg');
  const onlyPaper = row('hus6 (bare målestokk)', run('hus6-plan-1etg-tilbygg', { pdfPage }, { ...ai, labels: [], dimensions: [] }), 78.8);
  check('bare «1:100» + PDF-siden: papiret vinner, innen 2 %', onlyPaper.method === 'paper' && err(onlyPaper.pxPerM, 78.8) < 0.02, `${onlyPaper.pxPerM.toFixed(2)}, ${pct(onlyPaper.pxPerM, 78.8)} %, ${onlyPaper.confidence} – ${cand(onlyPaper, 'paper')?.detail}`);
  check('bare målestokk: middels sikkerhet (arkstørrelsen er gjettet)', onlyPaper.confidence === 'medium', onlyPaper.confidence);
  const noPdf = run('hus6-plan-1etg-tilbygg', {}, { ...ai, labels: [], dimensions: [] });
  check('bare «1:100», uten PDF (et PNG-ark med A-format): innen 2 %', noPdf.method === 'paper' && err(noPdf.pxPerM, 78.8) < 0.02, `${noPdf.pxPerM.toFixed(2)}, ${noPdf.confidence}`);
}

// ---------------------------------------------------------------------------------------------------------------
section('Papir på et utsnitt av arket: hus7 (planen skåret ut av et 300 dpi-ark, 1:100)');
{
  // what generate does after sheet.js: the plan cropped out of the page. The scale text stands in the sheet's title
  // block (the classify answer), outside the crop; the fixture carries it
  const ai = readFixture('hus7-plan-crop');
  const onlyScale = { ...ai, labels: [], dimensions: [] };
  const withPx = { ...page7, widthPx: 4771, heightPx: 3332 };
  const r = row('hus7 utsnitt (bare målestokk)', run('hus7-plan-crop', { pdfPage: withPx }, onlyScale), 117.4, 'sidens px oppgitt');
  check('med sidens størrelse i px: papiret vinner, 300 dpi, innen 2 %', r.method === 'paper' && Math.abs(r.pxPerM - 118.11) < 0.1 && err(r.pxPerM, 117.4) < 0.02, `${r.pxPerM.toFixed(2)} (${pct(r.pxPerM, 117.4)} %), ${r.confidence} – ${cand(r, 'paper')?.detail}`);
  check('den løse standardskalaen (80 % feil på utsnittet) overstyrer ikke PDF-siden', err(prepare('hus7-plan-crop').ppm0, 117.4) > 0.5, `foreløpig ${prepare('hus7-plan-crop').ppm0.toFixed(1)} px/m`);
  const bare = run('hus7-plan-crop', { pdfPage: page7 }, onlyScale);
  check('bare { widthPt, heightPt } på et utsnitt: papirlaget tier i stedet for å gjette fra utsnittets bredde', !cand(bare, 'paper') && bare.method !== 'paper', `${bare.method} ${bare.pxPerM.toFixed(2)}, ${bare.confidence}`);
  const full = row('hus7 utsnitt', run('hus7-plan-crop', { pdfPage: withPx }), 117.4, 'mål, areal og målestokk');
  check('med mål og areal i tillegg: innen 2 %', err(full.pxPerM, 117.4) < 0.02, `${full.method} ${full.pxPerM.toFixed(2)} (${pct(full.pxPerM, 117.4)} %), ${full.confidence}`);
  // the whole sheet as the page (no crop): the image width is the page width, and a loose prior far off does not veto it
  const sheet = { width: 4771, height: 3332, data: null };
  const s = A.estimateScale({ img: sheet, det0: { walls: [], openings: [] }, rooms0: { rooms: [] }, ppm0: 25, ai: onlyScale, pdfPage: page7 });
  check('hele arket (bildet er siden): 118,11 px/m, også med en foreløpig skala på 25', s.method === 'paper' && Math.abs(s.pxPerM - 118.11) < 0.1, `${s.pxPerM.toFixed(2)} – ${cand(s, 'paper')?.detail}`);
}

// ---------------------------------------------------------------------------------------------------------------
section('Ingenting trykt: hus8 (standardmål, så BRA)');
{
  const p = prepare('hus8-plantegning-3');
  const r = row('hus8 1etg', run('hus8-plantegning-3'), null, 'ingen fasit');
  check('standardmål, lav sikkerhet', r.method === 'standard' && r.confidence === 'low', `${r.pxPerM.toFixed(2)} px/m – ${cand(r, 'standard')?.detail}`);
  const inner = A.innerArea(p.det0, p.rooms0, p.ppm0);
  check('innvendig fotavtrykk uten garasjen', inner > 100 && inner < 170, `${inner?.toFixed(1)} m² ved ${p.ppm0.toFixed(2)} px/m`);
  // assumed: BRA 140 m² for the 1st floor (a 1960s detached house; not checked against the listing)
  const BRA = 140;
  const rb = row('hus8 1etg + BRA 140', run('hus8-plantegning-3', { bra: BRA }), null, 'BRA antatt');
  const expect = p.ppm0 * Math.sqrt(inner / BRA);
  check('BRA vinner over standardmål, middels sikkerhet', rb.method === 'bra' && rb.confidence === 'medium', `${rb.pxPerM.toFixed(2)} px/m, ${pct(rb.pxPerM, r.pxPerM)} % fra dørene`);
  check('BRA-skalaen = ppm0 · √(fotavtrykk / BRA)', Math.abs(rb.pxPerM / expect - 1) < 1e-6, `${expect.toFixed(3)}`);
  const rb2 = run('hus8-plantegning-3', { bra: BRA * 1.5 });
  check('en BRA som er 50 % for stor: dørene er uenige, lavere sikkerhet', rb2.confidence === 'low', `${rb2.method} ${rb2.pxPerM.toFixed(2)}, ${rb2.confidence}`);
}

// ---------------------------------------------------------------------------------------------------------------
section('Målelinjer: eierens plantegning.png (12,21 m = 628 px)');
{
  const r = row('plantegning', run('plantegning'), 51.43);
  check('målene vinner', r.method === 'dimensions', cand(r, 'dimensions')?.detail);
  check('innen 2 %', err(r.pxPerM, 51.43) < 0.02, `${r.pxPerM.toFixed(2)} px/m, ${pct(r.pxPerM, 51.43)} %`);
  check('høy sikkerhet', r.confidence === 'high', r.confidence);
  const ai = readFixture('plantegning');
  const one = run('plantegning', {}, { ...ai, dimensions: ai.dimensions.filter((d) => d.text === '12.21 m') });
  check('bare «12.21 m»: innen 1 %, middels sikkerhet', one.method === 'dimensions' && err(one.pxPerM, 51.43) < 0.01 && one.confidence === 'medium', `${one.pxPerM.toFixed(2)} px/m, ${pct(one.pxPerM, 51.43)} %, ${one.confidence} – ${cand(one, 'dimensions')?.detail}`);
}

// ---------------------------------------------------------------------------------------------------------------
section('Mål mot tilfeldighet: feilleste tall (1–15 m) ved de ekte etikettene, uten arealer');
{
  // the reviewer's case: misread or invented values must not agree «confidently» – a dimension with many candidate
  // lengths agrees with almost anything. 12 seeded draws per plan
  let seed = 20261021;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (const key of ['hus2-1etg', 'hus3-1etg', 'hus6-plan-1etg-tilbygg', 'plantegning']) {
    const base = { ...readFixture(key), labels: [], rooms: [], scaleText: null };
    const real = run(key, {}, base);
    const out = [];
    for (let t = 0; t < 12; t++) {
      const ai = { ...base, dimensions: base.dimensions.map((d) => ({ ...d, value: Math.round((1 + 14 * rnd()) * 100) / 100, text: '' })) };
      const r = run(key, {}, ai);
      out.push(r);
    }
    const high = out.filter((r) => r.confidence === 'high').length;
    const med = out.filter((r) => r.confidence === 'medium').length;
    check(`${key}: ingen av 12 tilfeldige får høy sikkerhet (de ekte: ${real.confidence})`, high === 0 && real.confidence === 'high', `${high} høy, ${med} middels: ${out.map((r) => `${r.pxPerM.toFixed(0)}/${r.confidence[0]}`).join(' ')}; ekte ${real.pxPerM.toFixed(2)} n ${real.n}`);
  }
}

// ---------------------------------------------------------------------------------------------------------------
section('Uten KI');
{
  const r = run('hus1-1etg', {}, null);
  check('ai = null: standardmål, lav sikkerhet', r.method === 'standard' && r.confidence === 'low' && err(r.pxPerM, 97.4) < 0.05, `${r.pxPerM.toFixed(2)} px/m`);
  const p = prepare('hus1-1etg');
  const e = A.estimateScale({ img: p.img, det0: { walls: [], openings: [] }, rooms0: { rooms: [] }, ppm0: 80, ai: null });
  check('ingenting gjenkjent: den foreløpige skalaen, lav sikkerhet', e.pxPerM === 80 && e.confidence === 'low', `${e.method}`);
}

// ---------------------------------------------------------------------------------------------------------------
section('Foreløpig skala 20 % feil: gjenkjenning og rom ved ppm0 · 0,8 og · 1,25');
for (const key of ['hus1-1etg', 'hus2-1etg', 'hus5-1etg', 'plantegning']) {
  const truth = HOUSES[key].truth;
  for (const f of [0.8, 1.25]) {
    const p = prepare(key, f);
    const r = A.estimateScale({ img: p.img, det0: p.det0, rooms0: p.rooms0, ppm0: p.ppm0, ai: readFixture(key) });
    check(`${key}, ppm0 · ${f}: innen 2 %`, err(r.pxPerM, truth) < 0.02, `ppm0 ${p.ppm0.toFixed(1)} → ${r.method} ${r.pxPerM.toFixed(2)} (${pct(r.pxPerM, truth)} %), ${r.confidence}`);
  }
}

// ---------------------------------------------------------------------------------------------------------------
section('autoScale: gjenbruker gjenkjenningen fra standardScale');
{
  // a counting detector: autoScale's first pass must not run the detection standardScale just ran
  const p = prepare('hus2-1etg');
  let calls = 0;
  const counting = (img, o) => {
    calls++;
    return detectPlan(img, o);
  };
  A.standardScale(p.img, { detect: counting });
  const nStd = calls;
  calls = 0;
  const a = A.autoScale(p.img, { ai: readFixture('hus2-1etg'), detect: counting });
  check('hus2: autoScale kjører gjenkjenningen én gang mindre enn standardScale + runder', a && calls === nStd + a.passes - 1, `standardScale ${nStd}, autoScale ${calls} med ${a?.passes} runder → ${a?.result.method} ${a?.result.pxPerM.toFixed(2)}`);
  const s = A.standardScale(p.img);
  check('gjenkjenningen ligger ikke i resultatets data (JSON)', s.det && !('det' in JSON.parse(JSON.stringify(s))), Object.keys(s).join(', '));
}

// ---------------------------------------------------------------------------------------------------------------
section('hus4: grå vegger med tynne konturer (opptatte KI-svar, autoScale fra bunnen)');
{
  const img = prepare('hus4-1etg').img;
  for (const m of ['haiku', 'sonnet']) {
    const rel = `hus4/1etg.readPlan.claude-${m}-5-5.json`;
    const ai = readRecorded(rel);
    if (!ai) {
      console.log(`  (${rel} mangler)`);
      continue;
    }
    const t0 = Date.now();
    const a = A.autoScale(img, { ai });
    const r = a?.result;
    if (r) row(`hus4 1etg (${m})`, r, 120.5, 'autoScale');
    // the detection splits / merges rooms with the unlabelled hall: the areas come out ~5 % high. Not within 2 % – the
    // honest part is that it is not called sure while the doors disagree
    check(`${rel}: en skala (ikke null), og ikke høy sikkerhet når den bommer med over 2 %`, r && r.pxPerM > 0 && (err(r.pxPerM, 120.5) < 0.02 || r.confidence !== 'high'), r ? `${r.method} ${r.pxPerM.toFixed(2)} (${pct(r.pxPerM, 120.5)} %), ${r.confidence}, ${a.passes} runder, ${Date.now() - t0} ms – ${cand(r, r.method)?.detail}` : 'null');
  }
}

// ---------------------------------------------------------------------------------------------------------------
section('Opptatte KI-svar (tools/fixtures/planbygger-ai)');
{
  const recorded = [
    ['hus1-1etg', 'hus1/1etg.readPlan.claude-haiku-5-5.json', 97.4],
    ['hus1-1etg', 'hus1/1etg.readPlan.claude-sonnet-5-5.json', 97.4],
    ['hus3-1etg', 'hus3/1etg.readPlan.claude-haiku-5-5.json', 47.88],
    ['hus3-1etg', 'hus3/1etg.readPlan.claude-sonnet-5-5.json', 47.88],
  ];
  let any = false;
  for (const [key, rel, truth] of recorded) {
    const ai = readRecorded(rel);
    if (!ai) continue;
    any = true;
    const r = run(key, {}, ai);
    check(`${rel}: innen 2 %`, err(r.pxPerM, truth) < 0.02, `${r.method} ${r.pxPerM.toFixed(2)} (${pct(r.pxPerM, truth)} %), ${r.confidence}`);
  }
  if (!any) console.log('  (ingen opptak funnet)');
}

// ---------------------------------------------------------------------------------------------------------------
section('Tabell');
console.log('  hus                           metode      px/m    fasit   avvik    sikkerhet');
for (const t of table) {
  const e = t.truth ? `${pct(t.ppm, t.truth).padStart(6)} %` : '     –  ';
  console.log(`  ${t.house.padEnd(29)} ${t.method.padEnd(10)} ${t.ppm.toFixed(2).padStart(7)} ${t.truth ? t.truth.toFixed(2).padStart(7) : '      –'} ${e}  ${t.conf}${t.note ? ` (${t.note})` : ''}`);
}

done();
