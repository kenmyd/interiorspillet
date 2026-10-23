import {
  TAU, FONTS, mix, tint, lum, rgba, S, fill, vgrad, ellipse, circle, poly, smoothPath, blob, ridge, fillUnder, layer,
  blurOnto, brush, grain, fitText, shuffled, createNoise2D, fbm2D, clamp, variantOf, dots, oval, starPath, heartPath, taperPath, qpt, pixelLayer,
  seedOf, brushStamp, stampLine,
} from './paintkit.js';

/**
 * Posters, graphic, line art, kids and maps – the art motif painters of group A (design/art.md §2.4). Contract and
 * registry: models/artmotifs.js; toolkit: models/art/paintkit.js. Every painter draws all of its random values
 * before it paints, never branches on colours, and fills the whole canvas first.
 */

const HALF_PI = Math.PI / 2;

/**
 * Line width k·s with a legibility floor in px: thin line art in small prints (art-set atlas cells, 30 × 40 posters
 * painted at ~250 px) must not vanish at room distance. The floor never exceeds 1.6 % of s, and every floor used here
 * is below k·s from s ≈ 770 px, so prints painted at 1024 px (long side; s ≥ 768 for 3:4) look as before.
 */
const ink = (s, k, floor) => Math.max(k * s, Math.min(floor, 0.016 * s));

// ---------------------------------------------------------------------------------------------------------------
// Grafisk

function bauhaus(c, W, H, R, p) {
  const s = S(W, H), a = W / H;
  const [cols, rows] = a >= 1.4 ? R.pick([[4, 2], [3, 2]]) : a <= 0.72 ? R.pick([[2, 4], [2, 3]]) : R.pick([[3, 3], [2, 2]]);
  const m = 0.06 * s, gap = 0.012 * s;
  const cw = (W - 2 * m) / cols, ch = (H - 2 * m) / rows;
  const cells = [];
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const shape = R.pick(['quarter', 'half', 'circle', 'square', 'stripes', 'ring', 'tri', 'quarter', 'half', 'empty']);
      const rot = R.int(0, 3), col = R.int(1, 4), hasBg = R() < 0.35;
      let bg = R.int(1, 3);
      if (bg >= col) bg++;
      cells.push({ i, j, shape, rot, col, bg: hasBg ? bg : 0 });
    }
  }
  fill(c, W, H, p[0]);
  for (const k of cells) {
    const x = m + k.i * cw + gap / 2, y = m + k.j * ch + gap / 2, w = cw - gap, h = ch - gap;
    if (k.bg) {
      c.fillStyle = p[k.bg];
      c.fillRect(x, y, w, h);
    }
    const u = Math.min(w, h) * 0.96;
    c.save();
    c.translate(x + w / 2, y + h / 2);
    c.rotate(k.rot * HALF_PI);
    c.fillStyle = c.strokeStyle = p[k.col];
    c.beginPath();
    if (k.shape === 'quarter') {
      c.moveTo(-u / 2, -u / 2);
      c.arc(-u / 2, -u / 2, u, 0, HALF_PI);
      c.closePath();
      c.fill();
    } else if (k.shape === 'half') {
      c.moveTo(-u / 2, u / 2);
      c.arc(0, u / 2, u / 2, Math.PI, TAU);
      c.closePath();
      c.fill();
    } else if (k.shape === 'circle') {
      circle(c, 0, 0, 0.38 * u);
    } else if (k.shape === 'square') {
      c.fillRect(-0.38 * u, -0.38 * u, 0.76 * u, 0.76 * u);
    } else if (k.shape === 'stripes') {
      c.fillStyle = p[k.bg === 3 ? k.col : 3];
      for (let b = 0; b < 4; b++) c.fillRect((b - 1.5) * 0.22 * u - 0.045 * u, -0.4 * u, 0.09 * u, 0.8 * u);
    } else if (k.shape === 'ring') {
      c.lineWidth = 0.1 * u;
      c.arc(0, 0, 0.3 * u, 0, TAU);
      c.stroke();
    } else if (k.shape === 'tri') {
      poly(c, [[-u / 2, -u / 2], [u / 2, u / 2], [-u / 2, u / 2]]);
      c.fill();
    }
    c.restore();
  }
  grain(c, W, H, R, 0.03);
}

/** Boomerang outline (local coords, centred): a bent ribbon, widest in the middle, with rounded tips. */
function boomerangPts(L, t, bend) {
  const A = [-L / 2, 0], C = [0, -bend * L], B = [L / 2, 0];
  const n = 12, l = [], r = [];
  for (let i = 0; i <= n; i++) {
    const u = i / n, P = qpt(A, C, B, u);
    const tx = 2 * (1 - u) * (C[0] - A[0]) + 2 * u * (B[0] - C[0]);
    const ty = 2 * (1 - u) * (C[1] - A[1]) + 2 * u * (B[1] - C[1]);
    const d = Math.hypot(tx, ty) || 1;
    const w = (t / 2) * (0.3 + 0.7 * Math.sin(Math.PI * u));
    l.push([P[0] - (ty / d) * w, P[1] + (tx / d) * w]);
    r.push([P[0] + (ty / d) * w, P[1] - (tx / d) * w]);
  }
  return [...l, ...r.reverse()];
}

/**
 * Mid-century «drops» (Lisa Larson's Birds 1967 decor): a row of tall balloon bulbs in p[1], each filled with irregular
 * p[3] dots, whose stems narrow to a neck and flare into the base; the p[0] ground left between two stems reads as a
 * pointed teardrop. The row is centred, the outer bulbs run off the sides.
 */
function midCenturyDrops(c, W, H, R, p) {
  const r = 0.245 * Math.min(W, 0.72 * H) * R.range(0.95, 1.05), d = 2.13 * r, half = d / 2;
  const ph = R.range(-0.12, 0.12) * d, neck = R.range(0.11, 0.15);
  // on a tall canvas the taper, neck and flare stretch (the round tops stay round) so the bulbs start near the top
  const f = Math.max(1, (0.88 * H / r - 1.425) / 3.44), Y = (dy) => (dy <= 0.34 ? dy : 0.34 + (dy - 0.34) * f);
  const yc = H - (Y(3.78) + 0.085) * r;
  const kMax = Math.ceil(W / 2 / d) + 1;
  // the bulb outline (right half, units of r from the bulb centre): circle top, taper, neck, flare to the tip, base
  const halfPts = [[0, -1], [0.5, -0.866], [0.866, -0.5], [1, 0], [0.94, 0.34], [0.72, 0.85], [0.42, 1.3], [neck, 1.72], [neck, 2.15], [0.3, 2.75], [0.62, 3.3], [half / r, 3.78], [half / r, 3.78]];
  // the inside, for the dots: half-width at dy (≈ the smoothed outline, a little inside it)
  const hwAt = (dy) => {
    if (dy <= 0.34) return Math.sqrt(Math.max(0, 1 - dy * dy)) * 0.97;
    const m = [[0.34, 0.92], [0.6, 0.83], [1.08, 0.57], [1.5, 0.28], [1.72, 0.14]];
    for (let i = 1; i < m.length; i++) if (dy <= m[i][0]) return m[i - 1][1] + ((dy - m[i - 1][0]) / (m[i][0] - m[i - 1][0])) * (m[i][1] - m[i - 1][1]);
    return 0;
  };
  const bulbs = [];
  for (let k = -kMax; k <= kMax; k++) {
    const xc = W / 2 + ph + k * d;
    // dots: a jittered hex grid inside the bulb, a few left out
    const g = 0.335, list = [];
    for (let j = 0, dy = -0.8; dy < 1.32; j++, dy += g * 0.866) {
      for (let dx = (j % 2 ? g / 2 : 0) - 0.9; dx <= 0.9; dx += g) {
        const jx = R.range(-0.05, 0.05), jy = R.range(-0.05, 0.05), rr = R.range(0.105, 0.14), keep = R() > 0.08;
        const ry = R.range(0.88, 1.06), rot = R() * Math.PI;
        const x = dx + jx, y = dy + jy;
        if (keep && Math.abs(x) + rr + 0.035 <= hwAt(y)) list.push([x, y, rr, rr * ry, rot]);
      }
    }
    if (xc + half > 0 && xc - half < W) bulbs.push({ xc, list });
  }

  fill(c, W, H, p[0]);
  c.fillStyle = p[1];
  c.fillRect(0, yc + Y(3.78) * r, W, H - yc - Y(3.78) * r + 1);
  for (const b of bulbs) {
    const right = halfPts.map(([x, y]) => [b.xc + x * r, yc + Y(y) * r]);
    const left = halfPts.map(([x, y]) => [b.xc - x * r, yc + Y(y) * r]).reverse();
    smoothPath(c, [[b.xc - half, H + 2], ...left.slice(0, -1), ...right, [b.xc + half, H + 2]], false);
    c.closePath();
    c.fill();
  }
  c.fillStyle = p[3];
  for (const b of bulbs) for (const [x, y, rx, ry, rot] of b.list) oval(c, b.xc + x * r, yc + Y(y) * r, rx * r, ry * r, rot);
  grain(c, W, H, R, 0.03);
}

function midCentury(c, W, H, R, p, o) {
  if (o && o.variant === 'drops') return midCenturyDrops(c, W, H, R, p);
  const s = S(W, H);
  const placed = [];
  const spot = (size, tries = 8) => {
    let best = null;
    for (let t = 0; t < tries; t++) {
      const q = [W * R.range(0.14, 0.86), H * R.range(0.14, 0.86)];
      const d = placed.reduce((m, o) => Math.min(m, Math.hypot(o[0] - q[0], o[1] - q[1]) - o[2] - size), Infinity);
      if (!best || d > best[1]) best = [q, d];
    }
    placed.push([...best[0], size]);
    return best[0];
  };
  const pads = [0, 1].map(() => ({ x: W * R.range(0.2, 0.8), y: H * R.range(0.2, 0.8), r: R.range(0.22, 0.34) * s, n: R.int(5, 7), rot: R() * TAU, col: R() < 0.5 ? 2 : 4 }));
  const nb = R.int(3, 5);
  const booms = [];
  for (let i = 0; i < nb; i++) {
    const L = R.range(0.26, 0.42) * s, bend = R.range(0.35, 0.7), rot = R.range(-0.8, 0.8) + (R() < 0.35 ? Math.PI : 0);
    booms.push({ q: spot(L * 0.35), L, bend, rot, col: [1, 2, 4][i % 3] });
  }
  const outline = R.int(0, nb - 1);
  const bursts = Array.from({ length: R.int(1, 2) }, () => {
    const L = R.range(0.06, 0.1) * s;
    return { q: spot(L), n: R.int(8, 12), L, rot: R() * TAU };
  });
  const atom = { q: spot(0.08 * s), arms: Array.from({ length: R.int(3, 5) }, () => [R() * TAU, R.range(0.05, 0.1) * s]) };
  const conf = Array.from({ length: R.int(20, 40) }, () => [W * R.range(0.04, 0.96), H * R.range(0.04, 0.96), R.range(0.004, 0.01) * s, R() < 0.6]);

  fill(c, W, H, p[0]);
  for (const pd of pads) {
    c.fillStyle = mix(p[0], p[pd.col], 0.22);
    blob(c, R, pd.x, pd.y, pd.r, pd.n, 0.35, pd.rot);
    c.fill();
  }
  booms.forEach((b, i) => {
    const pts = boomerangPts(b.L, 0.34 * b.L, b.bend);
    c.save();
    c.translate(b.q[0], b.q[1]);
    c.rotate(b.rot);
    c.fillStyle = p[b.col];
    smoothPath(c, pts, true);
    c.fill();
    if (i === outline) {
      c.translate(0.015 * s, 0.015 * s);
      c.strokeStyle = p[3];
      c.lineWidth = 0.004 * s;
      smoothPath(c, pts, true);
      c.stroke();
    }
    c.restore();
  });
  c.strokeStyle = c.fillStyle = p[3];
  c.lineWidth = 0.006 * s;
  c.lineCap = 'round';
  for (const b of bursts) {
    const tips = [];
    c.beginPath();
    for (let k = 0; k < b.n; k++) {
      const a = b.rot + (k / b.n) * TAU, L = k % 2 ? b.L * 0.6 : b.L;
      c.moveTo(b.q[0] + Math.cos(a) * b.L * 0.12, b.q[1] + Math.sin(a) * b.L * 0.12);
      c.lineTo(b.q[0] + Math.cos(a) * L, b.q[1] + Math.sin(a) * L);
      if (!(k % 2)) tips.push([b.q[0] + Math.cos(a) * L, b.q[1] + Math.sin(a) * L, 0.008 * s]);
    }
    c.stroke();
    dots(c, tips);
  }
  // an «atom»: dots on thin spokes
  c.lineWidth = 0.003 * s;
  c.beginPath();
  for (const [a, L] of atom.arms) {
    c.moveTo(atom.q[0], atom.q[1]);
    c.lineTo(atom.q[0] + Math.cos(a) * L, atom.q[1] + Math.sin(a) * L);
  }
  c.stroke();
  dots(c, [[atom.q[0], atom.q[1], 0.012 * s], ...atom.arms.map(([a, L]) => [atom.q[0] + Math.cos(a) * L, atom.q[1] + Math.sin(a) * L, 0.009 * s])]);
  c.fillStyle = p[3];
  dots(c, conf.filter((d) => d[3]));
  c.fillStyle = p[1];
  dots(c, conf.filter((d) => !d[3]));
  grain(c, W, H, R, 0.04);
}

