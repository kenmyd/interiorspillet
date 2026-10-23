/**
 * Tests for src/planbygger/facade.js (readFacade): synthetic facades with exact answers, then the real facades of the
 * test set (plantegninger/, see plantegninger/README.md) against plantegninger/<hus>/fasit.json.
 *
 *   node tools/test-planbygger-facade.mjs            the checks and a table per facade
 *   node tools/test-planbygger-facade.mjs --quiet    the checks only
 *
 * hus2 and hus3 have their four facades on one sheet; they are cut out with the fixed boxes below (measured on the
 * sheets, ink plus 10 px), since sheet.js is not used here; hus7 (an architect's sheet) with the boxes in its fasit.
 * The same drawings are then read tilted (rotateImage) and at other resolutions, against the straight original. The AI
 * answer is null except in the section that replays the recorded answers (tools/fixtures/planbygger-ai/hus4/).
 *
 * The limits are the measured quality when the checks were written, with a small margin: they catch a regression.
 */
import { ROOT, imp, readJson, check, section, done } from './planbygger-lib.mjs';
import { readPng } from './planbygger-png.mjs';
import path from 'node:path';

const F = await imp('src/planbygger/facade.js');
const quiet = process.argv.includes('--quiet');
const log = (...a) => !quiet && console.log(...a);
const round2 = (v) => Math.round(v * 100) / 100;
// tilted and resampled drawings: the measured deviation in the opening counts, with a margin (see the sections)
const TILT_OPEN_MAX = 10; // measured 8
const RES_OPEN_MAX = 9; // measured 7 (the originals: 6)

// ——— a tiny painter for synthetic facades ———
function canvas(w, h) {
  return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4).fill(255) };
}
function fill(img, x0, y0, x1, y1, g) {
  for (let y = Math.max(0, y0); y <= Math.min(img.height - 1, y1); y++) {
    for (let x = Math.max(0, x0); x <= Math.min(img.width - 1, x1); x++) {
      const i = (y * img.width + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = g;
    }
  }
}
function frame(img, x0, y0, x1, y1, t, g) {
  fill(img, x0, y0, x1, y0 + t - 1, g);
  fill(img, x0, y1 - t + 1, x1, y1, g);
  fill(img, x0, y0, x0 + t - 1, y1, g);
  fill(img, x1 - t + 1, y0, x1, y1, g);
}
function seg(img, a, b, t, g) {
  const n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]));
  for (let i = 0; i <= n; i++) {
    const x = Math.round(a[0] + ((b[0] - a[0]) * i) / n);
    const y = Math.round(a[1] + ((b[1] - a[1]) * i) / n);
    fill(img, x - (t >> 1), y - (t >> 1), x + (t >> 1), y + (t >> 1), g);
  }
}
/** Vertical cladding lines every `step` px in the box, skipping the holes. */
function cladding(img, x0, y0, x1, y1, step, g, holes) {
  for (let x = x0 + step; x < x1; x += step) {
    for (let y = y0; y <= y1; y++) {
      if (holes.some(([a, b, c, d]) => x >= a && x <= c && y >= b && y <= d)) continue;
      fill(img, x, y, x, y, g);
    }
  }
}
const near = (a, b, tol) => a != null && b != null && Math.abs(a - b) <= tol;

// ——— 1. a gable end at 100 px/m: a door (2.1 m) and a window (sill 0.9, height 1.2) ———
section('syntetisk gavl: dør, vindu, saltak');
{
  const img = canvas(1000, 620);
  fill(img, 40, 500, 960, 501, 0); // ground line
  const door = [300, 290, 389, 499];
  const win = [500, 290, 619, 409];
  cladding(img, 200, 230, 800, 499, 15, 170, [door, win]);
  frame(img, 200, 230, 800, 499, 3, 0); // the wall
  // the gable roof edge, meeting the wall corners and overhanging by 20 px
  for (const [p, q] of [[[180, 240], [500, 80]], [[500, 80], [820, 240]]]) seg(img, p, q, 4, 0);
  fill(img, door[0], door[1], door[2], door[3], 255);
  frame(img, ...door, 5, 20);
  fill(img, win[0], win[1], win[2], win[3], 255);
  frame(img, ...win, 5, 20);
  fill(img, win[0] + 5, win[1] + 5, win[2] - 5, win[3] - 5, 222); // glass
  fill(img, 557, 295, 562, 404, 20); // a glazing bar
  const r = F.readFacade(img, { ai: null });
  check('bakkelinja', r.groundY === 500, `groundY ${r.groundY}`);
  check('mønet', near(r.ridgeY, 79, 3), `ridgeY ${r.ridgeY}`);
  check('takfoten (veggens topp)', near(r.eaveY, 230, 6), `eaveY ${r.eaveY}`);
  check('takform saltak', r.roof === 'gable', r.roof);
  check('skala fra døra', r.method === 'door' && near(r.pxPerM, 100, 2), `${r.pxPerM} px/m (${r.method})`);
  const d = r.windows.find((o) => o.kind === 'door');
  const wi = r.windows.find((o) => o.kind === 'window');
  check('én dør og ett vindu', r.windows.length === 2 && d && wi, JSON.stringify(r.windows));
  check('døra: høyde 2,1 m, terskel 0', d && near(d.height, 2.1, 0.03) && near(d.sill, 0, 0.03), d && `${d.sill} / ${d.height}`);
  check('vinduet: brystning 0,9 m, høyde 1,2 m', wi && near(wi.sill, 0.9, 0.03) && near(wi.height, 1.2, 0.03), wi && `${wi.sill} / ${wi.height}`);
  check('vinduet: rammen, ikke glasset', wi && near(wi.x0, 500, 2) && near(wi.x1, 619, 2) && near(wi.y0, 290, 2) && near(wi.y1, 409, 2),
    wi && `[${wi.x0}, ${wi.y0}, ${wi.x1}, ${wi.y1}]`);
  check('1 etasje', r.storeys === 1, `storeys ${r.storeys}`);
  const given = F.readFacade(img, { pxPerM: 80 });
  check('kjent skala vinner', given.method === 'given' && given.pxPerM === 80, `${given.pxPerM} (${given.method})`);
}

