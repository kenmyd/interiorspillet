#!/usr/bin/env node
/**
 * Tests for src/planbygger/clean.js (cleanForWalls): synthetic plans with a known answer, the real plans of the test
 * set (plantegninger/, the measurement set in tools/fixtures/clean/plans.json), and the wall detection + rooms
 * (detectPlan + findRooms) before and after the cleaning on every plan.
 *
 *   node tools/test-planbygger-clean.mjs [--only=hus4-1,hus9-ovre] [--opt={"hatch":false}] [--quick] [--verbose]
 *                                        [--detect=<a copy of detect.js>] [--clean=<a copy of clean.js>]
 *
 * --quick skips the before/after detection on the real plans (the slow part, a minute or two).
 *
 * A fixture entry with `photo` is a phone photo of a print (hus3-foto): it is straightened with photo.js first, as
 * generate.js does, and its label points, house box and scale (from the house's outer corners and outer dimensions)
 * are given in the photo and mapped into the straightened image through photo.js's own corners.
 *
 * Measured per plan, before → after:
 *   rooms      labelled rooms found as their own room (every label point of the entry in the same room, no other
 *              entry's label in it, the area within ±15 % of the printed one when the plan prints it)
 *   recall     share of the wall ink (fixture wallInk: neutral, in the luma range, thick – after an opening as thin as
 *              the thinnest wall – inside the house) that a detected wall covers (2 px tolerance)
 *   precision  share of the detected wall area that lies on wall ink (2 px tolerance)
 *   false      detected wall area off the wall ink, m² – furniture, hatching, callouts and text taken for walls
 *   doors, windows
 * «Never worse» holds on every plan; where a plan's fixture accepts a rise in false walls or fewer doors or windows
 * (`accept`), the check says so and gives the reason.
 */
import { ROOT, imp, readJson, check, section, done } from './planbygger-lib.mjs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { readPng } from './planbygger-png.mjs';

const args = process.argv.slice(2);
const flag = (k) => args.find((a) => a.startsWith(`--${k}=`))?.split('=').slice(1).join('=');
const only = flag('only')?.split(',') ?? null;
const extraOpt = flag('opt') ? JSON.parse(flag('opt')) : {};
const quick = args.includes('--quick');
const verbose = args.includes('--verbose');

const { cleanForWalls } = flag('clean') ? await import(pathToFileURL(path.resolve(flag('clean'))).href) : await imp('src/planbygger/clean.js');
const I = await imp('src/planbygger/image.js');
const { findRooms, endExtensions } = await imp('src/planbygger/regions.js');
const { renderPlan, samplePlans } = await import('./planbygger-synth.mjs');

/** Modules others are working on: an import that throws is retried a few times. --detect=<file> measures against
 *  another copy of detect.js (a frozen one, while the real one changes under the measurements). */
async function importRetry(rel, file = null) {
  if (file) return import(pathToFileURL(path.resolve(file)).href);
  for (let k = 0; k < 4; k++) {
    try {
      return await imp(`${rel}${k ? `?retry=${k}` : ''}`);
    } catch (e) {
      console.log(`  (${rel} kunne ikke importeres: ${e.message.split('\n')[0]} – prøver igjen om 30 s)`);
      await new Promise((r) => setTimeout(r, 30000));
    }
  }
  throw new Error(`${rel} kan ikke importeres`);
}
const DETECT = await importRetry('src/planbygger/detect.js', flag('detect'));
const { detectPlan } = DETECT;

const clean = (img, ppm, o = {}) => cleanForWalls(img, { pxPerM: ppm, ...extraOpt, ...o });
const chromaOf = (d, i) => Math.max(d[i], d[i + 1], d[i + 2]) - Math.min(d[i], d[i + 1], d[i + 2]);
const lumaAt = (d, i) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
const sameBytes = (a, b) => a.data.length === b.data.length && a.data.every((v, i) => v === b.data[i]);
const pct = (x) => `${Math.round(x * 100)} %`;
const f2 = (x) => x.toFixed(2);

// ---------------------------------------------------------------------------------------------------------------
// helpers: colouring a synthetic plan

/**
 * Rooms tinted like an estate agent's plan: every pixel inside the inner faces of the exterior walls (box [x0, y0, x1,
 * y1] in pixels) multiplied by the colour of its half, so the walls stay black and their inner edges blend into it.
 */
function tintFloors(img, paper, box, colours) {
  const { width: w, height: h } = img;
  const [x0, y0, x1, y1] = box;
  const data = new Uint8ClampedArray(img.data);
  for (let y = Math.max(0, Math.floor(y0)); y < Math.min(h, Math.ceil(y1)); y++) {
    for (let x = Math.max(0, Math.floor(x0)); x < Math.min(w, Math.ceil(x1)); x++) {
      const i = y * w + x;
      const c = colours[x < (x0 + x1) / 2 ? 0 : 1];
      const v = img.data[i * 4];
      for (let k = 0; k < 3; k++) data[i * 4 + k] = Math.round((v * c[k]) / paper);
    }
  }
  return { width: w, height: h, data };
}