/** Matisse-like cut paper shapes, unit size (about −0.5…0.5), pointing up. */
const CUT = {
  /** Algae: a wavy stem with finger lobes alternating left and right. */
  seaweed(R) {
    const n = R.int(3, 4), ph = R() * TAU, right = [], left = [];
    const spine = (y) => 0.06 * Math.sin((0.5 - y) * 5 + ph);
    for (let k = 0; k < n; k++) {
      const y0 = 0.42 - (k * 0.84) / n, env = 1 - k * 0.12;
      for (const [side, list, dy] of [[1, right, 0], [-1, left, 0.84 / n / 2]]) {
        const y = y0 - dy, x0 = spine(y);
        list.push([x0 + side * 0.06, y + 0.03], [x0 + side * 0.34 * env, y - 0.04], [x0 + side * 0.4 * env, y - 0.13], [x0 + side * 0.12, y - 0.1]);
      }
    }
    return [[spine(0.5) + 0.05, 0.52], ...right, [spine(-0.5), -0.54], ...left.reverse(), [spine(0.5) - 0.05, 0.52]];
  },
  /** Lobed leaf (fig / oak-like). */
  leaf(R) {
    const L = R.int(2, 3), right = [], left = [];
    for (let k = 1; k < 2 * L + 1; k++) {
      const t = k / (2 * L + 1), env = Math.sin(Math.PI * Math.pow(t, 0.85));
      right.push([(k % 2 ? 0.42 : 0.2) * env, 0.5 - t]);
      left.push([-(k % 2 ? 0.42 : 0.2) * env, 0.5 - t]);
    }
    return [[0.04, 0.56], ...right, [0, -0.52], ...left.reverse(), [-0.04, 0.56]];
  },
  star(R) {
    const n = R.int(5, 7), pts = [];
    for (let i = 0; i < n * 2; i++) {
      const a = -HALF_PI + (i / (n * 2)) * TAU, r = i % 2 ? 0.225 : 0.5;
      pts.push([Math.cos(a) * r, Math.sin(a) * r]);
    }
    return pts;
  },
};

function cutouts(c, W, H, R, p, o) {
  const s = S(W, H);
  const v = variantOf(R, o, ['shapes', 'flower']);
  const panel = R() < 0.4 ? { w: R.range(0.4, 0.6) * W, left: R() < 0.5 } : null;
  const placed = [];
  const shapes = Array.from({ length: R.int(5, 8) }, () => {
    const kind = R.pick(['seaweed', 'leaf', 'star', 'blob', 'seaweed']);
    const size = R.range(0.28, 0.52) * s * (kind === 'star' || kind === 'blob' ? 0.75 : 1);
    let q = null, bestD = -Infinity;
    for (let t = 0; t < 10; t++) {
      const cand = [W * R.range(0.1, 0.9), H * R.range(0.1, 0.9)];
      const d = placed.reduce((m, o2) => Math.min(m, Math.hypot(o2[0] - cand[0], o2[1] - cand[1]) - 0.42 * (o2[2] + size)), Infinity);
      if (d > bestD) [q, bestD] = [cand, d];
    }
    placed.push([q[0], q[1], size]);
    return { kind, size, q, rot: R.range(-0.45, 0.45), col: panel ? R.int(1, 3) : R.int(1, 4), pts: kind === 'blob' ? null : CUT[kind](R), bn: R.int(6, 9) };
  });
  const fl = {
    x: W / 2 + R.range(-0.05, 0.05) * s, y: H / 2 - R.range(0.08, 0.14) * s, n: R.int(5, 8), rot: R() * TAU,
    endX: W / 2 + R.range(-0.1, 0.1) * s, bend: R.range(-0.12, 0.12) * s,
    leaves: [0, 1].map((i) => ({ t: R.range(0.45, 0.7), a: (i ? 1 : -1) * R.range(0.75, 1.05), size: R.range(0.26, 0.34) * s, pts: CUT.leaf(R) })),
  };

  fill(c, W, H, p[0]);
  if (panel) {
    c.fillStyle = p[4];
    c.fillRect(panel.left ? 0 : W - panel.w, 0, panel.w, H);
  }
  if (v === 'shapes') {
    for (const sh of shapes) {
      c.save();
      c.translate(sh.q[0], sh.q[1]);
      c.rotate(sh.rot);
      c.fillStyle = p[sh.col];
      if (sh.kind === 'blob') blob(c, R, 0, 0, sh.size * 0.5, sh.bn, 0.3);
      else smoothPath(c, sh.pts.map(([x, y]) => [x * sh.size * (sh.kind === 'seaweed' ? 0.62 : 1), y * sh.size]), true);
      c.fill();
      c.restore();
    }
  } else {
    // flower (Paper Collective «Blomst»): petals around a centre, a stem and two lobed leaves
    const bottom = Math.min(H + 0.02 * s, fl.y + 0.8 * s);
    const stemAt = (t) => [fl.x + (fl.endX - fl.x) * t + fl.bend * Math.sin(Math.PI * t) * 0.75, fl.y + (bottom - fl.y) * t];
    c.strokeStyle = p[3];
    c.lineWidth = 0.014 * s;
    c.lineCap = 'round';
    c.beginPath();
    c.moveTo(fl.x, fl.y);
    c.bezierCurveTo(fl.x + fl.bend, fl.y + (bottom - fl.y) * 0.4, fl.endX + fl.bend, fl.y + (bottom - fl.y) * 0.7, fl.endX, bottom);
    c.stroke();
    c.fillStyle = p[3];
    for (const lf of fl.leaves) {
      const [x, y] = stemAt(lf.t);
      c.save();
      c.translate(x, y);
      c.rotate(lf.a);
      c.translate(0, -lf.size * 0.5);
      smoothPath(c, lf.pts.map(([px, py]) => [px * lf.size * 0.62, py * lf.size]), true);
      c.fill();
      c.restore();
    }
    c.fillStyle = p[1];
    for (let k = 0; k < fl.n; k++) {
      const a = fl.rot + (k / fl.n) * TAU;
      ellipse(c, fl.x + Math.cos(a) * 0.19 * s, fl.y + Math.sin(a) * 0.19 * s, 0.22 * s, 0.09 * s, a);
    }
    c.fillStyle = p[4];
    circle(c, fl.x, fl.y, 0.075 * s);
  }
  grain(c, W, H, R, 0.04);
}

function arches(c, W, H, R, p, o) {
  const s = S(W, H);
  const v = variantOf(R, o, ['rainbow', 'doors']);
  const yg = H * R.range(0.68, 0.8);
  const n = R.int(3, 6), cx = W * R.range(0.4, 0.6), rin = R.range(0.05, 0.1) * s;
  let band = R.range(0.055, 0.075) * s;
  const bandT = clamp((band / s - 0.055) / 0.02, 0, 1);
  if (rin + n * band > 0.42 * s) band = (0.42 * s - rin) / n;
  const off = R.int(0, 3), second = R() < 0.5, side = R.sign(), sun = R() < 0.6, sunSide = R.sign(), sunY = R.range(0.14, 0.26);
  const nd = R.int(2, 3), order = shuffled(R, [1, 2, 3, 4]);
  const doors = Array.from({ length: nd }, () => ({ w: R.range(0.2, 0.27) * s, h: R.range(0.75, 0.95) * yg }));
  // tall prints: the rainbow grows to 0.40–0.48 W and its bands run straight down off the bottom edge (an arch on
  // legs), so the bands fill well over half of the picture instead of a small mound on the floor
  const tall = H > 1.2 * W;
  if (tall) band = ((0.4 + 0.08 * bandT) * W - rin) / n;

  fill(c, W, H, p[0]);
  c.fillStyle = mix(p[0], p[2], 0.25);
  c.fillRect(0, yg, W, H - yg);
  if (v === 'rainbow') {
    const outer = rin + n * band, yc = tall ? 0.1 * H + outer : yg;
    const group = (x, scale, k0, count) => {
      c.lineWidth = band * scale * 0.92;
      c.lineCap = 'butt';
      for (let k = 0; k < count; k++) {
        const rr = (rin + band * (k + 0.5)) * scale;
        c.strokeStyle = p[1 + ((k + k0) % 4)];
        c.beginPath();
        if (tall) {
          c.moveTo(x - rr, H + band);
          c.lineTo(x - rr, yc);
        }
        c.arc(x, yc, rr, Math.PI, TAU);
        if (tall) c.lineTo(x + rr, H + band);
        c.stroke();
      }
    };
    if (sun) {
      c.fillStyle = p[4];
      if (tall) circle(c, sunSide < 0 ? 0.13 * W : 0.87 * W, 0.075 * H, 0.055 * s);
      else circle(c, sunSide < 0 ? Math.min(W * 0.2, cx - outer - 0.1 * s) : Math.max(W * 0.8, cx + outer + 0.1 * s), H * sunY, 0.06 * s);
    }
    if (second && !tall) group(cx + side * (outer + 0.22 * s), 0.5, off + 2, Math.max(2, n - 2));
    group(cx, 1, off, n);
  } else {
    // the doors span about 0.9 W (each at most 0.62 × its height wide) and rise to 75–95 % of the floor line
    const k = (0.9 * W) / (doors.reduce((t, d) => t + d.w, 0) + 0.04 * s * (nd - 1));
    for (const d of doors) d.w = Math.min(d.w * k, 0.62 * d.h);
    const gap = 0.04 * s * Math.min(k, 1.6), total = doors.reduce((t, d) => t + d.w, 0) + gap * (nd - 1);
    let x = W / 2 - total / 2;
    doors.forEach((d, i) => {
      const arch = (w, h, cx2) => {
        c.beginPath();
        c.moveTo(cx2 - w / 2, yg);
        c.lineTo(cx2 - w / 2, yg - h + w / 2);
        c.arc(cx2, yg - h + w / 2, w / 2, Math.PI, TAU);
        c.lineTo(cx2 + w / 2, yg);
        c.closePath();
        c.fill();
      };
      c.fillStyle = p[order[i % 4]];
      arch(d.w, d.h, x + d.w / 2);
      c.fillStyle = p[order[(i + 2) % 4]];
      arch(d.w * 0.52, d.h * 0.62, x + d.w / 2);
      x += d.w + gap;
    });
  }
  grain(c, W, H, R, 0.035);
}

