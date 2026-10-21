/**
 * Planbygger: tests for src/planbygger/sheet.js (several drawings on one sheet) – plain Node, no browser.
 *
 *   node tools/test-planbygger-sheet.mjs
 *
 * 1. cropImage: exact pixels, padding, clamping.
 * 2. Synthetic sheets: an empty page, two plans side by side, gable facades with and without cladding (a missing
 *    cladding signal must not make a section), flat facades without cladding (a wall face is not a room), strips of
 *    five gables, and a section with cut walls (grey fill between the wall lines) beside a facade.
 * 3. hus7 (Oslo kommune: plan, section and four facades on one scanned sheet): every drawing and every note found
 *    with the right kind and box; also resampled to 3000, 2400, 2000 and 1600 px, 2000 px under 1 s.
 * 4. hus8 (FINN): three plans on one sheet, and the same plans one or two to a sheet; also resampled 0.75× and 1.5×.
 * 5. Facade sheets (hus2, hus3: four in a row) and the single facades of hus1, hus4 and hus5, also resampled.
 * 6. Every single-plan file gives exactly one plan block, with its terrace, dimensions and compass, also resampled.
 *
 * Resampling is what a browser, a PDF renderer or a phone does to a sheet: area average down, bilinear up. Thin light
 * lines come and go with it, so every file is run at more than its own size.
 * The expected boxes for hus7 and hus8 are the ones in plantegninger/<hus>/fasit.json (measured by hand).
 */
import path from 'node:path';
import { ROOT, imp, check, section, done } from './planbygger-lib.mjs';
import { readPng } from './planbygger-png.mjs';

const S = await imp('src/planbygger/sheet.js');
const P = (rel) => path.join(ROOT, 'plantegninger', rel);

const iou = (a, b) => {
  const ix = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0]));
  const iy = Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
  const i = ix * iy;
  return i / ((a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - i);
};
const DRAWING = new Set(['plan', 'facade', 'section']);
const count = (blocks, kind) => blocks.filter((b) => b.kind === kind).length;
const kinds = (blocks) => blocks.map((b) => b.kind).join(', ');
const drawingKinds = (blocks) => blocks.filter((b) => DRAWING.has(b.kind)).map((b) => b.kind).join(', ');
const fmt = (b) => `[${b.map((v) => Math.round(v)).join(', ')}]`;
/** The block that overlaps box best: { block, iou }. */
function bestMatch(blocks, box, pred = () => true) {
  let best = { block: null, iou: 0 };
  for (const b of blocks) {
    if (!pred(b)) continue;
    const v = iou(b.bbox, box);
    if (v > best.iou) best = { block: b, iou: v };
  }
  return best;
}
/** Area-averaged downscale to a given width (what a browser or a PDF renderer at a lower resolution gives). */
function boxDown(img, width) {
  const s = img.width / width;
  const height = Math.round(img.height / s);
  const out = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    const y0 = Math.floor(y * s);
    const y1 = Math.min(img.height, Math.max(y0 + 1, Math.floor((y + 1) * s)));
    for (let x = 0; x < width; x++) {
      const x0 = Math.floor(x * s);
      const x1 = Math.min(img.width, Math.max(x0 + 1, Math.floor((x + 1) * s)));
      const acc = [0, 0, 0, 0];
      for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) for (let c = 0; c < 4; c++) acc[c] += img.data[(yy * img.width + xx) * 4 + c];
      const n = (y1 - y0) * (x1 - x0);
      for (let c = 0; c < 4; c++) out[(y * width + x) * 4 + c] = acc[c] / n;
    }
  }
  return { width, height, data: out };
}
/** Bilinear upscale to a given width (a browser enlarging a small image). */
function bilinearUp(img, width) {
  const s = img.width / width;
  const height = Math.round(img.height / s);
  const out = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    const fy = Math.min(img.height - 1, Math.max(0, (y + 0.5) * s - 0.5));
    const ya = Math.floor(fy);
    const yb = Math.min(img.height - 1, ya + 1);
    const ty = fy - ya;
    for (let x = 0; x < width; x++) {
      const fx = Math.min(img.width - 1, Math.max(0, (x + 0.5) * s - 0.5));
      const xa = Math.floor(fx);
      const xb = Math.min(img.width - 1, xa + 1);
      const tx = fx - xa;
      for (let c = 0; c < 4; c++) {
        const p = (yy, xx) => img.data[(yy * img.width + xx) * 4 + c];
        out[(y * width + x) * 4 + c] = (p(ya, xa) * (1 - tx) + p(ya, xb) * tx) * (1 - ty) + (p(yb, xa) * (1 - tx) + p(yb, xb) * tx) * ty;
      }
    }
  }
  return { width, height, data: out };
}
/** The sheet resampled by factor k (1: the image itself). */
const resample = (img, k) => (k === 1 ? img : k < 1 ? boxDown(img, Math.round(img.width * k)) : bilinearUp(img, Math.round(img.width * k)));
const timed = (img) => {
  const t0 = performance.now();
  const res = S.splitSheet(img);
  return { ...res, ms: performance.now() - t0 };
};
/** Share of the image's ink (darker than the paper − 30) inside a box. */
function inkInside(img, box) {
  const grey = new Uint8Array(img.width * img.height);
  const hist = new Uint32Array(256);
  for (let i = 0; i < grey.length; i++) {
    const a = img.data[i * 4 + 3] / 255;
    const l = 0.299 * img.data[i * 4] + 0.587 * img.data[i * 4 + 1] + 0.114 * img.data[i * 4 + 2];
    grey[i] = Math.round(l * a + 255 * (1 - a));
    hist[grey[i]]++;
  }
  const t = S.paperLevel(hist) - 30;
  let all = 0;
  let inside = 0;
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      if (grey[y * img.width + x] >= t) continue;
      all++;
      if (x >= box[0] && x < box[2] && y >= box[1] && y < box[3]) inside++;
    }
  }
  return inside / Math.max(1, all);
}

