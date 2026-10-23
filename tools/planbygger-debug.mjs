#!/usr/bin/env node
/**
 * Planbygger debug image: runs the detection on a floor plan and draws walls (red bands, centre line), doors (green
 * arc; a double door two arcs, a sliding door a cyan bar), windows (blue), openings (orange), skylights (violet boxes),
 * stairs (yellow box, the tread and winder lines) and room separators (the dash-dot lines of open zones, magenta) over
 * a faded copy of the plan; with --rooms the rooms as the editor finds them (model.js + regions.js, with the
 * separators) in light colours, and their areas printed.
 *
 *   node tools/planbygger-debug.mjs <plan.png> <out.png> [--ppm=51.3] [--clean] [--mask=core|dark|outside|thin|stairInk]
 *                                   [--scale=2] [--rooms] [--quiet]
 *
 * Prints the walls and openings in metres (unless --quiet), and a one-line summary.
 */
import { readPng, writePng } from './planbygger-png.mjs';
import { detectPlan } from '../src/planbygger/detect.js';
import { createDoc, createLevel, applyDetection } from '../src/planbygger/model.js';
import { findRooms } from '../src/planbygger/regions.js';

const args = process.argv.slice(2);
const flag = (k, d) => {
  const a = args.find((x) => x.startsWith(`--${k}=`));
  return a ? a.split('=')[1] : args.includes(`--${k}`) ? true : d;
};
const [src, out] = args.filter((a) => !a.startsWith('--'));
if (!src || !out) {
  console.error('bruk: node tools/planbygger-debug.mjs <plan.png> <out.png> [--ppm=51.3] [--clean] [--mask=core] [--scale=2] [--quiet]');
  process.exit(1);
}
const ppm = Number(flag('ppm', 51.3));
const S = Number(flag('scale', 2));
const img = readPng(src);
const res = detectPlan(img, { pxPerM: ppm, clean: flag('clean', false) === true });