// ——— 2. a long side with a dark roof band, two storeys of windows, no door (scale from the window heads) ———
section('syntetisk langside: takflate, to etasjer, uten dør');
{
  const img = canvas(1200, 720);
  fill(img, 20, 640, 1180, 641, 0);
  const ppm = 80;
  const foot = 640;
  const eave = foot - Math.round(5.6 * ppm); // 192
  fill(img, 100, 60, 1100, eave - 1, 60); // the roof surface seen from the eave side
  for (let y = 70; y < eave; y += 12) fill(img, 100, y, 1100, y, 90); // tile lines
  const holes = [];
  const wins = [];
  for (const k of [0, 1]) {
    for (const x of [200, 520, 840]) {
      // heads at 2.1 m above each floor (storeys 2.7 m), 1.3 m high, 1.0 m wide
      const y1 = foot - 1 - Math.round((k * 2.7 + 0.8) * ppm);
      const y0 = y1 - Math.round(1.3 * ppm) + 1;
      const b = [x, y0, x + ppm - 1, y1];
      holes.push(b);
      wins.push(b);
    }
  }
  cladding(img, 100, eave, 1100, foot - 1, 12, 165, holes);
  frame(img, 100, eave, 1100, foot - 1, 3, 0);
  for (const b of wins) {
    fill(img, ...b, 255);
    frame(img, ...b, 4, 15);
    fill(img, b[0] + 4, b[1] + 4, b[2] - 4, b[3] - 4, 225);
  }
  const r = F.readFacade(img);
  check('bakkelinja', r.groundY === 640, `groundY ${r.groundY}`);
  check('takfoten under takflaten', near(r.eaveY, eave, 4), `eaveY ${r.eaveY} (fasit ${eave})`);
  check('takform: langside av saltak', r.roof === 'gable', r.roof);
  check('6 vinduer, 0 dører', r.windows.length === 6 && r.windows.every((o) => o.kind === 'window'), `${r.windows.length}`);
  check('skala fra vindusoverkanten (2,1 m)', r.method === 'window-head' && near(r.pxPerM, ppm, ppm * 0.02), `${r.pxPerM} (${r.method})`);
  const s0 = r.windows.filter((o) => o.storey === 0);
  const s1 = r.windows.filter((o) => o.storey === 1);
  check('3 + 3 per etasje', s0.length === 3 && s1.length === 3, `${s0.length} + ${s1.length}`);
  check('brystning 0,8 m i begge etasjene', r.windows.every((o) => near(o.sill, 0.8, 0.05)), r.windows.map((o) => o.sill).join(', '));
  check('høyde 1,3 m', r.windows.every((o) => near(o.height, 1.3, 0.05)), r.windows.map((o) => o.height).join(', '));
  check('2 etasjer', r.storeys === 2, `storeys ${r.storeys}`);
}