/** Opaque antialiased strokes drawn on top: circles [cx, cy, r] and lines [x0, y0, x1, y1] (pixels). */
function drawInk(img, { circles = [], lines = [], colour, width = 3 }) {
  const { width: w, height: h } = img;
  const data = new Uint8ClampedArray(img.data);
  const half = width / 2;
  const segDist = (px, py, [x0, y0, x1, y1]) => {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const t = Math.max(0, Math.min(1, ((px - x0) * dx + (py - y0) * dy) / (dx * dx + dy * dy)));
    return Math.hypot(px - x0 - t * dx, py - y0 - t * dy);
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let d = Infinity;
      for (const [cx, cy, r] of circles) d = Math.min(d, Math.abs(Math.hypot(x + 0.5 - cx, y + 0.5 - cy) - r));
      for (const l of lines) d = Math.min(d, segDist(x + 0.5, y + 0.5, l));
      const cov = Math.max(0, Math.min(1, half + 0.5 - d));
      if (!cov) continue;
      const i = (y * w + x) * 4;
      for (let k = 0; k < 3; k++) data[i + k] = Math.round(data[i + k] * (1 - cov) + colour[k] * cov);
    }
  }
  return { width: w, height: h, data };
}

/** Every dark neutral pixel recoloured (walls drawn in red): v → blend of the colour and the paper by darkness. */
function recolourInk(img, paper, colour) {
  const data = new Uint8ClampedArray(img.data);
  for (let i = 0; i < data.length; i += 4) {
    const a = Math.max(0, Math.min(1, (paper - img.data[i]) / paper));
    for (let k = 0; k < 3; k++) data[i + k] = Math.round(paper * (1 - a) + colour[k] * a);
  }
  return { width: img.width, height: img.height, data };
}

/** Only the walls coloured (pixels at most `upTo` above the wall grey, by darkness), furniture and lines stay grey. */
function colourWalls(img, paper, wallGrey, colour, upTo = 40) {
  const data = new Uint8ClampedArray(img.data);
  for (let i = 0; i < data.length; i += 4) {
    const v = img.data[i];
    if (v > wallGrey + upTo) continue;
    const a = Math.max(0, Math.min(1, (paper - v) / (paper - wallGrey)));
    for (let k = 0; k < 3; k++) data[i + k] = Math.round(paper * (1 - a) + colour[k] * a);
  }
  return { width: img.width, height: img.height, data };
}

/** All ink tinted blue-grey (a phone photo's cast): chroma C at the wall grey, less on lighter pixels, luma kept. */
function tintInk(img, paper, wallGrey, C) {
  const data = new Uint8ClampedArray(img.data);
  for (let i = 0; i < data.length; i += 4) {
    const v = img.data[i];
    const c = C * Math.max(0, Math.min(1, (paper - v) / (paper - wallGrey)));
    data[i] = Math.round(v - c * 0.6);
    data[i + 1] = Math.round(v - c * 0.05);
    data[i + 2] = Math.round(v + c * 0.4);
  }
  return { width: img.width, height: img.height, data };
}

/** The walls of two detections agree: same count, every wall of a has one in b within tol px (ends and centre). */
function sameWalls(a, b, tol = 1.5) {
  if (a.walls.length !== b.walls.length) return { ok: false, detail: `${a.walls.length} mot ${b.walls.length} vegger` };
  let worst = 0;
  for (const w of a.walls) {
    let best = Infinity;
    for (const v of b.walls) {
      if (v.axis !== w.axis) continue;
      best = Math.min(best, Math.max(Math.hypot(v.a[0] - w.a[0], v.a[1] - w.a[1]), Math.hypot(v.b[0] - w.b[0], v.b[1] - w.b[1]), Math.abs(v.t - w.t)));
    }
    worst = Math.max(worst, best);
  }
  return { ok: worst <= tol, detail: `${a.walls.length} vegger, største avvik ${worst.toFixed(2)} px` };
}
const types = (d) => d.openings.map((o) => o.type).sort().join(',');

