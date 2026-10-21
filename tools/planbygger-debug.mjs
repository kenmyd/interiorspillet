#!/usr/bin/env node
/**
 * Planbygger debug image: runs the detection on a floor plan and draws walls (red bands, centre line), doors (green
 * arc), windows (blue) and openings (orange) over a faded copy of the plan.
 *
 *   node tools/planbygger-debug.mjs <plan.png> <out.png> [--ppm=51.3] [--mask=core|dark|outside] [--scale=2]
 *
 * Prints the walls and openings in metres.
 */
import { readPng, writePng } from './planbygger-png.mjs';
import { detectPlan } from '../src/planbygger/detect.js';

const args = process.argv.slice(2);
const flag = (k, d) => {
  const a = args.find((x) => x.startsWith(`--${k}=`));
  return a ? a.split('=')[1] : d;
};
const [src, out] = args.filter((a) => !a.startsWith('--'));
if (!src || !out) {
  console.error('bruk: node tools/planbygger-debug.mjs <plan.png> <out.png> [--ppm=51.3] [--mask=core] [--scale=2]');
  process.exit(1);
}
const ppm = Number(flag('ppm', 51.3));
const S = Number(flag('scale', 2));
const img = readPng(src);
const res = detectPlan(img, { pxPerM: ppm });

const W = img.width * S;
const Hh = img.height * S;
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
    let v = 140 + l * 0.45;
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
const line = (p, q, c, a = 1) => {
  const n = Math.ceil(Math.hypot(q[0] - p[0], q[1] - p[1]) * S * 1.5) + 1;
  for (let k = 0; k <= n; k++) plot(p[0] + ((q[0] - p[0]) * k) / n, p[1] + ((q[1] - p[1]) * k) / n, c, a);
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
const COL = { door: [0, 160, 0], window: [0, 90, 230], opening: [240, 140, 0] };
for (const op of res.openings) {
  const w = res.walls[op.wall];
  const d = [w.b[0] - w.a[0], w.b[1] - w.a[1]];
  const L = Math.hypot(...d);
  const u = [d[0] / L, d[1] / L];
  const n = [-u[1], u[0]];
  const P = (s, k = 0) => [w.a[0] + u[0] * s + n[0] * k, w.a[1] + u[1] * s + n[1] * k];
  const c = COL[op.type] ?? [0, 0, 0];
  for (let k = -w.t / 2 - 1; k <= w.t / 2 + 1; k += 0.5 / S) line(P(op.from, k), P(op.to, k), c, 0.6);
  if (op.type === 'door' && op.side) {
    const h = op.hinge === 'start' ? op.from : op.to;
    const dir = op.hinge === 'start' ? 1 : -1;
    const r = op.to - op.from;
    const face = (op.side * w.t) / 2;
    for (let k = 0; k <= 60; k++) {
      const phi = (k / 60) * (Math.PI / 2);
      plot(...P(h + dir * r * Math.cos(phi), face + op.side * r * Math.sin(phi)), c);
    }
    line(P(h, face), P(h, face + op.side * r), c);
  }
}
writePng(out, o);

const m = (v) => (v / ppm).toFixed(2);
console.log(`terskel ${res.stats.darkThreshold}, papir ${res.stats.paper}, blekk ${res.stats.ink}, kjerne r=${res.stats.coreRadius}, minRun ${res.stats.minRun}, ${res.stats.pieces} biter`);
console.log('tider (ms):', Object.entries(res.stats.timings).map(([k, v]) => `${k} ${v.toFixed(0)}`).join(', '));
res.walls.forEach((w, i) => console.log(`vegg ${i}: ${w.axis} (${m(w.a[0])}, ${m(w.a[1])}) → (${m(w.b[0])}, ${m(w.b[1])}) t ${m(w.t)}${w.exterior ? ' yttervegg' : ''}`));
for (const op of res.openings) {
  console.log(`  ${op.type} på vegg ${op.wall}: ${m(op.from)}–${m(op.to)} (bredde ${m(op.to - op.from)})${op.hinge ? ` hengsel ${op.hinge}, side ${op.side}` : ''} score ${op.score.toFixed(2)} ${JSON.stringify(op.symbol)}`);
}
