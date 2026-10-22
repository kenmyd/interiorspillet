import {
  TAU, FONTS, mix, tint, lum, grey, rgba, h01, S, fill, vgrad, ellipse, circle, poly, smoothPath, blob, ridge, fillUnder,
  layer, blurOnto, brush, grain, vignette, both, shuffled, clamp, lerp, createNoise2D, fbm2D, ridged2D, variantOf,
  seedOf, rngFrom, tonal, dots, oval, sprucePath, taperPath, qpt, brushStamp, stampLine, stampAt,
} from './paintkit.js';

/**
 * Paintings, photo prints and botanical – the art motif painters of group B (design/art.md §2.5). Contract and
 * registry: models/artmotifs.js; toolkit: models/art/paintkit.js. Every painter draws all of its random values
 * before it paints (relief motifs replay per-stroke generators from rngFrom on the height canvas), never branches on
 * colours for geometry, and fills the whole canvas first.
 */

const HALF_PI = Math.PI / 2;

/** A thick round-capped stroke (impasto dab). */
function dab(x, x0, y0, x1, y1, w, col, alpha = 1) {
  x.globalAlpha = alpha;
  x.strokeStyle = col;
  x.lineWidth = w;
  x.lineCap = 'round';
  x.beginPath();
  x.moveTo(x0, y0);
  x.lineTo(x1, y1);
  x.stroke();
}

// ---------------------------------------------------------------------------------------------------------------
// Maleri

function colorField(c, W, H, R, p) {
  const s = S(W, H);
  const ground = mix(p[0], p[1], 0.25);
  const gstrokes = Array.from({ length: 80 }, () => {
    const x = R() * W, y = R() * H, L = R.range(0.15, 0.4) * s, a = R.range(-0.2, 0.2);
    return { x0: x - (Math.cos(a) * L) / 2, y0: y - (Math.sin(a) * L) / 2, x1: x + (Math.cos(a) * L) / 2, y1: y + (Math.sin(a) * L) / 2, w: R.range(0.03, 0.09) * s, k: R() < 0.5 ? 0 : 1, t: R.range(-0.08, 0.08), seed: seedOf(R) };
  });
  const n = R.int(2, 3), side = W / H > 1.4;
  const shares = Array.from({ length: n }, () => R.range(0.6, 1.5));
  const order = shuffled(R, [1, 2, 3]);
  const m = 0.07 * s, gap = 0.04 * s;
  const total = (side ? W : H) - 2 * m - gap * (n - 1), sum = shares.reduce((a, b) => a + b, 0);
  let t0 = m;
  const fields = shares.map((sh, i) => {
    const len = (total * sh) / sum;
    const f = side ? { x: t0, y: m, w: len, h: H - 2 * m } : { x: m, y: t0, w: W - 2 * m, h: len };
    t0 += len + gap;
    f.col = order[i];
    f.edges = Array.from({ length: R.int(60, 120) }, () => ({ e: R.int(0, 3), pos: R(), off: R.range(-0.01, 0.01) * s, len: R.range(0.04, 0.14) * s, w: R.range(0.006, 0.018) * s, a: R.range(0.3, 0.6), seed: seedOf(R) }));
    f.inner = Array.from({ length: 40 }, () => ({ x: f.x + R() * f.w, y: f.y + R() * f.h, len: R.range(0.15, 0.45) * f.w, w: R.range(0.02, 0.06) * s, ang: R.range(-0.05, 0.05), t: R.range(-0.08, 0.08), seed: seedOf(R) }));
    return f;
  });

  fill(c, W, H, ground);
  for (const g of gstrokes) brush(c, rngFrom(g.seed), g.x0, g.y0, g.x1, g.y1, g.w, tint(p[g.k], g.t), 0.05, 4);
  const l = layer(W, H);
  for (const f of fields) {
    const col = p[f.col];
    l.x.fillStyle = col;
    l.x.fillRect(f.x, f.y, f.w, f.h);
    for (const e of f.edges) {
      const horiz = e.e < 2;
      const ex = horiz ? f.x + e.pos * f.w : e.e === 2 ? f.x + e.off : f.x + f.w + e.off;
      const ey = horiz ? (e.e === 0 ? f.y + e.off : f.y + f.h + e.off) : f.y + e.pos * f.h;
      const dx = horiz ? e.len / 2 : 0, dy = horiz ? 0 : e.len / 2;
      brush(l.x, rngFrom(e.seed), ex - dx, ey - dy, ex + dx, ey + dy, e.w, col, e.a, 2);
    }
    for (const q of f.inner) {
      const dx = (Math.cos(q.ang) * q.len) / 2, dy = (Math.sin(q.ang) * q.len) / 2;
      brush(l.x, rngFrom(q.seed), q.x - dx, q.y - dy, q.x + dx, q.y + dy, q.w, tint(col, q.t), 0.08, 4);
    }
  }
  blurOnto(c, l, 0.004 * s);
  blurOnto(c, l, 0, 0.55);
  grain(c, W, H, R, 0.05);
}

/** Brush stamps: stamps[colour][shape] from brushStamp (models/art/paintkit.js); w × h in px. */
function stampSet(seeds, cols, w, h, opts) {
  return cols.map((col) => seeds.map((sd) => brushStamp(sd, w, h, col, opts)));
}
/** A stroke centred at (x, y) with angle a and length L as [x0, y0, x1, y1]. */
const seg = (x, y, a, L) => [x - (Math.cos(a) * L) / 2, y - (Math.sin(a) * L) / 2, x + (Math.cos(a) * L) / 2, y + (Math.sin(a) * L) / 2];

function brushAbstract(c, W, H, R, p, o) {
  const s = S(W, H);
  const v = variantOf(R, o, ['diagonal', 'horizon', 'centre']);
  const shapes = [seedOf(R), seedOf(R)];
  const at = (spread) => {
    if (v === 'diagonal') {
      const t = R.range(-0.08, 1.08), off = R.gauss() * spread * s;
      return [lerp(0.06, 0.94, t) * W + off * 0.707, lerp(0.94, 0.06, t) * H + off * 0.707];
    }
    if (v === 'horizon') return [R.range(-0.08, 1.08) * W, H * 0.56 + R.gauss() * spread * 0.7 * s];
    const a = R() * TAU, r = Math.pow(R(), 0.6) * (0.25 + spread) * s;
    return [W / 2 + Math.cos(a) * r * 1.15, H / 2 + Math.sin(a) * r];
  };
  const angle = () => (v === 'diagonal' ? -0.78 + R.range(-0.45, 0.45) : v === 'horizon' ? R.range(-0.2, 0.2) : R.range(-1.3, 1.3));
  const strokes = [];
  // [count, width, length, colour indices, alpha, height, spread]
  const add = (count, wr, lr, cols, ar, h, spread) => {
    for (let i = 0; i < count; i++) {
      const [x, y] = at(spread), a = angle(), L = R.range(lr[0], lr[1]) * s;
      strokes.push({ q: seg(x, y, a, L), w: R.range(wr[0], wr[1]) * s, ci: R.pick(cols), alpha: R.range(ar[0], ar[1]), h: h + R.range(-0.08, 0.08), si: R.int(0, 1), flip: R() < 0.5 });
    }
  };
  add(13, [0.16, 0.28], [0.55, 1], [4, 2, 0, 5], [0.25, 0.42], 0.46, 0.45);
  add(56, [0.05, 0.11], [0.3, 0.7], [1, 2, 1, 5, 6], [0.65, 0.92], 0.56, 0.26);
  add(20, [0.02, 0.04], [0.18, 0.45], [3], [0.6, 0.88], 0.66, 0.16);
  add(12, [0.02, 0.045], [0.15, 0.35], [4, 0, 7], [0.65, 0.9], 0.74, 0.18);
  const scrapes = Array.from({ length: R.int(2, 4) }, () => {
    const [x, y] = at(0.15);
    return seg(x, y, angle(), R.range(0.3, 0.7) * s);
  });
  const P = p.mono ? tonal(p) : p;
  const cols = [P[0], P[1], P[2], P[3], P[4], mix(P[1], P[2], 0.5), tint(P[1], -0.12), tint(P[4], 0.25)];
  const sw = 0.6 * s, sh = 0.1 * s;

  fill(c, W, H, P[0]);
  const st = stampSet(shapes, cols, sw, sh, { streaks: 14, dry: 0.3, taper: 0.14 });
  for (const k of strokes) stampLine(c, st[k.ci][k.si], ...k.q, k.w, k.alpha, k.flip);
  c.globalAlpha = 0.5;
  c.strokeStyle = P[0];
  c.lineWidth = 0.005 * s;
  c.lineCap = 'round';
  c.beginPath();
  for (const q of scrapes) {
    c.moveTo(q[0], q[1]);
    c.lineTo(q[2], q[3]);
  }
  c.stroke();
  c.globalAlpha = 1;
  if (o.hc) {
    // heights: the same strokes as grey stamps (three levels)
    fill(o.hc, W, H, h01(0.42));
    const lv = [0.5, 0.62, 0.76];
    const hs = stampSet(shapes, lv.map(h01), sw, sh, { streaks: 14, dry: 0.3, taper: 0.14 });
    for (const k of strokes) stampLine(o.hc, hs[k.h < 0.56 ? 0 : k.h < 0.69 ? 1 : 2][k.si], ...k.q, k.w, 0.7, k.flip);
    o.hc.globalAlpha = 0.8;
    o.hc.strokeStyle = h01(0.3);
    o.hc.lineWidth = 0.006 * s;
    o.hc.beginPath();
    for (const q of scrapes) {
      o.hc.moveTo(q[0], q[1]);
      o.hc.lineTo(q[2], q[3]);
    }
    o.hc.stroke();
    o.hc.globalAlpha = 1;
  }
  grain(c, W, H, R, 0.05);
}

function expressionist(c, W, H, R, p, o) {
  const s = S(W, H);
  const v = variantOf(R, o, ['abstract', 'flowers']);
  const shapes = [seedOf(R), seedOf(R)], knifeSeed = seedOf(R);
  // ground: broad strokes over the whole canvas
  const gn = Math.ceil((W / s) * (H / s) * 30), gcol = Math.ceil(Math.sqrt(gn * W / H)), grow = Math.ceil(gn / gcol);
  const ground = Array.from({ length: gcol * grow }, (_, i) => {
    const a = R.range(-0.5, 0.5) + (R() < 0.3 ? HALF_PI : 0);
    return { q: seg(((i % gcol) + R()) / gcol * W, (Math.floor(i / gcol) + R()) / grow * H, a, R.range(0.25, 0.45) * s), w: R.range(0.1, 0.16) * s, ci: R.pick([0, 9, 7, 13, 9]), si: R.int(0, 1), flip: R() < 0.5, alpha: R.range(0.7, 0.92) };
  });
  const marks = [], knives = [], heads = [], dark = [];
  // the masses sit on a jittered grid, so the paint covers the canvas
  const nm = R.int(7, 10), gc = W >= H ? Math.ceil(Math.sqrt(nm * W / H)) : Math.ceil(Math.sqrt(nm)), gr = Math.ceil(nm / gc);
  for (let k = 0; k < nm; k++) {
    const cx = ((k % gc) + R.range(0.2, 0.8)) / gc * W, cy = (Math.floor(k / gc) + R.range(0.2, 0.8)) / gr * H;
    const ma = R() * Math.PI, rad = R.range(0.13, 0.24) * s, pair = [R.int(1, 8), R.int(1, 8)];
    for (let i = 0, n = R.int(14, 22); i < n; i++) {
      const r = Math.sqrt(R()) * rad, aa = R() * TAU;
      marks.push({ q: seg(cx + Math.cos(aa) * r, cy + Math.sin(aa) * r * 0.85, ma + R.range(-0.6, 0.6), R.range(0.14, 0.26) * s), w: R.range(0.06, 0.1) * s, ci: R.pick(pair), si: R.int(0, 1), flip: R() < 0.5, alpha: R.range(0.8, 0.97), h: R.range(0.66, 0.86) });
    }
  }
  for (let i = 0; i < 14; i++) knives.push({ q: seg(R.range(0.06, 0.94) * W, R.range(0.06, 0.94) * H, R() * Math.PI, R.range(0.08, 0.14) * s), w: R.range(0.04, 0.07) * s, ci: R.pick([0, 4, 7]), alpha: R.range(0.75, 0.9) });
  // flowers: a bouquet in a jar
  const nh = R.int(5, 9);
  const jar = { x: W / 2 + R.range(-0.04, 0.04) * s, w: R.range(0.16, 0.2) * s, h: R.range(0.24, 0.3) * s, kind: R.pick(['amphora', 'bowl', 'cylinder']) };
  for (let k = 0; k < nh; k++) {
    const hx = W / 2 + R.range(-0.28, 0.28) * s, hy = H / 2 + R.range(-0.32, 0.0) * s, hr = R.range(0.085, 0.13) * s;
    const pc = [R.pick([1, 4, 2, 6]), R.pick([1, 4, 7])];
    const petals = Array.from({ length: R.int(12, 18) }, () => ({ a: R() * TAU, l: R.range(0.7, 1.1), w: R.range(0.3, 0.45), c: R() < 0.7 ? 0 : 1, si: R.int(0, 1) }));
    heads.push({ hx, hy, hr, pc, petals, bend: R.range(-0.12, 0.12) * s, leaf: [R.range(0.3, 0.7), R.sign(), R.range(0.06, 0.1) * s] });
  }
  heads.sort((a, b) => a.hy - b.hy);
  for (let i = 0; i < 34; i++) {
    const a = R() * TAU, r = Math.sqrt(R()) * 0.42 * s;
    dark.push({ q: seg(W / 2 + Math.cos(a) * r, H * 0.42 + Math.sin(a) * r * 0.9, R.range(-1.2, 1.2), R.range(0.15, 0.3) * s), w: R.range(0.07, 0.13) * s, ci: R.pick([10, 11]), si: R.int(0, 1), flip: R() < 0.5, alpha: R.range(0.35, 0.6) });
  }
  const jarMarks = Array.from({ length: 12 }, () => [R.range(-0.9, 0.9), R.range(0.05, 0.95), R.range(0.25, 0.5), R.int(0, 1)]);
  const P = p.mono ? tonal(p) : p;
  const stemCol = mix(P[3], '#4f6b3a', 0.6);
  const cols = [P[0], P[1], P[2], P[3], P[4], mix(P[1], P[2], 0.5), tint(P[1], 0.18), mix(P[4], P[0], 0.35), mix(P[3], P[1], 0.4), mix(P[0], P[2], 0.35), mix(P[0], P[3], 0.35), mix(P[2], P[3], 0.45), stemCol, tint(P[0], -0.06)];
  const sw = 0.3 * s, sh = 0.075 * s;
  const jarTop = H * 0.97 - jar.h;

  fill(c, W, H, P[0]);
  if (o.hc) fill(o.hc, W, H, h01(0.4));
  const st = stampSet(shapes, cols, sw, sh, { streaks: 9, dry: 0.25 });
  const kn = stampSet([knifeSeed], [cols[0], cols[4], cols[7]], sw * 0.6, sh * 1.2, { streaks: 5, dry: 0.15, taper: 0.06 });
  const hs = o.hc ? stampSet(shapes, [0.5, 0.66, 0.8, 0.9].map(h01), sw, sh, { streaks: 9, dry: 0.25 }) : null;
  const hOf = (h) => (h < 0.58 ? 0 : h < 0.73 ? 1 : h < 0.85 ? 2 : 3);
  for (const g of ground) stampLine(c, st[g.ci][g.si], ...g.q, g.w, g.alpha, g.flip);
  if (o.hc) for (const g of ground) stampLine(o.hc, hs[0][g.si], ...g.q, g.w, 0.5, g.flip);
  if (v === 'flowers') {
    for (const d of dark) stampLine(c, st[d.ci][d.si], ...d.q, d.w, d.alpha, d.flip);
    // stems from the jar mouth to the heads, then a leaf each
    c.strokeStyle = stemCol;
    c.lineCap = 'round';
    c.lineWidth = 0.013 * s;
    c.beginPath();
    for (const hd of heads) {
      c.moveTo(hd.hx, hd.hy);
      c.quadraticCurveTo(hd.hx + hd.bend, (hd.hy + jarTop) / 2, jar.x + (hd.hx - jar.x) * 0.15, jarTop + 0.02 * s);
    }
    c.stroke();
    for (const hd of heads) {
      const [lx, ly] = qpt([hd.hx, hd.hy], [hd.hx + hd.bend, (hd.hy + jarTop) / 2], [jar.x, jarTop], hd.leaf[0]);
      stampLine(c, st[12][0], lx, ly, lx + hd.leaf[1] * hd.leaf[2], ly - hd.leaf[2] * 0.4, 0.035 * s, 0.95);
    }
    c.fillStyle = cols[8];
    vasePath(c, VASES[jar.kind], jar.x, H * 0.97, jar.w, jar.h);
    c.fill();
    c.save();
    vasePath(c, VASES[jar.kind], jar.x, H * 0.97, jar.w, jar.h);
    c.clip();
    for (const [u, t, w, si] of jarMarks) stampLine(c, st[u < 0 ? 3 : 6][si], jar.x + u * jar.w, H * 0.97 - t * jar.h - 0.06 * s, jar.x + u * jar.w * 0.9, H * 0.97 - t * jar.h + 0.06 * s, w * jar.w, 0.5);
    c.restore();
    for (const hd of heads) {
      for (const pt of hd.petals) {
        const x0 = hd.hx + Math.cos(pt.a) * hd.hr * 0.15, y0 = hd.hy + Math.sin(pt.a) * hd.hr * 0.15;
        stampLine(c, st[hd.pc[pt.c]][pt.si], x0, y0, hd.hx + Math.cos(pt.a) * hd.hr * pt.l, hd.hy + Math.sin(pt.a) * hd.hr * pt.l, hd.hr * pt.w, 0.95);
      }
      c.fillStyle = P[3];
      circle(c, hd.hx, hd.hy, hd.hr * 0.24);
    }
    if (o.hc) {
      const x = o.hc;
      x.strokeStyle = h01(0.62);
      x.lineCap = 'round';
      x.lineWidth = 0.013 * s;
      x.beginPath();
      for (const hd of heads) {
        x.moveTo(hd.hx, hd.hy);
        x.quadraticCurveTo(hd.hx + hd.bend, (hd.hy + jarTop) / 2, jar.x + (hd.hx - jar.x) * 0.15, jarTop + 0.02 * s);
      }
      x.stroke();
      x.fillStyle = h01(0.6);
      vasePath(x, VASES[jar.kind], jar.x, H * 0.97, jar.w, jar.h);
      x.fill();
      for (const hd of heads) {
        for (const pt of hd.petals) {
          stampLine(x, hs[2][pt.si], hd.hx + Math.cos(pt.a) * hd.hr * 0.15, hd.hy + Math.sin(pt.a) * hd.hr * 0.15, hd.hx + Math.cos(pt.a) * hd.hr * pt.l, hd.hy + Math.sin(pt.a) * hd.hr * pt.l, hd.hr * pt.w, 0.9);
        }
        x.fillStyle = h01(0.95);
        circle(x, hd.hx, hd.hy, hd.hr * 0.24);
      }
    }
  } else {
    for (const m of marks) stampLine(c, st[m.ci][m.si], ...m.q, m.w, m.alpha, m.flip);
    for (const k of knives) stampLine(c, kn[[0, 4, 7].indexOf(k.ci)][0], ...k.q, k.w, k.alpha);
    if (o.hc) {
      for (const m of marks) stampLine(o.hc, hs[hOf(m.h)][m.si], ...m.q, m.w, 0.85, m.flip);
      const hk = stampSet([knifeSeed], [h01(0.85)], sw * 0.6, sh * 1.2, { streaks: 5, dry: 0.15, taper: 0.06 })[0][0];
      for (const k of knives) stampLine(o.hc, hk, ...k.q, k.w, 0.9);
    }
  }
  grain(c, W, H, R, 0.05);
}

/** Spiral rosette points: from the centre out over `turns` to radius rr with a wobble; ph = π gives the groove half a
 *  turn behind the ridge (between its turns). */
function spiralPts(t, ph = 0) {
  const n = Math.max(24, Math.round(t.turns * 44)), pts = [];
  for (let i = 0; i <= n; i++) {
    const u = i / n, th = t.a0 + t.dirn * (u * t.turns * TAU + ph);
    const wf = u * (t.wob.length - 1), wi = Math.min(t.wob.length - 2, Math.floor(wf)), wob = t.wob[wi] + (t.wob[wi + 1] - t.wob[wi]) * (wf - wi);
    const r = t.rr * Math.pow(u, 0.92) * (1 + wob);
    pts.push([t.cx + Math.cos(th) * r, t.cy + Math.sin(th) * r]);
  }
  return pts;
}