// ———————————————————————————————————————————————————————————————————————————————————————————————————————————
// Synthetic drawings (grey levels 0–255 on white)
function sheet(W, H) {
  const img = { width: W, height: H, data: new Uint8ClampedArray(W * H * 4).fill(255) };
  const px = (x, y, g) => {
    x = Math.round(x);
    y = Math.round(y);
    if (x >= 0 && y >= 0 && x < W && y < H) img.data.set([g, g, g, 255], (y * W + x) * 4);
  };
  const rect = (x0, y0, x1, y1, g = 0) => {
    for (let y = Math.round(y0); y < Math.round(y1); y++) for (let x = Math.round(x0); x < Math.round(x1); x++) px(x, y, g);
  };
  const line = (x0, y0, x1, y1, t = 2, g = 0) => {
    const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0));
    for (let i = 0; i <= n; i++) {
      const x = x0 + ((x1 - x0) * i) / n;
      const y = y0 + ((y1 - y0) * i) / n;
      for (let a = 0; a < t; a++) for (let b = 0; b < t; b++) px(x + a, y + b, g);
    }
  };
  const box = (x0, y0, x1, y1, t = 2, g = 0) => {
    line(x0, y0, x1, y0, t, g);
    line(x0, y1, x1, y1, t, g);
    line(x0, y0, x0, y1, t, g);
    line(x1, y0, x1, y1, t, g);
  };
  return { img, rect, line, box };
}
/** A gable facade: walls, eave line, pitched roof with eaves, two windows, a door, a ground line sticking out. */
function gable(s, ox, oy, w, wallH, roofH, { clad = 0, cladG = 160, ground = 30 } = {}) {
  const gy = oy + roofH + wallH;
  // vertical cladding every clad px up to the roof edge
  if (clad) for (let x = ox + clad; x < ox + w; x += clad) s.line(x, oy + roofH * (Math.abs(x - ox - w / 2) / (w / 2)) + 4, x, gy - 2, 1, cladG);
  s.line(ox, oy + roofH, ox, gy);
  s.line(ox + w, oy + roofH, ox + w, gy);
  s.line(ox, oy + roofH, ox + w, oy + roofH);
  s.line(ox - 15, oy + roofH + 10, ox + w / 2, oy);
  s.line(ox + w / 2, oy, ox + w + 15, oy + roofH + 10);
  s.line(ox - ground, gy, ox + w + ground, gy, 3);
  s.box(ox + 0.15 * w, oy + roofH + 0.3 * wallH, ox + 0.35 * w, oy + roofH + 0.65 * wallH);
  s.box(ox + 0.6 * w, oy + roofH + 0.3 * wallH, ox + 0.8 * w, oy + roofH + 0.65 * wallH);
  s.box(ox + 0.42 * w, oy + roofH + 0.35 * wallH, ox + 0.55 * w, gy);
}
/** A flat-roof facade without cladding: the wall face, two windows, a door, a ground line sticking out. */
function flatFacade(s, ox, oy, w, h, ground) {
  s.box(ox, oy, ox + w, oy + h);
  s.line(ox - ground, oy + h, ox + w + ground, oy + h, 3);
  s.box(ox + 0.1 * w, oy + 0.3 * h, ox + 0.3 * w, oy + 0.6 * h);
  s.box(ox + 0.6 * w, oy + 0.3 * h, ox + 0.85 * w, oy + 0.6 * h);
  s.box(ox + 0.4 * w, oy + 0.35 * h, ox + 0.52 * w, oy + h);
}
/** A section through a gable building: cut walls and slab as grey fill between dark lines, a roof band, a ceiling line, an empty attic. */
function cutSection(s, ox, oy, w, wallH, roofH, { furniture = true } = {}) {
  const gy = oy + roofH + wallH;
  const t = 14;
  for (const x of [ox, ox + w - t]) {
    s.rect(x, oy + roofH, x + t, gy + t, 215);
    s.box(x, oy + roofH, x + t, gy + t);
  }
  s.rect(ox + t, gy, ox + w - t, gy + t, 215);
  s.box(ox + t, gy, ox + w - t, gy + t);
  for (const d of [0, 16]) {
    s.line(ox - 30, oy + roofH + 12 + d, ox + w / 2, oy + d);
    s.line(ox + w / 2, oy + d, ox + w + 30, oy + roofH + 12 + d);
  }
  s.line(ox, oy + roofH + 12, ox + w, oy + roofH + 12);
  s.line(ox - 60, gy, ox, gy);
  s.line(ox + w, gy, ox + w + 60, gy);
  if (furniture) {
    s.box(ox + 0.2 * w, gy - 0.4 * wallH, ox + 0.45 * w, gy - 2);
    s.box(ox + 0.55 * w, gy - 0.4 * wallH, ox + 0.8 * w, gy - 2);
  }
}

