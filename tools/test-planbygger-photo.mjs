#!/usr/bin/env node
/**
 * Planbygger: tests for src/planbygger/photo.js (isPhoto, rectifyPhoto) – plain Node, no browser, no network.
 *
 *   node tools/test-planbygger-photo.mjs [--write]      --write: the rectified images to .shots/planbygger/photo/
 *
 *   1. isPhoto: false for every digital plan in plantegninger/ (the PNG originals and the _png copies), true for the
 *      photo; rectifyPhoto leaves the digital plans alone (applied false). The same for digital plans shown in a viewer
 *      (a phone screenshot with black bars, a dark image viewer, a PDF viewer's grey): not a photo, not touched. A grey,
 *      noisy scan (no pure white, no desk) looks like a close-up photo to isPhoto, but must not be «rectified» either.
 *   2. The homography: four points map exactly, and back.
 *   3. A synthetic photo with a known answer: hus3/1etg.png on an A4 sheet, on an orange desk, under a known
 *      perspective, with a light gradient, a soft hand shadow, a blue cast, noise, a light blur and the top right
 *      corner under a dark block. The corners must come back to a few pixels, the paper must be even, and the walls
 *      detectPlan finds must lie where they lie on the sheet itself. Turned 90°, the sheet comes out landscape.
 *   4. The real photo (hus3-foto, a print of hus3/1etg.png on a desk): rectified, then detectPlan + findRooms on it and
 *      on hus3/1etg.png, each at the scale fitted by the building's outer extent (6.15 × 14.95 m). Walls, doors,
 *      windows and rooms are compared in metres from the building's outer corner; the numbers are printed, the checks
 *      are floors well below them (detect.js is improved by others: these catch a broken rectification, not a
 *      detector change). Also: unset options (undefined, null) give the defaults; the photo in grey and at half its
 *      saturation (the desk no longer tells itself apart by colour) gives the same corners; a close-up with no edge of
 *      the sheet in it gives nothing (the house's walls are not the sheet).
 *   5. Synthetic photos through a pinhole camera (the principal point at the centre, as a phone's): grey, light grey
 *      and white desks (the sheet found from its edges), a steep shot whose far side is foreshortened (it must still
 *      come out portrait), and a sheet running out of the photo at the top (a focal length the default does not
 *      assume) or the left. The house's shape (width / height on the output) must come back within 1 % (1.5 % when a
 *      side was cut, its place estimated), and the cut side must be named.
 */
import { ROOT, imp, check, section, done } from './planbygger-lib.mjs';
import { readPng, writePng } from './planbygger-png.mjs';
import fs from 'node:fs';
import path from 'node:path';

const P = await imp('src/planbygger/photo.js');
const WRITE = process.argv.includes('--write');
const SHOTS = path.join(ROOT, '.shots/planbygger/photo');
if (WRITE) fs.mkdirSync(SHOTS, { recursive: true });
const PLANS = path.join(ROOT, 'plantegninger');
const PHOTO = path.join(PLANS, '_png/hus3-foto/1etg-foto.png');
const PLAN = path.join(PLANS, 'hus3/1etg.png');
const EXTENT = [6.15, 14.95]; // hus3 1. etasje, outer dimensions written on the plan
const lumAt = (img, x, y) => {
  const i = (y * img.width + x) * 4;
  return 0.299 * img.data[i] + 0.587 * img.data[i + 1] + 0.114 * img.data[i + 2];
};
const f1 = (v) => (Math.round(v * 10) / 10).toFixed(1);
const pct = (v) => `${Math.round(v * 100)} %`;