// (a fractional --scale gives a whole number of pixels)
const W = Math.round(img.width * S);
const Hh = Math.round(img.height * S);
const o = { width: W, height: Hh, data: new Uint8ClampedArray(W * Hh * 4) };
const maskName = flag('mask', '');
const mask = maskName ? res.debug[maskName] : null;
for (let y = 0; y < Hh; y++) {
  for (let x = 0; x < W; x++) {
    const sx = Math.floor(x / S);
    const sy = Math.floor(y / S);
    const j = (sy * img.width + sx) * 4;
    const i = (y * W + x) * 4;
    const l = 0.299 * img.data[j] + 0.587 * img.data[j + 1] + 0.114 * img.data[j + 2];
    const v = 140 + l * 0.45;
    o.data[i] = o.data[i + 1] = o.data[i + 2] = v;
    if (mask && mask.data[sy * img.width + sx]) {
      o.data[i] = 255;
      o.data[i + 1] = 210;
      o.data[i + 2] = 120;
    }
    o.data[i + 3] = 255;
  }
}
const plot = (x, y, c, a = 1) => {
  const xi = Math.round(x * S);
  const yi = Math.round(y * S);
  if (xi < 0 || yi < 0 || xi >= W || yi >= Hh) return;
  const i = (yi * W + xi) * 4;
  for (let k = 0; k < 3; k++) o.data[i + k] = o.data[i + k] * (1 - a) + c[k] * a;
};
const line = (p, q, c, a = 1, dash = 0) => {
  const n = Math.ceil(Math.hypot(q[0] - p[0], q[1] - p[1]) * S * 1.5) + 1;
  for (let k = 0; k <= n; k++) {
    if (dash && Math.floor(k / dash) % 2) continue;
    plot(p[0] + ((q[0] - p[0]) * k) / n, p[1] + ((q[1] - p[1]) * k) / n, c, a);
  }
};
const thick = (p, q, c, w = 2, a = 1, dash = 0) => {
  const d = [q[0] - p[0], q[1] - p[1]];
  const L = Math.hypot(...d) || 1;
  const n = [-d[1] / L, d[0] / L];
  for (let k = -w / 2; k <= w / 2; k += 0.5 / S) line([p[0] + n[0] * k, p[1] + n[1] * k], [q[0] + n[0] * k, q[1] + n[1] * k], c, a, dash);
};
const box = (b, c, w = 1.5) => {
  const [x0, y0, x1, y1] = b;
  thick([x0, y0], [x1, y0], c, w);
  thick([x1, y0], [x1, y1], c, w);
  thick([x1, y1], [x0, y1], c, w);
  thick([x0, y1], [x0, y0], c, w);
};
for (const w of res.walls) {
  const d = [w.b[0] - w.a[0], w.b[1] - w.a[1]];
  const L = Math.hypot(...d);
  const u = [d[0] / L, d[1] / L];
  const n = [-u[1], u[0]];
  const col = w.exterior ? [200, 0, 0] : [230, 60, 160];
  for (let k = -w.t / 2; k <= w.t / 2; k += 0.5 / S) line([w.a[0] + n[0] * k, w.a[1] + n[1] * k], [w.b[0] + n[0] * k, w.b[1] + n[1] * k], col, 0.35);
  line(w.a, w.b, [120, 0, 0]);
}
const COL = { door: [0, 160, 0], sliding: [0, 170, 190], window: [0, 90, 230], opening: [240, 140, 0] };
for (const op of res.openings) {
  const w = res.walls[op.wall];
  const d = [w.b[0] - w.a[0], w.b[1] - w.a[1]];
  const L = Math.hypot(...d);
  const u = [d[0] / L, d[1] / L];
  const n = [-u[1], u[0]];
  const P = (s, k = 0) => [w.a[0] + u[0] * s + n[0] * k, w.a[1] + u[1] * s + n[1] * k];
  const c = op.variant === 'sliding' ? COL.sliding : COL[op.type] ?? [0, 0, 0];
  for (let k = -w.t / 2 - 1; k <= w.t / 2 + 1; k += 0.5 / S) line(P(op.from, k), P(op.to, k), c, 0.6);
  const arc = (h, dir, r) => {
    const face = (op.side * w.t) / 2;
    for (let k = 0; k <= 60; k++) {
      const phi = (k / 60) * (Math.PI / 2);
      plot(...P(h + dir * r * Math.cos(phi), face + op.side * r * Math.sin(phi)), c);
    }
    line(P(h, face), P(h, face + op.side * r), c);
  };
  if (op.type === 'door' && op.variant === 'double' && op.side) {
    arc(op.from, 1, op.leaf ?? (op.to - op.from) / 2);
    arc(op.to, -1, op.leaf2 ?? (op.to - op.from) / 2);
  } else if (op.type === 'door' && op.variant !== 'sliding' && op.side) {
    const h = op.hinge === 'start' ? op.from : op.to;
    arc(h, op.hinge === 'start' ? 1 : -1, op.to - op.from);
  }
}
for (const s of res.skylights || []) box([s.x0, s.y0, s.x1, s.y1], [150, 40, 220], 2);
for (const st of res.stairs || []) {
  box(st.bbox, [230, 180, 0], 2.5);
  for (const l of st.lines || []) thick(l[0], l[1], [200, 120, 0], 1.2);
  if (st.pivot) for (let k = -3; k <= 3; k += 0.5) plot(st.pivot[0] + k, st.pivot[1], [255, 0, 0]), plot(st.pivot[0], st.pivot[1] + k, [255, 0, 0]);
}
// the dashed lines the separator search looked at and turned down (thin, light), the separators (thick)
for (const l of res.debug.separatorLines || []) if (l.why !== 'ok') thick(l.axis === 'h' ? [l.s0, l.c] : [l.c, l.s0], l.axis === 'h' ? [l.s1, l.c] : [l.c, l.s1], [240, 150, 240], 1, 0.8, 4);
for (const s of res.separators || []) thick(s.a, s.b, [220, 0, 220], 2.5, 0.9, 6);
// the rooms: a scanline fill of each polygon (plan metres → pixels), a colour each
const roomLines = [];
if (flag('rooms', false) === true) {
  const doc = createDoc('debug');
  const lv = createLevel(doc, { id: 'hoved', image: { name: 'debug', width: img.width, height: img.height, pxPerM: ppm } });
  applyDetection(lv, res, ppm, doc.settings);
  const found = findRooms(lv.walls, { separators: lv.separators || [] });
  const pal = [[255, 0, 0], [0, 180, 0], [0, 0, 255], [200, 150, 0], [150, 0, 200], [0, 170, 170], [255, 120, 0], [120, 60, 0], [255, 0, 160], [90, 90, 90]];
  found.rooms.forEach((rm, i) => {
    const c = pal[i % pal.length];
    const P = rm.polygon.map((p) => [p[0] * ppm, p[1] * ppm]);
    const ys = P.map((p) => p[1]);
    for (let y = Math.floor(Math.min(...ys) * S); y <= Math.ceil(Math.max(...ys) * S); y++) {
      const yc = (y + 0.5) / S;
      const xs = [];
      for (let a = 0, b = P.length - 1; a < P.length; b = a++) if (P[a][1] > yc !== P[b][1] > yc) xs.push(P[a][0] + ((yc - P[a][1]) / (P[b][1] - P[a][1])) * (P[b][0] - P[a][0]));
      xs.sort((p, q) => p - q);
      for (let k = 0; k + 1 < xs.length; k += 2) for (let x = Math.ceil(xs[k] * S); x <= Math.floor(xs[k + 1] * S); x++) plot(x / S, yc, c, 0.22);
    }
    roomLines.push(`  rom ${i + 1}: ${rm.area.toFixed(2)} m² (punkt inne ${rm.inside.map((v) => (v * ppm).toFixed(0)).join(', ')} px)${rm.edges.some((e) => e.separator) ? ', mot en skillelinje' : ''}`);
  });
}
writePng(out, o);