// ———————————————————————————————————————————————————————————————————————————————————————————————————————————
section('1. cropImage');
{
  const w = 10;
  const h = 8;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data.set([x * 10, y * 10, x + y, 255], (y * w + x) * 4);
  const img = { width: w, height: h, data };
  const c = S.cropImage(img, [2, 3, 6, 7]);
  const px = (im, x, y) => Array.from(im.data.subarray((y * im.width + x) * 4, (y * im.width + x) * 4 + 4));
  check('4 × 4 utsnitt', c.width === 4 && c.height === 4, `${c.width}×${c.height}`);
  check('øvre venstre piksel er (2, 3)', px(c, 0, 0).join() === [20, 30, 5, 255].join(), px(c, 0, 0).join());
  check('nedre høyre piksel er (5, 6)', px(c, 3, 3).join() === [50, 60, 11, 255].join(), px(c, 3, 3).join());
  const p = S.cropImage(img, [2, 3, 6, 7], 1);
  check('pad 1 gir 6 × 6 fra (1, 2)', p.width === 6 && p.height === 6 && px(p, 0, 0).join() === [10, 20, 3, 255].join());
  const e = S.cropImage(img, [-5, -5, 3, 3], 2);
  check('klemmes mot bildekanten', e.width === 5 && e.height === 5 && px(e, 0, 0).join() === [0, 0, 0, 255].join(), `${e.width}×${e.height}`);
  const o = S.cropImage(img, [20, 20, 30, 30]);
  check('utenfor bildet gir et tomt bilde', o.width === 0 && o.height === 0 && o.data.length === 0);
  const copy = S.cropImage(img, [0, 0, w, h]);
  copy.data[0] = 7;
  check('utsnittet er en kopi', img.data[0] === 0);
}