function sunset(c, W, H, R, p, o) {
  const s = S(W, H);
  const v = variantOf(R, o, ['stripes', 'hills', 'moon', 'boho']);
  const nb = R.int(5, 7);
  const hillA = ridge(R, 0.645 * H, 0.025 * H), hillB = ridge(R, 0.665 * H, 0.02 * H);
  const sunX = R.range(0.3, 0.7);
  const hills = [0, 1, 2].map((i) => ridge(R, H * (0.56 + i * 0.1), 0.05 * H));
  const moonX = R.range(0.32, 0.68);
  const stars = Array.from({ length: 24 }, () => [R() * W, R() * 0.5 * H, R.range(0.0015, 0.0035) * s]);
  const mtn = ridge(R, 0.6 * H, 0.035 * H);
  const dashes = Array.from({ length: R.int(25, 40) }, () => [R(), R.range(-0.5, 0.5), R.range(0.3, 0.7)]);
  const rays = R.int(12, 16);

  if (v === 'stripes') {
    const g = c.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, p[4]);
    g.addColorStop(1, p[0]);
    c.fillStyle = g;
    c.fillRect(0, 0, W, H);
    const cy = 0.5 * H, r = 0.28 * s, yg = Math.min(0.76 * H, cy + r * 0.9);
    const sg = c.createLinearGradient(0, cy - r, 0, cy + r);
    sg.addColorStop(0, p[2]);
    sg.addColorStop(1, p[1]);
    c.fillStyle = sg;
    circle(c, W / 2, cy, r);
    c.fillStyle = g; // the background gradient cuts the bands
    for (let i = 0; i < nb; i++) {
      const t = i / nb;
      c.fillRect(0, cy + (yg - cy) * (0.1 + 0.9 * Math.pow(t, 0.9)), W, (yg - cy) * 0.03 * (1 + i * 1.1));
    }
    fillUnder(c, W, H, (u) => hillA(u) - 0.68 * H + yg, mix(p[3], p[1], 0.3));
    fillUnder(c, W, H, (u) => hillB(u) - 0.68 * H + yg, mix(p[3], p[1], 0.15));
    c.fillStyle = p[3];
    c.fillRect(0, yg, W, H - yg);
  } else if (v === 'hills') {
    vgrad(c, W, 0, H, [[0, p[4]], [0.7, p[0]], [1, p[0]]]);
    c.fillStyle = p[2];
    circle(c, sunX * W, 0.35 * H, 0.18 * s);
    hills.forEach((f, i) => fillUnder(c, W, H, f, mix(p[1], p[3], i / 2)));
  } else if (v === 'moon') {
    const hz = 0.64 * H, mx = moonX * W, my = 0.3 * H, mr = 0.12 * s;
    vgrad(c, W, 0, H, [[0, mix(p[3], '#0e1424', 0.5)], [0.64, mix(p[1], p[3], 0.35)], [1, mix(p[1], p[3], 0.35)]]);
    c.fillStyle = rgba(p[0], 0.55);
    dots(c, stars);
    const glow = c.createRadialGradient(mx, my, mr, mx, my, mr * 3.4);
    glow.addColorStop(0, rgba(p[0], 0.25));
    glow.addColorStop(1, rgba(p[0], 0));
    c.fillStyle = glow;
    c.fillRect(0, 0, W, hz);
    c.fillStyle = p[0];
    circle(c, mx, my, mr);
    fillUnder(c, W, H, (u) => Math.min(hz, mtn(u)), tint(p[3], -0.3));
    c.fillStyle = mix(p[3], '#000000', 0.2);
    c.fillRect(0, hz, W, H - hz);
    c.fillStyle = p[0];
    for (const [t, j, a] of dashes) {
      const y = hz + (H - hz) * (0.05 + 0.9 * t), w = (0.02 + 0.14 * t) * s;
      c.globalAlpha = a;
      c.fillRect(mx + j * w * 0.6 - w / 2, y, w, Math.max(1, 0.004 * s));
    }
    c.globalAlpha = 1;
  } else {
    const yg = 0.72 * H, cx = W / 2;
    fill(c, W, H, p[0]);
    c.fillStyle = mix(p[0], p[3], 0.12);
    c.fillRect(0, yg, W, H - yg);
    for (let k = 0; k < rays; k++) {
      const a0 = Math.PI + ((k + 0.2) / rays) * Math.PI, a1 = Math.PI + ((k + 0.8) / rays) * Math.PI;
      const r0 = 0.21 * s, r1 = 0.44 * s;
      c.fillStyle = k % 2 ? p[2] : p[1];
      poly(c, [
        [cx + Math.cos(a0 + 0.04) * r0, yg + Math.sin(a0 + 0.04) * r0], [cx + Math.cos(a0) * r1, yg + Math.sin(a0) * r1],
        [cx + Math.cos(a1) * r1, yg + Math.sin(a1) * r1], [cx + Math.cos(a1 - 0.04) * r0, yg + Math.sin(a1 - 0.04) * r0],
      ]);
      c.fill();
    }
    c.fillStyle = p[1];
    c.beginPath();
    c.arc(cx, yg, 0.16 * s, Math.PI, TAU);
    c.closePath();
    c.fill();
  }
  grain(c, W, H, R, 0.04);
}

/** One moon phase: th in (0, 2π) – π is full, waxing (th < π) is lit on the right. */
function moonPhase(c, x, y, r, th, lit, dark) {
  c.fillStyle = dark;
  circle(c, x, y, r);
  const k = Math.cos(th), right = th < Math.PI;
  c.fillStyle = lit;
  c.beginPath();
  c.arc(x, y, r, -HALF_PI, HALF_PI, !right);
  const throughRight = right ? k > 0 : k < 0;
  c.ellipse(x, y, Math.max(0.01, Math.abs(k) * r), r, 0, HALF_PI, -HALF_PI, throughRight);
  c.closePath();
  c.fill();
}

function moonPhases(c, W, H, R, p) {
  const s = S(W, H);
  const n = R.pick([5, 7]), row = W >= H;
  const span = row ? W : H, cross = row ? H : W;
  const r = Math.min(span / (n * 2.6), cross * 0.12);
  const craters = Array.from({ length: R.int(6, 10) }, () => [R.range(-0.6, 0.6), R.range(-0.6, 0.6), R.range(0.05, 0.14)]);
  const stars = Array.from({ length: R.int(30, 60) }, () => [R() * W, R() * H, R.range(0.002, 0.004) * s, R.int(0, 2)]);
  const hair = R() < 0.5;

  fill(c, W, H, p[0]);
  const inBand = (x, y) => Math.abs((row ? y : x) - cross / 2) < 2 * r;
  c.fillStyle = p[4];
  [0.3, 0.55, 0.8].forEach((a, i) => {
    c.globalAlpha = a;
    dots(c, stars.filter((st) => st[3] === i && !inBand(st[0], st[1])));
  });
  c.globalAlpha = 1;
  const step = span / n;
  const at = (k) => (row ? [step * (k + 0.5), cross / 2] : [cross / 2, step * (k + 0.5)]);
  if (hair) {
    c.strokeStyle = rgba(p[4], 0.6);
    c.lineWidth = 0.0015 * s;
    c.beginPath();
    c.moveTo(...at(0));
    c.lineTo(...at(n - 1));
    c.stroke();
  }
  for (let k = 0; k < n; k++) {
    const [x, y] = at(k);
    moonPhase(c, x, y, r, (TAU * (k + 1)) / (n + 1), p[1], p[3]);
    if (k === (n - 1) / 2) {
      c.fillStyle = rgba(p[2], 0.35);
      dots(c, craters.map(([u, w, cr]) => [x + u * r * 0.8, y + w * r * 0.8, cr * r]));
    }
    c.strokeStyle = p[4];
    c.lineWidth = 0.003 * s;
    c.beginPath();
    c.arc(x, y, r, 0, TAU);
    c.stroke();
  }
  grain(c, W, H, R, 0.03);
}

/** Points along a Catmull-Rom spline through pts (closed: back to the start), `per` samples per span. */
function splinePts(pts, closed, per = 16) {
  const n = pts.length, out = [];
  const at = (i) => (closed ? pts[(i + n) % n] : pts[clamp(i, 0, n - 1)]);
  const spans = closed ? n : n - 1;
  for (let i = 0; i < spans; i++) {
    const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
    for (let k = 0; k < per; k++) {
      const t = k / per, t2 = t * t, t3 = t2 * t;
      out.push([0, 1].map((j) => 0.5 * (2 * p1[j] + (-p0[j] + p2[j]) * t + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * t2 + (-p0[j] + 3 * p1[j] - 3 * p2[j] + p3[j]) * t3)));
    }
  }
  out.push(closed ? out[0] : pts[n - 1]);
  return out;
}

/**
 * Geometric-lines «free» (Bohus Tay): free, looping brush lines in p[1] on p[0] – 4–6 closed loops and 3–4 long
 * strokes that run off the canvas, each a ribbon whose width swells and thins like a loaded brush, scraped dry in
 * places, over a faint dry-brushed ground.
 */
function freeLines(c, W, H, R, p) {
  const s = S(W, H);
  const loops = Array.from({ length: R.int(4, 6) }, () => {
    const cx = W * R.range(0.22, 0.78), cy = H * R.range(0.22, 0.78), rx = R.range(0.14, 0.36) * s, ry = R.range(0.1, 0.28) * s;
    const rot = R() * TAU, n = R.int(5, 7), ca = Math.cos(rot), sa = Math.sin(rot);
    const pts = Array.from({ length: n }, (_, k) => {
      const a = (k / n) * TAU + R.range(-0.3, 0.3), f = R.range(0.65, 1.25), x = Math.cos(a) * rx * f, y = Math.sin(a) * ry * f;
      return [cx + x * ca - y * sa, cy + x * sa + y * ca];
    });
    return { pts, closed: true, w: R.range(0.006, 0.014) * s, ph: R() * TAU, k: R.range(1.5, 4) };
  });
  const strokes = Array.from({ length: R.int(3, 4) }, (_, i) => {
    const vert = i % 2 === 1, t = R.range(0.08, 0.92), bend = R.range(-0.06, 0.06) * s, tilt = R.range(-0.08, 0.08), a0 = R.range(-0.1, 0.25), a1 = R.range(0.75, 1.1);
    const pts = [0, 0.33, 0.67, 1].map((u, k) => {
      const along = a0 + (a1 - a0) * u, across = t + tilt * (u - 0.5);
      const off = k === 1 || k === 2 ? bend * (k === 1 ? 1 : 0.6) : 0;
      return vert ? [across * W + off, along * H] : [along * W, across * H + off];
    });
    return { pts, closed: false, w: R.range(0.004, 0.01) * s, ph: R() * TAU, k: R.range(1, 3) };
  });
  const scrapes = [...loops, ...strokes].map(() => [R.range(-0.25, 0.25), R.range(0, 0.6), R.range(0.25, 0.5), R.range(0.3, 0.55)]);
  const smudges = Array.from({ length: R.int(4, 7) }, () => [R.range(-0.1, 0.7) * W, R() * H, R.range(0.3, 0.6) * W, R.range(0.04, 0.1) * s, R.range(-0.06, 0.06), R.range(0.25, 0.45)]);
  const smudgeSeed = seedOf(R);

  fill(c, W, H, p[0]);
  const st = brushStamp(smudgeSeed, 0.5 * s, 0.08 * s, mix(p[0], p[4], 0.22), { streaks: 10, dry: 0.4 });
  for (const [x, y, L, w, a, al] of smudges) stampLine(c, st, x, y, x + Math.cos(a) * L, y + Math.sin(a) * L, w, al);
  c.fillStyle = p[1];
  const lines = [...loops, ...strokes].map((ln) => ({ ...ln, path: splinePts(ln.pts, ln.closed, 18) }));
  for (const ln of lines) {
    const P = ln.path, m = P.length;
    // the ribbon in short pieces (a self-crossing loop filled in one piece would cancel where it crosses itself)
    const half = (i) => {
      const u = i / (m - 1), taper = ln.closed ? 1 : Math.min(1, u / 0.08, (1 - u) / 0.08);
      return Math.max(0.6, ln.w * (0.55 + 0.45 * Math.sin(u * ln.k * TAU + ln.ph)) * (0.35 + 0.65 * taper)) / 2;
    };
    const nrm = (i) => {
      const a = P[Math.max(0, i - 1)], b = P[Math.min(m - 1, i + 1)], L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      return [-(b[1] - a[1]) / L, (b[0] - a[0]) / L];
    };
    for (let i0 = 0; i0 < m - 1; i0 += 10) {
      const i1 = Math.min(m - 1, i0 + 11), l = [], r = [];
      for (let i = i0; i <= i1; i++) {
        const [nx, ny] = nrm(i), h = half(i);
        l.push([P[i][0] + nx * h, P[i][1] + ny * h]);
        r.push([P[i][0] - nx * h, P[i][1] - ny * h]);
      }
      poly(c, [...l, ...r.reverse()]);
      c.fill();
    }
  }
  // dry-brush scrapes: hairlines of the ground colour along parts of the thicker lines
  c.strokeStyle = p[0];
  c.lineWidth = Math.max(0.6, 0.0016 * s);
  lines.forEach((ln, j) => {
    const [o, u0, len, al] = scrapes[j], P = ln.path, m = P.length;
    if (ln.w < 0.007 * s) return;
    const i0 = Math.floor(u0 * (m - 1)), i1 = Math.min(m - 1, i0 + Math.floor(len * (m - 1)));
    c.globalAlpha = al;
    c.beginPath();
    for (let i = i0; i <= i1; i++) {
      const a = P[Math.max(0, i - 1)], b = P[Math.min(m - 1, i + 1)], L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      const x = P[i][0] - ((b[1] - a[1]) / L) * o * ln.w, y = P[i][1] + ((b[0] - a[0]) / L) * o * ln.w;
      if (i === i0) c.moveTo(x, y);
      else c.lineTo(x, y);
    }
    c.stroke();
  });
  c.globalAlpha = 1;
  grain(c, W, H, R, 0.05);
}