function texturePlaster(c, W, H, R, p, o) {
  const s = S(W, H);
  const v0 = variantOf(R, o, ['scrape', 'concrete', 'waves', 'maze', 'dots']);
  // 'swirls' (Bohus Menor) only on request: the random pick stays among the first five
  const v = o && o.variant === 'swirls' ? 'swirls' : v0;
  const mott = Array.from({ length: 30 }, () => [R() * W, R() * H, R.range(0.1, 0.3) * s, R.range(0.1, 0.3) * s, R() * TAU, R() < 0.5 ? 0 : 2, R.range(0.12, 0.22)]);
  const light = [R.range(-0.3, 0.3), R.range(0.08, 0.14)];
  const d = {};
  if (v === 'scrape') {
    // trowel sweeps: fan-shaped patches laid over each other; each leaves a raised ridge along its outer edge
    const gn = Math.ceil((W / s) * (H / s) * 26), gcol = Math.ceil(Math.sqrt(gn * W / H)), grow = Math.ceil(gn / gcol);
    d.arcs = Array.from({ length: gcol * grow }, (_, i) => {
      const r = R.range(0.12, 0.3) * s, a0 = R() * TAU;
      return { x: ((i % gcol) + R()) / gcol * W, y: (Math.floor(i / gcol) + R()) / grow * H, r, a0, sw: R.range(0.7, 1.5), w: R.range(0.5, 0.8), t: R.range(-0.035, 0.045), h: R.range(0.42, 0.58) };
    });
    d.arcs.sort((a, b) => a.y - b.y);
  } else if (v === 'concrete') {
    const horiz = R() < 0.5, seams = R.int(1, 2);
    d.seams = Array.from({ length: seams }, (_, i) => ((i + 1) / (seams + 1)) * (horiz ? H : W) + R.range(-0.05, 0.05) * s);
    d.horiz = horiz;
    const gx = W >= H ? 3 : 2, gy = W >= H ? 2 : 3;
    d.ties = [];
    for (let j = 0; j < gy; j++) for (let i = 0; i < gx; i++) d.ties.push([((i + 0.5) / gx) * W + R.range(-0.01, 0.01) * s, ((j + 0.5) / gy) * H + R.range(-0.01, 0.01) * s]);
    d.pores = Array.from({ length: 260 }, () => [R() * W, R() * H, R.range(0.0015, 0.005) * s]);
    d.specks = Array.from({ length: 300 }, () => [R() * W, R() * H, R.range(0.001, 0.0025) * s, R() < 0.5]);
    d.cracks = Array.from({ length: 3 }, () => {
      let x = R() * W, y = R() * H, a = R() * TAU;
      const pts = [[x, y]];
      for (let k = 0; k < 9; k++) {
        a += R.range(-0.6, 0.6);
        const L = R.range(0.015, 0.045) * s;
        x += Math.cos(a) * L;
        y += Math.sin(a) * L;
        pts.push([x, y]);
      }
      return pts;
    });
  } else if (v === 'waves') {
    const sp = R.range(0.045, 0.06) * s, n = Math.ceil(H / sp) + 3;
    const k = (R.range(1.5, 3.5) * TAU) / s, A = R.range(0.015, 0.035) * s, ph = R() * TAU;
    d.bands = Array.from({ length: n }, (_, i) => ({ y: (i - 1) * sp, ph: ph + i * R.range(0.1, 0.35), A: A * R.range(0.85, 1.15) }));
    d.k = k;
    d.A0 = A;
  } else if (v === 'maze') {
    const nS = R.int(9, 14), cell = s / nS, nx = Math.max(2, Math.round(W / cell)), ny = Math.max(2, Math.round(H / cell));
    const cw = W / nx, ch = H / ny;
    const right = new Uint8Array(nx * ny).fill(1), down = new Uint8Array(nx * ny).fill(1), seen = new Uint8Array(nx * ny);
    const stack = [R.int(0, nx * ny - 1)];
    seen[stack[0]] = 1;
    while (stack.length) {
      const cur = stack[stack.length - 1], cx = cur % nx, cy = (cur - cx) / nx;
      const nb = [];
      if (cx > 0 && !seen[cur - 1]) nb.push(cur - 1);
      if (cx < nx - 1 && !seen[cur + 1]) nb.push(cur + 1);
      if (cy > 0 && !seen[cur - nx]) nb.push(cur - nx);
      if (cy < ny - 1 && !seen[cur + nx]) nb.push(cur + nx);
      if (!nb.length) {
        stack.pop();
        continue;
      }
      const nxt = nb[Math.floor(R() * nb.length)];
      if (nxt === cur + 1) right[cur] = 0;
      else if (nxt === cur - 1) right[nxt] = 0;
      else if (nxt === cur + nx) down[cur] = 0;
      else down[nxt] = 0;
      seen[nxt] = 1;
      stack.push(nxt);
    }
    d.walls = [];
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const id = j * nx + i;
        if (right[id] && i < nx - 1) d.walls.push([(i + 1) * cw, j * ch, (i + 1) * cw, (j + 1) * ch]);
        if (down[id] && j < ny - 1) d.walls.push([i * cw, (j + 1) * ch, (i + 1) * cw, (j + 1) * ch]);
      }
    }
  } else if (v === 'swirls') {
    // raised panels in a grid (2 × 4 on a portrait canvas), each with a spiral rosette
    const m = 0.09 * s, cell = 0.36 * s;
    const cols = Math.max(1, Math.round((W - 2 * m) / cell)), rows = Math.max(1, Math.round((H - 2 * m) / cell));
    const cw = (W - 2 * m) / cols, ch = (H - 2 * m) / rows, r0 = Math.min(cw, ch);
    d.gap = 0.014 * s;
    d.tiles = [];
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const x = m + i * cw, y = m + j * ch;
        d.tiles.push({
          x, y, w: cw, h: ch, cx: x + cw / 2 + R.range(-0.04, 0.04) * r0, cy: y + ch / 2 + R.range(-0.04, 0.04) * r0,
          turns: R.range(1.7, 2.6), a0: R() * TAU, dirn: R.sign(), rr: r0 * R.range(0.32, 0.39), lw: r0 * R.range(0.05, 0.075),
          wob: Array.from({ length: 6 }, () => R.range(-0.09, 0.09)), corner: Array.from({ length: 8 }, () => R.range(-0.01, 0.01) * s),
          wash: [R.range(-0.18, 0.18) * r0, R.range(-0.18, 0.18) * r0, R.range(0.35, 0.5) * r0, R.range(0.6, 0.9)],
          cracks: Array.from({ length: R.int(5, 9) }, () => [R.range(0.15, 1), R.range(-0.6, 0.6), R.range(0.6, 1.2)]),
        });
      }
    }
  } else {
    const sp = 0.056 * s, rh = sp * 0.866;
    d.dots = [];
    for (let j = 0, y = rh / 2; y < H + sp; j++, y += rh) {
      for (let x = (j % 2 ? sp / 2 : 0) + sp / 4; x < W + sp; x += sp) d.dots.push([x + R.range(-0.004, 0.004) * s, y + R.range(-0.004, 0.004) * s, 0.017 * s * R.range(0.85, 1.1)]);
    }
  }
  const P = p.mono ? tonal(p) : p;
  const hi = P[4], lo = P[3];

  fill(c, W, H, P[1]);
  const l = layer(W, H);
  for (const [x, y, rx, ry, rot, k, a] of mott) {
    l.x.globalAlpha = a;
    l.x.fillStyle = k ? lo : P[0];
    ellipse(l.x, x, y, rx, ry, rot);
  }
  blurOnto(c, l, 0.02 * s, 0.75);
  // light falls across the piece: a soft gradient, light at one side
  const lg = c.createLinearGradient(W * (0.5 - 0.5 + light[0]), 0, W * (0.5 + 0.5 + light[0]), H);
  lg.addColorStop(0, rgba(hi, light[1]));
  lg.addColorStop(1, rgba(lo, light[1] * 1.2));
  c.fillStyle = lg;
  c.fillRect(0, 0, W, H);
  if (o.hc) fill(o.hc, W, H, h01(0.45));
  // the colour pass shows the structure as a soft emboss (shadow below right, light above left); the height pass
  // carries the relief
  const ems = 0.0035 * s;
  both(c, o.hc, (x, isH) => {
    x.lineCap = 'round';
    x.lineJoin = 'round';
    if (v === 'scrape') {
      x.lineCap = 'round';
      for (const a of d.arcs) {
        // the patch: an annular sector from r·(1 − w) to r
        const r0 = a.r * (1 - a.w);
        x.globalAlpha = isH ? 1 : 0.92;
        x.fillStyle = isH ? h01(a.h) : tint(P[1], a.t);
        x.beginPath();
        x.arc(a.x, a.y, a.r, a.a0, a.a0 + a.sw);
        x.arc(a.x, a.y, r0, a.a0 + a.sw, a.a0, true);
        x.closePath();
        x.fill();
        x.lineWidth = 0.007 * s;
        if (isH) {
          x.strokeStyle = h01(a.h + 0.24);
          x.beginPath();
          x.arc(a.x, a.y, a.r, a.a0 + 0.04, a.a0 + a.sw - 0.04);
          x.stroke();
        } else {
          x.globalAlpha = 0.55;
          x.strokeStyle = lo;
          x.beginPath();
          x.arc(a.x + ems, a.y + ems, a.r + 0.002 * s, a.a0 + 0.04, a.a0 + a.sw - 0.04);
          x.stroke();
          x.globalAlpha = 0.85;
          x.strokeStyle = hi;
          x.lineWidth = 0.004 * s;
          x.beginPath();
          x.arc(a.x, a.y, a.r - 0.002 * s, a.a0 + 0.04, a.a0 + a.sw - 0.04);
          x.stroke();
        }
      }
    } else if (v === 'concrete') {
      // formwork seams and tie holes
      x.globalAlpha = isH ? 1 : 0.4;
      x.strokeStyle = isH ? h01(0.3) : lo;
      x.lineWidth = 0.004 * s;
      x.beginPath();
      for (const q of d.seams) {
        if (d.horiz) {
          x.moveTo(0, q);
          x.lineTo(W, q);
        } else {
          x.moveTo(q, 0);
          x.lineTo(q, H);
        }
      }
      x.stroke();
      if (!isH) {
        x.globalAlpha = 0.6;
        x.strokeStyle = hi;
        x.lineWidth = 0.002 * s;
        x.beginPath();
        for (const q of d.seams) {
          if (d.horiz) {
            x.moveTo(0, q + 0.003 * s);
            x.lineTo(W, q + 0.003 * s);
          } else {
            x.moveTo(q + 0.003 * s, 0);
            x.lineTo(q + 0.003 * s, H);
          }
        }
        x.stroke();
      }
      for (const [tx, ty] of d.ties) {
        x.globalAlpha = 1;
        x.fillStyle = isH ? h01(0.2) : mix(lo, P[1], 0.3);
        circle(x, tx, ty, 0.018 * s);
        x.fillStyle = isH ? h01(0.08) : tint(lo, -0.2);
        circle(x, tx + 0.003 * s, ty + 0.003 * s, 0.011 * s);
        if (!isH) {
          x.globalAlpha = 0.7;
          x.strokeStyle = hi;
          x.lineWidth = 0.002 * s;
          x.beginPath();
          x.arc(tx, ty, 0.019 * s, 0.2, 1.9);
          x.stroke();
        }
      }
      x.globalAlpha = isH ? 1 : 0.55;
      x.fillStyle = isH ? h01(0.22) : lo;
      for (const [px, py, r] of d.pores) circle(x, px, py, r);
      x.globalAlpha = isH ? 0.8 : 0.35;
      for (const [px, py, r, dk] of d.specks) {
        x.fillStyle = isH ? h01(dk ? 0.35 : 0.58) : dk ? lo : hi;
        circle(x, px, py, r);
      }
      x.globalAlpha = isH ? 1 : 0.45;
      x.strokeStyle = isH ? h01(0.18) : lo;
      x.lineWidth = 0.0016 * s;
      x.beginPath();
      for (const pts of d.cracks) {
        x.moveTo(pts[0][0], pts[0][1]);
        for (let k = 1; k < pts.length; k++) x.lineTo(pts[k][0], pts[k][1]);
      }
      x.stroke();
    } else if (v === 'waves') {
      // the bands repeat every wavelength: paint one tile (an integer number of px wide) and fill the canvas with it
      const lam = Math.max(8, Math.round(TAU / d.k)), kk = TAU / lam, lw = 0.02 * s;
      const tile = layer(lam, H), t = tile.x;
      t.lineCap = 'butt';
      const line = (b, dy, dx = 0) => {
        t.beginPath();
        for (let k = 0; k <= 36; k++) {
          const px = -lam + (k / 36) * 3 * lam, py = b.y + dy + d.A0 * Math.sin(kk * (px - dx) + b.ph);
          if (k) t.lineTo(px, py);
          else t.moveTo(px, py);
        }
        t.stroke();
      };
      for (const b of d.bands) {
        if (isH) {
          t.globalAlpha = 1;
          t.strokeStyle = h01(0.62);
          t.lineWidth = lw;
          line(b, 0);
          t.strokeStyle = h01(0.8);
          t.lineWidth = lw * 0.4;
          line(b, -lw * 0.1);
        } else {
          t.globalAlpha = 0.45;
          t.strokeStyle = lo;
          t.lineWidth = lw * 0.5;
          line(b, lw * 0.4, ems);
          t.globalAlpha = 0.6;
          t.strokeStyle = hi;
          t.lineWidth = lw * 0.45;
          line(b, -lw * 0.3);
        }
      }
      x.globalAlpha = 1;
      x.fillStyle = x.createPattern(tile.cv, 'repeat-x');
      x.fillRect(0, 0, W, H);
    } else if (v === 'maze') {
      const wl = 0.012 * s;
      const walls = (dx, dy) => {
        x.beginPath();
        for (const [x0, y0, x1, y1] of d.walls) {
          x.moveTo(x0 + dx, y0 + dy);
          x.lineTo(x1 + dx, y1 + dy);
        }
        x.stroke();
      };
      if (isH) {
        x.globalAlpha = 1;
        x.strokeStyle = h01(0.82);
        x.lineWidth = wl;
        walls(0, 0);
      } else {
        x.lineWidth = wl;
        x.globalAlpha = 0.45;
        x.strokeStyle = lo;
        walls(wl * 0.4, wl * 0.4);
        x.globalAlpha = 0.75;
        x.strokeStyle = hi;
        walls(-wl * 0.2, -wl * 0.2);
        x.globalAlpha = 1;
        x.strokeStyle = tint(P[1], 0.04);
        x.lineWidth = wl * 0.6;
        walls(0, 0);
      }
    } else if (v === 'swirls') {
      const stroke = (pts, w) => {
        x.lineWidth = w;
        x.beginPath();
        pts.forEach(([px, py], i) => (i ? x.lineTo(px, py) : x.moveTo(px, py)));
        x.stroke();
      };
      for (const t of d.tiles) {
        const g = d.gap / 2, k = t.corner;
        const panel = [[t.x + g + k[0], t.y + g + k[1]], [t.x + t.w - g + k[2], t.y + g + k[3]], [t.x + t.w - g + k[4], t.y + t.h - g + k[5]], [t.x + g + k[6], t.y + t.h - g + k[7]]];
        const rect = (dx, dy) => {
          x.beginPath();
          panel.forEach(([px, py], i) => (i ? x.lineTo(px + dx, py + dy) : x.moveTo(px + dx, py + dy)));
          x.closePath();
        };
        // the panel: raised, its shadow below right and a lit edge above left in the colour pass
        if (isH) {
          x.globalAlpha = 1;
          x.fillStyle = h01(0.56);
          rect(0, 0);
          x.fill();
        } else {
          x.globalAlpha = 0.45;
          x.fillStyle = lo;
          rect(ems * 1.5, ems * 1.5);
          x.fill();
          x.globalAlpha = 0.9;
          x.fillStyle = tint(P[1], 0.05);
          rect(0, 0);
          x.fill();
          x.globalAlpha = 0.6;
          x.strokeStyle = hi;
          x.lineWidth = 0.004 * s;
          rect(-ems * 0.4, -ems * 0.4);
          x.stroke();
          // the peach / beige wash in the grooves of the rosette – mostly the real p[2] even in a relief build (the
          // tonal palette would bleach it to white; the wash is part of the picture)
          const [wx, wy, wr, wa] = t.wash, tan = mix(P[2], p[2], 0.75);
          const gr = x.createRadialGradient(t.cx + wx, t.cy + wy, 0, t.cx + wx, t.cy + wy, wr + t.rr * 0.6);
          gr.addColorStop(0, rgba(mix(tan, p[3], 0.2), wa));
          gr.addColorStop(0.55, rgba(tan, wa * 0.7));
          gr.addColorStop(1, rgba(tan, 0));
          x.globalAlpha = 1;
          x.fillStyle = gr;
          rect(0, 0);
          x.fill();
        }
        // the rosette: a raised spiral ridge in white with tinted grooves between its turns
        const ridgePts = spiralPts(t), groove = spiralPts(t, Math.PI);
        if (isH) {
          x.strokeStyle = h01(0.4);
          stroke(groove, t.lw * 0.9);
          x.strokeStyle = h01(0.86);
          stroke(ridgePts, t.lw);
        } else {
          x.globalAlpha = 0.55;
          x.strokeStyle = mix(P[2], p[2], 0.75);
          stroke(groove, t.lw * 0.8);
          x.globalAlpha = 0.5;
          x.strokeStyle = lo;
          stroke(ridgePts.map(([px, py]) => [px + ems * 1.4, py + ems * 1.4]), t.lw * 0.9);
          x.globalAlpha = 0.95;
          x.strokeStyle = hi;
          stroke(ridgePts, t.lw * 0.85);
          // crackle on the white
          x.globalAlpha = 0.4;
          x.strokeStyle = lo;
          x.lineWidth = Math.max(0.6, 0.0014 * s);
          x.beginPath();
          for (const [u, a, L] of t.cracks) {
            const q = ridgePts[Math.min(ridgePts.length - 1, Math.floor(u * (ridgePts.length - 1)))];
            const dx = Math.cos(a + t.a0) * t.lw * L, dy = Math.sin(a + t.a0) * t.lw * L;
            x.moveTo(q[0] - dx / 2, q[1] - dy / 2);
            x.lineTo(q[0] + dx / 2, q[1] + dy / 2);
          }
          x.stroke();
        }
      }
    } else {
      const off = 0.004 * s;
      const each = (dx, dy, k) => {
        for (const [px, py, r] of d.dots) circle(x, px + dx, py + dy, r * k);
      };
      if (isH) {
        x.globalAlpha = 1;
        x.fillStyle = h01(0.78);
        each(0, 0, 1);
      } else {
        x.globalAlpha = 0.5;
        x.fillStyle = lo;
        each(off, off, 1);
        x.globalAlpha = 0.85;
        x.fillStyle = hi;
        each(-off * 0.5, -off * 0.5, 0.9);
      }
    }
    x.globalAlpha = 1;
  });
  grain(c, W, H, R, 0.04);
}

/**
 * Impressionist scenes. cols(p) is the colour table; under(x, W, H, s, C, U) paints the underpainting; at(u, v, k, w, U)
 * gives the table index of a dab at (u, v) ∈ 0…1 from its picks k, w ∈ [0, 1), and whether it is a flat water dab.
 * U holds the pre-drawn scene data (ridges, clouds, lily pads, drifts).
 */