// ———————————————————————————————————————————————————————————————————————————————————————————————————————————
section('2. Syntetiske ark');
{
  const blank = { width: 800, height: 600, data: new Uint8ClampedArray(800 * 600 * 4).fill(255) };
  check('tomt ark gir ingen blokker', S.splitSheet(blank).blocks.length === 0);
  // two small plans (outer walls 8 px, an inner wall, a door gap) far apart on a 1200 × 600 sheet
  const s = sheet(1200, 600);
  for (const ox of [80, 700]) {
    s.rect(ox, 100, ox + 400, 108);
    s.rect(ox, 492, ox + 400, 500);
    s.rect(ox, 100, ox + 8, 500);
    s.rect(ox + 392, 100, ox + 400, 500);
    s.rect(ox + 200, 100, ox + 205, 260);
    s.rect(ox + 200, 340, ox + 205, 500);
  }
  const { blocks } = S.splitSheet(s.img);
  check('to planer side om side gir to planblokker', blocks.length === 2 && count(blocks, 'plan') === 2, kinds(blocks));
  check('venstre plan først (leserekkefølge)', blocks[0].bbox[0] < blocks[1].bbox[0]);
  check('boksene sitter på veggene', blocks.length === 2 && iou(blocks[0].bbox, [80, 100, 480, 500]) > 0.97 && iou(blocks[1].bbox, [700, 100, 1100, 500]) > 0.97, blocks.map((b) => fmt(b.bbox)).join(' '));
  const shape = blocks.every((b) => Object.keys(b).sort().join() === 'bbox,kind,score' && b.bbox.every(Number.isInteger) && b.score >= 0 && b.score <= 1);
  check('blokkene har bare bbox, kind og score', shape);
}
{
  // [name, draw, expected drawing kinds in reading order]
  const CASES = [
    ['gavlfasade uten kledning', () => { const s = sheet(900, 600); gable(s, 250, 100, 400, 220, 140); return s.img; }, 'facade'],
    ['gavlfasade uten kledning og uten bakkelinje utenfor', () => { const s = sheet(900, 600); gable(s, 250, 100, 400, 220, 140, { ground: 0 }); return s.img; }, 'facade'],
    ...[[8, 200], [8, 160], [6, 120], [5, 60]].map(([clad, g]) => [`gavlfasade med kledning hver ${clad}. px, grå ${g}`, () => { const s = sheet(900, 600); gable(s, 250, 100, 400, 220, 140, { clad, cladG: g }); return s.img; }, 'facade']),
    ['flat fasade uten kledning, bakkelinje 40 px utenfor', () => { const s = sheet(900, 600); flatFacade(s, 200, 150, 500, 250, 40); return s.img; }, 'facade'],
    ['flat fasade uten kledning, bakkelinje 20 px utenfor', () => { const s = sheet(900, 600); flatFacade(s, 200, 150, 500, 250, 20); return s.img; }, 'facade'],
    ['fem gavler på en stripe, med kledning', () => { const s = sheet(2400, 300); for (let i = 0; i < 5; i++) gable(s, 60 + i * 470, 40, 300, 130, 90, { clad: 8, cladG: 200 }); return s.img; }, 'facade, facade, facade, facade, facade'],
    ['fem gavler på en stripe, uten kledning', () => { const s = sheet(2400, 300); for (let i = 0; i < 5; i++) gable(s, 60 + i * 470, 40, 300, 130, 90); return s.img; }, 'facade, facade, facade, facade, facade'],
    ['snitt med skårne vegger (grå fyll) og biler', () => { const s = sheet(1000, 650); cutSection(s, 250, 100, 500, 240, 160); return s.img; }, 'section'],
    ['snitt med skårne vegger, tomt', () => { const s = sheet(1000, 650); cutSection(s, 250, 100, 500, 240, 160, { furniture: false }); return s.img; }, 'section'],
    ['snitt og fasade side om side', () => { const s = sheet(2000, 650); cutSection(s, 250, 100, 500, 240, 160); gable(s, 1250, 100, 500, 240, 160, { clad: 8, cladG: 180 }); return s.img; }, 'section, facade'],
  ];
  for (const [name, draw, want] of CASES) {
    const img = draw();
    const got = [0.75, 1, 1.5].map((k) => drawingKinds(S.splitSheet(resample(img, k)).blocks));
    check(`${name}: ${want} (0,75×, 1×, 1,5×)`, got.every((g) => g === want), got.join(' | '));
  }
}