function geometricLines(c, W, H, R, p, o) {
  if (o && o.variant === 'free') return freeLines(c, W, H, R, p);
  const s = S(W, H);
  // a constructed drawing: two related circles, lines through their centres, a concentric arc, dots on the figure
  const A = [W / 2 + R.range(-0.08, 0.08) * s, H / 2 + R.range(-0.08, 0.08) * s];
  const r1 = R.range(0.2, 0.3) * s, dir = R() * TAU, dist = R.range(0.4, 0.9) * r1;
  const B = [A[0] + Math.cos(dir) * dist, A[1] + Math.sin(dir) * dist], r2 = R.range(0.12, 0.24) * s;
  const nCircles = R.int(1, 3);
  const r3 = r1 * R.range(0.42, 0.62);
  const base = R() < 0.5 ? { at: R() < 0.5 ? A : B, r: R.range(0.75, 1) * (R() < 0.5 ? r1 : r2), half: R() < 0.5, rot: dir + R.int(0, 3) * HALF_PI } : null;
  const angs = [dir, dir + HALF_PI, 0, HALF_PI, Math.PI / 4];
  const lines = Array.from({ length: R.int(2, 4) }, () => {
    const q = R() < 0.6 ? A : B, a = R.pick(angs), L = R.range(0.55, 0.95) * s, t = R.range(0.3, 0.7);
    return [q[0] - Math.cos(a) * L * t, q[1] - Math.sin(a) * L * t, q[0] + Math.cos(a) * L * (1 - t), q[1] + Math.sin(a) * L * (1 - t)];
  });
  const arc = { r: r1 * R.range(1.18, 1.4), a0: R() * TAU, sw: R.range(0.9, 2.4) };
  const ds = Array.from({ length: R.int(3, 7) }, (_, i) => {
    const on = i === 0 ? null : R.pick([[A, r1], [B, r2], [A, arc.r]]), a = R() * TAU;
    return on ? [on[0][0] + Math.cos(a) * on[1], on[0][1] + Math.sin(a) * on[1], ink(s, 0.006, 2.4)] : [B[0], B[1], ink(s, 0.006, 2.4)];
  });

  fill(c, W, H, p[0]);
  if (base) {
    c.fillStyle = p[2];
    c.beginPath();
    if (base.half) {
      c.arc(base.at[0], base.at[1], base.r, base.rot, base.rot + Math.PI);
      c.closePath();
    } else c.arc(base.at[0], base.at[1], base.r, 0, TAU);
    c.fill();
  }
  c.lineCap = 'round';
  c.strokeStyle = p[1];
  c.lineWidth = ink(s, 0.003, 2.3);
  c.beginPath();
  c.arc(A[0], A[1], r1, 0, TAU);
  if (nCircles > 1) {
    c.moveTo(B[0] + r2, B[1]);
    c.arc(B[0], B[1], r2, 0, TAU);
  }
  if (nCircles > 2) {
    c.moveTo(A[0] + r3, A[1]);
    c.arc(A[0], A[1], r3, 0, TAU);
  }
  c.stroke();
  c.lineWidth = ink(s, 0.0045, 3);
  c.beginPath();
  c.arc(A[0], A[1], arc.r, arc.a0, arc.a0 + arc.sw);
  c.stroke();
  c.strokeStyle = p[3];
  c.lineWidth = ink(s, 0.0025, 1.9);
  c.beginPath();
  for (const [x0, y0, x1, y1] of lines) {
    c.moveTo(x0, y0);
    c.lineTo(x1, y1);
  }
  c.stroke();
  c.fillStyle = p[3];
  dots(c, ds);
  grain(c, W, H, R, 0.03);
}

function stripes(c, W, H, R, p, o) {
  const s = S(W, H);
  const v = variantOf(R, o, ['vertical', 'diagonal', 'blocks']);
  const ang = R.range(0.5, 0.8) * R.sign();
  const D = Math.hypot(W, H);
  // stripes: boundaries as 12-point jittered lines (hand cut), colours never equal to their neighbour
  const span = v === 'diagonal' ? D : W, unit = v === 'diagonal' ? 0.75 * D : W;
  const bounds = [];
  for (let x = 0; x < span;) {
    x += R.range(0.04, 0.2) * unit;
    bounds.push({ x, j: Array.from({ length: 12 }, () => R.range(-0.003, 0.003) * unit) });
  }
  const order = shuffled(R, [0, 1, 2, 3, 4]);
  const nbk = R.int(3, 5);
  const weights = Array.from({ length: nbk }, () => R.range(0.6, 1.4));
  const bcols = shuffled(R, [1, 2, 3, 4]);

  fill(c, W, H, p[0]);
  if (v === 'blocks') {
    const m = 0.08 * s, gap = 0.03 * s, vert = H >= W;
    const long = (vert ? H : W) - 2 * m - gap * (nbk - 1), sum = weights.reduce((a, b) => a + b, 0);
    let t = m;
    weights.forEach((w, i) => {
      const len = (long * w) / sum;
      c.fillStyle = p[bcols[i % 4]];
      c.beginPath();
      if (vert) c.roundRect(m, t, W - 2 * m, len, 0.01 * s);
      else c.roundRect(t, m, len, H - 2 * m, 0.01 * s);
      c.fill();
      t += len + gap;
    });
  } else {
    c.save();
    let h = H, x0 = 0;
    if (v === 'diagonal') {
      c.translate(W / 2, H / 2);
      c.rotate(ang);
      c.translate(-D / 2, -D / 2);
      h = D;
    }
    c.fillStyle = p[order[0]];
    c.fillRect(x0 - 1, -1, span + 2, h + 2);
    const edge = (b, k) => [b ? b.x + b.j[k] : span + 2, (k / 11) * (h + 2) - 1];
    bounds.forEach((b, i) => {
      const nb = bounds[i + 1];
      c.fillStyle = p[order[(i + 1) % 5]];
      c.beginPath();
      for (let k = 0; k < 12; k++) c.lineTo(...edge(b, k));
      for (let k = 11; k >= 0; k--) c.lineTo(...edge(nb, k));
      c.closePath();
      c.fill();
    });
    c.restore();
  }
  grain(c, W, H, R, 0.04);
}

function dotsMotif(c, W, H, R, p, o) {
  const s = S(W, H);
  const v = variantOf(R, o, ['grid', 'scatter', 'big']);
  // grid
  const sp = 0.12 * s, cols = Math.max(1, Math.floor(W / sp)), rows = Math.max(1, Math.floor(H / sp));
  const gx = (W - (cols - 1) * sp) / 2, gy = (H - (rows - 1) * sp) / 2;
  const grid = [];
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) grid.push([gx + i * sp, gy + j * sp, R.int(1, 4), R() < 0.3 ? R.pick([-0.15, 0.15]) : 0]);
  // scatter with overlap rejection
  const sc = [];
  const ns = R.int(40, 120);
  for (let i = 0; i < ns; i++) {
    for (let t = 0; t < 8; t++) {
      const r = R.range(0.005, 0.05) * s, x = R() * W, y = R() * H;
      if (sc.every((d) => Math.hypot(d[0] - x, d[1] - y) > d[2] + r + 0.004 * s)) {
        sc.push([x, y, r]);
        break;
      }
    }
  }
  // big dot
  const bx = W / 2 + R.range(-0.1, 0.1) * s, by = H / 2 + R.range(-0.1, 0.06) * s, br = 0.3 * s;
  const small = [3, 4].map(() => {
    const a = R() * TAU, d = br + R.range(0.08, 0.16) * s;
    return [bx + Math.cos(a) * d, by + Math.sin(a) * d, R.range(0.025, 0.05) * s];
  });

  fill(c, W, H, p[0]);
  if (v === 'grid') {
    const groups = new Map();
    for (const [x, y, ci, t] of grid) {
      const col = t ? tint(p[ci], t) : p[ci];
      if (!groups.has(col)) groups.set(col, []);
      groups.get(col).push([x, y, 0.035 * s]);
    }
    for (const [col, pts] of groups) {
      c.fillStyle = col;
      dots(c, pts);
    }
  } else if (v === 'scatter') {
    c.fillStyle = p[1];
    dots(c, sc);
  } else {
    c.fillStyle = p[1];
    circle(c, bx, by, br);
    c.fillStyle = p[3];
    circle(c, ...small[0]);
    c.fillStyle = p[4];
    circle(c, ...small[1]);
  }
  grain(c, W, H, R, 0.03);
}

/** Letter-spaced text (canvas letterSpacing where supported, else one glyph at a time). */
function spacedText(c, text, x, y, px, family, weight, spacing, align = 'center') {
  c.font = `normal ${weight} ${Math.max(4, px)}px ${family}`;
  if ('letterSpacing' in c) {
    c.letterSpacing = `${(spacing * px).toFixed(1)}px`;
    c.textAlign = align;
    c.fillText(text, x + (align === 'center' ? (spacing * px) / 2 : 0), y);
    c.letterSpacing = '0px';
    return;
  }
  const chars = [...text], ws = chars.map((ch) => c.measureText(ch).width + spacing * px);
  const total = ws.reduce((a, b) => a + b, 0);
  let cx = align === 'center' ? x - total / 2 : align === 'right' ? x - total : x;
  c.textAlign = 'left';
  chars.forEach((ch, i) => {
    c.fillText(ch, cx, y);
    cx += ws[i];
  });
}

function typography(c, W, H, R, p, o) {
  const s = S(W, H);
  const v = variantOf(R, o, ['centre', 'bottom', 'block', 'vertical']);
  const defText = R.pick(['HJEM', 'KOS', 'HAV', 'FJELL', 'SKOG', 'SOMMER', 'Å', 'GOD NATT']);
  const defSub = R.pick(['', 'ta det med ro', 'Oslo · 59°55′N', 'sommeren 2026']);
  const serif = R() < 0.5, deco = R() < 0.5, decoCircle = R() < 0.5;
  const text = (o.text || defText).toUpperCase();
  // a poster with its own text gets no invented caption (only its own subtext)
  const sub = o.subtext ?? (o.text ? '' : defSub);
  const family = serif ? FONTS.serif : FONTS.sans, weight = serif ? '400' : '700';
  const subPx = 0.035 * s;

  fill(c, W, H, p[0]);
  c.textBaseline = 'alphabetic';
  if (v === 'centre') {
    if (deco) {
      c.fillStyle = p[1];
      if (decoCircle) circle(c, W / 2, H / 2, 0.3 * s);
      else c.fillRect(W / 2 - 0.27 * s, H / 2 - 0.36 * s, 0.54 * s, 0.72 * s);
    }
    c.fillStyle = p[3];
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    fitText(c, text, 0.8 * W, family, Math.min(0.5 * H, 0.62 * s), weight);
    c.fillText(text, W / 2, H / 2);
    c.textBaseline = 'alphabetic';
    if (sub) {
      c.fillStyle = p[3];
      spacedText(c, sub, W / 2, H / 2 + 0.38 * s, subPx, FONTS.grotesk, '400', 0.25);
    }
  } else if (v === 'bottom') {
    const base = H - 0.08 * s;
    c.fillStyle = p[3];
    c.textAlign = 'left';
    const px = fitText(c, text, W - 0.14 * s, family, Math.min(0.32 * H, 0.42 * s), weight);
    c.fillText(text, 0.07 * s, base);
    c.fillStyle = p[1];
    c.fillRect(0.07 * s, base - px * 0.82 - 0.05 * s, W - 0.14 * s, 0.008 * s);
    if (sub) {
      c.fillStyle = p[3];
      spacedText(c, sub, 0.07 * s, 0.07 * s + subPx, subPx, FONTS.grotesk, '400', 0.25, 'left');
    }
  } else if (v === 'block') {
    c.fillStyle = p[1];
    c.fillRect(0, 0, W, 0.6 * H);
    c.fillStyle = p[0];
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    fitText(c, text, 0.8 * W, family, Math.min(0.36 * H, 0.5 * s), weight);
    c.fillText(text, W / 2, 0.3 * H);
    c.textBaseline = 'alphabetic';
    if (sub) {
      c.fillStyle = p[3];
      spacedText(c, sub, W / 2, 0.8 * H, subPx, FONTS.grotesk, '400', 0.25);
    }
  } else {
    const letters = [...text];
    const n = letters.length, cell = H / (n + 1);
    c.fillStyle = p[3];
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    const px = Math.min(cell * 1.05, 0.5 * W);
    c.font = `normal ${weight} ${px}px ${family}`;
    letters.forEach((ch, i) => {
      if (ch.trim()) c.fillText(ch, W / 2, cell * (i + 1));
    });
    c.textBaseline = 'alphabetic';
    c.fillStyle = p[1];
    c.fillRect(W / 2 - 0.12 * s, H - 0.5 * cell, 0.24 * s, 0.006 * s);
  }
  grain(c, W, H, R, 0.02);
}

/** The great wave: the closed body path in box coordinates (u, v ∈ 0…1) with jitter j. */
const WAVE = [
  [0.05, 0.3], [0.25, 0.15], [0.42, 0.22],
  [0.5, 0.27], [0.45, 0.38], [0.38, 0.35],
  [0.32, 0.32], [0.3, 0.45], [0.4, 0.55],
  [0.55, 0.7], [0.8, 0.72], [1, 0.8],
];