// ---------------------------------------------------------------------------------------------------------------
section('Syntetiske planer');
{
  const plans = samplePlans();
  const ppm = 50;
  const paper = 240;
  const base = renderPlan(plans.leilighet, { pxPerM: ppm, paper, seed: 3 });
  const neutralOut = clean(base.img, ppm);
  check('en plan uten farge kommer uendret tilbake (byte for byte)', sameBytes(neutralOut, base.img));
  const det0 = detectPlan(base.img, { pxPerM: ppm });

  // coloured floors (yellow / light blue) + dark blue callouts on top (as dark as hus6's: luma ≈ 40), one leader line
  // across an interior wall, one across the window in the east wall
  const [ox, oy] = base.origin;
  const P = (x, y) => [ox + x * ppm, oy + y * ppm];
  const tinted = tintFloors(base.img, paper, [...P(0.125 - 0.02, 0.125 - 0.02), ...P(9 - 0.125 + 0.02, 7 - 0.125 + 0.02)], [[250, 222, 150], [185, 212, 245]]);
  const [c1x, c1y] = P(2, 1.6);
  const [c2x, c2y] = P(6.5, 5.6);
  const [l0x, l0y] = P(2.6, 1.6);
  const [l1x, l1y] = P(5.2, 1.6); // crosses the wall at x = 4
  const [l2x, l2y] = P(9.8, 5.6);
  const callouts = drawInk(tinted, { circles: [[c1x, c1y, 0.55 * ppm], [c2x, c2y, 0.45 * ppm]], lines: [[l0x, l0y, l1x, l1y], [c2x + 0.45 * ppm, c2y, l2x, l2y]], colour: [10, 20, 230], width: 4 });
  const detC = detectPlan(callouts, { pxPerM: ppm });
  const cleaned = clean(callouts, ppm);
  const detK = detectPlan(cleaned, { pxPerM: ppm });
  let blue = 0;
  for (let i = 0; i < cleaned.data.length; i += 4) if (chromaOf(cleaned.data, i) >= 30) blue++;
  check('fargede gulv og blå påskrifter: ingen farget piksel igjen', blue === 0, `${blue} igjen, ${cleaned.cleanStats.colour.changed} piksler endret`);
  const sw = sameWalls(det0, detK);
  const swC = sameWalls(det0, detC);
  check('… og veggene blir de samme som på planen uten farge', sw.ok, `${sw.detail}; uten rydding: ${swC.ok ? 'de samme' : swC.detail}`);
  check('… og dørene og vinduene blir de samme', types(det0) === types(detK), `${types(detK)} (uten farge: ${types(det0)}; uten rydding: ${types(detC)})`);

  // walls drawn in red: the guard keeps them
  const red = recolourInk(base.img, paper, [200, 30, 35]);
  const detR = detectPlan(red, { pxPerM: ppm });
  const redClean = clean(red, ppm);
  const detRK = detectPlan(redClean, { pxPerM: ppm });
  const swr = sameWalls(detR, detRK);
  check('røde vegger og røde streker (fargen er hovedblekket) blir ikke papir', redClean.cleanStats.colour.guard && swr.ok && types(detR) === types(detRK), `vern ${redClean.cleanStats.colour.guard}, ${swr.detail}, åpninger ${types(detRK)}`);

  // only the walls coloured, the furniture and the lines grey (the wall tone must come from the coloured walls, not
  // from a light furniture band – or the steps for light grey walls paint the walls as paper), and all ink with a faint
  // cast at the edge of colourFrom (a phone photo)
  const grey105 = renderPlan(plans.leilighet, { pxPerM: ppm, paper, seed: 3, wallGrey: 105 }).img;
  const det105 = detectPlan(grey105, { pxPerM: ppm });
  const variants = [
    ['skiferblå vegger (kroma 26), grå møbler', colourWalls(grey105, paper, 105, [90, 106, 116])],
    ['blå vegger (kroma 40), grå møbler', colourWalls(grey105, paper, 105, [85, 103, 125])],
    ['røde vegger, grå møbler', colourWalls(grey105, paper, 105, [200, 30, 35])],
    ['alt blekket svakt blått (kroma 19)', tintInk(grey105, paper, 105, 19)],
    ['alt blekket svakt blått (kroma 20)', tintInk(grey105, paper, 105, 20)],
  ];
  for (const [name, img] of variants) {
    const before = detectPlan(img, { pxPerM: ppm });
    const out = clean(img, ppm);
    const after = detectPlan(out, { pxPerM: ppm });
    const s = sameWalls(before, after);
    const st = out.cleanStats;
    check(`${name}: veggene, dørene og vinduene blir de samme`, s.ok && types(before) === types(after) && !st.greyWalls, `${s.detail}, åpninger ${types(after) === types(before) ? 'de samme' : `${types(before)} → ${types(after)}`}, veggtone ${JSON.stringify(st.wallTone)}${st.colouredWalls?.kept ? ' (fargede vegger beholdt)' : ''}, lysegrå-vegg-steg ${st.greyWalls ? 'på' : 'av'}; som grå: ${sameWalls(det105, before).ok ? 'de samme' : 'andre'}`);
  }

  // a transparent background (a PNG with alpha): composited on white like luma() does, the output is opaque
  const alpha = { width: base.img.width, height: base.img.height, data: new Uint8ClampedArray(base.img.data) };
  for (let i = 0; i < alpha.data.length; i += 4) {
    if (alpha.data[i] >= paper - 2) alpha.data[i] = alpha.data[i + 1] = alpha.data[i + 2] = alpha.data[i + 3] = 0;
  }
  const alphaOut = clean(alpha, ppm);
  const lumaIn = I.luma(alpha).data;
  const lumaOut = I.luma(alphaOut).data;
  let opaque = true;
  let worst = 0;
  for (let i = 0; i < lumaIn.length; i++) {
    if (alphaOut.data[i * 4 + 3] !== 255) opaque = false;
    worst = Math.max(worst, Math.abs(lumaIn[i] - lumaOut[i]));
  }
  check('gjennomsiktig bakgrunn blir hvit og ugjennomsiktig, gråtonene som før', opaque && worst <= 1, `største avvik ${worst}`);
}