// ——— 3. a dark door leaf with a glass slit, a flat roof, a glass railing that is not a window ———
section('syntetisk: mørk dør, flatt tak, glassrekkverk');
{
  const img = canvas(1000, 600);
  fill(img, 20, 520, 980, 521, 0);
  const ppm = 90;
  fill(img, 150, 200, 850, 519, 230); // a plain wall
  frame(img, 150, 200, 850, 519, 3, 0);
  fill(img, 140, 180, 860, 199, 255);
  frame(img, 140, 180, 860, 199, 3, 0); // the roof edge (fascia)
  const door = [400, 520 - Math.round(2.1 * ppm), 400 + ppm - 1, 519];
  fill(img, ...door, 25);
  fill(img, 440, door[1] + 30, 450, 480, 220); // the glass slit
  // a glass railing on the roof: thin light posts
  fill(img, 600, 100, 840, 179, 235);
  for (const x of [600, 680, 760, 840]) fill(img, x, 100, x + 1, 179, 140);
  fill(img, 600, 100, 841, 101, 140);
  const r = F.readFacade(img);
  const d = r.windows.filter((o) => o.kind === 'door');
  check('den mørke døra', d.length === 1 && near(d[0].x0, 400, 2) && near(d[0].x1, 489, 2), JSON.stringify(d));
  check('skala fra den mørke døra', r.method === 'door' && near(r.pxPerM, ppm, 2), `${r.pxPerM} (${r.method})`);
  check('glasslisten i døra er ikke et vindu', !r.windows.some((o) => o.kind === 'window' && o.x0 >= 400 && o.x1 <= 490), JSON.stringify(r.windows));
  check('glassrekkverket er ikke vinduer', !r.windows.some((o) => o.y1 < 200), JSON.stringify(r.windows.filter((o) => o.y1 < 200)));
}

// ——— 4. what is not a facade ———
section('tåler det som ikke er en fasade');
{
  const blank = F.readFacade(canvas(300, 200));
  check('blankt ark: ingen bakkelinje, ingen åpninger, ingen unntak', blank.groundY === null && blank.windows.length === 0 && blank.notes.length > 0, blank.notes.join(' '));
  const tiny = F.readFacade({ width: 3, height: 2, data: new Uint8ClampedArray(24) });
  check('3 × 2 px', tiny.windows.length === 0, JSON.stringify(tiny.notes));
}

// ——— 5. the real facades ———
const SHEETS = {
  // [x0, y0, x1, y1] on the sheet, left to right, ink + 10 px
  hus3: [[10, 48, 390, 238], [562, 48, 751, 237], [924, 49, 1302, 237], [1477, 49, 1666, 238]],
  hus2: [[22, 29, 226, 113], [259, 30, 476, 115], [503, 27, 722, 111], [753, 27, 962, 111]],
};
// facade scales from the fasit notes (px per metre on the facade image; null = not given)
const SCALES = {
  hus1: [77, 105, 103, 105],
  hus2: [11, 11, 11, 11],
  hus3: [21.9, 22.8, 21.9, 22.8],
  hus4: [null, null, null, null],
  hus5: [95, 95, 83, 83],
};
function crop(img, [x0, y0, x1, y1]) {
  const w = x1 - x0 + 1;
  const h = y1 - y0 + 1;
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) d.set(img.data.subarray(((y + y0) * img.width + x0) * 4, ((y + y0) * img.width + x1 + 1) * 4), y * w * 4);
  return { width: w, height: h, data: d };
}
function facadeImages(house) {
  const fasit = readJson(`plantegninger/${house}/fasit.json`);
  if (SHEETS[house]) {
    const sheet = readPng(path.join(ROOT, 'plantegninger', house, 'fasader.png'));
    return SHEETS[house].map((b, i) => ({ name: `${house} fasade ${i + 1}`, img: crop(sheet, b), truth: fasit.facades[i], scale: SCALES[house][i] }));
  }
  return fasit.facades.map((f, i) => {
    const png = f.file.replace(/\.\w+$/, '.png');
    const file = f.file.endsWith('.png') ? path.join(ROOT, 'plantegninger', house, png) : path.join(ROOT, 'plantegninger', '_png', house, png);
    return { name: `${house} ${png.replace('.png', '')}`, img: readPng(file), truth: f, scale: SCALES[house][i] };
  });
}