// ---------------------------------------------------------------------------------------------------------------
section('1. Foto eller digital plan');
{
  const files = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (p.endsWith('.png')) files.push(p);
    }
  })(PLANS);
  let worst = 0;
  let worstName = '';
  const wrong = [];
  const touched = [];
  for (const f of files) {
    const img = readPng(f);
    const r = P.isPhoto(img);
    const name = path.relative(PLANS, f).replace(/\\/g, '/');
    if (f === PHOTO) {
      check('mobilfotoet er et foto', r.photo && r.score >= 0.9, `score ${r.score}`);
      continue;
    }
    if (r.photo) wrong.push(`${name} (${r.score})`);
    if (r.score > worst) {
      worst = r.score;
      worstName = name;
    }
    if (P.rectifyPhoto(img).applied) touched.push(name);
  }
  check(`ingen av de ${files.length - 1} digitale planene er et foto`, !wrong.length, wrong.length ? wrong.join(', ') : `høyeste score ${worst} (${worstName}), grensen 0.5`);
  check('rectifyPhoto lar de digitale planene være', !touched.length, touched.join(', ') || 'applied false på alle');

  // a digital plan shown in a viewer: the plan fitted into a SW × SH frame of one flat colour
  const inViewer = (file, bg, SW, SH) => {
    const plan = readPng(path.join(PLANS, file));
    const k = Math.min((SW * 0.98) / plan.width, (SH * 0.9) / plan.height);
    const pw = Math.round(plan.width * k);
    const ph = Math.round(plan.height * k);
    const ox = Math.round((SW - pw) / 2);
    const oy = Math.round((SH - ph) / 2);
    const img = { width: SW, height: SH, data: new Uint8ClampedArray(SW * SH * 4) };
    for (let y = 0; y < SH; y++) {
      for (let x = 0; x < SW; x++) {
        const i = (y * SW + x) * 4;
        const u = Math.floor((x - ox) / k);
        const v = Math.floor((y - oy) / k);
        const inside = x >= ox && y >= oy && x < ox + pw && y < oy + ph && u < plan.width && v < plan.height;
        const j = (v * plan.width + u) * 4;
        for (let c = 0; c < 3; c++) img.data[i + c] = inside ? plan.data[j + c] : bg[c];
        img.data[i + 3] = 255;
      }
    }
    return img;
  };
  const viewers = [
    ['hus3/1etg.png', [32, 33, 36], 1400, 1100],
    ['hus3/1etg.png', [82, 86, 89], 1400, 1100],
    ['hus2/1etg.png', [32, 33, 36], 1400, 1300],
    ['_png/hus8/plantegning-1.png', [0, 0, 0], 1170, 2532],
    ['_png/hus8/plantegning-1.png', [0, 0, 0], 2532, 1170],
    ['_png/hus9/ovre-etasje.png', [0, 0, 0], 1170, 2532],
  ];
  const bad = [];
  let top = 0;
  for (const [file, bg, SW, SH] of viewers) {
    const img = inViewer(file, bg, SW, SH);
    const ip = P.isPhoto(img);
    const r = P.rectifyPhoto(img);
    top = Math.max(top, ip.score);
    if (ip.photo || r.applied || r.reason !== 'digital') bad.push(`${file} på ${bg.join(',')} (score ${ip.score}, applied ${r.applied}, ${r.reason})`);
  }
  check('en digital plan i en visning (svarte felt, mørk visning, PDF-grått) er ikke et foto og rettes ikke', !bad.length, bad.join('; ') || `${viewers.length} varianter, høyeste score ${top}, reason «digital»`);

  // a grey, noisy scan (the paper ≈ 225, no pure white, no desk): isPhoto cannot tell it from a close-up photo, but
  // rectifyPhoto must not take a drawing's frame, a filled area or the house for the sheet
  const greyBad = [];
  const greyScores = [];
  for (const file of ['hus3/1etg.png', '_png/hus8/plantegning-1.png', '_png/hus6/plan-1etg-tilbygg.png']) {
    const src = readPng(path.join(PLANS, file));
    const img = { width: src.width, height: src.height, data: new Uint8ClampedArray(src.data) };
    let seed = 5;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) - 0.5;
    for (let i = 0; i < img.data.length; i += 4) for (let c = 0; c < 3; c++) img.data[i + c] = src.data[i + c] * 0.88 + 8 * rnd();
    const r = P.rectifyPhoto(img);
    greyScores.push(`${file} ${P.isPhoto(img).score} → ${r.reason ?? 'applied'}`);
    if (r.applied) greyBad.push(`${file}: ${JSON.stringify(r.quad)}`);
  }
  check('en grå, støyete skanning rettes ikke (ingen tegning tas for arket)', !greyBad.length, greyBad.join('; ') || greyScores.join('; '));
}

// ---------------------------------------------------------------------------------------------------------------
section('2. Homografien');
{
  const src = [[0, 0], [1414, 0], [1414, 2000], [0, 2000]];
  const dst = [[312.5, 330.25], [1180, 401], [1110.75, 1860], [150, 1700.5]];
  const H = P.solveHomography(src, dst);
  const err = Math.max(...src.map((p, i) => Math.hypot(P.mapPoint(H, p)[0] - dst[i][0], P.mapPoint(H, p)[1] - dst[i][1])));
  check('fire punkter treffer eksakt', err < 1e-6, `største feil ${err.toExponential(1)} px`);
  const Hi = P.solveHomography(dst, src);
  const mid = [707, 1000];
  const back = P.mapPoint(Hi, P.mapPoint(H, mid));
  check('fram og tilbake', Math.hypot(back[0] - mid[0], back[1] - mid[1]) < 1e-6);
  check('en rett linje forblir rett', (() => {
    const a = P.mapPoint(H, [100, 100]);
    const b = P.mapPoint(H, [700, 1000]);
    const c = P.mapPoint(H, [1300, 1900]);
    return Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) < 1e-6 * Math.hypot(c[0] - a[0], c[1] - a[1]) ** 2;
  })());
}

// ---------------------------------------------------------------------------------------------------------------
// detection helpers: the building's outer extent, the scale fitted to it, walls / openings / rooms in metres

const { detectPlan } = await imp('src/planbygger/detect.js');
const { findRooms } = await imp('src/planbygger/regions.js');
const { pointInPolygon } = await imp('src/planbygger/geom.js');
const M = await imp('src/planbygger/model.js');

/** Bounding box of the exterior walls' outer faces (px). */
function outerExtent(det) {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const w of det.walls) {
    if (!w.exterior) continue;
    const hx = w.axis === 'v' ? w.t / 2 : 0;
    const hy = w.axis === 'h' ? w.t / 2 : 0;
    for (const p of [w.a, w.b]) {
      x0 = Math.min(x0, p[0] - hx);
      x1 = Math.max(x1, p[0] + hx);
      y0 = Math.min(y0, p[1] - hy);
      y1 = Math.max(y1, p[1] + hy);
    }
  }
  return { x0, y0, w: x1 - x0, h: y1 - y0 };
}