// ---------------------------------------------------------------------------------------------------------------
if ('clean' in (DETECT.DETECT_DEFAULTS ?? {})) {
  section('Kroken i detect.js');
  const plans = samplePlans();
  const ppm = 50;
  const base = renderPlan(plans.leilighet, { pxPerM: ppm, paper: 240, seed: 5 });
  const red = recolourInk(base.img, 240, [30, 30, 200]);
  const viaHook = detectPlan(red, { pxPerM: ppm, clean: cleanForWalls });
  const direct = detectPlan(cleanForWalls(red, { pxPerM: ppm }), { pxPerM: ppm });
  const sw = sameWalls(viaHook, direct, 0.01);
  check('detectPlan(img, { clean: cleanForWalls }) gir det samme som å rydde først', sw.ok && viaHook.openings.length === direct.openings.length, sw.detail);
}

// ---------------------------------------------------------------------------------------------------------------
const fixture = readJson('tools/fixtures/clean/plans.json');
const plans = fixture.plans.filter((p) => !only || only.includes(p.id));

/**
 * A photo entry → the straightened image (photo.js, as generate.js runs it) and the entry in its frame: the label
 * points, the house's outer corners → house box and scale (the mean of the four sides against the outer dimensions).
 * null when photo.js does not straighten it.
 */
async function straighten(plan, raw) {
  const P = await importRetry('src/planbygger/photo.js');
  const r = P.rectifyPhoto(raw);
  if (!r.applied || !r.quad) return { why: `photo.js retter ikke opp fotoet (${r.reason ?? 'ukjent grunn'})` };
  const { width: W, height: H } = r.img;
  const Hi = P.solveHomography(r.quad, [[0, 0], [W, 0], [W, H], [0, H]]);
  const map = (p) => P.mapPoint(Hi, p);
  const [nw, ne, se, sw] = plan.photo.corners.map(map);
  const [wM, hM] = plan.photo.size;
  const d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const sides = [d(nw, ne) / wM, d(sw, se) / wM, d(nw, sw) / hM, d(ne, se) / hM];
  const pxPerM = sides.reduce((s, v) => s + v, 0) / 4;
  const xs = [nw, ne, se, sw].map((p) => p[0]);
  const ys = [nw, ne, se, sw].map((p) => p[1]);
  const m = Math.round(0.1 * pxPerM);
  const house = [Math.floor(Math.min(...xs)) - m, Math.floor(Math.min(...ys)) - m, Math.ceil(Math.max(...xs)) + m, Math.ceil(Math.max(...ys)) + m];
  const rooms = plan.rooms.map((e) => ({ ...e, at: e.at.map(map) }));
  return { img: r.img, plan: { ...plan, pxPerM, house, rooms }, detail: `${W}×${H}, ${pxPerM.toFixed(1)} px/m (sidene ${sides.map((v) => v.toFixed(1)).join(', ')})` };
}

/** The wall ink of a plan as drawn (see the top of the file), inside the house box. */
function wallInkMask(img, plan) {
  const { width: w, height: h, data } = img;
  const { luma: [lo, hi], chroma: maxC, close: closeR = 0 } = plan.wallInk;
  const [x0, y0, x1, y1] = plan.house;
  let m = I.raster(w, h);
  for (let y = Math.max(0, y0); y <= Math.min(h - 1, y1); y++) {
    for (let x = Math.max(0, x0); x <= Math.min(w - 1, x1); x++) {
      const i = (y * w + x) * 4;
      const l = lumaAt(data, i);
      if (l >= lo && l <= hi && chromaOf(data, i) <= maxC) m.data[y * w + x] = 1;
    }
  }
  if (closeR) m = I.close(m, closeR);
  const r = Math.max(1, Math.min(4, Math.round((0.06 * plan.pxPerM) / 2 - 0.5)));
  return I.open(m, r);
}

/**
 * Detected walls (minus their openings) as a mask: the bands, each end extended like findRooms does. With inkWide, also
 * per wall the share of its pixels on the wall ink (mask.onInk[index]).
 */