section('ekte fasader mot fasiten');
const rows = [];
for (const house of ['hus1', 'hus2', 'hus3', 'hus4', 'hus5']) {
  for (const f of facadeImages(house)) {
    const t0 = performance.now();
    const r = F.readFacade(f.img, { ai: null });
    const ms = performance.now() - t0;
    const nw = r.windows.filter((o) => o.kind === 'window').length;
    const nd = r.windows.filter((o) => o.kind === 'door').length;
    rows.push({ ...f, r, ms, nw, nd, scaleErr: f.scale && r.pxPerM ? r.pxPerM / f.scale - 1 : null });
  }
}
const pct = (v) => (v == null ? '–' : `${v > 0 ? '+' : ''}${Math.round(v * 100)} %`);
log('\n  fasade             tak (fasit)                 vinduer  dører  etg   px/m (fasit)        metode        ms');
for (const x of rows) {
  const roof = `${x.r.roof ?? '–'}${x.r.roof === x.truth.roof ? '' : ` (${x.truth.roof})`}`;
  log(`  ${x.name.padEnd(18)} ${roof.padEnd(27)} ${`${x.nw}/${x.truth.windows}`.padEnd(8)} ${`${x.nd}/${x.truth.doors}`.padEnd(6)} ${`${x.r.storeys}/${x.truth.storeys}`.padEnd(5)} ${`${x.r.pxPerM} (${x.scale ?? '–'}, ${pct(x.scaleErr)})`.padEnd(19)} ${`${x.r.method}/${x.r.confidence}`.padEnd(13)} ${Math.round(x.ms)}`);
}
if (!quiet) {
  log('\n  åpningene (storey: sill / height m):');
  for (const x of rows) {
    const list = x.r.windows.map((o) => `${o.kind === 'door' ? 'D' : 'V'}${o.storey}:${o.sill}/${o.height}`).join(' ');
    log(`  ${x.name.padEnd(18)} ${list}${x.r.skylights.length ? `  + ${x.r.skylights.length} takvindu` : ''}`);
  }
}
const sum = (k) => rows.reduce((s, x) => s + k(x), 0);
const winTruth = sum((x) => x.truth.windows);
const doorTruth = sum((x) => x.truth.doors);
const winErr = sum((x) => Math.abs(x.nw - x.truth.windows));
const doorErr = sum((x) => Math.abs(x.nd - x.truth.doors));
const openErr = sum((x) => Math.abs(x.nw + x.nd - x.truth.windows - x.truth.doors));
const roofOk = rows.filter((x) => x.r.roof === x.truth.roof).length;
const storeysOk = rows.filter((x) => x.r.storeys === x.truth.storeys).length;
const scaled = rows.filter((x) => x.scaleErr != null);
const within = (p) => scaled.filter((x) => Math.abs(x.scaleErr) <= p).length;
log(`\n  vinduer: ${sum((x) => x.nw)} funnet / ${winTruth} i fasiten, sum |avvik| ${winErr}; dører: ${sum((x) => x.nd)} / ${doorTruth}, sum |avvik| ${doorErr}; åpninger samlet sum |avvik| ${openErr}`);
log(`  takform riktig ${roofOk}/${rows.length}, etasjer riktig ${storeysOk}/${rows.length}, skala innen 5 %: ${within(0.05)}/${scaled.length}, innen 10 %: ${within(0.1)}/${scaled.length}`);

const exact = rows.filter((x) => x.nw === x.truth.windows && x.nd === x.truth.doors).length;
log(`  riktig antall vinduer og dører på ${exact}/${rows.length} fasader`);

// the house's roof from all four facades (each votes for the types its view allows)
const houses = ['hus1', 'hus2', 'hus3', 'hus4', 'hus5'];
const houseRoofs = Object.fromEntries(houses.map((hh) => [hh, F.houseRoof(rows.filter((x) => x.name.startsWith(`${hh} `)).map((x) => x.r))]));
log(`  husets tak fra alle fasadene: ${houses.map((hh) => `${hh} ${houseRoofs[hh]}`).join(', ')}`);

// the limits are the measured quality when this test was written, with a small margin: they catch a regression
check('alle 20 fasadene gir bakkelinje, møne og takfot i riktig rekkefølge',
  rows.every((x) => x.r.groundY != null && x.r.ridgeY < x.r.eaveY && x.r.eaveY < x.r.groundY),
  rows.filter((x) => !(x.r.ridgeY < x.r.eaveY && x.r.eaveY < x.r.groundY)).map((x) => x.name).join(', '));
check('alle gir en skala', rows.every((x) => x.r.pxPerM > 0), rows.filter((x) => !(x.r.pxPerM > 0)).map((x) => x.name).join(', '));
check('under 1 s per fasade', rows.every((x) => x.ms < 1000), `maks ${Math.round(Math.max(...rows.map((x) => x.ms)))} ms`);
check('åpninger (vinduer + dører) samlet: sum |avvik| ≤ 4', openErr <= 4, `${openErr}`);
check('vinduer: sum |avvik| ≤ 7', winErr <= 7, `${winErr} (${sum((x) => x.nw)} / ${winTruth})`);
check('dører: sum |avvik| ≤ 7', doorErr <= 7, `${doorErr} (${sum((x) => x.nd)} / ${doorTruth})`);
check('riktig antall vinduer og dører på minst 12 av 20 fasader', exact >= 12, `${exact}`);
check('takform riktig på minst 15 av 20', roofOk >= 15, `${roofOk}`);
check('husets tak: hus1 halvvalm (med ark), hus2 og hus3 saltak, hus4 pulttak',
  houseRoofs.hus1 === 'half-hip' && houseRoofs.hus2 === 'gable' && houseRoofs.hus3 === 'gable' && houseRoofs.hus4 === 'mono-pitch',
  JSON.stringify(houseRoofs));
check('etasjer riktig på minst 18 av 20', storeysOk >= 18, `${storeysOk}`);
check('skala innen 10 % på alle med kjent skala', within(0.1) === scaled.length, `${within(0.1)}/${scaled.length}`);
check('skala innen 5 % på minst 9 av 16', within(0.05) >= 9, `${within(0.05)}/${scaled.length}`);
const byName = (n) => rows.find((x) => x.name === n).r;
check('takvinduene i takflaten er ikke vinduer (hus1 fasade1 og fasade3: 2 + 2)',
  byName('hus1 fasade1').skylights.length === 2 && byName('hus1 fasade3').skylights.length === 2
  && rows.filter((x) => !['hus1 fasade1', 'hus1 fasade3'].includes(x.name)).every((x) => x.r.skylights.length === 0),
  rows.filter((x) => x.r.skylights.length).map((x) => `${x.name}: ${x.r.skylights.length}`).join(', '));