const IMPRESSION = {
  river: {
    // 0 sky, 1 sky green, 2 white, 3 pink haze, 4 light leaves, 5 dark leaves, 6 leaves, 7 deep shade, 8 lily pad,
    // 9 lily light, 10 lily flower, 11 blue-grey water, 12 pale green
    cols: (p) => [p[0], mix(p[0], p[2], 0.35), mix(p[0], '#ffffff', 0.45), mix(p[0], p[4], 0.3), mix(p[1], p[2], 0.45), mix(p[1], p[3], 0.35), p[1], mix(p[3], p[1], 0.3), p[2], mix(p[4], '#ffffff', 0.3), p[4], mix(p[0], p[3], 0.22), mix(p[2], p[0], 0.45)],
    top: (U, u) => 0.27 + U.ridge(u) * 0.06,
    bank: (u) => 0.47 + 0.08 * Math.max(0, Math.abs(u - 0.5) * 2 - 0.55),
    under(x, W, H, s, C, U) {
      vgrad(x, W, 0, 0.5 * H, [[0, C[1]], [1, C[0]]]);
      vgrad(x, W, 0.45 * H, H, [[0, C[5]], [0.35, C[11]], [1, C[1]]]);
      const band = (mir) => {
        x.beginPath();
        x.moveTo(0, this.bank(0) * H);
        for (let i = 0; i <= 64; i++) {
          const u = i / 64, b = this.bank(u), t = this.top(U, u);
          x.lineTo(u * W, (mir ? 2 * b - t : t) * H);
        }
        for (let i = 64; i >= 0; i--) x.lineTo((i / 64) * W, this.bank(i / 64) * H);
        x.closePath();
        x.fill();
      };
      x.fillStyle = C[5];
      band(false);
      x.globalAlpha = 0.7;
      band(true);
      x.globalAlpha = 1;
      x.fillStyle = C[8];
      for (const [u, v, ru, rv] of U.pads) ellipse(x, u * W, v * H, ru * s, rv * s);
    },
    at(u, v, k, w, U) {
      const t = this.top(U, u), b = this.bank(u);
      if (v < t) return [k < 0.4 ? 0 : k < 0.65 ? 1 : k < 0.85 ? 2 : 3, 0];
      if (v < b) return [k < 0.3 ? 7 : k < 0.6 ? 5 : k < 0.85 ? 6 : 4, 0];
      for (const [pu, pv, ru, rv] of U.pads) {
        const du = ((u - pu) * U.asp) / ru, dv = (v - pv) / rv;
        if (du * du + dv * dv < 1) return [w < 0.16 ? (k < 0.55 ? 10 : 9) : k < 0.6 ? 8 : 12, 0];
      }
      const mv = 2 * b - v;
      if (mv > t) return [k < 0.45 ? 7 : k < 0.8 ? 5 : 6, 1];
      return [k < 0.4 ? 1 : k < 0.7 ? 0 : k < 0.88 ? 11 : 2, 1];
    },
  },
  garden: {
    // 0 sky, 1 sky green, 2 white, 3 deep leaves, 4 leaves, 5 light leaves, 6 path, 7 path shade, 8 flower, 9 pale
    // flower, 10 dark flower, 11 yellow-green
    cols: (p) => [p[0], mix(p[0], p[2], 0.3), mix(p[0], '#ffffff', 0.4), mix(p[1], p[3], 0.4), p[1], mix(p[1], p[2], 0.5), mix(p[0], p[4], 0.22), mix(p[0], p[2], 0.55), p[4], mix(p[4], '#ffffff', 0.4), mix(p[4], p[3], 0.3), mix(p[2], '#f2e2a0', 0.3)],
    top: (U, u) => 0.15 + U.ridge(u) * 0.05,
    path: (v) => [0.5 + 0.07 * Math.sin((v - 0.36) * 5.5) * (v - 0.3), 0.012 + Math.max(0, v - 0.36) * 0.3],
    under(x, W, H, s, C, U) {
      vgrad(x, W, 0, 0.3 * H, [[0, C[1]], [1, C[0]]]);
      x.fillStyle = C[4];
      x.fillRect(0, 0.33 * H, W, 0.67 * H);
      x.fillStyle = C[3];
      fillUnder(x, W, 0.4 * H, (u) => this.top(U, u) * H, C[3]);
      const side = (sg, wid, col) => {
        x.fillStyle = col;
        x.beginPath();
        for (let i = 0; i <= 16; i++) {
          const v = 0.36 + (i / 16) * 0.66, [m, h] = this.path(v);
          x.lineTo((m + sg * h) * W, v * H);
        }
        for (let i = 16; i >= 0; i--) {
          const v = 0.36 + (i / 16) * 0.66, [m, h] = this.path(v);
          x.lineTo((m + sg * (h + wid(v))) * W, v * H);
        }
        x.closePath();
        x.fill();
      };
      const bed = (v) => 0.03 + (v - 0.36) * 0.5;
      side(-1, bed, mix(C[8], C[4], 0.45));
      side(1, bed, mix(C[8], C[4], 0.45));
      side(-1, () => 0, C[6]);
      x.fillStyle = C[6];
      x.beginPath();
      for (let i = 0; i <= 16; i++) {
        const v = 0.36 + (i / 16) * 0.66, [m, h] = this.path(v);
        x.lineTo((m - h) * W, v * H);
      }
      for (let i = 16; i >= 0; i--) {
        const v = 0.36 + (i / 16) * 0.66, [m, h] = this.path(v);
        x.lineTo((m + h) * W, v * H);
      }
      x.closePath();
      x.fill();
    },
    at(u, v, k, w, U) {
      if (v < this.top(U, u)) return [k < 0.45 ? 0 : k < 0.75 ? 1 : 2, 0];
      if (v < 0.36) return [k < 0.35 ? 3 : k < 0.7 ? 4 : 5, 0];
      const [m, h] = this.path(v), du = Math.abs(u - m);
      if (du < h) return [k < 0.6 ? 6 : k < 0.85 ? 7 : 2, 0];
      if (du < h + 0.03 + (v - 0.36) * 0.5 && w < 0.75) return [k < 0.4 ? 8 : k < 0.62 ? 9 : k < 0.8 ? 10 : 11, 0];
      return [k < 0.35 ? 4 : k < 0.7 ? 5 : k < 0.85 ? 3 : 11, 0];
    },
  },
  field: {
    // 0 sky, 1 white, 2 sky green, 3 far trees, 4 dark leaves, 5 grass, 6 light grass, 7 straw, 8 poppy, 9 dark
    // poppy, 10 haze
    cols: (p) => [p[0], mix(p[0], '#ffffff', 0.55), mix(p[0], p[2], 0.3), mix(p[3], p[1], 0.45), mix(p[1], p[3], 0.3), p[1], p[2], mix(p[2], '#f2e2a0', 0.35), p[4], tint(p[4], -0.2), mix(p[0], p[4], 0.25)],
    top: (U, u) => 0.4 + U.ridge(u) * 0.035,
    under(x, W, H, s, C, U) {
      vgrad(x, W, 0, 0.46 * H, [[0, C[2]], [1, C[0]]]);
      x.fillStyle = C[1];
      for (const [u, v, ru, rv] of U.clouds) ellipse(x, u * W, v * H, ru * s, rv * s);
      vgrad(x, W, 0.44 * H, H, [[0, C[6]], [0.4, C[5]], [1, mix(C[5], C[4], 0.4)]]);
      fillUnder(x, W, 0.47 * H, (u) => this.top(U, u) * H, C[3]);
      x.fillStyle = mix(C[8], C[5], 0.35);
      for (const [u, v, ru, rv] of U.drifts) ellipse(x, u * W, v * H, ru * s, rv * s);
    },
    at(u, v, k, w, U) {
      if (v < this.top(U, u)) {
        for (const [cu, cv, ru, rv] of U.clouds) {
          const du = ((u - cu) * U.asp) / ru, dv = (v - cv) / rv;
          if (du * du + dv * dv < 1.2) return [k < 0.6 ? 1 : k < 0.85 ? 0 : 10, 0];
        }
        return [k < 0.45 ? 0 : k < 0.7 ? 2 : k < 0.88 ? 1 : 10, 0];
      }
      if (v < 0.47) return [k < 0.6 ? 3 : 4, 0];
      let poppy = 0.05 + 0.12 * clamp((v - 0.47) / 0.53 + (0.4 - u) * 0.4, 0, 1);
      for (const [cu, cv, ru, rv] of U.drifts) {
        const du = ((u - cu) * U.asp) / ru, dv = (v - cv) / rv;
        if (du * du + dv * dv < 1) poppy = 0.55;
      }
      if (w < poppy) return [k < 0.7 ? 8 : 9, 0];
      return [k < 0.35 ? 5 : k < 0.65 ? 6 : k < 0.85 ? 7 : 4, 0];
    },
  },
};

function impression(c, W, H, R, p, o) {
  const s = S(W, H), asp = W / H;
  const v = variantOf(R, o, ['river', 'garden', 'field']);
  const shape = seedOf(R);
  const rg = ridge(R, 0, 1);
  const U = {
    asp, ridge: (u) => rg(u),
    pads: Array.from({ length: R.int(3, 5) }, () => [R.range(0.08, 0.92), R.range(0.66, 0.95), R.range(0.08, 0.16), R.range(0.025, 0.05)]),
    clouds: Array.from({ length: R.int(3, 5) }, () => [R(), R.range(0.08, 0.3), R.range(0.1, 0.22), R.range(0.03, 0.06)]),
    drifts: Array.from({ length: R.int(3, 5) }, () => [R.range(0.05, 0.85), R.range(0.6, 0.95), R.range(0.12, 0.3), R.range(0.04, 0.09)]),
  };
  // dabs on a jittered grid: every part of the canvas gets paint
  const cell = 0.024 * s, gx = Math.ceil(W / cell), gy = Math.ceil(H / cell), n = gx * gy;
  const ds = new Float32Array(n * 5);
  for (let j = 0, i = 0; j < gy; j++) for (let q = 0; q < gx; q++, i++) ds.set([(q + R()) / gx, (j + R()) / gy, R.range(0.75, 1.3), R(), R()], i * 5);
  const sc = IMPRESSION[v];
  const C = sc.cols(p);
  const dw = 0.048 * s, dh = 0.018 * s;
  const angles = [-0.4, 0.4];

  fill(c, W, H, C[0]);
  const l = layer(W, H);
  sc.under(l.x, W, H, s, C, U);
  blurOnto(c, l, 0.008 * s);
  const st = C.map((col) => [...angles.map((a) => brushStamp(shape, dw, dh, col, { streaks: 5, dry: 0.15, taper: 0.22, angle: a })), brushStamp(shape, dw * 1.4, dh * 0.6, col, { streaks: 4, dry: 0.1, taper: 0.25 })]);
  for (let i = 0; i < n; i++) {
    const b = i * 5, u = ds[b], vv = ds[b + 1];
    const [ci, flat] = sc.at(u, vv, ds[b + 3], ds[b + 4], U);
    stampAt(c, st[ci][flat ? 2 : ds[b + 4] < 0.5 ? 0 : 1], u * W, vv * H, ds[b + 2], 0.9);
  }
  c.globalAlpha = 1;
  grain(c, W, H, R, 0.04);
}

/** Lathe profiles: [t, radius as a share of the width], t from the foot (0) to the mouth (1). */
const VASES = {
  amphora: [[0, 0.3], [0.12, 0.44], [0.4, 0.5], [0.68, 0.32], [0.84, 0.2], [1, 0.27]],
  bottle: [[0, 0.42], [0.45, 0.45], [0.58, 0.38], [0.72, 0.15], [0.94, 0.12], [1, 0.15]],
  bowl: [[0, 0.24], [0.12, 0.4], [0.5, 0.5], [0.85, 0.5], [1, 0.52]],
  cylinder: [[0, 0.36], [0.06, 0.38], [0.94, 0.38], [1, 0.4]],
};
const profileAt = (prof, t) => {
  let k = 0;
  while (k < prof.length - 2 && prof[k + 1][0] < t) k++;
  const [t0, r0] = prof[k], [t1, r1] = prof[k + 1];
  const u = clamp((t - t0) / (t1 - t0 || 1)), e = u * u * (3 - 2 * u);
  return r0 + (r1 - r0) * e;
};
/** Closed vase outline: foot centre (x, yb), width w, height h. */
function vasePath(c, prof, x, yb, w, h) {
  const n = 18, pts = [];
  for (let i = 0; i <= n; i++) pts.push([x + profileAt(prof, i / n) * w, yb - (i / n) * h]);
  for (let i = n; i >= 0; i--) pts.push([x - profileAt(prof, i / n) * w, yb - (i / n) * h]);
  poly(c, pts);
}

function stillLife(c, W, H, R, p, o) {
  const s = S(W, H);
  const v = variantOf(R, o, ['vase', 'bottles', 'fruitbowl']);
  const yt = H * R.range(0.66, 0.72);
  const kind = R.pick(['amphora', 'bottle', 'bowl', 'cylinder']);
  const vx = W / 2 + R.range(-0.05, 0.05) * s, vw = R.range(0.26, 0.32) * s, vh = (kind === 'bowl' ? R.range(0.2, 0.25) : R.range(0.38, 0.46)) * s;
  const stems = Array.from({ length: R.int(3, 7) }, () => {
    const ex = vx + R.range(-0.32, 0.32) * s, ey = Math.max(0.08 * H, yt - vh - R.range(0.1, 0.3) * s);
    return { ex, ey, cx: vx + R.range(-0.08, 0.08) * s, leaves: Array.from({ length: R.int(1, 2) }, () => [R.range(0.3, 0.7), R.sign(), R.range(0.025, 0.04) * s]), r: R.range(0.04, 0.065) * s, np: R.int(5, 8), rot: R() * TAU, kind: R() < 0.7 ? 0 : 1, ci: R() < 0.7 ? 4 : 0 };
  });
  const bottles = Array.from({ length: R.int(2, 3) }, (_, i) => ({ dx: (i - 1) * R.range(0.19, 0.23) * s, w: R.range(0.13, 0.18) * s, h: R.range(0.4, 0.6) * s, prof: R.pick(['bottle', 'bottle', 'amphora', 'cylinder']), ci: [1, 2, 4][i] }));
  const fruits = Array.from({ length: R.int(3, 6) }, (_, i) => ({ dx: R.range(-0.2, 0.2) * (i > 2 ? 0.6 : 1) * s, dy: R.range(0, 0.03) * s + (i > 2 ? 0.07 * s : 0), r: R.range(0.06, 0.085) * s, ci: R() < 0.6 ? 1 : 4 }));
  const loose = { dx: R.sign() * R.range(0.3, 0.38) * s, r: R.range(0.05, 0.07) * s };
  const wallSeed = seedOf(R);
  const strokes = Array.from({ length: 70 }, () => {
    const x = R() * W, y = R() * H, a = R.range(-0.6, 0.6), L = R.range(0.12, 0.3) * s;
    return [...seg(x, y, a, L), R.range(0.04, 0.09) * s, R.pick([0, 1, 2]), R.range(-0.1, 0.1), R() < 0.5];
  });
  const table = mix(p[3], p[0], 0.55);

  fill(c, W, H, p[0]);
  vgrad(c, W, 0, yt, [[0, tint(p[0], 0.05)], [1, mix(p[0], p[3], 0.08)]]);
  c.fillStyle = table;
  c.fillRect(0, yt, W, H - yt);
  c.fillStyle = tint(table, 0.12);
  c.fillRect(0, yt, W, 0.006 * s);
  // soft shadow on the table
  const sh = layer(W, H);
  sh.x.fillStyle = p[3];
  ellipse(sh.x, vx + 0.06 * s, yt + 0.02 * s, (v === 'vase' ? vw * 0.6 : 0.3 * s), 0.035 * s);
  blurOnto(c, sh, 0.012 * s, 0.35);
  if (v === 'vase') {
    const prof = VASES[kind], top = yt - vh, mouth = profileAt(prof, 1) * vw;
    c.strokeStyle = p[3];
    c.lineCap = 'round';
    for (const st of stems) {
      c.lineWidth = 0.006 * s;
      c.beginPath();
      c.moveTo(vx + (st.cx - vx) * 0.3, top + 0.02 * s);
      c.quadraticCurveTo(st.cx, (top + st.ey) / 2, st.ex, st.ey);
      c.stroke();
      c.fillStyle = p[2];
      for (const [t, sd, lr] of st.leaves) {
        const [lx, ly] = qpt([vx + (st.cx - vx) * 0.3, top], [st.cx, (top + st.ey) / 2], [st.ex, st.ey], t);
        ellipse(c, lx + sd * lr * 0.9, ly, lr * 1.3, lr * 0.5, sd * 0.6);
      }
    }
    for (const st of stems) {
      const col = p[st.ci];
      for (let k = 0; k < st.np; k++) {
        const a = st.rot + (k / st.np) * TAU;
        c.fillStyle = k % 2 ? col : mix(col, p[0], 0.25);
        ellipse(c, st.ex + Math.cos(a) * st.r * 0.62, st.ey + Math.sin(a) * st.r * 0.62, st.r * 0.62, st.r * (st.kind ? 0.42 : 0.3), a);
      }
      c.fillStyle = st.kind ? p[1] : p[3];
      circle(c, st.ex, st.ey, st.r * 0.3);
    }
    c.fillStyle = p[1];
    vasePath(c, prof, vx, yt, vw, vh);
    c.fill();
    c.fillStyle = tint(p[1], -0.25);
    ellipse(c, vx, top, mouth, mouth * 0.22);
    c.globalAlpha = 0.4;
    c.fillStyle = p[0];
    ellipse(c, vx - vw * 0.2, yt - vh * 0.55, vw * 0.06, vh * 0.28);
    c.globalAlpha = 1;
  } else if (v === 'bottles') {
    for (const b of bottles) {
      c.fillStyle = p[b.ci];
      vasePath(c, VASES[b.prof], vx + b.dx, yt, b.w, b.h);
      c.fill();
      c.globalAlpha = 0.35;
      c.fillStyle = p[0];
      ellipse(c, vx + b.dx - b.w * 0.18, yt - b.h * 0.4, b.w * 0.05, b.h * 0.22);
      c.globalAlpha = 1;
    }
  } else {
    const by = yt + 0.03 * s, bw = 0.34 * s;
    for (const f of fruits) {
      c.fillStyle = p[f.ci];
      circle(c, vx + f.dx, by - 0.1 * s - f.dy, f.r);
      c.globalAlpha = 0.35;
      c.fillStyle = p[0];
      circle(c, vx + f.dx - f.r * 0.35, by - 0.1 * s - f.dy - f.r * 0.35, f.r * 0.25);
      c.globalAlpha = 1;
    }
    c.fillStyle = p[2];
    c.beginPath();
    c.ellipse(vx, by - 0.09 * s, bw, 0.14 * s, 0, 0, Math.PI);
    c.closePath();
    c.fill();
    c.fillStyle = tint(p[2], 0.2);
    ellipse(c, vx, by - 0.09 * s, bw, 0.018 * s);
    c.fillStyle = p[4];
    circle(c, vx + loose.dx, yt + 0.05 * s - loose.r, loose.r);
  }
  const ws = [0, 1, 2].map((k) => brushStamp(wallSeed, 0.3 * s, 0.07 * s, p[k], { streaks: 9, dry: 0.3 }));
  for (const [x0, y0, x1, y1, w, k, , flip] of strokes) stampLine(c, ws[k], x0, y0, x1, y1, w, 0.07, flip);
  grain(c, W, H, R, 0.05);
}

/** Head-and-neck outlines in unit space (facing +x, y down; the head about −0.2…0.75, the neck down to y 1.7). */
const DEER_HEAD = [
  [-0.64, 1.75], [-0.52, 1.05], [-0.42, 0.58], [-0.31, 0.24], [-0.21, 0.03], [-0.1, -0.11], [0.04, -0.16], [0.16, -0.13],
  [0.3, -0.04], [0.44, 0.06], [0.54, 0.12], [0.58, 0.19], [0.53, 0.25], [0.45, 0.28], [0.37, 0.33], [0.25, 0.33],
  [0.11, 0.3], [0.04, 0.4], [0.06, 0.7], [0.14, 1.1], [0.26, 1.75],
];
const MOOSE_HEAD = [
  [-0.66, 1.75], [-0.54, 1.05], [-0.42, 0.55], [-0.3, 0.2], [-0.19, 0.0], [-0.08, -0.12], [0.06, -0.15], [0.2, -0.1],
  [0.34, 0.0], [0.48, 0.08], [0.62, 0.14], [0.72, 0.23], [0.74, 0.34], [0.67, 0.41], [0.56, 0.4], [0.47, 0.37],
  [0.38, 0.41], [0.24, 0.42], [0.12, 0.4], [0.07, 0.5], [0.03, 0.66], [-0.02, 0.86], [0.07, 0.8], [0.12, 1.0],
  [0.18, 1.3], [0.28, 1.75],
];
/** An ear (leaf) at base (x, y) in unit space, pointing along angle a. */
const EAR = (x, y, a, L, w) => {
  const ca = Math.cos(a), sa = Math.sin(a), nx = -sa, ny = ca;
  return [[x + nx * w * 0.5, y + ny * w * 0.5], [x + ca * L * 0.5 + nx * w, y + sa * L * 0.5 + ny * w], [x + ca * L, y + sa * L], [x + ca * L * 0.5 - nx * w * 0.8, y + sa * L * 0.5 - ny * w * 0.8], [x - nx * w * 0.5, y - ny * w * 0.5]];
};

/** Polyline pts offset sideways by d (left of the direction of travel, in the pts' units). */
function offsetPts(pts, d) {
  const n = pts.length;
  return pts.map((q, i) => {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)], L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return [q[0] - ((b[1] - a[1]) / L) * d, q[1] + ((b[0] - a[0]) / L) * d];
  });
}

/** Open Catmull-Rom spline through pts, `per` points per span (smooth antler beams and tines for taperPath). */
function spline(pts, per = 6) {
  const n = pts.length, out = [];
  const at = (i) => pts[Math.max(0, Math.min(n - 1, i))];
  for (let i = 0; i < n - 1; i++) {
    const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
    for (let k = 0; k < per; k++) {
      const u = k / per, u2 = u * u, u3 = u2 * u;
      out.push([0, 1].map((j) => 0.5 * (2 * p1[j] + (-p0[j] + p2[j]) * u + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * u2 + (-p0[j] + 3 * p1[j] - 3 * p2[j] + p3[j]) * u3)));
    }
  }
  out.push(pts[n - 1]);
  return out;
}