const m = (v) => (v / ppm).toFixed(2);
const cnt = { single: 0, double: 0, sliding: 0, window: 0, opening: 0 };
for (const op of res.openings) cnt[op.type === 'door' ? op.variant ?? 'single' : op.type]++;
console.log(`${res.walls.length} vegger, dører ${cnt.single}/${cnt.double}/${cnt.sliding} (enkel/dobbel/skyve), ${cnt.window} vinduer, ${cnt.opening} åpninger, ${(res.skylights || []).length} takvinduer, trapper ${(res.stairs || []).map((s) => `${s.kind} ${s.treads}`).join(', ') || 'ingen'}, ${(res.separators || []).length} skillelinjer${roomLines.length ? `, ${roomLines.length} rom` : ''}${res.stats.cleaned ? ', ryddet' : ''}`);
for (const l of roomLines) console.log(l);
if (flag('quiet', false) === true) process.exit(0);
console.log(`terskel ${res.stats.darkThreshold}, papir ${res.stats.paper}, blekk ${res.stats.ink}, kjerne r=${res.stats.coreRadius}, minRun ${res.stats.minRun}, ${res.stats.pieces} biter`);
console.log('tider (ms):', Object.entries(res.stats.timings).map(([k, v]) => `${k} ${v.toFixed(0)}`).join(', '));
res.walls.forEach((w, i) => console.log(`vegg ${i}: ${w.axis} (${m(w.a[0])}, ${m(w.a[1])}) → (${m(w.b[0])}, ${m(w.b[1])}) t ${m(w.t)}${w.exterior ? ' yttervegg' : ''}`));
for (const op of res.openings) {
  console.log(`  ${op.type}${op.variant && op.variant !== 'single' ? ` (${op.variant})` : ''} på vegg ${op.wall}: ${m(op.from)}–${m(op.to)} (bredde ${m(op.to - op.from)})${op.hinge ? ` hengsel ${op.hinge}, side ${op.side}` : ''} score ${op.score.toFixed(2)} ${JSON.stringify(op.symbol)}`);
}
for (const st of res.stairs || []) console.log(`  trapp ${st.kind}: [${st.bbox.map((v) => v.toFixed(0)).join(', ')}] px, akse ${st.axis}, ${st.treads} inntrinn, ${st.flights} løp, ${st.winders} svingtrinn`);
for (const s of res.separators || []) console.log(`  skillelinje (${s.a.map((v) => v.toFixed(0)).join(', ')}) → (${s.b.map((v) => v.toFixed(0)).join(', ')}) px`);
for (const l of res.debug.separatorLines || []) console.log(`  stiplet linje ${l.axis} ${l.c.toFixed(0)}: ${l.s0.toFixed(0)}–${l.s1.toFixed(0)} px → ${l.why}`);