// the heights the fasit notes give in px
{
  const n = byName('hus1 fasade3');
  check('hus1 fasade3: bakke y ≈ 879, raft y 615–640, møne y ≈ 172', near(n.groundY, 879, 3) && n.eaveY >= 615 && n.eaveY <= 640 && near(n.ridgeY, 172, 4),
    `${n.groundY} / ${Math.round(n.eaveY)} / ${Math.round(n.ridgeY)}`);
  const b = byName('hus3 fasade 2');
  // the sheet's y minus 48 (the crop): gesims 123 px and møne 163 px over the house bottom at sheet y 222
  check('hus3 nordgavl: gesims y ≈ 51, møne y ≈ 11 (i utsnittet)', near(b.eaveY, 51, 4) && near(b.ridgeY, 11, 4), `${Math.round(b.eaveY)} / ${Math.round(b.ridgeY)}`);
}
const allOps = rows.flatMap((x) => x.r.windows);
check('alle brystninger 0–3 m og høyder 0,3–3,2 m', allOps.every((o) => o.sill >= 0 && o.sill <= 3 && o.height >= 0.3 && o.height <= 3.2),
  allOps.filter((o) => !(o.sill >= 0 && o.sill <= 3 && o.height >= 0.3 && o.height <= 3.2)).map((o) => `${o.sill}/${o.height}`).join(' '));
check('dørene står på gulvet (terskel ≤ 0,25 m)', allOps.filter((o) => o.kind === 'door').every((o) => o.sill <= 0.25),
  allOps.filter((o) => o.kind === 'door' && o.sill > 0.25).map((o) => o.sill).join(' '));

// ——— 6. hus7: an architect's sheet (plan, section and four elevations, terrain, dimension chains, a level ruler) ———
// The elevations are cut out with the boxes in the fasit. The fasit: 1:100, 117.4 px/m, floor to ridge 4.50 m = 528 px,
// gable roof, no windows; NORD has the two garage doors.
section('hus7: fasadene på et arkitektark (terreng, målekjeder, kotelinjal)');
const h7 = [];
{
  const fasit = readJson('plantegninger/hus7/fasit.json');
  const sheet = readPng(path.join(ROOT, 'plantegninger', '_png', 'hus7', 'garasje-plan-snitt-fasade.png'));
  for (const f of fasit.facades) {
    const t0 = performance.now();
    const r = F.readFacade(crop(sheet, f.bbox), { ai: null });
    h7.push({ name: `hus7 ${f.title}`, truth: f, r, ms: performance.now() - t0 });
  }
  for (const x of h7) {
    const H = x.r.groundY != null && x.r.ridgeY != null ? x.r.groundY - x.r.ridgeY : null;
    log(`  ${x.name.padEnd(10)} tak ${String(x.r.roof).padEnd(6)} (${x.truth.roof})  bakke→møne ${H == null ? '–' : Math.round(H)} px (528)  `
      + `${x.r.pxPerM ?? '–'} px/m (117,4, ${pct(x.r.pxPerM ? x.r.pxPerM / 117.4 - 1 : null)}) ${x.r.method}/${x.r.confidence}  `
      + `vinduer ${x.r.windows.filter((o) => o.kind === 'window').length}/${x.truth.windows} dører ${x.r.windows.filter((o) => o.kind === 'door').length}/${x.truth.doors}  ${Math.round(x.ms)} ms`);
    log(`             ${x.r.notes.join(' | ')}`);
  }
  const by = (t) => h7.find((x) => x.truth.title === t).r;
  const read = ['VEST', 'SØR', 'NORD'];
  check('VEST, SØR, NORD: bakkelinja er garasjens fot (bakke → møne 528 px ± 3 %), ikke en målekjede',
    read.every((t) => by(t).groundY != null && Math.abs(by(t).groundY - by(t).ridgeY - 528) <= 528 * 0.03),
    read.map((t) => `${t} ${by(t).groundY == null ? '–' : Math.round(by(t).groundY - by(t).ridgeY)}`).join(', '));
  check('VEST, SØR, NORD: saltak', read.every((t) => by(t).roof === 'gable'), read.map((t) => `${t} ${by(t).roof}`).join(', '));
  check('NORD: to garasjeporter (dører), ingen vinduer, skala fra portene innen 5 %',
    by('NORD').windows.length === 2 && by('NORD').windows.every((o) => o.kind === 'door' && o.sill <= 0.1)
    && by('NORD').method === 'door' && Math.abs(by('NORD').pxPerM / 117.4 - 1) <= 0.05,
    `${by('NORD').windows.map((o) => `${o.kind} ${o.sill}/${o.height}`).join(', ')}; ${by('NORD').pxPerM} px/m (${by('NORD').method})`);
  // known limitation, recorded: without a door the scale is the wall height as 2.7 m, and the garage walls are 2.2 m
  check('VEST og SØR (kjent begrensning): uten dør er skalaen vegghøyden som 2,7 m, 15–25 % for lav, lav sikkerhet',
    ['VEST', 'SØR'].every((t) => by(t).method === 'eave' && by(t).confidence === 'low' && by(t).pxPerM / 117.4 - 1 >= -0.25 && by(t).pxPerM / 117.4 - 1 <= -0.15),
    ['VEST', 'SØR'].map((t) => `${t} ${by(t).pxPerM} (${pct(by(t).pxPerM / 117.4 - 1)}, ${by(t).method}/${by(t).confidence})`).join(', '));
  // known failure, recorded: the stepped foot on sloping terrain has no long line; no reading rather than a wrong one
  check('ØST (kjent feil): trappet fot i skrånende terreng gir ingen bakkelinje – ingen avlesning heller enn en gal',
    by('ØST').groundY == null && by('ØST').windows.length === 0 && by('ØST').pxPerM == null && /bakkelinje/.test(by('ØST').notes.join(' ')),
    by('ØST').notes.join(' '));
  check('husets tak fra hus7-fasadene: saltak', F.houseRoof(h7.map((x) => x.r)) === 'gable', F.houseRoof(h7.map((x) => x.r)));
  check('hus7: under 1 s per fasade', h7.every((x) => x.ms < 1000), `maks ${Math.round(Math.max(...h7.map((x) => x.ms)))} ms`);
}