/** Frontal head outline (right half, units of s from the forehead between the antlers; y down to the chin). */
const FRONT_HEAD = [[0, -0.02], [0.045, -0.016], [0.08, 0.002], [0.103, 0.04], [0.113, 0.085], [0.108, 0.125], [0.092, 0.165], [0.073, 0.205], [0.06, 0.245], [0.054, 0.275], [0.042, 0.3], [0, 0.312]];
/** Frontal neck sides (from behind the ears down past the bottom edge): a narrow side and a side with the shoulder. */
const FRONT_NECK = [[[0.09, 0.05], [0.1, 0.18], [0.12, 0.3], [0.17, 0.4], [0.24, 0.48], [0.3, 0.56], [0.33, 0.72]], [[0.09, 0.05], [0.1, 0.2], [0.14, 0.32], [0.24, 0.42], [0.38, 0.5], [0.5, 0.58], [0.58, 0.72]]];
/** Main antler beam seen from the front (right side): out from the pedicle, up, the tip curling in. */
const FRONT_BEAM = [[0.045, -0.012], [0.085, -0.05], [0.14, -0.1], [0.205, -0.155], [0.27, -0.22], [0.32, -0.295], [0.35, -0.37], [0.355, -0.44]];

/**
 * Stag «front» (Bohus Hjort): a symmetric frontal head with the ears out to the sides, wide antlers with 5–6 tines a
 * side filling the top half (dark at the burr, ivory tips, a little gold leaf), the neck widening into a shoulder, a
 * darker mane at the sides, on a dark dry-brushed ground. Uses the values stag() drew; draws only its ground streaks.
 */
function stagFront(c, W, H, R, p, s, { sg, jit, fur, tines, halo }) {
  const ox = W / 2, oy = H / 2 + 0.02 * s;
  const T = (x, y) => [ox + x * s, oy + y * s];
  const spread = 0.98 + 0.16 * ((halo - 0.55) / 0.2);
  const streaks = Array.from({ length: R.int(9, 13) }, () => [R.range(-0.3, 0.8) * W, R() * H, R.range(0.3, 0.7) * W, R.range(0.03, 0.08) * s, R.range(-0.04, 0.04), R.range(0.12, 0.28), R() < 0.5]);
  const stSeed = seedOf(R);
  const parts = [];
  for (const [dir, j0, n] of [[-1, 0, Math.min(6, tines[0] + 2)], [1, 10, Math.min(6, tines[1] + 2)]]) {
    const pts = FRONT_BEAM.map(([x, y], k) => [dir * (0.045 + (x - 0.045) * spread) + jit[j0 + k] * 0.008, y + jit[j0 + k + 8] * 0.008]);
    parts.push({ pts, w0: 0.046, w1: 0.016, beam: true, dir });
    // the brow tine low on the beam (in and up), tines from the inner side, the last one forking out at the crown
    for (let k = 0; k < n; k++) {
      const t = k === 0 ? 0.12 : 0.3 + ((k - 1) / Math.max(1, n - 2)) * 0.62;
      const f = t * (pts.length - 1), i = Math.min(pts.length - 2, Math.floor(f)), q = f - i;
      const bx = pts[i][0] + (pts[i + 1][0] - pts[i][0]) * q, by = pts[i][1] + (pts[i + 1][1] - pts[i][1]) * q;
      const last = k === n - 1;
      const ang = -HALF_PI + dir * (k === 0 ? -0.55 : last ? 0.45 : -0.28 + 0.1 * jit[j0 + 20 + k]);
      const L = (k === 0 ? 0.12 : last ? 0.09 : 0.17 - 0.07 * t) * (1 + 0.12 * jit[j0 + 30 + k]);
      const bend = dir * (last ? -0.015 : 0.022);
      parts.push({ pts: [[bx, by], [bx + Math.cos(ang) * L * 0.55 + bend, by + Math.sin(ang) * L * 0.55], [bx + Math.cos(ang) * L, by + Math.sin(ang) * L]], w0: 0.028, w1: 0.005, dir });
    }
  }
  const head = [...FRONT_HEAD.map(([x, y], i) => [x + jit[40 + i] * 0.003, y]), ...FRONT_HEAD.slice(1, -1).reverse().map(([x, y], i) => [-x - jit[50 - i] * 0.003, y])];
  const [narrow, wide] = FRONT_NECK;
  const neck = [...(sg > 0 ? wide : narrow), ...(sg > 0 ? narrow : wide).slice().reverse().map(([x, y]) => [-x, y])];
  const ears = [1, -1].map((d) => EAR(d * 0.098, 0.055, d > 0 ? -0.32 : Math.PI + 0.32, 0.125, 0.036));
  const earsIn = [1, -1].map((d) => EAR(d * 0.1, 0.055, d > 0 ? -0.32 : Math.PI + 0.32, 0.095, 0.02));
  const toW = (pts) => pts.map(([x, y]) => T(x, y));

  // the ground: dark, a soft warm glow behind the head, horizontal dry-brush streaks
  fill(c, W, H, p[0]);
  const g = c.createRadialGradient(ox, oy - 0.08 * s, 0.05 * s, ox, oy - 0.08 * s, halo * s);
  g.addColorStop(0, rgba(mix(p[0], p[2], 0.3), 1));
  g.addColorStop(1, rgba(p[0], 0));
  c.fillStyle = g;
  c.fillRect(0, 0, W, H);
  const st = brushStamp(stSeed, 0.5 * s, 0.07 * s, mix(p[0], p[2], 0.35), { streaks: 12, dry: 0.45 });
  for (const [x, y, L, w, a, al, flip] of streaks) stampLine(c, st, x, y, x + Math.cos(a) * L, y + Math.sin(a) * L, w, al, flip);
  // antlers on a layer: ivory, shaded on the far side, dark toward the burr, gold leaf and light along the near side
  const al = layer(W, H), a = al.x;
  a.fillStyle = p[4];
  for (const pt of parts) {
    pt.pts = spline(pt.pts);
    a.beginPath();
    taperPath(a, toW(pt.pts), pt.w0 * s, pt.w1 * s);
    a.fill();
  }
  a.globalCompositeOperation = 'source-atop';
  a.lineCap = 'round';
  a.lineJoin = 'round';
  a.strokeStyle = mix(p[2], p[3], 0.35);
  a.globalAlpha = 0.6;
  for (const pt of parts) {
    a.lineWidth = pt.w0 * s * 0.5;
    smoothPath(a, toW(offsetPts(pt.pts, -pt.dir * pt.w0 * 0.4)), false);
    a.stroke();
  }
  a.globalAlpha = 1;
  const bg = a.createLinearGradient(0, oy + 0.01 * s, 0, oy - 0.26 * s);
  bg.addColorStop(0, rgba(mix(p[1], p[3], 0.5), 0.95));
  bg.addColorStop(0.45, rgba(mix(p[1], p[2], 0.4), 0.45));
  bg.addColorStop(1, rgba(p[2], 0));
  a.fillStyle = bg;
  a.fillRect(0, 0, W, H);
  a.strokeStyle = tint(p[4], 0.4);
  a.globalAlpha = 0.55;
  for (const pt of parts) {
    a.lineWidth = Math.max(0.6, pt.w0 * s * 0.18);
    smoothPath(a, toW(offsetPts(pt.pts, pt.dir * pt.w0 * 0.25)), false);
    a.stroke();
  }
  a.strokeStyle = mix(p[4], '#c9a03c', 0.6);
  a.globalAlpha = 0.85;
  for (const pt of parts) {
    if (!pt.beam) continue;
    a.lineWidth = 0.007 * s;
    const m = pt.pts.length;
    smoothPath(a, toW(offsetPts(pt.pts.slice(Math.round(0.3 * m), Math.round(0.72 * m)), pt.dir * 0.009)), false);
    a.stroke();
  }
  a.globalAlpha = 1;
  blurOnto(c, al, 0);
  // head, ears and neck on a layer: fur strokes land only on the silhouette
  const l = layer(W, H), x = l.x;
  x.fillStyle = p[1];
  for (const shape of [neck, ...ears, head]) {
    smoothPath(x, toW(shape), true);
    x.fill();
  }
  x.globalCompositeOperation = 'source-atop';
  fur.forEach((f, i) => {
    const fx = (f.x - 0.04) * 0.5, fy = ((f.y + 0.18) / 1.93) * 0.74 - 0.03;
    const mane = fy > 0.3 && Math.abs(fx) > 0.1 && i % 2 === 0;
    const ang = Math.atan2(1, fx * 1.6) + (f.w - 0.013) * 30, L = f.L * s * (mane ? 0.62 : 0.38);
    const [px, py] = T(fx, fy), dx = Math.cos(ang) * L, dy = Math.sin(ang) * L;
    brush(x, rngFrom(f.seed), px - dx / 2, py - dy / 2, px + dx / 2, py + dy / 2, f.w * 0.42 * s, mane ? p[3] : p[f.k], mane ? Math.min(0.7, f.al + 0.2) : f.al, 3);
  });
  const rad = (cx2, cy2, r, col, a0) => {
    const q = x.createRadialGradient(...T(cx2, cy2), 0.01 * s, ...T(cx2, cy2), r * s);
    q.addColorStop(0, rgba(col, a0));
    q.addColorStop(1, rgba(col, 0));
    x.fillStyle = q;
    x.fillRect(0, 0, W, H);
  };
  rad(0, 0.13, 0.13, p[4], 0.32);
  rad(0, 0.25, 0.075, p[4], 0.45);
  rad(0.068, 0.1, 0.04, p[3], 0.4);
  rad(-0.068, 0.1, 0.04, p[3], 0.4);
  // the darker mane: everything away from the face darkens toward the neck sides and the bottom
  const mn = x.createRadialGradient(...T(0, 0.16), 0.12 * s, ...T(0, 0.2), 0.5 * s);
  mn.addColorStop(0, rgba(p[3], 0));
  mn.addColorStop(1, rgba(p[3], 0.75));
  x.fillStyle = mn;
  x.fillRect(0, 0, W, H);
  // the jaw line: a soft shadow under the cheeks and chin sets the head off the neck
  x.strokeStyle = rgba(p[3], 0.2);
  x.lineWidth = 0.024 * s;
  x.lineCap = 'round';
  smoothPath(x, toW(offsetPts([...FRONT_HEAD.slice(5), ...FRONT_HEAD.slice(5, -1).reverse().map(([a2, b2]) => [-a2, b2])], -0.008)), false);
  x.stroke();
  x.fillStyle = rgba(p[4], 0.4);
  for (const e of earsIn) {
    smoothPath(x, toW(e), true);
    x.fill();
  }
  blurOnto(c, l, 0);
  // eyes, nose, mouth
  for (const d of [1, -1]) {
    const [ex, ey] = T(d * 0.068, 0.103);
    c.fillStyle = p[3];
    ellipse(c, ex, ey, 0.018 * s, 0.012 * s, d * 0.3);
    c.fillStyle = p[4];
    circle(c, ex - d * 0.005 * s, ey - 0.004 * s, 0.0035 * s);
  }
  c.fillStyle = mix(p[3], p[1], 0.25);
  ellipse(c, ...T(0, 0.283), 0.046 * s, 0.028 * s);
  c.fillStyle = p[3];
  for (const d of [1, -1]) ellipse(c, ...T(d * 0.022, 0.29), 0.013 * s, 0.008 * s, d * 0.5);
  c.fillStyle = rgba(p[4], 0.3);
  ellipse(c, ...T(0, 0.27), 0.024 * s, 0.007 * s);
  c.strokeStyle = p[3];
  c.lineWidth = 0.004 * s;
  c.lineCap = 'round';
  c.beginPath();
  c.moveTo(...T(0, 0.31));
  c.lineTo(...T(0, 0.322));
  c.stroke();
  vignette(c, W, H, 0.4);
  grain(c, W, H, R, 0.05);
}

function stag(c, W, H, R, p, o) {
  const s = S(W, H);
  const v0 = variantOf(R, o, ['stag', 'reindeer', 'moose']);
  // the frontal portrait only on request: the random pick stays among the three profiles
  const v = o && o.variant === 'front' ? 'front' : v0;
  const sg = R.sign();
  const moose = v === 'moose';
  const u = 0.46 * s, cx = W / 2 - sg * 0.1 * s, cy = H / 2 - 0.04 * s + (moose ? 0.04 * s : 0);
  const T = (x, y) => [cx + sg * x * u, cy + y * u];
  const jit = Array.from({ length: 60 }, () => R.range(-1, 1));
  const head = (moose ? MOOSE_HEAD : DEER_HEAD).map(([x, y], i) => [x + jit[i] * 0.008, y + jit[i + 30] * 0.008]);
  const fur = Array.from({ length: 420 }, () => {
    const x = R.range(-0.62, 0.7), y = R.range(-0.18, 1.75), neck = y > 0.3 || x < -0.15;
    const a = neck ? HALF_PI + R.range(-0.25, 0.25) - 0.3 : 0.35 + R.range(-0.35, 0.35), L = R.range(0.05, 0.13);
    return { x, y, a, L, w: R.range(0.008, 0.018), k: R.pick([1, 2, 4, 1, 3]), al: R.range(0.15, 0.4), seed: seedOf(R) };
  });
  const tines = [R.int(3, 5), R.int(3, 5)];
  const halo = R.range(0.55, 0.75);
  if (v === 'front') return stagFront(c, W, H, R, p, s, { sg, jit, fur, tines, halo });
  // the red stag: wide, heavy antlers with 5–6 tines a side, smaller ears and a dark throat mane (it read as a doe)
  const big = v === 'stag';

  fill(c, W, H, p[0]);
  const g = c.createRadialGradient(cx, cy - 0.05 * s, 0.05 * s, cx, cy - 0.05 * s, halo * s);
  g.addColorStop(0, rgba(mix(p[0], p[2], 0.35), 1));
  g.addColorStop(1, rgba(p[0], 0));
  c.fillStyle = g;
  c.fillRect(0, 0, W, H);
  // antlers (behind the head): stag and reindeer beams with tines, moose palms
  const beam = (side, len, nt, j0) => {
    const b0 = side < 0 ? [-0.1, -0.12] : [0.06, -0.15];
    const dir = side < 0 ? -1 : 1;
    const pts = [];
    for (let k = 0; k <= 6; k++) {
      const t = k / 6;
      const lat = big ? (0.1 + 0.42 * Math.sin(t * 1.9)) * len * t * 1.4 : (0.06 + 0.24 * Math.sin(t * 2.2)) * len * t * 1.6;
      pts.push([b0[0] + dir * lat + jit[j0 + k] * 0.012, b0[1] - t * (big ? 0.8 : 0.85) * len + jit[j0 + k + 7] * 0.012]);
    }
    const out = [{ pts, w0: big ? 0.075 : 0.055, w1: big ? 0.022 : 0.016 }];
    for (let k = 0; k < nt; k++) {
      const t = 0.22 + (k / nt) * 0.72, i = Math.min(5, Math.floor(t * 6)), q = big ? t * 6 - i : 0;
      const bx = pts[i][0] + (pts[i + 1][0] - pts[i][0]) * q, by = pts[i][1] + (pts[i + 1][1] - pts[i][1]) * q;
      const tl = (0.16 + 0.06 * jit[j0 + 14 + k]) * len * (1 - t * 0.4) * (big ? 1.15 : 1);
      const ta = -HALF_PI + dir * (k % 2 ? -0.3 : 0.5) + jit[j0 + 20 + k] * 0.15;
      out.push({ pts: [[bx, by], [bx + Math.cos(ta) * tl * 0.5, by + Math.sin(ta) * tl * 0.5 - 0.01], [bx + Math.cos(ta) * tl, by + Math.sin(ta) * tl]], w0: big ? 0.045 : 0.032, w1: big ? 0.01 : 0.008 });
    }
    return out;
  };
  const parts = [];
  if (moose) {
    for (const side of [-1, 1]) {
      // a palm in (along, up) coordinates, mapped outward from the head
      const dir = side < 0 ? [-0.94, -0.34] : [0.86, -0.5], up = side < 0 ? [-0.34, -0.94] : [0.5, -0.86];
      const base = side < 0 ? [-0.1, -0.1] : [0.05, -0.14], L = side < 0 ? 0.78 : 0.62;
      const M = (a, b) => [base[0] + (dir[0] * a + up[0] * b) * L, base[1] + (dir[1] * a + up[1] * b) * L];
      const pts = [M(0, -0.04), M(0.3, -0.06), M(0.62, -0.02), M(0.86, 0.1)];
      const n = 6;
      for (let k = 0; k <= n; k++) {
        const t = k / n, a = 0.9 - t * 0.75, tip = k % 2 === 0;
        pts.push(M(a + jit[k + (side < 0 ? 40 : 50)] * 0.02, (tip ? 0.42 : 0.3) + Math.sin(t * Math.PI) * 0.06 - t * 0.12));
      }
      pts.push(M(0.1, 0.08));
      parts.push({ plate: pts });
    }
  } else {
    const len = v === 'reindeer' ? 1.15 : 0.92;
    const nt = v === 'reindeer' ? [tines[0] + 2, tines[1] + 2] : tines.map((t) => Math.min(6, t + 2));
    parts.push(...beam(-1, len, nt[0], 0), ...beam(1, len * 0.9, nt[1], 3));
    if (v === 'reindeer') parts.push({ pts: [[0.02, -0.16], [0.14, -0.3], [0.28, -0.29], [0.36, -0.2]], w0: 0.03, w1: 0.05 });
  }
  for (const pt of parts) {
    c.fillStyle = p[4];
    c.beginPath();
    if (pt.plate) smoothPath(c, pt.plate.map(([x, y]) => T(x, y)), true);
    else taperPath(c, pt.pts.map(([x, y]) => T(x, y)), pt.w0 * u, pt.w1 * u);
    c.fill();
    c.globalAlpha = 0.5;
    c.strokeStyle = p[2];
    c.lineWidth = 0.006 * s;
    c.stroke();
    c.globalAlpha = 1;
  }
  // head and neck on a layer: fur strokes land only on the silhouette (source-atop on the layer)
  const l = layer(W, H);
  const x = l.x;
  x.fillStyle = p[1];
  smoothPath(x, head.map(([a, b]) => T(a, b)), true);
  x.fill();
  // deer ears about 40 % smaller than a doe's (stag and reindeer); the moose keeps its own
  const ears = moose ? [EAR(-0.1, -0.08, -2.5, 0.26, 0.09), EAR(0.04, -0.13, -1.95, 0.24, 0.08)] : [EAR(-0.12, -0.08, -2.45, 0.2, 0.078), EAR(0.04, -0.14, -1.85, 0.18, 0.07)];
  for (const e of ears) {
    smoothPath(x, e.map(([a, b]) => T(a, b)), true);
    x.fill();
  }
  if (big) {
    // shaggy throat mane: tufts hanging from the front of the neck
    x.beginPath();
    for (let k = 0; k < 9; k++) {
      const t = k / 8, y = 0.45 + t * 0.95, xe = 0.04 + 0.022 * t + 0.16 * t * t, L = 0.07 + 0.035 * jit[40 + k];
      const [ax, ay] = T(xe - 0.03, y - 0.05), [bx, by] = T(xe + L * 0.62, y + L * 0.78), [cx2, cy2] = T(xe - 0.035, y + 0.045);
      x.moveTo(ax, ay);
      x.quadraticCurveTo(...T(xe + L * 0.2, y + L * 0.1), bx, by);
      x.quadraticCurveTo(...T(xe + L * 0.05, y + L * 0.55), cx2, cy2);
      x.closePath();
    }
    x.fill();
  }
  x.globalCompositeOperation = 'source-atop';
  for (const f of fur) {
    const [fx, fy] = T(f.x, f.y), dx = Math.cos(f.a) * f.L * u * sg, dy = Math.sin(f.a) * f.L * u;
    brush(x, rngFrom(f.seed), fx - dx / 2, fy - dy / 2, fx + dx / 2, fy + dy / 2, f.w * u, p[f.k], f.al, 3);
  }
  if (big) {
    // the mane darkens the lower neck and throat: long dark strokes and a shade toward the chest
    fur.forEach((f, i) => {
      if (f.y < 0.55 || i % 2) return;
      const a = HALF_PI + (f.a - HALF_PI + 0.3) * 0.5 - 0.15, L = f.L * u * 1.7;
      const [fx, fy] = T(f.x, f.y), dx = Math.cos(a) * L * sg, dy = Math.sin(a) * L;
      brush(x, rngFrom(f.seed), fx - dx / 2, fy - dy / 2, fx + dx / 2, fy + dy / 2, f.w * u * 1.2, p[3], Math.min(0.75, f.al + 0.25), 3);
    });
    const mg = x.createLinearGradient(...T(0, 0.5), ...T(0, 1.6));
    mg.addColorStop(0, rgba(p[3], 0));
    mg.addColorStop(1, rgba(p[3], 0.5));
    x.fillStyle = mg;
    x.fillRect(0, 0, W, H);
  }
  // ear insides, a light muzzle, a pale throat; shade toward the back of the neck
  x.fillStyle = rgba(p[4], 0.45);
  smoothPath(x, EAR(...(moose ? [-0.1, -0.08, -2.5, 0.2, 0.05] : [-0.12, -0.08, -2.45, 0.155, 0.04])).map(([a, b]) => T(a, b)), true);
  x.fill();
  const mz = x.createRadialGradient(...T(moose ? 0.6 : 0.48, 0.2), 0.02 * u, ...T(moose ? 0.6 : 0.48, 0.2), (moose ? 0.26 : 0.2) * u);
  mz.addColorStop(0, rgba(p[4], 0.5));
  mz.addColorStop(1, rgba(p[4], 0));
  x.fillStyle = mz;
  x.fillRect(0, 0, W, H);
  const th = x.createRadialGradient(...T(0.06, 0.6), 0.02 * u, ...T(0.06, 0.6), 0.32 * u);
  th.addColorStop(0, rgba(p[4], v === 'reindeer' ? 0.55 : 0.25));
  th.addColorStop(1, rgba(p[4], 0));
  x.fillStyle = th;
  x.fillRect(0, 0, W, H);
  const shade = x.createLinearGradient(...T(-0.65, 0), ...T(0.25, 0));
  shade.addColorStop(0, rgba(p[3], 0.55));
  shade.addColorStop(1, rgba(p[3], 0));
  x.fillStyle = shade;
  x.fillRect(0, 0, W, H);
  blurOnto(c, l, 0);
  // face: eye with a highlight, nostril, mouth line
  const [ex, ey] = T(moose ? 0.17 : 0.15, moose ? -0.02 : -0.04), [nx, ny] = T(moose ? 0.67 : 0.54, moose ? 0.27 : 0.17);
  c.fillStyle = p[3];
  ellipse(c, ex, ey, 0.032 * u, 0.024 * u, sg * 0.35);
  ellipse(c, nx, ny, (moose ? 0.04 : 0.045) * u, 0.03 * u, sg * 0.6);
  c.fillStyle = p[4];
  circle(c, ex + sg * 0.009 * u, ey - 0.008 * u, 0.008 * u);
  c.strokeStyle = p[3];
  c.lineWidth = 0.008 * u;
  c.lineCap = 'round';
  c.beginPath();
  c.moveTo(...T(moose ? 0.6 : 0.5, moose ? 0.37 : 0.26));
  c.quadraticCurveTo(...T(moose ? 0.52 : 0.44, moose ? 0.39 : 0.29), ...T(moose ? 0.44 : 0.38, moose ? 0.38 : 0.29));
  c.stroke();
  vignette(c, W, H, 0.4);
  grain(c, W, H, R, 0.05);
}