/** detectPlan at the scale where the outer extent is EXTENT (one scale for both axes), found by iteration. */
function fitScale(img, guess) {
  let ppm = guess;
  for (let it = 0; it < 4; it++) {
    const e = outerExtent(detectPlan(img, { pxPerM: ppm }));
    const next = (e.w / EXTENT[0] + e.h / EXTENT[1]) / 2;
    if (!Number.isFinite(next) || next <= 0) break;
    const stop = Math.abs(next - ppm) / ppm < 0.003;
    ppm = next;
    if (stop) break;
  }
  const det = detectPlan(img, { pxPerM: ppm });
  const e = outerExtent(det);
  return { ppm, det, e, aspect: e.w / EXTENT[0] / (e.h / EXTENT[1]) };
}

/** Walls, openings and rooms in metres from the building's outer top-left corner. */
function inMetres(X) {
  const k = 1 / X.ppm;
  const { x0, y0 } = X.e;
  const tr = (p) => [(p[0] - x0) * k, (p[1] - y0) * k];
  const walls = X.det.walls.map((w) => ({ axis: w.axis, a: tr(w.a), b: tr(w.b), t: w.t * k }));
  const openings = X.det.openings.map((o) => {
    const w = X.det.walls[o.wall];
    const s = (o.from + o.to) / 2;
    const c = w.axis === 'h' ? [w.a[0] + s, w.a[1]] : [w.a[0], w.a[1] + s];
    return { type: o.type, axis: w.axis, c: tr(c), width: (o.to - o.from) * k };
  });
  const doc = M.createDoc('test');
  const level = M.createLevel(doc, { id: 'l', image: { name: 'x', width: 1, height: 1, pxPerM: X.ppm } });
  M.applyDetection(level, X.det, X.ppm, doc.settings);
  const rooms = findRooms(level.walls).rooms.map((r) => ({
    area: r.area,
    inside: [r.inside[0] - x0 * k, r.inside[1] - y0 * k],
    polygon: r.polygon.map((p) => [p[0] - x0 * k, p[1] - y0 * k]),
  }));
  return { walls, openings, rooms };
}

/** Share of the length of `from` with a wall of `to` on the same axis within tol across (and the mean offset). */
function coverage(from, to, tol = 0.1) {
  let tot = 0;
  let hit = 0;
  let off = 0;
  for (const w of from) {
    const L = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);
    const n = Math.max(1, Math.round(L / 0.05));
    const al = w.axis === 'h' ? 0 : 1;
    for (let k = 0; k < n; k++) {
      const t = (k + 0.5) / n;
      const p = [w.a[0] + (w.b[0] - w.a[0]) * t, w.a[1] + (w.b[1] - w.a[1]) * t];
      tot += L / n;
      let best = Infinity;
      for (const o of to) {
        if (o.axis !== w.axis) continue;
        if (p[al] < Math.min(o.a[al], o.b[al]) - 0.05 || p[al] > Math.max(o.a[al], o.b[al]) + 0.05) continue;
        best = Math.min(best, Math.abs(p[1 - al] - o.a[1 - al]));
      }
      if (best <= tol) {
        hit += L / n;
        off += best * (L / n);
      }
    }
  }
  return { length: tot, share: tot ? hit / tot : 0, offset: hit ? off / hit : 0 };
}

/** Openings of `ref` matched in `got`: same axis, centres within 40 cm, each used once. */
function matchOpenings(ref, got) {
  const used = new Set();
  let found = 0;
  let sameType = 0;
  let dc = 0;
  const missing = [];
  for (const a of ref) {
    let best = null;
    got.forEach((b, j) => {
      if (used.has(j) || b.axis !== a.axis) return;
      const d = Math.hypot(b.c[0] - a.c[0], b.c[1] - a.c[1]);
      if (d <= 0.4 && (!best || d < best.d)) best = { d, j, b };
    });
    if (!best) {
      missing.push(`${a.type} (${f1(a.c[0])}, ${f1(a.c[1])}) m`);
      continue;
    }
    used.add(best.j);
    found++;
    if (best.b.type === a.type) sameType++;
    dc += best.d;
  }
  return { found, sameType, extra: got.length - used.size, centre: found ? dc / found : 0, missing };
}
const countTypes = (ops) => {
  const c = {};
  for (const o of ops) c[o.type] = (c[o.type] ?? 0) + 1;
  return Object.entries(c).map(([k, v]) => `${v} ${k}`).join(', ') || 'ingen';
};

// ---------------------------------------------------------------------------------------------------------------
// the printed sheet: A4 portrait, 1414 × 2000 px, hus3/1etg.png fitted inside a 5 % margin (sections 3 and 5)