// ———————————————————————————————————————————————————————————————————————————————————————————————————————————
section('3. hus7: plan, snitt og fire fasader på ett ark');
// fasit.json: plantegninger/hus7 (4771 × 3332 px)
const HUS7 = [
  ['plan', 'PLAN', [505, 2385, 1261, 3199]],
  ['section', 'SNITT', [1460, 2480, 2716, 3152]],
  ['facade', 'VEST', [103, 87, 2452, 1148]],
  ['facade', 'SØR', [2852, 126, 4770, 1108]],
  ['facade', 'ØST', [8, 1209, 2329, 2292]],
  ['facade', 'NORD', [2328, 1319, 4665, 2289]],
];
const HUS7_TEXT = [
  ['tittelfeltet', [3364, 2849, 4567, 3197]],
  ['E 1.4', [4378, 70, 4542, 123]],
  ['forklaringen om fasadene', [467, 22, 1532, 191]],
  ['forklaringen om plan, snitt og fasade', [468, 1241, 1449, 1407]],
  ['forklaringen om tittelfeltet', [2738, 2478, 3806, 2650]],
  ['forklaringen om plan og snitt', [2183, 3204, 3252, 3313]],
];
const hus7 = readPng(P('_png/hus7/garasje-plan-snitt-fasade.png'));
function checkHus7(res, k, label, minIou) {
  const { blocks } = res;
  const n = (kind) => count(blocks, kind);
  check(`${label}: 4 fasader, 1 snitt, 1 plan`, n('facade') === 4 && n('section') === 1 && n('plan') === 1, kinds(blocks));
  for (const [kind, title, box] of HUS7) {
    const b = box.map((v) => v * k);
    const m = bestMatch(blocks, b);
    check(`${label}: ${title} er ${kind}`, m.block && m.block.kind === kind && m.iou >= minIou, m.block ? `${m.block.kind}, IoU ${m.iou.toFixed(3)}, ${fmt(m.block.bbox)} mot ${fmt(b)}` : 'ingen blokk');
  }
  return blocks;
}
{
  const res = timed(hus7);
  const blocks = checkHus7(res, 1, '4771 px', 0.9);
  for (const [title, box] of HUS7_TEXT) {
    const m = bestMatch(blocks, box);
    check(`${title} er tekst for seg`, m.block && !DRAWING.has(m.block.kind) && m.iou >= 0.8, m.block ? `${m.block.kind}, IoU ${m.iou.toFixed(3)}` : 'ingen blokk');
  }
  check('ingen andre tegninger', blocks.filter((b) => DRAWING.has(b.kind)).length === 6, kinds(blocks));
  check('16 MP-skanningen på under 2,5 s', res.ms < 2500, `${res.ms.toFixed(0)} ms`);
  const plan = blocks.find((b) => b.kind === 'plan');
  const crop = S.cropImage(hus7, plan.bbox, 10);
  check('cropImage på planen', crop.width === plan.bbox[2] - plan.bbox[0] + 20 && crop.height === plan.bbox[3] - plan.bbox[1] + 20, `${crop.width}×${crop.height}`);
}
for (const width of [3000, 2400, 2000, 1600]) {
  const img = boxDown(hus7, width);
  const res = timed(img);
  const blocks = checkHus7(res, width / hus7.width, `${width} px`, 0.8);
  check(`${width} px: ingen andre tegninger`, blocks.filter((b) => DRAWING.has(b.kind)).length === 6, kinds(blocks));
  if (width === 2000) check('2000 px på under 1 s', res.ms < 1000, `${res.ms.toFixed(0)} ms`);
}