function wave(c, W, H, R, p, o) {
  const s = S(W, H);
  const v = variantOf(R, o, ['great', 'seigaiha']);
  const j = WAVE.map(([u, w]) => [u + R.range(-0.03, 0.03), w + R.range(-0.03, 0.03)]);
  j[11][0] = 1;
  const y0 = 0.55 + R.range(-0.03, 0.03);
  const crests = R.int(6, 9);
  const claws = Array.from({ length: R.int(12, 20) }, () => [R(), R.range(0.012, 0.02), R() * TAU]);
  const foam = Array.from({ length: 30 }, () => [R.range(-0.12, 0.08), R.range(-0.12, 0.06), R.range(0.003, 0.008)]);
  const sg = { r: R.range(0.065, 0.1), rings: R.int(3, 5), light: R() < 0.7 ? 4 : 0, three: R() < 0.5, dx: R(), dy: R() };

  if (v === 'great') {
    fill(c, W, H, p[0]);
    vgrad(c, W, 0, H * 0.5, [[0, mix(p[0], p[2], 0.28)], [1, p[0]]]);
    // box: the wave keeps its proportions; wider canvases extend the sea sideways
    const bw = Math.min(W, H * 1.45), bh = Math.min(H, bw / 1.1), bx = (W - bw) / 2, by = H - bh;
    const X = (u, b = { x: bx, w: bw }) => b.x + u * b.w;
    const Y = (w, b = { y: by, h: bh }) => b.y + w * b.h;
    // Mount Fuji, far away
    const fx = X(0.6), fy = Y(0.64), fs = 0.1 * s;
    c.fillStyle = p[2];
    poly(c, [[fx - fs, fy], [fx - fs * 0.14, fy - fs * 0.62], [fx + fs * 0.14, fy - fs * 0.62], [fx + fs, fy]]);
    c.fill();
    c.fillStyle = p[4];
    poly(c, [[fx - fs * 0.38, fy - fs * 0.39], [fx - fs * 0.14, fy - fs * 0.62], [fx + fs * 0.14, fy - fs * 0.62], [fx + fs * 0.38, fy - fs * 0.39], [fx + fs * 0.2, fy - fs * 0.34], [fx, fy - fs * 0.42], [fx - fs * 0.2, fy - fs * 0.34]]);
    c.fill();
    const body = (b, ext) => {
      const px = (k) => X(j[k][0], b), py = (k) => Y(j[k][1], b);
      c.beginPath();
      c.moveTo(ext ? 0 : b.x, H + 2);
      c.lineTo(ext ? 0 : b.x, Y(y0, b));
      c.lineTo(b.x, Y(y0, b));
      for (let k = 0; k < 12; k += 3) c.bezierCurveTo(px(k), py(k), px(k + 1), py(k + 1), px(k + 2), py(k + 2));
      if (ext) c.lineTo(W, py(11));
      c.lineTo(ext ? W : b.x + b.w, H + 2);
      c.closePath();
    };
    const crestLine = (b, f, sc) => {
      const T = (u, w) => [f[0] + (X(u, b) - f[0]) * sc, f[1] + (Y(w, b) - f[1]) * sc];
      c.beginPath();
      c.moveTo(...T(0, y0));
      for (let k = 0; k < 12; k += 3) c.bezierCurveTo(...T(...j[k]), ...T(...j[k + 1]), ...T(...j[k + 2]));
    };
    const draw = (b, ext) => {
      body(b, ext);
      c.fillStyle = p[1];
      c.fill();
      c.save();
      body(b, ext);
      c.clip();
      c.strokeStyle = p[2];
      c.lineWidth = 0.006 * s * (b.w / bw);
      const f = [X(0.4, b), Y(0.6, b)];
      for (let k = 1; k <= crests; k++) {
        crestLine(b, f, Math.pow(0.9, k));
        c.stroke();
      }
      c.restore();
      body(b, ext);
      c.strokeStyle = p[3];
      c.lineWidth = 0.004 * s * (b.w / bw);
      c.stroke();
      // foam claws along the crest (first two curves)
      const pts = [];
      for (const [t, r, a] of claws) {
        const seg = t < 0.6 ? 0 : 3, u = seg ? (t - 0.6) / 0.4 : t / 0.6;
        const a0 = seg ? j[2] : [0, y0], a1 = j[seg], a2 = j[seg + 1], a3 = j[seg + 2];
        const k = 1 - u;
        const cu = k * k * k * a0[0] + 3 * k * k * u * a1[0] + 3 * k * u * u * a2[0] + u * u * u * a3[0];
        const cv = k * k * k * a0[1] + 3 * k * k * u * a1[1] + 3 * k * u * u * a2[1] + u * u * u * a3[1];
        pts.push([X(cu, b), Y(cv, b), r * s * (b.w / bw), a]);
      }
      c.fillStyle = p[4];
      c.strokeStyle = p[3];
      c.lineWidth = 0.003 * s * (b.w / bw);
      for (const [x, y, r, a] of pts) {
        c.beginPath();
        c.arc(x, y, r, a, a + Math.PI * 1.4);
        c.lineTo(x, y);
        c.closePath();
        c.fill();
        c.stroke();
      }
      c.fillStyle = p[4];
      dots(c, foam.map(([u, w, r]) => [X(j[2][0] + u, b), Y(j[2][1] + w, b), r * s * (b.w / bw)]));
    };
    draw({ x: bx + bw * 0.66, w: bw * 0.4, y: by + bh * 0.47, h: bh * 0.48 }, false);
    draw({ x: bx, w: bw, y: by, h: bh }, true);
  } else {
    // seigaiha: rows of overlapping fan scales, every second row offset by r. The pattern repeats every 2r × r: paint
    // one tile (whole px) – rows from above and below included, so the overlaps are right – and fill with it
    const r = Math.max(4, Math.round(sg.r * s)), step = r * 0.5;
    fill(c, W, H, p[1]);
    const t = layer(2 * r, r);
    for (let row = -3; row <= 3; row++) {
      const y = row * step, off = row % 2 ? r : 0;
      for (let ring = 0; ring < sg.rings; ring++) {
        const rr = r * (1 - ring * (0.96 / sg.rings));
        t.x.fillStyle = ring % 2 ? p[sg.light] : ring && sg.three && ring === sg.rings - 1 ? p[2] : p[1];
        t.x.beginPath();
        for (let i = -1; i <= 2; i++) {
          const x = i * 2 * r + off;
          t.x.moveTo(x + rr, y);
          t.x.arc(x, y, rr, 0, Math.PI, true);
          t.x.closePath();
        }
        t.x.fill();
      }
    }
    c.save();
    c.translate(-sg.dx * 2 * r, sg.dy * step);
    c.fillStyle = c.createPattern(t.cv, 'repeat');
    c.fillRect(sg.dx * 2 * r, -sg.dy * step, W, H);
    c.restore();
  }
  grain(c, W, H, R, 0.035);
}

function blobs(c, W, H, R, p) {
  const s = S(W, H);
  const n = R.int(3, 6), cols = shuffled(R, [1, 2, 3, 4]);
  const placed = [];
  const items = Array.from({ length: n }, (_, i) => {
    const r = R.range(0.14, 0.3) * s;
    let q = null, bestD = -Infinity;
    for (let t = 0; t < 8; t++) {
      const cand = [W * R.range(0.18, 0.82), H * R.range(0.18, 0.82)];
      const d = placed.reduce((m, o) => Math.min(m, Math.hypot(o[0] - cand[0], o[1] - cand[1]) - 0.7 * (o[2] + r)), Infinity);
      if (d > bestD) [q, bestD] = [cand, d];
    }
    placed.push([q[0], q[1], r]);
    return { q, r, n: R.int(6, 9), rot: R() * TAU, col: cols[i % 4] };
  });
  const strokes = Array.from({ length: 60 }, () => {
    const b = items[R.int(0, n - 1)], a = R.range(-0.6, 0.6), L = R.range(0.3, 0.9) * b.r;
    const x = b.q[0] + R.range(-0.55, 0.55) * b.r, y = b.q[1] + R.range(-0.55, 0.55) * b.r;
    return { b, x0: x - (Math.cos(a) * L) / 2, y0: y - (Math.sin(a) * L) / 2, x1: x + (Math.cos(a) * L) / 2, y1: y + (Math.sin(a) * L) / 2, w: R.range(0.02, 0.05) * s, t: R.range(-0.14, 0.14) };
  });

  fill(c, W, H, p[0]);
  const l = layer(W, H);
  for (const b of items) {
    l.x.fillStyle = p[b.col];
    blob(l.x, R, b.q[0], b.q[1], b.r, b.n, 0.3, b.rot);
    l.x.fill();
  }
  blurOnto(c, l, 0.002 * s);
  for (const st of strokes) brush(c, R, st.x0, st.y0, st.x1, st.y1, st.w, tint(p[st.b.col], st.t), 0.12, 4);
  grain(c, W, H, R, 0.05);
}

// ---------------------------------------------------------------------------------------------------------------
// Strek

const PROFILE = [[0, -0.5], [0.05, -0.3], [0.02, -0.12], [0.14, 0], [0.05, 0.05], [0.08, 0.12], [0.03, 0.16], [0.07, 0.22], [0, 0.3], [-0.05, 0.5]];
const BACK = [[-0.3, 0.55], [-0.28, 0.3], [-0.36, 0.12], [-0.47, -0.08], [-0.46, -0.34], [-0.3, -0.53], [-0.1, -0.58]];

function lineFace(c, W, H, R, p, o) {
  const s = S(W, H);
  const v = variantOf(R, o, ['single', 'kiss', 'front']);
  const jit = () => [...BACK, ...PROFILE].map(([x, y]) => [x + R.range(-0.015, 0.015), y + R.range(-0.015, 0.015)]);
  const A = jit(), B = jit();
  const eye = R() < 0.4, twoBlobs = R() < 0.5;
  const bl = [0, 1].map(() => ({ x: W / 2 + R.range(-0.18, 0.18) * s, y: H / 2 + R.range(-0.15, 0.15) * s, r: R.range(0.16, 0.26) * s, n: R.int(6, 8), rot: R() * TAU }));
  const fj = Array.from({ length: 12 }, () => R.range(-0.02, 0.02));

  fill(c, W, H, p[0]);
  c.globalAlpha = 0.9;
  c.fillStyle = p[1];
  blob(c, R, bl[0].x, bl[0].y, bl[0].r, bl[0].n, 0.3, bl[0].rot);
  c.fill();
  if (twoBlobs) {
    c.fillStyle = p[4];
    blob(c, R, bl[1].x, bl[1].y, bl[1].r * 0.7, bl[1].n, 0.3, bl[1].rot);
    c.fill();
  }
  c.globalAlpha = 1;
  c.strokeStyle = p[3];
  c.lineWidth = ink(s, 0.0045, 2.8);
  c.lineCap = 'round';
  c.lineJoin = 'round';
  const face =(pts, cx, cy, sc, dir) => {
    smoothPath(c, pts.map(([x, y]) => [cx + dir * x * sc, cy + y * sc]), false);
    c.stroke();
    if (eye) {
      c.beginPath();
      c.ellipse(cx - dir * 0.06 * sc, cy - 0.13 * sc, 0.045 * sc, 0.022 * sc, 0, 0.15, Math.PI - 0.15);
      c.stroke();
    }
  };
  if (v === 'single') face(A, W / 2 + 0.06 * s, H / 2, 0.7 * s, 1);
  else if (v === 'kiss') {
    const sc = 0.52 * s, d = 0.155 * sc;
    face(A, W / 2 - d, H / 2, sc, 1);
    face(B, W / 2 + d, H / 2 + 0.02 * s, sc, -1);
  } else {
    // front: one continuous line – neck, jaw and head oval, brow into the nose, lips, the other eye
    const u = 0.62 * s, cx = W / 2, cy = H / 2 - 0.02 * s, J = (k) => fj[k] * u;
    const pts = [
      [-0.12, 0.62], [-0.13, 0.4], [-0.25, 0.28], [-0.33, 0.05], [-0.34, -0.2], [-0.25, -0.42], [0, -0.52], [0.25, -0.42],
      [0.34, -0.2], [0.33, 0.05], [0.25, 0.28], [0.12, 0.4], [0.12, 0.62],
    ].map(([x, y], k) => [cx + x * u + J(k % 12), cy + y * u + J((k + 3) % 12)]);
    smoothPath(c, pts, false);
    c.stroke();
    const line = [[-0.2, -0.1], [-0.08, -0.12], [-0.02, -0.08], [0.0, 0.08], [-0.04, 0.12], [0.03, 0.13]].map(([x, y], k) => [cx + x * u + J(k), cy + y * u + J(k + 6)]);
    smoothPath(c, line, false);
    c.stroke();
    c.beginPath();
    c.ellipse(cx - 0.13 * u, cy - 0.05 * u, 0.06 * u, 0.025 * u, 0, 0.2, Math.PI - 0.2);
    c.moveTo(cx + 0.19 * u, cy - 0.05 * u);
    c.ellipse(cx + 0.13 * u, cy - 0.05 * u, 0.06 * u, 0.025 * u, 0, 0.2, Math.PI - 0.2);
    c.stroke();
    c.beginPath();
    c.moveTo(cx - 0.09 * u, cy + 0.24 * u);
    c.quadraticCurveTo(cx - 0.02 * u, cy + 0.2 * u, cx, cy + 0.23 * u);
    c.quadraticCurveTo(cx + 0.02 * u, cy + 0.2 * u, cx + 0.09 * u, cy + 0.24 * u);
    c.quadraticCurveTo(cx, cy + 0.3 * u, cx - 0.09 * u, cy + 0.24 * u);
    c.stroke();
  }
  grain(c, W, H, R, 0.03);
}

// ---------------------------------------------------------------------------------------------------------------
// Barn