const SW = 1414;
const SH = 2000;
const SHEET = (() => {
  const plan = readPng(PLAN);
  const s = Math.min((SW * 0.9) / plan.width, (SH * 0.9) / plan.height);
  const ox = (SW - plan.width * s) / 2;
  const oy = (SH - plan.height * s) / 2;
  const sheet = { width: SW, height: SH, data: new Uint8ClampedArray(SW * SH * 4) };
  for (let y = 0; y < SH; y++) {
    for (let x = 0; x < SW; x++) {
      const u = (x + 0.5 - ox) / s - 0.5;
      const v = (y + 0.5 - oy) / s - 0.5;
      const o = (y * SW + x) * 4;
      sheet.data[o + 3] = 255;
      if (u < 0 || v < 0 || u > plan.width - 1 || v > plan.height - 1) {
        sheet.data[o] = sheet.data[o + 1] = sheet.data[o + 2] = 255;
        continue;
      }
      const x0 = Math.floor(u);
      const y0 = Math.floor(v);
      const x1 = Math.min(plan.width - 1, x0 + 1);
      const y1 = Math.min(plan.height - 1, y0 + 1);
      const fx = u - x0;
      const fy = v - y0;
      for (let c = 0; c < 3; c++) {
        const at = (xx, yy) => plan.data[(yy * plan.width + xx) * 4 + c];
        sheet.data[o + c] = (at(x0, y0) * (1 - fx) + at(x1, y0) * fx) * (1 - fy) + (at(x0, y1) * (1 - fx) + at(x1, y1) * fx) * fy;
      }
    }
  }
  // the building's outer corners on the sheet (hus3/1etg.png: x 314–607, y 140–856 px)
  const house = [[314, 140], [607, 140], [607, 856], [314, 856]].map(([x, y]) => [ox + x * s, oy + y * s]);
  return { sheet, s, house };
})();

// ---------------------------------------------------------------------------------------------------------------
section('3. Syntetisk foto med fasit');
{
  const { sheet, s } = SHEET;
  // the photo: 1500 × 2000, the sheet's corners at TRUE under a perspective
  const PW = 1500;
  const PH = 2000;
  const TRUE = [[310, 330], [1180, 400], [1110, 1860], [150, 1700]];
  const toSheet = P.solveHomography(TRUE, [[0, 0], [SW, 0], [SW, SH], [0, SH]]);
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) - 0.5;
  const raw = new Float32Array(PW * PH * 3);
  for (let y = 0; y < PH; y++) {
    for (let x = 0; x < PW; x++) {
      const [u, v] = P.mapPoint(toSheet, [x + 0.5, y + 0.5]);
      const k = (y * PW + x) * 3;
      let rgb;
      if (u >= 0 && v >= 0 && u < SW - 1 && v < SH - 1) {
        const xi = Math.floor(u);
        const yi = Math.floor(v);
        const fx = u - xi;
        const fy = v - yi;
        rgb = [0, 1, 2].map((c) => {
          const at = (xx, yy) => sheet.data[(yy * SW + xx) * 4 + c];
          return (at(xi, yi) * (1 - fx) + at(xi + 1, yi) * fx) * (1 - fy) + (at(xi, yi + 1) * (1 - fx) + at(xi + 1, yi + 1) * fx) * fy;
        });
        // light: a gradient, a soft elliptic hand shadow, a blue cast towards the right; paper ≈ 210 where lit
        const grad = 0.85 - 0.18 * (x / PW) - 0.08 * (y / PH);
        const d = Math.hypot((x - 650) / 330, (y - 1350) / 420);
        const shade = 1 - 0.38 / (1 + Math.exp((d - 1) / 0.08));
        const L = grad * shade;
        rgb = [rgb[0] * L * (1 - 0.05 * (x / PW)), rgb[1] * L, rgb[2] * L * (1 + 0.07 * (x / PW))];
      } else {
        const grain = 12 * Math.sin(x * 0.05 + Math.sin(y * 0.013) * 3);
        rgb = [185 + grain, 105 + grain * 0.6, 45 + grain * 0.3];
      }
      // the keyboard over the top right corner
      if (x > 1090 && y < 520) rgb = [38, 36, 60];
      raw[k] = rgb[0];
      raw[k + 1] = rgb[1];
      raw[k + 2] = rgb[2];
    }
  }
  // a light camera blur (3 × 3 box) and noise
  const photo = { width: PW, height: PH, data: new Uint8ClampedArray(PW * PH * 4) };
  for (let y = 0; y < PH; y++) {
    for (let x = 0; x < PW; x++) {
      for (let c = 0; c < 3; c++) {
        let sum = 0;
        let cnt = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx;
            const yy = y + dy;
            if (xx < 0 || yy < 0 || xx >= PW || yy >= PH) continue;
            sum += raw[(yy * PW + xx) * 3 + c];
            cnt++;
          }
        }
        photo.data[(y * PW + x) * 4 + c] = sum / cnt + 6 * rnd();
      }
      photo.data[(y * PW + x) * 4 + 3] = 255;
    }
  }
  const ip = P.isPhoto(photo);
  check('det syntetiske fotoet er et foto', ip.photo, `score ${ip.score}`);
  const t0 = performance.now();
  const r = P.rectifyPhoto(photo, { maxSide: 2000 });
  const ms = performance.now() - t0;
  check('arket er funnet og rettet opp', r.applied && r.img.width === SW && r.img.height === SH, `${r.img.width} × ${r.img.height}, ${Math.round(ms)} ms`);
  const cornerErr = r.quad ? r.quad.map((q, i) => Math.hypot(q[0] - TRUE[i][0], q[1] - TRUE[i][1])) : [Infinity];
  check('hjørnene innen 3 px (også det under tastaturet)', Math.max(...cornerErr) <= 3, cornerErr.map(f1).join(' / ') + ' px (TL, TR, BR, BL)');
  // the paper: even after the flattening – the blank sheet in the hand's shadow against the blank sheet in the light
  const toPhoto = P.solveHomography([[0, 0], [SW, 0], [SW, SH], [0, SH]], TRUE);
  const acc = { shadow: [0, 0, 0, 0], light: [0, 0, 0, 0] }; // [Σ photo, Σ rectified, n, Σ rectified²]
  for (let y = 40; y < SH - 40; y += 3) {
    for (let x = 40; x < SW - 40; x += 3) {
      if (lumAt(sheet, x, y) < 250) continue; // only where the sheet is blank
      const [px, py] = P.mapPoint(toPhoto, [x + 0.5, y + 0.5]).map(Math.floor);
      if (px > 1080 && py < 530) continue; // under the keyboard
      const d = Math.hypot((px - 650) / 330, (py - 1350) / 420);
      const bin = d < 0.8 ? acc.shadow : d > 1.4 ? acc.light : null;
      if (!bin) continue;
      const v = lumAt(r.img, x, y);
      bin[0] += lumAt(photo, px, py);
      bin[1] += v;
      bin[2]++;
      bin[3] += v * v;
    }
  }
  const mean = (b, k) => b[k] / b[2];
  const sd = (b) => Math.sqrt(Math.max(0, b[3] / b[2] - mean(b, 1) ** 2));
  const dShade = Math.abs(mean(acc.shadow, 1) - mean(acc.light, 1));
  check('papiret er jevnt: skygge og lys innen 6 grånivåer, rundt 245', dShade <= 6 && Math.abs(mean(acc.light, 1) - 245) <= 8,
    `skygge ${f1(mean(acc.shadow, 1))} ± ${f1(sd(acc.shadow))}, lys ${f1(mean(acc.light, 1))} ± ${f1(sd(acc.light))} (i fotoet ${f1(mean(acc.shadow, 0))} mot ${f1(mean(acc.light, 0))})`);
  // the walls on the rectified photo against the walls on the sheet (same frame, same scale)
  const ppm = 47.9 * s;
  const ref = detectPlan(sheet, { pxPerM: ppm });
  const got = detectPlan(r.img, { pxPerM: ppm });
  const asM = (det) => det.walls.map((w) => ({ axis: w.axis, a: [w.a[0] / ppm, w.a[1] / ppm], b: [w.b[0] / ppm, w.b[1] / ppm], t: w.t / ppm }));
  const rec = coverage(asM(ref), asM(got));
  const prec = coverage(asM(got), asM(ref));
  check('veggene ligger der de ligger på arket (≥ 90 % av lengden innen 10 cm, snitt ≤ 2 cm)', rec.share >= 0.9 && prec.share >= 0.85 && rec.offset <= 0.02,
    `arket ${ref.walls.length} vegger (${f1(rec.length)} m), fotoet ${got.walls.length}: funnet ${pct(rec.share)}, treffer ${pct(prec.share)}, snittavvik ${f1(rec.offset * 100)} cm`);
  if (WRITE) {
    writePng(path.join(SHOTS, 'syntetisk-foto.png'), photo);
    writePng(path.join(SHOTS, 'syntetisk-rettet.png'), r.img);
  }

  // turned 90° clockwise: the sheet lies landscape in the photo, and comes out landscape
  const rot = { width: PH, height: PW, data: new Uint8ClampedArray(PW * PH * 4) };
  for (let y = 0; y < PH; y++) {
    for (let x = 0; x < PW; x++) {
      const nx = PH - 1 - y;
      const ny = x;
      rot.data.set(photo.data.subarray((y * PW + x) * 4, (y * PW + x) * 4 + 4), (ny * PH + nx) * 4);
    }
  }
  const rr = P.rectifyPhoto(rot, { maxSide: 2000 });
  const trueRot = TRUE.map(([x, y]) => [PH - y, x]); // the same corners in the turned photo
  const errRot = rr.quad ? Math.max(...rr.quad.map((q) => Math.min(...trueRot.map((t) => Math.hypot(q[0] - t[0], q[1] - t[1]))))) : Infinity;
  check('dreid 90°: liggende utsnitt, de samme hjørnene', rr.applied && rr.img.width === SH && rr.img.height === SW && errRot <= 3, `${rr.img.width} × ${rr.img.height}, hjørnene innen ${f1(errRot)} px`);
}