// ———————————————————————————————————————————————————————————————————————————————————————————————————————————
section('4. hus8: tre planer på ett ark, og hver for seg');
// fasit.json: plantegninger/hus8 (1131 × 1600 px)
const KJELLER = [428, 226, 702, 749];
const ETG1 = [81, 838, 567, 1370];
const GARASJE = [869, 1016, 1050, 1282];
const hus8 = [1, 2, 3].map((i) => readPng(P(`_png/hus8/plantegning-${i}.png`)));
{
  const { blocks } = timed(hus8[0]);
  check('plantegning-1: tre planer', count(blocks, 'plan') === 3 && count(blocks, 'facade') + count(blocks, 'section') === 0, kinds(blocks));
  for (const [name, box] of [['kjelleren', KJELLER], ['1. etasje med terrassen', ETG1], ['garasjen med døra', GARASJE]]) {
    const m = bestMatch(blocks, box, (b) => b.kind === 'plan');
    check(`plantegning-1: ${name}`, m.iou >= 0.95, m.block ? `IoU ${m.iou.toFixed(3)}, ${fmt(m.block.bbox)}` : 'ingen');
  }
  const north = bestMatch(blocks, [994, 71, 1048, 124]);
  check('nordpila langt unna er «other» for seg', north.block && north.block.kind === 'other' && north.iou > 0.8, north.block ? `${north.block.kind} ${north.iou.toFixed(2)}` : '');
  const disc = bestMatch(blocks, [83, 1508, 1047, 1557]);
  check('meglerens forbehold er tekst', disc.block && disc.block.kind === 'text' && disc.iou > 0.9, disc.block ? `${disc.block.kind} ${disc.iou.toFixed(2)}` : '');
}
{
  const { blocks } = timed(hus8[1]);
  const plans = blocks.filter((b) => b.kind === 'plan');
  check('plantegning-2: én plan', plans.length === 1 && count(blocks, 'facade') === 0, kinds(blocks));
  check('plantegning-2: kjelleren', plans.length === 1 && iou(plans[0].bbox, [428, 537, 702, 1059]) >= 0.95, plans[0] && fmt(plans[0].bbox));
}
{
  const { blocks } = timed(hus8[2]);
  const plans = blocks.filter((b) => b.kind === 'plan');
  check('plantegning-3: to planer (huset og garasjen)', plans.length === 2 && count(blocks, 'facade') === 0, kinds(blocks));
  check('plantegning-3: huset til venstre, garasjen til høyre', plans.length === 2 && iou(plans[0].bbox, [81, 532, 567, 1064]) >= 0.95 && iou(plans[1].bbox, [869, 710, 1050, 976]) >= 0.95, plans.map((b) => fmt(b.bbox)).join(' '));
}
for (const k of [0.75, 1.5]) {
  const want = [[KJELLER, ETG1, GARASJE], [[428, 537, 702, 1059]], [[81, 532, 567, 1064], [869, 710, 1050, 976]]];
  for (let i = 0; i < 3; i++) {
    const img = resample(hus8[i], k);
    const kk = img.width / hus8[i].width;
    const { blocks } = S.splitSheet(img);
    const ious = want[i].map((box) => bestMatch(blocks, box.map((v) => v * kk), (b) => b.kind === 'plan').iou);
    const ok = count(blocks, 'plan') === want[i].length && blocks.filter((b) => DRAWING.has(b.kind)).length === want[i].length && Math.min(...ious) >= 0.9;
    check(`plantegning-${i + 1} ${k}×: ${want[i].length} planer på plass`, ok, `${kinds(blocks)}; IoU ${ious.map((v) => v.toFixed(2)).join(', ')}`);
  }
}