// ---------------------------------------------------------------------------------------------------------------
// Botanisk

const LATIN = { ginkgo: 'Ginkgo biloba', fern: 'Dryopteris filix-mas', eucalyptus: 'Eucalyptus gunnii', olive: 'Olea europaea', monstera: 'Monstera deliciosa', poppy: 'Papaver rhoeas' };

/** Monstera leaf (local: petiole at the origin, tip at (0, −L)) with slits and holes cut in `cut`. */
function monsteraLeaf(c, L, col, cut, slits, holes, rib) {
  const w = L * 0.46;
  c.fillStyle = col;
  c.beginPath();
  c.moveTo(0, -L * 0.08);
  c.bezierCurveTo(-w * 0.5, L * 0.05, -w * 1.15, -L * 0.15, -w * 1.02, -L * 0.48);
  c.bezierCurveTo(-w * 0.9, -L * 0.8, -w * 0.35, -L * 0.98, 0, -L);
  c.bezierCurveTo(w * 0.35, -L * 0.98, w * 0.9, -L * 0.8, w * 1.02, -L * 0.48);
  c.bezierCurveTo(w * 1.15, -L * 0.15, w * 0.5, L * 0.05, 0, -L * 0.08);
  c.closePath();
  c.fill();
  c.fillStyle = cut;
  for (const [t, side, dep, wid] of slits) {
    const y = -L * (0.12 + 0.8 * t), ex = side * w * 1.25;
    c.beginPath();
    c.moveTo(side * w * 0.22 * dep, y);
    c.lineTo(ex, y - L * 0.06 - wid * L * 0.5);
    c.lineTo(ex, y - L * 0.06 + wid * L * 0.5);
    c.closePath();
    c.fill();
  }
  for (const [t, side, r] of holes) {
    ellipse(c, side * w * 0.4, -L * (0.2 + 0.6 * t), r * L * 0.6, r * L, side * 0.4);
  }
  c.strokeStyle = rib;
  c.lineWidth = L * 0.012;
  c.beginPath();
  c.moveTo(0, -L * 0.05);
  c.quadraticCurveTo(L * 0.02, -L * 0.5, 0, -L * 0.95);
  c.stroke();
}

function botanicalPrint(c, W, H, R, p, o) {
  const s = S(W, H);
  const v = variantOf(R, o, ['ginkgo', 'fern', 'eucalyptus', 'olive', 'monstera', 'poppy']);
  const u = Math.min(0.7 * H, 0.95 * W), bx = W / 2, by = 0.82 * H - 0.01 * s;
  const sw = R.range(-0.08, 0.08), lean = R.range(-0.1, 0.1);
  // stem bezier from the base (bx, by) to the tip
  const S0 = [bx, by], S1 = [bx + (sw - 0.05) * u, by - 0.35 * u], S2 = [bx + (lean + 0.04) * u, by - 0.65 * u], S3 = [bx + lean * u, by - 0.92 * u];
  const at = (t) => {
    const k = 1 - t;
    return [
      k * k * k * S0[0] + 3 * k * k * t * S1[0] + 3 * k * t * t * S2[0] + t * t * t * S3[0],
      k * k * k * S0[1] + 3 * k * k * t * S1[1] + 3 * k * t * t * S2[1] + t * t * t * S3[1],
    ];
  };
  const leaves = Array.from({ length: 30 }, (_, i) => ({ t: R(), side: i % 2 ? 1 : -1, a: R.range(0.5, 1.1), sz: R.range(0.85, 1.15), j: R.range(-1, 1), k: R() }));
  const slits = Array.from({ length: R.int(6, 9) }, (_, i) => [R.range(0.05, 0.95), i % 2 ? 1 : -1, R.range(0.6, 1.4), R.range(0.025, 0.05)]);
  const holes = Array.from({ length: R.int(2, 5) }, (_, i) => [R.range(0.1, 0.8), i % 2 ? 1 : -1, R.range(0.025, 0.045)]);
  const nLeaf = R.int(5, 9), nPinna = R.int(20, 30), nOlive = R.int(3, 6);

  fill(c, W, H, p[0]);
  c.strokeStyle = p[3];
  c.lineWidth = 0.002 * s;
  c.strokeRect(0.04 * s, 0.04 * s, W - 0.08 * s, H - 0.08 * s);
  c.lineCap = 'round';
  c.lineJoin = 'round';
  const stem = (w = 0.006 * s, t1 = 1) => {
    c.strokeStyle = p[3];
    c.lineWidth = w;
    c.beginPath();
    c.moveTo(...S0);
    const n = 24;
    for (let i = 1; i <= n; i++) c.lineTo(...at((i / n) * t1));
    c.stroke();
  };
  const tangent = (t) => {
    const a = at(Math.max(0, t - 0.02)), b = at(Math.min(1, t + 0.02));
    return Math.atan2(b[1] - a[1], b[0] - a[0]);
  };
  if (v === 'ginkgo') {
    stem(0.005 * s, 0.85);
    for (let i = 0; i < nLeaf; i++) {
      const lf = leaves[i], t = 0.2 + (0.65 * i) / nLeaf + lf.j * 0.03, [x, y] = at(t);
      const a = tangent(t) + lf.side * lf.a, pl = 0.12 * u * lf.sz, r = 0.13 * u * lf.sz;
      const tx = x + Math.cos(a) * pl, ty = y + Math.sin(a) * pl;
      c.strokeStyle = p[3];
      c.lineWidth = 0.003 * s;
      c.beginPath();
      c.moveTo(x, y);
      c.lineTo(tx, ty);
      c.stroke();
      const spread = 0.62 + 0.15 * lf.k;
      c.fillStyle = p[1];
      c.beginPath();
      c.moveTo(tx, ty);
      c.arc(tx, ty, r, a - spread, a - 0.07);
      c.lineTo(tx + Math.cos(a) * r * 0.72, ty + Math.sin(a) * r * 0.72);
      c.arc(tx, ty, r, a + 0.07, a + spread);
      c.closePath();
      c.fill();
      c.globalAlpha = 0.4;
      c.strokeStyle = p[3];
      c.lineWidth = 0.0012 * s;
      c.beginPath();
      for (let k = -4; k <= 4; k++) {
        const va = a + (k / 4.6) * spread;
        c.moveTo(tx + Math.cos(va) * r * 0.08, ty + Math.sin(va) * r * 0.08);
        c.lineTo(tx + Math.cos(va) * r * 0.95, ty + Math.sin(va) * r * 0.95);
      }
      c.stroke();
      c.globalAlpha = 1;
    }
  } else if (v === 'fern') {
    stem(0.005 * s);
    for (let i = 0; i < nPinna; i++) {
      const t = 0.12 + (0.86 * i) / nPinna, [x, y] = at(t), a0 = tangent(t);
      const len = 0.24 * u * (1 - t * 0.85) * leaves[i % 30].sz;
      for (const side of [-1, 1]) {
        const a = a0 + side * (1.1 - t * 0.3);
        c.save();
        c.translate(x, y);
        c.rotate(a);
        c.fillStyle = side < 0 ? p[1] : mix(p[1], p[2], 0.25);
        c.beginPath();
        c.moveTo(0, 0);
        const lobes = 5, wd = len * 0.16;
        for (let k = 1; k <= lobes; k++) c.quadraticCurveTo(len * ((k - 0.5) / lobes), -wd * (1.25 - k / lobes), len * (k / lobes), -wd * 0.25 * (1 - k / lobes));
        for (let k = lobes; k >= 1; k--) c.quadraticCurveTo(len * ((k - 0.5) / lobes), wd * (1.25 - k / lobes), len * ((k - 1) / lobes), wd * 0.25 * (1 - (k - 1) / lobes));
        c.fill();
        c.restore();
      }
    }
  } else if (v === 'eucalyptus') {
    stem(0.004 * s, 0.95);
    // opposite pairs of round leaves on short stalks, and two side twigs
    const coin = (x, y, a, r, d) => {
      const lx = x + Math.cos(a) * d, ly = y + Math.sin(a) * d;
      c.strokeStyle = p[3];
      c.lineWidth = 0.002 * s;
      c.beginPath();
      c.moveTo(x, y);
      c.lineTo(lx, ly);
      c.stroke();
      c.fillStyle = p[2];
      circle(c, lx, ly, r);
      c.strokeStyle = p[1];
      c.lineWidth = 0.003 * s;
      c.beginPath();
      c.arc(lx, ly, r, 0, TAU);
      c.stroke();
    };
    const tw = leaves[20].k < 0.5 ? -1 : 1;
    for (const [t0, side, len] of [[0.36, tw, 0.3]]) {
      const [x, y] = at(t0), a = tangent(t0) + side * 0.7, ex = x + Math.cos(a) * len * u, ey = y + Math.sin(a) * len * u;
      c.strokeStyle = p[3];
      c.lineWidth = 0.003 * s;
      c.beginPath();
      c.moveTo(x, y);
      c.lineTo(ex, ey);
      c.stroke();
      for (let k = 1; k <= 4; k++) {
        const q = k / 4.4, px = x + (ex - x) * q, py = y + (ey - y) * q, r = 0.032 * u * (1.1 - q * 0.4);
        for (const sd of [-1, 1]) coin(px, py, a + sd * 1.3, r, r * 1.45);
      }
    }
    for (let i = 0; i < 8; i++) {
      const t = 0.1 + (0.86 * i) / 8, [x, y] = at(t), a0 = tangent(t), r = 0.04 * u * (1.1 - t * 0.5) * leaves[i].sz;
      for (const side of [-1, 1]) coin(x, y, a0 + side * HALF_PI * (0.8 + 0.2 * leaves[i + 9].k), r, r * 1.45);
    }
  } else if (v === 'olive') {
    stem(0.004 * s, 0.95);
    for (let i = 0; i < 16; i++) {
      const t = 0.1 + (0.85 * i) / 16, [x, y] = at(t), a = tangent(t) + leaves[i].side * (0.55 + 0.25 * leaves[i].k), L = 0.17 * u * leaves[i].sz;
      c.fillStyle = i % 3 ? p[1] : p[2];
      ellipse(c, x + (Math.cos(a) * L) / 2, y + (Math.sin(a) * L) / 2, L / 2, L * 0.09, a);
    }
    for (let i = 0; i < nOlive; i++) {
      const t = 0.25 + (0.6 * i) / nOlive, [x, y] = at(t), a = tangent(t) - leaves[i + 16].side * 1.2;
      const ox = x + Math.cos(a) * 0.05 * u, oy = y + Math.sin(a) * 0.05 * u;
      c.strokeStyle = p[3];
      c.lineWidth = 0.002 * s;
      c.beginPath();
      c.moveTo(x, y);
      c.lineTo(ox, oy);
      c.stroke();
      c.fillStyle = p[3];
      ellipse(c, ox, oy, 0.025 * u, 0.034 * u, a - HALF_PI);
      c.globalAlpha = 0.35;
      c.fillStyle = p[0];
      circle(c, ox - 0.008 * u, oy - 0.01 * u, 0.007 * u);
      c.globalAlpha = 1;
    }
  } else if (v === 'monstera') {
    const [x, y] = at(0.3);
    stem(0.008 * s, 0.3);
    c.save();
    c.translate(x, y);
    c.rotate(tangent(0.3) + HALF_PI + lean);
    monsteraLeaf(c, 0.66 * u, p[1], p[0], slits, holes, tint(p[1], -0.2));
    c.restore();
  } else {
    // poppy: a flower, a bud, a seed pod and lobed leaves at the base
    stem(0.004 * s, 0.86);
    const [fx, fy] = at(0.86), fr = 0.12 * u;
    c.strokeStyle = p[3];
    c.lineWidth = 0.003 * s;
    const bud = [bx - 0.2 * u, by - 0.55 * u], pod = [bx + 0.2 * u, by - 0.62 * u];
    c.beginPath();
    c.moveTo(bx, by);
    c.quadraticCurveTo(bx - 0.18 * u, by - 0.3 * u, bud[0], bud[1] + 0.06 * u);
    c.moveTo(bx, by);
    c.quadraticCurveTo(bx + 0.18 * u, by - 0.35 * u, pod[0], pod[1] + 0.05 * u);
    c.stroke();
    c.globalAlpha = 0.6;
    c.lineWidth = 0.0012 * s;
    c.beginPath();
    for (let i = 0; i < 24; i++) {
      const [hx, hy] = at(0.1 + leaves[i].t * 0.7), a = tangent(0.5) + leaves[i].side * 0.9;
      c.moveTo(hx, hy);
      c.lineTo(hx + Math.cos(a) * 0.012 * u, hy + Math.sin(a) * 0.012 * u);
    }
    c.stroke();
    c.globalAlpha = 1;
    c.fillStyle = p[1];
    for (const [side, ang, len] of [[-1, 0.75, 0.3], [1, 0.6, 0.34], [-1, 0.25, 0.24]]) {
      c.save();
      c.translate(bx, by);
      c.rotate(-HALF_PI + side * ang);
      const L = len * u, pts = [[0, -0.01 * u]];
      for (let k = 1; k <= 5; k++) {
        const t = k / 5.6, w = 0.06 * u * (1 - t * 0.6);
        pts.push([t * L - 0.03 * u, -w * 0.35], [t * L, -w], [t * L + 0.02 * u, -w * 0.3]);
      }
      pts.push([L, 0]);
      for (let k = 5; k >= 1; k--) {
        const t = k / 5.6, w = 0.05 * u * (1 - t * 0.6);
        pts.push([t * L + 0.02 * u, w * 0.3], [t * L, w], [t * L - 0.03 * u, w * 0.35]);
      }
      pts.push([0, 0.01 * u]);
      poly(c, pts);
      c.fill();
      c.restore();
    }
    c.fillStyle = p[2];
    ellipse(c, pod[0], pod[1], 0.035 * u, 0.045 * u);
    c.fillStyle = p[3];
    ellipse(c, pod[0], pod[1] - 0.045 * u, 0.03 * u, 0.008 * u);
    c.fillStyle = p[1];
    ellipse(c, bud[0], bud[1], 0.03 * u, 0.05 * u, 0.4);
    c.fillStyle = p[4];
    for (let k = 0; k < 4; k++) {
      const a = -HALF_PI + (k - 1.5) * 0.9 + leaves[k].j * 0.15;
      ellipse(c, fx + Math.cos(a) * fr * 0.55, fy + Math.sin(a) * fr * 0.45, fr * 0.68, fr * 0.55, a);
    }
    c.fillStyle = tint(p[4], -0.18);
    ellipse(c, fx, fy - fr * 0.1, fr * 0.5, fr * 0.36);
    c.fillStyle = p[3];
    ellipse(c, fx, fy - fr * 0.2, fr * 0.22, fr * 0.18);
    c.fillStyle = p[2];
    ellipse(c, fx, fy - fr * 0.3, fr * 0.14, fr * 0.06);
  }
  // label and rule
  const ly = H - 0.08 * s;
  c.strokeStyle = p[3];
  c.lineWidth = 0.0015 * s;
  c.beginPath();
  c.moveTo(W / 2 - 0.15 * s, ly - 0.045 * s);
  c.lineTo(W / 2 + 0.15 * s, ly - 0.045 * s);
  c.stroke();
  c.fillStyle = p[3];
  c.font = `italic 400 ${(0.03 * s).toFixed(1)}px ${FONTS.italic}`;
  c.textAlign = 'center';
  c.textBaseline = 'alphabetic';
  c.fillText(LATIN[v], W / 2, ly);
  grain(c, W, H, R, 0.035);
}

