import { createCanvas, mulberry32, clamp, lerp, smoothstep, createNoise2D, fbm2D, ridged2D } from '../../world/proctex.js';

/**
 * Canvas2D toolkit for the art motif painters (models/art/graphic.js, models/art/painted.js – contract in
 * models/artmotifs.js). No three.js; nothing touches the DOM at import time (createCanvas runs only while painting), so
 * the registry imports in Node. Colours are '#rrggbb', mixed in sRGB (palettes are authored in sRGB).
 */

export { clamp, lerp, smoothstep, createNoise2D, fbm2D, ridged2D };
export const TAU = Math.PI * 2;

/** System font stacks only (a web font may not be loaded yet when a motif is painted and cached). */
export const FONTS = Object.freeze({
  serif: '"Didot","Bodoni 72","Bodoni MT",Georgia,"Times New Roman",serif',
  sans: '"Futura","Century Gothic","Avenir Next","Segoe UI","Helvetica Neue",Arial,sans-serif',
  grotesk: '"Helvetica Neue","Segoe UI",Arial,sans-serif',
  italic: 'Georgia,"Times New Roman",serif',
});

const rgbOf = (hex) => {
  const n = parseInt(String(hex).slice(1, 7), 16) || 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const hexOf = (r, g, b) => `#${[r, g, b].map((v) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0')).join('')}`;

/** sRGB mix of two colours (t = 0 → a, 1 → b). */
export function mix(a, b, t) {
  const A = rgbOf(a), B = rgbOf(b);
  return hexOf(lerp(A[0], B[0], t), lerp(A[1], B[1], t), lerp(A[2], B[2], t));
}
/** t > 0 lightens toward white, t < 0 darkens toward black. */
export const tint = (a, t) => (t >= 0 ? mix(a, '#ffffff', t) : mix(a, '#000000', -t));
/** Approximate relative luminance 0..1. */
export function lum(a) {
  const [r, g, b] = rgbOf(a);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}
/** Grey of the same luminance. */
export function grey(a) {
  const v = lum(a) * 255;
  return hexOf(v, v, v);
}
/** 'rgba(r,g,b,alpha)' of a colour. */
export function rgba(a, alpha) {
  const [r, g, b] = rgbOf(a);
  return `rgba(${r},${g},${b},${alpha})`;
}
/** Height-canvas grey for v in 0..1 (relief painters draw heights with it). */
export function h01(v) {
  const k = Math.round(clamp(v, 0, 1) * 255);
  return `rgb(${k},${k},${k})`;
}
/** Short side – scale every length by it. */
export const S = (W, H) => Math.min(W, H);

/** Opaque fill of the whole canvas. */
export function fill(c, W, H, col) {
  c.fillStyle = col;
  c.fillRect(0, 0, W, H);
}
/** Vertical gradient band from y0 to y1; stops = [[t, colour], …]. */
export function vgrad(c, W, y0, y1, stops) {
  const g = c.createLinearGradient(0, y0, 0, y1);
  for (const [t, col] of stops) g.addColorStop(t, col);
  c.fillStyle = g;
  c.fillRect(0, y0, W, y1 - y0);
}
export function ellipse(c, x, y, rx, ry, rot = 0) {
  c.beginPath();
  c.ellipse(x, y, Math.max(0.1, rx), Math.max(0.1, ry), rot, 0, TAU);
  c.fill();
}
export const circle = (c, x, y, r) => ellipse(c, x, y, r, r);
/** Path through [[x, y], …]; fill/stroke is the caller's. */
export function poly(c, pts, close = true) {
  c.beginPath();
  pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
  if (close) c.closePath();
}
/** Smooth path through the points (quadratic curves via the midpoints); fill/stroke is the caller's. */
export function smoothPath(c, pts, closed = true) {
  const n = pts.length;
  if (n < 3) return poly(c, pts, closed);
  const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  c.beginPath();
  if (closed) {
    const m0 = mid(pts[n - 1], pts[0]);
    c.moveTo(m0[0], m0[1]);
    for (let i = 0; i < n; i++) {
      const p = pts[i], m = mid(p, pts[(i + 1) % n]);
      c.quadraticCurveTo(p[0], p[1], m[0], m[1]);
    }
    c.closePath();
  } else {
    c.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < n - 1; i++) {
      const m = mid(pts[i], pts[i + 1]);
      c.quadraticCurveTo(pts[i][0], pts[i][1], m[0], m[1]);
    }
    c.lineTo(pts[n - 1][0], pts[n - 1][1]);
  }
}
/** Organic closed blob around (cx, cy): n lobes, radius r, wobble 0..1 (2n values from R); fill is the caller's. */
export function blob(c, R, cx, cy, r, n = 7, wobble = 0.35, rot = 0) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = rot + (i / n) * TAU;
    const rr = r * (1 - wobble / 2 + wobble * R());
    const sq = 0.85 + 0.3 * R();
    pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr * sq]);
  }
  smoothPath(c, pts, true);
}
/** Ridge line y(u), u = x / W in 0..1, from three random sines (6 values from R) – as decor.js ridge(x·6). */
export function ridge(R, base, amp) {
  const k = [R.range(1, 2.5), R.range(3, 6), R.range(8, 14)];
  const ph = [R() * TAU, R() * TAU, R() * TAU];
  return (u) => {
    const x = u * 6;
    return base + amp * (0.55 * Math.sin(x * k[0] + ph[0]) + 0.3 * Math.sin(x * k[1] + ph[1]) + 0.15 * Math.sin(x * k[2] + ph[2]));
  };
}
/** Fills from the curve y = f(x / W) down to the bottom edge. */
export function fillUnder(c, W, H, f, col, steps = 96) {
  c.fillStyle = col;
  c.beginPath();
  c.moveTo(0, H);
  for (let i = 0; i <= steps; i++) c.lineTo((i / steps) * W, f(i / steps));
  c.lineTo(W, H);
  c.closePath();
  c.fill();
}
/** Scratch canvas of the painter's size: paint on l.x, then composite once with blurOnto. */
export function layer(W, H) {
  const cv = createCanvas(Math.max(1, Math.round(W)), Math.max(1, Math.round(H)));
  return { cv, x: cv.getContext('2d') };
}
/** Composites a layer onto c with one blur (px) and alpha – at most two per painter. */
export function blurOnto(c, l, px = 0, alpha = 1) {
  c.save();
  c.globalAlpha = alpha;
  if (px > 0.3) c.filter = `blur(${px.toFixed(1)}px)`;
  c.drawImage(l.cv, 0, 0);
  c.restore();
}
/** Dry-brush stroke (x0, y0) → (x1, y1): n parallel thin lines with jittered offset and alpha (2n values from R). */
export function brush(c, R, x0, y0, x1, y1, width, col, alpha = 0.8, n = 7) {
  const dx = x1 - x0, dy = y1 - y0;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len, ny = dx / len;
  c.save();
  c.strokeStyle = col;
  c.lineCap = 'round';
  c.lineWidth = Math.max(0.5, (width / n) * 1.6);
  for (let i = 0; i < n; i++) {
    const o = ((i + 0.5) / n - 0.5) * width + (R() - 0.5) * (width / n);
    c.globalAlpha = alpha * (0.45 + 0.55 * R());
    c.beginPath();
    c.moveTo(x0 + nx * o, y0 + ny * o);
    c.lineTo(x1 + nx * o, y1 + ny * o);
    c.stroke();
  }
  c.restore();
}
/** Paper / photo grain: a 128 px noise tile laid over with 'overlay' (ONE value from R). */
export function grain(c, W, H, R, a = 0.05) {
  const rnd = mulberry32((R() * 4294967296) >>> 0);
  const n = createCanvas(128, 128);
  const nc = n.getContext('2d');
  const img = nc.createImageData(128, 128);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = rnd() * 255;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  nc.putImageData(img, 0, 0);
  c.save();
  c.globalAlpha = a;
  c.globalCompositeOperation = 'overlay';
  c.fillStyle = c.createPattern(n, 'repeat');
  c.fillRect(0, 0, W, H);
  c.restore();
}
/** Darkens the corners (photographs). */
export function vignette(c, W, H, a = 0.35) {
  const g = c.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.25, W / 2, H / 2, Math.hypot(W, H) * 0.55);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, `rgba(0,0,0,${a})`);
  c.save();
  c.fillStyle = g;
  c.fillRect(0, 0, W, H);
  c.restore();
}
/** Largest font size (≤ maxPx) at which `text` fits maxW; sets c.font and returns the size in px. */
export function fitText(c, text, maxW, family, maxPx, weight = '400', style = 'normal') {
  let px = Math.max(4, Math.floor(maxPx));
  for (let i = 0; i < 24; i++) {
    c.font = `${style} ${weight} ${px}px ${family}`;
    const w = c.measureText(text).width;
    if (w <= maxW || px <= 4) break;
    px = Math.max(4, Math.floor(px * Math.max(0.5, Math.min(0.97, maxW / w))));
  }
  return px;
}
/** Runs fn(ctx, isHeight) on the colour canvas and, when given, on the height canvas – draw random values BEFORE. */
export function both(c, hc, fn) {
  fn(c, false);
  if (hc) fn(hc, true);
}
/** Shuffled copy of an array (Fisher–Yates; length − 1 values from R). */
export function shuffled(R, arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(R() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ---------------------------------------------------------------------------------------------------------------
// Additions for the motif painters (everything above is unchanged).

/**
 * The motif variant: `o.variant` when it is one of `keys`, else a pick from R. Always consumes exactly ONE value, so
 * the rest of the composition does not depend on whether a variant was given.
 */
export function variantOf(R, o, keys) {
  const r = R.pick(keys);
  return o && keys.includes(o.variant) ? o.variant : r;
}

/** Seed for an independent generator (ONE value from R) – see rngFrom. */
export const seedOf = (R) => (R() * 4294967296) >>> 0;

/**
 * Generator with the K.rng API (range, int inclusive, pick, sign, jitter, gauss) from a seed. Draw `seedOf(R)` up
 * front and build `rngFrom(seed)` once per pass: the colour and the height pass then replay the same random strokes
 * (brush() consumes its generator) without R being touched inside a branch on o.hc.
 */
export function rngFrom(seed) {
  const r = mulberry32(seed >>> 0 || 1);
  const f = () => r();
  f.range = (a, b) => a + (b - a) * r();
  f.int = (a, b) => Math.floor(a + (b - a + 1) * r());
  f.pick = (arr) => arr[Math.floor(r() * arr.length) % arr.length];
  f.sign = () => (r() < 0.5 ? -1 : 1);
  f.jitter = (v, amount) => v + (r() * 2 - 1) * amount;
  f.gauss = () => {
    let u = 0;
    for (let i = 0; i < 4; i++) u += r();
    return (u - 2) * 1.732;
  };
  return f;
}

/** Five close tones of p[1] – relief builds (p.mono) let the structure carry the picture. */
export function tonal(p) {
  const b = p[1];
  return [tint(b, 0.14), b, tint(b, -0.1), tint(b, -0.24), tint(b, 0.28)];
}

/** Many discs in ONE fill: pts = [[x, y, r], …]; fillStyle is the caller's. Works in scaled (unit) space too. */
export function dots(c, pts) {
  c.beginPath();
  for (const [x, y, r] of pts) {
    const rr = Math.max(0, r);
    c.moveTo(x + rr, y);
    c.arc(x, y, rr, 0, TAU);
  }
  c.fill();
}

/** Filled ellipse without paintkit ellipse()'s 0.1 px minimum – for painting in scaled (unit) coordinates. */
export function oval(c, x, y, rx, ry, rot = 0) {
  c.beginPath();
  c.ellipse(x, y, Math.max(0, rx), Math.max(0, ry), rot, 0, TAU);
  c.fill();
}

/** Adds an n-pointed star (outer radius r, inner radius r·inner) to the current path. */
export function starPath(c, x, y, r, n = 5, inner = 0.45, rot = -Math.PI / 2) {
  for (let i = 0; i < n * 2; i++) {
    const a = rot + (i / (n * 2)) * TAU, rr = i % 2 ? r * inner : r;
    if (i) c.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    else c.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  c.closePath();
}

/** Adds a heart about 2s wide, centred at (x, y), to the current path. */
export function heartPath(c, x, y, s) {
  c.moveTo(x, y + s * 0.9);
  c.bezierCurveTo(x - s * 1.25, y + s * 0.05, x - s * 0.75, y - s * 0.95, x, y - s * 0.35);
  c.bezierCurveTo(x + s * 0.75, y - s * 0.95, x + s * 1.25, y + s * 0.05, x, y + s * 0.9);
  c.closePath();
}

/** Adds a spruce silhouette (drooping tiers, trunk foot at (x, yb), height h, width w) to the current path. */
export function sprucePath(c, x, yb, h, w, tiers = 7) {
  const top = yb - h, base = yb - h * 0.07, th = (base - top) / tiers;
  const side = [];
  for (let i = 0; i < tiers; i++) {
    const y = top + th * (i + 1), wi = (w / 2) * (0.22 + (0.78 * (i + 1)) / tiers);
    side.push([x + wi, y + th * 0.2]);
    if (i < tiers - 1) side.push([x + wi * 0.4, y - th * 0.08]);
  }
  c.moveTo(x, top);
  for (const [px, py] of side) c.lineTo(px, py);
  c.lineTo(x + w * 0.045, base);
  c.lineTo(x + w * 0.045, yb);
  c.lineTo(x - w * 0.045, yb);
  c.lineTo(x - w * 0.045, base);
  for (let i = side.length - 1; i >= 0; i--) c.lineTo(2 * x - side[i][0], side[i][1]);
  c.closePath();
}

/** Adds a ribbon along the polyline pts ([[x, y], …]) tapering from width w0 to w1 to the current path. */
export function taperPath(c, pts, w0, w1) {
  const n = pts.length;
  if (n < 2) return;
  const l = [], r = [];
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
    const d = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const nx = -(b[1] - a[1]) / d, ny = (b[0] - a[0]) / d;
    const hw = lerp(w0, w1, i / (n - 1)) / 2;
    l.push([pts[i][0] + nx * hw, pts[i][1] + ny * hw]);
    r.push([pts[i][0] - nx * hw, pts[i][1] - ny * hw]);
  }
  c.moveTo(l[0][0], l[0][1]);
  for (let i = 1; i < n; i++) c.lineTo(l[i][0], l[i][1]);
  for (let i = n - 1; i >= 0; i--) c.lineTo(r[i][0], r[i][1]);
  c.closePath();
}

/** Point on the quadratic Bézier a → (control b) → c at t. */
export function qpt(a, b, c, t) {
  const u = 1 - t;
  return [u * u * a[0] + 2 * u * t * b[0] + t * t * c[0], u * u * a[1] + 2 * u * t * b[1] + t * t * c[1]];
}

/**
 * Dry-brush stamp: a layer w × h (the stroke runs along +x) – a solid tapered body of paint with `streaks` bristle
 * streaks over it, ragged ends and a few dry gaps, all in `col`. The same seed gives the same bristles in every colour,
 * so a palette swap keeps the strokes. `angle` pre-rotates the stamp (the layer grows to the rotated box; draw it with
 * stampAt). Paint many strokes with stampLine / stampAt – a textured quad each, far cheaper than many thin lines.
 */
export function brushStamp(seed, w, h, col, { streaks = 12, dry = 0.3, taper = 0.18, body = 0.62, angle = 0 } = {}) {
  const r = rngFrom(seed);
  const sw = Math.max(4, w), sh = Math.max(2, h);
  const ca = Math.abs(Math.cos(angle)), sa = Math.abs(Math.sin(angle));
  const l = layer(Math.ceil(sw * ca + sh * sa) + 2, Math.ceil(sw * sa + sh * ca) + 2);
  const x = l.x;
  x.translate(l.cv.width / 2, l.cv.height / 2);
  x.rotate(angle);
  x.translate(-sw / 2, -sh / 2);
  x.fillStyle = col;
  // the body: a flat brush band – a squared, slightly ragged start, a little narrower toward the dry end
  x.globalAlpha = body;
  const x0 = sw * taper * 0.25, x1 = sw * (1 - taper * 0.8);
  x.beginPath();
  x.moveTo(x0 + r() * sw * 0.02, sh * 0.1);
  x.bezierCurveTo(sw * 0.35, sh * (0.06 + r() * 0.06), sw * 0.7, sh * (0.12 + r() * 0.06), x1, sh * 0.2);
  x.quadraticCurveTo(x1 + sw * taper * 0.4, sh * 0.5, x1, sh * 0.8);
  x.bezierCurveTo(sw * 0.7, sh * (0.82 + r() * 0.06), sw * 0.35, sh * (0.88 + r() * 0.06), x0 + r() * sw * 0.02, sh * 0.9);
  x.quadraticCurveTo(x0 - sw * 0.012, sh * 0.5, x0 + r() * sw * 0.02, sh * 0.1);
  x.fill();
  // bristles: thin tapered streaks running past the body at both ends
  for (let i = 0; i < streaks; i++) {
    const y = ((i + 0.5) / streaks) * sh + (r() - 0.5) * (sh / streaks) * 0.6;
    const th = (sh / streaks) * (0.7 + r() * 0.9);
    const bx0 = r() * sw * taper * 0.5, bx1 = sw - r() * sw * taper * 1.3;
    const bend = (r() - 0.5) * th * 0.6;
    x.globalAlpha = 0.2 + r() * 0.75;
    x.beginPath();
    x.moveTo(bx0, y);
    x.quadraticCurveTo((bx0 + bx1) / 2, y - th / 2 + bend, bx1, y);
    x.quadraticCurveTo((bx0 + bx1) / 2, y + th / 2 + bend, bx0, y);
    x.fill();
  }
  // dry gaps: a few thin, soft streaks scraped out toward the tail
  x.globalCompositeOperation = 'destination-out';
  const gaps = Math.round(streaks * dry);
  for (let i = 0; i < gaps; i++) {
    const y = sh * (0.15 + 0.7 * r()), th = (sh / streaks) * (0.25 + r() * 0.35), x0 = sw * (0.45 + r() * 0.35), x1 = sw * (0.95 + r() * 0.05);
    x.globalAlpha = 0.25 + r() * 0.35;
    x.beginPath();
    x.moveTo(x0, y);
    x.quadraticCurveTo((x0 + x1) / 2, y - th / 2, x1, y);
    x.quadraticCurveTo((x0 + x1) / 2, y + th / 2, x0, y);
    x.fill();
  }
  x.globalCompositeOperation = 'source-over';
  x.globalAlpha = 1;
  return l;
}

/** Draws a stamp from brushStamp as a stroke (x0, y0) → (x1, y1) of the given width (flip mirrors the bristles). */
export function stampLine(c, st, x0, y0, x1, y1, width, alpha = 1, flip = false) {
  const len = Math.hypot(x1 - x0, y1 - y0);
  if (len < 0.5) return;
  c.save();
  c.globalAlpha = alpha;
  c.translate(x0, y0);
  c.rotate(Math.atan2(y1 - y0, x1 - x0));
  if (flip) c.scale(1, -1);
  c.drawImage(st.cv, 0, -width / 2, len, width);
  c.restore();
}

/** Draws a (pre-rotated) stamp centred at (x, y), scaled by k – no transform, so thousands of dabs stay cheap. */
export function stampAt(c, st, x, y, k = 1, alpha = 1) {
  const w = st.cv.width * k, h = st.cv.height * k;
  c.globalAlpha = alpha;
  c.drawImage(st.cv, x - w / 2, y - h / 2, w, h);
}

/** A small CPU-backed layer for pixels computed in JS (coarse grids): putImageData there, then drawImage it scaled. */
export function pixelLayer(w, h) {
  const cv = createCanvas(Math.max(1, Math.round(w)), Math.max(1, Math.round(h)));
  return { cv, x: cv.getContext('2d', { willReadFrequently: true }) };
}