/** Animals in unit coordinates (head about −0.5…0.5); P = { main, dark, light, accent, second }. */
const ANIMALS = {
  bear(c, P) {
    c.fillStyle = P.main;
    oval(c, 0, 0.82, 0.52, 0.36);
    oval(c, -0.3, -0.31, 0.13, 0.13);
    oval(c, 0.3, -0.31, 0.13, 0.13);
    oval(c, 0, 0, 0.42, 0.38);
    c.fillStyle = tint(P.main, 0.32);
    oval(c, -0.3, -0.31, 0.07, 0.07);
    oval(c, 0.3, -0.31, 0.07, 0.07);
    c.fillStyle = tint(P.main, 0.45);
    oval(c, 0, 0.13, 0.17, 0.13);
    c.fillStyle = P.dark;
    oval(c, 0, 0.07, 0.065, 0.045);
    c.strokeStyle = P.dark;
    c.lineWidth = 0.018;
    c.lineCap = 'round';
    c.beginPath();
    c.moveTo(0, 0.1);
    c.lineTo(0, 0.16);
    c.arc(-0.04, 0.16, 0.04, 0, Math.PI * 0.8);
    c.moveTo(0.08, 0.16);
    c.arc(0.04, 0.16, 0.04, 0, Math.PI * 0.8);
    c.stroke();
  },
  fox(c, P) {
    c.fillStyle = P.main;
    oval(c, 0, 0.84, 0.44, 0.34);
    c.lineJoin = 'round';
    c.strokeStyle = P.main;
    c.lineWidth = 0.08;
    for (const d of [-1, 1]) {
      poly(c, [[d * 0.4, -0.12], [d * 0.34, -0.6], [d * 0.1, -0.26]]);
      c.fill();
      c.stroke();
    }
    poly(c, [[-0.48, -0.18], [0, -0.32], [0.48, -0.18], [0.06, 0.34], [-0.06, 0.34]]);
    c.fill();
    c.stroke();
    c.fillStyle = P.dark;
    for (const d of [-1, 1]) {
      poly(c, [[d * 0.33, -0.2], [d * 0.32, -0.48], [d * 0.18, -0.27]]);
      c.fill();
    }
    c.fillStyle = P.light;
    for (const d of [-1, 1]) {
      smoothPath(c, [[d * 0.5, -0.14], [d * 0.3, 0.02], [d * 0.12, 0.16], [d * 0.03, 0.36], [d * 0.2, 0.2], [d * 0.42, 0.02]], true);
      c.fill();
    }
    smoothPath(c, [[-0.17, 0.52], [0, 0.47], [0.17, 0.52], [0.09, 0.8], [0, 0.9], [-0.09, 0.8]], true);
    c.fill();
  },
  whale(c, P) {
    c.fillStyle = P.second;
    smoothPath(c, [[0.36, -0.05], [0.56, -0.2], [0.72, -0.36], [0.66, -0.16], [0.82, -0.18], [0.62, -0.04], [0.42, 0.1]], true);
    c.fill();
    oval(c, -0.08, 0.05, 0.56, 0.3, -0.05);
    c.save();
    c.beginPath();
    c.ellipse(-0.08, 0.05, 0.56, 0.3, -0.05, 0, TAU);
    c.clip();
    c.fillStyle = P.light;
    oval(c, -0.12, 0.34, 0.52, 0.2);
    c.strokeStyle = tint(P.second, -0.15);
    c.lineWidth = 0.014;
    c.beginPath();
    for (let k = 0; k < 5; k++) {
      c.moveTo(-0.5 + k * 0.1, 0.2);
      c.lineTo(-0.48 + k * 0.1, 0.32);
    }
    c.stroke();
    c.restore();
    c.strokeStyle = tint(P.second, 0.45);
    c.lineWidth = 0.022;
    c.lineCap = 'round';
    c.beginPath();
    c.moveTo(-0.34, -0.25);
    c.quadraticCurveTo(-0.36, -0.4, -0.48, -0.46);
    c.moveTo(-0.34, -0.25);
    c.quadraticCurveTo(-0.3, -0.41, -0.18, -0.45);
    c.moveTo(-0.34, -0.25);
    c.lineTo(-0.335, -0.44);
    c.stroke();
    c.fillStyle = tint(P.second, 0.45);
    dots(c, [[-0.5, -0.4, 0.018], [-0.16, -0.39, 0.018], [-0.335, -0.5, 0.016]]);
    c.strokeStyle = P.main;
    c.lineWidth = 0.035;
    c.beginPath();
    for (let k = -3; k <= 3; k++) {
      c.moveTo(k * 0.3 - 0.13, 0.5);
      c.quadraticCurveTo(k * 0.3, 0.42, k * 0.3 + 0.13, 0.5);
    }
    c.stroke();
  },
  bunny(c, P) {
    c.fillStyle = P.main;
    oval(c, 0, 0.58, 0.34, 0.38);
    oval(c, -0.12, -0.42, 0.08, 0.27, -0.16);
    oval(c, 0.12, -0.42, 0.08, 0.27, 0.16);
    oval(c, 0, 0.02, 0.3, 0.26);
    c.fillStyle = P.accent;
    oval(c, -0.12, -0.42, 0.04, 0.19, -0.16);
    oval(c, 0.12, -0.42, 0.04, 0.19, 0.16);
    oval(c, -0.17, 0.92, 0.13, 0.07);
    oval(c, 0.17, 0.92, 0.13, 0.07);
    c.fillStyle = P.light;
    oval(c, 0, 0.66, 0.15, 0.2);
    c.fillStyle = P.accent;
    poly(c, [[-0.035, 0.06], [0.035, 0.06], [0, 0.1]]);
    c.fill();
    c.strokeStyle = P.dark;
    c.globalAlpha = 0.6;
    c.lineWidth = 0.008;
    c.beginPath();
    for (const d of [-1, 1]) {
      c.moveTo(d * 0.06, 0.09);
      c.lineTo(d * 0.24, 0.05);
      c.moveTo(d * 0.06, 0.11);
      c.lineTo(d * 0.24, 0.13);
    }
    c.stroke();
    c.globalAlpha = 1;
  },
  deer(c, P) {
    c.strokeStyle = P.dark;
    c.lineWidth = 0.035;
    c.lineCap = 'round';
    c.lineJoin = 'round';
    c.beginPath();
    for (const d of [-1, 1]) {
      c.moveTo(d * 0.08, -0.22);
      c.quadraticCurveTo(d * 0.1, -0.42, d * 0.2, -0.56);
      c.lineTo(d * 0.18, -0.7);
      c.moveTo(d * 0.12, -0.4);
      c.lineTo(d * 0.3, -0.48);
      c.moveTo(d * 0.18, -0.54);
      c.lineTo(d * 0.08, -0.66);
      c.moveTo(d * 0.25, -0.47);
      c.lineTo(d * 0.34, -0.6);
    }
    c.stroke();
    c.fillStyle = P.main;
    oval(c, 0, 0.84, 0.4, 0.34);
    oval(c, -0.3, -0.14, 0.15, 0.06, -0.45);
    oval(c, 0.3, -0.14, 0.15, 0.06, 0.45);
    smoothPath(c, [[-0.24, -0.16], [0, -0.28], [0.24, -0.16], [0.13, 0.22], [0, 0.34], [-0.13, 0.22]], true);
    c.fill();
    c.fillStyle = tint(P.main, 0.4);
    oval(c, -0.3, -0.14, 0.09, 0.03, -0.45);
    oval(c, 0.3, -0.14, 0.09, 0.03, 0.45);
    oval(c, 0, 0.2, 0.1, 0.1);
    c.fillStyle = P.light;
    dots(c, [[-0.2, 0.7, 0.03], [0.05, 0.64, 0.025], [0.24, 0.74, 0.03], [-0.06, 0.82, 0.022], [0.16, 0.9, 0.025]]);
    c.fillStyle = P.dark;
    oval(c, 0, 0.26, 0.05, 0.035);
  },
  cat(c, P) {
    c.strokeStyle = P.main;
    c.lineWidth = 0.09;
    c.lineCap = 'round';
    c.beginPath();
    c.moveTo(0.22, 0.78);
    c.quadraticCurveTo(0.62, 0.72, 0.52, 0.3);
    c.stroke();
    c.fillStyle = P.main;
    smoothPath(c, [[-0.32, 0.92], [-0.36, 0.5], [-0.17, 0.16], [0.17, 0.16], [0.36, 0.5], [0.32, 0.92]], true);
    c.fill();
    oval(c, 0, 0, 0.26, 0.26);
    poly(c, [[-0.25, -0.06], [-0.2, -0.38], [-0.04, -0.22]]);
    c.fill();
    poly(c, [[0.25, -0.06], [0.2, -0.38], [0.04, -0.22]]);
    c.fill();
    c.fillStyle = P.accent;
    oval(c, -0.1, -0.01, 0.04, 0.052);
    oval(c, 0.1, -0.01, 0.04, 0.052);
    c.fillStyle = P.dark;
    oval(c, -0.1, -0.01, 0.012, 0.042);
    oval(c, 0.1, -0.01, 0.012, 0.042);
    c.fillStyle = P.accent;
    poly(c, [[-0.03, 0.07], [0.03, 0.07], [0, 0.1]]);
    c.fill();
    c.strokeStyle = P.light;
    c.globalAlpha = 0.7;
    c.lineWidth = 0.008;
    c.beginPath();
    for (const d of [-1, 1]) {
      c.moveTo(d * 0.07, 0.1);
      c.lineTo(d * 0.3, 0.06);
      c.moveTo(d * 0.07, 0.12);
      c.lineTo(d * 0.3, 0.15);
    }
    c.stroke();
    c.globalAlpha = 1;
  },
  bird(c, P) {
    c.strokeStyle = P.dark;
    c.lineWidth = 0.045;
    c.lineCap = 'round';
    c.beginPath();
    c.moveTo(-0.95, 0.44);
    c.quadraticCurveTo(0, 0.26, 0.95, 0.36);
    c.moveTo(0.4, 0.33);
    c.quadraticCurveTo(0.55, 0.2, 0.7, 0.18);
    c.stroke();
    c.fillStyle = P.second;
    for (const [x, y, a] of [[-0.62, 0.32, -0.5], [-0.48, 0.47, 0.6], [0.58, 0.2, -0.9], [0.74, 0.27, 0.3], [0.85, 0.4, 0.9]]) oval(c, x, y, 0.09, 0.035, a);
    c.fillStyle = P.main;
    poly(c, [[-0.24, 0.12], [-0.56, -0.02], [-0.5, 0.18]]);
    c.fill();
    oval(c, 0, 0.06, 0.3, 0.25);
    oval(c, 0.17, -0.17, 0.17, 0.17);
    c.fillStyle = tint(P.main, 0.35);
    oval(c, 0.08, 0.15, 0.17, 0.12, -0.3);
    c.fillStyle = tint(P.main, -0.18);
    oval(c, -0.07, 0.04, 0.2, 0.12, 0.35);
    c.fillStyle = P.accent;
    poly(c, [[0.32, -0.21], [0.45, -0.15], [0.32, -0.12]]);
    c.fill();
    c.fillStyle = P.dark;
    oval(c, 0.22, -0.2, 0.025, 0.025);
    c.strokeStyle = P.dark;
    c.lineWidth = 0.015;
    c.beginPath();
    c.moveTo(-0.02, 0.3);
    c.lineTo(-0.04, 0.36);
    c.moveTo(0.07, 0.3);
    c.lineTo(0.07, 0.35);
    c.stroke();
  },
};
const EYES = { bear: [[-0.15, -0.06], [0.15, -0.06]], fox: [[-0.16, -0.05], [0.16, -0.05]], whale: [[-0.4, -0.02]], bunny: [[-0.11, -0.03], [0.11, -0.03]], deer: [[-0.09, -0.06], [0.09, -0.06]], cat: [], bird: [] };