function wallMask(det, w, h, ppm, inkWide = null) {
  const m = I.raster(w, h);
  const onInk = [];
  const k = 1 / ppm;
  const metres = det.walls.map((v) => ({ a: [v.a[0] * k, v.a[1] * k], b: [v.b[0] * k, v.b[1] * k], t: v.t * k }));
  det.walls.forEach((v, idx) => {
    const ext = endExtensions(metres[idx], metres);
    const along = v.axis === 'h' ? 0 : 1;
    const s0 = Math.min(v.a[along], v.b[along]);
    const L = Math.abs(v.b[along] - v.a[along]);
    const c = v.axis === 'h' ? v.a[1] : v.a[0];
    const holes = det.openings.filter((o) => o.wall === idx).map((o) => [o.from, o.to]);
    let all = 0;
    let on = 0;
    for (let s = Math.floor(s0 - ext.a * ppm); s <= Math.ceil(s0 + L + ext.b * ppm); s++) {
      const rel = s + 0.5 - s0;
      if (holes.some(([f, t]) => rel > f && rel < t)) continue;
      for (let q = Math.floor(c - v.t / 2); q < Math.ceil(c + v.t / 2); q++) {
        const [x, y] = v.axis === 'h' ? [s, q] : [q, s];
        if (x >= 0 && y >= 0 && x < w && y < h) {
          m.data[y * w + x] = 1;
          all++;
          if (inkWide?.data[y * w + x]) on++;
        }
      }
    }
    onInk.push(all ? on / all : 0);
  });
  m.onInk = onInk;
  return m;
}

/** detectPlan + findRooms on one image, scored against the plan's fixture. */
function measure(img, plan, ink, inkWide, callouts = null) {
  const ppm = plan.pxPerM;
  const t0 = Date.now();
  const det = detectPlan(img, { pxPerM: ppm });
  const ms = Date.now() - t0;
  const k = 1 / ppm;
  const walls = det.walls.map((v, i) => ({ id: `w${i}`, a: [v.a[0] * k, v.a[1] * k], b: [v.b[0] * k, v.b[1] * k], t: v.t * k }));
  const R = findRooms(walls);
  // rooms: each entry's label points in one room of its own, with the printed area
  const hits = plan.rooms.map((e) => e.at.map(([x, y]) => R.at(x * k, y * k)));
  const roomWhy = plan.rooms.map((e, j) => {
    const ids = hits[j];
    if (ids[0] < 0) return 'intet rom';
    if (ids.some((r) => r !== ids[0])) return 'delt';
    const other = plan.rooms.find((_, jj) => jj !== j && hits[jj].includes(ids[0]));
    if (other) return `sammen med ${other.name}`;
    const area = R.rooms[ids[0]].area;
    if (e.area != null && Math.abs(area / e.area - 1) > 0.15) return `${area.toFixed(1)} m²`;
    return '';
  });
  const roomOk = roomWhy.map((why) => why === '');
  const roomArea = hits.map((ids) => (ids[0] >= 0 ? R.rooms[ids[0]].area : null));
  // walls against the ink
  const D = wallMask(det, img.width, img.height, ppm, inkWide);
  // openings in real walls (mostly on the wall ink): on a plan whose walls were not found, the doors and windows of the
  // furniture taken for walls do not count
  const real = (o) => D.onInk[o.wall] >= 0.5;
  const Dw = I.dilate(D, 2);
  let inkN = 0;
  let inkHit = 0;
  let dN = 0;
  let dOn = 0;
  let onCallouts = 0;
  for (let i = 0; i < D.data.length; i++) {
    if (callouts && D.data[i] && callouts.data[i]) onCallouts++;
    if (ink.data[i]) {
      inkN++;
      if (Dw.data[i]) inkHit++;
    }
    if (D.data[i]) {
      dN++;
      if (inkWide.data[i]) dOn++;
    }
  }
  return {
    ms,
    walls: walls.length,
    openings: det.openings.length,
    rooms: R.rooms.filter((r) => r.area >= 1).length,
    roomsOk: roomOk.filter(Boolean).length,
    roomOk,
    roomWhy,
    roomArea,
    doors: det.openings.filter((o) => o.type === 'door').length,
    windows: det.openings.filter((o) => o.type === 'window').length,
    realDoors: det.openings.filter((o) => o.type === 'door' && real(o)).length,
    realWindows: det.openings.filter((o) => o.type === 'window' && real(o)).length,
    recall: inkN ? inkHit / inkN : 0,
    precision: dN ? dOn / dN : 0,
    falseM2: (dN - dOn) / (ppm * ppm),
    calloutM2: onCallouts / (ppm * ppm),
    tone: det.stats.autoWallTone ?? det.stats.wallTone ?? null,
  };
}