// ——— 7. tilted drawings: a scan or a rectified photo is 0.5–2° off ———
section('skjeve fasader (rotateImage) rettes opp før lesingen');
{
  const IM = await imp('src/planbygger/image.js');
  const cases = [['hus1 fasade1', 0.5], ['hus1 fasade1', 1], ['hus1 fasade1', -1], ['hus1 fasade3', 1], ['hus1 fasade3', 2], ['hus4 fasade1', -1], ['hus5 fasade2', 0.5]];
  const out = [];
  for (const [name, deg] of cases) {
    const base = rows.find((x) => x.name === name);
    const t0 = performance.now();
    const r = F.readFacade(IM.rotateImage(base.img, deg), { ai: null });
    const ms = performance.now() - t0;
    const nw = r.windows.filter((o) => o.kind === 'window').length;
    const nd = r.windows.filter((o) => o.kind === 'door').length;
    out.push({ name, deg, r, ms, nw, nd, base });
    log(`  ${name} ${String(deg).padStart(4)}°: skjevhet ${r.skew}°, ${r.pxPerM} px/m (rett: ${base.r.pxPerM}, ${pct(r.pxPerM / base.r.pxPerM - 1)}) ${r.method}, `
      + `vinduer ${nw} (rett ${base.nw}), dører ${nd} (rett ${base.nd}), tak ${r.roof} (rett ${base.r.roof}), ${Math.round(ms)} ms`);
  }
  check('skjevheten finnes innen 0,1°', out.every((x) => Math.abs(x.r.skew - x.deg) <= 0.1), out.map((x) => `${x.deg}→${x.r.skew}`).join(', '));
  check('ingen negativ eller null skala, møne < takfot < bakke', out.every((x) => x.r.pxPerM > 0 && x.r.ridgeY < x.r.eaveY && x.r.eaveY < x.r.groundY),
    out.filter((x) => !(x.r.pxPerM > 0 && x.r.ridgeY < x.r.eaveY && x.r.eaveY < x.r.groundY)).map((x) => `${x.name} ${x.deg}°: ${x.r.pxPerM}`).join(', '));
  check('skalaen innen 6 % av den rette fasaden', out.every((x) => Math.abs(x.r.pxPerM / x.base.r.pxPerM - 1) <= 0.06),
    out.map((x) => pct(x.r.pxPerM / x.base.r.pxPerM - 1)).join(', '));
  check('bakkelinja innen 4 px av den rette (midt på huset)', out.every((x) => Math.abs(x.r.groundY - x.base.r.groundY) <= 4),
    out.map((x) => `${x.r.groundY}/${x.base.r.groundY}`).join(', '));
  const dOpen = out.reduce((s, x) => s + Math.abs(x.nw + x.nd - x.base.nw - x.base.nd), 0);
  check(`åpninger: sum |avvik fra den rette| ≤ ${TILT_OPEN_MAX}`, dOpen <= TILT_OPEN_MAX, `${dOpen}`);
  const ops = out.flatMap((x) => x.r.windows);
  check('alle brystninger 0–3 m og høyder 0,3–3,2 m', ops.every((o) => o.sill >= 0 && o.sill <= 3 && o.height >= 0.3 && o.height <= 3.2),
    ops.filter((o) => !(o.sill >= 0 && o.sill <= 3 && o.height >= 0.3 && o.height <= 3.2)).map((o) => `${o.sill}/${o.height}`).join(' '));
  check('en rett fasade dreies ikke', rows.every((x) => x.r.skew === 0), rows.filter((x) => x.r.skew !== 0).map((x) => `${x.name} ${x.r.skew}`).join(', '));
  check('under 1,5 s per skjev fasade', out.every((x) => x.ms < 1500), `maks ${Math.round(Math.max(...out.map((x) => x.ms)))} ms`);
}