function kidsAnimals(c, W, H, R, p, o) {
  const s = S(W, H);
  const v = variantOf(R, o, ['bear', 'fox', 'whale', 'bunny', 'deer', 'cat', 'bird']);
  const acc = Array.from({ length: R.int(6, 14) }, () => {
    const a = R() * TAU, d = R.range(0.36, 0.48);
    return { x: W / 2 + Math.cos(a) * d * s * (W > H ? 1.4 : 1), y: H / 2 + Math.sin(a) * d * s * (H > W ? 1.3 : 1), kind: R.pick(['star', 'dot', 'heart', 'star']), r: R.range(0.012, 0.025) * s, rot: R() * TAU };
  });
  const rainbow = R() < 0.3, rbSide = R.sign();
  const halo = R.range(0.36, 0.44);
  const u = 0.6 * s, cx = W / 2, cy = H / 2 + 0.02 * s;

  fill(c, W, H, p[0]);
  c.fillStyle = mix(p[0], p[2], 0.2);
  circle(c, cx, cy, halo * s);
  if (v === 'cat') {
    c.fillStyle = p[4];
    circle(c, cx + 0.3 * s, cy - 0.3 * s, 0.07 * s);
    c.fillStyle = mix(p[0], p[2], 0.2);
    circle(c, cx + 0.33 * s, cy - 0.32 * s, 0.06 * s);
  }
  if (rainbow) {
    const rx = cx + rbSide * 0.34 * s, ry = H / 2 + 0.42 * s;
    c.lineWidth = 0.025 * s;
    [p[1], p[2], p[4]].forEach((col, i) => {
      c.strokeStyle = col;
      c.beginPath();
      c.arc(rx, ry, (0.1 - i * 0.026) * s, Math.PI, TAU);
      c.stroke();
    });
  }
  c.globalAlpha = 0.7;
  c.fillStyle = p[4];
  c.beginPath();
  for (const a of acc) {
    if (a.kind === 'star') starPath(c, a.x, a.y, a.r * 1.4, 5, 0.45, a.rot);
    else if (a.kind === 'heart') heartPath(c, a.x, a.y, a.r);
    else {
      c.moveTo(a.x + a.r * 0.6, a.y);
      c.arc(a.x, a.y, a.r * 0.6, 0, TAU);
    }
  }
  c.fill();
  c.globalAlpha = 1;
  c.save();
  c.translate(cx, cy);
  c.scale(u, u);
  // highlights must stay light on night palettes (colours may follow the palette; the geometry never does)
  const light = lum(p[0]) > 0.55 ? p[0] : lum(p[4]) > 0.55 ? p[4] : tint(p[1], 0.65);
  const P = { main: p[1], dark: p[3], light, accent: p[4], second: p[2] };
  ANIMALS[v](c, P);
  const eyes = EYES[v];
  if (eyes.length) {
    c.fillStyle = P.dark;
    dots(c, eyes.map(([x, y]) => [x, y, 0.035]));
    c.fillStyle = P.light;
    dots(c, eyes.map(([x, y]) => [x + 0.012, y - 0.012, 0.011]));
  }
  if (v === 'bear' || v === 'bunny' || v === 'fox') {
    c.globalAlpha = 0.45;
    c.fillStyle = P.accent;
    const cy2 = v === 'bunny' ? 0.07 : 0.1;
    ellipse(c, -0.24, cy2, 0.055, 0.035);
    ellipse(c, 0.24, cy2, 0.055, 0.035);
    c.globalAlpha = 1;
  }
  c.restore();
  grain(c, W, H, R, 0.03);
}

// ---------------------------------------------------------------------------------------------------------------
// Kart

const CITIES = [['OSLO', 59.91, 10.75], ['BERGEN', 60.39, 5.32], ['TRONDHEIM', 63.43, 10.39], ['STAVANGER', 58.97, 5.73], ['TROMSØ', 69.65, 18.96]];

function cityMap(c, W, H, R, p, o) {
  const s = S(W, H), m = 0.06 * s;
  const band = H >= 1.1 * W;
  const x0 = m, y0 = m, x1 = W - m, y1 = band ? H - 0.14 * H : H - m;
  const mw = x1 - x0, mh = y1 - y0, mcx = (x0 + x1) / 2, mcy = (y0 + y1) / 2;
  const cityIdx = R.int(0, CITIES.length - 1);
  const lat = R.range(58.5, 70), lon = R.range(5, 25);
  const water = R.pick(['river', 'coast']);
  const vertical = R() < 0.4;
  const rv = { a: R.range(0.2, 0.8), b: R.range(0.2, 0.8), c1: [R.range(0.2, 0.45), R.range(0.05, 0.95)], c2: [R.range(0.55, 0.8), R.range(0.05, 0.95)], w: R.range(0.06, 0.1) * s };
  const bridges = Array.from({ length: R.int(2, 4) }, () => R.range(0.15, 0.85));
  const coast = { side: R.int(0, 3), depth: R.range(0.2, 0.36), j: Array.from({ length: 13 }, () => R.range(-1, 1)) };
  const parks = Array.from({ length: R.int(3, 6) }, () => ({ x: x0 + R() * mw, y: y0 + R() * mh, r: R.range(0.045, 0.1) * s, n: R.int(6, 8), rot: R() * TAU }));
  const ang = R.range(-0.4, 0.4), sp = R.range(0.035, 0.06) * s;
  const D = Math.hypot(mw, mh) / 2 + sp, N = Math.ceil(D / sp);
  const fams = [0, 1].map((f) => {
    const lines = [];
    for (let k = -N; k <= N; k++) lines.push({ d: k * sp + R.range(-0.3, 0.3) * sp, bend: R.range(-0.4, 0.4) * sp, major: k % 3 === 0, skip: R() < 0.06 });
    return { a: ang + (f * Math.PI) / 2, lines };
  });
  const avenues = Array.from({ length: R.int(2, 3) }, (_, i) => ({ a: ang + (i % 2 ? -1 : 1) * Math.PI / 4 + R.range(-0.2, 0.2), d: R.range(-0.25, 0.25) * s }));
  const ring = { x: mcx + R.range(-0.1, 0.1) * s, y: mcy + R.range(-0.1, 0.1) * s, r: R.range(0.22, 0.36) * s, a0: R() * TAU, sw: R.range(2, 4.2) };
  const known = CITIES.find(([n]) => n === (o.text || '').trim().toUpperCase());
  const city = CITIES[cityIdx];
  const title = (o.text || city[0]).toUpperCase();
  const [la, lo] = o.text ? (known ? [known[1], known[2]] : [lat, lon]) : [city[1], city[2]];
  const sub = o.subtext ?? `${la.toFixed(2)}° N · ${lo.toFixed(2)}° Ø`;

  fill(c, W, H, p[0]);
  c.save();
  c.beginPath();
  c.rect(x0, y0, mw, mh);
  c.clip();
  c.fillStyle = p[1];
  for (const pk of parks) {
    blob(c, R, pk.x, pk.y, pk.r, pk.n, 0.35, pk.rot);
    c.fill();
  }
  c.lineCap = 'butt';
  for (const major of [false, true]) {
    c.strokeStyle = major ? p[3] : p[4];
    c.lineWidth = (major ? 0.0032 : 0.0014) * s;
    c.beginPath();
    for (const f of fams) {
      const dx = Math.cos(f.a), dy = Math.sin(f.a), nx = -dy, ny = dx;
      for (const l of f.lines) {
        if (l.major !== major || l.skip) continue;
        const ox = mcx + nx * l.d, oy = mcy + ny * l.d;
        c.moveTo(ox - dx * D, oy - dy * D);
        c.quadraticCurveTo(ox + nx * l.bend * 2, oy + ny * l.bend * 2, ox + dx * D, oy + dy * D);
      }
    }
    c.stroke();
  }
  c.strokeStyle = p[3];
  c.lineWidth = 0.005 * s;
  c.beginPath();
  for (const av of avenues) {
    const dx = Math.cos(av.a), dy = Math.sin(av.a);
    c.moveTo(mcx - dy * av.d - dx * D, mcy + dx * av.d - dy * D);
    c.lineTo(mcx - dy * av.d + dx * D, mcy + dx * av.d + dy * D);
  }
  c.stroke();
  c.lineWidth = 0.006 * s;
  c.beginPath();
  c.arc(ring.x, ring.y, ring.r, ring.a0, ring.a0 + ring.sw);
  c.stroke();
  // water last: it hides the streets it crosses
  c.fillStyle = c.strokeStyle = p[2];
  if (water === 'river') {
    const P0 = vertical ? [x0 + rv.a * mw, y0 - 0.05 * s] : [x0 - 0.05 * s, y0 + rv.a * mh];
    const P3 = vertical ? [x0 + rv.b * mw, y1 + 0.05 * s] : [x1 + 0.05 * s, y0 + rv.b * mh];
    const C1 = vertical ? [x0 + rv.c1[1] * mw, y0 + rv.c1[0] * mh] : [x0 + rv.c1[0] * mw, y0 + rv.c1[1] * mh];
    const C2 = vertical ? [x0 + rv.c2[1] * mw, y0 + rv.c2[0] * mh] : [x0 + rv.c2[0] * mw, y0 + rv.c2[1] * mh];
    c.lineWidth = rv.w;
    c.beginPath();
    c.moveTo(...P0);
    c.bezierCurveTo(...C1, ...C2, ...P3);
    c.stroke();
    c.strokeStyle = p[3];
    c.lineWidth = 0.004 * s;
    c.beginPath();
    for (const t of bridges) {
      const k = 1 - t;
      const bx = k * k * k * P0[0] + 3 * k * k * t * C1[0] + 3 * k * t * t * C2[0] + t * t * t * P3[0];
      const by = k * k * k * P0[1] + 3 * k * k * t * C1[1] + 3 * k * t * t * C2[1] + t * t * t * P3[1];
      const tx = 3 * k * k * (C1[0] - P0[0]) + 6 * k * t * (C2[0] - C1[0]) + 3 * t * t * (P3[0] - C2[0]);
      const ty = 3 * k * k * (C1[1] - P0[1]) + 6 * k * t * (C2[1] - C1[1]) + 3 * t * t * (P3[1] - C2[1]);
      const d = Math.hypot(tx, ty) || 1, hw = rv.w * 0.62;
      c.moveTo(bx - (ty / d) * hw, by + (tx / d) * hw);
      c.lineTo(bx + (ty / d) * hw, by - (tx / d) * hw);
    }
    c.stroke();
  } else {
    // coast: a jagged shoreline parallel to one side, the sea beyond it
    const pts = [];
    const horiz = coast.side % 2 === 1;
    const along = horiz ? mw : mh, across = horiz ? mh : mw;
    for (let k = 0; k <= 12; k++) {
      const t = k / 12, a = (horiz ? x0 : y0) - 0.05 * s + t * (along + 0.1 * s);
      const dep = coast.depth * across + coast.j[k] * 0.06 * s;
      const b = coast.side < 2 ? (horiz ? y0 : x0) + dep : (horiz ? y1 : x1) - dep;
      pts.push(horiz ? [a, b] : [b, a]);
    }
    const edge = coast.side < 2 ? -0.2 * s : 0.2 * s;
    const far = (pt) => (horiz ? [pt[0], (coast.side < 2 ? y0 : y1) + edge] : [(coast.side < 2 ? x0 : x1) + edge, pt[1]]);
    smoothPath(c, [far(pts[0]), ...pts, far(pts[pts.length - 1])], true);
    c.fill();
  }
  c.restore();
  c.strokeStyle = p[3];
  c.lineWidth = 0.002 * s;
  c.strokeRect(x0, y0, mw, mh);
  // title
  c.fillStyle = p[3];
  c.textBaseline = 'alphabetic';
  if (band) {
    const px = Math.min(0.07 * H, fitText(c, title, 0.62 * W, FONTS.grotesk, 0.07 * H, '600'));
    spacedText(c, title, W / 2, y1 + 0.07 * H, px * 0.85, FONTS.grotesk, '600', 0.35);
    c.fillStyle = p[4];
    spacedText(c, sub, W / 2, y1 + 0.07 * H + 0.04 * H, 0.022 * H, FONTS.grotesk, '400', 0.15);
  } else {
    const px = Math.min(0.06 * s, fitText(c, title, 0.45 * mw, FONTS.grotesk, 0.06 * s, '600'));
    const bw = Math.max(c.measureText(title).width * 1.35, 0.3 * s) + 0.05 * s, bh = px * 1.1 + 0.075 * s;
    c.fillStyle = p[0];
    c.fillRect(x0 + 0.03 * s, y1 - 0.03 * s - bh, bw, bh);
    c.fillStyle = p[3];
    spacedText(c, title, x0 + 0.055 * s, y1 - 0.03 * s - bh + 0.025 * s + px * 0.85, px * 0.85, FONTS.grotesk, '600', 0.3, 'left');
    c.fillStyle = p[4];
    spacedText(c, sub, x0 + 0.055 * s, y1 - 0.05 * s, 0.022 * s, FONTS.grotesk, '400', 0.1, 'left');
  }
}

/**
 * Marching squares for level L over the grid z ((nx + 1) × (ny + 1) samples, cell size cs), with the segments chained
 * into polylines ([[x, y], …] each) – a few long strokes draw far faster than thousands of loose segments.
 */