function bigLeaf(c, W, H, R, p, o) {
  const s = S(W, H);
  const v = variantOf(R, o, ['palm', 'monstera', 'striped', 'banana']);
  const rot = R.range(-0.6, 0.6), block = R() < 0.4, blockSide = R.sign();
  const L = 0.8 * s * R.range(0.95, 1.15);
  const cx = W / 2 + R.range(-0.08, 0.08) * s, cy = H / 2 + R.range(0.15, 0.3) * s;
  const fr = Array.from({ length: R.int(9, 15) }, () => [R.range(0.85, 1.1), R.range(-0.04, 0.04)]);
  const slits = Array.from({ length: R.int(6, 9) }, (_, i) => [R.range(0.05, 0.95), i % 2 ? 1 : -1, R.range(0.6, 1.3), R.range(0.025, 0.05)]);
  const holes = Array.from({ length: R.int(2, 5) }, (_, i) => [R.range(0.1, 0.8), i % 2 ? 1 : -1, R.range(0.025, 0.045)]);
  const stripes = R.int(8, 14);
  const tears = Array.from({ length: R.int(4, 8) }, () => [R.range(0.1, 0.9), R.sign(), R.range(0.4, 1)]);

  fill(c, W, H, p[0]);
  if (block) {
    c.fillStyle = p[4];
    c.fillRect(blockSide < 0 ? 0.08 * W : 0.3 * W, 0.1 * H, 0.62 * W, 0.8 * H);
  }
  c.save();
  c.translate(cx, cy);
  c.rotate(rot);
  if (v === 'palm') {
    const n = fr.length;
    c.strokeStyle = p[3];
    c.lineWidth = 0.012 * s;
    c.lineCap = 'round';
    c.beginPath();
    c.moveTo(0, 0.4 * L);
    c.lineTo(0, 0);
    c.stroke();
    for (let i = 0; i < n; i++) {
      const a = -Math.PI + 0.15 + ((Math.PI - 0.3) * i) / (n - 1) + fr[i][1], len = L * 0.62 * fr[i][0] * (0.75 + 0.25 * Math.sin((Math.PI * i) / (n - 1)));
      c.fillStyle = i % 2 ? p[1] : tint(p[1], -0.12);
      c.beginPath();
      c.ellipse(Math.cos(a) * len * 0.5, Math.sin(a) * len * 0.5, len * 0.5, len * 0.045, a, 0, TAU);
      c.fill();
    }
    c.fillStyle = tint(p[1], -0.25);
    circle(c, 0, 0, 0.025 * L);
  } else if (v === 'monstera') {
    monsteraLeaf(c, L, p[1], block ? p[4] : p[0], slits, holes, tint(p[1], -0.22));
    // the cut colour must be the backdrop where the leaf crosses the block edge: draw slits again over the paper
  } else if (v === 'striped') {
    c.save();
    c.beginPath();
    c.ellipse(0, -L * 0.45, L * 0.24, L * 0.45, 0, 0, TAU);
    c.fillStyle = p[2];
    c.fill();
    c.clip();
    c.lineCap = 'round';
    for (let k = 0; k < stripes; k++) {
      const y = -L * 0.05 - (k / stripes) * L * 0.85;
      for (const side of [-1, 1]) {
        c.strokeStyle = k % 2 ? p[3] : p[1];
        c.lineWidth = L * 0.022;
        c.beginPath();
        c.moveTo(0, y);
        c.quadraticCurveTo(side * L * 0.1, y - L * 0.06, side * L * 0.3, y - L * 0.14);
        c.stroke();
      }
    }
    c.restore();
    c.strokeStyle = p[3];
    c.lineWidth = L * 0.012;
    c.beginPath();
    c.moveTo(0, L * 0.3);
    c.lineTo(0, -L * 0.88);
    c.stroke();
  } else {
    // banana: a long blade, a midrib and torn slits
    const w = L * 0.2;
    c.fillStyle = p[1];
    c.beginPath();
    c.moveTo(0, L * 0.1);
    c.bezierCurveTo(-w * 1.2, -L * 0.2, -w * 1.1, -L * 0.8, 0, -L * 1.05);
    c.bezierCurveTo(w * 1.1, -L * 0.8, w * 1.2, -L * 0.2, 0, L * 0.1);
    c.fill();
    c.strokeStyle = block ? p[4] : p[0];
    c.lineWidth = L * 0.008;
    c.beginPath();
    for (const [t, side, dep] of tears) {
      const y = L * 0.05 - t * L * 1.05, ew = w * 1.05 * Math.sin(Math.PI * Math.min(1, t * 1.05 + 0.02));
      c.moveTo(side * ew * (1 - dep), y);
      c.lineTo(side * ew * 1.1, y - L * 0.05);
    }
    c.stroke();
    c.strokeStyle = tint(p[1], 0.3);
    c.lineWidth = L * 0.015;
    c.beginPath();
    c.moveTo(0, L * 0.35);
    c.quadraticCurveTo(L * 0.01, -L * 0.4, 0, -L * 1.0);
    c.stroke();
    c.globalAlpha = 0.25;
    c.strokeStyle = p[3];
    c.lineWidth = L * 0.003;
    c.beginPath();
    for (let k = 1; k < 22; k++) {
      const y = L * 0.05 - (k / 22) * L * 1.0;
      for (const side of [-1, 1]) {
        c.moveTo(0, y);
        c.lineTo(side * w * 0.95 * Math.sin(Math.PI * (k / 22)), y - L * 0.06);
      }
    }
    c.stroke();
    c.globalAlpha = 1;
  }
  c.restore();
  grain(c, W, H, R, 0.03);
}

/** Fruit shapes centred at (x, y), size r. */
function lemonPath(c, x, y, r, a) {
  c.save();
  c.translate(x, y);
  c.rotate(a);
  c.beginPath();
  c.moveTo(-r * 1.22, 0);
  c.bezierCurveTo(-r * 1.05, -r * 0.2, -r * 0.8, -r * 0.82, 0, -r * 0.82);
  c.bezierCurveTo(r * 0.8, -r * 0.82, r * 1.05, -r * 0.2, r * 1.22, 0);
  c.bezierCurveTo(r * 1.05, r * 0.2, r * 0.8, r * 0.82, 0, r * 0.82);
  c.bezierCurveTo(-r * 0.8, r * 0.82, -r * 1.05, r * 0.2, -r * 1.22, 0);
  c.restore();
}
function applePath(c, x, y, r) {
  c.beginPath();
  c.moveTo(x, y - r * 0.72);
  c.bezierCurveTo(x + r * 0.45, y - r * 1.1, x + r * 1.15, y - r * 0.85, x + r * 1.05, y - r * 0.05);
  c.bezierCurveTo(x + r, y + r * 0.75, x + r * 0.45, y + r * 1.02, x, y + r * 0.88);
  c.bezierCurveTo(x - r * 0.45, y + r * 1.02, x - r, y + r * 0.75, x - r * 1.05, y - r * 0.05);
  c.bezierCurveTo(x - r * 1.15, y - r * 0.85, x - r * 0.45, y - r * 1.1, x, y - r * 0.72);
  c.closePath();
}
function pearPath(c, x, y, r) {
  c.beginPath();
  c.moveTo(x, y - r * 1.25);
  c.bezierCurveTo(x + r * 0.42, y - r * 1.25, x + r * 0.45, y - r * 0.55, x + r * 0.7, y - r * 0.15);
  c.bezierCurveTo(x + r * 1.15, y + r * 0.45, x + r * 0.9, y + r, x, y + r);
  c.bezierCurveTo(x - r * 0.9, y + r, x - r * 1.15, y + r * 0.45, x - r * 0.7, y - r * 0.15);
  c.bezierCurveTo(x - r * 0.45, y - r * 0.55, x - r * 0.42, y - r * 1.25, x, y - r * 1.25);
  c.closePath();
}
const FRUIT_LATIN = ['Citrus limon', 'Malus domestica', 'Pyrus communis', 'Prunus avium', 'Prunus domestica', 'Ficus carica'];

function fruit(c, W, H, R, p, o) {
  const s = S(W, H);
  const v = variantOf(R, o, ['lemons', 'apples', 'pears', 'chart']);
  const tiled = R() < 0.4;
  // a lemon branch: lemons hang on short stalks under a curved twig, leaves before and behind them
  const b0 = R.range(-0.07, 0.07), b1 = R.range(-0.07, 0.07), sag = R.range(0.04, 0.1);
  const twig = (u) => H / 2 - 0.16 * s + s * (b0 + (b1 - b0) * u) + sag * s * Math.sin(Math.PI * u);
  const nLem = R.int(3, 6);
  const lem = Array.from({ length: nLem }, (_, i) => {
    const u = (i + 0.5 + R.range(-0.2, 0.2)) / nLem * 0.8 + 0.1, r = R.range(0.09, 0.12) * s, st = R.range(0.03, 0.16) * s;
    return [u * W, twig(u) + st + r * 0.85, r, HALF_PI * 0.75 + R.range(-0.45, 0.45), st];
  });
  const leafs = Array.from({ length: 9 }, (_, i) => [(i + R.range(0.1, 0.9)) / 9, R.sign(), R.range(0.75, 1.1), R() < 0.4]);
  const nPear = R.int(2, 3);
  const pears = Array.from({ length: nPear }, (_, i) => [W / 2 + (i - (nPear - 1) / 2) * 0.31 * s + R.range(-0.03, 0.03) * s, H / 2 + R.range(0.02, 0.1) * s, R.range(0.13, 0.17) * s, R.pick([1, 4, 2]), R.range(-0.25, 0.25)]);
  const chart = shuffled(R, [0, 1, 2, 3, 4, 5]);
  const apple = { r: R.range(0.26, 0.31) * s, dx: R.range(-0.05, 0.05), two: R() < 0.5, side: R.sign(), leaf: R.range(-0.8, -0.2), leaf2: R.range(-0.8, -0.2) };

  fill(c, W, H, p[0]);
  const shine = (x, y, r) => {
    c.globalAlpha = 0.45;
    c.fillStyle = tint(p[0], 0.4);
    ellipse(c, x - r * 0.35, y - r * 0.35, r * 0.2, r * 0.12, -0.6);
    c.globalAlpha = 1;
  };
  const shadow = (x, y, r) => {
    c.globalAlpha = 0.15;
    c.fillStyle = p[3];
    ellipse(c, x + r * 0.1, y + r * 0.9, r * 0.95, r * 0.18);
    c.globalAlpha = 1;
  };
  const leaf = (x, y, L, a, col = p[2]) => {
    c.fillStyle = col;
    c.save();
    c.translate(x, y);
    c.rotate(a);
    c.beginPath();
    c.moveTo(0, 0);
    c.quadraticCurveTo(L * 0.5, -L * 0.32, L, 0);
    c.quadraticCurveTo(L * 0.5, L * 0.32, 0, 0);
    c.fill();
    c.strokeStyle = tint(col, -0.2);
    c.lineWidth = L * 0.03;
    c.beginPath();
    c.moveTo(0, 0);
    c.lineTo(L * 0.9, 0);
    c.stroke();
    c.restore();
  };
  const drawLemon = (x, y, r, a, ground = true) => {
    if (ground) shadow(x, y, r);
    c.fillStyle = p[1];
    lemonPath(c, x, y, r, a);
    c.fill();
    c.save();
    lemonPath(c, x, y, r, a);
    c.clip();
    c.globalAlpha = 0.3;
    c.fillStyle = tint(p[1], -0.3);
    ellipse(c, x + r * 0.6, y + r * 0.65, r * 1.1, r * 0.95);
    c.restore();
    c.globalAlpha = 1;
    shine(x, y, r);
  };
  const drawApple = (x, y, r, col = p[1], la = -0.5) => {
    shadow(x, y + r * 0.05, r);
    c.fillStyle = col;
    applePath(c, x, y, r);
    c.fill();
    c.strokeStyle = p[3];
    c.lineWidth = r * 0.06;
    c.lineCap = 'round';
    c.beginPath();
    c.moveTo(x, y - r * 0.68);
    c.quadraticCurveTo(x + r * 0.05, y - r * 1.0, x + r * 0.15, y - r * 1.2);
    c.stroke();
    leaf(x + r * 0.1, y - r * 1.0, r * 0.7, la);
    shine(x, y, r);
  };
  const drawPear = (x, y, r, col, a) => {
    shadow(x, y, r);
    c.save();
    c.translate(x, y);
    c.rotate(a);
    c.fillStyle = col;
    pearPath(c, 0, 0, r);
    c.fill();
    c.strokeStyle = p[3];
    c.lineWidth = r * 0.06;
    c.beginPath();
    c.moveTo(0, -r * 1.2);
    c.quadraticCurveTo(r * 0.05, -r * 1.45, -r * 0.08, -r * 1.6);
    c.stroke();
    c.restore();
    shine(x, y + r * 0.3, r);
  };

  if (v === 'lemons') {
    if (tiled) {
      const sp = 0.25 * s, cols = Math.ceil(W / sp) + 1, rows = Math.ceil(H / sp) + 1;
      for (let j = 0; j < rows; j++) {
        for (let i = 0; i < cols; i++) {
          const x = (i + (j % 2 ? 0.5 : 0)) * sp, y = (j + 0.3) * sp, a = (i + j) % 2 ? 0.5 : -0.4;
          leaf(x + 0.03 * s, y - 0.03 * s, 0.09 * s, a - 1.4);
          drawLemon(x, y + 0.02 * s, 0.065 * s, a);
        }
      }
    } else {
      c.strokeStyle = p[3];
      c.lineCap = 'round';
      c.lineWidth = 0.011 * s;
      c.beginPath();
      for (let k = 0; k <= 32; k++) c.lineTo((k / 32) * (W * 1.04) - 0.02 * W, twig(k / 32));
      c.stroke();
      const leafAt = ([t, sd, k]) => leaf(W * t, twig(t), 0.17 * s * k, sd < 0 ? -2.3 + t * 0.4 : 0.6 + t * 0.4, mix(p[2], p[3], sd < 0 ? 0 : 0.25));
      leafs.filter((l) => !l[3]).forEach(leafAt);
      c.lineWidth = 0.005 * s;
      c.beginPath();
      for (const [x, y, r, a, st] of lem) {
        c.moveTo(x, y - r * 0.85 - st);
        c.lineTo(x - Math.cos(a) * r * 0.9, y - Math.sin(a) * r * 0.9);
      }
      c.stroke();
      for (const [x, y, r, a] of lem) drawLemon(x, y, r, a, false);
      leafs.filter((l) => l[3]).forEach(leafAt);
    }
  } else if (v === 'apples') {
    if (apple.two) drawApple(W / 2 + apple.side * 0.24 * s, H / 2 - 0.02 * s, apple.r * 0.62, mix(p[1], p[2], 0.45), apple.leaf2);
    drawApple(W / 2 + apple.dx * s, H / 2 + 0.06 * s, apple.r, p[1], apple.leaf);
  } else if (v === 'pears') {
    for (const [x, y, r, k, a] of pears) drawPear(x, y, r, p[k], a);
  } else {
    // vintage plate: 2 × 3 fruit studies with labels
    const cols = W > H ? 3 : 2, rows = W > H ? 2 : 3, m = 0.08 * s;
    const cw = (W - 2 * m) / cols, ch = (H - 2 * m) / rows;
    c.strokeStyle = p[3];
    c.lineWidth = 0.0015 * s;
    c.strokeRect(m * 0.6, m * 0.6, W - m * 1.2, H - m * 1.2);
    for (let k = 0; k < 6; k++) {
      const i = k % cols, j = Math.floor(k / cols), x = m + (i + 0.5) * cw, y = m + (j + 0.42) * ch, r = Math.min(cw, ch) * 0.22;
      const f = chart[k];
      if (f === 0) drawLemon(x, y, r, -0.3);
      else if (f === 1) drawApple(x, y, r * 0.95, p[1]);
      else if (f === 2) drawPear(x, y + r * 0.2, r * 0.8, p[2], 0.15);
      else if (f === 3 || f === 4) {
        const col = f === 3 ? p[1] : mix(p[3], p[1], 0.4);
        c.strokeStyle = p[3];
        c.lineWidth = r * 0.04;
        c.beginPath();
        c.moveTo(x - r * 0.35, y);
        c.quadraticCurveTo(x - r * 0.1, y - r * 0.9, x + r * 0.1, y - r * 1.0);
        c.moveTo(x + r * 0.35, y + r * 0.05);
        c.quadraticCurveTo(x + r * 0.2, y - r * 0.8, x + r * 0.1, y - r * 1.0);
        c.stroke();
        c.fillStyle = col;
        circle(c, x - r * 0.35, y + r * 0.1, r * (f === 3 ? 0.35 : 0.42));
        circle(c, x + r * 0.35, y + r * 0.15, r * (f === 3 ? 0.35 : 0.42));
        shine(x - r * 0.3, y + r * 0.12, r * 0.4);
        leaf(x + r * 0.1, y - r * 1.0, r * 0.6, -0.3);
      } else {
        c.fillStyle = mix(p[3], p[4], 0.35);
        pearPath(c, x, y, r * 0.8);
        c.fill();
        shine(x, y + r * 0.2, r * 0.8);
      }
      c.fillStyle = p[3];
      c.font = `italic 400 ${(0.025 * s).toFixed(1)}px ${FONTS.italic}`;
      c.textAlign = 'center';
      c.textBaseline = 'alphabetic';
      c.fillText(FRUIT_LATIN[f], x, m + (j + 0.92) * ch);
    }
  }
  grain(c, W, H, R, 0.035);
}

// ---------------------------------------------------------------------------------------------------------------
// Foto

function fjord(c, W, H, R, p) {
  const s = S(W, H);
  const hz = H * R.range(0.48, 0.58), uc = R.range(0.4, 0.6);
  const n = R.int(3, 4), seed = R.int(1, 1e6), glow = R() < 0.6;
  const lays = Array.from({ length: n }, (_, i) => ({
    steep: R.range(0.7, 1.1) * (0.25 + i * 0.6), base: ((n - 1 - i) / Math.max(1, n - 1)) * R.range(0.12, 0.18) * H + R.range(-0.01, 0.02) * H, top: R.range(0.22, 0.3) * H,
    amp: R.range(0.03, 0.06) * H, off: R() * 50, snow: R.range(0.18, 0.3),
  }));
  const glints = Array.from({ length: 40 }, () => [R() * W, R.range(0.02, 1), R.range(0.02, 0.12) * s, R.range(0.05, 0.2)]);
  const noise = createNoise2D(seed);
  const asp = W / H;
  const crest = (L, i) => (u) => {
    const d = Math.abs(u - uc) * asp;
    const h = Math.min(L.top, Math.max(0, L.base + L.steep * d * H * 0.5)) + L.amp * fbm2D(noise, u * 6 * asp + L.off, i * 7.3, 4);
    return hz - Math.max(0.004 * H, h);
  };
  const crests = lays.map(crest);
  const colAt = (i) => {
    const t = n > 1 ? i / (n - 1) : 1;
    return t < 0.5 ? mix(mix(p[2], p[0], 0.25), p[1], t * 2) : mix(p[1], p[3], (t - 0.5) * 2);
  };

  fill(c, W, H, p[0]);
  vgrad(c, W, 0, hz, [[0, mix(p[2], p[0], 0.3)], [0.55, p[0]], [1, p[4]]]);
  if (glow) {
    const g = c.createRadialGradient(uc * W, hz - 0.04 * H, 0.01 * s, uc * W, hz - 0.04 * H, 0.35 * s);
    g.addColorStop(0, rgba(p[4], 0.5));
    g.addColorStop(1, rgba(p[4], 0));
    c.fillStyle = g;
    c.fillRect(0, 0, W, hz);
  }
  const mountains = (x, mirror) => {
    crests.forEach((f, i) => {
      const fy = mirror ? (u) => 2 * hz - f(u) : f;
      x.fillStyle = colAt(i);
      x.beginPath();
      x.moveTo(0, hz);
      for (let k = 0; k <= 128; k++) x.lineTo((k / 128) * W, fy(k / 128));
      x.lineTo(W, hz);
      x.closePath();
      x.fill();
      if (!mirror && i < n - 1) {
        // snow: the upper part of each far ridge
        x.save();
        x.clip();
        x.globalAlpha = 0.85;
        x.fillStyle = p[0];
        x.beginPath();
        x.moveTo(0, 0);
        for (let k = 0; k <= 128; k++) {
          const yy = f(k / 128);
          x.lineTo((k / 128) * W, yy + (hz - yy) * lays[i].snow + 0.01 * H * Math.sin(k * 1.7));
        }
        x.lineTo(W, 0);
        x.closePath();
        x.fill();
        x.restore();
      }
    });
  };
  mountains(c, false);
  // water: mirrored sky, mirrored mountains (soft), glints and a darker foreground
  vgrad(c, W, hz, H, [[0, p[4]], [0.35, p[0]], [1, mix(p[2], p[0], 0.3)]]);
  const l = layer(W, H);
  mountains(l.x, true);
  blurOnto(c, l, 0.003 * s, 0.45);
  c.fillStyle = p[0];
  for (const [x, t, w, a] of glints) {
    c.globalAlpha = a;
    c.fillRect(x - w / 2, hz + (H - hz) * t, w, Math.max(1, 0.0025 * s));
  }
  c.globalAlpha = 1;
  const dg = c.createLinearGradient(0, hz, 0, H);
  dg.addColorStop(0, rgba(p[3], 0));
  dg.addColorStop(1, rgba(p[3], 0.55));
  c.fillStyle = dg;
  c.fillRect(0, hz, W, H - hz);
  vignette(c, W, H, 0.25);
  grain(c, W, H, R, 0.08);
}