section('Ekte planer: hva ryddingen gjør med bildet');
const loaded = [];
for (const entry of plans) {
  let img = readPng(path.join(ROOT, entry.file));
  let plan = entry;
  if (entry.photo) {
    const s = await straighten(entry, img);
    if (!s.img) {
      console.log(`  ${entry.id.padEnd(11)} hoppet over: ${s.why}`);
      continue;
    }
    console.log(`  ${entry.id.padEnd(11)} rettet opp med photo.js: ${s.detail}`);
    img = s.img;
    plan = s.plan;
  }
  const t0 = Date.now();
  const out = clean(img, plan.pxPerM);
  const ms = Date.now() - t0;
  const same = sameBytes(out, img);
  loaded.push({ plan, img, out, same, ms });
  const st = out.cleanStats;
  const parts = [
    st.colour?.changed ? `farge ${st.colour.changed}${st.colour.inpainted ? ` (${st.colour.inpainted} fylt inn)` : ''}${st.colour.guard ? ' (vern: fargen er blekket)' : ''}` : '',
    st.darkFurniture?.changed ? `mørke møbler ${st.darkFurniture.changed}` : '',
    st.lightFills?.changed ? `lyse gulv ${st.lightFills.changed}` : '',
    st.hatchedWalls?.changed ? `skraverte vegger ${st.hatchedWalls.changed}` : '',
    st.hatch?.changed ? `skravur ${st.hatch.changed}` : '',
  ].filter(Boolean);
  const what = same ? 'uendret' : `${parts.join(', ')} px`;
  const mp = (img.width * img.height) / 1e6;
  const extra = [st.cast ? `fargestikk ${st.cast}` : '', st.colouredWalls?.kept ? `fargede vegger ${JSON.stringify(st.colouredWalls.tone)} beholdt` : ''].filter(Boolean).join(', ');
  console.log(`  ${plan.id.padEnd(11)} ${plan.style.padEnd(20)} ${mp.toFixed(1).padStart(4)} MP ${String(ms).padStart(5)} ms  veggtone ${JSON.stringify(st.wallTone).padEnd(10)} ${what}${extra ? `  [${extra}]` : ''}`);
}
for (const { plan, same } of loaded) {
  if (['hus1-1', 'hus1-2', 'hus5'].includes(plan.id)) check(`${plan.id}: svarte vegger, ingen farge – bildet er uendret (byte for byte)`, same);
}
{
  const h6 = loaded.find((l) => l.plan.id === 'hus6');
  if (h6) {
    const { width: w, height: h } = h6.img;
    let before = 0;
    let after = 0;
    // in luma too: a callout pixel away from the drawing's own ink (3 px) must be paper-light now – where a callout
    // crossed a wall or a window line it is filled in from across, and dark again
    const inkNear = I.raster(w, h);
    for (let i = 0; i < w * h; i++) inkNear.data[i] = chromaOf(h6.img.data, i * 4) < 25 && lumaAt(h6.img.data, i * 4) < 170 ? 1 : 0;
    const near = I.dilate(inkNear, 3);
    let away = 0;
    let dark = 0;
    for (let i = 0; i < w * h; i++) {
      if (chromaOf(h6.img.data, i * 4) >= 60) {
        before++;
        if (!near.data[i]) {
          away++;
          if (lumaAt(h6.out.data, i * 4) < 225) dark++;
        }
      }
      if (chromaOf(h6.out.data, i * 4) >= 60) after++;
    }
    check('hus6: de blå forklaringene er borte (ingen mettet piksel igjen)', before > 10000 && after === 0, `${before} → ${after} mettede piksler`);
    check('hus6: … også i gråtone: der det ikke var annet blekk, er de papir', away > 10000 && dark <= 0.002 * away, `${dark} av ${away} forklaringspiksler er fortsatt mørkere enn 225`);
  }
  for (const { plan, img, out } of loaded.filter((l) => l.plan.photo)) {
    // a photo's bluish ink: no wall pixel turns into paper (the colour step would punch holes in the walls)
    const ink = wallInkMask(img, plan);
    let n = 0;
    let holes = 0;
    for (let i = 0; i < ink.data.length; i++) {
      if (!ink.data[i]) continue;
      n++;
      if (lumaAt(out.data, i * 4) >= 150) holes++;
    }
    check(`${plan.id}: fotoets blåstikk gir ingen hull i veggene`, n > 10000 && holes <= 0.002 * n, `${holes} av ${n} veggpiksler er blitt lysere enn 150 (veggkroma ${out.cleanStats.wallChroma}, fargestikk ${out.cleanStats.cast})`);
  }
}