function contourLines(z, nx, ny, cs, L) {
  const at = (i, j) => z[j * (nx + 1) + i];
  const H0 = nx * (ny + 1), NK = H0 + (nx + 1) * ny;
  const px = new Float32Array(NK), py = new Float32Array(NK);
  const adj = new Int32Array(NK * 2).fill(-1);
  const sa = [], sb = [];
  const P = (k, x0, y0, x1, y1, a, b) => {
    const t = (L - a) / (b - a || 1e-9);
    px[k] = x0 + (x1 - x0) * t;
    py[k] = y0 + (y1 - y0) * t;
    return k;
  };
  const add = (k1, k2) => {
    const n = sa.length;
    sa.push(k1);
    sb.push(k2);
    adj[k1 * 2 + (adj[k1 * 2] < 0 ? 0 : 1)] = n;
    adj[k2 * 2 + (adj[k2 * 2] < 0 ? 0 : 1)] = n;
  };
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const a = at(i, j), b = at(i + 1, j), cc = at(i + 1, j + 1), d = at(i, j + 1);
      const idx = (a > L ? 8 : 0) | (b > L ? 4 : 0) | (cc > L ? 2 : 0) | (d > L ? 1 : 0);
      if (idx === 0 || idx === 15) continue;
      const x = i * cs, y = j * cs;
      const T = () => P(j * nx + i, x, y, x + cs, y, a, b);
      const Rr = () => P(H0 + j * (nx + 1) + i + 1, x + cs, y, x + cs, y + cs, b, cc);
      const B = () => P((j + 1) * nx + i, x, y + cs, x + cs, y + cs, d, cc);
      const Lf = () => P(H0 + j * (nx + 1) + i, x, y, x, y + cs, a, d);
      switch (idx) {
        case 1: case 14: add(Lf(), B()); break;
        case 2: case 13: add(B(), Rr()); break;
        case 3: case 12: add(Lf(), Rr()); break;
        case 4: case 11: add(T(), Rr()); break;
        case 5: add(Lf(), T()); add(B(), Rr()); break;
        case 6: case 9: add(T(), B()); break;
        case 7: case 8: add(Lf(), T()); break;
        case 10: add(T(), Rr()); add(Lf(), B()); break;
        default: break;
      }
    }
  }
  const used = new Uint8Array(sa.length), lines = [];
  const walk = (key, out) => {
    for (;;) {
      let n = adj[key * 2];
      if (n < 0 || used[n]) n = adj[key * 2 + 1];
      if (n < 0 || used[n]) return out;
      used[n] = 1;
      key = sa[n] === key ? sb[n] : sa[n];
      out.push(key);
    }
  };
  for (let n = 0; n < sa.length; n++) {
    if (used[n]) continue;
    used[n] = 1;
    const back = walk(sa[n], []).reverse(), fwd = walk(sb[n], []);
    const keys = [...back, sa[n], sb[n], ...fwd];
    lines.push(keys.map((k) => [px[k], py[k]]));
  }
  return lines;
}
function topoMap(c, W, H, R, p, o) {
  const s = S(W, H);
  const seed = R.int(1, 1e6), nl = R.int(10, 14), grid = R() < 0.5, ox = R.range(0, 50), oy = R.range(0, 50);
  const peaks = Array.from({ length: R.int(2, 3) }, () => [W * R.range(0.15, 0.85), H * R.range(0.15, 0.85), R.range(0.18, 0.36) * s, R.range(0.6, 1)]);
  const defSub = R.pick(['Jotunheimen', 'Rondane', 'Lofoten', 'Hardangervidda']);
  const sub = o.subtext ?? defSub;
  const noise = createNoise2D(seed);
  const cs = Math.max(W, H) / 80, nx = Math.max(2, Math.ceil(W / cs)), ny = Math.max(2, Math.ceil(H / cs));
  const f = 1.7 / s;
  const z = new Float32Array((nx + 1) * (ny + 1));
  let lo = Infinity, hi = -Infinity;
  for (let j = 0; j <= ny; j++) {
    for (let i = 0; i <= nx; i++) {
      const x = i * cs, y = j * cs;
      let v = 0.5 * fbm2D(noise, ox + x * f, oy + y * f, 4);
      for (const [px, py, pr, ph] of peaks) {
        const d2 = ((x - px) ** 2 + (y - py) ** 2) / (pr * pr);
        v += ph * Math.exp(-d2);
      }
      z[j * (nx + 1) + i] = v;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
  }
  const lv = (k) => lo + ((hi - lo) * (k + 0.6)) / (nl + 0.6);

  fill(c, W, H, p[0]);
  // hypsometric tint and soft hill shading on the coarse grid (its own small canvas), drawn smoothed to full size
  const { cv: g, x: gx } = pixelLayer(nx + 1, ny + 1);
  const img = gx.createImageData(nx + 1, ny + 1);
  const rgb = (hex) => [1, 3, 5].map((k) => parseInt(hex.slice(k, k + 2), 16));
  const stops = [rgb(p[0]), rgb(mix(p[0], p[2], 0.55)), rgb(mix(p[0], p[1], 0.5)), rgb(mix(p[0], p[4], 0.25))], lake = rgb(mix(p[2], p[4], 0.35)), l0 = lv(0);
  for (let j = 0; j <= ny; j++) {
    for (let i = 0; i <= nx; i++) {
      const k = j * (nx + 1) + i, t = clamp((z[k] - lo) / (hi - lo || 1), 0, 1) * 2.999, q = Math.floor(t), r = t - q;
      const dzx = z[j * (nx + 1) + Math.min(nx, i + 1)] - z[j * (nx + 1) + Math.max(0, i - 1)];
      const dzy = z[Math.min(ny, j + 1) * (nx + 1) + i] - z[Math.max(0, j - 1) * (nx + 1) + i];
      const sh = clamp(1 - (dzx + dzy) * (6 / (hi - lo || 1)) * 0.25, 0.8, 1.15);
      for (let ch = 0; ch < 3; ch++) img.data[k * 4 + ch] = z[k] < l0 ? lake[ch] : clamp((stops[q][ch] + (stops[q + 1][ch] - stops[q][ch]) * r) * sh, 0, 255);
      img.data[k * 4 + 3] = 255;
    }
  }
  gx.putImageData(img, 0, 0);
  c.save();
  c.imageSmoothingEnabled = true;
  c.imageSmoothingQuality = 'low';
  c.drawImage(g, -cs / 2, -cs / 2, (nx + 1) * cs, (ny + 1) * cs);
  c.restore();
  c.lineCap = 'round';
  c.lineJoin = 'round';
  for (let k = 0; k < nl; k++) {
    const major = k % 5 === 4;
    c.strokeStyle = major ? mix(p[1], p[3], 0.3) : p[3];
    c.globalAlpha = major ? 1 : 0.75;
    // minor contours as hairlines (≤ 1 px: the browser's fast path), index contours bolder
    c.lineWidth = major ? 0.0035 * s : Math.min(1, 0.0016 * s);
    // one stroke per contour line (a path of hundreds of subpaths rasterises far slower); smooth curves through every
    // second crossing: half the points, no corners
    for (const line of contourLines(z, nx, ny, cs, lv(k))) {
      const n = line.length;
      c.beginPath();
      c.moveTo(line[0][0], line[0][1]);
      if (n < 5) for (let m = 1; m < n; m++) c.lineTo(line[m][0], line[m][1]);
      else {
        for (let m = 2; m < n - 1; m += 2) c.quadraticCurveTo(line[m - 1][0], line[m - 1][1], line[m][0], line[m][1]);
        c.lineTo(line[n - 1][0], line[n - 1][1]);
      }
      c.stroke();
    }
  }
  c.globalAlpha = 1;
  if (grid) {
    c.strokeStyle = p[4];
    c.lineWidth = 0.001 * s;
    c.beginPath();
    for (let x = 0.2 * s; x < W; x += 0.2 * s) {
      c.moveTo(x, 0);
      c.lineTo(x, H);
    }
    for (let y = 0.2 * s; y < H; y += 0.2 * s) {
      c.moveTo(0, y);
      c.lineTo(W, y);
    }
    c.stroke();
  }
  if (sub) {
    const px = 0.032 * s;
    c.font = `italic 400 ${px}px ${FONTS.italic}`;
    const tw = c.measureText(sub).width;
    c.fillStyle = p[0];
    c.fillRect(W - 0.06 * s - tw - 0.02 * s, H - 0.06 * s - px * 1.1, tw + 0.04 * s, px * 1.5);
    c.fillStyle = p[3];
    c.textAlign = 'right';
    c.textBaseline = 'alphabetic';
    c.fillText(sub, W - 0.06 * s, H - 0.06 * s);
  }
  c.strokeStyle = p[3];
  c.lineWidth = 0.002 * s;
  c.strokeRect(0.03 * s, 0.03 * s, W - 0.06 * s, H - 0.06 * s);
}

// ---------------------------------------------------------------------------------------------------------------

/** MotifDefs (contract in models/artmotifs.js). */
export const GRAPHIC = {
  bauhaus: { label: 'Bauhaus', group: 'grafisk', cost: 'S', palette: ['#efe8dc', '#c8553d', '#e3b23c', '#2d4059', '#1f1f1f'], paint: bauhaus },
  'mid-century': {
    label: 'Retro 50-tall', group: 'grafisk', cost: 'S', palette: ['#f1e6d2', '#d9822b', '#2a7f7a', '#3b3a36', '#e8c547'],
    variants: [['boomerang', 'Bumeranger'], ['drops', 'Dråper']], paint: midCentury,
  },
  cutouts: {
    label: 'Papirklipp (Matisse)', group: 'grafisk', cost: 'M', palette: ['#f2ebe0', '#2f5d8c', '#e2725b', '#1f1f1f', '#e9c46a'],
    variants: [['shapes', 'Former'], ['flower', 'Blomst']], paint: cutouts,
  },
  arches: {
    label: 'Buer', group: 'grafisk', cost: 'S', palette: ['#efe4d6', '#c97b5a', '#e0b98f', '#6b4f3f', '#9aa58a'],
    variants: [['rainbow', 'Regnbue'], ['doors', 'Buevinduer']], paint: arches,
  },
  sunset: {
    label: 'Retro solnedgang', group: 'grafisk', cost: 'S', palette: ['#f3e7d6', '#e07a4f', '#f2b45c', '#5b3a2e', '#f7d9b5'],
    variants: [['stripes', 'Stripet sol'], ['hills', 'Sol over åser'], ['moon', 'Måneskinn'], ['boho', 'Sol med stråler']], paint: sunset,
  },
  'moon-phases': { label: 'Månefaser', group: 'grafisk', cost: 'S', palette: ['#1f2430', '#e9e2cf', '#b9b2a0', '#11141b', '#8b8fa0'], paint: moonPhases },
  'geometric-lines': {
    label: 'Linjegeometri', group: 'grafisk', cost: 'S', palette: ['#f3efe8', '#b08a4a', '#d7cbb8', '#1e1e1e', '#8c8c8c'],
    variants: [['constructed', 'Konstruert'], ['free', 'Frie linjer']], paint: geometricLines,
  },
  stripes: {
    label: 'Fargestriper', group: 'grafisk', cost: 'S', palette: ['#efe6d8', '#c6826b', '#e0c3a3', '#4a3b33', '#8ea39a'],
    variants: [['vertical', 'Loddrett'], ['diagonal', 'Diagonal'], ['blocks', 'Fargeblokker']], paint: stripes,
  },
  dots: {
    label: 'Prikker', group: 'grafisk', cost: 'S', palette: ['#f4f0e8', '#d6583c', '#2c4a6b', '#1d1d1d', '#e8b33e'],
    variants: [['grid', 'Rutenett'], ['scatter', 'Strødd'], ['big', 'Stor prikk']], paint: dotsMotif,
  },
  typography: {
    label: 'Tekstplakat', group: 'grafisk', cost: 'S', palette: ['#f2ede4', '#c96f4a', '#e6d5bf', '#1d1d1b', '#7d8a6a'], opts: ['text', 'subtext'],
    variants: [['centre', 'Midtstilt'], ['bottom', 'Nederst'], ['block', 'Fargefelt'], ['vertical', 'Loddrett']], paint: typography,
  },
  wave: {
    label: 'Bølge (japansk)', group: 'grafisk', cost: 'M', palette: ['#efe6d5', '#2f4f6f', '#6f8fa8', '#1b2a38', '#f0ebe0'],
    variants: [['great', 'Den store bølgen'], ['seigaiha', 'Bølgemønster']], paint: wave,
  },
  blobs: { label: 'Myke former', group: 'grafisk', cost: 'S', palette: ['#efe6d8', '#c08a5b', '#d9b99a', '#4b3a2e', '#8d8a6a'], paint: blobs },
  'line-face': {
    label: 'Ansikt i én strek', group: 'strek', cost: 'S', palette: ['#f2ece2', '#d9a38b', '#c9b8a6', '#1c1a18', '#e7c9b0'],
    variants: [['single', 'Profil'], ['kiss', 'To profiler'], ['front', 'Forfra']], paint: lineFace,
  },
  'kids-animals': {
    label: 'Dyr (barnerom)', group: 'barn', cost: 'M', palette: ['#f6efe6', '#e8b4a0', '#a9c6c2', '#4b4b4b', '#f2d388'],
    variants: [['bear', 'Bjørn'], ['fox', 'Rev'], ['whale', 'Hval'], ['bunny', 'Kanin'], ['deer', 'Hjort'], ['cat', 'Katt'], ['bird', 'Fugl']], paint: kidsAnimals,
  },
  'city-map': { label: 'Bykart', group: 'kart', cost: 'M', palette: ['#f4f1ea', '#c9d3c0', '#b9cfd9', '#2b2b2b', '#8a8a8a'], opts: ['text', 'subtext'], paint: cityMap },
  'topo-map': { label: 'Høydekart', group: 'kart', cost: 'M', palette: ['#f1ece2', '#b9a27f', '#d8c9ad', '#3d3a33', '#8c9a7f'], opts: ['subtext'], paint: topoMap },
};