// ———————————————————————————————————————————————————————————————————————————————————————————————————————————
section('5. Fasader');
for (const rel of ['hus3/fasader.png', 'hus2/fasader.png']) {
  const img = readPng(P(rel));
  const { blocks } = timed(img);
  const f = blocks.filter((b) => b.kind === 'facade');
  check(`${rel}: fire fasader`, f.length === 4 && blocks.filter((b) => DRAWING.has(b.kind)).length === 4, kinds(blocks));
  const apart = (list) => list.every((b, i) => i === 0 || b.bbox[0] >= list[i - 1].bbox[2]);
  check(`${rel}: i rekkefølge fra venstre, uten overlapp`, apart(f), f.map((b) => fmt(b.bbox)).join(' '));
  // resampled: the same four boxes, scaled, with all the ink (a light ground line or cladding must not get lost)
  for (const k of [0.5, 0.75, 1.5, 2]) {
    const im = resample(img, k);
    const kk = im.width / img.width;
    const r = S.splitSheet(im).blocks;
    const g = r.filter((b) => b.kind === 'facade');
    const ious = g.length === 4 ? g.map((b, i) => iou(b.bbox, f[i].bbox.map((v) => v * kk))) : [0];
    const ink = g.reduce((a, b) => a + inkInside(im, b.bbox), 0);
    const ok = g.length === 4 && r.filter((b) => DRAWING.has(b.kind)).length === 4 && apart(g) && Math.min(...ious) >= 0.85 && ink >= 0.97;
    check(`${rel} ${k}×: fire fasader med samme bokser`, ok, `${drawingKinds(r)}; IoU ≥ ${Math.min(...ious).toFixed(2)}, blekk ${(ink * 100).toFixed(1)} %`);
  }
}
for (const rel of ['_png/hus1/fasade1.png', '_png/hus1/fasade2.png', '_png/hus1/fasade3.png', '_png/hus1/fasade4.png', '_png/hus4/fasade1.png', '_png/hus4/fasade2.png', '_png/hus4/fasade3.png', '_png/hus4/fasade4.png', '_png/hus5/fasade1.png', '_png/hus5/fasade2.png', '_png/hus5/fasade3.png', '_png/hus5/fasade4.png']) {
  const img = readPng(P(rel));
  const got = [1, 0.75, 1.5].map((k) => drawingKinds(S.splitSheet(resample(img, k)).blocks));
  check(`${rel}: én fasade (1×, 0,75×, 1,5×)`, got.every((g) => g === 'facade'), got.join(' | '));
}

// ———————————————————————————————————————————————————————————————————————————————————————————————————————————
section('6. Én plan per fil');
// [file, extra test on the plan box at scale k, what it checks, extra scales]
const SINGLE = [
  ['hus1/1etg.png'],
  ['hus1/2etg.png'],
  ['hus2/1etg.png', (b, k) => b[2] >= 890 * k, 'terrassen og parasollen til høyre er med'],
  ['hus3/1etg.png', (b, k) => b[0] <= 90 * k, 'terrassen til venstre er med'],
  ['hus3/2etg.png'],
  ['_png/hus4/1etg.png', (b, k) => b[2] >= 1830 * k, 'carporten og sportsboden er med'],
  ['_png/hus5/1etg.png'],
  ['_png/hus9/ovre-etasje.png', (b, k) => b[2] >= 650 * k, 'kompasset til høyre er med', [0.5, 2]],
  ['_png/hus9/underetasje.png'],
  ['_png/hus9/underetasje-alternativ.png'],
  [path.join('..', 'plantegning.png'), (b, k) => b[2] >= 545 * k && b[3] >= 760 * k, 'målekjedene til høyre og under er med'],
];
for (const [rel, extra, what, more = []] of SINGLE) {
  const img0 = readPng(P(rel));
  const name = rel.replace(/^\.\.[\\/]/, '');
  for (const k of [1, 0.75, 1.5, ...more]) {
    const img = resample(img0, k);
    const kk = img.width / img0.width;
    const tag = k === 1 ? name : `${name} ${k}×`;
    const { blocks, ms } = timed(img);
    const plans = blocks.filter((b) => b.kind === 'plan');
    check(`${tag}: nøyaktig én plan`, plans.length === 1 && blocks.filter((b) => DRAWING.has(b.kind)).length === 1, `${kinds(blocks)} (${ms.toFixed(0)} ms)`);
    if (plans.length !== 1) continue;
    const share = inkInside(img, plans[0].bbox);
    check(`${tag}: planblokken har ${(share * 100).toFixed(1)} % av blekket`, share >= 0.97, fmt(plans[0].bbox));
    if (extra) check(`${tag}: ${what}`, extra(plans[0].bbox, kk), fmt(plans[0].bbox));
  }
}

done();