if (!quick) {
  section('Vegger og rom før → etter ryddingen (detectPlan + findRooms)');
  console.log('  plan         rom riktig     veggblekk funnet   på veggblekk      feil vegg (m²)     vegger     dører     vinduer');
  const rows = [];
  for (const { plan, img, out, same } of loaded) {
    const ink = wallInkMask(img, plan);
    const inkWide = I.dilate(ink, 2);
    // the saturated callouts of the original (hus6), 2 px wider: walls found there are the callouts
    let callouts = I.raster(img.width, img.height);
    for (let i = 0; i < callouts.data.length; i++) callouts.data[i] = chromaOf(img.data, i * 4) >= 60 ? 1 : 0;
    callouts = I.dilate(callouts, 2);
    const before = measure(img, plan, ink, inkWide, callouts);
    const after = same ? before : measure(out, plan, ink, inkWide, callouts);
    // hus6: the colour step on its own, against the same cleaning without it
    const noColour = plan.id === 'hus6' && !same ? measure(clean(img, plan.pxPerM, { colour: false }), plan, ink, inkWide, callouts) : null;
    rows.push({ plan, img, before, after, same, noColour });
    const n = plan.rooms.length;
    const arrow = (a, b, fmt, pad = 18) => `${fmt(a)} → ${fmt(b)}`.padEnd(pad);
    const id = (x) => String(x);
    console.log(
      `  ${plan.id.padEnd(11)}  ${`${before.roomsOk}/${n} → ${after.roomsOk}/${n}`.padEnd(14)} ${arrow(before.recall, after.recall, pct)} ${arrow(before.precision, after.precision, pct)} ${arrow(before.falseM2, after.falseM2, f2)} ${arrow(before.walls, after.walls, id, 10)} ${arrow(before.doors, after.doors, id, 9)} ${arrow(before.windows, after.windows, id, 9)}${same ? ' (uendret bilde)' : ''}`,
    );
    if (noColour) console.log(`               uten fargesteget: rom ${noColour.roomsOk}/${n}, funnet ${pct(noColour.recall)}, på veggblekk ${pct(noColour.precision)}, feil vegg ${f2(noColour.falseM2)} m², vegger ${noColour.walls}, dører ${noColour.doors}, vinduer ${noColour.windows}`);
    const missing = plan.rooms.map((e, j) => (after.roomOk[j] ? null : `${e.name} (${after.roomWhy[j]}${before.roomOk[j] ? ', funnet før' : ''})`)).filter(Boolean);
    if (missing.length) console.log(`               ikke riktig etter: ${missing.join(', ')}`);
    if (verbose) console.log(`               arealer etter: ${plan.rooms.map((e, j) => `${e.name} ${after.roomArea[j]?.toFixed(2) ?? '–'}/${e.area ?? '?'}`).join(', ')}`);
    if (verbose) console.log(`               i ekte vegger: dører ${before.realDoors} → ${after.realDoors}, vinduer ${before.realWindows} → ${after.realWindows}; veggtone i detect ${JSON.stringify(before.tone)} → ${JSON.stringify(after.tone)}, ${before.ms} → ${after.ms} ms`);
  }

  section('Krav: aldri verre');
  const f1 = (m) => (m.recall + m.precision ? (2 * m.recall * m.precision) / (m.recall + m.precision) : 0);
  for (const { plan, before, after, same } of rows) {
    if (same) continue;
    const acc = plan.accept ?? {};
    const why = acc.why ? `; godtatt: ${acc.why}` : '';
    check(`${plan.id}: ikke færre riktige rom`, after.roomsOk >= before.roomsOk, `${before.roomsOk} → ${after.roomsOk}`);
    check(`${plan.id}: ingen vegger går tapt`, before.walls === 0 || after.walls > 0, `${before.walls} → ${after.walls} vegger`);
    // relative: a plan whose walls were hardly found before must not lose what little there was
    check(`${plan.id}: veggene ikke dårligere (F1 av funnet og på veggblekk, høyst 3 % lavere)`, f1(after) >= 0.97 * f1(before) - 0.005, `${f2(f1(before))} → ${f2(f1(after))}`);
    const falseMax = acc.falseM2 ?? before.falseM2 + 0.05;
    check(`${plan.id}: ikke mer feil vegg${acc.falseM2 != null ? ` (godtatt opp til ${f2(acc.falseM2)} m²)` : ''}`, after.falseM2 <= falseMax, `${f2(before.falseM2)} → ${f2(after.falseM2)} m²${acc.falseM2 != null ? why : ''}`);
    if (plan.style.startsWith('dark')) {
      // black and dark grey walls: the cleaning must leave the detection as it was
      check(`${plan.id}: mørke vegger – like mye funnet`, after.recall >= before.recall - 0.01, `${pct(before.recall)} → ${pct(after.recall)}`);
      check(`${plan.id}: mørke vegger – like mange dører og vinduer`, after.doors === before.doors && after.windows === before.windows, `dører ${before.doors} → ${after.doors}, vinduer ${before.windows} → ${after.windows}`);
    } else {
      // the doors and windows in real walls (on the wall ink): those in furniture taken for walls before do not count
      const doorsMin = acc.doors ?? before.realDoors;
      const windowsMin = acc.windows ?? before.realWindows;
      const accepted = acc.doors != null || acc.windows != null;
      check(
        `${plan.id}: ikke færre dører og vinduer i ekte vegger${accepted ? ` (godtatt: dører ≥ ${doorsMin}, vinduer ≥ ${windowsMin})` : ''}`,
        after.realDoors >= doorsMin && after.realWindows >= windowsMin,
        `dører ${before.realDoors} → ${after.realDoors}, vinduer ${before.realWindows} → ${after.realWindows} (alle: dører ${before.doors} → ${after.doors}, vinduer ${before.windows} → ${after.windows})${accepted ? why : ''}`,
      );
    }
  }

  section('Krav: der ryddingen skal hjelpe');
  const row = (id) => rows.find((r) => r.plan.id === id);
  const want = (id, name, test, detail) => {
    const r = row(id);
    if (r && !r.same) check(`${id}: ${name}`, test(r.before, r.after, r), detail(r.before, r.after, r));
  };
  // hus6: the callouts are not taken for walls – that comes from the hatched walls being filled (also without the colour
  // step); the colour step on its own is measured against the same cleaning without it
  want('hus6', 'de blå forklaringene blir ikke vegger', (b, a) => b.calloutM2 > 0.1 && a.calloutM2 <= 0.1 * b.calloutM2, (b, a, r) => `vegg på forklaringene ${f2(b.calloutM2)} → ${f2(a.calloutM2)} m² (uten fargesteget ${f2(r.noColour.calloutM2)})`);
  const h6acc = row('hus6')?.plan.accept?.colourFalseM2 ?? 0.05;
  want('hus6', 'fargesteget alene: like mange rom og like mye funnet som uten det', (b, a, r) => a.roomsOk >= r.noColour.roomsOk && a.recall >= r.noColour.recall - 0.01, (b, a, r) => `rom ${r.noColour.roomsOk} → ${a.roomsOk}, funnet ${pct(r.noColour.recall)} → ${pct(a.recall)}`);
  want('hus6', `fargesteget alene: feil vegg høyst +${f2(h6acc)} m² mot uten det`, (b, a, r) => a.falseM2 <= r.noColour.falseM2 + h6acc, (b, a, r) => `${f2(r.noColour.falseM2)} → ${f2(a.falseM2)} m²; godtatt: ${row('hus6').plan.accept?.colourWhy ?? '–'}`);
  want('hus6', 'de skraverte veggene blir funnet', (b, a) => a.recall >= b.recall + 0.25 && a.precision >= 0.8 && a.roomsOk > b.roomsOk, (b, a) => `funnet ${pct(b.recall)} → ${pct(a.recall)}, på veggblekk ${pct(b.precision)} → ${pct(a.precision)}, rom ${b.roomsOk} → ${a.roomsOk}`);
  want('hus4-1', 'gulvskravur og møbler blir ikke vegger', (b, a) => a.falseM2 <= 0.5 * b.falseM2 && a.precision >= 0.9 && a.roomsOk > b.roomsOk, (b, a) => `feil vegg ${f2(b.falseM2)} → ${f2(a.falseM2)} m², på veggblekk ${pct(b.precision)} → ${pct(a.precision)}, rom ${b.roomsOk} → ${a.roomsOk}`);
  want('hus4-2', 'de grå veggene blir funnet', (b, a) => a.recall >= b.recall + 0.3 && a.precision >= 0.8, (b, a) => `funnet ${pct(b.recall)} → ${pct(a.recall)}, på veggblekk ${pct(b.precision)} → ${pct(a.precision)}`);
  want('hus9-under', 'de grå veggene blir funnet (teksturgulv og svarte møbler borte)', (b, a) => a.recall >= b.recall + 0.3 && a.precision >= 0.8 && a.roomsOk > b.roomsOk, (b, a) => `funnet ${pct(b.recall)} → ${pct(a.recall)}, på veggblekk ${pct(b.precision)} → ${pct(a.precision)}, rom ${b.roomsOk} → ${a.roomsOk}`);
  want('hus9-ovre', 'de grå veggene blir funnet', (b, a) => a.recall >= b.recall + 0.3 && a.roomsOk > b.roomsOk, (b, a) => `funnet ${pct(b.recall)} → ${pct(a.recall)}, rom ${b.roomsOk} → ${a.roomsOk}`);
  want('hus9-alt', 'de grå og de påtegnede veggene blir funnet', (b, a) => a.recall >= b.recall + 0.3 && a.roomsOk > b.roomsOk, (b, a) => `funnet ${pct(b.recall)} → ${pct(a.recall)}, rom ${b.roomsOk} → ${a.roomsOk}`);
}

done();