// ——— 8. other resolutions: the same drawing rendered smaller or larger ———
section('andre oppløsninger: arbeidskopien er normalisert');
{
  /** Resampled copy (box average when shrinking, bilinear when enlarging) – independent of the module's own. */
  const resize = (img, f) => {
    const W = Math.round(img.width * f);
    const H = Math.round(img.height * f);
    const d = new Uint8ClampedArray(W * H * 4);
    const s = img.data;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const o = (y * W + x) * 4;
        if (f < 1) {
          const acc = [0, 0, 0, 0];
          let n = 0;
          for (let yy = Math.floor(y / f); yy < Math.min(img.height, Math.ceil((y + 1) / f)); yy++) {
            for (let xx = Math.floor(x / f); xx < Math.min(img.width, Math.ceil((x + 1) / f)); xx++) {
              for (let c = 0; c < 4; c++) acc[c] += s[(yy * img.width + xx) * 4 + c];
              n++;
            }
          }
          for (let c = 0; c < 4; c++) d[o + c] = acc[c] / n;
        } else {
          const sx = Math.min(img.width - 1, Math.max(0, (x + 0.5) / f - 0.5));
          const sy = Math.min(img.height - 1, Math.max(0, (y + 0.5) / f - 0.5));
          const x0 = Math.floor(sx);
          const y0 = Math.floor(sy);
          const x1 = Math.min(img.width - 1, x0 + 1);
          const y1 = Math.min(img.height - 1, y0 + 1);
          for (let c = 0; c < 4; c++) {
            const a = s[(y0 * img.width + x0) * 4 + c] * (1 - (sx - x0)) + s[(y0 * img.width + x1) * 4 + c] * (sx - x0);
            const b = s[(y1 * img.width + x0) * 4 + c] * (1 - (sx - x0)) + s[(y1 * img.width + x1) * 4 + c] * (sx - x0);
            d[o + c] = a * (1 - (sy - y0)) + b * (sy - y0);
          }
        }
      }
    }
    return { width: W, height: H, data: d };
  };
  const cases = [['hus1 fasade1', 0.5], ['hus1 fasade1', 2.5], ['hus1 fasade3', 2.5], ['hus4 fasade3', 0.5], ['hus5 fasade1', 0.5], ['hus4 fasade1', 1.5]];
  const out = [];
  for (const [name, k] of cases) {
    const base = rows.find((x) => x.name === name);
    const t0 = performance.now();
    const r = F.readFacade(resize(base.img, k), { ai: null });
    const ms = performance.now() - t0;
    const nw = r.windows.filter((o) => o.kind === 'window').length;
    const nd = r.windows.filter((o) => o.kind === 'door').length;
    out.push({ name, k, r, ms, nw, nd, base });
    log(`  ${name} × ${k}: arbeidskopi × ${r.workScale}, ${round2(r.pxPerM / k)} px/m i originalens mål (${base.r.pxPerM}, ${pct(r.pxPerM / k / base.r.pxPerM - 1)}) ${r.method}, `
      + `vinduer ${nw}/${base.truth.windows} (originalen ${base.nw}), dører ${nd}/${base.truth.doors} (${base.nd}), tak ${r.roof}, ${Math.round(ms)} ms`);
  }
  check('skalaen innen 10 % av originalens (etter skaleringen)', out.every((x) => Math.abs(x.r.pxPerM / x.k / x.base.r.pxPerM - 1) <= 0.1),
    out.map((x) => pct(x.r.pxPerM / x.k / x.base.r.pxPerM - 1)).join(', '));
  check('arbeidskopien: huset 400–900 px høyt', out.every((x) => { const Hw = (x.r.groundY - x.r.ridgeY) * x.r.workScale; return Hw >= 390 && Hw <= 910; }),
    out.map((x) => Math.round((x.r.groundY - x.r.ridgeY) * x.r.workScale)).join(', '));
  const dFasit = out.reduce((s, x) => s + Math.abs(x.nw - x.base.truth.windows) + Math.abs(x.nd - x.base.truth.doors), 0);
  const dBase = out.reduce((s, x) => s + Math.abs(x.base.nw - x.base.truth.windows) + Math.abs(x.base.nd - x.base.truth.doors), 0);
  check(`vinduer og dører mot fasiten: sum |avvik| ≤ ${RES_OPEN_MAX} (originalene: ${dBase})`, dFasit <= RES_OPEN_MAX, `${dFasit}`);
  check('takformen som originalen på minst 5 av 6', out.filter((x) => x.r.roof === x.base.r.roof).length >= 5, out.map((x) => `${x.r.roof}/${x.base.r.roof}`).join(', '));
  check('under 1,5 s per fasade (også 4800 × 2300 px)', out.every((x) => x.ms < 1500), `maks ${Math.round(Math.max(...out.map((x) => x.ms)))} ms`);
}