function mountain(c, W, H, R, p) {
  const s = S(W, H);
  const glow = R() < 0.6, seed = R.int(1, 1e6);
  const nm = R.int(2, 3);
  const massifs = Array.from({ length: nm }, (_, i) => ({
    base: H * (0.62 + i * 0.07), peaks: Array.from({ length: R.int(1, 3) }, () => [R.range(0.1, 0.9), R.range(0.22, 0.4) * H * (1 - i * 0.18), R.range(0.18, 0.35)]),
    amp: R.range(0.015, 0.03) * H, off: R() * 50,
  }));
  const facets = Array.from({ length: R.int(12, 24) }, () => [R(), R(), R.range(0.08, 0.35), R.range(0.25, 0.7), R()]);
  const trees = Array.from({ length: 60 }, () => [R(), R.range(0.05, 0.12), R.range(0.5, 1)]);
  const noise = createNoise2D(seed);
  const asp = W / H;
  const sil = (m, i) => (u) => {
    let h = 0;
    for (const [pu, ph, pw] of m.peaks) h = Math.max(h, ph * Math.max(0, 1 - Math.abs(u - pu) * asp / pw) ** 1.15);
    return m.base - h - m.amp * ridged2D(noise, u * 5 * asp + m.off, i * 3.1, 4) * 1.6;
  };
  const sils = massifs.map(sil);

  vgrad(c, W, 0, H, [[0, p[2]], [0.62, p[0]], [1, p[0]]]);
  if (glow) {
    const g = c.createLinearGradient(0, H * 0.25, 0, H * 0.62);
    g.addColorStop(0, rgba(p[4], 0));
    g.addColorStop(1, rgba(p[4], 0.35));
    c.fillStyle = g;
    c.fillRect(0, 0.25 * H, W, 0.4 * H);
  }
  massifs.forEach((m, i) => {
    const f = sils[i], far = i < nm - 1;
    const body = () => {
      c.beginPath();
      c.moveTo(0, H);
      for (let k = 0; k <= 160; k++) c.lineTo((k / 160) * W, f(k / 160));
      c.lineTo(W, H);
      c.closePath();
    };
    body();
    c.fillStyle = far ? mix(p[1], p[0], 0.35) : p[1];
    c.fill();
    c.save();
    body();
    c.clip();
    // facets: lit (snow) and shaded planes running down from the peaks
    for (const [a, b, wd, dep, k] of facets) {
      const [pu, ph] = m.peaks[Math.floor(a * m.peaks.length)];
      const px = pu * W, py = f(pu);
      const side = b < 0.5 ? -1 : 1, x2 = px + side * wd * 0.35 * W / asp * asp, y2 = py + dep * ph;
      c.globalAlpha = side < 0 ? 0.6 * (0.6 + 0.4 * k) : 0.4;
      c.fillStyle = side < 0 ? p[0] : p[3];
      poly(c, [[px, py - 2], [x2, y2], [px + side * wd * 0.1 * W, y2 + dep * ph * 0.4], [px + side * 0.01 * W, py + dep * ph * 1.1]]);
      c.fill();
    }
    c.globalAlpha = 1;
    const top = Math.min(...m.peaks.map(([, ph]) => m.base - ph));
    const sg = c.createLinearGradient(0, top, 0, top + (m.base - top) * 0.55);
    sg.addColorStop(0, rgba(p[0], far ? 0.75 : 0.85));
    sg.addColorStop(1, rgba(p[0], 0));
    c.fillStyle = sg;
    c.fillRect(0, top - 0.05 * H, W, (m.base - top) * 0.6 + 0.05 * H);
    c.restore();
  });
  // foreground: a dark band of spruces
  const fy = H * 0.88;
  c.fillStyle = p[3];
  c.fillRect(0, fy, W, H - fy);
  c.beginPath();
  for (const [u, h, w] of trees) sprucePath(c, u * W, fy + 0.01 * H, h * H, h * H * 0.38 * w, 6);
  c.fill();
  vignette(c, W, H, 0.2);
  grain(c, W, H, R, 0.07);
}

/** Svaberg: 2–4 smooth granite domes along the bottom edge (pre-drawn from R) and the cracks across them. */
function slabData(R, top0, top1) {
  const n = R.int(2, 4);
  const humps = Array.from({ length: n }, (_, i) => [((i + R.range(0.2, 0.8)) / n) * 1.2 - 0.1, R.range(0.25, 0.5), R.range(top0, top1), R.range(0.5, 0.8)]);
  const cracks = Array.from({ length: R.int(3, 6) }, () => [R(), R.range(0.15, 0.6), R.range(-0.6, 0.6), R.range(0.04, 0.12)]);
  return { humps, cracks };
}
/** Height (share of H from the bottom) of the slabs at u. */
function slabAt(sl, u) {
  let h = 0;
  for (const [hu, hw, ht, ex] of sl.humps) {
    const t = (u - hu) / hw;
    if (Math.abs(t) < 1) h = Math.max(h, ht * Math.pow(1 - t * t, ex));
  }
  return h;
}
/** Paints the slabs: lit tops, darker feet, a light rim along the crest and a few cracks. */
function drawSlabs(c, W, H, s, sl, light, rock, dark) {
  const f = (u) => H * (1 - slabAt(sl, u)) + 1;
  const top = H * (1 - Math.max(...sl.humps.map((h) => h[2])));
  const body = () => {
    c.beginPath();
    c.moveTo(0, H + 2);
    for (let k = 0; k <= 96; k++) c.lineTo((k / 96) * W, f(k / 96));
    c.lineTo(W, H + 2);
    c.closePath();
  };
  const g = c.createLinearGradient(0, top, 0, H);
  g.addColorStop(0, light);
  g.addColorStop(0.45, rock);
  g.addColorStop(1, dark);
  c.fillStyle = g;
  body();
  c.fill();
  c.save();
  body();
  c.clip();
  c.globalAlpha = 0.5;
  c.strokeStyle = dark;
  c.lineWidth = 0.0025 * s;
  c.lineCap = 'round';
  c.beginPath();
  for (const [u, d, a, L] of sl.cracks) {
    const x = u * W, y = f(u) + d * (H - f(u));
    c.moveTo(x, y);
    c.quadraticCurveTo(x + Math.cos(a) * L * s * 0.6, y + Math.sin(a) * L * s * 0.3 + 0.01 * s, x + Math.cos(a) * L * s, y + Math.sin(a) * L * s * 0.5);
  }
  c.stroke();
  c.globalAlpha = 0.55;
  c.strokeStyle = light;
  c.lineWidth = 0.006 * s;
  c.beginPath();
  for (let k = 0; k <= 96; k++) c.lineTo((k / 96) * W, f(k / 96) + 0.004 * s);
  c.stroke();
  c.restore();
  c.globalAlpha = 1;
}

function ocean(c, W, H, R, p, o) {
  const s = S(W, H);
  const v = variantOf(R, o, ['sea', 'beach', 'rocks']);
  const hz = H * R.range(0.42, 0.56), sunX = W * R.range(0.3, 0.7);
  const glit = Array.from({ length: 120 }, () => [R.range(-1, 1), R(), R.range(0.2, 0.7), R() < 0.5]);
  const clouds = Array.from({ length: R.int(3, 6) }, () => [R() * W, R.range(0.08, 0.7) * hz, R.range(0.08, 0.2) * s, R.range(0.02, 0.05) * s]);
  const sail = R() < 0.4, sailX = W * R.range(0.15, 0.85);
  const waves = Array.from({ length: 30 }, () => [R() * W, R(), R.range(0.04, 0.16) * W]);
  const nd = R.int(2, 3);
  const dunes = Array.from({ length: nd }, (_, i) => ridge(R, H * (0.66 + i * 0.12), 0.065 * H));
  const tufts = Array.from({ length: R.int(10, 18) }, () => [R(), R.int(0, nd - 1), R.range(0.05, 0.1), Array.from({ length: R.int(6, 10) }, () => [R.range(-0.7, 0.7), R.range(0.6, 1), R.int(0, 1)])]);
  const foam = Array.from({ length: 24 }, () => [R(), R.range(0.03, 0.12), R.range(0.3, 0.8)]);
  const sl = slabData(R, 0.22, 0.42);
  // 'sea' seen from the beach: a sand band in the bottom 20–30 % with the wash on it and 2–4 white surf lines
  // above it, so the shore reads even in pale palettes (drawn only for 'sea': the other variants keep their values)
  const shore = v === 'sea' ? {
    y: H * R.range(0.72, 0.8), edge: ridge(R, 0, 0.012 * H), wash: R.range(0.025, 0.05) * H,
    surf: Array.from({ length: R.int(2, 4) }, (_, i) => ({ dy: (0.035 + 0.04 * i + 0.006 * i * i + R.range(-0.008, 0.008)) * H, f: ridge(R, 0, 0.006 * H), w: R.range(0.8, 1.2) * (1 - 0.18 * i), a: R.range(0.7, 0.9) * (1 - 0.12 * i), gaps: Array.from({ length: 3 }, () => [R(), R.range(0.04, 0.14)]) })),
  } : null;

  fill(c, W, H, p[0]);
  vgrad(c, W, 0, hz, [[0, p[0]], [0.7, mix(p[0], p[4], 0.4)], [1, p[4]]]);
  const cl = layer(W, H);
  cl.x.fillStyle = p[0];
  for (const [x, y, rx, ry] of clouds) ellipse(cl.x, x, y, rx, ry);
  blurOnto(c, cl, 0.01 * s, 0.85);
  const sea = (y1) => {
    vgrad(c, W, hz, y1, [[0, p[1]], [1, p[3]]]);
    c.strokeStyle = tint(p[1], 0.15);
    c.lineWidth = 0.002 * s;
    c.globalAlpha = 0.25;
    c.beginPath();
    for (const [x, t, w] of waves) {
      const y = hz + (y1 - hz) * t * t;
      c.moveTo(x - w / 2, y);
      c.lineTo(x + w / 2, y);
    }
    c.stroke();
    c.globalAlpha = 1;
  };
  if (v === 'sea') {
    sea(H);
    for (const [j, t, a, lightDash] of glit) {
      const y = hz + (H - hz) * t, wd = (0.01 + 0.09 * t) * s;
      c.globalAlpha = a;
      c.fillStyle = lightDash ? p[0] : p[4];
      c.fillRect(sunX + j * (0.02 + 0.12 * t) * s - wd / 2, y, wd, Math.max(1, 0.003 * s));
    }
    c.globalAlpha = 1;
    if (sail) {
      c.fillStyle = p[0];
      poly(c, [[sailX, hz - 0.045 * s], [sailX + 0.02 * s, hz - 0.004 * s], [sailX - 0.004 * s, hz - 0.004 * s]]);
      c.fill();
      c.fillStyle = p[3];
      c.fillRect(sailX - 0.008 * s, hz - 0.004 * s, 0.03 * s, 0.004 * s);
    }
    // the shore: surf lines (a soft foam band under a white crest, broken in places), the wet wash, the sand
    const sy = Math.max(shore.y, hz + 0.12 * H), sand = mix(p[4], p[2], 0.2), white = tint(p[0], 0.3);
    const edge = (u) => sy + shore.edge(u);
    const line = (dy, f, k) => {
      c.beginPath();
      for (let i = 0; i <= 64; i++) {
        const u = i / 64, y = edge(u) - dy * k + f(u);
        if (i) c.lineTo(u * W, y);
        else c.moveTo(u * W, y);
      }
    };
    c.lineCap = 'round';
    for (const sf of shore.surf) {
      const k = Math.min(1, (sy - hz - 0.03 * H) / (0.2 * H));
      c.globalAlpha = 0.28 * sf.a;
      c.strokeStyle = white;
      c.lineWidth = 0.02 * s * sf.w * (0.6 + 0.4 * k);
      line(sf.dy - 0.009 * H * sf.w, sf.f, k);
      c.stroke();
      c.globalAlpha = sf.a;
      c.lineWidth = 0.006 * s * sf.w;
      line(sf.dy, sf.f, k);
      c.stroke();
      // breaks in the crest: short stretches painted back in the sea colour
      c.globalAlpha = 0.7;
      c.strokeStyle = mix(p[1], p[3], 0.2);
      c.lineWidth = 0.007 * s * sf.w;
      for (const [u0, len] of sf.gaps) {
        c.beginPath();
        for (let i = 0; i <= 8; i++) {
          const u = u0 + (i / 8) * len, y = edge(u) - sf.dy * k + sf.f(u);
          if (i) c.lineTo(u * W, y);
          else c.moveTo(u * W, y);
        }
        c.stroke();
      }
    }
    c.globalAlpha = 1;
    fillUnder(c, W, H + 1, edge, sand, 64);
    vgrad(c, W, sy - 0.012 * H, sy + shore.wash, [[0, rgba(mix(sand, p[1], 0.45), 0.9)], [1, rgba(mix(sand, p[1], 0.45), 0)]]);
    c.globalAlpha = 0.9;
    c.strokeStyle = white;
    c.lineWidth = 0.005 * s;
    line(0.002 * H, () => 0, 1);
    c.stroke();
    c.globalAlpha = 1;
    vgrad(c, W, sy + 0.05 * H, H, [[0, rgba(sand, 0)], [1, rgba(mix(sand, p[3], 0.12), 0.6)]]);
  } else if (v === 'beach') {
    // a strip of sea, the wet beach with a foam line, then dunes with marram grass toward the viewer
    const shore = hz + 0.07 * H;
    vgrad(c, W, hz, shore, [[0, p[1]], [1, mix(p[1], p[2], 0.5)]]);
    vgrad(c, W, shore, H, [[0, mix(p[4], p[2], 0.3)], [1, p[4]]]);
    c.fillStyle = p[0];
    for (const [u, w, a] of foam) {
      c.globalAlpha = a;
      ellipse(c, u * W, shore - 0.002 * s, w * s, 0.004 * s);
    }
    c.globalAlpha = 1;
    dunes.forEach((f, i) => {
      const col = i % 2 ? mix(p[4], p[2], 0.22) : tint(p[4], 0.08);
      fillUnder(c, W, H, f, col);
      // the lee side under the crest
      const g = c.createLinearGradient(0, f(0.5) - 0.05 * H, 0, f(0.5) + 0.1 * H);
      g.addColorStop(0, rgba(p[3], 0));
      g.addColorStop(0.45, rgba(p[3], 0.14));
      g.addColorStop(1, rgba(p[3], 0));
      c.fillStyle = g;
      c.beginPath();
      c.moveTo(0, H);
      for (let k = 0; k <= 96; k++) c.lineTo((k / 96) * W, f(k / 96));
      c.lineTo(W, H);
      c.closePath();
      c.fill();
    });
    c.lineCap = 'round';
    c.lineWidth = 0.0028 * s;
    for (const k of [0, 1]) {
      c.strokeStyle = k ? p[2] : mix(p[3], p[2], 0.4);
      c.globalAlpha = 0.85;
      c.beginPath();
      for (const [u, di, h, blades] of tufts) {
        const x = u * W, y = dunes[di](u) + 0.004 * s, gh = h * s;
        for (const [lean, len, kk] of blades) {
          if (kk !== k) continue;
          c.moveTo(x + lean * 0.01 * s, y);
          c.quadraticCurveTo(x + lean * gh * 0.25, y - gh * len * 0.6, x + lean * gh * 0.8, y - gh * len);
        }
      }
      c.stroke();
    }
    c.globalAlpha = 1;
  } else {
    sea(H);
    drawSlabs(c, W, H, s, sl, mix(p[4], p[0], 0.25), mix(p[3], p[4], 0.55), mix(p[3], p[4], 0.2));
  }
  vignette(c, W, H, 0.2);
  grain(c, W, H, R, 0.08);
}

function forest(c, W, H, R, p, o) {
  const s = S(W, H);
  const v = variantOf(R, o, ['mist', 'graphic']);
  const nl = R.int(4, 5);
  const layers = Array.from({ length: nl }, (_, i) => {
    const t = i / (nl - 1), base = H * (0.5 + 0.13 * i), hmax = (0.2 + 0.4 * t) * H;
    const count = Math.ceil(W / (hmax * 0.32)) + 2;
    return { t, base, trees: Array.from({ length: count }, (_, k) => [((k + R.range(-0.3, 0.3)) / (count - 2)) * W, R.range(0.55, 1) * hmax, R.int(6, 10), R.range(0.3, 0.42)]) };
  });
  const rays = R() < 0.3 ? Array.from({ length: R.int(3, 5) }, () => [R.range(0.1, 0.9), R.range(0.02, 0.06), R.range(-0.3, 0.3)]) : [];
  const rows = Array.from({ length: R.int(3, 5) }, (_, j) => Array.from({ length: R.int(4, 8) }, () => [R(), R() < 0.55, R.range(0.7, 1.2), R.int(1, 3)]));

  if (v === 'mist') {
    vgrad(c, W, 0, H, [[0, p[0]], [0.6, p[4]], [1, p[4]]]);
    const far = layer(W, H);
    layers.forEach((L, i) => {
      const x = i < 2 ? far.x : c;
      if (i === 2) blurOnto(c, far, 0.004 * s);
      const col = L.t < 0.5 ? mix(p[4], p[2], L.t * 2) : mix(p[2], p[3], (L.t - 0.5) * 2);
      x.fillStyle = col;
      x.beginPath();
      for (const [tx, th, tiers, tw] of L.trees) sprucePath(x, tx, L.base, th, th * tw, tiers);
      x.fill();
      x.fillRect(0, L.base - 1, W, H - L.base + 1);
      if (i < nl - 1) {
        const g = x.createLinearGradient(0, L.base - 0.1 * H, 0, L.base + 0.06 * H);
        g.addColorStop(0, 'rgba(255,255,255,0)');
        g.addColorStop(0.6, 'rgba(255,255,255,0.35)');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        x.fillStyle = g;
        x.fillRect(0, L.base - 0.1 * H, W, 0.16 * H);
      }
    });
    if (rays.length) {
      c.fillStyle = p[0];
      c.globalAlpha = 0.08;
      for (const [u, w, lean] of rays) {
        poly(c, [[u * W, 0], [(u + w) * W, 0], [(u + w + lean) * W + 0.2 * W * lean, H], [(u + lean) * W, H]]);
        c.fill();
      }
      c.globalAlpha = 1;
    }
    grain(c, W, H, R, 0.07);
  } else {
    // graphic (Fine Little Day «Skog»): flat rows of spruces and round trees
    fill(c, W, H, p[0]);
    const nr = rows.length, m = 0.08 * s;
    rows.forEach((row, j) => {
      const yb = m + ((j + 1) * (H - 2 * m)) / nr, th = ((H - 2 * m) / nr) * 0.9;
      row.forEach(([u, spruce, k, ci], i) => {
        const x = m + ((i + 0.5) / row.length) * (W - 2 * m) + (u - 0.5) * (W - 2 * m) / row.length * 0.4;
        const h = th * Math.min(1, k);
        c.fillStyle = p[3];
        c.fillRect(x - h * 0.025, yb - h * 0.25, h * 0.05, h * 0.25);
        c.fillStyle = p[ci];
        if (spruce) {
          poly(c, [[x, yb - h], [x + h * 0.24, yb - h * 0.18], [x - h * 0.24, yb - h * 0.18]]);
          c.fill();
        } else circle(c, x, yb - h * 0.55, h * 0.3);
      });
    });
    grain(c, W, H, R, 0.03);
  }
}

/** City skyline data: back and front rows of buildings with lit windows (shared by city-night and bw-photo). */
function skyline(R, W, H, yh, s) {
  const rows = [];
  for (const [hr, shade] of [[[0.12, 0.35], 0], [[0.06, 0.22], 1]]) {
    const b = [];
    for (let x = -0.01 * W; x < W;) {
      const w = R.range(0.02, 0.08) * W, h = R.range(hr[0], hr[1]) * H;
      b.push({ x, w, h, mix: R.range(0.1, 0.4), step: R() < 0.3 ? R.range(0.3, 0.7) : 0, ant: R() < 0.15, lit: R.range(0.25, 0.5), seed: seedOf(R) });
      x += w * R.range(0.92, 1.08);
    }
    rows.push({ shade, b });
  }
  const area = rows.reduce((t, r) => t + r.b.reduce((a, b) => a + b.w * b.h, 0), 0);
  const cell = Math.max(R.range(0.006, 0.01) * s, Math.sqrt(area / 2500));
  return { rows, cell, yh };
}
function drawSkyline(c, sk, col, winA, winB, litOn) {
  const { rows, cell, yh } = sk;
  const winsA = [], winsB = [];
  for (const row of rows) {
    for (const b of row.b) {
      const top = yh - b.h;
      c.fillStyle = col(row.shade, b.mix);
      c.fillRect(b.x, top, b.w, b.h + 1);
      if (b.step) c.fillRect(b.x + b.w * (1 - b.step) / 2, top - b.h * 0.12, b.w * b.step, b.h * 0.12 + 1);
      if (b.ant) {
        c.fillRect(b.x + b.w / 2 - cell * 0.15, top - b.h * 0.25, cell * 0.3, b.h * 0.25);
      }
      if (!litOn) continue;
      const r = rngFrom(b.seed);
      for (let y = top + cell; y < yh - cell; y += cell) {
        for (let x = b.x + cell * 0.6; x < b.x + b.w - cell * 0.6; x += cell) {
          const q = r();
          if (q < b.lit) (q < b.lit * 0.7 ? winsA : winsB).push([x, y]);
        }
      }
    }
  }
  if (!litOn) return [];
  const ws = cell * 0.55;
  for (const [list, colw] of [[winsA, winA], [winsB, winB]]) {
    c.fillStyle = colw;
    c.beginPath();
    for (const [x, y] of list) c.rect(x, y, ws, ws * 1.2);
    c.fill();
  }
  return winsA;
}