// ---------------------------------------------------------------------------------------------------------------
section('4. Mobilfotoet (hus3-foto) mot hus3/1etg.png');
{
  const photo = readPng(PHOTO);
  const t0 = performance.now();
  const r = P.rectifyPhoto(photo);
  const ms = performance.now() - t0;
  check('arket er funnet og rettet opp til A4 (2400 px)', r.applied && r.img.height === 2400 && r.img.width === 1697, `${r.img.width} × ${r.img.height}, ${Math.round(ms)} ms`);
  // the visible corners (top left, bottom right, read off the photo by hand: ± 3 px)
  const tl = [337, 380];
  const br = [1027, 1799];
  const eTL = r.quad ? Math.hypot(r.quad[0][0] - tl[0], r.quad[0][1] - tl[1]) : Infinity;
  const eBR = r.quad ? Math.hypot(r.quad[2][0] - br[0], r.quad[2][1] - br[1]) : Infinity;
  check('de synlige hjørnene innen 8 px', eTL <= 8 && eBR <= 8, `TL ${f1(eTL)} px, BR ${f1(eBR)} px; hjørnene ${JSON.stringify(r.quad)}`);
  // paper: the most common grey and its share
  const hist = new Uint32Array(256);
  for (let i = 0; i < r.img.width * r.img.height; i++) hist[Math.round(lumAt(r.img, i % r.img.width, Math.floor(i / r.img.width)))]++;
  let mode = 0;
  for (let v = 0; v < 256; v++) if (hist[v] > hist[mode]) mode = v;
  let near = 0;
  for (let v = mode - 6; v <= mode + 6; v++) near += hist[Math.max(0, Math.min(255, v))];
  const share = near / (r.img.width * r.img.height);
  check('papiret er jevnt hvitt (≥ 60 % av bildet innen ±6 av papirtonen ≈ 245)', Math.abs(mode - 245) <= 4 && share >= 0.6, `papirtonen ${mode}, ${pct(share)} innen ±6`);
  check('kameraet: arket er A4 også etter kameramodellen (innen 4 %), ingen side kuttet', r.aspect != null && Math.abs(r.aspect * Math.SQRT2 - 1) <= 0.04 && r.cut.length === 0, `bredde/høyde ${r.aspect} (A4 0.707), cut ${JSON.stringify(r.cut)}`);
  if (WRITE) writePng(path.join(SHOTS, 'hus3-foto-rettet.png'), r.img);

  // unset options keep their defaults: a caller that forwards { maxSide: undefined } gets the same image
  const ru = P.rectifyPhoto(photo, { maxSide: undefined, contrast: null, refine: undefined, lineBoost: 'x' });
  let same = ru.applied && ru.img.width === r.img.width && ru.img.height === r.img.height;
  for (let i = 0; same && i < r.img.data.length; i++) if (ru.img.data[i] !== r.img.data[i]) same = false;
  check('valg som er undefined, null eller ikke et tall gir standardverdien (det samme bildet)', same, `${ru.img.width} × ${ru.img.height}`);

  // the desk no longer told apart by its colour: in grey (the sheet found from its edges), and at half the saturation
  const toned = (k) => {
    const g = { width: photo.width, height: photo.height, data: new Uint8ClampedArray(photo.data) };
    for (let i = 0; i < g.data.length; i += 4) {
      const l = 0.299 * photo.data[i] + 0.587 * photo.data[i + 1] + 0.114 * photo.data[i + 2];
      for (let c = 0; c < 3; c++) g.data[i + c] = l + (photo.data[i + c] - l) * k;
    }
    return g;
  };
  for (const [name, k] of [['i gråtoner', 0], ['med halv metning', 0.5]]) {
    const rv = P.rectifyPhoto(toned(k));
    const err = rv.quad ? Math.max(...rv.quad.map((q, i) => Math.hypot(q[0] - r.quad[i][0], q[1] - r.quad[i][1]))) : Infinity;
    check(`fotoet ${name}: de samme hjørnene som i farger (innen 5 px)`, rv.applied && err <= 5, `${rv.applied ? `største avvik ${f1(err)} px` : `applied false (${rv.reason})`}`);
  }
  // a close-up inside the sheet: no edge of it in the photo – the house's walls must not be taken for the sheet
  {
    const x0 = 300;
    const y0 = 450;
    const W = 760;
    const H = 1050;
    const c = { width: W, height: H, data: new Uint8ClampedArray(W * H * 4) };
    for (let y = 0; y < H; y++) c.data.set(photo.data.subarray(((y + y0) * photo.width + x0) * 4, ((y + y0) * photo.width + x0 + W) * 4), y * W * 4);
    const rc = P.rectifyPhoto(c);
    check('et nærbilde uten arkkant gir ingen oppretting (veggene er ikke arket)', !rc.applied, rc.applied ? `applied, hjørnene ${JSON.stringify(rc.quad)}` : `applied false (${rc.reason})`);
  }

  const A = fitScale(readPng(PLAN), 48);
  const B = fitScale(r.img, (48 * r.img.height) / 1001);
  const a = inMetres(A);
  const b = inMetres(B);
  console.log(`  skala: planen ${f1(A.ppm)} px/m, fotoet ${f1(B.ppm)} px/m; ytre mål på fotoet ${(B.e.w / B.ppm).toFixed(2)} × ${(B.e.h / B.ppm).toFixed(2)} m (planen ${(A.e.w / A.ppm).toFixed(2)} × ${(A.e.h / A.ppm).toFixed(2)})`);
  check('forholdet bredde/høyde som på planen (innen 2 %)', Math.abs(B.aspect / A.aspect - 1) <= 0.02, `fotoet ${B.aspect.toFixed(4)}, planen ${A.aspect.toFixed(4)} (1 = 6,15 × 14,95 m)`);
  const rec = coverage(a.walls, b.walls);
  const prec = coverage(b.walls, a.walls);
  check('veggene: ≥ 60 % av planens vegger funnet innen 10 cm, ≥ 60 % av fotoets treffer', rec.share >= 0.6 && prec.share >= 0.6,
    `planen ${a.walls.length} vegger (${f1(rec.length)} m), fotoet ${b.walls.length} (${f1(prec.length)} m): funnet ${pct(rec.share)}, treffer ${pct(prec.share)}, snittavvik ${f1(rec.offset * 100)} cm`);
  const op = matchOpenings(a.openings, b.openings);
  check('dører og vinduer: minst 6 av planens funnet', op.found >= 6,
    `planen: ${countTypes(a.openings)}; fotoet: ${countTypes(b.openings)}; funnet ${op.found}, samme type ${op.sameType}, ekstra ${op.extra}, senteravvik ${f1(op.centre * 100)} cm${op.missing.length ? `; mangler ${op.missing.join(', ')}` : ''}`);
  const rows = a.rooms.map((ra) => {
    const rb = b.rooms.find((x) => pointInPolygon(ra.inside, x.polygon));
    return { ref: ra.area, got: rb ? rb.area : null };
  });
  for (const row of rows) console.log(`  rom: planen ${row.ref.toFixed(2)} m² → fotoet ${row.got == null ? 'ikke funnet' : `${row.got.toFixed(2)} m² (${row.got >= row.ref ? '+' : ''}${(((row.got - row.ref) / row.ref) * 100).toFixed(1)} %)`}`);
  const good = rows.filter((x) => x.got != null && Math.abs(x.got - x.ref) / x.ref <= 0.05).length;
  check('minst ett av planens rom igjen innen 5 % av arealet', good >= 1, `${good} av ${rows.length} (planen: ${rows.map((x) => x.ref.toFixed(1)).join(', ')} m²; fotoet: ${b.rooms.map((x) => x.area.toFixed(1)).join(', ') || 'ingen'} m²)`);
  // as «Generer» detects (clean: true), at the photo's scale and 1.5 % on either side of it: the rooms the plan itself
  // closes (KJØKKEN/STUE with ENTRÉ, which is open to it, VASK and WC/D) – before, only VASK: the camera breaks the thin
  // frame lines of the north window into pieces that read as a dashed line, and the big room stayed open there
  const ac = inMetres({ ...A, det: detectPlan(readPng(PLAN), { pxPerM: A.ppm, clean: true }) });
  for (const k of [0.985, 1, 1.015]) {
    const ppm = B.ppm * k;
    const bc = inMetres({ ...B, ppm, det: detectPlan(r.img, { pxPerM: ppm, clean: true }) });
    const rc = ac.rooms.map((ra) => {
      const rb = bc.rooms.find((x) => pointInPolygon(ra.inside, x.polygon));
      return { ref: ra.area, got: rb ? rb.area : null };
    });
    // the two large ones (KJØKKEN/STUE with ENTRÉ, VASK) within 10 % at all three scales; WC/D (4 m²) within 20 % at
    // the photo's own scale – above it the fixtures cut it into slivers (104 px/m: 0.8 m² and three more)
    const big = rc.map((x, i) => ({ ...x, i })).sort((p, q) => q.ref - p.ref);
    const ok = big.slice(0, 2).every((x) => x.got != null && Math.abs(x.got - x.ref) / x.ref <= 0.1);
    const wc = big[2];
    const wcOk = k !== 1 || (wc && wc.got != null && Math.abs(wc.got - wc.ref) / wc.ref <= 0.2);
    check(`med rydding ved ${f1(ppm)} px/m: de to store rommene planen lukker innen 10 %${k === 1 ? ', WC/D innen 20 %' : ''}`, rc.length >= 3 && ok && wcOk, `planen ${rc.map((x) => x.ref.toFixed(1)).join(', ')} m² → fotoet ${rc.map((x) => (x.got == null ? 'ikke funnet' : x.got.toFixed(1))).join(', ')} m² (${bc.rooms.length} rom)`);
  }
}