// ——— 9. the AI answer: recorded readFacade answers for hus4 fasade1, replayed ———
section('KI-svar (opptak) på hus4 fasade1');
{
  const h4 = rows.filter((x) => x.name.startsWith('hus4 '));
  for (const model of ['claude-sonnet-5-5', 'claude-haiku-5-5']) {
    const rec = readJson(`tools/fixtures/planbygger-ai/hus4/fasade1.readFacade.${model}.json`);
    const r = F.readFacade(h4[0].img, { ai: rec.response });
    const W = h4[0].img.width;
    const H = h4[0].img.height;
    // each AI box against our best match (IoU)
    const ious = rec.response.windows.map((a) => {
      const b = { x0: a.bbox[0] * W, y0: a.bbox[1] * H, x1: a.bbox[2] * W, y1: a.bbox[3] * H };
      return Math.max(0, ...r.windows.map((o) => {
        const iw = Math.min(o.x1, b.x1) - Math.max(o.x0, b.x0);
        const ih = Math.min(o.y1, b.y1) - Math.max(o.y0, b.y0);
        const i = iw > 0 && ih > 0 ? iw * ih : 0;
        return i / ((o.x1 - o.x0) * (o.y1 - o.y0) + (b.x1 - b.x0) * (b.y1 - b.y0) - i);
      }));
    });
    const house = F.houseRoof([r, ...h4.slice(1).map((x) => x.r)]);
    check(`${model}: taket fra KI på fasaden (${rec.response.roof}), etasjer ${rec.response.storeys}`, r.roof === rec.response.roof && r.roofFrom === 'ai' && r.storeys === rec.response.storeys,
      `${r.roof} (${r.roofFrom}), ${r.storeys}`);
    check(`${model}: KI-boksene treffer våre (IoU ≥ 0,8 på alle 7), og dørene er dører`, ious.every((v) => v >= 0.8) && r.windows.filter((o) => o.kind === 'door').length === 2,
      ious.map((v) => v.toFixed(2)).join(' '));
    check(`${model}: husets tak med KI-svaret på én fasade og de tre andre klassiske: pulttak (fasiten)`, house === 'mono-pitch', house);
  }
  // one AI answer does not outvote the other views, but it settles a tie
  const votes = (roofs) => F.houseRoof(roofs.map(([roof, roofFrom, roofOptions]) => ({ roof, roofFrom, roofOptions })));
  check('houseRoof: KI-svaret avgjør likt, men slår ikke de andre fasadene', votes([['gable', 'ai', ['gable', 'mono-pitch']], ['mono-pitch', 'outline', ['mono-pitch']]]) === 'gable'
    && votes([['gable', 'ai', ['mixed', 'mono-pitch']], ['mono-pitch', 'outline', ['mono-pitch']], ['mono-pitch', 'outline', ['mono-pitch']]]) === 'mono-pitch',
    `${votes([['gable', 'ai', ['gable', 'mono-pitch']], ['mono-pitch', 'outline', ['mono-pitch']]])}, ${votes([['gable', 'ai', ['mixed', 'mono-pitch']], ['mono-pitch', 'outline', ['mono-pitch']], ['mono-pitch', 'outline', ['mono-pitch']]])}`);
}

// ——— 10. a given storey count never leaves a window without its floor ———
section('oppgitt etasjetall mot vinduene');
{
  const img = rows.find((x) => x.name === 'hus4 fasade1').img;
  const one = F.readFacade(img, { ai: { roof: 'mono-pitch', storeys: 1, windows: [] } });
  const three = F.readFacade(img, { storeys: 3 });
  const okFloors = (r) => r.floorYs.length === r.storeys && r.windows.every((o) => o.storey < r.floorYs.length && r.floorYs[o.storey] != null);
  check('KI sier 1 etasje, vinduene står i 2: storeys 2, floorYs har gulvet til hvert vindu, og en merknad',
    one.storeys === 2 && okFloors(one) && /Oppgitt 1 etasje/.test(one.notes.join(' ')), `${one.storeys}, [${one.floorYs}], ${one.windows.map((o) => o.storey).join('')}`);
  check('storeys 3 oppgitt: 3 gulv, synkende y', three.storeys === 3 && okFloors(three) && three.floorYs[2] < three.floorYs[1] && three.floorYs[1] < three.floorYs[0],
    `[${three.floorYs}]`);
  check('alle ekte fasader: hvert vindu har sitt gulv i floorYs', rows.every((x) => okFloors(x.r)), rows.filter((x) => !okFloors(x.r)).map((x) => x.name).join(', '));
}

done();