function cityNight(c, W, H, R, p) {
  const s = S(W, H);
  const yh = H * R.range(0.5, 0.62);
  const sk = skyline(R, W, H, yh, s);
  const streaks = Array.from({ length: 40 }, () => [R() * W, R.range(0.05, 0.25), R.range(0.002, 0.006) * s]);
  const bridge = R() < 0.5 ? { x0: R.range(-0.2, 0.2) * W, x1: R.range(0.8, 1.2) * W, rise: R.range(0.04, 0.08) * H, y: yh + R.range(0.06, 0.12) * H } : null;

  fill(c, W, H, p[0]);
  vgrad(c, W, 0, yh, [[0, p[0]], [0.7, mix(p[2], p[0], 0.5)], [1, mix(p[2], p[1], 0.25)]]);
  const bcol = (shade, k) => mix(p[3], p[2], shade ? k * 0.6 : k);
  drawSkyline(c, sk, bcol, p[1], p[4], true);
  // water: the skyline mirrored and squashed, soft, plus light streaks
  c.fillStyle = mix(p[3], p[0], 0.4);
  c.fillRect(0, yh, W, H - yh);
  const l = layer(W, H);
  l.x.save();
  l.x.translate(0, yh);
  l.x.scale(1, -0.6);
  l.x.translate(0, -yh);
  drawSkyline(l.x, sk, bcol, p[1], p[4], true);
  l.x.restore();
  blurOnto(c, l, 0.004 * s, 0.35);
  c.fillStyle = p[1];
  for (const [x, len, w] of streaks) {
    c.globalAlpha = 0.2;
    c.fillRect(x, yh + 0.01 * H, w, (H - yh) * len);
  }
  c.globalAlpha = 1;
  if (bridge) {
    c.strokeStyle = mix(p[3], p[2], 0.2);
    c.lineWidth = 0.008 * s;
    c.beginPath();
    c.moveTo(bridge.x0, bridge.y);
    c.quadraticCurveTo((bridge.x0 + bridge.x1) / 2, bridge.y - bridge.rise * 2, bridge.x1, bridge.y);
    c.stroke();
    c.fillStyle = p[4];
    const pts = [];
    for (let k = 1; k < 24; k++) {
      const t = k / 24, [bx, by] = qpt([bridge.x0, bridge.y], [(bridge.x0 + bridge.x1) / 2, bridge.y - bridge.rise * 2], [bridge.x1, bridge.y], t);
      pts.push([bx, by - 0.006 * s, 0.003 * s]);
    }
    dots(c, pts);
  }
  grain(c, W, H, R, 0.09);
}

function bwPhoto(c, W, H, R, p, o) {
  const s = S(W, H);
  const v = variantOf(R, o, ['coast', 'pier', 'forest', 'dunes', 'city']);
  const g = p.map(grey);
  const hz = H * R.range(0.45, 0.55);
  const sl = slabData(R, 0.24, 0.44);
  const house = R() < 0.5, houseX = W * R.range(0.2, 0.8);
  const posts = R.int(8, 14);
  // forest: four rows of trunks, far (thin, pale) to near (thick, dark)
  const rows = [0, 1, 2, 3].map((i) => {
    const n = [16, 12, 8, 5][i] + R.int(0, 3);
    return Array.from({ length: n }, () => ({ u: R.range(-0.05, 1.05), w: R.range(0.7, 1.3), lean: R.range(-0.02, 0.02), stubs: Array.from({ length: R.int(1, 4) }, () => [R.range(0.15, 0.85), R.sign(), R.range(0.02, 0.06)]) }));
  });
  const nd = R.int(3, 4);
  const dunes = Array.from({ length: nd }, (_, i) => ({ y: H * (0.5 + i * 0.14), k: R.range(1.2, 2.4), ph: R() * TAU, a: R.range(0.05, 0.1) * H, sk: R.range(0.3, 0.6) }));
  const ripples = Array.from({ length: 28 }, () => [R(), R.range(0.3, 1), R.range(0.06, 0.18)]);
  const sk = skyline(R, W, H, hz + 0.08 * H, s);

  fill(c, W, H, g[0]);
  if (v === 'coast') {
    vgrad(c, W, 0, hz, [[0, g[2]], [1, g[0]]]);
    vgrad(c, W, hz, H, [[0, g[1]], [1, g[3]]]);
    if (house) {
      // a low headland on the horizon with a lighthouse
      const by = hz - 0.018 * s, th = 0.13 * s, tw = 0.026 * s;
      c.fillStyle = mix(g[3], g[1], 0.35);
      c.beginPath();
      c.ellipse(houseX, hz + 0.002 * H, 0.16 * s, 0.03 * s, 0, Math.PI, TAU);
      c.fill();
      c.fillStyle = g[0];
      poly(c, [[houseX - tw / 2, by], [houseX - tw * 0.32, by - th], [houseX + tw * 0.32, by - th], [houseX + tw / 2, by]]);
      c.fill();
      c.fillStyle = g[3];
      c.fillRect(houseX - tw * 0.42, by - th * 0.62, tw * 0.84, th * 0.14);
      c.fillRect(houseX - tw * 0.36, by - th - 0.022 * s, tw * 0.72, 0.022 * s);
      poly(c, [[houseX - tw * 0.42, by - th - 0.022 * s], [houseX, by - th - 0.04 * s], [houseX + tw * 0.42, by - th - 0.022 * s]]);
      c.fill();
    }
    drawSlabs(c, W, H, s, sl, mix(g[4], g[0], 0.4), g[1], g[3]);
  } else if (v === 'pier') {
    vgrad(c, W, 0, hz, [[0, g[2]], [1, g[4]]]);
    vgrad(c, W, hz, H, [[0, g[4]], [1, g[1]]]);
    const vx = W / 2, near = 0.36 * W;
    c.fillStyle = g[3];
    poly(c, [[vx - near, H], [vx - 0.004 * W, hz], [vx + 0.004 * W, hz], [vx + near, H]]);
    c.fill();
    c.strokeStyle = g[2];
    c.lineWidth = 0.0015 * s;
    c.beginPath();
    for (let k = 1; k < 26; k++) {
      const t = (k / 26) ** 2, y = hz + (H - hz) * t, hw = 0.004 * W + (near - 0.004 * W) * t;
      c.moveTo(vx - hw, y);
      c.lineTo(vx + hw, y);
    }
    c.stroke();
    c.fillStyle = g[3];
    for (let k = 0; k < posts; k++) {
      const t = ((k + 1) / (posts + 1)) ** 1.8, y = hz + (H - hz) * t, hw = 0.004 * W + (near - 0.004 * W) * t, ph = 0.25 * s * t + 0.004 * s, pw = 0.02 * s * t + 0.0015 * s;
      for (const sd of [-1, 1]) {
        c.fillRect(vx + sd * hw - pw / 2, y - ph, pw, ph);
        c.globalAlpha = 0.35;
        c.fillRect(vx + sd * hw - pw / 2, y + 0.002 * s, pw, ph * 0.6);
        c.globalAlpha = 1;
      }
    }
    const fog = c.createLinearGradient(0, hz - 0.15 * H, 0, hz + 0.15 * H);
    fog.addColorStop(0, rgba(g[4], 0));
    fog.addColorStop(0.5, rgba(g[4], 0.7));
    fog.addColorStop(1, rgba(g[4], 0));
    c.fillStyle = fog;
    c.fillRect(0, hz - 0.15 * H, W, 0.3 * H);
  } else if (v === 'forest') {
    // trunks in fog: every row further back is paler and sits higher; fog veils between the rows
    vgrad(c, W, 0, H, [[0, g[4]], [0.55, g[0]], [1, mix(g[0], g[2], 0.4)]]);
    rows.forEach((row, i) => {
      const t = i / 3, base = H * (0.66 + 0.12 * i) + 0.02 * s, col = mix(g[0], g[3], 0.18 + 0.82 * t ** 1.3);
      if (i === 2) vgrad(c, W, base - 0.1 * H, H, [[0, rgba(g[2], 0)], [0.4, mix(g[0], g[2], 0.6)], [1, mix(g[2], g[3], 0.35)]]);
      c.fillStyle = col;
      c.strokeStyle = col;
      c.lineCap = 'round';
      for (const tr of row) {
        const w = (0.007 + 0.034 * t ** 1.5) * s * tr.w, x = tr.u * W, top = -0.05 * H;
        poly(c, [[x - w / 2, base], [x - w * 0.32 + tr.lean * H, top], [x + w * 0.32 + tr.lean * H, top], [x + w / 2, base]]);
        c.fill();
        if (i > 0) {
          c.lineWidth = Math.max(1, w * 0.18);
          c.beginPath();
          for (const [k, sd, L] of tr.stubs) {
            const y = base + (top - base) * k, bx = x + tr.lean * H * k;
            c.moveTo(bx, y);
            c.lineTo(bx + sd * L * s * (0.5 + t), y - L * s * 0.6);
          }
          c.stroke();
        }
      }
      if (i < 3) {
        const fg = c.createLinearGradient(0, 0, 0, H);
        fg.addColorStop(0, rgba(g[4], 0.2));
        fg.addColorStop(0.7, rgba(g[0], 0.42));
        fg.addColorStop(1, rgba(g[0], 0.3));
        c.fillStyle = fg;
        c.fillRect(0, 0, W, H);
      }
    });
  } else if (v === 'dunes') {
    vgrad(c, W, 0, H * 0.55, [[0, g[2]], [1, g[0]]]);
    dunes.forEach((d, i) => {
      const f = (u) => d.y - d.a * (0.6 * Math.sin(u * d.k * Math.PI + d.ph) + 0.4 * Math.sin(u * d.k * 2.3 * Math.PI + d.ph * 1.7));
      const body = () => {
        c.beginPath();
        c.moveTo(0, H);
        for (let k = 0; k <= 96; k++) c.lineTo((k / 96) * W, f(k / 96));
        c.lineTo(W, H);
        c.closePath();
      };
      const bg = c.createLinearGradient(0, d.y - d.a, 0, H);
      bg.addColorStop(0, mix(g[0], g[1], 0.15 + i * 0.1));
      bg.addColorStop(1, mix(g[1], g[3], 0.15 + i * 0.12));
      c.fillStyle = bg;
      body();
      c.fill();
      // the lee side: a soft shadow below the crest where the slope falls away from the light
      c.save();
      body();
      c.clip();
      const sg = c.createLinearGradient(0, d.y - d.a, 0, d.y + d.a * 2.4);
      sg.addColorStop(0, rgba(g[3], 0.55));
      sg.addColorStop(1, rgba(g[3], 0));
      c.fillStyle = sg;
      c.beginPath();
      for (let k = 0; k <= 96; k++) c.lineTo((k / 96) * W, f(k / 96) - 1);
      for (let k = 96; k >= 0; k--) {
        const u = k / 96, slope = f(Math.min(1, u + 0.01)) - f(Math.max(0, u - 0.01));
        c.lineTo(u * W, f(u) + Math.max(0, slope) * d.sk * 60 + 0.002 * H);
      }
      c.closePath();
      c.fill();
      if (i === nd - 1) {
        c.globalAlpha = 0.22;
        c.strokeStyle = g[3];
        c.lineWidth = 0.0025 * s;
        c.beginPath();
        for (const [u, t, L] of ripples) {
          const x = u * W, y = f(u) + (H - f(u)) * t;
          c.moveTo(x - L * s, y);
          c.quadraticCurveTo(x, y - 0.012 * s, x + L * s, y + 0.004 * s);
        }
        c.stroke();
        c.globalAlpha = 1;
      }
      c.restore();
    });
  } else {
    vgrad(c, W, 0, H, [[0, g[2]], [1, g[4]]]);
    drawSkyline(c, sk, (shade, k) => mix(g[shade ? 3 : 2], g[1], k), g[0], g[0], false);
    c.fillStyle = g[1];
    c.fillRect(0, sk.yh, W, H - sk.yh);
    const fog = c.createLinearGradient(0, 0, 0, sk.yh);
    fog.addColorStop(0, rgba(g[4], 0.1));
    fog.addColorStop(1, rgba(g[4], 0.75));
    c.fillStyle = fog;
    c.fillRect(0, 0, W, sk.yh);
  }
  vignette(c, W, H, 0.45);
  grain(c, W, H, R, 0.12);
}

function northernLights(c, W, H, R, p) {
  const s = S(W, H);
  const stars = Array.from({ length: 200 }, () => [R() * W, R() * H * 0.8, R.range(0.0008, 0.002) * s, R.int(0, 2), R() < 0.5]);
  const curtains = Array.from({ length: R.int(2, 3) }, () => {
    const y0 = H * R.range(0.3, 0.55), A = R.range(0.04, 0.12) * H, k = (R.range(0.8, 2) * TAU) / W, ph = R() * TAU;
    const x0 = R.range(-0.1, 0.3) * W, x1 = R.range(0.7, 1.1) * W;
    return { y0, A, k, ph, rects: Array.from({ length: R.int(100, 200) }, () => [lerp(x0, x1, R()), R.range(0.1, 0.3) * H, R.range(0.003, 0.008) * s, R.range(0.4, 1)]) };
  });
  const hill = ridge(R, H * 0.84, 0.035 * H);
  const trees = Array.from({ length: 50 }, () => [R(), R.range(0.04, 0.1), R.range(0.6, 1)]);
  const lake = R() < 0.5;

  vgrad(c, W, 0, H, [[0, p[3]], [0.5, p[0]], [0.85, mix(p[2], p[0], 0.5)], [1, mix(p[2], p[0], 0.5)]]);
  [0.3, 0.6, 0.9].forEach((a, i) => {
    c.globalAlpha = a;
    c.fillStyle = p[4];
    dots(c, stars.filter((st) => st[3] === i && st[4]).map(([x, y, r]) => [x, y, r]));
    c.fillStyle = '#ffffff';
    dots(c, stars.filter((st) => st[3] === i && !st[4]).map(([x, y, r]) => [x, y, r]));
  });
  c.globalAlpha = 1;
  const l = layer(W, H);
  for (const cu of curtains) {
    const g = l.x.createLinearGradient(0, 0, 0, -1);
    g.addColorStop(0, rgba(p[1], 0.85));
    g.addColorStop(0.45, rgba(mix(p[1], p[4], 0.5), 0.4));
    g.addColorStop(1, rgba(p[4], 0));
    l.x.fillStyle = g;
    for (const [x, h, w, a] of cu.rects) {
      const yb = cu.y0 + cu.A * Math.sin(cu.k * x + cu.ph);
      l.x.save();
      l.x.globalAlpha = a;
      l.x.translate(x, yb);
      l.x.scale(w, h);
      l.x.fillRect(-0.5, -1, 1, 1);
      l.x.restore();
    }
  }
  blurOnto(c, l, 0.006 * s);
  blurOnto(c, l, 0, 0.3);
  if (lake) {
    const lg = c.createLinearGradient(0, H * 0.9, 0, H);
    lg.addColorStop(0, rgba(p[1], 0.18));
    lg.addColorStop(1, rgba(p[1], 0));
    c.fillStyle = lg;
    c.fillRect(0, H * 0.9, W, H * 0.1);
  }
  fillUnder(c, W, lake ? H * 0.9 : H, hill, p[3]);
  if (lake) {
    c.fillStyle = mix(p[3], p[0], 0.5);
    c.fillRect(0, H * 0.9, W, H * 0.1);
    c.globalAlpha = 0.25;
    c.fillStyle = p[1];
    c.fillRect(0, H * 0.905, W, 0.004 * H);
    c.globalAlpha = 1;
  }
  c.fillStyle = p[3];
  c.beginPath();
  for (const [u, h, w] of trees) sprucePath(c, u * W, hill(u) + 0.01 * H, h * H, h * H * 0.36 * w, 6);
  c.fill();
  grain(c, W, H, R, 0.06);
}

// ---------------------------------------------------------------------------------------------------------------

/** MotifDefs (contract in models/artmotifs.js). */
export const PAINTED = {
  'color-field': { label: 'Fargefelt', group: 'maleri', cost: 'M', palette: ['#e6d9c7', '#b5543c', '#d99b6c', '#3f2e2a', '#efe2cf'], paint: colorField },
  'brush-abstract': {
    label: 'Penselstrøk', group: 'maleri', cost: 'M', relief: true, palette: ['#d9c7b0', '#786354', '#a8774f', '#2e221b', '#c99a6b'],
    variants: [['diagonal', 'Diagonal'], ['horizon', 'Horisont'], ['centre', 'Samlet']], paint: brushAbstract,
  },
  expressionist: {
    label: 'Ekspresjonistisk', group: 'maleri', cost: 'L', relief: true, palette: ['#efe2cf', '#b8683e', '#d9a066', '#5a3a2a', '#8c8a5a'],
    variants: [['abstract', 'Abstrakt'], ['flowers', 'Blomster']], paint: expressionist,
  },
  'texture-plaster': {
    label: 'Strukturmaleri', group: 'maleri', cost: 'M', relief: true, palette: ['#f4f0e8', '#e8e0d2', '#d6cbb8', '#a69a88', '#fbf8f2'],
    variants: [['scrape', 'Murpuss'], ['concrete', 'Betong'], ['waves', 'Bølger'], ['maze', 'Labyrint'], ['dots', 'Prikker'], ['swirls', 'Virvler']], paint: texturePlaster,
  },
  impression: {
    label: 'Impresjonisme', group: 'maleri', cost: 'L', palette: ['#dfe6e1', '#6f8f6a', '#a9b98f', '#2f4a5a', '#d9826e'],
    variants: [['river', 'Elv'], ['garden', 'Hage'], ['field', 'Valmueeng']], paint: impression,
  },
  'still-life': {
    label: 'Stilleben', group: 'maleri', cost: 'M', palette: ['#efe7dc', '#c9a27e', '#8f9e7f', '#3a332d', '#d9b99b'],
    variants: [['vase', 'Vase med blomster'], ['bottles', 'Flasker'], ['fruitbowl', 'Fruktskål']], paint: stillLife,
  },
  stag: {
    label: 'Hjort (dyreportrett)', group: 'maleri', cost: 'M', palette: ['#1b1a18', '#8a6a4c', '#c49a6c', '#0d0c0b', '#e7d2b0'],
    variants: [['stag', 'Hjort'], ['reindeer', 'Reinsdyr'], ['moose', 'Elg'], ['front', 'Hjort forfra']], paint: stag,
  },
  'botanical-print': {
    label: 'Botanisk plansje', group: 'botanisk', cost: 'M', palette: ['#f3eee3', '#6f7d5c', '#a3a98a', '#2f3527', '#c9b48a'],
    variants: [['ginkgo', 'Ginkgo'], ['fern', 'Bregne'], ['eucalyptus', 'Eukalyptus'], ['olive', 'Oliven'], ['monstera', 'Monstera'], ['poppy', 'Valmue']], paint: botanicalPrint,
  },
  'big-leaf': {
    label: 'Stort blad', group: 'botanisk', cost: 'M', palette: ['#efeae0', '#3f6b4f', '#7fa384', '#1f3a2c', '#d9c7a3'],
    variants: [['palm', 'Palmeblad'], ['monstera', 'Monstera'], ['striped', 'Stripete blad'], ['banana', 'Bananblad']], paint: bigLeaf,
  },
  fruit: {
    label: 'Frukt', group: 'botanisk', cost: 'S', palette: ['#f4efe2', '#e8c547', '#6f8d4e', '#3a3a2a', '#f2e3b0'],
    variants: [['lemons', 'Sitroner'], ['apples', 'Epler'], ['pears', 'Pærer'], ['chart', 'Fruktplansje']], paint: fruit,
  },
  fjord: { label: 'Fjord med speiling', group: 'foto', cost: 'M', palette: ['#e9eef0', '#6f8796', '#9fb2bd', '#2d3a40', '#f2d7a7'], paint: fjord },
  mountain: { label: 'Fjelltopper', group: 'foto', cost: 'M', palette: ['#eef1f4', '#7d8f99', '#b9c4c9', '#33414a', '#e2a76f'], paint: mountain },
  ocean: {
    label: 'Hav og strand', group: 'foto', cost: 'M', palette: ['#eef1f2', '#7fa2b5', '#4f7387', '#23343d', '#f6e3c2'],
    variants: [['sea', 'Hav'], ['beach', 'Sanddyner'], ['rocks', 'Svaberg']], paint: ocean,
  },
  forest: {
    label: 'Skog i tåke', group: 'foto', cost: 'M', palette: ['#e8ebe6', '#6e8a7a', '#a8b8ad', '#26312b', '#d9e0da'],
    variants: [['mist', 'Tåke'], ['graphic', 'Grafisk']], paint: forest,
  },
  'city-night': { label: 'Byen om kvelden', group: 'foto', cost: 'M', palette: ['#1d2433', '#e9b872', '#5a6e8c', '#0d1118', '#f2e1b6'], paint: cityNight },
  'bw-photo': {
    label: 'Svart-hvitt foto', group: 'foto', cost: 'M', palette: ['#f0f0ee', '#8c8c8a', '#bdbdbb', '#1e1e1e', '#d6d6d4'],
    variants: [['coast', 'Kyst'], ['pier', 'Brygge'], ['forest', 'Skog'], ['dunes', 'Sanddyner'], ['city', 'By i tåke']], paint: bwPhoto,
  },
  'northern-lights': { label: 'Nordlys', group: 'foto', cost: 'M', palette: ['#0b1622', '#5fd3a0', '#2c7a8a', '#05080d', '#b48ad6'], paint: northernLights },
};