// ---------------------------------------------------------------------------------------------------------------
section('5. Syntetiske kamerabilder: nøytral pult, bratt vinkel, arket delvis utenfor bildet');
{
  const { sheet, house } = SHEET;
  const PW = 1500;
  const PH = 2000;
  const DIAG = Math.hypot(PW, PH);
  /** The corners (TL, TR, BR, BL) of an A4 sheet seen by a pinhole camera: focal length f (px), the principal point
   * at the centre; the sheet turned by yaw on the desk, shifted by off (m), the camera tilted by tilt from straight
   * down at a distance D (m). */
  const pinhole = ({ f, tilt = 0, yaw = 0, D = 0.5, off = [0, 0] }) => {
    const rx = (tilt * Math.PI) / 180;
    const rz = (yaw * Math.PI) / 180;
    return [[-0.105, -0.1485], [0.105, -0.1485], [0.105, 0.1485], [-0.105, 0.1485]].map(([x, y]) => {
      const X = x * Math.cos(rz) - y * Math.sin(rz) + off[0];
      const Y = x * Math.sin(rz) + y * Math.cos(rz) + off[1];
      const Zc = D + Y * Math.sin(rx);
      return [PW / 2 + (f * X) / Zc, PH / 2 + (f * Y * Math.cos(rx)) / Zc];
    });
  };
  /** The photo: the desk lit like the sheet on it (a gradient, a soft hand shadow), wood grain, a blue cast on the
   * paper, a 3 × 3 blur and noise. */
  const render = ({ TRUE, desk, shadow = true }) => {
    const toSheet = P.solveHomography(TRUE, [[0, 0], [SW, 0], [SW, SH], [0, SH]]);
    let seed = 777;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) - 0.5;
    const raw = new Float32Array(PW * PH * 3);
    for (let y = 0; y < PH; y++) {
      for (let x = 0; x < PW; x++) {
        const [u, v] = P.mapPoint(toSheet, [x + 0.5, y + 0.5]);
        const grad = 0.85 - 0.18 * (x / PW) - 0.08 * (y / PH);
        const d = Math.hypot((x - 0.43 * PW) / (0.22 * PW), (y - 0.67 * PH) / (0.21 * PH));
        const shade = shadow ? 1 - 0.38 / (1 + Math.exp((d - 1) / 0.08)) : 1;
        let rgb;
        if (u >= 0 && v >= 0 && u < SW - 1 && v < SH - 1) {
          const xi = Math.floor(u);
          const yi = Math.floor(v);
          const fx = u - xi;
          const fy = v - yi;
          const at = (xx, yy) => sheet.data[(yy * SW + xx) * 4];
          const val = (at(xi, yi) * (1 - fx) + at(xi + 1, yi) * fx) * (1 - fy) + (at(xi, yi + 1) * (1 - fx) + at(xi + 1, yi + 1) * fx) * fy;
          const L = grad * shade;
          rgb = [val * L * (1 - 0.05 * (x / PW)), val * L, val * L * (1 + 0.07 * (x / PW))];
        } else {
          const g = 10 * Math.sin(x * 0.05 + Math.sin(y * 0.013) * 3);
          const L = (grad / 0.85) * shade;
          rgb = [(desk[0] + g) * L, (desk[1] + 0.6 * g) * L, (desk[2] + 0.3 * g) * L];
        }
        raw.set(rgb, (y * PW + x) * 3);
      }
    }
    const img = { width: PW, height: PH, data: new Uint8ClampedArray(PW * PH * 4) };
    for (let y = 0; y < PH; y++) {
      for (let x = 0; x < PW; x++) {
        for (let c = 0; c < 3; c++) {
          let sum = 0;
          let cnt = 0;
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              const xx = x + dx;
              const yy = y + dy;
              if (xx < 0 || yy < 0 || xx >= PW || yy >= PH) continue;
              sum += raw[(yy * PW + xx) * 3 + c];
              cnt++;
            }
          }
          img.data[(y * PW + x) * 4 + c] = sum / cnt + 6 * rnd();
        }
        img.data[(y * PW + x) * 4 + 3] = 255;
      }
    }
    return img;
  };
  /** The house's width / height on the output against on the sheet, − 1 (the shape error the plan would get). */
  const shapeError = (r, TRUE) => {
    const toPhoto = P.solveHomography([[0, 0], [SW, 0], [SW, SH], [0, SH]], TRUE);
    const toOut = P.solveHomography(r.quad, [[0, 0], [r.img.width, 0], [r.img.width, r.img.height], [0, r.img.height]]);
    const m = house.map((p) => P.mapPoint(toOut, P.mapPoint(toPhoto, p)));
    const d = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);
    const w = (d(m[0], m[1]) + d(m[3], m[2])) / 2;
    const h = (d(m[0], m[3]) + d(m[1], m[2])) / 2;
    return w / h / ((house[1][0] - house[0][0]) / (house[3][1] - house[0][1])) - 1;
  };
  const f0 = 0.6 * DIAG;
  const flat = { f: f0, tilt: 25, yaw: 6, D: 0.55 };
  const orange = [185, 105, 45];
  const cases = [
    { name: 'grå pult (150)', cam: flat, desk: [150, 150, 150] },
    { name: 'lys grå pult (190)', cam: flat, desk: [190, 190, 188] },
    { name: 'hvit pult (235)', cam: flat, desk: [235, 235, 232] },
    { name: 'bratt, 55° (den lange aksen peker bort, fjernsiden forkortet)', cam: { f: 1600, tilt: 55, D: 0.42 }, desk: orange, shadow: false },
    { name: 'toppen utenfor bildet, brennvidde 0,75 × diagonalen', cam: { f: 0.75 * DIAG, tilt: 35, yaw: 2, D: 0.4, off: [0, -0.055] }, desk: orange, cut: ['top'] },
    { name: 'venstre side utenfor bildet', cam: { f: f0, tilt: 25, yaw: 2, D: 0.32, off: [-0.095, 0] }, desk: orange, cut: ['left'] },
  ];
  for (const c of cases) {
    const TRUE = pinhole(c.cam);
    const img = render({ TRUE, desk: c.desk, shadow: c.shadow });
    const t0 = performance.now();
    const r = P.rectifyPhoto(img, { maxSide: 2000 });
    const ms = performance.now() - t0;
    const err = r.applied ? shapeError(r, TRUE) : NaN;
    const lim = c.cut ? 0.015 : 0.01;
    const cutOk = JSON.stringify(r.cut) === JSON.stringify(c.cut ?? []);
    const corners = r.quad ? r.quad.map((q) => Math.min(...TRUE.map((t) => Math.hypot(q[0] - t[0], q[1] - t[1])))) : [];
    check(`${c.name}: stående A4, husets form innen ${lim * 100} %${c.cut ? `, siden meldt som kuttet (${c.cut[0]})` : ''}`,
      r.applied && r.img.width === SW && r.img.height === SH && Math.abs(err) <= lim && cutOk,
      r.applied
        ? `${r.img.width} × ${r.img.height}, formfeil ${(err * 100).toFixed(2)} %, hjørnene ${corners.map(f1).join(' / ')} px, cut ${JSON.stringify(r.cut)}, ${Math.round(ms)} ms`
        : `applied false (${r.reason})`);
    if (WRITE) writePng(path.join(SHOTS, `kamera-${c.name.replace(/[^a-z0-9]+/gi, '-').slice(0, 30)}.png`), r.img);
  }
}

done();
